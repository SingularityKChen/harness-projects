import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as client from '@harness-projects/client'
const scope = { workspaceId: 'ws', workItemId: 'wi', repositoryId: 'repo', createOperationId: 'create-1' }
test('assignment client scopes candidates and only retains active single flights', async () => {
  assert.equal(typeof client.createChangeRequestAssignees, 'function'); let finish, calls = 0
  const port = client.createChangeRequestAssignees({ options: async s => ({ ...s, targetStamp: 'stamp', items: [{ id: 'U_1', login: 'allowed' }], nextCursor: undefined }),
    operation: async () => ({ ...scope, operation: { kind: 'none' } }), add: () => { calls++; return new Promise(resolve => { finish = () => resolve({ ...scope, result: { writeState: 'unknown', saving: false, authoritative: false, value: { phase: 'unknown', operationId: 'a-1' } } }) }) }, resume: async () => { throw Error('offline') } })
  const directoryScope = { workspaceId: 'ws', workItemId: 'wi', repositoryId: 'repo' }
  assert.equal((await port.options(directoryScope)).items[0].login, 'allowed')
  const first = port.add(scope, ['U_1']), second = port.add(scope, ['U_1']); assert.equal(first, second); await Promise.resolve(); finish()
  assert.equal((await first).writeState, 'unknown'); assert.equal(calls, 1)
  const invalid = client.createChangeRequestAssignees({ options: async () => ({ ...directoryScope, repositoryId: 'foreign', targetStamp: 'stamp', items: [{ id: 'U_x', login: 'canary' }] }) })
  await assert.rejects(() => invalid.options(directoryScope))
})

async function renderAssigneeComponent(name, props) {
  const { createRequire } = await import('node:module'), React = createRequire(new URL('../../packages/ui/package.json', import.meta.url))('react')
  const Component = (await import('../../packages/ui/src/change-request-assignees-section.ts'))[name]
  const cells = []; let index = 0, effects = []
  return () => { const internal = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, prior = internal.ReactCurrentDispatcher.current
    const cell = init => cells[index++] ?? (cells[index - 1] = init()); index = 0
    internal.ReactCurrentDispatcher.current = { useRef: v => cell(() => ({ current: v })), useState: v => { const s = cell(() => ({ value: v })); return [s.value, n => { s.value = typeof n === 'function' ? n(s.value) : n }] }, useEffect: (run, deps) => { const c = cell(() => ({})); if (!c.deps || deps.some((v, n) => v !== c.deps[n])) effects.push(() => { c.cleanup?.(); c.cleanup = run() }); c.deps = deps } }
    try { return Component(props) } finally { internal.ReactCurrentDispatcher.current = prior; effects.splice(0).forEach(run => run()) }
  }
}

test('candidate identities disappear immediately when scope or connection changes', async () => {
  let resolve
  const props = { scope: { workspaceId: 'ws', workItemId: 'wi', repositoryId: 'repo' }, connected: true, port: { options: () => new Promise(done => { resolve = done }) }, value: [], onChange() {} }
  const render = await renderAssigneeComponent('ChangeRequestAssigneePicker', props)
  render(); resolve({ targetStamp: 'stamp', items: [{ id: 'U_1', login: 'candidate-canary' }] }); await Promise.resolve(); assert.match(JSON.stringify(render()), /candidate-canary/)
  props.connected = false; assert.doesNotMatch(JSON.stringify(render()), /candidate-canary/)
  props.connected = true; render(); const old = resolve; props.scope = { ...props.scope, repositoryId: 'other' }; render()
  old({ targetStamp: 'old', items: [{ id: 'U_2', login: 'late-canary' }] }); await Promise.resolve(); assert.doesNotMatch(JSON.stringify(render()), /canary/)
})


test('candidate client preserves only scoped allowlisted failure without identities', async () => {
  const directoryScope = { workspaceId: 'ws', workItemId: 'wi', repositoryId: 'repo' }
  const port = value => client.createChangeRequestAssignees({ options: async () => value })
  for (const error of ['not_supported', 'permission_denied', 'unavailable']) await assert.rejects(() => port({ ...directoryScope, error }).options(directoryScope), reason => reason === error)
  for (const value of [{ ...directoryScope, error: 'private-canary' }, { ...directoryScope, error: 'permission_denied', items: [{ id: 'U_canary', login: 'private-canary' }] }, { ...directoryScope, repositoryId: 'foreign', error: 'permission_denied' }]) await assert.rejects(() => port(value).options(directoryScope), TypeError)
})


test('access change during initial assignment lookup offers explicit read-only recovery', async () => {
  let finish, reads = 0, writes = 0
  const write = async () => { writes++; return { writeState: 'unknown' } }
  const props = { scope, connected: true, accessToken: 'before', port: { operation: () => { reads++; return new Promise(done => { finish = done }) }, add: write, resume: write } }
  const render = await renderAssigneeComponent('ChangeRequestAssigneesSection', props)
  render(); props.accessToken = 'after'; render(); finish({ kind: 'none' }); await Promise.resolve(); assert.equal(reads, 1)
  const retry = render().props.children.find(child => child?.type === 'button' && child.props.children === '重新读取负责人记录')
  assert.ok(retry && !retry.props.disabled); retry.props.onClick(); assert.equal(reads, 2)
  finish({ kind: 'none' }); await Promise.resolve(); assert.ok(render().props.children.some(child => child?.type?.name === 'ChangeRequestAssigneePicker')); assert.equal(writes, 0)
})

for (const change of ['target', 'connection']) test(`candidate negative history cannot resurface after ${change} roundtrip`, async () => {
  const props = { scope: { workspaceId: 'ws', workItemId: 'wi', repositoryId: 'repo' }, connected: true, port: { options: async () => { throw 'permission_denied' } }, value: [], onChange() {} }
  const render = await renderAssigneeComponent('ChangeRequestAssigneePicker', props)
  render(); await Promise.resolve(); assert.match(JSON.stringify(render()), /读取被拒绝/)
  props.port.options = () => new Promise(() => {})
  if (change === 'connection') { props.connected = false; render(); props.connected = true }
  else { props.scope = { ...props.scope, repositoryId: 'other' }; render(); props.scope = { ...props.scope, repositoryId: 'repo' } }
  assert.doesNotMatch(JSON.stringify(render()), /读取被拒绝/)
})


test('fresh candidate success replaces safe history and unknown feedback', async () => {
  let outcome = 'denied'
  const props = { scope: { workspaceId: 'ws', workItemId: 'wi', repositoryId: 'repo' }, connected: true, port: { options: async () => { if (outcome === 'denied') throw 'permission_denied'; if (outcome === 'unknown') throw Error('private-canary'); return { targetStamp: 'fresh', items: [{ id: 'U_fresh', login: 'fresh-candidate' }] } } }, value: [], onChange() {} }
  const render = await renderAssigneeComponent('ChangeRequestAssigneePicker', props), retry = () => render().props.children.find(child => child?.type === 'button').props.onClick()
  render(); await Promise.resolve(); outcome = 'unknown'; retry(); await Promise.resolve(); assert.match(JSON.stringify(render()), /最后已知失败.*本次读取尚未确认/)
  outcome = 'success'; retry(); await Promise.resolve(); const result = JSON.stringify(render()); assert.match(result, /fresh-candidate/); assert.doesNotMatch(result, /读取被拒绝|最后已知失败|本次读取尚未确认|private-canary/)
})
