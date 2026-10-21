/**
 * 类型化命令 API（issue #79 / ExecPlan D3）：除两条刷新命令（`refreshPlanning`、`refreshDeliveryFacts`）外，每条命令都带 actorRef 与 idempotencyKey，返回写状态；刷新天然幂等，只带 actorRef，不带键、不进账本（#222、#334）。
 *
 * wire 层刻意没有 `saved`：只有 provider ack / read-after-write 证据才叫 confirmed，reconcile 找回同值
 * 才叫 reconciled，只落了本地控制事实（外部写入未确认，或规划本来由宿主权威）才叫 local_only。调用方
 * 因此不可能把一个尚未确认的外部写入显示成"已保存"。
 *
 * 同键重放（Planning / Delivery 刷新除外）由控制器实例内的账本兜住（startWork 另有 core 的持久写账本）。跨重启的持久账本属 Storage，
 * 受 Gate E1 约束，本切片不落库——这里不假装它是持久的。
 */
import { ProjectErrorCode, projectError } from '@harness-projects/capabilities'
import type { ExternalObjectRef, ProjectError } from '@harness-projects/capabilities'
import type { ConnectorAccountId, EntityId, NormalizedStatus, ProviderBindingId, WorkspaceId } from '@harness-projects/domain'
import {
  WritePhase,
  type BindPlanningSourceRequest, type BootstrapResult, type ConnectAccountRequest, type CoreApi, type CreateWorkspaceRequest, type DeliveryRefreshResult,
  type DeliveryScope, type DeliveryWriteAttempt, type RecordedEdge, type RelationRef, type SetupOutcome, type StartWorkResult, type StatusDecision,
  type WorkspaceSetup,
} from '@harness-projects/core'

export const CommandWriteState = {
  Confirmed: 'confirmed',
  Reconciled: 'reconciled',
  LocalOnly: 'local_only',
  Pending: 'pending',
  Unknown: 'unknown',
  Conflict: 'conflict',
  Failed: 'failed',
} as const
export type CommandWriteState = (typeof CommandWriteState)[keyof typeof CommandWriteState]

/** 唯一允许当作权威结果的写状态；`saved` 不在取值集合里，乐观"已保存"在类型上不可表达。 */
export function isAuthoritativeWriteState(state: CommandWriteState): boolean {
  return state === CommandWriteState.Confirmed || state === CommandWriteState.Reconciled
}

/** 发起方引用：命令必须声明"谁"发起，写入审计才有主体。 */
export interface ActorRef {
  readonly kind: string
  readonly id?: string
}

/** 幂等信封：同键重放返回首次尝试的结果，不产生第二次外部写入。 */
export interface CommandEnvelope {
  readonly actorRef: ActorRef
  readonly idempotencyKey: string
}

export interface CommandResult<T> {
  readonly writeState: CommandWriteState
  readonly saving: boolean
  readonly authoritative: boolean
  readonly value: T | undefined
  readonly error: ProjectError | undefined
}

function resultOf<T>(writeState: CommandWriteState, value: T | undefined, error: ProjectError | undefined): CommandResult<T> {
  return {
    writeState,
    saving: writeState === CommandWriteState.Pending,
    authoritative: isAuthoritativeWriteState(writeState),
    value, error,
  }
}

export interface StartWorkView {
  readonly executionContextId: string | undefined
  readonly status: string | undefined
  readonly branchExternalId: string | undefined
  readonly worktreeExternalId: string | undefined
  /** 实际落地的分支头提交（新建时是起点，接管既有分支时是读到的头），只做报告；同键重放拿不到（记录没有这一列）。 */
  readonly branchHeadCommit: string | undefined
  readonly fallback: string | undefined
  readonly degraded: boolean
  /** 已 ack 的 run 句柄：Unknown 结果面靠它对账（TD-013）。 */
  readonly runExternalId: string | undefined
}

export interface StartWorkCommandInput extends CommandEnvelope {
  readonly workItemId: string
  readonly repositoryId: string
  readonly branchName?: string
  readonly worktreePath?: string
}

