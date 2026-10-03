/**
 * 执行组：执行上下文与运行、关系、写尝试。两个实现（内存替身与 SQLite）都跑本组——SQLite 侧由
 * `tests/contract/storage-contract.test.js` 的装配注册（L6 起；身份面另有两组）。
 *
 * 引用完整性的**实测清单**（2026-09-26 第五轮评审）——已对齐的父边与枚举，每条都有下面的共享用例钉住：
 *   父边：`repository.externalIdentityId`、`execution_context.workspaceId`、`execution_run` 的
 *   `(workspaceId, contextId)` 复合键（上下文必须在同一工作区）、`mutation_attempt.workspaceId` + `bindingId`、`relation.workspaceId`、`observation.bindingId`；
 *   枚举：执行上下文状态、执行运行状态、写尝试状态、候选关系的来源（candidate 不得 explicit）。
 * `execution_context.workItemId` 已对齐（#196）：两个实现都以同一个 `StorageInputError` 拒绝，共享用例见下方"未登记工作项以同结构拒绝"。
 * **依赖 core 的两格**见本文件末尾的 `storageExecutionDivergenceSuite`（按适配器、按边的能力位
 * `acceptsDanglingCoreParents` 断言"这一格当前接受还是拒绝"）：
 *   - `execution_context.repositoryId`：已对齐——core 的写前登记先建仓库挂载再写上下文（#187 / #188），替身与 SQLite 都拒绝；
 *   - relation 两端点：仍分叉，Start Work 的 tracks / has_worktree 端点已由 core 写前登记，其余谱系写者仍写未登记的实体（#221）。
 * 仍分叉的一格等 core 侧收口后把替身对齐、共享用例从"分叉"改成"拒绝"；能力位与替身注释同批改。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { StorageInputError } from '@harness-projects/capabilities'

import { binding, seedWorkspace, WORKSPACE } from './storage-fixtures.js'

/**
 * 执行组的父行前置：**只走端口**（装配处没有裸 SQL，两个实现因此看到同一份前置状态），SQLite 侧由 003 的
 * 外键强制，内存替身侧没有外键、父边检查只能自己写（L6 评审 F1），因此**两个实现**都需要这些行存在才能写入
 * 执行面事实。重复播种是幂等的（都是 UPSERT）。
 */
export async function seedExecutionPrereqs(storage) {
  await storage.putWorkspace({ id: WORKSPACE, name: '工作区', statusPolicy: 'provider_authoritative' })
  await storage.putWorkspace({ id: 'ws-other', name: '另一个工作区', statusPolicy: 'provider_authoritative' })
  await storage.putProviderBinding({ id: 'binding-1', workspaceId: WORKSPACE, domain: 'planning', implementationKey: 'fake', enabled: true, isDefault: false })
  await storage.putEntity({ id: 'entity-1', kind: 'work_item' })
  await storage.putEntity({ id: 'entity-2', kind: 'work_item' })
  await storage.putEntity({ id: 'repo-entity-1', kind: 'repository' })
  await storage.putExternalIdentity({ id: 'repo-identity-1', entityId: 'repo-entity-1', bindingId: 'binding-1', externalKind: 'repository', externalId: 'repo-1', role: 'primary' })
  await storage.putRepository({ id: 'repo-1', workspaceId: WORKSPACE, externalIdentityId: 'repo-identity-1' })
}

