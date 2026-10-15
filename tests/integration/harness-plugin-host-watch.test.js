/**
 * Host watch 流的宿主侧端到端（#276）：真实 `createHostComposition`（种子库 + 只含 `harness.fake` 的测试目录）、真实
 * `installHostRemote` 服务、JSON 往返的载体与 RemoteStream 替身（本机设 `HARNESS_GATEWAY_CLIENT` 换成真实类），客户端经
 * `openWorkspaceWatch` 接线；离线、无凭据。保护：同句柄同一代先 baseline 后 delta、断流即 stale 且同句柄重拉、卸载先中止流再关库、
 * Host 异常只上固定文案、提前 return 结束内层一代、空数据根不终止。种子只经 A 的共享夹具 `host-seed.js` 写入。
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { diffSnapshots } from '@harness-projects/controller'
import { fixtureProjectRef } from '@harness-projects/provider-fake'
import { SqliteStorage } from '@harness-projects/storage-sqlite'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { catalogOf } from '../../apps/harness-plugin/src/host-providers.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { openWorkspaceWatch } from '../../apps/harness-plugin/src/workspace-watch.ts'
import { createCarrier, createConnection, loadRemoteStream } from '../fixtures/remote-stream-double.js'
import { WORKSPACE, fakePlanningEntry, mount, seed, seedWorkspace } from './fixtures/host-seed.js'

const json = (value) => JSON.parse(JSON.stringify(value))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const within = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`超过 ${ms}ms`)), ms).unref())])
const DISCONNECTED = '与宿主的连接已断开，显示的是最后已知值'
/** 客户端读数的可比较摘要：连接、行数、当前行数、原因与最后更新时间。 */
const readout = ({ connection, store, reason, lastUpdatedAt: at }) =>
  ({ connected: connection.connected, rows: store.list().length, current: store.list().filter((row) => store.isCurrent(row.entityId)).length, reason, at })
/** 有上限的轮询等待：每轮 5ms，至多 400 轮。 */
async function until(predicate, what) {
  for (let round = 0; round < 400 && !predicate(); round += 1) await sleep(5)
  assert.ok(predicate(), `等待超时：${what}`)
}