export interface PlanningStatusInput extends CommandEnvelope {
  readonly entityId: EntityId
  readonly status: NormalizedStatus
}

/** 补偿序列的阶段 → wire 写状态；failed 但本地上下文已落库时如实报 local_only，不假装 saved。 */
export function stateForStartWork(result: StartWorkResult): CommandWriteState {
  if (result.phase === WritePhase.Confirmed) return CommandWriteState.Confirmed
  if (result.phase === WritePhase.Reconciled) return CommandWriteState.Reconciled
  if (result.phase === WritePhase.Unknown) return CommandWriteState.Unknown
  if (result.phase === WritePhase.Conflict) return CommandWriteState.Conflict
  if (result.phase !== WritePhase.Failed) return CommandWriteState.Pending
  return result.executionContextId === undefined ? CommandWriteState.Failed : CommandWriteState.LocalOnly
}

function toStartWorkView(result: StartWorkResult): StartWorkView {
  return {
    executionContextId: result.executionContextId,
    status: result.status,
    branchExternalId: result.branchExternalId,
    worktreeExternalId: result.worktreeExternalId,
    branchHeadCommit: result.branchHeadCommit,
    fallback: result.fallback,
    degraded: result.degraded,
    runExternalId: result.runExternalId,
  }
}

async function runStartWork(core: CoreApi, input: StartWorkCommandInput): Promise<CommandResult<StartWorkView>> {
  const result = await core.commands.startWork({
    workItemId: input.workItemId,
    repositoryId: input.repositoryId,
    actor: { kind: input.actorRef.kind, ...(input.actorRef.id === undefined ? {} : { id: input.actorRef.id }) },
    idempotencyKey: input.idempotencyKey,
    ...(input.branchName === undefined ? {} : { branchName: input.branchName }),
    ...(input.worktreePath === undefined ? {} : { worktreePath: input.worktreePath }),
  })
  return resultOf(stateForStartWork(result), toStartWorkView(result), result.error)
}

async function runConfirmRelation(core: CoreApi, ref: RelationRef): Promise<CommandResult<RecordedEdge>> {
  const edge = await core.commands.confirmRelation(ref)
  if (edge !== undefined) return resultOf<RecordedEdge>(CommandWriteState.LocalOnly, edge, undefined)
  return resultOf<RecordedEdge>(
    CommandWriteState.Failed, undefined,
    projectError(ProjectErrorCode.NotFound, '候选边不存在，确认未产生任何关系'),
  )
}

export interface ControllerCommands {
  /** 生命周期命令：引导只做本地水合，没有外部写入，因此报 local_only。 */
  bootstrapWorkspace(envelope: CommandEnvelope): Promise<CommandResult<BootstrapResult>>
  /** 显式 Planning 刷新：每次都真实读取，不使用幂等重放账本。 */
  refreshPlanning(request: Pick<CommandEnvelope, 'actorRef'>): Promise<CommandResult<BootstrapResult>>
  startWork(input: StartWorkCommandInput): Promise<CommandResult<StartWorkView>>
  /** 规划状态的唯一显式写入命令；宿主/人工权威下写的是本地权威值，provider 权威下被拒绝。 */
  applyPlanningStatus(input: PlanningStatusInput): Promise<CommandResult<StatusDecision>>
  /** 显式确认候选边：唯一把 candidate 变成 confirmed 的入口；边不存在时不造关系。 */
  confirmRelation(ref: RelationRef, envelope: CommandEnvelope): Promise<CommandResult<RecordedEdge>>
  rerunPipeline(ref: ExternalObjectRef, envelope: CommandEnvelope): Promise<CommandResult<DeliveryWriteAttempt>>
  /**
   * 交付事实的显式刷新（#222）：只写本地已确认事实，没有外部写入，因此成功报 local_only，不是权威确认。
   * `local_only` 只说明没有外部写入、本地没有失败；这次是否真的提交了新事实看 `value.applied` / `anchored` / `gaps`
   * （没开始工作的工作项、没有锚点、provider 离线时都是 `local_only`，但 `applied` 为 false 或 `gaps` 非空）。
   * 天然幂等：没有外部写入，重复调用会重新读取，不重放，所以不进重放账本、不带幂等键；`actorRef` 只是发起方。UI 以重读后的投影为准，不以这个结果为准。
   */
  refreshDeliveryFacts(scope: DeliveryScope, request: Pick<CommandEnvelope, 'actorRef'>): Promise<CommandResult<DeliveryRefreshResult>>
}

