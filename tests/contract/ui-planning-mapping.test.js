import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import * as client from '@harness-projects/client'
import * as ui from '@harness-projects/ui'
import { HOST_REMOTE } from '../../apps/harness-plugin/src/remote.ts'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const dto = { scope: { workspaceId: 'ws', bindingId: 'b', projectExternalId: 'p' }, mapping: { status: { projectFieldId: 's', options: { x: 'todo' } } }, origin: 'user', confirmed: true,
  fields: [{ id: 's', name: 'Same', kind: 'single_select', options: [{ id: 'x', name: 'Native' }, { id: 'new', name: 'Unmapped' }] }, { id: 's2', name: 'Same', kind: 'single_select', options: [{ id: 'y', name: 'Other' }] }, { id: 'i', name: 'Sprint', kind: 'iteration' }, { id: 'd', name: 'Due', kind: 'date' }] }
const result = { writeState: 'local_only', saving: false, authoritative: false, value: { bindingId: 'b' } }
function fixture(overrides = {}) {
  assert.equal(typeof client.createPlanningMappingSource, 'function', 'client must own mapping intents')
  let current = dto, calls = [], keys = 0
  const source = client.createPlanningMappingSource({ getPlanningMapping: async () => current, setPlanningMapping: async (...args) => { calls.push(args); current = { ...current, mapping: args[4] }; return result }, ...overrides }, { actorRef: { kind: 'user' }, key: () => `key-${++keys}` })
  return { source, calls, set: (value) => { current = value } }
}
const html = (source) => renderToStaticMarkup(React.createElement(ui.PlanningMappingForm, { source }))
const find = (node, type) => Array.isArray(node) ? node.flatMap((child) => find(child, type)) : node && typeof node === 'object' ? [...(node.type === type ? [node] : []), ...find(node.props?.children, type)] : []
function mount(source, component = ui.PlanningMappingForm, props = { source }, effects = []) {
  const slots = []; let cursor = 0
  const dispatcher = { useSyncExternalStore: (_subscribe, read) => read(), useId: () => ':fixture:', useEffect: (effect, deps) => { const i = cursor++, cell = slots[i] ??= {}; if (!cell.deps || deps.some((value, j) => value !== cell.deps[j])) effects.push(effect); cell.deps = deps }, useRef: (current) => { const i = cursor++; return slots[i] ??= { current } }, useState: (initial) => { const i = cursor++; const cell = slots[i] ??= { value: initial }; return [cell.value, (value) => { cell.value = value }] } }
  const render = () => { const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, previous = internals.ReactCurrentDispatcher.current; internals.ReactCurrentDispatcher.current = dispatcher; cursor = 0
    try { return component(props) } finally { internals.ReactCurrentDispatcher.current = previous } }
  render.flush = () => effects.splice(0).forEach(effect => effect())
  return render
}
test('chooser uses kind and IDs, distinguishes names, clears previous options and shows unmapped/native values', async () => {
  const f = fixture(); await f.source.refresh(dto.scope)
  assert.equal(typeof ui.PlanningMappingForm, 'function')
  assert.match(html(f.source), /Same.*s2/); assert.match(html(f.source), /Native/); assert.match(html(f.source), /未映射/)
  const render = mount(f.source), selects = find(render(), 'select')
  assert.deepEqual(find(selects[0], 'option').map((item) => item.props.value), ['', 's', 's2'])
  selects[0].props.onChange({ target: { value: 's2' } })
  find(render(), 'form')[0].props.onSubmit({ preventDefault() {} }); await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(f.calls[0][4], { status: { projectFieldId: 's2', options: {} } })
  f.set({ ...dto, mapping: { targetDateFieldId: 'gone' } }); await f.source.refresh(dto.scope)
  assert.match(html(f.source), /当前定义中已不存在/)
})
test('source single-flights saves, preserves unknown intent keys, discards scope changes and disposed late replies', async () => {
  let release; const f = fixture({ setPlanningMapping: (...args) => { f.calls.push(args); return new Promise((yes) => { release = yes }) } })
  await f.source.refresh(dto.scope); const first = f.source.save({}); assert.equal(f.source.save({}), first)
  assert.equal(f.source.getSnapshot().pending, true); release({ ...result, writeState: 'unknown' }); await first
  assert.match(html(f.source), /尚未确认/); const second = f.source.save({}); await new Promise((resolve) => setImmediate(resolve)); release(result); await second
  assert.equal(f.calls[0][1], f.calls[1][1])
  const third = f.source.save({ targetDateFieldId: 'd' }); await f.source.refresh({ ...dto.scope, projectExternalId: 'other' }); release(result); await third
  assert.equal(f.source.getSnapshot().data, undefined)
  const late = fixture({ getPlanningMapping: () => new Promise((yes) => { release = yes }) }); const pending = late.source.refresh(dto.scope); late.source.dispose(); release(dto); await pending
  assert.equal(late.source.getSnapshot().data, undefined)
})
test('closed DTO decoder rejects malformed fields/enums/scope; unconfirmed configuration offers retry without success', async () => {
  const f = fixture(); await f.source.refresh(dto.scope); const stable = f.source.getSnapshot(); assert.equal(f.source.getSnapshot(), stable)
  for (const bad of [{ ...dto, secret: 'RAW-CANARY' }, { ...dto, origin: 'guessed' }, { ...dto, fields: [{ id: 's', name: 'X', kind: 'single_select' }] }, { ...dto, mapping: { status: { projectFieldId: 's', options: { x: 'unknown' } } } }]) {
    f.set(bad); await f.source.refresh(dto.scope); assert.ok(f.source.getSnapshot().error); assert.doesNotMatch(JSON.stringify(f.source.getSnapshot()), /RAW-CANARY/)
  }
  f.set({ ...dto, confirmed: false }); await f.source.refresh(dto.scope); assert.match(html(f.source), /本地已保存，来源尚未确认/); assert.doesNotMatch(html(f.source), /Saved/)
})

