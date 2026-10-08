/**
 * Batch C2 端到端：核心引导与投影（issue #76 / ExecPlan D2、D5）。全部使用离线替身：无凭据、无网络。
 * 用例名说明它保护哪条不变量：一个外部对象一个内部实体（tests/README §2.1）、同步幂等与重启恢复
 * （§2.4）、provider 离线时局部降级（ExecPlan D5）、工程事实不改写规划状态（不变量 3）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ContentKind,
  DerivedFlag,
  EngineeringFactKind,
  EntityKind,
  newWorkspaceId,
} from '@harness-projects/domain'
import { sourceVersionFromTimestamp } from '@harness-projects/capabilities'
import { composeCore, promoteEntityIdentity, withEngineeringFacts } from '@harness-projects/core'
import {
  FaultKind,
  createFakePlanningProvider,
  createFakeProviders,
  createFakeStorage,
  exportFakeStorageState,
  fixtureProjectRef,
  removeItem,
} from '@harness-projects/provider-fake'

const WORKSPACE = { id: newWorkspaceId(), name: 'MVP-0' }

/** 三个条目：issue-backed、draft-backed、change-request-backed（issue #76 验收第一项）。 */
function threeItemComposition() {
  const providers = createFakeProviders()
  const { planning } = providers
  const project = fixtureProjectRef(planning.bindingId)
  for (const externalId of ['issue-2', 'issue-3', 'issue-4']) {
    removeItem(planning.state, { bindingId: planning.bindingId, objectKind: 'issue', externalId, url: undefined })
  }
  planning.addItem(project, 'draft', '草稿项', '草稿正文')
  return providers
}

const externalIdOf = (view) => view.content.identity.externalId
const signatures = (views) => views.map((view) => `${externalIdOf(view)}:${view.entityId}`).sort()

const compose = (providers, storage) =>
  composeCore(storage === undefined ? { workspace: WORKSPACE, providers } : { workspace: WORKSPACE, providers, storage })

test('引导：一个条目一个成员，change_request 态不产生第二个工作项（issue #76 验收）', async () => {
  const core = await compose(threeItemComposition())
  const views = await core.queries.listPlanningItems()
  assert.equal(views.length, 3, '成员数必须等于外部条目数')
  assert.equal(views.filter((view) => view.kind === EntityKind.WorkItem).length, 2, 'issue 与 draft 各一个工作项')
  assert.equal(views.filter((view) => view.kind === EntityKind.ChangeRequest).length, 1, 'change_request 必须是变更请求实体')
  assert.equal(views.find((view) => externalIdOf(view) === 'pr-7').content.contentKind, ContentKind.ChangeRequest)
})

test('内容三态：redacted 条目如实投影为占位，不回退到缓存标题（ExecPlan D5）', async () => {
  const core = await compose(createFakeProviders())
  const views = await core.queries.listPlanningItems()
  const redacted = views.find((view) => view.content.contentKind === ContentKind.Redacted)
  assert.ok(redacted, 'issue-backed 种子必须含一条 redacted 条目')
  assert.equal(redacted.content.title, undefined, 'redacted 不得携带标题')
  assert.equal(redacted.content.body, undefined, 'redacted 不得携带正文')
})

test('同步幂等：同一观察两次计数不变，重复引导不产生第二个实体（tests/README §2.4）', async () => {
  const providers = threeItemComposition()
  const core = await compose(providers)
  const before = signatures(await core.queries.listPlanningItems())
  const observationCount = exportFakeStorageState(providers.storage).observations.length
  const result = await core.commands.bootstrapWorkspace()
  assert.equal(result.ok, true)
  assert.deepEqual(signatures(await core.queries.listPlanningItems()), before, '重复引导不得新增实体')
  assert.equal(
    exportFakeStorageState(providers.storage).observations.length,
    observationCount,
    '重复观察必须按 (binding, dedupeKey) 丢弃',
  )
})

test('重启：同一份 Storage 内容上的新 core 解析回同一批内部实体（ExecPlan 决策）', async () => {
  const providers = threeItemComposition()
  const first = await compose(providers)
  const before = signatures(await first.queries.listPlanningItems())
  const restored = createFakeStorage(exportFakeStorageState(providers.storage))
  const second = await compose(providers, restored)
  assert.deepEqual(signatures(await second.queries.listPlanningItems()), before, '重启后外部对象必须解析回同一实体')
})

