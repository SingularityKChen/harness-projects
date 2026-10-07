/**
 * 工作项列表 renderer 契约（issue #129）：真实 ReactDOM 静态渲染，断言实际 HTML——文本、属性、转义与泄漏面，不检查元素树。
 * 每个场景都带一条可见行正控与一条恶意 redacted 行（canary 只出现在被遮蔽字段里），所以"全部隐藏"不会让泄漏断言空绿。
 * 它不证明真实 DOM、布局、焦点与动态播报；设置 UI_FIXTURE_OUT 会写出全部状态的静态 HTML 供人工视觉验收。
 */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

import { createEntityStore } from '@harness-projects/client'
import * as ui from '@harness-projects/ui'
import { deriveWorkItemListView } from '@harness-projects/ui-model'

// React 与 ReactDOM 都从 ui 的 manifest 解析：测试与被测组件必须是同一个 React 副本。
const uiRequire = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const { createElement } = uiRequire('react')
const { renderToStaticMarkup } = uiRequire('react-dom/server')

const T = '2026-10-01T08:00:00.000Z'
const CANARIES = ['CANARY-TITLE', 'CANARY-BODY', 'CANARY-EXT', 'CANARY-BIND', 'CANARY-REASON', '已完成', '需要关注', 'CANARY-STATUS', 'CANARY-ITERATION', '2099-12-31']
const LONG = '超长标题'.repeat(30)
const meta = { planningSourceName: '规划源', sourceNames: { 'bind-1': '来源一', 'bind-long': LONG } }

const wire = (entityId, { planningStatus = 'in_progress', derived = ['ci_failing'], content = {}, source = {}, planningFields } = {}) => ({
  entityId, kind: 'work_item', planningStatus, derived,
  content: { contentKind: 'work_item', title: 'Visible A', body: 'b', bindingId: 'bind-1', externalKind: 'issue', externalId: '7', ...content },
  ...(planningFields === undefined ? {} : { planningFields }),
  source: { revision: 1, freshness: 'fresh', authority: 'provider', reason: undefined, ...source },
})
/** 恶意 redacted 行：上游违约带着字段事实，canary 只出现在被遮蔽字段里。 */
const redacted = (freshness = 'fresh') => wire('ent-bb', {
  planningStatus: 'done', derived: ['attention'],
  content: { contentKind: 'redacted', title: 'CANARY-TITLE', body: 'CANARY-BODY', bindingId: 'CANARY-BIND', externalId: 'CANARY-EXT' },
  planningFields: { statusName: 'CANARY-STATUS', iterationTitle: 'CANARY-ITERATION', targetDate: '2099-12-31' },
  source: { freshness, reason: 'CANARY-REASON', authority: 'host' },
})
/** 可见行：A 已映射（规范状态是权威，原生名不出现），C 未映射（unknown + 原生名 Done，不得变成「已完成」）。 */
const rows = (freshness = 'fresh') => [
  wire('ent-aa', { planningFields: { statusName: 'In Progress', iterationTitle: 'E1 Sprint 1', targetDate: '2026-09-24' } }), redacted(freshness),
  wire('ent-cc', { planningStatus: 'unknown', planningFields: { statusName: 'Done' }, content: { title: LONG, bindingId: 'bind-long', externalKind: 'change_request' }, source: { freshness } }),
]
const denied = (kind) => ({ phase: 'failed', hasReceivedSnapshot: true, cacheVisibility: 'authorized', failure: { kind } })

/** 场景：名称 → 读取输入。revision 0 的空 store 同时用于 pending 与 received，证明区别只来自 Host 的读取阶段。 */
const SCENARIOS = {
  loading: { phase: 'pending' }, loadingUnobserved: { phase: 'pending', capabilities: [] }, loadingDegraded: { phase: 'pending', access: 'degraded' },
  pendingFilled: { phase: 'pending', entities: rows() },
  empty: { phase: 'received', refreshing: false }, staleEmpty: { phase: 'received', refreshing: false, connected: false },
  refreshingEmpty: { phase: 'received', refreshing: true },
  content: { phase: 'received', refreshing: false, entities: rows() },
  stale: { phase: 'received', refreshing: false, entities: rows('degraded') },
  gap: { phase: 'received', refreshing: false, entities: rows(), gap: true },
  refreshing: { phase: 'received', refreshing: true, entities: rows() },
  degraded: { phase: 'received', refreshing: false, entities: rows(), access: 'degraded' },
  readOnly: { phase: 'received', refreshing: false, entities: rows(), access: 'read_only' },
  permission: { ...denied('permission_denied'), entities: rows() }, permissionReadOnly: { ...denied('permission_denied'), entities: rows(), access: 'read_only' },
  unsupported: { ...denied('not_supported'), entities: rows() },
  unknown: { ...denied('unknown'), entities: rows() }, offlineKept: { ...denied('offline'), entities: rows() },
  offlineNone: { ...denied('offline'), entities: rows(), cacheVisibility: 'unknown' }, error: { ...denied('error'), entities: rows(), hasReceivedSnapshot: false },
  gateUnavailable: { phase: 'received', refreshing: false, entities: rows(), access: 'unavailable' },
  gateUnobserved: { phase: 'received', refreshing: false, entities: rows(), capabilities: [] },
}

