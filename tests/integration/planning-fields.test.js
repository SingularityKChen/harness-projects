/**
 * #133 的 Host 侧契约（两种 Storage 各一轮，只经 `createContext` / `bootstrapWorkspace` / `createQueries`）：映射之外绝不归一；
 * 值按 project field id 定位，同一 option id 在两个 Project 互不影响（R2）；再次同步整行覆盖展示事实；redacted 内容（含违约
 * Provider 带着的值）不产出字段事实；映射在注册时校验并冻结。原生值来自 Project A 的录制；Project B 没有回放夹具，按沙箱登记
 * 与 E1-2 实验 1 的读回合成（`docs/architecture/gate-e1-sandbox.md`、`docs/architecture/gate-e1-membership-and-draft.md`）。
 * SQLite 文件库关闭重开后，规范状态与三列展示事实逐字读回；回放账本没有未命中。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { bootstrapWorkspace, createContext, createQueries } from '@harness-projects/core'
import { RedactionReason, newProviderBindingId, newWorkspaceId } from '@harness-projects/domain'
import { createFakePlanningProvider, createFakeStorage, fixtureProjectRef } from '@harness-projects/provider-fake'
import { createGithubProjectsPlanningProvider } from '@harness-projects/provider-planning-github-projects'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { createReplay, loadFixture } from '../contract/fixtures/github-projects/replay.js'

const fixture = loadFixture()
const PROJECT_A = fixture.exchanges.find((exchange) => exchange.operationName === 'PlanningProject').variables.project
/** 沙箱实测（Gate E1 R2）：两个 Project 的 Status 字段 id 不同，option id 相同。 */
const [STATUS_A, STATUS_B, DATE_A, ITERATION_A] = ['PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY', 'PVTSSF_lAHOAY1ahM4BkJ9szhi7jXQ', 'PVTF_lAHOAY1ahM4BkJ9rzhi7k9I', 'PVTIF_lAHOAY1ahM4BkJ9rzhi7k9M']
const [TODO, IN_PROGRESS, DONE] = ['f75ad846', '47fc9ee4', '98236657']
const [ALPHA, SHARED, WITH_FIELDS] = ['I_kwDOUjWAl88AAAABST4WDQ', 'I_kwDOUjWAl88AAAABST4Wtw', 'I_kwDOUjWAl88AAAABST4XVQ']
const STORAGES = [['内存 Storage 替身', createFakeStorage], ['SQLite Storage', () => createSqliteStorage(':memory:')]]

const statusMapping = (projectFieldId, options) => ({ status: { projectFieldId, options } })
const projectRef = (bindingId, externalId) => ({ bindingId, objectKind: 'project', externalId, url: undefined })

/** 注册工作区后（`beforeSync(context)` 在注册与引导之间运行）引导一次，返回查询视图。 */
async function syncWith(storage, planning, project, planningFieldMapping, beforeSync = () => {}) {
  const workspace = { id: newWorkspaceId(), name: '字段', project, ...(planningFieldMapping === undefined ? {} : { planningFieldMapping }) }
  const context = await createContext({ workspace, providers: { planning, storage } })
  beforeSync(context)
  assert.equal((await bootstrapWorkspace(context)).ok, true)
  return createQueries(context).listPlanningItems()
}
/** 录制的 Project A 或合成的 Project B，经真实 GitHub provider 解码。 */
function syncGithub(makeStorage, projectNodeId, transport, mapping, beforeSync) {
  const bindingId = newProviderBindingId()
  const planning = createGithubProjectsPlanningProvider({ bindingId, projectNodeId, transport })
  return syncWith(makeStorage(), planning, projectRef(bindingId, projectNodeId), mapping, beforeSync)
}
const misses = []
const syncProjectA = (makeStorage, mapping, beforeSync) => {
  const replay = createReplay(fixture)
  misses.push(replay.misses)
  return syncGithub(makeStorage, PROJECT_A, replay.transport, mapping, beforeSync)
}
const FULL_MAPPING = { ...statusMapping(STATUS_A, { [TODO]: 'todo' }), iterationFieldId: ITERATION_A, targetDateFieldId: DATE_A }
const fieldsOf = (views, externalId) => {
  const view = views.find((entry) => entry.content.identity.externalId === externalId)
  return [view.planningStatus, view.planningFields]
}

/**
 * Project B 的合成响应：沙箱登记的 B（`PVT_kwHOAY1ahM4BkJ9s`，1 个条目）里 issue-shared（#2）的成员关系、B 的 Status 字段与
 * E1-2 实验 1 读回的 Done；内容逐字取自 Project A 录制里的同一条 Issue。A 的录制里它是 In Progress（A 的 Status 字段）。
 */
