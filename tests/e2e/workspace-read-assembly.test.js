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
import { createController, toWireMetadata, watchWorkspace } from '@harness-projects/controller'
import { createEntityStore, createSync, createTransport } from '@harness-projects/client'
import {
  FaultKind, createFakeExecutionProvider, createFakeProviders, fixtureProjectRef, removeItem,
} from '@harness-projects/provider-fake'

const NAME = 'MVP-0'

async function compose(providers = createFakeProviders(), { project, ...extra } = {}) {
  const id = newWorkspaceId()
  const core = await composeCore({
    workspace: { id, name: NAME, statusPolicy: StatusPolicy.HostAuthoritative, project }, providers, ...extra,
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

const T = (n) => `2026-10-03T10:0${n}:00.000Z`
/** 依次返回给定时间，用完后重复最后一个；读取次数就是 `calls`。 */
const clockOf = (...times) => { let calls = 0; const clock = () => times[Math.min(calls++, times.length - 1)]; clock.calls = () => calls; return clock }

async function client(controller, options = {}) {
  const store = createEntityStore()
  const transport = options.transport ?? createTransport(controller)
  return { store, transport, sync: createSync(transport, store, { clock: clockOf(T(1), T(2), T(3)), ...options.sync }) }
}
/** 真实 baseline + 脚本化的后续事件：用来喂 sync 一些真实 watch 不会产出的非法载体。 */
const scripted = (controller) => ({ events: [], closed: 0, fetchBaseline: () => controller.baseline(), poll() { return Promise.resolve(this.events.shift()) }, close() { this.closed += 1 } })
const shapeOf = (sync) => { const { store, ...rest } = sync.read(); return { ...rest, rows: store.list().map((entry) => [entry, entry.stale, entry.entity]) } }

test('assembler：六个字段全部来自真实生产者；首个已确认 descriptor 前 read 为 undefined', async () => {
  const { id, controller } = await compose()
  const { store, sync } = await client(controller)
  assert.equal(sync.read(), undefined, '连接前没有已确认的工作区')
  await sync.connect()
  const read = sync.read()

  assert.deepEqual(read.workspace, { id, name: NAME })
  assert.equal(read.store, store, 'read 绑定 createSync 的同一个 store')
  assert.deepEqual(read.connection, { connected: true })
  assert.equal(read.lastUpdatedAt, T(1), '时间是注入 clock 的接受时刻')
  assert.equal(capabilityOf(read, 'planning.item.read').access, 'available')
  assert.equal(read.reason, undefined)

  const bare = await composeCore({ workspace: { name: NAME }, providers: { planning: createFakeProviders().planning } })
  const cold = await client(createController(bare))
  await cold.sync.connect()
  assert.equal(cold.sync.read(), undefined, '无 Storage 的 descriptor 未确认，不能凭输入名字伪造')
})

test('空表：真实空集是确认成功并更新时间；degraded 空表保留原因且没有成功时间', async () => {
  const fresh = createFakeProviders()
  for (const item of [...fresh.planning.state.items]) removeItem(fresh.planning.state, item.ref)
  const ok = await client((await compose(fresh, { project: fixtureProjectRef(fresh.planning.bindingId) })).controller)
  await ok.sync.connect()
  assert.deepEqual([ok.store.list().length, ok.sync.read().lastUpdatedAt, ok.sync.read().reason], [0, T(1), undefined])

  const down = await client((await compose(createFakeProviders({ planning: { faults: { offline: true } } }))).controller)
  await down.sync.connect()
  const read = down.sync.read()
  assert.deepEqual([down.store.list().length, read.connection.connected], [0, true])
  assert.equal(read.lastUpdatedAt, undefined, '冷启动 degraded 空表没有成功时间')
  assert.ok(read.reason, '空表的权限 / 来源缺口不能显示成正常空态')
})

test('partial：整表 degraded 带原因，已确认的行仍 fresh 且推进时间', async () => {
  const providers = createFakeProviders()
  const { planning } = providers
  planning.state.items.push({
    ref: { bindingId: planning.bindingId, objectKind: 'project_item', externalId: 'm-orphan', url: undefined },
    project: fixtureProjectRef(planning.bindingId), membership: { externalId: 'm-orphan', createdAt: undefined, updatedAt: undefined },
    content: { kind: 'redacted', reason: 'unavailable' },
    fields: { statusKey: undefined, priority: undefined, assigneeRefs: [], iterationId: undefined, startDate: undefined, targetDate: undefined, customFields: {} },
    sourceVersion: 'v-orphan', sourceUpdatedAt: '2026-09-20T00:00:00Z',
  })
  const { store, sync } = await client((await compose(providers)).controller)
  await sync.connect()
  const read = sync.read()

  assert.ok(read.reason, '整表缺口原因保留，不被 fresh 行洗成正常')
  assert.ok(store.list().length > 0 && store.list().every((entry) => !entry.stale), '本次确认的行保持 fresh')
  assert.equal(read.lastUpdatedAt, T(1), 'partial 帧确有 fresh 行才更新时间')
})

test('断网：poll / reconnect 拒绝后 connected=false，行引用、内容与旧时间保留，reason 是安全散文', async () => {
  const { controller } = await compose()
  let down = false
  const flaky = {
    baseline: () => (down ? Promise.reject(new Error('SECRET-TOKEN stack at /srv')) : controller.baseline()),
    watch: (options) => (down ? { afterRevision: 0, poll: () => Promise.reject(new Error('SECRET-TOKEN stack at /srv')), close() {} } : controller.watch(options)),
  }
  const { store, transport, sync } = await client(controller, { transport: createTransport(flaky) })
  await sync.connect()
  const before = shapeOf(sync)

  down = true
  await assert.rejects(sync.poll(), /SECRET-TOKEN/, '原异常继续抛给调用者')
  const lost = sync.read()
  assert.equal(lost.connection.connected, false)
  assert.ok(lost.reason && !/SECRET|stack|\/srv/.test(lost.reason), 'read.reason 不含原异常内容')
  assert.equal(lost.lastUpdatedAt, T(1), '断网不推进也不清除时间')
  assert.ok(store.list().every((entry, i) => entry === before.rows[i][0] && entry.entity === before.rows[i][2] && entry.stale))
  await assert.rejects(sync.reconnect(), /SECRET-TOKEN/)
  assert.deepEqual([sync.read().connection.connected, sync.read().lastUpdatedAt, store.list().length], [false, T(1), before.rows.length])

  down = false
  assert.equal((await sync.poll()).kind, 'baseline', '断开后 poll 回到基线')
  assert.deepEqual([sync.read().connection.connected, sync.read().reason, sync.read().lastUpdatedAt], [true, undefined, T(2)])
  sync.disconnect()
  assert.deepEqual([sync.read().connection.connected, sync.read().lastUpdatedAt, store.list().every((entry) => entry.stale)], [false, T(2), true])
  assert.ok(transport.close, 'disconnect 走 transport.close')
})

test('metadata：同 revision 降级 / 恢复同时更新整表与每行 source，时间只在恢复确认时推进', async () => {
  const { providers, core, controller } = await compose()
  const { store, sync } = await client(controller)
  await sync.connect()
  const rows = store.list()

  providers.planning.faultsSwitch.set(FaultKind.Offline, true)
  await core.commands.bootstrapWorkspace()
  const down = await sync.poll()
  assert.deepEqual([down.kind, down.revision], ['metadata', rows[0].revision])
  assert.ok(sync.read().reason, '降级原因来自来源')
  assert.ok(store.list().every((entry, i) => entry === rows[i] && entry.stale), '行对象不变、就地 stale')
  assert.equal(sync.read().lastUpdatedAt, T(1), '降级 metadata 不推进时间')
  assert.equal((await sync.poll()).kind, 'idle')

  providers.planning.faultsSwitch.set(FaultKind.Offline, false)
  await cursor(providers, 'healthy', undefined)
  assert.equal((await sync.poll()).kind, 'metadata')
  assert.deepEqual([sync.read().reason, store.list().some((entry) => entry.stale), sync.read().lastUpdatedAt], [undefined, false, T(2)])
})

test('时间：idle 与纯能力 / 名称 metadata 不推进时间', async () => {
  const { controller } = await compose()
  const transport = scripted(controller)
  const { sync } = await client(controller, { transport, sync: { clock: clockOf(T(1), T(2)) } })
  await sync.connect()
  assert.equal((await sync.poll()).kind, 'idle')
  const base = await controller.baseline()
  const next = toWireMetadata({ ...base, workspace: { ...base.workspace, name: 'renamed' }, capabilities: base.capabilities.map((entry) => ({ ...entry, access: 'read_only' })) })
  transport.events.push({ kind: 'metadata', metadata: next })
  assert.equal((await sync.poll()).kind, 'metadata')
  assert.deepEqual([sync.read().workspace.name, sync.read().capabilities[0].access, sync.read().lastUpdatedAt], ['renamed', 'read_only', T(1)])
})

test('接受点：clock 非法、store 拒绝的载体都不推进头 / 能力 / 时间，也不部分更新行', async () => {
  const { controller } = await compose()
  const base = await controller.baseline()
  const row = base.entities[0]
  const degraded = { ...row.source, freshness: 'degraded' }
  const valid = toWireMetadata({ ...base, workspace: { ...base.workspace, name: 'renamed' } })
  const delta = { previousRevision: base.revision, revision: base.revision + 1, upserts: [], removed: [], workspace: valid.workspace, capabilities: base.capabilities, source: { ...base.source, revision: base.revision + 1 } }
  const rowsWith = (change) => valid.entities.map((entry, i) => (i === 0 ? { ...entry, ...change } : entry))
  const cases = [
    ['clock 非法', { kind: 'delta', delta }, clockOf(T(1), 'not-a-time')],
    ['增量含重复实体（fresh 帧，时间本会推进）', { kind: 'delta', delta: { ...delta, upserts: [row, row] } }],
    ['未知实体', { kind: 'metadata', metadata: { ...valid, entities: rowsWith({ source: degraded }).concat({ entityId: 'ghost', source: degraded }) } }],
    ['重复实体', { kind: 'metadata', metadata: { ...valid, entities: rowsWith({ source: degraded }).concat(valid.entities[0]) } }],
    ['缺失实体', { kind: 'metadata', metadata: { ...valid, entities: rowsWith({ source: degraded }).slice(0, -1) } }],
    ['revision 不匹配', { kind: 'metadata', metadata: { ...valid, revision: base.revision + 1 } }],
    ['头 revision 不匹配', { kind: 'metadata', metadata: { ...valid, source: { ...valid.source, revision: base.revision - 1 } } }],
    ['额外业务字段', { kind: 'metadata', metadata: { ...valid, entities: rowsWith({ source: degraded, content: { title: 'x' } }) } }],
  ]
  for (const [label, event, clock] of cases) {
    const transport = scripted(controller)
    const { sync } = await client(controller, { transport, sync: { clock: clock ?? clockOf(T(1), T(2)) } })
    await sync.connect()
    const before = shapeOf(sync)
    transport.events.push(event)
    await assert.rejects(sync.poll(), label)
    const after = sync.read()
    assert.deepEqual([after.workspace, after.capabilities, after.lastUpdatedAt], [before.workspace, before.capabilities, before.lastUpdatedAt], `${label}：头 / 能力 / 时间不变`)
    assert.ok(after.store.list().every((entry, i) => entry === before.rows[i][0] && entry.entity === before.rows[i][2]), `${label}：行内容与来源未被半更新`)
  }
})
