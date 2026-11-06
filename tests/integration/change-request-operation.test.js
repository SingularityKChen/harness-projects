import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { CapabilityKey } from '@harness-projects/capabilities'
import { createControllerQueries } from '../../packages/controller/src/queries.ts'
import { world, ready } from '../fixtures/change-request-world.mjs'
import { ok } from '../fixtures/github-development-create.mjs'
const snapshot = async (w) => [w.f.calls.length, await w.storage.listMutationAttempts(w.workspace.id), await w.storage.listRelations(w.workspace.id), await w.storage.getDeliveryFacts(w.workspace.id, w.record.id), await w.storage.currentRevision(w.workspace.id),
  ['entity', 'external_identity'].map((table) => w.storage.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all())]
async function query(w, patch = {}) {
  const originals = Object.fromEntries(Object.entries(w.f.provider).filter(([, value]) => typeof value === 'function')); let calls = 0
  for (const name of Object.keys(originals)) w.f.provider[name] = () => { calls++; throw new Error('operation query attempted Provider I/O') }
  try {
    const result = await createControllerQueries(w.core, 'provider').getChangeRequestOperation({ ...w.scope, ...patch })
    assert.equal(calls, 0); return result
  } finally { Object.assign(w.f.provider, originals) }
}
const resume = (w, id, patch = {}) => w.commands.resumeChangeRequest({ ...w.scope, operationId: id, actorRef: { kind: 'harness_peer', id: 'observer-B' }, ...patch })
for (const dropAck of [true, false]) test(`local discovery recovers an immutable operation after ${dropAck ? 'provider ack' : 'whole successful answer'} loss and SQLite reopen`, async (t) => {
  const w = await world(t, 'SQLite', { dropAck })
  const empty = await snapshot(w); assert.deepEqual(await query(w), { kind: 'none' }); assert.deepEqual(await snapshot(w), empty)
  await w.run(); await w.reopen()
  const before = await snapshot(w), view = await query(w)
  assert.equal(before[1][0].state, dropAck ? 'unknown' : 'saved')
  assert.equal(view.kind, 'operation'); assert.equal(view.currentTarget, true); assert.equal(view.state, dropAck ? 'unknown' : 'saved')
  assert.deepEqual(Object.keys(view).sort(), ['kind', 'operationId', 'state', 'currentTarget', 'targetStamp', 'head', 'base', 'title', 'draft'].sort())
  assert.deepEqual(await snapshot(w), before)
  const result = await resume(w, view.operationId), original = before[1][0], saved = (await w.storage.listMutationAttempts(w.workspace.id))[0]
  assert.equal(result.writeState, 'reconciled'); assert.equal(result.value.operationId, view.operationId); assert.equal(result.value.targetStamp, view.targetStamp)
  assert.deepEqual([saved.idempotencyKey, saved.requestFingerprint, saved.externalIntent.input], [original.idempotencyKey, original.requestFingerprint, original.externalIntent.input])
  assert.equal((await w.run({ actorRef: { kind: 'harness_peer', id: 'observer-B' } })).writeState, 'conflict')
  assert.equal(w.f.mutations().length, 1)
})
for (const state of ['pending', 'unknown', 'saved', 'failed', 'conflict']) test(`specific ${state} operation query is local and preserves all durable state`, async (t) => {
  const w = await world(t, 'SQLite', { dropAck: state !== 'saved' }); await w.run()
  const row = (await w.storage.listMutationAttempts(w.workspace.id))[0]
  await w.storage.putMutationAttempt({ ...row, state, externalIntent: { ...row.externalIntent, state } })
  const before = await snapshot(w), view = await query(w, { operationId: row.id })
  assert.equal(view.state, state); assert.deepEqual(await snapshot(w), before)
})
for (const defect of ['missing', 'foreign', 'target', 'read-denied', 'malformed', 'zero', 'multiple', 'incomplete', 'throw', 'write-only-denied', 'getter', 'read-denied-saved', 'write-only-denied-saved', 'malformed-saved']) test(`resume ${defect} has no dispatch path`, async (t) => {
  const w = await world(t, 'SQLite', { dropAck: !defect.endsWith('-saved') }); await w.run()
  const row = (await w.storage.listMutationAttempts(w.workspace.id))[0]; let writes = 0, getters = 0
  w.f.provider.createChangeRequest = async () => { writes++; throw new Error('forbidden resume dispatch') }
  if (defect === 'target') await w.storage.putExecutionContext({ ...w.record, provisioningGeneration: 2, branchExternalId: 'feature/decoy' })
  if (defect.startsWith('read-denied') || defect.startsWith('write-only-denied')) { w.policy = { [defect.startsWith('read-denied') ? CapabilityKey.DevelopmentChangeRequestRead : CapabilityKey.DevelopmentChangeRequestCreate]: 'unavailable' }; await w.reopen() }
  if (defect.startsWith('malformed')) w.storage.db.prepare('UPDATE mutation_attempt SET external_intent_json = ?').run(JSON.stringify({ ...row.externalIntent, input: { ...row.externalIntent.input, title: 'tampered' } }))
  if (defect === 'zero') w.f.objects.length = 0
  if (defect === 'multiple') w.f.objects.push({ ...w.f.objects[0], id: 'PR_2', number: 2 })
  if (defect === 'incomplete') w.f.provider.listChangeRequests = async () => ({ ok: true, value: { items: [], nextCursor: 'loop' } })
  if (defect === 'throw') w.f.provider.listChangeRequests = async () => { throw new Error('read failed') }
  const before = await snapshot(w), view = await query(w, { operationId: row.id })
  assert.deepEqual(await snapshot(w), before)
  if (defect === 'target') assert.equal(view.currentTarget, false)
  if (defect.startsWith('read-denied') || defect.startsWith('malformed')) assert.equal(view.kind, 'blocked')
  const result = defect === 'getter' ? await w.commands.resumeChangeRequest({ ...w.scope, actorRef: { kind: 'observer' }, get operationId() { getters++; return row.id } })
    : await resume(w, defect === 'missing' ? 'absent' : row.id, defect === 'foreign' ? { repositoryId: 'foreign' } : {})
  assert.equal(getters, 0)
  if (defect === 'write-only-denied') assert.ok(w.f.calls.slice(before[0]).some((call) => call.operationName === 'DevelopmentChangeRequest'))
  if (defect === 'target') assert.deepEqual([result.value.operationId, result.value.targetStamp], [row.id, view.targetStamp])
  assert.equal(result.authoritative, defect.startsWith('write-only-denied')); assert.equal(writes, 0); assert.equal(w.f.mutations().length, 1)
})
test('discovery exposes target changes, blocks multiple valid unresolved operations and malformed requests without writes', async (t) => {
  const w = await world(t, 'SQLite', { dropAck: true }); await w.run()
  await w.storage.putExecutionContext({ ...w.record, provisioningGeneration: 2, branchExternalId: 'feature/decoy' })
  assert.equal((await query(w)).currentTarget, false)
  await w.run({ idempotencyKey: 'second' })
  const before = await snapshot(w)
  assert.deepEqual(await query(w), { kind: 'blocked', reason: 'ambiguous' })
  assert.deepEqual(await query(w, { extra: true }), { kind: 'blocked', reason: 'invalid_operation' })
  assert.deepEqual(await snapshot(w), before)
})
for (const late of ['ambiguous', 'denied', 'ack']) test(`resumer Saved receipt survives creator's late ${late} result`, async (t) => {
  let entered, release, w
  const barrier = new Promise((resolve) => { entered = resolve }), gate = new Promise((resolve) => { release = resolve })
  w = await world(t, 'SQLite', { mutation: async (data) => { const node = w.f.node(data, 1); w.f.objects.push(node); entered(); await gate
    if (late === 'ambiguous') throw new Error('ack lost')
    return late === 'denied' ? { status: 403, headers: {}, body: {} } : ok({ createPullRequest: { pullRequest: node } })
  } })
  const creating = w.run(); await barrier
  const operation = await query(w), result = await resume(w, operation.operationId)
  assert.equal(result.writeState, 'reconciled')
  const saved = (await snapshot(w)).slice(1); release()
  assert.equal((await creating).authoritative, true)
  assert.deepEqual((await snapshot(w)).slice(1), saved); assert.equal(w.f.mutations().length, 1)
})
for (const label of ['Fake', 'SQLite']) for (const state of ['candidate', 'confirmed']) test(`${label} preserves supported relation states and command provenance over prior ${state}`, async (t) => {
  const w = await world(t, label, { dropAck: true }); await ready(w)
  w.providers.development = w.f.provider; await w.compose(); await w.run(); await w.core.commands.refreshDeliveryFacts(w.scope)
  const before = await w.storage.listRelations(w.workspace.id), edge = before.find((edge) => edge.type === 'produced_by')
  await assert.rejects(() => w.storage.putRelation(w.workspace.id, { ...edge, state: 'rejected' }))
  assert.deepEqual(await w.storage.listRelations(w.workspace.id), before)
  if (state === 'confirmed') await w.core.commands.confirmRelation(edge)
  const view = await query(w), result = await resume(w, view.operationId)
  assert.equal(result.writeState, 'reconciled'); assert.equal((await query(w, { operationId: view.operationId })).state, 'saved')
  const confirmed = (await w.storage.listRelations(w.workspace.id)).find((row) => row.from === edge.from && row.to === edge.to && row.type === edge.type)
  assert.deepEqual([confirmed.state, confirmed.source], ['confirmed', 'explicit'])
})
for (const winner of ['complete', 'incomplete']) test(`last transaction reads ${winner} winner after newer refresh supersedes older complete read`, async (t) => {
  const w = await world(t, 'SQLite'); let entered, release, first = true
  const gate = new Promise((resolve) => { release = resolve }), barrier = new Promise((resolve) => { entered = resolve }), branches = w.f.provider.listBranches.bind(w.f.provider)
  w.f.provider.listBranches = async (args) => { if (first) { first = false; entered(); await gate } return branches(args) }
  const creation = w.run(); await barrier; assert.equal(first, false)
  if (winner === 'incomplete') w.options.read = () => ({ status: 503, headers: {}, body: {} })
  assert.equal((await w.core.commands.refreshDeliveryFacts(w.scope)).applied, true)
  const newer = await w.storage.getDeliveryFacts(w.workspace.id, w.record.id)
  delete w.options.read; release()
  const result = await creation
  assert.equal(result.writeState, 'confirmed'); assert.equal(result.value.lineageStale, winner === 'incomplete')
  assert.deepEqual(await w.storage.getDeliveryFacts(w.workspace.id, w.record.id), newer); assert.equal(w.f.mutations().length, 1)
})
for (const revoke of ['visibility', 'binding', 'target']) test(`last transaction fences ${revoke} revocation after real final provider read`, async (t) => {
  const w = await world(t, 'SQLite'), branches = w.f.provider.listBranches.bind(w.f.provider); let hits = 0
  w.f.provider.listBranches = async (args) => {
    const result = await branches(args); hits++
    if (revoke === 'target') await w.storage.putExecutionContext({ ...w.record, provisioningGeneration: 2, branchExternalId: 'feature/decoy' })
    else if (revoke === 'visibility') { const row = await w.storage.getPlanningProjection(w.workspace.id, w.scope.workItemId); await w.storage.putPlanningProjection(w.workspace.id, { ...row, content: { contentKind: 'redacted', reason: 'unavailable' } }) }
    else { const row = (await w.storage.listProviderBindings(w.workspace.id)).find((row) => row.domain === 'development'); await w.storage.putProviderBinding({ ...row, enabled: false, isDefault: false }) }
    return result
  }
  const result = await w.run()
  assert.equal(hits, 1); assert.equal(result.writeState, 'conflict'); assert.equal(result.authoritative, false)
  assert.equal((await w.storage.findMutationAttempt(w.workspace.id, 'create-1')).state, 'saved'); assert.equal(w.f.mutations().length, 1)
})

