import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { composeCore, contextIdFor } from '@harness-projects/core'
import { CapabilityKey } from '@harness-projects/capabilities'
import { AccessLevel } from '@harness-projects/domain'
import { createFakeProviders, createFakeDevelopmentProvider, exportFakeStorageState } from '@harness-projects/provider-fake'
import { createSqliteStorage, openDatabase } from '@harness-projects/storage-sqlite'
import { controllableClock } from './local-git-fixture.js'

const dir = mkdtempSync(join(tmpdir(), 'request-binding-')); let files = 0
const handles = []; after(() => { for (const s of handles) { try { s.close() } catch {} } rmSync(dir, { recursive: true, force: true }) })
const sqlite = (path = join(dir, `${files++}.sqlite`)) => { const s = createSqliteStorage(path); handles.push(s); return s }
async function setup(kind) {
  const providers = createFakeProviders(); const storage = kind === 'SQLite' ? sqlite() : providers.storage
  const workspace = { id: 'request-binding', name: 'request binding' }; const time = controllableClock()
  const options = { providers, storage, workspace, clock: time.clock }; const core = await composeCore(options)
  const items = (await core.queries.listPlanningItems()).filter((v) => v.content.contentKind === 'work_item').map((v) => v.entityId)
  const request = { workItemId: items[0], repositoryId: 'repo-alpha', actor: { kind: 'agent', id: 'one' }, idempotencyKey: 'first' }
  return { ...options, core, items, request, time, initial: [providers.development.state.branches.length, providers.development.state.worktrees.length, providers.execution.state.runs.length] }
}
const start = (w, patch = {}, core = w.core) => core.commands.startWork({ ...w.request, ...patch })
const counts = (w) => [w.providers.development.state.branches.length, w.providers.development.state.worktrees.length, w.providers.execution.state.runs.length].map((n, i) => n - w.initial[i])
function local(storage) {
  if (!storage.location) return JSON.stringify(exportFakeStorageState(storage))
  const db = openDatabase(storage.location)
  try { return JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])) } finally { db.close() }
}
function conflict(result, reason = 'idempotency_request_mismatch') {
  assert.deepEqual([result.phase, result.writeState, result.confirmed, result.error?.code, result.error?.message], ['conflict', 'conflict', false, 'conflict', reason])
}
const gate = () => { let release; const wait = new Promise((r) => { release = r }); return { wait, release } }

