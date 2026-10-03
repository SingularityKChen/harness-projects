/**
 *
 */
import { createHash } from 'node:crypto'
import { ProjectErrorCode, projectError, type ExecutionContextRecord, type ExecutionRunRecord, type ProjectError } from '@harness-projects/capabilities'
import {
  ExecutionContextStatus, ExecutionRunStatus, RelationState, RelationType, WriteState, asBrandedId,
  type EntityId, type ExecutionContextId, type ExecutionRunId, type WorkspaceId,
} from '@harness-projects/domain'
import { worktreeEntityId } from './chain-facts.ts' // 与 chain-facts 互相引用（TD-005）：只在函数体里调用，不在模块求值时使用
import type { CoreContext } from './context.ts'
import { asEntityId, findRelation } from './relations.ts'
import { emptyValues, reportFor, WritePhase, type WriteReport } from './write-machine.ts'

export interface StartWorkActor { readonly kind: string }

export const StartWorkFallback = { Manual: 'manual_fallback' } as const
export type StartWorkFallback = (typeof StartWorkFallback)[keyof typeof StartWorkFallback]

export interface StartWorkRequest {
  readonly workItemId: string
  readonly repositoryId: string
  readonly actor: StartWorkActor
  readonly idempotencyKey: string
  readonly branchName?: string
  readonly worktreePath?: string
}

export interface StartWorkResult {
  readonly phase: WritePhase
  readonly writeState: WriteState
  readonly saving: boolean
  readonly confirmed: boolean
  readonly executionContextId: ExecutionContextId | undefined
  readonly status: ExecutionContextStatus | undefined
  readonly branchExternalId: string | undefined
  readonly worktreeExternalId: string | undefined
  /** 实际落地的分支头提交；接管一个既有分支时它是事实，不是可推导的值。 */
  readonly branchHeadCommit: string | undefined
  readonly runExternalId: string | undefined
  readonly fallback: StartWorkFallback | undefined
  readonly degraded: boolean
  readonly error: ProjectError | undefined
}

export interface ExecutionContextQuery {
  readonly workItemId: string
  readonly repositoryId: string
}

export interface ExecutionContextView {
  readonly id: ExecutionContextId
  readonly workspaceId: WorkspaceId
  readonly workItemId: EntityId
  readonly repositoryId: EntityId
  readonly status: ExecutionContextStatus
  readonly branchExternalId: string | undefined
  readonly worktreeExternalId: string | undefined
  readonly runExternalId: string | undefined
  readonly runId: ExecutionRunId | undefined
  readonly fallback: StartWorkFallback | undefined
  readonly degraded: boolean
}

/** 补偿序列每一步提交后回填的结果面；undefined 表示这一步没有走到。 */
export interface StartOutcome {
  readonly contextId: ExecutionContextId
  readonly status: ExecutionContextStatus
  readonly branchExternalId: string | undefined
  readonly worktreeExternalId: string | undefined
  readonly branchHeadCommit: string | undefined
  readonly fallback: StartWorkFallback | undefined
  readonly runExternalId: string | undefined
}

function digest(material: string): string {
  return createHash('sha256').update(material).digest('hex').slice(0, 32)
}

export function contextIdFor(workspaceId: WorkspaceId, workItemId: string, repositoryId: string): ExecutionContextId {
  return asBrandedId<ExecutionContextId>(`ctx-${digest([workspaceId, workItemId, repositoryId].join('|'))}`)
}

export function runIdFor(contextId: ExecutionContextId): ExecutionRunId {
  return asBrandedId<ExecutionRunId>(`run-${digest(`${contextId}|run`)}`)
}

/** 组合根不可用时也必须给出结构化结果，而不是抛错。 */
export function startWorkUnavailable(error: ProjectError): StartWorkResult {
  return {
    phase: WritePhase.Failed, writeState: WriteState.Failed, saving: false, confirmed: false,
    executionContextId: undefined, status: undefined, branchExternalId: undefined,
    worktreeExternalId: undefined, branchHeadCommit: undefined, runExternalId: undefined, fallback: undefined,
    degraded: true, error,
  }
}

