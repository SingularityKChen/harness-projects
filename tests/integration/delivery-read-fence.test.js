import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFakeProviders, createFakeStorage } from '../../packages/providers/fake/src/index.ts'
import { composeCore } from '../../packages/core/src/index.ts'
import { CLOSED_MESSAGE, createSqliteStorage } from '../../packages/storage/sqlite/src/index.ts'

const workspace = { id: '00000000-0000-4000-8000-000000000468', name: 'fence', statusPolicy: 'manual_only' }
for (const [label, make] of [['memory', () => createFakeStorage()], ['sqlite', () => createSqliteStorage(':memory:')]]) {
  test(`${label} committed read fence changes after commit and survives rollback`, async (t) => {
    const storage = make(); t.after(() => storage.close?.())
    const before = storage.committedReadFence()
    await storage.putWorkspace(workspace)
    const after = storage.committedReadFence()
    assert.notEqual(after, before)
    await assert.rejects(storage.transaction(async (tx) => { await tx.putWorkspace({ ...workspace, name: 'rolled back' }); throw new Error('rollback') }))
    assert.equal(storage.committedReadFence(), after)
    await storage.transaction(async (tx) => { assert.throws(() => tx.committedReadFence(), /嵌套事务不被支持/) })
  })
}

test('SQLite committed read fence observes another connection commit', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'delivery-read-fence-')), location = path.join(root, 'project.sqlite')
  const first = createSqliteStorage(location), second = createSqliteStorage(location)
  t.after(async () => { first.close(); second.close(); await rm(root, { recursive: true, force: true }) })
  const before = first.committedReadFence()
  await second.putWorkspace(workspace)
  assert.notEqual(first.committedReadFence(), before)
})

test('SQLite committed read fence fails with the Storage closed contract', () => {
  const storage = createSqliteStorage(':memory:'); storage.close()
  assert.throws(() => storage.committedReadFence(), { message: CLOSED_MESSAGE })
})

test('SQLite atomic SQL writes advance the committed fence', async () => {
  const storage = createSqliteStorage(':memory:')
  try {
    await storage.putWorkspace(workspace)
    const before = storage.committedReadFence()
    await storage.putProviderBinding({ id: 'binding-fence', workspaceId: workspace.id, domain: 'planning', implementationKey: 'harness.fake', enabled: true, isDefault: true })
    const after = storage.committedReadFence(); assert.notEqual(after, before)
    const beforeRollback = storage.committedReadFence()
    await assert.rejects(storage.transaction(async (tx) => { await tx.putProviderBinding({ id: 'binding-rollback', workspaceId: workspace.id, domain: 'planning', implementationKey: 'harness.fake', enabled: true, isDefault: false }); throw new Error('rollback') }))
    assert.equal(storage.committedReadFence(), beforeRollback)
  } finally { storage.close() }
})

for (const [label, make] of [['memory', () => createFakeStorage()], ['sqlite', () => createSqliteStorage(':memory:')]]) test(`${label} root fence rejects inside transaction`, async (t) => {
  const storage = make(); t.after(() => storage.close?.())
  await storage.transaction(async () => {
    let error
    try { storage.committedReadFence() } catch (caught) { error = caught }
    assert.match(error?.message ?? '', /嵌套事务不被支持/)
  })
})

for (const [label, make] of [['memory', () => createFakeStorage()], ['sqlite', () => createSqliteStorage(':memory:')]]) test(`${label} settled commit callback can read the fence`, async (t) => {
  const storage = make(); t.after(() => storage.close?.()); let settled
  await storage.transaction(async () => { settled = new Promise((resolve) => setImmediate(() => { try { resolve(storage.committedReadFence()) } catch (error) { resolve(error) } })) })
  assert.equal(typeof await settled, 'string')
})

for (const [label, make] of [['memory', () => createFakeStorage()], ['sqlite', () => createSqliteStorage(':memory:')]]) test(`${label} settled rollback callback can read the fence`, async (t) => {
  const storage = make(); t.after(() => storage.close?.()); let settled
  await assert.rejects(storage.transaction(async () => { settled = new Promise((resolve) => setImmediate(() => { try { resolve(storage.committedReadFence()) } catch (error) { resolve(error) } })); throw new Error('rollback') }))
  assert.equal(typeof await settled, 'string')
})

test('two Memory Core owners observe one shared committed generation', async () => {
  const providers = createFakeProviders(), workspace = { id: '00000000-0000-4000-8000-000000000469', name: 'shared' }
  const first = await composeCore({ workspace, providers }), second = await composeCore({ workspace, providers })
  const before = first.queries.getDeliveryAccessVersion()
  await providers.storage.putWorkspace({ id: workspace.id, name: 'shared-updated', statusPolicy: 'manual_only' })
  assert.notEqual(first.queries.getDeliveryAccessVersion(), before)
  assert.notEqual(second.queries.getDeliveryAccessVersion(), before)
})
