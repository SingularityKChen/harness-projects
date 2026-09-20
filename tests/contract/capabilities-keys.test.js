/**
 * capability key 与访问级别契约测试。
 *
 * 保护的不变量：1) 调用方只按 capability key 分支，key 表里不得出现任何平台/provider 名字，
 * 也不得被平台名片段污染；2) AccessLevel 四态是四个不同取值，且在类型上互不兼容
 * （类型级检查见 packages/capabilities/src/capability-keys.ts 的 AccessLevelIsolationCheck）；
 * 3) intersectAccess 满足“任一 unavailable → unavailable、任一 read_only → read_only”。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AccessLevel,
  CapabilityDomain,
  CapabilityKey,
  bindingForCapability,
  effectiveCapabilities,
  intersectAccess,
} from '@harness-projects/capabilities'

/** 禁止片段：这些名字只允许出现在 provider 实现里，绝不能进入调用方分支依据。 */
const FORBIDDEN_PROVIDER_NAME_FRAGMENTS = [
  'github', 'gitlab', 'bitbucket', 'jira', 'linear', 'asana', 'trello', 'notion', 'azure', 'sqlite', 'harness', 'local',
]

test('capability key 表中不含任何 provider / 平台名字，取值形状稳定', () => {
  const keys = Object.values(CapabilityKey)
  assert.equal(keys.length, 28)
  const domains = new Set(Object.values(CapabilityDomain))
  for (const key of keys) {
    for (const fragment of FORBIDDEN_PROVIDER_NAME_FRAGMENTS) {
      assert.ok(!key.includes(fragment), `capability key「${key}」不得含 provider 名片段「${fragment}」`)
    }
    assert.match(key, /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)
    assert.ok(domains.has(key.split('.')[0]), `capability key「${key}」的域前缀必须是五个能力域之一`)
  }
})

test('AccessLevel 四态在运行时是四个不同取值，类型上互不兼容（tsc 检查 AccessLevelIsolationCheck）', () => {
  assert.equal(
    JSON.stringify(AccessLevel),
    '{"Available":"available","ReadOnly":"read_only","Unavailable":"unavailable","Degraded":"degraded"}',
  )
  assert.equal(new Set(Object.values(AccessLevel)).size, 4)
})

test('intersectAccess：任一 unavailable 则 unavailable，任一 read_only 则 read_only', () => {
  const { Available, ReadOnly, Unavailable, Degraded } = AccessLevel
  assert.equal(intersectAccess(Available, Available, Available), Available)
  assert.equal(intersectAccess(Unavailable, Available, Available), Unavailable)
  assert.equal(intersectAccess(Available, Unavailable, Degraded), Unavailable)
  assert.equal(intersectAccess(ReadOnly, Available, Available), ReadOnly)
  assert.equal(intersectAccess(Available, ReadOnly, Available), ReadOnly)
  assert.equal(intersectAccess(Available, Available, ReadOnly), ReadOnly)
  // read_only 严于 degraded：可读不可写比部分可用更严格。
  assert.equal(intersectAccess(ReadOnly, Degraded, Available), ReadOnly)
  assert.equal(intersectAccess(Degraded, Available, Available), Degraded)
  // unavailable 是交的下界，不能被更宽松的输入捞回来。
  for (const level of Object.values(AccessLevel)) {
    assert.equal(intersectAccess(Unavailable, level, level), Unavailable)
    assert.equal(intersectAccess(level, Unavailable, level), Unavailable)
    assert.equal(intersectAccess(level, level, Unavailable), Unavailable)
  }
})

test('effectiveCapabilities：未声明的 capability 不出现，缺 permission 视为 unavailable', () => {
  const snapshot = {
    bindingId: 'binding-1',
    observedAt: '2026-09-20T00:00:00Z',
    capability: {
      [CapabilityKey.PlanningItemRead]: AccessLevel.Available,
      [CapabilityKey.PlanningStatusWrite]: AccessLevel.Available,
    },
    permission: { [CapabilityKey.PlanningItemRead]: AccessLevel.Available },
  }
  const capabilities = effectiveCapabilities(snapshot)
  const access = new Map(capabilities.map((capability) => [capability.key, capability.access]))
  assert.equal(access.size, 2)
  assert.equal(access.get(CapabilityKey.PlanningItemRead), AccessLevel.Available)
  assert.equal(access.get(CapabilityKey.PlanningStatusWrite), AccessLevel.Unavailable)
})

test('storage 能力键存在，且按能力解析绑定能落到 storage 域', () => {
  assert.deepEqual(Object.values(CapabilityKey).filter((key) => key.startsWith('storage.')),
    [CapabilityKey.StorageWorkspaceRead, CapabilityKey.StorageWorkspaceWrite, CapabilityKey.StorageMigrationApply])
  const binding = { ref: { workspaceId: 'ws-1', bindingId: 'binding-1', domain: CapabilityDomain.Storage }, enabled: true, capabilities: [{ key: CapabilityKey.StorageWorkspaceRead, access: AccessLevel.Available }] }
  assert.equal(bindingForCapability({ bindings: [binding] }, CapabilityKey.StorageWorkspaceRead)?.ref.domain, CapabilityDomain.Storage)
})
