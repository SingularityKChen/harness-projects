/**
 * 离线 Execution 替身的契约套件装配，外加两条判别性用例。判别性用例保护的不变量：失败信息指明的正是替身计划里出错的阶段
 * （把阶段名从错误信息里去掉，套件的"带阶段名的结构化错误"用例必然失败）；port 没有 reconcile，替身也不提供假的观察流。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createFakeExecutionProvider } from '@harness-projects/provider-fake'
import { executionContractSuite } from './suites/execution.js'

const bindingId = 'binding-fake-execution'
const context = { bindingId, objectKind: 'execution_context', externalId: 'context-1', url: undefined }

executionContractSuite({
  label: '离线 Execution 替身',
  makeProvider: (scenario = {}) => createFakeExecutionProvider({ bindingId, ...scenario }),
  expect: {
    context, stages: ['prepare', 'execute', 'collect'], failedStage: 'prepare',
    seededRunExternalId: 'run-1', seededRunStatus: 'succeeded', runningRunExternalId: 'run-2',
  },
})

test('Execution 替身：失败信息指明的就是替身计划中出错的阶段', async () => {
  const provider = createFakeExecutionProvider({ bindingId, faults: { harnessFailure: true }, failingStage: 'execute' })
  const result = await provider.startRun({ context, command: 'task verify', environment: {} })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'unavailable')
  assert.ok(result.error.message.includes('execute'), `错误信息必须点名 execute（实际：${result.error.message}）`)
  assert.equal(result.error.message.includes('prepare'), false, '不得把别的阶段说成失败阶段')
})

test('Execution 替身：已结束的运行不允许被取消，返回 conflict 而不是假装成功', async () => {
  const provider = createFakeExecutionProvider({ bindingId })
  const finished = { ...context, objectKind: 'execution_run', externalId: 'run-1' }
  const result = await provider.cancelRun(finished)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'conflict')
  const read = await provider.getRun(finished)
  assert.equal(read.value.status, 'succeeded', '被拒的取消不得改动运行状态')
})

test('Execution 替身：不提供 reconcile，没有事件源就不假装有观察流', () => {
  const provider = createFakeExecutionProvider({ bindingId })
  assert.equal(provider.reconcile, undefined)
})
