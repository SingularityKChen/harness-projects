/**
 * 人工执行的端到端集成用例（issue #139 / #171 / #172，ExecPlan `2026-09-24-human-execution-provider`）。
 *
 * 真实本地 Git（`mkdtemp` 临时仓库）+ 人工执行 + 离线 Storage，不触网、不需要凭据。看护：工作树与分支落盘、人工
 * 运行 `running` 且引用由签发者签出；执行起不来时上下文保留、fallback 只在主执行确定起不来时承接并受写门约束；
 * 重启后上下文、运行记录、引用与交接快照不变；取消按运行身份收敛，签发者配置变了 fail closed（ADR-0008）。
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { CapabilityKey } from '@harness-projects/capabilities'
import { ExecutionContextStatus, ExecutionRunStatus, WriteState, newWorkspaceId } from '@harness-projects/domain'
import { composeCore, runIdFor } from '@harness-projects/core'
import { createLocalGitDevelopmentProvider } from '@harness-projects/provider-development-local-git'
import { createHumanExecutionProvider } from '@harness-projects/provider-execution-human'
import { createFakeExecutionProvider, createFakeStorage, exportFakeStorageState } from '@harness-projects/provider-fake'

const execFileAsync = promisify(execFile)
const DEVELOPMENT_BINDING = 'binding-local-git-development'
const HUMAN_BINDING = 'binding-human-execution'
/** 签发密钥是宿主从 secret 服务解析的值；测试用一个固定值，只在内存里。 */
const HUMAN_ISSUER_KEY = 'issuer-key-for-human-execution-integration'
const REPOSITORY_ID = 'repo-alpha'
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
  return { root, repositoryPath }
}

const worktreePaths = async (repositoryPath) => (await git(['worktree', 'list', '--porcelain'], repositoryPath))
  .split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length).trim())
const worktreePathOf = (repository, workItemId) => path.join(repository.repositoryPath, '.worktrees', workItemId)

/** 磁盘证据：按**总数**只有主检出 + 这一份工作树（先过滤再比较会漏掉落在别处的第二份）、有内容、分支唯一。 */
async function assertOnDisk(repository, workItemId, label) {
  const worktree = worktreePathOf(repository, workItemId)
  assert.deepEqual(await worktreePaths(repository.repositoryPath), [repository.repositoryPath, worktree], `${label}：主检出 + 1 份工作树`)
  assert.equal((await stat(path.join(worktree, 'README.md'))).isFile(), true, `${label}：工作树里有仓库内容`)
  const branches = await git(['for-each-ref', '--format=%(refname:short)', `refs/heads/work/${workItemId}`], repository.repositoryPath)
  assert.deepEqual(branches.split('\n').filter((line) => line.trim() !== ''), [`work/${workItemId}`], `${label}：工作分支存在且只有一个`)
}

/** 组装：真实本地 Git + 人工执行 + 离线 Storage；`workspaceId`、`clock` 与签发者配置可复用，用来模拟重启与租约。 */
async function composeManualCore({
  repository, storage, workspaceId = newWorkspaceId(), clock, humanFaults, fallbackHuman = false,
  humanBinding = HUMAN_BINDING, issuerKey = HUMAN_ISSUER_KEY, humanClock = () => HUMAN_NOW, primary, policy,
}) {
  const development = createLocalGitDevelopmentProvider({
    bindingId: DEVELOPMENT_BINDING,
    repository: { externalId: REPOSITORY_ID, path: repository.repositoryPath },
    allowedRoot: repository.root,
  })
  const human = (bindingId, options) => createHumanExecutionProvider({ bindingId, issuerKey, clock: humanClock, ...options })
  const execution = primary === false ? undefined : primary ?? human(humanBinding, { faults: humanFaults })
  const executionFallback = fallbackHuman ? human(`${humanBinding}-fallback`, { fallback: true }) : undefined
  const core = await composeCore({
    workspace: { id: workspaceId, name: 'MVP-1 人工执行' },
    providers: { development, execution, executionFallback },
    storage, policy,
    ...(clock === undefined ? {} : { clock }),
  })
  return { core, development, execution, executionFallback, storage, workspaceId }
}

