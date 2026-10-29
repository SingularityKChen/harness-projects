/**
 * 应用容器契约（issue #229）：状态无关的屏用真实 React SSR 断言 HTML；路由状态与焦点用最小 hook 调度器桩驱动
 * （先例 ui-work-item-detail.test.js）——按调用序号持久化 useState / useRef，按依赖变化收集 effect，再调一次
 * `WorkItemApp` 即重渲染。真实 focus / showModal 在宿主里由 Batch 4 的观测证明。
 */
import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

import { createEntityStore } from '@harness-projects/client'
import * as ui from '@harness-projects/ui'
import { T, wire } from '../fixtures/work-item-wire.mjs'

const uiRequire = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const React = uiRequire('react')
const { renderToStaticMarkup } = uiRequire('react-dom/server')
const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED

const NOTICE = '与宿主的连接已中断，正在自动重新连接；下面是最后已知值。'
const readOf = ({ id = 'ws-1', connected = true } = {}) => {
  const store = createEntityStore()
  store.applyBaseline({ revision: 0, entities: [wire('ent-aa', { content: { title: 'VISIBLE-TITLE' } })], source: { revision: 0, freshness: 'fresh', authority: 'provider', reason: undefined } })
  return { workspace: { id, name: '工作区' }, store, connection: { connected }, lastUpdatedAt: T, capabilities: [{ key: 'planning.item.read', access: 'available' }] }
}
/** 可变的 `WorkspaceSource`：`set` 发布新快照。 */
const sourceOf = (read) => {
  const listeners = new Set()
  return { subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)), getSnapshot: () => read, set: (next) => { read = next; listeners.forEach((listener) => listener()) } }
}
const html = (props) => renderToStaticMarkup(React.createElement(ui.WorkItemApp, props))
/** useId 的值依赖渲染位置：只归一化它，其余 HTML 逐字比较。 */
const normalize = (markup) => markup.replace(/:[Rr][0-9a-zA-Z]*:/g, ':R:')
const find = (node, type) => {
  if (node == null || typeof node !== 'object') return undefined
  if (Array.isArray(node)) return node.map((child) => find(child, type)).find((found) => found !== undefined)
  return node.type === type ? node : find(node.props?.children, type)
}

/** 最小宿主：同一份 `props` 反复渲染；`flush` 运行依赖变化的 effect，`again` 重放上一批（StrictMode 的二次挂载）。 */
function host(props) {
  const slots = []
  let cursor = 0, queued = [], ran = []
  const slot = (make) => { const index = cursor++; return (slots[index] ??= make()) }
  const dispatcher = {
    useSyncExternalStore: (subscribe, getSnapshot, getServerSnapshot) => {
      assert.equal(getSnapshot, getServerSnapshot, '服务端与客户端使用同一快照函数')
      return getSnapshot()
    },
    useState: (initial) => { const cell = slot(() => ({ value: initial })); return [cell.value, (next) => { cell.value = next }] },
    useRef: (initial) => slot(() => ({ current: initial })),
    useEffect: (effect, deps) => {
      const cell = slot(() => ({}))
      if (cell.deps === undefined || deps.some((dep, index) => !Object.is(dep, cell.deps[index]))) queued.push(effect)
      cell.deps = deps
    },
  }
  return {
    render() {
      const previous = internals.ReactCurrentDispatcher.current
      internals.ReactCurrentDispatcher.current = dispatcher
      cursor = 0
      try { return ui.WorkItemApp(props) } finally { internals.ReactCurrentDispatcher.current = previous }
    },
    flush() { ran = queued; queued = []; ran.forEach((effect) => effect()) },
    again() { ran.forEach((effect) => effect()) },
  }
}

test('scope 门：未知路由与跨 scope 路由只出中性 unresolved，不碰 store、无行无 anchor 无 href', () => {
  const trap = new Proxy({}, { get: (_, key) => assert.fail(`scope 门之前不得读 store：${String(key)}`) })
  const source = sourceOf({ ...readOf(), store: trap })
  for (const initialPath of ['/projects/ws-1/item/ent-aa', '/projects/ws-9/items', '/projects/ws-9/items/ent-aa']) {
    const out = html({ source, initialPath })
    assert.match(out, /<section aria-label="Harness Projects" class="hp-workspace"><h2 tabindex="-1">无法显示此页面<\/h2>/, initialPath)
    for (const text of ['链接无效，或不属于当前工作区。', '回到工作项列表']) assert.ok(out.includes(text), `${initialPath}：${text}`)
    assert.doesNotMatch(out, /<tr|<a[ >]|href|ws-9|ent-aa|projects/, `${initialPath}：不回显路由，不生成行 / 链接`)
  }
  assert.throws(() => html({ source, initialPath: '/projects/ws-1/items' }), /scope 门之前不得读 store/, '正控：同一陷阱 store 在通过门的路由上确实被访问')

  const real = sourceOf(readOf())
  const app = host({ source: real, initialPath: '/projects/ws-9/items' })
  find(app.render(), 'button').props.onClick()
  assert.equal(renderToStaticMarkup(app.render()), html({ source: real }), '宿主里没有地址栏与 Back：「回到工作项列表」回到当前工作区的列表')
})

