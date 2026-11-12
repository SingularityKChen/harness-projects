import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { externalIntentSnapshot, validateExternalIntentCommand } from '@harness-projects/capabilities'
import { createControllerQueries } from '../../packages/controller/src/queries.ts'
import { createContext } from '../../packages/core/src/context.ts'
import { getChangeRequestOperation } from '../../packages/core/src/create-change-request.ts'
import { world } from '../fixtures/change-request-world.mjs'

const hash = text => createHash('sha256').update(text).digest('hex')
async function historical(w) {
  assert.equal((await w.run({ issueRelation: 'none' })).writeState, 'confirmed')
  const row = await w.storage.findMutationAttempt(w.workspace.id, 'create-1')
  const source = row.externalIntent
  const request = { command: 'createChangeRequest', version: 1, workspace: w.workspace.id, actor: w.request.actorRef, repository: source.input.repository, binding: source.bindingId,
    contextId: source.contextId, generation: source.ownerGeneration, head: source.input.head, worktree: source.worktree, base: w.request.base, title: w.request.title, body: w.request.body, draft: false }
  const requestFingerprint = JSON.stringify(request), externalIntent = structuredClone(row.externalIntent)
  delete externalIntent.issueSelection
  externalIntent.requestFormat = 'original'
  externalIntent.input.body = `${request.body}\n<!-- harness-pr-operation:${hash(JSON.stringify([requestFingerprint, row.idempotencyKey]))} -->`
  return { ...row, requestFingerprint, externalIntent }
}
const raw = w => w.storage.db.prepare('SELECT * FROM mutation_attempt ORDER BY id').all()
// 显式离线转换夹具；正常 Storage API 仍禁止改写已登记请求身份。
const install = (w, row) => w.storage.db.prepare('UPDATE mutation_attempt SET id = ?, request_fingerprint = ?, idempotency_key = ?, external_intent_json = ?').run(row.id, row.requestFingerprint, row.idempotencyKey, JSON.stringify(row.externalIntent))
const query = (w, operationId) => createControllerQueries(w.core, 'provider').getChangeRequestOperation({ ...w.scope, ...(operationId ? { operationId } : {}) })

for (const change of ['planning-denied', 'planning-regranted', 'development-denied', 'projection-redacted', 'binding-disabled', 'last-gate-denied', 'development-denied-before']) test(`original history fences ${change} at its final lineage read`, async t => {
  const w = await world(t, 'SQLite'), row = await historical(w); install(w, row)
  const context = await createContext({ workspace: w.workspace, providers: w.providers, storage: w.storage })
  if (change === 'development-denied-before') context.runtimeAccess.observeOperation(row.bindingId, 'development.change_request.read', w.scope.repositoryId, true)
  const transaction = w.storage.transaction.bind(w.storage); let final = false
  const storage = new Proxy(w.storage, { get(object, key) {
    if (key === 'transaction') return run => transaction(tx => run(new Proxy(tx, { get(target, method) {
      const value = Reflect.get(target, method, target)
      return typeof value !== 'function' ? value : async (...args) => {
        const result = await value.apply(target, args)
        if (method === 'listRelations') {
          final = true
          if (change.startsWith('planning-')) { context.runtimeAccess.deny(context.runtimeAccess.epoch); if (change === 'planning-regranted') context.runtimeAccess.recover(context.runtimeAccess.epoch) }
          if (change === 'development-denied') context.runtimeAccess.observeOperation(row.bindingId, 'development.change_request.read', w.scope.repositoryId, true)
        }
        if (final && method === 'getPlanningProjection' && change === 'projection-redacted') return { ...result, content: { contentKind: 'redacted', reason: 'permission_denied' } }
        if (final && method === 'listProviderBindings' && change === 'last-gate-denied') context.runtimeAccess.deny(context.runtimeAccess.epoch)
        if (final && method === 'listProviderBindings' && change === 'binding-disabled') return result.map(binding => ({ ...binding, enabled: false }))
        return result
      }
    } })))
    const value = Reflect.get(object, key, object); return typeof value === 'function' ? value.bind(object) : value
  } })
  const before = raw(w), calls = w.f.calls.length, revision = await w.storage.currentRevision(w.workspace.id)
  const answer = await getChangeRequestOperation({ ...context, storage }, { ...w.scope, operationId: row.id })
  assert.equal(final, true); assert.equal(answer.kind, 'blocked'); assert.doesNotMatch(JSON.stringify(answer), /head|title|base/)
  assert.equal(w.f.calls.length, calls); assert.equal(await w.storage.currentRevision(w.workspace.id), revision); assert.deepEqual(raw(w), before)
})

