/** 同步组：成员关系 / 字段值 / 观察 / 游标，以及它们共有的引用完整性。L4 的 SQLite 实现尚未交付这一组（方法显式抛出 `not implemented in L4: <method>`），因此本组当前只在内存替身上运行。 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { ObservationState } from '@harness-projects/capabilities'
import { ExternalIdentityKind, MembershipContentKind } from '@harness-projects/domain'
import { fieldValue, membership, observation, seedEntity, seedWorkspace, WORKSPACE, projection } from './storage-fixtures.js'

export function storageSyncSuite(adapter, register = test) {
  const { label, makeStorage, restart } = adapter

  register(`${label}：重复或乱序观察返回 false，新版本应用且同版本整条替换`, async () => {
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

  register(`${label}：同一内容在两个工作区是两条成员关系，互不覆盖且同内容只有一条`, async () => {
    const storage = makeStorage(); await seedWorkspace(storage); await seedWorkspace(storage, 'ws-2')
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

  register(`${label}：成员关系的内容种类只有三个取值，且外部身份种类不含 ProjectV2Item`, () => {
    assert.deepEqual([...Object.values(MembershipContentKind)].sort(), ['change_request', 'draft', 'issue'])
    assert.deepEqual([...Object.values(ExternalIdentityKind)].sort(), ['branch', 'change_request', 'draft', 'issue', 'worktree'], 'R1：不得把 ProjectV2Item 加进外部身份种类')
  })

  register(`${label}：字段值按 (工作区, 条目, 项目字段) 定位，不含可选值 id`, async () => {
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

  register(`${label}：引用不存在的父行必须被拒绝（引用完整性是两个实现共有的契约）`, async () => {
    const storage = makeStorage(); await seedWorkspace(storage)
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

  register(`${label}：定序取已提交版本的最大值，介于中间与更旧的版本都必须被拒绝（R4）`, async () => {
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

  register(`${label}：版本载体必须是可比的 ASCII，非 ASCII 在入口被拒绝（R4）`, async () => {
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

  register(`${label}：换一个实例能读到同一份内容（模拟重启）`, async () => {
    const storage = makeStorage(); await seedWorkspace(storage); await seedEntity(storage, 'entity-1')
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
