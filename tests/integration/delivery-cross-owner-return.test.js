import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { composeCore, defaultIdFactory } from '@harness-projects/core'
import { createFakeProviders, refOf } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { catalogOf } from '../../apps/harness-plugin/src/host-providers.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { SqliteStorage } from '../../packages/storage/sqlite/src/index.ts'
import { registerRepository } from '../../packages/core/src/development-route.ts'
import { fakePlanningEntry, mount, seed, seedWorkspace, WORKSPACE } from './fixtures/host-seed.js'

const workspace = { id: '00000000-0000-4000-8000-000000000469', name: 'Cross-owner delivery' }
const nodes = (projection, kind) => projection.hops.filter((hop) => hop.entityKind === kind)
const denied = () => ({ ok: false, error: { code: 'permission_denied', message: 'private-provider-canary' } })
const defer = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
const within = (promise, ms, message) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), ms)
  promise.then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
})

async function coreFixture(t, sqlite) {
  const providers = createFakeProviders(), root = sqlite ? await mkdtemp(path.join(tmpdir(), 'delivery-cross-owner-')) : undefined
  const storage = sqlite ? createSqliteStorage(path.join(root, 'project.sqlite')) : providers.storage
  if (sqlite) t.after(async () => { storage.close(); await rm(root, { recursive: true, force: true }) })
  const core = await composeCore({ workspace, providers, storage })
  const workItemId = (await core.queries.listPlanningItems()).find((row) => row.content.contentKind === 'work_item').entityId
  const scope = { workItemId, repositoryId: 'repo-alpha' }
  const started = await core.commands.startWork({ ...scope, actor: { kind: 'user' }, idempotencyKey: 'cross-owner-core' })
  assert.equal(started.confirmed, true)
  assert.equal((await providers.development.createChangeRequest({ repository: refOf(providers.development.gate.bindingId, 'repository', scope.repositoryId), head: started.branchExternalId, base: 'main', title: 'cross-owner-pr', body: '' })).ok, true)
  await core.commands.refreshDeliveryFacts(scope)
  return { core, providers, storage, scope }
}

for (const sqlite of [false, true]) test(`${sqlite ? 'SQLite' : 'Memory'} Core read retries after another owner commits Delivery denial`, async (t) => {
  const h = await coreFixture(t, sqlite)
  assert.ok(nodes(await h.core.queries.getDeliveryProjection(h.scope), 'pipeline_run').length)
  const other = await composeCore({ workspace, providers: h.providers, storage: h.storage })
  const getSyncCursor = h.storage.getSyncCursor.bind(h.storage), entered = defer(), release = defer()
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

async function sharedHostFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'delivery-cross-owner-host-')), dataPath = path.join(root, 'workspace.sqlite')
  let hosts = [], installed = []
  t.after(async () => { await Promise.all(installed.map((remote) => remote.dispose())); await Promise.all(hosts.map((host) => host.dispose())); await rm(root, { recursive: true, force: true }) })
  const providers = createFakeProviders(), entry = fakePlanningEntry()
  entry.create = async ({ binding }) => providers[binding.domain]
  const catalog = catalogOf([entry]), bindingIds = {
    planning: providers.planning.bindingId, development: providers.development.gate.bindingId,
    delivery: providers.delivery.gate.bindingId, execution: providers.execution.gate.bindingId,
  }
  await seed(dataPath, catalog, async (storage) => {
    await seedWorkspace(storage)
    for (const domain of Object.keys(bindingIds)) await storage.putProviderBinding(mount(bindingIds[domain], domain, 'harness.fake'))
    await storage.transaction((tx) => registerRepository(tx, defaultIdFactory, WORKSPACE, 'repo-alpha', [bindingIds.development]))
  })
  const options = { dataPath, workspaceId: WORKSPACE, catalog, resolveCredential: async () => undefined, watchIntervalMs: 60_000 }
  for (let index = 0; index < 2; index++) {
    const host = await createHostComposition(options)
    hosts.push(host)
    installed.push(await installHostRemote({ invocation: { peer: { id: `cross-owner-${index}` } }, provide: () => () => {}, typert: { register: () => () => {} } }, host))
  }
  return { providers, installed }
}

test('real Host return fence retries after another Host commits denial during final scope guard', async (t) => {
  const h = await sharedHostFixture(t), [first, second] = h.installed, repositoryId = 'repo-alpha'
  const item = (await first.service.baseline()).entities.find((entity) => entity.content.contentKind === 'work_item')
  assert.ok(item)
  const scope = { workItemId: item.entityId, repositoryId }
  for (const check of h.providers.delivery.state.checks) { check.status = 'queued'; check.conclusion = undefined }
  const started = await first.service.startWork({ kind: 'user' }, 'cross-owner-host', scope.workItemId, scope.repositoryId, undefined)
  assert.equal(started.writeState, 'confirmed')
  const context = await first.service.getExecutionContext(scope.workItemId, scope.repositoryId)
  assert.ok(context.context.branchExternalId)
  assert.equal((await h.providers.development.createChangeRequest({ repository: refOf(h.providers.development.gate.bindingId, 'repository', scope.repositoryId), head: context.context.branchExternalId, base: 'main', title: 'cross-owner-host-pr', body: '' })).ok, true)
  const prepared = await first.service.refreshDeliveryFacts({ kind: 'user' }, scope.workItemId, scope.repositoryId)
  assert.equal(prepared.value.applied, true)
  assert.ok(nodes((await first.service.getDeliveryProjection(scope.workItemId, scope.repositoryId)).projection, 'pipeline_run').length)

  const entered = defer(), release = defer(), original = SqliteStorage.prototype.transaction
  let owner, held = false, calls = 0
  const mock = t.mock.method(SqliteStorage.prototype, 'transaction', async function (work) {
    const value = await original.call(this, work)
    if (!owner) owner = this
    if (this === owner && !held && ++calls === 4) { held = true; entered.resolve(); await release.promise }
    return value
  })
  const reading = first.service.getDeliveryProjection(scope.workItemId, scope.repositoryId)
  let response
  try {
    await within(entered.promise, 5000, 'final scope guard was not reached')
    h.providers.delivery.listPipelineRuns = async () => denied()
    const result = await second.service.refreshDeliveryFacts({ kind: 'user' }, scope.workItemId, scope.repositoryId)
    assert.equal(result.value.applied, true)
    release.resolve()
    response = await reading
  } finally {
    release.resolve()
    mock.mock.restore()
  }
  const projection = response.projection
  assert.equal(nodes(projection, 'pipeline_run').length, 0, 'Host must re-read after the final asynchronous scope guard')
  assert.ok(nodes(projection, 'check_run').length, 'the permitted check collection remains visible')
  assert.ok(nodes(projection, 'check_run').every((hop) => hop.fact !== 'ci_passed'), 'no success fact may survive in this response')
})
