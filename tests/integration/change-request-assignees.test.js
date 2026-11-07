import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { CapabilityKey } from '@harness-projects/capabilities'
import { world } from '../fixtures/change-request-world.mjs'
const users = [{ id: 'U_1', login: 'allowed-one' }, { id: 'U_2', login: 'allowed-two' }]
async function assigned(t, label = 'SQLite', createPr = true) {
  const w = await world(t, label); if (createPr) await w.run(); const original = await w.core.queries.getChangeRequestOperation(w.scope)
  w.assignment = { ...w.scope, createOperationId: original.operationId }; w.ids = []; w.adds = 0; w.reads = 0
  const describe = w.f.provider.describeCapabilities.bind(w.f.provider)
  w.f.provider.describeCapabilities = async () => { const s = await describe(), extra = Object.fromEntries([CapabilityKey.DevelopmentAssigneeList, CapabilityKey.DevelopmentChangeRequestAssigneeRead, CapabilityKey.DevelopmentChangeRequestAssigneeAdd].map(k => [k, 'available'])); return { ...s, capability: { ...s.capability, ...extra }, permission: { ...s.permission, ...extra } } }
  w.f.provider.listAssignableUsers = async () => ({ ok: true, value: { items: users, nextCursor: undefined } })
  w.f.provider.getChangeRequestAssignees = async input => { w.reads++; return { ok: true, value: { changeRequest: input.changeRequest, users: w.ids.map(id => ({ id, login: 'readback-' + id })) } } }
  w.f.provider.addChangeRequestAssignees = async input => { w.adds++; assert.ok((await w.storage.listMutationAttempts(w.workspace.id)).some(r => r.commandName === 'addChangeRequestAssignees' && r.state === 'pending')); w.ids = [...new Set([...w.ids, ...input.assigneeIds])]; if (w.drop) throw Error('lost ack'); return { ok: true, value: undefined } }
  await w.compose()
  w.add = (ids = ['U_1'], key = 'assignment-1') => w.core.commands.addChangeRequestAssignees({ ...w.assignment, assigneeIds: ids, actor: { kind: 'user' }, idempotencyKey: key })
  w.query = () => w.core.queries.getChangeRequestAssigneeOperation(w.assignment)
  w.resume = id => w.core.commands.resumeChangeRequestAssignees({ ...w.assignment, operationId: id, observer: { kind: 'user' } })
  return w
}
for (const label of ['Fake', 'SQLite']) test(`${label} assignment intent commits before mutation and concurrent owners dispatch once`, async t => {
  const w = await assigned(t, label), before = [await w.storage.listRelations(w.workspace.id), await w.storage.listPlanningProjections(w.workspace.id)]
  const results = await Promise.all([w.add(), w.add()]); assert.equal(w.adds, 1); assert.ok(results.some(r => ['confirmed', 'reconciled'].includes(r.phase)))
  assert.equal((await w.query()).state, 'saved'); assert.deepEqual((await w.query()).requestedIds, ['U_1'])
  assert.deepEqual([await w.storage.listRelations(w.workspace.id), await w.storage.listPlanningProjections(w.workspace.id)], before); assert.equal(w.f.mutations().length, 1)
})
test('lost assignment ack reopens SQLite and only reads original PR', async t => {
  const w = await assigned(t); w.drop = true
  const read = w.f.provider.getChangeRequestAssignees; w.f.provider.getChangeRequestAssignees = async () => { throw Error('offline') }
  assert.equal((await w.add()).phase, 'unknown'); await w.reopen(); w.f.provider.getChangeRequestAssignees = read
  const op = await w.query(); assert.equal((await w.resume(op.operationId)).phase, 'reconciled'); assert.equal(w.adds, 1); assert.equal(w.f.mutations().length, 1)
})
test('partial readback remains unknown and concurrent extra assignees survive', async t => {
  const w = await assigned(t); const add = w.f.provider.addChangeRequestAssignees
  w.f.provider.addChangeRequestAssignees = async input => { await add(input); w.ids = ['U_1', 'U_extra']; return { ok: true } }
  assert.equal((await w.add(['U_1', 'U_2'])).phase, 'unknown'); assert.equal((await w.add(['U_2'], 'other')).phase, 'unknown'); assert.equal(w.adds, 1)
  w.ids.push('U_2'); const op = await w.query(); assert.equal((await w.resume(op.operationId)).phase, 'reconciled'); assert.deepEqual((await w.query()).confirmedIds, ['U_1', 'U_2', 'U_extra'])
})
test('same key with changed assignees conflicts and empty selection sends no mutation', async t => {
  const w = await assigned(t); assert.equal((await w.add([])).phase, 'reconciled'); assert.equal(w.adds, 0)
  await w.add(); assert.equal((await w.add(['U_2'])).phase, 'conflict'); assert.equal(w.adds, 1)
})
for (const revoke of ['binding', 'target', 'receipt']) test(`revoked or replaced ${revoke} cannot settle or reveal late assignee identities`, async t => {
  const w = await assigned(t), read = w.f.provider.getChangeRequestAssignees
  w.f.provider.getChangeRequestAssignees = async input => { const result = await read(input)
    if (revoke === 'target') await w.storage.putExecutionContext({ ...w.record, provisioningGeneration: 2 })
    else if (revoke === 'binding') { const row = (await w.storage.listProviderBindings(w.workspace.id)).find(r => r.id === input.repository.bindingId); await w.storage.putProviderBinding({ ...row, enabled: false, isDefault: false }) }
    else { const row = (await w.storage.listMutationAttempts(w.workspace.id)).find(r => r.commandName === 'addChangeRequestAssignees'); await w.storage.putMutationAttempt({ ...row, expectedSourceVersion: 'changed' }) }
    return result }
  const result = await w.add(); assert.equal(result.phase, 'conflict'); assert.equal(result.confirmedIds, undefined); assert.notEqual((await w.query()).state, 'saved')
})