test('列表与链接：缺省是当前工作区列表；列表点击与链接打开同一个详情，关闭回列表；href 是片段', () => {
  const source = sourceOf(readOf())
  const list = html({ source })
  assert.ok(list.includes('<a href="#/projects/ws-1/items/ent-aa">VISIBLE-TITLE</a>'), '标题是片段 href，不写路径')
  assert.doesNotMatch(list, /<dialog/)
  const linked = html({ source, initialPath: '/projects/ws-1/items/ent-aa' })
  assert.match(linked, /<dialog[^]*VISIBLE-TITLE[^]*当前值/, '链接直达详情：dialog 含该条目与「当前值」')

  const app = host({ source })
  const page = (element) => find(element, ui.WorkItemProjectPage).props
  assert.equal(page(app.render()).detailView, undefined)
  page(app.render()).navigation.open('ent-aa')
  const opened = app.render()
  assert.equal(normalize(renderToStaticMarkup(opened)), normalize(linked), '列表点击与链接走同一条管线，渲染同一个详情')
  page(opened).onCloseDetail()
  assert.equal(renderToStaticMarkup(app.render()), list, '关闭详情回到列表')

  const Panel = ui.bindWorkItemApp(source)
  const element = Panel() // 没有 dispatcher：组件里若有 hook，这里就抛 TypeError
  assert.deepEqual([element.type, element.props.source], [ui.WorkItemApp, source])
  assert.equal(renderToStaticMarkup(React.createElement(Panel)), list, 'bindWorkItemApp 的面板就是 WorkItemApp')

  source.set(readOf({ id: 'ws-2' })) // D13：关闭详情回到「当前工作区」的列表，路由不钉在打开详情时的工作区
  assert.ok(renderToStaticMarkup(app.render()).includes('<a href="#/projects/ws-2/items/ent-aa">'), '关闭详情之后工作区切换：显示新工作区的列表，不落到 unresolved')
})

test('断开说明只在 connected 为 false 时出现；无快照时是带 tabindex 标题的 loading，没有行', () => {
  assert.ok(html({ source: sourceOf(readOf({ connected: false })) }).includes(NOTICE), '断开：最后已知值 + 重连说明')
  assert.ok(!html({ source: sourceOf(readOf()) }).includes('与宿主的连接已中断'), '在线：没有说明')
  const drawer = (connected) => {
    const out = html({ source: sourceOf(readOf({ connected })), initialPath: '/projects/ws-1/items/ent-aa' })
    assert.ok(out.includes('<dialog'), '详情路由渲染了抽屉')
    return out.slice(out.indexOf('<dialog'))
  }
  assert.ok(drawer(false).includes(`<div role="status" aria-live="polite" aria-atomic="true">${NOTICE}</div>`), '抽屉打开时列表在模态背景下 inert：说明也在抽屉的状态区里')
  assert.ok(!drawer(true).includes('与宿主的连接已中断'), '在线：抽屉里也没有说明')
  const loading = html({ source: sourceOf(undefined), initialPath: '/projects/ws-1/items' })
  assert.match(loading, /^<section aria-label="Harness Projects" class="hp-workspace"><h2 tabindex="-1">Harness Projects<\/h2><p>正在连接宿主并读取工作项。<\/p>/)
  assert.doesNotMatch(loading, /<tr|<table|<a[ >]|无法显示/, 'loading 不伪造工作区，也不进 scope 门')
})

test('焦点：页面被替换（scope 变化、工作区切换）后只在焦点丢失时落到根下第一个 h2；首挂与键不变不动焦点', () => {
  let focused = 0
  const heading = { focus: () => { focused += 1 } }
  const root = { querySelector: (selector) => (selector === 'h2' ? heading : null) }
  const body = { isConnected: true }
  const source = sourceOf(readOf())
  const previous = globalThis.document
  const mount = (props) => {
    const app = host(props)
    globalThis.document = { activeElement: body, body }
    app.render().ref.current = root
    app.flush()
    app.again()
    return app
  }
  const step = (app, workspace, active) => {
    globalThis.document = { activeElement: active, body }
    const before = focused
    source.set(readOf({ id: workspace }))
    app.render()
    app.flush()
    return focused - before
  }
  try {
    const drawer = mount({ source, initialPath: '/projects/ws-1/items/ent-aa' })
    assert.equal(focused, 0, '首挂（含 StrictMode 二次挂载）不动焦点')
    assert.equal(step(drawer, 'ws-2', body), 1, '抽屉打开时 scope 变化，页面被 unresolved 替换，焦点落在 body：聚焦根下 h2 恰好一次')
    assert.equal(step(drawer, 'ws-1', { isConnected: true }), 0, '宿主持有焦点：不抢')
    assert.equal(step(drawer, 'ws-2', null), 1, '无焦点元素也算丢失')
    assert.equal(step(drawer, 'ws-1', { isConnected: false }), 1, '焦点元素已脱离文档也算丢失')
    assert.equal(step(drawer, 'ws-1', body), 0, '屏键不变：不动焦点')
    assert.equal(step(mount({ source }), 'ws-2', body), 1, '列表跟随工作区切换到另一个工作区：屏键含工作区 id，焦点丢失时同样落在 h2')
  } finally {
    globalThis.document = previous
  }
})

// 移除实际入口的框架消费者应失败；这里只证明 SSR 装配，尺寸与焦点由真实浏览器验收。
test('框架覆盖 loading、列表与 unresolved；无效链接仍有原生返回动作', () => {
  for (const props of [
    { source: sourceOf(undefined) },
    { source: sourceOf(readOf()) },
    { source: sourceOf(readOf()), initialPath: '/projects/other/items' },
  ]) {
    const out = html(props)
    assert.match(out, /^<section[^>]*class="hp-workspace"/, '每个实际入口屏都承载共享框架')
    assert.match(out, /<style>[^]*\.hp-workspace[^]*<\/style>/, '共享样式随真实入口装配')
  }
  const unresolved = html({ source: sourceOf(readOf()), initialPath: '/projects/other/items' })
  assert.match(unresolved, /<button type="button" class="hp-action hp-action-primary">回到工作项列表<\/button>/)
})
