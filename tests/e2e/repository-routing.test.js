/**
 * 按操作在并列引用之间路由（#353，ADR-0015 Accepted）。经 `createWorkspaceSetup` 把一个仓库绑到 Local Git 型与 GitHub 型测试连接，再以返回的
 * bindingId 组合离线替身；替身声明的 key 集合与真实 provider 相同（AC2 声明一致）。保护的不变量：开始工作按锚点 `worktree.create` 选唯一声明它的引用，
 * 不看角色与登记顺序（AC2 并列引用）；多个声明者 conflict、没有声明者 not_supported，都零 provider 调用、不取第一个注册者（AC2 歧义，不变量 5）；
 * `historical` 身份不是现行引用，锚点所在连接未组合时 alias 仍是现行引用。元数据逐仓库报告引用与按路由得到的 `development.*` 能力（AC5），
 经 controller 快照、client 同步到达 ui-model 的 `repositoryAccessIndex`，key 级 fail closed 盖不住它（AC3）。两种存储：替身 Storage 与 SQLite 文件。全部离线：无凭据、无网络。
 */
import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { CapabilityKey } from '@harness-projects/capabilities'
import { createEntityStore, createSync, createTransport } from '@harness-projects/client'
import { composeCore, createWorkspaceSetup } from '@harness-projects/core'
import { createController, toWireMetadata, watchWorkspace } from '@harness-projects/controller'
import { newExternalIdentityId, newProviderBindingId, newWorkspaceId } from '@harness-projects/domain'
import { createGithubDevelopmentProvider } from '@harness-projects/provider-development-github'
import { createLocalGitDevelopmentProvider } from '@harness-projects/provider-development-local-git'
import { createFakeDevelopmentProvider, createFakeExecutionProvider, createFakePlanningProvider, createFakeStorage, emptyStorageData } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { LineageTarget, accessIndex, lineageEntryPoints, repositoryAccessIndex, startWorkAvailability } from '@harness-projects/ui-model'

const dir = mkdtempSync(join(tmpdir(), 'harness-repository-routing-'))
after(() => rmSync(dir, { recursive: true, force: true }))
const REPOSITORY = 'repo-alpha'
const [LOCAL_GIT, LOCAL_GIT_2, GITHUB, GITHUB_2] = ['test.local-git', 'test.local-git-2', 'test.github', 'test.github-2']
/** 测试实现键的配置 schema 为空：core 不读配置（D9），存储只需接受挂载配置。 */
const POLICY = { allowedSecretHandles: new Set(), configurations: new Map([LOCAL_GIT, LOCAL_GIT_2, GITHUB, GITHUB_2].map((key) => [key, {}])) }
let files = 0
const ADAPTERS = [['替身 Storage', () => createFakeStorage(emptyStorageData(), POLICY)], ['SQLite Storage', () => createSqliteStorage(join(dir, `r-${files++}.sqlite`), POLICY)]]

/** Local Git 只声明仓库读、建分支、建工作树与读工作树；GitHub Development 只声明仓库读与变更请求读（F4）。替身的其余开关按此关掉。 */
const FLAGS = {
  'local-git': { worktreeRemove: false, changeRequestCreate: false },
  github: { branchCreate: false, worktreeCreate: false, worktreeRead: false, worktreeRemove: false, changeRequestCreate: false },
}
const withoutChangeRequestRead = (levels) => Object.fromEntries(Object.entries(levels).filter(([key]) => key !== CapabilityKey.DevelopmentChangeRequestRead))

/** 记录调用的替身（`describeCapabilities` 不计）：实现键由 Proxy 覆盖；替身恒声明 `change_request.read`，Local Git 型从快照里去掉它（S4）。`before` 按方法名在调用前插入一步（制造交错）。 */
function typedFake(type, implementationKey, bindingId, before = {}) {
  const calls = []
  const definition = { implementationKey, domains: ['development'] }
  const port = new Proxy(createFakeDevelopmentProvider({ bindingId, capabilities: FLAGS[type] }), {
    get(target, key) {
      if (key === 'definition') return definition
      const value = Reflect.get(target, key, target)
      if (typeof value !== 'function') return value
      if (key !== 'describeCapabilities') return (...args) => { calls.push(String(key)); return before[key] === undefined ? value.apply(target, args) : before[key]().then(() => value.apply(target, args)) }
      if (type === 'github') return () => value.call(target)
      return async () => { const snapshot = await value.call(target); return { ...snapshot, capability: withoutChangeRequestRead(snapshot.capability), permission: withoutChangeRequestRead(snapshot.permission) } }
    },
  })
  return { port, calls }
}

