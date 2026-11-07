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

test('candidate identities disappear immediately when scope or connection changes', async () => {
  const { createRequire } = await import('node:module'), React = createRequire(new URL('../../packages/ui/package.json', import.meta.url))('react')
  const { ChangeRequestAssigneePicker } = await import('../../packages/ui/src/change-request-assignees-section.ts')
  const cells = []; let index = 0, effects = [], resolve
  const props = { scope: { workspaceId: 'ws', workItemId: 'wi', repositoryId: 'repo' }, connected: true, port: { options: () => new Promise(done => { resolve = done }) }, value: [], onChange() {} }
  const render = () => { const internal = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, prior = internal.ReactCurrentDispatcher.current
    const cell = init => cells[index++] ?? (cells[index - 1] = init()); index = 0
    internal.ReactCurrentDispatcher.current = { useRef: v => cell(() => ({ current: v })), useState: v => { const s = cell(() => ({ value: v })); return [s.value, n => { s.value = typeof n === 'function' ? n(s.value) : n }] }, useEffect: (run, deps) => { const c = cell(() => ({})); if (!c.deps || deps.some((v, n) => v !== c.deps[n])) effects.push(() => { c.cleanup?.(); c.cleanup = run() }); c.deps = deps } }
    try { return ChangeRequestAssigneePicker(props) } finally { internal.ReactCurrentDispatcher.current = prior; effects.splice(0).forEach(run => run()) }
  }
  render(); resolve({ targetStamp: 'stamp', items: [{ id: 'U_1', login: 'candidate-canary' }] }); await Promise.resolve(); assert.match(JSON.stringify(render()), /candidate-canary/)
  props.connected = false; assert.doesNotMatch(JSON.stringify(render()), /candidate-canary/)
  props.connected = true; render(); const old = resolve; props.scope = { ...props.scope, repositoryId: 'other' }; render()
  old({ targetStamp: 'old', items: [{ id: 'U_2', login: 'late-canary' }] }); await Promise.resolve(); assert.doesNotMatch(JSON.stringify(render()), /canary/)
})
