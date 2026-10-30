import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

import { createEntityStore } from '@harness-projects/client'
import * as ui from '@harness-projects/ui'
import { deriveWorkItemDetailView, deriveWorkItemListView } from '@harness-projects/ui-model'

const uiRequire = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const { createElement } = uiRequire('react')
const { renderToStaticMarkup } = uiRequire('react-dom/server')
const gates = ['development.branch.create', 'development.worktree.create', 'development.repository.read', 'development.worktree.read']
const entity = {
  entityId: 'item-1', kind: 'work_item', planningStatus: 'in_progress', derived: [],
  content: { contentKind: 'work_item', title: 'Visible item', body: 'Visible body', bindingId: 'planning-1', externalKind: 'issue', externalId: '7' },
  source: { revision: 1, freshness: 'fresh', authority: 'provider' },
}
const redacted = {
  ...entity, entityId: 'item-hidden',
  content: { contentKind: 'redacted', title: 'READ-ONLY-CANARY', body: 'READ-ONLY-CANARY', bindingId: 'READ-ONLY-CANARY', externalKind: 'issue', externalId: 'READ-ONLY-CANARY' },
  planningFields: { statusName: 'READ-ONLY-CANARY', iterationTitle: 'READ-ONLY-CANARY', targetDate: 'READ-ONLY-CANARY' },
}
const startWork = { options: async () => ({}), submit: async () => ({ writeState: 'confirmed', degraded: false }) }

function renderPair({ planning = 'read_only', development = gates, entities = [entity, redacted], selected = 'item-1' } = {}) {
  const store = createEntityStore()
  store.applyBaseline({ revision: 0, entities, source: { revision: 0, freshness: 'fresh', authority: 'provider' } })
  const input = {
    phase: 'received', refreshing: false,
    read: {
      workspace: { id: 'ws-1', name: 'Workspace' }, store, connection: { connected: true },
      capabilities: planning === null ? [] : [{ key: 'planning.item.read', access: planning }],
      repositories: [{ id: 'repo-1', capabilities: development.map((key) => ({ key, access: 'available' })) }],
    },
    metadata: { planningSourceName: 'Planning source', sourceNames: { 'planning-1': 'Planning source' } },
  }
  const list = deriveWorkItemListView(input)
  const detail = deriveWorkItemDetailView(input, { projectId: 'ws-1', itemId: selected })
  const listHtml = renderToStaticMarkup(createElement(ui.WorkItemListPage, { view: list }))
  const detailHtml = renderToStaticMarkup(createElement(ui.WorkItemDetailDrawer, { view: detail, onClose() {}, startWork, connected: true }))
  return { input, list, detail, listHtml, detailHtml }
}

function startWorkSection(html) {
  return html.match(/<section\b(?=[^>]*aria-label="开始工作")[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? ''
}

test('Planning read-only describes only planning and keeps Start Work governed by Development gates', () => {
  const allowed = renderPair()
  assert.equal(allowed.list.readOnly, true)
  assert.match(allowed.listHtml, /只读：规划来源仅允许读取，此处展示规划内容。/)
  assert.doesNotMatch(allowed.listHtml, /不提供编辑或开始工作入口/)
  assert.equal(allowed.detail.body.kind, 'content')
  assert.equal(allowed.detail.body.startWorkRepositories[0].available, true)
  assert.match(startWorkSection(allowed.detailHtml), /<button\b[^>]*>开始工作<\/button>/)
  assert.doesNotMatch(`${allowed.listHtml}${allowed.detailHtml}`, /READ-ONLY-CANARY/)

  const missingCreate = renderPair({ development: gates.filter((key) => key !== 'development.branch.create') })
  assert.equal(missingCreate.list.readOnly, true)
  assert.equal(missingCreate.detail.body.startWorkRepositories[0].available, false)
  assert.match(startWorkSection(missingCreate.detailHtml), /<button\b[^>]*>开始工作<\/button>/)

  const missingWriteGate = renderPair({ planning: 'available', development: gates.filter((key) => key !== 'development.worktree.create') })
  assert.equal(missingWriteGate.list.readOnly, false)
  assert.equal(missingWriteGate.detail.body.startWorkRepositories[0].available, false)

  const planningUnknown = renderPair({ planning: null })
  assert.equal(planningUnknown.list.body.kind, 'unavailable')
  assert.equal(planningUnknown.detail.body.kind, 'unavailable')
  assert.doesNotMatch(planningUnknown.detailHtml, /aria-label="开始工作"|Visible item|READ-ONLY-CANARY/)

  const planningUnavailable = renderPair({ planning: 'unavailable' })
  assert.equal(planningUnavailable.list.body.kind, 'unavailable')
  assert.equal(planningUnavailable.detail.body.kind, 'unavailable')
  assert.doesNotMatch(planningUnavailable.detailHtml, /aria-label="开始工作"|Visible item|READ-ONLY-CANARY/)

  const hidden = renderPair({ selected: 'item-hidden' })
  assert.equal(hidden.detail.body.kind, 'redacted')
  assert.doesNotMatch(`${hidden.listHtml}${hidden.detailHtml}`, /READ-ONLY-CANARY/)
})
