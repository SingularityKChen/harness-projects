/**
 * 人工执行的端到端集成用例（issue #139 / ExecPlan `2026-09-24-human-execution-provider` 的 Batch 2）。
 *
 * 组装是真实的：`@harness-projects/provider-development-local-git` 在 `mkdtemp` 生成的临时仓库上跑
 * 真实 git argv，`@harness-projects/provider-execution-human` 提供人工执行，Storage 用离线替身。
 * 不触网、不需要凭据，也不依赖本机既有仓库。
 *
 * 看护的不变量（`tests/README.md` §2.1 / §2.5、`docs/product/vertical-path.md` §2 步骤 7→8）：
 *
 * 1. 开始工作之后本机真的出现工作树与分支，二者指向同一工作项；
 * 2. 执行会话起得来时运行是**人工标记**：Storage 里是 `running`，`runExternalId` 是人工 provider
 *    发出的 `manual-run:` 引用，且 Storage 里只有 core 的 `recordRun` 写过的那一条运行；
 * 3. 执行 provider 起不来时上下文保留为 `ready`、工作树与分支仍在磁盘上、结果是 `manual_fallback`；
 *    这条证明的是"**绑定的执行 provider** 起不来时 core 保留工作树与分支"，**不是**"harness 起不来之后
 *    降级给人工"——那需要 core 的降级触发点咨询执行 provider，属 issue #171；
 * 4. 用同一份 Storage 重建 core（并换一个人工 provider 实例）后，**执行上下文与运行记录**逐字段不变；
 *    拿着**重启前取得的那个引用**，新实例也能读回同一个标记（provider 是 ref 的纯函数）。
 *
 * **第 4 条的范围要说准**：它证明的不是"重启后能从 Storage 重建人工标记"。`ExecutionRunRecord` 没有
 * `externalId`、`ExecutionContextView` 没有 `runExternalId`、`existingResult` 硬编码 `undefined`，
 * 所以**引用本身不在 Storage 契约里**——重启后能读回它，靠的是调用方在重启前把那个字符串存了下来。
 * 用例里显式断言这次丢失（见"重启"那条的 `replayed.runExternalId === undefined`）。补上这一步要改
 * `packages/capabilities` 的 Storage 契约与 `packages/storage/sqlite` 的迁移，属跨层变更，见 **#172**。
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { ExecutionContextStatus, ExecutionRunStatus, WriteState, newWorkspaceId } from '@harness-projects/domain'
import { composeCore, runIdFor } from '@harness-projects/core'
import { createLocalGitDevelopmentProvider } from '@harness-projects/provider-development-local-git'
import { createHumanExecutionProvider } from '@harness-projects/provider-execution-human'
import { createFakeStorage, exportFakeStorageState } from '@harness-projects/provider-fake'

const execFileAsync = promisify(execFile)
const DEVELOPMENT_BINDING = 'binding-local-git-development'
const HUMAN_BINDING = 'binding-human-execution'
const REPOSITORY_ID = 'repo-alpha'
const WORKSPACE_NAME = 'MVP-1 人工执行'
/** 人工 provider 的时钟固定：标记里的起始时刻因此可逐字断言，与真实墙钟无关。 */
const HUMAN_NOW = '2026-09-24T00:00:00.000Z'

const git = async (args, cwd) => (await execFileAsync('git', args, { cwd })).stdout

/** 临时仓库：允许根是它的父目录，测试自己先 realpath，避免系统临时目录的符号链接造成假失败。 */
async function makeRepository(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'human-execution-')))
  const repositoryPath = path.join(root, 'repo')
  await mkdir(repositoryPath)
  const run = (args) => git(args, repositoryPath)
  await run(['init', '-b', 'main'])
  await run(['config', 'user.email', 'human-execution@example.invalid'])
  await run(['config', 'user.name', 'Human Execution Test'])
  await writeFile(path.join(repositoryPath, 'README.md'), '# fixture\n')
  await run(['add', 'README.md'])
  await run(['-c', 'commit.gpgsign=false', 'commit', '-m', '初始提交'])
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, repositoryPath, run }
}

const worktreePaths = async (repositoryPath) => (await git(['worktree', 'list', '--porcelain'], repositoryPath))
  .split('\n')
  .filter((line) => line.startsWith('worktree '))
  .map((line) => line.slice('worktree '.length).trim())

const branchesMatching = async (repositoryPath, pattern) => (await git(
  ['for-each-ref', '--format=%(refname:short)', pattern], repositoryPath,
)).split('\n').map((line) => line.trim()).filter((line) => line !== '')

