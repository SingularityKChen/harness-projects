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
import { createController } from '@harness-projects/controller'
import { createEntityStore, createSync } from '@harness-projects/client'
import { FaultKind, createFakeProviders, injectFakeStorageState } from '@harness-projects/provider-fake'

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

function clientFor(options = {}) {
  const store = createEntityStore()
  return { store, sync: createSync(store, options) }
}

/** 投影的可比较指纹：身份、状态、新鲜度、修订与 stale 都要逐字一致。 */
const projectionOf = (store) => store.list().map((entry) => [
  entry.entityId, entry.entity.planningStatus, entry.entity.source.freshness, entry.revision, entry.stale,
].join(':')).sort()

test('client：基线 N → 按 N 订阅 → 按序应用 delta，实体身份稳定（issue #79）', async () => {
  const { controller } = await compose()
  const snapshot = await controller.baseline()
  const target = openWorkItem(snapshot)
  const { store, sync } = clientFor()

  const base = sync.receive({ kind: 'baseline', baseline: snapshot })
  const watch = controller.watch({ afterRevision: snapshot.revision, seed: snapshot })
  assert.equal(base.kind, 'baseline')
  assert.equal(base.revision, snapshot.revision)
  assert.equal(store.isCurrent(target.entityId), true)

  const entry = store.get(target.entityId)
  await writeStatus(controller, target, 'blocked', 'client-1')
  const report = sync.receive(await watch.poll())
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

  injectFakeStorageState(providers.storage, (data) => ({ ...data, projections: data.projections.filter((projection) => projection.entityId !== target.entityId) }))
  const deletedRevision = await providers.storage.advanceRevision(first.workspace.id)
  const watch = controller.watch({ afterRevision: beforeDelete.revision, seed: beforeDelete })
  const event = await watch.poll()

  assert.equal(deletedRevision, beforeDelete.revision + 1)
  assert.equal(event.kind, 'delta')
  assert.equal(event.delta.revision, deletedRevision, '删除后仍使用工作区修订号')
  assert.deepEqual(event.delta.removed, [target.entityId], '订阅方必须识别实体消失')
  assert.ok(event.delta.revision >= beforeDelete.revision, '工作区修订号不得倒退')
})

test('client：错过增量时检测缺口，再接受重开基线，缺口期间旧值不是当前值（issue #79）', async () => {
  const { controller } = await compose()
  const snapshot = await controller.baseline()
  const target = openWorkItem(snapshot)
  const observed = []
  const { store, sync } = clientFor({
    onGap: (gap, current) => observed.push({
      reason: gap.reason, stale: current.get(target.entityId).stale, current: current.isCurrent(target.entityId),
    }),
  })
  sync.receive({ kind: 'baseline', baseline: snapshot })
  const watch = controller.watch({ afterRevision: snapshot.revision, seed: snapshot, retain: 1 })
  await writeStatus(controller, target, 'blocked', 'gap-1')
  await writeStatus(controller, target, 'in_progress', 'gap-2')

  const report = sync.receive(await watch.poll())
  assert.equal(report.kind, 'gap', '落后于保留窗口时必须判定缺口')
  assert.equal(report.revision, snapshot.revision, '缺口保留当前修订，等待消费者重开宿主流')
  assert.equal(observed.length, 1, '缺口只报告一次')
  assert.equal(observed[0].stale, true, '重拉前的旧值必须标记 stale')
  assert.equal(observed[0].current, false, 'stale 值不得被当成当前值')
  sync.receive({ kind: 'baseline', baseline: await controller.baseline() })
  assert.equal(store.isCurrent(target.entityId), true, '新基线恢复为当前值')
  assert.equal(store.get(target.entityId).entity.planningStatus, 'in_progress')
})

test('client：重连后的投影与全新客户端一致（issue #79）', async () => {
  const { controller } = await compose()
  const target = openWorkItem(await controller.baseline())
  const { store, sync } = clientFor()
  const snapshot = await controller.baseline()
  sync.receive({ kind: 'baseline', baseline: snapshot })
  const watch = controller.watch({ afterRevision: snapshot.revision, seed: snapshot })
  await writeStatus(controller, target, 'blocked', 'reconnect-1')
  assert.equal(sync.receive(await watch.poll()).kind, 'delta')
  await writeStatus(controller, target, 'in_progress', 'reconnect-2')

  sync.disconnect()
  sync.receive({ kind: 'baseline', baseline: await controller.baseline() })
  const fresh = clientFor()
  fresh.sync.receive({ kind: 'baseline', baseline: await controller.baseline() })
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

const stateOf = (sync, store, calls) => structuredClone({ read: sync.read() && { ...sync.read(), store: undefined }, rows: store.list(), revision: sync.revision, connected: sync.connected, calls: calls() })

test('重建 Host 以真实 generation 接受较低 revision，同 Core wrappers 保持 generation', async (t) => {
  const first = await compose(), original = await first.controller.baseline()
  const secondCore = await composeCore({ workspace: { id: original.workspace.id, name: 'rebuilt' }, providers: createFakeProviders() })
  const rebuilt = createController(secondCore), next = await rebuilt.baseline()
  assert.equal(typeof original.generation, 'string'); assert.ok(original.generation.length > 0)
  assert.equal((await createController(first.core).baseline()).generation, original.generation)
  assert.notEqual(next.generation, original.generation)
  await first.providers.storage.advanceRevision(original.workspace.id)
  const { sync } = clientFor()
  sync.receive({ kind: 'baseline', baseline: await first.controller.baseline() }); assert.ok(sync.revision > next.revision)
  sync.disconnect()
  sync.receive({ kind: 'baseline', baseline: next }); assert.equal(sync.revision, next.revision); assert.equal(sync.read().workspace.name, 'rebuilt')
})

test('generation 是 required opaque string；坏 baseline 和跨代 delta/metadata 在 clock 前原子拒绝', async (t) => {
  const { controller } = await compose(), base = await controller.baseline()
  let calls = 0
  const store = createEntityStore(), sync = createSync(store, { clock: () => { calls++; return '2026-10-28T00:00:00Z' } })
  const empty = stateOf(sync, store, () => calls)
  for (const generation of [undefined, 1, '', ' ']) {
    assert.throws(() => sync.receive({ kind: 'baseline', baseline: { ...base, generation } }), /generation/)
    assert.deepEqual(stateOf(sync, store, () => calls), empty)
  }
  sync.receive({ kind: 'baseline', baseline: base })
  const before = stateOf(sync, store, () => calls)
  for (const kind of ['delta', 'metadata']) {
    const frame = { ...base, generation: 'other-host', previousRevision: base.revision, revision: kind === 'delta' ? base.revision + 1 : base.revision, upserts: [], removed: [], entities: base.entities.map(({ entityId, source }) => ({ entityId, source })) }
    assert.throws(() => sync.receive({ kind, [kind]: frame }), /generation/)
    assert.deepEqual(stateOf(sync, store, () => calls), before)
  }
})
