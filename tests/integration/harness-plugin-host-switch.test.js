/**
 * 创建 A/B 与确认切换（#692）的 Host 组合判别测试。
 *
 * 保护的不变量：1) 创建目标的 WorkspaceId 由 wire 幂等键确定性派生（UUID v5 形状），同 key 同名重放零写入且同 id
 * （进程内账本与跨 Host 重启都复算同一 id），同 key 异名 conflict 且既有行不变，异 key 同名允许；
 * 2) create-and-switch：Home（无 active）与有 active 时创建都在同一 transition 内激活新工作区；
 * 3) A→B→A 在同一 composition 内完成、不重启；两个并发 open 走 tail 串行、每个请求报告自己的目标且最后一次获胜；
 * 4) 切换失败保留 A：候选装配被 retire 而 A 的装配对象/generation 不变，A 仍可读、source 不因失败降级、不写全局 activationError、不停止 Host、不写库；
 * 5) 切换只是导航：不启动外部工作、不改 Planning/关系/变更尝试/挂载等业务行；本用例的空工作区档案没有 provider 挂载，因此也无 provider 写与网络；
 * 6) create-and-switch 的装配失败只作用于本次命令：A 不降级、不半写，库只多 B 行；
 * 7) 创建本地工作区不产生远端 Project/Issue：没有 provider 写调用、没有网络。
 */
import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { SqliteStorage } from '@harness-projects/storage-sqlite'
import { newWorkspaceIdForCreateIntent } from '@harness-projects/domain'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { account, dump, fakePlanningEntry, seed } from './fixtures/host-seed.js'

const A = '00000000-0000-4000-8000-0000000002a1', B = '00000000-0000-4000-8000-0000000002b2'
const actor = { kind: 'user' }, wire = (value) => JSON.parse(JSON.stringify(value))
const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const workspace = (id, name, statusPolicy = 'provider_authoritative') => ({ id, name, statusPolicy })
const turn = () => new Promise((resolve) => setImmediate(resolve))

