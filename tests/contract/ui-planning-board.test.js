import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as model from '@harness-projects/ui-model'
import { createEntityStore } from '@harness-projects/client'
import { wire, redacted } from '../fixtures/work-item-wire.mjs'

function rows(entities) {
  const store = createEntityStore()
  store.applyBaseline({ revision: 1, entities, source: { revision: 1, freshness: 'fresh', authority: 'provider' } })
  return model.deriveWorkItemListView({ read: { workspace: { id: 'workspace', name: 'Board' }, store, connection: { connected: true }, lastUpdatedAt: '2026-11-10T00:00:00Z', capabilities: [{ key: 'planning.item.read', access: 'read_only' }] }, phase: 'received', refreshing: false, metadata: { sourceNames: { 'bind-1': 'Source' } } }).body.rows
}
const group = input => {
  assert.equal(typeof model.derivePlanningBoard, 'function', 'safe Planning Board grouping must be available')
  return model.derivePlanningBoard(input)
}

test('Board groups only canonical safe items in fixed order, preserving source-qualified identities', () => {
  const safe = rows(['unknown', 'canceled', 'done', 'blocked', 'in_progress', 'todo'].map((planningStatus, index) => wire('item-' + index, { planningStatus, planningFields: { statusName: 'Done' } })))
  const before = JSON.stringify(safe)
  const groups = group(safe)
  assert.deepEqual(groups.map(g => g.status), ['todo', 'in_progress', 'blocked', 'done', 'canceled', 'unknown'])
  assert.deepEqual(groups.map(g => g.items.length), [1, 1, 1, 1, 1, 1])
  assert.equal(groups[0].items[0].planningStatus, '待办')
  assert.equal(groups[5].items[0].nativePlanningStatus, 'Done')
  assert.equal('nativePlanningStatus' in groups[0].items[0], false)
  assert.equal(JSON.stringify(safe), before)
  const number = bindingId => ({ sourceName: 'GitHub', scopeIdentity: { namespace: 'repository', id: bindingId }, scopeName: 'example/' + bindingId, number: 7 })
  const sameNumber = rows(['one', 'two'].map(id => wire(id, { planningStatus: 'todo', content: { sourceNumber: number(id) } })))
  assert.deepEqual(group(sameNumber)[0].items.map(item => item.key), ['one', 'two'])
  assert.notEqual(sameNumber[0].numberLabel, sameNumber[1].numberLabel)
})

test('engineering facts never move Board cards and redacted fields never create groups or counts', () => {
  const visible = rows([wire('safe', { planningStatus: 'todo' }), wire('unknown', { planningStatus: 'unknown' })])
  const groups = group(visible)
  for (const engineering of ['CI 失败', 'CI 通过', '已合并']) assert.deepEqual(group(visible.map(row => ({ ...row, engineering }))).map(g => [g.status, g.items.map(item => item.key)]), groups.map(g => [g.status, g.items.map(item => item.key)]))
  assert.equal(groups[1].items[0].nativePlanningStatus, undefined)
  const hidden = rows([redacted('SECRET-ID', {}, { planningStatus: 'done', planningFields: { statusName: 'SECRET-STATUS' } })])
  assert.deepEqual(hidden, [{ kind: 'redacted', key: 'SECRET-ID' }])
  assert.deepEqual(group(hidden), [])
  assert.deepEqual(group([...visible, ...hidden]), groups)
  assert.doesNotMatch(JSON.stringify(group([...visible, ...hidden])), /SECRET|CANARY/)
  assert.deepEqual(group([]), [])
})

test('Board with only redacted input explains the empty visible surface without hidden DOM or accessibility markers', async () => {
  const { createRequire } = await import('node:module')
  const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
  const { createElement } = require('react'), { renderToStaticMarkup } = require('react-dom/server')
  const { WorkItemBoard } = await import('../../packages/ui/src/work-item-board.ts')
  const markup = renderToStaticMarkup(createElement(WorkItemBoard, { rows: rows([redacted('SECRET-SELECTED')]), navigation: { currentItemId:'SECRET-SELECTED', href: id => '/items/' + id, open: () => {} } }))
  assert.match(markup, /当前没有可显示的工作项/)
  assert.doesNotMatch(markup.replace(/<style>[\s\S]*?<\/style>/g, ''), /SECRET|CANARY|aria-current|hp-board-card|hp-board-column/)
})
