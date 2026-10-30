/**
 * 本地 Git provider 接进 **core 供应序列**的验收：`startWork` / `provisionGit` 在真实临时仓库上跑，
 * 断言的是磁盘事实与系统状态（`ready` / 关系数），不是 provider 的返回值形状。
 *
 * 分层：provider 自身的行为（路径安全、分支身份、能力子集、写后回读）在
 * `tests/integration/development-local-git.test.js`；夹具见 `tests/integration/local-git-fixture.js`。
 */
import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { mkdir, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

import { ExecutionContextStatus, RelationType } from '@harness-projects/domain'
import { contextIdFor, namesFor, provisionGit, readChainFacts, startWork, worktreeEntityId } from '@harness-projects/core'
import { createLocalGitDevelopmentProvider } from '@harness-projects/provider-development-local-git'

import {
  BINDING, LEASE_EXPIRED_MS, REPOSITORY_ID, controllableClock, coreContextFor, fixtureFor, git,
  interruptAfterBranchStep, providerFor, registerWorkItem, repositoryRef, worktreePaths,
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

test('core 默认只传稳定工作树意图，不把 checkout 内 .worktrees 当本机路径', () => {
  const names = namesFor({ workItemId: 'wi-intent', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'intent-1' })
  assert.deepEqual(names, { branch: 'work/wi-intent', path: undefined, worktreeKey: 'wi-intent' })
})

test('core 在目标预检失败时不得先创建孤立分支', async (t) => {
  const fixture = await fixtureFor(t)
  const recorder = { calls: [], runGit: undefined }
  const provider = providerFor(fixture, { runGit: async (args) => {
    recorder.calls.push([...args])
    const { defaultGitRunner } = await import('@harness-projects/provider-development-local-git')
    return defaultGitRunner(args)
  } })
  const { context } = await coreContextFor(fixture, { development: provider })
  const request = {
    workItemId: 'wi-preflight', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'preflight-1',
    worktreePath: path.join(fixture.root, '..', 'outside-worktree'),
  }
  const outcome = await provisionGit(context, request, namesFor(request), 'ctx-preflight')
  assert.equal(outcome.ok, false)
  assert.equal((await fixture.run(['show-ref', '--verify', '--quiet', 'refs/heads/work/wi-preflight']).then(() => true, () => false)), false,
    '目标预检失败不得留下分支')
  assert.equal((await worktreePaths(fixture)).length, 1, '目标预检失败不得留下工作树')
  assert.equal(recorder.calls.some((args) => args.includes('branch')), false, '预检失败不得调用 git branch')
})

test('路由失败的报告保留工作树尝试值：默认意图下是稳定 key', async (t) => {
  const fixture = await fixtureFor(t)
  const { context } = await coreContextFor(fixture, { development: providerFor(fixture, { capabilities: { worktreeCreate: false } }) })
  const request = { workItemId: 'wi-route', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'route-1' }
  const outcome = await provisionGit(context, request, namesFor(request), 'ctx-route')
  assert.deepEqual([outcome.ok, outcome.report.error?.code, outcome.report.values.attemptedValue], [false, 'not_supported', 'wi-route'])
})

test('未观察的工作树骨架只带稳定 key，不传播 checkout 内 .worktrees 假路径（验收 7）', async (t) => {
  const fixture = await fixtureFor(t)
  const { storage, workspaceId, context } = await coreContextFor(fixture)
  await registerWorkItem(storage, workspaceId, 'wi-skeleton')
  const { worktree } = await readChainFacts(context, { workItemId: 'wi-skeleton', repositoryId: REPOSITORY_ID })
  assert.deepEqual([worktree.observed, worktree.externalId], [false, 'wi-skeleton'], '骨架句柄是稳定 key，不含路径分隔符')
})

/** 只改写 `hooks` 点名的方法（`hook(原方法) → 新方法`），其余成员绑定回真实 provider，私有状态因此可达。 */
const withHooks = (base, hooks) => new Proxy(base, {
  get(target, key) {
    const value = Reflect.get(target, key, target)
    if (typeof value !== 'function') return value
    const bound = value.bind(target)
    return typeof key === 'string' && hooks[key] !== undefined ? hooks[key](bound) : bound
  },
})
/** 预检照常判定，但把成功结果的 target 换成 `canonical`：core 之后的每一步都必须用这个值。 */
const preflightAnswers = (canonical) => (fn) => async (input) => {
  const result = await fn(input)
  return result.ok ? { ...result, value: { ...result.value, path: canonical } } : result
}

test('恢复预检必须使用已持久化的分支身份，而不是重放请求重新推导的分支', async (t) => {
  const fixture = await fixtureFor(t)
  const clock = controllableClock()
  const decidedBranch = 'work/wi-decided-branch'
  const checked = withHooks(providerFor(fixture), {
    preflightWorktree: (fn) => async (input) => {
      assert.equal(input.branch, decidedBranch, '分支敏感 provider 的预检必须使用已决定的分支')
      return fn(input)
    },
  })
  let refused = false
  const provider = withHooks(checked, { createWorktree: (fn) => async (input) => { if (!refused) { refused = true; return { ok: false, error: { code: 'unavailable', message: '确定未创建', retryable: false } } } return fn(input) } })
  const { storage, workspaceId, context } = await coreContextFor(fixture, { development: provider }, { clock: clock.clock })
  await registerWorkItem(storage, workspaceId, 'wi-custom-branch')
  const firstRequest = {
    workItemId: 'wi-custom-branch', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' },
    idempotencyKey: 'custom-branch-1', branchName: decidedBranch,
  }
  assert.equal((await startWork(context, firstRequest)).writeState, 'failed')
  const contextId = contextIdFor(workspaceId, firstRequest.workItemId, REPOSITORY_ID)
  const saved = await storage.getExecutionContext(contextId)
  assert.equal(saved?.branchExternalId, decidedBranch)

  clock.advance(LEASE_EXPIRED_MS)
  const { branchName: _omitted, ...retryRequest } = firstRequest
  const retried = await startWork(context, { ...retryRequest, idempotencyKey: 'custom-branch-2' })

  assert.equal(retried.status, ExecutionContextStatus.Ready)
  assert.equal(retried.branchExternalId, decidedBranch)
})

test('工作树已落盘但 ack 丢失：换 key 省略 branchName 仍被耐久意图阻挡', async (t) => {
  // 默认意图下 names.path 为 undefined：conflict 读回只能靠预检返回的 target，退回 worktreeKey 会读错位置（PR #160 F1 那条路径）。
  const fixture = await fixtureFor(t)
  const clock = controllableClock()
  const decided = 'custom/decided-landed'
  const seen = []
  let crash = true
  const provider = withHooks(providerFor(fixture), {
    preflightWorktree: (fn) => async (input) => { seen.push(input.branch); return fn(input) },
    createWorktree: (fn) => async (input) => {
      const result = await fn(input)
      if (crash) { crash = false; throw new Error('测试注入的中断：工作树写入落盘后进程退出') }
      return result
    },
  })
  const { storage, workspaceId, context } = await coreContextFor(fixture, { development: provider }, { clock: clock.clock })
  await registerWorkItem(storage, workspaceId, 'wi-landed')
  const first = { workItemId: 'wi-landed', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'landed-1', branchName: decided }
  assert.equal((await startWork(context, first)).writeState, 'unknown')
  clock.advance(LEASE_EXPIRED_MS)
  const { branchName: _omitted, ...retry } = first
  const result = await startWork(context, { ...retry, idempotencyKey: 'landed-2' })
  assert.deepEqual(
    [seen, result.status, result.branchExternalId, result.worktreeExternalId, (await worktreePaths(fixture)).length],
    [[decided], ExecutionContextStatus.Failed, decided, undefined, 2],
    '丢 ack 后新 key 被阻挡，不新增预检或外部写入；已落盘工作树仍保留'
  )
  assert.equal(result.writeState, 'unknown'); assert.equal(await storage.findMutationAttempt(workspaceId, 'landed-2'), undefined,
  )
})

test('预检返回的 canonical target 必须原样传给 createWorktree', async (t) => {
  const fixture = await fixtureFor(t)
  const rawPath = path.join(fixture.root, 'raw-target')
  const canonicalPath = path.join(fixture.root, 'canonical-target')
  let createdInput
  const provider = withHooks(providerFor(fixture), {
    preflightWorktree: preflightAnswers(canonicalPath),
    createWorktree: (fn) => async (input) => { createdInput = input; return fn(input) },
  })
  const { context } = await coreContextFor(fixture, { development: provider })
  const request = {
    workItemId: 'wi-canonical-target', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' },
    idempotencyKey: 'canonical-target-1', worktreePath: rawPath,
  }

  const outcome = await provisionGit(context, request, namesFor(request), 'ctx-canonical-target')

  assert.equal(outcome.ok, true)
  assert.equal(createdInput?.path, canonicalPath, 'createWorktree 不得退回使用预检前的原始路径')
  assert.equal(outcome.worktreeExternalId, canonicalPath)
  assert.deepEqual(await worktreePaths(fixture), [fixture.repositoryPath, canonicalPath])
})

test('create 结果不确定时，对账读回的也是预检返回的 canonical target', async (t) => {
  const fixture = await fixtureFor(t)
  const canonical = path.join(fixture.root, 'canonical-ambiguous')
  const reads = []
  const provider = withHooks(providerFor(fixture), {
    preflightWorktree: preflightAnswers(canonical),
    createWorktree: (fn) => async (input) => {
      assert.equal((await fn(input)).ok, true, '写入真实落盘，只是 ack 不确定')
      return { ok: false, error: { code: 'ambiguous_result', message: '测试注入：结果不确定', retryable: false } }
    },
    getWorktree: (fn) => async (input) => { reads.push(input.worktree.externalId); return fn(input) },
  })
  const { context } = await coreContextFor(fixture, { development: provider })
  const request = {
    workItemId: 'wi-ambiguous', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' },
    idempotencyKey: 'ambiguous-1', worktreePath: path.join(fixture.root, 'raw-ambiguous'),
  }
  const outcome = await provisionGit(context, request, namesFor(request), 'ctx-ambiguous')
  assert.deepEqual([reads, outcome.ok, outcome.worktreeExternalId], [[canonical], true, canonical], '对账只读 canonical target，句柄也取它')
})

test('已持久化的工作树句柄与新默认不同：重放沿用持久化句柄（验收 6）', async (t) => {
  const fixture = await fixtureFor(t)
  const { storage, workspaceId, context } = await coreContextFor(fixture)
  await registerWorkItem(storage, workspaceId, 'wi-persisted')
  const persisted = path.join(fixture.root, 'persisted-handle')
  const first = { workItemId: 'wi-persisted', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'persisted-1', worktreePath: persisted }
  assert.equal((await startWork(context, first)).status, ExecutionContextStatus.Ready)
  const contextId = contextIdFor(workspaceId, 'wi-persisted', REPOSITORY_ID)
  const record = await storage.getExecutionContext(contextId)
  // 模拟最终事务前中断：句柄已回填、状态仍是 Provisioning；重放省略 worktreePath，新默认会算出另一个位置。
  await storage.putExecutionContext({ ...record, status: ExecutionContextStatus.Provisioning })
  const { worktreePath: _omitted, ...replay } = first
  const outcome = await provisionGit(context, { ...replay, idempotencyKey: 'persisted-2' }, namesFor(replay), contextId)
  assert.deepEqual([record.worktreeExternalId, outcome.ok, outcome.worktreeExternalId], [persisted, true, persisted])
})

test('恢复供应：同一工作树只保留一条 has_worktree 关系（#165）', async (t) => {
  const fixture = await fixtureFor(t)
  const { storage, workspaceId, context } = await coreContextFor(fixture)
  await registerWorkItem(storage, workspaceId, 'wi-165')
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
  assert.equal(hasWorktree[0].to, worktreeEntityId(workspaceId, REPOSITORY_ID, request.workItemId), '关系必须指向当前工作项/仓库的稳定 worktree entity')
  // #207 验收 1 要求「`startWork` … yields `ready` and the branch/worktree exist on disk」。本文件此前经
  // `startWork` 的用例只断言 storage 里的状态，磁盘回读全在 `provisionGit` 用例里（第六轮评审 P2）。这里补上，
  // 判据是**磁盘事实**而不是返回值：报 ready 就必须真的能在盘上找到这份工作树与这条分支。
  const expectedWorktree = path.join(fixture.root, 'wi-165')
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

test('默认允许根：不注入 allowedRoot 时 core 的 checkout 外默认工作树路径成立', async (t) => {
  const fixture = await fixtureFor(t)
  const provider = createLocalGitDevelopmentProvider({
    bindingId: BINDING, repository: { externalId: REPOSITORY_ID, path: fixture.repositoryPath },
  })
  const request = { workItemId: 'wi-default', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'k-1' }
  const outcome = await provisionGit((await coreContextFor(fixture, { development: provider })).context, request, namesFor(request), 'ctx-default')
  assert.equal(outcome.status, ExecutionContextStatus.Ready, 'checkout 外默认根尚不存在时首个工作树也必须能建出来')
  assert.equal(outcome.worktreeExternalId, path.join(path.dirname(fixture.repositoryPath), `${path.basename(fixture.repositoryPath)}.worktrees`, 'wi-default'))
})

test('非 main 且没有 origin/HEAD 的仓库上 Start Work 必须成立', async (t) => {
  const fixture = await fixtureFor(t, 'trunk')
  const request = { workItemId: 'wi-trunk', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'k-1' }
  const outcome = await provisionGit((await coreContextFor(fixture)).context, request, namesFor(request), 'ctx-trunk')
  assert.equal(outcome.status, ExecutionContextStatus.Ready, 'core 的 baseRef 不得把「不知道」换成 main 而让供应必然失败')
  assert.equal(outcome.branchExternalId, 'work/wi-trunk')
})

test('已 ready 上下文的工作树或分支消失后不得继续报 confirmed', async (t) => {
  const fixture = await fixtureFor(t)
  const { storage, workspaceId, context } = await coreContextFor(fixture)
  await registerWorkItem(storage, workspaceId, 'wi-stale')
  const request = { workItemId: 'wi-stale', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'stale-1' }
  const first = await startWork(context, request)
  assert.equal(first.status, ExecutionContextStatus.Ready)
  await fixture.run(['worktree', 'remove', '--force', first.worktreeExternalId])
  await fixture.run(['branch', '-D', first.branchExternalId])

  const replay = await startWork(context, { ...request, idempotencyKey: 'stale-2' })
  assert.notEqual(replay.status, ExecutionContextStatus.Ready, '磁盘对象消失后不得继续报 ready')
  assert.equal(replay.confirmed, false, '没有 provider read-back 不得报 confirmed')
})

test('无法确定仓库基线时不得由 core 猜测 main', async (t) => {
  const fixture = await fixtureFor(t, 'alpha')
  await fixture.run(['branch', 'beta'])
  const request = { workItemId: 'wi-no-base', repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'no-base-1' }
  const outcome = await provisionGit((await coreContextFor(fixture)).context, request, namesFor(request), 'ctx-no-base')
  assert.equal(outcome.ok, false)
  assert.equal(outcome.report.error?.code, 'not_found')
  assert.match(outcome.report.error?.message ?? '', /无法确定仓库基线/)
  assert.deepEqual((await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], fixture.repositoryPath)).trim().split('\n').sort(), ['alpha', 'beta'])
})
