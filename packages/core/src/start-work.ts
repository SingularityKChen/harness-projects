import { isDeepStrictEqual } from 'node:util'
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
import { gateCommand, resolveWriteTarget, toProjectError, unsupportedCapability } from './capabilities.ts'
import { chainNode, worktreeEntityId } from './chain-facts.ts'
import type { CoreContext } from './context.ts'
import { START_WORK_ROUTE, registerRepository, routeDevelopment, selectDevelopment, type DevelopmentRoute } from './development-route.ts'
import {
  StartWorkFallback, contextIdFor, contextRecord, fallbackOf, readyGap, reportForExisting, runIdFor, runStatusFor,
  startWorkUnavailable, toResult,
  type StartWorkRequest, type StartWorkResult,
} from './execution-context.ts'
import { runReadGate, validRunRef } from './execution-run.ts'
import { guardedDevelopmentReads, namesFor, namesProblem, outcomeOf, provisionGit, type GitOutcome } from './git-provisioning.ts'
import { EdgeProvenance, asEntityId, recordEdges, type DiscoveredEdge, type RelationStore } from './relations.ts'
import { bindingConflict, requestFingerprint, requestMismatch, requestScopeMatches, snapshotRequest } from './start-work-request.ts'
import { beginWrite, createWriteLedger, markFailed, reportFor, WritePhase, type WriteReport } from './write-machine.ts'
import { operationDeniedReason } from './runtime-access.ts'

/**
 */
function validateRequest(request: StartWorkRequest): ProjectError | undefined {
  if (typeof request.task !== 'string' || request.task.trim() === '' || request.task.length > 16384) return invalid('task 必须是非空字符串且不超过 16384 个 UTF-16 单元')
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
  const admissionEpoch = context.runtimeAccess.epoch
  const contextId = contextIdFor(context.workspaceId, request.workItemId, request.repositoryId)
  const replayed = await context.storage.findMutationAttempt(context.workspaceId, request.idempotencyKey)
  const changed = await startTargetError(context, request.workItemId, admissionEpoch)
  if (changed) return startWorkUnavailable(changed)
  if (replayed !== undefined && !await safeResume(context, contextId, request, replayed)) return admittedResult(context, admissionEpoch, request.workItemId, replayRequest(context, contextId, request, replayed))
  // 只有没有 context 记录的新请求才预检、过能力门并 ack；已有记录（终态接管、过期续跑、在途、Ready）沿用原路径。
  const existing = await context.storage.getExecutionContext(contextId)
  const prepared = existing === undefined ? await prepareRegistration(context, request, contextId) : undefined
  if (prepared?.ok === false) return startWorkUnavailable(prepared.error)
  const route = prepared?.route ?? await selectDevelopment(context, request.repositoryId, START_WORK_ROUTE.anchor[0])
  if (replayed && (!route.ok || route.binding.ref.bindingId !== replayed.bindingId)) return admittedResult(context, admissionEpoch, request.workItemId, replayRequest(context, contextId, request, replayed))
  if (!route.ok) {
    const run = existing === undefined ? undefined : await context.storage.getExecutionRun(runIdFor(contextId)), pending = await pendingClaim(context, context.storage, contextId, request, existing, run)
    if (pending && requestMismatch(context.workspaceId, request, pending)) return conflictResult(bindingConflict('idempotency_request_mismatch'))
    if (pending) return admittedResult(context, admissionEpoch, request.workItemId, recoverAttempt(context, contextId, pending))
    if (existing?.status === ExecutionContextStatus.Ready || run !== undefined) return conflictResult(projectError(ProjectErrorCode.Conflict, 'existing_execution_task_not_sent'))
    if (existing !== undefined && !needsSupply(existing, context.clock())) return admittedResult(context, admissionEpoch, request.workItemId, existingResult(context, contextId, undefined))
    const gated = await routeDevelopment(context, request.repositoryId, ...START_WORK_ROUTE.anchor)
    return startWorkUnavailable(gated.ok ? route.error : gated.error)
  }
  let claimed: Awaited<ReturnType<typeof claimContext>>
  try {
    claimed = await claimContext(context, contextId, request, route, prepared?.register, admissionEpoch)
  } catch (error) {
    if (error instanceof AdmissionInvalid) return startWorkUnavailable(error.failure)
    if (error instanceof GenerationExhausted) return conflictResult(projectError(ProjectErrorCode.Conflict, error.message))
    if (prepared === undefined) throw error // 已有记录（终态接管、过期续跑、在途、Ready）保持原行为：此前的尝试可能已经有过外部写入
    // 新请求的认领事务整笔回滚，此时还没有任何外部写入：结构化失败，不冒充外部结果未知。
    return startWorkUnavailable(projectError(ProjectErrorCode.Unavailable, `本地登记失败，没有发起任何外部写入：${error instanceof Error ? error.message : String(error)}`))
  }
  if (claimed.kind === 'replay') return admittedResult(context, admissionEpoch, request.workItemId, replayRequest(context, contextId, request, claimed.attempt))
  if (claimed.kind === 'conflict') return conflictResult(claimed.error)
  if (claimed.kind === 'observe') return admittedResult(context, admissionEpoch, request.workItemId, recoverAttempt(context, contextId, claimed.attempt))
  if (claimed.kind === 'rejected') return claimed.result
  if (claimed.kind !== 'new' && claimed.kind !== 'resume') return admittedResult(context, admissionEpoch, request.workItemId, existingResult(context, contextId, undefined))
  // 本地结算故障只由 localWrite 转换；外部创建的 throw 在各调用点保留为 Unknown。
  const owners = activeOwners.get(context) ?? new Set<string>(); activeOwners.set(context, owners); owners.add(contextId)
  return provision(context, request, contextId, claimed.route, claimed.generation, admissionEpoch, claimed.kind === 'resume').catch(async (error) => {
    if (error instanceof AdmissionInvalid) {
      const saved = (await context.storage.getExecutionContext(contextId))!, failure = error.failure
      const acked: GitOutcome = { contextId, report: beginWrite(undefined), ok: false, bindingId: claimed.route.binding.ref.bindingId,
        status: saved.status, branchExternalId: saved.branchExternalId, worktreeExternalId: saved.worktreeExternalId, branchHeadCommit: undefined }
      try {
        await localWrite(acked, () => owned(context, contextId, claimed.generation, async tx => {
          await tx.putExecutionContext({ ...saved, status: ExecutionContextStatus.Failed, provisioningStartedAt: undefined })
          await writeReceipt(tx, context, request, 'failed', 'failed', failure.code)
        }))
        return { ...startWorkUnavailable(failure), executionContextId: contextId, status: ExecutionContextStatus.Failed,
          branchExternalId: saved.branchExternalId, worktreeExternalId: saved.worktreeExternalId }
      } catch (failure) { error = failure }
    }
    if (error instanceof OwnerLost) return ownerLostResult(error)
    if (error instanceof LocalWriteFailed) return admittedRunResult(context, admissionEpoch, request.workItemId, unknownAfterAck(error))
    throw error
  }).finally(() => owners.delete(contextId))
}
const activeOwners = new WeakMap<CoreContext, Set<string>>()

