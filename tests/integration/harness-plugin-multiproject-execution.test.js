import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createWorkspaceSetup, contextIdFor, runIdFor } from '@harness-projects/core'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { hostStoragePolicy, PROVIDER_CATALOG } from '../../apps/harness-plugin/src/host-providers.ts'
import { WORKSPACE, seed, seedWorkspace } from './fixtures/host-seed.js'
import { fixtureFor, registerWorkItem } from './local-git-fixture.js'

const actor = { kind: 'user' }, peer = 'multiproject-execution-peer'
const B = '00000000-0000-4000-8000-0000000004b2'
const deferred = () => { let resolve; return { promise: new Promise((done) => { resolve = done }), resolve: () => resolve() } }

// Removing durable run restoration, retargeting an admitted write, or starting another session on activation must fail these cases.
for (const mode of ['manual', 'harness']) test(`${mode} execution retains its original workspace, provider and issuer across A→B→A`, async (t) => {
  const fixture = await fixtureFor(t), dataPath = path.join(fixture.root, 'workspace.sqlite')
  await seed(dataPath, PROVIDER_CATALOG, async (storage) => {
    await seedWorkspace(storage)
    await storage.putWorkspace({ id: B, name: '项目 B', statusPolicy: 'provider_authoritative' })
    const bound = await createWorkspaceSetup(storage).bindRepository({ workspaceId: WORKSPACE, repositoryId: 'repo-alpha', references: [{ domain: 'development', implementationKey: 'development.local-git', configuration: { repositoryExternalId: 'repo-alpha', repositoryPath: fixture.repositoryPath } }] })
    assert.equal(bound.ok, true)
    await registerWorkItem(storage, WORKSPACE, 'wi-1', undefined, { id: 'wi-identity', entityId: 'wi-1', bindingId: bound.value.bindingIds[0], externalKind: 'issue', externalId: '1', role: 'primary' })
  })
  const entered = deferred(), release = deferred()
  let requestId, finished = false, creates = 0, prompts = 0, credentials = 0
  // Synthetic current-ABI session boundary; all Host/Core/SQLite and local Git behavior stays real.
  const session = {
    async create() { creates++; return { sessionId: 'session-a' } },
    async prompt(input) { prompts++; requestId = input.requestId; assert.equal(requestId, contextIdFor(WORKSPACE, 'wi-1', 'repo-alpha')); assert.equal(input.sessionId, 'session-a'); entered.resolve(); await release.promise; return { accepted: true } },
    async page({ address }) {
      assert.equal(address.sessionId, 'session-a')
      const records = [
        { type: 'event', event: { seq: 0, type: 'turn/start', data: { turn: 1 } } },
        { type: 'event', event: { seq: 1, type: 'user/message', data: { source: { kind: 'user', rpcId: requestId } } } },
        ...(finished ? [{ type: 'event', event: { seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } }] : []),
      ]
      return { cursor: records.length - 1, records, hasMore: false }
    },
    async list() { return { items: [{ sessionId: 'session-a', running: !finished }] } },
  }
  const host = await createHostComposition({ dataPath, catalog: PROVIDER_CATALOG, resolveCredential: async () => { credentials++; return 'synthetic-issuer-for-multiproject-test' }, sessionController: () => mode === 'manual' ? undefined : session })
  const remote = await installHostRemote({ invocation: { peer: { id: peer } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  t.after(async () => { release.resolve(); host.stop(); await remote.dispose(); await host.dispose() })
  assert.equal((await remote.service.openWorkspace(WORKSPACE)).state, 'activated')
  assert.equal((await remote.service.installExecutionBindings(actor, 'install-a')).writeState, 'local_only')
  const storage = createSqliteStorage(dataPath, hostStoragePolicy(PROVIDER_CATALOG))
  t.after(() => storage.close())
  const runId = runIdFor(contextIdFor(WORKSPACE, 'wi-1', 'repo-alpha'))
  let original
  const starting = remote.service.startWork(actor, 'start-a', 'wi-1', 'repo-alpha', 'Synthetic task', undefined)
  void starting.catch(() => {})
  if (mode === 'harness') {
    // A provider write already in flight must finish on A before navigation can publish B.
    await entered.promise
    original = await storage.getExecutionRun(runId)
    assert.deepEqual(JSON.parse(original.providerRef.externalId), ['session-a', contextIdFor(WORKSPACE, 'wi-1', 'repo-alpha')])
    let switched = false
    const switching = remote.service.openWorkspace(B).then((result) => { switched = true; return result })
    await new Promise((done) => setImmediate(done))
    assert.equal(switched, false, 'pending A external acknowledgement must drain before switching')
    release.resolve()
    await assert.rejects(() => starting, /项目已切换，请重新读取/, 'late A caller cannot retry its write on B')
    assert.equal((await switching).state, 'activated')
  } else {
    assert.equal((await starting).value.status, 'ready')
    original = await storage.getExecutionRun(runId)
    assert.equal((await remote.service.openWorkspace(B)).state, 'activated')
  }
  const before = await storage.getExecutionRun(runId)
  assert.deepEqual(before.providerRef, original.providerRef, 'first switch preserves the identity retained before navigation')
  if (mode === 'manual') assert.deepEqual(before, original, 'first switch cannot rewrite the original manual run')
  assert.equal(before.status, 'running')
  assert.equal(await storage.getExecutionRun(runIdFor(contextIdFor(B, 'wi-1', 'repo-alpha'))), undefined)
  assert.equal((await remote.service.getExecutionContext('wi-1', 'repo-alpha')).context, null, 'B cannot observe the A context')
  const db = new DatabaseSync(dataPath, { readOnly: true })
  try {
    const receipt = db.prepare("SELECT workspace_id, request_fingerprint FROM mutation_attempt WHERE idempotency_key = 'start-a'").get()
    assert.equal(receipt.workspace_id, WORKSPACE)
    assert.deepEqual(JSON.parse(receipt.request_fingerprint)[3], ['harness_peer', peer], 'durable intent belongs to the original authenticated peer')
    assert.equal(db.prepare('SELECT count(*) AS n FROM execution_run').get().n, 1)
  } finally { db.close() }
  finished = true
  assert.equal((await remote.service.openWorkspace(WORKSPACE)).state, 'activated')
  const returned = (await remote.service.getExecutionContext('wi-1', 'repo-alpha')).context
  assert.equal(returned.runStatus, 'running')
  assert.equal(returned.fallback, mode === 'manual' ? 'manual_fallback' : undefined)
  assert.deepEqual(await storage.getExecutionRun(runId), before, 'navigation does not cancel, restart or rewrite the existing run')
  assert.notEqual((await remote.service.refreshExecutionRun(actor, 'wi-1', 'repo-alpha')).writeState, 'failed')
  assert.equal((await remote.service.getExecutionContext('wi-1', 'repo-alpha')).context.runStatus, mode === 'manual' ? 'running' : 'succeeded')
  assert.deepEqual((await storage.getExecutionRun(runId)).providerRef, before.providerRef, 'return refresh uses the same binding and external run identity')
  assert.deepEqual([creates, prompts], mode === 'manual' ? [0, 0] : [1, 1], 'navigation never starts another session')
  if (mode === 'manual') assert.ok(credentials >= 2, 'restored manual provider resolves the original issuer again')
})
