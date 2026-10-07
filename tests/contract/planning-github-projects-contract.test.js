/**
 * GitHub Projects 规划 provider 在录制夹具上的契约（不触网、不需要凭据；夹具来自私有沙箱 Project A 的只读查询）。保护的不变量：
 * (1) Planning 契约套件在真实平台形状上通过：分页不重不漏、内容三态、成员关系与内容身份分离（R1）、同一状态读两次逐字相同；
 * (2) 夹具不失真：id 必须已登记（provenance）、查询文本变了必须重录（漂移）、查询不取个人字段、回放未命中账本为空；
 * (3) 条目逐字段映射：内容身份、成员关系与两套时间戳各归其位；(4) R7：历史 id 不作为平台查询参数；
 * (5) 观察：两类各 9 条，版本是规范载体且两套时间戳不混用，重复读取去重键相同；
 * (6) 原生字段读取（#133）：字段定义判别联合、值连接读到结束或整次失败、日期与迭代严格校验、nativeValues 逐字回读。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isComparableSourceVersion, sourceVersionFromTimestamp } from '@harness-projects/capabilities'
import { PLANNING_QUERIES, createGithubProjectsPlanningProvider } from '@harness-projects/provider-planning-github-projects'
import { planningContractSuite } from './suites/planning.js'
import { createReplay, loadAggregateFixture } from './fixtures/github-projects/replay.js'

// 条目夹具与字段读取夹具是同一沙箱 Project A 的两次录制：合并规则只有 replay.js 一份（较新的字段录制覆盖旧响应）。
const fixture = loadAggregateFixture()
const bindingId = 'binding-github-planning'
const exchange = (operationName, first) => fixture.exchanges.find((entry) => entry.operationName === operationName && entry.variables.first === first)
const projectNodeId = exchange('PlanningProject', undefined).variables.project
const project = { bindingId, objectKind: 'project', externalId: projectNodeId, url: undefined }
const ALPHA = 'I_kwDOUjWAl88AAAABST4WDQ'
const alpha = exchange('PlanningItems', 100).body.data.node.items.nodes.find((node) => node.content.id === ALPHA)

/** 每个 provider 实例一份回放；misses 账本在最后一条用例统一断言。时钟每次调用递增 1 秒。 */
const replays = []
const makeProvider = (transport, nodeId = projectNodeId) => {
  let now = Date.parse('2026-09-29T00:00:00Z')
  return createGithubProjectsPlanningProvider({ bindingId, projectNodeId: nodeId, transport, now: () => (now += 1000) })
}
const replayProvider = () => { const replay = createReplay(fixture); replays.push(replay); return { replay, provider: makeProvider(replay.transport) } }
const reconcileAll = async (provider) => { const all = []; for await (const o of provider.reconcile({ scopeKey: 'planning', cursor: undefined })) all.push(o); return all }

/** 合成变体（不触网、不进回放账本）：用于续页、故障与形状错误；正常路径的期望值仍逐字来自录制夹具。 */
const okNode = (node, headers = {}) => ({ status: 200, headers, body: { data: { node } } })
const fieldsNode = (nodes, hasNextPage = false, endCursor = null) => ({ __typename: 'ProjectV2', fields: { pageInfo: { hasNextPage, endCursor }, nodes } })
const itemsNode = (nodes, hasNextPage = false, endCursor = null) => ({ __typename: 'ProjectV2', items: { pageInfo: { hasNextPage, endCursor }, nodes } })
const fieldsConnection = (nodes, hasNextPage = false, endCursor = 'Mg') => ({ pageInfo: { hasNextPage, endCursor }, nodes })
const itemFieldsNode = (membershipId, nodes, { projectId = projectNodeId, hasNextPage = false, endCursor = 'Mg' } = {}) =>
  ({ __typename: 'ProjectV2Item', id: membershipId, project: { id: projectId }, fieldValues: fieldsConnection(nodes, hasNextPage, endCursor) })
