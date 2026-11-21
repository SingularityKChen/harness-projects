/**
 * 工作项列表页面投影契约（issue #129）：Host 明确给出的读取过程 → 只读列表的安全展示结构。fixture 全是合成数据，
 * 不触网、不读时钟。保护：首次读取 / 真空快照 / 陈旧保行 / 不可用隐藏缓存互不混淆；规划状态与工程提示正交；redacted 行只剩占位。
 */
import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { bindWorkspaceStatusApp } from '@harness-projects/ui'
import { test } from 'node:test'

import { CapabilityKey } from '@harness-projects/capabilities'
import { createEntityStore } from '@harness-projects/client'
import { toWireEntity } from '@harness-projects/controller'
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
  entityId, kind: 'work_item', planningStatus, derived, ...(planningFields === undefined ? {} : { planningFields }),
  content: { contentKind: 'work_item', title: `title-${entityId}`, body: 'body', bindingId: 'bind-1', externalKind: 'issue', externalId: '7', ...content },
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

  // 部分读取（#382）：整表缺口而每一条可见条目都已确认，状态区不能说「最后已知值不是当前值」；表级已有原因时，redacted 条目新鲜与否这句话都不变
  const gapped = (entities) => received({ entities, read: { reason: '来源读取不完整' } })
  const confirmed = gapped([wire('e1'), wire('e2')])
  assert.deepEqual([confirmed.body.stale, stales(confirmed)], [true, [false, false]])
  for (const view of [confirmed, gapped([wire('e1'), redacted('e2')]), gapped([wire('e1'), wire('e2', { content: { contentKind: 'redacted' } })])]) {
    assert.deepEqual([view.statusText, view.body.partial], ['部分条目尚未确认，已显示的条目是当前值', true])
  }
  const unconfirmed = [mixed, partial, ...pageLevel.slice(1), received({ entities, read: { reason: '来源读取不完整', lastUpdatedAt: undefined } }), gapped([]), gapped([redacted('e1')])]
  for (const view of unconfirmed) assert.deepEqual([view.statusText, view.body.partial], ['当前结果尚未确认，最后已知值不是当前值', undefined], '有未确认的可见行（整页降级、断网、冷启动）或没有可见行：仍是整表未确认')
  // D：没有表级原因时，隐藏行 freshness 同样不能控制整页文案。
  const hidden = (freshness) => received({ entities: [wire('e1'), wire('e2', { content: { contentKind: 'redacted' }, source: { freshness } })] }).statusText
  assert.deepEqual([hidden('fresh'), hidden('degraded')], ['已读取当前快照，共 1 项可读条目', '已读取当前快照，共 1 项可读条目'])
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
  const planned = (bindingId) => received({ entities: [wire('e1', { content: { bindingId } })], meta: { sourceNames: {} }, read: { planningSource: { bindingId: 'bind-p', name: '项目甲' } } })
  assert.deepEqual([planned('bind-p').planningSourceName, planned('bind-p').body.rows[0].source, planned('unnamed-binding').body.rows[0].source], ['项目甲', '项目甲', '来源名称未提供'], '页面没给名字：只有规划来源自己的行退到它的显示名（#383）')
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

test('契约：./values 只 re-export 既有词表与纯校验（同一引用），读门 key 等于 CapabilityKey', () => {
  assert.deepEqual(Object.keys(leaf).sort(), ['AccessLevel', 'ContentKind', 'DerivedFlag', 'ExecutionContextStatus', 'ExecutionRunStatus', 'NormalizedStatus', 'calendarDateToDay', 'calendarDayToDate', 'calendarIterationWindow', 'planningFieldMappingSnapshot', 'sourceNumberSnapshot'])
  for (const name of Object.keys(leaf)) assert.equal(leaf[name], domain[name], name)
  assert.equal(READ, CapabilityKey.PlanningItemRead, '各用例的读门 key 就是 CapabilityKey，首个用例的 received → content 因此钉住实现的读门')
})

