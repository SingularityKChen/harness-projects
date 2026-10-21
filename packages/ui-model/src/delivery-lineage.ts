/**
 * 交付谱系条与共享新鲜度年龄规则（issue #357，ADR-0011 第 3 条）。纯函数：当前时间是参数，不读时钟、不改入参、无内部状态；
 * 输入是 core 的交付投影（类型经 client 的纯类型叶子取得），输出只有展示结构，不含动作或规划字段。
 * 年龄只从集合的 `confirmedAt` 起算；`attemptedAt` 是乱序令牌，结构上拿不到、也不读。
 */
import type { DeliveryProjection } from '@harness-projects/client/delivery'
import { isIsoTimestamp } from './timestamp.ts'

/** 新鲜度阈值默认值：集合最后一次完整确认距 now 不到这么久才算新鲜（#234、#281 共用）。 */
export const DELIVERY_FRESHNESS_THRESHOLD_MS = 5 * 60 * 1000

export const DeliveryFreshnessState = { Fresh: 'fresh', Stale: 'stale', Unconfirmed: 'unconfirmed' } as const
export type DeliveryFreshnessState = (typeof DeliveryFreshnessState)[keyof typeof DeliveryFreshnessState]

type FreshnessInput = Pick<DeliveryProjection['freshness'][number], 'confirmedAt' | 'stale'>

/** 宿主接线缺陷响亮失败，不静默降级：`now` 不是 ISO 8601 抛 TypeError，阈值不是有限非负数抛 RangeError（0 合法，恒陈旧）。 */
function assertAgeArguments(now: unknown, thresholdMs: unknown): void {
  if (!isIsoTimestamp(now)) throw new TypeError(`now 必须是 ISO 8601 时间戳，收到 ${JSON.stringify(now)}`)
  if (typeof thresholdMs !== 'number' || !Number.isFinite(thresholdMs) || thresholdMs < 0) {
    throw new RangeError(`thresholdMs 必须是有限的非负数，收到 ${String(thresholdMs)}`)
  }
}

/**
 * 一个交付事实集合此刻的新鲜度（#281、#234 共用）。按序，先命中者生效：集合缺失或 `confirmedAt` 缺失 / 不是 ISO 8601 → `unconfirmed`（坏形状按缺字段
 * 降级，不抛）；`stale` 不是 `false`（含缺字段）→ `stale`；阈值严格大于 `max(0, now − confirmedAt)` 才 `fresh`，等于阈值即陈旧。
 */
export function deliverySetFreshness(
  set: FreshnessInput | null | undefined, now: string, thresholdMs: number = DELIVERY_FRESHNESS_THRESHOLD_MS,
): DeliveryFreshnessState {
  assertAgeArguments(now, thresholdMs)
  return ageOf(set, now, thresholdMs).state
}

/** 年龄判定与下一翻转时刻同源；翻转使用 Unix 毫秒，调用方只安排重派生，不复制年龄规则。 */
function ageOf(set: FreshnessInput | null | undefined, now: string, thresholdMs: number): { state: DeliveryFreshnessState; nextFlipAt?: number } {
  if (set == null || !isIsoTimestamp(set.confirmedAt)) return { state: DeliveryFreshnessState.Unconfirmed }
  if (set.stale !== false) return { state: DeliveryFreshnessState.Stale }
  const confirmedAt = Date.parse(set.confirmedAt)
  return thresholdMs > Math.max(0, Date.parse(now) - confirmedAt)
    ? { state: DeliveryFreshnessState.Fresh, nextFlipAt: confirmedAt + thresholdMs }
    : { state: DeliveryFreshnessState.Stale }
}

export const LineageNodeState = { Observed: 'observed', Passed: 'passed', Failed: 'failed', Unknown: 'unknown', Stale: 'stale' } as const
export type LineageNodeState = (typeof LineageNodeState)[keyof typeof LineageNodeState]

/** 谱系条的六个固定位置，按链的顺序：执行上下文 → 工作树（分支）→ 提交 → 变更请求 → 流水线 → 检查。 */
export type LineagePosition = 'execution_context' | 'worktree' | 'commit' | 'change_request' | 'pipeline_run' | 'check_run'

