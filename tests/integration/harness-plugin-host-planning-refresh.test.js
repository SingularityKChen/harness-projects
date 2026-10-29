import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fixtureProjectRef } from '@harness-projects/provider-fake'
import { SqliteStorage } from '@harness-projects/storage-sqlite'
import { createPlanningLifetime } from '../../apps/harness-plugin/src/host-planning-lifetime.ts'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { apply as applyHost } from '../../apps/harness-plugin/src/host.ts'
import { catalogOf, PROVIDER_CATALOG } from '../../apps/harness-plugin/src/host-providers.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { WORKSPACE, dump, fakePlanningEntry, mount, replayFetch, seed, seedPlanning, seedWorkspace } from './fixtures/host-seed.js'

const turn = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const within = (promise) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('hung'), 500).unref())])
const actor = { kind: 'agent', id: 'refresh-test' }
function manualTimers() {
  const live = new Set(), callbacks = []
  return { live, callbacks, setInterval(run, ms) { assert.equal(ms, 60_000); callbacks.push(run); live.add(run); return run }, clearInterval(run) { live.delete(run) }, tick() { for (const run of live) run() } }
}
async function open(t, overrides = {}, seeded = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'host-refresh-'))
  const dataPath = path.join(root, 'workspace.sqlite')
  let planning
  const catalog = catalogOf([fakePlanningEntry((provider) => { planning = provider; return overrides.port?.(provider) })])
  if (seeded) await seed(dataPath, catalog, async (storage) => { await seedWorkspace(storage); await storage.putProviderBinding(mount('00000000-0000-4000-8000-0000000000b1', 'planning', 'harness.fake')) })
  const timers = manualTimers()
  const host = await createHostComposition({ dataPath, workspaceId: WORKSPACE, catalog, resolveCredential: async () => undefined, planningTimers: timers, planningReadTimeoutMs: 100, ...overrides })
  const installed = await installHostRemote({ invocation: { peer: { id: 'fixture-peer' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  t.after(async () => { host.stop?.(); await installed.dispose(); await host.dispose(); await rm(root, { recursive: true, force: true }) })
  return { host, timers, service: installed.service, planning, root, installed }
}

// Removing Host scheduling or introducing a second refresh flight loses this query/watch-only update or starts duplicate reads.
test('scheduled refresh updates baseline and an existing watch; explicit refresh shares the real Core flight without replay', async (t) => {
  const h = await open(t, { planningReadTimeoutMs: 500 })
  assert.equal(h.timers.live.size, 1)
  const frames = h.host.watch(new AbortController().signal)[Symbol.asyncIterator]()
  const initial = (await frames.next()).value.baseline
  const writes = ['createDraftItem', 'createIssueWorkItem', 'updatePlanningFields'].map((name) => t.mock.method(h.planning, name))
  const gate = deferred(), entered = deferred()
  const list = h.planning.listPlanningItems.bind(h.planning)
  let calls = 0
  h.planning.listPlanningItems = async (...args) => { calls++; entered.resolve(); await gate.promise; return list(...args) }
  h.planning.addItem(fixtureProjectRef(h.planning.bindingId), 'issue', 'Scheduled item', 'body')
  h.timers.tick(); await entered.promise
  const explicit = h.service.refreshPlanning(actor)
  h.timers.tick(); h.timers.tick(); await turn()
  assert.equal(calls, 1)
  gate.resolve(); await explicit
  const updated = await h.service.baseline()
  assert.equal(updated.entities.length, initial.entities.length + 1)
  assert.equal((await frames.next()).value.kind, 'delta')
  await frames.return()
  await h.service.refreshPlanning(actor)
  assert.equal(calls, 2, 'a new explicit refresh must really read again')
  assert.deepEqual(writes.map((write) => write.mock.callCount()), [0, 0, 0])
  await assert.rejects(() => h.host.call('refreshPlanning', { actorRef: actor, idempotencyKey: 'forbidden' }), /未知字段/)
})

// A race around the whole Core command leaves its slot and commit alive; these late values must never replace the recovered projection.
test('timed-out list releases Core flight, keeps last-known confirmation, and discards both late values and late exceptions', async (t) => {
  const h = await open(t)
  const before = await h.service.baseline()
  const confirmation = () => dump(path.join(h.root, 'workspace.sqlite')).reconcile_cursor
  let confirmed = confirmation()
  assert.ok(confirmed, 'SQLite contains a committed confirmation timestamp')
  const list = h.planning.listPlanningItems.bind(h.planning)
  for (const late of ['resolve', 'reject']) {
    const gate = deferred()
    const old = await list({ project: fixtureProjectRef(h.planning.bindingId), cursor: undefined, limit: 50 })
    h.planning.listPlanningItems = () => gate.promise
    const failed = await within(h.host.controller.commands.refreshPlanning({ actorRef: actor }))
    assert.notEqual(failed, 'hung')
    assert.equal(failed.writeState, 'failed')
    const stale = await h.service.baseline()
    assert.equal(stale.revision, before.revision + (late === 'reject' ? 1 : 0))
    assert.equal(stale.source.freshness, 'degraded')
    assert.equal(confirmation(), confirmed)
    h.planning.listPlanningItems = list
    h.planning.addItem(fixtureProjectRef(h.planning.bindingId), 'issue', `Recovered ${late}`, 'body')
    await h.service.refreshPlanning(actor)
    const recovered = await h.service.baseline()
    confirmed = confirmation()
    gate[late](late === 'resolve' ? old : new Error('late-canary-secret'))
    await turn()
    assert.deepEqual(await h.service.baseline(), recovered)
  }
})

test('iterator next and never-ending yields share an absolute budget; hung or rejected return cannot hold Core open', async (t) => {
  const h = await open(t)
  const reconcile = h.planning.reconcile.bind(h.planning)
  for (const mode of ['next', 'yield']) {
    let next = 0, returned = 0
    h.planning.reconcile = () => ({ [Symbol.asyncIterator]() { return {
      next: () => { next++; return mode === 'next' ? new Promise(() => {}) : Promise.resolve({ done: false, value: {} }) },
      return: () => { returned++; return mode === 'next' ? new Promise(() => {}) : Promise.reject(new Error('return-canary')) },
    } } })
    const failed = await within(h.host.controller.commands.refreshPlanning({ actorRef: actor }))
    assert.notEqual(failed, 'hung'); assert.equal(failed.writeState, 'failed'); assert.equal(returned, 1)
    const reads = next; await turn(); assert.equal(next, reads)
    h.planning.reconcile = reconcile
    assert.equal((await h.service.refreshPlanning(actor)).writeState, 'local_only')
  }
})

test('stop closes admission synchronously, drains scheduled and explicit work before one async close, and fences old callbacks', async (t) => {
  const h = await open(t, { planningReadTimeoutMs: 500 })
  const close = t.mock.method(SqliteStorage.prototype, 'close')
  const entered = deferred(), gate = deferred(), list = h.planning.listPlanningItems.bind(h.planning)
  let reads = 0
  h.planning.listPlanningItems = async (...args) => { reads++; entered.resolve(); await gate.promise; return list(...args) }
  h.timers.tick(); await entered.promise
  const explicit = h.service.refreshPlanning(actor)
  await turn()
  h.host.stop()
  const disposal = h.host.dispose()
  assert.equal(h.host.dispose(), disposal)
  for (const callback of h.timers.callbacks) callback()
  await assert.rejects(() => h.host.call('baseline', {}), /已关闭/)
  assert.throws(() => h.host.watch(new AbortController().signal), /已关闭/)
  await turn(); assert.equal(close.mock.callCount(), 0)
  gate.resolve(); await explicit; await disposal
  assert.deepEqual([reads, h.timers.live.size, close.mock.callCount()], [1, 0, 1])
  await turn(); assert.equal(reads, 1)
})

test('empty or disabled Planning never schedules and invalid intervals fail before allocating storage', async (t) => {
  const h = await open(t, {}, false)
  assert.equal(h.timers.live.size, 0)
  const disabled = await open(t, { catalog: new Map() })
  assert.deepEqual([disabled.host.disabled.length, disabled.timers.live.size], [1, 0])
  for (const interval of [0, 59_999, NaN, Infinity, 2_147_483_648]) {
    await assert.rejects(() => createHostComposition({ dataPath: path.join(h.root, 'invalid.sqlite'), workspaceId: WORKSPACE, catalog: new Map(), resolveCredential: async () => undefined, planningIntervalMs: interval }), /interval/)
  }
  await assert.rejects(() => readFile(path.join(h.root, 'invalid.sqlite')), { code: 'ENOENT' })
})

// Real entry + production Provider + SQLite: ctx.get recovery needs no client command and no provider event.
test('Host entry discovers late credentials and later provider changes through queries alone and stops before remote drain', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'host-entry-refresh-'))
  const dataPath = path.join(root, 'harness-projects', 'workspace.sqlite')
  const services = new Map(), effects = [], timers = manualTimers()
  const replay = replayFetch()
  let credential, changed = false, gate
  t.mock.method(globalThis, 'setInterval', timers.setInterval.bind(timers))
  t.mock.method(globalThis, 'clearInterval', timers.clearInterval.bind(timers))
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    await gate
    const response = await replay.fetch(url, init)
    const body = await response.json()
    if (changed) {
      const visit = (value) => { if (!value || typeof value !== 'object') return; for (const key of Object.keys(value)) { if (key === 'title' && typeof value[key] === 'string') value[key] = `Changed ${value[key]}`; else visit(value[key]) } }
      visit(body)
    }
    return new Response(JSON.stringify(body), { status: response.status })
  })
  const ctx = { invocation: { peer: { id: 'fixture-peer' } }, get: (name) => name === 'profileContext' ? { dir: root } : credential, provide(name, value) { services.set(name, value); return () => services.delete(name) }, typert: { register: () => () => {} }, effect(callback) { effects.push(callback()) } }
  process.env.DSH_HOME = root
  t.after(async () => { for (const dispose of effects.reverse()) await dispose(); delete process.env.DSH_HOME; await rm(root, { recursive: true, force: true }) })
  await seed(dataPath, PROVIDER_CATALOG, async (storage) => { await seedWorkspace(storage); await seedPlanning(storage) })
  const close = t.mock.method(SqliteStorage.prototype, 'close')
  await applyHost(ctx)
  const service = services.get('harnessProjects')
  assert.equal((await service.baseline()).entities.length, 0)
  credential = { resolve: async () => ({ value: 'canary-refresh-1', source: 'test' }) }
  timers.tick()
  for (let i = 0; i < 30 && (await service.baseline()).entities.length === 0; i++) await turn()
  const first = await service.baseline()
  assert.ok(first.entities.length > 0)
  credential = { resolve: async () => ({ value: 'canary-refresh-2', source: 'test' }) }
  changed = true; timers.tick()
  for (let i = 0; i < 30 && (await service.baseline()).revision === first.revision; i++) await turn()
  assert.ok((await service.baseline()).revision > first.revision)
  assert.ok(replay.requests.some(({ authorization }) => authorization === 'bearer canary-refresh-1'))
  assert.equal(replay.requests.at(-1).authorization, 'bearer canary-refresh-2')
  assert.deepEqual(replay.misses, [])
  const blocked = deferred(); gate = blocked.promise
  timers.tick(); await turn()
  const unload = effects[0]()
  for (const callback of timers.callbacks) callback()
  assert.equal(timers.live.size, 0); assert.equal(close.mock.callCount(), 0)
  blocked.resolve(); await unload
  assert.equal(close.mock.callCount(), 1)
  ctx.typert.register = () => { throw new Error('register refused') }
  await assert.rejects(() => applyHost(ctx), /register refused/)
  assert.deepEqual([close.mock.callCount(), timers.live.size, services.size], [2, 0, 0])
  ctx.typert.register = () => () => {}
  ctx.effect = () => { throw new Error('effect refused') }
  await assert.rejects(() => applyHost(ctx), /effect refused/)
  assert.deepEqual([close.mock.callCount(), timers.live.size, services.size], [3, 0, 0])
})

