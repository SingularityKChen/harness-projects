/** 领域枚举：统一用 `as const` 对象而不是 TS `enum`——Node 的原生类型剥离不支持 enum，而本仓库没有构建步骤，测试直接 import .ts 源码；每个取值都是跨层契约，由 tests/contract/domain-enums.test.js 逐字钉死。 */

/** 内部实体种类。实体是内在锚点：跨工作区唯一、永久，外部 id 变化不改变它。 */
export const EntityKind = {
  WorkItem: 'work_item', ChangeRequest: 'change_request', Repository: 'repository',
  Branch: 'branch', Worktree: 'worktree', Commit: 'commit',
  ExecutionContext: 'execution_context', ExecutionRun: 'execution_run',
  PipelineRun: 'pipeline_run', CheckRun: 'check_run',
} as const
export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind]
/** 规划内容三态。redacted 是一等状态：权限被撤销或对象被删除时调用方必须显示占位，不得回退到缓存标题。 */
export const ContentKind = {
  WorkItem: 'work_item', ChangeRequest: 'change_request', Redacted: 'redacted',
} as const
export type ContentKind = (typeof ContentKind)[keyof typeof ContentKind]
/** 归一化规划状态：provider 的原始状态只在本层收敛，本地模型只认这 6 个值。 */
export const NormalizedStatus = {
  Todo: 'todo', InProgress: 'in_progress', Blocked: 'blocked',
  Done: 'done', Canceled: 'canceled', Unknown: 'unknown',
} as const
export type NormalizedStatus = (typeof NormalizedStatus)[keyof typeof NormalizedStatus]
/** 关系类别（三态冻结，语义见 relations.ts 的 RELATION_CLASS_SEMANTICS）：business_semantics / system_fact / lineage。 */
export const RelationClass = {
  BusinessSemantics: 'business_semantics', SystemFact: 'system_fact', Lineage: 'lineage',
} as const
export type RelationClass = (typeof RelationClass)[keyof typeof RelationClass]
/** 关系类型；每个类型属于哪个类别由 relations.ts 的 RELATION_TYPE_CLASS 唯一决定。 */
export const RelationType = {
  Blocks: 'blocks', DependsOn: 'depends_on', RelatesTo: 'relates_to', Duplicates: 'duplicates',
  Implements: 'implements', Tracks: 'tracks', ProducedBy: 'produced_by',
  HasWorktree: 'has_worktree', RunsOn: 'runs_on',
  DerivedFrom: 'derived_from', SupersededBy: 'superseded_by',
} as const
export type RelationType = (typeof RelationType)[keyof typeof RelationType]
/** 关系来源：显式声明 / 确定性发现 / 谱系传播。LLM 推断不在此列（AGENTS.md §1.1 不变量 5）。 */
export const RelationSource = {
  Explicit: 'explicit', Deterministic: 'deterministic', Lineage: 'lineage',
} as const
export type RelationSource = (typeof RelationSource)[keyof typeof RelationSource]
/** 关系确认态：只有 confirmed 进入规划视图与门禁；发现出来的边只能先进 candidate。 */
export const RelationState = {
  Candidate: 'candidate', Confirmed: 'confirmed',
} as const
export type RelationState = (typeof RelationState)[keyof typeof RelationState]
/** 执行上下文状态：上下文是可复用的执行环境，不承载一次具体运行的结果。 */
export const ExecutionContextStatus = {
  Planned: 'planned', Provisioning: 'provisioning', Ready: 'ready',
  Closed: 'closed', Failed: 'failed',
} as const
export type ExecutionContextStatus = (typeof ExecutionContextStatus)[keyof typeof ExecutionContextStatus]
/** 执行运行状态：一次运行的生命周期。 */
export const ExecutionRunStatus = {
  Queued: 'queued', Starting: 'starting', Running: 'running', Succeeded: 'succeeded',
  Failed: 'failed', Canceled: 'canceled', TimedOut: 'timed_out', Unknown: 'unknown',
} as const
export type ExecutionRunStatus = (typeof ExecutionRunStatus)[keyof typeof ExecutionRunStatus]
/** 访问级别（四态）：capabilities 层用这 4 个值描述一个 capability key 的可用性。 */
export const AccessLevel = {
  Available: 'available', ReadOnly: 'read_only', Unavailable: 'unavailable', Degraded: 'degraded',
} as const
export type AccessLevel = (typeof AccessLevel)[keyof typeof AccessLevel]
/** 本地写入状态。硬约束：只有拿到 Provider ack 或 reconcile 后才允许 Saved；其余取值在界面上都不得显示为权威“已保存”。 */
export const WriteState = {
  Pending: 'pending', Saved: 'saved', Unknown: 'unknown', Conflict: 'conflict', Failed: 'failed',
} as const
export type WriteState = (typeof WriteState)[keyof typeof WriteState]
/** 唯一允许对外显示为权威“已保存”的写入状态。 */
export function isAuthoritativeWriteState(state: WriteState): boolean {
  return state === WriteState.Saved
}
