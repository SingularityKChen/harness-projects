/**
 * 步骤级回填与重放跳过（issue #183）。
 *
 * 看护的不变量：补偿序列**每一步成功后立刻落盘**，所以中断在两步之间的上下文能续——
 * 重放跳过已完成的分支步、不重新解析 `fromRef`，「基线是否前进」因此不进入判定。
 *
 * 为什么需要覆写离线替身的 `createBranch`：仓库的离线 Development 替身**完全不看
 * `fromRef`**（它只把 `fromRef` 当分支名查 head，同名一律报 `Conflict`），所以它表达不了
 * 「同名分支指向别处」这个真实拒绝。这里用最小的覆写复刻真实本地 Git provider 的拒绝语义
 * （同名同起点 → `ok`；同名不同起点 → `invalid_input`），把「基线前进」变成可观测的输入。
 * 真实临时仓库上的证据在 `local-git-start-work-resume.test.js`（恢复）与
 * `local-git-branch-probe.test.js`（分支多于一页）；本文件只在离线替身上作证。SQLite 与重启
 * 仍归 #141（它被 #137 / #120 阻塞）。
 *
 * 恢复正控用明确拒绝表示工作树确定未创建；分支事实仍由步骤回填保存。
 * throw 与丢 ack 的保守阻挡由 external-intent suite 独立验证。
 */
import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { providerErr, providerError, providerOk } from '@harness-projects/capabilities'
import { composeCore, contextIdFor } from '@harness-projects/core'
import { ExecutionContextStatus, ProviderErrorCode, WriteState, newWorkspaceId } from '@harness-projects/domain'
import { FaultKind, createFakeProviders, exportFakeStorageState, refOf } from '@harness-projects/provider-fake'

const WORKSPACE = { id: newWorkspaceId(), name: 'recovery' }
const REQUEST = { task: 'Synthetic explicit task', repositoryId: 'repo-alpha', actor: { kind: 'agent' } }
const LEASE_MS = 31_000

/** 可控时钟：租约过期由测试显式决定，不靠真实等待。 */
function controllableClock() {
  let now = Date.parse('2026-09-24T00:00:00.000Z')
  return { clock: () => new Date(now).toISOString(), advance: (ms) => { now += ms } }
}

async function workItemIdOf(core) {
  const item = (await core.queries.listPlanningItems()).find((view) => view.kind === 'work_item' && view.content.contentKind === 'work_item') // redacted 条目的 kind 也是 work_item（issue-3），但没有可操作的规划条目，不能当开始工作的对象
  assert.ok(item, '离线替身必须提供一个工作项')
  return item.entityId
}

const compose = (providers, clock) => composeCore({ workspace: WORKSPACE, providers, clock })

/** 确定拒绝工作树后允许显式恢复；已 ack 的分支身份仍应保留。 */
function refuseWorktreeOnce(providers) {
  const original = providers.development.createWorktree.bind(providers.development)
  let interrupted = true
  providers.development.createWorktree = async (input) => {
    if (interrupted) {
      interrupted = false
      return providerErr(providerError(ProviderErrorCode.Unavailable, '确定未创建工作树'))
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

test('工作树明确拒绝后：已 ack 的分支结果仍然保留', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  refuseWorktreeOnce(providers)

  assert.equal((await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'k-interrupt' })).writeState, 'failed')

  const [record] = exportFakeStorageState(providers.storage).contexts
  assert.equal(record.status, ExecutionContextStatus.Failed, '明确拒绝后上下文停在 Failed，已 ack 分支保留')
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
  refuseWorktreeOnce(providers)

  assert.equal((await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'k-1' })).writeState, 'failed')
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
  refuseWorktreeOnce(providers)

  assert.equal((await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'k-1' })).writeState, 'failed')
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
  refuseWorktreeOnce(providers)

  assert.equal((await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'identity-a', branchName: 'work/alpha' })).writeState, 'failed')
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
  refuseWorktreeOnce(providers)

  // 记录执行步的任务与目录：任务原文不拼入分支，目录唯一来自 Git ack。
  const commands = []
  const originalStartRun = providers.execution.startRun.bind(providers.execution)
  providers.execution.startRun = async (input) => {
    commands.push({ command: input.command, workingDirectory: input.workingDirectory })
    return originalStartRun(input)
  }

  assert.equal((await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'omit-a', branchName: 'work/alpha' })).writeState, 'failed')
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
    commands, [{ command: REQUEST.task, workingDirectory: worktrees[0].path }],
    '任务保持原文，执行目录来自承载已决定分支的工作树 ack',
  )
})

