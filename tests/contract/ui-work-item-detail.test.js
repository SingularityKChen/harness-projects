/**
 * renderer 契约（issue #130）：真实 ReactDOM 静态渲染断言实际 HTML；列表入口与深链必须显示**同一个**导出组件
 * （组合页输出包含直接渲染抽屉的输出）。真实 focus/showModal/history 由 fixture 与浏览器验收做。
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

import { itemPath } from '@harness-projects/app-web'
import { createEntityStore } from '@harness-projects/client'
import * as ui from '@harness-projects/ui'
import { deriveWorkItemDetailView, deriveWorkItemListView } from '@harness-projects/ui-model'
import { CANARIES, T, redacted, wire } from '../fixtures/work-item-wire.mjs'

const uiRequire = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const { createElement } = uiRequire('react')
const { renderToStaticMarkup } = uiRequire('react-dom/server')

const TARGET = { projectId: 'ws-1', itemId: 'ent-aa' }

function views(entities, { target = TARGET } = {}) {
  const store = createEntityStore()
  store.applyBaseline({ revision: 0, entities, source: { revision: 0, freshness: 'fresh', authority: 'provider', reason: undefined } })
  const input = {
    read: { workspace: { id: 'ws-1', name: '工作区' }, store, connection: { connected: true }, lastUpdatedAt: T, capabilities: [{ key: 'planning.item.read', access: 'available' }] },
    metadata: { planningSourceName: '规划源', sourceNames: { 'bind-1': '来源一' } }, phase: 'received', refreshing: false,
  }
  return { listView: deriveWorkItemListView(input), detailView: deriveWorkItemDetailView(input, target) }
}
const clickOf = (element) => {
  const found = []
  const walk = (node) => {
    if (node == null || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    if (typeof node.type === 'function') return walk(node.type(node.props ?? {}))
    if (node.props?.onClick) found.push(node.props.onClick)
    walk(node.props?.children ?? null)
  }
  walk(element)
  return found
}
const drawer = (view) => renderToStaticMarkup(createElement(ui.WorkItemDetailDrawer, { view, onClose: () => undefined }))

test('same-drawer-from-both-entries：两个入口显示同一导出抽屉；列表 anchor 的 open 与深链 detailView 都到达它', () => {
  const visible = wire('ent-aa', { content: { title: 'VISIBLE-TITLE' } })
  const { listView, detailView } = views([visible, redacted()])
  const calls = [], hrefs = new Set()
  const navigation = { href: (itemId) => (hrefs.add(itemId), itemPath({ projectId: 'ws-1', itemId })), open: (itemId) => calls.push(itemId) }
  const list = createElement(ui.WorkItemListPage, { view: listView, navigation })
  const html = renderToStaticMarkup(list)
  const hidden = redacted('ent-zzzz-longer', { title: 'OTHER-TITLE', body: 'OTHER-BODY', bindingId: 'OTHER-BIND', externalKind: 'change_request', externalId: 'OTHER-EXT' }, { planningStatus: 'todo', derived: ['merged'], reason: 'OTHER-REASON' })
  assert.doesNotMatch(JSON.stringify(hidden), /CANARY|ent-bb|"issue"|"done"|attention/, 'L1 自检：第二个遮蔽条目在每个对照字段上都与第一个不同，fixture 必须真正接受覆盖')
  const other = createElement(ui.WorkItemListPage, { view: views([visible, hidden]).listView, navigation })
  assert.equal(renderToStaticMarkup(other), html, 'L1：遮蔽条目的 entityId（排序仍在可见行之后）、标题、正文、bindingId、外部身份（externalKind / externalId）、规划状态、派生与 reason 全变，带 navigation 的列表 HTML、可点击元素与 href / open 调用都不得变')
  const deepLink = renderToStaticMarkup(createElement(ui.WorkItemProjectPage, { listView, detailView, navigation, onCloseDetail: () => undefined }))
  const anchors = clickOf(list)
  assert.deepEqual([anchors.length, clickOf(other).length], [1, 1], 'L1 / L2：两次渲染都只有安全 item 行标题可点击，redacted 行没有任何事件处理')
  const click = (event) => { let prevented = false; anchors[0]({ button: 0, preventDefault: () => { prevented = true }, ...event }); return prevented }
  const modified = ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'].map((key) => click({ [key]: true }))
  assert.deepEqual([click({}), ...modified, click({ button: 1 })], [true, false, false, false, false, false], '只有普通左键拦截并走 open；修饰键 / 中键保留浏览器默认')
  assert.deepEqual([calls, [...hrefs], [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1])], [['ent-aa'], ['ent-aa'], ['/projects/ws-1/items/ent-aa']], 'L2：href / open 只收到 visible ID，redacted 行不调用也不生成 href；href 是 canonical pathname')
  assert.doesNotMatch(html.replace(/href="[^"]*"/g, ''), /\bent-|bind-|ext-|CANARY|data-|\bid=/, 'L3：locator 只在 href 值里，不进 data-* / id / 文字，redacted ID 与 bindingId / externalId 完全不出现')

  // React useId 的值依赖渲染位置，两次 render 会不同；只归一化它，其余 HTML 必须逐字相同。
  const normalize = (html) => html.replace(/:[Rr][0-9a-zA-Z]*:/g, ':R:')
  assert.ok(normalize(deepLink).includes(normalize(drawer(detailView))), '深链拿到的详情就是同一个 WorkItemDetailDrawer 的输出')
  assert.equal(deepLink.match(/<dialog[^>]*aria-labelledby="[^"]+"[^>]*>/g)?.length, 1, '组合页只渲染唯一一个带 aria-labelledby 的详情 dialog')
})

test('readonly-planning-source：实际 SSR 显示标题 / 正文 / 状态 / 来源与外部身份 / 派生前缀，且没有任何写控件与内部标识', () => {
  const { detailView } = views([wire('ent-aa', { planningStatus: 'in_progress', derived: ['ci_failing'], content: { title: 'VISIBLE-TITLE', body: 'VISIBLE-BODY', externalKind: 'change_request', externalId: 'ext-ent-aa' } })])
  const html = drawer(detailView)
  for (const text of ['VISIBLE-TITLE', 'VISIBLE-BODY', '进行中', '来源一', 'ext-ent-aa', '派生提示：', '关闭详情']) assert.ok(html.includes(text), text)
  assert.match(html, /<h2[^>]*tabindex="-1"[^>]*>VISIBLE-TITLE<\/h2>/)
  for (const forbidden of ['<input', '<select', '<textarea', '编辑', 'Saved', 'StartWork', 'bindingId', 'bind-1']) assert.ok(!html.includes(forbidden), forbidden)

  const hidden = drawer(views([wire('ent-aa'), redacted()], { target: { projectId: 'ws-1', itemId: 'ent-bb' } }).detailView)
  assert.match(hidden, /内容不可见/)
  for (const canary of [...CANARIES, 'ent-bb']) assert.ok(!hidden.includes(canary), canary)
})

test('detail-planning-fields-render：真实 SSR 逐字显示两个只读规划字段，日期不经 Date / locale 漂移，遮蔽态不出现标签与 canary', () => {
  // 必需检查在 UTC 下运行，renderer 里的 Date / locale 换算在那里恰好还原出同一个日期；进程内切换 TZ（Node 在给
  // process.env.TZ 赋值时重读时区）：东八区与洛杉矶覆盖两侧常见偏移，Kiritimati（+14）覆盖只在 12 小时以上偏移才跨日的换算。
  const original = process.env.TZ
  try {
    for (const tz of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = tz
      const html = drawer(views([wire('ent-aa', { planningStatus: 'unknown', planningFields: { statusName: 'Native Stage', iterationTitle: 'Iteration A', targetDate: '2026-01-01' } })]).detailView)
      for (const text of ['迭代：', 'Iteration A', '目标日期：', '2026-01-01', 'Native Stage（未映射）']) assert.ok(html.includes(text), `${tz}：${text}`)
      assert.match(html, /<p>迭代：Iteration A<\/p>/, `${tz}：迭代是只读文字行，值紧邻标签，不经过任何格式化`)
      assert.match(html, /<p>目标日期：2026-01-01<\/p>/, `${tz}：date-only 原样逐字显示：任何时区换算都会改变这一行`)
    }
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }
  const { listView, detailView: compositeDetail } = views([wire('ent-aa', { planningStatus: 'unknown', planningFields: { statusName: 'Native Stage', iterationTitle: 'Iteration A', targetDate: '2026-01-01' } })])
  const composite = renderToStaticMarkup(createElement(ui.WorkItemProjectPage, {
    listView, detailView: compositeDetail, navigation: { href: (itemId) => itemPath({ projectId: 'ws-1', itemId }), open: () => undefined }, onCloseDetail: () => undefined,
  }))
  assert.equal(composite.match(/<p>迭代：Iteration A<\/p>/g)?.length, 1, '组合页 SSR 同样逐字显示迭代行（验收表第 4 行的 composite 面）')
  assert.equal(composite.match(/<p>目标日期：2026-01-01<\/p>/g)?.length, 1, '组合页 SSR 同样逐字显示目标日期行')

  const hiddenFields = { statusName: 'CANARY-STATUS', iterationTitle: 'CANARY-ITERATION', targetDate: '2099-12-31' }
  const redactedHtml = drawer(views([wire('ent-aa'), redacted('ent-bb', {}, { planningFields: hiddenFields })], { target: { projectId: 'ws-1', itemId: 'ent-bb' } }).detailView)
  assert.doesNotMatch(redactedHtml, /迭代：|目标日期：/, '遮蔽态连标签都不出现，不只是值')
  for (const canary of Object.values(hiddenFields)) assert.ok(!redactedHtml.includes(canary), canary)
})

test('redacted-planning-field-differential：遮蔽行单字段变异不改变列表 / 组合页 / drawer 的完整 SSR 与属性面', () => {
  const canonical = { statusName: 'CANARY-STATUS', iterationTitle: 'CANARY-ITERATION', targetDate: '2099-12-31' }
  const target = { projectId: 'ws-1', itemId: 'ent-bb' }
  const navigation = { href: (itemId) => itemPath({ projectId: 'ws-1', itemId }), open: () => undefined }
  /** React useId 依赖渲染位置；只归一化它，其余 HTML 逐字比较。 */
  const normalize = (html) => html.replace(/:[Rr][0-9a-zA-Z]*:/g, ':R:')
  const render = (hiddenFields) => {
    const { listView, detailView } = views([wire('ent-aa', { planningFields: { iterationTitle: 'Iteration A' } }), redacted('ent-bb', {}, { planningFields: hiddenFields })], { target })
    return {
      list: normalize(renderToStaticMarkup(createElement(ui.WorkItemListPage, { view: listView, navigation }))),
      composite: normalize(renderToStaticMarkup(createElement(ui.WorkItemProjectPage, { listView, detailView, navigation, onCloseDetail: () => undefined }))),
      drawer: normalize(drawer(detailView)),
    }
  }
  const baseline = render(canonical)
  assert.ok(baseline.composite.includes('内容不可见'), '正控：组合页确实渲染了遮蔽目标，不是空输出假绿')
  for (const field of ['statusName', 'iterationTitle', 'targetDate']) {
    const mutated = { ...canonical, [field]: `${canonical[field]}-B` }
    assert.deepEqual(render(mutated), baseline, `${field} 单字段变异不得改变列表 / 组合页 / drawer 的完整 HTML`)
  }
  for (const html of Object.values(baseline)) {
    for (const canary of Object.values(canonical)) assert.ok(!html.includes(canary), canary)
  }
})

