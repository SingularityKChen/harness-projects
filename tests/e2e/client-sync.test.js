/**
 * Batch C5 端到端：React-free 客户端同步（issue #79）。
 *
 * 用例名说明它保护哪条不变量：基线修订 N 之后按序应用增量、实体身份稳定、错过增量必须检测缺口并重拉
 * 基线、重连后的投影与全新客户端一致、陈旧值永远不被当成当前值。全部使用离线替身：无凭据、无网络。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { StatusPolicyMode, composeCore } from '@harness-projects/core'
import { createController } from '@harness-projects/controller'
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
