/**
 * 交付谱系条与真实 core 互通（issue #357，ADR-0011 第 3 条）：全部离线，provider 是内存替身，时钟固定。手写 fixture 能让合约测试通过，不证明它和 core
 * 真正产出的投影同形状——这里用 `composeCore` + `createFakeProviders()` 走真实的开始工作、刷新与读投影，再对同一条链断言谱系条。
 * 保护：未刷新的四个集合位置是缺口、命令位置已观察（E1）；确认后的 passed 随年龄在阈值处消失、陈旧集合不派生 passed（E1）；
 * 刷新没能重新确认的集合是 stale、其余集合不受牵连（E2）。「年龄只认 confirmedAt、不认 attemptedAt」不在这里证明：真实写者不会产出
 * 「集合没标陈旧、attemptedAt 新而 confirmedAt 旧」的投影，端到端无从区分两个年龄来源，由合约测试 A4 的合成投影钉住（E2 里 attemptedAt 领先只是前置观察）。
 */
import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { newWorkspaceId } from '@harness-projects/domain'
import { composeCore } from '@harness-projects/core'
import { createFakeProviders, refOf } from '@harness-projects/provider-fake'
import { DELIVERY_FRESHNESS_THRESHOLD_MS, deriveDeliveryLineageStrip } from '@harness-projects/ui-model'

const T0 = '2026-10-21T07:00:00.000Z'
const REPOSITORY = 'repo-alpha'
const MINUTE_1 = 60_000
const at = (ms) => new Date(Date.parse(T0) + ms).toISOString()
const SET_POSITIONS = ['commit', 'change_request', 'pipeline_run', 'check_run']

/** 走完 工作项 → 执行上下文 → 分支/工作树 → 变更请求 的真实链路（搭法同 tests/e2e/delivery-lineage.test.js 的 `startChain`），时钟固定在 T0，尚未刷新。 */
async function startChain(key) {
  const providers = createFakeProviders()
  const core = await composeCore({ workspace: { id: newWorkspaceId(), name: 'MVP-0' }, providers, clock: () => T0 })
  const item = (await core.queries.listPlanningItems()).find((view) => view.kind === 'work_item' && view.content.contentKind === 'work_item')
  assert.ok(item, 'planning 种子里必须至少有一个工作项')
  const started = await core.commands.startWork({ repositoryId: REPOSITORY, actor: { kind: 'agent' }, workItemId: item.entityId, idempotencyKey: key })
  assert.equal(started.confirmed, true, 'git 步骤拿到 provider ack 才算链路推进')
  const created = await providers.development.createChangeRequest({
    repository: refOf(providers.development.gate.bindingId, 'repository', REPOSITORY), head: started.branchExternalId, base: 'main', title: '谱系条占位', body: '占位正文' })
  assert.equal(created.ok, true, '变更请求必须创建成功')
  const scope = { workItemId: item.entityId, repositoryId: REPOSITORY }
  return { providers, core, scope, strip: async (now) => deriveDeliveryLineageStrip(await core.queries.getDeliveryProjection(scope), now) }
}
const slot = (strip, position) => strip.slots.find((entry) => entry.position === position)
const states = (strip, position) => slot(strip, position).nodes.map((node) => node.state)

test('E1 真实投影：刷新前四个集合位置是 not_refreshed 缺口；确认后 passed 在阈值前存在、在阈值处消失，四个集合位置一并 stale', async () => {
  const { core, scope, strip } = await startChain('strip-e1')
  const before = await strip(at(MINUTE_1))
  assert.deepEqual(before.slots.filter((entry) => entry.kind === 'gap').map((entry) => [entry.position, entry.reason]), SET_POSITIONS.map((position) => [position, 'not_refreshed']))
  assert.deepEqual([states(before, 'execution_context'), states(before, 'worktree')], [['observed'], ['observed']], '命令位置在刷新前就是已观察')
  assert.equal(slot(before, 'worktree').nodes[0].label !== undefined, true, '工作树节点的标签是分支名')

  assert.equal((await core.commands.refreshDeliveryFacts(scope)).ok, true)
  const projection = await core.queries.getDeliveryProjection(scope)
  assert.ok(projection.hops.filter((hop) => SET_POSITIONS.includes(hop.entityKind)).every((hop) => hop.relationSource === 'deterministic' && hop.relationState === 'candidate'))
  assert.ok(projection.hops.filter((hop) => !SET_POSITIONS.includes(hop.entityKind)).every((hop) => hop.relationSource === 'explicit' && hop.relationState === 'confirmed'))
  const fresh = await strip(at(MINUTE_1))
  for (const position of SET_POSITIONS) assert.ok(slot(fresh, position).nodes.every((node) => node.relationState === 'candidate'), `${position} 候选不能伪装 confirmed`)
  assert.ok(slot(fresh, 'pipeline_run').nodes.some((node) => node.state === 'passed' && node.relationState === 'candidate'), '通过是 CI 事实，不确认关系')
  assert.ok(states(fresh, 'pipeline_run').includes('passed') && states(fresh, 'pipeline_run').includes('unknown'), `流水线 ${states(fresh, 'pipeline_run')}`)
  assert.ok(states(fresh, 'check_run').includes('passed'), `检查 ${states(fresh, 'check_run')}`)
  assert.ok((await strip(at(DELIVERY_FRESHNESS_THRESHOLD_MS - 1))).slots.some((entry) => entry.kind === 'nodes' && entry.nodes.some((node) => node.state === 'passed')), '阈值减 1 ms 仍有 passed')

  const expired = await strip(at(DELIVERY_FRESHNESS_THRESHOLD_MS))
  assert.deepEqual(expired.slots.flatMap((entry) => entry.kind === 'nodes' ? entry.nodes.map((node) => node.state) : []).filter((state) => state === 'passed'), [], '年龄等于阈值：没有任何 passed')
  for (const position of SET_POSITIONS) assert.ok(states(expired, position).length > 0 && states(expired, position).every((state) => state === 'stale'), `${position}：${states(expired, position)}`)
  assert.deepEqual([states(expired, 'execution_context'), states(expired, 'worktree')], [['observed'], ['observed']], '命令位置不过年龄规则')
})

test('E2 真实投影：流水线读失败的刷新把流水线集合标 stale，检查集合照常确认', async () => {
  const { providers, core, scope } = await startChain('strip-e2')
  await core.commands.refreshDeliveryFacts(scope)
  providers.delivery.listPipelineRuns = async () => ({ ok: false, error: { code: 'unavailable', message: 'pipeline read failed' } })
  await core.commands.refreshDeliveryFacts(scope)
  const projection = await core.queries.getDeliveryProjection(scope)
  const pipeline = projection.freshness.find((entry) => entry.kind === 'pipeline_run')
  assert.deepEqual([pipeline.stale, projection.attemptedAt > pipeline.confirmedAt], [true, true], '前置观察：流水线集合标陈旧，且 attemptedAt 晚于它的 confirmedAt（不证明年龄来源，见文件头）')
  const derived = deriveDeliveryLineageStrip(projection, at(MINUTE_1))
  assert.ok(states(derived, 'pipeline_run').length > 0 && states(derived, 'pipeline_run').every((state) => state === 'stale'), `流水线 ${states(derived, 'pipeline_run')}`)
  assert.ok(states(derived, 'check_run').includes('passed'), `检查集合照常确认：${states(derived, 'check_run')}`)
})
