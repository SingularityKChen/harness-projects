import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as client from '@harness-projects/client'
import { createExecutionFixture } from '../fixtures/execution-drawer-browser.mjs'
const json = (value) => JSON.parse(JSON.stringify(value))
test('Host delivery query is scoped and pure; explicit refresh repeats and access is revalidated', async (t) => {
  const h = await createExecutionFixture(); t.after(h.close)
  assert.equal(typeof h.installed.service.getDeliveryProjection, 'function')
  const scope = { workspaceId: h.workspaceId, workItemId: h.itemId, repositoryId: 'repo-alpha' }
  const reader = client.createDeliveryLineageReader({ read: ({ workItemId, repositoryId }) => h.installed.service.getDeliveryProjection(workItemId, repositoryId).then(json), refresh: ({ workItemId, repositoryId }) => h.installed.service.refreshDeliveryFacts({ kind: 'user' }, workItemId, repositoryId) })
  const before = await h.storage.currentRevision(h.workspaceId), relations = await h.storage.listRelations(h.workspaceId)
  const first = await reader.read(scope)
  assert.equal(first.workItemId, h.itemId); assert.equal(first.projection.hops.length, 2)
  assert.equal(await h.storage.currentRevision(h.workspaceId), before)
  assert.deepEqual(await h.storage.listRelations(h.workspaceId), relations)
  let calls = 0; const refresh = h.host.controller.commands.refreshDeliveryFacts
  h.host.controller.commands.refreshDeliveryFacts = async (...args) => { calls++; return refresh(...args) }
  await reader.refresh(scope); await reader.refresh(scope); assert.equal(calls, 2)
  await assert.rejects(() => h.host.call('refreshDeliveryFacts', { actorRef: { kind: 'user' }, workItemId: h.itemId, repositoryId: 'repo-alpha', idempotencyKey: 'replay' }), TypeError)
  await assert.rejects(() => reader.read({ ...scope, repositoryId: 'unknown' }))
  const entity = h.host.controller.queries.getEntity; let reads = 0
  h.host.controller.queries.getEntity = async (id) => { const item = await entity(id); return ++reads === 1 ? item : { ...item, content: { contentKind: 'redacted' } } }
  await assert.rejects(() => reader.read(scope))
  calls = 0; await assert.rejects(() => reader.refresh(scope)); assert.equal(calls, 0)
})
test('client delivery envelope rejects scope, projection and Host-time wire defects', async () => {
  assert.equal(typeof client.createDeliveryLineageReader, 'function')
  const scope = { workspaceId: 'ws', workItemId: 'wi', repositoryId: 'repo' }
  const good = { ...scope, now: '2026-10-26T00:00:00.000Z', projection: { workItemId: 'wi', repositoryId: 'repo', hops: [], optional: [], freshness: [], gaps: [], degraded: false } }
  for (const bad of [{ ...good, now: '2026' }, { ...good, workspaceId: 'other' }, { ...good, extra: 1 }, { ...good, projection: { ...good.projection, repositoryId: 'other' } }, { ...good, projection: { ...good.projection, hops: [{}] } }]) {
    await assert.rejects(() => client.createDeliveryLineageReader({ read: async () => bad, refresh: async () => ({}) }).read(scope), TypeError)
  }
  assert.deepEqual(await client.createDeliveryLineageReader({ read: async () => good, refresh: async () => ({}) }).read(scope), good)
})

