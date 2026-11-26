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
const header = (id, revision) => ({ generation: 'host-setup', workspace: { id, name: 'Mounted' }, capabilities: [], source: { revision, freshness: 'fresh', authority: 'provider' } })
async function mount(methods = {}) {
  const calls = [], effects = [], slots = [], waiters = []
  let options, disposed = 0
  const remote = { getWorkspaceSetup: async (...args) => { calls.push(['read', ...args]); return { ok: true, value: empty } },
    createWorkspace: async (...args) => { calls.push(['create', ...args]); return { ok: true, value: local({ workspaceId: 'ws-1' }) } },
    connectAccount: async (...args) => { calls.push(['account', ...args]); return { ok: true, value: local({ accountId: 'account-1' }) } },
    bindPlanningSource: async (...args) => { calls.push(['bind', ...args]); return { ok: true, value: local({ bindingId: 'binding-1' }) } },
    refreshPlanning: async (...args) => { calls.push(['refresh', ...args]); return { ok: true, value: local({ ok: true }) } },
    listWorkspaces: async () => ({ ok: true, value: { activeWorkspaceId: null, workspaces: [] } }),
    openWorkspace: async (workspaceId) => ({ ok: true, value: { state: 'activated', requestedWorkspaceId: workspaceId, activeWorkspaceId: workspaceId } }),
    getExecutionContext: async (...args) => { calls.push(['execution', ...args]); return { ok: true, value: { context: null } } }, watch: () => {}, ...methods }
  await apply({ effect: (execute) => effects.push(execute()), remote: { $mount: async () => () => {} }, inject: (_names, run) => run({ remote: { harnessProjects: remote,
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
    assert.match(f.html(), /正在打开「Mounted」…/)
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
test('first Home snapshot then a project baseline refreshes setup for that workspace', async () => {
  const f = await mount()
  try {
    let reads = 0
    await f.emit({ kind: 'baseline', baseline: { generation: 'home', capabilities: [], source: { revision: 0, freshness: 'fresh', authority: 'provider' }, revision: 0, entities: [] } })
    f.remote.getWorkspaceSetup = async () => { reads += 1; return { ok: true, value: configured() } }
    await f.emit({ kind: 'baseline', baseline: { ...header('ws-1', 1), revision: 1, entities: [] } }, 2)
    assert.equal(reads, 1, 'Home(undefined)→项目(defined) 必须重读 setup'); assert.equal(f.source.getSnapshot().setup.workspace.id, 'ws-1')
  } finally { await f.close() }
})

for (const targets of [['ws-2'], ['ws-1'], ['ws-2', 'ws-1']]) test(`new activation ${targets.join(' → ')} cancels a held account continuation until explicit reconnect`, async () => {
  let current = 'ws-1', release, held = true
  const accounts = new Set(), bindings = [], accountKeys = []
  const acknowledgement = new Promise((resolve) => { release = resolve })
  const setup = () => ({ workspace: { id: current, name: current }, planning: { state: 'unbound' } })
  const f = await mount({ getWorkspaceSetup: async () => ({ ok: true, value: setup() }),
    connectAccount: async (_actor, key) => { accounts.add('account-1'); accountKeys.push(key); if (held) await acknowledgement; return { ok: true, value: local({ accountId: 'account-1' }) } },
    bindPlanningSource: async () => { bindings.push(current); return { ok: true, value: local({ bindingId: 'binding-1' }) } } })
  try {
    await f.emit({ kind: 'baseline', baseline: { ...header(current, 1), generation: 'activation-1', revision: 1, entities: [] } })
    const connecting = f.source.connect('PVT_A'), reconciling = f.source.refresh(true); await tick()
    for (const [index, target] of targets.entries()) {
      current = target
      await f.emit({ kind: 'baseline', baseline: { ...header(current, index + 2), generation: `activation-${index + 2}`, revision: index + 2, entities: [], capabilities: [{ key: 'planning.item.read', access: 'available' }] } }, index + 2)
    }
    held = false; release(); await Promise.all([connecting, reconciling]); await tick()
    assert.deepEqual(bindings, [], 'an old account acknowledgement cannot authorize a planning write in a new activation')
    assert.ok(!f.calls.some(([kind]) => kind === 'refresh'), 'a queued old reconcile cannot continue on the new activation')
    assert.ok(accounts.has('account-1'), 'the committed Host account remains available')
    assert.equal(f.source.getSnapshot().setup.workspace.id, current); assert.equal(f.source.getSnapshot().pending, false)
    await f.source.connect('PVT_A')
    assert.deepEqual(bindings, [current], 'only explicit resubmission may bind the current workspace')
    assert.notEqual(accountKeys[1], accountKeys[0], 'a new activation cannot replay the old connect intent')
  } finally { release(); await f.close() }
})
for (const home of [false, true]) test(`initial creation after ${home ? 'Home' : 'no frame'} survives its own first activation before the acknowledgement arrives`, async () => {
  let release
  const acknowledgement = new Promise((resolve) => { release = resolve })
  const f = await mount({ createWorkspace: async () => { await acknowledgement; return { ok: true, value: local({ workspaceId: 'ws-1' }) } } })
  try {
    if (home) await f.emit({ kind: 'baseline', baseline: { generation: 'home', capabilities: [], source: { revision: 0, freshness: 'fresh', authority: 'provider' }, revision: 0, entities: [] } })
    const creating = f.source.create('One'); f.remote.getWorkspaceSetup = async () => ({ ok: true, value: { workspace: { id: 'ws-1', name: 'One' }, planning: { state: 'unbound' } } })
    await f.emit({ kind: 'baseline', baseline: { ...header('ws-1', 1), revision: 1, entities: [] } }, home ? 2 : 1)
    release(); await creating; await tick()
    assert.equal(f.source.getSnapshot().setup.workspace.id, 'ws-1'); assert.equal(f.source.getSnapshot().pending, false)
  } finally { release(); await f.close() }
})
test('a newer activation refresh replaces a held setup read and absorbs its late old workspace', async () => {
  const f = await mount({ getWorkspaceSetup: async () => ({ ok: true, value: configured() }) })
  let release
  try {
    await f.emit({ kind: 'baseline', baseline: { ...header('ws-1', 1), generation: 'activation-1', revision: 1, entities: [] } })
    f.remote.getWorkspaceSetup = () => new Promise((resolve) => { release = resolve })
    const reading = f.source.refresh(); await tick()
    f.remote.getWorkspaceSetup = async () => ({ ok: true, value: { ...configured(), workspace: { id: 'ws-2', name: 'Two' } } })
    await f.emit({ kind: 'baseline', baseline: { ...header('ws-2', 2), generation: 'activation-2', revision: 2, entities: [] } }, 2)
    release({ ok: true, value: configured() }); await reading
    assert.equal(f.source.getSnapshot().setup.workspace.id, 'ws-2'); assert.equal(f.source.getSnapshot().pending, false)
  } finally { await f.close() }
})
for (const kind of ['open', 'create']) test(`${kind} completes only after the accepted read replacing its fenced readback`, async () => {
  const reads = [], target = { ...configured(), workspace: { id: 'ws-2', name: 'Two' } }
  const f = await mount({ getWorkspaceSetup: async () => ({ ok: true, value: configured() }), createWorkspace: async () => ({ ok: true, value: local({ workspaceId: 'ws-2' }) }) })
  let done = false
  try {
    await f.emit({ kind: 'baseline', baseline: { ...header('ws-1', 1), generation: 'activation-1', revision: 1, entities: [] } })
    f.remote.getWorkspaceSetup = () => new Promise((resolve) => { reads.push(resolve) })
    const changing = kind === 'open' ? f.source.open('ws-2') : f.source.create('Two'); void changing.then(() => { done = true }); await tick()
    await f.emit({ kind: 'baseline', baseline: { ...header('ws-2', 2), generation: 'activation-2', revision: 2, entities: [] } }, 2)
    reads.shift()({ ok: true, value: target }); await tick()
    assert.equal(done, false, 'the raw mutation cannot resolve its caller before the queued confirmation read')
    assert.equal(f.source.getSnapshot().setup.workspace.id, 'ws-1', 'the old readback remains fenced')
    assert.equal(kind === 'open' ? f.source.open('ws-2') : f.source.create('Two'), changing, 'duplicates join the whole confirmation interaction')
    reads.shift()({ ok: true, value: target }); await changing
    assert.equal(f.source.getSnapshot().setup.workspace.id, 'ws-2'); assert.equal(f.source.getSnapshot().pending, false)
  } finally { await f.close() }
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

test('named startWork option delegates through the real mount while legacy three-argument binding remains readonly', async () => {
  const f = await mount({ getStartWorkOptions: async (id) => { return { ok: true, value: { workspaceId: 'ws-1', workItemId: id, executionMode: 'manual' } } } })
  try {
    const Panel = bindWorkspaceSetupApp(f.source, f.props.source, f.props.executionReader, { startWork: f.props.startWork })
    assert.equal((await Panel().props.startWork.options({ workspaceId: 'ws-1', workItemId: 'item-1' })).executionMode, 'manual')
    assert.equal(bindWorkspaceSetupApp(f.source, f.props.source, f.props.executionReader)().props.startWork, undefined)
  } finally { await f.close() }
})

test('named deliveryReader option delegates through the real mount while legacy three-argument binding remains readonly', async () => {
  let calls = []
  const f = await mount({ refreshDeliveryFacts: async (...args) => { calls.push(args); return { ok: true, value: {} } } })
  try {
    const Panel = bindWorkspaceSetupApp(f.source, f.props.source, f.props.executionReader, { deliveryReader: f.props.deliveryReader })
    await Panel().props.deliveryReader.refresh({ workspaceId: 'ws-1', workItemId: 'item-1', repositoryId: 'repo-1' })
    assert.deepEqual(calls, [[{ kind: 'user' }, 'item-1', 'repo-1']])
    assert.equal(bindWorkspaceSetupApp(f.source, f.props.source, f.props.executionReader)().props.deliveryReader, undefined)
  } finally { await f.close() }
})
