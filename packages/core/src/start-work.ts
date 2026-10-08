/**
 *
 * `git-provisioning.ts`。
 */
import {
  CapabilityKey, ProjectErrorCode, projectError, type ExecutionContextRecord, type ExecutionRunRecord, type ExternalObjectRef, type StorageTransaction,
} from '@harness-projects/capabilities'
import {
  ContentKind, EntityKind, ExecutionContextStatus, ExecutionRunStatus, ExternalIdentityKind, IdentityRole, ProviderErrorCode, RelationType, asBrandedId,
  type EntityId, type ExecutionContextId, type ProjectError, type ProviderBindingId,
} from '@harness-projects/domain'
import { resolveWriteTarget, toProjectError, unsupportedCapability } from './capabilities.ts'
import { chainNode, worktreeEntityId } from './chain-facts.ts'
import type { CoreContext } from './context.ts'
import { routeDevelopment } from './development-route.ts'
import {
  StartWorkFallback, contextIdFor, contextRecord, fallbackOf, readyGap, reportForExisting, runIdFor, runStatusFor,
  startWorkUnavailable, toResult,
  type StartWorkRequest, type StartWorkResult,
} from './execution-context.ts'
import { namesFor, namesProblem, outcomeOf, provisionGit, type GitOutcome } from './git-provisioning.ts'
import { EdgeProvenance, asEntityId, recordEdges, type DiscoveredEdge, type RelationStore } from './relations.ts'
import { beginWrite, createWriteLedger, markFailed, reportFor, WritePhase, type WriteReport } from './write-machine.ts'

function actorKind(request: StartWorkRequest): string | undefined {
  const actor: StartWorkRequest['actor'] | undefined = request.actor
  return actor !== undefined && typeof actor.kind === 'string' && actor.kind.trim() !== '' ? actor.kind : undefined
}

/**
 */
function validateRequest(request: StartWorkRequest): ProjectError | undefined {
  if (typeof request.workItemId !== 'string' || request.workItemId.trim() === '') return invalid('workItemId 不能为空')
  if (typeof request.repositoryId !== 'string' || request.repositoryId.trim() === '') return invalid('repositoryId 不能为空')
  if (typeof request.idempotencyKey !== 'string' || request.idempotencyKey.trim() === '') return invalid('idempotencyKey 不能为空')
  if (request.branchName !== undefined && (typeof request.branchName !== 'string' || request.branchName.trim() === '')) return invalid('branchName 不能为空')
  if (actorKind(request) === undefined) return invalid('actor 必须声明发起方')
  // 身份闸门：退化的工作项 id 会让两个工作项共用同一个分支名；输入形状错误先于存在性判定，也先于任何写入。
  const degenerate = namesProblem(request.workItemId)
  return degenerate === undefined ? undefined : invalid(degenerate)
}

function invalid(message: string): ProjectError {
  return projectError(ProjectErrorCode.InvalidInput, message)
}

export async function startWork(context: CoreContext, request: StartWorkRequest): Promise<StartWorkResult> {
  const invalidInput = validateRequest(request)
  if (invalidInput !== undefined) return startWorkUnavailable(invalidInput)
  const contextId = contextIdFor(context.workspaceId, request.workItemId, request.repositoryId)
  const ledger = createWriteLedger(context.storage)
  const replayed = await ledger.replay(context.workspaceId, request.idempotencyKey)
  if (replayed !== undefined) return existingResult(context, contextId, replayed)
  // 只有没有 context 记录的新请求才预检、过能力门并 ack；已有记录（终态接管、过期续跑、在途、Ready）沿用原路径。
  const prepared = (await context.storage.getExecutionContext(contextId)) === undefined ? await prepareRegistration(context, request, contextId) : undefined
  if (prepared?.ok === false) return startWorkUnavailable(prepared.error)
  let claimed: Awaited<ReturnType<typeof claimContext>>
  try {
    claimed = await claimContext(context, contextId, request, prepared?.register)
  } catch (error) {
    if (prepared === undefined) throw error // 已有记录（终态接管、过期续跑、在途、Ready）保持原行为：此前的尝试可能已经有过外部写入
    // 新请求的认领事务整笔回滚，此时还没有任何外部写入：结构化失败，不冒充外部结果未知。
    return startWorkUnavailable(projectError(ProjectErrorCode.Unavailable, `本地登记失败，没有发起任何外部写入：${error instanceof Error ? error.message : String(error)}`))
  }
  if (claimed !== 'new' && claimed !== 'resume') return existingResult(context, contextId, undefined)
  // 只转换 `localWrite` 标记过的本地写失败；Provider 的抛出（崩溃、中断）原样传出，不被吞掉。
  return provision(context, request, contextId).catch((error) => {
    if (error instanceof LocalWriteFailed) return unknownAfterAck(error)
    throw error
  })
}

