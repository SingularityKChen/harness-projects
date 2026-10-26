import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { followWorkspace } from '@harness-projects/client'
import { createConnection, createCarrier, loadRemoteStream } from '../fixtures/remote-stream-double.js'
import { SqliteStorage } from '@harness-projects/storage-sqlite'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { PROVIDER_CATALOG } from '../../apps/harness-plugin/src/host-providers.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { WORKSPACE, account, fakePlanningEntry, mount, seed, seedWorkspace, githubFetch, projectNodeId, REPOSITORY_MOUNTS } from './fixtures/host-seed.js'
const actor = { kind: 'user', id: 'setup-test' }, envelope = (idempotencyKey) => ({ actorRef: actor, idempotencyKey })
const gate = () => { let resolve; const promise = new Promise((yes) => { resolve = yes }); return { promise, resolve } }
const turn = () => new Promise((resolve) => setImmediate(resolve))
function timers() { const live = new Set(), stopped = []; return { live, stopped, setInterval(run) { live.add(run); return run }, clearInterval(run) { assert.ok(live.delete(run)); stopped.push(run) } } }
async function open(t, overrides = {}, build) {
  const dir = await mkdtemp(path.join(tmpdir(), 'host-recompose-')), dataPath = path.join(dir, 'workspace.sqlite'), clock = timers()
  let login = 'tester', node = 'U_test'; const replay = githubFetch()
  const fetch = async (url, init) => url.endsWith('/user') ? new Response(JSON.stringify({ login, node_id: node }), { status: 200 }) : replay.fetch(url, init)
  if (build) await seed(dataPath, overrides.catalog ?? PROVIDER_CATALOG, build)
  const host = await createHostComposition({ dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, resolveCredential: async () => 'canary-token', fetch, watchIntervalMs: 1, planningTimers: clock, ...overrides })
  const events = [], installed = await installHostRemote({ provide: () => () => { events.push('withdraw') }, typert: { register: () => () => {} } }, host)
  const streams = [], watch = installed.service.watch
  installed.service.watch = (...args) => { const stream = watch(...args); streams.push(stream); return stream }
  t.after(async () => { host.stop(); await Promise.allSettled(streams.map((stream) => stream.return())); await installed.dispose(); await host.dispose(); await rm(dir, { recursive: true, force: true }) })
  return { host, service: installed.service, installed, clock, dataPath, events, identity: (value) => { login = value; node = `U_${value}` } }
}

test('same remote creates/connects/binds and the original stream delivers only one baseline without gaps', async (t) => {
  const h = await open(t), seen = []
  const { RemoteStream, RemoteStreamCarrierError } = await loadRemoteStream(), carrier = createCarrier(RemoteStreamCarrierError)
  let opens = 0
  const stream = new RemoteStream(createConnection(), { open: (signal) => { opens++; return carrier.open(h.service, signal) }, ended: () => new Error('unexpected end') })
  const follower = followWorkspace(() => stream, { onReport: (report, generation) => seen.push([report.kind, generation]) })
  void follower.done.catch(() => undefined)
  const until = async (ready) => { for (let i = 0; i < 200 && !ready(); i++) await new Promise((resolve) => setTimeout(resolve, 5)); assert.ok(ready()) }
  await until(() => seen.length > 0); assert.equal(follower.read(), undefined)
  const created = await h.service.createWorkspace(actor, 'create', 'Live workspace')
  assert.equal(created.writeState, 'local_only'); assert.deepEqual(created.value, { workspaceId: WORKSPACE })
  await until(() => follower.read()?.workspace.name === 'Live workspace')
  const linked = await h.service.connectAccount(actor, 'connect'); assert.equal(linked.writeState, 'local_only')
  const bound = await h.service.bindPlanningSource(actor, 'planning', linked.value.accountId, projectNodeId)
  assert.equal(bound.writeState, 'local_only'); await until(() => follower.read()?.store.list().length > 0)
  const baseline = await h.host.call('baseline', {})
  assert.deepEqual(follower.read().store.list().map((row) => row.entityId).sort(), baseline.entities.map((row) => row.entityId).sort())
  assert.deepEqual(seen, [['baseline', 1], ['metadata', 1], ['delta', 1]]); assert.equal(opens, 1); assert.equal(h.clock.live.size, 1)
  const first = h.clock.live.values().next().value
  assert.deepEqual(await h.service.bindPlanningSource(actor, 'planning', linked.value.accountId, projectNodeId), bound)
  assert.equal(h.clock.live.values().next().value, first)
  h.identity('changed'); assert.equal((await h.service.connectAccount(actor, 'connect')).writeState, 'conflict')
  const repository = await h.service.bindRepository(actor, 'repository', 'repo-one', [{ domain: 'development', implementationKey: 'development.github', accountId: linked.value.accountId, configuration: REPOSITORY_MOUNTS['development.github'][1] }])
  assert.equal(repository.writeState, 'local_only'); assert.equal(repository.value.bindingIds.length, 1)
  const active = h.host.controller, scheduled = h.clock.live.values().next().value
  await h.service.bindRepository(actor, 'repository', 'repo-one', [{ domain: 'development', implementationKey: 'development.github', accountId: linked.value.accountId, configuration: REPOSITORY_MOUNTS['development.github'][1] }])
  assert.equal(h.host.controller, active); assert.equal(h.clock.live.values().next().value, scheduled)
  await follower.close()
})

