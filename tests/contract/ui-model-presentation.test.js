/**
 * ui-model 展示结构契约测试（issue #128）：全部用例建在 fixture 快照上，不触网、不需要凭据。用例名
 * 逐条点名它保护的不变量（tests/README.md §3）：三组展示结构由客户端模型派生；PR 支撑的条目是
 * change request 且不提供开始工作；动作可用性只来自 capability key 且来源标识不影响结论；陈旧 /
 * 不可达 / 从未读到都不返回"看起来正常的空列表"；首页与列表对同一份读取给出同一结论；谱系入口的
 * 必需 key 等于 core 真实的读门；四态求交与 capabilities 逐格一致；展示层不读时钟。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { CapabilityKey, intersectAccess } from '@harness-projects/capabilities'
import { createEntityStore } from '@harness-projects/client'
import {
  LineageTarget,
  deriveProjectsHome,
  deriveWorkItemDetail,
  deriveWorkItemList,
} from '@harness-projects/ui-model'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const WORKSPACE = { id: 'ws-mvp1', name: 'MVP-1' }
/** 宿主注入的"最后一次读到当前值"的时刻；展示层不得自己读时钟。 */
const LAST_UPDATED_AT = '2026-09-24T09:30:00.000Z'
/**
 * `reason` 是 display-ready 散文，降级必有解释。这三条是本层在两个输入都没给原因时补的中性短语，
 * 逐字冻结：provider 与宿主的原因优先，本层的只在缺位时出现。
 */
const DISCONNECTED_REASON = '连接已断开，显示的是最后已知值'
const NEVER_READ_REASON = '尚未读到当前值'
const STALE_ENTRY_REASON = '本地模型已把该条目标记为陈旧'

/** capability key 的取值是跨层契约：这里逐字写出，用来构造 fixture 快照。 */
const KEY = {
  branchCreate: 'development.branch.create', worktreeCreate: 'development.worktree.create',
  runStart: 'execution.run.start', runRead: 'execution.run.read',
  changeRequestRead: 'development.change_request.read', pipelineRead: 'delivery.pipeline.read',
  checkRead: 'delivery.check.read',
}

const START_WORK_KEYS = [KEY.branchCreate, KEY.worktreeCreate, KEY.runStart]

const allAvailable = () => Object.values(KEY).map((key) => ({ key, access: 'available' }))

/** wire 形状的条目：字段面与 packages/controller/src/wire.ts 的 WireEntity 一致。 */
function wireEntity({
  entityId, kind, planningStatus, contentKind, title, body,
  bindingId, externalKind, externalId, derived = [], freshness = 'fresh', revision = 1,
}) {
  return {
    entityId, kind, planningStatus,
    content: { contentKind, title, body, bindingId, externalKind, externalId },
    derived,
    source: { revision, freshness, authority: 'provider', reason: freshness === 'degraded' ? '规划来源离线' : undefined },
  }
}

/** fixture 快照：工作项 + PR 支撑的变更请求 + 遮蔽条目；`degraded` 时整份都是"最后已知"。 */
function fixtureSnapshot({ freshness = 'fresh', bindingId = 'binding-planning' } = {}) {
  const entities = [
    wireEntity({
      entityId: 'entity-work-item', kind: 'work_item', planningStatus: 'in_progress', contentKind: 'work_item',
      title: '接入真实规划源', body: '把真实项目的条目读进来', bindingId, externalKind: 'issue',
      externalId: '101', freshness, revision: 7,
    }),
    wireEntity({
      entityId: 'entity-change-request', kind: 'change_request', planningStatus: 'todo',
      contentKind: 'change_request', title: '把列表渲染出来', body: 'PR 支撑的规划条目',
      bindingId: 'binding-development', externalKind: 'change_request', externalId: '158',
      derived: ['attention'], freshness, revision: 8,
    }),
    wireEntity({
      entityId: 'entity-redacted', kind: 'work_item', planningStatus: 'unknown',
      contentKind: 'redacted', title: undefined, body: undefined,
      bindingId, externalKind: 'issue', externalId: '999', freshness, revision: 3,
    }),
  ]
  const source = { revision: 8, freshness, authority: 'provider', reason: freshness === 'degraded' ? '规划来源离线' : undefined }
  return { revision: 8, entities, source }
}

