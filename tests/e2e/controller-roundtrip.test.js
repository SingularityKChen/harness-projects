/**
 * Batch C5 端到端：controller 类型化 API 与增量流（issue #79 / ExecPlan Batch C5）。
 *
 * 全部使用离线替身：无凭据、无网络。用例名说明它保护哪条不变量：wire 层只传内部对象（ExecPlan D7）、
 * provider 确认前不得报告为"已保存"（AGENTS.md §1.1 硬约束）、同键重放返回原结果（D3）、落后太多时发
 * 缺口而不是静默续传（issue #79 验收）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { StatusPolicyMode, composeCore } from '@harness-projects/core'
import { CommandWriteState, createController, isAuthoritativeWriteState } from '@harness-projects/controller'
import { FaultKind, createFakeProviders, exportFakeStorageState } from '@harness-projects/provider-fake'

const REPOSITORY = 'repo-alpha'

async function compose(mode = StatusPolicyMode.HarnessManaged) {
  const providers = createFakeProviders()
  const policy = mode === StatusPolicyMode.SourceManaged ? StatusPolicy.ProviderAuthoritative : StatusPolicy.HostAuthoritative
  const core = await composeCore({
    workspace: { id: newWorkspaceId(), name: 'MVP-0', statusPolicy: policy }, providers,
  })
  return { core, controller: createController(core, { authority: mode }) }
}

const openWorkItems = (snapshot) =>
  snapshot.entities.filter((entity) => entity.content.contentKind === 'work_item' && entity.planningStatus !== 'done')
const openWorkItem = (snapshot) => openWorkItems(snapshot)[0]

/** 交付用例：不带状态策略组合，并交回替身，用例要往里注入故障；`clock` 给要断言确认时刻的用例。 */
async function composeDelivery(clock) {
  const providers = createFakeProviders()
  const core = await composeCore({ workspace: { id: newWorkspaceId(), name: 'MVP-0' }, providers, ...(clock === undefined ? {} : { clock }) })
  return { providers, controller: createController(core) }
}

const writeStatus = (controller, target, status, idempotencyKey) => controller.commands.applyPlanningStatus({
  entityId: target.entityId, status, actorRef: { kind: 'user', id: 'user-1' }, idempotencyKey,
})

test('wire：快照只承载内部对象，并说明新鲜度与权威归属（issue #79 / ExecPlan D7）', async () => {
  const { controller } = await compose()
  const snapshot = await controller.baseline()
  assert.ok(snapshot.revision > 0, '引导后修订号必须前进')
  assert.equal(snapshot.source.authority, 'host', '宿主权威工作区的归属必须是 host')
  assert.equal(snapshot.source.freshness, 'fresh')
  assert.equal(snapshot.workspace.name, 'MVP-0', '整表头带已确认的工作区 descriptor')
  assert.ok(snapshot.capabilities.length > 0, '整表头带逐 key 能力')
  assert.ok(snapshot.entities.length > 0, '引导后必须有可消费的实体')
  for (const entity of snapshot.entities) {
    assert.equal(entity.source.revision, snapshot.revision, '首次引导把所有投影落在同一修订上')
    assert.deepEqual(
      Object.keys(entity.content).sort(),
      ['bindingId', 'body', 'contentKind', 'externalId', 'externalKind', 'title'],
      '内容引用只能是内部对象，不得出现 provider 原生结构',
    )
    assert.ok(!('provider' in entity) && !('ref' in entity), 'wire 实体不得携带 provider 实例或原生 ref')
  }
})