/** 重启：同一份 Storage 内容 + 同一个工作区 id + 新的 provider 实例（进程内存为空）。 */
const restart = (repository, storage, first, options = {}) =>
  composeManualCore({ repository, storage: createFakeStorage(exportFakeStorageState(storage)), workspaceId: first.workspaceId, ...options })

const startRequest = (workItemId, idempotencyKey) => ({
  workItemId, repositoryId: REPOSITORY_ID, actor: { kind: 'human' }, idempotencyKey, worktreePath: `.worktrees/${workItemId}`,
})

test('开始工作：工作树与分支真的落盘，运行是人工标记，执行上下文 ready（#139）', async (t) => {
  const repository = await makeRepository(t)
  const storage = createFakeStorage()
  const { core, execution } = await composeManualCore({ repository, storage })
  const workItemId = 'wi-manual-1'
  const result = await core.commands.startWork(startRequest(workItemId, 'manual-1'))
  // git 写入拿到 provider ack 才 Saved；人工执行起得来时不是降级；首次创建回填 provider 规范化后的绝对路径。
  assert.deepEqual([result.status, result.writeState, result.confirmed, result.error, result.fallback, result.branchExternalId, result.worktreeExternalId],
    [ExecutionContextStatus.Ready, WriteState.Saved, true, undefined, undefined, `work/${workItemId}`, worktreePathOf(repository, workItemId)])
  await assertOnDisk(repository, workItemId, '开始工作')
  const view = await core.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY_ID })
  const run = await storage.getExecutionRun(view.runId)
  assert.deepEqual([view.status, view.fallback, run.status, run.providerRef.externalId], [ExecutionContextStatus.Ready, undefined, ExecutionRunStatus.Running, result.runExternalId],
    '人工执行是一次 running 的运行，落库的引用就是人工 provider 签发的那一个')
  const read = await execution.getRun(run.providerRef)
  assert.deepEqual([read.value.status, read.value.startedAt, read.value.finishedAt], [ExecutionRunStatus.Running, HUMAN_NOW, undefined])
  // provider 不写 Storage：Storage 里只有 core 的 recordRun 写过的那一条运行。
  assert.deepEqual(exportFakeStorageState(storage).runs.map((item) => item.id), [runIdFor(result.executionContextId)])
})

test('执行起不来且没有 fallback 绑定：上下文与工作树/分支保留，运行 failed，结论 manual_fallback', async (t) => {
  const repository = await makeRepository(t)
  const storage = createFakeStorage()
  const { core } = await composeManualCore({ repository, storage, humanFaults: { startUnavailable: true } })
  const workItemId = 'wi-manual-degraded'
  const result = await core.commands.startWork(startRequest(workItemId, 'manual-degraded-1'))
  await assertOnDisk(repository, workItemId, '降级不得回收工作树与分支')
  const view = await core.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY_ID })
  // 上下文保留为 ready（失败的是这次运行）；启动失败不得声称有运行；重查后仍要看到降级。
  assert.deepEqual([result.fallback, result.degraded, result.confirmed, result.status, result.runExternalId, view.status, view.fallback, (await storage.getExecutionRun(view.runId)).status],
    ['manual_fallback', true, true, ExecutionContextStatus.Ready, undefined, ExecutionContextStatus.Ready, 'manual_fallback', ExecutionRunStatus.Failed])
})

