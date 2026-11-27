/**
 * 崩溃残留的 pending Git 意图在重启后的同 key 恢复（issue #682）。
 *
 * 目标形状：Start Work 在 beforeExternal 事务提交之后、外部写/回执之前进程死掉，持久槽位停在
 * （根 state=pending、externalIntent.state=pending、上下文 provisioning）。今天它会永久重放成 pending；
 * 本套件钉住新契约：租约过期且没有进程内 owner 时，同 key 重放先按持久 intent 的精确输入做一次只读对账，
 * 再采纳 / 重发一次 / 报冲突 / 保持 unknown。
 *
 * 判别点固定为三个可观察事实，不是只看最终 writeState：
 * - 探针计数（listBranches / getWorktree）证明对账真的跑过；
 * - 核心外部写计数（createBranch / createWorktree）证明「采纳不重发、缺失恰好重发一次」；
 * - attempt 行 + execution_context 记录 + 外部对象计数证明零写入（读门会写 sync_cursor，不能用整库快照）。
 *
 * 夹具形状沿用 start-work-external-intent.test.js（world 组装、Fake/SQLite 双跑）与
 * local-git-fixture.js（真实临时仓库、真实 SQLite 关库重开）。
 */
import '../fixtures/resolution-preflight.mjs'

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

import { CapabilityKey, providerErr, providerError, providerOk } from '@harness-projects/capabilities'
import { branchNameFor, composeCore, contextIdFor, startWork } from '@harness-projects/core'
import { AccessLevel, ProviderErrorCode } from '@harness-projects/domain'
import { createFakeProviders, createFakeStorage, exportFakeStorageState } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

import {
  LEASE_EXPIRED_MS, REPOSITORY_ID, controllableClock, coreContextFor, fixtureFor,
  git, providerFor, registerWorkItem, worktreePaths,
} from './local-git-fixture.js'

const root = mkdtempSync(path.join(tmpdir(), 'pending-recovery-')), handles = []
let seq = 0
after(() => { for (const storage of handles) { try { storage.close() } catch {} } rmSync(root, { recursive: true, force: true }) })
const sqlite = (file = path.join(root, (seq++) + '.sqlite')) => { const storage = createSqliteStorage(file); handles.push(storage); return storage }
/** world 形组装（#632）：storage 只经 provider 表进入 core；w.storage 会在 reopen 后替换，组装时必须读实时值。 */
const depsOf = (w, over = {}) => {
  const { storage, ...rest } = w
  const { storage: overrideStorage, providers = w.providers, ...extra } = over
  return { ...rest, ...extra, providers: { ...providers, storage: overrideStorage ?? storage } }
}
async function setup(kind) {
  const providers = createFakeProviders(), storage = kind === 'Fake' ? providers.storage : sqlite(), time = controllableClock()
  const workspace = { id: 'pending-' + (seq++), name: 'pending recovery' }
  const options = { providers, storage, workspace, clock: time.clock }, core = await composeCore(depsOf(options))
  const workItemId = (await core.queries.listPlanningItems()).find((view) => view.content.contentKind === 'work_item').entityId
  const request = { task: 'Synthetic explicit task', workItemId, repositoryId: 'repo-alpha', actor: { kind: 'agent' }, idempotencyKey: 'first' }
  // 离线 Execution 替身自带两条种子 run：计数只算本次新增，外部对象数量才可断言成「各一份」。
  return { ...options, core, request, time, seedRuns: providers.execution.state.runs.length, contextId: contextIdFor(workspace.id, workItemId, 'repo-alpha') }
}
/** 重启 = 换一套 Core 组合，外部对象留在 provider 内存/磁盘上；SQLite 关库重开，Fake 导出同一份状态重导入。 */
async function restart(w) {
  if (w.storage.location === undefined) w.storage = createFakeStorage(exportFakeStorageState(w.storage))
  else { w.storage.close(); w.storage = sqlite(w.storage.location) }
  w.core = await composeCore(depsOf(w))
  return w
}
const start = (w, patch = {}, core = w.core) => core.commands.startWork({ ...w.request, ...patch })
const attemptOf = (w) => w.storage.findMutationAttempt(w.workspace.id, w.request.idempotencyKey)
const recordOf = (w) => w.storage.getExecutionContext(w.contextId)
const unknown = (result) => assert.deepEqual([result.writeState, result.confirmed], ['unknown', false])
const saved = (result) => assert.deepEqual([result.writeState, result.confirmed, result.status, result.error], ['saved', true, 'ready', undefined])
const workBranches = (w) => w.providers.development.state.branches.filter((branch) => branch.name.startsWith('work/'))
const counts = (w) => [workBranches(w).length, w.providers.development.state.worktrees.length, w.providers.execution.state.runs.length - w.seedRuns]

