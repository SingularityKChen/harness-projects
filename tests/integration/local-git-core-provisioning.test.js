/**
 * 本地 Git provider 接进 **core 供应序列**的验收：`startWork` / `provisionGit` 在真实临时仓库上跑，
 * 断言的是磁盘事实与系统状态（`ready` / 关系数），不是 provider 的返回值形状。
 *
 * 分层：provider 自身的行为（路径安全、分支身份、能力子集、写后回读）在
 * `tests/integration/development-local-git.test.js`；夹具见 `tests/integration/local-git-fixture.js`。
 */
import assert from 'node:assert/strict'
import { mkdir, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

import { ExecutionContextStatus, RelationType } from '@harness-projects/domain'
import { namesFor, provisionGit, startWork } from '@harness-projects/core'
import { createLocalGitDevelopmentProvider } from '@harness-projects/provider-development-local-git'

import {
  BINDING, REPOSITORY_ID, coreContextFor, fixtureFor, git, providerFor, repositoryRef, worktreePaths,
} from './local-git-fixture.js'

/** 句柄可能相对、可能绝对：比较前统一规范化。断言的是「指向同一份工作树」这个不变量本身，
 *  **不是**「两个字符串必然不同」——后者只在调用方传相对路径时成立（第五轮评审 P2）。 */
const handlePath = (fixture, handle) => realpath(path.resolve(fixture.repositoryPath, handle))

test('core 复用：同一请求重试返回既有 worktree 与分支，不重复创建', async (t) => {
  const fixture = await fixtureFor(t)
  const { context } = await coreContextFor(fixture)
  const request = {
    workItemId: 'wi-1', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' },
    idempotencyKey: 'k-1', worktreePath: '.worktrees/wi-1',
  }
  const first = await provisionGit(context, request, namesFor(request), 'ctx-1')
  assert.equal(first.ok, true, '第一次必须真的创建')
  assert.equal(first.status, ExecutionContextStatus.Ready)
  const expectedPath = path.join(fixture.repositoryPath, '.worktrees', 'wi-1')
  assert.equal(first.worktreeExternalId, expectedPath)
  assert.equal(first.branchExternalId, 'work/wi-1')
  const second = await provisionGit(context, request, namesFor(request), 'ctx-1')
  assert.equal(second.ok, true, '同一请求重试必须复用而不是失败')
  assert.equal(second.branchExternalId, first.branchExternalId)
  // #185 统一的是**实体身份**（`worktreeEntityId` 不含路径）；**句柄**在 conflict 复用路径上仍回填 core 侧的
  // `names.path`（调用方原始字符串）。这里断言**真正的不变量**——两个句柄指向同一份工作树——而不是「两个
  // 字符串必然不同」：后者只在调用方传相对路径时成立，而且会把缺陷钉成期望值，#206 在 core 侧收口后反而
  // 会让 CI 变红（第五轮评审 P2）。
  assert.equal(
    await handlePath(fixture, second.worktreeExternalId), await handlePath(fixture, first.worktreeExternalId),
    '复用路径报告的句柄必须指向同一份工作树（字符串形态可以不同，见 #206）',
  )
  // 传绝对路径时两次句柄逐字相同：这条证明上一条断言不依赖「调用方写法」这个偶然条件。
  const absoluteRequest = { ...request, worktreePath: expectedPath }
  const absolute = await provisionGit(context, absoluteRequest, namesFor(absoluteRequest), 'ctx-1')
  assert.equal(absolute.worktreeExternalId, first.worktreeExternalId, '传绝对路径时复用路径与成功路径必须报同一个句柄')
  // 断言**总数**而不是过滤结果：先过滤成"等于 expectedPath 的项"再比较，第二份工作树只要落在别的路径上
  // 就会在比较之前被丢掉，断言观察不到它（第五轮评审 P1——独立复现：注入 stray-second 后旧断言仍 PASS）。
  assert.deepEqual(await worktreePaths(fixture), [fixture.repositoryPath, expectedPath], '重试不得产生第二份工作树（主检出 + 1）')
  const branches = (await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], fixture.repositoryPath))
    .trim().split('\n').filter((name) => name.startsWith('work/'))
  assert.deepEqual(branches, ['work/wi-1'], '重试不得产生第二个工作分支（按总数断言，不是按名字过滤）')
})

