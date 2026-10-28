/**
 * Batch 1 端到端：controller 的一代宿主流（issue #276）。
 *
 * 一代 = 开场 baseline + 净 delta / metadata，gap 之后本代结束，中止之后不再读取。
 * 读取面是脚本化的快照序列，节拍由测试放行，不依赖真实 sleep。
 */
import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { diffSnapshots, streamWorkspace, toWireMetadata } from '@harness-projects/controller'
import { wire } from '../fixtures/work-item-wire.mjs'

/** 第 n 次读返回第 n 份快照（读完停在最后一份），`reads` 计数。 */
const scripted = (...snapshots) => {
  const source = { reads: 0, baseline: async () => snapshots[Math.min((source.reads += 1), snapshots.length) - 1] }
  return source
}
/** 一个修订上的快照：两条工作项的标题与整表来源可变，其余固定。 */
const snapshot = (revision, title, freshness = 'fresh', reason = undefined) => ({
  generation: 'host-a', revision, capabilities: [], workspace: { id: 'workspace-1', name: '脚本化' }, source: { revision, freshness, authority: 'host', reason },
  entities: ['ent-a', 'ent-b'].map((id) => wire(id, { content: { title }, source: { revision } })),
})

/**
 * 立即放行、20 个 tick 之后中止本代并收下全部帧：该出现的帧没出现时本代结束、断言失败，
 * 而不是在微任务里自旋（自旋饿死计时器，--test-timeout 也救不了）。
 */
async function generation(source) {
  const bound = new AbortController()
  let ticks = 0
  const frames = []
  for await (const frame of streamWorkspace(source, { signal: bound.signal, intervalMs: 0, wait: async () => { if ((ticks += 1) > 20) bound.abort() } })) frames.push(frame)
  return frames
}

test('stream：开场 baseline 之后按节拍产出 controller 的事件（#178、#276）', async (t) => {
  const [a1, b3, b1, degraded] = [snapshot(1, 'a'), snapshot(3, 'b'), snapshot(1, 'b'), snapshot(1, 'a', 'degraded', '来源降级')]
  const cases = [
    ['两次写入只产出一条跨两修订的净 delta', b3, { kind: 'delta', delta: diffSnapshots(a1, b3) }],
    ['同修订业务变化产出 gap 后本代结束', b1, { kind: 'gap', gap: { requestedAfter: 1, currentRevision: 1, reason: '修订 1 上的业务字段变化了，不能当作来源更新' } }],
    ['同修订只有来源降级产出 metadata 而不是 gap，之后没有多余帧', degraded, { kind: 'metadata', metadata: toWireMetadata(degraded) }],
  ]
  for (const [name, next, frame] of cases) {
    await t.test(name, async () => assert.deepEqual(await generation(scripted(a1, next)), [{ kind: 'baseline', baseline: a1 }, frame]))
  }
})

test('stream：停在等待上中止后不再读取，开始前已中止则一次都不读', async () => {
  const source = scripted(snapshot(1, 'a'))
  const abort = new AbortController()
  let parked = false
  const wait = (_ms, signal) => new Promise((resolve) => { parked = true; signal.addEventListener('abort', resolve, { once: true }) })
  const stream = streamWorkspace(source, { signal: abort.signal, intervalMs: 1000, wait })
  assert.equal((await stream.next()).value.kind, 'baseline')
  const pending = stream.next()
  assert.ok(parked, '生成器停在等待上')
  abort.abort()
  assert.deepEqual([(await pending).done, source.reads], [true, 1])

  const spent = scripted(snapshot(1, 'a'))
  assert.deepEqual([(await streamWorkspace(spent, { signal: AbortSignal.abort(), intervalMs: 0 }).next()).done, spent.reads], [true, 0])
})

test('stream：缺省等待可中止，停在等待上的 next() 在中止后立即以 done 结算', async () => {
  const abort = new AbortController()
  const stream = streamWorkspace(scripted(snapshot(1, 'a')), { signal: abort.signal, intervalMs: 60_000 })
  assert.equal((await stream.next()).value.kind, 'baseline')
  const pending = stream.next()
  abort.abort()
  let timer
  const bound = new Promise((resolve) => { timer = setTimeout(resolve, 1000, '1 s 内没有结算') })
  try {
    assert.deepEqual(await Promise.race([pending, bound]), { done: true, value: undefined })
  } finally {
    clearTimeout(timer)
  }
})

for (const revision of [0, 1, 2]) test(`stream：Host generation 在 revision ${revision} 切换时先 gap`, async () => {
  const base = { ...snapshot(1, 'a'), generation: 'host-a' }, next = { ...snapshot(revision, 'a'), generation: 'host-b' }
  const frames = await generation(scripted(base, next))
  assert.equal(frames.length, 2); assert.equal(frames[1].kind, 'gap')
  assert.match(frames[1].gap.reason, /generation/)
})
