/**
 * 统一只读详情投影契约（issue #130）：目标工作区检查 → 既有列表读门 → 安全行 → 白名单 content。合成数据，不触网、不读时钟。
 * 保护：scope 先于 store、阻断态不借缓存、redacted 字段全消、选中行新鲜度不随整表 partial 漂移、缺项只报未确认。
 * 每个场景配可见内容正控，防“全部隐藏”空绿。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createEntityStore } from '@harness-projects/client'
import { deriveWorkItemDetailView, deriveWorkItemListView } from '@harness-projects/ui-model'
import { CANARIES, T, redacted, wire } from '../fixtures/work-item-wire.mjs'

const READ = 'planning.item.read'
const TARGET = { projectId: 'ws-1', itemId: 'ent-aa' }
const VISIBLE = wire('ent-aa', { content: { title: 'VISIBLE-TITLE', body: 'VISIBLE-BODY' } })

/** 计数包装：list/get 各计一次，仍委托真实 store（保留排序与 stale 语义）；hideGet 模拟安全行存在但详情取不到。 */
function make(phase, { entities = [], access = 'available', capabilities, hideGet = false, tear, read = {}, ...rest } = {}) {
  const store = createEntityStore()
  store.applyBaseline({ revision: 0, entities, source: { revision: 0, freshness: 'fresh', authority: 'provider', reason: undefined } })
  const counts = { list: 0, get: 0 }
  const list = store.list.bind(store)
  store.list = () => (counts.list += 1, list())
  const get = store.get.bind(store)
  store.get = (entityId) => (counts.get += 1, hideGet ? undefined : tear === undefined ? get(entityId) : { entityId, entity: tear, revision: 1, stale: false })
  const readIn = { workspace: { id: 'ws-1', name: '工作区' }, store, connection: { connected: true }, lastUpdatedAt: T, capabilities: capabilities ?? [{ key: READ, access }], ...read }
  return { counts, input: { read: readIn, metadata: { planningSourceName: '规划源', sourceNames: { 'bind-1': '来源一' } }, phase, ...rest } }
}
const show = (phase, { target = TARGET, ...options } = {}) => deriveWorkItemDetailView(make(phase, options).input, target)
const body = (phase, options) => show(phase, options).body
const failed = (kind, options) => body('failed', { hasReceivedSnapshot: true, cacheVisibility: 'authorized', failure: { kind }, ...options })
const json = (value) => JSON.stringify(value)

test('scope-before-store：跨工作区先拒绝，store.list/get 均为 0 次，不回显路由 ID 与旧工作区名', () => {
  const { input, counts } = make('received', { refreshing: false, entities: [VISIBLE, redacted('ent-bb')] })
  for (const target of [{ projectId: 'ws-other', itemId: 'ent-aa' }, { projectId: 'ws-other', itemId: 'SECRET-ITEM' }]) {
    const view = deriveWorkItemDetailView(input, target)
    assert.deepEqual(view, { body: { kind: 'unresolved' } }, JSON.stringify(target))
    assert.doesNotMatch(json(view), /ws-other|SECRET-ITEM|工作区|ent-aa/)
  }
  assert.deepEqual(counts, { list: 0, get: 0 }, '跨 scope 连列表门都不经过，更不能碰详情 getter')
})

test('可见内容正控：选中行显示标题、正文、状态、来源名与外部身份，派生提示带前缀', () => {
  const shown = body('received', {
    refreshing: false,
    entities: [wire('ent-aa', { planningStatus: 'todo', derived: ['ci_failing', 'merged'], content: { title: 'VISIBLE-TITLE', body: 'VISIBLE-BODY', externalKind: 'change_request', externalId: 'ext-1' } })],
  })
  assert.deepEqual(shown, {
    kind: 'content', title: 'VISIBLE-TITLE', body: 'VISIBLE-BODY', planningStatus: '待办', source: '来源一', authority: '提供方权威',
    identity: { kind: 'PR', externalId: 'ext-1' }, derived: '派生提示：CI 失败、已合并', iteration: '—', targetDate: '—', stale: false, refreshing: false, lastUpdatedAt: T,
  }, '白名单字段面精确相等：多出 locator 或内部键即失败')
})

