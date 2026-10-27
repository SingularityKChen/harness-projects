import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { composeCore } from '@harness-projects/core'
import { createController } from '@harness-projects/controller'
import { createSync, createTransport, createEntityStore } from '@harness-projects/client'
import { createPlanningRefreshSource, createWorkspaceSetupSource } from '@harness-projects/client'
import { WorkItemApp } from '@harness-projects/ui'
import { createFakeProviders, FaultKind } from '@harness-projects/provider-fake'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const T = (n) => `2026-10-27T01:00:0${n}.000Z`
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }

test('real controller confirmation reaches list and open drawer; double click shares Provider read; failure keeps last values', async () => {
  const providers = createFakeProviders()
  let at = T(1), count = 0, read, fault = false
  const core = await composeCore({ workspace: { name: 'refresh' }, providers, clock: () => at })
  const controller = createController(core), sync = createSync(createTransport(controller), createEntityStore())
  await sync.connect()
  const listeners = new Set(), publish = () => { read = sync.read(); listeners.forEach((listener) => listener()) }
  const source = { getSnapshot: () => read, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) } }
  publish()
  const target = read.store.list().find((row) => row.entity.content.contentKind === 'work_item').entityId
  const refreshSource = createPlanningRefreshSource({ source, refreshPlanning: () => {
    if (fault) return Promise.reject(new Error('SECRET provider transport'))
    return controller.commands.refreshPlanning({ actorRef: { kind: 'user' } })
  } })
  const html = () => renderToStaticMarkup(React.createElement(WorkItemApp, { source, refreshSource, initialPath: `/projects/${read.workspace.id}/items/${target}` }))
  const original = providers.planning.listPlanningItems.bind(providers.planning), gate = deferred()
  providers.planning.listPlanningItems = async (...args) => { count++; await gate.promise; return original(...args) }
  at = T(2)
  const first = refreshSource.refresh(), second = refreshSource.refresh()
  assert.equal(first, second)
  assert.equal(refreshSource.getSnapshot().pending, true)
  assert.match(html(), /正在刷新/)
  assert.ok(html().includes(T(1)), 'old Host confirmation remains visible while pending')
  gate.resolve(); await first
  assert.equal(count, 1)
  assert.equal(refreshSource.getSnapshot().error, undefined, 'real local_only read result is successful')
  assert.equal((await sync.poll()).kind, 'metadata'); publish()
  const updated = html()
  assert.match(updated.slice(updated.indexOf('<dialog')), /刷新规划/, 'open modal retains an accessible refresh action')
  assert.equal(updated.split(`dateTime="${T(2)}"`).length - 1, 2, 'list and already open drawer share source confirmation')
  const saved = read.reconciledAt, revision = sync.revision, titles = read.store.list().map((row) => row.entity.content.title)
  fault = true; await refreshSource.refresh()
  assert.match(html(), /暂时无法刷新规划/)
  assert.match(html(), /最后已知值/)
  assert.doesNotMatch(html(), /SECRET/)
  assert.equal(read.reconciledAt, saved)
  assert.deepEqual(read.store.list().map((row) => row.entity.content.title), titles)
  fault = false; at = T(3); await refreshSource.refresh(); await sync.poll(); publish()
  assert.equal(count, 2)
  assert.equal(sync.revision, revision)
  assert.equal(refreshSource.getSnapshot().error, undefined)
  assert.ok(html().includes(T(3)))
  refreshSource.dispose()
})

test('scope change and dispose ignore late refresh completion and failure; read gate never invokes RPC', async () => {
  let read = { workspace: { id: 'a' }, connection: { connected: true }, capabilities: [{ key: 'planning.item.read', access: 'available' }] }, notify
  const source = { getSnapshot: () => read, subscribe: (listener) => { notify = listener; return () => {} } }
  const gate = deferred(); let calls = 0
  const refresh = createPlanningRefreshSource({ source, refreshPlanning: () => { calls++; return gate.promise } })
  const pending = refresh.refresh(); await Promise.resolve()
  read = { ...read, workspace: { id: 'b' } }; notify()
  gate.resolve({ writeState: 'failed', value: { ok: false } }); await pending
  assert.deepEqual(refresh.getSnapshot(), { pending: false })
  read = { ...read, capabilities: [] }; notify(); await refresh.refresh()
  assert.equal(calls, 1)
  refresh.dispose(); await refresh.refresh()
  assert.equal(calls, 1)
})

