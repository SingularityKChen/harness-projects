/** 内存 Storage 替身的契约套件装配，外加实现专属的判别性用例。`restart` 用导出/导入内部状态模拟重启——删掉导出实现后，套件里"换一个实例读同一份内容"必然失败。事务隔离（未提交的写入不得被事务外的读看到）与写者路径语义（重叠事务串行提交、在途事务不吞直接写入）对两个实现都成立，因此钉在共享地基组里（`suites/storage.js`），不在本文件重复。SQLite 专属的用例是 `close()`、"事务 work 里调外层实例"与结算令牌三条（都不是端口面）（内存替身没有 close，它的队列在 work 里调外层实例同样静默挂起——见本层计划遗留「跨实例自等的共享用例缺另一半」）。 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { createFakeStorage, exportFakeStorageState } from '@harness-projects/provider-fake'
import { createSqliteStorage, openDatabase } from '@harness-projects/storage-sqlite'
import { STORAGE_SUITE_GROUPS, countSuiteCases, PRE_SPLIT_CASE_COUNT, ADDED_CASE_COUNT, INHERITED_CASE_COUNTS } from './suites/storage.js'
import { storageIdentityFoundationSuite, storageIdentitySyncSuite } from './suites/storage-identity-membership.js'
import { storageExecutionDivergenceSuite } from './suites/storage-execution.js'
import { developmentBinding, fieldValue, membership, observation, WORKSPACE } from './suites/storage-fixtures.js'

const workspace = (id, name) => ({ id, name, statusPolicy: 'provider_authoritative' })

const bindingRecord = (id, workspaceId) => ({ id, workspaceId, domain: 'planning', implementationKey: 'fake', enabled: true, isDefault: false })

// 装配台账：`assemble` 是**唯一**的装配入口，它按组把用例注册进 runner，同时把"这个标签实际注册了多少条"记进
// `REGISTERED`。守卫因此断言的是**实际注册条数**，不是组文件里写了多少条——删掉一整条装配调用（整组不再被装配）
// 会让该标签在台账里消失，删掉组清单里的一项会让它对该组注册 0 条，两种都变红。
// 身份面两组也走同一入口：`storage-identity-membership.js` 接受 `register` 参数（默认 `test`），因此它不再是
// 台账之外的"直接注册"——SQLite 的身份同步组注册被删掉同样会红（第四轮评审 P2）。
const SUITE_GROUPS = { ...STORAGE_SUITE_GROUPS, identityFoundation: storageIdentityFoundationSuite, identitySync: storageIdentitySyncSuite, sharedSync: (adapter, register) => sharedSyncSuite(adapter, register) }
const REGISTERED = new Map()
let assembled = 0
function assemble(adapter, groups) {
  const counts = {}
  assembled += 1
  REGISTERED.set(adapter.label, counts)
  for (const group of groups) {
    SUITE_GROUPS[group](adapter, (name, fn, options) => { counts[group] = (counts[group] ?? 0) + 1; test(name, fn, options) })
  }
}

// SQLite 适配器：L4 / #163 交付地基组与身份地基组，L5 / #164 补同步组与身份同步组，L6 / #120 补执行组（见下方
// 执行组装配）。`restart` 是真的关句柄再打开同一个文件。
const sqliteDir = mkdtempSync(join(tmpdir(), 'storage-sqlite-contract-'))
let sqliteCount = 0
after(() => rmSync(sqliteDir, { recursive: true, force: true }))
const restartSqlite = (storage) => { const location = storage.location; storage.close(); return createSqliteStorage(location) }
const sqliteAdapter = (label, prefix) => ({ label, makeStorage: () => createSqliteStorage(join(sqliteDir, `${prefix}-${sqliteCount++}.sqlite`)), restart: restartSqlite })

assemble({ label: '内存 Storage 替身', makeStorage: () => createFakeStorage(),
  restart: (storage) => createFakeStorage(exportFakeStorageState(storage)), inject: (storage) => failFakeWrite(storage) },
  ['foundation', 'sync', 'execution', 'identityFoundation', 'identitySync', 'sharedSync'])
assemble(sqliteAdapter('SQLite Storage（地基组）', 'storage'), ['foundation'])
assemble({ ...sqliteAdapter('SQLite Storage（同步组）', 'storage-sync'), inject: (storage) => failSqliteInsert(storage) }, ['sync', 'sharedSync'])
assemble(sqliteAdapter('SQLite Storage（身份地基组）', 'storage-identity'), ['identityFoundation'])
assemble(sqliteAdapter('SQLite Storage（身份同步组）', 'storage-identity-sync'), ['identitySync'])
// L6 / #120：执行面落地之后，SQLite 侧也注册执行组——执行面的 10 个方法第一次在 SQLite 上跑契约。
assemble(sqliteAdapter('SQLite Storage（执行组）', 'storage-execution'), ['execution'])

/**
 * 守卫的**独立**期望：标签 → 它必须装配的组。它是守卫自己的一份陈述，不由 `assemble` 的实参推导——
 * 从实参推导的话，删掉装配调用会连期望一起删掉，守卫就永远绿（这正是本守卫要消灭的缺陷形态）。
 */
