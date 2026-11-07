import type { CommandWriteState } from '@harness-projects/controller'
import type { DeliveryLineageScope } from './delivery-lineage-reader.ts'
export type AssigneeRepositoryScope = DeliveryLineageScope
export interface AssigneeScope extends AssigneeRepositoryScope { readonly createOperationId: string }
export interface AssigneeOptions { readonly targetStamp: string; readonly items: readonly { readonly id: string; readonly login: string }[]; readonly nextCursor?: string | undefined }
export type AssigneeOperation = { readonly kind: 'none' | 'blocked' } | { readonly kind: 'operation'; readonly operationId: string; readonly targetStamp: string; readonly state: string; readonly requestedIds: readonly string[]; readonly confirmedIds: readonly string[] }
export interface AssigneeWrite { readonly writeState: CommandWriteState; readonly operationId?: string }
export interface ChangeRequestAssignees {
  options(scope: AssigneeRepositoryScope, cursor?: string): Promise<AssigneeOptions>
  operation(scope: AssigneeScope, operationId?: string): Promise<AssigneeOperation>
  add(scope: AssigneeScope, ids: readonly string[]): Promise<AssigneeWrite>
  resume(scope: AssigneeScope, operationId: string): Promise<AssigneeWrite>
}
interface Port {
  options(scope: AssigneeRepositoryScope, cursor?: string): Promise<unknown>
  operation(scope: AssigneeScope, operationId?: string): Promise<unknown>
  add(scope: AssigneeScope, ids: readonly string[], key: string): Promise<unknown>
  resume(scope: AssigneeScope, operationId: string): Promise<unknown>
}
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const ids = (v: unknown): v is readonly string[] => Array.isArray(v) && v.every(text) && new Set(v).size === v.length
function record(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Reflect.ownKeys(v).some(k => typeof k !== 'string' || !keys.includes(k) || Object.getOwnPropertyDescriptor(v, k)?.get || Object.getOwnPropertyDescriptor(v, k)?.set)) throw TypeError('负责人响应不合契约')
  return v as Record<string, unknown>
}
function scoped(v: unknown, scope: AssigneeRepositoryScope, fields: readonly string[]) {
  const dto = record(v, [...Object.keys(scope), ...fields]); for (const [key, value] of Object.entries(scope)) if (dto[key] !== value) throw TypeError('负责人作用域已变化'); return dto
}
export function createChangeRequestAssignees(port: Port): ChangeRequestAssignees {
  const flights = new Map<string, Promise<AssigneeWrite>>()
  function send(scope: AssigneeScope, identity: unknown[], run: () => Promise<unknown>) {
    const key = JSON.stringify([scope, identity]), active = flights.get(key); if (active) return active
    const task = Promise.resolve().then(async (): Promise<AssigneeWrite> => { try {
      const dto = scoped(await run(), scope, ['result']), result = record(dto.result, ['writeState', 'saving', 'authoritative', 'value', 'error']), state = result.writeState as CommandWriteState
      if (!['confirmed', 'reconciled', 'unknown', 'failed', 'conflict'].includes(state) || result.saving !== false || result.authoritative !== ['confirmed', 'reconciled'].includes(state)) throw TypeError('负责人状态')
      const value = record(result.value, ['phase', 'operationId', 'error']); if (value.phase !== state || (value.operationId !== undefined && !text(value.operationId))) throw TypeError('负责人结果')
      return { writeState: state, ...(text(value.operationId) ? { operationId: value.operationId } : {}) }
    } catch { return { writeState: 'unknown' } } finally { flights.delete(key) } })
    flights.set(key, task); return task
  }
  return {
    async options(scope, cursor) {
      const dto = scoped(await port.options(scope, cursor), scope, ['targetStamp', 'items', 'nextCursor'])
      if (!text(dto.targetStamp) || !Array.isArray(dto.items) || dto.items.some(u => { const user = record(u, ['id', 'login']); return !text(user.id) || !text(user.login) }) || (dto.nextCursor !== undefined && !text(dto.nextCursor))) throw TypeError('负责人候选')
      return dto as unknown as AssigneeOptions
    },
    async operation(scope, operationId) {
      const dto = scoped(await port.operation(scope, operationId), scope, ['operation', 'operationId']), op = record(dto.operation, ['kind', 'operationId', 'targetStamp', 'state', 'requestedIds', 'confirmedIds'])
      if (op.kind === 'operation') { if (!text(op.operationId) || !text(op.targetStamp) || !['pending', 'saved', 'unknown', 'failed', 'conflict'].includes(op.state as string) || !ids(op.requestedIds) || !ids(op.confirmedIds) || (operationId !== undefined && op.operationId !== operationId)) throw TypeError('负责人操作') }
      else if (!['none', 'blocked'].includes(op.kind as string) || Object.keys(op).length !== 1) throw TypeError('负责人操作')
      return op as unknown as AssigneeOperation
    },
    add: (scope, selected) => { const frozen = [...selected].sort(); return send(scope, ['add', frozen], () => port.add(scope, frozen, globalThis.crypto.randomUUID())) },
    resume: (scope, operationId) => send(scope, ['resume', operationId], () => port.resume(scope, operationId)),
  }
}
