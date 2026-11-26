/** 稳定标识：品牌化 id 与生成函数。品牌只在类型层存在（运行时就是普通字符串，调用方不得解析其结构）；跨种类不可互换由类型系统保证，见文件末尾的编译期自检。 */
import { createHash, randomUUID } from 'node:crypto'

export type BrandedId<Brand extends string> = string & { readonly __brand: Brand }
export type WorkspaceId = BrandedId<'WorkspaceId'>
export type EntityId = BrandedId<'EntityId'>
export type PlanningItemId = BrandedId<'PlanningItemId'>
export type WorkItemId = BrandedId<'WorkItemId'>
export type ChangeRequestId = BrandedId<'ChangeRequestId'>
export type ExternalIdentityId = BrandedId<'ExternalIdentityId'>
export type ProviderBindingId = BrandedId<'ProviderBindingId'>
export type ConnectorAccountId = BrandedId<'ConnectorAccountId'>
export type ExecutionContextId = BrandedId<'ExecutionContextId'>
export type ExecutionRunId = BrandedId<'ExecutionRunId'>
export type RelationId = BrandedId<'RelationId'>

/** 只在边界使用：把来自 storage / provider 的既有字符串标记成品牌 id。 */
export function asBrandedId<Id extends BrandedId<string>>(raw: string): Id {
  return raw as Id
}

/** UUID v5 形状（版本位 5、变体位 10xx），输入是已带命名空间的字符串。 */
function nameBasedUuid(name: string): string {
  const bytes = createHash('sha256').update(name, 'utf8').digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * 创建意图键 → 稳定 WorkspaceId：`sha256('workspace-create:v1:<key>')` 前 16 字节的 UUID v5 形状。
 * 只吃客户端随机意图键，不编码名称、provider externalId、bindingId 或其它用户内容（ADR-0010 内容规则）；
 * 丢 ack 重放与跨 Host 重启都能复算同一 id，所以同 key 同名零写入、同 key 异名 conflict。
 */
export const newWorkspaceIdForCreateIntent = (idempotencyKey: string): WorkspaceId => asBrandedId<WorkspaceId>(nameBasedUuid(`workspace-create:v1:${idempotencyKey}`))

export const newWorkspaceId = (): WorkspaceId => asBrandedId<WorkspaceId>(randomUUID())
export const newEntityId = (): EntityId => asBrandedId<EntityId>(randomUUID())
export const newPlanningItemId = (): PlanningItemId => asBrandedId<PlanningItemId>(randomUUID())
export const newWorkItemId = (): WorkItemId => asBrandedId<WorkItemId>(randomUUID())
export const newChangeRequestId = (): ChangeRequestId => asBrandedId<ChangeRequestId>(randomUUID())
export const newExternalIdentityId = (): ExternalIdentityId => asBrandedId<ExternalIdentityId>(randomUUID())
export const newProviderBindingId = (): ProviderBindingId => asBrandedId<ProviderBindingId>(randomUUID())
export const newConnectorAccountId = (): ConnectorAccountId => asBrandedId<ConnectorAccountId>(randomUUID())
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
