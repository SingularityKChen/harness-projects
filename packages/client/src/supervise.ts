/**
 * 宿主流的监督者（issue #229，TD-058）：三种终止（宿主结束一代、Host 侧读取失败、帧被拒）之后 follower 的句柄已死，
 * 这里按连续失败次数退避（1 s 起翻倍、30 s 封顶，被接受的帧归零）后以新 follower 重新跟随；载体断开不终止 follower，
 * 宿主在同一句柄上重拉 baseline。所有改变读数的时刻都在这里发布，页面只订阅：快照是最后一个接受过帧的 follower 的读数，
 * 所以新 follower 接受 baseline 之前仍是旧 follower 断开、整表 stale 的最后已知值。
 */
import { followWorkspace, type FollowOptions, type GenerationStream, type WorkspaceFollower } from './stream.ts'
import type { ClientWorkspaceRead } from './workspace-read.ts'

export interface SuperviseOptions extends FollowOptions {
  /** 安排一次重开，返回取消函数；缺省 setTimeout。 */
  readonly schedule?: (delayMs: number, run: () => void) => () => void
  /** follower 终止、重开已排定时调用。 */
  readonly onRetry?: (error: unknown, delayMs: number) => void
}
export interface WorkspaceSupervisor {
  subscribe(listener: () => void): () => void
  /** 两次发布之间返回同一对象；首个接受过帧的 follower 之前为 undefined。 */
  getSnapshot(): ClientWorkspaceRead | undefined
  /** 吸收、幂等：取消待定重开、关闭当前 follower、发布一次。 */
  close(): Promise<void>
}

const FIRST_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000
const timeout = (delayMs: number, run: () => void): (() => void) => {
  const timer = setTimeout(run, delayMs)
  return () => clearTimeout(timer)
}

export function superviseWorkspace(connect: (carrierFailed: () => void) => GenerationStream, options: SuperviseOptions = {}): WorkspaceSupervisor {
  const { schedule = timeout, onRetry, onReport, ...follow } = options
  const listeners = new Set<() => void>()
  let current: WorkspaceFollower | undefined // 至多一个打开
  let shown: WorkspaceFollower | undefined // 最后一个接受过帧的
  let snapshot: ClientWorkspaceRead | undefined
  let failures = 0
  let pending: (() => void) | undefined
  let closed = false

  /** 订阅者与 onRetry 是调用方代码：抛错只记一行，不挡后面的订阅者与排定重开，也不把已接受的帧变成终止。 */
  const isolated = (call: () => void): void => {
    try { call() } catch (error) { console.error('监督者：调用方回调抛错，已忽略', error) }
  }

  const publish = (): void => {
    snapshot = shown?.read()
    for (const listener of [...listeners]) isolated(listener)
  }

  /** 终止：旧 follower 已关闭（connect 同步抛错时从未打开），按连续失败次数退避后重开。 */
  const retry = (error: unknown): void => {
    failures += 1
    const delayMs = Math.min(FIRST_DELAY_MS * 2 ** (failures - 1), MAX_DELAY_MS)
    publish()
    isolated(() => onRetry?.(error, delayMs))
    if (!closed) pending = schedule(delayMs, start) // 通知或 onRetry 里同步 close 之后不再排定：否则重开落在 close 之后、没人取消
  }

  const start = (): void => {
    pending = undefined // 已运行的那一次不再是待定重开
    let follower: WorkspaceFollower
    try {
      follower = followWorkspace((carrierFailed) => connect(() => { carrierFailed(); publish() }), {
        ...follow,
        onReport: (report, generation) => { shown = follower; failures = 0; onReport?.(report, generation); publish() },
      })
    } catch (error) {
      retry(error)
      return
    }
    current = follower
    const settle = (error: unknown): void => {
      if (follower !== current) return // 本方 close 造成的结算不是终止
      current = undefined
      void follower.close()
      retry(error)
    }
    void follower.done.then(() => settle(undefined), settle)
  }

  start()
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => snapshot,
    async close() {
      if (closed) return
      closed = true
      pending?.()
      const follower = current
      current = undefined
      const disposed = follower?.close() // follower 同步断开并整表 stale，发布在等宿主收尾之前
      publish()
      await disposed
    },
  }
}
