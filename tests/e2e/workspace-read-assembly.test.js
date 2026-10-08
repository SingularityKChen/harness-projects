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
import { StatusPolicyMode, composeCore } from '@harness-projects/core'
import { createController, toWireMetadata, watchWorkspace } from '@harness-projects/controller'
import * as capabilities from '@harness-projects/capabilities'
import { createEntityStore, createSync, createTransport } from '@harness-projects/client'
import { CapabilityKey, intersectAccess } from '@harness-projects/client/keys'
import { deriveWorkItemList, deriveWorkItemListView } from '@harness-projects/ui-model'
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

const capabilityOf = (header, key) => header.capabilities.find((entry) => entry.key === key)
const viewOf = (read) => deriveWorkItemListView({ read, metadata: { sourceNames: {} }, phase: 'received', refreshing: false })
const itemRows = (read) => viewOf(read).body.rows.filter((row) => row.kind === 'item')

test('producer：baseline 带真实 descriptor、逐 key 能力与整表来源，storage 域不伪造挂载', async () => {
  const { id, controller } = await compose()
  const snapshot = await controller.baseline()

  assert.deepEqual(snapshot.workspace, { id, name: NAME })
  assert.deepEqual(capabilityOf(snapshot, 'planning.item.read'), { key: 'planning.item.read', access: 'available', reason: undefined })
  assert.equal(capabilityOf(snapshot, 'planning.item.content.write').access, 'unavailable', '没有挂载提供者的 key 明确 unavailable')
  assert.match(capabilityOf(snapshot, 'planning.item.content.write').reason, /content\.write/, '不可用能力的原因经 wire 原样到达')
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
  await core.commands.bootstrapWorkspace()
  const up = await watch.poll()
  assert.equal(up.kind, 'metadata')
  assert.deepEqual([up.metadata.revision, up.metadata.source.freshness], [base.revision, 'fresh'])
  assert.ok(up.metadata.entities.every((row) => row.source.freshness === 'fresh'))
  assert.equal(await watch.poll(), undefined)
})

const tone = (source, fresh, reason) => ({ ...source, freshness: fresh ? 'fresh' : 'degraded', ...(reason === undefined ? {} : { reason }) })
/** 用改过的 baseline 喂 watch，返回第一次 poll 的结果。 */
const variantOf = (base) => (change) => {
  const next = structuredClone(base)
  change(next)
  return watchWorkspace({ baseline: async () => next }, { afterRevision: base.revision, seed: base }).poll()
}

test('metadata：规范化比较（能力顺序不同仍 idle）；纯能力 / descriptor 变化发 metadata；业务变化 fail closed 为 gap', async () => {
  const { controller } = await compose()
  const base = await controller.baseline()
  const variant = variantOf(base)

  assert.equal(await variant((next) => next.capabilities.reverse()), undefined, '能力按 key 规范化，顺序不是变化')
  const rowOnly = await variant((next) => { next.entities[0].source = tone(next.entities[0].source, false) })
  assert.deepEqual([rowOnly.kind, rowOnly.metadata.entities[0].source.freshness, rowOnly.metadata.source.freshness], ['metadata', 'degraded', 'fresh'], '只有一行 source 变化也发 metadata')
  const headOnly = await variant((next) => { next.source = { ...next.source, reason: '仅整表原因变化' } })
  assert.deepEqual([headOnly.kind, headOnly.metadata.source.reason], ['metadata', '仅整表原因变化'], '只有整表 reason 变化也发 metadata')
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
/** 依次返回给定时间，用完后重复最后一个。 */
const clockOf = (...times) => { let calls = 0; return () => times[Math.min(calls++, times.length - 1)] }

async function client(controller, options = {}) {
  const store = createEntityStore()
  const transport = options.transport ?? createTransport(controller)
  return { store, transport, sync: createSync(transport, store, { clock: clockOf(T(1), T(2), T(3)), ...options.sync }) }
}
/** 真实 baseline + 脚本化的后续事件：用来喂 sync 一些真实 watch 不会产出的非法载体。 */
const scripted = (controller) => ({ events: [], closed: 0, fetchBaseline: () => controller.baseline(), poll() { return Promise.resolve(this.events.shift()) }, close() { this.closed += 1 } })
const shapeOf = (sync) => { const { store, ...rest } = sync.read(); return { ...rest, revision: store.revision, rows: store.list().map((entry) => [entry, entry.entity]) } }

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
  const shown = deriveWorkItemList(read)
  assert.deepEqual([shown.rows, shown.stale, shown.connection, shown.lastUpdatedAt], [[], true, 'degraded', undefined])
})

