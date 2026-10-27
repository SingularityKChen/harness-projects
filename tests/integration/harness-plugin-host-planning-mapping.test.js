import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createSqliteStorage, openDatabase, SqliteStorage } from '@harness-projects/storage-sqlite'
import { createEntityStore, createSync, createTransport } from '@harness-projects/client'
import { deriveWorkItemListView, deriveWorkItemDetailView } from '@harness-projects/ui-model'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { catalogOf, hostStoragePolicy, PROVIDER_CATALOG } from '../../apps/harness-plugin/src/host-providers.ts'
import { WORKSPACE, GITHUB, fakePlanningEntry, mount, projectNodeId, replayFetch, seed, seedPlanning, seedWorkspace } from './fixtures/host-seed.js'

const fields = [
  { id: 'd', name: 'Target Date', kind: 'date' }, { id: 'i', name: 'Iteration', kind: 'iteration', iterations: [] },
  { id: 's', name: 'Status', kind: 'single_select', options: [{ id: 'x', name: 'Unknown' }, { id: 'done', name: 'Done' }, { id: 'progress', name: 'In Progress' }, { id: 'todo', name: 'Todo' }] },
]
const mapping = { status: { projectFieldId: 's', options: { done: 'done', progress: 'in_progress', todo: 'todo' } }, iterationFieldId: 'i', targetDateFieldId: 'd' }
const record = (origin = 'user') => ({ workspaceId: WORKSPACE, bindingId: GITHUB, projectExternalId: projectNodeId, origin, mapping })
const writes = ['createIssueWorkItem', 'createDraftItem', 'updateWorkItemContent', 'updatePlanningFields', 'movePlanningItem']
const timers = { setInterval: () => 1, clearInterval: () => {} }
async function sandbox(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'host-mapping-')); t.after(() => rm(root, { recursive: true, force: true }))
  return { root, dataPath: path.join(root, 'workspace.sqlite') }
}
const open = (dataPath, catalog, extra = {}) => createHostComposition({ dataPath, workspaceId: WORKSPACE, catalog, resolveCredential: async () => 'test-credential', planningTimers: timers, ...extra })
async function view(host) {
  const sync = createSync(createTransport(host.controller), createEntityStore()); await sync.connect()
  return deriveWorkItemListView({ read: sync.read(), metadata: { sourceNames: {} }, phase: 'received', refreshing: false })
}
async function fake(t, definitions, saved, prepare) {
  const env = await sandbox(t); let reads = 0, writeCount = 0
  const entry = fakePlanningEntry((provider) => {
    for (const project of provider.state.projects) project.ref = { ...project.ref, externalId: projectNodeId }
    if (prepare) prepare(provider)
    else provider.state.items = [] // Empty Project still discovers definitions via its stored projectNodeId.
    provider.listFieldDefinitions = async () => { reads++; return definitions() }
    for (const method of writes) provider[method] = () => { writeCount++; throw new Error('forbidden provider write') }
    return provider
  })
  entry.configuration = { projectNodeId: { kind: 'string', required: true, pattern: '.+', maxLength: 100 } }
  const catalog = catalogOf([entry])
  await seed(env.dataPath, catalog, async (storage) => {
    await seedWorkspace(storage); await storage.putProviderBinding(mount(GITHUB, 'planning', 'harness.fake'))
    await storage.putBindingConfiguration({ ref: { workspaceId: WORKSPACE, bindingId: GITHUB, domain: 'planning' }, configuration: { projectNodeId } })
    if (saved) await storage.putWorkspacePlanningMapping(saved)
  })
  return { ...env, catalog, reads: () => reads, writes: () => writeCount }
}
const saved = (env) => { const storage = createSqliteStorage(env.dataPath, hostStoragePolicy(env.catalog)); return storage.getWorkspacePlanningMapping(WORKSPACE).finally(() => storage.close()) }

