/** 稳定标识：品牌化 id 与生成函数。品牌只在类型层存在（运行时就是普通字符串，调用方不得解析其结构）；跨种类不可互换由类型系统保证，见文件末尾的编译期自检。 */
import { randomUUID } from 'node:crypto'

export type BrandedId<Brand extends string> = string & { readonly __brand: Brand }
export type WorkspaceId = BrandedId<'WorkspaceId'>
export type EntityId = BrandedId<'EntityId'>
export type PlanningItemId = BrandedId<'PlanningItemId'>
export type WorkItemId = BrandedId<'WorkItemId'>
export type ChangeRequestId = BrandedId<'ChangeRequestId'>
export type ExternalIdentityId = BrandedId<'ExternalIdentityId'>
export type ProviderBindingId = BrandedId<'ProviderBindingId'>
export type ExecutionContextId = BrandedId<'ExecutionContextId'>
export type ExecutionRunId = BrandedId<'ExecutionRunId'>
export type RelationId = BrandedId<'RelationId'>

/** 只在边界使用：把来自 storage / provider 的既有字符串标记成品牌 id。 */
export function asBrandedId<Id extends BrandedId<string>>(raw: string): Id {
  return raw as Id
}

export const newWorkspaceId = (): WorkspaceId => asBrandedId<WorkspaceId>(randomUUID())
export const newEntityId = (): EntityId => asBrandedId<EntityId>(randomUUID())
export const newPlanningItemId = (): PlanningItemId => asBrandedId<PlanningItemId>(randomUUID())
export const newWorkItemId = (): WorkItemId => asBrandedId<WorkItemId>(randomUUID())
export const newChangeRequestId = (): ChangeRequestId => asBrandedId<ChangeRequestId>(randomUUID())
export const newExternalIdentityId = (): ExternalIdentityId => asBrandedId<ExternalIdentityId>(randomUUID())
export const newProviderBindingId = (): ProviderBindingId => asBrandedId<ProviderBindingId>(randomUUID())
export const newExecutionContextId = (): ExecutionContextId => asBrandedId<ExecutionContextId>(randomUUID())
export const newExecutionRunId = (): ExecutionRunId => asBrandedId<ExecutionRunId>(randomUUID())
export const newRelationId = (): RelationId => asBrandedId<RelationId>(randomUUID())

// ── 类型级自检：只被 `tsc --noEmit` 检查，运行时不产生任何代码。 ──
type BrandedIdMustSatisfy<Brand extends string, Id extends BrandedId<Brand>> = Id

/** 编译期自检：品牌必须拦下跨种类混用。删掉品牌会让 @ts-expect-error 变成未使用，tsc 即失败。 */
export interface IdBrandIsolationCheck {
  // @ts-expect-error WorkItemId 不得当作 ChangeRequestId 使用
  readonly mixedBrands: BrandedIdMustSatisfy<'ChangeRequestId', WorkItemId>
}