/** 显式 options 只验证当前声明，不清除实际写拒绝，也不触发供应或改写 settled receipt。 */
export async function validateStartWork(context: CoreContext, workItemId: string): Promise<readonly { id: string; available: boolean; reason?: string }[]> {
  const target = await startTargetError(context, workItemId)
  return Promise.all((await context.storage.listRepositories(context.workspaceId)).map(async ({ id }) => {
    const route = await selectDevelopment(context, id, START_WORK_ROUTE.anchor[0])
    let error = target ?? (route.ok ? undefined : route.error)
    if (!error && route.ok) for (const [key, mode] of [...START_WORK_ROUTE.earlier, START_WORK_ROUTE.anchor]) {
      if (key === CapabilityKey.DevelopmentBranchCreate && (await context.storage.getExecutionContext(contextIdFor(context.workspaceId, workItemId, id)))?.branchExternalId) continue
      error = await context.runtimeAccess.operation(route.binding, key, id, context.policy, mode)
      if (error) break
    }
    return { id, available: !error, ...(error ? { reason: error.message } : {}) }
  }))
}

function runtimeAdmissionError(context: StartTargetContext, epoch: number): ProjectError | undefined {
  return context.runtimeAccess.error() ?? (context.runtimeAccess.epoch !== epoch
    ? projectError(ProjectErrorCode.StaleRevision, '开始工作准入已失效，请重新验证后重试') : undefined)
}
class AdmissionInvalid extends Error {
  readonly failure: ProjectError
  constructor(failure: ProjectError) { super(failure.message); this.failure = failure }
}
async function assertAdmission(context: StartTargetContext, epoch: number, workItemId?: string): Promise<void> {
  const error = workItemId === undefined ? runtimeAdmissionError(context, epoch) : await startTargetError(context, workItemId, epoch)
  if (error) throw new AdmissionInvalid(error)
}
async function admittedResult(context: CoreContext, epoch: number, workItemId: string, result: Promise<StartWorkResult>): Promise<StartWorkResult> {
  const value = await result, error = await startTargetError(context, workItemId, epoch)
  return error ? startWorkUnavailable(error) : value
}
/** 当前准入只裁决运行身份；保留已结算的失败/Unknown 与收据，不补读 run 或重建结果。 */
async function admittedRunResult(context: StartTargetContext, epoch: number, workItemId: string, result: StartWorkResult): Promise<StartWorkResult> {
  try {
    if (await startTargetError(context, workItemId, epoch) === undefined && runtimeAdmissionError(context, epoch) === undefined) return result
  } catch { /* 无法确认当前准入时保留原失败事实，但不回显 run。 */ }
  return { ...result, runExternalId: undefined, fallback: undefined }
}

function conflictResult(error: ProjectError): StartWorkResult {
  const report = reportFor(WritePhase.Conflict, { attemptedValue: undefined, lastKnownAuthoritative: undefined }, error)
  return toResult(report, undefined, error)
}
async function replayRequest(context: CoreContext, contextId: ExecutionContextId, request: StartWorkRequest, attempt: MutationAttemptRecord): Promise<StartWorkResult> {
  if (requestMismatch(context.workspaceId, request, attempt)) return conflictResult(bindingConflict('idempotency_request_mismatch'))
  const route = await selectDevelopment(context, request.repositoryId, START_WORK_ROUTE.anchor[0])
  if (!route.ok || route.binding.ref.bindingId !== attempt.bindingId) return conflictResult(bindingConflict('idempotency_target_changed'))
  if (unresolved(attempt) && executionIntent(attempt)) return recoverAttempt(context, contextId, attempt)
  if (unresolved(attempt)) return existingResult(context, contextId, await createWriteLedger(context.storage).replay(context.workspaceId, request.idempotencyKey), false)
  for (const [key, mode] of [...START_WORK_ROUTE.earlier, START_WORK_ROUTE.anchor]) {
    if (mode === 'read') continue // 已确认资源的读取失败仍由 existingResult 报 Unknown，不改写为零副作用失败。
    const error = await context.runtimeAccess.operation(route.binding, key, request.repositoryId, context.policy, mode)
    if (error?.code === ProjectErrorCode.PermissionDenied) return startWorkUnavailable(error)
  }
  const supplied = attempt.state === 'pending' && !unresolved(attempt) ? undefined : await createWriteLedger(context.storage).replay(context.workspaceId, request.idempotencyKey)
  return existingResult(context, contextId, supplied)
}
function unresolved(attempt: MutationAttemptRecord): boolean {
  return attempt.externalIntent !== undefined && (['pending', 'unknown'].includes(attempt.externalIntent.state) || attempt.state === 'unknown')
}

