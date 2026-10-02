/**
 * 连接实现身份与原子注册（#197，ExecPlan `2026-10-01-provider-binding-registration`）。
 * 同一组场景在内存替身与 `:memory:` SQLite 上同形运行（不复制断言）：同一连接挂到多个域读回多个挂载；
 * 校验、快照与 Storage 的任何失败都整批回滚（不留工作区、孤儿锚点或半批挂载）；
 * 写命令、链读与取消落到提供该能力的那个挂载，取消回到签发它的 Execution 挂载。
 */
import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { AccessLevel, CapabilityKey, effectiveCapabilities, providerRegistry } from '@harness-projects/capabilities'
import { ExternalIdentityKind } from '@harness-projects/domain'
import {
  cancelExecutionRun, composeCore, contextIdFor, createContext, gateCommand, readChainFacts, resolveWriteTarget, runIdFor,
} from '@harness-projects/core'
import { LOCAL_GIT_PROVIDER_DEFINITION, createLocalGitDevelopmentProvider } from '@harness-projects/provider-development-local-git'
import { HUMAN_EXECUTION_PROVIDER_DEFINITION, createHumanExecutionProvider } from '@harness-projects/provider-execution-human'
import {
  FAKE_PROVIDER_DEFINITION, createFakeDeliveryProvider, createFakeDevelopmentProvider, createFakeExecutionProvider,
  createFakePlanningProvider, createFakeStorage, refOf,
} from '@harness-projects/provider-fake'
import { GITHUB_PROJECTS_PROVIDER_DEFINITION, createGithubProjectsPlanningProvider } from '@harness-projects/provider-planning-github-projects'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

const WS = 'ws-1'
const SHARED = 'conn-shared'
const KEY = 'harness.fake'
const QUERY = { workItemId: 'wi-1', repositoryId: 'repo-alpha' }
const DOMAINS = ['planning', 'development', 'delivery', 'execution']
const definition = (implementationKey, ...domains) => ({ implementationKey, domains })
const fakes = (id = SHARED) => ({
  planning: createFakePlanningProvider({ bindingId: id }), development: createFakeDevelopmentProvider({ bindingId: id }),
  delivery: createFakeDeliveryProvider({ bindingId: id }), execution: createFakeExecutionProvider({ bindingId: id }),
})
const bound = (target, value) => (typeof value === 'function' ? value.bind(target) : value)
/** 覆盖对象的个别成员，其余原样透传到真实对象（port、Storage 或事务句柄）。 */
const wrap = (target, over) => new Proxy(target, {
  get: (object, key) => (key in over ? over[key] : bound(object, Reflect.get(object, key, object))),
})
const patched = (port, patch) => wrap(port, { describeCapabilities: async () => patch(await port.describeCapabilities()) })
/** 快照补丁：把 levels 并进 capability 与 permission（或只并进点名的那一个）。 */
const withLevels = (levels, ...parts) => (snapshot) => ({
  ...snapshot,
  ...Object.fromEntries((parts.length > 0 ? parts : ['capability', 'permission']).map((part) => [part, { ...snapshot[part], ...levels }])),
})

/** Storage 探针：数事务与挂载写入，可在第 failAt 次挂载写入处抛错，可把事务 ack 压住；其余原样转给真实 Storage。 */
function probe(storage, { failAt, hold } = {}) {
  const seen = { transactions: 0, puts: 0 }
  const putProviderBinding = (tx) => async (record) => {
    if (++seen.puts === failAt) throw new Error('注入：Storage 拒绝了后序挂载')
    return tx.putProviderBinding(record)
  }
  const transaction = async (work) => {
    seen.transactions += 1
    const result = await storage.transaction((tx) => work(wrap(tx, { putProviderBinding: putProviderBinding(tx) })))
    await hold
    return result
  }
  return { seen, storage: wrap(storage, { transaction }) }
}
const compose = (storage, providers, { workspace, policy = {} } = {}) =>
  createContext({ workspace: { id: WS, name: '新名', ...workspace }, providers, storage, policy })
