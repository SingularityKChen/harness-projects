/**
 * Start Work 的恢复在**真实临时 Git 仓库**上的验收（issue #183）：中断在分支步之后、`main` 前进、换新幂等键重试。
 *
 * 判据是磁盘事实与 Git argv，不是 provider 返回值的形状：重试期间没有任何一条命令解析 `fromRef`，才说明
 * 「基线是否前进」没有进入判定。夹具没有执行 provider，`result.error` 恒为 `not_supported`，所以成功判据
 * 用 `status` / `confirmed`，不用 `error`（见 local-git-core-provisioning.test.js 的同一约定）。
 * 分页与探测在 `local-git-branch-probe.test.js`；SQLite 与重启归 #141。
 */
import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

import { ExecutionContextStatus, RelationType } from '@harness-projects/domain'
import { contextIdFor, startWork } from '@harness-projects/core'

import {
  LEASE_EXPIRED_MS, REPOSITORY_ID, advanceMain, controllableClock, coreContextFor, fixtureFor, git,
  interruptAfterBranchStep, providerFor, recordingRunner, worktreePaths,
} from './local-git-fixture.js'

const request = (workItemId, idempotencyKey) => ({
  workItemId, repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey,
})

const branchHead = async (fixture, name) => (await fixture.run(['rev-parse', name])).trim()

/** 中断在分支步之后：分支真实落地，工作树步「进程死掉」，记录停在 `provisioning` 且已带分支身份。 */
async function interruptedAttempt(fixture, workItemId) {
  const clock = controllableClock()
  const recorder = recordingRunner()
  const provider = interruptAfterBranchStep(providerFor(fixture, { runGit: recorder.runGit }))
  const { storage, workspaceId, context } = await coreContextFor(fixture, { development: provider }, { clock: clock.clock })
  await assert.rejects(startWork(context, request(workItemId, 'k-1')), /测试注入的中断/)
  const contextId = contextIdFor(workspaceId, workItemId, REPOSITORY_ID)
  const record = await storage.getExecutionContext(contextId)
  assert.equal(record?.status, ExecutionContextStatus.Provisioning, '中断后记录必须停在 provisioning')
  assert.equal(record.branchExternalId, `work/${workItemId}`, '分支步已成功：分支身份必须已经回填')
  assert.equal(record.worktreeExternalId, undefined, '工作树步没有走到')
  return { clock, recorder, storage, workspaceId, context, contextId }
}

/** 「重启后换一套能力重新组装」：同一 storage、同一 workspace、同一时钟，只换 Development provider。 */
async function reassembled(fixture, { storage, workspaceId, clock }, development) {
  return (await coreContextFor(fixture, { development }, { storage, workspaceId, clock: clock.clock })).context
}

const withoutWorktreeCreate = (fixture) => providerFor(fixture, { capabilities: { worktreeCreate: false } })

test('R1 基线前进后换新键重试：接管既有分支、不解析 fromRef，工作树落在中断前的分支上', async (t) => {
  const fixture = await fixtureFor(t)
  const attempt = await interruptedAttempt(fixture, 'wi-3')
  const before = await branchHead(fixture, 'work/wi-3')
  assert.equal(before, fixture.headCommit, '中断时分支指向当时的 main')
  const moved = await advanceMain(fixture)
  assert.notEqual(moved, before, '前置条件：main 已经前进')
  attempt.clock.advance(LEASE_EXPIRED_MS)
  const mark = attempt.recorder.calls.length

  const retried = await startWork(attempt.context, request('wi-3', 'k-2'))

  assert.equal(retried.status, ExecutionContextStatus.Ready, `基线前进不得让重试失败：${retried.error?.code} ${retried.error?.message}`)
  assert.equal(retried.confirmed, true)
  assert.equal(retried.branchExternalId, 'work/wi-3')
  assert.equal(retried.branchHeadCommit, before, '接管报出的是中断前的分支头')
  assert.notEqual(retried.branchHeadCommit, moved, '不得被新的 main 头替换')
  const argv = attempt.recorder.calls.slice(mark)
  assert.ok(argv.length > 0, '重试必须真的调用了 Git（工作树步与探测）')
  assert.equal(argv.some((args) => args.includes('branch')), false, '重试期间不得再执行 git branch')
  assert.equal(argv.some((args) => args.some((arg) => arg.includes('main^{commit}'))), false, '重试期间不得解析 fromRef')
  assert.equal(argv.some((args) => args.includes('symbolic-ref')), false, '重试期间不得探测仓库基线')
  assert.equal(await branchHead(fixture, 'work/wi-3'), before, '磁盘上的分支头仍是中断前的那个')
  const expectedWorktree = path.join(fixture.repositoryPath, '.worktrees', 'wi-3')
  assert.equal((await worktreePaths(fixture)).length, 2, '工作树数为主检出 + 1')
  assert.equal(
    (await git(['rev-parse', '--abbrev-ref', 'HEAD'], expectedWorktree)).trim(), 'work/wi-3',
    '新工作树检出的是中断前建的分支',
  )
  assert.equal(await realpath(retried.worktreeExternalId), await realpath(expectedWorktree))
})

