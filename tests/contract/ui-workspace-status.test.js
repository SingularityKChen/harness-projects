import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkspaceSetupSource, createPlanningMappingSource, createRepositoryBindingSource, createEntityStore } from '@harness-projects/client'
import { deriveWorkspaceStatus } from '../../packages/ui-model/src/workspace-status.ts'
const actorRef = { kind: 'user' }, timestamp = '2026-10-30T00:00:00Z'
const setup = (state = 'confirmed', id = 'workspace') => ({ workspace: { id, name: 'Current workspace' }, planning: state === 'unbound' ? { state } : { state, bindingId: 'binding', projectNodeId: 'project' } })
const scope = { workspaceId: 'workspace', bindingId: 'binding', projectExternalId: 'project' }
const mapping = { status: { projectFieldId: 'status', options: {} } }, data = { scope, mapping, fields: [], confirmed: false }
const result = (value, extra = {}) => ({ writeState: 'local_only', saving: false, authoritative: false, value, ...extra })
const error = (code = 'unavailable') => ({ code, recovery: code === 'result_unknown' ? 'refresh' : 'retry', retryable: code !== 'result_unknown', message: 'RAW-ERROR-CANARY' })
function fixture(t) {
  let current = setup(), command = result({ bindingId: 'binding' }), finish, mapResult = result({ bindingId: 'binding' }), repoResult = result(undefined, { writeState: 'unknown' })
  const source = createWorkspaceSetupSource({ getWorkspaceSetup: async () => current, connectAccount: async () => result({ accountId: 'account' }), bindPlanningSource: async () => command,
    createWorkspace: () => new Promise(resolve => { finish = resolve }), installExecutionBindings: async () => result({}), refreshPlanning: async () => result({}) }, { actorRef, key: () => 'intent' })
  const maps = createPlanningMappingSource({ getPlanningMapping: async () => data, setPlanningMapping: async () => mapResult }, { actorRef, key: () => 'mapping-intent' })
  const repos = createRepositoryBindingSource({ connectAccount: async () => result({ accountId: 'account' }), bindRepository: async () => repoResult, baseline: async () => ({ repositories: [] }) }, { actorRef, key: () => 'repo-intent' })
  t.after(() => { source.dispose(); maps.dispose(); repos.dispose() })
  const store = createEntityStore(); store.applyBaseline({ revision: 0, entities: [], source: { revision: 0, freshness: 'fresh', authority: 'provider' } })
  const read = { capabilities: [{ key: 'planning.item.read', access: 'available' }], workspace: { id: 'workspace', name: 'DO-NOT-USE-READ-NAME' }, connection: { connected: true }, planningSource: { bindingId: 'binding', name: 'Current project' }, reconciledAt: timestamp, lastUpdatedAt: '2099-01-01T00:00:00Z', store }
  return { source, maps, repos, read, set: value => { current = value }, mapResult: value => { mapResult = value }, repoResult: value => { repoResult = value }, command: value => { command = value }, finish: value => finish(value),
    view: (reading = read, extra = {}) => deriveWorkspaceStatus({ setup: source.getSnapshot(), read: reading, mapping: maps.getSnapshot(), repository: repos.getSnapshot(), ...extra }) }
}

