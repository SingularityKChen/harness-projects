/**
 * 交付链的 provider 读取（issue #78 / ExecPlan D5）。
 *
 * 只读：按提交读流水线、按变更请求读检查、按仓库读分支与变更请求。任何一步缺能力或 provider 失败都
 * 折成一条 `CapabilityGap`，链上该节点退回骨架（`observed: false`）——读侧降级是"最后已知值 + 显式
 * 不可用"，不是异常。骨架节点仍然有稳定身份（`chainEntityId`），所以谱系在链路推进前后都查得到，
 * 且不会因为重新读取而换 id（不变量 6）。本文件不写任何外部状态，也不触碰规划投影。
 */
import { CapabilityKey, type ExternalObjectRef, type ProviderResult, type ResolvedBinding } from '@harness-projects/capabilities'
import { EntityKind } from '@harness-projects/domain'
import { gateCommand } from './capabilities.ts'
import type { CoreContext } from './context.ts'
import { contextIdFor, readExecutionContext } from './execution-context.ts'
import { branchNameFor, worktreePathFor } from './git-provisioning.ts'
import { asEntityId, chainEntityId, type ChainNode } from './relations.ts'

export interface CapabilityGap { readonly key: CapabilityKey; readonly reason: string }
export interface DeliveryScopeInput { readonly workItemId: string; readonly repositoryId: string | undefined }

export interface ChainFacts {
  readonly workItem: ChainNode
  readonly context: ChainNode
  readonly worktree: ChainNode
  readonly commit: ChainNode
  readonly changeRequest: ChainNode
  readonly pipelines: readonly ChainNode[]
  readonly checks: readonly ChainNode[]
  readonly gaps: readonly CapabilityGap[]
}

type ReadResult<T> = { readonly value: T | undefined; readonly gap: CapabilityGap | undefined }
interface ChangeRequestFact { readonly ref: ExternalObjectRef; readonly label: string }

const PAGE_LIMIT = 50

export function chainNode(
  id: ChainNode['id'], kind: EntityKind, externalId: string | undefined,
  label: string | undefined, observed: boolean, detail?: string,
): ChainNode { return { id, kind, externalId, label, observed, detail } }

