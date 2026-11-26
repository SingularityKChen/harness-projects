/**
 * 多项目隔离与生命周期的端到端对抗矩阵（#694，整合 #636 的验收组 1/3/4/5/8）。
 *
 * 保护的不变量：两个工作区**共享**同一 work-item / repository / 幂等标识时，读数、写入与业务行仍逐表归属
 * 当前工作区；切换窗口内到达的旧读、旧 provider 回复与排队写不落到另一个工作区；B 的低修订 baseline 仍是
 * B 的权威读数；快速 A→B→A 与失败切换只退休旧装配，旧 reconciler 被有界回收且不再轮询（定时器计数）；
 * 真实 Gateway 双 peer 在带业务数据时仍以固定文案拒绝旧 peer、并在其重开流后恢复。
 * 判别力：任何按实体 id / 仓库 id / 幂等键做全局缓存或全局去重的实现，都会在「同一标识分属 A/B」的用例上失败；
 * 任何只在 watch 帧上做隔离、不在准入与 lease 排空上做的实现，都会在 held 旧读与排队写用例上失败。
 */
import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import { SqliteStorage } from '@harness-projects/storage-sqlite'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { catalogOf } from '../../apps/harness-plugin/src/host-providers.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { apply as applyHost } from '../../apps/harness-plugin/src/host.ts'
import { dump, fakePlanningEntry, seed } from './fixtures/host-seed.js'

const A = '00000000-0000-4000-8000-0000000004a1', B = '00000000-0000-4000-8000-0000000004b2'
/** A/B 共用的三个标识：同一 work-item、同一 repository、同一幂等键。 */
const ITEM = '00000000-0000-4000-8000-0000000009e1'
const REPO = '00000000-0000-4000-8000-0000000009e2'
const KEY = 'shared-intent'
const IDENTITY_ITEM = 'identity-shared-item', IDENTITY_REPO = 'identity-shared-repo'
const BINDING_A = 'binding-a', BINDING_B = 'binding-b'
const actor = { kind: 'user' }, wire = (value) => JSON.parse(JSON.stringify(value))
const workspace = (id, name, statusPolicy = 'provider_authoritative') => ({ id, name, statusPolicy })
const turn = () => new Promise((resolve) => setImmediate(resolve))
const rowsOf = (snapshot, table) => JSON.parse(snapshot[table] ?? '[]')
/** 手写的最小 timer 台账：live 是当前在位的 interval，callbacks 记录每次分配（含已退休的）。 */
function manualTimers() {
  const live = new Set(), callbacks = []
  return { live, callbacks, setInterval(run, ms) { assert.equal(ms, 60_000, 'reconciler 必须使用宿主声明的间隔'); callbacks.push(run); live.add(run); return run }, clearInterval(run) { live.delete(run) }, tick(run) { (run ?? live.values().next().value)?.() } }
}

/**
 * 直接写库造 A/B 的业务行：两个工作区持有**同一** work-item / repository / 幂等标识，只有内容与修订不同。
 * 先经 seed 打开库并执行唯一基线迁移，再用裸 SQL 在一个事务里写行——deferred 外键让「身份先于实体」的互指
 * 可以一次提交（生产写者从不会这样建行，这里只造夹具）。
 */