test('configured is not confirmed; source confirmation uses only matching binding reconciledAt', async t => {
  const f = fixture(t)
  assert.equal(f.view(undefined).workspace, '工作区状态未知')
  f.set({ workspace: null, planning: { state: 'unbound' } }); await f.source.refresh(); assert.equal(f.view(undefined).workspace, '尚未创建工作区')
  for (const [state, expected] of [['unbound', '未绑定'], ['configured', '配置已记录，待确认'], ['confirmed', '已确认'], ['degraded', '读取不完整']]) {
    f.set(setup(state)); await f.source.refresh(); assert.equal(f.view().planning, expected)
  }
  assert.equal(f.view().confirmedAt, timestamp)
  assert.equal(f.view({ ...f.read, reconciledAt: undefined }).confirmedAt, undefined, 'client receive time cannot fill source confirmation')
  for (const read of [{ ...f.read, workspace: { id: 'old', name: 'OLD-WORKSPACE-CANARY' } }, { ...f.read, planningSource: { bindingId: 'old', name: 'OLD-PROJECT-CANARY' } }, { ...f.read, planningSource: undefined }]) {
    const view = f.view(read); assert.equal(view.confirmedAt, undefined); assert.equal(view.source, '当前来源观测未知'); assert.doesNotMatch(JSON.stringify(view), /OLD-|2099/)
  }
})

test('transport unknown, offline and recovery remain orthogonal to confirmed Planning', async t => {
  const f = fixture(t); await f.source.refresh()
  assert.equal(f.view(null).transport, '连接状态未知')
  assert.equal(f.view({ ...f.read, workspace: { id: 'old' } }).transport, '连接状态未知')
  const offline = f.view({ ...f.read, connection: { connected: false } })
  assert.equal(offline.transport, '连接中断'); assert.equal(offline.planning, '最后已知已确认'); assert.equal(offline.confirmedAt, timestamp)
  assert.equal(f.view().transport, '已连接'); assert.equal(f.view().planning, '已确认')
  f.set(setup('degraded')); await f.source.refresh(); assert.equal(f.view().planning, '读取不完整'); assert.equal(f.view().transport, '已连接')
})

test('real setup pending, failed and unknown facts persist without inventing an operation kind', async t => {
  const f = fixture(t); await f.source.refresh()
  const pending = f.source.create('Created'); assert.deepEqual(f.view().operations, ['工作区设置正在处理'])
  f.finish(result(undefined, { writeState: 'unknown' })); await pending
  assert.deepEqual(f.view().operations, ['工作区设置结果未知，请重新读取确认'])
  f.set({ ...setup(), error: error() }); await f.source.refresh(); assert.deepEqual(f.view().operations, ['工作区设置未完成'])
  f.set(setup()); await f.source.refresh(); assert.deepEqual(f.view().operations, [])
  assert.doesNotMatch(JSON.stringify(f.view()), /Saved|RAW-ERROR|已保存/)
})

test('mapping local-only/unknown/pending need all scope coordinates and never become Saved', async t => {
  const f = fixture(t); await f.source.refresh(); await f.maps.refresh(scope)
  await f.maps.save(mapping); assert.ok(f.view().operations.includes('字段映射配置已记录，待确认'))
  f.mapResult(result(undefined, { writeState: 'unknown' })); await f.maps.save({ status: { projectFieldId: 'other', options: {} } })
  assert.ok(f.view().operations.includes('字段映射结果未知，请重新读取确认'))
  for (const [coordinate, value] of [['workspaceId', 'old'], ['bindingId', 'old'], ['projectExternalId', 'old']]) {
    const stale = { ...f.maps.getSnapshot(), scope: { ...scope, [coordinate]: value } }
    assert.deepEqual(f.view(f.read, { mapping: stale }).operations, [], coordinate)
  }
  let release; f.mapResult(new Promise(resolve => { release = resolve })); const pending = f.maps.save({ targetDateFieldId: 'date' })
  assert.ok(f.view().operations.includes('字段映射正在处理')); release(result({ bindingId: 'binding' })); await pending
  assert.doesNotMatch(JSON.stringify(f.view()), /Saved|已保存/)
})

