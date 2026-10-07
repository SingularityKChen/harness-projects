/**
 * core 经 GitHub Projects provider 引导沙箱 Project A（录制夹具回放，不触网；替身与 SQLite 两种 Storage 各一轮）。保护的不变量：
 * (1) 9 个条目得到 8 个工作项与 1 个变更请求；外部身份恰好是内容 node id、没有成员关系 id；本地实体 id 不是任何 node id（R1）；
 * (2) 重复引导幂等：两种 Storage 上实体 id 集合不变，替身上另读行数（实体 9、身份 9、观察 18）；
 * (3) 故障（离线、部分成功）不伪造成功：同步游标 degraded，投影保持最后已知值并带 freshness.degraded；(4) 回放没有未命中；
 * (5) 内容被扣下：有成员关系映射时出剥离正文的 redacted 占位（实体不变、不泄露），没有映射时整次标 degraded / permission_denied 且可查询；
 * (6) 分页游标成环或永不收敛时，真实组装路径有界返回结构化 degraded。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { createController, createControllerQueries } from '@harness-projects/controller'
import { createEntityStore } from '@harness-projects/client'
import { composeCore } from '@harness-projects/core'
import { newProviderBindingId, newWorkspaceId } from '@harness-projects/domain'
import { createFakeStorage, exportFakeStorageState } from '@harness-projects/provider-fake'
import { createGithubProjectsPlanningProvider } from '@harness-projects/provider-planning-github-projects'
import { WorkItemListPage } from '@harness-projects/ui'
import { deriveWorkItemListView } from '@harness-projects/ui-model'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { createReplay, loadAggregateFixture } from '../contract/fixtures/github-projects/replay.js'

/**
 * 当前查询文本的完整录制：`PlanningItems` 在 #133 增了 `fieldValues`，旧条目夹具的它已过期，
 * 合并字段录制后同一键由新响应覆盖。引导用例测的是「core 在本轮查询形状下能读到什么」，
 * 因此必须用合并夹具；字段读取面之外的断言仍逐条绑定真实录制内容。
 */