const issueNode = (n, fieldValues) => ({
  id: `PVTI_syn_${n}`, type: 'ISSUE', createdAt: '2026-09-21T07:00:00Z', updatedAt: '2026-09-21T07:11:54Z',
  content: { __typename: 'Issue', id: `I_kw_syn_${n}`, number: n, title: `t${n}`, body: `b${n}`, url: 'u', updatedAt: '2026-09-21T07:10:00Z' },
  fieldValues,
})
const synthetic = (respond, nodeId = projectNodeId) => { const calls = []; return { calls, provider: makeProvider(async (request) => { calls.push(request); return respond(request, calls.length) }, nodeId) } }
const assertMalformed = (result) => assert.deepEqual([result.ok, result.error?.code, result.error?.rawClass], [false, 'unavailable', 'malformed_response'])
const STATUS_FIELD = 'PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY'
const ITEM_WITH_FIELDS_MEMBERSHIP = 'PVTI_lAHOAY1ahM4BkJ9rzg75k-I'
const STATUS_VALUE = { __typename: 'ProjectV2ItemFieldSingleSelectValue', field: { id: STATUS_FIELD, name: 'Status' }, optionId: 'f75ad846', name: 'Todo' }

/** 重复投递：在回放 provider 上独立跑两遍原方法，条数不同就抛错，再按对交错产出。 */
function withDuplicateDelivery(provider) {
  const original = { reconcile: provider.reconcile.bind(provider) }
  provider.reconcile = async function* () {
    const [first, second] = [await reconcileAll(original), await reconcileAll(original)]
    if (first.length !== second.length) throw new Error('两遍 reconcile 的条数不同')
    for (const [index, observation] of first.entries()) yield* [observation, second[index]]
  }
  return provider
}

const kinds = (objectKind, contentKind, ids) => ids.map((externalId) => ({ externalId, objectKind, contentKind }))
planningContractSuite({
  label: 'GitHub Projects provider（录制夹具）',
  makeProvider(scenario = {}) {
    if (scenario.faults?.offline) return makeProvider(async () => { throw new Error('offline') })
    if (scenario.faults?.permissionDenied) return makeProvider(async () => ({ status: 401, headers: {}, body: { message: 'Bad credentials' } }))
    const { provider } = replayProvider()
    return scenario.faults?.duplicateEvent ? withDuplicateDelivery(provider) : provider
  },
  expect: {
    project, pageSize: 4, redactedReason: 'unavailable',
    items: [...kinds('issue', 'work_item', [ALPHA, 'I_kwDOUjWAl88AAAABST4Wtw', 'I_kwDOUjWAl88AAAABST4XVQ', 'I_kwDOUjWAl88AAAABST4X6Q', 'I_kwDOUjWAl88AAAABSUC8og']),
      ...kinds('draft', 'work_item', ['DI_lAHOAY1ahM4BkJ9rzgLKQZo', 'DI_lAHOAY1ahM4BkJ9rzgLLTqU', 'DI_lAHOAY1ahM4BkJ9rzgLLTsE']), ...kinds('change_request', 'change_request', ['PR_kwDOUjWAl88AAAABEYNntg'])],
  },
})

test('provenance：夹具里的每个平台 id 都已登记在沙箱定义里，没有手工篡改', () => {
  const sandboxDoc = readFileSync(new URL('../../docs/architecture/gate-e1-sandbox.md', import.meta.url), 'utf8')
  const fixtureText = readFileSync(new URL('./fixtures/github-projects/project-a.json', import.meta.url), 'utf8')
  assert.equal(fixture.provenance.project, '$E1_PROJECT_A_ID', 'provenance 只写变量名，不写 id')
  const tokens = new Set(fixtureText.match(/[A-Za-z0-9_-]+/g).filter((token) => token.length >= 10 && /^(PVTI_|PVT_|I_kw|PR_kw|DI_)/.test(token)))
  assert.ok(tokens.size >= 19, `9 个成员关系、9 个内容与项目本身：只找到 ${tokens.size} 个 id`)
  assert.deepEqual([...tokens].filter((token) => !sandboxDoc.includes(token)), [], '夹具里出现了沙箱定义里没有登记的 id')
})

test('查询漂移：夹具记录的查询哈希必须等于当前查询文本，查询不取个人字段', () => {
  const sha256 = (text) => createHash('sha256').update(text).digest('hex')
  const current = Object.fromEntries(Object.entries(PLANNING_QUERIES).map(([name, text]) => [name, sha256(text)]))
  assert.deepEqual(fixture.provenance.queryHashes, current, '查询文本变了，必须按 ExecPlan 的录制程序重录夹具')
  assert.doesNotMatch(Object.values(PLANNING_QUERIES).join('\n'), /creator|assignees|login|author|email/i)
})