/** ack 之后的本地写失败：只由 `localWrite`（显式的本地写调用点，不包 Provider 调用）抛出，带着最后一个已 ack 的步骤结果（其 `status` 是本地记录此刻的状态）；run 记录的失败还带着已 ack 的 run 句柄。 */
class LocalWriteFailed extends Error {
  readonly acked: GitOutcome
  readonly runExternalId: string | undefined
  constructor(acked: GitOutcome, cause: unknown, runExternalId?: string) { super(cause instanceof Error ? cause.message : String(cause), { cause }); this.acked = acked; this.runExternalId = runExternalId }
}
async function localWrite<T>(acked: GitOutcome, write: () => Promise<T>, runExternalId?: string): Promise<T> {
  try { return await write() } catch (error) { throw new LocalWriteFailed(acked, error, runExternalId) }
}

/** 本地写失败的结果是 Unknown，不是 Failed 或 Saved：外部资源存在、不自动删除，句柄取最后已 ack 的，不起 run；`markUnknown` 对 Confirmed 原样返回，所以用 `reportFor` 建报告。 */
function unknownAfterAck({ acked, message, runExternalId }: LocalWriteFailed): StartWorkResult {
  // 文案按事实陈述：有分支句柄才说已 ack（工作树与 run 的 ack 都在分支之后）；失败结算时本次外部调用的原始失败一并带上，不被「本地结算失败」盖掉。
  const acks = acked.branchExternalId !== undefined
  const failure = acked.report.error === undefined ? '' : `；本次外部调用的失败：${acked.report.error.code}：${acked.report.error.message}`
  const error = projectError(ProjectErrorCode.ResultUnknown, `本地结算失败，${acks ? '已 ack 的外部资源保留、不自动删除，需先对账、不要盲目重试' : '本次没有外部写入被 ack'}：${message}${failure}`)
  return toResult(reportFor(WritePhase.Unknown, acked.report.values, error), outcomeOf(acked, undefined, runExternalId), error)
}
function unknownRun(git: GitOutcome, why: string, runExternalId: string | undefined): StartWorkResult {
  const error = projectError(ProjectErrorCode.ResultUnknown, `运行状态未知（${why}），已 ack 的外部资源保留、不自动删除，需先对账、不要盲目重试`)
  return toResult(reportFor(WritePhase.Unknown, git.report.values, error), outcomeOf(git, undefined, runExternalId), error)
}
/** 接管时已有的 run：不起第二个执行者，答案与重放、Query 同源——状态未知报 Unknown，其余如实带回降级标记与 run 句柄；主执行可用（`startExecution`）与不可用（`manualFallback`）两条分支共用。 */
function existingRun(git: GitOutcome, existing: ExecutionRunRecord): StartWorkResult {
  if (existing.status === ExecutionRunStatus.Unknown) return unknownRun(git, '已有的 run 记录是 unknown', existing.providerRef?.externalId)
  return toResult(git.report, outcomeOf(git, fallbackOf(existing), existing.providerRef?.externalId), undefined)
}