test('命令：同键重放返回原结果，且取不到乐观 saved（ExecPlan D3）', async () => {
  const { controller } = await compose()
  const target = openWorkItem(await controller.baseline())
  const input = {
    workItemId: target.entityId, repositoryId: REPOSITORY,
    actorRef: { kind: 'agent', id: 'agent-1' }, idempotencyKey: 'controller-roundtrip-1',
  }
  const first = await controller.commands.startWork(input)
  const replay = await controller.commands.startWork(input)
  assert.equal(first.writeState, CommandWriteState.Confirmed, '离线替身给出 ack 之后才允许 confirmed')
  assert.equal(isAuthoritativeWriteState(first.writeState), first.authoritative)
  assert.equal(replay.writeState, first.writeState, '同键重放必须返回首次尝试的写状态')
  assert.equal(replay.value.executionContextId, first.value.executionContextId, '重放不得产生第二份执行上下文')
  assert.equal(first.value.branchHeadCommit, 'sha-1', '视图必须带出 core 结果面的分支头提交（只做报告，D5）')
  assert.ok(first.value.runExternalId !== undefined, '视图带出已 ack 的 run 句柄：Unknown 时客户端靠它对账（TD-013）')
  assert.equal(replay.value.runExternalId, first.value.runExternalId, '重放带回同一个 run 句柄')
  assert.ok(!Object.values(CommandWriteState).includes('saved'), 'wire 写状态里不得有乐观的 saved')
})

test('命令：provider 权威拒绝显式写入，宿主权威写入报 local_only（ExecPlan D6）', async () => {
  for (const mode of [StatusPolicyMode.SourceManaged, StatusPolicyMode.HarnessManaged]) {
    const { controller } = await compose(mode)
    const target = openWorkItem(await controller.baseline())
    const result = await writeStatus(controller, target, 'blocked', `status-${mode}`)
    const expected = mode === StatusPolicyMode.SourceManaged ? CommandWriteState.Failed : CommandWriteState.LocalOnly
    assert.equal(result.writeState, expected, `${mode} 下的显式状态写入`)
    assert.notEqual(result.writeState, 'saved')
    assert.equal(result.authoritative, false, '本地规划写入没有 provider ack，不得报告为权威')
  }
})

test('watch：按修订增量；落后超出保留窗口发 gap 而不是静默续传（issue #79）', async () => {
  const { controller } = await compose()
  const snapshot = await controller.baseline()
  const target = openWorkItem(snapshot)
  const watch = controller.watch({ afterRevision: snapshot.revision, seed: snapshot, retain: 1 })

  await writeStatus(controller, target, 'blocked', 'watch-1')
  const delta = await watch.poll()
  assert.equal(delta.kind, 'delta', '连续一跳必须给出增量而不是缺口')
  assert.equal(delta.delta.previousRevision, snapshot.revision)
  assert.equal(delta.delta.revision, snapshot.revision + 1)
  assert.equal(delta.delta.upserts.length, 1, '只有被写的那条投影发生变化')
  assert.equal(delta.delta.upserts[0].planningStatus, 'blocked')
  assert.deepEqual([delta.delta.workspace, delta.delta.source.revision], [snapshot.workspace, delta.delta.revision], 'delta 携带最新整表头')

  await writeStatus(controller, target, 'in_progress', 'watch-2')
  await writeStatus(controller, target, 'todo', 'watch-3')
  const gap = await watch.poll()
  assert.equal(gap.kind, 'gap', '落后两个修订且保留窗口为 1 时必须报缺口')
  assert.equal(gap.gap.requestedAfter, snapshot.revision + 1, '缺口后游标不得前进')
  assert.equal(watch.afterRevision, snapshot.revision + 1, '订阅者必须从原位重拉基线')
})

test('watch：没有订阅点快照时不静默续传，直接报缺口（issue #79）', async () => {
  const { controller } = await compose()
  const snapshot = await controller.baseline()
  const target = openWorkItem(snapshot)
  await writeStatus(controller, target, 'blocked', 'noseed-1')
  const watch = controller.watch({ afterRevision: snapshot.revision, retain: 4 })
  const event = await watch.poll()
  assert.equal(event.kind, 'gap', '缺少订阅点快照时只能重拉基线')
  assert.match(event.gap.reason, /快照/)
})