test('#133 双层剥离：toWireEntity 不把 redacted 行的字段事实发出 wire；上游违约带上时 ui-model 的归约点也剥掉', () => {
  const fields = { statusName: 'CANARY-STATUS', iterationTitle: 'CANARY-ITERATION', targetDate: '2099-12-31' }
  const coreView = (contentKind) => ({
    entityId: 'e1', kind: 'work_item', planningStatus: 'unknown', planningFields: fields,
    content: { contentKind, title: undefined, body: undefined, identity: { bindingId: 'bind-1', externalKind: 'issue', externalId: '7' } },
    engineering: { derived: [], facts: [] }, freshness: { revision: 1, degraded: false, reason: undefined },
  })
  assert.equal('planningFields' in toWireEntity(coreView('redacted'), 'provider'), false, 'redacted 行不出字段事实')
  assert.deepEqual(toWireEntity(coreView('work_item'), 'provider').planningFields, fields, '正控：可见行照常透出')
  const input = make('received', { refreshing: false, entities: [wire('e1', { planningFields: { iterationTitle: 'Sprint 1' } }), { ...redacted('e2'), planningFields: fields }] })
  assert.deepEqual(deriveWorkItemList(input.read).rows.map((row) => row.planningFields), [{ iterationTitle: 'Sprint 1' }, undefined], '归约点就剥掉 redacted 行的字段事实')
  const json = JSON.stringify(deriveWorkItemListView(input))
  assert.match(json, /Sprint 1/, '可见行正控')
  for (const canary of Object.values(fields)) assert.ok(!json.includes(canary), canary)
})


test('字段映射来源由真实状态披露呈现，未配置和异来源时缺席', () => {
  const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
  const { createElement } = require('react'), { renderToStaticMarkup } = require('react-dom/server')
  for (const [mappingOrigin, text] of [['derived', '字段映射：自动派生'], ['user', '字段映射：用户配置'], [undefined, undefined]]) {
    const input = make('received', { refreshing: false, read: { planningSource: { bindingId: 'bind-1', name: '项目', ...(mappingOrigin === undefined ? {} : { mappingOrigin }) } } })
    const result = deriveWorkItemListView(input)
    assert.equal(result.mappingSourceText, text)
    const snapshot = { pending: false, setup: { workspace: input.read.workspace, planning: { state: 'confirmed', bindingId: 'bind-1', projectNodeId: 'project' } } }
    const markup = () => renderToStaticMarkup(createElement(bindWorkspaceStatusApp({ subscribe: () => () => {}, getSnapshot: () => snapshot }, { subscribe: () => () => {}, getSnapshot: () => input.read })))
    if (text) assert.match(markup(), new RegExp('字段映射</dt><dd>' + text.split('：')[1])); else assert.doesNotMatch(markup(), /字段映射/)
    input.read.planningSource.bindingId = 'foreign-binding'; assert.doesNotMatch(markup(), /字段映射|项目<\/dd>/, 'old source mapping cannot survive scope mismatch')
  }
})

 test('safe planningStatusKey only accepts normalized enum strings, independent of native and engineering facts', () => {
  for (const [planningStatus, expected] of [['done', 'done'], ['unknown', 'unknown'], ['todo', 'todo'], ['Done', 'unknown'], ['constructor', 'unknown'], [{ toString: () => 'done' }, 'unknown']]) {
    const rows = received({ entities: [wire('a-safe', { planningStatus, planningFields: { statusName: 'Done' }, derived: ['merged'] }), redacted('z-hidden')] }).body.rows
    assert.equal(rows[0].planningStatusKey, expected)
    if (typeof planningStatus !== 'string') assert.equal(rows[0].planningStatus, '未知')
    assert.deepEqual(rows[1], { kind: 'redacted', key: 'z-hidden' })
  }
})
// ---- 可见性矩阵（issue #314）：把 6 段优先级钉成一张可审阅的表，每格恰有一个决策 ----

