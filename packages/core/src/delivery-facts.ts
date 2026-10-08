/**
 * 交付事实的唯一写者（#221，ADR-0011）：事务外读 provider，再在**一个**事务里登记端点实体、写候选谱系边（只有 derived_from / produced_by / runs_on，
 * TD-009、TD-014）并整行覆盖本上下文的快照。完整读到的集合整组替换（含删除），其余原样保留并标陈旧；不推进修订号（K1），任何异常都折成结构化结果（K2）。
 */
import { CapabilityKey, ProjectErrorCode, projectError, type DeliveryFactSetKind, type DeliveryFactsRecord, type DeliveryNodeFact, type ProjectError } from '@harness-projects/capabilities'
import { RelationType, type ExecutionContextId } from '@harness-projects/domain'
import { readChainFacts, type CapabilityGap, type ChainFacts, type DeliveryScopeInput } from './chain-facts.ts'
import type { CoreContext } from './context.ts'
import { contextIdFor } from './execution-context.ts'
import { EdgeProvenance, recordEdges, type ChainNode, type DiscoveredEdge } from './relations.ts'

export interface DeliveryRefreshResult {
  /** 读取或提交失败为 false；provider 读不全不是失败（那是 `gaps`，对应集合保留并标陈旧）。 */
  readonly ok: boolean
  /** 有已观察到的执行上下文与工作树：没有锚点时什么也不写；读取阶段就失败时还不知道，记为 false。 */
  readonly anchored: boolean
  /** 本次读取被提交。没有锚点、读取或提交失败、令牌平手或更晚的读取已先提交（乱序守卫）时都为 false。 */
  readonly applied: boolean
  readonly gaps: readonly CapabilityGap[]
  readonly error: ProjectError | undefined
}

const SET_KINDS: readonly DeliveryFactSetKind[] = ['commit', 'change_request', 'pipeline_run', 'check_run']

/** 完整性：锚点完整读到、且自己的读取没有缺口，集合才算完整；锚点被完整读到而确认不存在时（没有 head），下游是完整的空集合。只消费缺口的能力键与节点的 `observed`（K4）。 */
function completeSets(facts: ChainFacts): ReadonlySet<DeliveryFactSetKind> {
  const gap = (key: CapabilityKey): boolean => facts.gaps.some((item) => item.key === key)
  const complete = new Set<DeliveryFactSetKind>()
  if (gap(CapabilityKey.DevelopmentRepositoryRead)) return complete
  complete.add('commit')
  const head = facts.commit.observed
  if (!head || !gap(CapabilityKey.DevelopmentChangeRequestRead)) complete.add('change_request')
  if (!head || !gap(CapabilityKey.DeliveryPipelineRead)) complete.add('pipeline_run')
  if (complete.has('change_request') && (!facts.changeRequest.observed || !gap(CapabilityKey.DeliveryCheckRead))) complete.add('check_run')
  return complete
}

/** 每个集合的已观察节点、它们挂的锚点与边类型：提交与变更请求挂工作树，流水线挂提交，检查挂变更请求。 */
function setOf(facts: ChainFacts, kind: DeliveryFactSetKind): { nodes: readonly ChainNode[]; anchor: ChainNode; type: RelationType } {
  const seen = (nodes: readonly ChainNode[]) => nodes.filter((node) => node.observed)
  if (kind === 'commit') return { nodes: seen([facts.commit]), anchor: facts.worktree, type: RelationType.DerivedFrom }
  if (kind === 'change_request') return { nodes: seen([facts.changeRequest]), anchor: facts.worktree, type: RelationType.ProducedBy }
  if (kind === 'pipeline_run') return { nodes: seen(facts.pipelines), anchor: facts.commit, type: RelationType.RunsOn }
  return { nodes: seen(facts.checks), anchor: facts.changeRequest, type: RelationType.RunsOn }
}

const toFact = (node: ChainNode): DeliveryNodeFact => ({ entityId: node.id, externalId: node.externalId ?? '', label: node.label, fact: node.fact })
/** 已提交的快照不比本次读取旧（`>=`，平手也算）：本次是乱序的旧读取，或平手的并发读取，不得覆盖它；只有严格更新的读取能覆盖。 */
const superseded = (record: DeliveryFactsRecord | undefined, attemptedAt: string): boolean => record !== undefined && Date.parse(record.attemptedAt) >= Date.parse(attemptedAt)