test('全量收敛：provider 返回空集合后本地规划条目被移除', async () => {
  const providers = threeItemComposition()
  const core = await compose(providers)
  assert.ok((await core.queries.listPlanningItems()).length > 0)
  for (const item of [...providers.planning.state.items]) removeItem(providers.planning.state, item.ref)
  const result = await core.commands.bootstrapWorkspace()
  assert.equal(result.ok, true)
  assert.deepEqual(await core.queries.listPlanningItems(), [])
  assert.equal((await core.queries.getPlanningSync()).degraded, false, '合法的空项目不是不完整读取')
})

test('降级：规划 provider 离线时返回最后已知值并标记 degraded，而不是抛错（ExecPlan D5）', async () => {
  const providers = threeItemComposition()
  const core = await compose(providers)
  const before = await core.queries.listPlanningItems()
  providers.planning.setFault(FaultKind.Offline, true)
  const result = await core.commands.bootstrapWorkspace()
  assert.equal(result.ok, false, '离线同步必须返回结构化失败')
  assert.equal(result.degraded, true)
  assert.equal(result.error.code, 'unavailable')
  const after = await core.queries.listPlanningItems()
  assert.deepEqual(
    after.map((view) => view.planningStatus),
    before.map((view) => view.planningStatus),
    '降级投影必须保留最后已知权威值',
  )
  assert.ok(after.length > 0 && after.every((view) => view.freshness.degraded === true), '每条投影都必须标记 degraded')
  const denied = await compose({ ...providers, planning: createFakePlanningProvider({ bindingId: providers.planning.bindingId, faults: { permissionDenied: true } }) }, providers.storage)
  assert.deepEqual((await denied.queries.listPlanningItems()).map((view) => view.freshness.degraded), [true, true, true], '读取能力不可用时旧行是 stale（H11）')
  assert.deepEqual(await (await composeCore({ workspace: WORKSPACE, providers: {} })).queries.getPlanningSync(), { degraded: true, stale: true, reason: '没有可用的 storage 绑定' })
})

test('工程事实：CI 结果只产生派生标记，不改写规划状态（不变量 3）', async () => {
  const core = await compose(threeItemComposition())
  const views = await core.queries.listPlanningItems()
  const facts = [{ kind: EngineeringFactKind.CiFailed, subjectId: views[0].entityId }]
  const projected = views.map((view) => withEngineeringFacts(view, facts))
  assert.deepEqual(
    projected.map((view) => view.planningStatus),
    views.map((view) => view.planningStatus),
    '工程事实不得改写规划状态',
  )
  assert.ok(projected[0].engineering.derived.includes(DerivedFlag.CiFailing), 'CI 失败必须表现为派生标记')
})

test('身份：Draft→Issue 提升只换外部 id，内部实体 id 不变（不变量 1）', async () => {
  const providers = threeItemComposition()
  const core = await compose(providers)
  // #27 验收 3 的生命周期断言（2026-09-24 评审订正）：不能走 listPlanningItems / getItemDetail——它们会跳过零
  // primary 的实体；改为按 provider 条目逐项解析实体，再断言**恰好一个** primary（库只强制"至多一个"）。
  for (const item of providers.planning.state.items) {
    const identity = await providers.storage.findExternalIdentity(providers.planning.bindingId, item.ref.objectKind, item.ref.externalId)
    assert.ok(identity, `provider 条目 ${item.ref.externalId} 必须解析出内部实体`)
    const primaries = (await providers.storage.listIdentitiesForEntity(identity.entityId)).filter((i) => i.role === 'primary')
    assert.equal(primaries.length, 1, `ensureEntity 建的实体 ${identity.entityId} 必须恰好一个 primary 身份`)
  }
  const draft = (await core.queries.listPlanningItems()).find((view) => view.content.identity.externalKind === 'draft')
  assert.ok(draft, '三个条目里必须有一个 draft')
  const outcome = await providers.storage.transaction((tx) => promoteEntityIdentity(tx, draft.entityId, 'issue-100'))
  assert.equal(outcome.ok, true)
  assert.equal(outcome.entityId, draft.entityId, '提升不得新建实体')
  const detail = await core.queries.getItemDetail(draft.entityId)
  assert.equal(detail.entityId, draft.entityId)
  const primaries = detail.identities.filter((identity) => identity.role === 'primary')
  assert.equal(primaries.length, 1, '提升后仍只有一个 primary 身份')
  assert.equal(primaries[0].externalKind, 'issue')
  assert.equal(primaries[0].externalId, 'issue-100')
})

