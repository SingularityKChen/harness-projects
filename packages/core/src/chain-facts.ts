/**
 * 交付链的 provider 读取（issue #78 / ExecPlan D5）。只读：按已观察提交读流水线与检查（检查另以已观察的变更请求为前置门）、按仓库读分支与
 * 变更请求。任何一步缺能力或 provider 失败都折成一条 `CapabilityGap`，该节点退回骨架（`observed: false`）——读侧降级是"最后已知值 + 显式不可用"，不是异常。
 * 骨架仍有稳定身份（`chainEntityId`），谱系在链路推进前后都查得到且不因重新读取换 id（不变量 6）；本文件不写外部状态，也不触碰规划投影。
 * 事实只能挂在**已观察到的锚点**上：提交未观察到就不读流水线（绝不以 `commit: undefined` 读整个仓库），变更请求未观察到就不读检查；
 * provider 读回的任一运行或检查不属于该提交，整次集合作废。
 * Gate E1 落地前，同一外部 id 视为各 provider 下的同一对象，E1 通过后由身份表替换这条显式假设。
 */
import {
  CapabilityKey, providerErr, providerError, providerOk,
  type ExternalObjectRef, type ProjectError, type ProviderPage, type ProviderResult, type ResolvedBinding,
} from '@harness-projects/capabilities'
import { EngineeringFactKind, EntityKind, ProviderErrorCode, type EntityId, type WorkspaceId } from '@harness-projects/domain'
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
/** 单次集合读取的页数上界；成环或超限都按整次读取不完整处理。 */
const MAX_PAGES = 1000

/** 读侧形状守卫：端口有类型，但 provider 交来的坏形状只能降级成 gap，不能让整次查询变成异常。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 完整收集一类 Delivery 页后才返回元素：任何一页失败、页值不是带数组 `items` 的对象、元素不是带 `ref.externalId` 的对象、
 * 游标成环、id 重复、页数超限，或任一元素的 `commit` 不是已观察的 `head`，都返回结构化 unavailable 并放弃**整次**集合——
 * 调用方因此不会拿着第一页的成功事实、或别的提交上的运行/检查，以为本 head 的整个集合已经读过（ExecPlan A2）。
 * 只丢坏行会让剩下的事实冒充完整集合，故不过滤。
 * 记录已请求的 cursor 与 `(binding, kind, id)`：同一对象重复投递、游标不前进都不能报完整。
 */
async function collectDeliveryPages<T extends { readonly ref: ExternalObjectRef; readonly commit: string }>(
  head: string, readPage: (cursor: string | undefined) => Promise<ProviderResult<ProviderPage<T>>>,
): Promise<ProviderResult<readonly T[]>> {
  const items: T[] = []
  const seen = new Set<string>()
  const sent = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await readPage(cursor)
    if (!result.ok) return providerErr(result.error)
    const value: unknown = result.value
    if (!isRecord(value) || !Array.isArray(value.items)) return providerErr(providerError(ProviderErrorCode.Unavailable, '分页形状不合法，本次读取不完整'))
    for (const item of result.value.items) {
      if (!isRecord(item) || !isRecord(item.ref) || typeof item.ref.externalId !== 'string') {
        return providerErr(providerError(ProviderErrorCode.Unavailable, '分页元素缺少对象引用，本次读取不完整'))
      }
      if (item.commit !== head) return providerErr(providerError(ProviderErrorCode.Unavailable, '读回的运行或检查不属于已观察的提交，本次读取作废'))
      const key = `${item.ref.bindingId}|${item.ref.objectKind}|${item.ref.externalId}`
      if (seen.has(key)) return providerErr(providerError(ProviderErrorCode.Unavailable, '分页重复投递同一对象，本次读取不完整'))
      seen.add(key)
      items.push(item)
    }
    cursor = result.value.nextCursor
    if (cursor === undefined) return providerOk(items)
    if (sent.has(cursor)) return providerErr(providerError(ProviderErrorCode.Unavailable, '分页游标成环，本次读取不完整'))
    sent.add(cursor)
  }
  return providerErr(providerError(ProviderErrorCode.Unavailable, '分页超过页数上界，本次读取不完整'))
}