const READ_ONCE = '已读取当前快照，共 1 项可读条目'
const READ_STALE = '当前结果尚未确认，最后已知值不是当前值'
const READ_PARTIAL = '部分条目尚未确认，已显示的条目是当前值'
const READ_REFRESHING = '正在刷新，当前显示的是最后已知值'
const FIRST_READ = '正在首次读取工作项'
const FIRST_READ_UNCONFIRMED = '正在首次读取工作项，读取能力尚未确认'
const BLOCKED = '无法读取工作项'
/** 五类失败文案与读门阻断文案的选择器；矩阵只断言「用了哪一条」，文案本身由既有用例逐字保护。 */
const COPY = {
  permission_denied: /没有读取工作项的权限/,
  not_supported: /该规划来源不支持读取工作项/,
  unknown: /尚未确认读取工作项的能力/,
  offline: /当前无法连接规划来源/,
  error: /读取工作项失败/,
  gate_blocked: /当前不可用，原因未提供/,
}
const itemRow = (key, stale) => ({ kind: 'item', key, stale })
const hiddenRow = (key) => ({ kind: 'redacted', key })
const unavailablePage = (reason) => ({ readOnly: false, degraded: false, statusText: BLOCKED, kind: 'unavailable', reason, rows: undefined })
const loadingPage = (statusText, readOnly = false) => ({ readOnly, degraded: false, statusText, kind: 'loading', rows: undefined })
const contentPage = (statusText, rows, { readOnly = false, degraded = false, stale = false, refreshing = false, partial } = {}) => ({
  readOnly, degraded, statusText, kind: 'content', stale, refreshing,
  ...(partial === undefined ? {} : { partial }), rows,
})
/** 矩阵断言投影：只保留与可见性决策有关且用户可观察的面；message/remaining 另按选择器断言。 */
const decisionView = (view) => {
  const body = view.body
  return {
    readOnly: view.readOnly, degraded: view.degraded, statusText: view.statusText, kind: body.kind,
    ...('reason' in body ? { reason: body.reason } : {}),
    ...('stale' in body ? { stale: body.stale } : {}),
    ...('refreshing' in body ? { refreshing: body.refreshing } : {}),
    ...('partial' in body ? { partial: body.partial } : {}),
    rows: 'rows' in body
      ? body.rows.map((row) => row.kind === 'redacted' ? { kind: 'redacted', key: row.key } : { kind: 'item', key: row.key, stale: row.stale })
      : undefined,
  }
}