/** 一次工作区读取：客户端模型 + 宿主才知道的事实。`lastUpdatedAt: undefined` 用 `in` 判定。 */
function readFor(options = {}) {
  const {
    snapshot = fixtureSnapshot(),
    capabilities = allAvailable(),
    connected = true,
    reason = undefined,
  } = options
  const lastUpdatedAt = 'lastUpdatedAt' in options ? options.lastUpdatedAt : LAST_UPDATED_AT
  const store = createEntityStore()
  store.applyBaseline(snapshot)
  return { workspace: WORKSPACE, store, connection: { connected }, lastUpdatedAt, capabilities, reason }
}

const rowFor = (list, entityId) => list.rows.find((row) => row.entityId === entityId)
const actionIds = (row) => row.actions.map((action) => action.id)

/** 去掉"原样回显来源标识"的字段：用来断言标识**不影响任何结论**，只有回显字段可以变。 */
function withoutIdentityEcho(value) {
  const { source, ...rest } = value
  return { ...rest, ...(source === undefined ? {} : { source: { authority: source.authority } }) }
}

function listWithoutIdentityEcho(list) {
  return { ...list, rows: list.rows.map(withoutIdentityEcho) }
}

test('展示：项目首页给出工作区与派生的连接状态，而不是新的事实源', () => {
  const home = deriveProjectsHome([
    readFor(),
    readFor({ connected: false }),
    readFor({ snapshot: fixtureSnapshot({ freshness: 'degraded' }) }),
  ])

  assert.equal(home.workspaces.length, 3)
  const [connected, disconnected, degraded] = home.workspaces
  assert.deepEqual(connected.workspace, WORKSPACE, '工作区身份由宿主注入，展示层不发明')
  assert.equal(connected.connection, 'connected')
  assert.equal(disconnected.connection, 'disconnected', '未连接必须显示为未连接')
  assert.equal(degraded.connection, 'degraded', '有陈旧条目时连接状态是降级，不是"正常"')
  assert.equal(degraded.items.stale, 3, '降级时每个条目都算陈旧')
  assert.deepEqual(connected.items, {
    total: 3, stale: 0, byContentKind: { work_item: 1, change_request: 1, redacted: 1 },
  })
  assert.deepEqual(connected.sources, ['binding-development', 'binding-planning'], '来源去重且排序稳定')
  assert.equal(connected.lastUpdatedAt, LAST_UPDATED_AT)
  assert.equal(connected.revision, 8, '修订号来自客户端模型')
})

test('展示：列表行以规划条目为键，带内容种类、规划字段、来源与新鲜度', () => {
  const read = readFor()
  const list = deriveWorkItemList(read)

  assert.deepEqual(
    list.rows.map((row) => row.entityId),
    read.store.list().map((entry) => entry.entityId),
    '行以规划条目为键，顺序沿用客户端模型的稳定顺序',
  )
  const row = rowFor(list, 'entity-work-item')
  assert.equal(row.contentKind, 'work_item')
  assert.equal(row.planningStatus, 'in_progress')
  assert.equal(row.title, '接入真实规划源')
  assert.deepEqual(row.derived, [])
  assert.deepEqual(row.source.primary, {
    bindingId: 'binding-planning', externalKind: 'issue', externalId: '101',
  })
  assert.equal(row.source.authority, 'provider', '权威归属原样透出：页面不得把 host 权威显示成平台权威')
  assert.equal(row.freshness.stale, false)
  assert.equal(row.freshness.lastUpdatedAt, LAST_UPDATED_AT)
  assert.equal(row.freshness.reason, undefined)
  assert.equal(list.stale, false)
})

test('不变量 3：派生标记与规划状态是两个字段，派生标记不参与规划状态判定', () => {
  const row = rowFor(deriveWorkItemList(readFor()), 'entity-change-request')

  assert.equal(row.planningStatus, 'todo', '规划状态是权威值，逐字来自客户端模型')
  assert.deepEqual(row.derived, ['attention'], '派生标记只用于展示')
  assert.ok(!Object.values(row).includes('attention'), '派生标记不得混进其它字段')
})