// 依赖 core 的三格（执行上下文 → 仓库、执行上下文 → 工作项、关系端点）在替身上被接受、在 SQLite 上被外键拒绝。
// 仓库一格是 core 尚无登记仓库的生产调用者（#188）；工作项与关系端点两格是 core 的生产路径写入悬空引用（#196 / #187）。
// 三格都**必须是显式且被守卫的**：能力位按适配器声明，注册数由守卫独立写成 3。
const fakeDivergence = { label: '内存 Storage 替身（分叉格）', makeStorage: () => createFakeStorage(), acceptsDanglingCoreParents: true }
const sqliteDivergence = { ...sqliteAdapter('SQLite Storage（分叉格）', 'storage-divergence'), acceptsDanglingCoreParents: false }
const DIVERGENCE_REGISTERED = [fakeDivergence, sqliteDivergence].map((adapter) => storageExecutionDivergenceSuite(adapter))
test('执行组守卫：依赖 core 的三格分叉用例必须在两个适配器上都注册', () => {
  assert.deepEqual(DIVERGENCE_REGISTERED, [3, 3], '两个适配器都必须注册全部三格：删掉一条显式分叉用例会在这里变红')
})

const EXPECTED_ASSEMBLY = {
  '内存 Storage 替身': ['foundation', 'sync', 'execution', 'identityFoundation', 'identitySync', 'sharedSync'],
  'SQLite Storage（地基组）': ['foundation'],
  'SQLite Storage（同步组）': ['sync', 'sharedSync'],
  'SQLite Storage（身份地基组）': ['identityFoundation'],
  'SQLite Storage（身份同步组）': ['identitySync'],
  'SQLite Storage（执行组）': ['execution'],
}

