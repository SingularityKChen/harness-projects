/**
 * 离线 Delivery 替身的契约套件装配，外加替身专属的判别性用例。它们保护的不变量：只读交付面不声明写
 * 能力（调用方从快照就看到 unavailable），而声明的可选部署读能力必须真的能读到环境；运行按 branch、
 * 检查按 repository + commit 过滤，删掉任一过滤都有用例变红。把写操作改成静默成功后，"写尝试返回
 * not_supported 且不改动任何状态"用例必然失败。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { CapabilityKey, effectiveCapabilities } from '@harness-projects/capabilities'
import { createFakeDeliveryProvider } from '@harness-projects/provider-fake'
import { deliveryContractSuite } from './suites/delivery.js'

const bindingId = 'binding-fake-delivery'
const repository = { bindingId, objectKind: 'repository', externalId: 'repo-alpha', url: undefined }

deliveryContractSuite({
  label: '离线 Delivery 替身',
  makeProvider: (scenario = {}) => createFakeDeliveryProvider({ bindingId, ...scenario }),
  expect: {
    repository, commit: 'sha-1', pageSize: 1,
    checkNames: ['build', 'lint', 'test'], environmentNames: ['production', 'staging'],
  },
})

test('Delivery 替身：只读面不声明写能力，但显式提供写方法并拒绝', async () => {
  const provider = createFakeDeliveryProvider({ bindingId })
  const snapshot = await provider.describeCapabilities()
  const rerun = effectiveCapabilities(snapshot).find((capability) => capability.key === CapabilityKey.DeliveryPipelineRerun)
  assert.equal(rerun?.access ?? 'unavailable', 'unavailable')
  assert.equal(typeof provider.rerunPipeline, 'function', '写尝试必须显式返回 not_supported，而不是省略方法')
  assert.equal(typeof provider.cancelPipeline, 'function')
})

test('Delivery 替身：同提交不同分支按 branch 过滤，省略 branch 不筛选', async () => {
  const provider = createFakeDeliveryProvider({ bindingId })
  provider.state.runs.push({ ...provider.state.runs[0], ref: { ...provider.state.runs[0].ref, externalId: 'run-branch' }, branch: 'feature/branch' })
  const all = await provider.listPipelineRuns({ repository, commit: 'sha-1', branch: undefined, cursor: undefined, limit: 100 })
  const main = await provider.listPipelineRuns({ repository, commit: 'sha-1', branch: 'main', cursor: undefined, limit: 100 })
  const feature = await provider.listPipelineRuns({ repository, commit: 'sha-1', branch: 'feature/branch', cursor: undefined, limit: 100 })
  assert.equal(all.ok, true)
  assert.equal(main.ok, true)
  assert.equal(feature.ok, true)
  assert.equal(all.value.items.length, 3, '省略 branch 必须返回同提交的全部运行')
  assert.deepEqual(main.value.items.map((run) => run.ref.externalId), ['run-1', 'run-2'])
  assert.deepEqual(feature.value.items.map((run) => run.ref.externalId), ['run-branch'])
})

test('Delivery 替身：检查按 repository + commit 过滤，别的提交与别的仓库上的检查都不返回', async () => {
  // 种子检查全在 repo-alpha / sha-1 上，共享 suite 的 every(commit === sha-1) 对不过滤的实现也成立；这里放进两条干扰项。
  const provider = createFakeDeliveryProvider({ bindingId })
  const seed = provider.state.checks[0]
  const otherRepository = { ...repository, externalId: 'repo-beta' }
  provider.state.checks.push(
    { ...seed, ref: { ...seed.ref, externalId: 'check-other-commit' }, commit: 'sha-2' },
    { ...seed, ref: { ...seed.ref, externalId: 'check-other-repo' }, repository: otherRepository },
  )
  const idsFor = async (repo, commit) => {
    const result = await provider.listChecks({ repository: repo, commit, cursor: undefined, limit: 100 })
    assert.equal(result.ok, true)
    return result.value.items.map((item) => item.ref.externalId).sort()
  }
  assert.deepEqual(await idsFor(repository, 'sha-1'), ['check-build', 'check-lint', 'check-test'])
  assert.deepEqual(await idsFor(repository, 'sha-2'), ['check-other-commit'])
  assert.deepEqual(await idsFor(otherRepository, 'sha-1'), ['check-other-repo'])
})

test('Delivery 替身：声明的部署与环境读能力返回种子内容，不是空列表', async () => {
  const provider = createFakeDeliveryProvider({ bindingId })
  const deployments = await provider.listDeployments({ repository, cursor: undefined, limit: 100 })
  assert.equal(deployments.ok, true)
  assert.equal(deployments.value.items.length, 2)
  assert.deepEqual(deployments.value.items.map((item) => item.environment).sort(), ['production', 'staging'])
})
