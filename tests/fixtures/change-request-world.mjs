import './resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { composeCore, createContext, contextIdFor, worktreeEntityId } from '@harness-projects/core'
import { createControllerCommands } from '../../packages/controller/src/commands.ts'
import { registerRepository } from '../../packages/core/src/development-route.ts'
import { createFakeProviders, createFakeStorage, exportFakeStorageState } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { platform, repository, input } from './github-development-create.mjs'

export async function world(t, label = 'Fake', options = {}) {
  const f = platform({}, options), fake = createFakeProviders(), workspace = { id: 'ws-create-pr', name: 'Create PR' }
  const policy = { allowedSecretHandles: new Set(), configurations: new Map() }
  const path = join(mkdtempSync(join(tmpdir(), 'create-pr-')), 'state.sqlite')
  let storage = label === 'Fake' ? createFakeStorage(undefined, policy) : createSqliteStorage(path, policy)
  const providers = { planning: fake.planning, development: f.provider }
  const w = { f, fake, workspace, providers, path, options, fault: undefined }
  w.compose = async () => {
    const port = new Proxy(storage, { get(object, key) {
      const value = Reflect.get(object, key, object)
      if (key === 'transaction') return (run) => object.transaction((tx) => run(new Proxy(tx, { get(target, method) {
        const fn = Reflect.get(target, method, target)
        return typeof fn !== 'function' ? fn : async (...args) => {
          const result = await fn.apply(target, args)
          if (w.afterRead) await w.afterRead(method, result)
          if (method === w.fault) throw new Error('local settlement canary')
          return result
        }
      } })))
      return typeof value === 'function' ? value.bind(object) : value
    } })
    w.core = await composeCore({ workspace, providers, storage: port, policy: w.policy })
    w.commands = createControllerCommands(w.core)
    w.storage = storage
  }
  await w.compose()
  const workItemId = (await w.core.queries.listPlanningItems()).find((item) => item.content.identity?.externalId === 'issue-1').entityId
  w.scope = { workItemId, repositoryId: repository.externalId }
  const ctx = await createContext({ workspace, providers, storage })
  await storage.transaction((tx) => registerRepository(tx, ctx.ids, workspace.id, repository.externalId, [repository.bindingId]))
  w.record = { id: contextIdFor(workspace.id, workItemId, repository.externalId), workspaceId: workspace.id, ...w.scope,
    status: 'ready', branchExternalId: input.head, worktreeExternalId: 'fixture-worktree', provisioningStartedAt: undefined, provisioningGeneration: 1 }
  await storage.putExecutionContext(w.record)
  w.request = { ...w.scope, base: input.base, title: input.title, body: 'PR body', actorRef: { kind: 'user', id: 'trusted-user' }, idempotencyKey: 'create-1' }
  w.run = (patch = {}) => w.commands.createChangeRequest({ ...w.request, ...patch })
  w.reopen = async () => {
    if (label === 'Fake') storage = createFakeStorage(exportFakeStorageState(storage), policy)
    else { storage.close(); storage = createSqliteStorage(path, policy) }
    await w.compose()
  }
  t.after(() => storage.close?.())
  return w
}
export async function ready(w) {
  const local = w.fake.development
  local.flags.changeRequestCreate = false
  local.state.repositories[0].ref = { ...local.state.repositories[0].ref, externalId: w.scope.repositoryId }
  local.state.branches[0].repository = local.state.repositories[0].ref
  w.providers.development = [local, w.f.provider]; w.providers.execution = w.fake.execution
  await w.compose()
  const ctx = await createContext({ workspace: w.workspace, providers: w.providers, storage: w.storage })
  await w.storage.transaction((tx) => registerRepository(tx, ctx.ids, w.workspace.id, w.scope.repositoryId, [repository.bindingId, local.gate.bindingId]))
  await w.storage.putEntity({ id: w.record.id, kind: 'execution_context' })
  await w.storage.putEntity({ id: worktreeEntityId(w.workspace.id, w.scope.repositoryId, w.scope.workItemId), kind: 'worktree' })
  await w.storage.putExecutionContext({ ...w.record, status: 'failed', branchExternalId: undefined, worktreeExternalId: undefined })
  const start = (key) => w.core.commands.startWork({ task: 'Synthetic explicit task', ...w.scope, branchName: input.head, actor: { kind: 'user' }, idempotencyKey: key })
  const supplied = await start('provision-ready')
  assert.equal(supplied.confirmed, true, JSON.stringify(supplied))
  return start
}
