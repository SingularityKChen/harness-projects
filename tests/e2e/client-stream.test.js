/**
 * Batch 2 端到端：客户端对宿主流的每代协议（issue #276）与监督者的有界退避重开（#229）。
 * 流用宿主 RemoteStream 的替身（本机交叉核对时是真实类）驱动；离线、无凭据。
 */
import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { followWorkspace, superviseWorkspace } from '@harness-projects/client'
import { createConnection, loadRemoteStream } from '../fixtures/remote-stream-double.js'

const { RemoteStream, RemoteStreamCarrierError } = await loadRemoteStream()

const fresh = (revision) => ({ revision, freshness: 'fresh', authority: 'provider', reason: undefined })
const row = (revision, title) => ({
  entityId: 'entity-1', kind: 'work_item', planningStatus: 'todo', derived: [], source: fresh(revision),
  content: { contentKind: 'work_item', title, body: 'body', bindingId: 'binding-1', externalKind: 'issue', externalId: 'issue-1' },
})
const header = (revision) => ({ workspace: { id: 'workspace-1', name: 'Stream workspace' }, capabilities: [], source: fresh(revision) })
const baseline = (revision, title) => ({ kind: 'baseline', baseline: { ...header(revision), revision, entities: [row(revision, title)] } })
const delta = (previousRevision, revision, title) => ({
  kind: 'delta', delta: { ...header(revision), previousRevision, revision, upserts: [row(revision, title)], removed: [] },
})
const gap = { kind: 'gap', gap: { requestedAfter: 1, currentRevision: 1, reason: '脚本化 gap' } }

const until = async (predicate, what) => {
  for (let spin = 0; !predicate() && spin < 2000; spin += 1) await new Promise((resolve) => setImmediate(resolve))
  assert.ok(predicate(), `等待超时：${what}`)
}

