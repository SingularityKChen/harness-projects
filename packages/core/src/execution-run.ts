/**
 * 执行运行的生命周期命令：运行身份是 Storage 里的那条记录（`runIdFor(contextId)`），不是 provider 的某个引用。
 */
import { AccessLevel, CapabilityKey, ProjectErrorCode, bindingForRef, projectError, SyncState, projectCodeForProviderError, type ExternalObjectRef, type ExecutionRunRecord } from '@harness-projects/capabilities'
import { EntityKind, ExecutionRunStatus, type ProjectError } from '@harness-projects/domain'
import { gateBinding, toProjectError, unsupportedCapability } from './capabilities.ts'
import type { CoreContext } from './context.ts'
import { contextIdFor, runIdFor, runStatusFor, type ExecutionContextQuery } from './execution-context.ts'

export interface CancelExecutionRunResult {
  readonly status: ExecutionRunStatus | undefined
  readonly runExternalId: string | undefined
  readonly error: ProjectError | undefined
}

const settled = (run: ExecutionRunRecord | undefined, error?: ProjectError): CancelExecutionRunResult =>
  ({ status: run?.status, runExternalId: run?.providerRef?.externalId, error })

/** 已结束、不可再取消的状态；`canceled` 单独处理（原样返回），其余（含 `queued` / `starting` / `unknown`）都去问签发者。 */
const ENDED: readonly ExecutionRunStatus[] = [ExecutionRunStatus.Succeeded, ExecutionRunStatus.Failed, ExecutionRunStatus.TimedOut]

/**
 * 按运行身份取消（ADR-0008）：已取消原样返回、不调 provider；否则把落库的 `providerRef` 路由回签发者（路由不到就
 * fail closed），ack 后事务内复核再原子替换状态与引用；并发的另一个取消先落库时返回已落库的那一个事实。
 */
export async function cancelExecutionRun(context: CoreContext, query: ExecutionContextQuery): Promise<CancelExecutionRunResult> {
  const runId = runIdFor(contextIdFor(context.workspaceId, query.workItemId, query.repositoryId))
  const found = await context.storage.getExecutionRun(runId)
  const run = found?.workspaceId === context.workspaceId ? found : undefined
  if (run?.providerRef === undefined) return settled(run, projectError(ProjectErrorCode.NotFound, '没有可取消的运行：运行不存在、不属于当前工作区，或没有 provider 签发的引用'))
  const ref = run.providerRef
  if (run.status === ExecutionRunStatus.Canceled) return settled(run)
  if (ENDED.includes(run.status)) return settled(run, projectError(ProjectErrorCode.Conflict, `运行已结束：${run.status}`))
  const binding = bindingForRef(context.registry, { workspaceId: context.workspaceId, bindingId: ref.bindingId, domain: 'execution' })
  if (binding?.execution === undefined) {
    return settled(run, projectError(ProjectErrorCode.NotFound, `签发该运行的执行 binding ${ref.bindingId} 未注册：宿主必须注入重启前的同一 binding id`))
  }
  const access = binding.capabilities.find((item) => item.key === CapabilityKey.ExecutionRunCancel)?.access ?? AccessLevel.Unavailable
  if (access === AccessLevel.ReadOnly) return settled(run, projectError(ProjectErrorCode.PermissionDenied, `能力 ${CapabilityKey.ExecutionRunCancel} 当前只读，写命令被拒绝`))
  if (access === AccessLevel.Unavailable || binding.execution.cancelRun === undefined) return settled(run, unsupportedCapability(CapabilityKey.ExecutionRunCancel))
  const canceled = await binding.execution.cancelRun(ref)
  const stored = await context.storage.transaction(async (tx) => {
    const current = await tx.getExecutionRun(runId)
    if (!canceled.ok || !sameRun(current, run) || canceled.value.ref.bindingId !== ref.bindingId || canceled.value.ref.objectKind !== ref.objectKind) return current
    const cursor = await tx.getSyncCursor(context.workspaceId, ref.bindingId, runHealthScope(run))
    if (cursor?.state === SyncState.Degraded) await tx.putSyncCursor({ ...cursor, state: SyncState.Healthy, lastErrorCode: undefined })
    const next = { ...run, status: runStatusFor(canceled.value.status), updatedAt: context.clock(), providerRef: canceled.value.ref }
    await tx.putExecutionRun(next)
    return next
  })
  if (canceled.ok || stored?.status === ExecutionRunStatus.Canceled) return settled(stored)
  return settled(run, toProjectError(canceled.error))
}

export interface RefreshExecutionRunResult { readonly ok: boolean; readonly applied: boolean; readonly error: ProjectError | undefined }
const refreshes = new WeakMap<CoreContext, Map<string, Promise<RefreshExecutionRunResult>>>()
export const runHealthScope = (run: ExecutionRunRecord) => `execution-run:${run.id}`
const failure = (code: ProjectError['code']) => projectError(code, '暂时无法核对执行运行')
const sameRef = (a: ExternalObjectRef | undefined, b: ExternalObjectRef | undefined) => a !== undefined && b !== undefined
  && a.bindingId === b.bindingId && a.objectKind === b.objectKind && a.externalId === b.externalId
