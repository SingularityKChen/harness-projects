import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { CapabilityKey } from '@harness-projects/capabilities'
import { createFakeStorage, exportFakeStorageState } from '@harness-projects/provider-fake'
import { repository, input, ok } from '../fixtures/github-development-create.mjs'
import { world, ready } from '../fixtures/change-request-world.mjs'

for (const label of ['Fake', 'SQLite']) {
  test(`durable PR persists before production mutation and confirms native lineage (${label})`, async (t) => {
    let w
    w = await world(t, label, { mutation: async (data) => {
      const attempt = await w.storage.findMutationAttempt(w.workspace.id, 'create-1')
      assert.equal(attempt.state, 'pending'); assert.equal(attempt.externalIntent.operation, 'createChangeRequest')
      assert.match(attempt.requestFingerprint, /trusted-user/); assert.match(data.body, /<!-- harness-pr-operation:[a-f0-9]{64} -->/)
      const node = w.f.node(data, 1); w.f.objects.push(node)
      return ok({ createPullRequest: { pullRequest: node } })
    } })
    const before = await w.storage.listPlanningProjections(w.workspace.id)
    const result = await w.run()
    assert.equal(result.writeState, 'confirmed', JSON.stringify(result)); assert.equal(result.authoritative, true)
    assert.equal(result.value.ref.externalId, 'PR_1'); assert.equal(result.value.lineageStale, false, '可选 CI 缺口不影响 PR 集合确认')
    assert.ok((await w.storage.listRelations(w.workspace.id)).some((edge) => edge.from === result.value.entityId && edge.type === 'produced_by' && edge.state === 'confirmed'))
    const decoy = { ...w.f.objects[0], id: 'PR_decoy', number: 2, title: 'Decoy' }; w.f.objects.unshift(decoy)
    await w.core.commands.refreshDeliveryFacts(w.scope)
    assert.equal((await w.core.queries.getDeliveryProjection(w.scope)).hops.find((hop) => hop.entityKind === 'change_request').externalId, 'PR_1')
    await w.reopen(); assert.equal((await w.run()).writeState, 'reconciled')
    assert.equal(w.f.mutations().length, 1); assert.deepEqual(await w.storage.listPlanningProjections(w.workspace.id), before)
  })
  test(`accepted then dropped response recovers after reopen; new key observes original (${label})`, async (t) => {
    const w = await world(t, label, { dropAck: true })
    assert.equal((await w.run()).writeState, 'unknown')
    await w.reopen()
    assert.equal((await w.run({ idempotencyKey: 'another-key' })).writeState, 'reconciled')
    assert.equal(w.f.mutations().length, 1)
    assert.equal(await w.storage.findMutationAttempt(w.workspace.id, 'another-key'), undefined)
  })
  test(`pending persistence failure sends no mutation; ack settlement failure remains recoverable (${label})`, async (t) => {
    const w = await world(t, label)
    w.fault = 'putMutationAttempt'; assert.equal((await w.run()).writeState, 'failed'); assert.equal(w.f.mutations().length, 0)
    w.fault = 'putRelation'; assert.equal((await w.run()).writeState, 'unknown'); assert.equal(w.f.mutations().length, 1)
    w.fault = undefined; await w.reopen(); assert.equal((await w.run()).writeState, 'reconciled')
  })
}
for (const defect of ['zero', 'multiple', 'marker', 'title', 'body', 'head', 'loop', 'page-error', 'truncation', 'malformed', 'read-permission', 'wrong-repository']) {
  test(`unresolved PR ${defect} never creates again or confirms a decoy`, async (t) => {
    const w = await world(t, 'Fake', { dropAck: true })
    assert.equal((await w.run()).writeState, 'unknown')
    if (defect === 'zero') w.f.objects.length = 0
    else if (defect === 'multiple') w.f.objects.push({ ...w.f.objects[0], id: 'PR_2', number: 2 })
    else if (defect === 'marker') w.f.objects[0].body = 'PR body'
    else if (defect === 'title') w.f.objects[0].title += ' changed'
    else if (defect === 'body') w.f.objects[0].body = 'changed ' + w.f.objects[0].body
    else if (defect === 'head') w.f.objects[0].headRefName = 'feature/decoy'
    else if (defect === 'wrong-repository') w.options.read = (request, objects) => request.operationName === 'DevelopmentChangeRequest'
      ? ok({ repository: { id: 'R_synthetic' }, node: { ...objects[0], repository: { id: 'foreign' } } })
      : ok({ repository: { pullRequests: { nodes: objects, pageInfo: { hasNextPage: false, endCursor: null } } } })
    else if (defect === 'malformed') w.f.provider.listChangeRequests = async () => ({ ok: true, value: { items: {} } })
    else if (defect === 'read-permission') w.f.provider.listChangeRequests = async () => ({ ok: false, error: { code: 'permission_denied' } })
    else if (defect === 'truncation') { let page = 0; w.f.provider.listChangeRequests = async () => ({ ok: true, value: { items: [], nextCursor: String(page++) } }) }
    else {
      w.f.provider.listChangeRequests = async ({ cursor }) => cursor === undefined
        ? { ok: true, value: { items: [], nextCursor: 'next' } }
        : defect === 'loop' ? { ok: true, value: { items: [], nextCursor: 'next' } } : { ok: false, error: { code: 'unavailable' } }
    }
    assert.equal((await w.run()).writeState, 'unknown'); assert.equal(w.f.mutations().length, 1)
  })
}
test('request capture rejects forged scope, getters and reserved marker; identity cannot change', async (t) => {
  const w = await world(t)
  for (const patch of [{ head: 'forged' }, { bindingId: 'forged' }, { contextId: 'forged' }, { actor: {} }, { body: '<!-- harness-pr-operation:forged -->' }, { workItemId: 'unknown' }, { repositoryId: 'unknown' }, { title: '' }]) {
    assert.equal((await w.run(patch)).writeState, 'failed', JSON.stringify(patch))
  }
  assert.equal((await w.run({ title: { get value() { throw new Error('getter') } } })).writeState, 'failed')
  assert.equal(w.f.mutations().length, 0)
  await w.run()
  for (const patch of [{ base: 'release' }, { body: 'changed' }, { title: 'changed' }, { actorRef: { kind: 'other' } }]) assert.equal((await w.run(patch)).writeState, 'conflict')
  assert.equal(w.f.mutations().length, 1)
})
test('concurrent identical slots dispatch once and a changed actor cannot inherit confirmation', async (t) => {
  let release, entered
  const barrier = new Promise((resolve) => { entered = resolve }), gate = new Promise((resolve) => { release = resolve })
  let w
  w = await world(t, 'Fake', { mutation: async (data) => { entered(); await gate; const node = w.f.node(data, 1); w.f.objects.push(node); return ok({ createPullRequest: { pullRequest: node } }) } })
  const first = w.run(); await barrier
  assert.equal((await w.run({ idempotencyKey: 'other', actorRef: { kind: 'another' } })).writeState, 'conflict')
  assert.equal((await w.run({ idempotencyKey: 'other' })).writeState, 'unknown')
  release(); assert.equal((await first).writeState, 'confirmed'); assert.equal(w.f.mutations().length, 1)
})