/** 读能力门：未声明/只读以外一律折成 gap；provider 缺失也走同一条路，调用方永远拿到结构化结论。 */
async function gated<T>(
  context: CoreContext, key: CapabilityKey,
  run: (binding: ResolvedBinding) => Promise<ProviderResult<T>> | undefined,
): Promise<ReadResult<T>> {
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

function collect(gaps: CapabilityGap[], gap: CapabilityGap | undefined): void {
  if (gap !== undefined) gaps.push(gap)
}

async function resolveRepository(
  context: CoreContext, repositoryId: string, gaps: CapabilityGap[],
): Promise<ExternalObjectRef | undefined> {
  const key = CapabilityKey.DevelopmentRepositoryRead
  const gate = gateCommand(context.registry, key, 'read')
  if (!gate.allowed || gate.bindingId === undefined) {
    collect(gaps, { key, reason: gate.error?.message ?? '不能定位仓库绑定的 capability' })
    return undefined
  }
  return { bindingId: gate.bindingId, objectKind: 'repository', externalId: repositoryId, url: undefined }
}

async function readHeadCommit(
  context: CoreContext, repository: ExternalObjectRef, branch: string, gaps: CapabilityGap[],
): Promise<string | undefined> {
  const read = await gated(context, CapabilityKey.DevelopmentRepositoryRead, (binding) =>
    binding.development?.listBranches({ repository, cursor: undefined, limit: PAGE_LIMIT }))
  collect(gaps, read.gap)
  return read.value?.items.find((item) => item.name === branch)?.headCommit
}

/** 只认头部提交匹配的变更请求：不匹配就当没观察到，绝不把别的分支的提交挂到本链上。 */
async function readChangeRequest(
  context: CoreContext, repository: ExternalObjectRef, head: string, gaps: CapabilityGap[],
): Promise<ChangeRequestFact | undefined> {
  const read = await gated(context, CapabilityKey.DevelopmentChangeRequestRead, (binding) =>
    binding.development?.listChangeRequests({ repository, cursor: undefined, limit: PAGE_LIMIT }))
  collect(gaps, read.gap)
  const found = (read.value?.items ?? []).find((item) => item.sourceVersion === head)
  return found === undefined ? undefined : { ref: found.ref, label: `#${found.number} ${found.title}` }
}

async function readPipelines(
  context: CoreContext, repository: ExternalObjectRef, commit: string | undefined, gaps: CapabilityGap[],
): Promise<readonly ChainNode[]> {
  const read = await gated(context, CapabilityKey.DeliveryPipelineRead, (binding) =>
    binding.delivery?.listPipelineRuns({ repository, commit, cursor: undefined, limit: PAGE_LIMIT }))
  collect(gaps, read.gap)
  return (read.value?.items ?? []).map((run) => chainNode(
    chainEntityId(context.workspaceId, EntityKind.PipelineRun, `${run.ref.bindingId}|${run.ref.externalId}`),
    EntityKind.PipelineRun, run.ref.externalId, `${run.status}: ${run.conclusion ?? '未完成'}`, true,
  ))
}

async function readChecks(
  context: CoreContext, changeRequest: ExternalObjectRef, gaps: CapabilityGap[],
): Promise<readonly ChainNode[]> {
  const read = await gated(context, CapabilityKey.DeliveryCheckRead, (binding) =>
    binding.delivery?.listChecks({ changeRequest, cursor: undefined, limit: PAGE_LIMIT }))
  collect(gaps, read.gap)
  return (read.value?.items ?? []).map((check) => chainNode(
    chainEntityId(context.workspaceId, EntityKind.CheckRun, `${check.ref.bindingId}|${check.ref.externalId}`),
    EntityKind.CheckRun, check.ref.externalId, `${check.name}: ${check.conclusion ?? check.status}`, true,
  ))
}

async function workItemNode(context: CoreContext, workItemId: string): Promise<ChainNode> {
  for (const projection of await context.storage.listPlanningProjections(context.workspaceId)) {
    if (projection.entityId === workItemId) {
      return chainNode(projection.entityId, EntityKind.WorkItem, workItemId, undefined, true)
    }
    const identities = await context.storage.listIdentitiesForEntity(projection.entityId)
    if (identities.some((identity) => identity.externalId === workItemId)) {
      return chainNode(projection.entityId, EntityKind.WorkItem, workItemId, undefined, true)
    }
  }
  return chainNode(chainEntityId(context.workspaceId, EntityKind.WorkItem, workItemId), EntityKind.WorkItem, workItemId, undefined, false, '工作项尚未被观察到')
}

function contextNode(context: CoreContext, scope: DeliveryScopeInput, observedId: string | undefined): ChainNode {
  const id = observedId ?? contextIdFor(context.workspaceId, scope.workItemId, scope.repositoryId ?? '')
  return chainNode(
    asEntityId(id), EntityKind.ExecutionContext, id, undefined, observedId !== undefined,
    observedId === undefined ? '执行上下文尚未创建' : undefined,
  )
}

function worktreeNode(context: CoreContext, scope: DeliveryScopeInput, view: ChainView | undefined, repository: ExternalObjectRef | undefined): ChainNode {
  const branch = view?.branchExternalId ?? branchNameFor(scope.workItemId)
  const slot = view?.worktreeExternalId ?? worktreePathFor(scope.workItemId)
  const observed = view?.worktreeExternalId !== undefined
  return chainNode(
    chainEntityId(context.workspaceId, EntityKind.Worktree, `${repository?.bindingId ?? 'unbound'}|${slot}`),
    EntityKind.Worktree, slot, branch, observed, observed ? undefined : '工作树尚未创建',
  )
}

function commitNode(context: CoreContext, scope: DeliveryScopeInput, repository: ExternalObjectRef | undefined, branch: string, head: string | undefined): ChainNode {
  const slot = `${repository?.bindingId ?? 'unbound'}|${branch}|${head ?? 'unobserved'}`
  return chainNode(
    chainEntityId(context.workspaceId, EntityKind.Commit, slot), EntityKind.Commit, head, branch,
    head !== undefined, head === undefined ? `提交尚未观察到（${scope.workItemId} 尚无已建分支的头部提交）` : undefined,
  )
}

function changeRequestNode(context: CoreContext, repository: ExternalObjectRef | undefined, branch: string, fact: ChangeRequestFact | undefined): ChainNode {
  const slot = `${fact?.ref.bindingId ?? repository?.bindingId ?? 'unbound'}|${fact?.ref.externalId ?? branch}`
  return chainNode(
    chainEntityId(context.workspaceId, EntityKind.ChangeRequest, slot), EntityKind.ChangeRequest,
    fact?.ref.externalId, fact?.label ?? branch, fact !== undefined,
    fact === undefined ? '变更请求尚未观察到' : undefined,
  )
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
  const observed = repository === undefined ? [] : await readPipelines(context, repository, head, gaps)
  const checks = crFact === undefined ? [] : await readChecks(context, crFact.ref, gaps)
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
