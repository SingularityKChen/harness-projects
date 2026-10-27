import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { WorkItemApp } from '@harness-projects/ui'
import { createEntityStore } from '@harness-projects/client'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const at = '2026-10-27T01:00:01.000Z'
const store = createEntityStore()
store.applyBaseline({ revision: 0, entities: [], source: { revision: 0, freshness: 'fresh', authority: 'provider' } })
const read = { workspace: { id: 'ws', name: '空工作区' }, store, connection: { connected: true }, lastUpdatedAt: at, reconciledAt: at, capabilities: [{ key: 'planning.item.read', access: 'available' }] }
const source = { subscribe: () => () => {}, getSnapshot: () => read }
const refreshSource = { subscribe: () => () => {}, getSnapshot: () => ({ pending: true }), refresh: () => Promise.resolve() }
test('refreshing empty list keeps Host confirmation visible and accessible busy status', () => {
  const html = renderToStaticMarkup(React.createElement(WorkItemApp, { source, refreshSource }))
  assert.match(html, /刷新规划/)
  assert.match(html, /正在刷新/)
  assert.match(html, /规划来源最后确认/)
  assert.match(html, new RegExp(at.replaceAll('.', '\\.')))
  assert.match(html, /aria-busy="true"/)
})
