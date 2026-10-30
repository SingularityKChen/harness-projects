import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { apply } from '../../apps/harness-plugin/src/client.ts'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const turn = () => new Promise(resolve => setImmediate(resolve))
const at = '2026-10-30T00:00:00Z'
const setup = state => ({ workspace: { id: 'workspace', name: 'Current workspace' }, planning: { state, bindingId: 'binding', projectNodeId: 'project' } })
async function open(t, state = 'configured') {
  let Panel, receive, lost, stopped = false, current = setup(state), generation = 0
  const queue = [], cleanups = [], calls = []
  const emit = value => receive ? (receive({ done: false, value }), receive = undefined) : queue.push(value)
  const remote = { getWorkspaceSetup: async (...args) => { calls.push(['setup', ...args]); return { ok: true, value: current } }, watch: signal => signal }
  const child = { effect: run => { cleanups.push(run()) }, slots: { inject: (_name, run) => run(), register: (slot, component) => { if (slot.name === 'main') Panel = component } }, remote: {
    harnessProjects: remote, $stream: options => { lost = options.carrierFailed; return { restart() {}, dispose: async () => { stopped = true; receive?.({ done: true }) }, [Symbol.asyncIterator]: () => ({ next: () => stopped ? Promise.resolve({ done: true }) : queue.length ? Promise.resolve({ done: false, value: queue.shift() }) : new Promise(resolve => { receive = resolve }) }) } },
  } }
  await apply({ remote: { $mount: async () => {} }, inject: (_names, run) => run(child) }); await turn()
  t.after(async () => { for (const stop of cleanups) await stop() })
  const render = () => renderToStaticMarkup(React.createElement(Panel))
  const frame = async (bindingId = 'binding', observation = {}) => {
    emit({ generation: ++generation, value: { kind: 'baseline', baseline: { generation: `scope-${generation}`, workspace: current.workspace, revision: 0, entities: [], capabilities: observation.access === 'unknown' ? [] : [{ key: 'planning.item.read', access: observation.access ?? 'available' }], planningSource: { bindingId, name: bindingId === 'binding' ? 'Current project' : 'OLD-PROJECT-CANARY' }, source: { revision: 0, freshness: observation.degraded ? 'degraded' : 'fresh', ...(observation.degraded ? { reason: 'RAW-REASON-CANARY' } : {}), reconciledAt: at } } }, accept() {} }); await turn()
  }
  return { render, frame, disconnect: () => lost(), calls, set: value => { current = value } }
}
const summary = html => html.match(/<section[^>]*aria-label="工作区状态"[^]*?<\/section>/)?.[0] ?? ''

test('actual apply main Panel persists truthful summary across configured/confirmed settings and list', async t => {
  const f = await open(t), initial = f.render()
  assert.match(summary(initial), /Current workspace[^]*配置已记录，待确认[^]*宿主[^]*状态未知/)
  assert.doesNotMatch(summary(initial), /Saved|已保存|已确认/)
  await f.frame(); assert.match(summary(f.render()), /已连接/)
  f.set(setup('confirmed')); f.disconnect(); await f.frame()
  assert.match(summary(f.render()), /Current workspace[^]*已确认[^]*已连接[^]*Current project/)
  assert.match(f.render(), /工作项/); assert.deepEqual(f.calls.map(call => call.length), [1, 1], 'status subscriptions cannot introduce port requests')
  assert.equal((summary(f.render()).match(/aria-live/g) ?? []).length, 1)
})

test('actual transport loss preserves source confirmation, recovery rereads setup and rejects old binding timestamp', async t => {
  const f = await open(t, 'confirmed'); await f.frame(); f.disconnect()
  assert.match(summary(f.render()), /最后已知已确认[^]*连接中断[^]*2026-10-30T00:00:00Z/)
  await f.frame('old-binding'); const stale = summary(f.render())
  assert.match(stale, /已连接[^]*观测未知/); assert.doesNotMatch(stale, /OLD-PROJECT|2026-10-30T/)
  await f.frame(); assert.match(summary(f.render()), /Current project[^]*2026-10-30T00:00:00Z/)
})

test('actual apply continuous same-time frames expose degradation, unavailable and recovery without changing Planning confirmation', async t => {
  const f = await open(t, 'confirmed'); await f.frame()
  assert.match(summary(f.render()), /当前读取已确认/)
  await f.frame('binding', { degraded: true }); let view = summary(f.render())
  assert.match(view, /已确认[^]*已连接[^]*读取不完整/); assert.doesNotMatch(view, /RAW-REASON/)
  await f.frame('binding', { access: 'unavailable' }); assert.match(summary(f.render()), /读取不可用/)
  await f.frame('binding', { access: 'unknown' }); assert.match(summary(f.render()), /读取状态未知/)
  await f.frame(); view = summary(f.render()); assert.match(view, /当前读取已确认/); assert.match(view, /2026-10-30T00:00:00Z/)
  assert.equal(f.calls.length, 1, 'continuous source changes do not probe setup again')
})
