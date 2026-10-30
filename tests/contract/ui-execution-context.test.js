import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import test from 'node:test'
import * as client from '@harness-projects/client'
import { deriveWorkItemDetailView } from '@harness-projects/ui-model'
import { createExecutionFixture, startExecutionServer } from '../fixtures/execution-drawer-browser.mjs'
import { wire, redacted } from '../fixtures/work-item-wire.mjs'
const target = { workspaceId: 'ws-1', workItemId: 'ent-aa', repositoryId: 'repo-a' }
const dto = { ...target, status: 'ready', runStatus: 'running', fallback: 'manual_fallback', branchExternalId: 'work/one', worktreeExternalId: '/fixture/work' }
test('reader decodes nullable JSON roundtrip and rejects extra fields, states, prototypes and scope', async () => {
  assert.equal(typeof client.createExecutionContextReader, 'function')
  const read = (value) => client.createExecutionContextReader(async () => JSON.parse(JSON.stringify(value)))(target)
  assert.equal(await read({ context: null }), null)
  assert.deepEqual(await read({ context: dto }), dto)
  for (const value of [{}, { context: null, extra: 1 }, { context: { ...dto, runStatus: 'complete' } }, { context: { ...dto, status: 'running' } }, { context: { ...dto, fallback: 'failed' } }, { context: { ...dto, worktreeExternalId: 3 } }, ...['workspaceId', 'workItemId', 'repositoryId'].map((key) => ({ context: { ...dto, [key]: 'other' } })), { context: { ...dto, providerRef: 'SECRET' } }]) await assert.rejects(() => read(value), TypeError)
  await assert.rejects(() => client.createExecutionContextReader(async () => Object.create({ context: dto }))(target), TypeError)
})
const view = (entity, repositories) => {
  const store = client.createEntityStore(); store.applyBaseline({ revision: 0, entities: [entity], source: { revision: 0, freshness: 'fresh', authority: 'provider' } })
  return deriveWorkItemDetailView({ read: { workspace: { id: 'ws-1', name: 'Fixture' }, store, connection: { connected: true }, capabilities: [{ key: 'planning.item.read', access: 'available' }], repositories }, phase: 'received', refreshing: false, metadata: { sourceNames: {} } }, { projectId: 'ws-1', itemId: 'ent-aa' }).body
}
test('executionTarget is generated only for revalidated WorkItem, includes all sorted repositories', () => {
  assert.deepEqual(view(wire('ent-aa'), [{ id: 'repo-z' }, { id: 'repo-a' }]).executionTarget, { workspaceId: 'ws-1', workItemId: 'ent-aa', repositoryIds: ['repo-a', 'repo-z'] })
  assert.deepEqual(view(wire('ent-aa')).executionTarget.repositoryIds, [])
  for (const entity of [redacted('ent-aa'), wire('ent-aa', { content: { contentKind: 'change_request' } })]) assert.equal(view(entity, [{ id: 'repo-a' }]).executionTarget, undefined)
})