const row = (id, domain, key = KEY, isDefault = true) => `${id}|${domain}|${key}|true|${isDefault}`
const rows = async (storage, workspaceId = WS) => (await storage.listProviderBindings(workspaceId))
  .map((r) => `${r.id}|${r.domain}|${r.implementationKey}|${r.enabled}|${r.isDefault}`).sort()
/** 被拒绝的装配 0 事务，既有工作区原样且没有挂载（`before` 缺省表示本来就没有工作区）。 */
const assertUntouched = async (storage, seen, before) =>
  assert.deepEqual([seen.transactions, await storage.getWorkspace(WS), await rows(storage)], [0, before, []])

/** 路由用的合法挂载：不经注册直接构造，注册先失败就会遮蔽错域。 */
const mountOf = async (domain, port, { patch = (s) => s, workspaceId = WS } = {}) => ({
  ref: { workspaceId, bindingId: SHARED, domain }, enabled: true, isDefault: true,
  capabilities: effectiveCapabilities(patch(await port.describeCapabilities())),
  planning: undefined, development: undefined, delivery: undefined, execution: undefined, storage: undefined, [domain]: port,
})
const minimal = (storage, mounts, workspaceId = WS) =>
  ({ storage, workspaceId, registry: providerRegistry(mounts), clock: () => '2026-10-02T00:00:00Z', policy: {} })
const executionContext = (id, overrides) => ({
  id, workspaceId: WS, workItemId: 'wi-1', repositoryId: 'repo-1', status: 'ready',
  branchExternalId: 'work/wi-1', worktreeExternalId: 'wt-1', provisioningStartedAt: undefined, ...overrides,
})
/** 合法父记录（SQLite 外键）：工作区、实体、仓库、一个 ready 上下文；`contextId` 可换成别的工作区派生的 id 来造"别人的运行"。 */
async function seed(storage, contextId) {
  await storage.putWorkspace({ id: WS, name: '旧名', statusPolicy: 'provider_authoritative' })
  await storage.putProviderBinding({ id: SHARED, workspaceId: WS, domain: 'planning', implementationKey: KEY, enabled: true, isDefault: true })
  for (const [id, kind] of [['wi-1', 'work_item'], ['repo-entity', 'repository']]) await storage.putEntity({ id, kind })
  await storage.putExternalIdentity({
    id: 'repo-identity', entityId: 'repo-entity', bindingId: SHARED, externalKind: ExternalIdentityKind.Repository, externalId: 'repo-alpha', role: 'primary',
  })
  await storage.putRepository({ id: 'repo-1', workspaceId: WS, externalIdentityId: 'repo-identity' })
  await storage.putExecutionContext(executionContext(contextId))
}
/** 由给定 Execution 实例签发一个运行，并以它的引用落一条 running 记录。 */
const issue = async (storage, execution, contextId) => {
  const context = refOf(execution.gate.bindingId, 'execution_context', contextId)
  const { value } = await execution.startRun({ context, command: 'run', environment: {} })
  const run = { id: runIdFor(contextId), workspaceId: WS, contextId, status: 'running', updatedAt: '2026-10-02T00:00:00Z' }
  await storage.putExecutionRun({ ...run, providerRef: value.ref })
}
const statusOf = async (storage, contextId) => (await storage.getExecutionRun(runIdFor(contextId)))?.status
const routed = async (storage) => {
  const f = fakes()
  const mounts = []
  for (const domain of DOMAINS) mounts.push(await mountOf(domain, f[domain]))
  return { f, mounts, context: minimal(storage, mounts) }
}
/** 生产入口：经 composeCore 装配，返回对规划种子里第一个 work_item 开始工作的命令。 */
async function starter(storage, providers, policy) {
  const core = await composeCore({ workspace: { id: WS, name: '新名' }, providers, storage, policy })
  const workItemId = (await core.queries.listPlanningItems()).find((view) => view.content.contentKind === 'work_item').entityId
  return () => core.commands.startWork({ workItemId, repositoryId: 'repo-alpha', idempotencyKey: 'shared', actor: { kind: 'agent' } })
}
const runsOf = (...ports) => ports.map((port) => port.state.runs.length)

