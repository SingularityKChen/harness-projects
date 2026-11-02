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
    const workspace = await s.getWorkspace('runtime-workspace'); await s.putSyncCursor({ workspaceId: workspace.id, bindingId: p.planning.bindingId, scopeKey: 'planning.project', cursorValue: 'healthy', state: 'syncing', lastErrorCode: undefined }); assert.equal((await createContext({ workspace: { id: workspace.id, name: workspace.name, project: fixtureProjectRef(p.planning.bindingId) }, providers: p, storage: s })).runtimeAccess.denied, true)
    assert.equal((await core.queries.getPlanningSnapshot()).metadata.capabilities.find((entry) => entry.key === 'planning.item.read').access, 'unavailable')
  })
  for (const rowGap of [false, true]) test(`${label}: held retry preserves ${rowGap ? 'healthy row gap admission' : 'unavailable read-only admission'}`, async (t) => {
    const { core, providers: p, storage: s, workspace: w } = await open(t, make), target = (await core.queries.listPlanningItems()).find((row) => row.content.contentKind === 'work_item')
    if (rowGap) p.planning.state.items.push({ ...p.planning.state.items[0], ref: { bindingId: p.planning.bindingId, objectKind: 'project_item', externalId: 'orphan' }, membership: { externalId: 'orphan' }, content: { kind: 'redacted', reason: 'unavailable' } })
    p.planning.faultsSwitch.set(FaultKind.Offline, !rowGap); await core.commands.refreshPlanning(); p.planning.faultsSwitch.set(FaultKind.Offline, false)
    const entered = deferred(), release = deferred(), list = p.planning.listPlanningItems.bind(p.planning); p.planning.listPlanningItems = async (...args) => { entered.resolve(); await release.promise; return list(...args) }; const refresh = core.commands.refreshPlanning(); await entered.promise; assert.equal((await s.getSyncCursor(w.id, p.planning.bindingId, 'planning.project')).state, 'syncing')
    const pending = await core.queries.getPlanningSnapshot(); assert.equal(pending.metadata.capabilities.find((entry) => entry.key === 'planning.item.read').access, rowGap ? 'available' : 'read_only'); assert.equal(pending.sync.stale, true)
    const before = await s.listMutationAttempts(w.id), external = p.development.state.branches.length, request = { workItemId: target.entityId, repositoryId: 'repo-alpha', actor: { kind: 'user' } }, blocked = await core.commands.startWork({ ...request, idempotencyKey: 'marker-fence' }); if (rowGap) assert.equal(blocked.writeState, 'saved'); else { assert.notEqual(blocked.writeState, 'saved'); assert.deepEqual(await s.listMutationAttempts(w.id), before); assert.equal(p.development.state.branches.length, external) }; release.resolve(); assert.equal((await refresh).ok, true); assert.equal((await core.commands.startWork({ ...request, idempotencyKey: 'marker-fence-after' })).writeState, 'saved')
  })
  for (const initialized of [false, true]) for (const stage of ['read-round', 'before-callback', 'cursor-write', 'round-write', 'marker-commit']) test(`${label}: ${stage} failure ${initialized ? 'cannot overwrite a newer completed read' : 'settles the initial round without Provider I/O'}`, async (t) => {
    const p = createFakeProviders(), s = make(), seen = [], w = { id: 'begin-failure', name: 'begin-failure', project: fixtureProjectRef(p.planning.bindingId) }
    t.after(() => s.close?.())
    const context = await createContext({ providers: p, storage: s, workspace: w, diagnostics: { syncRoundFailed: (error) => seen.push(error) } })
    if (initialized) await bootstrapWorkspace(context)
    const reads = ['reconcile', 'getProject', 'getPlanningItem', 'listPlanningItems'].map((key) => t.mock.method(p.planning, key))
    const entered = deferred(), release = deferred(), transaction = s.transaction.bind(s), failure = new Error('marker-rollback'); let armed = true
    s.transaction = async (work) => {
      let thisMarker = false
      try {
        if (armed && stage === 'before-callback') { armed = false; throw failure }
        return await transaction(async (tx) => {
        const value = await work(new Proxy(tx, { get(target, key) {
          const method = Reflect.get(target, key)
          if (typeof method !== 'function') return method
          return async (...args) => {
            if (key === 'getPlanningSyncRound' && armed && stage === 'read-round') { armed = false; throw failure }
            if (key === 'putSyncCursor' && args[0].state === 'syncing' && armed) { armed = false; thisMarker = true; if (stage === 'cursor-write') throw failure }
            if (key === 'putPlanningSyncRound' && thisMarker && stage === 'round-write') throw failure
            return method.apply(target, args)
          }
        } }))
        if (thisMarker && stage === 'marker-commit') throw failure
        return value
      }) } catch (error) { if (error === failure) { entered.resolve(); await release.promise }; throw error }
    }
    const epoch = context.runtimeAccess.epoch, old = bootstrapWorkspace(context); await entered.promise
    assert.ok(reads.every((read) => read.mock.callCount() === 0))
    if (!initialized) {
      release.resolve(); assert.equal((await old).error?.code, 'unavailable')
      assert.equal((await s.getSyncCursor(w.id, p.planning.bindingId, 'planning.project')).state, 'degraded')
      assert.deepEqual(seen, [failure]); assert.equal(context.runtimeAccess.epoch, epoch)
      s.transaction = (work) => transaction(async (tx) => { await work(tx); throw failure })
      await assert.rejects(bootstrapWorkspace(context), failure)
      assert.equal(context.runtimeAccess.epoch, epoch); return
    }
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    release.resolve(); await old
    assert.equal((await s.getSyncCursor(w.id, p.planning.bindingId, 'planning.project')).state, 'healthy')
    assert.equal(context.runtimeAccess.epoch, epoch)
  })