test('explicit original saved PR receipt survives reopen and every mutation entry remains inert', async t => {
  const w = await world(t, 'SQLite'), row = await historical(w)
  install(w, row); await w.reopen()
  const before = raw(w), calls = w.f.calls.length, revision = await w.storage.currentRevision(w.workspace.id)
  assert.deepEqual(await query(w), { kind: 'history', operationId: row.id, state: 'saved', head: row.externalIntent.input.head, base: row.externalIntent.input.base, title: row.externalIntent.input.title, draft: false })
  assert.deepEqual(await query(w, row.id), await query(w))
  assert.equal((await w.commands.resumeChangeRequest({ ...w.scope, operationId: row.id, actorRef: { kind: 'user' } })).writeState, 'conflict')
  assert.equal((await w.run({ issueRelation: 'none' })).writeState, 'conflict')
  const assigneeScope = { ...w.scope, createOperationId: row.id, actorRef: { kind: 'user' } }
  assert.equal((await w.commands.addChangeRequestAssignees({ ...assigneeScope, idempotencyKey: 'never-add', assigneeIds: ['U_1'] })).writeState, 'conflict')
  assert.equal((await w.commands.resumeChangeRequestAssignees({ ...assigneeScope, operationId: 'never-resume' })).writeState, 'conflict')
  assert.equal(w.f.calls.length, calls, 'history read/resume/create/assignment cannot call any Provider port')
  assert.equal(await w.storage.currentRevision(w.workspace.id), revision)
  assert.deepEqual(raw(w), before, 'fingerprint, marker, key, ref and receipt row stay byte-for-byte intact')
  assert.deepEqual(await w.storage.findMutationAttempt(w.workspace.id, 'create-1'), row)
})

test('original receipt decoder rejects inferred format, writable states and modern intent fields', async t => {
  const w = await world(t, 'SQLite'), row = await historical(w), intent = row.externalIntent
  assert.equal(externalIntentSnapshot(intent).requestFormat, 'original')
  for (const patch of [{ requestFormat: undefined }, { requestFormat: 'other' }, { confirmedRef: undefined }, ...['pending', 'unknown', 'failed', 'conflict'].map(state => ({ state })), { issueSelection: { relation: 'none' } }, { requestedAssigneeIds: ['U_1'] }, { surprise: true }]) {
    assert.throws(() => externalIntentSnapshot({ ...intent, ...patch }), TypeError)
  }
  assert.throws(() => validateExternalIntentCommand({ ...row, state: 'unknown' }), TypeError)
  assert.throws(() => validateExternalIntentCommand({ ...row, bindingId: 'foreign' }), TypeError)
})

test('forged original receipt identities are blocked without Provider I/O or row changes', async t => {
  const w = await world(t, 'SQLite'), row = await historical(w)
  install(w, row)
  const defects = [
    { id: 'pr-forged' }, { request_fingerprint: row.requestFingerprint + ' ' }, { idempotency_key: 'forged' },
    ...[
      i => { i.input.title = 'forged' }, i => { i.input.body += 'forged' }, i => { i.contextId = 'foreign' },
      i => { i.input.repository.externalId = 'foreign' }, i => { i.confirmedRef.bindingId = 'foreign' }, i => { i.confirmedRef.externalId = 'foreign' },
    ].map(change => { const intent = structuredClone(row.externalIntent); change(intent); return { external_intent_json: JSON.stringify(intent) } }),
  ]
  for (const defect of defects) {
    install(w, row)
    for (const [key, value] of Object.entries(defect)) w.storage.db.prepare(`UPDATE mutation_attempt SET ${key} = ?`).run(value)
    const before = raw(w), calls = w.f.calls.length
    assert.equal((await query(w, defect.id ?? row.id)).kind, 'blocked')
    assert.equal(w.f.calls.length, calls); assert.deepEqual(raw(w), before)
    if (defect.id) w.storage.db.prepare('UPDATE mutation_attempt SET id = ?').run(row.id)
  }
})