test('交付：刷新命令报 local_only，查询原样转发陈旧、降级、新鲜度与缺口；刷新天然幂等，不重放（#222）', async () => {
  let now = '2026-10-09T00:00:00.000Z'
  const { providers, controller } = await composeDelivery(() => now)
  const target = openWorkItem(await controller.baseline())
  const actorRef = { kind: 'agent', id: 'agent-1' }
  await controller.commands.startWork({ workItemId: target.entityId, repositoryId: REPOSITORY, actorRef, idempotencyKey: 'delivery-start-1' })
  const scope = { workItemId: target.entityId, repositoryId: REPOSITORY }
  const refreshed = await controller.commands.refreshDeliveryFacts(scope, { actorRef })
  assert.equal(refreshed.writeState, CommandWriteState.LocalOnly, '刷新只写本地已确认事实，没有外部写入')
  assert.equal(isAuthoritativeWriteState(refreshed.writeState), false, '本地事实不是权威确认')
  const again = await controller.commands.refreshDeliveryFacts(scope, { actorRef })
  assert.ok(again !== refreshed && again.value.applied, '天然幂等：同一请求再调一次真的重新读取并提交，不重放首次的结果')
  const first = now
  now = '2026-10-09T00:05:00.000Z'
  providers.delivery.faultsSwitch.set(FaultKind.Offline, true)
  await controller.commands.refreshDeliveryFacts(scope, { actorRef })
  const projection = await controller.queries.getDeliveryProjection(scope)
  assert.equal(projection.degraded, true, 'Delivery 离线：陈旧集合让投影降级')
  const committed = exportFakeStorageState(providers.storage).deliveryFacts[0]
  assert.equal(projection.attemptedAt, committed.attemptedAt, '最近一次被应用的刷新的时刻原样转发')
  const freshness = (kind) => projection.freshness.find((set) => set.kind === kind)
  assert.deepEqual([freshness('commit').stale, freshness('commit').confirmedAt], [false, now], 'Development 在线：提交集合被这次刷新重新确认，确认时刻是这次读取开始时的墙钟读数')
  assert.deepEqual([freshness('pipeline_run').stale, freshness('pipeline_run').confirmedAt], [true, first], 'Delivery 离线：流水线集合保留上次确认的时刻并标陈旧')
  const pipelines = projection.hops.filter((hop) => hop.entityKind === 'pipeline_run')
  assert.ok(pipelines.length > 0 && pipelines.every((hop) => hop.stale), '流水线跳是最后确认的值，逐跳标陈旧')
  assert.deepEqual(projection.gaps.map((gap) => gap.entityKind), ['change_request', 'check_run'], '没有创建变更请求：缺口逐位置转发')
})

test('交付：刷新命令的结果会原样到达 wire，provider 的错误文字与没有读到任何东西的刷新都不冒充成功读取（#222、K2）', async () => {
  const { providers, controller } = await composeDelivery()
  const items = openWorkItems(await controller.baseline())
  const actorRef = { kind: 'agent', id: 'agent-1' }
  const started = await controller.commands.startWork({ workItemId: items[0].entityId, repositoryId: REPOSITORY, actorRef, idempotencyKey: 'wire-start-1' })
  assert.equal(started.writeState, CommandWriteState.Confirmed)
  providers.delivery.listPipelineRuns = async () => ({ ok: false, error: { code: 'unavailable', message: 'RAW-PROVIDER-TEXT token=SECRET-VALUE /secret/path' } })
  const outage = await controller.commands.refreshDeliveryFacts({ workItemId: items[0].entityId, repositoryId: REPOSITORY }, { actorRef })
  assert.deepEqual(outage.value.gaps, [{ key: 'delivery.pipeline.read' }], '缺口只带能力键')
  assert.ok(!JSON.stringify(outage).includes('RAW-PROVIDER-TEXT'), 'provider 的错误文字（可能带路径或令牌）不得进入 wire')
  // writeState 只说明没有外部写入、本地没有失败（local_only）；是否真的提交了新事实看 value.applied / anchored / gaps。
  const noop = await controller.commands.refreshDeliveryFacts({ workItemId: items[1].entityId, repositoryId: REPOSITORY }, { actorRef })
  assert.deepEqual([noop.writeState, noop.value], [CommandWriteState.LocalOnly, { ok: true, anchored: false, applied: false, gaps: [], error: undefined }], '没开始工作的工作项：什么也没读也没写，调用方要读 value 才知道')
})