const worktreePathOf = (repository, workItemId) => path.join(repository.repositoryPath, '.worktrees', workItemId)

/** 句柄可能相对、可能绝对：比较前统一规范化。断言的是「指向同一份工作树」这个不变量本身，**不是**
 *  「两个字符串必然不同」——后者只在调用方传相对路径时成立，而且会把 #206 的缺陷钉成期望值，
 *  在 #206 收口时让本文件变红（#206 验收 3、栈级第五轮对 #209 的同一处置）。 */
const handlePath = (repository, handle) => realpath(path.resolve(repository.repositoryPath, handle))

/** 人工 provider 发出的运行引用：`(binding, objectKind, externalId)` 三元组，与 core 无关。 */
const runRefOf = (externalId) => ({ bindingId: HUMAN_BINDING, objectKind: 'execution_run', externalId, url: undefined })

/** 组装：真实本地 Git + 人工执行 + 离线 Storage；`workspaceId` 与 `clock` 可复用，用来模拟重启与租约。 */
async function composeManualCore({ repository, storage, workspaceId = newWorkspaceId(), clock, humanFaults, fallbackHuman = false }) {
  const development = createLocalGitDevelopmentProvider({
    bindingId: DEVELOPMENT_BINDING,
    repository: { externalId: REPOSITORY_ID, path: repository.repositoryPath },
    allowedRoot: repository.root,
  })
  const execution = createHumanExecutionProvider({
    bindingId: HUMAN_BINDING, clock: () => HUMAN_NOW, faults: humanFaults,
  })
  const executionFallback = fallbackHuman ? createHumanExecutionProvider({ bindingId: `${HUMAN_BINDING}-fallback`, clock: () => HUMAN_NOW, fallback: true }) : undefined
  const core = await composeCore({
    workspace: { id: workspaceId, name: WORKSPACE_NAME },
    providers: { development, execution, executionFallback },
    storage,
    ...(clock === undefined ? {} : { clock }),
  })
  return { core, development, execution, storage, workspaceId }
}

const startRequest = (workItemId, idempotencyKey) => ({
  workItemId, repositoryId: REPOSITORY_ID, actor: { kind: 'human' }, idempotencyKey,
  worktreePath: `.worktrees/${workItemId}`,
})

test('开始工作：工作树与分支真的落盘，运行是人工标记，执行上下文 ready（#139）', async (t) => {
  const repository = await makeRepository(t)
  const storage = createFakeStorage()
  const { core, execution } = await composeManualCore({ repository, storage })
  const workItemId = 'wi-manual-1'
  const result = await core.commands.startWork(startRequest(workItemId, 'manual-1'))

  assert.equal(result.status, ExecutionContextStatus.Ready)
  assert.equal(result.writeState, WriteState.Saved)
  assert.equal(result.confirmed, true, 'git 写入已拿到 provider ack，此时 Saved 才被允许')
  assert.equal(result.error, undefined)
  assert.equal(result.fallback, undefined, '人工执行起得来时不是降级路径')
  assert.equal(result.branchExternalId, `work/${workItemId}`)

  // 磁盘证据：Git 真的登记了这份工作树，里面有仓库内容，分支真的存在且只有一个。
  const expectedWorktree = worktreePathOf(repository, workItemId)
  assert.equal(result.worktreeExternalId, expectedWorktree, '首次创建回填 provider 规范化后的绝对路径')
  assert.ok(
    (await worktreePaths(repository.repositoryPath)).includes(expectedWorktree),
    '工作树必须真的落在磁盘上并被 Git 登记',
  )
  assert.equal((await stat(path.join(expectedWorktree, 'README.md'))).isFile(), true, '工作树里必须能看到仓库内容')
  assert.deepEqual(
    await branchesMatching(repository.repositoryPath, `refs/heads/work/${workItemId}`),
    [`work/${workItemId}`],
    '工作分支必须真的存在，且只有一个',
  )

  // 人工标记：Storage 里是 running；run 引用由人工 provider 发出，且能原样读回。
  const view = await core.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY_ID })
  assert.equal(view.status, ExecutionContextStatus.Ready)
  assert.equal(view.fallback, undefined)
  assert.ok(view.runId !== undefined, '上下文必须关联到一条运行')
  const run = await storage.getExecutionRun(view.runId)
  assert.equal(run.status, ExecutionRunStatus.Running, '人工执行是一次处于 running 的运行，不是终态')
  assert.match(result.runExternalId, /^manual-run:/, '运行引用必须是人工 provider 发出的形态')
  const read = await execution.getRun(runRefOf(result.runExternalId))
  assert.equal(read.ok, true)
  assert.equal(read.value.status, ExecutionRunStatus.Running)
  assert.equal(read.value.startedAt, HUMAN_NOW)
  assert.equal(read.value.finishedAt, undefined)

  // provider 不写 Storage：Storage 里只有 core 的 recordRun 写过的那一条运行。
  const runs = exportFakeStorageState(storage).runs
  assert.equal(runs.length, 1, 'run 的唯一写入入口是 core 的 recordRun')
  assert.equal(runs[0].id, runIdFor(result.executionContextId))
})

