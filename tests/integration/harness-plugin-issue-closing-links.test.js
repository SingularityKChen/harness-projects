import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { PROVIDER_CATALOG } from '../../apps/harness-plugin/src/host-providers.ts'
import { registerRepository } from '../../packages/core/src/development-route.ts'
import { createEntityStore, createSync } from '@harness-projects/client'
import { SqliteStorage } from '@harness-projects/storage-sqlite'
import { WORKSPACE, seed, seedWorkspace, seedPlanning, seedRepositoryMount, developmentFixture, githubFetch, REPOSITORY_MOUNTS, dump } from './fixtures/host-seed.js'
const actor = { kind: 'user' }, turn = () => new Promise(r => setImmediate(r))
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function open(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'native-host-')), dataPath = path.join(dir, 'workspace.sqlite'), requests = [], fallback = githubFetch()
  const repository = developmentFixture.exchanges.find(e => e.operationName === 'DevelopmentRepository').body.data.repository
  const rawPr = developmentFixture.exchanges.find(e => e.operationName === 'DevelopmentChangeRequest').body.data.node
  const flags = { deny: undefined, offline: false, pages: false, hold: undefined }
  await seed(dataPath, PROVIDER_CATALOG, async storage => {
    await seedWorkspace(storage); await seedPlanning(storage); await seedRepositoryMount(storage, 'development-native', 'development.github')
    await registerRepository(storage, { entityId: randomUUID, externalIdentityId: randomUUID }, WORKSPACE, REPOSITORY_MOUNTS['development.github'][1].repositoryExternalId, ['development-native'])
  })
  const fetch = async (url, init) => {
    const request = JSON.parse(init.body), { operationName: op, variables: v } = request; requests.push(request)
    assert.equal(init.method, 'POST'); assert.doesNotMatch(request.query, /mutation /)
    if (flags.intercept) { const response = await flags.intercept(request); if (response) return response }
    if (flags.offline) throw new Error('SECRET raw network detail')
    if (flags.deny === op) return new Response(JSON.stringify({ errors: [{ type: 'FORBIDDEN', message: 'SECRET' }] }), { status: 403 })
    if (op === 'PlanningIssueClosingLinks') {
      const payload = { data: { project: { __typename: 'ProjectV2', id: v.project }, membership: { __typename: 'ProjectV2Item', id: v.membership, type: 'ISSUE', project: { id: v.project }, content: { __typename: 'Issue', id: v.issue, repository } },
        issue: { __typename: 'Issue', id: v.issue, repository, closedByPullRequestsReferences: { nodes: v.after || flags.empty ? [] : [{ ...rawPr, repository, title: 'source only', isDraft: true }], pageInfo: { hasNextPage: flags.pages && !v.after, endCursor: flags.pages && !v.after ? 'page2' : null } } } } }
      if (flags.hold && (!flags.hold.operation || flags.hold.operation === op)) { const hold = flags.hold; flags.hold = undefined; hold.entered.resolve(); await hold.release.promise }
      return new Response(JSON.stringify(payload), { status: 200 })
    }
    const response = await fallback.fetch(url, init)
    if (flags.hold?.operation === op) { const hold = flags.hold; flags.hold = undefined; hold.entered.resolve(); await hold.release.promise }
    return response
  }
  const host = await createHostComposition({ dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, fetch, resolveCredential: async () => 'fixture-token', planningTimers: { setInterval: run => run, clearInterval() {} } })
  const installed = await installHostRemote({ invocation: { peer: { id: 'fixture' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  t.after(async () => { host.stop(); await installed.dispose(); await host.dispose(); await rm(dir, { recursive: true, force: true }) })
  const ids = (await installed.service.baseline()).entities.filter(e => e.content.contentKind === 'work_item' && e.content.externalKind === 'issue').map(e => e.entityId), id = ids[0]
  requests.length = 0
  return { host, service: installed.service, flags, requests, id, ids, dataPath, fallback, rawPr, repository }
}
test('production remote observes source pages and actual PR decoder without context or writes', async t => {
  const h = await open(t), before = dump(h.dataPath)
  assert.equal(typeof h.service.getIssueClosingLinks, 'function'); assert.equal((await h.service.getIssueClosingLinks(h.id)).observation.state, 'unread')
  for (const method of ['putExecutionContext', 'putExecutionRun', 'putRelation', 'putPlanningProjection', 'putMembership', 'putExternalIdentity', 'putRepository', 'putDeliveryFacts']) t.mock.method(SqliteStorage.prototype, method, () => { throw new Error('Business write forbidden: ' + method) })
  h.flags.pages = true
  const value = (await h.service.refreshIssueClosingLinks(actor, h.id)).value
  assert.equal(value.state, 'complete'); assert.equal(value.links[0].title, h.rawPr.title); assert.equal(value.links[0].repositoryName, h.repository.nameWithOwner); assert.equal(value.links[0].isDraft, true); assert.equal(value.stale, false)
  assert.deepEqual(h.requests.map(r => r.operationName).filter(op => op !== 'PlanningProject'), ['PlanningIssueClosingLinks', 'DevelopmentRepository', 'DevelopmentChangeRequest', 'PlanningIssueClosingLinks'])
  assert.deepEqual(h.requests.filter(r => r.operationName === 'PlanningIssueClosingLinks').map(r => r.variables.after), [null, 'page2'])
  h.requests.length = 0; assert.deepEqual((await h.service.getIssueClosingLinks(h.id)).observation, value); assert.deepEqual(h.requests, [])
  assert.deepEqual(dump(h.dataPath), before); assert.deepEqual(h.fallback.misses, [])
  await assert.rejects(() => h.host.call('refreshIssueClosingLinks', { actorRef: actor, workItemId: h.id, repositoryId: 'forged' }), TypeError)
  await assert.rejects(() => h.host.call('getIssueClosingLinks', { workItemId: h.id, issue: 'forged' }), TypeError)
})
test('source, repository and native PR actual denials hide last known and recover by actual reads', async t => {
  for (const operation of ['PlanningIssueClosingLinks', 'DevelopmentRepository', 'DevelopmentChangeRequest']) {
    const h = await open(t); assert.equal((await h.service.refreshIssueClosingLinks(actor, h.id)).value.state, 'complete')
    h.flags.offline = true; const stale = (await h.service.refreshIssueClosingLinks(actor, h.id)).value; assert.equal(stale.stale, true); assert.equal(stale.links.length, 1); h.flags.offline = false
    const hold = { entered: gate(), release: gate() }; h.flags.hold = hold
    const old = h.service.refreshIssueClosingLinks(actor, h.id); await hold.entered.promise
    h.flags.deny = operation; const denied = (await h.service.refreshIssueClosingLinks(actor, h.id)).value
    assert.equal(denied.state, 'denied'); assert.deepEqual(denied.links, []); assert.equal(JSON.stringify(denied).includes('"repositoryName"'), false); assert.doesNotMatch(JSON.stringify(denied), /SECRET|source only|PR_kw|pull\//)
    hold.release.resolve(); assert.deepEqual((await old).value.links, []); assert.deepEqual((await h.service.getIssueClosingLinks(h.id)).observation.links, [])
    h.flags.deny = undefined; h.requests.length = 0
    if (operation === 'DevelopmentChangeRequest') { h.flags.empty = true; const zero = (await h.service.refreshIssueClosingLinks(actor, h.id)).value; assert.equal(zero.state, 'complete'); assert.deepEqual(zero.links, []); h.flags.empty = false }
    assert.equal((await h.service.refreshIssueClosingLinks(actor, h.id)).value.state, 'complete')
    assert.ok(h.requests.some(r => r.operationName === 'DevelopmentRepository')); assert.ok(h.requests.some(r => r.operationName === 'DevelopmentChangeRequest'))
    assert.equal((await h.service.getExecutionContext(h.id, REPOSITORY_MOUNTS['development.github'][1].repositoryExternalId)).context, null)
  }
})
test('stopping Host during native read rejects the late result', async t => {
  const h = await open(t), hold = { entered: gate(), release: gate() }; h.flags.hold = hold
  const pending = h.service.refreshIssueClosingLinks(actor, h.id); await hold.entered.promise
  h.host.stop(); hold.release.resolve(); await assert.rejects(() => pending); await turn()
})

for (const operation of ['PlanningIssueClosingLinks', 'DevelopmentChangeRequest']) test('native authority denial fences other Issue receipts, pending reads and client metadata: ' + operation, async t => {
  const h = await open(t); assert.ok(h.ids.length > 1)
  assert.equal((await h.service.refreshIssueClosingLinks(actor, h.id)).value.state, 'complete')
  const base = await h.service.baseline(), watch = h.host.controller.watch({ afterRevision: base.revision, seed: base })
  const sync = createSync({ fetchBaseline: () => h.service.baseline(), poll: () => watch.poll(), close() {} }, createEntityStore())
  await sync.connect(); const before = sync.read().nativeAccessVersion
  const hold = { operation, entered: gate(), release: gate() }; h.flags.hold = hold
  const old = h.service.refreshIssueClosingLinks(actor, h.id); await hold.entered.promise
  h.flags.deny = operation; assert.equal((await h.service.refreshIssueClosingLinks(actor, h.ids[1])).value.state, 'denied')
  h.requests.length = 0
  assert.deepEqual((await h.service.getIssueClosingLinks(h.id)).observation.links, [], 'other Issue receipt must hide after a known native denial')
  const event = await watch.poll(); assert.equal(event.kind, 'metadata'); assert.equal(event.metadata.revision, base.revision)
  assert.notEqual(event.metadata.nativeAccessVersion, before); assert.match(event.metadata.nativeAccessVersion, /^[0-9a-f-]{36}:\d+$/)
  sync.receive(event); assert.equal(sync.read().nativeAccessVersion, event.metadata.nativeAccessVersion, 'accepted invalidation is synchronously visible to open UI targets')
  assert.deepEqual(h.requests, [], 'pure query, baseline and metadata must not describe or call providers')
  hold.release.resolve(); assert.deepEqual((await old).value.links, [], 'cross-Issue denial fences older pending success')
  const deniedVersion = sync.read().nativeAccessVersion
  assert.equal((await h.service.refreshIssueClosingLinks(actor, h.ids[1])).value.state, 'denied')
  assert.equal((await h.service.baseline()).nativeAccessVersion, deniedVersion, 'same denial is stable and cannot drive an auto-refresh loop')
  assert.equal(await watch.poll(), undefined)
  h.flags.deny = undefined; assert.equal((await h.service.refreshIssueClosingLinks(actor, h.ids[1])).value.state, 'complete')
  assert.deepEqual((await h.service.getIssueClosingLinks(h.id)).observation.links, [], 'B actual recovery cannot revive A old receipt')
  h.flags.offline = true; assert.deepEqual((await h.service.refreshIssueClosingLinks(actor, h.id)).value.links, [], 'offline cannot revive an invalidated receipt'); h.flags.offline = false
  assert.equal((await h.service.refreshIssueClosingLinks(actor, h.id)).value.state, 'complete', 'A explicit actual probe is its recovery')
  assert.equal((await h.service.baseline()).nativeAccessVersion, deniedVersion, 'recovery never reuses the pre-denial authority')
  h.flags.deny = operation; await h.service.refreshIssueClosingLinks(actor, h.ids[1])
  assert.notEqual((await h.service.baseline()).nativeAccessVersion, deniedVersion, 'a new denial after actual recovery fences the recovered receipt')
  assert.deepEqual((await h.service.getIssueClosingLinks(h.id)).observation.links, [])
})

for (const [operation, outcome] of ['PlanningIssueClosingLinks', 'DevelopmentChangeRequest'].flatMap(op => ['offline', 'success'].map(result => [op, result]))) test('a newer pre-denial probe never suppresses an older actual denial: ' + operation + '/' + outcome, async t => {
  const h = await open(t); assert.ok(h.ids.length >= 3)
  assert.equal((await h.service.refreshIssueClosingLinks(actor, h.ids[0])).value.state, 'complete')
  const olderEntered = gate(), olderRelease = gate(), newerEntered = gate(), newerRelease = gate(); let calls = 0
  h.flags.intercept = async request => {
    if (request.operationName !== operation) return undefined
    const count = ++calls
    if (count === 1) { olderEntered.resolve(); await olderRelease.promise; return new Response(JSON.stringify({ errors: [{ type: 'FORBIDDEN', message: 'SECRET' }] }), { status: 403 }) }
    if (count === 2) { newerEntered.resolve(); await newerRelease.promise; if (outcome === 'offline') throw new Error('simulated offline after dispatch') }
  }
  const older = h.service.refreshIssueClosingLinks(actor, h.ids[1]); await olderEntered.promise
  const newer = h.service.refreshIssueClosingLinks(actor, h.ids[2]); await newerEntered.promise
  olderRelease.resolve(); assert.equal((await older).value.state, 'denied')
  const version = (await h.service.baseline()).nativeAccessVersion, during = (await h.service.getIssueClosingLinks(h.ids[0])).observation
  newerRelease.resolve(); await newer
  assert.deepEqual(during.links, [], 'pending dispatch has no actual proof and cannot suppress a known403')
  assert.deepEqual((await h.service.getIssueClosingLinks(h.ids[0])).observation.links, [], 'a pre-denial probe cannot authorize an older receipt')
  assert.deepEqual((await h.service.getIssueClosingLinks(h.ids[2])).observation.links, [], 'even success dispatched before the denial cannot recover its old-epoch scope')
  assert.equal((await h.service.baseline()).nativeAccessVersion, version)
  h.flags.intercept = undefined; h.flags.deny = operation; await h.service.refreshIssueClosingLinks(actor, h.ids[1])
  assert.equal((await h.service.baseline()).nativeAccessVersion, version, 'repeated known denial stays stable')
  h.flags.deny = undefined; assert.equal((await h.service.refreshIssueClosingLinks(actor, h.ids[0])).value.state, 'complete', 'new-epoch actual proof restores only its scope')
  assert.deepEqual((await h.service.getIssueClosingLinks(h.ids[1])).observation.links, [])
  assert.equal((await h.service.baseline()).nativeAccessVersion, version, 'actual recovery never rolls version backward')
})

for (const operation of ['PlanningIssueClosingLinks', 'DevelopmentRepository', 'DevelopmentChangeRequest']) {
  for (const outcome of ['forbidden', 'missing', 'offline', 'success']) test('late actual visibility evidence survives the Host deadline: ' + operation + '/' + outcome, async t => {
    const h = await open(t), entered = gate(), release = gate()
    await h.service.refreshIssueClosingLinks(actor, h.ids[0])
    const base = await h.service.baseline(), watch = h.host.controller.watch({ afterRevision: base.revision, seed: base }), before = dump(h.dataPath)
    h.flags.pages = true
    h.flags.intercept = async request => {
      if (request.operationName !== operation || operation === 'PlanningIssueClosingLinks' && !request.variables.after) return
      entered.resolve(); await release.promise
      if (outcome === 'offline') throw new Error('SECRET offline')
      if (outcome !== 'success') return new Response(JSON.stringify({ errors: [{ type: outcome === 'missing' ? 'NOT_FOUND' : 'FORBIDDEN', message: 'SECRET' }] }), { status: outcome === 'missing' ? 200 : 403 })
    }
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    t.after(() => { t.mock.timers.reset(); release.resolve() })
    const pending = h.service.refreshIssueClosingLinks(actor, h.ids[1]); await entered.promise; t.mock.timers.tick(10001)
    const partial = (await pending).value; t.mock.timers.reset(); assert.equal(partial.state, 'partial')
    release.resolve(); for (let i = 0; i < 30; i++) await turn()
    h.requests.length = 0
    const cached = (await h.service.getIssueClosingLinks(h.ids[0])).observation, value = (await h.service.getIssueClosingLinks(h.ids[1])).observation
    const event = await watch.poll()
    if (outcome === 'forbidden' || outcome === 'missing') {
      assert.deepEqual(cached.links, [], 'actual negative visibility evidence fences earlier receipts')
      assert.deepEqual(value.links, [], 'timed-out partial facts cannot survive actual negative visibility')
      assert.equal(event.kind, 'metadata'); assert.equal(event.metadata.revision, base.revision)
      assert.notEqual(event.metadata.nativeAccessVersion, base.nativeAccessVersion)
    } else {
      assert.equal(cached.links.length, 1, 'offline and late success do not revoke an earlier verified receipt')
      assert.deepEqual(value, partial, 'late success cannot ingest data after the deadline')
      assert.equal(event, undefined)
    }
    assert.deepEqual(h.requests, [], 'read and metadata remain query-only')
    assert.deepEqual(dump(h.dataPath), before, 'native evidence does not write business or delivery-health state')
  })
  test('actual NOT_FOUND drops receipts without claiming denial and requires fresh proof: ' + operation, async t => {
    const h = await open(t); await h.service.refreshIssueClosingLinks(actor, h.id)
    const base = await h.service.baseline(), before = dump(h.dataPath)
    h.flags.intercept = async request => request.operationName === operation ? new Response(JSON.stringify({ errors: [{ type: 'NOT_FOUND', message: 'SECRET' }] }), { status: 200 }) : undefined
    const missing = (await h.service.refreshIssueClosingLinks(actor, h.id)).value
    assert.equal(missing.state, 'unread'); assert.deepEqual(missing.links, [])
    const version = (await h.service.baseline()).nativeAccessVersion; assert.notEqual(version, base.nativeAccessVersion)
    await h.service.refreshIssueClosingLinks(actor, h.id)
    assert.equal((await h.service.baseline()).nativeAccessVersion, version, 'same missing resource does not drive a version loop')
    h.flags.intercept = undefined; h.flags.offline = true
    assert.deepEqual((await h.service.refreshIssueClosingLinks(actor, h.id)).value.links, [], 'offline cannot resurrect invalidated receipt')
    h.flags.offline = false; assert.equal((await h.service.refreshIssueClosingLinks(actor, h.id)).value.state, 'complete')
    h.flags.intercept = async request => request.operationName === operation ? new Response(JSON.stringify({ errors: [{ type: 'NOT_FOUND', message: 'SECRET' }] }), { status: 200 }) : undefined
    assert.deepEqual((await h.service.refreshIssueClosingLinks(actor, h.id)).value.links, [])
    assert.notEqual((await h.service.baseline()).nativeAccessVersion, version, 'a new missing observation after actual recovery invalidates again')
    assert.deepEqual(dump(h.dataPath), before)
  })
}
