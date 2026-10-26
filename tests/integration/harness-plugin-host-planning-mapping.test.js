import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createSqliteStorage, openDatabase } from '@harness-projects/storage-sqlite'
import { createEntityStore, createSync, createTransport } from '@harness-projects/client'
import { deriveWorkItemListView } from '@harness-projects/ui-model'
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
async function fake(t, definitions, saved) {
  const env = await sandbox(t); let reads = 0, writeCount = 0
  const entry = fakePlanningEntry((provider) => {
    for (const project of provider.state.projects) project.ref = { ...project.ref, externalId: projectNodeId }
    provider.state.items = [] // Empty Project still discovers definitions via its stored projectNodeId.
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
