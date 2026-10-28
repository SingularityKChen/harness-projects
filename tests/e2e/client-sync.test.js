/**
 * Batch C5 端到端：React-free 客户端同步（issue #79）。
 *
 * 用例名说明它保护哪条不变量：基线修订 N 之后按序应用增量、实体身份稳定、错过增量必须检测缺口并重拉
 * 基线、重连后的投影与全新客户端一致、陈旧值永远不被当成当前值。全部使用离线替身：无凭据、无网络。
 */
import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { StatusPolicyMode, composeCore } from '@harness-projects/core'
import { createController, watchWorkspace } from '@harness-projects/controller'
import { createEntityStore, createSync, createTransport } from '@harness-projects/client'
import { FaultKind, createFakeProviders } from '@harness-projects/provider-fake'

async function compose() {
  const providers = createFakeProviders()
  const workspaceId = newWorkspaceId()
  const core = await composeCore({
    workspace: { id: workspaceId, name: 'MVP-0', statusPolicy: StatusPolicy.HostAuthoritative }, providers,
  })
  const workspaceRevision = () => providers.storage.currentRevision(workspaceId)
  return {
    providers, core,
    controller: createController(core, { authority: StatusPolicyMode.HarnessManaged, workspaceRevision }),
  }
}

const openWorkItem = (snapshot) =>
  snapshot.entities.find((entity) => entity.content.contentKind === 'work_item' && entity.planningStatus !== 'done')

const writeStatus = (controller, target, status, idempotencyKey) => controller.commands.applyPlanningStatus({
  entityId: target.entityId, status, actorRef: { kind: 'user', id: 'user-1' }, idempotencyKey,
})

function clientFor(controller, options = {}) {
  const store = createEntityStore()
  const transport = createTransport(controller, options.transport ?? {})
  return { store, transport, sync: createSync(transport, store, options.sync ?? {}) }
}

/** 投影的可比较指纹：身份、状态、新鲜度、修订与 stale 都要逐字一致。 */
const projectionOf = (store) => store.list().map((entry) => [
  entry.entityId, entry.entity.planningStatus, entry.entity.source.freshness, entry.revision, entry.stale,
].join(':')).sort()

test('client：基线 N → 按 N 订阅 → 按序应用 delta，实体身份稳定（issue #79）', async () => {
  const { controller } = await compose()
  const snapshot = await controller.baseline()
  const target = openWorkItem(snapshot)
  const { store, sync } = clientFor(controller)

  const base = await sync.connect()
  assert.equal(base.kind, 'baseline')
  assert.equal(base.revision, snapshot.revision)
  assert.equal(store.isCurrent(target.entityId), true)

  const entry = store.get(target.entityId)
  await writeStatus(controller, target, 'blocked', 'client-1')
  const report = await sync.poll()
  assert.equal(report.kind, 'delta')
  assert.equal(report.revision, snapshot.revision + 1, '增量把本地修订推进一跳')
  assert.equal(store.get(target.entityId), entry, '更新就地写回同一条目，引用不漂移')
  assert.equal(entry.entity.planningStatus, 'blocked')
  assert.equal(store.isCurrent(target.entityId), true)
})

test('client：删除最高实体修订后，工作区修订仍单调且订阅识别变化（ExecPlan D5）', async () => {
  const { providers, controller } = await compose()
  const first = await controller.baseline()
  const target = openWorkItem(first)
  await writeStatus(controller, target, 'blocked', 'revision-delete-1')
  const beforeDelete = await controller.baseline()
  assert.ok(beforeDelete.revision > first.revision)
  assert.equal(beforeDelete.entities.find((entity) => entity.entityId === target.entityId).source.revision, beforeDelete.revision)

  providers.storage.data.projections = providers.storage.data.projections.filter((projection) => projection.entityId !== target.entityId)
  const deletedRevision = await providers.storage.advanceRevision(providers.storage.data.workspaces[0].id)
  const watch = controller.watch({ afterRevision: beforeDelete.revision, seed: beforeDelete })
  const event = await watch.poll()

  assert.equal(deletedRevision, beforeDelete.revision + 1)
  assert.equal(event.kind, 'delta')
  assert.equal(event.delta.revision, deletedRevision, '删除后仍使用工作区修订号')
  assert.deepEqual(event.delta.removed, [target.entityId], '订阅方必须识别实体消失')
  assert.ok(event.delta.revision >= beforeDelete.revision, '工作区修订号不得倒退')
})