/**
 * 建工作区、以一条命令绑定仓库（引用按 `references` 的顺序，第一条 Development 引用是 primary），再组合 `mounts` 列出的替身：
 * 每项 `[type, implementationKey, binding]`，binding 是返回的 bindingIds 的下标或一个未绑定的 bindingId；缺省按引用逐条组合。
 */
async function setup(makeStorage, references, mounts = references.map(([type, key], index) => [type, key, index])) {
  const { storage, workspaceId, commands } = await newWorkspace(makeStorage)
  const bindingIds = await bindRepository(commands, workspaceId, REPOSITORY, references)
  const fakes = mounts.map(([type, key, binding]) => typedFake(type, key, typeof binding === 'number' ? bindingIds[binding] : binding))
  return { ...(await compose(storage, workspaceId, fakes)), storage, fakes, bindingIds }
}

/** 建工作区并返回它的设置命令；各仓库的绑定与组合由调用方接着做。 */
async function newWorkspace(makeStorage) {
  const storage = makeStorage()
  const workspaceId = newWorkspaceId()
  const commands = createWorkspaceSetup(storage)
  assert.equal((await commands.createWorkspace({ workspaceId, name: 'Routing', statusPolicy: 'provider_authoritative' })).ok, true)
  return { storage, workspaceId, commands }
}

/** 以一条命令绑定仓库：每条引用 `[type, implementationKey]`，第一条是 primary；返回按引用顺序的 bindingIds。 */
async function bindRepository(commands, workspaceId, repositoryId, references) {
  const bound = await commands.bindRepository({ workspaceId, repositoryId, references: references.map(([, implementationKey]) => ({ domain: 'development', implementationKey, configuration: {} })) })
  assert.equal(bound.ok, true, '绑定命令成功')
  return bound.value.bindingIds
}

async function compose(storage, workspaceId, fakes) {
  const core = await composeCore({ workspace: { id: workspaceId, name: 'Routing' }, storage, providers: { planning: createFakePlanningProvider(), execution: createFakeExecutionProvider(), development: fakes.map(({ port }) => port) } })
  const workItemId = (await core.queries.listPlanningItems()).find((view) => view.kind === 'work_item' && view.content.contentKind === 'work_item').entityId
  const start = (idempotencyKey, repositoryId = REPOSITORY) => core.commands.startWork({ workItemId, repositoryId, actor: { kind: 'agent' }, idempotencyKey })
  return { core, start, workItemId }
}

test('AC2 声明一致：两种替身声明的 key 集合分别等于真实 Local Git 与 GitHub Development provider 的声明', async () => {
  const keysOf = async (port) => Object.keys((await port.describeCapabilities()).capability).sort()
  const [local, remote] = [newProviderBindingId(), newProviderBindingId()]
  const localGit = createLocalGitDevelopmentProvider({ bindingId: local, repository: { externalId: REPOSITORY, path: dir } })
  const github = createGithubDevelopmentProvider({ bindingId: remote, repository: { externalId: REPOSITORY, owner: 'octo', name: REPOSITORY }, transport: async () => { throw new Error('offline') } })
  assert.deepEqual(await keysOf(typedFake('local-git', LOCAL_GIT, local).port), await keysOf(localGit), 'Local Git 型替身')
  assert.deepEqual(await keysOf(typedFake('github', GITHUB, remote).port), await keysOf(github), 'GitHub 型替身')
})

