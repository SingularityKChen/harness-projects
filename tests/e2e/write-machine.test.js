/**
 * Batch C3 端到端：外部写入状态机与 reconcile（issue #77 / ExecPlan D3、tests/README §2.3）。
 *
 * 一半用纯函数状态机逐条钉死 D3；一半用离线替身的 ambiguous_create 开关证明"结果不确定时必须先
 * reconcile、禁止盲目重试创建"在真实 provider 交互上同样成立。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ProjectErrorCode, WriteState, isAuthoritativeWriteState, newWorkspaceId, projectError } from '@harness-projects/domain'
import {
  beginWrite, composeCore, confirmWrite, markUnknown, markWriting, reconcileWrite,
} from '@harness-projects/core'
import {
  FaultKind, createFakeProviders, refOf,
} from '@harness-projects/provider-fake'

const WORKSPACE = { id: newWorkspaceId(), name: 'MVP-0' }
const REPOSITORY = 'repo-alpha'

const compose = async (providers) => composeCore({ workspace: WORKSPACE, providers })

async function workItemIdOf(core) {
  const item = (await core.queries.listPlanningItems()).find((view) => view.kind === 'work_item')
  assert.ok(item, 'planning 种子里必须至少有一个工作项')
  return item.entityId
}

test('写状态机：确认前只报告 saving，unknown 先 reconcile，冲突保留双值（ExecPlan D3）', () => {
  const reports = []
  const writing = markWriting(beginWrite('branch-x'))
  reports.push(writing, confirmWrite(writing, 'branch-x'))
  assert.equal(writing.saving, true, 'provider 确认前对外只能是 saving')
  assert.equal(writing.writeState, WriteState.Pending)
  assert.equal(writing.confirmed, false)
  assert.equal(confirmWrite(writing, 'branch-x').writeState, WriteState.Saved)
  assert.equal(confirmWrite(writing, 'branch-x').confirmed, true)

  const unknown = markUnknown(writing, projectError(ProjectErrorCode.AmbiguousResult, '结果不确定'))
  const retry = markWriting(unknown)
  reports.push(unknown, retry)
  assert.equal(unknown.writeState, WriteState.Unknown)
  assert.equal(retry.phase, 'unknown', 'unknown 上不得进入 writing')
  assert.equal(retry.error.code, ProjectErrorCode.ResultUnknown, '盲目重试创建必须被拒绝并要求先 reconcile')
  assert.equal(retry.saving, false)

  const reconciled = reconcileWrite(unknown, { found: true, value: 'branch-x', error: undefined })
  reports.push(reconciled)
  assert.equal(reconciled.phase, 'reconciled')
  assert.equal(reconciled.writeState, WriteState.Saved)
  assert.equal(reconciled.confirmed, true)

  const conflict = reconcileWrite(unknown, { found: true, value: 'other-branch', error: undefined })
  reports.push(conflict)
  assert.equal(conflict.writeState, WriteState.Conflict)
  assert.equal(conflict.values.lastKnownAuthoritative, 'other-branch', 'conflict 必须保留最后已知权威值')
  assert.equal(conflict.values.attemptedValue, 'branch-x', 'conflict 必须保留本次尝试值')

  for (const report of reports) {
    assert.equal(isAuthoritativeWriteState(report.writeState), report.confirmed, '权威 Saved 只能与确认证据同时出现')
  }
})

test('结果不确定：git 创建返回 ambiguous 时先 reconcile，未落地就 failed 且不重试创建（#77）', async () => {
  const providers = createFakeProviders()
  providers.development.faultsSwitch.set(FaultKind.AmbiguousCreate, true)
  const core = await compose(providers)
  const workItemId = await workItemIdOf(core)
  const branchesBefore = providers.development.state.branches.length
  const runsBefore = providers.execution.state.runs.length
  const result = await core.commands.startWork({ workItemId, repositoryId: REPOSITORY, actor: { kind: 'agent' }, idempotencyKey: 'ambiguous-1' })
  assert.equal(result.writeState, WriteState.Failed)
  assert.equal(result.confirmed, false)
  assert.equal(result.error.code, 'not_found', 'reconcile 未找到落地分支 → 明确失败，而不是重试创建')
  assert.equal(providers.development.state.branches.length, branchesBefore, '不得盲目重试创建第二个分支')
  assert.equal(providers.execution.state.runs.length, runsBefore, 'git 未确认前不得启动执行')
})

test('结果不确定：reconcile 找回同值分支后继续，不把已落地写入误判为失败（#77）', async () => {
  const providers = createFakeProviders()
  providers.development.faultsSwitch.set(FaultKind.AmbiguousCreate, true)
  const core = await compose(providers)
  const workItemId = await workItemIdOf(core)
  const bindingId = providers.development.gate.bindingId
  const branch = `work/${workItemId}`
  // 分支其实已落地（创建成功但响应丢失）：reconcile 必须认出来，然后才轮到工作树那一步。
  providers.development.state.branches.push({
    repository: refOf(bindingId, 'repository', REPOSITORY), ref: refOf(bindingId, 'branch', branch), name: branch, headCommit: 'sha-1',
  })
  const before = providers.development.state.branches.length
  const result = await core.commands.startWork({ workItemId, repositoryId: REPOSITORY, actor: { kind: 'agent' }, idempotencyKey: 'ambiguous-2' })
  assert.equal(providers.development.state.branches.length, before, 'reconcile 命中后不得再创建分支')
  assert.notEqual(result.error.code, 'not_found', '分支已落地时不得被 reconcile 判成未创建')
  assert.equal(result.error.code, 'ambiguous_result', '失败发生在后续工作树步骤，而不是分支')
})