test('concurrent settings wait for the first activation before the next command reaches the viewer', async (t) => {
  let viewers = 0
  const h = await open(t, { fetch: async (url) => {
    assert.ok(url.endsWith('/user')); viewers += 1
    return new Response(JSON.stringify({ node_id: 'U_serial', login: 'serial-viewer' }), { status: 200 })
  } })
  const entered = gate(), release = gate(), read = SqliteStorage.prototype.listProviderBindings; let once = true
  t.mock.method(SqliteStorage.prototype, 'listProviderBindings', async function (...args) {
    if (once) { once = false; entered.resolve(); await release.promise }
    return read.apply(this, args)
  })
  const first = h.service.createWorkspace(actor, 'serial-create', 'Serial workspace'); await entered.promise
  const second = h.service.connectAccount(actor, 'serial-account')
  try { await turn(); await turn(); assert.equal(viewers, 0, '首个激活完成前第二个设置操作不得访问 viewer') }
  finally { release.resolve(); await Promise.allSettled([first, second]) }
  assert.equal((await first).writeState, 'local_only'); assert.equal((await second).writeState, 'local_only')
  assert.equal(viewers, 1); assert.equal((await h.host.call('baseline', {})).workspace.name, 'Serial workspace')
})

test('wire rejects extra scope/secret fields before any setup and account identity failures write no rows', async (t) => {
  const h = await open(t)
  for (const name of ['createWorkspace', 'connectAccount', 'bindPlanningSource', 'bindRepository']) {
    await assert.rejects(() => h.host.call(name, { ...envelope('bad'), workspaceId: 'foreign', secretHandle: 'other' }), /未知字段/)
  }
  for (const response of [undefined, { status: 401 }, { status: 403 }, { status: 404 }, { status: 429 }, { status: 200, body: { login: 'no-node' } }]) {
    const x = await open(t, { resolveCredential: async () => response === undefined ? undefined : 'token', fetch: async () => new Response(JSON.stringify(response.body ?? {}), { status: response.status }) })
    const result = await x.service.connectAccount(actor, 'account'); assert.equal(result.writeState, 'failed')
    const storage = new (await import('node:sqlite')).DatabaseSync(x.dataPath, { readOnly: true }); assert.equal(storage.prepare('SELECT count(*) AS n FROM connector_account').get().n, 0); storage.close()
  }
})

test('committed settings retain local_only/value after activation failure and the same key retries activation', async (t) => {
  const h = await open(t)
  const original = SqliteStorage.prototype.listProviderBindings
  let reject = true
  t.mock.method(SqliteStorage.prototype, 'listProviderBindings', function (...args) { if (reject) { reject = false; throw new Error('activation-canary') } return original.apply(this, args) })
  const result = await h.service.createWorkspace(actor, 'create', 'Retained')
  assert.equal(result.writeState, 'local_only'); assert.equal(result.value.workspaceId, WORKSPACE); assert.equal(result.activationError.code, 'unavailable')
  assert.equal((await h.host.call('baseline', {})).workspace, undefined)
  const retry = await h.service.createWorkspace(actor, 'create', 'Retained')
  assert.equal(retry.activationError, undefined); assert.equal((await h.host.call('baseline', {})).workspace.name, 'Retained')
  assert.equal((await h.service.createWorkspace(actor, 'create', 'Different')).writeState, 'conflict')
})

async function oldPlanning(t) {
  const instances = []; const entry = fakePlanningEntry((provider) => { instances.push(provider); return provider })
  const catalog = new Map([...PROVIDER_CATALOG, ['harness.fake', entry]]); const h = await open(t, { catalog }, async (storage) => { await seedWorkspace(storage); await storage.putProviderBinding(mount('planning-old', 'planning', 'harness.fake')); await storage.putConnectorAccount(account()) })
  return { ...h, instances }
}

