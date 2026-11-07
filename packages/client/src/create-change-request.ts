import type { ChangeRequestAssignees } from './change-request-assignees.ts'
import type { ActorRef, CommandWriteState } from '@harness-projects/controller'
import type { DeliveryLineageScope } from './delivery-lineage-reader.ts'
export type IssueRelation = 'reference' | 'closing' | 'none'
export interface ChangeRequestIssueOptions { readonly targetStamp?: string; readonly target?: { readonly repositoryName: string; readonly number: number }; readonly defaultRelation: IssueRelation; readonly relations: readonly IssueRelation[]; readonly reason?: string }
export interface ChangeRequestIntent extends DeliveryLineageScope { readonly base: string; readonly title: string; readonly body: string; readonly draft?: boolean; readonly issueRelation?: IssueRelation; readonly issueTargetStamp?: string | undefined }
export type ChangeRequestOperation = { readonly kind: 'none' } | { readonly kind: 'blocked'; readonly reason: 'unavailable' | 'ambiguous' | 'invalid_operation' }
  | { readonly kind: 'operation'; readonly operationId: string; readonly state: string; readonly currentTarget: boolean; readonly targetStamp: string; readonly head: string; readonly base: string; readonly title: string; readonly draft: boolean; readonly issueRelation: IssueRelation; readonly issueTarget?: { readonly repositoryName: string; readonly number: number } }
