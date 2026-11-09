import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { CapabilityKey } from '@harness-projects/capabilities'
import { world } from '../fixtures/change-request-world.mjs'
async function setup(t, options = {}, label = 'SQLite') {
  const w = await world(t, label, options), describe = w.f.provider.describeCapabilities.bind(w.f.provider)
  w.ids = []; w.adds = 0; w.denied = ''; w.offline = false
  w.f.provider.describeCapabilities = async () => { const s = await describe(), extra = Object.fromEntries([CapabilityKey.DevelopmentAssigneeList, CapabilityKey.DevelopmentChangeRequestAssigneeRead, CapabilityKey.DevelopmentChangeRequestAssigneeAdd].map(k => [k, 'available'])); return { ...s, capability: { ...s.capability, ...extra }, permission: { ...s.permission, ...extra } } }
  w.f.provider.listAssignableUsers = async () => ({ ok: true, value: { items: [{ id: 'U_1', login: 'allowed' }], nextCursor: undefined } })
  w.f.provider.getChangeRequestAssignees = async input => { if (w.offline) throw Error('offline'); return { ok: true, value: { changeRequest: input.changeRequest, users: w.ids.map(id => ({ id, login: 'readback' })) } } }
  w.f.provider.addChangeRequestAssignees = async input => { w.adds++; if (w.denied) return { ok: false, error: { code: w.denied, message: 'denied' } }; w.ids = [...new Set([...w.ids, ...input.assigneeIds])]; if (w.drop) { w.offline = true; throw Error('ack lost') } return { ok: true } }
  await w.compose()
  w.resume = async () => { const op = await w.core.queries.getChangeRequestOperation(w.scope); return w.commands.resumeChangeRequest({ ...w.scope, operationId: op.operationId, actorRef: { kind: 'observer' } }) }
  w.manual = async (ids, key) => { const op = await w.core.queries.getChangeRequestOperation(w.scope); return w.core.commands.addChangeRequestAssignees({ ...w.scope, createOperationId: op.operationId, actor: { kind: 'user' }, idempotencyKey: key, assigneeIds: ids }) }
  return w
}
for (const label of ['Fake', 'SQLite']) test(`${label} preselected native IDs freeze before first await and assign only confirmed PR`, async t => {
  const w = await setup(t, {}, label), ids = ['U_2', 'U_1', 'U_1'], request = { ...w.request, assigneeIds: ids, draft: true, issueRelation: 'none' }
  const pending = w.commands.createChangeRequest(request); ids[0] = 'changed'; request.title = 'changed'
  const result = await pending, row = await w.storage.findMutationAttempt(w.workspace.id, 'create-1')
  assert.equal(result.writeState, 'confirmed'); assert.equal(result.value.assignment.state, 'confirmed'); assert.deepEqual(w.ids, ['U_1', 'U_2'])
  assert.deepEqual(row.externalIntent.requestedAssigneeIds, ['U_1', 'U_2']); assert.deepEqual(JSON.parse(row.requestFingerprint).requestedAssigneeIds, ['U_1', 'U_2'])
  assert.equal(row.externalIntent.input.draft, true); assert.equal(row.externalIntent.input.title, w.request.title); assert.equal(w.f.mutations().length, 1); assert.equal(w.adds, 1)
})
test('unassigned creation preserves current Issue and draft canonical with zero assignment', async t => {
  const w = await setup(t), first = await w.run({ draft: true, assigneeIds: [] })
  assert.equal(first.writeState, 'confirmed'); assert.equal(first.value.assignment.state, 'none'); assert.equal(w.adds, 0)
  const row = await w.storage.findMutationAttempt(w.workspace.id, 'create-1'); assert.equal(Object.hasOwn(row.externalIntent, 'requestedAssigneeIds'), false)
  assert.equal((await w.run({ draft: true })).writeState, 'reconciled')
})
test('same create key with changed native IDs conflicts', async t => {
  const w = await setup(t); await w.run({ assigneeIds: ['U_1'] })
  assert.equal((await w.run({ assigneeIds: ['U_2'] })).writeState, 'conflict'); assert.equal(w.f.mutations().length, 1); assert.equal(w.adds, 1)
  for (const assigneeIds of [null, 'U_1', [null], [' '], Array(11).fill('U')]) assert.equal((await w.run({ assigneeIds })).writeState, 'failed')
})
test('lost create ack reopens original IDs and Issue choice before first assignment', async t => {
  const w = await setup(t, { dropAck: true }), first = await w.run({ assigneeIds: ['U_1'], draft: true, issueRelation: 'none' })
  assert.equal(first.writeState, 'unknown'); assert.equal(w.adds, 0); await w.reopen()
  const local = await w.core.queries.getChangeRequestOperation(w.scope); assert.deepEqual(local.requestedAssigneeIds, ['U_1']); assert.equal(local.draft, true); assert.equal(local.issueRelation, 'none'); assert.equal(w.adds, 0)
  assert.equal((await w.resume()).value.assignment.state, 'confirmed'); assert.equal(w.adds, 1); assert.equal(w.f.mutations().length, 1)
})
test('lost assignment ack reopens exact stable operation without redispatch', async t => {
  const w = await setup(t); w.drop = true
  const first = await w.run({ assigneeIds: ['U_1'] }); assert.equal(first.writeState, 'confirmed'); assert.equal(first.value.assignment.state, 'unknown')
  const row = await w.storage.findMutationAttempt(w.workspace.id, 'create-1'); await w.reopen(); w.offline = false
  assert.equal((await w.resume()).value.assignment.state, 'confirmed'); assert.equal(w.adds, 1); assert.equal(w.f.mutations().length, 1)
  assert.deepEqual(await w.storage.findMutationAttempt(w.workspace.id, 'create-1'), row, 'assignment progress leaves frozen create receipt unchanged')
  await w.manual(['U_2'], 'later-manual'); const result = await w.resume(); assert.equal(result.value.assignment.operationId, first.value.assignment.operationId)
})
test('different unresolved assignment cannot confirm creation requested IDs', async t => {
  const w = await setup(t, { dropAck: true }); await w.run({ assigneeIds: ['U_1'] })
  w.policy = { [CapabilityKey.DevelopmentChangeRequestAssigneeAdd]: 'unavailable' }; await w.compose()
  assert.equal((await w.resume()).writeState, 'reconciled'); assert.equal(w.adds, 0)
  w.policy = {}; await w.compose(); w.drop = true
  const manual = await w.manual(['U_2'], 'manual-pending'); assert.equal(manual.phase, 'unknown')
  const blocked = await w.resume(); assert.notEqual(blocked.value.assignment.state, 'confirmed'); assert.equal(blocked.value.assignment.operationId, undefined); assert.equal(w.adds, 1)
  w.offline = false; w.drop = false
  const op = await w.core.queries.getChangeRequestOperation(w.scope)
  await w.core.commands.resumeChangeRequestAssignees({ ...w.scope, createOperationId: op.operationId, operationId: manual.operationId, observer: { kind: 'user' } })
  assert.equal((await w.resume()).value.assignment.state, 'confirmed'); assert.equal(w.adds, 2)
})
test('known failed creation assignment never redispatches on resume while a new explicit add can succeed', async t => {
  const w = await setup(t); w.denied = 'permission_denied'
  const first = await w.run({ assigneeIds: ['U_1'] }); assert.equal(first.writeState, 'confirmed'); assert.equal(first.value.assignment.state, 'failed'); assert.equal(first.value.ref.externalId, 'PR_1')
  const row = (await w.storage.listMutationAttempts(w.workspace.id)).find(r => r.commandName === 'addChangeRequestAssignees')
  w.denied = ''; await w.reopen(); for (let i = 0; i < 2; i++) assert.equal((await w.resume()).value.assignment.state, 'failed')
  assert.equal(w.adds, 1); assert.equal((await w.manual(['U_1'], 'explicit-new')).phase, 'confirmed')
  assert.equal((await w.resume()).value.assignment.state, 'failed'); assert.deepEqual(await w.storage.findMutationAttempt(w.workspace.id, row.idempotencyKey), row)
})
for (const key of [CapabilityKey.DevelopmentAssigneeList, CapabilityKey.DevelopmentChangeRequestAssigneeRead, CapabilityKey.DevelopmentChangeRequestAssigneeAdd]) test(`nonempty preflight rejects ${key} but default remains supported`, async t => {
  const w = await setup(t); w.policy = { [key]: 'unavailable' }; await w.compose()
  assert.equal((await w.run({ assigneeIds: ['U_1'] })).writeState, 'failed'); assert.equal(w.f.mutations().length, 0)
  assert.equal((await w.run()).writeState, 'confirmed'); assert.equal(w.adds, 0)
})
for (const regrant of [false, true]) test(`creation continuation cannot bypass common final permission gate after concurrent saved denial or regrant=${regrant}`, async t => {
  const w = await setup(t), describe = w.f.provider.describeCapabilities, read = w.f.provider.getChangeRequestAssignees
  let raced = false, denied = false, version = 0, armed = false, lists = 0
  w.f.provider.describeCapabilities = async () => { const s = await describe(); return { ...s, permission: { ...s.permission, [CapabilityKey.DevelopmentChangeRequestAssigneeRead]: denied ? 'unavailable' : 'available' }, permissionVersion: { [CapabilityKey.DevelopmentChangeRequestAssigneeRead]: version } } }
  w.afterRead = async method => { if (method === 'listMutationAttempts' && armed && ++lists === 2) { armed = false; denied = true; version++; if (regrant) { await w.core.queries.getChangeRequestOperation(w.scope); denied = false; version++; await w.core.queries.getChangeRequestOperation(w.scope) } } }
  w.f.provider.getChangeRequestAssignees = async input => { const result = await read(input); if (!raced) { raced = true; const row = (await w.storage.listMutationAttempts(w.workspace.id)).find(r => r.commandName === 'addChangeRequestAssignees'); await w.core.commands.resumeChangeRequestAssignees({ ...w.scope, createOperationId: row.externalIntent.createOperationId, operationId: row.id, observer: { kind: 'user' } }); armed = true } return result }
  const result = await w.run({ assigneeIds: ['U_1'] }); assert.equal(result.writeState, 'confirmed'); assert.notEqual(result.value.assignment.state, 'confirmed'); assert.equal(armed, false)
  assert.equal((await w.storage.findMutationAttempt(w.workspace.id, 'create-1')).state, 'saved'); assert.equal(w.adds, 1)
})
test('pending before dispatch stays unknown and query remains local after SQLite reopen', async t => {
  const w = await setup(t); await w.run({ assigneeIds: ['U_1'] })
  const row = (await w.storage.listMutationAttempts(w.workspace.id)).find(r => r.commandName === 'addChangeRequestAssignees')
  await w.storage.putMutationAttempt({ ...row, state: 'pending', externalIntent: { ...row.externalIntent, state: 'pending', confirmedIds: [] } }); w.ids = []; await w.reopen()
  const calls = w.f.calls.length, adds = w.adds
  const local = await w.core.queries.getChangeRequestOperation(w.scope); assert.equal(local.assignment.state, 'pending'); assert.equal(w.f.calls.length, calls); assert.equal(w.adds, adds)
  assert.equal((await w.resume()).value.assignment.state, 'unknown'); assert.equal(w.adds, adds)
})
test('two SQLite Core continuations claim exactly one stable creation assignment', async t => {
  const { createSqliteStorage } = await import('@harness-projects/storage-sqlite'), { composeCore } = await import('@harness-projects/core')
  const w = await setup(t, { dropAck: true }); await w.run({ assigneeIds: ['U_1'] })
  const op = await w.core.queries.getChangeRequestOperation(w.scope), storage = createSqliteStorage(w.path); t.after(() => storage.close())
  const core = await composeCore({ workspace: w.workspace, providers: w.providers, storage })
  const request = { ...w.scope, operationId: op.operationId, observer: { kind: 'user' } }
  const results = await Promise.all([w.core.commands.resumeChangeRequest(request), core.commands.resumeChangeRequest(request)])
  assert.ok(results.some(r => r.phase === 'reconciled')); assert.equal(w.adds, 1)
  assert.equal((await core.commands.resumeChangeRequest(request)).phase, 'reconciled'); assert.equal(w.adds, 1)
  assert.equal((await w.storage.listMutationAttempts(w.workspace.id)).filter(r => r.commandName === 'addChangeRequestAssignees').length, 1)
})
for (const mutation of ['target', 'receipt']) test(`last assignment await revalidates create ${mutation} before returning`, async t => {
  const w = await setup(t), read = w.f.provider.getChangeRequestAssignees
  w.f.provider.getChangeRequestAssignees = async input => { const result = await read(input)
    if (mutation === 'target') await w.storage.putExecutionContext({ ...w.record, provisioningGeneration: 2 })
    else { const row = await w.storage.findMutationAttempt(w.workspace.id, 'create-1'); await w.storage.putMutationAttempt({ ...row, expectedSourceVersion: 'replacement' }) }
    return result }
  const result = await w.run({ assigneeIds: ['U_1'] }); assert.equal(result.writeState, 'conflict'); assert.equal(result.authoritative, false); assert.equal(w.adds, 1)
  const local = await w.core.queries.getChangeRequestOperation(w.scope)
  assert.equal(local.requestedAssigneeIds, undefined); assert.equal((await w.storage.findMutationAttempt(w.workspace.id, 'create-1')).state, 'saved')
})
test('last local assignment authorization await cannot return a replaced create receipt', async t => {
  const w = await setup(t), describe = w.f.provider.describeCapabilities
  let armed = false, injected = false
  w.afterRead = async method => { if (method === 'getDeliveryFacts' && w.adds) armed = true }
  w.f.provider.describeCapabilities = async () => { const result = await describe(); if (armed && !injected) { injected = true; w.storage.db.prepare("UPDATE mutation_attempt SET expected_source_version = 'late-replacement' WHERE command_name = 'createChangeRequest'").run() } return result }
  const result = await w.run({ assigneeIds: ['U_1'] }); assert.equal(injected, true); assert.equal(result.writeState, 'conflict'); assert.equal(w.adds, 1)
})