/** 新请求的写前准备额外要求的能力：分支创建的写门（只读即拒绝）与仓库读、工作树读两个读门，先于任何本地与外部写入；它们与路由的锚点（工作树创建的写门）都在路由选中的同一个挂载上、按这个顺序先于锚点判定（`routeDevelopment` 的 `earlier`）。 */
const REGISTRATION_GATES = [
  [CapabilityKey.DevelopmentBranchCreate, 'write'], [CapabilityKey.DevelopmentRepositoryRead, 'read'], [CapabilityKey.DevelopmentWorktreeRead, 'read'],
] as const

/** 写前事务里要做的登记：`claimContext` 在没有记录的分支里先调它，再写 Provisioning。 */
type Registration = (tx: StorageTransaction) => Promise<void>
type Prepared = { readonly ok: true; readonly register: Registration } | { readonly ok: false; readonly error: ProjectError }

/**
 * 新请求在任何写入之前的只读准备：工作项预检（工作区作用域的规划投影，只有 `work_item` 内容可开始）→ 按仓库路由并在同一挂载上过能力门
 * （缺路由、歧义与「绑定 id 变了」都在这里拒绝）→ 向路由到的 Development provider 要仓库 ack（`ref` 必须逐字等于路由给出的引用）；通过后返回写前事务里的登记。
 */
async function prepareRegistration(context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId): Promise<Prepared> {
  const reject = (error: ProjectError): Prepared => ({ ok: false, error })
  const projection = await context.storage.getPlanningProjection(context.workspaceId, asBrandedId<EntityId>(request.workItemId))
  if (projection === undefined) return reject(projectError(ProjectErrorCode.NotFound, `工作项 ${request.workItemId} 不在当前工作区的规划投影里`))
  if (projection.content.contentKind === ContentKind.ChangeRequest) return reject(projectError(ProjectErrorCode.InvalidInput, '变更请求不是可开始工作的工作项'))
  if (projection.content.contentKind === ContentKind.Redacted) return reject(projectError(ProjectErrorCode.Unavailable, '工作项内容被扣下，不是可操作的规划条目'))
  const route = await routeDevelopment(context, request.repositoryId, CapabilityKey.DevelopmentWorktreeCreate, 'write', REGISTRATION_GATES)
  if (!route.ok) return reject(route.error)
  const { provider, repository } = route
  const found = await provider.getRepository(repository)
  if (!found.ok) return reject(toProjectError(found.error))
  const acked = found.value.ref
  if (acked.bindingId !== repository.bindingId || acked.objectKind !== repository.objectKind || acked.externalId !== repository.externalId) {
    return reject(projectError(ProjectErrorCode.Conflict, `仓库 ack 的身份 ${acked.bindingId}/${acked.objectKind}/${acked.externalId} 与请求的 ${repository.bindingId}/repository/${repository.externalId} 不一致`))
  }
  return { ok: true, register: (tx) => registerParents(tx, context, request, contextId, repository.bindingId) }
}

/**
 * 写前登记（与 claim 同一个事务）：canonical 仓库实体与 primary 身份（已登记则复用）、工作区挂载、context 实体与 reserved worktree 实体。
 * 它们是外键父行，也是 tracks / has_worktree 的端点；放在写前而不是 final，读谱系才不会因写路径的中间态抛外键错误。
 * reserved worktree 实体只表示本地槽位，不是工作树 observed 的证据。
 */
async function registerParents(
  tx: StorageTransaction, context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, bindingId: ProviderBindingId,
): Promise<void> {
  let identity = await tx.findExternalIdentity(bindingId, ExternalIdentityKind.Repository, request.repositoryId)
  if (identity === undefined) {
    identity = {
      id: context.ids.externalIdentityId(), entityId: context.ids.entityId(), bindingId,
      externalKind: ExternalIdentityKind.Repository, externalId: request.repositoryId, role: IdentityRole.Primary,
    }
    await tx.putEntity({ id: identity.entityId, kind: EntityKind.Repository })
    await tx.putExternalIdentity(identity)
  }
  await tx.putRepository({ id: asBrandedId<EntityId>(request.repositoryId), workspaceId: context.workspaceId, externalIdentityId: identity.id })
  await tx.putEntity({ id: asEntityId(contextId), kind: EntityKind.ExecutionContext })
  await tx.putEntity({ id: worktreeEntityId(context.workspaceId, request.repositoryId, request.workItemId), kind: EntityKind.Worktree })
}

