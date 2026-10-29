import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkspaceSetup } from '@harness-projects/core'
import { createWorkspaceSetupSource } from '@harness-projects/client'
import { createFakeStorage } from '@harness-projects/provider-fake'

test('执行安装属于正式 workspace setup 命令', () => {
  assert.equal(typeof createWorkspaceSetup(createFakeStorage()).installExecutionBindings, 'function', '正式 setup 入口应能安装持久主备用 pair')
})

import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { createExecutionSetup } from '../../packages/core/src/execution-setup.ts'
import { hostStoragePolicy, PROVIDER_CATALOG, restoreProviders } from '../../apps/harness-plugin/src/host-providers.ts'
import { WORKSPACE, seedWorkspace, mount } from './fixtures/host-seed.js'
const env = { worktreesDir: '/worktrees', fetch: globalThis.fetch, resolveCredential: async () => undefined }

test('显式安装事务幂等、角色逆序恢复与同槽冲突隔离；disabled 保留', async () => {
  const storage = createSqliteStorage(':memory:', hostStoragePolicy(PROVIDER_CATALOG))
  try {
    const setup = createExecutionSetup(storage), input = { workspaceId: WORKSPACE }
    assert.equal((await setup.installExecutionBindings(input)).error.code, 'not_found')
    await seedWorkspace(storage)
    const installed = await setup.installExecutionBindings(input)
    assert.equal(installed.ok, true)
    assert.deepEqual(await setup.installExecutionBindings(input), installed)
    const rows = await storage.listProviderBindings(WORKSPACE)
    const reverse = new Proxy(storage, { get(target, key) { return key === 'listProviderBindings' ? async () => [...rows].reverse() : typeof target[key] === 'function' ? target[key].bind(target) : target[key] } })
    const restored = await restoreProviders(reverse, WORKSPACE, PROVIDER_CATALOG, env)
    assert.deepEqual([restored.table.execution.definition.implementationKey, restored.table.executionFallback.definition.implementationKey, restored.disabled], ['execution.harness', 'execution.human', []])
    const conflicted = await restoreProviders(new Proxy(storage, { get(target, key) { return key === 'listProviderBindings' ? async () => [...rows, mount('00000000-0000-4000-8000-0000000000cd', 'execution', 'execution.harness')] : typeof target[key] === 'function' ? target[key].bind(target) : target[key] } }), WORKSPACE, PROVIDER_CATALOG, env)
    assert.deepEqual([conflicted.table.execution, conflicted.table.executionFallback.definition.implementationKey, conflicted.disabled.map((entry) => entry.error.code)], [undefined, 'execution.human', ['conflict', 'conflict']])
    const disabled = rows.find((row) => !row.isDefault)
    await storage.putProviderBinding({ ...disabled, enabled: false })
    assert.equal((await setup.installExecutionBindings(input)).error.code, 'conflict')
    assert.equal((await storage.listProviderBindings(WORKSPACE)).find((row) => row.id === disabled.id).enabled, false)
  } finally { storage.close() }
})

test('后一安装写入失败整笔回滚，不留下半 pair', async () => {
  const policy = hostStoragePolicy(PROVIDER_CATALOG)
  const storage = createSqliteStorage(':memory:', { ...policy, configurations: new Map([...policy.configurations].map(([key, schema]) => [key, key === 'execution.human' ? { required: { kind: 'string', required: true, pattern: '.+', maxLength: 100 } } : schema])) })
  try {
    await seedWorkspace(storage)
    assert.equal((await createExecutionSetup(storage).installExecutionBindings({ workspaceId: WORKSPACE })).error.code, 'invalid_input')
    assert.deepEqual(await storage.listProviderBindings(WORKSPACE), [])
  } finally { storage.close() }
})

