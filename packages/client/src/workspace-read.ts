/**
 * 客户端装配出的"工作区读取"（issue #178）：展示层消费的输入由同步会话**生产**，不再由宿主手工拼装。
 * 这里还放帧头与时钟的运行时校验——TS 形状不能替代边界验证，不合契约的帧在任何状态变更之前被拒绝。
 */
import { WireFreshness } from '@harness-projects/controller/values'
import { AccessLevel } from '@harness-projects/domain/values'
import type { WireCapabilityEntry, WirePlanningSource, WireRepositoryEntry, WireWorkspaceDescriptor, WireWorkspaceHeader } from '@harness-projects/controller'
import type { EntityStore } from './store.ts'
import { CapabilityKey } from './keys.ts'

/**
 * 一次"工作区读取"：客户端模型 + 同步会话才知道的事实。
 *
 * `lastUpdatedAt` = client 接受一帧「宿主判定为当前值」的帧的时刻（ISO 8601），不是 provider 的更新时间；真伪跟随宿主的
 * freshness（宿主误报 fresh 时也推进；#199 之后只剩双重故障会误报，见 TD-031）。idle poll 不推进，reconnect / gap 重拉的基线被判定为当前值就推进，即使数据未变；
 * 内容不变的成功刷新经 metadata 携带来源确认时刻；整表 fresh 且该时刻前进时推进；
 * 同修订 metadata 在来源确认前进或整表 / 某行由 degraded 恢复为 fresh 时推进，纯来源改名、能力变化与降级都不推进。
 * 省略 = 从未读到当前值，是合法的降级形态。`capabilities` 省略 = 未观测到任何能力（权限未知不得当成可用）。
 * `repositories` 是逐仓库的能力项（#353）：省略 = 没有已登记的仓库，或最近一帧没有携带它；用法见 ui-model 的 `repositoryAccessIndex`。
 * `planningSource` 是规划来源的绑定 id 与显示名（#383）：省略 = 名字未知（没有规划挂载、Host 启动后还没读到项目），或最近一帧没有携带它。
 * `reason`：断网优先于来源降级，来源降级必有解释。断网与「降级但无原因」是 client 的安全散文；来源降级时原样是宿主的值，
 * 可能是机器错误码（如 `unavailable` / `permission_denied`），翻译成展示文字归页面层（#229，TD-025）。
 */
export interface ClientWorkspaceRead {
  readonly workspace: WireWorkspaceDescriptor
  readonly store: EntityStore
  readonly connection: { readonly connected: boolean }
  readonly lastUpdatedAt?: string | undefined
  /** Host 最后成功提交的规划来源确认时间；不是客户端时钟。 */
  readonly reconciledAt?: string | undefined
  readonly capabilities?: readonly WireCapabilityEntry[] | undefined
  readonly repositories?: readonly WireRepositoryEntry[] | undefined
  readonly planningSource?: WirePlanningSource | undefined
  readonly reason?: string | undefined
}

/** 契约是 ISO 8601（与 ui-model 的展示校验同口径）。 */
const ISO_8601 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/
function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = ISO_8601.exec(value)
  if (!match || Number.isNaN(Date.parse(value))) return false
  const [, year, month, day, hour, minute, second, offsetHour = '0', offsetMinute = '0'] = match
  const y = Number(year), leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1] ?? 0
  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= days
    && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60 && Number(offsetHour) < 24 && Number(offsetMinute) < 60
}
const KNOWN_CAPABILITIES = new Set(Object.values(CapabilityKey))
const ACCESS_LEVELS = new Set(Object.values(AccessLevel))

export function isSource(value: unknown): boolean {
  const source = value as { revision?: unknown; freshness?: unknown; reconciledAt?: unknown } | null
  return typeof source === 'object' && source !== null && Number.isInteger(source.revision)
    && (source.reconciledAt === undefined || validTimestamp(source.reconciledAt))
    && (source.freshness === WireFreshness.Fresh || source.freshness === WireFreshness.Degraded)
}

/** 先读并校验时钟，再改任何状态：坏时间不能先推进头再失败。 */
export function readClock(clock: () => string): string {
  const at = clock()
  if (!validTimestamp(at)) {
    throw new TypeError(`clock 必须返回 ISO 8601 时间戳，收到 ${JSON.stringify(at)}`)
  }
  return at
}

/** 能力项列表：每项闭集 `{ key, access, reason }`，key 是已知 key 且在本列表内唯一。 */
function validCapabilityList(entries: unknown): boolean {
  const unique = new Set<string>()
  return Array.isArray(entries) && entries.every((entry: WireCapabilityEntry) => {
    if (typeof entry !== 'object' || entry === null || !KNOWN_CAPABILITIES.has(entry.key) || !ACCESS_LEVELS.has(entry.access)
      || (entry.reason !== undefined && typeof entry.reason !== 'string') || unique.has(entry.key)) return false
    unique.add(entry.key)
    return Object.keys(entry).every((key) => key === 'key' || key === 'access' || key === 'reason')
  })
}

/** 逐仓库条目（可缺省）：每项闭集 `{ id, capabilities }`，id 非空且唯一，能力项沿用同一校验。 */
function validRepositories(repositories: unknown): boolean {
  const ids = new Set<string>()
  return repositories === undefined || (Array.isArray(repositories) && repositories.every((entry: WireRepositoryEntry) => {
    if (typeof entry !== 'object' || entry === null || typeof entry.id !== 'string' || entry.id === '' || ids.has(entry.id)
      || (entry.accessVersion !== undefined && typeof entry.accessVersion !== 'string') || !validCapabilityList(entry.capabilities)) return false
    ids.add(entry.id)
    return Object.keys(entry).every((key) => key === 'id' || key === 'capabilities' || key === 'accessVersion')
  }))
}

/** 规划来源（可缺省）：闭集 `{ bindingId, name }`，两者都是非空字符串。 */
function validPlanningSource(planning: unknown): boolean {
  const entry = planning as WirePlanningSource | null
  return planning === undefined || (typeof entry === 'object' && entry !== null && typeof entry.bindingId === 'string' && entry.bindingId !== ''
    && typeof entry.name === 'string' && entry.name !== '' && (entry.mappingOrigin === undefined || entry.mappingOrigin === 'derived' || entry.mappingOrigin === 'user')
    && Object.keys(entry).every((key) => key === 'bindingId' || key === 'name' || key === 'mappingOrigin'))
}

export function assertHeader(header: WireWorkspaceHeader): void {
  const malformed = '帧头不合契约：generation / workspace / capabilities / repositories / planningSource / source 形状错误'
  if (typeof header !== 'object' || header === null) throw new TypeError(malformed)
  const { generation, workspace, capabilities, repositories, planningSource, source } = header
  const described = workspace === undefined || (typeof workspace.id === 'string' && workspace.id !== '' && typeof workspace.name === 'string')
  if (typeof generation !== 'string' || generation.trim() === '' || !described || !validCapabilityList(capabilities) || !validRepositories(repositories) || !validPlanningSource(planningSource) || !isSource(source)) {
    throw new TypeError(malformed)
  }
}
