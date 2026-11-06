import '../fixtures/resolution-preflight.mjs';
import assert from 'node:assert/strict'
import test from 'node:test'
import * as client from '@harness-projects/client'
import { repositoryAccessIndex, startWorkAvailability } from '@harness-projects/ui-model'
const scope = { task: 'Synthetic explicit task', workspaceId: 'ws-1', workItemId: 'item-a', repositoryId: 'repo-a' }
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
  find(h, 'button').props.onClick(); h.render(); h.flush(); await settle(); find(h, 'select').props.onChange({ target: { value: 'repo-a' } }); find(h, 'textarea').props.onChange({ target: { value: scope.task } })
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
  find(h, 'button').props.onClick(); h.render(); h.flush(); await settle(); find(h, 'select').props.onChange({ target: { value: 'repo-a' } }); find(h, 'textarea').props.onChange({ target: { value: scope.task } })
  const validate = () => nodes(h.render()).find(node => node.type === 'button' && node.props.children === '重新验证权限').props.onClick()
  validate(); await settle(); assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, false)
  find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle()
  release(result('local_only', { value: { executionContextId: 'ctx', status: 'failed', branchExternalId: 'retained-branch', degraded: true }, error: { code: 'permission_denied', message: reason } })); await settle()
  assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, true, 'actual denial must expire the prior validation ticket')
  assert.match(h.html(), /permission 层拒绝 development.worktree.create/); assert.match(h.html(), /（降级）/); assert.equal(refreshed, 1)
  find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle(); assert.equal(keys.length, 1)
  options.repositories = [{ id: 'repo-a', available: false, reason }]
  h.props.repositories = [{ id: 'repo-a', available: false, access: 'unavailable', reason: `${reason}（新观察）` }]
  h.render(); h.flush(); await settle()
  validate(); await settle(); assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, true)
  assert.match(h.html(), /（降级）/, 'revalidation must retain the acknowledged attempt result')
  options.repositories = [{ id: 'repo-a', available: true }]
  validate(); await settle(); assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, false)
  find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle(); assert.deepEqual(keys, ['denial-1', 'denial-2'])
  release(result('confirmed', { value: { executionContextId: 'ctx', degraded: false } })); await settle(); assert.match(h.html(), /开始工作已确认/); h.close()
})
test('Unknown and Pending survive access metadata changes and retain original-key readback eligibility', async () => {
  for (const state of ['unknown', 'pending']) {
    const reason = 'permission 层拒绝 development.worktree.create；其它获准操作仍可用，请恢复授权后重新验证并显式重试'
    const keys = []; let reads = 0, sequence = 0
    const api = client.createStartWork({ getStartWorkOptions: async () => ({ workspaceId: scope.workspaceId, workItemId: scope.workItemId, executionMode: 'manual' }), startWork: async (_actor, key) => { keys.push(key); return result(state, { error: { code: 'permission_denied', message: reason } }) } }, async () => { reads++; return null }, { kind: 'user' }, () => `uncertain-${++sequence}`)
    const h = harness({ target: { ...scope, repositoryIds: ['repo-a'] }, repositories: [{ id: 'repo-a', available: true, access: 'available' }], connected: true, onStarted() {}, startWork: api })
    find(h, 'button').props.onClick(); h.render(); h.flush(); await settle(); find(h, 'select').props.onChange({ target: { value: 'repo-a' } }); find(h, 'textarea').props.onChange({ target: { value: scope.task } })
    find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle()
    assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, false)
    assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.children, '读回并恢复')
    h.props.repositories = [{ id: 'repo-a', available: false, access: 'unavailable', reason }]
    h.render(); h.flush(); await settle()
    assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.children, '读回并恢复')
    assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, true)
    nodes(h.render()).find(node => node.type === 'button' && node.props.children === '重新验证权限').props.onClick(); await settle()
    assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, true, 'missing confirmation cannot override the current access denial')
    h.props.repositories = [{ id: 'repo-a', available: true, access: 'available' }]
    h.render(); h.flush(); await settle()
    find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle()
    assert.equal(reads, 1); assert.deepEqual(keys, ['uncertain-1', 'uncertain-1']); h.close()
  }
})
test('same-scope access denial preserves the in-flight command and rejects late options without restoring write eligibility', async () => {
  let finish, oldOptions, calls = 0, refreshed = 0
  const options = { workspaceId: scope.workspaceId, workItemId: scope.workItemId, executionMode: 'manual', repositories: [{ id: 'repo-a', available: true }] }
  const api = { options: async () => options, submit: () => { calls++; return new Promise(done => { finish = done }) } }
  const h = harness({ target: { ...scope, repositoryIds: ['repo-a'] }, repositories: [{ id: 'repo-a', available: true, access: 'available' }], connected: true, onStarted: () => refreshed++, startWork: api })
  find(h, 'button').props.onClick(); h.render(); h.flush(); await settle(); find(h, 'select').props.onChange({ target: { value: 'repo-a' } }); find(h, 'textarea').props.onChange({ target: { value: scope.task } })
  find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle()
  h.props.repositories = [{ id: 'repo-a', available: false, access: 'unavailable', reason: 'permission 层拒绝 development.worktree.create；重新验证' }]
  h.render(); h.flush(); await settle()
  assert.equal(find(h, 'select').props.disabled, true, 'metadata is not completion of the pending command')
  assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.children, '正在提交')
  finish({ writeState: 'confirmed', degraded: false }); await settle()
  assert.match(h.html(), /开始工作已确认/); assert.equal(refreshed, 1)
  assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, true, 'late real success must not restore write eligibility')
  api.options = () => new Promise(done => { oldOptions = done })
  nodes(h.render()).find(node => node.type === 'button' && node.props.children === '重新验证权限').props.onClick()
  h.props.repositories = [{ ...h.props.repositories[0], reason: 'permission 层拒绝 development.worktree.create；更新拒绝' }]
  api.options = async () => ({ ...options, repositories: [{ id: 'repo-a', available: false }] })
  h.render(); h.flush(); await settle(); oldOptions(options); await settle()
  assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, true, 'old validation cannot restore a newer denial')
  find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle(); assert.equal(calls, 1); h.close()
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
  find(h, 'select').props.onChange({ target: { value: 'repo-a' } }); find(h, 'textarea').props.onChange({ target: { value: scope.task } }); assert.match(h.html(), /绑定仓库/)
  assert.equal(nodes(h.render()).find((node) => node.props.type === 'submit').props.disabled, true)
  nodes(h.render()).find((node) => node.type === 'button' && node.props.children === '绑定仓库').props.onClick(); assert.equal(bound, 1)
  find(h, 'select').props.onChange({ target: { value: 'repo-b' } }); find(h, 'textarea').props.onChange({ target: { value: scope.task } }); assert.match(h.html(), /降级/)
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
    find(h, 'button').props.onClick(); h.render(); h.flush(); await settle(); find(h, 'select').props.onChange({ target: { value: 'repo-a' } }); find(h, 'textarea').props.onChange({ target: { value: scope.task } }); find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle()
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
  find(h, 'button').props.onClick(); h.render(); h.flush(); await settle(); find(h, 'select').props.onChange({ target: { value: 'repo-a' } }); find(h, 'textarea').props.onChange({ target: { value: scope.task } }); find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle()
  assert.match(h.html(), /开始工作失败/); assert.match(h.html(), /本地记录已保留/); assert.equal(nodes(h.render()).find((node) => node.props.type === 'submit').props.children, '重新提交'); h.close()
})
test('a non-route conflict leaves an available repository retryable without false binding guidance', async () => {
  let writes = 0
  const api = client.createStartWork({ getStartWorkOptions: async () => ({ workspaceId: scope.workspaceId, workItemId: scope.workItemId, executionMode: 'manual' }), startWork: async () => ++writes === 1 ? result('conflict', { error: { code: 'conflict', message: 'private conflict detail' } }) : result('confirmed', { value: { executionContextId: 'ctx', degraded: false } }) }, async () => null, { kind: 'user' })
  const h = harness({ target: { ...scope, repositoryIds: ['repo-a'] }, repositories: [{ id: 'repo-a', available: true, access: 'available' }], connected: true, onStarted() {}, startWork: api })
  find(h, 'button').props.onClick(); h.render(); h.flush(); await settle(); find(h, 'select').props.onChange({ target: { value: 'repo-a' } }); find(h, 'textarea').props.onChange({ target: { value: scope.task } }); find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle()
  assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, false)
  assert.doesNotMatch(h.html(), /尚无可用路由|请检查仓库绑定|private conflict/)
  find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle(); assert.equal(writes, 2); assert.match(h.html(), /开始工作已确认/); h.close()
})