/** `lastUpdatedAt: null` 表示 Host 从未读到当前值（read 上省略该字段）。 */
function render({ entities = [], access = 'available', capabilities, connected = true, metadata = meta, workspace = '工作区', lastUpdatedAt = T, gap = false, ...input }) {
  const store = createEntityStore()
  store.applyBaseline({ revision: 0, entities, source: { revision: 0, freshness: 'fresh', authority: 'provider', reason: undefined } })
  if (gap) store.markAllStale()
  const read = {
    workspace: { id: 'ws-1', name: workspace }, store, connection: { connected }, lastUpdatedAt: lastUpdatedAt ?? undefined,
    capabilities: capabilities ?? [{ key: 'planning.item.read', access }],
  }
  return renderToStaticMarkup(createElement(ui.WorkItemListPage, { view: deriveWorkItemListView({ ...input, read, metadata }) }))
}
const H = Object.fromEntries(Object.entries(SCENARIOS).map(([name, input]) => [name, render(input)]))
const cells = (html) => [...html.matchAll(/<tr>(.*?)<\/tr>/g)].map(([, tr]) => [...tr.matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/g)].map(([, cell]) => cell.replace(/<[^>]+>/g, '')))

test('出口：页面与六个共享状态组件存在，旧占位面板保留', () => {
  for (const name of ['WorkItemListPage', 'LoadingState', 'EmptyState', 'UnavailableState', 'StaleBanner', 'SourceBadge', 'FreshnessBadge', 'PlaceholderPanel']) {
    assert.equal(typeof ui[name], 'function', name)
  }
})

test('首次读取：文字加装饰 skeleton，没有行也不是 empty；读取能力未观测时说明尚未确认', () => {
  assert.match(H.loading, /正在首次读取工作项/)
  assert.match(H.loading, /<div aria-hidden="true">(<div[^>]*><\/div>){3}<\/div>/)
  assert.match(H.loadingUnobserved, /读取能力尚未确认/)
  for (const name of ['loading', 'loadingUnobserved', 'pendingFilled']) {
    assert.doesNotMatch(H[name], /当前快照没有工作项|Visible A|<tr|<table/, name)
    assert.match(H[name], /aria-busy="true"/, name)
  }
})

test('真 empty：只有收到的 revision 0 空 baseline；同 store 的 pending 与陈旧 0 行都不是', () => {
  assert.match(H.empty, /当前快照没有工作项/)
  assert.doesNotMatch(H.staleEmpty, /当前快照没有工作项/)
  assert.match(H.staleEmpty, /最后已知的快照没有工作项，当前结果尚未确认/)
  assert.match(H.refreshingEmpty, /最后已知的快照没有工作项，当前结果尚未确认/)
  assert.match(H.refreshingEmpty, /aria-busy="true"/)
  assert.doesNotMatch(H.refreshingEmpty, /aria-hidden|当前快照没有工作项/, '刷新中的 0 行不退回 skeleton，也不是真 empty')
})

