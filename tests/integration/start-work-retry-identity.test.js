/**
 * Start Work 恢复路径的**重试**与**身份**（issue #184 / #165）。
 *
 * 看护的不变量：
 *
 * - **#184 · 失败可重试**：一次 provisioning 失败之后，清掉原因、换一个**新**幂等键重试必须成功。
 *   今天不行——`Failed` 是终态（端口没有删除入口、`Closed` 没有写者、`contextIdFor` 是确定性的），
 *   所以一次失败永久锁死这对 (工作项, 仓库)，而 `reportForExisting` 那句「需显式重试或关闭」
 *   是一条没有兑现的承诺。
 * - **#184 · 接管保留步骤字段**：接管终态必须用 `{...existing, ...}` 保留 `branchExternalId`，
 *   不得重建记录——否则分步回填的成果会被抹掉，那一步等于白做。
 * - **#184 · 幂等键重放优先**：同一个 key 返回那一次的报告、**不重新尝试**；换新 key 才是重试。
 *   这条是 Stripe 的语义，不写清楚会被读成「我重试了却拿到旧错误」这个缺陷。
 * - **#184 · 在途仍被拒**：`Provisioning` 且租约未过期时继续挡住——接管只针对**终态**。
 * - **#165 · 一份工作树一个身份**：恢复之后 `has_worktree` 关系恰好一条、工作树实体恰好一个。
 *   今天的根因是 `recordStartFacts` 从 `git.worktreeExternalId` 派生实体键，而该值随路径变化
 *   （工作树步失败时它是 `undefined`，于是退化成用分支名当 slot；成功时它是工作树路径）。
 *
 * 用例全部使用离线替身（`tests/integration/README.md` §约定：外部依赖一律用 Fake Provider）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CapabilityKey } from '@harness-projects/capabilities'
import { chainEntityId, composeCore } from '@harness-projects/core'
import { AccessLevel, EntityKind, ExecutionContextStatus, ProviderErrorCode, RelationType, WriteState, newWorkspaceId } from '@harness-projects/domain'
import { createFakeProviders, exportFakeStorageState, providerFail } from '@harness-projects/provider-fake'

const WORKSPACE = { id: newWorkspaceId(), name: 'Start Work 恢复' }
const REQUEST = { repositoryId: 'repo-alpha', actor: { kind: 'agent' } }

/** 可控时钟：租约是否过期由测试显式决定，不靠真实等待。 */
function controllableClock() {
  let now = Date.parse('2026-09-24T00:00:00.000Z')
  return { clock: () => new Date(now).toISOString(), advance: (ms) => { now += ms } }
}

async function workItemIdOf(core) {
  const item = (await core.queries.listPlanningItems()).find((view) => view.kind === 'work_item')
  assert.ok(item, '夹具必须提供一个工作项')
  return item.entityId
}

const compose = (providers, clock) => composeCore({ workspace: WORKSPACE, providers, clock })

/**
 * 可开关的工作树故障：返回**结构化失败**而不是抛异常，模拟「路径被普通目录占用」这类**可清除**的
 * 原因。用开关而不是一次性注入，是因为本文件的每个用例都要走「失败 → 清掉 → 重试」这条完整路径。
 */
function switchableWorktreeFailure(providers) {
  const original = providers.development.createWorktree.bind(providers.development)
  const state = { failing: false, calls: 0 }
  providers.development.createWorktree = async (input) => {
    state.calls += 1
    if (state.failing) return providerFail(ProviderErrorCode.Unavailable, '工作树路径被占用')
    return original(input)
  }
  return state
}

const contextsOf = (providers) => exportFakeStorageState(providers.storage).contexts
const branchesNamed = (providers, name) => providers.development.state.branches.filter((b) => b.name === name)
const worktreeRelations = async (providers) =>
  (await providers.storage.listRelations(WORKSPACE.id)).filter((r) => r.type === RelationType.HasWorktree)

/**
 * 工作树实体的**期望身份**：这个工作项**在这个仓库上**的工作树。
 *
 * 作用域是 `(workspaceId, repositoryId, workItemId)`，与 `contextIdFor` 同一个三元组——**不是 binding**。
 * binding 的解析有多个来源（写入侧走 `DevelopmentWorktreeCreate`、投影侧走 `DevelopmentRepositoryRead`），
 * 两个 capability key 可以独立不可用，于是同一个工作树会拿到两个身份。`repositoryId` 两侧都从执行
 * 上下文记录取，不需要任何 capability 解析，所以这个分叉从构造上不存在。
 *
 * 断言必须是这个**精确值**，不能是「只有一个」——「实体数 = 1」被「边数 = 1」逻辑蕴含，恒真；
 * 而把键换成另一个「请求派生且稳定」的值（例如请求里的分支名）时，只有精确值会变红。
 */