// 切分守卫（两层）。**条数层**：三组用例数之和必须等于切分前的条数（再加切分后新增的那几条）——删掉任何一个
// register(...) 都会变红。**断言层**（2026-09-24 评审补上，第四轮评审改成集合比对）：条数层对"某个用例**内部**
// 少了一条断言"或"把断言改宽"都没有判别力——实测级联时丢掉 L2 钉住的两条默认降级断言（`binding-1.isDefault === false`
// / `binding-1.enabled === true`），条数守卫全绿，而"降级并禁用"或"直接删掉"两种实现都能通过；把
// `assert.deepEqual(a, b)` 改成 `assert.deepEqual(a, a)` 同样全绿。断言层因此比对三组文件里 `assert.` 语句的
// **多重集**（去掉空白后的整行文本）：基线里任何一条文本在当前文件里少出现一次即失败。新增断言不受影响；
// 要放宽必须**有意**从基线里删掉对应文本，并在提交信息里写明放宽了哪一条。
const CASE_LEDGER = { foundation: { inherited: INHERITED_CASE_COUNTS.foundation, added: 6 }, sync: { inherited: INHERITED_CASE_COUNTS.sync, added: 0 }, execution: { inherited: INHERITED_CASE_COUNTS.execution, added: 10 } }
const SUITE_FILES = { foundation: 'storage.js', sync: 'storage-sync.js', execution: 'storage-execution.js' }
/** 切分完成时三组 `assert.` 语句的多重集基线（2026-09-24 实测）：元素是语句**去掉空白后的整行文本**，同一文本出现几次就写几项。 */
const ASSERTION_BASELINE = {
  foundation: ["assert.equal((awaitstorage.getWorkspace(WORKSPACE))?.name,'工作区')", "awaitassert.rejects(storage.transaction(async(tx)=>{", "assert.equal(awaitstorage.getWorkspace('ws-rolled-back'),undefined)", "assert.equal((awaitstorage.getWorkspace('ws-t1'))?.name,'T1')", "assert.equal((awaitstorage.getWorkspace('ws-direct'))?.name,'直接写入')", "assert.equal((awaitstorage.getWorkspace('ws-t1'))?.name,'T1')", "assert.equal((awaitstorage.getWorkspace('ws-t2'))?.name,'T2','T2已确认的写入不得被T1的提交覆盖')", "release();awaitassert.rejects(failed,/事务内失败/);awaitdirect", "assert.equal(awaitstorage.getWorkspace('ws-t1'),undefined,'失败事务的写入必须整体回滚')", "assert.equal((awaitstorage.getWorkspace('ws-direct'))?.name,'直接写入','事务在途时的直接写入不得被并进事务、随回滚一起消失')", "release();awaitassert.rejects(failed,/事务内失败/);awaitread", "assert.notEqual(seen?.name,'未提交','未提交的写入不得被事务外的读看到')", "assert.equal((awaitstorage.getWorkspace(WORKSPACE))?.name,'工作区','回滚后读到的是已提交的基线值')", "assert.deepEqual(bindings.filter((b)=>b.isDefault).map((b)=>b.id),['binding-2'])", "assert.equal(bindings.find((b)=>b.id==='binding-1')?.isDefault,false,'同域旧的默认必须被降级')", "assert.equal(bindings.find((b)=>b.id==='binding-1')?.enabled,true,'降级只改isDefault，不改变启用状态')", "assert.equal(found?.id,'identity-1')", "assert.equal(found?.entityId,'entity-1')", "assert.equal((awaitstorage.listIdentitiesForEntity('entity-1')).length,1)", "assert.deepEqual(awaitstorage.listIdentitiesForEntity('entity-9'),[])", "assert.deepEqual(awaitstorage.getPlanningProjection(WORKSPACE,'entity-1'),projection)", "assert.deepEqual((awaitstorage.listPlanningProjections(WORKSPACE)).map((p)=>p.entityId),['entity-1'])", "assert.deepEqual(awaitstorage.listPlanningProjections('ws-other'),[])", "assert.deepEqual((awaitstorage.listRepositories(WORKSPACE)).map((r)=>r.id),['repo-1'])", "assert.deepEqual(awaitstorage.getPlanningProjection(WORKSPACE,'entity-1'),updated,'同键第二次写入必须覆盖前值，而不是保留旧行')", "assert.deepEqual(awaitstorage.listPlanningProjections(WORKSPACE),[updated],'覆盖不得变成追加第二行')", "assert.deepEqual(awaitstorage.listPlanningProjections(WORKSPACE),[{...projection,entityId:'entity-2'}])", "assert.deepEqual(awaitstorage.listPlanningProjections(WORKSPACE),[],'收敛把作用域内的投影移除')", "assert.equal((awaitstorage.findExternalIdentity('binding-1','issue','issue-1'))?.entityId,'entity-1','实体仍有身份，不得被连带删除')", "assert.deepEqual(awaitstorage.listPlanningProjections(WORKSPACE),[projection],'条目重新加入必须成功')", "assert.equal(awaitstorage.currentRevision(WORKSPACE),0)", "assert.equal(awaitstorage.advanceRevision(WORKSPACE),1)", "assert.equal(awaitstorage.advanceRevision(WORKSPACE),2)", "assert.equal(awaitstorage.currentRevision(WORKSPACE),2)", "assert.equal(awaitstorage.currentRevision('ws-other'),0)", "assert.equal(outcome,`Error:${NESTED_TRANSACTION_MESSAGE}`,'StorageTransaction的Omit只在类型层生效：实现必须在运行时拒绝嵌套事务，而不是静默吞掉内层写入；断言整串，措辞漂移即变红')"],
  sync: ["assert.equal(awaitstorage.recordObservation(makeObservation('key-1','v2',{value:'new'})),true)", "assert.equal(awaitstorage.recordObservation(makeObservation('key-old','v1',{value:'old'})),false)", "assert.equal(awaitstorage.recordObservation(makeObservation('key-1','v2',{value:'replacement'})),false)", "assert.equal(awaitstorage.recordObservation(makeObservation('key-2','v3',{value:'latest'})),true)", "assert.equal((awaitstorage.getSyncCursor('binding-1','scope-1')),undefined)", "assert.equal((awaitstorage.getReconcileCursor(WORKSPACE))?.lastReconciledAt,'2026-09-20T00:00:00Z')", "assert.equal((awaitstorage.getReconcileCursor('ws-other'))?.lastReconciledAt,'2026-09-21T00:00:00Z')", "assert.equal((awaitstorage.getSyncCursor('binding-1','scope-1'))?.cursorValue,'cursor-1')", "assert.deepEqual((awaitstorage.listMemberships(WORKSPACE,'project-1')).map((m)=>m.itemExternalId),['item-1'],'重复putMembership幂等')", "assert.equal((awaitstorage.getMembership(WORKSPACE,'item-1'))?.membershipUpdatedAt,'2026-09-20T01:00:00Z')", "assert.equal((awaitstorage.getMembership('ws-2','item-2'))?.membershipUpdatedAt,'2026-09-20T00:00:00Z','另一个工作区的成员关系不得被覆盖')", "assert.equal(awaitstorage.getMembership('ws-2','item-1'),undefined,'成员关系是工作区作用域的，不得跨工作区命中')", "assert.deepEqual(rows.map((m)=>m.itemExternalId),['item-2'],'平台保证(项目,内容)唯一，新观测取代旧行而不是留下第二条（R1）')", "assert.deepEqual((awaitstorage.listMemberships(WORKSPACE,'project-1')).map((m)=>m.itemExternalId),['item-2'],'project-1查询不得混入project-2')", "assert.deepEqual((awaitstorage.listMemberships(WORKSPACE,'project-2')).map((m)=>m.itemExternalId),['item-3'],'project-2查询只返回自身成员')", "assert.deepEqual([...Object.values(MembershipContentKind)].sort(),['change_request','draft','issue'])", "assert.deepEqual([...Object.values(ExternalIdentityKind)].sort(),['branch','change_request','draft','issue','worktree'],'R1：不得把ProjectV2Item加进外部身份种类')", "assert.deepEqual(awaitpairs('item-1'),[['field-1','Done'],['field-2','Todo']],'同键覆盖、不同字段各一条')", "assert.deepEqual(Object.keys(first).sort(),['itemExternalId','observedAt','projectFieldId','value','workspaceId'],'R2：定位键不得含可选值id')", "assert.deepEqual(awaitpairs('item-1'),[['field-1','Done'],['field-2','Todo']],'同工作区另一个条目不得进入item-1，同字段的不同条目也不得互相覆盖')", "assert.deepEqual(awaitpairs('item-2'),[['field-1','Blocked']],'item-2只看到自己的字段值')", "assert.deepEqual(awaitstorage.listFieldValues(WORKSPACE,'item-nonexistent'),[],'没有成员关系的条目没有字段值')", "assert.deepEqual(awaitpairs('item-2'),[['field-1','Blocked']],'另一个工作区的同名字段值互不覆盖')", "awaitassert.rejects(storage.putMembership(membership({workspaceId:'ws-none'})),'成员关系必须属于存在的工作区')", "assert.equal(awaitstorage.getMembership('ws-none','item-1'),undefined,'被拒绝的成员关系不得留下任何行')", "assert.deepEqual(awaitstorage.listMemberships('ws-none','project-1'),[],'被拒绝的成员关系不得留下任何行')", "awaitassert.rejects(storage.putFieldValue(fieldValue({itemExternalId:'item-none'})),'字段值必须挂在存在的成员关系上')", "assert.deepEqual(awaitstorage.listFieldValues(WORKSPACE,'item-none'),[],'被拒绝的写入不得留下任何行')", "awaitassert.rejects(storage.putFieldValue(fieldValue({itemExternalId:'item-2'})),'成员关系是工作区作用域的，不得跨工作区挂靠字段值')", "assert.deepEqual(awaitstorage.listFieldValues(WORKSPACE,'item-2'),[],'被拒绝的写入不得留下任何行')", "assert.deepEqual(awaitstorage.listFieldValues('ws-2','item-2'),[],'被拒绝的写入不得落到另一个工作区')", "assert.equal(awaitstorage.recordObservation(at('k1','2026-09-21T07:11:00Z')),true)", "assert.equal(awaitstorage.recordObservation(at('k2','2026-09-21T07:11:54Z')),true,'更新的ISO版本必须被接受')", "assert.equal(awaitstorage.recordObservation(at('k3','2026-09-21T07:11:30Z')),false,'介于中间（比已提交旧、比最早的新）的版本必须被拒绝')", "assert.equal(awaitstorage.recordObservation(at('k4','2026-09-21T07:10:00Z')),false,'更旧的ISO版本必须被拒绝')", "assert.equal(awaitstorage.recordObservation(at('k1','2026-09-21T07:11:00Z')),false,'同版本重复投递必须被拒绝')", "awaitassert.rejects(storage.recordObservation(at('k1','～')),/ASCII/,'非ASCII的sourceVersion必须被拒绝')", "awaitassert.rejects(storage.recordObservation(at('k2','😀')),/ASCII/,'增补平面字符同样必须被拒绝')", "assert.equal(awaitstorage.recordObservation(at('k3','v1')),true,'ASCII载体照常接受（provider的义务是让它可比）')", "assert.equal((awaitrevived.getWorkspace(WORKSPACE))?.name,'工作区')", "assert.equal((awaitrevived.getPlanningProjection(WORKSPACE,'entity-1'))?.content.title,'标题')", "assert.equal(awaitrevived.currentRevision(WORKSPACE),1)", "assert.equal((awaitrevived.getMembership(WORKSPACE,'item-1'))?.contentExternalId,'issue-1','重启后成员关系仍在')", "assert.equal((awaitrevived.listFieldValues(WORKSPACE,'item-1'))[0]?.value,'InProgress','重启后字段值仍在')", "assert.equal(awaitrevived.recordObservation(observation('key-1')),false,'重启后重复观察仍必须被去重')"],
  execution: ["assert.equal((awaitstorage.findActiveExecutionContext(WORKSPACE,'entity-1','repo-1'))?.id,'context-2')", "assert.equal((awaitstorage.getExecutionContext('context-1'))?.status,'closed')", "assert.equal((awaitstorage.getExecutionRun('run-1'))?.status,'running')", "assert.equal((awaitstorage.listRelations(WORKSPACE)).filter((item)=>item.state==='confirmed').length,1,'候选写入不得把已确认行降级')", "assert.equal(relations.length,1)", "assert.equal(relations[0].state,'confirmed')", "assert.deepEqual(awaitstorage.listRelations('ws-other'),[])", "assert.equal((awaitstorage.findMutationAttempt(WORKSPACE,'key-1'))?.state,'saved','同键是幂等覆盖，不是保留首次结果')", "assert.deepEqual((awaitstorage.listMutationAttempts(WORKSPACE)).map((a)=>a.id),['attempt-1'],'同键只有一行')", "awaitassert.rejects(storage.putMutationAttempt({...attempt,idempotencyKey:'key-2'}),'同一工作区内同一个id不得复用')", "assert.equal((awaitstorage.findMutationAttempt('ws-2','key-1'))?.state,'pending','幂等键的作用域是工作区')", "assert.deepEqual((awaitstorage.listMutationAttempts(WORKSPACE)).map((a)=>a.id),['attempt-1'],'另一个工作区的写入不得进入本工作区')"],
}
test('storage 契约套件切分守卫：三组用例数与断言集合都不低于切分时的基线', () => {
  const counts = Object.fromEntries(Object.entries(STORAGE_SUITE_GROUPS).map(([group, suite]) => [group, countSuiteCases(suite)]))
  const expected = Object.fromEntries(Object.entries(CASE_LEDGER).map(([group, ledger]) => [group, ledger.inherited + ledger.added]))
  assert.deepEqual(counts, expected, '分组条数必须与切分账一致（继承条数见 suites/storage.js 的来处注释）')
  assert.equal(counts.foundation + counts.sync + counts.execution, PRE_SPLIT_CASE_COUNT + ADDED_CASE_COUNT,
    '三组用例数之和 == 切分前的条数 + 切分后新增的条数')
  for (const [group, file] of Object.entries(SUITE_FILES)) {
    const remaining = readFileSync(new URL(`./suites/${file}`, import.meta.url), 'utf8').split('\n')
      .filter((line) => /\bassert\./.test(line)).map((line) => line.replace(/\s+/g, ''))
    const missing = ASSERTION_BASELINE[group].filter((text) => {
      const at = remaining.indexOf(text)
      if (at === -1) return true
      remaining.splice(at, 1)
      return false
    })
    assert.equal(missing.length, 0,
      `${group} 组有 ${missing.length} 条切分时的断言在当前文件里消失（被删除、改写或改宽）：\n${missing.slice(0, 3).join('\n')}`)
  }
})

