/**
 * 交付链的 provider 读取（issue #78 / ExecPlan D5）。只读：按提交读流水线、按变更请求读检查、按仓库读分支与变更请求。任何一步缺能力
 * 或 provider 失败都折成一条 `CapabilityGap`，该节点退回骨架（`observed: false`）——读侧降级是"最后已知值 + 显式不可用"，不是异常。
 * 骨架仍有稳定身份（`chainEntityId`），谱系在链路推进前后都查得到且不因重新读取换 id（不变量 6）；本文件不写外部状态，也不触碰规划投影。
 * Gate E1 落地前，同一外部 id 视为各 provider 下的同一对象，E1 通过后由身份表替换这条显式假设。
 */
import { CapabilityKey, type ExternalObjectRef, type ProviderResult, type ResolvedBinding } from '@harness-projects/capabilities'
import { EngineeringFactKind, EntityKind } from '@harness-projects/domain'
import { gateCommand } from './capabilities.ts'
import type { CoreContext } from './context.ts'
import { contextIdFor, readExecutionContext } from './execution-context.ts'
import { branchNameFor, worktreePathFor } from './git-provisioning.ts'
import { asEntityId, chainEntityId, type ChainNode } from './relations.ts'

export interface CapabilityGap { readonly key: CapabilityKey; readonly reason: string }
export interface DeliveryScopeInput { readonly workItemId: string; readonly repositoryId: string | undefined }

export interface ChainFacts {
  readonly workItem: ChainNode; readonly context: ChainNode; readonly worktree: ChainNode; readonly commit: ChainNode
  readonly changeRequest: ChainNode; readonly pipelines: readonly ChainNode[]; readonly checks: readonly ChainNode[]
  readonly gaps: readonly CapabilityGap[]
}

type ReadResult<T> = { readonly value: T | undefined; readonly gap: CapabilityGap | undefined }
interface ChangeRequestFact { readonly ref: ExternalObjectRef; readonly label: string }

const PAGE_LIMIT = 50

export function chainNode(id: ChainNode['id'], kind: EntityKind, externalId: string | undefined,
  label: string | undefined, observed: boolean, detail?: string, fact?: EngineeringFactKind): ChainNode {
  return { id, kind, externalId, label, observed, detail, fact }
}

/** CI 观察 → 工程事实种类：只有明确的结论才算事实，其余（进行中 / 排队）不猜。 */
function factFor(conclusion: string | undefined): EngineeringFactKind | undefined {
  if (conclusion === 'failure') return EngineeringFactKind.CiFailed
  return conclusion === 'success' ? EngineeringFactKind.CiPassed : undefined
}

/** 读能力门：未声明/只读以外一律折成 gap；provider 缺失也走同一条路，调用方永远拿到结构化结论。 */
async function gated<T>(context: CoreContext, key: CapabilityKey,
  run: (binding: ResolvedBinding) => Promise<ProviderResult<T>> | undefined): Promise<ReadResult<T>> {
  const gate = gateCommand(context.registry, key, 'read')
  if (!gate.allowed) return { value: undefined, gap: { key, reason: gate.error?.message ?? '能力不可用' } }
  const binding = context.registry.bindings.find((item) => item.ref.bindingId === gate.bindingId)
  if (binding === undefined) return { value: undefined, gap: { key, reason: '提供该能力的绑定已失效' } }
  const pending = run(binding)
  if (pending === undefined) return { value: undefined, gap: { key, reason: '绑定没有该域的 provider 实例' } }
  const result = await pending
  if (!result.ok) return { value: undefined, gap: { key, reason: result.error.message } }
  return { value: result.value, gap: undefined }
}

function collect(gaps: CapabilityGap[], gap: CapabilityGap | undefined): void { if (gap !== undefined) gaps.push(gap) }

async function resolveRepository(context: CoreContext, repositoryId: string, gaps: CapabilityGap[]): Promise<ExternalObjectRef | undefined> {
  const key = CapabilityKey.DevelopmentRepositoryRead
  const gate = gateCommand(context.registry, key, 'read')
  if (!gate.allowed || gate.bindingId === undefined) {
    collect(gaps, { key, reason: gate.error?.message ?? '不能定位仓库绑定的 capability' })
    return undefined
  }
  return { bindingId: gate.bindingId, objectKind: 'repository', externalId: repositoryId, url: undefined }
}

