/**
 * Batch C4 端到端：状态策略（issue #78 / ExecPlan D6、AGENTS.md §1.1 不变量 3）。产品面的 source_managed / harness_managed / manual
 * 对应领域枚举的 provider_authoritative / host_authoritative / manual_only；三种策略下 CI 失败、执行完成、PR 合并都不得改写规划状态，
 * 唯一允许的联动是显式命令。每条负向用例都断言"存储里的规划状态原值不变"，而不只是看一眼决策函数的返回值。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DerivedFlag, EngineeringFactKind, NormalizedStatus, StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { StatusPolicyMode, composeCore, decideFromEngineeringFact, policyMatrix, withDeliveryLineage } from '@harness-projects/core'
import { createFakeProviders, refOf } from '@harness-projects/provider-fake'

const REPOSITORY = 'repo-alpha'
const MODES = [
  { mode: StatusPolicyMode.SourceManaged, policy: StatusPolicy.ProviderAuthoritative },
  { mode: StatusPolicyMode.HarnessManaged, policy: StatusPolicy.HostAuthoritative },
  { mode: StatusPolicyMode.Manual, policy: StatusPolicy.ManualOnly },
]
const FACT_KINDS = [EngineeringFactKind.CiFailed, EngineeringFactKind.ExecutionCompleted, EngineeringFactKind.ChangeRequestMerged]

async function composeFor(policy) {
  const providers = createFakeProviders()
  const workspace = { id: newWorkspaceId(), name: `MVP-0/${policy}`, statusPolicy: policy }
  const core = await composeCore({ workspace, providers })
  const workItemId = await workItemIdOf(core)
  return { providers, core, workItemId, workspaceId: workspace.id }
}

/** 投影按内部 entityId 排序，而 id 是随机的：必须显式挑一个未完成的工作项，否则断言会随排序抖动。 */
async function workItemIdOf(core) {
  const items = await core.queries.listPlanningItems()
  const item = items.find((view) => view.kind === 'work_item' && view.planningStatus !== NormalizedStatus.Done)
  assert.ok(item, 'planning 种子里必须有一个未完成的工作项')
  return item.entityId
}

async function statusOf(core, entityId) {
  return (await core.queries.getItemDetail(entityId))?.planningStatus
}

test('工程事实（CI 失败 / 执行完成 / PR 合并）：三种策略下规划状态都原值不变（不变量 3）', async () => {
  assert.equal(policyMatrix().length, 3, '策略矩阵必须覆盖三种策略')
  assert.deepEqual(policyMatrix().map((row) => row.engineeringFactWrites), [false, false, false])
  for (const { mode, policy } of MODES) for (const kind of FACT_KINDS) {
    const { providers, core, workItemId, workspaceId } = await composeFor(policy)
    const before = await statusOf(core, workItemId)
    const projection = await providers.storage.getPlanningProjection(workspaceId, workItemId)
    const decision = decideFromEngineeringFact({ projection, facts: [{ kind, subjectId: workItemId }], policy,
      incoming: NormalizedStatus.Done })
    const label = `${mode}/${kind}`
    assert.equal(decision.wrote, false, `${label}：工程事实不得写入规划状态`)
    assert.equal(decision.status, before, `${label}：决策必须原值返回，而不是 incoming`)
    assert.equal(decision.error, undefined, `${label}：工程事实不是错误`)
    const stored = await providers.storage.getPlanningProjection(workspaceId, workItemId)
    assert.equal(stored.planningStatus, before, `${label}：存储中的规划状态不得改变`)
    assert.equal(await statusOf(core, workItemId), before, `${label}：查询到的规划状态不得改变`)
  }
})

test('显式命令是唯一允许的联动：harness_managed / manual 写入，source_managed 拒绝（D6）', async () => {
  for (const { mode, policy } of MODES) {
    const { core, workItemId } = await composeFor(policy)
    const before = await statusOf(core, workItemId)
    assert.notEqual(before, NormalizedStatus.Done, `${mode}：种子里第一个工作项应不是 done`)
    const decision = await core.commands.applyPlanningStatus({ entityId: workItemId, status: NormalizedStatus.Done })
    if (policy === StatusPolicy.ProviderAuthoritative) {
      assert.equal(decision.wrote, false, `${mode}：provider 拥有规划状态，显式命令也必须被拒绝`)
      assert.equal(decision.error.code, 'not_supported')
      assert.equal(await statusOf(core, workItemId), before, `${mode}：被拒绝的命令不得留下任何改动`)
      continue
    }
    assert.equal(decision.wrote, true, `${mode}：显式命令必须写入`)
    assert.equal(await statusOf(core, workItemId), NormalizedStatus.Done, `${mode}：显式命令的结果必须可查询`)
  }
})

test('交付谱系里的 CI 失败只进 derived 块：planningStatus 与内容逐字保留（不变量 3 / D5）', async () => {
  const providers = createFakeProviders()
  const workspace = { id: newWorkspaceId(), name: 'MVP-0/ci-failure', statusPolicy: StatusPolicy.ManualOnly }
  const core = await composeCore({ workspace, providers })
  const workItemId = await workItemIdOf(core)
  const started = await core.commands.startWork({ repositoryId: REPOSITORY, actor: { kind: 'agent' }, workItemId, idempotencyKey: 'ci-failure-1' })
  assert.equal(started.confirmed, true, 'git 步骤必须拿到 provider ack')
  providers.delivery.state.runs.push({
    ref: refOf(providers.delivery.gate.bindingId, 'pipeline_run', 'run-fail'),
    repository: refOf(providers.delivery.gate.bindingId, 'repository', REPOSITORY),
    status: 'completed', commit: providers.development.state.commits[0].sha, conclusion: 'failure' })
  const view = (await core.queries.listPlanningItems()).find((item) => item.entityId === workItemId)
  const hops = await core.queries.getDeliveryLineage({ workItemId, repositoryId: REPOSITORY })
  assert.ok(hops.some((hop) => hop.fact === EngineeringFactKind.CiFailed), 'CI 失败必须作为工程事实出现在谱系里')
  const folded = withDeliveryLineage(view, hops, workItemId)
  assert.equal(folded.planningStatus, view.planningStatus, '折入交付谱系不得改写规划状态')
  assert.deepEqual(folded.content, view.content, '内容字段逐字保留')
  assert.deepEqual(
    folded.engineering.facts.map((fact) => fact.kind).sort(),
    [EngineeringFactKind.CiFailed, EngineeringFactKind.CiPassed].sort(), '谱系里的 CI 结论必须逐条折成工程事实')
  assert.ok(folded.engineering.derived.includes(DerivedFlag.CiFailing), 'CI 失败必须出现在派生标记里')
  assert.ok(folded.engineering.derived.includes(DerivedFlag.Attention))
  assert.equal(await statusOf(core, workItemId), view.planningStatus, '存储中的规划状态不变')
})