/** 零写入判据：两条契约行逐字相等 + 外部对象计数不变（D13；读门记账不在比较范围内）。 */
async function snapshot(w) { return { attempt: await attemptOf(w), record: await recordOf(w), counts: counts(w) } }
async function frozen(w, before) {
  assert.deepEqual(await attemptOf(w), before.attempt, '零写入：attempt 行必须逐字不变')
  assert.deepEqual(await recordOf(w), before.record, '零写入：execution_context 记录必须逐字不变')
  assert.deepEqual(counts(w), before.counts, '零写入：外部对象计数不变')
}
/** 计数探针：只有真的跑过对账，计数才会增加。 */
function trackProbes(w) {
  const d = w.providers.development, counted = { list: 0, worktree: 0 }
  const list = d.listBranches.bind(d), get = d.getWorktree.bind(d)
  d.listBranches = async (input) => { counted.list += 1; return list(input) }
  d.getWorktree = async (input) => { counted.worktree += 1; return get(input) }
  return { counted, total: () => counted.list + counted.worktree }
}
function trackCreates(w) {
  const d = w.providers.development, calls = { branch: [], worktree: [] }
  const branch = d.createBranch.bind(d), worktree = d.createWorktree.bind(d)
  d.createBranch = async (input) => { calls.branch.push(input); return branch(input) }
  d.createWorktree = async (input) => { calls.worktree.push(input); return worktree(input) }
  return calls
}
/**
 * 崩溃注入：每个事务**提交之后**检查同 key 行；一旦它是某个 Git 创建步的 pending 意图就抛错（只抛一次）。
 * 抛在事务提交后而不是事务体内，是为了造出「意图已耐久、外部写未发生」的残留状态；事务体内抛错会整笔
 * 回滚，模拟不出该窗口。它经 core 的 localWrite 变成 Unknown 答复，槽位留在 pending。
 */
function crashAfterIntentCommit(storage, lookup, operation) {
  const transaction = storage.transaction.bind(storage)
  let hit = false
  storage.transaction = async (work) => {
    const result = await transaction(work)
    if (!hit) {
      const row = await lookup()
      if (row?.externalIntent?.operation === operation && row.externalIntent.state === 'pending') {
        hit = true
        throw new Error('测试注入：' + operation + ' 意图提交后进程退出')
      }
    }
    return result
  }
  return { hit: () => hit, restore: () => { storage.transaction = transaction } }
}
/** 驱动一次 createBranch 的崩溃残留：答复 unknown、落库 pending、分支未落盘。 */
async function branchCrash(w) {
  const crash = crashAfterIntentCommit(w.storage, () => attemptOf(w), 'createBranch')
  unknown(await start(w)); assert.equal(crash.hit(), true); crash.restore()
  const row = await attemptOf(w)
  assert.deepEqual([row.state, row.externalIntent.state], ['pending', 'pending'], '前置条件：崩溃残留是根 pending + intent pending')
  return row.externalIntent
}
/** 驱动一次 createWorktree 的崩溃残留：分支步已完成回填，工作树步意图已提交、外部写未发生。 */
async function worktreeCrash(w, defaultTarget) {
  const d = w.providers.development
  d.preflightWorktree = async (input) => providerOk({ path: input.path ?? defaultTarget })
  const crash = crashAfterIntentCommit(w.storage, () => attemptOf(w), 'createWorktree')
  unknown(await start(w)); assert.equal(crash.hit(), true); crash.restore()
  const row = await attemptOf(w)
  assert.deepEqual([row.state, row.externalIntent.state], ['pending', 'pending'], '前置条件：崩溃残留是根 pending + intent pending')
  assert.equal(row.externalIntent.operation, 'createWorktree')
  assert.equal(d.state.worktrees.length, 0, '前置条件：工作树没有落盘')
  assert.equal(workBranches(w).length, 1, '前置条件：分支步已经完成并回填')
  return row.externalIntent
}
/** 认领事务提交后崩溃：事务提交后按 putExecutionContext 计数抛错（commit 之后，不触发回滚）。 */
function crashAfterClaimCommit(storage) {
  const transaction = storage.transaction.bind(storage)
  let writes = 0
  storage.transaction = async (work) => {
    const result = await transaction((tx) => work(new Proxy(tx, { get(target, key) {
      const fn = Reflect.get(target, key)
      return key === 'putExecutionContext' ? async (...args) => { writes += 1; return fn.apply(target, args) } : typeof fn === 'function' ? fn.bind(target) : fn
    } })))
    if (writes === 1) throw new Error('测试注入：认领提交后进程退出')
    return result
  }
  return () => { storage.transaction = transaction }
}

