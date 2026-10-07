/**
 * 工作项列表页面投影契约（issue #129）：Host 明确给出的读取过程 → 只读列表的安全展示结构。fixture 全是合成数据，
 * 不触网、不读时钟。保护：首次读取 / 真空快照 / 陈旧保行 / 不可用隐藏缓存互不混淆；规划状态与工程提示正交；redacted 行只剩占位。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CapabilityKey } from '@harness-projects/capabilities'
import { createEntityStore } from '@harness-projects/client'
import * as domain from '@harness-projects/domain'
import * as leaf from '@harness-projects/domain/values'
import { deriveWorkItemList, deriveWorkItemListView } from '@harness-projects/ui-model'

const T = '2026-10-01T08:00:00.000Z'
const READ = 'planning.item.read'
const metadata = { planningSourceName: '规划源', sourceNames: { 'bind-1': '来源一' } }
/** 只出现在 redacted 条目里的字段值：它们在任何输出里出现都是泄漏。 */
const CANARIES = ['CANARY-TITLE', 'CANARY-BODY', 'CANARY-EXT', 'CANARY-BIND', 'CANARY-REASON', '已完成', '需要关注']

/** wire 形状条目：字段面与 packages/controller/src/wire.ts 的 WireEntity 一致。 */
const wire = (entityId, { planningStatus = 'todo', derived = [], content = {}, source = {}, planningFields } = {}) => ({
  entityId, kind: 'work_item', planningStatus, derived,
  content: { contentKind: 'work_item', title: `title-${entityId}`, body: 'body', bindingId: 'bind-1', externalKind: 'issue', externalId: '7', ...content },
  ...(planningFields === undefined ? {} : { planningFields }),
  source: { revision: 1, freshness: 'fresh', authority: 'provider', reason: undefined, ...source },
})
const redacted = (entityId) => wire(entityId, {
  planningStatus: 'done', derived: ['attention'],
  content: { contentKind: 'redacted', title: 'CANARY-TITLE', body: 'CANARY-BODY', bindingId: 'CANARY-BIND', externalId: 'CANARY-EXT' },
  source: { freshness: 'degraded', reason: 'CANARY-REASON', authority: 'host' },
})

function make(phase, { entities = [], revision = 0, access = 'available', capabilities, connected = true, read = {}, meta = metadata, gap = false, ...rest } = {}) {
  const store = createEntityStore()
  store.applyBaseline({ revision, entities, source: { revision, freshness: 'fresh', authority: 'provider', reason: undefined } })
  if (gap) store.markAllStale()
  const base = { workspace: { id: 'ws-1', name: '工作区' }, store, connection: { connected }, lastUpdatedAt: T }
  return { read: { ...base, capabilities: capabilities ?? [{ key: READ, access }], ...read }, metadata: meta, phase, ...rest }
}
const view = (phase, options) => deriveWorkItemListView(make(phase, options))
const failed = (kind, options) => view('failed', { hasReceivedSnapshot: true, cacheVisibility: 'authorized', failure: { kind }, ...options })
const received = (options) => view('received', { refreshing: false, ...options })

test('首次读取与真空快照：同一份 revision 0 空 store，只有 received 才是 empty', () => {
  assert.deepEqual(view('pending').body, { kind: 'loading' })
  assert.doesNotMatch(view('pending').statusText, /尚未确认/)
  assert.match(view('pending', { capabilities: [] }).statusText, /读取能力尚未确认/)
  assert.deepEqual(received().body, { kind: 'content', rows: [], stale: false, refreshing: false, lastUpdatedAt: T })
  const never = received({ read: { lastUpdatedAt: undefined } }).body
  assert.deepEqual([never.stale, 'lastUpdatedAt' in never], [true, false], '从未读到当前值的 0 行不是真 empty')
  assert.equal(view('pending', { access: 'unavailable' }).body.reason, 'unknown', '明确阻断时 pending 不无限等候')
  for (const options of [{}, { connected: false }, { read: { lastUpdatedAt: undefined } }]) {
    assert.deepEqual(view('pending', { entities: [wire('e1')], revision: 3, ...options }).body, { kind: 'loading' }, 'pending 时 store 里已有行也不显示')
  }
})

