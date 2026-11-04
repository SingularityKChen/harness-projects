import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createWorkspaceSetup } from '@harness-projects/core'
import { createSqliteStorage, SqliteStorage } from '@harness-projects/storage-sqlite'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { apply as applyHost } from '../../apps/harness-plugin/src/host.ts'
import { PROVIDER_CATALOG, hostStoragePolicy } from '../../apps/harness-plugin/src/host-providers.ts'
import { WORKSPACE, HANDLE, seed, seedWorkspace, seedPlanning, replayFetch } from './fixtures/host-seed.js'

const actor = { kind: 'user' }, message = '当前 Core Host 不支持此已存规划策略；原数据库保留，请停止使用并等待支持该策略的版本。'
const turn = () => new Promise(resolve => setImmediate(resolve))
function timers() {
  const live = new Set(), callbacks = []
  return { live, callbacks, setInterval(run) { live.add(run); callbacks.push(run); return run }, clearInterval(run) { assert.ok(live.delete(run)) } }
}
async function fixture(t, policy = 'provider_authoritative', execution = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'host-policy-')), dataPath = path.join(root, 'harness-projects', 'workspace.sqlite')
  t.after(() => rm(root, { recursive: true, force: true }))
  await seed(dataPath, PROVIDER_CATALOG, async s => { await seedWorkspace(s); await seedPlanning(s) })
  const clock = timers(), replay = replayFetch()
  const options = { dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, fetch: replay.fetch, resolveCredential: async () => 'canary-admission-token', planningTimers: clock, watchIntervalMs: 1 }
  const initial = await createHostComposition(options)
  assert.ok((await initial.call('baseline', {})).entities.length > 0)
  await initial.dispose()
  const s = createSqliteStorage(dataPath, hostStoragePolicy(PROVIDER_CATALOG))
  try {
    if (execution) assert.equal((await createWorkspaceSetup(s).installExecutionBindings({ workspaceId: WORKSPACE })).ok, true)
    await s.putWorkspace({ ...(await s.getWorkspace(WORKSPACE)), name: 'CANARY_WORKSPACE', statusPolicy: policy })
    const row = (await s.listPlanningProjections(WORKSPACE)).find(r => r.content.contentKind === 'work_item')
    await s.putPlanningProjection(WORKSPACE, { ...row, planningStatus: 'done' })
  } finally { s.close() }
  await writeFile(path.join(root, 'profile-config.json'), JSON.stringify({ marker: 'CANARY_CONFIG', credentialHandle: HANDLE }))
  return { root, dataPath, clock, replay, options }
}
async function snapshot(h) {
  const db = new DatabaseSync(h.dataPath, { readOnly: true })
  try {
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all()
    const tables = schema.filter(r => r.type === 'table').map(r => r.name)
    const rows = Object.fromEntries(tables.map(n => [n, db.prepare('SELECT * FROM "' + n + '"').all().map(r => JSON.stringify(r)).sort()]))
    const files = {}
    for (const name of await readdir(h.root, { recursive: true })) {
      const bytes = await readFile(path.join(h.root, name)).catch(e => { if (e.code === 'EISDIR') return; throw e })
      if (bytes) files[name] = createHash('sha256').update(bytes).digest('hex')
    }
    return { schema, generation: db.prepare('PRAGMA user_version').get().user_version, rows, files }
  } finally { db.close() }
}
function observed(h) {
  const calls = { factories: 0, fetch: 0, credential: 0, session: 0, timers: 0, provide: 0, remote: 0 }
  const catalog = new Map([...PROVIDER_CATALOG].map(([key, entry]) => { const create = entry.create; return [key, { ...entry, create: async input => { calls.factories++; return create.call(entry, input) } }] }))
  const options = { ...h.options, catalog, fetch: (...args) => { calls.fetch++; return h.replay.fetch(...args) }, resolveCredential: async () => { calls.credential++; return 'canary-admission-token' }, sessionController: () => { calls.session++; return undefined }, planningTimers: { ...h.clock, setInterval(run, ms) { calls.timers++; return h.clock.setInterval(run, ms) } } }
  return { calls, options }
}