for (const kind of ['Fake', 'SQLite']) {
  test(kind + ': pending createBranch 目标不存在：对账后恰好重发一次并收敛（C1）', async () => {
    const w = await setup(kind)
    await branchCrash(w)
    assert.equal(workBranches(w).length, 0, '前置条件：目标分支没有落盘')
    await restart(w); w.time.advance(LEASE_EXPIRED_MS)
    const probes = trackProbes(w), writes = trackCreates(w)
    saved(await start(w))
    assert.ok(probes.total() >= 1, '同 key 重放必须先做只读对账（探针至少一次）')
    assert.equal(writes.branch.length, 1, '确定不存在时恰好重发一次 createBranch')
    assert.deepEqual(counts(w), [1, 1, 1], '分支 / 工作树 / run 各一份')
    assert.equal((await attemptOf(w)).state, 'saved', '最终行必须结算为 saved')
  })

  test(kind + ': pending createBranch 目标已存在：采纳且不重发（C2）', async () => {
    const w = await setup(kind), d = w.providers.development
    const name = branchNameFor(w.request.workItemId)
    const landed = await d.createBranch({ repository: d.state.repositories[0].ref, name, fromRef: 'main' })
    assert.equal(landed.ok, true, '前置条件：目标分支已经真的存在')
    await branchCrash(w)
    await restart(w); w.time.advance(LEASE_EXPIRED_MS)
    const probes = trackProbes(w), writes = trackCreates(w)
    const resumed = await start(w)
    saved(resumed)
    assert.ok(probes.total() >= 1, '同 key 重放必须先做只读对账')
    assert.equal(writes.branch.length, 0, '分支已被证明落地，不得重发 createBranch')
    assert.equal(resumed.branchExternalId, name, '采纳的身份来自持久 intent，不是本次请求重新推导的')
    assert.equal(resumed.branchHeadCommit, landed.value.headCommit, '采纳必须报出被采纳分支的头提交')
    assert.deepEqual(counts(w), [1, 1, 1])
  })

  test(kind + ': pending createWorktree 目标不存在且默认目标漂移：按持久输入重发一次（C3）', async () => {
    const w = await setup(kind)
    const intent = await worktreeCrash(w, '.worktrees/original-target')
    assert.equal(intent.input.path, '.worktrees/original-target', '前置条件：持久意图记下了对账使用的精确输入')
    await restart(w); w.time.advance(LEASE_EXPIRED_MS)
    const d = w.providers.development
    d.preflightWorktree = async (input) => providerOk({ path: input.path ?? '.worktrees/new-default' })
    const probes = trackProbes(w), writes = trackCreates(w)
    saved(await start(w))
    assert.ok(probes.total() >= 1, '同 key 重放必须先做只读对账')
    assert.equal(writes.worktree.length, 1, '确定不存在时恰好重发一次 createWorktree')
    assert.equal(writes.worktree[0].path, intent.input.path, '重发必须复用持久意图里的精确路径，不得改用漂移后的默认目标')
    assert.deepEqual(d.state.worktrees.map((tree) => tree.path), ['.worktrees/original-target'], '工作树只允许一份且落在原始路径')
    assert.deepEqual(counts(w), [1, 1, 1])
  })

  test(kind + ': pending createWorktree 目标已落地：采纳且不重发（C4）', async () => {
    const w = await setup(kind), d = w.providers.development
    const intent = await worktreeCrash(w, '.worktrees/original-target')
    const landed = await d.createWorktree(structuredClone(intent.input))
    assert.equal(landed.ok, true, '前置条件：工作树按持久意图已经真的落盘')
    await restart(w); w.time.advance(LEASE_EXPIRED_MS)
    const probes = trackProbes(w), writes = trackCreates(w)
    const resumed = await start(w)
    saved(resumed)
    assert.ok(probes.total() >= 1, '工作树对账必须用持久句柄读回')
    assert.equal(writes.worktree.length, 0, '工作树已被证明落地，不得重发 createWorktree')
    assert.equal(resumed.worktreeExternalId, intent.input.path, '采纳必须报出已落盘的那份工作树')
    assert.deepEqual(counts(w), [1, 1, 1])
  })

  test(kind + ': pending createWorktree 命中但分支不符：结构化冲突零写入（C5）', async () => {
    const w = await setup(kind), d = w.providers.development
    const intent = await worktreeCrash(w, '.worktrees/original-target')
    const landed = await d.createWorktree(structuredClone(intent.input))
    assert.equal(landed.ok, true, '前置条件：工作树已经落盘')
    d.state.worktrees[0].branch = 'work/other'
    await restart(w); w.time.advance(LEASE_EXPIRED_MS)
    const probes = trackProbes(w), writes = trackCreates(w), before = await snapshot(w)
    const resumed = await start(w)
    assert.equal(resumed.writeState, 'conflict', '工作树分支不一致必须是结构化冲突，不是 adopted')
    assert.ok(resumed.error.message.includes(intent.input.branch), '冲突消息必须点名持久意图里的分支')
    assert.match(resumed.error.message, /work\/other/, '冲突消息必须点名读到的分支')
    assert.ok(probes.total() >= 1, '冲突结论必须来自真实读回')
    assert.equal(writes.worktree.length, 0, '冲突路径不得重发外部写')
    await frozen(w, before)
  })

  test(kind + ': pending 意图 + 读不可用：保持 unknown 且零外部写（C6）', async () => {
    const w = await setup(kind), d = w.providers.development
    await branchCrash(w)
    await restart(w); w.time.advance(LEASE_EXPIRED_MS)
    let probes = 0
    d.listBranches = async () => { probes += 1; return providerErr(providerError(ProviderErrorCode.Unavailable, '读不可用')) }
    const writes = trackCreates(w), before = await snapshot(w)
    const resumed = await start(w)
    unknown(resumed)
    assert.match(resumed.error.message, /对账只读，未重发外部写入/, '错误必须说清对账只读、未重发')
    assert.ok(probes >= 1, '不可读也必须真的读过一次')
    assert.equal(writes.branch.length + writes.worktree.length, 0, '不可读时不得发起任何外部写')
    assert.deepEqual(counts(w), [0, 0, 0], '不可读时不得起第二个 run / 外部对象')
    await frozen(w, before)
  })

  test(kind + ': pending 意图 + 写门 read_only：零写入保留 unknown，恢复后同 key 收敛（C7）', async () => {
    const w = await setup(kind)
    await branchCrash(w)
    await restart(w); w.time.advance(LEASE_EXPIRED_MS)
    const writes = trackCreates(w), before = await snapshot(w)
    const readonly = await composeCore(depsOf(w, { policy: {
      [CapabilityKey.DevelopmentBranchCreate]: AccessLevel.ReadOnly,
      [CapabilityKey.DevelopmentWorktreeCreate]: AccessLevel.ReadOnly,
    } }))
    const denied = await start(w, {}, readonly)
    assert.deepEqual([denied.writeState, denied.error?.code], ['unknown', 'permission_denied'], '写门拒绝必须保留可恢复 unknown')
    assert.equal(writes.branch.length + writes.worktree.length, 0, '拒绝路径不得发起外部写')
    await frozen(w, before)
    saved(await start(w))
    assert.equal(writes.branch.length, 1, '恢复写权限后同 key 恰好重发一次')
    assert.deepEqual(counts(w), [1, 1, 1], '恢复后至多一份分支 / 工作树 / run')
  })

  test(kind + ': 租约内同 key 不探测（负控，C8）', async () => {
    const w = await setup(kind)
    await branchCrash(w)
    const probes = trackProbes(w), writes = trackCreates(w), before = await snapshot(w)
    assert.equal((await start(w)).writeState, 'pending', '租约未过期时同 key 重放仍报在途')
    assert.equal(probes.total(), 0, '租约是既有接管边界：未过期不得探测')
    assert.equal(writes.branch.length + writes.worktree.length, 0)
    await frozen(w, before)
  })

  test(kind + ': 进程内 owner 越过租约仍否决接管（负控，C9 / M3）', async () => {
    const w = await setup(kind), d = w.providers.development
    const entered = Promise.withResolvers(), release = Promise.withResolvers()
    const create = d.createWorktree.bind(d); let calls = 0
    d.createWorktree = async (input) => { calls += 1; if (calls === 1) { entered.resolve(); await release.promise } return create(input) }
    const probes = trackProbes(w), running = start(w)
    await entered.promise
    try {
      const row = await attemptOf(w)
      assert.deepEqual([row.state, row.externalIntent.operation, row.externalIntent.state], ['pending', 'createWorktree', 'pending'], '前置条件：在途的外部写意图已持久')
      const before = await snapshot(w)
      w.time.advance(LEASE_EXPIRED_MS)
      assert.equal((await start(w)).writeState, 'pending', '进程内仍有 owner 时，越过租约也不得取代')
      assert.equal(probes.total(), 0, '在途的 owner 是「外部调用还可能落盘」的唯一进程内证据：不得探测')
      await frozen(w, before)
    } finally { release.resolve(); await running }
  })

  test(kind + ': 采样后记录被别的写者改：不得采纳（C10 / M2）', async () => {
    const w = await setup(kind), d = w.providers.development
    const name = branchNameFor(w.request.workItemId)
    assert.equal((await d.createBranch({ repository: d.state.repositories[0].ref, name, fromRef: 'main' })).ok, true, '前置条件：目标分支已经真的存在')
    await branchCrash(w)
    await restart(w); w.time.advance(LEASE_EXPIRED_MS)
    const record = await recordOf(w), attempt = await attemptOf(w)
    const injected = { ...record, status: 'ready', provisioningGeneration: record.provisioningGeneration + 5 }
    const list = d.listBranches.bind(d)
    let probes = 0, mutated = false
    d.listBranches = async (input) => {
      const listed = await list(input); probes += 1
      if (!mutated) { mutated = true; await w.storage.putExecutionContext(injected) }
      return listed
    }
    const resumed = await start(w)
    assert.equal(mutated, true, '前置条件：探针确实在对账中间改写了记录')
    assert.ok(probes >= 1, '采样后记录变化不得阻止对账本身跑过一次')
    assert.equal(resumed.writeState, 'pending', '采样记录已不是对账证据：必须按原有重放语义作答，不得采纳')
    assert.deepEqual(await attemptOf(w), attempt, '不得改写未决行')
    assert.deepEqual(await recordOf(w), injected, '记录保持注入值（别的写者推进后不得被本次重放覆盖）')
    assert.deepEqual(counts(w), [1, 0, 0], '不得发起外部写、不得起 run')
  })

  test(kind + ': 认领提交后崩溃：被采纳工作树句柄必须耐久（C11 / M8）', async () => {
    const w = await setup(kind), d = w.providers.development
    const intent = await worktreeCrash(w, '.worktrees/original-target')
    assert.equal((await d.createWorktree(structuredClone(intent.input))).ok, true, '前置条件：工作树已按持久意图落盘')
    await restart(w); w.time.advance(LEASE_EXPIRED_MS)
    const restore = crashAfterClaimCommit(w.storage)
    await assert.rejects(start(w), /认领提交后进程退出/, '认领提交后崩溃必须中断本次调用')
    restore()
    assert.equal((await recordOf(w)).worktreeExternalId, '.worktrees/original-target', '被采纳句柄必须与认领同一事务耐久，不得只留在进程内')
    await restart(w); w.time.advance(LEASE_EXPIRED_MS)
    d.preflightWorktree = async (input) => providerOk({ path: input.path ?? '.worktrees/new-default' })
    saved(await start(w))
    assert.deepEqual(d.state.worktrees.map((tree) => tree.path), ['.worktrees/original-target'], '默认目标漂移不得产生第二份工作树')
    assert.equal((await recordOf(w)).worktreeExternalId, '.worktrees/original-target')
    assert.deepEqual(counts(w), [1, 1, 1])
  })

  test(kind + ': 手工构造跨步错位记录：不合资格且不探测（C12 / M10）', async () => {
    const w = await setup(kind)
    const intent = await worktreeCrash(w, '.worktrees/original-target')
    const record = await recordOf(w)
    await w.storage.putExecutionContext({ ...record, branchExternalId: 'work/other' })
    const injected = await recordOf(w)
    await restart(w); w.time.advance(LEASE_EXPIRED_MS)
    const probes = trackProbes(w), writes = trackCreates(w), before = await snapshot(w)
    const resumed = await start(w)
    assert.equal(resumed.writeState, 'pending', '记录里的分支不是持久意图的分支：不得采纳、不得重发')
    assert.equal(probes.total(), 0, '不合资格的 pending 意图不得探测')
    assert.equal(writes.branch.length + writes.worktree.length, 0)
    assert.deepEqual(await recordOf(w), injected, '注入的记录保持原样')
    assert.deepEqual(before.attempt, await attemptOf(w), '未决行保持原样')
    assert.equal(intent.input.branch, branchNameFor(w.request.workItemId))
  })
}

