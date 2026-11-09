import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createWorkspaceSetup, contextIdFor, runIdFor } from '@harness-projects/core'
import { createSqliteStorage, SqliteStorage } from '@harness-projects/storage-sqlite'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { apply as applyHost } from '../../apps/harness-plugin/src/host.ts'
import { createHostSessionPort } from '../../apps/harness-plugin/src/host-session-adapter.ts'
import { Context } from '@deepseek-ai/cordis'
import { createPlanningLifetime } from '../../apps/harness-plugin/src/host-planning-lifetime.ts'
import { PROVIDER_CATALOG, hostStoragePolicy } from '../../apps/harness-plugin/src/host-providers.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { dump, seed, seedPlanning, seedWorkspace, WORKSPACE } from './fixtures/host-seed.js'
import { fixtureFor, registerWorkItem } from './local-git-fixture.js'

const turn = () => new Promise((resolve) => setImmediate(resolve))
const gate = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const within = async (promise, ms = 1500) => { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('shutdown exceeded budget')), ms) })]) } finally { clearTimeout(timer) } }
const actor = { kind: 'user' }

test('native waits cross a Planning deadline but still abort on stop', async () => {
  const lifetime = createPlanningLifetime(15), delay = () => new Promise((resolve) => setTimeout(resolve, 40))
  const sessions = createHostSessionPort(() => ({ create: async () => { await delay(); return { sessionId: 'valid-session' } } }), false, lifetime)
  assert.deepEqual(await sessions.create({ cwd: '/work' }), { sessionId: 'valid-session' })
  const pending = createHostSessionPort(() => ({ create: () => new Promise(() => {}) }), false, lifetime).create({ cwd: '/work' })
  await turn(); lifetime.stop(); await within(assert.rejects(pending), 100)
})

test('new domain descriptions are abort-only and keep their own normal budgets', async () => {
  const lifetime = createPlanningLifetime(15)
  for (const domain of ['development', 'delivery', 'execution']) {
    const port = lifetime.wrap({ definition: { domains: [domain] }, describeCapabilities: async () => { await new Promise((resolve) => setTimeout(resolve, 40)); return { available: true } } })
    assert.deepEqual(await port.describeCapabilities(), { available: true })
  }
  const pending = lifetime.wrap({ describeCapabilities: () => new Promise(() => {}) }).describeCapabilities()
  await turn(); lifetime.stop(); await within(assert.rejects(pending), 100)
})

for (const phase of ['profile', 'discovery', 'register']) test(`real Cordis Host unload/error during ${phase} owns startup resources within one deadline`, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'host-startup-')), dataPath = path.join(root, 'harness-projects', 'workspace.sqlite')
  t.after(() => rm(root, { recursive: true, force: true }))
  if (phase !== 'profile') await seed(dataPath, PROVIDER_CATALOG, async (storage) => { await seedWorkspace(storage); if (phase === 'discovery') await seedPlanning(storage) })
  const before = phase === 'discovery' ? dump(dataPath) : undefined, entered = gate(), release = gate(), context = new Context()
  let signal, registrations = 0, services = 0
  context.provide('profileContext', { get dir() { if (phase === 'profile') entered.resolve(); return root } })
  context.provide('credentials', { resolve: async () => ({ value: 'synthetic', source: 'test' }) })
  context.provide('typert', { register() { registrations++; if (phase === 'register') throw Error('synthetic register refused'); return () => {} } })
  t.mock.method(globalThis, 'fetch', (_url, init) => { signal = init.signal; entered.resolve(); return release.promise })
  const close = t.mock.method(SqliteStorage.prototype, 'close')
  const plugin = context.inject(['typert'], (ctx) => applyHost({ fiber: ctx.fiber, on: ctx.on.bind(ctx), get: ctx.get.bind(ctx), effect: ctx.effect.bind(ctx), typert: ctx.typert,
    provide(name, value) { services++; const remove = ctx.provide(name, value); return () => { services--; remove(); if (phase === 'register') { entered.resolve(); return release.promise } } },
  }))
  await entered.promise
  const stopped = phase === 'register' ? assert.rejects(plugin.await(), /synthetic register refused/) : plugin.dispose()
  try {
    await within(stopped, 1250)
    if (signal) assert.equal(signal.aborted, true)
    assert.equal(registrations, phase === 'register' ? 1 : 0)
    assert.equal(services, 0)
    assert.equal(close.mock.callCount(), phase === 'profile' ? 0 : 1)
  } finally { release.resolve(new Response('{}', { status: 500 })); await stopped.catch(() => undefined); await plugin.dispose(); await turn() }
  if (before) assert.deepEqual(dump(dataPath), before)
})