test('R2 Development 能力不可用的失败不抹掉已决定的分支，恢复后在基线前进下仍 ready', async (t) => {
  const fixture = await fixtureFor(t)
  const attempt = await interruptedAttempt(fixture, 'wi-3')
  const before = await branchHead(fixture, 'work/wi-3')
  attempt.clock.advance(LEASE_EXPIRED_MS)

  // 「重启后 Development 能力关闭」：换一套不含工作树创建的能力重新组装。
  const failed = await startWork(await reassembled(fixture, attempt, withoutWorktreeCreate(fixture)), request('wi-3', 'k-2'))

  assert.equal(failed.status, ExecutionContextStatus.Failed)
  assert.equal(failed.error?.code, 'not_supported', '能力不可用必须如实报 not_supported')
  const record = await attempt.storage.getExecutionContext(attempt.contextId)
  assert.equal(record?.branchExternalId, 'work/wi-3', '记录里已决定的分支身份不得被抹掉')
  assert.equal(failed.branchExternalId, 'work/wi-3', '结果面报出的就是记录里存下的那个')
  const relations = await attempt.storage.listRelations(attempt.workspaceId)
  assert.equal(relations.filter((relation) => relation.type === RelationType.HasWorktree).length, 0,
    '能力不可用的那次不得新写 has_worktree（不扩大 #192）')

  await advanceMain(fixture)
  const retried = await startWork(await reassembled(fixture, attempt, providerFor(fixture)), request('wi-3', 'k-3'))

  assert.equal(retried.status, ExecutionContextStatus.Ready, `恢复能力后在基线前进下仍必须 ready：${retried.error?.code} ${retried.error?.message}`)
  assert.equal(retried.confirmed, true)
  assert.equal(retried.branchHeadCommit, before)
  assert.equal(await branchHead(fixture, 'work/wi-3'), before)
})

test('R3 失败的尝试只保留已决定的分支，不保留工作树句柄', async (t) => {
  const fixture = await fixtureFor(t)
  const attempt = await interruptedAttempt(fixture, 'wi-5')
  // 记录带着一个更早观察到的工作树句柄。生产上的来源：`ready` 上下文核验失败后 `existingResult` 把记录转为
  // `failed` 但保留句柄，下一次开始工作接管终态时原样展开它。这里直接写入，不依赖那条路径（它的语义归 #211）。
  const interrupted = await attempt.storage.getExecutionContext(attempt.contextId)
  await attempt.storage.putExecutionContext({ ...interrupted, worktreeExternalId: path.join(fixture.root, 'stale-worktree') })
  attempt.clock.advance(LEASE_EXPIRED_MS)

  const failed = await startWork(await reassembled(fixture, attempt, withoutWorktreeCreate(fixture)), request('wi-5', 'k-2'))

  assert.equal(failed.error?.code, 'not_supported')
  const record = await attempt.storage.getExecutionContext(attempt.contextId)
  assert.equal(record?.branchExternalId, 'work/wi-5', '已决定的分支身份写一次')
  assert.equal(record.worktreeExternalId, undefined,
    '没走到工作树步的失败尝试不得留下旧句柄：谱系把它当作已观察到的锚点，会在它上面读头提交与变更请求')
})