for (const [kind, selector] of [['missing'], ['undefined', undefined], ['null', null], ['empty', ''], ['space', ' '], ['number', 7], ['object', {}], ['array', []]]) test(`required resume selector ${kind} rejects before discovery or reads`, async (t) => {
  const w = await world(t, 'SQLite', { dropAck: true }); await w.run()
  const request = { ...w.scope, actorRef: { kind: 'observer', id: 'B' } }
  if (kind !== 'missing') request.operationId = selector
  const before = await snapshot(w), result = await w.commands.resumeChangeRequest(request)
  assert.equal(result.authoritative, false); assert.equal(result.writeState, 'conflict')
  assert.deepEqual(await snapshot(w), before)
})

for (const patch of [{ provisioningGeneration: 2 }, { branchExternalId: 'feature/decoy' }, { worktreeExternalId: 'new-tree' }]) test(`historical Saved ${Object.keys(patch)[0]} is exact-ID only after target changes`, async (t) => {
  const w = await world(t, 'SQLite'); await w.run(); const original = await query(w)
  await w.storage.putExecutionContext({ ...w.record, ...patch })
  const before = await snapshot(w)
  assert.deepEqual(await query(w), { kind: 'none' })
  assert.equal((await query(w, { operationId: original.operationId })).currentTarget, false)
  assert.deepEqual(await snapshot(w), before)
})
for (const dropAck of [false, true]) test(`eligible Saved plus ${dropAck ? 'Unknown' : 'Saved'} is ambiguous without choosing first/latest`, async (t) => {
  const w = await world(t, 'SQLite'); await w.run()
  w.f.objects[0].state = 'CLOSED'; w.options.dropAck = dropAck
  await w.run({ idempotencyKey: 'next-explicit-operation' })
  const before = await snapshot(w)
  assert.deepEqual(before[1].map((row) => row.state).sort(), dropAck ? ['saved', 'unknown'] : ['saved', 'saved'])
  assert.deepEqual(await query(w), { kind: 'blocked', reason: 'ambiguous' })
  assert.deepEqual(await snapshot(w), before); assert.equal(w.f.mutations().length, 2)
  await w.core.commands.refreshDeliveryFacts(w.scope)
  const facts = (await w.storage.getDeliveryFacts(w.workspace.id, w.record.id)).sets.find((set) => set.kind === 'change_request')
  assert.deepEqual([facts.stale, facts.nodes.map((node) => node.externalId)], [true, ['PR_1']], 'ambiguous current operations cannot select the first or newest PR')
})

