import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { FaultKind, fixtureProjectRef, createFakeDevelopmentProvider } from '@harness-projects/provider-fake'
import { defaultIdFactory } from '@harness-projects/core'
import { registerRepository } from '../../packages/core/src/development-route.ts'
import { SqliteStorage } from '@harness-projects/storage-sqlite'
import { WorkItemApp } from '@harness-projects/ui'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { apply } from '../../apps/harness-plugin/src/client.ts'
import { catalogOf } from '../../apps/harness-plugin/src/host-providers.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { createCarrier, createConnection, loadRemoteStream } from '../fixtures/remote-stream-double.js'
import { WORKSPACE, dump, fakePlanningEntry, mount, seed, seedWorkspace } from './fixtures/host-seed.js'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const turn = () => new Promise((resolve) => setTimeout(resolve, 5))
async function until(predicate) { for (let n = 0; n < 200 && !predicate(); n++) await turn(); assert.ok(predicate(), 'production watch must converge') }
async function open(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'runtime-host-')), dataPath = path.join(root, 'workspace.sqlite')
  let planning, Panel
  const development = createFakeDevelopmentProvider()
  const entry = fakePlanningEntry((provider) => { planning = provider }), createPlanning = entry.create
  entry.create = (input) => input.binding.domain === 'development' ? development : createPlanning(input)
  const catalog = catalogOf([entry])
  await seed(dataPath, catalog, async (storage) => {
    await seedWorkspace(storage)
    await storage.putProviderBinding(mount('00000000-0000-4000-8000-0000000000b1', 'planning', 'harness.fake'))
    await storage.putProviderBinding(mount(development.gate.bindingId, 'development', 'harness.fake'))
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
  return { development, host, service: installed.service, planning, carrier, connection, rpc, props, dataPath }
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