async function readHeadCommit(context: CoreContext, repository: ExternalObjectRef, branch: string, gaps: CapabilityGap[]): Promise<string | undefined> {
  const read = await gated(context, CapabilityKey.DevelopmentRepositoryRead, (binding) =>
    binding.development?.listBranches({ repository, cursor: undefined, limit: PAGE_LIMIT }))
  collect(gaps, read.gap)
  return read.value?.items.find((item) => item.name === branch)?.headCommit
}

/** 只认头部提交匹配的变更请求：不匹配就当没观察到，绝不把别的分支的提交挂到本链上。 */
async function readChangeRequest(context: CoreContext, repository: ExternalObjectRef, head: string, gaps: CapabilityGap[]): Promise<ChangeRequestFact | undefined> {
  const read = await gated(context, CapabilityKey.DevelopmentChangeRequestRead, (binding) =>
    binding.development?.listChangeRequests({ repository, cursor: undefined, limit: PAGE_LIMIT }))
  collect(gaps, read.gap)
  const found = (read.value?.items ?? []).find((item) => item.sourceVersion === head)
  return found === undefined ? undefined : { ref: found.ref, label: `#${found.number} ${found.title}` }
}

/** 每个能力域各自的引用由提供该能力的 binding 构造：交付方读到的是它自己 binding 下的仓库对象。 */
function refFor(binding: ResolvedBinding, kind: string, externalId: string): ExternalObjectRef {
  return { bindingId: binding.ref.bindingId, objectKind: kind, externalId, url: undefined }
}

async function readPipelines(context: CoreContext, repositoryId: string, commit: string | undefined, gaps: CapabilityGap[]): Promise<readonly ChainNode[]> {
  const read = await gated(context, CapabilityKey.DeliveryPipelineRead, (binding) =>
    binding.delivery?.listPipelineRuns({ repository: refFor(binding, 'repository', repositoryId), commit, cursor: undefined, limit: PAGE_LIMIT }))
  collect(gaps, read.gap)
  return (read.value?.items ?? []).map((run) => chainNode(
    chainEntityId(context.workspaceId, EntityKind.PipelineRun, `${run.ref.bindingId}|${run.ref.externalId}`),
    EntityKind.PipelineRun, run.ref.externalId, `${run.status}: ${run.conclusion ?? '未完成'}`, true,
    undefined, factFor(run.conclusion),
  ))
}

async function readChecks(context: CoreContext, changeRequestId: string, gaps: CapabilityGap[]): Promise<readonly ChainNode[]> {
  const read = await gated(context, CapabilityKey.DeliveryCheckRead, (binding) =>
    binding.delivery?.listChecks({ changeRequest: refFor(binding, 'change_request', changeRequestId), cursor: undefined, limit: PAGE_LIMIT }))
  collect(gaps, read.gap)
  return (read.value?.items ?? []).map((check) => chainNode(
    chainEntityId(context.workspaceId, EntityKind.CheckRun, `${check.ref.bindingId}|${check.ref.externalId}`),
    EntityKind.CheckRun, check.ref.externalId, `${check.name}: ${check.conclusion ?? check.status}`, true,
    undefined, factFor(check.conclusion),
  ))
}

async function workItemNode(context: CoreContext, workItemId: string): Promise<ChainNode> {
  for (const projection of await context.storage.listPlanningProjections(context.workspaceId)) {
    if (projection.entityId === workItemId) return chainNode(projection.entityId, EntityKind.WorkItem, workItemId, undefined, true)
    const identities = await context.storage.listIdentitiesForEntity(projection.entityId)
    if (identities.some((identity) => identity.externalId === workItemId)) {
      return chainNode(projection.entityId, EntityKind.WorkItem, workItemId, undefined, true)
    }
  }
  return chainNode(chainEntityId(context.workspaceId, EntityKind.WorkItem, workItemId), EntityKind.WorkItem, workItemId, undefined, false, '工作项尚未被观察到')
}