test('Host derives exact fields in any order without provider writes and restores IDs after rename/failure', async (t) => {
  let definitions = fields
  const env = await fake(t, () => ({ ok: true, value: definitions }))
  let host = await open(env.dataPath, env.catalog)
  assert.deepEqual(await saved(env), record('derived'))
  assert.equal((await host.controller.baseline()).entities.length, 0)
  assert.equal((await view(host)).mappingSourceText, '字段映射：自动派生')
  await host.dispose()
  definitions = fields.map((field) => ({ ...field, name: 'renamed' }))
  host = await open(env.dataPath, env.catalog); await host.dispose()
  definitions = undefined
  host = await open(env.dataPath, env.catalog)
  assert.deepEqual(await saved(env), record('derived'))
  assert.equal((await host.controller.baseline()).planningSource.mappingOrigin, 'derived')
  await host.dispose(); assert.deepEqual([env.reads(), env.writes()], [1, 0])
})

test('Host rejects duplicate roles/options and wrong kinds without trim or case guessing', async (t) => {
  const ambiguous = [...fields, { ...fields[0], id: 'd2', name: 'Target date' }, { ...fields[1], id: 'i2' }]
  ambiguous[2] = { ...fields[2], options: [...fields[2].options, { id: 'todo2', name: 'Todo' }] }
  const env = await fake(t, () => ({ ok: true, value: ambiguous }))
  const host = await open(env.dataPath, env.catalog)
  assert.deepEqual((await saved(env)).mapping, { status: { projectFieldId: 's', options: { done: 'done', progress: 'in_progress' } } })
  await host.dispose(); assert.equal(env.writes(), 0)
  for (const definitions of [[...fields, { ...fields[2], id: 's2' }], fields.map((field) => ({ ...field, kind: 'unsupported' })), fields.map((field) => ({ ...field, name: ` ${field.name}` })), fields.map((field) => ({ ...field, name: field.name.toLowerCase() }))]) {
    const empty = await fake(t, () => ({ ok: true, value: definitions }))
    const h = await open(empty.dataPath, empty.catalog)
    if (definitions.length === 4) assert.equal((await saved(empty)).mapping.status, undefined)
    else assert.equal(await saved(empty), undefined)
    await h.dispose(); assert.equal(empty.writes(), 0)
  }
})

test('Host skips discovery for user configuration and isolates a mismatched project', async (t) => {
  for (const mismatch of [false, true]) {
    const env = await fake(t, () => { throw new Error('must not discover') }, { ...record(), projectExternalId: mismatch ? 'another-project' : projectNodeId })
    const host = await open(env.dataPath, env.catalog)
    assert.equal((await host.controller.baseline()).planningSource.mappingOrigin, mismatch ? undefined : 'user')
    if (!mismatch) assert.equal((await view(host)).mappingSourceText, '字段映射：用户配置')
    else assert.match(await readFile(path.join(env.root, 'diagnostics.log'), 'utf8'), /planningMappingScopeMismatch/)
    await host.dispose(); assert.deepEqual([env.reads(), env.writes()], [0, 0])
  }
})

test('failed discovery remains retryable and a user save wins over late derivation', async (t) => {
  let response = { ok: false, error: { code: 'unavailable' } }
  const env = await fake(t, () => response)
  let host = await open(env.dataPath, env.catalog); await host.dispose(); assert.equal(await saved(env), undefined)
  let release, entered; const gate = new Promise((resolve) => { release = resolve }); const start = new Promise((resolve) => { entered = resolve })
  response = gate
  // Promise resolution is adopted by the real provider read boundary.
  const entry = env.catalog.get('harness.fake'), build = entry.create
  entry.create = async (input) => { const provider = await build(input); const read = provider.listFieldDefinitions; provider.listFieldDefinitions = (...args) => { entered(); return read(...args) }; return provider }
  const pending = open(env.dataPath, env.catalog); await start
  await seed(env.dataPath, env.catalog, (storage) => storage.putWorkspacePlanningMapping(record()))
  release({ ok: true, value: fields }); host = await pending
  assert.deepEqual(await saved(env), record()); assert.equal((await host.controller.baseline()).planningSource.mappingOrigin, 'user')
  await host.dispose(); assert.equal(env.writes(), 0)
})