test('内容：原生 table 语义、稳定状态区在 busy 容器外、规划状态与工程提示分列、固定时刻与缺失时间', () => {
  const columns = [...H.content.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((match) => match[1])
  assert.deepEqual(columns, ['工作项', '内容身份', '规划状态', '迭代', '目标日期', '工程提示', '来源', '新鲜度'])
  assert.match(H.content, /<caption>[^<]+<\/caption>/)
  assert.match(H.content, /<th scope="row"[^>]*>Visible A<\/th>/)
  const [, visible, hidden, long] = cells(H.content)
  assert.deepEqual(visible, ['Visible A', 'Issue', '进行中', 'E1 Sprint 1', '2026-09-24', 'CI 失败', '来源一（提供方权威）', '当前值'], '已映射：显示规范状态，迭代 title 与日期原样')
  assert.deepEqual(hidden, ['内容不可见', '—', '—', '—', '—', '—', '—', '—'])
  assert.deepEqual(long.slice(0, 5), [LONG, 'PR', 'Done（未映射）', '—', '—'], '未映射：只显示原生名，不归一成「已完成」；缺值占位')
  assert.equal(long[6], `${LONG}（提供方权威）`)
  const [, unmapped] = cells(render({ phase: 'received', refreshing: false, entities: [wire('ent-dd', { planningStatus: 'unknown' })] }))
  assert.deepEqual(unmapped.slice(2, 5), ['未知', '—', '—'], '无映射的默认路径：unknown 且没有展示事实时显示「未知」')
  assert.match(H.content, /<div role="status" aria-live="polite" aria-atomic="true">已读取当前快照，共 3 项<\/div><div aria-busy="false">/)
  assert.match(H.content, /规划来源：(<[^>]+>)?规划源.*<time dateTime="2026-10-01T08:00:00.000Z">2026-10-01T08:00:00.000Z<\/time>/)
  const never = render({ ...SCENARIOS.content, lastUpdatedAt: null })
  assert.match(never, /来源：(<[^>]+>)?规划源.*最后已知值（最后读取时间未知）/)
  assert.equal(never.match(/最后读取时间未知/g).length, 1, '时间只在横幅里说明一次')
})

test('陈旧 / 刷新 / 降级 / 缺口：保行；状态区只宣告一次，横幅只带来源与固定时刻；页首与行都不冒充当前值', () => {
  const status = (html) => html.match(/<div role="status"[^>]*>(.*?)<\/div>/)[1]
  const banner = /来源：(<[^>]+>)?规划源.*最后已知值（最后读取：<time dateTime="2026-10-01T08:00:00.000Z">/
  const freshness = (name) => cells(H[name]).slice(1).map((row) => row[7])
  for (const name of ['stale', 'degraded', 'gap', 'offlineKept', 'staleEmpty']) assert.equal(status(H[name]), '当前结果尚未确认，最后已知值不是当前值', name)
  for (const name of ['stale', 'degraded', 'gap', 'offlineKept', 'refreshing']) assert.equal(H[name].match(/尚未确认|正在刷新/g).length, 1, `${name} 只宣告一次`)
  for (const name of ['stale', 'degraded', 'gap', 'offlineKept', 'refreshing', 'staleEmpty', 'refreshingEmpty']) {
    assert.match(H[name], banner, name)
    assert.match(H[name], /<p>规划来源：<span>规划源<\/span><\/p>/, `${name} 的页首不再单独声明新鲜度`)
  }
  assert.equal(status(H.refreshing), '正在刷新，当前显示的是最后已知值')
  assert.doesNotMatch(H.refreshing, /当前值/, '刷新页没有任何“当前值”')
  assert.deepEqual(freshness('stale'), ['当前值', '—', '最后已知值'], '只有自身陈旧的行标陈旧')
  for (const name of ['degraded', 'gap', 'offlineKept', 'refreshing']) assert.deepEqual(freshness(name), ['最后已知值', '—', '最后已知值'], name)
  assert.match(H.refreshing, /aria-busy="true"/)
  assert.match(H.stale, /aria-busy="false"/)
})

test('独立标记只在为真的状态出现：degraded 与只读只在可读内容旁，loading 不带降级，不可用页都不带', () => {
  assert.match(H.degraded, /读取能力降级/)
  assert.match(H.readOnly, /只读：/)
  assert.doesNotMatch(H.content, /读取能力降级|只读：|最后已知值/)
  assert.doesNotMatch(H.loadingDegraded, /降级|保守|最后已知/)
  assert.doesNotMatch(H.permissionReadOnly, /只读：|降级/)
})

test('版式：滚动容器可聚焦且横向可滚；短标签列不换行，标题与来源有最小宽度并可换行（内联 style 是唯一载体）', () => {
  assert.match(H.content, /<div role="region" aria-label="[^"]+" tabindex="0" style="overflow-x:auto"><table>/)
  const [head, visible, hidden] = [...H.content.matchAll(/<tr>(.*?)<\/tr>/g)].map(([, tr]) => [...tr.matchAll(/style="([^"]*)"/g)].map((match) => match[1]))
  const [nowrap, wrap] = ['white-space:nowrap', 'overflow-wrap:anywhere;min-width:12em']
  assert.deepEqual(head, Array(8).fill(nowrap))
  const row = [wrap, nowrap, nowrap, nowrap, nowrap, nowrap, wrap, nowrap]
  assert.deepEqual([visible, hidden], [row, row])
})

test('不可用：权限 / 不支持 / 未知 / 离线 / 错误说明各不相同，不借缓存，没有行；每类都写出还能做什么，读门已观测不可用不说尚未确认', () => {
  const expected = {
    permission: [/没有读取工作项的权限（planning\.item\.read）/, /恢复授权.*缓存不会显示/], unsupported: [/不支持读取工作项/, /改用支持读取的来源/],
    unknown: [/尚未确认读取工作项的能力/, /工作区与规划来源仍可查看.*确认之前不显示条目/], gateUnobserved: [/尚未确认读取工作项的能力/, /工作区与规划来源仍可查看.*确认之前不显示条目/],
    gateUnavailable: [/读取工作项的能力（planning\.item\.read）当前不可用，原因未提供/, /工作区与规划来源仍可查看.*读取能力恢复之前不显示条目.*也不显示此前的缓存/],
    offlineNone: [/无法连接规划来源/, /连接恢复后会重新读取/], error: [/读取工作项失败/, /稍后重试/],
  }
  const parts = (html) => html.match(/<div aria-busy="false"><div><p>([^<]*)<\/p><p>([^<]*)<\/p><\/div><\/div>/)?.slice(1) ?? []
  assert.doesNotMatch(H.gateUnavailable, /尚未确认/)
  for (const [name, [message, remaining]] of Object.entries(expected)) {
    const [shownMessage = '', shownRemaining = ''] = parts(H[name])
    assert.match(shownMessage, message, name)
    assert.match(shownRemaining, remaining, `${name} 的第二段写出还能做什么 / 怎样恢复`)
    assert.doesNotMatch(`${shownMessage}${shownRemaining}`, /仍会显示|但会显示|会显示此前的缓存/, `${name} 不得承诺显示此前的缓存`)
    assert.doesNotMatch(H[name], /Visible A|<table|<tr/, name)
    assert.match(H[name], /<h2>工作区<\/h2><p>规划来源：<span>规划源<\/span><\/p>/, `${name} 仍显示剩余可见的工作区与来源`)
  }
})

test('泄漏面：全部场景的完整 HTML 不含被遮蔽字段与内部标识，没有动作元素，可见行正控存在', () => {
  for (const [name, html] of Object.entries(H)) {
    for (const canary of CANARIES) assert.ok(!html.includes(canary), `${name}: ${canary}`)
  }
  for (const name of ['content', 'stale', 'refreshing', 'degraded', 'readOnly', 'offlineKept']) assert.ok(H[name].includes('Visible A'), name)
  assert.doesNotMatch(Object.values(H).join(''), /<(a|button|input|script|style)\b|href=|data-|\bid=|\bon[a-z]+=|ent-|bind-/)
})

test('转义：恶意来源名、提示、工作区名按文字转义，不产生标签', () => {
  const evil = render({
    ...SCENARIOS.content, workspace: '<i>W</i>',
    metadata: { planningSourceName: '<img src=x onerror=alert(1)>', sourceNames: { 'bind-1': '<b>来源</b>' }, safeNotice: '<script>alert(1)</script>' },
  })
  assert.match(evil, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(evil, /&lt;script&gt;/)
  assert.doesNotMatch(evil, /<(img|script|b|i)[ >]/)
})

test('fixture：全部状态拼成一份静态 HTML；设置 UI_FIXTURE_OUT 时写出供人工视觉验收', () => {
  const style = 'body{font:14px system-ui;margin:1rem}table{border-collapse:collapse}th,td{border:1px solid;padding:.25rem .5rem;text-align:left}'
  const head = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>work-item-list</title><style>${style}</style>`
  const doc = head + Object.entries(H).map(([name, html]) => `<h1>${name}</h1>${html}`).join('<hr>')
  assert.equal(doc.match(/<h1>/g).length, Object.keys(SCENARIOS).length)
  if (process.env.UI_FIXTURE_OUT) writeFileSync(process.env.UI_FIXTURE_OUT, doc)
})