test('disposed pending source absorbs late rejection without publishing a new snapshot', async () => {
  const source = { getSnapshot: () => ({ workspace: { id: 'a' }, connection: { connected: true }, capabilities: [{ key: 'planning.item.read', access: 'available' }] }), subscribe: () => () => {} }
  const gate = deferred(), refresh = createPlanningRefreshSource({ source, refreshPlanning: () => gate.promise })
  let publications = 0
  refresh.subscribe(() => { publications++ })
  const pending = refresh.refresh(), before = refresh.getSnapshot()
  await Promise.resolve(); refresh.dispose(); gate.reject(new Error('private detail')); await pending
  assert.equal(refresh.getSnapshot(), before)
  assert.equal(publications, 1)
})

const successfulRefresh = { writeState: 'local_only', saving: false, authoritative: false, value: { ok: true, entities: 0, workItems: 0, changeRequests: 0, unanchored: 0, revision: 0, degraded: false, error: undefined }, error: undefined }
for (const cancel of ['dispose', 'scope']) {
  test(`${cancel} before microtask dispatch prevents obsolete intent from sending RPC`, async () => {
    let read = { workspace: { id: 'a' }, connection: { connected: true }, capabilities: [{ key: 'planning.item.read', access: 'available' }] }, notify
    const source = { getSnapshot: () => read, subscribe: (listener) => { notify = listener; return () => {} } }, scopes = []
    const refresh = createPlanningRefreshSource({ source, refreshPlanning: async () => { scopes.push(read.workspace.id); return successfulRefresh } })
    const first = refresh.refresh(), before = refresh.getSnapshot()
    let second
    if (cancel === 'dispose') refresh.dispose()
    else { read = { ...read, workspace: { id: 'b' } }; notify(); second = refresh.refresh() }
    await Promise.all([first, second])
    assert.deepEqual(scopes, cancel === 'dispose' ? [] : ['b'])
    if (cancel === 'dispose') assert.equal(refresh.getSnapshot(), before, 'cancelled task cannot publish')
    else assert.deepEqual(refresh.getSnapshot(), { pending: false })
    refresh.dispose()
  })
}

for (const blockedBy of ['none', 'read', 'mutation']) {
  test(`real setup and refresh sources share one reconcile Promise behind ${blockedBy}`, async () => {
    const barrier = deferred(), rpc = deferred()
    let calls = 0, reads = 0
    const source = { getSnapshot: () => ({ workspace: { id: 'w' }, connection: { connected: true }, capabilities: [{ key: 'planning.item.read', access: 'available' }] }), subscribe: () => () => {} }
    const refresh = createPlanningRefreshSource({ source, refreshPlanning: async () => { calls++; await rpc.promise; return successfulRefresh } })
    const setup = createWorkspaceSetupSource({
      refreshPlanning: () => refresh.refresh(),
      getWorkspaceSetup: async () => { if (blockedBy === 'read' && reads++ === 0) await barrier.promise; return { workspace: { id: 'w', name: 'w' }, planning: { state: 'confirmed', bindingId: 'binding', projectNodeId: 'project' } } },
      connectAccount: async () => { await barrier.promise; return { ...successfulRefresh, value: { accountId: 'account' } } },
      bindPlanningSource: async () => ({ ...successfulRefresh, value: { bindingId: 'binding' } }),
    }, { actorRef: { kind: 'user' } })
    const blocker = blockedBy === 'read' ? setup.refresh() : blockedBy === 'mutation' ? setup.connect('project') : undefined
    let nested
    setup.subscribe(() => { if (setup.getSnapshot().pending && nested === undefined) { nested = null; nested = setup.refresh(true) } })
    const first = setup.refresh(true), second = setup.refresh(true), identical = first === second
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls, blockedBy === 'none' ? 1 : 0, 'reconcile waits for the active read or mutation')
    barrier.resolve(); rpc.resolve()
    await Promise.all([blocker, first, second])
    assert.deepEqual([identical, calls], [true, 1], 'same user intent must not queue a second Provider read')
    assert.equal(nested, first, 'synchronous pending notification joins the reserved task')
    await setup.refresh(true)
    assert.equal(calls, 2, 'a later independent click starts the next read')
    setup.dispose(); refresh.dispose()
  })
}