/** 真实 local-git provider + 真实 SQLite 关库重开：磁盘事实是判据，不是返回值形状。 */
const hooksFor = (base, hooks) => new Proxy(base, {
  get(target, key) {
    const value = Reflect.get(target, key, target)
    if (typeof value !== 'function') return value
    const bound = value.bind(target)
    return typeof key === 'string' && hooks[key] !== undefined ? hooks[key](bound) : bound
  },
})
const realCrashOf = (storage, workspaceId, key, operation) => crashAfterIntentCommit(
  storage, () => storage.findMutationAttempt(workspaceId, key), operation,
)
/** providerFor 注入 allowedRoot=fixture.root：默认工作树根就是允许根本身。 */
const defaultTargetFor = (fixture, workItemId) => path.join(fixture.root, workItemId)

test('真实磁盘 + SQLite：pending createBranch 不存在，关库重开同 key 收敛（G1）', async (t) => {
  const fixture = await fixtureFor(t), clock = controllableClock(), workItemId = 'wi-pending-branch'
  const file = path.join(fixture.root, 'pending-branch.sqlite'), storage = createSqliteStorage(file)
  t.after(() => { try { storage.close() } catch {} })
  let branchCalls = 0
  const provider = hooksFor(providerFor(fixture), { createBranch: (fn) => async (input) => { branchCalls += 1; return fn(input) } })
  const { context, workspaceId } = await coreContextFor(fixture, { development: provider }, { storage, clock: clock.clock })
  await registerWorkItem(storage, workspaceId, workItemId)
  const request = { task: 'Synthetic explicit task', workItemId, repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'pending-branch' }
  const crash = realCrashOf(storage, workspaceId, request.idempotencyKey, 'createBranch')
  assert.equal((await startWork(context, request)).writeState, 'unknown', '前置条件：意图已提交、外部写未发生')
  assert.equal(crash.hit(), true); crash.restore()
  const row = await storage.findMutationAttempt(workspaceId, request.idempotencyKey)
  assert.deepEqual([row.state, row.externalIntent.state], ['pending', 'pending'])
  storage.close(); const reopened = createSqliteStorage(file)
  t.after(() => { try { reopened.close() } catch {} })
  const restarted = (await coreContextFor(fixture, { development: provider }, { storage: reopened, workspaceId, clock: clock.clock })).context
  clock.advance(LEASE_EXPIRED_MS)
  const resumed = await startWork(restarted, request)
  assert.deepEqual([resumed.writeState, resumed.status], ['saved', 'ready'])
  assert.equal(branchCalls, 1, '确定不存在时恰好重发一次真实 createBranch')
  const branches = (await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], fixture.repositoryPath)).trim().split('\n').filter((name) => name.startsWith('work/'))
  assert.deepEqual(branches, [branchNameFor(workItemId)], 'refs/heads/work/* 恰好 1 条')
  assert.deepEqual(await worktreePaths(fixture), [fixture.repositoryPath, defaultTargetFor(fixture, workItemId)], '磁盘上只有主检出 + 1 份工作树')
})

