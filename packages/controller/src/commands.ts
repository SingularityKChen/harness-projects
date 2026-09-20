/**
 * 类型化命令 API（issue #79 / ExecPlan D3）：每条命令都带 actorRef 与 idempotencyKey，返回写状态。
 *
 * wire 层刻意没有 `saved`：只有 provider ack / read-after-write 证据才叫 confirmed，reconcile 找回同值
 * 才叫 reconciled，只落了本地控制事实（外部写入未确认，或规划本来由宿主权威）才叫 local_only。调用方
 * 因此不可能把一个尚未确认的外部写入显示成"已保存"。
 *
 * 同键重放由控制器实例内的账本兜住（startWork 另有 core 的持久写账本）。跨重启的持久账本属 Storage，
 * 受 Gate E1 约束，本切片不落库——这里不假装它是持久的。
 */
import { ProjectErrorCode, projectError } from '@harness-projects/capabilities'
import type { ExternalObjectRef, ProjectError } from '@harness-projects/capabilities'
import type { EntityId, NormalizedStatus } from '@harness-projects/domain'
import {
  WritePhase,
  type BootstrapResult, type CoreApi, type DeliveryWriteAttempt, type RecordedEdge,
  type RelationRef, type StartWorkResult, type StatusDecision,
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
  readonly fallback: string | undefined
  readonly degraded: boolean
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
    fallback: result.fallback,
    degraded: result.degraded,
  }
}

async function runStartWork(core: CoreApi, input: StartWorkCommandInput): Promise<CommandResult<StartWorkView>> {
  const result = await core.commands.startWork({
    workItemId: input.workItemId,
    repositoryId: input.repositoryId,
    actor: { kind: input.actorRef.kind },
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
  startWork(input: StartWorkCommandInput): Promise<CommandResult<StartWorkView>>
  /** 规划状态的唯一显式写入命令；宿主/人工权威下写的是本地权威值，provider 权威下被拒绝。 */
  applyPlanningStatus(input: PlanningStatusInput): Promise<CommandResult<StatusDecision>>
  /** 显式确认候选边：唯一把 candidate 变成 confirmed 的入口；边不存在时不造关系。 */
  confirmRelation(ref: RelationRef, envelope: CommandEnvelope): Promise<CommandResult<RecordedEdge>>
  rerunPipeline(ref: ExternalObjectRef, envelope: CommandEnvelope): Promise<CommandResult<DeliveryWriteAttempt>>
}

/** 控制器实例内的重放账本：键含命令名，避免同名幂等键在不同命令间串结果。 */
function createReplayLog() {
  const entries = new Map<string, CommandResult<unknown>>()
  return async function replay<T>(
    commandName: string, envelope: CommandEnvelope, run: () => Promise<CommandResult<T>>,
  ): Promise<CommandResult<T>> {
    const key = `${commandName}:${envelope.idempotencyKey}`
    const cached = entries.get(key)
    if (cached !== undefined) return cached as CommandResult<T>
    const result = await run()
    entries.set(key, result)
    return result
  }
}

export function createControllerCommands(core: CoreApi): ControllerCommands {
  const replay = createReplayLog()
  return {
    bootstrapWorkspace: (envelope) => replay('bootstrapWorkspace', envelope, async () => {
      const result = await core.commands.bootstrapWorkspace()
      return resultOf(result.ok ? CommandWriteState.LocalOnly : CommandWriteState.Failed, result, result.error)
    }),

    startWork: (input) => replay('startWork', input, () => runStartWork(core, input)),

    applyPlanningStatus: (input) => replay('applyPlanningStatus', input, async () => {
      const decision = await core.commands.applyPlanningStatus({ entityId: input.entityId, status: input.status })
      if (decision.error !== undefined) return resultOf(CommandWriteState.Failed, decision, decision.error)
      return resultOf(CommandWriteState.LocalOnly, decision, undefined)
    }),

    confirmRelation: (ref, envelope) => replay('confirmRelation', envelope, () => runConfirmRelation(core, ref)),

    rerunPipeline: (ref, envelope) => replay('rerunPipeline', envelope, async () => {
      const attempt = await core.commands.rerunPipeline(ref)
      return resultOf(attempt.confirmed ? CommandWriteState.Confirmed : CommandWriteState.Failed, attempt, attempt.error)
    }),
  }
}
