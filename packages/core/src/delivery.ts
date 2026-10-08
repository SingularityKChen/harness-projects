/**
 * 交付投影：把交付链读成可查询的跳（hop）列表与能力状态（issue #78 / ExecPlan D5、D6）。每一跳都是关系图里的一条边，读回时标
 * `lineage`（沿已记录关系传播，不重新识别）；来源与确认态分开暴露（`relationSource` / `relationState`），候选边因此不会被读成
 * 已确认关系。缺可选能力（部署 / 环境）只报 unavailable，不是 error；只读交付方的写尝试返回 not supported，不写状态也不假造"已保存"。
 * 交付事实只有一个写者（`delivery-facts.ts` 的 `refreshDeliveryFacts`，#221）；本文件的读路径只读本地已提交的最后确认快照，逐跳带 `stale`。
 */
import {
  CapabilityKey, ProjectErrorCode, projectError, type ExternalObjectRef, type ProjectError,
} from '@harness-projects/capabilities'
import {
  EntityKind, RelationSource, RelationState, RelationType, WriteState, type EngineeringFactKind, type EntityId, type Relation,
} from '@harness-projects/domain'
import { gateCommand, resolveWriteTarget, toProjectError, unsupportedCapability } from './capabilities.ts'
import { worktreeEntityId, type DeliveryScopeInput } from './chain-facts.ts'
import type { CoreContext } from './context.ts'
import { refreshDeliveryFacts } from './delivery-facts.ts'
import { contextIdFor } from './execution-context.ts'
import { EdgeProvenance, asEntityId } from './relations.ts'

export type DeliveryScope = string | DeliveryScopeInput

export interface DeliveryLineageHop {
  readonly relationType: RelationType; readonly source: RelationSource // source 恒为 lineage：沿已记录关系走到的，不是重新识别
  readonly relationSource: RelationSource; readonly relationState: RelationState; readonly provenance: EdgeProvenance
  readonly from: EntityId; readonly to: EntityId; readonly entityKind: EntityKind
  readonly externalId: string | undefined; readonly label: string | undefined; readonly observed: boolean
  readonly unavailable: boolean; readonly detail: string | undefined
  readonly fact: EngineeringFactKind | undefined // 这一跳隐含的工程事实（CI 成功/失败）：只能折成派生标记
  /** 这一跳来自最近一次刷新没能重新确认的集合：是最后确认的值，不是当前值（#221）；`tracks` / `has_worktree` 是命令事实，恒为 false。 */
  readonly stale: boolean
}

export interface DeliveryCapabilityState { readonly key: CapabilityKey; readonly available: boolean; readonly reason: string | undefined }

export interface DeliveryProjection {
  readonly workItemId: string; readonly repositoryId: string | undefined
  readonly hops: readonly DeliveryLineageHop[]; readonly optional: readonly DeliveryCapabilityState[]
  readonly degraded: boolean; readonly error: ProjectError | undefined
}

export interface DeliveryWriteAttempt {
  readonly supported: boolean; readonly writeState: WriteState; readonly saving: boolean
  readonly confirmed: boolean; readonly error: ProjectError | undefined
}

export function normalizeScope(scope: DeliveryScope): DeliveryScopeInput {
  if (typeof scope === 'string') return { workItemId: scope, repositoryId: undefined }
  return { workItemId: scope.workItemId, repositoryId: scope.repositoryId }
}

/** 集合 → 它的实体种类、谱系边类型；流水线与检查的能力键用来在本地 registry 上报 unavailable。 */
const SETS = [
  { kind: 'commit', entity: EntityKind.Commit, edge: RelationType.DerivedFrom, key: undefined },
  { kind: 'change_request', entity: EntityKind.ChangeRequest, edge: RelationType.ProducedBy, key: undefined },
  { kind: 'pipeline_run', entity: EntityKind.PipelineRun, edge: RelationType.RunsOn, key: CapabilityKey.DeliveryPipelineRead },
  { kind: 'check_run', entity: EntityKind.CheckRun, edge: RelationType.RunsOn, key: CapabilityKey.DeliveryCheckRead },
] as const

/** 可选能力读结论：缺能力是 unavailable（可恢复说明），不是 error。 */
export function capabilityState(context: CoreContext, key: CapabilityKey): DeliveryCapabilityState {
  const gate = gateCommand(context.registry, key, 'read')
  return { key, available: gate.allowed, reason: gate.allowed ? undefined : gate.error?.message ?? '能力不可用' }
}

function optionalCapabilities(context: CoreContext): readonly DeliveryCapabilityState[] {
  return [capabilityState(context, CapabilityKey.DeliveryDeploymentRead)]
}

