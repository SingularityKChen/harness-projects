import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { WorkspaceSetupGate } from '@harness-projects/ui'
import { WorkspaceSettings } from '../../packages/ui/src/workspace-settings.ts'
import { createWorkspaceSetupSource, createEntityStore } from '@harness-projects/client'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url)), React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const find = (node, type) => Array.isArray(node) ? node.flatMap(child => find(child, type)) : node && typeof node === 'object' ? [...(node.type === type ? [node] : []), ...find(node.props?.children, type)] : []
function mount(Component, props) {
  const cells = []; let index = 0, effects = []
  const slot = init => cells[index++] ??= init()
  const dispatcher = {
    useSyncExternalStore: (_subscribe, read) => read(),
    useState: initial => { const cell = slot(() => ({ value: typeof initial === 'function' ? initial() : initial })); return [cell.value, next => { cell.value = typeof next === 'function' ? next(cell.value) : next }] },
    useRef: value => slot(() => ({ current: value })), useEffect: (effect, deps) => { const cell = slot(() => ({})); if (!cell.deps || deps.some((value, i) => value !== cell.deps[i])) effects.push(effect); cell.deps = deps }, useId: () => slot(() => ':settings:')
  }
  return { render() {
    const owner = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher, before = owner.current
    owner.current = dispatcher; index = 0
    try { return Component(props) } finally { owner.current = before }
  }, flush() { const batch = effects; effects = []; batch.forEach(effect => effect()) } }
}
async function gate(state, overrides = {}) {
  const calls = []; let setup = { workspace: { id: 'ws-1', name: 'Fixture' }, planning: { state, bindingId: 'binding-1', projectNodeId: 'PVT_1' } }
  const source = createWorkspaceSetupSource({ getWorkspaceSetup: async () => setup, connectAccount: async () => { calls.push('account') }, bindPlanningSource: async () => { calls.push('bind') }, ...overrides }, { actorRef: { kind: 'human' }, key: () => 'intent-1' })
  await source.refresh()
  const store = createEntityStore(); store.applyBaseline({ revision: 0, entities: [], source: { revision: 0, freshness: 'fresh', authority: 'provider' } })
  return { calls, source, set: value => { setup = value }, app: mount(WorkspaceSetupGate, { setupSource: source, source: { subscribe: () => () => {}, getSnapshot: () => state === 'confirmed' ? { workspace: setup.workspace, store, connection: { connected: true }, capabilities: [] } : undefined } }) }
}
test('settings entry offers four real task categories instead of a stacked page', async () => {
  const f = await gate('configured'), tree = f.app.render()
  const html = renderToStaticMarkup(tree)
  assert.match(html, /<nav[^>]*aria-label="设置任务"/, '设置应有四个真实任务的局部导航')
  for (const label of ['规划连接', '字段映射', '执行', '仓库']) assert.match(html, new RegExp('type="button"[^>]*>' + label + '</button>'))
  assert.deepEqual(f.calls, [])
  f.source.dispose()
})
test('confirmed revisit shows a safe summary and requires explicit connection editing', async () => {
  const f = await gate('confirmed')
  find(f.app.render(), 'button').find(node => node.props.children === '连接设置').props.onClick()
  const tree = f.app.render(), edit = find(tree, 'button').find(node => node.props.children === '编辑连接')
  assert.ok(edit, '已确认连接重访必须先摘要，并由人显式进入编辑')
  assert.deepEqual(f.calls, [], '重访不能自动重连')
  f.source.dispose()
})

test('category activation selects one task while retaining all supplied form identities', () => {
  const slots = ['planning', 'mapping', 'execution', 'repository'].map(key => React.createElement('form', { key, 'aria-label': key }, React.createElement('input', { defaultValue: key })))
  const app = mount(WorkspaceSettings, { children: [React.createElement('p', null, 'Workspace'), ...slots] }), initial = app.render()
  assert.deepEqual(find(initial, 'section').map(panel => panel.props.hidden), [false, true, true, true])
  assert.deepEqual(find(initial, 'button').map(button => button.props.children), ['规划连接', '字段映射', '执行', '仓库'])
  find(initial, 'button')[3].props.onClick()
  const next = app.render(), panels = find(next, 'section')
  assert.deepEqual(panels.map(panel => panel.props.hidden), [true, true, true, false])
  assert.equal(find(next, 'button')[3].props['aria-current'], 'page')
  assert.equal(find(panels[3], 'h3')[0].props.children, '仓库')
  for (let i = 0; i < panels.length; i++) {
    assert.equal(panels[i].key, find(initial, 'section')[i].key)
    assert.equal(find(panels[i], 'form')[0], find(initial, 'form')[i], '分类不替换或重建调用方的表单')
  }
  find(next, 'button')[0].props.onClick()
  assert.deepEqual(find(app.render(), 'section').map(panel => panel.props.hidden), [false, true, true, true])
})

