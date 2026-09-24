/**
 * 步骤级回填与重放跳过（issue #183）。
 *
 * 看护的不变量：补偿序列**每一步成功后立刻落盘**，所以中断在两步之间的上下文能续——
 * 重放跳过已完成的分支步、不重新解析 `fromRef`，「基线是否前进」因此不进入判定。
 *
 * 为什么需要覆写离线替身的 `createBranch`：仓库的离线 Development 替身**完全不看
 * `fromRef`**（它只把 `fromRef` 当分支名查 head，同名一律报 `Conflict`），所以它表达不了
 * 「同名分支指向别处」这个真实拒绝。真实本地 Git provider 交付在 PR #160，尚未合并进本
 * 分支的 base。这里用最小的覆写复刻它的拒绝语义（同名同起点 → `ok`；同名不同起点 →
 * `invalid_input`），把「基线前进」变成可观测的输入。真实的 provider 端到端集成由 #141
 * 覆盖（它被 #137 / #120 阻塞）。
 *
 * 「进程死在两步之间」用**抛出**模拟：`provision` 的最终 `saveContext` 因此不会执行，
 * 存储里留下的只有分步回填写的那一次——这正是本层要断言的东西。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { providerErr, providerError } from '@harness-projects/capabilities'
import { composeCore } from '@harness-projects/core'
import { ExecutionContextStatus, ProviderErrorCode, WriteState, newWorkspaceId } from '@harness-projects/domain'
import { createFakeProviders, exportFakeStorageState } from '@harness-projects/provider-fake'

const WORKSPACE = { id: newWorkspaceId(), name: 'recovery' }
const REQUEST = { repositoryId: 'repo-alpha', actor: { kind: 'agent' } }
const LEASE_MS = 31_000

/** 可控时钟：租约过期由测试显式决定，不靠真实等待。 */
function controllableClock() {
  let now = Date.parse('2026-09-24T00:00:00.000Z')
  return { clock: () => new Date(now).toISOString(), advance: (ms) => { now += ms } }
}

async function workItemIdOf(core) {
  const item = (await core.queries.listPlanningItems()).find((view) => view.kind === 'work_item')
  assert.ok(item, '离线替身必须提供一个工作项')
  return item.entityId
}

const compose = (providers, clock) => composeCore({ workspace: WORKSPACE, providers, clock })

/** 让 `createWorktree` 在第一次调用时抛出，模拟进程死在分支步之后、工作树步之中。 */
function interruptAfterBranchStep(providers) {
  const original = providers.development.createWorktree.bind(providers.development)
  let interrupted = true
  providers.development.createWorktree = async (input) => {
    if (interrupted) {
      interrupted = false
      throw new Error('injected interruption between the branch step and the worktree step')
    }
    return original(input)
  }
}

/**
 * 覆写 `createBranch`，复刻 PR #160 交付的本地 Git provider 的拒绝语义，并数调用次数。
 * `control.baseMoved` 由测试在两次尝试之间置位，代表「别人往 main 上提交了」。
 */
function localGitLikeBranch(providers, control) {
  const original = providers.development.createBranch.bind(providers.development)
  providers.development.createBranch = async (input) => {
    control.createBranchCalls += 1
    const existing = providers.development.state.branches.find((branch) => branch.name === input.name)
    if (existing !== undefined && control.baseMoved) {
      return providerErr(providerError(
        ProviderErrorCode.InvalidInput,
        `分支 ${input.name} 已存在且指向 ${existing.headCommit ?? ''}，与请求起点不一致`,
      ))
    }
    return original(input)
  }
}

test('中断在分支步之后：分支步的结果已经落盘，而不是等整段供应结束才写', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  interruptAfterBranchStep(providers)

  await assert.rejects(
    () => core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'k-interrupt' }),
    '注入的中断必须真的打断供应',
  )

  const [record] = exportFakeStorageState(providers.storage).contexts
  assert.equal(record.status, ExecutionContextStatus.Provisioning, '中断之后上下文停在 Provisioning')
  assert.equal(
    record.branchExternalId, `work/${workItemId}`,
    '分支步已经成功，它的结果必须已经落盘——否则重放只能重跑这一步',
  )
  assert.equal(record.worktreeExternalId, undefined, '工作树步没有走到，它不得被回填')
})

