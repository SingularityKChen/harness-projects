import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { startExecutionServer } from '../fixtures/execution-drawer-browser.mjs'
import { browserScenario } from '../fixtures/runtime-access-browser-scenarios.mjs'
const post = async (h, route, input) => {
  const response = await fetch(h.url + route, { method: 'POST', body: JSON.stringify(input) })
  assert.equal(response.status, 200, `${route} must expose the production carrier`)
  return response.json()
}
const remote = (h, name, input = {}) => post(h, '/remote', { name, input })
async function openWatch(h) {
  const abort = new AbortController(), response = await fetch(h.url + '/watch', { signal: abort.signal })
  assert.equal(response.status, 200)
  const lines = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  return { close: () => abort.abort(), async next() {
    for (;;) {
      const end = buffer.indexOf('\n')
      if (end >= 0) { const value = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); return value }
      const item = await lines.read(); assert.equal(item.done, false, 'Host stream ended before expected frame'); buffer += item.value
    }
  } }
}
test('browser unary bridge reaches installed strict service and rejects undeclared operations or fields', async (t) => {
  const h = await startExecutionServer(); t.after(h.close)
  const baseline = await remote(h, 'baseline')
  assert.equal(baseline.ok, true)
  assert.ok(baseline.value.entities.some((row) => row.content.title === browserScenario.title))
  assert.equal((await remote(h, 'getWorkspaceSetup')).value.planning.state, 'confirmed', 'production setup must admit the seeded workspace into the actual app')
  for (const [name, input] of [['watch', {}], ['writePlanningStatus', {}], ['getExecutionContext', { workItemId: h.itemId, repositoryId: 'repo-alpha', extra: true }]]) {
    assert.equal((await remote(h, name, input)).ok, false)
  }
  const dto = await remote(h, 'getExecutionContext', { workItemId: h.itemId, repositoryId: 'repo-alpha' })
  assert.equal(dto.ok, true); assert.equal(dto.value.context.runStatus, 'running')
})
test('browser carrier transports actual Host delta and recovery after mounted Provider denial', async (t) => {
  const h = await startExecutionServer(); t.after(h.close)
  const stream = await openWatch(h); t.after(stream.close)
  const baseline = await stream.next()
  assert.equal(baseline.kind, 'baseline')
  assert.deepEqual(baseline.baseline, (await remote(h, 'baseline')).value)
  await post(h, '/control', browserScenario.denial)
  await remote(h, 'refreshPlanning', { actorRef: { kind: 'user' } })
  const denied = await stream.next()
  assert.equal(denied.kind, 'delta'); assert.ok(denied.delta.upserts.every((row) => row.content.contentKind === 'redacted'))
  assert.doesNotMatch(JSON.stringify((await remote(h, 'baseline')).value), /issue-1 正文占位/)
  await post(h, '/control', browserScenario.recovery)
  await remote(h, 'refreshPlanning', { actorRef: { kind: 'user' } })
  const recovered = await stream.next()
  assert.equal(recovered.kind, 'delta'); assert.ok(recovered.delta.upserts.some((row) => row.content.title === browserScenario.title))
  stream.close()
})
test('aborting a browser stream releases its Host watch while Provider promises drain on explicit release', async (t) => {
  const h = await startExecutionServer(); t.after(h.close)
  const stream = await openWatch(h); await stream.next(); stream.close()
  const control = (action, value) => post(h, '/control', { action, value })
  await control('hold', { domain: 'planning', method: 'listPlanningItems', enabled: true })
  const pending = remote(h, 'refreshPlanning', { actorRef: { kind: 'user' } })
  let state
  for (let i = 0; i < 100; i++) {
    state = await control('inspect')
    if (state.held === 1 && state.streams === 0) break
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal(state.streams, 0); assert.equal(state.held, 1)
  await control('release'); assert.equal((await pending).ok, true)
  const next = await openWatch(h); assert.equal((await next.next()).kind, 'baseline'); next.close()
})