import { createRequire } from 'node:module'
import * as ui from '@harness-projects/ui'
const uiRequire = createRequire(new URL('../../packages/ui/package.json', import.meta.url)), React = uiRequire('react')
const { renderToStaticMarkup } = uiRequire('react-dom/server')
function harness(props) {
  const slots = []; let cursor = 0, pending = []
  const slot = (make) => slots[cursor++] ?? (slots[cursor - 1] = make())
  const dispatcher = {
    useRef: (value) => slot(() => ({ current: value })),
    useState: (value) => { const cell = slot(() => ({ value })); return [cell.value, (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next }] },
    useEffect: (run, deps) => { const cell = slot(() => ({})); if (!cell.deps || deps.some((dep, index) => !Object.is(dep, cell.deps[index]))) pending.push(() => { cell.cleanup?.(); cell.cleanup = run() }); cell.deps = deps },
  }
  return {
    props,
    render() { const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, old = internals.ReactCurrentDispatcher.current; internals.ReactCurrentDispatcher.current = dispatcher; cursor = 0
      try { return ui.ExecutionContextSection(props) } finally { internals.ReactCurrentDispatcher.current = old } },
    flush() { const effects = pending; pending = []; effects.forEach((run) => run()) },
    close() { slots.forEach((cell) => cell.cleanup?.()) },
  }
}
const text = (h) => renderToStaticMarkup(h.render())
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
const requests = () => { const pending = []; return { pending, reader: (scope) => new Promise((resolve, reject) => pending.push({ scope, resolve, reject })) } }
const sectionTarget = { workspaceId: 'ws-1', workItemId: 'ent-aa', repositoryIds: ['repo-a', 'repo-z'] }
function repositoryPanels(h) {
  const parts = text(h).split(/<h4>仓库：([^<]+)<\/h4>/), entries = []
  for (let index = 1; index < parts.length; index += 2) entries.push([parts[index], parts[index + 1]])
  assert.equal(new Set(entries.map(([id]) => id)).size, entries.length, '每仓库只能有一个展示段')
  return Object.fromEntries(entries)
}
async function refresh(h) {
  h.render().props.children.find((child) => child?.type === 'button').props.onClick()
  text(h); h.flush(); await settle()
}
test('execution section isolates late success/rejection, disconnect, replacement and refresh; multi-repo does not choose first', async () => {
  assert.equal(typeof ui.ExecutionContextSection, 'function')
  const q = requests(), h = harness({ target: sectionTarget, reader: q.reader, connected: true })
  text(h); h.flush(); await settle(); assert.deepEqual(q.pending.map((call) => call.scope.repositoryId), ['repo-a', 'repo-z'])
  q.pending[0].resolve(dto); q.pending[1].reject(new Error('SECRET')); await settle()
  assert.match(text(h), /fixture\/work/); assert.match(text(h), /暂时无法读取执行状态/); assert.doesNotMatch(text(h), /SECRET/)
  assert.match(text(h), /人工处理，可在该工作树继续/)
  h.props.connected = false; assert.match(text(h), /最后已读/); h.flush(); await settle()
  h.props.target = { ...sectionTarget, workItemId: 'ent-bb' }; assert.doesNotMatch(text(h), /fixture\/work/); h.flush(); await settle()
  h.props.connected = true; text(h); h.flush(); await settle(); const b = q.pending.slice(2)
  h.props.target = sectionTarget; assert.doesNotMatch(text(h), /fixture\/work/); h.flush(); await settle()
  b[0].resolve({ ...dto, workItemId: 'ent-bb', worktreeExternalId: 'LATE-B' }); b[1].reject(new Error('LATE-ERROR')); await settle()
  assert.doesNotMatch(text(h), /LATE-|fixture\/work/)
  for (const call of q.pending.slice(4)) call.resolve(null); await settle(); assert.match(text(h), /尚未开始工作/)
  assert.doesNotMatch(text(h), /LATE-|fixture\/work/, '新目标结果完成后仍不能恢复旧目标路径')
  const button = h.render().props.children.find((child) => child?.type === 'button'); button.props.onClick(); text(h); h.flush(); await settle()
  q.pending.at(-2).resolve({ ...dto, runStatus: 'succeeded' }); q.pending.at(-1).resolve({ ...dto, repositoryId: 'repo-z', worktreeExternalId: '/fixture/z', branchExternalId: 'work/z', fallback: undefined, runStatus: 'failed' }); await settle()
  assert.match(text(h), /已完成/); assert.match(text(h), /失败/); assert.match(text(h), /repo-z/)
  const panels = repositoryPanels(h); assert.deepEqual(Object.keys(panels), ['repo-a', 'repo-z'])
  assert.match(panels['repo-a'], /fixture\/work/); assert.doesNotMatch(panels['repo-a'], /fixture\/z/)
  assert.match(panels['repo-z'], /fixture\/z/); assert.doesNotMatch(panels['repo-z'], /fixture\/work|人工处理/)
  button.props.onClick(); text(h); h.flush(); await settle(); h.close(); q.pending.at(-2).reject(new Error('UNMOUNTED')); q.pending.at(-1).resolve(dto); await settle()
  assert.doesNotMatch(text(h), /UNMOUNTED/)
})
test('refresh failure preserves each repository last success including null, then replaces it on success', async () => {
  const q = requests(), h = harness({ target: sectionTarget, reader: q.reader, connected: true })
  text(h); h.flush(); await settle(); q.pending[0].resolve(dto); q.pending[1].resolve(null); await settle()
  await refresh(h)
  let panels = repositoryPanels(h)
  assert.match(panels['repo-a'], /fixture\/work/); assert.match(panels['repo-a'], /work\/one/)
  assert.match(panels['repo-a'], /人工处理/); assert.match(panels['repo-a'], /最后已读/)
  assert.match(panels['repo-z'], /尚未开始工作/); assert.match(panels['repo-z'], /最后已读/)
  q.pending[2].reject(new Error('SECRET-A')); q.pending[3].reject(new Error('SECRET-Z')); await settle()
  panels = repositoryPanels(h)
  for (const panel of Object.values(panels)) { assert.match(panel, /暂时无法读取执行状态/); assert.match(panel, /最后已读/); assert.doesNotMatch(panel, /SECRET-/) }
  assert.match(panels['repo-a'], /fixture\/work/); assert.match(panels['repo-a'], /work\/one/); assert.match(panels['repo-a'], /人工处理/)
  assert.match(panels['repo-z'], /尚未开始工作/); assert.doesNotMatch(panels['repo-z'], /工作树：|尚无已读/)
  await refresh(h)
  q.pending[4].resolve({ ...dto, worktreeExternalId: '/fixture/new', branchExternalId: 'work/new', runStatus: 'succeeded', fallback: undefined })
  q.pending[5].resolve({ ...dto, repositoryId: 'repo-z', worktreeExternalId: '/fixture/z', branchExternalId: 'work/z', runStatus: 'failed', fallback: undefined }); await settle()
  panels = repositoryPanels(h)
  assert.deepEqual(Object.keys(panels), ['repo-a', 'repo-z'])
  assert.match(panels['repo-a'], /fixture\/new/); assert.match(panels['repo-a'], /work\/new/); assert.match(panels['repo-a'], /已完成/)
  assert.doesNotMatch(panels['repo-a'], /fixture\/work|work\/one|人工处理|最后已读|暂时无法/)
  assert.match(panels['repo-z'], /fixture\/z/); assert.match(panels['repo-z'], /失败/); assert.doesNotMatch(panels['repo-z'], /尚未开始工作|fixture\/new/)
  for (const panel of Object.values(panels)) for (const label of ['工作树：', '分支：', '运行状态：']) assert.equal(panel.split(label).length - 1, 1, label)
  await refresh(h); q.pending[6].reject(new Error('ONE-FAILED')); q.pending[7].resolve(null); await settle()
  panels = repositoryPanels(h)
  assert.match(panels['repo-a'], /fixture\/new/); assert.match(panels['repo-a'], /最后已读/); assert.match(panels['repo-a'], /暂时无法/)
  assert.match(panels['repo-z'], /尚未开始工作/); assert.doesNotMatch(panels['repo-z'], /fixture\/z|最后已读|暂时无法/)
  h.props.target = { ...sectionTarget, repositoryIds: ['repo-z'] }; assert.doesNotMatch(text(h), /fixture\/new|fixture\/z/); h.flush(); await settle()
  q.pending[8].reject(new Error('NO-CACHE')); await settle(); assert.doesNotMatch(text(h), /fixture\/new|fixture\/z|最后已读/)
})
test('same-target refresh keeps the newest per-repository result when older successes arrive last', async () => {
  const q = requests(), h = harness({ target: sectionTarget, reader: q.reader, connected: true })
  text(h); h.flush(); await settle(); q.pending[0].resolve(dto); q.pending[1].resolve(null); await settle()
  await refresh(h); const old = q.pending.slice(2, 4)
  await refresh(h); const newest = q.pending.slice(4, 6)
  newest[0].resolve({ ...dto, worktreeExternalId: 'NEW-A', branchExternalId: 'new/a', runStatus: 'succeeded' }); newest[1].resolve(null); await settle()
  old[0].resolve({ ...dto, worktreeExternalId: 'OLD-RACE-A' }); old[1].resolve({ ...dto, repositoryId: 'repo-z', worktreeExternalId: 'OLD-RACE-Z' }); await settle()
  const panels = repositoryPanels(h); assert.deepEqual(Object.keys(panels), ['repo-a', 'repo-z'])
  assert.match(panels['repo-a'], /NEW-A/); assert.match(panels['repo-a'], /已完成/); assert.match(panels['repo-z'], /尚未开始工作/)
  assert.doesNotMatch(text(h), /OLD-RACE-|fixture\/work|正在刷新|暂时无法/)
  assert.equal(text(h).split('工作树：').length - 1, 1)
  await refresh(h); const disconnected = q.pending.slice(6, 8)
  h.props.connected = false; text(h); h.flush(); await settle()
  disconnected[0].resolve({ ...dto, worktreeExternalId: 'DISCONNECTED-LATE' }); disconnected[1].reject(new Error('DISCONNECTED-ERROR')); await settle()
  assert.match(text(h), /NEW-A/); assert.match(text(h), /最后已读/); assert.doesNotMatch(text(h), /DISCONNECTED-|暂时无法/)
  h.props.connected = true; text(h); h.flush(); await settle(); assert.equal(q.pending.length, 10)
  q.pending[8].resolve({ ...dto, worktreeExternalId: 'RECONNECTED' }); q.pending[9].resolve(null); await settle()
  assert.match(text(h), /RECONNECTED/); assert.doesNotMatch(text(h), /NEW-A|最后已读|DISCONNECTED-/)
})
test('no repository metadata is distinct from all-null; unavailable fields have neutral placeholders and text is escaped', async () => {
  assert.equal(typeof ui.ExecutionContextSection, 'function')
  const q = requests(), h = harness({ target: { ...sectionTarget, repositoryIds: [] }, reader: q.reader, connected: true })
  assert.match(text(h), /仓库信息尚未提供/); h.flush(); await settle(); assert.equal(q.pending.length, 0)
  h.props.target = { ...sectionTarget, repositoryIds: ['repo-a'] }; text(h); h.flush(); await settle(); q.pending[0].resolve({ ...target, status: 'ready', runStatus: 'unknown', worktreeExternalId: '<script>bad</script>' }); await settle()
  assert.match(text(h), /状态未知/); assert.match(text(h), /分支尚未提供/); assert.match(text(h), /&lt;script&gt;/); assert.doesNotMatch(text(h), /<script>/)
})

