import type { BootstrapResult } from './bootstrap.ts'
import type { CoreApi, CoreDiagnostics } from './context.ts'

export interface PlanningReconcilerTimers {
  setInterval(callback: () => void, intervalMs: number): unknown
  clearInterval(handle: unknown): void
}

export interface PlanningReconcilerOptions {
  readonly intervalMs?: number
  readonly timers?: PlanningReconcilerTimers
  /**
   * 宿主诊断出口：与 `composeCore` 的 `CoreDeps.diagnostics` 同一契约，宿主传同一个对象。定时 tick 没有调用方，
   * 一轮被拒绝（双重故障 TD-031、编程错误）时在吞掉之前把原拒绝交给 `syncRoundFailed`；钩子同步抛出、返回被拒绝的 promise
   * 都不改变调度，返回值不被等待。显式 `triggerNow()` 的拒绝只交给它的调用方；tick 复用的若正是显式触发的那一轮，两边各收到一次。
   * 次数与时机：Core 在一轮内部已上报的异常若随后以同一对象拒绝本轮（例如提交与记录失败撞上同一个磁盘错误），tick 会再交一次，
   * 宿主要按轮去重时按对象身份去重；`stop()` / `dispose()` 不取消在途的一轮，它随后的拒绝仍会上报。
   */
  readonly diagnostics?: CoreDiagnostics
}

export interface PlanningReconciler {
  start(): void
  stop(): void
  triggerNow(): Promise<BootstrapResult>
  dispose(): void
}

type Refresh = () => Promise<BootstrapResult>

const DEFAULT_INTERVAL_MS = 60_000
const MAX_INTERVAL_MS = 2_147_483_647
const nativeTimers: PlanningReconcilerTimers = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
}

/** Host 生命周期拥有 scheduler；refresh 命令与 tick 共用 Core 的单飞槽。 */
export function createPlanningReconciler(
  source: Pick<CoreApi, 'commands'> | Refresh,
  options: PlanningReconcilerOptions = {},
): PlanningReconciler {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > MAX_INTERVAL_MS) {
    throw new RangeError(`Planning refresh interval must be in (0, ${MAX_INTERVAL_MS}]`)
  }
  const refresh: Refresh = typeof source === 'function' ? source : () => source.commands.refreshPlanning()
  const timers = options.timers ?? nativeTimers
  let handle: unknown
  let inFlight: Promise<BootstrapResult> | undefined
  let disposed = false
  let timerGeneration = 0

  const triggerNow = (): Promise<BootstrapResult> => {
    if (disposed) return Promise.reject(new Error('Planning reconciler is disposed'))
    if (inFlight !== undefined) return inFlight
    let task: Promise<BootstrapResult>
    task = Promise.resolve().then(refresh).finally(() => {
      if (inFlight === task) inFlight = undefined
    })
    inFlight = task
    return task
  }
  const reportScheduledFailure = (error: unknown): void => {
    try {
      const pending: unknown = options.diagnostics?.syncRoundFailed?.(error)
      // 与 Core 的 `reportSyncRoundFailure` 同法：用 Promise 构造器吸收任何 thenable 的拒绝与读取 `then` 的同步抛出。
      if (pending !== undefined) new Promise((resolve) => { resolve(pending) }).catch(() => undefined)
    } catch {
      // 诊断出口自己的失败不改变调度：下一个 tick 照常读取。
    }
  }
  const tick = (generation: number): void => {
    if (disposed || handle === undefined || generation !== timerGeneration) return
    void triggerNow().catch(reportScheduledFailure)
  }

  return {
    start(): void {
      if (disposed) throw new Error('Planning reconciler is disposed')
      if (handle !== undefined) return
      const generation = timerGeneration + 1
      timerGeneration = generation
      handle = timers.setInterval(() => tick(generation), intervalMs)
      const unref = (handle as { unref?: () => void } | undefined)?.unref
      if (typeof unref === 'function') unref.call(handle)
    },
    stop(): void {
      if (handle === undefined) return
      timers.clearInterval(handle)
      handle = undefined
      timerGeneration += 1
    },
    triggerNow,
    dispose(): void {
      if (disposed) return
      if (handle !== undefined) timers.clearInterval(handle)
      handle = undefined
      timerGeneration += 1
      disposed = true
    },
  }
}
