import { createHash } from 'node:crypto'
import { CapabilityKey, externalIntentSnapshot, projectError, type ChangeRequestAssigneeIntent, type ChangeRequestExternalIntent, type MutationAttemptRecord, type StorageTransaction, type ProjectError } from '@harness-projects/capabilities'
import type { CoreContext } from './context.ts'
import { resolveAssigneeRepositoryTarget, resolveConfirmedChangeRequestTarget, type PrScope } from './create-change-request.ts'
type Actor = { readonly kind: string; readonly id?: string }
export type AssigneeRepositoryScope = PrScope
export interface AssigneeScope extends PrScope { readonly createOperationId: string }
export interface AssigneeQuery extends AssigneeScope { readonly operationId?: string | undefined }
export interface AssigneeAdd extends AssigneeScope { readonly actor: Actor; readonly idempotencyKey: string; readonly assigneeIds: readonly string[] }
export interface AssigneeResume extends AssigneeScope { readonly observer: Actor; readonly operationId: string }
export interface AssigneeOptions extends PrScope { readonly observer: Actor; readonly cursor?: string | undefined; readonly limit: number }
export type AssigneeOperation = { readonly kind: 'none' | 'blocked' } | { readonly kind: 'operation'; readonly operationId: string; readonly targetStamp: string; readonly state: MutationAttemptRecord['state']; readonly requestedIds: readonly string[]; readonly confirmedIds: readonly string[] }
export interface AssigneeResult { readonly phase: 'confirmed' | 'reconciled' | 'unknown' | 'failed' | 'conflict'; readonly operationId?: string; readonly error?: ProjectError }
export interface CreationAssignment { readonly state: 'none' | 'pending' | 'confirmed' | 'unknown' | 'failed' | 'conflict'; readonly operationId?: string; readonly reason?: 'not_supported' | 'permission_denied' }
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const fail = () => projectError('conflict', '负责人目标、授权或持久操作已变化')
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
function capture(value: object, keys: readonly string[]) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key) || Object.getOwnPropertyDescriptor(value, key)?.get || Object.getOwnPropertyDescriptor(value, key)?.set)) throw fail()
}
function actor(value: Actor) { capture(value, ['kind', 'id']); if (!text(value.kind) || (value.id !== undefined && !text(value.id))) throw fail(); return { kind: value.kind, ...(value.id === undefined ? {} : { id: value.id }) } }
const keys = ['workItemId', 'repositoryId', 'createOperationId']
const receipt = (r: MutationAttemptRecord) => JSON.stringify([r.id, r.workspaceId, r.bindingId, r.commandName, r.idempotencyKey, r.state, r.expectedSourceVersion, r.errorCode, r.requestFingerprint, r.externalIntent && externalIntentSnapshot(r.externalIntent)])
const fingerprint = (workspace: string, intent: ChangeRequestAssigneeIntent, who: Actor) => { const { sequence: _sequence, ...request } = externalIntentSnapshot({ ...intent, state: 'pending', confirmedIds: [] }); return JSON.stringify([workspace, who, request]) }
async function gate(context: CoreContext, target: Pick<Awaited<ReturnType<typeof resolveConfirmedChangeRequestTarget>>, 'route'>, key: CapabilityKey, mode: 'read' | 'write' = 'read', version = context.runtimeAccess.operationVersion(target.route.binding.ref.bindingId, key, target.route.repository.externalId)) {
  const error = await context.runtimeAccess.operation(target.route.binding, key, target.route.repository.externalId, context.policy, mode, version); if (error) throw error; return version
}
const creationKey = (id: string, ids: readonly string[]) => `pr-assignees:${id}:${hash(JSON.stringify(ids))}`
function matchesCreationRequest(context: CoreContext, attempt: MutationAttemptRecord, resolved: Awaited<ReturnType<typeof resolve>>, ids: readonly string[]) {
  return resolved.row && resolved.intent && resolved.row.idempotencyKey === creationKey(attempt.id, ids)
    && JSON.stringify(resolved.intent.input.assigneeIds) === JSON.stringify(ids)
    && resolved.row.requestFingerprint === fingerprint(context.workspaceId, resolved.intent, actor(JSON.parse(attempt.requestFingerprint!).actor))
}
export async function preflightCreationAssignees(context: CoreContext, scope: PrScope, route: Awaited<ReturnType<typeof resolveAssigneeRepositoryTarget>>['route'], tx: StorageTransaction = context.storage) {
  const directory = await resolveAssigneeRepositoryTarget(context, scope, tx)
  if (directory.route.binding.ref.bindingId !== route.binding.ref.bindingId) throw fail()
  for (const [key, method, mode] of [
    [CapabilityKey.DevelopmentAssigneeList, 'listAssignableUsers', 'read'],
    [CapabilityKey.DevelopmentChangeRequestAssigneeRead, 'getChangeRequestAssignees', 'read'],
    [CapabilityKey.DevelopmentChangeRequestAssigneeAdd, 'addChangeRequestAssignees', 'write'],
  ] as const) {
    if (!route.provider[method]) throw projectError('not_supported', '当前连接不支持创建时负责人')
    await gate(context, { route }, key, mode)
  }
}
/** 创建摘要只看原稳定键；人工后续 sequence 不替换创建意图。 */
export async function creationAssigneeSummary(context: CoreContext, scope: PrScope, attempt: MutationAttemptRecord, intent: ChangeRequestExternalIntent, tx: StorageTransaction = context.storage, version?: number): Promise<{ assignment?: CreationAssignment; requestedAssigneeIds?: readonly string[] }> {
  const ids = intent.requestedAssigneeIds
  if (!ids?.length) return {}
  let terminal: CreationAssignment | undefined
  try {
    const row = await tx.findMutationAttempt(context.workspaceId, creationKey(attempt.id, ids))
    const target = await resolveAssigneeRepositoryTarget(context, scope, tx)
    if (target.route.binding.ref.bindingId !== intent.bindingId) throw fail()
    if (row) {
      const resolved = await resolve(context, { ...scope, createOperationId: attempt.id, operationId: row.id }, tx, false)
      if (!matchesCreationRequest(context, attempt, resolved, ids)) throw fail()
      terminal = {
        state: row.state === 'saved' ? 'confirmed' : row.state, operationId: row.id,
        ...(['not_supported', 'permission_denied'].includes(row.errorCode ?? '') ? { reason: row.errorCode as 'not_supported' | 'permission_denied' } : {}),
      }
    }
    await gate(context, target, CapabilityKey.DevelopmentChangeRequestAssigneeRead, 'read', version)
    return { requestedAssigneeIds: [...ids], assignment: terminal ?? { state: 'pending' } }
  } catch { return { assignment: terminal?.state === 'failed' ? terminal : { state: 'unknown' } } }
}
export async function continueCreationAssignees(context: CoreContext, scope: PrScope, createOperationId: string): Promise<CreationAssignment> {
  try {
    const target = await resolveConfirmedChangeRequestTarget(context, { ...scope, createOperationId })
    const ids = target.intent.requestedAssigneeIds
    if (!ids?.length) return { state: 'none' }
    const version = context.runtimeAccess.operationVersion(target.intent.bindingId, CapabilityKey.DevelopmentChangeRequestAssigneeRead, scope.repositoryId)
    let result: AssigneeResult | undefined
    const idempotencyKey = creationKey(createOperationId, ids)
    const original = await context.storage.findMutationAttempt(context.workspaceId, idempotencyKey)
    if (original) {
      const exact = await context.storage.transaction(tx => resolve(context, { ...scope, createOperationId, operationId: original.id }, tx, false))
      if (!matchesCreationRequest(context, target.attempt, exact, ids)) throw fail()
      if (['pending', 'unknown'].includes(original.state)) {
        result = await resumeChangeRequestAssignees(context, {
          ...scope, createOperationId, operationId: original.id, observer: actor(JSON.parse(target.attempt.requestFingerprint!).actor),
        })
      }
    } else {
      result = await addChangeRequestAssignees(context, {
        ...scope, createOperationId, actor: actor(JSON.parse(target.attempt.requestFingerprint!).actor), assigneeIds: ids, idempotencyKey,
      })
    }
    const summary = (await creationAssigneeSummary(context, scope, target.attempt, target.intent, context.storage, version)).assignment ?? { state: 'unknown' as const }
    // 新一轮可读摘要不能把此前公共出口拒绝过的响应重新变成成功。
    return result?.phase === 'conflict' ? { state: 'conflict' } : summary
  } catch { return { state: 'unknown' } }
}
async function resolve(context: CoreContext, query: AssigneeQuery, tx: StorageTransaction, authorize = true) {
  capture(query, [...keys, 'operationId']); query = { ...query }; if (![query.workItemId, query.repositoryId, query.createOperationId].every(text) || (query.operationId !== undefined && !text(query.operationId))) throw fail()
  const scope = { workItemId: query.workItemId, repositoryId: query.repositoryId, createOperationId: query.createOperationId }, target = await resolveConfirmedChangeRequestTarget(context, scope, tx)
  const version = authorize ? await gate(context, target, CapabilityKey.DevelopmentChangeRequestAssigneeRead) : context.runtimeAccess.operationVersion(target.intent.bindingId, CapabilityKey.DevelopmentChangeRequestAssigneeRead, scope.repositoryId)
  const rows = (await tx.listMutationAttempts(context.workspaceId)).filter(r => query.operationId === undefined ? r.commandName === 'addChangeRequestAssignees' && r.externalIntent?.operation === 'addChangeRequestAssignees' && r.externalIntent.createOperationId === query.createOperationId : r.id === query.operationId)
  if (!rows.length) return { target, version, row: undefined, intent: undefined }
  if (rows.filter(row => ['pending', 'unknown'].includes(row.state)).length > 1) throw fail()
  if (rows.length > 1 && query.operationId === undefined) {
    const sequence = (row: MutationAttemptRecord) => row.externalIntent?.operation === 'addChangeRequestAssignees' ? row.externalIntent.sequence : NaN
    if (new Set(rows.map(sequence)).size !== rows.length) throw fail(); rows.sort((a, b) => sequence(b) - sequence(a))
  }
  const row = rows[0]!, intent = row.externalIntent === undefined ? undefined : externalIntentSnapshot(row.externalIntent)
  if (row.workspaceId !== context.workspaceId || row.commandName !== 'addChangeRequestAssignees' || row.id !== `assign-${hash(row.idempotencyKey)}` || intent?.operation !== 'addChangeRequestAssignees' || intent.createOperationId !== scope.createOperationId || intent.createReceipt !== target.createReceipt || intent.targetStamp !== target.targetStamp || intent.bindingId !== row.bindingId || intent.state !== row.state
    || JSON.stringify(intent.input.repository) !== JSON.stringify(target.intent.input.repository) || JSON.stringify(intent.input.changeRequest) !== JSON.stringify(target.intent.confirmedRef) || intent.contextId !== target.intent.contextId || intent.ownerGeneration !== target.intent.ownerGeneration || intent.worktree !== target.intent.worktree
    || !row.requestFingerprint || fingerprint(context.workspaceId, intent, actor(JSON.parse(row.requestFingerprint)[1])) !== row.requestFingerprint || intent.input.assigneeIds.length > 10) throw fail()
  return { target, version, row, intent }
}
const view = (resolved: Awaited<ReturnType<typeof resolve>>): AssigneeOperation => resolved.row && resolved.intent ? { kind: 'operation', operationId: resolved.row.id, targetStamp: resolved.intent.targetStamp, state: resolved.row.state, requestedIds: resolved.intent.input.assigneeIds, confirmedIds: resolved.intent.confirmedIds } : { kind: 'none' }
export async function getChangeRequestAssigneeOperation(context: CoreContext, query: AssigneeQuery): Promise<AssigneeOperation> {
  try { return await context.storage.transaction(async tx => { const current = await resolve(context, query, tx); await gate(context, current.target, CapabilityKey.DevelopmentChangeRequestAssigneeRead, 'read', current.version); return view(current) }) } catch { return { kind: 'blocked' } }
}
export async function listChangeRequestAssigneeOptions(context: CoreContext, input: AssigneeOptions) {
  capture(input, ['workItemId', 'repositoryId', 'observer', 'cursor', 'limit']); input = { ...input, observer: actor(input.observer) }
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100 || (input.cursor !== undefined && !text(input.cursor))) throw fail()
  const scope = { workItemId: input.workItemId, repositoryId: input.repositoryId }, target = await resolveAssigneeRepositoryTarget(context, scope), version = await gate(context, target, CapabilityKey.DevelopmentAssigneeList)
  const result = await target.route.provider.listAssignableUsers?.({ repository: target.route.repository, cursor: input.cursor, limit: input.limit })
  if (result?.ok || result?.error.code === 'permission_denied') context.runtimeAccess.observeOperation(target.route.binding.ref.bindingId, CapabilityKey.DevelopmentAssigneeList, scope.repositoryId, !result.ok, version)
  if (!result?.ok) throw result?.error ?? projectError('not_supported', '候选目录不受支持')
  if (!Array.isArray(result.value.items) || result.value.items.length > input.limit || result.value.items.some(u => !text(u.id) || !text(u.login)) || (result.value.nextCursor !== undefined && (!text(result.value.nextCursor) || result.value.nextCursor === input.cursor))) throw fail()
  const items = result.value.items.map(u => ({ id: u.id, login: u.login })), nextCursor = result.value.nextCursor
  return context.storage.transaction(async tx => {
    const current = await resolveAssigneeRepositoryTarget(context, scope, tx); await gate(context, current, CapabilityKey.DevelopmentAssigneeList, 'read', version)
    if (current.targetStamp !== target.targetStamp) throw fail()
    return { ...scope, targetStamp: current.targetStamp, items, nextCursor }
  })
}
async function observe(context: CoreContext, scope: AssigneeScope, expected: Awaited<ReturnType<typeof resolve>>, confirmed: boolean, failure?: ProjectError): Promise<AssigneeResult> {
  let ids: string[] | undefined
  if (expected.row && expected.intent && ['pending', 'unknown'].includes(expected.row.state) && !failure) try {
    const read = await expected.target.route.provider.getChangeRequestAssignees?.(expected.intent.input)
    if (read?.ok || read?.error.code === 'permission_denied') context.runtimeAccess.observeOperation(expected.target.intent.bindingId, CapabilityKey.DevelopmentChangeRequestAssigneeRead, scope.repositoryId, !read.ok, expected.version)
    if (read?.ok && JSON.stringify(read.value.changeRequest) === JSON.stringify(expected.intent.input.changeRequest) && Array.isArray(read.value.users) && read.value.users.every(u => text(u.id) && text(u.login))) ids = [...new Set(read.value.users.map(u => u.id))].sort()
  } catch { /* 只读恢复；部分成功不补写。 */ }
  let retry: Awaited<ReturnType<typeof resolve>> | undefined
  try { const result: AssigneeResult = await context.storage.transaction(async tx => {
    const current = await resolve(context, { ...scope, operationId: expected.row!.id }, tx, failure === undefined)
    if (!current.row || !current.intent || !failure && current.version !== expected.version) throw fail()
    const changed = receipt(current.row) !== receipt(expected.row!), saved = current.row.state === 'saved'
    const comparable = { ...current.row, state: expected.row!.state, errorCode: saved ? expected.row!.errorCode : current.row.errorCode, externalIntent: { ...current.intent, state: expected.intent!.state, confirmedIds: saved ? expected.intent!.confirmedIds : current.intent.confirmedIds } }
    if (changed && (!(saved || expected.row!.state === 'pending' && current.row.state === 'unknown') || receipt(comparable) !== receipt(expected.row!))) throw fail()
    const state = saved || current.row.state === 'failed' ? current.row.state : ids && current.intent.input.assigneeIds.every(id => ids!.includes(id)) ? 'saved' : failure ? 'failed' : 'unknown'
    if (changed && !saved && !failure) retry = current
    else if (state !== current.row.state) await tx.putMutationAttempt({ ...current.row, state, errorCode: failure?.code, externalIntent: { ...current.intent, state, confirmedIds: state === 'saved' ? ids ?? current.intent.confirmedIds : [] } })
    const outcome: AssigneeResult = { phase: state === 'saved' ? confirmed && !changed ? 'confirmed' : 'reconciled' : state === 'failed' ? 'failed' : 'unknown', operationId: current.row.id, ...(failure && state === 'failed' ? { error: failure } : {}) }
    try { await gate(context, current.target, CapabilityKey.DevelopmentChangeRequestAssigneeRead, 'read', expected.version) } catch (error) { if (outcome.phase !== 'failed') throw error }
    return outcome
  }); return retry ? observe(context, scope, retry, false) : result } catch { return { phase: 'conflict', error: fail() } }
}
export async function resumeChangeRequestAssignees(context: CoreContext, input: AssigneeResume): Promise<AssigneeResult> {
  try { capture(input, [...keys, 'operationId', 'observer']); input = { ...input, observer: actor(input.observer) }; if (!text(input.operationId)) throw fail()
    const scope = { workItemId: input.workItemId, repositoryId: input.repositoryId, createOperationId: input.createOperationId }, expected = await context.storage.transaction(tx => resolve(context, { ...scope, operationId: input.operationId }, tx))
    if (!expected.row) throw fail(); return observe(context, scope, expected, false)
  } catch { return { phase: 'conflict', error: fail() } }
}
export async function addChangeRequestAssignees(context: CoreContext, input: AssigneeAdd): Promise<AssigneeResult> {
  let dispatch = false, addVersion = 0
  try {
    capture(input, [...keys, 'actor', 'idempotencyKey', 'assigneeIds']); const who = actor(input.actor); input = { ...input, actor: who, assigneeIds: [...input.assigneeIds] }
    if (!text(input.idempotencyKey) || !Array.isArray(input.assigneeIds) || input.assigneeIds.length > 10 || !input.assigneeIds.every(text)) throw fail()
    const assigneeIds = [...new Set(input.assigneeIds)].sort(), scope = { workItemId: input.workItemId, repositoryId: input.repositoryId, createOperationId: input.createOperationId }
    const expected = await context.storage.transaction(async tx => {
      const current = await resolve(context, scope, tx), target = current.target
      if (!assigneeIds.length) return current
      let intent: ChangeRequestAssigneeIntent = { operation: 'addChangeRequestAssignees', sequence: 1, state: 'pending', contextId: target.intent.contextId, ownerGeneration: target.intent.ownerGeneration, bindingId: target.intent.bindingId, worktree: target.intent.worktree, createOperationId: input.createOperationId, createReceipt: target.createReceipt, targetStamp: target.targetStamp, input: { repository: target.intent.input.repository, changeRequest: target.intent.confirmedRef!, assigneeIds }, confirmedIds: [] }
      const requestFingerprint = fingerprint(context.workspaceId, intent, who), existing = await tx.findMutationAttempt(context.workspaceId, input.idempotencyKey)
      if (existing) { if (existing.requestFingerprint !== requestFingerprint) throw fail(); return resolve(context, { ...scope, operationId: existing.id }, tx) }
      if (current.row && ['pending', 'unknown'].includes(current.row.state)) return current
      addVersion = await gate(context, target, CapabilityKey.DevelopmentChangeRequestAssigneeAdd, 'write')
      if (!target.route.provider.addChangeRequestAssignees) throw fail()
      const sequence = Math.max(0, ...(await tx.listMutationAttempts(context.workspaceId)).filter(r => r.externalIntent?.operation === 'addChangeRequestAssignees' && r.externalIntent.createOperationId === scope.createOperationId).map(r => (r.externalIntent as ChangeRequestAssigneeIntent).sequence)) + 1
      if (!Number.isSafeInteger(sequence)) throw fail()
      intent = { ...intent, sequence }
      const row: MutationAttemptRecord = { id: `assign-${hash(input.idempotencyKey)}`, workspaceId: context.workspaceId, bindingId: intent.bindingId, commandName: 'addChangeRequestAssignees', idempotencyKey: input.idempotencyKey, requestFingerprint, state: 'pending', expectedSourceVersion: undefined, errorCode: undefined, externalIntent: intent }
      await tx.putMutationAttempt(row); dispatch = true; return { target, version: current.version, row, intent }
    })
    if (!assigneeIds.length) return { phase: 'reconciled' }
    let failure: ProjectError | undefined
    if (dispatch) try { const result = await expected.target.route.provider.addChangeRequestAssignees!(expected.intent!.input)
      if (result.ok || result.error.code === 'permission_denied') context.runtimeAccess.observeOperation(expected.intent!.bindingId, CapabilityKey.DevelopmentChangeRequestAssigneeAdd, scope.repositoryId, !result.ok, addVersion)
      if (!result.ok && ['permission_denied', 'invalid_input', 'not_supported'].includes(result.error.code)) failure = projectError(result.error.code, result.error.message)
    } catch { /* 单次 dispatch 后只观察。 */ }
    return observe(context, scope, expected, dispatch, failure)
  } catch (error) { return { phase: (error as ProjectError).code === 'permission_denied' ? 'failed' : 'conflict', error: (error as ProjectError).code ? error as ProjectError : fail() } }
}
