/** 状态归一化与状态策略。不变量 3：规划状态与工程执行状态正交——CI 失败、Agent 完成、PR 合并都不得改写规划状态；派生标记（Attention 等）只是投影，永远不能写回权威状态。 */
import { NormalizedStatus } from './enums.ts'
import type { EntityId } from './ids.ts'

/** 规划状态归属策略：provider_authoritative = provider 是事实源，宿主只镜像；host_authoritative = 宿主本地是事实源，provider 侧改动只在显式 resync 时导入；manual_only = 只由人的显式操作改变。 */
export const StatusPolicy = {
  ProviderAuthoritative: 'provider_authoritative',
  HostAuthoritative: 'host_authoritative',
  ManualOnly: 'manual_only',
} as const
export type StatusPolicy = (typeof StatusPolicy)[keyof typeof StatusPolicy]

/** 一次状态变更的来源。关键：engineering_fact 永远不是规划状态的合法来源。 */
export const StatusChangeSource = {
  PlanningProvider: 'planning_provider', HostUser: 'host_user', EngineeringFact: 'engineering_fact',
} as const
export type StatusChangeSource = (typeof StatusChangeSource)[keyof typeof StatusChangeSource]

/** provider 原始状态 → 归一化状态。未列出的取值一律 unknown：宁可不知道，不得猜测。 */
const NORMALIZATION_TABLE: Readonly<Record<string, NormalizedStatus>> = {
  backlog: NormalizedStatus.Todo, todo: NormalizedStatus.Todo, open: NormalizedStatus.Todo,
  new: NormalizedStatus.Todo, triage: NormalizedStatus.Todo,
  in_progress: NormalizedStatus.InProgress, inprogress: NormalizedStatus.InProgress,
  doing: NormalizedStatus.InProgress, started: NormalizedStatus.InProgress,
  active: NormalizedStatus.InProgress,
  blocked: NormalizedStatus.Blocked, on_hold: NormalizedStatus.Blocked,
  waiting: NormalizedStatus.Blocked, paused: NormalizedStatus.Blocked,
  done: NormalizedStatus.Done, closed: NormalizedStatus.Done, complete: NormalizedStatus.Done,
  completed: NormalizedStatus.Done, resolved: NormalizedStatus.Done,
  canceled: NormalizedStatus.Canceled, cancelled: NormalizedStatus.Canceled,
  wontfix: NormalizedStatus.Canceled, wont_fix: NormalizedStatus.Canceled,
  rejected: NormalizedStatus.Canceled, duplicate: NormalizedStatus.Canceled,
  unknown: NormalizedStatus.Unknown,
}

/** 归一化：大小写、空格与连字符都不改变语义（"In Progress" 与 "in-progress" 等价）。 */
export function normalizePlanningStatus(raw: string): NormalizedStatus {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return NORMALIZATION_TABLE[key] ?? NormalizedStatus.Unknown
}

/** 工程事实的种类：全部来自执行与交付，永远不是规划事件。 */
export const EngineeringFactKind = {
  CiPassed: 'ci_passed', CiFailed: 'ci_failed', ExecutionCompleted: 'execution_completed',
  ExecutionFailed: 'execution_failed', ChangeRequestMerged: 'change_request_merged',
} as const
export type EngineeringFactKind = (typeof EngineeringFactKind)[keyof typeof EngineeringFactKind]

export interface EngineeringFact {
  readonly kind: EngineeringFactKind
  readonly subjectId: EntityId
}

/** 派生标记：只用于展示（Attention 等），不参与任何权威状态判定。 */
export const DerivedFlag = {
  Attention: 'attention', CiFailing: 'ci_failing',
  ExecutionFailed: 'execution_failed', Merged: 'merged',
} as const
export type DerivedFlag = (typeof DerivedFlag)[keyof typeof DerivedFlag]

const FLAGS_BY_FACT: Readonly<Record<EngineeringFactKind, readonly DerivedFlag[]>> = {
  [EngineeringFactKind.CiPassed]: [],
  [EngineeringFactKind.CiFailed]: [DerivedFlag.Attention, DerivedFlag.CiFailing],
  [EngineeringFactKind.ExecutionCompleted]: [],
  [EngineeringFactKind.ExecutionFailed]: [DerivedFlag.Attention, DerivedFlag.ExecutionFailed],
  [EngineeringFactKind.ChangeRequestMerged]: [DerivedFlag.Merged],
}

/** 把工程事实折成派生标记；顺序稳定（首次出现顺序），便于快照比较。 */
export function derivedFlagsFor(facts: readonly EngineeringFact[]): readonly DerivedFlag[] {
  const flags = new Set<DerivedFlag>()
  for (const fact of facts) {
    for (const flag of FLAGS_BY_FACT[fact.kind]) flags.add(flag)
  }
  return [...flags]
}

export interface PlanningState {
  readonly status: NormalizedStatus
  readonly derived: readonly DerivedFlag[]
}

/** 组装可消费状态：权威状态只来自 authoritative 参数，facts 只影响 derived。 */
export function planningStateFor(authoritative: NormalizedStatus, facts: readonly EngineeringFact[]): PlanningState {
  return { status: authoritative, derived: derivedFlagsFor(facts) }
}
export interface StatusChange {
  readonly current: NormalizedStatus
  readonly incoming: NormalizedStatus
  readonly source: StatusChangeSource
  readonly policy: StatusPolicy
}
/** 权威状态变更判定（三态策略 × 三种来源）：engineering_fact 在任何策略下都返回 current（不变量 3）；incoming 为 unknown 时不可判定，保持 current；planning_provider 只有 provider_authoritative 接受；host_user 只有 host_authoritative / manual_only 接受（显式 resync 也以 host_user 建模）。 */
export function reconcilePlanningStatus(change: StatusChange): NormalizedStatus {
  if (change.source === StatusChangeSource.EngineeringFact) return change.current
  if (change.incoming === NormalizedStatus.Unknown) return change.current
  if (change.source === StatusChangeSource.HostUser) {
    return change.policy === StatusPolicy.ProviderAuthoritative ? change.current : change.incoming
  }
  return change.policy === StatusPolicy.ProviderAuthoritative ? change.incoming : change.current
}
