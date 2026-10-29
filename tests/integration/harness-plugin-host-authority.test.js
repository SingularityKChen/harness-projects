import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createWorkspaceSetup } from '@harness-projects/core'
import { SqliteStorage } from '@harness-projects/storage-sqlite'
import { apply as applyHost } from '../../apps/harness-plugin/src/host.ts'
import { PROVIDER_CATALOG } from '../../apps/harness-plugin/src/host-providers.ts'
import { WORKSPACE, seed, seedWorkspace, dump } from './fixtures/host-seed.js'
import { fixtureFor, registerWorkItem } from './local-git-fixture.js'

const forged = { kind: 'human', id: 'forged-owner' }
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
async function directory(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'host-authority-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
async function runtime(t, profile, before = async () => {}) {
  await mkdir(profile, { recursive: true })
  const dbPath = path.join(profile, 'harness-projects', 'workspace.sqlite')
  await before(dbPath)
  const ctx = new Context()
  let stopHost
  new TypertRegistry(ctx)
  const gateway = new Gateway(ctx, { websocketHeartbeatIntervalMs: 2000, streamInboxBytes: 262144 })
  ctx.provide('profileContext', { dir: profile, home: path.dirname(profile), name: path.basename(profile) })
  const fiber = ctx.inject([], (scope) => {
    const effect = scope.effect.bind(scope)
    scope.effect = (run, label) => { const dispose = effect(run, label); if (label === 'harness-projects: host composition') stopHost = dispose; return dispose }
    return applyHost(scope)
  })
  await fiber.await()
  const peer = (id) => ({ id, ctx, dispose: async () => {} })
  const invoke = (method, args, id = 'trusted-a') => gateway.invoke({ namespace: 'harnessProjects', method, args, peer: peer(id) })
  let disposal
  const close = () => disposal ??= (async () => { await stopHost(); await fiber.dispose() })()
  t.after(close)
  return { ctx, gateway, invoke, dbPath, close }
}
function attempts(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  try { return db.prepare('SELECT idempotency_key, request_fingerprint FROM mutation_attempt ORDER BY idempotency_key').all().map((r) => ({ ...r })) } finally { db.close() }
}
async function executionSeed(file, fixture) {
  await seed(file, PROVIDER_CATALOG, async (storage) => {
    await seedWorkspace(storage)
    for (const id of ['wi-1', 'wi-2']) await registerWorkItem(storage, WORKSPACE, id)
    const bound = await createWorkspaceSetup(storage).bindRepository({ workspaceId: WORKSPACE, repositoryId: 'repo-alpha', references: [{ domain: 'development', implementationKey: 'development.local-git', configuration: { repositoryExternalId: 'repo-alpha', repositoryPath: fixture.repositoryPath } }] })
    assert.equal(bound.ok, true)
    for (const id of ['wi-1', 'wi-2']) await storage.putExternalIdentity({ id: `${id}-identity`, entityId: id, bindingId: bound.value.bindingIds[0], externalKind: 'issue', externalId: id, role: 'primary' })
  })
}
const start = (key, item = 'wi-1', actorRef = forged) => ({ actorRef, idempotencyKey: key, workItemId: item, repositoryId: 'repo-alpha' })

test('real Gateway and production Host persist trusted peer, ignore forged actors, bind replay to the connection', async (t) => {
  const fixture = await fixtureFor(t)
  const host = await runtime(t, path.join(fixture.root, 'profile'), (file) => executionSeed(file, fixture))
  const first = await host.invoke('startWork', start('first'))
  assert.equal(first.value.status, 'ready')
  assert.ok(first.value.worktreeExternalId.startsWith(path.join(fixture.root, 'profile', 'harness-projects', 'worktrees') + path.sep))
  const rows = attempts(host.dbPath)
  assert.deepEqual(JSON.parse(rows[0].request_fingerprint)[3], ['harness_peer', 'trusted-a'])
  assert.ok(!JSON.stringify(rows).includes('forged-owner'))
  const same = await host.invoke('startWork', start('first', 'wi-1', { kind: 'agent', id: 'different-forgery' }))
  assert.deepEqual(same, first)
  const before = dump(host.dbPath)
  assert.equal((await host.invoke('startWork', start('first'), 'trusted-b')).writeState, 'conflict')
  assert.deepEqual(dump(host.dbPath), before)
  // Re-open the real composition: the actor-bound receipt survives the controller cache.
  await host.close()
  const reopened = await runtime(t, path.join(fixture.root, 'profile'))
  assert.equal((await reopened.invoke('startWork', start('first'), 'trusted-b')).writeState, 'conflict')
  assert.deepEqual(attempts(reopened.dbPath), rows)
  await reopened.close()
})

test('interleaved real Gateway calls keep each peer in its own durable Start Work intent', async (t) => {
  const fixture = await fixtureFor(t)
  const host = await runtime(t, path.join(fixture.root, 'profile'), (file) => executionSeed(file, fixture))
  const entered = deferred(), release = deferred()
  const original = SqliteStorage.prototype.putMutationAttempt
  t.mock.method(SqliteStorage.prototype, 'putMutationAttempt', async function (record) {
    if (record.idempotencyKey === 'a' && record.state === 'pending') { entered.resolve(); await release.promise }
    return original.call(this, record)
  })
  const a = host.invoke('startWork', start('a'), 'peer-a')
  let b
  try {
    await Promise.race([entered.promise, a.then(() => { throw new Error('pending intent barrier was not reached') })])
    b = host.invoke('startWork', start('b', 'wi-2'), 'peer-b')
    release.resolve()
    assert.deepEqual((await Promise.all([a, b])).map((result) => result.value.status), ['ready', 'ready'])
    assert.deepEqual(attempts(host.dbPath).map((row) => JSON.parse(row.request_fingerprint)[3]), [['harness_peer', 'peer-a'], ['harness_peer', 'peer-b']])
  } finally { release.resolve(); await Promise.allSettled([a, b]) }
})

test('missing invocation or invalid peer fails closed before composition and writes, queries keep working', async (t) => {
  const profile = await directory(t), host = await runtime(t, profile)
  const before = dump(host.dbPath)
  for (const invocation of [undefined, {}, { peer: {} }, { peer: { id: '' } }, { peer: { id: 3 } }]) {
    const receiver = invocation === undefined ? host.ctx.get('harnessProjects') : host.ctx.extend({ invocation }).get('harnessProjects')
    await assert.rejects(() => receiver.createWorkspace(forged, 'denied', 'Forbidden'), { name: 'HostAuthorityError', message: 'Host connection identity is unavailable' })
    assert.deepEqual(dump(host.dbPath), before)
  }
  const invalid = await host.invoke('createWorkspace', { actorRef: forged, idempotencyKey: 'bad-peer', name: 'Forbidden' }, '').catch((error) => error)
  assert.deepEqual(host.gateway.wireStream.failure(invalid), { code: 'gateway/internal', message: 'Host connection identity is unavailable', details: {} })
  assert.deepEqual(dump(host.dbPath), before)
  assert.equal((await host.invoke('getWorkspaceSetup', {})).workspace, null)
  assert.equal((await host.invoke('createWorkspace', { actorRef: forged, idempotencyKey: 'allowed', name: 'Allowed' })).writeState, 'local_only')
})

test('authoritative profile dir isolates two profiles, retains restart state and ignores an inconsistent environment', async (t) => {
  const home = await directory(t)
  const configured = '~/' + path.relative(os.homedir(), home)
  assert.equal(resolveDshHome(configured), home, 'official helper expands a configured tilde home')
  const profiles = [path.join(home, 'profiles', 'one'), path.join(home, 'profiles', 'two')]
  t.mock.property(process, 'env', { ...process.env, DSH_HOME: path.join(home, 'wrong-home') })
  for (const [index, profile] of profiles.entries()) {
    const host = await runtime(t, profile)
    assert.equal((await host.invoke('createWorkspace', { actorRef: forged, idempotencyKey: 'create', name: `Workspace ${index}` })).writeState, 'local_only')
    await host.close()
    const reopened = await runtime(t, profile)
    assert.equal((await reopened.invoke('getWorkspaceSetup', {})).workspace.name, `Workspace ${index}`)
    assert.ok(existsSync(path.join(profile, 'harness-projects', 'workspace.sqlite')))
    await reopened.close()
  }
  assert.equal(existsSync(path.join(home, 'wrong-home', 'harness-projects')), false)
  assert.notDeepEqual(dump(path.join(profiles[0], 'harness-projects', 'workspace.sqlite')).workspace, dump(path.join(profiles[1], 'harness-projects', 'workspace.sqlite')).workspace)
})

test('absent, relative, missing or file profile metadata fails before opening any database', async (t) => {
  const root = await directory(t)
  t.mock.property(process, 'env', { ...process.env, DSH_HOME: root })
  for (const profile of [undefined, {}, { dir: '' }, { dir: 'relative' }, { dir: path.join(root, 'missing') }, { dir: import.meta.filename }]) {
    const ctx = new Context(); new TypertRegistry(ctx)
    if (profile !== undefined) ctx.provide('profileContext', profile)
    await assert.rejects(() => applyHost(ctx), { name: 'HostAuthorityError', message: 'Host profile directory is unavailable' })
    assert.deepEqual(await readdir(root), [])
  }
})
