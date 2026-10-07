/**
 * Planning 能力域 port。
 *
 * 读能力全套 + 可选写能力 + 内容三态判别联合。可选能力用 `?` 声明：provider 不实现时，调用方必须
 * 读 capability key 而不是按 provider 名字分支（ExecPlan D2）。
 */
import { ContentKind, type NativePlanningFieldValue, type RedactionReason } from '@harness-projects/domain'
import type { ProviderCapabilitySnapshot } from './capability-keys.ts'
import type { ExternalObjectRef, ProviderObservation, ProviderReconcileScope } from './observation.ts'
import type { ProviderPage, ProviderResult } from './result.ts'
import type { ProviderDefinition } from './registry.ts'

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
  /**
   * 原生字段值，以 project field id 为键（#133）。**缺省**表示该 Provider 没有原生字段读取面（不是「没有值」）；
   * 空对象表示完整读回且该条目没有任何字段值。写入路径未实现时不需要填充它。
   *
   * **内容三态的义务**（评审答复轮补写）：只要 Provider 声明了读取面（即本字段出现过，含空对象），
   * 对被扣下内容的条目（`content.kind === 'redacted'`）就必须发**空对象**而不是缺省——缺省的含义是
   * 「本次没有字段值数据」，core 因此无法区分「平台扣下了值」与「Provider 没有读取面」，既会保留上一次
   * 可见时落库的行，也会让 P1 的清理守卫失去作用。现有 fake 与 GitHub 实现都满足这条（`nativeValues: {}`）。
   */
  readonly nativeValues?: Readonly<Record<string, NativePlanningFieldValue>>
}

/** 成员关系（裁决 R1）：条目挂在 project 上的那一行；id 与两个时间戳都独立于内容（E1-1 实验 1）。它不是外部身份种类。 */
export interface ProviderPlanningMembership {
  readonly externalId: string; readonly createdAt: string | undefined; readonly updatedAt: string | undefined
}

/** 平台扣下内容身份时，条目 ref 退回成员关系，objectKind 取这个值；调用方不得把它登记为外部身份。 */
export const PLANNING_MEMBERSHIP_OBJECT_KIND = 'project_item'

/**
 * 规划条目。四条语义：
 * 1. `ref` 是**内容身份**（issue / draft / change_request），成员关系 id 在 `membership` 里；
 * 2. 例外：平台扣下内容身份（内容为 redacted 且无从得知内容 id）时，`ref` 退回成员关系，
 *    `objectKind` 为 `PLANNING_MEMBERSHIP_OBJECT_KIND`，调用方不得把它登记成外部身份；
 * 3. `sourceVersion` 是成员关系版本，调用方只做相等比较；
 * 4. `reconcile` 失败时一条观察都不产出（全有或全无）。
 */
export interface ProviderPlanningItem {
  readonly ref: ExternalObjectRef; readonly project: ExternalObjectRef; readonly membership: ProviderPlanningMembership
  readonly content: ProviderPlanningContent
  readonly fields: ProviderPlanningFields; readonly sourceVersion: string | undefined; readonly sourceUpdatedAt: string | undefined
}

/** 字段定义判别联合（#133）：只有已实现读取的 kind 带形状，其余一律 `unsupported`，不伪造空选项。 */
export const ProviderPlanningFieldKind = {
  SingleSelect: 'single_select', Iteration: 'iteration', Date: 'date', Unsupported: 'unsupported',
} as const
export type ProviderPlanningFieldKind = (typeof ProviderPlanningFieldKind)[keyof typeof ProviderPlanningFieldKind]
export type ProviderPlanningFieldDefinition =
  | { readonly id: string; readonly name: string; readonly kind: typeof ProviderPlanningFieldKind.SingleSelect; readonly options: readonly { readonly id: string; readonly name: string }[] }
  | { readonly id: string; readonly name: string; readonly kind: typeof ProviderPlanningFieldKind.Iteration; readonly iterations: readonly ProviderIteration[]; readonly completedIterations: readonly ProviderIteration[] }
  | { readonly id: string; readonly name: string; readonly kind: typeof ProviderPlanningFieldKind.Date }
  | { readonly id: string; readonly name: string; readonly kind: typeof ProviderPlanningFieldKind.Unsupported }

/**
 * 迭代配置：起始日是 date-only 字符串，工期以天为单位；`completed` 表示平台已把它归档。
 * `projectFieldId` 是承载它的字段 id（R2：值只能按字段 id 定位），`id` 是迭代自身的 option id。
 */
export interface ProviderIteration {
  readonly id: string; readonly projectFieldId: string; readonly title: string
  readonly startDate: string | undefined; readonly durationDays: number | undefined; readonly completed: boolean
}
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
  /** 静态连接实现定义：由实现作者声明，Host 只注入实例与 id（见 `ProviderDefinition`）。 */
  readonly definition: ProviderDefinition
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