for (const method of ['listAssignableUsers', 'getChangeRequestAssignees', 'addChangeRequestAssignees']) test(`missing ${method} rejects selected IDs before create but allows nobody`, async t => {
  const w = await setup(t); delete w.f.provider[method]
  const rejected = await w.run({ assigneeIds: ['U_1'] }); assert.equal(rejected.writeState, 'failed'); assert.deepEqual(rejected.value.assignment, { state: 'failed', reason: 'not_supported' }); assert.equal(w.f.mutations().length, 0)
  assert.equal((await w.run()).writeState, 'confirmed'); assert.equal(w.adds, 0)
})
for (const label of ['Fake', 'SQLite']) test(`${label} create metadata clone rejects malformed IDs while retaining original receipt`, async t => {
  const w = await setup(t, {}, label); await w.run({ assigneeIds: [' U_1 ', 'U_2'] })
  const row = await w.storage.findMutationAttempt(w.workspace.id, 'create-1')
  for (const requestedAssigneeIds of [[], null, [' '], ['U', 'U'], ['U_2', 'U_1'], Array(11).fill('U')]) await assert.rejects(() => w.storage.putMutationAttempt({ ...row, externalIntent: { ...row.externalIntent, requestedAssigneeIds } }))
  row.externalIntent.requestedAssigneeIds[0] = 'caller-change'; await w.reopen()
  assert.deepEqual((await w.storage.findMutationAttempt(w.workspace.id, 'create-1')).externalIntent.requestedAssigneeIds, [' U_1 ', 'U_2'])
})