for (const label of ['Fake', 'SQLite']) test(`${label} successor operation refreshes exact PR across a durable successor generation fixture`, async (t) => {
  const w = await world(t, label); await ready(w)
  const describe = w.fake.development.describeCapabilities.bind(w.fake.development)
  w.fake.development.describeCapabilities = async () => {
    const snapshot = await describe(), capability = { ...snapshot.capability }
    delete capability[CapabilityKey.DevelopmentChangeRequestRead]
    return { ...snapshot, capability }
  }
  await w.compose()
  const first = await w.run(), oldEdges = await w.storage.listRelations(w.workspace.id)
  assert.equal(first.value.lineageStale, false)
  const anchor = (await w.storage.getDeliveryFacts(w.workspace.id, w.record.id)).sets.find((set) => set.kind === 'change_request').anchorId
  w.f.objects[0].state = 'CLOSED'
  // Start Work 不再为已有 run 的新任务接管；这里明确建立后继代际 fixture，单独检验 PR 身份。
  const current = await w.storage.getExecutionContext(w.record.id)
  await w.storage.putExecutionContext({ ...current, provisioningGeneration: current.provisioningGeneration + 1 })
  assert.equal((await w.storage.getExecutionContext(w.record.id)).provisioningGeneration, current.provisioningGeneration + 1)
  const second = await w.run({ idempotencyKey: 'successor-pr', title: 'Second generation PR' })
  assert.equal(second.authoritative, true)
  assert.equal(second.value.lineageStale, false, 'historical explicit relation cannot block the current durable operation')
  assert.deepEqual(w.f.objects.map((pr) => [pr.headRefName, pr.headRefOid]), [['feature/topic', 'a'.repeat(40)], ['feature/topic', 'a'.repeat(40)]])
  w.f.objects.unshift({ ...w.f.objects[0], id: 'PR_decoy', number: 3, title: 'same-SHA decoy' })
  await w.reopen()
  const view = await w.core.queries.getChangeRequestOperation(w.scope)
  assert.deepEqual([view.operationId, view.currentTarget], [second.value.operationId, true])
  for (let pass = 0; pass < 2; pass++) {
    await w.core.commands.refreshDeliveryFacts(w.scope)
    const facts = (await w.storage.getDeliveryFacts(w.workspace.id, w.record.id)).sets.find((set) => set.kind === 'change_request')
    assert.deepEqual([facts.anchorId, facts.stale, facts.nodes.map((node) => [node.entityId, node.externalId])], [anchor, false, [[second.value.entityId, 'PR_2']]])
  }
  const resumed = await resume(w, view.operationId), edges = await w.storage.listRelations(w.workspace.id)
  assert.deepEqual([resumed.authoritative, resumed.value.lineageStale, resumed.value.ref.externalId, w.f.mutations().length], [true, false, 'PR_2', 2])
  for (const edge of oldEdges) assert.deepEqual(edges.find((row) => row.from === edge.from && row.to === edge.to && row.type === edge.type), edge)
})

