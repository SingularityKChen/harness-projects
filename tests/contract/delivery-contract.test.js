/**
 * 离线 Delivery 替身的契约套件装配，外加两条判别性用例。判别性用例保护的不变量：只读交付面不声明写
 * 能力（调用方从快照就看到 unavailable），而声明的可选部署读能力必须真的能读到环境。把写操作改成
 * 静默成功后，"写尝试返回 not_supported 且不改动任何状态"用例必然失败。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { CapabilityKey, effectiveCapabilities } from '@harness-projects/capabilities'
import { createFakeDeliveryProvider } from '@harness-projects/provider-fake'
import { deliveryContractSuite } from './suites/delivery.js'

const bindingId = 'binding-fake-delivery'
const repository = { bindingId, objectKind: 'repository', externalId: 'repo-alpha', url: undefined }
const changeRequest = { bindingId, objectKind: 'change_request', externalId: 'pr-1', url: undefined }

deliveryContractSuite({
  label: '离线 Delivery 替身',
  makeProvider: (scenario = {}) => createFakeDeliveryProvider({ bindingId, ...scenario }),
  expect: {
    repository, commit: 'sha-1', changeRequest, pageSize: 1,
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

test('Delivery 替身：声明的部署与环境读能力返回种子内容，不是空列表', async () => {
  const provider = createFakeDeliveryProvider({ bindingId })
  const deployments = await provider.listDeployments({ repository, cursor: undefined, limit: 100 })
  assert.equal(deployments.ok, true)
  assert.equal(deployments.value.items.length, 2)
  assert.deepEqual(deployments.value.items.map((item) => item.environment).sort(), ['production', 'staging'])
})
