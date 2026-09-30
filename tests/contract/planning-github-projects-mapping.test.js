/**
 * GitHub Projects 规划 provider 的纯逻辑契约（合成输入，不触网、不读夹具）。每条用例对应一条不变量或 ExecPlan 变异表的一行：
 * (1) 分类表：限流 / 权限 / 不存在 / 不可用各归其类，任何 errors 都整次失败，项目不可见是 not_found 而不是空页，错误不携带
 *     响应头、响应体或异常文本，成功响应不因剩余额度为 0 失败（M3、M5、M12、M14、M19）；
 * (2) 解码：种类只由 type 与 __typename 对照决定，任何不符整页失败，REDACTED 不读 content（M6、M20）；
 * (3) 游标停滞与成环是形状错误（M7、M21）；(4) 入口守卫先于任何请求，limit 钳位到 100（M13）；
 * (5) reconcile 全有或全无、忽略 scope.cursor、任何失败都不抛错（M4、M22）；(6) 能力自述只声明读取。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { inspect } from 'node:util'
import { createGithubProjectsPlanningProvider } from '@harness-projects/provider-planning-github-projects'

const bindingId = 'binding-gh-test'
const project = { bindingId, objectKind: 'project', externalId: 'project-1', url: undefined }
const NOW = Date.parse('2026-09-29T00:00:00Z')
const SENTINEL = 'SENTINEL-TOKEN-7f3a'

/** 脚本 transport：按调用顺序出队（最后一项重复），Error 表示 reject，函数按请求现算。 */
function scripted(script, now = () => NOW) {
  const calls = []
  const transport = async (request) => {
    calls.push(request.variables)
    const next = script.length > 1 ? script.shift() : script[0]
    if (next instanceof Error) throw next
    return typeof next === 'function' ? next(request) : next
  }
  return { calls, provider: createGithubProjectsPlanningProvider({ bindingId, projectNodeId: project.externalId, transport, now }) }
}
const res = (status, body, headers = {}) => ({ status, headers, body })
const ok = (body, headers) => res(200, body, headers)
const CONTENT = { ISSUE: { __typename: 'Issue', number: 1, url: 'u' }, PULL_REQUEST: { __typename: 'PullRequest', number: 3, url: 'u' }, DRAFT_ISSUE: { __typename: 'DraftIssue' } }
const row = (n, type, content = {}, patch = {}) => ({
  id: `item-${n}`, type, createdAt: '2026-09-21T07:00:00Z', updatedAt: '2026-09-21T07:11:54Z',
  content: content === null ? null : { ...CONTENT[type], id: `content-${n}`, title: `title ${n}`, body: `body ${n}`, updatedAt: '2026-09-21T07:10:00Z', ...content }, ...patch,
})
const page = (nodes, hasNextPage = false, endCursor = null) => ok({ data: { node: { __typename: 'ProjectV2', items: { pageInfo: { hasNextPage, endCursor }, nodes } } } })
const PROJECT = { data: { node: { __typename: 'ProjectV2', id: 'project-1', title: 'Project A', url: 'u', updatedAt: '2026-09-20T01:02:03Z' } } }
const list = (provider, input) => provider.listPlanningItems({ project, cursor: undefined, limit: 100, ...input })
const itemRef = (objectKind, externalId) => ({ bindingId, objectKind, externalId, url: undefined })
const reconcile = async (provider, cursor) => { const all = []; for await (const o of provider.reconcile({ scopeKey: 's', cursor })) all.push(o); return all }
const assertMalformed = (result, message) => assert.deepEqual([result.ok, result.error?.code, result.error?.rawClass], [false, 'unavailable', 'malformed_response'], message)