export interface ChangeRequestOperationRead extends DeliveryLineageScope { readonly operation: ChangeRequestOperation }
export interface ChangeRequestCreation { readonly writeState: CommandWriteState; readonly operationId?: string; readonly targetStamp?: string; readonly lineageStale?: boolean; readonly recovery?: string; readonly relationState?: 'none' | 'pending' | 'confirmed' | 'denied' | 'unknown' }
export interface ChangeRequestCreator {
  options(scope: DeliveryLineageScope, base: string): Promise<ChangeRequestIssueOptions>
  readonly assignees?: ChangeRequestAssignees
  operation(scope: DeliveryLineageScope, operationId?: string): Promise<ChangeRequestOperationRead>
  submit(intent: ChangeRequestIntent): Promise<ChangeRequestCreation>
  resume(scope: DeliveryLineageScope, operationId: string): Promise<ChangeRequestCreation>
}
interface Port {
  options(actor: ActorRef, workItemId: string, repositoryId: string, base: string): Promise<unknown>
  create(actor: ActorRef, key: string, workItemId: string, repositoryId: string, base: string, title: string, body: string, draft: boolean, issueRelation?: IssueRelation, issueTargetStamp?: string): Promise<unknown>
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
        const value = dto.value === undefined ? undefined : record(dto.value, ['phase', 'ref', 'entityId', 'error', 'lineageStale', 'operationId', 'targetStamp', 'relationState'])
        if (value !== undefined && ((value.lineageStale !== undefined && typeof value.lineageStale !== 'boolean') || (value.operationId !== undefined && (!text(value.operationId) || !text(value.targetStamp))))) throw new TypeError('PR 结果不合契约')
        if (value?.relationState !== undefined && (typeof value.relationState !== 'string' || !['none', 'pending', 'confirmed', 'denied', 'unknown'].includes(value.relationState))) throw new TypeError('Issue 关联状态无效')
        const ref = value?.ref as Record<string, unknown> | undefined
        if (dto.authoritative && (value?.phase !== state || !text(value.operationId) || !text(value.targetStamp) || !text(value.entityId) || ref?.objectKind !== 'change_request' || !text(ref.bindingId) || !text(ref.externalId))) throw new TypeError('PR 缺少确认身份')
        const error = dto.error as Record<string, unknown> | undefined
        return { writeState: state, ...(text(value?.operationId) ? { operationId: value.operationId, targetStamp: value!.targetStamp as string } : {}), lineageStale: value?.lineageStale === true, ...(value?.relationState === undefined ? {} : { relationState: value.relationState as NonNullable<ChangeRequestCreation['relationState']> }), ...(typeof error?.recovery === 'string' ? { recovery: error.recovery } : {}) }
      } catch { return { writeState: 'unknown' } }
      finally { flights.delete(identity) }
    })
    flights.set(identity, task); return task
  }
  return {
    async options(scope, base) {
      const dto = record(await port.options(actor, scope.workItemId, scope.repositoryId, base), ['workspaceId', 'workItemId', 'repositoryId', 'base', 'options'])
      if (dto.workspaceId !== scope.workspaceId || dto.workItemId !== scope.workItemId || dto.repositoryId !== scope.repositoryId || dto.base !== base) throw new TypeError('Issue 选项作用域无效')
      const o = record(dto.options, ['target', 'targetStamp', 'defaultRelation', 'relations', 'reason'])
      if (!Array.isArray(o.relations) || o.relations.length === 0 || new Set(o.relations).size !== o.relations.length || o.relations.some(r => !['reference', 'closing', 'none'].includes(r)) || !o.relations.includes(o.defaultRelation) || !o.relations.includes('none') || (o.reason !== undefined && !text(o.reason))) throw new TypeError('Issue 选项无效')
      let target: ChangeRequestIssueOptions['target']
      if (o.target !== undefined) { const t = record(o.target, ['source', 'nativeIssueIdentity', 'number', 'repository']), repo = record(t.repository, ['identity', 'name']); if (!text(repo.name) || !Number.isSafeInteger(t.number) || Number(t.number) < 1) throw new TypeError('Issue 目标无效'); target = { repositoryName: repo.name, number: Number(t.number) } }
      if (o.relations.some(r => r !== 'none') && (!target || !text(o.targetStamp))) throw new TypeError('Issue 选项缺少目标')
      return { defaultRelation: o.defaultRelation as IssueRelation, relations: o.relations as IssueRelation[], ...(target ? { target, targetStamp: o.targetStamp as string } : {}), ...(o.reason === undefined ? {} : { reason: o.reason as string }) }
    },
    async operation(scope, operationId) {
      const dto = record(await port.operation(actor, scope.workItemId, scope.repositoryId, operationId), ['workspaceId', 'workItemId', 'repositoryId', 'operation'])
      for (const key of ['workspaceId', 'workItemId', 'repositoryId'] as const) if (!text(dto[key]) || dto[key] !== scope[key]) throw new TypeError('PR 作用域不合契约')
      const value = record(dto.operation, ['kind', 'reason', 'operationId', 'state', 'currentTarget', 'targetStamp', 'head', 'base', 'title', 'draft', 'issueRelation', 'issueTarget'])
      record(value, value.kind === 'none' ? ['kind'] : value.kind === 'blocked' ? ['kind', 'reason'] : ['kind', 'operationId', 'state', 'currentTarget', 'targetStamp', 'head', 'base', 'title', 'draft', 'issueRelation', 'issueTarget'])
      if (value.kind === 'operation') {
        if (['operationId', 'targetStamp', 'head', 'base', 'title'].some((key) => !text(value[key])) || typeof value.draft !== 'boolean' || (typeof value.issueRelation !== 'string' || !['reference', 'closing', 'none'].includes(value.issueRelation)) || typeof value.currentTarget !== 'boolean' || (typeof value.state !== 'string' || !['pending', 'unknown', 'saved', 'failed', 'conflict'].includes(value.state)) || (operationId !== undefined && value.operationId !== operationId)) throw new TypeError('PR 操作不合契约')
        if (value.issueRelation !== 'none' && value.issueTarget !== undefined) { const target = record(value.issueTarget, ['repositoryName', 'number']); if (!text(target.repositoryName) || !Number.isSafeInteger(target.number) || Number(target.number) < 1) throw new TypeError('原 Issue 目标无效') } else if (value.issueRelation === 'none' && value.issueTarget !== undefined) throw new TypeError('无关联不能含目标')
      } else if (value.kind !== 'none' && !(value.kind === 'blocked' && typeof value.reason === 'string' && ['unavailable', 'ambiguous', 'invalid_operation'].includes(value.reason))) throw new TypeError('PR 操作不合契约')
      return dto as unknown as ChangeRequestOperationRead
    },
    submit(intent) {
      try {
        const { workspaceId, workItemId, repositoryId, base, title, body, draft, issueRelation, issueTargetStamp } = intent
        if ((draft !== undefined && typeof draft !== 'boolean') || (issueRelation !== undefined && !['reference', 'closing', 'none'].includes(issueRelation))) return Promise.resolve({ writeState: 'failed' })
        const captured = { workspaceId, workItemId, repositoryId, base, title, body, draft: draft ?? false, issueRelation, issueTargetStamp }
        return send(JSON.stringify(['create', captured]), () => port.create(actor, makeKey(), workItemId, repositoryId, base, title, body, captured.draft, captured.issueRelation, captured.issueTargetStamp))
      } catch { return Promise.resolve({ writeState: 'failed' }) }
    },
    resume(scope, operationId) { return send(JSON.stringify(['resume', scope, operationId]), () => port.resume(actor, scope.workItemId, scope.repositoryId, operationId)) },
  }
}