test('恢复供应：同一工作树只保留一条 has_worktree 关系（#165）', async (t) => {
  const fixture = await fixtureFor(t)
  const { storage, workspaceId, context } = await coreContextFor(fixture)
  const request = { workItemId: 'wi-165', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'k-1' }
  const first = await startWork(context, request)
  const stored = await storage.getExecutionContext(first.executionContextId)
  await storage.putExecutionContext({
    ...stored, status: ExecutionContextStatus.Provisioning,
    // 必须比 FROZEN_NOW 早超过 PROVISIONING_LEASE_MS（30 秒），否则 claimContext 走 in-flight 而不是 resume，
    // 这个用例就不再测恢复了（见夹具里 FROZEN_NOW 的注释）。
    provisioningStartedAt: '2026-09-23T00:00:00Z',
  })
  const second = await startWork(context, { ...request, idempotencyKey: 'k-2' })
  // 恢复必须**真的跑完**：只断言关系数是上界——`provision()` 在 `if (!git.ok)` 返回之前就无条件调用了
  // `recordStartFacts`，而 `worktreeEntityId` 不含路径，所以「恢复成功」「工作树步骤失败」「租约未过期被
  // in-flight 挡住」三种情况下关系数都是 1（第五轮评审 P2，两个变体都独立复现过）。
  // 判据是**供应状态**：被挡住时是 `writing / provisioning`，工作树步骤失败时是 `failed`，只有真的跑完才是
  // `confirmed / ready`。注意 `second.error` 在本夹具里是**执行绑定**的错误（这里只绑了 development，
  // 没有 execution provider），与供应无关，不能拿它当成功判据。
  assert.equal(second.status, ExecutionContextStatus.Ready, '恢复必须真的把供应做完，而不是被挡住或失败')
  assert.equal(second.confirmed, true, '恢复完成必须写成 confirmed，而不是留在 writing')
  assert.equal(typeof second.worktreeExternalId, 'string', '恢复完成必须报出工作树句柄')
  const hasWorktree = (await storage.listRelations(workspaceId)).filter((relation) => relation.type === RelationType.HasWorktree)
  // #185 统一的是**实体身份**（`worktreeEntityId` 不含路径），所以恢复不会写出第二条关系；**句柄**仍会回填
  // 调用方传入的原始字符串（见上一个用例）——那是两件不同的事实，不要混说。
  assert.equal(hasWorktree.length, 1, '恢复路径必须只写一条 has_worktree 关系（#165 / #185）')
  assert.equal(new Set(hasWorktree.map((relation) => relation.to)).size, 1, '一条关系只指向一个工作树实体')
  // #207 验收 1 要求「`startWork` … yields `ready` and the branch/worktree exist on disk」。本文件此前经
  // `startWork` 的用例只断言 storage 里的状态，磁盘回读全在 `provisionGit` 用例里（第六轮评审 P2）。这里补上，
  // 判据是**磁盘事实**而不是返回值：报 ready 就必须真的能在盘上找到这份工作树与这条分支。
  const expectedWorktree = path.join(fixture.repositoryPath, '.worktrees', 'wi-165')
  assert.deepEqual(await worktreePaths(fixture), [fixture.repositoryPath, expectedWorktree], '恢复后工作树必须真的在盘上')
  assert.equal(await handlePath(fixture, second.worktreeExternalId), await handlePath(fixture, expectedWorktree), '报出的句柄必须指向盘上那一份')
  const workBranches = (await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], fixture.repositoryPath))
    .trim().split('\n').filter((name) => name.startsWith('work/'))
  assert.deepEqual(workBranches, ['work/wi-165'], '恢复后工作分支必须真的在盘上')
})