test('repository has generic unknown/configured facts, no path or invented workspace ownership', async t => {
  const f = fixture(t); await f.source.refresh()
  await f.repos.bind({ localPath: '/fixture/PRIVATE-PATH-CANARY', owner: 'fixture', name: 'repo' })
  assert.ok(f.view().operations.includes('仓库操作结果未知，请重新读取确认'))
  assert.ok(f.view(f.read, { repositoryFromEarlierWorkspace: true }).operations.includes('先前仓库操作结果未知，请重新读取确认'))
  f.repoResult(result({ repositoryId: 'github.com/fixture/repo', bindingIds: ['a', 'b', 'c'] })); await f.repos.bind({ localPath: '/fixture/PRIVATE-PATH-CANARY', owner: 'fixture', name: 'repo' })
  assert.ok(f.view().operations.includes('仓库操作配置已记录，待确认'))
  assert.doesNotMatch(JSON.stringify(f.view()), /PRIVATE-PATH|github.com|RAW-ERROR|Saved|已保存/)
})

import { createRequire } from 'node:module'
import { WorkItemApp, bindWorkspaceStatusApp } from '@harness-projects/ui'
const uiRequire = createRequire(new URL('../../packages/ui/package.json', import.meta.url)), React = uiRequire('react'), { renderToStaticMarkup } = uiRequire('react-dom/server')
test('outer status ownership keeps list freshness visible without a second live announcer; standalone default stays live', async t => {
  const f = fixture(t); await f.source.refresh()
  const source = { subscribe: () => () => {}, getSnapshot: () => ({ ...f.read, connection: { connected: false }, capabilities: [{ key: 'planning.item.read', access: 'available' }] }) }
  const page = announceListStatus => renderToStaticMarkup(React.createElement(WorkItemApp, { source, announceListStatus }))
  assert.match(page(false), /当前结果尚未确认，最后已知值不是当前值/)
  assert.match(page(false), /aria-live="off"[^]*当前结果尚未确认/); assert.doesNotMatch(page(false), /aria-live="polite"[^>]*>已读取快照/)
  assert.match(page(undefined), /role="status"[^]*aria-live="polite"/)
})

import { createPlanningRefreshSource } from '@harness-projects/client'
test('outer freshness owner preserves explicit refresh pending/error and initial capability feedback', async t => {
  const f = fixture(t); let reject
  const read = { ...f.read, capabilities: [{ key: 'planning.item.read', access: 'available' }] }, source = { subscribe: () => () => {}, getSnapshot: () => read }
  const refreshSource = createPlanningRefreshSource({ source, refreshPlanning: () => new Promise((_, no) => { reject = no }) }); t.after(() => refreshSource.dispose())
  const page = () => renderToStaticMarkup(React.createElement(WorkItemApp, { source, refreshSource, announceListStatus: false }))
  const pending = refreshSource.refresh(); await Promise.resolve()
  assert.match(page(), /正在刷新，当前显示的是最后已知值/); assert.doesNotMatch(page(), /aria-live="polite"[^>]*>正在刷新/)
  reject(new Error('RAW-ERROR-CANARY')); await pending
  assert.match(page(), /暂时无法刷新规划，显示的是最后已知值/); assert.doesNotMatch(page(), /aria-live="polite"[^>]*>暂时无法刷新/)
  assert.doesNotMatch(page(), /RAW-ERROR-CANARY/)
  const unknown = { subscribe: () => () => {}, getSnapshot: () => ({ ...f.read, capabilities: [] }) }
  const unavailable = renderToStaticMarkup(React.createElement(WorkItemApp, { source: unknown, announceListStatus: false }))
  assert.match(unavailable, /aria-live="off"[^>]*>无法读取工作项/); assert.doesNotMatch(unavailable, /aria-live="polite"[^>]*>无法读取工作项/)
})

