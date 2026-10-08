/**
 * GitHub Actions 只读 adapter 的契约测试（不触网、无凭据）：真实 adapter 与离线替身跑同一份 Delivery suite，
 * 外加只属于这个 adapter 的对抗矩阵——精确提交/分支定位、仅三个已定义 GET endpoint、错误分类与安全文案、
 * 整页 fail-closed、suite 计数保护与只读写尝试零请求。
 * 判别力来自 fixture 的严格 replay：未录制的请求会让 transport 抛错，因此「请求定位错误」不可能伪装成通过。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { AccessLevel, CapabilityKey, effectiveCapabilities } from '@harness-projects/capabilities'
import { createGithubActionsDeliveryProvider } from '@harness-projects/provider-delivery-github-actions'
import {
  COMMIT, MAIN_BRANCH, NESTED_BRANCH, OTHER_COMMIT, OWNER, REPO_NAME, REPOSITORY_EXTERNAL_ID, REQUEST_ID, STATIC_HEADERS,
  actionsRoutes, checkItem, checksPath, createRecordedTransport, linkTo, recordedPages, requestKey, runItem, runsPath, suitesBody, suitesPath,
} from '../fixtures/github-actions.mjs'
import { deliveryContractSuite } from './suites/delivery.js'

const bindingId = 'binding-github-actions'
const repository = { bindingId, objectKind: 'repository', externalId: REPOSITORY_EXTERNAL_ID, url: undefined }
const TOKEN_CANARY = 'ghp_notarealtoken0000000000000000000000'
const PERMISSION = { [CapabilityKey.DeliveryPipelineRead]: AccessLevel.Available, [CapabilityKey.DeliveryCheckRead]: AccessLevel.Available }
const ALLOWED_PATHS = [runsPath(), checksPath(COMMIT), suitesPath(COMMIT)]

/** 每个用例一份 provider + 请求账本；permission 显式注入，不从空数据猜权限。 */
function makeGithub(handler, options = {}) {
  const { transport, calls } = createRecordedTransport(handler)
  const provider = createGithubActionsDeliveryProvider({
    bindingId, repository: { externalId: REPOSITORY_EXTERNAL_ID, owner: OWNER, name: REPO_NAME },
    transport, observedAt: '2026-10-07T00:00:00Z', permission: PERMISSION,
    clock: () => Date.parse('2026-10-07T00:00:00Z'), ...options,
  })
  return { provider, calls }
}

const readPage = async (provider, cursor, overrides = {}) => provider.listPipelineRuns({ repository, commit: COMMIT, cursor, limit: 1, ...overrides })

// 共享 Delivery suite：真实 adapter 必须与离线替身同过。
deliveryContractSuite({
  label: 'GitHub Actions adapter（合成协议）',
  makeProvider(scenario = {}) {
    if (scenario.faults?.offline) return makeGithub(async () => { throw new Error('offline') }).provider
    return makeGithub(actionsRoutes({
      runs: [runItem({ id: 1001, commit: COMMIT, branch: MAIN_BRANCH, status: 'completed', conclusion: 'success' }),
        runItem({ id: 1002, commit: COMMIT, branch: NESTED_BRANCH, status: 'in_progress', conclusion: null }),
        runItem({ id: 1003, commit: OTHER_COMMIT, branch: MAIN_BRANCH, status: 'completed', conclusion: 'failure' })],
      checks: [checkItem({ id: 2001, name: 'build', commit: COMMIT }),
        checkItem({ id: 2002, name: 'lint', commit: COMMIT, status: 'completed', conclusion: 'failure' }),
        checkItem({ id: 2003, name: 'test', commit: COMMIT, status: 'in_progress', conclusion: null })],
      suites: 3,
    })).provider
  },
  expect: {
    repository, commit: COMMIT, pageSize: 1,
    checkNames: ['build', 'lint', 'test'], environmentNames: [],
  },
})

