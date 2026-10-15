/**
 * Batch 2 端到端：客户端对宿主流的每代协议（issue #276）。流用宿主 RemoteStream 的替身（本机交叉核对时是真实类）驱动；
 * 离线、无凭据。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { followWorkspace } from '@harness-projects/client'
import { createConnection, loadRemoteStream } from '../fixtures/remote-stream-double.js'

const { RemoteStream } = await loadRemoteStream()

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

/** 每代一份脚本：交付 frames 后正常结束（缺省），或挂起到本代被中止（hang）。 */
function scripted(generations) {
  const state = {
    opened: 0,
    open(signal) {
      const script = generations[state.opened] ?? { frames: [], hang: true }
      state.opened += 1
      return (async function* () {
        for (const frame of script.frames) { if (signal.aborted) return; yield frame }
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
