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

export function watchWorkspace(source: WatchSource, options: WatchOptions): WorkspaceWatch {
  const retain = options.retain ?? 1
  let cursor = options.afterRevision
  let previous = options.seed !== undefined && options.seed.revision === cursor ? options.seed : undefined
  let closed = false

  const gapOf = (current: number, reason: string): WireEvent => ({
    kind: 'gap',
    gap: { requestedAfter: cursor, currentRevision: current, reason },
  })

  const classify = (next: WireSnapshot): WireEvent | undefined => {
    if (next.revision === cursor) {
      previous = next
      return undefined
    }
    if (next.revision < cursor) return gapOf(next.revision, `订阅者修订 ${cursor} 领先于工作区修订 ${next.revision}`)
    if (next.revision - cursor > retain) {
      return gapOf(next.revision, `落后 ${next.revision - cursor} 个修订，超出保留窗口 ${retain}`)
    }
    if (previous === undefined || previous.revision !== cursor) {
      return gapOf(next.revision, `没有修订 ${cursor} 处的快照，无法重建连续增量`)
    }
    const delta = diffSnapshots(previous, next)
    previous = next
    cursor = next.revision
    return { kind: 'delta', delta }
  }

  return {
    get afterRevision(): number {
      return cursor
    },
    async poll(): Promise<WireEvent | undefined> {
      if (closed) return undefined
      return classify(await source.baseline())
    },
    close(): void {
      closed = true
    },
  }
}
