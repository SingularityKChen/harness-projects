import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as controller from '@harness-projects/controller'
import { githubViewer, preflightPlanningConnection, HOST_SECRET_HANDLES } from '../../apps/harness-plugin/src/host-providers.ts'
import { createWorkspaceSetupSource, createRepositoryBindingSource } from '@harness-projects/client'
const actorRef = { kind: 'user' }, envelope = { actorRef, idempotencyKey: 'connect' }
const setup = { workspace: { id: 'workspace', name: 'Fixture' }, planning: { state: 'unbound' } }
const failure = (cause = 'credential_rejected', code = 'permission_denied', recovery = 'fix_permission') => ({ writeState: 'failed', saving: false, authoritative: false, error: { code, recovery, retryable: recovery === 'retry', message: 'RAW-CANARY' }, connectionFailure: { cause } })
function fixture(response, get = async () => setup) {
  let binds = 0
  const port = { getWorkspaceSetup: get, connectAccount: async () => response, bindPlanningSource: async () => { binds++; throw Error('must not bind') } }
  return { source: createWorkspaceSetupSource(port, { actorRef, key: () => 'intent' }), binds: () => binds, port }
}
test('controller connection refusal never invokes Core settings for any proven cause', async () => {
  let writes = 0
  const core = { connectAccount: async () => { writes++; throw Error('must not write') }, bindPlanningSource: async () => { writes++; throw Error('must not write') } }
  const storage = { getConnectorAccount: async () => ({ platformFamily: 'github', platformOrigin: 'https://github.com', identityKind: 'account', secretHandle: HOST_SECRET_HANDLES[0] }) }
  for (const [cause, code, body] of [['credential_rejected', 'permission_denied', {}], ['permission_missing', 'permission_denied', { errors: [{ type: 'INSUFFICIENT_SCOPES' }] }], ['target_unavailable', 'not_found', { data: { node: null } }]]) {
    const fetch = async () => new Response(JSON.stringify(body), { status: cause === 'credential_rejected' ? 401 : 200 })
    const commands = controller.createConnectionCommands(controller.createSetupCommands(core), {
      resolveAccount: () => githubViewer(fetch, async () => 'fixture-token'),
      verifyProject: (input) => preflightPlanningConnection(storage, input.accountId, input.configuration.projectNodeId, fetch, async () => 'fixture-token'),
    })
    const result = cause === 'credential_rejected' ? await commands.connectAccount(envelope) : await commands.bindPlanningSource({ ...envelope, accountId: 'account', configuration: { projectNodeId: 'PVT_1' } })
    assert.equal(result.writeState, 'failed'); assert.deepEqual(result.connectionFailure, { cause }); assert.equal(result.error.code, code)
  }
  assert.equal(writes, 0)
})
test('strict connection detail rejects extra keys, prototypes and incompatible command/error combinations', async () => {
  const valid = failure(), invalid = [
    { connectionFailure: { cause: 'guessed' } }, { connectionFailure: { cause: 'credential_rejected', raw: 'RAW-CANARY' } },
    { connectionFailure: Object.assign(Object.create({ inherited: true }), { cause: 'credential_rejected' }) },
    { writeState: 'local_only', value: { accountId: 'account' } }, { writeState: 'unknown' }, { writeState: 'pending', saving: true }, { writeState: 'conflict' }, { writeState: 'confirmed', authoritative: true },
    { activationError: valid.error }, { error: { ...valid.error, code: 'not_found', recovery: 'open_provider' } },
    { error: { ...valid.error, recovery: 'retry', retryable: true } }, { error: { ...valid.error, retryable: true } },
  ]
  for (const extra of invalid) {
    const h = fixture({ ...valid, ...extra }); await h.source.refresh(); await h.source.connect('PVT_1')
    assert.equal(h.source.getSnapshot().connectionFailure, undefined); assert.equal(h.source.getSnapshot().error.code, 'unavailable'); assert.equal(h.binds(), 0)
  }
  const h = fixture(valid); await h.source.connect('PVT_1'); assert.deepEqual(h.source.getSnapshot().connectionFailure, { cause: 'credential_rejected' }); assert.equal(h.binds(), 0)
})
test('cause only survives current connect readback and is cleared by pending, failed read, new intent and dispose', async () => {
  let failRead = false, release
  const h = fixture(failure(), async () => { if (failRead) throw Error('RAW-CANARY'); return setup })
  await h.source.connect('PVT_1'); assert.ok(h.source.getSnapshot().connectionFailure)
  const blank = h.source.connect(' '); await blank; assert.equal(h.source.getSnapshot().connectionFailure, undefined)
  await h.source.connect('PVT_1'); assert.ok(h.source.getSnapshot().connectionFailure)
  h.source.dispose(); assert.equal(h.source.getSnapshot().connectionFailure, undefined)
  const active = fixture(failure(), async () => { if (failRead) throw Error('RAW-CANARY'); return setup })
  failRead = true; await active.source.connect('PVT_2'); assert.equal(active.source.getSnapshot().connectionFailure, undefined); assert.equal(active.source.getSnapshot().failure, 'read')
  const delayed = fixture(failure(), () => new Promise((resolve) => { release = resolve }))
  const task = delayed.source.connect('PVT_1'); await new Promise((resolve) => setImmediate(resolve)); assert.equal(delayed.source.getSnapshot().connectionFailure, undefined)
  delayed.source.dispose(); release(setup); await task; assert.equal(delayed.source.getSnapshot().connectionFailure, undefined)
})
test('repository account consumer validates connection failure and preserves conservative failed recovery', async () => {
  for (const response of [failure(), { ...failure(), connectionFailure: { cause: 'guessed' } }]) {
    let binds = 0
    const source = createRepositoryBindingSource({ connectAccount: async () => response, bindRepository: async () => { binds++ } }, { actorRef })
    await source.bind({ localPath: '/fixture', owner: 'fixture', name: 'repo' })
    assert.equal(source.getSnapshot().state, 'failed'); assert.equal(source.getSnapshot().error.code, response.connectionFailure.cause === 'guessed' ? 'unavailable' : 'permission_denied'); assert.equal(binds, 0)
    assert.doesNotMatch(JSON.stringify(source.getSnapshot()), /RAW-CANARY|credential_rejected/)
  }
})

test('new connect clears the previous cause before delayed account response settles', async () => {
  const h = fixture(failure()); await h.source.connect('PVT_1')
  assert.ok(h.source.getSnapshot().connectionFailure)
  let release; h.port.connectAccount = () => new Promise((resolve) => { release = resolve })
  const task = h.source.connect('PVT_2')
  assert.equal(h.source.getSnapshot().pending, true); assert.equal(h.source.getSnapshot().connectionFailure, undefined)
  assert.equal(h.source.getSnapshot().error, undefined)
  release(failure()); await task
  assert.equal(h.source.getSnapshot().connectionFailure.cause, 'credential_rejected'); h.source.dispose()
})