test('production create permission denial is definite after successful read and permits new intent', async (t) => {
  let denied = true
  const w = await world(t, 'Fake', { mutation: () => denied ? { status: 403, headers: {}, body: {} } : ok({}) })
  assert.equal((await w.f.provider.getRepository(repository)).ok, true)
  const result = await w.run()
  assert.equal(result.writeState, 'failed'); assert.equal(result.error.recovery, 'fix_permission')
  assert.equal((await w.run()).writeState, 'failed'); assert.equal(w.f.mutations().length, 1)
  denied = false
  w.providers.development = w.f.make()
  await w.compose()
  assert.equal((await w.run({ idempotencyKey: 'fixed-permission' })).writeState, 'unknown'); assert.equal(w.f.mutations().length, 2)
})
for (const defect of ['unique-page-two', 'multiple-page-two', 'page-two-error', 'wrong-binding', 'wrong-kind', 'wrong-id']) test(`complete recovery evidence ${defect}`, async (t) => {
  const w = await world(t, 'Fake', { dropAck: true })
  await w.run()
  const native = (await w.f.provider.listChangeRequests({ repository, headBranch: input.head, cursor: undefined, limit: 50 })).value.items[0]
  let reads = 0
  w.f.provider.listChangeRequests = async ({ cursor }) => {
    reads++
    if (cursor === undefined) return { ok: true, value: { items: defect === 'multiple-page-two' ? [native] : [], nextCursor: 'page-two' } }
    const changed = { ...native, ref: { ...native.ref, ...(defect === 'wrong-binding' ? { bindingId: 'other' } : defect === 'wrong-kind' ? { objectKind: 'repository' } : defect === 'wrong-id' ? { externalId: '' } : {}) } }
    return defect === 'page-two-error' ? { ok: false, error: { code: 'unavailable' } } : { ok: true, value: { items: [changed], nextCursor: undefined } }
  }
  assert.equal((await w.run()).writeState, defect === 'unique-page-two' ? 'reconciled' : 'unknown')
  assert.equal(reads, 2); assert.equal(w.f.mutations().length, 1)
})