for (const draft of [true, false, undefined]) test(`durable Draft intent survives SQLite restart: ${draft}`, async (t) => {
  const w = await world(t, 'SQLite', { dropAck: true })
  assert.equal((await w.run(draft === undefined ? {} : { draft })).writeState, 'unknown')
  const row = await w.storage.findMutationAttempt(w.workspace.id, 'create-1')
  assert.equal(row.externalIntent.input.draft, draft ?? false)
  assert.equal(JSON.parse(row.requestFingerprint).draft, draft ?? false)
  await w.reopen(); const view = await query(w)
  assert.equal(view.draft, draft ?? false)
  assert.equal((await resume(w, view.operationId)).writeState, 'reconciled')
  assert.equal(w.f.mutations().length, 1)
  assert.equal((await w.storage.listRelations(w.workspace.id)).filter((row) => row.type === 'produced_by' && row.state === 'confirmed').length, 1)
})
test('changed Draft conflicts for key and unresolved head slot; invalid explicit values never write', async (t) => {
  const w = await world(t, 'Fake', { dropAck: true })
  for (const draft of [null, 'true', 0, {}]) assert.equal((await w.run({ draft })).writeState, 'failed')
  assert.equal(w.f.calls.length, 0)
  assert.equal((await w.run({ draft: true })).writeState, 'unknown')
  for (const idempotencyKey of ['create-1', 'another-key']) assert.equal((await w.run({ draft: false, idempotencyKey })).writeState, 'conflict')
  assert.equal(w.f.mutations().length, 1)
})
for (const actual of [undefined, false]) test(`unconfirmed Draft does not become Saved after platform state ${actual}`, async (t) => {
  const w = await world(t, 'SQLite', { dropAck: true }); assert.equal((await w.run({ draft: true })).writeState, 'unknown'); await w.reopen()
  if (actual === undefined) delete w.f.objects[0].isDraft; else w.f.objects[0].isDraft = actual
  const view = await query(w), result = await resume(w, view.operationId)
  assert.equal(result.writeState, 'unknown'); assert.equal(w.f.mutations().length, 1)
})
test('saved Draft remains addressable after platform marks ready', async (t) => {
  const w = await world(t, 'SQLite'), first = await w.run({ draft: true })
  assert.equal(first.writeState, 'confirmed'); w.f.objects[0].isDraft = false; await w.reopen()
  const view = await query(w); assert.equal(view.draft, true)
  const resumed = await resume(w, view.operationId)
  assert.equal(resumed.writeState, 'reconciled'); assert.deepEqual(resumed.value.ref, first.value.ref); assert.equal(w.f.mutations().length, 1)
})

