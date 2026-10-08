/**
 * A2 集成（core 级）：交付事实摄入必须在整次集合完整后才发布，且 native 状态经唯一映射。
 * 用内联故障 stub 承载 Delivery 两类读取（不依赖 GitHub adapter），因此本测试只保护 core 行为：
 * 第二页故障/坏形状/循环 cursor/重复 id/超页数上界都不残留成功事实；任一项不属于已观察提交即整次作废；
 * native 状态只有 completed+success 产 CiPassed；三种 StatusPolicy 下规划存储逐字不变；未观察锚点零请求；
 * 首屏 429/5xx 也走真实 core 查询。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { DerivedFlag, EngineeringFactKind, ProviderErrorCode, StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { providerErr, providerError, providerOk } from '@harness-projects/capabilities'
import { composeCore, withDeliveryLineage } from '@harness-projects/core'
import { createFakeProviders, refOf } from '@harness-projects/provider-fake'

const REPOSITORY = 'repo-alpha'
const POLICY_MODES = [StatusPolicy.ProviderAuthoritative, StatusPolicy.HostAuthoritative, StatusPolicy.ManualOnly]
const unavailable = (rawClass) => providerErr(providerError(ProviderErrorCode.Unavailable, `${rawClass}：本次读取不完整`, { rawClass }))
const rateLimited = () => providerErr(providerError(ProviderErrorCode.RateLimited, '限流', { rawClass: 'http_429' }))

/**
 * 脚本化 Delivery stub：`pages` 是逐次调用的 ProviderResult 列表（最后一项重复用于后续调用）；
 * `checksPages` 同理。元素对象上没有 `commit` 键时回显请求的提交；写了（含显式 `undefined`）就原样交出，
 * 用于跨提交与漏交提交的负控。坏形状页与非对象元素原样交给 core。每个用例持有自己的 calls 账本，用来证明「未观察即零请求」。
 */
function stubDelivery({ pages = [], checksPages = [], calls = [] }) {
  const next = (list, index) => list[Math.min(index, list.length - 1)]
  let runCalls = 0
  let checkCalls = 0
  const fill = (item, commit) => item !== null && typeof item === 'object' && !('commit' in item) ? { ...item, commit } : item
  const echo = (page, commit) => !page.ok || !Array.isArray(page.value?.items) ? page
    : providerOk({ items: page.value.items.map((item) => fill(item, commit)), nextCursor: page.value.nextCursor })
  return {
    definition: { implementationKey: 'stub-delivery', domains: ['delivery'] },
    calls,
    async describeCapabilities() {
      return {
        bindingId: 'binding-stub', observedAt: '2026-10-07T00:00:00Z',
        capability: { 'delivery.pipeline.read': 'available', 'delivery.check.read': 'available' },
        permission: { 'delivery.pipeline.read': 'available', 'delivery.check.read': 'available' },
      }
    },
    async listPipelineRuns(input) {
      calls.push({ kind: 'pipeline', cursor: input.cursor, commit: input.commit })
      const page = next(pages, runCalls)
      runCalls += 1
      return echo(page, input.commit)
    },
    async listChecks(input) {
      calls.push({ kind: 'check', cursor: input.cursor, commit: input.commit })
      const page = next(checksPages, checkCalls)
      checkCalls += 1
      return echo(page, input.commit)
    },
    async rerunPipeline() { return providerErr(providerError(ProviderErrorCode.NotSupported, '未启用的能力')) },
    async cancelPipeline() { return providerErr(providerError(ProviderErrorCode.NotSupported, '未启用的能力')) },
  }
}

