/** #233 公共入口验收装配。Development 录制与 Actions 合成来源分别声明，原始 JSON 不改写。 */
import assert from 'node:assert/strict'
import { StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { composeCore } from '@harness-projects/core'
import { createFakeProviders, refOf } from '@harness-projects/provider-fake'

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
