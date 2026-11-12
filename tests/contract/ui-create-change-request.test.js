import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as client from '@harness-projects/client'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url)), React = require('react')
const scope = { workspaceId: 'ws', workItemId: 'wi', repositoryId: 'repo' }, intent = { ...scope, base: 'main', title: 'Title', body: 'Body' }
const wire = (state) => ({ writeState: state, saving: state === 'pending', authoritative: ['confirmed', 'reconciled'].includes(state), value: { phase: state, ...(['confirmed', 'reconciled'].includes(state) ? { ref: { bindingId: 'dev', objectKind: 'change_request', externalId: 'PR_1' }, entityId: 'pr-id', lineageStale: false } : {}) } })
const operation = { kind: 'operation', operationId: 'op-1', state: 'unknown', currentTarget: true, targetStamp: 'target-1', head: 'feature/work', base: 'main', title: '原请求', draft: true, issueRelation: 'none' }
const read = (value = operation) => ({ ...scope, operation: value })
test('original PR history is a strict read-only summary and exposes no recovery or assignment action', async () => {
  const history = { kind: 'history', operationId: 'original-pr', state: 'saved', title: 'Historical title', head: 'feature/original', base: 'main', draft: false }
  const creator = client.createChangeRequestCreator({ operation: async () => read(history) }, { kind: 'user' })
  assert.deepEqual(await creator.operation(scope), read(history))
  for (const patch of [{ state: 'unknown' }, { issueRelation: 'none' }, { assignment: { state: 'none' } }, { currentTarget: true }, { draft: undefined }]) {
    const invalid = client.createChangeRequestCreator({ operation: async () => read({ ...history, ...patch }) }, { kind: 'user' })
    await assert.rejects(() => invalid.operation(scope), TypeError)
  }
  const { CreateChangeRequestSection } = await import('../../packages/ui/src/create-change-request-section.ts')
  const props = { scope, connected: true, accessToken: 'before', creator, onConfirmed() { assert.fail('history cannot confirm a current write') } }
  const render = componentHarness(CreateChangeRequestSection, props)
  render(); await Promise.resolve(); await Promise.resolve()
  const tree = render(), text = JSON.stringify(tree)
  assert.match(text, /旧版已确认 PR 历史记录.*Historical title/)
  assert.doesNotMatch(text, /"type":"(?:button|form)"|ChangeRequestAssignees/)
  props.accessToken = 'after'
  assert.doesNotMatch(JSON.stringify(render()), /Historical title/, 'stale read authorization cannot expose history')
})
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
  props.creator.options ??= async () => ({ defaultRelation: 'none', relations: ['none'] })
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
  render(); await Promise.resolve(); render(); await Promise.resolve(); const form = render(); assert.equal(form.type, 'form')
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

test('Draft checkbox defaults false, submits explicit choice, freezes pending and resets owner', async () => {
  const { CreateChangeRequestSection } = await import('../../packages/ui/src/create-change-request-section.ts')
  let submitted, release
  const props = { scope, connected: true, creator: { operation: async () => read({ kind: 'none' }), submit: (intent) => { submitted = intent; return new Promise((done) => { release = done }) } }, onConfirmed() {} }
  const render = componentHarness(CreateChangeRequestSection, props)
  const checkbox = () => render().props.children.flat().find((node) => node?.type === 'label' && node.props.children?.[1]?.props.type === 'checkbox').props.children[1]
  render(); await Promise.resolve(); render(); await Promise.resolve(); assert.equal(checkbox().props.checked, false)
  checkbox().props.onChange({ target: { checked: true } })
  assert.match(JSON.stringify(render()), /创建草稿 PR/)
  render().props.onSubmit({ preventDefault() {} }); assert.equal(submitted.draft, true); assert.equal(checkbox().props.disabled, true)
  release({ writeState: 'failed' }); await Promise.resolve()
  props.scope = { ...scope, workItemId: 'new' }; render(); await Promise.resolve(); render(); await Promise.resolve(); assert.equal(checkbox().props.checked, false)
})
test('client transmits Draft boolean and rejects malformed durable summary', async () => {
  const calls = [], creator = client.createChangeRequestCreator({ create: async (...args) => { calls.push(args); return wire('unknown') }, operation: async () => read({ ...operation, draft: 'true' }) }, { kind: 'user' }, () => 'key')
  await creator.submit({ ...intent, draft: true }); assert.equal(calls[0][7], true)
  await assert.rejects(() => creator.operation(scope), TypeError)
})