const expectedWorktreeId = (providers, workItemId, repositoryId = REQUEST.repositoryId) =>
  chainEntityId(WORKSPACE.id, EntityKind.Worktree, `${repositoryId}|${workItemId}`)

test('重试：可清除的失败之后，换一个新幂等键必须把同一个上下文做完（#184）', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  const fault = switchableWorktreeFailure(providers)

  fault.failing = true
  const failed = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'retry-1' })
  assert.equal(failed.status, ExecutionContextStatus.Failed, '可清除的原因必须如实落成 Failed，而不是伪装成功')

  const afterFailure = contextsOf(providers)[0]
  assert.equal(afterFailure.status, ExecutionContextStatus.Failed)
  assert.equal(
    afterFailure.branchExternalId, `work/${workItemId}`,
    '失败时分支步的成果必须已经记录——这是重试能复用而不是重建的前提',
  )

  fault.failing = false
  const retried = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'retry-2' })
  assert.equal(retried.writeState, WriteState.Saved, '换新 key 的重试必须真的重新尝试并成功')
  assert.equal(retried.status, ExecutionContextStatus.Ready)
  assert.equal(contextsOf(providers).length, 1, '重试不得产生第二份执行上下文')
  assert.equal(branchesNamed(providers, `work/${workItemId}`).length, 1, '重试不得产生第二个分支')
  assert.equal(providers.development.state.worktrees.length, 1, '重试不得产生第二份工作树')
})

test('接管：重试保留已记录的 branchExternalId，复用而不是重建（#184）', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  const fault = switchableWorktreeFailure(providers)

  fault.failing = true
  await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'keep-1' })
  const contextId = contextsOf(providers)[0].id
  const branchExternalId = contextsOf(providers)[0].branchExternalId
  assert.equal(branchExternalId, `work/${workItemId}`, '前置条件：失败时分支步的成果已记录')

  // **接管写下的那一份记录只在两个时刻之间可观察**：接管事务提交之后、`saveContext` 覆盖它之前。
  // 取样点必须在供应序列**真正会跑的那一步**上。集成 Batch 1 之后，分支步因为 `branchExternalId`
  // 已记录而被**跳过**，重放时 `createBranch` 根本不会被调用——取样点若还留在那里，本用例的守卫
  // （`接管必须真的进入供应序列`）会先响。所以取样点移到**工作树步**，并用 `branchStepCalls`
  // 把「分支步被跳过」本身也钉住：这两条合起来才是 Batch 1 与 Batch 2 之间的契约——
  // 接管若抹掉步骤字段，跳过就不会发生，`createBranch` 会被调用，这里于是变红。
  let takenOver
  let branchStepCalls = 0
  const originalCreateBranch = providers.development.createBranch.bind(providers.development)
  providers.development.createBranch = async (input) => {
    branchStepCalls += 1
    return originalCreateBranch(input)
  }
  const originalCreateWorktree = providers.development.createWorktree.bind(providers.development)
  providers.development.createWorktree = async (input) => {
    takenOver = exportFakeStorageState(providers.storage).contexts[0]
    return originalCreateWorktree(input)
  }
  fault.failing = false
  await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'keep-2' })

  assert.ok(takenOver, '接管必须真的进入供应序列，否则本用例什么也没证明')
  assert.equal(takenOver.status, ExecutionContextStatus.Provisioning)
  assert.equal(takenOver.id, contextId, '接管的是同一条记录，不是新建一条')
  // **这条断言不是本不变量的承重防线**：重建变异（M1）下它也是绿的——重建抹掉字段之后，重放会重走
  // 分支步并把它写回来，而取样点在更晚的工作树步。承重的是下面那句 `branchStepCalls === 0`
  // （重建 → 不跳过 → 调用发生 → 变红）。保留它是因为它钉住取样点的形态：字段必须在序列第二步
  // 之前就存在，否则「跳过」这条契约本身无从谈起。
  assert.equal(
    takenOver.branchExternalId, branchExternalId,
    '取样点上 branchExternalId 必须仍然存在（本不变量的承重防线是下面的 branchStepCalls === 0）',
  )
  assert.equal(
    branchStepCalls, 0,
    '分支步的成果已记录，重放必须跳过它（Batch 1 的契约）——接管若抹掉步骤字段，这里会变红',
  )
  assert.equal(branchesNamed(providers, `work/${workItemId}`).length, 1, '已记录的分支必须被复用')
})