test('write uncertainty and manual handoff remain separate visible facts beside recovery actions', async () => {
  const h = harness({ target: { ...scope, repositoryIds: ['repo-a'] }, repositories: [{ id: 'repo-a', available: true, access: 'available' }], connected: true, onStarted() {}, startWork: { options: async () => ({ ...scope, executionMode: 'manual' }), submit: async () => ({ writeState: 'unknown', fallback: 'manual_fallback', degraded: true }) } })
  find(h, 'button').props.onClick(); h.render(); h.flush(); await settle()
  find(h, 'select').props.onChange({ target: { value: 'repo-a' } }); find(h, 'textarea').props.onChange({ target: { value: scope.task } }); find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle()
  const status = nodes(h.render()).find((node) => node.props.role === 'status'), paragraphs = nodes(status).filter((node) => node.type === 'p')
  assert.equal(paragraphs.length, 2, 'write result and manual handoff need independent paragraphs')
  const visible = h.html().replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
  assert.match(visible, /结果未知/); assert.match(visible, /人工处理，可在工作树继续/); assert.match(visible, /读回并恢复/)
  assert.doesNotMatch(visible, /运行成功|已保存|Saved/); h.close()
})

async function focusFixture(t) {
  const body = {}, outside = {}, listeners = new Set(), pending = []; let focuses = 0
  const doc = { body, activeElement: body, addEventListener: (_name, listener) => listeners.add(listener), removeEventListener: (_name, listener) => listeners.delete(listener) }
  const action = { isConnected: true, focus() { focuses++; doc.activeElement = action } }, field = { focus() { doc.activeElement = field } }
  const form = { isConnected: true, ownerDocument: doc, contains: (node) => node === action || node === field }
  const h = harness({ target: { ...scope, repositoryIds: ['repo-a'] }, repositories: [{ id: 'repo-a', available: true, access: 'available' }], connected: true, onStarted() {}, startWork: { options: async (target) => ({ ...target, executionMode: 'manual' }), submit: () => new Promise((resolve) => pending.push(resolve)) } })
  find(h, 'button').props.onClick(); const bind = () => {
    const root = find(h, 'form'), submit = nodes(h.render()).find((node) => node.props.type === 'submit')
    if (root?.ref) root.ref.current = form
    if (submit?.ref) submit.ref.current = action
    find(h, 'select').ref.current = field
  }
  bind(); h.flush(); await settle(); find(h, 'select').props.onChange({ target: { value: 'repo-a' } }); find(h, 'textarea').props.onChange({ target: { value: scope.task } }); find(h, 'input').props.onChange({ target: { value: 'feature/keyboard' } }); t.after(h.close)
  return { h, doc, body, outside, action, listeners, get focuses() { return focuses },
    async submit(origin = field) { doc.activeElement = origin; find(h, 'form').props.onSubmit({ preventDefault() {} }); h.render(); doc.activeElement = body; h.flush(); await settle() },
    moveFocus(target) { doc.activeElement = target; for (const listener of listeners) listener({ target }) },
    async finish(state = 'unknown', index = 0, render = true) { pending[index]({ writeState: state, degraded: false }); await settle(); if (render) { h.render(); h.flush() } },
    async switchTarget() { h.props.target = { ...h.props.target, workItemId: 'item-new' }; h.render(); h.flush(); await settle(); bind(); find(h, 'textarea').props.onChange({ target: { value: scope.task } }) },
  }
}
for (const writeState of ['unknown', 'failed']) test(`keyboard submission recovers lost focus to the ${writeState} action once`, async (t) => {
  const f = await focusFixture(t); await f.submit(); await f.finish(writeState)
  assert.equal(f.focuses, 1, 'disabled source lost focus; the resulting recovery action must regain it')
  assert.equal(f.doc.activeElement, f.action); assert.equal(nodes(f.h.render()).find((node) => node.props.type === 'submit').props.disabled, false)
  assert.match(f.h.html(), writeState === 'unknown' ? /读回并恢复/ : /重新提交/); assert.equal(find(f.h, 'input').props.value, 'feature/keyboard')
  f.h.render(); f.h.flush(); assert.equal(f.focuses, 1); assert.equal(f.listeners.size, 0)
})
test('moving focus away permanently cancels recovery even after a later blur to body', async (t) => {
  const f = await focusFixture(t); await f.submit(); f.moveFocus(f.outside)
  f.h.props.repositories = [{ id: 'repo-a', available: false, access: 'unavailable' }]; f.h.render(); f.h.flush(); await settle()
  assert.equal(f.doc.activeElement, f.outside, 'access metadata must not steal focus from an explicit user move')
  f.doc.activeElement = f.body; await f.finish()
  assert.equal(f.focuses, 0); assert.equal(f.doc.activeElement, f.body); assert.equal(f.listeners.size, 0)
  f.h.props.repositories = [{ id: 'repo-a', available: true, access: 'available' }]; f.h.render(); f.h.flush(); await settle()
  await f.submit(f.outside); await f.finish('failed', 1); assert.equal(f.focuses, 0, 'programmatic submit without form focus must not arm recovery')
})
for (const boundary of ['close', 'disconnect', 'unmount']) test(`focus recovery cancels at ${boundary} and ignores its late result`, async (t) => {
  const f = await focusFixture(t); await f.submit()
  if (boundary === 'close') nodes(f.h.render()).find((node) => node.props.children === '收起表单').props.onClick()
  if (boundary === 'disconnect') f.h.props.connected = false
  if (boundary === 'unmount') f.h.close(); else { f.h.render(); f.h.flush() }
  await f.finish('unknown', 0, boundary !== 'unmount'); assert.equal(f.focuses, 0); assert.equal(f.listeners.size, 0)
})
test('late target result cannot clear a newer focus ticket and disconnected action cannot receive focus', async (t) => {
  const f = await focusFixture(t); await f.submit(); await f.switchTarget(); await f.submit(); await f.finish('confirmed', 0)
  assert.equal(f.focuses, 0); await f.finish('unknown', 1); assert.equal(f.focuses, 1)
  await f.submit(); f.action.isConnected = false; await f.finish('failed', 2); assert.equal(f.focuses, 1)
})