test('不变量：PR 支撑的规划条目是 change request 行，且不提供"开始工作"动作', () => {
  const list = deriveWorkItemList(readFor())
  const changeRequest = rowFor(list, 'entity-change-request')
  const workItem = rowFor(list, 'entity-work-item')

  assert.equal(changeRequest.contentKind, 'change_request', 'PR 支撑的条目内容种类是 change request')
  assert.deepEqual(actionIds(changeRequest), [], 'PR 支撑的条目不提供开始工作')
  assert.deepEqual(actionIds(workItem), ['start_work'], '对照：工作项提供开始工作')

  const detail = deriveWorkItemDetail(readFor(), 'entity-change-request')
  assert.deepEqual(actionIds(detail), [], '详情同样不提供开始工作')
})

/** 对抗性来源标识：`gh-` 这类前缀能绕过黑名单，所以断言的是**性质**——标识怎么变结论都不变。 */
const ADVERSARIAL_BINDING_IDS = [
  'binding-planning', 'gh-projects', 'gh-1', 'gh', 'github', 'github-projects',
  'binding-github-projects', 'gitlab-binding', 'azure-devops', 'sqlite-local', '', '   ',
]

test('不变量：来源标识不影响任何结论——对抗性 bindingId 下动作与谱系入口逐条相同', () => {
  const baselineRead = readFor()
  const baselineDetail = deriveWorkItemDetail(baselineRead, 'entity-work-item')
  const baseline = {
    list: listWithoutIdentityEcho(deriveWorkItemList(baselineRead)),
    home: deriveProjectsHome([baselineRead]).workspaces[0],
    detail: withoutIdentityEcho(baselineDetail),
  }

  for (const bindingId of ADVERSARIAL_BINDING_IDS) {
    const read = readFor({ snapshot: fixtureSnapshot({ bindingId }) })
    const list = deriveWorkItemList(read)
    const home = deriveProjectsHome([read]).workspaces[0]
    const detail = deriveWorkItemDetail(read, 'entity-work-item')
    const row = rowFor(list, 'entity-work-item')
    const where = `bindingId=${JSON.stringify(bindingId)}`

    // 标识本身必须真的变了，否则这些断言没有判别力。
    assert.equal(row.source.primary.bindingId, bindingId, where)
    assert.ok(home.sources.includes(bindingId), `${where}：首页来源列表应回显标识`)

    assert.deepEqual(listWithoutIdentityEcho(list), baseline.list, `${where}：列表结论必须逐字相同`)
    assert.deepEqual(
      { ...home, sources: undefined }, { ...baseline.home, sources: undefined },
      `${where}：首页结论必须逐字相同（来源列表除外）`,
    )
    assert.deepEqual(withoutIdentityEcho(detail), baseline.detail, `${where}：详情结论必须逐字相同`)
    assert.deepEqual(detail.lineage, baselineDetail.lineage, `${where}：谱系入口必须逐字相同`)
    assert.deepEqual(actionIds(row), ['start_work'], where)
    assert.equal(row.actions[0].available, true, `${where}：能力齐全时开始工作必须可用`)
  }
})

test('不变量：四态映射——read_only / unavailable 阻断，degraded 可用但带降级标记', () => {
  const withAccess = (key, access) =>
    rowFor(deriveWorkItemList(readFor({
      capabilities: allAvailable().map((entry) => (entry.key === key ? { key, access } : entry)),
    })), 'entity-work-item').actions[0]

  const readOnly = withAccess(KEY.worktreeCreate, 'read_only')
  assert.equal(readOnly.available, false, '只读权限不能完成写动作')
  assert.equal(readOnly.access, 'read_only')
  assert.match(readOnly.reason, /development\.worktree\.create/, '原因必须点名 capability key')

  const unavailable = withAccess(KEY.runStart, 'unavailable')
  assert.equal(unavailable.available, false)
  assert.equal(unavailable.access, 'unavailable')

  const degraded = withAccess(KEY.branchCreate, 'degraded')
  assert.equal(degraded.available, true, 'degraded 是部分可用，不是不可用')
  assert.equal(degraded.access, 'degraded')
  assert.match(degraded.reason, /development\.branch\.create/)

  const unobserved = rowFor(deriveWorkItemList(readFor({ capabilities: [] })), 'entity-work-item').actions[0]
  assert.equal(unobserved.available, false, '未观测到能力不得当成可用')
  assert.equal(unobserved.access, 'unavailable')

  const unrelated = rowFor(deriveWorkItemList(readFor({
    capabilities: [...allAvailable(), { key: KEY.pipelineRead, access: 'unavailable' }],
  })), 'entity-work-item').actions[0]
  assert.equal(unrelated.available, true, '与开始工作无关的 key 不可用，不改变开始工作的结论')
})