function executionIntent(attempt: MutationAttemptRecord) {
  const intent = attempt.externalIntent
  return attempt.commandName === 'startWork' && intent !== undefined && (intent.operation === 'startRun' || intent.operation === 'startFallbackRun') ? intent : undefined
}
/** 显式命令才读签发者；原 receipt、owner 与完整 run 快照一起复核，迟到读不能覆盖后继。 */
async function recoverAttempt(context: CoreContext, contextId: ExecutionContextId, attempt: MutationAttemptRecord): Promise<StartWorkResult> {
  const intent = executionIntent(attempt), record = await context.storage.getExecutionContext(contextId)
  const run = await context.storage.getExecutionRun(runIdFor(contextId))
  const original = await createWriteLedger(context.storage).replay(context.workspaceId, attempt.idempotencyKey)
  if (intent === undefined || activeOwners.get(context)?.has(contextId)) return existingResult(context, contextId, original)
  const error = projectError(ProjectErrorCode.ResultUnknown, '执行回执暂时无法核对；保留原目标与句柄，不再次启动运行')
  const uncertain = () => existingResult(context, contextId, reportFor(WritePhase.Unknown, original?.values ?? beginWrite(undefined).values, error), false)
  if (attempt.workspaceId !== context.workspaceId || intent.contextId !== contextId || record?.workspaceId !== context.workspaceId
    || contextIdFor(record.workspaceId, record.workItemId, record.repositoryId) !== contextId || record.provisioningGeneration !== intent.ownerGeneration || run?.workspaceId !== context.workspaceId || run.contextId !== contextId
    || !validRunRef(run.providerRef) || run.providerRef.bindingId !== intent.bindingId || (run.fallback === true) !== (intent.operation === 'startFallbackRun')) return uncertain()
  const gate = runReadGate(context, run)
  if (!gate?.allowed || gate.binding?.execution === undefined) return uncertain()
  let status: ExecutionRunStatus
  try {
    const read = await gate.binding.execution.getRun(run.providerRef)
    if (!read.ok || !validRunRef(read.value?.ref) || read.value.ref.bindingId !== run.providerRef.bindingId
      || read.value.ref.objectKind !== run.providerRef.objectKind || read.value.ref.externalId !== run.providerRef.externalId
      || (status = runStatusFor(read.value.status)) === ExecutionRunStatus.Unknown) return uncertain()
  } catch { return uncertain() }
  try {
    const applied = await context.storage.transaction(async (tx) => {
      const current = await tx.findMutationAttempt(context.workspaceId, attempt.idempotencyKey)
      if (!isDeepStrictEqual(current, attempt) || !isDeepStrictEqual(await tx.getExecutionContext(contextId), record)
        || !isDeepStrictEqual(await tx.getExecutionRun(run.id), run)) return false
      await tx.putExecutionRun({ ...run, status, updatedAt: context.clock() })
      await tx.putMutationAttempt({ ...attempt, state: 'saved', errorCode: undefined, externalIntent: { ...intent, state: 'saved' } })
      return true
    })
    if (!applied) {
      const latest = await createWriteLedger(context.storage).replay(context.workspaceId, attempt.idempotencyKey)
      return latest?.saving ? uncertain() : await existingResult(context, contextId, latest)
    }
    return await existingResult(context, contextId, reportFor(WritePhase.Reconciled, original?.values ?? beginWrite(undefined).values, undefined))
  } catch { return uncertain() }
}

async function pendingClaim(context: CoreContext, storage: StorageTransaction, contextId: ExecutionContextId, request: StartWorkRequest, existing: ExecutionContextRecord | undefined, run: ExecutionRunRecord | undefined) {
  return (await storage.listMutationAttempts(context.workspaceId)).find(row => row.commandName === 'startWork'
      && (row.externalIntent?.contextId === contextId || requestScopeMatches(context.workspaceId, request, row))
      && (unresolved(row) || row.state === 'pending' || row.state === 'unknown')
      && (unresolved(row) || existing === undefined || (row.externalIntent === undefined ? run === undefined && existing.status !== ExecutionContextStatus.Ready : row.externalIntent.ownerGeneration === existing.provisioningGeneration)))
}
async function safeResume(context: CoreContext, contextId: ExecutionContextId, request: StartWorkRequest, attempt: MutationAttemptRecord, storage: StorageTransaction = context.storage): Promise<boolean> {
  if (attempt.state !== 'pending' || requestMismatch(context.workspaceId, request, attempt) || unresolved(attempt)) return false
  const route = await selectDevelopment({ ...context, storage }, request.repositoryId, START_WORK_ROUTE.anchor[0])
  if (!route.ok || route.binding.ref.bindingId !== attempt.bindingId) return false
  const record = await storage.getExecutionContext(contextId)
  return record?.status === ExecutionContextStatus.Provisioning && (attempt.externalIntent === undefined || attempt.externalIntent.ownerGeneration === record.provisioningGeneration) && needsSupply(record, context.clock()) && !await storage.getExecutionRun(runIdFor(contextId))
    && !(await storage.listMutationAttempts(context.workspaceId)).some(row => row.commandName === 'startWork' && (row.externalIntent?.contextId === contextId || requestScopeMatches(context.workspaceId, request, row)) && unresolved(row))
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
  readonly runExternalId: string | undefined; readonly fallback: boolean
  constructor(acked: GitOutcome, cause: unknown, runExternalId?: string, fallback = false) { super(cause instanceof Error ? cause.message : String(cause), { cause }); this.acked = acked; this.runExternalId = runExternalId; this.fallback = fallback }
}
async function localWrite<T>(acked: GitOutcome, write: () => Promise<T>, runExternalId?: string, fallback = false): Promise<T> {
  try { return await write() } catch (error) { if (error instanceof AdmissionInvalid) throw error; if (error instanceof OwnerLost) throw new OwnerLost(acked, runExternalId); throw new LocalWriteFailed(acked, error, runExternalId, fallback) }
}