test('explicit task is blank initially, frozen through uncertainty, and cleared across owners', async () => {
  const sent = [], api = { options: async target => ({ ...target, executionMode: 'harness' }), submit: async intent => { sent.push(intent); return { writeState: 'unknown', degraded: false } } }
  const h = harness({ target: { ...scope, repositoryIds: ['repo-a'] }, repositories: [{ id: 'repo-a', available: true }], connected: true, onStarted() {}, startWork: api })
  find(h, 'button').props.onClick(); h.render(); h.flush(); await settle()
  assert.equal(find(h, 'textarea')?.props.value, '')
  find(h, 'select').props.onChange({ target: { value: 'repo-a' } })
  assert.equal(nodes(h.render()).find(node => node.props.type === 'submit').props.disabled, true)
  const task = '  明确任务 🧪\n  '
  find(h, 'textarea').props.onChange({ target: { value: task } }); find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle()
  assert.equal(sent[0].task, task); assert.equal(find(h, 'textarea').props.disabled, true)
  find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle(); assert.deepEqual(sent[1], sent[0])
  h.props.target = { ...h.props.target, workItemId: 'new-owner' }; h.render(); h.flush(); await settle()
  assert.equal(find(h, 'textarea').props.value, ''); h.close()
})
test('closing an unknown task preserves its frozen original while client ownership clears it', async () => {
  const sent = [], api = { options: async target => ({ ...target, executionMode: 'manual' }), submit: async intent => { sent.push(intent); return { writeState: 'unknown', degraded: false } } }
  const h = harness({ target: { ...scope, repositoryIds: ['repo-a'] }, repositories: [{ id: 'repo-a', available: true }], connected: true, onStarted() {}, startWork: api })
  find(h, 'button').props.onClick(); h.render(); h.flush(); await settle(); find(h, 'select').props.onChange({ target: { value: 'repo-a' } }); find(h, 'textarea').props.onChange({ target: { value: scope.task } })
  find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle()
  nodes(h.render()).find(node => node.props.children === '收起表单').props.onClick(); h.render(); h.flush()
  find(h, 'button').props.onClick(); h.render(); h.flush(); await settle(); assert.equal(find(h, 'textarea').props.disabled, true)
  find(h, 'form').props.onSubmit({ preventDefault() {} }); await settle(); assert.deepEqual(sent[1], sent[0])
  h.props.startWork = { ...api }; h.render(); h.flush(); await settle(); assert.equal(find(h, 'textarea').props.value, '')
  find(h, 'textarea').props.onChange({ target: { value: scope.task } }); h.props.connected = false; h.render(); h.flush(); assert.equal(find(h, 'textarea').props.value, ''); h.close()
})
test('client captures task once before its async send and includes task in intent identity', async () => {
  const calls = []; let current = '  task 🧪\n ', reads = 0, sequence = 0
  const api = client.createStartWork({ getStartWorkOptions: async () => ({}), startWork: async (...args) => { calls.push(args); return result('pending') } }, async () => null, { kind: 'user' }, () => `task-${++sequence}`)
  const input = { ...scope, get task() { reads++; return current } }, pending = api.submit(input)
  input.workItemId = 'changed'; current = 'changed'; await pending
  assert.deepEqual([reads, calls[0][2], calls[0][4]], [1, scope.workItemId, '  task 🧪\n '])
  await api.submit({ ...scope, task: 'different' }); assert.notEqual(calls[1][1], calls[0][1])
})
