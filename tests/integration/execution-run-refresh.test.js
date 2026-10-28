import '../fixtures/resolution-preflight.mjs';
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as coreModule from '@harness-projects/core'
const { composeCore, createContext, refreshExecutionRun, cancelExecutionRun, contextIdFor, runIdFor, readExecutionContext } = coreModule
import { createController } from '@harness-projects/controller'
import { createFakeProviders, createFakeExecutionProvider } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
const actor = { actorRef: { kind: 'human' } }, T0 = '2026-10-28T01:00:00Z', T1 = '2026-10-28T02:00:00Z'
async function fixture(t, adapter, statusPolicy = 'provider_authoritative') {
  const root = await mkdtemp(path.join(tmpdir(), 'run-refresh-')); t.after(() => rm(root, { recursive: true, force: true }))
  const providers = createFakeProviders(), file = path.join(root, 'data.sqlite')
  let storage = adapter === 'fake' ? providers.storage : createSqliteStorage(file), now = T0
  t.after(() => storage.close?.())
  const deps = { workspace: { name: 'Execution', statusPolicy }, providers, storage, clock: () => now }
  const core = await composeCore(deps), controller = createController(core)
  const workItemId = (await core.queries.listPlanningItems()).find((item) => item.content.contentKind === 'work_item').entityId
  const scope = { workItemId, repositoryId: 'repo-alpha' }
  await core.commands.startWork({ ...scope, actor: actor.actorRef, idempotencyKey: 'start' })
  const workspaceId = (await controller.baseline()).workspace.id, contextId = contextIdFor(workspaceId, workItemId, scope.repositoryId), runId = runIdFor(contextId)
  const run = await storage.getExecutionRun(runId), writes = []
  const transaction = storage.transaction.bind(storage)
  storage.transaction = (body) => transaction((tx) => body(new Proxy(tx, { get(target, key) { const value = target[key]; return typeof value === 'function' ? (...args) => { if (/^(put|replace|record|advance|remove|set)/.test(key)) writes.push(key); return value.apply(target, args) } : value } })))
  return { providers, core, controller, scope, workspaceId, contextId, runId, run, writes, storage, tick: (value = T1) => { now = value },
    context: () => createContext({ ...deps, workspace: { ...deps.workspace, id: workspaceId } }),
    reopen: () => { storage.close(); storage = createSqliteStorage(file); return storage },
    read: () => core.queries.getExecutionContext(scope), refresh: () => controller.commands.refreshExecutionRun(scope, actor) }
}
for (const adapter of ['fake', 'sqlite']) {
  test(`${adapter}: refresh changes once; healthy repeat writes nothing; durable failure/recovery preserves confirmation`, async (t) => {
    const h = await fixture(t, adapter), remote = h.providers.execution.state.runs.find((r) => r.ref.externalId === h.run.providerRef.externalId)
    assert.equal((await h.read()).runConfirmedAt, T0); assert.equal((await h.read()).runStale, false)
    h.tick(); h.providers.execution.state.runs = h.providers.execution.state.runs.map((r) => r === remote ? { ...r, status: 'succeeded' } : r)
    assert.equal((await h.refresh()).value.applied, true); assert.equal((await h.read()).runStatus, 'succeeded'); assert.equal((await h.read()).runConfirmedAt, T1)
    h.tick('2026-10-28T03:00:00Z'); h.writes.length = 0; assert.equal((await h.refresh()).value.applied, false); assert.deepEqual(h.writes, [])
    const get = h.providers.execution.getRun.bind(h.providers.execution)
    h.providers.execution.getRun = async () => { throw new Error('SECRET') }
    const failed = await h.refresh(); assert.equal(failed.writeState, 'failed'); assert.equal(failed.value.applied, true); assert.doesNotMatch(JSON.stringify(failed), /SECRET/)
    assert.equal((await h.read()).runStale, true); assert.equal((await h.read()).runConfirmedAt, T1)
    h.writes.length = 0; await h.refresh(); assert.deepEqual(h.writes, [])
    if (adapter === 'sqlite') { const ctx = await h.context(), reopened = h.reopen(), next = { ...ctx, storage: reopened }; const view = await readExecutionContext(next, h.scope); assert.equal(view.runStale, true); assert.equal(view.runStatus, 'succeeded'); h.providers.execution.getRun = get; assert.equal((await refreshExecutionRun(next, h.scope)).applied, true); assert.equal((await readExecutionContext(next, h.scope)).runStale, false) }
    else { h.providers.execution.getRun = get; assert.equal((await h.refresh()).value.applied, true); assert.equal((await h.read()).runStale, false); h.writes.length = 0; await h.refresh(); assert.deepEqual(h.writes, []) }
  })
  test(`${adapter}: bad observations preserve known; refs and capability route fail closed`, async (t) => {
    const h = await fixture(t, adapter), ctx = await h.context(), ref = h.run.providerRef
    for (const value of [null, {}, { ref, status: 'unknown' }, { ref, status: 'complete' }, ...['bindingId', 'objectKind', 'externalId'].map((key) => ({ ref: { ...ref, [key]: 'other' }, status: 'succeeded' }))]) {
      h.providers.execution.getRun = async () => ({ ok: true, value })
      assert.equal((await refreshExecutionRun(ctx, h.scope)).ok, false); assert.equal((await h.read()).runStatus, 'running'); assert.equal((await h.read()).runConfirmedAt, T0)
    }
    for (const access of ['read_only', 'unavailable']) {
      const binding = ctx.registry.bindings.find((b) => b.ref.domain === 'execution'), scoped = { ...ctx, registry: { bindings: ctx.registry.bindings.map((b) => b === binding ? { ...b, capabilities: b.capabilities.map((c) => c.key === 'execution.run.read' ? { ...c, access } : c) } : b) } }
      let calls = 0; h.providers.execution.getRun = async () => { calls++; return { ok: true, value: { ref, status: 'succeeded' } } }
      assert.equal((await refreshExecutionRun(scoped, h.scope)).ok, access === 'read_only'); assert.equal(calls, access === 'read_only' ? 1 : 0)
    }
    await h.storage.putExecutionRun({ ...h.run, status: 'unknown' }); h.providers.execution.getRun = async () => ({ ok: true, value: { ref, status: 'unknown' } }); await refreshExecutionRun(ctx, h.scope)
    assert.equal((await h.read()).runStatus, 'unknown'); assert.equal((await h.read()).runConfirmedAt, undefined); assert.equal((await h.read()).runStale, true)
    const broken = { ...ctx, registry: { bindings: ctx.registry.bindings.map((binding) => binding.ref.domain === 'execution' ? { ...binding, execution: undefined } : binding) } }; assert.equal((await refreshExecutionRun(broken, h.scope)).ok, false); assert.equal((await readExecutionContext(broken, h.scope)).runStale, true)
    const missing = { ...ctx, registry: { bindings: [] } }; assert.equal((await refreshExecutionRun(missing, h.scope)).ok, false)
    assert.equal((await readExecutionContext(missing, h.scope)).runStale, true)
  })
  test(`${adapter}: late refresh loses to cancel, full CAS prevents rebinding and health commit is atomic`, async (t) => {
    const h = await fixture(t, adapter), ctx = await h.context(); let release, calls = 0
    h.providers.execution.getRun = async () => { throw Error('offline') }; await refreshExecutionRun(ctx, h.scope); assert.equal((await h.read()).runStale, true)
    h.providers.execution.getRun = () => { calls++; return new Promise((resolve) => { release = resolve }) }
    const pending = refreshExecutionRun(ctx, h.scope), joined = refreshExecutionRun(ctx, h.scope)
    while (!release) await new Promise((resolve) => setImmediate(resolve))
    await cancelExecutionRun(ctx, h.scope); release({ ok: true, value: { ref: h.run.providerRef, status: 'running' } })
    await Promise.all([pending, joined]); assert.equal(calls, 1); assert.equal((await h.read()).runStatus, 'canceled'); assert.equal((await h.read()).runStale, false)
    await h.storage.putExecutionRun(h.run)
    const race = refreshExecutionRun(ctx, h.scope); await new Promise((resolve) => setImmediate(resolve))
    await h.storage.putExecutionRun({ ...h.run, providerRef: { ...h.run.providerRef, objectKind: 'other' } }); release({ ok: true, value: { ref: h.run.providerRef, status: 'succeeded' } }); await race
    assert.equal((await h.storage.getExecutionRun(h.runId)).providerRef.objectKind, 'other'); assert.equal((await h.read()).runStatus, 'running')
    await h.storage.putExecutionRun(h.run); h.providers.execution.getRun = async () => { throw Error('offline') }; await refreshExecutionRun(ctx, h.scope)
    h.providers.execution.getRun = async () => ({ ok: true, value: { ref: h.run.providerRef, status: 'succeeded' } })
    const transaction = h.storage.transaction.bind(h.storage); h.storage.transaction = (body) => transaction((tx) => body(new Proxy(tx, { get(target, key) { if (key === 'putSyncCursor') return async () => { throw Error('disk') }; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value } })))
    assert.equal((await refreshExecutionRun(ctx, h.scope)).ok, false); assert.equal((await h.read()).runStatus, 'running'); assert.equal((await h.read()).runStale, true)
    h.storage.transaction = transaction; assert.equal((await refreshExecutionRun(ctx, h.scope)).ok, true); assert.equal((await h.read()).runStatus, 'succeeded')
  })
}
test('issuer fallback is used after default changes; missing/foreign context never asks provider', async (t) => {
  const h = await fixture(t, 'fake'), fallback = createFakeExecutionProvider(), ctx = await h.context(), original = ctx.registry.bindings.find((b) => b.ref.domain === 'execution')
  let calls = 0; h.providers.execution.getRun = async (ref) => { calls++; return { ok: true, value: { ref, status: 'succeeded' } } }; fallback.getRun = async () => { throw Error('wrong default') }
  const changed = { ...ctx, registry: { bindings: [{ ...original, isDefault: true, ref: { ...original.ref, bindingId: 'new' }, execution: fallback }, { ...original, isDefault: false }] } }
  assert.equal((await refreshExecutionRun(changed, h.scope)).ok, true); assert.equal(calls, 1)
  const record = await h.storage.getExecutionContext(h.contextId); await h.storage.putExecutionContext({ ...record, workItemId: (await h.core.queries.listPlanningItems()).find((item) => item.entityId !== h.scope.workItemId && item.content.contentKind === 'work_item').entityId })
  assert.equal((await refreshExecutionRun(changed, h.scope)).ok, false); assert.equal(calls, 1)
})
for (const policy of ['provider_authoritative', 'manual_only', 'host_authoritative']) test(`${policy}: terminal refresh leaves Planning facts and revision unchanged`, async (t) => {
  const h = await fixture(t, 'fake', policy), before = JSON.stringify([await h.core.queries.listPlanningItems(), h.storage.data.memberships, h.storage.data.fieldValues, await h.storage.listPlanningProjections(h.workspaceId), await h.storage.currentRevision(h.workspaceId)])
  for (const status of ['succeeded', 'failed', 'canceled', 'timed_out']) { h.providers.execution.getRun = async (ref) => ({ ok: true, value: { ref, status } }); await h.refresh(); assert.equal((await h.read()).runStatus, status) }
  assert.equal(JSON.stringify([await h.core.queries.listPlanningItems(), h.storage.data.memberships, h.storage.data.fieldValues, await h.storage.listPlanningProjections(h.workspaceId), await h.storage.currentRevision(h.workspaceId)]), before)
})
