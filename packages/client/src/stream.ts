/**
 * 宿主流的客户端消费者（issue #276）：宿主 `RemoteStream` 拥有物理代与重连节奏，帧全部交给唯一接受点 `WorkspaceSync.receive`，
 * 本文件只负责每代协议——第一帧必须是唯一的开场 baseline，gap 之后先 `restart()` 再要下一项。载体失败的同一个回调里断开并
 * 整表 stale；协议违例、帧被拒或宿主终止本流时终止、不自动重开（重开只会热循环）；`close` 之后是吸收态。
 */
import { createEntityStore } from './store.ts'
import { createSync, type SyncOptions, type SyncReport } from './sync.ts'
import type { Transport } from './transport.ts'
import type { ClientWorkspaceRead } from './workspace-read.ts'

/** 宿主 RemoteStream 的最小结构面（0.2.0-rc.2），不 import 宿主包；generation 是物理代号，只用于诊断。 */
export interface GenerationItem { readonly generation: number; readonly value: unknown; accept(): void }
export interface GenerationStream extends AsyncIterable<GenerationItem> { restart(): void; dispose(): Promise<void> }
export interface FollowOptions extends SyncOptions {
  /** 每个被接受的帧之后调用。 */
  readonly onReport?: (report: SyncReport, generation: number) => void
}
export interface WorkspaceFollower {
  /** 同 WorkspaceSync.read。 */
  read(): ClientWorkspaceRead | undefined
  /** close 之后 resolve；协议违例、帧被拒或宿主终止本流时 reject（最后已知值保留并整表 stale）。 */
  readonly done: Promise<void>
  close(): Promise<void>
}

/** 推模式从不拉取（gap 只标记，由消费者重开下一代）；这个 transport 只为复用 createSync 的接受点。 */
const refuse = (): Promise<never> => Promise.reject(new Error('推模式会话不拉取'))
const PUSH_ONLY: Transport = { fetchBaseline: refuse, poll: refuse, close: () => undefined }

export function followWorkspace(connect: (carrierFailed: () => void) => GenerationStream, options: FollowOptions = {}): WorkspaceFollower {
  const sync = createSync(PUSH_ONLY, createEntityStore(), options)
  let closed = false
  const stream = connect(() => sync.disconnect())
  const consume = async (): Promise<void> => {
    let opened: number | undefined // 已接受开场 baseline 的那一代
    for await (const item of stream) {
      if (closed) return
      const baseline = (item.value as { readonly kind?: unknown } | null | undefined)?.kind === 'baseline'
      if (baseline === (item.generation === opened)) {
        throw new TypeError(baseline ? `第 ${item.generation} 代出现第二个 baseline` : `第 ${item.generation} 代第一帧不是 baseline`)
      }
      const report = sync.receive(item.value)
      if (baseline) { opened = item.generation; item.accept() }
      options.onReport?.(report, item.generation)
      if (report.kind === 'gap') stream.restart()
    }
  }
  const done = consume().catch((error: unknown) => { if (!closed) throw error }).finally(() => sync.disconnect())
  return { read: () => sync.read(), done, close: async () => { closed = true; sync.disconnect(); await stream.dispose() } }
}