// 省略 commit 参数时对象上不带 `commit` 键，由 stub 回显请求的提交。
const withCommit = (commit) => (commit === undefined ? {} : { commit })
const run = (id, status, conclusion, commit) => ({ ref: { bindingId: 'binding-stub', objectKind: 'pipeline_run', externalId: id, url: undefined }, status, ...withCommit(commit), branch: undefined, conclusion })
const check = (id, conclusion, commit) => ({ ref: { bindingId: 'binding-stub', objectKind: 'check_run', externalId: id, url: undefined }, name: 'build', status: 'completed', ...withCommit(commit), conclusion })
const page = (items, nextCursor) => providerOk({ items, nextCursor })
const emptyChecks = () => providerOk({ items: [], nextCursor: undefined })

/** 组合根：planning/development/storage 用离线替身，delivery 用脚本化 stub。 */
function composeFor({ delivery, policy = StatusPolicy.ManualOnly }) {
  const providers = { ...createFakeProviders(), delivery }
  const workspace = { id: newWorkspaceId(), name: `delivery-pages/${policy}`, statusPolicy: policy }
  return { providers, compose: () => composeCore({ workspace, providers }) }
}

async function workItemIdOf(core) {
  const item = (await core.queries.listPlanningItems()).find((view) => view.kind === 'work_item' && view.content.contentKind === 'work_item')
  assert.ok(item, 'planning 种子必须有可开始的工作项')
  return item.entityId
}

/** 走真实链路观察锚点：startWork 建分支/工作树；变更请求按需创建（checks 才有锚点）。 */
async function startChain(composed, key, withChangeRequest = false) {
  const core = await composed.compose()
  const workItemId = await workItemIdOf(core)
  const started = await core.commands.startWork({ repositoryId: REPOSITORY, actor: { kind: 'agent' }, workItemId, idempotencyKey: key })
  assert.equal(started.confirmed, true, 'git 步骤必须拿到 provider ack 才形成锚点')
  if (withChangeRequest) {
    const created = await composed.providers.development.createChangeRequest({
      repository: refOf(composed.providers.development.gate.bindingId, 'repository', REPOSITORY),
      head: started.branchExternalId, base: 'main', title: 'CI 事实占位', body: '占位正文',
    })
    assert.equal(created.ok, true, '变更请求必须创建成功，checks 才有已观察锚点')
  }
  return { core, workItemId, scope: { workItemId, repositoryId: REPOSITORY } }
}

const factsOf = (hops) => hops.filter((hop) => hop.fact !== undefined).map((hop) => [hop.externalId, hop.fact])
const workspaceIdOf = async (core) => (await core.queries.getWorkspaceMetadata()).workspace.id