test('不变量：只读凭据下谱系入口仍然可用——读目标不被 read_only 阻断（与 core 的写门一致）', () => {
  const readOnlyRead = readFor({
    capabilities: Object.values(KEY).map((key) => ({ key, access: 'read_only' })),
  })
  const detail = deriveWorkItemDetail(readOnlyRead, 'entity-work-item')

  assert.equal(detail.lineage.length, 4)
  for (const entry of detail.lineage) {
    assert.equal(entry.available, true, `${entry.target} 是只读导航，read_only 不得阻断它`)
    if (entry.requiredKeys.length === 0) {
      assert.equal(entry.access, 'available', `${entry.target} 没有读门，没有任何能力能约束它的级别`)
      assert.equal(entry.reason, undefined)
    } else {
      assert.equal(entry.access, 'read_only', `${entry.target} 必须原样透出只读级别`)
      assert.match(entry.reason, /^capability /, `${entry.target} 的只读说明要点名 capability key`)
    }
  }
  assert.equal(detail.actions[0].available, false, '对照：同一份只读凭据下写动作不可用')
  assert.equal(detail.actions[0].access, 'read_only')

  const unavailableRead = readFor({
    capabilities: Object.values(KEY).map((key) => ({ key, access: 'unavailable' })),
  })
  for (const entry of deriveWorkItemDetail(unavailableRead, 'entity-work-item').lineage) {
    const gated = entry.requiredKeys.length > 0
    assert.equal(entry.available, !gated, `${entry.target}：只有真有读门的入口才被能力不可用关掉`)
  }
})

test('不变量：陈旧快照的列表非空，每行标 stale 且带最后更新时间', () => {
  const list = deriveWorkItemList(readFor({ snapshot: fixtureSnapshot({ freshness: 'degraded' }) }))

  assert.ok(list.rows.length > 0, '陈旧快照绝不返回空列表')
  assert.equal(list.rows.length, 3)
  assert.equal(list.stale, true)
  for (const row of list.rows) {
    assert.equal(row.freshness.stale, true, `${row.entityId} 必须标记为陈旧`)
    assert.equal(row.freshness.lastUpdatedAt, LAST_UPDATED_AT, `${row.entityId} 必须带最后更新时间`)
    assert.equal(row.freshness.reason, '规划来源离线', `${row.entityId} 必须带上降级原因`)
  }
  assert.equal(rowFor(list, 'entity-work-item').planningStatus, 'in_progress', '陈旧值仍然是最后已知值，不是空值')
})

test('不变量：缺口窗口里旧值不是当前值，但列表仍给出最后已知行', () => {
  const read = readFor({ reason: '重连中，等待新的基线' })
  const freshRow = rowFor(deriveWorkItemList(read), 'entity-work-item')
  assert.equal(freshRow.freshness.stale, false)
  assert.equal(freshRow.freshness.reason, undefined, '新鲜行不得挂上连接降级说明')

  read.store.markAllStale()
  const list = deriveWorkItemList(read)

  assert.equal(list.rows.length, 3, '缺口期间保留最后已知行，而不是清空')
  assert.ok(list.rows.every((row) => row.freshness.stale === true))
  assert.equal(
    rowFor(list, 'entity-work-item').freshness.reason, '重连中，等待新的基线',
    '条目自身没有降级原因时，用宿主已知的连接原因解释这次陈旧',
  )
  assert.equal(deriveProjectsHome([read]).workspaces[0].connection, 'degraded')
})

