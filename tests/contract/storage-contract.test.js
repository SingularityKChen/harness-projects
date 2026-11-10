/** 内存 Storage 替身的契约套件装配，外加实现专属的判别性用例。`restart` 用导出/导入内部状态模拟重启——删掉导出实现后，套件里"换一个实例读同一份内容"必然失败。事务隔离（未提交的写入不得被事务外的读看到）与写者路径语义（重叠事务串行提交、在途事务不吞直接写入）对两个实现都成立，因此钉在共享地基组里（`suites/storage.js`），不在本文件重复。SQLite 专属的用例是 `close()`、"事务 work 里调外层实例"与结算令牌三条（都不是端口面）（内存替身没有 close，它的队列在 work 里调外层实例同样静默挂起——见本层计划遗留「跨实例自等的共享用例缺另一半」）。 */
import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { createFakeStorage, exportFakeStorageState, injectFakeStorageState, MemoryStorage, emptyStorageData } from '@harness-projects/provider-fake'
import { createSqliteStorage, openDatabase } from '@harness-projects/storage-sqlite'
import { storageSnapshotSuite } from './suites/storage-snapshots.js'
import { STORAGE_SUITE_GROUPS } from './suites/storage.js'
import { storageIdentityFoundationSuite, storageIdentitySyncSuite } from './suites/storage-identity-membership.js'
import { storageExecutionDivergenceSuite } from './suites/storage-execution.js'
import { developmentBinding, fieldValue, membership, observation, WORKSPACE } from './suites/storage-fixtures.js'

const workspace = (id, name) => ({ id, name, statusPolicy: 'provider_authoritative' })

const bindingRecord = (id, workspaceId) => ({ id, workspaceId, domain: 'planning', implementationKey: 'fake', enabled: true, isDefault: false })

const SUITE_GROUPS = { ...STORAGE_SUITE_GROUPS, identityFoundation: storageIdentityFoundationSuite, identitySync: storageIdentitySyncSuite, sharedSync: (adapter, register) => sharedSyncSuite(adapter, register) }
function assemble(adapter, groups) {
  for (const group of groups) SUITE_GROUPS[group](adapter, test)
}

// SQLite 适配器：L4 / #163 交付地基组与身份地基组，L5 / #164 补同步组与身份同步组，L6 / #120 补执行组（见下方
// 执行组装配）。`restart` 是真的关句柄再打开同一个文件。
const sqliteDir = mkdtempSync(join(tmpdir(), 'storage-sqlite-contract-'))
let sqliteCount = 0
after(() => rmSync(sqliteDir, { recursive: true, force: true }))
const restartSqlite = (storage) => { const location = storage.location; storage.close(); return createSqliteStorage(location) }
const sqliteAdapter = (label, prefix) => ({ label, makeStorage: (policy) => createSqliteStorage(join(sqliteDir, `${prefix}-${sqliteCount++}.sqlite`), policy), restart: restartSqlite })

assemble({ label: '内存 Storage 替身', makeStorage: () => createFakeStorage(),
  restart: (storage) => createFakeStorage(exportFakeStorageState(storage)), inject: (storage) => failFakeWrite(storage) },
  ['foundation', 'sync', 'execution', 'identityFoundation', 'identitySync', 'sharedSync'])
const foundationRuns = []
assemble({ ...sqliteAdapter('SQLite Storage（地基组）', 'storage'), foundationProbe: (storage) => foundationRuns.push(storage) }, ['foundation'])
after(async () => {
  assert.equal(foundationRuns.length, 1, 'SQLite foundation 的提交/回滚用例必须真实执行')
  const [{ storage, initialFence, committedFence }] = foundationRuns
  assert.equal((await storage.getWorkspace(WORKSPACE))?.name, '工作区')
  assert.equal(await storage.getWorkspace('ws-rolled-back'), undefined)
  assert.notEqual(committedFence, initialFence, '真实提交必须推进 fence')
  assert.equal(storage.committedReadFence(), committedFence, '回滚不得推进提交 fence')
})
assemble({ ...sqliteAdapter('SQLite Storage（同步组）', 'storage-sync'), inject: (storage) => failSqliteInsert(storage) }, ['sync', 'sharedSync'])
assemble(sqliteAdapter('SQLite Storage（身份地基组）', 'storage-identity'), ['identityFoundation'])
assemble(sqliteAdapter('SQLite Storage（身份同步组）', 'storage-identity-sync'), ['identitySync'])
// L6 / #120：执行面落地之后，SQLite 侧也注册执行组——执行面的 10 个方法第一次在 SQLite 上跑契约。
assemble(sqliteAdapter('SQLite Storage（执行组）', 'storage-execution'), ['execution'])