test('actions-exact-commit-and-branch：同 SHA 不同 branch 由原生 branch 参数精确定位，请求只出现已定义字段', async () => {
  const seed = () => actionsRoutes({
    runs: [runItem({ id: 1001, commit: COMMIT, branch: MAIN_BRANCH }), runItem({ id: 1002, commit: COMMIT, branch: NESTED_BRANCH })],
  })
  // 带 / 的分支必须由 query 参数编码，不能拼进路径；limit 超过 100 时 per_page 夹到 GitHub 上限。
  for (const [branch, id] of [[MAIN_BRANCH, '1001'], [NESTED_BRANCH, '1002']]) {
    const { provider, calls } = makeGithub(seed())
    const result = await provider.listPipelineRuns({ repository, commit: COMMIT, branch, cursor: undefined, limit: 500 })
    assert.deepEqual([result.ok, result.value.items.map((run) => run.ref.externalId)], [true, [id]], `${branch}：branch 过滤必须生效`)
    assert.deepEqual([calls[0].path, calls[0].query], [runsPath(), { head_sha: COMMIT, branch, per_page: 100, page: 1 }], 'query 精确来自输入')
  }

  // 同分支旧 SHA / 新 SHA：head_sha 是唯一锚点，不读当前 PR，也不把别的提交的运行混进来。
  const old = makeGithub(actionsRoutes({ runs: [runItem({ id: 1001, commit: OTHER_COMMIT, branch: MAIN_BRANCH })] }))
  const result = await old.provider.listPipelineRuns({ repository, commit: COMMIT, branch: MAIN_BRANCH, cursor: undefined, limit: 10 })
  assert.deepEqual([result.ok, result.value.items], [true, []], '请求的提交上没有运行时空集合是合法结果')
  assert.equal(old.calls[0].query.head_sha, COMMIT)
})

test('actions-exact-commit-and-branch：坏引用/坏 limit/坏 cursor 与只读写尝试都在 transport 之前 fail closed', async () => {
  const { provider, calls } = makeGithub(actionsRoutes({ runs: [runItem({ id: 1001 })] }))
  const foreign = { ...repository, bindingId: 'binding-other' }
  const cases = [
    ['foreign binding', () => provider.listPipelineRuns({ repository: foreign, commit: COMMIT, cursor: undefined, limit: 10 }), 'not_found'],
    ['wrong objectKind', () => provider.listPipelineRuns({ repository: { ...repository, objectKind: 'repository-other' }, commit: COMMIT, cursor: undefined, limit: 10 }), 'not_found'],
    ['short sha', () => provider.listPipelineRuns({ repository, commit: 'abc123', cursor: undefined, limit: 10 }), 'invalid_input'],
    ['empty sha', () => provider.listPipelineRuns({ repository, commit: '', cursor: undefined, limit: 10 }), 'invalid_input'],
    ['zero limit', () => provider.listPipelineRuns({ repository, commit: COMMIT, cursor: undefined, limit: 0 }), 'invalid_input'],
    ['url cursor', () => provider.listPipelineRuns({ repository, commit: COMMIT, cursor: `https://api.github.com${runsPath()}?page=2`, limit: 10 }), 'invalid_input'],
    ['checks short sha', () => provider.listChecks({ repository, commit: 'abc123', cursor: undefined, limit: 10 }), 'invalid_input'],
  ]
  for (const [label, run, code] of cases) {
    const result = await run()
    assert.deepEqual([label, result.ok, result.error?.code], [label, false, code])
  }
  assert.equal(calls.length, 0, '坏输入不得发出任何请求')

  const writes = [provider.rerunPipeline({ ...repository, objectKind: 'pipeline_run', externalId: '1001' }), provider.cancelPipeline({ ...repository, objectKind: 'pipeline_run', externalId: '1001' })]
  for (const result of await Promise.all(writes)) {
    assert.deepEqual([result.ok, result.error?.code, result.error?.retryable], [false, 'not_supported', false])
  }
  assert.equal(calls.length, 0, '只读 adapter 的写尝试必须零请求')
})

test('actions-native-status-passthrough：原生 status/conclusion 原样透传，null 结论转 undefined，不改写成 completed/success', async () => {
  // 映射只在 core 的 factFor；adapter 若把非终态写成 completed、把 null 补成 success，进行中的检查就会变成 CiPassed。
  const natives = [['in_progress', null], ['in_progress', 'success'], ['queued', 'success'], ['completed', null],
    ['completed', 'startup_failure'], ['completed', 'action_required'], ['completed', 'neutral'], ['waiting', 'not_a_known_value']]
  const { provider } = makeGithub(actionsRoutes({
    runs: natives.map(([status, conclusion], i) => runItem({ id: 1001 + i, status, conclusion })),
    checks: natives.map(([status, conclusion], i) => checkItem({ id: 2001 + i, name: `check-${i}`, status, conclusion })),
  }))
  const expected = natives.map(([status, conclusion]) => [status, conclusion ?? undefined])
  for (const page of [await readPage(provider, undefined, { limit: 100 }), await provider.listChecks({ repository, commit: COMMIT, cursor: undefined, limit: 100 })]) {
    assert.deepEqual(page.value.items.map((item) => [item.status, item.conclusion]), expected)
  }
})