const RETRYABLE = { rate_limited: true, unavailable: true, permission_denied: false, not_found: false }
const rate = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + 30) }
const leaky = { 'www-authenticate': `Bearer ${SENTINEL}`, 'x-leak': SENTINEL, 'x-github-request-id': 'REQ-1' }
const gql = (...types) => ok({ data: { node: null }, errors: types.map((type) => ({ type, message: SENTINEL })) }, leaky)
// [名称, 应答, code, retryAfterMs, rawClass]：getProject 与 listPlanningItems 各跑一次；应答处处带哨兵串（M19）。
const FAILURES = [
  ['transport reject（M5）', new Error(SENTINEL), 'unavailable', undefined, 'transport_error'],
  ['401', res(401, { message: SENTINEL }, leaky), 'permission_denied', undefined, undefined],
  ['403 无限流头（secondary rates 不算二级限流：单词边界）', res(403, { message: `secondary rates ${SENTINEL}` }, leaky), 'permission_denied', undefined, undefined],
  ['403 body 为 null（不得因读正文抛错）', res(403, null, leaky), 'permission_denied', undefined, undefined],
  ['403 + retry-after', res(403, {}, { 'retry-after': '7' }), 'rate_limited', 7000, undefined],
  ['403 + remaining 0 + reset', res(403, {}, rate), 'rate_limited', 30000, undefined],
  ['403 二级限流（两个头都缺席）', res(403, { message: `You have exceeded a secondary rate limit ${SENTINEL}` }), 'rate_limited', undefined, undefined],
  ['429 retry-after 优先于 reset', res(429, {}, { ...rate, 'retry-after': '2' }), 'rate_limited', 2000, undefined],
  ['429 retry-after 不是整数', res(429, {}, { 'retry-after': SENTINEL }), 'rate_limited', undefined, undefined],
  ['502', res(502, { message: SENTINEL }, leaky), 'unavailable', undefined, 'http_502'],
  ['状态码不是整数（不得读成成功）', res(SENTINEL, PROJECT), 'unavailable', undefined, 'malformed_response'],
  ['2xx 状态码为小数（不得读成成功）', res(200.5, PROJECT), 'unavailable', undefined, 'malformed_response'],
  ['200 body 不是对象', ok([SENTINEL], leaky), 'unavailable', undefined, 'malformed_response'],
  ['200 没有 data 也没有 errors', ok({}), 'unavailable', undefined, 'malformed_response'],
  ['项目 node 为 null（M12）', ok({ data: { node: null } }), 'not_found', undefined, undefined],
  ['项目 node 不是 ProjectV2', ok({ data: { node: { __typename: 'Issue', id: 'project-1' } } }), 'not_found', undefined, undefined],
  ['项目 node 是别的项目', ok({ data: { node: { ...PROJECT.data.node, id: 'project-2' } } }), 'unavailable', undefined, 'malformed_response'],
  ['hasNextPage 缺失（不得截断成成功）', ok({ data: { node: { __typename: 'ProjectV2', items: { pageInfo: { endCursor: null }, nodes: [] } } } }), 'unavailable', undefined, 'malformed_response'],
  ['部分成功：data 带条目同时有 errors（M3）', ok({ data: { node: { ...PROJECT.data.node, items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [row(1, 'ISSUE'), row(2, 'ISSUE')] } } }, errors: [{ type: 'FORBIDDEN' }] }), 'permission_denied', undefined, undefined],
  ['errors NOT_FOUND', gql('NOT_FOUND'), 'not_found', undefined, undefined],
  ['errors INSUFFICIENT_SCOPES', gql('INSUFFICIENT_SCOPES'), 'permission_denied', undefined, undefined],
  ['RATE_LIMITED 优先于 FORBIDDEN', gql('FORBIDDEN', 'RATE_LIMITED'), 'rate_limited', undefined, undefined],
  ['FORBIDDEN 优先于 NOT_FOUND', gql('NOT_FOUND', 'FORBIDDEN'), 'permission_denied', undefined, undefined],
  ['errors 不是数组且带 remaining 0', ok({ errors: { message: SENTINEL } }, rate), 'rate_limited', 30000, undefined],
  ['200 + errors 正文含二级限流（无 type、无头）', ok({ data: { node: null }, errors: [{ message: `You have exceeded a secondary rate limit ${SENTINEL}` }] }, leaky), 'rate_limited', undefined, undefined],
  ['200 + errors 第二条才是二级限流 + retry-after', ok({ errors: [{ message: SENTINEL }, { message: `secondary rate limit ${SENTINEL}` }] }, { ...leaky, 'retry-after': '9' }), 'rate_limited', 9000, undefined],
  ['200 + errors 正文不是二级限流（secondary index）', ok({ errors: [{ message: `secondary index ${SENTINEL}` }] }, leaky), 'unavailable', undefined, 'graphql_error'],
  ['未知 type', gql('SOMETHING_ODD'), 'unavailable', undefined, 'graphql_SOMETHING_ODD'],
  ['type 不匹配 ^[A-Z_]+$', gql(SENTINEL), 'unavailable', undefined, 'graphql_error'],
]
for (const [name, response, code, retryAfterMs, rawClass] of FAILURES) {
  test(`合成：分类表 ${name}`, async () => {
    const { provider } = scripted([response])
    for (const result of [await provider.getProject(project), await list(provider)]) {
      assert.equal(result.ok, false, '异常响应不得被当作成功')
      const { error } = result
      assert.deepEqual({ ok: result.ok, value: result.value, code: error.code, retryable: error.retryable, retryAfterMs: error.retryAfterMs, rawClass: error.rawClass, requestId: error.requestId },
        { ok: false, value: undefined, code, retryable: RETRYABLE[code], retryAfterMs, rawClass, requestId: response.headers?.['x-github-request-id'] })
      assert.equal(inspect(result, { depth: null, showHidden: true }).includes(SENTINEL), false, '错误不得携带响应头、响应体或异常文本')
    }
  })
}

