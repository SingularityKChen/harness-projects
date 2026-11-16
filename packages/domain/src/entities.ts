/** 实体与规划内容：Entity 是全局锚点并显式选择主身份；规划状态与内容属于工作区投影（AGENTS.md §1.1 不变量 1）。 */
import { ContentKind, type EntityKind, type NormalizedStatus } from './enums.ts'
import type { EntityId, ExternalIdentityId, WorkspaceId } from './ids.ts'
import type { PlanningFieldsSnapshot } from './planning-fields.ts'

/** 原生展示号：不参与实体身份或关系键；来源与仓库必须来自同一可见对象。 */
export interface SourceNumber {
  readonly sourceName: string
  readonly scopeIdentity: { readonly namespace: string; readonly id: string }
  readonly scopeName: string
  readonly number: number
}

/** 信任边界白名单重建；异常不复述输入，避免坏载体进入错误回执。 */
export function sourceNumberSnapshot(value: unknown): SourceNumber {
  const record = (v: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (typeof v !== 'object' || v === null || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) throw new TypeError('原生编号不合契约')
    return v as Record<string, unknown>
  }
  const text = (v: unknown): string => {
    if (typeof v !== 'string' || v.trim() === '' || /[\r\n\t]/.test(v)) throw new TypeError('原生编号不合契约')
    return v
  }
  const v = record(value, ['sourceName','scopeIdentity','scopeName','number'])
  const scope = record(v.scopeIdentity, ['namespace','id'])
  if (!Number.isSafeInteger(v.number) || Number(v.number) <= 0) throw new TypeError('原生编号不合契约')
  return { sourceName:text(v.sourceName), scopeIdentity:{namespace:text(scope.namespace),id:text(scope.id)}, scopeName:text(v.scopeName), number:Number(v.number) }
}

export interface WorkItemContent {
  readonly sourceNumber?: SourceNumber
  readonly contentKind: typeof ContentKind.WorkItem
  readonly title: string
  readonly body: string
}

export interface ChangeRequestContent {
  readonly sourceNumber?: SourceNumber
  readonly contentKind: typeof ContentKind.ChangeRequest
  readonly number: number
  readonly title: string
  readonly body: string
}

/** 内容不可得的原因；redacted 不是错误，而是必须被如实展示的状态。 */
export const RedactionReason = {
  PermissionDenied: 'permission_denied', Deleted: 'deleted',
  Unavailable: 'unavailable', PolicyRestricted: 'policy_restricted',
} as const
export type RedactionReason = (typeof RedactionReason)[keyof typeof RedactionReason]

export interface RedactedContent {
  readonly contentKind: typeof ContentKind.Redacted
  readonly reason: RedactionReason
}

/** 规划内容三态判别联合：判别式是 contentKind。 */
export type PlanningContent = WorkItemContent | ChangeRequestContent | RedactedContent

export function isWorkItemContent(c: PlanningContent): c is WorkItemContent {
  return c.contentKind === ContentKind.WorkItem
}
export function isChangeRequestContent(c: PlanningContent): c is ChangeRequestContent {
  return c.contentKind === ContentKind.ChangeRequest
}
export function isRedactedContent(c: PlanningContent): c is RedactedContent {
  return c.contentKind === ContentKind.Redacted
}

/** redacted 内容没有标题：调用方必须显示占位，不得回退到缓存标题。 */
export function planningTitle(content: PlanningContent): string | undefined {
  return isRedactedContent(content) ? undefined : content.title
}

/** 内部实体锚点：与工作区无关；外部身份变化（含 Draft→Issue 提升）不改变它。 */
export interface Entity {
  readonly id: EntityId
  readonly kind: EntityKind
  /** 省略/undefined 保留已有选择；null 显式清除，仅无外部身份的内部锚点允许。 */
  readonly primaryIdentityId?: ExternalIdentityId | null
}

/** 实体在某个工作区里的可消费视图：规划状态是权威值，内容可为三态之一。 */
export interface WorkspaceProjection {
  readonly workspaceId: WorkspaceId
  readonly entityId: EntityId
  readonly planningStatus: NormalizedStatus
  readonly content: PlanningContent
  readonly revision: number
  /** 列表展示的字段事实（#133）；redacted 内容不带，缺省 = 没有可展示的字段值。 */
  readonly planningFields?: PlanningFieldsSnapshot
}