async function seedBusiness(dataPath) {
  await seed(dataPath, new Map(), async () => {})
  const db = new DatabaseSync(dataPath)
  try {
    db.exec('BEGIN')
    // 身份与实体互指：把外键检查整体推迟到 COMMIT，才可能在一个事务里建立这对夹具行。
    db.exec('PRAGMA defer_foreign_keys = ON')
    const run = (sql, ...args) => db.prepare(sql).run(...args)
    for (const [id, name] of [[A, '项目 A'], [B, '项目 B']]) run("INSERT INTO workspace (id, name, status_policy) VALUES (?, ?, 'provider_authoritative')", id, name)
    // 连接锚点不挂 workspace_binding：本矩阵只证明本地行归属，不调 Provider。
    for (const id of [BINDING_A, BINDING_B]) run("INSERT INTO provider_binding (id, implementation_key) VALUES (?, 'planning.github-projects')", id)
    run('INSERT INTO external_identity (id, entity_id, binding_id, external_kind, external_id, role) VALUES (?, ?, ?, ?, ?, ?)', IDENTITY_ITEM, ITEM, BINDING_A, 'issue', 'issue-shared', 'primary')
    run('INSERT INTO external_identity (id, entity_id, binding_id, external_kind, external_id, role) VALUES (?, ?, ?, ?, ?, ?)', IDENTITY_REPO, REPO, BINDING_A, 'repository', 'repo-shared', 'primary')
    run('INSERT INTO entity (id, kind, primary_identity_id) VALUES (?, ?, ?)', ITEM, 'work_item', IDENTITY_ITEM)
    run('INSERT INTO entity (id, kind, primary_identity_id) VALUES (?, ?, ?)', REPO, 'repository', IDENTITY_REPO)
    // 同一实体在两个工作区各有一行投影：A 的修订更高，B 的更低——切换后 B 的低修订仍是 B 的权威读数。
    const projection = 'INSERT INTO workspace_projection (workspace_id, entity_id, source_binding_id, planning_status, content_kind, content_title, revision) VALUES (?, ?, ?, ?, ?, ?, ?)'
    run(projection, A, ITEM, BINDING_A, 'todo', 'work_item', 'A 的条目', 9)
    run(projection, B, ITEM, BINDING_B, 'done', 'work_item', 'B 的条目', 3)
    // 同一 repository id 在两个工作区各自挂载：主键是 (workspace_id, id)。
    for (const [workspaceId, bindingId] of [[A, BINDING_A], [B, BINDING_B]]) {
      run('INSERT INTO repository (id, workspace_id, external_identity_id) VALUES (?, ?, ?)', REPO, workspaceId, IDENTITY_REPO)
      run('INSERT INTO relation (workspace_id, from_entity_id, to_entity_id, relation_type, relation_class, source, state) VALUES (?, ?, ?, ?, ?, ?, ?)', workspaceId, ITEM, REPO, 'relates_to', 'business_semantics', 'explicit', 'confirmed')
      // 同一幂等键与同一 attempt id 在两个工作区分属两行：主键是 (workspace_id, idempotency_key)。
      run("INSERT INTO mutation_attempt (workspace_id, idempotency_key, id, binding_id, command_name, state, created_at, updated_at) VALUES (?, ?, ?, ?, 'createWorkspace', 'saved', ?, ?)", workspaceId, KEY, 'write:createWorkspace:' + KEY, bindingId, '2026-11-25T00:00:00.000Z', '2026-11-25T00:00:00.000Z')
    }
    run('INSERT INTO workspace_revision (workspace_id, revision) VALUES (?, ?)', A, 9)
    run('INSERT INTO workspace_revision (workspace_id, revision) VALUES (?, ?)', B, 3)
    db.exec('COMMIT')
  } finally { db.close() }
}

