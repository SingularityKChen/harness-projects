/**
 * 关系图：系统事实边与谱系跳（issue #78 / AGENTS.md §1.1 不变量 5、6）。
 *
 * 三类来源各有唯一落点：链路推进（显式命令拿到 provider ack）写 explicit 边；从 provider 读到的
 * 确定性事实写 deterministic 边，初始状态只能是 candidate；沿已记录边继续走得到的跳标 lineage。
 * 同一 (from, type, to) 三元组只保留一条：重复记录返回既有关系，绝不把 confirmed 降级回 candidate。
 *
 * 工程产物的内部 id 由 (工作空间, 种类, binding, 外部 id) 哈希确定（`chainEntityId`）——与
 * `contextIdFor` 同一手法：同一外部对象每次得到同一个内部 id，因此谱系不会在两次查询之间漂移，
 * 也不需要"再识别"（不变量 6）。规划拥有的对象（工作项、变更请求）仍用 provider 观察分配的实体 id。
 */
import { createHash } from 'node:crypto'
import type { Storage, StorageTransaction } from '@harness-projects/capabilities'
import {
  EntityKind, RelationSource, RelationState, asBrandedId, makeRelation,
  type EngineeringFactKind, type EntityId, type Relation, type RelationType, type WorkspaceId,
} from '@harness-projects/domain'
import type { CoreContext } from './context.ts'

/** 关系三元组：类别与起始状态由 domain 规则决定，调用方只声明这三个字段与来源。 */
export interface RelationRef {
  readonly from: EntityId
  readonly to: EntityId
  readonly type: RelationType
}

/** 一跳的 provenance：命令确认的事实、provider 读到的确定性事实、还是链骨架推导。 */
export const EdgeProvenance = {
  Command: 'command',
  ProviderRead: 'provider_read',
  ChainSkeleton: 'chain_skeleton',
} as const
export type EdgeProvenance = (typeof EdgeProvenance)[keyof typeof EdgeProvenance]

/** 谱系上的一个产物节点；`observed` 为 false 表示它只是链骨架推断出的位置，尚无外部事实。 */
export interface ChainNode {
  readonly id: EntityId
  readonly kind: EntityKind
  readonly externalId: string | undefined
  readonly label: string | undefined
  readonly observed: boolean
  readonly detail: string | undefined
  /** 这次观察隐含的工程事实种类（CI 成功/失败）；只作为派生标记的输入，永不改写规划状态。 */
  readonly fact: EngineeringFactKind | undefined
}

/** 一条待记录/已记录的跳：`artifact` 是这一跳引入的产物节点（tracks/has_worktree 是 to，其余是 from）。 */
export interface DiscoveredEdge extends RelationRef {
  readonly artifact: ChainNode
  readonly provenance: EdgeProvenance
}

export interface RecordedEdge {
  readonly relation: Relation
  readonly created: boolean
}

export function relationKey(ref: RelationRef): string {
  return [ref.from, ref.type, ref.to].join('|')
}

/** 工程产物的稳定内部 id：同一 (工作空间, 种类, 槽位) 恒等；槽位建议写 `<binding>|<externalId>`。 */
export function chainEntityId(workspaceId: WorkspaceId, kind: EntityKind, slot: string): EntityId {
  const digest = createHash('sha256').update([workspaceId, kind, slot].join('|')).digest('hex').slice(0, 32)
  return asBrandedId<EntityId>(`${kind}-${digest}`)
}

/** 关系端点是 EntityId；执行上下文等领域模块用更窄的品牌，这里做一次显式桥接。 */
export function asEntityId(raw: string): EntityId {
  return asBrandedId<EntityId>(raw)
}

export function findRelation(relations: readonly Relation[], ref: RelationRef): Relation | undefined {
  return relations.find((item) => item.from === ref.from && item.to === ref.to && item.type === ref.type)
}

/** 记录一条边：已存在就原样返回既有关系（含已确认状态），不产生第二条。 */
export async function recordEdge(
  store: Storage | StorageTransaction, workspaceId: WorkspaceId, ref: RelationRef,
  source: RelationSource, inheritedState?: RelationState,
): Promise<RecordedEdge> {
  const relations = await store.listRelations(workspaceId)
  const existing = findRelation(relations, ref)
  if (existing !== undefined) return { relation: existing, created: false }
  const relation = makeRelation({ ...ref, source, inheritedState })
  await store.putRelation(workspaceId, relation)
  return { relation, created: true }
}

/** provenance → 关系来源：命令确认的事实才是 explicit（进而 confirmed），推断出来的一律只能 candidate。 */
export function sourceForProvenance(provenance: EdgeProvenance): RelationSource {
  return provenance === EdgeProvenance.Command ? RelationSource.Explicit : RelationSource.Deterministic
}

/** 批量记录：一次读取现有边，只写缺失的那些，避免同一批里互相覆盖。 */
export async function recordEdges(
  context: CoreContext, edges: readonly DiscoveredEdge[],
): Promise<readonly RecordedEdge[]> {
  const known = [...(await context.storage.listRelations(context.workspaceId))]
  const results: RecordedEdge[] = []
  for (const edge of edges) {
    const existing = findRelation(known, edge)
    if (existing !== undefined) {
      results.push({ relation: existing, created: false })
      continue
    }
    const source = sourceForProvenance(edge.provenance)
    const relation = makeRelation({ from: edge.from, to: edge.to, type: edge.type, source, inheritedState: undefined })
    await context.storage.putRelation(context.workspaceId, relation)
    known.push(relation)
    results.push({ relation, created: true })
  }
  return results
}

/** 显式确认：唯一把 candidate 变成 confirmed 的入口；边不存在时返回 undefined，不凭空造关系。 */
export async function confirmRelation(context: CoreContext, ref: RelationRef): Promise<RecordedEdge | undefined> {
  const relations = await context.storage.listRelations(context.workspaceId)
  const existing = findRelation(relations, ref)
  if (existing === undefined) return undefined
  const confirmed: Relation = { ...existing, state: RelationState.Confirmed }
  await context.storage.putRelation(context.workspaceId, confirmed)
  return { relation: confirmed, created: false }
}
