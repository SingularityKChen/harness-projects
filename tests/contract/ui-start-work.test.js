import '../fixtures/resolution-preflight.mjs';
import assert from 'node:assert/strict'
import test from 'node:test'
import * as client from '@harness-projects/client'
import { repositoryAccessIndex, startWorkAvailability } from '@harness-projects/ui-model'
const scope = { workspaceId: 'ws-1', workItemId: 'item-a', repositoryId: 'repo-a' }
const gates = ['development.branch.create', 'development.worktree.create', 'development.repository.read', 'development.worktree.read']
const result = (writeState, extra = {}) => ({ writeState, saving: writeState === 'pending', authoritative: ['confirmed', 'reconciled'].includes(writeState), ...extra })
test('manual start requires four Development gates and selected repository cannot borrow another connection', () => {
  const entries = gates.map((key) => ({ key, access: key.endsWith('.read') ? 'read_only' : 'available' }))
  assert.equal(startWorkAvailability(repositoryAccessIndex([], entries)).available, true)
  assert.equal(startWorkAvailability(repositoryAccessIndex(entries, [{ key: gates[0], access: 'unavailable' }])).available, false)
})
test('complete intent coalesces Promise/key, rotates only after definite failure, unknown reads before same-key replay', async () => {
  assert.equal(typeof client.createStartWork, 'function')
  const calls = [], reads = []; let release, number = 0, response = result('failed')
  const api = client.createStartWork({ getStartWorkOptions: async () => ({ workspaceId: 'ws-1', workItemId: 'item-a', executionMode: 'manual' }), startWork: (...args) => { calls.push(args); return new Promise((resolve) => { release = () => resolve(response) }) } }, async (target) => { reads.push(target); return null }, { kind: 'user' }, () => `key-${++number}`)
  const one = api.submit(scope), two = api.submit(scope); assert.equal(one, two); await Promise.resolve(); release(); await one
  const retry = api.submit(scope); await Promise.resolve(); assert.notEqual(calls[0][1], calls[1][1]); response = result('unknown'); release(); await retry
  const replay = api.submit(scope); await Promise.resolve(); await Promise.resolve(); assert.equal(reads.length, 1); assert.equal(calls[1][1], calls[2][1]); release(); await replay
  const changed = api.submit({ ...scope, branchName: 'new' }); await Promise.resolve(); assert.notEqual(calls[2][1], calls[3][1]); release(); await changed
  assert.equal((await api.options(scope)).executionMode, 'manual')
})
test('malformed responses stay unknown and never expose raw errors or accept spoofed options scope', async () => {
  assert.equal(typeof client.createStartWork, 'function')
  for (const value of [{ ...result('confirmed'), extra: 'SECRET' }, result('saved'), result('confirmed', { value: { worktreePath: 'SECRET' } }), result('confirmed', { value: { executionContextId: 'ctx', degraded: false, status: 'bogus' } }), result('confirmed', { value: { executionContextId: 'ctx', degraded: false, fallback: 'bogus' } })]) {
    const api = client.createStartWork({ startWork: async () => value, getStartWorkOptions: async () => ({ ...scope, executionMode: 'harness' }) }, async () => null, { kind: 'user' })
    assert.deepEqual(await api.submit(scope), { writeState: 'unknown', degraded: false })
    await assert.rejects(() => api.options(scope), TypeError)
  }
})