test('real GitHub read replay derives status/iteration/date, survives restart, and sends no mutations', async (t) => {
  const env = await sandbox(t); await seed(env.dataPath, PROVIDER_CATALOG, async (storage) => { await seedWorkspace(storage); await seedPlanning(storage) })
  const replay = replayFetch(), operations = []; let failFields = false
  const fetch = async (url, init) => {
    const request = JSON.parse(init.body); operations.push(request.operationName)
    assert.doesNotMatch(request.query, /\bmutation\b/)
    if (failFields && request.operationName === 'PlanningFields') throw new Error('definition unavailable')
    const response = await replay.fetch(url, init), body = await response.json()
    const visit = (value) => { if (!value || typeof value !== 'object') return; if (value.name === 'E1 Date') value.name = 'Target date'; if (value.name === 'E1 Iteration') value.name = 'Iteration'; for (const child of Object.values(value)) visit(child) }; visit(body)
    return new Response(JSON.stringify(body), { status: response.status })
  }
  const compose = () => open(env.dataPath, PROVIDER_CATALOG, { fetch })
  let host = await compose(); const first = await host.controller.baseline()
  assert.ok(first.entities.some((item) => item.planningStatus === 'in_progress' && item.planningFields?.targetDate === '2026-09-24' && item.planningFields?.iterationTitle === 'E1 Sprint 1'))
  assert.equal((await view(host)).mappingSourceText, '字段映射：自动派生'); await host.dispose()
  failFields = true; host = await compose()
  assert.deepEqual((await host.controller.baseline()).entities.map((item) => [item.planningStatus, item.planningFields]), first.entities.map((item) => [item.planningStatus, item.planningFields]))
  await host.dispose(); assert.equal(operations.filter((name) => name === 'PlanningFields').length, 1); assert.deepEqual(replay.misses, [])
})

test('old 002 shape is refused before migration without touching existing data', async (t) => {
  const env = await sandbox(t); await seed(env.dataPath, new Map(), seedWorkspace)
  const db = openDatabase(env.dataPath); db.exec('DROP TABLE workspace_planning_mapping'); const versions = db.prepare('SELECT * FROM schema_migrations').all(); db.close()
  assert.throws(() => createSqliteStorage(env.dataPath), /Planning mapping schema is outdated/)
  const check = openDatabase(env.dataPath); assert.deepEqual(check.prepare('SELECT * FROM schema_migrations').all(), versions)
  assert.equal(check.prepare("SELECT name FROM sqlite_master WHERE name = 'workspace_planning_mapping'").get(), undefined); assert.equal(check.prepare('SELECT count(*) AS n FROM workspace').get().n, 1); check.close()
})


test('definition reads obey the Host lifetime and a timeout stores no empty mapping', async (t) => {
  const env = await fake(t, () => new Promise(() => {}))
  const host = await open(env.dataPath, env.catalog, { planningReadTimeoutMs: 5 })
  assert.equal(await saved(env), undefined); await host.dispose()
  assert.deepEqual([env.reads(), env.writes()], [1, 0])
})