/**
 * 工作树实体的**唯一身份定义**：这个工作项**在这个仓库上**的工作树。
 *
 * 路径不是身份，是属性。把路径放进键里会造出**第二个派生点**：写入路径（`recordStartFacts`）拿的是
 * 请求声明的路径，投影路径（`worktreeNode`）拿的是 provider 回填的句柄；真实 provider 上这两者不同
 * （首次创建返回规范化绝对路径，复用返回调用方字符串），于是**读一次谱系**就会为同一份工作树写出
 * 第二条 confirmed 关系、造出第二个实体——违反 `AGENTS.md` §1.1 不变量 6。改路径重试、恢复时句柄被
 * 覆盖成相对路径，都是同一个洞的其它入口。
 *
 * **作用域是仓库，不是 binding**：binding 的解析有多个来源——写入侧走 `DevelopmentWorktreeCreate`、
 * 投影侧走 `DevelopmentRepositoryRead`——两个 capability key 可以独立不可用，于是同一份工作树会拿到
 * 两个身份，这正是上面那个洞的第五个入口。`repositoryId` 两侧都从**执行上下文记录**取（记录里本来
 * 就有这一列），不需要任何 capability 解析，分叉因此从构造上不存在。三元组
 * `(workspaceId, repositoryId, workItemId)` 与 `contextIdFor` 完全一致：一个执行上下文一份工作树。
 *
 * 写入与投影两处都调这一个函数，谁都不许再自己拼键。
 */
export function worktreeEntityId(workspaceId: WorkspaceId, repositoryId: string, workItemId: string): EntityId {
  return chainEntityId(workspaceId, EntityKind.Worktree, `${repositoryId}|${workItemId}`)
}

export function chainNode(id: ChainNode['id'], kind: EntityKind, externalId: string | undefined,
  label: string | undefined, observed: boolean, detail?: string, fact?: EngineeringFactKind): ChainNode {
  return { id, kind, externalId, label, observed, detail, fact }
}

/**
 * CI 观察 → 工程事实种类：只有完整结束的运行才可能产生事实，进行中无论携何结论都不猜。词表是 Delivery 端口声明的
 * GitHub 原生小写值（见 `ProviderPipelineRun` 上的词表契约）；`startup_failure` 是启动即失败，按失败计。
 */
function factFor(status: string, conclusion: string | undefined): EngineeringFactKind | undefined {
  if (status !== 'completed') return undefined
  if (conclusion === 'success') return EngineeringFactKind.CiPassed
  return conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'action_required' || conclusion === 'startup_failure'
    ? EngineeringFactKind.CiFailed : undefined
}

/** 一次读取的路由结论：成功时带服务这次读取的挂载，Development 读取另带该连接下的仓库引用（调用方只用它调 provider）。 */
type ReadRoute = { readonly ok: true; readonly binding: ResolvedBinding; readonly repository?: ExternalObjectRef } | { readonly ok: false; readonly error: ProjectError | undefined }

/** key 级解析：能力被策略摘掉或没有绑定时，路由失败，调用方折成缺口。 */
function readRoute(context: CoreContext, key: CapabilityKey): ReadRoute {
  const gate = gateCommand(context.registry, key, 'read')
  return gate.allowed && gate.binding !== undefined ? { ok: true, binding: gate.binding } : { ok: false, error: gate.error }
}

/**
 * Development 读取的**唯一**路由缝（CONTRACTS K3）：返回 `{ binding, repository }`，调用方只用这个 `repository` 调 provider，不再自己拼引用；今天按 key 级解析，
 * 路由失败得到缺口，不读错连接。#219 与 #221 都进 main 后，由 #297 把函数体换成 `routeDevelopment(...)`（人类伙伴 2026-10-08 裁决）。
 * 引用只用于调用 provider，**不参与任何实体身份**：工作树的身份只从执行上下文记录取 `repositoryId`（见 `worktreeEntityId`）。
 */
async function developmentReadBinding(context: CoreContext, key: CapabilityKey, repositoryId: string): Promise<ReadRoute> {
  const route = readRoute(context, key)
  return route.ok ? { ...route, repository: refFor(route.binding, 'repository', repositoryId) } : route
}

/**
 * 读能力门：路由失败、provider 缺失或失败一律折成 gap。Development 的两处查找另带 `settled`（#221）：页没读完、要找的又不在这一页也是 gap，
 * 截断不得被当成"已确认不存在"，找到即完整。默认谓词只认 #295 的 `collectDeliveryPages` 交来的完整数组：单页结果不带自己的谓词就一律是缺口（fail closed）。
 */
