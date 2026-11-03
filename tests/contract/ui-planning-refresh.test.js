import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { bindWorkspaceStatusApp } from '@harness-projects/ui'
import { createEntityStore } from '@harness-projects/client'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const at = '2026-10-27T01:00:01.000Z'
const store = createEntityStore()
store.applyBaseline({ revision: 0, entities: [], source: { revision: 0, freshness: 'fresh', authority: 'provider' } })
const read = { planningSource: { bindingId: 'binding', name: 'Planning source' }, workspace: { id: 'ws', name: '空工作区' }, store, connection: { connected: true }, lastUpdatedAt: at, reconciledAt: at, capabilities: [{ key: 'planning.item.read', access: 'available' }] }
const source = { subscribe: () => () => {}, getSnapshot: () => read }
const refreshSource = { subscribe: () => () => {}, getSnapshot: () => ({ pending: true }), refresh: () => Promise.resolve() }
test('refreshing empty list keeps Host confirmation visible and accessible busy status', () => {
  const snapshot = { pending: false, setup: { workspace: read.workspace, planning: { state: 'confirmed', bindingId: 'binding', projectNodeId: 'project' } } }
  const setupSource = { subscribe: () => () => {}, getSnapshot: () => snapshot }
  const html = renderToStaticMarkup(React.createElement(bindWorkspaceStatusApp(setupSource, source, undefined, { refreshSource })))
  assert.match(html, /刷新规划/)
  assert.match(html, /正在刷新/)
  assert.match(html, /来源最后完整确认/)
  assert.match(html, new RegExp(at.replaceAll('.', '\\.')))
  assert.match(html, /aria-busy="true"/)
})