// Removing the admission, or putting it after factory/network work, violates both refusal and preservation.
for (const policy of ['host_authoritative', 'manual_only']) test(`policy startup ${policy}: 拒绝前无外部构造且原库逐字保留`, async t => {
  const h = await fixture(t, policy, true), before = await snapshot(h), { calls, options } = observed(h), effects = []
  for (const [key, entry] of PROVIDER_CATALOG) t.mock.method(entry, 'create', options.catalog.get(key).create)
  t.mock.method(globalThis, 'fetch', options.fetch)
  t.mock.method(globalThis, 'setInterval', (run, ms) => { calls.timers++; return h.clock.setInterval(run, ms) })
  t.mock.method(globalThis, 'clearInterval', run => h.clock.clearInterval(run))
  const originalClose = SqliteStorage.prototype.close
  const close = t.mock.method(SqliteStorage.prototype, 'close', function () { return originalClose.call(this) })
  const ctx = { get(name) { return name === 'profileContext' ? { dir: h.root } : name === 'credentials' ? { resolve: async () => { calls.credential++; return { value: 'canary-admission-token', source: 'test' } } } : name === 'sessionController' ? (calls.session++, undefined) : undefined },
    provide() { calls.provide++; return () => {} }, typert: { register() { calls.remote++; return () => {} } }, effect(run) { effects.push(run()) } }
  for (let attempt = 0; attempt < 2; attempt++) {
    let error
    try { await applyHost(ctx) } catch (e) { error = e }
    finally { for (const dispose of effects.splice(0)) await dispose() }
    t.diagnostic(JSON.stringify({ policy, attempt, calls, actualError: error?.name }))
    assert.equal(error?.name, 'HostPolicyAdmissionError', '合法不支持策略必须以专用准入错误拒绝')
    assert.equal(error.code, 'not_supported'); assert.equal(error.reason, 'unsupported_workspace_policy'); assert.equal(error.message, message)
    assert.doesNotMatch(error.message, /CANARY|host_authoritative|manual_only/)
    assert.deepEqual(calls, { factories: 0, fetch: 0, credential: 0, session: 0, timers: 0, provide: 0, remote: 0 })
    assert.equal(close.mock.callCount(), attempt + 1)
    assert.deepEqual(await snapshot(h), before, 'bytes/schema/user_version/all rows/config/handles all remain identical')
    const independent = new DatabaseSync(h.dataPath)
    try { independent.exec('BEGIN IMMEDIATE'); independent.exec('ROLLBACK') } finally { independent.close() }
  }
  assert.deepEqual(h.replay.misses, [])
})

test('policy admission precedes planning lifetime construction', async t => {
  const h = await fixture(t, 'manual_only'), { calls, options } = observed(h)
  await assert.rejects(() => createHostComposition({ ...options, planningReadTimeoutMs: 0 }), { name: 'HostPolicyAdmissionError' })
  assert.equal(calls.factories, 0)
})

test('supported empty database exposes settings and creates the Provider-authoritative workspace', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'host-policy-empty-')), dataPath = path.join(root, 'workspace.sqlite'), clock = timers()
  const host = await createHostComposition({ dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, resolveCredential: async () => undefined, planningTimers: clock })
  t.after(async () => { await host.dispose(); await rm(root, { recursive: true, force: true }) })
  assert.equal((await host.call('getWorkspaceSetup', {})).workspace, null)
  assert.equal((await host.call('createWorkspace', { actorRef: actor, idempotencyKey: 'empty-create', name: 'Supported' })).writeState, 'local_only')
  assert.equal((await host.call('getWorkspaceSetup', {})).workspace.name, 'Supported')
  await host.dispose(); assert.equal(clock.live.size, 0)
  const s = createSqliteStorage(dataPath, hostStoragePolicy(PROVIDER_CATALOG))
  try { assert.equal((await s.getWorkspace(WORKSPACE)).statusPolicy, 'provider_authoritative') } finally { s.close() }
})

test('supported Provider workspace retains nonempty identity across refresh scheduler and reopen', async t => {
  const h = await fixture(t), { calls, options } = observed(h)
  let host = await createHostComposition(options)
  t.after(() => host.dispose())
  const ids = (await host.call('baseline', {})).entities.map(row => row.entityId).sort()
  assert.ok(ids.length > 0); assert.equal(h.clock.live.size, 1)
  const before = calls.fetch
  assert.equal((await host.call('refreshPlanning', { actorRef: actor })).writeState, 'local_only')
  assert.ok(calls.fetch > before)
  const tick = h.clock.live.values().next().value, previous = calls.fetch
  tick()
  for (let i = 0; i < 50 && calls.fetch === previous; i++) await turn()
  assert.ok(calls.fetch > previous, 'the real scheduled round must reach the recorded Provider transport')
  await host.dispose(); assert.equal(h.clock.live.size, 0)
  const stopped = calls.fetch; tick(); await turn(); assert.equal(calls.fetch, stopped)
  host = await createHostComposition(options)
  assert.deepEqual((await host.call('baseline', {})).entities.map(row => row.entityId).sort(), ids)
  assert.equal(h.clock.live.size, 1); assert.deepEqual(h.replay.misses, [])
})

test('selected Provider policy ignores other workspaces with unsupported policies', async t => {
  const h = await fixture(t), s = createSqliteStorage(h.dataPath, hostStoragePolicy(PROVIDER_CATALOG))
  try { for (const policy of ['host_authoritative', 'manual_only']) await s.putWorkspace({ id: 'other-' + policy, name: 'Other', statusPolicy: policy }) } finally { s.close() }
  const host = await createHostComposition(h.options); t.after(() => host.dispose())
  assert.ok((await host.call('baseline', {})).entities.length > 0)
  assert.equal(h.clock.live.size, 1)
})