test('permission / unsupported / unknown 不借缓存：授权缓存也隐藏全部行，三种说明互不相同并点名读门', () => {
  const entities = [wire('e1'), redacted('e2')]
  const messages = ['permission_denied', 'not_supported', 'unknown'].map((kind) => {
    const { body } = failed(kind, { entities })
    assert.deepEqual([body.kind, body.reason, 'rows' in body], ['unavailable', kind, false])
    assert.ok(body.message.includes(CapabilityKey.PlanningItemRead))
    return body.message
  })
  assert.equal(new Set(messages).size, 3)
  assert.equal(failed('permission_denied', { hasReceivedSnapshot: false }).body.reason, 'permission_denied')
  const gate = (capabilities) => received({ capabilities, entities }).body
  const unobserved = [[], [{ key: 'other.key', access: 'available' }]].map(gate)
  const observed = [[{ key: READ, access: 'unavailable', reason: '权限不足' }], [{ key: READ, access: 'bogus' }]].map(gate)
  for (const body of [...unobserved, ...observed]) {
    assert.deepEqual([body.kind, body.reason], ['unavailable', 'unknown'], '读门缺失 / 不可用只说明原因未知，不解析 reason 猜权限')
  }
  for (const body of unobserved) assert.match(body.message, /尚未确认/, '读门未观测才说尚未确认')
  for (const body of [...observed, view('pending', { access: 'unavailable' }).body]) {
    assert.match(body.message, /当前不可用，原因未提供/, '读门已观测不可读：能力已确认不可用，未知的只是原因')
    assert.doesNotMatch(body.message, /尚未确认|权限/)
  }
})

test('不可用的恢复路径：五类失败与读门已观测不可用的说明与 remaining 都非空且两两不同', () => {
  const bodies = [
    ...['permission_denied', 'not_supported', 'unknown', 'offline', 'error'].map((kind) => failed(kind, { cacheVisibility: 'unknown' }).body),
    received({ access: 'unavailable' }).body,
  ]
  assert.ok(bodies.every((body) => body.kind === 'unavailable' && body.message.length > 0 && body.remaining.length > 0))
  assert.equal(new Set(bodies.map((body) => body.message)).size, 6)
  assert.equal(new Set(bodies.map((body) => body.remaining)).size, 6)
})

test('offline / error：仅已收到 + 明确授权缓存 + 读门允许才保行，否则无行，不是 empty 也不是永远 loading', () => {
  const entities = [wire('e1'), wire('e2')]
  for (const kind of ['offline', 'error']) {
    for (const access of ['available', 'read_only', 'degraded']) {
      const { body } = failed(kind, { entities, access })
      assert.deepEqual([body.kind, body.stale, body.refreshing, body.rows.map((row) => row.key)], ['content', true, false, ['e1', 'e2']])
    }
    for (const options of [{ cacheVisibility: 'unknown' }, { hasReceivedSnapshot: false }, { access: 'unavailable' }, { capabilities: [] }]) {
      const { body } = failed(kind, { entities, ...options })
      assert.deepEqual([body.kind, body.reason, 'rows' in body], ['unavailable', kind, false])
    }
  }
  const safe = failed('offline', { failure: { kind: 'offline', safeMessage: 'Host 安全说明' }, cacheVisibility: 'unknown' }).body
  assert.match(safe.message, /Host 安全说明/)
})