test('合成：分类表 成功响应带 remaining 0 与空 errors 仍是成功（M14）', async () => {
  const result = await scripted([ok({ ...PROJECT, errors: [] }, { ...rate, 'x-github-request-id': 'REQ-2' })]).provider.getProject(project)
  assert.deepEqual(result, { ok: true, value: { ref: { ...project, url: 'u' }, title: 'Project A', sourceUpdatedAt: '2026-09-20T01:02:03Z' }, requestId: 'REQ-2' })
})

// [名称, 坏条目]：与一个好条目同页，整页判形状错误，不做部分成功。
const MALFORMED = [
  ['type 与 __typename 不一致（M6）', row(1, 'PULL_REQUEST', { __typename: 'Issue' })],
  ['未知 type（取原型链属性名 constructor；M20）', row(1, 'constructor', { number: 1, url: 'u' })],
  ['PullRequest 的 number 为 0', row(1, 'PULL_REQUEST', { number: 0 })],
  ['成员关系 updatedAt 无偏移', row(1, 'ISSUE', {}, { updatedAt: '2026-09-21 07:11:54' })],
  ['内容 updatedAt 无偏移', row(1, 'ISSUE', { updatedAt: '2026-09-21T07:11:54' })],
  ['成员关系 id 为空串', row(1, 'ISSUE', {}, { id: '' })],
  ['内容 id 为空串', row(1, 'ISSUE', { id: '' })],
  ['Draft body 为 null（schema 为 String!）', row(1, 'DRAFT_ISSUE', { body: null })],
  ['content 缺失且 type 不是 REDACTED', row(1, 'ISSUE', {}, { content: undefined })],
]
for (const [name, bad] of MALFORMED) {
  test(`合成：解码 ${name} 是形状错误`, async () => assertMalformed(await list(scripted([page([row(9, 'ISSUE'), bad])]).provider)))
}

