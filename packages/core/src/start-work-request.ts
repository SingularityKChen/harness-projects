import { ProjectErrorCode, projectError, type MutationAttemptRecord } from '@harness-projects/capabilities'
import type { ProviderBindingId, WorkspaceId } from '@harness-projects/domain'
import type { StartWorkRequest } from './execution-context.ts'

/** 先复制声明字段到 primitive，既不序列化调用方对象，也不在 await 后重读它。 */
export function snapshotRequest(input: StartWorkRequest): StartWorkRequest | undefined {
  const { workItemId, repositoryId, idempotencyKey, branchName, worktreePath, actor } = input
  if (actor === null || typeof actor !== 'object' || Array.isArray(actor)) return undefined
  const { kind, id } = actor
  if (typeof kind !== 'string' || kind.trim() === '' || (id !== undefined && typeof id !== 'string')
    || (worktreePath !== undefined && typeof worktreePath !== 'string')) return undefined
  return { workItemId, repositoryId, idempotencyKey, ...(branchName === undefined ? {} : { branchName }),
    ...(worktreePath === undefined ? {} : { worktreePath }), actor: { kind, ...(id === undefined ? {} : { id }) } }
}

/** 固定字段 JSON 元组；缺省与显式默认值不同，所有字符串保留原字节。 */
export function requestFingerprint(workspaceId: WorkspaceId, bindingId: ProviderBindingId, request: StartWorkRequest): string {
  return JSON.stringify(['startWork:v1', workspaceId, bindingId, [request.actor.kind, request.actor.id ?? null],
    request.workItemId, request.repositoryId, request.branchName ?? null, request.worktreePath ?? null])
}

export function requestMismatch(workspaceId: WorkspaceId, request: StartWorkRequest, attempt: MutationAttemptRecord): boolean {
  return attempt.commandName !== 'startWork' || attempt.requestFingerprint !== requestFingerprint(workspaceId, attempt.bindingId, request)
}
export const bindingConflict = (reason: 'idempotency_request_mismatch' | 'idempotency_target_changed') => projectError(ProjectErrorCode.Conflict, reason)