/** 在替身里补 `count` 个排在 `work/` 之前的诱饵分支（`a-000…`），把 `work/<id>` 挤出 `limit: 100` 的第一页。
 *  100 是 `git-provisioning.ts` 的 `PROBE_PAGE_SIZE`；调大它必须同步调大诱饵数，否则用例退化成单页仍是绿的。 */
function addDecoyBranches(providers, count) {
  const seed = providers.development.state.branches[0]
  const bindingId = seed.ref.bindingId
  for (let index = 0; index < count; index += 1) {
    const name = `a-${String(index).padStart(3, '0')}`
    providers.development.state.branches.push({
      repository: seed.repository, ref: refOf(bindingId, 'branch', name), name, headCommit: seed.headCommit,
    })
  }
  return seed.repository
}

test('conflict 复用：目标分支排在第一页之外时仍被认出，而不是 failed / conflict（P3）', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers, controllableClock().clock)
  const workItemId = await workItemIdOf(core)
  const repository = addDecoyBranches(providers, 110)
  const name = `work/${workItemId}`
  providers.development.state.branches.push({
    repository, ref: refOf(providers.development.gate.bindingId, 'branch', name), name, headCommit: 'sha-1',
  })
  const firstPage = await providers.development.listBranches({ repository, cursor: undefined, limit: 100 })
  assert.equal(firstPage.value.items.some((branch) => branch.name === name), false, '前置条件：目标分支不在第一页')
  assert.notEqual(firstPage.value.nextCursor, undefined, '前置条件：还有下一页')

  const result = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'k-conflict-paged' })

  assert.equal(result.status, ExecutionContextStatus.Ready, '同名分支在第二页：conflict 后必须读完全部页才说不存在')
  assert.equal(result.branchHeadCommit, 'sha-1', '复用的头提交必须报出来')
})

test('conflict 后列表读取失败只报 unknown，恢复读取也不能用新键盲写', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers, controllableClock().clock)
  const workItemId = await workItemIdOf(core)
  const repository = providers.development.state.repositories[0].ref
  const name = `work/${workItemId}`
  const created = await providers.development.createBranch({ repository, name, fromRef: 'main' })
  assert.equal(created.ok, true, '前置条件：目标分支确实存在，createBranch 将报 conflict')
  const originalList = providers.development.listBranches.bind(providers.development)
  providers.development.listBranches = async () => providerErr(providerError(ProviderErrorCode.Unavailable, '临时列表故障'))

  const uncertain = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'k-conflict-list-unavailable' })

  assert.equal(uncertain.writeState, WriteState.Unknown, '列表未读完，不能确定分支是否可接管')
  assert.equal(uncertain.confirmed, false, '没有读回证据，不得显示 Saved')
  assert.equal(uncertain.error?.code, 'unavailable', '保留探测失败原因，不伪装成确定的 conflict')
  assert.equal(providers.development.state.worktrees.length, 0, '未知状态下不得创建工作树')

  providers.development.listBranches = originalList
  const resumed = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'k-conflict-list-recovered' })
  assert.equal(resumed.writeState, WriteState.Unknown, '列表恢复不证明此前写入未发生，不能用新键盲写')
  assert.equal(resumed.branchExternalId, undefined)
  assert.equal(providers.development.state.branches.filter((branch) => branch.name === name).length, 1)
})

test('游标永不结束：探测读到页数上限后报 unknown，不判成不存在也不挂住（P4）', { timeout: 5000 }, async () => {
  const providers = createFakeProviders()
  providers.development.faultsSwitch.set(FaultKind.AmbiguousCreate, true)
  const core = await compose(providers, controllableClock().clock)
  const workItemId = await workItemIdOf(core)
  let calls = 0
  // 每次调用让出一个宏任务：只跑微任务的死循环会饿死计时器，超时断言就永远不触发。
  providers.development.listBranches = async () => {
    calls += 1
    await new Promise((resolve) => setImmediate(resolve))
    return providerOk({ items: [], nextCursor: 'again' })
  }

  const result = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'k-endless' })

  assert.equal(result.writeState, WriteState.Unknown, '读不完只能说不知道，不能 markFailed')
  assert.equal(result.error.code, 'result_unknown')
  assert.ok(calls > 1, `探测必须跟着游标继续读（实际调用 ${calls} 次）`)
})

/**
 * 重启对账（issue #191）：同 key 重放一个未决 Git 外部写时，必须**先做一次只读对账**，
 * 用对账结论决定「采纳 / 重发 / 冲突 / 未知」，而不是把持久化的 `unknown` 逐字回放。
 *
 * 判别点都在「探针计数」与「外部写计数」上：只断言最终 saved 无法区分「重发了一次写」
 * 与「采纳了既有对象」。
 */