/** 一条既无内容身份也无成员映射的条目：bootstrap 提交可锚定的行，但整表带 permission_denied 缺口（partial）。 */
function partialProviders() {
  const providers = createFakeProviders()
  const { planning } = providers
  planning.state.items.push({
    ref: { bindingId: planning.bindingId, objectKind: 'project_item', externalId: 'm-orphan', url: undefined },
    project: fixtureProjectRef(planning.bindingId), membership: { externalId: 'm-orphan', createdAt: undefined, updatedAt: undefined },
    content: { kind: 'redacted', reason: 'unavailable' },
    fields: { statusKey: undefined, priority: undefined, assigneeRefs: [], iterationId: undefined, startDate: undefined, targetDate: undefined, customFields: {} },
    sourceVersion: 'v-orphan', sourceUpdatedAt: '2026-09-20T00:00:00Z',
  })
  return providers
}

test('partial：整表 degraded 带原因并推进时间；已确认行经 view 保持 fresh、整表仍降级；断网后全部 stale', async () => {
  const { store, sync } = await client((await compose(partialProviders())).controller)
  await sync.connect()
  assert.ok(sync.read().reason, '整表缺口原因保留，不被 fresh 行洗成正常')
  assert.ok(store.list().length > 0 && store.list().every((entry) => !entry.stale), '本次确认的行保持 fresh')
  assert.equal(sync.read().lastUpdatedAt, T(1), 'partial 帧确有 fresh 行才更新时间')
  const shown = viewOf(sync.read())
  assert.ok(shown.body.stale && /尚未确认/.test(shown.statusText), '整表仍显示为降级')
  assert.ok(itemRows(sync.read()).length > 0 && itemRows(sync.read()).every((row) => row.stale === false), '已确认的行不被整表原因洗成 stale')
  sync.disconnect()
  assert.ok(itemRows(sync.read()).every((row) => row.stale))
})

test('断网：poll / reconnect 拒绝后 connected=false，行引用、内容与旧时间保留，reason 是安全散文', async () => {
  const { controller } = await compose()
  let down = false
  const flaky = {
    baseline: () => (down ? Promise.reject(new Error('SECRET-TOKEN stack at /srv')) : controller.baseline()),
    watch: (options) => (down ? { afterRevision: 0, poll: () => Promise.reject(new Error('SECRET-TOKEN stack at /srv')), close() {} } : controller.watch(options)),
  }
  const { store, sync } = await client(controller, { transport: createTransport(flaky) })
  await sync.connect()
  const before = shapeOf(sync)

  down = true
  await assert.rejects(sync.poll(), /SECRET-TOKEN/, '原异常继续抛给调用者')
  const lost = sync.read()
  assert.equal(lost.connection.connected, false)
  assert.ok(lost.reason && !/SECRET|stack|\/srv/.test(lost.reason), 'read.reason 不含原异常内容')
  assert.equal(lost.lastUpdatedAt, T(1), '断网不推进也不清除时间')
  assert.ok(store.list().every((entry, i) => entry === before.rows[i][0] && entry.entity === before.rows[i][1] && entry.stale))
  await assert.rejects(sync.reconnect(), /SECRET-TOKEN/)
  assert.deepEqual([sync.read().connection.connected, sync.read().lastUpdatedAt, store.list().length], [false, T(1), before.rows.length])

  down = false
  assert.equal((await sync.poll()).kind, 'baseline', '断开后 poll 回到基线')
  assert.deepEqual([sync.read().connection.connected, sync.read().reason, sync.read().lastUpdatedAt], [true, undefined, T(2)])
  sync.disconnect()
  assert.deepEqual([sync.read().connection.connected, sync.read().lastUpdatedAt, store.list().every((entry) => entry.stale)], [false, T(2), true])
})

