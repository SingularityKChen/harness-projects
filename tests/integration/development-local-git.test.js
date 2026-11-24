/** 本地 Git provider **自身**的行为：路径安全、分支身份、能力子集、写后回读、默认根与读面。`argv-only`
 * 由 tests/contract/development-local-git-source.test.js 的源码扫描保证；夹具见 local-git-fixture.js。
 * 接进 core 供应序列的系统验收不在本层（#209 交付）。 */
import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

import {
  createLocalGitDevelopmentProvider, defaultGitRunner, resolveWorktreePath,
} from '@harness-projects/provider-development-local-git'

import { developmentContractSuite } from '../contract/suites/development.js'
import {
  BINDING, REPOSITORY_ID, destructiveCall, faultRunner, fixtureFor, git, makeFixture, providerFor,
  quarantineEntries, recordingRunner, repositoryRef, snapshotTree, worktreePaths,
} from './local-git-fixture.js'

/**
 * 契约 suite **专用**的 module-level 夹具：只有 `localGitSuite(suiteFixture)` 一行消费它。下方所有具名
 * `test(...)` 用例一律走 `fixtureFor(t)` 的 per-test 夹具，不复用本夹具，因此 suite 内部的创建/移除
 * 残留无法污染那些用例。新增用例请继续用 `fixtureFor(t)`——不要向本夹具写状态。
 */
const suiteFixture = await makeFixture((cleanup) => after(cleanup))
/** 套件共用的预置分支：`PREPARED_BRANCH` 供工作树创建用例检出，`PREPARED_DUP_BRANCH` 只服务"同一路径重复
 *  创建"用例，`main` 被主检出占着因此不能当检出新工作树的分支。worktreeCreate:false 形态下 `PREPARED_BRANCH`
 *  已被预置工作树 `wt-prepared` 检出；该形态不声明 createWorktree，创建用例不会再去检出它。 */
const PREPARED_BRANCH = 'feature/prepared'
const PREPARED_DUP_BRANCH = 'feature/prepared-dup'
const PREPARED_COLLISION_A = 'feature/prepared-collision-a'
const PREPARED_COLLISION_B = 'feature/prepared-collision-b'
await suiteFixture.run(['branch', PREPARED_BRANCH, 'main'])
await suiteFixture.run(['branch', PREPARED_DUP_BRANCH, 'main'])
await suiteFixture.run(['branch', PREPARED_COLLISION_A, 'main'])
await suiteFixture.run(['branch', PREPARED_COLLISION_B, 'main'])

/** 对象钩子：每次从磁盘真实读取 refs 与 worktree 登记，不缓存、不 alias。 */
const diskObjects = (fixture) => async () => ({
  branches: (await git(['for-each-ref', '--format=%(refname:short)\t%(objectname)', 'refs/heads'], fixture.repositoryPath)).trim(),
  worktrees: await worktreePaths(fixture),
})

/** 同 suite 的真实 Local Git 装配：每个能力形态用**独立**临时仓库/允许根，互不复用残留。 */
const localGitSuite = (fixture, capabilities) => developmentContractSuite({
  label: capabilities === undefined ? '本地 Git provider' : `本地 Git provider（${JSON.stringify(capabilities)}）`,
  makeProvider: (scenario = {}) => providerFor(fixture, {
    runGit: faultRunner(scenario.faults), capabilities: { ...capabilities, ...scenario.capabilities },
    repository: { externalId: REPOSITORY_ID, path: fixture.repositoryPath, defaultBranch: 'main' },
  }),
  expect: {
    repository: repositoryRef, baseBranch: 'main', headCommit: fixture.headCommit, pageSize: 1,
    worktreePath: path.join(fixture.root, 'wt-suite'),
    worktreeBranch: PREPARED_BRANCH,
    worktreeRef: fixture.worktreeRef,
    worktreeRefBranch: fixture.worktreeRefBranch,
    worktreeDupBranch: PREPARED_DUP_BRANCH,
    worktreeCollisionBranchA: PREPARED_COLLISION_A,
    worktreeCollisionBranchB: PREPARED_COLLISION_B,
    objects: diskObjects(fixture),
  },
})

localGitSuite(suiteFixture)

// 三个剩余能力关闭的真实子集：分支创建关闭、工作树创建关闭（读取仍可用）、工作树读取关闭。
for (const capabilities of [{ branchCreate: false }, { worktreeCreate: false }, { worktreeRead: false }]) {
  const fixture = await makeFixture((cleanup) => after(cleanup))
  await fixture.run(['branch', PREPARED_BRANCH, 'main'])
  await fixture.run(['branch', PREPARED_DUP_BRANCH, 'main'])
  await fixture.run(['branch', PREPARED_COLLISION_A, 'main'])
  await fixture.run(['branch', PREPARED_COLLISION_B, 'main'])
  // worktree.create 关闭时读取用例必须读回一份真实存在于磁盘上的预置工作树，而不是跳过。
  if (capabilities.worktreeCreate === false) {
    fixture.worktreeRef = { bindingId: BINDING, objectKind: 'worktree', externalId: path.join(fixture.root, 'wt-prepared'), url: undefined }
    fixture.worktreeRefBranch = PREPARED_BRANCH
    await fixture.run(['worktree', 'add', fixture.worktreeRef.externalId, PREPARED_BRANCH])
  }
  localGitSuite(fixture, capabilities)
}