for (const adapter of [{ label: 'Fake isolation', makeStorage: (policy) => createFakeStorage(undefined, policy) }, sqliteAdapter('SQLite isolation', 'snapshot')]) storageSnapshotSuite(adapter)

// 仓库父边在两个适配器上都拒绝悬空引用，错误来源分别为替身存在性检查与 SQLite 外键。
const fakeDivergence = { label: '内存 Storage 替身（分叉格）', makeStorage: () => createFakeStorage(),
  acceptsDanglingCoreParents: { repository: false }, rejection: /^rejected: execution context repository does not exist/ }
const sqliteDivergence = { ...sqliteAdapter('SQLite Storage（分叉格）', 'storage-divergence'),
  acceptsDanglingCoreParents: { repository: false }, rejection: /^rejected: FOREIGN KEY constraint failed/ }
for (const adapter of [fakeDivergence, sqliteDivergence]) storageExecutionDivergenceSuite(adapter)

// 终态不是 active：`startWork` 的 `claimContext` 靠这条语义接管一条失败的上下文（issue #184）。
// 判据写在 `packages/capabilities/src/storage.ts` 的执行段；这里把它钉成可失败的断言。
test('内存 Storage 替身：Failed 与 Closed 不是 active，findActive 不返回它们', async () => {
  const storage = createFakeStorage()
  await storage.putWorkspace(workspace('ws-terminal'))
  // 执行上下文的父行只走端口建：仓库挂在存在的身份上（SQLite 的复合外键本来就要求它先登记）。
  await storage.putProviderBinding({ id: 'binding-terminal', workspaceId: 'ws-terminal', domain: 'development', implementationKey: 'fake', enabled: true, isDefault: true })
  await storage.putEntity({ id: 'repo-entity-terminal', kind: 'repository' })
  await storage.putExternalIdentity({ id: 'repo-identity-terminal', entityId: 'repo-entity-terminal', bindingId: 'binding-terminal', externalKind: 'repository', externalId: 'repo-1', role: 'primary' })
  await storage.putRepository({ id: 'repo-1', workspaceId: 'ws-terminal', externalIdentityId: 'repo-identity-terminal' })
  await storage.putEntity({ id: 'entity-terminal', kind: 'work_item' }) // 工作项父边（#196）：被引用的工作项必须已登记
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

const DUPLICATE_OBSERVATION = { state: 'pending', observation: { bindingId: 'binding-1', dedupeKey: 'dedupe-1', type: 'issue.updated', eventTime: undefined, receivedTime: '2026-09-20T00:00:01Z', subject: { bindingId: 'binding-1', objectKind: 'issue', externalId: 'issue-1', url: undefined }, sourceVersion: '2026-09-20T00:00:00.000000000Z', payloadHash: 'payload-hash', payload: {} } } // 与 suites/storage.js 同形状；同一 (binding, dedupeKey) 的第二次投递必须整笔 no-op

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

// ── 共享同步面用例（两个实现都跑，组名 `sharedSync`，经 `assemble` 装配）。
// 前置状态只走端口（`seedSync` 调 putWorkspace / putProviderBinding），唯一的直连是原子性注入用的触发器。
// 原子性注入：SQLite 用触发器让 putMembership 的第三条语句 ABORT（前两条 DELETE 已执行，事务回滚是唯一防线）；
// 替身没有语句层，在它第一次状态赋值处注入（此时它还没有写入任何东西，断言检查的是同一可观察契约）。
// 判别性落在 SQLite——把 `atomic` 换回 `mutate` 后该用例变红。
const failFakeWrite = (storage) => { injectFakeStorageState(storage, (data) => new Proxy(data, { set: (target, property, value) => { if (property === 'memberships') throw new Error('注入失败'); return Reflect.set(target, property, value) } })) }
const failSqliteInsert = (storage) => { const db = openDatabase(storage.location); try { db.exec("CREATE TRIGGER contract_break BEFORE INSERT ON project_item_membership BEGIN SELECT RAISE(ABORT, '注入失败'); END") } finally { db.close() } }
const seedSync = async (storage) => { await storage.putWorkspace(workspace('ws-1', '工作区')); await storage.putProviderBinding(bindingRecord('binding-1', 'ws-1')) }

// 共享同步套件由两个适配器分别注册。
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
    assert.equal(await storage.recordObservation(at('issue-new', 'issue', '2026-09-21T07:11:54.000000000Z')), true)
    assert.equal(await storage.recordObservation(at('draft-old', 'draft', '2026-09-21T07:10:00.000000000Z')), true, 'draft 比的是自己的种类，不是 issue 的已提交版本')
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

  test(`${label}：同步游标：同连接同scope跨workspace隔离`, async () => {
    const storage = makeStorage(); await seedSync(storage); await storage.putWorkspace(workspace('ws-b', '工作区B'))
    await storage.putProviderBinding(developmentBinding('binding-2'))
    const cursor = (workspaceId, overrides = {}) => ({ workspaceId, bindingId: 'binding-1', scopeKey: 'scope-1', cursorValue: `cursor-${workspaceId}`, state: 'healthy', lastErrorCode: undefined, ...overrides })
    const a = cursor('ws-1', { state: 'degraded', lastErrorCode: 'unavailable' }); const b = cursor('ws-b')
    await storage.putSyncCursor(a); await storage.putSyncCursor(b)
    assert.deepEqual(await storage.getSyncCursor('ws-1', 'binding-1', 'scope-1'), a, '同连接同 scope 在两个工作区是两条完整记录')
    assert.deepEqual(await storage.getSyncCursor('ws-b', 'binding-1', 'scope-1'), b)
    const rewritten = cursor('ws-1', { cursorValue: 'cursor-a2', state: 'failed', lastErrorCode: 'rate_limited' })
    await storage.putSyncCursor(rewritten)
    assert.deepEqual(await storage.getSyncCursor('ws-1', 'binding-1', 'scope-1'), rewritten, '同三元键重写只覆盖自己')
    assert.deepEqual(await storage.getSyncCursor('ws-b', 'binding-1', 'scope-1'), b, '另一个工作区的完整记录保持')
    await storage.putSyncCursor(cursor('ws-1', { scopeKey: 'scope-2' })); await storage.putSyncCursor(cursor('ws-1', { bindingId: 'binding-2' }))
    assert.deepEqual(await storage.getSyncCursor('ws-1', 'binding-1', 'scope-1'), rewritten, '同工作区另一个 scope 或另一个连接的写入互不覆盖')
    assert.equal((await storage.getSyncCursor('ws-1', 'binding-1', 'scope-2'))?.cursorValue, 'cursor-ws-1')
    assert.equal((await storage.getSyncCursor('ws-1', 'binding-2', 'scope-1'))?.bindingId, 'binding-2')
    assert.equal(await storage.getSyncCursor('ws-b', 'binding-1', 'scope-2'), undefined, '读取同样按工作区定位')
  })

  // 游标的父边（第四轮 R4-4 的三格之一，#189 补工作区）：两条外键各自独立，缺哪一条都必须被拒绝；它们只证明父行存在，不证明已挂载。
  test(`${label}：悬空父行的同步游标与对账游标都必须被拒绝且不留行`, async () => {
    const storage = makeStorage(); await seedSync(storage)
    const cursor = (overrides) => ({ workspaceId: WORKSPACE, bindingId: 'binding-1', scopeKey: 'scope-1', cursorValue: 'cursor-1', state: 'healthy', lastErrorCode: undefined, ...overrides })
    await assert.rejects(storage.putSyncCursor(cursor({ workspaceId: 'ws-none' })), '同步游标必须属于存在的工作区')
    assert.equal(await storage.getSyncCursor('ws-none', 'binding-1', 'scope-1'), undefined, '缺工作区被拒绝的同步游标不得留下任何行')
    await assert.rejects(storage.putSyncCursor(cursor({ bindingId: 'binding-none' })), '同步游标必须挂在存在的连接锚点上')
    assert.equal(await storage.getSyncCursor(WORKSPACE, 'binding-none', 'scope-1'), undefined, '缺连接被拒绝的同步游标不得留下任何行')
    await assert.rejects(storage.putReconcileCursor({ workspaceId: 'ws-none', lastReconciledAt: '2026-09-20T00:00:00Z' }), '对账游标必须属于存在的工作区')
    assert.equal(await storage.getReconcileCursor('ws-none'), undefined, '被拒绝的对账游标不得留下任何行')
    await storage.putSyncCursor(cursor({}))
    assert.equal((await storage.getSyncCursor(WORKSPACE, 'binding-1', 'scope-1'))?.cursorValue, 'cursor-1', '父行登记后可重试')
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


test('内存映射快照导入拒绝非法来源或悬空挂载', async () => {
  const storage = createFakeStorage(); await seedSync(storage)
  await storage.putWorkspacePlanningMapping({ workspaceId: 'ws-1', bindingId: 'binding-1', projectExternalId: 'p', origin: 'user', mapping: {} })
  const state = exportFakeStorageState(storage)
  for (const patch of [{ origin: 'guessed' }, { bindingId: 'missing' }]) {
    const invalid = structuredClone(state); Object.assign(invalid.planningMappings[0], patch)
    assert.throws(() => createFakeStorage(invalid))
  }
  const missingWorkspace = structuredClone(state); missingWorkspace.workspaces = []
  assert.throws(() => createFakeStorage(missingWorkspace))
})


test('内存映射快照导入拒绝同一工作区的第二份权威配置', async () => {
  const storage = createFakeStorage(); await seedSync(storage)
  const record = { workspaceId: 'ws-1', bindingId: 'binding-1', projectExternalId: 'p', origin: 'derived', mapping: {} }
  await storage.putWorkspacePlanningMapping(record)
  const state = exportFakeStorageState(storage)
  for (const duplicate of [record, { ...record, origin: 'user', mapping: { iterationFieldId: 'iteration' } }]) {
    const invalid = structuredClone(state); invalid.planningMappings.push(duplicate)
    assert.throws(() => createFakeStorage(invalid), { name: 'RangeError', message: 'workspace planning mapping is already registered' })
  }
  assert.deepEqual(await createFakeStorage(state).getWorkspacePlanningMapping('ws-1'), record)
})

test('MemoryStorage 公开 constructor 捕获 seed，事务提交/回滚拥有独立状态', async () => {
  const data = emptyStorageData(); data.workspaces.push(workspace('seed', 'original'))
  const storage = new MemoryStorage(data), initialFence = storage.committedReadFence()
  data.workspaces[0].name = 'escaped'; assert.equal((await storage.getWorkspace('seed')).name, 'original'); assert.equal(storage.committedReadFence(), initialFence)
  await storage.putWorkspace(workspace('direct', 'direct')); assert.equal(data.workspaces.length, 1, '普通写入不能回写 caller seed')
  await storage.transaction(async (tx) => { await tx.putWorkspace(workspace('committed', 'commit')); await tx.advanceRevision('committed') })
  assert.equal((await storage.getWorkspace('committed')).name, 'commit'); assert.equal(await storage.currentRevision('committed'), 1)
  const committedFence = storage.committedReadFence()
  await assert.rejects(storage.transaction(async (tx) => { await tx.putWorkspace(workspace('rolled-back')); await tx.advanceRevision('committed'); throw Error('rollback') }), /rollback/)
  assert.equal(await storage.getWorkspace('rolled-back'), undefined); assert.equal(await storage.currentRevision('committed'), 1); assert.equal(storage.committedReadFence(), committedFence)
  assert.notEqual(committedFence, initialFence); assert.equal(data.workspaces.length, 1)
})
test('Fake constructor 与 factory 在克隆前校验原始导入记录', async () => {
  const p = { allowedSecretHandles: new Set(), configurations: new Map([['harness.fake', {}]]) }, source = createFakeStorage(undefined, p)
  await source.putWorkspace(workspace('seed')); await source.putProviderBinding({ id: 'seed-binding', workspaceId: 'seed', domain: 'planning', implementationKey: 'harness.fake', enabled: true, isDefault: true })
  const base = exportFakeStorageState(source), ref = { workspaceId: 'seed', bindingId: 'seed-binding', domain: 'planning' }
  const badConfigurations = [Object.assign(Object.create({}), {}), Object.defineProperty({}, Symbol('forbidden'), { value: true })]
  for (const construct of [(data) => new MemoryStorage(data, false, p), (data) => createFakeStorage(data, p)]) {
    for (const configuration of badConfigurations) assert.throws(() => construct({ ...base, bindingConfigurations: [{ ref, configuration }] }), /plain object/)
    const externalIntent = { operation: 'addChangeRequestAssignees', sequence: 1, createOperationId: 'create', createReceipt: 'receipt', targetStamp: 'stamp', contextId: 'ctx', ownerGeneration: 1, bindingId: 'seed-binding', state: 'pending', worktree: 'worktree', input: { repository: { bindingId: 'seed-binding', objectKind: 'repository', externalId: 'repo' }, changeRequest: { bindingId: 'seed-binding', objectKind: 'change_request', externalId: 'pr' }, assigneeIds: ['U_1'] }, confirmedIds: [] }
    Object.defineProperty(externalIntent, Symbol('forbidden'), { value: true })
    assert.throws(() => construct({ ...base, attempts: [{ id: 'a', workspaceId: 'seed', bindingId: 'seed-binding', commandName: 'addChangeRequestAssignees', idempotencyKey: 'key', state: 'pending', requestFingerprint: 'fp', externalIntent }] }), /invalid Start Work external intent/)
    const account = Object.assign(Object.create({}), { id: 'account', platformFamily: 'github', platformOrigin: 'https://github.com', identityKind: 'account', externalId: 'user', displayName: 'name', secretHandle: undefined, connectionState: 'connected' })
    assert.throws(() => construct({ ...base, accounts: [account] }), /connector account must be a plain object/)
    assert.throws(() => construct({ ...base, planningMappings: [Object.assign(Object.create({}), { workspaceId: 'seed', bindingId: 'seed-binding', projectExternalId: 'project', origin: 'user', mapping: {} })] }), /invalid workspace planning mapping/)
  }
})