const sameRun = (a: ExecutionRunRecord | undefined, b: ExecutionRunRecord) => a?.id === b.id && a.workspaceId === b.workspaceId
  && a.contextId === b.contextId && a.status === b.status && a.updatedAt === b.updatedAt && sameRef(a.providerRef, b.providerRef)
export const validRunRef = (ref: ExternalObjectRef | undefined): ref is ExternalObjectRef => ref !== undefined
  && typeof ref.bindingId === 'string' && ref.bindingId !== '' && ref.objectKind === EntityKind.ExecutionRun && typeof ref.externalId === 'string' && ref.externalId !== ''
export function runReadGate(context: CoreContext, run: ExecutionRunRecord) {
  const ref = run.providerRef
  const binding = validRunRef(ref) ? bindingForRef(context.registry, { workspaceId: context.workspaceId, bindingId: ref.bindingId, domain: 'execution' }) : undefined
  return binding?.execution === undefined ? undefined : gateBinding(binding, CapabilityKey.ExecutionRunRead, 'read')
}
async function ownsRun(context: CoreContext, query: ExecutionContextQuery, run: ExecutionRunRecord | undefined) {
  const id = contextIdFor(context.workspaceId, query.workItemId, query.repositoryId), record = await context.storage.getExecutionContext(id)
  return run?.workspaceId === context.workspaceId && run.contextId === id && record?.workspaceId === context.workspaceId
    && record.workItemId === query.workItemId && record.repositoryId === query.repositoryId
}
/** I/O 在事务外；迟到结果只可提交到完整相同的本地快照，健康度与状态一起原子提交。 */
async function refreshRun(context: CoreContext, query: ExecutionContextQuery, runId: ExecutionRunRecord['id']): Promise<RefreshExecutionRunResult> {
  try {
    const run = await context.storage.getExecutionRun(runId)
    if (!await ownsRun(context, query, run) || run === undefined || !validRunRef(run.providerRef)) return { ok: false, applied: false, error: failure(ProjectErrorCode.NotFound) }
    const ref = run.providerRef, gate = runReadGate(context, run)
    let status: ExecutionRunStatus | undefined, error = gate?.allowed ? undefined : failure(ProjectErrorCode.NotSupported)
    if (gate?.allowed && gate.binding?.execution !== undefined) {
      try {
        const result = await gate.binding.execution.getRun(ref)
        if (!result.ok) error = failure(projectCodeForProviderError(result.error.code))
        else if (result.value !== null && typeof result.value === 'object' && sameRef(ref, result.value.ref)
          && typeof result.value.status === 'string' && runStatusFor(result.value.status) !== ExecutionRunStatus.Unknown) status = runStatusFor(result.value.status)
        else error = failure(ProjectErrorCode.ResultUnknown)
      } catch { error = failure(ProjectErrorCode.Unavailable) }
    }
    const applied = await context.storage.transaction(async (tx) => {
      const current = await tx.getExecutionRun(runId), record = await tx.getExecutionContext(run.contextId)
      if (!sameRun(current, run) || record?.workspaceId !== context.workspaceId || record.workItemId !== query.workItemId || record.repositoryId !== query.repositoryId) return false
      const cursor = await tx.getSyncCursor(context.workspaceId, ref.bindingId, runHealthScope(run))
      const state = error === undefined ? SyncState.Healthy : SyncState.Degraded, lastErrorCode = error?.code
      const changed = status !== undefined && status !== run.status
      if (status !== undefined && changed) await tx.putExecutionRun({ ...run, status, updatedAt: context.clock() })
      const healthChanged = cursor === undefined ? error !== undefined : cursor.state !== state || cursor.lastErrorCode !== lastErrorCode
      if (healthChanged) await tx.putSyncCursor({ workspaceId: context.workspaceId, bindingId: ref.bindingId, scopeKey: runHealthScope(run), cursorValue: undefined, state, lastErrorCode })
      return changed || healthChanged
    })
    return { ok: error === undefined, applied, error }
  } catch { return { ok: false, applied: false, error: failure(ProjectErrorCode.Unavailable) } }
}
/** 同一个 Core owner/run 共享尚未完成的读取；不持久写开始轮次，不承诺跨进程开始顺序。 */
export function refreshExecutionRun(context: CoreContext, query: ExecutionContextQuery): Promise<RefreshExecutionRunResult> {
  const id = runIdFor(contextIdFor(context.workspaceId, query.workItemId, query.repositoryId))
  let pending = refreshes.get(context); if (pending === undefined) { pending = new Map(); refreshes.set(context, pending) }
  const existing = pending.get(id); if (existing !== undefined) return existing
  const task = refreshRun(context, query, id).finally(() => pending.delete(id)); pending.set(id, task); return task
}