/** 认领租约：在途与中断只差一个时间戳；只有租约过期后才允许接管。 */
const PROVISIONING_LEASE_MS = 30_000

function leaseExpired(startedAt: string | undefined, now: string): boolean {
  if (startedAt === undefined) return true
  const started = Date.parse(startedAt)
  const current = Date.parse(now)
  if (Number.isNaN(started) || Number.isNaN(current)) return true
  return current - started >= PROVISIONING_LEASE_MS
}

/**
 * 终态：端口把它定义为**非 active**——`packages/capabilities/src/storage.ts` 的执行段写的是
 * 「同一工作项 + 仓库最多一个 **active** 上下文」，而替身的 `isActiveContext` 明确排除 `Closed` 与
 * `Failed`。所以终态不挡下一次开始。
 */
function isTerminal(status: ExecutionContextStatus): boolean {
  return status === ExecutionContextStatus.Closed || status === ExecutionContextStatus.Failed
}

/**
 * 认领上下文。**只有幂等键没有命中账本时才会走到这里**（`startWork` 先 `ledger.replay`），因此：
 * 同一个 key 返回那一次的报告、不重新尝试；**换一个新 key 才是重试**。
 *
 * **不要把这条读成「key 绑定了这一个确切的请求」。** 账本只按 `(workspaceId, idempotencyKey)` 查
 * （`findMutationAttempt`），**不校验工作项、仓库或任何其它参数**。所以同 key 换一个工作项会命中旧记录、
 * 返回那一次的 `saved` 报告，而**什么都没有供应**——一次静默的假成功。要关掉它得让账本记请求指纹，
 * 那是 write ledger 的跨层变更，不在本批次（见批次计划「遗留」§2）。
 *
 * 三种可认领的情形：记录不存在（`new`）、在途且租约过期（`resume`）、**终态**（`resume`）。
 * 在途且租约未过期一律挡住（`in-flight`）；`Ready` 等 active 状态返回 `existing`，不重新供应。
 * 记录不存在时，`register`（写前登记，见 `registerParents`）与 Provisioning 在**同一个事务**里提交。
 */
async function claimContext(
  context: CoreContext, contextId: ExecutionContextId, request: StartWorkRequest, register?: Registration,
): Promise<'new' | 'resume' | 'in-flight' | 'existing'> {
  const now = context.clock()
  return context.storage.transaction(async (tx) => {
    const existing = await tx.getExecutionContext(contextId)
    if (existing === undefined) {
      await register?.(tx)
      await tx.putExecutionContext(contextRecord(context, contextId, request, ExecutionContextStatus.Provisioning, undefined, undefined, now))
      return 'new'
    }
    // 终态可以被接管：一次失败不再把 (工作项, 仓库) 永久锁死。在此之前 `reportForExisting` 那句
    // 「需显式重试或关闭」是一条没有兑现的承诺——端口没有删除入口、`Closed` 没有写者，而
    // `contextIdFor` 是确定性的，所以永远只有这一条记录。
    //
    // **必须保留已记录的步骤字段**（`branchExternalId` / `worktreeExternalId`）：接管的是同一条记录，
    // 不是新建一条。用 `contextRecord(..., undefined, undefined)` 重建会把分步回填的成果抹掉，重放于是
    // 重新推导供应输入——那正是「基线前进后重试失败」的来源。
    if (isTerminal(existing.status)) {
      await tx.putExecutionContext({ ...existing, status: ExecutionContextStatus.Provisioning, provisioningStartedAt: now })
      return 'resume'
    }
    if (existing.status !== ExecutionContextStatus.Provisioning) return 'existing'
    if (!leaseExpired(existing.provisioningStartedAt, now)) return 'in-flight'
    await tx.putExecutionContext({ ...existing, provisioningStartedAt: now })
    return 'resume'
  })
}