export function storageExecutionSuite(adapter, register = test) {
  const { label, makeStorage } = adapter

  register(`${label}：同一工作项+仓库最多一个 active 执行上下文`, async () => {
    const storage = makeStorage()
    await seedExecutionPrereqs(storage)
    const context = (id, status) => ({ id, workspaceId: WORKSPACE, workItemId: 'entity-1', repositoryId: 'repo-1', status, branchExternalId: undefined, worktreeExternalId: undefined })
    await storage.putExecutionContext(context('context-1', 'ready'))
    await storage.putExecutionContext(context('context-2', 'planned'))
    assert.equal((await storage.findActiveExecutionContext(WORKSPACE, 'entity-1', 'repo-1'))?.id, 'context-2')
    assert.equal((await storage.getExecutionContext('context-1'))?.status, 'closed')
    await storage.putExecutionRun({ id: 'run-1', workspaceId: WORKSPACE, contextId: 'context-2', status: 'running', updatedAt: '2026-09-20T00:00:00Z' })
    assert.equal((await storage.getExecutionRun('run-1'))?.status, 'running')
    // 运行的 provider 引用是运行事实的一部分：重启后路由 getRun / cancelRun 全靠它，两个实现必须逐字段读回
    // 同一个四元组（SQLite 走 JSON 列，`url: undefined` 不能在往返里变成"没有这个键"）。
    const providerRef = { bindingId: 'binding-execution', objectKind: 'execution_run', externalId: 'manual-run:x@t~sig', url: undefined }
    const replaced = { id: 'run-1', workspaceId: WORKSPACE, contextId: 'context-2', status: 'canceled', updatedAt: '2026-09-20T00:00:01Z', providerRef, fallback: true }
    await storage.putExecutionRun(replaced)
    assert.deepEqual(await storage.getExecutionRun('run-1'), replaced, '覆盖写入后逐字段读回新的 providerRef 与"由降级产生"')
  })

  register(`${label}：关系按工作区隔离且重复写入不产生第二条`, async () => {
    const storage = makeStorage()
    await seedExecutionPrereqs(storage)
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

  /**
   * 引用完整性（L6 评审 F1，第四轮评审 P3 订正清单，第五轮补全）：执行面在两个实现上**已对齐**的父边与枚举
   * 逐条钉住——仓库 → 身份、执行上下文 → 工作区、执行运行 → 工作区 + 上下文、写尝试 → 工作区 + 绑定、
   * 关系 → 工作区、观察 → 绑定；枚举：执行上下文状态、执行运行状态、写尝试状态、候选关系的来源
   * （candidate 不得 explicit）。**依赖 core** 的两格见本文件末尾的 `storageExecutionDivergenceSuite`：
   * 仓库一格已对齐（两边都拒绝），关系端点一格仍分叉（SQLite 的外键拒绝，替身接受）；工作项父边已对齐（#196）。
   */
  register(`${label}：悬空父边与非法枚举必须被拒绝（两个实现已对齐的引用完整性）`, async () => {
    const storage = makeStorage()
    await seedExecutionPrereqs(storage)
    const base = { workspaceId: WORKSPACE, workItemId: 'entity-1', repositoryId: 'repo-1', branchExternalId: undefined, worktreeExternalId: undefined, provisioningStartedAt: undefined }
    const run = (overrides) => ({ id: 'run-1', workspaceId: WORKSPACE, contextId: 'context-1', status: 'running', updatedAt: '2026-09-20T00:00:00Z', ...overrides })
    const attempt = (overrides) => ({ id: 'attempt-1', workspaceId: WORKSPACE, bindingId: 'binding-1', commandName: 'updatePlanningFields',
      idempotencyKey: 'key-1', state: 'pending', expectedSourceVersion: undefined, errorCode: undefined, ...overrides })
    // 正控：父行存在时同一形状的写入必须被接受——否则"一律抛错"的实现也能通过下面的断言。
    await storage.putRepository({ id: 'repo-1', workspaceId: WORKSPACE, externalIdentityId: 'repo-identity-1' })
    await storage.putExecutionContext({ ...base, id: 'context-1', status: 'ready' })
    await storage.putExecutionRun(run({}))
    await storage.putMutationAttempt(attempt({}))
    // 已对齐的父边：SQLite 的外键与替身逐条同语义。
    await assert.rejects(storage.putRepository({ id: 'repo-dangling', workspaceId: WORKSPACE, externalIdentityId: 'repo-identity-none' }), '仓库必须挂在存在的身份上')
    await assert.rejects(storage.putExecutionContext({ ...base, id: 'context-dangling-ws', workspaceId: 'ws-none', status: 'ready' }), '执行上下文必须属于存在的工作区')
    await assert.rejects(storage.putExecutionRun(run({ id: 'run-dangling-context', contextId: 'context-none' })), '执行运行必须挂在存在的执行上下文上')
    await assert.rejects(storage.putExecutionRun(run({ id: 'run-dangling-ws', workspaceId: 'ws-none' })), '执行运行必须属于存在的工作区')
    await assert.rejects(storage.putExecutionRun(run({ id: 'run-cross-ws', workspaceId: 'ws-other' })), '运行不得挂到另一个工作区的执行上下文上（复合外键）')
    await assert.rejects(storage.putMutationAttempt(attempt({ id: 'attempt-dangling-binding', bindingId: 'binding-none' })), '写尝试必须指向存在的绑定')
    await assert.rejects(storage.putMutationAttempt(attempt({ id: 'attempt-dangling-ws', workspaceId: 'ws-none', idempotencyKey: 'key-2' })), '写尝试必须属于存在的工作区')
    await assert.rejects(storage.putRelation('ws-none', { from: 'entity-1', to: 'entity-2', type: 'relates_to', class: 'business_semantics', source: 'deterministic', state: 'candidate' }), '关系必须属于存在的工作区')
    await assert.rejects(storage.recordObservation({ state: 'pending', observation: { bindingId: 'binding-none', dedupeKey: 'dedupe-dangling', type: 'issue.updated', eventTime: undefined, receivedTime: '2026-09-20T00:00:01Z', subject: { bindingId: 'binding-none', objectKind: 'issue', externalId: 'issue-1', url: undefined }, sourceVersion: '2026-09-20T00:00:00.000000000Z', payloadHash: 'payload-hash', payload: {} } }), '观察必须属于存在的绑定')
    // 已对齐的枚举：SQLite 的 CHECK 与替身同语义。
    await assert.rejects(storage.putExecutionContext({ ...base, id: 'context-bogus-status', status: 'bogus' }), '执行上下文状态必须是已知取值')
    await assert.rejects(storage.putExecutionRun(run({ id: 'run-bogus-status', status: 'bogus' })), '执行运行状态必须是已知取值')
    await assert.rejects(storage.putMutationAttempt(attempt({ id: 'attempt-bogus-state', idempotencyKey: 'key-3', state: 'bogus' })), '写尝试状态必须是已知取值')
    await assert.rejects(storage.putRelation(WORKSPACE, { from: 'entity-1', to: 'entity-2', type: 'relates_to', class: 'business_semantics', source: 'explicit', state: 'candidate' }), 'candidate 关系的来源不得是 explicit')
    await assert.rejects(storage.putRelation(WORKSPACE, { from: 'entity-1', to: 'entity-2', type: 'relates_to', class: 'business_semantics', source: 'deterministic', state: 'bogus' }), '关系状态必须是已知取值')
    await assert.rejects(storage.putRelation(WORKSPACE, { from: 'entity-1', to: 'entity-2', type: 'relates_to', class: 'business_semantics', source: 'bogus', state: 'confirmed' }), '关系来源必须是已知取值')
    assert.deepEqual((await storage.listRepositories(WORKSPACE)).map((item) => item.id), ['repo-1'], '被拒绝的仓库写入不得留下行')
    assert.equal(await storage.getExecutionRun('run-dangling-context'), undefined, '被拒绝的运行写入不得留下行')
    assert.equal(await storage.getExecutionRun('run-dangling-ws'), undefined, '被拒绝的运行写入不得留下行')
    assert.equal(await storage.getExecutionRun('run-cross-ws'), undefined, '被拒绝的跨工作区运行不得留下行')
    assert.deepEqual(await storage.listRelations(WORKSPACE), [], '被拒绝的关系写入不得留下行')
    assert.deepEqual((await storage.listMutationAttempts(WORKSPACE)).map((item) => item.id), ['attempt-1'], '被拒绝的写尝试不得留下行')
  })

  /**
   * 工作项父边（#196）：引用未登记工作项的执行上下文写入，两个实现以**同一个** `StorageInputError` 拒绝——不再是替身接受、
   * SQLite 暴露驱动外键文字。工作区与仓库父行完整播种、只缺工作项（否则会先撞别的外键而掩盖本条）；`ready` / `failed` / `closed` 各试
   * 一遍（父边不随状态而变）× 根调用 / 事务内调用（未 catch 的类型化错误令整笔回滚）。拒绝之后：新 id 没有行、同 id 的旧行逐字段不变且旧 active 仍是 active。
   */
  register(`${label}：执行上下文：未登记工作项以同结构拒绝`, async () => {
    const storage = makeStorage()
    await seedExecutionPrereqs(storage)
    const base = { workspaceId: WORKSPACE, repositoryId: 'repo-1', branchExternalId: undefined, worktreeExternalId: undefined, provisioningStartedAt: undefined }
    const legit = { ...base, id: 'context-legit', workItemId: 'entity-1', status: 'ready' }
    await storage.putExecutionContext(legit)
    assert.deepEqual(await storage.getExecutionContext('context-legit'), legit, '正控：父行登记后同形状写入成功并读回')
    // 父边只问"实体是否登记"，不问 kind：非 work_item 种类的已登记实体同样被接受（可操作性是 Core 的策略，不进 Storage）。
    const otherKind = { ...base, id: 'context-other-kind', workItemId: 'repo-entity-1', status: 'ready' }
    await storage.putExecutionContext(otherKind)
    assert.deepEqual(await storage.getExecutionContext('context-other-kind'), otherKind, '正控：父边只要求实体已登记，不限定 kind')
    const failure = { code: 'invalid_input', message: '执行上下文引用的工作项未登记', recovery: 'none', retryable: false, confirmedValue: undefined, attemptedValue: undefined }
    const rejection = (error) => {
      assert.ok(error instanceof StorageInputError, `必须是 StorageInputError，实际：${error}`)
      assert.equal(error.name, 'StorageInputError')
      assert.equal(error.operation, 'putExecutionContext')
      assert.equal(error.resource, 'work_item')
      assert.deepEqual(error.failure, failure)
      assert.doesNotMatch(String(error.message), /FOREIGN KEY|ERR_SQLITE/, '不得泄露驱动文字')
      return true
    }
    for (const status of ['ready', 'failed', 'closed']) {
      const record = { ...base, id: `context-new-${status}`, workItemId: 'work-item-unregistered', status }
      await assert.rejects(storage.putExecutionContext(record), rejection, `${status}：根调用`)
      await assert.rejects(storage.transaction((tx) => tx.putExecutionContext(record)), rejection, `${status}：事务内未 catch`)
      assert.equal(await storage.getExecutionContext(record.id), undefined, `${status}：被拒绝的新 id 不得留下行`)
    }
    // 同 id 换成未知工作项：旧行逐字段不变，旧 active 没有被关闭。
    await assert.rejects(storage.putExecutionContext({ ...legit, workItemId: 'work-item-unregistered', status: 'failed' }), rejection)
    assert.deepEqual(await storage.getExecutionContext('context-legit'), legit, '同 id 被拒绝的更新不得改动旧行')
    assert.equal((await storage.findActiveExecutionContext(WORKSPACE, 'entity-1', 'repo-1'))?.id, 'context-legit', '旧 active 仍是 active')
    // 检查没有把正常替换一并阻断：合法工作项上的新 active 仍按原规则关闭旧 active。
    await storage.putExecutionContext({ ...legit, id: 'context-next', status: 'planned' })
    assert.equal((await storage.getExecutionContext('context-legit'))?.status, 'closed')
    assert.equal((await storage.findActiveExecutionContext(WORKSPACE, 'entity-1', 'repo-1'))?.id, 'context-next')
  })

  // 仓库挂载以 (工作区, id) 为键（#187 / #188）。同键换外部身份会让已有执行上下文悄悄改指另一个仓库，必须响亮失败且不覆盖；
  // 反例的新身份必须是**已存在、未挂载**的，否则拒绝可能只是死于悬空身份或唯一约束，分不清是不是这条规则；同值重复登记是 no-op（core 的写前登记依赖它可重复）。
  register(`${label}：仓库挂载以 (工作区, id) 为键，换身份与换 id 都被拒绝且不覆盖，同值重复登记是 no-op`, async () => {
    const storage = makeStorage()
    await seedExecutionPrereqs(storage)
    for (const n of [2, 3]) {
      await storage.putEntity({ id: `repo-entity-${n}`, kind: 'repository' })
      await storage.putExternalIdentity({ id: `repo-identity-${n}`, entityId: `repo-entity-${n}`, bindingId: 'binding-1', externalKind: 'repository', externalId: `repo-${n}`, role: 'primary' })
    }
    const mount = { id: 'repo-1', workspaceId: WORKSPACE, externalIdentityId: 'repo-identity-1' }
    const second = { id: 'repo-2', workspaceId: WORKSPACE, externalIdentityId: 'repo-identity-2' }
    await storage.putRepository(mount)
    await storage.putRepository(second)
    await assert.rejects(storage.putRepository({ ...mount, externalIdentityId: 'repo-identity-3' }), '同 (工作区, id) 换外部身份必须被拒绝')
    await assert.rejects(storage.putRepository({ ...mount, id: 'repo-9' }), '同工作区同外部身份换 id 必须被拒绝')
    await storage.putExternalIdentity({ id: 'branch-identity-4', entityId: 'entity-2', bindingId: 'binding-1', externalKind: 'branch', externalId: 'repo-4', role: 'primary' })
    await assert.rejects(storage.putRepository({ id: 'repo-4', workspaceId: WORKSPACE, externalIdentityId: 'branch-identity-4' }), /not a repository identity/, '挂载必须引用 repository 种类的身份（TD-004）')
    assert.deepEqual(await storage.listRepositories(WORKSPACE), [mount, second], '被拒绝的写入不得覆盖或追加挂载，同值重复登记不得产生第二行')
  })

  register(`${label}：同一个仓库 id 可以挂在两个工作区上，互不影响（含已有执行上下文引用时）`, async () => {
    const storage = makeStorage()
    await seedExecutionPrereqs(storage)
    await storage.putExecutionContext({ id: 'context-1', workspaceId: WORKSPACE, workItemId: 'entity-1', repositoryId: 'repo-1', status: 'ready', branchExternalId: undefined, worktreeExternalId: undefined, provisioningStartedAt: undefined })
    await storage.putEntity({ id: 'repo-entity-9', kind: 'repository' })
    await storage.putExternalIdentity({ id: 'repo-identity-9', entityId: 'repo-entity-9', bindingId: 'binding-1', externalKind: 'repository', externalId: 'repo-9', role: 'primary' })
    await storage.putRepository({ id: 'repo-1', workspaceId: 'ws-other', externalIdentityId: 'repo-identity-9' })
    assert.deepEqual((await storage.listRepositories(WORKSPACE)).map((r) => [r.id, r.workspaceId]), [['repo-1', WORKSPACE]], '第二个工作区的挂载不得搬走第一个')
    assert.deepEqual((await storage.listRepositories('ws-other')).map((r) => [r.id, r.workspaceId]), [['repo-1', 'ws-other']])
    assert.equal((await storage.getExecutionContext('context-1'))?.repositoryId, 'repo-1', '已有执行上下文仍引用自己工作区的挂载')
  })

  /**
   * F2（L6 评审）：执行组原有的第 2 条对"只写候选即可读到候选"判别性为零——实测把 `putRelation` 的候选分支改成
   * 整笔 no-op 后契约仍全绿（候选写入被后面的确认写入覆盖）。本用例只写候选、只读候选，把路由的候选方向
   * 从集成层升到契约层（D19 的收口动作）。
   */
  register(`${label}：只写候选关系就能读到候选（关系按 state 路由的候选方向）`, async () => {
    const storage = makeStorage()
    await seedExecutionPrereqs(storage)
    const candidate = { from: 'entity-1', to: 'entity-2', type: 'depends_on', class: 'business_semantics', source: 'deterministic', state: 'candidate' }
    await storage.putRelation(WORKSPACE, candidate)
    assert.deepEqual(await storage.listRelations(WORKSPACE), [candidate], '只写过候选时读路径必须返回候选行本身，而不是空集或确认行')
    assert.deepEqual(await storage.listRelations('ws-other'), [], '候选关系同样是工作区作用域的')
  })

  /** F2（L6 评审）：`listMutationAttempts` 的跨工作区隔离此前全仓无断言——两个实现可以各自漂移而不被发现。 */
  register(`${label}：写尝试按工作区隔离，列表读路径不混入另一个工作区`, async () => {
    const storage = makeStorage()
    await seedExecutionPrereqs(storage)
    const attempt = { id: 'attempt-1', workspaceId: WORKSPACE, bindingId: 'binding-1', commandName: 'updatePlanningFields',
      idempotencyKey: 'key-1', state: 'pending', expectedSourceVersion: undefined, errorCode: undefined }
    await storage.putMutationAttempt(attempt)
    await storage.putMutationAttempt({ ...attempt, id: 'attempt-2', workspaceId: 'ws-other', idempotencyKey: 'key-2' })
    assert.deepEqual((await storage.listMutationAttempts(WORKSPACE)).map((item) => item.id), ['attempt-1'])
    assert.deepEqual((await storage.listMutationAttempts('ws-other')).map((item) => item.id), ['attempt-2'])
    assert.equal(await storage.findMutationAttempt(WORKSPACE, 'key-2'), undefined, '另一个工作区的幂等键不得在本工作区命中')
    assert.equal(await storage.findMutationAttempt('ws-other', 'key-1'), undefined, '反方向同样不得命中')
  })

  /**
   * F3（L6 评审）：端口契约写明 `provisioningStartedAt` "终态为 undefined"，而强制关闭 active 上下文是
   * **实现**产生的状态迁移（不是调用方传进来的记录），因此实现必须连这一列一起清。两个实现原先一致地保留它，
   * 没有任何断言钉住，本用例把语义钉死。
   */
  register(`${label}：强制关闭 active 上下文时把 provisioningStartedAt 清成 undefined`, async () => {
    const storage = makeStorage()
    await seedExecutionPrereqs(storage)
    const base = { workspaceId: WORKSPACE, workItemId: 'entity-1', repositoryId: 'repo-1', branchExternalId: undefined, worktreeExternalId: undefined }
    await storage.putExecutionContext({ ...base, id: 'context-1', status: 'provisioning', provisioningStartedAt: '2026-09-20T00:00:00Z' })
    await storage.putExecutionContext({ ...base, id: 'context-2', status: 'planned', provisioningStartedAt: undefined })
    const closed = await storage.getExecutionContext('context-1')
    assert.equal(closed?.status, 'closed', '写入第二个 active 必须把同键旧 active 置为 closed')
    assert.equal(closed?.provisioningStartedAt, undefined, '终态行不得留着认领时间：端口契约写明该列终态为 undefined')
  })

  /**
   * 读入口（L6 重建 + 第三轮评审收口）：执行面的**每一个**读方法都必须经过基类的 `read`。直接读同一连接会看见
   * **自己事务里**未提交的写入，事务外的读者因此可能拿到一个随后被回滚的值。
   *
   * 第三轮评审点名（P2）：此前这条只钉住 `getExecutionContext` 一个——把其余五个读改回 `this.db.prepare(...)`
   * 契约仍然全绿（实测 M5），"执行面的每个读都经过 `read`"因此没有判别性。本用例按**六个读**参数化，每个都走
   * 完整的三步：事务内写入对应事实 → 从外部读 → 断言读到的不是未提交值 → 回滚后再读一次，必须是空；再加一条
   * 正控（同一笔写入提交后同一个读必须能看到它），否则"读不到"可能只是写入被约束拒绝、而不是读走了队列。
   *
   * 措辞只断言"读到的不是未提交的值"：替身的读者立刻看到旧值、队列化的 SQLite 读者等到结算，差别是**读取时刻**
   * 而不是可见性。
   */
  const context = (id) => ({ id, workspaceId: WORKSPACE, workItemId: 'entity-1', repositoryId: 'repo-1', status: 'ready',
    branchExternalId: undefined, worktreeExternalId: undefined, provisioningStartedAt: undefined })
  const run = { id: 'run-read', workspaceId: WORKSPACE, contextId: 'context-read', status: 'running', updatedAt: '2026-09-20T00:00:00Z' }
  const relation = { from: 'entity-1', to: 'entity-2', type: 'depends_on', class: 'business_semantics', source: 'deterministic', state: 'candidate' }
  const attempt = { id: 'attempt-read', workspaceId: WORKSPACE, bindingId: 'binding-1', commandName: 'updatePlanningFields',
    idempotencyKey: 'key-read', state: 'pending', expectedSourceVersion: undefined, errorCode: undefined }
  const READ_ISOLATION_CASES = [
    ['getExecutionContext', { write: (tx) => tx.putExecutionContext(context('context-read')),
      read: (storage) => storage.getExecutionContext('context-read'), uncommitted: context('context-read'), rolledBack: undefined }],
    ['findActiveExecutionContext', { write: (tx) => tx.putExecutionContext(context('context-read')),
      read: (storage) => storage.findActiveExecutionContext(WORKSPACE, 'entity-1', 'repo-1'), uncommitted: context('context-read'), rolledBack: undefined }],
    // 执行运行以外键指向执行上下文，因此事务里先写父行再写运行行：两条都在同一个未提交事务里。
    ['getExecutionRun', { write: async (tx) => { await tx.putExecutionContext(context('context-read')); await tx.putExecutionRun(run) },
      read: (storage) => storage.getExecutionRun('run-read'), uncommitted: run, rolledBack: undefined }],
    ['listRelations', { write: (tx) => tx.putRelation(WORKSPACE, relation),
      read: (storage) => storage.listRelations(WORKSPACE), uncommitted: [relation], rolledBack: [] }],
    ['findMutationAttempt', { write: (tx) => tx.putMutationAttempt(attempt),
      read: (storage) => storage.findMutationAttempt(WORKSPACE, 'key-read'), uncommitted: attempt, rolledBack: undefined }],
    ['listMutationAttempts', { write: (tx) => tx.putMutationAttempt(attempt),
      read: (storage) => storage.listMutationAttempts(WORKSPACE), uncommitted: [attempt], rolledBack: [] }],
  ]

  for (const [name, scenario] of READ_ISOLATION_CASES) {
    register(`${label}：事务未提交的 ${name} 写入不得被事务外的读看到`, { timeout: 5000 }, async () => {
      const storage = makeStorage()
      await seedExecutionPrereqs(storage)
      let release; const gate = new Promise((resolve) => { release = resolve })
      let mark; const suspended = new Promise((resolve) => { mark = resolve })
      const failed = storage.transaction(async (tx) => { await scenario.write(tx); mark(); await gate; throw new Error('事务内失败') })
      await suspended
      let seen; const read = scenario.read(storage).then((value) => { seen = value })
      release(); await assert.rejects(failed, /事务内失败/); await read
      assert.notDeepEqual(seen, scenario.uncommitted, `${name}：未提交的写入不得被事务外的读看到`)
      assert.deepEqual(await scenario.read(storage), scenario.rolledBack, `${name}：回滚后执行面的读路径给的是已提交状态（没有这一行）`)
      await scenario.write(storage)
      assert.deepEqual(await scenario.read(storage), scenario.uncommitted, `${name}：正控——同一笔写入提交后，同一个读必须能看到它（否则"读不到"只是写入被约束拒绝）`)
    })
  }
}

/**
 * 共享组里的**显式分叉用例**（2026-09-26 第五轮评审 R4-4）：依赖 core 的两格里，仓库一格已对齐（#187 / #188，两边都拒绝），
 * 关系端点一格仍给出相反答案——SQLite 的外键拒绝悬空引用，内存替身接受（工作项一格 #196 已对齐，移入共享执行组）。适配器用能力位 `acceptsDanglingCoreParents` 声明自己这一侧
 * 的事实，本函数按位断言**实际行为**：对齐一侧（改替身或改 SQLite）而不改声明，对应用例立刻变红。
 *
 * 为什么独立成函数而不是注册进 `storageExecutionSuite`：切分守卫按组文件的注册条数核账，组文件的新增账在
 * `suites/storage.js`；这些用例与 `storage-contract.test.js` 的其余适配器循环并列注册，不参与切分账。返回值是本
 * 函数**实际注册**的条数，装配点的守卫按独立期望核账——删掉一条 GRIDS 会让守卫红，而不是静默缩小覆盖。
 * 能力位按边声明（`{ repository, relation }`），拒绝的错误文本按适配器各自的真实来源写（`rejection`：SQLite 是外键，替身是显式的存在性检查）。
 */
export function storageExecutionDivergenceSuite(adapter, register = test) {
  const { label, makeStorage, acceptsDanglingCoreParents, rejection } = adapter
  const base = { workspaceId: WORKSPACE, workItemId: 'entity-1', repositoryId: 'repo-1', branchExternalId: undefined, worktreeExternalId: undefined, provisioningStartedAt: undefined }
  const GRIDS = [
    ['repository', '执行上下文 → 仓库（`execution_context.repositoryId`，仓库只挂在另一个工作区；core 的写前登记先建挂载：#187 / #188）',
      async (storage) => {
        await storage.putRepository({ id: 'repo-2', workspaceId: 'ws-other', externalIdentityId: 'repo-identity-1' })
        // 父边不随状态而变：active 与终态的悬空写入都要试（只对 active 检查的替身变异曾全绿，#253 评审 P3）。
        const outcomes = []
        for (const status of ['ready', 'failed']) outcomes.push(await storage.putExecutionContext({ ...base, id: `context-dangling-repo-${status}`, workspaceId: 'ws-other', status }).then(() => undefined, (error) => error))
        if (outcomes.every((error) => error === undefined)) return
        if (outcomes.some((error) => error === undefined)) throw new Error('父边检查随上下文状态而变：ready 与 failed 的结果不一致')
        throw outcomes[0]
      }],
    ['relation', '关系端点（`relation.from` / `relation.to`，其余谱系写者会把边写到未登记的实体上 / #221）',
      (storage) => storage.putRelation(WORKSPACE, { from: 'entity-none', to: 'entity-2', type: 'depends_on', class: 'business_semantics', source: 'deterministic', state: 'candidate' })],
  ]
  let registered = 0
  const counted = (name, fn, options) => { registered += 1; register(name, fn, options) }
  for (const [edge, grid, write] of GRIDS) {
    const accepts = acceptsDanglingCoreParents[edge]
    counted(`${label}：${grid} 悬空时当前${accepts ? '被接受' : '被拒绝'}（${edge === 'repository' ? '已对齐' : '声明式分叉'}）`, async () => {
      const storage = makeStorage()
      await seedExecutionPrereqs(storage)
      const outcome = await write(storage).then(() => 'accepted', (error) => `rejected: ${error.message}`)
      if (accepts) {
        assert.equal(outcome, 'accepted', `${grid}：能力位声明"接受悬空引用"（当前分叉），实际行为必须与声明一致；对齐这一格时要同时改能力位、替身注释与本用例`)
      } else {
        assert.match(outcome, rejection, `${grid}：能力位声明"拒绝悬空引用"，拒绝必须来自该适配器真实的父边检查（SQLite 的外键、替身的存在性检查）而不是别的约束`)
      }
    })
  }
  return registered
}
