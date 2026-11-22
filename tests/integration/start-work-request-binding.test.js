import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { composeCore, contextIdFor } from '@harness-projects/core'
import { CapabilityKey, providerErr, providerError, providerOk } from '@harness-projects/capabilities'
import { AccessLevel, ProviderErrorCode } from '@harness-projects/domain'
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
  const request = { task: 'Synthetic explicit task', workItemId: items[0], repositoryId: 'repo-alpha', actor: { kind: 'agent', id: 'one' }, idempotencyKey: 'first' }
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
    assert.equal(typeof row.requestFingerprint, 'string'); assert.deepEqual(JSON.parse(row.requestFingerprint), ['startWork:v2', w.workspace.id, w.providers.development.gate.bindingId, ['agent', 'one'], w.request.workItemId, 'repo-alpha', null, null, w.request.task])
    let calls = 0; const d = w.providers.development
    for (const key of ['getWorktree', 'getRepository', 'createBranch', 'createWorktree']) { const call = d[key].bind(d); d[key] = (...args) => { calls++; return call(...args) } }
    const before = local(w.storage); const external = counts(w)
    for (const patch of [{ task: 'different task' }, { workItemId: w.items[1] }, { repositoryId: 'missing' }, { actor: { kind: 'human', id: 'one' } }, { actor: { kind: 'agent', id: 'two' } }, { actor: { kind: 'agent' } }, { branchName: `work/${w.request.workItemId}` }, { worktreePath: '' }, { worktreePath: ' ' }, { worktreePath: 'a|b"\\中' }]) conflict(await start(w, patch))
    assert.equal(calls, 0); assert.equal(local(w.storage), before); assert.deepEqual(counts(w), external)
    assert.equal((await start(w, { actor: { id: 'one', kind: 'agent', toJSON() { throw Error('must not serialize caller') } }, branchName: undefined, worktreePath: undefined })).writeState, 'saved')
  })
  test(`${kind}: Pending exact replay observes without lease takeover and new observation keys bind`, async () => {
    const w = await setup(kind); const d = w.providers.development; const create = d.createWorktree.bind(d)
    const entered = gate(), release = gate(); d.createWorktree = async (...args) => { entered.release(); await release.wait; return create(...args) }
    const running = start(w); await entered.wait
    try {
      const pending = await w.storage.findMutationAttempt(w.workspace.id, 'first'); assert.equal(pending.state, 'pending')
      const before = local(w.storage), external = counts(w)
      conflict(await start(w, { workItemId: w.items[1] })); assert.equal(local(w.storage), before)
      for (const advance of [0, 60_000]) { w.time.advance(advance); assert.equal((await start(w)).writeState, 'pending'); assert.equal(local(w.storage), before) }
      assert.deepEqual(counts(w), external)
      assert.equal((await start(w, { idempotencyKey: 'observer' })).writeState, 'pending')
      assert.equal(await w.storage.findMutationAttempt(w.workspace.id, 'observer'), undefined, '未决外部步骤不消费观察新键')
    } finally { release.release(); await running }
    assert.equal((await start(w)).writeState, 'saved')
    conflict(await start(w, { idempotencyKey: 'ready-observer' }), 'existing_execution_task_not_sent')
    assert.equal(await w.storage.findMutationAttempt(w.workspace.id, 'ready-observer'), undefined)
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
    assert.deepEqual(JSON.parse((await get(w.workspace.id, 'first')).requestFingerprint).slice(3), [['agent', 'one'], w.request.workItemId, 'repo-alpha', 'work/frozen', '.worktrees/frozen', w.request.task])
  })
  test(`${kind}: atomic admission rollback leaves key, context and parents untouched`, async () => {
    const w = await setup(kind); let before; const transaction = w.storage.transaction.bind(w.storage); let hit = 0
    w.storage.transaction = (work) => transaction((tx) => work(new Proxy(tx, { get(target, key) { const fn = Reflect.get(target, key); return key === 'putExecutionContext' ? async (...args) => { before ??= local(w.storage); await fn.apply(target, args); hit++; throw Error('admission rollback') } : typeof fn === 'function' ? fn.bind(target) : fn } })))
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
  if (stage === 'settled') await start(w); else assert.equal((await start(w)).writeState, 'unknown')
  const row = await w.storage.findMutationAttempt(w.workspace.id, 'first'); w.storage.close(); w.storage = sqlite(w.storage.location); w.core = await composeCore(w)
  assert.deepEqual(await w.storage.findMutationAttempt(w.workspace.id, 'first'), row)
  const before = local(w.storage); conflict(await start(w, { task: 'changed after restart' })); conflict(await start(w, { workItemId: w.items[1] })); assert.equal(local(w.storage), before)
  w.time.advance(60_000); const external = counts(w); assert.equal((await start(w)).writeState, stage === 'settled' ? 'saved' : 'unknown'); assert.deepEqual(counts(w), external)
  d[method] = create; if (stage !== 'settled') { assert.equal((await start(w, { idempotencyKey: 'recover' })).writeState, 'unknown'); assert.equal(await w.storage.findMutationAttempt(w.workspace.id, 'recover'), undefined) }
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
  release[1].release(); try { conflict(await loser)
    const previous = JSON.parse(before), current = JSON.parse(local(w.storage))
    const cursor = data => data.find(([table]) => table === 'sync_cursor')[1].find(row => row.workspace_id === w.workspace.id && row.binding_id === w.providers.development.gate.bindingId && row.scope_key === JSON.stringify(['delivery.read', 'development.repository.read', 'repo-alpha']))
    const previousCursor = cursor(previous), currentCursor = cursor(current), health = JSON.parse(previousCursor.cursor_value)
    assert.deepEqual({ ...health, version: 0 }, { version: 0, denialVersion: 0, confirmedVersion: 0, denied: false, scopes: [], pending: 1 })
    assert.deepEqual(currentCursor, { ...previousCursor, state: 'healthy', cursor_value: JSON.stringify({ ...health, pending: 0 }) })
    Object.assign(previousCursor, currentCursor); assert.equal(JSON.stringify(current), JSON.stringify(previous)); assert.equal(branches, 1)
    assert.equal(await second.getExecutionContext(contextIdFor(w.workspace.id, w.items[1], 'repo-alpha')), undefined)
  } finally { branchRelease.release(); await first }
  assert.equal((await first).writeState, 'saved'); assert.deepEqual(counts(w), [1, 1, 1])
})
test('SQLite: close/reopen 之后同 key 重放先对账再收敛，不重发已落盘的分支（#191）', async () => {
  const w = await setup('SQLite'); const d = w.providers.development
  const create = d.createBranch.bind(d); let calls = 0
  // 分支真的落盘了，但进程在 ack 返回之前退出：持久槽位因此停在 unknown。
  d.createBranch = async (input) => { calls += 1; const result = await create(input); if (calls === 1) throw Error('分支写入落盘后进程退出'); return result }
  const name = `work/${w.request.workItemId}`
  assert.equal((await start(w)).writeState, 'unknown')
  assert.equal(calls, 1)
  assert.equal(d.state.branches.filter((branch) => branch.name === name).length, 1, '前置条件：分支已经真的落盘')
  const row = await w.storage.findMutationAttempt(w.workspace.id, 'first')
  w.storage.close(); w.storage = sqlite(w.storage.location); w.core = await composeCore(w)
  assert.deepEqual(await w.storage.findMutationAttempt(w.workspace.id, 'first'), row, '关库重开保留未决意图')
  let probes = 0; const list = d.listBranches.bind(d)
  d.listBranches = async (input) => { probes += 1; return list(input) }
  w.time.advance(60_000)
  const resumed = await start(w)
  assert.deepEqual([resumed.writeState, resumed.status, resumed.confirmed], ['saved', 'ready', true], '恢复可读后同 key 重放必须续上')
  assert.ok(probes >= 1, '重启后同 key 重放必须先跑只读对账')
  assert.equal(calls, 1, '分支已被证明落地，不得重发 createBranch')
  assert.equal(d.state.branches.filter((branch) => branch.name === name).length, 1)
  assert.equal(d.state.worktrees.length, 1)
  assert.equal((await w.storage.findMutationAttempt(w.workspace.id, 'first')).state, 'saved')
})