async function provision(context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId): Promise<StartWorkResult> {
  const names = namesFor(request)
  // 每一步成功后立刻回填：中断在两步之间时，重放跳过已完成的那一步（批次计划 D2）。两步写的都是 Provisioning，Ready 要等 `settle`。
  const git = await provisionGit(context, request, names, contextId, async (outcome) => {
    await localWrite(outcome, () => saveContext(context, contextId, request, outcome.status, outcome.branchExternalId, outcome.worktreeExternalId))
  })
  const saved = await localWrite({ ...git, status: ExecutionContextStatus.Provisioning }, () => settle(context, request, contextId, git)) // 结算失败时记录仍停在 Provisioning
  // 失败路径的结果面取自**写入后的记录**，不取本次尝试的中间结果：能力不可用时 `git.branchExternalId` 是
  // `undefined`（本次没走到分支步），而记录里保留着此前已决定的分支；调用返回一个答案、记录与 `existingResult`
  // 返回另一个，就是 Host 权威状态分叉。`recordStartFacts` 仍吃 `git`（本次观测到的事实），所以不补写关系。
  if (!git.ok) return toResult(git.report, outcomeOf({ ...git, branchExternalId: saved.branchExternalId }), git.report.error)
  return startExecution(context, request, contextId, git)
}

/** 最终事务：context 记录（成功 Ready、失败 Failed）、tracks / has_worktree 与该次 Git 的 mutation_attempt 同生共死；只用 tx，不调根 Storage、Provider，不嵌套事务。 */
function settle(context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, git: GitOutcome): Promise<ExecutionContextRecord> {
  return context.storage.transaction(async (tx) => {
    const saved = await saveContext(context, contextId, request, git.status, git.branchExternalId, git.worktreeExternalId, tx)
    await recordStartFacts({ workspaceId: context.workspaceId, storage: tx }, request, contextId, git)
    if (git.bindingId !== undefined) {
      await createWriteLedger(tx).record({
        workspaceId: context.workspaceId, bindingId: git.bindingId, commandName: 'startWork',
        idempotencyKey: request.idempotencyKey, report: git.report,
      })
    }
    return saved
  })
}

/** 链路推进写入的系统事实边：工作项 → 执行上下文 → 工作树（携带分支）。 */
async function recordStartFacts(context: RelationStore, request: StartWorkRequest, contextId: ExecutionContextId, git: GitOutcome): Promise<void> {
  const workItemId = asBrandedId<EntityId>(request.workItemId)
  const contextEntityId = asEntityId(contextId)
  const edges: DiscoveredEdge[] = [{
    from: workItemId, to: contextEntityId, type: RelationType.Tracks, provenance: EdgeProvenance.Command,
    artifact: chainNode(contextEntityId, EntityKind.ExecutionContext, contextId, undefined, true),
  }]
  const slot = git.worktreeExternalId // has_worktree 只由真实的工作树 ack 产生，不借分支句柄冒充（#192）
  if (slot !== undefined) {
    // 工作树的**实体身份**只由 `worktreeEntityId` 定义：这个工作项**在这个仓库上**的工作树。
    // 路径（`git.worktreeExternalId`）随供应路径变化——首次创建时它是 provider 的规范化路径，复用
    // （conflict）时它是调用方传入的字符串，工作树步失败时它连值都没有——把它放进键里，同一份工作树
    // 就会拿到第二个实体 id，违反 `AGENTS.md` §1.1 不变量 6。
    // 作用域用 `request.repositoryId` 而不是 `git.bindingId`：binding 的解析有多个来源，投影侧走的是
    // 另一个 capability key，两者可以独立不可用；`repositoryId` 在执行上下文记录里本来就有，两侧取
    // 同一个事实，分叉从构造上不存在。投影侧（`worktreeNode`）调的是同一个函数。
    // provider 的值仍然作为**句柄**挂在图谱节点上（移除工作树要用它）——身份稳定，句柄权威。
    const worktreeId = worktreeEntityId(context.workspaceId, request.repositoryId, request.workItemId)
    edges.push({
      from: contextEntityId, to: worktreeId, type: RelationType.HasWorktree, provenance: EdgeProvenance.Command,
      artifact: chainNode(worktreeId, EntityKind.Worktree, slot, git.branchExternalId ?? slot, true),
    })
  }
  await recordEdges(context, edges)
}

