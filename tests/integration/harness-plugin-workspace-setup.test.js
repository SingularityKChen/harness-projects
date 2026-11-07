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
async function open(t, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'host-setup-')), dataPath = path.join(dir, 'workspace.sqlite'), replay = replayFetch()
  let viewer = 'U_viewer_canary', broken = false, viewerReads = 0
  const host = await createHostComposition({ dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, resolveCredential: async () => 'credential-canary', planningTimers: { setInterval: () => 1, clearInterval: () => {} },
    fetch: (url, init) => url.endsWith('/user') ? (viewerReads++, Promise.resolve(new Response(JSON.stringify({ node_id: viewer, login: 'viewer-login-canary' })))) : broken ? Promise.resolve(new Response('{}', { status: 401 })) : replay.fetch(url, init), ...options })
  const installed = await installHostRemote({ invocation: { peer: { id: 'fixture-peer' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  t.after(async () => { host.stop(); await installed.dispose(); await host.dispose(); await rm(dir, { recursive: true, force: true }) })
  const read = async () => parseWorkspaceSetup(await installed.service.getWorkspaceSetup())
  const sql = (statement) => { const db = new DatabaseSync(dataPath); try { return db.prepare(statement).get() } finally { db.close() } }
  const bind = async () => { await installed.service.createWorkspace(actor, 'create', 'One workspace'); const account = await installed.service.connectAccount(actor, 'account'); return installed.service.bindPlanningSource(actor, 'bind', account.value.accountId, projectNodeId) }
  return { host, dataPath, service: installed.service, read, sql, bind, broken: (value) => { broken = value }, viewer: (value) => { viewer = value }, viewerReads: () => viewerReads }
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
  const latched = await h.read(); assert.equal(latched.error.code, 'permission_denied'); assert.equal(JSON.stringify(latched).includes('raw-error-canary'), false)
  h.broken(false); await h.service.refreshPlanning(actor); assert.equal((await h.read()).planning.state, 'confirmed')
  h.sql("UPDATE sync_cursor SET state = 'degraded', last_error_code = 'raw-error-canary'")
  const unknown = await h.read(); assert.equal(unknown.error.code, 'unavailable'); assert.equal(JSON.stringify(unknown).includes('raw-error-canary'), false)
  await h.service.refreshPlanning(actor)
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

for (const phase of ['ack', 'post-read', 'lost-ack']) test(`execution setup recovers through real Host after ${phase} without another install`, async (t) => {
  let modelCalls = 0
  const h = await open(t, { sessionController: () => ({ create: () => { modelCalls++; throw new Error('unexpected model') }, prompt: () => { modelCalls++; throw new Error('unexpected model') } }) }); await h.bind()
  const release = gate(), entered = gate(); let installs = 0, reads = 0
  const source = createWorkspaceSetupSource({ ...h.service,
    installExecutionBindings: async (...args) => {
      installs++; const result = await h.service.installExecutionBindings(...args)
      if (phase !== 'post-read') { entered.resolve(); await release.promise; if (phase === 'lost-ack') throw new Error('PRIVATE-ACK') }
      return result
    },
    getWorkspaceSetup: async () => {
      const value = await h.service.getWorkspaceSetup()
      if (phase === 'post-read' && reads++ === 1) { entered.resolve(); await release.promise; return { ...value, executionInstalled: false } }
      return value
    },
  }, { actorRef: actor, key: () => 'bounded-install', interactionTimeoutMs: 10 })
  t.after(() => { release.resolve(); source.dispose() })
  await source.refresh(); t.mock.timers.enable({ apis: ['setTimeout'] })
  const install = source.installExecution(); await entered.promise
  const pair = h.sql("SELECT group_concat(binding_id) AS ids FROM workspace_binding WHERE domain = 'execution'").ids
  t.mock.timers.tick(10); await turn()
  assert.equal(source.getSnapshot().pending, false, 'deadline ends interaction, never confirms command')
  assert.equal(source.getSnapshot().error.code, 'result_unknown')
  await source.installExecution(); assert.equal(installs, 1, 'in-flight or acknowledged intent cannot submit twice')
  await source.recoverExecution()
  assert.equal(source.getSnapshot().setup.executionInstalled, true); assert.equal(source.getSnapshot().error, undefined)
  const recovered = source.getSnapshot()
  release.resolve(); await install; await turn()
  assert.equal(source.getSnapshot(), recovered, 'late ack/read cannot overwrite current recovery')
  assert.equal(h.sql("SELECT group_concat(binding_id) AS ids FROM workspace_binding WHERE domain = 'execution'").ids, pair)
  assert.equal(h.sql('SELECT count(*) AS n FROM execution_context').n, 0)
  assert.equal(h.sql('SELECT count(*) AS n FROM execution_run').n, 0)
  assert.equal(modelCalls, 0)
})

test('execution current assembly confirmation stays orthogonal to real degraded planning', async (t) => {
  const h = await open(t); await h.bind(); h.broken(true); await h.service.refreshPlanning(actor)
  let installs = 0, reconciles = 0; const keys = []
  const source = createWorkspaceSetupSource({ ...h.service,
    installExecutionBindings: (...args) => { installs++; keys.push(args[1]); return h.service.installExecutionBindings(...args) },
    refreshPlanning: () => { reconciles++; throw new Error('recovery must only read') },
  }, { actorRef: actor, key: () => 'orthogonal' })
  t.after(() => source.dispose())
  await source.installExecution(); await source.recoverExecution()
  const { setup, pending, error } = source.getSnapshot()
  assert.equal(pending, false); assert.equal(error, undefined); assert.equal(setup.executionInstalled, true)
  assert.equal(setup.planning.state, 'degraded'); assert.equal(setup.error.code, 'permission_denied')
  assert.equal(installs, 1); assert.equal(reconciles, 0)
  h.sql("DELETE FROM workspace_binding WHERE domain = 'execution'")
  await source.refresh(); await source.installExecution()
  assert.notEqual(keys[1], keys[0], 'planning error cannot retain a finished execution intent and replay obsolete pair ids')
  assert.equal(source.getSnapshot().setup.executionInstalled, true)
})

test('persisted execution pair is not confirmed after failed assembly activation', async (t) => {
  const h = await open(t); await h.bind()
  const mock = t.mock.method(SqliteStorage.prototype, 'putWorkspace', () => { throw new Error('PRIVATE-ACTIVATION') })
  const result = await h.service.installExecutionBindings(actor, 'activation-fail')
  mock.mock.restore()
  assert.equal(result.activationError.code, 'unavailable')
  assert.equal(h.sql("SELECT count(*) AS n FROM workspace_binding WHERE domain = 'execution'").n, 2)
  const setup = await h.read()
  assert.notEqual(setup.executionInstalled, true, 'persistent rows alone cannot prove active assembly')
  assert.equal(setup.activationError.code, 'unavailable')
  assert.doesNotMatch(JSON.stringify(setup), /PRIVATE-ACTIVATION/)
})

for (const phase of ['old-lease', 'assembly']) test(`independent execution read cannot claim active before Host ${phase} barrier releases`, async (t) => {
  const h = await open(t); await h.bind()
  const entered = gate(), release = gate(), acknowledged = gate()
  const method = phase === 'old-lease' ? 'listPlanningProjections' : 'putWorkspace', original = SqliteStorage.prototype[method]
  let once = true, installs = 0
  const mock = t.mock.method(SqliteStorage.prototype, method, async function (...args) {
    const value = await original.apply(this, args)
    if (once) { once = false; entered.resolve(); await release.promise }
    return value
  })
  t.after(() => release.resolve())
  const old = phase === 'old-lease' ? h.service.baseline() : Promise.resolve()
  if (phase === 'old-lease') await entered.promise
  const source = createWorkspaceSetupSource({ ...h.service, installExecutionBindings: async (...args) => {
    installs++; const result = await h.service.installExecutionBindings(...args); acknowledged.resolve(); return result
  } }, { actorRef: actor, interactionTimeoutMs: 10 })
  t.after(() => source.dispose()); t.mock.timers.enable({ apis: ['setTimeout'] })
  const install = source.installExecution(); if (phase === 'assembly') await entered.promise
  await turn(); t.mock.timers.tick(10); await install
  assert.equal(source.getSnapshot().error.code, 'result_unknown')
  const read = source.recoverExecution(); await turn(); t.mock.timers.tick(10); await read
  assert.equal(source.getSnapshot().error.code, 'result_unknown'); assert.notEqual(source.getSnapshot().setup?.executionInstalled, true)
  await source.installExecution(); assert.equal(installs, 1)
  release.resolve(); await old; await acknowledged.promise; mock.mock.restore()
  await source.recoverExecution()
  assert.equal(source.getSnapshot().setup.executionInstalled, true); assert.equal(source.getSnapshot().error, undefined)
})

for (const state of ['disabled', 'custom']) test(`pure execution recovery preserves ${state} mounts without install`, async (t) => {
  const h = await open(t); await h.bind(); await h.service.installExecutionBindings(actor, 'existing')
  h.sql(state === 'disabled' ? "UPDATE workspace_binding SET enabled = 0 WHERE domain = 'execution' AND is_default = 0" : "UPDATE provider_binding SET implementation_key = 'custom.execution' WHERE id IN (SELECT binding_id FROM workspace_binding WHERE domain = 'execution')")
  const query = "SELECT group_concat(p.id || ':' || p.implementation_key || ':' || w.enabled || ':' || w.configuration_json) AS mounts FROM provider_binding p JOIN workspace_binding w ON w.binding_id = p.id WHERE w.domain = 'execution'"
  const before = h.sql(query)
  let installs = 0
  const source = createWorkspaceSetupSource({ ...h.service, installExecutionBindings: () => { installs++; throw new Error('unexpected install') } }, { actorRef: actor })
  t.after(() => source.dispose()); await source.recoverExecution()
  assert.notEqual(source.getSnapshot().setup.executionInstalled, true); assert.equal(source.getSnapshot().error.code, 'result_unknown')
  assert.deepEqual(h.sql(query), before)
  assert.equal(installs, 0)
})

test('reopened Host cannot confirm a pair when its human mount failed activation', async (t) => {
  const h = await open(t); await h.service.createWorkspace(actor, 'create', 'One workspace'); await h.service.installExecutionBindings(actor, 'install')
  const before = h.sql("SELECT group_concat(binding_id || ':' || configuration_json) AS mounts FROM workspace_binding WHERE domain = 'execution'")
  await h.host.dispose()
  const catalog = new Map(PROVIDER_CATALOG)
  catalog.set('execution.human', { ...catalog.get('execution.human'), create: () => { throw new Error('PRIVATE-FACTORY') } })
  const reopened = await createHostComposition({ dataPath: h.dataPath, workspaceId: WORKSPACE, catalog, resolveCredential: async () => undefined })
  t.after(() => reopened.dispose())
  assert.ok(reopened.disabled.some((mount) => mount.domain === 'execution'))
  assert.notEqual((await reopened.call('getWorkspaceSetup', {})).executionInstalled, true, 'both configured execution mounts must belong to the active assembly')
  const source = createWorkspaceSetupSource({ getWorkspaceSetup: () => reopened.call('getWorkspaceSetup', {}), installExecutionBindings: (actorRef, idempotencyKey) => reopened.call('installExecutionBindings', { actorRef, idempotencyKey }) }, { actorRef: actor })
  t.after(() => source.dispose()); await source.installExecution()
  assert.equal(source.getSnapshot().error?.code, 'result_unknown', 'an ack without active pair readback must expose an actionable unresolved result')
  assert.deepEqual(h.sql("SELECT group_concat(binding_id || ':' || configuration_json) AS mounts FROM workspace_binding WHERE domain = 'execution'"), before)
})

test('execution activation readback retains the original install intent after lost acknowledgement', async t => {
  const h = await open(t); await h.bind(); const keys = []; let planningWrites = 0
  const source = createWorkspaceSetupSource({ ...h.service,
    installExecutionBindings: async (...args) => { keys.push(args[1]); const value = await h.service.installExecutionBindings(...args); if (keys.length === 1) { assert.ok(value.activationError); throw Error('lost ack') } return value },
    connectAccount: async () => { planningWrites++; throw Error('unexpected Planning write') },
  }, { actorRef: actor, key: () => 'activation-install' })
  t.after(() => source.dispose()); await source.refresh()
  const mock = t.mock.method(SqliteStorage.prototype, 'putWorkspace', () => { throw Error('synthetic assembly failure') })
  await source.installExecution(); mock.mock.restore()
  assert.equal(source.getSnapshot().error.code, 'result_unknown')
  await source.recoverExecution()
  assert.equal(source.getSnapshot().failure, 'install', 'activation errors belong to the execution recovery route')
  assert.equal(source.getSnapshot().setup.activationError.code, 'unavailable')
  await source.installExecution()
  assert.deepEqual(keys, ['activation-install:execution', 'activation-install:execution'])
  assert.equal(source.getSnapshot().setup.executionInstalled, true); assert.equal(planningWrites, 0)
  assert.equal(h.sql("SELECT count(*) AS n FROM workspace_binding WHERE domain = 'execution'").n, 2)
  assert.equal(h.sql('SELECT count(*) AS n FROM execution_run').n, 0)
})
