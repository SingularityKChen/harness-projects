/**
 * 本地 Git provider 的源码约束（结构类约束用契约测试固定，tests/README.md §3）：`AGENTS.md` §7 要求
 * 本地 Git 只经 argv / library API 调用，不拼 shell 字符串。判定用**正向规则**而不是禁用词表——词表只
 * 认拼写，别名导入 / `require` / 括号访问 / `shell: <非 true>` 都能绕过（第四轮 P3 实测 7 种写法全部
 * `pass 1 / fail 0`）；正向规则只限定两件事：谁可以引用 `child_process`，以及那个文件长什么样。
 */
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const sourceDir = path.join(repoRoot, 'packages', 'providers', 'development-local-git', 'src')
const RUNNER = 'packages/providers/development-local-git/src/git-runner.ts'

/** 包内全部源码文件：扩展名不设限——只收 `.ts` 会让 `foo.mts` 成为扫描盲区（第四轮 P3 实测）。 */
async function sourceFiles(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await sourceFiles(full)))
    else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(entry.name)) found.push(full)
  }
  return found.sort()
}

test('本地 Git provider：只有 runner 文件可以引用 child_process，且它只经 execFile 收 argv 数组', async () => {
  const files = await sourceFiles(sourceDir)
  assert.ok(files.length > 0, '源码目录必须存在')
  const touching = []
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    // 任何形态的子进程引用都算命中：静态 import、dynamic import()、require()、裸说明符或 node: 前缀。
    // 这里比的是"有没有引用"，所以允许集合是白名单，而不是"禁用了哪几个名字"。
    if (source.includes('child_process')) touching.push(path.relative(repoRoot, file))
  }
  assert.deepEqual(touching, [RUNNER], 'child_process 只允许出现在唯一的 runner 文件里，调用点不扩散')
  const runner = await readFile(path.join(sourceDir, 'git-runner.ts'), 'utf8')
  assert.equal([...runner.matchAll(/from\s*'node:child_process'/g)].length, 1, 'runner 只能有一条 child_process 导入')
  const importMatch = /import\s*\{([^}]*)\}\s*from\s*'node:child_process'/.exec(runner)
  assert.deepEqual(
    importMatch?.[1].split(',').map((name) => name.trim()).filter((name) => name !== ''), ['execFile'],
    'runner 只允许导入 execFile：exec / execSync / spawn* / fork 都是"命令字符串 + 选项"形态',
  )
  // 禁的是**选项键**而不是某个取值：`shell: true` 只是它的一种写法，`shell: '/bin/sh'` 同样会走 shell。
  assert.equal(/\bshell\s*:/.test(runner), false, 'runner 不得传 shell 选项：execFile 必须直接收 argv 数组')
  assert.match(runner, /execFile\('git',\s*\[\.\.\.args\]/, 'execFile 必须收到 argv 数组，而不是命令字符串')
})
