import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as client from '@harness-projects/client'
const selection = { localPath: '/fixture/repo', owner: 'Octo', name: 'Repo' }, actorRef = { kind: 'user' }
const gates = ['development.branch.create', 'development.worktree.create', 'development.repository.read', 'development.worktree.read']
const readyRepository = () => ({ id: 'github.com/octo/repo', capabilities: gates.map(key => ({ key, access: 'available' })) })
const result = (value, extra = {}) => ({ writeState: 'local_only', saving: false, authoritative: false, value, ...extra })
const error = (code = 'unavailable', recovery = 'retry') => ({ code, recovery, retryable: recovery === 'retry', message: 'RAW-CANARY' })
function fixture(overrides = {}) {
  let n = 0; const calls = [], port = { connectAccount: async (...args) => { calls.push(['account', ...args]); return result({ accountId: 'account' }) }, bindRepository: async (...args) => { calls.push(['bind', ...args]); return result({ repositoryId: 'github.com/octo/repo', bindingIds: ['a', 'b', 'c'] }) }, baseline: async () => ({ repositories: [readyRepository()] }), ...overrides }
  assert.equal(typeof client.createRepositoryBindingSource, 'function')
  return { source: client.createRepositoryBindingSource(port, { actorRef, key: () => `intent-${++n}` }), calls }
}
test('one selection emits exactly three references with a common literal key and normalized owner/name', async () => {
  const f = fixture(); await f.source.bind(selection)
  const call = f.calls.find(([name]) => name === 'bind')
  assert.equal(call[3], 'github.com/octo/repo')
  assert.deepEqual(call[4], [
    { domain: 'development', implementationKey: 'development.local-git', configuration: { repositoryPath: '/fixture/repo', repositoryExternalId: 'github.com/octo/repo' } },
    { domain: 'development', implementationKey: 'development.github', accountId: 'account', configuration: { repositoryExternalId: 'github.com/octo/repo', repositoryOwner: 'octo', repositoryName: 'repo' } },
    { domain: 'delivery', implementationKey: 'github-actions', accountId: 'account', configuration: { repositoryExternalId: 'github.com/octo/repo', repositoryOwner: 'octo', repositoryName: 'repo' } },
  ])
  assert.equal(f.source.getSnapshot().state, 'active')
})
test('in-flight duplicate shares Promise; unknown reuses original key; definitive failure creates a new attempt', async () => {
  for (const definitive of [false, true]) {
    let finish, count = 0
    const f = fixture({ bindRepository: (...args) => { f.calls.push(['bind', ...args]); if (++count === 1) return new Promise((resolve) => { finish = resolve }); return result({ repositoryId: 'github.com/octo/repo', bindingIds: ['a', 'b', 'c'] }) } })
    const first = f.source.bind(selection); assert.equal(f.source.bind(selection), first)
    await new Promise((resolve) => setImmediate(resolve))
    finish(result(undefined, { writeState: definitive ? 'failed' : 'unknown', error: error(definitive ? 'unavailable' : 'result_unknown', definitive ? 'retry' : 'refresh') })); await first
    await f.source.bind(selection)
    assert.deepEqual(f.calls.filter(([name]) => name === 'bind').map((c) => c[2]), definitive ? ['intent-1:bind', 'intent-1:bind:attempt-2'] : ['intent-1:bind', 'intent-1:bind'])
    assert.doesNotMatch(JSON.stringify(f.source.getSnapshot()), /RAW-CANARY/)
  }
})
test('configured activation failure and absent baseline never claim active; retry retains original binding key', async () => {
  const f = fixture({ bindRepository: async (...args) => { f.calls.push(['bind', ...args]); return result({ repositoryId: 'github.com/octo/repo', bindingIds: ['a', 'b', 'c'] }, { activationError: error() }) } })
  await f.source.bind(selection); assert.equal(f.source.getSnapshot().state, 'configured'); assert.equal(f.source.getSnapshot().error.code, 'unavailable')
  await f.source.bind(selection); assert.deepEqual(f.calls.filter(([name]) => name === 'bind').map((c) => c[2]), ['intent-1:bind', 'intent-1:bind'])
  const absent = fixture({ baseline: async () => ({ repositories: [] }) }); await absent.source.bind(selection); assert.equal(absent.source.getSnapshot().state, 'configured')
})
test('repository presence cannot claim activation when its own Development gates are missing or blocked', async () => {
  for (const capabilities of [[], ...gates.flatMap(key => ['unavailable', 'bogus', ...(key.endsWith('.create') ? ['read_only'] : [])].map(access => readyRepository().capabilities.map(entry => entry.key === key ? { key, access } : entry)))]) {
    const f = fixture({ baseline: async () => ({ repositories: [{ id: 'github.com/octo/repo', capabilities }] }) })
    await f.source.bind(selection)
    assert.equal(f.source.getSnapshot().state, 'configured')
    assert.equal(f.source.getSnapshot().activationBlocked, true)
    const html = renderToStaticMarkup(React.createElement(ui.RepositoryBindingForm, { source: f.source }))
    assert.doesNotMatch(html, /仓库已连接/); assert.match(html, /输出目录/); assert.match(html, /重启宿主/)
  }
  const f = fixture({ baseline: async () => ({ repositories: [{ ...readyRepository(), capabilities: gates.map(key => ({ key, access: key.endsWith('.read') ? 'read_only' : 'degraded' })) }] }) })
  await f.source.bind(selection); assert.equal(f.source.getSnapshot().state, 'active')
  const explicit = fixture({ bindRepository: async () => result({ repositoryId: 'github.com/octo/repo', bindingIds: ['a', 'b', 'c'] }, { activationError: error('permission_denied', 'fix_permission') }) })
  await explicit.source.bind(selection)
  assert.match(renderToStaticMarkup(React.createElement(ui.RepositoryBindingForm, { source: explicit.source })), /补充授权/)
  assert.equal(explicit.source.getSnapshot().activationBlocked, undefined)
})
test('target switch and disposal suppress late account continuation and late target result', async () => {
  let finish
  const f = fixture({ connectAccount: () => new Promise((resolve) => { finish = resolve }) })
  const first = f.source.bind(selection); f.source.reset(); finish(result({ accountId: 'account' })); await first
  assert.equal(f.calls.length, 0); assert.equal(f.source.getSnapshot().state, 'idle')
  const second = f.source.bind(selection); f.source.dispose(); finish(result({ accountId: 'account' })); await second
  assert.equal(f.calls.length, 0)
})
import { createRequire } from 'node:module'
import * as ui from '@harness-projects/ui'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url)), React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const find = (node, type) => Array.isArray(node) ? node.flatMap((child) => find(child, type)) : node && typeof node === 'object' ? [...(node.type === type ? [node] : []), ...find(node.props?.children, type)] : []
function mount(source) {
  const slots = [], cleanups = []; let cursor = 0
  const dispatcher = { useSyncExternalStore: (_subscribe, read) => read(), useRef: (current) => { const index = cursor++; return slots[index] ??= { current } }, useEffect: (effect, deps) => { const index = cursor++, cell = slots[index] ??= {}; if (!cell.deps || deps.some((value, i) => value !== cell.deps[i])) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) }; cell.deps = deps }, useState: (initial) => { const index = cursor++; slots[index] ??= { value: initial }; return [slots[index].value, (value) => { slots[index].value = value }] } }
  const render = () => { const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, before = internals.ReactCurrentDispatcher.current; internals.ReactCurrentDispatcher.current = dispatcher; cursor = 0
    try { return ui.RepositoryBindingForm({ source }) } finally { internals.ReactCurrentDispatcher.current = before } }
  render.unmount = () => { cleanups.splice(0).forEach((cleanup) => cleanup()); slots.length = 0 }
  return render
}
test('repository form submits labeled selection, retains drafts on failure and does not expose raw errors', async () => {
  const f = fixture({ bindRepository: async () => result(undefined, { writeState: 'failed', error: error() }) })
  assert.equal(typeof ui.RepositoryBindingForm, 'function')
  const render = mount(f.source)
  for (const [index, value] of ['/fixture/repo', 'Octo', 'Repo'].entries()) find(render(), 'input')[index].props.onChange({ target: { value } })
  find(render(), 'form')[0].props.onSubmit({ preventDefault() {} }); assert.equal(find(render(), 'button')[0].props.disabled, true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(find(render(), 'input').map((n) => n.props.value), ['/fixture/repo', 'Octo', 'Repo'])
  const html = renderToStaticMarkup(React.createElement(ui.RepositoryBindingForm, { source: f.source }))
  assert.match(html, /本地仓库路径[^]*GitHub owner[^]*GitHub name/); assert.match(html, /role="alert"/); assert.doesNotMatch(html, /RAW-CANARY|Saved|已连接/)
})
test('settings gate exposes the production repository form once a workspace exists', () => {
  const f = fixture(), setupSource = { subscribe: () => () => {}, getSnapshot: () => ({ pending: false, setup: { workspace: { id: 'w', name: 'Fixture' }, planning: { state: 'unbound' } } }) }
  const html = renderToStaticMarkup(React.createElement(ui.WorkspaceSetupGate, { setupSource, repositoryBindingSource: f.source, source: { subscribe: () => () => {}, getSnapshot: () => undefined } }))
  assert.match(html, /本地仓库路径/)
})
import { HOST_REMOTE } from '../../apps/harness-plugin/src/remote.ts'
test('repository references codec preserves lossless JSON for the real strict Gateway boundary', async () => {
  const f = fixture(); await f.source.bind(selection)
  const raw = JSON.parse(JSON.stringify(f.calls.find(([name]) => name === 'bind')[4]))
  const codec = HOST_REMOTE.invocations.find((d) => d.method === 'bindRepository').parameters.find((p) => p.name === 'references').codec
  const parsed = codec.create().parse(raw)
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(parsed)), 'strict Gateway validates the parsed value again as lossless JSON; absent local account must stay absent')
  assert.deepEqual(codec.create().parse(parsed), parsed)
})