const E = [wire('e1'), redacted('e2')]
const VISIBILITY_MATRIX = [
  { segment: 1, name: 'permission_denied 明确阻断压过授权缓存', copy: 'permission_denied',
    build: () => failed('permission_denied', { entities: E }), expected: unavailablePage('permission_denied') },
  { segment: 1, name: 'not_supported 明确阻断', copy: 'not_supported',
    build: () => failed('not_supported', { entities: E, cacheVisibility: 'unknown' }), expected: unavailablePage('not_supported') },
  { segment: 1, name: 'unknown 明确阻断，读门 read_only 也不借缓存', copy: 'unknown',
    build: () => failed('unknown', { entities: E, access: 'read_only' }), expected: unavailablePage('unknown') },
  { segment: 2, name: '读门未观测 + received：尚未确认', copy: 'unknown',
    build: () => received({ entities: E, capabilities: [] }), expected: unavailablePage('unknown') },
  { segment: 2, name: '读门未观测 + offline：用结构化失败文案而不是尚未确认', copy: 'offline',
    build: () => failed('offline', { entities: E, capabilities: [] }), expected: unavailablePage('offline') },
  { segment: 3, name: '读门已观测不可读且无失败：gate blocked 文案、reason 仍是 unknown', copy: 'gate_blocked',
    build: () => received({ entities: E, access: 'unavailable' }), expected: unavailablePage('unknown') },
  { segment: 3, name: '读门已观测不可读 + error：用结构化失败文案而不是 gate blocked', copy: 'error',
    build: () => failed('error', { entities: E, access: 'unavailable' }), expected: unavailablePage('error') },
  { segment: 3, name: 'pending + 读门不可读：直接不可用，不无限等候', copy: 'gate_blocked',
    build: () => view('pending', { access: 'unavailable', entities: E }), expected: unavailablePage('unknown') },
  { segment: 4, name: 'pending + 读门可读：首读 skeleton', copy: undefined,
    build: () => view('pending', { entities: E }), expected: loadingPage(FIRST_READ) },
  { segment: 4, name: 'pending + 读门未观测：首读文案追加能力未确认', copy: undefined,
    build: () => view('pending', { capabilities: [], entities: E }), expected: loadingPage(FIRST_READ_UNCONFIRMED) },
  { segment: 4, name: 'pending + read_only：只读标记可见但不算降级', copy: undefined,
    build: () => view('pending', { access: 'read_only', entities: E }), expected: loadingPage(FIRST_READ, true) },
  { segment: 4, name: 'pending + degraded：loading 不带降级', copy: undefined,
    build: () => view('pending', { access: 'degraded', entities: E }), expected: loadingPage(FIRST_READ) },
  { segment: 5, name: 'failed + 从未收到快照：无行，不借缓存', copy: 'offline',
    build: () => failed('offline', { entities: E, hasReceivedSnapshot: false }), expected: unavailablePage('offline') },
  { segment: 5, name: 'failed + 缓存可见性未授权：无行，不借缓存', copy: 'offline',
    build: () => failed('offline', { entities: E, cacheVisibility: 'unknown' }), expected: unavailablePage('offline') },
  { segment: 6, name: 'received + read_only：只读内容页，行保持当前值', copy: undefined,
    build: () => received({ entities: E, access: 'read_only' }),
    expected: contentPage(READ_ONCE, [itemRow('e1', false), hiddenRow('e2')], { readOnly: true }) },
  { segment: 6, name: 'received + degraded：整表与全部行降级', copy: undefined,
    build: () => received({ entities: E, access: 'degraded' }),
    expected: contentPage(READ_STALE, [itemRow('e1', true), hiddenRow('e2')], { degraded: true, stale: true }) },
  { segment: 6, name: 'received + refreshing：保行但全部行不算当前值', copy: undefined,
    build: () => received({ entities: E, refreshing: true }),
    expected: contentPage(READ_REFRESHING, [itemRow('e1', true), hiddenRow('e2')], { refreshing: true }) },
  { segment: 6, name: 'failed + 授权缓存 + read_only：保行，只读标记仍成立', copy: undefined,
    build: () => failed('offline', { entities: E, access: 'read_only' }),
    expected: contentPage(READ_STALE, [itemRow('e1', true), hiddenRow('e2')], { readOnly: true, stale: true }) },
  { segment: 6, name: 'gap 混合新鲜度：整表未确认只降级未确认行，partial 不成立', copy: undefined,
    build: () => received({ entities: [wire('e1'), wire('e2', { source: { freshness: 'degraded' } })], read: { reason: '来源读取不完整' } }),
    expected: contentPage(READ_STALE, [itemRow('e1', false), itemRow('e2', true)], { stale: true }) },
  { segment: 6, name: 'gap 且每条可见条目已确认：redacted 新鲜度不参与 partial', copy: undefined,
    build: () => received({ entities: [wire('e1'), redacted('e2')], read: { reason: '来源读取不完整' } }),
    expected: contentPage(READ_PARTIAL, [itemRow('e1', false), hiddenRow('e2')], { stale: true, partial: true }) },
  { segment: 6, name: 'gap 且全部行被遮蔽：没有可见条目，partial 不成立', copy: undefined,
    build: () => received({ entities: [redacted('e1')], read: { reason: '来源读取不完整' } }),
    expected: contentPage(READ_STALE, [hiddenRow('e1')], { stale: true }) },
]

test('可见性矩阵：按阶段 / 读门 / 失败 / 快照 / 缓存授权的顺序判定，每格恰有一个决策', () => {
  assert.deepEqual([...new Set(VISIBILITY_MATRIX.map((row) => row.segment))], [1, 2, 3, 4, 5, 6], '矩阵覆盖全部 6 段优先级')
  for (const row of VISIBILITY_MATRIX) {
    const view = row.build()
    assert.deepEqual(decisionView(view), row.expected, row.name)
    assert.equal('rows' in view.body, view.body.kind === 'content', row.name + '：只有内容页带 rows')
    if (row.copy === undefined) assert.equal('message' in view.body, false, row.name + '：非不可用页没有文案')
    else assert.match(view.body.message, COPY[row.copy], row.name + '：文案来源')
    const json = JSON.stringify(view)
    for (const canary of CANARIES) assert.ok(!json.includes(canary), row.name + ' 泄漏 ' + canary)
    for (const visible of view.body.rows ?? []) {
      if (visible.kind === 'redacted') assert.deepEqual(Object.keys(visible).sort(), ['key', 'kind'], row.name + '：遮蔽行只剩占位')
    }
  }
})

