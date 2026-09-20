/** 关系语义：类别表、候选规则与依赖环检测。`RelationClass` 是冻结的三态：上游只给了第三个取值的名字，这里补齐语义与约束（ExecPlan A1 不变量 5、6）。 */
import { RelationClass, RelationSource, RelationState, RelationType } from './enums.ts'
import type { EntityId } from './ids.ts'

/** 类别语义：business_semantics = 规划层人工可确认的语义边，参与规划视图与门禁；system_fact = 工程执行事实产生的边，只记录“发生了什么”，不参与规划判定也不得升级成 business_semantics；lineage = 工程产物间的谱系边，首次识别后沿谱系继承同一语义、不重新识别（不变量 6）。 */
export const RELATION_CLASS_SEMANTICS: Readonly<Record<RelationClass, string>> = {
  [RelationClass.BusinessSemantics]: '规划语义边：可人工确认，参与规划视图与门禁提示',
  [RelationClass.SystemFact]: '工程执行事实边：只描述发生了什么，不参与规划判定',
  [RelationClass.Lineage]: '谱系传播边：首次识别后沿谱系继承，不重新识别',
}

/** 关系类型 → 类别：唯一权威表；每个类型必须恰好属于一个类别。 */
export const RELATION_TYPE_CLASS: Readonly<Record<RelationType, RelationClass>> = {
  blocks: RelationClass.BusinessSemantics, depends_on: RelationClass.BusinessSemantics,
  relates_to: RelationClass.BusinessSemantics, duplicates: RelationClass.BusinessSemantics,
  implements: RelationClass.BusinessSemantics,
  tracks: RelationClass.SystemFact, produced_by: RelationClass.SystemFact,
  has_worktree: RelationClass.SystemFact, runs_on: RelationClass.SystemFact,
  derived_from: RelationClass.Lineage, superseded_by: RelationClass.Lineage,
}

export function relationClassOf(type: RelationType): RelationClass {
  return RELATION_TYPE_CLASS[type]
}

export interface Relation {
  readonly from: EntityId
  readonly to: EntityId
  readonly type: RelationType
  readonly class: RelationClass
  readonly source: RelationSource
  readonly state: RelationState
}
/** 有方向性依赖语义的两类边：只有它们参与环检测。 */
const DEPENDENCY_TYPES: readonly RelationType[] = [RelationType.Blocks, RelationType.DependsOn]

export function isDependencyRelation(type: RelationType): boolean {
  return DEPENDENCY_TYPES.includes(type)
}

/** 起始确认态（不变量 5）：explicit → confirmed；deterministic → 只能 candidate；lineage → 显式继承的父边状态，缺省 candidate。 */
export function initialRelationState(source: RelationSource, inherited: RelationState | undefined): RelationState {
  if (source === RelationSource.Explicit) return RelationState.Confirmed
  if (source === RelationSource.Lineage && inherited !== undefined) return inherited
  return RelationState.Candidate
}

export interface RelationInput {
  readonly from: EntityId
  readonly to: EntityId
  readonly type: RelationType
  readonly source: RelationSource
  readonly inheritedState: RelationState | undefined
}

/** 由规则生成一条关系：类别由类型决定，起始状态由来源决定，调用方无法越过规则。 */
export function makeRelation(input: RelationInput): Relation {
  return {
    from: input.from,
    to: input.to,
    type: input.type,
    class: relationClassOf(input.type),
    source: input.source,
    state: initialRelationState(input.source, input.inheritedState),
  }
}

/** 依赖环检测：在有方向依赖边（blocks / depends_on）上找第一个环，返回环上实体 id；无环返回 undefined。 */
export function detectDependencyCycle(relations: readonly Relation[]): readonly EntityId[] | undefined {
  const adjacency = new Map<EntityId, EntityId[]>()
  for (const relation of relations) {
    if (!isDependencyRelation(relation.type)) continue
    const next = adjacency.get(relation.from)
    if (next === undefined) adjacency.set(relation.from, [relation.to])
    else next.push(relation.to)
  }
  const settled = new Set<EntityId>()
  const path: EntityId[] = []

  const walk = (node: EntityId): readonly EntityId[] | undefined => {
    const at = path.indexOf(node)
    if (at !== -1) return path.slice(at)
    if (settled.has(node)) return undefined
    path.push(node)
    const found = (adjacency.get(node) ?? [])
      .map((next) => walk(next))
      .find((cycle) => cycle !== undefined)
    path.pop()
    if (found === undefined) settled.add(node)
    return found
  }

  for (const node of adjacency.keys()) {
    const cycle = walk(node)
    if (cycle !== undefined) return cycle
  }
  return undefined
}