import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { apply as applyHost } from '../../apps/harness-plugin/src/host.ts'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { seed, occurrences } from './fixtures/host-seed.js'
import { fixtureFor, registerWorkItem } from './local-git-fixture.js'
import { recorded, replay } from '../contract/fixtures/harness-session/replay.js'
import { contextIdFor, runIdFor } from '@harness-projects/core'
const actor = { kind: 'user', id: 'execution-test' }, issuer = 'issuer-canary-52a67f3a-324a-4e48-b075-aaf10db8f63e'
for (const scenario of ['completed', 'error', 'missing', 'forced', 'unknown', 'env-unset', 'env-0', 'env-true']) test(`正式 remote 安装→真实 Git ack→会话/备用→SQLite：${scenario}`, async (t) => {
  const fixture = await fixtureFor(t), dataPath = path.join(fixture.root, 'harness-projects', 'workspace.sqlite')
  await seed(dataPath, PROVIDER_CATALOG, async (storage) => {
    await seedWorkspace(storage); await registerWorkItem(storage, WORKSPACE, 'wi-1')
    const bound = await createWorkspaceSetup(storage).bindRepository({ workspaceId: WORKSPACE, repositoryId: 'repo-alpha', references: [{ domain: 'development', implementationKey: 'development.local-git', configuration: { repositoryExternalId: 'repo-alpha', repositoryPath: fixture.repositoryPath } }] })
    assert.equal(bound.ok, true)
    await storage.putExternalIdentity({ id: 'wi-identity', entityId: 'wi-1', bindingId: bound.value.bindingIds[0], externalKind: 'issue', externalId: '1', role: 'primary' })
  })
  const id = contextIdFor(WORKSPACE, 'wi-1', 'repo-alpha'), calls = [], secrets = []
  const observation = scenario === 'completed' ? 'O3.1' : undefined
  const exchanges = structuredClone(observation ? recorded.exchanges.filter((entry) => entry.observation === observation && ['create', 'prompt', 'inspect', 'list'].includes(entry.operation)) : recorded.exchanges.filter((entry) => ['O1.1', 'O1.2', 'O2.1', 'O2.2'].includes(entry.observation)))
  for (const entry of exchanges) {
    if (entry.operation === 'prompt') { entry.request.requestId = id; entry.request.content = [{ type: 'text', text: 'harness run work/wi-1' }] }
    if (entry.operation === 'inspect') for (const event of entry.outcome.value.events) if (event.rpcId) event.rpcId = id
  }
  const recording = replay(exchanges), raw = {
    async create(input) { calls.push(['create', input]); assert.equal(input.cwd, await realpath(input.cwd)); return recording.create({ cwd: '<scratch>/work' }) },
    async prompt(input, signal) { calls.push(['prompt', input]); assert.equal(input.requestId, id); assert.equal(signal.aborted, false); if (scenario === 'unknown') throw new Error('ack lost'); return recording.prompt(input) },
    async inspect(sessionId) {
      calls.push(['inspect', sessionId]); const value = await recording.inspect(sessionId)
      return { events: value.events.map(({ seq, type, turn, rpcId, reason }) => ({ seq, type, data: { ...(turn === undefined ? {} : { turn }), ...(rpcId ? { source: { kind: 'user', rpcId } } : {}), ...(reason ? { reason } : {}) } })) }
    },
    list(input) { calls.push(['list']); return recording.list(input) },
  }
  const options = { dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, resolveCredential: async (handle) => { secrets.push(handle); return issuer }, sessionController: () => scenario === 'missing' ? undefined : raw, forceSessionStartFailure: scenario === 'forced' }
  let host, remote
  if (scenario === 'forced' || scenario.startsWith('env-')) {
    const environment = { ...process.env, DSH_HOME: fixture.root }
    delete environment.HARNESS_PROJECTS_FORCE_SESSION_START_FAILURE
    if (scenario !== 'env-unset') environment.HARNESS_PROJECTS_FORCE_SESSION_START_FAILURE = scenario === 'forced' ? '1' : scenario.slice(4)
    t.mock.property(process, 'env', environment)
    let dispose, disposal
    await applyHost({
      invocation: { peer: { id: 'fixture-peer' } },
      get: (name) => name === 'profileContext' ? { dir: fixture.root } : name === 'sessionController' ? raw : name === 'credentials' ? { resolve: async (handle) => ({ value: await options.resolveCredential(handle), source: 'fixture' }) } : undefined,
      provide: (_name, service) => { remote = { service, dispose: async () => {} }; return () => {} },
      typert: { register: () => () => {} }, effect: (run) => { dispose = run() },
    })
    host = { stop: () => { disposal ??= dispose() }, dispose: () => disposal ??= dispose(), disabled: [] }
  } else {
    host = await createHostComposition(options)
    remote = await installHostRemote({ invocation: { peer: { id: 'fixture-peer' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  }
  t.after(async () => { host.stop(); await remote.dispose(); await host.dispose() })
  const installed = await remote.service.installExecutionBindings(actor, 'install')
  assert.equal(installed.writeState, 'local_only'); assert.equal(installed.value.bindingIds.length, 2)
  assert.deepEqual(await remote.service.installExecutionBindings(actor, 'install'), installed)
  assert.equal((await remote.service.getWorkspaceSetup()).executionInstalled, true)
  const started = await remote.service.startWork(actor, 'start', 'wi-1', 'repo-alpha', undefined)
  const { context: view } = await remote.service.getExecutionContext('wi-1', 'repo-alpha')
  assert.equal(view.status, 'ready', JSON.stringify({ started, view, disabled: host.disabled })); assert.equal(await realpath(view.worktreeExternalId), view.worktreeExternalId)
  const manual = scenario === 'missing' || scenario === 'forced'
  assert.deepEqual([view.runStatus, view.fallback, secrets.length], [manual ? 'running' : scenario === 'unknown' ? 'unknown' : scenario === 'completed' ? 'succeeded' : 'failed', manual ? 'manual_fallback' : undefined, manual ? 1 : 0])
  if (manual) assert.deepEqual(calls, [], '明确 unavailable 和 force 必须零 create/prompt')
  else assert.equal(calls.filter(([name]) => name === 'create').length, 1)
  const repeated = await remote.service.startWork(actor, 'start', 'wi-1', 'repo-alpha', undefined)
  assert.deepEqual({ ...repeated, value: { ...repeated.value, branchHeadCommit: undefined } }, { ...started, value: { ...started.value, branchHeadCommit: undefined } })
  assert.equal(secrets.length, manual ? 1 : 0, 'unknown/replay 不启动人工执行者')
  assert.equal(calls.filter(([name]) => name === 'create').length, manual ? 0 : 1)
  const storage = createSqliteStorage(dataPath, hostStoragePolicy(PROVIDER_CATALOG)), run = await storage.getExecutionRun(runIdFor(id)); storage.close()
  assert.equal(run.status, view.runStatus)
  if (!manual && scenario !== 'unknown') { assert.deepEqual(JSON.parse(run.providerRef.externalId)[1], id); recording.assertConsumed() }
  if (manual) {
    host.stop(); await remote.dispose(); await host.dispose()
    host = await createHostComposition(options); remote = await installHostRemote({ invocation: { peer: { id: 'fixture-peer' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
    assert.deepEqual((await remote.service.installExecutionBindings(actor, 'install-restart')).value, installed.value)
    const reopened = createSqliteStorage(dataPath, hostStoragePolicy(PROVIDER_CATALOG))
    try {
      const fresh = await restoreProviders(reopened, WORKSPACE, PROVIDER_CATALOG, { ...env, resolveCredential: options.resolveCredential })
      assert.equal((await fresh.table.executionFallback.getRun(run.providerRef)).ok, true)
    } finally { reopened.close() }
  }
  host.stop(); await assert.rejects(() => remote.service.startWork(actor, 'late', 'wi-1', 'repo-alpha', undefined)); assert.equal(await occurrences(path.dirname(dataPath), issuer), 0)
})


for (const scenario of ['corrected-conflict', 'removed-pair', 'read-recovered-pair']) test(`同页执行安装 intent 恢复：${scenario}`, async (t) => {
  const fixture = await fixtureFor(t), dataPath = path.join(fixture.root, 'intent.sqlite')
  await seed(dataPath, PROVIDER_CATALOG, seedWorkspace)
  const host = await createHostComposition({ dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, resolveCredential: async () => undefined })
  const storage = createSqliteStorage(dataPath, hostStoragePolicy(PROVIDER_CATALOG))
  t.after(async () => { await host.dispose(); storage.close() })
  if (scenario === 'corrected-conflict') {
    await createExecutionSetup(storage).installExecutionBindings({ workspaceId: WORKSPACE })
    const human = (await storage.listProviderBindings(WORKSPACE)).find((mount) => !mount.isDefault)
    await storage.putProviderBinding({ ...human, enabled: false })
  }
  let failRead = scenario === 'read-recovered-pair'
  const keys = [], source = createWorkspaceSetupSource({
    getWorkspaceSetup: () => { if (failRead) { failRead = false; throw new Error('read unavailable') }; return host.call('getWorkspaceSetup', {}) },
    installExecutionBindings: (actorRef, idempotencyKey) => { keys.push(idempotencyKey); return host.call('installExecutionBindings', { actorRef, idempotencyKey }) },
  }, { actorRef: actor, key: () => 'install-intent' })
  t.after(() => source.dispose())
  await source.installExecution()
  if (scenario === 'read-recovered-pair') {
    assert.equal(source.getSnapshot().failure, 'read')
    await source.refresh()
    assert.equal(source.getSnapshot().error, undefined)
  }
  const original = await storage.listProviderBindings(WORKSPACE)
  if (scenario === 'corrected-conflict') {
    assert.equal(source.getSnapshot().error?.code, 'conflict')
    await storage.putProviderBinding({ ...original.find((mount) => !mount.isDefault), enabled: true })
  } else {
    assert.equal(source.getSnapshot().setup.executionInstalled, true)
    for (const mount of original) await storage.removeProviderBinding({ workspaceId: WORKSPACE, bindingId: mount.id, domain: 'execution' })
    await source.refresh()
    assert.equal(source.getSnapshot().setup.executionInstalled, undefined)
  }
  await source.installExecution()
  assert.equal(source.getSnapshot().error, undefined, '确定冲突修复后不得重放旧 conflict')
  assert.equal(source.getSnapshot().setup.executionInstalled, true, '显式重新启用必须实际安装')
  assert.notEqual(keys[0], keys[1], '结束的 intent 不得永久重放原键')
  const current = await storage.listProviderBindings(WORKSPACE)
  assert.equal(current.length, 2)
  if (scenario !== 'corrected-conflict') assert.ok(current.every((mount) => !original.some((old) => old.id === mount.id)))
})
