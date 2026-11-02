import type { ActorRef, CommandWriteState } from '@harness-projects/controller'
import type { DeliveryLineageScope } from './delivery-lineage-reader.ts'
export interface ChangeRequestIntent extends DeliveryLineageScope { readonly base: string; readonly title: string; readonly body: string }
export type ChangeRequestOperation = { readonly kind: 'none' } | { readonly kind: 'blocked'; readonly reason: 'unavailable' | 'ambiguous' | 'invalid_operation' }
  | { readonly kind: 'operation'; readonly operationId: string; readonly state: string; readonly currentTarget: boolean; readonly targetStamp: string; readonly head: string; readonly base: string; readonly title: string }
export interface ChangeRequestOperationRead extends DeliveryLineageScope { readonly operation: ChangeRequestOperation }
export interface ChangeRequestCreation { readonly writeState: CommandWriteState; readonly operationId?: string; readonly targetStamp?: string; readonly lineageStale?: boolean; readonly recovery?: string }
export interface ChangeRequestCreator {
  operation(scope: DeliveryLineageScope, operationId?: string): Promise<ChangeRequestOperationRead>
  submit(intent: ChangeRequestIntent): Promise<ChangeRequestCreation>
  resume(scope: DeliveryLineageScope, operationId: string): Promise<ChangeRequestCreation>
}
interface Port {
  create(actor: ActorRef, key: string, workItemId: string, repositoryId: string, base: string, title: string, body: string): Promise<unknown>
  operation(actor: ActorRef, workItemId: string, repositoryId: string, operationId?: string): Promise<unknown>
  resume(actor: ActorRef, workItemId: string, repositoryId: string, operationId: string): Promise<unknown>
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some((key) => !keys.includes(key))) throw new TypeError('PR 响应不合契约')
  return value as Record<string, unknown>
}
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
/** 仅保留传输中的单飞任务；恢复身份与原输入由 Host 持有。 */
export function createChangeRequestCreator(port: Port, actor: ActorRef, makeKey: () => string = () => globalThis.crypto.randomUUID()): ChangeRequestCreator {
  const flights = new Map<string, Promise<ChangeRequestCreation>>()
  const send = (identity: string, run: () => Promise<unknown>) => {
    const active = flights.get(identity)
    if (active !== undefined) return active
    const task = Promise.resolve().then(async (): Promise<ChangeRequestCreation> => {
      try {
        const dto = record(await run(), ['writeState', 'saving', 'authoritative', 'value', 'error']), state = dto.writeState as CommandWriteState
        if (!['confirmed', 'reconciled', 'pending', 'unknown', 'failed', 'conflict'].includes(state) || dto.saving !== (state === 'pending') || dto.authoritative !== ['confirmed', 'reconciled'].includes(state)) throw new TypeError('PR 状态不合契约')
        const value = dto.value === undefined ? undefined : record(dto.value, ['phase', 'ref', 'entityId', 'error', 'lineageStale', 'operationId', 'targetStamp'])
        if (value !== undefined && ((value.lineageStale !== undefined && typeof value.lineageStale !== 'boolean') || (value.operationId !== undefined && (!text(value.operationId) || !text(value.targetStamp))))) throw new TypeError('PR 结果不合契约')
        const ref = value?.ref as Record<string, unknown> | undefined
        if (dto.authoritative && (value?.phase !== state || !text(value.operationId) || !text(value.targetStamp) || !text(value.entityId) || ref?.objectKind !== 'change_request' || !text(ref.bindingId) || !text(ref.externalId))) throw new TypeError('PR 缺少确认身份')
        const error = dto.error as Record<string, unknown> | undefined
        return { writeState: state, ...(text(value?.operationId) ? { operationId: value.operationId, targetStamp: value!.targetStamp as string } : {}), lineageStale: value?.lineageStale === true, ...(typeof error?.recovery === 'string' ? { recovery: error.recovery } : {}) }
      } catch { return { writeState: 'unknown' } }
      finally { flights.delete(identity) }
    })
    flights.set(identity, task); return task
  }
  return {
    async operation(scope, operationId) {
      const dto = record(await port.operation(actor, scope.workItemId, scope.repositoryId, operationId), ['workspaceId', 'workItemId', 'repositoryId', 'operation'])
      for (const key of ['workspaceId', 'workItemId', 'repositoryId'] as const) if (!text(dto[key]) || dto[key] !== scope[key]) throw new TypeError('PR 作用域不合契约')
      const value = record(dto.operation, ['kind', 'reason', 'operationId', 'state', 'currentTarget', 'targetStamp', 'head', 'base', 'title'])
      record(value, value.kind === 'none' ? ['kind'] : value.kind === 'blocked' ? ['kind', 'reason'] : ['kind', 'operationId', 'state', 'currentTarget', 'targetStamp', 'head', 'base', 'title'])
      if (value.kind === 'operation') {
        if (['operationId', 'targetStamp', 'head', 'base', 'title'].some((key) => !text(value[key])) || typeof value.currentTarget !== 'boolean' || (typeof value.state !== 'string' || !['pending', 'unknown', 'saved', 'failed', 'conflict'].includes(value.state)) || (operationId !== undefined && value.operationId !== operationId)) throw new TypeError('PR 操作不合契约')
      } else if (value.kind !== 'none' && !(value.kind === 'blocked' && typeof value.reason === 'string' && ['unavailable', 'ambiguous', 'invalid_operation'].includes(value.reason))) throw new TypeError('PR 操作不合契约')
      return dto as unknown as ChangeRequestOperationRead
    },
    submit(intent) { return send(JSON.stringify(['create', intent]), () => port.create(actor, makeKey(), intent.workItemId, intent.repositoryId, intent.base, intent.title, intent.body)) },
    resume(scope, operationId) { return send(JSON.stringify(['resume', scope, operationId]), () => port.resume(actor, scope.workItemId, scope.repositoryId, operationId)) },
  }
}