/**
 * 读取开始时刻，同时是乱序令牌（I6）：取墙钟、「已提交的 `attemptedAt` 加 1 毫秒」、「同一个上下文对象内上一次令牌加 1 毫秒」的最大值，对任何先于本次读取
 * 提交的刷新严格递增，与墙钟、上下文对象、重启和时钟回拨都无关；只有读取开始时彼此看不见的并发刷新（只可能来自不同对象）才会平手，先提交者胜。
 */
const issued = new WeakMap<CoreContext, number>()
async function attemptedAtFor(context: CoreContext, contextId: ExecutionContextId): Promise<string> {
  const committed = await (async () => Date.parse((await context.storage.getDeliveryFacts(context.workspaceId, contextId))?.attemptedAt ?? '') || 0)().catch(() => 0)
  const at = Math.max(Date.parse(context.clock()) || 0, committed + 1, (issued.get(context) ?? 0) + 1)
  issued.set(context, at)
  return new Date(at).toISOString()
}

export async function refreshDeliveryFacts(context: CoreContext, scope: DeliveryScopeInput): Promise<DeliveryRefreshResult> {
  const contextId = contextIdFor(context.workspaceId, scope.workItemId, scope.repositoryId ?? '')
  const attemptedAt = await attemptedAtFor(context, contextId)
  let gaps: readonly CapabilityGap[] = []
  let anchored = false
  try {
    const facts = await readChainFacts(context, scope)
    gaps = facts.gaps
    if (!facts.context.observed || !facts.worktree.observed) return { ok: true, anchored: false, applied: false, gaps, error: undefined }
    anchored = true
    const complete = completeSets(facts)
    const sets = SET_KINDS.map((kind) => ({ kind, confirmed: complete.has(kind), ...setOf(facts, kind) }))
    const applied = await context.storage.transaction(async (tx) => {
      const existing = await tx.getDeliveryFacts(context.workspaceId, contextId)
      if (superseded(existing, attemptedAt)) return false
      const edges: DiscoveredEdge[] = sets.filter((set) => set.confirmed).flatMap(({ nodes, anchor, type }) =>
        nodes.map((node) => ({ from: node.id, to: anchor.id, type, artifact: node, provenance: EdgeProvenance.ProviderRead })))
      // 端点先登记：SQLite 的关系表两端有外键指向 entity（迁移 003），替身与它同语义（#221）。
      for (const { artifact } of edges) await tx.putEntity({ id: artifact.id, kind: artifact.kind })
      await recordEdges({ workspaceId: context.workspaceId, storage: tx }, edges)
      await tx.putDeliveryFacts({
        workspaceId: context.workspaceId, contextId, attemptedAt,
        sets: sets.map(({ kind, confirmed, nodes, anchor }) => confirmed
          ? { kind, anchorId: anchor.id, confirmedAt: attemptedAt, stale: false, nodes: nodes.map(toFact) }
          : { ...(existing?.sets.find((set) => set.kind === kind) ?? { kind, anchorId: undefined, confirmedAt: undefined, nodes: [] }), stale: true }),
      })
      return true
    })
    return { ok: true, anchored: true, applied, gaps, error: undefined }
  } catch {
    // K2：读取或提交失败不裸抛。已确认的事实随回滚保持原样；尽力把这次尝试记成陈旧（全部集合标 stale），这一步再失败也只吞掉，返回结构化失败。
    await context.storage.transaction(async (tx) => {
      const existing = await tx.getDeliveryFacts(context.workspaceId, contextId)
      if (existing !== undefined && !superseded(existing, attemptedAt)) await tx.putDeliveryFacts({ ...existing, attemptedAt, sets: existing.sets.map((set) => ({ ...set, stale: true })) })
    }).catch(() => undefined)
    return { ok: false, anchored, applied: false, gaps, error: projectError(ProjectErrorCode.Unavailable, '交付事实未能提交；已确认的事实保持不变') }
  }
}