type ReplayEntry = { readonly fingerprint: string; readonly result: CommandResult<unknown> }
type InFlightEntry = { readonly fingerprint: string; readonly promise: Promise<CommandResult<unknown>> }

function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === undefined) return 'u'
  if (value === null) return 'n'
  if (typeof value === 'string') return `s${value.length}:${value}`
  if (typeof value === 'boolean') return value ? 'b1' : 'b0'
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'd:NaN'
    if (Object.is(value, -0)) return 'd:-0'
    if (value === Infinity) return 'd:+Inf'
    if (value === -Infinity) return 'd:-Inf'
    return `d:${value}`
  }
  if (typeof value !== 'object') throw new TypeError('请求身份含不支持的值')
  if (seen.has(value)) throw new TypeError('请求身份不能含循环引用')
  seen.add(value)
  try {
    if (Array.isArray(value)) return `a${value.length}[${value.map((item) => canonical(item, seen)).join('|')}]`
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('请求身份只接受普通对象')
    const keys = Object.keys(value).sort()
    return `o${keys.length}{${keys.map((key) => `${canonical(key)}=${canonical((value as Record<string, unknown>)[key], seen)}`).join('|')}}`
  } finally {
    seen.delete(value)
  }
}

function requestPayload<T extends CommandEnvelope>(input: T): Omit<T, keyof CommandEnvelope> {
  const { actorRef: _actorRef, idempotencyKey: _idempotencyKey, ...payload } = input
  return payload
}

/** 控制器实例内的重放账本：键含命令名，另以完整请求指纹拒绝同键异请求。 */
function createReplayLog() {
  const entries = new Map<string, ReplayEntry>()
  const inFlight = new Map<string, InFlightEntry>()
  const liveStartWork = (commandName: string, result: CommandResult<unknown>): boolean =>
    commandName === 'startWork' && (result.writeState === CommandWriteState.Pending || result.writeState === CommandWriteState.Unknown)
  return async function replay<T>(
    commandName: string, envelope: CommandEnvelope, request: unknown, run: () => Promise<CommandResult<T>>,
  ): Promise<CommandResult<T>> {
    const key = `${commandName}:${envelope.idempotencyKey}`
    let fingerprint: string
    try {
      fingerprint = canonical({ version: 1, commandName, actorRef: envelope.actorRef, request })
    } catch (error) {
      return resultOf<T>(CommandWriteState.Failed, undefined, projectError(ProjectErrorCode.InvalidInput, error instanceof Error ? error.message : '请求身份不合法'))
    }
    const cached = entries.get(key)
    if (cached !== undefined && cached.fingerprint !== fingerprint) {
      return resultOf<T>(CommandWriteState.Conflict, undefined, projectError(ProjectErrorCode.Conflict, '幂等键已绑定另一个完整请求'))
    }
    if (cached !== undefined) return cached.result as CommandResult<T>
    const active = inFlight.get(key)
    if (active !== undefined) {
      if (active.fingerprint !== fingerprint) {
        return resultOf<T>(CommandWriteState.Conflict, undefined, projectError(ProjectErrorCode.Conflict, '幂等键已绑定另一个完整请求'))
      }
      return await active.promise as CommandResult<T>
    }
    let task: Promise<CommandResult<unknown>>
    task = Promise.resolve().then(run).then((result) => {
      if (!liveStartWork(commandName, result)) entries.set(key, { fingerprint, result })
      return result
    }).finally(() => {
      if (inFlight.get(key)?.promise === task) inFlight.delete(key)
    })
    inFlight.set(key, { fingerprint, promise: task })
    return await task as CommandResult<T>
  }
}