test('text-is-escaped：标题、正文按文字转义，不产生可执行标签', () => {
  const html = drawer(views([wire('ent-aa', { content: { title: '<img src=x onerror=alert(1)>', body: '<script>alert(1)</script>' } })]).detailView)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<(img|script)[ >]/)
})

test('事件回调机械判据：Escape 只有 cancel 单次关闭；Tab 接受 NodeList 且循环不逃出', () => {
  // 用真实 React 的 hook 调度器直接调用函数组件，拿到 dialog 事件回调；不外置 node:*、不引入新依赖。
  const internals = uiRequire('react').__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
  const previous = internals.ReactCurrentDispatcher.current
  const previousDocument = globalThis.document
  const refs = []
  internals.ReactCurrentDispatcher.current = { useRef: (value) => { const ref = { current: value }; refs.push(ref); return ref }, useId: () => ':r:', useEffect: () => undefined }
  try {
    let closes = 0, prevented = 0
    const escape = ui.WorkItemDetailDrawer({ view: views([wire('ent-aa')]).detailView, onClose: () => { closes += 1 } })
    escape.props.onKeyDown({ key: 'Escape', preventDefault: () => { prevented += 1 } })
    assert.deepEqual([closes, prevented], [0, 0], 'Escape 单次关闭：keydown 处理会让真实浏览器同一次按键经 cancel 再关一次')
    escape.props.onCancel({ preventDefault: () => { prevented += 1 } })
    assert.deepEqual([closes, prevented], [1, 1], 'Escape 单次关闭：cancel 先 preventDefault，再恰好一次 onClose')

    const tab = ui.WorkItemDetailDrawer({ view: views([wire('ent-aa')]).detailView, onClose: () => undefined })
    const focused = []
    const first = { hasAttribute: () => false, focus: () => focused.push('first') }
    const last = { hasAttribute: () => false, focus: () => focused.push('last') }
    refs[refs.length - 2].current = { querySelectorAll: () => ({ length: 2, 0: first, 1: last }) }
    let tabPrevented = 0
    globalThis.document = { activeElement: last }
    tab.props.onKeyDown({ key: 'Tab', shiftKey: false, preventDefault: () => { tabPrevented += 1 } })
    globalThis.document = { activeElement: first }
    tab.props.onKeyDown({ key: 'Tab', shiftKey: true, preventDefault: () => { tabPrevented += 1 } })
    assert.deepEqual([tabPrevented, focused], [2, ['first', 'last']], 'Tab 焦点循环：无 filter 的 NodeList 形状也必须被接受并在 dialog 内循环')
    const opened = []
    const page = ui.WorkItemProjectPage({ listView: views([wire('ent-aa')]).listView, detailView: undefined, navigation: { href: (id) => id, open: (id) => opened.push(id) }, onCloseDetail: () => undefined })
    page.props.children[0].props.children.props.navigation.open('ent-aa')
    assert.deepEqual([opened, refs.at(-3).current], [['ent-aa'], first], '组合页 open 通道：记下 opener，并把同一 id 原样转交外层 open')
  } finally {
    globalThis.document = previousDocument
    internals.ReactCurrentDispatcher.current = previous
  }
})

test('旧列表回归：没有 navigation 时列表输出完全不变，标题不是 anchor、也没有 href', () => {
  const { listView } = views([wire('ent-aa', { content: { title: 'VISIBLE-TITLE' } })])
  const plain = renderToStaticMarkup(createElement(ui.WorkItemListPage, { view: listView }))
  assert.equal(renderToStaticMarkup(createElement(ui.WorkItemListPage, { view: listView, navigation: undefined })), plain)
  assert.doesNotMatch(plain, /<a[ >]|href=/)
  assert.match(plain, /<th scope="row"[^>]*>VISIBLE-TITLE<\/th>/)
})