test('条目映射：内容身份、成员关系与两套时间戳逐字段归位，字段不猜', async () => {
  const listed = await replayProvider().provider.listPlanningItems({ project, cursor: undefined, limit: 100 })
  assert.deepEqual(listed.value.items.find((item) => item.ref.externalId === ALPHA), {
    ref: { bindingId, objectKind: 'issue', externalId: ALPHA, url: alpha.content.url }, project,
    membership: { externalId: alpha.id, createdAt: alpha.createdAt, updatedAt: alpha.updatedAt },
    content: { kind: 'work_item', workItem: { externalId: ALPHA, title: alpha.content.title, body: alpha.content.body } },
    fields: { statusKey: undefined, priority: undefined, assigneeRefs: [], iterationId: undefined, startDate: undefined, targetDate: undefined, customFields: {}, nativeValues: { [STATUS_FIELD]: { kind: 'single_select', optionId: 'f75ad846', name: 'Todo' } } },
    sourceVersion: sourceVersionFromTimestamp(alpha.updatedAt), sourceUpdatedAt: alpha.updatedAt,
  })
})

test('R7：历史 draft id 查询返回 not_found，且从不作为平台查询参数', async () => {
  const DRAFT_BEFORE_CONVERSION = 'DI_lAHOAY1ahM4BkJ9rzgLKQZ0'
  const { replay, provider } = replayProvider()
  const result = await provider.getPlanningItem({ bindingId, objectKind: 'draft', externalId: DRAFT_BEFORE_CONVERSION, url: undefined })
  assert.deepEqual([result.ok, result.error.code, result.error.retryable], [false, 'not_found', false])
  assert.ok(replay.calls.length > 0)
  for (const { variables } of replay.calls) {
    assert.ok(Object.keys(variables).every((key) => ['project', 'first', 'after'].includes(key)), '平台查询参数只有 project、first、after')
    assert.ok(!Object.values(variables).includes(DRAFT_BEFORE_CONVERSION), '内容 id 不得作为平台查询参数')
  }
})

test('观察：9 条内容观察与 9 条成员关系观察，两套时间戳各归其主，重复读取去重键相同', async () => {
  const { provider } = replayProvider()
  const [first, second] = [await reconcileAll(provider), await reconcileAll(provider)]
  assert.deepEqual(['planning.content.observed', 'planning.membership.observed'].map((type) => first.filter((o) => o.type === type).length), [9, 9])
  assert.ok(first.every((o) => isComparableSourceVersion(o.sourceVersion)))
  const content = first.find((o) => o.subject.externalId === ALPHA)
  const membership = first.find((o) => o.subject.externalId === alpha.id)
  assert.deepEqual([content.sourceVersion, content.payload], [sourceVersionFromTimestamp(alpha.content.updatedAt), { kind: 'issue', number: alpha.content.number, title: alpha.content.title, body: alpha.content.body }])
  assert.deepEqual([membership.sourceVersion, membership.payload], [sourceVersionFromTimestamp(alpha.updatedAt),
    { project: projectNodeId, contentKind: 'issue', contentExternalId: ALPHA, createdAt: alpha.createdAt,
      nativeValues: { [STATUS_FIELD]: { kind: 'single_select', optionId: 'f75ad846', name: 'Todo' } } }])
  assert.notEqual(content.sourceVersion, membership.sourceVersion, '沙箱里两套时间戳并不相等（E1-1 实验 1）')
  assert.deepEqual(second.map((o) => o.dedupeKey), first.map((o) => o.dedupeKey))
  assert.notEqual(second[0].receivedTime, first[0].receivedTime)
})

test('R7：字段读取的参数白名单：定义连接只有 project/first/after，值续页只有 item/first/after', async () => {
  const { replay, provider } = replayProvider()
  const definitions = await provider.listFieldDefinitions(project)
  const iterations = await provider.listIterations(project)
  await provider.listPlanningItems({ project, cursor: undefined, limit: 4 })
  assert.deepEqual([definitions.ok, iterations.ok], [true, true])
  assert.ok(replay.calls.length > 0)
  for (const { operationName, variables } of replay.calls) {
    const allowed = operationName === 'PlanningItemFields' ? ['item', 'first', 'after'] : ['project', 'first', 'after']
    assert.ok(Object.keys(variables).every((key) => allowed.includes(key)), `${operationName} 只发 ${allowed.join('/')}`)
    assert.ok(Object.values(variables).every((value) => typeof value !== 'string' || !/^(I_kw|PR_kw|DI_)/.test(value)), '内容 id 与草稿 id 不得作为平台查询参数')
  }
  const valueCalls = replay.calls.filter(({ operationName }) => operationName === 'PlanningItemFields')
  for (const { variables } of valueCalls) assert.match(variables.item, /^PVTI_/, '值续页只允许用本项目的成员关系 id')
})