export function createControllerCommands(core: CoreApi): ControllerCommands {
  const replay = createReplayLog()
  return {
    bootstrapWorkspace: (envelope) => replay('bootstrapWorkspace', envelope, null, async () => {
      const result = await core.commands.bootstrapWorkspace()
      return resultOf(result.ok ? CommandWriteState.LocalOnly : CommandWriteState.Failed, result, result.error)
    }),

    refreshPlanning: async (_request) => {
      const result = await core.commands.refreshPlanning()
      return resultOf(result.ok ? CommandWriteState.LocalOnly : CommandWriteState.Failed, result, result.error)
    },

    startWork: (input) => replay('startWork', input, requestPayload(input), () => runStartWork(core, input)),

    applyPlanningStatus: (input) => replay('applyPlanningStatus', input, requestPayload(input), async () => {
      const decision = await core.commands.applyPlanningStatus({ entityId: input.entityId, status: input.status })
      if (decision.error !== undefined) return resultOf(CommandWriteState.Failed, decision, decision.error)
      return resultOf(CommandWriteState.LocalOnly, decision, undefined)
    }),

    confirmRelation: (ref, envelope) => replay('confirmRelation', envelope, ref, () => runConfirmRelation(core, ref)),

    rerunPipeline: (ref, envelope) => replay('rerunPipeline', envelope, ref, async () => {
      const attempt = await core.commands.rerunPipeline(ref)
      return resultOf(attempt.confirmed ? CommandWriteState.Confirmed : CommandWriteState.Failed, attempt, attempt.error)
    }),

    refreshDeliveryFacts: async (scope) => {
      const result = await core.commands.refreshDeliveryFacts(scope) // 不经 replay：每次调用都是一次真的读取
      return resultOf(result.ok ? CommandWriteState.LocalOnly : CommandWriteState.Failed, result, result.error)
    },
  }
}

export type CreateWorkspaceInput = CommandEnvelope & CreateWorkspaceRequest
export type ConnectAccountInput = CommandEnvelope & ConnectAccountRequest
export type BindPlanningSourceInput = CommandEnvelope & BindPlanningSourceRequest

/**
 * 工作区设置命令（#127）：独立于 `Controller`——工作区未创建时 Host 的 Controller 建在 unavailableCore 上；由 Host 每进程建一次、跨重组持有账本（#354）。
 * 账本只在本实例内（TD-070）：丢失后同键重发由 core 的命令按自然键找回同一结果、零写入。
 */
export interface SetupCommands {
  createWorkspace(input: CreateWorkspaceInput): Promise<CommandResult<{ readonly workspaceId: WorkspaceId }>>
  connectAccount(input: ConnectAccountInput): Promise<CommandResult<{ readonly accountId: ConnectorAccountId }>>
  bindPlanningSource(input: BindPlanningSourceInput): Promise<CommandResult<{ readonly bindingId: ProviderBindingId }>>
}

/** 设置命令只写本地事实：成功报 local_only（没有 provider ack，不是权威）；core 的 conflict 与账本内同键异请求同报 conflict，其余报 failed。不推进修订号（快照内容没变，ADR-0012）。 */
function setupResult<T>(outcome: SetupOutcome<T>): CommandResult<T> {
  if (outcome.ok) return resultOf(CommandWriteState.LocalOnly, outcome.value, undefined)
  return resultOf<T>(outcome.error.code === ProjectErrorCode.Conflict ? CommandWriteState.Conflict : CommandWriteState.Failed, undefined, outcome.error)
}

export function createSetupCommands(setup: WorkspaceSetup): SetupCommands {
  const replay = createReplayLog()
  return {
    createWorkspace: (input) => replay('createWorkspace', input, requestPayload(input), async () => setupResult(await setup.createWorkspace(requestPayload(input)))),
    connectAccount: (input) => replay('connectAccount', input, requestPayload(input), async () => setupResult(await setup.connectAccount(requestPayload(input)))),
    bindPlanningSource: (input) => replay('bindPlanningSource', input, requestPayload(input), async () => setupResult(await setup.bindPlanningSource(requestPayload(input)))),
  }
}
