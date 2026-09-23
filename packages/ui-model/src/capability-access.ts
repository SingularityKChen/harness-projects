/**
 * 能力驱动的动作可用性（issue #128）。调用方唯一的按能力分支依据是 capability key：本文件里没有
 * provider / 平台名的分支，绑定标识也不参与判定。key 以字面量落在本层（依赖矩阵不允许
 * `ui-model -> capabilities`），但不是第二个权威源——契约测试把 `requiredKeys` 与 `CapabilityKey` 表
 * 逐字比对、把四态求交与 `intersectAccess` 做 4×4×4 差分。
 */
import { AccessLevel } from '@harness-projects/domain'
import {
  ActionId, LineageTarget,
  type ActionAvailability, type CapabilityDecision, type CapabilitySnapshotEntry, type LineageEntryPoint,
} from './types.ts'

/** 开始工作的必需 key：建分支、建工作树、启动执行，缺一不可。 */
const START_WORK_KEYS = [
  'development.branch.create',
  'development.worktree.create',
  'execution.run.start',
] as const

/**
 * 谱系入口的必需 key **必须等于 core 读该事实时真正经过的门**（`packages/core/src/chain-facts.ts`）。
 * `execution_context` 没有门：`readExecutionContext` 是纯本地存储读，core 从不为之设门，所以它不要求
 * 任何 key——挂一个 core 不经过的 key，只会让它在真实工作区永久不可用、在替身里可用。
 */
const LINEAGE_KEYS: Readonly<Record<LineageTarget, readonly string[]>> = {
  [LineageTarget.ExecutionContext]: [],
  [LineageTarget.ChangeRequest]: ['development.change_request.read'],
  [LineageTarget.PipelineRun]: ['delivery.pipeline.read'],
  [LineageTarget.CheckRun]: ['delivery.check.read'],
}

/** 入口顺序固定：页面稳定渲染与快照比较依赖它，不是实现细节。 */
const LINEAGE_ORDER: readonly LineageTarget[] = [
  LineageTarget.ExecutionContext, LineageTarget.ChangeRequest,
  LineageTarget.PipelineRun, LineageTarget.CheckRun,
]

/** 四态求交，与 capabilities 层逐条一致：unavailable > read_only > degraded > available。 */
function intersect(levels: readonly AccessLevel[]): AccessLevel {
  if (levels.includes(AccessLevel.Unavailable)) return AccessLevel.Unavailable
  if (levels.includes(AccessLevel.ReadOnly)) return AccessLevel.ReadOnly
  if (levels.includes(AccessLevel.Degraded)) return AccessLevel.Degraded
  return AccessLevel.Available
}

/** 快照 → key 索引（后出现的同名 key 覆盖先出现的）；一次读取建一次，不按行重建。 */
export function accessIndex(capabilities: readonly CapabilitySnapshotEntry[]): ReadonlyMap<string, AccessLevel> {
  const byKey = new Map<string, AccessLevel>()
  for (const entry of capabilities) byKey.set(entry.key, entry.access)
  return byKey
}

/**
 * 用途：与 core 的 `gateCommand(registry, key, mode)` 同一套约定（`packages/core/src/capabilities.ts`）——
 * 只有**写**命令在 `read_only` 下被拒；**读**目标在 `read_only` 下照常可用。
 */
const CapabilityUse = { Write: 'write', Read: 'read' } as const
type CapabilityUse = (typeof CapabilityUse)[keyof typeof CapabilityUse]

/**
 * 四态求交后按用途判定可用性（`write` 下 `available` / `degraded` 可用；`read` 下只有 `unavailable`
 * 阻断）。`access !== available` 时 `reason` 逐 key 点名起作用的 key 与**它自己的**级别（合成级别不等于
 * 任何单个 key 的级别），顺序沿用必需 key 的声明顺序，便于机器读取。必需 key 为空时恒可用。
 */
function decide(
  requiredKeys: readonly string[], access: ReadonlyMap<string, AccessLevel>, use: CapabilityUse,
): CapabilityDecision {
  const levelOf = (key: string): AccessLevel => access.get(key) ?? AccessLevel.Unavailable
  const combined = intersect(requiredKeys.map(levelOf))
  const available = use === CapabilityUse.Read
    ? combined !== AccessLevel.Unavailable
    : combined === AccessLevel.Available || combined === AccessLevel.Degraded
  if (combined === AccessLevel.Available) return { available, access: combined, reason: undefined, requiredKeys }
  const blocking = requiredKeys
    .filter((key) => levelOf(key) !== AccessLevel.Available)
    .map((key) => `${key} = ${levelOf(key)}`)
  return { available, access: combined, requiredKeys, reason: `capability ${blocking.join(', ')}` }
}

/** 开始工作的动作可用性（写动作）；是否提供这个动作由调用方按内容种类决定。 */
export function startWorkAvailability(access: ReadonlyMap<string, AccessLevel>): ActionAvailability {
  return { id: ActionId.StartWork, ...decide(START_WORK_KEYS, access, CapabilityUse.Write) }
}

/** 全部谱系入口（含不可用的）；可用性只来自 capability key，按只读导航判定。 */
export function lineageEntryPoints(access: ReadonlyMap<string, AccessLevel>): readonly LineageEntryPoint[] {
  return LINEAGE_ORDER.map((target) => ({ target, ...decide(LINEAGE_KEYS[target], access, CapabilityUse.Read) }))
}