async function gated<T>(route: ReadRoute, key: CapabilityKey,
  run: (binding: ResolvedBinding, repository: ExternalObjectRef | undefined) => Promise<ProviderResult<T>> | undefined,
  settled: (value: T) => boolean = (value) => Array.isArray(value)): Promise<ReadResult<T>> {
  if (!route.ok) return { value: undefined, gap: { key, reason: route.error?.message ?? '能力不可用' } }
  const pending = run(route.binding, route.repository)
  if (pending === undefined) return { value: undefined, gap: { key, reason: '绑定没有该域的 provider 实例' } }
  const result = await pending
  if (!result.ok) return { value: undefined, gap: { key, reason: result.error.message } }
  if (!settled(result.value)) return { value: undefined, gap: { key, reason: '分页未读完' } }
  return { value: result.value, gap: undefined }
}

function collect(gaps: CapabilityGap[], gap: CapabilityGap | undefined): void { if (gap !== undefined) gaps.push(gap) }

async function readHeadCommit(route: ReadRoute, branch: string, gaps: CapabilityGap[]): Promise<string | undefined> {
  const read = await gated(route, CapabilityKey.DevelopmentRepositoryRead, (binding, repository) =>
    repository === undefined ? undefined : binding.development?.listBranches({ repository, cursor: undefined, limit: PAGE_LIMIT }),
  (page) => page.nextCursor === undefined || page.items.some((item) => item.name === branch))
  collect(gaps, read.gap)
  const found = read.value?.items.find((item) => item.name === branch)
  // 分支存在而头部提交未知，不是「没有头部提交」：不能当作锚点确认不存在，否则下游事实会被整组删除（#221 验收 3）。
  if (found !== undefined && found.headCommit === undefined) collect(gaps, { key: CapabilityKey.DevelopmentRepositoryRead, reason: '分支没有头部提交' })
  return found?.headCommit
}

/** 只认头部提交匹配的变更请求：不匹配就当没观察到，绝不把别的分支的提交挂到本链上。 */
async function readChangeRequest(context: CoreContext, repositoryId: string, branch: string, head: string, gaps: CapabilityGap[]): Promise<ChangeRequestFact | undefined> {
  const key = CapabilityKey.DevelopmentChangeRequestRead
  const read = await gated(await developmentReadBinding(context, key, repositoryId), key, (binding, repository) =>
    repository === undefined ? undefined : binding.development?.listChangeRequests({ repository, headBranch: branch, cursor: undefined, limit: PAGE_LIMIT }),
  (page) => Array.isArray(page.items) && (page.nextCursor === undefined || page.items.some((item) => item.sourceVersion === head)))
  collect(gaps, read.gap)
  const found = (read.value?.items ?? []).find((item) => item.sourceVersion === head)
  return found === undefined ? undefined : { ref: found.ref, label: `#${found.number} ${found.title}` }
}

/** 每个能力域各自的引用由提供该能力的 binding 构造：交付方读到的是它自己 binding 下的仓库对象。 */
function refFor(binding: ResolvedBinding, kind: string, externalId: string): ExternalObjectRef {
  return { bindingId: binding.ref.bindingId, objectKind: kind, externalId, url: undefined }
}

async function readPipelines(context: CoreContext, repositoryId: string, commit: string, gaps: CapabilityGap[]): Promise<readonly ChainNode[]> {
  const read = await gated(readRoute(context, CapabilityKey.DeliveryPipelineRead), CapabilityKey.DeliveryPipelineRead, (binding) => {
    const delivery = binding.delivery
    if (delivery === undefined) return undefined
    return collectDeliveryPages(commit, (cursor) => delivery.listPipelineRuns({ repository: refFor(binding, 'repository', repositoryId), commit, cursor, limit: PAGE_LIMIT }))
  })
  collect(gaps, read.gap)
  return (read.value ?? []).map((run) => chainNode(
    chainEntityId(context.workspaceId, EntityKind.PipelineRun, `${run.ref.bindingId}|${run.ref.externalId}`),
    EntityKind.PipelineRun, run.ref.externalId, `${run.status}: ${run.conclusion ?? '未完成'}`, true,
    undefined, factFor(run.status, run.conclusion),
  ))
}

