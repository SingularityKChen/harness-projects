/**
 * #199 / #220 集成层：同步一轮的三种结局（提交且内容变化、提交但内容不变、未提交）在两个 Storage 上的可观察形态。
 * 未提交包括 provider 结构化失败与任何异常（Storage 拒绝观察、provider 抛出任何值、观察流中途抛出）：命令返回结构化失败、
 * 游标 degraded 带错误码、读侧标陈旧、修订号与对账时刻不动、客户端的 lastUpdatedAt 不前进，原异常文字不外发；
 * 原异常只经宿主的诊断钩子 `diagnostics.syncRoundFailed` 交给宿主，钩子自身失败不改变结果（TD-030）。
 * 变化判定不依赖端口没有承诺的行序与键序（ADR-0012 第 2 条）。
 * 全部离线替身，SQLite 用 `:memory:`。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspect } from 'node:util'
import vm from 'node:vm'

import { ContentKind, RedactionReason, StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { sourceVersionFromTimestamp } from '@harness-projects/capabilities'
import { PLANNING_SYNC_SCOPE, composeCore } from '@harness-projects/core'
import { createController } from '@harness-projects/controller'
import { createEntityStore, createSync, createTransport } from '@harness-projects/client'
import { FaultKind, createFakeProviders, createFakeStorage, exportFakeStorageState, fixtureProjectRef, removeItem } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

const STORAGES = [['内存替身', () => createFakeStorage()], ['SQLite', () => createSqliteStorage(':memory:')]]
const T = (n) => `2026-10-08T00:00:0${n}.000Z`
const clockOf = (...times) => { let calls = 0; return () => times[Math.min(calls++, times.length - 1)] }

/** 绕过 `emitObservation` 的入口校验，让 provider 交出一条非规范版本的观察：它一路到达 `recordObservation`，被 Storage 拒绝。 */
const poison = (planning) => planning.state.observations.push({ ...planning.state.observations[0], dedupeKey: 'poison-1', sourceVersion: 'vé' })
const heal = (planning) => { planning.state.observations = planning.state.observations.filter((observation) => observation.dedupeKey !== 'poison-1') }

async function setup(storage, { clock = clockOf(T(1), T(2), T(3)), workspace = {}, diagnostics } = {}) {
  const providers = createFakeProviders()
  const id = newWorkspaceId()
  const open = () => composeCore({ workspace: { id, name: 'sync-round', ...workspace }, providers, storage, clock, diagnostics })
  const cursor = () => storage.getSyncCursor(id, providers.planning.bindingId, PLANNING_SYNC_SCOPE)
  return { id, providers, storage, open, cursor, revision: () => storage.currentRevision(id), reconciled: async () => (await storage.getReconcileCursor(id))?.lastReconciledAt }
}

const SECRET = 'credential-material-never-forwarded'
const rowRevisions = async (world) => (await world.storage.listPlanningProjections(world.id)).map((row) => `${row.entityId}@${row.revision}`).sort()
/** 每行的实体、行修订号与标题：行内容与行修订号必须一起前进或一起回滚。 */
const rowStates = async (world) => (await world.storage.listPlanningProjections(world.id)).map((row) => `${row.entityId}@${row.revision}:${row.content.title}`).sort()
const viewOf = async (core, externalId) => (await core.queries.listPlanningItems()).find((view) => view.content.identity.externalId === externalId)
/** 一轮同步会新增行的四张表：端口对它们没有计数读，替身读导出状态，SQLite（`:memory:`）只能读内部句柄。 */
const COUNTED = { entities: 'entity', identities: 'external_identity', memberships: 'project_item_membership', observations: 'sync_observation' }
const countsOf = (storage) => Object.fromEntries(Object.entries(COUNTED).map(([key, table]) => [key, storage.db === undefined
  ? exportFakeStorageState(storage)[key].length
  : storage.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]))

/**
 * 命令结果整体不含原异常文字。只查 `error.message` 不够：把原异常挂到别的字段（`cause`、展开的 `detail`）照样经 controller 发给 client。
 * `JSON.stringify` 看得到字符串与普通对象，看不到 Error 对象（序列化成 `{}`）；`util.inspect(showHidden)` 看得到 Error 的 message、stack 与 cause。两个都查。
 */
function assertNoLeak(value, forbidden, label) {
  assert.doesNotMatch(JSON.stringify(value), forbidden, `${label}：序列化不含原文`)
  assert.doesNotMatch(inspect(value, { depth: null, showHidden: true }), forbidden, `${label}：inspect 不含原文（含不可枚举的 message、stack、cause）`)
}

let commandSeq = 0
/**
 * 一轮未提交的统一判据：命令 resolve 成结构化失败、游标 degraded + unavailable、读侧每行陈旧、修订号与对账时刻不动。
 * 命令经 controller 发出（一轮同步只跑一次）：core 的结果（`value`）与 controller 的 `CommandResult` 两层都在判据里。
 * 异常触发的一轮另给 `forbidden`：文案非空，且两层结果的任何字段、任何深度都不含原异常文字；provider 结构化失败的文案本来就是 provider 给的，不查。
 */
