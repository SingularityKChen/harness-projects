/**
 * #178 端到端：工作区读取的真实生产链（composeCore → controller → transport → sync → ui-model）。
 *
 * 全部使用离线替身：无凭据、无网络。最终展示输入一律来自 `sync.read()`，不手写 WorkspaceRead。
 * 用例名说明它保护哪条不变量：六个字段都有真实生产者、同 revision 的来源变化可达、断网保值保时间、
 * 部分成功不洗白整表、单一接受点。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { PLANNING_SYNC_SCOPE, StatusPolicyMode, composeCore } from '@harness-projects/core'
import { createController, watchWorkspace } from '@harness-projects/controller'
import {
  FaultKind, createFakeExecutionProvider, createFakeProviders,
} from '@harness-projects/provider-fake'

const NAME = 'MVP-0'

async function compose(providers = createFakeProviders(), extra = {}) {
  const id = newWorkspaceId()
  const core = await composeCore({
    workspace: { id, name: NAME, statusPolicy: StatusPolicy.HostAuthoritative }, providers, ...extra,
  })
  const workspaceRevision = () => providers.storage.currentRevision(id)
  return { id, providers, core, controller: createController(core, { authority: StatusPolicyMode.HarnessManaged, workspaceRevision }) }
}

const cursor = (providers, state, lastErrorCode) => providers.storage.putSyncCursor({
  bindingId: providers.planning.bindingId, scopeKey: PLANNING_SYNC_SCOPE, cursorValue: undefined, state, lastErrorCode,
})
const capabilityOf = (header, key) => header.capabilities.find((entry) => entry.key === key)

test('producer：baseline 带真实 descriptor、逐 key 能力与整表来源，storage 域不伪造挂载', async () => {
  const { id, controller } = await compose()
  const snapshot = await controller.baseline()

  assert.deepEqual(snapshot.workspace, { id, name: NAME })
  assert.deepEqual(capabilityOf(snapshot, 'planning.item.read'), { key: 'planning.item.read', access: 'available', reason: undefined })
  assert.equal(capabilityOf(snapshot, 'planning.item.content.write').access, 'unavailable', '没有挂载提供者的 key 明确 unavailable')
  assert.equal(snapshot.capabilities.some((entry) => entry.key.startsWith('storage.')), false, 'storage 域没有挂载，不报告它')
  assert.equal(new Set(snapshot.capabilities.map((entry) => entry.key)).size, snapshot.capabilities.length, '每个 key 恰好一条')
  for (const entry of snapshot.capabilities) assert.deepEqual(Object.keys(entry).sort(), ['access', 'key', 'reason'], '不暴露 binding / 凭据')
  assert.equal(snapshot.source.freshness, 'fresh')
})

test('producer：能力只取路由到的唯一挂载，备用声明了也不覆盖主目标', async () => {
  const providers = createFakeProviders({ execution: { capabilities: { cancel: false } } })
  const executionFallback = createFakeExecutionProvider({ capabilities: { cancel: true } })
  const { controller } = await compose(providers, { providers: { ...providers, executionFallback } })
  const snapshot = await controller.baseline()

  assert.equal(capabilityOf(snapshot, 'execution.run.cancel').access, 'unavailable', '主挂载不声明 cancel，备用不得顶替')
  assert.equal(capabilityOf(snapshot, 'execution.run.start').access, 'available')
})

test('producer：没有 Storage 的 core 不伪造 descriptor，来源是 degraded', async () => {
  const providers = createFakeProviders()
  const core = await composeCore({ workspace: { name: NAME }, providers: { planning: providers.planning } })
  const snapshot = await createController(core).baseline()

  assert.equal(snapshot.workspace, undefined)
  assert.deepEqual(snapshot.capabilities, [])
  assert.equal(snapshot.source.freshness, 'degraded')
  assert.ok(snapshot.source.reason, '降级必有原因')
})

test('metadata：同 revision 的来源降级与恢复各发一个窄事件，业务 revision 与内容不变，重复 poll idle', async () => {
  const { providers, core, controller } = await compose()
  const base = await controller.baseline()
  const watch = controller.watch({ afterRevision: base.revision, seed: base })
  assert.equal(await watch.poll(), undefined, '什么都没变是 idle')

  providers.planning.faultsSwitch.set(FaultKind.Offline, true)
  await core.commands.bootstrapWorkspace()
  const down = await watch.poll()
  assert.equal(down.kind, 'metadata', '降级不能被 same-revision 分支吞掉')
  assert.equal(down.metadata.revision, base.revision, '来源变化不得伪造业务 revision')
  assert.equal(down.metadata.source.freshness, 'degraded')
  assert.equal(watch.afterRevision, base.revision)
  assert.equal(down.metadata.entities.length, base.entities.length)
  for (const row of down.metadata.entities) {
    assert.deepEqual(Object.keys(row).sort(), ['entityId', 'source'], '只带行来源，不带 content / status')
    assert.equal(row.source.freshness, 'degraded')
    assert.equal(row.source.revision, base.revision, '逐行 source.revision 原样保留')
  }
  assert.equal(await watch.poll(), undefined, '完全相同内容 idle')

  providers.planning.faultsSwitch.set(FaultKind.Offline, false)
  await cursor(providers, 'healthy', undefined)
  const up = await watch.poll()
  assert.equal(up.kind, 'metadata')
  assert.deepEqual([up.metadata.revision, up.metadata.source.freshness], [base.revision, 'fresh'])
  assert.ok(up.metadata.entities.every((row) => row.source.freshness === 'fresh'))
  assert.equal(await watch.poll(), undefined)
})

test('metadata：规范化比较（能力顺序不同仍 idle）；纯能力 / descriptor 变化发 metadata；业务变化 fail closed 为 gap', async () => {
  const { controller } = await compose()
  const base = await controller.baseline()
  const variant = (change) => {
    const next = structuredClone(base)
    change(next)
    const source = { baseline: async () => next }
    return watchWorkspace(source, { afterRevision: base.revision, seed: base }).poll()
  }

  assert.equal(await variant((next) => next.capabilities.reverse()), undefined, '能力按 key 规范化，顺序不是变化')
  const renamed = await variant((next) => { next.workspace = { ...next.workspace, name: 'renamed' } })
  assert.deepEqual([renamed.kind, renamed.metadata.workspace.name, renamed.metadata.revision], ['metadata', 'renamed', base.revision])
  const lost = await variant((next) => { capabilityOf(next, 'planning.item.read').access = 'unavailable' })
  assert.equal(lost.kind, 'metadata', '纯能力变化也发 metadata')

  const retitled = await variant((next) => { next.entities[0].content.title = 'changed' })
  assert.equal(retitled.kind, 'gap', '同 revision 的业务变化不能借 metadata 悄悄生效')
  const dropped = await variant((next) => { next.entities.pop() })
  assert.equal(dropped.kind, 'gap', '同 revision 的实体集合变化同样 fail closed')
})