test('field identity isolates projects sharing option ids', async () => {
  const UNSUPPORTED = ['Assignees', 'Closed', 'Created', 'E1 Text', 'Labels', 'Linked pull requests', 'Milestone', 'Parent issue', 'Repository', 'Reviewers', 'Sub-issues progress', 'Title', 'Updated']
  const definitions = await replayProvider().provider.listFieldDefinitions(project)
  assert.equal(definitions.ok, true)
  const byId = new Map(definitions.value.map((definition) => [definition.id, definition]))
  assert.equal(definitions.value.length, 16, '沙箱 Project A 首页 16 个字段')
  assert.deepEqual(definitions.value.filter((definition) => definition.kind === 'unsupported').map((definition) => definition.name).sort(), UNSUPPORTED.sort(),
    '12 个内置字段与 TEXT 一律 unsupported，只有 single_select / date / iteration 带形状')
  assert.deepEqual(byId.get(STATUS_FIELD), {
    id: STATUS_FIELD, name: 'Status', kind: 'single_select',
    options: [{ id: 'f75ad846', name: 'Todo' }, { id: '47fc9ee4', name: 'In Progress' }, { id: '98236657', name: 'Done' }],
  })
  assert.deepEqual(byId.get('PVTF_lAHOAY1ahM4BkJ9rzhi7k9I'), { id: 'PVTF_lAHOAY1ahM4BkJ9rzhi7k9I', name: 'E1 Date', kind: 'date' })
  const iterations = await replayProvider().provider.listIterations(project)
  assert.equal(iterations.ok, true)
  assert.deepEqual(iterations.value, [{ id: '7b232bc3', projectFieldId: 'PVTIF_lAHOAY1ahM4BkJ9rzhi7k9M', title: 'E1 Sprint 1', startDate: '2026-09-21', durationDays: 7, completed: true }],
    'completed iteration must not be reported as active and must keep its configuration')
  // 同一 optionId 出现在另一个 fieldId 上时，值只能挂在本条目实际的 fieldId，不按 option 全局定位。
  const ambiguous = synthetic((request) => (request.operationName === 'PlanningItems'
    ? okNode(itemsNode([issueNode(1, fieldsConnection([STATUS_VALUE]))]))
    : okNode(fieldsNode([{ __typename: 'ProjectV2SingleSelectField', id: 'other-field', name: 'Other', dataType: 'SINGLE_SELECT', options: [{ id: 'f75ad846', name: 'Todo' }] }])))).provider
  assert.deepEqual((await ambiguous.listPlanningItems({ project, cursor: undefined, limit: 100 })).value.items[0].fields.nativeValues,
    { [STATUS_FIELD]: { kind: 'single_select', optionId: 'f75ad846', name: 'Todo' } })
})