test('storage 契约套件装配守卫：每个适配器实际注册的条数等于它声明要跑的组', () => {
  assert.equal(assembled, REGISTERED.size, '每个装配标签必须唯一：同名标签会把两次装配并成一份台账，条数守卫看不出来')
  assert.deepEqual([...REGISTERED.keys()].sort(), Object.keys(EXPECTED_ASSEMBLY).sort(),
    '装配标签必须与守卫的期望一一对应：删掉一整条装配调用会在这里变红（总条数只会静默缩水，不会被别的守卫发现）')
  for (const [label, groups] of Object.entries(EXPECTED_ASSEMBLY)) {
    const registered = REGISTERED.get(label)
    assert.ok(registered !== undefined, `${label} 没有任何用例被注册：整组不再被装配`)
    assert.deepEqual(Object.keys(registered).sort(), [...groups].sort(), `${label} 装配的组必须恰好是它声明的那几组`)
    for (const group of groups) {
      assert.equal(registered[group], countSuiteCases(SUITE_GROUPS[group]),
        `${label} 的 ${group} 组实际注册条数必须等于该组用例数：删掉组里任何一条 register(...) 都会在这里变红`)
    }
  }
})

// 终态不是 active：`startWork` 的 `claimContext` 靠这条语义接管一条失败的上下文（issue #184）。
// 判据写在 `packages/capabilities/src/storage.ts` 的执行段；这里把它钉成可失败的断言。
test('内存 Storage 替身：Failed 与 Closed 不是 active，findActive 不返回它们', async () => {
  const storage = createFakeStorage()
  await storage.putWorkspace(workspace('ws-terminal'))
  const context = (status) => ({
    id: 'ctx-terminal', workspaceId: 'ws-terminal', workItemId: 'entity-terminal', repositoryId: 'repo-1',
    status, branchExternalId: 'work/entity-terminal', worktreeExternalId: undefined, provisioningStartedAt: undefined,
  })
  const find = () => storage.findActiveExecutionContext('ws-terminal', 'entity-terminal', 'repo-1')

  await storage.putExecutionContext(context('failed'))
  assert.equal(await find(), undefined, 'Failed 不是 active：它不挡下一次开始，所以可以被接管')

  await storage.putExecutionContext(context('closed'))
  assert.equal(await find(), undefined, 'Closed 同样不是 active')

  await storage.putExecutionContext(context('provisioning'))
  assert.equal((await find())?.id, 'ctx-terminal', 'Provisioning 是 active：在途必须继续挡住')
})
test('内存 Storage 替身：一次事务失败后，下一个事务仍能提交', { timeout: 5000 }, async () => {
  const storage = createFakeStorage()
  await assert.rejects(storage.transaction(async (tx) => {
    await tx.putWorkspace(workspace('ws-failed', '不该存在'))
    throw new Error('事务内失败')
  }), /事务内失败/)
  await storage.transaction((tx) => tx.putWorkspace(workspace('ws-after', '提交成功')))
  assert.equal(await storage.getWorkspace('ws-failed'), undefined, '失败事务的写入必须整体回滚')
  assert.equal((await storage.getWorkspace('ws-after'))?.name, '提交成功')
})