/** 本地写失败的结果是 Unknown，不是 Failed 或 Saved：外部资源存在、不自动删除，句柄取最后已 ack 的，不起 run；`markUnknown` 对 Confirmed 原样返回，所以用 `reportFor` 建报告。 */
function unknownAfterAck({ acked, message, runExternalId, fallback }: LocalWriteFailed): StartWorkResult {
  // 文案按事实陈述：有分支句柄才说已 ack（工作树与 run 的 ack 都在分支之后）；失败结算时本次外部调用的原始失败一并带上，不被「本地结算失败」盖掉。
  const acks = acked.branchExternalId !== undefined
  const failure = acked.report.error === undefined ? '' : `；本次外部调用的失败：${acked.report.error.code}：${acked.report.error.message}`
  const error = projectError(ProjectErrorCode.ResultUnknown, `本地结算失败，${acks ? '已 ack 的外部资源保留、不自动删除，需先对账、不要盲目重试' : '本次没有外部写入被 ack'}：${message}${failure}`)
  return toResult(reportFor(WritePhase.Unknown, acked.report.values, error), outcomeOf(acked, fallback ? StartWorkFallback.Manual : undefined, runExternalId), error)
}
function unknownRun(git: GitOutcome, why: string, runExternalId: string | undefined, fallback?: StartWorkFallback): StartWorkResult {
  const error = projectError(ProjectErrorCode.ResultUnknown, `运行状态未知（${why}），已 ack 的外部资源保留、不自动删除，需先对账、不要盲目重试`)
  return toResult(reportFor(WritePhase.Unknown, git.report.values, error), outcomeOf(git, fallback, runExternalId), error)
}
/** 接管时已有的 run：不起第二个执行者，答案与重放、Query 同源——状态未知报 Unknown，其余如实带回降级标记与 run 句柄；主执行可用（`startExecution`）与不可用（`manualFallback`）两条分支共用。 */
function existingRun(git: GitOutcome, existing: ExecutionRunRecord): StartWorkResult {
  if (existing.status === ExecutionRunStatus.Unknown) return unknownRun(git, '已有的 run 记录是 unknown', existing.providerRef?.externalId, fallbackOf(existing))
  return toResult(git.report, outcomeOf(git, fallbackOf(existing), existing.providerRef?.externalId), undefined)
}