test('assignment JSON rejects unknown operation and undeclared identity fields without losing original record', async t => {
  const w = await assigned(t); await w.add(); const row = (await w.storage.listMutationAttempts(w.workspace.id)).find(r => r.commandName === 'addChangeRequestAssignees')
  await assert.rejects(() => w.storage.putMutationAttempt({ ...row, externalIntent: { ...row.externalIntent, login: 'private-canary' } }))
  assert.throws(() => w.storage.db.prepare('UPDATE mutation_attempt SET external_intent_json = ? WHERE id = ?').run(JSON.stringify({ ...row.externalIntent, operation: 'unknown' }), row.id))
  await w.reopen(); assert.equal((await w.query()).state, 'saved')
})

test('two SQLite instances share the durable assignment claim and local query performs no Provider I/O', async t => {
  const { createSqliteStorage } = await import('@harness-projects/storage-sqlite'), { composeCore } = await import('@harness-projects/core')
  const w = await assigned(t), second = createSqliteStorage(w.path); t.after(() => second.close())
  const core = await composeCore({ workspace: w.workspace, providers: w.providers, storage: second })
  await Promise.all([w.add(), core.commands.addChangeRequestAssignees({ ...w.assignment, assigneeIds: ['U_1'], actor: { kind: 'user' }, idempotencyKey: 'assignment-1' })]); assert.equal(w.adds, 1)
  assert.deepEqual((await w.storage.listMutationAttempts(w.workspace.id)).filter(r => r.commandName === 'addChangeRequestAssignees').map(r => r.externalIntent.sequence), [1])
  for (const method of ['listAssignableUsers', 'getChangeRequestAssignees', 'addChangeRequestAssignees']) w.f.provider[method] = () => { throw Error('query must stay local') }
  assert.equal((await w.query()).state, 'saved')
})

test('candidate reads work before PR creation and fence a revoked late directory receipt', async t => {
  const w = await assigned(t, 'SQLite', false)
  const args = { ...w.scope, observer: { kind: 'user' }, limit: 50 }
  assert.equal((await w.core.commands.listChangeRequestAssigneeOptions(args)).items[0].id, 'U_1')
  const list = w.f.provider.listAssignableUsers
  w.f.provider.listAssignableUsers = async input => { const result = await list(input); await w.storage.putExecutionContext({ ...w.record, provisioningGeneration: 2 }); return result }
  await assert.rejects(() => w.core.commands.listChangeRequestAssigneeOptions(args)); assert.equal(w.adds, 0)
  assert.equal(w.f.mutations().length, 0)
})

test('assignment freezes caller IDs key and create receipt before its first await', async t => {
  const w = await assigned(t), request = { ...w.assignment, assigneeIds: ['U_1'], actor: { kind: 'user' }, idempotencyKey: 'frozen-key' }
  const pending = w.core.commands.addChangeRequestAssignees(request); request.idempotencyKey = 'changed-key'; request.createOperationId = 'foreign'; request.assigneeIds[0] = 'U_2'
  assert.equal((await pending).phase, 'confirmed'); assert.deepEqual(w.ids, ['U_1']); assert.equal((await w.storage.findMutationAttempt(w.workspace.id, 'frozen-key')).state, 'saved'); assert.equal(await w.storage.findMutationAttempt(w.workspace.id, 'changed-key'), undefined)
})