/** 把 storage.transaction 包一层：事务提交后按 putExecutionContext 累计次数抛错，模拟「已提交但进程死掉」；事务体内抛错会回滚，模拟不出该窗口。 */
function crashAfterCommit(storage, commits) {
  const transaction = storage.transaction.bind(storage); let writes = 0
  storage.transaction = async (work) => {
    const result = await transaction((tx) => work(new Proxy(tx, { get(target, key) {
      const fn = Reflect.get(target, key)
      return key === 'putExecutionContext' ? async (...args) => { writes += 1; return fn.apply(target, args) } : typeof fn === 'function' ? fn.bind(target) : fn
    } })))
    if (writes === commits) throw new Error('测试注入：进程在提交后退出')
    return result
  }
  return () => { storage.transaction = transaction }
}
for (const window of [{ name: '认领', commits: 1 }, { name: '分支回填', commits: 2 }]) {
  test(`SQLite: ${window.name}提交后崩溃且默认目标变化，同 key 重放仍按持久身份恢复（#191 F1a/F1b）`, async () => {
    const w = await setup('SQLite'); const d = w.providers.development, originalPath = '.worktrees/original-target'
    let defaultTarget = originalPath, createCalls = 0, lost = true
    d.preflightWorktree = async (input) => providerOk({ path: input.path ?? defaultTarget })
    const create = d.createWorktree.bind(d)
    d.createWorktree = async (input) => { createCalls += 1; const result = await create(input); if (lost) { lost = false; throw new Error('测试注入：工作树落盘后 ack 丢失') } return result }
    assert.equal((await start(w)).writeState, 'unknown', '前置条件：工作树已落盘，答复停在 unknown'); assert.equal(createCalls, 1)
    assert.equal(d.state.worktrees.length, 1, '前置条件：工作树已经真的落盘')
    const restore = crashAfterCommit(w.storage, window.commits)
    await start(w).then((crashed) => assert.equal(crashed.writeState, 'unknown', '提交后崩溃：本次答复停在 unknown'), (error) => assert.match(error.message, /进程在提交后退出/, '提交后崩溃：拒绝必须来自注入的崩溃')).finally(restore)
    const contextId = contextIdFor(w.workspace.id, w.request.workItemId, 'repo-alpha')
    assert.equal((await w.storage.getExecutionContext(contextId)).worktreeExternalId, originalPath, '被采纳的工作树身份必须与认领 / 分支回填写入一起耐久，不得留在进程内')
    w.storage.close(); w.storage = sqlite(w.storage.location); w.core = await composeCore(w)
    defaultTarget = '.worktrees/new-default'; w.time.advance(60_000)
    const resumed = await start(w)
    assert.deepEqual([resumed.writeState, resumed.status], ['saved', 'ready'], '关库重开 + 默认目标变化后必须按持久身份收敛')
    assert.equal(createCalls, 2, '第二次 createWorktree 由同路径 conflict 复用，不是重建')
    assert.equal(d.state.worktrees.length, 1, '只允许一份工作树')
    assert.equal(d.state.worktrees[0].path, originalPath, '工作树必须落在被采纳的原始路径上')
    assert.equal((await w.storage.findMutationAttempt(w.workspace.id, 'first')).state, 'saved')
  })
}
for (const method of ['createBranch', 'createWorktree']) {
  test(`SQLite: ${method} 读已证 absent 但写门 read_only：零写入保留 unknown，恢复后同 key 收敛（#191 F2）`, async () => {
    const w = await setup('SQLite'); const d = w.providers.development
    const create = d[method].bind(d); let calls = 0
    d[method] = async (input) => { calls += 1; if (calls === 1) throw new Error('测试注入：首次外部写之前进程退出'); return create(input) }
    assert.equal((await start(w)).writeState, 'unknown', '前置条件：首次外部写的结果未知')
    assert.equal(calls, 1)
    const external = counts(w), attemptBefore = await w.storage.findMutationAttempt(w.workspace.id, 'first')
    assert.deepEqual([attemptBefore.state, attemptBefore.externalIntent.state], ['unknown', 'unknown'], '前置条件：落库的是可对账的未决行')
    const readonly = await composeCore({ ...w, policy: { [CapabilityKey.DevelopmentWorktreeCreate]: AccessLevel.ReadOnly } })
    const contextId = contextIdFor(w.workspace.id, w.request.workItemId, 'repo-alpha')
    const contextBefore = await w.storage.getExecutionContext(contextId), slotBefore = await w.storage.findMutationAttempt(w.workspace.id, 'first')
    const denied = await start(w, {}, readonly)
    assert.deepEqual([denied.writeState, denied.error?.code], ['unknown', 'permission_denied'], '写门拒绝必须保留可恢复 unknown，而不是把未决行终结成 failed')
    assert.deepEqual(await w.storage.getExecutionContext(contextId), contextBefore, '拒绝路径零写入：上下文记录逐字不变')
    assert.deepEqual(await w.storage.findMutationAttempt(w.workspace.id, 'first'), slotBefore, '拒绝路径零写入：未决行逐字不变')
    assert.deepEqual(counts(w), external, '拒绝路径不得发起任何外部写')
    const blocked = await start(w, { idempotencyKey: 'fresh-before-recovery' }, readonly)
    assert.equal(blocked.writeState, 'unknown', '恢复前新 key 仍被未决行保守阻挡')
    assert.equal(await w.storage.findMutationAttempt(w.workspace.id, 'fresh-before-recovery'), undefined)
    assert.deepEqual(counts(w), external, '被保守阻挡的新 key 不得发起外部写')
    w.storage.close(); w.storage = sqlite(w.storage.location); w.core = await composeCore(w); w.time.advance(60_000)
    const resumed = await start(w)
    assert.deepEqual([resumed.writeState, resumed.status], ['saved', 'ready'], '写权限恢复 + 关库重开后同 key 必须收敛')
    assert.deepEqual(counts(w), [1, 1, 1], '恢复后至多一份分支 / 工作树 / run')
    const newcomer = await start(w, { idempotencyKey: 'fresh-after-recovery' })
    assert.deepEqual([newcomer.writeState, newcomer.error?.code], ['conflict', 'conflict'], '已 ready 后用新 key 仍必须被阻挡')
    assert.equal(await w.storage.findMutationAttempt(w.workspace.id, 'fresh-after-recovery'), undefined)
  })
}
/** F1 残余：adopted claim 已持久化 A 后，普通读取/预检临时失败不得清掉 A；recover() 恢复能力并把默认目标改成 B。 */
async function residualAfterTransientRead(method) {
  const w = await setup('SQLite'); const d = w.providers.development, A = '.worktrees/adopted-a', B = '.worktrees/new-default'
  d.preflightWorktree = async (input) => providerOk({ path: input.path ?? A })
  const create = d.createWorktree.bind(d); let creates = 0
  d.createWorktree = async (input) => { creates += 1; const out = await create(input); if (creates === 1) throw new Error('测试注入：A 落盘后 ack 丢失'); return out }
  assert.equal((await start(w)).writeState, 'unknown', '前置条件：A 落盘但答复 unknown'); w.time.advance(60_000)
  const list = d.listBranches.bind(d)
  if (method === 'preflight') d.preflightWorktree = async () => providerErr(providerError(ProviderErrorCode.Unavailable, '临时预检故障'))
  else d.listBranches = async () => providerErr(providerError(ProviderErrorCode.PermissionDenied, '临时列表故障'))
  const replay = await start(w), contextId = contextIdFor(w.workspace.id, w.request.workItemId, 'repo-alpha')
  return { w, d, A, replay, record: await w.storage.getExecutionContext(contextId), recover: () => { d.listBranches = list; d.preflightWorktree = async (input) => providerOk({ path: input.path ?? B }) } }
}
for (const method of ['preflight', 'listBranches']) {
  test(`SQLite: adopted 后 ${method} 临时失败不得清掉已耐久 A，恢复后只留 A（#191 F1 残余）`, async () => {
    const { w, d, A, replay, record, recover } = await residualAfterTransientRead(method)
    assert.deepEqual([replay.writeState, replay.error?.code], ['failed', method === 'preflight' ? 'unavailable' : 'permission_denied'], '失败语义诚实：保留读失败自身 code')
    assert.equal(record.worktreeExternalId, A, '普通读取/预检失败也不得清掉已对账 durability 的句柄')
    assert.equal((await w.storage.findMutationAttempt(w.workspace.id, 'first')).state, 'failed', '已结算失败行如实落 failed')
    assert.equal((await start(w)).writeState, 'failed', '同 key 已结算失败逐字回放，不重新尝试（I3）'); recover(); w.storage.close(); w.storage = sqlite(w.storage.location); w.core = await composeCore(w); w.time.advance(60_000)
    const resumed = await start(w, { idempotencyKey: 'after-transient' })
    assert.deepEqual([resumed.writeState, resumed.status], ['saved', 'ready'], '新 key 必须用持久句柄 A 收敛')
    assert.deepEqual(d.state.worktrees.map((tree) => tree.path), [A], '只允许已采纳的 A，不得因默认目标漂移产生 B')
  })
}
test('SQLite: 失败结算保留的句柄不得被读侧当作已观察锚点（#191 F1 残余观察面）', async () => {
  const { w, replay, record } = await residualAfterTransientRead('preflight')
  assert.deepEqual([replay.writeState, record.status, record.worktreeExternalId], ['failed', 'failed', '.worktrees/adopted-a'], '前置：失败根 + 耐久句柄 A')
  const scope = { workItemId: w.request.workItemId, repositoryId: 'repo-alpha' }
  assert.equal((await w.storage.listRelations(w.workspace.id)).some((edge) => edge.type === 'has_worktree'), false, '前置：失败结算未写 has_worktree 边')
  const refreshed = await w.core.commands.refreshDeliveryFacts(scope)
  assert.deepEqual([refreshed.anchored, refreshed.applied], [false, false], '失败句柄不是已观察锚点：不得提交交付事实')
  assert.deepEqual((await w.core.queries.getDeliveryProjection(scope)).hops.filter((hop) => hop.entityKind === 'commit' || hop.entityKind === 'pipeline_run'), [], '失败上下文不得出现 commit / pipeline 投影跳')
})
test('SQLite: refresh 写事务 BEGIN 前真实失败先提交：事务内复核拒绝 fresh 事实（#191 观察面竞态）', async () => {
  const w = await setup('SQLite'); const d = w.providers.development, scope = { workItemId: w.request.workItemId, repositoryId: 'repo-alpha' }
  d.preflightWorktree = async (input) => providerOk({ path: input.path ?? '.worktrees/race-a' })
  const create = d.createWorktree.bind(d); let creates = 0
  d.createWorktree = async (input) => { creates += 1; const out = await create(input); if (creates === 1) throw new Error('测试注入：A 落盘后 ack 丢失'); return out }
  assert.equal((await start(w)).writeState, 'unknown', '前置：A 落盘但 ack 丢失')
  w.time.advance(60_000)
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  d.preflightWorktree = async () => { entered.resolve(); await release.promise; return providerErr(providerError(ProviderErrorCode.Unavailable, '临时预检故障')) }
  const failed = start(w)
  await entered.promise // 上下文 Provisioning + 耐久 A（无关系边）：refresh 事务外采样因此判定有锚点
  const delivery = w.providers.delivery, list = delivery.listPipelineRuns.bind(delivery); let armed = false, triggered = false
  delivery.listPipelineRuns = async (input) => { armed = true; return list(input) }
  const transaction = w.storage.transaction.bind(w.storage)
  // 在 refresh 写事务 BEGIN 前放行真实失败事务并等它提交；只拦携带 putDeliveryFacts 的目标事务。
  w.storage.transaction = async (work) => {
    if (armed && !triggered && work.toString().includes('putDeliveryFacts')) { triggered = true; release.resolve(); await failed }
    return transaction(work)
  }
  const refreshed = await w.core.commands.refreshDeliveryFacts(scope)
  w.storage.transaction = transaction
  assert.equal(triggered, true, '前置：竞态路径被走到（失败事务先于写事务提交）'); assert.equal(refreshed.applied, false, '写事务内复核 Failed + 无关系边：不得提交新的 fresh 事实')
  assert.deepEqual((await w.core.queries.getDeliveryProjection(scope)).hops.filter((hop) => hop.entityKind === 'commit' || hop.entityKind === 'pipeline_run'), [], '不得产生 fresh commit / pipeline 投影跳')
})
