import assert from 'node:assert/strict'
import test from 'node:test'
import { createExecutionContextReader } from '@harness-projects/client'
import { apply } from '../../apps/harness-plugin/src/client.ts'
import { createExecutionFixture } from '../fixtures/execution-drawer-browser.mjs'
const json = (value) => JSON.parse(JSON.stringify(value))
test('real Host/remote returns exact nullable DTO, rejects bad input before queries, revalidates access after read', async (t) => {
  const h = await createExecutionFixture(); t.after(h.close)
  const scope = { workspaceId: h.workspaceId, workItemId: h.itemId, repositoryId: 'repo-alpha' }
  assert.equal(typeof h.installed.service.getExecutionContext, 'function')
  const reader = createExecutionContextReader(async ({ workItemId, repositoryId }) => json(await h.installed.service.getExecutionContext(workItemId, repositoryId)))
  const dto = await reader(scope)
  assert.deepEqual(Object.keys(dto).sort(), ['branchExternalId', 'fallback', 'repositoryId', 'runStatus', 'status', 'workItemId', 'workspaceId', 'worktreeExternalId'])
  assert.equal(dto.runStatus, 'running'); assert.equal(dto.fallback, 'manual_fallback')
  assert.equal(await reader({ ...scope, repositoryId: 'unknown' }), null)
  let reads = 0; const read = h.host.controller.queries.getExecutionContext
  h.host.controller.queries.getExecutionContext = async (...args) => { reads++; return read(...args) }
  for (const input of [{ workItemId: '', repositoryId: 'repo-alpha' }, { workItemId: h.itemId, repositoryId: 3 }, { ...scope }, { workItemId: h.itemId, repositoryId: 'repo-alpha', actorRef: {} }]) await assert.rejects(() => h.host.call('getExecutionContext', input), TypeError)
  assert.equal(reads, 0)
  const get = h.host.controller.queries.getEntity
  for (const kind of ['redacted', 'change_request']) {
    h.host.controller.queries.getEntity = async (id) => { const entity = await get(id); return { ...entity, content: { ...entity.content, contentKind: kind } } }
    assert.equal(await reader(scope), null); assert.equal(reads, 0)
  }
  let entities = 0
  h.host.controller.queries.getEntity = async (id) => { const entity = await get(id); return ++entities === 1 ? entity : { ...entity, content: { contentKind: 'redacted' } } }
  assert.equal(await reader(scope), null); assert.equal(reads, 1)
  h.host.controller.queries.getEntity = get
  for (const key of ['workspaceId', 'workItemId', 'repositoryId']) { h.host.controller.queries.getExecutionContext = async (...args) => ({ ...(await read(...args)), [key]: 'other' }); assert.equal(await reader(scope), null) }
  h.host.controller.queries.getExecutionContext = async () => { throw new Error('SECRET-HOST-ERROR') }
  await assert.rejects(() => reader(scope), (error) => !error.message.includes('SECRET-HOST-ERROR'))
})
test('production apply registers Panel with actual watch source and unwrapped strict reader through App to drawer', async (t) => {
  const h = await createExecutionFixture()
  const abort = new AbortController(), stream = { restart() {}, dispose: async () => abort.abort(), async *[Symbol.asyncIterator]() { for await (const value of h.host.watch(abort.signal)) yield { generation: 1, value: json(value), accept() {} } } }
  const disposers = []; let Panel
  const child = { remote: { harnessProjects: { getExecutionContext: async (...args) => ({ ok: true, value: await h.installed.service.getExecutionContext(...args) }) }, $stream: () => stream }, effect: (run) => disposers.push(run()), slots: { inject: (_, run) => run(), register: (slot, component) => { if (slot.name === 'main') Panel = component } } }
  await apply({ remote: { $mount: async () => {} }, inject: (_, run) => run(child) })
  t.after(async () => { await Promise.all(disposers.map((run) => run())); await h.close() })
  const app = Panel(); assert.equal(typeof app.props.executionReader, 'function')
  const dto = await app.props.executionReader({ workspaceId: h.workspaceId, workItemId: h.itemId, repositoryId: 'repo-alpha' }); assert.equal(dto.runStatus, 'running')
  child.remote.harnessProjects.getExecutionContext = async () => ({ ok: false, error: 'SECRET-REMOTE-ERROR' })
  await assert.rejects(() => app.props.executionReader({ workspaceId: h.workspaceId, workItemId: h.itemId, repositoryId: 'repo-alpha' }), (error) => !error.message.includes('SECRET-REMOTE-ERROR'))
})