for (const mode of ['resolve', 'never', 'reject']) test(`real Cordis Host ${mode} remote cleanup keeps bounded shutdown and safe diagnostics`, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'host-cleanup-diagnostic-')), context = new Context(), events = []
  const canary = 'synthetic-cleanup-private-detail'
  const errors = ['UNREGISTER_FAILED', 'PROVIDE_FAILED'].map((code, index) => Object.assign(new Error(canary), { name: 'RemoteCleanupError', code, errcode: index + 431, path: canary, cause: { detail: canary } }))
  let release, reject
  const pending = new Promise((resolve, fail) => { release = resolve; reject = fail })
  const diagnosticFile = path.join(root, 'harness-projects', 'diagnostics.log')
  const log = async () => { try { return await readFile(diagnosticFile, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error; return '' } }
  const rows = (raw) => raw.trim() === '' ? [] : raw.trim().split('\n').map(line => JSON.parse(line))
  const close = t.mock.method(SqliteStorage.prototype, 'close')
  context.provide('profileContext', { dir: root })
  context.provide('typert', { register: () => () => { events.push('unregister'); return mode === 'never' ? pending : mode === 'reject' ? Promise.reject(errors[0]) : undefined } })
  const plugin = context.inject(['typert'], ctx => applyHost({ fiber: ctx.fiber, on: ctx.on.bind(ctx), get: ctx.get.bind(ctx), effect: ctx.effect.bind(ctx), typert: ctx.typert,
    provide(name, value) { const remove = ctx.provide(name, value); return () => { events.push('provide'); remove(); if (mode === 'never') return pending; if (mode === 'reject') throw errors[1] } },
  }))
  try {
    await plugin.await()
    const started = Date.now()
    await within(plugin.dispose(), 1250)
    assert.ok(Date.now() - started < 1250, 'all cleanup shares the original 1000ms Host deadline')
    assert.deepEqual(events, ['unregister', 'provide'], 'each cleanup still runs once when another rejects or stalls')
    assert.equal(close.mock.callCount(), 1)
    let raw = await log(), diagnostics = rows(raw)
    assert.deepEqual(diagnostics.map(row => row.event), mode === 'resolve' ? [] : mode === 'never' ? ['shutdownDeadlineExceeded'] : ['shutdownFailed', 'shutdownFailed'])
    if (mode === 'never') { reject(errors[0]); await turn(); raw = await log(); diagnostics = rows(raw); assert.equal(diagnostics.filter(row => row.event === 'shutdownFailed').length, 2, 'late rejections are consumed and diagnosed per disposer') }
    assert.equal(raw.includes(canary), false, 'message, stack, path and cause must never reach diagnostics')
    assert.equal(raw.includes(root), false)
    for (const row of diagnostics.filter(row => row.event === 'shutdownFailed')) {
      assert.deepEqual(Object.keys(row).sort(), ['at', 'code', 'errcode', 'event', 'name'])
      assert.equal(row.name, 'RemoteCleanupError')
    }
    if (mode === 'reject') assert.deepEqual(diagnostics.map(({ code, errcode }) => [code, errcode]).sort(), [['PROVIDE_FAILED', 432], ['UNREGISTER_FAILED', 431]])
    await plugin.dispose(); assert.equal(close.mock.callCount(), 1)
  } finally { release(); await plugin.dispose(); await turn(); await rm(root, { recursive: true, force: true }) }
})

test('stop rejects in-flight waits and fences a call queued before stop without dispatch', async () => {
  const lifetime = createPlanningLifetime(), release = gate(); let dispatched = 0
  const port = lifetime.wrap({ write: () => { dispatched++; return release.promise } })
  const pending = port.write(); void pending.catch(() => undefined); await turn()
  lifetime.stop()
  try { await within(assert.rejects(pending), 100); assert.equal(dispatched, 1) }
  finally { release.resolve('late') }
  const second = createPlanningLifetime(), wrapped = second.wrap({ read: () => { dispatched++; return 'bad' } })
  const queued = wrapped.read(); second.stop()
  await assert.rejects(queued); assert.equal(dispatched, 1)
})

