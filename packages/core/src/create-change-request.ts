import { createHash } from 'node:crypto'
import { CapabilityKey, ProjectErrorCode, externalIntentSnapshot, projectError, type ChangeRequestExternalIntent, type DevelopmentProvider, type MutationAttemptRecord, type ProviderChangeRequest, type StorageTransaction } from '@harness-projects/capabilities'
import { EntityKind, type EntityId, type ProjectError } from '@harness-projects/domain'
import { chainNode, worktreeEntityId } from './chain-facts.ts'
import { matchesPrTarget as matchesTarget } from './change-request-target.ts'
import type { CoreContext } from './context.ts'
import { repositoryReferences, selectDevelopment, type DevelopmentRoute } from './development-route.ts'
import { contextIdFor } from './execution-context.ts'
import { changeRequestEntityId, ensureEntity, validNativeIdentity } from './identity.ts'
import { EdgeProvenance, recordEdges } from './relations.ts'
import { startTargetError } from './start-work.ts'
import { gateBinding } from './capabilities.ts'
import { refreshDeliveryFacts } from './delivery-facts.ts'

export interface PrScope { readonly workItemId: string; readonly repositoryId: string }
export interface PrOperationQuery extends PrScope { readonly operationId?: string }
export type PrOperationView = { readonly kind: 'none' } | { readonly kind: 'blocked'; readonly reason: 'unavailable' | 'ambiguous' | 'invalid_operation' }
  | { readonly kind: 'operation'; readonly operationId: string; readonly state: MutationAttemptRecord['state']; readonly currentTarget: boolean; readonly targetStamp: string; readonly head: string; readonly base: string; readonly title: string; readonly draft: boolean }