test('stable key cannot adopt another actor even when native IDs and PR target match', async t => {
  const { createHash } = await import('node:crypto'), w = await setup(t, { dropAck: true })
  await w.run({ assigneeIds: ['U_1'] }); w.policy = { [CapabilityKey.DevelopmentChangeRequestAssigneeAdd]: 'unavailable' }; await w.compose(); await w.resume()
  const op = await w.core.queries.getChangeRequestOperation(w.scope), key = `pr-assignees:${op.operationId}:${createHash('sha256').update(JSON.stringify(['U_1'])).digest('hex')}`
  w.policy = {}; await w.compose()
  assert.equal((await w.core.commands.addChangeRequestAssignees({ ...w.scope, createOperationId: op.operationId, actor: { kind: 'user', id: 'different-actor' }, assigneeIds: ['U_1'], idempotencyKey: key })).phase, 'confirmed')
  const result = await w.resume(); assert.notEqual(result.value.assignment.state, 'confirmed'); assert.equal(w.adds, 1)
  const view = await w.core.queries.getChangeRequestOperation(w.scope); assert.equal(view.requestedAssigneeIds, undefined)
})

test('creation with partial assignee readback preserves confirmed PR and original planning facts', async t => {
  const w = await setup(t), before = await w.storage.listPlanningProjections(w.workspace.id), read = w.f.provider.getChangeRequestAssignees
  w.f.provider.getChangeRequestAssignees = async input => { const result = await read(input); return { ...result, value: { ...result.value, users: result.value.users.slice(0, 1) } } }
  const result = await w.run({ assigneeIds: ['U_1', 'U_2'] })
  assert.equal(result.writeState, 'confirmed'); assert.equal(result.value.ref.externalId, 'PR_1'); assert.equal(result.value.assignment.state, 'unknown')
  assert.deepEqual(await w.storage.listPlanningProjections(w.workspace.id), before); assert.equal(w.adds, 1); assert.equal(w.f.mutations().length, 1)
  const create = await w.storage.findMutationAttempt(w.workspace.id, 'create-1'); assert.deepEqual(JSON.parse(create.requestFingerprint).actor, w.request.actorRef)
  assert.equal(w.f.mutations()[0].variables.input.author, undefined); assert.equal((await w.resume()).value.assignment.state, 'unknown'); assert.equal(w.adds, 1)
})
test('selected IDs never dispatch assignment after definite creation refusal', async t => {
  const w = await setup(t, { mutation: () => ({ status: 403, headers: {}, body: {} }) })
  const result = await w.run({ assigneeIds: ['U_1'] })
  assert.equal(result.writeState, 'failed'); assert.equal(result.authoritative, false); assert.equal(w.f.mutations().length, 1); assert.equal(w.adds, 0)
  assert.equal((await w.storage.listMutationAttempts(w.workspace.id)).some(r => r.commandName === 'addChangeRequestAssignees'), false)
})