test('路径安全：长分隔符输入有界返回结构化拒绝，不阻塞调用进程', () => {
  const moduleUrl = new URL('../../packages/providers/development-local-git/src/paths.ts', import.meta.url).href
  const script = `
    import { resolveWorktreePath } from ${JSON.stringify(moduleUrl)};
    import os from 'node:os';
    const input = { repositoryPath: os.tmpdir(), allowedRoot: os.tmpdir() };
    const result = await resolveWorktreePath('/'.repeat(300000) + 'x', input);
    console.log(JSON.stringify({ ok: result.ok, reason: result.reason }));
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 5000 })
  assert.equal(result.error, undefined, '路径校验必须在子进程期限内完成，不能在最终拒绝之前重复扫描分隔符')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { ok: false, reason: 'unresolvable' })
})

test('路径安全：只去掉尾部分隔符，保留正常目标与全分隔符根路径', async (t) => {
  const fixture = await fixtureFor(t)
  const target = path.join(fixture.root, 'new-worktree')
  const input = { repositoryPath: fixture.repositoryPath, allowedRoot: fixture.root }
  for (const suffix of ['', '/', '\\', '/\\//']) {
    assert.deepEqual(await resolveWorktreePath(target + suffix, input), { ok: true, path: target })
  }
  if (path.sep === '/') {
    assert.deepEqual(await resolveWorktreePath('////', { ...input, allowedRoot: '/' }), { ok: true, path: '/' })
  }
})

test('路径安全：越界、含 .. 与符号链接逃逸都在任何 Git 命令之前被拒（零次调用）', async (t) => {
  const fixture = await fixtureFor(t)
  const outsideDirectory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-git-outside-')))
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }))
  await symlink(outsideDirectory, path.join(fixture.root, 'escape'))
  await symlink(path.join(fixture.root, 'nowhere'), path.join(fixture.root, 'dangling'))
  const cases = [
    { what: '绝对路径越界', target: path.resolve(fixture.root, '..', 'outside-worktree') },
    { what: '绝对路径含 .. 分量', target: `${fixture.root}/nested/../worktree` },
    { what: '相对路径含 .. 分量', target: '../escape-worktree' },
    { what: '符号链接逃逸', target: path.join(fixture.root, 'escape', 'worktree') },
    { what: '悬空符号链接叶子', target: path.join(fixture.root, 'dangling') },
    { what: '首尾空白', target: '.worktrees/sp ' },
  ]
  for (const item of cases) {
    const recorder = recordingRunner()
    const provider = providerFor(fixture, { runGit: recorder.runGit })
    const result = await provider.createWorktree({ repository: repositoryRef, path: item.target, branch: 'main' })
    assert.deepEqual(recorder.calls, [], `${item.what} 必须在任何 Git 命令之前被拒（实际调用 ${recorder.calls.length} 次）`)
    assert.equal(result.ok, false, `${item.what} 必须被拒`)
    assert.equal(result.error.code, 'invalid_input', `${item.what} 的拒绝码必须是 invalid_input`)
    assert.equal(result.error.retryable, false, `${item.what} 是输入错误，原样重发没有意义`)
  }
  assert.equal((await resolveWorktreePath('.worktrees/sp ', { repositoryPath: fixture.repositoryPath, allowedRoot: fixture.root })).ok, false)
  assert.equal((await resolveWorktreePath(path.join(fixture.root, '..wi'), { repositoryPath: fixture.repositoryPath, allowedRoot: fixture.root })).ok, true)
  assert.equal((await worktreePaths(fixture)).length, 1, '被拒的路径不得留下任何工作树')
})
test('路径安全：已存在的目标祖先是符号链接时，带新尾部的路径也在任何 Git 命令之前被拒', async (t) => {
  const fixture = await fixtureFor(t)
  await symlink(fixture.root, path.join(fixture.repositoryPath, 'alias'))
  const recorder = recordingRunner()
  const provider = providerFor(fixture, { runGit: recorder.runGit })
  const target = path.join('alias', 'new')
  const resolved = await resolveWorktreePath(target, {
    repositoryPath: fixture.repositoryPath,
    allowedRoot: fixture.root,
  })
  assert.equal(resolved.ok, false, '已存在的目标祖先是符号链接时必须拒绝')
  const result = await provider.createWorktree({ repository: repositoryRef, path: target, branch: 'main' })
  assert.deepEqual(recorder.calls, [], '目标祖先符号链接必须在任何 Git 命令之前被拒')
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'invalid_input')
  assert.equal(result.error.retryable, false)
})

test('路径安全：非 ENOENT/ENOTDIR 的 stat 失败判为不可规范化，预检结构化拒绝而不是当作可创建路径（零次 Git 调用）', async (t) => {
  // 平台边界：本文件不在 Windows lane（docs/development/ci.md），CI Verify 以非 root 运行，故这里的 chmod 0 拒绝会真实执行；
  // 若未来 Verify 改为 root/容器身份，本用例走下面的 skip 而不是变红（run-test-layer 只拒绝零执行），需同时补该文件 skipped===0 的门禁。
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('root 下 chmod 0 不构成访问屏障')
    return
  }
  const fixture = await fixtureFor(t)
  // 正控：正常目标的预检必须成功，否则下面的拒绝可能只是"预检本身坏了"造成的假红。
  const control = await providerFor(fixture).preflightWorktree({ repository: repositoryRef, worktreeKey: 'wt-ok', branch: 'main' })
  assert.equal(control.ok, true, '正常目标的预检必须成功')
  const blocked = path.join(fixture.root, 'blocked')
  await mkdir(blocked)
  await chmod(blocked, 0o000)
  try {
    const resolved = await resolveWorktreePath(path.join(blocked, 'nested', 'wt'), { repositoryPath: fixture.repositoryPath, allowedRoot: fixture.root })
    assert.equal(resolved.ok, false, '非 ENOENT/ENOTDIR 的 stat 失败不得被当作"路径不存在、可以创建"')
    assert.equal(resolved.reason, 'unresolvable', '不可访问必须在路径层被分类为 unresolvable，而不是抛裸异常穿过契约')
    const recorder = recordingRunner()
    const provider = providerFor(fixture, { runGit: recorder.runGit })
    const result = await provider.preflightWorktree({ repository: repositoryRef, worktreeKey: 'wt', path: path.join(blocked, 'nested', 'wt'), branch: 'main' })
    assert.equal(result.ok, false, '预检必须拒绝不可访问的目标，不得报可创建')
    assert.equal(result.error.code, 'invalid_input')
    assert.equal(result.error.retryable, false, '路径分类失败是输入拒绝，不是可重试的平台错误')
    assert.deepEqual(recorder.calls, [], '路径拒绝必须发生在任何 Git 调用之前')
  } finally {
    await chmod(blocked, 0o755)
  }
})

test('读取默认分支时的非 not_found 错误不得被折成成功', async (t) => {
  const fixture = await fixtureFor(t)
  const provider = providerFor(fixture, {
    runGit: async (args) => (args.includes('symbolic-ref')
      ? { code: 128, stdout: '', stderr: 'fatal: Permission denied' }
      : defaultGitRunner(args)),
  })
  const result = await provider.getRepository(repositoryRef)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'permission_denied')
})
test('幂等：同一路径第二次创建报 conflict；登记在册但不可复用的形态都硬失败', async (t) => {
  const fixture = await fixtureFor(t)
  const provider = providerFor(fixture)
  const target = path.join(fixture.root, 'wt-idempotent')
  assert.equal((await provider.createBranch({ repository: repositoryRef, name: 'work/wi-1', fromRef: 'main' })).ok, true)
  const first = await provider.createWorktree({ repository: repositoryRef, path: target, branch: 'work/wi-1' })
  assert.equal(first.ok, true)
  assert.equal(first.value.path, target, '返回的 path 必须是规范化后的绝对路径')
  const again = await provider.createWorktree({ repository: repositoryRef, path: target, branch: 'work/wi-1' })
  assert.equal(again.ok, false, 'provider 层重复创建必须报冲突，而不是静默复用')
  assert.equal(again.error.code, 'conflict')
  assert.deepEqual((await worktreePaths(fixture)).filter((item) => item === target), [target], '磁盘上只能有一份该路径的工作树')
  await rm(target, { recursive: true, force: true })
  const gone = await provider.createWorktree({ repository: repositoryRef, path: target, branch: 'work/wi-1' })
  assert.equal(gone.error?.code, 'invalid_input', '登记仍在而目录消失时没有可复用对象')
  const lookalikes = [
    ['目录里的 .git 被删', (dir) => rm(path.join(dir, '.git'), { force: true })],
    ['目录被换成独立仓库', async (dir) => { await rm(dir, { recursive: true, force: true }); await mkdir(dir); await git(['init', '-b', 'other'], dir) }],
    ['被 lock 后目录被替换', async (dir) => { await git(['worktree', 'lock', dir], fixture.repositoryPath); await rm(dir, { recursive: true, force: true }); await mkdir(dir) }],
  ]
  for (const [index, [what, corrupt]] of lookalikes.entries()) {
    const name = `work/lookalike-${index}`
    const dir = path.join(fixture.root, `wt-lookalike-${index}`)
    await provider.createBranch({ repository: repositoryRef, name, fromRef: 'main' })
    assert.equal((await provider.createWorktree({ repository: repositoryRef, path: dir, branch: name })).ok, true)
    await corrupt(dir)
    const blocked = await provider.createWorktree({ repository: repositoryRef, path: dir, branch: name })
    assert.equal(blocked.ok, false, `${what}：登记在册不等于可复用，不得报 conflict`)
    assert.equal(blocked.error.code, 'invalid_input', `${what} 的拒绝码`)
    if (what.includes('.git')) assert.match(blocked.error.message, /prune/, 'prunable 登记必须给出 prune 补救')
  }
  // 指向主检出：登记与分支都「对得上」，但它是主检出而不是链接工作树。
  const mainLookalike = await provider.createWorktree({ repository: repositoryRef, path: fixture.repositoryPath, branch: 'main' })
  assert.equal(mainLookalike.error?.code, 'invalid_input', '主检出没有可复用的链接工作树身份')
})

test('分支名校验：非法名字在任何 Git 命令之前被拒，合法名字照常创建', async (t) => {
  const fixture = await fixtureFor(t)
  const invalid = [
    '', '   ', '-lead', 'feat..ure', 'feat ure', 'feat\ture', 'feat\u0001ure',
    'feat~1', 'feat^', 'feat:1', 'feat?', 'feat*', 'feat[1]', 'feat\\x', 'feat.lock',
    // git 自己也会拒绝、但必须在调用之前就拒绝的名字：黑名单漏掉它们会落进写命令兜底变成 ambiguous_result。
    'foo.', '.foo', 'foo/', 'a//b', 'a/./b', 'a.lock/b', 'foo@{bar', 'foo/.bar', 'x.lock/y', 'HEAD',
  ]
  for (const name of invalid) {
    const recorder = recordingRunner()
    const provider = providerFor(fixture, { runGit: recorder.runGit })
    const result = await provider.createBranch({ repository: repositoryRef, name, fromRef: 'main' })
    assert.deepEqual(recorder.calls, [], `非法分支名 ${JSON.stringify(name)} 必须在任何 Git 命令之前被拒`)
    assert.equal(result.ok, false, `非法分支名必须被拒：${JSON.stringify(name)}`)
    assert.equal(result.error.code, 'invalid_input', `非法分支名 ${JSON.stringify(name)} 的拒绝码`)
    // 诊断信息必须点名违反了哪一条规则，而不是一句「名字不合法」——把九条规则收成一句会静默退化。
    assert.notEqual(result.error.message, '分支名包含 Git 禁止的字符或分量', `拒绝信息必须点名规则：${JSON.stringify(name)}`)
  }
  const provider = providerFor(fixture)
  const created = await provider.createBranch({ repository: repositoryRef, name: 'feature/ok-1', fromRef: 'main' })
  assert.equal(created.ok, true)
  assert.equal(created.value.headCommit, fixture.headCommit, '新分支必须继承起点分支的头部提交')
})

test('同名分支：指向请求声明的起点才复用，指向别处是结构化 invalid_input', async (t) => {
  const fixture = await fixtureFor(t)
  const provider = providerFor(fixture)
  const created = await provider.createBranch({ repository: repositoryRef, name: 'feature/moved', fromRef: 'main' })
  assert.equal(created.ok, true)
  const reused = await provider.createBranch({ repository: repositoryRef, name: 'feature/moved', fromRef: created.value.headCommit })
  assert.equal(reused.ok, true, '同名分支指向请求声明的起点时必须复用')
  assert.equal(reused.value.headCommit, created.value.headCommit)
  await writeFile(path.join(fixture.repositoryPath, 'next.txt'), 'next\n')
  await fixture.run(['add', 'next.txt'])
  await fixture.run(['-c', 'commit.gpgsign=false', 'commit', '-m', '第二个提交'])
  const conflict = await provider.createBranch({ repository: repositoryRef, name: 'feature/moved', fromRef: 'main' })
  assert.equal(conflict.ok, false, '同名分支指向别处必须结构化失败')
  // `invalid_input` 而不是 `conflict`：core 的 ensureBranch 把任意 conflict 当作"探测后复用"，
  // 于是 provider 层的结构化失败会在系统层变成静默复用（评审 P1，见 ExecPlan 的 Decision Log）。
  assert.equal(conflict.error.code, 'invalid_input')
  const head = (await git(['rev-parse', 'refs/heads/feature/moved'], fixture.repositoryPath)).trim()
  assert.equal(head, created.value.headCommit, '被拒的创建不得改动既有分支')
  // D/F 引用冲突（已有分支 `work` 时创建 `work/wi-1`）是确定性拒绝，不是结果不确定。
  await provider.createBranch({ repository: repositoryRef, name: 'work', fromRef: 'main' })
  const df = await provider.createBranch({ repository: repositoryRef, name: 'work/wi-1', fromRef: 'main' })
  assert.equal(df.ok, false)
  assert.equal(df.error.code, 'invalid_input', 'D/F 引用冲突不得落成 ambiguous_result 让人去对账')
})

test('分支身份：只认 for-each-ref 能精确枚举的名字，大小写变体与符号引用都不是可复用对象', async (t) => {
  const fixture = await fixtureFor(t)
  const provider = providerFor(fixture)
  await provider.createBranch({ repository: repositoryRef, name: 'work/wi-1', fromRef: 'main' })
  // 大小写不敏感文件系统上 rev-parse 会把 WORK/WI-1 解析成既有分支，git worktree add 也会接受它，
  // 于是两份工作树挂到同一条分支；身份的唯一权威是枚举（与 listBranches 同一来源）。
  const variantDir = path.join(fixture.root, 'wt-variant')
  const variant = await provider.createWorktree({ repository: repositoryRef, path: variantDir, branch: 'WORK/WI-1' })
  assert.equal(variant.ok, false, '枚举不出来的名字不得被当成既有分支检出')
  assert.equal(variant.error.code, 'not_found')
  assert.equal((await worktreePaths(fixture)).includes(variantDir), false)
  // 同名大小写变体的创建：必须结构化拒绝。旧断言在「报成功」那一支只要求 listBranches 能枚举到，
  // 而打包过的引用上 git 会接受变体、造出两条折叠到同一底层引用的名字——那条断言因此没有判别力。
  const created = await provider.createBranch({ repository: repositoryRef, name: 'WORK/WI-1', fromRef: 'main' })
  assert.equal(created.ok, false, '与既有分支只差大小写时必须结构化拒绝')
  assert.equal(created.error.code, 'invalid_input')
  // 符号引用：refs/heads/alias → refs/heads/work/wi-1，检出它会让两处提交挪动同一条分支。
  await fixture.run(['symbolic-ref', 'refs/heads/alias', 'refs/heads/work/wi-1'])
  const aliasDir = path.join(fixture.root, 'wt-alias')
  const alias = await provider.createWorktree({ repository: repositoryRef, path: aliasDir, branch: 'alias' })
  assert.equal(alias.ok, false, '符号引用不是可复用的分支身份')
  assert.equal(alias.error.code, 'invalid_input')
  assert.equal((await worktreePaths(fixture)).includes(aliasDir), false)
})

test('分支身份：pack-refs 之后大小写变体仍然被拒，且磁盘上只有一条该名字的引用', async (t) => {
  const fixture = await fixtureFor(t)
  const provider = providerFor(fixture)
  await provider.createBranch({ repository: repositoryRef, name: 'work/wi-1', fromRef: 'main' })
  // 松散引用时 git 自己会因为大小写不敏感的文件系统拒绝写入变体；打包之后它不再拒绝，只查
  // `refs/heads/<name>` 的前置判定对变体返回空，于是两份工作树会挂到同一条底层引用上（第四轮 P2 实测）。
  await fixture.run(['pack-refs', '--all'])
  const variant = await provider.createBranch({ repository: repositoryRef, name: 'WORK/WI-1', fromRef: 'main' })
  assert.equal(variant.ok, false, '打包后大小写变体仍必须被拒')
  assert.equal(variant.error.code, 'invalid_input')
  const refs = (await git(['for-each-ref', '--format=%(refname)', 'refs/heads'], fixture.repositoryPath)).trim().split('\n')
  assert.deepEqual(
    refs.filter((ref) => ref.toLowerCase() === 'refs/heads/work/wi-1'), ['refs/heads/work/wi-1'],
    '磁盘上只能有一条该名字的引用，不能出现折叠到同一底层引用的两个名字',
  )
})

test('分支列表：limit 为 0 或负数时游标严格前进，遍历有界终止且恰好枚举每个分支一次', async (t) => {
  const fixture = await fixtureFor(t)
  const provider = providerFor(fixture)
  for (const name of ['feature/bound-a', 'feature/bound-b', 'feature/bound-c']) await fixture.run(['branch', name, 'main'])
  const all = await provider.listBranches({ repository: repositoryRef, cursor: undefined, limit: 1000 })
  assert.equal(all.ok, true)
  assert.equal(all.value.nextCursor, undefined, '大页必须一页读完')
  const names = all.value.items.map((item) => item.name).sort()
  assert.ok(names.length > 1, '夹具必须提供多个分支，否则分页断言看不出差别')
  // limit < 1 时实现按 1 条夹取；端口级 limit<=0 语义尚未裁决（ExecPlan D7），若裁决改为"遍历结束返回空页"，本用例须同步改写而不是删断言。
  // 只断言最终集合会在游标原地踏步时挂住，所以先给页数上界防坏游标，
  // 再逐页断言性质：非空、页大小 ≤ max(1, limit)、游标严格前进、有界终止、恰好枚举一次。
  for (const limit of [0, -1]) {
    const seen = []
    let cursor
    for (let pages = 1; ; pages += 1) {
      assert.ok(pages <= names.length + 2, `limit ${limit} 的分页在页数上界内没有终止：已读 ${pages} 页`)
      // 本地 provider 的游标是数值 offset（能力契约只承诺不透明字符串）；严格前进断言依赖该编码，改游标形态时必须同步改写断言。
      const start = cursor === undefined ? 0 : Number(cursor)
      const page = await provider.listBranches({ repository: repositoryRef, cursor, limit })
      assert.equal(page.ok, true)
      assert.ok(page.value.items.length >= 1, `limit ${limit} 的第 ${pages} 页为空：空页会让游标原地踏步，调用方永远读不完`)
      assert.ok(page.value.items.length <= Math.max(1, limit), `limit ${limit} 每页不得超过 max(1, limit) 条`)
      seen.push(...page.value.items.map((item) => item.name))
      if (page.value.nextCursor === undefined) break
      assert.ok(Number(page.value.nextCursor) > start, `limit ${limit} 的 nextCursor 必须严格前进：${cursor} → ${page.value.nextCursor}`)
      cursor = page.value.nextCursor
    }
    assert.deepEqual([...seen].sort(), names, `limit ${limit} 必须恰好枚举每个分支一次`)
    assert.equal(new Set(seen).size, seen.length, `limit ${limit} 的分页不得重复枚举分支`)
  }
})

test('写后回读：worktree add 落到别处时不得把判定时的路径报成事实', async (t) => {
  const fixture = await fixtureFor(t)
  const target = path.join(fixture.root, 'wt-asked')
  const elsewhere = path.join(fixture.root, 'wt-elsewhere')
  const provider = providerFor(fixture, {
    // 判定与写入之间目标可以被换掉（TOCTOU）：这里让 add 落到别处，模拟那个窗口的后果。
    runGit: async (args) => (args.includes('add')
      ? defaultGitRunner(args.map((arg) => (arg === target ? elsewhere : arg)))
      : defaultGitRunner(args)),
  })
  assert.equal((await provider.createBranch({ repository: repositoryRef, name: 'work/wi-swap', fromRef: 'main' })).ok, true)
  const result = await provider.createWorktree({ repository: repositoryRef, path: target, branch: 'work/wi-swap' })
  assert.equal(result.ok, false, '登记里没有判定时的路径时必须报 reconcile，而不是把它当写入后的事实')
  assert.equal(result.error.code, 'ambiguous_result')
  assert.equal(result.error.retryable, false, '结果不确定必须先 reconcile，不能原样重发')
  assert.deepEqual(await worktreePaths(fixture), [fixture.repositoryPath, elsewhere], '写入确实落到了别处，所以报告不能是 target')
})

test('能力子集：声明五个键（含工作树移除），移除是可选能力', async (t) => {
  const fixture = await fixtureFor(t)
  const provider = providerFor(fixture)
  assert.deepEqual(
    Object.keys((await provider.describeCapabilities()).capability).sort(),
    [
      'development.branch.create', 'development.repository.read', 'development.worktree.create',
      'development.worktree.read', 'development.worktree.remove',
    ],
    '本地 Git 声明仓库、分支、工作树创建/读取与工作树移除能力',
  )
  // 移除是破坏性能力（AGENTS.md §7）：能创建不等于能移除，声明必须由实现兑现。
  assert.equal(typeof provider.removeWorktree, 'function', '声明了 development.worktree.remove 就必须实现 removeWorktree')
})

test('工作树移除：干净工作树仅显式移除，隔离目录绑定登记且不 force，二次移除答 not_found', async (t) => {
  const fixture = await fixtureFor(t)
  const rootReal = await realpath(fixture.root)
  const target = path.join(fixture.root, 'wt-remove-clean')
  const branch = 'work/remove-clean'
  const recorder = recordingRunner()
  const provider = providerFor(fixture, { runGit: recorder.runGit })
  assert.equal((await provider.createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await provider.createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  const headBefore = (await git(['rev-parse', `refs/heads/${branch}`], fixture.repositoryPath)).trim()
  const worktree = worktreeRefFor(target)
  recorder.calls.length = 0
  const removed = await provider.removeWorktree({ worktree })
  assert.equal(removed.ok, true, '干净工作树在显式请求下必须真的被移除')
  const repair = recorder.calls.find((call) => call.includes('repair'))
  const removal = recorder.calls.find((call) => call.includes('remove'))
  assert.ok(repair !== undefined, '隔离后必须先用 worktree repair 把登记绑定到隔离目录')
  assert.ok(removal !== undefined, '必须发出 worktree remove')
  const quarantine = repair[repair.length - 1]
  assert.match(quarantine, /^.+[/\\]\.harness-remove-[0-9a-f-]+$/, '隔离目录必须是允许根下的 .harness-remove-<uuid>')
  assert.equal(path.dirname(quarantine), rootReal, '隔离目录的父目录必须是允许根的 realpath')
  assert.deepEqual(repair, ['-C', fixture.repositoryPath, 'worktree', 'repair', quarantine], 'repair 只改登记，目标是隔离目录')
  assert.deepEqual(removal, ['-C', fixture.repositoryPath, 'worktree', 'remove', quarantine], '删除目标是隔离目录，不得带 --force / -f')
  assert.equal(
    recorder.calls.some((call) => call.includes('--force') || call.includes('-f') || call.includes('move')),
    false,
    '移除路径不得 force，也不得用 worktree move 作隔离原语',
  )
  assert.deepEqual(await quarantineEntries(fixture.root), [], '成功后允许根下不得残留隔离目录')
  await assert.rejects(stat(target), { code: 'ENOENT' }, '目录必须消失')
  assert.equal((await worktreePaths(fixture)).includes(target), false, '登记必须消失')
  const branches = await provider.listBranches({ repository: repositoryRef, cursor: undefined, limit: 100 })
  assert.ok(branches.value.items.some((item) => item.name === branch), '移除工作树不得删除分支')
  assert.equal((await git(['rev-parse', `refs/heads/${branch}`], fixture.repositoryPath)).trim(), headBefore, '分支头必须保留')
  const again = await provider.removeWorktree({ worktree })
  assert.equal(again.ok, false, '第二次移除不得静默成功')
  assert.equal(again.error.code, 'not_found', '工作树已经不存在，第二次移除必须答 not_found')
})

test('工作树移除：准入后对象被换成同 gitfile 替身时答 invalid_input，不删除任何内容', async (t) => {
  const fixture = await fixtureFor(t)
  await commitGitignore(fixture, ['.env'])
  const target = path.join(fixture.root, 'wt-swapped')
  const movedReal = path.join(fixture.root, 'wt-swapped-real')
  const branch = 'work/swapped'
  const provider = providerFor(fixture)
  assert.equal((await provider.createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await provider.createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  const recorder = recordingRunner()
  let substituteBefore
  let realBefore
  let swapped = false
  const racing = providerFor(fixture, {
    runGit: async (args) => {
      // 注入点 = 干净门的 status：新实现的 dev/ino 锚已取，这是删除前最后一次只读 Git 读。
      // 复制目标的 .git gitfile 后，Git 会把替身当成同一登记工作树（F8），只有对象身份能区分。
      if (!swapped && args.includes('status')) {
        swapped = true
        await rename(target, movedReal)
        await cp(movedReal, target, { recursive: true })
        await writeFile(path.join(target, '.env'), 'SECRET=1\n')
        substituteBefore = await snapshotTree(target)
        realBefore = await snapshotTree(movedReal)
      }
      return recorder.runGit(args)
    },
  })
  const result = await racing.removeWorktree({ worktree: worktreeRefFor(target) })
  assert.equal(result.ok, false, '准入后对象被替换时必须拒绝，不得删除替身')
  assert.equal(result.error.code, 'invalid_input', '对象复核不符是确定性拒绝，不是结果不确定')
  assert.equal(result.error.retryable, false)
  assert.match(result.error.message, /对象被替换|已回滚/, '必须说明对象被替换且已回滚')
  assert.deepEqual(await snapshotTree(target), substituteBefore, '回滚后的替身必须逐字节不变（未删除任何内容）')
  assert.deepEqual(await snapshotTree(movedReal), realBefore, '被移走的准入对象必须完整')
  assert.equal((await worktreePaths(fixture)).includes(target), true, '登记必须仍指向 target')
  assert.deepEqual(await quarantineEntries(fixture.root), [], '不得留下隔离目录')
  assert.equal(recorder.calls.some(destructiveCall), false, '零 repair/remove/move argv')
})

test('工作树移除：检查后 checkout --detach 被 HEAD 协调锁拒绝，独有提交无法产生', async (t) => {
  const fixture = await fixtureFor(t)
  const target = path.join(fixture.root, 'wt-detach-race')
  const branch = 'work/detach-race'
  const provider = providerFor(fixture)
  assert.equal((await provider.createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await provider.createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  const headBefore = (await git(['rev-parse', `refs/heads/${branch}`], fixture.repositoryPath)).trim()
  const recorder = recordingRunner()
  let detachCode
  let detachStderr = ''
  let commitCode
  let injected = false
  const racing = providerFor(fixture, {
    runGit: async (args) => {
      // 同一注入点（干净门的 status）：真实 Git 尝试把工作树切成 detached 并造一条独有提交。
      if (!injected && args.includes('status')) {
        injected = true
        const detach = spawnSync('git', ['checkout', '--detach'], { cwd: target, encoding: 'utf8' })
        detachCode = detach.status
        detachStderr = detach.stderr ?? ''
        if (detachCode === 0) {
          commitCode = spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', '竞态独有提交'], { cwd: target, encoding: 'utf8' }).status
        }
      }
      return recorder.runGit(args)
    },
  })
  const removed = await racing.removeWorktree({ worktree: worktreeRefFor(target) })
  assert.notEqual(detachCode, 0, 'HEAD 协调锁必须让注入的 checkout --detach 失败')
  assert.match(detachStderr, /cannot lock ref .*HEAD/i, 'Git 必须报告 HEAD 引用锁冲突')
  assert.equal(commitCode, undefined, 'detach 被拒后不得再产生独有提交')
  assert.equal(removed.ok, true, '锁内复验通过后，干净工作树仍必须被移除')
  assert.equal((await git(['rev-parse', `refs/heads/${branch}`], fixture.repositoryPath)).trim(), headBefore, '分支头不得变化')
  assert.equal((await git(['fsck', '--unreachable', '--no-reflogs'], fixture.repositoryPath)).trim(), '', '不得留下不可达提交')
  await assert.rejects(stat(target), { code: 'ENOENT' }, '目录必须消失')
  assert.equal((await worktreePaths(fixture)).includes(target), false, '登记必须消失')
})

test('工作树移除：真实权限导致的可能部分删除答 ambiguous_result 并保留隔离残留与恢复信息', async (t) => {
  const fixture = await fixtureFor(t)
  const target = path.join(fixture.root, 'wt-partial')
  const branch = 'work/partial'
  const provider = providerFor(fixture)
  assert.equal((await provider.createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await provider.createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  await writeFile(path.join(target, 'a-user-file.txt'), 'a\n')
  await mkdir(path.join(target, 'z-read-only'))
  await writeFile(path.join(target, 'z-read-only', 'user-file.txt'), 'z\n')
  await git(['add', 'a-user-file.txt', 'z-read-only/user-file.txt'], target)
  await git(['-c', 'commit.gpgsign=false', 'commit', '-m', '部分删除夹具文件'], target)
  const headBefore = (await git(['rev-parse', `refs/heads/${branch}`], fixture.repositoryPath)).trim()
  await chmod(path.join(target, 'z-read-only'), 0o555)
  try {
    const result = await provider.removeWorktree({ worktree: worktreeRefFor(target) })
    assert.equal(result.ok, false, '真实权限失败必须失败')
    assert.equal(result.error.code, 'ambiguous_result', '可能已经删掉部分内容，不能报成确定的 permission_denied')
    assert.equal(result.error.retryable, false, '结果不确定必须先 reconcile，不能原样重发')
    const [quarantineName] = await quarantineEntries(fixture.root)
    assert.ok(quarantineName !== undefined, '隔离目录必须仍在允许根下')
    const quarantine = path.join(fixture.root, quarantineName)
    assert.match(result.error.message, /\.harness-remove-/, 'message 必须点名隔离目录')
    assert.ok(result.error.message.includes(quarantine), 'message 必须包含完整隔离路径')
    assert.ok(result.error.message.includes(target), 'message 必须包含原目标路径')
    assert.ok(result.error.message.includes(branch), 'message 必须包含分支名')
    assert.match(result.error.message, /reconcile/, 'message 必须要求 reconcile')
    assert.match(result.error.message, /残留/, 'message 必须报告隔离目录残留')
    assert.match(result.error.message, /恢复/, 'message 必须给出恢复步骤')
    const residue = await readdir(quarantine).catch(() => [])
    const marker = await stat(path.join(quarantine, '.git')).catch(() => undefined)
    t.diagnostic(`部分删除残余：${residue.join('、') || '（空）'}；.git 仍在：${marker !== undefined}（删除顺序随平台变化，不作断言）`)
    const readOnly = await readFile(path.join(quarantine, 'z-read-only', 'user-file.txt'), 'utf8').catch(() => undefined)
    if (readOnly !== undefined) assert.equal(readOnly, 'z\n', '只读子目录文件若仍存在，内容必须逐字节保留')
    await assert.rejects(stat(target), { code: 'ENOENT' }, '原目标已让位给隔离目录')
    const registered = await worktreePaths(fixture)
    assert.equal(registered.includes(target), false, '登记不得再指 target')
    assert.equal(registered.includes(quarantine), false, '登记不得再指隔离目录')
    assert.equal((await git(['rev-parse', `refs/heads/${branch}`], fixture.repositoryPath)).trim(), headBefore, '分支头必须保留')
    const again = await provider.removeWorktree({ worktree: worktreeRefFor(target) })
    assert.equal(again.error?.code, 'not_found', '第二次调用只剩 not_found，不能掩盖部分删除')
  } finally {
    const bases = [target, ...(await quarantineEntries(fixture.root)).map((name) => path.join(fixture.root, name))]
    for (const base of bases) await chmod(path.join(base, 'z-read-only'), 0o755).catch(() => undefined)
  }
})

test('工作树移除：reftable 引用后端拒绝破坏性移除（not_supported），工作树与登记逐字节不变', async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-git-reftable-')))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const repositoryPath = path.join(root, 'repo')
  await mkdir(repositoryPath)
  const init = spawnSync('git', ['init', '--ref-format=reftable', '-b', 'main'], { cwd: repositoryPath, encoding: 'utf8' })
  if (init.status !== 0) {
    t.skip('本机 Git 不支持 --ref-format=reftable')
    return
  }
  const run = (args) => git(args, repositoryPath)
  await run(['config', 'user.email', 'local-git-provider@example.invalid'])
  await run(['config', 'user.name', 'Local Git Provider Test'])
  await writeFile(path.join(repositoryPath, 'README.md'), '# reftable fixture\n')
  await run(['add', 'README.md'])
  await run(['-c', 'commit.gpgsign=false', 'commit', '-m', '初始提交'])
  const target = path.join(root, 'wt-reftable')
  await run(['branch', 'work/reftable'])
  await run(['worktree', 'add', target, 'work/reftable'])
  const fixture = { root, repositoryPath, headCommit: '' }
  const before = await snapshotTree(target)
  const registeredBefore = await worktreePaths(fixture)
  const recorder = recordingRunner()
  const result = await providerFor(fixture, { runGit: recorder.runGit }).removeWorktree({ worktree: worktreeRefFor(target) })
  assert.equal(result.ok, false, 'reftable 后端上的破坏性移除必须拒绝，不能静默降级')
  assert.equal(result.error.code, 'not_supported', 'HEAD 协调锁只在 files 后端成立，必须 fail closed')
  assert.equal(result.error.retryable, false)
  assert.match(result.error.message, /reftable/, '必须说明是引用后端限制')
  assert.match(result.error.message, /git worktree remove/, '必须给人工移除出路')
  assert.deepEqual(await snapshotTree(target), before, '被拒的工作树必须逐字节不变')
  assert.deepEqual(await worktreePaths(fixture), registeredBefore, '被拒后登记必须不变')
  assert.equal(recorder.calls.some(destructiveCall), false, '拒绝必须发生在任何破坏性 argv 之前')
  assert.deepEqual(await quarantineEntries(root), [], '不得留下隔离目录')
  const adminHead = path.resolve(target, (await git(['-C', target, 'rev-parse', '--git-path', 'HEAD'], repositoryPath)).trim())
  await assert.rejects(stat(`${adminHead}.lock`), { code: 'ENOENT' }, '必须在创建 HEAD.lock 之前拒绝，不留锁残留')
})

const worktreeRefFor = (externalId) => ({ bindingId: BINDING, objectKind: 'worktree', externalId, url: undefined })

/** 在基线提交里先放 .gitignore，被忽略内容才真的是「被忽略」；否则 .gitignore 自己就是一条未提交路径。 */
const commitGitignore = async (fixture, patterns) => {
  await writeFile(path.join(fixture.repositoryPath, '.gitignore'), `${patterns.join('\n')}\n`)
  await fixture.run(['add', '.gitignore'])
  await fixture.run(['-c', 'commit.gpgsign=false', 'commit', '-m', '忽略测试内容'])
}

test('工作树移除：脏工作树被拒且逐字节不变，错误报告未提交路径数', async (t) => {
  const fixture = await fixtureFor(t)
  await commitGitignore(fixture, ['.env'])
  const target = path.join(fixture.root, 'wt-dirty')
  const branch = 'work/dirty'
  assert.equal((await providerFor(fixture).createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await providerFor(fixture).createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  // 3 条 porcelain 记录：已跟踪文件被修改、已暂存的新文件、未跟踪文件；.env 被忽略，不是未提交路径。
  await writeFile(path.join(target, 'README.md'), '# 修改后的内容\n')
  await writeFile(path.join(target, 'staged.txt'), 'staged\n')
  await git(['add', 'staged.txt'], target)
  await writeFile(path.join(target, 'untracked.txt'), 'untracked\n')
  await writeFile(path.join(target, '.env'), 'SECRET=1\n')
  // 负控：仓库配置会让未跟踪文件从默认 status 里消失；脏检查必须显式 --untracked-files=normal 才看得到 3 条。
  await git(['config', 'status.showUntrackedFiles', 'no'], target)
  const before = await snapshotTree(target)
  const headBefore = (await git(['rev-parse', 'HEAD'], target)).trim()
  const recorder = recordingRunner()
  const result = await providerFor(fixture, { runGit: recorder.runGit }).removeWorktree({ worktree: worktreeRefFor(target) })
  assert.equal(result.ok, false, '脏工作树必须被拒')
  assert.equal(result.error.code, 'invalid_input', '脏树是确定性拒绝，不能是 conflict / ambiguous_result')
  assert.equal(result.error.retryable, false, '脏树必须由用户处理后重新显式请求，原样重发没有意义')
  assert.match(result.error.message, /3 个未提交路径/, '必须报告 porcelain 记录数（显式 --untracked-files=normal 才数得到未跟踪文件）')
  assert.match(result.error.message, /README\.md/, '必须点名一条未提交路径，让用户知道该处理什么')
  assert.match(result.error.message, /请先提交、stash 或清理/, '必须给出可行动出路')
  assert.deepEqual(await snapshotTree(target), before, '被拒的移除不得改动工作树任何一个字节（含被忽略内容）')
  assert.equal((await worktreePaths(fixture)).includes(target), true, '被拒后工作树登记必须保留')
  assert.equal((await git(['rev-parse', 'HEAD'], target)).trim(), headBefore, '被拒后 HEAD 不得变化')
  assert.equal(recorder.calls.some(destructiveCall), false, '脏树拒绝不得发出 remove argv')
})

test('工作树移除：Git 口径下只有被忽略内容的工作树视为干净，显式移除会删除被忽略内容', async (t) => {
  const fixture = await fixtureFor(t)
  await commitGitignore(fixture, ['.env', 'node_modules/'])
  const target = path.join(fixture.root, 'wt-ignored-only')
  const branch = 'work/ignored-only'
  assert.equal((await providerFor(fixture).createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await providerFor(fixture).createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  await writeFile(path.join(target, '.env'), 'SECRET=1\n')
  await mkdir(path.join(target, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(path.join(target, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1\n')
  assert.equal(await git(['status', '--porcelain'], target), '', '前提：只有被忽略内容时 Git 口径下工作树是干净的')
  const before = await snapshotTree(target)
  assert.ok(before.some((entry) => entry.relative === '.env'), '前提：被忽略内容确实在磁盘上')
  const removed = await providerFor(fixture).removeWorktree({ worktree: worktreeRefFor(target) })
  assert.equal(removed.ok, true, 'Git 口径下 ignored-only 是干净工作树，显式请求必须真的移除')
  await assert.rejects(stat(target), { code: 'ENOENT' }, '目录连同被忽略内容一起消失（D2 已文档化的数据损失面）')
  assert.equal((await worktreePaths(fixture)).includes(target), false, '登记必须消失')
})

test('工作树移除：越界、含 .. 与符号链接逃逸都在任何 Git 命令之前被拒（零次调用）', async (t) => {
  const fixture = await fixtureFor(t)
  const outsideDirectory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-git-remove-outside-')))
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }))
  await symlink(outsideDirectory, path.join(fixture.root, 'escape'))
  await symlink(path.join(fixture.root, 'nowhere'), path.join(fixture.root, 'dangling'))
  const cases = [
    { what: '绝对路径越界', target: path.resolve(fixture.root, '..', 'outside-worktree') },
    { what: '绝对路径含 .. 分量', target: `${fixture.root}/nested/../worktree` },
    { what: '相对路径含 .. 分量', target: '../escape-worktree' },
    { what: '符号链接逃逸', target: path.join(fixture.root, 'escape', 'worktree') },
    { what: '悬空符号链接叶子', target: path.join(fixture.root, 'dangling') },
    { what: '首尾空白', target: `${fixture.root}/worktree ` },
  ]
  for (const item of cases) {
    const recorder = recordingRunner()
    const result = await providerFor(fixture, { runGit: recorder.runGit }).removeWorktree({ worktree: worktreeRefFor(item.target) })
    assert.deepEqual(recorder.calls, [], `${item.what} 必须在任何 Git 命令之前被拒（实际调用 ${recorder.calls.length} 次）`)
    assert.equal(result.ok, false, `${item.what} 必须被拒`)
    assert.equal(result.error.code, 'invalid_input', `${item.what} 的拒绝码必须是 invalid_input`)
    assert.equal(result.error.retryable, false, `${item.what} 是输入错误，原样重发没有意义`)
  }
  assert.equal((await worktreePaths(fixture)).length, 1, '被拒的移除不得留下任何工作树')
})

test('工作树移除：未登记、主检出、被换成独立仓库与 detached 都不是可移除对象，且不发出 remove argv', async (t) => {
  const fixture = await fixtureFor(t)
  const target = path.join(fixture.root, 'wt-not-removable')
  const branch = 'work/not-removable'
  const recorder = recordingRunner()
  const provider = providerFor(fixture, { runGit: recorder.runGit })
  assert.equal((await provider.createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await provider.createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  const unregistered = await provider.removeWorktree({ worktree: worktreeRefFor(path.join(fixture.root, 'wt-never-registered')) })
  assert.equal(unregistered.ok, false, '未登记路径没有可移除对象')
  assert.equal(unregistered.error.code, 'not_found', '未登记是 not_found，不是 invalid_input')
  const mainCheckout = await provider.removeWorktree({ worktree: worktreeRefFor(fixture.repositoryPath) })
  assert.equal(mainCheckout.ok, false, '主检出不是可移除的链接工作树')
  assert.equal(mainCheckout.error.code, 'invalid_input')
  assert.match(mainCheckout.error.message, /主检出/, '主检出拒绝必须点名原因')
  await rm(target, { recursive: true, force: true })
  await mkdir(target)
  await git(['init', '-b', 'other'], target)
  // 独立仓库要有自己的提交，才算「可读但属于别人」；unborn HEAD 会被读成不可读，测不到身份比较这一支。
  await git(['config', 'user.email', 'other@example.invalid'], target)
  await git(['config', 'user.name', 'Other Repo'], target)
  await git(['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', '独立仓库的提交'], target)
  const replaced = await provider.removeWorktree({ worktree: worktreeRefFor(target) })
  assert.equal(replaced.ok, false, '登记路径被换成独立仓库时不得按账本删除')
  assert.equal(replaced.error.code, 'invalid_input')
  assert.match(replaced.error.message, /不是本仓库的工作树/, '被换目录的拒绝必须点名原因')
  const detachedTarget = path.join(fixture.root, 'wt-detached')
  const detachedBranch = 'work/detached'
  assert.equal((await provider.createBranch({ repository: repositoryRef, name: detachedBranch, fromRef: 'main' })).ok, true)
  assert.equal((await provider.createWorktree({ repository: repositoryRef, path: detachedTarget, branch: detachedBranch })).ok, true)
  await git(['checkout', '--detach'], detachedTarget)
  const detached = await provider.removeWorktree({ worktree: worktreeRefFor(detachedTarget) })
  assert.equal(detached.ok, false, 'detached 工作树可能承载未被引用的提交，不得移除')
  assert.equal(detached.error.code, 'invalid_input')
  assert.match(detached.error.message, /没有检出分支/, 'detached 拒绝必须点名原因')
  assert.equal(recorder.calls.some(destructiveCall), false, '所有不可移除形态都不得发出 remove argv')
})

test('工作树移除：登记在册但目录已删（prunable）答 not_found 并给出 prune 出路，不静默清理登记', async (t) => {
  const fixture = await fixtureFor(t)
  const target = path.join(fixture.root, 'wt-prunable')
  const branch = 'work/prunable'
  const provider = providerFor(fixture)
  assert.equal((await provider.createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await provider.createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  await rm(target, { recursive: true, force: true })
  const registeredBefore = await worktreePaths(fixture)
  assert.equal(registeredBefore.includes(target), true, '前提：目录已删而登记仍在')
  const recorder = recordingRunner()
  const result = await providerFor(fixture, { runGit: recorder.runGit }).removeWorktree({ worktree: worktreeRefFor(target) })
  assert.equal(result.ok, false, '只清登记不能报成删除了工作树')
  assert.equal(result.error.code, 'not_found')
  assert.match(result.error.message, /git worktree prune/, '必须给人工 prune 出路')
  assert.deepEqual(await worktreePaths(fixture), registeredBefore, '被拒的移除不得静默清理登记')
  assert.equal(recorder.calls.some(destructiveCall), false, 'prunable 不得交给 Git remove 去静默清登记')
})

test('工作树移除：能力关闭时快照不出现该键、调用 not_supported 且零次 Git 调用', async (t) => {
  const fixture = await fixtureFor(t)
  const recorder = recordingRunner()
  const provider = providerFor(fixture, { runGit: recorder.runGit, capabilities: { worktreeRemove: false } })
  assert.equal((await provider.describeCapabilities()).capability['development.worktree.remove'], undefined, '未启用的能力不得出现在快照里')
  // 能力先于身份（port 义务 1）：关闭能力 + 外来 ref 必须答 not_supported，而不是 not_found。
  const result = await provider.removeWorktree({ worktree: { ...worktreeRefFor(path.join(fixture.root, 'wt-off')), bindingId: `${BINDING}-foreign` } })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'not_supported', '能力未声明时结论与输入无关')
  assert.equal(result.error.retryable, false, 'not_supported 必须转人工流程，不是可重试的平台错误')
  assert.deepEqual(recorder.calls, [], '被拒的能力不得触发任何 Git 命令')
})

test('工作树移除：写命令返回成功但隔离残留仍在时答 ambiguous_result，不把未完成删除报成成功', async (t) => {
  const fixture = await fixtureFor(t)
  const target = path.join(fixture.root, 'wt-fake-success')
  const branch = 'work/fake-success'
  const provider = providerFor(fixture)
  assert.equal((await provider.createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await provider.createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  const worktree = worktreeRefFor(target)
  // 1) remove 返回 0 却没有真的删除：报成功就是假绿，只能靠回读隔离目录判成不确定。
  const liar = providerFor(fixture, {
    runGit: async (args) => (args.includes('remove') ? { code: 0, stdout: '', stderr: '' } : defaultGitRunner(args)),
  })
  const lied = await liar.removeWorktree({ worktree })
  assert.equal(lied.ok, false, '写命令自称成功但回读不一致时不得报 ok')
  assert.equal(lied.error.code, 'ambiguous_result', '可能已删/未删之间只能诚实标不确定')
  assert.equal(lied.error.retryable, false, '结果不确定必须先 reconcile，不能原样重发')
  assert.match(lied.error.message, /不确定|reconcile/, '错误消息必须要求 reconcile')
  const [leftover] = await quarantineEntries(fixture.root)
  assert.ok(leftover !== undefined, '隔离目录必须保留，供人工复查')
  const quarantine = path.join(fixture.root, leftover)
  assert.ok(lied.error.message.includes(quarantine), 'message 必须点名隔离目录，让 reconcile 有落点')
  assert.equal((await stat(path.join(quarantine, '.git'))).isFile(), true, '隔离残留里仍是完整工作树')
  await assert.rejects(stat(target), { code: 'ENOENT' }, 'target 已让位给隔离目录')
  assert.equal((await worktreePaths(fixture)).includes(quarantine), true, '登记仍指隔离目录')
  // 2) 真删除之后回读登记失败：观测不到就不能报成功（另起一个工作树，避免上一段残留污染）。
  const blindBranch = 'work/fake-success-blind'
  const blindTarget = path.join(fixture.root, 'wt-fake-success-blind')
  assert.equal((await provider.createBranch({ repository: repositoryRef, name: blindBranch, fromRef: 'main' })).ok, true)
  assert.equal((await provider.createWorktree({ repository: repositoryRef, path: blindTarget, branch: blindBranch })).ok, true)
  let removeIssued = false
  const blind = providerFor(fixture, {
    runGit: async (args) => {
      if (args.includes('remove')) { removeIssued = true; return defaultGitRunner(args) }
      if (removeIssued && args.includes('list')) return { code: 128, stdout: '', stderr: 'fatal: Permission denied' }
      return defaultGitRunner(args)
    },
  })
  const blindResult = await blind.removeWorktree({ worktree: worktreeRefFor(blindTarget) })
  assert.equal(blindResult.ok, false, '回读失败时不得报成功')
  assert.equal(blindResult.error.code, 'ambiguous_result', '删除已发出但观测不到时必须诚实标不确定')
  assert.equal((await worktreePaths(fixture)).some((entry) => entry.includes('blind')), false, '前提：工作树确实已被删除')
})

test('工作树移除：真实 locked 在写入前答 invalid_input 并给 unlock 出路，工作树逐字节不变', async (t) => {
  const fixture = await fixtureFor(t)
  const provider = providerFor(fixture)
  const branch = 'work/locked'
  const target = path.join(fixture.root, 'wt-locked')
  assert.equal((await provider.createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await provider.createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  await git(['worktree', 'lock', target], fixture.repositoryPath)
  const lockedBefore = await snapshotTree(target)
  const headBefore = (await git(['rev-parse', `refs/heads/${branch}`], fixture.repositoryPath)).trim()
  const recorder = recordingRunner()
  const locked = await providerFor(fixture, { runGit: recorder.runGit }).removeWorktree({ worktree: worktreeRefFor(target) })
  assert.equal(locked.ok, false, 'locked 工作树不得移除')
  assert.equal(locked.error.code, 'invalid_input', '真实 locked 是确定性拒绝，必须在任何破坏性写之前拦下')
  assert.equal(locked.error.retryable, false)
  assert.match(locked.error.message, /git worktree unlock/, '必须给人工 unlock 出路')
  assert.deepEqual(await snapshotTree(target), lockedBefore, '被拒的 locked 工作树必须逐字节不变')
  assert.equal((await worktreePaths(fixture)).includes(target), true, '被拒后登记必须保留')
  assert.equal(recorder.calls.some(destructiveCall), false, 'locked 必须在任何破坏性 argv 之前拒绝')
  assert.equal((await git(['rev-parse', `refs/heads/${branch}`], fixture.repositoryPath)).trim(), headBefore, '分支头不得变化')
  assert.deepEqual(await quarantineEntries(fixture.root), [], '不得留下隔离目录')
})

test('工作树移除：repair 非零不得声称已回滚，反向 repair 回读确认后才答 invalid_input', async (t) => {
  const setup = async (name) => {
    const fixture = await fixtureFor(t)
    const target = path.join(fixture.root, `wt-${name}`)
    const provider = providerFor(fixture)
    assert.equal((await provider.createBranch({ repository: repositoryRef, name: `work/${name}`, fromRef: 'main' })).ok, true)
    assert.equal((await provider.createWorktree({ repository: repositoryRef, path: target, branch: `work/${name}` })).ok, true)
    const adminDir = path.dirname(path.resolve(target, (await git(['-C', target, 'rev-parse', '--git-path', 'HEAD'], fixture.repositoryPath)).trim()))
    return { fixture, target, adminDir, before: await snapshotTree(target) }
  }
  // repair 已把 admin gitdir 改写到隔离路径后失败：只 rename 回目录不等于登记也回滚。
  const partial = (adminDir, value) => writeFile(path.join(adminDir, 'gitdir'), `${value}/.git\n`)
  const a = await setup('repair-recovered')
  let injected = false
  const recovered = providerFor(a.fixture, {
    runGit: async (args) => {
      if (!injected && args.includes('repair')) {
        injected = true
        await partial(a.adminDir, args[args.length - 1])
        return { code: 128, stdout: '', stderr: 'fatal: 模拟 repair 中断', interrupted: true }
      }
      return defaultGitRunner(args)
    },
  })
  const recoveredResult = await recovered.removeWorktree({ worktree: worktreeRefFor(a.target) })
  assert.equal(recoveredResult.error?.code, 'invalid_input', '反向 repair 并回读确认登记回到 target 后才是确定性拒绝')
  assert.match(recoveredResult.error.message, /反向 repair|回读确认/, '必须给出恢复依据，而不是空口声称已回滚')
  assert.doesNotMatch(recoveredResult.error.message, /已回滚隔离目录，未删除任何内容/, '不得保留旧的无证据 message')
  assert.deepEqual(await snapshotTree(a.target), a.before, '恢复不得删除或改动内容')
  assert.deepEqual((await worktreePaths(a.fixture)).filter((entry) => entry === a.target || entry.includes('.harness-remove-')), [a.target], '登记必须回到 target 且不指隔离路径')
  const b = await setup('repair-ambiguous')
  let firstRepair = true
  const ambiguous = providerFor(b.fixture, {
    runGit: async (args) => {
      if (args.includes('repair') && firstRepair) {
        firstRepair = false
        await partial(b.adminDir, args[args.length - 1])
        return { code: 128, stdout: '', stderr: 'fatal: 模拟 repair 中断', interrupted: true }
      }
      if (args.includes('repair')) return { code: 128, stdout: '', stderr: 'fatal: 模拟反向 repair 失败' }
      return defaultGitRunner(args)
    },
  })
  const ambiguousResult = await ambiguous.removeWorktree({ worktree: worktreeRefFor(b.target) })
  assert.equal(ambiguousResult.error?.code, 'ambiguous_result', '登记是否已改写无法证明时必须诚实标不确定')
  assert.equal(ambiguousResult.error.retryable, false)
  assert.match(ambiguousResult.error.message, /登记仍指隔离路径/, 'message 必须报告登记的实际位置')
  assert.match(ambiguousResult.error.message, /git worktree repair/, 'message 必须给登记恢复出路')
  assert.doesNotMatch(ambiguousResult.error.message, /已回滚隔离目录，未删除任何内容/, '不得用无法证明的零写入声明')
  const lingering = (await worktreePaths(b.fixture)).filter((entry) => entry.includes('.harness-remove-'))
  assert.equal(lingering.length, 1, '登记确实仍指隔离路径（可核对读数）')
  assert.ok(ambiguousResult.error.message.includes(lingering[0]) && ambiguousResult.error.message.includes(b.target), 'message 必须含完整隔离路径与目标')
})
test('工作树移除：创建、读取、预检与分支方法都不会移除工作树（AC2 的唯一入口）', async (t) => {
  const fixture = await fixtureFor(t)
  const provider = providerFor(fixture)
  const branch = 'work/read-only-surface'
  const target = path.join(fixture.root, 'wt-read-only-surface')
  assert.equal((await provider.createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await provider.createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  const worktree = worktreeRefFor(target)
  const before = await worktreePaths(fixture)
  const recorder = recordingRunner()
  const recording = providerFor(fixture, { runGit: recorder.runGit })
  await recording.getRepository(repositoryRef)
  await recording.listBranches({ repository: repositoryRef, cursor: undefined, limit: 10 })
  await recording.preflightWorktree({ repository: repositoryRef, worktreeKey: 'wt-preflight-guard', branch })
  await recording.getWorktree({ worktree })
  const reused = await recording.createBranch({ repository: repositoryRef, name: branch, fromRef: fixture.headCommit })
  assert.equal(reused.ok, true, '同名分支指向请求起点时必须复用成功；这条分支路径同样不得触发移除')
  const duplicate = await recording.createWorktree({ repository: repositoryRef, path: target, branch })
  assert.equal(duplicate.error?.code, 'conflict', '同一路径重复创建仍是 conflict，不得改写为移除')
  assert.deepEqual(await worktreePaths(fixture), before, '除 removeWorktree 外没有任何方法可以移除工作树')
  assert.equal(recorder.calls.some(destructiveCall), false, '非移除方法不得发出 remove argv')
})

test('能力子集：worktreeCreate 关掉后快照不可用、创建被 not_supported 且零次 Git 调用', async (t) => {
  const fixture = await fixtureFor(t)
  const recorder = recordingRunner()
  const provider = providerFor(fixture, { runGit: recorder.runGit, capabilities: { worktreeCreate: false } })
  const snapshot = await provider.describeCapabilities()
  assert.equal(snapshot.capability['development.worktree.create'], undefined, '未启用的能力不得出现在快照里')
  const created = await provider.createWorktree({ repository: repositoryRef, path: path.join(fixture.root, 'wt-off'), branch: 'main' })
  assert.equal(created.ok, false)
  assert.equal(created.error.code, 'not_supported')
  assert.equal(created.error.retryable, false, 'not_supported 必须转人工流程，不是可重试的平台错误')
  assert.deepEqual(recorder.calls, [], '被拒的能力不得触发任何 Git 命令（守卫必须在任何 Git 调用之前）')
  assert.deepEqual(await worktreePaths(fixture), [fixture.repositoryPath], '被拒的能力不得留下工作树')
})

test('拒绝：占用路径、被别处检出的分支与不可访问的目录都不伪造成功', async (t) => {
  const fixture = await fixtureFor(t)
  const provider = providerFor(fixture)
  await provider.createBranch({ repository: repositoryRef, name: 'work/taken', fromRef: 'main' })
  const target = path.join(fixture.root, 'occupied')
  await writeFile(target, '占位\n')
  const occupied = await provider.createWorktree({ repository: repositoryRef, path: target, branch: 'work/taken' })
  assert.equal(occupied.ok, false); assert.equal(occupied.error.code, 'invalid_input')
  assert.match(occupied.error.message, /已存在但不是工作树/, '占用路径必须走"路径被占"这一支，而不是"分支被占"')
  // 主检出自己就是一份已登记的工作树：在它上面检出目标分支，等于"身份被别的东西占着"。
  await fixture.run(['checkout', '-b', 'work/held'])
  const held = await provider.createWorktree({ repository: repositoryRef, path: path.join(fixture.root, 'wt-held'), branch: 'work/held' })
  assert.equal(held.error?.code, 'invalid_input', '没有可复用对象时不得报 core 会当成复用成功的 conflict')
  // 前置判定必须自己给出原因，不能只靠 git 的 stderr 措辞：REFUSALS 是字符串匹配，措辞一变就会落到
  // 写命令兜底 ambiguous_result，而 core 会把 ambiguous_result 拿去 reconcile 并静默复用（第四轮 P3）。
  assert.match(held.error.message, /已被另一份工作树检出/, '分支被占用必须由前置判定点名，而不是让 git 拒绝')
  // 不可访问（非 ENOENT / ENOTDIR）不是"路径不存在"：必须结构化拒绝，不能抛裸异常穿过 provider 的契约。
  const blocked = path.join(fixture.root, 'blocked')
  await mkdir(blocked); await chmod(blocked, 0o000)
  const denied = await provider.createWorktree({ repository: repositoryRef, path: path.join(blocked, 'wt'), branch: 'work/taken' })
  await chmod(blocked, 0o755)
  assert.equal(denied.error?.code, 'invalid_input', '不可访问的目标必须结构化拒绝，不能抛裸异常')
})

test('读取：仓库目录一时不可达报 unavailable，不是确定不存在的 not_found；目录回来后照常读回', async (t) => {
  const fixture = await fixtureFor(t); const provider = providerFor(fixture)
  await provider.createBranch({ repository: repositoryRef, name: 'work/away', fromRef: 'main' })
  const created = await provider.createWorktree({ repository: repositoryRef, path: path.join(fixture.root, 'wt-away'), branch: 'work/away' })
  const worktree = { bindingId: BINDING, objectKind: 'worktree', externalId: created.value.path, url: undefined }
  await rename(fixture.repositoryPath, `${fixture.repositoryPath}-away`)
  const away = await provider.getWorktree({ worktree }); await rename(`${fixture.repositoryPath}-away`, fixture.repositoryPath)
  assert.deepEqual([away.ok, away.error?.code, (await provider.getWorktree({ worktree })).value?.branch], [false, 'unavailable', 'work/away'])
})

test('默认分支：无 origin/HEAD 时按本地事实推断，不用当前检出分支冒充', async (t) => {
  const fixture = await fixtureFor(t, 'trunk')
  const provider = providerFor(fixture)
  // 唯一本地分支就是基线：git 2.50 未配置 init.defaultBranch 时 git init 建出的是 master，本地建库后
  // git remote add + push -u 的仓库也没有 origin/HEAD，两类仓库此前都会因为 core 回落 main 而必然失败。
  assert.equal((await provider.getRepository(repositoryRef)).value.defaultBranch, 'trunk', '唯一本地分支就是基线')
  await fixture.run(['checkout', '-b', 'feature/current'])
  assert.equal((await provider.getRepository(repositoryRef)).value.defaultBranch, 'trunk', '当前检出分支不是仓库基线')
  // 起点读不到时必须点名缺的是哪个 ref，否则用户无从处理（core 只能报一句「起点不存在」）。
  const missing = await provider.createBranch({ repository: repositoryRef, name: 'feature/x', fromRef: 'no-such-base' })
  assert.equal(missing.error?.code, 'not_found')
  assert.match(missing.error.message, /no-such-base/, '缺失的起点必须在错误信息里点名')
  // 以 `-` 开头的起点不得被解释成 rev-parse 的选项。实测当前不可利用（`^{commit}` 后缀偶然挡住），所以
  // 钉的是**argv 形状**：git 对不可信名字的推荐写法是 `--end-of-options`，不是依赖后缀的巧合。
  const recorder = recordingRunner()
  const dash = await providerFor(fixture, { runGit: recorder.runGit })
    .createBranch({ repository: repositoryRef, name: 'feature/dash', fromRef: '--help' })
  assert.equal(dash.error?.code, 'not_found', '选项形态的起点是「找不到这个 revision」，不是「参数非法」')
  assert.deepEqual(recorder.calls[0]?.slice(2), ['rev-parse', '--verify', '--end-of-options', '--help^{commit}'])
})

test('显式注入检出内的旧允许根：仓库里的 .worktrees 符号链接一律被拒，指向哪里都一样', async (t) => {
  const fixture = await fixtureFor(t)
  const outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-git-outside-root-')))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await mkdir(path.join(fixture.repositoryPath, 'src'))
  const link = path.join(fixture.repositoryPath, '.worktrees')
  // 三种指向都必须被拒。第四轮只判「realpath 之后是否仍在仓库内」，于是指向仓库内部的两种被放行：检出写进
  // 被跟踪目录（主检出 `git add -A` 会当嵌入仓库暂存，`info/exclude` 覆盖不到），或写进 git 自己的管理区。
  // 判定的是**写法**而不是解析结果，与 `..` 分量同一条口径。默认根已在检出外（#214），这条不变量只剩显式注入的
  // 检出内允许根会走到，所以这里显式注入旧根：否则 `.worktrees/...` 先以逃出默认根被拒，符号链接判定无人看护。
  // 目标经链接下一个已存在的子目录 `sub`：尾部判定只看最近存在祖先之下，于是只剩允许根的符号链接判定在拦。
  for (const [what, target] of [['被跟踪目录', 'src'], ['git 管理区', '.git'], ['仓库之外', outside]]) {
    const pointed = target === outside ? outside : path.join(fixture.repositoryPath, target)
    await rm(link, { recursive: true, force: true })
    await mkdir(path.join(pointed, 'sub'), { recursive: true })
    await symlink(pointed, link)
    const recorder = recordingRunner()
    const provider = createLocalGitDevelopmentProvider({
      bindingId: BINDING, repository: { externalId: REPOSITORY_ID, path: fixture.repositoryPath }, runGit: recorder.runGit, allowedRoot: link,
    })
    const result = await provider.createWorktree({ repository: repositoryRef, path: '.worktrees/sub/wi-escape', branch: 'main' })
    assert.equal(result.error?.code, 'invalid_input', `允许根是符号链接（${what}）时必须结构化拒绝`)
    assert.deepEqual(recorder.calls, [], `拒绝必须在任何 Git 命令之前（#137 验收 1，${what}）`)
    assert.deepEqual(await worktreePaths(fixture), [fixture.repositoryPath], `不得留下工作树（${what}）`)
  }
  assert.deepEqual(await readdir(path.join(outside, 'sub')), [], '仓库外不得出现任何工作树')
})