test('ci-pages-complete-before-publishing-facts：第二页故障/循环/重复/超页数都放弃整个集合，不残留第一页成功', async () => {
  // 第三列是请求次数：每种故障都必须在它出现的那一页立即放弃，不能靠页数上界兜底。
  const cases = [
    ['第二页 429', [page([run('1001', 'completed', 'success')], 'c1'), rateLimited()], 2],
    ['第二页不可用', [page([run('1001', 'completed', 'success')], 'c1'), unavailable('http_503')], 2],
    ['第二页形状坏（items 不是数组）', [page([run('1001', 'completed', 'success')], 'c1'), providerOk({ items: { length: 1 }, nextCursor: undefined })], 2],
    ['第二页值缺失（providerOk(undefined)）', [page([run('1001', 'completed', 'success')], 'c1'), providerOk(undefined)], 2],
    ['第二页元素为 null', [page([run('1001', 'completed', 'success')], 'c1'), page([null], undefined)], 2],
    ['第二页元素缺 ref', [page([run('1001', 'completed', 'success')], 'c1'), page([{ status: 'completed', branch: undefined, conclusion: 'success' }], undefined)], 2],
    ['第二页元素 ref 缺 externalId', [page([run('1001', 'completed', 'success')], 'c1'),
      page([{ ...run('1002', 'completed', 'success'), ref: { bindingId: 'binding-stub', objectKind: 'pipeline_run', url: undefined } }], undefined)], 2],
    // 第二页为空且游标不前进：重复对象检测无从触发，只有成环检测能在第 2 次请求后停下。
    ['游标成环', [page([run('1001', 'completed', 'success')], 'c1'), page([], 'c1')], 2],
    ['重复 id', [page([run('1001', 'completed', 'success')], 'c1'), page([run('1001', 'completed', 'failure')], undefined)], 2],
    ['超过页数上界（1000 个严格前进的游标）', null, 1000],
  ]
  for (const [label, pages, expectedCalls] of cases) {
    let delivery
    if (pages === null) {
      // 1000 页各自严格前进且始终带 next：唯一判据是页数上界，不是成环。
      let served = 0
      delivery = stubDelivery({ pages: [page([run('1001', 'completed', 'success')], 'c0')] })
      delivery.listPipelineRuns = async (input) => {
        delivery.calls.push({ kind: 'pipeline', cursor: input.cursor })
        served += 1
        return providerOk({ items: [{ ...run(String(served), 'completed', 'success'), commit: input.commit }], nextCursor: `c${served}` })
      }
    } else {
      delivery = stubDelivery({ pages })
    }
    const composed = composeFor({ delivery })
    const chain = await startChain(composed, `pages-${label}`, false)
    const projection = await chain.core.queries.getDeliveryProjection(chain.scope)
    assert.deepEqual([label, projection.degraded, factsOf(projection.hops)], [label, true, []], label)
    assert.equal(projection.hops.some((hop) => hop.entityKind === 'pipeline_run'), false, `${label}：不完整的集合不产生观察节点`)
    assert.equal(delivery.calls.length, expectedCalls, `${label}：请求次数`)
  }

  // 正常两页：第二页的失败必须被看见，且两个 id 都保留。
  const complete = stubDelivery({ pages: [page([run('1001', 'completed', 'success')], 'c1'), page([run('1002', 'completed', 'failure')], undefined)] })
  const completeChain = await startChain(composeFor({ delivery: complete }), 'pages-complete', false)
  const seen = factsOf((await completeChain.core.queries.getDeliveryProjection(completeChain.scope)).hops)
  assert.deepEqual(seen.sort(), [['1001', EngineeringFactKind.CiPassed], ['1002', EngineeringFactKind.CiFailed]].sort(), '第二页的失败必须被看见')
})

test('ci-pages-complete-before-publishing-facts：checks 第二页故障同样放弃整个集合', async () => {
  const delivery = stubDelivery({
    pages: [page([], undefined)],
    checksPages: [page([check('2001', 'failure')], 'k1'), rateLimited()],
  })
  const chain = await startChain(composeFor({ delivery }), 'checks-page-2', true)
  const projection = await chain.core.queries.getDeliveryProjection(chain.scope)
  assert.deepEqual([projection.degraded, factsOf(projection.hops)], [true, []], 'checks 第二页失败不得留下第一页的 CiFailed')
})

test('ci-pages-complete-before-publishing-facts：首屏 429/5xx 经真实 core 查询降级且无事实', async () => {
  for (const [label, failure] of [['首屏 429', rateLimited()], ['首屏 5xx', unavailable('http_503')]]) {
    const chain = await startChain(composeFor({ delivery: stubDelivery({ pages: [failure], checksPages: [emptyChecks()] }) }), `first-page-${label}`, false)
    const projection = await chain.core.queries.getDeliveryProjection(chain.scope)
    assert.deepEqual([label, projection.error, projection.degraded, factsOf(projection.hops)], [label, undefined, true, []], label)
  }
})