/**
 * 只读已提交事实（#221）：执行上下文记录、关系表、交付事实快照与本地 registry；不调 provider，不写任何东西。
 * tracks / has_worktree 只在开始工作写过时出现；其余每一跳是快照里的一个节点加上它在关系表里的那条边（身份沿谱系传播，不重新识别）。
 */
export async function readDeliveryProjection(context: CoreContext, scope: DeliveryScopeInput): Promise<DeliveryProjection> {
  const contextId = contextIdFor(context.workspaceId, scope.workItemId, scope.repositoryId ?? '')
  const contextEntity = asEntityId(contextId)
  const record = await context.storage.getExecutionContext(contextId)
  const snapshot = record === undefined ? undefined : await context.storage.getDeliveryFacts(context.workspaceId, contextId)
  // 快照在先、关系在后：写者在一个事务里同时提交两者、且从不删边，两次读取之间提交了新刷新，较晚读到的关系只会更全，不会比快照少。
  const relations = await context.storage.listRelations(context.workspaceId)
  const worktreeId = worktreeEntityId(context.workspaceId, record?.repositoryId ?? scope.repositoryId ?? '', scope.workItemId)
  const hop = (relation: Relation | undefined, entityKind: EntityKind, node: { externalId: string | undefined; label: string | undefined; fact?: EngineeringFactKind | undefined },
    provenance: EdgeProvenance, stale = false, key?: CapabilityKey): DeliveryLineageHop[] => relation === undefined ? [] : [{
    relationType: relation.type, source: RelationSource.Lineage, relationSource: relation.source, relationState: relation.state,
    provenance, from: relation.from, to: relation.to, entityKind, externalId: node.externalId, label: node.label, observed: true, detail: undefined, fact: node.fact, stale,
    unavailable: key !== undefined && !gateCommand(context.registry, key, 'read').allowed,
  }]
  const hops = record === undefined ? [] : [
    ...hop(relations.find((relation) => relation.type === RelationType.Tracks && relation.to === contextEntity), EntityKind.ExecutionContext,
      { externalId: contextId, label: undefined }, EdgeProvenance.Command),
    ...hop(relations.find((relation) => relation.type === RelationType.HasWorktree && relation.from === contextEntity && relation.to === worktreeId), EntityKind.Worktree,
      { externalId: record.worktreeExternalId, label: record.branchExternalId }, EdgeProvenance.Command),
    ...SETS.flatMap(({ kind, entity, edge, key }) => {
      const set = snapshot?.sets.find((candidate) => candidate.kind === kind)
      return (set?.nodes ?? []).flatMap((node) => hop(relations.find((candidate) => candidate.from === node.entityId && candidate.type === edge && candidate.to === set?.anchorId),
        entity, node, EdgeProvenance.ProviderRead, set?.stale, key))
    }),
  ]
  return {
    workItemId: scope.workItemId, repositoryId: scope.repositoryId, hops, optional: optionalCapabilities(context),
    degraded: snapshot?.sets.some((set) => set.stale) ?? false, error: undefined,
  }
}

/** 交付投影：#221 期间先委托唯一写者刷新（会写候选边与快照）、再读已提交事实；#222 起查询纯读，去掉刷新这一行。 */
export async function getDeliveryProjection(context: CoreContext, scope: DeliveryScope): Promise<DeliveryProjection> {
  const normalized = normalizeScope(scope)
  if (normalized.workItemId.trim() === '') {
    return {
      workItemId: normalized.workItemId, repositoryId: normalized.repositoryId, hops: [], optional: optionalCapabilities(context),
      degraded: true, error: projectError(ProjectErrorCode.InvalidInput, 'workItemId 不能为空'),
    }
  }
  const refreshed = await refreshDeliveryFacts(context, normalized) // #222 删除这一行
  const projection = await readDeliveryProjection(context, normalized)
  // 刷新失败、被丢弃（平手或更晚的并发读取已提交）或没有锚点（工作树句柄被清空）而仍显示旧快照时，不能证明它是最新：降级并逐跳标陈旧（controller 只转发跳）。
  const unconfirmed = !refreshed.ok || (!refreshed.applied && (refreshed.anchored || projection.hops.some((hop) => hop.provenance === EdgeProvenance.ProviderRead)))
  const hops = unconfirmed ? projection.hops.map((hop) => hop.provenance === EdgeProvenance.ProviderRead ? { ...hop, stale: true } : hop) : projection.hops
  return { ...projection, hops, degraded: projection.degraded || unconfirmed || refreshed.gaps.length > 0, error: refreshed.error }
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
  if (!result.ok) return { supported: true, writeState: WriteState.Failed, saving: false, confirmed: false, error: toProjectError(result.error) }
  return { supported: true, writeState: WriteState.Saved, saving: false, confirmed: true, error: undefined }
}