function contextNode(context: CoreContext, scope: DeliveryScopeInput, observedId: string | undefined): ChainNode {
  const id = observedId ?? contextIdFor(context.workspaceId, scope.workItemId, scope.repositoryId ?? '')
  const detail = observedId === undefined ? '执行上下文尚未创建' : undefined
  return chainNode(asEntityId(id), EntityKind.ExecutionContext, id, undefined, observedId !== undefined, detail)
}

function worktreeNode(context: CoreContext, scope: DeliveryScopeInput, view: ChainView | undefined, repository: ExternalObjectRef | undefined): ChainNode {
  const branch = view?.branchExternalId ?? branchNameFor(scope.workItemId)
  const slot = view?.worktreeExternalId ?? worktreePathFor(scope.workItemId)
  const observed = view?.worktreeExternalId !== undefined
  return chainNode(chainEntityId(context.workspaceId, EntityKind.Worktree, `${repository?.bindingId ?? 'unbound'}|${slot}`),
    EntityKind.Worktree, slot, branch, observed, observed ? undefined : '工作树尚未创建')
}

function commitNode(context: CoreContext, scope: DeliveryScopeInput, repository: ExternalObjectRef | undefined, branch: string, head: string | undefined): ChainNode {
  const slot = `${repository?.bindingId ?? 'unbound'}|${branch}|${head ?? 'unobserved'}`
  const detail = head === undefined ? `提交尚未观察到（${scope.workItemId} 尚无已建分支的头部提交）` : undefined
  return chainNode(chainEntityId(context.workspaceId, EntityKind.Commit, slot), EntityKind.Commit, head, branch, head !== undefined, detail)
}

function changeRequestNode(context: CoreContext, repository: ExternalObjectRef | undefined, branch: string, fact: ChangeRequestFact | undefined): ChainNode {
  const slot = `${fact?.ref.bindingId ?? repository?.bindingId ?? 'unbound'}|${fact?.ref.externalId ?? branch}`
  return chainNode(chainEntityId(context.workspaceId, EntityKind.ChangeRequest, slot), EntityKind.ChangeRequest,
    fact?.ref.externalId, fact?.label ?? branch, fact !== undefined, fact === undefined ? '变更请求尚未观察到' : undefined)
}

function skeleton(context: CoreContext, kind: EntityKind, slot: string, label: string, detail: string): ChainNode {
  return chainNode(chainEntityId(context.workspaceId, kind, slot), kind, undefined, label, false, detail)
}

type ChainView = Awaited<ReturnType<typeof readExecutionContext>>

/** 交付链的全部节点：真实事实优先，缺失的部分保留骨架节点，让"缺哪一跳"是可查询的。 */
export async function readChainFacts(context: CoreContext, scope: DeliveryScopeInput): Promise<ChainFacts> {
  const gaps: CapabilityGap[] = []
  const view = await readExecutionContext(context, { workItemId: scope.workItemId, repositoryId: scope.repositoryId ?? '' })
  const repository = scope.repositoryId === undefined ? undefined : await resolveRepository(context, scope.repositoryId, gaps)
  const worktree = worktreeNode(context, scope, view, repository)
  const branch = worktree.label ?? branchNameFor(scope.workItemId)
  const head = repository === undefined ? undefined : await readHeadCommit(context, repository, branch, gaps)
  const crFact = repository === undefined || head === undefined ? undefined : await readChangeRequest(context, repository, head, gaps)
  const changeRequest = changeRequestNode(context, repository, branch, crFact)
  const observed = scope.repositoryId === undefined ? [] : await readPipelines(context, scope.repositoryId, head, gaps)
  const checks = crFact === undefined ? [] : await readChecks(context, crFact.ref.externalId, gaps)
  const slot = scope.repositoryId ?? 'unbound'
  return {
    workItem: await workItemNode(context, scope.workItemId),
    context: contextNode(context, scope, view?.id),
    worktree,
    commit: commitNode(context, scope, repository, branch, head),
    changeRequest,
    pipelines: observed.length > 0 ? observed : [skeleton(context, EntityKind.PipelineRun, `${slot}|${branch}|pipeline`, branch, '流水线事实尚未观察到')],
    checks: checks.length > 0 ? checks : [skeleton(context, EntityKind.CheckRun, `${slot}|${branch}|check`, branch, '检查事实尚未观察到')],
    gaps,
  }
}
