/**
 * 稳定 capability key 表与四态访问级别。
 *
 * 调用方只按 key 分支，任何 provider / 平台名字都不得出现在本表或调用方分支里（ExecPlan D2）；
 * tests/contract/capabilities-keys.test.js 用平台名片段把这条性质钉死。`AccessLevel` 与
 * `ProviderBindingId` 复用 `@harness-projects/domain`，不在此重新定义。
 */
import { AccessLevel, type ProviderBindingId } from '@harness-projects/domain'

/** 五个能力域：与 provider binding 的 domain 取值一一对应；storage 的 key 描述本地持久化能力，不经外部平台。 */
export const CapabilityDomain = {
  Planning: 'planning',
  Development: 'development',
  Delivery: 'delivery',
  Execution: 'execution',
  Storage: 'storage',
} as const
export type CapabilityDomain = (typeof CapabilityDomain)[keyof typeof CapabilityDomain]

/** 稳定 capability key：调用方唯一的按能力分支依据；取值是跨层契约，增删改名即失败。 */
export const CapabilityKey = {
  PlanningItemRead: 'planning.item.read',
  PlanningItemCreateIssue: 'planning.item.create.issue',
  PlanningItemCreateDraft: 'planning.item.create.draft',
  PlanningItemContentWrite: 'planning.item.content.write',
  PlanningStatusWrite: 'planning.field.status.write',
  PlanningIterationRead: 'planning.field.iteration.read',
  PlanningIterationWrite: 'planning.field.iteration.write',
  PlanningRankWrite: 'planning.field.rank.write',
  PlanningStartDateWrite: 'planning.field.start_date.write',
  PlanningTargetDateWrite: 'planning.field.target_date.write',
  PlanningParentRelationWrite: 'planning.relation.parent.write',
  PlanningBlockRelationWrite: 'planning.relation.block.write',
  DevelopmentRepositoryRead: 'development.repository.read',
  DevelopmentBranchCreate: 'development.branch.create',
  DevelopmentWorktreeCreate: 'development.worktree.create',
  DevelopmentChangeRequestRead: 'development.change_request.read',
  DevelopmentChangeRequestCreate: 'development.change_request.create',
  DevelopmentReviewRead: 'development.review.read',
  DeliveryPipelineRead: 'delivery.pipeline.read',
  DeliveryCheckRead: 'delivery.check.read',
  DeliveryDeploymentRead: 'delivery.deployment.read',
  DeliveryPipelineRerun: 'delivery.pipeline.rerun',
  ExecutionRunStart: 'execution.run.start',
  ExecutionRunCancel: 'execution.run.cancel',
  ExecutionRunRead: 'execution.run.read',
  StorageWorkspaceRead: 'storage.workspace.read',
  StorageWorkspaceWrite: 'storage.workspace.write',
  StorageMigrationApply: 'storage.migration.apply',
} as const
export type CapabilityKey = (typeof CapabilityKey)[keyof typeof CapabilityKey]

export { AccessLevel }

/** 一个 capability key 的调用方可见状态：access 是最终结论，其余字段是解释与恢复入口。 */
export interface EffectiveCapability {
  readonly key: CapabilityKey; readonly access: AccessLevel; readonly reason: string | undefined
  readonly bindingId: ProviderBindingId | undefined; readonly externalActionUrl: string | undefined
}

/**
 * capability（实现的理论能力）、permission（当前凭据权限）、policy（工作空间是否允许）三者取交：
 * 任一 unavailable → unavailable；否则任一 read_only → read_only；否则任一 degraded → degraded；
 * 三者都 available 才是 available。available 是上界，unavailable 是下界，read_only 严于 degraded。
 */
export function intersectAccess(capability: AccessLevel, permission: AccessLevel, policy: AccessLevel): AccessLevel {
  const levels = [capability, permission, policy]
  if (levels.includes(AccessLevel.Unavailable)) return AccessLevel.Unavailable
  if (levels.includes(AccessLevel.ReadOnly)) return AccessLevel.ReadOnly
  if (levels.includes(AccessLevel.Degraded)) return AccessLevel.Degraded
  return AccessLevel.Available
}

/** provider 自述的能力快照：capability 是理论能力，permission 是当前凭据权限；policy 属于工作空间。 */
export interface ProviderCapabilitySnapshot {
  readonly bindingId: ProviderBindingId
  readonly capability: Readonly<Partial<Record<CapabilityKey, AccessLevel>>>
  readonly permission: Readonly<Partial<Record<CapabilityKey, AccessLevel>>>
  readonly observedAt: string
}

/** 未声明的 capability 不出现；缺 permission 视为 unavailable（权限未知不得当成可用）；缺 policy 视为 available。 */
export function effectiveCapabilities(
  snapshot: ProviderCapabilitySnapshot,
  policy: Readonly<Partial<Record<CapabilityKey, AccessLevel>>> = {},
): readonly EffectiveCapability[] {
  const result: EffectiveCapability[] = []
  for (const key of Object.keys(snapshot.capability) as CapabilityKey[]) {
    const capability = snapshot.capability[key]
    if (capability === undefined) continue
    const permission = snapshot.permission[key] ?? AccessLevel.Unavailable
    result.push({
      key,
      access: intersectAccess(capability, permission, policy[key] ?? AccessLevel.Available),
      reason: undefined,
      bindingId: snapshot.bindingId,
      externalActionUrl: undefined,
    })
  }
  return result
}

type LevelIsExactly<Expected extends AccessLevel, Actual extends Expected> = Actual

/** 编译期自检（只被 `tsc --noEmit` 检查）：四态必须互不兼容。 */
export interface AccessLevelIsolationCheck {
  // @ts-expect-error read_only 不得当作 available 使用
  readonly mixedLevels: LevelIsExactly<'available', 'read_only'>
}
