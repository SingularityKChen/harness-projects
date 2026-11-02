import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as client from '@harness-projects/client'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url)), React = require('react')
const scope = { workspaceId: 'ws', workItemId: 'wi', repositoryId: 'repo' }, intent = { ...scope, base: 'main', title: 'Title', body: 'Body' }
const wire = (state) => ({ writeState: state, saving: state === 'pending', authoritative: ['confirmed', 'reconciled'].includes(state), value: { phase: state, ...(['confirmed', 'reconciled'].includes(state) ? { ref: { bindingId: 'dev', objectKind: 'change_request', externalId: 'PR_1' }, entityId: 'pr-id', lineageStale: false } : {}) } })
const operation = { kind: 'operation', operationId: 'op-1', state: 'unknown', currentTarget: true, targetStamp: 'target-1', head: 'feature/work', base: 'main', title: '原请求' }
const read = (value = operation) => ({ ...scope, operation: value })
test('PR creator observes durable operation after lost response and resumes without replaying intent', async () => {
  const calls = []; let release, keys = 0
  const creator = client.createChangeRequestCreator({
    create: async (...args) => { calls.push(['create', ...args]); throw new Error('drop ack') },
    operation: async (...args) => { calls.push(['operation', ...args]); return read() },
    resume: async (...args) => { calls.push(['resume', ...args]); await new Promise((done) => { release = done }); return { ...wire('reconciled'), value: { ...wire('reconciled').value, operationId: 'op-1', targetStamp: 'target-1' } } },
  }, { kind: 'user' }, () => `key-${++keys}`)
  assert.equal((await creator.submit(intent)).writeState, 'unknown')
  assert.deepEqual(await creator.operation(scope), read())
  const first = creator.resume(scope, 'op-1'), second = creator.resume(scope, 'op-1')
  assert.equal(first, second); await Promise.resolve(); release()
  assert.equal((await first).operationId, 'op-1'); assert.equal(keys, 1)
  assert.deepEqual(calls.map((c) => c[0]), ['create', 'operation', 'resume'])
  assert.deepEqual(calls.at(-1).slice(2), ['wi', 'repo', 'op-1'])
  for (const bad of [read({ ...operation, body: 'secret' }), { ...read(), workspaceId: 'foreign' }, read({ ...operation, currentTarget: 'true' }), read({ kind: 'none', title: 'leaked' }), read({ kind: 'operation', ...operation, state: 'bogus' }), ...[ ['saved'], null, {}, new String('saved'), { toString() { return 'saved' } } ].map((state) => read({ ...operation, state })), ...[ ['unavailable'], null, {}, new String('unavailable'), { toString() { return 'unavailable' } } ].map((reason) => read({ kind: 'blocked', reason }))]) {
    const invalid = client.createChangeRequestCreator({ operation: async () => bad }, { kind: 'user' })
    await assert.rejects(() => invalid.operation(scope), TypeError)
  }
})
function componentHarness(Component, props) {
  const cells = []; let cursor = 0, effects = []
  const slot = (make) => cells[cursor++] ?? (cells[cursor - 1] = make())
  const shared = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
  return () => {
    const old = shared.ReactCurrentDispatcher.current
    shared.ReactCurrentDispatcher.current = { useRef: (value) => slot(() => ({ current: value })), useState: (value) => { const cell = slot(() => ({ value })); return [cell.value, (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next }] }, useEffect: (run, deps) => { const cell = slot(() => ({})); if (!cell.deps || deps.some((dep, n) => dep !== cell.deps[n])) effects.push(() => { cell.cleanup?.(); cell.cleanup = run() }); cell.deps = deps } }
    cursor = 0
    try { return Component(props) } finally { shared.ReactCurrentDispatcher.current = old; effects.splice(0).forEach((run) => run()) }
  }
}
test('detail recovery blocks create until local lookup and restores original summary after reload', async () => {
  const { CreateChangeRequestSection } = await import('../../packages/ui/src/create-change-request-section.ts')
  let lookup, resume, creates = 0, resumes = 0, confirmed = 0
  const props = { scope, connected: true, creator: { operation: () => new Promise((done) => { lookup = done }), submit: async () => { creates++; return { writeState: 'unknown' } }, resume: () => { resumes++; return new Promise((done) => { resume = done }) } }, onConfirmed: () => { confirmed++ } }
  const render = componentHarness(CreateChangeRequestSection, props)
  assert.doesNotMatch(JSON.stringify(render()), /"type":"form"/)
  lookup(read()); await Promise.resolve()
  assert.match(JSON.stringify(render()), /原请求/); assert.doesNotMatch(JSON.stringify(render()), /textarea/)
  const button = render().props.children.flat().find((node) => node?.type === 'button')
  button.props.onClick(); button.props.onClick(); assert.equal(resumes, 1); assert.equal(creates, 0)
  resume({ writeState: 'reconciled', operationId: 'op-1', targetStamp: 'target-1', lineageStale: true }); await Promise.resolve()
  assert.equal(confirmed, 1); assert.doesNotMatch(JSON.stringify(render()), /PR 已确认/)
  lookup(read({ ...operation, state: 'saved' })); await Promise.resolve(); assert.match(JSON.stringify(render()), /谱系暂未刷新/)
  props.scope = { ...scope, workItemId: 'other' }; render(); assert.doesNotMatch(JSON.stringify(render()), /原请求/)
  lookup(read({ kind: 'blocked', reason: 'unavailable' })); await Promise.resolve(); assert.doesNotMatch(JSON.stringify(render()), /"type":"form"/)
})
test('detail unknown without operation id queries durable slot and never resubmits empty body', async () => {
  const { CreateChangeRequestSection } = await import('../../packages/ui/src/create-change-request-section.ts')
  let query = 0, creates = 0
  const props = { scope, connected: true, creator: { operation: async () => read(++query === 1 ? { kind: 'none' } : operation), submit: async () => { creates++; return { writeState: 'unknown' } } }, onConfirmed() {} }
  const render = componentHarness(CreateChangeRequestSection, props)
  render(); await Promise.resolve(); const form = render(); assert.equal(form.type, 'form')
  form.props.onSubmit({ preventDefault() {} }); await Promise.resolve(); await Promise.resolve()
  assert.equal(creates, 1); assert.equal(query, 2); assert.match(JSON.stringify(render()), /原请求/)
})

