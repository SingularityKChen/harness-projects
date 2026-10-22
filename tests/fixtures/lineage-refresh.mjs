/** #233 公共入口验收装配。Development 录制与 Actions 合成来源分别声明，原始 JSON 不改写。 */
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { composeCore, createWorkspaceSetup } from '@harness-projects/core'
import { createFakeProviders, refOf } from '@harness-projects/provider-fake'
import { createGithubDevelopmentProvider } from '@harness-projects/provider-development-github'
import { createGithubActionsDeliveryProvider } from '@harness-projects/provider-delivery-github-actions'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { createReplay } from '../contract/fixtures/github-projects/replay.js'
import { OWNER, REPO_NAME, actionsRoutes, createRecordedTransport, runItem, checkItem } from './github-actions.mjs'

export const page = (items, nextCursor) => ({ ok: true, value: { items, nextCursor } })
export const offline = () => ({ ok: false, error: { code: 'unavailable', message: 'offline', retryable: true } })
export async function fakeChain() {
  const providers = createFakeProviders()
  const workspace = { id: newWorkspaceId(), name: 'lineage-refresh', statusPolicy: StatusPolicy.ManualOnly }
  let ticks = 0
  const core = await composeCore({ workspace, providers, clock: () => new Date(Date.UTC(2026, 9, 22, 0, 0, ticks++)).toISOString() })
  const item = (await core.queries.listPlanningItems()).find((view) => view.kind === 'work_item' && view.content.contentKind === 'work_item')
  const scope = { workItemId: item.entityId, repositoryId: 'repo-alpha' }
  const started = await core.commands.startWork({ ...scope, actor: { kind: 'agent' }, idempotencyKey: 'paging' })
  assert.equal(started.confirmed, true)
  const development = providers.development
  assert.equal((await development.createChangeRequest({ repository: refOf(development.gate.bindingId, 'repository', scope.repositoryId),
    head: started.branchExternalId, base: 'main', title: 'target', body: '' })).ok, true)
  const branch = (await development.listBranches({ repository: refOf(development.gate.bindingId, 'repository', scope.repositoryId), limit: 50 })).value.items.find((row) => row.name === started.branchExternalId)
  const target = (await development.listChangeRequests({ repository: refOf(development.gate.bindingId, 'repository', scope.repositoryId), headBranch: started.branchExternalId, limit: 50 })).value.items[0]
  return { providers, workspace, core, scope, started, branch, target,
    snapshot: () => providers.storage.getDeliveryFacts(workspace.id, started.executionContextId) }
}

const recorded = JSON.parse(readFileSync(new URL('../contract/fixtures/github-development/sandbox.json', import.meta.url), 'utf8'))
const exchange = (name) => recorded.exchanges.find((entry) => entry.operationName === name)
export const RECORDED_PR = exchange('DevelopmentChangeRequest').body.data.node
export const RECORDED_REPOSITORY_ID = exchange('DevelopmentChangeRequest').body.data.repository.id
export const GAMMA_HEAD = RECORDED_PR.headRefOid
export const GAMMA_BRANCH = 'fixture/gamma'

/** 独立 SQL 只读连接：避免用被测映射函数计算期望。 */
export function sqlRows(location, table) {
  assert.ok(['entity', 'relation', 'repository', 'workspace_projection', 'external_identity', 'project_item_membership', 'planning_field_value'].includes(table))
  const db = new DatabaseSync(location, { readOnly: true })
  try { return db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all() } finally { db.close() }
}