test('remote mapping changes activate once and reject stale or nonexistent choices without provider writes', async (t) => {
  const env = await fake(t, () => ({ ok: true, value: fields }), record())
  const host = await open(env.dataPath, env.catalog); t.after(() => host.dispose())
  const dto = await host.call('getPlanningMapping', {})
  assert.equal(dto.scope.bindingId, GITHUB); assert.equal(dto.fields[2].options[0].id, 'x')
  const input = { actorRef: { kind: 'user' }, idempotencyKey: 'change', expectedBindingId: GITHUB, expectedProjectExternalId: projectNodeId, mapping: { status: { projectFieldId: 's', options: { x: 'done' } } } }
  for (const change of [{ expectedBindingId: 'other' }, { expectedProjectExternalId: 'other' }, { mapping: { targetDateFieldId: 's' } }, { mapping: { status: { projectFieldId: 's', options: { removed: 'done' } } } }]) {
    const result = await host.call('setPlanningMapping', { ...input, ...change, idempotencyKey: JSON.stringify(change) })
    assert.ok(['conflict', 'invalid_input'].includes(result.error.code)); assert.deepEqual(await saved(env), record())
  }
  assert.equal((await host.call('setPlanningMapping', input)).writeState, 'local_only')
  assert.equal((await host.call('getPlanningMapping', {})).confirmed, true)
  assert.deepEqual((await saved(env)).mapping, input.mapping); assert.equal(env.writes(), 0)
})

test('same Host watch updates list and open drawer once; failed read retains configuration and retries, restart restores user IDs', async (t) => {
  let itemReads = 0, fail = false
  const env = await fake(t, () => ({ ok: true, value: fields }), record(), (provider) => {
    for (const item of provider.state.items) { item.project = provider.state.projects[0].ref; item.fields.nativeValues = { s: { kind: 'single_select', optionId: 'x', name: 'Native unknown' } } }
    const list = provider.listPlanningItems.bind(provider)
    provider.listPlanningItems = (...args) => { itemReads++; return fail ? { ok: false, error: { code: 'unavailable', message: 'offline' } } : list(...args) }
  })
  let host = await open(env.dataPath, env.catalog)
  const sync = createSync(createTransport(host.controller), createEntityStore()), abort = new AbortController()
  const stream = host.watch(abort.signal)[Symbol.asyncIterator](); t.after(() => { abort.abort(); return stream.return() })
  sync.receive((await stream.next()).value); const itemId = sync.read().store.list().find((item) => item.entity.content.contentKind === 'work_item').entityId
  const read = () => ({ read: sync.read(), metadata: { sourceNames: {} }, phase: 'received', refreshing: false })
  const target = { projectId: WORKSPACE, itemId }
  assert.match(deriveWorkItemDetailView(read(), target).body.planningStatus, /未映射/)
  const input = { actorRef: { kind: 'user' }, idempotencyKey: 'live', expectedBindingId: GITHUB, expectedProjectExternalId: projectNodeId, mapping: { status: { projectFieldId: 's', options: { x: 'done' } } } }
  const before = itemReads; await host.call('setPlanningMapping', input)
  sync.receive((await stream.next()).value)
  assert.equal(itemReads, before + 1)
  assert.equal(deriveWorkItemListView(read()).body.rows.find((row) => row.key === itemId).planningStatus, '已完成')
  assert.equal(deriveWorkItemDetailView(read(), target).body.planningStatus, '已完成')
  fail = true
  await host.call('setPlanningMapping', { ...input, idempotencyKey: 'failed-read', mapping: {} })
  assert.equal((await host.call('getPlanningMapping', {})).confirmed, false)
  assert.equal((await host.controller.baseline()).source.freshness, 'degraded')
  assert.deepEqual((await saved(env)).mapping, {})
  fail = false; await host.call('setPlanningMapping', { ...input, idempotencyKey: 'failed-read', mapping: {} })
  assert.equal((await host.call('getPlanningMapping', {})).confirmed, true)
  await host.dispose(); host = await open(env.dataPath, env.catalog)
  assert.equal((await host.call('getPlanningMapping', {})).origin, 'user'); await host.dispose(); assert.equal(env.writes(), 0)
})