/** 每代一份脚本：首帧前等 gate（可选），交付 frames 后正常结束（缺省）、抛出 throws，或挂起到本代被中止（hang）。 */
function scripted(generations) {
  const state = {
    opened: 0,
    open(signal) {
      const script = generations[state.opened] ?? { frames: [], hang: true }
      state.opened += 1
      return (async function* () {
        if (script.gate) await script.gate
        for (const frame of script.frames) { if (signal.aborted) return; yield frame }
        if (script.throws) throw script.throws
        if (script.hang && !signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      })()
    },
  }
  return state
}

function start(generations, options = {}) {
  const source = scripted(generations)
  const reports = []
  const follower = followWorkspace((carrierFailed) => new RemoteStream(createConnection(), {
    name: 'client-stream test', open: source.open, ended: () => new Error('script ended'), carrierFailed,
  }), { clock: () => '2026-10-15T00:00:00.000Z', onReport: (report, generation) => reports.push([report.kind, report.revision, generation]), ...options })
  return { follower, source, reports }
}

const titleOf = (follower) => follower.read().store.get('entity-1').entity.content.title
/** [标题, connected, 当前值]；无快照时 undefined。 */
const viewOf = (read) => read && [read.store.get('entity-1').entity.content.title, read.connection.connected, read.store.isCurrent('entity-1')]
const stale = (title) => [title, false, false]
const live = (title) => [title, true, true]

/**
 * 监督者 + 手动调度：schedule 只记录 { delayMs, run, cancelled }，何时重开由用例决定；前 refuse 次 connect 同步抛错。
 * notified 是每次通知时读到的快照；carrier 记录载体回调返回那一刻的 [快照, 最后一次通知]；disposed 依次记被释放句柄的序号。
 * throwing：onRetry 记录后抛错，另有一个排在 notified 之前、只在断开时抛错的订阅者。
 */
function supervised(generations, { refuse = 0, throwing = false, ...options } = {}) {
  const source = scripted(generations)
  const connection = createConnection()
  const [streams, timers, retries, reports, notified, carrier, disposed] = [[], [], [], [], [], [], []]
  const supervisor = superviseWorkspace((carrierFailed) => {
    if (refuse > 0) { refuse -= 1; throw new Error('connect 同步失败') }
    const stream = new RemoteStream(connection, {
      name: 'client-stream test', open: source.open, ended: () => new Error('script ended'),
      carrierFailed: () => { carrierFailed(); carrier.push([viewOf(supervisor.getSnapshot()), notified.at(-1)]) },
    })
    const [index, dispose] = [streams.length, stream.dispose.bind(stream)]
    stream.dispose = () => { disposed.push(index); return dispose() }
    streams.push(stream)
    return stream
  }, {
    clock: () => '2026-10-15T00:00:00.000Z',
    schedule: (delayMs, run) => { const timer = { delayMs, run, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true } },
    onRetry: (error, delayMs) => { retries.push([error, delayMs]); if (throwing) throw new Error('onRetry 抛错') },
    onReport: (report, generation) => reports.push([report.kind, generation]),
    ...options,
  })
  if (throwing) supervisor.subscribe(() => { if (supervisor.getSnapshot()?.connection.connected === false) throw new Error('订阅者抛错') })
  supervisor.subscribe(() => notified.push(viewOf(supervisor.getSnapshot())))
  return { supervisor, source, streams, timers, retries, reports, notified, carrier, disposed }
}

const violations = [
  ['第一帧是合法 delta 而不是 baseline', [delta(0, 1, 'x')], /第一帧不是 baseline/],
  ['同代出现第二个 baseline', [baseline(1, 'a'), baseline(1, 'b')], /第二个 baseline/],
  ['baseline 的 source 缺 freshness', [{ kind: 'baseline', baseline: { ...baseline(1, 'a').baseline, source: { revision: 1, authority: 'provider' } } }], /帧头不合契约/],
]

test('follow：每代第一帧必须是唯一的 baseline，违例与被拒的帧终止且不重开', async () => {
  for (const [name, frames, pattern] of violations) {
    const { follower, source } = start([{ frames }])
    await assert.rejects(follower.done, pattern, name)
    assert.equal(source.opened, 1, `${name}：终止，不重开`)
  }
})

test('follow：gap 先整表 stale 再重开下一代并接受新一代 baseline', async () => {
  const atGap = []
  const { follower, source, reports } = start(
    [{ frames: [baseline(1, 'a'), gap] }, { frames: [baseline(1, 'b')], hang: true }],
    { onGap: (_gap, store) => atGap.push(store.isCurrent('entity-1')) },
  )
  await until(() => reports.length === 3, '第 2 代 baseline')
  assert.deepEqual(reports, [['baseline', 1, 1], ['gap', 1, 1], ['baseline', 1, 2]])
  assert.deepEqual(atGap, [false], 'onGap 时旧值已经不是当前值')
  assert.deepEqual([source.opened, titleOf(follower), follower.read().store.isCurrent('entity-1')], [2, 'b', true])
  const closing = follower.close() // 吸收态从调用 close 的那一刻起：不等宿主那一代结束就断开并整表 stale，页面不会把停更的值当作当前值
  assert.deepEqual([follower.read().connection.connected, follower.read().store.isCurrent('entity-1')], [false, false])
  await closing
})

test('follow：close 之后迟到的帧不改 store', async () => {
  let follower
  const item = (value) => ({ generation: 1, value, accept() {} })
  const stream = Object.assign((async function* () { // 手写流：替身在 dispose 之后不再交付，这里让 close 落在已交付、未处理的窗口里
    yield item(baseline(1, 'a'))
    queueMicrotask(() => void follower.close())
    yield item(delta(1, 2, 'late'))
  })(), { restart() {}, dispose: async () => undefined })
  follower = followWorkspace(() => stream, { clock: () => '2026-10-15T00:00:00.000Z' })
  await follower.done
  assert.equal(titleOf(follower), 'a')
})

const terminations = [
  ['宿主结束一代', { frames: [baseline(1, 'a')] }, /script ended/],
  ['Host 侧读取失败', { frames: [baseline(1, 'a')], throws: new Error('harness-projects：操作失败，原因已写入宿主诊断日志') }, /操作失败/],
  ['不前进的 delta 被拒', { frames: [baseline(1, 'a'), delta(1, 1, 'x')], hang: true }, /严格前进/],
]

test('supervise：三种终止来源都保留 stale 的最后已知值，1 s 后以新 follower 重新跟随', async (t) => {
  const errors = []
  t.mock.method(console, 'error', (...args) => { errors.push(args.at(-1).message) })
  for (const throwing of [false, true]) for (const [origin, script, pattern] of terminations) {
    const name = throwing ? `${origin}（订阅者与 onRetry 抛错）` : origin
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const { supervisor, source, streams, timers, retries, notified, disposed } = supervised([script, { gate, frames: [baseline(2, 'b')], hang: true }], { throwing })
    await until(() => timers.length === 1, `${name}：排定重开`)
    assert.deepEqual([streams.length, timers[0].delayMs, disposed], [1, 1000, [0]], `${name}：排定前不重开，已终止的 follower 先释放句柄`)
    assert.match(retries[0][0].message, pattern, name)
    assert.deepEqual([viewOf(supervisor.getSnapshot()), notified.at(-1)], [stale('a'), stale('a')], `${name}：终止时发布断开`)
    assert.deepEqual(errors.splice(0), throwing ? ['订阅者抛错', 'onRetry 抛错'] : [], `${name}：调用方回调抛错只记一行，不挡后面的订阅者与排定重开`)
    assert.equal(supervisor.getSnapshot(), supervisor.getSnapshot(), `${name}：两次发布之间是同一快照`)
    timers[0].run()
    await until(() => source.opened === 2, `${name}：新 follower 打开下一代`)
    assert.deepEqual([streams.length, viewOf(supervisor.getSnapshot())], [2, stale('a')], `${name}：新 baseline 之前仍是最后已知值`)
    release()
    await until(() => supervisor.getSnapshot().connection.connected, `${name}：新 follower 的 baseline`)
    assert.deepEqual([viewOf(supervisor.getSnapshot()), timers.length], [live('b'), 1], name)
    await supervisor.close()
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual([timers.map((timer) => timer.cancelled), retries.length], [[false], 1], `${name}：本方 close 不算终止（不再 onRetry），也不取消已运行的那一次`)
    assert.deepEqual(disposed, [0, 1], `${name}：每个句柄恰好释放一次（终止的那个不被 close 再释放）`)
    assert.deepEqual(errors.splice(0), throwing ? ['订阅者抛错'] : [], `${name}：close 的发布同样只记一行，close 不抛`)
  }
})

test('supervise：退避 1→2→4→8→16→30→30 s，被接受的帧归零，close 取消待定重开', async () => {
  // 宿主结束一代与「开场即 gap」交替（#380）：开场 gap 是协议违例、按终止处理，从不作为被接受的帧回报，所以同样累加不归零
  const { supervisor, timers, retries, notified } = supervised([...Array.from({ length: 7 }, (_, index) => ({ frames: index % 2 ? [gap] : [] })), { frames: [baseline(1, 'a')] }])
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    await until(() => timers.length === attempt, `第 ${attempt} 次排定`)
    if (attempt < 8) timers[attempt - 1].run()
  }
  const backoff = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 1000] // 第 8 代先接受 baseline 再结束：从 1 s 重新起算
  assert.deepEqual([timers.map((timer) => timer.delayMs), retries.map(([, delayMs]) => delayMs)], [backoff, backoff])
  assert.match(retries[1][0].message, /第一帧不是 baseline/, '第 2 代是开场即 gap 的那种终止')
  const before = notified.length
  await Promise.all([supervisor.close(), supervisor.close()])
  assert.deepEqual(timers.map((timer) => timer.cancelled), [...Array(7).fill(false), true], 'close 只取消待定的那一次')
  assert.deepEqual([notified.length - before, notified.at(-1)], [1, stale('a')], 'close 幂等，只发布一次')
})

