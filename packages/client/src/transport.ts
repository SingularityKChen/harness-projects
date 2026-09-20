/**
 * 客户端传输面（issue #79）：只消费 controller 的 wire 类型，不 import React、不访问任何外部平台。
 *
 * 传输层拥有订阅游标：重拉基线后作废旧订阅，否则下一次 poll 会拿旧游标去续传一个已经变过的投影。
 * 第一次 poll 用刚拉到的基线快照作为 seed，让第一跳 delta 从订阅点精确计算，避免刚连上就误报缺口。
 */
import type { WatchOptions, WireEvent, WireSnapshot, WorkspaceWatch } from '@harness-projects/controller'

/** controller 的最小结构面：一次基线读 + 按修订订阅。 */
export interface RevisionSource {
  baseline(): Promise<WireSnapshot>
  watch(options: WatchOptions): WorkspaceWatch
}

export interface TransportOptions {
  /** 保留窗口，原样透传给 watch；超出的落后由 watch 翻译成 gap。 */
  readonly retain?: number
}

export interface Transport {
  /** 拉基线：这是唯一一次全量读，之后的更新只走增量。 */
  fetchBaseline(): Promise<WireSnapshot>
  poll(afterRevision: number): Promise<WireEvent | undefined>
  close(): void
}

export function createTransport(source: RevisionSource, options: TransportOptions = {}): Transport {
  let snapshot: WireSnapshot | undefined
  let watch: WorkspaceWatch | undefined

  const optionsFor = (afterRevision: number): WatchOptions => ({
    afterRevision,
    ...(options.retain === undefined ? {} : { retain: options.retain }),
    ...(snapshot === undefined ? {} : { seed: snapshot }),
  })

  return {
    async fetchBaseline(): Promise<WireSnapshot> {
      snapshot = await source.baseline()
      watch?.close()
      watch = undefined
      return snapshot
    },
    async poll(afterRevision: number): Promise<WireEvent | undefined> {
      watch ??= source.watch(optionsFor(afterRevision))
      return watch.poll()
    },
    close(): void {
      watch?.close()
      watch = undefined
    },
  }
}