test('bound Panel keeps operation facts plain, announces only changed observations and marks prior repository operation after scope swap', async t => {
  const f = fixture(t); await f.source.refresh(); let reading = { ...f.read, capabilities: [{ key: 'planning.item.read', access: 'available' }] }, finish, reject
  const source = { subscribe: () => () => {}, getSnapshot: () => reading }
  const refreshSource = createPlanningRefreshSource({ source, refreshPlanning: () => new Promise((yes, no) => { finish = yes; reject = no }) }); t.after(() => refreshSource.dispose())
  const element = bindWorkspaceStatusApp(f.source, source, undefined, { repositoryBindingSource: f.repos, refreshSource })()
  const slots = [], updates = []; let cursor = 0, effects = []
  const cell = initial => slots[cursor++] ??= initial()
  const dispatcher = { useSyncExternalStore: (_subscribe, read) => read(), useRef: current => cell(() => ({ current })),
    useState: initial => { const state = cell(() => ({ value: initial })); return [state.value, value => { state.value = value; updates.push(value) }] },
    useEffect: (effect, deps) => { const state = cell(() => ({})); if (!state.deps || deps.some((value, i) => value !== state.deps[i])) effects.push(effect); state.deps = deps } }
  const render = () => {
    const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, previous = internals.ReactCurrentDispatcher.current
    internals.ReactCurrentDispatcher.current = dispatcher; cursor = 0
    try { return element.type(element.props).props.children.find(child => child.props?.['aria-label'] === '工作区状态') } finally { internals.ReactCurrentDispatcher.current = previous }
  }
  const flush = () => { effects.splice(0).forEach(effect => effect()) }
  render(); flush(); assert.deepEqual(updates, [])
  const pending = refreshSource.refresh(); await Promise.resolve(); render(); flush()
  assert.equal(updates.length, 1); assert.match(updates[0], /正在刷新规划/)
  render(); flush(); assert.equal(updates.length, 1, 'unchanged pending cannot announce twice')
  reject(new Error('RAW-REFRESH-CANARY')); await pending; render(); flush()
  assert.equal(updates.length, 2); assert.match(updates[1], /规划刷新未完成/)
  render(); flush(); assert.equal(updates.length, 2, 'same last-known observation must announce changed failure once')
  const retry = refreshSource.refresh(); await Promise.resolve(); render(); flush()
  finish(result({ ok: true, entities: 0, workItems: 0, changeRequests: 0, unanchored: 0, revision: 2, degraded: false })); await retry; render(); flush()
  assert.equal(updates.length, 4); assert.match(updates[3], /当前读取已确认/)
  assert.doesNotMatch(updates.join(' '), /RAW-REFRESH-CANARY/); updates.length = 0
  reading = { ...reading, connection: { connected: false } }; render(); flush(); assert.equal(updates.length, 1); assert.match(updates[0], /连接中断/)
  await f.repos.bind({ localPath: '/fixture/PRIVATE-PATH-CANARY', owner: 'fixture', name: 'repo' }); render(); flush(); assert.equal(updates.length, 1, 'form owns operation announcement')
  const html = renderToStaticMarkup(render()); assert.match(html, /仓库操作结果未知/); assert.equal((html.match(/aria-live=/g) ?? []).length, 1)
  f.set(setup('confirmed', 'new-workspace')); await f.source.refresh(); const swapped = renderToStaticMarkup(render()); flush()
  assert.match(swapped, /先前仓库操作结果未知/); assert.doesNotMatch(swapped, /PRIVATE-PATH|Current project|2026-10-30T/)
  assert.equal(updates.at(-1), '', 'new scope cannot retain old-scope announcement')
})

test('current source observation follows matched read capability and degradation independently of setup confirmation and old time', async t => {
  const f = fixture(t); await f.source.refresh()
  for (const [access, reason, at, expected] of [
    ['available', undefined, timestamp, '当前读取已确认'], ['read_only', undefined, timestamp, '当前读取已确认'],
    ['degraded', undefined, timestamp, '读取不完整'], ['available', 'RAW-REASON-CANARY', timestamp, '读取不完整'],
    ['unavailable', undefined, timestamp, '读取不可用'], [undefined, undefined, timestamp, '读取状态未知'], ['available', undefined, undefined, '读取状态未知'],
  ]) {
    const view = f.view({ ...f.read, reason, lastUpdatedAt: at, capabilities: access === undefined ? [] : [{ key: 'planning.item.read', access }] })
    assert.equal(view.sourceObservation, expected); assert.equal(view.planning, '已确认'); assert.equal(view.confirmedAt, access && access !== 'unavailable' ? timestamp : undefined)
    assert.doesNotMatch(JSON.stringify(view), /RAW-REASON/)
  }
})