const SCENARIOS = [
  ['同一连接挂到 Planning、Development 与 Execution：读回三个挂载，同配置经 composeCore 重复装配幂等，开始工作的写入各进本域实例', async (storage) => {
    const { planning, development, execution } = fakes()
    const context = await compose(storage, { planning, development, execution })
    const expected = [row(SHARED, 'development'), row(SHARED, 'execution'), row(SHARED, 'planning')]
    assert.deepEqual(await rows(storage), expected)
    assert.equal(resolveWriteTarget(context.registry, CapabilityKey.PlanningStatusWrite).binding?.planning, planning)
    const start = await starter(storage, { planning, development, execution })
    assert.deepEqual(await rows(storage), expected, '同配置经 composeCore 重复装配，读回同一组挂载')
    const written = () => [development.state.branches.length, development.state.worktrees.length, ...runsOf(execution), JSON.stringify(planning.state)]
    const before = written()
    const result = await start()
    const after = written()
    assert.deepEqual([result.status, result.writeState, result.fallback, result.error], ['ready', 'saved', undefined, undefined])
    const issued = execution.state.runs.at(-1).ref.externalId === result.runExternalId
    assert.deepEqual([...after.slice(0, 3).map((n, i) => n - before[i]), after[3] === before[3], issued], [1, 1, 1, true, true],
      '分支与工作树进 Development 实例、运行进 Execution 实例，各一个；同 id 的 Planning 实例状态不变')
  }],
  ['Execution 备用与 Planning、Development 共用连接：主挂载 start 不可用时报它不可用，开始工作的运行落在共享 id 的备用实例上', async (storage) => {
    const { planning, development, execution } = fakes()
    const primary = fakes('conn-run').execution
    const spare = patched(execution, withLevels({ [CapabilityKey.ExecutionRunFallback]: AccessLevel.Available }))
    const providers = { planning, development, execution: primary, executionFallback: spare }
    const policy = { [CapabilityKey.ExecutionRunStart]: AccessLevel.Unavailable }
    const context = await compose(storage, providers, { policy })
    assert.equal(resolveWriteTarget(context.registry, CapabilityKey.ExecutionRunStart).error?.message, '能力 execution.run.start 当前不可用',
      '主挂载声明了 start 但不可用：报它不可用，而不是「没有绑定提供」')
    const before = runsOf(execution, primary)
    const result = await (await starter(storage, providers, policy))()
    const delta = runsOf(execution, primary).map((n, i) => n - before[i])
    assert.deepEqual([result.status, result.fallback, result.error, delta], ['ready', 'manual_fallback', undefined, [1, 0]],
      '运行由共享 id 的备用 Execution 实例落下，主实例不被调用')
  }],
  ['一个对象同时服务两个域：只观察一次，每个挂载只含本域 key，合法的域外 key 不被误拒', async (storage) => {
    let described = 0
    const { PlanningItemRead, DevelopmentRepositoryRead, DeliveryPipelineRead } = CapabilityKey
    const level = Object.fromEntries([PlanningItemRead, DevelopmentRepositoryRead, DeliveryPipelineRead].map((key) => [key, AccessLevel.Available]))
    const describeCapabilities = async () => {
      described += 1
      return { bindingId: SHARED, capability: level, permission: level, observedAt: '2026-10-01T00:00:00Z' }
    }
    const noop = async () => undefined
    const planningReads = ['getProject', 'listPlanningItems', 'getPlanningItem', 'listFieldDefinitions', 'listIterations']
    const union = wrap(fakes().development, {
      definition: definition('harness.union', 'planning', 'development'), describeCapabilities,
      ...Object.fromEntries(planningReads.map((name) => [name, noop])),
    })
    const context = await compose(storage, { planning: union, development: union })
    assert.equal(described, 1)
    assert.deepEqual(context.registry.bindings.map((b) => [b.ref.domain, b.capabilities.map((c) => c.key)]),
      [['planning', [PlanningItemRead]], ['development', [DevelopmentRepositoryRead]]])
    assert.deepEqual(await rows(storage), [row(SHARED, 'development', 'harness.union'), row(SHARED, 'planning', 'harness.union')])
  }],
  ['同 id 异实现、同 key 异域集合：静态拒绝且 0 事务；既有锚点冲突由 Storage 裁决，整批回滚且不留孤儿锚点', async (storage) => {
    const { planning, development } = fakes()
    for (const [wrong, message] of [[definition('development.other', 'development'), /实现/], [definition(KEY, 'development'), /域集合/]]) {
      const { seen, storage: probed } = probe(storage)
      await assert.rejects(compose(probed, { planning, development: wrap(development, { definition: wrong }) }), { name: 'TypeError', message })
      await assertUntouched(storage, seen, undefined)
    }
    await compose(storage, { planning, development })
    const before = await rows(storage)
    const second = fakes('conn-second')
    const clash = wrap(development, { definition: definition('development.other', 'development') })
    await assert.rejects(compose(storage, { planning: second.planning, development: clash }, { workspace: { id: 'ws-2' } }))
    assert.deepEqual([await storage.getWorkspace('ws-2'), await rows(storage, 'ws-2'), await rows(storage)], [undefined, [], before],
      '冲突整批回滚：新工作区与先写的挂载都不在，旧 key 仍可读')
    const retried = wrap(second.planning, { definition: definition('planning.other', 'planning') })
    await compose(storage, { planning: retried, development }, { workspace: { id: 'ws-2' } })
    assert.deepEqual(await rows(storage, 'ws-2'), [row('conn-second', 'planning', 'planning.other'), row(SHARED, 'development')],
      '同 id 换 key 重试成功：失败批次没有留下孤儿锚点')
  }],
  ['后序挂载写入被拒：整笔回滚工作区名称、先写的挂载、新锚点与旧默认的降级，换 key 重试成功', async (storage) => {
    const old = fakes('conn-old')
    await compose(storage, { development: old.development }, { workspace: { name: '旧名' } })
    const before = [await storage.getWorkspace(WS), await rows(storage)]
    const { planning, development, delivery } = fakes()
    const { seen, storage: probed } = probe(storage, { failAt: 3 })
    await assert.rejects(compose(probed, { planning, development, delivery }, { workspace: { name: '另一个名' } }), /注入/)
    assert.deepEqual([seen.transactions, await storage.getWorkspace(WS), await rows(storage)], [1, ...before],
      '前后值一致：名称、挂载与旧默认都回到原样')
    const retry = { definition: definition('harness.retry', 'planning', 'development', 'delivery') }
    await compose(storage, { planning: wrap(planning, retry), development: wrap(development, retry), delivery: wrap(delivery, retry) })
    assert.equal((await rows(storage)).filter((line) => line.includes('harness.retry')).length, 3)
  }],
  ['快照在后序挂载抛错：原样失败，0 事务，既有工作区不被改动', async (storage) => {
    await storage.putWorkspace({ id: WS, name: '旧名', statusPolicy: 'manual_only' })
    const before = await storage.getWorkspace(WS)
    const { planning, development } = fakes()
    const { seen, storage: probed } = probe(storage)
    const boom = wrap(development, { describeCapabilities: async () => { throw new Error('快照后序失败') } })
    await assert.rejects(compose(probed, { planning, development: boom }), /快照后序失败/)
    await assertUntouched(storage, seen, before)
  }],
  ['同一 execution 挂载（主与备用共 id）重复：拒绝且 0 事务；异域同 id 与主 + 备用异 id 是合法对照，角色过滤各留自己的 key', async (storage) => {
    const { planning, execution } = fakes()
    const { seen, storage: probed } = probe(storage)
    await assert.rejects(compose(probed, { execution, executionFallback: fakes().execution }), { name: 'TypeError', message: /重复/ })
    await assertUntouched(storage, seen, undefined)
    const { ExecutionRunStart: start, ExecutionRunFallback: fallback } = CapabilityKey
    const both = withLevels({ [fallback]: AccessLevel.Available })
    const context = await compose(storage, { planning, execution: patched(fakes('run-1').execution, both), executionFallback: patched(execution, both) })
    assert.deepEqual(await rows(storage), [row(SHARED, 'execution', KEY, false), row(SHARED, 'planning'), row('run-1', 'execution')])
    const keysOf = (id) => context.registry.bindings.find((b) => b.ref.bindingId === id && b.ref.domain === 'execution').capabilities.map((c) => c.key)
    const roles = ['run-1', SHARED].map((id) => [keysOf(id).includes(start), keysOf(id).includes(fallback)])
    assert.deepEqual(roles, [[true, false], [false, true]], '主不带 fallback，备用不带 start')
  }],
  ['未知 key / 等级 / 域 / 槽位、缺 definition、非法 policy 与工作区：任何写之前拒绝，合法的域外 key 是对照', async (storage) => {
    const { planning, development } = fakes()
    const snapshot = (levels, part) => patched(planning, withLevels(levels, part))
    const overridden = (over) => wrap(planning, over)
    const cases = [
      [{ planning: snapshot({ 'planning.bogus': undefined }, 'capability') }, /planning\.bogus/],
      [{ planning: snapshot({ 'bogus.key': AccessLevel.Available }, 'permission') }, /bogus\.key/],
      [{ planning: snapshot({ [CapabilityKey.PlanningItemRead]: 'superuser' }, 'capability') }, /superuser/],
      [{ planning: overridden({ definition: definition(KEY, 'planning', 'storage') }) }, /storage/],
      [{ planning: overridden({ definition: undefined }) }, /definition/],
      [{ planning: overridden({ definition: definition(KEY, 'development') }) }, /不含它挂载的域/],
      [{ planning: overridden({ definition: definition(KEY, 'planning', 'planning') }) }, /去重/],
      [{ planning: overridden({ definition: definition('   ', 'planning') }) }, /implementationKey/],
      [{ planning: patched(planning, (s) => ({ ...s, bindingId: '' })) }, /bindingId/],
      [{ planning, rogue: development }, /rogue/],
      [{ planning: overridden({ getProject: undefined }) }, /必需方法/],
      [{ planning: overridden({ createIssueWorkItem: 'nope' }) }, /createIssueWorkItem/],
      [{ planning }, /bogus\.key/, { policy: { 'bogus.key': AccessLevel.Available } }],
      [{ planning }, /statusPolicy/, { workspace: { statusPolicy: 'bogus' } }],
      [{ planning }, /workspace\.id/, { workspace: { id: '' } }],
      [{ planning }, /workspace\.name/, { workspace: { name: 42 } }],
    ]
    for (const [providers, message, options] of cases) {
      const { seen, storage: probed } = probe(storage)
      await assert.rejects(compose(probed, providers, options), { name: 'TypeError', message })
      await assertUntouched(storage, seen, undefined)
    }
    const undeclared = CapabilityKey.PlanningStatusWrite
    const foreign = { [CapabilityKey.DeliveryPipelineRead]: AccessLevel.Available }
    const control = patched(planning, (s) => ({
      ...s, capability: { ...s.capability, ...foreign, [undeclared]: undefined }, permission: { ...s.permission, ...foreign },
    }))
    const keys = (await compose(storage, { planning: control })).registry.bindings[0].capabilities.map((c) => c.key)
    assert.deepEqual([keys.every((key) => key.startsWith('planning.')), keys.includes(undeclared)], [true, false],
      '域外 key 不进本域挂载；已知 key 的 undefined 是“未声明”：不被拒绝，也不授予')
  }],
  ['同 key、域集合顺序相反的两个对象是同一个集合：接受', async (storage) => {
    const { planning, development } = fakes()
    const pair = (port, ...domains) => wrap(port, { definition: definition('harness.pair', ...domains) })
    await compose(storage, { planning: pair(planning, 'planning', 'development'), development: pair(development, 'development', 'planning') })
    assert.deepEqual(await rows(storage), [row(SHARED, 'development', 'harness.pair'), row(SHARED, 'planning', 'harness.pair')])
  }],
  ['definition 在快照 await 期间被外部改写：以准备期冻结的副本为准', async (storage) => {
    const { planning } = fakes()
    const mutable = definition('harness.mutable', 'planning')
    const describeCapabilities = async () => {
      mutable.implementationKey = 'harness.changed'
      return planning.describeCapabilities()
    }
    await compose(storage, { planning: wrap(planning, { definition: mutable, describeCapabilities }) })
    assert.deepEqual(await rows(storage), [row(SHARED, 'planning', 'harness.mutable')])
  }],
  ['事务 ack 之前 createContext 不完成：ack 之后一次发布完整 Registry', async (storage) => {
    let release
    const hold = new Promise((resolve) => { release = resolve })
    const { seen, storage: probed } = probe(storage, { hold })
    let settled = false
    const pending = compose(probed, { planning: fakes().planning, development: fakes('conn-dev').development })
      .then((context) => { settled = true; return context })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual([seen.transactions, settled], [1, false])
    release()
    assert.deepEqual((await pending).registry.bindings.map((b) => b.ref.domain), ['planning', 'development'])
  }],
  ['写命令与读门按完整挂载路由：共享 id 的 Planning 挂载排在前面时仍命中各自域的实例', async (storage) => {
    const { f, context } = await routed(storage)
    const port = (binding) => binding?.[binding.ref.domain]
    const keys = [CapabilityKey.DevelopmentBranchCreate, CapabilityKey.ExecutionRunStart, CapabilityKey.PlanningStatusWrite]
    const targets = keys.map((key) => resolveWriteTarget(context.registry, key))
    assert.deepEqual(targets.map(({ binding, error }) => [error, binding?.ref.domain, port(binding) === f[binding?.ref.domain]]),
      [[undefined, 'development', true], [undefined, 'execution', true], [undefined, 'planning', true]])
    assert.equal(port(gateCommand(context.registry, CapabilityKey.DeliveryPipelineRead, 'read').binding), f.delivery)
    const { DevelopmentRepositoryRead: read, DevelopmentBranchCreate: write } = CapabilityKey
    const patch = withLevels({ [read]: AccessLevel.ReadOnly, [write]: AccessLevel.ReadOnly }, 'permission')
    const readOnly = providerRegistry([await mountOf('development', f.development, { patch })])
    const [allowed, refused] = [gateCommand(readOnly, read, 'read'), gateCommand(readOnly, write, 'write')]
    assert.deepEqual([allowed.allowed, allowed.access, refused.allowed, refused.error?.code, resolveWriteTarget(readOnly, write).binding],
      [true, 'read_only', false, 'permission_denied', undefined], 'read_only：读允许，写被拒且没有写目标')
  }],
  ['链读：共享 id 下分支、变更请求、流水线与检查各读到本域实例，没有假缺口', async (storage) => {
    const { f, context } = await routed(storage)
    await seed(storage, contextIdFor(WS, 'wi-1', 'repo-alpha'))
    const repository = refOf(SHARED, 'repository', 'repo-alpha')
    await f.development.createBranch({ repository, name: 'work/wi-1', fromRef: 'main' })
    await f.development.createChangeRequest({ repository, head: 'work/wi-1', base: 'main', title: '共享连接的链读', body: '正文' })
    const facts = await readChainFacts(context, QUERY)
    const observed = [facts.commit.observed, facts.changeRequest.observed, facts.pipelines.map((n) => n.observed), facts.checks.map((n) => n.observed)]
    assert.deepEqual([facts.gaps, ...observed], [[], true, true, [true, true], [true, true, true]])
  }],
  ['取消回到签发它的 Execution 挂载：不被同 id 的 Planning 挂载截走，签发者只读被拒，别的工作区的运行不被取消', async (storage) => {
    const { f, mounts, context } = await routed(storage)
    const contextId = contextIdFor(WS, 'wi-1', 'repo-alpha')
    await seed(storage, contextId)
    await issue(storage, f.execution, contextId)
    const cancel = mock.method(f.execution, 'cancelRun')
    const outcome = async (core, id = contextId) => {
      const result = await cancelExecutionRun(core, QUERY)
      return [result.error?.code, result.status, cancel.mock.callCount(), await statusOf(storage, id)]
    }
    const cancelAs = (level) => mountOf('execution', f.execution, { patch: withLevels({ [CapabilityKey.ExecutionRunCancel]: level }, 'permission') })
    const denied = await outcome(minimal(storage, [mounts[0], await cancelAs(AccessLevel.ReadOnly)]))
    const blocked = await outcome(minimal(storage, [mounts[0], await cancelAs(AccessLevel.Unavailable)]))
    const issuer = await outcome(context)
    const foreignId = contextIdFor('ws-2', 'wi-1', 'repo-alpha')
    await storage.putExecutionContext(executionContext(foreignId, { status: 'closed', branchExternalId: undefined, worktreeExternalId: undefined }))
    await issue(storage, f.execution, foreignId)
    const foreign = await outcome(minimal(storage, [await mountOf('execution', f.execution, { workspaceId: 'ws-2' })], 'ws-2'), foreignId)
    assert.deepEqual({ denied, blocked, issuer, foreign }, {
      denied: ['permission_denied', 'running', 0, 'running'],
      blocked: ['not_supported', 'running', 0, 'running'],
      issuer: [undefined, 'canceled', 1, 'canceled'],
      foreign: ['not_found', undefined, 1, 'running'],
    }, '签发者只读 / 不可用：被拒且 Provider 调用 0；按签发者挂载投递一次；别的工作区的运行记录：拒绝且不调用 Provider')
  }],
]