for (const denied of ['DevelopmentAssignees', 'DevelopmentAddAssignees']) test(`native ${denied} refusal stays failed and terminal discovery restores newer additions`, async t => {
  const { createHash } = await import('node:crypto'), w = await nativeAssignment(t), hash = s => createHash('sha256').update(s).digest('hex')
  const keys = ['terminal-0', 'terminal-1'].sort((a, b) => hash(a).localeCompare(hash(b)))
  w.state.denied = denied; assert.equal((await w.add(['U_1'], keys[0])).phase, 'failed')
  assert.equal((await w.storage.findMutationAttempt(w.workspace.id, keys[0])).state, 'failed'); assert.deepEqual(w.state.ids, [])
  assert.equal(w.state.calls.filter(c => c === 'DevelopmentAddAssignees').length, denied === 'DevelopmentAssignees' ? 0 : 1)
  w.state.denied = ''; w.provider = w.make(); w.providers.development = w.provider; await w.compose()
  assert.equal((await w.add(['U_2'], keys[1])).phase, 'confirmed'); await w.reopen()
  assert.equal((await w.query()).state, 'saved'); assert.deepEqual((await w.query()).requestedIds, ['U_2'])
  assert.equal((await w.add(['U_1'], 'third-terminal')).phase, 'confirmed'); await w.reopen(); assert.deepEqual((await w.query()).requestedIds, ['U_1'])
  const before = w.state.calls.length; assert.equal((await w.add(['U_2'], keys[1])).phase, 'reconciled'); assert.equal(w.state.calls.length, before)
  assert.deepEqual((await w.storage.listMutationAttempts(w.workspace.id)).filter(r => r.commandName === 'addChangeRequestAssignees').map(r => r.externalIntent.sequence).sort(), [1, 2, 3]); assert.equal(w.f.mutations().length, 1)
})


test('assignment sequence overflow and invalid stored sequence fail closed', async t => {
  const w = await assigned(t); await w.add(); const row = (await w.storage.listMutationAttempts(w.workspace.id)).find(r => r.commandName === 'addChangeRequestAssignees')
  for (const sequence of [0, undefined]) assert.throws(() => w.storage.db.prepare('UPDATE mutation_attempt SET external_intent_json = ? WHERE id = ?').run(JSON.stringify({ ...row.externalIntent, sequence }), row.id))
  await w.storage.putMutationAttempt({ ...row, externalIntent: { ...row.externalIntent, sequence: Number.MAX_SAFE_INTEGER } })
  assert.equal((await w.add()).phase, 'reconciled')
  assert.equal((await w.add(['U_2'], 'overflow')).phase, 'conflict'); assert.equal(w.adds, 1)
})


