import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeProviders } from '../../packages/providers/fake/src/index.ts'
import { composeCore } from '../../packages/core/src/index.ts'

test('two Memory Core owners observe one shared committed generation', async () => {
  const providers = createFakeProviders(), workspace = { id: '00000000-0000-4000-8000-000000000469', name: 'shared' }
  const first = await composeCore({ workspace, providers }), second = await composeCore({ workspace, providers })
  const before = first.queries.getDeliveryAccessVersion()
  await providers.storage.putWorkspace({ id: workspace.id, name: 'shared-updated', statusPolicy: 'manual_only' })
  assert.notEqual(first.queries.getDeliveryAccessVersion(), before)
  assert.notEqual(second.queries.getDeliveryAccessVersion(), before)
})