test('输出形状白名单：view、不可用 body、content body 与行对象的键集固定', () => {
  const keys = (value) => Object.keys(value).sort()
  const number = { sourceName: 'GitHub', scopeIdentity: { namespace: 'github.com/graphql/Repository', id: 'R_1' }, scopeName: 'sample/alpha', number: 328 }
  const full = received({
    entities: [wire('e1', { content: { sourceNumber: number } })],
    read: { reason: '来源读取不完整', reconciledAt: T, planningSource: { bindingId: 'bind-1', name: '项目', mappingOrigin: 'derived' } },
    meta: { ...metadata, safeNotice: '主机提示' },
  })
  assert.deepEqual(keys(full), ['body', 'degraded', 'mappingSourceText', 'planningSourceName', 'readOnly', 'statusText', 'workspaceName'])
  assert.deepEqual(keys(full.body), ['kind', 'lastUpdatedAt', 'notice', 'partial', 'reconciledAt', 'refreshing', 'rows', 'stale'], '可选 content 键只在有值时出现')
  assert.deepEqual([full.body.partial, full.body.notice, full.body.reconciledAt, full.mappingSourceText], [true, '主机提示', T, '字段映射：自动派生'], '白名单不是“全部隐藏”的空绿：可选键的正控都在')
  assert.deepEqual(keys(full.body.rows[0]), ['authority', 'engineering', 'identity', 'iteration', 'key', 'kind', 'numberLabel', 'planningStatus', 'planningStatusKey', 'schedule', 'source', 'sourceNumber', 'stale', 'targetDate', 'title'])
  assert.equal(full.body.rows[0].numberLabel, 'GitHub sample/alpha#328', '行白名单正控：原生编号仍可见')
  const minimal = received({ entities: [wire('e2')] })
  assert.deepEqual(keys(minimal), ['body', 'degraded', 'planningSourceName', 'readOnly', 'statusText', 'workspaceName'])
  assert.deepEqual(keys(minimal.body), ['kind', 'lastUpdatedAt', 'refreshing', 'rows', 'stale'])
  assert.deepEqual(keys(minimal.body.rows[0]), ['authority', 'engineering', 'identity', 'iteration', 'key', 'kind', 'planningStatus', 'planningStatusKey', 'schedule', 'source', 'stale', 'targetDate', 'title'])
  const hidden = received({ entities: [redacted('e1')], read: { reason: '来源读取不完整' } })
  assert.deepEqual(keys(hidden.body.rows[0]), ['key', 'kind'], '遮蔽行没有可扩展字段面')
  for (const [name, page, bodyKeys] of [
    ['loading', view('pending'), ['kind']],
    ['unavailable', failed('offline', { cacheVisibility: 'unknown' }), ['kind', 'message', 'reason', 'remaining']],
  ]) {
    assert.deepEqual(keys(page), ['body', 'degraded', 'planningSourceName', 'readOnly', 'statusText', 'workspaceName'], name)
    assert.deepEqual(keys(page.body), bodyKeys, name)
    assert.equal('rows' in page.body, false, name + '：阻断态不能携带行')
  }
})

test('坏接线先于可见性决策：阻断态不掩盖非法 phase / failure / 读取标记 / 时间戳', () => {
  assert.throws(() => failed('permission_denied', { read: { lastUpdatedAt: 'yesterday' } }), TypeError, '明确阻断掩盖不了坏时间戳')
  assert.throws(() => failed('constructor'), TypeError, '原型链键不是失败分类')
  assert.throws(() => failed('offline', { cacheVisibility: 'Authorized' }), TypeError, '缓存可见性只认两个小写枚举值')
})
