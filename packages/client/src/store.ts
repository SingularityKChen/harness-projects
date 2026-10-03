/**
 * React-free 实体表（issue #79）：按内部 entityId 保持稳定身份，更新就地写回同一条目，而不是重建一个
 * 新对象——订阅方持有的引用因此不会在增量之间漂移。
 *
 * 每个条目带 stale 标记：来源降级（freshness = degraded）、缺口与重连期间的值一律 stale；`isCurrent`
 * 只在条目存在且不 stale 时为真，所以陈旧值永远不会被当成当前值。
 */
import { WireFreshness } from '@harness-projects/controller'
import type { WireDelta, WireEntity, WireSnapshot, WireWorkspaceMetadata } from '@harness-projects/controller'
import { isSource } from './workspace-read.ts'

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
  /** 同修订的来源更新：只就地改已有行的 source / stale，不新建、不删除、不推进修订；任何不合契约的载体整体拒绝。 */
  applyMetadata(metadata: WireWorkspaceMetadata): void
  /** 缺口或重连期间调用：重拉基线之前，所有值都只能算"陈旧"。 */
  markAllStale(): void
  get(entityId: string): StoredEntity | undefined
  list(): readonly StoredEntity[]
  isCurrent(entityId: string): boolean
}

function upsertInto(entries: Map<string, StoredEntity>, entity: WireEntity, at: number): void {
  const stale = entity.source.freshness === WireFreshness.Degraded
  const existing = entries.get(entity.entityId)
  if (existing === undefined) {
    entries.set(entity.entityId, { entityId: entity.entityId, entity, revision: at, stale })
    return
  }
  existing.entity = entity
  existing.revision = at
  existing.stale = stale
}

function sortedList(entries: Map<string, StoredEntity>): readonly StoredEntity[] {
  return [...entries.values()].sort((left, right) => (left.entityId < right.entityId ? -1 : 1))
}

/** 修订、整表与逐行来源、删除表形状、id 唯一：写入只读这些字段且全部先于任何条目变更校验，所以被拒绝的帧不留半更新。 */
function assertFrame(frame: Pick<WireSnapshot, 'revision' | 'source'>, rows: readonly Pick<WireEntity, 'entityId' | 'source'>[], what: string, removed: unknown = []): void {
  const framed = Number.isInteger(frame.revision) && frame.revision >= 0 && isSource(frame.source) && frame.source.revision === frame.revision
  if (!framed || !rows.every((row) => isSource(row.source)) || !Array.isArray(removed)) throw new TypeError(`${what} 的修订、来源或删除表不合契约`)
  if (new Set(rows.map((row) => row.entityId)).size !== rows.length) throw new TypeError(`${what} 含重复实体`)
}

const METADATA_KEYS = ['revision', 'workspace', 'capabilities', 'source', 'entities']
const ROW_KEYS = ['entityId', 'source']
const onlyKeys = (value: object, allowed: readonly string[]): boolean => Object.keys(value).every((key) => allowed.includes(key))

export function createEntityStore(): EntityStore {
  const entries = new Map<string, StoredEntity>()
  let revision = 0
  return {
    get revision(): number {
      return revision
    },
    applyBaseline(snapshot: WireSnapshot): void {
      assertFrame(snapshot, snapshot.entities, 'baseline')
      const seen = new Set<string>(snapshot.entities.map((entity) => entity.entityId))
      for (const entity of snapshot.entities) upsertInto(entries, entity, snapshot.revision)
      for (const entityId of [...entries.keys()]) {
        if (!seen.has(entityId)) entries.delete(entityId)
      }
      revision = snapshot.revision
    },
    applyDelta(delta: WireDelta): void {
      assertFrame(delta, delta.upserts, 'delta', delta.removed)
      for (const entity of delta.upserts) upsertInto(entries, entity, delta.revision)
      for (const entityId of delta.removed) entries.delete(entityId)
      revision = delta.revision
    },
    applyMetadata(metadata: WireWorkspaceMetadata): void {
      assertFrame(metadata, metadata.entities, 'metadata')
      const covered = metadata.entities.length === entries.size && metadata.entities.every((row) => entries.has(row.entityId))
      const narrow = onlyKeys(metadata, METADATA_KEYS) && metadata.entities.every((row) => onlyKeys(row, ROW_KEYS))
      if (metadata.revision !== revision || !covered || !narrow) {
        throw new TypeError(`metadata 与本地修订 ${revision} 的实体集合不一致，或携带了来源以外的字段`)
      }
      for (const { entityId, source } of metadata.entities) {
        const entry = entries.get(entityId) as StoredEntity
        entry.entity = { ...entry.entity, source }
        entry.stale = source.freshness === WireFreshness.Degraded
      }
    },
    markAllStale(): void {
      for (const entry of entries.values()) entry.stale = true
    },
    get: (entityId) => entries.get(entityId),
    list: () => sortedList(entries),
    isCurrent: (entityId) => entries.get(entityId)?.stale === false,
  }
}
