/**
 * 能力驱动的动作可用性（issue #128）。调用方唯一的按能力分支依据是 capability key：本文件里没有
 * provider / 平台名的分支，绑定标识也不参与判定。key 与四态求交都取自 client 重导出的 capabilities
 * 真源（依赖矩阵不允许 `ui-model -> capabilities`，也不再在本层复制字面量）；契约测试把 `requiredKeys`
 * 与 `CapabilityKey` 表逐字比对、把四态求交与 `intersectAccess` 做 4×4×4 差分。
 */
import { CapabilityKey, intersectAccess } from '@harness-projects/client/keys'
import { AccessLevel } from '@harness-projects/domain/values'
import {
  ActionId,
  type ActionAvailability, type CapabilitySnapshotEntry,
} from './types.ts'

/** 开始工作的必需 key：建分支、建工作树，以及 core 写前预检经过的仓库读、工作树读两个读门，缺一不可。 */
const START_WORK_KEYS = [
  CapabilityKey.DevelopmentBranchCreate, CapabilityKey.DevelopmentWorktreeCreate,
  CapabilityKey.DevelopmentRepositoryRead, CapabilityKey.DevelopmentWorktreeRead,
] as const
/** 读门只按读判定（与 core 的 `gateCommand(..., 'read')` 一致）：`read_only` 对读来说就是可用，只有 `unavailable` 挡住开始工作。 */
const START_WORK_READ_KEYS: ReadonlySet<string> = new Set([CapabilityKey.DevelopmentRepositoryRead, CapabilityKey.DevelopmentWorktreeRead])

/** 四态求交：逐个折进 capabilities 的 `intersectAccess`（unavailable > read_only > degraded > available），初值为上界 available。 */
const intersect = (levels: readonly AccessLevel[]): AccessLevel =>
  levels.reduce((acc, level) => intersectAccess(acc, level, AccessLevel.Available), AccessLevel.Available)

/** 快照 → key 索引（后出现的同名 key 覆盖先出现的）；一次读取建一次，不按行重建。 */
export function accessIndex(capabilities: readonly CapabilitySnapshotEntry[]): ReadonlyMap<string, AccessLevel> {
  const byKey = new Map<string, AccessLevel>()
  for (const entry of capabilities) byKey.set(entry.key, entry.access)
  return byKey
}

/**
 * 某个仓库的索引（#353）：先取工作区级索引，再由该仓库条目逐 key 覆盖——工作区级对 `development.*` 在多个连接时 fail closed，
 * 仓库条目是 core 按该仓库的引用路由出的结果；覆盖是替换而非求交，其它仓库的条目不参与。
 */
export function repositoryAccessIndex(
  workspace: readonly CapabilitySnapshotEntry[], repository: readonly CapabilitySnapshotEntry[],
): ReadonlyMap<string, AccessLevel> {
  return accessIndex([...workspace, ...repository])
}

/**
 * 开始工作四门求交：两个读门的 `read_only` 照常可读，写门只在 `available` / `degraded` 下可用。
 * `reason` 逐 key 点名起作用的 key 与它自己的级别，顺序沿用四门声明顺序。
 */
export function startWorkAvailability(access: ReadonlyMap<string, AccessLevel>): ActionAvailability {
  const requiredKeys = START_WORK_KEYS
  const levelOf = (key: string): AccessLevel => {
    const level = access.get(key) ?? AccessLevel.Unavailable
    return START_WORK_READ_KEYS.has(key) && level === AccessLevel.ReadOnly ? AccessLevel.Available : level
  }
  const combined = intersect(requiredKeys.map(levelOf))
  const available = combined === AccessLevel.Available || combined === AccessLevel.Degraded
  if (combined === AccessLevel.Available) return { id: ActionId.StartWork, available, access: combined, reason: undefined, requiredKeys }
  const blocking = requiredKeys
    .filter((key) => levelOf(key) !== AccessLevel.Available)
    .map((key) => `${key} = ${levelOf(key)}`)
  return { id: ActionId.StartWork, available, access: combined, requiredKeys, reason: `capability ${blocking.join(', ')}` }
}