test('身份：没有内容身份的条目不登记外部身份（裁决 R1）', async () => {
  const providers = threeItemComposition()
  const { planning } = providers
  const project = fixtureProjectRef(planning.bindingId)
  planning.state.items.push({
    ref: { bindingId: planning.bindingId, objectKind: 'project_item', externalId: 'm-orphan', url: undefined },
    project,
    membership: { externalId: 'm-orphan', createdAt: undefined, updatedAt: undefined },
    content: { kind: 'redacted', reason: 'unavailable' },
    fields: { statusKey: undefined, priority: undefined, assigneeRefs: [], iterationId: undefined, startDate: undefined, targetDate: undefined, customFields: {} },
    sourceVersion: 'v-orphan',
    sourceUpdatedAt: '2026-09-20T00:00:00Z',
  })
  const core = await compose(providers)
  const result = await core.commands.bootstrapWorkspace()
  assert.deepEqual([result.ok, result.degraded, result.error?.code], [true, true, 'permission_denied'], '可锚定部分已提交，但这次读取不完整')
  assert.equal(result.unanchored, 1, '没有内容身份、也没有成员关系映射的条目必须计入 unanchored')
  assert.equal(result.entities, 3, '不得为它新建实体')
  const { identities } = exportFakeStorageState(providers.storage)
  assert.equal(identities.some((identity) => identity.externalId === 'm-orphan'), false, '成员关系 id 不得进外部身份表')
  assert.deepEqual((await core.queries.listPlanningItems()).map((view) => [view.freshness.degraded, view.freshness.reason]), Array(3).fill([false, undefined]), '本次读取确认的可见行保持 fresh（H11）')
  assert.deepEqual(await core.queries.getPlanningSync(), { degraded: true, stale: false, reason: 'permission_denied' })
})

const revisionOf = (providers) => providers.storage.currentRevision(WORKSPACE.id)
const rowRevisions = async (providers) => (await providers.storage.listPlanningProjections(WORKSPACE.id)).map((row) => `${row.entityId}@${row.revision}`).sort()

test('修订号：相同输入的重复引导不推进业务修订号，也不重写行修订号（#220 验收 1，P2）', async () => {
  const providers = threeItemComposition()
  const core = await compose(providers)
  const [revision, rows, memberships] = [await revisionOf(providers), await rowRevisions(providers), exportFakeStorageState(providers.storage).memberships.length]
  for (let round = 0; round < 2; round += 1) {
    const result = await core.commands.bootstrapWorkspace()
    assert.deepEqual([result.ok, result.revision], [true, revision], `第 ${round + 1} 次相同引导的结果修订号不得前进`)
  }
  assert.equal(await revisionOf(providers), revision, '工作区修订号不得前进')
  assert.deepEqual(await rowRevisions(providers), rows, '内容没变的行不得被重盖修订号')
  assert.equal(exportFakeStorageState(providers.storage).memberships.length, memberships, '成员关系数不变（#134 验收 4）')
})

test('重复观察：同一观察经 core 投递 N 次，实体、账本与修订号同投递一次（R1 第 7 条）', async () => {
  const providers = threeItemComposition()
  const core = await compose(providers)
  const before = [signatures(await core.queries.listPlanningItems()), exportFakeStorageState(providers.storage).observations.length, await revisionOf(providers)]
  providers.planning.setFault(FaultKind.DuplicateEvent, true)
  for (let round = 0; round < 3; round += 1) assert.equal((await core.commands.bootstrapWorkspace()).ok, true)
  const after = [signatures(await core.queries.listPlanningItems()), exportFakeStorageState(providers.storage).observations.length, await revisionOf(providers)]
  assert.deepEqual(after, before, '重复投递后实体、账本行数与修订号都必须与投递一次相同')
})