import { composeCore } from '@harness-projects/core'
import { createFakeProviders, refOf } from '@harness-projects/provider-fake'
import { CapabilityKey } from '@harness-projects/capabilities'
import { DeliveryLineageSection } from '@harness-projects/ui'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url)), React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
async function renderHostSection(reader, scope) {
  const shared = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, previous = shared.ReactCurrentDispatcher.current
  let state, effect
  const render = () => { shared.ReactCurrentDispatcher.current = { useRef: (value) => ({ current: value }), useState: (value) => [state ?? value, (next) => { state = typeof next === 'function' ? next(state ?? value) : next }], useEffect: (run) => { effect = run } }; try { return DeliveryLineageSection({ scope, reader, connected: true }) } finally { shared.ReactCurrentDispatcher.current = previous } }
  render(); const close = effect(); for (let n = 0; n < 30 && state?.pending !== false; n++) await new Promise((resolve) => setImmediate(resolve))
  const html = renderToStaticMarkup(render()); close(); return html
}
test('real Core route denial masks protected CR through Host and section; pure queries ingest nothing', async (t) => {
  const h = await createExecutionFixture(); t.after(h.close)
  const scope = { workspaceId: h.workspaceId, workItemId: h.itemId, repositoryId: 'repo-alpha' }, input = { workItemId: h.itemId, repositoryId: scope.repositoryId }
  const mounts = await h.storage.listProviderBindings(h.workspaceId), providers = createFakeProviders(Object.fromEntries(mounts.map((mount) => [mount.domain, { bindingId: mount.id }])))
  const dev = providers.development, calls = []; let denied = false
  const wrap = (provider) => new Proxy(provider, { get(object, key) { const method = Reflect.get(object, key, object); if (typeof method !== 'function') return method
    return async (...args) => { calls.push(String(key)); const result = await method.apply(object, args)
      return key === 'describeCapabilities' && denied && object === dev ? { ...result, permission: { ...result.permission, [CapabilityKey.DevelopmentRepositoryRead]: 'unavailable' } } : result }
  } })
  const branch = (await h.host.controller.queries.getExecutionContext(input)).branchExternalId, repository = refOf(dev.gate.bindingId, 'repository', scope.repositoryId)
  dev.state.branches = [{ repository, ref: refOf(dev.gate.bindingId, 'branch', branch), name: branch, headCommit: 'sha-1' }]
  dev.state.changeRequests = [{ repository, ref: refOf(dev.gate.bindingId, 'change_request', 'lineage-pr'), number: 1, title: 'Last PR', body: '', state: 'open', head: branch, headBranch: branch, headCommit: 'sha-1', sourceVersion: 'sha-1', reviewState: 'unknown' }]
  for (const row of providers.delivery.state.runs) row.branch = branch
  const compose = async () => {
    const core = await composeCore({ workspace: { id: h.workspaceId, name: 'Lineage' }, storage: h.storage, providers: { ...providers, planning: wrap(providers.planning), execution: wrap(providers.execution), development: wrap(dev), delivery: wrap(providers.delivery) } })
    h.host.controller.queries.getDeliveryProjection = (query) => core.queries.getDeliveryProjection(query)
    h.host.controller.commands.refreshDeliveryFacts = async (query) => ({ writeState: 'local_only', value: await core.commands.refreshDeliveryFacts(query) })
    calls.length = 0
  }
  await compose()
  const reader = client.createDeliveryLineageReader({ read: () => h.installed.service.getDeliveryProjection(input.workItemId, input.repositoryId).then(json), refresh: () => h.installed.service.refreshDeliveryFacts({ kind: 'user' }, input.workItemId, input.repositoryId) })
  await reader.refresh(scope); const fresh = await reader.read(scope)
  assert.ok(fresh.projection.hops.some((hop) => hop.entityKind === 'change_request'), 'Start Work and successful refresh provide real CR')
  const relations = await h.storage.listRelations(h.workspaceId), revision = await h.storage.currentRevision(h.workspaceId)
  const facts = await h.storage.getDeliveryFacts(h.workspaceId, fresh.projection.hops.find((hop) => hop.entityKind === 'execution_context').externalId)
  calls.length = 0; await reader.read(scope); await reader.read(scope)
  assert.deepEqual(calls, []); assert.deepEqual(await h.storage.listRelations(h.workspaceId), relations); assert.equal(await h.storage.currentRevision(h.workspaceId), revision)
  assert.deepEqual(await h.storage.getDeliveryFacts(h.workspaceId, fresh.projection.hops[0].externalId), facts)
  denied = true; await compose(); await reader.refresh(scope); const stale = await reader.read(scope)
  assert.deepEqual(calls, [], 'real CHANGE_REQUEST_READ_ROUTE rejects before Development and CI reads')
  const cr = stale.projection.hops.find((hop) => hop.entityKind === 'change_request')
  assert.equal(cr, undefined)
  assert.ok(stale.projection.gaps.some((gap) => gap.entityKind === 'change_request' && gap.key === 'development.repository.read'))
  assert.ok(stale.projection.freshness.every(({ confirmedAt, stale }) => confirmedAt === undefined && stale))
  assert.deepEqual(await h.storage.listRelations(h.workspaceId), relations)
  const html = await renderHostSection(reader, scope)
  assert.doesNotMatch(html, /Last PR/); assert.match(html, /development.repository.read/); assert.match(html, /谱系不完整/); assert.doesNotMatch(html, /data-state="passed"/)
})
test('client treats failed refresh as failure and rejects impossible Host calendar date', async () => {
  const scope = { workspaceId: 'ws', workItemId: 'wi', repositoryId: 'repo' }
  const reader = client.createDeliveryLineageReader({ read: async () => ({ ...scope, now: '2026-02-30T00:00:00.000Z', projection: { workItemId: 'wi', repositoryId: 'repo', hops: [], optional: [], freshness: [], gaps: [], degraded: false } }), refresh: async () => ({ writeState: 'failed', value: { applied: false } }) })
  await assert.rejects(() => reader.refresh(scope), TypeError)
  await assert.rejects(() => reader.read(scope), TypeError)
})

import { apply } from '../../apps/harness-plugin/src/client.ts'
test('production plugin binds an unwrapped delivery reader and App carries it to the detail section', async (t) => {
  const h = await createExecutionFixture()
  const abort = new AbortController(), disposers = []; let Panel
  t.after(async () => { await Promise.all(disposers.map((dispose) => dispose())); await h.close() })
  const remote = new Proxy({}, { get: (_, name) => async (...args) => ({ ok: true, value: await h.installed.service[name](...args) }) })
  const stream = { restart() {}, dispose: async () => abort.abort(), async *[Symbol.asyncIterator]() { for await (const value of h.host.watch(abort.signal)) yield { generation: 1, value: json(value), accept() {} } } }
  const child = { remote: { harnessProjects: remote, $stream: () => stream }, effect: (run) => disposers.push(run()), slots: { inject: (_, run) => run(), register: (slot, component) => { if (slot.name === 'main') Panel = component } } }
  await apply({ remote: { $mount: async () => {} }, inject: (_, run) => run(child) })
  const panel = Panel(), reader = panel.props.deliveryReader, scope = { workspaceId: h.workspaceId, workItemId: h.itemId, repositoryId: 'repo-alpha' }
  assert.equal(typeof reader.read, 'function'); assert.equal(typeof reader.refresh, 'function')
  assert.equal((await reader.read(scope)).projection.hops.length, 2)
  const { WorkItemApp } = await import('@harness-projects/ui'), baseline = await h.host.controller.baseline(), store = client.createEntityStore(); store.applyBaseline(baseline)
  const source = { subscribe: () => () => {}, getSnapshot: () => ({ ...baseline, workspace: { id: h.workspaceId, name: 'Fixture' }, store, connection: { connected: true } }) }
  const markup = renderToStaticMarkup(React.createElement(WorkItemApp, { source, deliveryReader: reader, initialPath: `/projects/${h.workspaceId}/items/${h.itemId}` }))
  assert.match(markup, /aria-label="交付谱系"/); assert.match(markup, /刷新交付谱系/)
})