test('client：错过增量时检测缺口并重拉基线，缺口期间旧值不是当前值（issue #79）', async () => {
  const { controller } = await compose()
  const snapshot = await controller.baseline()
  const target = openWorkItem(snapshot)
  const observed = []
  const { store, sync } = clientFor(controller, {
    transport: { retain: 1 },
    sync: {
      onGap: (gap, current) => observed.push({
        reason: gap.reason, stale: current.get(target.entityId).stale, current: current.isCurrent(target.entityId),
      }),
    },
  })
  await sync.connect()
  await writeStatus(controller, target, 'blocked', 'gap-1')
  await writeStatus(controller, target, 'in_progress', 'gap-2')

  const report = await sync.poll()
  assert.equal(report.kind, 'gap', '落后于保留窗口时必须判定缺口')
  assert.equal(report.revision, snapshot.revision + 2, '重拉基线回到最新修订')
  assert.equal(observed.length, 1, '缺口只报告一次')
  assert.equal(observed[0].stale, true, '重拉前的旧值必须标记 stale')
  assert.equal(observed[0].current, false, 'stale 值不得被当成当前值')
  assert.equal(store.isCurrent(target.entityId), true, '重拉基线后恢复为当前值')
  assert.equal(store.get(target.entityId).entity.planningStatus, 'in_progress')
})

test('client：重连后的投影与全新客户端一致（issue #79）', async () => {
  const { controller } = await compose()
  const target = openWorkItem(await controller.baseline())
  const { store, sync } = clientFor(controller)
  await sync.connect()
  await writeStatus(controller, target, 'blocked', 'reconnect-1')
  assert.equal((await sync.poll()).kind, 'delta')
  await writeStatus(controller, target, 'in_progress', 'reconnect-2')

  await sync.reconnect()
  const fresh = clientFor(controller)
  await fresh.sync.connect()
  assert.deepEqual(projectionOf(store), projectionOf(fresh.store), '重连与全新客户端必须得到同一投影')
})

test('client：降级来源的值只能是最后已知，不算当前值（issue #79）', async () => {
  const { providers, core, controller } = await compose()
  providers.planning.faultsSwitch.set(FaultKind.Offline, true)
  await core.commands.bootstrapWorkspace()

  const degraded = await controller.baseline()
  assert.equal(degraded.source.freshness, 'degraded', 'provider 离线时必须如实标记降级')
  assert.ok(degraded.entities.length > 0, '降级保留最后已知投影，而不是清空')
  const store = createEntityStore()
  store.applyBaseline(degraded)
  const first = degraded.entities[0]
  assert.equal(store.get(first.entityId).stale, true, '降级来源的值只能是最后已知')
  assert.equal(store.isCurrent(first.entityId), false)
  store.markAllStale()
  assert.equal(store.isCurrent(first.entityId), false, '缺口标记后任何值都不得是当前值')
})

const deferred = (t, fallback) => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  t.after(() => resolve(fallback))
  return { promise, resolve, reject }
}
const stateOf = (sync, store, calls) => structuredClone({ read: sync.read() && { ...sync.read(), store: undefined }, rows: store.list(), revision: sync.revision, connected: sync.connected, calls: calls() })