test('detail-planning-fields-match-safe-row：详情三字段逐字等于列表安全行；unknown 用原生状态名、缺值统一占位、日期原样', () => {
  const fields = { statusName: 'Native Stage', iterationTitle: 'Iteration A', targetDate: '2026-01-01' }
  const entities = [wire('ent-aa', { planningStatus: 'unknown', planningFields: fields }), wire('ent-bb', { planningStatus: 'in_progress', planningFields: { statusName: 'Blocked' } })]
  const tuple = (itemId) => {
    const { input } = make('received', { refreshing: false, entities })
    const row = deriveWorkItemListView(input).body.rows.find((candidate) => candidate.key === itemId)
    const { body: shown } = deriveWorkItemDetailView(input, { projectId: 'ws-1', itemId })
    assert.deepEqual(
      [shown.iteration, shown.targetDate, shown.planningStatus], [row.iteration, row.targetDate, row.planningStatus],
      `${itemId}：详情三字段必须逐字等于带 navigation 的列表安全行`,
    )
    for (const field of ['iteration', 'targetDate']) assert.equal(typeof shown[field], 'string', `${itemId}: ${field} 是恒有 string`)
    return [row.iteration, row.targetDate, row.planningStatus]
  }
  // 必需检查在 UTC 下运行，Date / locale 换算在那里恰好还原出同一个日期；进程内切换 TZ（Node 在给 process.env.TZ
  // 赋值时重读时区）：东八区与洛杉矶覆盖两侧常见偏移，Kiritimati（+14）覆盖只在 12 小时以上偏移才跨日的换算。
  const original = process.env.TZ
  try {
    for (const tz of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = tz
      assert.deepEqual(tuple('ent-aa'), ['Iteration A', '2026-01-01', 'Native Stage（未映射）'], `${tz}：unknown + 原生名：name（未映射），date-only 原样透出`)
      assert.deepEqual(tuple('ent-bb'), ['—', '—', '进行中'], `${tz}：规范状态是权威（冲突原生名被忽略）；迭代与目标日期缺值统一占位`)
    }
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }

  const { input } = make('received', { refreshing: false, entities })
  assert.deepEqual(deriveWorkItemDetailView(input, TARGET).body, {
    kind: 'content', title: '标题-ent-aa', body: '正文-ent-aa', planningStatus: 'Native Stage（未映射）', source: '来源一', authority: '提供方权威',
    identity: { kind: 'Issue', externalId: 'ext-ent-aa' }, iteration: 'Iteration A', targetDate: '2026-01-01',
    stale: false, refreshing: false, lastUpdatedAt: T,
  }, '完整白名单字段面：两个新字段恒有且与规划状态同源')
})

test('redacted-planning-field-differential：遮蔽行三个规划字段逐个变异，view 与列表 view 逐字不变；同字段可见行是夹具正控', () => {
  const canonical = { statusName: 'CANARY-STATUS', iterationTitle: 'CANARY-ITERATION', targetDate: '2099-12-31' }
  const variants = {
    statusName: { ...canonical, statusName: 'CANARY-STATUS-B' },
    iterationTitle: { ...canonical, iterationTitle: 'CANARY-ITERATION-B' },
    targetDate: { ...canonical, targetDate: '2098-01-02' },
  }
  const outputs = (hiddenFields) => {
    const { input } = make('received', { refreshing: false, entities: [VISIBLE, redacted('ent-bb', {}, { planningFields: hiddenFields })] })
    return { list: deriveWorkItemListView(input), detail: deriveWorkItemDetailView(input, { projectId: 'ws-1', itemId: 'ent-bb' }) }
  }
  const baseline = outputs(canonical)
  assert.deepEqual(baseline.detail, { body: { kind: 'redacted' } })
  assert.equal(baseline.list.body.rows.find((row) => row.key === 'ent-bb').kind, 'redacted')
  const baselineJson = json(baseline)
  for (const canary of [...Object.values(canonical), ...Object.values(variants).flatMap((fields) => Object.values(fields))]) {
    assert.ok(!baselineJson.includes(canary), canary)
  }
  for (const [field, canaryFields] of Object.entries(variants)) {
    assert.deepEqual(outputs(canaryFields), baseline, `${field} 变异不得改变 view 或列表输出`)
  }
  const visibleField = { statusName: 'In Progress', iterationTitle: 'Iteration A', targetDate: '2026-03-04' }
  const { input } = make('received', { refreshing: false, entities: [wire('ent-aa', { planningFields: visibleField }), redacted('ent-bb', {}, { planningFields: canonical })] })
  const visibleDetail = deriveWorkItemDetailView(input, TARGET).body
  assert.equal(visibleDetail.iteration, 'Iteration A', '夹具正控：同一字段在可见行确实进入生产路径，遮蔽对照不是空绿')
  const mixedList = JSON.stringify(deriveWorkItemListView(input))
  for (const canary of Object.values(canonical)) assert.ok(!mixedList.includes(canary), `${canary} 不得从遮蔽行进入列表 view`)
})

