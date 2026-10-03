/**
 * Wire 层 DTO（ExecPlan D7 / issue #79）：对外只传内部对象，绝不暴露 provider 原生结构。
 *
 * 每个实体都携带 `SourceMetadata`：修订号是增量续传的游标，freshness 说明值是不是降级后的"最后已
 * 知"，authority 说明这些字段归谁所有。客户端据此判断"现在能不能把这个值当作当前值"，而不是猜。
 */
import { ContentKind } from '@harness-projects/domain'
import type {
  AccessLevel, DerivedFlag, EntityId, EntityKind, ExternalIdentityKind, NormalizedStatus, ProviderBindingId, WorkspaceId,
} from '@harness-projects/domain'
import type { CapabilityKey } from '@harness-projects/capabilities'
import { StatusPolicyMode } from '@harness-projects/core'
import type { PlanningItemView, SyncSummary, WorkspaceMetadata } from '@harness-projects/core'

export const WireFreshness = { Fresh: 'fresh', Degraded: 'degraded' } as const
export type WireFreshness = (typeof WireFreshness)[keyof typeof WireFreshness]

/** 权威归属：provider 拥有字段 / 宿主本地权威 / 只由人的显式操作改变。 */
export const WireAuthority = { Provider: 'provider', Host: 'host', Manual: 'manual' } as const
export type WireAuthority = (typeof WireAuthority)[keyof typeof WireAuthority]

const AUTHORITY_BY_MODE: Readonly<Record<StatusPolicyMode, WireAuthority>> = {
  [StatusPolicyMode.SourceManaged]: WireAuthority.Provider,
  [StatusPolicyMode.HarnessManaged]: WireAuthority.Host,
  [StatusPolicyMode.Manual]: WireAuthority.Manual,
}

export function authorityFor(mode: StatusPolicyMode): WireAuthority {
  return AUTHORITY_BY_MODE[mode]
}

/** 新鲜度与权威归属的唯一说明面；degraded 时值只能是"最后已知"，不能当作当前值。 */
export interface SourceMetadata {
  readonly revision: number
  readonly freshness: WireFreshness
  readonly authority: WireAuthority
  readonly reason: string | undefined
}

/** 内容引用的 wire 形状：三态判别式 + 内部外部身份，不含 provider 的原生对象。redacted 不带 externalKind / externalId（H12）。 */
export interface WireContentRef {
  readonly contentKind: ContentKind
  readonly title: string | undefined
  readonly body: string | undefined
  readonly bindingId: ProviderBindingId
  readonly externalKind: ExternalIdentityKind | undefined
  readonly externalId: string | undefined
}

export interface WireEntity {
  readonly entityId: EntityId
  readonly kind: EntityKind
  readonly planningStatus: NormalizedStatus
  readonly content: WireContentRef
  readonly derived: readonly DerivedFlag[]
  readonly source: SourceMetadata
}

export interface WireWorkspaceDescriptor { readonly id: WorkspaceId; readonly name: string }

/** 能力项只传 key / 最终 access / 原因：不带绑定、实例或凭据。 */
export interface WireCapabilityEntry { readonly key: CapabilityKey; readonly access: AccessLevel; readonly reason: string | undefined }

/** 每个可接受帧都带的整表头；`workspace` 为 undefined = 尚无已确认的 descriptor（没有 Storage），不是"没有工作区名"。 */
export interface WireWorkspaceHeader {
  readonly workspace: WireWorkspaceDescriptor | undefined
  readonly capabilities: readonly WireCapabilityEntry[]
  readonly source: SourceMetadata
}

export interface WireSnapshot extends WireWorkspaceHeader {
  readonly revision: number
  readonly entities: readonly WireEntity[]
}

export interface WireDelta extends WireWorkspaceHeader {
  readonly previousRevision: number
  readonly revision: number
  readonly upserts: readonly WireEntity[]
  readonly removed: readonly EntityId[]
}

/** 同 revision 的来源变化载体：只带头与逐行 source，不带 content / status / derived，也不能增删行。 */
export interface WireWorkspaceMetadata extends WireWorkspaceHeader {
  readonly revision: number
  readonly entities: readonly { readonly entityId: EntityId; readonly source: SourceMetadata }[]
}

export interface WireGap {
  readonly requestedAfter: number
  readonly currentRevision: number
  readonly reason: string
}