const PROJECT_B = 'PVT_kwHOAY1ahM4BkJ9s'
const sharedContent = fixture.exchanges.flatMap((exchange) => exchange.body.data.node.items?.nodes ?? []).find((node) => node.content.id === SHARED).content
const select = (fieldId, optionId, name) => ({ __typename: 'ProjectV2ItemFieldSingleSelectValue', field: { id: fieldId, name: 'S' }, optionId, name })
const projectB = (values = [select(STATUS_B, DONE, 'Done')]) => async ({ operationName }) => ({
  status: 200, headers: {}, body: { data: { node: operationName === 'PlanningProject'
    ? { __typename: 'ProjectV2', id: PROJECT_B, title: 'E1 Project B', url: 'u', updatedAt: '2026-09-21T07:16:14Z' }
    : { __typename: 'ProjectV2', items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{
      id: 'PVTI_lAHOAY1ahM4BkJ9szg75k8c', type: 'ISSUE', createdAt: '2026-09-21T06:59:18Z', updatedAt: '2026-09-21T07:16:14Z', content: sharedContent,
      fieldValues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: values },
    }] } } } },
})

for (const [label, makeStorage] of STORAGES) {
  test(`${label}：没有工作区映射时任何原生状态都不归一（名字恰为 Todo 也不行），也没有展示事实`, async () => {
    const views = await syncProjectA(makeStorage, undefined)
    assert.equal(views.length, 9)
    assert.deepEqual(views.map((view) => [view.planningStatus, view.planningFields]), Array(9).fill(['unknown', undefined]))
  })

  test(`${label}：只归一映射列出的 option；未列出的只留原生名；迭代与目标日期按角色取，读回逐字一致`, async () => {
    const views = await syncProjectA(makeStorage, FULL_MAPPING)
    assert.deepEqual(fieldsOf(views, ALPHA), ['todo', { statusName: 'Todo' }])
    assert.deepEqual(fieldsOf(views, WITH_FIELDS), ['unknown', { statusName: 'In Progress', iterationTitle: 'E1 Sprint 1', targetDate: '2026-09-24' }],
      'In Progress 未被映射：规范状态是 unknown，原生名只作为展示事实')
  })

  test(`${label}：同一 Issue 在两个 Project 的状态按各自的字段 id 定位（R2），一个 Project 的映射不会套到另一个`, async () => {
    const options = { [IN_PROGRESS]: 'in_progress', [DONE]: 'done' }
    const mappedA = await syncProjectA(makeStorage, statusMapping(STATUS_A, options))
    const mappedB = await syncGithub(makeStorage, PROJECT_B, projectB(), statusMapping(STATUS_B, options))
    const foreign = await syncGithub(makeStorage, PROJECT_B, projectB(), statusMapping(STATUS_A, options))
    assert.deepEqual([fieldsOf(mappedA, SHARED), fieldsOf(mappedB, SHARED), fieldsOf(foreign, SHARED)],
      [['in_progress', { statusName: 'In Progress' }], ['done', { statusName: 'Done' }], ['unknown', undefined]],
      'E1-2 实验 1 的期望投影：(A, in_progress)、(B, done)')
  })

  test(`${label}：schema 可空的选项值：optionId 为 null 等同没有值（同步照常成功），名称为 null 仍按 option id 归一、不产出原生名`, async () => {
    const views = await syncGithub(makeStorage, PROJECT_B, projectB([select(STATUS_B, DONE, null), select('PVTSSF_priority', null, null)]), statusMapping(STATUS_B, { [DONE]: 'done' }))
    assert.deepEqual(fieldsOf(views, SHARED), ['done', undefined])
  })

  test(`${label}：再次同步整行覆盖展示事实：值变化与清空都生效；转为 redacted 后即使 Provider 违约带着值也不留任何字段事实`, async () => {
    const bindingId = newProviderBindingId()
    const planning = createFakePlanningProvider({ bindingId })
    const item = (externalId) => planning.state.items.find((entry) => entry.ref.externalId === externalId)
    const sprint = { kind: 'iteration', iterationId: 'i-1', title: 'Sprint 1', startDate: '2026-09-01', durationDays: 14 }
    const values = (optionId, extra) => ({ status: { kind: 'single_select', optionId, name: optionId }, sprint, ...extra })
    for (const externalId of ['issue-1', 'issue-2']) item(externalId).fields = { ...item(externalId).fields, nativeValues: values('todo', { due: { kind: 'date', date: '2026-09-24' } }) }
    const mapping = { ...statusMapping('status', { todo: 'todo', done: 'done' }), iterationFieldId: 'sprint', targetDateFieldId: 'due' }
    const context = await createContext({ workspace: { id: newWorkspaceId(), name: '字段', project: fixtureProjectRef(bindingId), planningFieldMapping: mapping }, providers: { planning, storage: makeStorage() } })
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    item('issue-1').content = { kind: 'redacted', reason: RedactionReason.PermissionDenied } // 原生值仍挂着：违约 Provider
    item('issue-2').fields = { ...item('issue-2').fields, nativeValues: values('done') }
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    const views = await createQueries(context).listPlanningItems()
    assert.deepEqual(fieldsOf(views, 'issue-1'), ['unknown', undefined], '转为 redacted：不产出、也不留下任何字段事实')
    assert.deepEqual(fieldsOf(views, 'issue-2'), ['done', { statusName: 'done', iterationTitle: 'Sprint 1' }], '正控：状态更新、日期清空；迭代起始日不是目标日期')
  })
}