test('默认工作树根在 checkout 外，且不受 checkout 内 .worktrees 符号链接或 info/exclude 影响', async (t) => {
  const fixture = await fixtureFor(t)
  const outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-git-derived-root-')))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await symlink(outside, path.join(fixture.repositoryPath, '.worktrees'))
  const provider = createLocalGitDevelopmentProvider({
    bindingId: BINDING, repository: { externalId: REPOSITORY_ID, path: fixture.repositoryPath },
  })
  const beforePath = path.resolve(fixture.repositoryPath, (await git(['rev-parse', '--git-path', 'info/exclude'], fixture.repositoryPath)).trim())
  const before = await readFile(beforePath).catch(() => Buffer.alloc(0))
  assert.equal((await provider.createBranch({ repository: repositoryRef, name: 'work/derived', fromRef: 'main' })).ok, true)
  const created = await provider.createWorktree({ repository: repositoryRef, path: undefined, worktreeKey: 'wi-derived', branch: 'work/derived' })
  assert.equal(created.ok, true)
  assert.equal(created.value.path, path.join(path.dirname(fixture.repositoryPath), `${path.basename(fixture.repositoryPath)}.worktrees`, 'wi-derived'))
  assert.equal(created.value.path.startsWith(`${fixture.repositoryPath}${path.sep}`), false, '默认目标必须在 checkout 外')
  assert.equal((await readFile(beforePath).catch(() => Buffer.alloc(0))).compare(before), 0, '默认创建不得写 info/exclude')
  assert.deepEqual(await readdir(outside), [], 'checkout 内的 .worktrees 符号链接目标不得被写入')
})

