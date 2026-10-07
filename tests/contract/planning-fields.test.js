/**
 * #133 Batch 2 契约：映射持久化、字段快照投影与整组替换的事务闭环。
 *
 * 用例只在两个 Storage（内存替身与 SQLite）上驱动**端口与 core 的公开入口**：`createContext` /
 * `bootstrapWorkspace` / `createQueries` / Storage 端口方法。RED 阶段失败的是行为（投影缺 `planningFields`、
 * 映射未持久化、整组替换未实现），不是导入或类型错误。SQLite 的重启用例走临时文件：关闭句柄后重新打开同一份。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { ContentKind, RedactionReason, StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { bootstrapWorkspace, createContext, createQueries } from '@harness-projects/core'
import {
  FIXTURE_PROJECT_EXTERNAL_ID, FaultKind, createFakePlanningProvider, createFakeStorage,
  exportFakeStorageState, fixtureProjectRef,
} from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

const BINDING = 'binding-fields'
const project = () => fixtureProjectRef(BINDING)
const sqliteDir = mkdtempSync(join(tmpdir(), 'planning-fields-contract-'))
after(() => rmSync(sqliteDir, { recursive: true, force: true }))
let sqliteSeq = 0

const ADAPTERS = [
  {
    label: '内存 Storage 替身',
    make: () => createFakeStorage(),
    restart: (storage) => createFakeStorage(exportFakeStorageState(storage)),
  },
  {
    label: 'SQLite Storage',
    make: () => createSqliteStorage(join(sqliteDir, `planning-fields-${sqliteSeq++}.sqlite`)),
    restart: (storage) => { const location = storage.location; storage.close(); return createSqliteStorage(location) },
  },
]

/** 工作区显式映射：原生 optionId → 规范状态；测试只列需要的选项，未列出的必须 native_only。 */
const mappingOf = (overrides = {}) => ({ bindingId: BINDING, projectExternalId: FIXTURE_PROJECT_EXTERNAL_ID, ...overrides })
const statusMapping = (options, projectFieldId = 'status') => mappingOf({ status: { projectFieldId, options } })
/** A 只映射 in_progress，B 只映射 done：用来断言替换而不是合并。 */
const MAPPING_IN_PROGRESS = statusMapping({ in_progress: 'in_progress' })
const MAPPING_DONE = statusMapping({ done: 'done' })
const FIELD_ROLES = { iterationFieldId: 'iteration', targetDateFieldId: 'target-date' }
const workspaceInput = (id, mapping) => ({
  id, name: '字段闭环', statusPolicy: StatusPolicy.ProviderAuthoritative, project: project(),
  ...(mapping === undefined ? {} : { planningFieldMapping: mapping }),
})

async function setup(adapter, { mapping, planning } = {}) {
  const storage = adapter.make()
  const provider = planning ?? createFakePlanningProvider({ bindingId: BINDING })
  const id = newWorkspaceId()
  const context = await createContext({ workspace: workspaceInput(id, mapping), providers: { planning: provider, storage } })
  return { storage, planning: provider, id, context }
}

const itemViews = (context) => createQueries(context).listPlanningItems()
const viewOf = (views, externalId) => views.find((view) => view.content.identity.externalId === externalId)
const statusOf = (views, externalId) => viewOf(views, externalId).planningFields?.status
const membershipOf = (planning, externalId) => planning.state.items.find((item) => item.ref.externalId === externalId).membership.externalId