async function readChecks(context: CoreContext, repositoryId: string, commit: string, gaps: CapabilityGap[]): Promise<readonly ChainNode[]> {
  const read = await gated(readRoute(context, CapabilityKey.DeliveryCheckRead), CapabilityKey.DeliveryCheckRead, (binding) => {
    const delivery = binding.delivery
    if (delivery === undefined) return undefined
    return collectDeliveryPages(commit, (cursor) => delivery.listChecks({ repository: refFor(binding, 'repository', repositoryId), commit, cursor, limit: PAGE_LIMIT }))
  })
  collect(gaps, read.gap)
  return (read.value ?? []).map((check) => chainNode(
    chainEntityId(context.workspaceId, EntityKind.CheckRun, `${check.ref.bindingId}|${check.ref.externalId}`),
    EntityKind.CheckRun, check.ref.externalId, `${check.name}: ${check.conclusion ?? check.status}`, true,
    undefined, factFor(check.status, check.conclusion),
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

/**
 * 工作树节点。身份只从**执行上下文记录**取 `repositoryId`——不碰路由缝 `developmentReadBinding` 的返回值，
 * 否则投影侧的身份就会依赖 `DevelopmentRepositoryRead` 的解析结果，与写入侧分叉。
 * 上下文尚未创建时（骨架节点）退到调用方给的作用域：给定 `repositoryId` 时这个 id 与创建后的真实工作树**同一身份**
 * （这正是骨架要的稳定身份）；骨架跳因 `observed = false` 不落成关系，所以不会与真实工作树的关系重复。
 */
function worktreeNode(context: CoreContext, scope: DeliveryScopeInput, view: ChainView | undefined): ChainNode {
  const branch = view?.branchExternalId ?? branchNameFor(scope.workItemId)
  // `slot` 只是**属性**（provider 的句柄，移除工作树要用它），不参与身份——身份由 `worktreeEntityId` 唯一决定。
  const slot = view?.worktreeExternalId ?? worktreePathFor(scope.workItemId)
  const observed = view?.worktreeExternalId !== undefined
  return chainNode(worktreeEntityId(context.workspaceId, view?.repositoryId ?? scope.repositoryId ?? '', scope.workItemId),
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
  const route = scope.repositoryId === undefined ? undefined : await developmentReadBinding(context, CapabilityKey.DevelopmentRepositoryRead, scope.repositoryId)
  if (route?.ok === false) collect(gaps, { key: CapabilityKey.DevelopmentRepositoryRead, reason: route.error?.message ?? '不能定位仓库绑定的 capability' })
  const repository = route?.ok === true ? route.repository : undefined
  const worktree = worktreeNode(context, scope, view)
  const branch = worktree.label ?? branchNameFor(scope.workItemId)
  // A default branch name is only a skeleton label, never an observation. Without a recorded worktree
  // handle there is no provisioned artifact to anchor branch, change-request, or CI facts to; reading
  // `work/<workItemId>` here would let an unrelated/manual branch manufacture lineage for a missing context.
  const hasObservedWorktree = view?.worktreeExternalId !== undefined
  const head = route?.ok !== true || !hasObservedWorktree ? undefined : await readHeadCommit(route, branch, gaps)
  const crFact = repository === undefined || head === undefined ? undefined : await readChangeRequest(context, scope.repositoryId ?? '', branch, head, gaps)
  const changeRequest = changeRequestNode(context, repository, branch, crFact)
  // 事实必须挂在已观察到的锚点上（ExecPlan D4）：head 未观察到就不读流水线，也不得以 commit: undefined 读取整个仓库的运行；
  // 检查同理，没有已观察到的变更请求就不读。此时只保留"缺哪一跳"的骨架，骨架不进谱系。
  const pipelines = head === undefined || scope.repositoryId === undefined ? [] : await readPipelines(context, scope.repositoryId, head, gaps)
  const checks = crFact === undefined || head === undefined || scope.repositoryId === undefined
    ? [] : await readChecks(context, scope.repositoryId, head, gaps)
  const slot = scope.repositoryId ?? 'unbound'
  return {
    workItem: await workItemNode(context, scope.workItemId),
    context: contextNode(context, scope, view?.id),
    worktree,
    commit: commitNode(context, scope, repository, branch, head),
    changeRequest,
    pipelines: pipelines.length > 0 ? pipelines : [skeleton(context, EntityKind.PipelineRun, `${slot}|${branch}|pipeline`, branch, '流水线事实尚未观察到')],
    checks: checks.length > 0 ? checks : [skeleton(context, EntityKind.CheckRun, `${slot}|${branch}|check`, branch, '检查事实尚未观察到')],
    gaps,
  }
}
