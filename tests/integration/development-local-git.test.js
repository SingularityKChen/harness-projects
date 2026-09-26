/** 本地 Git provider **自身**的行为：路径安全、分支身份、能力子集、写后回读、默认根与读面。`argv-only`
 * 由 tests/contract/development-local-git-source.test.js 的源码扫描保证；夹具见 local-git-fixture.js。
 * 接进 core 供应序列的系统验收不在本层（#209 交付）。 */
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

import {
  createLocalGitDevelopmentProvider, defaultGitRunner, resolveWorktreePath,
} from '@harness-projects/provider-development-local-git'

import { developmentContractSuite } from '../contract/suites/development.js'
import {
  BINDING, REPOSITORY_ID, faultRunner, fixtureFor, git, makeFixture, providerFor,
  recordingRunner, repositoryRef, worktreePaths,
} from './local-git-fixture.js'

const suiteFixture = await makeFixture((cleanup) => after(cleanup))

developmentContractSuite({
  label: '本地 Git provider',
  makeProvider: (scenario = {}) => providerFor(suiteFixture, {
    runGit: faultRunner(scenario.faults), capabilities: scenario.capabilities,
    // 宿主事实：fixture 仓库没有 origin，默认分支由注入提供（provider 不实现工作树移除，套件据此不索取它）。
    repository: { externalId: REPOSITORY_ID, path: suiteFixture.repositoryPath, defaultBranch: 'main' },
  }),
  expect: {
    repository: repositoryRef, baseBranch: 'main', headCommit: suiteFixture.headCommit, pageSize: 1,
    worktreePath: path.join(suiteFixture.root, 'wt-suite'),
    // 副作用断言要看的对象集合：直接读仓库（分支 + 已登记工作树），不经过 provider 的 runner。
    objects: async () => ({
      branches: (await git(['for-each-ref', '--format=%(refname:short)\t%(objectname)', 'refs/heads'], suiteFixture.repositoryPath)).trim(),
      worktrees: await worktreePaths(suiteFixture),
    }),
  },
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
    // 零调用断言在返回码之前：拒绝必须发生在任何 Git 命令之前，而不是"命令失败了所以看起来被拒"。
    assert.deepEqual(recorder.calls, [], `${item.what} 必须在任何 Git 命令之前被拒（实际调用 ${recorder.calls.length} 次）`)
    assert.equal(result.ok, false, `${item.what} 必须被拒`)
    assert.equal(result.error.code, 'invalid_input', `${item.what} 的拒绝码必须是 invalid_input`)
    assert.equal(result.error.retryable, false, `${item.what} 是输入错误，原样重发没有意义`)
  }
  // 首尾空白是**拒绝**而不是 trim：` .worktrees` 是另一个合法目录名，静默改写会把工作树建到别处。
  assert.equal((await resolveWorktreePath('.worktrees/sp ', { repositoryPath: fixture.repositoryPath, allowedRoot: fixture.root })).ok, false)
  // `..wi` 是允许根内的合法名字，不是逃逸：旧判定用字符串前缀把 `..` 开头的分量一律当成越界，只是更严。
  assert.equal((await resolveWorktreePath(path.join(fixture.root, '..wi'), { repositoryPath: fixture.repositoryPath, allowedRoot: fixture.root })).ok, true)
  assert.equal((await worktreePaths(fixture)).length, 1, '被拒的路径不得留下任何工作树')
})