test('主执行起不来、fallback 绑定承接：人工运行 running，重启与重放后交接快照和降级结论都不变', async (t) => {
  const repository = await makeRepository(t)
  const storage = createFakeStorage()
  const first = await composeManualCore({ repository, storage, humanFaults: { startUnavailable: true }, fallbackHuman: true })
  const workItemId = 'wi-manual-fallback'
  const result = await first.core.commands.startWork(startRequest(workItemId, 'manual-fallback-1'))
  assert.equal(result.fallback, 'manual_fallback')
  const run = await storage.getExecutionRun(runIdFor(result.executionContextId))
  assert.equal(run.status, ExecutionRunStatus.Running)
  assert.equal(run.providerRef.bindingId, `${HUMAN_BINDING}-fallback`, '落库的引用指向真正签发它的 fallback 绑定')

  // port 义务 3：一次性输入不进引用，交接事实（含"这是降级承接"）必须能从执行上下文与运行记录读到。
  const second = await restart(repository, storage, first, { fallbackHuman: true })
  const view = await second.core.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY_ID })
  assert.deepEqual(
    { workItemId: view.workItemId, repositoryId: view.repositoryId, branch: view.branchExternalId, worktree: view.worktreeExternalId, run: view.runExternalId, fallback: view.fallback },
    { workItemId, repositoryId: REPOSITORY_ID, branch: `work/${workItemId}`, worktree: worktreePathOf(repository, workItemId), run: result.runExternalId, fallback: 'manual_fallback' },
    '交接快照：工作项、仓库、分支、工作树、人工运行引用与降级结论在重启后都可读',
  )
  await assertOnDisk(repository, workItemId, '快照里的工作树与分支就是磁盘上那一份')
  const replayed = await second.core.commands.startWork(startRequest(workItemId, 'manual-fallback-1'))
  assert.deepEqual([replayed.fallback, replayed.degraded], ['manual_fallback', true], '同键重放必须报出与首次相同的降级结论')
  assert.equal((await second.executionFallback.getRun(run.providerRef)).value.status, ExecutionRunStatus.Running)
  // 接管终态上下文时已有运行：start 门关着也不得覆盖它、另起执行者，首次结果按这条记录报出引用与降级结论（第十二、十三轮）。
  await second.storage.putExecutionContext({ ...(await second.storage.getExecutionContext(view.id)), status: ExecutionContextStatus.Failed })
  const third = await restart(repository, second.storage, first, { primary: createFakeExecutionProvider({ bindingId: 'binding-fake-primary', faults: { permissionDenied: true } }), fallbackHuman: true })
  const resumed = await third.core.commands.startWork(startRequest(workItemId, 'manual-fallback-2'))
  assert.deepEqual([await third.storage.getExecutionRun(view.runId), resumed.runExternalId, resumed.fallback], [run, result.runExternalId, 'manual_fallback'])
})

test('fallback 只在主执行**确定**起不来时承接，只当 fallback、不当主执行，且受自己的写门约束', async (t) => {
  const acking = (status) => (provider) => {
    const start = provider.startRun.bind(provider)
    provider.startRun = async (input) => { const run = await start(input); return { ...run, value: { ...run.value, status } } }
  }
  const degraded = ['manual_fallback', 'manual_fallback']
  for (const [kind, faults, policy, expected, patchFallback, patchPrimary] of [
    ['主执行 start 无权限：fallback 绑定不得被当成主执行选中', { permissionDenied: true }, {}, ['running', `${HUMAN_BINDING}-fallback`, true, ...degraded]],
    ['主执行结果不确定：它可能已在跑，不得再起第二个执行者', { ambiguousCreate: true }, {}, ['failed', undefined, true, ...degraded]],
    ['fallback 被策略设为只读：写命令不得成功', { harnessFailure: true }, { [CapabilityKey.ExecutionRunFallback]: 'read_only' }, ['failed', undefined, true, ...degraded]],
    ['fallback ack 的不是 running：不得当成人工运行落库', { harnessFailure: true }, {}, ['failed', undefined, true, ...degraded], acking('succeeded')],
    ['主执行 ack 了 failed：那是运行失败，不是降级（不从 failed 反推）', {}, {}, ['failed', 'binding-fake-primary', undefined, undefined, undefined], undefined, acking('failed')],
    ['主执行 start 被策略设为只读（permission_denied）：fallback 承接', {}, { [CapabilityKey.ExecutionRunStart]: 'read_only' }, ['running', `${HUMAN_BINDING}-fallback`, true, ...degraded]],
    ['主执行自己也声明 fallback：只当主执行，承接的是真正的 fallback 绑定', () => createHumanExecutionProvider({ bindingId: 'binding-fake-primary', issuerKey: HUMAN_ISSUER_KEY, fallback: true, faults: { startUnavailable: true } }), {}, ['running', `${HUMAN_BINDING}-fallback`, true, ...degraded]],
  ]) {
    const repository = await makeRepository(t)
    const storage = createFakeStorage()
    const primary = typeof faults === 'function' ? faults() : createFakeExecutionProvider({ bindingId: 'binding-fake-primary', faults })
    const { core, executionFallback } = await composeManualCore({ repository, storage, primary, policy, fallbackHuman: true })
    patchFallback?.(executionFallback); patchPrimary?.(primary)
    const result = await core.commands.startWork(startRequest('wi-fallback-gate', 'fallback-gate-1'))
    const run = await storage.getExecutionRun(runIdFor(result.executionContextId))
    const view = await core.queries.getExecutionContext({ workItemId: 'wi-fallback-gate', repositoryId: REPOSITORY_ID })
    assert.deepEqual([run.status, run.providerRef?.bindingId, run.fallback, result.fallback, view.fallback], expected, `${kind}：运行记录、首次结论与查询面一致`)
  }
})

