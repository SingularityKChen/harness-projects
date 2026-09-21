/**
 * Wire 层 DTO（ExecPlan D7 / issue #79）：对外只传内部对象，绝不暴露 provider 原生结构。
 *
 * 每个实体都携带 `SourceMetadata`：修订号是增量续传的游标，freshness 说明值是不是降级后的"最后已
 * 知"，authority 说明这些字段归谁所有。客户端据此判断"现在能不能把这个值当作当前值"，而不是猜。
 */
import type {
  ContentKind, DerivedFlag, EntityId, EntityKind, ExternalIdentityKind, NormalizedStatus, ProviderBindingId,
} from '@harness-projects/domain'
import { StatusPolicyMode } from '@harness-projects/core'
import type { PlanningItemView } from '@harness-projects/core'

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

/** 内容引用的 wire 形状：三态判别式 + 内部外部身份，不含 provider 的原生对象。 */
export interface WireContentRef {
  readonly contentKind: ContentKind
  readonly title: string | undefined
  readonly body: string | undefined
  readonly bindingId: ProviderBindingId
  readonly externalKind: ExternalIdentityKind
  readonly externalId: string
}

export interface WireEntity {
  readonly entityId: EntityId
  readonly kind: EntityKind
  readonly planningStatus: NormalizedStatus
  readonly content: WireContentRef
  readonly derived: readonly DerivedFlag[]
  readonly source: SourceMetadata
}

export interface WireSnapshot {
  readonly revision: number
  readonly entities: readonly WireEntity[]
  readonly source: SourceMetadata
}

export interface WireDelta {
  readonly previousRevision: number
  readonly revision: number
  readonly upserts: readonly WireEntity[]
  readonly removed: readonly EntityId[]
}

export interface WireGap {
  readonly requestedAfter: number
  readonly currentRevision: number
  readonly reason: string
}

export type WireEvent =
  | { readonly kind: 'delta'; readonly delta: WireDelta }
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
  return {
    entityId: view.entityId,
    kind: view.kind,
    planningStatus: view.planningStatus,
    content: {
      contentKind: view.content.contentKind,
      title: view.content.title,
      body: view.content.body,
      bindingId: view.content.identity.bindingId,
      externalKind: view.content.identity.externalKind,
      externalId: view.content.identity.externalId,
    },
    derived: view.engineering.derived,
    source: metadataOf(view, authority),
  }
}

/** 兼容未接入持久化游标的调用方：只用于旧式 wire 转换，不是工作区修订号的事实源。 */
export function revisionOf(entities: readonly WireEntity[]): number {
  return entities.reduce((max, entity) => Math.max(max, entity.source.revision), 0)
}

export function toWireSnapshot(
  views: readonly PlanningItemView[], authority: WireAuthority, workspaceRevision?: number,
): WireSnapshot {
  const entities = views
    .map((view) => toWireEntity(view, authority))
    .sort((left, right) => (left.entityId < right.entityId ? -1 : 1))
  const revision = workspaceRevision ?? revisionOf(entities)
  const degraded = entities.find((entity) => entity.source.freshness === WireFreshness.Degraded)
  return {
    revision,
    entities,
    source: {
      revision,
      authority,
      freshness: degraded === undefined ? WireFreshness.Fresh : WireFreshness.Degraded,
      reason: degraded?.source.reason,
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
  return { previousRevision: previous.revision, revision: next.revision, upserts, removed }
}