for (const method of ['connect', 'reconnect']) test(`迟到基线不能越过 disconnect：${method}`, async (t) => {
  const { controller } = await compose(), base = await controller.baseline(), gate = deferred(t, base)
  let calls = 0
  const store = createEntityStore(), sync = createSync({ fetchBaseline: () => gate.promise, close() {} }, store, { clock: () => { calls++; return '2026-10-28T00:00:00Z' } })
  sync.receive({ kind: 'baseline', baseline: base })
  const pending = sync[method]()
  assert.equal(store.list().every((row) => row.stale), true, '发起当刻 stale')
  sync.disconnect()
  const before = stateOf(sync, store, () => calls)
  gate.resolve(base)
  assert.equal((await pending).kind, 'idle')
  assert.deepEqual(stateOf(sync, store, () => calls), before)
})

for (const oldFailure of [false, true]) test(`过期成功与失败不能覆盖新重连：${oldFailure ? 'failure' : 'success'}`, async (t) => {
  const { controller } = await compose(), base = await controller.baseline(), old = deferred(t, base), next = deferred(t, base)
  let calls = 0, reads = 0
  const store = createEntityStore(), sync = createSync({ fetchBaseline: () => (++reads === 1 ? old : next).promise, close() {} }, store, { clock: () => { calls++; return '2026-10-28T00:00:00Z' } })
  const pending = sync.connect()
  const newer = sync.reconnect(); next.resolve(base); await newer
  const before = stateOf(sync, store, () => calls)
  if (oldFailure) old.reject(new Error('old request failed')); else old.resolve(base)
  assert.equal((await pending).kind, 'idle')
  assert.deepEqual(stateOf(sync, store, () => calls), before)
})

test('较新失败也使旧成功失效', async (t) => {
  const { controller } = await compose(), base = await controller.baseline(), old = deferred(t, base)
  let reads = 0
  const store = createEntityStore(), sync = createSync({ fetchBaseline: () => ++reads === 1 ? old.promise : Promise.reject(new Error('current failure')), close() {} }, store)
  const pending = sync.connect()
  await assert.rejects(sync.reconnect(), /current failure/)
  old.resolve(base)
  assert.equal((await pending).kind, 'idle'); assert.equal(sync.connected, false); assert.equal(sync.read(), undefined)
})

for (const kind of ['delta', 'metadata']) test(`迟到 poll 在 disconnect 后无效：${kind}`, async (t) => {
  const { controller } = await compose(), base = await controller.baseline(), gate = deferred(t, base)
  let calls = 0
  const store = createEntityStore(), sync = createSync({ fetchBaseline: async () => base, poll: () => gate.promise, close() {} }, store, { clock: () => { calls++; return '2026-10-28T00:00:00Z' } })
  await sync.connect()
  const pending = sync.poll(); sync.disconnect()
  const before = stateOf(sync, store, () => calls)
  gate.resolve(kind === 'delta' ? { kind, delta: { ...base, previousRevision: base.revision, revision: base.revision + 1, source: { ...base.source, revision: base.revision + 1 }, upserts: [], removed: [] } }
    : { kind, metadata: { ...base, entities: base.entities.map(({ entityId, source }) => ({ entityId, source })) } })
  assert.equal((await pending).kind, 'idle'); assert.deepEqual(stateOf(sync, store, () => calls), before)
})

for (const mode of ['redaction', 'metadata']) test(`迟到可见基线不能覆盖遮蔽与新 metadata：${mode}`, async (t) => {
  const { controller } = await compose(), base = await controller.baseline(), gate = deferred(t, base)
  let calls = 0
  const store = createEntityStore(), sync = createSync({ fetchBaseline: () => gate.promise, close() {} }, store, { clock: () => { calls++; return '2026-10-28T00:00:00Z' } })
  sync.receive({ kind: 'baseline', baseline: base })
  const pending = sync.reconnect()
  const redacted = { ...base, entities: base.entities.map((row) => { const { planningFields, ...safe } = row; return { ...safe, content: { ...row.content, contentKind: 'redacted', title: undefined, body: undefined, externalKind: undefined, externalId: undefined } } }) }
  if (mode === 'redaction') sync.receive({ kind: 'baseline', baseline: redacted })
  sync.receive({ kind: 'metadata', metadata: { ...base, source: { ...base.source, freshness: 'degraded', reason: 'unavailable' }, entities: base.entities.map(({ entityId, source }) => ({ entityId, source: { ...source, freshness: 'degraded', reason: 'unavailable' } })) } })
  const before = stateOf(sync, store, () => calls)
  if (mode === 'redaction') for (const { entity } of store.list()) {
    for (const field of ['title', 'body', 'externalId', 'externalKind']) assert.equal(entity.content[field], undefined)
    assert.equal('planningFields' in entity, false)
  }
  gate.resolve(base)
  assert.equal((await pending).kind, 'idle'); assert.deepEqual(stateOf(sync, store, () => calls), before)
})

