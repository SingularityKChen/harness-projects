/**
 * React-free 实体表（issue #79）：按内部 entityId 保持稳定身份，更新就地写回同一条目，而不是重建一个
 * 新对象——订阅方持有的引用因此不会在增量之间漂移。
 *
 * 每个条目带 stale 标记：来源降级（freshness = degraded）、缺口与重连期间的值一律 stale；`isCurrent`
 * 只在条目存在且不 stale 时为真，所以陈旧值永远不会被当成当前值。
 */
import { WireFreshness } from '@harness-projects/controller'
import type { WireDelta, WireEntity, WireSnapshot } from '@harness-projects/controller'

export interface StoredEntity {
  readonly entityId: string
  entity: WireEntity
  revision: number
  stale: boolean
}

export interface EntityStore {
  /** 已应用的修订：增量订阅的续传游标。 */
  readonly revision: number
  applyBaseline(snapshot: WireSnapshot): void
  applyDelta(delta: WireDelta): void
  /** 缺口或重连期间调用：重拉基线之前，所有值都只能算"陈旧"。 */
  markAllStale(): void
  get(entityId: string): StoredEntity | undefined
  list(): readonly StoredEntity[]
  isCurrent(entityId: string): boolean
}

function freshEntry(entity: WireEntity, revision: number): StoredEntity {
  return { entityId: entity.entityId, entity, revision, stale: entity.source.freshness === WireFreshness.Degraded }
}

export function createEntityStore(): EntityStore {
  const entries = new Map<string, StoredEntity>()
  let revision = 0

  const upsert = (entity: WireEntity, at: number): void => {
    const existing = entries.get(entity.entityId)
    if (existing === undefined) {
      entries.set(entity.entityId, freshEntry(entity, at))
      return
    }
    existing.entity = entity
    existing.revision = at
    existing.stale = entity.source.freshness === WireFreshness.Degraded
  }

  return {
    get revision(): number {
      return revision
    },
    applyBaseline(snapshot: WireSnapshot): void {
      const seen = new Set<string>()
      for (const entity of snapshot.entities) {
        seen.add(entity.entityId)
        upsert(entity, snapshot.revision)
      }
      for (const entityId of [...entries.keys()]) {
        if (!seen.has(entityId)) entries.delete(entityId)
      }
      revision = snapshot.revision
    },
    applyDelta(delta: WireDelta): void {
      for (const entity of delta.upserts) upsert(entity, delta.revision)
      for (const entityId of delta.removed) entries.delete(entityId)
      revision = delta.revision
    },
    markAllStale(): void {
      for (const entry of entries.values()) entry.stale = true
    },
    get: (entityId) => entries.get(entityId),
    list: () => [...entries.values()].sort((left, right) => (left.entityId < right.entityId ? -1 : 1)),
    isCurrent: (entityId) => entries.get(entityId)?.stale === false,
  }
}
