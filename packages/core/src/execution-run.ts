/**
 * 执行运行的生命周期命令：运行身份是 Storage 里的那条记录（`runIdFor(contextId)`），不是 provider 的某个引用。
 */
import { AccessLevel, CapabilityKey, ProjectErrorCode, bindingForRef, projectError, type ExecutionRunRecord } from '@harness-projects/capabilities'
import { ExecutionRunStatus, type ProjectError } from '@harness-projects/domain'
import { toProjectError, unsupportedCapability } from './capabilities.ts'
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
    if (!canceled.ok || current?.status !== run.status || current.providerRef?.externalId !== ref.externalId) return current
    const next = { ...current, status: runStatusFor(canceled.value.status), updatedAt: context.clock(), providerRef: canceled.value.ref }
    await tx.putExecutionRun(next)
    return next
  })
  if (canceled.ok || stored?.status === ExecutionRunStatus.Canceled) return settled(stored)
  return settled(run, toProjectError(canceled.error))
}
