/**
 * 客户端同步（issue #79 / #178）：基线修订 N → 按 N 订阅 → 按序应用 delta / metadata；发现缺口或重连时重拉基线。
 *
 * 缺口先被如实标记：store 整体置 stale，并通过 onGap 暴露这个窗口，然后才重拉基线恢复当前值。重连
 * 与缺口走同一条路径，所以重连后的投影必然与一个全新客户端的基线投影一致。
 *
 * `accept` 是**唯一**接受点：先校验帧头、读并校验时钟，再改 store，全部成功后才一次发布头 / 能力 /
 * 时间 / 连接状态——被拒绝的帧不会留下半个新状态。传输失败与被拒绝的帧一样走 `lose`：保留最后已知的
 * 内容、头与时间，只把连接标成断开、行标成 stale。
 */
import { WireFreshness } from '@harness-projects/controller'
import type {
  SourceMetadata, WireCapabilityEntry, WireEntity, WireGap, WireWorkspaceDescriptor, WireWorkspaceHeader,
} from '@harness-projects/controller'
import type { EntityStore } from './store.ts'
import type { Transport } from './transport.ts'
import { assertHeader, readClock, type ClientWorkspaceRead } from './workspace-read.ts'

export interface SyncReport {
  readonly kind: 'baseline' | 'delta' | 'metadata' | 'gap' | 'idle'
  readonly revision: number
  /** gap 的原因；重拉基线后仍然保留，方便调用方解释这次跳变。 */
  readonly reason: string | undefined
}

export interface SyncOptions {
  /** 缺口已检测、store 已整体标 stale、但还没重拉基线时调用；用于观测"旧值不是当前值"的窗口。 */
  readonly onGap?: (gap: WireGap, store: EntityStore) => void
  /** 接受时间的来源（ISO 8601）；默认系统时钟，测试注入固定值。 */
  readonly clock?: () => string
}

export interface WorkspaceSync {
  readonly revision: number
  readonly connected: boolean
  connect(): Promise<SyncReport>
  reconnect(): Promise<SyncReport>
  poll(): Promise<SyncReport>
  /** 关闭传输并标记断开；保留最后已知的内容、头与时间。 */
  disconnect(): void
  /** 展示层的唯一输入；首个已确认的工作区 descriptor 之前是 undefined。 */
  read(): ClientWorkspaceRead | undefined
}

/** 安全散文：不含原异常、堆栈或平台细节。 */
const DISCONNECTED_REASON = '与宿主的连接已断开，显示的是最后已知值'
const NEUTRAL_REASON = '规划来源读取不完整，部分值可能不是当前值'

const isFresh = (source: SourceMetadata): boolean => source.freshness === WireFreshness.Fresh
/** baseline / delta 确认了当前值：整表 fresh（含真实空集），或 partial 帧确有 fresh 行。 */
const confirms = (source: SourceMetadata, rows: readonly WireEntity[]): boolean => isFresh(source) || rows.some((row) => isFresh(row.source))
const recovered = (before: SourceMetadata | undefined, after: SourceMetadata): boolean => before?.freshness === WireFreshness.Degraded && isFresh(after)

interface AcceptedHead {
  readonly workspace: WireWorkspaceDescriptor | undefined
  readonly capabilities: readonly WireCapabilityEntry[]
  readonly source: SourceMetadata
}

export function createSync(transport: Transport, store: EntityStore, options: SyncOptions = {}): WorkspaceSync {
  const clock = options.clock ?? ((): string => new Date().toISOString())
  let connected = false
  let head: AcceptedHead | undefined
  let lastUpdatedAt: string | undefined

  const accept = (frame: WireWorkspaceHeader, apply: () => void, confirmed: boolean): void => {
    assertHeader(frame)
    const at = confirmed ? readClock(clock) : undefined
    apply()
    head = { workspace: frame.workspace ?? head?.workspace, capabilities: frame.capabilities, source: frame.source }
    if (at !== undefined) lastUpdatedAt = at
    connected = true
  }

  const lose = (): void => {
    connected = false
    store.markAllStale()
  }

  const guarded = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (error) {
      lose()
      throw error
    }
  }

  const baseline = async (): Promise<SyncReport> => {
    const snapshot = await transport.fetchBaseline()
    accept(snapshot, () => store.applyBaseline(snapshot), confirms(snapshot.source, snapshot.entities))
    return { kind: 'baseline', revision: snapshot.revision, reason: undefined }
  }

  const recover = async (gap: WireGap): Promise<SyncReport> => {
    store.markAllStale()
    options.onGap?.(gap, store)
    const report = await baseline()
    return { kind: 'gap', revision: report.revision, reason: gap.reason }
  }

  const reconnect = (): Promise<SyncReport> => guarded(async () => {
    store.markAllStale()
    return baseline()
  })

  return {
    get revision(): number {
      return store.revision
    },
    get connected(): boolean {
      return connected
    },
    connect: reconnect,
    reconnect,
    poll: () => guarded(async () => {
      if (!connected) return baseline()
      const event = await transport.poll(store.revision)
      if (event === undefined) return { kind: 'idle', revision: store.revision, reason: undefined }
      if (event.kind === 'gap') return recover(event.gap)
      if (event.kind === 'metadata') {
        const { metadata } = event
        const improved = recovered(head?.source, metadata.source)
          || metadata.entities.some((row) => recovered(store.get(row.entityId)?.entity.source, row.source))
        accept(metadata, () => store.applyMetadata(metadata), improved)
        return { kind: 'metadata', revision: store.revision, reason: undefined }
      }
      const { delta } = event
      if (delta.previousRevision !== store.revision) {
        return recover({
          requestedAfter: store.revision,
          currentRevision: delta.revision,
          reason: `增量从修订 ${delta.previousRevision} 起，本地停在 ${store.revision}`,
        })
      }
      accept(delta, () => store.applyDelta(delta), confirms(delta.source, delta.upserts))
      return { kind: 'delta', revision: store.revision, reason: undefined }
    }),
    disconnect(): void {
      transport.close()
      lose()
    },
    read(): ClientWorkspaceRead | undefined {
      if (head?.workspace === undefined) return undefined
      const degraded = head.source.freshness === WireFreshness.Degraded
      return {
        workspace: head.workspace, store, connection: { connected }, lastUpdatedAt, capabilities: head.capabilities,
        reason: !connected ? DISCONNECTED_REASON : degraded ? head.source.reason ?? NEUTRAL_REASON : undefined,
      }
    },
  }
}