test('重启：同一份 Storage 上重建 core 后执行上下文、运行记录与人工引用逐字段不变', async (t) => {
  const repository = await makeRepository(t)
  const storage = createFakeStorage()
  const first = await composeManualCore({ repository, storage })
  const workItemId = 'wi-manual-restart'
  const started = await first.core.commands.startWork(startRequest(workItemId, 'manual-restart-1'))
  const before = await first.core.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY_ID })
  const beforeRun = await storage.getExecutionRun(before.runId)

  const second = await restart(repository, storage, first)
  const after = await second.core.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY_ID })
  assert.deepEqual(after, before, '重启后执行上下文必须逐字段不变')
  assert.equal(after.runExternalId, started.runExternalId, '重启后查询面从 Storage 带回人工引用')
  const replayed = await second.core.commands.startWork(startRequest(workItemId, 'manual-restart-1'))
  assert.equal(replayed.runExternalId, started.runExternalId, '重启后重放同样带回同一个引用')

  // 新实例按**落库的**引用读回同一个标记：provider 是 ref 的纯函数，不靠实例内存（模块级状态由契约层的种子用例兜住）。
  assert.deepEqual(await second.storage.getExecutionRun(after.runId), beforeRun, '重启后运行记录必须逐字段不变')
  const read = await second.execution.getRun(beforeRun.providerRef)
  assert.deepEqual([read.value.ref.externalId, read.value.status, read.value.startedAt], [started.runExternalId, ExecutionRunStatus.Running, HUMAN_NOW])
  await assertOnDisk(repository, workItemId, '重启不得重复供应')
})

/** 数一数 provider 被调了几次 cancelRun：幂等要证明的是"不再去问 provider"，不只是返回值相同。 */
function countCancels(provider, counter = { calls: 0 }) {
  const original = provider.cancelRun.bind(provider)
  provider.cancelRun = (ref) => { counter.calls += 1; return original(ref) }; return counter
}

test('取消以运行身份为准：并发取消、重复取消、重启后取消都收敛到同一个 canceled 事实', async (t) => {
  const repository = await makeRepository(t)
  const storage = createFakeStorage()
  // provider 的时钟逐次前进：两次取消各签出一个**不同的** canceled 引用，收敛与否因此可以被观察到。
  let tick = 0
  const humanClock = () => new Date(Date.parse(HUMAN_NOW) + 1000 * tick++).toISOString()
  const first = await composeManualCore({ repository, storage, humanClock })
  const calls = countCancels(first.execution)
  const scope = { workItemId: 'wi-manual-cancel', repositoryId: REPOSITORY_ID }
  const started = await first.core.commands.startWork(startRequest(scope.workItemId, 'manual-cancel-1'))

  const [canceled, racing] = await Promise.all([first.core.commands.cancelExecutionRun(scope), first.core.commands.cancelExecutionRun(scope)])
  assert.deepEqual([canceled.error, canceled.status], [undefined, ExecutionRunStatus.Canceled])
  assert.notEqual(canceled.runExternalId, started.runExternalId, '取消落库的是 provider 新签发的引用')
  assert.equal(calls.calls, 2, '两个并发取消都问过 provider，签出了两个 canceled 引用')
  assert.deepEqual(racing, canceled, '并发的第二个取消在事务里看到已替换的记录，返回同一个事实')
  const stored = await storage.getExecutionRun(runIdFor(started.executionContextId))
  assert.deepEqual([stored.status, stored.providerRef.externalId], [ExecutionRunStatus.Canceled, canceled.runExternalId], '原子替换：状态与引用一起变')
  assert.equal((await first.execution.getRun(stored.providerRef)).value.status, ExecutionRunStatus.Canceled)

  assert.deepEqual(await first.core.commands.cancelExecutionRun(scope), canceled, '已取消的运行身份原样返回已落库的事实')
  assert.equal(calls.calls, 2, '已取消的运行不再调 provider：不会再签出新的 canceled 引用')
  const second = await restart(repository, storage, first)
  const secondCalls = countCancels(second.execution)
  assert.deepEqual(await second.core.commands.cancelExecutionRun(scope), canceled, '重启后仍是同一个 canceled 事实')
  assert.equal(secondCalls.calls, 0)
  const view = await second.core.queries.getExecutionContext(scope)
  assert.equal(view.runExternalId, canceled.runExternalId, '查询面读到的是替换后的引用，不是原始 running 引用')
})