async function production(t, extra = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'host-read-budget-'))
  const dataPath = path.join(root, 'workspace.sqlite')
  await seed(dataPath, PROVIDER_CATALOG, async (storage) => { await seedWorkspace(storage); await seedPlanning(storage) })
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, resolveCredential: async () => 'canary-budget', planningTimers: manualTimers(), planningReadTimeoutMs: 100, ...extra }
}

test('production credential, fetch and response.json waits expire inside the port, then recover; late credentials after stop cannot fetch', async (t) => {
  let mode, gate
  const replay = replayFetch()
  const options = await production(t, {
    resolveCredential: async () => { if (mode === 'credential') await gate.promise; return 'canary-budget' },
    fetch: async (url, init) => {
      if (mode === 'fetch') await gate.promise
      const response = await replay.fetch(url, init)
      if (mode === 'json') response.json = () => gate.promise
      return response
    },
  })
  const host = await createHostComposition(options)
  t.after(() => host.dispose())
  for (const step of ['credential', 'fetch', 'json']) {
    mode = step; gate = deferred()
    const failed = await within(host.call('refreshPlanning', { actorRef: actor }))
    assert.notEqual(failed, 'hung'); assert.equal(failed.writeState, 'failed')
    assert.equal((await host.call('baseline', {})).source.freshness, 'degraded')
    mode = undefined
    assert.equal((await host.call('refreshPlanning', { actorRef: actor })).writeState, 'local_only')
    const recovered = await host.call('baseline', {})
    gate.reject(new Error('transport-late-secret')); await turn()
    assert.deepEqual(await host.call('baseline', {}), recovered)
  }
  mode = 'credential'; gate = deferred()
  const inFlight = host.call('refreshPlanning', { actorRef: actor })
  await turn(); host.stop(); await host.dispose(); await inFlight
  const count = replay.requests.length
  gate.resolve(); await turn(); await turn()
  assert.equal(replay.requests.length, count, 'stop fences credential continuation before fetch starts')
  assert.deepEqual(replay.misses, [])
})