/** 一跳一个节点：state 是节点结论与新鲜度；relationState 是 Core 的独立关系确认态，passed 不确认候选关系；available 只来自逐跳 unavailable。 */
export interface LineageNode {
  readonly externalId: string | undefined; readonly label: string | undefined; readonly state: LineageNodeState; readonly available: boolean
  readonly relationState: DeliveryProjection['hops'][number]['relationState']
}
/** 每个位置恰好一个 slot：没有跳是一个缺口（原因取自 core 的 `gaps`，没有则 `unknown`），有跳是每跳一个节点；缺口不借邻居的锚点补关系。 */
export type LineageSlot =
  | { readonly position: LineagePosition; readonly kind: 'gap'; readonly reason: DeliveryProjection['gaps'][number]['reason'] | 'unknown' }
  | { readonly position: LineagePosition; readonly kind: 'nodes'; readonly nodes: readonly LineageNode[] }
export interface DeliveryLineageStrip {
  readonly slots: readonly LineageSlot[]
  /** fresh 集合最早的年龄翻转时刻（Unix 毫秒）；没有待翻转集合则 undefined。 */
  readonly nextFlipAt: number | undefined
}

type Hop = DeliveryProjection['hops'][number]

/**
 * 位置表：位置名就是 core 的跳与缺口的 `entityKind`（类型取交集，位置名不是实体种类时 tsc 报错）；`set` 是该位置所属的快照集合（命令位置没有，
 * 不过年龄规则）；`ci` 位置才由事实派生 passed / failed。
 */
const POSITIONS = [
  { position: 'execution_context', set: undefined, ci: false },
  { position: 'worktree', set: undefined, ci: false },
  { position: 'commit', set: 'commit', ci: false },
  { position: 'change_request', set: 'change_request', ci: false },
  { position: 'pipeline_run', set: 'pipeline_run', ci: true },
  { position: 'check_run', set: 'check_run', ci: true },
] as const satisfies readonly {
  readonly position: LineagePosition & Hop['entityKind']; readonly set: DeliveryProjection['freshness'][number]['kind'] | undefined; readonly ci: boolean
}[]

/** 陈旧优先（跳自己标了陈旧，或集合判陈旧）；未确认的集合是 unknown；CI 位置只有新鲜且事实是 `ci_passed` 才是 passed。 */
function stateOf(hop: Hop, freshness: DeliveryFreshnessState | undefined, ci: boolean): LineageNodeState {
  if (hop.stale !== false || freshness === DeliveryFreshnessState.Stale) return LineageNodeState.Stale
  if (freshness === DeliveryFreshnessState.Unconfirmed) return LineageNodeState.Unknown
  if (!ci) return LineageNodeState.Observed
  if (hop.fact === 'ci_passed') return LineageNodeState.Passed
  return hop.fact === 'ci_failed' ? LineageNodeState.Failed : LineageNodeState.Unknown
}

/**
 * 把交付投影派生成六位置谱系条（#234 渲染，#281 复用同一条年龄规则）。先校验 `now` 与阈值（`error` 投影也校验），再按固定位置迭代、不按 hops 迭代；
 * 只读跳的 `entityKind`、`externalId`、`label`、`fact`、`stale`、`unavailable`、`relationState`，集合的 `confirmedAt`、`stale`，以及缺口的 `entityKind`、`reason`。
 * 不读 `attemptedAt`、`degraded`、`error`、`optional`：年龄不从尝试令牌起算，错误与降级由页面另行呈现。
 */
export function deriveDeliveryLineageStrip(
  projection: DeliveryProjection, now: string, { thresholdMs = DELIVERY_FRESHNESS_THRESHOLD_MS }: { readonly thresholdMs?: number } = {},
): DeliveryLineageStrip {
  assertAgeArguments(now, thresholdMs)
  const ages = projection.freshness.map((entry) => ({ kind: entry.kind, ...ageOf(entry, now, thresholdMs) }))
  const flips = ages.flatMap(({ nextFlipAt }) => nextFlipAt === undefined ? [] : [nextFlipAt])
  return {
    nextFlipAt: flips.length === 0 ? undefined : Math.min(...flips),
    slots: POSITIONS.map(({ position, set, ci }): LineageSlot => {
      const hops = projection.hops.filter((hop) => hop.entityKind === position)
      if (hops.length === 0) return { position, kind: 'gap', reason: projection.gaps.find((gap) => gap.entityKind === position)?.reason ?? 'unknown' }
      const freshness = set === undefined ? undefined : ages.find((entry) => entry.kind === set)?.state ?? DeliveryFreshnessState.Unconfirmed
      return {
        position, kind: 'nodes',
        nodes: hops.map((hop) => ({ externalId: hop.externalId, label: hop.label, state: stateOf(hop, freshness, ci), available: hop.unavailable === false, relationState: hop.relationState })),
      }
    }),
  }
}
