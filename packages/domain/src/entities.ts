/** 实体与规划内容：`Entity` 只有 id 与种类，与工作区和外部 id 都无关；规划状态与内容属于工作区投影（`WorkspaceProjection`），因为一个工作空间同一时刻只有一个 Planning 事实源（AGENTS.md §1.1 不变量 1）。 */
import { ContentKind, type EntityKind, type NormalizedStatus } from './enums.ts'
import type { EntityId, WorkspaceId } from './ids.ts'

export interface WorkItemContent {
  readonly contentKind: typeof ContentKind.WorkItem
  readonly title: string
  readonly body: string
}

export interface ChangeRequestContent {
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
}

/** 实体在某个工作区里的可消费视图：规划状态是权威值，内容可为三态之一。 */
export interface WorkspaceProjection {
  readonly workspaceId: WorkspaceId
  readonly entityId: EntityId
  readonly planningStatus: NormalizedStatus
  readonly content: PlanningContent
  readonly revision: number
}
