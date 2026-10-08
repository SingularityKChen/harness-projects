/**
 * 交付投影：把交付链读成可查询的跳（hop）列表与能力状态（issue #78 / ExecPlan D5、D6）。每一跳都是关系图里的一条边，读回时标
 * `lineage`（沿已记录关系传播，不重新识别）；来源与确认态分开暴露（`relationSource` / `relationState`），候选边因此不会被读成
 * 已确认关系。缺可选能力（部署 / 环境）只报 unavailable，不是 error；只读交付方的写尝试返回 not supported，不写状态也不假造"已保存"。
 * 交付事实只有一个写者（`delivery-facts.ts` 的 `refreshDeliveryFacts`，#221），只经显式命令 `commands.refreshDeliveryFacts` 触发；本文件的读路径只读本地
 * 已提交的最后确认快照，逐跳带 `stale`，逐集合带 `freshness`，逐位置带 `gaps`（#222）。
 */
import {
  CapabilityKey, ProjectErrorCode, projectError, type DeliveryFactSetKind, type ExternalObjectRef, type ProjectError,
} from '@harness-projects/capabilities'
import {
  EntityKind, RelationSource, RelationState, RelationType, WriteState, type EngineeringFactKind, type EntityId, type Relation,
} from '@harness-projects/domain'
import { gateCommand, resolveWriteTarget, toProjectError, unsupportedCapability } from './capabilities.ts'
import { worktreeEntityId, type DeliveryScopeInput } from './chain-facts.ts'
import type { CoreContext } from './context.ts'
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

/**
 * 一个集合的新鲜度（#222）：`confirmedAt` 是最后一次完整确认时那次读取开始的墙钟读数；`stale` 只说明最近一次刷新尝试没能重新确认，不含年龄，
 * `stale: false` 不等于新近。年龄只能从 `confirmedAt` 起算（`max(0, now − confirmedAt)`），不能用 `attemptedAt`；年龄规则是 `ui-model` 里以当前时间为参数的
 * 纯函数，由 #281 / #234 的验收承接（ADR-0011 第 3 条）。
 */
export interface DeliveryFreshness { readonly kind: DeliveryFactSetKind; readonly confirmedAt: string | undefined; readonly stale: boolean }

/** 链上没有跳的位置为什么没有跳（#222）：读时由本地事实算出，不落库，也不进关系表。 */
export const DeliveryGapReason = { NotStarted: 'not_started', NotObserved: 'not_observed', NotRefreshed: 'not_refreshed', Unconfirmed: 'unconfirmed' } as const
export type DeliveryGapReason = (typeof DeliveryGapReason)[keyof typeof DeliveryGapReason]
export interface DeliveryGap { readonly entityKind: EntityKind; readonly reason: DeliveryGapReason }

export interface DeliveryProjection {
  /** 作用域无效（缺失、工作项不是字符串）时为 undefined，同时带 `invalid_input`。 */
  readonly workItemId: string | undefined; readonly repositoryId: string | undefined
  readonly hops: readonly DeliveryLineageHop[]; readonly optional: readonly DeliveryCapabilityState[]
  /** 已开始工作，但从未刷新或有集合陈旧；只反映最近一次刷新的结果，不含年龄（见 `DeliveryFreshness`）。没有执行上下文时不算降级，那时只有 `not_started` 缺口。 */
  readonly degraded: boolean; readonly error: ProjectError | undefined
  /** 快照的 `attemptedAt`：最近一次记下快照的刷新尝试（被应用的刷新，或没能重新确认而把集合标陈旧的尝试）的乱序令牌；只用来定序，可能领先墙钟，不得展示、不得做减法。从未刷新时为 undefined。 */
  readonly attemptedAt: string | undefined
  /** 快照四个集合的新鲜度；从未刷新时为 `[]`。 */
  readonly freshness: readonly DeliveryFreshness[]
  /** 链上没有跳的位置，按链的顺序；节点出现后由同一个确定性身份落一条关系，缺口随之消失。 */
  readonly gaps: readonly DeliveryGap[]
}

export interface DeliveryWriteAttempt {
  readonly supported: boolean; readonly writeState: WriteState; readonly saving: boolean
  readonly confirmed: boolean; readonly error: ProjectError | undefined
}