for (const [label, makeStorage] of ADAPTERS) {
  for (const order of [['local-git', 'github'], ['github', 'local-git']]) {
    test(`AC2 并列引用：开始工作只调 Local Git 型，GitHub 型零调用（${order[0]} 为 primary，${label}）`, async () => {
      const { start, fakes } = await setup(makeStorage, order.map((type) => [type, type === 'github' ? GITHUB : LOCAL_GIT]))
      const result = await start('parallel-1')
      assert.deepEqual([result.writeState, result.status, result.error], ['saved', 'ready', undefined], '开始工作 Saved')
      const [local, remote] = order[0] === 'local-git' ? fakes : [...fakes].reverse()
      assert.ok(['getRepository', 'createBranch', 'createWorktree'].every((name) => local.calls.includes(name)), `Local Git 型收到仓库 ack、建分支与建工作树：${local.calls}`)
      assert.deepEqual(remote.calls, [], 'GitHub 型零调用')
    })
  }

  test(`AC2 歧义：多个声明者 conflict、没有声明者 not_supported，零 provider 调用、无上下文（${label}）`, async () => {
    const twoLocal = await setup(makeStorage, [['local-git', LOCAL_GIT], ['local-git', LOCAL_GIT_2]])
    const ambiguous = await twoLocal.start('ambiguous-1')
    assert.equal(ambiguous.error?.code, 'conflict')
    assert.ok(twoLocal.bindingIds.every((id) => ambiguous.error.message.includes(id)) && ambiguous.error.message.includes('不取第一个注册者'), ambiguous.error.message)
    const twoGithub = await setup(makeStorage, [['github', GITHUB], ['github', GITHUB_2]])
    const undeclared = await twoGithub.start('ambiguous-2')
    assert.deepEqual([undeclared.error?.code, undeclared.error?.message.includes(CapabilityKey.DevelopmentWorktreeCreate)], ['not_supported', true], `点名锚点 key，不是第一道门：${undeclared.error?.message}`)
    // ADR-0015 约束③：没有声明者时带出服务该仓库的连接 id（conflict 带声明者 id，见上）。
    assert.ok(twoGithub.bindingIds.every((id) => undeclared.error.message.includes(id)), `not_supported 带出服务连接的 id：${undeclared.error.message}`)
    for (const [world, result] of [[twoLocal, ambiguous], [twoGithub, undeclared]]) {
      assert.deepEqual([result.executionContextId, world.fakes.map(({ calls }) => calls)], [undefined, [[], []]], '零 provider 调用')
      assert.equal(await world.core.queries.getExecutionContext({ workItemId: world.workItemId, repositoryId: REPOSITORY }), undefined, '没有上下文')
    }
  })

  test(`historical 身份不是现行引用：锚点实体上的 historical 不参与选择（${label}）`, async () => {
    const stale = newProviderBindingId()
    const world = await setup(makeStorage, [['local-git', LOCAL_GIT], ['github', GITHUB]], [['local-git', LOCAL_GIT, 0], ['github', GITHUB, 1], ['local-git', LOCAL_GIT_2, stale]])
    const { entityId } = await world.storage.findExternalIdentity(world.bindingIds[0], 'repository', REPOSITORY)
    await world.storage.putExternalIdentity({ id: newExternalIdentityId(), entityId, bindingId: stale, externalKind: 'repository', externalId: REPOSITORY, role: 'historical' })
    const result = await world.start('historical-1')
    assert.deepEqual([result.writeState, world.fakes[2].calls], ['saved', []], '只有 primary 的 Local Git 型被路由到，historical 所在的连接零调用')
  })

  test(`锚点所在连接未组合：开始工作经实体确认仍走 Local Git 型 alias（${label}）`, async () => {
    const world = await setup(makeStorage, [['github', GITHUB], ['local-git', LOCAL_GIT]], [['local-git', LOCAL_GIT, 1]])
    const result = await world.start('unmounted-anchor-1')
    assert.deepEqual([result.writeState, result.error], ['saved', undefined], 'GitHub 型（primary）没有组合时，alias 所在的 Local Git 型仍是现行引用')
  })

  test(`开始工作路由之后、认领之前有并发绑定：认领回滚、无外部写入，不给已登记的仓库补第二条同类引用（风险 R5，${label}）`, async () => {
    const { storage, workspaceId, commands } = await newWorkspace(makeStorage)
    const hostMount = newProviderBindingId()
    let bound
    // 交错：路由读到「未登记、单挂载」之后，仓库 ack 返回之前，绑定命令登记同一仓库（新建 Local Git 型与 GitHub 型连接）。
    const host = typedFake('local-git', LOCAL_GIT, hostMount, { getRepository: async () => { bound = await bindRepository(commands, workspaceId, REPOSITORY, [['local-git', LOCAL_GIT], ['github', GITHUB]]) } })
    const { core, start, workItemId } = await compose(storage, workspaceId, [host])
    const result = await start('race-1')
    assert.deepEqual([result.writeState, result.error?.code, host.calls], ['failed', 'unavailable', ['getRepository']], `认领回滚，没有建分支或工作树：${result.error?.message}`)
    assert.equal(await storage.findExternalIdentity(hostMount, 'repository', REPOSITORY), undefined, '路由到的连接下没有补出 alias')
    const { entityId } = await storage.findExternalIdentity(bound[0], 'repository', REPOSITORY)
    assert.deepEqual((await storage.listIdentitiesForEntity(entityId)).map(({ bindingId, role }) => [bindingId, role]).sort(), [[bound[0], 'primary'], [bound[1], 'alias']].sort(), '仓库只有绑定命令写下的两条引用')
    assert.equal(await core.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY }), undefined, '没有上下文')
    // 原因可识别：unavailable 的恢复动作是 retry（原样重发即重读：新请求重新路由）。重发得到缺路由 conflict（不是终态歧义），仍无外部写入；Host 按新挂载重组（#354）后它消失。
    assert.deepEqual([result.error.recovery, result.error.retryable, result.error.message.startsWith('本地登记失败，没有发起任何外部写入')], ['retry', true, true], result.error.message)
    const retried = await start('race-1')
    assert.deepEqual([retried.writeState, retried.error?.code, host.calls], ['failed', 'conflict', ['getRepository']], `重发重新路由：仓库已登记在不在注册表里的连接下，缺路由 conflict，不再调 provider：${retried.error?.message}`)
  })

  test(`开始工作路由之后、认领之前，并发绑定给已登记的仓库加上第二条声明锚点的引用：认领放行，与「先开始工作、后绑定」的顺序执行同一结果（D15 补充，${label}）`, async () => {
    const { storage, workspaceId, commands } = await newWorkspace(makeStorage)
    const [hostMount] = await bindRepository(commands, workspaceId, REPOSITORY, [['local-git', LOCAL_GIT]])
    let bound
    // 交错：路由读到「已登记、唯一引用在 A」之后，仓库 ack 返回之前，绑定命令给同一仓库加一条另一实现的 Local Git 型引用（新连接 B，同样声明 worktree.create）。
    const host = typedFake('local-git', LOCAL_GIT, hostMount, { getRepository: async () => { bound = await bindRepository(commands, workspaceId, REPOSITORY, [['local-git', LOCAL_GIT], ['local-git', LOCAL_GIT_2]]) } })
    const { core, start } = await compose(storage, workspaceId, [host])
    const result = await start('concurrent-declarer-1')
    assert.deepEqual([bound[0], result.writeState, result.error], [hostMount, 'saved', undefined], '绑定复用 A、新建 B；开始工作经 A Saved')
    assert.ok(['createBranch', 'createWorktree'].every((name) => host.calls.includes(name)), `经 A 建分支与工作树：${host.calls}`)
    // 认领里重新路由也得到 A：B 是绑定命令新铸的连接 id，不在运行中 core 的注册表里，路由的读集（注册表挂载下的引用）没有变。
    const served = (await core.queries.getWorkspaceMetadata()).repositories[0].capabilities
    assert.ok(START_WORK_KEYS.every((key) => entryOf(served, key)?.bindingId === hostMount), '同一 core 的逐仓库路由仍是 A')
    // 落库状态与顺序执行「先开始工作、后绑定」相同：A primary、B alias，同一实体；之后同时挂上 A 与 B 的组合按「AC2 歧义」得结构化 conflict。
    const { entityId } = await storage.findExternalIdentity(hostMount, 'repository', REPOSITORY)
    assert.deepEqual((await storage.listIdentitiesForEntity(entityId)).map(({ bindingId, role }) => [bindingId, role]).sort(), [[hostMount, 'primary'], [bound[1], 'alias']].sort())
  })
}


