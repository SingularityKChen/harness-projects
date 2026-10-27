import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { apply } from '../../apps/harness-plugin/src/client.ts'
import { bindWorkspaceSetupApp } from '../../packages/ui/src/workspace-setup.ts'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url)), React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const tick = () => new Promise((resolve) => setImmediate(resolve))
const empty = { workspace: null, planning: { state: 'unbound' } }
const configured = (state = 'confirmed') => ({ workspace: { id: 'ws-1', name: 'Mounted' }, planning: { state, bindingId: 'binding-1', projectNodeId: 'PVT_1' } })
const local = (value) => ({ writeState: 'local_only', saving: false, authoritative: false, value })
const header = (id, revision) => ({ workspace: { id, name: 'Mounted' }, capabilities: [], source: { revision, freshness: 'fresh', authority: 'provider' } })
async function mount(methods = {}) {
  const calls = [], effects = [], slots = [], waiters = []
  let options, disposed = 0
  const remote = { getWorkspaceSetup: async (...args) => { calls.push(['read', ...args]); return { ok: true, value: empty } },
    createWorkspace: async (...args) => { calls.push(['create', ...args]); return { ok: true, value: local({ workspaceId: 'ws-1' }) } },
    connectAccount: async (...args) => { calls.push(['account', ...args]); return { ok: true, value: local({ accountId: 'account-1' }) } },
    bindPlanningSource: async (...args) => { calls.push(['bind', ...args]); return { ok: true, value: local({ bindingId: 'binding-1' }) } },
    refreshPlanning: async (...args) => { calls.push(['refresh', ...args]); return { ok: true, value: local({ ok: true }) } },
    getExecutionContext: async (...args) => { calls.push(['execution', ...args]); return { ok: true, value: { context: null } } }, watch: () => {}, ...methods }
  await apply({ remote: { $mount: async () => () => {} }, inject: (_names, run) => run({ remote: { harnessProjects: remote,
    $stream: (value) => { options = value; return { restart() {}, dispose: async () => { disposed += 1 }, [Symbol.asyncIterator]: () => ({ next: () => new Promise((resolve) => waiters.push(resolve)) }) } } },
    effect: (execute) => effects.push(execute()), slots: { inject: (_name, run) => run(), register: (config, Panel) => { if (config.name === 'main') slots.push(Panel) } } }) })
  await tick()
  const element = slots[0](), source = element.props.setupSource
  assert.ok(source, '真实插件main必须挂setup source，而不是只挂原列表')
  return { source, calls, remote, props: element.props, html: () => renderToStaticMarkup(React.createElement(element.type, element.props)),
    emit: async (value, generation = 1) => { waiters.shift()({ done: false, value: { generation, value, accept() {} } }); await tick() },
    break: () => options.carrierFailed(new Error('carrier lost')), close: () => { effects.reverse().forEach((stop) => stop()); return tick() }, disposed: () => disposed }
}
test('actual client mount unwraps gateway, submits exact args, fences watch scope and refreshes only recovered connection', async () => {
  const f = await mount()
  try {
    assert.deepEqual(f.calls, [['read']]); assert.match(f.html(), /创建工作区/)
    f.remote.getWorkspaceSetup = async () => ({ ok: true, value: configured('configured') })
    await f.source.create('One'); await f.source.connect('PVT_1')
    const [create, account, bind] = ['create', 'account', 'bind'].map((kind) => f.calls.find(([name]) => name === kind))
    assert.deepEqual(create.slice(1, 2), [{ kind: 'user' }]); assert.equal(create[3], 'One')
    assert.equal(bind[2], account[2].replace(/:account$/, ':bind')); assert.deepEqual(bind.slice(3), ['account-1', 'PVT_1'])
    assert.doesNotMatch(f.html(), /Saved|已连接|<table/)
    f.remote.getWorkspaceSetup = async () => ({ ok: true, value: configured() }); await f.source.refresh()
    await f.emit({ kind: 'baseline', baseline: { ...header('other', 1), revision: 1, entities: [] } })
    assert.match(f.html(), /正在等待工作项/)
    let reads = 0; f.remote.getWorkspaceSetup = async () => { reads += 1; return { ok: true, value: configured() } }
    await f.emit({ kind: 'delta', delta: { ...header('other', 2), previousRevision: 1, revision: 2, upserts: [], removed: [] } })
    assert.equal(reads, 0); f.break()
    await f.emit({ kind: 'baseline', baseline: { ...header('ws-1', 3), revision: 3, entities: [] } }, 2)
    assert.equal(reads, 1); assert.match(f.html(), /连接设置/)
    await f.props.executionReader({ workspaceId: 'ws-1', workItemId: 'item-1', repositoryId: 'repo-1' })
    assert.deepEqual(f.calls.at(-1), ['execution', 'item-1', 'repo-1'])
  } finally { await f.close() }
  assert.equal(f.disposed(), 1)
})
test('actual client rejects outer failure and unknown DTO keys, and unmount absorbs a pending setup response', async () => {
  const f = await mount({ getWorkspaceSetup: async () => ({ ok: false, error: new Error('RAW-CANARY') }) })
  assert.equal(f.source.getSnapshot().error.code, 'unavailable'); assert.doesNotMatch(f.html(), /RAW-CANARY/)
  f.remote.getWorkspaceSetup = async () => ({ ok: true, value: { ...configured(), secret: 'RAW-CANARY' } }); await f.source.refresh()
  assert.equal(f.source.getSnapshot().setup, undefined)
  let resolve, changed = 0; f.source.subscribe(() => { changed += 1 })
  f.remote.getWorkspaceSetup = () => new Promise((yes) => { resolve = yes })
  const read = f.source.refresh(); await tick(); const before = changed; await f.close()
  resolve({ ok: true, value: configured() }); await read
  assert.equal(changed, before); assert.equal(f.source.getSnapshot().setup, undefined)
})

test('named repositoryBindingSource option delegates through the real mount while legacy three-argument binding remains readonly', async () => {
  const f = await mount()
  try {
    const Panel = bindWorkspaceSetupApp(f.source, f.props.source, f.props.executionReader, { repositoryBindingSource: f.props.repositoryBindingSource })
    await Panel().props.repositoryBindingSource.bind({ localPath: '', owner: '', name: '' })
    assert.equal(Panel().props.repositoryBindingSource.getSnapshot().error.code, 'invalid_input')
    assert.ok(!f.calls.some(([kind]) => kind === 'account'), 'invalid selection must stay local')
    assert.equal(bindWorkspaceSetupApp(f.source, f.props.source, f.props.executionReader)().props.repositoryBindingSource, undefined)
  } finally { await f.close() }
})