/** 归一后的作用域：整个作用域缺失（`undefined` / `null`）或工作项不是字符串时 `workItemId` 为 `undefined`，不在这里抛 TypeError；用之前必须过 `isDeliveryScope`。 */
export interface NormalizedDeliveryScope { readonly workItemId: string | undefined; readonly repositoryId: string | undefined }
export function normalizeScope(scope: DeliveryScope | null | undefined): NormalizedDeliveryScope {
  if (typeof scope === 'string') return { workItemId: scope, repositoryId: undefined }
  return { workItemId: typeof scope?.workItemId === 'string' ? scope.workItemId : undefined, repositoryId: scope?.repositoryId }
}
/** 写者与查询共用的作用域守卫：工作项是非空字符串才有效，tsc 据此把归一后的作用域收窄成 `DeliveryScopeInput`；不过守卫就拿不到 `string`。 */
export const isDeliveryScope = (scope: NormalizedDeliveryScope): scope is DeliveryScopeInput => scope.workItemId !== undefined && scope.workItemId.trim() !== ''

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
  // 缺口：链的六个位置里没有跳的那些，按链的顺序，原因由本地事实算出（不落库）。上下文记录不存在是没开始；记录在而命令边不在是没观察到
  // （开始工作的最终事务失败，TD-009）；其余四个位置看快照：没有快照是从未刷新，集合从未完整读到是未确认，否则是完整读到而为空（确认为没有）。
  const gaps: DeliveryGap[] = []
  const missing = (found: DeliveryLineageHop[], entityKind: EntityKind, reason: DeliveryGapReason): DeliveryLineageHop[] => { if (found.length === 0) gaps.push({ entityKind, reason }); return found }
  const commandReason = record === undefined ? DeliveryGapReason.NotStarted : DeliveryGapReason.NotObserved
  const hops = [
    ...missing(record === undefined ? [] : hop(relations.find((relation) => relation.type === RelationType.Tracks && relation.to === contextEntity), EntityKind.ExecutionContext,
      { externalId: contextId, label: undefined }, EdgeProvenance.Command), EntityKind.ExecutionContext, commandReason),
    ...missing(record === undefined ? [] : hop(relations.find((relation) => relation.type === RelationType.HasWorktree && relation.from === contextEntity && relation.to === worktreeId), EntityKind.Worktree,
      { externalId: record.worktreeExternalId, label: record.branchExternalId }, EdgeProvenance.Command), EntityKind.Worktree, commandReason),
    ...SETS.flatMap(({ kind, entity, edge, key }) => {
      const set = snapshot?.sets.find((candidate) => candidate.kind === kind)
      return missing((set?.nodes ?? []).flatMap((node) => hop(relations.find((candidate) => candidate.from === node.entityId && candidate.type === edge && candidate.to === set?.anchorId),
        entity, node, EdgeProvenance.ProviderRead, set?.stale, key)), entity, record === undefined ? DeliveryGapReason.NotStarted : set === undefined ? DeliveryGapReason.NotRefreshed
        : set.confirmedAt === undefined ? DeliveryGapReason.Unconfirmed : DeliveryGapReason.NotObserved)
    }),
  ]
  return {
    workItemId: scope.workItemId, repositoryId: scope.repositoryId, hops, optional: optionalCapabilities(context),
    degraded: record !== undefined && (snapshot === undefined || snapshot.sets.some((set) => set.stale)), error: undefined,
    attemptedAt: snapshot?.attemptedAt, freshness: (snapshot?.sets ?? []).map(({ kind, confirmedAt, stale }) => ({ kind, confirmedAt, stale })), gaps,
  }
}

/** 交付投影（#222）：纯读已提交事实，不调 provider、不写任何东西；交付事实只经 `commands.refreshDeliveryFacts` 摄入。 */
export async function getDeliveryProjection(context: CoreContext, scope: DeliveryScope): Promise<DeliveryProjection> {
  const normalized = normalizeScope(scope)
  if (!isDeliveryScope(normalized)) {
    return {
      workItemId: normalized.workItemId, repositoryId: normalized.repositoryId, hops: [], optional: optionalCapabilities(context),
      degraded: true, error: projectError(ProjectErrorCode.InvalidInput, 'workItemId 不能为空'), attemptedAt: undefined, freshness: [], gaps: [],
    }
  }
  return readDeliveryProjection(context, normalized)
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