/** 读到底（或失败）为止；返回读到的 id 与失败。 */
async function drain(read) {
  const ids = []
  let cursor
  for (let round = 0; round < 12; round += 1) {
    const page = await read(cursor)
    if (!page.ok) return { ids, error: page.error }
    ids.push(...page.value.items.map((item) => item.ref.externalId))
    if ((cursor = page.value.nextCursor) === undefined) return { ids, error: undefined }
  }
  return { ids, error: { code: 'did_not_finish' } }
}

test('actions-page-completeness-and-safe-errors：每道完整性守卫在第几次 GET、以哪个 rawClass 拦下', async () => {
  const runsQuery = { head_sha: COMMIT, per_page: 1 }
  const next = (fields = {}) => linkTo({ path: runsPath(), query: runsQuery, page: 2, ...fields })
  /** runs 第 1 页：默认 total_count 2、一条 1001；link 为 undefined 时没有 Link。 */
  const firstPage = (link, body = { total_count: 2, workflow_runs: [runItem({ id: 1001 })] }) =>
    actionsRoutes({ overrides: { [runsPath()]: { status: 200, headers: link === undefined ? {} : { link }, body } } })
  const runsBody = (...rows) => ({ total_count: rows.length, workflow_runs: rows })
  const CHECKS = { checks: true }
  const checksPage = (...rows) => actionsRoutes({ overrides: { [checksPath(COMMIT)]: { status: 200, headers: {}, body: { total_count: rows.length, check_runs: rows } } } })
  // [label, handler, [code, rawClass, 读到的 id, GET 次数], 输入覆盖]。checks 的 GET 次数含每页一次 suites 探针。
  const cases = [
    ['多页正常遍历（/repositories/{id} 形态 Link）', actionsRoutes({ runs: [1001, 1002, 1003].map((id) => runItem({ id })) }), ['ok', undefined, ['1001', '1002', '1003'], 3]],
    ['/repos 形态 + 规范大小写 Link', (request) => ({ status: 200, headers: request.query.page === 1 ? { Link: next({ byRepoPath: true }) } : {}, body: { total_count: 2, workflow_runs: [runItem({ id: 1000 + request.query.page })] } }), ['ok', undefined, ['1001', '1002'], 2]],
    ['脱敏的真实形状 runs envelope（next/last、prev/first）', recordedPages('runs'), ['ok', undefined, ['90000000001', '90000000003'], 2]],
    ['脱敏的真实形状 check runs envelope', recordedPages('checks'), ['ok', undefined, ['90000000001', '90000000003'], 4], CHECKS],
    ['空页', actionsRoutes({ runs: [] }), ['ok', undefined, [], 1]],
    ['next 回退到当前页', firstPage(next({ page: 1 })), ['unavailable', 'link_page', [], 1]],
    ['next 换 host', firstPage(next({ host: 'evil.example' })), ['unavailable', 'link_host', [], 1]],
    ['next 换 endpoint 后缀', firstPage(next({ path: `${runsPath()}/jobs` })), ['unavailable', 'link_path', [], 1]],
    ['next 的仓库号不是数字', firstPage(next({ path: '/repositories/abc/actions/runs', byRepoPath: true })), ['unavailable', 'link_path', [], 1]],
    ['next 换到别的仓库路径', firstPage(next({ path: runsPath().replace(OWNER, 'other-owner'), byRepoPath: true })), ['unavailable', 'link_path', [], 1]],
    ['next 改了 filters', firstPage(linkTo({ path: runsPath(), query: { ...runsQuery, head_sha: OTHER_COMMIT }, page: 2 })), ['unavailable', 'link_filters', [], 1]],
    ['多个 rel=next', firstPage(`${next()}, ${next({ page: 3 })}`), ['unavailable', 'link_multiple', [], 1]],
    ['rel=next 不是可解析的 URL', firstPage('<not a url>; rel="next"'), ['unavailable', 'link_url', [], 1]],
    ['缺 Link 但累计不等于 total_count', firstPage(undefined), ['unavailable', 'missing_link', [], 1]],
    ['累计读取数超过 total_count', firstPage(next(), { total_count: 1, workflow_runs: [runItem({ id: 1001 }), runItem({ id: 1002 })] }), ['unavailable', 'read_over_total', [], 1]],
    // total_count 3 → 2：第二页后累计恰好等于新值，没有漂移守卫就会被当成读完整。
    ['total_count 在后续页变化', (request) => ({ status: 200, headers: request.query.page === 1 ? { link: next() } : {}, body: { total_count: 4 - request.query.page, workflow_runs: [runItem({ id: 1000 + request.query.page })] } }), ['unavailable', 'total_count_changed', ['1001'], 2]],
    // 1000 条一致数据：没有上界守卫会读满 10 页并报告「完整」。
    ['workflow 达到 1000 上界', actionsRoutes({ runs: Array.from({ length: 1000 }, (_, i) => runItem({ id: i + 1 })) }), ['unavailable', 'search_limit', [], 1], { limit: 100 }],
    ['page 不是数组', firstPage(undefined, { total_count: 1, workflow_runs: 'nope' }), ['unavailable', 'shape', [], 1]],
    ['wrong SHA', firstPage(undefined, runsBody(runItem({ id: 1001, commit: OTHER_COMMIT }))), ['unavailable', 'head_sha', [], 1]],
    ['wrong branch', firstPage(undefined, runsBody(runItem({ id: 1001 }))), ['unavailable', 'head_branch', [], 1], { branch: NESTED_BRANCH }],
    ['不按提交列仓库时 head_sha 不完整', firstPage(undefined, runsBody(runItem({ id: 1001, commit: 'abc123' }))), ['unavailable', 'head_sha', [], 1], { commit: undefined }],
    ['checks page 不是数组', actionsRoutes({ overrides: { [checksPath(COMMIT)]: { status: 200, headers: {}, body: { total_count: 1, check_runs: 'nope' } } } }), ['unavailable', 'shape', [], 2], CHECKS],
    ['checks wrong SHA', checksPage(checkItem({ id: 2001, name: 'build', commit: OTHER_COMMIT })), ['unavailable', 'head_sha', [], 2], CHECKS],
    ['checks 行缺 head_sha', checksPage({ ...checkItem({ id: 2001, name: 'build' }), head_sha: null }), ['unavailable', 'head_sha', [], 2], CHECKS],
    ['check runs 达到 1000 上界', actionsRoutes({ overrides: { [checksPath(COMMIT)]: { status: 200, headers: {}, body: { total_count: 1000, check_runs: [checkItem({ id: 2001, name: 'build' })] } } } }), ['unavailable', 'run_limit', [], 2], CHECKS],
    ['suites 达到 1000 上界', actionsRoutes({ checks: [checkItem({ id: 2001, name: 'build' })], suites: 1000 }), ['unavailable', 'suite_limit', [], 1], CHECKS],
  ]
  for (const [label, handler, expected, { checks, ...input } = {}] of cases) {
    const { provider, calls } = makeGithub(handler)
    const { ids, error } = await drain((cursor) => (checks ? provider.listChecks({ repository, commit: COMMIT, cursor, limit: 1 }) : readPage(provider, cursor, input)))
    assert.deepEqual([label, error?.code ?? 'ok', error?.rawClass, ids, calls.length], [label, ...expected], label)
  }

  // suites 计数：runs.total_count 不能代替 suite 全集；探针在每次 checks 页读取前发出。
  const okChecks = makeGithub(actionsRoutes({ checks: [checkItem({ id: 2001, name: 'build' })], suites: 999 }))
  const checksResult = await okChecks.provider.listChecks({ repository, commit: COMMIT, cursor: undefined, limit: 10 })
  assert.equal(checksResult.ok, true)
  assert.deepEqual(okChecks.calls.map((call) => call.path), [suitesPath(COMMIT), checksPath(COMMIT)], 'suite 探针必须先于 check-runs 读取')
  assert.deepEqual(okChecks.calls[1].query, { filter: 'latest', per_page: 10, page: 1 }, 'checks 显式 filter=latest')

  // 第二页读取时 suites 计数发生变化：本次观察整体不可用，不能把第一页当作完整结果。
  let suiteProbes = 0
  const shifted = makeGithub((request) => {
    if (request.path === suitesPath(COMMIT)) {
      suiteProbes += 1
      return { status: 200, headers: {}, body: suitesBody(suiteProbes === 1 ? 2 : 3) }
    }
    return actionsRoutes({ checks: [checkItem({ id: 2001, name: 'build' }), checkItem({ id: 2002, name: 'lint' })] })(request)
  })
  const shiftedFirst = await shifted.provider.listChecks({ repository, commit: COMMIT, cursor: undefined, limit: 1 })
  assert.deepEqual([shiftedFirst.ok, typeof shiftedFirst.value.nextCursor], [true, 'string'], '两页、首个探针一致时第一页应给出 nextCursor')
  const shiftedSecond = await shifted.provider.listChecks({ repository, commit: COMMIT, cursor: shiftedFirst.value.nextCursor, limit: 1 })
  assert.deepEqual([shiftedSecond.ok, shiftedSecond.error?.code, shiftedSecond.error?.rawClass], [false, 'unavailable', 'suite_count_changed'], 'suite 计数在读取期间变化即整页不可用')
})

