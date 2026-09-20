/**
 * 交付投影：把交付链读成可查询的跳（hop）列表与能力状态（issue #78 / ExecPlan D5、D6）。
 *
 * 投影只承载四类内容：链路事实、provider 能力状态、派生标记与新鲜度说明。每一跳都是关系图里的一条
 * 边，读回时标 `lineage`（沿已记录关系传播，不重新识别对象）；底层来源与确认态分开暴露
 * （`relationSource` / `relationState`），因此候选边不会被读成已确认关系。
 *
 * 缺可选能力（部署 / 环境）只报 unavailable，不是 error；对只读交付方的写尝试返回 not supported，
 * 且不写本地状态、不假造"已保存"。
 */
import {
  CapabilityKey, ProjectErrorCode, projectError,
  type ExternalObjectRef, type ProjectError,
} from '@harness-projects/capabilities'
import {
  EntityKind, RelationSource, RelationState, RelationType, WriteState,
  type EngineeringFactKind, type EntityId, type Relation,
} from '@harness-projects/domain'
import { gateCommand, resolveWriteTarget, toProjectError, unsupportedCapability } from './capabilities.ts'
import {
  readChainFacts, type CapabilityGap, type ChainFacts, type DeliveryScopeInput,
} from './chain-facts.ts'
import type { CoreContext } from './context.ts'
import { EdgeProvenance, recordEdges, type ChainNode, type DiscoveredEdge } from './relations.ts'

export type DeliveryScope = string | DeliveryScopeInput

export interface DeliveryLineageHop {
  readonly relationType: RelationType
  /** 恒为 lineage：这一跳是沿已记录关系走到的，不是重新识别。 */
  readonly source: RelationSource
  readonly relationSource: RelationSource
  readonly relationState: RelationState
  readonly provenance: EdgeProvenance
  readonly from: EntityId
  readonly to: EntityId
  readonly entityKind: EntityKind
  readonly externalId: string | undefined
  readonly label: string | undefined
  readonly observed: boolean
  readonly unavailable: boolean
  readonly detail: string | undefined
  /** 这一跳隐含的工程事实（CI 成功/失败）：调用方只能把它折成派生标记。 */
  readonly fact: EngineeringFactKind | undefined
}

export interface DeliveryCapabilityState {
  readonly key: CapabilityKey; readonly available: boolean; readonly reason: string | undefined
}

export interface DeliveryProjection {
  readonly workItemId: string
  readonly repositoryId: string | undefined
  readonly hops: readonly DeliveryLineageHop[]
  readonly optional: readonly DeliveryCapabilityState[]
  readonly degraded: boolean
  readonly error: ProjectError | undefined
}

export interface DeliveryWriteAttempt {
  readonly supported: boolean
  readonly writeState: WriteState
  readonly saving: boolean
  readonly confirmed: boolean
  readonly error: ProjectError | undefined
}

export function normalizeScope(scope: DeliveryScope): DeliveryScopeInput {
  if (typeof scope === 'string') return { workItemId: scope, repositoryId: undefined }
  return { workItemId: scope.workItemId, repositoryId: scope.repositoryId }
}

/** 未观察到的事实只能算链骨架：provenance 决定它落成 candidate，而不是已确认的系统事实。 */
function provenanceFor(artifact: ChainNode, declared: EdgeProvenance): EdgeProvenance {
  return artifact.observed ? declared : EdgeProvenance.ChainSkeleton
}

/** 链的边：tracks / has_worktree / derived_from / produced_by / runs_on；跳的顺序即链的顺序。 */
export function chainEdges(facts: ChainFacts): readonly DiscoveredEdge[] {
  const { workItem, context, worktree, commit, changeRequest } = facts
  const edges: DiscoveredEdge[] = [
    { from: workItem.id, to: context.id, type: RelationType.Tracks, artifact: context, provenance: provenanceFor(context, EdgeProvenance.Command) },
    { from: context.id, to: worktree.id, type: RelationType.HasWorktree, artifact: worktree, provenance: provenanceFor(worktree, EdgeProvenance.Command) },
    { from: commit.id, to: worktree.id, type: RelationType.DerivedFrom, artifact: commit, provenance: provenanceFor(commit, EdgeProvenance.ProviderRead) },
    { from: changeRequest.id, to: worktree.id, type: RelationType.ProducedBy, artifact: changeRequest, provenance: provenanceFor(changeRequest, EdgeProvenance.ProviderRead) },
  ]
  for (const pipeline of facts.pipelines) {
    edges.push({ from: pipeline.id, to: commit.id, type: RelationType.RunsOn, artifact: pipeline, provenance: provenanceFor(pipeline, EdgeProvenance.ProviderRead) })
  }
  for (const check of facts.checks) {
    edges.push({ from: check.id, to: changeRequest.id, type: RelationType.RunsOn, artifact: check, provenance: provenanceFor(check, EdgeProvenance.ProviderRead) })
  }
  return edges
}

