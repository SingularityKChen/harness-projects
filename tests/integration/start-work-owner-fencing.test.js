import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { CapabilityKey } from '@harness-projects/capabilities'
import { composeCore, contextIdFor, runIdFor } from '@harness-projects/core'
import { AccessLevel } from '@harness-projects/domain'
import { createFakeProviders, createFakeExecutionProvider, createFakeStorage, exportFakeStorageState, providerFail } from '@harness-projects/provider-fake'
import { createSqliteStorage, openDatabase } from '@harness-projects/storage-sqlite'
import { controllableClock } from './local-git-fixture.js'

const root = mkdtempSync(join(tmpdir(), 'owner-fencing-')); let serial = 0
const handles = []; after(() => { for (const s of handles) try { s.close() } catch {} rmSync(root, { recursive: true, force: true }) })
const sql = (file = join(root, `${serial++}.sqlite`)) => { const s = createSqliteStorage(file); handles.push(s); return s }
async function setup(kind, fallback = false) {
  const providers = createFakeProviders(), storage = kind === 'Fake' ? providers.storage : sql(), time = controllableClock()
  if (fallback) { providers.executionFallback = createFakeExecutionProvider(); const spare = providers.executionFallback, describe = spare.describeCapabilities.bind(spare); spare.describeCapabilities = async () => {
    const s = await describe(); return { ...s, capability: { ...s.capability, [CapabilityKey.ExecutionRunFallback]: AccessLevel.Available }, permission: { ...s.permission, [CapabilityKey.ExecutionRunFallback]: AccessLevel.Available } }
  } }
  const workspace = { id: `owner-${serial++}`, name: 'owner fencing' }, options = { providers, storage, workspace, clock: time.clock }
  const core = await composeCore(options), workItemId = (await core.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item').entityId
  const request = { workItemId, repositoryId: 'repo-alpha', actor: { kind: 'agent' } }, contextId = contextIdFor(workspace.id, workItemId, 'repo-alpha')
  return { ...options, core, time, request, contextId, runId: runIdFor(contextId) }
}
const start = (w, key, core = w.core) => core.commands.startWork({ ...w.request, idempotencyKey: key })
function snapshot(w) {
  if (!w.storage.location) return JSON.stringify(exportFakeStorageState(w.storage))
  const db = openDatabase(w.storage.location)
  try { return JSON.stringify(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])) } finally { db.close() }
}
const barrier = () => ({ entered: Promise.withResolvers(), release: Promise.withResolvers(), hits: 0 })
function holdAck(provider, method) {
  const gate = barrier(), call = provider[method].bind(provider)
  provider[method] = async (...args) => { const result = await call(...args); if (++gate.hits === 1) { gate.entered.resolve(); await gate.release.promise } return result }
  return gate
}
function lost(result) { assert.deepEqual([result.writeState, result.confirmed, result.error?.code], ['unknown', false, 'result_unknown']); assert.match(result.error.message, /所有权已丢失/) }

