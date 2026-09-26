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
// 执行面的夹具（Batch L6）：执行上下文 / 运行 / 关系（确认 + 候选）/ 写尝试，字段刻意全部取具体值，
// 让"逐字段不变"能分辨任何一列被丢掉——可选列取 `undefined` 与取值各出现一次。
const context = { id: 'context-1', workspaceId: WORKSPACE, workItemId: 'entity-1', repositoryId: 'repo-1', status: 'ready',
  branchExternalId: 'branch-1', worktreeExternalId: 'worktree-1', provisioningStartedAt: '2026-09-20T00:00:00Z' }
const run = { id: 'run-1', workspaceId: WORKSPACE, contextId: 'context-1', status: 'running', updatedAt: '2026-09-20T00:00:02Z' }
const confirmedRelation = { from: 'entity-1', to: 'entity-2', type: 'depends_on', class: 'business_semantics', source: 'explicit', state: 'confirmed' }
const candidateRelation = { from: 'entity-2', to: 'entity-1', type: 'relates_to', class: 'business_semantics', source: 'deterministic', state: 'candidate' }
const attempt = { id: 'attempt-1', workspaceId: WORKSPACE, bindingId: 'binding-1', commandName: 'updatePlanningFields',
  idempotencyKey: 'key-1', state: 'unknown', expectedSourceVersion: 'v1', errorCode: 'permission_denied' }
// 可选列**未设置**的夹具（Batch L6 收口）：执行上下文的三列与写尝试的两列都取 `undefined`。端口用 `undefined` 表示
// "没有这个值"，SQLite 用 NULL；行映射必须把 NULL 还原成 `undefined`，不能让 `null` 漏到端口——`deepEqual` 分得清两者。
// 执行面里只有这两张表有可选列：`ExecutionRunRecord` 的 `status` / `updatedAt` 都是必填（没有 NULL 可断言，逐字段
// 一致性由下面第 2 条用例的 `run` 夹具钉住）。
const bareContext = { id: 'context-2', workspaceId: WORKSPACE, workItemId: 'entity-1', repositoryId: 'repo-1', status: 'planned',
  branchExternalId: undefined, worktreeExternalId: undefined, provisioningStartedAt: undefined }
const bareAttempt = { id: 'attempt-2', workspaceId: WORKSPACE, bindingId: 'binding-1', commandName: 'updatePlanningFields',
  idempotencyKey: 'key-2', state: 'failed', expectedSourceVersion: undefined, errorCode: undefined }

/** 执行面用例的公共前置行：执行上下文以外键指向工作区、实体与仓库，关系两端指向实体，写尝试指向工作区与绑定。 */
async function seedExecutionFacts(storage) {
  await storage.putWorkspace(workspace)
  await storage.putProviderBinding(binding)
  await storage.putEntity({ id: 'entity-1', kind: 'work_item' })
  await storage.putEntity({ id: 'entity-2', kind: 'work_item' })
  await storage.putExternalIdentity(identity)
  await storage.putRepository({ id: 'repo-1', workspaceId: WORKSPACE, externalIdentityId: 'identity-1' })
}

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

test('重启：关系（确认 + 候选）与执行上下文/运行/写尝试在关句柄重开后逐字段不变', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    await seedExecutionFacts(storage)
    await storage.putExecutionContext(context)
    await storage.putExecutionRun(run)
    await storage.putRelation(WORKSPACE, confirmedRelation)
    await storage.putRelation(WORKSPACE, candidateRelation)
    await storage.putMutationAttempt(attempt)
    storage.close()

    const revived = createSqliteStorage(location)
    try {
      assert.deepEqual(await revived.getExecutionContext('context-1'), context, '执行上下文逐字段不变（含可选列）')
      assert.deepEqual(await revived.findActiveExecutionContext(WORKSPACE, 'entity-1', 'repo-1'), context, 'active 上下文按 (工作项, 仓库) 仍可查到')
      assert.deepEqual(await revived.getExecutionRun('run-1'), run, '执行运行逐字段不变')
      // 关系分表存放，重启后**两张表的内容都在**：候选没有被读路径丢掉，也没有被升级成确认。
      const relations = await revived.listRelations(WORKSPACE)
      assert.equal(relations.length, 2, '确认与候选各一条')
      assert.deepEqual(relations.find((item) => item.state === 'confirmed'), confirmedRelation, '确认关系逐字段不变')
      assert.deepEqual(relations.find((item) => item.state === 'candidate'), candidateRelation, '候选关系逐字段不变（候选表也要落库）')
      assert.deepEqual(await revived.listRelations('ws-other'), [], '关系按工作区隔离')
      assert.deepEqual(await revived.findMutationAttempt(WORKSPACE, 'key-1'), attempt, '写尝试逐字段不变（含可空的版本与错误码）')
      assert.deepEqual(await revived.listMutationAttempts(WORKSPACE), [attempt], '写尝试集合不变')
    } finally {
      revived.close()
    }
  })
})