import { createRequire } from 'node:module'
import * as ui from '@harness-projects/ui'
const requireUI = createRequire(new URL('../../packages/ui/package.json', import.meta.url)), React = requireUI('react'), { renderToStaticMarkup } = requireUI('react-dom/server')
const settle = async () => { for (let n = 0; n < 8; n++) await Promise.resolve() }
function harness(props, Component = ui.StartWorkSection) {
  const cells = []; let cursor = 0, effects = []
  const slot = (make) => cells[cursor++] ?? (cells[cursor - 1] = make())
  const dispatcher = {
    useState: (value) => { const cell = slot(() => ({ value })); return [cell.value, (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next }] },
    useSyncExternalStore: (_subscribe, read) => read(),
    useRef: (value) => slot(() => ({ current: value })), useId: () => 'start-work',
    useEffect: (run, deps) => { const cell = slot(() => ({})); if (!cell.deps || deps.some((dep, index) => !Object.is(dep, cell.deps[index]))) effects.push(() => { cell.cleanup?.(); cell.cleanup = run() }); cell.deps = deps },
  }
  const render = () => { const box = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher, old = box.current; box.current = dispatcher; cursor = 0; try { return Component(props) } finally { box.current = old } }
  return { props, render, html: () => renderToStaticMarkup(render()), flush: () => { const work = effects; effects = []; work.forEach((run) => run()) }, close: () => cells.forEach((cell) => cell.cleanup?.()) }
}
const nodes = (element) => !element || typeof element !== 'object' ? [] : [element, ...React.Children.toArray(element.props?.children).flatMap(nodes)]
const find = (h, type) => nodes(h.render()).find((node) => node.type === type)
test('permission explanation and explicit validation enable only the current scoped attempt', async () => {
  const reason = 'permission 层拒绝 development.branch.create；其它获准操作仍可用，请恢复授权后重新验证并显式重试'
  const options = { workspaceId: scope.workspaceId, workItemId: scope.workItemId, executionMode: 'manual', repositories: [{ id: 'repo-a', available: true }] }
  const api = client.createStartWork({ getStartWorkOptions: async () => options, startWork: async () => result('failed', { error: { code: 'permission_denied', message: reason } }) }, async () => null, { kind: 'user' })
  assert.equal((await api.options(scope)).repositories[0].available, true)
  assert.equal((await api.submit(scope)).reason, reason)
  const h = harness({ target: { ...scope, repositoryIds: ['repo-a'] }, repositories: [{ id: 'repo-a', available: false, access: 'unavailable', reason }], connected: true, onStarted() {}, startWork: api })
  find(h, 'button').props.onClick(); h.render(); h.flush(); await settle(); find(h, 'select').props.onChange({ target: { value: 'repo-a' } })
  assert.match(h.html(), /permission 层拒绝 development.branch.create/)
  assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, true)
  options.repositories = [{ id: 'repo-a', available: true }]
  nodes(h.render()).find(node => node.type === 'button' && node.props.children === '重新验证权限').props.onClick(); await settle()
  assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, false)
  h.close()
})
test('a write denial expires prior validation and requires explicit revalidation before retry', async () => {
  const reason = 'permission 层拒绝 development.worktree.create；其它获准操作仍可用，请恢复授权后重新验证并显式重试'
  const options = { workspaceId: scope.workspaceId, workItemId: scope.workItemId, executionMode: 'manual', repositories: [{ id: 'repo-a', available: true }] }
  const keys = []; let sequence = 0, refreshed = 0, release
  const api = client.createStartWork({ getStartWorkOptions: async () => options, startWork: (_actor, key) => { keys.push(key); return new Promise(done => { release = done }) } }, async () => null, { kind: 'user' }, () => `denial-${++sequence}`)
  const h = harness({ target: { ...scope, repositoryIds: ['repo-a'] }, repositories: [{ id: 'repo-a', available: false, access: 'unavailable', reason }], connected: true, onStarted: () => refreshed++, startWork: api })
  find(h, 'button').props.onClick(); h.render(); h.flush(); await settle(); find(h, 'select').props.onChange({ target: { value: 'repo-a' } })
  const validate = () => nodes(h.render()).find(node => node.type === 'button' && node.props.children === '重新验证权限').props.onClick()
  validate(); await settle(); assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, false)
  find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle()
  release(result('local_only', { value: { executionContextId: 'ctx', status: 'failed', branchExternalId: 'retained-branch', degraded: true }, error: { code: 'permission_denied', message: reason } })); await settle()
  assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, true, 'actual denial must expire the prior validation ticket')
  assert.match(h.html(), /permission 层拒绝 development.worktree.create/); assert.match(h.html(), /（降级）/); assert.equal(refreshed, 1)
  find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle(); assert.equal(keys.length, 1)
  options.repositories = [{ id: 'repo-a', available: false, reason }]
  validate(); await settle(); assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, true)
  assert.match(h.html(), /（降级）/, 'revalidation must retain the acknowledged attempt result')
  options.repositories = [{ id: 'repo-a', available: true }]
  validate(); await settle(); assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, false)
  find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle(); assert.deepEqual(keys, ['denial-1', 'denial-2'])
  release(result('confirmed', { value: { executionContextId: 'ctx', degraded: false } })); await settle(); assert.match(h.html(), /开始工作已确认/); h.close()
})
test('Unknown and Pending denial explanations retain original-key readback eligibility', async () => {
  for (const state of ['unknown', 'pending']) {
    const reason = 'permission 层拒绝 development.worktree.create；其它获准操作仍可用，请恢复授权后重新验证并显式重试'
    const keys = []; let reads = 0, sequence = 0
    const api = client.createStartWork({ getStartWorkOptions: async () => ({ workspaceId: scope.workspaceId, workItemId: scope.workItemId, executionMode: 'manual' }), startWork: async (_actor, key) => { keys.push(key); return result(state, { error: { code: 'permission_denied', message: reason } }) } }, async () => { reads++; return null }, { kind: 'user' }, () => `uncertain-${++sequence}`)
    const h = harness({ target: { ...scope, repositoryIds: ['repo-a'] }, repositories: [{ id: 'repo-a', available: true, access: 'available' }], connected: true, onStarted() {}, startWork: api })
    find(h, 'button').props.onClick(); h.render(); h.flush(); await settle(); find(h, 'select').props.onChange({ target: { value: 'repo-a' } })
    find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle()
    assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, false)
    assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.children, '读回并恢复')
    find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle()
    assert.equal(reads, 1); assert.deepEqual(keys, ['uncertain-1', 'uncertain-1']); h.close()
  }
})
test('form opens without starting, only bound repositories, four-gate refusal and no-route navigation; unknown recovery and late target isolated', async () => {
  assert.equal(typeof ui.StartWorkSection, 'function')
  let submits = 0, refreshed = 0, bound = 0, focused = 0, resolve, sent
  const api = { options: async (target) => ({ ...target, executionMode: 'manual' }), submit: (intent) => { sent = intent; submits++; return new Promise((done) => { resolve = done }) } }
  const h = harness({ target: { ...scope, repositoryIds: ['repo-a', 'repo-b'] }, repositories: [{ id: 'repo-a', available: false, access: 'unavailable' }, { id: 'repo-b', available: true, access: 'degraded' }], startWork: api, connected: true, onStarted: () => refreshed++, onBindRepository: () => bound++ })
  assert.doesNotMatch(h.html(), /<form/); find(h, 'button').props.onClick(); h.html(); find(h, 'select').ref.current = { focus: () => focused++ }; h.flush(); await settle()
  assert.equal(focused, 1)
  assert.match(h.html(), /人工执行/); assert.equal(submits, 0)
  assert.deepEqual(nodes(h.render()).filter((node) => node.type === 'option').map((node) => node.props.value), ['', 'repo-a', 'repo-b'])
  find(h, 'select').props.onChange({ target: { value: 'repo-a' } }); assert.match(h.html(), /绑定仓库/)
  assert.equal(nodes(h.render()).find((node) => node.props.type === 'submit').props.disabled, true)
  nodes(h.render()).find((node) => node.type === 'button' && node.props.children === '绑定仓库').props.onClick(); assert.equal(bound, 1)
  find(h, 'select').props.onChange({ target: { value: 'repo-b' } }); assert.match(h.html(), /降级/)
  find(h, 'input').props.onChange({ target: { value: ' user-branch ' } })
  find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle(); assert.equal(submits, 1)
  assert.equal(sent.branchName, ' user-branch ', 'nonempty user branch name must reach Core unchanged')
  resolve({ writeState: 'unknown', degraded: false }); await settle(); assert.match(h.html(), /结果未知/); assert.doesNotMatch(h.html(), /Saved|已保存/)
  find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle(); assert.equal(submits, 2)
  h.props.target = { ...h.props.target, workItemId: 'item-b' }; h.html(); h.flush(); resolve({ writeState: 'confirmed', degraded: false }); await settle()
  assert.equal(refreshed, 1, 'unknown triggered readback; old success must not refresh a new target')
  assert.doesNotMatch(h.html(), /开始工作已确认/); h.close()
})
test('production App → page → drawer seam refreshes the existing execution reader and hides writes for PR/redacted', async () => {
  const { wire, redacted } = await import('../fixtures/work-item-wire.mjs')
  const store = client.createEntityStore(), refreshes = [], api = { options: async () => ({}), submit: async () => ({}) }
  const entries = gates.map((key) => ({ key, access: 'available' })), reader = async (scope) => { refreshes.push(scope); return null }
  const read = { workspace: { id: 'ws-1', name: 'Fixture' }, store, connection: { connected: true }, capabilities: [{ key: 'planning.item.read', access: 'available' }], repositories: [{ id: 'repo-a', capabilities: entries }] }
  const source = { getSnapshot: () => read, subscribe: () => () => {} }
  const show = (entity) => { store.applyBaseline({ revision: 0, entities: [entity], source: { revision: 0, freshness: 'fresh', authority: 'provider' } }); const app = harness({ source, initialPath: '/projects/ws-1/items/ent-aa', startWork: api, executionReader: reader }, ui.WorkItemApp); const page = harness(find(app, ui.WorkItemProjectPage).props, ui.WorkItemProjectPage); return harness(find(page, ui.WorkItemDetailDrawer).props, ui.WorkItemDetailDrawer) }
  const drawer = show(wire('ent-aa')), section = find(drawer, ui.StartWorkSection)
  assert.equal(section.props.startWork, api); assert.deepEqual(section.props.repositories, [{ id: 'repo-a', available: true, access: 'available' }])
  const execution = harness({ ...find(drawer, ui.ExecutionContextSection).props }, ui.ExecutionContextSection); execution.render(); execution.flush(); await settle(); assert.equal(refreshes.length, 1)
  section.props.onStarted(); execution.props.refreshToken = find(drawer, ui.ExecutionContextSection).props.refreshToken; execution.render(); execution.flush(); await settle(); assert.equal(refreshes.length, 2)
  read.capabilities.push(...entries); read.repositories = [{ id: 'repo-a', capabilities: [] }]
  assert.equal(find(show(wire('ent-aa')), ui.StartWorkSection).props.repositories[0].available, false, 'selected repository without route metadata cannot borrow another connection')
  for (const entity of [wire('ent-aa', { content: { contentKind: 'change_request' } }), redacted('ent-aa')]) assert.equal(find(show(entity), ui.StartWorkSection), undefined)
})
test('no bound repositories still offers binding navigation; explicit Harness label, disconnect and unmount never submit', async () => {
  let bound = 0, written = 0, resolve
  const h = harness({ target: { ...scope, repositoryIds: [] }, repositories: [], startWork: { options: () => new Promise((done) => { resolve = done }), submit: async () => { written++; return { writeState: 'confirmed' } } }, connected: true, onStarted() {}, onBindRepository: () => bound++ })
  find(h, 'button').props.onClick(); h.render(); h.flush(); resolve({ ...scope, executionMode: 'harness' }); await settle(); assert.match(h.html(), /Harness 执行/)
  nodes(h.render()).find((node) => node.type === 'button' && node.props.children === '绑定仓库').props.onClick(); assert.equal(bound, 1)
  find(h, 'form').props.onSubmit({ preventDefault() {} }); assert.equal(written, 0)
  h.props.connected = false; h.render(); h.flush(); assert.equal(nodes(h.render()).find((node) => node.props.type === 'submit').props.disabled, true); h.close()
})
test('transport uncertainty retains original key; failed readback cannot trigger another write', async () => {
  let writes = 0, reads = 0, unavailable = true; const keys = []
  const api = client.createStartWork({ getStartWorkOptions: async () => ({}), startWork: async (_actor, key) => { keys.push(key); writes++; if (writes === 1) throw new Error('SECRET transport'); return result('pending') } }, async () => { reads++; if (unavailable) throw new Error('SECRET read'); return null }, { kind: 'user' })
  assert.equal((await api.submit(scope)).writeState, 'unknown'); assert.equal((await api.submit(scope)).writeState, 'unknown'); assert.equal(writes, 1)
  unavailable = false; assert.equal((await api.submit(scope)).writeState, 'pending'); assert.equal(reads, 2); assert.equal(keys[0], keys[1])
})
test('form distinguishes local-only, pending, failed, confirmed and degraded manual recovery without claiming Saved', async () => {
  for (const [writeState, expected] of [['local_only', '本地已记录'], ['pending', '需读回确认'], ['failed', '开始工作失败'], ['confirmed', '开始工作已确认'], ['reconciled', '开始工作已对账确认']]) {
    const h = harness({ target: { ...scope, repositoryIds: ['repo-a'] }, repositories: [{ id: 'repo-a', available: true, access: 'available' }], connected: true, onStarted() {}, startWork: { options: async () => ({ ...scope, executionMode: 'manual' }), submit: async () => ({ writeState, degraded: true, fallback: 'manual_fallback' }) } })
    find(h, 'button').props.onClick(); h.render(); h.flush(); await settle(); find(h, 'select').props.onChange({ target: { value: 'repo-a' } }); find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle()
    assert.ok(h.html().includes(expected)); if (writeState === 'failed') assert.doesNotMatch(h.html(), /本地记录已保留/); assert.match(h.html(), /降级|人工处理/); assert.doesNotMatch(h.html(), /Saved|已保存/); h.close()
  }
})
test('synchronous transport throw clears pending so recovery reads before same-key replay', async () => {
  let writes = 0, reads = 0; const keys = []
  const api = client.createStartWork({ getStartWorkOptions: async () => ({}), startWork: (_actor, key) => { keys.push(key); if (++writes === 1) throw new Error('sync refusal'); return Promise.resolve(result('pending')) } }, async () => { reads++; return null }, { kind: 'user' }, () => 'stable-sync-key')
  const first = api.submit(scope); assert.equal(first, api.submit(scope)); assert.equal((await first).writeState, 'unknown')
  const recovery = api.submit(scope); assert.notEqual(first, recovery); assert.equal(recovery, api.submit(scope))
  assert.equal((await recovery).writeState, 'pending'); assert.equal(reads, 1); assert.equal(writes, 2); assert.deepEqual(keys, ['stable-sync-key', 'stable-sync-key'])
})
test('local-only without definite failed context and Unknown/Pending keep their keys, including manual fallback', async () => {
  for (const [writeState, status, fallback] of [['local_only', 'ready', 'manual_fallback'], ['local_only', 'provisioning'], ['unknown', 'failed'], ['pending', 'failed']]) {
    const keys = []; let sequence = 0, reads = 0
    const api = client.createStartWork({ getStartWorkOptions: async () => ({}), startWork: async (_actor, key) => { keys.push(key); return result(writeState, { value: { executionContextId: 'ctx', status, fallback, degraded: true } }) } }, async () => { reads++; return null }, { kind: 'user' }, () => `nonterminal-${++sequence}`)
    assert.equal((await api.submit(scope)).writeState, writeState); assert.equal((await api.submit(scope)).writeState, writeState)
    assert.equal(keys[0], keys[1]); assert.equal(reads, ['unknown', 'pending'].includes(writeState) ? 1 : 0)
  }
})
test('local-only failed context shows retained-local-facts recovery and an explicit resubmit action', async () => {
  const h = harness({ target: { ...scope, repositoryIds: ['repo-a'] }, repositories: [{ id: 'repo-a', available: true, access: 'available' }], connected: true, onStarted() {}, startWork: { options: async () => ({ ...scope, executionMode: 'manual' }), submit: async () => ({ writeState: 'local_only', contextStatus: 'failed', degraded: true }) } })
  find(h, 'button').props.onClick(); h.render(); h.flush(); await settle(); find(h, 'select').props.onChange({ target: { value: 'repo-a' } }); find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle()
  assert.match(h.html(), /开始工作失败/); assert.match(h.html(), /本地记录已保留/); assert.equal(nodes(h.render()).find((node) => node.props.type === 'submit').props.children, '重新提交'); h.close()
})
test('a non-route conflict leaves an available repository retryable without false binding guidance', async () => {
  let writes = 0
  const api = client.createStartWork({ getStartWorkOptions: async () => ({ workspaceId: scope.workspaceId, workItemId: scope.workItemId, executionMode: 'manual' }), startWork: async () => ++writes === 1 ? result('conflict', { error: { code: 'conflict', message: 'private conflict detail' } }) : result('confirmed', { value: { executionContextId: 'ctx', degraded: false } }) }, async () => null, { kind: 'user' })
  const h = harness({ target: { ...scope, repositoryIds: ['repo-a'] }, repositories: [{ id: 'repo-a', available: true, access: 'available' }], connected: true, onStarted() {}, startWork: api })
  find(h, 'button').props.onClick(); h.render(); h.flush(); await settle(); find(h, 'select').props.onChange({ target: { value: 'repo-a' } }); find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle()
  assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, false)
  assert.doesNotMatch(h.html(), /尚无可用路由|请检查仓库绑定|private conflict/)
  find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle(); assert.equal(writes, 2); assert.match(h.html(), /开始工作已确认/); h.close()
})