test('默认根按真实 checkout 根派生，而不是 repository.path 指向的子目录', async (t) => {
  const fixture = await fixtureFor(t)
  const nestedRepositoryPath = path.join(fixture.repositoryPath, 'packages', 'core')
  await mkdir(nestedRepositoryPath, { recursive: true })
  const provider = createLocalGitDevelopmentProvider({
    bindingId: BINDING, repository: { externalId: REPOSITORY_ID, path: nestedRepositoryPath },
  })
  const nestedRepository = { ...repositoryRef, externalId: REPOSITORY_ID }
  const branch = 'work/subdirectory-repository'
  assert.equal((await provider.createBranch({ repository: nestedRepository, name: branch, fromRef: 'main' })).ok, true)
  const expectedRoot = path.join(path.dirname(fixture.repositoryPath), `${path.basename(fixture.repositoryPath)}.worktrees`)
  const preflight = await provider.preflightWorktree({ repository: nestedRepository, worktreeKey: 'wi-subdirectory', branch })
  assert.equal(preflight.ok, true)
  assert.equal(preflight.value.path, path.join(expectedRoot, 'wi-subdirectory'), '预检必须按 Git 真实 checkout 根派生默认目标')
  const created = await provider.createWorktree({ repository: nestedRepository, path: undefined, worktreeKey: 'wi-subdirectory', branch })
  assert.equal(created.ok, true)
  assert.equal(created.value.path, path.join(expectedRoot, 'wi-subdirectory'))
  assert.equal(created.value.path.startsWith(`${fixture.repositoryPath}${path.sep}`), false, '子目录配置不得把默认工作树放回 checkout 内')
})

