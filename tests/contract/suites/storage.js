/** Storage 契约套件：接受任意 Storage 适配器 `{ label, makeStorage(), restart(storage) }`；`restart` 必须返回读到同一份内容的新实例。 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { ObservationState } from '@harness-projects/capabilities'
import { ExternalIdentityKind, MembershipContentKind } from '@harness-projects/domain'
const WORKSPACE = 'ws-1'
const workspace = (id = WORKSPACE, name = '工作区') => ({ id, name, statusPolicy: 'provider_authoritative' })
const binding = (id, isDefault = false) => ({ id, workspaceId: WORKSPACE, domain: 'planning', implementationKey: 'fake', enabled: true, isDefault })
// planning 域只允许一个启用的挂载（不变量 1），因此「同工作区多个启用绑定」的用例换域。
const developmentBinding = (id, overrides = {}) => ({ ...binding(id), domain: 'development', ...overrides })
const projection = {
  workspaceId: WORKSPACE, entityId: 'entity-1', planningStatus: 'todo', revision: 1, content: { contentKind: 'work_item', title: '标题', body: '正文' },
}
const observation = (dedupeKey, state = ObservationState.Pending, overrides = {}) => ({ state, observation: {
  bindingId: 'binding-1', dedupeKey, type: 'issue.updated', eventTime: undefined, receivedTime: '2026-09-20T00:00:01Z',
  subject: { bindingId: 'binding-1', objectKind: 'issue', externalId: 'issue-1', url: undefined },
  sourceVersion: 'v1', payloadHash: 'payload-hash', payload: {}, ...overrides } })
// 成员关系：定位键 (workspaceId, itemExternalId)；同一内容在两个工作区是两条（行为 1）。字段值：只存原样值，键不含可选值 id（R2）。
const membership = (overrides = {}) => ({ workspaceId: WORKSPACE, projectExternalId: 'project-1', itemExternalId: 'item-1', contentKind: 'issue',
  contentExternalId: 'issue-1', membershipCreatedAt: '2026-09-20T00:00:00Z', membershipUpdatedAt: '2026-09-20T00:00:00Z', ...overrides })
const fieldValue = (overrides = {}) => ({ workspaceId: WORKSPACE, itemExternalId: 'item-1', projectFieldId: 'field-1', value: 'In Progress',
  observedAt: '2026-09-20T00:00:02Z', ...overrides })
// 前置行：SQLite 实现打开 foreign_keys，成员关系/字段值/投影都以外键指向工作区、绑定与实体。
const seedWorkspace = (storage, id = WORKSPACE) => storage.putWorkspace(workspace(id))
const seedEntity = (storage, id) => storage.putEntity({ id, kind: 'work_item' })
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
    await seedWorkspace(storage)
    // 用 development 域：planning 域写第二个启用的绑定会被拒绝而不是降级。
    await storage.putProviderBinding(developmentBinding('binding-1', { isDefault: true }))
    await storage.putProviderBinding(developmentBinding('binding-2', { isDefault: true }))
    const bindings = await storage.listProviderBindings(WORKSPACE)
    assert.deepEqual(bindings.filter((b) => b.isDefault).map((b) => b.id), ['binding-2'])
    assert.equal(bindings.find((b) => b.id === 'binding-1')?.isDefault, false, '同域旧的默认必须被降级')
    assert.equal(bindings.find((b) => b.id === 'binding-1')?.enabled, true, '降级只改 isDefault，不改变启用状态')
  })

  test(`${label}：外部身份全局一份，重复登记保留已分配的 id 与 entityId`, async () => {
    const storage = makeStorage()
    await seedWorkspace(storage)
    await storage.putProviderBinding(binding('binding-1'))
    await storage.putEntity({ id: 'entity-1', kind: 'work_item' })
    await seedEntity(storage, 'entity-9')
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
    await seedWorkspace(storage)
    await seedEntity(storage, 'entity-1')
    await storage.putPlanningProjection(WORKSPACE, projection)
    assert.deepEqual(await storage.getPlanningProjection(WORKSPACE, 'entity-1'), projection)
    assert.deepEqual((await storage.listPlanningProjections(WORKSPACE)).map((p) => p.entityId), ['entity-1'])
    assert.deepEqual(await storage.listPlanningProjections('ws-other'), [])
    // 引用完整性是共有的契约：前置行**只走端口**建（2026-09-24 评审：旧版靠 SQLite 侧裸 SQL 预置，掩盖了分叉）。
    await storage.putProviderBinding(binding('binding-1'))
    await seedEntity(storage, 'entity-9')
    await storage.putExternalIdentity({ id: 'identity-9', entityId: 'entity-9', bindingId: 'binding-1', externalKind: 'branch', externalId: 'branch-9', role: 'primary' })
    await storage.putRepository({ id: 'repo-1', workspaceId: WORKSPACE, externalIdentityId: 'identity-9' })
    assert.deepEqual((await storage.listRepositories(WORKSPACE)).map((r) => r.id), ['repo-1'])
  })
  test(`${label}：replace 收敛指定 binding，保留作用域外投影`, async () => {
    const storage = makeStorage()
    await seedWorkspace(storage)
    await storage.putProviderBinding(binding('binding-1'))
    // 第二条连接挂在 development 域（不变量 1 只允许一个启用的 planning 挂载）。
    await storage.putProviderBinding(developmentBinding('binding-2'))
    await storage.putEntity({ id: 'entity-1', kind: 'work_item' })
    await storage.putEntity({ id: 'entity-2', kind: 'work_item' })
    await storage.putExternalIdentity({ id: 'identity-1', entityId: 'entity-1', bindingId: 'binding-1', externalKind: 'issue', externalId: 'issue-1', role: 'primary' })
    await storage.putExternalIdentity({ id: 'identity-2', entityId: 'entity-2', bindingId: 'binding-2', externalKind: 'issue', externalId: 'issue-2', role: 'primary' })
    await storage.putPlanningProjection(WORKSPACE, projection)
    await storage.putPlanningProjection(WORKSPACE, { ...projection, entityId: 'entity-2' })
    await storage.replacePlanningProjections({ workspaceId: WORKSPACE, bindingId: 'binding-1' }, [])
    assert.deepEqual(await storage.listPlanningProjections(WORKSPACE), [{ ...projection, entityId: 'entity-2' }])
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
    // 不变量 5：候选不得降级已确认。
    await storage.putRelation(WORKSPACE, { ...relation, state: 'candidate' })
    assert.equal((await storage.listRelations(WORKSPACE)).filter((item) => item.state === 'confirmed').length, 1, '候选写入不得把已确认行降级')
    const relations = await storage.listRelations(WORKSPACE)
    assert.equal(relations.length, 1)
    assert.equal(relations[0].state, 'confirmed')
    assert.deepEqual(await storage.listRelations('ws-other'), [])
  })

  test(`${label}：重复或乱序观察返回 false，新版本应用且同版本整条替换`, async () => {
    const storage = makeStorage()
    const makeObservation = (key, version, payload) => observation(key, 'pending', {
      sourceVersion: version, payload, receivedTime: `${version}:00Z`,
    })
    assert.equal(await storage.recordObservation(makeObservation('key-1', 'v2', { value: 'new' })), true)
    assert.equal(await storage.recordObservation(makeObservation('key-old', 'v1', { value: 'old' })), false)
    assert.equal(await storage.recordObservation(makeObservation('key-1', 'v2', { value: 'replacement' })), false)
    assert.equal(await storage.recordObservation(makeObservation('key-2', 'v3', { value: 'latest' })), true)
    assert.equal((await storage.getSyncCursor('binding-1', 'scope-1')), undefined)
    await storage.putSyncCursor({ bindingId: 'binding-1', scopeKey: 'scope-1', cursorValue: 'cursor-1', state: 'healthy', lastErrorCode: undefined })
    await storage.putReconcileCursor({ workspaceId: WORKSPACE, lastReconciledAt: '2026-09-20T00:00:00Z' })
    await storage.putReconcileCursor({ workspaceId: 'ws-other', lastReconciledAt: '2026-09-21T00:00:00Z' })
    assert.equal((await storage.getReconcileCursor(WORKSPACE))?.lastReconciledAt, '2026-09-20T00:00:00Z')
    assert.equal((await storage.getReconcileCursor('ws-other'))?.lastReconciledAt, '2026-09-21T00:00:00Z')
    assert.equal((await storage.getSyncCursor('binding-1', 'scope-1'))?.cursorValue, 'cursor-1')
  })

  // 一行一键（2026-09-24 评审：旧模型在 DDL / 端口 / 替身 / core 之间有四种说法）：同 (工作区, 幂等键) 只有一行，
  // 状态原地推进；`id` 在工作区内唯一，跨工作区同键同 id 互不影响。
  test(`${label}：写尝试一行一键，状态原地推进且 id 在工作区内唯一`, async () => {
    const storage = makeStorage(); await seedWorkspace(storage); await seedWorkspace(storage, 'ws-2')
    await storage.putProviderBinding(binding('binding-1'))
    await storage.putProviderBinding({ ...binding('binding-1'), workspaceId: 'ws-2' })
    const attempt = {
      id: 'attempt-1', workspaceId: WORKSPACE, bindingId: 'binding-1', commandName: 'updatePlanningFields',
      idempotencyKey: 'key-1', state: 'pending', expectedSourceVersion: '2026-09-20T00:00:00Z', errorCode: undefined,
    }
    await storage.putMutationAttempt(attempt)
    await storage.putMutationAttempt({ ...attempt, state: 'saved' })
    assert.equal((await storage.findMutationAttempt(WORKSPACE, 'key-1'))?.state, 'saved', '同键是幂等覆盖，不是保留首次结果')
    assert.deepEqual((await storage.listMutationAttempts(WORKSPACE)).map((a) => a.id), ['attempt-1'], '同键只有一行')
    await assert.rejects(storage.putMutationAttempt({ ...attempt, idempotencyKey: 'key-2' }), '同一工作区内同一个 id 不得复用')
    await storage.putMutationAttempt({ ...attempt, workspaceId: 'ws-2', state: 'pending' })
    assert.equal((await storage.findMutationAttempt('ws-2', 'key-1'))?.state, 'pending', '幂等键的作用域是工作区')
    assert.deepEqual((await storage.listMutationAttempts(WORKSPACE)).map((a) => a.id), ['attempt-1'], '另一个工作区的写入不得进入本工作区')
  })

  // 「移出 → 移回」：旧替身在这里删掉实体却留下身份，重新加入时撞上"实体不存在"，此后每次同步都失败。
  // 实体仍有身份时不得删除——与 SQLite 的外键同语义。
  test(`${label}：投影被收敛移除后实体与身份保留，条目可以重新加入`, async () => {
    const storage = makeStorage()
    await seedWorkspace(storage)
    await storage.putProviderBinding(binding('binding-1'))
    await seedEntity(storage, 'entity-1')
    await storage.putExternalIdentity({ id: 'identity-1', entityId: 'entity-1', bindingId: 'binding-1', externalKind: 'issue', externalId: 'issue-1', role: 'primary' })
    await storage.putPlanningProjection(WORKSPACE, projection)
    await storage.replacePlanningProjections({ workspaceId: WORKSPACE, bindingId: 'binding-1' }, [])
    assert.deepEqual(await storage.listPlanningProjections(WORKSPACE), [], '收敛把作用域内的投影移除')
    assert.equal((await storage.findExternalIdentity('binding-1', 'issue', 'issue-1'))?.entityId, 'entity-1', '实体仍有身份，不得被连带删除')
    await storage.putPlanningProjection(WORKSPACE, projection)
    assert.deepEqual(await storage.listPlanningProjections(WORKSPACE), [projection], '条目重新加入必须成功')
  })

  test(`${label}：投影修订号从 0 起单调递增`, async () => {
    const storage = makeStorage()
    await seedWorkspace(storage) // 修订号属于一个已存在的工作区（端口的引用完整性要求）
    assert.equal(await storage.currentRevision(WORKSPACE), 0)
    assert.equal(await storage.advanceRevision(WORKSPACE), 1)
    assert.equal(await storage.advanceRevision(WORKSPACE), 2)
    assert.equal(await storage.currentRevision(WORKSPACE), 2)
    assert.equal(await storage.currentRevision('ws-other'), 0)
  })

  test(`${label}：同一内容在两个工作区是两条成员关系，互不覆盖且同内容只有一条`, async () => {
    const storage = makeStorage()
    await seedWorkspace(storage)
    await seedWorkspace(storage, 'ws-2')
    await storage.putMembership(membership())
    await storage.putMembership(membership({ workspaceId: 'ws-2', itemExternalId: 'item-2' }))
    await storage.putMembership(membership({ membershipUpdatedAt: '2026-09-20T01:00:00Z' }))
    assert.deepEqual((await storage.listMemberships(WORKSPACE, 'project-1')).map((m) => m.itemExternalId), ['item-1'], '重复 putMembership 幂等')
    assert.equal((await storage.getMembership(WORKSPACE, 'item-1'))?.membershipUpdatedAt, '2026-09-20T01:00:00Z')
    assert.equal((await storage.getMembership('ws-2', 'item-2'))?.membershipUpdatedAt, '2026-09-20T00:00:00Z', '另一个工作区的成员关系不得被覆盖')
    assert.equal(await storage.getMembership('ws-2', 'item-1'), undefined, '成员关系是工作区作用域的，不得跨工作区命中')
    await storage.putMembership(membership({ itemExternalId: 'item-2' }))
    const rows = await storage.listMemberships(WORKSPACE, 'project-1')
    assert.deepEqual(rows.map((m) => m.itemExternalId), ['item-2'], '平台保证 (项目, 内容) 唯一，新观测取代旧行而不是留下第二条（R1）')
    await storage.putMembership(membership({ projectExternalId: 'project-2', itemExternalId: 'item-3', contentExternalId: 'issue-3' }))
    assert.deepEqual((await storage.listMemberships(WORKSPACE, 'project-1')).map((m) => m.itemExternalId), ['item-2'], 'project-1 查询不得混入 project-2')
    assert.deepEqual((await storage.listMemberships(WORKSPACE, 'project-2')).map((m) => m.itemExternalId), ['item-3'], 'project-2 查询只返回自身成员')
  })

  test(`${label}：成员关系的内容种类只有三个取值，且外部身份种类不含 ProjectV2Item`, () => {
    assert.deepEqual([...Object.values(MembershipContentKind)].sort(), ['change_request', 'draft', 'issue'])
    assert.deepEqual([...Object.values(ExternalIdentityKind)].sort(), ['branch', 'change_request', 'draft', 'issue', 'worktree'], 'R1：不得把 ProjectV2Item 加进外部身份种类')
  })

  test(`${label}：字段值按 (工作区, 条目, 项目字段) 定位，不含可选值 id`, async () => {
    const storage = makeStorage()
    const pairs = async (item) => (await storage.listFieldValues(WORKSPACE, item)).map((v) => [v.projectFieldId, v.value]).sort()
    await seedWorkspace(storage); await seedWorkspace(storage, 'ws-2')
    await storage.putMembership(membership())
    await storage.putMembership(membership({ itemExternalId: 'item-2', contentExternalId: 'issue-2' }))
    await storage.putMembership(membership({ workspaceId: 'ws-2', itemExternalId: 'item-2' }))
    await storage.putFieldValue(fieldValue())
    await storage.putFieldValue(fieldValue({ projectFieldId: 'field-2', value: 'Todo' }))
    await storage.putFieldValue(fieldValue({ value: 'Done' }))
    assert.deepEqual(await pairs('item-1'), [['field-1', 'Done'], ['field-2', 'Todo']], '同键覆盖、不同字段各一条')
    const [first] = await storage.listFieldValues(WORKSPACE, 'item-1')
    assert.deepEqual(Object.keys(first).sort(), ['itemExternalId', 'observedAt', 'projectFieldId', 'value', 'workspaceId'], 'R2：定位键不得含可选值 id')
    await storage.putFieldValue(fieldValue({ itemExternalId: 'item-2', projectFieldId: 'field-1', value: 'Blocked' }))
    assert.deepEqual(await pairs('item-1'), [['field-1', 'Done'], ['field-2', 'Todo']], '同工作区另一个条目不得进入 item-1，同字段的不同条目也不得互相覆盖')
    assert.deepEqual(await pairs('item-2'), [['field-1', 'Blocked']], 'item-2 只看到自己的字段值')
    assert.deepEqual(await storage.listFieldValues(WORKSPACE, 'item-nonexistent'), [], '没有成员关系的条目没有字段值')
    await storage.putFieldValue(fieldValue({ workspaceId: 'ws-2', itemExternalId: 'item-2', value: 'Todo' }))
    assert.deepEqual(await pairs('item-2'), [['field-1', 'Blocked']], '另一个工作区的同名字段值互不覆盖')
  })

  test(`${label}：引用不存在的父行必须被拒绝（引用完整性是两个实现共有的契约）`, async () => {
    const storage = makeStorage()
    await seedWorkspace(storage)
    await assert.rejects(storage.putMembership(membership({ workspaceId: 'ws-none' })), '成员关系必须属于存在的工作区')
    assert.equal(await storage.getMembership('ws-none', 'item-1'), undefined, '被拒绝的成员关系不得留下任何行')
    assert.deepEqual(await storage.listMemberships('ws-none', 'project-1'), [], '被拒绝的成员关系不得留下任何行')
    await storage.putMembership(membership())
    await assert.rejects(storage.putFieldValue(fieldValue({ itemExternalId: 'item-none' })), '字段值必须挂在存在的成员关系上')
    assert.deepEqual(await storage.listFieldValues(WORKSPACE, 'item-none'), [], '被拒绝的写入不得留下任何行')
    await seedWorkspace(storage, 'ws-2')
    await storage.putMembership(membership({ workspaceId: 'ws-2', itemExternalId: 'item-2' }))
    await assert.rejects(storage.putFieldValue(fieldValue({ itemExternalId: 'item-2' })), '成员关系是工作区作用域的，不得跨工作区挂靠字段值')
    assert.deepEqual(await storage.listFieldValues(WORKSPACE, 'item-2'), [], '被拒绝的写入不得留下任何行')
    assert.deepEqual(await storage.listFieldValues('ws-2', 'item-2'), [], '被拒绝的写入不得落到另一个工作区')
  })

  test(`${label}：定序取已提交版本的最大值，介于中间与更旧的版本都必须被拒绝（R4）`, async () => {
    const storage = makeStorage()
    await seedWorkspace(storage)
    const at = (key, version) => observation(key, ObservationState.Pending, { sourceVersion: version, receivedTime: version })
    assert.equal(await storage.recordObservation(at('k1', '2026-09-21T07:11:00Z')), true)
    assert.equal(await storage.recordObservation(at('k2', '2026-09-21T07:11:54Z')), true, '更新的 ISO 版本必须被接受')
    // 判别性（2026-09-24 评审）：`v1, v3, v2` 这一格把"取最大"与"取最小"分开——旧用例的乱序观察都比**全部**
    // 已见版本更旧，所以把比较方向反过来（取最旧）也全绿。
    assert.equal(await storage.recordObservation(at('k3', '2026-09-21T07:11:30Z')), false, '介于中间（比已提交旧、比最早的新）的版本必须被拒绝')
    assert.equal(await storage.recordObservation(at('k4', '2026-09-21T07:10:00Z')), false, '更旧的 ISO 版本必须被拒绝')
    assert.equal(await storage.recordObservation(at('k1', '2026-09-21T07:11:00Z')), false, '同版本重复投递必须被拒绝')
  })

  test(`${label}：版本载体必须是可比的 ASCII，非 ASCII 在入口被拒绝（R4）`, async () => {
    const storage = makeStorage()
    await seedWorkspace(storage)
    const at = (key, version) => observation(key, ObservationState.Pending, { sourceVersion: version, receivedTime: '2026-09-21T07:11:00Z' })
    // 判别性（2026-09-24 评审）：JS 的 `<` 比较 UTF-16 码元，SQLite 的 BINARY 比较 UTF-8 字节，两者在
    // U+E000–U+FFFF 与增补平面之间结论相反。判据收敛到 capabilities 的 `compareSourceVersion`（码点序）之后，
    // 非 ASCII 载体在入口被拒绝，这条分叉从"未被发现"变成"不可达"。
    await assert.rejects(storage.recordObservation(at('k1', '～')), /ASCII/, '非 ASCII 的 sourceVersion 必须被拒绝')
    await assert.rejects(storage.recordObservation(at('k2', '😀')), /ASCII/, '增补平面字符同样必须被拒绝')
    assert.equal(await storage.recordObservation(at('k3', 'v1')), true, 'ASCII 载体照常接受（provider 的义务是让它可比）')
  })

  test(`${label}：换一个实例能读到同一份内容（模拟重启）`, async () => {
    const storage = makeStorage()
    await seedWorkspace(storage)
    await seedEntity(storage, 'entity-1')
    await storage.putPlanningProjection(WORKSPACE, projection)
    await storage.advanceRevision(WORKSPACE)
    await storage.recordObservation(observation('key-1'))
    await storage.putMembership(membership()); await storage.putFieldValue(fieldValue())
    const revived = restart(storage)
    assert.equal((await revived.getWorkspace(WORKSPACE))?.name, '工作区')
    assert.equal((await revived.getPlanningProjection(WORKSPACE, 'entity-1'))?.content.title, '标题')
    assert.equal(await revived.currentRevision(WORKSPACE), 1)
    assert.equal((await revived.getMembership(WORKSPACE, 'item-1'))?.contentExternalId, 'issue-1', '重启后成员关系仍在')
    assert.equal((await revived.listFieldValues(WORKSPACE, 'item-1'))[0]?.value, 'In Progress', '重启后字段值仍在')
    assert.equal(await revived.recordObservation(observation('key-1')), false, '重启后重复观察仍必须被去重')
  })
}