test('不变量：连接不可用时最后已知行一律标陈旧，首页与列表不得给出相反结论', () => {
  const read = readFor({ connected: false })
  const list = deriveWorkItemList(read)
  const home = deriveProjectsHome([read]).workspaces[0]

  assert.equal(home.connection, 'disconnected')
  assert.equal(list.connection, 'disconnected', '同一份读取在首页与列表必须得到同一连接状态')
  assert.equal(list.stale, true, '连接不可用时整表不是当前值')
  assert.equal(list.reason, DISCONNECTED_REASON)
  assert.equal(home.reason, list.reason, '首页与列表的解释必须逐字相同')
  assert.equal(list.rows.length, 3, '不可达不清空最后已知行')
  for (const row of list.rows) {
    assert.equal(row.freshness.stale, true, `${row.entityId}：连接不可用时最后已知值不是当前值`)
    assert.equal(row.freshness.reason, DISCONNECTED_REASON, `${row.entityId} 必须带降级原因`)
    assert.equal(row.freshness.lastUpdatedAt, LAST_UPDATED_AT, '最后更新时间仍可见，页面显示"最后已知于"')
  }
  assert.equal(home.items.stale, 3, '首页的陈旧计数与行的结论同一规则')
  assert.equal(deriveWorkItemDetail(read, 'entity-work-item').freshness.stale, true, '详情与列表同一规则')
})

test('不变量：从未读到当前值时不冒充当前值，零条目也不长得像正常空态', () => {
  const empty = { revision: 0, entities: [], source: { revision: 0, freshness: 'fresh', authority: 'provider', reason: undefined } }
  const disconnected = readFor({ snapshot: empty, connected: false, lastUpdatedAt: undefined })
  const list = deriveWorkItemList(disconnected)
  const home = deriveProjectsHome([disconnected]).workspaces[0]

  assert.deepEqual(list.rows, [], '确实没有任何条目时行列表为空')
  assert.equal(list.stale, true, '空列表也必须带降级信号，不得看起来正常')
  assert.equal(list.connection, 'disconnected')
  assert.equal(list.reason, DISCONNECTED_REASON)
  assert.equal(list.lastUpdatedAt, undefined, '从未读到当前值时没有"最后更新时间"，页面不得显示时间')
  assert.equal(home.connection, 'disconnected')
  assert.equal(home.items.total, 0)
  assert.equal(home.lastUpdatedAt, undefined)
  assert.equal(home.reason, DISCONNECTED_REASON)

  // 宿主说"已连接"但从未给过最后更新时间：同样是降级，不是"一切正常"。
  const connectedButNeverRead = readFor({ lastUpdatedAt: undefined })
  const degraded = deriveWorkItemList(connectedButNeverRead)
  assert.equal(degraded.connection, 'degraded')
  assert.equal(degraded.reason, NEVER_READ_REASON)
  assert.equal(deriveProjectsHome([connectedButNeverRead]).workspaces[0].reason, NEVER_READ_REASON)
  assert.equal(degraded.lastUpdatedAt, undefined)
  for (const row of degraded.rows) {
    assert.equal(row.freshness.stale, true)
    assert.equal(row.freshness.lastUpdatedAt, undefined)
  }
})

test('不变量：redacted 内容不回退到缓存标题，规划字段如实显示为 unknown', () => {
  const list = deriveWorkItemList(readFor())
  const row = rowFor(list, 'entity-redacted')

  assert.equal(row.contentKind, 'redacted')
  assert.equal(row.title, undefined, '页面必须显示占位，不得回退到缓存标题')
  assert.equal(row.planningStatus, 'unknown')

  const detail = deriveWorkItemDetail(readFor(), 'entity-redacted')
  assert.equal(detail.planning.title, undefined)
  assert.equal(detail.planning.body, undefined)
  assert.equal(detail.planning.contentKind, 'redacted')

  // 上游若回归、给 redacted 条目带上缓存标题，本层也必须挡住（Decision Log D8）
  const leaky = fixtureSnapshot()
  leaky.entities = leaky.entities.map((entity) =>
    entity.content.contentKind === 'redacted'
      ? { ...entity, content: { ...entity.content, title: '缓存里的旧标题', body: '缓存里的旧正文' } }
      : entity,
  )
  const leakedRead = readFor({ snapshot: leaky })
  assert.equal(rowFor(deriveWorkItemList(leakedRead), 'entity-redacted').title, undefined,
    '上游带了缓存标题也不得透出')
  assert.equal(deriveWorkItemDetail(leakedRead, 'entity-redacted').planning.body, undefined,
    '上游带了缓存正文也不得透出')
})

