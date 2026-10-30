/**
 *
 * `git-provisioning.ts`。
 */
import {
  CapabilityKey, ProjectErrorCode, externalIntentSnapshot, projectError, providerErr, providerError, type ExecutionContextRecord, type ExecutionRunRecord, type ExternalObjectRef, type MutationAttemptRecord, type StorageTransaction, type StartWorkExternalOperation, type ExecutionProvider, type ProviderStartRunInput,
} from '@harness-projects/capabilities'
import {
  ContentKind, EntityKind, ExecutionContextStatus, ExecutionRunStatus, ExternalIdentityKind, ProviderErrorCode, RelationType, asBrandedId,
  type EntityId, type ExecutionContextId, type ProjectError, type ProviderBindingId,
} from '@harness-projects/domain'
import { resolveWriteTarget, toProjectError, unsupportedCapability } from './capabilities.ts'
import { chainNode, worktreeEntityId } from './chain-facts.ts'
import type { CoreContext } from './context.ts'
import { START_WORK_ROUTE, registerRepository, routeDevelopment, selectDevelopment, type DevelopmentRoute } from './development-route.ts'
import {
  StartWorkFallback, contextIdFor, contextRecord, fallbackOf, readyGap, reportForExisting, runIdFor, runStatusFor,
  startWorkUnavailable, toResult,
  type StartWorkRequest, type StartWorkResult,
} from './execution-context.ts'
import { namesFor, namesProblem, outcomeOf, provisionGit, type GitOutcome } from './git-provisioning.ts'
import { EdgeProvenance, asEntityId, recordEdges, type DiscoveredEdge, type RelationStore } from './relations.ts'
import { bindingConflict, requestFingerprint, requestMismatch, snapshotRequest } from './start-work-request.ts'
import { beginWrite, createWriteLedger, markFailed, reportFor, WritePhase, type WriteReport } from './write-machine.ts'

/**
 */
function validateRequest(request: StartWorkRequest): ProjectError | undefined {
  if (typeof request.workItemId !== 'string' || request.workItemId.trim() === '') return invalid('workItemId 不能为空')
  if (typeof request.repositoryId !== 'string' || request.repositoryId.trim() === '') return invalid('repositoryId 不能为空')
  if (typeof request.idempotencyKey !== 'string' || request.idempotencyKey.trim() === '') return invalid('idempotencyKey 不能为空')
  if (request.branchName !== undefined && (typeof request.branchName !== 'string' || request.branchName.trim() === '')) return invalid('branchName 不能为空')
  // 身份闸门：退化的工作项 id 会让两个工作项共用同一个分支名；输入形状错误先于存在性判定，也先于任何写入。
  const degenerate = namesProblem(request.workItemId)
  return degenerate === undefined ? undefined : invalid(degenerate)
}

function invalid(message: string): ProjectError {
  return projectError(ProjectErrorCode.InvalidInput, message)
}

