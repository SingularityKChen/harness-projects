/**
 * Batch C4 端到端：交付谱系（issue #78 / ExecPlan D5、D6）。全部离线：无凭据、无网络，provider 由测试层装配（ExecPlan D1）。用例名说明它保护哪条
 * 不变量：每一跳都是带显式 provenance 的关系且沿谱系传播（不变量 6）；确定性发现的关系先进候选、只有显式确认才升级；未观察过的链路读回 0 跳且本地
 * 不留骨架关系（事实/观察边界）；缺可选能力报 unavailable 而不是 error；只读交付方的写尝试返回 not supported 且不改任何状态。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RelationSource, RelationState, newWorkspaceId } from '@harness-projects/domain'
import { composeCore } from '@harness-projects/core'
import { createFakeProviders, exportFakeStorageState, refOf } from '@harness-projects/provider-fake'

const WORKSPACE = { id: newWorkspaceId(), name: 'MVP-0' }
// 替身按仓库种下流水线运行：负向用例必须用这个有 CI 种子的仓库——若换空仓库，无条件读取同样读不到东西，用例就没有判别力。
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
    head: started.branchExternalId, base: 'main', title: '交付谱系占位', body: '占位正文' })
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
    '每一跳都要带显式 provenance（来源 + 确认态 + 建立方式）')
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

test('负向：锚点未观察时不读 CI 事实，读回 0 跳且本地无 CI 关系（评审 P1 / ExecPlan D4）', async () => {
  const providers = createFakeProviders()
  // composeCore 只做首轮规划水合；此处不调用 bootstrapWorkspace，也不 startWork，链上没有已观察到的提交/变更请求。
  const core = await compose(providers)
  const workItemId = await workItemIdOf(core)
  const scope = { workItemId, repositoryId: REPOSITORY }
  const projection = await core.queries.getDeliveryProjection(scope)
  assert.equal(projection.error, undefined, '查询必须成功：0 跳来自"没有观察"，不是降级或错误')
  assert.equal(projection.hops.length, 0, 'head 未观察到时不得以 commit: undefined 读取整个仓库的流水线')
  assert.equal((await core.queries.getDeliveryLineage(scope)).length, 0, '交付谱系必须同样是 0 跳')
  const relations = exportFakeStorageState(providers.storage).relations
  assert.equal(relations.length, 0, '本地不得落任何 artifact_relation 行：推断出的拓扑不是存储事实')
  assert.equal(relations.filter((relation) => relation.type === 'runs_on').length, 0, '存储里不得出现 CI 关系')
})

test('正向：真实链路走完后 CI 跳出现（无锚点不读不得削弱真实观察）', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers)
  const chain = await startChain(providers, core, 'lineage-positive-ci-1')
  const ci = (await core.queries.getDeliveryLineage(chain.scope)).filter((hop) => hop.relationType === 'runs_on')
  assert.ok(ci.length > 0, '提交被观察到之后必须读到该提交上的流水线运行')
  assert.ok(ci.every((hop) => hop.observed === true && typeof hop.externalId === 'string'), 'CI 跳必须是真实观察到的运行')
})

test('候选关系：确定性发现先进候选，显式确认才升级，同一三元组不重复（issue #78）', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers)
  const chain = await startChain(providers, core, 'lineage-candidate-1')
  const first = await core.queries.getDeliveryLineage(chain.scope)
  const discovered = first.find((hop) => hop.relationType === 'derived_from')
  assert.equal(discovered.relationState, RelationState.Candidate, '确定性发现的边必须先是候选')
  const stored = () => providers.storage.listRelations(WORKSPACE.id)
  const recorded = (await stored()).find((relation) =>
    relation.from === discovered.from && relation.to === discovered.to && relation.type === discovered.relationType)
  assert.equal(recorded.state, RelationState.Candidate, '候选边未确认前不得被读成已确认关系')
  const countBefore = (await stored()).length
  await core.queries.getDeliveryLineage(chain.scope)
  assert.equal((await stored()).length, countBefore, '重复读取不得产生第二个三元组')
  const confirmed = await core.commands.confirmRelation({ from: discovered.from, to: discovered.to, type: discovered.relationType })
  assert.equal(confirmed.relation.state, RelationState.Confirmed, '显式确认必须把候选升级为已确认')
  assert.equal(confirmed.created, false, '确认复用既有边，不新建关系')
  const reread = (await core.queries.getDeliveryLineage(chain.scope)).find((hop) => hop.relationType === 'derived_from')
  assert.equal(reread.relationState, RelationState.Confirmed, '确认后读回才是已确认')
  assert.equal(reread.source, RelationSource.Lineage, '确认不改变跳的谱系来源')
})

test('缺可选能力：部署与环境报 unavailable 而不是 error（ExecPlan D5）', async () => {
  const providers = createFakeProviders({ delivery: { capabilities: { deployments: false } } })
  const core = await compose(providers)
  // 必须先走完真实链路：CI 跳只在锚点被观察到之后才存在（ExecPlan D4），未观察时它不得出现。
  const chain = await startChain(providers, core, 'lineage-optional-1')
  const projection = await core.queries.getDeliveryProjection(chain.scope)
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
