import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createEntityStore } from '@harness-projects/client'
import * as model from '@harness-projects/ui-model'
import { wire, redacted } from '../fixtures/work-item-wire.mjs'
function input() {
  const store = createEntityStore()
  store.applyBaseline({ revision: 0, entities: [wire('visible'), wire('draft', {content:{externalKind:'draft'}}), wire('pr', {content:{contentKind:'change_request', externalKind:'change_request'}}), redacted('CANARY-ID')], source: {revision:0,freshness:'fresh',authority:'provider'} })
  return {phase:'received',refreshing:false,metadata:{sourceNames:{}},read:{workspace:{id:'ws',name:'Workspace'},store,connection:{connected:true},capabilities:[{key:'planning.item.read',access:'available'}],repositories:[{id:'z',capabilities:[],accessVersion:2},{id:'a',capabilities:[],accessVersion:1}]}}
}
test('overview excludes draft PR-backed and redacted targets without leaking counts', () => {
  assert.equal(typeof model.deriveDeliveryOverviewTargets, 'function')
  const source = input(), view = model.deriveDeliveryOverviewTargets(source)
  assert.deepEqual(view.repositoryIds, ['a','z']); assert.equal(view.items.length, 1)
  assert.deepEqual(view.items[0].target, {workspaceId:'ws',workItemId:'visible',repositoryIds:['a','z']})
  assert.equal(view.items[0].accessTokens.a, '[[],1]'); assert.equal(view.items[0].title,'标题-visible')
  assert.doesNotMatch(JSON.stringify(view), /CANARY|正文|externalId|planningStatus|store/)
  source.read.capabilities = [{key:'planning.item.read',access:'unavailable'}]
  assert.deepEqual(model.deriveDeliveryOverviewTargets(source), {kind:'unavailable'})
  source.read.capabilities = []; source.phase = 'pending'
  assert.deepEqual(model.deriveDeliveryOverviewTargets(source), {kind:'loading'})
})

test('overview scans the full safe list once regardless of row count', () => {
  for (const count of [20, 128]) {
    const source = input(), original = source.read.store
    original.applyBaseline({ revision: 1, entities: [
      ...Array.from({ length: count }, (_, i) => wire('item-' + i)),
      wire('draft', { content: { externalKind: 'draft' } }),
      wire('pr', { content: { contentKind: 'change_request', externalKind: 'change_request' } }),
      redacted('CANARY-ID'),
    ], source: { revision: 1, freshness: 'fresh', authority: 'provider' } })
    let scans = 0
    source.read.store = { ...original, list: () => { scans++; return original.list() } }
    const view = model.deriveDeliveryOverviewTargets(source)
    assert.equal(view.items.length, count)
    assert.deepEqual(view.repositoryIds, ['a', 'z'])
    assert.deepEqual(view.items.find(item => item.key === 'item-0'), {
      key: 'item-0', title: '标题-item-0', target: { workspaceId: 'ws', workItemId: 'item-0', repositoryIds: ['a', 'z'] }, accessTokens: { a: '[[],1]', z: '[[],2]' },
    })
    assert.doesNotMatch(JSON.stringify(view), /CANARY|draft|正文|externalId|planningStatus|store/)
    assert.equal(scans, 1, 'each safe row must not derive another full list')
  }
})

test('overview rechecks current entity type after the list gate and preserves missing-target failure', () => {
  for (const content of [{ contentKind: 'redacted', title: 'LATE-CANARY' }, { contentKind: 'change_request' }, { externalKind: 'draft' }]) {
    const source = input(), original = source.read.store
    source.read.store = { ...original, get: key => {
      const entry = original.get(key)
      return key === 'visible' ? { ...entry, entity: { ...entry.entity, content: { ...entry.entity.content, ...content } } } : entry
    } }
    const view = model.deriveDeliveryOverviewTargets(source)
    assert.equal(view.items.length, 0)
    assert.doesNotMatch(JSON.stringify(view), /visible|LATE-CANARY|CANARY/)
  }
  const source = input(), original = source.read.store
  source.read.store = { ...original, get: key => key === 'visible' ? undefined : original.get(key) }
  assert.throws(() => model.deriveDeliveryOverviewTargets(source), { name: 'TypeError', message: /安全列表.*visible.*取不到/ })
})