test('真实磁盘 + SQLite：pending createWorktree 不存在，关库重开恰好重发一次（G2）', async (t) => {
  const fixture = await fixtureFor(t), clock = controllableClock(), workItemId = 'wi-pending-worktree'
  const file = path.join(fixture.root, 'pending-worktree.sqlite'), storage = createSqliteStorage(file)
  t.after(() => { try { storage.close() } catch {} })
  let worktreeCalls = 0
  const provider = hooksFor(providerFor(fixture), { createWorktree: (fn) => async (input) => { worktreeCalls += 1; return fn(input) } })
  const { context, workspaceId } = await coreContextFor(fixture, { development: provider }, { storage, clock: clock.clock })
  await registerWorkItem(storage, workspaceId, workItemId)
  const request = { task: 'Synthetic explicit task', workItemId, repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'pending-worktree' }
  const crash = realCrashOf(storage, workspaceId, request.idempotencyKey, 'createWorktree')
  assert.equal((await startWork(context, request)).writeState, 'unknown')
  assert.equal(crash.hit(), true); crash.restore()
  const intent = (await storage.findMutationAttempt(workspaceId, request.idempotencyKey)).externalIntent
  assert.equal(intent.operation, 'createWorktree')
  assert.equal(worktreeCalls, 0, '前置条件：崩溃点在真实 createWorktree 之前')
  storage.close(); const reopened = createSqliteStorage(file)
  t.after(() => { try { reopened.close() } catch {} })
  const restarted = (await coreContextFor(fixture, { development: provider }, { storage: reopened, workspaceId, clock: clock.clock })).context
  clock.advance(LEASE_EXPIRED_MS)
  const resumed = await startWork(restarted, request)
  assert.deepEqual([resumed.writeState, resumed.status], ['saved', 'ready'])
  assert.equal(worktreeCalls, 1, '确定不存在时恰好重发一次真实 createWorktree')
  assert.deepEqual(await worktreePaths(fixture), [fixture.repositoryPath, intent.input.path], '磁盘上只有主检出 + 1 份工作树')
})