async function assertRoundFailed(world, core, forbidden, label) {
  const [revision, reconciled, ids] = [await world.revision(), await world.reconciled(), (await core.queries.listPlanningItems()).map((view) => view.entityId)]
  const controller = createController(core, { workspaceRevision: world.revision })
  const sent = await controller.commands.bootstrapWorkspace({ actorRef: { kind: 'test' }, idempotencyKey: `round-${commandSeq++}` })
  const result = sent.value
  assert.deepEqual([result.ok, result.degraded, result.error?.code, result.revision], [false, true, 'unavailable', revision], `${label}：必须是结构化失败，不是裸异常`)
  assert.deepEqual([sent.writeState, sent.authoritative, sent.error], ['failed', false, result.error], `${label}：controller 的 CommandResult 只带同一个结构化错误`)
  if (forbidden !== undefined) {
    assertNoLeak(result, forbidden, `${label}（core 结果）`)
    assertNoLeak(sent, forbidden, `${label}（controller CommandResult）`)
    assert.ok(result.error.message.trim().length > 0, `${label}：固定安全文案不得是空串（命令结果会经 controller 发给 client）`)
  }
  const cursor = await world.cursor()
  assert.deepEqual([cursor.state, cursor.lastErrorCode], ['degraded', 'unavailable'], `${label}：游标 degraded 带错误码`)
  assert.deepEqual(await core.queries.getPlanningSync(), { degraded: true, stale: true, reason: 'unavailable' }, `${label}：读侧陈旧`)
  const after = await core.queries.listPlanningItems()
  assert.deepEqual(after.map((view) => view.entityId), ids, `${label}：最后已知值保留`)
  assert.ok(after.every((view) => view.freshness.degraded), `${label}：每一行都标陈旧`)
  assert.deepEqual([await world.revision(), await world.reconciled()], [revision, reconciled], `${label}：未提交的一轮不推进修订号、不记对账时刻`)
  return result.error.message
}

/**
 * 事务边界的注入：把 Storage 包成「指定方法在 tx 级与根级都拒绝」的代理（`arm` 之前原样放行，`applies` 可按参数筛选）。
 * 两级必须同时拒绝：只拒绝 tx 级，把这笔写入挪到事务之外（提交之后用根句柄写）的实现会从根级溜走，反之亦然。
 * 方法 bind 到被代理对象，避开私有字段的 TypeError；`transaction` 把交给回调的 tx 也包一层。
 */
function rejecting(storage, method, applies = () => true) {
  const gate = { armed: false }
  const wrap = (target) => new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key)
      if (typeof value !== 'function') return value
      if (key === method) return (...args) => (gate.armed && applies(...args) ? Promise.reject(new Error(SECRET)) : value.apply(object, args))
      if (key === 'transaction') return (work) => value.call(object, (tx) => work(wrap(tx)))
      return value.bind(object)
    },
  })
  return { storage: wrap(storage), arm: () => { gate.armed = true }, disarm: () => { gate.armed = false } }
}

/** 一轮提交里「必须与内容写入同生共死」的三笔写入（ADR-0012 第 2、3 条）：推进修订号、healthy 游标、对账时刻。降级游标不在其中：失败路径要能写它。 */
const COMMIT_WRITES = [
  ['advanceRevision', undefined],
  ['putSyncCursor', (record) => record.state === 'healthy'],
  ['putReconcileCursor', undefined],
]

/** provider 的各个读取阶段抛出任何值（编程错误、字符串、普通对象、观察流中途）：整轮 catch 必须全部接住，不能收窄成某一种异常或只包提交。 */
const THROWS = [
  ['listPlanningItems 抛带秘密文字的 TypeError（编程错误）', 'listPlanningItems', new TypeError(`request failed, token ${SECRET}`)],
  ['listPlanningItems 抛字符串（非 Error 值）', 'listPlanningItems', SECRET],
  ['getProject 抛带 message 的普通对象', 'getProject', { message: SECRET }],
  ['reconcile 观察流中途抛 TypeError', 'reconcile', new TypeError(SECRET)],
]
const throwing = (method, thrown) => (method === 'reconcile' ? async function* () { throw thrown } : async () => { throw thrown })

const HUNG = Symbol('hung')
/** 在期限内 settle 就返回结果，否则返回 HUNG（不让挂起的命令挂住整个测试）；计时器总是清掉，免得拖住事件循环。 */
async function settlesWithin(promise, ms = 1000) {
  let timer
  const hung = new Promise((resolve) => { timer = setTimeout(resolve, ms, HUNG) })
  try { return await Promise.race([promise, hung]) } finally { clearTimeout(timer) }
}

/** 宿主诊断钩子的探针：记录每次收到的原异常（同一个对象，不是副本）；`result` 给出钩子的返回值，缺省什么都不返回。 */
const hostDiagnostics = (result) => {
  const seen = []
  return { seen, diagnostics: { syncRoundFailed: (error) => { seen.push(error); return result?.() } } }
}