test('幂等：同一个 key 返回那一次的报告，且不重新尝试（#184）', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  const fault = switchableWorktreeFailure(providers)

  fault.failing = true
  const first = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'same-key' })
  const callsAfterFirst = fault.calls

  const second = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'same-key' })
  assert.equal(second.writeState, first.writeState, '同一个 key 必须返回那一次的报告')
  assert.equal(second.status, first.status)
  assert.equal(fault.calls, callsAfterFirst, '同一个 key 不得重新尝试——换新 key 才是重试')
})

test('在途：分支步已回填且租约未过期时仍被拒，接管只针对终态（#184）', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)

  // **中断必须注入在分支步之后**：只有那样 `recordStep` 才执行过、`branchExternalId` 才已落盘，
  // 中途写入的 `saveContext` 也才真的跑过。注入在 `createBranch` 里时 `recordStep` 从未执行，
  // 「中途写入是否保留租约起点」这条承重逻辑就没有任何用例覆盖（把它改成清空租约，测试仍全绿）。
  const originalWorktree = providers.development.createWorktree.bind(providers.development)
  let interrupted = true
  providers.development.createWorktree = async (input) => {
    if (interrupted) {
      interrupted = false
      throw new Error('注入中断：进程死在分支步之后、工作树步之中')
    }
    return originalWorktree(input)
  }
  let branchStepCalls = 0
  const originalBranch = providers.development.createBranch.bind(providers.development)
  providers.development.createBranch = async (input) => {
    branchStepCalls += 1
    return originalBranch(input)
  }

  await assert.rejects(() => core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'inflight-1' }))
  const [record] = contextsOf(providers)
  assert.equal(record.status, ExecutionContextStatus.Provisioning)
  assert.equal(
    record.branchExternalId, `work/${workItemId}`,
    '前置条件：分支步的成果已落盘（中断在它之后）——没有这条，本用例对租约没有判别力',
  )
  const callsAfterInterrupt = branchStepCalls

  const inFlight = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'inflight-2' })
  assert.notEqual(inFlight.writeState, WriteState.Saved, '在途期间不得报告成功——租约未过期时接管必须继续被挡住')
  assert.equal(
    branchStepCalls, callsAfterInterrupt,
    '在途期间不得重新尝试供应：分支步已记录，它不得被重跑',
  )
  assert.equal(contextsOf(providers)[0].status, ExecutionContextStatus.Provisioning)
})

test('身份：失败后重试只留下一条 has_worktree 关系与一个工作树实体（#165）', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  const fault = switchableWorktreeFailure(providers)

  // 前置条件**直接构造**，不依赖 #184 的接管，也不依赖 Batch 1 的分步回填：
  // 一次「分支步已成功、工作树步失败」的供应，把上下文留在 Provisioning 并已记录 branchExternalId。
  // 这正是中断恢复要面对的状态（Batch 1 落地后它会自然出现），在这里显式摆出来，好让本用例只考 #165。
  fault.failing = true
  await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'identity-1' })
  const failed = contextsOf(providers)[0]
  assert.equal(failed.branchExternalId, `work/${workItemId}`, '前置条件：分支步的成果已记录')
  await providers.storage.putExecutionContext({
    ...failed, status: ExecutionContextStatus.Provisioning,
    provisioningStartedAt: new Date(Date.parse('2026-09-24T00:00:00.000Z') - 60_000).toISOString(),
  })

  fault.failing = false
  const resumed = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'identity-2' })
  assert.equal(resumed.status, ExecutionContextStatus.Ready, '租约过期后必须能接管把序列做完')

  const relations = await worktreeRelations(providers)
  assert.equal(relations.length, 1, '同一份工作树只允许一条 has_worktree 关系（不变量 6：不反复重新识别对象）')
  assert.equal(
    relations[0].to, expectedWorktreeId(providers, workItemId),
    '工作树实体的身份必须是「这个工作项在这个 binding 下的工作树」——路径是属性，不是身份',
  )
  assert.equal(providers.development.state.worktrees.length, 1)
})

test('身份只有一处派生：读一次谱系不得写出第二条 has_worktree 关系（#165）', async () => {
  const providers = createFakeProviders()
  // 复刻真实本地 Git provider 的返回形态：工作树的**句柄是规范化绝对路径**，不是请求里的字符串。
  // 这正是两个派生点会分叉的唯一条件——替身的默认形态里句柄恰好等于请求路径，分叉被掩盖。
  const canonical = '/canonical/repo/.worktrees/wi'
  const original = providers.development.createWorktree.bind(providers.development)
  providers.development.createWorktree = async (input) => {
    const result = await original(input)
    if (!result.ok) return result
    return { ok: true, value: { ...result.value, path: canonical, ref: { ...result.value.ref, externalId: canonical } } }
  }
  const core = await compose(providers, controllableClock().clock)
  const workItemId = await workItemIdOf(core)
  await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'one-derivation' })

  const before = await worktreeRelations(providers)
  assert.equal(before.length, 1, '前置条件：一次成功供应写出一条关系')
  assert.equal(before[0].to, expectedWorktreeId(providers, workItemId))

  // 读谱系会把观察到的每一跳落成关系。若投影侧的实体键与写入侧不同，这里就会多出一条 confirmed 关系。
  await core.queries.getDeliveryLineage({ workItemId, repositoryId: REQUEST.repositoryId })

  const after = await worktreeRelations(providers)
  assert.equal(after.length, 1, '读一次谱系不得为同一份工作树写出第二条 confirmed 关系')
  assert.equal(after[0].to, expectedWorktreeId(providers, workItemId), '投影与写入必须派生出同一个身份')
})

