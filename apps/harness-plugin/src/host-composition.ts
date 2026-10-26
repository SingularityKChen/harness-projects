import type { ExternalObjectRef, PlanningProvider, ProviderPlanningFieldDefinition, Storage, WorkspacePlanningMappingRecord } from '@harness-projects/capabilities'
import { mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { composeCore, unavailableCore, createPlanningReconciler, type PlanningReconciler, type PlanningReconcilerTimers, type CoreApi } from '@harness-projects/core'
import { createController, streamWorkspace, type Controller, type WireStreamFrame } from '@harness-projects/controller'
import { createSqliteStorage, type SqliteStorage } from '@harness-projects/storage-sqlite'
import type { ExecutionContextDTO } from '@harness-projects/client'
import type { WorkspaceId, WorkspacePlanningFieldMapping } from '@harness-projects/domain'
import { createDiagnosticLog, describeError } from './host-diagnostics.ts'
import { createPlanningLifetime } from './host-planning-lifetime.ts'
import { dispatchOf, OPERATIONS, type UnaryHandlers, type UnaryName } from './host-operations.ts'
import { hostStoragePolicy, restoreProviders, type DisabledBinding, type ProviderCatalog } from './host-providers.ts'

/** Controller 失败上 wire 的唯一文案：原因只写进宿主诊断日志。 */
const OPERATION_FAILED = 'harness-projects：操作失败，原因已写入宿主诊断日志'

export interface HostCompositionOptions {
  readonly dataPath: string
  readonly workspaceId: WorkspaceId
  readonly catalog: ProviderCatalog
  /** 句柄 → 凭据值；每次 provider 操作才调用，Host 不缓存。 */
  readonly resolveCredential: (handle: string) => Promise<string | undefined>
  readonly migrationsDir?: string
  /** 缺省为调用时才读取的 `globalThis.fetch`（测试可替换）。 */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
  /** watch 流两次 poll 之间的间隔（毫秒），缺省 1000；测试传 5。 */
  readonly watchIntervalMs?: number
  /** 全量读取默认/最低 60 秒；测试只替换 timers，不放宽速率。 */
  readonly planningIntervalMs?: number
  /** 每个 Promise 读、每次 reconcile 迭代的绝对预算；默认 30 秒。 */
  readonly planningReadTimeoutMs?: number
  readonly planningTimers?: PlanningReconcilerTimers
}
export interface HostComposition {
  readonly controller: Controller
  /** 运行期无法构造而被禁用的挂载；只在内存，不写库。 */
  readonly disabled: readonly DisabledBinding[]
  call(name: UnaryName<typeof OPERATIONS>, input: unknown): Promise<unknown>
  /** 一代宿主流（#276）：每次 `next()` 都经 `guarded`；`signal` 中止即正常结束。 */
  watch(signal: AbortSignal): AsyncIterable<WireStreamFrame>
  /** 同步撤销读准入；Host 在 remote drain 前调用。 */
  stop(): void
  /** 等已登记任务完成后关闭 Storage；重复调用共享同一 Promise。 */
  dispose(): Promise<void>
}

/** 工作区身份来自 Host；执行记录只在读取前后均可见的工作项上投影允许字段。 */
const handlersFor = (workspaceId: WorkspaceId): UnaryHandlers<typeof OPERATIONS, Controller> => ({
  baseline: (controller) => controller.baseline(),
  refreshPlanning: (controller, input) => controller.commands.refreshPlanning(input),
  bootstrapWorkspace: (controller, input) => controller.commands.bootstrapWorkspace(input),
  getExecutionContext: async (controller, input) => {
    if ((await controller.queries.getEntity(input.workItemId))?.content.contentKind !== 'work_item') return { context: null }
    const context = await controller.queries.getExecutionContext(input)
    const visible = (await controller.queries.getEntity(input.workItemId))?.content.contentKind === 'work_item'
    if (!visible || context === undefined || context.workspaceId !== workspaceId
      || context.workItemId !== input.workItemId || context.repositoryId !== input.repositoryId) return { context: null }
    const dto: ExecutionContextDTO = {
      workspaceId, workItemId: context.workItemId, repositoryId: context.repositoryId, status: context.status,
      ...(context.branchExternalId === undefined ? {} : { branchExternalId: context.branchExternalId }),
      ...(context.worktreeExternalId === undefined ? {} : { worktreeExternalId: context.worktreeExternalId }),
      ...(context.runStatus === undefined ? {} : { runStatus: context.runStatus }),
      ...(context.fallback === undefined ? {} : { fallback: context.fallback }),
    }
    return { context: dto }
  },
})

export async function createHostComposition(options: HostCompositionOptions): Promise<HostComposition> {
  const intervalMs = options.planningIntervalMs ?? 60_000
  if (!Number.isFinite(intervalMs) || intervalMs < 60_000 || intervalMs > 2_147_483_647) throw new RangeError('Planning refresh interval is invalid')
  const lifetime = createPlanningLifetime(options.planningReadTimeoutMs)
  const dataDir = path.dirname(options.dataPath)
  await mkdir(dataDir, { recursive: true })
  const worktreesDir = path.join(await realpath(dataDir), 'worktrees')
  const log = createDiagnosticLog(path.join(dataDir, 'diagnostics.log'))
  /** Controller 的任何拒绝上 wire 前都经这里：原因先进诊断日志，调用方只看到固定文案。`closed` 与输入校验留在它之外（固定中文文案，不含运行期原文）。 */
  const guarded = async <T>(run: () => Promise<T>): Promise<T> => {
    try { return await run() } catch (error) {
      log.write('operationFailed', describeError(error))
      throw new Error(OPERATION_FAILED)
    }
  }
  let storage: SqliteStorage | undefined
  let closed = false
  let reconciler: PlanningReconciler | undefined
  let disposal: Promise<void> | undefined
  const pending = new Set<Promise<unknown>>()
  const track = <T>(task: Promise<T>): Promise<T> => {
    pending.add(task)
    void task.then(() => pending.delete(task), () => pending.delete(task))
    return task
  }
  const stop = (): void => { closed = true; lifetime.stop(); reconciler?.dispose() }
  const dispose = (): Promise<void> => disposal ??= (async () => {
    stop()
    await Promise.allSettled([...pending])
    storage?.close()
  })()
  const diagnostics = { syncRoundFailed: (error: unknown) => log.write('syncRoundFailed', describeError(error)) }
  try {
    storage = createSqliteStorage(options.dataPath, hostStoragePolicy(options.catalog), options.migrationsDir === undefined ? {} : { migrationsDir: options.migrationsDir })
    const workspace = await storage.getWorkspace(options.workspaceId)
    const { table, disabled } = workspace === undefined ? { table: {}, disabled: [] } : await restoreProviders(storage, workspace.id, options.catalog, {
      // 解析失败（例如宿主凭据服务缺席）只留允许名单字段；provider 随后把它归类为结构化 unavailable，不带原文。
      resolveCredential: async (handle) => {
        lifetime.assertActive()
        try { const value = await options.resolveCredential(handle); lifetime.assertActive(); return value }
        catch (error) { log.write('credentialFailed', describeError(error)); throw error }
      },
      worktreesDir, fetch: (url, init) => { lifetime.assertActive(); return (options.fetch ?? globalThis.fetch)(url, init) },
    })
    for (const item of disabled) log.write('bindingDisabled', { bindingId: item.bindingId, domain: item.domain, implementationKey: item.implementationKey, code: item.error.code })
    const providers = { ...table, ...(table.planning === undefined ? {} : { planning: lifetime.wrap(table.planning) }), storage }
    const mapping = workspace === undefined ? {} : await loadPlanningMapping(storage, workspace.id, providers.planning, (event) => log.write(event, {}))
    // 空数据根：不向 Core 传 storage，不写任何行；工作区的创建属于挂载写者（#127、#131）。
    const core: CoreApi = workspace === undefined ? unavailableCore('工作区尚未创建') : await composeCore({
      workspace: { id: workspace.id, name: workspace.name, statusPolicy: workspace.statusPolicy, ...mapping },
      providers, diagnostics,
    })
    const controller = createController(core, { workspaceRevision: () => storage!.currentRevision(options.workspaceId) })
    if (table.planning !== undefined) {
      reconciler = createPlanningReconciler(() => { lifetime.assertActive(); return track(core.commands.refreshPlanning()) }, {
        intervalMs, diagnostics, ...(options.planningTimers === undefined ? {} : { timers: options.planningTimers }),
      })
      reconciler.start()
    }
    const dispatch = dispatchOf(OPERATIONS, handlersFor(options.workspaceId), guarded)
    return {
      controller,
      disabled,
      call: async (name, input) => { if (closed) throw new Error('host 已关闭'); return track(dispatch(controller, name, input)) },
      watch: (signal) => {
        if (closed) throw new Error('host 已关闭')
        const frames = streamWorkspace(controller, { signal, intervalMs: options.watchIntervalMs ?? 1000 })
        return { [Symbol.asyncIterator]: () => ({
          next: () => {
            if (closed) return Promise.reject(new Error('host 已关闭'))
            return track(guarded(() => frames.next()))
          },
          return: () => frames.return(),
        }) }
      },
      stop, dispose,
    }
  } catch (error) { await dispose(); throw error }
}

type MappingInput = { readonly project?: ExternalObjectRef; readonly planningFieldMapping?: WorkspacePlanningFieldMapping; readonly planningMappingOrigin?: 'derived' | 'user' }
/** 默认词表是产品策略；歧义与错 kind 均不猜，Core 仍只消费显式 ID。 */
function derive(fields: readonly ProviderPlanningFieldDefinition[]): WorkspacePlanningFieldMapping {
  const unique = (names: readonly string[], kind: string) => {
    const candidates = fields.filter((field) => names.includes(field.name))
    return candidates.length === 1 && candidates[0]?.kind === kind ? candidates[0] : undefined
  }
  const status = unique(['Status'], 'single_select')
  const iteration = unique(['Iteration'], 'iteration')
  const targetDate = unique(['Target date', 'Target Date'], 'date')
  const options = status?.kind === 'single_select' ? status.options : []
  const targets = [['Todo', 'todo'], ['In Progress', 'in_progress'], ['Done', 'done']] as const
  return {
    ...(status === undefined ? {} : { status: { projectFieldId: status.id, options: Object.fromEntries(targets.flatMap(([name, target]) => {
      const matches = options.filter((option) => option.name === name)
      return matches.length === 1 ? [[matches[0]!.id, target]] : []
    })) } }),
    ...(iteration === undefined ? {} : { iterationFieldId: iteration.id }),
    ...(targetDate === undefined ? {} : { targetDateFieldId: targetDate.id }),
  }
}

/** 发现请求经 Host lifetime 包装；提交前事务内重查，迟到派生不得覆盖用户配置。 */
async function loadPlanningMapping(storage: Storage, workspaceId: WorkspaceId, planning: PlanningProvider | undefined,
  diagnostic: (event: string) => void): Promise<MappingInput> {
  if (planning === undefined) return {}
  const binding = (await storage.listProviderBindings(workspaceId)).find((mount) => mount.enabled && mount.domain === 'planning')
  if (binding === undefined) return {}
  const configured = await storage.getBindingConfiguration({ workspaceId, bindingId: binding.id, domain: 'planning' })
  const projectExternalId = configured?.configuration.projectNodeId
  if (typeof projectExternalId !== 'string' || projectExternalId === '') return {}
  const project: ExternalObjectRef = { bindingId: binding.id, objectKind: 'project', externalId: projectExternalId, url: undefined }
  const use = (record: WorkspacePlanningMappingRecord): MappingInput => {
    if (record.bindingId !== binding.id || record.projectExternalId !== projectExternalId) { diagnostic('planningMappingScopeMismatch'); return { project } }
    return { project, planningFieldMapping: record.mapping, planningMappingOrigin: record.origin }
  }
  const saved = await storage.getWorkspacePlanningMapping(workspaceId)
  if (saved !== undefined) return use(saved)
  let mapping: WorkspacePlanningFieldMapping
  try {
    const result = await planning.listFieldDefinitions(project)
    if (!result.ok) { diagnostic('planningMappingDiscoveryFailed'); return { project } }
    mapping = derive(result.value)
  } catch { diagnostic('planningMappingDiscoveryFailed'); return { project } }
  if (Object.keys(mapping).length === 0) return { project }
  return storage.transaction(async (tx) => {
    const current = await tx.getWorkspacePlanningMapping(workspaceId)
    if (current !== undefined) return use(current)
    const record = { workspaceId, bindingId: binding.id, projectExternalId, origin: 'derived' as const, mapping }
    await tx.putWorkspacePlanningMapping(record)
    return use(record)
  })
}