const fixture = loadAggregateFixture()
const projectNodeId = fixture.exchanges.find((exchange) => exchange.operationName === 'PlanningProject').variables.project
const nodes = fixture.exchanges.flatMap((exchange) => exchange.body.data.node.items?.nodes ?? [])
const nodeIds = new Set(nodes.flatMap((node) => [node.id, node.content.id]))
const contentIds = [...new Set(nodes.map((node) => node.content.id))].sort()
const REJECT = async () => { throw new Error('offline') }
const PARTIAL = async () => ({ status: 200, headers: {}, body: { data: { node: { __typename: 'ProjectV2', items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }, errors: [{ type: 'FORBIDDEN' }] } })
const misses = []
/** 在回放之上把选中的条目改成 REDACTED（content 为 null）；renamed 为真时同时换掉成员关系 id（本地映射因此失效）。 */
const redacting = (base, hidden, renamed = false) => async (request) => {
  const response = await base(request)
  for (const node of response.body.data.node.items?.nodes ?? []) {
    if (hidden.has(node.content?.id)) Object.assign(node, { type: 'REDACTED', content: null, id: renamed ? `${node.id}x` : node.id })
  }
  return response
}
/** 按 after 应答的分页：nodes 为空，hasNextPage 恒真，endCursor 由 nextOf 给出；第 limit 次调用起 reject（看门狗）。 */
function paging(nextOf, limit) {
  const counter = { items: 0, all: 0 }
  const transport = async ({ operationName, variables }) => {
    if ((counter.all += 1) > limit) throw new Error('watchdog')
    if (operationName === 'PlanningProject') return { status: 200, headers: {}, body: structuredClone(fixture.exchanges.find((exchange) => exchange.operationName === 'PlanningProject').body) }
    counter.items += 1
    return { status: 200, headers: {}, body: { data: { node: { __typename: 'ProjectV2', items: { pageInfo: { hasNextPage: true, endCursor: nextOf(variables.after) }, nodes: [] } } } } }
  }
  return { counter, transport }
}

/** transport 是可切换的包装：先指向 route 由本回放派生的 transport（默认即回放本身，回放都进账本），故障用例里切走。 */
async function assemble(storage, route = (transport) => transport) {
  const replay = createReplay(fixture)
  misses.push(replay.misses)
  let current = route(replay.transport)
  const bindingId = newProviderBindingId()
  const planning = createGithubProjectsPlanningProvider({ bindingId, projectNodeId, transport: (request) => current(request) })
  const project = { bindingId, objectKind: 'project', externalId: projectNodeId, url: undefined }
  const core = await composeCore({ workspace: { id: newWorkspaceId(), name: 'GitHub Projects', project }, providers: { planning, storage } })
  const views = () => core.queries.listPlanningItems()
  return { core, views, replay: replay.transport, switchTransport: (transport) => { current = transport } }
}

for (const [label, makeStorage] of [['替身 Storage', createFakeStorage], ['SQLite Storage', () => createSqliteStorage(':memory:')]]) {
  test(`${label}：引导得到 8 个工作项与 1 个变更请求，身份只有内容 node id，重复引导幂等`, async () => {
    const storage = makeStorage()
    const { core, views } = await assemble(storage)
    const entityIds = async () => (await views()).map((view) => view.entityId).sort()
    const firstIds = await entityIds()
    const { ok, entities, workItems, changeRequests, unanchored } = await core.commands.bootstrapWorkspace()
    assert.deepEqual({ ok, entities, workItems, changeRequests, unanchored }, { ok: true, entities: 9, workItems: 8, changeRequests: 1, unanchored: 0 })
    const after = await views()
    assert.deepEqual(after.map((view) => `${view.kind}/${view.content.contentKind}`).sort(), ['change_request/change_request', ...Array(8).fill('work_item/work_item')], 'PR 成员关系不产生工作项')
    assert.deepEqual(after.map((view) => view.content.identity.externalId).sort(), contentIds, '身份恰好是 9 个内容 node id，没有成员关系 id（R1）')
    assert.ok(after.every((view) => !nodeIds.has(view.entityId)), 'node id 不得作本地主键')
    assert.deepEqual(await entityIds(), firstIds, '重复引导不新建实体')
    const rows = makeStorage === createFakeStorage ? exportFakeStorageState(storage) : undefined
    if (rows !== undefined) assert.deepEqual([rows.entities.length, rows.identities.length, rows.observations.length], [9, 9, 18])
    storage.close?.()
  })

  test(`${label}：未见过 → 可见 → 部分 / 全部 REDACTED → 映射失效 → 恢复：占位不泄露、实体不重复，缺口可查询`, async () => {
    const storage = makeStorage()
    const all = new Set(contentIds)
    const texts = nodes.flatMap((node) => [node.content.title, node.content.body])
    const { core, views, replay, switchTransport } = await assemble(storage, (transport) => redacting(transport, all))
    const wire = () => createControllerQueries(core, 'provider').snapshot()
    const state = async () => [await core.queries.getPlanningSync(), (await wire()).source.freshness]
    assert.deepEqual([await views(), ...await state()], [[], { degraded: true, stale: false, reason: 'permission_denied' }, 'degraded'], '没有映射：整次不完整，0 条时也可查询')
    switchTransport(replay)
    assert.equal((await core.commands.bootstrapWorkspace()).ok, true)
    const firstIds = (await views()).map((view) => view.entityId).sort()
    for (const [hidden, renamed, expected] of [[new Set(contentIds.slice(0, 3)), false, 3], [all, false, 9], [all, true, 0]]) {
      switchTransport(redacting(replay, hidden, renamed))
      const { ok, degraded, unanchored, error, changeRequests } = await core.commands.bootstrapWorkspace()
      const after = await views()
      const shown = JSON.stringify([after, await Promise.all(after.map((view) => core.queries.getItemDetail(view.entityId)))])
      assert.deepEqual([ok, degraded, unanchored, error?.code, changeRequests], renamed ? [true, true, 9, 'permission_denied', 0] : [true, false, 0, undefined, 1], '被扣下的 PR 按映射仍计为变更请求')
      assert.equal(after.filter((view) => view.content.contentKind === 'redacted').length, expected)
      assert.ok(after.every((view) => firstIds.includes(view.entityId) && (view.content.contentKind !== 'redacted' || view.content.title === undefined)))
      assert.deepEqual(texts.filter((text, index) => hidden.has(nodes[Math.floor(index / 2)].content.id) && shown.includes(text)), [], '被扣下内容的标题与正文不得出现')
      assert.deepEqual((await state())[0].degraded, renamed)
      const snapshot = await wire()
      assert.deepEqual(contentIds.filter((id) => hidden.has(id) && JSON.stringify(snapshot).includes(id)), [], 'H12：被扣下条目的内容 node id 不得出现在 wire 快照里')
      assert.deepEqual(snapshot.entities.filter(({ content }) => content.contentKind === 'redacted').map(({ content }) => [content.externalKind, content.externalId]), Array(expected).fill([undefined, undefined]), 'H12：内容种类也不出 wire')
    }
    switchTransport(replay)
    assert.equal((await core.commands.bootstrapWorkspace()).ok, true)
    switchTransport(redacting(replay, new Set(contentIds.slice(0, 3)), true))
    const partial = await core.commands.bootstrapWorkspace()
    const rows = await views()
    const visible = (await wire()).entities
    assert.deepEqual([partial.ok, partial.degraded, partial.unanchored, partial.error?.code, rows.length], [true, true, 3, 'permission_denied', 6], 'H11：3 条无映射，其余 6 条照常提交')
    assert.deepEqual([rows.map((view) => view.freshness.degraded), visible.map((entity) => entity.source.freshness)], [Array(6).fill(false), Array(6).fill('fresh')], 'H11：本次读取刚确认的可见行不得标 stale')
    assert.deepEqual(await state(), [{ degraded: true, stale: false, reason: 'permission_denied' }, 'degraded'], 'H11：读取层仍 degraded')
    assert.ok(visible.every((entity) => entity.content.externalId !== undefined), '可见条目的身份仍给界面回指来源')
    switchTransport(replay)
    assert.equal((await core.commands.bootstrapWorkspace()).ok, true)
    assert.deepEqual((await views()).map((view) => view.entityId).sort(), firstIds, '恢复后解析回同一批实体')
    assert.deepEqual(await state(), [{ degraded: false, stale: false, reason: undefined }, 'fresh'])
    storage.close?.()
  })

  test(`${label}：故障（离线、部分成功、分页成环或永不收敛）有界返回结构化 degraded，不伪造成功，投影保持最后已知值`, async () => {
    const storage = makeStorage()
    const cycle = paging((after) => ({ null: 'A', A: 'B', B: 'A' })[String(after)], 50)
    const { core, views, replay, switchTransport } = await assemble(storage, () => cycle.transport)
    assert.deepEqual([cycle.counter.items, await views(), await core.queries.getPlanningSync()], [6, [], { degraded: true, stale: true, reason: 'unavailable' }], '首轮组装：扫描与逐页读取各 3 页后停止')
    switchTransport(replay)
    await core.commands.bootstrapWorkspace()
    const snapshot = async () => (await views()).map((view) => [view.entityId, view.planningStatus, view.content])
    const before = await snapshot()
    const endless = paging((after) => `c${after === null ? 1 : Number(after.slice(1)) + 1}`, 1600)
    for (const [transport, code, pages] of [[REJECT, 'unavailable'], [PARTIAL, 'permission_denied'], [cycle.transport, 'unavailable', [cycle, 12]], [endless.transport, 'unavailable', [endless, 1500]]]) {
      switchTransport(transport)
      const result = await core.commands.bootstrapWorkspace()
      assert.deepEqual([result.ok, result.degraded, result.error?.code], [false, true, code])
      if (pages !== undefined) assert.deepEqual([pages[0].counter.items, /成环或超过页数上界/.test(result.error.message)], [pages[1], true], '成环停在第 3 页；永不收敛停在扫描 500 页、逐页读取 1000 页')
      assert.deepEqual(await snapshot(), before, '故障不得清掉或改动投影')
      assert.ok((await views()).every((view) => view.freshness.degraded === true))
      assert.equal((await core.queries.getPlanningSync()).stale, true, 'H11：读取彻底失败时旧投影仍是 stale')
    }
    storage.close?.()
  })
}

test('回放账本：本文件所有回放都没有未命中的请求', () => {
  assert.ok(misses.length > 0)
  assert.deepEqual(misses.flat(), [])
})

/** 字段录制的回放：Provider → composeCore（显式映射）→ controller → client store → ui-model → 真实列表 HTML。 */
const fieldsFixture = JSON.parse(readFileSync(new URL('../contract/fixtures/github-projects/project-fields.json', import.meta.url), 'utf8'))
const WANTED_CONTENT_ID = 'I_kwDOUjWAl88AAAABST4XVQ'
/** 映射取录制里的真实 field id：Status 选项 f75ad846→todo、47fc9ee4→in_progress、98236657→done。 */
const FIELD_MAPPING = {
  status: {
    projectFieldId: 'PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY',
    options: { 'f75ad846': 'todo', '47fc9ee4': 'in_progress', '98236657': 'done' },
  },
  iterationFieldId: 'PVTIF_lAHOAY1ahM4BkJ9rzhi7k9M',
  targetDateFieldId: 'PVTF_lAHOAY1ahM4BkJ9rzhi7k9I',
}
const uiRequire = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const { createElement: h } = uiRequire('react')
const { renderToStaticMarkup } = uiRequire('react-dom/server')

test('recorded fields reach real list HTML through both stores', async () => {
  for (const [label, makeStorage] of [['替身 Storage', createFakeStorage], ['SQLite Storage', () => createSqliteStorage(':memory:')]]) {
    const storage = makeStorage()
    const replay = createReplay(fieldsFixture)
    const bindingId = newProviderBindingId()
    const planning = createGithubProjectsPlanningProvider({ bindingId, projectNodeId, transport: replay.transport })
    const project = { bindingId, objectKind: 'project', externalId: projectNodeId, url: undefined }
    const core = await composeCore({
      workspace: { id: newWorkspaceId(), name: 'GitHub Projects', project, planningFieldMapping: { bindingId, projectExternalId: projectNodeId, ...FIELD_MAPPING } },
      providers: { planning, storage },
    })
    assert.equal((await core.commands.bootstrapWorkspace()).ok, true, `${label}：字段读取闭环可引导`)

    const controller = createController(core)
    const snapshot = await controller.baseline()
    assert.deepEqual(replay.misses, [], `${label}：字段回放没有未命中`)
    const store = createEntityStore()
    store.applyBaseline(snapshot)
    const entry = store.list().find((stored) => stored.entity.content.externalId === WANTED_CONTENT_ID)
    assert.ok(entry !== undefined, `${label}：录制条目经内容 id 进入客户端模型`)
    const read = { workspace: snapshot.workspace, store, connection: { connected: true }, lastUpdatedAt: '2026-10-06T00:00:00.000Z', capabilities: snapshot.capabilities }
    const view = deriveWorkItemListView({ read, metadata: { planningSourceName: '规划源', sourceNames: {} }, phase: 'received', refreshing: false })
    const html = renderToStaticMarkup(h(WorkItemListPage, { view }))

    assert.match(html, /E1 Sprint 1/, `${label}：迭代 title 到达真实 HTML`)
    assert.match(html, /2026-09-24/, `${label}：目标日期到达真实 HTML`)
    assert.match(html, /进行中/, `${label}：映射后的规范状态文本到达真实 HTML`)
    assert.doesNotMatch(html, /Done（未映射）/, `${label}：该条目已映射，不得显示未映射提示`)
    storage.close?.()
  }
})