for (const ordinaryFailure of [false, true]) for (const olderDenial of [false, true]) test(`${label}: ${olderDenial ? 'older' : 'newer'} denial fences an already running ${ordinaryFailure ? 'ordinary offline' : 'success'}`, async (t) => {
    const { context, queries, storage: s, workspace: w, providers: p } = await open(t, make), original = p.planning.listPlanningItems.bind(p.planning)
    const gates = [deferred(), deferred()]; let calls = 0
    p.planning.listPlanningItems = async (input) => { const value = await original(input), n = calls++; await gates[n].promise; return n === Number(!olderDenial) ? denied() : ordinaryFailure ? providerErr(providerError('unavailable', 'ordinary-offline')) : value }
    const first = bootstrapWorkspace(context); while (calls < 1) await turn()
    const second = bootstrapWorkspace(context); while (calls < 2) await turn()
    const firstToFinish = ordinaryFailure ? Number(olderDenial) : Number(!olderDenial)
    gates[firstToFinish].resolve(); const firstResult = await (firstToFinish ? second : first)
    gates[1 - firstToFinish].resolve(); const lastResult = await (firstToFinish ? first : second)
    assert.equal(ordinaryFailure ? firstResult.error?.code : lastResult.error?.code, ordinaryFailure ? 'unavailable' : 'stale_revision')
    assert.equal((ordinaryFailure ? lastResult : firstResult).error?.code, 'permission_denied')
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
  for (const fault of [FaultKind.PermissionDenied, FaultKind.Offline]) test(`${label}: ${fault} observed during target preflight cannot return prior permission`, async (t) => {
    const { core, providers: p, storage: s } = await open(t, make), target = (await core.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item')
    const entered = deferred(), release = deferred(), key = fault === FaultKind.Offline ? 'getSyncCursor' : 'getPlanningProjection', get = s[key].bind(s)
    s[key] = async (...args) => { const row = await get(...args); entered.resolve(); await release.promise; return row }
    const preflight = core.queries.getStartWorkTargetError(target.entityId)
    await entered.promise
    p.planning.faultsSwitch.set(fault, true); await core.commands.refreshPlanning()
    release.resolve()
    assert.equal((await preflight)?.code, fault === FaultKind.Offline ? 'unavailable' : 'permission_denied')
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
  for (const peer of [false, true]) for (const stage of ['preclaim', 'first-write', 'intent-committed', 'last-cursor', 'saved-ledger', 'saved-result', 'existing-result']) for (const state of ['offline', 'denied', 'healthy', 'row-gap', 'healthy-pending']) test(`${label}: ${peer ? 'peer' : 'same owner'} ${stage} revalidates ${state} admission`, async (t) => {
    const { context, core, providers: p, storage: s, workspace: w } = await open(t, make)
    const target = (await core.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item')
    const request = { workItemId: target.entityId, repositoryId: 'repo-alpha', actor: { kind: 'user' }, idempotencyKey: 'held-admission' }
    if (stage.includes('saved') || stage === 'existing-result') assert.equal((await core.commands.startWork(request)).writeState, 'saved')
    if (stage === 'existing-result') request.idempotencyKey = 'existing-admission'
    const entered = deferred(), release = deferred(), io = deferred(), inProvider = deferred()
    t.after(() => { release.resolve(); io.resolve() })
    let hold = true, intent = false
    if (stage === 'intent-committed' || stage === 'last-cursor') {
      const transaction = s.transaction.bind(s)
      s.transaction = async (work) => {
        const value = await transaction((tx) => work(new Proxy(tx, { get(target, key) {
          const method = Reflect.get(target, key)
          return key === 'putMutationAttempt' ? async (row) => { intent ||= row.externalIntent?.operation === 'createBranch'; return method.call(target, row) } : typeof method === 'function' ? method.bind(target) : method
        } })))
        if (hold && intent && stage === 'intent-committed') { hold = false; entered.resolve(); await release.promise }
        return value
      }
      if (stage === 'last-cursor') {
        const cursor = s.getSyncCursor.bind(s)
        s.getSyncCursor = async (...args) => { const value = await cursor(...args); if (intent && hold) { hold = false; assert.equal(value.state, 'healthy'); entered.resolve(); await release.promise }; return value }
      }
    } else {
      const holder = stage === 'saved-ledger' ? s : p.development
      const key = stage === 'saved-ledger' ? 'findMutationAttempt' : stage === 'preclaim' ? 'getRepository' : stage === 'first-write' ? 'preflightWorktree' : 'getWorktree'
      const read = holder[key].bind(holder)
      holder[key] = async (...args) => {
        const value = await read(...args)
        if (hold) { hold = false; entered.resolve(); await release.promise }
        return value
      }
    }
    const external = () => [p.development.state.branches.length, p.development.state.worktrees.length, p.execution.state.runs.length]
    const before = external(), start = core.commands.startWork(request); await entered.promise
    const attempts = await s.listMutationAttempts(w.id)
    if (state === 'row-gap') p.planning.state.items.push({ ...p.planning.state.items[0], ref: { bindingId: p.planning.bindingId, objectKind: 'project_item', externalId: 'orphan' }, membership: { externalId: 'orphan' }, content: { kind: 'redacted', reason: 'unavailable' } })
    if (state === 'healthy-pending') {
      const list = p.planning.listPlanningItems.bind(p.planning)
      p.planning.listPlanningItems = async (...args) => { inProvider.resolve(); await io.promise; return list(...args) }
    }
    p.planning.faultsSwitch.set(FaultKind.Offline, state === 'offline')
    p.planning.faultsSwitch.set(FaultKind.PermissionDenied, state === 'denied')
    const refresh = peer ? bootstrapWorkspace(context) : core.commands.refreshPlanning()
    if (state === 'healthy-pending') await inProvider.promise; else await refresh
    const blocked = state === 'offline' || state === 'denied' || peer && state === 'healthy-pending'
    const snapshot = await core.queries.getPlanningSnapshot()
    assert.equal(snapshot.metadata.capabilities.find((entry) => entry.key === 'planning.item.read').access, state === 'denied' || peer && state === 'healthy-pending' ? 'unavailable' : blocked ? 'read_only' : 'available')
    if (state === 'healthy-pending') assert.equal((await s.getSyncCursor(w.id, p.planning.bindingId, 'planning.project')).state, 'syncing')
    if (state === 'offline') assert.equal((await core.queries.getStartWorkTargetError(target.entityId)).code, 'unavailable')
    release.resolve(); const result = await start
    assert.equal(result.writeState === 'saved', !blocked)
    if (blocked) {
      assert.equal(result.error.code, state === 'denied' ? 'permission_denied' : 'unavailable')
      assert.deepEqual(external(), before)
      const expected = result.status === 'failed' ? attempts.map(attempt => ({ ...attempt, state: 'failed', errorCode: result.error.code,
        ...(attempt.externalIntent ? { externalIntent: { ...attempt.externalIntent, state: 'failed' } } : {}) })) : attempts
      assert.deepEqual(await s.listMutationAttempts(w.id), expected)
    }
    io.resolve(); await refresh
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

for(const [label,make] of [['fake',createFakeStorage],['sqlite',()=>createSqliteStorage(':memory:')]]) for(const rollback of [false,true]) test(`${label} peer denied ${rollback?'rollback':'committed'} does not expose source or start work`,async(t)=>{
 const p=createFakeProviders(),s=make(),w={id:'r9-peer-denial',name:'probe',project:fixtureProjectRef(p.planning.bindingId)};t.after(()=>s.close?.())
 p.planning.state.projects[0].title='peer-source-canary'
 const a=await composeCore({workspace:w,providers:p,storage:s}), b=await composeCore({workspace:w,providers:p,storage:s})
 const target=(await b.queries.listPlanningItems()).find(v=>v.content.contentKind==='work_item')
 if(rollback){const transaction=s.transaction.bind(s);s.transaction=work=>transaction(tx=>work(new Proxy(tx,{get(target,key){const method=Reflect.get(target,key);return key==='replacePlanningProjections'?async(...args)=>{if(args[1].some(row=>row.content.contentKind==='redacted'))throw new Error('redaction-failed');return method.apply(target,args)}:typeof method==='function'?method.bind(target):method}})))}
 const external=()=>[p.development.state.branches.length,p.development.state.worktrees.length,p.execution.state.runs.length],before=external()
 p.planning.faultsSwitch.set(FaultKind.PermissionDenied,true)
 const refresh=await a.commands.refreshPlanning().catch(error=>({thrown:error.message}))
 const metadata=await b.queries.getWorkspaceMetadata(), rows=await b.queries.listPlanningItems(),cursor=await s.getSyncCursor(w.id,p.planning.bindingId,'planning.project'),round=await s.getPlanningSyncRound(w.id,p.planning.bindingId,'planning.project')
 const precheck=await b.queries.getStartWorkTargetError(target.entityId), result=await b.commands.startWork({workItemId:target.entityId,repositoryId:'repo-alpha',actor:{kind:'user'},idempotencyKey:'peer-denied'})
 console.log(JSON.stringify({label,rollback,refresh,source:metadata.planningSource,rows:rows.map(row=>row.content.contentKind),cursor,round,precheck,result,before,after:external()}))
 assert.equal(metadata.planningSource,undefined,'source title is protected Planning content')
 assert.deepEqual(external(),before,'uncertain peer marker cannot authorize first external write')
 assert.ok(rows.every(row=>row.content.contentKind==='redacted'))
 assert.notEqual(result.writeState,'saved')
})

for (const sqlite of [false, true]) for (const scenario of ['peer-recovers-local-denial', 'start-after-peer-recovery', 'refresh-after-peer-recovery', 'marker-failure-after-peer-recovery', 'late-denial-cannot-replace-new-proof']) test(`${sqlite ? 'SQLite' : 'Memory'} ${scenario}`, async t => {
  const p = createFakeProviders(), storage = sqlite ? createSqliteStorage(':memory:') : p.storage, workspace = { id: 'peer-latest-proof', name: 'proof' }
  t.after(() => storage.close?.())
  p.planning.state.projects[0].title = 'private-latest-proof-source'
  const first = await composeCore({ workspace, providers: p, storage }), second = await composeCore({ workspace, providers: p, storage })
  const target = (await first.queries.listPlanningItems()).find(row => row.content.contentKind === 'work_item')
  if (scenario !== 'late-denial-cannot-replace-new-proof') {
    p.planning.faultsSwitch.set(FaultKind.PermissionDenied, true)
    assert.equal((await first.commands.refreshPlanning()).error.code, 'permission_denied')
    assert.equal((await first.queries.getStartWorkTargetError(target.entityId)).code, 'permission_denied')
    p.planning.faultsSwitch.set(FaultKind.PermissionDenied, false)
    assert.equal((await second.commands.refreshPlanning()).ok, true)
    if (scenario === 'marker-failure-after-peer-recovery') {
      const transaction = storage.transaction.bind(storage); let armed = true
      storage.transaction = work => transaction(tx => work(new Proxy(tx, { get(object, key) { const method = Reflect.get(object, key); return key === 'putSyncCursor' ? async row => { if (armed && row.state === 'syncing') { armed = false; throw new Error('recovered-marker-failed') }; return method.call(object, row) } : typeof method === 'function' ? method.bind(object) : method } })))
      assert.equal((await first.commands.refreshPlanning()).error.code, 'unavailable')
      assert.equal((await storage.getSyncCursor(workspace.id, p.planning.bindingId, 'planning.project')).state, 'degraded')
      storage.transaction = transaction; assert.equal((await first.commands.refreshPlanning()).ok, true)
    }
    if (scenario === 'start-after-peer-recovery') assert.equal((await first.commands.startWork({ workItemId: target.entityId, repositoryId: 'repo-alpha', actor: { kind: 'user' }, idempotencyKey: 'direct-recovered' })).writeState, 'saved')
    if (scenario === 'refresh-after-peer-recovery') assert.equal((await first.commands.refreshPlanning()).ok, true)
    const round = await storage.getPlanningSyncRound(workspace.id, p.planning.bindingId, 'planning.project')
    assert.equal(round.latestStartedRound, round.latestCommittedRound)
    const current = await first.queries.getStartWorkTargetError(target.entityId), views = await first.queries.listPlanningItems(), metadata = await first.queries.getWorkspaceMetadata()
    console.log(JSON.stringify({ sqlite, scenario, round, currentError: current?.code, visible: views.some(row => row.entityId === target.entityId && row.content.contentKind === 'work_item'), planningSource: metadata.planningSource }))
    assert.equal(current, undefined, 'a newer full committed peer proof must release the old local denial')
    assert.ok(views.some(row => row.entityId === target.entityId && row.content.contentKind === 'work_item'))
    assert.equal(metadata.planningSource?.name, 'private-latest-proof-source')
  } else {
    const entered = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve())
    const get = p.planning.getProject.bind(p.planning); let firstRead = true
    p.planning.getProject = async (...args) => { if (!firstRead) return get(...args); firstRead = false; entered.resolve(); await release.promise; return { ok: false, error: { code: 'permission_denied', message: 'late-protected-denial' } } }
    const older = first.commands.refreshPlanning(); await entered.promise
    assert.equal((await second.commands.refreshPlanning()).ok, true)
    const committed = await storage.getPlanningSyncRound(workspace.id, p.planning.bindingId, 'planning.project')
    release.resolve(); await older
    const cursor = await storage.getSyncCursor(workspace.id, p.planning.bindingId, 'planning.project'), round = await storage.getPlanningSyncRound(workspace.id, p.planning.bindingId, 'planning.project')
    const current = await second.queries.getStartWorkTargetError(target.entityId), visible = (await second.queries.listPlanningItems()).some(row => row.entityId === target.entityId && row.content.contentKind === 'work_item')
    console.log(JSON.stringify({ sqlite, scenario, committed, cursor, round, currentError: current?.code, visible }))
    assert.equal(cursor.state, 'healthy', 'an older actual denial cannot replace a newer committed full Planning proof')
    assert.deepEqual(round, committed)
    assert.equal(current, undefined); assert.equal(visible, true)
  }
})

for (const sqlite of [false, true]) test(`${sqlite ? 'SQLite' : 'Memory'} beginning an own retry cannot authorize an unclosed foreign Planning marker`, async t => {
  const p = createFakeProviders(), storage = sqlite ? createSqliteStorage(':memory:') : p.storage, workspace = { id: 'unclosed-owned-retry', name: 'retry' }
  t.after(() => storage.close?.())
  p.planning.state.projects[0].title = 'private-retry-source'
  const first = await composeCore({ workspace, providers: p, storage }), second = await composeCore({ workspace, providers: p, storage })
  const target = (await second.queries.listPlanningItems()).find(row => row.content.contentKind === 'work_item'), transaction = storage.transaction.bind(storage)
  storage.transaction = work => transaction(tx => work(new Proxy(tx, { get(object, key) { return key === 'replacePlanningProjections' ? async () => { throw Error('denial-redaction-rollback') } : typeof object[key] === 'function' ? object[key].bind(object) : object[key] } })))
  p.planning.faultsSwitch.set(FaultKind.PermissionDenied, true); await assert.rejects(first.commands.refreshPlanning()); storage.transaction = transaction
  assert.ok((await second.queries.listPlanningItems()).every(row => row.content.contentKind === 'redacted'))
  p.planning.faultsSwitch.set(FaultKind.PermissionDenied, false)
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve())
  p.planning.listPlanningItems = async () => { entered.resolve(); await release.promise; return { ok: false, error: { code: 'permission_denied', message: 'items-still-restricted' } } }
  const retry = second.commands.refreshPlanning(); await entered.promise
  try {
    const views = await second.queries.listPlanningItems(), metadata = await second.queries.getWorkspaceMetadata()
    const before = [p.development.state.branches.length, p.development.state.worktrees.length, p.execution.state.runs.length]
    const result = await second.commands.startWork({ workItemId: target.entityId, repositoryId: 'repo-alpha', actor: { kind: 'user' }, idempotencyKey: 'during-unconfirmed-retry' })
    const after = [p.development.state.branches.length, p.development.state.worktrees.length, p.execution.state.runs.length]
    console.log(JSON.stringify({ sqlite, visible: views.some(row => row.entityId === target.entityId && row.content.contentKind === 'work_item'), source: metadata.planningSource, before, after, result }))
    assert.deepEqual(after, before, 'a new own read has not produced the full committed proof needed to clear the old unknown marker')
    assert.ok(views.every(row => row.content.contentKind === 'redacted')); assert.equal(metadata.planningSource, undefined)
  } finally { release.resolve(); await retry }
})

for (const sqlite of [false, true]) for (const pending of [false, true]) test(`${sqlite ? 'SQLite' : 'Memory'} healthy row-gap retains permitted Planning rows with own pending=${pending}`, async t => {
  const p = createFakeProviders(), storage = sqlite ? createSqliteStorage(':memory:') : p.storage, workspace = { id: 'row-gap-visible', name: 'row gap' }
  t.after(() => storage.close?.())
  const core = await composeCore({ workspace, providers: p, storage })
  const target = (await core.queries.listPlanningItems()).find(row => row.content.contentKind === 'work_item')
  p.planning.state.items.push({ ...p.planning.state.items[0], ref: { bindingId: p.planning.bindingId, objectKind: 'project_item', externalId: 'orphan' }, membership: { externalId: 'orphan' }, content: { kind: 'redacted', reason: 'unavailable' } })
  await core.commands.refreshPlanning()
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let refresh
  if (pending) { const list = p.planning.listPlanningItems.bind(p.planning); p.planning.listPlanningItems = async (...args) => { entered.resolve(); await release.promise; return list(...args) }; refresh = core.commands.refreshPlanning(); await entered.promise }
  try {
    const snapshot = await core.queries.getPlanningSnapshot(), row = snapshot.views.find(row => row.entityId === target.entityId)
    console.log(JSON.stringify({ sqlite, pending, cursor: await storage.getSyncCursor(workspace.id, p.planning.bindingId, 'planning.project'), sync: snapshot.sync, row: row?.content, capability: snapshot.metadata.capabilities.find(row => row.key === 'planning.item.read') }))
    assert.equal(snapshot.metadata.capabilities.find(row => row.key === 'planning.item.read').access, 'available')
    assert.equal(row?.content.contentKind, 'work_item', 'a healthy per-row gap must not redact other permitted Planning rows')
    assert.equal(row.content.title, target.content.title)
  } finally { release.resolve(); await refresh }
})