test('陈旧 / 断线 / 缺口 / 刷新：保留全部行与原次序（含 redacted 占位），0 行不是真 empty，不泄露整表 reason', () => {
  const entities = [wire('e3'), redacted('e1'), wire('e2', { source: { freshness: 'degraded', reason: 'ROW-REASON' } })]
  const stale = received({ entities, connected: false })
  assert.deepEqual(stale.body.rows.map((row) => row.key), ['e1', 'e2', 'e3'])
  assert.deepEqual(stale.body.rows[0], { kind: 'redacted', key: 'e1' })
  assert.ok(stale.body.stale && stale.body.rows.filter((row) => row.kind === 'item').every((row) => row.stale))
  assert.ok(!JSON.stringify(stale).includes('REASON'), '整表 reason 可能来自 redacted 条目，不得进入输出')
  assert.deepEqual([received({ connected: false }).body.rows, received({ connected: false }).body.stale], [[], true])
  const gap = received({ entities: [wire('e1')], gap: true }).body
  assert.deepEqual([gap.kind, gap.stale, gap.rows.map((row) => row.stale)], ['content', true, [true]], 'markAllStale 的缺口同样保行并算陈旧')
  assert.deepEqual(received({ refreshing: true }).body, { kind: 'content', rows: [], stale: false, refreshing: true, lastUpdatedAt: T }, '刷新的 0 行不退回首读 skeleton')
})

test('行新鲜度 = 行自身新鲜度 或 页面级保守降级：刷新 / Host 降级 / degraded / 失败保行时没有行能冒充当前值，单条陈旧不拖累其它行', () => {
  const stales = ({ body }) => body.rows.map((row) => row.stale)
  const mixed = received({ entities: [wire('e1'), wire('e2', { source: { freshness: 'degraded' } })] })
  assert.deepEqual([stales(mixed), mixed.body.stale], [[false, true], true])
  const entities = [wire('e1')]
  const pageLevel = [
    view('received', { refreshing: true, entities }), received({ entities, access: 'degraded' }),
    failed('offline', { entities }), received({ entities, connected: false, read: { reason: '连接已断开' } }),
  ]
  assert.deepEqual(pageLevel.map(stales), [[true], [true], [true], [true]])
  const partial = received({ entities: [wire('e1'), wire('e2', { source: { freshness: 'degraded' } })], read: { reason: '来源读取不完整' } })
  assert.deepEqual([partial.body.stale, stales(partial)], [true, [false, true]], '整表原因只降级整表，已确认行保持 fresh')
  assert.deepEqual([pageLevel[0].body.stale, stales(received({ entities }))], [false, [false]])
  assert.match(pageLevel[0].statusText, /刷新/)
  assert.match(mixed.statusText, /尚未确认/)
})

test('read_only 与 degraded 是独立标记且只在为真的状态出现：degraded 保守算陈旧，不可用页都不带，loading 不带降级', () => {
  const flags = (v) => [v.readOnly, v.degraded, v.body.kind, v.body.stale]
  const entities = [wire('e1')]
  assert.deepEqual(flags(received({ entities, access: 'available' })), [false, false, 'content', false])
  assert.deepEqual(flags(received({ entities, access: 'read_only' })), [true, false, 'content', false])
  assert.deepEqual(flags(received({ entities, access: 'degraded' })), [false, true, 'content', true])
  assert.deepEqual(flags(view('pending', { access: 'read_only' })).slice(0, 3), [true, false, 'loading'])
  assert.deepEqual(flags(view('pending', { access: 'degraded' })).slice(0, 3), [false, false, 'loading'])
  assert.deepEqual(flags(failed('permission_denied', { access: 'read_only' })).slice(0, 3), [false, false, 'unavailable'])
  assert.deepEqual(flags(failed('offline', { access: 'degraded', cacheVisibility: 'unknown' })).slice(0, 3), [false, false, 'unavailable'])
})

test('规划状态与工程提示正交：derived 变化只改变工程提示，不改规划状态、次序或来源', () => {
  const rowsFor = (derived) => received({ entities: [wire('e1', { planningStatus: 'in_progress', derived }), wire('e2')] }).body.rows
  const [plain, failing] = [rowsFor([]), rowsFor(['ci_failing', 'merged'])]
  assert.deepEqual({ ...failing[0], engineering: plain[0].engineering }, plain[0])
  assert.notEqual(failing[0].engineering, plain[0].engineering)
  assert.deepEqual([failing[0].planningStatus, failing[1]], ['进行中', plain[1]])
})