test('field connections consume all pages or fail closed', async () => {
  assert.deepEqual([(await replayProvider().provider.listFieldDefinitions(project)).ok, (await replayProvider().provider.listIterations(project)).ok], [true, true])
  for (const [name, response] of [
    ['missing endCursor', okNode(fieldsNode([{ __typename: 'ProjectV2Field', id: 'field-1', name: 'One', dataType: 'TEXT' }], true, null))],
    ['partial GraphQL errors', { status: 200, headers: {}, body: { data: { node: { __typename: 'ProjectV2', fields: fieldsNode([]).fields } }, errors: [{ type: 'FORBIDDEN' }] } }],
  ]) {
    const result = await synthetic(() => response).provider.listFieldDefinitions(project)
    assert.equal(result.ok, false, `${name} must fail the whole read instead of truncating`)
    assert.ok(['unavailable', 'permission_denied'].includes(result.error.code), name)
  }
  const cycled = synthetic((request) => okNode(fieldsNode([{ __typename: 'ProjectV2Field', id: `f-${request.variables.after}`, name: 'One', dataType: 'TEXT' }], true, request.variables.after === null ? 'c-1' : request.variables.after === 'c-1' ? 'c-2' : 'c-1')))
  assertMalformed(await cycled.provider.listFieldDefinitions(project))
  // node 不是绑定的 ProjectV2 → not_found（项目不可见），不是空字段表。跨 project 的核对在值续页上：
  // PlanningFields 的冻结查询不取 node id，所以定义连接只能按 typename 判形状（与 #70 的 getProject 一致）。
  const invisible = await synthetic(() => okNode({ __typename: 'Issue', id: 'x' })).provider.listFieldDefinitions(project)
  assert.deepEqual([invisible.ok, invisible.error.code], [false, 'not_found'])
  // 跨页重复的字段 id：后面按 id 解析映射，重复时「第一条胜出」会让同一响应有两种解释，必须整次失败。
  const duplicateIds = synthetic((request) => okNode(request.variables.after === null
    ? fieldsNode([{ __typename: 'ProjectV2Field', id: 'field-dup', name: 'One', dataType: 'TEXT' }], true, 'c-1')
    : fieldsNode([{ __typename: 'ProjectV2Field', id: 'field-dup', name: 'Two', dataType: 'TEXT' }], false, null)))
  assertMalformed(await duplicateIds.provider.listFieldDefinitions(project))
  // 值续页：只用本次列表读到的成员关系 id，返回后核对 project 与成员关系 id。
  const firstPage = okNode(itemsNode([issueNode(1, fieldsConnection([], true, 'v-1'))]))
  const more = { __typename: 'ProjectV2ItemFieldDateValue', field: { id: 'PVTF_lAHOAY1ahM4BkJ9rzhi7k9I', name: 'E1 Date' }, date: '2026-09-24' }
  const continued = synthetic((request) => (request.operationName === 'PlanningItems' ? firstPage : okNode(itemFieldsNode('PVTI_syn_1', [more]))))
  const values = await continued.provider.listPlanningItems({ project, cursor: undefined, limit: 100 })
  assert.deepEqual(values.value.items[0].fields.nativeValues, { 'PVTF_lAHOAY1ahM4BkJ9rzhi7k9I': { kind: 'date', date: '2026-09-24' } })
  assert.deepEqual(continued.calls.map(({ operationName, variables }) => [operationName, variables]), [
    ['PlanningItems', { project: projectNodeId, first: 100, after: null }],
    ['PlanningItemFields', { item: 'PVTI_syn_1', first: 100, after: 'v-1' }],
  ], 'R7：续页只用本次列表刚读到的成员关系 id')
  const duplicateOnContinuation = synthetic((request) => (request.operationName === 'PlanningItems'
    ? okNode(itemsNode([issueNode(1, fieldsConnection([STATUS_VALUE], true, 'v-1'))]))
    : okNode(itemFieldsNode('PVTI_syn_1', [STATUS_VALUE]))))
  const duplicateResult = await duplicateOnContinuation.provider.listPlanningItems({ project, cursor: undefined, limit: 100 })
  assert.equal(duplicateResult.ok, false, '续页重复 projectFieldId 必须使整次读取失败')
  assert.equal(duplicateResult.error.code, 'unavailable')
  assert.deepEqual(duplicateResult.value, undefined, '失败不得发布首页已读的部分字段')
  for (const [name, node] of [
    ['project mismatch', itemFieldsNode('PVTI_syn_1', [more], { projectId: 'other-project' })],
    ['membership id mismatch', itemFieldsNode('PVTI_syn_9', [more])],
    ['cursor cycle', itemFieldsNode('PVTI_syn_1', [], { hasNextPage: true, endCursor: 'v-1' })],
  ]) {
    const provider = synthetic((request) => (request.operationName === 'PlanningItems' ? firstPage : okNode(node))).provider
    assertMalformed(await provider.listPlanningItems({ project, cursor: undefined, limit: 100 }), name)
  }
  assertMalformed(await synthetic((request) => (request.operationName === 'PlanningItems' ? firstPage : okNode({ __typename: 'ProjectV2Item', id: 'PVTI_syn_1' }))).provider
    .listPlanningItems({ project, cursor: undefined, limit: 100 }), 'continuation failure must not publish partial fields')
  const down = await synthetic((request) => (request.operationName === 'PlanningItems' ? firstPage : { status: 503, headers: {}, body: {} })).provider
    .listPlanningItems({ project, cursor: undefined, limit: 100 })
  assert.deepEqual([down.ok, down.error.code], [false, 'unavailable'], '续页 503 仍是结构化失败')
})