import { wire, redacted } from '../fixtures/work-item-wire.mjs'
test('list announcer clears protected count on unreadable scope and does not replay count on availability recovery', async t => {
  const f = fixture(t), slots = []; let cursor = 0, reading = { ...f.read, capabilities: [{ key: 'planning.item.read', access: 'available' }] }
  const source = { subscribe: () => () => {}, getSnapshot: () => reading }, cell = make => slots[cursor++] ??= make()
  const dispatcher = { useSyncExternalStore: (_subscribe, read) => read(), useRef: current => cell(() => ({ current })), useState: value => { const state = cell(() => ({ value })); return [state.value, value => { state.value = value }] }, useEffect() {} }
  const render = () => {
    const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, before = internals.ReactCurrentDispatcher.current; cursor = 0; internals.ReactCurrentDispatcher.current = dispatcher
    let element; try { element = WorkItemApp({ source, announceListStatus: false }) } finally { internals.ReactCurrentDispatcher.current = before }
    return renderToStaticMarkup(element)
  }
  const live = html => html.match(/<span role="status" aria-live="polite"[^>]*>([^<]*)<\/span>/)?.[1]
  assert.equal(live(render()), '')
  f.read.store.applyBaseline({ revision: 1, entities: [wire('ent-status', { content: { title: 'PROTECTED-COUNT-CANARY' } })], source: { revision: 1, freshness: 'fresh', authority: 'provider' } }); reading = { ...reading }
  assert.equal(live(render()), '已读取快照，共 1 项')
  for (const access of ['unavailable', undefined]) {
    reading = { ...reading, capabilities: access ? [{ key: 'planning.item.read', access }] : [] }
    const denied = render(); assert.equal(live(denied), ''); assert.doesNotMatch(denied, /共 1 项|PROTECTED-COUNT-CANARY|<a href=/)
    reading = { ...reading, capabilities: [{ key: 'planning.item.read', access: 'available' }] }
    assert.equal(live(render()), '', 'availability recovery belongs to outer source announcer')
  }
  f.read.store.applyBaseline({ revision: 2, entities: [wire('ent-status'), wire('ent-status-2')], source: { revision: 2, freshness: 'fresh', authority: 'provider' } }); reading = { ...reading }
  assert.equal(live(render()), '已读取快照，共 2 项')
  f.read.store.applyBaseline({ revision:3, entities:[wire('ent-status'),wire('ent-status-2'),redacted()], source:{revision:3,freshness:'fresh',authority:'provider'} });reading={...reading}
  assert.equal(live(render()), '已读取快照，共 2 项', 'redacted rows never enter App count announcement')
  reading = { ...reading, planningSource: { bindingId: 'new-binding', name: 'New source' } }; assert.equal(live(render()), '', 'same-workspace source switch clears old count announcement')
})