/** 当前可见性先于重放与路由；准入事务复用同一判定，不把早期读取当成登记许可。 */
type StartTargetContext = Pick<CoreContext, 'workspaceId' | 'runtimeAccess'> & { readonly storage: Pick<StorageTransaction, 'getPlanningProjection' | 'getSyncCursor' | 'getPlanningSyncRound'> }
export async function startTargetError(
  context: StartTargetContext, workItemId: string, admissionEpoch?: number,
): Promise<ProjectError | undefined> {
  if (typeof workItemId !== 'string' || workItemId.trim() === '') return invalid('workItemId 不能为空')
  const degenerate = namesProblem(workItemId)
  if (degenerate !== undefined) return invalid(degenerate)
  const epoch = context.runtimeAccess.epoch, fence = context.runtimeAccess.fence(context.storage)
  const projection = await context.storage.getPlanningProjection(context.workspaceId, asBrandedId<EntityId>(workItemId))
  const access = await context.runtimeAccess.planning(context.storage)
  if (fence !== context.runtimeAccess.fence(context.storage) || admissionEpoch === undefined && epoch !== context.runtimeAccess.epoch) return startTargetError(context, workItemId, admissionEpoch)
  if (access.error) return access.error
  const gate = gateCommand(context.runtimeAccess.registry, CapabilityKey.PlanningItemRead, 'read')
  if (access.binding && !gate.allowed) return gate.error
  if (projection === undefined || projection.content.contentKind === ContentKind.Redacted) {
    return projectError(ProjectErrorCode.NotFound, '规划条目不存在或对当前凭据不可见，无法开始工作')
  }
  if (projection.content.contentKind === ContentKind.ChangeRequest) return projectError(ProjectErrorCode.InvalidInput, '变更请求不是可开始工作的工作项')
  return admissionEpoch === undefined ? undefined : runtimeAdmissionError(context, admissionEpoch)
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
  const { repository } = route, provider = guardedDevelopmentReads(context, route)
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
  | { readonly kind: 'observe'; readonly attempt: MutationAttemptRecord }
  | { readonly kind: 'rejected'; readonly result: StartWorkResult }
  | { readonly kind: 'new' | 'resume'; readonly route: Extract<DevelopmentRoute, { ok: true }>; readonly generation: number }
  | { readonly kind: 'in-flight' | 'existing'; readonly route: DevelopmentRoute }
async function claimContext(
  context: CoreContext, contextId: ExecutionContextId, request: StartWorkRequest, selected: Extract<DevelopmentRoute, { ok: true }>, register: Registration | undefined, admissionEpoch: number,
): Promise<Claim> {
  const now = context.clock()
  const claim = async (tx: StorageTransaction): Promise<Claim> => {
    const targetError = await startTargetError({ ...context, storage: tx }, request.workItemId)
    if (targetError !== undefined) return { kind: 'rejected', result: startWorkUnavailable(targetError) }
    const attempt = await tx.findMutationAttempt(context.workspaceId, request.idempotencyKey)
    if (attempt !== undefined && !await safeResume(context, contextId, request, attempt, tx)) return { kind: 'replay', attempt }
    const source = { ...context, storage: tx }
    const current = await selectDevelopment(source, request.repositoryId, START_WORK_ROUTE.anchor[0])
    if (!current.ok || current.binding.ref.bindingId !== selected.binding.ref.bindingId) return { kind: 'conflict', error: bindingConflict('idempotency_target_changed') }
    const existing = await tx.getExecutionContext(contextId)
    const run = existing === undefined ? undefined : await tx.getExecutionRun(runIdFor(contextId))
    const pending = await pendingClaim(context, tx, contextId, request, existing, run)
    if (pending !== undefined) {
      if (requestMismatch(context.workspaceId, request, pending)) return { kind: 'conflict', error: bindingConflict('idempotency_request_mismatch') }
      if (unresolved(pending) || existing === undefined || !needsSupply(existing, now) || run !== undefined) return { kind: 'observe', attempt: pending }
      // 已知没有未决外部步骤与 run 的过期 owner 可安全续跑；完整 fingerprint 仍锁住原任务。
    }
    if (existing !== undefined && (existing.status === ExecutionContextStatus.Ready || run !== undefined)) return { kind: 'conflict', error: projectError(ProjectErrorCode.Conflict, 'existing_execution_task_not_sent') }
    const supplying = existing === undefined || needsSupply(existing, now)
    const generation = supplying ? nextGeneration(existing) : existing?.provisioningGeneration
    const route = supplying ? await routeDevelopment(source, request.repositoryId, ...START_WORK_ROUTE.anchor) : current
    if (pending !== undefined && pending.idempotencyKey !== request.idempotencyKey && supplying) await tx.putMutationAttempt({ ...pending, state: 'failed', errorCode: ProjectErrorCode.Conflict })
    if (!route.ok) {
      if (existing === undefined) return { kind: 'rejected', result: startWorkUnavailable(route.error) }
      // 原有续跑拒绝仍结算为 Failed 并清除失效工作树；先复核 key，未获准的请求不占键。
      const names = namesFor(request); const report = markFailed(beginWrite(names.path ?? names.worktreeKey), route.error)
      const saved = await saveContext(context, contextId, request, ExecutionContextStatus.Failed, undefined, undefined, tx, generation)
      const git: GitOutcome = { contextId, report, ok: false, bindingId: undefined, status: saved.status, branchExternalId: saved.branchExternalId,
        worktreeExternalId: undefined, branchHeadCommit: undefined }
      await recordStartFacts({ workspaceId: context.workspaceId, storage: tx }, request, contextId, git)
      if (attempt !== undefined) await writeReceipt(tx, context, request, 'failed', undefined, route.error.code)
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
  }
  return context.storage.transaction(async (tx) => {
    const result = await claim(tx)
    await assertAdmission({ ...context, storage: tx }, admissionEpoch, request.workItemId)
    return result
  })
}

async function provision(context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, route: Extract<DevelopmentRoute, { ok: true }>, generation: number, admissionEpoch: number, resuming: boolean): Promise<StartWorkResult> {
  await checkOwner(context, contextId, generation)
  await assertAdmission(context, admissionEpoch, request.workItemId)
  const names = namesFor(request), accessEpoch = context.runtimeAccess.epoch
  let firstWrite = true
  let observed: GitOutcome = { contextId, report: beginWrite(undefined), ok: false, bindingId: undefined, status: ExecutionContextStatus.Provisioning, branchExternalId: undefined, worktreeExternalId: undefined, branchHeadCommit: undefined }
  let priorRun: ExecutionRunRecord | undefined
  // 只在 owner 校验后的短事务内采样；事务失败仍可保留本次有权读到的原运行，不读后继。
  const observeRun = async (tx: StorageTransaction) => { if (resuming) priorRun = await tx.getExecutionRun(runIdFor(contextId)) }
  // 每一步成功后立刻回填：中断在两步之间时，重放跳过已完成的那一步（批次计划 D2）。两步写的都是 Provisioning，Ready 要等 `settle`。
  let git: GitOutcome
  try {
    git = await provisionGit(context, request, names, contextId, async (outcome) => {
      observed = outcome
      await localWrite(outcome, () => owned(context, contextId, generation, async (tx) => {
        await observeRun(tx)
        await saveContext(context, contextId, request, outcome.status, outcome.branchExternalId, outcome.worktreeExternalId, tx)
        await writeReceipt(tx, context, request, 'pending', 'saved')
      }))
    }, route, async (operation) => {
      const key = operation.operation === 'createBranch' ? CapabilityKey.DevelopmentBranchCreate : CapabilityKey.DevelopmentWorktreeCreate
      const version = context.runtimeAccess.operationVersion(route.binding.ref.bindingId, key, request.repositoryId)
      const error = await context.runtimeAccess.operation(route.binding, key, request.repositoryId, context.policy, 'write', version)
      if (error) throw new AdmissionInvalid(error)
      const validate = (storage: StartTargetContext['storage'] = context.storage) => assertAdmission({ ...context, storage }, firstWrite ? admissionEpoch : accessEpoch, firstWrite ? request.workItemId : undefined)
      await validate()
      await localWrite(observed, () => beforeExternal(context, request, contextId, generation, operation, route.binding.ref.bindingId, validate, observeRun))
      const changed = await context.runtimeAccess.operation(route.binding, key, request.repositoryId, context.policy, 'write', version)
      if (changed) throw new AdmissionInvalid(changed)
      await validate()
      firstWrite = false
    })
    if (git.report.error?.code === ProjectErrorCode.PermissionDenied && !git.report.error.message.startsWith('permission 层拒绝 ')) {
      const error = projectError(ProjectErrorCode.PermissionDenied, operationDeniedReason(git.branchExternalId ? CapabilityKey.DevelopmentWorktreeCreate : CapabilityKey.DevelopmentBranchCreate))
      git = { ...git, report: reportFor(git.report.phase, git.report.values, error) }
    }
    const saved = await localWrite({ ...git, status: ExecutionContextStatus.Provisioning }, () => settle(context, request, contextId, git, generation, observeRun)) // 结算失败时记录仍停在 Provisioning
    // 失败路径的结果面取自**写入后的记录**，不取本次尝试的中间结果：能力不可用时 `git.branchExternalId` 是
    // `undefined`（本次没走到分支步），而记录里保留着此前已决定的分支；调用返回一个答案、记录与 `existingResult`
    // 返回另一个，就是 Host 权威状态分叉。`recordStartFacts` 仍吃 `git`（本次观测到的事实），所以不补写关系。
    if (!git.ok) return admittedRunResult(context, admissionEpoch, request.workItemId,
      toResult(git.report, outcomeOf({ ...git, branchExternalId: saved.branchExternalId }, fallbackOf(priorRun), priorRun?.providerRef?.externalId), git.report.error))
  } catch (error) {
    if (error instanceof LocalWriteFailed && priorRun !== undefined) throw new LocalWriteFailed(error.acked, error.cause, priorRun.providerRef?.externalId, priorRun.fallback === true)
    throw error
  }
  return startExecution(context, request, contextId, git, generation, accessEpoch)
}

/** 最终事务：context 记录（成功 Ready、失败 Failed）、tracks / has_worktree 与该次 Git 的 mutation_attempt 同生共死；只用 tx，不调根 Storage、Provider，不嵌套事务。 */
function settle(context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, git: GitOutcome, generation: number, observeRun: (tx: StorageTransaction) => Promise<void>): Promise<ExecutionContextRecord> {
  return owned(context, contextId, generation, async (tx) => {
    await observeRun(tx)
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
function beforeExternal(context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, generation: number, operation: StartWorkExternalOperation, bindingId: ProviderBindingId, validate?: (tx: StorageTransaction) => Promise<void>, observeRun?: (tx: StorageTransaction) => Promise<void>): Promise<void> {
  return owned(context, contextId, generation, async (tx) => {
    await observeRun?.(tx)
    const attempt = await tx.findMutationAttempt(context.workspaceId, request.idempotencyKey)
    if (attempt === undefined || requestMismatch(context.workspaceId, request, attempt) || unresolved(attempt)) throw new Error('Start Work intent cannot advance')
    await tx.putMutationAttempt({ ...attempt, state: 'pending', externalIntent: externalIntentSnapshot({ ...operation, contextId, ownerGeneration: generation, bindingId, state: 'pending' }) })
    await validate?.(tx)
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
  context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, git: GitOutcome, generation: number, accessEpoch: number,
): Promise<StartWorkResult> {
  let checkpoint: RunSettlementSnapshot | undefined
  const finish = (result: StartWorkResult, status?: ExecutionRunStatus, ref?: ExternalObjectRef, fallback = false) =>
    localWrite(git, () => recordRun(context, request, contextId, generation, result, status, ref, fallback, checkpoint), ref?.externalId, fallback)
  if (git.worktreeExternalId === undefined) return finish(unknownRun(git, '缺少 Git ack 的工作目录，不能启动执行', undefined))
  const target = resolveWriteTarget(context.registry, CapabilityKey.ExecutionRunStart)
  const provider = target.binding?.execution
  if (provider === undefined || target.binding === undefined) return manualFallback(context, request, contextId, git, generation, accessEpoch, target.error ?? unsupportedCapability(CapabilityKey.ExecutionRunStart))
  const existing = await localWrite(git, () => owned(context, contextId, generation, (tx) => tx.getExecutionRun(runIdFor(contextId))))
  if (existing !== undefined) return finish(existingRun(git, existing), undefined, existing.providerRef, existing.fallback === true)
  const { result: run, retainedRef, settlement } = await startExternalRun(context, request, contextId, git, generation, provider, target.binding.ref.bindingId, {
    workingDirectory: git.worktreeExternalId,
    context: { bindingId: target.binding.ref.bindingId, objectKind: 'execution_context', externalId: contextId, url: undefined },
    command: request.task, environment: {},
  }, false, accessEpoch)
  checkpoint = settlement.snapshot
  if (!run.ok) {
    const retained = await localWrite(git, () => owned(context, contextId, generation, tx => tx.getExecutionRun(runIdFor(contextId))))
    const error = toProjectError(run.error)
    if (retained?.providerRef && retainedRef === undefined) return finish(existingRun(git, retained), undefined, retained.providerRef, retained.fallback === true)
    if (retainedRef && !isDeepStrictEqual(retained?.providerRef, retainedRef)) throw new OwnerLost(git, retainedRef.externalId)
    if (retained?.providerRef) return finish(run.error.code === ProviderErrorCode.AmbiguousResult
      ? unknownRun(git, error.message, retained.providerRef.externalId)
      : toResult(markFailed(git.report, error), outcomeOf(git, undefined, retained.providerRef.externalId), error),
      run.error.code === ProviderErrorCode.AmbiguousResult ? ExecutionRunStatus.Unknown : ExecutionRunStatus.Failed, retained.providerRef)
    if (run.error.code === ProviderErrorCode.AmbiguousResult) return finish(unknownRun(git, error.message, undefined), ExecutionRunStatus.Unknown)
    await localWrite(git, () => owned(context, contextId, generation, (tx) => writeReceipt(tx, context, request, 'pending', 'failed', error.code)))
    return manualFallback(context, request, contextId, git, generation, accessEpoch, error)
  }
  if (!validRunRef(run.value.ref) || run.value.ref.bindingId !== target.binding.ref.bindingId) return finish(unknownRun(git, 'ack 的运行引用不属于原执行连接', undefined), ExecutionRunStatus.Unknown)
  const status = runStatusFor(run.value.status)
  return finish(status === ExecutionRunStatus.Unknown ? unknownRun(git, `ack 的状态 ${run.value.status} 不是已知取值`, run.value.ref.externalId)
    : toResult(git.report, outcomeOf(git, undefined, run.value.ref.externalId), undefined), status, run.value.ref)
}

/** 写前只提交当前运行的真实连接与输入；仅围住 Provider I/O，把丢响应保留为未知。 */
async function startExternalRun(context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, git: GitOutcome, generation: number,
  provider: ExecutionProvider, bindingId: ProviderBindingId, input: ProviderStartRunInput, fallback: boolean, accessEpoch: number) {
  const key = fallback ? CapabilityKey.ExecutionRunFallback : CapabilityKey.ExecutionRunStart
  const binding = context.registry.bindings.find(entry => entry.ref.bindingId === bindingId && entry.execution === provider)!
  const version = context.runtimeAccess.operationVersion(bindingId, key, request.repositoryId)
  const error = await context.runtimeAccess.operation(binding, key, request.repositoryId, context.policy, 'write', version)
  if (error) throw new AdmissionInvalid(error)
  const validate = (storage: StartTargetContext['storage'] = context.storage) => assertAdmission({ ...context, storage }, accessEpoch)
  await localWrite(git, () => beforeExternal(context, request, contextId, generation, { operation: fallback ? 'startFallbackRun' : 'startRun', input }, bindingId, validate))
  const changed = await context.runtimeAccess.operation(binding, key, request.repositoryId, context.policy, 'write', version)
  if (changed) throw new AdmissionInvalid(changed)
  await validate()
  let open = true, retainedRef: ExternalObjectRef | undefined, admissionFailure: ProjectError | undefined
  const settlement: { snapshot?: RunSettlementSnapshot } = {}
  const intent = externalIntentSnapshot({ operation: fallback ? 'startFallbackRun' : 'startRun', input, contextId, ownerGeneration: generation, bindingId, state: 'pending' })
  const retainRunIdentity = async (ref: ExternalObjectRef): Promise<void> => {
    if (!open || !validRunRef(ref) || ref.bindingId !== bindingId) throw new Error('Invalid run checkpoint')
    const safeRef = { bindingId: ref.bindingId, objectKind: ref.objectKind, externalId: ref.externalId, url: ref.url }
    const allowed = async () => {
      const error = await context.runtimeAccess.operation(binding, key, request.repositoryId, context.policy, 'write', version)
      if (error) { admissionFailure = error; throw new AdmissionInvalid(error) }
      try { await validate() } catch (error) { if (error instanceof AdmissionInvalid) admissionFailure = error.failure; throw error }
    }
    await allowed()
    await owned(context, contextId, generation, async tx => {
      const attempt = await tx.findMutationAttempt(context.workspaceId, request.idempotencyKey)
      const record = await tx.getExecutionContext(contextId), prior = await tx.getExecutionRun(runIdFor(contextId))
      await validate(tx)
      if (!open || record?.workspaceId !== context.workspaceId || attempt?.state !== 'pending' || requestMismatch(context.workspaceId, request, attempt)
        || !isDeepStrictEqual(attempt.externalIntent, intent) || (prior !== undefined && (prior.workspaceId !== context.workspaceId || prior.contextId !== contextId
          || !isDeepStrictEqual(prior.providerRef, safeRef) || (prior.fallback === true) !== fallback))) throw new Error('Run checkpoint ownership changed')
      const run = prior ?? { id: runIdFor(contextId), workspaceId: context.workspaceId, contextId,
        status: ExecutionRunStatus.Unknown, updatedAt: context.clock(), providerRef: safeRef, ...(fallback ? { fallback: true } : {}) }
      if (prior === undefined) await tx.putExecutionRun(run)
      settlement.snapshot ??= { run, attempt }
    })
    retainedRef = safeRef
    await allowed()
    await checkOwner(context, contextId, generation)
    if (!open) throw new Error('Run checkpoint expired')
  }
  try {
    const result = await provider.startRun(structuredClone(input), { retainRunIdentity })
    if (admissionFailure) throw new AdmissionInvalid(admissionFailure)
    if (result.ok && retainedRef && (!validRunRef(result.value.ref) || result.value.ref.bindingId !== retainedRef.bindingId
      || result.value.ref.externalId !== retainedRef.externalId || result.value.ref.url !== retainedRef.url)) return { result: providerErr(providerError(ProviderErrorCode.AmbiguousResult, '运行身份与 checkpoint 不符')), retainedRef, settlement }
    if (result.ok || result.error.code === ProviderErrorCode.PermissionDenied) context.runtimeAccess.observeOperation(bindingId, key, request.repositoryId, !result.ok, version)
    if (!result.ok && result.error.code === ProviderErrorCode.PermissionDenied) throw new AdmissionInvalid(projectError(ProjectErrorCode.PermissionDenied, operationDeniedReason(key)))
    return { result, retainedRef, settlement }
  }
  catch (error) { if (error instanceof AdmissionInvalid) throw error; return { result: providerErr(providerError(ProviderErrorCode.AmbiguousResult, '执行启动未确认')), retainedRef, settlement } }
  finally { open = false }
}

async function manualFallback(
  context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, git: GitOutcome, generation: number, accessEpoch: number, error: ProjectError,
): Promise<StartWorkResult> {
  const finish = (result: StartWorkResult, status?: ExecutionRunStatus, ref?: ExternalObjectRef, fallback = true) =>
    localWrite(git, () => recordRun(context, request, contextId, generation, status === undefined ? result : { ...result, fallback: StartWorkFallback.Manual, degraded: true }, status, ref, fallback), ref?.externalId, fallback)
  const existing = await localWrite(git, () => owned(context, contextId, generation, (tx) => tx.getExecutionRun(runIdFor(contextId))))
  if (existing !== undefined) return finish(existingRun(git, existing), undefined, existing.providerRef, existing.fallback === true)
  if (git.worktreeExternalId === undefined) return finish(unknownRun(git, '缺少 Git ack 的工作目录，不能人工接管', undefined))
  const fallback = resolveWriteTarget(context.registry, CapabilityKey.ExecutionRunFallback).binding
  if (fallback?.execution !== undefined) {
    const { result: run } = await startExternalRun(context, request, contextId, git, generation, fallback.execution, fallback.ref.bindingId, {
      workingDirectory: git.worktreeExternalId,
      context: { bindingId: fallback.ref.bindingId, objectKind: 'execution_context', externalId: contextId, url: undefined },
      command: request.task, environment: {},
    }, true, accessEpoch)
    if (!run.ok && run.error.code === ProviderErrorCode.AmbiguousResult) return finish(unknownRun(git, run.error.message, undefined), ExecutionRunStatus.Unknown)
    if (run.ok) {
      if (!validRunRef(run.value.ref) || run.value.ref.bindingId !== fallback.ref.bindingId) return finish(unknownRun(git, 'ack 的运行引用不属于原执行连接', undefined), ExecutionRunStatus.Unknown)
      const status = runStatusFor(run.value.status)
      if (status === ExecutionRunStatus.Unknown) return finish(unknownRun(git, `ack 的状态 ${run.value.status} 不是已知取值`, run.value.ref.externalId), status, run.value.ref)
      if (status !== ExecutionRunStatus.Running) return localWrite(git, () => recordRun(context, request, contextId, generation,
        toResult(git.report, outcomeOf(git, StartWorkFallback.Manual, run.value.ref.externalId), error), ExecutionRunStatus.Failed, run.value.ref, true), run.value.ref.externalId, true)
      return finish(toResult(git.report, outcomeOf(git, StartWorkFallback.Manual, run.value.ref.externalId), undefined), status, run.value.ref)
    }
    await localWrite(git, () => owned(context, contextId, generation, (tx) => writeReceipt(tx, context, request, 'pending', 'failed', run.error.code as ProjectErrorCode)))
  }
  return finish(toResult(git.report, outcomeOf(git, StartWorkFallback.Manual), error), ExecutionRunStatus.Failed)
}

type RunSettlementSnapshot = { readonly run: ExecutionRunRecord | undefined; readonly attempt: MutationAttemptRecord | undefined }
async function recordRun(context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, generation: number, result: StartWorkResult,
  status?: ExecutionRunStatus, providerRef?: ExternalObjectRef, fallback = false, checkpoint?: RunSettlementSnapshot): Promise<StartWorkResult> {
  const pending = await owned(context, contextId, generation, async (tx) => {
    const prior = await tx.getExecutionRun(runIdFor(contextId))
    const attempt = await tx.findMutationAttempt(context.workspaceId, request.idempotencyKey)
    if (checkpoint && (!isDeepStrictEqual(prior, checkpoint.run) || !isDeepStrictEqual(attempt, checkpoint.attempt))) return undefined
    if (prior?.providerRef !== undefined && providerRef !== undefined && !isDeepStrictEqual(prior.providerRef, providerRef)) throw new Error('Run checkpoint identity changed')
    const ref = providerRef ?? prior?.providerRef
    const run = status === undefined ? prior : {
      id: runIdFor(contextId), workspaceId: context.workspaceId, contextId, status, updatedAt: context.clock(),
      ...(ref === undefined ? {} : { providerRef: { bindingId: ref.bindingId, objectKind: ref.objectKind, externalId: ref.externalId, url: ref.url } }), ...(fallback ? { fallback } : {}),
    }
    if (status !== undefined) await tx.putExecutionRun(run!)
    return { run, attempt }
  })
  const applied = pending !== undefined && await owned(context, contextId, generation, async (tx) => {
    if (!isDeepStrictEqual(await tx.findMutationAttempt(context.workspaceId, request.idempotencyKey), pending.attempt)
      || checkpoint !== undefined && !isDeepStrictEqual(await tx.getExecutionRun(runIdFor(contextId)), pending.run)) return false
    await writeReceipt(tx, context, request, result.writeState, result.writeState, result.error?.code)
    return true
  })
  return applied ? result : existingResult(context, contextId, await createWriteLedger(context.storage).replay(context.workspaceId, request.idempotencyKey))
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
        runExternalId: run?.providerRef?.externalId,
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
  const provider = guardedDevelopmentReads(context, route)
  if (provider.getWorktree === undefined) return { ok: false, definite: false, error: projectError(ProjectErrorCode.NotSupported, '当前 Development provider 没有工作树读能力，不能确认 Saved') }
  const ref = { bindingId: route.binding.ref.bindingId, objectKind: 'worktree', externalId: record.worktreeExternalId, url: undefined }
  const observed = await provider.getWorktree({ worktree: ref })
  if (!observed.ok) return { ok: false, definite: observed.error.code === ProviderErrorCode.NotFound, error: toProjectError(observed.error) }
  if (observed.value.branch !== record.branchExternalId) {
    return { ok: false, definite: true, error: projectError(ProjectErrorCode.Conflict, `已记录工作树检出的分支 ${observed.value.branch} 与 ${record.branchExternalId} 不一致`) }
  }
  return { ok: true }
}
