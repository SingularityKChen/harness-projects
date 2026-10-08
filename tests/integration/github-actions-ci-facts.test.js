/**
 * A2 集成：真 GitHub Actions adapter → 真 core 查询（不触网、无凭据）。
 * 本文件只保护两层的接缝：core 的完整分页摄入真的作用在 adapter 的 scope 游标与整页校验之上，
 * 第二页故障不残留第一页成功；anchor 未观察时 adapter 收到零请求；已观察提交后请求精确落在该提交。
 * core 自身的分页/状态/策略矩阵由 Batch A2 的 core 级集成（内联 stub）单独固定，这里不重复。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { EngineeringFactKind, StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { composeCore } from '@harness-projects/core'
import { createFakeProviders, refOf } from '@harness-projects/provider-fake'
import { createGithubActionsDeliveryProvider } from '@harness-projects/provider-delivery-github-actions'
import {
  COMMIT, MAIN_BRANCH, OWNER, REPO_NAME, REPOSITORY_EXTERNAL_ID, actionsRoutes, checkItem, checksPath,
  createRecordedTransport, linkTo, runItem, runsPath, suitesPath,
} from '../fixtures/github-actions.mjs'

const REPOSITORY = REPOSITORY_EXTERNAL_ID
const BINDING = 'binding-github-actions'
const PERMISSION = { 'delivery.pipeline.read': 'available', 'delivery.check.read': 'available' }
const PAGE_LIMIT = 50

/** #222 起查询纯读、摄入只经刷新命令：本文件的每次交付读取先经 `commands.refreshDeliveryFacts` 摄入再读（相当于打开视图时刷新），被测的仍是 core 的完整分页与映射。 */
const refreshBeforeRead = (core) => {
  const read = (method) => async (scope) => {
    // provider 读不全（页故障、429/5xx、读回别的提交）是缺口，不是刷新失败：刷新把它报成失败时这里变红。
    assert.equal((await core.commands.refreshDeliveryFacts(scope)).error, undefined, '刷新本身不得失败')
    return core.queries[method](scope)
  }
  return { ...core, queries: { ...core.queries, getDeliveryProjection: read('getDeliveryProjection'), getDeliveryLineage: read('getDeliveryLineage') } }
}
/** 组合根：planning/development/storage 用离线替身，delivery 用真 adapter + 合成 protocol。 */
function composeFor(handler) {
  const { transport, calls } = createRecordedTransport(handler)
  const providers = {
    ...createFakeProviders(),
    delivery: createGithubActionsDeliveryProvider({
      bindingId: BINDING, repository: { externalId: REPOSITORY, owner: OWNER, name: REPO_NAME },
      transport, observedAt: '2026-10-07T00:00:00Z', permission: PERMISSION,
    }),
  }
  // 替身的提交种子换成 fixture 的完整 SHA：真 adapter 只接受不可变锚点。
  providers.development.state.branches[0].headCommit = COMMIT
  providers.development.state.commits[0] = {
    ...providers.development.state.commits[0],
    sha: COMMIT, ref: refOf(providers.development.gate.bindingId, 'commit', COMMIT),
  }
  const workspace = { id: newWorkspaceId(), name: 'github-actions/adapter-seam', statusPolicy: StatusPolicy.ManualOnly }
  return { providers, calls, compose: async () => refreshBeforeRead(await composeCore({ workspace, providers })) }
}

async function startChain(composed, key) {
  const core = await composed.compose()
  const item = (await core.queries.listPlanningItems()).find((view) => view.kind === 'work_item' && view.content.contentKind === 'work_item')
  assert.ok(item, 'planning 种子必须有可开始的工作项')
  const started = await core.commands.startWork({ repositoryId: REPOSITORY, actor: { kind: 'agent' }, workItemId: item.entityId, idempotencyKey: key })
  assert.equal(started.confirmed, true, 'git 步骤必须拿到 provider ack 才形成锚点')
  assert.equal(started.branchHeadCommit, COMMIT)
  return { core, scope: { workItemId: item.entityId, repositoryId: REPOSITORY } }
}

const factsOf = (hops) => hops.filter((hop) => hop.fact !== undefined).map((hop) => [hop.externalId, hop.fact])

/** 两页 runs：第一页带 GitHub 真实形态（`/repositories/{id}`）的 rel=next，回显实际收到的 per_page；第二页按 secondBody 返回。 */
const twoPages = (secondBody) => (request) => {
  if (request.path !== runsPath()) return undefined
  if (request.query.page === 1) {
    return {
      status: 200,
      headers: { link: linkTo({ path: runsPath(), query: { head_sha: COMMIT, per_page: request.query.per_page }, page: 2 }) },
      body: { total_count: 2, workflow_runs: [runItem({ id: 1001, status: 'completed', conclusion: 'success' })] },
    }
  }
  return secondBody
}