/** 全部装置：A 的选项、种子夹具、宿主侧服务、载体与客户端接线；A 的选项再变时只改这里。 */
async function open(t, { seed: seeded = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'harness-host-watch-'))
  const dataDir = path.join(root, 'harness-projects')
  const dataPath = path.join(dataDir, 'workspace.sqlite')
  let planning
  const catalog = catalogOf([fakePlanningEntry((provider) => { planning = provider })])
  if (seeded) await seed(dataPath, catalog, async (storage) => { await seedWorkspace(storage); await storage.putProviderBinding(mount('00000000-0000-4000-8000-0000000000b1', 'planning', 'harness.fake')) })
  const host = await createHostComposition({ dataPath, workspaceId: WORKSPACE, catalog, resolveCredential: async () => undefined, watchIntervalMs: 5 })
  const installed = await installHostRemote({ provide: () => () => {}, typert: { register: () => () => {} } }, host)
  const { RemoteStream, RemoteStreamCarrierError } = await loadRemoteStream()
  const connection = createConnection()
  const carrier = createCarrier(RemoteStreamCarrierError)
  const [streams, logs, lost] = [[], [], []]
  let follower
  t.mock.method(console, 'info', (...args) => {
    logs.push(args.join(' '))
    if (logs.at(-1) === '[harness-projects] watch carrier lost') lost.push(readout(follower.read())) // 载体失败回调内同步拍下客户端读数
  })
  t.mock.method(console, 'error', () => {})
  follower = openWorkspaceWatch({
    remote: {
      $stream: (options) => streams[streams.push(new RemoteStream(connection, options)) - 1],
      harnessProjects: { watch: (signal) => carrier.open(installed.service, signal) },
    },
  })
  const state = { ended: undefined }
  follower.done.then(() => { state.ended = 'resolved' }, (error) => { state.ended = error })
  t.after(async () => { // 清理自己有上限：被破坏的实现下流关不掉，兜底的卸载中止让轮询计时器退出，进程不挂住
    await within(follower.close(), 2000).catch(() => undefined)
    await within(installed.dispose(), 2000).catch(() => undefined)
    host.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const baselineAt = (generation) => logs.some((line) => new RegExp(`^\\[harness-projects\\] watch baseline r=\\d+ gen=${generation}$`).test(line))
  return { host, installed, carrier, connection, streams, logs, lost, follower, state, dataDir, baselineAt, planning: () => planning }
}

test('host watch：同一句柄同一代先 baseline、规划变更后 delta，帧只是 controller 值的 JSON（AC1-S2、AC3）', async (t) => {
  const h = await open(t)
  await until(() => h.baselineAt(1), '开场 baseline')
  const b1 = await h.host.controller.baseline()
  h.planning().addItem(fixtureProjectRef(h.planning().bindingId), 'issue', '新增条目', '正文')
  await h.installed.service.bootstrapWorkspace({ kind: 'agent', id: 'host-watch' }, 'host-watch-1')
  await until(() => h.logs.includes(`[harness-projects] watch delta r=${b1.revision + 1} gen=1`), 'delta')
  assert.deepEqual([h.streams.length, h.carrier.opened, h.carrier.frames.length], [1, 1, 2])
  assert.deepEqual(h.carrier.frames[0], { kind: 'baseline', baseline: json(b1) })
  assert.deepEqual(h.carrier.frames[1], { kind: 'delta', delta: json(diffSnapshots(b1, await h.host.controller.baseline())) })
})

test('host watch：载体断开的同一回调内整表 stale，重连在同一句柄上重拉 baseline（AC2）', async (t) => {
  const h = await open(t)
  await until(() => h.baselineAt(1), '开场 baseline')
  const before = readout(h.follower.read())
  const [first] = h.follower.read().store.list()
  const entry = h.follower.read().store.get(first.entityId)
  h.connection.setOnline(false)
  h.carrier.break()
  await until(() => h.lost.length === 1, '载体失败回调')
  assert.deepEqual(h.lost[0], { ...before, connected: false, current: 0, reason: DISCONNECTED })
  h.connection.setOnline(true)
  await until(() => h.baselineAt(2), '重连后的 baseline')
  const after = h.follower.read()
  assert.deepEqual([h.streams.length, h.carrier.opened, after.store.get(first.entityId) === entry, after.store.isCurrent(first.entityId), after.connection.connected], [1, 2, true, true, true])
  for (const generation of [3, 4]) { // 在线连续两次载体失败：开场 baseline 被接受会清零重试计数，所以流不终止
    h.carrier.break()
    await until(() => h.baselineAt(generation), `第 ${generation} 代 baseline`)
  }
  assert.equal(h.state.ended, undefined)
})

test('host watch：卸载中止打开的流，客户端终止并保留 stale 的最后已知值，SQLite 只关一次', async (t) => {
  const h = await open(t)
  await until(() => h.baselineAt(1), '开场 baseline')
  const close = t.mock.method(SqliteStorage.prototype, 'close')
  const reads = t.mock.method(h.host.controller, 'baseline')
  const before = readout(h.follower.read())
  await within(h.installed.dispose(), 1000)
  await assert.rejects(h.follower.done, /在 gap 之外结束/)
  assert.deepEqual(readout(h.follower.read()), { ...before, connected: false, current: 0, reason: DISCONNECTED })
  h.host.dispose()
  assert.equal(close.mock.callCount(), 1)
  assert.throws(() => h.host.watch(new AbortController().signal), /已关闭/)
  const count = reads.mock.callCount()
  await sleep(30)
  assert.equal(reads.mock.callCount(), count, '卸载后不再读库')
})

test('host watch：Host 侧读取异常经漏斗只以固定文案终止，诊断日志多一行 operationFailed 且不含路径', async (t) => {
  const h = await open(t)
  await until(() => h.baselineAt(1), '开场 baseline')
  const diagnostics = () => readFile(path.join(h.dataDir, 'diagnostics.log'), 'utf8').catch(() => '')
  const failures = async () => (await diagnostics()).split('\n').filter((line) => line.includes('"operationFailed"')).length
  const before = await failures()
  t.mock.method(h.host.controller, 'baseline', async () => { throw new Error(`读取失败：${h.dataDir}`) })
  await assert.rejects(h.follower.done, (error) => error.message === 'harness-projects：操作失败，原因已写入宿主诊断日志')
  assert.equal(await failures(), before + 1)
  assert.ok(!(await diagnostics()).includes(h.dataDir), '诊断日志不含路径')
  assert.equal(h.carrier.opened, 1, '非载体错误不重开')
})

test('host watch：消费者提前 return 会结束内层一代，不再等下一次轮询', async (t) => {
  const h = await open(t)
  const live = new AbortController()
  t.after(() => live.abort()) // 变异下内层一代不会自己结束，兜底中止让轮询计时器退出
  const frames = h.host.watch(live.signal)[Symbol.asyncIterator]()
  assert.equal((await frames.next()).value.kind, 'baseline')
  await frames.return()
  assert.deepEqual(await Promise.race([frames.next(), sleep(100).then(() => '内层一代没有结束')]), { done: true, value: undefined })
})

test('host watch：空数据根只有 r=0、无工作区的 baseline，read() 保持 undefined，流不终止', async (t) => {
  const h = await open(t, { seed: false })
  await until(() => h.logs.includes('[harness-projects] watch baseline r=0 gen=1'), 'r=0 的 baseline')
  const [frame] = h.carrier.frames
  assert.deepEqual([frame.kind, frame.baseline.revision, frame.baseline.workspace, frame.baseline.entities], ['baseline', 0, undefined, []])
  const reads = t.mock.method(h.host.controller, 'baseline')
  await until(() => reads.mock.callCount() >= 3, '又过了几个 tick')
  assert.deepEqual([h.follower.read(), h.carrier.frames.length, h.state.ended], [undefined, 1, undefined])
})
