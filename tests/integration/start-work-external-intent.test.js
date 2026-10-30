import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { CapabilityKey } from '@harness-projects/capabilities'
import { composeCore, contextIdFor } from '@harness-projects/core'
import { createFakeProviders, createFakeExecutionProvider, createFakeStorage, exportFakeStorageState, providerFail } from '@harness-projects/provider-fake'
import { createSqliteStorage, openDatabase } from '@harness-projects/storage-sqlite'
import { controllableClock } from './local-git-fixture.js'

const root = mkdtempSync(join(tmpdir(), 'external-intent-')), handles = []; let seq = 0
after(() => { for (const storage of handles) try { storage.close() } catch {} rmSync(root, { recursive: true, force: true }) })
const sqlite = (file = join(root, `${seq++}.sqlite`)) => { const storage = createSqliteStorage(file); handles.push(storage); return storage }
async function setup(kind, fallback = false) {
  const providers = createFakeProviders(), storage = kind === 'Fake' ? providers.storage : sqlite(), time = controllableClock()
  {
    providers.executionFallback = createFakeExecutionProvider(); const spare = providers.executionFallback, describe = spare.describeCapabilities.bind(spare)
    spare.describeCapabilities = async () => { const s = await describe(); return { ...s, capability: { ...s.capability, [CapabilityKey.ExecutionRunFallback]: 'available' }, permission: { ...s.permission, [CapabilityKey.ExecutionRunFallback]: 'available' } } }
    if (fallback) providers.execution.startRun = async () => providerFail('unavailable', 'definite refusal')
  }
  const workspace = { id: `intent-${seq++}`, name: 'intent' }, options = { providers, storage, workspace, clock: time.clock }, core = await composeCore(options)
  const workItemId = (await core.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item').entityId
  const request = { workItemId, repositoryId: 'repo-alpha', actor: { kind: 'agent' }, idempotencyKey: 'first', worktreePath: '.worktrees/requested' }
  return { ...options, core, request, time, contextId: contextIdFor(workspace.id, workItemId, 'repo-alpha') }
}
const start = (w, key = 'first') => w.core.commands.startWork({ ...w.request, idempotencyKey: key })
const receipt = (w) => w.storage.findMutationAttempt(w.workspace.id, 'first')
const unknown = (r) => assert.deepEqual([r.writeState, r.confirmed], ['unknown', false])
function inject(w, predicate) {
  const transaction = w.storage.transaction.bind(w.storage); let hits = 0
  w.storage.transaction = (work) => transaction((tx) => work(new Proxy(tx, { get(target, key) {
    const fn = Reflect.get(target, key)
    return key === 'putMutationAttempt' ? async (row) => { if (predicate(row)) { hits++; throw Error('intent disk failure') } return fn.call(target, row) } : typeof fn === 'function' ? fn.bind(target) : fn
  } })))
  return () => assert.equal(hits, 1, 'semantic fault must be reached exactly once')
}

for (const kind of ['Fake', 'SQLite']) {
  test(`${kind}: malformed stored intent cannot disappear on restart or read`, async () => {
    const w = await setup(kind); await start(w)
    if (kind === 'Fake') {
      const state = exportFakeStorageState(w.storage); state.attempts[0].externalIntent = {}
      assert.throws(() => createFakeStorage(state), /intent/)
    } else {
      const db = openDatabase(w.storage.location); db.prepare("UPDATE mutation_attempt SET external_intent_json='{}'").run(); db.close()
      await assert.rejects(receipt(w), /intent/)
    }
  })
  for (const fallback of [false, true]) test(`${kind}: exact inputs are committed before every ${fallback ? 'fallback' : 'primary'} external write`, async () => {
    const w = await setup(kind, fallback), seen = [], d = w.providers.development
    d.preflightWorktree = async () => ({ ok: true, value: { path: '.worktrees/canonical' } })
    for (const [provider, method, operation] of [[d, 'createBranch', 'createBranch'], [d, 'createWorktree', 'createWorktree'], [fallback ? w.providers.executionFallback : w.providers.execution, 'startRun', fallback ? 'startFallbackRun' : 'startRun']]) {
      const call = provider[method].bind(provider)
      provider[method] = async (input) => {
        const row = await receipt(w), record = await w.storage.getExecutionContext(w.contextId)
        assert.equal(row.state, 'pending', 'Git Ready cannot settle the complete request')
        assert.deepEqual(row.externalIntent, { contextId: w.contextId, ownerGeneration: record.provisioningGeneration, bindingId: provider.gate.bindingId, state: 'pending', operation, input })
        if (method === 'startRun') { assert.equal(record.status, 'ready'); assert.equal((await start(w)).writeState, 'pending') }
        seen.push(operation); return call(input)
      }
    }
    assert.equal((await start(w)).writeState, 'saved'); assert.deepEqual(seen, ['createBranch', 'createWorktree', fallback ? 'startFallbackRun' : 'startRun'])
    assert.equal((await receipt(w)).externalIntent.state, 'saved')
  })
  for (const operation of ['createBranch', 'createWorktree', 'startRun', 'startFallbackRun']) for (const response of operation.startsWith('create') ? ['throw', 'ambiguous', 'read-throw'] : ['throw', 'ambiguous']) test(`${kind}: accepted ${operation} with ${response} lost ack blocks keys and expired leases`, async () => {
    const w = await setup(kind, operation === 'startFallbackRun'), d = w.providers.development
    const provider = operation.startsWith('create') ? d : operation === 'startFallbackRun' ? w.providers.executionFallback : w.providers.execution
    let fallbackCalls = 0; const spare = w.providers.executionFallback, spareStart = spare.startRun.bind(spare)
    spare.startRun = (input) => { fallbackCalls++; return spareStart(input) }
    const method = operation.startsWith('create') ? operation : 'startRun', call = provider[method].bind(provider); let calls = 0
    provider[method] = async (input) => { calls++; await call(input); if (response === 'throw') throw Error('accepted but ack lost'); return providerFail('ambiguous_result', 'accepted but ack lost') }
    const unreadable = async () => { if (response === 'read-throw') throw Error('reconcile read interrupted'); return providerFail('unavailable', 'read unavailable') }
    d.listBranches = unreadable; d.getWorktree = unreadable
    unknown(await start(w)); const row = await receipt(w), record = await w.storage.getExecutionContext(w.contextId)
    assert.equal(row.externalIntent.operation, operation); assert.equal(row.externalIntent.state, 'unknown')
    for (const key of ['first', 'replacement']) { w.time.advance(31_000); unknown(await start(w, key)) }
    assert.equal(calls, 1); assert.equal(fallbackCalls, operation === 'startFallbackRun' ? 1 : 0); assert.equal(await w.storage.findMutationAttempt(w.workspace.id, 'replacement'), undefined)
    assert.deepEqual(await w.storage.getExecutionContext(w.contextId), record)
    if (kind === 'SQLite') { w.storage.close(); w.storage = sqlite(w.storage.location); w.core = await composeCore(w); assert.deepEqual(await receipt(w), row); unknown(await start(w, 'restart')); assert.equal(calls, 1) }
  })
  const failures = [
    ['createBranch', [0, 0, 0, 0], [1, 0, 0, 0]],
    ['createWorktree', [1, 0, 0, 0], [1, 1, 0, 0]],
    ['startRun', [1, 1, 0, 0], [1, 1, 1, 0]],
    ['startFallbackRun', [1, 1, 0, 0], [1, 1, 0, 1]],
  ]
  for (const [operation, before, after] of failures) for (const state of ['pending', 'saved']) test(`${kind}: ${operation} ${state} storage failure fences the provider or next step`, async () => {
    const w = await setup(kind, operation === 'startFallbackRun'), hit = inject(w, (row) => row.externalIntent?.operation === operation && row.externalIntent.state === state)
    const counts = () => [w.providers.development.state.branches.length, w.providers.development.state.worktrees.length, w.providers.execution.state.runs.length, w.providers.executionFallback.state.runs.length]
    const initial = counts(), result = await start(w); unknown(result); hit()
    assert.deepEqual(counts().map((n, i) => n - initial[i]), state === 'pending' ? before : after)
    assert.match(result.error.message, /intent disk failure/)
    const row = await receipt(w); assert.equal(row.state, 'pending')
    if (state === 'saved') { assert.equal(row.externalIntent.state, 'pending'); assert.equal(row.externalIntent.operation, operation) }
    if (state === 'saved' && operation.startsWith('start')) assert.equal(result.runExternalId, (operation === 'startRun' ? w.providers.execution : w.providers.executionFallback).state.runs.at(-1).ref.externalId)
  })
  for (const fallback of [false, true]) for (const status of ['mystery', 'failed']) test(`${kind}: ${fallback ? 'fallback' : 'primary'} ${status} ack retains root and slot semantics`, async () => {
    const w = await setup(kind, fallback), provider = fallback ? w.providers.executionFallback : w.providers.execution, call = provider.startRun.bind(provider)
    provider.startRun = async (input) => { const r = await call(input); return { ...r, value: { ...r.value, status } } }
    const result = await start(w), row = await receipt(w)
    assert.equal(row.state, status === 'mystery' ? 'unknown' : 'saved'); assert.equal(row.externalIntent.state, row.state)
    if (status === 'mystery') { unknown(result); assert.equal(result.runExternalId, provider.state.runs.at(-1).ref.externalId); unknown(await start(w, 'new-key')) }
    else if (fallback) assert.deepEqual([result.fallback, result.error?.code, result.runExternalId], ['manual_fallback', 'unavailable', undefined], '确定降级结果沿用原契约，结果规范化属于 #458')
  })
  test(`${kind}: committed intent before call interruption remains conservative`, async () => {
    const w = await setup(kind), transaction = w.storage.transaction.bind(w.storage); let hit = false
    w.storage.transaction = async (work) => { const result = await transaction(work); if (!hit && (await receipt(w))?.externalIntent?.state === 'pending') { hit = true; throw Error('interrupted after commit') } return result }
    unknown(await start(w)); assert.equal(hit, true); const generation = (await w.storage.getExecutionContext(w.contextId)).provisioningGeneration
    w.time.advance(31_000); assert.equal((await start(w, 'replacement')).writeState, 'pending')
    assert.equal((await w.storage.getExecutionContext(w.contextId)).provisioningGeneration, generation)
    assert.equal(w.providers.development.state.worktrees.length, 0)
  })
}
