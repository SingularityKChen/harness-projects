/** #141：公开 Start Work 命令在真实 Local Git + 文件 SQLite 上的失败、重放与关库重开证据。
 * Execution 是离线替身：主执行确定拒绝，fallback ack 一次人工交接；不调用模型或远端。
 */
import '../fixtures/resolution-preflight.mjs'

import assert from 'node:assert/strict'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

import { CapabilityKey } from '@harness-projects/capabilities'
import { composeCore } from '@harness-projects/core'
import { createFakeExecutionProvider } from '@harness-projects/provider-fake'
import { createSqliteStorage, openDatabase } from '@harness-projects/storage-sqlite'

import { FROZEN_NOW, REPOSITORY_ID, git, makeFixture, providerFor, recordingRunner, registerWorkItem, worktreePaths } from './local-git-fixture.js'

const WORKSPACE = { id: 'durable-start-work', name: 'Start Work 持久恢复' }
const WORK_ITEM = 'wi-durable'
const PRIMARY = 'binding-durable-primary'
const FALLBACK = 'binding-durable-fallback'
const REQUEST = { workItemId: WORK_ITEM, repositoryId: REPOSITORY_ID, task: 'Synthetic durable task', actor: { kind: 'agent', id: 'durable-test' } }

/** 同一组装配在四个用例中使用；故障只截获真实 Git 的 worktree add，其余命令仍交真实 runner。 */
async function setup(t, { refuseWorktree = false } = {}) {
  const cleanups = [], handles = []
  t.after(async () => {
    for (const storage of handles) storage.close()
    for (const cleanup of cleanups) await cleanup()
  })
  const fixture = await makeFixture((cleanup) => cleanups.push(cleanup))
  const databasePath = path.join(fixture.root, 'workspace.sqlite')
  const fault = { refuseWorktree }
  const openStorage = (file) => { const storage = createSqliteStorage(file); handles.push(storage); return storage }

  async function compose(storage) {
    const recorder = recordingRunner(), calls = { worktreeRefusals: 0, primary: [], fallback: [] }
    const development = providerFor(fixture, { runGit: async (args) => {
      if (fault.refuseWorktree && args.includes('worktree') && args.includes('add')) {
        calls.worktreeRefusals++
        return { code: 128, stdout: '', stderr: 'fatal: resource temporarily unavailable (synthetic worktree refusal)' }
      }
      return recorder.runGit(args)
    } })
    const execution = createFakeExecutionProvider({ bindingId: PRIMARY, faults: { harnessFailure: true } })
    const executionFallback = createFakeExecutionProvider({ bindingId: FALLBACK })
    // Core 的 fallback 槽位只接受声明 fallback 能力的提供方；执行本身仍使用原替身实现。
    const describe = executionFallback.describeCapabilities.bind(executionFallback)
    executionFallback.describeCapabilities = async () => {
      const snapshot = await describe()
      return { ...snapshot,
        capability: { ...snapshot.capability, [CapabilityKey.ExecutionRunFallback]: 'available' },
        permission: { ...snapshot.permission, [CapabilityKey.ExecutionRunFallback]: 'available' },
      }
    }
    for (const [provider, target] of [[execution, calls.primary], [executionFallback, calls.fallback]]) {
      const start = provider.startRun.bind(provider)
      provider.startRun = async (input, lifecycle) => { target.push(structuredClone(input)); return start(input, lifecycle) }
    }
    const providers = { development, execution, executionFallback }
    const core = await composeCore({ workspace: WORKSPACE, storage, providers, clock: () => FROZEN_NOW })
    return { core, storage, providers, calls, gitCalls: recorder.calls }
  }

  const world = await compose(openStorage(databasePath))
  await registerWorkItem(world.storage, WORKSPACE.id, WORK_ITEM)
  return { ...world, fixture, databasePath, fault, compose, openStorage }
}

const start = (world, key = 'original') => world.core.commands.startWork({ ...REQUEST, idempotencyKey: key })
const query = (world) => world.core.queries.getExecutionContext(REQUEST)
const worktreePath = (world) => path.join(world.fixture.root, WORK_ITEM)

/** 直接从 SQLite 枚举总量，不能让确定性 ID 下的单行查询漏掉第二份 context/run/worktree。 */
function storedIds(storage) {
  const db = openDatabase(storage.location)
  try {
    return {
      contexts: db.prepare('SELECT id FROM execution_context ORDER BY id').all().map((row) => row.id),
      runs: db.prepare('SELECT id FROM execution_run ORDER BY id').all().map((row) => row.id),
      worktrees: db.prepare("SELECT id FROM entity WHERE kind = 'worktree' ORDER BY id").all().map((row) => row.id),
    }
  } finally { db.close() }
}