test('重启后取消 fail closed（签发者配置变了、取消被设为只读），运行记录一字不改', async (t) => {
  const repository = await makeRepository(t)
  const storage = createFakeStorage()
  const first = await composeManualCore({ repository, storage })
  const scope = { workItemId: 'wi-manual-rebound', repositoryId: REPOSITORY_ID }
  const started = await first.core.commands.startWork(startRequest(scope.workItemId, 'manual-rebound-1'))
  const before = await storage.getExecutionRun(runIdFor(started.executionContextId))
  for (const [kind, issuer, asked, code = 'not_found'] of [
    ['binding id 换了（宿主没注入重启前的那个）', { humanBinding: 'binding-human-execution-regenerated' }, 0],
    ['签发密钥换了', { issuerKey: 'rotated-issuer-key-for-human-execution-test' }, 1],
    ['取消被策略设为只读', { policy: { [CapabilityKey.ExecutionRunCancel]: 'read_only' } }, 0, 'permission_denied'],
  ]) {
    const rebuilt = await restart(repository, storage, first, issuer)
    const calls = countCancels(rebuilt.execution)
    const result = await rebuilt.core.commands.cancelExecutionRun(scope)
    assert.equal(result.error?.code, code, `${kind}：取消必须结构化失败`)
    assert.equal(calls.calls, asked, `${kind}：路由不到签发者时 core 不换一个 binding 去问；路由到了由签发者的来源闸门拒绝`)
    assert.deepEqual(await rebuilt.storage.getExecutionRun(before.id), before, `${kind}：失败的取消不得改动运行记录`)
  }
})

test('取消：queued 不是终态；有状态 provider 对并发的第二个取消答 conflict 时以运行记录为准；binding id 重复即拒绝组装', async (t) => {
  const repository = await makeRepository(t)
  const storage = createFakeStorage()
  const { core } = await composeManualCore({ repository, storage, primary: createFakeExecutionProvider({ bindingId: 'binding-fake-primary' }) })
  const scope = { workItemId: 'wi-fake-cancel', repositoryId: REPOSITORY_ID }
  const id = runIdFor((await core.commands.startWork(startRequest(scope.workItemId, 'fake-cancel-1'))).executionContextId)
  for (const status of [ExecutionRunStatus.Succeeded, ExecutionRunStatus.Failed, ExecutionRunStatus.TimedOut]) {
    const ended = { ...(await storage.getExecutionRun(id)), status }
    await storage.putExecutionRun(ended)
    assert.deepEqual([(await core.commands.cancelExecutionRun(scope)).error?.code, await storage.getExecutionRun(id)], ['conflict', ended], `${status} 已结束`)
  }
  await storage.putExecutionRun({ ...(await storage.getExecutionRun(id)), status: ExecutionRunStatus.Queued })
  const [first, second] = await Promise.all([core.commands.cancelExecutionRun(scope), core.commands.cancelExecutionRun(scope)])
  assert.deepEqual([first.status, first.error, second], [ExecutionRunStatus.Canceled, undefined, first])
  const duplicate = createHumanExecutionProvider({ bindingId: `${HUMAN_BINDING}-fallback`, issuerKey: HUMAN_ISSUER_KEY })
  await assert.rejects(composeManualCore({ repository, storage: createFakeStorage(), primary: duplicate, fallbackHuman: true }), /重复/)
  const onlyFallback = await composeManualCore({ repository, storage: createFakeStorage(), primary: false, fallbackHuman: true })
  const taken = await onlyFallback.core.commands.startWork(startRequest('wi-only-fallback', 'only-fallback-1'))
  assert.deepEqual([taken.fallback, taken.runExternalId?.startsWith('manual-run:')], ['manual_fallback', true], '只注入 fallback 时它仍被注册并承接')
})