/** 原始 Development 严格 replay；CI 是同 head 的合成协议，绝不宣称同一平台全链录制。 */
export async function recordedChain(t, statusPolicy) {
  const dir = mkdtempSync(join(tmpdir(), 'lineage-refresh-'))
  const policy = { allowedSecretHandles: new Set(), configurations: new Map([['development.github', {}]]) }
  const w = { storage: createSqliteStorage(join(dir, 'facts.sqlite'), policy), calls: [], reconcileCalls: 0, offline: false, conclusion: 'success', merged: false }
  t.after(() => { w.storage.close(); rmSync(dir, { recursive: true, force: true }) })
  const workspace = w.workspace = { id: newWorkspaceId(), name: 'recorded-development-sqlite', ...(statusPolicy === undefined ? {} : { statusPolicy }) }
  const fake = createFakeProviders()
  fake.development.state.branches[0].headCommit = GAMMA_HEAD
  const initial = await composeCore({ workspace, providers: { ...fake, storage: w.storage }, storage: w.storage })
  const item = (await initial.queries.listPlanningItems()).find((view) => view.kind === 'work_item' && view.content.contentKind === 'work_item')
  w.scope = { workItemId: item.entityId, repositoryId: 'repo-alpha' }
  w.started = await initial.commands.startWork({ ...w.scope, branchName: GAMMA_BRANCH, actor: { kind: 'agent' }, idempotencyKey: 'recorded-anchor' })
  assert.equal(w.started.confirmed, true)
  const bound = await createWorkspaceSetup(w.storage).bindRepository({ workspaceId: workspace.id, repositoryId: 'repo-alpha',
    references: [{ domain: 'development', implementationKey: 'development.github', configuration: {} }] })
  assert.equal(bound.ok, true)
  const replay = createReplay(recorded)
  w.replay = replay
  const transport = async (request) => {
    if (w.offline) throw new Error('controlled offline')
    const response = await replay.transport(request)
    // merged 是单独标明的合成变异；正常录制 body 与原始文件保持不变。
    if (w.merged && request.operationName === 'DevelopmentChangeRequests') response.body.data.repository.pullRequests.nodes.forEach((node) => { node.state = 'MERGED' })
    return response
  }
  const development = createGithubDevelopmentProvider({ bindingId: bound.value.bindingIds[0],
    repository: { externalId: 'repo-alpha', ...exchange('DevelopmentRepository').variables }, transport })
  const actions = createRecordedTransport((request) => {
    if (w.offline) return { failure: new Error('controlled offline') }
    const response = actionsRoutes({ runs: [runItem({ id: 9101, commit: GAMMA_HEAD, branch: GAMMA_BRANCH, conclusion: w.conclusion })],
      checks: [checkItem({ id: 9201, name: 'build', commit: GAMMA_HEAD, conclusion: w.conclusion })] })(request)
    return w.hold !== undefined && request.path.endsWith('/check-runs') ? w.hold(response) : response
  })
  w.actions = actions
  const delivery = createGithubActionsDeliveryProvider({ bindingId: 'binding-github-actions', repository: { externalId: 'repo-alpha', owner: OWNER, name: REPO_NAME },
    transport: actions.transport, observedAt: '2026-10-22T00:00:00Z', permission: { 'delivery.pipeline.read': 'available', 'delivery.check.read': 'available' } })
  const counted = (provider, domain) => new Proxy(provider, { get(target, key) {
    if (domain === 'development' && key === 'reconcile') return async function* () { w.reconcileCalls++; throw new Error('reconcile is outside explicit refresh') }
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? (...args) => { w.calls.push(`${domain}.${String(key)}`); return value.apply(target, args) } : value
  } })
  w.development = development
  w.repositoryRef = { bindingId: bound.value.bindingIds[0], objectKind: 'repository', externalId: 'repo-alpha', url: undefined }
  const providers = { planning: counted(fake.planning, 'planning'), execution: counted(fake.execution, 'execution'),
    development: counted(development, 'development'), delivery: counted(delivery, 'delivery') }
  let ticks = 0
  w.compose = () => composeCore({ workspace, providers: { ...providers, storage: w.storage }, storage: w.storage,
    clock: () => new Date(Date.UTC(2026, 9, 22, 0, 0, ticks++)).toISOString() })
  w.core = await w.compose()
  w.snapshot = () => w.storage.getDeliveryFacts(workspace.id, w.started.executionContextId)
  w.reopen = async () => { const location = w.storage.location; w.storage.close(); w.storage = createSqliteStorage(location, policy); w.core = await w.compose() }
  return w
}