test('adapter→core：真 adapter 的第二页故障不残留第一页 CiPassed', async () => {
  for (const [label, second] of [['第二页 429', { status: 429, headers: {}, body: {} }],
    ['第二页坏形状', { status: 200, headers: {}, body: { total_count: 2, workflow_runs: 'nope' } }]]) {
    const chain = await startChain(composeFor(twoPages(second)), `seam-${label}`)
    const projection = await chain.core.queries.getDeliveryProjection(chain.scope)
    assert.deepEqual([label, projection.error, projection.degraded, factsOf(projection.hops)], [label, undefined, true, []], label)
    assert.equal(projection.hops.some((hop) => hop.entityKind === 'pipeline_run'), false, `${label}：不完整集合不产生观察节点`)
  }

  const completeBody = { status: 200, headers: {}, body: { total_count: 2, workflow_runs: [runItem({ id: 1002, status: 'completed', conclusion: 'failure' })] } }
  const complete = await startChain(composeFor(twoPages(completeBody)), 'seam-complete')
  const seen = factsOf((await complete.core.queries.getDeliveryProjection(complete.scope)).hops)
  assert.deepEqual(seen.sort(), [['1001', EngineeringFactKind.CiPassed], ['1002', EngineeringFactKind.CiFailed]].sort(), '第二页失败必须被看见')
})

test('adapter→core：已观察提交后请求精确落在该提交，checks 只在 CR 观察后读取；非终态带 success、completed 带 null 不产生 CiPassed', async () => {
  const pending = [['in_progress', 'success'], ['completed', null]]
  const composed = composeFor(actionsRoutes({
    runs: [runItem({ id: 1001, commit: COMMIT, branch: MAIN_BRANCH, status: 'completed', conclusion: 'success' }), ...pending.map(([status, conclusion], i) => runItem({ id: 1002 + i, status, conclusion }))],
    checks: [checkItem({ id: 2001, name: 'build', commit: COMMIT, status: 'completed', conclusion: 'failure' }), ...pending.map(([status, conclusion], i) => checkItem({ id: 2002 + i, name: `pending-${i}`, status, conclusion }))], suites: 1,
  }))
  const chain = await startChain(composed, 'seam-precise')
  await chain.core.queries.getDeliveryProjection(chain.scope)
  const runCalls = composed.calls.filter((call) => call.path === runsPath())
  assert.equal(runCalls.length, 1)
  assert.deepEqual(runCalls[0].query, { head_sha: COMMIT, per_page: PAGE_LIMIT, page: 1 }, 'runs 查询来自输入，不读当前 PR')
  assert.deepEqual(composed.calls.filter((call) => call.path === checksPath(COMMIT) || call.path === suitesPath(COMMIT)), [], '未创建 CR 时不读 checks 与 suites')

  const created = await composed.providers.development.createChangeRequest({
    repository: refOf(composed.providers.development.gate.bindingId, 'repository', REPOSITORY),
    head: 'work/' + chain.scope.workItemId, base: 'main', title: 'CI 接缝占位', body: '占位正文',
  })
  assert.equal(created.ok, true)
  const withChecks = factsOf((await chain.core.queries.getDeliveryProjection(chain.scope)).hops)
  assert.deepEqual(withChecks.sort(), [['1001', EngineeringFactKind.CiPassed], ['2001', EngineeringFactKind.CiFailed]].sort(), 'CR 观察后 checks 事实进入谱系；1002/1003、2002/2003 没有事实')
  assert.ok(composed.calls.some((call) => call.path === suitesPath(COMMIT)), 'checks 读取必须先过 suite 计数探针')
})

test('adapter→core：未观察锚点时 adapter 收到零请求', async () => {
  const composed = composeFor(actionsRoutes({ runs: [runItem({ id: 1001 })] }))
  const core = await composed.compose()
  const item = (await core.queries.listPlanningItems()).find((view) => view.kind === 'work_item' && view.content.contentKind === 'work_item')
  const projection = await core.queries.getDeliveryProjection({ workItemId: item.entityId, repositoryId: REPOSITORY })
  assert.deepEqual([projection.error, projection.hops.length, composed.calls.length], [undefined, 0, 0], '没有已观察提交时不得读取流水线')
})