test('revoked visibility, missing context fields and getters reject before dispatch; late context changes retain Unknown', async (t) => {
  const w = await world(t)
  let reads = 0
  const getter = { ...w.request, get title() { reads++; return 'Side effect' } }
  assert.equal((await w.commands.createChangeRequest(getter)).writeState, 'failed'); assert.equal(reads, 0)
  for (const patch of [{ branchExternalId: undefined }, { worktreeExternalId: undefined }]) {
    await w.storage.putExecutionContext({ ...w.record, ...patch })
    assert.equal((await w.run()).writeState, 'failed')
  }
  await w.storage.putExecutionContext(w.record)
  const row = await w.storage.getPlanningProjection(w.workspace.id, w.scope.workItemId)
  for (const kind of ['redacted', 'change_request']) {
    await w.storage.putPlanningProjection(w.workspace.id, { ...row, content: { ...row.content, contentKind: kind } })
    assert.equal((await w.run()).writeState, 'failed')
  }
  await w.storage.putPlanningProjection(w.workspace.id, row)
  await w.storage.putWorkspace({ id: 'other', name: 'Other', statusPolicy: 'provider_authoritative' })
  await w.storage.putPlanningProjection('other', { ...row, workspaceId: 'other' })
  await w.storage.putRepository({ ...(await w.storage.listRepositories(w.workspace.id))[0], workspaceId: 'other' })
  await w.storage.putExecutionContext({ ...w.record, workspaceId: 'other' })
  assert.equal((await w.run()).writeState, 'failed'); assert.equal(w.f.mutations().length, 0)
  await w.storage.putExecutionContext(w.record)
  const pending = await world(t, 'Fake', { mutation: async (data) => { await pending.storage.putExecutionContext({ ...pending.record, provisioningGeneration: 2 }); return ok({ createPullRequest: { pullRequest: pending.f.node(data, 1) } }) } })
  assert.equal((await pending.run()).writeState, 'unknown'); assert.equal(pending.f.mutations().length, 1)
})

