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
import type { CoreContext } from './context.ts'
import {
  StartWorkFallback, contextIdFor, contextRecord, reportForExisting, runIdFor, runStatusFor,
  startWorkUnavailable, toResult,
  type StartWorkRequest, type StartWorkResult,
} from './execution-context.ts'
import { namesFor, outcomeOf, provisionGit, type GitOutcome } from './git-provisioning.ts'
import { EdgeProvenance, asEntityId, chainEntityId, recordEdges, type DiscoveredEdge } from './relations.ts'
import { createWriteLedger, type WriteLedger, type WriteReport } from './write-machine.ts'

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
    if (existing.status !== ExecutionContextStatus.Provisioning) return 'existing'
    if (!leaseExpired(existing.provisioningStartedAt, now)) return 'in-flight'
    await tx.putExecutionContext({ ...existing, provisioningStartedAt: now })
    return 'resume'
  })
}

async function provision(
  context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, ledger: WriteLedger,
): Promise<StartWorkResult> {
  const git = await provisionGit(context, request, namesFor(request), contextId)
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
async function recordStartFacts(
  context: CoreContext, request: StartWorkRequest, contextId: ExecutionContextId, git: GitOutcome,
): Promise<void> {
  const workItemId = asBrandedId<EntityId>(request.workItemId)
  const contextEntityId = asEntityId(contextId)
  const edges: DiscoveredEdge[] = [{
    from: workItemId, to: contextEntityId, type: RelationType.Tracks, provenance: EdgeProvenance.Command,
    artifact: { id: contextEntityId, kind: EntityKind.ExecutionContext, externalId: contextId, label: undefined, observed: true, detail: undefined },
  }]
  const slot = git.worktreeExternalId ?? git.branchExternalId
  if (slot !== undefined) {
    const worktreeId = chainEntityId(context.workspaceId, EntityKind.Worktree, `${git.bindingId}|${slot}`)
    edges.push({
      from: contextEntityId, to: worktreeId, type: RelationType.HasWorktree, provenance: EdgeProvenance.Command,
      artifact: {
        id: worktreeId, kind: EntityKind.Worktree, externalId: slot,
        label: git.branchExternalId ?? slot, observed: true, detail: undefined,
      },
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
    command: `harness run ${namesFor(request).branch}`, environment: {},
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
  await context.storage.putExecutionContext(contextRecord(context, contextId, request, status, branchExternalId, worktreeExternalId, undefined))
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
    worktreeExternalId: record.worktreeExternalId, fallback, runExternalId: undefined,
  }, report.error)
}