test('existing refresh button commands each repository then rereads durable stale even on command failure', async () => {
  const calls = [], reader = client.createExecutionContextReader(async (scope) => { calls.push(['read', scope.repositoryId]); return { context: { ...dto, repositoryId: scope.repositoryId, runConfirmedAt: '2026-10-28T01:00:00Z', runStale: calls.some(([kind]) => kind === 'refresh') } } }, async (scope) => { calls.push(['refresh', scope.repositoryId]); throw Error('SECRET') })
  const h = harness({ target: sectionTarget, reader, connected: true }); text(h); h.flush(); await settle()
  assert.deepEqual(calls, [['read', 'repo-a'], ['read', 'repo-z']]); assert.match(text(h), /此状态于 2026-10-28T01:00:00Z 确认/)
  await refresh(h); await settle(); assert.deepEqual(calls.slice(2), [['refresh', 'repo-a'], ['refresh', 'repo-z'], ['read', 'repo-a'], ['read', 'repo-z']])
  assert.match(text(h), /最后确认，当前无法核对/); assert.match(text(h), /暂时无法读取执行状态/); assert.doesNotMatch(text(h), /SECRET/)
  for (const patch of [{ runStale: 'yes' }, { runConfirmedAt: 5 }, { runConfirmedAt: 'invalid' }]) await assert.rejects(() => client.createExecutionContextReader(async () => ({ context: { ...dto, ...patch } }))(target), TypeError)
})

