import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { composeCore } from '@harness-projects/core'
import { registerRepository } from '../../packages/core/src/development-route.ts'
import { createFakeProviders, refOf } from '@harness-projects/provider-fake'
import { CapabilityKey as K, providerOk, providerErr, providerError } from '@harness-projects/capabilities'
const native = (id) => ({ namespace: 'fixture/pr', id }), repo = (id) => ({ namespace: 'fixture/repository', id })
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
export async function fixture() {
  const p = createFakeProviders(), planning = p.planning, dev = p.development, calls = []
  const flags = { denied: false, offline: false }, describe = (port, keys) => {
    const original = port.describeCapabilities.bind(port)
    port.describeCapabilities = async () => { const s = await original(); for (const key of keys) { s.capability[key] = 'available'; s.permission[key] = flags.denied ? 'unavailable' : 'available' } return s }
  }
  describe(planning, [K.PlanningIssueClosingLinksRead]); describe(dev, [K.DevelopmentChangeRequestNativeIdentityRead])
  let page = (input) => providerOk({ source: { project: input.project, membership: input.membership, issue: input.issue, repository: repo('alpha') }, items: [link()], nextCursor: undefined })
  planning.listIssueClosingLinks = async input => { calls.push('source'); return flags.denied ? providerErr(providerError('permission_denied', 'SECRET')) : flags.offline ? providerErr(providerError('unavailable', 'SECRET')) : page(input) }
  dev.getRepository = async ref => { calls.push('repo'); return providerOk({ ref, name: ref.externalId, sourceRepositoryIdentity: repo(ref.externalId === 'repo-beta' ? 'beta' : 'alpha') }) }
  dev.getChangeRequestByNativeIdentity = async ({ repository, identity }) => { calls.push('native'); return providerOk({ ref: { ...refOf(dev.gate.bindingId, 'change_request', 'resolved-' + identity.id), url: 'https://example.invalid/pull/1' }, nativeIdentity: identity, number: 1, title: 'actual ' + identity.id, body: '', state: 'open', sourceVersion: 'sha', headBranch: undefined, reviewState: 'unknown' }) }
  const core = await composeCore({ workspace: { name: 'Native observation' }, providers: p, clock: () => '2026-11-03T00:00:00.000Z' })
  const item = (await core.queries.listPlanningItems()).find(i => i.content.title === '规划项 issue-1'), scope = { workItemId: item.entityId }, workspaceId = (await core.queries.getWorkspaceMetadata()).workspace.id
  await p.storage.transaction(tx => registerRepository(tx, { entityId: () => crypto.randomUUID(), externalIdentityId: () => crypto.randomUUID() }, workspaceId, 'repo-alpha', [dev.gate.bindingId]))
  const link = (id = 'pr', repository = 'alpha') => ({ nativeIdentity: native(id), repository: { identity: repo(repository), name: repository }, number: 1, title: 'source ' + id, url: 'https://example.invalid/pull/1', state: 'open', isDraft: true, provenance: 'source_observed', relation: 'native_closing' })
  calls.length = 0
  return { p, core, scope, item, workspaceId, calls, flags, link, page: fn => { page = fn }, read: () => core.queries.getIssueClosingLinks(scope), refresh: () => core.commands.refreshIssueClosingLinks(scope) }
}
test('native reads work without execution context and query is pure; actual ack owns title/ref', async () => {
  const h = await fixture(), revision = await h.p.storage.currentRevision(h.workspaceId), relations = await h.p.storage.listRelations(h.workspaceId)
  assert.equal((await h.read()).state, 'unread')
  const value = await h.refresh(); assert.equal(value.state, 'complete'); assert.equal(value.links[0].title, 'actual pr'); assert.equal(value.links[0].repositoryName, 'alpha'); assert.equal(value.links[0].externalId, 'resolved-pr'); assert.equal(value.observedAt, '2026-11-03T00:00:00.000Z')
  h.calls.length = 0; assert.deepEqual(await h.read(), value); assert.deepEqual(h.calls, [])
  assert.equal(await h.core.queries.getExecutionContext({ ...h.scope, repositoryId: 'repo-alpha' }), undefined)
  assert.deepEqual(await h.p.storage.listRelations(h.workspaceId), relations); assert.equal(await h.p.storage.currentRevision(h.workspaceId), revision)
})
test('only terminal source proof proves zero; bad pages and loops stay partial without secrets', async () => {
  for (const fault of ['empty', 'proof', 'error', 'loop', 'foreign']) {
    const h = await fixture()
    h.page(input => { const source = { project: input.project, membership: input.membership, issue: input.issue, repository: repo('alpha') }
      if (fault === 'proof') source.issue = { ...source.issue, externalId: 'SECRET' }
      if (fault === 'error' && input.cursor) return providerErr(providerError('unavailable', 'SECRET'))
      return providerOk({ source, items: fault === 'foreign' ? [h.link('SECRET', 'outside')] : [], nextCursor: ['error', 'loop'].includes(fault) ? 'next' : undefined }) })
    const value = await h.refresh(); assert.equal(value.state, fault === 'empty' ? 'complete' : 'partial'); assert.deepEqual(value.links, []); assert.doesNotMatch(JSON.stringify(value), /SECRET|outside/)
  }
})
test('denial hides offline last known and old success; explicit actual read restores only native receipt', async () => {
  const h = await fixture(); await h.refresh(); h.flags.offline = true
  assert.equal((await h.refresh()).stale, true); assert.equal((await h.read()).links.length, 1); h.flags.offline = false
  const entered = gate(), release = gate(); h.page(async input => { entered.resolve(); await release.promise; return providerOk({ source: { ...input, repository: repo('alpha') }, items: [h.link()], nextCursor: undefined }) })
  const old = h.refresh(); await entered.promise; h.flags.denied = true
  assert.equal((await h.refresh()).state, 'denied'); release.resolve(); assert.deepEqual((await old).links, []); assert.deepEqual((await h.read()).links, [])
  h.flags.denied = false; assert.equal((await h.refresh()).state, 'complete'); assert.equal((await h.read()).links.length, 1)
})
test('latest started wins and primary/membership/repository A→B→A changes fence old replies', async () => {
  for (const mutation of ['race', 'primary', 'membership', 'repository']) {
    const h = await fixture(), entered = gate(), release = gate(); let round = 0
    h.page(async input => { const id = ++round === 1 ? 'old' : 'new'; if (id === 'old') { entered.resolve(); await release.promise } return providerOk({ source: { ...input, repository: repo('alpha') }, items: [h.link(id)], nextCursor: undefined }) })
    const old = h.refresh(); await entered.promise
    if (mutation === 'race') await h.refresh()
    else if (mutation === 'primary') { const identity = (await h.p.storage.listIdentitiesForEntity(h.scope.workItemId)).find(i => i.role === 'primary'); await h.p.storage.putExternalIdentity({ ...identity, role: 'historical' }); await h.p.storage.putExternalIdentity(identity) }
    else if (mutation === 'membership') { const m = (await h.p.storage.listMemberships(h.workspaceId, h.p.planning.state.projects[0].ref.externalId))[0]; await h.p.storage.putMembership({ ...m, contentExternalId: 'other' }); await h.p.storage.putMembership(m) }
    else { const projection = await h.p.storage.getPlanningProjection(h.workspaceId, h.scope.workItemId); await h.p.storage.putPlanningProjection(h.workspaceId, { ...projection, content: { contentKind: 'redacted', reason: 'permission_denied' } }); await h.p.storage.putPlanningProjection(h.workspaceId, projection) }
    release.resolve(); const value = await old; assert.equal(value.links.some(l => l.title === 'actual old'), false)
    if (mutation === 'race') assert.equal((await h.read()).links[0].title, 'actual new')
  }
})
test('dispatch rejects wrong primary, membership, redaction and policy before any target read', async () => {
  for (const fault of ['historical', 'binding', 'draft', 'membership', 'redacted', 'policy']) {
    const h = await fixture(), ids = await h.p.storage.listIdentitiesForEntity(h.scope.workItemId), primary = ids.find(i => i.role === 'primary')
    if (fault === 'historical') await h.p.storage.putExternalIdentity({ ...primary, role: 'historical' })
    if (fault === 'binding' || fault === 'draft') {
      await h.p.storage.putExternalIdentity({ ...primary, role: 'historical' })
      await h.p.storage.putExternalIdentity({ ...primary, id: crypto.randomUUID(), externalKind: fault === 'draft' ? 'draft' : 'issue', bindingId: fault === 'binding' ? h.p.development.gate.bindingId : primary.bindingId })
    }
    if (fault === 'membership') { const m = (await h.p.storage.listMemberships(h.workspaceId, h.p.planning.state.projects[0].ref.externalId)).find(m => m.contentExternalId === primary.externalId); await h.p.storage.putMembership({ ...m, contentExternalId: 'other' }) }
    if (fault === 'redacted') { const projection = await h.p.storage.getPlanningProjection(h.workspaceId, h.scope.workItemId); await h.p.storage.putPlanningProjection(h.workspaceId, { ...projection, content: { contentKind: 'redacted', reason: 'permission_denied' } }) }
    if (fault === 'policy') { h.core = await composeCore({ workspace: { id: h.workspaceId, name: 'Policy' }, providers: h.p, policy: { [K.PlanningIssueClosingLinksRead]: 'unavailable' } }); h.refresh = () => h.core.commands.refreshIssueClosingLinks(h.scope) }
    h.calls.length = 0; const result = await h.refresh(); assert.deepEqual(result.links, []); assert.equal(h.calls.includes('repo'), false); assert.equal(h.calls.includes('native'), false)
  }
})
test('same-number PRs in separate canonical repositories stay separate and duplicate consistency is checked', async () => {
  const h = await fixture()
  await h.p.storage.transaction(tx => registerRepository(tx, { entityId: () => crypto.randomUUID(), externalIdentityId: () => crypto.randomUUID() }, h.workspaceId, 'repo-beta', [h.p.development.gate.bindingId]))
  for (const fault of ['none', 'duplicate', 'conflict', 'native', 'binding', 'repo']) {
    h.page(input => providerOk({ source: { ...input, repository: repo('alpha') }, items: [h.link('alpha'), h.link('beta', 'beta'), ...(fault === 'duplicate' ? [h.link('alpha')] : fault === 'conflict' ? [{ ...h.link('alpha'), title: 'changed' }] : [])] }))
    const actual = h.p.development.getChangeRequestByNativeIdentity
    if (fault === 'native' || fault === 'binding') h.p.development.getChangeRequestByNativeIdentity = async input => { const value = await actual(input); return providerOk({ ...value.value, ...(fault === 'native' ? { nativeIdentity: native('forged') } : { ref: { ...value.value.ref, bindingId: 'other' } }) }) }
    if (fault === 'repo') { const get = h.p.development.getRepository; h.p.development.getRepository = async input => providerOk({ ...(await get(input)).value, ref: { ...input, bindingId: 'other' } }) }
    const value = await h.refresh(); assert.equal(value.state, ['none', 'duplicate'].includes(fault) ? 'complete' : 'partial')
    if (value.state === 'complete') assert.deepEqual(value.links.map(l => [l.repositoryId, l.number]), [['repo-alpha', 1], ['repo-beta', 1]])
    h.p.development.getChangeRequestByNativeIdentity = actual
  }
})
test('all page boundaries refuse confirmed zero and registered repository revocation fences pending target', async () => {
  for (const fault of ['null', 'missing', 'cursor', 'budget']) {
    const h = await fixture(); let pages = 0
    h.page(input => { pages++; return providerOk(fault === 'missing' ? undefined : { source: { ...input, repository: repo('alpha') }, items: fault === 'null' ? [null] : [], nextCursor: fault === 'budget' ? 'cursor-' + pages : fault === 'cursor' ? '' : undefined }) })
    const value = await h.refresh(); assert.equal(value.state, 'partial'); assert.deepEqual(value.links, []); assert.ok(pages <= 100)
  }
  const h = await fixture(), entered = gate(), release = gate(), actual = h.p.development.getChangeRequestByNativeIdentity
  h.p.development.getChangeRequestByNativeIdentity = async input => { const value = await actual(input); entered.resolve(); await release.promise; return value }
  const pending = h.refresh(); await entered.promise
  const ref = await h.p.storage.findExternalIdentity(h.p.development.gate.bindingId, 'repository', 'repo-alpha'); await h.p.storage.putExternalIdentity({ ...ref, role: 'historical' })
  release.resolve(); assert.deepEqual((await pending).links, []); assert.deepEqual((await h.read()).links, [])
})
test('delivery denial invalidates native receipt; native recovery does not clear persisted delivery health', async () => {
  const h = await fixture(); await h.refresh()
  const key = K.DevelopmentRepositoryRead, scopeKey = JSON.stringify(['delivery.read', key, 'repo-alpha'])
  await h.p.storage.putSyncCursor({ workspaceId: h.workspaceId, bindingId: h.p.development.gate.bindingId, scopeKey,
    state: 'degraded', lastErrorCode: 'permission_denied', cursorValue: JSON.stringify({ version: 1, denialVersion: 1, confirmedVersion: 0, denied: true, scopes: [], pending: 0 }) })
  assert.deepEqual((await h.read()).links, [])
  const health = await h.p.storage.getSyncCursor(h.workspaceId, h.p.development.gate.bindingId, scopeKey)
  assert.equal((await h.refresh()).state, 'complete')
  assert.deepEqual(await h.p.storage.getSyncCursor(h.workspaceId, h.p.development.gate.bindingId, scopeKey), health)
  const recomposed = await composeCore({ workspace: { id: h.workspaceId, name: 'Restart' }, providers: h.p })
  assert.equal((await recomposed.queries.getIssueClosingLinks(h.scope)).state, 'unread')
})
test('deadline is partial and a denial observed after an incomplete read hides earlier authorized facts', async t => {
  const h = await fixture(), entered = gate()
  h.page(() => { entered.resolve(); return new Promise(() => {}) })
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const pending = h.refresh(); await entered.promise; t.mock.timers.tick(10001)
  assert.equal((await pending).state, 'partial'); t.mock.timers.reset()
  let pages = 0; h.page(input => { if (++pages === 2) { h.flags.denied = true; return providerErr(providerError('unavailable', 'SECRET')) } return providerOk({ source: { ...input, repository: repo('alpha') }, items: [h.link()], nextCursor: 'second' }) })
  const value = await h.refresh(); assert.equal(value.state, 'denied'); assert.deepEqual(value.links, [])
})
test('each source page must prove the same canonical Issue repository', async () => {
  const h = await fixture()
  await h.p.storage.transaction(tx => registerRepository(tx, { entityId: () => crypto.randomUUID(), externalIdentityId: () => crypto.randomUUID() }, h.workspaceId, 'repo-beta', [h.p.development.gate.bindingId]))
  h.page(input => providerOk({ source: { ...input, repository: repo(input.cursor ? 'beta' : 'alpha') }, items: [], nextCursor: input.cursor ? undefined : 'page2' }))
  assert.equal((await h.refresh()).state, 'partial')
})