export async function startWork(context: CoreContext, input: StartWorkRequest): Promise<StartWorkResult> {
  const request = snapshotRequest(input)
  if (request === undefined) return startWorkUnavailable(invalid('actor 与 worktreePath 必须是声明的 primitive 类型'))
  const invalidInput = validateRequest(request)
  if (invalidInput !== undefined) return startWorkUnavailable(invalidInput)
  const targetError = await startTargetError(context, request.workItemId)
  if (targetError !== undefined) return startWorkUnavailable(targetError)
  const contextId = contextIdFor(context.workspaceId, request.workItemId, request.repositoryId)
  const replayed = await context.storage.findMutationAttempt(context.workspaceId, request.idempotencyKey)
  if (replayed !== undefined) return replayRequest(context, contextId, request, replayed)
  // 只有没有 context 记录的新请求才预检、过能力门并 ack；已有记录（终态接管、过期续跑、在途、Ready）沿用原路径。
  const existing = await context.storage.getExecutionContext(contextId)
  const prepared = existing === undefined ? await prepareRegistration(context, request, contextId) : undefined
  if (prepared?.ok === false) return startWorkUnavailable(prepared.error)
  const observing = existing !== undefined && !needsSupply(existing, context.clock())
  const route = prepared?.route ?? await selectDevelopment(context, request.repositoryId, START_WORK_ROUTE.anchor[0])
  if (!route.ok) {
    if (observing) return existingResult(context, contextId, undefined)
    const gated = await routeDevelopment(context, request.repositoryId, ...START_WORK_ROUTE.anchor)
    return startWorkUnavailable(gated.ok ? route.error : gated.error)
  }
  let claimed: Awaited<ReturnType<typeof claimContext>>
  try {
    claimed = await claimContext(context, contextId, request, route, prepared?.register)
  } catch (error) {
    if (error instanceof GenerationExhausted) return conflictResult(projectError(ProjectErrorCode.Conflict, error.message))
    if (prepared === undefined) throw error // 已有记录（终态接管、过期续跑、在途、Ready）保持原行为：此前的尝试可能已经有过外部写入
    // 新请求的认领事务整笔回滚，此时还没有任何外部写入：结构化失败，不冒充外部结果未知。
    return startWorkUnavailable(projectError(ProjectErrorCode.Unavailable, `本地登记失败，没有发起任何外部写入：${error instanceof Error ? error.message : String(error)}`))
  }
  if (claimed.kind === 'replay') return replayRequest(context, contextId, request, claimed.attempt)
  if (claimed.kind === 'conflict') return conflictResult(claimed.error)
  if (claimed.kind === 'rejected') return claimed.result
  if (claimed.kind !== 'new' && claimed.kind !== 'resume') return existingResult(context, contextId, undefined)
  // 本地结算故障只由 localWrite 转换；外部创建的 throw 在各调用点保留为 Unknown。
  return provision(context, request, contextId, claimed.route, claimed.generation).catch((error) => {
    if (error instanceof OwnerLost) return ownerLostResult(error)
    if (error instanceof LocalWriteFailed) return unknownAfterAck(error)
    throw error
  })
}

function conflictResult(error: ProjectError): StartWorkResult {
  const report = reportFor(WritePhase.Conflict, { attemptedValue: undefined, lastKnownAuthoritative: undefined }, error)
  return toResult(report, undefined, error)
}
async function replayRequest(context: CoreContext, contextId: ExecutionContextId, request: StartWorkRequest, attempt: MutationAttemptRecord): Promise<StartWorkResult> {
  if (requestMismatch(context.workspaceId, request, attempt)) return conflictResult(bindingConflict('idempotency_request_mismatch'))
  const route = await selectDevelopment(context, request.repositoryId, START_WORK_ROUTE.anchor[0])
  if (!route.ok || route.binding.ref.bindingId !== attempt.bindingId) return conflictResult(bindingConflict('idempotency_target_changed'))
  const supplied = attempt.state === 'pending' && !unresolved(attempt) ? undefined : await createWriteLedger(context.storage).replay(context.workspaceId, request.idempotencyKey)
  return existingResult(context, contextId, supplied)
}
function unresolved(attempt: MutationAttemptRecord): boolean {
  return attempt.externalIntent !== undefined && (['pending', 'unknown'].includes(attempt.externalIntent.state) || attempt.state === 'unknown')
}

class GenerationExhausted extends Error { constructor() { super('开始工作的 owner 代际已耗尽，未发起外部写入') } }
class OwnerLost extends Error {
  readonly acked: GitOutcome | undefined; readonly runExternalId: string | undefined
  constructor(acked?: GitOutcome, runExternalId?: string) { super('开始工作的所有权已丢失'); this.acked = acked; this.runExternalId = runExternalId }
}
function nextGeneration(record: ExecutionContextRecord | undefined): number {
  const previous = record?.provisioningGeneration ?? 0
  if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER) throw new GenerationExhausted()
  return previous + 1
}
/** 比较 owner 与依赖读写处于同一短事务；Provider I/O 永不放进这里。 */
function owned<T>(context: CoreContext, id: ExecutionContextId, generation: number, work: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  return context.storage.transaction(async (tx) => {
    if (!Number.isSafeInteger(generation) || generation < 1 || (await tx.getExecutionContext(id))?.provisioningGeneration !== generation) throw new OwnerLost()
    return work(tx)
  })
}
const checkOwner = (context: CoreContext, id: ExecutionContextId, generation: number) => owned(context, id, generation, async () => {})
function ownerLostResult({ acked, runExternalId }: OwnerLost): StartWorkResult {
  const error = projectError(acked?.report.phase === WritePhase.Unknown || acked?.branchExternalId !== undefined || runExternalId !== undefined ? ProjectErrorCode.ResultUnknown : ProjectErrorCode.Conflict, '开始工作的所有权已丢失；保留外部结果，需先对账')
  return acked === undefined ? conflictResult(error) : toResult(reportFor(error.code === ProjectErrorCode.ResultUnknown ? WritePhase.Unknown : WritePhase.Conflict, acked.report.values, error), outcomeOf(acked, undefined, runExternalId), error)
}

