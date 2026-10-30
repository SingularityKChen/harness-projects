import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { bootstrapWorkspace, composeCore, createContext, createQueries, contextIdFor } from '@harness-projects/core'
import { createController } from '@harness-projects/controller'
import { createFakeProviders, createFakeStorage, fixtureProjectRef, FaultKind } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { providerErr, providerError } from '@harness-projects/capabilities'
const denied = () => providerErr(providerError('permission_denied', 'private-provider-canary'))
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
const turn = () => new Promise((resolve) => setImmediate(resolve))
async function open(t, make) {
  const providers = createFakeProviders(), storage = make()
  t.after(() => storage.close?.())
  const workspace = { id: 'runtime-workspace', name: 'runtime', project: fixtureProjectRef(providers.planning.bindingId) }
  const context = await createContext({ workspace, providers, storage }), queries = createQueries(context)
  await bootstrapWorkspace(context)
  const core = await composeCore({ workspace, providers, storage }), controller = createController(core)
  return { providers, storage, workspace, context, queries, core, controller }
}
for (const [label, make] of [['fake', createFakeStorage], ['sqlite', () => createSqliteStorage(':memory:')]]) {
  test(`${label}: denial redacts atomically, blocks direct/replayed commands and recovers stable identities`, async (t) => {
    const h = await open(t, make), { providers: p, core, storage: s, workspace: w } = h
    const initial = await core.queries.getPlanningSnapshot(), target = initial.views.find((v) => v.content.contentKind === 'work_item')
    const request = { workItemId: target.entityId, repositoryId: 'repo-alpha', actor: { kind: 'user' }, idempotencyKey: 'saved-before-denial' }
    assert.equal((await core.commands.startWork(request)).writeState, 'saved')
    assert.equal((await h.controller.commands.startWork({ actorRef: request.actor, idempotencyKey: request.idempotencyKey, workItemId: target.entityId, repositoryId: 'repo-alpha' })).writeState, 'confirmed')
    const identities = await s.listIdentitiesForEntity(target.entityId), before = await core.queries.getPlanningSnapshot()
    const known = await s.getReconcileCursor(w.id), calls = [p.development.state.branches.length, p.execution.state.runs.length]
    const attempts = await s.listMutationAttempts(w.id), contexts = await s.getExecutionContext(contextIdFor(w.id, target.entityId, 'repo-alpha'))
    p.planning.faultsSwitch.set(FaultKind.PermissionDenied, true)
    assert.equal((await core.commands.refreshPlanning()).ok, false)
    const hidden = await core.queries.getPlanningSnapshot()
    assert.equal(hidden.revision, before.revision + 1)
    assert.ok(hidden.views.every((v) => v.content.contentKind === 'redacted' && v.content.title === undefined && v.planningStatus === 'unknown' && v.planningFields === undefined))
    assert.equal(hidden.metadata.planningSource, undefined)
    assert.ok((await s.listPlanningProjections(w.id)).every((v) => v.content.contentKind === 'redacted'))
    assert.equal((await core.queries.getItemDetail(target.entityId)).content.body, undefined)
    for (const idempotencyKey of [request.idempotencyKey, 'new-denied']) {
      assert.notEqual((await core.commands.startWork({ ...request, idempotencyKey })).writeState, 'saved')
      assert.notEqual((await h.controller.commands.startWork({ actorRef: request.actor, idempotencyKey, workItemId: target.entityId, repositoryId: 'repo-alpha' })).writeState, 'saved')
    }
    assert.deepEqual([p.development.state.branches.length, p.execution.state.runs.length], calls)
    assert.deepEqual(await s.listMutationAttempts(w.id), attempts); assert.deepEqual(await s.getExecutionContext(contextIdFor(w.id, target.entityId, 'repo-alpha')), contexts)
    await core.commands.refreshPlanning(); assert.equal((await core.queries.getPlanningSnapshot()).revision, hidden.revision)
    assert.deepEqual(await s.getReconcileCursor(w.id), known)
    p.planning.faultsSwitch.set(FaultKind.PermissionDenied, false)
    assert.equal((await core.commands.refreshPlanning()).ok, true)
    assert.deepEqual(await s.listIdentitiesForEntity(target.entityId), identities)
    assert.equal((await core.queries.getItemDetail(target.entityId)).content.title, target.content.title)
  })
  test(`${label}: offline retains licensed content/confirmation but blocks new Start Work`, async (t) => {
    const { core, providers: p, storage: s, workspace: w } = await open(t, make)
    const before = await core.queries.getPlanningSnapshot(), known = await s.getReconcileCursor(w.id)
    p.planning.faultsSwitch.set(FaultKind.Offline, true); await core.commands.refreshPlanning()
    const stale = await core.queries.getPlanningSnapshot()
    assert.deepEqual(stale.views.map((v) => v.content), before.views.map((v) => v.content)); assert.equal(stale.sync.stale, true)
    assert.equal(stale.metadata.capabilities.find((entry) => entry.key === 'planning.item.read').access, 'read_only')
    assert.deepEqual(await s.getReconcileCursor(w.id), known)
    assert.notEqual((await core.commands.startWork({ workItemId: before.views.find((v) => v.content.contentKind === 'work_item').entityId, repositoryId: 'repo-alpha', actor: { kind: 'user' }, idempotencyKey: 'offline' })).writeState, 'saved')
    assert.deepEqual(await s.listMutationAttempts(w.id), [])
  })
  test(`${label}: an unacknowledged read marker prevents Provider I/O`, async (t) => {
    const { core, providers: p, storage: s } = await open(t, make), before = await core.queries.getPlanningSnapshot()
    let reads = 0; for (const key of ['reconcile', 'getProject', 'getPlanningItem', 'listPlanningItems']) { const read = p.planning[key].bind(p.planning); p.planning[key] = (...args) => { reads++; return read(...args) } }
    const transaction = s.transaction.bind(s)
    s.transaction = (work) => transaction((tx) => work(new Proxy(tx, { get(target, key) { const value = Reflect.get(target, key); return key === 'putSyncCursor' ? async (record) => { if (record.state === 'syncing') throw new Error('marker-disk-fault'); return value.call(target, record) } : typeof value === 'function' ? value.bind(target) : value } })))
    assert.equal((await core.commands.refreshPlanning()).ok, false)
    assert.equal(reads, 0); assert.deepEqual((await core.queries.getPlanningSnapshot()).views.map((row) => row.content), before.views.map((row) => row.content))
    const workspace = await s.getWorkspace('runtime-workspace'); await s.putSyncCursor({ workspaceId: workspace.id, bindingId: p.planning.bindingId, scopeKey: 'planning.project', cursorValue: undefined, state: 'syncing', lastErrorCode: undefined }); assert.equal((await createContext({ workspace: { id: workspace.id, name: workspace.name, project: fixtureProjectRef(p.planning.bindingId) }, providers: p, storage: s })).runtimeAccess.denied, false)
    assert.equal((await core.queries.getPlanningSnapshot()).metadata.capabilities.find((entry) => entry.key === 'planning.item.read').access, 'available')
  })
  test(`${label}: an unavailable read marker fences Start Work until the held refresh commits`, async (t) => {
    const { core, providers: p, storage: s, workspace: w } = await open(t, make), target = (await core.queries.listPlanningItems()).find((row) => row.content.contentKind === 'work_item'); p.planning.faultsSwitch.set(FaultKind.Offline, true); await core.commands.refreshPlanning(); p.planning.faultsSwitch.set(FaultKind.Offline, false)
    const entered = deferred(), release = deferred(), list = p.planning.listPlanningItems.bind(p.planning); p.planning.listPlanningItems = async (...args) => { entered.resolve(); await release.promise; return list(...args) }; const refresh = core.commands.refreshPlanning(); await entered.promise; assert.equal((await s.getSyncCursor(w.id, p.planning.bindingId, 'planning.project')).state, 'syncing')
    const pending = await core.queries.getPlanningSnapshot(); assert.equal(pending.metadata.capabilities.find((entry) => entry.key === 'planning.item.read').access, 'read_only'); assert.equal(pending.sync.stale, true)
    const before = await s.listMutationAttempts(w.id), external = p.development.state.branches.length, request = { workItemId: target.entityId, repositoryId: 'repo-alpha', actor: { kind: 'user' } }, blocked = await core.commands.startWork({ ...request, idempotencyKey: 'marker-fence' }); assert.notEqual(blocked.writeState, 'saved'); assert.deepEqual(await s.listMutationAttempts(w.id), before); assert.equal(p.development.state.branches.length, external); release.resolve(); assert.equal((await refresh).ok, true); assert.equal((await core.commands.startWork({ ...request, idempotencyKey: 'marker-fence-after' })).writeState, 'saved')
  })
for (const olderDenial of [false, true]) test(`${label}: ${olderDenial ? 'older' : 'newer'} denial fences an already running success`, async (t) => {
    const { context, queries, storage: s, workspace: w, providers: p } = await open(t, make), original = p.planning.listPlanningItems.bind(p.planning)
    const gates = [deferred(), deferred()]; let calls = 0
    p.planning.listPlanningItems = async (input) => { const value = await original(input), n = calls++; await gates[n].promise; return n === Number(!olderDenial) ? denied() : value }
    const first = bootstrapWorkspace(context); while (calls < 1) await turn()
    const second = bootstrapWorkspace(context); while (calls < 2) await turn()
    gates[Number(!olderDenial)].resolve(); await (olderDenial ? first : second)
    gates[Number(olderDenial)].resolve()
    assert.equal((await (olderDenial ? second : first)).error?.code, 'stale_revision')
    assert.ok((await s.listPlanningProjections(w.id)).every((v) => v.content.contentKind === 'redacted'))
    assert.ok((await queries.listPlanningItems()).every((v) => v.content.contentKind === 'redacted'))
  })
  test(`${label}: complete recovery survives old denial and partial recovery cannot unlock`, async (t) => {
    const { context, queries, providers: p } = await open(t, make), original = p.planning.listPlanningItems.bind(p.planning), gate = deferred()
    let calls = 0
    p.planning.listPlanningItems = async () => { if (calls++ === 0) return gate.promise; return denied() }
    const old = bootstrapWorkspace(context); while (calls < 1) await turn()
    await bootstrapWorkspace(context)
    p.planning.listPlanningItems = async (input) => input.cursor ? denied() : { ok: true, value: { items: [], nextCursor: 'page-2' } }
    await bootstrapWorkspace(context)
    assert.ok((await queries.listPlanningItems()).every((v) => v.content.contentKind === 'redacted'))
    p.planning.listPlanningItems = original
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    gate.resolve(denied()); await old
    assert.ok((await queries.listPlanningItems()).some((v) => v.content.contentKind === 'work_item'))
    assert.equal((await queries.getPlanningSync()).stale, false)
  })
  test(`${label}: recovery requires current declared permission and the same binding`, async (t) => {
    const { core, providers: p } = await open(t, make), describe = p.planning.describeCapabilities.bind(p.planning)
    p.planning.faultsSwitch.set(FaultKind.PermissionDenied, true); await core.commands.refreshPlanning()
    p.planning.faultsSwitch.set(FaultKind.PermissionDenied, false)
    for (const mode of ['permission', 'capability', 'binding', 'unknown']) {
      p.planning.describeCapabilities = async () => {
        const snapshot = await describe(), field = mode === 'permission' ? 'permission' : 'capability'
        return mode === 'binding' ? { ...snapshot, bindingId: 'foreign-binding' }
          : { ...snapshot, [field]: { ...snapshot[field], [mode === 'unknown' ? 'planning.unknown' : 'planning.item.read']: 'unavailable' } }
      }
      assert.equal((await core.commands.refreshPlanning()).ok, false, mode)
      assert.ok((await core.queries.listPlanningItems()).every((v) => v.content.title === undefined), mode)
    }
    p.planning.describeCapabilities = describe
    assert.equal((await core.commands.refreshPlanning()).ok, true)
  })
  test(`${label}: a denial observed during target preflight cannot return prior permission`, async (t) => {
    const { core, providers: p, storage: s } = await open(t, make), target = (await core.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item')
    const entered = deferred(), release = deferred(), get = s.getPlanningProjection.bind(s)
    s.getPlanningProjection = async (...args) => { const row = await get(...args); entered.resolve(); await release.promise; return row }
    const preflight = core.queries.getStartWorkTargetError(target.entityId)
    await entered.promise
    p.planning.faultsSwitch.set(FaultKind.PermissionDenied, true); await core.commands.refreshPlanning()
    release.resolve()
    assert.equal((await preflight)?.code, 'permission_denied')
  })
  test(`${label}: denial during a snapshot read retries its freshness and capability envelope`, async (t) => {
    const { context, queries, providers: p, storage: s } = await open(t, make)
    const io = deferred(), inProvider = deferred(), inRead = deferred(), release = deferred()
    p.planning.listPlanningItems = () => { inProvider.resolve(); return io.promise }
    const refresh = bootstrapWorkspace(context); await inProvider.promise
    const transaction = s.transaction.bind(s); let hold = true
    s.transaction = (work) => transaction((tx) => work(new Proxy(tx, { get(target, key) {
      const value = Reflect.get(target, key)
      return key === 'listIdentitiesForEntity' ? async (...args) => { const identities = await value.apply(target, args); if (hold) { hold = false; inRead.resolve(); await release.promise } return identities } : typeof value === 'function' ? value.bind(target) : value
    } })))
    const snapshot = queries.getPlanningSnapshot(); await inRead.promise
    io.resolve(denied()); await turn(); release.resolve()
    const masked = await snapshot; await refresh
    assert.equal(masked.sync.stale, true)
    assert.equal(masked.metadata.capabilities.find((entry) => entry.key === 'planning.item.read').access, 'unavailable')
    assert.ok(masked.views.every((v) => v.content.title === undefined))
  })
  test(`${label}: saved replay awaiting its ledger cannot return through a newly observed denial`, async (t) => {
    const { core, providers: p, storage: s, workspace: w } = await open(t, make)
    const target = (await core.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item')
    const request = { workItemId: target.entityId, repositoryId: 'repo-alpha', actor: { kind: 'user' }, idempotencyKey: 'held-saved' }
    assert.equal((await core.commands.startWork(request)).writeState, 'saved')
    const entered = deferred(), release = deferred(), find = s.findMutationAttempt.bind(s); let hold = true
    const before = await s.listMutationAttempts(w.id)
    s.findMutationAttempt = async (...args) => { const value = await find(...args); if (hold) { hold = false; entered.resolve(); await release.promise } return value }
    const replay = core.commands.startWork(request); await entered.promise
    p.planning.faultsSwitch.set(FaultKind.PermissionDenied, true); await core.commands.refreshPlanning()
    release.resolve(); assert.notEqual((await replay).writeState, 'saved')
    assert.deepEqual(await s.listMutationAttempts(w.id), before)
  })
  test(`${label}: standalone sync query retries when denial occurs during cursor read`, async (t) => {
    const { core, providers: p, storage: s } = await open(t, make)
    const target = (await core.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item')
    const entered = deferred(), release = deferred(), get = s.getSyncCursor.bind(s); let hold = true
    s.getSyncCursor = async (...args) => { const value = await get(...args); if (hold) { hold = false; entered.resolve(); await release.promise } return value }
    const read = core.queries.getPlanningSync(); await entered.promise
    p.planning.faultsSwitch.set(FaultKind.PermissionDenied, true); const refresh = core.commands.refreshPlanning()
    await refresh; assert.equal((await core.queries.getStartWorkTargetError(target.entityId)).code, 'permission_denied')
    release.resolve(); assert.equal((await read).stale, true)
  })
  test(`${label}: failed redaction transaction remains fail closed and retry persists mask`, async (t) => {
    const { core, storage: s, providers: p, workspace: w } = await open(t, make), before = await core.queries.getPlanningSnapshot()
    const target = before.views.find((v) => v.content.contentKind === 'work_item')
    const transaction = s.transaction.bind(s); let failures = 0
    s.transaction = (work) => transaction((tx) => work(new Proxy(tx, { get(target, key) { const value = Reflect.get(target, key); return key === 'replacePlanningProjections' ? async () => { failures++; throw new Error('disk-fault') } : typeof value === 'function' ? value.bind(target) : value } })))
    p.planning.faultsSwitch.set(FaultKind.PermissionDenied, true)
    await assert.rejects(core.commands.refreshPlanning(), /disk-fault/)
    assert.equal(failures, 1)
    assert.ok((await core.queries.listPlanningItems()).every((v) => v.content.title === undefined))
    assert.equal((await core.queries.getItemDetail(target.entityId)).content.title, undefined)
    assert.ok(await core.queries.getStartWorkTargetError(target.entityId))
    s.transaction = transaction; await core.commands.refreshPlanning()
    assert.ok((await s.listPlanningProjections(w.id)).every((v) => v.content.contentKind === 'redacted'))
  })
}

test('explicit refresh cannot bypass declared capability or policy denial', async (t) => {
  for (const kind of ['policy', 'capability']) {
    const providers = createFakeProviders(), original = providers.planning.describeCapabilities.bind(providers.planning)
    if (kind === 'capability') providers.planning.describeCapabilities = async () => ({ ...await original(), capability: {} })
    const observed = t.mock.method(providers.planning, 'getProject')
    const core = await composeCore({ workspace: { name: 'blocked', project: fixtureProjectRef(providers.planning.bindingId) }, providers, ...(kind === 'policy' ? { policy: { 'planning.item.read': 'unavailable' } } : {}) })
    assert.equal((await core.commands.refreshPlanning()).ok, false)
    assert.equal(observed.mock.callCount(), 0)
    assert.deepEqual(await core.queries.listPlanningItems(), [])
  }
})
for (const markerError of [null, 'marker-string', Object.freeze(new Error('marker-object'))]) for (const [label, make] of [['fake', createFakeStorage], ['sqlite', () => createSqliteStorage(':memory:')]]) test(`${label}: marker ${markerError === null ? 'null' : typeof markerError} failure stays structured and reports each original error once`, async (t) => {
  const providers = createFakeProviders(), storage = make(); t.after(() => storage.close?.()); const workspace = { id: `marker-${label}-${markerError === null ? 'null' : 'string'}`, name: 'marker', project: fixtureProjectRef(providers.planning.bindingId) }
  const transaction = storage.transaction.bind(storage); storage.transaction = (work) => transaction((tx) => work(new Proxy(tx, { get(target, key) { const value = Reflect.get(target, key); return key === 'putSyncCursor' ? async (record) => { if (record.state === 'syncing') throw markerError; return value.call(target, record) } : typeof value === 'function' ? value.bind(target) : value } }))); const seen = [], core = await composeCore({ workspace, providers, storage, diagnostics: { syncRoundFailed: (error) => seen.push(error) } }), result = await core.commands.refreshPlanning(); assert.equal(result.ok, false); assert.equal(result.error.code, 'unavailable'); assert.deepEqual(seen, [markerError, markerError])
})