test('ci-native-status-never-guesses-passed：只有 completed + success 产 CiPassed，其它原生状态保守无事实', async () => {
  const rows = [
    run('1', 'completed', 'success'), run('2', 'completed', 'failure'), run('3', 'completed', 'timed_out'),
    run('4', 'completed', 'action_required'), run('5', 'completed', 'cancelled'), run('6', 'completed', 'neutral'),
    run('7', 'completed', 'skipped'), run('8', 'completed', 'stale'), run('9', 'completed', undefined),
    run('10', 'completed', 'unknown_native_value'), run('11', 'queued', 'success'), run('12', 'pending', 'success'),
    run('13', 'in_progress', 'success'), run('14', 'in_progress', 'failure'), run('15', 'queued', 'timed_out'),
    run('16', 'completed', 'startup_failure'),
  ]
  const chain = await startChain(composeFor({ delivery: stubDelivery({ pages: [page(rows, undefined)] }) }), 'native-table', false)
  const facts = factsOf((await chain.core.queries.getDeliveryProjection(chain.scope)).hops)
  assert.deepEqual(facts.sort(), [
    ['1', EngineeringFactKind.CiPassed], ['2', EngineeringFactKind.CiFailed],
    ['3', EngineeringFactKind.CiFailed], ['4', EngineeringFactKind.CiFailed], ['16', EngineeringFactKind.CiFailed],
  ].sort(), '唯一映射：completed+success 才是 pass，非终态携 success/failure 都不产事实，startup_failure 是失败')

  const emptyChain = await startChain(composeFor({ delivery: stubDelivery({ pages: [page([], undefined)] }) }), 'empty-set', false)
  assert.deepEqual(factsOf((await emptyChain.core.queries.getDeliveryProjection(emptyChain.scope)).hops), [], '空集合不触发聚合 pass')
})

test('ci-facts-only-on-observed-commit：任一运行或检查属于别的提交，该类集合整次作废、不发布任何事实', async () => {
  const OTHER = 'f'.repeat(40)
  // 流水线：同页里一条属于已观察提交的成功运行 + 一条别的提交上的运行——只丢坏行会留下 1001 的 CiPassed。
  const runs = stubDelivery({ pages: [page([run('1001', 'completed', 'success'), run('1002', 'completed', 'success', OTHER)], undefined)] })
  const runChain = await startChain(composeFor({ delivery: runs }), 'wrong-commit-run', false)
  const runProjection = await runChain.core.queries.getDeliveryProjection(runChain.scope)
  assert.deepEqual([runProjection.degraded, factsOf(runProjection.hops)], [true, []], '别的提交上的运行使流水线集合整次作废')

  // 别的提交只出现在第二页：核对必须覆盖每一页，不能只核首页。
  const laterPage = stubDelivery({ pages: [page([run('1001', 'completed', 'success')], 'c1'), page([run('1002', 'completed', 'success', OTHER)], undefined)] })
  const laterChain = await startChain(composeFor({ delivery: laterPage }), 'wrong-commit-page-2', false)
  const laterProjection = await laterChain.core.queries.getDeliveryProjection(laterChain.scope)
  assert.deepEqual([laterProjection.degraded, factsOf(laterProjection.hops), laterPage.calls.length], [true, [], 2], '第二页属于别的提交同样整次作废')

  // 检查：同理整次作废；同一次查询里属于已观察提交的流水线事实不受影响（作废只针对该类集合）。
  const checks = stubDelivery({
    pages: [page([run('1001', 'completed', 'success')], undefined)],
    checksPages: [page([check('2001', 'success'), check('2002', 'failure', OTHER)], undefined)],
  })
  const checkChain = await startChain(composeFor({ delivery: checks }), 'wrong-commit-check', true)
  const checkProjection = await checkChain.core.queries.getDeliveryProjection(checkChain.scope)
  assert.deepEqual([checkProjection.degraded, factsOf(checkProjection.hops)], [true, [['1001', EngineeringFactKind.CiPassed]]],
    '别的提交上的检查使检查集合整次作废，流水线事实照常')
  // 核对的基准必须是已观察的 head 本身：core 若拿别的提交去请求并核对，回显的 stub 会让两者自洽，只有请求账本看得出。
  const observedHead = checkProjection.hops.find((hop) => hop.entityKind === 'commit')?.externalId
  assert.ok(observedHead, '用例需要已观察的提交')
  assert.deepEqual(checks.calls.map((call) => [call.kind, call.commit]), [['pipeline', observedHead], ['check', observedHead]], '两类读取都按已观察的 head 定位')

  // provider 漏交 commit（显式 undefined，绕过 stub 回显）：无法证明归属，检查集合同样作废。
  const missing = stubDelivery({
    pages: [page([run('1001', 'completed', 'success')], undefined)],
    checksPages: [page([{ ...check('2003', 'success'), commit: undefined }], undefined)],
  })
  const missingChain = await startChain(composeFor({ delivery: missing }), 'missing-commit-check', true)
  const missingProjection = await missingChain.core.queries.getDeliveryProjection(missingChain.scope)
  assert.deepEqual([missingProjection.degraded, factsOf(missingProjection.hops)], [true, [['1001', EngineeringFactKind.CiPassed]]],
    '缺 commit 的检查不能被当成已观察 head 上的检查')
})

