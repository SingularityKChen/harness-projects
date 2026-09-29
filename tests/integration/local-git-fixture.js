/** 本地 Git provider 的集成测试夹具：临时仓库、provider 构造与 runner 注入。只在被导入时定义函数，不建
 * 仓库、不注册用例——`node --test tests/integration` 会加载目录下的文件，模块级副作用会变成难以定位的
 * 额外工作。provider 自身行为见 development-local-git.test.js，core 供应序列见
 * local-git-core-provisioning.test.js。 */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
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

/** 可推进的时钟。恢复用例先在冻结时刻写下 `provisioning` 记录，再 `advance(LEASE_EXPIRED_MS)` 越过租约，
 *  才会走「接管」而不是被 `in-flight` 挡住；`coreContextFor` 的 `clock` 选项吃它的 `clock`。 */
export function controllableClock(start = FROZEN_NOW) {
  let current = Date.parse(start)
  return { clock: () => new Date(current).toISOString(), advance: (ms) => { current += ms } }
}

/** 租约 30 秒（`packages/core/src/start-work.ts` 的 `PROVISIONING_LEASE_MS`）再加 1 秒：`leaseExpired` 用
 *  `>=` 比较，多 1 秒让用例不依赖边界相等。改租约必须同步改这里。 */
export const LEASE_EXPIRED_MS = 31_000

/** 组装一个只接本 provider 的 core 上下文：走 core 自己的 `createContext`（先 putWorkspace 再登记
 *  binding），不在这里复制组装顺序——复制会与 core 的装配契约漂移（第四轮 P2：与 SQLite 栈合在一起
 *  时会因为 binding 先于 workspace 落库而变红）。默认时钟冻结在 `FROZEN_NOW`，理由见该常量。
 *  第三参让重启类用例复用同一 storage 与 workspace（模拟「换了一套能力重新组装」），并注入可推进的时钟；
 *  三项缺省时与只传前两参完全相同：新建 storage、新 workspace、冻结时钟。 */
export async function coreContextFor(fixture, providers = { development: providerFor(fixture) }, { storage, workspaceId, clock } = {}) {
  const context = await createContext({
    storage: storage ?? createFakeStorage(),
    workspace: { name: '本地 Git provider 集成测试', ...(workspaceId === undefined ? {} : { id: workspaceId }) },
    providers, policy: {}, clock: clock ?? (() => FROZEN_NOW), ids: defaultIdFactory,
  })
  assert.ok(context !== undefined, 'core 必须能从注入的 storage 组装出上下文')
  return { storage: context.storage, workspaceId: context.workspaceId, context }
}

/** 包一层 provider：`createWorktree` 第一次调用抛出，之后照常。分支步已经真实落地，工作树步「进程死掉」，
 *  执行上下文记录因此停在 `provisioning` 且已带 `branchExternalId`。用 Proxy 并把方法绑回原 provider，
 *  避免包装对象成为 `this` 而碰不到 provider 的私有状态。 */
export function interruptAfterBranchStep(provider) {
  let interrupted = false
  return new Proxy(provider, {
    get(target, key) {
      const value = Reflect.get(target, key, target)
      if (key !== 'createWorktree') return typeof value === 'function' ? value.bind(target) : value
      return async (...args) => {
        if (!interrupted) {
          interrupted = true
          throw new Error('测试注入的中断：分支步之后进程退出')
        }
        return value.apply(target, args)
      }
    },
  })
}

/** 一次 `git update-ref --stdin` 建 `count` 个诱饵分支 `a-000…`，字典序排在 `work/` 之前，指向夹具的初始提交。
 *  本地 Git 的 `listBranches` 按名字排序分页，诱饵因此把目标挤出第一页；一次事务建完，不触发钩子。 */
export async function addDecoyBranches(fixture, count) {
  const lines = Array.from({ length: count }, (_, index) => `create refs/heads/a-${String(index).padStart(3, '0')} ${fixture.headCommit}\n`)
  await new Promise((resolve, reject) => {
    const child = spawn('git', ['update-ref', '--stdin'], { cwd: fixture.repositoryPath })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git update-ref --stdin 退出 ${code}：${stderr}`))))
    child.stdin.end(lines.join(''))
  })
}

/** 让 `main` 前进一个空提交并返回新的 `main` 头。关闭 gpgsign：不依赖全局 git 配置。 */
export async function advanceMain(fixture) {
  await fixture.run(['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', '基线前进'])
  return (await fixture.run(['rev-parse', 'main'])).trim()
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
