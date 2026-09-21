/**
 * Batch C3 端到端：Start Work 补偿序列（issue #77 / ExecPlan D4）。全部使用离线替身：无凭据、无网络。
 * 用例名说明它保护哪条不变量：不合法输入不落上下文、git 失败不启动执行、执行失败降级而不丢上下文、
 * 重复开始幂等、重启后仍可恢复（tests/README §2.3、§2.5）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ExecutionContextStatus, WriteState, newWorkspaceId } from '@harness-projects/domain'
import { composeCore } from '@harness-projects/core'
import {
  FaultKind, createFakeProviders, createFakeStorage, exportFakeStorageState, refOf,
} from '@harness-projects/provider-fake'

const WORKSPACE = { id: newWorkspaceId(), name: 'MVP-0' }
const REPOSITORY = 'repo-alpha'
const REQUEST = { repositoryId: REPOSITORY, actor: { kind: 'agent' } }

const compose = (providers, storage) =>
  composeCore(storage === undefined ? { workspace: WORKSPACE, providers } : { workspace: WORKSPACE, providers, storage })

async function workItemIdOf(core) {
  const item = (await core.queries.listPlanningItems()).find((view) => view.kind === 'work_item')
  assert.ok(item, 'planning 种子里必须至少有一个工作项')
  return item.entityId
}

test('开始工作：工作项或仓库形状不合法时不产生任何执行上下文（ExecPlan D4）', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers)
  const result = await core.commands.startWork({ ...REQUEST, workItemId: '   ', idempotencyKey: 'invalid-1' })
  assert.equal(result.executionContextId, undefined, '不合法输入不得产出执行上下文 id')
  assert.equal(result.writeState, WriteState.Failed)
  assert.equal(result.error.code, 'invalid_input')
  assert.equal(exportFakeStorageState(providers.storage).contexts.length, 0, '不得写入任何执行上下文')
  assert.equal(await core.queries.getExecutionContext({ workItemId: '   ', repositoryId: REPOSITORY }), undefined)
})

test('工作树冲突：按幂等已存在资源复用且不覆盖工作树（ExecPlan D4）', async () => {
  const providers = createFakeProviders()
  const bindingId = providers.development.gate.bindingId
  const path = '.worktrees/c3-occupied'
  // 预置同路径工作树：createWorktree 必须 conflict 而不是静默覆盖（脏工作树不自动清理的机械证据）。
  providers.development.state.worktrees.push({
    repository: refOf(bindingId, 'repository', REPOSITORY), ref: refOf(bindingId, 'worktree', path), path, branch: 'main',
  })
  const core = await compose(providers)
  const workItemId = await workItemIdOf(core)
  const runsBefore = providers.execution.state.runs.length
  const result = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'git-fail-1', worktreePath: path })
  assert.equal(result.status, ExecutionContextStatus.Ready)
  assert.equal(result.writeState, WriteState.Saved)
  assert.equal(result.confirmed, true)
  assert.equal(result.error, undefined)
  assert.equal(result.worktreeExternalId, path)
  assert.equal(result.branchExternalId, `work/${workItemId}`, '已建分支仍要记录在上下文里')
  assert.equal(providers.execution.state.runs.length, runsBefore + 1, '复用工作树后应启动一次执行')
  assert.equal(providers.development.state.worktrees.length, 1, '既有工作树必须原样保留')
  const view = await core.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY })
  assert.equal(view.status, ExecutionContextStatus.Ready)
})

test('执行启动失败：上下文与工作树/分支保留并降级 manual_fallback（ExecPlan D4）', async () => {
  const providers = createFakeProviders()
  providers.execution.faultsSwitch.set(FaultKind.HarnessFailure, true)
  const core = await compose(providers)
  const workItemId = await workItemIdOf(core)
  const runsBefore = providers.execution.state.runs.length
  const result = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'run-fail-1' })
  assert.equal(result.fallback, 'manual_fallback')
  assert.equal(result.degraded, true)
  assert.equal(result.confirmed, true, 'git 写入已拿到 provider ack，此时 Saved 才被允许')
  assert.ok(result.worktreeExternalId !== undefined && result.branchExternalId !== undefined, '工作树与分支必须仍在')
  assert.equal(providers.execution.state.runs.length, runsBefore, '启动失败不得在 provider 侧产生运行')
  const view = await core.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY })
  assert.equal(view.status, ExecutionContextStatus.Ready)
  assert.equal(view.worktreeExternalId, result.worktreeExternalId)
  assert.equal(view.branchExternalId, result.branchExternalId)
  assert.equal(view.fallback, 'manual_fallback', '重查后仍要看到降级')
})

test('重复开始：同一工作项 + 仓库返回既有上下文，不产生第二份工作树或分支（ExecPlan D4）', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers)
  const workItemId = await workItemIdOf(core)
  const request = { ...REQUEST, workItemId }
  const first = await core.commands.startWork({ ...request, idempotencyKey: 'dup-1' })
  const branches = providers.development.state.branches.length
  const worktrees = providers.development.state.worktrees.length
  assert.equal(first.writeState, WriteState.Saved)
  assert.equal(first.confirmed, true)
  const second = await core.commands.startWork({ ...request, idempotencyKey: 'dup-2' })
  assert.equal(second.executionContextId, first.executionContextId, '重复开始必须复用同一个上下文 id')
  assert.equal(providers.development.state.branches.length, branches, '不得产生第二个分支')
  assert.equal(providers.development.state.worktrees.length, worktrees, '不得产生第二份工作树')
  const replay = await core.commands.startWork({ ...request, idempotencyKey: 'dup-1' })
  assert.equal(replay.executionContextId, first.executionContextId, '同键重放必须返回原结果')
  assert.equal(replay.writeState, first.writeState)
})

/** 挂起第一个事务，并给「事务必须在 2 秒内开始」一个清晰断言（否则注入非事务实现时只会挂住 CI）。 */
function pauseFirstTransaction(storage) {
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  const original = storage.transaction.bind(storage)
  let calls = 0
  storage.transaction = async (work) => {
    if ((calls += 1) === 1) { entered.resolve(); await release.promise }
    return original(work)
  }
  const started = Promise.race([
    entered.promise.then(() => true),
    new Promise((resolve) => { setTimeout(() => resolve(false), 2000) }),
  ])
  return { release, entered: started.then((ok) => assert.ok(ok, '认领必须在存储事务内完成（2 秒内未开始事务）')) }
}

