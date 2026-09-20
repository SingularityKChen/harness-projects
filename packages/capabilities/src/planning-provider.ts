/**
 * Planning 能力域 port。
 *
 * 读能力全套 + 可选写能力 + 内容三态判别联合。可选能力用 `?` 声明：provider 不实现时，调用方必须
 * 读 capability key 而不是按 provider 名字分支（ExecPlan D2）。
 */
import { ContentKind, type RedactionReason } from '@harness-projects/domain'
import type { ProviderCapabilitySnapshot } from './capability-keys.ts'
import type { ExternalObjectRef, ProviderObservation, ProviderReconcileScope } from './observation.ts'
import type { ProviderPage, ProviderResult } from './result.ts'

export interface ProviderProject { readonly ref: ExternalObjectRef; readonly title: string; readonly sourceUpdatedAt: string | undefined }
export interface ProviderWorkItemContent { readonly externalId: string; readonly title: string; readonly body: string }
export interface ProviderChangeRequestContent { readonly externalId: string; readonly number: number; readonly title: string; readonly body: string }

/** 规划内容三态：redacted 是一等状态，调用方必须显示占位，不得回退到缓存或推断出的内容。 */
export type ProviderPlanningContent =
  | { readonly kind: typeof ContentKind.WorkItem; readonly workItem: ProviderWorkItemContent }
  | { readonly kind: typeof ContentKind.ChangeRequest; readonly changeRequest: ProviderChangeRequestContent }
  | { readonly kind: typeof ContentKind.Redacted; readonly reason: RedactionReason }

export function providerContentKind(content: ProviderPlanningContent): ContentKind {
  return content.kind
}

export interface ProviderPlanningFields {
  readonly statusKey: string | undefined; readonly priority: string | undefined; readonly assigneeRefs: readonly string[]
  readonly iterationId: string | undefined; readonly startDate: string | undefined; readonly targetDate: string | undefined
  readonly customFields: Readonly<Record<string, unknown>>
}

export interface ProviderPlanningItem {
  readonly ref: ExternalObjectRef; readonly project: ExternalObjectRef; readonly content: ProviderPlanningContent
  readonly fields: ProviderPlanningFields; readonly sourceVersion: string | undefined; readonly sourceUpdatedAt: string | undefined
}

export interface ProviderPlanningFieldDefinition { readonly id: string; readonly name: string; readonly kind: string; readonly options: readonly string[] }
export interface ProviderIteration { readonly id: string; readonly title: string; readonly startDate: string | undefined; readonly targetDate: string | undefined }
export interface ProviderCreatedPlanningItem { readonly item: ProviderPlanningItem }
export interface ProviderCreatedWorkItem { readonly item: ProviderPlanningItem; readonly workItem: ProviderWorkItemContent }

export interface ProviderListPlanningItemsInput { readonly project: ExternalObjectRef; readonly cursor: string | undefined; readonly limit: number }
export interface ProviderCreateIssueInput { readonly project: ExternalObjectRef; readonly title: string; readonly body: string }
export type ProviderCreateDraftInput = ProviderCreateIssueInput

export interface ProviderUpdateWorkItemContentInput {
  readonly ref: ExternalObjectRef; readonly title: string; readonly body: string; readonly expectedSourceVersion: string | undefined
}

export interface ProviderPlanningFieldPatch {
  readonly statusKey?: string; readonly priority?: string; readonly assigneeRefs?: readonly string[]
  readonly iterationId?: string | null; readonly startDate?: string | null; readonly targetDate?: string | null
}

/** 字段写入必须带 expectedSourceVersion：没有 compare-and-swap 的 provider 也要能做 stale 检测。 */
export interface ProviderUpdatePlanningFieldsInput {
  readonly ref: ExternalObjectRef; readonly patch: ProviderPlanningFieldPatch; readonly expectedSourceVersion: string | undefined
}

export interface ProviderMovePlanningItemInput {
  readonly ref: ExternalObjectRef; readonly targetProject: ExternalObjectRef; readonly expectedSourceVersion: string | undefined
}

export interface PlanningProvider {
  describeCapabilities(): Promise<ProviderCapabilitySnapshot>
  getProject(ref: ExternalObjectRef): Promise<ProviderResult<ProviderProject>>
  listPlanningItems(input: ProviderListPlanningItemsInput): Promise<ProviderResult<ProviderPage<ProviderPlanningItem>>>
  getPlanningItem(ref: ExternalObjectRef): Promise<ProviderResult<ProviderPlanningItem>>
  listFieldDefinitions(project: ExternalObjectRef): Promise<ProviderResult<readonly ProviderPlanningFieldDefinition[]>>
  listIterations(project: ExternalObjectRef): Promise<ProviderResult<readonly ProviderIteration[]>>
  createIssueWorkItem?(input: ProviderCreateIssueInput): Promise<ProviderResult<ProviderCreatedWorkItem>>
  createDraftItem?(input: ProviderCreateDraftInput): Promise<ProviderResult<ProviderCreatedPlanningItem>>
  updateWorkItemContent?(input: ProviderUpdateWorkItemContentInput): Promise<ProviderResult<ProviderWorkItemContent>>
  updatePlanningFields?(input: ProviderUpdatePlanningFieldsInput): Promise<ProviderResult<ProviderPlanningItem>>
  movePlanningItem?(input: ProviderMovePlanningItemInput): Promise<ProviderResult<ProviderPlanningItem>>
  reconcile?(scope: ProviderReconcileScope): AsyncIterable<ProviderObservation>
}
