import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as client from '@harness-projects/client'
const scope = { workspaceId: 'ws', workItemId: 'wi' }, at = '2026-11-03T01:00:00Z'
const link = { repositoryId: 'opaque-repo', repositoryName: 'actual/repo', bindingId: 'opaque-binding', externalId: 'opaque-pr', number: 159, title: 'Native title', url: 'https://example.test/pull/159', state: 'merged', isDraft: false, provenance: 'source_observed', relation: 'native_closing' }
const observation = (over = {}) => ({ workItemId: 'wi', scopeToken: 'opaque-host:1', state: 'complete', links: [link], stale: false, observedAt: at, ...over })
const query = (o = observation()) => ({ ...scope, observation: o })
const command = (o = observation()) => ({ writeState: 'local_only', saving: false, authoritative: false, value: o })
test('strict native reader reads exact scope and uses opaque refresh receipt without caching facts', async () => {
  assert.equal(typeof client.createIssueClosingLinksReader, 'function')
  let result = query(), refreshed = command()
  const reader = client.createIssueClosingLinksReader({ read: async () => result, refresh: async () => refreshed })
  const receipt = await reader.refresh(scope)
  assert.equal(receipt, 'opaque-host:1'); assert.deepEqual(await reader.read(scope, receipt), query())
  assert.deepEqual(await reader.read({ ...scope, sourceToken: 'private', accessToken: 'private' }, receipt), query(), 'consumer signatures are not response facts')
  for (const state of ['unread', 'denied', 'unsupported', 'unavailable']) {
    result = query(observation({ state, links: [], stale: true })); delete result.observation.observedAt
    assert.equal((await reader.read(scope, 'obsolete')).observation.state, state)
  }
  for (const mutate of [v => v.workspaceId = 'wrong', v => v.workItemId = 'wrong', v => v.error = 'SECRET', v => v.observation.workItemId = 'wrong', v => v.observation.scopeToken = '', v => v.observation.scopeToken = 'old', v => v.observation.raw = 'SECRET', v => v.observation.observedAt = '2026-02-30T00:00:00Z', v => v.observation.stale = 'false', v => v.observation.links[0].number = 0, v => v.observation.links[0].repositoryName = '', v => v.observation.links[0].isDraft = 1, v => v.observation.links[0].relation = 'implements', v => v.observation.links[0].state = 'unknown', v => v.observation.links[0].body = 'SECRET', v => v.observation.links.push({ ...link }), v => v.observation = observation({ state: 'denied', observedAt: undefined }), v => v.observation.state = 'unknown', v => v.observation.state = new String('complete'), v => v.observation.links[0].state = new String('merged')]) {
    result = structuredClone(query()); mutate(result)
    await assert.rejects(() => reader.read(scope, receipt), { message: '来源关联响应不合契约' })
  }
  result = query(observation({ state: 'partial', stale: true, links: [] })); assert.equal((await reader.read(scope)).observation.state, 'partial')
  for (const mutate of [v => v.writeState = 'confirmed', v => v.saving = true, v => v.authoritative = true, v => v.value = undefined, v => v.error = { message: 'SECRET' }, v => v.extra = true]) {
    refreshed = command(); mutate(refreshed); await assert.rejects(() => reader.refresh(scope))
  }
})
test('workspace sync exposes the accepted Host generation even when source metadata is unchanged', () => {
  const sync = client.createSync({ close() {} }, client.createEntityStore(), { clock: () => at })
  const baseline = { generation: 'host-1', revision: 1, workspace: { id: 'ws', name: 'workspace' }, capabilities: [], entities: [], source: { revision: 1, freshness: 'fresh', authority: 'host' } }
  sync.receive({ kind: 'baseline', baseline }); assert.equal(sync.read().generation, 'host-1')
  sync.receive({ kind: 'baseline', baseline: { ...baseline, generation: 'host-2' } }); assert.equal(sync.read().generation, 'host-2')
  const metadata = { ...baseline, entities: [] }
  sync.receive({ kind: 'metadata', metadata: { ...metadata, generation: 'host-2', nativeAccessVersion: 'native-1' } }); assert.equal(sync.read().nativeAccessVersion, 'native-1'); assert.equal(sync.read().store.revision, 1)
  assert.throws(() => sync.receive({ kind: 'metadata', metadata: { ...metadata, generation: 'host-2', nativeAccessVersion: 1 } })); assert.equal(sync.read().nativeAccessVersion, 'native-1')
})
