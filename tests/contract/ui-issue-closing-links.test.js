import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import * as model from '@harness-projects/ui-model'
import { createEntityStore } from '@harness-projects/client'
const ui = await import('../../packages/ui/src/issue-closing-links-section.ts').catch(() => ({}))
import { wire, T } from '../fixtures/work-item-wire.mjs'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url)), React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const scope = { workspaceId: 'ws', workItemId: 'wi' }, target = { ...scope, sourceToken: 'source-1', accessToken: 'access-1' }
const observation = (over = {}) => ({ workItemId: 'wi', scopeToken: 'host:1', state: 'complete', coverage: { native_reference: { state: 'complete', stale: false, observedAt: T }, native_closing: { state: 'complete', stale: false, observedAt: T } }, stale: false, observedAt: T, links: [{ repositoryId: 'OPAQUE-REPO', bindingId: 'OPAQUE-BIND', externalId: 'OPAQUE-ID', repositoryName: 'actual/repo', number: 159, title: 'SAFE-TITLE', url: 'https://example.test/pull/159', state: 'merged', isDraft: false, provenance: 'source_observed', relations: ['native_closing'] }], ...over })
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }
function harness(props) {
  const cells = []; let cursor = 0, pending = [], writes = 0
  const slot = make => cells[cursor++] ?? (cells[cursor - 1] = make())
  const dispatcher = { useRef: value => slot(() => ({ current: value })), useState: value => { const cell = slot(() => ({ value })); return [cell.value, next => { writes++; cell.value = typeof next === 'function' ? next(cell.value) : next }] }, useEffect: (run, deps) => { const cell = slot(() => ({})); if (!cell.deps || deps.some((dep, i) => !Object.is(dep, cell.deps[i]))) pending.push(() => { cell.cleanup?.(); cell.cleanup = run() }); cell.deps = deps; cell.run = run } }
  const render = () => { const d = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher, old = d.current; d.current = dispatcher; cursor = 0; try { return ui.IssueClosingLinksSection(props) } finally { d.current = old } }
  return { props, render, text: () => renderToStaticMarkup(render()), flush() { const jobs = pending; pending = []; jobs.forEach(run => run()) }, replay: () => cells.filter(cell => cell.run).forEach(cell => { cell.cleanup?.(); cell.cleanup = cell.run() }), close: () => cells.forEach(cell => cell.cleanup?.()), get writes() { return writes } }
}
test('safe current primary Issue locator is independent of execution capabilities and hides non-content sources', () => {
  const store = createEntityStore(), entity = wire('wi')
  store.applyBaseline({ revision: 1, entities: [entity], source: entity.source })
  const read = { workspace: { id: 'ws', name: 'workspace' }, store, connection: { connected: true }, lastUpdatedAt: T, planningSource: { bindingId: 'bind-1', name: 'Source' }, capabilities: [{ key: 'planning.item.read', access: 'available' }] }
  const input = { read, metadata: { sourceNames: {} }, phase: 'received', refreshing: false }, derive = () => model.deriveWorkItemDetailView(input, { projectId: 'ws', itemId: 'wi' }).body
  const first = derive().issueClosingLinksTarget; assert.ok(first, 'current Issue must have a source reader target'); assert.equal(first.workItemId, 'wi'); assert.equal(first.workspaceId, 'ws')
  read.reason = 'source incomplete'; assert.equal(derive().issueClosingLinksTarget.accessToken, first.accessToken, 'freshness reason is not an access change')
  read.nativeAccessVersion = 'native-1'; assert.notEqual(derive().issueClosingLinksTarget.accessToken, first.accessToken); assert.equal(derive().issueClosingLinksTarget.sourceToken, first.sourceToken)
  read.generation = 'new-host'; assert.notEqual(derive().issueClosingLinksTarget.accessToken, first.accessToken)
  read.repositories = [{ id: 'repo', capabilities: [], accessVersion: 'withdrawn' }]; assert.notEqual(derive().issueClosingLinksTarget.accessToken, first.accessToken)
  for (const kind of ['draft', 'change_request']) { entity.content.externalKind = kind; assert.equal(derive().issueClosingLinksTarget, undefined) }
  entity.content.externalKind = 'issue'; read.planningSource.bindingId = 'different'; assert.equal(derive().issueClosingLinksTarget, undefined)
  entity.content.contentKind = 'redacted'; assert.deepEqual(derive(), { kind: 'redacted' })
})
test('display union omits opaque IDs, sanitizes links and distinguishes incomplete observations', () => {
  assert.equal(typeof model.deriveIssueClosingLinksView, 'function')
  const view = model.deriveIssueClosingLinksView(observation()); assert.match(JSON.stringify(view), /actual\/repo|SAFE-TITLE/); assert.doesNotMatch(JSON.stringify(view), /OPAQUE|scopeToken/)
  for (const url of ['javascript:alert(1)', 'data:text/html,secret', '//example.test', '/relative', 'https://user:secret@example.test', 'https://example.test/\nunsafe']) {
    const value = observation(); value.links[0].url = url; assert.equal(model.deriveIssueClosingLinksView(value).links[0].href, undefined)
  }
  assert.match(model.deriveIssueClosingLinksView(observation({ links: [] })).message, /来源已确认无/)
  for (const state of ['partial', 'unread', 'denied', 'unsupported', 'unavailable']) assert.doesNotMatch(model.deriveIssueClosingLinksView(observation({ state, links: [], stale: true })).message, /已确认无/)
})
test('consumer refresh/query once, masks before effects, rejects late scope and preserves only Host allowed stale facts', async () => {
  assert.equal(typeof ui.IssueClosingLinksSection, 'function')
  const pending = [], calls = []; let hold = false, value = observation()
  const reader = { refresh: async () => { calls.push('refresh'); return value.scopeToken }, read: async s => { calls.push('read'); return hold ? new Promise(resolve => pending.push(resolve)) : { ...s, observation: value } } }
  const h = harness({ target, reader, connected: true }); h.text(); h.flush(); await settle()
  assert.deepEqual(calls, ['refresh', 'read']); assert.match(h.text(), /SAFE-TITLE|合并时关闭|已合并/); assert.doesNotMatch(h.text(), /OPAQUE|已确认关系|implements/)
  h.text(); h.flush(); await settle(); assert.equal(calls.length, 2)
  hold = true; h.props.target = { ...target, accessToken: 'revoked' }; assert.doesNotMatch(h.text(), /SAFE-TITLE/); h.flush(); await settle()
  h.props.target = { ...target, workItemId: 'other' }; h.text(); h.flush(); await settle(); pending.shift()({ ...scope, observation: value }); await settle(); assert.doesNotMatch(h.text(), /SAFE-TITLE/)
  pending.shift()({ workspaceId: 'ws', workItemId: 'wrong', observation: value }); await settle(); assert.doesNotMatch(h.text(), /SAFE-TITLE/)
  h.props.target = target; hold = false; value = observation({ stale: true, state: 'partial' }); h.text(); h.flush(); await settle(); assert.match(h.text(), /最后已知|读取不完整/)
  h.props.connected = false; assert.doesNotMatch(h.text(), /SAFE-TITLE/); h.flush(); await settle()
  h.props.connected = true; hold = true; h.text(); h.flush(); await settle(); const writes = h.writes; h.close(); pending.shift()({ ...scope, observation: value }); await settle(); assert.equal(h.writes, writes)
})

