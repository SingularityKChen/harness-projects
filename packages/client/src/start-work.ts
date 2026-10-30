/** 局部提交 intent；执行事实始终由既有 reader/Host 拥有。 */
import { ExecutionContextStatus } from '@harness-projects/domain/values'
import { CapabilityKey } from './keys.ts'
import type { ActorRef, CommandWriteState } from '@harness-projects/controller'
import type { ExecutionContextReader, ExecutionContextScope } from './execution-context.ts'
export interface StartWorkIntent extends ExecutionContextScope { readonly branchName?: string | undefined }
export interface StartWorkOptions { readonly workspaceId: string; readonly workItemId: string; readonly executionMode: 'manual' | 'harness'; readonly repositories?: readonly { id: string; available: boolean; reason?: string }[] }
export interface StartWorkResult { readonly writeState: CommandWriteState; readonly degraded: boolean; readonly fallback?: 'manual_fallback'; readonly contextStatus?: ExecutionContextStatus; readonly reason?: string }
export interface StartWorkPort {
  getStartWorkOptions(workItemId: string): Promise<unknown>
  startWork(actorRef: ActorRef, key: string, workItemId: string, repositoryId: string, branchName?: string): Promise<unknown>
}
export interface StartWork { options(scope: Pick<ExecutionContextScope, 'workspaceId' | 'workItemId'>): Promise<StartWorkOptions>; submit(intent: StartWorkIntent): Promise<StartWorkResult> }
const unknown = (): StartWorkResult => ({ writeState: 'unknown', degraded: false })
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some((key) => !keys.includes(key))) throw new TypeError('开始工作响应不合契约')
  return value as Record<string, unknown>
}
function result(value: unknown): StartWorkResult {
  const dto = record(value, ['writeState', 'saving', 'authoritative', 'value', 'error'])
  if (!['confirmed', 'reconciled', 'local_only', 'pending', 'unknown', 'failed', 'conflict'].includes(dto.writeState as string)
    || dto.saving !== (dto.writeState === 'pending') || dto.authoritative !== ['confirmed', 'reconciled'].includes(dto.writeState as string)) throw new TypeError('开始工作状态不合契约')
  const view = dto.value === undefined ? undefined : record(dto.value, ['executionContextId', 'status', 'branchExternalId', 'worktreeExternalId', 'branchHeadCommit', 'fallback', 'degraded', 'runExternalId'])
  if (view && (typeof view.degraded !== 'boolean' || Object.entries(view).some(([key, value]) => key !== 'degraded' && value !== undefined && typeof value !== 'string'))) throw new TypeError('开始工作结果不合契约')
  if (view && ((view.status !== undefined && !Object.values(ExecutionContextStatus).includes(view.status as ExecutionContextStatus))
    || (view.fallback !== undefined && view.fallback !== 'manual_fallback'))) throw new TypeError('开始工作结果状态不合契约')
  if (['confirmed', 'reconciled'].includes(dto.writeState as string) && !view?.executionContextId) throw new TypeError('开始工作缺少确认结果')
  const error = dto.error === undefined ? undefined : record(dto.error, ['code', 'message', 'recovery', 'retryable', 'confirmedValue', 'attemptedValue'])
  if (error && (typeof error.code !== 'string' || typeof error.message !== 'string')) throw new TypeError('开始工作错误不合契约')
  const denied = (error?.message as string | undefined)?.match(/^(capability|permission|policy) 层拒绝 ([a-z._]+)；/)
  return { writeState: dto.writeState as CommandWriteState, degraded: view?.degraded === true,
    ...(denied && Object.values(CapabilityKey).some(key => key === denied[2]) ? { reason: `${denied[1]} 层拒绝 ${denied[2]}；其它获准操作仍可用，请恢复授权后重新验证并显式重试` } : {}),
    ...(view?.status === undefined ? {} : { contextStatus: view.status as ExecutionContextStatus }),
    ...(view?.fallback === 'manual_fallback' ? { fallback: 'manual_fallback' } : {}) }
}
export function createStartWork(port: StartWorkPort, reader: ExecutionContextReader, actor: ActorRef, makeKey: () => string = () => globalThis.crypto.randomUUID()): StartWork {
  let attempt: { identity: string; key: string; uncertain: boolean; finished: boolean; pending?: Promise<StartWorkResult> | undefined } | undefined
  return {
    async options(scope) {
      const dto = record(await port.getStartWorkOptions(scope.workItemId), ['workspaceId', 'workItemId', 'executionMode', 'repositories'])
      if (dto.workspaceId !== scope.workspaceId || dto.workItemId !== scope.workItemId || !['manual', 'harness'].includes(dto.executionMode as string)) throw new TypeError('开始工作范围不合契约')
      if (dto.repositories !== undefined && (!Array.isArray(dto.repositories) || dto.repositories.some(value => {
        const entry = record(value, ['id', 'available', 'reason'])
        return typeof entry.id !== 'string' || typeof entry.available !== 'boolean' || (entry.reason !== undefined && typeof entry.reason !== 'string')
      }))) throw new TypeError('开始工作验证不合契约')
      return dto as unknown as StartWorkOptions
    },
    submit(intent) {
      const identity = JSON.stringify([intent.workspaceId, intent.workItemId, intent.repositoryId, intent.branchName])
      if (!attempt || attempt.identity !== identity || (attempt.finished && !attempt.uncertain)) attempt = { identity, key: makeKey(), uncertain: false, finished: false }
      const current = attempt
      if (current.pending) return current.pending
      current.pending = Promise.resolve().then(async () => {
        try {
          if (current.uncertain) await reader(intent)
          const answer = result(await port.startWork(actor, current.key, intent.workItemId, intent.repositoryId, intent.branchName))
          current.uncertain = ['pending', 'unknown'].includes(answer.writeState)
          current.finished = ['failed', 'conflict'].includes(answer.writeState)
            || (answer.writeState === 'local_only' && answer.contextStatus === ExecutionContextStatus.Failed)
          return answer
        } catch { current.uncertain = true; return unknown() }
        finally { current.pending = undefined }
      })
      return current.pending
    },
  }
}