test('startup describeCapabilities has a budget before composeCore and closes SQLite without starting a timer', async (t) => {
  const gate = deferred(), close = t.mock.method(SqliteStorage.prototype, 'close')
  const options = await production(t, { fetch: () => gate.promise })
  close.mock.resetCalls()
  await assert.rejects(() => createHostComposition(options), { name: 'PlanningReadTimeout' })
  assert.deepEqual([close.mock.callCount(), options.planningTimers.live.size], [1, 0])
  gate.reject(new Error('late-startup-secret')); await turn()
})

test('scheduled double faults reach the actual safe diagnostics sink and subsequent ticks continue', async (t) => {
  const h = await open(t)
  const failure = Object.assign(new Error('token-canary /private/canary'), { name: 'StorageFault', code: 'SQLITE_BUSY', errcode: 5 })
  const transaction = t.mock.method(SqliteStorage.prototype, 'transaction', async () => { throw failure })
  h.timers.tick(); await turn(); await turn()
  transaction.mock.restore()
  const logged = await readFile(path.join(h.root, 'diagnostics.log'), 'utf8')
  assert.match(logged, /"event":"syncRoundFailed".*"name":"StorageFault".*"code":"SQLITE_BUSY".*"errcode":5/)
  // Core 先报告轮内错误，scheduler 再报告被拒绝的 tick；任一接线断开都应使本例失败。
  const failures = logged.trim().split('\n').map((line) => JSON.parse(line)).filter(({ event, name }) => event === 'syncRoundFailed' && name === 'StorageFault')
  assert.equal(failures.length, 2, 'Core 与 scheduler 必须各向同一 Host sink 报告一次')
  assert.ok(!logged.includes('token-canary') && !logged.includes('/private/canary') && !logged.includes('message'))
  h.planning.addItem(fixtureProjectRef(h.planning.bindingId), 'issue', 'After diagnostics fault', 'body')
  const before = (await h.service.baseline()).revision
  h.timers.tick(); await turn(); await turn()
  assert.ok((await h.service.baseline()).revision > before)
})


test('all six promise reads preserve this, expire safely and stop admitting reads; optional absence and write confirmation are preserved', async (t) => {
  const h = await open(t)
  const lifetime = createPlanningLifetime(10)
  const planning = h.planning
  const port = lifetime.wrap(planning)
  assert.equal(port.definition, planning.definition)
  assert.equal(port.movePlanningItem, undefined)
  const project = fixtureProjectRef(planning.bindingId)
  assert.equal((await port.getProject(project)).ok, true, 'real class methods must retain their instance')
  for (const name of ['describeCapabilities', 'getProject', 'getPlanningItem', 'listPlanningItems', 'listFieldDefinitions', 'listIterations']) {
    const original = planning[name]
    planning[name] = () => new Promise(() => {})
    await assert.rejects(() => port[name](project), { name: 'PlanningReadTimeout' })
    planning[name] = original
  }
  const write = deferred()
  planning.createDraftItem = () => write.promise
  const confirmation = port.createDraftItem({ project, title: 'title', body: '' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  write.resolve({ ok: true, value: 'confirmed' })
  assert.deepEqual(await confirmation, { ok: true, value: 'confirmed' })
  lifetime.stop()
  assert.throws(() => port.getProject(project), /已关闭/)
})