test('执行 provider 起不来：上下文与工作树/分支保留，core 走 manual_fallback', async (t) => {
  const repository = await makeRepository(t)
  const storage = createFakeStorage()
  const { core } = await composeManualCore({ repository, storage, humanFaults: { startUnavailable: true } })
  const workItemId = 'wi-manual-degraded'
  const result = await core.commands.startWork(startRequest(workItemId, 'manual-degraded-1'))

  assert.equal(result.fallback, 'manual_fallback')
  assert.equal(result.degraded, true)
  assert.equal(result.confirmed, true, 'git 写入已拿到 provider ack，此时 Saved 才被允许')
  assert.equal(result.status, ExecutionContextStatus.Ready, '上下文保留为 ready：环境确实就绪，失败的是这次运行')
  assert.equal(result.runExternalId, undefined, '启动失败不得声称有运行')

  const expectedWorktree = worktreePathOf(repository, workItemId)
  assert.equal(result.worktreeExternalId, expectedWorktree)
  assert.ok(
    (await worktreePaths(repository.repositoryPath)).includes(expectedWorktree),
    '降级不得回收工作树：它必须仍在磁盘上',
  )
  assert.equal((await stat(path.join(expectedWorktree, 'README.md'))).isFile(), true)
  assert.deepEqual(
    await branchesMatching(repository.repositoryPath, `refs/heads/work/${workItemId}`),
    [`work/${workItemId}`],
    '降级不得回收分支',
  )

  const view = await core.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY_ID })
  assert.equal(view.status, ExecutionContextStatus.Ready)
  assert.equal(view.fallback, 'manual_fallback', '重查后仍要看到降级')
  const run = await storage.getExecutionRun(view.runId)
  assert.equal(run.status, ExecutionRunStatus.Failed, '降级的事实落在那条 failed 运行上')
})

test('主执行 provider 起不来且 fallback provider 可用时，人工运行得到 running 与可恢复引用', async (t) => {
  const repository = await makeRepository(t)
  const storage = createFakeStorage()
  const { core } = await composeManualCore({ repository, storage, humanFaults: { startUnavailable: true }, fallbackHuman: true })
  const result = await core.commands.startWork(startRequest('wi-manual-fallback', 'manual-fallback-1'))
  assert.equal(result.fallback, 'manual_fallback')
  assert.match(result.runExternalId, /^manual-run:/)
  const view = await core.queries.getExecutionContext({ workItemId: 'wi-manual-fallback', repositoryId: REPOSITORY_ID })
  assert.equal(view.runExternalId, result.runExternalId)
  assert.equal((await storage.getExecutionRun(view.runId)).status, ExecutionRunStatus.Running)
})