const DUPLICATE_OBSERVATION = { state: 'pending', observation: { bindingId: 'binding-1', dedupeKey: 'dedupe-1', type: 'issue.updated', eventTime: undefined, receivedTime: '2026-09-20T00:00:01Z', subject: { bindingId: 'binding-1', objectKind: 'issue', externalId: 'issue-1', url: undefined }, sourceVersion: 'v1', payloadHash: 'payload-hash', payload: {} } } // 与 suites/storage.js 同形状；同一 (binding, dedupeKey) 的第二次投递必须整笔 no-op

test('内存 Storage 替身：同一观察记录两次后身份/实体/成员计数与只记录一次完全相同', async () => {
  const ingest = async (storage, identityId) => storage.transaction(async (tx) => {
    // 身份以外键指向连接锚点与实体：前置行只走端口建（2026-09-24 评审：旧版靠替身接受悬空引用才通过）。
    await tx.putWorkspace({ id: 'ws-1', name: '工作区', statusPolicy: 'provider_authoritative' })
    await tx.putProviderBinding({ id: 'binding-1', workspaceId: 'ws-1', domain: 'planning', implementationKey: 'fake', enabled: true, isDefault: false })
    if (!(await tx.recordObservation(DUPLICATE_OBSERVATION))) return false
    await tx.putEntity({ id: 'entity-1', kind: 'work_item' })
    await tx.putExternalIdentity({ id: identityId, entityId: 'entity-1', bindingId: 'binding-1', externalKind: 'issue', externalId: 'issue-1', role: 'primary' })
    return true
  })
  const once = createFakeStorage(); const twice = createFakeStorage()
  assert.equal(await ingest(once, 'identity-1'), true); assert.equal(await ingest(twice, 'identity-1'), true)
  assert.equal(await ingest(twice, 'identity-2'), false, '重复投递必须被去重，调用方据此不再登记第二个身份')
  const counts = async (storage, state) => [state.observations.length, state.entities.length, state.identities.length, (await storage.listIdentitiesForEntity('entity-1')).length]
  assert.deepEqual(await counts(twice, exportFakeStorageState(twice)), await counts(once, exportFakeStorageState(once)), '观察/实体/身份/成员计数必须与只记录一次完全相同')
})