test('乱序观察：经 core 先投递新观察再投递旧观察，旧观察不落账本，投影与修订号不变（R1 第 8 条）', async () => {
  const providers = threeItemComposition()
  const ref = providers.planning.state.items.find((item) => item.ref.objectKind === 'issue').ref
  const core = await compose(providers)
  providers.planning.emitObservation({ ref, type: 'issue.updated', stableFields: { v: 2 }, sourceVersion: sourceVersionFromTimestamp('2026-10-04T00:00:02Z') })
  await core.commands.bootstrapWorkspace()
  const before = [await core.queries.listPlanningItems(), exportFakeStorageState(providers.storage).observations.length, await revisionOf(providers)]
  providers.planning.emitObservation({ ref, type: 'issue.updated', stableFields: { v: 1 }, sourceVersion: sourceVersionFromTimestamp('2026-10-04T00:00:01Z') })
  assert.equal((await core.commands.bootstrapWorkspace()).ok, true)
  const after = [await core.queries.listPlanningItems(), exportFakeStorageState(providers.storage).observations.length, await revisionOf(providers)]
  assert.deepEqual(after, before, '更旧的观察被拒绝：账本不增，投影与修订号不变')
})

test('修订号：内容变化的全量快照恰好推进一次，移除也是变化，随后相同引导不再推进（#220 验收 2）', async () => {
  const providers = threeItemComposition()
  const core = await compose(providers)
  const start = await revisionOf(providers)
  const record = providers.planning.state.items.find((item) => item.ref.objectKind === 'issue')
  record.content = { ...record.content, workItem: { ...record.content.workItem, title: '改过的标题' } }
  assert.equal((await core.commands.bootstrapWorkspace()).revision, start + 1, '一个标题变化恰好推进一次')
  assert.ok((await rowRevisions(providers)).every((row) => row.endsWith(`@${start + 1}`)), '推进修订号的引导把本轮写入的行重盖成新修订号')
  assert.equal((await core.commands.bootstrapWorkspace()).revision, start + 1, '随后的相同引导不再推进')
  removeItem(providers.planning.state, record.ref)
  assert.equal((await core.commands.bootstrapWorkspace()).revision, start + 2, '只有移除的全量快照也是变化')
  assert.equal((await core.commands.bootstrapWorkspace()).revision, start + 2)
  assert.equal(await revisionOf(providers), start + 2)
})

test('新鲜度：内容不变的手动刷新记录对账时刻，不推进修订号（#220 验收 3）', async () => {
  const providers = threeItemComposition()
  const times = ['2026-10-08T00:00:01.000Z', '2026-10-08T00:00:02.000Z']
  const core = await composeCore({ workspace: WORKSPACE, providers, clock: () => times.shift() ?? 'clock exhausted' })
  const revision = await revisionOf(providers)
  assert.deepEqual(await providers.storage.getReconcileCursor(WORKSPACE.id), { workspaceId: WORKSPACE.id, lastReconciledAt: '2026-10-08T00:00:01.000Z' })
  assert.equal((await core.commands.bootstrapWorkspace()).revision, revision)
  assert.deepEqual(await providers.storage.getReconcileCursor(WORKSPACE.id), { workspaceId: WORKSPACE.id, lastReconciledAt: '2026-10-08T00:00:02.000Z' }, '刷新只记新鲜度')
  assert.equal(await revisionOf(providers), revision, '新鲜度不是业务修订号')
})

test('修订号：换 Planning 源后旧源残留的投影不被当成每轮的变化（#202 交接）', async () => {
  const providers = threeItemComposition()
  await compose(providers)
  const old = (await providers.storage.listProviderBindings(WORKSPACE.id)).find((binding) => binding.domain === 'planning')
  await providers.storage.putProviderBinding({ ...old, enabled: false, isDefault: false })
  const second = await compose({ ...providers, planning: createFakePlanningProvider() }, providers.storage)
  const revision = await revisionOf(providers)
  assert.equal((await second.commands.bootstrapWorkspace()).revision, revision, '新源内容不变时，旧源残留行不得让修订号每轮前进')
  assert.equal(await revisionOf(providers), revision)
})
