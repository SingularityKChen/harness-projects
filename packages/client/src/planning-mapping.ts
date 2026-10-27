import { planningFieldMappingSnapshot } from '@harness-projects/domain/values'
import type { WorkspacePlanningFieldMapping } from '@harness-projects/domain'
import type { ActorRef } from '@harness-projects/controller'
export interface PlanningMappingScope { readonly workspaceId: string; readonly bindingId: string; readonly projectExternalId: string }
export interface PlanningMappingField { readonly id: string; readonly name: string; readonly kind: 'single_select' | 'iteration' | 'date' | 'unsupported'; readonly options?: readonly { readonly id: string; readonly name: string }[] }
export interface PlanningMappingDTO {
  readonly scope: PlanningMappingScope
  readonly mapping: WorkspacePlanningFieldMapping
  readonly fields: readonly PlanningMappingField[]
  readonly origin?: 'derived' | 'user'
  readonly confirmed: boolean
}
export interface PlanningMappingPort {
  getPlanningMapping(): Promise<unknown>
  setPlanningMapping(actor: ActorRef, key: string, bindingId: string, projectExternalId: string, mapping: WorkspacePlanningFieldMapping): Promise<unknown>
}
export interface PlanningMappingSnapshot { readonly data?: PlanningMappingDTO; readonly intent?: WorkspacePlanningFieldMapping | undefined; readonly scope?: PlanningMappingScope; readonly pending: boolean; readonly error?: string; readonly intentState?: 'pending' | 'local_only' | 'rejected' | 'unknown' | undefined; readonly errorCode?: 'invalid_input' | 'conflict' | 'unavailable' | undefined; readonly recovery?: 'refresh' | 'retry' | undefined }
export interface PlanningMappingSource {
  subscribe(listener: () => void): () => void
  getSnapshot(): PlanningMappingSnapshot
  refresh(scope: PlanningMappingScope): Promise<void>
  save(mapping: WorkspacePlanningFieldMapping): Promise<void>
  dispose(): void
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some((key) => !keys.includes(key))) throw new TypeError('映射响应不合契约')
  return value as Record<string, unknown>
}
const text = (value: unknown): string => { if (typeof value !== 'string' || !value) throw new TypeError('映射字段不合契约'); return value }
const sameScope = (a: PlanningMappingScope, b: PlanningMappingScope): boolean => a.workspaceId === b.workspaceId && a.bindingId === b.bindingId && a.projectExternalId === b.projectExternalId
export function parsePlanningMapping(value: unknown): PlanningMappingDTO {
  const dto = record(value, ['scope', 'mapping', 'fields', 'origin', 'confirmed']), rawScope = record(dto.scope, ['workspaceId', 'bindingId', 'projectExternalId'])
  if (typeof dto.confirmed !== 'boolean' || !Array.isArray(dto.fields) || (dto.origin !== undefined && dto.origin !== 'derived' && dto.origin !== 'user')) throw new TypeError('映射响应不合契约')
  const fields = dto.fields.map((value): PlanningMappingField => {
    const field = record(value, ['id', 'name', 'kind', 'options']), kind = field.kind
    if (!['single_select', 'iteration', 'date', 'unsupported'].includes(kind as string) || (kind === 'single_select' ? !Array.isArray(field.options) : field.options !== undefined)) throw new TypeError('映射字段不合契约')
    const options = kind !== 'single_select' ? undefined : (field.options as unknown[]).map((value) => { const option = record(value, ['id', 'name']); return Object.freeze({ id: text(option.id), name: text(option.name) }) })
    if (options && new Set(options.map((item) => item.id)).size !== options.length) throw new TypeError('映射选项重复')
    return Object.freeze({ id: text(field.id), name: text(field.name), kind: kind as PlanningMappingField['kind'], ...(options ? { options: Object.freeze(options) } : {}) })
  })
  if (new Set(fields.map((field) => field.id)).size !== fields.length) throw new TypeError('映射字段重复')
  return Object.freeze({ scope: Object.freeze({ workspaceId: text(rawScope.workspaceId), bindingId: text(rawScope.bindingId), projectExternalId: text(rawScope.projectExternalId) }), mapping: planningFieldMappingSnapshot(dto.mapping as WorkspacePlanningFieldMapping), fields: Object.freeze(fields), confirmed: dto.confirmed, ...(dto.origin ? { origin: dto.origin as 'derived' | 'user' } : {}) })
}
export function createPlanningMappingSource(port: PlanningMappingPort, options: { readonly actorRef: ActorRef; readonly key?: () => string }): PlanningMappingSource {
  let snapshot: PlanningMappingSnapshot = Object.freeze({ pending: false }), scope: PlanningMappingScope | undefined, revision = 0, disposed = false
  let mutation: Promise<void> | undefined, intent: { payload: string; key: string; mapping: WorkspacePlanningFieldMapping; unresolved: boolean; unknown?: boolean; acknowledged?: boolean; rejected?: boolean } | undefined
  const listeners = new Set<() => void>(), key = options.key ?? (() => globalThis.crypto.randomUUID())
  const publish = (next: PlanningMappingSnapshot) => { if (!disposed) { snapshot = Object.freeze({ ...next, intent: intent?.unresolved ? intent.mapping : undefined, intentState: !intent?.unresolved ? undefined : intent.acknowledged ? 'local_only' : intent.rejected ? 'rejected' : intent.unknown ? 'unknown' : 'pending', ...(scope ? { scope } : {}) }); listeners.forEach((listener) => listener()) } }
  const read = async (version: number): Promise<void> => {
    const data = parsePlanningMapping(await port.getPlanningMapping())
    if (disposed || version !== revision) return
    if (!scope || !sameScope(data.scope, scope)) { intent = undefined; publish({ pending: false, error: '规划来源已改变，请重新读取。' }); return }
    if (intent && data.confirmed && JSON.stringify(data.mapping) === JSON.stringify(intent.mapping)) intent.unresolved = false
    publish({ data, pending: false })
  }
  const failed = (version: number) => { if (version === revision) publish({ ...snapshot, pending: false, error: '来源尚未确认，请重试。', errorCode: undefined, recovery: 'retry' }) }
  const refresh = async (next: PlanningMappingScope): Promise<void> => {
    if (disposed) return
    const changed = !scope || !sameScope(next, scope); if (changed) intent = undefined; scope = Object.freeze({ ...next }); const version = ++revision
    publish({ ...(changed ? {} : snapshot), pending: true })
    try { await read(version) } catch { failed(version) }
  }
  const save = (raw: WorkspacePlanningFieldMapping): Promise<void> => {
    if (disposed || !scope || !snapshot.data) return Promise.resolve()
    if (mutation) return mutation
    const version = ++revision, expected = scope
    let mapping: WorkspacePlanningFieldMapping
    try { mapping = planningFieldMappingSnapshot(raw) } catch { failed(version); return Promise.resolve() }
    if (Object.keys(mapping.status?.options ?? {}).some((id) => ['__proto__', 'constructor', 'prototype'].includes(id))) { publish({ ...snapshot, pending: false, error: '当前连接不支持此选项 ID，请保持未映射。' }); return Promise.resolve() }
    const payload = JSON.stringify([expected, mapping])
    if (intent?.payload !== payload || intent.rejected) intent = { payload, key: key(), mapping, unresolved: true }
    // 本次 intent 的本地 ack 与传输结果分开：未知重试不能撤销已收到的提交证明。
    const active = intent; active.unresolved = true; publish({ ...(snapshot.data ? { data: snapshot.data } : {}), pending: true })
    const promise = (async () => {
      try {
        if (active.unknown) {
          const data = parsePlanningMapping(await port.getPlanningMapping())
          if (disposed || version !== revision) return
          if (!sameScope(data.scope, expected)) { intent = undefined; publish({ pending: false, error: '规划来源已改变，请重新读取。' }); return }
          if (JSON.stringify(data.mapping) === JSON.stringify(mapping) && data.confirmed) { active.unknown = false; active.unresolved = false; publish({ data, pending: false }); return }
        }
        active.unknown = true
        const command = record(await port.setPlanningMapping(options.actorRef, active.key, expected.bindingId, expected.projectExternalId, mapping), ['writeState', 'saving', 'authoritative', 'value', 'error', 'activationError'])
        if (disposed || version !== revision) return
        if (['failed', 'conflict'].includes(command.writeState as string) && command.saving === false && command.authoritative === false && command.error) {
          const error = record(command.error, ['code', 'message', 'recovery', 'retryable', 'confirmedValue', 'attemptedValue'])
          const code = error.code === 'invalid_input' || error.code === 'conflict' ? error.code : 'unavailable'
          active.unknown = false; active.rejected = true
          publish({ ...snapshot, pending: false, errorCode: code, recovery: code === 'unavailable' ? 'retry' : 'refresh', error: code === 'invalid_input' ? '映射未保存，请重新读取字段定义后选择。' : code === 'conflict' ? '规划来源已改变，映射未保存，请重新读取。' : '映射未保存，请检查连接后重试。' }); return
        }
        if (command.writeState !== 'local_only' || command.saving !== false || command.authoritative !== false || command.error) { failed(version); return }
        const value = record(command.value, ['bindingId']); if (value.bindingId !== expected.bindingId) throw new TypeError('映射范围不合契约')
        active.unknown = false; active.acknowledged = true
        if (snapshot.data) publish({ data: Object.freeze({ ...snapshot.data, confirmed: false }), pending: true })
        if (command.activationError) { failed(version); return }
        await read(version)
      } catch { failed(version) }
    })()
    mutation = promise; void promise.then(() => { if (mutation === promise) mutation = undefined }); return promise
  }
  return { subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, getSnapshot: () => snapshot, refresh, save, dispose: () => { disposed = true; revision++; listeners.clear() } }
}