test('可见行：标签、缺省文字与来源权威分别显示，缺名称不回退 bindingId、缺身份不回退 Issue', () => {
  const row = (overrides) => received({ entities: [wire('e1', overrides)] }).body.rows[0]
  const kinds = ['issue', 'draft', 'change_request', 'worktree']
  assert.deepEqual(kinds.map((externalKind) => row({ content: { externalKind } }).identity), ['Issue', 'Draft', 'PR', '身份未知'])
  assert.equal(row({ content: { externalKind: undefined, externalId: undefined } }).identity, '身份未知')
  const bare = row({ content: { title: undefined, bindingId: 'unnamed-binding' }, planningStatus: 'weird', derived: ['mystery-flag'] })
  assert.deepEqual([bare.title, bare.planningStatus, bare.engineering, bare.source], ['标题未提供', '未知', '未知提示', '来源名称未提供'])
  assert.ok(!/unnamed-binding|mystery-flag/.test(JSON.stringify(bare)), '未知原始值不进输出')
  const odd = Object.assign(Object.create({ 'bind-1': '继承名' }), { 'bind-2': { evil: 1 } })
  const named = (bindingId) => received({ entities: [wire('e1', { content: { bindingId } })], meta: { sourceNames: odd } }).body.rows[0].source
  assert.deepEqual(['bind-1', 'bind-2'].map(named), ['来源名称未提供', '来源名称未提供'], '继承键与非字符串值都不是来源名')
  const authorities = ['provider', 'host', 'manual'].map((authority) => row({ source: { authority } }).authority)
  assert.equal(new Set(authorities).size, 3)
  assert.doesNotMatch(authorities[1], /提供方|平台/, 'Host 权威不能标成平台')
  assert.equal(received({ meta: { sourceNames: {} } }).planningSourceName, '规划来源名称未提供')
})

test('redacted 行只剩占位：输出不含任何被遮蔽字段，可见行正控存在', () => {
  const input = make('received', { refreshing: false, entities: [wire('e1', { content: { title: 'VISIBLE-TITLE' } }), redacted('e2')], meta: { ...metadata, safeNotice: '主机提示' } })
  const v = deriveWorkItemListView(input)
  assert.deepEqual(v.body.rows[1], { kind: 'redacted', key: 'e2' })
  const json = JSON.stringify(v)
  assert.match(json, /VISIBLE-TITLE/)
  for (const canary of CANARIES) assert.ok(!json.includes(canary), canary)
  assert.deepEqual([v.body.notice, deriveWorkItemListView(input)], ['主机提示', v])
})

test('接线：坏时间 / 非法 phase / 缺失或非法 failure / 非布尔或非两值的读取标记响亮失败（ISO 原样透出见首个用例）', () => {
  assert.throws(() => received({ read: { lastUpdatedAt: 'yesterday' } }), TypeError)
  assert.throws(() => view('later'), TypeError)
  assert.throws(() => failed('boom'), TypeError)
  assert.throws(() => view('failed', { hasReceivedSnapshot: true, cacheVisibility: 'authorized', entities: [wire('e1')] }), TypeError, '缺 failure 不能借缓存保行')
  const entities = [wire('e1')]
  for (const hasReceivedSnapshot of ['false', undefined]) assert.throws(() => failed('offline', { entities, hasReceivedSnapshot }), TypeError, '非布尔的已收到标记不能借缓存保行')
  for (const cacheVisibility of ['yes', undefined]) assert.throws(() => failed('offline', { entities, cacheVisibility }), TypeError)
  for (const refreshing of [undefined, 'false']) assert.throws(() => view('received', { entities, refreshing }), TypeError, '缺刷新标记不能让行冒充当前值')
})

