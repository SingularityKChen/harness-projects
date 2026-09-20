/** Storage 契约套件：接受任意 Storage 适配器 `{ label, makeStorage(), restart(storage) }`。`restart` 必须返回一个"重启后"的新实例，且读到的内容与重启前一致——这是本套件的判别性用例：删掉导出/导入实现就会失败。看护的不变量：事务原子性；一个工作区只有一个默认 planning 绑定；外部身份全局一份；同一工作项+仓库 只有一个 active 执行上下文；观察按 (binding, dedupeKey) 去重；写尝试按幂等键重放返回原结果；投影修订号单调递增。 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { ObservationState } from '@harness-projects/capabilities'
const WORKSPACE = 'ws-1'
const workspace = (id = WORKSPACE, name = '工作区') => ({ id, name, statusPolicy: 'provider_authoritative' })
const binding = (id, isDefault = false) => ({ id, workspaceId: WORKSPACE, domain: 'planning', implementationKey: 'fake', enabled: true, isDefault })
const projection = {
  workspaceId: WORKSPACE, entityId: 'entity-1', planningStatus: 'todo', revision: 1,
  content: { contentKind: 'work_item', title: '标题', body: '正文' },
}
const observation = (dedupeKey, state = ObservationState.Pending) => ({
  state,
  observation: {
    bindingId: 'binding-1', dedupeKey, type: 'issue.updated', eventTime: undefined, receivedTime: '2026-09-20T00:00:01Z',
    subject: { bindingId: 'binding-1', objectKind: 'issue', externalId: 'issue-1', url: undefined },
    sourceVersion: 'v1', payloadHash: 'payload-hash', payload: {},
  },
})
export function storageContractSuite(adapter) {
  const { label, makeStorage, restart } = adapter

  test(`${label}：事务提交成功、失败整体回滚`, async () => {
    const storage = makeStorage()
    await storage.transaction((tx) => tx.putWorkspace(workspace()))
    assert.equal((await storage.getWorkspace(WORKSPACE))?.name, '工作区')
    await assert.rejects(storage.transaction(async (tx) => {
      await tx.putWorkspace(workspace('ws-rolled-back', '不该存在'))
      throw new Error('事务内失败')
    }))
    assert.equal(await storage.getWorkspace('ws-rolled-back'), undefined)
  })
  test(`${label}：一个工作区同一时刻只有一个默认绑定`, async () => {
    const storage = makeStorage()
    await storage.putProviderBinding(binding('binding-1', true))
    await storage.putProviderBinding(binding('binding-2', true))
    assert.deepEqual((await storage.listProviderBindings(WORKSPACE)).filter((b) => b.isDefault).map((b) => b.id), ['binding-2'])
  })

  test(`${label}：外部身份全局一份，重复登记保留已分配的 id 与 entityId`, async () => {
    const storage = makeStorage()
    await storage.putEntity({ id: 'entity-1', kind: 'work_item' })
    const identity = { id: 'identity-1', entityId: 'entity-1', bindingId: 'binding-1', externalKind: 'issue', externalId: 'issue-1', role: 'primary' }
    await storage.putExternalIdentity(identity)
    await storage.putExternalIdentity({ ...identity, id: 'identity-2', entityId: 'entity-9' })
    const found = await storage.findExternalIdentity('binding-1', 'issue', 'issue-1')
    assert.equal(found?.id, 'identity-1')
    assert.equal(found?.entityId, 'entity-1')
    assert.equal((await storage.listIdentitiesForEntity('entity-1')).length, 1)
    assert.deepEqual(await storage.listIdentitiesForEntity('entity-9'), [])
  })

  test(`${label}：规划投影与仓库按工作区隔离可读回`, async () => {
    const storage = makeStorage()
    await storage.putPlanningProjection(WORKSPACE, projection)
    assert.deepEqual(await storage.getPlanningProjection(WORKSPACE, 'entity-1'), projection)
    assert.deepEqual((await storage.listPlanningProjections(WORKSPACE)).map((p) => p.entityId), ['entity-1'])
    assert.deepEqual(await storage.listPlanningProjections('ws-other'), [])
    await storage.putRepository({ id: 'repo-1', workspaceId: WORKSPACE, externalIdentityId: 'identity-9' })
    assert.deepEqual((await storage.listRepositories(WORKSPACE)).map((r) => r.id), ['repo-1'])
  })

  test(`${label}：同一工作项+仓库最多一个 active 执行上下文`, async () => {
    const storage = makeStorage()
    const context = (id, status) => ({ id, workspaceId: WORKSPACE, workItemId: 'entity-1', repositoryId: 'repo-1', status, branchExternalId: undefined, worktreeExternalId: undefined })
    await storage.putExecutionContext(context('context-1', 'ready'))
    await storage.putExecutionContext(context('context-2', 'planned'))
    assert.equal((await storage.findActiveExecutionContext(WORKSPACE, 'entity-1', 'repo-1'))?.id, 'context-2')
    assert.equal((await storage.getExecutionContext('context-1'))?.status, 'closed')
    await storage.putExecutionRun({ id: 'run-1', workspaceId: WORKSPACE, contextId: 'context-2', status: 'running', updatedAt: '2026-09-20T00:00:00Z' })
    assert.equal((await storage.getExecutionRun('run-1'))?.status, 'running')
  })

  test(`${label}：关系按工作区隔离且重复写入不产生第二条`, async () => {
    const storage = makeStorage()
    const relation = { from: 'entity-1', to: 'entity-2', type: 'depends_on', class: 'business_semantics', source: 'deterministic', state: 'candidate' }
    await storage.putRelation(WORKSPACE, relation)
    await storage.putRelation(WORKSPACE, { ...relation, state: 'confirmed' })
    const relations = await storage.listRelations(WORKSPACE)
    assert.equal(relations.length, 1)
    assert.equal(relations[0].state, 'confirmed')
    assert.deepEqual(await storage.listRelations('ws-other'), [])
  })

  test(`${label}：重复观察返回 false，不产生第二条记录`, async () => {
    const storage = makeStorage()
    assert.equal(await storage.recordObservation(observation('key-1')), true)
    assert.equal(await storage.recordObservation(observation('key-1', 'ignored')), false)
    assert.equal(await storage.recordObservation(observation('key-2')), true)
    assert.equal(await storage.getSyncCursor('binding-1', 'scope-1'), undefined)
    await storage.putSyncCursor({ bindingId: 'binding-1', scopeKey: 'scope-1', cursorValue: 'cursor-1', state: 'healthy', lastErrorCode: undefined })
    assert.equal((await storage.getSyncCursor('binding-1', 'scope-1'))?.cursorValue, 'cursor-1')
  })

  test(`${label}：写尝试同幂等键重放返回原结果`, async () => {
    const storage = makeStorage()
    const attempt = {
      id: 'attempt-1', workspaceId: WORKSPACE, bindingId: 'binding-1', commandName: 'updatePlanningFields',
      idempotencyKey: 'key-1', state: 'pending', expectedSourceVersion: 'v1', errorCode: undefined,
    }
    await storage.putMutationAttempt(attempt)
    await storage.putMutationAttempt({ ...attempt, id: 'attempt-2', state: 'saved' })
    assert.equal((await storage.findMutationAttempt(WORKSPACE, 'key-1'))?.state, 'pending')
    assert.equal((await storage.listMutationAttempts(WORKSPACE)).length, 1)
  })

  test(`${label}：投影修订号从 0 起单调递增`, async () => {
    const storage = makeStorage()
    assert.equal(await storage.currentRevision(WORKSPACE), 0)
    assert.equal(await storage.advanceRevision(WORKSPACE), 1)
    assert.equal(await storage.advanceRevision(WORKSPACE), 2)
    assert.equal(await storage.currentRevision(WORKSPACE), 2)
    assert.equal(await storage.currentRevision('ws-other'), 0)
  })
  test(`${label}：换一个实例能读到同一份内容（模拟重启）`, async () => {
    const storage = makeStorage()
    await storage.putWorkspace(workspace())
    await storage.putPlanningProjection(WORKSPACE, projection)
    await storage.advanceRevision(WORKSPACE)
    await storage.recordObservation(observation('key-1'))
    const revived = restart(storage)
    assert.equal((await revived.getWorkspace(WORKSPACE))?.name, '工作区')
    assert.equal((await revived.getPlanningProjection(WORKSPACE, 'entity-1'))?.content.title, '标题')
    assert.equal(await revived.currentRevision(WORKSPACE), 1)
    assert.equal(await revived.recordObservation(observation('key-1')), false, '重启后重复观察仍必须被去重')
  })
}