for (const mutationAt of ['queued', 'in-read']) {
  test(`queued reconcile waits for a newer mutation added while ${mutationAt}`, async () => {
    const account = deferred(), readEntered = deferred(), readRelease = deferred()
    let bound = false, calls = 0, reads = 0
    const source = { getSnapshot: () => ({ workspace: { id: 'w' }, connection: { connected: true }, capabilities: [{ key: 'planning.item.read', access: 'available' }] }), subscribe: () => () => {} }
    const refresh = createPlanningRefreshSource({ source, refreshPlanning: async () => { calls++; return successfulRefresh } })
    const dto = () => ({ workspace: { id: 'w', name: 'w' }, planning: bound ? { state: 'confirmed', bindingId: 'binding', projectNodeId: 'project' } : { state: 'unbound' } })
    const setup = createWorkspaceSetupSource({
      refreshPlanning: () => refresh.refresh(),
      getWorkspaceSetup: async () => {
        if (mutationAt === 'in-read' && reads++ === 0) { const old = dto(); readEntered.resolve(); await readRelease.promise; return old }
        return dto()
      },
      connectAccount: async () => { await account.promise; return { ...successfulRefresh, value: { accountId: 'account' } } },
      bindPlanningSource: async () => { bound = true; return { ...successfulRefresh, value: { bindingId: 'binding' } } },
    }, { actorRef: { kind: 'user' } })
    const initial = setup.refresh()
    if (mutationAt === 'in-read') await readEntered.promise
    const reconcile = setup.refresh(true)
    assert.equal(setup.refresh(true), reconcile)
    const mutation = setup.connect('project')
    readRelease.resolve(); await initial
    // Drain only the turn released by the old read; the mutation latch remains held.
    await new Promise((resolve) => setImmediate(resolve))
    const whileMutation = [calls, setup.getSnapshot().pending]
    account.resolve(); await Promise.all([reconcile, mutation])
    assert.deepEqual({ whileMutation, bound, calls, state: setup.getSnapshot().setup?.planning.state },
      { whileMutation: [0, true], bound: true, calls: 1, state: 'confirmed' })
    setup.dispose(); refresh.dispose()
  })
}

test('an already started reconcile read cannot publish over a newer mutation', async () => {
  const readEntered = deferred(), readRelease = deferred(), account = deferred()
  let reads = 0, bound = false
  const dto = () => ({ workspace: { id: 'w', name: 'w' }, planning: bound ? { state: 'confirmed', bindingId: 'binding', projectNodeId: 'project' } : { state: 'unbound' } })
  const setup = createWorkspaceSetupSource({
    refreshPlanning: async () => successfulRefresh,
    getWorkspaceSetup: async () => {
      const value = dto()
      if (reads++ === 0) { readEntered.resolve(); await readRelease.promise }
      return value
    },
    connectAccount: async () => { await account.promise; return { ...successfulRefresh, value: { accountId: 'account' } } },
    bindPlanningSource: async () => { bound = true; return { ...successfulRefresh, value: { bindingId: 'binding' } } },
  }, { actorRef: { kind: 'user' } })
  const reconcile = setup.refresh(true)
  await readEntered.promise
  const mutation = setup.connect('project')
  readRelease.resolve(); await reconcile
  assert.equal(setup.getSnapshot().pending, true, 'older read cannot finish the newer mutation interaction')
  account.resolve(); await mutation
  assert.equal(setup.getSnapshot().setup.planning.state, 'confirmed')
  setup.dispose()
})