test('重启：未设置的可选列读回严格 === undefined（不是 null），逐字段写清', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    await seedExecutionFacts(storage)
    await storage.putExecutionContext(bareContext)
    await storage.putMutationAttempt(bareAttempt)
    storage.close()

    const revived = createSqliteStorage(location)
    try {
      const storedContext = await revived.getExecutionContext('context-2')
      // 逐列严格断言：`assert/strict` 的 `equal` 是 `===`，NULL 读成 `null` 时这一条就红。
      for (const field of ['branchExternalId', 'worktreeExternalId', 'provisioningStartedAt']) {
        assert.equal(storedContext[field], undefined, `执行上下文的 ${field} 未设置时必须严格 === undefined，不得是 null`)
      }
      // deepEqual 逐字段写清：可选键以 `undefined` 出现，与"键不存在"和"值是 null"都不同（`deepEqual` 在 strict 下是 deepStrictEqual）。
      assert.deepEqual(storedContext, { id: 'context-2', workspaceId: WORKSPACE, workItemId: 'entity-1', repositoryId: 'repo-1',
        status: 'planned', branchExternalId: undefined, worktreeExternalId: undefined, provisioningStartedAt: undefined },
        '执行上下文未设置的可选列逐字段写清：只以 undefined 出现')

      const storedAttempt = await revived.findMutationAttempt(WORKSPACE, 'key-2')
      for (const field of ['expectedSourceVersion', 'errorCode']) {
        assert.equal(storedAttempt[field], undefined, `写尝试的 ${field} 未设置时必须严格 === undefined，不得是 null`)
      }
      assert.deepEqual(storedAttempt, { id: 'attempt-2', workspaceId: WORKSPACE, bindingId: 'binding-1', commandName: 'updatePlanningFields',
        idempotencyKey: 'key-2', state: 'failed', expectedSourceVersion: undefined, errorCode: undefined },
        '写尝试未设置的可选列逐字段写清：只以 undefined 出现')
      assert.deepEqual(await revived.listMutationAttempts(WORKSPACE), [bareAttempt], '集合读路径同样只给 undefined，不给 null')
    } finally {
      revived.close()
    }
  })
})

/**
 * F3（L6 评审）：强制关闭 active 上下文时，实现必须把 `provisioning_started_at` 一起清掉——端口契约
 * （`packages/capabilities/src/storage.ts` 的 `ExecutionContextRecord`）写明该列"终态为 undefined"，而终态是
 * **实现**产生的状态迁移。共享契约用例只断言端口的读回值，这条进一步断言**库层那一列真的是 NULL**：
 * 否则"在读映射里把 closed 行的这一列藏掉"也能骗过端口断言。
 */
