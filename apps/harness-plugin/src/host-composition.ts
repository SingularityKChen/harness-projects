export type { BindRepositoryInput, CommandResult } from '@harness-projects/controller'
import type { ExternalObjectRef, PlanningProvider, ProviderPlanningFieldDefinition, Storage, WorkspacePlanningMappingRecord } from '@harness-projects/capabilities'
import { mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { createWorkspaceSetup, composeCore, unavailableCore, createPlanningReconciler, type PlanningReconciler, type PlanningReconcilerTimers, type CoreApi } from '@harness-projects/core'
import { createConnectionCommands, createSetupCommands, type CommandResult, createController, streamWorkspace, type Controller, type WireStreamFrame } from '@harness-projects/controller'
import { createSqliteStorage, type SqliteStorage } from '@harness-projects/storage-sqlite'
import type { ExecutionContextDTO, WorkspaceSetupDTO } from '@harness-projects/client'
import { StatusPolicy, ProjectErrorCode, projectError, type ProjectError, type ConnectorAccountId, type WorkspaceId, type WorkspacePlanningFieldMapping } from '@harness-projects/domain'
import { createDiagnosticLog, describeError } from './host-diagnostics.ts'
import { createHostPlanningMapping } from './host-planning-mapping.ts'
import { createPlanningLifetime } from './host-planning-lifetime.ts'
import { dispatchOf, OPERATIONS, type UnaryHandlers, type UnaryName } from './host-operations.ts'
import { preflightRepositoryBinding } from './host-repository-binding.ts'
import { preflightPlanningConnection, githubViewer, HOST_SECRET_HANDLES, hostStoragePolicy, restoreProviders, type DisabledBinding, type ProviderCatalog } from './host-providers.ts'

/** Controller 失败上 wire 的唯一文案：原因只写进宿主诊断日志。 */
const OPERATION_FAILED = 'harness-projects：操作失败，原因已写入宿主诊断日志'

export interface HostCompositionOptions {
  readonly dataPath: string
  readonly workspaceId: WorkspaceId
  readonly catalog: ProviderCatalog
  /** 句柄 → 凭据值；每次 provider 操作才调用，Host 不缓存。 */
  readonly resolveCredential: (handle: string) => Promise<string | undefined>
  readonly sessionController?: () => unknown
  readonly forceSessionStartFailure?: boolean
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
  /** 本地配置已提交但候选未激活；与命令的持久化结果分开。 */
  readonly activationError: ProjectError | undefined
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

/** 读取前后检查可见性与当前绑定仓库，避免读取期间撤权仍返回历史节点。 */
async function assertDeliveryScope(controller: Controller, scope: { workItemId: string; repositoryId: string }): Promise<void> {
  if ((await controller.queries.getEntity(scope.workItemId))?.content.contentKind !== 'work_item'
    || !(await controller.baseline()).repositories?.some((repository) => repository.id === scope.repositoryId)) throw new Error('谱系作用域不可用')
}

/** 工作区身份来自 Host；执行记录只在读取前后均可见的工作项上投影允许字段。 */
const handlersFor = (workspaceId: WorkspaceId, mode: () => 'manual' | 'harness'): UnaryHandlers<Pick<typeof OPERATIONS, 'baseline' | 'refreshPlanning' | 'bootstrapWorkspace' | 'getExecutionContext' | 'refreshExecutionRun' | 'getStartWorkOptions' | 'startWork' | 'getDeliveryProjection' | 'refreshDeliveryFacts'>, Controller> => ({
  getStartWorkOptions: async (controller, input) => {
    if ((await controller.queries.getEntity(input.workItemId))?.content.contentKind !== 'work_item') throw new Error('工作项不可见')
    return { workspaceId, workItemId: input.workItemId, executionMode: mode() }
  },
  startWork: async (controller, input) => {
    if ((await controller.queries.getEntity(input.workItemId))?.content.contentKind !== 'work_item'
      || !(await controller.baseline()).repositories?.some((repository) => repository.id === input.repositoryId)) throw new Error('开始工作范围无效')
    if ((await controller.queries.getEntity(input.workItemId))?.content.contentKind !== 'work_item') throw new Error('工作项不可见')
    const { branchName, ...request } = input
    const result = await controller.commands.startWork({ ...request, ...(branchName === undefined ? {} : { branchName }) })
    if ((await controller.queries.getEntity(input.workItemId))?.content.contentKind !== 'work_item') throw new Error('工作项不可见')
    return { ...result, ...(result.error === undefined ? {} : { error: projectError(result.error.code, '开始工作未确认，请按恢复动作处理') }) }
  },
  getDeliveryProjection: async (controller, input) => {
    await assertDeliveryScope(controller, input)
    const projection = await controller.queries.getDeliveryProjection(input)
    await assertDeliveryScope(controller, input)
    if (projection.workItemId !== input.workItemId || projection.repositoryId !== input.repositoryId) throw new Error('谱系作用域不可用')
    return { workspaceId, ...input, projection, now: new Date().toISOString() }
  },
  refreshDeliveryFacts: async (controller, { actorRef, ...scope }) => {
    await assertDeliveryScope(controller, scope)
    const result = await controller.commands.refreshDeliveryFacts(scope, { actorRef })
    await assertDeliveryScope(controller, scope)
    return result
  },
  baseline: (controller) => controller.baseline(),
  refreshPlanning: (controller, input) => controller.commands.refreshPlanning(input),
  bootstrapWorkspace: (controller, input) => controller.commands.bootstrapWorkspace(input),
  refreshExecutionRun: async (controller, { actorRef, ...scope }) => {
    const visible = async () => { const entity = await controller.queries.getEntity(scope.workItemId); return (await controller.baseline()).workspace?.id === workspaceId && entity?.content.contentKind === 'work_item' }
    if (!await visible()) throw new Error('工作项不可见')
    const result = await controller.commands.refreshExecutionRun(scope, { actorRef })
    if (!await visible()) throw new Error('工作项不可见')
    return result
  },
  getExecutionContext: async (controller, input) => {
    const before = await controller.queries.getEntity(input.workItemId)
    if ((await controller.baseline()).workspace?.id !== workspaceId || before?.content.contentKind !== 'work_item') return { context: null }
    const context = await controller.queries.getExecutionContext(input)
    const after = await controller.queries.getEntity(input.workItemId)
    const visible = (await controller.baseline()).workspace?.id === workspaceId && after?.content.contentKind === 'work_item'
    if (!visible || context === undefined || context.workspaceId !== workspaceId
      || context.workItemId !== input.workItemId || context.repositoryId !== input.repositoryId) return { context: null }
    const dto: ExecutionContextDTO = {
      workspaceId, workItemId: context.workItemId, repositoryId: context.repositoryId, status: context.status,
      ...(context.branchExternalId === undefined ? {} : { branchExternalId: context.branchExternalId }),
      ...(context.worktreeExternalId === undefined ? {} : { worktreeExternalId: context.worktreeExternalId }),
      ...(context.runConfirmedAt === undefined ? {} : { runConfirmedAt: context.runConfirmedAt }),
      ...(context.runStale === undefined ? {} : { runStale: context.runStale }),
      ...(context.runStatus === undefined ? {} : { runStatus: context.runStatus }),
      ...(context.fallback === undefined ? {} : { fallback: context.fallback }),
    }
    return { context: dto }
  },
})

export async function createHostComposition(options: HostCompositionOptions): Promise<HostComposition> {
  const intervalMs = options.planningIntervalMs ?? 60_000
  if (!Number.isFinite(intervalMs) || intervalMs < 60_000 || intervalMs > 2_147_483_647) throw new RangeError('Planning refresh interval is invalid')
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
  type Assembly = { mapping?: ReturnType<typeof createHostPlanningMapping>; controller: Controller; disabled: readonly DisabledBinding[]; lifetime: ReturnType<typeof createPlanningLifetime>; reconciler?: PlanningReconciler; leases: Set<Promise<unknown>>; retired?: boolean; cache: Map<string, object>; executionMode: 'manual' | 'harness' }
  let developmentCache = new Map<string, object>()
  let current: Assembly
  let barrier: Promise<void> | undefined, epoch = 0, tail: Promise<unknown> = Promise.resolve(), activeFingerprint = ''
  let activationError: ProjectError | undefined
  const watches = new AbortController()
  let disposal: Promise<void> | undefined
  const pending = new Set<Promise<unknown>>()
  const track = <T>(task: Promise<T>): Promise<T> => {
    pending.add(task)
    void task.then(() => pending.delete(task), () => pending.delete(task))
    return task
  }
  const retire = (assembly: Assembly): void => { if (assembly.retired) return; assembly.retired = true; assembly.lifetime.stop(); assembly.reconciler?.dispose() }
  const stop = (): void => { closed = true; watches.abort(); if (current) retire(current) }
  const lease = <T>(assembly: Assembly, work: () => Promise<T>): Promise<T> => {
    const task = Promise.resolve().then(work); assembly.leases.add(task)
    void task.finally(() => assembly.leases.delete(task)).catch(() => undefined)
    return track(task)
  }
  const read = async <T>(load: (assembly: Assembly) => Promise<T>): Promise<T> => {
    for (;;) {
      while (barrier) await barrier
      if (closed) throw new Error('host 已关闭')
      const assembly = current, version = epoch
      const result = await lease(assembly, () => load(assembly))
      if (version === epoch && assembly === current) return result
    }
  }
  const source = { baseline: () => read(async (assembly) => {
    const snapshot = await assembly.controller.baseline()
    if (!activationError) return snapshot
    const stale = { freshness: 'degraded' as const, reason: activationError.code }
    return { ...snapshot, source: { ...snapshot.source, ...stale }, entities: snapshot.entities.map((entity) => ({ ...entity, source: { ...entity.source, ...stale } })) }
  }) }

  const dispose = (): Promise<void> => disposal ??= (async () => {
    stop()
    await Promise.allSettled([...pending])
    storage?.close()
  })()
  const diagnostics = { syncRoundFailed: (error: unknown) => log.write('syncRoundFailed', describeError(error)) }
  try {
    storage = createSqliteStorage(options.dataPath, hostStoragePolicy(options.catalog), options.migrationsDir === undefined ? {} : { migrationsDir: options.migrationsDir })
    const setup = createSetupCommands(createWorkspaceSetup(storage))
    const connection = createConnectionCommands(setup, {
      resolveAccount: async () => {
        const viewer = await githubViewer(options.fetch ?? globalThis.fetch, () => options.resolveCredential(HOST_SECRET_HANDLES[0]))
        return viewer.ok ? { ok: true, value: { platformFamily: 'github', platformOrigin: 'https://github.com', identityKind: 'account', externalId: viewer.value.nodeId, displayName: viewer.value.login, secretHandle: HOST_SECRET_HANDLES[0] } } : viewer
      },
      verifyProject: (input) => preflightPlanningConnection(storage!, input.accountId, input.configuration.projectNodeId, options.fetch ?? globalThis.fetch, options.resolveCredential),
    })
    const fingerprint = async () => JSON.stringify([await storage!.getWorkspacePlanningMapping(options.workspaceId), await storage!.getWorkspace(options.workspaceId), await Promise.all((await storage!.listProviderBindings(options.workspaceId)).map(async (mount) => {
      const accountId = await storage!.getProviderBindingAccount(mount.id)
      const configuration = options.catalog.has(mount.implementationKey) ? await storage!.getBindingConfiguration({ workspaceId: options.workspaceId, bindingId: mount.id, domain: mount.domain }) : undefined
      return [[mount.id, mount.domain, mount.implementationKey, mount.enabled], configuration, accountId === undefined ? undefined : await storage!.getConnectorAccount(accountId)]
    }))])
    const assemble = async (): Promise<Assembly> => {
      const lifetime = createPlanningLifetime(options.planningReadTimeoutMs)
      const assembly: Assembly = { controller: undefined!, disabled: [], lifetime, leases: new Set(), cache: new Map(developmentCache), executionMode: 'manual' }
      try {
        const workspace = await storage!.getWorkspace(options.workspaceId)
        const { table, disabled } = workspace === undefined ? { table: {}, disabled: [] } : await restoreProviders(storage!, workspace.id, options.catalog, {
          // 解析失败（例如宿主凭据服务缺席）只留允许名单字段；provider 随后把它归类为结构化 unavailable，不带原文。
          sessionController: () => { lifetime.assertActive(); return options.sessionController?.() },
          forceSessionStartFailure: options.forceSessionStartFailure,
          resolveCredential: async (handle) => {
            lifetime.assertActive()
            try { const value = await options.resolveCredential(handle); lifetime.assertActive(); return value }
            catch (error) { log.write('credentialFailed', describeError(error)); throw error }
          },
          development: { cache: assembly.cache, resolveCredential: async (handle) => { if (closed) throw new Error('host 已关闭'); return options.resolveCredential(handle) }, fetch: (url, init) => { if (closed) throw new Error('host 已关闭'); return (options.fetch ?? globalThis.fetch)(url, init) } },
          worktreesDir, fetch: (url, init) => { lifetime.assertActive(); return (options.fetch ?? globalThis.fetch)(url, init) },
        })
        for (const item of disabled) log.write('bindingDisabled', { bindingId: item.bindingId, domain: item.domain, implementationKey: item.implementationKey, code: item.error.code })
        const providers = { ...table, ...(table.planning === undefined ? {} : { planning: lifetime.wrap(table.planning) }), storage: storage! }
        assembly.mapping = createHostPlanningMapping(storage!, options.workspaceId, providers.planning)
        const mapping = workspace === undefined ? {} : await loadPlanningMapping(storage!, workspace.id, providers.planning, (event) => log.write(event, {}))
        // 空数据根：不向 Core 传 storage，不写任何行；工作区的创建属于挂载写者（#127、#131）。
        const core: CoreApi = workspace === undefined ? unavailableCore('工作区尚未创建') : await composeCore({
          workspace: { id: workspace.id, name: workspace.name, statusPolicy: workspace.statusPolicy, ...mapping },
          providers, diagnostics,
        })
        const controller = createController(core, { workspaceRevision: () => storage!.currentRevision(options.workspaceId) })
        assembly.controller = controller; assembly.disabled = disabled
        const start = (await controller.baseline()).capabilities.find((entry) => entry.key === 'execution.run.start')
        assembly.executionMode = table.execution?.definition.implementationKey === 'execution.harness' && ['available', 'degraded'].includes(start?.access ?? '') ? 'harness' : 'manual'
        if (table.planning !== undefined) {
          assembly.reconciler = createPlanningReconciler(async () => { while (barrier) await barrier; lifetime.assertActive(); return lease(assembly, () => core.commands.refreshPlanning()) }, {
            intervalMs, diagnostics, ...(options.planningTimers === undefined ? {} : { timers: options.planningTimers }),
          })
        }
        return assembly
      } catch (error) { retire(assembly); throw error }
    }
    current = await assemble(); developmentCache = current.cache; activeFingerprint = await fingerprint(); current.reconciler?.start()
    const configure = <T>(run: () => Promise<CommandResult<T>>, activate = true, confirmPlanning = false): Promise<CommandResult<T> & { activationError?: ProjectError }> => {
      const task = tail.then(async () => {
        if (closed) throw new Error('host 已关闭')
        let release!: () => void; barrier = new Promise<void>((resolve) => { release = resolve }); epoch++
        const old = current
        try {
          await Promise.allSettled([...old.leases])
          if (closed) throw new Error('host 已关闭')
          const result = await run()
          if (result.writeState === 'local_only' && activate) {
            try {
              const desired = await fingerprint()
              if (desired !== activeFingerprint) {
                old.reconciler?.stop()
                const candidate = await assemble()
                if (closed) { retire(candidate); throw new Error('host 已关闭') }
                let activatedFingerprint: string
                try { activatedFingerprint = await fingerprint(); candidate.reconciler?.start() } catch (error) { retire(candidate); throw error }
                current = candidate; developmentCache = candidate.cache; activeFingerprint = activatedFingerprint; retire(old)
              }
              activationError = undefined
            } catch (error) {
              log.write('activationFailed', describeError(error)); activationError = projectError(ProjectErrorCode.Unavailable, '本地配置已提交，装配尚未激活')
              return { ...result, activationError }
            }
          }
          if (confirmPlanning && result.writeState === 'local_only' && old === current && !activationError) await current.controller.commands.refreshPlanning({ actorRef: { kind: 'user' } })
          return result
        } finally {
          if (!closed) try { current.reconciler?.start() } catch (error) { log.write('schedulerResumeFailed', describeError(error)) }
          barrier = undefined; release()
        }
      })
      tail = task.catch(() => undefined); return track(task)
    }
    const getWorkspaceSetup = () => read(async (assembly): Promise<WorkspaceSetupDTO> => {
      let workspace: WorkspaceSetupDTO['workspace'] = null, bindingId: string | undefined, projectNodeId: string | undefined
      let activation: Pick<WorkspaceSetupDTO, 'activationError' | 'executionInstalled'> = activationError === undefined ? {} : { activationError: projectError(activationError.code, '本地配置已提交，装配尚未激活') }
      const failure = (reason?: string) => projectError(Object.values(ProjectErrorCode).some((code) => code === reason) ? reason as ProjectErrorCode : ProjectErrorCode.Unavailable, '规划项目尚未确认，请按恢复动作重试')
      try {
        const stored = await storage!.getWorkspace(options.workspaceId)
        workspace = stored === undefined ? null : { id: stored.id, name: stored.name }
        const executions = (await storage!.listProviderBindings(options.workspaceId)).filter((mount) => mount.domain === 'execution')
        if (executions.length === 2 && executions.some((mount) => mount.isDefault) && executions.some((mount) => !mount.isDefault) && executions.every((mount) => mount.enabled && mount.implementationKey === (mount.isDefault ? 'execution.harness' : 'execution.human'))) activation = { ...activation, executionInstalled: true }
        if (workspace === null) return { workspace, planning: { state: 'unbound' }, ...activation }
        const mount = (await storage!.listProviderBindings(options.workspaceId)).find((mount) => mount.enabled && mount.domain === 'planning')
        if (mount === undefined) return { workspace, planning: { state: 'unbound' }, ...activation }
        bindingId = mount.id
        const configuration = await storage!.getBindingConfiguration({ workspaceId: options.workspaceId, bindingId: mount.id, domain: 'planning' })
        const target = configuration?.configuration.projectNodeId
        if (typeof target === 'string' && target !== '') projectNodeId = target
        const mapping = await storage!.getWorkspacePlanningMapping(options.workspaceId)
        const mappingOrigin = mapping?.bindingId === bindingId && mapping.projectExternalId === projectNodeId ? mapping.origin : undefined
        const active = await fingerprint() === activeFingerprint
        const snapshot = active ? await assembly.controller.baseline() : undefined
        const state = !active ? 'configured' : projectNodeId !== undefined && snapshot?.source.freshness === 'fresh' ? 'confirmed' : 'degraded'
        return { workspace, planning: { state, bindingId, ...(projectNodeId === undefined ? {} : { projectNodeId }) }, ...activation,
          ...(mappingOrigin === undefined ? {} : { mappingOrigin }), ...(state === 'degraded' ? { error: failure(snapshot?.source.reason) } : {}) }
      } catch (error) {
        log.write('setupReadFailed', describeError(error))
        return { workspace, planning: workspace === null ? { state: 'unbound' } : { state: 'degraded', ...(bindingId === undefined ? {} : { bindingId }), ...(projectNodeId === undefined ? {} : { projectNodeId }) }, ...activation, error: failure() }
      }
    })
    const dispatch = dispatchOf<typeof OPERATIONS, Controller>(OPERATIONS, { ...handlersFor(options.workspaceId, () => current.executionMode), baseline: () => source.baseline(), getWorkspaceSetup,
      getPlanningMapping: () => read(async (assembly) => ({ ...await assembly.mapping!.load(), confirmed: await fingerprint() === activeFingerprint && (await assembly.controller.baseline()).source.freshness === 'fresh' })),
      setPlanningMapping: (_controller, input) => configure(async () => {
        const error = await current.mapping!.validate(input.expectedBindingId, input.expectedProjectExternalId, input.mapping)
        return error ? { writeState: error.code === 'conflict' ? 'conflict' : 'failed', saving: false, authoritative: false, value: undefined, error } : setup.setPlanningMapping({ ...input, workspaceId: options.workspaceId })
      }, true, true),
      createWorkspace: (_controller, input) => configure(() => setup.createWorkspace({ ...input, workspaceId: options.workspaceId, statusPolicy: StatusPolicy.ProviderAuthoritative })),
      connectAccount: (_controller, input) => configure(() => connection.connectAccount(input), false),
      bindPlanningSource: (_controller, { projectNodeId, accountId, ...input }) => configure(() => connection.bindPlanningSource({ ...input, accountId: accountId as ConnectorAccountId, workspaceId: options.workspaceId, implementationKey: 'planning.github-projects', configuration: { projectNodeId } })),
      installExecutionBindings: (_controller, input) => configure(() => setup.installExecutionBindings({ ...input, workspaceId: options.workspaceId })),
      bindRepository: async (_controller, input) => {
        const checked = await preflightRepositoryBinding({ ...input, references: input.references.map((ref) => ({ ...ref, accountId: ref.accountId as ConnectorAccountId | undefined })), workspaceId: options.workspaceId }, storage!, options.catalog, { worktreesDir, fetch: options.fetch ?? globalThis.fetch, resolveCredential: options.resolveCredential })
        return 'writeState' in checked ? checked : configure(() => setup.bindRepository(checked))
      },
    }, guarded)
    return {
      get controller() { return current.controller }, get disabled() { return current.disabled }, get activationError() { return activationError },
      call: async (name, input) => {
        if (closed) throw new Error('host 已关闭')
        if (['baseline', 'getWorkspaceSetup', 'getPlanningMapping', 'setPlanningMapping', 'createWorkspace', 'connectAccount', 'bindPlanningSource', 'bindRepository', 'installExecutionBindings'].includes(name)) return track(dispatch(current.controller, name, input))
        while (barrier) await barrier
        if (closed) throw new Error('host 已关闭')
        const assembly = current; return lease(assembly, () => dispatch(assembly.controller, name, input))
      },
      watch: (signal) => {
        if (closed) throw new Error('host 已关闭')
        const frames = streamWorkspace(source, { signal: AbortSignal.any([signal, watches.signal]), intervalMs: options.watchIntervalMs ?? 1000 })
        return { [Symbol.asyncIterator]: () => ({ next: () => guarded(() => frames.next()), return: () => frames.return() }) }
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
