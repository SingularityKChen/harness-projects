import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ExecutionContextStatus, WriteState, newWorkspaceId } from '@harness-projects/domain'
import { composeCore } from '@harness-projects/core'
import { createFakeProviders, exportFakeStorageState } from '@harness-projects/provider-fake'

const WORKSPACE = { id: newWorkspaceId(), name: 'MVP-0' }
const REQUEST = { repositoryId: 'repo-alpha', actor: { kind: 'agent' } }

async function workItemIdOf(core) {
  const item = (await core.queries.listPlanningItems()).find((view) => view.kind === 'work_item')
  assert.ok(item)
  return item.entityId
}

const compose = (providers, storage, clock) => composeCore({
  workspace: WORKSPACE, providers, ...(storage === undefined ? {} : { storage }), ...(clock === undefined ? {} : { clock }),
})

/** 可控时钟：租约过期由测试显式决定，不靠真实等待。 */
function controllableClock() {
  let now = Date.parse('2026-09-21T00:00:00.000Z')
  return { clock: () => new Date(now).toISOString(), advance: (ms) => { now += ms } }
}

test('中断后：Provisioning 上下文接管供应并只创建一份资源', async () => {
  const providers = createFakeProviders()
  const time = controllableClock()
  const core = await compose(providers, undefined, time.clock)
  const workItemId = await workItemIdOf(core)
  const original = providers.development.createBranch.bind(providers.development)
  let interrupted = true
  providers.development.createBranch = async (input) => {
    if (interrupted) {
      interrupted = false
      throw new Error('injected interruption after claim')
    }
    return original(input)
  }
  await assert.rejects(() => core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'interrupt-1' }))
  const stateAfterInterrupt = exportFakeStorageState(providers.storage)
  assert.equal(stateAfterInterrupt.contexts[0].status, ExecutionContextStatus.Provisioning)

  const inFlight = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'interrupt-inflight' })
  assert.equal(inFlight.executionContextId, stateAfterInterrupt.contexts[0].id)
  assert.equal(providers.execution.state.runs.length, 2, '在途期间不得启动第二个执行运行')
  assert.equal(providers.development.state.branches.filter((b) => b.name === `work/${workItemId}`).length, 0)

  // 租约过期后才允许接管，把同一个上下文做完。
  time.advance(31_000)
  const resumed = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'interrupt-2' })
  assert.equal(resumed.writeState, WriteState.Saved)
  assert.equal(resumed.status, ExecutionContextStatus.Ready)
  assert.equal(exportFakeStorageState(providers.storage).contexts.length, 1)
  assert.equal(providers.development.state.branches.filter((b) => b.name === `work/${workItemId}`).length, 1)
  assert.equal(providers.development.state.worktrees.length, 1)
  assert.equal(providers.execution.state.runs.length, 3)
})
