/**
 * GitHub Projects 规划 provider 在录制夹具上的契约（不触网、不需要凭据；夹具来自私有沙箱 Project A 的只读查询）。保护的不变量：
 * (1) Planning 契约套件在真实平台形状上通过：分页不重不漏、内容三态、成员关系与内容身份分离（R1）、同一状态读两次逐字相同；
 * (2) 夹具不失真：id 必须已登记（provenance）、查询文本变了必须重录（漂移）、查询不取个人字段、回放未命中账本为空；
 * (3) 条目逐字段映射：内容身份、成员关系与两套时间戳各归其位；(4) R7：历史 id 不作为平台查询参数；
 * (5) 观察：两类各 9 条，版本是规范载体且两套时间戳不混用，重复读取去重键相同。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isComparableSourceVersion, sourceVersionFromTimestamp } from '@harness-projects/capabilities'
import { PLANNING_QUERIES, createGithubProjectsPlanningProvider } from '@harness-projects/provider-planning-github-projects'
import { planningContractSuite } from './suites/planning.js'
import { createReplay, loadFixture } from './fixtures/github-projects/replay.js'

const bindingId = 'binding-github-planning'
const fixture = loadFixture()
const exchange = (operationName, first) => fixture.exchanges.find((entry) => entry.operationName === operationName && entry.variables.first === first)
const projectNodeId = exchange('PlanningProject', undefined).variables.project
const project = { bindingId, objectKind: 'project', externalId: projectNodeId, url: undefined }
const ALPHA = 'I_kwDOUjWAl88AAAABST4WDQ'
const alpha = exchange('PlanningItems', 100).body.data.node.items.nodes.find((node) => node.content.id === ALPHA)

/** 每个 provider 实例一份回放；misses 账本在最后一条用例统一断言。时钟每次调用递增 1 秒。 */
const replays = []
const makeProvider = (transport) => { let now = Date.parse('2026-09-29T00:00:00Z'); return createGithubProjectsPlanningProvider({ bindingId, projectNodeId, transport, now: () => (now += 1000) }) }
const replayProvider = () => { const replay = createReplay(fixture); replays.push(replay); return { replay, provider: makeProvider(replay.transport) } }
const reconcileAll = async (provider) => { const all = []; for await (const o of provider.reconcile({ scopeKey: 'planning', cursor: undefined })) all.push(o); return all }

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
    fields: { statusKey: undefined, priority: undefined, assigneeRefs: [], iterationId: undefined, startDate: undefined, targetDate: undefined, customFields: {} },
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
  assert.deepEqual([membership.sourceVersion, membership.payload], [sourceVersionFromTimestamp(alpha.updatedAt), { project: projectNodeId, contentKind: 'issue', contentExternalId: ALPHA, createdAt: alpha.createdAt }])
  assert.notEqual(content.sourceVersion, membership.sourceVersion, '沙箱里两套时间戳并不相等（E1-1 实验 1）')
  assert.deepEqual(second.map((o) => o.dedupeKey), first.map((o) => o.dedupeKey))
  assert.notEqual(second[0].receivedTime, first[0].receivedTime)
})

test('回放账本：本文件所有回放都没有未命中的请求', () => {
  assert.ok(replays.length > 0)
  assert.deepEqual(replays.flatMap((replay) => replay.misses), [])
})
