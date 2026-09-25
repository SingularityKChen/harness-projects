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
import { composeCore, promoteEntityIdentity, withEngineeringFacts } from '@harness-projects/core'
import {
  FaultKind,
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
