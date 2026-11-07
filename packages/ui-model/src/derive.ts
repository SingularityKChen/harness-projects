/**
 * 列表与详情的展示结构派生。全部是纯函数：不读时钟、不改
 * 入参、无内部状态。陈旧是如实展示的状态，不是过滤条件——陈旧快照绝不返回空列表。降级规则共用
 * `degradationOf`；列表只归约可见行，详情仍取完整集合。
 */
import { ContentKind } from '@harness-projects/domain/values'
import type { StoredEntity } from '@harness-projects/client'
import { isIsoTimestamp } from './timestamp.ts'
import {
  WorkspaceConnectionState,
  type ClientEntity,
  type FreshnessPresentation, type PlanningSection,
  type SourceIdentity, type SourcePresentation, type WorkItemDetail, type WorkItemList,
  type WorkItemRow, type WorkspaceRead,
} from './types.ts'

/**
 * 时间必须由宿主给出且可解析：展示层不读时钟，也不能把坏时间渲染成 Invalid Date。`undefined` 是合法的
 * "从未读到当前值"；给了值但解析不了是宿主接线缺陷——响亮失败，不静默降级成陈旧。
 */
function assertTimestamp(value: string | undefined, field: string): void {
  if (value === undefined) return
  if (!isIsoTimestamp(value)) {
    throw new TypeError(`${field} 必须是 ISO 8601 时间戳或省略，收到 ${JSON.stringify(value)}`)
  }
}

/** 来源身份：客户端模型当前暴露的主内容身份（wire 今天只暴露这一条）；redacted 或 wire 没给身份就没有，上游误带了也不透出（H12）。 */
function sourceOf(entity: ClientEntity): SourcePresentation {
  const { bindingId, externalKind, externalId } = entity.content
  const hidden = entity.content.contentKind === ContentKind.Redacted || externalKind === undefined || externalId === undefined
  const primary: SourceIdentity | undefined = hidden ? undefined : { bindingId, externalKind, externalId }
  return { primary, authority: entity.source.authority, identities: primary === undefined ? [] : [primary] }
}

/** 两个输入都没给原因时补一条中性短语，降级必有解释；`reason` 可能原样是宿主的错误码（如 `unavailable`），翻译成展示文字归页面层（#229，TD-025）。 */
const FALLBACK_REASON = {
  disconnected: '连接已断开，显示的是最后已知值', neverRead: '尚未读到当前值',
  staleEntry: '本地模型已把该条目标记为陈旧',
} as const

/** 一次读取的降级结论：级别与原因一起算，不允许分开推导。 */
type Degradation = { readonly level: WorkspaceConnectionState; readonly reason: string | undefined }

/**
 * 降级决策的**唯一**实现。未连接 → `disconnected`；已连接但任一条目陈旧 / 宿主给出降级原因 / 从未读到
 * 当前值 → `degraded`。`reason` 优先级：宿主原因 → 条目自身的原因 → 中性短语。
 */
function degradationOf(read: WorkspaceRead, entries: readonly StoredEntity[]): Degradation {
  if (!read.connection.connected) {
    return { level: WorkspaceConnectionState.Disconnected, reason: read.reason ?? FALLBACK_REASON.disconnected }
  }
  const staleEntry = entries.find((entry) => entry.stale)
  if (staleEntry === undefined && read.reason === undefined && read.lastUpdatedAt !== undefined) {
    return { level: WorkspaceConnectionState.Connected, reason: undefined }
  }
  const fallback = read.lastUpdatedAt === undefined ? FALLBACK_REASON.neverRead : FALLBACK_REASON.staleEntry
  return {
    level: WorkspaceConnectionState.Degraded,
    reason: read.reason ?? staleEntry?.entity.source.reason ?? fallback,
  }
}

/** 条目已陈旧 **或** 连接不可用 **或** 从未读到当前值——任一降级即降级（fail closed）。 */
function isStale(entry: StoredEntity, read: WorkspaceRead): boolean {
  return entry.stale || !read.connection.connected || read.lastUpdatedAt === undefined
}

/** 只有陈旧行才带原因；新鲜行不得挂上降级说明。 */
function freshnessOf(entry: StoredEntity, read: WorkspaceRead, degradation: Degradation): FreshnessPresentation {
  const stale = isStale(entry, read)
  return {
    stale,
    lastUpdatedAt: read.lastUpdatedAt,
    reason: stale ? entry.entity.source.reason ?? degradation.reason : undefined,
  }
}

/** 遮蔽内容不透出标题、正文与字段事实：即使上游带着缓存值，页面也不会拿到它。 */
function visibleContent(entity: ClientEntity): { title: string | undefined; body: string | undefined; planningFields: ClientEntity['planningFields']; sourceNumber?: ClientEntity['content']['sourceNumber'] } {
  if (entity.content.contentKind === ContentKind.Redacted) return { title: undefined, body: undefined, planningFields: undefined }
  return { title: entity.content.title, body: entity.content.body, planningFields: entity.planningFields, ...(entity.content.sourceNumber === undefined ? {} : { sourceNumber: entity.content.sourceNumber }) }
}

function rowOf(
  entry: StoredEntity, read: WorkspaceRead,
  degradation: Degradation,
): WorkItemRow {
  const content = visibleContent(entry.entity)
  return {
    ...(content.sourceNumber === undefined ? {} : { sourceNumber: content.sourceNumber }),
    entityId: entry.entity.entityId, contentKind: entry.entity.content.contentKind, title: content.title,
    planningStatus: entry.entity.planningStatus, planningFields: content.planningFields, derived: entry.entity.derived, source: sourceOf(entry.entity),
    freshness: freshnessOf(entry, read, degradation),
  }
}

function planningSectionOf(entry: StoredEntity): PlanningSection {
  const content = visibleContent(entry.entity)
  return {
    ...(content.sourceNumber === undefined ? {} : { sourceNumber: content.sourceNumber }),
    entityId: entry.entity.entityId, contentKind: entry.entity.content.contentKind, title: content.title,
    body: content.body, status: entry.entity.planningStatus, derived: entry.entity.derived,
  }
}

/**
 * 工作项列表：每行以规划条目为键，顺序沿用客户端模型的稳定顺序。陈旧是展示状态，不是过滤条件——
 * 无论连接是否可用、条目是否陈旧，行都在；`stale` / `connection` / `reason` 三者仅按可见行和工作区读取状态同出一处决策。
 */
export function deriveWorkItemList(read: WorkspaceRead): WorkItemList {
  assertTimestamp(read.lastUpdatedAt, 'lastUpdatedAt')
  const entries = read.store.list()
  const degradation = degradationOf(read, entries.filter((entry) => entry.entity.content.contentKind !== ContentKind.Redacted))
  return {
    rows: entries.map((entry) => rowOf(entry, read, degradation)),
    stale: degradation.level !== WorkspaceConnectionState.Connected,
    connection: degradation.level,
    reason: degradation.reason,
    lastUpdatedAt: read.lastUpdatedAt,
  }
}

/** 统一详情：条目不在客户端模型里时返回 undefined；`entityId` 可直接用列表行的 `entityId`。 */
export function deriveWorkItemDetail(read: WorkspaceRead, entityId: string): WorkItemDetail | undefined {
  assertTimestamp(read.lastUpdatedAt, 'lastUpdatedAt')
  const entry = read.store.get(entityId)
  if (entry === undefined) return undefined
  return {
    entityId: entry.entity.entityId,
    planning: planningSectionOf(entry),
    source: sourceOf(entry.entity),
    freshness: freshnessOf(entry, read, degradationOf(read, read.store.list())),
  }
}