test('unknown save first reads Host and accepts already committed intent; failed initial definitions remain retryable', async () => {
  let current = dto, saves = 0, reads = 0
  const f = fixture({ getPlanningMapping: async () => { reads++; return current }, setPlanningMapping: async (_actor, _key, _binding, _project, mapping) => { saves++; current = { ...dto, mapping }; return { ...result, writeState: 'unknown' } } })
  await f.source.refresh(dto.scope); await f.source.save({}); await f.source.save({})
  assert.equal(saves, 1); assert.equal(reads, 2); assert.deepEqual(f.source.getSnapshot().data.mapping, {})
  let broken = true; const failed = fixture({ getPlanningMapping: async () => { if (broken) throw new Error('RAW'); return dto } })
  await failed.source.refresh(dto.scope)
  const render = mount(failed.source), retry = find(render(), 'button').find((button) => button.props.children === '重试')
  assert.ok(retry); broken = false; retry.props.onClick(); await new Promise((resolve) => setImmediate(resolve))
  assert.equal(failed.source.getSnapshot().data.confirmed, true)
})

test('Form retry keeps acknowledged intent/key through read and activation failure; a new scope drops it', async () => {
  for (const activation of [false, true]) {
    let broken = false, stored = dto.mapping
    const f = fixture({ getPlanningMapping: async () => { if (broken) throw new Error('RAW'); return { ...dto, mapping: stored } }, setPlanningMapping: async (...args) => { f.calls.push(args); stored = args[4]; broken = true; return activation ? { ...result, activationError: { code: 'unavailable' } } : result } })
    await f.source.refresh(dto.scope); const render = mount(f.source)
    find(render(), 'select')[3].props.onChange({ target: { value: 'done' } })
    find(render(), 'form')[0].props.onSubmit({ preventDefault() {} }); await new Promise((resolve) => setImmediate(resolve))
    assert.equal(stored.status.options.x, 'done')
    assert.equal(find(render(), 'select')[3].props.value, 'done', 'ack/read failure must retain the submitted intent')
    assert.match(html(f.source), /本地已保存，来源尚未确认/)
    broken = false; find(render(), 'button').find((button) => button.props.children === '重试').props.onClick(); await new Promise((resolve) => setImmediate(resolve))
    assert.equal(stored.status.options.x, 'done'); assert.ok(f.calls.every((call) => call[1] === 'key-1'))
    broken = false; await f.source.refresh({ ...dto.scope, projectExternalId: 'new' })
    assert.equal(f.source.getSnapshot().intent, undefined)
  }
})