test('展示：统一详情给出规划段、来源身份与谱系入口，不在模型里的条目返回 undefined', () => {
  const read = readFor()
  const detail = deriveWorkItemDetail(read, 'entity-work-item')

  assert.equal(detail.entityId, 'entity-work-item')
  assert.deepEqual(detail.planning.status, 'in_progress')
  assert.deepEqual(detail.planning.derived, [])
  assert.equal(detail.source.primary.externalId, '101')
  assert.deepEqual(detail.source.identities.map((identity) => identity.externalKind), ['issue'])
  assert.deepEqual(
    detail.lineage.map((entry) => entry.target).sort(),
    Object.values(LineageTarget).sort(),
    '谱系入口给出全部稳定 target，文案归页面',
  )
  assert.ok(detail.lineage.every((entry) => entry.available === true), '能力齐全时入口都可用')

  const withoutCapabilities = deriveWorkItemDetail(readFor({ capabilities: [] }), 'entity-work-item')
  for (const entry of withoutCapabilities.lineage) {
    const gated = entry.requiredKeys.length > 0
    assert.equal(entry.available, !gated, `${entry.target}：未观测到能力只关掉真有读门的入口`)
    if (gated) assert.match(entry.reason, /^capability /, '不可用原因点名缺失的 capability key')
  }
  assert.equal(deriveWorkItemDetail(read, 'entity-missing'), undefined, '不在模型里的条目不造空壳')
})

test('不变量：展示层不读时钟——同一输入得到同一输出，坏时间响亮失败', () => {
  const read = readFor()
  assert.deepEqual(deriveWorkItemList(read), deriveWorkItemList(read), '纯函数：重复调用逐字相同')
  assert.deepEqual(deriveProjectsHome([read]), deriveProjectsHome([read]))
  // 契约是 ISO 8601，检查就必须是 ISO 8601：`Date.parse` 能接受下面这些形态，但契约不允许。
  for (const loose of ['不是时间', '', '2026-13-45', '2026', '09/24/2026', '2026-09-24', '2026-09-24T09:30:00']) {
    assert.throws(() => deriveWorkItemList({ ...read, lastUpdatedAt: loose }), TypeError,
      `不合 ISO 8601 的时间必须被拒：${JSON.stringify(loose)}`)
  }
  assert.throws(() => deriveProjectsHome([{ ...read, lastUpdatedAt: '' }]), TypeError)
  assert.throws(() => deriveWorkItemDetail({ ...read, lastUpdatedAt: '2026-13-45T00:00:00Z' }, 'entity-work-item'), TypeError,
    '正则放行但日期不存在的形态也必须被拒')
})

test('结构：fixture 快照与 wire 的字段面机械同形（wire 增删字段时这里必须变红）', () => {
  // fixture 是 .js 且 tsconfig 不检查 tests/**，"同形"必须机械钉住，否则 wire.ts 增删字段时静默漂移。
  const wireSource = readFileSync(path.join(repoRoot, 'packages', 'controller', 'src', 'wire.ts'), 'utf8')
  const interfaceFields = (name) => {
    const body = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(wireSource)
    assert.ok(body !== null, `wire.ts 里找不到 export interface ${name}`)
    return [...body[1].matchAll(/readonly\s+([A-Za-z0-9_]+)\s*[?:]/g)].map((match) => match[1]).sort()
  }
  const fixture = wireEntity({
    entityId: 'entity-x', kind: 'work_item', planningStatus: 'todo', contentKind: 'work_item',
    title: 't', body: 'b', bindingId: 'binding-x', externalKind: 'issue', externalId: '1',
  })

  assert.deepEqual(Object.keys(fixture).sort(), interfaceFields('WireEntity'), 'WireEntity 字段面')
  assert.deepEqual(Object.keys(fixture.content).sort(), interfaceFields('WireContentRef'), 'WireContentRef 字段面')
  assert.deepEqual(Object.keys(fixture.source).sort(), interfaceFields('SourceMetadata'), 'SourceMetadata 字段面')
  assert.deepEqual(Object.keys(fixtureSnapshot()).sort(), interfaceFields('WireSnapshot'), 'WireSnapshot 字段面')
})