/** ack 之后的本地写失败：只由 `localWrite`（显式的本地写调用点，不包 Provider 调用）抛出，带着最后一个已 ack 的步骤结果（其 `status` 是本地记录此刻的状态）；run 记录的失败还带着已 ack 的 run 句柄。 */
class LocalWriteFailed extends Error {
  readonly acked: GitOutcome
  readonly runExternalId: string | undefined
  constructor(acked: GitOutcome, cause: unknown, runExternalId?: string) { super(cause instanceof Error ? cause.message : String(cause), { cause }); this.acked = acked; this.runExternalId = runExternalId }
}
async function localWrite<T>(acked: GitOutcome, write: () => Promise<T>, runExternalId?: string): Promise<T> {
  try { return await write() } catch (error) { if (error instanceof OwnerLost) throw new OwnerLost(acked, runExternalId); throw new LocalWriteFailed(acked, error, runExternalId) }
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

/** 当前可见性先于重放与路由；准入事务复用同一判定，不把早期读取当成登记许可。 */
export async function startTargetError(
  context: Pick<CoreContext, 'workspaceId'> & { readonly storage: Pick<StorageTransaction, 'getPlanningProjection'> }, workItemId: string,
): Promise<ProjectError | undefined> {
  if (typeof workItemId !== 'string' || workItemId.trim() === '') return invalid('workItemId 不能为空')
  const degenerate = namesProblem(workItemId)
  if (degenerate !== undefined) return invalid(degenerate)
  const projection = await context.storage.getPlanningProjection(context.workspaceId, asBrandedId<EntityId>(workItemId))
  if (projection === undefined || projection.content.contentKind === ContentKind.Redacted) {
    return projectError(ProjectErrorCode.NotFound, '规划条目不存在或对当前凭据不可见，无法开始工作')
  }
  if (projection.content.contentKind === ContentKind.ChangeRequest) return projectError(ProjectErrorCode.InvalidInput, '变更请求不是可开始工作的工作项')
  return undefined
}

/** 写前事务里要做的登记：`claimContext` 在没有记录的分支里先调它，再写 Provisioning。 */
type Registration = (tx: StorageTransaction) => Promise<void>
type Prepared = { readonly ok: true; readonly register: Registration; readonly route: DevelopmentRoute } | { readonly ok: false; readonly error: ProjectError }

/**
 * 新请求在可见性守卫之后的只读准备：按仓库路由并在同一挂载上过能力门
 * （缺路由、歧义与「绑定 id 变了」都在这里拒绝）→ 向路由到的 Development provider 要仓库 ack（`ref` 必须逐字等于路由给出的引用）；通过后返回写前事务里的登记。
 */
async function prepareRegistration(context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId): Promise<Prepared> {
  const reject = (error: ProjectError): Prepared => ({ ok: false, error })
  const [key, mode] = START_WORK_ROUTE.anchor
  const route = await routeDevelopment(context, request.repositoryId, key, mode, START_WORK_ROUTE.earlier)
  if (!route.ok) return reject(route.error)
  const { provider, repository } = route
  const found = await provider.getRepository(repository)
  if (!found.ok) return reject(toProjectError(found.error))
  const acked = found.value.ref
  if (acked.bindingId !== repository.bindingId || acked.objectKind !== repository.objectKind || acked.externalId !== repository.externalId) {
    return reject(projectError(ProjectErrorCode.Conflict, `仓库 ack 的身份 ${acked.bindingId}/${acked.objectKind}/${acked.externalId} 与请求的 ${repository.bindingId}/repository/${repository.externalId} 不一致`))
  }
  return { ok: true, route, register: (tx) => registerParents(tx, context, request, contextId, repository.bindingId) }
}

/**
 * 写前登记（与 claim 同一个事务）：仓库经唯一写者 `registerRepository` 懒登记到路由到的连接（未登记时写 canonical 实体、primary 身份与工作区挂载；
 * 已登记且该连接已有引用时零写入），再写 context 实体与 reserved worktree 实体。
 * 懒登记不给已登记的仓库补引用（那只归绑定命令）：路由读到「未登记」之后、认领之前有并发绑定登记了仓库时，路由到的连接下没有它的引用——
 * 抛错令认领回滚、结构化 unavailable 且无外部写入（风险 R5），不补出与绑定命令所写同类的第二条引用（它会让该仓库的路由永久歧义）。
 * 它们是外键父行，也是 tracks / has_worktree 的端点；放在写前而不是 final，读谱系才不会因写路径的中间态抛外键错误。
 * reserved worktree 实体只表示本地槽位，不是工作树 observed 的证据。
 */
async function registerParents(
  tx: StorageTransaction, context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, bindingId: ProviderBindingId,
): Promise<void> {
  if ((await tx.listRepositories(context.workspaceId)).some((mount) => mount.id === request.repositoryId)
    && await tx.findExternalIdentity(bindingId, ExternalIdentityKind.Repository, request.repositoryId) === undefined) {
    throw new Error(`仓库 ${request.repositoryId} 在路由之后已被登记，连接 ${bindingId} 下没有它的引用：开始工作不给已登记的仓库补引用`)
  }
  await registerRepository(tx, context.ids, context.workspaceId, request.repositoryId, [bindingId])
  await tx.putEntity({ id: asEntityId(contextId), kind: EntityKind.ExecutionContext })
  await tx.putEntity({ id: worktreeEntityId(context.workspaceId, request.repositoryId, request.workItemId), kind: EntityKind.Worktree })
}

/** 租约只允许无未决外部槽位的恢复；时间不能证明外部创建未发生。 */
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

function needsSupply(record: ExecutionContextRecord, now: string): boolean {
  return isTerminal(record.status) || (record.status === ExecutionContextStatus.Provisioning && leaseExpired(record.provisioningStartedAt, now))
}

/** workspace/key 与 context 租约在同一事务认领；先占键，再写父行与 context，失败整笔回滚。 */
type Claim = { readonly kind: 'replay'; readonly attempt: MutationAttemptRecord } | { readonly kind: 'conflict'; readonly error: ProjectError }
  | { readonly kind: 'rejected'; readonly result: StartWorkResult }
  | { readonly kind: 'new' | 'resume'; readonly route: Extract<DevelopmentRoute, { ok: true }>; readonly generation: number }
  | { readonly kind: 'in-flight' | 'existing'; readonly route: DevelopmentRoute }
async function claimContext(
  context: CoreContext, contextId: ExecutionContextId, request: StartWorkRequest, selected: Extract<DevelopmentRoute, { ok: true }>, register?: Registration,
): Promise<Claim> {
  const now = context.clock()
  return context.storage.transaction(async (tx): Promise<Claim> => {
    const targetError = await startTargetError({ workspaceId: context.workspaceId, storage: tx }, request.workItemId)
    if (targetError !== undefined) return { kind: 'rejected', result: startWorkUnavailable(targetError) }
    const attempt = await tx.findMutationAttempt(context.workspaceId, request.idempotencyKey)
    if (attempt !== undefined) return { kind: 'replay', attempt }
    const source = { ...context, storage: tx }
    const current = await selectDevelopment(source, request.repositoryId, START_WORK_ROUTE.anchor[0])
    if (!current.ok || current.binding.ref.bindingId !== selected.binding.ref.bindingId) return { kind: 'conflict', error: bindingConflict('idempotency_target_changed') }
    const existing = await tx.getExecutionContext(contextId)
    const pending = (await tx.listMutationAttempts(context.workspaceId)).find((row) => row.externalIntent?.contextId === contextId && unresolved(row))
    if (pending !== undefined) {
      const report = await createWriteLedger(tx).replay(context.workspaceId, pending.idempotencyKey)
      return { kind: 'rejected', result: toResult(report!, existing === undefined ? undefined : {
        contextId, status: existing.status, branchExternalId: existing.branchExternalId, worktreeExternalId: existing.worktreeExternalId,
        branchHeadCommit: undefined, fallback: undefined, runExternalId: (await tx.getExecutionRun(runIdFor(contextId)))?.providerRef?.externalId,
      }, report?.error) }
    }
    const supplying = existing === undefined || needsSupply(existing, now)
    const generation = supplying ? nextGeneration(existing) : existing?.provisioningGeneration
    const route = supplying ? await routeDevelopment(source, request.repositoryId, ...START_WORK_ROUTE.anchor) : current
    if (!route.ok) {
      if (existing === undefined) return { kind: 'rejected', result: startWorkUnavailable(route.error) }
      // 原有续跑拒绝仍结算为 Failed 并清除失效工作树；先复核 key，未获准的请求不占键。
      const names = namesFor(request); const report = markFailed(beginWrite(names.path ?? names.worktreeKey), route.error)
      const saved = await saveContext(context, contextId, request, ExecutionContextStatus.Failed, undefined, undefined, tx, generation)
      const git: GitOutcome = { contextId, report, ok: false, bindingId: undefined, status: saved.status, branchExternalId: saved.branchExternalId,
        worktreeExternalId: undefined, branchHeadCommit: undefined }
      await recordStartFacts({ workspaceId: context.workspaceId, storage: tx }, request, contextId, git)
      return { kind: 'rejected', result: toResult(report, outcomeOf(git), route.error) }
    }
    await createWriteLedger(tx).record({ workspaceId: context.workspaceId, bindingId: selected.binding.ref.bindingId, commandName: 'startWork', idempotencyKey: request.idempotencyKey,
      requestFingerprint: requestFingerprint(context.workspaceId, selected.binding.ref.bindingId, request), report: beginWrite(undefined) })
    if (existing === undefined) {
      await register?.(tx)
      await tx.putExecutionContext({ ...contextRecord(context, contextId, request, ExecutionContextStatus.Provisioning, undefined, undefined, now), provisioningGeneration: generation! })
      return { kind: 'new', route, generation: generation! }
    }
    // 终态可以被接管：一次失败不再把 (工作项, 仓库) 永久锁死。在此之前 `reportForExisting` 那句
    // 「需显式重试或关闭」是一条没有兑现的承诺——端口没有删除入口、`Closed` 没有写者，而
    // `contextIdFor` 是确定性的，所以永远只有这一条记录。
    //
    // **必须保留已记录的步骤字段**（`branchExternalId` / `worktreeExternalId`）：接管的是同一条记录，
    // 不是新建一条。用 `contextRecord(..., undefined, undefined)` 重建会把分步回填的成果抹掉，重放于是
    // 重新推导供应输入——那正是「基线前进后重试失败」的来源。
    if (isTerminal(existing.status)) {
      await tx.putExecutionContext({ ...existing, status: ExecutionContextStatus.Provisioning, provisioningStartedAt: now, provisioningGeneration: generation! })
      return { kind: 'resume', route, generation: generation! }
    }
    if (existing.status !== ExecutionContextStatus.Provisioning) return { kind: 'existing', route }
    if (!leaseExpired(existing.provisioningStartedAt, now)) return { kind: 'in-flight', route }
    await tx.putExecutionContext({ ...existing, provisioningStartedAt: now, provisioningGeneration: generation! })
    return { kind: 'resume', route, generation: generation! }
  })
}

async function provision(context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, route: Extract<DevelopmentRoute, { ok: true }>, generation: number): Promise<StartWorkResult> {
  await checkOwner(context, contextId, generation)
  const names = namesFor(request)
  let observed: GitOutcome = { contextId, report: beginWrite(undefined), ok: false, bindingId: undefined, status: ExecutionContextStatus.Provisioning, branchExternalId: undefined, worktreeExternalId: undefined, branchHeadCommit: undefined }
  // 每一步成功后立刻回填：中断在两步之间时，重放跳过已完成的那一步（批次计划 D2）。两步写的都是 Provisioning，Ready 要等 `settle`。
  const git = await provisionGit(context, request, names, contextId, async (outcome) => {
    observed = outcome
    await localWrite(outcome, () => owned(context, contextId, generation, async (tx) => {
      await saveContext(context, contextId, request, outcome.status, outcome.branchExternalId, outcome.worktreeExternalId, tx)
      await writeReceipt(tx, context, request, 'pending', 'saved')
    }))
  }, route, (operation) => localWrite(observed, () => beforeExternal(context, request, contextId, generation, operation, route.binding.ref.bindingId)))
  const saved = await localWrite({ ...git, status: ExecutionContextStatus.Provisioning }, () => settle(context, request, contextId, git, generation)) // 结算失败时记录仍停在 Provisioning
  // 失败路径的结果面取自**写入后的记录**，不取本次尝试的中间结果：能力不可用时 `git.branchExternalId` 是
  // `undefined`（本次没走到分支步），而记录里保留着此前已决定的分支；调用返回一个答案、记录与 `existingResult`
  // 返回另一个，就是 Host 权威状态分叉。`recordStartFacts` 仍吃 `git`（本次观测到的事实），所以不补写关系。
  if (!git.ok) return toResult(git.report, outcomeOf({ ...git, branchExternalId: saved.branchExternalId }), git.report.error)
  return startExecution(context, request, contextId, git, generation)
}

/** 最终事务：context 记录（成功 Ready、失败 Failed）、tracks / has_worktree 与该次 Git 的 mutation_attempt 同生共死；只用 tx，不调根 Storage、Provider，不嵌套事务。 */
function settle(context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, git: GitOutcome, generation: number): Promise<ExecutionContextRecord> {
  return owned(context, contextId, generation, async (tx) => {
    const saved = await saveContext(context, contextId, request, git.status, git.branchExternalId, git.worktreeExternalId, tx)
    await recordStartFacts({ workspaceId: context.workspaceId, storage: tx }, request, contextId, git)
    await writeReceipt(tx, context, request, git.ok ? 'pending' : git.report.writeState, git.ok ? undefined : git.report.writeState, git.report.error?.code)
    return saved
  })
}

async function writeReceipt(tx: StorageTransaction, context: CoreContext, request: StartWorkRequest, state: MutationAttemptRecord['state'], step?: MutationAttemptRecord['state'], errorCode?: ProjectErrorCode): Promise<void> {
  const attempt = await tx.findMutationAttempt(context.workspaceId, request.idempotencyKey)
  if (attempt === undefined || requestMismatch(context.workspaceId, request, attempt)) throw new Error('Start Work admission receipt missing or changed')
  await tx.putMutationAttempt({ ...attempt, state, errorCode,
    ...(step === undefined || attempt.externalIntent?.state !== 'pending' ? {} : { externalIntent: { ...attempt.externalIntent, state: step } }) })
}
function beforeExternal(context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, generation: number, operation: StartWorkExternalOperation, bindingId: ProviderBindingId): Promise<void> {
  return owned(context, contextId, generation, async (tx) => {
    const attempt = await tx.findMutationAttempt(context.workspaceId, request.idempotencyKey)
    if (attempt === undefined || requestMismatch(context.workspaceId, request, attempt) || unresolved(attempt)) throw new Error('Start Work intent cannot advance')
    await tx.putMutationAttempt({ ...attempt, state: 'pending', externalIntent: externalIntentSnapshot({ ...operation, contextId, ownerGeneration: generation, bindingId, state: 'pending' }) })
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
  context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, git: GitOutcome, generation: number,
): Promise<StartWorkResult> {
  const finish = (result: StartWorkResult, status?: ExecutionRunStatus, ref?: ExternalObjectRef, fallback = false) =>
    localWrite(git, () => recordRun(context, request, contextId, generation, result, status, ref, fallback), ref?.externalId)
  if (git.worktreeExternalId === undefined) return finish(unknownRun(git, '缺少 Git ack 的工作目录，不能启动执行', undefined))
  const target = resolveWriteTarget(context.registry, CapabilityKey.ExecutionRunStart)
  const provider = target.binding?.execution
  if (provider === undefined || target.binding === undefined) return manualFallback(context, request, contextId, git, generation, target.error ?? unsupportedCapability(CapabilityKey.ExecutionRunStart))
  const existing = await localWrite(git, () => owned(context, contextId, generation, (tx) => tx.getExecutionRun(runIdFor(contextId))))
  if (existing !== undefined) return finish(existingRun(git, existing))
  const run = await startExternalRun(context, request, contextId, git, generation, provider, target.binding.ref.bindingId, {
    workingDirectory: git.worktreeExternalId,
    context: { bindingId: target.binding.ref.bindingId, objectKind: 'execution_context', externalId: contextId, url: undefined },
    command: `harness run ${git.branchExternalId ?? namesFor(request).branch}`, environment: {},
  }, false)
  if (!run.ok) {
    const error = toProjectError(run.error)
    if (run.error.code === ProviderErrorCode.AmbiguousResult) return finish(unknownRun(git, error.message, undefined), ExecutionRunStatus.Unknown)
    await localWrite(git, () => owned(context, contextId, generation, (tx) => writeReceipt(tx, context, request, 'pending', 'failed', error.code)))
    return manualFallback(context, request, contextId, git, generation, error)
  }
  const status = runStatusFor(run.value.status)
  return finish(status === ExecutionRunStatus.Unknown ? unknownRun(git, `ack 的状态 ${run.value.status} 不是已知取值`, run.value.ref.externalId)
    : toResult(git.report, outcomeOf(git, undefined, run.value.ref.externalId), undefined), status, run.value.ref)
}

/** 写前只提交当前运行的真实连接与输入；仅围住 Provider I/O，把丢响应保留为未知。 */
async function startExternalRun(context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, git: GitOutcome, generation: number,
  provider: ExecutionProvider, bindingId: ProviderBindingId, input: ProviderStartRunInput, fallback: boolean) {
  await localWrite(git, () => beforeExternal(context, request, contextId, generation, { operation: fallback ? 'startFallbackRun' : 'startRun', input }, bindingId))
  try { return await provider.startRun(structuredClone(input)) }
  catch (error) { return providerErr(providerError(ProviderErrorCode.AmbiguousResult, String(error))) }
}

async function manualFallback(
  context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, git: GitOutcome, generation: number, error: ProjectError,
): Promise<StartWorkResult> {
  const finish = (result: StartWorkResult, status?: ExecutionRunStatus, ref?: ExternalObjectRef) =>
    localWrite(git, () => recordRun(context, request, contextId, generation, result, status, ref, true), ref?.externalId)
  const existing = await localWrite(git, () => owned(context, contextId, generation, (tx) => tx.getExecutionRun(runIdFor(contextId))))
  if (existing !== undefined) return finish(existingRun(git, existing))
  if (git.worktreeExternalId === undefined) return finish(unknownRun(git, '缺少 Git ack 的工作目录，不能人工接管', undefined))
  const fallback = resolveWriteTarget(context.registry, CapabilityKey.ExecutionRunFallback).binding
  if (fallback?.execution !== undefined) {
    const run = await startExternalRun(context, request, contextId, git, generation, fallback.execution, fallback.ref.bindingId, {
      workingDirectory: git.worktreeExternalId,
      context: { bindingId: fallback.ref.bindingId, objectKind: 'execution_context', externalId: contextId, url: undefined },
      command: `manual fallback ${git.branchExternalId ?? ''}`.trim(), environment: {},
    }, true)
    if (!run.ok && run.error.code === ProviderErrorCode.AmbiguousResult) return finish(unknownRun(git, run.error.message, undefined), ExecutionRunStatus.Unknown)
    if (run.ok) {
      const status = runStatusFor(run.value.status)
      if (status === ExecutionRunStatus.Unknown) return finish(unknownRun(git, `ack 的状态 ${run.value.status} 不是已知取值`, run.value.ref.externalId), status, run.value.ref)
      if (status !== ExecutionRunStatus.Running) return localWrite(git, () => recordRun(context, request, contextId, generation,
        toResult(git.report, outcomeOf(git, StartWorkFallback.Manual), error), ExecutionRunStatus.Failed, undefined, true), run.value.ref.externalId)
      return finish(toResult(git.report, outcomeOf(git, StartWorkFallback.Manual, run.value.ref.externalId), undefined), status, run.value.ref)
    }
    await localWrite(git, () => owned(context, contextId, generation, (tx) => writeReceipt(tx, context, request, 'pending', 'failed', run.error.code as ProjectErrorCode)))
  }
  return finish(toResult(git.report, outcomeOf(git, StartWorkFallback.Manual), error), ExecutionRunStatus.Failed)
}

async function recordRun(context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, generation: number, result: StartWorkResult,
  status?: ExecutionRunStatus, providerRef?: ExternalObjectRef, fallback = false): Promise<StartWorkResult> {
  return owned(context, contextId, generation, async (tx) => {
    if (status !== undefined) await tx.putExecutionRun({
      id: runIdFor(contextId), workspaceId: context.workspaceId, contextId, status, updatedAt: context.clock(),
      ...(providerRef === undefined ? {} : { providerRef }), ...(fallback ? { fallback } : {}),
    })
    await writeReceipt(tx, context, request, result.writeState, result.writeState, result.error?.code)
    return result
  })
}

async function saveContext(
  context: CoreContext, contextId: ExecutionContextId, request: StartWorkRequest,
  status: ExecutionContextStatus, branchExternalId: string | undefined, worktreeExternalId: string | undefined,
  storage: StorageTransaction = context.storage, generation?: number,
): Promise<ExecutionContextRecord> {
  // 分步回填会在 `Provisioning` 中途写记录；清掉租约起点会让在途保护失效（`claimContext` 用它
  // 判断租约是否过期），所以中途写入必须保留它。终态不再被租约查询，按原样清空。
  const existing = await storage.getExecutionContext(contextId)
  const keepLease = status === ExecutionContextStatus.Provisioning ? existing?.provisioningStartedAt : undefined
  const keptGeneration = generation ?? existing?.provisioningGeneration
  // 已决定的分支身份**写一次**：记录里已有的值优先，本次尝试产出的 `undefined` 只表示「没走到这一步」，不表示
  // 清空。今天两者在能走到这里的路径上不会分歧（重放时 `provisionGit` 只会产出同一个名字），选 `existing ??`
  // 是为了把这条不变量写成代码，而不是写成「碰巧」。**只保留分支，不保留工作树句柄**：工作树步每次重放都重跑，
  // 谱系把 `worktreeExternalId !== undefined` 当作「已观察到」的锚点，失败的尝试若留下旧句柄，谱系会在它上面
  // 读头提交、变更请求与流水线，违反 ack 约束。也不在 `provisionGit` 的能力不可用分支里补传已决定的分支：失败结果面取自这里写出的记录。
  const record: ExecutionContextRecord = {
    ...contextRecord(context, contextId, request, status, existing?.branchExternalId ?? branchExternalId, worktreeExternalId, undefined),
    provisioningStartedAt: keepLease,
    ...(keptGeneration === undefined ? {} : { provisioningGeneration: keptGeneration }),
  }
  await storage.putExecutionContext(record)
  return record
}

async function existingResult(
  context: CoreContext, contextId: ExecutionContextId, supplied: WriteReport | undefined, verify = true,
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
  if (verify && record.status === ExecutionContextStatus.Ready && gap === undefined) {
    const verified = await verifyExistingWorktree(context, record)
    if (!verified.ok && verified.definite) {
      const changed = await context.storage.transaction(async (tx) => {
        const current = await tx.getExecutionContext(contextId)
        if (current?.provisioningGeneration !== record.provisioningGeneration || current?.status !== ExecutionContextStatus.Ready
          || current.branchExternalId !== record.branchExternalId || current.worktreeExternalId !== record.worktreeExternalId) return false
        await tx.putExecutionContext({ ...current, status: ExecutionContextStatus.Failed, provisioningStartedAt: undefined })
        return true
      })
      if (!changed) return existingResult(context, contextId, undefined, false)
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