test('合成：REDACTED 与 content 为 null 退回成员关系 ref，不读 content，只产出成员关系观察', async () => {
  const { provider } = scripted([page([row(4, 'REDACTED', { __typename: 'Issue', number: -1 }), row(5, 'ISSUE', null)])])
  const listed = await list(provider)
  const expected = (n) => [itemRef('project_item', `item-${n}`), `item-${n}`, { kind: 'redacted', reason: 'unavailable' }]
  assert.deepEqual(listed.value.items.map(({ ref, membership, content }) => [ref, membership.externalId, content]), [expected(4), expected(5)])
  assert.equal(JSON.stringify(listed).includes('content-4'), false, 'REDACTED 不得读 content')
  const payload = { project: 'project-1', contentKind: null, contentExternalId: null, createdAt: '2026-09-21T07:00:00Z' }
  assert.deepEqual((await reconcile(provider)).map((o) => [o.type, o.payload]), [0, 1].map(() => ['planning.membership.observed', payload]))
  assert.equal((await provider.getPlanningItem(itemRef('project_item', 'item-5'))).value.content.kind, 'redacted', '成员关系 ref 按成员关系 id 扫描匹配')
})

test('合成：游标停滞与成环是形状错误，不死循环（M7、M21）', async () => {
  for (const [endCursor, cursor] of [[null, undefined], ['c-1', 'c-1']]) assertMalformed(await list(scripted([page([row(1, 'ISSUE')], true, endCursor)]).provider, { cursor }))
  // 扫描 c-2 → c-3 → c-2 成环：第 5 次调用起 reject，去掉成环守卫时得到 transport_error 而不是挂起。
  const next = { null: 'c-2', 'c-2': 'c-3', 'c-3': 'c-2' }
  const { provider, calls } = scripted([(request) => { if (calls.length > 4) throw new Error('cycle'); return page([row(calls.length, 'ISSUE')], true, next[request.variables.after]) }])
  assertMalformed(await provider.getPlanningItem(itemRef('issue', 'content-404')), '成环必须由成环守卫判定')
  assert.equal(calls.length, 3)
})

test('合成：入口守卫先于任何请求，limit 钳位到 100（M13）', async () => {
  const { provider, calls } = scripted([page([])])
  const others = [{ ...project, externalId: 'project-2' }, { ...project, bindingId: 'binding-other' }, { ...project, objectKind: 'repository' }]
  const rejected = await Promise.all([
    ...[0, 1.5].map((limit) => list(provider, { limit })),
    ...others.flatMap((other) => [provider.getProject(other), list(provider, { project: other })]),
    provider.getPlanningItem(itemRef('branch', 'x')), provider.getPlanningItem({ ...itemRef('issue', 'x'), bindingId: 'binding-other' }),
  ])
  assert.deepEqual(rejected.map((result) => result.error.code), Array(rejected.length).fill('invalid_input'))
  assert.equal(calls.length, 0)
  await list(provider, { limit: 500 })
  assert.deepEqual(calls, [{ project: 'project-1', first: 100, after: null }])
})

test('合成：reconcile 全有或全无，忽略 scope.cursor，任何失败都零条且不抛错（M4、M22）', async () => {
  const { provider, calls } = scripted([page([row(1, 'ISSUE'), row(2, 'DRAFT_ISSUE')], true, 'c-2'), res(503, {})])
  assert.deepEqual(await reconcile(provider, 'stale-cursor'), [])
  assert.deepEqual(calls.map((variables) => variables.after), [null, 'c-2'], '第 1 页已读完只是不产出；scope.cursor 被忽略')
  assert.deepEqual(await reconcile(scripted([page([row(1, 'ISSUE')])], () => Number.NaN).provider), [], '时钟或观察构造抛错同样一条不产出')
})

test('合成：能力自述只声明 planning.item.read，permission 由一次 getProject 探针决定；字段与迭代不伪造空表', async () => {
  for (const [response, permission] of [[ok(PROJECT), 'available'], [res(401, {}), 'unavailable'], [ok({ data: { node: null } }), 'unavailable'], [new Error('x'), 'degraded']]) {
    const snapshot = await scripted([response]).provider.describeCapabilities()
    assert.deepEqual(snapshot, { bindingId, capability: { 'planning.item.read': 'available' }, permission: { 'planning.item.read': permission }, observedAt: '2026-09-29T00:00:00.000Z' })
  }
  const { provider } = scripted([page([])])
  assert.deepEqual([(await provider.listFieldDefinitions(project)).error.code, (await provider.listIterations(project)).error.code], ['not_supported', 'not_supported'])
})