test('actual button reads issuing Provider through Host remote and renders the decoded confirmation', async (t) => {
  const fixture = await createExecutionFixture(); t.after(fixture.close); let calls = 0
  fixture.mounted[0].getRun = async (ref) => { calls++; return { ok: true, value: { ref, status: 'succeeded' } } }
  const reader = client.createExecutionContextReader(async ({ workItemId, repositoryId }) => JSON.parse(JSON.stringify(await fixture.installed.service.getExecutionContext(workItemId, repositoryId))), async ({ workItemId, repositoryId }) => { await fixture.installed.service.refreshExecutionRun({ kind: 'human' }, workItemId, repositoryId) })
  const h = harness({ target: { workspaceId: fixture.workspaceId, workItemId: fixture.itemId, repositoryIds: ['repo-alpha'] }, reader, connected: true })
  text(h); h.flush(); for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)); assert.equal(calls, 0); assert.match(text(h), /运行中/)
  await refresh(h); for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)); assert.equal(calls, 1); assert.match(text(h), /已完成/); assert.match(text(h), /此状态于 .* 确认/); h.close()
})
test('unconfirmed unknown remains visibly stale without inventing a confirmation time', async () => {
  const h = harness({ target: { ...sectionTarget, repositoryIds: ['repo-a'] }, reader: async () => ({ ...dto, runStatus: 'unknown', runStale: true }), connected: true })
  text(h); h.flush(); await settle(); assert.match(text(h), /状态未知/); assert.match(text(h), /当前无法核对运行状态/); assert.doesNotMatch(text(h), /此状态于/); h.close()
})
test('target cleanup before queued refresh begins suppresses the old command', async () => {
  const calls = [], reader = Object.assign(async (scope) => { calls.push(['read', scope.workItemId]); return null }, { refresh: async (scope) => { calls.push(['refresh', scope.workItemId]) } })
  const h = harness({ target: sectionTarget, reader, connected: true }); text(h); h.flush(); await settle(); calls.length = 0
  h.render().props.children.find((child) => child?.type === 'button').props.onClick(); text(h); h.flush()
  h.props.target = { ...sectionTarget, workItemId: 'ent-bb' }; text(h); h.flush(); await settle()
  assert.ok(calls.every(([kind, id]) => kind === 'read' && id === 'ent-bb')); h.close()
})