test('detail-planning-fields-come-from-safe-row-not-raw-detail：详情二次 getter 返回不同的规划字段时，输出仍逐字等于列表安全行，raw canary 不落任何字段', () => {
  const safe = { iterationTitle: 'SAFE-ITERATION', targetDate: '2026-01-01' }
  const raw = { statusName: 'RAW-STATUS', iterationTitle: 'RAW-CANARY', targetDate: '2000-01-02' }
  const entities = [wire('ent-aa', { planningStatus: 'in_progress', planningFields: safe })]
  // raw 二读的规范状态是 unknown：按列表同一规则从二读重算状态会显示「RAW-STATUS（未映射）」，RAW-STATUS 才是活的 canary。
  const tear = wire('ent-aa', { planningStatus: 'unknown', planningFields: raw })
  const view = show('received', { refreshing: false, entities, tear })
  const shown = view.body
  assert.deepEqual([shown.kind, shown.iteration, shown.targetDate, shown.planningStatus], ['content', 'SAFE-ITERATION', '2026-01-01', '进行中'],
    '来源必须是同一次列表安全行复制：从 raw 详情回填或重算会在此处输出 RAW-CANARY / 2000-01-02 / RAW-STATUS（未映射）')
  for (const value of Object.values(raw)) {
    assert.ok(!json(view).includes(value), `${value} 是 raw 详情独有值，不得出现在详情输出的任何字段`)
  }
  const { input } = make('received', { refreshing: false, entities, tear })
  const row = deriveWorkItemListView(input).body.rows.find((candidate) => candidate.key === 'ent-aa')
  assert.deepEqual([row.iteration, row.targetDate], [safe.iterationTitle, safe.targetDate], '正控：安全行本身是 SAFE 值，raw 只存在于第二次 getter，两值确实不同')
})

test('torn-read-planning-fields-stay-redacted：列表行可见、详情二读返回带规划字段 canary 的遮蔽条目时，只输出 redacted', () => {
  const canaries = { statusName: 'CANARY-STATUS', iterationTitle: 'CANARY-ITERATION', targetDate: '2099-12-31' }
  const view = show('received', {
    refreshing: false,
    entities: [wire('ent-aa', { planningFields: { iterationTitle: 'Iteration A', targetDate: '2026-01-01' } })],
    tear: redacted('ent-aa', {}, { planningFields: canaries }),
  })
  assert.deepEqual(view, { body: { kind: 'redacted' } })
  for (const canary of Object.values(canaries)) assert.ok(!json(view).includes(canary), canary)
})
test('pending-never-shows-cache：未明确阻断时只 loading，即使 store 已有行也不提前显示，详情 getter 为 0 次', () => {
  const { input, counts } = make('pending', { entities: [VISIBLE] })
  assert.deepEqual(deriveWorkItemDetailView(input, TARGET), { body: { kind: 'loading' } })
  assert.equal(counts.get, 0, 'pending 不发详情 getter；旧 store 已有行也不显示')
})

