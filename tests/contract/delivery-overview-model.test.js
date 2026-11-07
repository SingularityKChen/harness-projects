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