// ── SQLite 专属判别性用例：`close()` 与"事务作用域"都不是端口面（内存替身没有 close；它的队列在 work 里调外层实例同样静默挂起，所以这一条暂时无法进共享组，见本层计划遗留「跨实例自等的共享用例缺另一半」）。约定文本在这里独立写一遍：实现侧改措辞即红。
const OUTER_INSTANCE_MESSAGE = '嵌套事务不被支持：事务内必须用 tx.*，调用外层实例会在队列内自等'; const CLOSED_MESSAGE = '存储实例已关闭：关闭前必须等在途事务结算'; const SETTLED_TRANSACTION_MESSAGE = '事务作用域已结算：tx.* 只能在所属事务的 work 内使用（常见成因是漏写 await）'

test('SQLite Storage：事务 work 里调外层实例（读 / 写 / 再开事务）必须快速失败，而不是队列内自等挂起', { timeout: 5000 }, async () => {
  const storage = createSqliteStorage(join(sqliteDir, `storage-${sqliteCount++}.sqlite`))
  const outcomes = await storage.transaction(async (tx) => {
    await tx.putWorkspace(workspace('ws-t1', 'T1'))
    const calls = [() => storage.getWorkspace('ws-t1'), () => storage.putWorkspace(workspace('ws-outer', '外层实例')), () => storage.transaction(() => Promise.resolve())]
    return Promise.all(calls.map((call) => call().then(() => 'resolved', (error) => String(error))))
  })
  assert.deepEqual(outcomes, [`Error: ${OUTER_INSTANCE_MESSAGE}`, `Error: ${OUTER_INSTANCE_MESSAGE}`, `Error: ${OUTER_INSTANCE_MESSAGE}`],
    '外层实例的读与写都会排到本实例事务之后（队列内自等，永不 settle）：必须抛同族的可识别错误')
  assert.equal((await storage.getWorkspace('ws-t1'))?.name, 'T1', '快速失败不得毒化外层事务：它仍要提交')
})

test('SQLite Storage：事务在途时 close() 后，在途事务与已排队变更都以"实例已关闭"快速失败', { timeout: 5000 }, async () => {
  const storage = createSqliteStorage(join(sqliteDir, `storage-${sqliteCount++}.sqlite`))
  let release; const gate = new Promise((resolve) => { release = resolve })
  let mark; const suspended = new Promise((resolve) => { mark = resolve })
  const inFlight = storage.transaction(async (tx) => { await tx.putWorkspace(workspace('ws-t1', 'T1')); mark(); await gate })
  await suspended; const queued = storage.putWorkspace(workspace('ws-queued', '排队写入'))
  storage.close(); release()
  await assert.rejects(inFlight, { message: CLOSED_MESSAGE }, '在途事务必须拿到端口级事实，而不是驱动的 database is not open')
  await assert.rejects(queued, { message: CLOSED_MESSAGE }, '已排队变更必须快速失败，不得变成 unhandled rejection 或驱动文案')
})

// 事务令牌的生命周期（第四轮时在 L5 的 `ae39655`，级联时整栈丢失，第五轮评审放回拥有这些机制的本层）：泄漏出 work 的 tx 与未 await 的 tx 写入都必须快速失败，不得在 ROLLBACK 之后落库或被并进下一个事务。
test('SQLite Storage：结算后泄漏出 work 的 tx、未 await 的 tx 写入与关闭后的作用域实例都必须快速失败', { timeout: 5000 }, async () => {
  const storage = createSqliteStorage(join(sqliteDir, `storage-settled-${sqliteCount++}.sqlite`)); let leaked, escaped
  await storage.transaction(async (tx) => { leaked = tx; await tx.putWorkspace(workspace('ws-leaked', '泄漏')) })
  await assert.rejects(leaked.getWorkspace('ws-leaked'), { message: SETTLED_TRANSACTION_MESSAGE }, '结算后的 tx 必须快速失败，而不是被并进下一个在途事务')
  await assert.rejects(leaked.putWorkspace(workspace('ws-late', '迟到')), { message: SETTLED_TRANSACTION_MESSAGE })
  await assert.rejects(storage.transaction(async (tx) => { escaped = (async () => { await null; return tx.putWorkspace(workspace('ws-escaped', '逃逸')) })(); throw new Error('事务内失败') }), /事务内失败/)
  await assert.rejects(escaped, { message: SETTLED_TRANSACTION_MESSAGE }, '未 await 的写入在执行时必须再查令牌'); assert.equal(await storage.getWorkspace('ws-escaped'), undefined, '失败事务不得留下经它自己的 tx 写入的行')
  assert.equal((await storage.getWorkspace('ws-leaked'))?.name, '泄漏', '快速失败不得毒化已提交的写入'); storage.close()
  await assert.rejects(leaked.getWorkspace('ws-leaked'), { message: CLOSED_MESSAGE }, '关闭标记与根实例共用：关闭后作用域实例也必须快速失败')
})

