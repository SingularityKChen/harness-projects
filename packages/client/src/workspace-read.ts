/**
 * 客户端装配出的"工作区读取"（issue #178）：展示层消费的输入由同步会话**生产**，不再由宿主手工拼装。
 * 这里还放帧头与时钟的运行时校验——TS 形状不能替代边界验证，不合契约的帧在任何状态变更之前被拒绝。
 */
import { WireFreshness } from '@harness-projects/controller'
import type { WireCapabilityEntry, WireWorkspaceDescriptor, WireWorkspaceHeader } from '@harness-projects/controller'
import type { EntityStore } from './store.ts'

/**
 * 一次"工作区读取"：客户端模型 + 同步会话才知道的事实。
 *
 * `lastUpdatedAt` = 客户端最后一次**成功接受已确认当前值**的时刻（ISO 8601）；不是 provider 的更新时间，
 * 省略 = 从未读到当前值，是合法的降级形态。`capabilities` 省略 = 未观测到任何能力（权限未知不得当成可用）。
 * `reason` 是 display-ready 散文：断网优先于来源降级；来源降级必有解释。
 */
export interface ClientWorkspaceRead {
  readonly workspace: WireWorkspaceDescriptor
  readonly store: EntityStore
  readonly connection: { readonly connected: boolean }
  readonly lastUpdatedAt?: string | undefined
  readonly capabilities?: readonly WireCapabilityEntry[] | undefined
  readonly reason?: string | undefined
}

/** 契约是 ISO 8601（与 ui-model 的展示校验同口径）。 */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export function isSource(value: unknown): boolean {
  const source = value as { revision?: unknown; freshness?: unknown } | null
  return typeof source === 'object' && source !== null && Number.isInteger(source.revision)
    && (source.freshness === WireFreshness.Fresh || source.freshness === WireFreshness.Degraded)
}

/** 先读并校验时钟，再改任何状态：坏时间不能先推进头再失败。 */
export function readClock(clock: () => string): string {
  const at = clock()
  if (typeof at !== 'string' || !ISO_8601.test(at) || Number.isNaN(Date.parse(at))) {
    throw new TypeError(`clock 必须返回 ISO 8601 时间戳，收到 ${JSON.stringify(at)}`)
  }
  return at
}

export function assertHeader(header: WireWorkspaceHeader): void {
  const { workspace, capabilities, source } = header
  const described = workspace === undefined || (typeof workspace.id === 'string' && workspace.id !== '' && typeof workspace.name === 'string')
  if (!described || !Array.isArray(capabilities) || !isSource(source)) {
    throw new TypeError('帧头不合契约：workspace / capabilities / source 形状错误')
  }
}