type Actor = { readonly kind: string; readonly id?: string }
export interface CreateChangeRequestRequest extends PrScope { readonly base: string; readonly title: string; readonly body: string; readonly draft?: boolean; readonly actor: Actor; readonly idempotencyKey: string }
export interface ResumeChangeRequestRequest extends PrScope { readonly operationId: string; readonly observer: Actor }
export interface CreateChangeRequestResult {
  readonly phase: 'confirmed' | 'reconciled' | 'unknown' | 'conflict' | 'failed'
  readonly ref?: ProviderChangeRequest['ref']; readonly entityId?: EntityId; readonly error?: ProjectError; readonly lineageStale?: boolean
  readonly operationId?: string; readonly targetStamp?: string
}
type Route = Extract<DevelopmentRoute, { ok: true }>
type Operation = { attempt: MutationAttemptRecord; intent: ChangeRequestExternalIntent; route: Route; targetStamp: string; currentTarget: boolean }
type Resolution = { kind: 'resolved'; operation: Operation } | Exclude<PrOperationView, { kind: 'operation' }>
class RejectedRelation extends Error {}
const PREFIX = '<!-- harness-pr-operation:'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const stamp = (workspace: string, scope: PrScope, intent: ChangeRequestExternalIntent) => hash(JSON.stringify([workspace, scope.workItemId, scope.repositoryId, intent.contextId, intent.ownerGeneration, intent.input.head, intent.worktree, intent.bindingId]))
const marker = (fingerprint: string, key: string) => `${PREFIX}${hash(JSON.stringify([fingerprint, key]))} -->`
const invalid = () => projectError(ProjectErrorCode.InvalidInput, 'PR 请求或持久操作不合契约')
const outcome = (phase: CreateChangeRequestResult['phase'], error?: ProjectError, operation?: Operation): CreateChangeRequestResult => ({ phase, ...(error === undefined ? {} : { error }), ...(operation === undefined ? {} : { operationId: operation.attempt.id, targetStamp: operation.targetStamp }) })
function plain(value: object, keys: readonly string[]): void {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !keys.includes(key) || Object.getOwnPropertyDescriptor(value, key)?.get !== undefined)) throw invalid()
}
const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
function actorSnapshot(actor: Actor): Actor {
  plain(actor, ['kind', 'id'])
  const { kind, id } = actor
  if (!text(kind) || (id !== undefined && typeof id !== 'string')) throw invalid()
  return { kind, ...(id === undefined ? {} : { id }) }
}
function canonical(workspace: string, actor: Actor, intent: ChangeRequestExternalIntent, body: string): string {
  return JSON.stringify({ command: 'createChangeRequest', version: 1, workspace, actor, repository: intent.input.repository, binding: intent.bindingId,
    contextId: intent.contextId, generation: intent.ownerGeneration, head: intent.input.head, worktree: intent.worktree, base: intent.input.base, title: intent.input.title, body, draft: intent.input.draft })
}
async function readRoute(context: CoreContext, storage: StorageTransaction, scope: PrScope, bindingId?: string): Promise<Route> {
  const repo = (await storage.listRepositories(context.workspaceId)).find((repo) => repo.id === scope.repositoryId)
  if (repo === undefined || await startTargetError({ ...context, storage }, scope.workItemId) !== undefined) throw invalid()
  const selected = bindingId === undefined ? await selectDevelopment({ ...context, storage }, scope.repositoryId, CapabilityKey.DevelopmentChangeRequestCreate) : undefined
  const binding = bindingId === undefined ? selected?.ok ? selected.binding : undefined : context.registry.bindings.find((binding) => binding.ref.bindingId === bindingId && binding.ref.workspaceId === context.workspaceId && binding.ref.domain === 'development' && binding.enabled)
  if (binding?.development === undefined || !(await storage.listProviderBindings(context.workspaceId)).some((row) => row.id === binding.ref.bindingId && row.enabled)
    || (await repositoryReferences(storage, repo, [binding.ref.bindingId])).length !== 1) throw invalid()
  for (const key of [CapabilityKey.DevelopmentRepositoryRead, CapabilityKey.DevelopmentChangeRequestRead]) {
    const gate = gateBinding(binding, key, 'read')
    if (!gate.allowed) throw gate.error
  }
  return { ok: true, binding, provider: binding.development, repository: { bindingId: binding.ref.bindingId, objectKind: 'repository', externalId: scope.repositoryId, url: undefined } }
}
/** 同一个本地 resolver 服务发现、恢复及最后短事务；从不调用 Provider。 */
async function resolveOperation(context: CoreContext, query: PrOperationQuery, storage: StorageTransaction = context.storage): Promise<Resolution> {
  try { plain(query, ['workItemId', 'repositoryId', 'operationId']); if (!text(query.workItemId) || !text(query.repositoryId) || (query.operationId !== undefined && !text(query.operationId))) throw invalid() } catch { return { kind: 'blocked', reason: 'invalid_operation' } }
  if (await startTargetError({ ...context, storage }, query.workItemId) !== undefined || !(await storage.listRepositories(context.workspaceId)).some((repo) => repo.id === query.repositoryId)) return { kind: 'blocked', reason: 'unavailable' }
  try {
    const contextId = contextIdFor(context.workspaceId, query.workItemId, query.repositoryId), rows = await storage.listMutationAttempts(context.workspaceId), record = await storage.getExecutionContext(contextId)
    const candidates = rows.filter((row) => query.operationId === undefined ? row.commandName === 'createChangeRequest' && row.externalIntent?.contextId === contextId
      && (['pending', 'unknown'].includes(row.state) || (row.state === 'saved' && row.externalIntent.operation === 'createChangeRequest' && matchesTarget(context.workspaceId, query, record, row.externalIntent))) : row.id === query.operationId)
    if (candidates.length !== 1) {
      if (candidates.length > 1) return { kind: 'blocked', reason: 'ambiguous' }
      try { await readRoute(context, storage, query); return { kind: 'none' } } catch { return { kind: 'blocked', reason: 'unavailable' } }
    }
    const attempt = candidates[0]!, intent = attempt.externalIntent === undefined ? undefined : externalIntentSnapshot(attempt.externalIntent)
    if (attempt.commandName !== 'createChangeRequest' || attempt.workspaceId !== context.workspaceId || intent?.operation !== 'createChangeRequest' || intent.contextId !== contextId
      || intent.bindingId !== attempt.bindingId || intent.input.repository.bindingId !== attempt.bindingId || intent.input.repository.externalId !== query.repositoryId
      || (attempt.errorCode !== undefined && !Object.values(ProjectErrorCode).includes(attempt.errorCode)) || intent.state !== attempt.state || attempt.id !== `pr-${hash(attempt.idempotencyKey)}` || (intent.confirmedRef !== undefined && intent.confirmedRef.bindingId !== intent.bindingId) || !text(attempt.requestFingerprint) || !text(attempt.idempotencyKey) || (attempt.state === 'saved' && intent.confirmedRef === undefined)) throw invalid()
    const fingerprint = attempt.requestFingerprint, suffix = `\n${marker(fingerprint, attempt.idempotencyKey)}`, body = intent.input.body.slice(0, -suffix.length)
    const actor = actorSnapshot(JSON.parse(fingerprint).actor)
    if (!intent.input.body.endsWith(suffix) || body.includes(PREFIX) || canonical(context.workspaceId, actor, intent, body) !== fingerprint) throw invalid()
    let route: Route
    try { route = await readRoute(context, storage, query, attempt.bindingId) } catch { return { kind: 'blocked', reason: 'unavailable' } }
    const targetStamp = stamp(context.workspaceId, query, intent)
    const currentTarget = matchesTarget(context.workspaceId, query, record, intent)
    return { kind: 'resolved', operation: { attempt, intent, route, targetStamp, currentTarget } }
  } catch { return { kind: 'blocked', reason: 'invalid_operation' } }
}
export async function getChangeRequestOperation(context: CoreContext, query: PrOperationQuery): Promise<PrOperationView> {
  try {
    const resolved = await context.storage.transaction((tx) => resolveOperation(context, query, tx))
    if (resolved.kind !== 'resolved') return resolved
    const { attempt, intent, currentTarget, targetStamp } = resolved.operation
    return { kind: 'operation', operationId: attempt.id, state: attempt.state, currentTarget, targetStamp, head: intent.input.head, base: intent.input.base, title: intent.input.title, draft: intent.input.draft }
  } catch { return { kind: 'blocked', reason: 'unavailable' } }
}
/** 可变 Draft 状态不能排除同 marker 的身份候选，否则会掩盖歧义。 */
const identityCandidate = (pr: ProviderChangeRequest, intent: ChangeRequestExternalIntent) => pr.ref.bindingId === intent.bindingId && pr.ref.objectKind === 'change_request' && text(pr.ref.externalId)
  && pr.headBranch === intent.input.head && pr.title === intent.input.title && pr.body === intent.input.body && validNativeIdentity(pr.nativeIdentity)