for (const label of ['Fake', 'SQLite']) test(`typed PR intent is guarded at write and hydration (${label})`, async (t) => {
  const w = await world(t, label, { dropAck: true }); await w.run()
  const attempt = await w.storage.findMutationAttempt(w.workspace.id, 'create-1')
  for (const patch of [{ commandName: 'startWork' }, { requestFingerprint: undefined }, { externalIntent: { ...attempt.externalIntent, extra: 'forbidden' } }, { externalIntent: { ...attempt.externalIntent, input: { ...attempt.externalIntent.input, environment: {} } } }]) {
    await assert.rejects(() => w.storage.putMutationAttempt({ ...attempt, ...patch }))
  }
  if (label === 'Fake') {
    const state = exportFakeStorageState(w.storage); state.attempts[0].externalIntent.extra = 'forbidden'
    assert.throws(() => createFakeStorage(state))
  } else {
    w.storage.db.prepare('UPDATE mutation_attempt SET external_intent_json = ?').run(JSON.stringify({ ...attempt.externalIntent, extra: 'forbidden' }))
    await assert.rejects(() => w.storage.findMutationAttempt(w.workspace.id, 'create-1'))
  }
})

test('unresolved PR intent cannot replace the already-ready Start Work result', async (t) => {
  const w = await world(t, 'SQLite', { dropAck: true })
  const start = await ready(w)
  const before = await start('ready-before')
  assert.equal(before.confirmed, true)
  assert.equal((await w.run()).writeState, 'unknown')
  const after = await start('ready-after')
  assert.equal(after.phase, before.phase, JSON.stringify({ before, after }))
  assert.equal(after.confirmed, true); assert.equal(after.executionContextId, before.executionContextId)
  assert.equal(w.f.mutations().length, 1)
})

for (const key of [CapabilityKey.DevelopmentRepositoryRead, CapabilityKey.DevelopmentChangeRequestRead, CapabilityKey.DevelopmentChangeRequestCreate]) test(`reopened PR recovery respects original-binding ${key} policy`, async (t) => {
  const w = await world(t, 'SQLite', { dropAck: true }); await w.run()
  w.policy = { [key]: key === CapabilityKey.DevelopmentChangeRequestCreate ? 'read_only' : 'unavailable' }; await w.reopen()
  const before = w.f.calls.length, attempt = await w.storage.findMutationAttempt(w.workspace.id, 'create-1')
  const result = await w.run()
  if (key === CapabilityKey.DevelopmentChangeRequestCreate) assert.equal(result.writeState, 'reconciled')
  else {
    assert.equal(result.authoritative, false); assert.equal(w.f.calls.length, before)
    assert.deepEqual(await w.storage.findMutationAttempt(w.workspace.id, 'create-1'), attempt)
  }
  assert.equal(w.f.mutations().length, 1)
})

test('observed PR candidate becomes exact command lineage before decoy refresh', async (t) => {
  const w = await world(t, 'SQLite', { dropAck: true }); await ready(w)
  w.providers.development = w.f.provider; await w.compose(); await w.run()
  await w.core.commands.refreshDeliveryFacts(w.scope)
  const before = await w.storage.listRelations(w.workspace.id)
  assert.equal(before.find((edge) => edge.type === 'produced_by').state, 'candidate')
  const result = await w.run(), edges = await w.storage.listRelations(w.workspace.id)
  const edge = edges.find((edge) => edge.from === result.value.entityId && edge.type === 'produced_by')
  assert.deepEqual([edge.source, edge.state], ['explicit', 'confirmed'])
  assert.deepEqual(edges.filter((edge) => edge.type !== 'produced_by'), before.filter((edge) => edge.type !== 'produced_by'))
  w.f.objects.unshift({ ...w.f.objects[0], id: 'PR_decoy', number: 2, title: 'decoy' })
  await w.core.commands.refreshDeliveryFacts(w.scope)
  assert.equal((await w.core.queries.getDeliveryProjection(w.scope)).hops.find((hop) => hop.entityKind === 'change_request').externalId, 'PR_1')
})

test('confirmed PR preserves Saved but reports stale lineage when production reads fail', async (t) => {
  const w = await world(t, 'SQLite', { read: () => ({ status: 503, headers: {}, body: {} }) }), result = await w.run()
  assert.deepEqual([result.writeState, result.value.lineageStale], ['confirmed', true])
  assert.equal((await w.storage.findMutationAttempt(w.workspace.id, 'create-1')).state, 'saved')
  assert.equal(w.f.mutations().length, 1)
})