test('run state, stale confirmation and manual next step stay outside collapsible technical sources', async () => {
  let reads = 0
  const h = harness({ target: { ...sectionTarget, repositoryIds: ['repo-a'] }, connected: true, reader: async () => { reads++; return { ...dto, runStatus: 'unknown', runStale: true, runConfirmedAt: '2026-10-28T01:00:00Z' } } })
  text(h); h.flush(); await settle()
  const html = text(h), disclosure = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/g) ?? []
  assert.equal(disclosure.length, 1, 'each repository has one native technical-source disclosure')
  assert.match(disclosure[0], /<summary[^>]*>执行来源<\/summary>/); assert.doesNotMatch(disclosure[0], / open(?:=|>)/)
  assert.match(disclosure[0], /fixture\/work|work\/one/)
  const visible = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
  for (const fact of ['状态未知', '最后确认，当前无法核对', '2026-10-28T01:00:00Z', '人工处理，可在该工作树继续', '刷新执行状态']) assert.ok(visible.includes(fact), fact)
  assert.doesNotMatch(visible, /fixture\/work|work\/one|已完成/)
  text(h); text(h); h.flush(); await settle(); assert.equal(reads, 1, 'presentation rerenders cannot read the Provider'); h.close()
})
test('missing run and missing time remain explicit beside hidden paths', async () => {
  const h = harness({ target: { ...sectionTarget, repositoryIds: ['repo-a'] }, connected: true, reader: async () => ({ ...target, status: 'ready' }) })
  text(h); h.flush(); await settle()
  const visible = text(h).replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
  assert.match(visible, /尚无运行记录/); assert.doesNotMatch(visible, /此状态于|已完成|运行成功/); h.close()
})

test('browser showcase transports setup, execution, start and lineage through strict production clients', async (t) => {
  const server = await startExecutionServer(); t.after(server.close)
  const call = async (method, args) => (await (await fetch(`${server.url}/remote?scenario=all`, { method: 'POST', body: JSON.stringify({ method, args }) })).json()).value
  const setup = client.createWorkspaceSetupSource({ getWorkspaceSetup: () => call('getWorkspaceSetup', []) }, { actorRef: { kind: 'human' } }); t.after(setup.dispose)
  await setup.refresh(); assert.equal(setup.getSnapshot().setup?.planning.state, 'confirmed')
  const scope = { workspaceId: server.workspaceId, workItemId: server.itemId, repositoryId: 'repo-alpha' }
  const reader = client.createDeliveryLineageReader({ read: () => call('getDeliveryProjection', [server.itemId, 'repo-alpha']), refresh: () => call('refreshDeliveryFacts', [{ kind: 'human' }, server.itemId, 'repo-alpha']) })
  await reader.refresh(scope); const read = await reader.read(scope); assert.equal(read.projection.hops.length, 3)
  const start = client.createStartWork({ getStartWorkOptions: (id) => call('getStartWorkOptions', [id]), startWork: (...args) => call('startWork', args) }, async () => null, { kind: 'human' })
  assert.equal((await start.options(scope)).executionMode, 'manual'); assert.equal((await start.submit(scope)).writeState, 'unknown')
  const execution = client.createExecutionContextReader(async () => (await (await fetch(`${server.url}/context?scenario=all`, { method: 'POST', body: JSON.stringify(scope) })).json()).value)
  assert.equal((await execution(scope)).runStatus, 'unknown'); assert.equal((await execution(scope)).runStale, true)
})