test('基线前进之后重放：跳过已完成的分支步，复用既有分支而不是硬失败', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  const control = { baseMoved: false, createBranchCalls: 0 }
  localGitLikeBranch(providers, control)
  interruptAfterBranchStep(providers)

  await assert.rejects(() => core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'k-1' }))
  const branchBefore = providers.development.state.branches.find((branch) => branch.name === `work/${workItemId}`)
  assert.ok(branchBefore, '第一次尝试已经建出分支')
  const callsAfterFirstAttempt = control.createBranchCalls

  // 别人往 main 上提交了：请求里的起点因此指向另一个提交。
  control.baseMoved = true
  // 租约过期后才允许接管。
  time.advance(LEASE_MS)

  const resumed = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'k-2' })
  assert.equal(resumed.status, ExecutionContextStatus.Ready, '重放必须续上，而不是因为基线前进硬失败')
  assert.equal(resumed.writeState, WriteState.Saved)
  assert.equal(
    control.createBranchCalls, callsAfterFirstAttempt,
    '重放不得重新解析 fromRef，因此不得再调用 createBranch',
  )
  const branchAfter = providers.development.state.branches.find((branch) => branch.name === `work/${workItemId}`)
  assert.equal(branchAfter.headCommit, branchBefore.headCommit, '复用的是既有分支，它的头提交没有被改写')
  assert.equal(providers.development.state.branches.filter((b) => b.name === `work/${workItemId}`).length, 1)
  assert.equal(providers.development.state.worktrees.length, 1)
})

test('接管不静默：被复用分支的头提交出现在结果面', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  const control = { baseMoved: false, createBranchCalls: 0 }
  localGitLikeBranch(providers, control)
  interruptAfterBranchStep(providers)

  await assert.rejects(() => core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'k-1' }))
  const branchBefore = providers.development.state.branches.find((branch) => branch.name === `work/${workItemId}`)
  assert.ok(branchBefore)

  control.baseMoved = true
  time.advance(LEASE_MS)
  const resumed = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'k-2' })

  assert.equal(
    resumed.branchHeadCommit, branchBefore.headCommit,
    '复用了哪个提交是事实，必须报出来——接管不能是静默的',
  )
})

test('空白 branchName 被拒：不得把空分支名送进供应序列', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers, controllableClock().clock)
  const workItemId = await workItemIdOf(core)
  const branchesBefore = providers.development.state.branches.length

  const result = await core.commands.startWork({ ...REQUEST, workItemId, branchName: '   ', idempotencyKey: 'blank-branch' })

  assert.equal(result.error?.code, 'invalid_input')
  assert.equal(providers.development.state.branches.length, branchesBefore)
  assert.equal(providers.development.state.worktrees.length, 0)
})

test('退化的工作项 id 被拒：不得塌成共享的 work/work-item 分支名', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers, controllableClock().clock)

  const result = await core.commands.startWork({ ...REQUEST, workItemId: '---', idempotencyKey: 'k-degenerate' })

  assert.equal(result.error?.code, 'invalid_input', '归一化后为空的工作项 id 是输入错误，必须结构化拒绝')
  assert.equal(
    providers.development.state.branches.some((branch) => branch.name === 'work/work-item'), false,
    '不得产生共享的退化分支名——身份就是名字，可猜的名字不是身份',
  )
  assert.equal(providers.development.state.worktrees.length, 0)
})