/**
 * 端口对 `listPlanningProjections` 的返回顺序与对象键序都没有承诺（调用方不得依赖）。这个代理在每个事务内把第 1、3、5…次读回
 * 按 `mode` 打乱：`rows` 倒序整张表，`keys` 递归倒序每个对象的键序；事务内的第 0、2、4…次原样返回。
 * 变化判定读事务前与事务后各一次，所以两次读回恰好一次原样、一次打乱——这是端口允许的行为，相同输入的引导不得因此推进修订号。
 * `pairs` 记下每一对（原样，打乱）：用例据此断言代理确实改变了序列化形态，免得「打乱」空转。
 */
const reverseKeys = (value) => (Array.isArray(value) ? value.map(reverseKeys)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, inner]) => [key, reverseKeys(inner)])) : value)
const SCRAMBLES = { rows: (rows) => [...rows].reverse(), keys: (rows) => rows.map(reverseKeys) }
function scrambling(storage, mode) {
  const pairs = []
  const wrap = (target, scope) => new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key)
      if (typeof value !== 'function') return value
      if (key === 'transaction') return (work) => value.call(object, (tx) => work(wrap(tx, { calls: 0 })))
      if (key === 'listPlanningProjections' && scope !== undefined) {
        return async (...args) => {
          const rows = await value.apply(object, args)
          if (scope.calls++ % 2 === 0) return rows
          const scrambled = SCRAMBLES[mode](rows)
          pairs.push([rows, scrambled])
          return scrambled
        }
      }
      return value.bind(object)
    },
  })
  return { storage: wrap(storage, undefined), pairs }
}

/** 每一类会进入快照的内容变化：各自让一轮恰好推进一次。规划字段只由 nativeValues 改变，状态只由 statusKey 改变，两者互不牵连。 */
const NATIVE = (date) => ({
  iteration: { kind: 'iteration', iterationId: 'iter-1', title: '迭代一', startDate: '2026-09-01', durationDays: 14 },
  target: { kind: 'date', date },
})
const recordOf = (providers, externalId) => providers.planning.state.items.find((item) => item.ref.externalId === externalId)
const CHANGES = [
  ['标题变化', (providers) => { const record = recordOf(providers, 'issue-2'); record.content = { ...record.content, workItem: { ...record.content.workItem, title: '改过的标题' } } }],
  ['正文变化', (providers) => { const record = recordOf(providers, 'issue-2'); record.content = { ...record.content, workItem: { ...record.content.workItem, body: '改过的正文' } } }],
  ['状态变化', (providers) => { const record = recordOf(providers, 'issue-2'); record.fields = { ...record.fields, statusKey: 'done' } }],
  ['规划字段变化', (providers) => { const record = recordOf(providers, 'issue-1'); record.fields = { ...record.fields, nativeValues: NATIVE('2026-10-15') } }],
  ['可见变 redacted', (providers) => { recordOf(providers, 'issue-2').content = { kind: ContentKind.Redacted, reason: RedactionReason.PolicyRestricted } }],
  ['redacted 变可见', (providers) => { recordOf(providers, 'issue-3').content = { kind: ContentKind.WorkItem, workItem: { externalId: 'issue-3', title: '权限恢复', body: '正文' } } }],
  ['新增条目', (providers) => { providers.planning.addItem(fixtureProjectRef(providers.planning.bindingId), 'issue', '新增条目', '正文') }],
  ['移除条目', (providers) => { removeItem(providers.planning.state, recordOf(providers, 'issue-2').ref) }],
]

