import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { composeCore } from '@harness-projects/core'
import { createFakeProviders } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
const task = '  检查 🧪\nKeep exact whitespace.  '
async function setup(t) {
  const providers = createFakeProviders(), storage = createSqliteStorage(':memory:'); t.after(() => storage.close())
  const options = { providers, storage, workspace: { id: 'task-handoff', name: 'Task' } }, core = await composeCore(options)
  const workItemId = (await core.queries.listPlanningItems()).find(v => v.content.contentKind === 'work_item').entityId
  const request = { workItemId, repositoryId: 'repo-alpha', actor: { kind: 'human' }, idempotencyKey: 'original', task }
  const sent = [], startRun = providers.execution.startRun.bind(providers.execution)
  providers.execution.startRun = input => { sent.push(structuredClone(input)); return startRun(input) }
  return { ...options, core, request, sent, start: (patch = {}, target = core) => target.commands.startWork({ ...request, ...patch }) }
}
const conflict = (result, reason = 'idempotency_request_mismatch') => assert.deepEqual([result.writeState, result.confirmed, result.error?.message], ['conflict', false, reason])
test('task is exact execution command, bound on first claim and cannot be sent to an existing run', async t => {
  const w = await setup(t)
  assert.equal((await w.start()).writeState, 'saved')
  assert.equal(w.sent[0].command, task)
  const row = await w.storage.findMutationAttempt(w.workspace.id, 'original')
  assert.equal(JSON.parse(row.requestFingerprint).at(-1), task)
  assert.equal(row.externalIntent.input.command, task)
  conflict(await w.start({ task: task + '!' }))
  conflict(await w.start({ idempotencyKey: 'new' }), 'existing_execution_task_not_sent')
  assert.equal(await w.storage.findMutationAttempt(w.workspace.id, 'new'), undefined)
  assert.equal((await w.start()).writeState, 'saved'); assert.equal(w.sent.length, 1)
  const detached = await composeCore({ ...w, providers: { ...w.providers, development: undefined } })
  conflict(await w.start({ idempotencyKey: 'detached' }, detached), 'existing_execution_task_not_sent')
  const record = await w.storage.getExecutionContext(row.externalIntent.contextId); await w.storage.putExecutionContext({ ...record, status: 'failed' })
  conflict(await w.start({ idempotencyKey: 'failed-detached', task: 'different' }, detached), 'existing_execution_task_not_sent')
})
test('all new commands require a bounded nonblank primitive task before Git writes', async t => {
  const w = await setup(t), before = [w.providers.development.state.branches.length, w.providers.development.state.worktrees.length]
  for (const task of [undefined, null, 1, {}, '', ' \n\t', 'x'.repeat(16385)]) assert.equal((await w.start({ task })).error?.code, 'invalid_input')
  assert.deepEqual([w.providers.development.state.branches.length, w.providers.development.state.worktrees.length], before); assert.equal(w.sent.length, 0)
  assert.equal((await w.start({ task: 'x'.repeat(16384) })).writeState, 'saved')
})
test('the first claim window observes identical other keys and rejects changed task before external intent', async t => {
  const w = await setup(t), entered = Promise.withResolvers(), released = Promise.withResolvers(), transaction = w.storage.transaction.bind(w.storage)
  let held = false
  w.storage.transaction = async work => {
    const result = await transaction(work), row = await w.storage.findMutationAttempt(w.workspace.id, 'original')
    if (!held && row?.state === 'pending' && !row.externalIntent) { held = true; entered.resolve(); await released.promise }
    return result
  }
  const running = w.start(); await entered.promise
  try {
    const other = await composeCore(w)
    const offline = await composeCore({ ...w, providers: { ...w.providers, development: undefined } })
    conflict(await w.start({ idempotencyKey: 'offline-changed', task: 'different' }, offline))
    assert.equal((await w.start({ idempotencyKey: 'observer' }, other)).writeState, 'pending')
    conflict(await w.start({ idempotencyKey: 'changed', task: 'different' }, other))
    assert.equal(await w.storage.findMutationAttempt(w.workspace.id, 'observer'), undefined)
    assert.equal(await w.storage.findMutationAttempt(w.workspace.id, 'changed'), undefined); assert.equal(w.sent.length, 0)
  } finally { released.resolve(); await running }
  assert.equal(w.sent.length, 1)
})
test('snapshot reads allowed task getter once and ignores caller mutations across await', async t => {
  const w = await setup(t), entered = Promise.withResolvers(), released = Promise.withResolvers(), get = w.storage.findMutationAttempt.bind(w.storage)
  w.storage.findMutationAttempt = async (...args) => { entered.resolve(); await released.promise; return get(...args) }
  let reads = 0, current = task
  const input = { ...w.request, get task() { reads++; return current } }
  const running = w.core.commands.startWork(input); await entered.promise; current = 'changed'; released.resolve()
  assert.equal((await running).writeState, 'saved'); assert.equal(reads, 1); assert.equal(w.sent[0].command, task)
  const bad = { ...w.request, get task() { throw Error('private task') } }
  assert.equal((await w.core.commands.startWork(bad)).error.code, 'invalid_input')
})
test('unsupported legacy first claim is a read-only conflict for a new key', async t => {
  const w = await setup(t), transaction = w.storage.transaction.bind(w.storage); let interrupted = false
  w.storage.transaction = async work => {
    const result = await transaction(tx => work(new Proxy(tx, { get(target, key) {
      const value = Reflect.get(target, key)
      return key === 'putMutationAttempt' ? row => { const fingerprint = JSON.parse(row.requestFingerprint); fingerprint[0] = 'startWork:v1'; fingerprint.pop(); return value.call(target, { ...row, requestFingerprint: JSON.stringify(fingerprint) }) } : typeof value === 'function' ? value.bind(target) : value
    } })))
    if (!interrupted && await w.storage.findMutationAttempt(w.workspace.id, 'original')) { interrupted = true; throw Error('crash after claim') } return result
  }
  await w.start(); w.storage.transaction = transaction
  conflict(await w.start({ idempotencyKey: 'new' })); assert.equal(w.sent.length, 0)
})
