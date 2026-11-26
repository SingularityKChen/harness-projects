/** 重开恢复（#693）的 Host 组合判别测试：偏好闭集与崩溃安全、启动选择/失败降级、不覆盖偏好、切换不写业务行。 */
import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createEntityStore, createSync } from '@harness-projects/client'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { catalogOf } from '../../apps/harness-plugin/src/host-providers.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { dump, fakePlanningEntry, seed } from './fixtures/host-seed.js'

const A = '00000000-0000-4000-8000-0000000003a1', B = '00000000-0000-4000-8000-0000000003b2', C = '00000000-0000-4000-8000-0000000003c3'
const actor = { kind: 'user' }, wire = (value) => JSON.parse(JSON.stringify(value))
const workspace = (id, name, statusPolicy = 'provider_authoritative') => ({ id, name, statusPolicy })
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const SELECTION = 'workspace-selection.json'
const selectionPath = (dataPath) => path.join(path.dirname(dataPath), SELECTION)
const selectionBytes = async (dataPath) => readFile(selectionPath(dataPath), 'utf8')
const selectionOf = async (dataPath) => JSON.parse(await selectionBytes(dataPath))
async function directory(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'host-reopen-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
const seedRows = (dataPath, rows) => seed(dataPath, new Map(), async (storage) => { for (const row of rows) await storage.putWorkspace(row) })
/** 真实 composition + 真实 remote；同 dataPath 再 boot 一次即「重开 Host」。options 可覆盖显式初始目标等。 */
async function boot(t, dataPath, options = {}) {
  const host = await createHostComposition({ dataPath, catalog: new Map(), resolveCredential: async () => undefined, watchIntervalMs: 5, ...options })
  const installed = await installHostRemote({ invocation: { peer: { id: 'fixture-peer' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  const close = async () => { host.stop(); await installed.dispose(); await host.dispose() }
  t.after(close)
  return { host, service: installed.service, close }
}
async function open(t, rows, options = {}) {
  const root = await directory(t), dataPath = path.join(root, 'workspace.sqlite')
  await seedRows(dataPath, rows)
  return { dataPath, ...await boot(t, dataPath, options) }
}
const setupOf = (h) => h.service.getWorkspaceSetup()

test('a successful open writes only the closed preference and a fresh Host restores that project', async (t) => {
  const h = await open(t, [workspace(A, '项目 A'), workspace(B, '项目 B')])
  assert.equal((await setupOf(h)).workspace, null, '无偏好且有两个已存项目：空装配（Home）')
  assert.equal((await setupOf(h)).restore, undefined, '没有失效偏好时不带 restore')
  assert.deepEqual(wire(await h.service.openWorkspace(B)), { state: 'activated', requestedWorkspaceId: B, activeWorkspaceId: B })
  const text = await selectionBytes(h.dataPath), value = JSON.parse(text)
  assert.deepEqual(Object.keys(value), ['version', 'workspaceId', 'confirmedAt'], '严格闭集：只有三个键')
  assert.equal(value.version, 1); assert.equal(value.workspaceId, B); assert.match(value.confirmedAt, ISO)
  assert.doesNotMatch(text, /项目 A|项目 B|harness-projects|workspace\.sqlite|filter|column/, '只存不透明 id 与时间')
  if (process.platform !== 'win32') assert.equal((await stat(selectionPath(h.dataPath))).mode & 0o777, 0o600, '偏好文件必须是 0600')
  const before = await selectionBytes(h.dataPath)
  assert.equal((await h.service.openWorkspace(B)).state, 'activated')
  assert.equal(await selectionBytes(h.dataPath), before, 'no-op 打开不重写偏好')
  await h.close()
  const restarted = await boot(t, h.dataPath)
  const setup = await setupOf(restarted)
  assert.deepEqual(setup.workspace, { id: B, name: '项目 B' }, '重开恢复最后成功确认的项目')
  assert.equal(setup.restore, undefined, '恢复成功后不带 restore')
  assert.equal((await restarted.host.call('baseline', {})).workspace.id, B)
})

test('missing preference falls back to the single stored workspace without a restore kind', async (t) => {
  const h = await open(t, [workspace(A, '项目 A')])
  const setup = await setupOf(h)
  assert.deepEqual(setup.workspace, { id: A, name: '项目 A' }, '无偏好时保留「唯一已存」启动兼容')
  assert.equal(setup.restore, undefined)
})

test('a corrupt preference yields Home with restore=corrupt and never opens the unique stored project', async (t) => {
  const root = await directory(t), dataPath = path.join(root, 'workspace.sqlite')
  await seedRows(dataPath, [workspace(A, '项目 A')])
  await writeFile(selectionPath(dataPath), JSON.stringify({ version: 1, workspaceId: A, confirmedAt: '2026-11-25T00:00:00.000Z', extra: true }), { mode: 0o600 })
  const h = await boot(t, dataPath)
  const setup = await setupOf(h)
  assert.equal(setup.workspace, null, '偏好损坏不得回退到「恰好一个」项目')
  assert.deepEqual(setup.restore, { kind: 'corrupt' })
  assert.equal((await h.service.listWorkspaces()).activeWorkspaceId, null)
  assert.equal((await h.host.call('baseline', {})).workspace, undefined, '仍是空装配（Home）')
  assert.equal(JSON.parse(await selectionBytes(dataPath)).extra, true, '不删除、不覆盖失效偏好')
  assert.equal((await h.service.openWorkspace(A)).state, 'activated')
  assert.equal((await setupOf(h)).restore, undefined, '成功激活后清空 restore')
  assert.equal((await selectionOf(dataPath)).workspaceId, A)
})

test('a stale preference (deleted target) yields Home with restore=stale and no fallback', async (t) => {
  const root = await directory(t), dataPath = path.join(root, 'workspace.sqlite')
  await seedRows(dataPath, [workspace(A, '项目 A')])
  await writeFile(selectionPath(dataPath), JSON.stringify({ version: 1, workspaceId: '00000000-0000-4000-8000-0000000009f9', confirmedAt: '2026-11-25T00:00:00.000Z' }), { mode: 0o600 })
  const h = await boot(t, dataPath)
  const setup = await setupOf(h)
  assert.deepEqual(setup.restore, { kind: 'stale' })
  assert.equal(setup.workspace, null, '目标已删：不回退到其它已存项目')
  assert.equal((await h.host.call('baseline', {})).workspace, undefined)
})

test('an unsupported policy preference yields Home with restore=unsupported and does not stop the Host', async (t) => {
  const root = await directory(t), dataPath = path.join(root, 'workspace.sqlite')
  await seedRows(dataPath, [workspace(A, '项目 A'), workspace(C, '遗留项目', 'manual_only')])
  await writeFile(selectionPath(dataPath), JSON.stringify({ version: 1, workspaceId: C, confirmedAt: '2026-11-25T00:00:00.000Z' }), { mode: 0o600 })
  const h = await boot(t, dataPath)
  const setup = await setupOf(h)
  assert.deepEqual(setup.restore, { kind: 'unsupported' })
  assert.equal(setup.workspace, null)
  assert.equal((await h.service.listWorkspaces()).activeWorkspaceId, null, '不支持策略的偏好不得被打开')
  assert.equal((await h.host.call('baseline', {})).workspace, undefined)
  assert.deepEqual(wire((await h.service.listWorkspaces()).workspaces.map((row) => [row.workspaceId, row.policy])), [[A, 'supported'], [C, 'unsupported']], 'Home 如实标注策略')
})

test('a preference read failure degrades to Home with restore=unreadable instead of failing startup', async (t) => {
  const h = await open(t, [workspace(A, '项目 A'), workspace(B, '项目 B')])
  await h.service.openWorkspace(A)
  await h.close()
  const fsOpen = fs.openSync, fsRead = fs.readSync
  let selectionFd
  t.mock.method(fs, 'openSync', function (file, ...args) { const fd = fsOpen.call(this, file, ...args); if (typeof file === 'string' && file.endsWith(SELECTION)) selectionFd = fd; return fd })
  t.mock.method(fs, 'readSync', function (fd, ...args) { if (fd === selectionFd) throw Object.assign(new Error('io'), { code: 'EIO' }); return fsRead.call(this, fd, ...args) })
  const restarted = await boot(t, h.dataPath)
  const setup = await setupOf(restarted)
  assert.deepEqual(setup.restore, { kind: 'unreadable' })
  assert.equal(setup.workspace, null, '读取失败不得猜测项目')
})

test('explicit initial target outranks the preference and does not rewrite it', async (t) => {
  const h = await open(t, [workspace(A, '项目 A'), workspace(B, '项目 B')])
  await h.service.openWorkspace(B)
  assert.equal((await selectionOf(h.dataPath)).workspaceId, B)
  await h.close()
  const explicit = await boot(t, h.dataPath, { workspaceId: A })
  assert.equal((await setupOf(explicit)).workspace.id, A, '显式选项 > 偏好')
  assert.equal((await selectionOf(h.dataPath)).workspaceId, B, '显式选项不重写偏好')
  await explicit.close()
  const restarted = await boot(t, h.dataPath)
  assert.equal((await setupOf(restarted)).workspace.id, B, '偏好仍指向最后一次成功确认的项目')
})

test('a failed switch keeps the previous preference; a preference write failure never fails the switch', async (t) => {
  const fsOpen = fs.openSync, fsWrite = fs.writeSync
  let selectionFd
  t.mock.method(fs, 'openSync', function (file, ...args) { const fd = fsOpen.call(this, file, ...args); if (typeof file === 'string' && file.endsWith(SELECTION)) selectionFd = fd; return fd })
  const h = await open(t, [workspace(A, '项目 A'), workspace(B, '项目 B'), workspace(C, '遗留项目', 'manual_only')])
  assert.equal((await h.service.openWorkspace(A)).state, 'activated')
  const confirmed = await selectionBytes(h.dataPath)
  const failed = await h.service.openWorkspace(C)
  assert.deepEqual([failed.state, failed.error.code], ['failed', 'not_supported'], '切换失败以作用域错误返回')
  assert.equal(await selectionBytes(h.dataPath), confirmed, '失败的切换不覆盖偏好')
  // 在第一次覆盖写注入失败：旧偏好逐字保留，能判别「写失败只记诊断、不失败切换」；旧实现的「先截断」会留下 0 字节。
  t.mock.method(fs, 'writeSync', function (fd, ...args) { if (fd === selectionFd) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); return fsWrite.call(this, fd, ...args) })
  assert.equal((await h.service.openWorkspace(B)).state, 'activated', '偏好写失败不影响本次切换结果')
  assert.equal((await setupOf(h)).workspace.id, B); assert.equal((await h.host.call('baseline', {})).workspace.id, B)
  assert.equal(await selectionBytes(h.dataPath), confirmed, '写失败时旧偏好逐字保留（不声称已持久化）')
  assert.match(await readFile(path.join(path.dirname(h.dataPath), 'diagnostics.log'), 'utf8'), /"event":"selectionWriteFailed"/, '写失败只进宿主诊断日志')
  await h.close()
  const restarted = await boot(t, h.dataPath)
  assert.equal((await setupOf(restarted)).workspace.id, A, '重开按旧偏好恢复，不假装记住了失败的 B')
})

test('switching writes only the navigation preference: no business row changes', async (t) => {
  const h = await open(t, [workspace(A, '项目 A'), workspace(B, '项目 B')])
  await h.service.openWorkspace(A)
  const before = dump(h.dataPath)
  await h.service.openWorkspace(B); await h.service.openWorkspace(A)
  assert.deepEqual(dump(h.dataPath), before, '切换只是导航：库内除偏好文件外没有任何写入')
})

const sourceAt = (revision) => ({ revision, freshness: 'fresh', authority: 'provider', reason: undefined })
const rowAt = (revision, title) => ({ entityId: 'shared-item', kind: 'work_item', planningStatus: 'todo', derived: [], source: sourceAt(revision),
  content: { contentKind: 'visible', title, body: undefined, bindingId: 'binding-1', externalKind: undefined, externalId: undefined } })
const baselineAt = (workspaceId, generation, revision, title) => ({ generation, workspace: { id: workspaceId, name: workspaceId }, capabilities: [], source: sourceAt(revision), revision, entities: [rowAt(revision, title)] })

test('the new baseline wins over a lower revision with the same item id and a late old-generation frame is rejected', async (t) => {
  const sync = createSync(createEntityStore())
  assert.equal(sync.receive({ kind: 'baseline', baseline: baselineAt(A, 'generation-a', 5, 'A 的条目') }).kind, 'baseline')
  assert.equal(sync.receive({ kind: 'baseline', baseline: baselineAt(B, 'generation-b', 2, 'B 的条目') }).kind, 'baseline', '切换后新 generation 的更低修订 baseline 必须整体替换')
  const read = sync.read()
  assert.equal(read.store.list().length, 1, 'A/B 相同 item id 不产生两行')
  assert.equal(read.store.get('shared-item').entity.content.title, 'B 的条目')
  assert.throws(() => sync.receive({ kind: 'metadata', metadata: { ...baselineAt(A, 'generation-a', 5, 'A 的条目'), revision: 5, entities: [{ entityId: 'shared-item', source: sourceAt(5) }] } }), /generation/)
  assert.equal(sync.read().store.get('shared-item').entity.content.title, 'B 的条目', '迟到 A 帧不落地')
  assert.equal(sync.read().workspace.id, B)
})
test('a preferred project that fails to assemble degrades to the safe Home instead of rejecting startup', async (t) => {
  const root = await directory(t), dataPath = path.join(root, 'workspace.sqlite')
  let broken = true
  const entry = fakePlanningEntry((provider) => {
    if (broken) { broken = false; provider.describeCapabilities = () => new Promise(() => {}) }
    return provider
  })
  entry.configuration = { projectNodeId: { kind: 'string', required: true, pattern: '.+', maxLength: 100 } }
  const catalog = catalogOf([entry])
  await seed(dataPath, catalog, async (storage) => {
    await storage.putWorkspace(workspace(A, '项目 A'))
    await storage.putWorkspace(workspace(B, '项目 B'))
    await storage.putProviderBinding({ id: 'planning-b', workspaceId: B, domain: 'planning', implementationKey: 'harness.fake', enabled: true, isDefault: true })
    await storage.putBindingConfiguration({ ref: { workspaceId: B, bindingId: 'planning-b', domain: 'planning' }, configuration: { projectNodeId: 'proj-b' } })
  })
  const preference = JSON.stringify({ version: 1, workspaceId: B, confirmedAt: '2026-11-25T00:00:00.000Z' })
  await writeFile(selectionPath(dataPath), preference, { mode: 0o600 })
  const h = await boot(t, dataPath, { catalog, planningReadTimeoutMs: 100 })
  const setup = await setupOf(h)
  assert.equal(setup.workspace, null, '偏好装配失败：安全 Home，而不是整个 Host 启动被拒')
  assert.deepEqual(setup.restore, { kind: 'failed' })
  assert.equal(await selectionBytes(dataPath), preference, '装配失败不删除、不覆盖偏好')
  assert.equal((await h.service.openWorkspace(A)).state, 'activated', '其它已存项目仍可显式打开')
})
test('a crash before the full overwrite leaves corrupt, never a silent "no preference"', async (t) => {
  const root = await directory(t), dataPath = path.join(root, 'workspace.sqlite')
  await seedRows(dataPath, [workspace(A, '项目 A'), workspace(B, '项目 B')])
  const fsOpen = fs.openSync, fsWrite = fs.writeSync
  let selectionFd
  t.mock.method(fs, 'openSync', function (file, ...args) { const fd = fsOpen.call(this, file, ...args); if (typeof file === 'string' && file.endsWith(SELECTION)) selectionFd = fd; return fd })
  t.mock.method(fs, 'writeSync', function (fd, bytes, ...args) {
    if (fd !== selectionFd) return fsWrite.call(this, fd, bytes, ...args)
    fsWrite.call(this, fd, bytes, 0, Math.floor(bytes.length / 2), 0)
    throw Object.assign(new Error('crash'), { code: 'EIO' })
  })
  const h = await boot(t, dataPath)
  assert.equal((await h.service.openWorkspace(A)).state, 'activated', '写失败不影响本次切换结果')
  await h.close()
  t.mock.restoreAll()
  const restarted = await boot(t, dataPath)
  const setup = await setupOf(restarted)
  assert.deepEqual(setup.restore, { kind: 'corrupt' }, '部分写入按 corrupt 降级，而不是「无偏好」')
  assert.equal(setup.workspace, null, '损坏偏好不得静默打开唯一已存项目')
})
test('the preference file is a strict closed set: version, keys, field bounds, time shape and size', async (t) => {
  const root = await directory(t), dataPath = path.join(root, 'workspace.sqlite')
  await seedRows(dataPath, [workspace(A, '项目 A')])
  const at = '2026-11-25T00:00:00.000Z'
  for (const text of [
    JSON.stringify({ version: 2, workspaceId: A, confirmedAt: at }),
    JSON.stringify({ version: 1, workspaceId: A, confirmedAt: at, extra: true }),
    JSON.stringify({ version: 1, workspaceId: 'x'.repeat(257), confirmedAt: at }),
    JSON.stringify({ version: 1, workspaceId: A, confirmedAt: '2026-11-25T00:00:00Z' }),
    JSON.stringify({ version: 1, workspaceId: A, confirmedAt: at }) + ' '.repeat(4096),
  ]) {
    await writeFile(selectionPath(dataPath), text, { mode: 0o600 })
    const h = await boot(t, dataPath)
    const setup = await setupOf(h)
    assert.deepEqual(setup.restore, { kind: 'corrupt' }, text.slice(0, 48))
    assert.equal(setup.workspace, null, '损坏偏好不得回退到唯一已存项目')
    await h.close()
  }
})