function gapKeysFor(kind: EntityKind): readonly CapabilityKey[] {
  if (kind === EntityKind.PipelineRun) return [CapabilityKey.DeliveryPipelineRead]
  if (kind === EntityKind.CheckRun) return [CapabilityKey.DeliveryCheckRead]
  return []
}

function toHop(edge: DiscoveredEdge, relation: Relation, gaps: readonly CapabilityGap[]): DeliveryLineageHop {
  const keys = gapKeysFor(edge.artifact.kind)
  return {
    relationType: relation.type, source: RelationSource.Lineage, relationSource: relation.source,
    relationState: relation.state, provenance: edge.provenance, from: relation.from, to: relation.to,
    entityKind: edge.artifact.kind, externalId: edge.artifact.externalId, label: edge.artifact.label,
    observed: edge.artifact.observed, detail: edge.artifact.detail, fact: edge.artifact.fact,
    unavailable: gaps.some((gap) => keys.includes(gap.key)),
  }
}

/** 可选能力读结论：缺能力是 unavailable（可恢复说明），不是 error。 */
export function capabilityState(context: CoreContext, key: CapabilityKey): DeliveryCapabilityState {
  const gate = gateCommand(context.registry, key, 'read')
  return { key, available: gate.allowed, reason: gate.allowed ? undefined : gate.error?.message ?? '能力不可用' }
}

function optionalCapabilities(context: CoreContext): readonly DeliveryCapabilityState[] {
  return [capabilityState(context, CapabilityKey.DeliveryDeploymentRead)]
}

/** 组装交付投影：先读链事实，再把每一跳按三元组落成候选边（已存在则复用），最后读回成跳。 */
export async function getDeliveryProjection(context: CoreContext, scope: DeliveryScope): Promise<DeliveryProjection> {
  const normalized = normalizeScope(scope)
  if (normalized.workItemId.trim() === '') {
    return {
      workItemId: normalized.workItemId, repositoryId: normalized.repositoryId, hops: [],
      optional: optionalCapabilities(context), degraded: true,
      error: projectError(ProjectErrorCode.InvalidInput, 'workItemId 不能为空'),
    }
  }
  const facts = await readChainFacts(context, normalized)
  const edges = chainEdges(facts)
  const recorded = await recordEdges(context, edges)
  const hops: DeliveryLineageHop[] = []
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index]
    const relation = recorded[index]?.relation
    if (edge !== undefined && relation !== undefined) hops.push(toHop(edge, relation, facts.gaps))
  }
  return {
    workItemId: normalized.workItemId, repositoryId: normalized.repositoryId, hops,
    optional: optionalCapabilities(context), degraded: facts.gaps.length > 0, error: undefined,
  }
}

/** 只读交付方的写尝试：能力没声明就 not supported，且不写任何本地或外部状态。 */
export async function rerunPipeline(context: CoreContext, ref: ExternalObjectRef): Promise<DeliveryWriteAttempt> {
  const target = resolveWriteTarget(context.registry, CapabilityKey.DeliveryPipelineRerun)
  const provider = target.binding?.delivery
  if (target.binding === undefined || provider === undefined || provider.rerunPipeline === undefined) {
    const error = target.error ?? unsupportedCapability(CapabilityKey.DeliveryPipelineRerun)
    return { supported: false, writeState: WriteState.Failed, saving: false, confirmed: false, error }
  }
  const result = await provider.rerunPipeline(ref)
  if (!result.ok) {
    return { supported: true, writeState: WriteState.Failed, saving: false, confirmed: false, error: toProjectError(result.error) }
  }
  return { supported: true, writeState: WriteState.Saved, saving: false, confirmed: true, error: undefined }
}