test('契约：./values 只 re-export 四个既有词表（同一引用），读门 key 等于 CapabilityKey', () => {
  assert.deepEqual(Object.keys(leaf).sort(), ['AccessLevel', 'ContentKind', 'DerivedFlag', 'NormalizedStatus'])
  for (const name of Object.keys(leaf)) assert.equal(leaf[name], domain[name], name)
  assert.equal(READ, CapabilityKey.PlanningItemRead, '各用例的读门 key 就是 CapabilityKey，首个用例的 received → content 因此钉住实现的读门')
})

const mappedFields = {
  status: { kind: 'mapped', nativeName: 'In Progress', normalized: 'in_progress' },
  iteration: { title: 'E1 Sprint 1', startDate: '2026-09-21', durationDays: 7 }, targetDate: '2026-09-24',
}

test('mapped 规划字段显示规范状态文案、迭代 title 与目标日期', () => {
  const row = received({ entities: [wire('e1', { planningFields: mappedFields })] }).body.rows[0]
  assert.deepEqual(
    [row.planningStatus, row.iteration, row.targetDate, row.statusUnmapped],
    ['进行中', 'E1 Sprint 1', '2026-09-24', false],
  )
})

test('native-only status is not shown as a normalized status', () => {
  const row = received({ entities: [wire('e1', { planningStatus: 'done', planningFields: { status: { kind: 'native_only', nativeName: 'Done' } } })] }).body.rows[0]
  assert.equal(row.statusUnmapped, true, 'native_only 必须显式标记未映射')
  assert.match(row.planningStatus, /Done/, '显示平台原生名')
  assert.match(row.planningStatus, /未映射/, '必须带未映射提示')
  assert.doesNotMatch(row.planningStatus, /已完成|未知/, '绝不显示规范状态标签，也不显示 Unknown 哨兵')
  assert.deepEqual([row.iteration, row.targetDate], ['—', '—'], '没有值的字段显示占位')
})

test('unset fields render as placeholders', () => {
  const row = received({ entities: [wire('e1', { planningFields: { status: { kind: 'unset' } } })] }).body.rows[0]
  assert.deepEqual(
    [row.planningStatus, row.iteration, row.targetDate, row.statusUnmapped],
    ['—', '—', '—', false],
    'unset 不是未映射，也不是任何规范状态',
  )
})

test('redacted 行的字段面被 visible guard 剥离：恶意上游带上的迭代 / 日期 / 原生状态名都不进输出', () => {
  const canaries = ['CANARY-ITERATION', 'CANARY-NATIVE', '2099-12-31']
  const leaky = wire('e2', {
    content: { contentKind: 'redacted', title: 'CANARY-TITLE', bindingId: 'CANARY-BIND', externalId: 'CANARY-EXT' },
    planningFields: {
      status: { kind: 'native_only', nativeName: 'CANARY-NATIVE' },
      iteration: { title: 'CANARY-ITERATION', startDate: '2099-01-01', durationDays: 1 }, targetDate: '2099-12-31',
    },
  })
  const input = make('received', { refreshing: false, entities: [wire('e1', { planningFields: mappedFields }), leaky] })
  // 归约点（deriveWorkItemList）也必须剥离，而不只是页面投影：直接查 WorkItemRow 的字段面。
  assert.deepEqual(
    deriveWorkItemList(input.read).rows.map((row) => [row.iteration, row.targetDate, row.planningFields, row.statusUnmapped]),
    [['E1 Sprint 1', '2026-09-24', mappedFields, false], [undefined, undefined, undefined, false]],
    'redacted 行的字段面在归约点就为空',
  )
  const v = deriveWorkItemListView(input)
  assert.deepEqual(v.body.rows[1], { kind: 'redacted', key: 'e2' }, 'redacted 行只剩 kind 与 key')
  const json = JSON.stringify(v)
  assert.match(json, /E1 Sprint 1/, '可见行正控存在')
  for (const canary of canaries) assert.ok(!json.includes(canary), canary)
})