test('Draft exact get must agree after complete list evidence', async (t) => {
  const w = await world(t, 'SQLite', { dropAck: true }); await w.run({ draft: true })
  const get = w.f.provider.getChangeRequest
  w.f.provider.getChangeRequest = async (...args) => { const result = await get(...args); return { ...result, value: { ...result.value, isDraft: false } } }
  const view = await query(w); assert.equal((await resume(w, view.operationId)).writeState, 'unknown'); assert.equal(w.f.mutations().length, 1)
})
test('unsupported legacy Draft-less intent is retained and cannot dispatch', async (t) => {
  const w = await world(t, 'SQLite', { dropAck: true }); await w.run()
  const row = await w.storage.findMutationAttempt(w.workspace.id, 'create-1'), intent = structuredClone(row.externalIntent); delete intent.input.draft
  w.storage.db.prepare('UPDATE mutation_attempt SET external_intent_json = ?').run(JSON.stringify(intent))
  const before = w.f.calls.length
  assert.equal((await query(w)).kind, 'blocked'); assert.equal((await resume(w, row.id)).authoritative, false)
  assert.equal(w.f.calls.length, before); assert.equal(w.f.mutations().length, 1)
  assert.equal(JSON.parse(w.storage.db.prepare('SELECT external_intent_json FROM mutation_attempt').get().external_intent_json).input.draft, undefined)
})

for (const actual of [false, undefined]) test(`same-marker ambiguity survives original Draft state ${actual}`, async (t) => {
  const w = await world(t, 'SQLite', { dropAck: true })
  assert.equal((await w.run({ draft: true })).writeState, 'unknown')
  const original = w.f.objects[0]
  w.f.objects.push({ ...original, id: 'PR_2', number: 2 })
  original.state = 'CLOSED'
  if (actual === undefined) delete original.isDraft; else original.isDraft = actual
  await w.reopen()
  const view = await query(w), before = w.f.calls.length, result = await resume(w, view.operationId)
  assert.equal(result.authoritative, false, 'mutable Draft state cannot choose between native identities')
  assert.equal(result.writeState, 'unknown')
  const row = await w.storage.findMutationAttempt(w.workspace.id, 'create-1')
  assert.equal(row.state, 'unknown'); assert.equal(row.externalIntent.confirmedRef, undefined)
  assert.equal((await w.storage.listRelations(w.workspace.id)).filter((edge) => edge.type === 'produced_by' && edge.source === 'explicit').length, 0)
  assert.equal(w.f.calls.slice(before).some((call) => call.operationName === 'DevelopmentChangeRequest'), false, 'ambiguous list cannot select an exact PR')
  assert.equal(w.f.mutations().length, 1)
})