test('并发开始：认领事务交错时只供应一次（ExecPlan D1）', async () => {
  const providers = createFakeProviders()
  const branchesBefore = providers.development.state.branches.length
  const runsBefore = providers.execution.state.runs.length
  const contextsBefore = exportFakeStorageState(providers.storage).contexts.length
  const core = await compose(providers)
  const workItemId = await workItemIdOf(core)
  const gate = pauseFirstTransaction(providers.storage)
  const request = { ...REQUEST, workItemId }
  const firstPromise = core.commands.startWork({ ...request, idempotencyKey: 'race-1' })
  await gate.entered
  const secondPromise = core.commands.startWork({ ...request, idempotencyKey: 'race-2' })
  gate.release.resolve()
  const [first, second] = await Promise.all([firstPromise, secondPromise])
  const state = exportFakeStorageState(providers.storage)
  assert.equal(state.contexts.length, contextsBefore + 1, '并发调用只能留下一个上下文')
  assert.equal(providers.development.state.worktrees.length, 1, '并发调用只能创建一份工作树')
  assert.equal(providers.development.state.branches.length, branchesBefore + 1, '并发调用只能创建一个工作分支')
  assert.equal(providers.execution.state.runs.length, runsBefore + 1, '并发调用只能启动一个执行运行')
  assert.equal(second.executionContextId, first.executionContextId, '两个结果必须指向同一上下文')
})

test('跨 Core 实例：共享 Storage 的并发认领只供应一次（ExecPlan D1）', async () => {
  const firstProviders = createFakeProviders()
  const first = await compose(firstProviders)
  const workItemId = await workItemIdOf(first)
  const shared = firstProviders.storage
  const branchesBefore = firstProviders.development.state.branches.length
  const worktreesBefore = firstProviders.development.state.worktrees.length
  const runsBefore = firstProviders.execution.state.runs.length
  const second = await compose(firstProviders, shared)
  const gate = pauseFirstTransaction(shared)
  const request = { ...REQUEST, workItemId }
  const firstPromise = first.commands.startWork({ ...request, idempotencyKey: 'cross-1' })
  await gate.entered
  const secondPromise = second.commands.startWork({ ...request, idempotencyKey: 'cross-2' })
  gate.release.resolve()
  const [one, two] = await Promise.all([firstPromise, secondPromise])
  const state = exportFakeStorageState(shared)
  assert.equal(state.contexts.length, 1)
  assert.equal(firstProviders.development.state.worktrees.length, worktreesBefore + 1)
  assert.equal(firstProviders.development.state.branches.length, branchesBefore + 1)
  assert.equal(firstProviders.execution.state.runs.length, runsBefore + 1)
  assert.equal(one.executionContextId, two.executionContextId)
})

test('重启：同一份 Storage 内容上的新 core 仍按工作项 + 仓库查到上下文、工作树与分支（#77）', async () => {
  const providers = createFakeProviders()
  const first = await compose(providers)
  const workItemId = await workItemIdOf(first)
  const started = await first.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'restart-1' })
  const restored = createFakeStorage(exportFakeStorageState(providers.storage))
  const second = await compose(providers, restored)
  const view = await second.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY })
  assert.ok(view, '重启后必须能按工作项与仓库查到执行上下文')
  assert.equal(view.id, started.executionContextId)
  assert.equal(view.worktreeExternalId, started.worktreeExternalId)
  assert.equal(view.branchExternalId, started.branchExternalId)
})