for (const kind of ['Fake', 'SQLite']) {
  test(`${kind}: first request binds every declared field before settled replay can read or mutate`, async () => {
    const w = await setup(kind); assert.equal((await start(w)).writeState, 'saved')
    const row = await w.storage.findMutationAttempt(w.workspace.id, 'first')
    assert.equal(typeof row.requestFingerprint, 'string'); assert.deepEqual(JSON.parse(row.requestFingerprint), ['startWork:v1', w.workspace.id, w.providers.development.gate.bindingId, ['agent', 'one'], w.request.workItemId, 'repo-alpha', null, null])
    let calls = 0; const d = w.providers.development
    for (const key of ['getWorktree', 'getRepository', 'createBranch', 'createWorktree']) { const call = d[key].bind(d); d[key] = (...args) => { calls++; return call(...args) } }
    const before = local(w.storage); const external = counts(w)
    for (const patch of [{ workItemId: 'missing' }, { repositoryId: 'missing' }, { actor: { kind: 'human', id: 'one' } }, { actor: { kind: 'agent', id: 'two' } }, { actor: { kind: 'agent' } }, { branchName: `work/${w.request.workItemId}` }, { worktreePath: '' }, { worktreePath: ' ' }, { worktreePath: 'a|b"\\中' }]) conflict(await start(w, patch))
    assert.equal(calls, 0); assert.equal(local(w.storage), before); assert.deepEqual(counts(w), external)
    assert.equal((await start(w, { actor: { id: 'one', kind: 'agent', toJSON() { throw Error('must not serialize caller') } }, branchName: undefined, worktreePath: undefined })).writeState, 'saved')
  })
  test(`${kind}: Pending exact replay observes without lease takeover and new observation keys bind`, async () => {
    const w = await setup(kind); const d = w.providers.development; const create = d.createWorktree.bind(d)
    d.createWorktree = async () => { throw Error('interrupt after branch ack') }
    await assert.rejects(start(w), /interrupt/)
    const pending = await w.storage.findMutationAttempt(w.workspace.id, 'first'); assert.equal(pending.state, 'pending')
    const before = local(w.storage); const external = counts(w)
    conflict(await start(w, { workItemId: 'missing' })); assert.equal(local(w.storage), before)
    for (const advance of [0, 60_000]) { w.time.advance(advance); assert.equal((await start(w)).writeState, 'pending'); assert.equal(local(w.storage), before) }
    assert.deepEqual(counts(w), external)
    w.time.advance(-60_000); assert.equal((await start(w, { idempotencyKey: 'observer' })).writeState, 'pending')
    conflict(await start(w, { idempotencyKey: 'observer', repositoryId: 'missing' }))
    w.time.advance(60_000); d.createWorktree = create
    assert.equal((await start(w, { idempotencyKey: 'recovery' })).writeState, 'saved')
    assert.equal((await start(w)).writeState, 'saved', 'Pending follows the now-ready context')
    assert.equal((await start(w, { idempotencyKey: 'ready-observer' })).writeState, 'saved')
    conflict(await start(w, { idempotencyKey: 'ready-observer', workItemId: w.items[1] }))
    assert.equal((await w.storage.findMutationAttempt(w.workspace.id, 'observer')).requestFingerprint, pending.requestFingerprint)
  })
  test(`${kind}: admitted route stays frozen through supply when repository routing changes after commit`, async () => {
    const w = await setup(kind); await start(w)
    const d = w.providers.development; const bindingId = d.gate.bindingId; const extra = createFakeDevelopmentProvider({ bindingId: 'after-admission' })
    const core = await composeCore({ ...w, providers: { ...w.providers, development: [d, extra] } })
    const identity = await w.storage.findExternalIdentity(bindingId, 'repository', 'repo-alpha')
    const transaction = w.storage.transaction.bind(w.storage); let changed = false; let foreignCalls = 0; const targets = []
    for (const key of ['createBranch', 'createWorktree']) {
      const original = d[key].bind(d); d[key] = (input) => { targets.push(input.repository.bindingId); return original(input) }
      extra[key] = async () => { foreignCalls++; throw Error('wrong admitted route') }
    }
    w.storage.transaction = async (work) => {
      const result = await transaction(work)
      if (!changed && await w.storage.findMutationAttempt(w.workspace.id, 'frozen-route')) {
        changed = true; await w.storage.putExternalIdentity({ id: 'after-admission-alias', entityId: identity.entityId, bindingId: 'after-admission', externalKind: 'repository', externalId: 'repo-alpha', role: 'alias' })
      }
      return result
    }
    const patch = { workItemId: w.items[1], idempotencyKey: 'frozen-route' }
    assert.equal((await start(w, patch, core)).writeState, 'saved')
    assert.deepEqual(targets, [bindingId, bindingId]); assert.equal(foreignCalls, 0)
    assert.equal(JSON.parse((await w.storage.findMutationAttempt(w.workspace.id, 'frozen-route')).requestFingerprint)[2], bindingId)
    const before = local(w.storage); conflict(await start(w, patch, core), 'idempotency_target_changed'); assert.equal(local(w.storage), before)
  })
  test(`${kind}: another command cannot lend its receipt to Start Work`, async () => {
    const w = await setup(kind)
    await w.storage.putMutationAttempt({ id: 'foreign-command', workspaceId: w.workspace.id, bindingId: w.providers.development.gate.bindingId, commandName: 'updatePlanningFields', idempotencyKey: 'first', state: 'saved', expectedSourceVersion: undefined, errorCode: undefined })
    const before = local(w.storage); conflict(await start(w)); assert.equal(local(w.storage), before); assert.deepEqual(counts(w), [0, 0, 0])
  })
  test(`${kind}: JSON tuple keeps delimiters and Unicode distinct, workspace scopes keys independently`, async () => {
    const w = await setup(kind); const patch = { actor: { kind: 'a|b"\\中', id: 'c' }, worktreePath: '.worktrees/a|b"\\中' }
    assert.equal((await start(w, patch)).writeState, 'saved')
    conflict(await start(w, { ...patch, actor: { kind: 'a', id: 'b"\\中|c' } }))
    conflict(await start(w, { ...patch, worktreePath: '.worktrees/a|b"/中' }))
    const first = await w.storage.findMutationAttempt(w.workspace.id, 'first')
    const workspace = { id: 'independent-workspace', name: 'independent' }; const other = await composeCore({ ...w, workspace })
    assert.equal((await start(w, { branchName: 'work/independent', worktreePath: '.worktrees/independent' }, other)).writeState, 'saved')
    assert.deepEqual(await w.storage.findMutationAttempt(w.workspace.id, 'first'), first)
    assert.equal(JSON.parse((await w.storage.findMutationAttempt(workspace.id, 'first')).requestFingerprint)[1], workspace.id)
  })
  test(`${kind}: validates actor and path primitives and snapshots caller before asynchronous preparation`, async () => {
    const w = await setup(kind); const before = local(w.storage)
    for (const actor of [null, [], 'agent', { kind: '' }, { kind: 'agent', id: null }, { kind: 'agent', id: 1 }]) assert.equal((await start(w, { actor })).error?.code, 'invalid_input')
    for (const worktreePath of [null, 1, {}]) assert.equal((await start(w, { worktreePath })).error?.code, 'invalid_input')
    assert.equal(local(w.storage), before)
    const entered = gate(); const release = gate(); const get = w.storage.findMutationAttempt.bind(w.storage)
    w.storage.findMutationAttempt = async (...args) => { entered.release(); await release.wait; return get(...args) }
    const mutable = { ...w.request, actor: { ...w.request.actor }, branchName: 'work/frozen', worktreePath: '.worktrees/frozen' }
    const running = w.core.commands.startWork(mutable); await entered.wait
    mutable.actor.id = 'changed'; mutable.workItemId = 'missing'; mutable.branchName = 'work/changed'; mutable.worktreePath = '.worktrees/changed'; release.release()
    assert.equal((await running).writeState, 'saved'); assert.equal(w.providers.development.state.branches.at(-1).name, 'work/frozen')
    assert.deepEqual(JSON.parse((await get(w.workspace.id, 'first')).requestFingerprint).slice(3), [['agent', 'one'], w.request.workItemId, 'repo-alpha', 'work/frozen', '.worktrees/frozen'])
  })
  test(`${kind}: atomic admission rollback leaves key, context and parents untouched`, async () => {
    const w = await setup(kind); const before = local(w.storage); const transaction = w.storage.transaction.bind(w.storage); let hit = 0
    w.storage.transaction = (work) => transaction((tx) => work(new Proxy(tx, { get(target, key) { const fn = Reflect.get(target, key); return key === 'putExecutionContext' ? async (...args) => { await fn.apply(target, args); hit++; throw Error('admission rollback') } : typeof fn === 'function' ? fn.bind(target) : fn } })))
    assert.equal((await start(w)).error?.code, 'unavailable'); assert.equal(hit, 1); assert.equal(local(w.storage), before); assert.deepEqual(counts(w), [0, 0, 0])
    w.storage.transaction = transaction; assert.equal((await start(w)).writeState, 'saved')
  })
  test(`${kind}: replay requires the original route while create-readonly permits observation`, async () => {
    const w = await setup(kind); await start(w); const external = counts(w)
    const readonly = await composeCore({ ...w, policy: { [CapabilityKey.DevelopmentBranchCreate]: AccessLevel.ReadOnly, [CapabilityKey.DevelopmentWorktreeCreate]: AccessLevel.ReadOnly } })
    assert.equal((await start(w, {}, readonly)).writeState, 'saved')
    const extra = createFakeDevelopmentProvider({ bindingId: 'extra-development' })
    const added = await composeCore({ ...w, providers: { ...w.providers, development: [w.providers.development, extra] } })
    assert.equal((await start(w, {}, added)).writeState, 'saved', 'unrelated mount cannot alter identity')
    const identity = await w.storage.findExternalIdentity(w.providers.development.gate.bindingId, 'repository', 'repo-alpha')
    await w.storage.putExternalIdentity({ id: 'ambiguous-alias', entityId: identity.entityId, bindingId: 'extra-development', externalKind: 'repository', externalId: 'repo-alpha', role: 'alias' })
    const ambiguous = local(w.storage); conflict(await start(w, {}, added), 'idempotency_target_changed'); assert.equal(local(w.storage), ambiguous)
    const fresh = createFakeProviders(); const moved = await composeCore({ ...w, providers: { ...fresh, planning: w.providers.planning } })
    const before = local(w.storage); conflict(await start(w, {}, moved), 'idempotency_target_changed'); assert.equal(local(w.storage), before); assert.deepEqual(counts(w), external)
    assert.equal((await start(w)).writeState, 'saved')
  })
}
for (const stage of ['pending', 'branch ack', 'settled']) test(`SQLite: close/reopen preserves ${stage} identity and recovery semantics`, async () => {
  const w = await setup('SQLite'); const d = w.providers.development
  const method = stage === 'pending' ? 'createBranch' : 'createWorktree'; const create = d[method].bind(d)
  if (stage !== 'settled') d[method] = async () => { throw Error('process interruption') }
  if (stage === 'settled') await start(w); else await assert.rejects(start(w), /interruption/)
  const row = await w.storage.findMutationAttempt(w.workspace.id, 'first'); w.storage.close(); w.storage = sqlite(w.storage.location); w.core = await composeCore(w)
  assert.deepEqual(await w.storage.findMutationAttempt(w.workspace.id, 'first'), row)
  const before = local(w.storage); conflict(await start(w, { workItemId: 'missing' })); assert.equal(local(w.storage), before)
  w.time.advance(60_000); const external = counts(w); assert.equal((await start(w)).writeState, stage === 'settled' ? 'saved' : 'pending'); assert.deepEqual(counts(w), external)
  d[method] = create; if (stage !== 'settled') assert.equal((await start(w, { idempotencyKey: 'recover' })).writeState, 'saved')
})
test('SQLite: dual handles read no attempt before cross-context admission; one wins, loser cannot mutate', async () => {
  const w = await setup('SQLite'); const second = sqlite(w.storage.location); const other = await composeCore({ ...w, storage: second })
  const readers = [gate(), gate()]; const release = [gate(), gate()]; const branchEntered = gate(); const branchRelease = gate()
  const d = w.providers.development; const get = d.getRepository.bind(d); let read = 0; let branches = 0
  d.getRepository = async (...args) => { const n = read++; if (n < 2) { readers[n].release(); await release[n].wait } return get(...args) }
  const create = d.createBranch.bind(d); d.createBranch = async (...args) => { branches++; if (branches === 1) { branchEntered.release(); await branchRelease.wait } return create(...args) }
  const first = start(w); await readers[0].wait
  const loser = start(w, { workItemId: w.items[1] }, other); await readers[1].wait
  release[0].release(); await branchEntered.wait; const before = local(w.storage)
  release[1].release(); try { conflict(await loser); assert.equal(local(w.storage), before); assert.equal(branches, 1)
    assert.equal(await second.getExecutionContext(contextIdFor(w.workspace.id, w.items[1], 'repo-alpha')), undefined)
  } finally { branchRelease.release(); await first }
  assert.equal((await first).writeState, 'saved'); assert.deepEqual(counts(w), [1, 1, 1])
})