test('production form unmount stops late account continuation and reentry can submit a fresh pending generation', async () => {
  const finishes = [], keys = [], f = fixture({ connectAccount: (_actor, key) => { keys.push(key); return new Promise((resolve) => finishes.push(resolve)) } })
  const render = mount(f.source)
  for (const [index, value] of [selection.localPath, selection.owner, selection.name].entries()) find(render(), 'input')[index].props.onChange({ target: { value } })
  find(render(), 'form')[0].props.onSubmit({ preventDefault() {} }); render.unmount()
  finishes[0](result({ accountId: 'account' })); await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.calls.length, 0, '离开设置后不得从账号阶段继续发出绑定')
  assert.equal(f.source.getSnapshot().state, 'idle')
  assert.deepEqual(find(render(), 'input').map((n) => n.props.value), ['/fixture/repo', 'octo', 'repo'], '重新进入恢复已提交的选择，不重填而丢失原intent')
  find(render(), 'form')[0].props.onSubmit({ preventDefault() {} })
  assert.equal(finishes.length, 2, '重进的source仍可用，不能永久dispose或粘住旧pending')
  finishes[1](result({ accountId: 'account' })); await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.calls.filter(([name]) => name === 'bind').length, 1); assert.equal(f.source.getSnapshot().state, 'active')
  assert.deepEqual(keys, ['intent-1:account', 'intent-1:account']); render.unmount()
})
test('unmount after Host bind was sent ignores late result and preserves unknown key on reentry', async () => {
  let finish, reads = 0
  const f = fixture({ bindRepository: (...args) => { f.calls.push(['bind', ...args]); return new Promise((resolve) => { finish = resolve }) }, baseline: async () => { reads++; return { repositories: [readyRepository()] } } })
  const render = mount(f.source)
  for (const [index, value] of [selection.localPath, selection.owner, selection.name].entries()) find(render(), 'input')[index].props.onChange({ target: { value } })
  find(render(), 'form')[0].props.onSubmit({ preventDefault() {} }); await new Promise((resolve) => setImmediate(resolve)); render.unmount()
  assert.equal(f.source.getSnapshot().error?.code, 'result_unknown', '已发Host命令不能伪报撤销或配置成功')
  finish(result({ repositoryId: 'github.com/octo/repo', bindingIds: ['a', 'b', 'c'] })); await new Promise((resolve) => setImmediate(resolve))
  assert.equal(reads, 0, '晚结果不得启动baseline或发布active'); assert.equal(f.source.getSnapshot().state, 'failed')
  find(render(), 'form')[0].props.onSubmit({ preventDefault() {} }); await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(f.calls.filter(([name]) => name === 'bind').map((c) => c[2]), ['intent-1:bind', 'intent-1:bind'])
  finish(result({ repositoryId: 'github.com/octo/repo', bindingIds: ['a', 'b', 'c'] })); await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.source.getSnapshot().state, 'active'); assert.equal(reads, 1); render.unmount()
})