test('ci-facts-preserve-planning-in-all-policies：CI 失败进派生块，三种策略下规划存储逐字不变', async () => {
  for (const policy of POLICY_MODES) {
    const delivery = stubDelivery({
      pages: [page([run('1001', 'completed', 'success'), run('1002', 'completed', 'failure')], undefined)],
      checksPages: [page([check('2001', 'failure')], undefined)],
    })
    const composed = composeFor({ delivery, policy })
    const { core, workItemId, scope } = await startChain(composed, `policy-${policy}`, true)
    const workspaceId = await workspaceIdOf(core)
    const storedBefore = JSON.stringify(await composed.providers.storage.getPlanningProjection(workspaceId, workItemId))
    const before = (await core.queries.listPlanningItems()).find((item) => item.entityId === workItemId)
    const hops = await core.queries.getDeliveryLineage(scope)
    assert.deepEqual(factsOf(hops).map(([, kind]) => kind).sort(),
      [EngineeringFactKind.CiPassed, EngineeringFactKind.CiFailed, EngineeringFactKind.CiFailed].sort(), `${policy}：mixed history 逐条保留`)
    const folded = withDeliveryLineage(before, hops, workItemId)
    assert.deepEqual(
      [folded.planningStatus === before.planningStatus, JSON.stringify(folded.content) === JSON.stringify(before.content),
        folded.engineering.derived.includes(DerivedFlag.CiFailing), folded.engineering.derived.includes(DerivedFlag.Attention)],
      [true, true, true, true], `${policy}：折入谱系只产生派生标记`)
    const after = (await core.queries.listPlanningItems()).find((item) => item.entityId === workItemId)
    assert.deepEqual(
      [JSON.stringify(await composed.providers.storage.getPlanningProjection(workspaceId, workItemId)) === storedBefore,
        after.planningStatus === before.planningStatus, JSON.stringify(after.content) === JSON.stringify(before.content)],
      [true, true, true], `${policy}：交付读取不得改写规划投影存储`)
  }
})

test('ci-unobserved-anchor-makes-no-request：未观察的锚点不发出任何 Delivery 请求', async () => {
  const unobserved = stubDelivery({ pages: [page([run('1001', 'completed', 'success')], undefined)], checksPages: [emptyChecks()] })
  const core = await composeFor({ delivery: unobserved }).compose()
  const workItemId = await workItemIdOf(core)
  const projection = await core.queries.getDeliveryProjection({ workItemId, repositoryId: REPOSITORY })
  assert.deepEqual([projection.error, projection.hops.length, unobserved.calls.length], [undefined, 0, 0], '没有已观察提交时不得读取流水线')

  const partial = stubDelivery({ pages: [page([run('1001', 'completed', 'success')], undefined)], checksPages: [emptyChecks()] })
  const partialChain = await startChain(composeFor({ delivery: partial }), 'partial-anchor', false)
  await partialChain.core.queries.getDeliveryProjection(partialChain.scope)
  assert.deepEqual(partial.calls.map((call) => call.kind), ['pipeline'], '有提交无变更请求时只读流水线，不读 checks')
})
