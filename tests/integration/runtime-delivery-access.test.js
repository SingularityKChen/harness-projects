import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { composeCore, defaultIdFactory } from '@harness-projects/core'
import { createFakeProviders, refOf } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { registerRepository, routeDevelopment } from '../../packages/core/src/development-route.ts'
import { createContext } from '../../packages/core/src/context.ts'
import { createQueries } from '../../packages/core/src/queries.ts'
import { refreshDeliveryFacts as refreshContextDelivery } from '../../packages/core/src/delivery-facts.ts'
import { guardedDevelopmentReads } from '../../packages/core/src/git-provisioning.ts'
const workspace = { id: '00000000-0000-4000-8000-000000000468', name: 'Delivery access' }
const denied = () => ({ ok: false, error: { code: 'permission_denied', message: 'private-provider-canary' } })
const unavailable = () => ({ ok: false, error: { code: 'unavailable', message: 'private-provider-canary' } })
async function fixture(t, sqlite = false, providers = createFakeProviders()) {
  const root = sqlite ? await mkdtemp(path.join(tmpdir(), 'delivery-access-')) : undefined
  const storage = sqlite ? createSqliteStorage(path.join(root, 'project.sqlite')) : providers.storage
  t.after(async () => { if (sqlite) { storage.close(); await rm(root, { recursive: true, force: true }) } })
  const core = await composeCore({ workspace, providers, storage })
  const workItemId = (await core.queries.listPlanningItems()).find((row) => row.content.contentKind === 'work_item').entityId
  const scope = { workItemId, repositoryId: 'repo-alpha' }
  const started = await core.commands.startWork({ ...scope, actor: { kind: 'user' }, idempotencyKey: 'delivery-access' })
  assert.equal(started.confirmed, true)
  await providers.development.createChangeRequest({ repository: refOf(providers.development.gate.bindingId, 'repository', scope.repositoryId), head: started.branchExternalId, base: 'main', title: 'pr-canary', body: '' })
  await core.commands.refreshDeliveryFacts(scope)
  return { core, providers, storage, scope, started }
}
const nodes = (view, kind) => view.hops.filter((hop) => hop.entityKind === kind)
for (const sqlite of [false, true]) for (const [method, kind, other, key] of [
  ['listPipelineRuns', 'pipeline_run', 'check_run', 'delivery.pipeline.read'], ['listChecks', 'check_run', 'pipeline_run', 'delivery.check.read'],
]) test(`${sqlite ? 'SQLite' : 'memory'} ${key}: offline retains facts; denial hides only its collection and explicit full read recovers`, async (t) => {
  const h = await fixture(t, sqlite), read = () => h.core.queries.getDeliveryProjection(h.scope), refresh = () => h.core.commands.refreshDeliveryFacts(h.scope)
  const before = await read(), original = h.providers.delivery[method].bind(h.providers.delivery)
  assert.ok(nodes(before, kind).length && nodes(before, other).length)
  h.providers.delivery[method] = async () => unavailable(); await refresh()
  const offline = await read()
  assert.deepEqual(nodes(offline, kind).map(({ stale, ...node }) => node), nodes(before, kind).map(({ stale, ...node }) => node))
  assert.ok(nodes(offline, kind).every((node) => node.stale))
  h.providers.delivery[method] = async () => denied(); const result = await refresh(), hidden = await read()
  assert.equal(nodes(hidden, kind).length, 0, 'denied collection must not expose externalId, label or CI fact')
  assert.ok(nodes(hidden, other).length)
  assert.deepEqual(hidden.gaps.find((gap) => gap.entityKind === kind), { entityKind: kind, reason: 'permission_denied', key, layer: 'permission' })
  assert.equal(hidden.freshness.find((set) => set.kind === kind).confirmedAt, undefined)
  assert.doesNotMatch(JSON.stringify(result) + JSON.stringify(hidden), /private-provider-canary/)
  h.providers.delivery[method] = async () => unavailable(); await refresh(); assert.equal(nodes(await read(), kind).length, 0)
  h.providers.delivery[method] = original; await refresh(); assert.ok(nodes(await read(), kind).length)
})
for (const [method, hidden, retained, key] of [
  ['listBranches', ['commit', 'change_request', 'pipeline_run', 'check_run'], [], 'development.repository.read'],
  ['listChangeRequests', ['change_request', 'check_run'], ['commit', 'pipeline_run'], 'development.change_request.read'],
]) test(`${key}: anchor denial masks dependent facts and retains command lineage`, async (t) => {
  const h = await fixture(t); h.providers.development[method] = async () => denied()
  await h.core.commands.refreshDeliveryFacts(h.scope); const view = await h.core.queries.getDeliveryProjection(h.scope)
  for (const kind of hidden) assert.equal(nodes(view, kind).length, 0)
  for (const kind of ['execution_context', 'worktree', ...retained]) assert.ok(nodes(view, kind).length)
  assert.ok(view.gaps.filter((gap) => hidden.includes(gap.entityKind)).every((gap) => gap.key === key))
})
function holdFirst(provider, method, result) {
  const original = provider[method].bind(provider); let release, started
  const waiting = new Promise((resolve) => { started = resolve })
  provider[method] = async (...args) => { provider[method] = original; const value = result ?? await original(...args); started(); await new Promise((resolve) => { release = resolve }); return value }
  return { waiting, release: () => release(), original }
}
for (const lateDenied of [false, true]) test(`late ${lateDenied ? 'denial' : 'success'} cannot overwrite a newer access observation`, async (t) => {
  const h = await fixture(t), p = h.providers.delivery
  const held = holdFirst(p, 'listPipelineRuns', lateDenied ? denied() : undefined)
  const old = h.core.commands.refreshDeliveryFacts(h.scope); await held.waiting
  p.listPipelineRuns = async () => denied(); await h.core.commands.refreshDeliveryFacts(h.scope)
  if (lateDenied) { p.listPipelineRuns = held.original; await h.core.commands.refreshDeliveryFacts(h.scope) }
  held.release(); await old
  const view = await h.core.queries.getDeliveryProjection(h.scope)
  assert.equal(nodes(view, 'pipeline_run').length > 0, lateDenied)
})
test('SQLite redaction failure remains query-masked; pure reads cannot expose the rolled-back collection', async (t) => {
  const h = await fixture(t, true), transaction = h.storage.transaction.bind(h.storage)
  h.storage.transaction = (work) => transaction((tx) => work(new Proxy(tx, { get(object, key) { return key === 'putDeliveryFacts' ? async () => { throw new Error('redaction-disk-fault') } : typeof object[key] === 'function' ? object[key].bind(object) : object[key] } })))
  h.providers.delivery.listPipelineRuns = async () => denied()
  assert.equal((await h.core.commands.refreshDeliveryFacts(h.scope)).applied, false)
  const disk = await h.storage.getDeliveryFacts(workspace.id, h.started.executionContextId)
  assert.ok(disk.sets.find((set) => set.kind === 'pipeline_run').nodes.length)
  const before = JSON.stringify(disk), view = await h.core.queries.getDeliveryProjection(h.scope)
  assert.equal(nodes(view, 'pipeline_run').length, 0)
  assert.ok(nodes(view, 'check_run').length)
  assert.equal(JSON.stringify(await h.storage.getDeliveryFacts(workspace.id, h.started.executionContextId)), before)
})
test('repository target and historical context isolation: another target or key cannot unlock denied facts', async (t) => {
  const h = await fixture(t), dev = h.providers.development, delivery = h.providers.delivery
  const otherItem = (await h.core.queries.listPlanningItems()).find((row) => row.content.contentKind === 'work_item' && row.entityId !== h.scope.workItemId).entityId
  const history = { ...h.scope, workItemId: otherItem }, beta = { ...h.scope, repositoryId: 'repo-beta' }
  const repo = refOf(dev.gate.bindingId, 'repository', beta.repositoryId)
  dev.state.repositories.push({ ...dev.state.repositories[0], ref: repo })
  dev.state.branches.push({ ...dev.state.branches[0], repository: repo })
  delivery.state.runs.push(...delivery.state.runs.map((run) => ({ ...run, repository: { ...run.repository, externalId: beta.repositoryId }, ref: { ...run.ref, externalId: `beta-${run.ref.externalId}` } })))
  for (const [scope, key] of [[history, 'history'], [beta, 'beta']]) {
    const started = await h.core.commands.startWork({ ...scope, actor: { kind: 'user' }, idempotencyKey: key, worktreePath: key })
    assert.equal(started.confirmed, true, JSON.stringify(started))
    await h.core.commands.refreshDeliveryFacts(scope)
    assert.ok(nodes(await h.core.queries.getDeliveryProjection(scope), 'pipeline_run').length)
  }
  const original = delivery.listPipelineRuns.bind(delivery)
  delivery.listPipelineRuns = async (input) => input.repository.externalId === 'repo-alpha' ? denied() : original(input)
  await h.core.commands.refreshDeliveryFacts(h.scope)
  assert.equal(nodes(await h.core.queries.getDeliveryProjection(history), 'pipeline_run').length, 0, 'untouched historical scope must be masked too')
  await h.core.commands.refreshDeliveryFacts(beta)
  assert.ok(nodes(await h.core.queries.getDeliveryProjection(beta), 'pipeline_run').length)
  assert.equal(nodes(await h.core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 0)
  delivery.listPipelineRuns = original; await h.core.commands.refreshDeliveryFacts(h.scope)
  assert.ok(nodes(await h.core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length)
  assert.equal(nodes(await h.core.queries.getDeliveryProjection(history), 'pipeline_run').length, 0, 'another context recovery cannot resurrect old historical facts')
  await h.core.commands.refreshDeliveryFacts(history)
  assert.ok(nodes(await h.core.queries.getDeliveryProjection(history), 'pipeline_run').length)
})

for (const layer of ['permission', 'policy']) test(`static ${layer} rejection reports the actual denying layer without Provider text`, async (t) => {
  const providers = createFakeProviders(), describe = providers.delivery.describeCapabilities.bind(providers.delivery)
  if (layer === 'permission') providers.delivery.describeCapabilities = async () => { const snapshot = await describe(); return { ...snapshot, permission: { ...snapshot.permission, 'delivery.pipeline.read': 'unavailable' } } }
  const h = await fixture(t, false, providers)
  const core = layer === 'policy' ? await composeCore({ workspace, providers, policy: { 'delivery.pipeline.read': 'unavailable' } }) : h.core
  const view = await core.queries.getDeliveryProjection(h.scope)
  assert.equal(view.gaps.find((gap) => gap.entityKind === 'pipeline_run').layer, layer)
  assert.ok(nodes(view, 'check_run').length)
})
test('a denial observed while an older local transaction awaits prevents that transaction publishing', async (t) => {
  const h = await fixture(t), transaction = h.storage.transaction.bind(h.storage), pipeline = h.providers.delivery.listPipelineRuns.bind(h.providers.delivery)
  const first = deferred(), second = deferred(), allowFirst = deferred(), allowSecond = deferred(), entered = deferred(), release = deferred(); let calls = 0
  h.providers.delivery.listPipelineRuns = async (...args) => { const n = calls++; (n === 0 ? first : second).resolve(); await (n === 0 ? allowFirst : allowSecond).promise; return n === 0 ? pipeline(...args) : denied() }
  const old = h.core.commands.refreshDeliveryFacts(h.scope); await first.promise
  const newer = h.core.commands.refreshDeliveryFacts(h.scope); await second.promise
  h.storage.transaction = (work) => transaction((tx) => work(new Proxy(tx, { get(object, key) { return key === 'putDeliveryFacts' ? async (...args) => { h.storage.transaction = transaction; entered.resolve(); await release.promise; return object[key](...args) } : typeof object[key] === 'function' ? object[key].bind(object) : object[key] } })))
  allowFirst.resolve(); await entered.promise; allowSecond.resolve(); await new Promise((resolve) => setImmediate(resolve)); release.resolve()
  assert.equal((await old).applied, false, 'access epoch must be rechecked inside the committing transaction')
  await newer; assert.equal(nodes(await h.core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 0)
})
test('another Development binding cannot unlock a refused repository read', async (t) => {
  const h = await fixture(t), other = createFakeProviders().development
  other.state.repositories[0].ref = { ...other.state.repositories[0].ref, externalId: 'repo-beta' }
  other.state.branches[0].repository = other.state.repositories[0].ref
  const core = await composeCore({ workspace, providers: { ...h.providers, development: [h.providers.development, other] } })
  await registerRepository(h.storage, defaultIdFactory, workspace.id, 'repo-beta', [other.gate.bindingId])
  const beta = { ...h.scope, repositoryId: 'repo-beta' }
  assert.equal((await core.commands.startWork({ ...beta, actor: { kind: 'user' }, idempotencyKey: 'other-binding', worktreePath: 'beta-binding' })).confirmed, true)
  await core.commands.refreshDeliveryFacts(beta)
  h.providers.development.listBranches = async () => denied(); await core.commands.refreshDeliveryFacts(h.scope)
  await core.commands.refreshDeliveryFacts(beta)
  assert.equal(nodes(await core.queries.getDeliveryProjection(h.scope), 'commit').length, 0)
  assert.ok(nodes(await core.queries.getDeliveryProjection(beta), 'commit').length)
  const metadata = await core.queries.getWorkspaceMetadata()
  const alpha = metadata.repositories.find((row) => row.id === 'repo-alpha'), allowed = metadata.repositories.find((row) => row.id === 'repo-beta')
  assert.equal(alpha.capabilities.find((entry) => entry.key === 'development.repository.read').access, 'unavailable')
  assert.notEqual(allowed.capabilities.find((entry) => entry.key === 'development.repository.read').access, 'unavailable')
})
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const tick = () => new Promise(done => setImmediate(done))

test('new Core owner preserves a storage-failed denial over the same SQLite', async (t) => {
  const h = await fixture(t, true), transaction = h.storage.transaction.bind(h.storage)
  h.storage.transaction = work => transaction(tx => work(new Proxy(tx, {get(object, key) {
    return key === 'putDeliveryFacts' ? async () => { throw new Error('synthetic-disk-fault') } : typeof object[key] === 'function' ? object[key].bind(object) : object[key]
  }})))
  h.providers.delivery.listPipelineRuns = async () => denied()
  const result = await h.core.commands.refreshDeliveryFacts(h.scope)
  assert.equal(result.applied, false)
  assert.equal(nodes(await h.core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 0)
  h.storage.transaction = transaction
  const newCore = await composeCore({workspace,providers:h.providers,storage:h.storage})
  const view = await newCore.queries.getDeliveryProjection(h.scope)
  t.diagnostic(JSON.stringify({applied:result.applied,newOwnerPipelineNodes:nodes(view,'pipeline_run').length,newOwnerPipelineFreshness:view.freshness.find(row=>row.kind==='pipeline_run')}))
  assert.equal(nodes(view,'pipeline_run').length,0,'recomposition must not turn a failed redaction into allowed historical facts')
})

test('repository metadata rereads when Delivery version changes during repository routing', async (t) => {
  const h = await fixture(t, true), inProvider=deferred(), releaseProvider=deferred(), inMetadata=deferred(), releaseMetadata=deferred()
  h.providers.delivery.listPipelineRuns = async () => { inProvider.resolve(); await releaseProvider.promise; return denied() }
  const refreshing=h.core.commands.refreshDeliveryFacts(h.scope)
  await inProvider.promise
  const list=h.storage.listRepositories.bind(h.storage); let calls=0
  h.storage.listRepositories=async (...args)=>{const value=await list(...args); if(++calls===2){inMetadata.resolve();await releaseMetadata.promise} return value}
  const reading=h.core.queries.getWorkspaceMetadata()
  await inMetadata.promise
  releaseProvider.resolve(); await tick()
  releaseMetadata.resolve()
  const metadata=await reading
  h.storage.listRepositories=list
  await refreshing
  const next=await h.core.queries.getWorkspaceMetadata()
  const pipeline=m=>m.repositories.find(row=>row.id==='repo-alpha').capabilities.find(row=>row.key==='delivery.pipeline.read')
  t.diagnostic(JSON.stringify({duringRead:pipeline(metadata),nextRead:pipeline(next)}))
  assert.equal(pipeline(next).access,'unavailable')
  assert.equal(pipeline(metadata).access,'unavailable','the metadata result must reflect the denial observed before it returned')
})
test('historical delivery facts remain unavailable after creating a fresh Core over the same storage', async (t) => {
 const h = await fixture(t, true);
 const otherItem = (await h.core.queries.listPlanningItems()).find(row => row.content.contentKind === 'work_item' && row.entityId !== h.scope.workItemId).entityId;
 const history = {...h.scope,workItemId:otherItem};
 assert.equal((await h.core.commands.startWork({...history,actor:{kind:'user'},idempotencyKey:'history-restart',worktreePath:'history-restart'})).confirmed,true);
 await h.core.commands.refreshDeliveryFacts(history);
 assert.ok(nodes(await h.core.queries.getDeliveryProjection(history),'pipeline_run').length);
 h.providers.delivery.listPipelineRuns = async () => denied();
 await h.core.commands.refreshDeliveryFacts(h.scope);
 assert.equal(nodes(await h.core.queries.getDeliveryProjection(history),'pipeline_run').length,0);
 const reopened = await composeCore({workspace,providers:h.providers,storage:h.storage});
 const view = await reopened.queries.getDeliveryProjection(history);
 assert.equal(nodes(view,'pipeline_run').length,0,'a new Core owner cannot restore an unverified historical collection');
});

test('durable health survives close/reopen, cross-owner denial, offline and same-scope recovery', async (t) => {
  const h = await fixture(t, true), original = h.providers.delivery.listPipelineRuns.bind(h.providers.delivery), location = h.storage.location
  const second = await composeCore({ workspace, providers: h.providers, storage: h.storage })
  h.providers.delivery.listPipelineRuns = async () => denied(); await second.commands.refreshDeliveryFacts(h.scope)
  assert.equal(nodes(await h.core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 0, 'already existing owner observes persisted newer denial')
  h.storage.close(); const storage = createSqliteStorage(location); t.after(() => storage.close())
  const reopened = await composeCore({ workspace, providers: h.providers, storage })
  assert.equal(nodes(await reopened.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 0)
  h.providers.delivery.listPipelineRuns = original; await reopened.commands.refreshDeliveryFacts(h.scope)
  assert.ok(nodes(await reopened.queries.getDeliveryProjection(h.scope), 'pipeline_run').length)
  h.providers.delivery.listPipelineRuns = async () => unavailable(); await reopened.commands.refreshDeliveryFacts(h.scope)
  const offline = await composeCore({ workspace, providers: h.providers, storage }), view = await offline.queries.getDeliveryProjection(h.scope)
  assert.ok(nodes(view, 'pipeline_run').length && nodes(view, 'pipeline_run').every((node) => node.stale), 'ordinary offline retains authorized cache across new owners')
})
test('failed health observation leaves a durable incomplete-read marker; read-start failure sends no Provider request', async (t) => {
  const h = await fixture(t, true), put = h.storage.putSyncCursor.bind(h.storage); let reads = 0
  h.providers.delivery.listPipelineRuns = async () => { reads++; return denied() }
  const originalTransaction = h.storage.transaction.bind(h.storage)
  h.storage.transaction = async () => { throw new Error('health-start-fault') }
  assert.equal((await h.core.commands.refreshDeliveryFacts(h.scope)).applied, false); assert.equal(reads, 0)
  h.storage.putSyncCursor = put; h.storage.transaction = originalTransaction
  const transaction = h.storage.transaction.bind(h.storage)
  h.storage.transaction = (work) => transaction((tx) => work(new Proxy(tx, { get(object, key) { return key === 'putSyncCursor' ? async (record) => { if (record.lastErrorCode === 'permission_denied') throw new Error('health-result-fault'); return object[key](record) } : typeof object[key] === 'function' ? object[key].bind(object) : object[key] } })))
  await h.core.commands.refreshDeliveryFacts(h.scope); h.storage.transaction = transaction
  const fresh = await composeCore({ workspace, providers: h.providers, storage: h.storage })
  assert.equal(nodes(await fresh.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 0)
  h.providers.delivery.listPipelineRuns = createFakeProviders().delivery.listPipelineRuns.bind(h.providers.delivery)
  await fresh.commands.refreshDeliveryFacts(h.scope)
  assert.ok(nodes(await fresh.queries.getDeliveryProjection(h.scope), 'pipeline_run').length)
})

for (const sqlite of [false, true]) test(`${sqlite ? 'SQLite' : 'memory'} failed recovery commit cannot publish scoped access before Storage ack`, async (t) => {
  const h = await fixture(t, sqlite), pipeline = h.providers.delivery.listPipelineRuns.bind(h.providers.delivery)
  const transaction = h.storage.transaction.bind(h.storage)
  h.storage.transaction = (work) => transaction((tx) => work(new Proxy(tx, { get(object, key) { return key === 'putDeliveryFacts' ? async () => { throw new Error('denial-redaction-rollback') } : typeof object[key] === 'function' ? object[key].bind(object) : object[key] } })))
  h.providers.delivery.listPipelineRuns = async () => denied(); await h.core.commands.refreshDeliveryFacts(h.scope)
  h.storage.transaction = transaction; h.providers.delivery.listPipelineRuns = pipeline
  assert.ok((await h.storage.getDeliveryFacts(workspace.id, h.started.executionContextId)).sets.find((set) => set.kind === 'pipeline_run').nodes.length)
  const entered = deferred(), release = deferred()
  t.after(() => release.resolve())
  h.storage.transaction = (work) => transaction(async (tx) => {
    let facts = false
    const result = await work(new Proxy(tx, { get(object, key) { return key === 'putDeliveryFacts' ? async (...args) => { facts = true; return object[key](...args) } : typeof object[key] === 'function' ? object[key].bind(object) : object[key] } }))
    if (facts) { entered.resolve(); await release.promise; throw new Error('recovery-commit-rollback') }
    return result
  })
  const refresh = h.core.commands.refreshDeliveryFacts(h.scope); await entered.promise
  if (!sqlite) assert.equal(nodes(await h.core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 0, 'staged recovery cannot make old facts visible')
  release.resolve(); assert.equal((await refresh).applied, false); h.storage.transaction = transaction
  assert.equal(nodes(await h.core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 0)
  await h.core.commands.refreshDeliveryFacts(h.scope); assert.ok(nodes(await h.core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length)
})
test('read-start rollback cannot leave phantom ownership that hides another owner unfinished read', async (t) => {
  const h = await fixture(t), transaction = h.storage.transaction.bind(h.storage), entered = deferred(), release = deferred()
  t.after(() => release.resolve())
  h.storage.transaction = (work) => transaction(async (tx) => { await work(tx); throw new Error('begin-ack-rollback') })
  assert.equal((await h.core.commands.refreshDeliveryFacts(h.scope)).applied, false); h.storage.transaction = transaction
  const other = await composeCore({ workspace, providers: h.providers, storage: h.storage })
  h.providers.development.listBranches = async () => { entered.resolve(); await release.promise; return unavailable() }
  const refresh = other.commands.refreshDeliveryFacts(h.scope); await entered.promise
  assert.equal(nodes(await h.core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 0, 'a rolled-back marker cannot claim another owner pending read')
  release.resolve(); await refresh
  assert.ok(nodes(await h.core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length)
})

const within = (promise, ms, message) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), ms)
  promise.then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
})

for (const sqlite of [false, true]) test(`${sqlite ? 'SQLite' : 'Memory'} Core read retries after another owner commits Delivery denial`, async (t) => {
  const h = await fixture(t, sqlite)
  assert.ok(nodes(await h.core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length)
  const other = await composeCore({ workspace, providers: h.providers, storage: h.storage })
  const getSyncCursor = h.storage.getSyncCursor.bind(h.storage), entered = deferred(), release = deferred()
  let held = false
  h.storage.getSyncCursor = async (...args) => {
    const value = await getSyncCursor(...args)
    if (!held && args[2] === JSON.stringify(['delivery.read', 'delivery.pipeline.read', 'repo-alpha'])) {
      held = true
      entered.resolve()
      await release.promise
    }
    return value
  }
  const reading = h.core.queries.getDeliveryProjection(h.scope)
  try {
    await within(entered.promise, 5000, 'Core read did not reach Delivery health cursor')
    h.providers.delivery.listPipelineRuns = async () => denied()
    assert.equal((await other.commands.refreshDeliveryFacts(h.scope)).applied, true)
  } finally {
    release.resolve()
    h.storage.getSyncCursor = getSyncCursor
  }
  const response = await reading
  assert.equal(nodes(response, 'pipeline_run').length, 0, 'the in-flight Core read must not return a denied pipeline')
})

const otherWorkItems = async h => (await h.core.queries.listPlanningItems()).filter(row => row.content.contentKind === 'work_item' && row.entityId !== h.scope.workItemId)
for (const sqlite of [false, true]) test(`${sqlite ? 'SQLite roots' : 'Memory'} operation read denial shares durable Delivery health and recovers only after facts ack`, async t => {
  const h = await fixture(t, sqlite), item = (await otherWorkItems(h))[0].entityId, workspaceStorage = () => {
    if (!sqlite) return h.storage
    const storage = createSqliteStorage(h.storage.location); t.after(() => storage.close()); return storage
  }
  const owner = storage => composeCore({ workspace, providers: h.providers, storage })
  const other = await owner(workspaceStorage()), original = h.providers.development.getRepository.bind(h.providers.development)
  assert.ok(nodes(await other.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 'successful operation reads leave no pending marker')
  const request = { ...h.scope, workItemId: item, actor: { kind: 'user' }, idempotencyKey: 'operation-read-denial' }
  h.providers.development.getRepository = async () => denied()
  assert.equal((await h.core.commands.startWork(request)).error.code, 'permission_denied')
  const reconstructed = await owner(workspaceStorage()), owners = [h.core, other, reconstructed]
  const hidden = async () => {
    for (const core of owners) {
      const view = await core.queries.getDeliveryProjection(h.scope)
      for (const kind of ['commit', 'change_request', 'pipeline_run', 'check_run']) assert.equal(nodes(view, kind).length, 0)
      assert.ok(nodes(view, 'worktree').length)
      assert.doesNotMatch(JSON.stringify(view), /pr-canary|private-provider-canary|ci_passed/)
    }
  }
  await hidden()
  h.providers.development.getRepository = original
  assert.equal((await h.core.commands.validateStartWork(item))[0].available, true)
  await hidden()
  const counts = [h.providers.development.state.branches.length, h.providers.development.state.worktrees.length, h.providers.execution.state.runs.length]
  const transaction = h.storage.transaction.bind(h.storage)
  h.storage.transaction = work => transaction(tx => work(new Proxy(tx, { get(object, key) {
    return key === 'putDeliveryFacts' ? async () => { throw Error('recovery-facts-rollback') } : typeof object[key] === 'function' ? object[key].bind(object) : object[key]
  } })))
  assert.equal((await h.core.commands.refreshDeliveryFacts(h.scope)).applied, false)
  h.storage.transaction = transaction; await hidden()
  const refreshed = await other.commands.refreshDeliveryFacts(h.scope)
  assert.equal(refreshed.applied, true); assert.deepEqual(refreshed.gaps, [])
  for (const core of owners) assert.ok(nodes(await core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length)
  assert.deepEqual([h.providers.development.state.branches.length, h.providers.development.state.worktrees.length, h.providers.execution.state.runs.length], counts)
})

for (const sqlite of [false, true]) for (const refusals of [1, 2]) test(`${sqlite ? 'SQLite' : 'Memory'} operation read marker failure and late Delivery success preserve newer denied health${refusals === 2 ? ' after two failed actual refusals' : ''}`, async t => {
  const h = await fixture(t, sqlite), item = (await otherWorkItems(h))[0].entityId, dev = h.providers.development, transaction = h.storage.transaction.bind(h.storage), original = dev.getRepository.bind(dev)
  const request = { ...h.scope, workItemId: item, actor: { kind: 'user' }, idempotencyKey: 'marker-failure' }
  let calls = 0
  dev.getRepository = async (...args) => { calls++; return original(...args) }
  h.storage.transaction = work => transaction(tx => work(new Proxy(tx, { get(object, key) {
    return key === 'putSyncCursor' ? async record => { if (record.scopeKey === JSON.stringify(['delivery.read', 'development.repository.read', 'repo-alpha'])) throw Error('marker-rollback'); return object[key](record) } : typeof object[key] === 'function' ? object[key].bind(object) : object[key]
  } })))
  await h.core.commands.startWork(request); assert.equal(calls, 0, 'marker ack is required before the actual repository read')
  h.storage.transaction = transaction
  const held = holdFirst(dev, 'listBranches'), older = h.core.commands.refreshDeliveryFacts(h.scope); await held.waiting
  const other = await composeCore({ workspace, providers: h.providers, storage: h.storage })
  const items = await otherWorkItems(h), entered = deferred(), release = deferred(); let deniedReads = 0, failures = 0
  dev.getRepository = async () => { if (++deniedReads === refusals) entered.resolve(); await release.promise; return denied() }
  const reads = items.slice(0, refusals).map((item, index) => other.commands.startWork({ ...request, workItemId: item.entityId, idempotencyKey: `denial-settlement-${index}` }))
  await entered.promise
  const observedToken = (await other.queries.getWorkspaceMetadata()).repositories[0].accessVersion
  h.storage.transaction = work => transaction(tx => work(new Proxy(tx, { get(object, key) {
    return key === 'putSyncCursor' ? async record => { if (record.lastErrorCode === 'permission_denied') { failures++; throw Error('denial-settlement-rollback') }; return object[key](record) } : typeof object[key] === 'function' ? object[key].bind(object) : object[key]
  } })))
  release.resolve(); await Promise.all(reads); assert.equal(failures, refusals)
  h.storage.transaction = transaction; held.release(); await older
  const peerStorage = sqlite && refusals === 2 ? createSqliteStorage(h.storage.location) : h.storage
  if (peerStorage !== h.storage) t.after(() => peerStorage.close())
  const reopened = await composeCore({ workspace, providers: h.providers, storage: peerStorage })
  assert.notEqual((await other.queries.getWorkspaceMetadata()).repositories[0].accessVersion, observedToken, 'a failed durable settlement still changes the protected detail access token')
  for (const core of [h.core, other, reopened]) assert.equal(nodes(await core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 0)
  dev.getRepository = original
  if (refusals === 1) assert.equal((await reopened.commands.startWork({ ...request, idempotencyKey: 'fresh-operation-only' })).confirmed, true)
  for (const core of [h.core, other, reopened]) assert.equal(nodes(await core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 0, 'single-method success cannot clear the older unknown marker')
  assert.equal((await reopened.commands.refreshDeliveryFacts(h.scope)).applied, true)
  for (const core of [h.core, other, reopened]) assert.ok(nodes(await core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length)
  if (refusals === 2) {
    const key = JSON.stringify(['delivery.read', 'development.repository.read', 'repo-alpha']), before = JSON.parse((await h.storage.getSyncCursor(workspace.id, dev.gate.bindingId, key)).cursorValue)
    assert.equal((await other.commands.startWork({ ...request, workItemId: items[1].entityId, idempotencyKey: 'after-complete-proof' })).confirmed, true)
    const after = JSON.parse((await h.storage.getSyncCursor(workspace.id, dev.gate.bindingId, key)).cursorValue)
    assert.ok(after.confirmedVersion >= before.confirmedVersion); assert.deepEqual(after.scopes, before.scopes)
    for (const core of [h.core, other, reopened]) assert.ok(nodes(await core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length)
  }
})

for (const sqlite of [false, true]) for (const confirmed of [false, true]) test(`${sqlite ? 'SQLite' : 'Memory'} older owned read cannot hide another owner marker and ordinary operation failure leaves no phantom pending${confirmed ? ' after full facts reset' : ''}`, async t => {
  const h = await fixture(t, sqlite), item = (await otherWorkItems(h))[0].entityId, dev = h.providers.development, oldRead = holdFirst(dev, 'listBranches')
  const refreshing = h.core.commands.refreshDeliveryFacts(h.scope); await oldRead.waiting
  const other = await composeCore({ workspace, providers: h.providers, storage: h.storage })
  if (confirmed) assert.equal((await other.commands.refreshDeliveryFacts(h.scope)).applied, true)
  const operation = holdFirst(dev, 'getRepository', unavailable())
  const starting = other.commands.startWork({ ...h.scope, workItemId: item, actor: { kind: 'user' }, idempotencyKey: 'ordinary-failed-operation' }); await operation.waiting
  try {
    assert.equal(nodes(await h.core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 0, 'old owner count must not cancel the new generation marker')
    if (confirmed) {
      oldRead.release(); await refreshing
      assert.equal(nodes(await h.core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 0, 'old settlement must not consume a marker created after complete facts reset')
    }
  } finally { operation.release(); oldRead.release() }
  assert.equal((await starting).confirmed, false); await refreshing
  const reopened = await composeCore({ workspace, providers: h.providers, storage: h.storage })
  for (const core of [h.core, other, reopened]) assert.ok(nodes(await core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 'ordinary unavailable closes its marker without revoking authorized cache')
})

for (const sqlite of [false, true]) for (const action of ['operation', 'facts']) test(`${sqlite ? 'SQLite' : 'Memory'} late actual denial versus newer ${action} proof`, async t => {
  const h = await fixture(t, sqlite), dev = h.providers.development, held = holdFirst(dev, 'getRepository', denied())
  const items = await otherWorkItems(h)
  const request = index => ({ ...h.scope, workItemId: items[index].entityId, actor: { kind: 'user' }, idempotencyKey: `late-denial-${index}` })
  const counts = [dev.state.branches.length, dev.state.worktrees.length, h.providers.execution.state.runs.length]
  const older = h.core.commands.startWork(request(0)); await held.waiting
  const other = await composeCore({ workspace, providers: h.providers, storage: h.storage })
  const next = action === 'operation' ? holdFirst(dev, 'getRepository') : undefined
  const newer = next ? other.commands.startWork(request(1)) : other.commands.refreshDeliveryFacts(h.scope)
  if (next) await next.waiting
  else assert.equal((await newer).applied, true)
  held.release(); assert.equal((await older).error.code, 'permission_denied')
  if (next) { next.release(); assert.equal((await newer).confirmed, false) }
  for (const core of [h.core, other]) assert.equal(nodes(await core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length > 0, action === 'facts')
  assert.deepEqual([dev.state.branches.length, dev.state.worktrees.length, h.providers.execution.state.runs.length], counts)
})

async function observationFixture(t, sqlite = false) {
  const h = await fixture(t, sqlite), context = await createContext({ workspace, providers: h.providers, storage: h.storage })
  const route = await routeDevelopment(context, 'repo-alpha', 'development.worktree.create', 'write')
  assert.equal(route.ok, true)
  return { ...h, context, queries: createQueries(context), route, guarded: guardedDevelopmentReads(context, route) }
}
test('Memory actual refusal remains masked through a delayed committed marker acknowledgement', async t => {
  const h = await observationFixture(t), dev = h.providers.development, read = dev.getRepository.bind(dev), aEntered = deferred(), aResult = deferred(), bEntered = deferred(), bResult = deferred()
  let calls = 0
  dev.getRepository = async (...args) => { if (++calls === 1) { aEntered.resolve(); await aResult.promise; return denied() }; bEntered.resolve(); await bResult.promise; return read(...args) }
  const a = h.guarded.getRepository(h.route.repository); await aEntered.promise
  const transaction = h.storage.transaction.bind(h.storage), bCommitted = deferred(), bAck = deferred(), aSettling = deferred(), aCommit = deferred(); let begin = true
  t.after(() => { aResult.resolve(); bAck.resolve(); aCommit.resolve(); bResult.resolve(); h.storage.transaction = transaction })
  h.storage.transaction = async work => {
    if (begin) { const health = await transaction(work); bCommitted.resolve(); await bAck.promise; return health }
    return transaction(async tx => { aSettling.resolve(); await aCommit.promise; return work(tx) })
  }
  const b = h.guarded.getRepository(h.route.repository); await bCommitted.promise
  begin = false; aResult.resolve(); await aSettling.promise
  bAck.resolve(); await bEntered.promise
  const view = await h.queries.getDeliveryProjection(h.scope)
  assert.equal(nodes(view, 'pipeline_run').length, 0, 'a delayed healthy marker ack cannot clear an actual refusal while settlement waits')
  assert.doesNotMatch(JSON.stringify(view), /pr-canary|ci_passed|private-provider-canary/)
  aCommit.resolve(); assert.equal((await a).error.code, 'permission_denied'); bResult.resolve(); assert.equal((await b).ok, false)
})
for (const sqlite of [false, true]) test(`${sqlite ? 'SQLite' : 'Memory'} complete proof clears a failed refusal mask without reviving an older operation`, async t => {
  const h = await observationFixture(t, sqlite), dev = h.providers.development, transaction = h.storage.transaction.bind(h.storage), held = holdFirst(dev, 'getRepository')
  const older = h.guarded.getRepository(h.route.repository); await held.waiting
  dev.getRepository = async () => denied()
  h.storage.transaction = work => transaction(tx => work(new Proxy(tx, { get(object, key) {
    return key === 'putSyncCursor' ? async record => { if (record.lastErrorCode === 'permission_denied') throw Error('refusal-settlement-rollback'); return object[key](record) } : typeof object[key] === 'function' ? object[key].bind(object) : object[key]
  } })))
  await h.guarded.getRepository(h.route.repository); h.storage.transaction = transaction; dev.getRepository = held.original
  assert.equal(nodes(await h.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 0)
  assert.equal((await h.core.commands.refreshDeliveryFacts(h.scope)).applied, true)
  assert.ok(nodes(await h.queries.getDeliveryProjection(h.scope), 'pipeline_run').length)
  held.release(); assert.equal((await older).ok, false, 'a newer complete proof releases the mask but cannot revive the pre-refusal operation')
})

for (const sqlite of [false, true]) test(`${sqlite ? 'SQLite' : 'Memory'} failed actual refusal invalidates an older full read with the same durable version`, async t => {
  const h = await observationFixture(t, sqlite), delivery = h.providers.delivery, transaction = h.storage.transaction.bind(h.storage), held = holdFirst(delivery, 'listPipelineRuns')
  const older = refreshContextDelivery(h.context, h.scope); await held.waiting
  delivery.listPipelineRuns = async () => denied()
  h.storage.transaction = work => transaction(tx => work(new Proxy(tx, { get(object, key) {
    if (key === 'putDeliveryFacts') return async () => { throw Error('failed-attempt-disk-rollback') }
    return key === 'putSyncCursor' ? async record => { if (record.lastErrorCode === 'permission_denied') throw Error('refusal-settlement-rollback'); return object[key](record) } : typeof object[key] === 'function' ? object[key].bind(object) : object[key]
  } })))
  assert.equal((await refreshContextDelivery(h.context, h.scope)).applied, false)
  h.storage.transaction = transaction; delivery.listPipelineRuns = held.original; held.release()
  assert.equal((await older).applied, false, 'a pre-refusal full read cannot grant scope after denial settlement rollback')
  assert.equal(nodes(await h.queries.getDeliveryProjection(h.scope), 'pipeline_run').length, 0)
  assert.equal((await refreshContextDelivery(h.context, h.scope)).applied, true)
  assert.ok(nodes(await h.queries.getDeliveryProjection(h.scope), 'pipeline_run').length)
})
