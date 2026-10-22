import { mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { composeCore, unavailableCore, createPlanningReconciler, type PlanningReconciler, type PlanningReconcilerTimers, type CoreApi } from '@harness-projects/core'
import { createController, streamWorkspace, type Controller, type WireStreamFrame } from '@harness-projects/controller'
import { createSqliteStorage, type SqliteStorage } from '@harness-projects/storage-sqlite'
import type { WorkspaceId } from '@harness-projects/domain'
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

/** 每个 unary 操作一个 handler：只把已校验的输入透传给 Controller，结果与 `writeState` 不加工（Host 拥有权威状态）。 */
const HANDLERS: UnaryHandlers<typeof OPERATIONS, Controller> = {
  baseline: (controller) => controller.baseline(),
  refreshPlanning: (controller, input) => controller.commands.refreshPlanning(input),
  bootstrapWorkspace: (controller, input) => controller.commands.bootstrapWorkspace(input),
}

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
    // 空数据根：不向 Core 传 storage，不写任何行；工作区的创建属于挂载写者（#127、#131）。
    const core: CoreApi = workspace === undefined ? unavailableCore('工作区尚未创建') : await composeCore({
      workspace: { id: workspace.id, name: workspace.name, statusPolicy: workspace.statusPolicy },
      providers, diagnostics,
    })
    const controller = createController(core, { workspaceRevision: () => storage!.currentRevision(options.workspaceId) })
    if (table.planning !== undefined) {
      reconciler = createPlanningReconciler(() => { lifetime.assertActive(); return track(core.commands.refreshPlanning()) }, {
        intervalMs, diagnostics, ...(options.planningTimers === undefined ? {} : { timers: options.planningTimers }),
      })
      reconciler.start()
    }
    const dispatch = dispatchOf(OPERATIONS, HANDLERS, guarded)
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
