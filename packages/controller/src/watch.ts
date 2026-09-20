/**
 * 基于修订号的增量 watch（issue #79）。
 *
 * `watchWorkspace({ afterRevision })` 从订阅者已知的修订续传：每次 poll 重读基线，只在能重建连续那一跳
 * 时产出 delta。落后超过保留窗口、订阅者游标领先于工作区（工作区被重建）、或没有订阅点处的快照时，
 * 一律发 gap 事件让订阅者重拉基线——绝不静默续传一个可能已经错位的投影。
 */
import { diffSnapshots, type WireEvent, type WireSnapshot } from './wire.ts'

/** watch 的读取面：一次基线读 = 一个修订上的完整投影。 */
export interface WatchSource {
  baseline(): Promise<WireSnapshot>
}

export interface WatchOptions {
  /** 订阅者当前所在的修订；下一跳必须从这里开始。 */
  readonly afterRevision: number
  /** 保留窗口：允许落后的最大修订数，超过即 gap。默认 1。 */
  readonly retain?: number
  /** 订阅者已有的 afterRevision 快照，让第一跳 delta 从订阅点精确计算。 */
  readonly seed?: WireSnapshot
}

export interface WorkspaceWatch {
  /** 已交付给订阅者的修订；gap 之后不前进，订阅者必须重拉基线。 */
  readonly afterRevision: number
  poll(): Promise<WireEvent | undefined>
  close(): void
}

interface WatchState {
  cursor: number
  previous: WireSnapshot | undefined
  closed: boolean
  retain: number
}

function gapEvent(state: WatchState, current: number, reason: string): WireEvent {
  return { kind: 'gap', gap: { requestedAfter: state.cursor, currentRevision: current, reason } }
}

async function pollSource(source: WatchSource, state: WatchState): Promise<WireEvent | undefined> {
  if (state.closed) return undefined
  const next = await source.baseline()
  if (next.revision === state.cursor) {
    state.previous = next
    return undefined
  }
  if (next.revision < state.cursor) {
    return gapEvent(state, next.revision, `订阅者修订 ${state.cursor} 领先于工作区修订 ${next.revision}`)
  }
  if (next.revision - state.cursor > state.retain) {
    return gapEvent(state, next.revision, `落后 ${next.revision - state.cursor} 个修订，超出保留窗口 ${state.retain}`)
  }
  if (state.previous === undefined || state.previous.revision !== state.cursor) {
    return gapEvent(state, next.revision, `没有修订 ${state.cursor} 处的快照，无法重建连续增量`)
  }
  const delta = diffSnapshots(state.previous, next)
  state.previous = next
  state.cursor = next.revision
  return { kind: 'delta', delta }
}

export function watchWorkspace(source: WatchSource, options: WatchOptions): WorkspaceWatch {
  const state: WatchState = {
    cursor: options.afterRevision,
    previous: options.seed?.revision === options.afterRevision ? options.seed : undefined,
    closed: false,
    retain: options.retain ?? 1,
  }
  return {
    get afterRevision(): number {
      return state.cursor
    },
    poll: () => pollSource(source, state),
    close(): void {
      state.closed = true
    },
  }
}
