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
 * `lastUpdatedAt` = client 接受一帧「宿主判定为当前值」的帧的时刻（ISO 8601），不是 provider 的更新时间；真伪跟随宿主的
 * freshness（宿主误报 fresh 时也推进；#199 之后只剩双重故障会误报，见 TD-031）。idle poll 不推进，reconnect / gap 重拉的基线被判定为当前值就推进，即使数据未变；
 * 内容不变的成功刷新不产生帧（#220、ADR-0012），所以不推进；
 * 同修订的 metadata 帧只在整表或某行由 degraded 恢复为 fresh 时推进，纯来源改名、能力变化与降级都不推进。
 * 省略 = 从未读到当前值，是合法的降级形态。`capabilities` 省略 = 未观测到任何能力（权限未知不得当成可用）。
 * `reason`：断网优先于来源降级，来源降级必有解释。断网与「降级但无原因」是 client 的安全散文；来源降级时原样是宿主的值，
 * 可能是机器错误码（如 `unavailable` / `permission_denied`），翻译成展示文字归页面层（#229，TD-025）。
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