test('settings with an unconfirmed bound project loads definitions without requiring the list to be confirmed', async () => {
  const f = fixture(), effects = []
  const render = mount(f.source, ui.WorkspaceSetupGate, { setupSource: { subscribe: () => () => {}, getSnapshot: () => ({ pending: false, setup: { workspace: { id: 'ws', name: 'Workspace' }, planning: { state: 'degraded', bindingId: 'b', projectNodeId: 'p' } } }) }, source: { subscribe: () => () => {}, getSnapshot: () => undefined }, mappingSource: f.source }, effects)
  render(); effects.forEach((effect) => effect()); await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.source.getSnapshot().data?.scope.projectExternalId, 'p')
})

test('opaque option IDs are own data; inherited keys read unmapped and transport-reserved keys fail explicitly', async () => {
  const encode = HOST_REMOTE.invocations.find((entry) => entry.method === 'getPlanningMapping').result.encode
  for (const id of ['x', 'toString', '__proto__']) {
    const data = { ...dto, mapping: { status: { projectFieldId: 's', options: {} } }, fields: [{ id: 's', name: 'Status', kind: 'single_select', options: [{ id, name: 'Opaque' }] }] }
    let submitted
    const render = mount({ subscribe: () => () => {}, getSnapshot: () => ({ data, pending: false }), save: (mapping) => { submitted = mapping } })
    assert.equal(find(render(), 'select')[3].props.value, '')
    find(render(), 'select')[3].props.onChange({ target: { value: 'done' } }); find(render(), 'form')[0].props.onSubmit({ preventDefault() {} })
    assert.equal(Object.hasOwn(submitted.status.options, id), true); assert.equal(submitted.status.options[id], 'done')
    const f = fixture({ getPlanningMapping: async () => data }); await f.source.refresh(dto.scope); await f.source.save(submitted)
    if (id === '__proto__') {
      assert.throws(() => encode({ mapping: submitted }), /禁止字段/)
      assert.equal(f.calls.length, 0); assert.match(f.source.getSnapshot().error, /不支持.*选项 ID/)
    } else {
      assert.equal(encode({ mapping: submitted }).mapping.status.options[id], 'done'); assert.equal(f.calls[0][4].status.options[id], 'done')
    }
  }
})

test('definitive mapping rejections never claim saved and reload definitions before a fresh attempt', async () => {
  for (const [writeState, code] of [['failed', 'invalid_input'], ['conflict', 'conflict']]) {
    let current = dto, reject = true, reads = 0
    const f = fixture({ getPlanningMapping: async () => { reads++; return current }, setPlanningMapping: async (...args) => {
      f.calls.push(args)
      if (reject) return { writeState, saving: false, authoritative: false, value: undefined, error: { code, recovery: code === 'conflict' ? 'reapply' : 'none', retryable: false, message: 'RAW-REJECTION-CANARY', confirmedValue: undefined, attemptedValue: undefined } }
      current = { ...dto, mapping: args[4] }; return result
    } })
    await f.source.refresh(dto.scope); const render = mount(f.source)
    find(render(), 'select')[3].props.onChange({ target: { value: 'done' } })
    find(render(), 'form')[0].props.onSubmit({ preventDefault() {} }); await new Promise((resolve) => setImmediate(resolve))
    assert.doesNotMatch(html(f.source), /本地已保存/, 'a rejected intent has no local commit acknowledgement')
    assert.equal(f.source.getSnapshot().errorCode, code)
    assert.doesNotMatch(html(f.source), /RAW-REJECTION-CANARY/)
    assert.equal(find(render(), 'select')[3].props.value, 'done', 'rejection retains the editable draft')
    const reload = find(render(), 'button').find((button) => button.props.children === '重新读取字段定义')
    assert.ok(reload, 'invalid definitions/scope require a read, not replaying the refused command')
    reload.props.onClick(); await new Promise((resolve) => setImmediate(resolve))
    assert.equal(reads, 2); assert.equal(f.calls.length, 1)
    reject = false
    find(render(), 'form')[0].props.onSubmit({ preventDefault() {} }); await new Promise((resolve) => setImmediate(resolve))
    assert.equal(current.mapping.status.options.x, 'done')
    assert.notEqual(f.calls[0][1], f.calls[1][1], 'a definitive refusal permits a fresh command attempt')
  }
})

