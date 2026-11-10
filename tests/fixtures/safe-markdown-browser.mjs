/** Real browser consumer of the same detail projection and drawer; synthetic content is not installed-Host evidence. */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(new URL('../../apps/harness-plugin/package.json', import.meta.url))
const { build } = require('esbuild')

export async function markdownBundle({ production = false, composite = false } = {}) {
  const result = await build({ stdin: { contents: `
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync as flush } from 'react-dom'
import { createEntityStore } from '@harness-projects/client'
import { deriveWorkItemDetailView } from '@harness-projects/ui-model'
import { WorkItemDetailDrawer, WorkItemApp } from '@harness-projects/ui'
const root = createRoot(document.getElementById('app'))
window.setMarkdown = (body, mode = 'content', repository, namespace = 'github.com/graphql/Repository') => {
  const store = createEntityStore()
  store.applyBaseline({ revision: 1, entities: [{ entityId: 'ent-aa', kind: 'work_item', planningStatus: 'todo', derived: [],
    content: { contentKind: mode === 'redacted' ? 'redacted' : 'work_item', title: 'Markdown fixture', body, bindingId: 'bind-1', externalKind: 'issue', externalId: '1',
      ...(repository && mode !== 'redacted' ? { sourceNumber: { sourceName: 'Display', scopeIdentity: { namespace, id: 'repo-' + repository }, scopeName: repository, number: 1 } } : {}) },
    source: { revision: 1, freshness: 'fresh', authority: 'provider' } }], source: { revision: 1, freshness: 'fresh', authority: 'provider' } })
  const input = { read: { workspace: { id: 'ws-1', name: 'Workspace' }, store, connection: { connected: true }, capabilities: [{ key: 'planning.item.read', access: 'available' }],
      planningSource: { bindingId: mode === 'wrong-binding' ? 'other-binding' : 'bind-1' } },
    metadata: { planningSourceName: 'Source', sourceNames: {} }, phase: mode === 'loading' ? 'pending' : 'received', refreshing: false }
  if (mode === 'unavailable') Object.assign(input, { phase: 'failed', hasReceivedSnapshot: true, cacheVisibility: 'authorized', failure: { kind: 'permission_denied' } })
  const view = deriveWorkItemDetailView(input, { projectId: mode === 'wrong-workspace' ? 'wrong' : 'ws-1', itemId: mode === 'unresolved' ? 'missing' : 'ent-aa' })
  if (${composite}) {
    const read = input.read, source = { subscribe: () => () => {}, getSnapshot: () => read }
    flush(() => root.render(createElement(WorkItemApp, { key: body, source, initialPath: '/projects/ws-1/items/ent-aa' })))
    return
  }
  flush(() => root.render(createElement(WorkItemDetailDrawer, { view, onClose() { root.render(null) } })))
}
`, resolveDir: fileURLToPath(new URL('../../packages/ui', import.meta.url)), sourcefile: 'safe-markdown-browser-entry.js' }, bundle: true, platform: 'browser', format: 'iife', write: false, ...(production ? { define: { 'process.env.NODE_ENV': '"production"' } } : {}) })
  return result.outputFiles[0].text
}
