import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import * as client from '@harness-projects/client'
import * as ui from '@harness-projects/ui'
import { createSetupCommands } from '@harness-projects/controller'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const empty = { workspace: null, planning: { state: 'unbound' } }
const setup = (state = 'unbound') => ({ workspace: { id: 'ws-1', name: 'Fixture' }, planning: state === 'unbound' ? { state } : { state, bindingId: 'binding-1', projectNodeId: 'PVT_1' } })
const result = (value, extra = {}) => ({ writeState: 'local_only', saving: false, authoritative: false, value, ...extra })
const error = (code = 'unavailable', recovery = 'retry') => ({ code, recovery, retryable: recovery === 'retry', message: 'RAW-CANARY' })
function fixture(overrides = {}) {
  let current = empty, sequence = 0
  const calls = []
  const port = { getWorkspaceSetup: async () => current,
    createWorkspace: async (...args) => { calls.push(['create', ...args]); current = setup(); return result({ workspaceId: 'ws-1' }) },
    connectAccount: async (...args) => { calls.push(['account', ...args]); return result({ accountId: 'account-1' }) },
    bindPlanningSource: async (...args) => { calls.push(['bind', ...args]); current = setup('configured'); return result({ bindingId: 'binding-1' }) },
    refreshPlanning: async (...args) => { calls.push(['refresh', ...args]); current = setup('confirmed'); return result({ ok: true }) }, ...overrides }
  assert.equal(typeof client.createWorkspaceSetupSource, 'function')
  const source = client.createWorkspaceSetupSource(port, { actorRef: { kind: 'human' }, key: () => `intent-${++sequence}` })
  return { source, calls, set: (next) => { current = next } }
}
test('setup DTO rejects extra keys, impossible scope and enum; errors retain only safe fixed text', async () => {
  const f = fixture(); await f.source.refresh(); assert.deepEqual(f.source.getSnapshot().setup, empty)
  const unchanged = f.source.getSnapshot(); assert.equal(f.source.getSnapshot(), unchanged)
  for (const bad of [{ ...empty, secret: 'RAW-CANARY' }, { ...empty, planning: { state: 'confirmed' } }, { ...setup(), workspace: { id: '', name: 'X' } }, { ...setup(), planning: { state: 'saved' } }, { ...setup(), mappingOrigin: 'guessed' }, { ...setup(), error: { ...error(), recovery: 'open_provider' } }]) {
    f.set(bad); await f.source.refresh(); assert.equal(f.source.getSnapshot().error.code, 'unavailable')
    assert.deepEqual(f.source.getSnapshot().setup, empty)
  }
  f.set({ ...setup('degraded'), error: error() }); await f.source.refresh()
  assert.doesNotMatch(JSON.stringify(f.source.getSnapshot()), /RAW-CANARY/)
  for (const state of ['configured', 'degraded']) {
    f.set({ ...setup(), planning: { state } }); await f.source.refresh()
    assert.equal(f.source.getSnapshot().setup.planning.state, state, '旧配置缺少可确认寻址字段时仍保留可恢复状态')
  }
})
test('double create shares a pending promise; unknown retry retains key and changed name starts new intent', async () => {
  let reject, attempt = 0
  const f = fixture({ createWorkspace: (...args) => { f.calls.push(['create', ...args]); if (++attempt === 1) return new Promise((_, no) => { reject = no }); return Promise.resolve(result({ workspaceId: 'ws-1' })) } })
  await f.source.refresh()
  const first = f.source.create('One'); assert.equal(f.source.create('One'), first)
  assert.equal(f.source.getSnapshot().pending, true); reject(new Error('RAW-CANARY')); await first
  assert.equal(f.source.getSnapshot().setup.workspace, null)
  await f.source.create('One'); await f.source.create('Two')
  assert.deepEqual(f.calls.map((call) => call[2]), ['intent-1:create', 'intent-1:create', 'intent-2:create'])
  await f.source.create('   '); assert.equal(f.calls.length, 3)
})
test('account is verified again after bind failure, activation failure stays configured, explicit reconcile confirms', async () => {
  let fail = true
  const f = fixture({ bindPlanningSource: async (...args) => { f.calls.push(['bind', ...args]); if (fail) return result(undefined, { writeState: 'failed', error: error() }); f.set({ ...setup('configured'), activationError: error() }); return result({ bindingId: 'binding-1' }, { activationError: error() }) } })
  f.set(setup()); await f.source.refresh(); await f.source.connect('PVT_1')
  assert.equal(f.source.getSnapshot().error.code, 'unavailable'); fail = false; await f.source.connect('PVT_1')
  assert.deepEqual(f.calls.filter(([name]) => name === 'account').map((call) => call[2]), ['intent-1:account', 'intent-1:account'])
  assert.deepEqual(f.calls.filter(([name]) => name === 'bind').map((call) => [call[2], call[3], call[4]]), [['intent-1:bind', 'account-1', 'PVT_1'], ['intent-1:bind:attempt-2', 'account-1', 'PVT_1']])
  assert.equal(f.source.getSnapshot().setup.planning.state, 'configured')
  await f.source.refresh(true); assert.equal(f.source.getSnapshot().setup.planning.state, 'confirmed')
})
test('dispose absorbs late rejection and stops account continuation; malformed command never invents descriptor', async () => {
  let resolve, publish = 0
  const f = fixture({ connectAccount: () => new Promise((yes) => { resolve = yes }) })
  f.set(setup()); await f.source.refresh(); f.source.subscribe(() => { publish += 1 })
  const pending = f.source.connect('PVT_1'), before = publish; f.source.dispose(); resolve(result({ accountId: 'account-1' })); await pending
  assert.equal(publish, before); assert.equal(f.calls.length, 0)
  const bad = fixture({ createWorkspace: async () => result({ workspaceId: 'ws-1', token: 'RAW-CANARY' }) })
  await bad.source.refresh(); await bad.source.create('One'); assert.equal(bad.source.getSnapshot().setup.workspace, null)
  assert.doesNotMatch(JSON.stringify(bad.source.getSnapshot()), /RAW-CANARY/)
  let reject; const late = fixture({ getWorkspaceSetup: () => new Promise((_, no) => { reject = no }) })
  const read = late.source.refresh(); await Promise.resolve(); late.source.dispose(); reject(new Error('RAW-CANARY')); await read
  assert.equal(late.source.getSnapshot().setup, undefined)
})
const html = (source, read) => renderToStaticMarkup(React.createElement(ui.WorkspaceSetupGate, { setupSource: source, source: { subscribe: () => () => {}, getSnapshot: () => read } }))
test('real source renders labeled creation, unique workspace and configured recovery without success; watch id fences list', async () => {
  const f = fixture(); assert.equal(typeof ui.WorkspaceSetupGate, 'function')
  assert.match(html(f.source), /正在读取工作区设置/)
  await f.source.refresh(); assert.match(html(f.source), /<label[^]*工作区名称[^]*<input/)
  await f.source.create('One'); assert.match(html(f.source), /Fixture[^]*继续连接项目/)
  await f.source.connect('PVT_1'); assert.match(html(f.source), /配置已记录，正在读取项目/)
  assert.doesNotMatch(html(f.source), /Saved|已连接|<table/)
  f.set({ ...setup('degraded'), activationError: error() }); await f.source.refresh()
  assert.match(html(f.source), /配置已记录，激活失败/); assert.doesNotMatch(html(f.source), /RAW-CANARY/)
  await f.source.refresh(true); assert.match(html(f.source, { workspace: { id: 'other' } }), /正在等待工作项/)
  const store = client.createEntityStore(); store.applyBaseline({ revision: 0, entities: [], source: { revision: 0, freshness: 'fresh', authority: 'provider' } })
  const read = { workspace: { id: 'ws-1', name: 'Fixture' }, store, connection: { connected: true }, capabilities: [] }
  assert.match(html(f.source, read), /连接设置/)
})
test('recovery exposes fixed safe guidance and only retry, refresh and reapply have local actions', async () => {
  const f = fixture()
  for (const [code, recovery, label, actionable] of [['unavailable', 'retry', '重试', true], ['result_unknown', 'refresh', '重新读取', true], ['conflict', 'reapply', '重新应用', true], ['not_found', 'open_provider', '前往来源平台检查项目', false], ['permission_denied', 'fix_permission', '请在宿主检查访问授权', false], ['not_supported', 'manual_execution', '请联系管理员人工处理', false], ['invalid_input', 'none', '请检查输入', false]]) {
    f.set({ ...setup(), error: error(code, recovery) }); await f.source.refresh(); const out = html(f.source)
    assert.match(out, /role="alert"/); assert.ok(out.includes(label)); assert.doesNotMatch(out, /RAW-CANARY/)
    assert.equal(out.includes(`>${label}</button>`), actionable)
  }
})
const find = (node, type) => Array.isArray(node) ? node.flatMap((child) => find(child, type)) : node && typeof node === 'object' ? [...(node.type === type ? [node] : []), ...find(node.props?.children, type)] : []
function mount(props) {
  const slots = []; let cursor = 0, effects = []
  const slot = (init) => { const index = cursor++; return slots[index] ??= init() }
  const dispatcher = { useSyncExternalStore: (_subscribe, read) => read(),
    useState: (initial) => { const cell = slot(() => ({ value: initial })); return [cell.value, (value) => { cell.value = value }] },
    useRef: (value) => slot(() => ({ current: value })),
    useEffect: (effect, deps) => { const cell = slot(() => ({})); if (!cell.deps || deps.some((value, index) => value !== cell.deps[index])) effects.push(effect); cell.deps = deps },
  }
  return { render() { const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, before = internals.ReactCurrentDispatcher.current
    internals.ReactCurrentDispatcher.current = dispatcher; cursor = 0
    try { return ui.WorkspaceSetupGate(props) } finally { internals.ReactCurrentDispatcher.current = before } },
    flush() { const batch = effects; effects = []; batch.forEach((effect) => effect()) } }
}
test('form retains editable drafts through failure, disables pending, and refocuses only replaced stage', async () => {
  let reject, focused = 0
  const f = fixture({ createWorkspace: () => new Promise((_, no) => { reject = no }) })
  await f.source.refresh()
  const app = mount({ setupSource: f.source, source: { subscribe: () => () => {}, getSnapshot: () => undefined } })
  const body = {}, before = globalThis.document
  globalThis.document = { body, activeElement: body }
  try {
    app.render().ref.current = { querySelector: () => ({ focus: () => { focused += 1 } }) }; app.flush()
    find(app.render(), 'input')[0].props.onChange({ target: { value: 'Keep my draft' } })
    find(app.render(), 'form')[0].props.onSubmit({ preventDefault() {} })
    assert.equal(find(app.render(), 'input')[0].props.disabled, true)
    reject(new Error('RAW-CANARY')); await new Promise((resolve) => setImmediate(resolve))
    assert.equal(find(app.render(), 'input')[0].props.value, 'Keep my draft'); assert.equal(focused, 0)
    f.set(setup()); await f.source.refresh(); app.render(); app.flush(); assert.equal(focused, 1)
    find(app.render(), 'button').find((button) => button.props.children === '继续连接项目').props.onClick()
    app.render(); app.flush(); assert.equal(focused, 2)
    f.set(setup('configured')); await f.source.refresh(); app.render(); app.flush()
    assert.equal(find(app.render(), 'input')[0].props.value, 'PVT_1')
    find(app.render(), 'input')[0].props.onChange({ target: { value: '' } })
    assert.equal(find(app.render(), 'input')[0].props.value, '', '已配置项目仍可清空编辑；不以Host值覆盖草稿')
  } finally { globalThis.document = before }
})
test('degraded read without activation error has a reconcile action; recovery actually refreshes planning', async () => {
  const f = fixture(); f.set(setup('degraded')); await f.source.refresh()
  const app = mount({ setupSource: f.source, source: { subscribe: () => () => {}, getSnapshot: () => undefined } })
  const action = find(app.render(), 'button').find((button) => button.props.children === '重新读取')
  assert.ok(action, '未携带error的partial规划读数仍必须可恢复'); action.props.onClick()
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.equal(f.calls[0][0], 'refresh')
})
test('initial read retry reads setup again, never submits an empty connect intent', async () => {
  let fail = true
  const f = fixture({ getWorkspaceSetup: async () => { if (fail) throw new Error('RAW-CANARY'); return empty } })
  await f.source.refresh(); fail = false
  const app = mount({ setupSource: f.source, source: { subscribe: () => () => {}, getSnapshot: () => undefined } })
  find(app.render(), 'button').find((button) => button.props.children === '重试').props.onClick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(f.source.getSnapshot().setup, empty); assert.equal(f.calls.length, 0)
})
test('failed planning reconcile retries planning after recovery instead of only rereading degraded setup', async () => {
  for (const throws of [false, true]) {
    let broken = true, refreshes = 0
    const f = fixture({ refreshPlanning: async () => {
      refreshes += 1
      if (broken) { if (throws) throw new Error('RAW-CANARY'); return result(undefined, { writeState: 'failed', error: error() }) }
      f.set(setup('confirmed')); return result({ ok: true })
    } })
    f.set({ ...setup('degraded'), error: error() }); await f.source.refresh()
    const app = mount({ setupSource: f.source, source: { subscribe: () => () => {}, getSnapshot: () => undefined } })
    const retry = async () => {
      find(app.render(), 'button').find((button) => button.props.children === '重试').props.onClick()
      await new Promise((resolve) => setImmediate(resolve))
    }
    await retry(); assert.equal(refreshes, 1); assert.equal(f.source.getSnapshot().setup.planning.state, 'degraded')
    broken = false; await retry()
    assert.equal(f.source.getSnapshot().setup.planning.state, 'confirmed', '服务恢复后的下一次重试必须刷新规划并确认')
    assert.equal(refreshes, 2); assert.equal(f.source.getSnapshot().error, undefined)
    f.source.dispose()
  }
})
test('non-string command enum and mismatched flags are rejected before descriptor readback', async () => {
  for (const extra of [{ writeState: { toString: () => 'local_only' } }, { writeState: 'saved' }, { authoritative: true }, { saving: true }]) {
    const f = fixture({ createWorkspace: async () => result({ workspaceId: 'ws-1' }, extra) })
    await f.source.refresh(); await f.source.create('One')
    assert.equal(f.source.getSnapshot().error.code, 'unavailable'); assert.equal(f.source.getSnapshot().setup.workspace, null)
  }
})
test('overlapping refresh joins mutation readback without clearing pending or losing committed workspace', async () => {
  let finish, reads = 0
  const f = fixture({ getWorkspaceSetup: async () => { reads += 1; return reads < 2 ? empty : setup() }, createWorkspace: () => new Promise((resolve) => { finish = resolve }) })
  await f.source.refresh()
  const create = f.source.create('One'), refresh = f.source.refresh()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.source.getSnapshot().pending, true, '重读不能提前结束正在提交的pending')
  finish(result({ workspaceId: 'ws-1' })); await Promise.all([create, refresh])
  assert.equal(f.source.getSnapshot().setup.workspace.id, 'ws-1'); assert.equal(reads, 2, 'mutation完成后恰好一次Host读回')
})
test('cached unbound, confirmed and degraded read failures retry only setup read and keep the project draft', async () => {
  for (const state of ['unbound', 'confirmed', 'degraded']) {
    let fail = false, reads = 0
    const f = fixture({ getWorkspaceSetup: async () => { reads += 1; if (fail) throw new Error('RAW-CANARY'); return setup(state) } })
    await f.source.refresh()
    const app = mount({ setupSource: f.source, source: { subscribe: () => () => {}, getSnapshot: () => undefined } })
    if (state === 'unbound') find(app.render(), 'button').find((button) => button.props.children === '继续连接项目').props.onClick()
    const input = find(app.render(), 'input')[0]; input?.props.onChange({ target: { value: 'PVT_DRAFT' } })
    fail = true; await f.source.refresh(); assert.equal(f.source.getSnapshot().failure, 'read'); fail = false
    find(app.render(), 'button').find((button) => button.props.children === '重试').props.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(reads, 3); assert.equal(f.calls.length, 0); assert.equal(f.source.getSnapshot().error, undefined)
    if (input) assert.equal(find(app.render(), 'input')[0].props.value, 'PVT_DRAFT')
  }
})
test('account non-success states never bind even with IDs; legal local_only activation errors stay visible', async () => {
  for (const writeState of ['unknown', 'pending', 'failed', 'conflict']) {
    const f = fixture({ connectAccount: async () => result({ accountId: 'unsafe-account' }, { writeState, saving: writeState === 'pending' }) })
    f.set(setup()); await f.source.refresh(); await f.source.connect('PVT_1')
    assert.equal(f.calls.length, 0, `${writeState}不得进入bind`); assert.ok(f.source.getSnapshot().error)
    assert.equal(f.source.getSnapshot().failure, 'connect')
  }
  const f = fixture({ connectAccount: async () => result({ accountId: 'account-1' }, { activationError: error() }) })
  f.set(setup()); await f.source.refresh(); await f.source.connect('PVT_1')
  assert.equal(f.calls.length, 0); assert.equal(f.source.getSnapshot().error.code, 'unavailable')
})
test('same connect intent revalidates Host viewer with the same account key before retry binding', async () => {
  let viewerChanged = false
  const f = fixture({ connectAccount: async (...args) => { f.calls.push(['account', ...args]); return viewerChanged ? result(undefined, { writeState: 'conflict', error: error('conflict', 'reapply') }) : result({ accountId: 'account-1' }) }, bindPlanningSource: async (...args) => { f.calls.push(['bind', ...args]); return result(undefined, { writeState: 'unknown', error: error('result_unknown', 'refresh') }) } })
  f.set(setup()); await f.source.refresh(); await f.source.connect('PVT_1'); viewerChanged = true; await f.source.connect('PVT_1')
  assert.deepEqual(f.calls.filter(([name]) => name === 'account').map((call) => call[2]), ['intent-1:account', 'intent-1:account'])
  assert.equal(f.calls.filter(([name]) => name === 'bind').length, 1); assert.equal(f.source.getSnapshot().error.code, 'conflict')
})
test('confirmed with existing workspace rejects either missing binding or missing project while degraded remains recoverable', async () => {
  const f = fixture()
  for (const planning of [{ state: 'confirmed' }, { state: 'confirmed', bindingId: 'binding-1' }, { state: 'confirmed', projectNodeId: 'PVT_1' }]) {
    f.set({ ...setup(), planning }); await f.source.refresh()
    assert.equal(f.source.getSnapshot().setup, undefined); assert.equal(f.source.getSnapshot().error.code, 'unavailable')
  }
  f.set({ ...setup(), planning: { state: 'degraded' } }); await f.source.refresh()
  assert.equal(f.source.getSnapshot().setup.planning.state, 'degraded')
})
test('real setup replay retries definitive failures with a new stage attempt but replays lost outer response with the same key', async () => {
  for (const mode of ['failed', 'conflict', 'outer-unknown']) {
    let executions = 0, first = true, current = empty
    const keys = [], controller = createSetupCommands({ createWorkspace: async () => {
      executions += 1
      if (mode !== 'outer-unknown' && executions === 1) return { ok: false, error: mode === 'conflict' ? error('conflict', 'reapply') : error() }
      current = setup(); return { ok: true, value: { workspaceId: 'ws-1' } }
    } })
    const f = fixture({ getWorkspaceSetup: async () => current, createWorkspace: async (actorRef, idempotencyKey, name) => {
      keys.push(idempotencyKey)
      const value = await controller.createWorkspace({ actorRef, idempotencyKey, name, workspaceId: 'ws-1', statusPolicy: 'provider_authoritative' })
      if (mode === 'outer-unknown' && first) { first = false; throw new Error('lost response') }
      return value
    } })
    await f.source.refresh(); await f.source.create('One'); assert.equal(f.source.getSnapshot().failure, 'create')
    await f.source.create('One'); assert.equal(f.source.getSnapshot().setup.workspace.id, 'ws-1')
    assert.deepEqual(keys, mode === 'outer-unknown' ? ['intent-1:create', 'intent-1:create'] : ['intent-1:create', 'intent-1:create:attempt-2'])
    assert.equal(executions, mode === 'outer-unknown' ? 1 : 2)
  }
})
test('unknown, malformed failure and local_only activation error retain the original stage key', async () => {
  for (const response of [result({ workspaceId: 'ws-1' }, { writeState: 'unknown', error: error('result_unknown', 'refresh') }), result({ workspaceId: 'ws-1' }, { writeState: 'failed' }), result({ workspaceId: 'ws-1' }, { activationError: error() })]) {
    const keys = [], f = fixture({ createWorkspace: async (_actor, key) => { keys.push(key); return response } })
    await f.source.refresh(); await f.source.create('One'); await f.source.create('One')
    assert.deepEqual(keys, ['intent-1:create', 'intent-1:create'])
  }
})
test('unknown create recovery labeled refresh reads Host without resending the mutation', async () => {
  let creates = 0, reads = 0
  const f = fixture({ getWorkspaceSetup: async () => { reads += 1; return empty }, createWorkspace: async () => { creates += 1; return result({ workspaceId: 'ws-1' }, { writeState: 'unknown' }) } })
  await f.source.refresh(); await f.source.create('One')
  const app = mount({ setupSource: f.source, source: { subscribe: () => () => {}, getSnapshot: () => undefined } })
  find(app.render(), 'button').find((button) => button.props.children === '重新读取').props.onClick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(creates, 1); assert.equal(reads, 3)
})
test('Host null read error is error-only before discovery and preserves confirmed cache; retry only reads', async () => {
  for (const cached of [false, true]) {
    let reads = 0, broken = !cached
    const f = fixture({ getWorkspaceSetup: async () => { reads += 1; return broken ? { ...empty, error: error() } : setup('confirmed') } })
    if (cached) await f.source.refresh()
    const confirmed = f.source.getSnapshot().setup; broken = true; await f.source.refresh()
    assert.equal(f.source.getSnapshot().setup, confirmed); assert.equal(f.source.getSnapshot().failure, 'read')
    assert.doesNotMatch(html(f.source), /工作区名称|创建工作区|<form|正在读取工作区设置/)
    const app = mount({ setupSource: f.source, source: { subscribe: () => () => {}, getSnapshot: () => undefined } })
    find(app.render(), 'button').find((button) => button.props.children === '重试').props.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(reads, cached ? 3 : 2); assert.equal(f.calls.length, 0)
    assert.equal(f.source.getSnapshot().error.code, 'unavailable'); assert.equal(f.source.getSnapshot().setup, confirmed)
  }
})