test('supervise：在终止的通知里同步 close 不再排定重开，之后没有新 follower', async () => {
  const { supervisor, timers } = supervised([{ frames: [baseline(1, 'a')] }])
  supervisor.subscribe(() => { if (supervisor.getSnapshot()?.connection.connected === false) void supervisor.close() }) // 在终止的发布里同步卸载：close 早于排定
  await until(() => supervisor.getSnapshot()?.connection.connected === false, '终止的发布')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(timers.length, 0, '没有排定的重开，close 之后不会再开 follower')
})

test('supervise：载体断开在同一回调内发布断开，同一句柄重连，不新建 follower', async () => {
  const { supervisor, source, streams, reports, carrier } = supervised(
    [{ frames: [baseline(1, 'a')], throws: new RemoteStreamCarrierError('socket closed') }, { frames: [baseline(2, 'b')], hang: true }],
    { schedule: () => assert.fail('载体断开不终止 follower，不排定重开') },
  )
  await until(() => carrier.length === 1 && supervisor.getSnapshot().connection.connected, '同一句柄上的下一代 baseline')
  assert.deepEqual(carrier, [[stale('a'), stale('a')]], '载体回调返回时快照与通知都已是断开、整表 stale')
  assert.deepEqual([viewOf(supervisor.getSnapshot()), streams.length, source.opened], [live('b'), 1, 2])
  assert.deepEqual(reports, [['baseline', 1], ['baseline', 2]], '调用方的 onReport 收到同一句柄上的两代')
  await supervisor.close()
})

test('supervise：connect 同步抛错只算一次终止，不向调用方抛出', async () => {
  const { supervisor, streams, timers, retries } = supervised([{ frames: [baseline(1, 'a')], hang: true }], { refuse: 2 })
  assert.deepEqual([supervisor.getSnapshot(), streams.length, timers.map((timer) => timer.delayMs)], [undefined, 0, [1000]], '首次 connect 抛错')
  timers[0].run()
  assert.deepEqual(timers.map((timer) => timer.delayMs), [1000, 2000], '重开时 connect 再抛错')
  timers[1].run()
  await until(() => supervisor.getSnapshot() !== undefined, 'connect 成功后的 baseline')
  assert.deepEqual([viewOf(supervisor.getSnapshot()), streams.length, timers.length], [live('a'), 1, 2])
  assert.deepEqual(retries.map(([error, delayMs]) => [error.message, delayMs]), [['connect 同步失败', 1000], ['connect 同步失败', 2000]])
  await supervisor.close()
})
