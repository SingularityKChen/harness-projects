/** 本代 Host 的只读来源观察；不摄入业务关系或执行谱系，不以 native ack 恢复 delivery health。 */
import { AccessLevel, CapabilityKey as K, effectiveCapabilities, type CapabilityKey, type ExternalObjectRef, type ProviderCapabilitySnapshot, type ProviderIssueClosingLink, type ProviderResult } from '@harness-projects/capabilities'
import { type EntityId } from '@harness-projects/domain'
import type { CoreContext } from './context.ts'
import { selectDevelopment } from './development-route.ts'
import { committedFence } from './runtime-access.ts'
export interface IssueClosingLinksScope { readonly workItemId: string }
export interface IssueClosingLink {
  readonly repositoryId: string; readonly repositoryName: string; readonly bindingId: string; readonly externalId: string
  readonly number: number; readonly title: string; readonly url: string; readonly state: 'open' | 'closed' | 'merged'
  readonly isDraft: boolean; readonly provenance: 'source_observed'; readonly relation: 'native_closing'
}
export type IssueClosingLinksObservation = {
  readonly workItemId: string
  readonly scopeToken: string
} & (
  | { readonly state: 'unread' | 'denied' | 'unsupported' | 'unavailable'; readonly links: readonly []; readonly stale: true; readonly observedAt?: never }
  | { readonly state: 'complete' | 'partial'; readonly links: readonly IssueClosingLink[]; readonly stale: boolean; readonly observedAt: string }
)

type State = IssueClosingLinksObservation['state']
class Refusal extends Error { readonly state: State; constructor(state: State) { super(state); this.state = state } }
const owners = new WeakMap<CoreContext, { generation: string; serial: number; epoch: number; authority: Set<string>; missing: Set<string>; requests: Map<string, number>; cache: Map<string, { stamp: string; epoch: number; value: IssueClosingLinksObservation }> }>()
function owner(context: CoreContext) {
  let value = owners.get(context)
  if (!value) { value = { generation: crypto.randomUUID(), serial: 0, epoch: 0, authority: new Set(), missing: new Set(), requests: new Map(), cache: new Map() }; owners.set(context, value) }
  return value
}
/** 仅本代已观察的 native 准入变化；不泄漏 binding/ref，不借业务 revision 或旧 delivery health。 */
export function issueClosingLinksAccessVersion(context: CoreContext): string | undefined {
  const state = owners.get(context)
  return state?.epoch ? `${state.generation}:${state.epoch}` : undefined
}
function observeAuthority(context: CoreContext, bindingId: string, key: CapabilityKey, denied: boolean, proofEpoch?: number) {
  const state = owner(context), address = JSON.stringify([bindingId, key])
  if (denied && !state.authority.has(address)) { state.authority.add(address); state.epoch++ }
  // Pending dispatch 不是权限证明；只有本 epoch 已完成身份校验的 actual ack 能解除拒读 cohort。
  if (!denied && proofEpoch === state.epoch) state.authority.delete(address)
}
function observeResource(context: CoreContext, resource: string, missing: boolean, proofEpoch?: number) {
  const state = owner(context)
  if (missing && !state.missing.has(resource)) { state.missing.add(resource); state.epoch++ }
  if (!missing && proofEpoch === state.epoch) state.missing.delete(resource)
  while (state.missing.size > 100) state.missing.delete(state.missing.values().next().value!)
}