const provesCreation = (pr: ProviderChangeRequest, intent: ChangeRequestExternalIntent) => identityCandidate(pr, intent) && pr.isDraft === intent.input.draft
/** 观察器只接受读端口；没有 create 回调或未命中时 dispatch 的分支。 */
async function observe(provider: Pick<DevelopmentProvider, 'listChangeRequests' | 'getChangeRequest'>, intent: ChangeRequestExternalIntent): Promise<ProviderChangeRequest | undefined> {
  const seen = new Set<string>(), matches: ProviderChangeRequest[] = []
  let cursor: string | undefined
  for (let page = 0; page < 100; page++) {
    const result = await provider.listChangeRequests({ repository: intent.input.repository, headBranch: intent.input.head, cursor, limit: 50 })
    if (!result.ok || !Array.isArray(result.value.items)) return undefined
    for (const pr of result.value.items) if (identityCandidate(pr, intent)) matches.push(pr)
    cursor = result.value.nextCursor
    if (cursor === undefined) {
      if (matches.length !== 1 || !provesCreation(matches[0]!, intent) || (intent.confirmedRef !== undefined && intent.confirmedRef.externalId !== matches[0]!.ref.externalId)) return undefined
      const exact = await provider.getChangeRequest(matches[0]!.ref)
      return exact.ok && provesCreation(exact.value, intent) && exact.value.ref.externalId === matches[0]!.ref.externalId ? exact.value : undefined
    }
    if (!text(cursor) || seen.has(cursor)) return undefined
    seen.add(cursor)
  }
  return undefined
}
function required(resolved: Resolution): Operation {
  if (resolved.kind !== 'resolved' || !resolved.operation.currentTarget) throw projectError(ProjectErrorCode.Conflict, 'PR 目标、授权或持久操作已变化')
  return resolved.operation
}
const receipt = (operation: Operation) => JSON.stringify([operation.attempt.id, operation.attempt.workspaceId, operation.attempt.bindingId, operation.attempt.commandName, operation.attempt.idempotencyKey, operation.attempt.state, operation.attempt.expectedSourceVersion, operation.attempt.errorCode, operation.attempt.requestFingerprint, operation.intent])
/** 刷新保持在 Core；最后一个 awaited 短事务同时读取授权、target、receipt 和获胜 PR 快照。 */
async function finish(context: CoreContext, scope: PrScope, expected: Operation, phase: 'confirmed' | 'reconciled', refresh: boolean): Promise<CreateChangeRequestResult> {
  if (refresh) try { await refreshDeliveryFacts(context, scope) } catch { /* 保留 Saved；最后快照如实报告陈旧。 */ }
  try {
    return await context.storage.transaction(async (tx) => {
      const operation = required(await resolveOperation(context, { ...scope, operationId: expected.attempt.id }, tx)), { attempt, intent } = operation
      if (attempt.state !== 'saved') return outcome(attempt.state === 'failed' ? 'failed' : attempt.state === 'conflict' ? 'conflict' : 'unknown', projectError(attempt.errorCode ?? ProjectErrorCode.ResultUnknown, 'PR 尚未确认，请恢复原操作'), operation)
      const ref = intent.confirmedRef!, identity = await tx.findExternalIdentity(ref.bindingId, 'change_request', ref.externalId)
      if (identity === undefined) return outcome('unknown', projectError(ProjectErrorCode.ResultUnknown, 'PR 身份尚未确认'), operation)
      const set = (await tx.getDeliveryFacts(context.workspaceId, intent.contextId))?.sets.find((set) => set.kind === 'change_request')
      const lineageStale = set?.stale !== false || set.confirmedAt === undefined || set.anchorId !== worktreeEntityId(context.workspaceId, scope.repositoryId, scope.workItemId)
        || !set.nodes.some((node) => node.entityId === identity.entityId && node.externalId === ref.externalId)
      return { ...outcome(receipt(operation) === receipt(expected) ? phase : 'reconciled', undefined, operation), ref, entityId: identity.entityId, lineageStale }
    })
  } catch { return outcome('conflict', projectError(ProjectErrorCode.Conflict, '当前 PR 目标或读取授权已变化'), expected) }
}
async function settle(context: CoreContext, scope: PrScope, expected: Operation, found: ProviderChangeRequest | undefined, failure?: ProjectError, dispatched = false): Promise<CreateChangeRequestResult> {
  let refresh = false, operation = expected, retry: Operation | undefined
  try {
    operation = await context.storage.transaction(async (tx) => {
      const current = required(await resolveOperation(context, { ...scope, operationId: expected.attempt.id }, tx))
      if (receipt(current) !== receipt(expected) || current.attempt.state === 'saved') {
        if (found !== undefined && ['pending', 'unknown'].includes(current.attempt.state)) retry = current
        return current
      }
      if (found !== undefined) {
        const entityId = await ensureEntity(tx, { bindingId: found.ref.bindingId, externalKind: 'change_request', externalId: found.ref.externalId }, EntityKind.ChangeRequest, context.ids, changeRequestEntityId(found.ref, found.nativeIdentity), found.nativeIdentity !== undefined)
        const worktreeId = worktreeEntityId(context.workspaceId, scope.repositoryId, scope.workItemId)
        await tx.putEntity({ id: worktreeId, kind: EntityKind.Worktree })
        const edges = await recordEdges({ workspaceId: context.workspaceId, storage: tx }, [{ from: entityId, to: worktreeId, type: 'produced_by', provenance: EdgeProvenance.Command, artifact: chainNode(entityId, EntityKind.ChangeRequest, found.ref.externalId, found.title, true) }])
        if (edges.some(({ relation }) => relation.state !== 'confirmed' || relation.source !== 'explicit')) throw new RejectedRelation('精确 PR 关系已被拒绝')
      }
      const state = found !== undefined ? 'saved' : failure !== undefined ? 'failed' : 'unknown'
      await tx.putMutationAttempt({ ...current.attempt, state, errorCode: failure?.code, externalIntent: { ...current.intent, state, ...(found === undefined ? {} : { confirmedRef: { ...found.ref, url: undefined } }) } })
      refresh = found !== undefined
      return required(await resolveOperation(context, { ...scope, operationId: current.attempt.id }, tx))
    })
  } catch (error) { return outcome(error instanceof RejectedRelation ? 'conflict' : 'unknown', projectError(error instanceof RejectedRelation ? ProjectErrorCode.Conflict : ProjectErrorCode.ResultUnknown, 'PR 本地结算未确认'), expected) }
  if (retry !== undefined) return settle(context, scope, retry, found, failure, dispatched)
  return finish(context, scope, operation, dispatched && refresh ? 'confirmed' : 'reconciled', refresh)
}
export async function resumeChangeRequest(context: CoreContext, input: ResumeChangeRequestRequest): Promise<CreateChangeRequestResult> {
  let operation: Operation | undefined, scope: PrScope
  try {
    plain(input, ['workItemId', 'repositoryId', 'operationId', 'observer'])
    const { workItemId, repositoryId, operationId } = input
    if (![workItemId, repositoryId, operationId].every(text)) throw invalid()
    scope = { workItemId, repositoryId }; actorSnapshot(input.observer)
    const resolved = await resolveOperation(context, { ...scope, operationId })
    if (resolved.kind === 'resolved') operation = resolved.operation
    operation = required(resolved)
  } catch { return outcome('conflict', projectError(ProjectErrorCode.Conflict, 'PR 操作不可恢复'), operation) }
  if (operation.attempt.state === 'saved' || operation.attempt.state === 'failed' || operation.attempt.state === 'conflict') return finish(context, scope, operation, 'reconciled', false)
  let found: ProviderChangeRequest | undefined
  try { found = await observe(operation.route.provider, operation.intent) } catch { /* 未知只能继续读回。 */ }
  return settle(context, scope, operation, found)
}
/** 准入是唯一可达写端口的位置；已存请求统一走只读 observer。 */
export async function createChangeRequest(context: CoreContext, input: CreateChangeRequestRequest): Promise<CreateChangeRequestResult> {
  let request: CreateChangeRequestRequest, operation: Operation | undefined, dispatch = false
  try {
    plain(input, ['workItemId', 'repositoryId', 'base', 'title', 'body', 'draft', 'actor', 'idempotencyKey'])
    const { workItemId, repositoryId, base, title, body, draft, idempotencyKey } = input, actor = actorSnapshot(input.actor)
    if (![workItemId, repositoryId, base, title, idempotencyKey].every(text) || typeof body !== 'string' || (draft !== undefined && typeof draft !== 'boolean') || body.includes(PREFIX)) throw invalid()
    request = { workItemId, repositoryId, base, title, body, draft: draft ?? false, idempotencyKey, actor }
    const id = await context.storage.transaction(async (tx) => {
      const route = await readRoute(context, tx, request), contextId = contextIdFor(context.workspaceId, workItemId, repositoryId), record = await tx.getExecutionContext(contextId)
      if (record?.workspaceId !== context.workspaceId || record.workItemId !== workItemId || record.repositoryId !== repositoryId || !record.provisioningGeneration || !record.branchExternalId || !record.worktreeExternalId) throw invalid()
      const intent: ChangeRequestExternalIntent = { operation: 'createChangeRequest', contextId, ownerGeneration: record.provisioningGeneration, bindingId: route.binding.ref.bindingId, state: 'pending', worktree: record.worktreeExternalId, input: { repository: route.repository, head: record.branchExternalId, base, title, body, draft: draft ?? false } }
      const fingerprint = canonical(context.workspaceId, actor, intent, body), existing = await tx.findMutationAttempt(context.workspaceId, idempotencyKey)
        ?? (await tx.listMutationAttempts(context.workspaceId)).find((row) => row.commandName === 'createChangeRequest' && row.externalIntent?.contextId === contextId && row.externalIntent.operation === 'createChangeRequest' && row.externalIntent.input.head === intent.input.head && ['pending', 'unknown'].includes(row.state))
      if (existing !== undefined) { if (existing.commandName !== 'createChangeRequest' || existing.requestFingerprint !== fingerprint) throw projectError(ProjectErrorCode.Conflict, 'PR 幂等键或未决槽位已绑定另一个请求'); return existing.id }
      const gate = gateBinding(route.binding, CapabilityKey.DevelopmentChangeRequestCreate, 'write')
      if (!gate.allowed) throw gate.error
      const id = `pr-${hash(idempotencyKey)}`
      const finalIntent: ChangeRequestExternalIntent = { ...intent, input: { ...intent.input, body: `${body}\n${marker(fingerprint, idempotencyKey)}` } }
      const attempt: MutationAttemptRecord = { id, workspaceId: context.workspaceId, bindingId: intent.bindingId, commandName: 'createChangeRequest', idempotencyKey, state: 'pending', requestFingerprint: fingerprint, expectedSourceVersion: undefined, errorCode: undefined,
        externalIntent: finalIntent }
      await tx.putMutationAttempt(attempt)
      operation = { attempt, intent: finalIntent, route, targetStamp: stamp(context.workspaceId, request, intent), currentTarget: true }
      dispatch = true
      return id
    })
    const resolved = await resolveOperation(context, { workItemId, repositoryId, operationId: id })
    if (resolved.kind === 'resolved') operation = resolved.operation
    operation = required(resolved)
  } catch (error) {
    const code = (error as ProjectError).code
    return outcome(code === ProjectErrorCode.Conflict ? 'conflict' : 'failed', Object.values(ProjectErrorCode).includes(code) ? error as ProjectError : invalid(), operation)
  }
  if (!dispatch || operation.attempt.state === 'saved') return resumeChangeRequest(context, { workItemId: request.workItemId, repositoryId: request.repositoryId, operationId: operation.attempt.id, observer: request.actor })
  let found: ProviderChangeRequest | undefined, failure: ProjectError | undefined
  try {
    const created = await operation.route.provider.createChangeRequest?.(operation.intent.input)
    if (created?.ok && provesCreation(created.value, operation.intent)) found = created.value
    else if (created?.ok === false && ['permission_denied', 'invalid_input', 'not_supported'].includes(created.error.code)) failure = projectError(created.error.code, created.error.message)
  } catch { /* 单次 mutation 结果未知。 */ }
  return settle(context, { workItemId: request.workItemId, repositoryId: request.repositoryId }, operation, found, failure, true)
}
