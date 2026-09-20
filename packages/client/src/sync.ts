/**
 * 客户端同步（issue #79）：基线修订 N → 按 N 订阅 → 按序应用 delta；发现缺口或重连时重拉基线。
 *
 * 缺口先被如实标记：store 整体置 stale，并通过 onGap 暴露这个窗口，然后才重拉基线恢复当前值。重连
 * 与缺口走同一条路径，所以重连后的投影必然与一个全新客户端的基线投影一致。
 */
import type { WireGap } from '@harness-projects/controller'
import type { EntityStore } from './store.ts'
import type { Transport } from './transport.ts'

export interface SyncReport {
  readonly kind: 'baseline' | 'delta' | 'gap' | 'idle'
  readonly revision: number
  /** gap 的原因；重拉基线后仍然保留，方便调用方解释这次跳变。 */
  readonly reason: string | undefined
}

export interface SyncOptions {
  /** 缺口已检测、store 已整体标 stale、但还没重拉基线时调用；用于观测"旧值不是当前值"的窗口。 */
  readonly onGap?: (gap: WireGap, store: EntityStore) => void
}

export interface WorkspaceSync {
  readonly revision: number
  readonly connected: boolean
  connect(): Promise<SyncReport>
  reconnect(): Promise<SyncReport>
  poll(): Promise<SyncReport>
}

export function createSync(transport: Transport, store: EntityStore, options: SyncOptions = {}): WorkspaceSync {
  let connected = false

  const baseline = async (): Promise<SyncReport> => {
    const snapshot = await transport.fetchBaseline()
    store.applyBaseline(snapshot)
    connected = true
    return { kind: 'baseline', revision: snapshot.revision, reason: undefined }
  }

  const recover = async (gap: WireGap): Promise<SyncReport> => {
    store.markAllStale()
    options.onGap?.(gap, store)
    const report = await baseline()
    return { kind: 'gap', revision: report.revision, reason: gap.reason }
  }

  return {
    get revision(): number {
      return store.revision
    },
    get connected(): boolean {
      return connected
    },
    connect: baseline,
    reconnect: baseline,
    async poll(): Promise<SyncReport> {
      if (!connected) return baseline()
      const event = await transport.poll(store.revision)
      if (event === undefined) return { kind: 'idle', revision: store.revision, reason: undefined }
      if (event.kind === 'gap') return recover(event.gap)
      if (event.delta.previousRevision !== store.revision) {
        return recover({
          requestedAfter: store.revision,
          currentRevision: event.delta.revision,
          reason: `增量从修订 ${event.delta.previousRevision} 起，本地停在 ${store.revision}`,
        })
      }
      store.applyDelta(event.delta)
      return { kind: 'delta', revision: store.revision, reason: undefined }
    },
  }
}