const register = (planningFieldMapping, storage = createFakeStorage(), id = newWorkspaceId()) =>
  createContext({ workspace: { id, name: '字段', planningFieldMapping }, providers: { planning: createFakePlanningProvider({ bindingId: newProviderBindingId() }), storage } })

test('映射在注册时深拷贝、校验并冻结：调用方事后改自己的对象不影响已校验的映射，已注册的映射每一层都不可改', async () => {
  const mapping = statusMapping(STATUS_A, { [TODO]: 'todo' })
  const views = await syncProjectA(createFakeStorage, mapping, () => Object.assign(mapping.status, { projectFieldId: 'elsewhere', options: { [TODO]: 'Done' } }))
  assert.deepEqual(fieldsOf(views, ALPHA), ['todo', { statusName: 'Todo' }])
  const registered = (await register(statusMapping(STATUS_A, { [TODO]: 'todo' }))).planningFieldMapping
  assert.deepEqual([registered, registered.status, registered.status.options].map(Object.isFrozen), [true, true, true])
  assert.throws(() => { registered.status.options[DONE] = 'done' }, TypeError)
})

test('非法映射在注册前以 TypeError 拒绝，不写任何行：unknown 是缺失哨兵；角色键是闭集、字段 id 是非空字符串、映射与 options 是普通对象', async () => {
  const cases = [
    ...['unknown', 'Done', undefined].map((target) => [`目标 ${target}`, statusMapping('status', { todo: target })]),
    ['非对象映射', 'nonsense'], ['数组映射', []], ['日期对象映射', new Date(0)], ['options 是 Map', statusMapping('status', new Map([['o', 'todo']]))], ['status 不是对象', { status: 'status' }], ['空字段 id', statusMapping('', {})], ['options 为 null', statusMapping('status', null)],
    ['options 是数组', statusMapping('status', [])], ['非字符串字段 id', { iterationFieldId: 42 }], ['空日期字段 id', { targetDateFieldId: '' }], ['未知角色键', { iterationFieldID: 'x' }],
  ]
  for (const [name, mapping] of cases) {
    const [storage, id] = [createFakeStorage(), newWorkspaceId()]
    await assert.rejects(register(mapping, storage, id), TypeError, name)
    assert.equal(await storage.getWorkspace(id), undefined, `${name}：被拒绝的注册不得留下工作区行`)
  }
})

test('SQLite 文件库：规范状态与展示事实随投影确认，关闭重开后逐字读回', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'planning-fields-'))
  const path = join(dir, 'workspace.sqlite')
  try {
    let context
    const views = await syncProjectA(() => createSqliteStorage(path), FULL_MAPPING, (registered) => { context = registered })
    context.storage.close()
    const reopened = createSqliteStorage(path)
    try {
      const reread = await createQueries({ ...context, storage: reopened }).listPlanningItems()
      assert.deepEqual(reread, views)
      assert.deepEqual(fieldsOf(reread, WITH_FIELDS), ['unknown', { statusName: 'In Progress', iterationTitle: 'E1 Sprint 1', targetDate: '2026-09-24' }], '正控：三列展示事实确实落库')
    } finally { reopened.close() }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('回放账本：本文件所有回放都没有未命中的请求', () => {
  assert.ok(misses.length > 0)
  assert.deepEqual(misses.flat(), [])
})