test('重放不得改变已决定的分支身份：请求声明另一个分支名是结构化失败（#183）', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  const control = { baseMoved: false, createBranchCalls: 0 }
  localGitLikeBranch(providers, control)
  interruptAfterBranchStep(providers)

  await assert.rejects(
    () => core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'identity-a', branchName: 'work/alpha' }),
  )
  assert.equal(
    exportFakeStorageState(providers.storage).contexts[0].branchExternalId, 'work/alpha',
    '前置条件：序列已经决定了分支身份',
  )

  // 那个分支**确实存在**（用公开 API 直接建）。这一点是本用例的要害：只有它存在，
  // 「工作树步用本次请求的分支名」这条路才走得通；走通了才危险——wire 会报已决定的身份，
  // 而磁盘上的工作树落在另一个分支上。
  const repository = providers.development.state.repositories[0].ref
  await providers.development.createBranch({ repository, name: 'work/beta', fromRef: 'main' })

  time.advance(LEASE_MS)
  const resumed = await core.commands.startWork({
    ...REQUEST, workItemId, idempotencyKey: 'identity-b', branchName: 'work/beta',
  })

  assert.equal(resumed.error?.code, 'invalid_input', '重放声明一个不同的分支名是矛盾，必须结构化拒绝')
  assert.match(resumed.error.message, /work\/alpha/, '消息必须点名已决定的身份')
  assert.match(resumed.error.message, /work\/beta/, '消息必须点名本次请求声明的分支名')
  assert.equal(
    providers.development.state.worktrees.length, 0,
    '被拒的重放不得留下工作树——若它成功，工作树会落在 work/beta 而身份报的是 work/alpha',
  )
})

test('不去猜：记录里没有 branchExternalId 时，即使分支已存在也必须重走分支步（#183）', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  const control = { baseMoved: false, createBranchCalls: 0 }
  localGitLikeBranch(providers, control)

  // 分支已经存在（别人建的，或者更早一次尝试留下的），但**记录里没有它**。
  // 「分支存在」不等于「这一步做过」——跳过它就是拿「名字看起来像」当所有权。
  const repository = providers.development.state.repositories[0].ref
  await providers.development.createBranch({ repository, name: `work/${workItemId}`, fromRef: 'main' })
  const branchesBefore = providers.development.state.branches.length
  // 前置创建本身也走同一个被计数的包装，所以只统计 `startWork` 期间新增的调用。
  const callsBefore = control.createBranchCalls

  const result = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'k-guess' })

  assert.equal(result.status, ExecutionContextStatus.Ready, '既有分支会被复用，供应必须成功')
  assert.equal(
    control.createBranchCalls - callsBefore, 1,
    '记录里没有 branchExternalId 时必须重新走分支步——不得因为分支已存在就跳过（那是「猜」）',
  )
  assert.equal(providers.development.state.branches.length, branchesBefore, '复用既有分支，不产生第二个')
})

test('重放省略 branchName 时仍然用已决定的身份，不回落到默认名（#183）', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  const control = { baseMoved: false, createBranchCalls: 0 }
  localGitLikeBranch(providers, control)
  interruptAfterBranchStep(providers)

  // 记录执行步拿到的 run command：序列已经决定了身份，第三步必须用它，而不是本次请求重新算出来的名字。
  const commands = []
  const originalStartRun = providers.execution.startRun.bind(providers.execution)
  providers.execution.startRun = async (input) => {
    commands.push(input.command)
    return originalStartRun(input)
  }

  await assert.rejects(
    () => core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'omit-a', branchName: 'work/alpha' }),
  )
  time.advance(LEASE_MS)

  // 这一次**不声明** branchName，于是本次请求算出来的默认名是 `work/<slug>`，与已决定的 `work/alpha` 不同。
  // 序列已经决定了身份，后续步骤必须用它；回落到默认名会让工作树落在另一个分支（或干脆找不到分支）。
  const resumed = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'omit-b' })

  assert.equal(resumed.status, ExecutionContextStatus.Ready, '省略 branchName 的重放必须续上')
  assert.equal(resumed.branchExternalId, 'work/alpha', '身份来自记录，不是本次请求算出来的默认名')
  const worktrees = providers.development.state.worktrees
  assert.equal(worktrees.length, 1)
  assert.equal(worktrees[0].branch, 'work/alpha', '工作树必须落在已决定的分支上')
  assert.equal(
    providers.development.state.branches.some((branch) => branch.name === `work/${workItemId}`), false,
    '不得因为省略 branchName 就按默认名建出第二个分支',
  )
  assert.deepEqual(
    commands, ['harness run work/alpha'],
    '第三步（启动执行）必须用序列已决定的分支身份；回落到本次请求的默认名会指向一个不存在的分支',
  )
})
