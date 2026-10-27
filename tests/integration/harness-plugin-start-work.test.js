import '../fixtures/resolution-preflight.mjs';
import assert from 'node:assert/strict'
import test from 'node:test'
import * as client from '@harness-projects/client'
import { createExecutionFixture } from '../fixtures/execution-drawer-browser.mjs'
test('Host options and command reject closed wire/scope and invisible targets before writes', async (t) => {
  const h = await createExecutionFixture(); t.after(h.close)
  const input = { actorRef: { kind: 'user' }, idempotencyKey: 'start', workItemId: h.itemId, repositoryId: 'repo-alpha' }
  assert.equal(typeof h.installed.service.getStartWorkOptions, 'function')
  const options = await h.installed.service.getStartWorkOptions(h.itemId)
  assert.deepEqual(options, { workspaceId: h.workspaceId, workItemId: h.itemId, executionMode: 'manual' })
  let writes = 0; const start = h.host.controller.commands.startWork
  h.host.controller.commands.startWork = (...args) => { writes++; return start(...args) }
  for (const invalid of [{ ...input, workspaceId: 'other' }, { ...input, branchName: 1 }, { ...input, extra: 1 }]) await assert.rejects(() => h.host.call('startWork', invalid), TypeError)
  await assert.rejects(() => h.installed.service.startWork(...Object.values(input), undefined, 'extra'), TypeError)
  await assert.rejects(() => h.host.call('startWork', { ...input, repositoryId: 'unbound' }))
  const get = h.host.controller.queries.getEntity
  for (const contentKind of ['change_request', 'redacted']) {
    h.host.controller.queries.getEntity = async (id) => ({ ...await get(id), content: { contentKind } })
    await assert.rejects(() => h.host.call('startWork', input))
    await assert.rejects(() => h.host.call('getStartWorkOptions', { workItemId: h.itemId }))
  }
  h.host.controller.queries.getEntity = get
  await assert.rejects(() => h.host.call('startWork', { ...input, workItemId: 'missing' }))
  const baseline = h.host.controller.baseline
  h.host.controller.baseline = async () => { const snapshot = await baseline(); h.host.controller.queries.getEntity = async (id) => ({ ...await get(id), content: { contentKind: 'redacted' } }); return snapshot }
  await assert.rejects(() => h.host.call('startWork', input))
  assert.equal(writes, 0)
})
test('real controller failed ledger needs a new attempt; SQLite and Git writes occur once', async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path')
  const { composeCore } = await import('@harness-projects/core'), { createController } = await import('@harness-projects/controller')
  const { createSqliteStorage, openDatabase } = await import('@harness-projects/storage-sqlite'), { createFakeProviders, FaultKind } = await import('@harness-projects/provider-fake')
  const root = await mkdtemp(join(tmpdir(), 'start-work-')), storage = createSqliteStorage(join(root, 'workspace.sqlite'))
  t.after(async () => { storage.close(); await rm(root, { recursive: true, force: true }) })
  const providers = createFakeProviders(), workspaceId = '00000000-0000-4000-8000-000000000142'
  const core = await composeCore({ workspace: { id: workspaceId, name: 'Start' }, providers, storage }), controller = createController(core)
  const workItemId = (await core.queries.listPlanningItems()).find((item) => item.content.contentKind === 'work_item').entityId
  let writes = 0; const start = core.commands.startWork; core.commands.startWork = (...args) => { writes++; return start(...args) }
  const keys = [], api = client.createStartWork({ getStartWorkOptions: async () => ({}), startWork: (actorRef, idempotencyKey, workItemId, repositoryId, branchName) => { keys.push(idempotencyKey); return controller.commands.startWork({ actorRef, idempotencyKey, workItemId, repositoryId, branchName }) } }, async () => null, { kind: 'user' })
  const target = { workspaceId, workItemId, repositoryId: 'repo-alpha' }
  providers.development.faultsSwitch.set(FaultKind.PermissionDenied, true)
  assert.equal((await api.submit(target)).writeState, 'failed')
  providers.development.faultsSwitch.set(FaultKind.PermissionDenied, false)
  // The real controller retains failed results under the old key.
  assert.equal((await controller.commands.startWork({ actorRef: { kind: 'user' }, idempotencyKey: keys[0], workItemId, repositoryId: 'repo-alpha', branchName: undefined })).writeState, 'failed'); assert.equal(writes, 1)
  const before = [providers.development.state.branches.length, providers.development.state.worktrees.length]
  const first = api.submit(target), duplicate = api.submit(target); assert.equal(first, duplicate)
  assert.equal((await first).writeState, 'confirmed'); assert.equal(writes, 2); assert.notEqual(keys[0], keys[1])
  assert.deepEqual([providers.development.state.branches.length, providers.development.state.worktrees.length], before.map((n) => n + 1))
  assert.equal((await core.queries.getExecutionContext({ workItemId, repositoryId: 'repo-alpha' })).status, 'ready')
  const db = openDatabase(storage.location); try { assert.equal(db.prepare('SELECT count(*) AS count FROM execution_context').get().count, 1) } finally { db.close() }
})