// ── 共享同步面用例（两个实现都跑，组名 `sharedSync`，经 `assemble` 装配）。放在装配处是因为切分账 `CASE_LEDGER`
// 的 `sync.added` 为 0；前置状态只走端口（`seedSync` 调 putWorkspace / putProviderBinding），唯一的直连是原子性注入用的触发器。
// 原子性注入：SQLite 用触发器让 putMembership 的第三条语句 ABORT（前两条 DELETE 已执行，事务回滚是唯一防线）；
// 替身没有语句层，在它第一次状态赋值处注入（此时它还没有写入任何东西，断言检查的是同一可观察契约）。
// 判别性落在 SQLite——把 `atomic` 换回 `mutate` 后该用例变红。
const failFakeWrite = (storage) => { storage.data = new Proxy(storage.data, { set: (target, property, value) => { if (property === 'memberships') throw new Error('注入失败'); return Reflect.set(target, property, value) } }) }
const failSqliteInsert = (storage) => { const db = openDatabase(storage.location); try { db.exec("CREATE TRIGGER contract_break BEFORE INSERT ON project_item_membership BEGIN SELECT RAISE(ABORT, '注入失败'); END") } finally { db.close() } }
const seedSync = async (storage) => { await storage.putWorkspace(workspace('ws-1', '工作区')); await storage.putProviderBinding(bindingRecord('binding-1', 'ws-1')) }