test('iterations include completed configuration and dates remain nullable', async () => {
  const field = (config) => ({ __typename: 'ProjectV2IterationField', id: 'field-iter', name: 'Iteration', dataType: 'ITERATION', configuration: config })
  const read = (config) => synthetic(() => okNode(fieldsNode([field(config)]))).provider.listIterations(project)
  assert.deepEqual((await read({ iterations: [{ id: 'i-1', title: 'Active', startDate: null, duration: 0 }], completedIterations: [] })).value,
    [{ id: 'i-1', projectFieldId: 'field-iter', title: 'Active', startDate: undefined, durationDays: 0, completed: false }], 'date: null 合法，工期可以是非负整数')
  for (const [name, config] of [['negative duration', { iterations: [{ id: 'i-1', title: 'A', startDate: '2026-09-21', duration: -1 }], completedIterations: [] }],
    ['fractional duration', { iterations: [{ id: 'i-1', title: 'A', startDate: '2026-09-21', duration: 1.5 }], completedIterations: [] }],
    ['string duration', { iterations: [{ id: 'i-1', title: 'A', startDate: '2026-09-21', duration: '7' }], completedIterations: [] }],
    ['impossible start date', { iterations: [{ id: 'i-1', title: 'A', startDate: '2026-02-30', duration: 7 }], completedIterations: [] }]]) {
    assert.equal((await read(config)).ok, false, name)
  }
  const ITEM_FIELDS = { __typename: 'ProjectV2ItemFieldIterationValue', field: { id: 'PVTIF_lAHOAY1ahM4BkJ9rzhi7k9M', name: 'E1 Iteration' }, iterationId: '7b232bc3', title: 'E1 Sprint 1', startDate: '2026-09-21', duration: 7 }
  const dateNode = { __typename: 'ProjectV2ItemFieldDateValue', field: { id: 'PVTF_lAHOAY1ahM4BkJ9rzhi7k9I', name: 'E1 Date' }, date: null }
  const readItem = (nodes) => synthetic((request) => (request.operationName === 'PlanningItems' ? okNode(itemsNode([issueNode(1, fieldsConnection(nodes))])) : okNode(itemFieldsNode('PVTI_syn_1', [])))).provider
    .listPlanningItems({ project, cursor: undefined, limit: 100 })
  assert.deepEqual((await readItem([ITEM_FIELDS])).value.items[0].fields.nativeValues, { 'PVTIF_lAHOAY1ahM4BkJ9rzhi7k9M': { kind: 'iteration', iterationId: '7b232bc3', title: 'E1 Sprint 1', startDate: '2026-09-21', durationDays: 7 } })
  assert.deepEqual((await readItem([dateNode])).value.items[0].fields.nativeValues, { 'PVTF_lAHOAY1ahM4BkJ9rzhi7k9I': { kind: 'date', date: null } })
  assert.equal((await readItem([{ ...dateNode, date: '2026-02-30' }])).ok, false, 'invalid date fails the whole read instead of silently dropping the value')
})

test('recorded native values：PlanningItems 首页回读 Status / E1 Date / E1 Iteration', async () => {
  const { provider } = replayProvider()
  const values = await provider.listPlanningItems({ project, cursor: undefined, limit: 100 })
  assert.equal(values.ok, true)
  const items = values.value.items
  assert.equal(items.length, 9)
  const alpha = items.find((item) => item.ref.externalId === ALPHA)
  const withFields = items.find((item) => item.membership.externalId === ITEM_WITH_FIELDS_MEMBERSHIP)
  assert.deepEqual(alpha.fields.nativeValues, { [STATUS_FIELD]: { kind: 'single_select', optionId: 'f75ad846', name: 'Todo' } },
    '内容 id 为 ALPHA 的条目首页 Status 是 Todo')
  assert.deepEqual(withFields.fields.nativeValues, {
    [STATUS_FIELD]: { kind: 'single_select', optionId: '47fc9ee4', name: 'In Progress' },
    'PVTF_lAHOAY1ahM4BkJ9rzhi7k9I': { kind: 'date', date: '2026-09-24' },
    'PVTIF_lAHOAY1ahM4BkJ9rzhi7k9M': { kind: 'iteration', iterationId: '7b232bc3', title: 'E1 Sprint 1', startDate: '2026-09-21', durationDays: 7 },
  }, '内容 I_kwDOUjWAl88AAAABST4XVQ 的条目带 Status / E1 Date / E1 Iteration')
})

test('field failure never publishes partial values through list or reconcile', async () => {
  const provider = synthetic(() => ({ status: 503, headers: {}, body: {} })).provider
  assert.deepEqual(await reconcileAll(provider), [])
  const result = await provider.listPlanningItems({ project, cursor: undefined, limit: 100 })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'unavailable')
})

test('回放账本：本文件所有回放都没有未命中的请求', () => {
  assert.ok(replays.length > 0)
  assert.deepEqual(replays.flatMap((replay) => replay.misses), [])
})