test('供应路径上不得报 ready：登记在册但目录消失或不可复用的形态', async (t) => {
  // **范围**：本用例经 `provisionGit` 在**全新**的 context id 上构造不可复用的登记，证明的是**供应序列**不报
  // ready。已 `ready` 的上下文是另一条链路：`claimContext` 返回 `existing`，`existingResult` 用
  // `reportForExisting(Ready)` 直接回 `confirmed`，**不再问 provider**——用户正常地
  // `git worktree remove` + `git branch -D` 之后再开始工作，拿到的仍是 `ready / saved / confirmed`，而盘上
  // 没有工作树。那是 `main` 上 core 的既有行为（替身同样复现），已登记为 **#211**；本用例名与 README 行
  // 因此都限定在「供应路径」上，不声称覆盖它（第六轮评审 P2）。
  const fixture = await fixtureFor(t)
  const provider = providerFor(fixture)
  const probe = async (what, dir, workItemId, corrupt) => {
    const name = `work/${workItemId}`
    await provider.createBranch({ repository: repositoryRef, name, fromRef: 'main' })
    assert.equal((await provider.createWorktree({ repository: repositoryRef, path: dir, branch: name })).ok, true)
    await corrupt()
    const request = { workItemId, repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'k-1', worktreePath: dir }
    const outcome = await provisionGit((await coreContextFor(fixture, { development: provider })).context, request, namesFor(request), `ctx-${workItemId}`)
    // 钉住**具体的拒绝**而不是「只要不是 Ready 就算过」：后者对任何无关失败（例如 capability 门禁回归让
    // resolveWriteTarget 直接失败）都成立，探针会因为无关原因变绿（第五轮评审 P3）。不可复用的登记在
    // provider 层是硬失败 `invalid_input`，经 PROVIDER_TO_PROJECT 原样映射到 project 层。
    assert.equal(outcome.ok, false, `${what}：core 不得把不可复用的登记报成成功`)
    assert.notEqual(outcome.status, ExecutionContextStatus.Ready, `${what}：core 不得报 ready`)
    assert.equal(outcome.report.error?.code, 'invalid_input', `${what}：拒绝的必须是不可复用登记，而不是别的失败`)
  }
  // 登记还在但目录已消失：没有可复用对象。
  await probe('目录已消失', path.join(fixture.root, 'wt-gone'), 'gone', () => rm(path.join(fixture.root, 'wt-gone'), { recursive: true, force: true }))
  // 目录还在、但已经不是那份工作树：prunable（.git 文件被删）、独立仓库、被 lock 后替换。
  await probe('目录里的 .git 被删', path.join(fixture.root, 'wt-prunable'), 'prunable', () => rm(path.join(fixture.root, 'wt-prunable', '.git'), { force: true }))
  await probe('目录被换成独立仓库', path.join(fixture.root, 'wt-other'), 'other', async () => {
    await rm(path.join(fixture.root, 'wt-other'), { recursive: true, force: true })
    await mkdir(path.join(fixture.root, 'wt-other'))
    await git(['init', '-b', 'other'], path.join(fixture.root, 'wt-other'))
  })
  await probe('被 lock 后目录被替换', path.join(fixture.root, 'wt-locked'), 'locked', async () => {
    await git(['worktree', 'lock', path.join(fixture.root, 'wt-locked')], fixture.repositoryPath)
    await rm(path.join(fixture.root, 'wt-locked'), { recursive: true, force: true })
    await mkdir(path.join(fixture.root, 'wt-locked'))
  })
})

test('core 不得报成功：分支已被别处检出时', async (t) => {
  const fixture = await fixtureFor(t)
  const provider = providerFor(fixture)
  // 主检出自己就是一份已登记的工作树：在它上面检出目标分支，等于"身份被别的东西占着"。
  await fixture.run(['checkout', '-b', 'work/held'])
  const request = { workItemId: 'held', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'k-1' }
  const outcome = await provisionGit((await coreContextFor(fixture, { development: provider })).context, request, namesFor(request), 'ctx-held')
  assert.equal(outcome.ok, false, '分支被别处检出时 core 不得报成功')
  assert.notEqual(outcome.status, ExecutionContextStatus.Ready)
})

test('默认允许根：不注入 allowedRoot 时 core 的默认工作树路径在新仓库上成立', async (t) => {
  const fixture = await fixtureFor(t)
  const provider = createLocalGitDevelopmentProvider({
    bindingId: BINDING, repository: { externalId: REPOSITORY_ID, path: fixture.repositoryPath },
  })
  const request = { workItemId: 'wi-default', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'k-1' }
  const outcome = await provisionGit((await coreContextFor(fixture, { development: provider })).context, request, namesFor(request), 'ctx-default')
  assert.equal(outcome.status, ExecutionContextStatus.Ready, '默认允许根 <repo>/.worktrees 尚不存在时首个工作树也必须能建出来')
  assert.equal(outcome.worktreeExternalId, path.join(fixture.repositoryPath, '.worktrees', 'wi-default'))
})

test('非 main 且没有 origin/HEAD 的仓库上 Start Work 必须成立', async (t) => {
  const fixture = await fixtureFor(t, 'trunk')
  const request = { workItemId: 'wi-trunk', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'k-1' }
  const outcome = await provisionGit((await coreContextFor(fixture)).context, request, namesFor(request), 'ctx-trunk')
  assert.equal(outcome.status, ExecutionContextStatus.Ready, 'core 的 baseRef 不得把「不知道」换成 main 而让供应必然失败')
  assert.equal(outcome.branchExternalId, 'work/wi-trunk')
})