test('真实磁盘 + SQLite：pending createWorktree 已落地，关库重开采纳且不新增登记（G3）', async (t) => {
  const fixture = await fixtureFor(t), clock = controllableClock(), workItemId = 'wi-landed-worktree'
  const file = path.join(fixture.root, 'landed-worktree.sqlite'), storage = createSqliteStorage(file)
  t.after(() => { try { storage.close() } catch {} })
  let coreCreates = 0, armed = false
  const provider = hooksFor(providerFor(fixture), { createWorktree: (fn) => async (input) => { if (armed) coreCreates += 1; return fn(input) } })
  const { context, workspaceId } = await coreContextFor(fixture, { development: provider }, { storage, clock: clock.clock })
  await registerWorkItem(storage, workspaceId, workItemId)
  const request = { task: 'Synthetic explicit task', workItemId, repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'landed-worktree' }
  const crash = realCrashOf(storage, workspaceId, request.idempotencyKey, 'createWorktree')
  assert.equal((await startWork(context, request)).writeState, 'unknown')
  assert.equal(crash.hit(), true); crash.restore()
  const intent = (await storage.findMutationAttempt(workspaceId, request.idempotencyKey)).externalIntent
  const landed = await provider.createWorktree(structuredClone(intent.input))
  assert.equal(landed.ok, true, '前置条件：工作树按持久意图已经真的落盘')
  const before = await worktreePaths(fixture)
  storage.close(); const reopened = createSqliteStorage(file)
  t.after(() => { try { reopened.close() } catch {} })
  const restarted = (await coreContextFor(fixture, { development: provider }, { storage: reopened, workspaceId, clock: clock.clock })).context
  clock.advance(LEASE_EXPIRED_MS); armed = true
  const resumed = await startWork(restarted, request)
  assert.deepEqual([resumed.writeState, resumed.status], ['saved', 'ready'])
  assert.equal(coreCreates, 0, '工作树已被证明落地，不得重发真实 createWorktree')
  assert.deepEqual(await worktreePaths(fixture), before, '磁盘登记不得新增')
  assert.equal(before.length, 2, '主检出 + 1 份工作树')
  assert.equal((await reopened.findMutationAttempt(workspaceId, request.idempotencyKey)).state, 'saved')
})
