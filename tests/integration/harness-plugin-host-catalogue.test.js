import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import { createEntityStore, createSync } from '@harness-projects/client'
import { toWireMetadata } from '@harness-projects/controller'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { PROVIDER_CATALOG } from '../../apps/harness-plugin/src/host-providers.ts'
import { apply as applyHost } from '../../apps/harness-plugin/src/host.ts'
import { dump, seed } from './fixtures/host-seed.js'

const A = '00000000-0000-4000-8000-0000000002a1', B = '00000000-0000-4000-8000-0000000002b2', C = '00000000-0000-4000-8000-0000000002c3'
const actor = { kind: 'user' }, wire = (value) => JSON.parse(JSON.stringify(value))
const workspace = (id, name, statusPolicy = 'provider_authoritative') => ({ id, name, statusPolicy })
async function directory(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'host-catalogue-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
/** 直接写库造工作区行：catalogue 只读本地行，不调 Provider。 */
const seedRows = (dataPath, rows) => seed(dataPath, new Map(), async (storage) => { for (const row of rows) await storage.putWorkspace(row) })
async function open(t, rows, wrap = (host) => host, catalog = new Map()) {
  const root = await directory(t), dataPath = path.join(root, 'workspace.sqlite')
  await seedRows(dataPath, rows)
  const host = await createHostComposition({ dataPath, catalog, resolveCredential: async () => undefined, watchIntervalMs: 5 })
  const installed = await installHostRemote({ invocation: { peer: { id: 'fixture-peer' } }, provide: () => () => {}, typert: { register: () => () => {} } }, wrap(host))
  t.after(async () => { host.stop(); await installed.dispose(); await host.dispose() })
  return { dataPath, host, service: installed.service }
}
const baselineOf = (host) => host.call('baseline', {})
test('catalogue enumerates zero workspaces and createWorkspace activates a generated id', async t => {
  const h = await open(t, [])
  assert.deepEqual(await h.service.listWorkspaces(), { activeWorkspaceId: null, workspaces: [] })
  assert.equal((await h.service.getWorkspaceSetup()).workspace, null)
  const created = await h.service.createWorkspace(actor, 'create-first', 'First workspace'); assert.equal(created.writeState, 'local_only')
  const workspaceId = created.value.workspaceId
  assert.ok(typeof workspaceId === 'string' && workspaceId.length > 0, '无显式初始目标时 createWorkspace 生成新的工作区 id')
  assert.deepEqual(await h.service.listWorkspaces(), { activeWorkspaceId: workspaceId, workspaces: [{ workspaceId, name: 'First workspace', planning: 'none', policy: 'supported' }] })
  assert.deepEqual((await h.service.getWorkspaceSetup()).workspace, { id: workspaceId, name: 'First workspace' }); assert.equal((await baselineOf(h.host)).workspace.id, workspaceId)
  const replay = await h.service.createWorkspace(actor, 'create-first', 'First workspace')
  assert.deepEqual([replay.writeState, replay.value?.workspaceId, (await h.service.listWorkspaces()).workspaces.length], ['local_only', workspaceId, 1], '同 key 重放不得 conflict、复用首次目标 id 且只保留一行')
  const second = await h.service.createWorkspace(actor, 'create-second', 'First workspace'); assert.notEqual(second.value.workspaceId, workspaceId, '不同 key 同名允许')
})
test('exactly one stored or supported workspace is the startup target', async t => {
  const h = await open(t, [workspace(A, '项目 A')])
  assert.deepEqual((await h.service.getWorkspaceSetup()).workspace, { id: A, name: '项目 A' })
  assert.equal((await h.service.listWorkspaces()).activeWorkspaceId, A); assert.equal((await baselineOf(h.host)).workspace.id, A)
  const legacy = await open(t, [workspace(C, '遗留不支持', 'manual_only'), workspace(B, '唯一可用')])
  assert.equal((await legacy.service.getWorkspaceSetup()).workspace.id, B, '不支持策略的遗留行不阻止唯一可用项目成为启动目标'); assert.equal((await legacy.service.listWorkspaces()).activeWorkspaceId, B)
})
test('multiple saved workspaces keep creation order, same display names and unsupported policy visible', async t => {
  const h = await open(t, [workspace(A, '同名'), workspace(B, '同名'), workspace(C, '另一项目', 'manual_only')])
  assert.deepEqual(await h.service.listWorkspaces(), { activeWorkspaceId: null, workspaces: [{ workspaceId: A, name: '同名', planning: 'none', policy: 'supported' },
    { workspaceId: B, name: '同名', planning: 'none', policy: 'supported' }, { workspaceId: C, name: '另一项目', planning: 'none', policy: 'unsupported' }] }, '同名不合并、创建序稳定、策略如实标注')
  assert.deepEqual(wire(await h.service.openWorkspace(B)), { state: 'activated', requestedWorkspaceId: B, activeWorkspaceId: B })
  assert.equal((await h.service.listWorkspaces()).activeWorkspaceId, B); assert.equal((await baselineOf(h.host)).workspace.id, B)
})
test('opening a missing workspace reports not_found while A stays active, readable and byte-identical', async t => {
  const h = await open(t, [workspace(A, '项目 A')]), before = dump(h.dataPath)
  assert.deepEqual(wire(await h.service.openWorkspace('missing-workspace')), { state: 'failed', requestedWorkspaceId: 'missing-workspace', activeWorkspaceId: A, error: { code: 'not_found', message: '项目不存在，请重新读取', recovery: 'open_provider', retryable: false } })
  assert.equal((await baselineOf(h.host)).workspace.id, A); assert.equal((await h.service.getWorkspaceSetup()).workspace.id, A)
  assert.deepEqual(dump(h.dataPath), before, '失败的作用域打开不得写库')
})
test('a settings write admitted on A is scoped out when B is opened in the same tick', async t => {
  const h = await open(t, [workspace(A, '项目 A'), workspace(B, '项目 B')])
  await h.service.openWorkspace(A); const before = dump(h.dataPath)
  const frames = h.service.watch(new AbortController().signal)[Symbol.asyncIterator]()
  assert.equal((await frames.next()).value.baseline.workspace.id, A); t.after(() => frames.return())
  const other = { ctx: { invocation: { peer: { id: 'other-peer' } } } }
  const [opened, write] = await Promise.all([h.service.openWorkspace.call(other, B), h.service.installExecutionBindings(actor, 'switch-window')])
  assert.deepEqual([opened.state, write.writeState, write.error.code], ['activated', 'conflict', 'conflict'], '切换窗口内的设置写必须被作用域拒绝')
  await assert.rejects(() => h.service.baseline(), /项目已切换，请重新读取/, '被排队切换拒绝的设置写不得确认 B')
  assert.deepEqual(dump(h.dataPath), before, '作用域拒绝不得写库'); assert.equal(h.host.activationError, undefined, '不得写全局 activationError')
  const baseline = await baselineOf(h.host)
  assert.equal(baseline.workspace.id, B); assert.notEqual(baseline.source.reason, 'unavailable', 'B 的 baseline 不得被 A 的装配失败标成 degraded')
  assert.equal((await h.host.call('getWorkspaceSetup', {})).activationError, undefined)
})
test('opening another workspace changes generation and watch publishes a gap then the new baseline', async t => {
  const h = await open(t, [workspace(A, '项目 A'), workspace(B, '项目 B')])
  assert.equal((await h.service.openWorkspace(A)).state, 'activated')
  const abort = new AbortController(), frames = h.service.watch(abort.signal)[Symbol.asyncIterator]()
  try {
    const first = (await frames.next()).value, initialGeneration = first.baseline.generation
    assert.equal(first.kind, 'baseline'); assert.equal(first.baseline.workspace.id, A)
    assert.equal((await h.service.openWorkspace(B)).state, 'activated')
    assert.equal((await frames.next()).value.kind, 'gap', '切换装配必须发 gap 而不是静默续传')
    assert.equal((await frames.next()).done, true)
    const restarted = h.service.watch(new AbortController().signal)[Symbol.asyncIterator]()
    try {
      const baseline = (await restarted.next()).value
      assert.equal(baseline.kind, 'baseline'); assert.equal(baseline.baseline.workspace.id, B)
      assert.notEqual(baseline.baseline.generation, initialGeneration); assert.notEqual((await baselineOf(h.host)).generation, initialGeneration)
    } finally { await restarted.return() }
  } finally { abort.abort(); await frames.return() }
})
test('client rejects frames from a superseded generation after the new baseline', async t => {
  const h = await open(t, [workspace(A, '项目 A'), workspace(B, '项目 B')])
  const readBaseline = async () => { const frames = h.service.watch(new AbortController().signal)[Symbol.asyncIterator](); try { return (await frames.next()).value.baseline } finally { await frames.return() } }
  await h.service.openWorkspace(A)
  const old = await readBaseline()
  await h.service.openWorkspace(B)
  const current = await readBaseline(), sync = createSync(createEntityStore())
  sync.receive({ kind: 'baseline', baseline: old }); sync.receive({ kind: 'baseline', baseline: current })
  assert.throws(() => sync.receive({ kind: 'metadata', metadata: toWireMetadata(old) }), /generation/, '旧 generation 的迟到帧必须被客户端拒绝')
})
test('real Gateway per-peer fence rejects a stale peer unary and recovers after its watch restarts', async t => {
  const root = await directory(t), profile = path.join(root, 'profile'); await mkdir(profile, { recursive: true })
  const dbPath = path.join(profile, 'harness-projects', 'workspace.sqlite')
  await seedRows(dbPath, [workspace(A, '项目 A'), workspace(B, '项目 B')])
  const ctx = new Context()
  let stopHost
  new TypertRegistry(ctx)
  const gateway = new Gateway(ctx, { websocketHeartbeatIntervalMs: 2000, streamInboxBytes: 262144 })
  ctx.provide('profileContext', { dir: profile, home: path.dirname(profile), name: path.basename(profile) })
  const fiber = ctx.inject([], (scope) => {
    const effect = scope.effect.bind(scope)
    scope.effect = (run, label) => { const dispose = effect(run, label); if (label === 'harness-projects: host composition') stopHost = dispose; return dispose }
    return applyHost(scope)
  })
  await fiber.await()
  const peer = (id) => ({ id, ctx, dispose: async () => {} })
  const invoke = (method, args, id) => gateway.invoke({ namespace: 'harnessProjects', method, args, peer: peer(id) })
  const stream = async (method, args, id) => (await gateway.stream({ namespace: 'harnessProjects', method, args, peer: peer(id) }))[Symbol.asyncIterator]()
  let disposal
  t.after(() => disposal ??= (async () => { await stopHost(); await fiber.dispose() })())
  assert.equal((await invoke('openWorkspace', { workspaceId: A }, 'peer-b')).state, 'activated')
  const frames = await stream('watch', {}, 'peer-a')
  const first = (await frames.next()).value
  assert.equal(first.kind, 'baseline'); assert.equal(first.baseline.workspace.id, A)
  assert.equal((await invoke('openWorkspace', { workspaceId: B }, 'peer-b')).state, 'activated')
  const before = dump(dbPath)
  await assert.rejects(() => invoke('baseline', {}, 'peer-a'), /项目已切换，请重新读取/, '旧 peer 的 unary 必须在 composition 之前被固定文案拒绝')
  assert.deepEqual(dump(dbPath), before, '被拒绝的旧 peer 请求不得写入任何行')
  assert.equal((await invoke('listWorkspaces', {}, 'peer-a')).activeWorkspaceId, B)
  assert.equal((await invoke('openWorkspace', { workspaceId: 'missing-workspace' }, 'peer-a')).state, 'failed')
  await assert.rejects(() => invoke('installExecutionBindings', { actorRef: actor, idempotencyKey: 'old-a-action' }, 'peer-a'), /项目已切换，请重新读取/, '目录读和失败切换不得让旧 peer 写入 B')
  assert.deepEqual(dump(dbPath), before, '旧 peer 没有收到 B 的确认时数据库保持不变')
  assert.equal((await invoke('baseline', {}, 'peer-b')).workspace.id, B, '没有 watch 记录的 peer 放行')
  await frames.return?.()
  const restarted = await stream('watch', {}, 'peer-a')
  try {
    const baseline = (await restarted.next()).value
    assert.equal(baseline.kind, 'baseline'); assert.equal(baseline.baseline.workspace.id, B)
    assert.equal((await invoke('baseline', {}, 'peer-a')).workspace.id, B, '重开流收到新 baseline 后同一 unary 通过')
  } finally { await restarted.return?.() }
})
test('a peer can read its own successful workspace confirmation and settings reassembly immediately', async t => {
  const h = await open(t, [workspace(A, '项目 A'), workspace(B, '项目 B')], undefined, PROVIDER_CATALOG)
  await h.service.openWorkspace(A)
  const frames = h.service.watch(new AbortController().signal)[Symbol.asyncIterator]()
  try {
    const first = (await frames.next()).value.baseline
    assert.equal((await h.service.openWorkspace(B)).state, 'activated')
    const opened = await h.service.baseline(); assert.equal(opened.workspace.id, B)
    assert.equal((await h.service.installExecutionBindings(actor, 'own-settings')).writeState, 'local_only')
    const configured = await h.service.baseline()
    assert.equal(configured.workspace.id, B); assert.notEqual(configured.generation, opened.generation); assert.notEqual(configured.generation, first.generation)
  } finally { await frames.return() }
})
test('a delayed transition response cannot acknowledge another peer queued activation', async t => {
  let release, confirmed
  const delayed = new Promise(resolve => { release = resolve }), reached = new Promise(resolve => { confirmed = resolve })
  const h = await open(t, [workspace(A, '项目 A'), workspace(B, '项目 B'), workspace(C, '项目 C')], (host) => ({
    ...host,
    call: async (...args) => {
      const result = await host.call(...args)
      if (args[0] === 'openWorkspace' && args[1].workspaceId === B) { confirmed(); await delayed }
      return result
    },
  }))
  await h.service.openWorkspace(A)
  const frames = h.service.watch(new AbortController().signal)[Symbol.asyncIterator]()
  try {
    assert.equal((await frames.next()).value.baseline.workspace.id, A)
    const own = h.service.openWorkspace(B)
    await reached
    const other = { ctx: { invocation: { peer: { id: 'other-peer' } } } }
    assert.equal((await h.service.openWorkspace.call(other, C)).state, 'activated')
    release(); assert.equal((await own).activeWorkspaceId, B)
    await assert.rejects(() => h.service.baseline(), /项目已切换，请重新读取/, '迟到的 B 确认不得把 peer 推进到未确认的 C')
  } finally { release(); await frames.return() }
})