test('actions-page-completeness-and-safe-errors：错误分类先于普通 403，限流带安全 retryAfterMs，响应正文不进入结果', async () => {
  const reset = String(Date.parse('2026-10-07T00:00:00Z') / 1000 + 3600)
  // [label, 响应, code, retryAfterMs, retryable, requestId]；宿主可能保留 HTTP 规范大小写，取值前必须归一。
  const cases = [
    ['401', { status: 401, headers: {}, body: { message: TOKEN_CANARY } }, 'permission_denied', undefined, false, undefined],
    ['普通 403 带 x-ratelimit-reset（未 exhausted）', { status: 403, headers: { 'x-ratelimit-reset': reset, 'x-github-request-id': REQUEST_ID }, body: { message: TOKEN_CANARY } }, 'permission_denied', undefined, false, REQUEST_ID],
    ['403 普通无任何限流证据', { status: 403, headers: {}, body: {} }, 'permission_denied', undefined, false, undefined],
    ['403 exhausted（remaining=0）', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }, body: { message: TOKEN_CANARY } }, 'rate_limited', 3600000, true, undefined],
    ['403 exhausted 但 reset 不是纯数字', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1e3' }, body: {} }, 'rate_limited', undefined, true, undefined],
    ['403 secondary（显式 Retry-After）', { status: 403, headers: { 'retry-after': '45' }, body: {} }, 'rate_limited', 45000, true, undefined],
    ['403 Retry-After 是 HTTP-date（按 clock 换算）', { status: 403, headers: { 'retry-after': 'Wed, 07 Oct 2026 00:01:30 GMT' }, body: {} }, 'rate_limited', 90000, true, undefined],
    ['403 Retry-After 形似 HTTP-date 但日期非法', { status: 403, headers: { 'retry-after': 'Wed, 99 Oct 2026 00:00:00 GMT' }, body: {} }, 'permission_denied', undefined, false, undefined],
    ['403 Retry-After 为空不是限流证据', { status: 403, headers: { 'retry-after': '' }, body: {} }, 'permission_denied', undefined, false, undefined],
    ['403 Retry-After 为 1e3 不是 delay-seconds', { status: 403, headers: { 'retry-after': '1e3' }, body: {} }, 'permission_denied', undefined, false, undefined],
    ['404', { status: 404, headers: {}, body: {} }, 'not_found', undefined, false, undefined],
    ['429', { status: 429, headers: { 'retry-after': '30' }, body: { message: TOKEN_CANARY } }, 'rate_limited', 30000, true, undefined],
    ['429 规范大小写 Retry-After', { status: 429, headers: { 'Retry-After': '12' }, body: {} }, 'rate_limited', 12000, true, undefined],
    ['429 Retry-After 越界 clamp', { status: 429, headers: { 'retry-after': '999999999999' }, body: {} }, 'rate_limited', 86400000, true, undefined],
    ['429 非法 Retry-After 不产出数值', { status: 429, headers: { 'retry-after': 'later' }, body: {} }, 'rate_limited', undefined, true, undefined],
    ['429 但没有 Retry-After', { status: 429, headers: {}, body: {} }, 'rate_limited', undefined, true, undefined],
    ['5xx 且 request id 是 token 形态', { status: 503, headers: { 'x-github-request-id': TOKEN_CANARY }, body: { message: TOKEN_CANARY } }, 'unavailable', undefined, true, undefined],
    ['5xx 规范大小写 X-GitHub-Request-Id', { status: 503, headers: { 'X-GitHub-Request-Id': REQUEST_ID }, body: {} }, 'unavailable', undefined, true, REQUEST_ID],
  ]
  for (const [label, response, code, retryAfterMs, retryable, requestId] of cases) {
    const { provider } = makeGithub(actionsRoutes({ overrides: { [runsPath()]: response } }))
    const result = await provider.listPipelineRuns({ repository, commit: COMMIT, cursor: undefined, limit: 10 })
    assert.deepEqual([label, result.ok, result.error.code, result.error.retryable, result.error.retryAfterMs, result.error.requestId],
      [label, false, code, retryable, retryAfterMs, requestId], label)
    assert.equal(JSON.stringify(result).includes(TOKEN_CANARY), false, `${label}：响应正文/token 不得进入 ProviderResult`)
  }

  const network = makeGithub(actionsRoutes({ overrides: { [runsPath()]: { failure: new Error(`网络异常 ${TOKEN_CANARY}`) } } }))
  const networkResult = await network.provider.listPipelineRuns({ repository, commit: COMMIT, cursor: undefined, limit: 10 })
  assert.deepEqual([networkResult.ok, networkResult.error.code, networkResult.error.retryable], [false, 'unavailable', true])
  assert.equal(JSON.stringify(networkResult).includes(TOKEN_CANARY), false, '原始异常文本不得进入结果')
  assert.equal(JSON.stringify(networkResult).includes('Error'), false, 'stack/异常类型不得进入结果')
})

