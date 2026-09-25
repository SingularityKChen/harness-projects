/** 执行组：执行上下文与运行、关系、写尝试。L4 的 SQLite 实现尚未交付这一组（方法显式抛出 `not implemented in L4: <method>`），因此本组当前只在内存替身上运行。 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { binding, seedWorkspace, WORKSPACE } from './storage-fixtures.js'

export function storageExecutionSuite(adapter, register = test) {
  const { label, makeStorage } = adapter

  register(`${label}：同一工作项+仓库最多一个 active 执行上下文`, async () => {
    const storage = makeStorage()
    const context = (id, status) => ({ id, workspaceId: WORKSPACE, workItemId: 'entity-1', repositoryId: 'repo-1', status, branchExternalId: undefined, worktreeExternalId: undefined })
    await storage.putExecutionContext(context('context-1', 'ready'))
    await storage.putExecutionContext(context('context-2', 'planned'))
    assert.equal((await storage.findActiveExecutionContext(WORKSPACE, 'entity-1', 'repo-1'))?.id, 'context-2')
    assert.equal((await storage.getExecutionContext('context-1'))?.status, 'closed')
    await storage.putExecutionRun({ id: 'run-1', workspaceId: WORKSPACE, contextId: 'context-2', status: 'running', updatedAt: '2026-09-20T00:00:00Z' })
    assert.equal((await storage.getExecutionRun('run-1'))?.status, 'running')
  })

  register(`${label}：关系按工作区隔离且重复写入不产生第二条`, async () => {
    const storage = makeStorage()
    const relation = { from: 'entity-1', to: 'entity-2', type: 'depends_on', class: 'business_semantics', source: 'deterministic', state: 'candidate' }
    await storage.putRelation(WORKSPACE, relation)
    await storage.putRelation(WORKSPACE, { ...relation, state: 'confirmed' })
    // 不变量 5：候选不得降级已确认。
    await storage.putRelation(WORKSPACE, { ...relation, state: 'candidate' })
    assert.equal((await storage.listRelations(WORKSPACE)).filter((item) => item.state === 'confirmed').length, 1, '候选写入不得把已确认行降级')
    const relations = await storage.listRelations(WORKSPACE)
    assert.equal(relations.length, 1)
    assert.equal(relations[0].state, 'confirmed')
    assert.deepEqual(await storage.listRelations('ws-other'), [])
  })

  // 一行一键（2026-09-24 评审：旧模型在 DDL / 端口 / 替身 / core 之间有四种说法）：同 (工作区, 幂等键) 只有一行，
  // 状态原地推进；`id` 在工作区内唯一，跨工作区同键同 id 互不影响。
  register(`${label}：写尝试一行一键，状态原地推进且 id 在工作区内唯一`, async () => {
    const storage = makeStorage(); await seedWorkspace(storage); await seedWorkspace(storage, 'ws-2')
    await storage.putProviderBinding(binding('binding-1'))
    await storage.putProviderBinding({ ...binding('binding-1'), workspaceId: 'ws-2' })
    const attempt = { id: 'attempt-1', workspaceId: WORKSPACE, bindingId: 'binding-1', commandName: 'updatePlanningFields',
      idempotencyKey: 'key-1', state: 'pending', expectedSourceVersion: '2026-09-20T00:00:00Z', errorCode: undefined }
    await storage.putMutationAttempt(attempt)
    await storage.putMutationAttempt({ ...attempt, state: 'saved' })
    assert.equal((await storage.findMutationAttempt(WORKSPACE, 'key-1'))?.state, 'saved', '同键是幂等覆盖，不是保留首次结果')
    assert.deepEqual((await storage.listMutationAttempts(WORKSPACE)).map((a) => a.id), ['attempt-1'], '同键只有一行')
    await assert.rejects(storage.putMutationAttempt({ ...attempt, idempotencyKey: 'key-2' }), '同一工作区内同一个 id 不得复用')
    await storage.putMutationAttempt({ ...attempt, workspaceId: 'ws-2', state: 'pending' })
    assert.equal((await storage.findMutationAttempt('ws-2', 'key-1'))?.state, 'pending', '幂等键的作用域是工作区')
    assert.deepEqual((await storage.listMutationAttempts(WORKSPACE)).map((a) => a.id), ['attempt-1'], '另一个工作区的写入不得进入本工作区')
  })
}