const refKey = (r: ExternalObjectRef | undefined) => JSON.stringify([r?.bindingId, r?.objectKind, r?.externalId])
const identityKey = (r: { namespace: string; id: string }) => JSON.stringify([r.namespace, r.id])
const validIdentity = (r: { namespace: string; id: string } | undefined): r is { namespace: string; id: string } => !!r && typeof r.namespace === 'string' && !!r.namespace.trim() && typeof r.id === 'string' && !!r.id.trim()
function empty(context: CoreContext, workItemId: string, state: State): IssueClosingLinksObservation {
  const common = { workItemId, scopeToken: `${owner(context).generation}:${owner(context).serial}` }
  return state === 'complete' || state === 'partial' ? { ...common, state, links: [], stale: state === 'partial', observedAt: context.clock() } : { ...common, state, links: [], stale: true }
}
async function scope(context: CoreContext, input: IssueClosingLinksScope) {
  for (;;) {
    const fence = committedFence(context.storage), epoch = `${context.runtimeAccess.epoch}:${context.runtimeAccess.deliveryEpoch}`
    const access = await context.runtimeAccess.planning(context.storage), binding = access.binding, project = context.projectRef
    const item = await context.storage.getPlanningProjection(context.workspaceId, input.workItemId as EntityId)
    if (access.masked || item?.content.contentKind === 'redacted') throw new Refusal('denied')
    if (!binding?.planning || !project || project.bindingId !== binding.ref.bindingId || project.objectKind !== 'project' || item?.content.contentKind !== 'work_item') throw new Refusal('unsupported')
    const primary = (await context.storage.listIdentitiesForEntity(item.entityId)).find(i => i.role === 'primary')
    if (!primary || primary.bindingId !== binding.ref.bindingId || primary.externalKind !== 'issue') throw new Refusal('unsupported')
    const member = (await context.storage.listMemberships(context.workspaceId, project.externalId)).find(m => m.contentKind === 'issue' && m.contentExternalId === primary.externalId)
    if (!member || !binding.planning.listIssueClosingLinks) throw new Refusal('unsupported')
    const issue: ExternalObjectRef = { bindingId: primary.bindingId, objectKind: 'issue', externalId: primary.externalId, url: undefined }
    const membership: ExternalObjectRef = { bindingId: primary.bindingId, objectKind: 'project_item', externalId: member.itemExternalId, url: undefined }
    const repositories = []
    for (const record of await context.storage.listRepositories(context.workspaceId)) {
      await context.runtimeAccess.syncDelivery(record.id)
      const route = await selectDevelopment({ ...context, registry: context.runtimeAccess.probeRegistry }, record.id, K.DevelopmentChangeRequestNativeIdentityRead)
      repositories.push({ id: record.id, route, version: context.runtimeAccess.deliveryVersion(record.id) })
    }
    if (fence !== committedFence(context.storage) || epoch !== `${context.runtimeAccess.epoch}:${context.runtimeAccess.deliveryEpoch}`) continue
    const stamp = JSON.stringify([context.workspaceId, refKey(project), refKey(issue), refKey(membership), member, context.policy, access.masked,
      repositories.map(r => [r.id, r.version, r.route.ok ? [refKey(r.route.repository), r.route.binding.capabilities] : false]), context.runtimeAccess.epoch])
    return { stamp, fence, epoch: owner(context).epoch, binding, planning: binding.planning, project, issue, membership, repositories }
  }
}
export async function getIssueClosingLinks(context: CoreContext, input: IssueClosingLinksScope): Promise<IssueClosingLinksObservation> {
  input = { workItemId: input.workItemId }
  try {
    const current = await scope(context, input), entry = owner(context).cache.get(input.workItemId)
    if (current.fence !== committedFence(context.storage) || current.epoch !== owner(context).epoch) return getIssueClosingLinks(context, input)
    if (entry?.stamp === current.stamp && entry.epoch === current.epoch) return structuredClone(entry.value)
    owner(context).cache.delete(input.workItemId); return empty(context, input.workItemId, 'unread')
  } catch (error) { owner(context).cache.delete(input.workItemId); return empty(context, input.workItemId, error instanceof Refusal ? error.state : 'unavailable') }
}
async function bounded<T>(read: () => Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Refusal('partial')
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Refusal('partial')), remaining) })]) }
  finally { clearTimeout(timer) }
}
function allowed(snapshot: ProviderCapabilitySnapshot, bindingId: string, keys: readonly CapabilityKey[], context: CoreContext, probe = false) {
  if (snapshot.bindingId !== bindingId) throw new Refusal('partial')
  const effective = effectiveCapabilities(probe ? { ...snapshot, permission: { ...snapshot.capability, [K.PlanningItemRead]: snapshot.permission[K.PlanningItemRead] ?? AccessLevel.Unavailable } } : snapshot, context.policy)
  for (const key of keys) if (!effective.some(e => e.key === key && e.access !== AccessLevel.Unavailable)) {
    observeAuthority(context, bindingId, key, true)
    throw new Refusal(snapshot.capability[key] && snapshot.permission[key] === AccessLevel.Unavailable ? 'denied' : 'unsupported')
  }
}
function result<T>(value: ProviderResult<T>, context: CoreContext, bindingId: string, key: CapabilityKey, resource: string): T {
  if (value.ok) return value.value
  // NOT_FOUND 是该资源明确不可见的回执，不是离线，也不宣称整个 binding 被拒读。
  if (value.error.code === 'not_found') { observeResource(context, resource, true); throw new Refusal('unread') }
  if (['permission_denied', 'not_supported'].includes(value.error.code)) observeAuthority(context, bindingId, key, true)
  throw new Refusal(value.error.code === 'permission_denied' ? 'denied' : value.error.code === 'not_supported' ? 'unsupported' : 'unavailable')
}
export async function refreshIssueClosingLinks(context: CoreContext, input: IssueClosingLinksScope): Promise<IssueClosingLinksObservation> {
  input = { workItemId: input.workItemId }
  const state = owner(context), request = ++state.serial, authorityEpoch = state.epoch
  state.requests.set(input.workItemId, request)
  while (state.requests.size > 100) state.requests.delete(state.requests.keys().next().value!)
  let captured: Awaited<ReturnType<typeof scope>> | undefined
  const facts: IssueClosingLink[] = []; let pagesRead = 0
  const deadline = Date.now() + 10000, read = <T>(run: () => Promise<T>) => bounded(run, deadline)
  // 否定证据随实际响应观察；deadline 只限制等待与成功摄入，不能吞掉晚到拒读。
  const actual = <T>(run: () => Promise<ProviderResult<T>>, bindingId: string, key: CapabilityKey, resource: string) => read(async () => result(await run(), context, bindingId, key, resource))
  const checks: (() => Promise<void>)[] = []
  const current = async (acceptDenial = false) => {
    const next = await scope(context, input)
    if (next.fence !== committedFence(context.storage) || next.epoch !== state.epoch || !acceptDenial && next.epoch !== authorityEpoch || state.requests.get(input.workItemId) !== request || captured && (next.stamp !== captured.stamp || next.fence !== captured.fence || !acceptDenial && next.epoch !== captured.epoch)) throw new Refusal('unread')
    return next
  }
  try {
    captured = await current()
    const source = captured
    const sourceResource = JSON.stringify([refKey(source.project), refKey(source.membership), refKey(source.issue)])
    const check = async (provider: { describeCapabilities(): Promise<ProviderCapabilitySnapshot> }, bindingId: string, keys: readonly CapabilityKey[], probe = false) => {
      await read(async () => allowed(await provider.describeCapabilities(), bindingId, keys, context, probe)); await current()
    }
    checks.push(() => check(source.planning, source.binding.ref.bindingId, [K.PlanningItemRead, K.PlanningIssueClosingLinksRead]))
    await check(source.planning, source.binding.ref.bindingId, [K.PlanningItemRead, K.PlanningIssueClosingLinksRead], true)
    const repositories = new Map<string, { id: string; route: Extract<(typeof source.repositories)[number]['route'], { ok: true }> }>()
    const loadRepositories = async () => {
      for (const candidate of source.repositories) {
        if (!candidate.route.ok) continue
        const route = candidate.route
        if (!route.provider.getChangeRequestByNativeIdentity) continue
        const verify = () => check(route.provider, route.binding.ref.bindingId, [K.DevelopmentRepositoryRead])
        await check(route.provider, route.binding.ref.bindingId, [K.DevelopmentRepositoryRead, K.DevelopmentChangeRequestNativeIdentityRead], true)
        const ack = await actual(() => route.provider.getRepository({ ...route.repository }), route.binding.ref.bindingId, K.DevelopmentRepositoryRead, refKey(route.repository)); await current(); await check(route.provider, route.binding.ref.bindingId, [K.DevelopmentRepositoryRead])
        if (refKey(ack.ref) !== refKey(route.repository) || !validIdentity(ack.sourceRepositoryIdentity) || typeof ack.name !== 'string' || !ack.name.trim()) throw new Refusal('partial')
        const key = identityKey(ack.sourceRepositoryIdentity)
        if (repositories.has(key)) throw new Refusal('partial')
        observeAuthority(context, route.binding.ref.bindingId, K.DevelopmentRepositoryRead, false, authorityEpoch)
        observeResource(context, refKey(route.repository), false, authorityEpoch)
        repositories.set(key, { id: candidate.id, route }); checks.push(verify)
      }
    }
    const cursors = new Set<string>(), seen = new Map<string, string>(); let cursor: string | undefined, sourceRepository: string | undefined
    for (let page = 0; page < 100; page++) {
      await check(source.planning, source.binding.ref.bindingId, [K.PlanningItemRead, K.PlanningIssueClosingLinksRead], true)
      const data = await actual(() => source.planning.listIssueClosingLinks!({ project: { ...source.project }, membership: { ...source.membership }, issue: { ...source.issue }, cursor, limit: 100 }), source.binding.ref.bindingId, K.PlanningIssueClosingLinksRead, sourceResource)
      await current(); await checks[0]!(); pagesRead++
      if (!data?.source || refKey(data.source.project) !== refKey(source.project) || refKey(data.source.membership) !== refKey(source.membership) || refKey(data.source.issue) !== refKey(source.issue)
        || !validIdentity(data.source.repository) || !Array.isArray(data.items)) throw new Refusal('partial')
      const sourceKey = identityKey(data.source.repository)
      if (sourceRepository !== undefined && sourceKey !== sourceRepository) throw new Refusal('partial')
      sourceRepository = sourceKey
      for (const key of [K.PlanningItemRead, K.PlanningIssueClosingLinksRead]) observeAuthority(context, source.binding.ref.bindingId, key, false, authorityEpoch)
      observeResource(context, sourceResource, false, authorityEpoch)
      if (page === 0) await loadRepositories()
      if (!repositories.has(identityKey(data.source.repository))) throw new Refusal('partial')
      for (const link of data.items) {
        if (!validLink(link)) throw new Refusal('partial')
        const key = identityKey(link.nativeIdentity), prior = seen.get(key), encoded = JSON.stringify(link)
        if (prior !== undefined) { if (prior !== encoded) throw new Refusal('partial'); continue }
        seen.set(key, encoded)
        const target = repositories.get(identityKey(link.repository.identity))
        if (!target) throw new Refusal('partial')
        const route = target.route
        await check(route.provider, route.binding.ref.bindingId, [K.DevelopmentRepositoryRead, K.DevelopmentChangeRequestNativeIdentityRead], true)
        const targetResource = JSON.stringify([refKey(route.repository), key])
        const ack = await actual(() => route.provider.getChangeRequestByNativeIdentity!({ repository: { ...route.repository }, identity: { ...link.nativeIdentity } }), route.binding.ref.bindingId, K.DevelopmentChangeRequestNativeIdentityRead, targetResource)
        await current(); await check(route.provider, route.binding.ref.bindingId, [K.DevelopmentRepositoryRead, K.DevelopmentChangeRequestNativeIdentityRead])
        if (!validIdentity(ack.nativeIdentity) || identityKey(ack.nativeIdentity) !== key || ack.ref.bindingId !== route.binding.ref.bindingId || ack.ref.objectKind !== 'change_request'
          || !ack.ref.externalId?.trim() || ack.number !== link.number || typeof ack.title !== 'string' || !validUrl(ack.ref.url)) throw new Refusal('partial')
        observeAuthority(context, route.binding.ref.bindingId, K.DevelopmentChangeRequestNativeIdentityRead, false, authorityEpoch)
        observeResource(context, targetResource, false, authorityEpoch)
        checks.push(() => check(route.provider, route.binding.ref.bindingId, [K.DevelopmentRepositoryRead, K.DevelopmentChangeRequestNativeIdentityRead]))
        facts.push({ repositoryId: target.id, repositoryName: link.repository.name, bindingId: ack.ref.bindingId, externalId: ack.ref.externalId, number: ack.number, title: ack.title, url: ack.ref.url,
          state: link.state, isDraft: link.isDraft, provenance: 'source_observed', relation: 'native_closing' })
      }
      if (data.nextCursor === undefined) {
        for (const verify of checks) await verify()
        await current()
        if (source.fence !== committedFence(context.storage) || source.epoch !== state.epoch) throw new Refusal('unread')
        const value: IssueClosingLinksObservation = { workItemId: input.workItemId, scopeToken: `${state.generation}:${request}`, state: 'complete', links: facts, stale: false, observedAt: context.clock() }
        state.cache.set(input.workItemId, { stamp: source.stamp, epoch: source.epoch, value }); trim(state); return structuredClone(value)
      }
      if (typeof data.nextCursor !== 'string' || !data.nextCursor.trim() || cursors.has(data.nextCursor)) throw new Refusal('partial')
      cursors.add(data.nextCursor); cursor = data.nextCursor
    }
    throw new Refusal('partial')
  } catch (error) {
    if (state.requests.get(input.workItemId) !== request) return getIssueClosingLinks(context, input)
    const failure = error instanceof Refusal ? error.state : 'unavailable'
    let refusal = failure === 'unavailable' && pagesRead > 0 ? 'partial' : failure
    if (refusal === 'unread') { state.cache.delete(input.workItemId); return getIssueClosingLinks(context, input) }
    try { if (refusal === 'denied' || refusal === 'unsupported') captured = await current(true); else await current() } catch { state.cache.delete(input.workItemId); return getIssueClosingLinks(context, input) }
    if (refusal === 'partial' || refusal === 'unavailable') {
      try { for (const verify of checks) await verify() } catch (error) {
        if (error instanceof Refusal && ['denied', 'unsupported', 'unread'].includes(error.state)) refusal = error.state
      }
    }
    if (refusal === 'denied' || refusal === 'unsupported') {
      try { captured = await current(true) } catch { state.cache.delete(input.workItemId); return getIssueClosingLinks(context, input) }
    }
    if (refusal === 'unread' || captured?.fence !== committedFence(context.storage) || captured.epoch !== state.epoch) { state.cache.delete(input.workItemId); return getIssueClosingLinks(context, input) }
    const old = state.cache.get(input.workItemId)
    let value: IssueClosingLinksObservation
    if (refusal === 'unavailable' && old !== undefined && old.stamp === captured?.stamp && old.epoch === captured.epoch && (old.value.state === 'complete' || old.value.state === 'partial')) value = { ...old.value, stale: true }
    else if (refusal === 'partial') value = { workItemId: input.workItemId, scopeToken: `${state.generation}:${request}`, state: 'partial', links: facts, stale: true, observedAt: context.clock() }
    else value = empty(context, input.workItemId, refusal)
    if (captured) state.cache.set(input.workItemId, { stamp: captured.stamp, epoch: captured.epoch, value }); trim(state)
    return structuredClone(value)
  }
}
function trim(state: ReturnType<typeof owner>) { while (state.cache.size > 100) { const key = state.cache.keys().next().value!; state.cache.delete(key); state.requests.delete(key) } }
const validUrl = (value: unknown): value is string => { try { const url = new URL(value as string); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false } }
function validLink(link: ProviderIssueClosingLink) {
  return link && validIdentity(link.nativeIdentity) && validIdentity(link.repository?.identity) && typeof link.repository.name === 'string' && !!link.repository.name.trim() && Number.isSafeInteger(link.number) && link.number > 0 && typeof link.title === 'string'
    && validUrl(link.url) && ['open', 'closed', 'merged'].includes(link.state) && typeof link.isDraft === 'boolean' && link.provenance === 'source_observed' && link.relation === 'native_closing'
}