test('missing selected workspace permits setup beside a legitimate unsupported workspace', async t => {
  const h = await fixture(t, 'manual_only'), id = 'new-selected-workspace'
  const host = await createHostComposition({ ...h.options, workspaceId: id }); t.after(() => host.dispose())
  assert.equal((await host.call('getWorkspaceSetup', {})).workspace, null)
  assert.equal((await host.call('createWorkspace', { actorRef: actor, idempotencyKey: 'beside-other', name: 'New selected' })).writeState, 'local_only')
  assert.equal((await host.call('getWorkspaceSetup', {})).workspace.id, id)
  await host.dispose()
  const s = createSqliteStorage(h.dataPath, hostStoragePolicy(PROVIDER_CATALOG))
  try { assert.equal((await s.getWorkspace(id)).statusPolicy, 'provider_authoritative'); assert.equal((await s.getWorkspace(WORKSPACE)).statusPolicy, 'manual_only') } finally { s.close() }
})

async function bounded(task) {
  let timer
  try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Host owner did not settle')), 5000) })]) }
  finally { clearTimeout(timer) }
}
// Deleting only the dedicated stop must revive the old scheduler and fail this scenario.
for (const policy of ['host_authoritative', 'manual_only']) test(`policy replacement ${policy}: 已检测拒绝后停止旧Host`, async t => {
  const h = await fixture(t), { calls, options } = observed(h), host = await createHostComposition(options)
  const installed = await installHostRemote({ invocation: { peer: { id: 'trusted-policy-peer' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  const frames = installed.service.watch(new AbortController().signal)[Symbol.asyncIterator]()
  t.after(async () => { host.stop(); await frames.return(); await installed.dispose(); await host.dispose() })
  assert.equal((await frames.next()).value.kind, 'baseline')
  const pendingFrame = frames.next(), oldTick = h.clock.live.values().next().value, controller = host.controller
  const s = createSqliteStorage(h.dataPath, hostStoragePolicy(PROVIDER_CATALOG))
  try { await s.putWorkspace({ ...(await s.getWorkspace(WORKSPACE)), statusPolicy: policy }) } finally { s.close() }
  const before = await snapshot(h), previous = { ...calls }
  const result = await bounded(installed.service.installExecutionBindings(actor, 'policy-configure'))
  t.diagnostic(JSON.stringify({ policy, result: result.writeState, candidateFactories: calls.factories - previous.factories, liveTimers: h.clock.live.size }))
  assert.equal(result.writeState, 'local_only'); assert.equal(result.value.bindingIds.length, 2)
  assert.equal(h.clock.live.size, 0, 'a detected unsupported policy must not restart the old scheduler')
  assert.deepEqual(calls, previous, 'candidate refusal occurs before all external construction and cannot allocate a replacement timer')
  assert.deepEqual(JSON.parse(JSON.stringify(result.activationError)), { code: 'unavailable', message: '本地配置已提交，当前 Host 已停止', recovery: 'retry', retryable: true })
  assert.equal(host.controller, controller); assert.deepEqual(host.activationError, result.activationError)
  assert.equal((await bounded(pendingFrame)).done, true)
  oldTick(); for (let i = 0; i < 3; i++) await turn()
  assert.deepEqual(calls, previous)
  for (const [name, input] of [['baseline', {}], ['refreshPlanning', { actorRef: actor }], ['installExecutionBindings', { actorRef: actor, idempotencyKey: 'after-stop' }]]) await assert.rejects(() => host.call(name, input), /host 已关闭/)
  const after = await snapshot(h)
  for (const [table, rows] of Object.entries(before.rows)) {
    if (['provider_binding', 'workspace_binding'].includes(table)) { for (const row of rows) assert.ok(after.rows[table].includes(row)); assert.equal(after.rows[table].length, rows.length + 2) }
    else assert.deepEqual(after.rows[table], rows, table + ' existing business data must remain unchanged')
  }
  assert.equal(after.files['profile-config.json'], before.files['profile-config.json']); assert.deepEqual(after.schema, before.schema); assert.equal(after.generation, before.generation)
  await installed.dispose(); await bounded(host.dispose()); assert.equal(h.clock.live.size, 0); assert.deepEqual(h.replay.misses, [])
})

test('ordinary candidate failure with a lookalike error keeps the old graph and same-key recovery', async t => {
  const h = await fixture(t), host = await createHostComposition(h.options), old = host.controller
  t.after(() => host.dispose())
  const put = SqliteStorage.prototype.putWorkspace; let fail = true
  t.mock.method(SqliteStorage.prototype, 'putWorkspace', function (...args) {
    if (fail) { fail = false; throw Object.assign(new Error('ordinary-candidate-canary'), { name: 'HostPolicyAdmissionError', code: 'not_supported', reason: 'unsupported_workspace_policy' }) }
    return put.apply(this, args)
  })
  const input = { actorRef: actor, idempotencyKey: 'ordinary-retry' }
  const first = await host.call('installExecutionBindings', input)
  assert.equal(first.writeState, 'local_only'); assert.equal(first.activationError.message, '本地配置已提交，装配尚未激活')
  assert.equal(host.controller, old); assert.equal(h.clock.live.size, 1); assert.ok((await host.call('baseline', {})).entities.length > 0)
  const retry = await host.call('installExecutionBindings', input)
  assert.equal(retry.activationError, undefined); assert.deepEqual(retry.value, first.value)
  assert.notEqual(host.controller, old); assert.equal(h.clock.live.size, 1)
})
