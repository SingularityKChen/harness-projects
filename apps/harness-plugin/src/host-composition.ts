export type { BindRepositoryInput, CommandResult } from '@harness-projects/controller'
import type { ExternalObjectRef, PlanningProvider, ProviderPlanningFieldDefinition, Storage, WorkspacePlanningMappingRecord } from '@harness-projects/capabilities'
import { CapabilityKey } from '@harness-projects/capabilities'
import path from 'node:path'
import { createWorkspaceSetup, composeCore, unavailableCore, createPlanningReconciler, type CoreProviderTable, type PlanningReconciler, type PlanningReconcilerTimers, type CoreApi } from '@harness-projects/core'
import { createConnectionCommands, createSetupCommands, type CommandResult, createController, streamWorkspace, type Controller, type WireStreamFrame } from '@harness-projects/controller'
import { createSqliteStorage, type SqliteStorage } from '@harness-projects/storage-sqlite'
import type { ExecutionContextDTO, WorkspaceSetupDTO } from '@harness-projects/client'
import { StatusPolicy, ProjectErrorCode, newWorkspaceIdForCreateIntent, projectError, type ProjectError, type ConnectorAccountId, type WorkspaceId, type WorkspacePlanningFieldMapping } from '@harness-projects/domain'
import { preparePrivateProjectData } from './host-private-data.ts'
import { createDiagnosticLog, describeError } from './host-diagnostics.ts'
import { createHostPlanningMapping } from './host-planning-mapping.ts'
import { createPlanningLifetime, drainUntil } from './host-planning-lifetime.ts'
import { dispatchOf, OPERATIONS, WORKSPACE_SWITCHED, type UnaryHandlers, type UnaryName } from './host-operations.ts'
import { preflightRepositoryBinding, repositoryHead } from './host-repository-binding.ts'
import { preflightPlanningConnection, ciAccountStamp, type CiReadObservation, githubViewer, HOST_SECRET_HANDLES, hostStoragePolicy, restoreProviders, type DisabledBinding, type ProviderCatalog } from './host-providers.ts'

/** Controller 失败上 wire 的唯一文案：原因只写进宿主诊断日志。 */
const OPERATION_FAILED = 'harness-projects：操作失败，原因已写入宿主诊断日志'

const MISSING_WORKSPACE = '00000000-0000-4000-8000-000000000000' as WorkspaceId
const OPEN_NOT_SUPPORTED = '当前 Host 不支持此项目已存的规划策略；原数据库保留，当前项目保持不变。'
const OPEN_UNAVAILABLE = '项目暂时无法打开，请重新读取当前项目。'
/** Host 支持集拒绝与可恢复的普通装配失败分开；不将持久策略原文带出边界。 */
class HostPolicyAdmissionError extends Error {
  readonly code = ProjectErrorCode.NotSupported
  readonly reason = 'unsupported_workspace_policy'
  constructor() {
    super('当前 Core Host 不支持此已存规划策略；原数据库保留，请停止使用并等待支持该策略的版本。')
    this.name = 'HostPolicyAdmissionError'
  }
}

export interface HostCompositionOptions {
  readonly owner?: { readonly signal: AbortSignal; stop(error?: unknown): number }
  readonly dataPath: string
  readonly rawProfile?: string
  /**
   * 显式初始目标：测试与嵌入方的既有调用点语义；缺省时按「恰好一个已存工作区」选择，否则空装配（Home）。
   * 它同时是 create 的目标 id 优先级来源——提供时创建写回该 id（不按幂等键派生），未提供时才由
   * wire `idempotencyKey` 确定性派生。
   */
  readonly workspaceId?: WorkspaceId
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
  /** 本次调用成功确认装配后，在串行区内同步确认 generation；Host 内部契约，不进入 wire。 */
  call(name: UnaryName<typeof OPERATIONS>, input: unknown, acknowledge?: (generation: string) => void): Promise<unknown>
  /** 当前装配的 Core generation；per-peer 请求栅栏用它判断已下发的流是否过期。 */
  currentGeneration(): string | undefined
  /** 一代宿主流（#276）：每次 `next()` 都经 `guarded`；`signal` 中止即正常结束。 */
  watch(signal: AbortSignal): AsyncIterable<WireStreamFrame>
  /** 同步撤销读准入；Host 在 remote drain 前调用。 */
  stop(): void
  /** 等已登记任务完成后关闭 Storage；重复调用共享同一 Promise。 */
  dispose(deadline?: number): Promise<void>
  /** Host 内部生命周期诊断：只写现有日志的安全允许名单，不进入 remote wire。 */
  diagnoseShutdown(event: 'shutdownDeadlineExceeded' | 'shutdownFailed', error?: unknown): void
}

/** 读取前后检查可见性与当前绑定仓库，避免读取期间撤权仍返回历史节点。 */
async function assertDeliveryScope(controller: Controller, scope: { workItemId: string; repositoryId: string }): Promise<void> {
  if ((await controller.queries.getEntity(scope.workItemId))?.content.contentKind !== 'work_item'
    || !(await controller.baseline()).repositories?.some((repository) => repository.id === scope.repositoryId)) throw new Error('谱系作用域不可用')
}