test('precommit barrier drains an old baseline, discards its epoch, and resumes the same watch without gaps', async (t) => {
  const h = await oldPlanning(t), frames = h.service.watch(new AbortController().signal)[Symbol.asyncIterator]()
  assert.equal((await frames.next()).value.kind, 'baseline')
  const entered = gate(), release = gate(), list = SqliteStorage.prototype.listPlanningProjections; let once = true
  t.mock.method(SqliteStorage.prototype, 'listPlanningProjections', async function (...args) { const rows = await list.apply(this, args); if (once) { once = false; entered.resolve(); await release.promise } return rows })
  const pending = frames.next(); await entered.promise
  let committed = false; const setup = h.service.createWorkspace(actor, 'same', 'Seeded Workspace').then((value) => { committed = true; return value })
  await turn(); assert.equal(committed, false)
  h.instances[0].addItem(h.instances[0].state.projects[0].ref, 'issue', 'New', 'body')
  release.resolve(); await setup
  await h.host.call('refreshPlanning', { actorRef: actor })
  const frame = (await pending).value; assert.equal(frame.kind, 'delta'); assert.equal(frame.delta.upserts.some((row) => row.content.title === 'New'), true)
  await frames.return()
})

test('an epoch change forces the same unary baseline Promise to perform a second SQLite read', async (t) => {
  const h = await oldPlanning(t), entered = gate(), release = gate(), list = SqliteStorage.prototype.listPlanningProjections; let reads = 0
  t.mock.method(SqliteStorage.prototype, 'listPlanningProjections', async function (...args) { const rows = await list.apply(this, args); reads++; if (reads === 1) { entered.resolve(); await release.promise } return rows })
  const baseline = h.host.call('baseline', {}); await entered.promise
  const configure = h.service.createWorkspace(actor, 'epoch-unary', 'Seeded Workspace'); await turn()
  release.resolve(); await Promise.all([baseline, configure]); assert.equal(reads, 2)
})

test('old scheduled rounds drain before reassembly; stop cancels watch waits and closes storage after remote drain', async (t) => {
  const h = await oldPlanning(t), entered = gate(), release = gate(), provider = h.instances[0], list = provider.listPlanningItems.bind(provider)
  provider.listPlanningItems = async (...args) => { entered.resolve(); await release.promise; return list(...args) }
  h.clock.live.values().next().value(); await entered.promise
  const change = h.service.createWorkspace(actor, 'create', 'Seeded Workspace'); let settled = false; change.then(() => { settled = true }, () => {})
  await turn(); assert.equal(settled, false)
  const frames = h.service.watch(new AbortController().signal)[Symbol.asyncIterator](), pending = frames.next()
  const originalClose = SqliteStorage.prototype.close
  void pending.catch(() => undefined)
  const close = t.mock.method(SqliteStorage.prototype, 'close', function () { h.events.push('close'); return originalClose.call(this) })
  h.host.stop(); const remote = h.installed.dispose(); const disposal = remote.then(() => { const result = h.host.dispose(); assert.equal(result, h.host.dispose()); return result })
  await turn(); assert.equal(close.mock.callCount(), 0)
  release.resolve(); await Promise.allSettled([change, pending]); await remote; await disposal
  assert.ok(h.events.indexOf('withdraw') < h.events.indexOf('close')); assert.equal(close.mock.callCount(), 1); assert.equal(h.clock.live.size, 0)
})

test('two never-settling Development probes do not block readiness or replacement; cached real confirmation survives', async (t) => {
  const created = [], entry = PROVIDER_CATALOG.get('development.github')
  const catalog = new Map(PROVIDER_CATALOG); catalog.set('development.github', { ...entry, create: async (input) => { const port = await entry.create(input); created.push(port); return port } })
  let probes = 0, never = true; const replay = githubFetch()
  const fetch = (url, init) => { if (url.endsWith('/user')) return Promise.resolve(new Response(JSON.stringify({ login: 'new-viewer', node_id: 'U_new' }), { status: 200 })); if (JSON.parse(init.body).operationName === 'DevelopmentRepository') { probes++; if (never) return new Promise(() => {}) } return replay.fetch(url, init) }
  const { seedRepositoryMount } = await import('./fixtures/host-seed.js')
  const h = await open(t, { catalog, fetch }, async (storage) => {
    await seedWorkspace(storage); await storage.putConnectorAccount(account())
    await seedRepositoryMount(storage, 'dev-one', 'development.github'); await seedRepositoryMount(storage, 'dev-two', 'development.github')
  })
  assert.equal(probes, 0); assert.equal(created.length, 2)
  for (const port of created) assert.equal((await port.describeCapabilities()).permission['development.repository.read'], 'degraded')
  never = false
  const repository = { bindingId: 'dev-one', objectKind: 'repository', externalId: REPOSITORY_MOUNTS['development.github'][1].repositoryExternalId, url: undefined }
  assert.equal((await created[0].getRepository(repository)).ok, true)
  const confirmation = await created[0].describeCapabilities()
  const linked = await h.service.connectAccount(actor, 'new-account')
  const reference = [{ domain: 'development', implementationKey: 'development.github', accountId: linked.value.accountId, configuration: REPOSITORY_MOUNTS['development.github'][1] }]
  assert.equal((await h.service.bindRepository(actor, 'new-repository', 'another-repo', reference)).writeState, 'local_only')
  assert.equal(created.length, 3); assert.equal(probes, 1)
  assert.deepEqual(await created[0].describeCapabilities(), confirmation)
  assert.equal((await created[0].getRepository(repository)).ok, true, 'cached provider uses host lifetime after retiring its old assembly')
  assert.equal(probes, 2)
})