test('路径安全：已存在的目标祖先是符号链接时，带新尾部的路径也在任何 Git 命令之前被拒', async (t) => {
  const fixture = await fixtureFor(t)
  // 允许根在仓库外；仓库内容把 alias 指向该根时，alias/new 仍不得借由 realpath 落入已批准根。
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
  // 登记还在但目录已消失：没有可复用对象，必须是硬失败（core 侧不得报 ready 见 core 层用例）。
  await rm(target, { recursive: true, force: true })
  const gone = await provider.createWorktree({ repository: repositoryRef, path: target, branch: 'work/wi-1' })
  assert.equal(gone.error?.code, 'invalid_input', '登记仍在而目录消失时没有可复用对象')
  // 登记在册、目录还在、但目录已经不是那份工作树：prunable（.git 文件被删）、独立仓库、被 lock 后替换。
  // 这三种形态 core 都不能复用，provider 不得报它当复用成功的 conflict。
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

test('能力子集：只声明三个键，且不实现工作树移除', async (t) => {
  const fixture = await fixtureFor(t)
  const provider = providerFor(fixture)
  assert.deepEqual(
    Object.keys((await provider.describeCapabilities()).capability).sort(),
    ['development.branch.create', 'development.repository.read', 'development.worktree.create'],
    '本地 Git 只声明这三个能力键',
  )
  // 移除是破坏性能力，本层不实现也不声明（issue #137 的 Out of scope，由 #138 交付）：能创建不等于能移除。
  assert.equal(provider.removeWorktree, undefined, '本层不得实现工作树移除')
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

test('默认允许根：仓库里的 .worktrees 符号链接一律被拒，指向哪里都一样', async (t) => {
  const fixture = await fixtureFor(t)
  const outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-git-outside-root-')))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await mkdir(path.join(fixture.repositoryPath, 'src'))
  const link = path.join(fixture.repositoryPath, '.worktrees')
  // 三种指向都必须被拒。第四轮只判「realpath 之后是否仍在仓库内」，于是指向仓库内部的两种被放行：检出写进
  // 被跟踪目录（主检出 `git add -A` 会当嵌入仓库暂存，`info/exclude` 覆盖不到），或写进 git 自己的管理区。
  // 判定的是**写法**而不是解析结果，与 `..` 分量同一条口径。
  for (const [what, target] of [['被跟踪目录', 'src'], ['git 管理区', '.git'], ['仓库之外', outside]]) {
    await rm(link, { recursive: true, force: true })
    await symlink(target === outside ? outside : path.join(fixture.repositoryPath, target), link)
    const recorder = recordingRunner()
    const provider = createLocalGitDevelopmentProvider({
      bindingId: BINDING, repository: { externalId: REPOSITORY_ID, path: fixture.repositoryPath }, runGit: recorder.runGit,
    })
    const result = await provider.createWorktree({ repository: repositoryRef, path: '.worktrees/wi-escape', branch: 'main' })
    assert.equal(result.error?.code, 'invalid_input', `默认根是符号链接（${what}）时必须结构化拒绝`)
    assert.deepEqual(recorder.calls, [], `拒绝必须在任何 Git 命令之前（#137 验收 1，${what}）`)
    assert.deepEqual(await worktreePaths(fixture), [fixture.repositoryPath], `不得留下工作树（${what}）`)
  }
  assert.deepEqual(await readdir(outside), [], '仓库外不得出现任何工作树')
})

test('默认允许根：/.worktrees/ 幂等写进 info/exclude，不动用户跟踪的 .gitignore', async (t) => {
  const fixture = await fixtureFor(t)
  const provider = createLocalGitDevelopmentProvider({
    bindingId: BINDING, repository: { externalId: REPOSITORY_ID, path: fixture.repositoryPath },
  })
  assert.equal((await provider.createBranch({ repository: repositoryRef, name: 'work/wi-ignored', fromRef: 'main' })).ok, true)
  const created = await provider.createWorktree({ repository: repositoryRef, path: '.worktrees/wi-ignored', branch: 'work/wi-ignored' })
  assert.equal(created.ok, true)
  // git 不会自动忽略嵌套工作树：不写 exclude 的话主检出的 git add -A 会把工作树当嵌入仓库收进索引。
  assert.equal((await git(['status', '--porcelain'], fixture.repositoryPath)).trim(), '', '主检出不得把默认根看成未跟踪内容')
  const exclude = await readFile(path.join(fixture.repositoryPath, '.git', 'info', 'exclude'), 'utf8')
  assert.equal(exclude.split('\n').filter((line) => line === '/.worktrees/').length, 1, '幂等：只写一条')
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
