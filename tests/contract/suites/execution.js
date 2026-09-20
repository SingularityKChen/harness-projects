/**
 * Execution 契约套件：接受任意 ExecutionProvider 适配器 `{ label, makeProvider(scenario), expect }`。
 * scenario：`{}` 全能力无故障；`{ faults: { harnessFailure: true } }` 执行 harness 启动失败；
 * `{ capabilities: { cancel: false } }` 可选取消能力未启用；`{ faults: { offline: true } }` 离线。
 * `expect`：`{ context, stages, failedStage, seededRunExternalId, seededRunStatus, runningRunExternalId }`。
 *
 * 看护的不变量（tests/README.md §2.3、§3）：启动后可读回同一运行；执行失败映射成**带阶段名**的结构化
 * 错误（只说"失败了"的调用方无法决定重试还是换环境）；缺可选取消能力时是 unavailable 而不是平台错误；
 * 声明的取消能力必须真的落到权威状态。port 故意没有 reconcile，套件也不假设有观察流。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { CapabilityKey, effectiveCapabilities } from '@harness-projects/capabilities'

const accessOf = (snapshot, key) => effectiveCapabilities(snapshot).find((c) => c.key === key)?.access ?? 'unavailable'
const runRef = (context, externalId) => ({ ...context, objectKind: 'execution_run', externalId })

export function executionContractSuite(adapter) {
  const { label, makeProvider, expect: expected } = adapter
  const context = expected.context
  const start = (provider) => provider.startRun({ context, command: 'task verify', environment: { CI: 'true' } })

  test(`${label}：启动后可读回同一运行`, async () => {
    const provider = makeProvider({})
    const started = await start(provider)
    assert.equal(started.ok, true)
    assert.ok(started.value.status.length > 0, '启动必须返回一个可判定的状态')
    const read = await provider.getRun(started.value.ref)
    assert.equal(read.ok, true)
    assert.equal(read.value.ref.externalId, started.value.ref.externalId)
    assert.equal(read.value.status, started.value.status, '启动返回的状态必须与随后读回的一致')
  })

  test(`${label}：种子的历史运行按外部 id 读回`, async () => {
    const provider = makeProvider({})
    const read = await provider.getRun(runRef(context, expected.seededRunExternalId))
    assert.equal(read.ok, true)
    assert.equal(read.value.status, expected.seededRunStatus)
  })

  test(`${label}：启动失败映射成带阶段名的结构化错误`, async () => {
    const provider = makeProvider({ faults: { harnessFailure: true } })
    const result = await start(provider)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'unavailable')
    assert.equal(result.error.retryable, true)
    const named = expected.stages.filter((stage) => result.error.message.includes(stage))
    assert.equal(named.length, 1, `失败信息必须恰好指明一个阶段（实际：${result.error.message}）`)
    assert.equal(named[0], expected.failedStage)
  })

  test(`${label}：缺可选取消能力报 unavailable，而不是平台错误`, async () => {
    const provider = makeProvider({ capabilities: { cancel: false } })
    const snapshot = await provider.describeCapabilities()
    assert.equal(accessOf(snapshot, CapabilityKey.ExecutionRunCancel), 'unavailable')
    if (typeof provider.cancelRun !== 'function') return
    const result = await provider.cancelRun(runRef(context, expected.runningRunExternalId))
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'not_supported')
    assert.equal(result.error.retryable, false)
  })

  test(`${label}：声明的取消能力真的能结束运行，且读到的是权威新状态`, async () => {
    const provider = makeProvider({})
    if (typeof provider.cancelRun !== 'function') return
    const canceled = await provider.cancelRun(runRef(context, expected.runningRunExternalId))
    assert.equal(canceled.ok, true)
    assert.equal(canceled.value.status, 'canceled')
    const read = await provider.getRun(canceled.value.ref)
    assert.equal(read.ok, true)
    assert.equal(read.value.status, 'canceled', '取消必须落到权威状态，不能只改返回值')
  })

  test(`${label}：离线返回结构化 unavailable 且不抛裸错误`, async () => {
    const provider = makeProvider({ faults: { offline: true } })
    const results = await Promise.all([
      start(provider),
      provider.getRun(runRef(context, expected.seededRunExternalId)),
    ])
    for (const result of results) {
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'unavailable')
      assert.equal(result.error.retryable, true)
    }
  })
}