test('client snapshots Draft once before await and rejects explicit nonboolean without dispatch', async () => {
  const calls = [], creator = client.createChangeRequestCreator({ create: async (...args) => { calls.push(args); return wire('unknown') } }, { kind: 'user' }, () => 'key')
  for (const draft of [null, 'true', {}, 0]) await creator.submit({ ...intent, draft })
  assert.equal(calls.length, 0)
  let reads = 0, draft = true
  const pending = creator.submit({ ...intent, get draft() { reads++; return draft } }); draft = false
  await pending; assert.equal(reads, 1); assert.equal(calls[0][7], true)
})
test('eligible Issue preview defaults to reference, allows clearing and rejects stale options after scope changes', async () => {
  const { CreateChangeRequestSection } = await import('../../packages/ui/src/create-change-request-section.ts')
  let submitted, release
  const props = { scope, connected: true, creator: { operation: async () => read({ kind: 'none' }), options: () => new Promise(done => { release = done }), submit: async value => { submitted = value; return { writeState: 'failed' } } }, onConfirmed() {} }
  const render = componentHarness(CreateChangeRequestSection, props)
  render(); await Promise.resolve(); render()
  release({ defaultRelation: 'reference', relations: ['reference', 'none'], target: { repositoryName: 'example/project', number: 545 }, reason: '默认分支才可关闭' }); await Promise.resolve()
  const form = render(), select = form.props.children.flat().find(n => n?.type === 'label' && n.props.children[1]?.type === 'select').props.children[1]
  assert.equal(select.props.value, 'reference'); assert.match(JSON.stringify(form), /Refs example\/project#545/)
  select.props.onChange({ target: { value: 'none' } }); render().props.onSubmit({ preventDefault() {} }); await Promise.resolve()
  assert.equal(submitted.issueRelation, 'none')
  render().props.children.flat().find(n => n?.type === 'label' && n.props.children[1]?.props.name === 'base').props.children[1].props.onChange({ target: { value: 'release' } }); render()
  const stale = release; props.scope = { ...scope, workItemId: 'other' }; render()
  stale({ defaultRelation: 'reference', relations: ['reference', 'none'], target: { repositoryName: 'hidden/old', number: 777 } }); await Promise.resolve()
  assert.doesNotMatch(JSON.stringify(render()), /example\/project#545|hidden\/old|777/)
})
for (const late of ['options', 'operation', 'resume', 'acknowledged']) test(`access metadata fences late ${late} without remount, probing or replay`, async () => {
  const { CreateChangeRequestSection } = await import('../../packages/ui/src/create-change-request-section.ts')
  const linked = { ...operation, state: 'saved', issueRelation: 'reference', issueTarget: { repositoryName: 'example/project', number: 545 } }
  const hidden = { ...linked }; delete hidden.issueTarget
  let release, revoked = false, reads = 0, probes = 0, writes = 0, confirmations = 0
  const props = { scope, accessToken: 'allowed', connected: true, creator: {
    operation: () => late === 'operation' && reads++ === 0 ? new Promise(done => { release = done }) : Promise.resolve(read(late === 'options' ? { kind: 'none' } : revoked ? hidden : linked)),
    options: () => { probes++; return new Promise(done => { release = done }) },
    resume: () => { writes++; return new Promise(done => { release = done }) }, submit: async () => { writes++; return { writeState: 'unknown' } },
  }, onConfirmed() { confirmations++ } }
  const render = componentHarness(CreateChangeRequestSection, props)
  render(); await Promise.resolve(); render(); await Promise.resolve()
  if (['resume', 'acknowledged'].includes(late)) { assert.match(JSON.stringify(render()), /example\/project#545/); render().props.children.at(-1).props.onClick() }
  if (late === 'acknowledged') {
    release({ writeState: 'reconciled', operationId: 'op-1', targetStamp: 'target-1', relationState: 'confirmed' }); await Promise.resolve(); render(); await Promise.resolve()
    assert.match(JSON.stringify(render()), /PR 已确认.*Issue 关联已由来源确认/)
  }
  const pendingProbes = probes; revoked = true; props.accessToken = 'denied'; render()
  assert.doesNotMatch(JSON.stringify(render()), /example\/project#545/)
  if (late === 'resume') render().props.children.at(-1).props.onClick()
  if (late !== 'acknowledged') release(late === 'options' ? { defaultRelation: 'reference', relations: ['reference', 'none'], target: linked.issueTarget } : late === 'operation' ? read(linked) : { writeState: 'reconciled', operationId: 'op-1', targetStamp: 'target-1', relationState: 'confirmed' })
  await Promise.resolve(); render(); await Promise.resolve()
  assert.doesNotMatch(JSON.stringify(render()), /example\/project#545|Issue 关联已由来源确认/); assert.equal(confirmations, late === 'acknowledged' ? 1 : 0)
  if (late === 'acknowledged') assert.match(JSON.stringify(render()), /PR 已确认/)
  for (const token of ['metadata-2', 'metadata-3']) { props.accessToken = token; render(); await Promise.resolve(); render() }
  assert.equal(probes, pendingProbes, 'metadata may query the operation but must not probe Issue targets')
  assert.equal(writes, ['resume', 'acknowledged'].includes(late) ? 1 : 0, 'access changes preserve the pending write dedupe slot')
})

test('client freezes preselection and strictly decodes independent assignment states', async () => {
  const calls = [], ids = ['U_2', 'U_1'], creator = client.createChangeRequestCreator({ create: async (...args) => { calls.push(args); return { ...wire('reconciled'), value: { ...wire('reconciled').value, operationId: 'op-1', targetStamp: 'target-1', assignment: { state: 'failed', reason: 'permission_denied' } } } } }, { kind: 'user' }, () => 'key')
  const pending = creator.submit({ ...intent, draft: true, issueRelation: 'closing', issueTargetStamp: 'issue', assigneeIds: ids }); ids[0] = 'changed'
  assert.deepEqual((await pending).assignment, { state: 'failed', reason: 'permission_denied' }); assert.deepEqual(calls[0].slice(7), [true, 'closing', 'issue', ['U_1', 'U_2']])
  for (const assignment of [{ state: 'saved' }, { state: 'confirmed', login: 'private' }, { state: 'failed', reason: 'secret' }]) {
    const bad = client.createChangeRequestCreator({ operation: async () => read({ ...operation, assignment }) }, { kind: 'user' })
    await assert.rejects(() => bad.operation(scope), TypeError)
  }
})
test('creator access change masks candidates while preserving draft and current write ownership', async () => {
  const { CreateChangeRequestSection } = await import('../../packages/ui/src/create-change-request-section.ts'), { ChangeRequestAssigneePicker } = await import('../../packages/ui/src/change-request-assignees-section.ts')
  let submitted, release, writes = 0
  const props = { scope, accessToken: 'one', connected: true, creator: { assignees: {}, operation: async () => read({ kind: 'none' }), submit: input => { writes++; submitted = input; return new Promise(done => { release = done }) } }, onConfirmed() {} }
  const render = componentHarness(CreateChangeRequestSection, props), flush = async () => { render(); await Promise.resolve(); render(); await Promise.resolve() }
  await flush()
  const picker = () => render().props.children.flat().find(n => n?.type === ChangeRequestAssigneePicker)
  assert.ok(picker()); picker().props.onChange(['U_sensitive'])
  for (const label of render().props.children.flat().filter(n => n?.type === 'label')) { const field = label.props.children[1]; if (['base', 'title', 'body'].includes(field.props.name)) field.props.onChange({ target: { value: field.props.name === 'base' ? 'main' : '保留草稿' } }); if (field.props.name === 'draft') field.props.onChange({ target: { checked: true } }) }
  const key = picker().key; props.accessToken = 'two'; await flush()
  assert.notEqual(picker().key, key); assert.deepEqual(picker().props.value, []); assert.match(JSON.stringify(render()), /保留草稿/)
  render().props.children.flat().find(n => n?.type === 'button' && n.props.children === '重新验证来源 Issue').props.onClick(); await flush()
  picker().props.onChange(['U_current']); render().props.onSubmit({ preventDefault() {} }); assert.deepEqual(submitted.assigneeIds, ['U_current']); assert.equal(submitted.draft, true)
  const pendingKey = picker().key; props.refreshToken = 1; await flush(); assert.notEqual(picker().key, pendingKey); assert.match(JSON.stringify(render()), /保留草稿/)
  props.accessToken = 'three'; await flush(); render().props.onSubmit({ preventDefault() {} }); assert.equal(writes, 1)
  release({ writeState: 'unknown' }); await Promise.resolve(); props.connected = false; render(); assert.doesNotMatch(JSON.stringify(render()), /U_sensitive|U_current/)
})

test('preflight assignee refusal explains clearing selection without claiming a PR exists', async () => {
  const { CreateChangeRequestSection } = await import('../../packages/ui/src/create-change-request-section.ts')
  const props = { scope, connected: true, creator: { operation: async () => read({ kind: 'none' }), submit: async () => ({ writeState: 'failed', assignment: { state: 'failed', reason: 'not_supported' } }) }, onConfirmed() {} }
  const render = componentHarness(CreateChangeRequestSection, props)
  render(); await Promise.resolve(); render(); await Promise.resolve(); render().props.onSubmit({ preventDefault() {} }); await Promise.resolve()
  assert.match(JSON.stringify(render()), /负责人.*清空/); assert.doesNotMatch(JSON.stringify(render()), /PR 已确认/)
})
test('client optional ABI shares omitted and empty intent while selected IDs append parameter eleven', async () => {
  const calls = [], creator = client.createChangeRequestCreator({ create: async (...args) => { calls.push(args); return wire('unknown') } }, { kind: 'user' }, () => 'optional-ids')
  const omitted = creator.submit(intent), empty = creator.submit({ ...intent, assigneeIds: [] })
  assert.equal(omitted, empty); await omitted
  assert.equal(calls.length, 1); assert.equal(calls[0].length, 10)
  await creator.submit({ ...intent, assigneeIds: ['U_2', 'U_1'] }); assert.equal(calls[1].length, 11); assert.deepEqual(calls[1][10], ['U_1', 'U_2'])
  for (const assigneeIds of [null, 'U', [' '], Array(11).fill('U')]) assert.equal((await creator.submit({ ...intent, assigneeIds })).writeState, 'failed')
  assert.equal(calls.length, 2)
})
for (const next of ['unknown', 'blocked', 'waiting', 'mismatch']) test(`fresh assignment observation supersedes earlier confirmed response: ${next}`, async () => {
  const { CreateChangeRequestSection } = await import('../../packages/ui/src/create-change-request-section.ts')
  let lookup
  const original = { ...operation, state: 'saved', assignment: { state: 'unknown' } }
  const props = { scope, connected: true, creator: { operation: () => new Promise(done => { lookup = done }), resume: async () => ({ writeState: 'reconciled', operationId: 'op-1', targetStamp: 'target-1', assignment: { state: 'confirmed' } }) }, onConfirmed() {} }
  const render = componentHarness(CreateChangeRequestSection, props)
  render(); lookup(read(original)); await Promise.resolve()
  render().props.children.flat().find(n => n?.type === 'button').props.onClick(); await Promise.resolve()
  assert.doesNotMatch(JSON.stringify(render()), /创建时负责人已确认/, 'waiting for fresh Host read cannot resurrect response confirmation')
  if (next !== 'waiting') {
    lookup(read(next === 'blocked' ? { kind: 'blocked', reason: 'unavailable' } : next === 'mismatch' ? { ...original, operationId: 'foreign', assignment: { state: 'confirmed' } } : original)); await Promise.resolve()
    assert.doesNotMatch(JSON.stringify(render()), /创建时负责人已确认/)
    if (next === 'unknown') assert.match(JSON.stringify(render()), /PR 已确认.*创建时负责人尚未确认/)
  }
})

for (const source of ['operation', 'result']) test(`repo access change preserves proven no assignment intent from ${source}`, async () => {
  const { CreateChangeRequestSection } = await import('../../packages/ui/src/create-change-request-section.ts')
  let reads = 0
  const props = { scope, connected: true, accessToken: 'creator', assigneeAccessToken: 'before', creator: { operation: async () => { reads++; return read({ ...operation, state: 'saved', ...(source === 'operation' ? { assignment: { state: 'none' } } : {}) }) }, resume: async () => ({ writeState: 'reconciled', operationId: 'op-1', targetStamp: 'target-1', assignment: { state: 'none' } }) }, onConfirmed() {} }
  const render = componentHarness(CreateChangeRequestSection, props)
  render(); await Promise.resolve()
  if (source === 'result') { render().props.children.flat().find(child => child?.type === 'button').props.onClick(); await Promise.resolve(); await Promise.resolve() }
  assert.doesNotMatch(JSON.stringify(render()), /创建时负责人|原负责人意图/); const before = reads
  props.assigneeAccessToken = 'after'; assert.doesNotMatch(JSON.stringify(render()), /创建时负责人|原负责人意图/); assert.equal(reads, before)
})