const START_WORK_KEYS = [CapabilityKey.DevelopmentWorktreeCreate, CapabilityKey.DevelopmentBranchCreate, CapabilityKey.DevelopmentRepositoryRead, CapabilityKey.DevelopmentWorktreeRead]
const entryOf = (entries, key) => entries.find((entry) => entry.key === key)

/** 注册顺序（r-twin 最先）与 id 升序不同；r-twin 的两条 Local Git 型引用实现键不同，路由歧义。 */
const REPOSITORIES = [
  ['r-twin', [['local-git', LOCAL_GIT], ['local-git', LOCAL_GIT_2]]],
  ['r-remote', [['github', GITHUB]]],
  ['r-both', [['local-git', LOCAL_GIT], ['github', GITHUB]]],
  ['r-local', [['local-git', LOCAL_GIT]]],
]

for (const [label, makeStorage] of ADAPTERS) {
  test(`AC5 元数据逐仓库报告引用与服务连接：开始工作的四个 key 由 Local Git 型服务，变更请求读由 GitHub 型服务，且就是开始工作实际调用的那个（${label}）`, async () => {
    const world = await setup(makeStorage, [['local-git', LOCAL_GIT], ['github', GITHUB]])
    const [local, remote] = world.fakes
    const { repositories, capabilities } = await world.core.queries.getWorkspaceMetadata()
    assert.deepEqual(repositories.map((repository) => repository.id), [REPOSITORY])
    const [{ references, capabilities: served }] = repositories
    assert.deepEqual(references, [{ bindingId: world.bindingIds[0], role: 'primary' }, { bindingId: world.bindingIds[1], role: 'alias' }])
    assert.deepEqual(served.map((entry) => entry.key).sort(), [...START_WORK_KEYS, CapabilityKey.DevelopmentChangeRequestRead].sort(), '每个 key 恰好一条')
    for (const key of START_WORK_KEYS) assert.deepEqual([entryOf(served, key).bindingId, entryOf(served, key).access], [world.bindingIds[0], 'available'], `${key} 由 Local Git 型服务`)
    assert.deepEqual([entryOf(served, CapabilityKey.DevelopmentChangeRequestRead).bindingId, entryOf(served, CapabilityKey.DevelopmentChangeRequestRead).access], [world.bindingIds[1], 'available'], '变更请求读由 GitHub 型服务')
    assert.equal(entryOf(capabilities, CapabilityKey.DevelopmentWorktreeCreate).access, 'unavailable', '工作区级仍是 key 级 fail closed（两个 Development 挂载）')
    assert.equal((await world.start('metadata-1')).writeState, 'saved')
    assert.deepEqual([local.calls.length > 0, remote.calls], [true, []], '开始工作实际调用的就是元数据报告的服务连接')
  })

  test(`AC3 没有已登记仓库：元数据是空数组，wire 头没有 repositories 字段，client 读到 undefined（${label}）`, async () => {
    const { storage, workspaceId } = await newWorkspace(makeStorage)
    const { core } = await compose(storage, workspaceId, [typedFake('local-git', LOCAL_GIT, newProviderBindingId())])
    assert.deepEqual((await core.queries.getWorkspaceMetadata()).repositories, [])
    const controller = createController(core)
    assert.deepEqual(Object.keys(await controller.baseline()).sort(), ['capabilities', 'entities', 'planningSource', 'revision', 'source', 'workspace'], '没有 repositories 字段（planningSource 来自替身规划挂载，#383）')
    const sync = createSync(createTransport(controller), createEntityStore())
    await sync.connect()
    assert.equal(sync.read().repositories, undefined)
    const bare = await composeCore({ workspace: { name: 'Bare' }, providers: { planning: createFakePlanningProvider() } })
    assert.deepEqual((await bare.queries.getWorkspaceMetadata()).repositories, [], '没有 Storage 的 core 也有空数组')
  })

  test(`AC3 逐仓库可用性经快照与 client 同步到达 ui-model：按仓库判定，不被 key 级 fail closed 盖住；帧头校验与携带（${label}）`, async () => {
    const { storage, workspaceId, commands } = await newWorkspace(makeStorage)
    const fakes = []
    for (const [repositoryId, references] of REPOSITORIES) {
      const bindingIds = await bindRepository(commands, workspaceId, repositoryId, references)
      fakes.push(...references.map(([type, key], index) => typedFake(type, key, bindingIds[index])))
    }
    const controller = createController((await compose(storage, workspaceId, fakes)).core)
    const base = await controller.baseline()
    assert.deepEqual(base.repositories.map((repository) => repository.id), ['r-both', 'r-local', 'r-remote', 'r-twin'], '按 id 升序')
    for (const repository of base.repositories) {
      assert.deepEqual(Object.keys(repository).sort(), ['capabilities', 'id'], '不下发引用')
      assert.ok(repository.capabilities.every((entry) => Object.keys(entry).sort().join() === 'access,key,reason'), '能力项不带 bindingId')
    }
    assert.equal(entryOf(base.capabilities, CapabilityKey.DevelopmentWorktreeCreate).access, 'unavailable', '工作区级仍是 key 级 fail closed')
    const twin = base.repositories.find((repository) => repository.id === 'r-twin').capabilities
    assert.ok(START_WORK_KEYS.every((key) => entryOf(twin, key).access === 'unavailable' && entryOf(twin, key).reason.includes('不取第一个注册者')), '歧义逐仓库报告，原因是路由的拒绝文案')

    const sync = createSync(createTransport(controller), createEntityStore())
    await sync.connect()
    const read = sync.read()
    assert.deepEqual(read.repositories, base.repositories, 'client 原样收下逐仓库条目')
    const entryPoint = (index) => lineageEntryPoints(index).find((entry) => entry.target === LineageTarget.ChangeRequest).available
    const availability = (id) => {
      const index = repositoryAccessIndex(read.capabilities, read.repositories.find((repository) => repository.id === id).capabilities)
      return [startWorkAvailability(index).available, entryPoint(index)]
    }
    assert.deepEqual(['r-both', 'r-remote', 'r-local', 'r-twin'].map(availability), [[true, true], [false, true], [true, false], [false, false]], '开始工作 / 变更请求入口')
    assert.deepEqual([startWorkAvailability(accessIndex(read.capabilities)).available, entryPoint(accessIndex(read.capabilities))], [false, false], '对照：只有工作区级索引时被 key 级 fail closed 盖住')

    const poll = (change) => {
      const next = structuredClone(base)
      change(next)
      return watchWorkspace({ baseline: async () => next }, { afterRevision: base.revision, seed: base }).poll()
    }
    sync.receive({ kind: 'metadata', metadata: toWireMetadata(base) })
    assert.deepEqual(sync.read().repositories, base.repositories, '同修订 metadata 帧携带 repositories，client 接受且不变')
    const [{ capabilities: [capability] }] = base.repositories
    const malformed = [
      'x', [{ id: '', capabilities: [] }], [{ id: 'a', capabilities: [], extra: 1 }], [{ id: 'a', capabilities: [] }, { id: 'a', capabilities: [] }],
      [{ id: 'a', capabilities: [{ ...capability, bindingId: 'b' }] }], [{ id: 'a', capabilities: [{ ...capability, key: 'no.such.key' }] }],
      [{ id: 'a', capabilities: [capability, capability] }], [{ id: 'a' }],
    ]
    for (const repositories of malformed) {
      assert.throws(() => sync.receive({ kind: 'metadata', metadata: { ...toWireMetadata(base), repositories } }), /帧头不合契约/, JSON.stringify(repositories))
      assert.deepEqual(sync.read().repositories, base.repositories, '被拒绝的帧不留半个新状态')
    }
    const narrowed = await poll((next) => { next.repositories = next.repositories.slice(0, 1) })
    assert.deepEqual([narrowed.kind, narrowed.metadata.repositories], ['metadata', base.repositories.slice(0, 1)], '只有 repositories 变化也是来源变化，发 metadata')
    sync.receive(narrowed)
    assert.deepEqual(sync.read().repositories, base.repositories.slice(0, 1))
    sync.receive(await poll((next) => { delete next.repositories }))
    assert.equal(sync.read().repositories, undefined, '帧头整体替换：新帧没有 repositories 就不保留旧的')
    const advanced = await poll((next) => { next.revision += 1; next.source.revision += 1; next.repositories = next.repositories.slice(1) })
    assert.deepEqual([advanced.kind, advanced.delta.repositories], ['delta', base.repositories.slice(1)], 'delta 携带 repositories')
    sync.receive(advanced)
    assert.deepEqual(sync.read().repositories, base.repositories.slice(1))
  })
}
