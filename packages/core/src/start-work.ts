/**
 *
 * `git-provisioning.ts`。
 */
import { CapabilityKey, ProjectErrorCode, projectError } from '@harness-projects/capabilities'
import {
  EntityKind, ExecutionContextStatus, ExecutionRunStatus, RelationType, asBrandedId,
  type EntityId, type ExecutionContextId, type ProjectError,
} from '@harness-projects/domain'
import { resolveWriteTarget, toProjectError, unsupportedCapability } from './capabilities.ts'
import { chainNode, worktreeEntityId } from './chain-facts.ts'
import type { CoreContext } from './context.ts'
import {
  StartWorkFallback, contextIdFor, contextRecord, reportForExisting, runIdFor, runStatusFor,
  startWorkUnavailable, toResult,
  type StartWorkRequest, type StartWorkResult,
} from './execution-context.ts'
import { namesFor, namesProblem, outcomeOf, provisionGit, type GitOutcome } from './git-provisioning.ts'
import { EdgeProvenance, asEntityId, recordEdges, type DiscoveredEdge } from './relations.ts'
import { beginWrite, createWriteLedger, markFailed, type WriteLedger, type WriteReport } from './write-machine.ts'

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
  return undefined
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
  const claimed = await claimContext(context, contextId, request)
  if (claimed !== 'new' && claimed !== 'resume') return existingResult(context, contextId, undefined)
  return provision(context, request, contextId, ledger)
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
 */
async function claimContext(
  context: CoreContext, contextId: ExecutionContextId, request: StartWorkRequest,
): Promise<'new' | 'resume' | 'in-flight' | 'existing'> {
  const now = context.clock()
  return context.storage.transaction(async (tx) => {
    const existing = await tx.getExecutionContext(contextId)
    if (existing === undefined) {
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

async function provision(
  context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, ledger: WriteLedger,
): Promise<StartWorkResult> {
  const names = namesFor(request)
  // 身份闸门先于任何外部写入：退化的工作项 id 会让两个工作项共用同一个分支名。
  const problem = namesProblem(request.workItemId)
  if (problem !== undefined) {
    const error = projectError(ProjectErrorCode.InvalidInput, problem)
    await saveContext(context, contextId, request, ExecutionContextStatus.Failed, undefined, undefined)
    return toResult(markFailed(beginWrite(names.path), error), undefined, error)
  }
  // 每一步成功后立刻回填：中断在两步之间时，重放跳过已完成的那一步（批次计划 D2）。
  const git = await provisionGit(context, request, names, contextId, (outcome) =>
    saveContext(context, contextId, request, outcome.status, outcome.branchExternalId, outcome.worktreeExternalId))
  await saveContext(context, contextId, request, git.status, git.branchExternalId, git.worktreeExternalId)
  await recordStartFacts(context, request, contextId, git)
  if (git.bindingId !== undefined) {
    await ledger.record({
      workspaceId: context.workspaceId, bindingId: git.bindingId, commandName: 'startWork',
      idempotencyKey: request.idempotencyKey, report: git.report,
    })
  }
  if (!git.ok) return toResult(git.report, outcomeOf(git), git.report.error)
  return startExecution(context, request, contextId, git)
}

/** 链路推进写入的系统事实边：工作项 → 执行上下文 → 工作树（携带分支）。 */
async function recordStartFacts(context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, git: GitOutcome): Promise<void> {
  const workItemId = asBrandedId<EntityId>(request.workItemId)
  const contextEntityId = asEntityId(contextId)
  const edges: DiscoveredEdge[] = [{
    from: workItemId, to: contextEntityId, type: RelationType.Tracks, provenance: EdgeProvenance.Command,
    artifact: chainNode(contextEntityId, EntityKind.ExecutionContext, contextId, undefined, true),
  }]
  const slot = git.worktreeExternalId ?? git.branchExternalId
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
    return toResult(git.report, outcomeOf(git), undefined)
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
  await recordRun(context, contextId, runStatusFor(run.value.status))
  return toResult(git.report, outcomeOf(git, undefined, run.value.ref.externalId), undefined)
}

/** 执行启动失败：上下文、工作树与分支都保留，只把这次运行记成 failed 并降级人工执行。 */
async function manualFallback(
  context: CoreContext, contextId: ExecutionContextId, git: GitOutcome, error: ProjectError,
): Promise<StartWorkResult> {
  await recordRun(context, contextId, ExecutionRunStatus.Failed)
  return toResult(git.report, outcomeOf(git, StartWorkFallback.Manual), error)
}

async function recordRun(context: CoreContext, contextId: ExecutionContextId, status: ExecutionRunStatus): Promise<void> {
  await context.storage.putExecutionRun({
    id: runIdFor(contextId), workspaceId: context.workspaceId, contextId, status, updatedAt: context.clock(),
  })
}

async function saveContext(
  context: CoreContext, contextId: ExecutionContextId, request: StartWorkRequest,
  status: ExecutionContextStatus, branchExternalId: string | undefined, worktreeExternalId: string | undefined,
): Promise<void> {
  // 分步回填会在 `Provisioning` 中途写记录；清掉租约起点会让在途保护失效（`claimContext` 用它
  // 判断租约是否过期），所以中途写入必须保留它。终态不再被租约查询，按原样清空。
  const existing = await context.storage.getExecutionContext(contextId)
  const keepLease = status === ExecutionContextStatus.Provisioning ? existing?.provisioningStartedAt : undefined
  await context.storage.putExecutionContext({
    ...contextRecord(context, contextId, request, status, branchExternalId, worktreeExternalId, undefined),
    provisioningStartedAt: keepLease,
  })
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
  const report = supplied ?? reportForExisting(record.status)
  const fallback = run?.status === ExecutionRunStatus.Failed ? StartWorkFallback.Manual : undefined
  return toResult(report, {
    contextId, status: record.status, branchExternalId: record.branchExternalId,
    worktreeExternalId: record.worktreeExternalId,
    // 上下文记录里没有分支头提交这一列（Storage 契约不归本批次改），所以读回路径报不出来。
    branchHeadCommit: undefined,
    fallback, runExternalId: undefined,
  }, report.error)
}