test('a tick admitted during the barrier never joins its drain and never writes through the retired Core', async (t) => {
  const h = await oldPlanning(t), entered = gate(), release = gate(), old = h.instances[0]
  let oldReads = 0; const list = old.listPlanningItems.bind(old)
  old.listPlanningItems = (...args) => { oldReads++; return list(...args) }
  const mounts = SqliteStorage.prototype.listProviderBindings; let once = true
  t.mock.method(SqliteStorage.prototype, 'listProviderBindings', async function (...args) { const rows = await mounts.apply(this, args); if (once) { once = false; entered.resolve(); await release.promise } return rows })
  const oldController = h.host.controller, put = SqliteStorage.prototype.putPlanningSyncRound; let lateRounds = 0
  t.mock.method(SqliteStorage.prototype, 'putPlanningSyncRound', function (...args) { if (h.host.controller !== oldController) lateRounds++; return put.apply(this, args) })
  const oldTick = h.clock.live.values().next().value
  const request = h.service.bindRepository(actor, 'barrier', 'repo-extra', [{ domain: 'development', implementationKey: 'development.github', accountId: account().id, configuration: REPOSITORY_MOUNTS['development.github'][1] }])
  await entered.promise; oldTick(); await turn(); assert.equal(oldReads, 0)
  release.resolve(); const result = await request; assert.equal(result.writeState, 'local_only'); assert.equal(result.activationError, undefined); await turn()
  assert.equal(oldReads, 0); assert.equal(h.clock.live.size, 1); assert.equal(h.clock.stopped.length, 1)
  oldTick(); for (let i = 0; i < 5; i++) await turn()
  assert.equal(oldReads, 0); assert.equal(lateRounds, 0, 'retired Core must not begin a SQLite planning round after publication')
})

test('a failed replacement keeps a nonempty old assembly and restarts its scheduler; same key later activates', async (t) => {
  const h = await oldPlanning(t), oldController = h.host.controller
  const create = h.host.controller.baseline.bind(h.host.controller); assert.ok((await create()).entities.length > 0)
  // Failure is injected in candidate Core registration, after settings commit.
  const all = SqliteStorage.prototype.putWorkspace; let fail = true
  t.mock.method(SqliteStorage.prototype, 'putWorkspace', function (...args) { if (fail) { fail = false; return Promise.reject(new Error('candidate failed')) } return all.apply(this, args) })
  const references = [{ domain: 'development', implementationKey: 'development.github', accountId: account().id, configuration: REPOSITORY_MOUNTS['development.github'][1] }]
  const result = await h.service.bindRepository(actor, 'recover', 'repo-recover', references)
  assert.equal(result.writeState, 'local_only'); assert.equal(result.activationError.code, 'unavailable'); assert.equal(h.host.controller, oldController); assert.equal(h.clock.live.size, 1)
  assert.equal((await h.service.baseline()).entities.length, (await create()).entities.length)
  const retry = await h.service.bindRepository(actor, 'recover', 'repo-recover', references)
  assert.equal(retry.activationError, undefined); assert.notEqual(h.host.controller, oldController); assert.equal(h.clock.live.size, 1)
})

test('candidate timer allocation failure preserves local commit and old assembly until the same key retries', async (t) => {
  const clock = timers(); let fail = true
  const h = await open(t, { planningTimers: { ...clock, setInterval(run) { if (fail) { fail = false; throw new Error('timer allocation failed') } return clock.setInterval(run) } } })
  await h.service.createWorkspace(actor, 'create', 'Timer recovery')
  const account = await h.service.connectAccount(actor, 'connect'), old = h.host.controller
  const result = await h.service.bindPlanningSource(actor, 'planning', account.value.accountId, projectNodeId)
  assert.equal(result.writeState, 'local_only'); assert.equal(result.activationError.code, 'unavailable'); assert.equal(h.host.controller, old)
  const retry = await h.service.bindPlanningSource(actor, 'planning', account.value.accountId, projectNodeId)
  assert.equal(retry.activationError, undefined); assert.notEqual(h.host.controller, old); assert.equal(clock.live.size, 1)
})
