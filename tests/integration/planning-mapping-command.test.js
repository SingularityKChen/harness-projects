import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeStorage, MemoryStorage } from '@harness-projects/provider-fake'
import { createWorkspaceSetup } from '@harness-projects/core'
import { createSetupCommands } from '@harness-projects/controller'
import { catalogOf, hostStoragePolicy } from '../../apps/harness-plugin/src/host-providers.ts'
import { WORKSPACE, GITHUB, projectNodeId, seedWorkspace, mount, fakePlanningEntry } from './fixtures/host-seed.js'

test('mapping command rejects stale scope and malformed mapping atomically; replay is zero-write', async (t) => {
  const entry = fakePlanningEntry(); entry.configuration = { projectNodeId: { kind: 'string', required: true, pattern: '.+', maxLength: 100 } }
  const storage = createFakeStorage(undefined, hostStoragePolicy(catalogOf([entry]))); await seedWorkspace(storage)
  await storage.putProviderBinding(mount(GITHUB, 'planning', 'harness.fake'))
  await storage.putBindingConfiguration({ ref: { workspaceId: WORKSPACE, bindingId: GITHUB, domain: 'planning' }, configuration: { projectNodeId } })
  const commands = createSetupCommands(createWorkspaceSetup(storage))
  assert.equal(typeof commands.setPlanningMapping, 'function', 'setup must expose the local mapping command')
  const input = { actorRef: { kind: 'user' }, idempotencyKey: 'one', workspaceId: WORKSPACE, expectedBindingId: GITHUB, expectedProjectExternalId: projectNodeId, mapping: { status: { projectFieldId: 's', options: { x: 'done' } } } }
  for (const change of [{ expectedBindingId: 'other' }, { expectedProjectExternalId: 'other' }, { mapping: { status: { projectFieldId: 's', options: { x: 'unknown' } } } }]) {
    const result = await commands.setPlanningMapping({ ...input, ...change, idempotencyKey: JSON.stringify(change) })
    assert.equal(result.error.code, change.mapping ? 'invalid_input' : 'conflict'); assert.equal(await storage.getWorkspacePlanningMapping(WORKSPACE), undefined)
  }
  assert.equal((await commands.setPlanningMapping(input)).writeState, 'local_only')
  const first = await storage.getWorkspacePlanningMapping(WORKSPACE)
  assert.equal(first.origin, 'user'); assert.deepEqual(first.mapping, input.mapping)
  let writes = 0; const put = MemoryStorage.prototype.putWorkspacePlanningMapping
  t.mock.method(MemoryStorage.prototype, 'putWorkspacePlanningMapping', function (...args) { writes++; return put.apply(this, args) })
  await commands.setPlanningMapping(input); await commands.setPlanningMapping({ ...input, idempotencyKey: 'another' })
  assert.equal(writes, 0)
})

test('composition proof rejects in-flight rounds and late superseded results; raw query before bootstrap keeps its contract', async () => {
  const { composeCore, createContext, createQueries } = await import('@harness-projects/core')
  const { createFakeProviders } = await import('@harness-projects/provider-fake')
  const providers = createFakeProviders(), workspace = { id: WORKSPACE, name: 'Proof' }
  const core = await composeCore({ providers, workspace })
  assert.equal((await core.queries.getPlanningSync()).stale, false)
  const context = await createContext({ providers, workspace })
  assert.equal((await createQueries(context).getPlanningSync()).stale, false, 'unbootstrapped raw reader preserves the persisted-cursor contract')
  const pending = [], list = providers.planning.listPlanningItems.bind(providers.planning)
  providers.planning.listPlanningItems = (...args) => new Promise((resolve) => { pending.push(() => resolve(list(...args))) })
  const first = core.commands.refreshPlanning(); assert.equal(core.commands.refreshPlanning(), first)
  while (pending.length < 1) await new Promise((resolve) => setImmediate(resolve))
  assert.equal((await core.queries.getPlanningSync()).stale, true, 'an admitted round has no commit ack yet')
  const newer = core.commands.bootstrapWorkspace()
  while (pending.length < 2) await new Promise((resolve) => setImmediate(resolve))
  pending[1](); assert.equal((await newer).ok, true)
  pending[0](); assert.equal((await first).ok, false)
  assert.equal((await core.queries.getPlanningSync()).stale, false, 'late superseded result cannot undo the newer commit proof')
})