test('detail lookup failure, wrong target and connection replacement cannot restore create or late confirmation', async () => {
  const { CreateChangeRequestSection } = await import('../../packages/ui/src/create-change-request-section.ts')
  let lookup, resume, confirmed = 0
  const props = { scope, connected: true, creator: { operation: () => new Promise((done, fail) => { lookup = { done, fail } }), resume: () => new Promise((done) => { resume = done }) }, onConfirmed() { confirmed++ } }
  const render = componentHarness(CreateChangeRequestSection, props)
  render(); lookup.fail(new Error('offline')); await Promise.resolve()
  assert.doesNotMatch(JSON.stringify(render()), /"type":"form"/)
  render().props.children.at(-1).props.onClick(); lookup.done(read({ ...operation, currentTarget: false })); await Promise.resolve()
  assert.equal(render().props.children.at(-1).props.disabled, true)
  props.creator = { ...props.creator }; render(); lookup.done(read()); await Promise.resolve()
  render().props.children.at(-1).props.onClick(); props.connected = false; render()
  resume({ writeState: 'confirmed' }); await Promise.resolve(); assert.equal(confirmed, 0)
  props.connected = true; render(); assert.doesNotMatch(JSON.stringify(render()), /原请求/)
})
test('older same-scope lookup cannot replace newer durable operation with empty create form', async () => {
  const { CreateChangeRequestSection } = await import('../../packages/ui/src/create-change-request-section.ts')
  const reads = [], props = { scope, connected: true, creator: { operation: () => new Promise((done) => reads.push(done)) }, onConfirmed() {} }
  const render = componentHarness(CreateChangeRequestSection, props)
  render().props.children.at(-1).props.onClick()
  reads[1](read()); await Promise.resolve(); assert.match(JSON.stringify(render()), /原请求/)
  reads[0](read({ kind: 'none' })); await Promise.resolve()
  assert.doesNotMatch(JSON.stringify(render()), /"type":"form"/)
})

for (const next of [ { ...operation, state: 'saved', currentTarget: false }, { kind: 'blocked', reason: 'unavailable' }, { ...operation, state: 'saved', operationId: 'other' }, { ...operation, state: 'saved', targetStamp: 'other' }, { ...operation, state: 'unknown' }, undefined ]) test(`fresh operation observation supersedes earlier confirmed response: ${JSON.stringify(next)}`, async () => {
  const { CreateChangeRequestSection } = await import('../../packages/ui/src/create-change-request-section.ts')
  let lookup, reject
  const props = { scope, connected: true, creator: { operation: () => new Promise((done, fail) => { lookup = done; reject = fail }), resume: async () => ({ writeState: 'reconciled', operationId: 'op-1', targetStamp: 'target-1' }) }, onConfirmed() {} }
  const render = componentHarness(CreateChangeRequestSection, props)
  render(); lookup(read()); await Promise.resolve()
  render().props.children.at(-1).props.onClick(); await Promise.resolve()
  assert.doesNotMatch(JSON.stringify(render()), /PR 已确认/)
  next === undefined ? reject(new Error('read denied')) : lookup(read(next)); await Promise.resolve()
  assert.doesNotMatch(JSON.stringify(render()), /PR 已确认/)
  assert.doesNotMatch(JSON.stringify(render()), /"type":"form"/)
})

test('legitimate none after cached success clears old confirmation and permits a new current-target intent', async () => {
  const { CreateChangeRequestSection } = await import('../../packages/ui/src/create-change-request-section.ts')
  let lookup
  const props = { scope, connected: true, creator: { operation: () => new Promise((done) => { lookup = done }), resume: async () => ({ writeState: 'reconciled', operationId: 'op-1', targetStamp: 'target-1' }) }, onConfirmed() {} }
  const render = componentHarness(CreateChangeRequestSection, props)
  render(); lookup(read()); await Promise.resolve()
  render().props.children.at(-1).props.onClick(); await Promise.resolve()
  lookup(read({ kind: 'none' })); await Promise.resolve()
  assert.equal(render().type, 'form'); assert.doesNotMatch(JSON.stringify(render()), /PR 已确认|原操作尚未确认/)
  assert.match(JSON.stringify(render()), /从当前执行上下文创建 PR/)
})

test('operation decoder accepts each documented primitive enum without coercion', async () => {
  const views = [ { kind: 'none' }, ...['pending', 'unknown', 'saved', 'failed', 'conflict'].map((state) => ({ ...operation, state })), ...['unavailable', 'ambiguous', 'invalid_operation'].map((reason) => ({ kind: 'blocked', reason })) ]
  for (const view of views) {
    const creator = client.createChangeRequestCreator({ operation: async () => read(view) }, { kind: 'user' })
    assert.deepEqual((await creator.operation(scope)).operation, view)
  }
})
