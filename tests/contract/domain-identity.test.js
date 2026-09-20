/**
 * 领域身份契约测试（tests/README.md §2 优先级 1）。保护的不变量：1) 内部实体 id 不透明且永久——Draft→Issue 提升后 id 不变，旧身份 historical、新身份 primary；2) 同一实体任一时刻只有一个 active primary，且 activePrimary 必须按 entity 过滤；3) 同一外部对象在两个工作区时身份一份、投影两份，提升前必须查重并在被别的实体占用时给出占用者；4) 不同实体种类的 id 在类型上不可混用（由 tsc 执行）。
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  IdentityRole,
  activePrimary,
  externalObjectKey,
  findIdentityOccupant,
  newEntityId,
  newExternalIdentityId,
  newProviderBindingId,
  newWorkspaceId,
  newWorkItemId,
  projectIntoWorkspace,
  promoteDraftToIssue,
  registerIdentity,
} from '@harness-projects/domain'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const bindingId = newProviderBindingId()
const identity = (overrides) => ({
  id: newExternalIdentityId(),
  entityId: newEntityId(),
  bindingId,
  externalKind: 'draft',
  externalId: 'DRAFT-1',
  role: IdentityRole.Primary,
  ...overrides,
})
test('标识：生成值是不透明且唯一的字符串，品牌只在类型层存在', async () => {
  const first = newWorkItemId()
  assert.match(first, UUID_V4)
  assert.notEqual(first, newWorkItemId())
  assert.equal(typeof first, 'string')
  assert.equal(Object.hasOwn(first, '__brand'), false, '品牌只在类型层，运行时不得带品牌字段')

  const source = await readFile(path.join(repoRoot, 'packages/domain/src/ids.ts'), 'utf8')
  assert.match(
    source,
    /@ts-expect-error[^\n]*\n\s+readonly mixedBrands: BrandedIdMustSatisfy<'ChangeRequestId', WorkItemId>/,
    'ids.ts 必须保留 WorkItemId → ChangeRequestId 的 @ts-expect-error 自检（由 tsc 强制执行）',
  )
})
test('身份：Draft→Issue 提升保持内部实体 id 不变，旧身份转 historical、新身份为 primary', () => {
  const entityId = newEntityId()
  const draft = identity({ entityId })
  const alias = identity({ entityId, externalKind: 'issue', externalId: 'ISSUE-9', role: IdentityRole.Alias })
  const result = promoteDraftToIssue({ entityId, identities: [draft, alias], issueExternalId: 'ISSUE-1' })
  assert.equal(result.ok, true, '目标身份未被占用时提升必须成功')
  const byId = new Map(result.identities.map((item) => [item.id, item]))

  assert.equal(result.promoted, true)
  assert.equal(result.entityId, entityId, '提升不得新建实体：内部 id 必须原样返回')
  assert.equal(result.identities.length, 3)
  assert.deepEqual(
    [...new Set(result.identities.map((item) => item.entityId))],
    [entityId],
    '提升后所有身份必须仍指向同一个实体',
  )
  assert.equal(byId.get(draft.id).role, IdentityRole.Historical, '旧身份保留原 id，只降级')
  assert.equal(byId.get(alias.id).role, IdentityRole.Alias, 'alias 身份不受提升影响')

  const primary = activePrimary(result.identities, entityId)
  assert.equal(primary.length, 1, '同一实体任一时刻只有一个 active primary')
  assert.equal(primary[0].externalKind, 'issue')
  assert.equal(primary[0].externalId, 'ISSUE-1')
  assert.notEqual(primary[0].id, draft.id, '新主身份必须是新身份，不能复用旧 draft 身份')

  const again = promoteDraftToIssue({ entityId, identities: result.identities, issueExternalId: 'ISSUE-1' })
  assert.equal(again.ok, true)
  assert.equal(again.promoted, false, '已提升过的实体再提升必须是幂等空操作')
  assert.deepEqual(again.identities, result.identities)
})
test('身份：目标外部身份已被别的实体占用时提升被拒绝，并给出占用者', () => {
  const entityId = newEntityId()
  const otherEntityId = newEntityId()
  const draft = identity({ entityId })
  const occupant = identity({ entityId: otherEntityId, externalKind: 'issue', externalId: 'ISSUE-1' })
  const identities = [draft, occupant]

  assert.equal(
    findIdentityOccupant(identities, { bindingId, externalKind: 'issue', externalId: 'ISSUE-1' }).id,
    occupant.id,
    '查重纯函数必须按 (binding, kind, externalId) 命中已登记身份',
  )
  assert.equal(findIdentityOccupant(identities, { bindingId, externalKind: 'issue', externalId: 'ISSUE-2' }), undefined)

  const result = promoteDraftToIssue({ entityId, identities, issueExternalId: 'ISSUE-1' })
  assert.equal(result.ok, false, '同一外部身份已挂在别的实体上时不得提升')
  assert.equal(result.conflict.reason, 'external_identity_occupied')
  assert.equal(result.conflict.occupant.id, occupant.id, '冲突必须指出占用者，让上层能定位')
  assert.equal(result.conflict.occupant.entityId, otherEntityId)

  assert.deepEqual(
    activePrimary(identities, entityId).map((item) => item.id),
    [draft.id],
    'activePrimary 必须按 entity 过滤，不得把别的实体的 primary 读成本实体的主身份',
  )
  assert.deepEqual(activePrimary(identities, otherEntityId).map((item) => item.id), [occupant.id])
})
test('身份：同一实体重复提升不产生第二个 primary，且复用已登记的 issue 身份 id', () => {
  const entityId = newEntityId()
  const first = promoteDraftToIssue({ entityId, identities: [identity({ entityId })], issueExternalId: 'ISSUE-1' })
  assert.equal(first.ok, true)
  const registeredIssue = first.identities.find((item) => item.externalKind === 'issue')

  // 提升后该实体又被观察到一条新的 primary draft（重复观察走了另一条登记路径）。
  const second = promoteDraftToIssue({
    entityId,
    identities: [...first.identities, identity({ entityId })],
    issueExternalId: 'ISSUE-1',
  })

  assert.equal(second.ok, true)
  assert.equal(second.promoted, true)
  const primaries = activePrimary(second.identities, entityId)
  assert.equal(primaries.length, 1, '同一实体任一时刻只有一个 active primary')
  assert.equal(primaries[0].externalId, 'ISSUE-1')
  assert.equal(primaries[0].id, registeredIssue.id, '目标身份已登记时必须复用原 id，不得新增第二条身份')
  assert.equal(
    second.identities.filter((item) => item.externalKind === 'issue' && item.externalId === 'ISSUE-1').length,
    1,
    '同一外部对象只允许一条身份',
  )
})
test('身份：同一外部对象出现在两个工作区时，外部身份一份、投影两份', () => {
  const entityId = newEntityId()
  const observed = identity({ entityId })
  const registry = registerIdentity(registerIdentity([], observed), {
    ...observed,
    id: newExternalIdentityId(),
    role: IdentityRole.Alias,
  })

  assert.equal(registry.length, 1, '同一 (binding, kind, externalId) 只允许一份外部身份')
  assert.equal(registry[0].id, observed.id, '重复观察不得更换已分配的身份 id')
  assert.equal(
    Object.hasOwn(registry[0], 'workspaceId'),
    false,
    '外部身份不得绑定工作区，否则同一对象会被复制成多份身份',
  )
  assert.equal(
    externalObjectKey(bindingId, 'draft', 'DRAFT-1'),
    externalObjectKey(bindingId, 'draft', 'DRAFT-1'),
    '外部对象键必须稳定可复算',
  )

  const [first, second] = [newWorkspaceId(), newWorkspaceId()]
  const projections = [first, second].map((workspaceId) => projectIntoWorkspace(registry[0], workspaceId))
  assert.equal(projections.length, 2, '身份只有一份，但每个工作区各有一份投影')
  assert.deepEqual(projections.map((item) => item.workspaceId), [first, second])
  assert.deepEqual(projections[1], { workspaceId: second, identityId: observed.id, entityId })
})
