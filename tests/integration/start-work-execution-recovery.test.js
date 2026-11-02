import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AccessLevel, CapabilityKey } from '@harness-projects/capabilities'
import { composeCore, contextIdFor, runIdFor } from '@harness-projects/core'
import { createFakeProviders, createFakeExecutionProvider, createFakeStorage, exportFakeStorageState, providerFail } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

const root = mkdtempSync(join(tmpdir(), 'execution-recovery-')), handles = []; let seq = 0
after(() => { for (const s of handles) try { s.close() } catch {} rmSync(root, { recursive: true, force: true }) })
const sqlite = (file = join(root, `${seq++}.sqlite`)) => { const s = createSqliteStorage(file); handles.push(s); return s }
async function setup(kind, fallback = false) {
  const providers = createFakeProviders(), storage = kind === 'Fake' ? providers.storage : sqlite()
  providers.executionFallback = createFakeExecutionProvider()
  const spare = providers.executionFallback, describe = spare.describeCapabilities.bind(spare)
  spare.describeCapabilities = async () => { const s = await describe(); return { ...s, capability: { ...s.capability, [CapabilityKey.ExecutionRunFallback]: 'available' }, permission: { ...s.permission, [CapabilityKey.ExecutionRunFallback]: 'available' } } }
  if (fallback) providers.execution.startRun = async () => providerFail('unavailable', 'definite refusal')
  const w = { providers, storage, workspace: { id: `recover-${seq++}`, name: 'recovery' }, fallback }
  w.core = await composeCore(w)
  const workItemId = (await w.core.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item').entityId
  w.request = { workItemId, repositoryId: 'repo-alpha', actor: { kind: 'agent' }, idempotencyKey: 'original' }
  w.contextId = contextIdFor(w.workspace.id, workItemId, 'repo-alpha'); w.runId = runIdFor(w.contextId)
  w.provider = fallback ? spare : providers.execution
  const start = w.provider.startRun.bind(w.provider); w.starts = 0; w.reads = 0
  w.provider.startRun = (input) => { w.starts++; return start(input) }
  const get = w.provider.getRun.bind(w.provider)
  w.provider.getRun = (ref) => { w.reads++; return get(ref) }
  return w
}
const start = (w, key = 'original', extra = {}) => w.core.commands.startWork({ ...w.request, idempotencyKey: key, ...extra })
const receipt = (w) => w.storage.findMutationAttempt(w.workspace.id, 'original')
const unknown = (r) => assert.deepEqual([r.writeState, r.confirmed, r.degraded], ['unknown', false, true])
function inject(w, method, predicate, action = () => { throw Error('receipt disk failure') }) {
  const transaction = w.storage.transaction.bind(w.storage); let hits = 0
  w.storage.transaction = (work) => transaction((tx) => work(new Proxy(tx, { get(target, key) {
    const fn = Reflect.get(target, key)
    return key === method ? async (row) => { if (predicate(row) && hits++ === 0) await action(row); return fn.call(target, row) } : typeof fn === 'function' ? fn.bind(target) : fn
  } })))
  return () => assert.equal(hits, 1, 'semantic injection hit exactly once')
}
function receiptFault(w) { return inject(w, 'putMutationAttempt', (r) => r.state === 'saved' && r.externalIntent?.operation === (w.fallback ? 'startFallbackRun' : 'startRun')) }
async function reopen(w) {
  if (w.storage.location) { const file = w.storage.location; w.storage.close(); w.storage = sqlite(file) }
  else w.storage = createFakeStorage(exportFakeStorageState(w.storage))
  w.core = await composeCore(w)
}
for (const kind of ['Fake', 'SQLite']) for (const fallback of [false, true]) {
  test(`${kind} ${fallback ? 'fallback' : 'main'}: journal survives receipt rollback and restart converges original key`, async () => {
    const w = await setup(kind, fallback), hit = receiptFault(w), first = await start(w)
    unknown(first); hit()
    const run = await w.storage.getExecutionRun(w.runId)
    assert.equal(run?.providerRef?.externalId, first.runExternalId, 'ack identity must survive receipt transaction rollback')
    assert.equal(run?.fallback === true, fallback)
    await reopen(w)
    const result = await start(w, 'replacement')
    assert.deepEqual([result.writeState, result.runExternalId, result.fallback, w.starts, w.reads], ['saved', first.runExternalId, fallback ? 'manual_fallback' : undefined, 1, 1])
    assert.equal((await receipt(w)).state, 'saved'); assert.equal(await w.storage.findMutationAttempt(w.workspace.id, 'replacement'), undefined)
    assert.equal((await start(w)).runExternalId, first.runExternalId); assert.equal(w.starts, 1)
  })
  test(`${kind} ${fallback ? 'fallback' : 'main'}: unknown ack with durable ref is reconciled by explicit replay`, async () => {
    const w = await setup(kind, fallback), call = w.provider.startRun.bind(w.provider)
    w.provider.startRun = async (input) => { const r = await call(input); return { ...r, value: { ...r.value, status: 'mystery' } } }
    const first = await start(w); unknown(first); await reopen(w)
    assert.equal((await start(w)).writeState, 'saved')
    assert.deepEqual([(await receipt(w)).state, (await w.storage.getExecutionRun(w.runId)).status, w.starts, w.reads], ['saved', 'running', 1, 1])
  })
}
function barrier() {
  let enter, release
  const entered = new Promise((r) => { enter = r }), waiting = new Promise((r) => { release = r })
  return { entered, release, async hold() { enter(); await waiting } }
}
for (const kind of ['Fake', 'SQLite']) {
  for (const fallback of [false, true]) for (const loss of ['journal', 'lost-ack', 'foreign-ref']) test(`${kind} ${fallback ? 'fallback' : 'main'}: ${loss} has no recoverable identity and never dispatches again`, async () => {
    const w = await setup(kind, fallback); let hit
    if (loss === 'journal') hit = inject(w, 'putExecutionRun', () => true)
    else {
      const call = w.provider.startRun.bind(w.provider)
      w.provider.startRun = async (input) => { const r = await call(input); return loss === 'lost-ack' ? providerFail('ambiguous_result', 'ack lost') : { ...r, value: { ...r.value, ref: { ...r.value.ref, bindingId: 'foreign' } } } }
    }
    const first = await start(w); unknown(first); hit?.()
    assert.equal(first.fallback, fallback ? 'manual_fallback' : undefined)
    await reopen(w)
    for (const key of ['original', 'replacement']) {
      const r = await start(w, key); unknown(r); assert.equal(r.fallback, fallback ? 'manual_fallback' : undefined)
    }
    assert.deepEqual([w.starts, w.reads, (await receipt(w)).externalIntent.operation], [1, 0, fallback ? 'startFallbackRun' : 'startRun'])
    assert.equal((await w.storage.getExecutionRun(w.runId))?.providerRef, undefined)
  })
  for (const response of ['denied', 'not-found', 'throw', 'foreign-ref', 'unknown', 'no-read']) test(`${kind}: ${response} cold read retains receipt and exact local facts`, async () => {
    const w = await setup(kind), hit = receiptFault(w); await start(w); hit(); await reopen(w)
    const before = await receipt(w), run = await w.storage.getExecutionRun(w.runId)
    if (response === 'no-read') w.core = await composeCore({ ...w, policy: { [CapabilityKey.ExecutionRunRead]: AccessLevel.Unavailable } })
    else w.provider.getRun = async (ref) => {
      w.reads++
      if (response === 'throw') throw Error('read interrupted')
      if (response === 'denied' || response === 'not-found') return providerFail(response === 'denied' ? 'permission_denied' : 'not_found', 'unreadable')
      return { ok: true, value: { ref: response === 'foreign-ref' ? { ...ref, externalId: 'other' } : ref, status: response === 'unknown' ? 'mystery' : 'running' } }
    }
    unknown(await start(w)); unknown(await start(w, 'replacement'))
    assert.deepEqual(await receipt(w), before); assert.deepEqual(await w.storage.getExecutionRun(w.runId), run); assert.equal(w.starts, 1)
    assert.equal(w.reads, response === 'no-read' ? 0 : 2)
  })
  for (const status of ['succeeded', 'failed', 'canceled']) test(`${kind}: cold read confirms known ${status} on original receipt`, async () => {
    const w = await setup(kind), hit = receiptFault(w); await start(w); hit(); await reopen(w)
    w.provider.getRun = async (ref) => { w.reads++; return { ok: true, value: { ref, status } } }
    const r = await start(w); assert.equal(r.writeState, 'saved')
    assert.deepEqual([(await w.storage.getExecutionRun(w.runId)).status, (await receipt(w)).state, w.starts, w.reads], [status, 'saved', 1, 1])
  })
  for (const change of ['generation', 'ref', 'receipt', 'fallback', 'timestamp', 'status']) test(`${kind}: late recovery read cannot overwrite changed ${change}`, async () => {
    const w = await setup(kind), hit = receiptFault(w); await start(w); hit(); await reopen(w)
    const b = barrier(), get = w.provider.getRun.bind(w.provider); let hits = 0
    w.provider.getRun = async (ref) => { hits++; await b.hold(); return get(ref) }
    const pending = start(w); await b.entered
    if (change === 'generation') { const r = await w.storage.getExecutionContext(w.contextId); await w.storage.putExecutionContext({ ...r, provisioningGeneration: r.provisioningGeneration + 1 }) }
    else if (change === 'receipt') await w.storage.putMutationAttempt({ ...await receipt(w), state: 'failed', errorCode: 'unavailable' })
    else { const r = await w.storage.getExecutionRun(w.runId); await w.storage.putExecutionRun({ ...r, ...(change === 'ref' ? { providerRef: { ...r.providerRef, externalId: 'successor' } } : change === 'fallback' ? { fallback: true } : change === 'timestamp' ? { updatedAt: '2026-11-02T01:01:01.001Z' } : { status: 'canceled' }) }) }
    const before = [await receipt(w), await w.storage.getExecutionRun(w.runId), await w.storage.getExecutionContext(w.contextId)]
    b.release(); const result = await pending
    if (change !== 'receipt') unknown(result)
    assert.deepEqual([await receipt(w), await w.storage.getExecutionRun(w.runId), await w.storage.getExecutionContext(w.contextId)], before)
    assert.equal(hits, 1); assert.equal(w.starts, 1)
  })
  for (const operation of ['refresh', 'cancel']) test(`${kind}: receipt-only finalization retains newer ${operation} state`, async () => {
    const w = await setup(kind), b = barrier(), transaction = w.storage.transaction.bind(w.storage); let hits = 0
    w.storage.transaction = async (work) => {
      const r = await transaction(work)
      if (hits === 0 && await w.storage.getExecutionRun(w.runId) !== undefined && (await receipt(w))?.state === 'pending') { hits++; await b.hold() }
      return r
    }
    const pending = start(w); await b.entered
    if (operation === 'cancel') await w.core.commands.cancelExecutionRun(w.request)
    else { const run = w.provider.state.runs.at(-1); run.status = 'succeeded'; await w.core.commands.refreshExecutionRun(w.request) }
    const before = await w.storage.getExecutionRun(w.runId)
    assert.equal(before.status, operation === 'cancel' ? 'canceled' : 'succeeded')
    b.release(); assert.equal((await pending).writeState, 'saved')
    assert.deepEqual(await w.storage.getExecutionRun(w.runId), before); assert.equal(hits, 1)
  })
  test(`${kind}: another command's unresolved context intent is never replayed or recovered`, async () => {
    const w = await setup(kind); await start(w)
    const original = await receipt(w), transaction = w.storage.transaction.bind(w.storage)
    const foreign = { ...original, id: 'foreign', commandName: 'createPullRequest', idempotencyKey: 'foreign', state: 'unknown', errorCode: 'conflict', externalIntent: { ...original.externalIntent, state: 'unknown' } }
    const find = w.storage.findMutationAttempt.bind(w.storage)
    w.storage.findMutationAttempt = (workspace, key) => key === 'foreign' ? Promise.resolve(foreign) : find(workspace, key)
    w.storage.transaction = (work) => transaction((tx) => work(new Proxy(tx, { get(target, key) { return key === 'listMutationAttempts' ? async (...args) => [foreign, ...await target.listMutationAttempts(...args)] : typeof target[key] === 'function' ? target[key].bind(target) : target[key] } })))
    const r = await start(w, 'replacement')
    assert.equal(r.writeState, 'saved'); assert.equal(w.reads, 0); assert.equal(w.starts, 1)
    assert.equal((await w.storage.findMutationAttempt(w.workspace.id, 'replacement')).commandName, 'startWork')
  })
  test(`${kind}: request identity, visibility and binding checks precede recovery writes`, async () => {
    const w = await setup(kind), hit = receiptFault(w); await start(w); hit(); await reopen(w)
    const before = await receipt(w)
    for (const extra of [{ actor: { kind: 'human' } }, { branchName: 'other' }, { worktreePath: 'other' }]) assert.equal((await start(w, 'original', extra)).error.code, 'conflict')
    const projection = await w.storage.getPlanningProjection(w.workspace.id, w.request.workItemId)
    await w.storage.putPlanningProjection(w.workspace.id, { ...projection, content: { contentKind: 'redacted' } })
    assert.equal((await start(w)).error.code, 'not_found')
    await w.storage.putPlanningProjection(w.workspace.id, projection)
    w.core = await composeCore({ ...w, providers: { ...w.providers, development: createFakeProviders().development } })
    assert.equal((await start(w)).error.code, 'conflict')
    assert.deepEqual(await receipt(w), before); assert.equal(w.reads, 0); assert.equal(w.starts, 1)
  })
  test(`${kind}: query is local while a durable unknown run awaits explicit recovery`, async () => {
    const w = await setup(kind), call = w.provider.startRun.bind(w.provider)
    w.provider.startRun = async (input) => { const r = await call(input); return { ...r, value: { ...r.value, status: 'mystery' } } }
    await start(w); const before = await receipt(w)
    assert.equal((await w.core.queries.getExecutionContext(w.request)).degraded, true)
    assert.deepEqual(await receipt(w), before); assert.equal(w.reads, 0)
  })
}
for (const kind of ['Fake', 'SQLite']) for (const ref of ['empty', 'kind']) test(`${kind}: ${ref} ack identity is rejected before journal`, async () => {
  const w = await setup(kind), call = w.provider.startRun.bind(w.provider)
  w.provider.startRun = async (input) => { const r = await call(input); return { ...r, value: { ...r.value, ref: { ...r.value.ref, ...(ref === 'empty' ? { externalId: '' } : { objectKind: 'repository' }) } } } }
  unknown(await start(w)); await reopen(w); unknown(await start(w)); assert.equal(w.starts, 1); assert.equal(w.reads, 0)
})
for (const kind of ['Fake', 'SQLite']) test(`${kind}: failed fallback ack retains actual handle and fallback when receipt fails`, async () => {
  const w = await setup(kind, true), call = w.provider.startRun.bind(w.provider), hit = receiptFault(w)
  w.provider.startRun = async (input) => { const r = await call(input); return { ...r, value: { ...r.value, status: 'failed' } } }
  const r = await start(w); unknown(r); hit()
  assert.deepEqual([r.runExternalId, r.fallback, (await w.storage.getExecutionRun(w.runId))?.providerRef?.externalId], [w.provider.state.runs.at(-1).ref.externalId, 'manual_fallback', w.provider.state.runs.at(-1).ref.externalId])
})

for (const kind of ['Fake', 'SQLite']) for (const fallback of [false, true]) for (const successor of ['reconciled', 'failed', 'unknown']) test(`${kind} ${fallback}: late original finalizer preserves ${successor} successor receipt and result`, async () => {
  const w = await setup(kind, fallback), b = barrier(), transaction = w.storage.transaction.bind(w.storage); let hits = 0
  const call = w.provider.startRun.bind(w.provider)
  w.provider.startRun = async (input) => { const r = await call(input); return { ...r, value: { ...r.value, status: 'mystery' } } }
  w.storage.transaction = async (work) => {
    const r = await transaction(work)
    if (hits === 0 && await w.storage.getExecutionRun(w.runId) !== undefined && (await receipt(w))?.state === 'pending') { hits++; await b.hold() }
    return r
  }
  const original = start(w); await b.entered
  let expected
  if (successor === 'reconciled') {
    const observer = await composeCore(w)
    expected = await observer.commands.startWork({ ...w.request, idempotencyKey: 'observer' })
    assert.equal(expected.writeState, 'saved')
  } else {
    const r = await receipt(w)
    await w.storage.putMutationAttempt({ ...r, state: successor, errorCode: 'permission_denied', externalIntent: { ...r.externalIntent, state: successor } })
  }
  const before = [await receipt(w), await w.storage.getExecutionRun(w.runId)]
  b.release(); const result = await original
  assert.deepEqual([await receipt(w), await w.storage.getExecutionRun(w.runId)], before, 'late original writer cannot downgrade or replace another writer’s full receipt/run')
  assert.deepEqual([result.writeState, result.error?.code, result.runExternalId, result.fallback], successor === 'reconciled'
    ? [expected.writeState, undefined, expected.runExternalId, expected.fallback]
    : [successor, 'permission_denied', before[1].providerRef.externalId, fallback ? 'manual_fallback' : undefined])
  assert.deepEqual([hits, w.starts, w.reads], [1, 1, successor === 'reconciled' ? 1 : 0])
})

for (const kind of ['Fake', 'SQLite']) for (const fallback of [false, true]) for (const path of ['applied', 'stale-success']) for (const worktree of ['missing', 'wrong-branch', 'denied', 'unavailable', 'healthy']) test(`${kind} ${fallback}: ${path} recovery keeps Ready verification for ${worktree} worktree`, async () => {
  const w = await setup(kind, fallback), hit = receiptFault(w); await start(w); hit(); await reopen(w)
  let pending, b, hits = 0, before
  if (path === 'stale-success') {
    b = barrier(); const get = w.provider.getRun.bind(w.provider)
    w.provider.getRun = async (ref) => { if (hits++ === 0) await b.hold(); return get(ref) }
    pending = start(w); await b.entered
    const observer = await composeCore(w)
    assert.equal((await observer.commands.startWork({ ...w.request, idempotencyKey: 'observer' })).writeState, 'saved')
    before = [await receipt(w), await w.storage.getExecutionRun(w.runId)]
  }
  const getWorktree = w.providers.development.getWorktree.bind(w.providers.development); let worktreeReads = 0
  w.providers.development.getWorktree = async (ref) => {
    worktreeReads++
    if (worktree === 'missing' || worktree === 'denied' || worktree === 'unavailable') return providerFail(worktree === 'missing' ? 'not_found' : worktree === 'denied' ? 'permission_denied' : 'unavailable', 'worktree read result')
    const r = await getWorktree(ref)
    return worktree === 'wrong-branch' ? { ...r, value: { ...r.value, branch: 'work/other' } } : r
  }
  b?.release(); const result = await (pending ?? start(w)), next = await start(w)
  const failed = worktree === 'missing' || worktree === 'wrong-branch'
  const face = [failed ? 'failed' : 'ready', failed ? 'failed' : worktree === 'healthy' ? 'saved' : 'unknown']
  assert.deepEqual([result.status, result.writeState], face)
  assert.deepEqual([next.status, next.writeState], face, 'unchanged external facts give the same answer immediately')
  assert.equal(worktreeReads, failed ? 1 : 2)
  assert.deepEqual([w.starts, w.reads], [1, path === 'stale-success' ? 2 : 1])
  if (before) {
    assert.deepEqual([await receipt(w), await w.storage.getExecutionRun(w.runId)], before)
    assert.equal(hits, 2, 'one blocked read plus one independent observer read')
  }
})
for (const kind of ['Fake', 'SQLite']) for (const fallback of [false, true]) for (const worktree of ['missing', 'wrong-branch', 'denied', 'unavailable']) test(`${kind} ${fallback}: late finalizer verifies ${worktree} worktree after another Core confirms`, async () => {
  const w = await setup(kind, fallback), b = barrier(), transaction = w.storage.transaction.bind(w.storage); let hits = 0
  const call = w.provider.startRun.bind(w.provider)
  w.provider.startRun = async (input) => { const r = await call(input); return { ...r, value: { ...r.value, status: 'mystery' } } }
  w.storage.transaction = async (work) => {
    const r = await transaction(work)
    if (hits === 0 && await w.storage.getExecutionRun(w.runId) !== undefined && (await receipt(w))?.state === 'pending') { hits++; await b.hold() }
    return r
  }
  const original = start(w); await b.entered
  const observer = await composeCore(w)
  assert.equal((await observer.commands.startWork({ ...w.request, idempotencyKey: 'observer' })).writeState, 'saved')
  const before = [await receipt(w), await w.storage.getExecutionRun(w.runId)]
  const getWorktree = w.providers.development.getWorktree.bind(w.providers.development); let worktreeReads = 0
  w.providers.development.getWorktree = async (ref) => {
    worktreeReads++
    if (worktree !== 'wrong-branch') return providerFail(worktree === 'missing' ? 'not_found' : worktree === 'denied' ? 'permission_denied' : 'unavailable', 'worktree changed')
    const r = await getWorktree(ref); return { ...r, value: { ...r.value, branch: 'work/other' } }
  }
  b.release(); const result = await original
  assert.deepEqual([result.status, result.writeState], ['missing', 'wrong-branch'].includes(worktree) ? ['failed', 'failed'] : ['ready', 'unknown'])
  assert.deepEqual([await receipt(w), await w.storage.getExecutionRun(w.runId)], before)
  assert.deepEqual([hits, w.starts, w.reads, worktreeReads], [1, 1, 1, 1])
})
for (const kind of ['Fake', 'SQLite']) for (const fallback of [false, true]) for (const path of ['applied', 'stale-success']) test(`${kind} ${fallback}: ${path} recovery worktree throw preserves Unknown and durable execution facts`, async () => {
  const w = await setup(kind, fallback), hit = receiptFault(w), first = await start(w); hit(); await reopen(w)
  let pending, b, before, barrierHits = 0
  if (path === 'stale-success') {
    b = barrier(); const get = w.provider.getRun.bind(w.provider)
    w.provider.getRun = async (ref) => { if (barrierHits++ === 0) await b.hold(); return get(ref) }
    pending = start(w); await b.entered
    const observer = await composeCore(w)
    assert.equal((await observer.commands.startWork({ ...w.request, idempotencyKey: 'observer' })).writeState, 'saved')
    before = [await receipt(w), await w.storage.getExecutionRun(w.runId)]
  }
  let throws = 0
  w.providers.development.getWorktree = async () => { throws++; throw Error('worktree transport disconnected') }
  b?.release(); const result = await (pending ?? start(w))
  unknown(result)
  assert.deepEqual([result.status, result.runExternalId, result.fallback], ['ready', first.runExternalId, fallback ? 'manual_fallback' : undefined])
  const row = await receipt(w), run = await w.storage.getExecutionRun(w.runId)
  assert.deepEqual([row.state, row.externalIntent.state, run.status, run.providerRef.externalId, run.fallback === true], ['saved', 'saved', 'running', first.runExternalId, fallback])
  assert.deepEqual([throws, w.starts, w.reads], [1, 1, path === 'stale-success' ? 2 : 1])
  if (before) { assert.deepEqual([row, run], before); assert.equal(barrierHits, 2, 'one blocked read and one observer read') }
})
