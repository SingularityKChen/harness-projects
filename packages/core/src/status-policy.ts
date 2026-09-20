/**
 * 状态策略：三种策略下工程事实都不改写规划状态（ExecPlan D6 / AGENTS.md §1.1 不变量 3）。产品面的 `source_managed` /
 * `harness_managed` / `manual` 就是领域枚举的 `provider_authoritative` / `host_authoritative` / `manual_only`（domain 冻结
 * 取值），映射只在本文件出现一次。两个决策函数都是纯函数：工程事实（CI 失败 / 执行完成 / PR 合并）任何策略都返回原值、
 * `wrote` 恒为 false，incoming 状态只变成派生标记；显式状态写入命令是唯一允许改写规划状态的联动，仍受策略约束（provider 权威
 * 时拒绝）。落库只发生在 `writePlanningStatus`，也只由显式命令调用。
 */
import { ProjectErrorCode, projectError, type ProjectError } from '@harness-projects/capabilities'
import {
  NormalizedStatus, StatusChangeSource, StatusPolicy, derivedFlagsFor, reconcilePlanningStatus,
  type DerivedFlag, type EngineeringFact, type EntityId, type WorkspaceProjection,
} from '@harness-projects/domain'
import type { CoreContext } from './context.ts'

export const StatusPolicyMode = {
  SourceManaged: 'source_managed', HarnessManaged: 'harness_managed', Manual: 'manual',
} as const
export type StatusPolicyMode = (typeof StatusPolicyMode)[keyof typeof StatusPolicyMode]

/** 产品面说法 → 领域枚举；反向映射见 `modeFor`。 */
export const POLICY_BY_MODE: Readonly<Record<StatusPolicyMode, StatusPolicy>> = {
  [StatusPolicyMode.SourceManaged]: StatusPolicy.ProviderAuthoritative, [StatusPolicyMode.HarnessManaged]: StatusPolicy.HostAuthoritative,
  [StatusPolicyMode.Manual]: StatusPolicy.ManualOnly,
}

export function modeFor(policy: StatusPolicy): StatusPolicyMode {
  const found = (Object.keys(POLICY_BY_MODE) as StatusPolicyMode[]).find((mode) => POLICY_BY_MODE[mode] === policy)
  return found ?? StatusPolicyMode.SourceManaged
}

/** 决策结果：`wrote` 为 false 时调用方必须按"没有发生权威变更"处理。 */
export interface StatusDecision {
  readonly entityId: EntityId; readonly status: NormalizedStatus; readonly derived: readonly DerivedFlag[]
  readonly wrote: boolean; readonly policy: StatusPolicy; readonly mode: StatusPolicyMode
  readonly reason: string; readonly error: ProjectError | undefined
}

export interface EngineeringFactInput {
  readonly projection: WorkspaceProjection; readonly facts: readonly EngineeringFact[]; readonly policy: StatusPolicy
  /** 调用方误以为要写入的状态：工程事实下它必须被忽略，只保留诊断价值。 */
  readonly incoming?: NormalizedStatus
}

export function decideFromEngineeringFact(input: EngineeringFactInput): StatusDecision {
  const incoming = input.incoming ?? NormalizedStatus.Unknown
  const status = reconcilePlanningStatus({
    current: input.projection.planningStatus, incoming, source: StatusChangeSource.EngineeringFact, policy: input.policy,
  })
  const ignored = incoming !== NormalizedStatus.Unknown && incoming !== status
  return {
    entityId: input.projection.entityId, status, derived: derivedFlagsFor(input.facts), wrote: false,
    policy: input.policy, mode: modeFor(input.policy),
    reason: ignored
      ? `工程事实携带的状态 ${incoming} 已忽略：规划状态仍由 ${modeFor(input.policy)} 策略拥有`
      : '工程事实只产生派生标记，不改写规划状态',
    error: undefined,
  }
}

export function decideFromCommand(input: { readonly projection: WorkspaceProjection; readonly status: NormalizedStatus; readonly policy: StatusPolicy }): StatusDecision {
  const status = reconcilePlanningStatus({
    current: input.projection.planningStatus, incoming: input.status,
    source: StatusChangeSource.HostUser, policy: input.policy,
  })
  const wrote = status !== input.projection.planningStatus
  const refused = !wrote && input.status !== input.projection.planningStatus
  return {
    entityId: input.projection.entityId, status, derived: [], wrote,
    policy: input.policy, mode: modeFor(input.policy),
    reason: wrote ? '显式状态写入命令已应用' : refused ? '策略拒绝该显式状态写入' : '请求的状态与当前值相同，无需写入',
    error: refused ? projectError(ProjectErrorCode.NotSupported, '规划状态由 provider 拥有，显式命令被拒绝') : undefined,
  }
}

export interface PlanningStatusCommand { readonly entityId: EntityId; readonly status: NormalizedStatus }

async function workspacePolicy(context: CoreContext): Promise<StatusPolicy> {
  const workspace = await context.storage.getWorkspace(context.workspaceId)
  return workspace?.statusPolicy ?? StatusPolicy.ProviderAuthoritative
}

/** 规划状态的唯一写入入口：只被显式命令调用，且只在决策说 wrote 时才落库。 */
export async function writePlanningStatus(context: CoreContext, command: PlanningStatusCommand): Promise<StatusDecision> {
  const projection = await context.storage.getPlanningProjection(context.workspaceId, command.entityId)
  const policy = await workspacePolicy(context)
  if (projection === undefined) {
    return {
      entityId: command.entityId, status: NormalizedStatus.Unknown, derived: [], wrote: false,
      policy, mode: modeFor(policy), reason: '没有该规划条目的投影',
      error: projectError(ProjectErrorCode.NotFound, '没有该规划条目的投影'),
    }
  }
  const decision = decideFromCommand({ projection, status: command.status, policy })
  if (!decision.wrote) return decision
  await context.storage.transaction(async (tx) => {
    await tx.putPlanningProjection(context.workspaceId, {
      ...projection, planningStatus: decision.status, revision: await tx.advanceRevision(context.workspaceId),
    })
  })
  return decision
}

export function policyMatrix(): readonly { mode: StatusPolicyMode; policy: StatusPolicy; engineeringFactWrites: boolean; explicitCommandWrites: boolean }[] {
  return (Object.keys(POLICY_BY_MODE) as StatusPolicyMode[]).map((mode) => ({
    mode, policy: POLICY_BY_MODE[mode], engineeringFactWrites: false,
    explicitCommandWrites: POLICY_BY_MODE[mode] !== StatusPolicy.ProviderAuthoritative,
  }))
}