const hiddenStale = (read) => deriveWorkItemList(read).rows.filter((row) => row.contentKind === 'redacted').map((row) => row.freshness.stale)
test('metadata：同 revision 降级 / 恢复同时更新整表与每行 source（含 Fake 唯一的 redacted 条目），时间只在恢复确认时推进', async () => {
  const { providers, core, controller } = await compose()
  const { store, sync } = await client(controller)
  await sync.connect()
  const rows = store.list()

  providers.planning.faultsSwitch.set(FaultKind.Offline, true)
  await core.commands.bootstrapWorkspace()
  const down = await sync.poll()
  assert.deepEqual([down.kind, down.revision], ['metadata', rows[0].revision])
  assert.ok(sync.read().reason, '降级原因来自来源')
  assert.deepEqual(hiddenStale(sync.read()), [true], 'redacted 条目跟随工作区级降级，没有自己的 fresh（决策 E，#178 评论）')
  assert.ok(store.list().every((entry, i) => entry === rows[i] && entry.stale), '行对象不变、就地 stale')
  assert.ok(itemRows(sync.read()).length > 0 && itemRows(sync.read()).every((row) => row.stale), '同 revision 降级经 view 让所有行 stale')
  assert.equal(sync.read().lastUpdatedAt, T(1), '降级 metadata 不推进时间')
  assert.equal((await sync.poll()).kind, 'idle')

  providers.planning.faultsSwitch.set(FaultKind.Offline, false)
  await core.commands.bootstrapWorkspace()
  assert.equal((await sync.poll()).kind, 'metadata')
  assert.deepEqual(hiddenStale(sync.read()), [false], 'redacted 条目随工作区级同步恢复回到 fresh（决策 E）')
  assert.deepEqual([sync.read().reason, store.list().some((entry) => entry.stale), sync.read().lastUpdatedAt], [undefined, false, T(2)])
  assert.ok(itemRows(sync.read()).every((row) => !row.stale), '来源恢复后行回到 fresh')

  await core.commands.bootstrapWorkspace()
  assert.deepEqual([(await sync.poll()).kind, sync.revision, sync.read().lastUpdatedAt], ['idle', rows[0].revision, T(2)], '内容不变的成功刷新不产生帧，也不推进 lastUpdatedAt（#220 决定）')
})

/** 同 revision 的 metadata：整表 fresh 与否、第 i 行 fresh 与否各自指定。 */
const metaOf = (base, headFresh, rowFresh) => ({
  ...toWireMetadata(base), source: tone(base.source, headFresh),
  entities: base.entities.map(({ entityId, source }, i) => ({ entityId, source: tone(source, rowFresh(i)) })),
})

test('metadata：整表 fresh 而一行 degraded 时，只有这一行 stale 且 entity.source 随载体写回，时间不动', async () => {
  const { controller } = await compose()
  const transport = scripted(controller)
  const { store, sync } = await client(controller, { transport })
  await sync.connect()
  const base = await controller.baseline()
  assert.ok(store.list().length > 1)
  transport.events.push({ kind: 'metadata', metadata: metaOf(base, true, (i) => i !== 0) })
  await sync.poll()

  assert.deepEqual(store.list().map((entry) => entry.stale), store.list().map((_, i) => i === 0))
  assert.deepEqual(store.list().map((entry) => entry.entity.source.freshness), store.list().map((_, i) => (i === 0 ? 'degraded' : 'fresh')))
  assert.equal(sync.read().lastUpdatedAt, T(1), '没有任何恢复，时间不动')
})

test('metadata：整表恢复、或仅一行恢复，各自单独推进时间（恢复判定的两半）', async () => {
  const { controller } = await compose()
  const base = await controller.baseline()
  for (const [label, headFresh, rowFresh] of [['仅整表恢复', true, () => false], ['仅一行恢复', false, (i) => i === 0]]) {
    const transport = scripted(controller)
    const { sync } = await client(controller, { transport })
    await sync.connect()
    transport.events.push({ kind: 'metadata', metadata: metaOf(base, false, () => false) }, { kind: 'metadata', metadata: metaOf(base, headFresh, rowFresh) })
    await sync.poll()
    assert.equal(sync.read().lastUpdatedAt, T(1), `${label}：先降级，时间不动`)
    await sync.poll()
    assert.equal(sync.read().lastUpdatedAt, T(2), `${label}：恢复推进时间`)
  }
})