test('Host execution mode comes from actual selected assembly: no executor and human stay manual; available Harness is explicit', async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path')
  const { composeCore } = await import('@harness-projects/core'), { createSqliteStorage } = await import('@harness-projects/storage-sqlite')
  const { createFakeProviders, FAKE_PROVIDER_DEFINITION } = await import('@harness-projects/provider-fake')
  const { createHumanExecutionProvider } = await import('@harness-projects/provider-execution-human'), { createHarnessExecutionProvider } = await import('@harness-projects/provider-execution-harness')
  const { createHostComposition } = await import('../../apps/harness-plugin/src/host-composition.ts'), { catalogOf, hostStoragePolicy } = await import('../../apps/harness-plugin/src/host-providers.ts')
  for (const mode of ['none', 'human', 'harness']) {
    const root = await mkdtemp(join(tmpdir(), 'start-mode-')), dataPath = join(root, 'workspace.sqlite'), workspaceId = '00000000-0000-4000-8000-000000000143'
    const providers = createFakeProviders(); delete providers.execution
    if (mode !== 'none') providers.execution = mode === 'human' ? createHumanExecutionProvider({ bindingId: 'execution-mode', issuerKey: 'fixture-issuer-key-at-least-32-bytes-long' }) : createHarnessExecutionProvider({ bindingId: 'execution-mode', sessions: { create: async () => ({ sessionId: 'fixture-session' }), prompt: async () => ({ accepted: true }), inspect: async () => ({ events: [] }), list: async () => ({ items: [] }) } })
    const catalog = catalogOf([{ definition: FAKE_PROVIDER_DEFINITION, configuration: {}, create: async ({ binding }) => providers[binding.domain] }, ...(providers.execution ? [{ definition: providers.execution.definition, configuration: {}, create: async () => providers.execution }] : [])])
    const storage = createSqliteStorage(dataPath, hostStoragePolicy(catalog)), core = await composeCore({ workspace: { id: workspaceId, name: 'Mode' }, providers, storage })
    const item = (await core.queries.listPlanningItems()).find((item) => item.content.contentKind === 'work_item')
    const host = await createHostComposition({ dataPath, workspaceId, catalog, resolveCredential: async () => undefined })
    if (mode === 'none') { const answer = await core.commands.startWork({ workItemId: item.entityId, repositoryId: 'repo-alpha', actor: { kind: 'user' }, idempotencyKey: 'manual-start' }); assert.equal(answer.fallback, 'manual_fallback'); assert.equal(answer.confirmed, true) }
    try { assert.equal((await host.call('getStartWorkOptions', { workItemId: item.entityId })).executionMode, mode === 'harness' ? 'harness' : 'manual') }
    finally { await host.dispose(); storage.close(); await rm(root, { recursive: true, force: true }) }
  }
})