test('unknown mapping results do not claim local saved and reconcile before retrying the same key', async () => {
  let current = dto, unknown = true, reads = 0
  const f = fixture({ getPlanningMapping: async () => { reads++; return current }, setPlanningMapping: async (...args) => {
    f.calls.push(args)
    if (unknown) return { writeState: 'unknown', saving: false, authoritative: false, value: undefined }
    current = { ...dto, mapping: args[4] }; return result
  } })
  await f.source.refresh(dto.scope); await f.source.save({})
  assert.doesNotMatch(html(f.source), /本地已保存/, 'transport uncertainty is not a local commit acknowledgement')
  assert.match(html(f.source), /结果未知/)
  unknown = false; await f.source.save({})
  assert.equal(reads, 3); assert.equal(f.calls.length, 2); assert.equal(f.calls[0][1], f.calls[1][1])
  assert.deepEqual(f.source.getSnapshot().data.mapping, {}); assert.equal(f.source.getSnapshot().intent, undefined)
})

test('mapping labels use local IDs and preserve native identity in visible options', async () => {
  const f = fixture(); await f.source.refresh(dto.scope)
  const out = html(f.source), labels = [...out.matchAll(/<label for="([^"]+)"/g)].map((match) => match[1])
  assert.equal(labels.length, 5)
  for (const id of labels) assert.ok(out.includes(`<select id="${id}"`))
  assert.match(out, /aria-describedby="[^"]+-help"/)
  assert.match(out, /Same（s2）/); assert.match(out, /Native（x）/)
})

test('mapping failure focuses its submitted summary and a background read cannot reclaim focus', async () => {
  let finish, broken = false, focused = 0
  const f = fixture({ setPlanningMapping: () => new Promise(resolve => { finish = resolve }), getPlanningMapping: async () => { if (broken) throw new Error('RAW'); return dto } }); await f.source.refresh(dto.scope)
  const render = mount(f.source), tree = render(); find(tree, 'form')[0].ref.current = { querySelector: () => ({ focus: () => { focused++ } }) }; render.flush()
  find(render(), 'form')[0].props.onSubmit({ preventDefault() {} }); render(); render.flush()
  finish({ writeState: 'failed', saving: false, authoritative: false, error: { code: 'unavailable' } }); await new Promise(resolve => setImmediate(resolve)); render(); render.flush(); assert.equal(focused, 1)
  broken = true; await f.source.refresh(dto.scope); render(); render.flush(); assert.equal(focused, 1); f.source.dispose()
})

test('same-scope explicit definition refresh preserves unsent mapping with a visible unapplied notice', async () => {
  const f = fixture(); await f.source.refresh(dto.scope); const render = mount(f.source)
  find(render(), 'select')[0].props.onChange({ target: { value: 's2' } })
  f.set({ ...dto, fields: [...dto.fields] }); await f.source.refresh(dto.scope)
  assert.equal(find(render(), 'select')[0].props.value, 's2')
  assert.match(renderToStaticMarkup(render()), /未应用/)
  const other = { ...dto, scope: { ...dto.scope, projectExternalId: 'next' } }; f.set(other); await f.source.refresh(other.scope)
  assert.equal(find(render(), 'select')[0].props.value, 's', 'new scope receives its own authoritative mapping')
  find(render(), 'form')[0].props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.calls[0][3], 'next')
})

test('an acknowledged mapping draft stops masking a later authoritative same-scope definition read', async () => {
  const f = fixture(); await f.source.refresh(dto.scope); const render = mount(f.source)
  find(render(), 'select')[0].props.onChange({ target: { value: 's2' } })
  find(render(), 'form')[0].props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve)); render(); render.flush()
  f.set({ ...dto, mapping: { targetDateFieldId: 'd' } }); await f.source.refresh(dto.scope)
  assert.equal(find(render(), 'select')[0].props.value, ''); assert.equal(find(render(), 'select')[2].props.value, 'd')
})