test('重启：强制关闭 active 上下文时 provisioning_started_at 在库层被清成 NULL', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    await seedExecutionFacts(storage)
    await storage.putExecutionContext({ ...context, id: 'context-closing', status: 'provisioning' })
    await storage.putExecutionContext(bareContext)
    storage.close()

    const db = openDatabase(location)
    try {
      const row = db.prepare('SELECT status, provisioning_started_at FROM execution_context WHERE id = ?').get('context-closing')
      assert.equal(row.status, 'closed', '写入第二个 active 必须把同键旧 active 置为 closed')
      assert.equal(row.provisioning_started_at, null, '终态行的认领时间必须在库层被清成 NULL，而不是只被读映射藏起来')
    } finally {
      db.close()
    }

    const revived = createSqliteStorage(location)
    try {
      assert.equal((await revived.getExecutionContext('context-closing'))?.provisioningStartedAt, undefined, '重开后端口读回仍是 undefined（NULL 还原成 undefined）')
      assert.equal((await revived.getExecutionContext('context-2'))?.provisioningStartedAt, undefined, '未被强制关闭的行不受影响')
    } finally {
      revived.close()
    }
  })
})

test('重启：同幂等键经端口重放是幂等覆盖，账上只有一行', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    await seedExecutionFacts(storage)
    await storage.putMutationAttempt(attempt)
    // 同键第二次写入（换 id、换状态、去掉可空的错误码）：模型是**一行一键**（003 的主键是 `(workspace_id, idempotency_key)`），
    // 因此后写的状态取代先写的，而不是"保留首次结果"。
    const replay = { ...attempt, id: 'attempt-replay', state: 'saved', errorCode: undefined }
    await storage.putMutationAttempt(replay)
    assert.deepEqual(await storage.findMutationAttempt(WORKSPACE, 'key-1'), replay, '同键重放是幂等覆盖：读到的是最后一次写入的状态')
    assert.deepEqual(await storage.listMutationAttempts(WORKSPACE), [replay], '同幂等键只有一行，覆盖不追加第二行')
    storage.close()

    const revived = createSqliteStorage(location)
    try {
      assert.deepEqual(await revived.findMutationAttempt(WORKSPACE, 'key-1'), replay, '重开后读到的仍是覆盖后的那一行')
      assert.deepEqual(await revived.listMutationAttempts(WORKSPACE), [replay], '重开后账上仍只有一行')
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

test('重启：对端口写过的库再跑迁移是 no-op，既有行不被触碰', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    await seedExecutionFacts(storage)
    await storage.putExecutionContext(context)
    await storage.putRelation(WORKSPACE, confirmedRelation)
    await storage.putMutationAttempt(attempt)
    storage.close()

    const db = openDatabase(location)
    try {
      const result = migrate(db)
      assert.deepEqual(result.applied, [], '库里有端口写入的行时，迁移仍不得重放任何版本')
      assert.equal(result.version, MIGRATIONS.at(-1)?.version, '版本停在清单最后一个迁移上')
    } finally {
      db.close()
    }

    const revived = createSqliteStorage(location)
    try {
      assert.deepEqual(await revived.getExecutionContext('context-1'), context, '再跑迁移不得触碰端口写过的执行上下文')
      assert.deepEqual(await revived.listRelations(WORKSPACE), [confirmedRelation], '再跑迁移不得触碰端口写过的关系')
      assert.deepEqual(await revived.findMutationAttempt(WORKSPACE, 'key-1'), attempt, '再跑迁移不得触碰端口写过的写尝试')
    } finally {
      revived.close()
    }
  })
})

// 判别性：`replacePlanningProjections` 是多语句写入（先收敛 DELETE、再逐条 UPSERT），必须整体落在一个原子作用域里。
// 根实例上走 `mutate` 时，items 的外键失败会留下"旧行已删、新行没写"的半写状态；走 `atomic` 则整体回滚。
// （第五轮评审 P1：第四轮的级联把这条用例连同 `atomic` 一起删掉了，本用例从 L5 head `d84bc16` 原样恢复。）
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

/**
 * 多语句写入必须整体生效（第五轮评审 P2）：`putExecutionContext` 先关同键旧 active、再 UPSERT 新行。根实例上
 * 走 `mutate` 时第二条语句撞外键会留下"旧 active 已关、新行没写"的半写；走 `atomic` 则整体回滚。
 */