test('身份不随路径变化：改工作树路径重试仍然只有一个实体（#165）', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  const fault = switchableWorktreeFailure(providers)

  fault.failing = true
  await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'path-1', worktreePath: '.worktrees/first' })
  fault.failing = false
  const retried = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'path-2', worktreePath: '.worktrees/second' })

  assert.equal(retried.status, ExecutionContextStatus.Ready, '换一个可用的路径重试是合法恢复，必须成功')
  const relations = await worktreeRelations(providers)
  assert.equal(relations.length, 1, '路径是属性：换路径不得产生第二个工作树实体')
  assert.equal(relations[0].to, expectedWorktreeId(providers, workItemId))
})

test('身份的作用域是仓库而不是 binding：仓库读能力不可用时两侧仍然一致（#165）', async () => {
  const providers = createFakeProviders()
  // 写入侧的身份来自 `DevelopmentWorktreeCreate` 的解析，投影侧来自 `DevelopmentRepositoryRead` 的解析。
  // 把后者置为不可用——两个 key 可以独立不可用，所以「用 binding 作作用域」在构造上就允许两侧分叉。
  const core = await composeCore({
    workspace: WORKSPACE, providers, clock: controllableClock().clock,
    policy: { [CapabilityKey.DevelopmentRepositoryRead]: AccessLevel.Unavailable },
  })
  const workItemId = await workItemIdOf(core)

  const started = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'scope-1' })
  assert.equal(started.status, ExecutionContextStatus.Ready, '建工作树不依赖仓库读能力，必须成功')

  const before = await worktreeRelations(providers)
  assert.equal(before.length, 1, '前置条件：一次成功供应写出一条关系')
  assert.equal(before[0].to, expectedWorktreeId(providers, workItemId), '写入侧的身份必须由仓库作用域决定')

  // 投影侧一旦拿不到 binding，就会去算另一个身份——读一次谱系于是写出第二条 confirmed 关系。
  await core.queries.getDeliveryLineage({ workItemId, repositoryId: REQUEST.repositoryId })

  const after = await worktreeRelations(providers)
  assert.equal(after.length, 1, '仓库读能力不可用不得让投影侧算出第二个身份')
  assert.equal(after[0].to, expectedWorktreeId(providers, workItemId), '两侧必须由构造一致，而不是靠两边都解析成功')
})

test('两个仓库上的两份工作树是两个实体：键里必须有 repositoryId（#165）', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers, controllableClock().clock)
  const workItemId = await workItemIdOf(core)
  // 同一 binding 下的第二个仓库。Storage 按 (workItemId, repositoryId) 键上下文，所以这个形态是被支持的。
  const [alpha] = providers.development.state.repositories
  providers.development.state.repositories.push({
    ...alpha, ref: { ...alpha.ref, externalId: 'repo-beta' }, name: 'beta',
  })

  const first = await core.commands.startWork({
    ...REQUEST, workItemId, idempotencyKey: 'two-repos-1', worktreePath: '.worktrees/alpha',
  })
  const second = await core.commands.startWork({
    ...REQUEST, repositoryId: 'repo-beta', workItemId, idempotencyKey: 'two-repos-2', worktreePath: '.worktrees/beta',
  })
  assert.equal(first.status, ExecutionContextStatus.Ready, '第一个仓库必须成功')
  assert.equal(second.status, ExecutionContextStatus.Ready, '第二个仓库必须成功')

  const relations = await worktreeRelations(providers)
  assert.equal(relations.length, 2, '两个仓库各有一份工作树，就是两条关系')
  const targets = relations.map((relation) => relation.to).sort()
  assert.deepEqual(
    targets,
    [expectedWorktreeId(providers, workItemId, 'repo-alpha'), expectedWorktreeId(providers, workItemId, 'repo-beta')].sort(),
    '两条关系的 to 必须是各自仓库作用域下的精确身份，且彼此不同',
  )
  assert.notEqual(targets[0], targets[1], '键里没有 repositoryId 时两个仓库会塌成同一个实体')
})