test('同 key 重放：外部已建同名分支时采纳，不重发 createBranch（#191）', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  const control = { baseMoved: false, createBranchCalls: 0 }
  localGitLikeBranch(providers, control)
  const repository = providers.development.state.repositories[0].ref
  const name = `work/${workItemId}`
  assert.equal((await providers.development.createBranch({ repository, name, fromRef: 'main' })).ok, true, '前置条件：目标分支已经真的存在')
  const branchBefore = providers.development.state.branches.find((branch) => branch.name === name)
  const originalList = providers.development.listBranches.bind(providers.development)
  providers.development.listBranches = async () => providerErr(providerError(ProviderErrorCode.Unavailable, '临时列表故障'))

  const interrupted = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'adopt-branch' })
  assert.equal(interrupted.writeState, WriteState.Unknown, '读不到分支列表时只能报 unknown')
  const branchCallsAfterFirst = control.createBranchCalls
  const runsAfterFirst = providers.execution.state.runs.length

  let probes = 0
  providers.development.listBranches = async (input) => { probes += 1; return originalList(input) }
  time.advance(LEASE_MS)
  const resumed = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'adopt-branch' })

  assert.equal(resumed.writeState, WriteState.Saved, '恢复可读后同 key 重放必须收敛到 Saved')
  assert.equal(resumed.confirmed, true)
  assert.equal(resumed.status, ExecutionContextStatus.Ready)
  assert.equal(resumed.branchExternalId, name, '采纳的分支名来自持久意图，不是本次请求重新推导的')
  assert.equal(resumed.branchHeadCommit, branchBefore.headCommit, '采纳必须报出被采纳分支的头提交')
  assert.ok(probes >= 1, '同 key 重放必须先做只读对账（探针至少要跑一次）')
  assert.equal(control.createBranchCalls, branchCallsAfterFirst, '分支已被证明落地，不得重发 createBranch')
  assert.equal(providers.development.state.worktrees.length, 1, '采纳之后只允许一份工作树')
  assert.equal(providers.execution.state.runs.length, runsAfterFirst + 1, '采纳之后只启动一个 run')
  assert.equal((await providers.storage.findMutationAttempt(WORKSPACE.id, 'adopt-branch')).state, 'saved')
})

test('同 key 重放：工作树已落盘但 ack 丢失时采纳，不重发 createWorktree（#191）', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  const original = providers.development.createWorktree.bind(providers.development)
  let createCalls = 0, lost = true
  providers.development.createWorktree = async (input) => {
    createCalls += 1
    const result = await original(input)
    if (lost) { lost = false; throw new Error('测试注入：工作树写入落盘后 ack 丢失') }
    return result
  }

  const first = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'adopt-worktree' })
  assert.equal(first.writeState, WriteState.Unknown, 'ack 丢失时只能报 unknown')
  const landed = providers.development.state.worktrees[0]
  assert.ok(landed, '前置条件：工作树已经真的落盘')
  const originalGet = providers.development.getWorktree.bind(providers.development)
  let probes = 0
  providers.development.getWorktree = async (input) => { probes += 1; return originalGet(input) }

  time.advance(LEASE_MS)
  const resumed = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'adopt-worktree' })

  assert.equal(resumed.writeState, WriteState.Saved)
  assert.equal(resumed.status, ExecutionContextStatus.Ready)
  assert.ok(probes >= 1, '工作树对账必须用持久句柄读回')
  assert.equal(createCalls, 1, '工作树已被证明落地，不得重发 createWorktree')
  assert.equal(providers.development.state.worktrees.length, 1, '采纳不得产生第二份工作树')
  assert.equal(resumed.worktreeExternalId, landed.path, '采纳必须报出已落盘的那份工作树')
})

test('同 key 重放：工作树确定不存在时重发一次并收敛（#191）', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  const original = providers.development.createWorktree.bind(providers.development)
  let createCalls = 0
  providers.development.createWorktree = async (input) => {
    createCalls += 1
    if (createCalls === 1) throw new Error('测试注入：工作树没有落盘就中断')
    return original(input)
  }

  assert.equal((await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'absent-worktree' })).writeState, WriteState.Unknown)
  assert.equal(providers.development.state.worktrees.length, 0, '前置条件：工作树确定没有落盘')
  const originalGet = providers.development.getWorktree.bind(providers.development)
  let probes = 0
  providers.development.getWorktree = async (input) => { probes += 1; return originalGet(input) }

  time.advance(LEASE_MS)
  const resumed = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'absent-worktree' })

  assert.equal(resumed.writeState, WriteState.Saved, '确定不存在时必须重发那一步并收敛')
  assert.equal(resumed.status, ExecutionContextStatus.Ready)
  assert.ok(probes >= 1, '重发之前必须先读回确认不存在')
  assert.equal(createCalls, 2, '确定不存在时恰好重发一次 createWorktree')
  assert.equal(providers.development.state.worktrees.length, 1)
})