async function nativeAssignment(t) {
  const { createGithubDevelopmentProvider } = await import('@harness-projects/provider-development-github'), w = await world(t, 'SQLite'); await w.run()
  const target = await w.core.queries.getChangeRequestOperation(w.scope), scope = { ...w.scope, createOperationId: target.operationId }, state = { denied: '', ids: [], calls: [] }
  const make = () => createGithubDevelopmentProvider({ bindingId: 'binding-github-create', repository: { externalId: w.scope.repositoryId, owner: 'example', name: 'project' }, permissionMode: 'lazy', transport: async request => {
    state.calls.push(request.operationName); if (request.operationName === state.denied) return { status: 403, headers: {}, body: {} }
    if (!['DevelopmentAssignableUsers', 'DevelopmentAssignees', 'DevelopmentAddAssignees'].includes(request.operationName)) return w.f.transport(request)
    const page = ids => ({ nodes: ids.map(id => ({ id, login: 'native-canary' })), pageInfo: { hasNextPage: false } })
    if (request.operationName === 'DevelopmentAddAssignees') state.ids = [...new Set([...state.ids, ...request.variables.input.assigneeIds])]
    return { status: 200, headers: {}, body: { data: { repository: { id: 'R_synthetic', nameWithOwner: 'example/project', assignableUsers: page(['U_sensitive', 'U_1', 'U_2']) }, node: { id: 'PR_1', repository: { id: 'R_synthetic' }, assignees: page(state.ids) }, addAssigneesToAssignable: { assignable: { id: 'PR_1' } } } } }
  } })
  const provider = make(); w.providers.development = provider; await w.compose()
  return Object.assign(w, { provider, make, state, scope, query: () => w.core.queries.getChangeRequestAssigneeOperation(scope), native: { repository: { bindingId: 'binding-github-create', objectKind: 'repository', externalId: w.scope.repositoryId }, changeRequest: { bindingId: 'binding-github-create', objectKind: 'change_request', externalId: 'PR_1' } }, add: (assigneeIds = ['U_sensitive'], idempotencyKey = 'native') => w.core.commands.addChangeRequestAssignees({ ...scope, actor: { kind: 'user' }, idempotencyKey, assigneeIds }) })
}
test('saved assignee identities stay blocked in explicit and latest local queries after native read denial', async t => {
  const w = await nativeAssignment(t), saved = await w.add(); assert.equal(saved.phase, 'confirmed'); const prior = await w.provider.describeCapabilities()
  w.state.denied = 'DevelopmentAssignees'; assert.equal((await w.provider.getChangeRequestAssignees(w.native)).ok, false); const calls = w.state.calls.length
  for (const operationId of [undefined, saved.operationId]) { const view = await w.core.queries.getChangeRequestAssigneeOperation({ ...w.scope, operationId }); assert.deepEqual(view, { kind: 'blocked' }); assert.doesNotMatch(JSON.stringify(view), /U_sensitive/) }
  assert.equal(w.state.calls.length, calls); assert.equal((await w.storage.findMutationAttempt(w.workspace.id, 'native')).state, 'saved'); assert.equal(prior.permissionVersion[CapabilityKey.DevelopmentChangeRequestAssigneeRead] ?? 0, 0)
  w.state.denied = ''; await w.provider.getChangeRequestAssignees(w.native); assert.equal((await w.core.queries.getChangeRequestAssigneeOperation(w.scope)).state, 'saved')
  const describe = w.provider.describeCapabilities.bind(w.provider)
  for (const version of [0, -1, 1.5, Number.NaN]) { w.provider.describeCapabilities = async () => ({ ...await describe(), permissionVersion: { [CapabilityKey.DevelopmentChangeRequestAssigneeRead]: version } }); assert.deepEqual(await w.core.queries.getChangeRequestAssigneeOperation(w.scope), { kind: 'blocked' }) }
})
for (const recover of [false, true]) test(`successful native readback cannot settle after a newer raw denial, recovery=${recover}`, async t => {
  const w = await nativeAssignment(t), read = w.provider.getChangeRequestAssignees.bind(w.provider)
  w.provider.getChangeRequestAssignees = async input => { const result = await read(input); w.state.denied = 'DevelopmentAssignees'; await read(input); if (recover) { w.state.denied = ''; await read(input); await w.query() } return result }
  assert.notEqual((await w.add()).phase, 'confirmed'); assert.notEqual((await w.storage.findMutationAttempt(w.workspace.id, 'native')).state, 'saved')
})
test('late candidate identities cannot cross a raw native deny and regrant', async t => {
  const w = await nativeAssignment(t), list = w.provider.listAssignableUsers.bind(w.provider)
  w.provider.listAssignableUsers = async input => { const result = await list(input); w.state.denied = 'DevelopmentAssignableUsers'; await list(input); w.state.denied = ''; await list(input); return result }
  await assert.rejects(() => w.core.commands.listChangeRequestAssigneeOptions({ workItemId: w.scope.workItemId, repositoryId: w.scope.repositoryId, observer: { kind: 'user' }, limit: 50 }))
})


test('SQLite concurrent saved receipt passes the common final permission gate', async t => {
  const w = await nativeAssignment(t), read = w.provider.getChangeRequestAssignees.bind(w.provider)
  let raced = false, armed = false, lists = 0, injected = false
  w.afterRead = async method => {
    if (method === 'listMutationAttempts' && armed && ++lists === 2) { armed = false; injected = true; w.state.denied = 'DevelopmentAssignees'; assert.equal((await read(w.native)).ok, false) }
  }
  w.provider.getChangeRequestAssignees = async input => {
    const result = await read(input)
    if (!raced) { raced = true; const row = await w.storage.findMutationAttempt(w.workspace.id, 'native'); assert.equal((await w.core.commands.resumeChangeRequestAssignees({ ...w.scope, operationId: row.id, observer: { kind: 'user' } })).phase, 'reconciled'); armed = true }
    return result
  }
  const result = await w.add(); assert.equal(injected, true); assert.ok(!['confirmed', 'reconciled'].includes(result.phase))
  assert.equal((await w.storage.findMutationAttempt(w.workspace.id, 'native')).state, 'saved')
})
