/**
 * Batch C4 端到端：交付谱系（issue #78 / ExecPlan D5、D6）。全部离线：无凭据、无网络，provider 由
 * 测试层装配（ExecPlan D1）。
 *
 * 用例名说明它保护哪条不变量：每一跳都是带显式 provenance 的关系且沿谱系传播（不变量 6）；确定性
 * 发现的关系先进候选、只有显式确认才升级；缺可选能力报 unavailable 而不是 error；只读交付方的写
 * 尝试返回 not supported 且不改任何状态。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RelationSource, RelationState, newWorkspaceId } from '@harness-projects/domain'
import { composeCore } from '@harness-projects/core'
import { createFakeProviders, exportFakeStorageState, refOf } from '@harness-projects/provider-fake'

const WORKSPACE = { id: newWorkspaceId(), name: 'MVP-0' }
const REPOSITORY = 'repo-alpha'
const REQUEST = { repositoryId: REPOSITORY, actor: { kind: 'agent' } }
const CHAIN_TYPES = ['tracks', 'has_worktree', 'derived_from', 'produced_by', 'runs_on']

const compose = (providers) => composeCore({ workspace: WORKSPACE, providers })

async function workItemIdOf(core) {
  const item = (await core.queries.listPlanningItems()).find((view) => view.kind === 'work_item')
  assert.ok(item, 'planning 种子里必须至少有一个工作项')
  return item.entityId
}

/** 走完 工作项 → 执行上下文 → 分支/工作树 → 提交 → 变更请求 的真实链路。 */
async function startChain(providers, core, idempotencyKey) {
  const workItemId = await workItemIdOf(core)
  const started = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey })
  assert.equal(started.confirmed, true, 'git 步骤拿到 provider ack 才算链路推进')
  const created = await providers.development.createChangeRequest({
    repository: refOf(providers.development.gate.bindingId, 'repository', REPOSITORY),
    head: started.branchExternalId, base: 'main', title: '交付谱系占位', body: '占位正文',
  })
  assert.equal(created.ok, true, '变更请求必须创建成功')
  return { workItemId, started, scope: { workItemId, repositoryId: REPOSITORY } }
}

test('交付谱系：每一跳都是带显式 provenance 的关系，且按已记录身份传播（不变量 6）', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers)
  const chain = await startChain(providers, core, 'lineage-full-1')
  const before = await planningSnapshot(core)
  const hops = await core.queries.getDeliveryLineage(chain.scope)
  const types = new Set(hops.map((hop) => hop.relationType))
  for (const expected of CHAIN_TYPES) assert.ok(types.has(expected), `谱系缺少 ${expected} 跳，实际只有 ${[...types]}`)
  assert.ok(hops.every((hop) => hop.source === RelationSource.Lineage), '谱系跳必须标记为 lineage 来源')
  assert.ok(
    hops.every((hop) => hop.provenance !== undefined && hop.relationSource !== undefined && hop.relationState !== undefined),
    '每一跳都要带显式 provenance（来源 + 确认态 + 建立方式）',
  )
  const contextHop = hops.find((hop) => hop.relationType === 'tracks')
  assert.equal(contextHop.to, chain.started.executionContextId, '上下文跳必须回指 startWork 返回的同一个 id，不重新识别')
  const worktreeHop = hops.find((hop) => hop.relationType === 'has_worktree')
  assert.equal(worktreeHop.externalId, chain.started.worktreeExternalId, '工作树跳必须回指已建工作树')
  assert.equal(worktreeHop.relationState, RelationState.Confirmed, '命令确认的系统事实是已确认边')
  const commitHop = hops.find((hop) => hop.entityKind === 'commit')
  assert.ok(commitHop.observed && typeof commitHop.externalId === 'string', '提交必须由 provider 读到')
  const ciHop = hops.find((hop) => hop.relationType === 'runs_on')
  assert.equal(ciHop.relationState, RelationState.Candidate, 'provider 读到的确定性事实只能先进候选')
  assert.equal(await planningSnapshot(core), before, '读交付谱系不得改写规划状态')
})

test('候选关系：确定性发现先进候选，显式确认才升级，同一三元组不重复（issue #78）', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers)
  const chain = await startChain(providers, core, 'lineage-candidate-1')
  const first = await core.queries.getDeliveryLineage(chain.scope)
  const discovered = first.find((hop) => hop.relationType === 'derived_from')
  assert.equal(discovered.relationState, RelationState.Candidate, '确定性发现的边必须先是候选')
  const stored = () => providers.storage.listRelations(WORKSPACE.id)
  const recorded = (await stored()).find(
    (relation) => relation.from === discovered.from && relation.to === discovered.to && relation.type === discovered.relationType,
  )
  assert.equal(recorded.state, RelationState.Candidate, '候选边未确认前不得被读成已确认关系')
  const countBefore = (await stored()).length
  await core.queries.getDeliveryLineage(chain.scope)
  assert.equal((await stored()).length, countBefore, '重复读取不得产生第二个三元组')
  const confirmed = await core.commands.confirmRelation({
    from: discovered.from, to: discovered.to, type: discovered.relationType,
  })
  assert.equal(confirmed.relation.state, RelationState.Confirmed, '显式确认必须把候选升级为已确认')
  assert.equal(confirmed.created, false, '确认复用既有边，不新建关系')
  const reread = (await core.queries.getDeliveryLineage(chain.scope)).find((hop) => hop.relationType === 'derived_from')
  assert.equal(reread.relationState, RelationState.Confirmed, '确认后读回才是已确认')
  assert.equal(reread.source, RelationSource.Lineage, '确认不改变跳的谱系来源')
})

test('缺可选能力：部署与环境报 unavailable 而不是 error（ExecPlan D5）', async () => {
  const providers = createFakeProviders({ delivery: { capabilities: { deployments: false } } })
  const core = await compose(providers)
  const workItemId = await workItemIdOf(core)
  const projection = await core.queries.getDeliveryProjection({ workItemId, repositoryId: REPOSITORY })
  assert.equal(projection.error, undefined, '缺可选能力不是错误')
  const deployment = projection.optional.find((entry) => entry.key === 'delivery.deployment.read')
  assert.equal(deployment.available, false, '未声明的可选能力必须报 unavailable')
  assert.ok(typeof deployment.reason === 'string' && deployment.reason.length > 0, '不可用必须带可回答的原因')
  assert.ok(projection.hops.some((hop) => hop.relationType === 'runs_on'), '必读能力仍在，CI 跳仍可查询')
})

test('只读交付方：改流水线请求返回 not supported 且不改任何状态（issue #78）', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers)
  const providerState = JSON.stringify(providers.delivery.state)
  const storageState = JSON.stringify(exportFakeStorageState(providers.storage))
  const attempt = await core.commands.rerunPipeline(refOf(providers.delivery.gate.bindingId, 'pipeline_run', 'run-3'))
  assert.equal(attempt.supported, false)
  assert.equal(attempt.confirmed, false, '未支持的写尝试不得报告为已确认')
  assert.notEqual(attempt.writeState, 'saved', '未支持的写尝试不得显示权威已保存')
  assert.equal(attempt.error.code, 'not_supported')
  assert.equal(JSON.stringify(providers.delivery.state), providerState, 'provider 侧状态不得改变')
  assert.equal(JSON.stringify(exportFakeStorageState(providers.storage)), storageState, '本地状态不得改变')
})

async function planningSnapshot(core) {
  return (await core.queries.listPlanningItems()).map((item) => `${item.entityId}:${item.planningStatus}`).sort().join('|')
}