test('同 key 重放：工作树检出别的分支时结构化冲突，零写入（#191）', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  const original = providers.development.createWorktree.bind(providers.development)
  let createCalls = 0, lost = true
  providers.development.createWorktree = async (input) => {
    createCalls += 1
    const result = await original(input)
    if (lost) { lost = false; throw new Error('测试注入：工作树写入落盘后 ack 丢失') }
    return result
  }
  const name = `work/${workItemId}`
  assert.equal((await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'conflict-worktree' })).writeState, WriteState.Unknown)
  // 已落盘的工作树现在检出别的分支：采纳它就是拿错误的身份冒充这次供应。
  providers.development.state.worktrees[0].branch = 'work/other'
  const contextBefore = exportFakeStorageState(providers.storage).contexts[0]
  const attemptBefore = await providers.storage.findMutationAttempt(WORKSPACE.id, 'conflict-worktree')
  const branchesBefore = providers.development.state.branches.length
  const runsBefore = providers.execution.state.runs.length

  time.advance(LEASE_MS)
  const resumed = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'conflict-worktree' })

  assert.equal(resumed.writeState, WriteState.Conflict, '工作树分支不一致必须是结构化冲突，不是 adopted')
  assert.match(resumed.error.message, new RegExp(name), '冲突消息必须点名持久意图里的分支')
  assert.match(resumed.error.message, /work\/other/, '冲突消息必须点名读到的分支')
  assert.equal(createCalls, 1, '冲突路径不得重发外部写')
  assert.equal(providers.development.state.branches.length, branchesBefore)
  assert.equal(providers.execution.state.runs.length, runsBefore)
  assert.deepEqual(exportFakeStorageState(providers.storage).contexts[0], contextBefore, '冲突路径零写入：上下文记录一字不改')
  assert.deepEqual(await providers.storage.findMutationAttempt(WORKSPACE.id, 'conflict-worktree'), attemptBefore, '冲突路径零写入：未决槽位一字不改')
})

test('负控：在途的同 key 重放不得探测（#191）', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  const original = providers.development.createWorktree.bind(providers.development)
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  providers.development.createWorktree = async (input) => { entered.resolve(); await release.promise; return original(input) }
  let probes = 0
  const list = providers.development.listBranches.bind(providers.development)
  providers.development.listBranches = async (input) => { probes += 1; return list(input) }
  const get = providers.development.getWorktree.bind(providers.development)
  providers.development.getWorktree = async (input) => { probes += 1; return get(input) }

  const running = core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'inflight-same' })
  await entered.promise
  try {
    const recordBefore = exportFakeStorageState(providers.storage).contexts[0]
    const replay = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'inflight-same' })
    assert.equal(replay.writeState, WriteState.Pending, '在途的同 key 重放仍报在途')
    assert.equal(probes, 0, 'attempt 不是 unknown 时不得做对账读：在途不是未决结论')
    assert.deepEqual(exportFakeStorageState(providers.storage).contexts[0], recordBefore, '在途重放不得改写记录')
  } finally { release.resolve(); await running }
})

test('负控：旧代际的同 key 重放不得探测（#191）', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, time.clock)
  const workItemId = await workItemIdOf(core)
  const create = providers.development.createBranch.bind(providers.development)
  let createCalls = 0
  providers.development.createBranch = async (input) => { createCalls += 1; await create(input); throw new Error('测试注入：分支写入落盘后 ack 丢失') }

  assert.equal((await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'old-generation' })).writeState, WriteState.Unknown)
  const contextId = contextIdFor(WORKSPACE.id, workItemId, REQUEST.repositoryId)
  const record = await providers.storage.getExecutionContext(contextId)
  await providers.storage.putExecutionContext({ ...record, provisioningGeneration: record.provisioningGeneration + 1 })
  const bumped = await providers.storage.getExecutionContext(contextId)
  let probes = 0
  const list = providers.development.listBranches.bind(providers.development)
  providers.development.listBranches = async (input) => { probes += 1; return list(input) }
  const get = providers.development.getWorktree.bind(providers.development)
  providers.development.getWorktree = async (input) => { probes += 1; return get(input) }

  time.advance(LEASE_MS)
  const replay = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'old-generation' })

  assert.equal(replay.writeState, WriteState.Unknown, '旧代际的同 key 重放仍保守报 unknown')
  assert.equal(probes, 0, 'intent 的代际与记录不一致时不得探测')
  assert.deepEqual(await providers.storage.getExecutionContext(contextId), bumped, '记录一字不改')
  assert.equal(createCalls, 1, '旧代际重放不得再发起外部写')
})
