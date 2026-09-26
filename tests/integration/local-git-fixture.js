/** 本地 Git provider 的集成测试夹具：临时仓库、provider 构造与 runner 注入。只在被导入时定义函数，不建
 * 仓库、不注册用例——`node --test tests/integration` 会加载目录下的文件，模块级副作用会变成难以定位的
 * 额外工作。provider 自身行为见 development-local-git.test.js，core 供应序列见
 * local-git-core-provisioning.test.js。 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { createContext, defaultIdFactory } from '@harness-projects/core'
import { createFakeStorage } from '@harness-projects/provider-fake'
import { createLocalGitDevelopmentProvider, defaultGitRunner } from '@harness-projects/provider-development-local-git'

const execFileAsync = promisify(execFile)
export const BINDING = 'binding-local-git-development'
export const REPOSITORY_ID = 'repo-alpha'
export const repositoryRef = { bindingId: BINDING, objectKind: 'repository', externalId: REPOSITORY_ID, url: undefined }

export const git = async (args, cwd) => {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

/** 临时仓库：允许根是它的父目录，测试自己先 realpath，避免系统临时目录的符号链接造成假失败。
 *  `initialBranch` 可换：评审 P1 的复现起点正是「默认配置、`git init -b master/trunk` 的新仓库」。 */
export async function makeFixture(registerCleanup, initialBranch = 'main') {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-git-provider-')))
  const repositoryPath = path.join(root, 'repo')
  await mkdir(repositoryPath)
  const run = (args) => git(args, repositoryPath)
  await run(['init', '-b', initialBranch])
  await run(['config', 'user.email', 'local-git-provider@example.invalid'])
  await run(['config', 'user.name', 'Local Git Provider Test'])
  await writeFile(path.join(repositoryPath, 'README.md'), '# fixture\n')
  await run(['add', 'README.md'])
  await run(['-c', 'commit.gpgsign=false', 'commit', '-m', '初始提交'])
  const headCommit = (await run(['rev-parse', 'HEAD'])).trim()
  registerCleanup(() => rm(root, { recursive: true, force: true }))
  return { root, repositoryPath, headCommit, run }
}

export const fixtureFor = (t, initialBranch) => makeFixture((cleanup) => t.after(cleanup), initialBranch)

export const providerFor = (fixture, options = {}) => createLocalGitDevelopmentProvider({
  bindingId: BINDING, repository: { externalId: REPOSITORY_ID, path: fixture.repositoryPath }, allowedRoot: fixture.root, ...options,
})

/** `coreContextFor` 注入的冻结时钟。**恢复用例依赖它**：`PROVISIONING_LEASE_MS` 是 30 秒，只有写入的
 *  `provisioningStartedAt` 比这个时刻早 30 秒以上，`claimContext` 才会走 `resume` 分支而不是被 `in-flight`
 *  挡住。改这个值必须同时改 `local-git-core-provisioning.test.js` 的「恢复供应」那处写入（第五轮评审 P3：
 *  原先这个大小关系没有任何一处写明，改动任一日期都会让恢复用例静默退化）。 */
export const FROZEN_NOW = '2026-09-24T00:00:00Z'

/** 组装一个只接本 provider 的 core 上下文：走 core 自己的 `createContext`（先 putWorkspace 再登记
 *  binding），不在这里复制组装顺序——复制会与 core 的装配契约漂移（第四轮 P2：与 SQLite 栈合在一起
 *  时会因为 binding 先于 workspace 落库而变红）。时钟冻结在 `FROZEN_NOW`，理由见该常量。 */
export async function coreContextFor(fixture, providers = { development: providerFor(fixture) }) {
  const context = await createContext({
    storage: createFakeStorage(), workspace: { name: '本地 Git provider 集成测试' },
    providers, policy: {}, clock: () => FROZEN_NOW, ids: defaultIdFactory,
  })
  assert.ok(context !== undefined, 'core 必须能从注入的 storage 组装出上下文')
  return { storage: context.storage, workspaceId: context.workspaceId, context }
}

/** 记录每一次 Git 调用的 argv，然后交给真实 runner：零调用断言因此是"命令没被拼出来"，不是"命令失败了"。 */
export function recordingRunner() {
  const calls = []
  return {
    calls,
    runGit: async (args) => {
      calls.push([...args])
      return defaultGitRunner(args)
    },
  }
}

/** 套件的故障场景 → runner：权限与离线整体失败；"创建结果不确定"只让写命令失败，读命令照常。 */
export function faultRunner(faults = {}) {
  const failing = (stderr) => async () => ({ code: 128, stdout: '', stderr })
  if (faults.permissionDenied) return failing('fatal: Permission denied')
  if (faults.offline) return failing('fatal: unable to access: Resource temporarily unavailable')
  if (!faults.ambiguousCreate) return defaultGitRunner
  return async (args) => (args.some((arg) => ['add', 'branch'].includes(arg))
    ? { code: 128, stdout: '', stderr: 'fatal: unable to create the requested object' }
    : defaultGitRunner(args))
}

export const worktreePaths = async (fixture) => (await git(['worktree', 'list', '--porcelain'], fixture.repositoryPath))
  .split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length))
