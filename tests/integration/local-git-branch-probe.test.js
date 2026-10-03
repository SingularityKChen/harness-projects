/**
 * 分支探测读完全部页（#183 剩余项 ②）：真实临时仓库上，分支多于一页时 `startWork` 仍给出正确事实。
 *
 * 本地 Git 的 `listBranches` 按名字排序分页，`a-000…` 诱饵分支排在 `work/` 之前，把目标挤出
 * `limit: 100` 的第一页。两个消费者在这里作证：接管路径的头提交报告（P1），以及「写入已落地但响应丢失」
 * 的对账（P2）。成功判据用 `status` / `confirmed` / 磁盘事实，不用 `result.error`：夹具没有执行 provider，
 * 所以 `error` 恒为 `not_supported`（见 `local-git-core-provisioning.test.js` 的约定）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ExecutionContextStatus } from '@harness-projects/domain'
import { startWork } from '@harness-projects/core'
import { defaultGitRunner } from '@harness-projects/provider-development-local-git'

import {
  LEASE_EXPIRED_MS, REPOSITORY_ID, addDecoyBranches, controllableClock, coreContextFor, fixtureFor,
  interruptAfterBranchStep, providerFor, registerWorkItem, repositoryRef, worktreePaths,
} from './local-git-fixture.js'

/** 目标前面有 DECOYS 个诱饵加 `main`，下标是 DECOYS + 1；`git-provisioning.ts` 的 `PROBE_PAGE_SIZE` 为 100 时
 *  诱饵数 ≤ 98 就会让目标落进第一页（变异 M9）。页大小只影响调用次数、不影响语义；调大它必须同步调大这里，
 *  否则两个用例退化成单页仍是绿的。 */
const DECOYS = 110
const request = (workItemId, idempotencyKey) => ({ workItemId, repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey })
const workBranches = async (fixture) => (await fixture.run(['for-each-ref', '--format=%(refname:short)', 'refs/heads/work']))
  .trim().split('\n').filter((name) => name !== '')

test('接管：目标分支排在第一页之外时，头提交仍被报出（P1）', async (t) => {
  const fixture = await fixtureFor(t)
  await addDecoyBranches(fixture, DECOYS)
  const provider = providerFor(fixture)
  const time = controllableClock()
  const { context, storage, workspaceId } = await coreContextFor(fixture, { development: interruptAfterBranchStep(provider) }, { clock: time.clock })
  await registerWorkItem(storage, workspaceId, 'wi-probe')

  await assert.rejects(() => startWork(context, request('wi-probe', 'k-1')), '注入的中断必须真的打断供应')
  const firstPage = await provider.listBranches({ repository: repositoryRef, cursor: undefined, limit: 100 })
  assert.equal(firstPage.value.items.some((branch) => branch.name === 'work/wi-probe'), false, '前置条件：目标分支不在第一页')
  assert.notEqual(firstPage.value.nextCursor, undefined, '前置条件：还有下一页')

  time.advance(LEASE_EXPIRED_MS)
  const resumed = await startWork(context, request('wi-probe', 'k-2'))

  assert.equal(resumed.status, ExecutionContextStatus.Ready)
  assert.equal(resumed.confirmed, true)
  const onDisk = (await fixture.run(['rev-parse', 'work/wi-probe'])).trim()
  assert.equal(resumed.branchHeadCommit, onDisk, '接管必须报出磁盘上真实的分支头，而不是 undefined')
})

test('对账：写入已落地但响应丢失、分支多于一页时，不得报「创建未生效」（P2）', async (t) => {
  const fixture = await fixtureFor(t)
  await addDecoyBranches(fixture, DECOYS)
  // 真实执行 `git branch <name> <sha>`，然后回一个不被 provider 识别的失败：写入落地了、响应丢了。
  const lossy = async (args) => {
    const result = await defaultGitRunner(args)
    if (args[2] === 'branch' && result.code === 0) return { code: 128, stdout: '', stderr: 'fatal: connection reset while writing' }
    return result
  }
  const { context, storage, workspaceId } = await coreContextFor(fixture, { development: providerFor(fixture, { runGit: lossy }) })
  await registerWorkItem(storage, workspaceId, 'wi-lossy')

  const result = await startWork(context, request('wi-lossy', 'k-1'))

  const firstPage = await providerFor(fixture).listBranches({ repository: repositoryRef, cursor: undefined, limit: 100 })
  assert.equal(firstPage.value.items.some((branch) => branch.name === 'work/wi-lossy'), false, '前置条件：落地的分支不在第一页')
  assert.notEqual(result.error?.code, 'not_found', '分支就在磁盘上，不得被对账判成未创建')
  assert.equal(result.status, ExecutionContextStatus.Ready)
  assert.equal(result.confirmed, true)
  assert.equal(result.branchHeadCommit, fixture.headCommit, '头提交等于 main 的头')
  assert.deepEqual(await workBranches(fixture), ['work/wi-lossy'], '磁盘上恰有一条工作分支')
  assert.equal((await worktreePaths(fixture)).length, 2, '工作树数为主检出 + 1')
})
