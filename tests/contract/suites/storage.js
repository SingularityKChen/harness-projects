/** Storage 契约套件入口：接受任意 Storage 适配器 `{ label, makeStorage(), restart(storage) }`。`restart` 必须返回"重启后"的新实例，且读到的内容与重启前一致——删掉导出/导入实现就会失败。看护的不变量：事务原子性；同一实例只有一个写者路径（重叠事务串行提交、事务在途时的直接写入不被并进事务）；连接锚点跨工作区共享而挂载是工作区作用域的（同 id 换实现被拒、第二个启用的 planning 挂载被拒、同一工作区同一域至多一个启用的默认）；外部身份全局一份且每个实体至多一个 primary；同一内容在两个工作区是两条成员关系，同一 (工作区, 项目, 内容) 只有一条，被取代条目的字段值一并删除；listMemberships 按 itemExternalId 升序；字段值按 (工作区, 条目, 项目字段) 定位且不含可选值 id；成员关系/字段值/投影的引用完整性；同一工作项+仓库 只有一个 active 执行上下文；观察按 (binding, dedupeKey) 去重；写尝试按幂等键重放返回原结果；投影修订号单调递增。
 * 本文件保留入口与**地基组**：地基组用例体留在原地（切分是纯移动，逐字未动），同步组与执行组分别在 `storage-sync.js` 与 `storage-execution.js`，共享夹具在 `storage-fixtures.js`。切分账与两层守卫见下方常量与 `tests/contract/storage-contract.test.js`。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { storageExecutionSuite } from './storage-execution.js'
import { binding, developmentBinding, projection, seedEntity, seedWorkspace, WORKSPACE, workspace } from './storage-fixtures.js'
import { storageSyncSuite } from './storage-sync.js'

export { storageExecutionSuite, storageSyncSuite }

/** 事务内再开事务的错误必须可识别：类型层 `StorageTransaction = Omit<Storage, 'transaction'>` 不会在运行时移除方法，两个实现都必须在运行时显式拒绝（L3 计划遗留「嵌套事务在运行时静默吞写」与 L4 同批修）。这是**约定**文本而不是共享常量：依赖方向（`providers/fake` 不得依赖 `storage-sqlite`）决定两个字面量只能各自维护，因此断言钉整串——任何一侧改写措辞都会变红。 */
export const NESTED_TRANSACTION_MESSAGE = '嵌套事务不被支持：一个事务内不得再开事务'

