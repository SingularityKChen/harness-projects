/** 离线 Planning 替身的契约套件装配，外加两条判别性用例。判别性用例保护的不变量：(1) draft→issue 提升只改外部 id，内部实体 id 由调用方保持（不变量 1）；(2) 过期 source version 的字段写必须报 conflict 且不得改动对象（ack 前不得显示权威已保存）。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { promoteDraftToIssue } from '@harness-projects/domain'
import { createFakePlanningProvider, fixtureProjectRef } from '@harness-projects/provider-fake'
import { planningContractSuite } from './suites/planning.js'

const bindingId = 'binding-fake-planning'
const project = fixtureProjectRef(bindingId)
const item = (externalId, objectKind, contentKind) => ({ externalId, objectKind, contentKind })

planningContractSuite({
  label: '离线 Planning 替身（issue-backed）',
  makeProvider: (scenario = {}) => createFakePlanningProvider({ bindingId, fixture: 'issue-backed', ...scenario }),
  expect: {
    project,
    pageSize: 2,
    items: [
      item('issue-1', 'issue', 'work_item'),
      item('issue-2', 'issue', 'work_item'),
      item('issue-3', 'issue', 'redacted'),
      item('issue-4', 'issue', 'work_item'),
      item('pr-7', 'change_request', 'change_request'),
    ],
    redactedReason: 'policy_restricted',
  },
})

test('Planning 替身：draft→issue 提升只改外部 id，内部实体 id 由调用方保持', async () => {
  const provider = createFakePlanningProvider({ bindingId, fixture: 'draft-backed' })
  const draftRef = { bindingId, objectKind: 'draft', externalId: 'draft-1', url: undefined }
  const promoted = provider.promoteDraft(draftRef, 'issue-100')
  assert.equal(promoted.ok, true)
  assert.equal(promoted.value.ref.externalId, 'issue-100')
  assert.equal(promoted.value.ref.objectKind, 'issue')
  assert.equal((await provider.getPlanningItem(draftRef)).ok, false, '旧外部 id 必须查不到')

  // provider 只给新外部 id；内部实体 id 由 domain 的纯函数原样保持，绝不新建实体。
  const identity = { id: 'identity-1', entityId: 'entity-1', bindingId, externalKind: 'draft', externalId: 'draft-1', role: 'primary' }
  const result = promoteDraftToIssue({ entityId: 'entity-1', identities: [identity], issueExternalId: promoted.value.ref.externalId })
  assert.equal(result.entityId, 'entity-1')
  assert.equal(result.identities.find((i) => i.role === 'primary')?.externalId, 'issue-100')
})

test('Planning 替身：过期 source version 的字段写返回 conflict 且不改动对象', async () => {
  const provider = createFakePlanningProvider({ bindingId, fixture: 'issue-backed' })
  const itemRef = { bindingId, objectKind: 'issue', externalId: 'issue-1', url: undefined }
  const before = await provider.getPlanningItem(itemRef)
  const result = await provider.updatePlanningFields({ ref: itemRef, patch: { statusKey: 'done' }, expectedSourceVersion: 'v-stale' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'conflict')
  const after = await provider.getPlanningItem(itemRef)
  assert.deepEqual(after.value.fields, before.value.fields)
  assert.equal(after.value.sourceVersion, before.value.sourceVersion)
})
