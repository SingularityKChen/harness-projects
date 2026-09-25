// 集成层：Storage 端口的文件库重启用例（`tests/integration/README.md` 的 "restart restore" 与
// "rollback on failed transaction"）。"重启"是真的关掉句柄再打开同一个文件，不是内存导出/导入——
// #5 的重启判据只有在文件上才成立。每个用例一个临时目录，用例之间不共享状态。

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { MIGRATIONS, createSqliteStorage, migrate, openDatabase } from '@harness-projects/storage-sqlite'

/** 每个用例一个临时目录，结束时删除。必须 await 用例体：直接 `return run(dir)` 会在异步体跑完之前就删掉目录。 */
async function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'storage-restart-'))
  try { return await run(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

const WORKSPACE = 'ws-1'
const workspace = { id: WORKSPACE, name: '工作区', statusPolicy: 'provider_authoritative' }
const binding = { id: 'binding-1', workspaceId: WORKSPACE, domain: 'planning', implementationKey: 'fake', enabled: true, isDefault: true }
const identity = { id: 'identity-1', entityId: 'entity-1', bindingId: 'binding-1', externalKind: 'issue', externalId: 'issue-1', role: 'primary' }
const projection = { workspaceId: WORKSPACE, entityId: 'entity-1', planningStatus: 'in_progress', revision: 3,
  content: { contentKind: 'change_request', number: 42, title: '标题', body: '正文' } }

test('重启：端口写入的工作区/绑定/实体/身份/投影/仓库/修订号在关句柄重开后逐字段不变', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    await storage.putWorkspace(workspace)
    await storage.putProviderBinding(binding)
    await storage.putEntity({ id: 'entity-1', kind: 'work_item' })
    await storage.putExternalIdentity(identity)
    await storage.putPlanningProjection(WORKSPACE, projection)
    await storage.putRepository({ id: 'repo-1', workspaceId: WORKSPACE, externalIdentityId: 'identity-1' })
    await storage.advanceRevision(WORKSPACE)
    await storage.advanceRevision(WORKSPACE)
    storage.close()

    const revived = createSqliteStorage(location)
    try {
      assert.deepEqual(await revived.getWorkspace(WORKSPACE), workspace, '工作区逐字段不变')
      assert.deepEqual(await revived.listProviderBindings(WORKSPACE), [binding], '绑定（含默认标记）逐字段不变')
      assert.deepEqual(await revived.listIdentitiesForEntity('entity-1'), [identity], '身份逐字段不变')
      assert.deepEqual(await revived.findExternalIdentity('binding-1', 'issue', 'issue-1'), identity, '身份按对象键仍可查到')
      assert.deepEqual(await revived.getPlanningProjection(WORKSPACE, 'entity-1'), projection, '投影（含内容三态）逐字段不变')
      assert.deepEqual(await revived.listPlanningProjections(WORKSPACE), [projection], '投影集合不变')
      assert.deepEqual(await revived.listRepositories(WORKSPACE), [{ id: 'repo-1', workspaceId: WORKSPACE, externalIdentityId: 'identity-1' }], '仓库逐字段不变')
      assert.equal(await revived.currentRevision(WORKSPACE), 2, '修订号不倒退也不归零')
    } finally {
      revived.close()
    }
  })
})

test('重启：失败事务的半写行在重开后读不到', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    await storage.transaction((tx) => tx.putWorkspace({ ...workspace, id: 'ws-committed', name: '已提交' }))
    await assert.rejects(storage.transaction(async (tx) => {
      await tx.putWorkspace({ ...workspace, id: 'ws-rolled-back', name: '不该存在' })
      throw new Error('事务内失败')
    }), /事务内失败/)
    storage.close()

    const revived = createSqliteStorage(location)
    try {
      assert.equal(await revived.getWorkspace('ws-rolled-back'), undefined, '抛错事务的写入必须整体回滚，重开句柄后不得留下半写行')
      assert.equal((await revived.getWorkspace('ws-committed'))?.name, '已提交', '同一句柄上更早提交的事务不受影响')
    } finally {
      revived.close()
    }
  })
})

test('重启：对同一个已迁移的文件再跑迁移是 no-op', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    await storage.putWorkspace(workspace); storage.close() // #163 验收 6：迁移重跑之前必须有一次经端口的写入

    const db = openDatabase(location)
    try {
      const result = migrate(db)
      assert.deepEqual(result.applied, [], '已应用过的版本不得重放')
      assert.equal(result.version, MIGRATIONS.at(-1)?.version, '版本停在清单最后一个迁移上')
    } finally {
      db.close()
    }
    const reopened = createSqliteStorage(location); try { assert.deepEqual(await reopened.getWorkspace(WORKSPACE), workspace, '迁移重跑不得改动端口写过的行') } finally { reopened.close() }
  })
})

// 判别性：`replacePlanningProjections` 是多语句写入（先收敛 DELETE、再逐条 UPSERT），必须整体落在一个原子作用域里。
// 根实例上走 `mutate` 时，items 的外键失败会留下"旧行已删、新行没写"的半写状态；走 `atomic` 则整体回滚。
test('重启：replacePlanningProjections 因外键失败时原有投影一行未变', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    // 前置状态只走端口：工作区 / 绑定 / 实体 / 身份 / 投影。
    await storage.putWorkspace(workspace)
    await storage.putProviderBinding(binding)
    await storage.putEntity({ id: 'entity-1', kind: 'work_item' })
    await storage.putExternalIdentity(identity)
    await storage.putPlanningProjection(WORKSPACE, projection)
    // items 指向一个不存在的实体：UPSERT 撞 `workspace_projection.entity_id` 的外键；收敛 DELETE 已经在同一次调用里跑过。
    await assert.rejects(storage.replacePlanningProjections({ workspaceId: WORKSPACE, bindingId: 'binding-1' },
      [{ ...projection, entityId: 'entity-missing', revision: 9 }]))
    assert.deepEqual(await storage.listPlanningProjections(WORKSPACE), [projection], '失败前已存在的投影不得被收敛 DELETE 带走')
    storage.close()

    const revived = createSqliteStorage(location)
    try {
      assert.deepEqual(await revived.listPlanningProjections(WORKSPACE), [projection], '重开句柄后也不得有半写行')
    } finally {
      revived.close()
    }
  })
})