test('modal notice uses the same safe source observation while refresh and transport retain precedence', async t => {
  const f = fixture(t); f.read.store.applyBaseline({ revision: 1, entities: [wire('ent-modal', { content: { title: 'Modal item' } })], source: { revision: 1, freshness: 'fresh', authority: 'provider' } })
  const render = (extra = {}, refresh = { pending: false }) => {
    const read = { ...f.read, capabilities: [{ key: 'planning.item.read', access: 'available' }], ...extra }
    return renderToStaticMarkup(React.createElement(WorkItemApp, { source: { subscribe: () => () => {}, getSnapshot: () => read }, initialPath: '/projects/workspace/items/ent-modal', announceListStatus: false, refreshSource: { subscribe: () => () => {}, getSnapshot: () => refresh } }))
  }
  const degraded = render({ reason: 'RAW-REASON-CANARY' }); assert.match(degraded, /<dialog[^]*aria-live="polite"[^>]*>规划来源读取不完整，显示的是最后已知值。/); assert.doesNotMatch(degraded, /RAW-REASON/)
  assert.doesNotMatch(render(), /规划来源读取不完整/)
  assert.match(render({ reason: 'RAW-REASON-CANARY', connection: { connected: false } }), /<dialog[^]*aria-live="polite"[^>]*>与宿主的连接已中断/)
  assert.match(render({ reason: 'RAW-REASON-CANARY' }, { pending: false, error: '刷新失败的安全提示' }), /<dialog[^]*aria-live="polite"[^>]*>刷新失败的安全提示/)
})

test('modal lifecycle announces source recovery once and timestamp-only frames keep its notice stable', async t => {
  const f = fixture(t), slots = []; let cursor = 0, reading = { ...f.read, capabilities: [{ key: 'planning.item.read', access: 'available' }] }
  f.read.store.applyBaseline({ revision: 1, entities: [wire('ent-modal')], source: { revision: 1, freshness: 'fresh', authority: 'provider' } })
  const source = { subscribe: () => () => {}, getSnapshot: () => reading }, cell = make => slots[cursor++] ??= make()
  const dispatcher = { useSyncExternalStore: (_subscribe, read) => read(), useRef: current => cell(() => ({ current })), useState: value => { const state = cell(() => ({ value })); return [state.value, value => { state.value = value }] }, useEffect() {} }
  const render = () => {
    const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, before = internals.ReactCurrentDispatcher.current; cursor = 0; internals.ReactCurrentDispatcher.current = dispatcher
    let element; try { element = WorkItemApp({ source, initialPath: '/projects/workspace/items/ent-modal', announceListStatus: false }) } finally { internals.ReactCurrentDispatcher.current = before }
    return renderToStaticMarkup(element).match(/<dialog[^]*?<div role="status" aria-live="polite"[^>]*>([^<]*)<\/div>/)?.[1]
  }
  assert.equal(render(), '')
  reading = { ...reading, reason: 'RAW-REASON-CANARY' }; assert.equal(render(), '规划来源读取不完整，显示的是最后已知值。')
  reading = { ...reading, reason: undefined }; assert.equal(render(), '规划来源读取已恢复。')
  reading = { ...reading, reconciledAt: '2026-10-30T01:00:00Z' }; assert.equal(render(), '规划来源读取已恢复。')
  reading = { ...reading, planningSource: { bindingId: 'new-binding', name: 'New source' } }; assert.equal(render(), '', 'same-workspace binding switch clears prior recovery')
  reading = { ...reading, reason: 'RAW-REASON-CANARY' }; assert.equal(render(), '规划来源读取不完整，显示的是最后已知值。')
  reading = { ...reading, planningSource: undefined, reason: undefined }; assert.equal(render(), '', 'missing binding clears source history')
  reading = { ...reading, reason: 'RAW-REASON-CANARY' }; render()
  reading = { ...reading, reason: undefined }; assert.equal(render(), '', 'unidentified source cannot claim a remembered recovery')
})

