import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { createWorkspaceSetupSource } from '@harness-projects/client'
import { WorkspaceSetupGate, WorkItemApp } from '@harness-projects/ui'
import { focusFormError } from '../../packages/ui/src/form-presentation.ts'
const React = createRequire(new URL('../../packages/ui/package.json', import.meta.url))('react')
const find = (node, type) => Array.isArray(node) ? node.flatMap(child => find(child, type)) : node && typeof node === 'object' ? [...(node.type === type ? [node] : []), ...find(node.props?.children, type)] : []
const visible = (node, type) => Array.isArray(node) ? node.flatMap(child => visible(child, type)) : node && typeof node === 'object' && !node.props?.hidden ? [...(node.type === type ? [node] : []), ...visible(node.props?.children, type)] : []
function mount(props) {
  const slots = []; let cursor = 0, effects = []
  const cell = init => slots[cursor++] ??= init()
  const dispatcher = { useSyncExternalStore: (_subscribe, read) => read(), useRef: current => cell(() => ({ current })),
    useState: value => { const state = cell(() => ({ value })); return [state.value, next => { state.value = typeof next === 'function' ? next(state.value) : next }] },
    useEffect: (effect, deps) => { const state = cell(() => ({})); if (!state.deps || deps.some((value, i) => value !== state.deps[i])) effects.push(effect); state.deps = deps },
  }
  return { render() { const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, before = internals.ReactCurrentDispatcher.current; internals.ReactCurrentDispatcher.current = dispatcher; cursor = 0
    try { return WorkspaceSetupGate(props) } finally { internals.ReactCurrentDispatcher.current = before } }, flush() { const batch = effects; effects = []; batch.forEach(run => run()) } }
}
const setup = state => ({ workspace: { id: 'ws', name: 'Fixture' }, planning: state === 'unbound' ? { state } : { state, bindingId: 'b', projectNodeId: 'p' } })
const result = value => ({ writeState: 'local_only', saving: false, authoritative: false, value })
function fixture(state, overrides = {}) {
  let current = setup(state), sequence = 0
  const calls = [], source = createWorkspaceSetupSource({ getWorkspaceSetup: async () => current,
    connectAccount: async (...args) => { calls.push(['account', ...args]); return result({ accountId: 'a' }) },
    bindPlanningSource: async (...args) => { calls.push(['bind', ...args]); return result({ bindingId: 'b' }) }, ...overrides,
  }, { actorRef: { kind: 'human' }, key: () => 'key-' + ++sequence })
  return { source, calls, set: value => { current = value } }
}
const action = (tree, label) => visible(tree, 'button').find(node => node.props.children === label)
const tick = () => new Promise(resolve => setImmediate(resolve))
test('every setup state can return locally while pending and reenter the same settings subtree', async () => {
  for (const state of ['configured', 'degraded', 'confirmed', 'unbound']) {
    let release
    const f = fixture(state, { connectAccount: (...args) => { f.calls.push(['account', ...args]); return new Promise(resolve => { release = resolve }) } }); await f.source.refresh()
    const app = mount({ setupSource: f.source, source: { subscribe: () => () => {}, getSnapshot: () => undefined } })
    let tree = app.render(); app.flush()
    if (!action(tree, '返回工作区')) { const enter = action(tree, state === 'unbound' ? '继续连接项目' : '连接设置'); assert.ok(enter, state + ' offers workspace/settings navigation'); enter.props.onClick(); tree = app.render(); app.flush() }
    find(tree, 'input')[0].props.onChange({ target: { value: '' } })
    tree = app.render(); const form = find(tree, 'form')[0]
    const pending = f.source.connect('p'); tree = app.render(); app.flush()
    const back = action(tree, '返回工作区'); assert.ok(back, state + ' has top return'); assert.equal(back.props.disabled, false)
    back.props.onClick(); tree = app.render(); app.flush()
    assert.equal(visible(tree, 'form').length, 0); assert.ok(action(tree, '连接设置')); assert.equal(f.calls.length, 1)
    const retained = find(tree, 'form')[0]; assert.ok(retained, 'hidden settings remain mounted'); assert.equal(retained.type, form.type); assert.equal(retained.key, form.key)
    action(tree, '连接设置').props.onClick(); tree = app.render(); app.flush()
    assert.equal(find(tree, 'input')[0].props.value, ''); assert.equal(f.calls.length, 1)
    release(result({ accountId: 'a' })); await pending
    assert.deepEqual(f.calls.map(call => [call[0], call[2]]), [['account', 'key-1:account'], ['bind', 'key-1:bind']])
    assert.ok(action(app.render(), '返回工作区'), 'late result never navigates')
  }
})
test('navigation does not reread mapping, and a new complete scope refreshes exactly once', async () => {
  const f = fixture('configured'); await f.source.refresh(); const scopes = []
  const app = mount({ setupSource: f.source, source: { subscribe: () => () => {}, getSnapshot: () => undefined }, mappingSource: { refresh: scope => { scopes.push(scope) } } })
  let tree = app.render(); app.flush(); assert.equal(scopes.length, 1)
  assert.ok(action(tree, '返回工作区')); action(tree, '返回工作区').props.onClick(); tree = app.render(); app.flush(); assert.ok(action(tree, '连接设置')); action(tree, '连接设置').props.onClick(); app.render(); app.flush()
  assert.equal(scopes.length, 1)
  f.set({ ...setup('configured'), planning: { state: 'configured', bindingId: 'other', projectNodeId: 'next' } }); await f.source.refresh(); app.render(); app.flush()
  assert.deepEqual(scopes, [{ workspaceId: 'ws', bindingId: 'b', projectExternalId: 'p' }, { workspaceId: 'ws', bindingId: 'other', projectExternalId: 'next' }])
})
test('return never exposes another workspace or an unreadable list; empty project draft belongs to its scope', async () => {
  const f = fixture('configured'); await f.source.refresh()
  const props = { setupSource: f.source, source: { subscribe: () => () => {}, getSnapshot: () => ({ workspace: { id: 'other' } }) } }, app = mount(props)
  find(app.render(), 'input')[0].props.onChange({ target: { value: 'unsent' } })
  assert.ok(action(app.render(), '返回工作区')); action(app.render(), '返回工作区').props.onClick(); const tree = app.render(); app.flush()
  assert.equal(find(tree, WorkItemApp).length, 0); assert.ok(action(tree, '连接设置'))
  f.set({ ...setup('configured'), workspace: { id: 'next', name: 'Next' }, planning: { state: 'configured', bindingId: 'b2', projectNodeId: 'p2' } }); await f.source.refresh()
  action(app.render(), '连接设置').props.onClick()
  assert.equal(find(app.render(), 'input')[0].props.value, 'p2', 'old draft cannot auto-apply to a new target')
})
test('hidden or inert form and a zero-geometry error cannot steal focus', () => {
  let focused = 0
  for (const blocked of ['hidden', 'inert', 'rects', 'visible']) {
    const target = { closest: () => blocked === 'hidden' || blocked === 'inert' ? {} : null, getClientRects: () => blocked === 'rects' ? [] : [{}], focus: () => focused++ }
    focusFormError({ querySelector: () => target })
    assert.equal(focused, blocked === 'visible' ? 1 : 0)
  }
  assert.doesNotThrow(() => focusFormError(null))
})
test('return focuses the real initiator or the safe heading when that control disappeared', async () => {
  const before = globalThis.document
  try {
    for (const connected of [true, false]) {
      let initiatorFocus = 0, headingFocus = 0
      const f = fixture('confirmed'); await f.source.refresh()
      const initiator = { isConnected: connected, focus: () => initiatorFocus++ }, body = {}
      globalThis.document = { body, activeElement: initiator }
      const app = mount({ setupSource: f.source, source: { subscribe: () => () => {}, getSnapshot: () => undefined } })
      const tree = app.render(); tree.ref.current = { querySelector: () => ({ focus: () => headingFocus++ }) }; app.flush()
      assert.ok(action(tree, '连接设置')); action(tree, '连接设置').props.onClick(); app.render(); app.flush()
      action(app.render(), '返回工作区').props.onClick(); app.render(); app.flush()
      assert.equal(initiatorFocus, connected ? 1 : 0); assert.ok(connected || headingFocus > 0)
    }
  } finally { globalThis.document = before }
})

test('only matching readable planning capability reaches the list, including offline cached reads', async () => {
  const f = fixture('confirmed'); await f.source.refresh()
  for (const [id, access, count] of [['ws', 'blocked', 0], ['other', 'available', 0], ['ws', 'available', 1], ['ws', 'read_only', 1], ['ws', 'degraded', 1]]) {
    const app = mount({ setupSource: f.source, source: { subscribe: () => () => {}, getSnapshot: () => ({ workspace: { id }, connection: { connected: false }, capabilities: [{ key: 'planning.item.read', access }] }) } })
    assert.equal(find(app.render(), WorkItemApp).length, count)
  }
})