async function startExecution(
  context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, git: GitOutcome,
): Promise<StartWorkResult> {
  const target = resolveWriteTarget(context.registry, CapabilityKey.ExecutionRunStart)
  const provider = target.binding?.execution
  if (provider === undefined || target.binding === undefined) {
    return manualFallback(context, contextId, git, target.error ?? unsupportedCapability(CapabilityKey.ExecutionRunStart))
  }
  const existing = await context.storage.getExecutionRun(runIdFor(contextId))
  if (existing !== undefined) {
    return existingRun(git, existing)
  }
  const run = await provider.startRun({
    context: { bindingId: target.binding.ref.bindingId, objectKind: 'execution_context', externalId: contextId, url: undefined },
    // 分支身份由序列决定，不由本次请求重新推导：重放时调用方可以省略 `branchName`，那时
    // `namesFor(request).branch` 是默认名，而序列已经决定的是记录里的那个名字。用错会让 run command
    // 指向一个不存在的分支——这正是 `git-provisioning.ts` 里「序列一旦决定了身份，后续每一步都必须
    // 用它」那条命题的下一步。
    command: `harness run ${git.branchExternalId ?? namesFor(request).branch}`, environment: {},
  })
  if (!run.ok) return manualFallback(context, contextId, git, toProjectError(run.error))
  const status = runStatusFor(run.value.status)
  await localWrite(git, () => recordRun(context, contextId, status, run.value.ref), run.value.ref.externalId)
  if (status === ExecutionRunStatus.Unknown) return unknownRun(git, `ack 的状态 ${run.value.status} 不是已知取值`, run.value.ref.externalId) // 本地记成 unknown，顶层也是 Unknown（与重放、Query 一致）
  return toResult(git.report, outcomeOf(git, undefined, run.value.ref.externalId), undefined)
}

/**
 * 执行启动失败：上下文、工作树与分支都保留并降级。fallback 绑定过了写门且 ack 了 `running` 才落那条运行，否则记 failed；
 * 主执行结果不确定（`ambiguous_result`）时它可能已在跑，不起第二个执行者（ADR-0007），记 unknown 并报 Unknown；接管时已有运行同理，不覆盖它。
 */
async function manualFallback(
  context: CoreContext, contextId: ExecutionContextId, git: GitOutcome, error: ProjectError,
): Promise<StartWorkResult> {
  const existing = await context.storage.getExecutionRun(runIdFor(contextId))
  if (existing !== undefined) return existingRun(git, existing)
  if (error.code === ProjectErrorCode.AmbiguousResult) {
    // 运行可能已在跑：不记 failed、不转人工降级，本地记 unknown，顶层 Unknown，与重放、Query 同一个答案（评审 P2）。
    await localWrite(git, () => recordRun(context, contextId, ExecutionRunStatus.Unknown))
    return unknownRun(git, `startRun 的结果不确定：${error.message}`, undefined)
  }
  const fallback = resolveWriteTarget(context.registry, CapabilityKey.ExecutionRunFallback).binding
  if (fallback?.execution !== undefined) {
    const run = await fallback.execution.startRun({
      context: { bindingId: fallback.ref.bindingId, objectKind: 'execution_context', externalId: contextId, url: undefined },
      command: `manual fallback ${git.branchExternalId ?? ''}`.trim(), environment: {},
    })
    if (run.ok && run.value.status === 'running') {
      await recordRun(context, contextId, runStatusFor(run.value.status), run.value.ref, true)
      return toResult(git.report, outcomeOf(git, StartWorkFallback.Manual, run.value.ref.externalId), undefined)
    }
  }
  await recordRun(context, contextId, ExecutionRunStatus.Failed, undefined, true)
  return toResult(git.report, outcomeOf(git, StartWorkFallback.Manual), error)
}