export function storageFoundationSuite(adapter, register = test) {
  const { label, makeStorage } = adapter

  register(`${label}：事务提交成功、失败整体回滚`, async () => {
    const storage = makeStorage()
    await storage.transaction((tx) => tx.putWorkspace(workspace()))
    assert.equal((await storage.getWorkspace(WORKSPACE))?.name, '工作区')
    await assert.rejects(storage.transaction(async (tx) => {
      await tx.putWorkspace(workspace('ws-rolled-back', '不该存在'))
      throw new Error('事务内失败')
    }))
    assert.equal(await storage.getWorkspace('ws-rolled-back'), undefined)
  })
  const overlapGate = () => {
    let release; const gate = new Promise((resolve) => { release = resolve })
    let mark; const suspended = new Promise((resolve) => { mark = resolve })
    return { gate, release, mark, suspended }
  }

  register(`${label}：在途事务提交后保留直接写入`, { timeout: 5000 }, async () => {
    const storage = makeStorage(); const { gate, release } = overlapGate()
    const transaction = storage.transaction(async (tx) => { await tx.putWorkspace(workspace('ws-t1', 'T1')); await gate })
    await new Promise((resolve) => setImmediate(resolve))
    const direct = storage.putWorkspace(workspace('ws-direct', '直接写入'))
    release(); await Promise.all([transaction, direct])
    assert.equal((await storage.getWorkspace('ws-t1'))?.name, 'T1')
    assert.equal((await storage.getWorkspace('ws-direct'))?.name, '直接写入')
  })

  register(`${label}：重叠事务串行提交，已确认的写入不被后来者覆盖`, { timeout: 5000 }, async () => {
    const storage = makeStorage(); const { gate, release, mark, suspended } = overlapGate()
    const first = storage.transaction(async (tx) => { await tx.putWorkspace(workspace('ws-t1', 'T1')); mark(); await gate })
    await suspended
    const second = storage.transaction((tx) => tx.putWorkspace(workspace('ws-t2', 'T2')))
    release(); await Promise.all([first, second])
    assert.equal((await storage.getWorkspace('ws-t1'))?.name, 'T1')
    assert.equal((await storage.getWorkspace('ws-t2'))?.name, 'T2', 'T2 已确认的写入不得被 T1 的提交覆盖')
  })

  // P1-2 的另一半：事务在途时的直接写入不得被并进事务——并进去的话回滚会把它一起带走，而调用方已经拿到 resolved。上面那条（事务提交）在 SQLite 上分辨不出这件事：被并进去的写入会随提交一起落库；只有回滚分支才钉得住。
  register(`${label}：在途事务回滚后直接写入仍然落库`, { timeout: 5000 }, async () => {
    const storage = makeStorage(); const { gate, release, mark, suspended } = overlapGate()
    const failed = storage.transaction(async (tx) => { await tx.putWorkspace(workspace('ws-t1', 'T1')); mark(); await gate; throw new Error('事务内失败') })
    await suspended
    const direct = storage.putWorkspace(workspace('ws-direct', '直接写入'))
    release(); await assert.rejects(failed, /事务内失败/); await direct
    assert.equal(await storage.getWorkspace('ws-t1'), undefined, '失败事务的写入必须整体回滚')
    assert.equal((await storage.getWorkspace('ws-direct'))?.name, '直接写入', '事务在途时的直接写入不得被并进事务、随回滚一起消失')
  })

  register(`${label}：事务未提交的写入不得被事务外的读看到`, { timeout: 5000 }, async () => {
    const storage = makeStorage(); const { gate, release, mark, suspended } = overlapGate()
    await storage.putWorkspace(workspace())
    const failed = storage.transaction(async (tx) => { await tx.putWorkspace(workspace(WORKSPACE, '未提交')); mark(); await gate; throw new Error('事务内失败') })
    await suspended
    let seen; const read = storage.getWorkspace(WORKSPACE).then((value) => { seen = value })
    release(); await assert.rejects(failed, /事务内失败/); await read
    assert.notEqual(seen?.name, '未提交', '未提交的写入不得被事务外的读看到')
    assert.equal((await storage.getWorkspace(WORKSPACE))?.name, '工作区', '回滚后读到的是已提交的基线值')
  })

  register(`${label}：一个工作区同一时刻只有一个默认绑定`, async () => {
    const storage = makeStorage(); await seedWorkspace(storage)
    await storage.putProviderBinding(developmentBinding('binding-1', { isDefault: true }))
    await storage.putProviderBinding(developmentBinding('binding-2', { isDefault: true }))
    const bindings = await storage.listProviderBindings(WORKSPACE)
    assert.deepEqual(bindings.filter((b) => b.isDefault).map((b) => b.id), ['binding-2'])
    // 这两条是 L2 的 `45e281d` 为"判别力缺口"补上的，在级联切分时丢了（2026-09-24 评审 P1）：
    // 少了它们，"降级"被实现成"降级并禁用"或"直接删掉"都仍然全绿。
    assert.equal(bindings.find((b) => b.id === 'binding-1')?.isDefault, false, '同域旧的默认必须被降级')
    assert.equal(bindings.find((b) => b.id === 'binding-1')?.enabled, true, '降级只改 isDefault，不改变启用状态')
  })

  register(`${label}：外部身份全局一份，重复登记保留已分配的 id 与 entityId`, async () => {
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

  register(`${label}：规划投影与仓库按工作区隔离可读回`, async () => {
    const storage = makeStorage()
    await seedWorkspace(storage)
    await seedEntity(storage, 'entity-1')
    await storage.putPlanningProjection(WORKSPACE, projection)
    assert.deepEqual(await storage.getPlanningProjection(WORKSPACE, 'entity-1'), projection)
    assert.deepEqual((await storage.listPlanningProjections(WORKSPACE)).map((p) => p.entityId), ['entity-1'])
    assert.deepEqual(await storage.listPlanningProjections('ws-other'), [])
    await storage.putProviderBinding(binding('binding-1'))
    await seedEntity(storage, 'entity-9')
    await storage.putExternalIdentity({ id: 'identity-9', entityId: 'entity-9', bindingId: 'binding-1', externalKind: 'branch', externalId: 'branch-9', role: 'primary' })
    await storage.putRepository({ id: 'repo-1', workspaceId: WORKSPACE, externalIdentityId: 'identity-9' })
    assert.deepEqual((await storage.listRepositories(WORKSPACE)).map((r) => r.id), ['repo-1'])
  })

  register(`${label}：同一 (工作区, 实体) 的第二次写入覆盖前值`, async () => {
    const storage = makeStorage(); await seedWorkspace(storage); await seedEntity(storage, 'entity-1')
    const updated = { ...projection, planningStatus: 'done', revision: projection.revision + 1, content: { contentKind: 'change_request', number: 42, title: '新标题', body: '新正文' } }
    await storage.putPlanningProjection(WORKSPACE, projection); await storage.putPlanningProjection(WORKSPACE, updated)
    assert.deepEqual(await storage.getPlanningProjection(WORKSPACE, 'entity-1'), updated, '同键第二次写入必须覆盖前值，而不是保留旧行')
    assert.deepEqual(await storage.listPlanningProjections(WORKSPACE), [updated], '覆盖不得变成追加第二行')
  })
  register(`${label}：replace 收敛指定 binding，保留作用域外投影`, async () => {
    const storage = makeStorage()
    await seedWorkspace(storage)
    await storage.putProviderBinding(binding('binding-1'))
    // 同工作区第二个启用的 planning 挂载会被拒绝（不变量 1），第二条连接挂在 development 域。
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

  // 「移出 → 移回」：旧替身在这里删掉实体却留下身份，重新加入时撞上"实体不存在"，此后每次同步都失败。
  // 实体仍有身份时不得删除——与 SQLite 的外键同语义。
  register(`${label}：投影被收敛移除后实体与身份保留，条目可以重新加入`, async () => {
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

  register(`${label}：投影修订号从 0 起单调递增`, async () => {
    const storage = makeStorage()
    await seedWorkspace(storage) // 修订号属于一个已存在的工作区（端口的引用完整性要求）
    assert.equal(await storage.currentRevision(WORKSPACE), 0)
    assert.equal(await storage.advanceRevision(WORKSPACE), 1)
    assert.equal(await storage.advanceRevision(WORKSPACE), 2)
    assert.equal(await storage.currentRevision(WORKSPACE), 2)
    assert.equal(await storage.currentRevision('ws-other'), 0)
  })

  register(`${label}：事务内再调 tx.transaction(...) 必须运行时抛错`, async () => {
    const storage = makeStorage()
    // 判别点：抛错必须发生**在内层调用**上，而不是让外层事务整体失败——后者会把"嵌套被拒绝"与"事务实现坏了"混在一起。返回内层调用的结局：抛出的错误文本，或 'resolved'。
    const outcome = await storage.transaction(async (tx) => {
      try { await tx.transaction(() => Promise.resolve()); return 'resolved' } catch (error) { return String(error) }
    })
    assert.equal(outcome, `Error: ${NESTED_TRANSACTION_MESSAGE}`, 'StorageTransaction 的 Omit 只在类型层生效：实现必须在运行时拒绝嵌套事务，而不是静默吞掉内层写入；断言整串，措辞漂移即变红')
  })
}

/**
 * 切分前的用例条数（守卫基线）。判据是**回读本层 base 的 `tests/contract/suites/storage.js`**，不写任何 SHA——
 * 第三轮与第四轮评审各点过一次：写死的 SHA 在级联后不再是 head 的祖先，命令就不可复跑。
 * 回读命令：`BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`，再 `git show "$BASE":tests/contract/suites/storage.js | grep -c '^  test('` → 18。
 * 三组继承条数（地基 7 / 同步 8 / 执行 3）之和必须等于它。
 */
export const PRE_SPLIT_CASE_COUNT = 18
/**
 * 切分之后新增的用例条数：地基组 6 条——L4 修复轮的 4 条（嵌套事务 + 重叠事务串行提交、在途事务不吞直接写入、
 * 在途事务回滚后直接写入仍落库）与修复轮 2 的 2 条（读隔离、投影覆盖）；同步组在 L4 / L5 是纯移动，0 条；执行组
 * 由 L6 新增 10 条（执行面的读隔离、原子性、悬空父边与枚举等），合计 16。
 * 逐组账见 `tests/contract/storage-contract.test.js` 的 `CASE_LEDGER`；"新增"一旦跨组增长，写成单个标量就只能在账上写假数。
 */
export const ADDED_CASE_COUNT = 16
/** 三组各自从切分前继承的条数：foundation 7 + sync 8 + execution 3 = 18。 */
export const INHERITED_CASE_COUNTS = { foundation: 7, sync: 8, execution: 3 }
/** 组名 → suite：守卫与组合入口共用同一张表，组名不再以字符串形式散落在两处。 */
export const STORAGE_SUITE_GROUPS = { foundation: storageFoundationSuite, sync: storageSyncSuite, execution: storageExecutionSuite }

/** 数一组用例的条数：传入只计数的注册器，用例体不执行——删掉一个 `register(...)` 或整组不再被装配都会变红。 */
export function countSuiteCases(suite) {
  let count = 0
  const adapter = { label: '计数', makeStorage: () => { throw new Error('计数不执行用例体') }, restart: (storage) => storage }
  suite(adapter, () => { count += 1 })
  return count
}

/** 组合入口：两个实现最终都要跑全部三组；真实装配在 `tests/contract/storage-contract.test.js`（SQLite 侧逐组注册，L6 起执行组也注册）。 */
export function storageContractSuite(adapter) {
  storageFoundationSuite(adapter)
  storageSyncSuite(adapter)
  storageExecutionSuite(adapter)
}
