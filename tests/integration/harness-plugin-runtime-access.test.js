import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { FaultKind, fixtureProjectRef, createFakeDevelopmentProvider, createFakeDeliveryProvider, refOf } from '@harness-projects/provider-fake'
import { defaultIdFactory } from '@harness-projects/core'
import { registerRepository } from '../../packages/core/src/development-route.ts'
import { SqliteStorage } from '@harness-projects/storage-sqlite'
import { WorkItemApp, DeliveryLineageSection } from '@harness-projects/ui'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { apply } from '../../apps/harness-plugin/src/client.ts'
import { catalogOf } from '../../apps/harness-plugin/src/host-providers.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { createCarrier, createConnection, loadRemoteStream } from '../fixtures/remote-stream-double.js'
import { WORKSPACE, dump, fakePlanningEntry, mount, seed, seedWorkspace } from './fixtures/host-seed.js'
import { deriveWorkItemDetailView } from '@harness-projects/ui-model'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const turn = () => new Promise((resolve) => setTimeout(resolve, 5))
async function until(predicate) { for (let n = 0; n < 200 && !predicate(); n++) await turn(); assert.ok(predicate(), 'production watch must converge') }
async function open(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'runtime-host-')), dataPath = path.join(root, 'workspace.sqlite')
  let planning, Panel
  const development = createFakeDevelopmentProvider(), delivery = createFakeDeliveryProvider()
  const entry = fakePlanningEntry((provider) => { planning = provider }), createPlanning = entry.create
  entry.create = (input) => input.binding.domain === 'development' ? development : input.binding.domain === 'delivery' ? delivery : createPlanning(input)
  const catalog = catalogOf([entry])
  await seed(dataPath, catalog, async (storage) => {
    await seedWorkspace(storage)
    await storage.putProviderBinding(mount('00000000-0000-4000-8000-0000000000b1', 'planning', 'harness.fake'))
    await storage.putProviderBinding(mount(development.gate.bindingId, 'development', 'harness.fake'))
    await storage.putProviderBinding(mount(delivery.gate.bindingId, 'delivery', 'harness.fake'))
    await registerRepository(storage, defaultIdFactory, WORKSPACE, 'repo-alpha', [development.gate.bindingId])
  })
  const host = await createHostComposition({ dataPath, workspaceId: WORKSPACE, catalog, resolveCredential: async () => undefined, watchIntervalMs: 5 })
  const installed = await installHostRemote({ invocation: { peer: { id: 'runtime-peer' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  const { RemoteStream, RemoteStreamCarrierError } = await loadRemoteStream(), carrier = createCarrier(RemoteStreamCarrierError), connection = createConnection()
  const effects = [], rpc = []
  const remote = new Proxy({}, { get: (_, name) => name === 'watch'
    ? (signal) => carrier.open(installed.service, signal)
    : async (...args) => { rpc.push(name); return { ok: true, value: await installed.service[name](...args) } }
  })
  const child = { remote: { harnessProjects: remote, $stream: (options) => new RemoteStream(connection, options) },
    effect(callback) { effects.push(callback()) },
    slots: { inject(_name, callback) { callback() }, register(meta, component) { if (meta.name === 'main') Panel = component } } }
  await apply({ remote: { $mount: async () => {} }, inject(_names, callback) { callback(child) } })
  t.after(async () => { for (const stop of effects.reverse()) await stop?.(); await installed.dispose(); await host.dispose(); await rm(root, { recursive: true, force: true }) })
  const props = Panel().props
  await until(() => props.source.getSnapshot()?.connection.connected)
  return { development, delivery, host, service: installed.service, planning, carrier, connection, rpc, props, dataPath, catalog, installed, effects }
}

test('production Host/SQLite/remote/client.apply masks list and an open detail, then explicitly revalidates the same source', async (t) => {
  const h = await open(t), read = () => h.props.source.getSnapshot(), refresh = h.props.refreshSource
  h.planning.addItem(fixtureProjectRef(h.planning.bindingId), 'issue', 'runtime-title-canary', 'runtime-body-canary')
  h.planning.state.projects[0].title = 'runtime-source-canary'
  await h.service.refreshPlanning({ kind: 'user' })
  await until(() => read().store.list().some((row) => row.entity.content.title === 'runtime-title-canary'))
  const target = read().store.list().find((row) => row.entity.content.title === 'runtime-title-canary').entityId
  const html = () => renderToStaticMarkup(React.createElement(WorkItemApp, { ...h.props, initialPath: `/projects/${WORKSPACE}/items/${target}` }))
  assert.match(html(), /runtime-body-canary/)
  assert.equal((await h.service.startWork({ kind: 'user' }, 'host-saved', target, 'repo-alpha', undefined)).writeState, 'confirmed')
  const before = dump(h.dataPath), external = [h.development.state.branches.length, h.development.state.worktrees.length]
  const confirmation = read().reconciledAt, revision = read().store.revision
  h.planning.faultsSwitch.set(FaultKind.PermissionDenied, true)
  await refresh.refresh()
  await until(() => read().store.revision > revision)
  const hidden = html(), serialized = JSON.stringify(await h.service.baseline()) + JSON.stringify(read().store.list()) + hidden
  assert.doesNotMatch(serialized, /runtime-(title|body|source)-canary|private-provider-canary/)
  assert.ok(read().store.list().every((row) => row.entity.content.externalId === undefined && row.entity.content.externalKind === undefined))
  assert.match(hidden, /planning.item.read/)
  assert.match(hidden, /刷新规划/)
  assert.doesNotMatch(hidden.match(/<button[^>]*>刷新规划<\/button>/)?.[0] ?? '', /disabled/)
  assert.ok(JSON.parse(dump(h.dataPath).workspace_projection).every((row) => row.content_kind === 'redacted'))
  assert.equal(read().reconciledAt, confirmation)
  for (const key of ['host-saved', 'new-host-denied']) await assert.rejects(h.service.startWork({ kind: 'user' }, key, target, 'repo-alpha', undefined))
  for (const table of ['mutation_attempt', 'execution_context', 'execution_run']) assert.equal(dump(h.dataPath)[table], before[table])
  assert.deepEqual([h.development.state.branches.length, h.development.state.worktrees.length], external)
  h.planning.faultsSwitch.set(FaultKind.Offline, true); await refresh.refresh()
  assert.match(refresh.getSnapshot().error, /planning.item.read/, 'offline retry cannot downgrade an existing permission denial')
  h.planning.faultsSwitch.set(FaultKind.Offline, false)
  const retryCalls = h.rpc.filter((name) => name === 'refreshPlanning').length
  h.planning.faultsSwitch.set(FaultKind.PermissionDenied, false)
  await refresh.refresh()
  assert.equal(h.rpc.filter((name) => name === 'refreshPlanning').length, retryCalls + 1, 'denied connected source must reach real RPC')
  await until(() => read().store.list().some((row) => row.entity.content.title === 'runtime-title-canary'))
  assert.match(html(), /runtime-body-canary/)
  assert.equal(read().store.list().find((row) => row.entity.content.title === 'runtime-title-canary').entityId, target)
  assert.equal(h.carrier.opened, 1, 'same Host watch and client source recover without reload')
  h.connection.setOnline(false); h.carrier.break(); await until(() => !read().connection.connected)
  const disconnectedCalls = h.rpc.length; await refresh.refresh(); assert.equal(h.rpc.length, disconnectedCalls, 'disconnected retry sends no RPC')
})

test('failed SQLite redaction uses same-revision gap and a safe baseline on the existing production client', async (t) => {
  const h = await open(t), read = () => h.props.source.getSnapshot()
  const target = read().store.list().find((row) => row.entity.content.contentKind === 'work_item'), title = target.entity.content.title
  const revision = read().store.revision, replace = SqliteStorage.prototype.replacePlanningProjections
  const fail = t.mock.method(SqliteStorage.prototype, 'replacePlanningProjections', function (scope, rows) {
    if (rows.some((row) => row.content.contentKind === 'redacted')) throw new Error('redaction-disk-fault')
    return replace.call(this, scope, rows)
  })
  h.planning.faultsSwitch.set(FaultKind.PermissionDenied, true)
  await assert.rejects(h.service.refreshPlanning({ kind: 'user' }))
  await until(() => read().store.list().every((row) => row.entity.content.contentKind === 'redacted'))
  assert.equal(read().store.revision, revision, 'failed transaction never claims a persisted revision')
  assert.equal((await h.service.baseline()).revision, revision)
  const html = renderToStaticMarkup(React.createElement(WorkItemApp, { ...h.props, initialPath: `/projects/${WORKSPACE}/items/${target.entityId}` }))
  assert.ok(!html.includes(title))
  assert.ok(h.carrier.frames.some((frame) => frame.kind === 'gap'))
  assert.equal(h.carrier.frames.filter((frame) => frame.kind === 'baseline').length, 2)
  assert.ok(JSON.parse(dump(h.dataPath).workspace_projection).some((row) => row.content_kind === 'work_item'), 'rollback retained old disk contents without publishing them')
  await assert.rejects(h.service.startWork({ kind: 'user' }, 'disk-denied', target.entityId, 'repo-alpha', undefined))
  assert.equal(dump(h.dataPath).mutation_attempt, '[]')
  fail.mock.restore(); await h.service.refreshPlanning({ kind: 'user' })
  await until(() => read().store.revision > revision)
})

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
for (const phase of ['claim', 'first-write', 'intent-commit']) test(`runtime denial during ${phase} prevents external work and preserves only previously committed admission`, async (t) => {
  const h = await open(t), target = h.props.source.getSnapshot().store.list().find((r) => r.entity.content.contentKind === 'work_item').entityId
  const external = [h.development.state.branches.length, h.development.state.worktrees.length]
  const io = deferred(), inProvider = deferred(), entered = deferred(), release = deferred(), list = h.planning.listPlanningItems.bind(h.planning)
  h.planning.listPlanningItems = async (...args) => { inProvider.resolve(); await io.promise; return list(...args) }
  const refresh = h.service.refreshPlanning({ kind: 'user' }); await inProvider.promise
  if (phase === 'claim') {
    const find = SqliteStorage.prototype.findMutationAttempt; let calls = 0
    t.mock.method(SqliteStorage.prototype, 'findMutationAttempt', async function (...args) {
      const value = await find.apply(this, args)
      if (args[1] === 'admission-race' && ++calls === 2) { entered.resolve(); await release.promise }
      return value
    })
  } else if (phase === 'intent-commit') {
    const put = SqliteStorage.prototype.putMutationAttempt
    t.mock.method(SqliteStorage.prototype, 'putMutationAttempt', async function (...args) {
      const value = await put.apply(this, args)
      if (args[0].externalIntent?.operation === 'createBranch') { entered.resolve(); await release.promise }
      return value
    })
  } else {
    const preflight = h.development.preflightWorktree.bind(h.development)
    h.development.preflightWorktree = async (...args) => { entered.resolve(); await release.promise; return preflight(...args) }
  }
  const start = h.service.startWork({ kind: 'user' }, 'admission-race', target, 'repo-alpha', undefined).catch(() => undefined)
  await entered.promise
  h.planning.faultsSwitch.set(FaultKind.PermissionDenied, true); io.resolve(); await new Promise((done) => setImmediate(done))
  const observed = await h.host.controller.commands.startWork({ actorRef: { kind: 'user' }, idempotencyKey: 'observe-denial', workItemId: target, repositoryId: 'repo-alpha' })
  assert.equal(observed.error.code, 'permission_denied')
  release.resolve(); await Promise.all([start, refresh])
  assert.deepEqual([h.development.state.branches.length, h.development.state.worktrees.length], external)
  for (const table of ['mutation_attempt', 'execution_context']) assert.equal(JSON.parse(dump(h.dataPath)[table]).length, phase === 'claim' ? 0 : 1)
  assert.equal(dump(h.dataPath).execution_run, '[]')
  if (phase === 'intent-commit') assert.equal(JSON.parse(dump(h.dataPath).mutation_attempt)[0].external_intent_json, null, 'uncommitted external intent rolls back')
})
test('ignored older denial returns fixed safe errors over the real remote', async (t) => {
  const h = await open(t), entered = [deferred(), deferred()], release = [deferred(), deferred()]; let calls = 0
  h.planning.listPlanningItems = async () => { const n = calls++; entered[n].resolve(); await release[n].promise; return h.planning.fail('permission_denied', 'protected-source-canary native-locator-canary') }
  const old = h.service.bootstrapWorkspace({ kind: 'user' }, 'old-error'); await entered[0].promise
  const current = h.service.bootstrapWorkspace({ kind: 'user' }, 'current-error'); await entered[1].promise
  release[1].resolve(); await current
  release[0].resolve(); const result = await old
  assert.doesNotMatch(JSON.stringify(result), /protected-source-canary|native-locator-canary/)
  assert.equal((await h.service.baseline()).source.reason, 'permission_denied')
})

function openedSection(props) {
  const cells = []; let cursor, last, effects = []
  const cell = (make) => cells[cursor++] ?? (cells[cursor - 1] = make())
  const dispatcher = { useRef: (value) => cell(() => ({ current: value })), useState: (value) => { const state = cell(() => ({ value })); return [state.value, (next) => { state.value = typeof next === 'function' ? next(state.value) : next }] }, useEffect: (run, deps) => { const state = cell(() => ({})); if (!state.deps || deps.some((value, index) => value !== state.deps[index])) effects.push(() => { state.cleanup?.(); state.cleanup = run() }); state.deps = deps } }
  return { props, html() { cursor = 0; const shared = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, previous = shared.ReactCurrentDispatcher.current; shared.ReactCurrentDispatcher.current = dispatcher; let element; try { element = DeliveryLineageSection(props) } finally { shared.ReactCurrentDispatcher.current = previous } last = element; return renderToStaticMarkup(element) }, refresh() { last.props.children.at(-1).props.onClick() }, flush() { const pending = effects; effects = []; pending.forEach((run) => run()) }, close() { cells.forEach((state) => state.cleanup?.()) } }
}
for (const reject of [false, true]) test(`production Delivery Host/watch/apply invalidates an open section before a late ${reject ? 'rejection' : 'success'} and recovers`, async (t) => {
  const h = await open(t), read = () => h.props.source.getSnapshot()
  const target = read().store.list().find((row) => row.entity.content.contentKind === 'work_item').entityId
  const scope = { workspaceId: WORKSPACE, workItemId: target, repositoryId: 'repo-alpha' }
  const started = await h.service.startWork({ kind: 'user' }, 'delivery-host', target, scope.repositoryId, undefined)
  assert.equal(started.writeState, 'confirmed')
  const context = await h.service.getExecutionContext(target, scope.repositoryId)
  await h.development.createChangeRequest({ repository: refOf(h.development.gate.bindingId, 'repository', scope.repositoryId), head: context.context.branchExternalId, base: 'main', title: 'host-pr-canary', body: '' })
  const token = () => JSON.stringify(read().repositories), reader = h.props.deliveryReader
  let hold = false, finish
  const section = openedSection({ scope, connected: true, accessToken: token(), reader: { refresh: (scope) => reader.refresh(scope), read: async (scope) => { const value = await reader.read(scope); if (hold) { hold = false; await new Promise((resolve, fail) => { finish = () => reject ? fail(new Error('late-private-canary')) : resolve() }) } return value } } })
  t.after(section.close); section.html(); section.flush(); await until(() => /data-position="pipeline_run".*data-state=/.test(section.html()))
  const beforePlanning = JSON.stringify(read().store.list()), beforeToken = token()
  hold = true; section.refresh(); await until(() => finish !== undefined)
  h.delivery.listPipelineRuns = async () => ({ ok: false, error: { code: 'permission_denied', message: 'private-provider-canary' } })
  await reader.refresh(scope); await until(() => token() !== beforeToken)
  section.props.accessToken = token()
  assert.doesNotMatch(section.html(), /completed: success/, 'first render must discard old protected labels before effects')
  section.flush(); await until(() => /delivery.pipeline.read/.test(section.html()))
  finish(); await turn()
  const hidden = section.html(); assert.match(hidden, /delivery.pipeline.read/); assert.match(hidden, /检查/); assert.doesNotMatch(hidden, /late-private-canary|private-provider-canary|completed: success/)
  assert.equal(JSON.stringify(read().store.list()), beforePlanning)
  assert.ok((await reader.read(scope)).projection.hops.some((hop) => hop.entityKind === 'check_run'))
  h.delivery.listPipelineRuns = Object.getPrototypeOf(h.delivery).listPipelineRuns.bind(h.delivery)
  const deniedToken = token(); await reader.refresh(scope); await until(() => token() !== deniedToken)
  section.props.accessToken = token(); section.html(); section.flush(); await until(() => /completed: success/.test(section.html()))
  assert.equal(h.carrier.opened, 1)
})
const nodes=(view,kind)=>view.hops.filter(hop=>hop.entityKind===kind)
const tick=()=>new Promise(done=>setImmediate(done))
const denied=()=>({ok:false,error:{code:'permission_denied',message:'synthetic-provider-canary'}})
async function prepare(h, index=0) {
 const target=h.props.source.getSnapshot().store.list().filter(row=>row.entity.content.contentKind==='work_item')[index].entityId
 const scope={workspaceId:WORKSPACE,workItemId:target,repositoryId:'repo-alpha'}
 assert.equal((await h.service.startWork({kind:'user'},'delivery-'+index,target,'repo-alpha',undefined)).writeState,'confirmed')
 const context=await h.service.getExecutionContext(target,'repo-alpha')
 await h.development.createChangeRequest({repository:refOf(h.development.gate.bindingId,'repository','repo-alpha'),head:context.context.branchExternalId,base:'main',title:'synthetic-pr-'+index,body:''})
 await h.props.deliveryReader.refresh(scope)
 assert.ok(nodes((await h.props.deliveryReader.read(scope)).projection,'pipeline_run').length)
 return scope
}
async function reconnect(t,h) {
 for(const stop of h.effects.reverse()) await stop?.()
 await h.installed.dispose(); await h.host.dispose()
 const host=await createHostComposition({dataPath:h.dataPath,workspaceId:WORKSPACE,catalog:h.catalog,resolveCredential:async()=>undefined,watchIntervalMs:60_000})
 const installed=await installHostRemote({invocation:{peer:{id:'restarted-peer'}},provide:()=>()=>{},typert:{register:()=>()=>{}}},host)
 const {RemoteStream,RemoteStreamCarrierError}=await loadRemoteStream(),carrier=createCarrier(RemoteStreamCarrierError),connection=createConnection()
 const effects=[];let Panel
 const remote=new Proxy({},{get:(_,name)=>name==='watch'?(signal)=>carrier.open(installed.service,signal):async(...args)=>({ok:true,value:await installed.service[name](...args)})})
 const child={remote:{harnessProjects:remote,$stream:options=>new RemoteStream(connection,options)},effect(callback){effects.push(callback())},slots:{inject(_name,callback){callback()},register(meta,component){if(meta.name==='main')Panel=component}}}
 await apply({remote:{$mount:async()=>{}},inject(_names,callback){callback(child)}})
 const props=Panel().props
 await until(()=>props.source.getSnapshot()?.connection.connected)
 t.after(async()=>{for(const stop of effects.reverse())await stop?.();await installed.dispose();await host.dispose()})
 return{host,service:installed.service,props}
}

test('real Host restart and client.apply do not revive untouched historical CI after another scope denial',async(t)=>{
 const h=await open(t),current=await prepare(h,0),history=await prepare(h,1)
 h.delivery.listPipelineRuns=async()=>denied()
 await h.props.deliveryReader.refresh(current)
 assert.equal(nodes((await h.props.deliveryReader.read(history)).projection,'pipeline_run').length,0)
 const resumed=await reconnect(t,h)
 const value=await resumed.props.deliveryReader.read(history)
 t.diagnostic(JSON.stringify({newHostHistoricalPipelineNodes:nodes(value.projection,'pipeline_run').length,newClientRepositories:resumed.props.source.getSnapshot().repositories}))
 assert.equal(nodes(value.projection,'pipeline_run').length,0,'a real new Host/client must retain the historical scope denial')
})

test('real Host restart after rejected SQLite redaction retains denied scope',async(t)=>{
 const h=await open(t),scope=await prepare(h),put=SqliteStorage.prototype.putDeliveryFacts
 const mocked=t.mock.method(SqliteStorage.prototype,'putDeliveryFacts',function(record){
   if(record.sets.some(set=>set.kind==='pipeline_run'&&set.nodes.length===0))throw new Error('synthetic-disk-fault')
   return put.call(this,record)
 })
 h.delivery.listPipelineRuns=async()=>denied()
 const result=await h.service.refreshDeliveryFacts({kind:'user'},scope.workItemId,scope.repositoryId)
 assert.equal(result.value.applied,false)
 assert.equal(nodes((await h.props.deliveryReader.read(scope)).projection,'pipeline_run').length,0)
 mocked.mock.restore()
 const resumed=await reconnect(t,h),value=await resumed.props.deliveryReader.read(scope)
 t.diagnostic(JSON.stringify({failedRefresh:result.value,newHostPipelineNodes:nodes(value.projection,'pipeline_run').length}))
 assert.equal(nodes(value.projection,'pipeline_run').length,0,'a new real Host must not restore a collection after its redaction failed')
})

test('real Host projection remains current through its final visibility confirmation',async(t)=>{
 const h=await open(t),scope=await prepare(h),inProvider=deferred(),releaseProvider=deferred(),inVisibility=deferred(),releaseVisibility=deferred()
 h.delivery.listPipelineRuns=async()=>{inProvider.resolve();await releaseProvider.promise;return denied()}
 // The provider call starts before the query and remains deferred until its final local visibility read.
 const refresh=h.host.controller.commands.refreshDeliveryFacts({workItemId:scope.workItemId,repositoryId:scope.repositoryId},{actorRef:{kind:'user'}})
 await inProvider.promise
 const list=SqliteStorage.prototype.listPlanningProjections;let count=0
 const mocked=t.mock.method(SqliteStorage.prototype,'listPlanningProjections',async function(...args){
   const value=await list.apply(this,args)
   if(++count===3){inVisibility.resolve();await releaseVisibility.promise}
   return value
 })
 const reading=h.props.deliveryReader.read(scope)
 await inVisibility.promise
 releaseProvider.resolve();await tick()
 releaseVisibility.resolve()
 const value=await reading
 mocked.mock.restore();await refresh
 const next=await h.props.deliveryReader.read(scope)
 t.diagnostic(JSON.stringify({returnedPipelineNodes:nodes(value.projection,'pipeline_run').length,nextReadPipelineNodes:nodes(next.projection,'pipeline_run').length,returnedPipelineFacts:nodes(value.projection,'pipeline_run').map(row=>row.fact)}))
 assert.equal(nodes(next.projection,'pipeline_run').length,0)
 assert.equal(nodes(value.projection,'pipeline_run').length,0,'the final scope confirmation must not let a prior protected projection escape')
})

test('coalesced available-denied-available metadata changes the real detail token and cannot revive historical cached CI', async (t) => {
  const h = await open(t), current = await prepare(h, 0), history = await prepare(h, 1), pipeline = h.delivery.listPipelineRuns.bind(h.delivery)
  const snapshot = () => h.props.source.getSnapshot()
  const token = () => deriveWorkItemDetailView({ read: snapshot(), metadata: { sourceNames: {} }, phase: 'received', refreshing: false }, { projectId: WORKSPACE, itemId: current.workItemId }).body.deliveryAccessTokens['repo-alpha']
  const initial = token(), section = openedSection({ scope: current, reader: h.props.deliveryReader, connected: true, accessToken: initial })
  t.after(section.close); section.html(); section.flush(); await until(() => /completed: success/.test(section.html()))
  h.delivery.listPipelineRuns = async () => denied(); await h.props.deliveryReader.refresh(current)
  h.delivery.listPipelineRuns = pipeline; await h.props.deliveryReader.refresh(history)
  const expected = (await h.service.baseline()).repositories[0].accessVersion
  await until(() => snapshot().repositories[0].accessVersion === expected)
  assert.notEqual(token(), initial, 'equal available fields still require a different access generation')
  section.props.accessToken = token()
  assert.doesNotMatch(section.html(), /completed: success/, 'the production token must distinguish equal availability before and after denial')
  section.flush(); await until(() => /delivery.pipeline.read/.test(section.html()))
  assert.equal(nodes((await h.props.deliveryReader.read(current)).projection, 'pipeline_run').length, 0)
})

for (const denied of [false, true]) test(`real Host restart ${denied ? 'keeps failed Planning redaction hidden' : 'retains ordinary offline cache'}`, async (t) => {
  const h = await open(t), before = await h.service.baseline(), target = before.entities.find((row) => row.content.contentKind === 'work_item')
  const reopen = async () => {
    const host = await createHostComposition({ dataPath: h.dataPath, workspaceId: WORKSPACE, catalog: h.catalog, resolveCredential: async () => undefined, watchIntervalMs: 60_000 })
    const installed = await installHostRemote({ invocation: { peer: { id: 'restarted-peer' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
    t.after(async () => { await installed.dispose(); await host.dispose() })
    return installed.service
  }
  const replace = SqliteStorage.prototype.replacePlanningProjections
  const fail = t.mock.method(SqliteStorage.prototype, 'replacePlanningProjections', function (scope, rows) {
    if (rows.some((row) => row.content.contentKind === 'redacted')) throw new Error('redaction-disk-fault')
    return replace.call(this, scope, rows)
  })
  if (denied) {
    h.planning.faultsSwitch.set(FaultKind.PermissionDenied, true)
    await assert.rejects(h.service.refreshPlanning({ kind: 'user' }))
  }
  fail.mock.restore(); for (const stop of h.effects) await stop?.(); await h.installed.dispose(); await h.host.dispose()
  const offline = t.mock.method(Object.getPrototypeOf(h.planning), 'getProject', async () => ({ ok: false, error: { code: 'unavailable', message: 'ordinary-offline' } }))
  const resumed = await reopen(), hidden = await resumed.baseline()
  if (denied) assert.ok(hidden.entities.every((row) => row.content.title === undefined && row.content.body === undefined && row.content.externalId === undefined))
  else assert.deepEqual(hidden.entities.map((row) => row.content), before.entities.map((row) => row.content))
  assert.equal(hidden.source.reason, denied ? 'permission_denied' : 'unavailable')
  if (denied) assert.equal(JSON.parse(dump(h.dataPath).sync_cursor).find((row) => row.scope_key === 'planning.project').last_error_code, 'permission_denied')
  const start = resumed.startWork({ kind: 'user' }, 'restarted-denial', target.entityId, 'repo-alpha', undefined)
  if (denied) await assert.rejects(start); else assert.notEqual((await start).writeState, 'confirmed')
  offline.mock.restore(); await resumed.refreshPlanning({ kind: 'user' })
  assert.equal((await resumed.baseline()).entities.find((row) => row.entityId === target.entityId).content.title, target.content.title)
})