async function recordRun(context: CoreContext, contextId: ExecutionContextId, status: ExecutionRunStatus, providerRef?: ExternalObjectRef, fallback = false): Promise<void> {
  await context.storage.putExecutionRun({
    id: runIdFor(contextId), workspaceId: context.workspaceId, contextId, status, updatedAt: context.clock(),
    ...(providerRef === undefined ? {} : { providerRef }), ...(fallback ? { fallback } : {}),
  })
}

async function saveContext(
  context: CoreContext, contextId: ExecutionContextId, request: StartWorkRequest,
  status: ExecutionContextStatus, branchExternalId: string | undefined, worktreeExternalId: string | undefined,
  storage: StorageTransaction = context.storage,
): Promise<ExecutionContextRecord> {
  // 分步回填会在 `Provisioning` 中途写记录；清掉租约起点会让在途保护失效（`claimContext` 用它
  // 判断租约是否过期），所以中途写入必须保留它。终态不再被租约查询，按原样清空。
  const existing = await storage.getExecutionContext(contextId)
  const keepLease = status === ExecutionContextStatus.Provisioning ? existing?.provisioningStartedAt : undefined
  // 已决定的分支身份**写一次**：记录里已有的值优先，本次尝试产出的 `undefined` 只表示「没走到这一步」，不表示
  // 清空。今天两者在能走到这里的路径上不会分歧（重放时 `provisionGit` 只会产出同一个名字），选 `existing ??`
  // 是为了把这条不变量写成代码，而不是写成「碰巧」。**只保留分支，不保留工作树句柄**：工作树步每次重放都重跑，
  // 谱系把 `worktreeExternalId !== undefined` 当作「已观察到」的锚点，失败的尝试若留下旧句柄，谱系会在它上面
  // 读头提交、变更请求与流水线，违反 ack 约束。也不在 `provisionGit` 的能力不可用分支里补传已决定的分支：失败结果面取自这里写出的记录。
  const record: ExecutionContextRecord = {
    ...contextRecord(context, contextId, request, status, existing?.branchExternalId ?? branchExternalId, worktreeExternalId, undefined),
    provisioningStartedAt: keepLease,
  }
  await storage.putExecutionContext(record)
  return record
}