export type WireEvent =
  | { readonly kind: 'delta'; readonly delta: WireDelta }
  | { readonly kind: 'metadata'; readonly metadata: WireWorkspaceMetadata }
  | { readonly kind: 'gap'; readonly gap: WireGap }

function metadataOf(view: PlanningItemView, authority: WireAuthority): SourceMetadata {
  return {
    revision: view.freshness.revision,
    freshness: view.freshness.degraded ? WireFreshness.Degraded : WireFreshness.Fresh,
    authority,
    reason: view.freshness.reason,
  }
}

export function toWireEntity(view: PlanningItemView, authority: WireAuthority): WireEntity {
  // redacted 行内部仍以内容外部 id 去重与恢复，但该 id 标识的是无权查看的对象，不出 wire。
  const shown = view.content.contentKind !== ContentKind.Redacted
  return {
    entityId: view.entityId,
    kind: view.kind,
    planningStatus: view.planningStatus,
    content: {
      contentKind: view.content.contentKind,
      title: view.content.title,
      body: view.content.body,
      bindingId: view.content.identity.bindingId,
      externalKind: shown ? view.content.identity.externalKind : undefined,
      externalId: shown ? view.content.identity.externalId : undefined,
    },
    derived: view.engineering.derived,
    source: metadataOf(view, authority),
  }
}

/** 兼容未接入持久化游标的调用方：只用于旧式 wire 转换，不是工作区修订号的事实源。 */
export function revisionOf(entities: readonly WireEntity[]): number {
  return entities.reduce((max, entity) => Math.max(max, entity.source.revision), 0)
}

/** 整表新鲜度取工作区级同步摘要：与逐条 freshness 同源，没有实体时也成立（不再恒为 fresh）。 */
export function toWireSnapshot(
  views: readonly PlanningItemView[], authority: WireAuthority, workspaceRevision: number | undefined, sync: SyncSummary,
  metadata: WorkspaceMetadata,
): WireSnapshot {
  const entities = views
    .map((view) => toWireEntity(view, authority))
    .sort((left, right) => (left.entityId < right.entityId ? -1 : 1))
  const revision = workspaceRevision ?? revisionOf(entities)
  return {
    revision,
    entities,
    workspace: metadata.workspace,
    capabilities: metadata.capabilities.map(({ key, access, reason }) => ({ key, access, reason })),
    source: {
      revision,
      authority,
      freshness: sync.degraded ? WireFreshness.Degraded : WireFreshness.Fresh,
      reason: sync.reason,
    },
  }
}

const signature = (entity: WireEntity): string => JSON.stringify(entity)

/** 两个修订之间的净变化：变化的实体进 upserts，消失的实体进 removed。 */
export function diffSnapshots(previous: WireSnapshot, next: WireSnapshot): WireDelta {
  const before = new Map(previous.entities.map((entity) => [entity.entityId, signature(entity)]))
  const upserts = next.entities.filter((entity) => before.get(entity.entityId) !== signature(entity))
  const after = new Set(next.entities.map((entity) => entity.entityId))
  const removed = previous.entities.filter((entity) => !after.has(entity.entityId)).map((entity) => entity.entityId)
  const { workspace, capabilities, source } = next
  return { previousRevision: previous.revision, revision: next.revision, upserts, removed, workspace, capabilities, source }
}

export function toWireMetadata(snapshot: WireSnapshot): WireWorkspaceMetadata {
  const { revision, workspace, capabilities, source } = snapshot
  return { revision, workspace, capabilities, source, entities: snapshot.entities.map(({ entityId, source }) => ({ entityId, source })) }
}

const byId = (left: WireEntity, right: WireEntity): number => (left.entityId < right.entityId ? -1 : 1)

/** 同 revision 下"业务内容"的规范化签名：实体按 id 排序、去掉逐行 source；它变化就不是来源更新。 */
export function businessSignature(snapshot: WireSnapshot): string {
  return JSON.stringify([...snapshot.entities].sort(byId).map(({ source: _source, ...business }) => business))
}

/** 整表头与逐行 source 的规范化签名（能力按 key 排序）；不含当前时钟，完全相同才 idle。 */
export function sourceSignature(snapshot: WireSnapshot): string {
  const capabilities = [...snapshot.capabilities].sort((left, right) => (left.key < right.key ? -1 : 1))
  return JSON.stringify([snapshot.workspace, capabilities, snapshot.source, [...snapshot.entities].sort(byId).map((entity) => [entity.entityId, entity.source])])
}