async function directory(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'host-switch-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/** 直接写库造工作区行：创建/切换只读本地行，不调 Provider。 */
const seedRows = (dataPath, rows, catalog = new Map()) => seed(dataPath, catalog, async (storage) => { for (const row of rows) await storage.putWorkspace(row) })

/** 真实 composition + 真实 remote；同 dataPath 再 boot 一次即「跨 Host 重启」。 */
async function boot(t, { dataPath, catalog = new Map(), fetch }) {
  const host = await createHostComposition({ dataPath, catalog, resolveCredential: async () => undefined, watchIntervalMs: 5, ...(fetch === undefined ? {} : { fetch }) })
  const installed = await installHostRemote({ invocation: { peer: { id: 'fixture-peer' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  const close = async () => { host.stop(); await installed.dispose(); await host.dispose() }
  t.after(close)
  return { host, service: installed.service, close }
}

async function open(t, { rows = [], catalog = new Map(), fetch } = {}) {
  const root = await directory(t), dataPath = path.join(root, 'workspace.sqlite')
  await seedRows(dataPath, rows, catalog)
  return { dataPath, ...await boot(t, { dataPath, catalog, fetch }) }
}

test('creation derives stable UUID v5 A/B ids from intent keys and create-and-switch activates each', async (t) => {
  const h = await open(t)
  const idA = newWorkspaceIdForCreateIntent('switch-intent-a'), idB = newWorkspaceIdForCreateIntent('switch-intent-b')
  const a = await h.service.createWorkspace(actor, 'switch-intent-a', '项目 A')
  assert.deepEqual([a.writeState, a.value.workspaceId], ['local_only', idA], 'Home（无 active）创建：目标 id 由幂等键派生并立即激活')
  assert.equal((await h.host.call('baseline', {})).workspace.id, idA)
  const b = await h.service.createWorkspace(actor, 'switch-intent-b', '项目 B')
  assert.deepEqual([b.writeState, b.value.workspaceId], ['local_only', idB], '有 active 时创建第二个项目同样派生稳定 id 并切换')
  assert.match(idA, UUID_V5); assert.match(idB, UUID_V5); assert.notEqual(idA, idB, '两个稳定 UUID v5 且互不相同')
  assert.deepEqual(wire((await h.service.listWorkspaces()).workspaces.map((row) => [row.workspaceId, row.name])), [[idA, '项目 A'], [idB, '项目 B']], 'catalogue 按创建序返回两行')
  assert.equal((await h.host.call('baseline', {})).workspace.id, idB, 'create-and-switch：新项目已是当前装配')
})

test('same intent key replays to one row and the same id, including after a fresh Host composition', async (t) => {
  const h = await open(t)
  const first = await h.service.createWorkspace(actor, 'replay-intent', 'Replay'), id = first.value.workspaceId
  const before = dump(h.dataPath), generation = h.host.currentGeneration()
  const replay = await h.service.createWorkspace(actor, 'replay-intent', 'Replay')
  assert.deepEqual([replay.writeState, replay.value.workspaceId], ['local_only', id], '同 key 同名重放复用同一 id 且不 conflict')
  assert.deepEqual(dump(h.dataPath), before, '账本存活期间重放零写入')
  assert.deepEqual([h.host.currentGeneration(), (await h.host.call('baseline', {})).workspace.id], [generation, id], '重放不换 generation（已是当前装配）')
  await h.close()
  // 新 composition：进程内账本与任何 Map 都丢失，只能靠确定性派生复算同一 id。
  const restarted = await boot(t, { dataPath: h.dataPath }), after = dump(h.dataPath)
  const again = await restarted.service.createWorkspace(actor, 'replay-intent', 'Replay')
  assert.deepEqual([again.writeState, again.value.workspaceId], ['local_only', id], '跨 Host 重启同 key 仍复算同一 id')
  assert.equal((await restarted.service.listWorkspaces()).workspaces.length, 1, '跨重启重放不产生第二行')
  assert.deepEqual(dump(h.dataPath), after, '跨重启重放不改库')
})

test('same intent key with another name conflicts leaving the row byte-identical; another key may reuse the name', async (t) => {
  const h = await open(t)
  const created = await h.service.createWorkspace(actor, 'name-intent', '项目 A'), id = created.value.workspaceId
  const before = dump(h.dataPath)
  const conflict = await h.service.createWorkspace(actor, 'name-intent', '项目 B')
  assert.deepEqual([conflict.writeState, conflict.error?.code, conflict.value], ['conflict', 'conflict', undefined], '同 key 异名是结构化 conflict')
  assert.deepEqual(dump(h.dataPath), before, '冲突不得写库')
  assert.deepEqual(wire((await h.service.listWorkspaces()).workspaces.map((row) => [row.workspaceId, row.name])), [[id, '项目 A']], '既有行保持原名，不静默改名')
  assert.deepEqual([(await h.host.call('baseline', {})).workspace.id, h.host.activationError], [id, undefined], '创建失败不强制换项目、不写全局 activationError')
  const other = await h.service.createWorkspace(actor, 'other-intent', '项目 A')
  assert.notEqual(other.value.workspaceId, id)
  assert.equal((await h.service.listWorkspaces()).workspaces.length, 2, '异 key 同名允许：名称不是自然键')
})

test('A→B→A switches inside one Host without restarting and each workspace stays readable', async (t) => {
  const h = await open(t, { rows: [workspace(A, '项目 A'), workspace(B, '项目 B')] }), composition = h.host
  const switched = async (target) => {
    const result = await h.service.openWorkspace(target)
    assert.deepEqual([result.state, result.activeWorkspaceId], ['activated', target])
    const baseline = await h.host.call('baseline', {})
    return [baseline.workspace.id, (await h.service.getWorkspaceSetup()).workspace.id, (await h.service.listWorkspaces()).activeWorkspaceId]
  }
  assert.deepEqual(await switched(A), [A, A, A])
  const afterA = h.host.currentGeneration()
  assert.deepEqual(await switched(B), [B, B, B]); assert.notEqual(h.host.currentGeneration(), afterA, '切换必然换装配 generation')
  assert.deepEqual(await switched(A), [A, A, A], 'A→B→A 回到 A')
  assert.equal(h.host, composition, '同一 composition 对象：没有重启 Host')
})

test('two rapid opens serialize and the last request wins', async (t) => {
  const h = await open(t, { rows: [workspace(A, '项目 A'), workspace(B, '项目 B')] })
  await h.service.openWorkspace(A)
  const original = SqliteStorage.prototype.getWorkspacePlanningMapping
  let live = 0, peak = 0
  t.mock.method(SqliteStorage.prototype, 'getWorkspacePlanningMapping', async function (...args) {
    live++; peak = Math.max(peak, live)
    try { await turn(); return await original.apply(this, args) } finally { live-- }
  })
  // 判别序列 [B, A]：FIFO（串行）最终停在 A，LIFO（无串行则后发先至）会停在 B。
  const results = await Promise.all([h.service.openWorkspace(B), h.service.openWorkspace(A)])
  assert.deepEqual(results.map((result) => [result.state, result.requestedWorkspaceId]), [['activated', B], ['activated', A]], '每个请求都报告自己的目标')
  assert.equal(peak, 1, '切换经 tail 串行：任何时刻只有一个 transition 在执行')
  assert.deepEqual([(await h.host.call('baseline', {})).workspace.id, (await h.service.listWorkspaces()).activeWorkspaceId], [A, A], 'FIFO 顺序：最后一次请求（A）获胜')
})

test('a failed switch to B keeps A active, readable and un-degraded with no global activation error', async (t) => {
  const h = await open(t, { rows: [workspace(A, '项目 A'), workspace(B, '项目 B')] })
  await h.service.openWorkspace(A)
  const before = dump(h.dataPath), baselineBefore = wire(await h.host.call('baseline', {}))
  const controller = h.host.controller, generation = h.host.currentGeneration()
  // B 的 getWorkspace 前两次调用是存在性检查与期望指纹；第三次才在 assemble 里，注入只命中候选装配。
  const original = SqliteStorage.prototype.getWorkspace
  let calls = 0
  t.mock.method(SqliteStorage.prototype, 'getWorkspace', function (id) {
    if (id === B && ++calls === 3) throw new Error('switch assembly canary')
    return original.call(this, id)
  })
  const failed = await h.service.openWorkspace(B)
  assert.deepEqual([failed.state, failed.requestedWorkspaceId, failed.activeWorkspaceId, failed.error?.code], ['failed', B, A, 'unavailable'], '装配失败以作用域 failed 返回，不换装配')
  assert.equal(h.host.activationError, undefined, '切换失败不得写全局 activationError')
  assert.equal(calls, 3, '注入恰好命中候选装配读取：只有候选被 retire')
  assert.equal(h.host.controller, controller, 'A 的装配对象不变（失败不替换 current）')
  assert.equal(h.host.currentGeneration(), generation, 'A 的 generation 不变')
  const baselineAfter = wire(await h.host.call('baseline', {}))
  assert.equal(baselineAfter.workspace.id, A, 'A 仍是当前装配且可读')
  assert.deepEqual([baselineAfter.source, baselineAfter.entities], [baselineBefore.source, baselineBefore.entities], 'A 的读数不因切换失败降级')
  assert.notEqual(baselineAfter.source.reason, 'unavailable')
  assert.deepEqual([(await h.service.getWorkspaceSetup()).workspace.id, (await h.service.listWorkspaces()).activeWorkspaceId], [A, A], 'Host 未停止：setup 与 catalogue 仍如实指向 A')
  assert.deepEqual(dump(h.dataPath), before, '失败的切换不得写库')
  assert.equal((await h.service.openWorkspace(A)).state, 'activated', '失败后仍可在 A 上继续切换')
})

/** 业务行：切换是导航，这些表逐字不变（覆盖 dump 中除迁移账本外的全部表，按 001_init.sql 的实际 schema）。 */
const BUSINESS_TABLES = ['entity', 'external_identity', 'project_item_membership', 'planning_field_value', 'planning_sync_round', 'workspace_projection', 'workspace_planning_mapping', 'relation', 'candidate_relation', 'sync_observation', 'sync_cursor', 'reconcile_cursor', 'webhook_subscription', 'mutation_attempt', 'workspace_revision', 'delivery_fact', 'repository', 'execution_context', 'execution_run', 'provider_binding', 'workspace_binding', 'connector_account', 'workspace']
const business = (snapshot) => Object.fromEntries(BUSINESS_TABLES.map((table) => [table, snapshot[table]]))

test('switching is navigation only: no provider write or planning state change', async (t) => {
  const fetches = []
  const h = await open(t, { rows: [workspace(A, '项目 A'), workspace(B, '项目 B')], fetch: async (url) => { fetches.push(url); throw new Error('Business network forbidden') } })
  await h.service.openWorkspace(A)
  const before = dump(h.dataPath), generation = h.host.currentGeneration()
  assert.deepEqual(Object.keys(before).filter((table) => table !== 'schema_migrations').filter((table) => !BUSINESS_TABLES.includes(table)), [], 'BUSINESS_TABLES 必须覆盖 dump 的全部业务表')
  await h.service.openWorkspace(B)
  assert.notEqual(h.host.currentGeneration(), generation, '阳性对照：切换确实重建了装配')
  assert.deepEqual(business(dump(h.dataPath)), business(before), '切换不得改 Planning/关系/变更尝试/挂载/游标/修订等业务行')
  // 该档案没有 provider 挂载，因此「无网络」只对空工作区有效；有挂载时由 provider 写调用断言兜底（见创建用例）。
  assert.deepEqual(fetches, [], '空工作区档案下切换不得触网（fetch 计数只对无挂载的工作区有效）')
  await h.service.openWorkspace(A)
  assert.deepEqual(business(dump(h.dataPath)), business(before), '切回 A 同样只换指针')
})

test('a failed create-and-switch scopes activationError to the command and leaves A un-degraded', async (t) => {
  const h = await open(t, { rows: [workspace(A, '项目 A')] })
  await h.service.openWorkspace(A)
  const generation = h.host.currentGeneration(), controller = h.host.controller
  const baselineBefore = wire(await h.host.call('baseline', {})), before = dump(h.dataPath)
  // 创建路径的 getWorkspace 前两次是 create-or-verify 与期望指纹；第三次才在候选 assemble 里。
  const target = newWorkspaceIdForCreateIntent('create-switch-failure')
  const original = SqliteStorage.prototype.getWorkspace
  let calls = 0
  t.mock.method(SqliteStorage.prototype, 'getWorkspace', function (id) {
    if (id === target && ++calls === 3) throw new Error('create assembly canary')
    return original.call(this, id)
  })
  const created = await h.service.createWorkspace(actor, 'create-switch-failure', '项目 B')
  assert.deepEqual([created.writeState, created.value.workspaceId, created.activationError?.code], ['local_only', target, 'unavailable'], '本地工作区已提交，装配失败只出现在本次命令结果里')
  assert.equal(calls, 3, '注入恰好命中候选装配读取')
  assert.equal(h.host.activationError, undefined, '全局 activationError 保持 undefined：A 不因创建失败降级')
  const baselineAfter = wire(await h.host.call('baseline', {}))
  assert.equal(baselineAfter.workspace.id, A, 'A 仍是当前装配且可读')
  assert.deepEqual([baselineAfter.source, baselineAfter.entities], [baselineBefore.source, baselineBefore.entities], 'A 的 baseline source/entities 逐字不变')
  assert.notEqual(baselineAfter.source.reason, 'unavailable', 'A 的 source 不得被标成 unavailable')
  assert.equal(h.host.controller, controller, 'A 的装配对象不变'); assert.equal(h.host.currentGeneration(), generation, 'A 的 generation 不变')
  const after = dump(h.dataPath), tables = Object.keys(after).filter((table) => table !== 'workspace')
  assert.deepEqual(Object.fromEntries(tables.map((table) => [table, after[table]])), Object.fromEntries(tables.map((table) => [table, before[table]])), '除 workspace 表外没有任何写入（无半写）')
  assert.deepEqual(JSON.parse(after.workspace).filter((row) => row.id !== target), JSON.parse(before.workspace), 'A 行逐字不变')
  assert.deepEqual(wire((await h.service.listWorkspaces()).workspaces.map((row) => [row.workspaceId, row.name])), [[A, '项目 A'], [target, '项目 B']], '库只多 B 行')
  assert.deepEqual(wire(await h.service.getWorkspaceSetup()).activationError, undefined, 'A 的 setup 不显示 activationError')
})

test('creating a local workspace makes no remote project or issue: no provider write and no network', async (t) => {
  const writes = [], fetches = []
  const entry = fakePlanningEntry((provider) => {
    for (const method of ['createIssueWorkItem', 'createDraftItem', 'updatePlanningFields']) {
      const run = provider[method]?.bind(provider)
      if (typeof run !== 'function') continue
      provider[method] = (...args) => { writes.push(method); return run(...args) }
    }
    return provider
  })
  const catalog = new Map([['harness.fake', entry]])
  const root = await directory(t), dataPath = path.join(root, 'workspace.sqlite')
  await seed(dataPath, catalog, async (storage) => {
    await storage.putWorkspace(workspace(A, '项目 A'))
    await storage.putProviderBinding({ id: 'planning-fake', workspaceId: A, domain: 'planning', implementationKey: 'harness.fake', enabled: true, isDefault: true })
    await storage.putConnectorAccount(account())
  })
  const h = await boot(t, { dataPath, catalog, fetch: async (url) => { fetches.push(url); throw new Error('Business network forbidden') } })
  assert.equal((await h.host.call('baseline', {})).workspace.id, A)
  const before = dump(dataPath)
  const created = await h.service.createWorkspace(actor, 'local-only-intent', '项目 B')
  assert.equal(created.writeState, 'local_only')
  assert.deepEqual(writes, [], '创建本地工作区不得调用 provider 写方法')
  assert.deepEqual(fetches, [], '创建本地工作区不得触网')
  assert.deepEqual([dump(dataPath).entity, dump(dataPath).provider_binding], [before.entity, before.provider_binding], '创建不产生远端项目/Issue 行或挂载')
  assert.deepEqual(wire((await h.service.listWorkspaces()).workspaces.map((row) => [row.workspaceId, row.name, row.planning])),
    [[A, '项目 A', 'bound'], [newWorkspaceIdForCreateIntent('local-only-intent'), '项目 B', 'none']], '新项目只有本地行、未连接规划')
})