test('子目录配置的非法目标在任何 Git argv 之前被拒', async (t) => {
  const fixture = await fixtureFor(t)
  const nestedRepositoryPath = path.join(fixture.repositoryPath, 'packages', 'core')
  await mkdir(nestedRepositoryPath, { recursive: true })
  const recorder = recordingRunner()
  const provider = createLocalGitDevelopmentProvider({
    bindingId: BINDING, repository: { externalId: REPOSITORY_ID, path: nestedRepositoryPath }, runGit: recorder.runGit,
  })
  const result = await provider.createWorktree({
    repository: repositoryRef, path: '../escape-worktree', worktreeKey: 'wi-invalid', branch: 'main',
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'invalid_input')
  assert.deepEqual(recorder.calls, [], '子目录配置的路径拒绝不得先解析 Git checkout')
})

test('默认根只认独立检出：位于另一 Git 检出之内、bare 与缺席的仓库目录在任何 Git argv 之前 fail closed，不借用外层检出', async (t) => {
  const fixture = await fixtureFor(t)
  const source = await fixtureFor(t)
  const outer = fixture.repositoryPath
  await fixture.run(['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source.repositoryPath, 'sub'])
  await git(['init', '-q', path.join(outer, 'vendor', 'nested')], fixture.root)
  await git(['clone', '-q', '--bare', source.repositoryPath, path.join(outer, 'vendor', 'x.git')], fixture.root)
  await git(['clone', '-q', '--bare', source.repositoryPath, path.join(fixture.root, 'x.git')], fixture.root)
  await fixture.run(['worktree', 'add', '-q', '-b', 'side', path.join(fixture.root, 'linked')])
  await git(['init', '-q', path.join(fixture.root, 'linked', 'vendor', 'inner')], fixture.root)
  // Git 不认的 .git 不是外层检出：空目录、内容不以 gitdir: 开头的文件（Git 在那里答 not a git repository）。
  await mkdir(path.join(fixture.root, 'stale', '.git'), { recursive: true })
  await git(['init', '-q', path.join(fixture.root, 'stale', 'repo')], fixture.root)
  await mkdir(path.join(fixture.root, 'junk'))
  await writeFile(path.join(fixture.root, 'junk', '.git'), 'not a gitfile\n')
  await git(['init', '-q', path.join(fixture.root, 'junk', 'repo')], fixture.root)
  const late = path.join(fixture.root, 'late')
  const grown = path.join(outer, 'grown')
  await mkdir(grown)
  const recorder = recordingRunner()
  const providerAt = (at) => createLocalGitDevelopmentProvider({ bindingId: BINDING, repository: { externalId: REPOSITORY_ID, path: at }, runGit: recorder.runGit })
  const preflight = async (provider) => {
    const result = await provider.preflightWorktree({ repository: repositoryRef, worktreeKey: 'wi-x', branch: 'main' })
    return result.ok ? path.relative(fixture.root, result.value.path) : result.error.code
  }
  const lateProvider = providerAt(late)
  const grownProvider = providerAt(grown)
  const shapes = {
    submodule: 'repo/sub', nested: 'repo/vendor/nested', nestedBare: 'repo/vendor/x.git', bare: 'x.git', missingInsideCheckout: 'repo/absent',
    linked: 'linked', insideLinked: 'linked/vendor/inner', emptyGitAncestor: 'stale/repo', junkGitFileAncestor: 'junk/repo',
  }
  const actual = {}
  for (const [shape, at] of Object.entries(shapes)) actual[shape] = await preflight(providerAt(path.join(fixture.root, at)))
  actual.lateBefore = await preflight(lateProvider)
  await git(['init', '-q', late], fixture.root)
  actual.lateAfter = await preflight(lateProvider)
  // 目录先存在（子目录配置，派生外层检出的兄弟目录）、后 git init 成嵌套仓库：同一实例必须跟着改判，不得沿用首次结论。
  actual.grownBefore = await preflight(grownProvider)
  await git(['init', '-q', grown], fixture.root)
  actual.grownAfter = await preflight(grownProvider)
  assert.deepEqual(actual, {
    submodule: 'invalid_input', nested: 'invalid_input', nestedBare: 'invalid_input', bare: 'invalid_input',
    missingInsideCheckout: 'unavailable', linked: path.join('linked.worktrees', 'wi-x'), insideLinked: 'invalid_input',
    emptyGitAncestor: path.join('stale', 'repo.worktrees', 'wi-x'), junkGitFileAncestor: path.join('junk', 'repo.worktrees', 'wi-x'),
    lateBefore: 'unavailable', lateAfter: path.join('late.worktrees', 'wi-x'),
    grownBefore: path.join('repo.worktrees', 'wi-x'), grownAfter: 'invalid_input',
  }, '只有 Git 认得的外层检出才拒绝；仓库目录缺席时不借用；派生结论不缓存')
  const refused = await providerAt(path.join(fixture.root, 'repo', 'sub')).preflightWorktree({ repository: repositoryRef, worktreeKey: 'wi-x', branch: 'main' })
  assert.match(refused.error.message, /位于另一个 Git 检出 .+ 之内.*显式注入 allowedRoot.*#132/, '消息点名外层检出与出路，不把它断言成 submodule')
  assert.deepEqual(recorder.calls, [], '默认根判定只做文件系统探测')
})

test('显式旧根仍可注入，且 provider 不写 info/exclude 或 .gitignore', async (t) => {
  const fixture = await fixtureFor(t)
  const excludePath = path.join(fixture.repositoryPath, '.git', 'info', 'exclude')
  const before = await readFile(excludePath)
  const provider = createLocalGitDevelopmentProvider({
    bindingId: BINDING, repository: { externalId: REPOSITORY_ID, path: fixture.repositoryPath },
    allowedRoot: path.join(fixture.repositoryPath, '.worktrees'),
  })
  assert.equal((await provider.createBranch({ repository: repositoryRef, name: 'work/wi-ignored', fromRef: 'main' })).ok, true)
  const created = await provider.createWorktree({ repository: repositoryRef, path: '.worktrees/wi-ignored', branch: 'work/wi-ignored' })
  assert.equal(created.ok, true)
  assert.equal((await readFile(excludePath)).compare(before), 0, '显式旧根也不得由 provider 改写 info/exclude')
  assert.equal(await readFile(path.join(fixture.repositoryPath, '.gitignore'), 'utf8').then(() => true, () => false), false, '不得改用户跟踪的 .gitignore')
})

test('读取：默认分支按本地事实推断，提交只按对象名读回', async (t) => {
  const fixture = await fixtureFor(t)
  const provider = providerFor(fixture, { repository: { externalId: REPOSITORY_ID, path: fixture.repositoryPath, defaultBranch: 'main' } })
  assert.equal((await provider.getRepository(repositoryRef)).value.defaultBranch, 'main', '注入值优先')
  await fixture.run(['checkout', '-b', 'feature/current'])
  assert.equal((await provider.getRepository(repositoryRef)).value.defaultBranch, 'main', '注入值不受当前检出影响')
  const short = await provider.getCommit({ ...repositoryRef, objectKind: 'commit', externalId: fixture.headCommit.slice(0, 7) })
  assert.equal(short.value.sha, fixture.headCommit, '短 sha 必须回填解析后的真实 sha，不能变成第二个提交身份')
  const missing = await provider.getCommit({ ...repositoryRef, objectKind: 'commit', externalId: '0'.repeat(40) })
  assert.equal(missing.error?.code, 'not_found', '不存在的提交必须结构化 not_found，而不是静默返回别的对象')
  // rev（HEAD / 选项形态）不是稳定的外部身份，也不能进 argv：拒绝而不是把它当 sha 回填。
  const revision = await provider.getCommit({ ...repositoryRef, objectKind: 'commit', externalId: 'HEAD' })
  assert.equal(revision.error?.code, 'invalid_input', 'rev 形态必须被拒，否则同一提交会出现第二个身份')
  const foreign = await provider.getCommit({ ...repositoryRef, bindingId: `${BINDING}-foreign`, objectKind: 'commit', externalId: fixture.headCommit })
  assert.equal(foreign.error?.code, 'not_found', '外来 binding 的提交引用必须冷拒')
})