async function refreshView(port) {
  const providers = createFakeProviders(); let at = T(1), read
  const core = await composeCore({ workspace: { name: 'review recovery' }, providers, clock: () => at })
  const controller = createController(core), sync = createSync(createTransport(controller), createEntityStore())
  await sync.connect()
  const listeners = new Set(), publish = (next = sync.read()) => { read = next; listeners.forEach((listener) => listener()) }
  const source = { getSnapshot: () => read, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) } }
  publish()
  const target = read.store.list().find((row) => row.entity.content.contentKind === 'work_item').entityId
  const refresh = createPlanningRefreshSource({ source, refreshPlanning: () => port(controller) })
  const html = () => renderToStaticMarkup(React.createElement(WorkItemApp, { source, refreshSource: refresh, initialPath: `/projects/${read.workspace.id}/items/${target}` }))
  return { providers, core, sync, refresh, html, publish, read: () => read, time: (value) => { at = value } }
}

for (const recovery of ['metadata', 'reconnect']) {
  test(`same-scope Host ${recovery} confirmation clears an old refresh failure in list and open drawer only after newer fresh evidence`, async () => {
  const h = await refreshView(async () => { throw new Error('lost response') })
  await h.refresh.refresh()
  const error = h.refresh.getSnapshot().error, old = h.read()
  assert.ok(error)
  for (const next of [old, { ...old, workspace: { ...old.workspace, name: 'renamed' } },
    { ...old, reconciledAt: T(0) }, { ...old, reconciledAt: T(2), reason: 'unavailable' },
    { ...old, reconciledAt: T(2), connection: { connected: false } },
    { ...old, reconciledAt: T(2), capabilities: [] }]) {
    h.publish(next)
    assert.equal(h.refresh.getSnapshot().error, error, 'old, renamed, degraded, disconnected or unreadable frames cannot confirm recovery')
  }
  h.publish(old); h.time(T(2)); await h.core.commands.refreshPlanning()
  if (recovery === 'metadata') { assert.equal((await h.sync.poll()).kind, 'metadata'); h.publish() }
  else { h.sync.disconnect(); h.publish(); assert.equal(h.refresh.getSnapshot().error, error); await h.sync.reconnect(); h.publish() }
  assert.equal(h.refresh.getSnapshot().error, undefined, 'new same-scope Host confirmation supersedes the old interaction failure')
  const html = h.html(), drawer = html.slice(html.indexOf('<dialog'))
  assert.doesNotMatch(html, /暂时无法刷新规划|当前结果尚未确认，最后已知值不是当前值/)
  assert.doesNotMatch(drawer, /最后已知值，当前结果尚未确认/)
  assert.equal(html.split(`dateTime="${T(2)}"`).length - 1, 2)
  h.refresh.dispose()
  })
}

test('pending confirmation cannot erase a later failed command or turn the same old fresh read into recovery', async () => {
  const gate = deferred(), h = await refreshView(() => gate.promise)
  const pending = h.refresh.refresh()
  await Promise.resolve(); h.time(T(2)); await h.core.commands.refreshPlanning(); await h.sync.poll(); h.publish()
  assert.deepEqual(h.refresh.getSnapshot(), { pending: true })
  gate.reject(new Error('command failed after metadata')); await pending
  const failed = h.refresh.getSnapshot()
  h.publish()
  assert.equal(h.refresh.getSnapshot(), failed, 'confirmation already observed before failure must not clear it')
  h.time(T(3)); await h.core.commands.refreshPlanning(); await h.sync.poll(); h.publish()
  assert.equal(h.refresh.getSnapshot().error, undefined)
  h.refresh.dispose()
})