async function existingResult(
  context: CoreContext, contextId: ExecutionContextId, supplied: WriteReport | undefined,
): Promise<StartWorkResult> {
  const record = await context.storage.getExecutionContext(contextId)
  if (record === undefined) {
    const report = supplied ?? reportForExisting(ExecutionContextStatus.Failed)
    return toResult(report, undefined, report.error)
  }
  const run = await context.storage.getExecutionRun(runIdFor(contextId))
  // 同 key 命中的 Saved 报告只在记录仍是 Ready 时才算数（Failed 报 Failed，Provisioning 报在途）；命中的 Failed / Unknown 报告不因 Ready 被提升，缺口与读回失败只改写会报 Saved 的报告。
  let report = supplied?.confirmed && record.status !== ExecutionContextStatus.Ready ? reportForExisting(record.status) : supplied ?? reportForExisting(record.status)
  // 缺口对任何 supplied 都要算（TD-006 止血，评审 P2）：有缺口的 Ready 不读回、不改判 Failed，否则换新 key 接管会在缺 run 记录时再起一个 run；它停在 Unknown，直到 #193 的对账。只有完整的 Ready 读回确定丢失才改判（不分 supplied）。
  const gap = record.status === ExecutionContextStatus.Ready ? await readyGap(context, record, run) : undefined
  if (record.status === ExecutionContextStatus.Ready && gap === undefined) {
    const verified = await verifyExistingWorktree(context, record)
    if (!verified.ok && verified.definite) {
      await context.storage.putExecutionContext({ ...record, status: ExecutionContextStatus.Failed, provisioningStartedAt: undefined })
      const report = markFailed(beginWrite(record.worktreeExternalId ?? record.branchExternalId ?? ''), verified.error)
      return toResult(report, {
        contextId, status: ExecutionContextStatus.Failed, branchExternalId: record.branchExternalId,
        worktreeExternalId: record.worktreeExternalId, branchHeadCommit: undefined,
        fallback: fallbackOf(run),
        runExternalId: undefined,
      }, verified.error)
    }
    // 读不到不等于没有（评审 P2）：瞬时读失败或读能力缺失时保留 Ready，会报 Saved 的报告改成 Unknown。
    if (!verified.ok && report.confirmed) report = reportFor(WritePhase.Unknown, report.values, projectError(ProjectErrorCode.ResultUnknown, `已 ready 的上下文暂时无法确认工作树（${verified.error.code}：${verified.error.message}），保留 Ready 与句柄、不改判 Failed，需先对账`))
  }
  if (gap !== undefined && report.confirmed) report = reportFor(WritePhase.Unknown, report.values, projectError(ProjectErrorCode.ResultUnknown, `已 ready 的上下文（${gap}）：外部执行是否已启动无法确认，保留 Ready 与句柄、不起新的 run，需先对账（#193）`))
  const fallback = fallbackOf(run)
  return toResult(report, {
    contextId, status: record.status, branchExternalId: record.branchExternalId,
    worktreeExternalId: record.worktreeExternalId,
    // 上下文记录里没有分支头提交这一列（Storage 契约不归本批次改），所以读回路径报不出来。
    branchHeadCommit: undefined,
    fallback, runExternalId: run?.providerRef?.externalId,
  }, report.error)
}

async function verifyExistingWorktree(
  context: CoreContext,
  record: Awaited<ReturnType<CoreContext['storage']['getExecutionContext']>> & object,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly definite: boolean; readonly error: ProjectError }> {
  // `definite`：只有本地记录缺句柄、provider 确定工作树不存在或检出了别的分支，才是确定的结论；读能力缺失与读失败都只是「此刻无法确认」。
  if (record.worktreeExternalId === undefined || record.branchExternalId === undefined) {
    return { ok: false, definite: true, error: projectError(ProjectErrorCode.ResultUnknown, 'ready 上下文缺少工作树或分支身份，不能确认 Saved') }
  }
  // 读回也按仓库路由：缺路由（例如重组后换了连接）只是「此刻无法确认」，绝不问另一个连接、也不据此改判 Failed（D8）。
  const route = await routeDevelopment(context, record.repositoryId, CapabilityKey.DevelopmentWorktreeRead, 'read')
  if (!route.ok) return { ok: false, definite: false, error: route.error }
  const { provider } = route
  if (provider.getWorktree === undefined) return { ok: false, definite: false, error: projectError(ProjectErrorCode.NotSupported, '当前 Development provider 没有工作树读能力，不能确认 Saved') }
  const ref = { bindingId: route.binding.ref.bindingId, objectKind: 'worktree', externalId: record.worktreeExternalId, url: undefined }
  const observed = await provider.getWorktree({ worktree: ref })
  if (!observed.ok) return { ok: false, definite: observed.error.code === ProviderErrorCode.NotFound, error: toProjectError(observed.error) }
  if (observed.value.branch !== record.branchExternalId) {
    return { ok: false, definite: true, error: projectError(ProjectErrorCode.Conflict, `已记录工作树检出的分支 ${observed.value.branch} 与 ${record.branchExternalId} 不一致`) }
  }
  return { ok: true }
}
