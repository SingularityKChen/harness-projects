import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createWorkspaceSetupSource, parseWorkspaceSetup } from '@harness-projects/client'
import { SqliteStorage } from '@harness-projects/storage-sqlite'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { PROVIDER_CATALOG } from '../../apps/harness-plugin/src/host-providers.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { WORKSPACE, projectNodeId, replayFetch } from './fixtures/host-seed.js'
const actor = { kind: 'user' }, gate = () => { let resolve; const promise = new Promise((yes) => { resolve = yes }); return { promise, resolve } }
const turn = () => new Promise((resolve) => setImmediate(resolve))
async function open(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'host-setup-')), dataPath = path.join(dir, 'workspace.sqlite'), replay = replayFetch()
  let viewer = 'U_viewer_canary', broken = false, viewerReads = 0
  const host = await createHostComposition({ dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, resolveCredential: async () => 'credential-canary', planningTimers: { setInterval: () => 1, clearInterval: () => {} },
    fetch: (url, init) => url.endsWith('/user') ? (viewerReads++, Promise.resolve(new Response(JSON.stringify({ node_id: viewer, login: 'viewer-login-canary' })))) : broken ? Promise.resolve(new Response('{}', { status: 401 })) : replay.fetch(url, init) })
  const installed = await installHostRemote({ invocation: { peer: { id: 'fixture-peer' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  t.after(async () => { host.stop(); await installed.dispose(); await host.dispose(); await rm(dir, { recursive: true, force: true }) })
  const read = async () => parseWorkspaceSetup(await installed.service.getWorkspaceSetup())
  const sql = (statement) => { const db = new DatabaseSync(dataPath); try { return db.prepare(statement).get() } finally { db.close() } }
  const bind = async () => { await installed.service.createWorkspace(actor, 'create', 'One workspace'); const account = await installed.service.connectAccount(actor, 'account'); return installed.service.bindPlanningSource(actor, 'bind', account.value.accountId, projectNodeId) }
  return { host, service: installed.service, read, sql, bind, broken: (value) => { broken = value }, viewer: (value) => { viewer = value }, viewerReads: () => viewerReads }
}

test('empty/read-only DTO, rejected create, duplicate create and exact no-argument setup read', async (t) => {
  const h = await open(t)
  assert.deepEqual(await h.read(), { workspace: null, planning: { state: 'unbound' } })
  await assert.rejects(() => h.host.call('getWorkspaceSetup', { workspaceId: 'foreign' }), /未知字段/)
  assert.equal((await h.service.createWorkspace(actor, 'blank', ' ')).writeState, 'failed'); assert.equal((await h.read()).workspace, null)
  const results = await Promise.all([h.service.createWorkspace(actor, 'create', 'One'), h.service.createWorkspace(actor, 'create', 'One')])
  assert.deepEqual(results[0], results[1]); assert.equal(h.sql('SELECT count(*) AS n FROM workspace').n, 1)
  assert.deepEqual(await h.read(), { workspace: { id: WORKSPACE, name: 'One' }, planning: { state: 'unbound' } })
})

test('confirmed requires active scope and full sync; degraded errors/origin are safe and recover after real refresh', async (t) => {
  const h = await open(t); await h.bind(); const confirmed = await h.read()
  assert.equal(confirmed.planning.state, 'confirmed'); assert.equal(confirmed.workspace.id, WORKSPACE); assert.equal(confirmed.planning.projectNodeId, projectNodeId); assert.ok(confirmed.planning.bindingId); assert.equal(confirmed.mappingOrigin, 'derived')
  for (const canary of ['credential-canary', 'U_viewer_canary', 'viewer-login-canary', 'secretHandle', 'configuration']) assert.equal(JSON.stringify(confirmed).includes(canary), false)
  h.broken(true); await h.service.refreshPlanning(actor); const failed = await h.read()
  assert.equal(failed.planning.state, 'degraded'); assert.equal(failed.error.code, 'permission_denied')
  h.sql("UPDATE sync_cursor SET last_error_code = 'raw-error-canary'")
  const unknown = await h.read(); assert.equal(unknown.error.code, 'unavailable'); assert.equal(JSON.stringify(unknown).includes('raw-error-canary'), false)
  h.broken(false); await h.service.refreshPlanning(actor); assert.equal((await h.read()).planning.state, 'confirmed')
  h.sql("UPDATE workspace_binding SET configuration_json = '{}' WHERE domain = 'planning'")
  const damaged = await h.read(); assert.equal(damaged.planning.state, 'degraded'); assert.equal(damaged.planning.projectNodeId, undefined); assert.equal(damaged.mappingOrigin, undefined)
})

test('persisted settings after activation failure read as configured, retain activationError, and same key activates', async (t) => {
  const h = await open(t); await h.service.createWorkspace(actor, 'create', 'One workspace'); const account = await h.service.connectAccount(actor, 'account')
  const put = SqliteStorage.prototype.putWorkspace; let once = true
  t.mock.method(SqliteStorage.prototype, 'putWorkspace', function (...args) { if (once) { once = false; throw new Error('activation-secret-canary') } return put.apply(this, args) })
  const result = await h.service.bindPlanningSource(actor, 'bind', account.value.accountId, projectNodeId); assert.equal(result.activationError.code, 'unavailable')
  const configured = await h.read(); assert.equal(configured.planning.state, 'configured'); assert.equal(configured.activationError.code, 'unavailable'); assert.equal(JSON.stringify(configured).includes('activation-secret-canary'), false)
  await h.service.bindPlanningSource(actor, 'bind', account.value.accountId, projectNodeId); assert.equal((await h.read()).planning.state, 'confirmed')
})

test('real client retries unknown create with one row; same connect intent rechecks viewer before allowing bind', async (t) => {
  const h = await open(t), bind = t.mock.method(h.service, 'bindPlanningSource'), keys = []; let lost = true
  const source = createWorkspaceSetupSource({ ...h.service, createWorkspace: async (...args) => { keys.push(args[1]); const result = await h.service.createWorkspace(...args); if (lost) { lost = false; throw new Error('lost outer result') } return result } }, { actorRef: actor, key: () => 'intent' })
  await source.create('One'); await source.create('One'); assert.equal(keys[0], keys[1]); assert.equal(h.sql('SELECT count(*) AS n FROM workspace').n, 1)
  await source.connect(projectNodeId); assert.equal(source.getSnapshot().setup.planning.state, 'confirmed'); assert.equal(bind.mock.callCount(), 1)
  h.viewer('U_changed'); await source.connect(projectNodeId)
  assert.equal(source.getSnapshot().error.code, 'conflict'); assert.equal(bind.mock.callCount(), 1); assert.equal(h.viewerReads(), 2); source.dispose()
})

test('setup reader fences captured empty across actual createWorkspace and waits outside transition without deadlock', async (t) => {
  for (const waitBeforeRead of [true, false]) {
    const h = await open(t), entered = gate(), release = gate(), get = SqliteStorage.prototype.getWorkspace; let once = true
    const mock = t.mock.method(SqliteStorage.prototype, 'getWorkspace', async function (...args) { const value = await get.apply(this, args); if (once) { once = false; assert.equal(value, undefined); entered.resolve(); await release.promise } return value })
    const create = () => h.service.createWorkspace(actor, 'fenced-create', 'Created after empty capture')
    const first = waitBeforeRead ? create() : h.read(); await entered.promise
    const second = waitBeforeRead ? h.read() : create(); let settled = false
    second.then(() => { settled = true }, () => {}); await turn(); assert.equal(settled, false, 'create must wait for the admitted read lease; a later reader must wait outside the barrier')
    release.resolve(); const values = await Promise.all([first, second]); mock.mock.restore()
    const setup = waitBeforeRead ? values[1] : values[0], created = waitBeforeRead ? values[0] : values[1]
    assert.equal(created.writeState, 'local_only'); assert.deepEqual(created.value, { workspaceId: WORKSPACE })
    assert.deepEqual(setup, { workspace: { id: WORKSPACE, name: 'Created after empty capture' }, planning: { state: 'unbound' } })
  }
})