async function directory(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mp-matrix-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
/** 真实 composition + 真实 remote；同 dataPath 再 boot 一次即「重开」。 */
async function boot(t, { dataPath, catalog = new Map(), planningTimers, planningReadTimeoutMs }) {
  const host = await createHostComposition({ dataPath, catalog, resolveCredential: async () => undefined, watchIntervalMs: 5, ...(planningReadTimeoutMs === undefined ? {} : { planningReadTimeoutMs }), ...(planningTimers === undefined ? {} : { planningTimers }) })
  const installed = await installHostRemote({ invocation: { peer: { id: 'fixture-peer' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  t.after(async () => { host.stop(); await installed.dispose(); await host.dispose() })
  return { host, service: installed.service, close: async () => { host.stop(); await installed.dispose(); await host.dispose() } }
}
async function open(t, options = {}) {
  const root = await directory(t), dataPath = path.join(root, 'workspace.sqlite')
  await seedBusiness(dataPath)
  return { dataPath, ...await boot(t, { dataPath, ...options }) }
}

test('A and B share work-item, repository and idempotency identifiers yet every read and row stays attributed to the current workspace', async (t) => {
  const h = await open(t)
  assert.deepEqual(wire(await h.service.listWorkspaces()).workspaces.map((row) => row.workspaceId), [A, B], '两个受支持工作区没有偏好时从 Home 启动')
  assert.equal((await h.service.openWorkspace(A)).state, 'activated')
  const a = wire(await h.host.call('baseline', {})), before = dump(h.dataPath)
  assert.deepEqual([a.workspace.id, a.revision], [A, 9])
  assert.deepEqual(a.entities.map((entity) => [entity.entityId, entity.content.title, entity.planningStatus]), [[ITEM, 'A 的条目', 'todo']], 'A 下同一 item id 解析为 A 的内容')
  assert.deepEqual(a.repositories.map((repository) => repository.id), [REPO], 'A 下同一 repository id 只来自 A 的挂载')
  assert.equal((await h.service.openWorkspace(B)).state, 'activated')
  const b = wire(await h.host.call('baseline', {}))
  assert.deepEqual([b.workspace.id, b.revision], [B, 3], 'B 的修订更低，但 B 的 baseline 是 B 的权威读数')
  assert.deepEqual(b.entities.map((entity) => [entity.entityId, entity.content.title, entity.planningStatus]), [[ITEM, 'B 的条目', 'done']], '同一 item id 切到 B 后解析为 B 的内容，不合并也不残留 A')
  assert.deepEqual(b.repositories.map((repository) => repository.id), [REPO])
  assert.deepEqual(dump(h.dataPath), before, '切换只是导航：库逐字不变')
  // 逐表隔离：同一 item/repository/幂等键在两个工作区各有一行，互不覆盖。
  const after = dump(h.dataPath)
  for (const [table, key] of [['workspace_projection', 'workspace_id'], ['repository', 'workspace_id'], ['relation', 'workspace_id'], ['mutation_attempt', 'workspace_id']]) {
    const owners = rowsOf(after, table).filter((row) => row[key] === A || row[key] === B).map((row) => row[key]).sort()
    assert.deepEqual(owners, [A, B], table + ' 必须每个工作区各有一行')
  }
  assert.deepEqual(rowsOf(after, 'mutation_attempt').map((row) => [row.workspace_id, row.idempotency_key, row.id]).sort(), [[A, KEY, 'write:createWorkspace:' + KEY], [B, KEY, 'write:createWorkspace:' + KEY]].sort(), '同一幂等键与同一 attempt id 分属两行')
  assert.equal((await h.service.openWorkspace(A)).state, 'activated')
  assert.deepEqual(wire(await h.host.call('baseline', {})).entities.map((entity) => entity.content.title), ['A 的条目'], 'A→B→A 回到 A 的内容')
  assert.deepEqual(dump(h.dataPath), before, '快速 A→B→A 也不写业务行')
})

test('a read admitted on A is rejected with the fixed message after switching to B and never lands on B', async (t) => {
  const h = await open(t)
  await h.service.openWorkspace(A)
  const original = SqliteStorage.prototype.listPlanningProjections
  let release, entered
  const gate = new Promise((resolve) => { release = resolve }), reached = new Promise((resolve) => { entered = resolve })
  let hold = true
  t.mock.method(SqliteStorage.prototype, 'listPlanningProjections', async function (...args) {
    if (hold) { hold = false; entered(); await gate }
    return original.apply(this, args)
  })
  const pending = h.host.call('baseline', {})
  await reached
  const switching = h.service.openWorkspace(B)
  await turn()
  release()
  assert.equal((await switching).state, 'activated')
  await assert.rejects(() => pending, /项目已切换，请重新读取/, '准入在 A 的旧读必须在切换后以固定文案中止')
  assert.deepEqual(wire(await h.host.call('baseline', {})).entities.map((entity) => entity.content.title), ['B 的条目'], '中止后当前读数只有 B')
})

test('a settings write admitted on A in the switch window is scoped out and lands in neither workspace', async (t) => {
  const h = await open(t)
  await h.service.openWorkspace(A)
  const before = dump(h.dataPath)
  const [opened, write] = await Promise.all([h.service.openWorkspace(B), h.service.installExecutionBindings(actor, 'switch-window-write')])
  assert.deepEqual([opened.state, write.writeState, write.error.code], ['activated', 'conflict', 'conflict'], '切换窗口内的写必须按作用域拒绝')
  assert.deepEqual(dump(h.dataPath), before, '被拒绝的写不得写库')
  assert.equal(h.host.activationError, undefined, '不得写全局 activationError')
  assert.equal((await h.service.getWorkspaceSetup()).workspace.id, B, 'B 仍是当前项目')
})

test('a noncooperative Planning reply after deadline and assembly retirement never writes its distinct late payload', { timeout: 5000 }, async (t) => {
  const timers = manualTimers()
  const root = await directory(t), dataPath = path.join(root, 'workspace.sqlite')
  let provider, release, entered
  const gate = new Promise((resolve) => { release = resolve }), reached = new Promise((resolve) => { entered = resolve })
  const catalog = catalogOf([fakePlanningEntry((created) => { provider = created; return created })])
  await seed(dataPath, catalog, async (storage) => {
    for (const row of [workspace(A, '项目 A'), workspace(B, '项目 B')]) await storage.putWorkspace(row)
    for (const [workspaceId, bindingId] of [[A, BINDING_A], [B, BINDING_B]]) await storage.putProviderBinding({ id: bindingId, workspaceId, domain: 'planning', implementationKey: 'harness.fake', enabled: true, isDefault: true })
  })
  const h = await boot(t, { dataPath, catalog, planningTimers: timers, planningReadTimeoutMs: 1000 })
  await h.service.openWorkspace(A)
  const retiredProvider = provider, original = retiredProvider.listPlanningItems.bind(retiredProvider)
  const lateTitle = 'late-A-payload-after-retirement'
  let returned
  const arrived = new Promise((resolve) => { returned = resolve })
  t.after(() => release())
  let hold = true
  retiredProvider.listPlanningItems = async (...args) => {
    if (hold) {
      hold = false; entered(); await gate
      const result = structuredClone(await original(...args))
      assert.ok(result.ok && result.value.items.length > 0)
      result.value.items[0].content.workItem.title = lateTitle
      result.value.items[0].sourceVersion = 'late-A-v2'
      returned(); return result
    }
    return original(...args)
  }
  timers.tick()
  await reached
  // B must activate while the uncooperative underlying A reply is still held: the wrapper deadline retires A.
  assert.equal((await h.service.openWorkspace(B)).state, 'activated')
  const beforeLateReply = dump(dataPath)
  release(); await arrived
  await turn(); await turn()
  assert.deepEqual(dump(dataPath), beforeLateReply, '退休后才返回的独特 A payload 不得写 A 或 B')
  assert.ok(!JSON.parse(beforeLateReply.workspace_projection).some((row) => row.content_title === lateTitle))
  const baseline = wire(await h.host.call('baseline', {}))
  assert.equal(baseline.workspace.id, B)
  assert.ok(baseline.entities.every((entity) => entity.content.title !== lateTitle), 'B 不得发布迟到的 A 内容')
})

test('each switch retires exactly one reconciler, leaving a single live interval and no polling from retired callbacks', async (t) => {
  const timers = manualTimers()
  const root = await directory(t), dataPath = path.join(root, 'workspace.sqlite')
  let provider, polls = 0
  // 每个装配各自创建一个 provider 实例：在 onCreate 里统一包计数，跨装配仍只有一个轮询来源。
  const catalog = catalogOf([fakePlanningEntry((created) => {
    provider = created; const run = created.listPlanningItems.bind(created)
    created.listPlanningItems = async (...args) => { polls += 1; return run(...args) }
    return created
  })])
  await seed(dataPath, catalog, async (storage) => {
    for (const row of [workspace(A, '项目 A'), workspace(B, '项目 B')]) await storage.putWorkspace(row)
    for (const [workspaceId, bindingId] of [[A, BINDING_A], [B, BINDING_B]]) await storage.putProviderBinding({ id: bindingId, workspaceId, domain: 'planning', implementationKey: 'harness.fake', enabled: true, isDefault: true })
  })
  const h = await boot(t, { dataPath, catalog, planningTimers: timers })
  assert.equal(timers.live.size, 0, 'Home 装配没有 reconciler')
  await h.service.openWorkspace(A)
  assert.equal(timers.live.size, 1, '打开 A 只启动一个 interval')
  const first = timers.callbacks.at(-1)
  await h.service.openWorkspace(B)
  assert.equal(timers.live.size, 1, '切到 B 后仍只有一个 interval（旧的有界退休）')
  const second = timers.callbacks.at(-1)
  assert.equal(timers.callbacks.length, 2, '每次装配恰好分配一个 interval，没有重复轮询')
  const settled = polls
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
  timers.tick(first); await settle()
  assert.equal(polls, settled, '被退休的旧 callback 不得再触发轮询')
  timers.tick(second); await settle()
  assert.ok(polls > settled, '当前 callback 仍必须轮询')
  await h.service.openWorkspace(A); await h.service.openWorkspace(B)
  assert.equal(timers.live.size, 1, '多次切换后仍只有一个 interval')
  assert.equal(timers.callbacks.length, 4, '每次装配各分配一次，旧 timer 全部被清除')
})

test('real Gateway dual peers with business data keep the fixed rejection and recover after the stale peer restarts its watch', async (t) => {
  const root = await directory(t), profile = path.join(root, 'profile'); await mkdir(profile, { recursive: true })
  const dbPath = path.join(profile, 'harness-projects', 'workspace.sqlite')
  await seedBusiness(dbPath)
  const ctx = new Context()
  let stopHost
  new TypertRegistry(ctx)
  const gateway = new Gateway(ctx, { websocketHeartbeatIntervalMs: 2000, streamInboxBytes: 262144 })
  ctx.provide('profileContext', { dir: profile, home: path.dirname(profile), name: path.basename(profile) })
  const fiber = ctx.inject([], (scope) => {
    const effect = scope.effect.bind(scope)
    scope.effect = (run, label) => { const dispose = effect(run, label); if (label === 'harness-projects: host composition') stopHost = dispose; return dispose }
    return applyHost(scope)
  })
  await fiber.await()
  t.after(() => stopHost?.())
  const peer = (id) => ({ id, ctx, dispose: async () => {} })
  const invoke = (method, args, id) => gateway.invoke({ namespace: 'harnessProjects', method, args, peer: peer(id) })
  const stream = async (method, args, id) => (await gateway.stream({ namespace: 'harnessProjects', method, args, peer: peer(id) }))[Symbol.asyncIterator]()
  assert.equal((await invoke('openWorkspace', { workspaceId: A }, 'peer-b')).state, 'activated')
  const frames = await stream('watch', {}, 'peer-a')
  const first = (await frames.next()).value
  assert.deepEqual([first.kind, first.baseline.workspace.id, first.baseline.entities.map((entity) => entity.content.title)], ['baseline', A, ['A 的条目']], 'peer A 先读到 A 的同一 item id')
  assert.equal((await invoke('openWorkspace', { workspaceId: B }, 'peer-b')).state, 'activated')
  const before = dump(dbPath)
  await assert.rejects(() => invoke('baseline', {}, 'peer-a'), /项目已切换，请重新读取/, '带业务数据时旧 peer 的 unary 仍以固定文案拒绝')
  assert.deepEqual(dump(dbPath), before, '被拒绝的旧 peer 请求不得写入任何行')
  await frames.return?.()
  const restarted = await stream('watch', {}, 'peer-a')
  try {
    const baseline = (await restarted.next()).value
    assert.deepEqual([baseline.kind, baseline.baseline.workspace.id, baseline.baseline.entities.map((entity) => entity.content.title)], ['baseline', B, ['B 的条目']], '重开流后同一 item id 解析为 B 的内容')
    assert.equal((await invoke('baseline', {}, 'peer-a')).workspace.id, B, '重开流收到新 baseline 后同一 unary 通过')
  } finally { await restarted.return?.() }
  assert.deepEqual(dump(dbPath), before, '整段双 peer 交互不写任何业务行')
})