test('actions-page-completeness-and-safe-errors：游标 scope 复用被拒（改 limit / commit / branch / 换端点 / 伪造字段为 invalid_input）', async () => {
  const { provider, calls } = makeGithub(actionsRoutes({
    runs: [runItem({ id: 1001 }), runItem({ id: 1002 })],
    checks: [checkItem({ id: 2001, name: 'build' })], suites: 1,
  }))
  const first = await provider.listPipelineRuns({ repository, commit: COMMIT, cursor: undefined, limit: 1 })
  assert.equal(first.ok, true)
  const scoped = first.value.nextCursor
  assert.notEqual(scoped, undefined, '两页数据必须给出游标')
  const forge = (fields) => Buffer.from(JSON.stringify({ endpoint: 'workflow_runs', repositoryId: REPOSITORY_EXTERNAL_ID, commit: COMMIT, page: 2, pageSize: 1, totalCount: 2, readCount: 1, ...fields })).toString('base64url')
  const beforeCalls = calls.length
  const cases = [
    ['改 limit', () => provider.listPipelineRuns({ repository, commit: COMMIT, cursor: scoped, limit: 2 })],
    ['改 commit', () => provider.listPipelineRuns({ repository, commit: OTHER_COMMIT, cursor: scoped, limit: 1 })],
    ['改 branch', () => provider.listPipelineRuns({ repository, commit: COMMIT, branch: MAIN_BRANCH, cursor: scoped, limit: 1 })],
    ['换 endpoint（checks 复用 runs 游标）', () => provider.listChecks({ repository, commit: COMMIT, cursor: scoped, limit: 1 })],
    ['篡改后的 base64 字符串', () => readPage(provider, forge({ endpoint: 'nope' }))],
    ['伪造别的 repositoryId', () => readPage(provider, forge({ repositoryId: 'repo-other' }))],
    ['页号超过上界', () => readPage(provider, forge({ page: 1001 }))],
    ['readCount 超过 totalCount', () => readPage(provider, forge({ readCount: 3 }))],
    ['readCount 为负数', () => readPage(provider, forge({ readCount: -1 }))],
  ]
  for (const [label, runCall] of cases) {
    const result = await runCall()
    assert.deepEqual([label, result.ok, result.error?.code, result.error?.retryable], [label, false, 'invalid_input', false], label)
  }
  assert.equal(calls.length, beforeCalls, '被拒的游标不得触发任何请求')
  const control = await readPage(provider, forge({}))
  assert.deepEqual([control.ok, control.value.items.map((run) => run.ref.externalId)], [true, ['1002']], '同 scope 的合法游标被接受：上面的拒绝来自被改的字段')
})