test('连接生命周期：reconnect 在基线返回前行已 stale；reason 断网优先、degraded 无原因给中性解释；disconnect 关闭传输', async () => {
  const { controller } = await compose()
  const base = await controller.baseline()
  const transport = scripted(controller)
  const { store, sync } = await client(controller, { transport })
  await sync.connect()
  let release
  transport.fetchBaseline = () => new Promise((resolve) => { release = resolve })
  const pending = sync.reconnect()
  assert.ok(store.list().every((entry) => entry.stale), '重连开始即标 stale，基线未到之前没有"当前值"')
  release(base)
  await pending

  const degradedHead = (reason) => ({ ...metaOf(base, false, () => true), source: tone(base.source, false, reason) })
  transport.events.push({ kind: 'metadata', metadata: degradedHead(undefined) }, { kind: 'metadata', metadata: degradedHead('来源说') })
  await sync.poll()
  const neutral = sync.read().reason
  assert.equal(typeof neutral, 'string', '无原因的 degraded 也有解释')
  await sync.poll()
  assert.equal(sync.read().reason, '来源说', '连接中显示来源原因')
  sync.disconnect()
  assert.match(sync.read().reason, /断开/, '断网时来源原因让位')
  assert.notEqual(sync.read().reason, neutral)
  assert.equal(transport.closed, 1, 'disconnect 关闭 transport')
})

test('时间与头：idle 与纯能力 / 名称 metadata 不推进时间；partial 增量有 fresh 行才推进；头整帧替换', async () => {
  const { controller } = await compose()
  const transport = scripted(controller)
  const { store, sync } = await client(controller, { transport, sync: { clock: clockOf(T(1), T(2)) } })
  await sync.connect()
  assert.equal((await sync.poll()).kind, 'idle')
  const base = await controller.baseline()
  const next = toWireMetadata({ ...base, workspace: { ...base.workspace, name: 'renamed' }, capabilities: base.capabilities.map((entry) => ({ ...entry, access: 'read_only' })) })
  transport.events.push({ kind: 'metadata', metadata: next })
  assert.equal((await sync.poll()).kind, 'metadata')
  assert.deepEqual([sync.read().workspace.name, sync.read().capabilities[0].access, sync.read().lastUpdatedAt], ['renamed', 'read_only', T(1)])

  const revision = base.revision + 1
  transport.events.push({ kind: 'delta', delta: { previousRevision: base.revision, revision, upserts: [base.entities[0]], removed: [], workspace: base.workspace, capabilities: base.capabilities, source: { ...tone(base.source, false, '部分缺口'), revision } } })
  assert.equal((await sync.poll()).kind, 'delta')
  assert.deepEqual([sync.read().lastUpdatedAt, sync.read().reason, store.isCurrent(base.entities[0].entityId)], [T(2), '部分缺口', true], '整表 degraded 但确有 fresh 行：推进时间、保留原因')

  transport.events.push({ kind: 'metadata', metadata: { ...toWireMetadata({ ...base, revision, source: { ...base.source, revision } }), workspace: undefined } })
  assert.equal((await sync.poll()).kind, 'metadata')
  assert.equal(sync.read(), undefined, '头随接受的帧整体替换：宿主不再确认 descriptor 时不沿用旧值')
})