/** Core 已持久确认后，最后一个 await 仅观察原操作及当前目标；不再启动外部刷新。 */
async function finishChangeRequest(controller: Controller, scope: { workItemId: string; repositoryId: string }, result: Awaited<ReturnType<Controller['commands']['createChangeRequest']>>) {
  const operation = result.value?.operationId === undefined ? undefined : await controller.queries.getChangeRequestOperation({ ...scope, operationId: result.value.operationId })
  if (result.authoritative && (operation?.kind !== 'operation' || operation.state !== 'saved' || !operation.currentTarget || operation.targetStamp !== result.value?.targetStamp)) {
    return { writeState: 'conflict', saving: false, authoritative: false, error: projectError(ProjectErrorCode.Conflict, 'PR 当前目标已变化，请读取原操作') }
  }
  const assignment = operation?.kind === 'operation' ? operation.assignment : undefined
  return {
    ...result,
    ...(result.authoritative && assignment && assignment.state !== 'confirmed' ? { value: { ...result.value!, assignment } } : {}),
    ...(result.error === undefined ? {} : { error: projectError(result.error.code, 'PR 未确认，请按恢复动作处理') }),
  }
}

/** 工作区身份来自 Host；执行记录只在读取前后均可见的工作项上投影允许字段。 */
type HandlerAssembly = { readonly workspaceId: WorkspaceId; readonly executionMode: 'manual' | 'harness'; readonly targetError: CoreApi['queries']['getStartWorkTargetError'] }
const handlersFor = ({ workspaceId, executionMode, targetError }: HandlerAssembly): UnaryHandlers<Pick<typeof OPERATIONS, 'listChangeRequestAssigneeOptions' | 'getChangeRequestAssigneeOperation' | 'addChangeRequestAssignees' | 'resumeChangeRequestAssignees' | 'getIssueClosingLinks' | 'refreshIssueDependencies' | 'refreshIssueClosingLinks' | 'baseline' | 'refreshPlanning' | 'bootstrapWorkspace' | 'getExecutionContext' | 'refreshExecutionRun' | 'getStartWorkOptions' | 'startWork' | 'getDeliveryProjection' | 'refreshDeliveryFacts' | 'createChangeRequest' | 'getChangeRequestIssueOptions' | 'getChangeRequestOperation' | 'resumeChangeRequest'>, Controller> => ({
  listChangeRequestAssigneeOptions: async (controller, input) => {
    try { return { workspaceId, ...await controller.commands.listChangeRequestAssigneeOptions(input) } }
    catch (error) {
      const code = (error as ProjectError | undefined)?.code
      if (!['not_supported', 'permission_denied', 'unavailable'].includes(code ?? '')) throw error
      return { workspaceId, workItemId: input.workItemId, repositoryId: input.repositoryId, error: code }
    }
  },
  getChangeRequestAssigneeOperation: async (controller, { actorRef: _actor, ...scope }) => ({ workspaceId, ...scope, operation: await controller.queries.getChangeRequestAssigneeOperation(scope) }),
  addChangeRequestAssignees: async (controller, input) => ({ workspaceId, workItemId: input.workItemId, repositoryId: input.repositoryId, createOperationId: input.createOperationId, result: await controller.commands.addChangeRequestAssignees(input) }),
  resumeChangeRequestAssignees: async (controller, input) => ({ workspaceId, workItemId: input.workItemId, repositoryId: input.repositoryId, createOperationId: input.createOperationId, result: await controller.commands.resumeChangeRequestAssignees(input) }),
  getIssueClosingLinks: async (controller, input) => ({ workspaceId, ...input, observation: await controller.queries.getIssueClosingLinks(input) }),
  refreshIssueDependencies: async (controller, { actorRef, ...input }) => ({ workspaceId, ...input, result: await controller.commands.refreshIssueDependencies(input, { actorRef }) }),
  refreshIssueClosingLinks: (controller, { actorRef, ...input }) => controller.commands.refreshIssueClosingLinks(input, { actorRef }),
  getStartWorkOptions: async (controller, input) => {
    if ((await controller.queries.getEntity(input.workItemId))?.content.contentKind !== 'work_item') throw new Error('工作项不可见')
    return { workspaceId, workItemId: input.workItemId, executionMode, repositories: await controller.commands.validateStartWork(input.workItemId) }
  },
  startWork: async (controller, input) => {
    if ((await controller.queries.getEntity(input.workItemId))?.content.contentKind !== 'work_item'
      || !(await controller.baseline()).repositories?.some((repository) => repository.id === input.repositoryId)) throw new Error('开始工作范围无效')
    if ((await controller.queries.getEntity(input.workItemId))?.content.contentKind !== 'work_item') throw new Error('工作项不可见')
    const before = await targetError(input.workItemId)
    if (before) return { writeState: 'failed' as const, saving: false, authoritative: false, value: undefined, error: projectError(before.code, '开始工作未确认，请按恢复动作处理') }
    const { branchName, ...request } = input
    const result = await controller.commands.startWork({ ...request, ...(branchName === undefined ? {} : { branchName }) })
    if ((await controller.queries.getEntity(input.workItemId))?.content.contentKind !== 'work_item') throw new Error('工作项不可见')
    const currentError = await targetError(input.workItemId), error = currentError ?? result.error
    const reason = error?.message.match(/^(capability|permission|policy) 层拒绝 ([a-z._]+)；/)
    return { ...result, ...(currentError && result.authoritative ? { writeState: 'unknown' as const, authoritative: false } : {}),
      ...(error === undefined ? {} : { error: projectError(error.code, currentError && result.authoritative
        ? '已确认资源保留；当前规划只读准入不再确认本次请求，请恢复后用原键读回' : reason
          && Object.values(CapabilityKey).some(key => key === reason[2]) ? `${reason[1]} 层拒绝 ${reason[2]}；其它获准操作仍可用，请恢复授权后重新验证并显式重试`
          : error.message === 'existing_execution_task_not_sent' ? error.message : '开始工作未确认，请按恢复动作处理') }) }
  },
  getChangeRequestIssueOptions: async (controller, { actorRef: _actorRef, ...scope }) => ({ workspaceId, ...scope, options: await controller.queries.getChangeRequestIssueOptions(scope) }),
  createChangeRequest: async (controller, input) => {
    await assertDeliveryScope(controller, input)
    const result = await controller.commands.createChangeRequest(input)
    return finishChangeRequest(controller, { workItemId: input.workItemId, repositoryId: input.repositoryId }, result)
  },
  getChangeRequestOperation: async (controller, { actorRef: _actorRef, operationId, ...scope }) => ({ workspaceId, ...scope,
    operation: await controller.queries.getChangeRequestOperation({ ...scope, ...(operationId === undefined ? {} : { operationId }) }),
  }),
  resumeChangeRequest: async (controller, input) => {
    const result = await controller.commands.resumeChangeRequest(input)
    return finishChangeRequest(controller, { workItemId: input.workItemId, repositoryId: input.repositoryId }, result)
  },
  getDeliveryProjection: async (controller, input) => {
    for (;;) {
      const version = controller.queries.getDeliveryAccessVersion()
      await assertDeliveryScope(controller, input)
      const projection = await controller.queries.getDeliveryProjection(input)
      await assertDeliveryScope(controller, input)
      if (version !== controller.queries.getDeliveryAccessVersion()) continue
      if (projection.workItemId !== input.workItemId || projection.repositoryId !== input.repositoryId) throw new Error('谱系作用域不可用')
      return { workspaceId, ...input, projection, now: new Date().toISOString() }
    }
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
  options.owner?.signal.throwIfAborted()
  const prepared = await preparePrivateProjectData(options.dataPath, options.owner?.signal, options.rawProfile)
  const worktreesDir = path.join(prepared.directory, 'worktrees')
  const log = createDiagnosticLog(prepared.logFd)
  const diagnoseShutdown: HostComposition['diagnoseShutdown'] = (event, error) => log.write(event, error === undefined ? {} : describeError(error))
  /** Controller 的任何拒绝上 wire 前都经这里：原因先进诊断日志，调用方只看到固定文案。`closed` 与输入校验留在它之外（固定中文文案，不含运行期原文）。 */
  const guarded = async <T>(run: () => Promise<T>): Promise<T> => {
    try { return await run() } catch (error) {
      log.write('operationFailed', describeError(error))
      throw new Error(OPERATION_FAILED)
    }
  }
  let storage: SqliteStorage | undefined
  let io: ReturnType<typeof createPlanningLifetime> | undefined
  const resolveCredential = (handle: string) => io!.wait(() => options.resolveCredential(handle), Infinity)
  const fetch = (url: string, init: RequestInit) => io!.wait(async () => {
    const signal = AbortSignal.any([io!.signal, ...(init.signal ? [init.signal] : [])])
    const response = await (options.fetch ?? globalThis.fetch)(url, { ...init, signal })
    io!.assertActive()
    return new Proxy(response, { get(target, key) {
      const value: unknown = Reflect.get(target, key, target)
      return key === 'json' ? () => io!.wait(() => target.json(), Infinity) : typeof value === 'function' ? value.bind(target) : value
    } })
  }, Infinity)
  let closed = false
  type Assembly = { mapping?: ReturnType<typeof createHostPlanningMapping>; controller: Controller; targetError: CoreApi['queries']['getStartWorkTargetError']; disabled: readonly DisabledBinding[]; lifetime: ReturnType<typeof createPlanningLifetime>; reconciler?: PlanningReconciler; leases: Set<Promise<unknown>>; retired?: boolean; cache: Map<string, object>; executionMode: 'manual' | 'harness'; workspaceId: WorkspaceId | undefined; generation: string; dispatch?: Dispatch }
  type Dispatch = (controller: Controller, name: UnaryName<typeof OPERATIONS>, input: unknown) => Promise<unknown>
  const SETTINGS_OPERATIONS = new Set(['setPlanningMapping', 'connectAccount', 'bindPlanningSource', 'bindRepository', 'installExecutionBindings'])
  const READ_AFTER_STOP = new Set(['getIssueClosingLinks', 'refreshIssueClosingLinks', 'refreshIssueDependencies', 'getChangeRequestIssueOptions'])
  const assemblies = new Set<Assembly>()
  let developmentCache = new Map<string, object>()
  let current: Assembly
  let barrier: Promise<void> | undefined, epoch = 0, tail: Promise<unknown> = Promise.resolve(), activeFingerprint = ''
  let activationError: ProjectError | undefined, repositoryValidation = 0
  const watches = new AbortController()
  const streams = new Set<() => Promise<unknown>>()
  let disposal: Promise<void> | undefined
  let stopDeadline: number | undefined
  const pending = new Set<Promise<unknown>>()
  const track = <T>(task: Promise<T>): Promise<T> => {
    pending.add(task)
    void task.then(() => pending.delete(task), () => pending.delete(task))
    return task
  }
  const retire = (assembly: Assembly): void => { if (assembly.retired) return; assembly.retired = true; assemblies.delete(assembly); assembly.lifetime.stop(); assembly.reconciler?.dispose() }
  const stop = (): void => { stopDeadline ??= options.owner?.stop() ?? Date.now() + 1000; closed = true; watches.abort(); for (const close of streams) void close(); io?.stop(); for (const assembly of assemblies) retire(assembly) }
  const lease = <T>(assembly: Assembly, work: () => Promise<T>): Promise<T> => {
    const task = Promise.resolve().then(work); assembly.leases.add(task)
    void task.finally(() => assembly.leases.delete(task)).catch(() => undefined)
    return track(task)
  }
  const readFor = async <T>(load: (assembly: Assembly) => Promise<T>, check?: (assembly: Assembly) => void): Promise<T> => {
    for (;;) {
      while (barrier) await barrier
      if (closed) throw new Error('host 已关闭')
      const assembly = current, version = epoch
      check?.(assembly)
      const result = await lease(assembly, () => load(assembly))
      if (version === epoch && assembly === current) return result
    }
  }
  /** unary 用：同 workspace 的 epoch 变化重试，跨 workspace 以固定文案中止。 */
  const readAdmitted = <T>(admitted: WorkspaceId | undefined, load: (assembly: Assembly) => Promise<T>): Promise<T> =>
    readFor(load, (assembly) => { if (assembly.workspaceId !== admitted) throw new Error(WORKSPACE_SWITCHED) })
  const baselineOf = async (assembly: Assembly) => {
    const snapshot = await assembly.controller.baseline()
    if (!activationError) return snapshot
    const stale = { freshness: 'degraded' as const, reason: activationError.code }
    return { ...snapshot, source: { ...snapshot.source, ...stale }, entities: snapshot.entities.map((entity) => ({ ...entity, source: { ...entity.source, ...stale } })) }
  }
  const source = { baseline: () => readFor(baselineOf) }

  const dispose = (deadline = stopDeadline ?? options.owner?.stop() ?? Date.now() + 1000): Promise<void> => disposal ??= (async () => {
    stop()
    try {
      if (!await drainUntil([...pending], deadline)) diagnoseShutdown('shutdownDeadlineExceeded')
      storage?.close()
    } catch (error) { diagnoseShutdown('shutdownFailed', error); throw error }
    finally {
      options.owner?.signal.removeEventListener('abort', abortStartup)
      prepared.lease?.signal.removeEventListener('abort', abortLease)
      try { log.close() } finally { await prepared.lease?.dispose(deadline) }
    }
  })()
  const abortStartup = () => { void dispose().catch((error) => diagnoseShutdown('shutdownFailed', error)) }
  const abortLease = () => {
    if (options.owner) options.owner.stop(prepared.lease?.signal.reason)
    else void dispose().catch((error) => diagnoseShutdown('shutdownFailed', error))
  }
  options.owner?.signal.addEventListener('abort', abortStartup, { once: true })
  prepared.lease?.signal.addEventListener('abort', abortLease, { once: true })
  const diagnostics = { syncRoundFailed: (error: unknown) => log.write('syncRoundFailed', describeError(error)) }
  try {
    options.owner?.signal.throwIfAborted()
    prepared.lease?.signal.throwIfAborted()
    storage = createSqliteStorage(options.dataPath, hostStoragePolicy(options.catalog), options.migrationsDir === undefined ? {} : { migrationsDir: options.migrationsDir })
    const setup = createSetupCommands(createWorkspaceSetup(storage))
    const connection = createConnectionCommands(setup, {
      resolveAccount: async () => {
        const viewer = await githubViewer(fetch, () => resolveCredential(HOST_SECRET_HANDLES[0]))
        return viewer.ok ? { ok: true, value: { platformFamily: 'github', platformOrigin: 'https://github.com', identityKind: 'account', externalId: viewer.value.nodeId, displayName: viewer.value.login, secretHandle: HOST_SECRET_HANDLES[0] } } : viewer
      },
      verifyProject: (input) => preflightPlanningConnection(storage!, input.accountId, input.configuration.projectNodeId, fetch, resolveCredential),
    })
    const fingerprint = async (workspaceId?: WorkspaceId) => workspaceId === undefined ? JSON.stringify([undefined, undefined, []]) : JSON.stringify([await storage!.getWorkspacePlanningMapping(workspaceId), await storage!.getWorkspace(workspaceId), await Promise.all((await storage!.listProviderBindings(workspaceId)).map(async (mount) => {
      const accountId = await storage!.getProviderBindingAccount(mount.id)
      const configuration = options.catalog.has(mount.implementationKey) ? await storage!.getBindingConfiguration({ workspaceId, bindingId: mount.id, domain: mount.domain }) : undefined
      return [[mount.id, mount.domain, mount.implementationKey, mount.enabled], configuration, accountId === undefined ? undefined : await storage!.getConnectorAccount(accountId)]
    }))])
    const assemble = async (workspaceId: WorkspaceId | undefined, ci?: { observation: CiReadObservation; bindingId: import('@harness-projects/domain').ProviderBindingId }): Promise<Assembly> => {
      const workspace = workspaceId === undefined ? undefined : await storage!.getWorkspace(workspaceId)
      if (workspace !== undefined && workspace.statusPolicy !== StatusPolicy.ProviderAuthoritative) throw new HostPolicyAdmissionError()
      if (closed) throw new Error('host 已关闭')
      io ??= createPlanningLifetime(options.planningReadTimeoutMs)
      const lifetime = createPlanningLifetime(options.planningReadTimeoutMs)
      const assembly: Assembly = { controller: undefined!, targetError: undefined!, disabled: [], lifetime, leases: new Set(), cache: new Map(developmentCache), executionMode: 'manual', workspaceId, generation: '' }
      assemblies.add(assembly)
      try {
        const { table, disabled } = workspace === undefined ? { table: {} as CoreProviderTable, disabled: [] as readonly DisabledBinding[] } : await restoreProviders(storage!, workspace.id, options.catalog, {
          // 解析失败（例如宿主凭据服务缺席）只留允许名单字段；provider 随后把它归类为结构化 unavailable，不带原文。
          ...(ci ? { ci } : {}),
          sessionController: () => { lifetime.assertActive(); return options.sessionController?.() },
          lifetime,
          forceSessionStartFailure: options.forceSessionStartFailure,
          resolveCredential: async (handle) => {
            lifetime.assertActive()
            try { const value = await io!.wait(() => options.resolveCredential(handle), Infinity); lifetime.assertActive(); return value }
            catch (error) { log.write('credentialFailed', describeError(error)); throw error }
          },
          development: { cache: assembly.cache, resolveCredential, fetch },
          worktreesDir, fetch, privateLease: prepared.lease,
        })
        for (const item of disabled) log.write('bindingDisabled', { bindingId: item.bindingId, domain: item.domain, implementationKey: item.implementationKey, code: item.error.code })
        const providers = { ...table,
          ...(table.planning === undefined ? {} : { planning: lifetime.wrap(table.planning, track, 'planning') }),
          ...(table.development === undefined ? {} : { development: [table.development].flat().map((port) => lifetime.wrap(port, track)) }),
          ...(table.delivery === undefined ? {} : { delivery: lifetime.wrap(table.delivery, track) }),
          ...(table.execution === undefined ? {} : { execution: lifetime.wrap(table.execution, track) }),
          ...(table.executionFallback === undefined ? {} : { executionFallback: lifetime.wrap(table.executionFallback, track) }), storage: storage! }
        const mapping = workspace === undefined ? {} : await loadPlanningMapping(storage!, workspace.id, providers.planning, (event) => log.write(event, {}))
        if (workspace !== undefined) assembly.mapping = createHostPlanningMapping(storage!, workspace.id, providers.planning)
        lifetime.assertActive()
        // 空数据根：不向 Core 传 storage，不写任何行；工作区的创建属于挂载写者（#127、#131）。
        const core: CoreApi = workspace === undefined ? unavailableCore('工作区尚未创建') : await composeCore({
          workspace: { id: workspace.id, name: workspace.name, statusPolicy: workspace.statusPolicy, ...mapping },
          providers, diagnostics,
        })
        const controller = createController(core)
        assembly.controller = controller; assembly.targetError = core.queries.getStartWorkTargetError; assembly.disabled = disabled
        const start = (await controller.baseline()).capabilities.find((entry) => entry.key === 'execution.run.start')
        assembly.executionMode = table.execution?.definition.implementationKey === 'execution.harness' && ['available', 'degraded'].includes(start?.access ?? '') ? 'harness' : 'manual'
        if (table.planning !== undefined) {
          assembly.reconciler = createPlanningReconciler(async () => { while (barrier) await barrier; lifetime.assertActive(); return lease(assembly, () => core.commands.refreshPlanning()) }, {
            intervalMs, diagnostics, ...(options.planningTimers === undefined ? {} : { timers: options.planningTimers }),
          })
        }
        assembly.generation = (await controller.baseline()).generation
        return assembly
      } catch (error) { retire(assembly); throw error }
    }
    // 启动选择：显式初始目标 > 唯一已存工作区 > 唯一受支持工作区（存在不支持策略的遗留行时仍打开唯一可用项目）> 空装配（Home）。
    const stored = await storage!.listWorkspaces(), supported = stored.filter((row) => row.statusPolicy === StatusPolicy.ProviderAuthoritative)
    current = await assemble(options.workspaceId ?? (stored.length === 1 ? stored[0]!.id : supported.length === 1 ? supported[0]!.id : undefined))
    io!.assertActive(); developmentCache = current.cache; activeFingerprint = await fingerprint(current.workspaceId); io!.assertActive(); current.reconciler?.start()
    const serialize = <T>(work: (old: Assembly) => Promise<T>): Promise<T> => {
      const task = tail.then(async () => {
        if (closed) throw new Error('host 已关闭')
        let release!: () => void; barrier = new Promise<void>((resolve) => { release = resolve }); epoch++
        const old = current
        try {
          await Promise.allSettled([...old.leases])
          if (closed) throw new Error('host 已关闭')
          return await work(old)
        } finally {
          if (!closed) try { current.reconciler?.start() } catch (error) { log.write('schedulerResumeFailed', describeError(error)) }
          barrier = undefined; release()
        }
      })
      tail = task.catch(() => undefined); return track(task)
    }
    const activate = async (target: WorkspaceId, old: Assembly, desired: string, ci?: { observation: CiReadObservation; current(): Promise<boolean>; isCurrent(): boolean; bindingId: import('@harness-projects/domain').ProviderBindingId | undefined }): Promise<void> => {
      if (ci === undefined && desired === activeFingerprint && current.workspaceId === target) return
      old.reconciler?.stop()
      if (ci && !await ci.current()) throw new Error('仓库验证已失效')
      const candidate = await assemble(target, ci?.bindingId ? { observation: ci.observation, bindingId: ci.bindingId } : undefined)
      try {
        if (ci && (!await ci.current() || await fingerprint(target) !== desired)) throw new Error('仓库验证已失效')
        const activatedFingerprint = await fingerprint(target)
        if (ci && !ci.isCurrent()) throw new Error('仓库验证已失效')
        candidate.reconciler?.start()
        current = candidate; developmentCache = candidate.cache; activeFingerprint = activatedFingerprint; repositoryValidation++; retire(old)
      } catch (error) { retire(candidate); throw error }
    }
    const configure = <T>(workspaceId: WorkspaceId, run: () => Promise<CommandResult<T>>, acknowledge?: (generation: string) => void, activateAssembly = true, confirmPlanning = false, ci?: { observation: CiReadObservation; current(): Promise<boolean>; isCurrent(): boolean; bindingId: import('@harness-projects/domain').ProviderBindingId | undefined }, allowSwitch = false): Promise<CommandResult<T> & { activationError?: ProjectError }> => serialize(async (old) => {
      // 切换窗口内到达的设置写属于已退出的旧作用域：直接作用域拒绝，不写库、不装配、不写全局 activationError（#691）。
      if (!allowSwitch && workspaceId !== MISSING_WORKSPACE && current.workspaceId !== workspaceId) return { writeState: 'conflict' as const, saving: false, authoritative: false, value: undefined, error: projectError(ProjectErrorCode.Conflict, WORKSPACE_SWITCHED) }
      const result = await run()
      if (result.writeState === 'local_only' && activateAssembly) {
        try {
          await activate(workspaceId, old, await fingerprint(workspaceId), ci)
          activationError = undefined
        } catch (error) {
          log.write('activationFailed', describeError(error))
          const unsupportedPolicy = error instanceof HostPolicyAdmissionError
          if (unsupportedPolicy) stop()
          // create-and-switch（allowSwitch）的候选装配只属于本次创建：失败写全局 activationError 会把
          // 仍是当前项目的 A 的 baseline/setup 标成 degraded。这里只把错误交给本次命令结果，全局保持
          // undefined；同作用域设置写（allowSwitch=false）仍保留原有的全局降级语义（#692 验收 P2-3）。
          const failure = projectError(ProjectErrorCode.Unavailable, unsupportedPolicy ? '本地配置已提交，当前 Host 已停止'
            : allowSwitch ? '新项目已创建，但装配尚未激活' : '本地配置已提交，装配尚未激活')
          if (!allowSwitch) activationError = failure
          return { ...result, activationError: failure }
        }
      }
      if (confirmPlanning && result.writeState === 'local_only' && old === current && !activationError) await current.controller.commands.refreshPlanning({ actorRef: { kind: 'user' } })
      if (result.writeState === 'local_only' && activateAssembly && !activationError) acknowledge?.(current.generation)
      return result
    })
    const openWorkspace = (target: WorkspaceId, acknowledge?: (generation: string) => void) => serialize(async (old) => {
      if (await storage!.getWorkspace(target) === undefined) return { state: 'failed' as const, error: projectError(ProjectErrorCode.NotFound, '项目不存在，请重新读取') }
      try {
        await activate(target, old, await fingerprint(target))
        activationError = undefined
        acknowledge?.(current.generation)
        return { state: 'activated' as const }
      } catch (error) {
        log.write('transitionFailed', describeError(error))
        return { state: 'failed' as const, error: error instanceof HostPolicyAdmissionError ? projectError(ProjectErrorCode.NotSupported, OPEN_NOT_SUPPORTED) : projectError(ProjectErrorCode.Unavailable, OPEN_UNAVAILABLE) }
      }
    })
    const getWorkspaceSetup = async (assembly: Assembly): Promise<WorkspaceSetupDTO> => {
      let workspace: WorkspaceSetupDTO['workspace'] = null, bindingId: string | undefined, projectNodeId: string | undefined
      let activation: Pick<WorkspaceSetupDTO, 'activationError' | 'executionInstalled'> = activationError === undefined ? {} : { activationError: projectError(activationError.code, '本地配置已提交，装配尚未激活') }
      const failure = (reason?: string) => projectError(Object.values(ProjectErrorCode).some((code) => code === reason) ? reason as ProjectErrorCode : ProjectErrorCode.Unavailable, '规划项目尚未确认，请按恢复动作重试')
      try {
        const stored = assembly.workspaceId === undefined ? undefined : await storage!.getWorkspace(assembly.workspaceId)
        workspace = stored === undefined ? null : { id: stored.id, name: stored.name }
        if (stored === undefined) return { workspace, planning: { state: 'unbound' }, ...activation }
        const bindings = await storage!.listProviderBindings(stored.id)
        const executions = bindings.filter((mount) => mount.domain === 'execution')
        const active = await fingerprint(stored.id) === activeFingerprint
        if (!activationError && active && assembly.executionMode === 'harness' && !assembly.disabled.some((mount) => mount.domain === 'execution')
          && executions.length === 2 && executions.some((mount) => mount.isDefault) && executions.some((mount) => !mount.isDefault)
          && executions.every((mount) => mount.enabled && mount.implementationKey === (mount.isDefault ? 'execution.harness' : 'execution.human'))) activation = { ...activation, executionInstalled: true }
        const mount = bindings.find((mount) => mount.enabled && mount.domain === 'planning')
        if (mount === undefined) return { workspace, planning: { state: 'unbound' }, ...activation }
        bindingId = mount.id
        const configuration = await storage!.getBindingConfiguration({ workspaceId: stored.id, bindingId: mount.id, domain: 'planning' })
        const target = configuration?.configuration.projectNodeId
        if (typeof target === 'string' && target !== '') projectNodeId = target
        const mapping = await storage!.getWorkspacePlanningMapping(stored.id)
        const mappingOrigin = mapping?.bindingId === bindingId && mapping.projectExternalId === projectNodeId ? mapping.origin : undefined
        const snapshot = active ? await assembly.controller.baseline() : undefined
        const state = !active ? 'configured' : projectNodeId !== undefined && snapshot?.source.freshness === 'fresh' ? 'confirmed' : 'degraded'
        return { workspace, planning: { state, bindingId, ...(projectNodeId === undefined ? {} : { projectNodeId }) }, ...activation,
          ...(mappingOrigin === undefined ? {} : { mappingOrigin }), ...(state === 'degraded' ? { error: failure(snapshot?.source.reason) } : {}) }
      } catch (error) {
        log.write('setupReadFailed', describeError(error))
        return { workspace, planning: workspace === null ? { state: 'unbound' } : { state: 'degraded', ...(bindingId === undefined ? {} : { bindingId }), ...(projectNodeId === undefined ? {} : { projectNodeId }) }, ...activation, error: failure() }
      }
    }
    const planningMappingOf = async (assembly: Assembly) => {
      if (assembly.mapping === undefined || assembly.workspaceId === undefined) throw new Error('规划来源尚未配置')
      return { ...await assembly.mapping.load(), confirmed: await fingerprint(assembly.workspaceId) === activeFingerprint && (await assembly.controller.baseline()).source.freshness === 'fresh' }
    }
    const dispatchFor = (assembly: Assembly, acknowledge?: (generation: string) => void): Dispatch => {
      const workspaceId = assembly.workspaceId ?? MISSING_WORKSPACE
      return dispatchOf<typeof OPERATIONS, Controller>(OPERATIONS, {
        ...handlersFor({ workspaceId, executionMode: assembly.executionMode, targetError: assembly.targetError }),
        baseline: () => baselineOf(assembly),
        getWorkspaceSetup: () => getWorkspaceSetup(assembly),
        getPlanningMapping: () => planningMappingOf(assembly),
        listWorkspaces: async () => {
          const workspaces = await storage!.listWorkspaces()
          return { activeWorkspaceId: current.workspaceId ?? null, workspaces: await Promise.all(workspaces.map(async (row) => ({
            workspaceId: row.id, name: row.name,
            planning: (await storage!.listProviderBindings(row.id)).some((mount) => mount.enabled && mount.domain === 'planning') ? 'bound' : 'none',
            policy: row.statusPolicy === StatusPolicy.ProviderAuthoritative ? 'supported' : 'unsupported',
          }))) }
        },
        openWorkspace: async (_controller, input) => {
          const target = input.workspaceId as WorkspaceId, result = await openWorkspace(target, acknowledge)
          return { ...result, requestedWorkspaceId: target, ...(result.state === 'activated' ? { activeWorkspaceId: target } : current.workspaceId === undefined ? {} : { activeWorkspaceId: current.workspaceId }) }
        },
        setPlanningMapping: (_controller, input) => configure(workspaceId, async () => {
          const error = await assembly.mapping!.validate(input.expectedBindingId, input.expectedProjectExternalId, input.mapping)
          return error ? { writeState: error.code === 'conflict' ? 'conflict' : 'failed', saving: false, authoritative: false, value: undefined, error } : setup.setPlanningMapping({ ...input, workspaceId })
        }, acknowledge, true, true),
        // 目标只由 wire 意图键派生；显式初始目标优先。确认 generation 仍属于本次串行激活。
        createWorkspace: (_controller, input) => {
          const target = options.workspaceId ?? newWorkspaceIdForCreateIntent(input.idempotencyKey)
          return configure(target, () => setup.createWorkspace({ ...input, workspaceId: target, statusPolicy: StatusPolicy.ProviderAuthoritative }), acknowledge, true, false, undefined, true)
        },
        connectAccount: (_controller, input) => configure(workspaceId, () => connection.connectAccount(input), acknowledge, false),
        bindPlanningSource: (_controller, { projectNodeId, accountId, ...input }) => configure(workspaceId, () => connection.bindPlanningSource({ ...input, accountId: accountId as ConnectorAccountId, workspaceId, implementationKey: 'planning.github-projects', configuration: { projectNodeId } }), acknowledge),
        installExecutionBindings: (_controller, input) => configure(workspaceId, () => setup.installExecutionBindings({ ...input, workspaceId }), acknowledge),
        bindRepository: async (_controller, input) => {
          const sequence = ++repositoryValidation, before = await fingerprint(workspaceId)
          const checked = await io!.wait(() => preflightRepositoryBinding({ ...input, references: input.references.map((ref) => ({ ...ref, accountId: ref.accountId as ConnectorAccountId | undefined })), workspaceId }, storage!, options.catalog, { sequence, worktreesDir, fetch, resolveCredential }), Infinity)
          if ('writeState' in checked) return checked
          const accountId = checked.input.references.find(ref => ref.implementationKey === 'github-actions')!.accountId!
          const ci = { observation: checked.ci, bindingId: undefined as import('@harness-projects/domain').ProviderBindingId | undefined,
            isCurrent: () => !closed && checked.ci.sequence === repositoryValidation,
            current: async () => ci.isCurrent() && ciAccountStamp(await storage!.getConnectorAccount(accountId)) === checked.ci.accountStamp
              && await repositoryHead(checked.input.references.find(ref => ref.implementationKey === 'development.local-git')!.configuration!.repositoryPath as string) === checked.ci.commit && ci.isCurrent() }
          return configure(workspaceId, async () => {
            if (!await ci.current() || await fingerprint(workspaceId) !== before) return { writeState: 'failed' as const, saving: false, authoritative: false, value: undefined, error: projectError(ProjectErrorCode.Conflict, '仓库验证已失效，请重新验证') }
            const result = await setup.bindRepository(checked.input)
            ci.bindingId = result.value?.bindingIds[checked.input.references.findIndex(ref => ref.implementationKey === 'github-actions')]
            return result
          }, acknowledge, true, false, ci)
        },
      }, guarded)
    }
    // 启动期中止自行回收；交付后由 Host 先撤 remote、写 shutdown 诊断，再 dispose 关闭日志。
    options.owner?.signal.removeEventListener('abort', abortStartup)
    return {
      get controller() { return current.controller }, get disabled() { return current.disabled }, get activationError() { return activationError },
      currentGeneration: () => current.generation,
      call: async (name, input, acknowledge) => {
        if (closed) throw new Error('host 已关闭')
        const admitted = current, scope = (OPERATIONS[name] as { readonly scope?: 'host' | 'transition' }).scope
        const dispatch = (assembly: Assembly) => (acknowledge ? dispatchFor(assembly, acknowledge) : assembly.dispatch ??= dispatchFor(assembly))(assembly.controller, name, input)
        // host / transition 作用域同步捕获准入装配（切换在 handler 内串行）；其余 unary 读走准入重试。
        if (scope !== undefined || SETTINGS_OPERATIONS.has(name)) return track(dispatch(admitted))
        const result = await readAdmitted(admitted.workspaceId, (assembly) => dispatch(assembly))
        if (READ_AFTER_STOP.has(name) && (closed || admitted !== current)) throw new Error('host 读取已失效')
        return result
      },
      watch: (signal) => {
        if (closed) throw new Error('host 已关闭')
        return { [Symbol.asyncIterator]: () => {
          const combined = AbortSignal.any([signal, watches.signal])
          let frames: ReturnType<typeof streamWorkspace> | undefined, closing = false
          let cleanup: Promise<void> | undefined
          const close = (): Promise<void> => {
            closing = true
            if (!cleanup) {
              let task: Promise<unknown>
              try { task = Promise.resolve(frames?.return()) } catch (error) { task = Promise.reject(error) }
              cleanup = track(task.catch((error) => diagnoseShutdown('shutdownFailed', error)).then(() => {
                streams.delete(close)
                combined.removeEventListener('abort', abort)
              }))
            }
            return cleanup
          }
          const abort = (): void => { void close() }
          return {
            next: async () => {
              if (closed || combined.aborted || closing) return { done: true as const, value: undefined }
              if (!frames) {
                frames = streamWorkspace(source, { signal: combined, intervalMs: options.watchIntervalMs ?? 1000 })
                streams.add(close)
                combined.addEventListener('abort', abort, { once: true })
              }
              try {
                const result = await track(guarded(() => frames!.next()))
                if (closed || combined.aborted || closing) return { done: true as const, value: undefined }
                if (result.done) await close()
                return result
              } catch (error) { await close(); throw error }
            },
            return: async () => { await close(); return { done: true as const, value: undefined } },
            throw: async (error: unknown) => { await close(); throw error },
          }
        } }
      },
      stop, dispose, diagnoseShutdown,
    }
  } catch (error) { await dispose(options.owner?.stop(error)); throw error }
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