test('readonly-actions-mutations-make-no-request：能力快照按权限证据独立，请求清单只含三个已定义 GET', async () => {
  const { provider, calls } = makeGithub(actionsRoutes({ runs: [runItem({ id: 1001 })], checks: [], suites: 0 }))
  const snapshot = await provider.describeCapabilities()
  const access = (key) => effectiveCapabilities(snapshot).find((item) => item.key === key)?.access ?? 'unavailable'
  assert.deepEqual([access(CapabilityKey.DeliveryPipelineRead), access(CapabilityKey.DeliveryCheckRead)], ['available', 'available'])
  assert.deepEqual([provider.definition.implementationKey, provider.definition.domains], ['github-actions', ['delivery']])
  assert.deepEqual([typeof provider.listDeployments, typeof provider.listEnvironments], ['undefined', 'undefined'], '只读 adapter 如实省略部署/环境')

  const externalId = repository.externalId
  await provider.listPipelineRuns({ repository, commit: COMMIT, cursor: undefined, limit: 10 })
  await provider.listChecks({ repository, commit: COMMIT, cursor: undefined, limit: 10 })
  await provider.rerunPipeline({ ...repository, objectKind: 'pipeline_run', externalId })
  await provider.cancelPipeline({ ...repository, objectKind: 'pipeline_run', externalId })
  assert.equal(calls.length, 3, '两次读共 3 个 GET（runs + suites + check-runs）；写尝试 0 请求')
  for (const call of calls) {
    assert.equal(call.method, 'GET')
    assert.ok(ALLOWED_PATHS.includes(call.path), `未定义的 endpoint：${requestKey(call)}`)
    assert.deepEqual(call.headers, STATIC_HEADERS)
    assert.equal(Object.keys(call.headers).some((name) => name.toLowerCase() === 'authorization'), false)
  }
  assert.equal(calls.filter((call) => call.path === suitesPath(COMMIT)).length, 1, 'suite 探针每页一次')

  // 宿主 transport 就地改入参（例如注入凭据）不能串到别的绑定：replay 会在下一次请求的静态头不一致时抛错。
  const mutating = makeGithub((request) => { request.headers.authorization = 'token-of-binding-A'; return actionsRoutes()(request) })
  assert.equal((await readPage(mutating.provider, undefined)).ok, true)
  assert.equal((await readPage(provider, undefined)).ok, true, '另一绑定的下一次请求仍只带静态头')

  const unauthorized = createGithubActionsDeliveryProvider({
    bindingId, repository: { externalId: REPOSITORY_EXTERNAL_ID, owner: OWNER, name: REPO_NAME },
    transport: async () => { throw new Error('never') }, observedAt: '2026-10-07T00:00:00Z',
    permission: { [CapabilityKey.DeliveryCheckRead]: AccessLevel.Available },
  })
  const partial = await unauthorized.describeCapabilities()
  assert.equal(effectiveCapabilities(partial).find((item) => item.key === CapabilityKey.DeliveryPipelineRead)?.access, 'unavailable', '缺权限证据的 key 按 unavailable，不从空数据猜权限')
})

test('readonly-actions-mutations-make-no-request：构造参数校验拒绝非法输入而不是发出请求', () => {
  const transport = async () => ({ status: 200, headers: {}, body: {} })
  const base = () => ({ bindingId, repository: { externalId: REPOSITORY_EXTERNAL_ID, owner: OWNER, name: REPO_NAME }, transport, observedAt: '2026-10-07T00:00:00Z', permission: PERMISSION })
  const rejects = [
    ['非法 observedAt', { ...base(), observedAt: '2026-10-07 00:00:00' }],
    ['owner 带分隔符', { ...base(), repository: { externalId: REPOSITORY_EXTERNAL_ID, owner: 'acme/widgets', name: REPO_NAME } }],
    ['name 带控制字符', { ...base(), repository: { externalId: REPOSITORY_EXTERNAL_ID, owner: OWNER, name: 'wid\ngets' } }],
    ['transport 不是函数', { ...base(), transport: 'nope' }],
  ]
  for (const [label, options] of rejects) {
    assert.throws(() => createGithubActionsDeliveryProvider(options), TypeError, label)
  }
})