test('stop consumes late rejection and closes a noncooperative reconcile iterator once', async () => {
  const lifetime = createPlanningLifetime(); let reject, returns = 0
  const port = lifetime.wrap({ reconcile: () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise((_, r) => { reject = r }), return: () => { returns++; return new Promise(() => {}) } }) }) })
  const iterator = port.reconcile()[Symbol.asyncIterator](), next = iterator.next()
  await turn(); lifetime.stop(); await assert.rejects(next)
  reject(Error('late rejected I/O')); await iterator.return(); await turn()
  assert.equal(returns, 1)
})

test('retained reverse callback cannot enter Core after its generation stops', async () => {
  const lifetime = createPlanningLifetime(), release = gate(); let callback, writes = 0
  const port = lifetime.wrap({ startRun: (_input, lifecycle) => { callback = lifecycle; return release.promise } })
  const pending = port.startRun({}, { retainRunIdentity: async () => { writes++ } })
  await turn(); lifetime.stop(); await assert.rejects(pending)
  assert.throws(() => callback.retainRunIdentity({}), /关闭/)
  release.resolve(); await turn(); assert.equal(writes, 0)
})

for (const stuck of ['credential', 'fetch', 'body']) test(`setup ${stuck} aborts real I/O, withdraws remote and closes once`, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'host-lifetime-')), entered = gate(), release = gate(), events = []
  let signal, fetches = 0
  const options = { dataPath: path.join(root, 'workspace.sqlite'), workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG,
    resolveCredential: async () => { if (stuck === 'credential') { entered.resolve(); return release.promise } return 'synthetic' },
    fetch: async (_url, init) => { fetches++; signal = init.signal; if (stuck === 'fetch') { entered.resolve(); return release.promise }
      return { status: 200, headers: new Headers(), json: () => { entered.resolve(); return release.promise } } },
  }
  const host = await createHostComposition(options)
  const installed = await installHostRemote({ invocation: { peer: { id: 'fixture-peer' } }, provide: () => () => { events.push('provide') }, typert: { register: () => () => { events.push('withdraw') } } }, host)
  const close = SqliteStorage.prototype.close
  t.mock.method(SqliteStorage.prototype, 'close', function () { events.push('close'); return close.call(this) })
  const request = installed.service.connectAccount(actor, 'account'); void request.catch(() => undefined)
  await entered.promise
  host.stop(); const deadline = Date.now() + 100
  try {
    const remote = installed.dispose(deadline)
    assert.ok(events.includes('withdraw'), '撤注册不能等在途请求')
    await within(remote.then(() => host.dispose(deadline)), 500)
    await request.catch(() => undefined)
    assert.equal(events.filter((e) => e === 'close').length, 1)
    assert.ok(events.indexOf('withdraw') < events.indexOf('close'))
    if (signal) assert.equal(signal.aborted, true)
    await assert.rejects(installed.service.connectAccount(actor, 'late'))
    assert.equal(host.dispose(), host.dispose())
  } finally {
    release.resolve(stuck === 'credential' ? 'synthetic' : stuck === 'fetch' ? new Response('{}') : {})
    await request.catch(() => undefined); await installed.dispose(); await host.dispose(); await rm(root, { recursive: true, force: true })
  }
  assert.equal(fetches, stuck === 'credential' ? 0 : 1, '迟到凭据不得派发 fetch')
})

test('remote withdrawal and noncooperative disposers share one deadline', async () => {
  const release = gate(), events = []
  const installed = await installHostRemote({ provide: () => () => { events.push('provide'); return release.promise }, typert: { register: () => () => { events.push('withdraw'); return release.promise } } }, { call: () => release.promise })
  const request = installed.service.baseline(); const start = Date.now()
  try {
    const disposal = installed.dispose(start + 80)
    assert.deepEqual(events, ['withdraw', 'provide'])
    await within(disposal, 200)
    assert.ok(Date.now() - start < 160)
    assert.equal(disposal, installed.dispose())
  } finally { release.resolve(); await request; await installed.dispose() }
})