test('不变量：本层输出的每个 capability key 都在 CapabilityKey 表里（key 表是唯一权威）', () => {
  const known = new Set(Object.values(CapabilityKey))
  const emitted = [
    ...deriveWorkItemList(readFor()).rows.flatMap((row) => row.actions.flatMap((action) => action.requiredKeys)),
    ...deriveWorkItemDetail(readFor(), 'entity-work-item').lineage.flatMap((entry) => entry.requiredKeys),
  ]

  assert.ok(emitted.length >= 6, '必须覆盖开始工作与三个有读门的谱系入口的必需 key')
  for (const key of emitted) {
    assert.ok(known.has(key), `展示层使用的 capability key「${key}」不在 CapabilityKey 表里`)
  }
})

test('结构：packages/ui-model/src 不含平台名或界面框架名片段，也不 import provider', () => {
  // 平台名只允许出现在 provider 实现里；本层是调用方，出现即代表"按名字分支"。
  // `@harness-projects/` 作用域先剥掉：包名本身含 harness，不属于平台名。`local` / `harness` 这类
  // 宽片段不进黑名单（会误伤 `locale` / `localeCompare`），性质断言（对抗性 bindingId）才是主网。
  const forbidden = ['github', 'gitlab', 'bitbucket', 'jira', 'linear', 'asana', 'trello', 'notion', 'azure', 'sqlite', 'react']
  const dir = path.join(repoRoot, 'packages', 'ui-model', 'src')
  const files = readdirSync(dir).filter((name) => name.endsWith('.ts'))
  assert.ok(files.length > 0, 'packages/ui-model/src 必须有源文件')

  for (const name of files) {
    const source = readFileSync(path.join(dir, name), 'utf8')
    const scanned = source.replaceAll(/@harness-projects\/?/g, '')
    for (const fragment of forbidden) {
      assert.ok(
        !scanned.toLowerCase().includes(fragment),
        `packages/ui-model/src/${name} 含片段「${fragment}」：调用方不得按 provider 名或界面框架分支`,
      )
    }
    assert.ok(!/from\s+['"][^'"]*\/provider/.test(source), `${name} 不得 import provider`)
  }
})

/** 根因组 A（评审 P2-1）：降级只算一次。首页曾回退到条目自身的原因、列表只看连接层，同一份读取在两处
 * 给出相反结论，`home` 还可能 `degraded` 却完全不带原因。 */
test('不变量：同一份读取在首页与列表给出同一个降级原因，降级绝不无原因', () => {
  const bare = fixtureSnapshot({ freshness: 'degraded' })
  bare.entities = bare.entities.map((e) => ({ ...e, source: { ...e.source, reason: undefined } }))
  bare.source = { ...bare.source, reason: undefined }
  const cases = [
    ['未连接', readFor({ connected: false })],
    ['未连接 + 宿主原因', readFor({ connected: false, reason: '宿主：网络已断开' })],
    ['条目自身原因', readFor({ snapshot: fixtureSnapshot({ freshness: 'degraded' }) })],
    ['陈旧但无任何原因', readFor({ snapshot: bare })],
    ['从未读到当前值', readFor({ lastUpdatedAt: undefined })],
  ]
  for (const [where, read] of cases) {
    const list = deriveWorkItemList(read)
    const home = deriveProjectsHome([read]).workspaces[0]
    assert.notEqual(list.connection, 'connected', `${where}：必须判为降级`)
    assert.equal(home.connection, list.connection, `${where}：首页与列表的连接状态必须一致`)
    assert.ok(list.reason !== undefined && list.reason.length > 0, `${where}：降级必须有解释`)
    assert.equal(home.reason, list.reason, `${where}：同一份读取不得在两处给出相反解释`)
  }
  assert.equal(deriveWorkItemList(cases[1][1]).reason, '宿主：网络已断开', '宿主给的原因优先')
  assert.equal(deriveWorkItemList(cases[2][1]).reason, '规划来源离线', '其次条目自身的原因')
  assert.equal(deriveWorkItemList(cases[3][1]).reason, STALE_ENTRY_REASON, '两个输入都没给原因时本层必须补一条')
})

/** 根因组 B（评审 P2-2）：谱系入口的必需 key 必须等于 core 读该事实时真正经过的门。 */
test('不变量：谱系入口的必需 key 精确等于 core 真实的读门', () => {
  const entryOf = (capabilities, target) =>
    deriveWorkItemDetail(readFor({ capabilities }), 'entity-work-item').lineage.find((e) => e.target === target)

  assert.deepEqual(entryOf(allAvailable(), 'execution_context').requiredKeys, [],
    'execution_context 由 core 直接读本地存储，没有任何读门')
  assert.deepEqual(entryOf(allAvailable(), 'change_request').requiredKeys, [KEY.changeRequestRead])
  assert.deepEqual(entryOf(allAvailable(), 'pipeline_run').requiredKeys, [KEY.pipelineRead])
  assert.deepEqual(entryOf(allAvailable(), 'check_run').requiredKeys, [KEY.checkRead])

  const runReadOff = allAvailable().map((e) => (e.key === KEY.runRead ? { key: KEY.runRead, access: 'unavailable' } : e))
  const executionContext = entryOf(runReadOff, 'execution_context')
  assert.equal(executionContext.available, true, 'execution.run.read 不是 core 读执行上下文的门，它不可用不得关掉这个入口')
  assert.equal(executionContext.access, 'available')
  assert.equal(executionContext.reason, undefined)
})

/** 根因组 C（评审 P3-5）：四态求交不是第二个权威源——与 capabilities 的 `intersectAccess` 逐格差分。 */
test('不变量：四态求交与 capabilities 的 intersectAccess 逐格一致（4×4×4）', () => {
  const LEVELS = ['available', 'read_only', 'degraded', 'unavailable']
  const seen = []
  for (const a of LEVELS) for (const b of LEVELS) for (const c of LEVELS) {
    const levels = [a, b, c]
    const action = deriveWorkItemList(readFor({
      capabilities: START_WORK_KEYS.map((key, index) => ({ key, access: levels[index] })),
    })).rows.find((row) => row.entityId === 'entity-work-item').actions[0]
    assert.equal(action.access, intersectAccess(a, b, c), `求交(${levels.join(', ')})`)
    assert.equal(action.available, levels.every((level) => level !== 'read_only' && level !== 'unavailable'),
      `写动作在 ${levels.join('/')} 下的可用性`)
    seen.push(action.access)
  }
  assert.equal(seen.length, 64, '必须逐格覆盖 4×4×4')
})

/** 评审 P3-3：不可用说明逐 key 给出**它自己的**级别，合成级别不等于任何单个 key 的级别。 */
test('不变量：不可用说明逐 key 给出它自己的级别，不是合成级别', () => {
  const action = deriveWorkItemList(readFor({
    capabilities: [
      { key: KEY.branchCreate, access: 'read_only' }, { key: KEY.worktreeCreate, access: 'degraded' },
      { key: KEY.runStart, access: 'available' },
    ],
  })).rows.find((row) => row.entityId === 'entity-work-item').actions[0]

  assert.equal(action.access, 'read_only', '合成级别是 read_only')
  assert.match(action.reason, /development\.branch\.create = read_only/)
  assert.match(action.reason, /development\.worktree\.create = degraded/, 'degraded 的 key 不得被写成合成级别')
  assert.equal(action.reason.includes(KEY.runStart), false, '可用的 key 不进不可用说明')
})