test('setup controls explain project identity and associate safe failure without losing draft', async () => {
  const f = fixture(); f.set(setup('configured')); await f.source.refresh()
  const out = html(f.source)
  assert.match(out, /class="hp-workspace"/)
  assert.match(out, /aria-describedby="project-node-id-help"/)
  assert.match(out, /id="project-node-id-help"[^]*项目设置/)
  assert.match(out, /class="hp-action hp-action-primary"/)
})
test('only a submitted setup failure focuses shared recovery, background reads keep focus', async () => {
  let reject, focused = 0
  const f = fixture({ createWorkspace: () => new Promise((_, no) => { reject = no }) }); await f.source.refresh()
  const app = mount({ setupSource: f.source, source: { subscribe: () => () => {}, getSnapshot: () => undefined } })
  const tree = app.render(), form = find(tree, 'form')[0]
  assert.ok(form.ref, 'submitted form owns its focus root')
  form.ref.current = {}
  const recovery = find(tree, 'div').find(node => node.key === 'setup-recovery')
  assert.ok(recovery.ref, 'shared recovery owns the visible error focus target')
  recovery.ref.current = { querySelector: () => ({ focus: () => { focused++ } }) }; app.flush()
  find(tree, 'input')[0].props.onChange({ target: { value: 'Draft' } })
  find(app.render(), 'form')[0].props.onSubmit({ preventDefault() {} }); app.render(); app.flush()
  reject(new Error('RAW-CANARY')); await new Promise((resolve) => setImmediate(resolve)); app.render(); app.flush()
  assert.equal(focused, 1)
  await f.source.refresh(); app.render(); app.flush(); assert.equal(focused, 1)
})
test('unknown setup command visibly asks for confirmation and never claims saved', async () => {
  const f = fixture({ createWorkspace: async () => result(undefined, { writeState: 'unknown' }) }); await f.source.refresh(); await f.source.create('Keep')
  assert.match(html(f.source), /结果未知/); assert.doesNotMatch(html(f.source), /Saved|已连接/)
})
test('confirmed list keeps heading and settings action inside shared workspace presentation', async () => {
  const f = fixture(); f.set(setup('confirmed')); await f.source.refresh()
  const store = client.createEntityStore(); store.applyBaseline({ revision: 0, entities: [], source: { revision: 0, freshness: 'fresh', authority: 'provider' } })
  const out = html(f.source, { workspace: { id: 'ws-1', name: 'Fixture' }, store, connection: { connected: true }, capabilities: [] })
  const opening = out.slice(0, out.indexOf('>') + 1)
  assert.match(opening, /class="[^"]*hp-workspace/); assert.match(out, /class="hp-action"[^>]*>连接设置<\/button>/)
})
