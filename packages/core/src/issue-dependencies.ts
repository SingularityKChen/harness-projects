/** 本次来源观察，不进入业务关系、持久化或 Planning 事实。 */
import { AccessLevel, CapabilityKey as K, effectiveCapabilities, type ProviderIssueDependency, type ProviderIssueDependenciesInput, type ProviderCapabilitySnapshot } from '@harness-projects/capabilities'
import type { EntityId } from '@harness-projects/domain'
import type { CoreContext } from './context.ts'
import { committedFence } from './runtime-access.ts'
import { issueSourceReadAccess, observeIssueTargetRead, observeIssueAuthority, issueAuthorityReadAccess } from './issue-closing-links.ts'
export interface IssueDependenciesScope { readonly workItemId: string }
export interface IssueDependencyStream {
  readonly state: 'unread' | 'complete' | 'partial' | 'denied' | 'unsupported' | 'unavailable'
  readonly items: readonly ProviderIssueDependency[]; readonly stale: boolean; readonly observedAt?: string
}
export interface IssueDependenciesObservation { readonly workItemId: string; readonly blockedBy: IssueDependencyStream; readonly blocking: IssueDependencyStream; readonly parent: IssueDependencyStream; readonly children: IssueDependencyStream }
class Refusal extends Error { readonly state: IssueDependencyStream['state']; constructor(state: IssueDependencyStream['state']) { super(state); this.state = state } }
const requests = new WeakMap<CoreContext, Map<string, number>>()
const refKey = (r: { bindingId: string; objectKind: string; externalId: string }) => JSON.stringify([r.bindingId, r.objectKind, r.externalId])
const KEYS = [K.PlanningItemRead, K.PlanningIssueDependenciesRead]
const empty = (state: IssueDependencyStream['state']): IssueDependencyStream => ({ state, items: [], stale: true })
async function source(context: CoreContext, workItemId: string) {
  const fence = committedFence(context.storage), epoch = context.runtimeAccess.epoch, access = await context.runtimeAccess.planning(context.storage)
  const binding = access.binding, project = context.projectRef, item = await context.storage.getPlanningProjection(context.workspaceId, workItemId as EntityId)
  if (access.masked || item?.content.contentKind === 'redacted') throw new Refusal('denied')
  if (!binding?.planning?.listIssueDependencies || !project || project.bindingId !== binding.ref.bindingId || project.objectKind !== 'project' || item?.content.contentKind !== 'work_item') throw new Refusal('unsupported')
  const mounts = (await context.storage.listProviderBindings(context.workspaceId)).filter(b => b.domain === 'planning' && b.enabled)
  if (mounts.length !== 1 || mounts[0]?.id !== binding.ref.bindingId) throw new Refusal('unsupported')
  const primary = (await context.storage.listIdentitiesForEntity(item.entityId)).find(i => i.role === 'primary')
  if (!primary || primary.externalKind !== 'issue' || primary.bindingId !== binding.ref.bindingId) throw new Refusal('unsupported')
  const member = (await context.storage.listMemberships(context.workspaceId, project.externalId)).find(m => m.contentKind === 'issue' && m.contentExternalId === primary.externalId)
  if (!member) throw new Refusal('unsupported')
  const input = { project: { ...project, url: undefined }, issue: { bindingId: primary.bindingId, objectKind: 'issue', externalId: primary.externalId, url: undefined }, membership: { bindingId: primary.bindingId, objectKind: 'project_item', externalId: member.itemExternalId, url: undefined } }
  const accountId = await context.storage.getProviderBindingAccount(binding.ref.bindingId), account = accountId && await context.storage.getConnectorAccount(accountId), config = await context.storage.getBindingConfiguration(binding.ref)
  if (fence !== committedFence(context.storage) || epoch !== context.runtimeAccess.epoch) throw new Refusal('unread')
  return { input, provider: binding.planning, stamp: JSON.stringify([context.workspaceId, binding.ref, binding.enabled, accountId, account, config, input, member, primary, context.policy, epoch]), fence, epoch }
}
function allowed(context: CoreContext, snapshot: ProviderCapabilitySnapshot, bindingId: string, probe = false) {
  if (snapshot.bindingId !== bindingId) throw new Refusal('unread')
  const effective = effectiveCapabilities(probe ? { ...snapshot, permission: { ...snapshot.permission, ...Object.fromEntries(KEYS.map(k => [k, snapshot.capability[k]])) } } : snapshot, context.policy)
  for (const key of KEYS) if (!effective.some(e => e.key === key && e.access !== AccessLevel.Unavailable)) {
    if (!issueAuthorityReadAccess(context, bindingId, [key]).denied) observeIssueAuthority(context, bindingId, key, true)
    throw new Refusal(snapshot.capability[key] && snapshot.permission[key] === AccessLevel.Unavailable ? 'denied' : 'unsupported')
  }
}
function valid(item: ProviderIssueDependency) {
  return item?.nativeIdentity?.namespace === 'github.com/graphql/Issue' && typeof item.nativeIdentity.id === 'string' && !!item.nativeIdentity.id.trim()
    && item.repository?.identity?.namespace === 'github.com/graphql/Repository' && typeof item.repository.identity.id === 'string' && !!item.repository.identity.id.trim()
    && /^[\w.-]+\/[\w.-]+$/.test(item.repository.name) && Number.isSafeInteger(item.number) && item.number > 0 && typeof item.title === 'string'
    && ['open', 'closed'].includes(item.state) && item.url === `https://github.com/${item.repository.name}/issues/${item.number}` && new URL(item.url).href === item.url
}
export async function refreshIssueDependencies(context: CoreContext, scope: IssueDependenciesScope): Promise<IssueDependenciesObservation> {
  const workItemId = scope.workItemId, output = (stream: IssueDependencyStream): IssueDependenciesObservation => ({ workItemId, blockedBy: stream, blocking: stream, parent: stream, children: stream })
  let owned = requests.get(context); if (!owned) { owned = new Map(); requests.set(context, owned) }
  const ordinal = (owned.get(workItemId) ?? 0) + 1; owned.set(workItemId, ordinal)
  const deadline = Date.now() + 10000, authority = issueAuthorityReadAccess(context, '', [])
  let captured: Awaited<ReturnType<typeof source>>
  const bounded = async <T>(read: () => Promise<T>): Promise<T> => {
    if (Date.now() >= deadline) throw new Refusal('partial')
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Refusal('partial')), Math.max(0, deadline - Date.now())) })]) }
    finally { clearTimeout(timer) }
  }
  const current = async () => {
    const next = await bounded(() => source(context, workItemId)), proof = issueAuthorityReadAccess(context, '', [])
    if (next.stamp !== captured.stamp || next.fence !== captured.fence || owned.get(workItemId) !== ordinal || proof.generation !== authority.generation
      || proof.epoch !== authority.epoch || proof.receipt !== authority.receipt) throw new Refusal('unread')
    if (Date.now() >= deadline) throw new Refusal('partial')
  }
  const check = async (probe = false) => {
    const snapshot = await bounded(() => captured.provider.describeCapabilities())
    await current(); allowed(context, snapshot, captured.input.issue.bindingId, probe)
  }
  try {
    captured = await bounded(() => source(context, workItemId))
    await check(true)
    const ticket = issueSourceReadAccess(context, captured.input)
    const streams: IssueDependencyStream[] = []; let repository: string | undefined
    for (const direction of ['blocked_by', 'blocking', 'parent', 'children'] as const) {
      let cursor: string | undefined, completed = false, pages = 0
      const items: ProviderIssueDependency[] = [], cursors = new Set<string>(), seen = new Set<string>()
      try {
        for (let page = 0; page < 10; page++) {
          await current()
          const input: ProviderIssueDependenciesInput = { ...structuredClone(captured.input), direction, cursor, limit: direction === 'parent' ? 1 : 100 }
          const data = await bounded(async () => {
            const result = await captured.provider.listIssueDependencies!(input)
            if (!result.ok) {
              if (['permission_denied', 'not_found', 'not_supported'].includes(result.error.code)) {
                const now = Date.now() >= deadline ? captured : await bounded(() => source(context, workItemId))
                if (now.stamp === captured.stamp && now.fence === captured.fence
                  && captured.fence === committedFence(context.storage) && captured.epoch === context.runtimeAccess.epoch) {
                  if (result.error.code !== 'not_found') observeIssueAuthority(context, captured.input.issue.bindingId, K.PlanningIssueDependenciesRead, true)
                  else observeIssueTargetRead(context, captured.input, true)
                }
              }
              throw new Refusal(result.error.code === 'permission_denied' ? 'denied' : result.error.code === 'not_found' ? 'unread' : result.error.code === 'not_supported' ? 'unsupported' : 'unavailable')
            }
            return result.value
          })
          await check()
          if (!data?.source || ['project', 'membership', 'issue'].some(k => refKey(data.source[k as keyof typeof captured.input]) !== refKey(captured.input[k as keyof typeof captured.input])) || data.direction !== direction
            || data.source.repository?.namespace !== 'github.com/graphql/Repository' || typeof data.source.repository.id !== 'string' || !data.source.repository.id.trim() || !Array.isArray(data.items) || data.items.length > (direction === 'parent' ? 1 : 100) || direction === 'parent' && data.nextCursor !== undefined) throw new Refusal('partial')
          const sourceRepository = JSON.stringify(data.source.repository)
          if (repository !== undefined && repository !== sourceRepository) throw new Refusal('partial')
          repository = sourceRepository; pages++
          if (data.items.some(item => !valid(item))) { items.length = 0; throw new Refusal('partial') }
          for (const item of data.items) {
            const key = JSON.stringify([item.repository.identity.namespace, item.repository.identity.id, item.nativeIdentity.namespace, item.nativeIdentity.id])
            if (seen.has(key)) throw new Refusal('partial')
            seen.add(key)
            const identity = (v: { namespace: string; id: string }) => ({ namespace: v.namespace, id: v.id })
            items.push({ nativeIdentity: identity(item.nativeIdentity), repository: { identity: identity(item.repository.identity), name: item.repository.name },
              number: item.number, title: item.title, url: item.url, state: item.state })
          }
          if (data.nextCursor === undefined) { completed = true; break }
          if (typeof data.nextCursor !== 'string' || !data.nextCursor || cursors.has(data.nextCursor)) throw new Refusal('partial')
          cursors.add(data.nextCursor); cursor = data.nextCursor
        }
        streams.push({ state: completed ? 'complete' : 'partial', items, stale: !completed, ...(completed ? { observedAt: context.clock() } : {}) })
      } catch (error) {
        if (error instanceof Refusal && ['denied', 'unread', 'unsupported'].includes(error.state)) throw error
        streams.push(error instanceof Refusal && error.state === 'unavailable' && !pages ? empty('unavailable') : { state: 'partial', items, stale: true })
      }
    }
    await current()
    if (ticket.version !== issueSourceReadAccess(context, captured.input).version) throw new Refusal('unread')
    if (streams.every(stream => stream.state === 'complete')) {
      for (const key of KEYS) observeIssueAuthority(context, captured.input.issue.bindingId, key, false, authority)
      observeIssueTargetRead(context, captured.input, false, ticket.version)
    }
    if (issueAuthorityReadAccess(context, captured.input.issue.bindingId, KEYS).denied) throw new Refusal('denied')
    if (issueSourceReadAccess(context, captured.input).missing) throw new Refusal('unread')
    return { workItemId, blockedBy: streams[0]!, blocking: streams[1]!, parent: streams[2]!, children: streams[3]! }
  } catch (error) { return output(empty(error instanceof Refusal ? error.state : 'unavailable')) }
}