for (const kind of ['Fake', 'SQLite']) {
  for (const step of ['claim', 'createBranch', 'createWorktree', 'settle']) test(`${kind}: live old owner held at ${step} cannot settle after command takeover`, { timeout: 10_000 }, async () => {
    const w = await setup(kind); let gate
    if (step !== 'settle' && step !== 'claim') gate = holdAck(w.providers.development, step)
    else {
      gate = barrier(); const transaction = w.storage.transaction.bind(w.storage)
      // barrier 在 BEGIN 之前，不持锁阻止后继认领；工作树步骤已提交后的首个事务就是 final settle。
      w.storage.transaction = async (work) => { const record = await w.storage.getExecutionContext(w.contextId)
        if (!gate.hits && record?.status === 'provisioning' && (step === 'claim' ? !record.branchExternalId : record.worktreeExternalId)) { gate.hits++; gate.entered.resolve(); await gate.release.promise }
        return transaction(work)
      }
    }
    const old = start(w, 'old')
    try {
      await gate.entered.promise
      const before = await w.storage.getExecutionContext(w.contextId)
      assert.equal((await start(w, 'within-lease')).writeState, 'pending')
      assert.equal((await w.storage.getExecutionContext(w.contextId)).provisioningGeneration, before.provisioningGeneration, 'in-flight 不增代')
      w.time.advance(31_000)
      if (step.startsWith('create')) {
        const blocked = snapshot(w); assert.equal((await start(w, 'winner')).writeState, 'pending'); assert.equal(snapshot(w), blocked)
        await w.storage.putExecutionContext({ ...before, provisioningGeneration: 2 }) // 明确后继 fixture，仍独立验证迟到 owner 的结算 fence
      } else assert.equal((await start(w, 'winner')).writeState, 'saved')
      const winner = snapshot(w); gate.release.resolve(); const result = await old
      assert.equal(snapshot(w), winner, '旧 context/relations/run/attempt/revision 全快照不得改写赢家')
      if (step === 'claim') assert.deepEqual([result.writeState, result.error?.code, result.branchExternalId], ['conflict', 'conflict', undefined], '外部调用前丢失所有权不假称已有 ack')
      else { lost(result); assert.ok(result.branchExternalId, '旧调用已 ack 的分支仍在结果里') }
      assert.equal((await w.storage.getExecutionContext(w.contextId)).provisioningGeneration, 2)
      assert.equal((await w.storage.findMutationAttempt(w.workspace.id, 'old')).state, 'pending', '不替旧 attempt 伪造结算')
    } finally { gate.release.resolve(); await old }
  })

  test(`${kind}: route-denied expired takeover revokes old owner before Failed settlement`, async () => {
    const w = await setup(kind), gate = holdAck(w.providers.development, 'createWorktree'), old = start(w, 'old')
    try {
      await gate.entered.promise; w.time.advance(31_000)
      const denied = await composeCore({ ...w, policy: { [CapabilityKey.DevelopmentWorktreeCreate]: AccessLevel.Unavailable } })
      const before = snapshot(w); assert.equal((await start(w, 'denied', denied)).writeState, 'pending'); assert.equal(snapshot(w), before)
      await w.storage.putExecutionContext({ ...await w.storage.getExecutionContext(w.contextId), provisioningGeneration: 2, status: 'failed' })
      const winner = snapshot(w); gate.release.resolve(); lost(await old)
      assert.equal(snapshot(w), winner, '拒绝接管的 Failed 也不能被旧回调撤销')
      assert.equal((await w.storage.getExecutionContext(w.contextId)).provisioningGeneration, 2)
    } finally { gate.release.resolve(); await old }
  })

  for (const mode of ['main-success', 'main-ambiguous', 'main-failed', 'fallback-success', 'fallback-failed', 'fallback-ambiguous']) test(`${kind}: ${mode} late run result obeys durable Ready generation fixture`, { timeout: 10_000 }, async () => {
    const w = await setup(kind, mode.startsWith('fallback')), gate = barrier()
    let fallbackCalls = 0
    for (const port of [w.providers.execution, w.providers.executionFallback].filter(Boolean)) { const execute = port.startRun.bind(port); port.startRun = async (input) => {
      const fallback = input.command.startsWith('manual fallback'); if (fallback) fallbackCalls++
      if (mode.startsWith('fallback') && !fallback) return providerFail('unavailable', 'primary unavailable')
      const result = mode.endsWith('ambiguous') ? providerFail('ambiguous_result', 'lost ack') : mode.endsWith('failed') ? providerFail('unavailable', 'refused') : await execute(input)
      gate.hits++; gate.entered.resolve(); await gate.release.promise; return result
    } }
    const old = start(w, 'old')
    try {
      await gate.entered.promise
      // Ready 缺 run 的公开命令不会正常接管：这里明确安装 Storage 后继 fixture，只证明结算协议，不证明外部 start 唯一。
      await w.storage.transaction(async (tx) => {
        const previous = await tx.getExecutionContext(w.contextId); assert.equal(previous.status, 'ready')
        await tx.putExecutionContext({ ...previous, provisioningGeneration: (previous.provisioningGeneration ?? 0) + 1 })
        await tx.putExecutionRun({ id: w.runId, workspaceId: w.workspace.id, contextId: w.contextId, status: 'running', updatedAt: w.time.clock(),
          providerRef: { bindingId: w.providers.execution.gate.bindingId, objectKind: 'execution_run', externalId: 'winner-run', url: undefined } })
      })
      const winner = snapshot(w); gate.release.resolve(); const result = await old
      assert.equal(snapshot(w), winner, '迟到的主/unknown/人工 run 不得覆盖后继')
      lost(result); assert.notEqual(result.runExternalId, 'winner-run', '旧结果不冒充赢家的外部句柄')
      assert.equal(fallbackCalls, mode.startsWith('fallback') ? 1 : 0, '陈旧主调用不额外发起人工执行')
    } finally { gate.release.resolve(); await old }
  })

  for (const path of ['main', 'manual']) for (const takeover of [false, true]) test(`${kind}: ${path} existing-run read is owned with successor=${takeover}`, { timeout: 10_000 }, async () => {
    const w = await setup(kind, path === 'manual'), gate = barrier(), transaction = w.storage.transaction.bind(w.storage), rootRead = w.storage.getExecutionRun.bind(w.storage)
    const targetRead = path === 'main' ? 1 : 2; let reads = 0, inTransaction = false, writer, committed = false, primary = 0, fallback = 0
    for (const [port, spare] of [[w.providers.execution, false], [w.providers.executionFallback, true]]) if (port) {
      const execute = port.startRun.bind(port); port.startRun = async (input) => { if (spare) fallback++; else primary++; return path === 'manual' && !spare ? providerFail('unavailable', 'primary refused') : execute(input) }
    }
    const pause = async (inside) => { if (++reads === targetRead) { inTransaction = inside; gate.hits++; gate.entered.resolve(); await gate.release.promise; return true } return false }
    w.storage.getExecutionRun = async (...args) => { await pause(false); return rootRead(...args) }
    w.storage.transaction = async (work) => {
      let reader = false
      const out = await transaction((tx) => work(new Proxy(tx, { get(target, key) {
        const fn = Reflect.get(target, key, target)
        return key === 'getExecutionRun' ? async (...args) => { reader = await pause(true); return fn.apply(target, args) } : typeof fn === 'function' ? fn.bind(target) : fn
      } })))
      if (reader && writer) await writer // 已经 COMMIT，才能等待后继事务；不持锁互等。
      return out
    }
    const old = start(w, 'old')
    try {
      await gate.entered.promise
      if (takeover) {
        // 与其他 Ready/run 用例相同的协议 fixture，不声称当前公开命令可这样接管。
        writer = w.storage.transaction(async (tx) => {
          const record = await tx.getExecutionContext(w.contextId)
          await tx.putExecutionContext({ ...record, provisioningGeneration: record.provisioningGeneration + 1 })
          await tx.putExecutionRun({ id: w.runId, workspaceId: w.workspace.id, contextId: w.contextId, status: 'running', updatedAt: w.time.clock(),
            providerRef: { bindingId: w.providers.execution.gate.bindingId, objectKind: 'execution_run', externalId: 'winner-run', url: undefined } })
        }).then(() => { committed = true })
        if (inTransaction) { await new Promise((resolve) => setImmediate(resolve)); assert.equal(committed, false, 'owned 读取与 owner 比较串行隔离后继写者'); gate.release.resolve() }
        await writer
      }
      const winner = snapshot(w); gate.release.resolve(); const result = await old
      assert.equal(gate.hits, 1, '目标 run 读取 barrier 恰好命中一次')
      if (takeover) { lost(result); assert.notEqual(result.runExternalId, 'winner-run'); assert.equal(snapshot(w), winner, '旧读取不改赢家或借其句柄') }
      else assert.deepEqual([result.writeState, result.confirmed], ['saved', true], '无后继的正控正常运行')
      assert.ok(primary <= 1 && fallback <= 1, '不以额外 Provider 重试修复本地读取；外部唯一性仍不在此证明')
    } finally { gate.release.resolve(); await old; await writer }
  })

  for (const takeover of [false, true]) test(`${kind}: uncertain branch without handle remains Unknown after owner loss=${takeover}`, async () => {
    const w = await setup(kind), gate = barrier(), create = w.providers.development.createBranch.bind(w.providers.development)
    w.providers.development.createBranch = async (input) => { if (++gate.hits > 1) return create(input); gate.entered.resolve(); await gate.release.promise; return providerFail('ambiguous_result', 'branch response lost') }
    w.providers.development.listBranches = async () => providerFail('unavailable', 'reconcile unavailable')
    const old = start(w, 'old')
    try {
      await gate.entered.promise
      if (takeover) {
        w.time.advance(31_000); const before = snapshot(w); assert.equal((await start(w, 'winner')).writeState, 'pending'); assert.equal(snapshot(w), before)
        await w.storage.putExecutionContext({ ...await w.storage.getExecutionContext(w.contextId), provisioningGeneration: 2 })
      }
      const winner = snapshot(w); gate.release.resolve(); const result = await old
      assert.deepEqual([result.writeState, result.confirmed, result.branchExternalId], ['unknown', false, undefined], '没有已知句柄也不能把不确定外部结果改称 conflict/reapply')
      if (takeover) { assert.equal(snapshot(w), winner); assert.deepEqual([result.error.code, result.error.recovery], ['result_unknown', 'refresh']) }
    } finally { gate.release.resolve(); await old }
  })

  for (const accepted of [false, true]) test(`${kind}: fallback local run-record failure accepted=${accepted} preserves Unknown and any ack`, async () => {
    const w = await setup(kind, true), transaction = w.storage.transaction.bind(w.storage); let hits = 0
    w.providers.execution.startRun = async () => providerFail('unavailable', 'primary unavailable')
    if (!accepted) w.providers.executionFallback.startRun = async () => providerFail('unavailable', 'fallback refused')
    w.storage.transaction = (work) => transaction((tx) => work(new Proxy(tx, { get(target, key) {
      const value = Reflect.get(target, key, target)
      return key === 'putExecutionRun' ? async () => { hits++; throw Error('run record unavailable') } : typeof value === 'function' ? value.bind(target) : value
    } })))
    const result = await start(w, 'fallback-write-fault')
    assert.deepEqual([hits, result.writeState, result.error.code, await w.storage.getExecutionRun(w.runId)], [1, 'unknown', 'result_unknown', undefined])
    assert.equal(result.runExternalId, accepted ? w.providers.executionFallback.state.runs.at(-1).ref.externalId : undefined)
    assert.ok(result.branchExternalId && result.worktreeExternalId, 'Git ack 仍在，未把本地失败冒充确定外部失败')
  })

  test(`${kind}: late Ready verification cannot replace successor generation/status/handles with Failed`, async () => {
    const w = await setup(kind); await start(w, 'ready')
    const gate = barrier(); w.providers.development.getWorktree = async () => { gate.hits++; gate.entered.resolve(); await gate.release.promise; return providerFail('not_found', 'old worktree gone') }
    const old = start(w, 'ready')
    try {
      await gate.entered.promise; const previous = await w.storage.getExecutionContext(w.contextId)
      await w.storage.putExecutionContext({ ...previous, provisioningGeneration: (previous.provisioningGeneration ?? 0) + 1, status: 'provisioning', branchExternalId: 'winner-branch', worktreeExternalId: 'winner-tree' })
      const winner = snapshot(w); gate.release.resolve(); const result = await old
      assert.equal(snapshot(w), winner); assert.deepEqual([result.status, result.branchExternalId, result.worktreeExternalId], ['provisioning', 'winner-branch', 'winner-tree'])
      assert.equal(gate.hits, 1, '只重新读取本地事实，不无限递归 Provider 验证')
    } finally { gate.release.resolve(); await old }
  })

  test(`${kind}: generations survive Ready, replay, same-clock retry and storage reopen; exhaustion refuses without writes`, async () => {
    const w = await setup(kind); await start(w, 'first')
    const read = () => w.storage.getExecutionContext(w.contextId)
    assert.equal((await read()).provisioningGeneration, 1)
    await start(w, 'first'); await start(w, 'observer'); assert.equal((await read()).provisioningGeneration, 1)
    await w.storage.putExecutionContext({ ...await read(), status: 'failed' }); await start(w, 'retry-same-clock')
    assert.equal((await read()).provisioningGeneration, 2)
    if (kind === 'Fake') { const valid = exportFakeStorageState(w.storage), invalid = structuredClone(valid); invalid.contexts.find((r) => r.id === w.contextId).provisioningGeneration = 0; assert.throws(() => createFakeStorage(invalid), /positive safe integer/); w.storage = createFakeStorage(valid) }
    else { w.storage.close(); w.storage = sql(w.storage.location) }
    w.core = await composeCore(w); assert.equal((await read()).provisioningGeneration, 2, '实际存储往返保留代际')
    await w.storage.putExecutionContext({ ...await read(), status: 'failed', provisioningGeneration: Number.MAX_SAFE_INTEGER })
    const before = snapshot(w), external = JSON.stringify(w.providers.execution.state)
    const refused = await start(w, 'exhausted')
    assert.deepEqual([refused.writeState, refused.error?.code], ['conflict', 'conflict']); assert.equal(snapshot(w), before); assert.equal(JSON.stringify(w.providers.execution.state), external)
  })
}
