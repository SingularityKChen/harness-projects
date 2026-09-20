/**
 * Delivery 契约套件：接受任意 DeliveryProvider 适配器 `{ label, makeProvider(scenario), expect }`。
 * scenario：`{}` 全能力无故障；`{ capabilities: { deployments: false } }` 可选部署/环境读未启用；
 * `{ faults: { offline: true } }` 离线。
 * `expect`：`{ repository, commit, changeRequest, pageSize, checkNames, environmentNames }`。
 *
 * 看护的不变量（tests/README.md §2.3、§2.6）：写尝试（重跑 / 取消）必须返回 not_supported 且
 * **不改变任何状态**——静默成功会让调用方以为远端已经改变；缺可选能力时调用方从 capability 快照
 * 就看到 unavailable，而不是拿到平台错误；声明了的能力必须真的能读到内容，不能只有键没有数据。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { CapabilityKey, effectiveCapabilities } from '@harness-projects/capabilities'

const accessOf = (snapshot, key) => effectiveCapabilities(snapshot).find((c) => c.key === key)?.access ?? 'unavailable'
const sorted = (values) => [...values].sort()
const idsOf = (items) => items.map((item) => item.ref.externalId)

export function deliveryContractSuite(adapter) {
  const { label, makeProvider, expect: expected } = adapter
  const repository = expected.repository
  const allRuns = (provider) => provider.listPipelineRuns({ repository, commit: undefined, cursor: undefined, limit: 100 })

  test(`${label}：按提交查流水线只返回该提交的运行`, async () => {
    const provider = makeProvider({})
    const all = await allRuns(provider)
    assert.equal(all.ok, true)
    const forCommit = await provider.listPipelineRuns({ repository, commit: expected.commit, cursor: undefined, limit: 100 })
    assert.equal(forCommit.ok, true)
    assert.ok(forCommit.value.items.length > 0, '声明的提交上必须有流水线运行')
    assert.ok(forCommit.value.items.every((run) => run.commit === expected.commit))
    assert.ok(all.value.items.length > forCommit.value.items.length, '不筛提交时必须能看到别的提交上的运行')
  })

  test(`${label}：流水线分页遍历不重不漏`, async () => {
    const provider = makeProvider({})
    const single = await allRuns(provider)
    const seen = []
    let cursor
    let pages = 0
    do {
      const page = await provider.listPipelineRuns({ repository, commit: undefined, cursor, limit: expected.pageSize })
      assert.equal(page.ok, true)
      seen.push(...idsOf(page.value.items))
      cursor = page.value.nextCursor
      pages += 1
      assert.ok(pages <= single.value.items.length, '游标必须单调推进，否则会死循环')
    } while (cursor !== undefined)
    assert.deepEqual(sorted(seen), sorted(idsOf(single.value.items)))
    assert.equal(new Set(seen).size, seen.length, '分页不得重复投递同一运行')
  })

  test(`${label}：检查按变更请求映射，带回名称与状态`, async () => {
    const provider = makeProvider({})
    const result = await provider.listChecks({ changeRequest: expected.changeRequest, cursor: undefined, limit: 100 })
    assert.equal(result.ok, true)
    assert.deepEqual(sorted(result.value.items.map((check) => check.name)), sorted(expected.checkNames))
    assert.ok(result.value.items.every((check) => typeof check.status === 'string' && check.status.length > 0))
  })

  test(`${label}：写尝试返回 not_supported 且不改动任何状态`, async () => {
    const provider = makeProvider({})
    const before = await allRuns(provider)
    const run = before.value.items.find((item) => item.status === 'completed')
    assert.ok(run, '写尝试的用例需要一个已完成的运行作为目标')
    const writes = [provider.rerunPipeline, provider.cancelPipeline].filter((method) => typeof method === 'function')
    if (writes.length === 0) {
      // 省略可选方法也是合法实现：调用方必须能从 capability 快照得到 unavailable 后再走降级路径。
      assert.equal(accessOf(await provider.describeCapabilities(), CapabilityKey.DeliveryPipelineRerun), 'unavailable')
    }
    for (const write of writes) {
      const result = await write.call(provider, run.ref)
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'not_supported')
      assert.equal(result.error.retryable, false, 'not_supported 不是可重试的平台错误')
    }
    assert.deepEqual((await allRuns(provider)).value.items, before.value.items, '被拒的写尝试不得改变任何运行')
  })

  test(`${label}：可选部署与环境能力——启用时读得到内容，未启用时报 unavailable`, async () => {
    const enabled = makeProvider({})
    if (typeof enabled.listEnvironments === 'function') {
      const environments = await enabled.listEnvironments(repository)
      assert.equal(environments.ok, true, '声明了的能力不能只有键没有数据')
      assert.deepEqual(sorted(environments.value.map((environment) => environment.name)), sorted(expected.environmentNames))
    }

    const disabled = makeProvider({ capabilities: { deployments: false } })
    assert.equal(accessOf(await disabled.describeCapabilities(), CapabilityKey.DeliveryDeploymentRead), 'unavailable')
    const calls = []
    if (typeof disabled.listDeployments === 'function') calls.push(disabled.listDeployments({ repository, cursor: undefined, limit: 10 }))
    if (typeof disabled.listEnvironments === 'function') calls.push(disabled.listEnvironments(repository))
    assert.ok(calls.length > 0, '缺可选能力时仍必须有办法让调用方观察到 unavailable')
    for (const result of await Promise.all(calls)) {
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'not_supported', '缺能力不是平台错误，调用方要走降级路径')
      assert.equal(result.error.retryable, false)
    }
  })

  test(`${label}：离线返回结构化 unavailable 且不抛裸错误`, async () => {
    const provider = makeProvider({ faults: { offline: true } })
    const results = await Promise.all([
      allRuns(provider),
      provider.listChecks({ changeRequest: expected.changeRequest, cursor: undefined, limit: 10 }),
    ])
    for (const result of results) {
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'unavailable')
      assert.equal(result.error.retryable, true)
    }
  })
}