test('同生命周期并发 poll 返回同一 Promise 并保留真实 watch 游标', async (t) => {
  const { controller } = await compose(), base = await controller.baseline(), gate = deferred(t, base)
  let reads = 0, blocked = false
  const source = { baseline: async () => { reads++; if (blocked) await gate.promise; return controller.baseline() }, watch: (options) => watchWorkspace(source, options) }
  const { store, sync } = clientFor(source)
  await sync.connect(); blocked = true
  const target = openWorkItem(base)
  await writeStatus(controller, target, 'blocked', 'single-flight')
  const a = sync.poll(), b = sync.poll()
  assert.equal(a, b); assert.equal(reads, 2)
  gate.resolve(); assert.equal((await a).kind, 'delta')
  assert.equal(store.get(target.entityId).entity.planningStatus, 'blocked')
  const c = sync.poll(); assert.notEqual(c, a); assert.equal((await c).kind, 'idle'); assert.equal(reads, 3)
})

test('过期 Transport seed 不得关闭当前 watch，close 吸收 pending fetch/poll', async (t) => {
  const { controller } = await compose(), base = await controller.baseline(), old = deferred(t, base), next = deferred(t, base), event = deferred(t, base)
  let reads = 0, closed = 0
  const seeds = [], source = { baseline: () => (++reads === 1 ? old : next).promise, watch: (options) => { seeds.push(options.seed); return { poll: () => event.promise, close() { closed++ } } } }
  const transport = createTransport(source)
  const a = transport.fetchBaseline(), b = transport.fetchBaseline()
  const latest = { ...base, workspace: { ...base.workspace, name: 'latest' } }
  next.resolve(latest); await b
  const polling = transport.poll(base.revision)
  old.resolve(base); await a
  assert.equal(closed, 0, '旧基线不关闭当前 watch')
  transport.close(); event.resolve({ kind: 'gap', gap: { requestedAfter: 0, currentRevision: 1, reason: 'late' } })
  assert.equal(await polling, undefined)
  const late = deferred(t, base); source.baseline = () => late.promise
  const pending = transport.fetchBaseline(); transport.close(); late.resolve(base); await pending
  await transport.poll(base.revision)
  assert.deepEqual(seeds, [latest, undefined], 'close 后不能由迟到 fetch 恢复 seed')
})


test('重建 Host 以真实 generation 接受较低 revision，同 Core wrappers 保持 generation', async (t) => {
  const first = await compose(), original = await first.controller.baseline()
  const secondCore = await composeCore({ workspace: { id: original.workspace.id, name: 'rebuilt' }, providers: createFakeProviders() })
  const rebuilt = createController(secondCore), next = await rebuilt.baseline()
  assert.equal(typeof original.generation, 'string'); assert.ok(original.generation.length > 0)
  assert.equal((await createController(first.core).baseline()).generation, original.generation)
  assert.notEqual(next.generation, original.generation)
  await first.providers.storage.advanceRevision(original.workspace.id)
  let host = first.controller
  const { sync } = clientFor({ baseline: () => host.baseline(), watch: (options) => host.watch(options) })
  await sync.connect(); assert.ok(sync.revision > next.revision)
  host = rebuilt
  await sync.reconnect(); assert.equal(sync.revision, next.revision); assert.equal(sync.read().workspace.name, 'rebuilt')
})

