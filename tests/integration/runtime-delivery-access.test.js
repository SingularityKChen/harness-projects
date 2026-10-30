import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { composeCore, defaultIdFactory } from '@harness-projects/core'
import { createFakeProviders, refOf } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { registerRepository } from '../../packages/core/src/development-route.ts'
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