test('activation failure keeps the acknowledged mapping, marks old Host content stale and retries activation', async (t) => {
  const env = await fake(t, () => ({ ok: true, value: fields }), record())
  const host = await open(env.dataPath, env.catalog); t.after(() => host.dispose())
  const original = SqliteStorage.prototype.getWorkspacePlanningMapping; let fail = true
  t.mock.method(SqliteStorage.prototype, 'getWorkspacePlanningMapping', async function (...args) {
    const value = await original.apply(this, args)
    if (fail && value?.mapping.status?.options.x === 'done') { fail = false; throw new Error('activation-canary') }
    return value
  })
  const input = { actorRef: { kind: 'user' }, idempotencyKey: 'activation', expectedBindingId: GITHUB, expectedProjectExternalId: projectNodeId, mapping: { status: { projectFieldId: 's', options: { x: 'done' } } } }
  const result = await host.call('setPlanningMapping', input)
  assert.equal(result.writeState, 'local_only'); assert.equal(result.activationError.code, 'unavailable')
  assert.deepEqual((await saved(env)).mapping, input.mapping)
  assert.equal((await host.call('baseline', {})).source.freshness, 'degraded')
  await host.call('setPlanningMapping', input); assert.equal((await host.call('getPlanningMapping', {})).confirmed, true)
})

test('new mapping requires this Core generation commit proof after read/cursor or begin/cursor double failure', async (t) => {
  for (const stage of ['read', 'begin']) await t.test(stage, async (t) => {
    let armed = false, itemReads = 0
    const env = await fake(t, () => ({ ok: true, value: fields }), { ...record(), mapping: { status: { projectFieldId: 's', options: { x: 'todo' } } } }, (provider) => {
      for (const item of provider.state.items) { item.project = provider.state.projects[0].ref; item.fields.nativeValues = { s: { kind: 'single_select', optionId: 'x', name: 'Native' } } }
      const list = provider.listPlanningItems.bind(provider)
      provider.listPlanningItems = (...args) => { itemReads++; return armed ? { ok: false, error: { code: 'unavailable' } } : list(...args) }
    })
    const host = await open(env.dataPath, env.catalog, { watchIntervalMs: 5 }); t.after(() => host.dispose())
    const sync = createSync(createTransport(host.controller), createEntityStore()), abort = new AbortController(), stream = host.watch(abort.signal)[Symbol.asyncIterator]()
    t.after(() => { abort.abort(); return stream.return() }); sync.receive((await stream.next()).value)
    assert.ok((await host.call('baseline', {})).entities.some((entity) => entity.planningStatus === 'todo'))
    for (const method of ['putSyncCursor', ...(stage === 'begin' ? ['putPlanningSyncRound'] : [])]) {
      const original = SqliteStorage.prototype[method]
      t.mock.method(SqliteStorage.prototype, method, function (...args) { if (armed) throw new Error('storage unavailable'); return original.apply(this, args) })
    }
    armed = true
    const input = { actorRef: { kind: 'user' }, idempotencyKey: 'proof', expectedBindingId: GITHUB, expectedProjectExternalId: projectNodeId, mapping: { status: { projectFieldId: 's', options: { x: 'done' } } } }
    assert.equal((await host.call('setPlanningMapping', input)).writeState, 'local_only')
    assert.equal((await saved(env)).mapping.status.options.x, 'done')
    assert.equal((await host.call('getPlanningMapping', {})).confirmed, false)
    const retained = await host.call('baseline', {}); assert.equal(retained.source.freshness, 'degraded'); assert.ok(retained.entities.some((entity) => entity.planningStatus === 'todo'))
    sync.receive((await stream.next()).value); assert.ok(sync.read().store.list().every((row) => row.stale))
    armed = false; const reads = itemReads; await host.call('setPlanningMapping', input)
    assert.equal(itemReads, reads + 1); assert.equal((await host.call('getPlanningMapping', {})).confirmed, true)
    const healed = await host.call('baseline', {}); assert.equal(healed.source.freshness, 'fresh'); assert.ok(healed.entities.some((entity) => entity.planningStatus === 'done'))
  })
})