test('blocked-cache-canary：三种明确阻断与读门不可用时复用安全文案，缓存不可穿透且详情 getter 为 0 次', () => {
  const entities = [VISIBLE, redacted('ent-bb')]
  for (const kind of ['permission_denied', 'not_supported', 'unknown']) {
    const blocked = failed(kind, { entities })
    assert.deepEqual([blocked.kind, 'title' in blocked, 'rows' in blocked], ['unavailable', false, false], kind)
    assert.ok(blocked.message.length > 0 && blocked.remaining.length > 0, kind)
    for (const canary of CANARIES) assert.ok(!json({ blocked }).includes(canary), `${kind}: ${canary}`)
    assert.ok(!json({ blocked }).includes('VISIBLE-TITLE'), `${kind} 不借缓存显示可见行`)
  }
  for (const capabilities of [[], [{ key: 'other.key', access: 'available' }], [{ key: READ, access: 'unavailable' }]]) {
    const gate = show('received', { refreshing: false, entities, capabilities }).body
    assert.equal(gate.kind, 'unavailable')
    for (const canary of CANARIES) assert.ok(!json({ gate }).includes(canary))
  }
  const offlineKept = failed('offline', { entities })
  assert.deepEqual([offlineKept.kind, offlineKept.stale], ['content', true], 'offline + 已收到 + 明确授权缓存才保留可见行')
  const { input, counts } = make('failed', { hasReceivedSnapshot: true, cacheVisibility: 'authorized', failure: { kind: 'permission_denied' }, entities })
  deriveWorkItemDetailView(input, TARGET)
  assert.equal(counts.get, 0, '阻断态不调用详情 getter')
})

test('redacted-erases-every-field：遮蔽行只剩 redacted，无目标 ID、正文、状态、派生、身份、权威、时间与 reason', () => {
  const target = { projectId: 'ws-1', itemId: 'ent-bb' }
  const { input, counts } = make('received', { refreshing: false, entities: [VISIBLE, redacted('ent-bb')] })
  const { body: shown } = deriveWorkItemDetailView(input, target)
  assert.deepEqual(shown, { kind: 'redacted' })
  for (const canary of [...CANARIES, 'ent-bb']) assert.ok(!json({ shown }).includes(canary), canary)
  assert.equal(counts.get, 0, 'redacted 不发详情 getter')
})

test('missing-is-unresolved：目标不在安全行里只报未确认，不出现 404 / 已删除 / 确认不存在，详情 getter 为 0 次', () => {
  const { input, counts } = make('received', { refreshing: false, entities: [VISIBLE, redacted('ent-bb')] })
  const view = deriveWorkItemDetailView(input, { projectId: 'ws-1', itemId: 'ent-zz' })
  assert.deepEqual(view, { body: { kind: 'unresolved' } })
  assert.doesNotMatch(json(view), /404|删除|不存在|ent-zz/)
  assert.equal(counts.get, 0)
})

test('selected-fresh-in-partial：整表 partial 时选中行的自身新鲜度独立归约，另一行 stale 不拖累本行', () => {
  const entities = [wire('ent-aa'), wire('ent-bb', { source: { freshness: 'degraded', reason: 'ROW-REASON' } })]
  const partial = body('received', { refreshing: false, entities, read: { reason: '来源读取不完整' } })
  assert.deepEqual([partial.kind, partial.stale], ['content', false], '选中的 ent-aa 行本身 fresh')
  const other = body('received', { refreshing: false, entities, target: { projectId: 'ws-1', itemId: 'ent-bb' } })
  assert.deepEqual([other.kind, other.stale], ['content', true])
  assert.equal(body('received', { refreshing: false, entities: [wire('ent-aa')], access: 'degraded' }).stale, true, '页面级保守降级仍让选中行 stale')
})

test('撕裂读复验：列表行可见但详情 getter 返回遮蔽条目时，详情只出 redacted，标题/正文/身份全不落', () => {
  const view = show('received', { refreshing: false, entities: [VISIBLE], tear: redacted('ent-aa') })
  assert.deepEqual(view, { body: { kind: 'redacted' } })
  assert.doesNotMatch(json(view), /CANARY|VISIBLE|标题|正文|ent-aa/)
})

test('契约：接线缺陷响亮失败——可见行存在但详情 getter 取不到目标时抛 TypeError，不回填旧 view', () => {
  const { input } = make('received', { refreshing: false, entities: [VISIBLE], hideGet: true })
  assert.throws(() => deriveWorkItemDetailView(input, TARGET), TypeError)
})
