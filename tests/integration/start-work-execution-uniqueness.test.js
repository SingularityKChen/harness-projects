import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { CapabilityKey } from '@harness-projects/capabilities'
import { composeCore, contextIdFor, runIdFor } from '@harness-projects/core'
import { createFakeProviders, createFakeExecutionProvider, createFakeStorage, exportFakeStorageState, providerFail } from '@harness-projects/provider-fake'
import { createSqliteStorage, openDatabase } from '@harness-projects/storage-sqlite'
import { controllableClock } from './local-git-fixture.js'

const root = mkdtempSync(join(tmpdir(), 'execution-uniqueness-')), handles = []; let sequence = 0
after(() => { for (const storage of handles) try { storage.close() } catch {} rmSync(root, { recursive: true, force: true }) })
const sqlite = (file = join(root, `${sequence++}.sqlite`)) => { const storage = createSqliteStorage(file); handles.push(storage); return storage }
const barrier = () => {
  const entered = Promise.withResolvers(), released = Promise.withResolvers()
  return { entered: entered.promise, release: () => released.resolve(), hits: 0,
    async hold() { this.hits++; entered.resolve(); await released.promise } }
}
const start = (w, key = 'original', core = w.core) => core.commands.startWork({ ...w.request, idempotencyKey: key })
const receipt = (w, key = 'original') => w.storage.findMutationAttempt(w.workspace.id, key)
const unknown = (r) => assert.deepEqual([r.writeState, r.confirmed], ['unknown', false])
function snapshot(storage) {
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  if (!storage.location) return digest(exportFakeStorageState(storage))
  const db = openDatabase(storage.location)
  try { return digest(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])) } finally { db.close() }
}
async function setup(kind, fallback = false) {
  const providers = createFakeProviders(), storage = kind === 'Fake' ? providers.storage : sqlite(), time = controllableClock()
  providers.executionFallback = createFakeExecutionProvider()
  const spare = providers.executionFallback, describe = spare.describeCapabilities.bind(spare)
  spare.describeCapabilities = async () => { const s = await describe(); return { ...s,
    capability: { ...s.capability, [CapabilityKey.ExecutionRunFallback]: 'available' }, permission: { ...s.permission, [CapabilityKey.ExecutionRunFallback]: 'available' } } }
  const w = { kind, providers, storage, workspace: { id: `uniqueness-${sequence++}`, name: 'uniqueness' }, clock: time.clock, time, fallback,
    calls: { main: 0, fallback: 0, reads: 0 }, ledger: [] }
  // 不调用幂等 Fake.startRun：每次接受都分配新对象；重复输入也产生第二次真实副作用。
  for (const [port, path] of [[providers.execution, 'main'], [spare, 'fallback']]) {
    port.startRun = async (input) => {
      w.calls[path]++
      if (fallback && path === 'main') return providerFail('unavailable', 'definite primary refusal')
      const ref = { bindingId: port.gate.bindingId, objectKind: 'execution_run', externalId: `allocated-${w.ledger.length + 1}`, url: undefined }
      w.ledger.push({ path, input: structuredClone(input), ref, status: 'running' })
      return { ok: true, value: { ref, status: 'running' } }
    }
    port.getRun = async (ref) => {
      w.calls.reads++
      const run = w.ledger.find((r) => r.ref.bindingId === ref.bindingId && r.ref.externalId === ref.externalId)
      return run ? { ok: true, value: { ref: run.ref, status: run.status } } : providerFail('not_found', 'no such external run')
    }
  }
  w.provider = fallback ? spare : providers.execution
  w.core = await composeCore(w)
  const workItemId = (await w.core.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item').entityId
  w.request = { workItemId, repositoryId: 'repo-alpha', actor: { kind: 'agent' } }
  w.contextId = contextIdFor(w.workspace.id, workItemId, 'repo-alpha'); w.runId = runIdFor(w.contextId)
  return w
}
async function anotherCore(w) {
  const storage = w.kind === 'SQLite' ? sqlite(w.storage.location) : w.storage
  if (w.kind === 'SQLite') assert.notEqual(storage, w.storage, '并发 owner 使用独立 SQLite 连接')
  return composeCore({ ...w, storage })
}
async function reopen(w) {
  // 只在原命令已经结束时关闭；活 owner 并发用 anotherCore，不能靠关闭其连接制造 fence。
  if (w.kind === 'SQLite') { const file = w.storage.location; w.storage.close(); w.storage = sqlite(file) }
  else w.storage = createFakeStorage(exportFakeStorageState(w.storage))
  w.core = await composeCore(w)
}
function onceAfterCommit(w, predicate) {
  const gate = barrier(), transaction = w.storage.transaction.bind(w.storage)
  w.storage.transaction = async (work) => {
    const result = await transaction(work)
    if (gate.hits === 0 && await predicate()) await gate.hold()
    return result
  }
  return gate
}
function assertOne(w) {
  assert.equal(w.ledger.length, 1, 'one accepted create must mean one independent external run')
  assert.deepEqual([w.calls.main, w.calls.fallback], w.fallback ? [1, 1] : [1, 0], '主执行不明不得启动 fallback；明确拒绝才能 fallback')
  const run = w.ledger[0]
  assert.equal(run.path, w.fallback ? 'fallback' : 'main')
  assert.equal(run.input.workingDirectory.length > 0, true)
  assert.equal(run.input.context.externalId, w.contextId)
}

test('external ledger positive control allocates distinct runs for identical accepted inputs', async () => {
  const w = await setup('Fake'), input = { workingDirectory: 'same', context: {}, command: 'same', environment: {} }
  const a = await w.provider.startRun(input), b = await w.provider.startRun(input)
  assert.equal(w.ledger.length, 2); assert.notEqual(a.value.ref.externalId, b.value.ref.externalId)
  assert.deepEqual(w.ledger[0].input, w.ledger[1].input)
})

for (const kind of ['Fake', 'SQLite']) for (const fallback of [false, true]) {
  const label = `${kind} ${fallback ? 'fallback' : 'main'}`
  test(`${label}: public takeover before settle fences live original and preserves complete winner snapshot`, { timeout: 10_000 }, async () => {
    const w = await setup(kind, fallback), gate = barrier(), transaction = w.storage.transaction.bind(w.storage)
    w.storage.transaction = async (work) => {
      const record = await w.storage.getExecutionContext(w.contextId), attempt = await receipt(w)
      if (gate.hits === 0 && record?.status === 'provisioning' && record.worktreeExternalId && attempt?.externalIntent?.state === 'saved') await gate.hold()
      return transaction(work)
    }
    const original = start(w)
    try {
      await gate.entered
      const before = await w.storage.getExecutionContext(w.contextId)
      assert.equal(before.provisioningGeneration, 1); assert.equal(w.ledger.length, 0)
      assert.equal((await receipt(w)).externalIntent.operation, 'createWorktree')
      w.time.advance(31_000)
      const successor = await anotherCore(w), winner = await start(w, 'winner', successor)
      assert.equal(winner.writeState, 'saved'); assertOne(w)
      assert.equal((await w.storage.getExecutionContext(w.contextId)).provisioningGeneration, 2, '公开命令真正推进 owner generation')
      const saved = snapshot(w.storage)
      gate.release(); const late = await original
      assert.equal(snapshot(w.storage), saved, 'late owner must not change complete winner snapshot')
      unknown(late); assert.equal(gate.hits, 1)
      assert.equal((await receipt(w)).state, 'pending'); assertOne(w)
    } finally { gate.release(); await original }
  })
  test(`${label}: durable intent before dispatch blocks public keys and expired second Core`, { timeout: 10_000 }, async () => {
    const w = await setup(kind, fallback)
    const gate = onceAfterCommit(w, async () => (await receipt(w))?.externalIntent?.operation === (fallback ? 'startFallbackRun' : 'startRun') && (await receipt(w)).externalIntent.state === 'pending')
    const original = start(w)
    try {
      await gate.entered
      const intent = (await receipt(w)).externalIntent
      assert.equal(intent.ownerGeneration, 1); assert.equal(w.ledger.length, 0)
      assert.equal(intent.bindingId, w.provider.gate.bindingId); assert.equal(intent.contextId, w.contextId)
      w.time.advance(31_000); const observer = await anotherCore(w), before = snapshot(w.storage)
      for (const key of ['original', 'replacement']) {
        const result = await start(w, key, observer); assert.equal(result.confirmed, false)
        assert.ok(['pending', 'unknown'].includes(result.writeState))
      }
      assert.equal(snapshot(w.storage), before, 'observation must not replace intent or claim another owner')
      assert.equal(await receipt(w, 'replacement'), undefined); assert.equal(w.ledger.length, 0)
      gate.release(); assert.equal((await original).writeState, 'saved')
      assert.equal(gate.hits, 1); assertOne(w); assert.deepEqual(w.ledger[0].input, intent.input)
    } finally { gate.release(); await original }
  })
  for (const ack of ['held', 'lost']) test(`${label}: accepted ${ack} ack blocks another public create without run row`, { timeout: 10_000 }, async () => {
    const w = await setup(kind, fallback), gate = barrier(), allocate = w.provider.startRun.bind(w.provider)
    w.provider.startRun = async (input) => {
      const result = await allocate(input)
      if (gate.hits === 0) await gate.hold()
      return ack === 'lost' ? providerFail('ambiguous_result', 'accepted response lost') : result
    }
    const original = start(w)
    try {
      await gate.entered; assertOne(w)
      const intent = (await receipt(w)).externalIntent
      assert.equal(await w.storage.getExecutionRun(w.runId), undefined)
      assert.equal(intent.state, 'pending'); assert.deepEqual(w.ledger[0].input, intent.input)
      w.time.advance(31_000); const observer = await anotherCore(w), before = snapshot(w.storage)
      const observations = []
      for (const key of ['original', 'replacement']) observations.push(await start(w, key, observer))
      assertOne(w)
      for (const result of observations) assert.equal(result.confirmed, false)
      assert.equal(snapshot(w.storage), before); assert.equal(await receipt(w, 'replacement'), undefined)
      gate.release(); const result = await original
      if (ack === 'lost') unknown(result); else assert.equal(result.writeState, 'saved')
      assert.equal(gate.hits, 1); assertOne(w)
    } finally { gate.release(); await original }
  })
  for (const known of [false, true]) test(`${label}: real restart retains ${known ? 'known identity and original receipt' : 'missing identity as Unknown'} without another create`, async () => {
    const w = await setup(kind, fallback), allocate = w.provider.startRun.bind(w.provider)
    w.provider.startRun = async (input) => {
      const result = await allocate(input)
      return known ? { ...result, value: { ...result.value, status: 'mystery' } } : providerFail('ambiguous_result', 'accepted response lost')
    }
    unknown(await start(w)); assertOne(w)
    const originalIntent = (await receipt(w)).externalIntent, originalRun = await w.storage.getExecutionRun(w.runId)
    assert.equal(originalRun?.providerRef?.externalId, known ? w.ledger[0].ref.externalId : undefined)
    await reopen(w); w.time.advance(31_000)
    for (const key of ['replacement', 'original']) {
      const result = await start(w, key)
      if (known) { assert.equal(result.writeState, 'saved'); assert.equal(result.runExternalId, w.ledger[0].ref.externalId) }
      else unknown(result)
      assert.equal(result.fallback, fallback ? 'manual_fallback' : undefined)
    }
    assert.equal(await receipt(w, 'replacement'), undefined); assertOne(w)
    assert.equal(w.calls.reads, known ? 1 : 0)
    assert.deepEqual((await receipt(w)).externalIntent, { ...originalIntent, state: known ? 'saved' : 'unknown' })
  })
  test(`${label}: late original finalization preserves publicly reconciled Saved receipt`, { timeout: 10_000 }, async () => {
    const w = await setup(kind, fallback), allocate = w.provider.startRun.bind(w.provider)
    w.provider.startRun = async (input) => { const result = await allocate(input); return { ...result, value: { ...result.value, status: 'mystery' } } }
    const gate = onceAfterCommit(w, async () => (await w.storage.getExecutionRun(w.runId))?.status === 'unknown' && (await receipt(w))?.state === 'pending')
    const original = start(w)
    try {
      await gate.entered; const observer = await anotherCore(w)
      const recovered = await start(w, 'observer', observer)
      assert.equal(recovered.writeState, 'saved'); assert.equal((await receipt(w)).state, 'saved')
      const saved = snapshot(w.storage)
      gate.release(); await original
      assert.equal(gate.hits, 1); assertOne(w)
      assert.equal((await receipt(w)).state, 'saved', 'late original must not downgrade publicly reconciled Saved receipt')
      assert.equal(snapshot(w.storage), saved, 'late original must preserve complete reconciled snapshot')
      assert.equal((await receipt(w)).externalIntent.state, 'saved'); assert.equal(await receipt(w, 'observer'), undefined)
    } finally { gate.release(); await original }
  })
}