test('交付：刷新命令不进重放账本，同一请求两次都真的刷新，换作用域各读各的（#222）', async () => {
  const { controller } = await composeDelivery()
  const items = openWorkItems(await controller.baseline())
  const actorRef = { kind: 'agent', id: 'agent-1' }
  await controller.commands.startWork({ workItemId: items[0].entityId, repositoryId: REPOSITORY, actorRef, idempotencyKey: 'scope-start-1' })
  const [started, idle] = [{ workItemId: items[0].entityId, repositoryId: REPOSITORY }, { workItemId: items[1].entityId, repositoryId: REPOSITORY }]
  const first = await controller.commands.refreshDeliveryFacts(started, { actorRef })
  const other = await controller.commands.refreshDeliveryFacts(idle, { actorRef })
  assert.deepEqual([first.value.anchored, other.value.anchored], [true, false], '另一个作用域是另一次读取')
  const sibling = await controller.commands.refreshDeliveryFacts({ workItemId: items[0].entityId, repositoryId: 'repo-beta' }, { actorRef })
  assert.equal(sibling.value.anchored, false, '同一个工作项、另一个仓库也是另一个作用域：那个仓库里这个工作项没有开始工作')
  const stamp = async () => (await controller.queries.getDeliveryProjection(started)).attemptedAt
  const before = await stamp()
  const repeated = await controller.commands.refreshDeliveryFacts(started, { actorRef })
  assert.ok(repeated !== first && repeated.value.applied && (await stamp()) > before, '同一请求再调一次：重新读取并提交，attemptedAt 前移，不返回首次的结果')
})

test('交付：字符串作用域、{ workItemId } 与 { workItemId, repositoryId: undefined } 归一成同一个作用域，刷新与读取都一致；整个作用域缺失是结构化失败（#222）', async () => {
  const { controller } = await composeDelivery()
  const [item] = openWorkItems(await controller.baseline())
  const actorRef = { kind: 'agent', id: 'agent-1' }
  const forms = [item.entityId, { workItemId: item.entityId }, { workItemId: item.entityId, repositoryId: undefined }]
  const results = await Promise.all(forms.map((scope) => controller.commands.refreshDeliveryFacts(scope, { actorRef })))
  assert.deepEqual([results[0].writeState, results[0].value.ok, results[0].value.error], ['local_only', true, undefined], '字符串作用域先归一成 { workItemId }：没开始工作是 local_only，不是 invalid_input')
  assert.deepEqual(results.slice(1), [results[0], results[0]], '三种写法的刷新结果相同')
  const projections = await Promise.all(forms.map((scope) => controller.queries.getDeliveryProjection(scope)))
  assert.deepEqual(projections.slice(1), [projections[0], projections[0]], '三种写法读到同一个投影')
  for (const missing of [undefined, null]) {
    const result = await controller.commands.refreshDeliveryFacts(missing, { actorRef })
    assert.deepEqual([result.writeState, result.value.ok, result.error?.code], ['failed', false, 'invalid_input'], `作用域为 ${missing}：同步抛出的 TypeError 不是结构化结果`)
  }
})

test('交付：core 不可用时刷新命令报 failed，查询带结构化错误且新增字段为空（#222）', async () => {
  const providers = createFakeProviders()
  const core = await composeCore({ workspace: { id: newWorkspaceId(), name: 'MVP-0' }, providers: { ...providers, storage: undefined } })
  const controller = createController(core)
  const scope = { workItemId: 'work-1', repositoryId: REPOSITORY }
  const refreshed = await controller.commands.refreshDeliveryFacts(scope, { actorRef: { kind: 'user', id: 'user-1' } })
  assert.deepEqual([refreshed.writeState, refreshed.error?.code], [CommandWriteState.Failed, 'not_supported'], '没有 storage 绑定：刷新失败，不报 local_only')
  const projection = await controller.queries.getDeliveryProjection(scope)
  assert.deepEqual([projection.degraded, projection.error?.code, projection.attemptedAt, projection.freshness, projection.gaps], [true, 'not_supported', undefined, [], []])
  assert.equal((await core.queries.getDeliveryProjection(undefined)).error?.code, 'not_supported', '作用域缺失也经 normalizeScope，不抛 TypeError')
})