for (const adapter of ADAPTERS) {
  test(`${adapter.label}：native Done is never normalized without workspace mapping`, async () => {
    const { context } = await setup(adapter)
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    const done = statusOf(await itemViews(context), 'issue-4')
    assert.deepEqual(done, { kind: 'unset' }, '没有工作区映射时状态角色是 unset，绝不按原生名 Done 归一')
    assert.equal(Object.hasOwn(done, 'normalized'), false, 'unset 不得带 normalized')
  })

  test(`${adapter.label}：mapping from workspace options maps only listed option ids`, async () => {
    const { context } = await setup(adapter, { mapping: { ...MAPPING_IN_PROGRESS, ...FIELD_ROLES } })
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    const views = await itemViews(context)
    assert.deepEqual(statusOf(views, 'issue-1'), { kind: 'mapped', nativeName: 'In Progress', normalized: 'in_progress' })
    const unlisted = statusOf(views, 'issue-4')
    assert.deepEqual(unlisted, { kind: 'native_only', nativeName: 'Done' }, '未映射选项只显示原生名')
    assert.equal(Object.hasOwn(unlisted, 'normalized'), false, 'native_only 的 normalized 必须缺省')
    assert.deepEqual(viewOf(views, 'issue-1').planningFields.iteration, { title: '迭代一', startDate: '2026-09-01', durationDays: 14 })
    assert.equal(viewOf(views, 'issue-1').planningFields.targetDate, '2026-09-24')
    assert.equal(Object.hasOwn(viewOf(views, 'issue-2').planningFields, 'iteration'), false, '没有迭代值的条目不出现 iteration 键')
  })

  test(`${adapter.label}：stale mapping references degrade to unset or native_only without name guessing`, async () => {
    const { storage, id, context } = await setup(adapter)
    await bootstrapWorkspace(context)
    // 已保存映射只在 Provider 定义消失之后被读回：直接写 workspace 记录模拟「配置保存后字段被删」。
    const stale = mappingOf({
      status: { projectFieldId: 'status', options: { blocked: 'blocked' } },
      iterationFieldId: 'missing-iteration', targetDateFieldId: 'missing-date',
    })
    await storage.putWorkspace({ id, name: '字段闭环', statusPolicy: StatusPolicy.ProviderAuthoritative, planningFieldMapping: stale })
    const reused = await createContext({
      workspace: workspaceInput(id, undefined),
      providers: { planning: createFakePlanningProvider({ bindingId: BINDING }), storage },
    })
    assert.equal((await bootstrapWorkspace(reused)).ok, true)
    const views = await itemViews(reused)
    assert.deepEqual(statusOf(views, 'issue-1'), { kind: 'native_only', nativeName: 'In Progress' }, '选项不在已保存映射里：native_only，不借同名字段')
    assert.equal(Object.hasOwn(viewOf(views, 'issue-1').planningFields, 'iteration'), false, '字段角色不可用时该键不出现')
    assert.equal(Object.hasOwn(viewOf(views, 'issue-1').planningFields, 'targetDate'), false)
    const absent = mappingOf({ status: { projectFieldId: 'gone', options: { in_progress: 'in_progress' } } })
    await storage.putWorkspace({ id, name: '字段闭环', statusPolicy: StatusPolicy.ProviderAuthoritative, planningFieldMapping: absent })
    const again = await createContext({
      workspace: workspaceInput(id, undefined),
      providers: { planning: createFakePlanningProvider({ bindingId: BINDING }), storage },
    })
    assert.equal((await bootstrapWorkspace(again)).ok, true)
    assert.deepEqual(statusOf(await itemViews(again), 'issue-1'), { kind: 'unset' }, '角色字段不存在：unset，绝不按名称替代')
  })

  test(`${adapter.label}：workspace mapping survives omitted-input restart`, async () => {
    const first = await setup(adapter, { mapping: { ...MAPPING_IN_PROGRESS, ...FIELD_ROLES } })
    assert.equal((await bootstrapWorkspace(first.context)).ok, true)
    const revived = adapter.restart(first.storage)
    const context = await createContext({
      workspace: workspaceInput(first.id, undefined),
      providers: { planning: createFakePlanningProvider({ bindingId: BINDING }), storage: revived },
    })
    assert.deepEqual(context.planningFieldMapping, { ...MAPPING_IN_PROGRESS, ...FIELD_ROLES }, '省略输入必须复用已保存映射')
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    assert.deepEqual(statusOf(await itemViews(context), 'issue-1'), { kind: 'mapped', nativeName: 'In Progress', normalized: 'in_progress' })
    assert.deepEqual((await revived.getWorkspace(first.id)).planningFieldMapping, { ...MAPPING_IN_PROGRESS, ...FIELD_ROLES })
  })

  test(`${adapter.label}：mapping replacement and clearing commit with fields`, async () => {
    const { storage, id, context } = await setup(adapter, { mapping: MAPPING_IN_PROGRESS })
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    assert.equal(statusOf(await itemViews(context), 'issue-1').normalized, 'in_progress')

    context.pendingPlanningFieldMapping = MAPPING_DONE
    assert.equal((await bootstrapWorkspace(context)).ok, true, '待确认替换必须与字段一起提交')
    const replaced = await itemViews(context)
    assert.equal(statusOf(replaced, 'issue-4').normalized, 'done', '替换后的映射生效')
    assert.deepEqual(statusOf(replaced, 'issue-1'), { kind: 'native_only', nativeName: 'In Progress' }, '替换不是合并：旧映射不再归一')
    assert.deepEqual((await storage.getWorkspace(id)).planningFieldMapping, MAPPING_DONE)

    context.pendingPlanningFieldMapping = null
    assert.equal((await bootstrapWorkspace(context)).ok, true, '显式 null 清除必须提交')
    assert.equal((await storage.getWorkspace(id)).planningFieldMapping, undefined, '清除后读回 undefined，不得写成 null')
    assert.deepEqual(statusOf(await itemViews(context), 'issue-4'), { kind: 'unset' })
  })

  test(`${adapter.label}：failed field refresh preserves mapping values projection and revision`, async () => {
    const { storage, planning, id, context } = await setup(adapter, { mapping: MAPPING_IN_PROGRESS })
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    const membership = membershipOf(planning, 'issue-1')
    const before = {
      revision: await storage.currentRevision(id),
      values: await storage.listFieldValues(id, membership),
      projections: JSON.stringify(await storage.listPlanningProjections(id)),
      mapping: (await storage.getWorkspace(id)).planningFieldMapping,
    }
    planning.faultsSwitch.set(FaultKind.Offline, true)
    const failed = await bootstrapWorkspace(context)
    assert.deepEqual([failed.ok, failed.degraded], [false, true], '刷新失败只走 degraded')
    assert.equal(await storage.currentRevision(id), before.revision, '失败不得推进 revision')
    assert.deepEqual(await storage.listFieldValues(id, membership), before.values, '失败不得改动已确认字段值')
    assert.equal(JSON.stringify(await storage.listPlanningProjections(id)), before.projections, '失败不得改动投影快照')
    assert.deepEqual((await storage.getWorkspace(id)).planningFieldMapping, before.mapping, '失败保留旧映射')

    planning.faultsSwitch.set(FaultKind.Offline, false)
    assert.equal((await bootstrapWorkspace(context)).ok, true, '失败后下一次仍可执行')
    assert.deepEqual(statusOf(await itemViews(context), 'issue-1'), { kind: 'mapped', nativeName: 'In Progress', normalized: 'in_progress' })
  })

  test(`${adapter.label}：empty membership field set removes stale values`, async () => {
    const { storage, planning, id, context } = await setup(adapter, { mapping: MAPPING_IN_PROGRESS })
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    const membership = membershipOf(planning, 'issue-1')
    assert.ok((await storage.listFieldValues(id, membership)).length > 0, '前置：条目名下有字段值')
    const record = planning.state.items.find((item) => item.ref.externalId === 'issue-1')
    record.fields = { ...record.fields, nativeValues: {} }
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    assert.deepEqual(await storage.listFieldValues(id, membership), [], '空组 = 清空旧值，不留残行')
  })

  test(`${adapter.label}：redacted item clears the field rows persisted while it was visible`, async () => {
    const { storage, planning, id, context } = await setup(adapter, { mapping: MAPPING_IN_PROGRESS })
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    const record = planning.state.items.find((item) => item.ref.externalId === 'issue-1')
    const membership = record.membership.externalId
    assert.ok((await storage.listFieldValues(id, membership)).length > 0, '前置：可见时留下了字段值')
    // 平台扣下内容：provider 仍给出完整读取面，但原生值为空（GitHub 侧 redacted 行就是这个形状）。
    record.content = { kind: ContentKind.Redacted, reason: RedactionReason.PermissionDenied }
    record.fields = { ...record.fields, nativeValues: {} }
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    assert.deepEqual(await storage.listFieldValues(id, membership), [],
      '被扣下的条目不得继续把上次可见的值留在库里：一次诊断或导出就能读回 Provider 已收回的值')
  })

  test(`${adapter.label}：redacted item clears stale rows even when the provider omits nativeValues`, async () => {
    const { storage, planning, id, context } = await setup(adapter, { mapping: MAPPING_IN_PROGRESS })
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    const record = planning.state.items.find((item) => item.ref.externalId === 'issue-1')
    const membership = record.membership.externalId
    assert.ok((await storage.listFieldValues(id, membership)).length > 0, '前置：可见时留下了字段值')
    // 对抗验证实测的缺口：只靠 Provider 发空对象不够。这里让被扣下的条目**省略** nativeValues（表示「没有读取面」），
    // core 仍必须清空上次可见时落库的行——「不得把已收回的值留在库里」是 core 的义务，不是 Provider 的记忆义务。
    record.content = { kind: ContentKind.Redacted, reason: RedactionReason.PermissionDenied }
    const { nativeValues, ...withoutNativeValues } = record.fields
    record.fields = withoutNativeValues
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    assert.deepEqual(await storage.listFieldValues(id, membership), [],
      'Provider 省略读取面时，被扣下的条目同样不得留下上次可见的字段值行')
  })

  test(`${adapter.label}：invalid option and scope are rejected before any write`, async () => {
    const storage = adapter.make()
    const planning = createFakePlanningProvider({ bindingId: BINDING })
    const rejectedId = newWorkspaceId()
    await assert.rejects(
      createContext({ workspace: workspaceInput(rejectedId, { ...MAPPING_IN_PROGRESS, bindingId: 'other-binding' }), providers: { planning, storage } }),
      TypeError, '映射的 binding scope 不符必须在注册前拒绝')
    assert.equal(await storage.getWorkspace(rejectedId), undefined, '被拒绝的注册不得留下工作区行')

    const validScope = await setup(adapter, { mapping: statusMapping({ not_an_option: 'todo' }) })
    const before = await validScope.storage.currentRevision(validScope.id)
    const failed = await bootstrapWorkspace(validScope.context)
    assert.equal(failed.ok, false, 'option id 不在定义内必须整次失败')
    assert.equal(await validScope.storage.currentRevision(validScope.id), before, '失败不得推进 revision')
    assert.deepEqual(await validScope.storage.listPlanningProjections(validScope.id), [], '失败不得写投影')
    assert.equal((await validScope.storage.getWorkspace(validScope.id)).planningFieldMapping, undefined, '失败不得写新映射')
    await assert.rejects(
      createContext({ workspace: workspaceInput(newWorkspaceId(), statusMapping({ in_progress: 'unknown' })), providers: { planning, storage } }),
      TypeError, 'Unknown 不得作为人工映射目标')
  })

  test(`${adapter.label}：concurrent bootstrap serializes and commits in call order`, async () => {
    const storage = adapter.make()
    const inner = createFakePlanningProvider({ bindingId: BINDING })
    let release; const gate = new Promise((resolve) => { release = resolve })
    const slow = Object.create(inner)
    slow.listPlanningItems = async (input) => { await gate; return inner.listPlanningItems(input) }
    const id = newWorkspaceId()
    const context = await createContext({
      workspace: workspaceInput(id, MAPPING_IN_PROGRESS), providers: { planning: slow, storage },
    })
    const first = bootstrapWorkspace(context)
    context.pendingPlanningFieldMapping = MAPPING_DONE
    const second = bootstrapWorkspace(context)
    release()
    const [a, b] = await Promise.all([first, second])
    assert.deepEqual([a.ok, b.ok], [true, true])
    assert.equal(await storage.currentRevision(id), 2, '两个 bootstrap 各自提交一次，串行推进')
    assert.deepEqual((await storage.getWorkspace(id)).planningFieldMapping, MAPPING_DONE, '后一次调用的 pending 最后提交')
    assert.equal(statusOf(await itemViews(context), 'issue-4').normalized, 'done', '最终映射是按调用顺序的后一次，不被先到的旧 pending 覆盖')
  })

  test(`${adapter.label}：field value replacement rejects foreign scope and duplicates without leaving rows`, async () => {
    const { storage, planning, id, context } = await setup(adapter, { mapping: MAPPING_IN_PROGRESS })
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    const membership = membershipOf(planning, 'issue-1')
    const foreignMembership = membershipOf(planning, 'issue-2')
    const before = await storage.listFieldValues(id, membership)
    const foreignBefore = await storage.listFieldValues(id, foreignMembership)
    assert.ok(before.length > 0)
    const record = (overrides = {}) => ({ workspaceId: id, itemExternalId: membership, projectFieldId: 'field-x', value: '{"kind":"date","date":null}', observedAt: '2026-10-06T00:00:00Z', ...overrides })
    await assert.rejects(storage.replaceFieldValues(id, membership, [record({ itemExternalId: foreignMembership })]), '已存在的另一成员关系也必须被拒绝')
    assert.deepEqual(await storage.listFieldValues(id, membership), before, '反方向跨 scope 替换不得删除本条目或写入另一个条目')
    assert.deepEqual(await storage.listFieldValues(id, foreignMembership), foreignBefore, '反方向跨 scope 替换不得污染另一条目')
    await assert.rejects(storage.replaceFieldValues(id, membership, [record({ itemExternalId: 'other-item' })]), '跨 scope 记录必须被拒绝')
    assert.deepEqual(await storage.listFieldValues(id, membership), before, '被拒绝的整组替换不得留下半组')
    await assert.rejects(storage.replaceFieldValues(id, membership, [record(), record()]), '组内重复 projectFieldId 必须被拒绝')
    assert.deepEqual(await storage.listFieldValues(id, membership), before)
    await assert.rejects(storage.replaceFieldValues(id, 'item-none', [record({ itemExternalId: 'item-none' })]), '成员关系不存在必须被拒绝')
    assert.deepEqual(await storage.listFieldValues(id, membership), before)
  })

  test(`${adapter.label}：same-second field value change changes the observation dedupe key`, async () => {
    const planning = createFakePlanningProvider({ bindingId: BINDING })
    const seeded = planning.state.observations.find((observation) => observation.subject.externalId === 'issue-4')
    assert.deepEqual(seeded.payload.nativeValues.status, { kind: 'single_select', optionId: 'done', name: 'Done' }, '观察的稳定负载必须带原生字段值')
    const changed = planning.emitObservation({
      ref: seeded.subject, type: seeded.type, eventTime: seeded.eventTime,
      stableFields: { ...seeded.payload, nativeValues: { status: { kind: 'single_select', optionId: 'todo', name: 'Todo' } } },
    })
    assert.notEqual(changed.dedupeKey, seeded.dedupeKey, '同一秒内字段值变化必须改变 dedupeKey')
  })
}