test('onGap 内 disconnect 取消恢复；旧 poll 结算不能清掉新生命周期单飞', async (t) => {
  const { controller } = await compose(), base = await controller.baseline(), old = deferred(t, base), next = deferred(t, base)
  let reads = 0, baselines = 0
  const store = createEntityStore(), sync = createSync({ fetchBaseline: async () => { baselines++; return base }, poll: () => (++reads === 1 ? old : next).promise, close() {} }, store)
  await sync.connect()
  const a = sync.poll(); await sync.reconnect(); const b = sync.poll()
  old.resolve(undefined); assert.equal((await a).kind, 'idle'); assert.equal(sync.poll(), b)
  next.resolve(undefined); await b
  const gapSync = createSync({ fetchBaseline: async () => { baselines++; return base }, poll: async () => ({ kind: 'gap', gap: { requestedAfter: 0, currentRevision: 1, reason: 'gap' } }), close() {} }, createEntityStore(), { onGap: () => gapSync.disconnect() })
  await gapSync.connect(); const before = baselines
  assert.equal((await gapSync.poll()).kind, 'idle'); assert.equal(gapSync.connected, false); assert.equal(baselines, before, 'onGap 断开之后不重拉')
})

test('generation 是 required opaque string；坏 baseline 和跨代 delta/metadata 在 clock 前原子拒绝', async (t) => {
  const { controller } = await compose(), base = await controller.baseline()
  let calls = 0, closed = 0
  const transport = createTransport(controller), close = transport.close
  transport.close = () => { closed++; close() }
  const store = createEntityStore(), sync = createSync(transport, store, { clock: () => { calls++; return '2026-10-28T00:00:00Z' } })
  const empty = stateOf(sync, store, () => calls)
  for (const generation of [undefined, 1, '', ' ']) {
    assert.throws(() => sync.receive({ kind: 'baseline', baseline: { ...base, generation } }), /generation/)
    assert.deepEqual(stateOf(sync, store, () => calls), empty); assert.equal(closed, 0)
  }
  sync.receive({ kind: 'baseline', baseline: base })
  const before = stateOf(sync, store, () => calls)
  for (const kind of ['delta', 'metadata']) {
    const frame = { ...base, generation: 'other-host', previousRevision: base.revision, revision: kind === 'delta' ? base.revision + 1 : base.revision, upserts: [], removed: [], entities: base.entities.map(({ entityId, source }) => ({ entityId, source })) }
    assert.throws(() => sync.receive({ kind, [kind]: frame }), /generation/)
    assert.deepEqual(stateOf(sync, store, () => calls), before); assert.equal(closed, 1)
  }
})

test('接受与 Promise 结算之间的 disconnect 不回报旧成功', async () => {
  const { controller } = await compose(), base = await controller.baseline()
  const store = createEntityStore(), sync = createSync({ fetchBaseline: async () => base, close() {} }, store)
  const pending = sync.connect()
  queueMicrotask(() => sync.disconnect())
  assert.equal((await pending).kind, 'idle')
  assert.equal(sync.connected, false); assert.ok(store.list().every((row) => row.stale))
})

test('新 receive 作废 pending poll 后，后续 pull 仍收到已被旧 watch 消费的更新', async (t) => {
  const { controller } = await compose(), base = await controller.baseline(), gate = deferred(t, base)
  let reads = 0
  const source = { baseline: async () => { if (++reads === 2) await gate.promise; return controller.baseline() }, watch: (options) => watchWorkspace(source, options) }
  const { store, sync } = clientFor(source)
  await sync.connect()
  const old = sync.poll()
  sync.receive({ kind: 'metadata', metadata: { ...base, entities: base.entities.map(({ entityId, source }) => ({ entityId, source })) } })
  const target = openWorkItem(base)
  await writeStatus(controller, target, 'blocked', 'receive-poll-cursor')
  gate.resolve(); assert.equal((await old).kind, 'idle')
  await sync.poll()
  assert.equal(store.get(target.entityId).entity.planningStatus, 'blocked')
  assert.equal(sync.revision, base.revision + 1)
})