test('重启：同一份 Storage 上重建 core 后执行上下文、运行记录与人工引用逐字段不变', async (t) => {
  const repository = await makeRepository(t)
  const storage = createFakeStorage()
  const first = await composeManualCore({ repository, storage })
  const workItemId = 'wi-manual-restart'
  const started = await first.core.commands.startWork(startRequest(workItemId, 'manual-restart-1'))
  const before = await first.core.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY_ID })
  const beforeRun = await storage.getExecutionRun(before.runId)

  // 重建：同一份 Storage 内容 + 同一个工作区 id + 新的人工 provider 实例（进程内存为空）。
  const restored = createFakeStorage(exportFakeStorageState(storage))
  const second = await composeManualCore({ repository, storage: restored, workspaceId: first.workspaceId })
  const after = await second.core.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY_ID })
  assert.deepEqual(after, before, '重启后执行上下文必须逐字段不变')
  const afterRun = await restored.getExecutionRun(after.runId)
  assert.deepEqual(afterRun, beforeRun, '重启后运行记录必须逐字段不变')
  assert.equal(afterRun.status, ExecutionRunStatus.Running)

  // Storage 现在保存 provider ref，重启后的 core 必须带回同一个可路由身份。
  const replayed = await second.core.commands.startWork(startRequest(workItemId, 'manual-restart-1'))
  assert.equal(replayed.runExternalId, started.runExternalId, '重启后 core 必须从 Storage 带回人工标记的引用')
  assert.equal(after.runExternalId, started.runExternalId)

  // 拿着**重启前取得的那个引用**，新实例仍能读回同一个标记：provider 是 ref 的纯函数，不靠**实例**内存。
  // "没有模块级可变状态"这半边不在这里证明——契约层的种子运行用例读一个本进程从未启动过的运行，由它兜住。
  const read = await second.execution.getRun(runRefOf(started.runExternalId))
  assert.equal(read.ok, true)
  assert.equal(read.value.ref.externalId, started.runExternalId)
  assert.equal(read.value.status, ExecutionRunStatus.Running)
  assert.equal(read.value.startedAt, HUMAN_NOW)

  // 重启不得重复 provision：工作树与分支仍各只有一份。
  const expectedWorktree = worktreePathOf(repository, workItemId)
  assert.equal(
    (await worktreePaths(repository.repositoryPath)).filter((item) => item === expectedWorktree).length,
    1,
    '重启后不得出现第二份工作树',
  )
  assert.deepEqual(
    await branchesMatching(repository.repositoryPath, `refs/heads/work/${workItemId}`),
    [`work/${workItemId}`],
    '重启后不得出现第二个分支',
  )
})

/**
 * 接管重试（租约过期后 resume）是 core 的 conflict 复用路径唯一能从 `startWork` 走到的入口。
 * 断言的是**不变量**：复用路径与创建路径报出的句柄规范化后指向**同一份工作树**，磁盘上只有那一份。
 * 不断言「两个字符串必然不同」——那只在调用方传相对路径时成立，且会把 core 侧的句柄缺口（#206）钉成
 * 期望值，让 #206 收口时本用例变红（#206 验收 3、#209 栈级第五轮 P2 的同一处置）。
 */
test('接管重试：复用路径与创建路径报出的句柄指向同一份工作树，磁盘上只有一份', async (t) => {
  const repository = await makeRepository(t)
  const storage = createFakeStorage()
  let now = Date.parse(HUMAN_NOW)
  const clock = () => new Date(now).toISOString()
  const { core, development } = await composeManualCore({ repository, storage, clock })
  const workItemId = 'wi-manual-resume'
  const request = startRequest(workItemId, 'manual-resume-1')

  // 注入中断：工作树已经真的创建，但这次 startWork 在保存上下文之前失败，上下文留在 provisioning。
  const original = development.createWorktree.bind(development)
  let interrupt = true
  development.createWorktree = async (input) => {
    const created = await original(input)
    if (interrupt) {
      interrupt = false
      throw new Error('injected interruption after worktree created')
    }
    return created
  }
  await assert.rejects(() => core.commands.startWork(request))
  const expectedWorktree = worktreePathOf(repository, workItemId)
  assert.ok(
    (await worktreePaths(repository.repositoryPath)).includes(expectedWorktree),
    '中断发生在工作树创建之后：磁盘上已经有一份',
  )

  now += 31_000 // 租约过期后才允许接管
  const resumed = await core.commands.startWork({ ...request, idempotencyKey: 'manual-resume-2' })
  assert.equal(resumed.writeState, WriteState.Saved)
  assert.equal(resumed.status, ExecutionContextStatus.Ready)
  assert.equal(resumed.branchExternalId, `work/${workItemId}`)
  assert.equal(
    await handlePath(repository, resumed.worktreeExternalId), expectedWorktree,
    '复用路径报出的句柄必须指向创建路径那一份工作树（字符串形态可以不同，见 #206）',
  )
  // 断言**总数**而不是「过滤出目标路径后的结果」：第二份工作树只要落在别的路径上，就会在比较之前被
  // filter 丢掉，断言观察不到它（#209 栈级第五轮 P1 的同一处置）。
  assert.deepEqual(
    await worktreePaths(repository.repositoryPath), [repository.repositoryPath, expectedWorktree],
    '接管不得产生第二份工作树（主检出 + 1，按总数断言）',
  )
  assert.deepEqual(
    await branchesMatching(repository.repositoryPath, `refs/heads/work/${workItemId}`),
    [`work/${workItemId}`],
    '接管不得产生第二个分支',
  )
})
