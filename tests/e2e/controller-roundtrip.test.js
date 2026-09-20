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
import { createFakeProviders } from '@harness-projects/provider-fake'

const REPOSITORY = 'repo-alpha'

async function compose(mode = StatusPolicyMode.HarnessManaged) {
  const providers = createFakeProviders()
  const policy = mode === StatusPolicyMode.SourceManaged ? StatusPolicy.ProviderAuthoritative : StatusPolicy.HostAuthoritative
  const core = await composeCore({
    workspace: { id: newWorkspaceId(), name: 'MVP-0', statusPolicy: policy }, providers,
  })
  return { core, controller: createController(core, { authority: mode }) }
}

const openWorkItem = (snapshot) =>
  snapshot.entities.find((entity) => entity.content.contentKind === 'work_item' && entity.planningStatus !== 'done')

const writeStatus = (controller, target, status, idempotencyKey) => controller.commands.applyPlanningStatus({
  entityId: target.entityId, status, actorRef: { kind: 'user', id: 'user-1' }, idempotencyKey,
})

test('wire：快照只承载内部对象，并说明新鲜度与权威归属（issue #79 / ExecPlan D7）', async () => {
  const { controller } = await compose()
  const snapshot = await controller.baseline()
  assert.ok(snapshot.revision > 0, '引导后修订号必须前进')
  assert.equal(snapshot.source.authority, 'host', '宿主权威工作区的归属必须是 host')
  assert.equal(snapshot.source.freshness, 'fresh')
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
