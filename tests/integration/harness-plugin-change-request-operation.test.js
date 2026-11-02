import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { world } from '../fixtures/change-request-world.mjs'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { catalogOf } from '../../apps/harness-plugin/src/host-providers.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
for (const late of [false, true]) test(`actual Host handler binds trusted actor and rejects late target change (${late})`, async (t) => {
  const w = await world(t, 'SQLite')
  const catalog = catalogOf(Object.values(w.providers).map((provider) => ({ definition: provider.definition, configuration: {}, create: async () => provider })))
  const host = await createHostComposition({ dataPath: w.path, workspaceId: w.workspace.id, catalog, resolveCredential: async () => undefined })
  const installed = await installHostRemote({ invocation: { peer: { id: 'trusted-peer' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  t.after(async () => { await installed.dispose(); await host.dispose() })
  await assert.rejects(() => host.call('createChangeRequest', { ...w.request, head: 'forged' }), TypeError)
  assert.equal(w.f.mutations().length, 0)
  if (late) {
    const list = w.f.provider.listBranches.bind(w.f.provider)
    w.f.provider.listBranches = async (args) => {
      const result = await list(args)
      await w.storage.putExecutionContext({ ...w.record, provisioningGeneration: 2, branchExternalId: 'feature/decoy' })
      return result
    }
  }
  const result = await installed.service.createChangeRequest({ kind: 'forged', id: 'untrusted' }, 'host-key', w.scope.workItemId, w.scope.repositoryId, 'main', 'Host PR', '')
  assert.equal(result.writeState, late ? 'conflict' : 'confirmed', JSON.stringify(result))
  const attempt = await w.storage.findMutationAttempt(w.workspace.id, 'host-key')
  assert.equal(attempt.state, 'saved')
  assert.match(attempt.requestFingerprint, /trusted-peer/); assert.doesNotMatch(attempt.requestFingerprint, /untrusted/)
  assert.equal(w.f.mutations().length, 1)
})


async function install(w, peer) {
  const catalog = catalogOf(Object.values(w.providers).map((provider) => ({ definition: provider.definition, configuration: {}, create: async () => provider })))
  const host = await createHostComposition({ dataPath: w.path, workspaceId: w.workspace.id, catalog, resolveCredential: async () => undefined })
  const installed = await installHostRemote({ invocation: { peer: { id: peer } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  return { host, service: installed.service, close: async () => { await installed.dispose(); await host.dispose() } }
}
test('actual Host rebuild admits new peer to query and resume original operation without changing creator bytes', async (t) => {
  const w = await world(t, 'SQLite', { dropAck: true }), a = await install(w, 'peer-A')
  const args = [w.scope.workItemId, w.scope.repositoryId], body = '  正文\nUnicode λ\n  '
  const created = await a.service.createChangeRequest({ kind: 'forged' }, 'peer-key', ...args, 'main', '原请求', body)
  assert.equal(created.writeState, 'unknown'); await a.close(); await w.reopen()
  const original = await w.storage.findMutationAttempt(w.workspace.id, 'peer-key'), b = await install(w, 'peer-B'); t.after(b.close)
  const revision = await w.storage.currentRevision(w.workspace.id), reads = w.f.calls.length
  const view = await b.service.getChangeRequestOperation({ kind: 'forged' }, ...args)
  assert.equal(view.operation.operationId, original.id); assert.equal(view.operation.title, '原请求')
  assert.deepEqual(Object.keys(view.operation).sort(), ['base', 'currentTarget', 'head', 'kind', 'operationId', 'state', 'targetStamp', 'title'])
  assert.equal(await w.storage.currentRevision(w.workspace.id), revision); assert.equal(w.f.calls.length, reads)
  assert.equal((await b.service.createChangeRequest({ kind: 'user' }, 'peer-key', ...args, 'main', '原请求', body)).writeState, 'conflict')
  const resumed = await b.service.resumeChangeRequest({ kind: 'forged' }, ...args, original.id)
  assert.equal(resumed.writeState, 'reconciled'); assert.equal(w.f.mutations().length, 1)
  const saved = await w.storage.findMutationAttempt(w.workspace.id, 'peer-key')
  assert.equal(saved.state, 'saved'); assert.equal(saved.requestFingerprint, original.requestFingerprint)
  for (const key of ['input', 'ownerGeneration', 'worktree', 'bindingId']) assert.deepEqual(saved.externalIntent[key], original.externalIntent[key])
  assert.deepEqual((await b.service.getChangeRequestOperation({ kind: 'user' }, args[0], 'foreign', original.id)).operation.kind, 'blocked')
})
for (const change of ['target', 'authorization', 'projection', 'repository']) test(`actual Host final local operation query fences ${change} after Saved`, async (t) => {
  const w = await world(t, 'SQLite'), h = await install(w, 'peer-A'); t.after(h.close)
  const query = h.host.controller.queries.getChangeRequestOperation; let hit = false
  h.host.controller.queries.getChangeRequestOperation = async (scope) => {
    hit = true
    if (change === 'target') await w.storage.putExecutionContext({ ...w.record, provisioningGeneration: 2, branchExternalId: 'feature/decoy' })
    else if (change === 'projection') { const projection = (await w.storage.listPlanningProjections(w.workspace.id)).find((row) => row.entityId === w.scope.workItemId); await w.storage.putPlanningProjection(w.workspace.id, { ...projection, content: { contentKind: 'redacted', bindingId: projection.content.bindingId } }) }
    else if (change === 'repository') { const identity = await w.storage.findExternalIdentity('binding-github-create', 'repository', w.scope.repositoryId); await w.storage.putExternalIdentity({ ...identity, role: 'historical' }) }
    else { const bindings = await w.storage.listProviderBindings(w.workspace.id); await w.storage.putProviderBinding({ ...bindings.find((row) => row.id === 'binding-github-create'), enabled: false, isDefault: false }) }
    return query(scope)
  }
  const result = await h.service.createChangeRequest({ kind: 'user' }, 'last-query', w.scope.workItemId, w.scope.repositoryId, 'main', 'Fence PR', '')
  assert.equal(hit, true, 'barrier must execute in actual Host final query')
  assert.equal(result.authoritative, false); assert.equal(result.writeState, 'conflict')
  assert.equal((await w.storage.findMutationAttempt(w.workspace.id, 'last-query')).state, 'saved'); assert.equal(w.f.mutations().length, 1)
})
import { createChangeRequestCreator } from '@harness-projects/client'
for (const stale of [false, true]) test(`actual Host and production client preserve confirmed receipt with lineageStale=${stale}`, async (t) => {
  const w = await world(t, 'SQLite', stale ? { read: () => ({ status: 503, headers: {}, body: {} }) } : {}), h = await install(w, 'peer-A'); t.after(h.close)
  const json = (value) => JSON.parse(JSON.stringify(value)), creator = createChangeRequestCreator({ create: (...args) => h.service.createChangeRequest(...args).then(json), operation: (...args) => h.service.getChangeRequestOperation(...args).then(json), resume: (...args) => h.service.resumeChangeRequest(...args).then(json) }, { kind: 'user' }, () => 'lineage-key')
  const result = await creator.submit({ workspaceId: w.workspace.id, ...w.scope, base: 'main', title: 'Lineage PR', body: '' })
  assert.equal(result.writeState, 'confirmed'); assert.equal(result.lineageStale, stale)
  assert.equal((await creator.operation({ workspaceId: w.workspace.id, ...w.scope }, result.operationId)).operation.state, 'saved')
  assert.equal(w.f.mutations().length, 1)
})
import { createRequire } from 'node:module'
import { CreateChangeRequestSection } from '../../packages/ui/src/create-change-request-section.ts'
const React = createRequire(new URL('../../packages/ui/package.json', import.meta.url))('react')
function renderOperation(props) {
  const cells = [], shared = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED; let cursor, effects
  return () => {
    const old = shared.ReactCurrentDispatcher.current; cursor = 0; effects = []
    const slot = (make) => cells[cursor++] ?? (cells[cursor - 1] = make())
    shared.ReactCurrentDispatcher.current = { useRef: (value) => slot(() => ({ current: value })), useState: (value) => { const cell = slot(() => ({ value })); return [cell.value, (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next }] }, useEffect: (run, deps) => { const cell = slot(() => ({})); if (!cell.deps || deps.some((dep, n) => dep !== cell.deps[n])) effects.push(() => { cell.close?.(); cell.close = run() }); cell.deps = deps } }
    try { return CreateChangeRequestSection(props) } finally { shared.ReactCurrentDispatcher.current = old; effects.forEach((run) => run()) }
  }
}
for (const change of ['target', 'authorization']) test(`actual Host resume confirmation is superseded by followup UI observation of ${change} change`, async (t) => {
  const w = await world(t, 'SQLite', { dropAck: true }), h = await install(w, 'peer-A'); t.after(h.close)
  const scope = { workspaceId: w.workspace.id, ...w.scope }, actor = { kind: 'user' }
  await h.service.createChangeRequest(actor, 'followup-key', w.scope.workItemId, w.scope.repositoryId, 'main', 'Followup PR', '')
  const json = (value) => JSON.parse(JSON.stringify(value))
  const creator = createChangeRequestCreator({ create: (...args) => h.service.createChangeRequest(...args).then(json), operation: (...args) => h.service.getChangeRequestOperation(...args).then(json), resume: async (...args) => {
    const result = await h.service.resumeChangeRequest(...args); assert.equal(result.writeState, 'reconciled')
    if (change === 'target') await w.storage.putExecutionContext({ ...w.record, provisioningGeneration: 2, branchExternalId: 'feature/decoy' })
    else { const row = (await w.storage.listProviderBindings(w.workspace.id)).find((row) => row.id === 'binding-github-create'); await w.storage.putProviderBinding({ ...row, enabled: false, isDefault: false }) }
    return json(result)
  } }, actor)
  const render = renderOperation({ scope, connected: true, creator, onConfirmed() {} })
  render(); await new Promise((done) => setImmediate(done)); render().props.children.at(-1).props.onClick()
  for (let n = 0; n < 20; n++) await new Promise((done) => setImmediate(done))
  assert.doesNotMatch(JSON.stringify(render()), /PR 已确认/)
  assert.match(JSON.stringify(render()), /原操作当前不可恢复/)
  assert.equal((await w.storage.findMutationAttempt(w.workspace.id, 'followup-key')).state, 'saved'); assert.equal(w.f.mutations().length, 1)
})
test('actual Host successful Saved response wholly lost survives SQLite rebuild and new peer recovery', async (t) => {
  const w = await world(t, 'SQLite'), a = await install(w, 'saved-peer-A'); t.after(a.close)
  const scope = { workspaceId: w.workspace.id, ...w.scope }, body = '  第一行 λ\n\n第二行  '; let hostState
  const creator = createChangeRequestCreator({ create: async (...args) => { const result = await a.service.createChangeRequest(...args); hostState = result.writeState; throw new Error('whole successful response lost') } }, { kind: 'user' }, () => 'saved-whole-response')
  const result = await creator.submit({ ...scope, base: 'main', title: 'Saved 原请求', body })
  assert.equal(hostState, 'confirmed'); assert.equal(result.writeState, 'unknown'); assert.equal(result.operationId, undefined)
  const before = await w.storage.findMutationAttempt(w.workspace.id, 'saved-whole-response'); assert.equal(before.state, 'saved')
  await a.close(); await w.reopen(); const b = await install(w, 'saved-peer-B'); t.after(b.close)
  const revision = await w.storage.currentRevision(w.workspace.id), providerCalls = w.f.calls.length
  const view = await b.service.getChangeRequestOperation({ kind: 'forged' }, w.scope.workItemId, w.scope.repositoryId)
  assert.equal(view.operation.operationId, before.id); assert.equal(view.operation.state, 'saved'); assert.equal(view.operation.currentTarget, true)
  assert.equal(await w.storage.currentRevision(w.workspace.id), revision); assert.equal(w.f.calls.length, providerCalls)
  assert.equal((await b.service.createChangeRequest({ kind: 'user' }, 'saved-whole-response', w.scope.workItemId, w.scope.repositoryId, 'main', 'Saved 原请求', body)).writeState, 'conflict')
  const resumed = await b.service.resumeChangeRequest({ kind: 'forged' }, w.scope.workItemId, w.scope.repositoryId, before.id)
  assert.equal(resumed.writeState, 'reconciled'); assert.equal(resumed.value.ref.externalId, before.externalIntent.confirmedRef.externalId)
  const after = await w.storage.findMutationAttempt(w.workspace.id, 'saved-whole-response')
  assert.equal(after.idempotencyKey, before.idempotencyKey); assert.equal(after.requestFingerprint, before.requestFingerprint)
  assert.match(after.requestFingerprint, /saved-peer-A/); assert.deepEqual(after.externalIntent, before.externalIntent); assert.equal(w.f.mutations().length, 1)
})
test('actual Host 403 keeps permission explanation and connection repair action in the none form', async (t) => {
  const w = await world(t, 'SQLite', { mutation: () => ({ status: 403, headers: {}, body: {} }) }), h = await install(w, 'peer-A'); t.after(h.close)
  let result, repairs = 0, confirmations = 0
  const creator = createChangeRequestCreator({ create: (...args) => h.service.createChangeRequest(...args), operation: (...args) => h.service.getChangeRequestOperation(...args) }, { kind: 'user' }, () => 'permission-status')
  const observed = { ...creator, submit: async (intent) => { result = await creator.submit(intent); return result } }
  const render = renderOperation({ scope: { workspaceId: w.workspace.id, ...w.scope }, creator: observed, connected: true, onConfirmed() { confirmations++ }, onConnect() { repairs++ } })
  render(); await new Promise((done) => setImmediate(done)); assert.equal(render().type, 'form')
  for (const field of render().props.children.flat().filter((node) => node?.type === 'label')) {
    const input = field.props.children[1]; input.props.onChange({ target: { value: input.props.name === 'base' ? 'main' : 'Permission PR' } })
  }
  render().props.onSubmit({ preventDefault() {} }); for (let n = 0; n < 20; n++) await new Promise((done) => setImmediate(done))
  assert.equal(result.writeState, 'failed'); assert.equal(result.recovery, 'fix_permission')
  const tree = render(), children = tree.props.children.flat(); assert.equal(tree.type, 'form')
  assert.match(children.find((node) => node?.props?.role === 'status').props.children, /权限不足/)
  children.find((node) => node?.type === 'button' && node.props.children === '打开连接设置').props.onClick()
  assert.equal(repairs, 1); assert.equal(confirmations, 0); assert.equal(w.f.objects.length, 0)
})

test('actual Host context rejection remains visible in the PR form', async (t) => {
  const w = await world(t, 'SQLite')
  await w.storage.putExecutionContext({ ...w.record, status: 'failed', branchExternalId: undefined, worktreeExternalId: undefined })
  const h = await install(w, 'rejected-peer'); t.after(h.close)
  let result, confirmations = 0, complete
  const submitted = new Promise((done) => { complete = done })
  const creator = createChangeRequestCreator({ create: (...args) => h.service.createChangeRequest(...args), operation: (...args) => h.service.getChangeRequestOperation(...args) }, { kind: 'user' }, () => 'rejected-context')
  const render = renderOperation({ scope: { workspaceId: w.workspace.id, ...w.scope }, connected: true,
    creator: { ...creator, submit: async (intent) => { result = await creator.submit(intent); complete(); return result } }, onConfirmed() { confirmations++ } })
  render(); await new Promise((done) => setImmediate(done)); assert.equal(render().type, 'form')
  for (const field of render().props.children.flat().filter((node) => node?.type === 'label')) {
    const input = field.props.children[1]; input.props.onChange({ target: { value: input.props.name === 'base' ? 'main' : 'Rejected PR' } })
  }
  render().props.onSubmit({ preventDefault() {} }); await submitted; await new Promise((done) => setImmediate(done))
  assert.equal(result.writeState, 'failed'); assert.equal(result.recovery, 'none')
  const tree = render(), status = tree.props.children.flat().find((node) => node?.props?.role === 'status').props.children
  assert.equal(tree.type, 'form'); assert.match(status, /失败/); assert.match(status, /开始工作|执行上下文|输入/)
  assert.equal(confirmations, 0); assert.equal(w.f.objects.length, 0)
  assert.equal(w.f.mutations().length, 0)
})
