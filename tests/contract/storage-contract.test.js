/** 内存 Storage 替身的契约套件装配，外加判别性用例。`restart` 用导出/导入内部状态模拟重启——删掉导出实现后，套件里"换一个实例读同一份内容"必然失败。额外用例保护事务隔离：未提交的写入在事务外读不到，否则回滚就只是假象；重叠事务必须串行，否则后提交者会用旧快照覆盖先提交者已确认的写入。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeStorage, exportFakeStorageState } from '@harness-projects/provider-fake'
import { storageContractSuite } from './suites/storage.js'
import { storageIdentityFoundationSuite, storageIdentitySyncSuite } from './suites/storage-identity-membership.js'

const workspace = (id, name) => ({ id, name, statusPolicy: 'provider_authoritative' })

const fake = { label: '内存 Storage 替身', makeStorage: () => createFakeStorage(),
  restart: (storage) => createFakeStorage(exportFakeStorageState(storage)) }
// 身份与成员关系面：替身两组都跑；SQLite 侧的地基组在 L4 注册、同步组在 L5/L6 注册（见该文件头注释）。
storageContractSuite(fake)
storageIdentityFoundationSuite(fake)
storageIdentitySyncSuite(fake)

test('内存 Storage 替身：事务未提交前外部读不到写入，提交后才可见', async () => {
  const storage = createFakeStorage()
  let seenInside
  await storage.transaction(async (tx) => {
    await tx.putWorkspace({ id: 'ws-1', name: '工作区', statusPolicy: 'provider_authoritative' })
    seenInside = await storage.getWorkspace('ws-1')
  })
  assert.equal(seenInside, undefined, '未提交的写入不得被事务外读到')
  assert.equal((await storage.getWorkspace('ws-1'))?.name, '工作区')
})

// 终态不是 active：`startWork` 的 `claimContext` 靠这条语义接管一条失败的上下文（issue #184）。
// 判据写在 `packages/capabilities/src/storage.ts` 的执行段；这里把它钉成可失败的断言。
test('内存 Storage 替身：Failed 与 Closed 不是 active，findActive 不返回它们', async () => {
  const storage = createFakeStorage()
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

// 确定性重叠：T1 在事务内挂起（此时尚未提交），T2 随即开始，然后才放行 T1。
// 修复前两者各自克隆同一份空快照，后提交者整体替换，先提交者的写入必然消失。
test('内存 Storage 替身：在途事务提交后保留直接写入', { timeout: 5000 }, async () => {
  const storage = createFakeStorage()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const transaction = storage.transaction(async (tx) => {
    await tx.putWorkspace(workspace('ws-t1', 'T1'))
    await gate
  })
  await new Promise((resolve) => setImmediate(resolve))
  const direct = storage.putWorkspace(workspace('ws-direct', '直接写入'))
  release()
  await Promise.all([transaction, direct])

  assert.equal((await storage.getWorkspace('ws-t1'))?.name, 'T1')
  assert.equal((await storage.getWorkspace('ws-direct'))?.name, '直接写入')
})

test('内存 Storage 替身：重叠事务串行提交，已确认的写入不被后来者覆盖', { timeout: 5000 }, async () => {
  const storage = createFakeStorage()
  let markSuspended
  const suspended = new Promise((resolve) => { markSuspended = resolve })
  let release
  const gate = new Promise((resolve) => { release = resolve })

  const first = storage.transaction(async (tx) => {
    await tx.putWorkspace(workspace('ws-t1', 'T1'))
    markSuspended()
    await gate
  })
  await suspended
  const second = storage.transaction((tx) => tx.putWorkspace(workspace('ws-t2', 'T2')))
  release()
  await Promise.all([first, second])

  assert.equal((await storage.getWorkspace('ws-t1'))?.name, 'T1')
  assert.equal((await storage.getWorkspace('ws-t2'))?.name, 'T2', 'T2 已确认的写入不得被 T1 的提交覆盖')
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
