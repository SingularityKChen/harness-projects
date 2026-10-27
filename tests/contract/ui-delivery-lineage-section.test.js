import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import * as ui from '@harness-projects/ui'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url)), React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const scope = { workspaceId: 'ws', workItemId: 'wi', repositoryId: 'repo' }, T0 = Date.parse('2026-10-26T00:00:00.000Z')
const at = (ms) => new Date(T0 + ms).toISOString()
const projection = () => ({ workItemId: 'wi', repositoryId: 'repo', optional: [], degraded: false, gaps: [{ entityKind: 'commit', reason: 'not_observed' }], freshness: ['pipeline_run', 'check_run'].map((kind, i) => ({ kind, stale: false, confirmedAt: at(i * 100) })), hops: ['pipeline_run', 'check_run'].map((entityKind) => ({ entityKind, externalId: entityKind, label: undefined, fact: 'ci_passed', stale: false, unavailable: false, relationState: 'candidate' })) })
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
function harness(props) {
  const cells = []; let cursor = 0, pending = [], writes = 0
  const slot = (make) => cells[cursor++] ?? (cells[cursor - 1] = make())
  const dispatcher = { useRef: (value) => slot(() => ({ current: value })), useState: (value) => { const cell = slot(() => ({ value })); return [cell.value, (next) => { writes++; cell.value = typeof next === 'function' ? next(cell.value) : next }] }, useEffect: (run, deps) => { const cell = slot(() => ({})); if (!cell.deps || deps.some((dep, index) => !Object.is(dep, cell.deps[index]))) pending.push(() => { cell.cleanup?.(); cell.cleanup = run() }); cell.deps = deps; cell.run = run } }
  return { props, get writes() { return writes }, render() { const shared = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, old = shared.ReactCurrentDispatcher.current; shared.ReactCurrentDispatcher.current = dispatcher; cursor = 0; try { return ui.DeliveryLineageSection(props) } finally { shared.ReactCurrentDispatcher.current = old } }, flush() { const jobs = pending; pending = []; jobs.forEach((run) => run()) }, replayEffects() { cells.filter((cell) => cell.run).forEach((cell) => { cell.cleanup?.(); cell.cleanup = cell.run() }) }, close() { cells.forEach((cell) => cell.cleanup?.()) } }
}
const text = (h) => renderToStaticMarkup(h.render())
function environment(t) {
  const jobs = new Map(), events = new EventTarget(), doc = new EventTarget(); doc.visibilityState = 'visible'; let next = 0
  const saved = Object.fromEntries(['setTimeout', 'clearTimeout', 'window', 'document'].map((key) => [key, globalThis[key]]))
  Object.assign(globalThis, { window: events, document: doc, setTimeout: (callback, delay) => { jobs.set(++next, { callback, delay }); return next }, clearTimeout: (id) => jobs.delete(id) })
  t.after(() => Object.assign(globalThis, saved))
  return { jobs, resume: () => events.dispatchEvent(new Event('pageshow')), visibility: (state) => { doc.visibilityState = state; doc.dispatchEvent(new Event('visibilitychange')) }, fire: () => { const [id, job] = jobs.entries().next().value; jobs.delete(id); job.callback() } }
}
function fixture(t) {
  const env = environment(t), pending = [], calls = []; let now = 0, p = projection(), hold = false
  const reader = { refresh: async () => { calls.push('refresh'); return { hops: [{ externalId: 'COMMAND-ONLY' }] } }, read: async (target) => { calls.push('read'); if (hold) return new Promise((resolve, reject) => pending.push({ target, resolve, reject })); return { ...target, projection: p, now: at(now) } } }
  const h = harness({ scope, reader, connected: true, thresholdMs: 1000 })
  return { ...env, h, reader, calls, pending, set now(value) { now = value }, set p(value) { p = value }, set hold(value) { hold = value }, async open() { text(h); h.flush(); await settle() } }
}
test('open/refresh rereads, six slots preserve gaps/candidate and command result cannot supply nodes', async (t) => {
  assert.equal(typeof ui.DeliveryLineageSection, 'function')
  const f = fixture(t); await f.open()
  assert.deepEqual(f.calls, ['refresh', 'read']); assert.equal((text(f.h).match(/data-position=/g) ?? []).length, 6)
  assert.match(text(f.h), /通过/); assert.match(text(f.h), /候选/); assert.match(text(f.h), /not_observed/); assert.doesNotMatch(text(f.h), /COMMAND-ONLY/)
  f.h.render().props.children.at(-1).props.onClick(); assert.doesNotMatch(text(f.h), /data-state="passed"/); await settle()
  assert.deepEqual(f.calls, ['refresh', 'read', 'refresh', 'read'])
  const p = projection(); p.freshness[0].confirmedAt = undefined; p.hops[1].stale = true; f.p = p
  f.resume(); await settle(); assert.match(text(f.h), /未知/); assert.match(text(f.h), /陈旧/); assert.doesNotMatch(text(f.h), /data-state="passed"/)
  f.h.close()
})
test('one boundary timer uses Host now, masks pending RPC, handles both boundaries without polling', async (t) => {
  const f = fixture(t); f.now = 999; await f.open(); assert.equal(f.jobs.size, 1); assert.equal([...f.jobs.values()][0].delay, 1)
  assert.equal((text(f.h).match(/data-state="passed"/g) ?? []).length, 2)
  f.now = 1000; f.hold = true; f.fire(); assert.match(text(f.h), /正在核对新鲜度/); assert.doesNotMatch(text(f.h), /data-state="passed"/); await settle()
  f.pending.shift().resolve({ ...scope, projection: projection(), now: at(1000) }); await settle()
  assert.equal((text(f.h).match(/data-state="passed"/g) ?? []).length, 1); assert.equal([...f.jobs.values()][0].delay, 100)
  f.hold = false; f.now = 1099; f.resume(); await settle(); assert.equal([...f.jobs.values()][0].delay, 1)
  f.now = 1100; f.fire(); await settle(); assert.doesNotMatch(text(f.h), /data-state="passed"/); assert.equal(f.jobs.size, 0)
  assert.equal(f.calls.filter((x) => x === 'refresh').length, 1, 'age/resume is pure read')
  const count = f.calls.length; text(f.h); f.h.flush(); await settle(); assert.equal(f.calls.length, count, 'accepted new object cannot self-trigger reads')
  f.h.close()
})
test('resume, disconnect, target generation, late reject and unmount never restore old green', async (t) => {
  const f = fixture(t); await f.open(); const oldTimer = [...f.jobs.values()][0].callback
  f.visibility('hidden'); assert.doesNotMatch(text(f.h), /data-state="passed"/); assert.equal(f.jobs.size, 0)
  f.now = 1200; f.hold = true; f.visibility('visible'); assert.doesNotMatch(text(f.h), /data-state="passed"/); await settle()
  f.h.props.scope = { ...scope, workItemId: 'new' }; assert.doesNotMatch(text(f.h), /pipeline_run<|data-state="passed"/); f.h.flush(); await settle()
  oldTimer(); f.pending[0].reject(new Error('LATE-SECRET')); await settle(); assert.doesNotMatch(text(f.h), /LATE-SECRET|data-state="passed"/)
  f.h.props.connected = false; text(f.h); f.h.flush(); f.pending.at(-1).resolve({ ...scope, now: at(0), projection: projection() }); await settle(); assert.doesNotMatch(text(f.h), /data-state="passed"/)
  f.h.props.connected = true; text(f.h); f.h.flush(); await settle(); assert.doesNotMatch(text(f.h), /data-state="passed"/)
  const writes = f.h.writes; f.h.close(); f.pending.at(-1).reject(new Error('UNMOUNTED')); oldTimer(); f.resume(); await settle(); assert.equal(f.h.writes, writes); assert.equal(f.jobs.size, 0)
})
test('failed refresh still rereads; read failure preserves nodes without green; threshold change is pure read', async (t) => {
  const f = fixture(t); await f.open()
  f.reader.refresh = async () => { f.calls.push('refresh-failed'); throw new Error('SECRET') }
  f.h.render().props.children.at(-1).props.onClick(); await settle()
  assert.deepEqual(f.calls.slice(-2), ['refresh-failed', 'read']); assert.match(text(f.h), /暂时无法确认/); assert.match(text(f.h), /pipeline_run/); assert.doesNotMatch(text(f.h), /data-state="passed"|SECRET/)
  f.hold = true; f.resume(); await settle(); f.pending.shift().reject(new Error('PRIVATE')); await settle()
  assert.match(text(f.h), /暂时无法确认/); assert.doesNotMatch(text(f.h), /data-state="passed"|PRIVATE/)
  f.hold = false; f.now = 1000; f.h.props.thresholdMs = 2000; text(f.h); f.h.flush(); await settle()
  assert.equal([...f.jobs.values()][0].delay, 1000); assert.equal(f.calls.filter((entry) => entry.startsWith('refresh')).length, 2)
  assert.match(text(f.h), /data-state="passed"/); f.h.close()
})
test('threshold replacement masks old green before effect and uses new Host time', async (t) => {
  const f = fixture(t); await f.open(); assert.match(text(f.h), /data-state="passed"/)
  f.h.props.thresholdMs = 2000; f.hold = true
  assert.doesNotMatch(text(f.h), /data-state="passed"/); f.h.flush(); await settle()
  f.pending.shift().resolve({ ...scope, projection: projection(), now: at(2100) }); await settle()
  assert.doesNotMatch(text(f.h), /data-state="passed"/); assert.equal(f.jobs.size, 0); f.h.close()
})
test('same-scope superseded read cannot overwrite newest result or its timer', async (t) => {
  const f = fixture(t); await f.open(); f.hold = true
  const click = () => f.h.render().props.children.at(-1).props.onClick()
  click(); await settle(); click(); await settle(); assert.equal(f.pending.length, 2)
  const fresh = projection(); fresh.hops[0].label = 'NEWEST'
  f.pending[1].resolve({ ...scope, now: at(0), projection: fresh }); await settle(); assert.match(text(f.h), /NEWEST/)
  f.pending[0].resolve({ ...scope, now: at(1200), projection: projection() }); await settle()
  assert.match(text(f.h), /NEWEST/); assert.equal(f.jobs.size, 1); assert.equal([...f.jobs.values()][0].delay, 1000)
  click(); await settle(); click(); await settle(); f.pending[3].resolve({ ...scope, now: at(0), projection: fresh }); await settle()
  f.pending[2].reject(new Error('OLD-REJECTION')); await settle(); assert.match(text(f.h), /data-state="passed"/); assert.doesNotMatch(text(f.h), /暂时无法/); f.h.close()
})
test('projection error cannot present passed even when old facts retain fresh timestamps', async (t) => {
  const f = fixture(t); const p = projection(); p.error = { code: 'unavailable', message: 'safe' }; f.p = p
  await f.open(); assert.match(text(f.h), /谱系不完整/); assert.doesNotMatch(text(f.h), /data-state="passed"/); f.h.close()
})
for (const resume of ['pageshow', 'visible']) test(`pending explicit refresh stays masked and rereads final facts after ${resume}`, async (t) => {
  const f = fixture(t); await f.open(); let finish
  f.reader.refresh = () => { f.calls.push('refresh-pending'); return new Promise((resolve) => { finish = resolve }) }
  f.h.render().props.children.at(-1).props.onClick(); await settle()
  if (resume === 'pageshow') f.resume(); else { f.visibility('hidden'); f.visibility('visible') }
  await settle(); const during = text(f.h), readsBefore = f.calls.filter((call) => call === 'read').length
  const p = projection(); p.hops.forEach((hop) => { hop.stale = true }); f.p = p
  finish(); await settle()
  assert.doesNotMatch(during, /data-state="passed"/, 'recovery cannot bypass a pending explicit refresh')
  assert.ok(f.calls.filter((call) => call === 'read').length > readsBefore, 'completion must reread final Host facts')
  assert.match(text(f.h), /陈旧/); assert.doesNotMatch(text(f.h), /data-state="passed"/); f.h.close()
})
test('same-scope reader replacement masks old authority in the first render', async (t) => {
  const f = fixture(t); await f.open()
  f.h.props.reader = { refresh: async () => {}, read: () => new Promise(() => {}) }
  assert.doesNotMatch(text(f.h), /data-state="passed"/); f.h.flush(); await settle()
  assert.doesNotMatch(text(f.h), /data-state="passed"/); f.h.close()
})
test('effect cleanup/setup replay waits for the same pending open refresh', async (t) => {
  const f = fixture(t); let finish
  f.reader.refresh = () => { f.calls.push('refresh-pending'); return new Promise((resolve) => { finish = resolve }) }
  text(f.h); f.h.flush(); await settle(); f.h.replayEffects(); await settle()
  const during = text(f.h), readsBefore = f.calls.filter((call) => call === 'read').length
  finish(); await settle()
  assert.doesNotMatch(during, /data-state="passed"/); assert.ok(f.calls.filter((call) => call === 'read').length > readsBefore)
  assert.equal(f.calls.filter((call) => call === 'refresh-pending').length, 1); f.h.close()
})
test('target ABA cannot reuse prior A reads or refresh completion', async (t) => {
  const f = fixture(t); await f.open(); const staleTimer = [...f.jobs.values()][0].callback
  f.hold = true; f.resume(); await settle()
  f.h.props.scope = { ...scope, workItemId: 'B' }; text(f.h); f.h.flush(); await settle()
  f.h.props.scope = { ...scope }; text(f.h); f.h.flush(); await settle()
  const p = projection(); p.hops[0].label = 'CURRENT_A'
  f.pending[2].resolve({ ...scope, projection: p, now: at(0) }); await settle()
  f.pending[0].resolve({ ...scope, projection: projection(), now: at(1200) }); f.pending[1].reject(new Error('LATE_B')); staleTimer(); await settle()
  assert.match(text(f.h), /CURRENT_A/); assert.match(text(f.h), /data-state="passed"/); assert.equal(f.jobs.size, 1); f.h.close()
})
test('two explicit refresh intents execute twice and recovery waits for both commands', async (t) => {
  const f = fixture(t); await f.open(); const finishes = []
  f.reader.refresh = () => { f.calls.push('explicit-refresh'); return new Promise((resolve) => finishes.push(resolve)) }
  const click = () => f.h.render().props.children.at(-1).props.onClick()
  click(); await settle(); click(); f.resume(); await settle(); assert.equal(finishes.length, 1)
  assert.doesNotMatch(text(f.h), /data-state="passed"/)
  finishes[0](); await settle(); assert.equal(finishes.length, 2); assert.doesNotMatch(text(f.h), /data-state="passed"/)
  const p = projection(); p.hops.forEach((hop) => { hop.stale = true }); f.p = p
  finishes[1](); await settle(); assert.equal(f.calls.filter((call) => call === 'explicit-refresh').length, 2)
  assert.match(text(f.h), /陈旧/); assert.doesNotMatch(text(f.h), /data-state="passed"/); f.h.close()
})