test('empty or malformed actual repository names cannot become display facts', async () => {
  for (const name of ['', '   ', undefined, null, 7]) {
    const h = await fixture(), get = h.p.development.getRepository
    h.p.development.getRepository = async input => providerOk({ ...(await get(input)).value, name })
    const value = await h.refresh(); assert.equal(value.state, 'partial'); assert.deepEqual(value.links, [])
  }
})

test('canonical repositories with the same short name retain qualified source labels', async () => {
  const h = await fixture(), get = h.p.development.getRepository
  await h.p.storage.transaction(tx => registerRepository(tx, { entityId: () => crypto.randomUUID(), externalIdentityId: () => crypto.randomUUID() }, h.workspaceId, 'repo-beta', [h.p.development.gate.bindingId]))
  h.p.development.getRepository = async input => providerOk({ ...(await get(input)).value, name: 'project' })
  h.page(input => providerOk({ source: { ...input, repository: repo('alpha') }, items: [
    { ...h.link('alpha'), repository: { identity: repo('alpha'), name: 'owner-a/project' } },
    { ...h.link('beta', 'beta'), repository: { identity: repo('beta'), name: 'owner-b/project' } },
  ] }))
  const value = await h.refresh(); assert.equal(value.state, 'complete')
  assert.deepEqual(value.links.map(link => link.repositoryName), ['owner-a/project', 'owner-b/project'])
})
