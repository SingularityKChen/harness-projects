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
  bindingForRef,
  effectiveCapabilities,
  intersectAccess,
  providerRegistry,
} from '@harness-projects/capabilities'

/** 禁止片段：这些名字只允许出现在 provider 实现里，绝不能进入调用方分支依据。 */
const FORBIDDEN_PROVIDER_NAME_FRAGMENTS = [
  'github', 'gitlab', 'bitbucket', 'jira', 'linear', 'asana', 'trello', 'notion', 'azure', 'sqlite', 'harness', 'local',
]

test('capability key 表中不含任何 provider / 平台名字，取值形状稳定', () => {
  const keys = Object.values(CapabilityKey)
  assert.equal(keys.length, 31)
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
  const binding = { ref: { workspaceId: 'ws-1', bindingId: 'binding-1', domain: CapabilityDomain.Storage }, enabled: true, isDefault: true, capabilities: [{ key: CapabilityKey.StorageWorkspaceRead, access: AccessLevel.Available }] }
  assert.equal(bindingForCapability({ bindings: [binding] }, CapabilityKey.StorageWorkspaceRead)?.ref.domain, CapabilityDomain.Storage)
})

/** 纯 Registry 挂载：只带本域 port（占位对象），能力表按 key 声明。 */
const mount = (domain, bindingId, isDefault, keys = {}, workspaceId = 'ws-1') => ({
  ref: { workspaceId, bindingId, domain }, enabled: true, isDefault, capabilities: Object.entries(keys).map(([key, access]) => ({ key, access })),
  planning: undefined, development: undefined, delivery: undefined, execution: undefined, storage: undefined, [domain]: {},
})

test('providerRegistry：同 id 跨域与主 + 备用合法；跨工作区、重复挂载、多个 Planning（默认）、多个备用与非 Execution 备用、串域 port 被拒绝而不是取第一条', () => {
  const planning = mount('planning', 'conn-1', true)
  assert.equal(providerRegistry([planning, mount('development', 'conn-1', true), mount('execution', 'run-1', true), mount('execution', 'run-2', false)]).bindings.length, 4)
  for (const [bindings, message] of [
    [[planning, mount('planning', 'conn-1', false)], /重复/],
    [[planning, mount('planning', 'conn-2', true)], /默认/],
    [[mount('development', 'conn-1', false)], /备用/],
    [[mount('execution', 'run-1', true), mount('execution', 'run-2', false), mount('execution', 'run-3', false)], /多个备用/],
    [[mount('execution', 'run-1', true), mount('execution', 'run-2', true)], /默认/],
    [[planning, mount('development', 'conn-1', true, {}, 'ws-2')], /工作区/],
    [[{ ...planning, development: {} }], /port/],
  ]) assert.throws(() => providerRegistry(bindings), { name: 'TypeError', message })
})

test('bindingForCapability：按 key 的域与主 / 备用角色选目标；主目标不可用时不另找可用实例，读在主缺失时才用唯一备用', () => {
  const { Available, Unavailable } = AccessLevel
  const { PlanningItemRead, DevelopmentRepositoryRead, ExecutionRunStart, ExecutionRunRead, ExecutionRunFallback } = CapabilityKey
  const fallback = mount('execution', 'run-2', false, { [ExecutionRunStart]: Available, [ExecutionRunFallback]: Available, [ExecutionRunRead]: Available })
  const registry = providerRegistry([
    mount('planning', 'conn-1', true, { [PlanningItemRead]: Available }), mount('development', 'conn-1', true, { [DevelopmentRepositoryRead]: Available }),
    mount('execution', 'run-1', true, { [ExecutionRunStart]: Unavailable, [ExecutionRunRead]: Unavailable }), fallback,
  ])
  const target = (key, from = registry) => bindingForCapability(from, key)?.ref
  assert.deepEqual([PlanningItemRead, DevelopmentRepositoryRead].map((key) => target(key)?.domain), ['planning', 'development'], '共享 id 下按 key 的域取挂载')
  assert.deepEqual([ExecutionRunStart, ExecutionRunRead, ExecutionRunFallback].map((key) => target(key)?.bindingId), ['run-1', 'run-1', 'run-2'], '主 unavailable 仍选主，备用只响应 fallback key')
  const onlyFallback = providerRegistry([fallback])
  assert.deepEqual([target(ExecutionRunRead, onlyFallback)?.bindingId, target(ExecutionRunStart, onlyFallback)], ['run-2', undefined], '读在主缺失时用备用；备用即使声明了 start，start 也永不落到备用（拒绝而不是改道）')
})

test('bindingForRef：严格匹配工作区 + 连接 + 域并要求启用；重复输入拒绝而不是取第一条', () => {
  const development = mount('development', 'conn-1', true)
  const registry = { bindings: [mount('planning', 'conn-1', true), development] }
  const find = (ref, from = registry) => bindingForRef(from, { workspaceId: 'ws-1', bindingId: 'conn-1', domain: 'development', ...ref })
  assert.deepEqual([find({}), find({ domain: 'delivery' }), find({ workspaceId: 'ws-2' }), find({ bindingId: 'conn-2' })], [development, undefined, undefined, undefined])
  assert.equal(find({}, { bindings: [{ ...development, enabled: false }] }), undefined, '未启用的挂载不是目标')
  assert.throws(() => find({}, { bindings: [development, development] }), { name: 'TypeError', message: /重复/ })
})