test('persistent summary retains real refresh pending failure and recovery while settings is visible', async t => {
  const f = fixture(t); f.set(setup('configured')); await f.source.refresh(); let finish, fail
  const read = { ...f.read, capabilities: [{ key: 'planning.item.read', access: 'available' }] }
  const source = { subscribe: () => () => {}, getSnapshot: () => read }
  const refreshSource = createPlanningRefreshSource({ source, refreshPlanning: () => new Promise((resolve, reject) => { finish = resolve; fail = reject }) }); t.after(() => refreshSource.dispose())
  const Panel = bindWorkspaceStatusApp(f.source, source, undefined, { refreshSource })
  const page = () => renderToStaticMarkup(React.createElement(Panel))
  const summary = () => page().match(/<section[^>]*aria-label="工作区状态"[^]*?<\/section>/)?.[0] ?? ''
  const pending = refreshSource.refresh(); await Promise.resolve()
  assert.match(page(), /连接设置/); assert.match(summary(), /正在刷新规划，当前显示的是最后已知值/)
  assert.doesNotMatch(summary(), /当前读取已确认/)
  fail(new Error('RAW-REFRESH-CANARY')); await pending
  assert.match(summary(), /规划刷新未完成，显示的是最后已知值/); assert.doesNotMatch(summary(), /RAW-REFRESH/)
  const retry = refreshSource.refresh(); await Promise.resolve()
  finish(result({ ok: true, entities: 0, workItems: 0, changeRequests: 0, unanchored: 0, revision: 2, degraded: false })); await retry
  assert.match(summary(), /当前读取已确认/); assert.doesNotMatch(summary(), /正在刷新规划|规划刷新未完成/)
  const stale = deriveWorkspaceStatus({ setup: f.source.getSnapshot(), read: { ...read, planningSource: { bindingId: 'old', name: 'STALE-CANARY' } }, refresh: { pending: true } })
  assert.doesNotMatch(JSON.stringify(stale), /正在刷新规划|STALE-CANARY/)
})

// Permission metadata must disappear even if a same-scope wire frame retains it; do not pre-clean the fixture.
test('status projects source/mapping/time only for explicit readable capability, including authorized offline and partial frames', async t => {
  const f = fixture(t); await f.source.refresh()
  const metadata = { bindingId: 'binding', name: 'RETAINED-SOURCE-CANARY', mappingOrigin: 'user' }
  for (const access of ['available', 'read_only', 'degraded']) for (const connected of [true, false]) for (const reason of [undefined, 'permission_denied', 'stale']) {
    const read = { ...f.read, planningSource: metadata, capabilities: [{ key: 'planning.item.read', access }], connection: { connected }, reason }
    const view = f.view(read)
    assert.equal(view.source, 'RETAINED-SOURCE-CANARY'); assert.equal(view.mappingSource, '用户配置'); assert.equal(view.confirmedAt, timestamp)
    assert.equal(view.sourceObservation, !connected ? '最后已知值' : reason || access === 'degraded' ? '读取不完整' : '当前读取已确认')
  }
})

test('unknown/unavailable status clears same-scope residual metadata before considering transport', async t => {
  const f = fixture(t); await f.source.refresh()
  const metadata = { bindingId: 'binding', name: 'RETAINED-SOURCE-CANARY', mappingOrigin: 'user' }
  for (const access of [undefined, 'unavailable']) for (const connected of [true, false]) for (const reason of [undefined, 'permission_denied']) {
    const read = { ...f.read, planningSource: metadata, capabilities: access ? [{ key: 'planning.item.read', access }] : [], connection: { connected }, reason }
    const view = f.view(read)
    assert.equal(view.sourceObservation, access ? '读取不可用' : '读取状态未知', 'unreadable capability takes precedence over transport')
    assert.equal(view.source, '当前来源观测未知'); assert.equal(view.mappingSource, undefined); assert.equal(view.confirmedAt, undefined)
    assert.doesNotMatch(JSON.stringify(view), /RETAINED-SOURCE-CANARY|用户配置|2026-10-30T/)
  }
  for (const changed of [{ workspace: { id: 'other', name: 'old' } }, { planningSource: { ...metadata, bindingId: 'other' } }]) {
    const view = f.view({ ...f.read, planningSource: metadata, ...changed })
    assert.doesNotMatch(JSON.stringify(view), /RETAINED-SOURCE-CANARY|用户配置|2026-10-30T/)
  }
})
