import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { composeCore, contextIdFor, runIdFor } from '@harness-projects/core'
import { createController } from '@harness-projects/controller'
import { createFakeProviders } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

for (const adapter of ['fake', 'sqlite']) test(`${adapter}: Controller runStatus is the stored run, independent of context, provider and fallback`, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'execution-status-')); t.after(() => rm(root, { recursive: true, force: true }))
  const providers = createFakeProviders(), storage = adapter === 'fake' ? providers.storage : createSqliteStorage(path.join(root, 'data.sqlite'))
  t.after(() => storage.close?.())
  const core = await composeCore({ workspace: { name: 'Execution' }, providers, storage }), controller = createController(core)
  const workItemId = (await core.queries.listPlanningItems()).find((item) => item.content.contentKind === 'work_item').entityId
  await core.commands.startWork({ workItemId, repositoryId: 'repo-alpha', actor: { kind: 'human' }, idempotencyKey: 'start' })
  const workspaceId = (await controller.baseline()).workspace.id, id = contextIdFor(workspaceId, workItemId, 'repo-alpha'), runId = runIdFor(id)
  const run = await storage.getExecutionRun(runId), record = await storage.getExecutionContext(id)
  assert.ok(run); assert.ok(record)
  let calls = 0
  for (const domain of ['planning', 'development', 'execution', 'delivery']) for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(providers[domain]))) {
    if (key !== 'constructor' && typeof providers[domain][key] === 'function') providers[domain][key] = async () => { calls++; throw new Error('must not query provider') }
  }
  providers.execution.state.runs.length = 0
  for (const status of ['queued', 'starting', 'running', 'succeeded', 'failed', 'canceled', 'timed_out', 'unknown']) {
    for (const fallback of [false, true]) {
      await storage.putExecutionRun({ ...run, status, fallback })
      const before = JSON.stringify([await storage.getExecutionContext(id), await storage.getExecutionRun(runId), await controller.baseline()])
      const view = await controller.queries.getExecutionContext({ workItemId, repositoryId: 'repo-alpha' })
      assert.equal(view.runStatus, status)
      assert.equal(view.status, record.status)
      assert.equal(view.fallback, fallback ? 'manual_fallback' : undefined)
      assert.equal(JSON.stringify([await storage.getExecutionContext(id), await storage.getExecutionRun(runId), await controller.baseline()]), before)
    }
  }
  const other = (await core.queries.listPlanningItems()).find((item) => item.entityId !== workItemId && item.content.contentKind === 'work_item').entityId
  await storage.putExecutionContext({ ...record, id: contextIdFor(workspaceId, other, 'repo-alpha'), workItemId: other })
  const missing = await controller.queries.getExecutionContext({ workItemId: other, repositoryId: 'repo-alpha' })
  assert.ok(Object.hasOwn(missing, 'runStatus')); assert.equal(missing.runStatus, undefined)
  assert.equal(calls, 0)
})