for (const phase of ['create', 'checkpoint', 'checkpoint-deadline', 'prompt']) test(`SQLite ${phase} stop preserves uncertainty and blocks late prompt / repeat dispatch`, async (t) => {
  const fixture = await fixtureFor(t), dataPath = path.join(fixture.root, 'harness-projects', 'workspace.sqlite')
  await seed(dataPath, PROVIDER_CATALOG, async (storage) => {
    await seedWorkspace(storage); await registerWorkItem(storage, WORKSPACE, 'wi-1')
    const bound = await createWorkspaceSetup(storage).bindRepository({ workspaceId: WORKSPACE, repositoryId: 'repo-alpha', references: [{ domain: 'development', implementationKey: 'development.local-git', configuration: { repositoryExternalId: 'repo-alpha', repositoryPath: fixture.repositoryPath } }] })
    await storage.putExternalIdentity({ id: 'wi-identity', entityId: 'wi-1', bindingId: bound.value.bindingIds[0], externalKind: 'issue', externalId: '1', role: 'primary' })
  })
  const entered = gate(), release = gate(); let creates = 0, prompts = 0, checkpoints = 0, promptSignal
  const put = SqliteStorage.prototype.putExecutionRun
  t.mock.method(SqliteStorage.prototype, 'putExecutionRun', async function (...args) {
    checkpoints++; if (phase.startsWith('checkpoint') && checkpoints === 1) { entered.resolve(); await release.promise }
    return put.apply(this, args)
  })
  const raw = { create() { creates++; if (phase === 'create') { entered.resolve(); return release.promise } return { sessionId: 'lifetime-session' } },
    prompt(_input, signal) { prompts++; promptSignal = signal; entered.resolve(); return release.promise },
    page() { return { cursor: -1, records: [], hasMore: false } }, list() { return { items: [] } } }
  const options = { dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, resolveCredential: async () => undefined, sessionController: () => raw }
  let host = await createHostComposition(options)
  await host.call('installExecutionBindings', { actorRef: actor, idempotencyKey: 'install' })
  const request = { actorRef: actor, idempotencyKey: 'original', workItemId: 'wi-1', repositoryId: 'repo-alpha', task: 'Synthetic explicit task' }
  const pending = host.call('startWork', request); void pending.catch(() => undefined)
  await entered.promise
  host.stop(); let disposed = false; const disposal = host.dispose(Date.now() + (phase === 'checkpoint-deadline' ? 80 : 1000)).then(() => { disposed = true })
  try {
    if (phase === 'checkpoint') { await turn(); assert.equal(disposed, false); release.resolve() }
    await within(disposal)
    if (promptSignal) assert.equal(promptSignal.aborted, true)
    const reopenBeforeLate = phase === 'create' || phase === 'checkpoint-deadline'
    if (reopenBeforeLate) host = await createHostComposition(options)
    const beforeLate = checkpoints
    release.resolve(phase === 'create' ? { sessionId: 'late-session' } : { accepted: true })
    await pending.catch(() => undefined); await turn(); await turn()
    assert.equal(prompts, phase === 'prompt' ? 1 : 0)
    if (phase === 'create') assert.equal(checkpoints, beforeLate, 'late native create 不得进入 Core checkpoint')
    const storage = createSqliteStorage(dataPath, hostStoragePolicy(PROVIDER_CATALOG))
    try {
      const receipt = await storage.findMutationAttempt(WORKSPACE, 'original'), run = await storage.getExecutionRun(runIdFor(contextIdFor(WORKSPACE, 'wi-1', 'repo-alpha')))
      assert.ok(['unknown', 'pending'].includes(receipt.state)); assert.equal(receipt.externalIntent.operation, 'startRun')
      if (phase === 'checkpoint-deadline') assert.equal(run, undefined, '超时关闭回滚尚未提交 checkpoint，保留原 intent')
      else if (phase !== 'create') { assert.equal(run.status, 'unknown'); assert.equal(JSON.parse(run.providerRef.externalId)[0], 'lifetime-session') }
    } finally { storage.close() }
    if (!reopenBeforeLate) host = await createHostComposition(options)
    for (const key of ['original', 'replacement']) assert.equal((await host.call('startWork', { ...request, idempotencyKey: key })).authoritative, false)
    assert.deepEqual([creates, prompts], [1, phase === 'prompt' ? 1 : 0])
  } finally { release.resolve({ sessionId: 'late-session', accepted: true }); await pending.catch(() => undefined); await host.dispose() }
})