test('repository controls associate help and failures with a focusable recovery summary', async () => {
  const f = fixture({ bindRepository: async () => result(undefined, { writeState: 'failed', error: error() }) }); await f.source.bind(selection)
  const out = renderToStaticMarkup(React.createElement(ui.RepositoryBindingForm, { source: f.source }))
  for (const field of ['localPath', 'owner', 'name']) {
    assert.ok(out.includes(`aria-describedby="repository-${field}-help repository-error"`))
    assert.ok(out.includes(`id="repository-${field}-help"`))
  }
  assert.match(out, /id="repository-error"[^]*tabindex="-1"/)
  assert.match(out, /草稿已保留/)
})
test('unknown repository command visibly asks for confirmation without claiming activation', async () => {
  const f = fixture({ bindRepository: async () => result(undefined, { writeState: 'unknown' }) }); await f.source.bind(selection)
  const out = renderToStaticMarkup(React.createElement(ui.RepositoryBindingForm, { source: f.source }))
  assert.match(out, /结果未知/); assert.doesNotMatch(out, /Saved|仓库已连接/)
})

test('repository failure focuses only the attempt submitted by this form', async () => {
  let finish, focused = 0
  const f = fixture({ bindRepository: () => new Promise(resolve => { finish = resolve }) }), render = mount(f.source)
  const tree = render(); find(tree, 'form')[0].ref.current = { querySelector: () => ({ focus: () => { focused++ } }) }
  for (const [index, value] of [selection.localPath, selection.owner, selection.name].entries()) find(render(), 'input')[index].props.onChange({ target: { value } })
  find(render(), 'form')[0].props.onSubmit({ preventDefault() {} }); render(); await new Promise(resolve => setImmediate(resolve))
  finish(result(undefined, { writeState: 'failed', error: error() })); await new Promise(resolve => setImmediate(resolve)); render(); assert.equal(focused, 1)
  const background = f.source.bind(selection); render(); await new Promise(resolve => setImmediate(resolve)); finish(result(undefined, { writeState: 'failed', error: error() })); await background
  render(); assert.equal(focused, 1); render.unmount()
})