// 组函数经 `assemble` 装配（第六轮评审 P2）：删掉任一装配或期望里的 `sharedSync`，装配守卫都会变红。
function sharedSyncSuite({ label, makeStorage, inject }, test) {
  // 观察的引用完整性（R4-2）：SQLite 的 sync_observation.binding_id 外键与替身的检查必须同语义。
  test(`${label}：观察的绑定必须存在，悬空绑定的观察必须被拒绝`, async () => {
    const storage = makeStorage(); await seedSync(storage)
    await assert.rejects(storage.recordObservation(observation('dangling-1', 'pending', { bindingId: 'binding-none', subject: { bindingId: 'binding-none', objectKind: 'issue', externalId: 'issue-1', url: undefined } })), '悬空绑定的观察必须被拒绝（与 SQLite 外键同语义）')
  })
  test(`${label}：成员关系写入中途失败时，旧成员关系与字段值必须整体保留（钉住 atomic）`, async () => {
    const storage = makeStorage(); await seedSync(storage)
    await storage.putMembership(membership()); await storage.putFieldValue(fieldValue())
    inject(storage); await assert.rejects(storage.putMembership(membership({ itemExternalId: 'item-2' })))
    assert.equal((await storage.getMembership(WORKSPACE, 'item-1'))?.contentExternalId, 'issue-1', '旧成员关系必须保留：前两条 DELETE 不得单独提交')
    assert.deepEqual(await storage.listFieldValues(WORKSPACE, 'item-1'), [fieldValue()], '旧条目上的字段值必须一起保留')
  })
  // 定序主体含 object_kind：draft 的首条观察只跟 draft 的已提交版本比，不跟 issue 的比。
  test(`${label}：同一 external_id 在 issue 与 draft 两个种类下各有自己的版本序列`, async () => {
    const storage = makeStorage(); await seedSync(storage)
    const at = (key, kind, version) => observation(key, 'pending', { subject: { bindingId: 'binding-1', objectKind: kind, externalId: 'shared-1', url: undefined }, sourceVersion: version, receivedTime: version })
    assert.equal(await storage.recordObservation(at('issue-new', 'issue', 'v3')), true)
    assert.equal(await storage.recordObservation(at('draft-old', 'draft', 'v1')), true, 'draft 比的是自己的种类，不是 issue 的已提交版本')
  })
  // 版本缺失（sourceVersion: undefined）在两个实现上必须给出同一答案：它是"没有版本"，不是"版本为空串"。
  // SQLite 侧 undefined 落成空串（updated_at 是 NOT NULL），读回时必须还原成 undefined 再比较；否则第二条
  // **合法**的新观察（不同 dedupeKey、版本同样缺失）会被判成乱序而静默丢弃。
  test(`${label}：两条 sourceVersion 缺失的观察（不同 dedupeKey）都必须被应用`, async () => {
    const storage = makeStorage(); await seedSync(storage)
    const at = (key, receivedTime) => observation(key, 'pending', { sourceVersion: undefined, receivedTime })
    assert.equal(await storage.recordObservation(at('undefined-1', '2026-09-20T00:00:01Z')), true, '第一条版本缺失的观察必须被应用')
    assert.equal(await storage.recordObservation(at('undefined-2', '2026-09-20T00:00:02Z')), true, '第二条版本同样缺失的**新**观察必须被应用，不得被判成乱序')
    assert.equal(await storage.recordObservation(at('undefined-1', '2026-09-20T00:00:01Z')), false, '已见 key 的重复投递仍必须被拒绝')
  })
  // 空串与 undefined 的区分（第四轮用例在 head 上就地订正）：capabilities 的 `isComparableSourceVersion` 现在
  // 明确把空串排除在合法载体之外（"undefined 是「没有版本」的唯一表达"），因此断言的是**入口拒绝空串**，
  // 而不是旧版"空串是合法载体、undefined 更旧"。判据仍是两个实现同语义，判别性在 SQLite 的入口检查。
  test(`${label}：空串不是合法版本载体，入口必须拒绝；undefined 是「没有版本」的唯一表达`, async () => {
    const storage = makeStorage(); await seedSync(storage)
    const at = (key, version, receivedTime) => observation(key, 'pending', { sourceVersion: version, receivedTime })
    await assert.rejects(storage.recordObservation(at('empty-1', '', '2026-09-20T00:00:01Z')), /ASCII/, '空串不是合法载体：capabilities 的 isComparableSourceVersion 必须拒绝它')
    assert.equal(await storage.recordObservation(at('missing-1', undefined, '2026-09-20T00:00:02Z')), true, 'undefined 表示「没有版本」，必须被应用')
  })

  // 观察与成员关系**解耦**（L3 的 003 把账本主体换成端口主体）：两个实现都必须接受没有成员关系的观察——
  // 对账先到、成员关系后到时，抛错或静默丢弃都会让"没落账"读成"没有这条事实"；而"换条目"改写的是当前
  // 挂载点，不得连带清掉只追加的账本，否则同一观察的第二次投递会重新返回 `true`，调用方据此重放副作用。
  test(`${label}：没有成员关系的观察必须被应用，换条目后再投递同一观察仍是 false`, async () => {
    const storage = makeStorage(); await seedSync(storage)
    const orphan = observation('orphan-1', 'pending', { subject: { bindingId: 'binding-1', objectKind: 'issue', externalId: 'issue-none', url: undefined } })
    assert.equal(await storage.recordObservation(orphan), true, '账本主体是端口主体：观察不解析落点，成员关系不存在也必须落账')
    assert.equal(await storage.recordObservation(orphan), false, '已见 key 的重复投递仍必须被拒绝')
    const known = observation('known-1', 'pending')
    assert.equal(await storage.recordObservation(known), true, '前置：成员关系出现之前的观察同样必须被应用')
    await storage.putMembership(membership())
    await storage.putMembership(membership({ itemExternalId: 'item-2' }))
    assert.equal(await storage.recordObservation(known), false, '换条目不得清掉账本：同一观察再投递仍必须返回 false')
  })

  // 去重的**绑定维度**：端口允许 provider 直接用平台事件 id 作 dedupeKey，两个绑定出现同一个 key 是合法的。
  test(`${label}：同一 dedupeKey 在两个绑定下是两条观察，都必须被应用`, async () => {
    const storage = makeStorage(); await seedSync(storage); await storage.putProviderBinding(developmentBinding('binding-2'))
    const at = (bindingId, dedupeKey) => observation(dedupeKey, 'pending', { bindingId, subject: { bindingId, objectKind: 'issue', externalId: 'issue-1', url: undefined } })
    assert.equal(await storage.recordObservation(at('binding-1', 'shared-key')), true)
    assert.equal(await storage.recordObservation(at('binding-2', 'shared-key')), true, '去重键的作用域是绑定：同一 key 在另一个绑定下必须被应用')
  })

  // 游标的两条父边（第四轮 R4-4 的三格之一）：替身补存在性检查后与 SQLite 的外键同语义。
  test(`${label}：悬空父行的同步游标与对账游标都必须被拒绝且不留行`, async () => {
    const storage = makeStorage(); await seedSync(storage)
    await assert.rejects(storage.putSyncCursor({ bindingId: 'binding-none', scopeKey: 'scope-1', cursorValue: 'cursor-1', state: 'healthy', lastErrorCode: undefined }), '同步游标必须挂在存在的连接锚点上')
    assert.equal(await storage.getSyncCursor('binding-none', 'scope-1'), undefined, '被拒绝的同步游标不得留下任何行')
    await assert.rejects(storage.putReconcileCursor({ workspaceId: 'ws-none', lastReconciledAt: '2026-09-20T00:00:00Z' }), '对账游标必须属于存在的工作区')
    assert.equal(await storage.getReconcileCursor('ws-none'), undefined, '被拒绝的对账游标不得留下任何行')
  })

  test(`${label}：同一工作区的对账游标第二次写入覆盖前值`, async () => {
    const storage = makeStorage(); await seedSync(storage)
    await storage.putReconcileCursor({ workspaceId: WORKSPACE, lastReconciledAt: '2026-09-20T00:00:00Z' })
    await storage.putReconcileCursor({ workspaceId: WORKSPACE, lastReconciledAt: '2026-09-21T00:00:00Z' })
    assert.equal((await storage.getReconcileCursor(WORKSPACE))?.lastReconciledAt, '2026-09-21T00:00:00Z', '同键第二次写入必须覆盖前值，而不是保留首行')
  })

  test(`${label}：成员关系的缺省时间戳读回是 undefined，不得泄漏 null`, async () => {
    const storage = makeStorage(); await seedSync(storage)
    await storage.putMembership(membership({ membershipCreatedAt: undefined, membershipUpdatedAt: undefined }))
    const found = await storage.getMembership(WORKSPACE, 'item-1')
    assert.equal(found?.membershipCreatedAt, undefined, '端口用 undefined 表示「没有这个值」：NULL 读回不得是 null')
    assert.equal(found?.membershipUpdatedAt, undefined)
    assert.ok(!Object.values(found ?? {}).includes(null), '端口记录里不得出现 null')
  })
}
