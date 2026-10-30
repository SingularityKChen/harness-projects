import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { composeCore, contextIdFor, runIdFor } from '@harness-projects/core'
import { CapabilityKey as K, AccessLevel } from '@harness-projects/capabilities'
import { createFakeProviders, createFakeExecutionProvider, FaultKind } from '@harness-projects/provider-fake'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

async function fixture(sqlite = false, t) {
  const p = createFakeProviders(), denied = new Set(), fallback = createFakeExecutionProvider()
  const root = sqlite ? mkdtempSync(join(tmpdir(), 'operation-access-')) : undefined, storage = root ? createSqliteStorage(join(root, 'workspace.sqlite')) : p.storage
  if (root) t.after(() => { storage.close(); rmSync(root, { recursive: true, force: true }) })
  for (const provider of [p.development, p.execution, fallback]) {
    const describe = provider.describeCapabilities.bind(provider)
    provider.describeCapabilities = async () => { const value = await describe(); return { ...value, capability: { ...value.capability, ...(provider === fallback ? { [K.ExecutionRunFallback]: AccessLevel.Available } : {}) }, permission: { ...value.permission, ...(provider === fallback ? { [K.ExecutionRunFallback]: AccessLevel.Available } : {}), ...Object.fromEntries([...denied].map(key => [key, AccessLevel.Unavailable])) } } }
  }
  const core = await composeCore({ workspace: { id: 'runtime-operations', name: 'Operations' }, providers: { ...p, executionFallback: fallback }, storage })
  const item = (await core.queries.listPlanningItems()).find(row => row.content.contentKind === 'work_item').entityId
  const request = { workItemId: item, repositoryId: 'repo-alpha', idempotencyKey: 'original-intent', actor: { kind: 'human' } }
  return { p, fallback, denied, core, request, id: contextIdFor('runtime-operations', item, 'repo-alpha') }
}
for (const sqlite of [false, true]) {
  test(`${sqlite ? 'SQLite' : 'Memory'}: late descriptor cannot launch an unsent run after a newer actual denial`, async t => {
    const h = await fixture(sqlite, t), describe = h.p.execution.describeCapabilities.bind(h.p.execution), run = h.p.execution.startRun.bind(h.p.execution)
    let entered, release, reads = 0, calls = 0; const reached = new Promise(done => { entered = done }), held = new Promise(done => { release = done })
    h.p.execution.describeCapabilities = async () => { const snapshot = await describe(); if (++reads === 2) { entered(); await held }; return snapshot }
    h.p.execution.startRun = async input => ++calls === 1 ? { ok: false, error: { code: 'permission_denied', message: 'private' } } : run(input)
    const older = h.core.commands.startWork(h.request); await reached
    const item = (await h.core.queries.listPlanningItems()).find(row => row.content.contentKind === 'work_item' && row.entityId !== h.request.workItemId).entityId
    assert.equal((await h.core.commands.startWork({ ...h.request, workItemId: item, idempotencyKey: 'newer-denial' })).error.code, 'permission_denied')
    release(); await older; assert.equal(calls, 1)
  })
  test(`${sqlite ? 'SQLite' : 'Memory'}: repository permission is rechecked after awaited preflight at the actual read`, async t => {
    const h = await fixture(sqlite, t), preflight = h.p.development.preflightWorktree.bind(h.p.development), read = h.p.development.getRepository.bind(h.p.development); let calls = 0
    h.p.development.preflightWorktree = async input => { const ack = await preflight(input); h.denied.add(K.DevelopmentRepositoryRead); return ack }
    h.p.development.getRepository = input => { if (h.denied.has(K.DevelopmentRepositoryRead)) calls++; return read(input) }
    const answer = await h.core.commands.startWork(h.request)
    assert.equal(calls, 0); assert.match(answer.error.message, /development.repository.read/)
    assert.equal((await h.core.queries.getWorkspaceMetadata()).repositories[0].capabilities.find(row => row.key === K.DevelopmentBranchCreate).access, 'available')
  })
  test(`${sqlite ? 'SQLite' : 'Memory'}: actual preflight denial masks only worktree create until a real confirming write`, async t => {
    const h = await fixture(sqlite, t), preflight = h.p.development.preflightWorktree
    h.p.development.preflightWorktree = async () => ({ ok: false, error: { code: 'permission_denied', message: 'private' } })
    await h.core.commands.startWork(h.request)
    const access = async () => (await h.core.queries.getWorkspaceMetadata()).repositories[0].capabilities.find(row => row.key === K.DevelopmentWorktreeCreate).access
    assert.equal(await access(), 'unavailable'); assert.equal((await h.core.commands.validateStartWork(h.request.workItemId))[0].available, true); assert.equal(await access(), 'unavailable')
    h.p.development.preflightWorktree = preflight
    assert.equal((await h.core.commands.startWork({ ...h.request, idempotencyKey: 'explicit-recovery' })).confirmed, true); assert.equal(await access(), 'available')
  })
  test(`${sqlite ? 'SQLite' : 'Memory'}: unresolved replay keeps Unknown and acknowledged handles across current write denial`, async t => {
    const h = await fixture(sqlite, t)
    h.p.execution.startRun = async () => ({ ok: false, error: { code: 'ambiguous_result', message: 'lost reply' } })
    const first = await h.core.commands.startWork(h.request); assert.equal(first.phase, 'unknown')
    h.denied.add(K.DevelopmentWorktreeCreate)
    const replay = await h.core.commands.startWork(h.request)
    assert.equal(replay.phase, 'unknown'); assert.equal(replay.executionContextId, first.executionContextId); assert.equal(replay.worktreeExternalId, first.worktreeExternalId)
  })
}
for (const phase of ['branch-probe', 'worktree-reconcile', 'ready-verify']) test(`${phase} rechecks its actual read key without invoking a revoked read`, async () => {
  const h = await fixture(), d = h.p.development; let calls = 0
  const method = phase === 'branch-probe' ? 'listBranches' : 'getWorktree', key = phase === 'branch-probe' ? K.DevelopmentRepositoryRead : K.DevelopmentWorktreeRead, read = d[method].bind(d)
  d[method] = (...args) => { if (h.denied.has(key)) calls++; return read(...args) }
  if (phase === 'ready-verify') { await h.core.commands.startWork(h.request); h.denied.add(key) }
  else if (phase === 'branch-probe') {
    const create = d.createWorktree.bind(d), preflight = d.preflightWorktree.bind(d)
    d.createWorktree = async () => ({ ok: false, error: { code: 'permission_denied', message: 'write denied' } }); await h.core.commands.startWork(h.request)
    d.createWorktree = create; d.preflightWorktree = async input => { const result = await preflight(input); h.denied.add(key); return result }
  } else d.createWorktree = async () => { h.denied.add(key); return { ok: false, error: { code: 'conflict', message: 'existing worktree' } } }
  const answer = await h.core.commands.startWork({ ...h.request, idempotencyKey: phase === 'ready-verify' ? h.request.idempotencyKey : 'read-recovery' })
  assert.equal(calls, 0); assert.equal(answer.confirmed, false)
})
for (const [method, key, expected] of [
  ['preflightWorktree', K.DevelopmentBranchCreate, [0, 0, 0]],
  ['createBranch', K.DevelopmentWorktreeCreate, [1, 0, 0]],
  ['createWorktree', K.ExecutionRunStart, [1, 1, 0]],
]) test(`current ${key} rejects next I/O after ${method} ack and preserves earlier facts`, async () => {
  const h = await fixture(), provider = h.p.development, run = provider[method].bind(provider)
  provider[method] = async (...args) => { const ack = await run(...args); h.denied.add(key); return ack }
  const before = [provider.state.branches.length, provider.state.worktrees.length, h.p.execution.state.runs.length]
  const result = await h.core.commands.startWork(h.request)
  assert.deepEqual([provider.state.branches.length, provider.state.worktrees.length, h.p.execution.state.runs.length].map((n, i) => n - before[i]), expected)
  assert.equal(result.error?.code, 'permission_denied'); assert.match(result.error.message, new RegExp(key.replaceAll('.', '\\.')))
  assert.equal(result.confirmed, false)
  const saved = await h.p.storage.getExecutionContext(h.id)
  assert.equal(saved?.branchExternalId !== undefined, expected[0] === 1)
  assert.equal(saved?.worktreeExternalId !== undefined, expected[1] === 1)
  assert.equal(await h.p.storage.getExecutionRun(runIdFor(h.id)), undefined)
})
test('fallback start is independently gated after primary definite failure', async () => {
  const h = await fixture(), before = h.fallback.state.runs.length
  h.p.execution.startRun = async () => { h.denied.add(K.ExecutionRunFallback); return { ok: false, error: { code: 'unavailable', message: 'provider-private-canary' } } }
  const result = await h.core.commands.startWork(h.request)
  assert.equal(h.fallback.state.runs.length, before); assert.equal(result.error?.code, 'permission_denied')
  assert.doesNotMatch(result.error.message, /provider-private-canary/)
})
test('explicit new attempt resumes retained branch, while settled same key never performs another write', async () => {
  const h = await fixture(), create = h.p.development.createBranch.bind(h.p.development)
  h.p.development.createBranch = async input => { const result = await create(input); h.denied.add(K.DevelopmentWorktreeCreate); return result }
  const failed = await h.core.commands.startWork(h.request)
  assert.ok(failed.branchExternalId, 'partial ack remains in the command result')
  const before = [h.p.development.state.branches.length, h.p.development.state.worktrees.length]
  h.denied.clear(); h.p.development.createBranch = create
  const replay = await h.core.commands.startWork(h.request)
  assert.equal(replay.confirmed, false)
  assert.deepEqual([h.p.development.state.branches.length, h.p.development.state.worktrees.length], before)
  const resumed = await h.core.commands.startWork({ ...h.request, idempotencyKey: 'explicit-new-attempt' })
  assert.equal(resumed.confirmed, true); assert.equal(resumed.branchExternalId, failed.branchExternalId)
  assert.equal(h.p.development.state.branches.length, before[0]); assert.equal(h.p.development.state.worktrees.length, before[1] + 1)
})
test('safe validation reports retry eligibility without clearing a real write denial or replaying settled intent', async () => {
  const h = await fixture(), create = h.p.development.createBranch.bind(h.p.development)
  h.p.development.createBranch = async () => ({ ok: false, error: { code: 'permission_denied', message: 'provider-private-canary' } })
  await h.core.commands.startWork(h.request)
  assert.match((await h.core.queries.getWorkspaceMetadata()).repositories[0].capabilities.find(row => row.key === K.DevelopmentBranchCreate).reason, /permission/)
  h.p.development.createBranch = create
  const validated = await h.core.commands.validateStartWork(h.request.workItemId)
  assert.equal(validated[0].available, true)
  assert.match((await h.core.queries.getWorkspaceMetadata()).repositories[0].capabilities.find(row => row.key === K.DevelopmentBranchCreate).reason, /permission/, 'describe success is not a write ack')
  assert.equal((await h.core.commands.startWork(h.request)).confirmed, false)
  assert.equal((await h.core.commands.startWork({ ...h.request, idempotencyKey: 'explicit-retry' })).confirmed, true)
  assert.equal((await h.core.queries.getWorkspaceMetadata()).repositories[0].capabilities.find(row => row.key === K.DevelopmentBranchCreate).access, 'available')
})
test('a permission change while durable intent commits still prevents the corresponding Provider write', async () => {
  const h = await fixture(), transaction = h.p.storage.transaction.bind(h.p.storage)
  h.p.storage.transaction = work => transaction(tx => work(new Proxy(tx, { get(target, key) {
    const value = target[key]
    return key === 'putMutationAttempt' ? async record => { const result = await value.call(target, record); if (record.externalIntent?.operation === 'createBranch') h.denied.add(K.DevelopmentBranchCreate); return result }
      : typeof value === 'function' ? value.bind(target) : value
  } })))
  const count = h.p.development.state.branches.length
  assert.equal((await h.core.commands.startWork(h.request)).error?.code, 'permission_denied')
  assert.equal(h.p.development.state.branches.length, count)
})
test('current permission denial outranks old Saved replay while preserving confirmed resources', async () => {
  const h = await fixture(); assert.equal((await h.core.commands.startWork(h.request)).confirmed, true)
  const counts = [h.p.development.state.branches.length, h.p.development.state.worktrees.length, h.p.execution.state.runs.length]
  h.denied.add(K.DevelopmentWorktreeCreate)
  const answer = await h.core.commands.startWork(h.request)
  assert.equal(answer.confirmed, false); assert.equal(answer.error?.code, 'permission_denied')
  assert.deepEqual([h.p.development.state.branches.length, h.p.development.state.worktrees.length, h.p.execution.state.runs.length], counts)
  assert.equal((await h.p.storage.getExecutionContext(h.id)).status, 'ready')
})
test('trusted Core status caller cannot use stale disk content when runtime redaction persistence failed', async () => {
  const p = createFakeProviders(), core = await composeCore({ workspace: { id: 'status-runtime', name: 'Status', statusPolicy: 'host_authoritative' }, providers: p })
  const item = (await core.queries.listPlanningItems()).find(row => row.content.contentKind === 'work_item')
  const transaction = p.storage.transaction.bind(p.storage)
  p.storage.transaction = work => transaction(tx => work(new Proxy(tx, { get(target, key) {
    const value = target[key]
    return key === 'replacePlanningProjections' ? async () => { throw Error('disk fault') } : typeof value === 'function' ? value.bind(target) : value
  } })))
  p.planning.faultsSwitch.set(FaultKind.PermissionDenied, true)
  await assert.rejects(core.commands.refreshPlanning())
  const before = await p.storage.getPlanningProjection('status-runtime', item.entityId)
  const result = await core.commands.applyPlanningStatus({ entityId: item.entityId, status: 'done' })
  assert.equal(result.wrote, false); assert.equal(result.error?.code, 'permission_denied')
  assert.deepEqual(await p.storage.getPlanningProjection('status-runtime', item.entityId), before)
})
test('actual primary permission denial stops before fallback; Unknown never creates another executor under a new key', async () => {
  for (const code of ['permission_denied', 'ambiguous_result']) {
    const h = await fixture(), primary = h.p.execution.state.runs.length, fallback = h.fallback.state.runs.length
    let calls = 0; h.p.execution.startRun = async () => { calls++; return { ok: false, error: { code, message: 'provider-private-canary' } } }
    const answer = await h.core.commands.startWork(h.request)
    assert.equal(h.fallback.state.runs.length, fallback)
    assert.equal(answer.confirmed, false)
    if (code === 'ambiguous_result') {
      assert.equal(answer.phase, 'unknown')
      await h.core.commands.startWork({ ...h.request, idempotencyKey: 'different-key' })
      assert.equal(calls, 1)
      assert.equal(h.p.execution.state.runs.length, primary); assert.equal(h.fallback.state.runs.length, fallback)
    } else assert.equal(answer.error.code, 'permission_denied')
  }
})
test('an older permitted write ack remains real but cannot clear a newer same-key permission refusal', async () => {
  const h = await fixture(), create = h.p.development.createBranch.bind(h.p.development)
  let release, entered; const held = new Promise(done => { release = done }), reached = new Promise(done => { entered = done }); let calls = 0
  h.p.development.createBranch = async input => {
    if (++calls !== 1) return { ok: false, error: { code: 'permission_denied', message: 'provider-private-canary' } }
    const ack = await create(input); entered(); await held; return ack
  }
  const earlier = h.core.commands.startWork(h.request); await reached
  const item = (await h.core.queries.listPlanningItems()).find(row => row.content.contentKind === 'work_item' && row.entityId !== h.request.workItemId).entityId
  assert.equal((await h.core.commands.startWork({ ...h.request, workItemId: item, idempotencyKey: 'newer-denial' })).error.code, 'permission_denied')
  release(); assert.equal((await earlier).confirmed, true)
  const metadata = await h.core.queries.getWorkspaceMetadata()
  assert.equal(metadata.repositories[0].capabilities.find(row => row.key === K.DevelopmentBranchCreate).access, 'unavailable')
  assert.equal(metadata.repositories[0].capabilities.find(row => row.key === K.DevelopmentWorktreeRead).access, 'available')
})
test('current worktree permission fences preflight after prepare repository ack', async () => {
  const h = await fixture(), read = h.p.development.getRepository.bind(h.p.development)
  h.p.development.getRepository = async ref => { const ack = await read(ref); h.denied.add(K.DevelopmentWorktreeCreate); return ack }
  let calls = 0; const preflight = h.p.development.preflightWorktree.bind(h.p.development)
  h.p.development.preflightWorktree = (...args) => { calls++; return preflight(...args) }
  const before = h.p.development.state.branches.length
  const answer = await h.core.commands.startWork(h.request)
  assert.equal(calls, 0); assert.equal(h.p.development.state.branches.length, before)
  assert.equal(answer.error?.code, 'permission_denied')
})
test('failed local denial settlement remains Unknown and retains acknowledged branch', async () => {
  const h = await fixture(), branch = h.p.development.createBranch.bind(h.p.development), transaction = h.p.storage.transaction.bind(h.p.storage)
  h.p.development.createBranch = async input => { const ack = await branch(input); h.denied.add(K.DevelopmentWorktreeCreate); return ack }
  h.p.storage.transaction = work => transaction(tx => work(new Proxy(tx, { get(target, key) {
    const value = target[key]
    return key === 'putMutationAttempt' ? async record => { if (record.errorCode === 'permission_denied') throw Error('receipt disk fault'); return value.call(target, record) }
      : typeof value === 'function' ? value.bind(target) : value
  } })))
  let answer
  await assert.doesNotReject(async () => { answer = await h.core.commands.startWork(h.request) })
  assert.equal(answer.phase, 'unknown'); assert.ok(answer.branchExternalId)
  assert.equal((await h.p.storage.getExecutionContext(h.id)).branchExternalId, answer.branchExternalId)
})
test('per-key Start Work metadata preserves the existing change-request prerequisite gate', async () => {
  const h = await fixture(); await h.core.commands.startWork(h.request)
  h.denied.add(K.DevelopmentRepositoryRead); await h.core.commands.validateStartWork(h.request.workItemId)
  const capabilities = (await h.core.queries.getWorkspaceMetadata()).repositories[0].capabilities
  assert.equal(capabilities.find(row => row.key === K.DevelopmentBranchCreate).access, 'available')
  assert.equal(capabilities.find(row => row.key === K.DevelopmentChangeRequestRead).access, 'unavailable')
})
test('operation denial fences an already captured metadata response and changes the allowed-after-recovery token', async () => {
  const h = await fixture(); await h.core.commands.startWork(h.request)
  const initial = (await h.core.queries.getWorkspaceMetadata()).repositories[0].accessVersion
  let entered, release; const reached = new Promise(done => { entered = done }), held = new Promise(done => { release = done })
  const list = h.p.storage.listRepositories.bind(h.p.storage); let calls = 0
  h.p.storage.listRepositories = async (...args) => { const value = await list(...args); if (++calls === 2) { entered(); await held }; return value }
  const older = h.core.queries.getWorkspaceMetadata(); await reached
  h.denied.add(K.DevelopmentWorktreeCreate); await h.core.commands.validateStartWork(h.request.workItemId)
  release()
  assert.equal((await older).repositories[0].capabilities.find(row => row.key === K.DevelopmentWorktreeCreate).access, 'unavailable')
  h.denied.clear(); const create = h.p.development.createBranch.bind(h.p.development)
  h.p.development.createBranch = async () => ({ ok: false, error: { code: 'permission_denied', message: 'denied' } })
  const other = (await h.core.queries.listPlanningItems()).find(row => row.content.contentKind === 'work_item' && row.entityId !== h.request.workItemId).entityId
  await h.core.commands.startWork({ ...h.request, workItemId: other, idempotencyKey: 'denial-for-token' })
  h.p.development.createBranch = create
  await h.core.commands.startWork({ ...h.request, workItemId: other, idempotencyKey: 'recovery-for-token' })
  const recovered = (await h.core.queries.getWorkspaceMetadata()).repositories[0]
  assert.equal(recovered.capabilities.find(row => row.key === K.DevelopmentBranchCreate).access, 'available')
  assert.notEqual(recovered.accessVersion, initial)
})