async function recoveryWorld(t) {
  const { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path')
  const { composeCore } = await import('@harness-projects/core'), { createController } = await import('@harness-projects/controller')
  const { createFakeProviders, providerFail } = await import('@harness-projects/provider-fake'), { createSqliteStorage } = await import('@harness-projects/storage-sqlite')
  const root = await mkdtemp(join(tmpdir(), 'start-recovery-')), storage = createSqliteStorage(join(root, 'workspace.sqlite'))
  t.after(async () => { storage.close(); await rm(root, { recursive: true, force: true }) })
  const providers = createFakeProviders(), workspaceId = '00000000-0000-4000-8000-000000000144'
  const core = await composeCore({ workspace: { id: workspaceId, name: 'Recovery' }, providers, storage }), controller = createController(core)
  const workItemId = (await core.queries.listPlanningItems()).find((item) => item.content.contentKind === 'work_item').entityId
  return { core, controller, providers, providerFail, target: { workspaceId, workItemId, repositoryId: 'repo-alpha' } }
}
test('definite worktree failure with an acknowledged branch retries a new attempt through real Core/controller/SQLite', async (t) => {
  const w = await recoveryWorld(t), original = w.providers.development.createWorktree.bind(w.providers.development), keys = []
  let creates = 0, fail = true, sequence = 0
  w.providers.development.createWorktree = async (input) => { creates++; return fail ? w.providerFail('unavailable', 'temporary worktree failure') : original(input) }
  const api = client.createStartWork({ getStartWorkOptions: async () => ({}), startWork: (actorRef, idempotencyKey, workItemId, repositoryId, branchName) => { keys.push(idempotencyKey); return w.controller.commands.startWork({ actorRef, idempotencyKey, workItemId, repositoryId, branchName }) } }, async () => null, { kind: 'user' }, () => `recovery-${++sequence}`)
  const first = await api.submit(w.target), context = await w.core.queries.getExecutionContext(w.target)
  assert.equal(first.writeState, 'local_only'); assert.equal(context.status, 'failed'); assert.ok(context.branchExternalId); assert.equal(creates, 1)
  fail = false
  const second = api.submit(w.target), duplicate = api.submit(w.target); assert.equal(second, duplicate)
  const recovered = await second
  const control = await w.controller.commands.startWork({ actorRef: { kind: 'user' }, idempotencyKey: 'fresh-control', workItemId: w.target.workItemId, repositoryId: w.target.repositoryId })
  assert.equal(control.writeState, 'confirmed', 'Core recovery is independently possible with a fresh key')
  assert.equal(recovered.writeState, 'confirmed'); assert.equal(creates, 2); assert.notEqual(keys[0], keys[1])
})
test('lost confirmed response reads back then replays the original key without starting another execution', async (t) => {
  const w = await recoveryWorld(t), original = w.providers.execution.startRun.bind(w.providers.execution), events = [], keys = []
  let starts = 0, lost = true
  w.providers.execution.startRun = async (input) => { starts++; return original(input) }
  const api = client.createStartWork({ getStartWorkOptions: async () => ({}), startWork: async (actorRef, idempotencyKey, workItemId, repositoryId, branchName) => {
    keys.push(idempotencyKey); events.push('write'); const answer = await w.controller.commands.startWork({ actorRef, idempotencyKey, workItemId, repositoryId, branchName })
    if (lost) { lost = false; throw new Error('lost response') } return answer
  } }, async (scope) => { events.push('read'); return w.core.queries.getExecutionContext(scope) }, { kind: 'user' }, () => 'stable-lost-key')
  assert.equal((await api.submit(w.target)).writeState, 'unknown'); assert.equal(starts, 1)
  assert.equal((await api.submit(w.target)).writeState, 'confirmed'); assert.equal(starts, 1)
  assert.deepEqual(keys, ['stable-lost-key', 'stable-lost-key']); assert.deepEqual(events, ['write', 'read', 'write'])
})
test('a worktree branch conflict keeps valid binding and retries a new key after external repair', async (t) => {
  const w = await recoveryWorld(t), actorRef = { kind: 'user' }, input = { actorRef, workItemId: w.target.workItemId, repositoryId: w.target.repositoryId }
  assert.equal((await w.controller.commands.startWork({ ...input, idempotencyKey: 'first' })).writeState, 'confirmed')
  const worktree = w.providers.development.state.worktrees.at(-1), branch = worktree.branch, keys = []
  worktree.branch = 'other-branch'
  const api = client.createStartWork({ getStartWorkOptions: async () => ({}), startWork: (actorRef, idempotencyKey, workItemId, repositoryId) => { keys.push(idempotencyKey); return w.controller.commands.startWork({ actorRef, idempotencyKey, workItemId, repositoryId }) } }, async () => null, actorRef)
  const failed = await api.submit(w.target)
  assert.equal(failed.writeState, 'local_only'); assert.equal(failed.contextStatus, 'failed'); assert.equal(failed.needsBinding, undefined)
  worktree.branch = branch
  assert.equal((await api.submit(w.target)).writeState, 'confirmed'); assert.notEqual(keys[0], keys[1])
  assert.equal(w.providers.development.state.worktrees.length, 1)
})