const STORAGES = [['内存 Storage 替身', () => createFakeStorage()], ['SQLite Storage（:memory:）', () => createSqliteStorage(':memory:')]]
for (const [label, makeStorage] of STORAGES) {
  for (const [name, run] of SCENARIOS) {
    test(`${label}：${name}`, async (t) => {
      const storage = makeStorage()
      t.after(() => storage.close?.())
      await run(storage)
    })
  }
}

test('静态连接实现定义逐字固定：key 会落进持久化锚点，改名等同于换身份；定义冻结，实例引用同一个对象', () => {
  const local = createLocalGitDevelopmentProvider({ repository: { externalId: 'repo-pin', path: '.' } })
  const github = createGithubProjectsPlanningProvider({ bindingId: 'conn-pin', projectNodeId: 'project-pin', transport: async () => undefined })
  const human = [false, true].map((fallback) => createHumanExecutionProvider({ bindingId: `conn-pin-${fallback}`, issuerKey: 'k'.repeat(32), fallback }))
  const pins = [
    [FAKE_PROVIDER_DEFINITION, 'harness.fake', DOMAINS, Object.values(fakes())],
    [LOCAL_GIT_PROVIDER_DEFINITION, 'development.local-git', ['development'], [local]],
    [GITHUB_PROJECTS_PROVIDER_DEFINITION, 'planning.github-projects', ['planning'], [github]],
    [HUMAN_EXECUTION_PROVIDER_DEFINITION, 'execution.human', ['execution'], human],
  ]
  for (const [pinned, implementationKey, domains, ports] of pins) {
    assert.deepEqual(pinned, { implementationKey, domains })
    const frozen = [Object.isFrozen(pinned), Object.isFrozen(pinned.domains), ports.every((port) => port.definition === pinned)]
    assert.deepEqual(frozen, [true, true, true], implementationKey)
  }
})
