/**
 * 投影：本地可消费的规划条目视图（ExecPlan D5）。
 *
 * 只承载四类内容：权威快照、外部事实缓存、派生投影、能力与新鲜度元数据。派生值（derived）只用于
 * 展示，永不写回权威字段；内容引用区分三态，redacted 不携带标题，禁止回退到缓存标题。
 */
import {
  ContentKind,
  derivedFlagsFor,
  planningTitle,
  type DerivedFlag,
  type EngineeringFact,
  type EntityId,
  type EntityKind,
  type ExternalIdentity,
  type ExternalIdentityKind,
  type NormalizedStatus,
  type PlanningContent,
  type ProviderBindingId,
  type WorkspaceProjection,
} from '@harness-projects/domain'
import { entityKindFor } from './identity.ts'

/** 外部对象引用：详情与内容引用都据此回指 provider 侧对象，不暴露 provider 原生形状。 */
export interface ExternalIdentityRef {
  readonly bindingId: ProviderBindingId
  readonly externalKind: ExternalIdentityKind
  readonly externalId: string
}

/** 内容引用：三态判别式 + 可展示标题；redacted 的 title 必须为 undefined。 */
export interface ContentReference {
  readonly contentKind: ContentKind
  readonly title: string | undefined
  readonly body: string | undefined
  readonly identity: ExternalIdentityRef
}

/** 工程块：本批次恒为空事实集；派生标记永不影响 planningStatus（不变量 3）。 */
export interface EngineeringBlock {
  readonly derived: readonly DerivedFlag[]
  readonly facts: readonly EngineeringFact[]
}

export interface FreshnessMetadata {
  readonly revision: number
  readonly degraded: boolean
  readonly reason: string | undefined
}

export interface PlanningItemView {
  readonly entityId: EntityId
  readonly kind: EntityKind
  readonly planningStatus: NormalizedStatus
  readonly content: ContentReference
  readonly engineering: EngineeringBlock
  readonly freshness: FreshnessMetadata
}

export interface PlanningItemDetail extends PlanningItemView {
  readonly identities: readonly ExternalIdentity[]
}

export function identityRef(identity: ExternalIdentity): ExternalIdentityRef {
  return {
    bindingId: identity.bindingId,
    externalKind: identity.externalKind,
    externalId: identity.externalId,
  }
}

function contentBody(content: PlanningContent): string | undefined {
  return content.contentKind === ContentKind.Redacted ? undefined : content.body
}

export function contentReference(content: PlanningContent, identity: ExternalIdentityRef): ContentReference {
  return {
    contentKind: content.contentKind,
    title: planningTitle(content),
    body: contentBody(content),
    identity,
  }
}

export function engineeringBlock(facts: readonly EngineeringFact[] = []): EngineeringBlock {
  return { derived: derivedFlagsFor(facts), facts }
}

export interface SyncSummary {
  readonly degraded: boolean
  readonly reason: string | undefined
}

export function toPlanningItemView(
  projection: WorkspaceProjection,
  identity: ExternalIdentity,
  sync: SyncSummary,
  facts: readonly EngineeringFact[] = [],
): PlanningItemView {
  return {
    entityId: projection.entityId,
    kind: entityKindFor(projection.content.contentKind, identity.externalKind),
    planningStatus: projection.planningStatus,
    content: contentReference(projection.content, identityRef(identity)),
    engineering: engineeringBlock(facts),
    freshness: { revision: projection.revision, degraded: sync.degraded, reason: sync.reason },
  }
}

/** 工程事实只填派生标记，规划状态逐字保留：这是不变量 3 在投影层的落点。 */
export function withEngineeringFacts(
  view: PlanningItemView,
  facts: readonly EngineeringFact[],
): PlanningItemView {
  return { ...view, engineering: engineeringBlock(facts) }
}
