/**
 * 源码树扫描 helper 的契约（issue #350、ExecPlan 2026-10-21-scans-skip-build-output）。
 *
 * 保护的不变量：遍历 `packages/`、`apps/` 的扫描看到的源码集合，与 CI 干净检出里被跟踪的源码一致——
 * 根 `.gitignore` 的裸目录规则（`dist/`、`build/`、`node_modules/` 等）是「什么算构建产物」的唯一来源，
 * 本机残留的被忽略目录不会被算成源码，被跟踪的源码里的第二个调用点也不会被漏掉。
 * 用例各自在 mkdtemp 里造夹具，自带 `.gitignore`，不依赖本机是否跑过构建。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { callSites, ignoredDirectoryNames, listSourceFiles } from '../fixtures/source-tree.mjs'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SCOPES = ['packages', 'apps']
const CALL = /\.putDeliveryFacts\(/

/** 在 mkdtemp 根下写入 `.gitignore` 与文件（都含 CALL，除非另给内容），返回根目录；清理交给 `t.after`。 */
function fixture(t, gitignore, files, content = 'store.putDeliveryFacts(x)\n') {
  const root = mkdtempSync(path.join(tmpdir(), 'source-tree-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  if (gitignore !== undefined) writeFileSync(path.join(root, '.gitignore'), gitignore)
  for (const file of files) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
  }
  return root
}

test('C1 构建产物与依赖目录里的调用点不计（深度不限）；被跟踪与新建源码里的第二个调用点仍被找到', (t) => {
  const root = fixture(t, '# 依赖\nnode_modules/\ndist/\nbuild/\n', [
    'packages/core/src/writer.ts',
    'packages/core/src/other.ts',
    'apps/a/src/caller.ts',
    'apps/x/dist/package/lib/index.js', // 被忽略：任意深度的 dist
    'apps/dist/top.js', // 被忽略：scope 顶层的 dist（scope 的直接子目录也要剪）
    'packages/core/node_modules/dep/index.js', // 被忽略：依赖
    'packages/core/build/gen.ts', // 被忽略：另一个构建目录名
    'packages/core/README.md', // 不是源码扩展名
  ])
  assert.deepEqual(callSites(root, SCOPES, CALL), ['a/src/caller.ts', 'core/src/other.ts', 'core/src/writer.ts'])
  assert.deepEqual(
    listSourceFiles(root, SCOPES).map(({ scope, file }) => `${scope}/${file}`).sort(),
    ['apps/a/src/caller.ts', 'packages/core/src/other.ts', 'packages/core/src/writer.ts'],
  )
})

test('共享源码集合覆盖 package-boundaries 与 local-git 扫描的扩展名', (t) => {
  const root = fixture(t, 'dist/\n', [
    'packages/p/src/module.mts', 'packages/p/src/module.cts',
    'packages/p/src/module.cjs', 'packages/p/src/module.jsx',
  ])
  assert.deepEqual(callSites(root, SCOPES.slice(0, 1), CALL), [
    'p/src/module.cjs', 'p/src/module.cts', 'p/src/module.jsx', 'p/src/module.mts',
  ])
})

test('C2 只认裸目录规则：锚定、通配、取反、注释和带路径的规则都不剪枝，对应目录照常扫描', (t) => {
  const root = fixture(t, ['/out/', 'tmp*/', '!keep/', '*.local', '# gone/', 'src/gen/', 'dist/'].join('\n'), [
    'packages/p/out/x.ts', // 锚定规则
    'packages/p/tmp1/x.ts', // 通配规则
    'packages/p/keep/x.ts', // 取反规则
    'packages/p/a.local/x.ts', // 文件通配规则
    'packages/p/gone/x.ts', // 注释
    'packages/p/src/gen/x.ts', // 带路径的规则
    'packages/p/dist/x.ts', // 唯一被收下的裸目录规则
  ])
  assert.deepEqual([...ignoredDirectoryNames(root)], ['dist'])
  assert.deepEqual(callSites(root, SCOPES.slice(0, 1), CALL), ['p/a.local/x.ts', 'p/gone/x.ts', 'p/keep/x.ts', 'p/out/x.ts', 'p/src/gen/x.ts', 'p/tmp1/x.ts'])
})

test('C3 缺 .gitignore 或缺 scope 时抛错，不悄悄返回空集', (t) => {
  const noIgnore = fixture(t, undefined, ['packages/core/src/a.ts'])
  assert.throws(() => ignoredDirectoryNames(noIgnore), { code: 'ENOENT' })
  assert.throws(() => callSites(noIgnore, SCOPES.slice(0, 1), CALL), { code: 'ENOENT' })
  const noScope = fixture(t, 'dist/\n', ['packages/core/src/a.ts'])
  assert.throws(() => callSites(noScope, SCOPES, CALL), { code: 'ENOENT' })
})

test('C2b 按 git 的行语义解析：行首空白不是规则，取反规则末段（含通配）匹配到的目录名不剪枝，CRLF、行尾空格与 BOM 被去掉', (t) => {
  // 每一行的预期都与 `git check-ignore` 在临时仓库里的结论一致；C4 在检出里防止 helper 比 Git 少扫。
  const cases = [
    ['行首空格', '  dist/\n', []],
    ['行首制表符', '\tdist/\n', []],
    ['行尾制表符是规则的一部分，不是可去掉的空白', 'dist/\t\n', []],
    ['整体取反', 'dist/\n!dist/\n', []],
    ['按路径取反（保守：这个名字整体不剪）', 'dist/\n!packages/p/dist/\n', []],
    ['取反末段带通配：`!*/` 让每个目录都不剪', 'dist/\n!*/\n', []],
    ['取反末段带通配：只放过被它匹配的名字', 'dist/\nbuild/\n!dis*/\n', ['build']],
    ['取反末段带字符类与问号', 'dist/\nbuild/\n![d]ist/\n!b?ild/\n', []],
    ['文件通配的取反不碰目录剪枝', 'dist/\n!*.local\n', ['dist']],
    ['取反末段里的普通字符按字面比较，未闭合的 [ 也不抛错', 'dist/\n!d.st/\n!a(b/\n!c[d/\n', ['dist']],
    ['CRLF 与行尾空格', 'dist/\r\nbuild/  \r\n', ['build', 'dist']],
    ['开头的 BOM', '\uFEFFdist/\n', ['dist']],
  ]
  for (const [label, gitignore, expected] of cases) {
    assert.deepEqual([...ignoredDirectoryNames(fixture(t, gitignore, []))].sort(), expected, label)
  }
})

test('C6 符号链接不下钻也不当文件算：指向 scope 外目录的链接和指向源码的文件链接都不计', (t) => {
  const root = fixture(t, 'dist/\n', ['packages/core/src/writer.ts', 'outside/hidden.ts'])
  try {
    symlinkSync('../../outside', path.join(root, 'packages/core/link'), 'dir')
    symlinkSync('writer.ts', path.join(root, 'packages/core/src/alias.ts'), 'file')
  } catch (error) {
    return t.skip(`无法创建符号链接（${error.code}）`)
  }
  assert.deepEqual(callSites(root, SCOPES.slice(0, 1), CALL), ['core/src/writer.ts'])
})

test('C2c 取反含转义或闭合字符类时不剪枝，Git 重新包含的真实源码仍被扫描；失效规则也不抛错', (t) => {
  const root = gitFixture(t, ['packages/p/dist/x.ts'])
  if (root === undefined) return t.skip('git 不可用')
  const git = gitIn(root)
  for (const pattern of [
    '!d\\ist/', '!dis\\t/', '![[:alpha:]]ist/', '!d[[:alpha:]]st/',
    '![]d]ist/', '!d[]i]st/', '![]a-d]ist/',
    '![!]]ist/', '![^]]ist/', '!d[!]]st/', '!d[^]]st/', '![][d]ist/',
    '![\u2028d]ist/', '![\u2029d]ist/', // 写入 .gitignore 时为真实 Unicode 行分隔符，不是字面转义
  ]) {
    writeFileSync(path.join(root, '.gitignore'), `dist/\n${pattern}\n`)
    assert.throws(() => git('check-ignore', '-q', '--', 'packages/p/dist/x.ts'), { status: 1 }, `Git 不忽略：${pattern}`)
    assert.deepEqual(callSites(root, ['packages'], CALL), ['p/dist/x.ts'], `真实源码不漏扫：${pattern}`)
  }
  // 不能把未知或失效的取反当成安全剪枝的证据；保守多扫即可，不尝试补齐 fnmatch。
  writeFileSync(path.join(root, '.gitignore'), 'dist/\n!d[[:unknown:]]st/\n!dist\\\n')
  assert.deepEqual(callSites(root, ['packages'], CALL), ['p/dist/x.ts'])
})

/** 有意不从 helper 导入：C4 拿它作独立的判据，helper 收窄扩展名时（漏掉 `.tsx`、`.mjs`）才会被 C4 抓到。 */
const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/

/** 不带 GIT_* 环境：rebase --exec 与 hook 场景会泄漏 GIT_DIR / GIT_INDEX_FILE，指向别的仓库。 */
function gitIn(root) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
  return (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

/**
 * root 是 git 检出的顶层时返回 `{ tracked, missed }`：tracked 是被跟踪的源码，missed 是其中遍历没有走到的；
 * 不在 git 检出里（例如 git archive 的导出目录），或上层 git 仓库不是 root 时返回 undefined。
 * 只数磁盘上确有的普通文件：索引可以暂时与工作树不一致（未暂存的删除与改名、sparse-checkout 的 skip-worktree），
 * 符号链接也不是遍历面（遍历只收普通文件）；这几类都不是「被 .gitignore 剪掉」。
 */
function trackedSourcesMissedByWalk(root, scopes = SCOPES) {
  const git = gitIn(root)
  let top
  try {
    top = realpathSync(git('rev-parse', '--show-toplevel').trim())
  } catch {
    return undefined
  }
  if (top !== realpathSync(root)) return undefined
  const tracked = git('ls-files', '-z', '-co', '--exclude-standard', '--', ...scopes)
    .split('\0')
    .filter((file) => SOURCE_EXTENSION.test(file))
    .filter((file) => lstatSync(path.join(root, file), { throwIfNoEntry: false })?.isFile() === true)
    .map((file) => path.relative(realpathSync.native(root), realpathSync.native(path.join(root, file))).split(path.sep).join('/'))
    .filter((file, index, all) => all.indexOf(file) === index)
  const walked = new Set(listSourceFiles(root, scopes).map(({ scope, file }) => `${scope}/${file}`))
  const symlinks = git('ls-files', '-s', '-z', '--', ...scopes).split('\0')
    .filter((entry) => entry.startsWith('120000 '))
    .map((entry) => entry.slice(entry.indexOf('\t') + 1))
    .sort()
  return { tracked, symlinks, missed: tracked.filter((file) => !walked.has(file)) }
}

/** 在 mkdtemp 里建一个真实 git 仓库（只 init 与 add，不提交、不写 config），文件含 CALL；git 不可用时返回 undefined。 */
function gitFixture(t, files) {
  const root = fixture(t, 'dist/\n', files)
  try {
    gitIn(root)('init', '-q')
  } catch {
    return undefined
  }
  return root
}

test('C4 真实检出里 Git 不忽略的 packages/、apps/ 源码全部出现在遍历结果里', (t) => {
  const result = trackedSourcesMissedByWalk(repoRoot)
  if (result === undefined) return t.skip('不在 git 检出里，或上层 git 仓库不是本仓库根（例如嵌套在别的检出里）')
  assert.ok(result.tracked.length > 0, '前置：跟踪的源码集合非空，否则这条检查空转')
  assert.deepEqual(result.symlinks, [], '扫描范围内出现符号链接时必须先明确实现安全跟随策略，不能静默收窄扫描面')
  assert.deepEqual(result.missed, [], 'Git 不忽略的源码没有出现在遍历结果里，扫描会少扫')
})

test('C5 索引与工作树暂时不一致（未暂存的删除、改名、skip-worktree）不算漏扫；force-add 进被忽略目录的文件仍然报出', (t) => {
  const root = gitFixture(t, [
    'packages/core/src/kept.ts',
    'packages/core/src/gone.ts',
    'packages/core/src/renamed-from.ts',
    'packages/core/src/sparse.ts',
    'packages/core/dist/forced.ts',
  ])
  if (root === undefined) return t.skip('git 不可用')
  const git = gitIn(root)
  git('add', '-f', '--', '.gitignore', 'packages')
  git('update-index', '--skip-worktree', 'packages/core/src/sparse.ts')
  rmSync(path.join(root, 'packages/core/src/gone.ts')) // 未暂存的删除
  rmSync(path.join(root, 'packages/core/src/sparse.ts')) // sparse-checkout 不物化的条目
  renameSync(path.join(root, 'packages/core/src/renamed-from.ts'), path.join(root, 'packages/core/src/renamed-to.ts')) // IDE 改名，未暂存
  const result = trackedSourcesMissedByWalk(root, SCOPES.slice(0, 1))
  assert.deepEqual(result.missed, ['packages/core/dist/forced.ts'], '只有 Git 不忽略但 helper 漏掉的源码才报')
  assert.deepEqual([...result.tracked].sort(), [
    'packages/core/dist/forced.ts', 'packages/core/src/kept.ts', 'packages/core/src/renamed-to.ts',
  ], '应包含 Git 认为不忽略且磁盘上存在的源码，包括未暂存改名后的名字')
})

test('C5b Git oracle 暴露扫描范围内的被跟踪符号链接，避免静默排除', (t) => {
  const root = gitFixture(t, ['packages/core/src/writer.ts'])
  if (root === undefined) return t.skip('git 不可用')
  try {
    symlinkSync('writer.ts', path.join(root, 'packages/core/src/alias.ts'), 'file')
  } catch (error) {
    return t.skip(`无法创建符号链接（${error.code}）`)
  }
  gitIn(root)('add', '--', '.gitignore', 'packages')
  assert.equal(lstatSync(path.join(root, 'packages/core/src/alias.ts')).isSymbolicLink(), true, '前置：夹具里确有符号链接')
  const result = trackedSourcesMissedByWalk(root, SCOPES.slice(0, 1))
  assert.deepEqual(result.symlinks, ['packages/core/src/alias.ts'])
})

test('C5c case-only rename on a case-insensitive filesystem compares physical names', (t) => {
  const root = gitFixture(t, ['packages/core/src/Foo.ts'])
  if (root === undefined) return t.skip('git 不可用')
  const git = gitIn(root)
  git('add', '--', '.gitignore', 'packages')
  if (!existsSync(path.join(root, 'packages/core/src/foo.ts'))) return t.skip('文件系统区分大小写')
  renameSync(path.join(root, 'packages/core/src/Foo.ts'), path.join(root, 'packages/core/src/foo.ts'))
  const result = trackedSourcesMissedByWalk(root, SCOPES.slice(0, 1))
  assert.deepEqual(result.missed, [])
  assert.deepEqual(result.tracked, ['packages/core/src/foo.ts'])
})

test('C5d Git oracle includes files re-included by nested .gitignore and core.ignorecase rules', (t) => {
  const root = fixture(t, 'dist/\n', ['packages/p/dist/nested.ts', 'packages/q/dist/case.ts'])
  try { gitIn(root)('init', '-q') } catch { return t.skip('git 不可用') }
  const git = gitIn(root)
  writeFileSync(path.join(root, 'packages/p/.gitignore'), '!dist/\n')
  writeFileSync(path.join(root, '.gitignore'), 'dist/\n!DIST/\n')
  git('config', 'core.ignorecase', 'true')
  assert.throws(() => git('check-ignore', '-q', '--', 'packages/p/dist/nested.ts'), { status: 1 })
  assert.throws(() => git('check-ignore', '-q', '--', 'packages/q/dist/case.ts'), { status: 1 })
  const result = trackedSourcesMissedByWalk(root, SCOPES.slice(0, 1))
  assert.deepEqual(result.missed, ['packages/p/dist/nested.ts', 'packages/q/dist/case.ts'])
})