test('接受点：clock 非法、store 拒绝的载体都不推进头 / 能力 / 时间 / store 修订，也不部分更新行', async () => {
  const { controller } = await compose()
  const base = await controller.baseline()
  const row = base.entities[0]
  const degraded = { ...row.source, freshness: 'degraded' }
  const valid = toWireMetadata({ ...base, workspace: { ...base.workspace, name: 'renamed' } })
  const delta = { previousRevision: base.revision, revision: base.revision + 1, upserts: [], removed: [], workspace: valid.workspace, capabilities: base.capabilities, source: { ...base.source, revision: base.revision + 1 } }
  const rowsWith = (change) => valid.entities.map((entry, i) => (i === 0 ? { ...entry, ...change } : entry))
  const cases = [
    ['clock 非法（带一条改过标题的 upsert：先 apply 后读时钟会先写 store）', { kind: 'delta', delta: { ...delta, upserts: [{ ...row, content: { ...row.content, title: 'retitled' } }] } }, clockOf(T(1), 'not-a-time')],
    ['增量含重复实体（fresh 帧，时间本会推进）', { kind: 'delta', delta: { ...delta, upserts: [row, row] } }],
    ['增量后序实体缺 source（前序行本会先被写）', { kind: 'delta', delta: { ...delta, upserts: [row, { ...row, entityId: 'ghost', source: undefined }] } }],
    ['增量 removed 不是数组（upserts 本会先被写）', { kind: 'delta', delta: { ...delta, upserts: [row], removed: null } }],
    ['未知实体', { kind: 'metadata', metadata: { ...valid, entities: rowsWith({ source: degraded }).concat({ entityId: 'ghost', source: degraded }) } }],
    ['重复实体', { kind: 'metadata', metadata: { ...valid, entities: rowsWith({ source: degraded }).concat(valid.entities[0]) } }],
    ['缺失实体', { kind: 'metadata', metadata: { ...valid, entities: rowsWith({ source: degraded }).slice(0, -1) } }],
    ['revision 不匹配', { kind: 'metadata', metadata: { ...valid, revision: base.revision + 1 } }],
    ['自洽的 revision+1（头 source.revision 同步）', { kind: 'metadata', metadata: { ...valid, revision: base.revision + 1, source: { ...valid.source, revision: base.revision + 1 }, entities: rowsWith({ source: degraded }) } }],
    ['capabilities 为 null', { kind: 'metadata', metadata: { ...valid, capabilities: null } }],
    ['workspace id 为空', { kind: 'metadata', metadata: { ...valid, workspace: { id: '', name: 'x' } } }],
    ['workspace 不是对象', { kind: 'metadata', metadata: { ...valid, workspace: 'x' } }],
    ['头 revision 不匹配', { kind: 'metadata', metadata: { ...valid, source: { ...valid.source, revision: base.revision - 1 } } }],
    ['顶层额外业务字段', { kind: 'metadata', metadata: { ...valid, entities: rowsWith({ source: degraded }), entityTitles: ['x'] } }],
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
    assert.deepEqual([after.workspace, after.capabilities, after.lastUpdatedAt, after.store.revision], [before.workspace, before.capabilities, before.lastUpdatedAt, before.revision], `${label}：头 / 能力 / 时间 / store 修订不变`)
    assert.ok(after.store.list().every((entry, i) => entry === before.rows[i][0] && entry.entity === before.rows[i][1]), `${label}：行内容与来源未被半更新`)
  }
})

test('单真源：ui-model 所取的 client/keys 叶子与 capabilities 是同一对象（经 controller/keys 重导出）', () => {
  assert.equal(CapabilityKey, capabilities.CapabilityKey)
  assert.equal(intersectAccess, capabilities.intersectAccess)
})

test('端到端：sync.read 直达 derive / view；断网保行并整体 stale，恢复后回到当前', async () => {
  const { controller } = await compose()
  const { sync } = await client(controller)
  await sync.connect()
  const live = deriveWorkItemList(sync.read())
  assert.deepEqual([live.connection, live.stale, live.lastUpdatedAt], ['connected', false, T(1)])
  assert.ok(live.rows.length > 0 && live.rows.every((row) => !row.freshness.stale))
  assert.ok(live.rows.some((row) => row.actions.some((action) => action.available)), '真实 key 经 intersectAccess 求得可用动作')
  assert.ok(itemRows(sync.read()).every((row) => !row.stale))

  sync.disconnect()
  const lost = deriveWorkItemList(sync.read())
  assert.deepEqual([lost.connection, lost.rows.length, lost.lastUpdatedAt], ['disconnected', live.rows.length, T(1)])
  assert.ok(lost.rows.every((row) => row.freshness.stale) && itemRows(sync.read()).every((row) => row.stale))

  await sync.poll()
  assert.ok(itemRows(sync.read()).every((row) => !row.stale), '重新拉基线后回到当前值')
})