test('effect replay deduplicates opening refresh and same-scope manual races accept only the newest response', async () => {
  const pending = []; let refreshes = 0
  const reader = { refresh: async () => { refreshes++; return 'host:1' }, read: s => new Promise((resolve, reject) => pending.push({ s, resolve, reject })) }
  const h = harness({ target, reader, connected: true }); h.text(); h.flush(); h.replay(); await settle()
  assert.equal(refreshes, 1); assert.equal(pending.length, 1)
  const click = () => h.render().props.children.at(-1).props.onClick()
  click(); await settle(); click(); await settle()
  const latest = observation(); latest.links[0].title = 'LATEST'
  pending[2].resolve({ ...scope, observation: latest }); await settle(); assert.match(h.text(), /LATEST/)
  pending[0].resolve({ ...scope, observation: observation() }); pending[1].reject(new Error('SECRET-LATE')); await settle()
  assert.match(h.text(), /LATEST/); assert.doesNotMatch(h.text(), /SAFE-TITLE|SECRET-LATE/)
  click(); await settle(); pending[3].reject(new Error('SECRET-READ')); await settle()
  assert.doesNotMatch(h.text(), /LATEST|SECRET/); assert.match(h.text(), /当前无法读取来源关联/); h.close()
})

test('same source authority version changes mask synchronously and query without an actual probe', async () => {
  const calls = [], pending = []; let hold = false
  const reader = { refresh: async () => { calls.push('refresh'); return 'host:1' }, read: async s => { calls.push('read'); return hold ? new Promise(resolve => pending.push(resolve)) : { ...s, observation: observation() } } }
  const h = harness({ target, reader, connected: true }); h.text(); h.flush(); await settle(); assert.match(h.text(), /SAFE-TITLE/)
  hold = true; h.render().props.children.at(-1).props.onClick(); await settle()
  h.props.target = { ...target, accessToken: 'native-denial-version' }; assert.doesNotMatch(h.text(), /SAFE-TITLE/); h.flush(); await settle()
  assert.deepEqual(calls, ['refresh', 'read', 'refresh', 'read', 'read'], 'authority metadata must never trigger another probe')
  const denied = observation({ state: 'unread', links: [], stale: true }); delete denied.observedAt
  pending[1]({ ...scope, observation: denied }); await settle(); pending[0]({ ...scope, observation: observation() }); await settle(); assert.doesNotMatch(h.text(), /SAFE-TITLE/)
  h.text(); h.flush(); await settle(); assert.equal(calls.length, 5)
  hold = false; h.render().props.children.at(-1).props.onClick(); await settle(); assert.match(h.text(), /SAFE-TITLE/); assert.deepEqual(calls.slice(-2), ['refresh', 'read']); h.close()
})

test('relation badges distinguish refs-only, historical will-close and two current sources', () => {
  for (const [relations, hint, expected] of [[['native_reference'], false, /仅引用/], [['native_reference'], true, /关闭关系尚未确认/], [['native_reference', 'native_closing'], true, /原生引用.*合并时关闭/]]) {
    const value = observation(); value.links[0].relations = relations; value.links[0].referenceWillCloseTarget = hint
    assert.match(model.deriveIssueClosingLinksView(value).links[0].relation, expected)
  }
})
