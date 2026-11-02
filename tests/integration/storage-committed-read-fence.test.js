import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFakeStorage } from '../../packages/providers/fake/src/index.ts'
import { CLOSED_MESSAGE, createSqliteStorage } from '../../packages/storage/sqlite/src/index.ts'

const workspace = { id: '00000000-0000-4000-8000-000000000468', name: 'fence', statusPolicy: 'manual_only' }
for (const [label, make] of [['memory', () => createFakeStorage()], ['sqlite', () => createSqliteStorage(':memory:')]]) {
  test(`${label} committed read fence changes after commit and survives rollback`, async (t) => {
    const storage = make(); t.after(() => storage.close?.())
    assert.equal(typeof storage.committedReadFence(), 'string')
    const before = storage.committedReadFence()
    await storage.putWorkspace(workspace)
    const after = storage.committedReadFence()
    assert.notEqual(after, before)
    await assert.rejects(storage.transaction(async (tx) => { await tx.putWorkspace({ ...workspace, name: 'rolled back' }); throw new Error('rollback') }))
    assert.equal(storage.committedReadFence(), after)
    await storage.transaction(async (tx) => { assert.throws(() => tx.committedReadFence(), /嵌套事务不被支持/) })
    assert.equal(storage.committedReadFence(), after)
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

const deferred = () => Promise.withResolvers()
for (const [label, make] of [['memory', () => createFakeStorage()], ['sqlite', () => createSqliteStorage(':memory:')]]) {
  test(`${label} dirty transaction advances only after commit and read-only transaction preserves token`, async t => {
    const storage = make(); t.after(() => storage.close?.()); await storage.putWorkspace(workspace)
    const before = storage.committedReadFence(), entered = deferred(), release = deferred()
    t.after(() => release.resolve())
    const writing = storage.transaction(async tx => { await tx.putWorkspace({ ...workspace, name: 'committed' }); entered.resolve(); await release.promise })
    await entered.promise; assert.equal(storage.committedReadFence(), before)
    release.resolve(); await writing; const after = storage.committedReadFence()
    assert.notEqual(after, before); assert.equal((await storage.getWorkspace(workspace.id)).name, 'committed')
    await storage.transaction(async tx => { assert.equal((await tx.getWorkspace(workspace.id)).name, 'committed') })
    assert.equal(storage.committedReadFence(), after)
  })
  test(`${label} another root transaction cannot hide an active ancestor transaction`, async t => {
    const first = make(), second = make(); t.after(() => { first.close?.(); second.close?.() })
    await first.transaction(async () => {
      assert.throws(() => first.committedReadFence(), /嵌套事务不被支持/)
      await second.transaction(async () => { assert.throws(() => first.committedReadFence(), /嵌套事务不被支持/) })
    })
  })
}
test('SQLite root fence detects a committed direct write before accepting a delayed old read', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'committed-window-')), location = path.join(root, 'project.sqlite')
  const writer = createSqliteStorage(location), observer = createSqliteStorage(location)
  t.after(async () => { writer.close(); observer.close(); await rm(root, { recursive: true, force: true }) })
  await writer.putWorkspace(workspace)
  const entered = deferred(), external = observer.committedReadFence(); let release
  t.after(() => release?.())
  const delayedRead = () => new Promise((resolve, reject) => {
    writer.getWorkspace(workspace.id).then(value => { release = () => resolve(value); entered.resolve() }, reject)
  })
  const reading = (async () => {
    const before = writer.committedReadFence()
    const old = await delayedRead()
    return { before, after: writer.committedReadFence(), external: observer.committedReadFence(), old }
  })()
  await entered.promise; const writing = writer.putWorkspace({ ...workspace, name: 'new' }); release()
  const result = await reading; await writing
  assert.notEqual(result.external, external, 'another public connection has observed the commit inside the guarded read')
  assert.equal(result.old.name, workspace.name); assert.equal((await observer.getWorkspace(workspace.id)).name, 'new')
  assert.notEqual(result.after, result.before, 'the writer fence must observe the same commit before returning the old read')
})