test('repository acknowledgement retains submitted focus ownership through deferred baseline failure', async () => {
  let rejectBaseline, focused = 0
  const f = fixture({ baseline: () => new Promise((_, reject) => { rejectBaseline = reject }) }), render = mount(f.source)
  find(render(), 'form')[0].ref.current = { querySelector: () => ({ focus: () => { focused++ } }) }
  for (const [index, value] of [selection.localPath, selection.owner, selection.name].entries()) find(render(), 'input')[index].props.onChange({ target: { value } })
  find(render(), 'form')[0].props.onSubmit({ preventDefault() {} }); render(); await new Promise(resolve => setImmediate(resolve)); render()
  assert.equal(f.source.getSnapshot().state, 'configured'); assert.equal(focused, 0)
  rejectBaseline(new Error('RAW-CANARY')); await new Promise(resolve => setImmediate(resolve)); render()
  assert.equal(f.source.getSnapshot().state, 'configured'); assert.ok(f.source.getSnapshot().error); assert.equal(focused, 1)
  assert.deepEqual(find(render(), 'input').map(input => input.props.value), [selection.localPath, selection.owner, selection.name]); render.unmount()
})

test('repository task distinguishes an idle binding from a confirmed connection', async () => {
  const f = fixture()
  const html = () => renderToStaticMarkup(React.createElement(ui.RepositoryBindingForm, { source: f.source }))
  assert.match(html(), /尚未绑定仓库/); assert.doesNotMatch(html(), /仓库已连接/)
  await f.source.bind(selection)
  assert.match(html(), /仓库已连接/); assert.doesNotMatch(html(), /尚未绑定仓库/)
})