async function facts(world, contextId) {
  const view = await query(world)
  return {
    context: await world.storage.getExecutionContext(contextId),
    run: view?.runId === undefined ? undefined : await world.storage.getExecutionRun(view.runId),
    relations: (await world.storage.listRelations(WORKSPACE.id)).sort((a, b) => a.type.localeCompare(b.type)),
    attempts: await world.storage.listMutationAttempts(WORKSPACE.id),
    ids: storedIds(world.storage),
    view,
  }
}

async function assertGit(world, exists = true) {
  const target = worktreePath(world)
  assert.deepEqual(await worktreePaths(world.fixture), exists ? [world.fixture.repositoryPath, target] : [world.fixture.repositoryPath],
    '真实 Git 的工作树总数：主检出加至多一个工作树')
  assert.deepEqual((await world.fixture.run(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).trim().split('\n'),
    ['main', 'work/wi-durable'], '总分支集合只有基线与已决定的工作分支')
  assert.equal((await world.fixture.run(['rev-parse', 'work/wi-durable'])).trim(), world.fixture.headCommit)
  if (!exists) {
    await assert.rejects(stat(target), { code: 'ENOENT' }, '确定拒绝后磁盘上没有工作树目录')
    return
  }
  assert.equal(await readFile(path.join(target, 'README.md'), 'utf8'), '# fixture\n', '工作树包含真实仓库内容')
  assert.equal((await git(['rev-parse', '--abbrev-ref', 'HEAD'], target)).trim(), 'work/wi-durable')
  assert.equal((await git(['rev-parse', 'HEAD'], target)).trim(), world.fixture.headCommit)
}

async function assertReadyFallback(world, result) {
  assert.deepEqual([result.status, result.writeState, result.confirmed, result.fallback, result.degraded, result.error],
    ['ready', 'saved', true, 'manual_fallback', true, undefined])
  assert.equal(result.branchExternalId, 'work/wi-durable')
  assert.equal(await realpath(result.worktreeExternalId), worktreePath(world))
  assert.ok(result.runExternalId, 'fallback 的 ack 运行引用必须存在')
  const saved = await facts(world, result.executionContextId)
  assert.deepEqual([saved.context.status, saved.context.branchExternalId, saved.context.worktreeExternalId],
    ['ready', 'work/wi-durable', worktreePath(world)])
  assert.deepEqual([saved.run.contextId, saved.run.status, saved.run.fallback, saved.run.providerRef.bindingId, saved.run.providerRef.externalId],
    [result.executionContextId, 'running', true, FALLBACK, result.runExternalId])
  assert.deepEqual(saved.ids.contexts, [result.executionContextId])
  assert.deepEqual(saved.ids.runs, [saved.run.id])
  assert.equal(saved.ids.worktrees.length, 1)
  assert.deepEqual(saved.relations.map((r) => [r.from, r.type, r.to, r.source, r.state]), [
    [result.executionContextId, 'has_worktree', saved.ids.worktrees[0], 'explicit', 'confirmed'],
    [WORK_ITEM, 'tracks', result.executionContextId, 'explicit', 'confirmed'],
  ])
  assert.deepEqual([saved.view.id, saved.view.runId, saved.view.runExternalId, saved.view.fallback, saved.view.degraded],
    [result.executionContextId, saved.run.id, result.runExternalId, 'manual_fallback', true])
  await assertGit(world)
  return saved
}

test('Local Git + SQLite：工作树创建确定失败时执行调用为零，保留已落地分支和失败上下文', async (t) => {
  // 若 Core 越过 Git 失败仍启动执行，或者把分支 ack 冒充工作树 ack，本用例必须失败。
  const world = await setup(t, { refuseWorktree: true })
  const result = await start(world)
  assert.deepEqual([result.status, result.writeState, result.confirmed, result.error?.code, result.worktreeExternalId, result.runExternalId],
    ['failed', 'failed', false, 'unavailable', undefined, undefined])
  assert.deepEqual([world.calls.worktreeRefusals, world.calls.primary.length, world.calls.fallback.length], [1, 0, 0])
  const saved = await facts(world, result.executionContextId)
  assert.deepEqual([saved.context.status, saved.context.branchExternalId, saved.context.worktreeExternalId, saved.run],
    ['failed', 'work/wi-durable', undefined, undefined])
  assert.deepEqual(saved.ids.contexts, [result.executionContextId])
  assert.deepEqual(saved.ids.runs, [])
  assert.deepEqual(saved.relations.map((r) => [r.from, r.type, r.to, r.state]),
    [[WORK_ITEM, 'tracks', result.executionContextId, 'confirmed']])
  assert.deepEqual(saved.attempts.map((a) => [a.idempotencyKey, a.state]), [['original', 'failed']])
  await assertGit(world, false)
})

test('Local Git + SQLite：主执行确定失败时保留工作树与 ready 上下文，并持久化人工 fallback', async (t) => {
  // 若执行拒绝清理 Git/context，或没经主执行失败就误报人工接管，本用例必须失败。
  const world = await setup(t)
  const result = await start(world)
  await assertReadyFallback(world, result)
  assert.deepEqual([world.calls.primary.length, world.calls.fallback.length], [1, 1])
  for (const [calls, bindingId] of [[world.calls.primary, PRIMARY], [world.calls.fallback, FALLBACK]]) {
    assert.deepEqual([calls[0].workingDirectory, calls[0].command, calls[0].context.bindingId, calls[0].context.externalId],
      [worktreePath(world), REQUEST.task, bindingId, result.executionContextId], '执行输入使用 Git ack 的工作目录与同一个 context')
  }
})

test('Local Git + SQLite：失败后新键恢复、同键与新键重放都保持唯一 context/worktree/run', async (t) => {
  // 若重试把已决定分支或已完成的执行重建，本用例的磁盘总量、行总量与调用数会失败。
  const world = await setup(t, { refuseWorktree: true })
  const failed = await start(world)
  world.fault.refuseWorktree = false
  const replayedFailure = await start(world)
  assert.deepEqual([replayedFailure.status, replayedFailure.writeState, replayedFailure.executionContextId, replayedFailure.error?.code],
    ['failed', 'failed', failed.executionContextId, failed.error.code], '同键重放保持原始失败结论，不隐式重试')
  assert.equal(world.calls.worktreeRefusals, 1)
  assert.deepEqual([world.calls.primary.length, world.calls.fallback.length], [0, 0])
  const recovered = await start(world, 'recovery')
  assert.equal(recovered.executionContextId, failed.executionContextId, '恢复沿用原始 context')
  const before = await assertReadyFallback(world, recovered)
  const mark = world.gitCalls.length
  const replay = await start(world, 'recovery')
  assert.deepEqual([replay.writeState, replay.executionContextId, replay.worktreeExternalId, replay.runExternalId, replay.fallback],
    ['saved', recovered.executionContextId, recovered.worktreeExternalId, recovered.runExternalId, 'manual_fallback'])
  const replacement = await start(world, 'replacement')
  assert.deepEqual([replacement.writeState, replacement.confirmed, replacement.error?.code, replacement.error?.message],
    ['conflict', false, 'conflict', 'existing_execution_task_not_sent'], '新 key 是新任务，既有运行不能冒充接收了新任务')
  assert.deepEqual(await facts(world, recovered.executionContextId), before, '重放不改变 context/run/关系/attempt 总体事实')
  assert.deepEqual([world.calls.primary.length, world.calls.fallback.length], [1, 1])
  assert.equal(world.gitCalls.slice(mark).some((args) => args.includes('branch') || args.includes('add')), false, '重放只核验，不再创建分支或工作树')
  await assertGit(world)
})

test('Local Git + SQLite：关闭并重开同一文件、重组 Core 后恢复 context/relations/run 及旧新键重放', async (t) => {
  // 若只保留内存、重开错误文件或冷启动重新派发执行，本用例必须失败。
  const world = await setup(t)
  const result = await start(world)
  const before = await assertReadyFallback(world, result)
  assert.equal((await stat(world.databasePath)).isFile(), true, '持久化目标确实是磁盘文件')
  const oldStorage = world.storage
  oldStorage.close()
  await assert.rejects(oldStorage.getExecutionContext(result.executionContextId), /closed|关闭/i, '原句柄已不可读')

  const reopened = await world.compose(world.openStorage(world.databasePath))
  assert.notEqual(reopened.storage, oldStorage)
  assert.notEqual(reopened.core, world.core)
  assert.notEqual(reopened.providers.development, world.providers.development)
  assert.notEqual(reopened.providers.executionFallback, world.providers.executionFallback)
  assert.deepEqual(await facts(reopened, result.executionContextId), before, '新 Core 在任何命令之前从磁盘恢复完整旧事实')
  assert.equal(await realpath(reopened.storage.location), await realpath(world.databasePath), '新句柄仍打开同一数据库文件')
  const replay = await start(reopened)
  assert.deepEqual([replay.status, replay.writeState, replay.confirmed, replay.executionContextId, replay.worktreeExternalId, replay.runExternalId, replay.fallback],
    ['ready', 'saved', true, result.executionContextId, result.worktreeExternalId, result.runExternalId, 'manual_fallback'])
  const replacement = await start(reopened, 'after-reopen')
  assert.deepEqual([replacement.writeState, replacement.confirmed, replacement.error?.code, replacement.error?.message],
    ['conflict', false, 'conflict', 'existing_execution_task_not_sent'])
  assert.deepEqual(await facts(reopened, result.executionContextId), before)
  assert.deepEqual([world.calls.primary.length, world.calls.fallback.length, reopened.calls.primary.length, reopened.calls.fallback.length], [1, 1, 0, 0])
  assert.equal(reopened.gitCalls.some((args) => args.includes('branch') || args.includes('add')), false, '冷启动重放没有再创建 Git 资源')
  await assertGit(world)
})