test('confirmed editing retains an empty draft through same-scope read and revisit', async () => {
  const f = await gate('confirmed'), app = f.app
  find(app.render(), 'button').find(node => node.props.children === '连接设置').props.onClick()
  assert.equal(find(app.render(), 'form')[0].props.hidden, true)
  const edit = find(app.render(), 'button').find(node => node.props.children === '编辑连接')
  assert.ok(edit); edit.props.onClick()
  assert.equal(find(app.render(), 'form')[0].props.hidden, false)
  find(app.render(), 'input')[0].props.onChange({ target: { value: '' } })
  await f.source.refresh()
  assert.equal(find(app.render(), 'form')[0].props.hidden, false)
  find(app.render(), 'button').find(node => node.props.children === '返回工作区').props.onClick()
  find(app.render(), 'button').find(node => node.props.children === '连接设置').props.onClick()
  assert.equal(find(app.render(), 'input')[0].props.value, '')
  assert.equal(find(app.render(), 'form')[0].props.hidden, false)
  assert.deepEqual(f.calls, [])
  f.source.dispose()
})
test('unavailable mapping and repository tasks explain real host prerequisites', async () => {
  const f = await gate('configured'), html = renderToStaticMarkup(f.app.render())
  assert.match(html, /当前宿主未提供字段映射/)
  assert.match(html, /当前宿主未提供仓库绑定/)
  assert.doesNotMatch(html, /会话已就绪|模型已就绪/)
  f.source.dispose()
})

test('confirmed unknown result exposes recovery and never turns a revisit into reconnect', async () => {
  const f = await gate('confirmed', { connectAccount: async () => { f.calls.push('account'); return { writeState: 'unknown', saving: false, authoritative: false } } })
  await f.source.connect('PVT_1')
  find(f.app.render(), 'button').find(node => node.props.children === '连接设置').props.onClick()
  const tree = f.app.render()
  assert.equal(find(tree, 'form')[0].props.hidden, false, '未知结果不能被confirmed摘要遮掉')
  assert.match(renderToStaticMarkup(tree), /结果未知[^]*重新读取/)
  assert.deepEqual(f.calls, ['account'])
  f.source.dispose()
})
test('new confirmed scope initializes its own project and explicit edit state', async () => {
  const f = await gate('confirmed')
  find(f.app.render(), 'button').find(node => node.props.children === '连接设置').props.onClick()
  find(f.app.render(), 'button').find(node => node.props.children === '编辑连接').props.onClick()
  find(f.app.render(), 'input')[0].props.onChange({ target: { value: 'OLD_DRAFT' } })
  f.set({ workspace: { id: 'ws-next', name: 'Next' }, planning: { state: 'confirmed', bindingId: 'binding-next', projectNodeId: 'PVT_NEXT' } }); await f.source.refresh()
  assert.equal(find(f.app.render(), 'input')[0].props.value, 'PVT_NEXT')
  assert.equal(find(f.app.render(), 'form')[0].props.hidden, true)
  assert.deepEqual(f.calls, [])
  f.source.dispose()
})

test('execution unknown uses one shared task-independent recovery and reads before another install', async () => {
  let installs = 0
  const f = await gate('confirmed', { installExecutionBindings: async () => { installs++; return { writeState: 'unknown', saving: false, authoritative: false } } })
  await f.source.installExecution()
  find(f.app.render(), 'button').find(node => node.props.children === '连接设置').props.onClick()
  const tree = f.app.render(), tasks = find(tree, WorkspaceSettings)[0]
  const panels = find(mount(WorkspaceSettings, tasks.props).render(), 'section')
  assert.equal(panels.flatMap(panel => find(panel, 'div')).filter(node => node.props.role === 'alert').length, 0, 'setup恢复必须在四个hidden任务之外可见')
  assert.equal(find(tree, 'div').filter(node => node.props.role === 'alert').length, 1)
  assert.equal(find(tree, 'button').filter(node => node.props.children === '启用 Harness 执行').length, 0)
  assert.match(renderToStaticMarkup(tree), /尚无已确认的执行绑定/)
  find(tree, 'button').find(node => node.props.children === '重新读取').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(installs, 1, '未知执行结果的读取恢复不能重发install')
  f.source.dispose()
})

test('native task chooser shares selection and retained forms with the wide rail', () => {
  const slots = ['planning', 'mapping', 'execution', 'repository'].map(key => React.createElement('form', { key, 'aria-label': key }))
  const app = mount(WorkspaceSettings, { children: [React.createElement('p', null, 'Workspace identity'), ...slots] }), initial = app.render()
  const chooser = find(initial, 'select')[0]
  assert.ok(chooser, '窄容器需要可显示当前任务的原生选择器')
  assert.deepEqual(find(chooser, 'option').map(option => option.props.children), ['规划连接', '字段映射', '执行', '仓库'])
  chooser.props.onChange({ target: { value: 'repository' } })
  const next = app.render()
  assert.equal(find(next, 'select')[0].props.value, 'repository')
  assert.equal(find(next, 'button')[3].props['aria-current'], 'page')
  assert.deepEqual(find(next, 'section').map(panel => panel.props.hidden), [true, true, true, false])
  for (let i = 0; i < slots.length; i++) assert.equal(find(next, 'form')[i], slots[i])
})
test('only an explicit settings entry resets its body scroll position', async () => {
  const f = await gate('confirmed'), tree = f.app.render()
  const body = find(tree, 'div').find(node => node.props.className === 'hp-workspace-body')
  assert.ok(body.ref, '显式设置导航需要拥有既有正文的滚动位置')
  const scroll = { scrollTop: 220 }; body.ref.current = scroll; f.app.flush()
  find(tree, 'button').find(node => node.props.children === '连接设置').props.onClick(); f.app.render(); f.app.flush()
  assert.equal(scroll.scrollTop, 0)
  scroll.scrollTop = 140; await f.source.refresh(); f.app.render(); f.app.flush()
  assert.equal(scroll.scrollTop, 140, '普通snapshot不能重置人的阅读位置')
  f.source.dispose()
})