test('committed partial refresh keeps visible rows fresh and table degraded in list and open drawer', async () => {
  const h = await refreshView((controller) => controller.commands.refreshPlanning({ actorRef: { kind: 'user' } }))
  const item = h.providers.planning.state.items[0]
  h.providers.planning.state.items.push({ ...item, ref: { ...item.ref, objectKind: 'project_item', externalId: 'unanchored' },
    membership: { ...item.membership, externalId: 'unanchored' }, content: { kind: 'redacted', reason: 'unavailable' } })
  h.time(T(2)); const result = await h.refresh.refresh()
  assert.equal(result?.value.ok, true); assert.equal(result?.value.degraded, true)
  assert.equal(result?.error.code, 'permission_denied')
  assert.equal(h.refresh.getSnapshot().error, undefined, 'committed partial success is not a failed round')
  assert.equal(h.read().reconciledAt, T(1), 'RPC never manufactures a local confirmation')
  assert.equal((await h.sync.poll()).kind, 'metadata'); h.publish()
  assert.equal(h.read().reason, 'permission_denied')
  assert.ok(h.read().store.list().every((row) => row.stale === false))
  const html = h.html(), drawer = html.slice(html.indexOf('<dialog'))
  assert.match(html, /部分条目尚未确认，已显示的条目是当前值/)
  assert.doesNotMatch(html, /暂时无法刷新规划/)
  assert.doesNotMatch(drawer, /最后已知值，当前结果尚未确认/)
  assert.equal(html.split(`dateTime="${T(2)}"`).length - 1, 2)
  h.refresh.dispose()
})

for (const failure of ['structured', 'transport']) {
  test(`${failure} refresh failure stays stale when the source republishes its same old fresh snapshot`, async () => {
    const h = await refreshView((controller) => failure === 'transport' ? Promise.reject(new Error('private transport')) : controller.commands.refreshPlanning({ actorRef: { kind: 'user' } }))
    h.providers.planning.faultsSwitch.set(FaultKind.Offline, true)
    await h.refresh.refresh(); h.publish(h.read())
    assert.ok(h.refresh.getSnapshot().error)
    const html = h.html(), drawer = html.slice(html.indexOf('<dialog'))
    assert.match(html, /当前结果尚未确认，最后已知值不是当前值/)
    assert.match(drawer, /最后已知值，当前结果尚未确认/)
    assert.equal(h.read().reconciledAt, T(1))
    h.refresh.dispose()
  })
}

test('malformed or contradictory ok=true refresh responses never masquerade as committed success', async () => {
  const denied = { code: 'permission_denied', recovery: 'fix_permission', retryable: false, message: 'hidden', confirmedValue: undefined, attemptedValue: undefined }
  const partial = { ...successfulRefresh, error: denied, value: { ...successfulRefresh.value, degraded: true, unanchored: 1, error: denied } }
  const invalid = [
    { ...successfulRefresh, saving: true }, { ...successfulRefresh, authoritative: true },
    { ...successfulRefresh, writeState: 'confirmed' }, { ...successfulRefresh, extra: true },
    { ...successfulRefresh, value: { ok: true } },
    { ...successfulRefresh, value: { ...successfulRefresh.value, entities: -1 } },
    { ...successfulRefresh, error: denied },
    { ...partial, value: { ...partial.value, unanchored: 0 } },
    { ...partial, value: { ...partial.value, error: undefined } },
    { ...partial, error: { ...denied, code: 'unavailable' } },
    { ...partial, error: { ...denied, recovery: 'retry' } },
  ]
  for (const value of invalid) {
    const source = { getSnapshot: () => ({ workspace: { id: 'w' }, connection: { connected: true }, capabilities: [{ key: 'planning.item.read', access: 'available' }] }), subscribe: () => () => {} }
    const refresh = createPlanningRefreshSource({ source, refreshPlanning: async () => value })
    await refresh.refresh()
    assert.ok(refresh.getSnapshot().error, JSON.stringify(value))
    refresh.dispose()
  }
})
