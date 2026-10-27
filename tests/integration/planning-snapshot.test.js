import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { composeCore, PLANNING_SYNC_SCOPE } from '@harness-projects/core'
import { createController } from '@harness-projects/controller'
import { createFakeProviders, createFakeStorage, createFakePlanningProvider, FaultKind } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { newWorkspaceId } from '@harness-projects/domain'

const T = (n) => `2026-10-27T01:00:0${n}.000Z`
for (const [name, open] of [['Fake', createFakeStorage], ['SQLite', () => createSqliteStorage(':memory:')]]) {
  test(`${name}: snapshot holds one read scope across projection, identity, sync and revision`, async () => {
    const storage = open(), providers = createFakeProviders(), id = newWorkspaceId()
    let armed = false, entered = false, signal
    const writer = new Promise((resolve) => { signal = resolve }).then((rows) => storage.transaction(async (tx) => {
      for (const row of rows) {
        await tx.putPlanningProjection(id, { ...row, content: { contentKind: 'redacted', reason: 'permission_denied' } })
        for (const identity of await tx.listIdentitiesForEntity(row.entityId)) await tx.putExternalIdentity({ ...identity, role: 'alias' })
      }
      await tx.putReconcileCursor({ workspaceId: id, lastReconciledAt: T(2) })
      await tx.putSyncCursor({ workspaceId: id, bindingId: providers.planning.bindingId, scopeKey: PLANNING_SYNC_SCOPE, state: 'degraded', lastErrorCode: 'unavailable', cursorValue: undefined })
      await tx.advanceRevision(id)
    }))
    const wrap = (target) => new Proxy(target, { get(object, key) {
      const fn = Reflect.get(object, key)
      if (typeof fn !== 'function') return fn
      if (key === 'transaction') return (work) => fn.call(object, (tx) => work(wrap(tx)))
      return async (...args) => {
        const result = await fn.apply(object, args)
        if (armed && key === 'listPlanningProjections') {
          armed = false; entered = true
          signal(result)
          // Let an unprotected root read tear; an actual read tx keeps the writer queued.
          await new Promise((resolve) => setImmediate(resolve))
        }
        return result
      }
    } })
    const core = await composeCore({ workspace: { id, name }, providers, storage: wrap(storage), clock: () => T(1) })
    const before = await storage.currentRevision(id)
    const controller = createController(core, { workspaceRevision: () => storage.currentRevision(id) })
    const expectedIds = (await core.queries.listPlanningItems()).map((row) => row.entityId)
    armed = true
    const snapshot = await controller.baseline()
    await writer
    assert.equal(entered, true)
    assert.equal(snapshot.revision, before, 'old projections must have old business revision')
    assert.equal(snapshot.source.freshness, 'fresh')
    assert.equal(snapshot.source.reconciledAt, T(1))
    assert.deepEqual(snapshot.entities.map((row) => row.entityId), expectedIds, 'primary identities belong to the same read scope')
    assert.ok(snapshot.entities.some((row) => row.content.contentKind !== 'redacted'))
    assert.equal(await storage.currentRevision(id), before + 1, 'writer completes outside read scope')
    storage.close?.()
  })
}

test('controller ignores legacy revision callback and exposes only committed binding confirmation', async () => {
  const providers = createFakeProviders(), id = newWorkspaceId()
  let at = T(1), callbacks = 0
  const core = await composeCore({ workspace: { id, name: 'scope' }, providers, clock: () => at })
  const controller = createController(core, { workspaceRevision: async () => { callbacks++; return 900 } })
  const first = await controller.baseline()
  assert.equal(callbacks, 0)
  assert.equal(first.source.reconciledAt, T(1))
  at = T(2)
  await core.commands.refreshPlanning()
  const next = await controller.baseline()
  assert.equal(next.revision, first.revision)
  assert.equal(next.source.reconciledAt, T(2))
  const previousBinding = (await providers.storage.listProviderBindings(id)).find((binding) => binding.id === providers.planning.bindingId)
  await providers.storage.putProviderBinding({ ...previousBinding, enabled: false, isDefault: false })
  const planning = createFakePlanningProvider()
  planning.faultsSwitch.set(FaultKind.Offline, true)
  const rebound = await composeCore({ workspace: { id, name: 'scope' }, providers: { ...providers, planning }, clock: () => T(3) })
  assert.equal((await createController(rebound).baseline()).source.reconciledAt, undefined, 'workspace cursor cannot confirm a binding without committed round')
})
