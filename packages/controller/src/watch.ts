/**
 * 基于修订号的增量 watch（issue #79）。
 *
 * `watchWorkspace({ afterRevision })` 从订阅者已知的修订续传：每次 poll 重读基线，只在能重建连续那一跳
 * 时产出 delta。落后超过保留窗口、订阅者游标领先于工作区（工作区被重建）、或没有订阅点处的快照时，
 * 一律发 gap 事件让订阅者重拉基线——绝不静默续传一个可能已经错位的投影。同修订上只有来源（头 / 逐行
 * source）变化时发 metadata（#178），业务字段变化则 fail closed 为 gap，不借来源事件改业务。
 */
import {
  businessSignature, diffSnapshots, sourceSignature, toWireMetadata, type WireEvent, type WireSnapshot,
} from './wire.ts'

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
  if (state.closed) return undefined
  if (state.previous !== undefined && state.previous.generation !== next.generation) {
    return gapEvent(state, next.revision, 'Host generation 已变化，必须重拉基线')
  }
  if (next.revision === state.cursor) {
    const previous = state.previous
    if (previous !== undefined && businessSignature(previous) !== businessSignature(next)) {
      return gapEvent(state, next.revision, `修订 ${next.revision} 上的业务字段变化了，不能当作来源更新`)
    }
    state.previous = next
    if (previous === undefined || sourceSignature(previous) === sourceSignature(next)) return undefined
    return { kind: 'metadata', metadata: toWireMetadata(next) }
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

/** 宿主流的一帧（#276）：每一代恰好一个开场 baseline，之后是 delta / metadata；gap 之后本代结束。 */
export type WireStreamFrame = { readonly kind: 'baseline'; readonly baseline: WireSnapshot } | WireEvent

export interface StreamOptions {
  /** 本代的生命周期：中止后不再读、不再产出。 */
  readonly signal: AbortSignal
  readonly intervalMs: number
  /** 可中止的等待（中止时提前 resolve）；缺省 setTimeout，测试注入手动节拍。 */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>
}

const abortableDelay = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve) => {
  const done = (): void => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
  const timer = setTimeout(done, ms)
  signal.addEventListener('abort', done, { once: true })
})

/** 一代宿主流：先读一次基线并产出，再以它为 seed 按间隔 poll。保留窗口不设上限（ExecPlan D4）。 */
export async function* streamWorkspace(source: WatchSource, options: StreamOptions): AsyncGenerator<WireStreamFrame, void> {
  const { signal, wait = abortableDelay } = options
  if (signal.aborted) return
  const baseline = await source.baseline()
  yield { kind: 'baseline', baseline }
  const watch = watchWorkspace(source, { afterRevision: baseline.revision, seed: baseline, retain: Number.POSITIVE_INFINITY })
  while (!signal.aborted) {
    await wait(options.intervalMs, signal)
    if (signal.aborted) return
    const event = await watch.poll()
    if (event === undefined) continue
    yield event
    if (event.kind === 'gap') return
  }
}