test('重启：putExecutionContext 因外键失败时旧 active 上下文不得被关闭', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    await seedExecutionFacts(storage)
    await storage.putExecutionContext({ ...context, id: 'context-1', status: 'provisioning' })
    // 另一个工作区里的同 id 上下文挂着一个运行：把它挪进 ws-1 会让运行的复合外键 (workspace_id, context_id) 悬空。
    await storage.putWorkspace({ id: 'ws-other', name: '另一个工作区', statusPolicy: 'provider_authoritative' })
    await storage.putEntity({ id: 'repo-entity-other', kind: 'repository' })
    await storage.putExternalIdentity({ id: 'repo-identity-other', entityId: 'repo-entity-other', bindingId: 'binding-1', externalKind: 'branch', externalId: 'repo-other', role: 'primary' })
    await storage.putRepository({ id: 'repo-other', workspaceId: 'ws-other', externalIdentityId: 'repo-identity-other' })
    await storage.putExecutionContext({ ...context, id: 'ctx-shared', workspaceId: 'ws-other', repositoryId: 'repo-other' })
    await storage.putExecutionRun({ id: 'run-o', workspaceId: 'ws-other', contextId: 'ctx-shared', status: 'running', updatedAt: '2026-09-20T00:00:02Z' })
    // 第一条 UPDATE 关掉 context-1；第二条 UPSERT 把 ctx-shared 挪进 ws-1，run-o 的父键随之悬空 → 外键失败。
    await assert.rejects(storage.putExecutionContext({ ...context, id: 'ctx-shared', workspaceId: WORKSPACE, repositoryId: 'repo-1' }), /FOREIGN KEY/)
    const survivor = await storage.getExecutionContext('context-1')
    assert.equal(survivor?.status, 'provisioning', '第一条语句关掉的旧 active 必须随事务回滚')
    assert.equal(survivor?.provisioningStartedAt, '2026-09-20T00:00:00Z', '旧 active 的认领时间不得被连带清掉')
    assert.equal((await storage.findActiveExecutionContext(WORKSPACE, 'entity-1', 'repo-1'))?.id, 'context-1', '旧 active 仍是 active')
    storage.close()

    const revived = createSqliteStorage(location)
    try {
      assert.equal((await revived.getExecutionContext('context-1'))?.status, 'provisioning', '重开句柄后也没有半写行')
      assert.deepEqual(await revived.getExecutionContext('ctx-shared'), { ...context, id: 'ctx-shared', workspaceId: 'ws-other', repositoryId: 'repo-other' }, '被拒绝的搬迁不得改动另一个工作区的行')
    } finally {
      revived.close()
    }
  })
})

/**
 * `putRelation` 的确认分支同样是多语句（先写 confirmed、再删候选行）。自然状态下第二条 DELETE 不会失败，因此
 * 用例装一个 `BEFORE DELETE` 触发器把第二条语句变成失败：走 `mutate` 时已写的 confirmed 行会留下（confirmed
 * 与候选同时存在，正是"候选升确认"的半写形态），走 `atomic` 时整体回滚。
 */
test('重启：putRelation 删候选行失败时已确认行不得落库', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    await seedExecutionFacts(storage)
    await storage.putRelation(WORKSPACE, candidateRelation)
    // 注入：让第二条语句（DELETE candidate_relation）失败。
    const inject = openDatabase(location)
    inject.exec("CREATE TRIGGER fail_candidate_delete BEFORE DELETE ON candidate_relation BEGIN SELECT RAISE(ABORT, '注入的删除失败'); END")
    inject.close()
    await assert.rejects(storage.putRelation(WORKSPACE, { ...candidateRelation, source: 'explicit', state: 'confirmed' }), /注入的删除失败/)
    assert.deepEqual(await storage.listRelations(WORKSPACE), [candidateRelation], '第一条语句写的 confirmed 行必须随事务回滚，候选行原样保留')
    const cleanup = openDatabase(location)
    cleanup.exec('DROP TRIGGER fail_candidate_delete')
    cleanup.close()
    storage.close()

    const revived = createSqliteStorage(location)
    try {
      assert.deepEqual(await revived.listRelations(WORKSPACE), [candidateRelation], '重开句柄后也不得有半写行')
    } finally {
      revived.close()
    }
  })
})