for (const [label, make] of STORAGES) {
  test(`修订号：相同输入的重复引导与重启后的组合都不推进业务修订号（#220，${label}）`, async () => {
    const world = await setup(make())
    await world.open()
    const revision = await world.revision()
    const restarted = await world.open()
    assert.equal(await world.revision(), revision, '同一份 Storage 上重新组合（重启）不得推进')
    assert.equal((await restarted.commands.bootstrapWorkspace()).revision, revision)
    assert.equal(await world.revision(), revision)
  })

  for (const [name, change] of CHANGES) {
    test(`修订号：${name}恰好推进一次，本轮写入的行整批重盖，随后相同引导不再推进（#220 验收 2，${label}）`, async () => {
      const world = await setup(make(), { workspace: { planningFieldMapping: { iterationFieldId: 'iteration', targetDateFieldId: 'target' } } })
      recordOf(world.providers, 'issue-1').fields = { ...recordOf(world.providers, 'issue-1').fields, nativeValues: NATIVE('2026-10-01') }
      const core = await world.open()
      const start = await world.revision()
      change(world.providers)
      assert.equal((await core.commands.bootstrapWorkspace()).revision, start + 1, `${name}必须恰好推进一次`)
      const rows = await rowRevisions(world)
      assert.ok(rows.length > 0 && rows.every((row) => row.endsWith(`@${start + 1}`)), '推进修订号的引导把本轮写入的行整批盖成新修订号')
      assert.equal((await core.commands.bootstrapWorkspace()).revision, start + 1, '随后的相同引导不再推进')
      assert.deepEqual([await world.revision(), await rowRevisions(world)], [start + 1, rows], '相同引导也不改写任何行修订号')
    })
  }

  test(`修订号：快照被清空也是变化，恰好推进一次，随后相同引导不再推进（#220 验收 2，${label}）`, async () => {
    const world = await setup(make())
    const core = await world.open()
    const start = await world.revision()
    for (const { ref } of [...world.providers.planning.state.items]) removeItem(world.providers.planning.state, ref)
    assert.deepEqual([(await core.commands.bootstrapWorkspace()).revision, await rowRevisions(world)], [start + 1, []], '移除全部条目必须恰好推进一次')
    assert.deepEqual([(await core.commands.bootstrapWorkspace()).revision, await world.revision()], [start + 1, start + 1], '随后的相同（空）引导不再推进')
  })

  test(`修订号：宿主权威下状态命令写一行、provider 追平后，相同引导不推进，也不重写没变的行修订号（ADR-0012 第 2 条，${label}）`, async () => {
    const world = await setup(make(), { workspace: { statusPolicy: StatusPolicy.HostAuthoritative } })
    const core = await world.open()
    const entityId = (await viewOf(core, 'issue-2')).entityId
    assert.equal((await core.commands.applyPlanningStatus({ entityId, status: 'done' })).wrote, true)
    const [revision, rows] = [await world.revision(), await rowRevisions(world)]
    assert.equal(rows.filter((row) => row.endsWith(`@${revision}`)).length, 1, '前提：只有被写的那一行是新修订号，其余行停在旧修订号')
    recordOf(world.providers, 'issue-2').fields = { ...recordOf(world.providers, 'issue-2').fields, statusKey: 'done' }
    assert.deepEqual([(await core.commands.bootstrapWorkspace()).revision, await world.revision()], [revision, revision], 'provider 追平后内容没变，不推进')
    assert.deepEqual(await rowRevisions(world), rows, '没变的行保留原行修订号，不得被重盖成工作区修订号')
  })

  test(`修订号：有不可锚定条目的重复引导不推进业务修订号，仍记对账时刻（#220，ADR-0012 第 7 条，${label}）`, async () => {
    const world = await setup(make())
    const { planning } = world.providers
    planning.state.items.push({
      ref: { bindingId: planning.bindingId, objectKind: 'project_item', externalId: 'm-orphan', url: undefined },
      project: fixtureProjectRef(planning.bindingId),
      membership: { externalId: 'm-orphan', createdAt: undefined, updatedAt: undefined },
      content: { kind: ContentKind.Redacted, reason: RedactionReason.Unavailable },
      fields: { statusKey: undefined, priority: undefined, assigneeRefs: [], iterationId: undefined, startDate: undefined, targetDate: undefined, customFields: {} },
      sourceVersion: 'v-orphan', sourceUpdatedAt: '2026-09-20T00:00:00Z',
    })
    const core = await world.open()
    const [revision, rows] = [await world.revision(), await rowRevisions(world)]
    const result = await core.commands.bootstrapWorkspace()
    assert.deepEqual([result.ok, result.degraded, result.error?.code, result.unanchored, result.revision], [true, true, 'permission_denied', 1, revision], '可锚定部分照常提交、带缺口码，内容没变不推进')
    assert.deepEqual([await world.revision(), await rowRevisions(world), await world.reconciled()], [revision, rows, T(2)], '缺口不是内容变化；提交成功的一轮仍记对账时刻')
    assert.deepEqual(await core.queries.getPlanningSync(), { degraded: true, stale: false, reason: 'permission_denied' })
  })

  test(`观察顺序：经 core 先投递新观察再投递旧观察，旧观察不落账本，投影与修订号不变（R1 第 8 条，${label}）`, async () => {
    const world = await setup(make())
    const core = await world.open()
    const { planning } = world.providers
    const { ref } = recordOf(world.providers, 'issue-1')
    const observed = async () => [countsOf(world.storage).observations, await world.revision(), await rowRevisions(world), await core.queries.listPlanningItems()]
    const start = await observed()
    planning.emitObservation({ ref, type: 'issue.updated', stableFields: { v: 2 }, sourceVersion: sourceVersionFromTimestamp('2026-10-04T00:00:02Z') })
    assert.equal((await core.commands.bootstrapWorkspace()).ok, true)
    const withNewer = await observed()
    assert.equal(withNewer[0], start[0] + 1, '对照：更新的观察落账本一行')
    planning.emitObservation({ ref, type: 'issue.updated', stableFields: { v: 1 }, sourceVersion: sourceVersionFromTimestamp('2026-10-04T00:00:01Z') })
    assert.equal((await core.commands.bootstrapWorkspace()).ok, true)
    assert.deepEqual(await observed(), withNewer, '更旧的观察被拒绝：账本不增，投影与修订号不变')
  })

  test(`新鲜度：游标 state=idle（从未成功）与游标缺失同样读作陈旧，不读作新鲜（fail closed，${label}）`, async () => {
    const world = await setup(make())
    const core = await world.open()
    assert.deepEqual(await core.queries.getPlanningSync(), { degraded: false, stale: false, reason: undefined }, '对照：成功提交后读作新鲜')
    await world.storage.putSyncCursor({ workspaceId: world.id, bindingId: world.providers.planning.bindingId, scopeKey: PLANNING_SYNC_SCOPE, cursorValue: undefined, state: 'idle', lastErrorCode: undefined })
    assert.deepEqual(await core.queries.getPlanningSync(), { degraded: true, stale: true, reason: 'idle' })
  })

  test(`存储拒绝：被拒绝的观察让同步结构化失败，游标 degraded 带错误码、读侧陈旧、修订号与对账时刻不动（#199，${label}）`, async () => {
    const world = await setup(make())
    const core = await world.open()
    const revision = await world.revision()
    poison(world.providers.planning)
    await assertRoundFailed(world, core, /vé|sourceVersion|RangeError/, 'Storage 拒绝观察')
    assert.equal(await world.reconciled(), T(1), '对账时刻停在上一次提交')

    heal(world.providers.planning)
    assert.deepEqual([(await core.commands.bootstrapWorkspace()).ok, await world.revision(), await world.reconciled()], [true, revision, T(2)], '恢复后内容不变：只记对账时刻')
    assert.deepEqual(await core.queries.getPlanningSync(), { degraded: false, stale: false, reason: undefined })
  })

  test(`结构化失败：provider 离线的一轮同样不推进修订号、不记对账时刻，游标 degraded 带码（ADR-0012 第 7 条，${label}）`, async () => {
    const world = await setup(make())
    const core = await world.open()
    world.providers.planning.faultsSwitch.set(FaultKind.Offline, true)
    await assertRoundFailed(world, core, undefined, 'provider 离线')
    assert.equal(await world.reconciled(), T(1), '对账时刻停在上一次提交')
  })

  test(`异常：provider 抛出任何值或观察流中途抛出，同样是结构化失败，不转发原文，恢复后照常（K2，#199，${label}）`, async () => {
    const messages = new Set()
    for (const [name, method, thrown] of THROWS) {
      const world = await setup(make())
      const core = await world.open()
      const original = world.providers.planning[method]
      world.providers.planning[method] = throwing(method, thrown)
      messages.add(await assertRoundFailed(world, core, new RegExp(SECRET), name))
      world.providers.planning[method] = original
      assert.equal((await core.commands.bootstrapWorkspace()).ok, true, `${name}：恢复后的一轮照常提交`)
      assert.deepEqual(await core.queries.getPlanningSync(), { degraded: false, stale: false, reason: undefined }, `${name}：恢复后读作新鲜`)
    }
    assert.equal(messages.size, 1, '固定文案：与抛出的值无关，四种触发给出同一句话')
  })

  for (const [method, applies] of COMMIT_WRITES) {
    test(`原子提交：${method}被拒绝时整轮回滚，内容、行修订号、修订号与对账时刻都与事务前逐字相同，游标 degraded（ADR-0012 第 2、3 条，${label}）`, async () => {
      const guard = rejecting(make(), method, applies)
      const world = await setup(guard.storage, { clock: clockOf(T(1), T(2), T(3), T(4)) })
      const core = await world.open()
      const [revision, rows, reconciled] = [await world.revision(), await rowStates(world), await world.reconciled()]
      const record = recordOf(world.providers, 'issue-2')
      record.content = { ...record.content, workItem: { ...record.content.workItem, title: '改过的标题' } }

      guard.arm()
      await assertRoundFailed(world, core, new RegExp(SECRET), `${method} 被拒绝`)
      assert.deepEqual(await rowStates(world), rows, '一笔写入被拒绝，其余写入必须一起回滚：不能出现「内容已提交、修订号没推进、命令却报失败」')

      guard.disarm()
      assert.equal((await core.commands.bootstrapWorkspace()).revision, revision + 1, '对照：同一份改动在注入撤掉后提交并恰好推进一次，前面的失败只能来自被拒绝的那一笔写入')
      assert.notDeepEqual(await rowStates(world), rows)
      assert.notEqual(await world.reconciled(), reconciled)
      assert.deepEqual(await core.queries.getPlanningSync(), { degraded: false, stale: false, reason: undefined })
    })
  }

  test(`整轮回滚：事务的最后一笔写入被拒绝时，本轮新登记的实体、外部身份、成员关系与观察账本也不留下（ADR-0012 第 3 条，${label}）`, async () => {
    const raw = make()
    const guard = rejecting(raw, 'putReconcileCursor')
    const world = await setup(guard.storage)
    const core = await world.open()
    const { planning } = world.providers
    const counts = countsOf(raw)
    planning.addItem(fixtureProjectRef(planning.bindingId), 'issue', '新增条目', '正文')
    planning.emitObservation({ ref: recordOf(world.providers, 'issue-1').ref, type: 'issue.updated', stableFields: { v: 2 }, sourceVersion: sourceVersionFromTimestamp('2026-10-04T00:00:02Z') })

    guard.arm()
    await assertRoundFailed(world, core, new RegExp(SECRET), '最后一笔写入被拒绝')
    assert.deepEqual(countsOf(raw), counts, '先于被拒绝写入的实体、身份、成员关系与账本写入必须一起回滚')

    guard.disarm()
    assert.equal((await core.commands.bootstrapWorkspace()).ok, true)
    assert.deepEqual(countsOf(raw), Object.fromEntries(Object.entries(counts).map(([key, n]) => [key, n + 1])), '对照：撤掉注入后同一轮的四张表各多一行')
  })

  for (const [mode, name] of [['rows', '行序'], ['keys', '键序']]) {
    test(`顺序不依赖：读回的${name}隔次被打乱（端口没有承诺），相同输入的引导仍不推进修订号，内容变化仍恰好推进一次（ADR-0012 第 2 条，${label}）`, async () => {
      const guard = scrambling(make(), mode)
      const world = await setup(guard.storage)
      const core = await world.open()
      const [revision, rows] = [await world.revision(), await rowRevisions(world)]
      for (let round = 1; round <= 3; round += 1) {
        assert.equal((await core.commands.bootstrapWorkspace()).revision, revision, `第 ${round} 次相同引导不得推进`)
      }
      assert.deepEqual([await world.revision(), await rowRevisions(world)], [revision, rows], '修订号与各行修订号都不动')
      assert.ok(guard.pairs.length >= 4 && guard.pairs.every(([plain, mixed]) => plain.length > 1 && JSON.stringify(plain) !== JSON.stringify(mixed)),
        '前提：代理确实改变了每次读回的序列化形态，判定面对的是真的被打乱的输入')

      const record = recordOf(world.providers, 'issue-2')
      record.content = { ...record.content, workItem: { ...record.content.workItem, title: '改过的标题' } }
      assert.equal((await core.commands.bootstrapWorkspace()).revision, revision + 1, '对照：同一代理下，内容变化仍被看见并恰好推进一次')
    })
  }

  test(`诊断出口：毒化观察让一轮异常中止，原 RangeError 交给宿主，命令结果与读侧仍只有固定文案；冷启动的首轮也一样（TD-030，${label}）`, async () => {
    const probe = hostDiagnostics()
    const world = await setup(make(), { diagnostics: probe.diagnostics })
    poison(world.providers.planning)
    const core = await world.open()
    assert.equal(probe.seen.length, 1, '组合期的首轮引导异常中止，原异常已交给宿主')
    assert.ok(probe.seen[0] instanceof RangeError && /vé/.test(probe.seen[0].message), '交给宿主的是原异常本身，带着驱动 / 校验的原文')

    const result = await core.commands.bootstrapWorkspace()
    assert.equal(probe.seen.length, 2, '每个异常中止的一轮恰好交给宿主一次')
    assert.ok(probe.seen[1] instanceof RangeError && /vé/.test(probe.seen[1].message))
    assert.doesNotMatch(JSON.stringify(result), /vé|RangeError/, '原文不进命令结果（会经 controller 发给 client）')
    assert.doesNotMatch(JSON.stringify(await core.queries.getPlanningSync()), /vé|RangeError/, '也不进读侧')
    assert.deepEqual([result.ok, result.degraded, result.error?.code], [false, true, 'unavailable'], '结果仍是固定文案的 unavailable')
  })

  test(`诊断出口：provider 抛出的任何值都原样（同一个对象）交给宿主，命令结果不含它；成功提交与结构化失败不调用钩子（TD-030，${label}）`, async () => {
    for (const [name, method, thrown] of THROWS) {
      const probe = hostDiagnostics()
      const world = await setup(make(), { diagnostics: probe.diagnostics })
      const core = await world.open()
      assert.equal(probe.seen.length, 0, `${name}：成功提交的首轮不调用钩子`)
      const original = world.providers.planning[method]
      world.providers.planning[method] = throwing(method, thrown)
      await assertRoundFailed(world, core, new RegExp(SECRET), name)
      assert.equal(probe.seen.length, 1, `${name}：恰好交给宿主一次`)
      assert.strictEqual(probe.seen[0], thrown, `${name}：交给宿主的是抛出的那个值本身`)

      world.providers.planning[method] = original
      assert.equal((await core.commands.bootstrapWorkspace()).ok, true)
      world.providers.planning.faultsSwitch.set(FaultKind.Offline, true)
      await assertRoundFailed(world, core, undefined, `${name}：provider 离线`)
      assert.equal(probe.seen.length, 1, `${name}：成功提交与 provider 的结构化失败都不是异常中止，不调用钩子`)
    }
  })

  test(`诊断出口：钩子自己抛错、抛非 Error 值或返回被拒绝的 promise，都被吞掉，结构化失败的结果与没有钩子时相同（TD-030，${label}）`, async () => {
    const bare = await setup(make())
    const bareCore = await bare.open()
    poison(bare.providers.planning)
    const expected = await assertRoundFailed(bare, bareCore, /vé|RangeError/, '没有钩子')

    const unhandled = []
    const onUnhandled = (reason) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const hooks = [
        ['钩子抛带秘密文字的 Error', () => { throw new Error(SECRET) }],
        ['钩子抛字符串', () => { throw SECRET }],
        ['钩子返回被拒绝的 promise', () => Promise.reject(new Error(SECRET))],
        // 宿主与插件分属不同 realm 时，钩子交回的是另一个 realm 的 promise：`instanceof Promise` 认不出它，拒绝没人接就是进程级未处理拒绝。
        ['钩子返回另一个 realm（vm）里被拒绝的 promise', () => vm.runInNewContext(`Promise.reject(new Error(${JSON.stringify(SECRET)}))`)],
        ['钩子返回 thenable，其 then 里拒绝', () => ({ then: (_resolve, reject) => reject(new Error(SECRET)) })],
        ['钩子返回的对象读取 then 时同步抛错', () => ({ get then() { throw new Error(SECRET) } })],
      ]
      for (const [name, syncRoundFailed] of hooks) {
        const world = await setup(make(), { diagnostics: { syncRoundFailed } })
        const core = await world.open()
        poison(world.providers.planning)
        assert.equal(await assertRoundFailed(world, core, new RegExp(SECRET), name), expected, `${name}：失败文案与没有钩子时相同`)
        heal(world.providers.planning)
        assert.equal((await core.commands.bootstrapWorkspace()).ok, true, `${name}：恢复后的一轮照常提交`)
      }
      await new Promise((resolve) => setImmediate(resolve))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    assert.deepEqual(unhandled, [], '被拒绝的 promise 也被接住，不成为进程级未处理拒绝')
  })

  test(`诊断出口：钩子返回永不 resolve 的 promise，也不拖住一轮同步，组合期与显式命令都在期限内结束（TD-030，${label}）`, async () => {
    // 出口只服务排障，不能成为同步的一部分：慢日志或永不 resolve 的钩子若被 await，每一轮失败的同步都会跟着挂起。
    const seen = []
    const diagnostics = { syncRoundFailed: (error) => { seen.push(error); return new Promise(() => {}) } }
    const world = await setup(make(), { diagnostics })
    poison(world.providers.planning)
    const opened = await settlesWithin(world.open())
    assert.notEqual(opened, HUNG, '组合期的首轮引导被拒：钩子的返回值不挂住组合')
    assert.equal(seen.length, 1, '钩子确实被调用了（否则这条用例空转）')

    const result = await settlesWithin(opened.commands.bootstrapWorkspace())
    assert.notEqual(result, HUNG, '显式命令：钩子的返回值不挂住这一轮')
    assert.deepEqual([result.ok, result.degraded, result.error?.code], [false, true, 'unavailable'])
    assert.equal(seen.length, 2)
    assert.deepEqual(await opened.queries.getPlanningSync(), { degraded: true, stale: true, reason: 'unavailable' })
  })

  test(`诊断出口：组合期记录失败本身也被拒绝时，那个拒绝在被吞掉之前交给宿主；显式命令的同一拒绝仍直接到调用方（TD-030、TD-031，${label}）`, async () => {
    // 冷启动：provider 离线（结构化失败，不是异常）+ 降级游标写不进。`composeCore` 的 catch 吞掉这个拒绝，宿主若拿不到，原因就只留在一条读侧的 idle 里。
    const diskFull = new Error('disk full /secret/path')
    const probe = hostDiagnostics()
    const storage = make()
    const broken = new Proxy(storage, {
      get(target, key) {
        if (key === 'putSyncCursor') return () => Promise.reject(diskFull)
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const world = await setup(broken, { diagnostics: probe.diagnostics })
    world.providers.planning.faultsSwitch.set(FaultKind.Offline, true)
    const core = await world.open()
    assert.equal(probe.seen.length, 1, '组合期：provider 的结构化失败本身不调用钩子，记录它时被拒绝的那个异常调用一次')
    assert.strictEqual(probe.seen[0], diskFull, '交给宿主的是被拒绝的那个异常本身')
    assert.equal(await world.cursor(), undefined, '前提：一个游标都没写进去')
    assert.deepEqual(await core.queries.getPlanningSync(), { degraded: true, stale: true, reason: 'idle' }, '读侧：游标缺失读作陈旧')

    await assert.rejects(core.commands.bootstrapWorkspace(), (error) => error === diskFull, '显式命令：同一拒绝直接到调用方（TD-031 不变）')
    assert.equal(probe.seen.length, 1, '显式命令的拒绝已在调用方手里，不再另交钩子')
  })

  test(`诊断出口：冷启动记录失败也被拒绝、钩子返回永不 resolve 的 promise 时，不挂住组合期，显式命令仍直接拒绝（TD-030、TD-031，${label}）`, async () => {
    const diskFull = new Error('disk full')
    const probe = hostDiagnostics(() => new Promise(() => {}))
    const broken = new Proxy(make(), { get(target, key) { const value = Reflect.get(target, key); return key === 'putSyncCursor' ? () => Promise.reject(diskFull) : typeof value === 'function' ? value.bind(target) : value } })
    const world = await setup(broken, { diagnostics: probe.diagnostics })
    world.providers.planning.faultsSwitch.set(FaultKind.Offline, true)
    const core = await settlesWithin(world.open())
    assert.notEqual(core, HUNG, '组合期的水合 catch 是诊断出口的第二个调用点：钩子的返回值同样不挂住组合')
    assert.equal(probe.seen.length, 1, '钩子确实被调用了（否则这条用例空转）')
    const command = await settlesWithin(core.commands.bootstrapWorkspace().then(() => 'resolved', (error) => error))
    assert.strictEqual(command, diskFull, '显式命令：同一拒绝，也在期限内结束')
  })

  test(`诊断出口：降级游标已写进、随后读当前修订号失败的三重故障，组合期同样把那个拒绝交给宿主（TD-030、TD-031，${label}）`, async () => {
    const unreadable = new Error('cannot read revision /secret/path')
    const probe = hostDiagnostics()
    const storage = make()
    const broken = new Proxy(storage, {
      get(target, key) {
        if (key === 'currentRevision') return () => Promise.reject(unreadable)
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const world = await setup(broken, { diagnostics: probe.diagnostics })
    world.providers.planning.faultsSwitch.set(FaultKind.Offline, true)
    const core = await world.open()
    assert.equal(probe.seen.length, 1)
    assert.strictEqual(probe.seen[0], unreadable)
    const cursor = await world.cursor()
    assert.equal(cursor.state, 'degraded', '降级已落账：读侧陈旧是对的，宿主拿到的是「命令为什么拒绝」')
    assert.equal((await core.queries.getPlanningSync()).stale, true)
  })
}

test('诊断出口：SQLite 账本里的旧载体（TD-020 起点）让一轮异常中止，宿主收到的原文含 repairLegacySource，命令结果不含（TD-030）', async () => {
  const probe = hostDiagnostics()
  const storage = createSqliteStorage(':memory:')
  const world = await setup(storage, { diagnostics: probe.diagnostics })
  const core = await world.open()
  const { planning } = world.providers
  const { ref } = recordOf(world.providers, 'issue-1')
  // 迁移 005 之后仍混进账本的旧载体：经内部句柄写一条版本为 `v9` 的已提交观察，再对同一对象发规范版本的观察（内存替身的入口已断言，这种状态不可达）。
  storage.db.prepare('INSERT INTO sync_observation (binding_id, object_kind, object_external_id, observed_at, dedupe_key, updated_at, snapshot_json, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(planning.bindingId, ref.objectKind, ref.externalId, T(0), 'legacy-1', 'v9', '{}', 'processed')
  planning.emitObservation({ ref, type: 'issue.updated', stableFields: { v: 2 }, sourceVersion: sourceVersionFromTimestamp('2026-10-04T00:00:02Z') })

  const message = await assertRoundFailed(world, core, /repairLegacySource|v9|已提交版本/, '旧载体')
  assert.equal(probe.seen.length, 1, '恰好交给宿主一次')
  assert.match(probe.seen[0].message, /repairLegacySource/, '宿主拿到可操作的修复指令')
  assert.doesNotMatch(message, /repairLegacySource/, '修复指令只给宿主，不进命令结果')
})

test('客户端时间：冷启动被拒或成功之后被拒，lastUpdatedAt 都不前进（#199 评论的建议验收）', async () => {
  const cold = await setup(createFakeStorage())
  poison(cold.providers.planning)
  const coldCore = await cold.open()
  const coldSync = createSync(createTransport(createController(coldCore, { workspaceRevision: cold.revision })), createEntityStore(), { clock: clockOf(T(5)) })
  await coldSync.connect()
  assert.deepEqual([coldSync.read().store.list().length, coldSync.read().lastUpdatedAt, coldSync.read().reason], [0, undefined, 'unavailable'], '冷启动被拒不得显示成「已读取当前快照，共 0 项」')

  const later = await setup(createFakeStorage())
  const laterCore = await later.open()
  const sync = createSync(createTransport(createController(laterCore, { workspaceRevision: later.revision })), createEntityStore(), { clock: clockOf(T(5), T(6), T(7)) })
  await sync.connect()
  poison(later.providers.planning)
  await laterCore.commands.bootstrapWorkspace()
  await sync.reconnect()
  assert.deepEqual([sync.read().lastUpdatedAt, sync.read().reason], [T(5), 'unavailable'], '成功之后的拒绝：重连拿到的是降级基线，时间停在最后一次确认')
})

test('双重故障：连失败都记不下时命令拒绝，从未成功的工作区读作陈旧而不是新鲜', async () => {
  // 第一个 transaction 留给 createContext，之后的事务与所有游标写入都拒绝；方法 bind 到原对象，避开私有字段的 TypeError。
  let transactions = 0
  const broken = new Proxy(createFakeStorage(), {
    get(target, key) {
      if (key === 'transaction' && transactions++ > 0) return () => Promise.reject(new Error('disk full'))
      if (key === 'putSyncCursor') return () => Promise.reject(new Error('disk full'))
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const probe = hostDiagnostics()
  const world = await setup(broken, { diagnostics: probe.diagnostics })
  const core = await world.open()
  assert.equal(await world.cursor(), undefined, '前提：一个游标都没写进去')
  assert.deepEqual(await core.queries.getPlanningSync(), { degraded: true, stale: true, reason: 'idle' })
  await assert.rejects(core.commands.bootstrapWorkspace(), /disk full/, '记不下降级时不假装已记录')
  // 组合期：轮次的原异常（事务被拒）先于 fail 交给宿主，记录失败本身的拒绝被 composeCore 吞掉之前再交一次；显式命令：只有轮次的原异常，记录失败的拒绝直接到调用方。
  assert.equal(probe.seen.length, 3, '诊断出口先于 fail，不因记录失败而丢原因；组合期被吞掉的拒绝也交出去（TD-030）')
  assert.ok(probe.seen.every((error) => /disk full/.test(error.message)))
})