export function toResult(report: WriteReport, outcome: StartOutcome | undefined, error: ProjectError | undefined): StartWorkResult {
  return {
    phase: report.phase, writeState: report.writeState, saving: report.saving, confirmed: report.confirmed,
    executionContextId: outcome?.contextId, status: outcome?.status,
    branchExternalId: outcome?.branchExternalId, worktreeExternalId: outcome?.worktreeExternalId,
    branchHeadCommit: outcome?.branchHeadCommit,
    runExternalId: outcome?.runExternalId, fallback: outcome?.fallback,
    degraded: error !== undefined || outcome?.fallback !== undefined,
    error: error ?? report.error,
  }
}

/** 既有上下文（含 failed）不重复 provision：这是"不产生第二份工作树/分支"在查询路径上的落点。 */
export function reportForExisting(status: ExecutionContextStatus): WriteReport {
  if (status === ExecutionContextStatus.Failed) {
    return reportFor(WritePhase.Failed, emptyValues(), projectError(ProjectErrorCode.Unavailable, '该工作项与仓库已有失败的执行上下文，需显式重试或关闭'))
  }
  if (status === ExecutionContextStatus.Planned || status === ExecutionContextStatus.Provisioning) {
    return reportFor(WritePhase.Writing, emptyValues(), undefined)
  }
  return reportFor(WritePhase.Confirmed, emptyValues(), undefined)
}

/** 降级结论只从运行记录的 `fallback` 读（ADR-0008），不从 `failed` 反推：主执行 ack 的 failed 不是降级。 */
export function fallbackOf(run: ExecutionRunRecord | undefined): StartWorkFallback | undefined {
  return run?.fallback === true ? StartWorkFallback.Manual : undefined
}

export function runStatusFor(raw: string): ExecutionRunStatus {
  const known: readonly string[] = Object.values(ExecutionRunStatus)
  return known.includes(raw) ? (raw as ExecutionRunStatus) : ExecutionRunStatus.Unknown
}

/** Ready 的上下文必须同时有已知状态的 run 记录与 confirmed 的 tracks（工作项 → context）、has_worktree（context → 工作树实体）；返回缺口的描述，完整返回 undefined。只读本地、不问 Provider：命令的重放与 Query 共用这一处。 */
export async function readyGap(context: CoreContext, record: ExecutionContextRecord, run: ExecutionRunRecord | undefined): Promise<string | undefined> {
  if (run === undefined) return '没有 run 记录'
  if (run.status === ExecutionRunStatus.Unknown) return 'run 状态未知'
  const relations = await context.storage.listRelations(record.workspaceId)
  const entity = asEntityId(record.id)
  const missing = [
    { from: record.workItemId, to: entity, type: RelationType.Tracks },
    { from: entity, to: worktreeEntityId(record.workspaceId, record.repositoryId, record.workItemId), type: RelationType.HasWorktree },
  ].find((edge) => findRelation(relations, edge)?.state !== RelationState.Confirmed)
  return missing === undefined ? undefined : `缺少 confirmed 的 ${missing.type} 边`
}

export async function readExecutionContext(
  context: CoreContext, query: ExecutionContextQuery,
): Promise<ExecutionContextView | undefined> {
  const id = contextIdFor(context.workspaceId, query.workItemId, query.repositoryId)
  const record = await context.storage.getExecutionContext(id)
  if (record === undefined) return undefined
  const run = await context.storage.getExecutionRun(runIdFor(id))
  const fallback = fallbackOf(run)
  const gap = record.status === ExecutionContextStatus.Ready ? await readyGap(context, record, run) : undefined
  return {
    id: record.id, workspaceId: record.workspaceId, workItemId: record.workItemId, repositoryId: record.repositoryId,
    status: record.status, branchExternalId: record.branchExternalId, worktreeExternalId: record.worktreeExternalId,
    runExternalId: run?.providerRef?.externalId,
    runId: run?.id, fallback, degraded: fallback !== undefined || gap !== undefined,
  }
}

/** 执行上下文记录的唯一写入入口：让 Request/Query 的字符串 id 在这里完成品牌化。 */
export function contextRecord(
  context: CoreContext, contextId: ExecutionContextId, request: StartWorkRequest,
  status: ExecutionContextStatus, branchExternalId: string | undefined, worktreeExternalId: string | undefined,
  provisioningStartedAt: string | undefined = undefined,
) {
  return {
    id: contextId, workspaceId: context.workspaceId,
    workItemId: asBrandedId<EntityId>(request.workItemId),
    repositoryId: asBrandedId<EntityId>(request.repositoryId),
    status, branchExternalId, worktreeExternalId, provisioningStartedAt,
  }
}
