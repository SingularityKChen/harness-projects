/**
 * 工作区设置命令（#127）：`createWorkspaceSetup` 的三条 create-or-verify 命令在内存替身与 SQLite 文件上各跑一轮，GitHub 流量走录制回放（不触网）。
 * 保护的不变量：AC1 命令写出的正是 Host 恢复读取的行集，下一次组合的引导读到该项目；AC2 第二个启用的规划来源以 conflict 拒绝且零写入，
 * 并发两次绑定恰好一个成功（不变量 1）；AC3 #202 之前的切换以 not_supported 拒绝且零写入；AC5 凭据只以句柄落库，令牌不进库、不上结果；
 * 原子性：被拒绝的命令不留任何行（#353 继承同一事务模式），只有存储写口的 RangeError 映射成 invalid_input（#376）；AC4 controller 的 `createSetupCommands` 账本丢失后同键重发，由命令按自然键找回同一结果、零写入，
 * 拒绝只在账本存活期间重放（账本丢失后按当时状态重判），账本内同键异请求以 conflict 拒绝且不进 core。
 */
import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createEntityStore, createSync, createTransport } from '@harness-projects/client'
import { createController, createSetupCommands, toWireMetadata, watchWorkspace } from '@harness-projects/controller'
import { composeCore, createWorkspaceSetup } from '@harness-projects/core'
import { createFakeStorage, emptyStorageData, exportFakeStorageState } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { deriveWorkItemDetailView, deriveWorkItemListView } from '@harness-projects/ui-model'
import { PROVIDER_CATALOG, hostStoragePolicy, restoreProviders } from '../../apps/harness-plugin/src/host-providers.ts'
import { HANDLE, WORKSPACE, dump, projectNodeId, replayFetch } from './fixtures/host-seed.js'

const OTHER_WORKSPACE = '00000000-0000-4000-8000-000000000127'
const PLANNING = 'planning.github-projects'
/** 第二个格式合法的 Project 节点 id：只用来制造「另一个规划来源」，从不发请求。 */
const SECOND_PROJECT = 'PVT_secondSetupProject'
/** 令牌哨兵：形如令牌却含下划线，不命中发布面扫描的令牌模式。 */
const CANARY = 'ghp_CANARY_workspace_setup_127'

const workspaceRequest = (overrides = {}) => ({ workspaceId: WORKSPACE, name: 'Setup Workspace', statusPolicy: 'provider_authoritative', ...overrides })
const accountRequest = (overrides = {}) => ({
  platformFamily: 'github', platformOrigin: 'https://github.com', identityKind: 'account', externalId: 'octo-1', displayName: 'Octo', secretHandle: HANDLE, ...overrides,
})
const bindRequest = (accountId, overrides = {}) => ({ workspaceId: WORKSPACE, accountId, implementationKey: PLANNING, configuration: { projectNodeId }, ...overrides })
const codeOf = (outcome) => (outcome.ok ? 'ok' : outcome.error.code)
const envelope = (idempotencyKey) => ({ actorRef: { kind: 'user', id: 'setup-tester' }, idempotencyKey })

const dirs = []
test.after(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }) })

/** 同一份存储策略（缺省是 Host 策略）下的两种存储：`reopen` 换一个实例读同一份内容，`snapshot` 是全部行的转储，`scan` 数落盘内容里 needle 的出现次数。 */
async function openStore(kind, policy = hostStoragePolicy(PROVIDER_CATALOG)) {
  if (kind === 'memory') {
    const exported = (store) => JSON.stringify(exportFakeStorageState(store.storage))
    const store = {
      storage: createFakeStorage(emptyStorageData(), policy),
      reopen: () => (store.storage = createFakeStorage(exportFakeStorageState(store.storage), policy)),
      snapshot: async () => exported(store),
      scan: async (needle) => exported(store).split(needle).length - 1,
      close: () => undefined,
    }
    return store
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'harness-workspace-setup-'))
  dirs.push(dir)
  const dataPath = path.join(dir, 'workspace.sqlite')
  const store = {
    storage: createSqliteStorage(dataPath, policy),
    reopen: () => { store.storage.close(); return (store.storage = createSqliteStorage(dataPath, policy)) },
    snapshot: async () => dump(dataPath),
    /** 数据目录全部文件（含事务期的 -journal；存储未启用 WAL）。 */
    scan: async (needle) => {
      let count = 0
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue
        const bytes = await readFile(path.join(dir, entry.name))
        for (let at = bytes.indexOf(needle); at !== -1; at = bytes.indexOf(needle, at + 1)) count += 1
      }
      return count
    },
    close: () => store.storage.close(),
  }
  return store
}

/** 写入探针：记录 storage 与事务回调里 `tx` 的写方法调用；`failing` 命中的方法改为抛 `RangeError`（存储校验之外的来源）。方法以原对象为 this 调用（两个实现都有私有字段）。 */
const WRITE_METHOD = /^(put|set|remove|replace|advance|record)/
function writeSpy(storage, failing) {
  const writes = []
  const wrap = (target) => new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key, object)
      if (typeof value !== 'function') return value
      if (key === 'transaction') return (work) => value.call(object, (tx) => work(wrap(tx)))
      if (failing?.test(String(key))) return async () => { throw new RangeError('injected read failure') }
      return (...args) => { if (WRITE_METHOD.test(String(key))) writes.push(String(key)); return value.apply(object, args) }
    },
  })
  return { storage: wrap(storage), writes }
}

/** 三条命令一次走完：返回由结果给出的 id。 */
async function setupAll(setup) {
  const workspace = await setup.createWorkspace(workspaceRequest())
  const account = await setup.connectAccount(accountRequest())
  assert.deepEqual([workspace, codeOf(account)], [{ ok: true, value: { workspaceId: WORKSPACE } }, 'ok'], '工作区与账号命令成功，工作区结果只含 id')
  const binding = await setup.bindPlanningSource(bindRequest(account.value.accountId))
  assert.equal(codeOf(binding), 'ok', '首次绑定规划来源成功')
  return { accountId: account.value.accountId, bindingId: binding.value.bindingId }
}

/** 与 Host 的组合步骤相同：按已存挂载恢复 provider 表，再以库中工作区组合 Core（D7）。 */
async function compose(storage, replay, credential) {
  const { table, disabled } = await restoreProviders(storage, WORKSPACE, PROVIDER_CATALOG, {
    fetch: replay.fetch, worktreesDir: path.join(tmpdir(), 'harness-workspace-setup-unused-worktrees'), resolveCredential: async () => credential,
  })
  const workspace = await storage.getWorkspace(WORKSPACE)
  const core = await composeCore({ workspace: { id: workspace.id, name: workspace.name, statusPolicy: workspace.statusPolicy }, providers: { ...table, storage } })
  return { core, disabled }
}

for (const kind of ['memory', 'sqlite']) {
  test(`AC1 命令建工作区并绑定 GitHub Project：下一次组合的引导读到该项目（${kind}）`, async (t) => {
    const store = await openStore(kind)
    t.after(() => store.close())
    const { bindingId } = await setupAll(createWorkspaceSetup(store.storage))
    const storage = store.reopen()
    assert.deepEqual((await storage.listProviderBindings(WORKSPACE)).map(({ id, domain, enabled, isDefault }) => [id, domain, enabled, isDefault]), [[bindingId, 'planning', true, true]], '重开后读到命令写出的启用默认规划挂载')
    const replay = replayFetch()
    const { core, disabled } = await compose(storage, replay, CANARY)
    assert.deepEqual(disabled, [], '恢复路径接受命令写出的挂载、账号关联、句柄与配置')
    const { ok, entities, workItems, changeRequests, unanchored } = await core.commands.bootstrapWorkspace()
    assert.deepEqual({ ok, entities, workItems, changeRequests, unanchored }, { ok: true, entities: 9, workItems: 8, changeRequests: 1, unanchored: 0 })
    assert.deepEqual(replay.misses, [], '回放没有未命中')
  })

  test(`AC2 已有启用的规划来源时再绑定：conflict 且零写入（${kind}）`, async (t) => {
    const store = await openStore(kind)
    t.after(() => store.close())
    const spy = writeSpy(store.storage)
    const setup = createWorkspaceSetup(spy.storage)
    const { accountId, bindingId } = await setupAll(setup)
    const other = await setup.connectAccount(accountRequest({ externalId: 'octo-2' }))
    const before = await store.snapshot()
    spy.writes.length = 0
    const sameValue = await setup.bindPlanningSource(bindRequest(accountId, { configuration: Object.assign(Object.create(null), { projectNodeId }) }))
    const second = await setup.bindPlanningSource(bindRequest(accountId, { configuration: { projectNodeId: SECOND_PROJECT } }))
    const viaOther = await setup.bindPlanningSource(bindRequest(other.value.accountId))
    assert.deepEqual([sameValue, codeOf(second), codeOf(viaOther), spy.writes, await store.snapshot()], [{ ok: true, value: { bindingId } }, 'conflict', 'conflict', [], before],
      '同值的空原型配置是同一目标、返回原挂载（#384）；第二个启用规划来源（另一项目，或同一项目换账号）：结构化 conflict；没有任何写调用，库不变')

    assert.equal(codeOf(await setup.createWorkspace(workspaceRequest({ workspaceId: OTHER_WORKSPACE }))), 'ok')
    // 启用的非规划挂载不占规划槽位（不变量 2）：并发结果只由两次规划绑定决定。
    await store.storage.putProviderBinding({ id: '00000000-0000-4000-8000-0000000000d1', workspaceId: OTHER_WORKSPACE, domain: 'development', implementationKey: 'development.local-git', enabled: true, isDefault: true })
    const racing = await Promise.all([projectNodeId, SECOND_PROJECT].map((project) => setup.bindPlanningSource(bindRequest(accountId, { workspaceId: OTHER_WORKSPACE, configuration: { projectNodeId: project } }))))
    assert.deepEqual(racing.map(codeOf).sort(), ['conflict', 'ok'], '并发绑定两个项目：恰好一个成功')
    assert.equal((await store.storage.listProviderBindings(OTHER_WORKSPACE)).filter((mount) => mount.domain === 'planning').length, 1, '只有一个规划挂载')
  })

  test(`AC3 只剩停用的规划挂载时绑定视为切换：not_supported 且零写入（${kind}）`, async (t) => {
    const store = await openStore(kind)
    t.after(() => store.close())
    const spy = writeSpy(store.storage)
    const setup = createWorkspaceSetup(spy.storage)
    const { accountId, bindingId } = await setupAll(setup)
    // 生产尚无停用规划挂载的路径（#368 / #202），经端口直接写出「旧来源已停用」。
    await store.storage.putProviderBinding({ id: bindingId, workspaceId: WORKSPACE, domain: 'planning', implementationKey: PLANNING, enabled: false, isDefault: false })
    const before = await store.snapshot()
    spy.writes.length = 0
    const switched = await setup.bindPlanningSource(bindRequest(accountId, { configuration: { projectNodeId: SECOND_PROJECT } }))
    assert.deepEqual([codeOf(switched), spy.writes, await store.snapshot()], ['not_supported', [], before], '切换规划来源：结构化 not_supported，没有任何写调用，库不变')
  })

  test(`AC5 凭据只以句柄落库（${kind}）`, async (t) => {
    const store = await openStore(kind)
    t.after(() => store.close())
    const spy = writeSpy(store.storage)
    const setup = createWorkspaceSetup(spy.storage)
    const before = await store.snapshot()
    // 自有键全在闭集内、未声明字段挂在原型上：只有原型检查拦得住（#375）。
    const inherited = (request) => Object.assign(Object.create({ token: CANARY }), request)
    const smuggled = [
      await setup.connectAccount({ ...accountRequest(), token: CANARY }),
      await setup.createWorkspace({ ...workspaceRequest(), token: CANARY }),
      await setup.bindPlanningSource({ ...bindRequest('00000000-0000-4000-8000-0000000000ff'), secret: CANARY }),
      await setup.connectAccount(inherited(accountRequest())),
      await setup.createWorkspace(inherited(workspaceRequest())),
      await setup.bindPlanningSource(inherited(bindRequest('00000000-0000-4000-8000-0000000000ff'))),
    ]
    assert.deepEqual([smuggled.map(codeOf), spy.writes], [Array(6).fill('invalid_input'), []], '未声明的 token / secret 字段（自有或继承自原型）：三条命令的闭集检查都先于任何写')
    const pasted = await setup.connectAccount(accountRequest({ secretHandle: CANARY }))
    assert.equal(codeOf(pasted), 'invalid_input', '粘进句柄字段的令牌不在 allowlist')
    assert.ok(!JSON.stringify([...smuggled, pasted]).includes(CANARY), '结果不回显令牌')
    assert.equal(codeOf(await setup.connectAccount(accountRequest({ secretHandle: undefined }))), 'invalid_input', '没有句柄的账号不能经设置命令登记')
    assert.deepEqual(await store.snapshot(), before, '被拒的账号写入整笔回滚')

    await setupAll(setup)
    const replay = replayFetch()
    const { core } = await compose(store.storage, replay, CANARY)
    assert.equal((await core.commands.bootstrapWorkspace()).ok, true)
    assert.deepEqual([...new Set(replay.requests.map((request) => request.authorization))], [`bearer ${CANARY}`], '凭据值只在 provider 操作内由句柄解析')
    for (const needle of [CANARY, Buffer.from(CANARY).toString('base64')]) assert.equal(await store.scan(needle), 0, `落盘内容不含凭据值：${needle.slice(0, 8)}`)
    assert.ok(await store.scan(HANDLE) >= 1, '阳性对照：同一扫描找得到库里存的句柄名')
  })

  test(`原子性：配置不合 schema 或父行缺失时不留任何行（${kind}）`, async (t) => {
    const store = await openStore(kind)
    t.after(() => store.close())
    const spy = writeSpy(store.storage)
    const setup = createWorkspaceSetup(spy.storage)
    assert.equal(codeOf(await setup.createWorkspace(workspaceRequest())), 'ok')
    const account = await setup.connectAccount(accountRequest())
    const before = await store.snapshot()
    spy.writes.length = 0
    // 字段类型在任何读写之前检查（D8）：交给存储兜底时，缺实现键在 SQLite 上是 NOT NULL 驱动异常而不是结构化错误，非普通对象的配置要先写再回滚。
    const malformed = [
      await setup.bindPlanningSource(bindRequest(account.value.accountId, { implementationKey: undefined })),
      await setup.bindPlanningSource(bindRequest(account.value.accountId, { configuration: [projectNodeId] })),
    ]
    assert.deepEqual([malformed.map(codeOf), spy.writes], [['invalid_input', 'invalid_input'], []], '缺实现键、配置不是普通对象：结构化 invalid_input，没有任何写调用')
    const outcomes = [
      await setup.bindPlanningSource(bindRequest(account.value.accountId, { configuration: { projectNodeId: 'not-a-node' } })),
      await setup.bindPlanningSource(bindRequest(account.value.accountId, { configuration: { projectNodeId, owner: 'octo' } })),
      await setup.bindPlanningSource(bindRequest(account.value.accountId, { workspaceId: OTHER_WORKSPACE })),
      await setup.bindPlanningSource(bindRequest('00000000-0000-4000-8000-0000000000ff')),
      ...await Promise.all([{ name: ' ' }, { statusPolicy: 'sometimes' }, { workspaceId: '' }].map((overrides) => setup.createWorkspace(workspaceRequest({ workspaceId: OTHER_WORKSPACE, ...overrides })))),
    ]
    assert.deepEqual(outcomes.map(codeOf), ['invalid_input', 'invalid_input', 'not_found', 'not_found', 'invalid_input', 'invalid_input', 'invalid_input'])
    assert.deepEqual(outcomes[0].error, outcomes[1].error, '存储拒绝映射成固定错误值：不同原因（不合模式、未声明字段）得到同一文案，attemptedValue 为空')
    assert.ok(!JSON.stringify(outcomes).includes('not-a-node'), '存储拒绝的文案不回显输入')
    assert.deepEqual(await store.snapshot(), before, '被拒的命令不留任何行（没有孤儿锚点、挂载或关联）')
  })

  test(`AC4 账本丢失后同键重放：结果与首次深等、零写入（${kind}）`, async (t) => {
    const store = await openStore(kind)
    t.after(() => store.close())
    const first = createSetupCommands(createWorkspaceSetup(store.storage))
    const sent = [['createWorkspace', { ...envelope('workspace-1'), ...workspaceRequest() }], ['connectAccount', { ...envelope('account-1'), ...accountRequest() }]]
    const results = []
    for (const [name, input] of sent) results.push(await first[name](input))
    const { accountId } = results[1].value
    for (const [key, configuration] of [['bind-1', { projectNodeId }], ['bind-2', { projectNodeId: SECOND_PROJECT }]]) sent.push(['bindPlanningSource', { ...envelope(key), ...bindRequest(accountId, { configuration }) }])
    for (const [name, input] of sent.slice(2)) results.push(await first[name](input))
    assert.deepEqual(results.map(({ writeState, authoritative }) => [writeState, authoritative]), [['local_only', false], ['local_only', false], ['local_only', false], ['conflict', false]], '成功只是 local_only，没有 provider ack 不是权威结果')
    const before = await store.snapshot()

    const spy = writeSpy(store.reopen())
    const second = createSetupCommands(createWorkspaceSetup(spy.storage))
    const replayed = []
    for (const [name, input] of sent) replayed.push(await second[name](input))
    assert.deepEqual([replayed, spy.writes, await store.snapshot()], [results, [], before], '新账本同键同请求：四个结果与首次深等，没有任何写调用，库不变')
    // 每次换一个新实例：账本都已丢失，拒绝只能来自 core 对自然键的比较。句柄不在 allowlist 也无妨——比较先于存储写入。
    const lost = () => createSetupCommands(createWorkspaceSetup(store.storage))
    const changed = [
      await lost().createWorkspace({ ...envelope('workspace-1'), ...workspaceRequest({ name: 'Renamed Workspace' }) }),
      await lost().createWorkspace({ ...envelope('workspace-1'), ...workspaceRequest({ statusPolicy: 'host_authoritative' }) }),
      await lost().connectAccount({ ...envelope('account-1'), ...accountRequest({ displayName: 'Octo Renamed' }) }),
      await lost().connectAccount({ ...envelope('account-1'), ...accountRequest({ secretHandle: 'OTHER_HANDLE' }) }),
    ]
    assert.deepEqual([changed.map(({ writeState }) => writeState), await store.snapshot()], [['conflict', 'conflict', 'conflict', 'conflict'], before], '账本丢失后同键换载荷、指向同一自然键：命令拒绝，不静默改名、改策略或改指凭据')

    // 拒绝只在账本存活期间重放（D16）：账本内补齐前置条件后同键仍得原拒绝；账本丢失后按当时状态重判。
    const live = lost()
    const retry = { ...envelope('bind-3'), ...bindRequest(accountId, { workspaceId: OTHER_WORKSPACE }) }
    const refused = await live.bindPlanningSource(retry)
    assert.deepEqual([refused.writeState, refused.error?.code], ['failed', 'not_found'], '工作区缺失：绑定被拒')
    const reused = await lost().createWorkspace({ ...envelope('workspace-1'), ...workspaceRequest({ workspaceId: OTHER_WORKSPACE }) })
    assert.deepEqual([reused.writeState, reused.value], ['local_only', { workspaceId: OTHER_WORKSPACE }], '账本丢失后同键指向另一工作区是新请求：建出该工作区，也补齐了上面绑定的前置条件')
    assert.deepEqual(await live.bindPlanningSource(retry), refused, '账本存活：前置条件补齐后同键仍得原拒绝')
    const restarted = writeSpy(store.storage)
    const rebound = await createSetupCommands(createWorkspaceSetup(restarted.storage)).bindPlanningSource(retry)
    assert.deepEqual([rebound.writeState, restarted.writes, (await store.storage.listProviderBindings(OTHER_WORKSPACE)).map(({ id }) => id)],
      ['local_only', ['putProviderBinding', 'setProviderBindingAccount', 'putBindingConfiguration'], [rebound.value?.bindingId]], '账本丢失后同键重发被拒请求：前置条件已满足，成功且恰好写一次挂载')
    restarted.writes.length = 0
    const again = await createSetupCommands(createWorkspaceSetup(restarted.storage)).bindPlanningSource(retry)
    assert.deepEqual([again, restarted.writes], [rebound, []], '再丢一次账本同键重发：同一结果，零写入')
  })
}

test('存储读口的 RangeError 原样上抛：库里的坏行与程序错误不是 invalid_input', async () => {
  const storage = createFakeStorage(emptyStorageData(), hostStoragePolicy(PROVIDER_CATALOG))
  const { accountId } = await setupAll(createWorkspaceSetup(storage))
  // 只有写口的 RangeError 是存储校验拒绝；读已存账号失败交 Host 的 guarded 记诊断、对外固定文案（#376）。
  const setup = createWorkspaceSetup(writeSpy(storage, /^(getConnectorAccount|listConnectorAccounts)$/).storage)
  await assert.rejects(setup.connectAccount(accountRequest()), RangeError)
  await assert.rejects(setup.bindPlanningSource(bindRequest(accountId)), RangeError)
})

test('AC4 账本内同键异请求：conflict 且不进 core', async () => {
  const setup = createWorkspaceSetup(createFakeStorage(emptyStorageData(), hostStoragePolicy(PROVIDER_CATALOG)))
  const calls = []
  const counted = Object.fromEntries(Object.entries(setup).map(([name, run]) => [name, (request) => { calls.push(name); return run(request) }]))
  const commands = createSetupCommands(counted)
  const input = { ...envelope('account-1'), ...accountRequest() }
  assert.equal((await commands.connectAccount(input)).writeState, 'local_only')
  const changed = await commands.connectAccount({ ...input, externalId: 'octo-2' })
  assert.deepEqual([changed.writeState, changed.error?.code, calls], ['conflict', 'conflict', ['connectAccount']], '同键换 externalId：账本以完整请求指纹拒绝，WorkspaceSetup 只被调用过一次')
})

/*
 * 绑定仓库（#353，ADR-0015 Accepted）：一个仓库实体并列持有各连接下的引用。AC1-353 写出 Local Git primary + GitHub alias 与各自的连接，同请求重发零写入；
 * AC4-353 Actions 以默认 delivery 挂载加同实体 alias 加入，不替换交付来源；拒绝与原子性同 #127 的事务模式。
 */
const REPOSITORY = 'repo-alpha'
/** #355 之前 Host 目录没有 `development.github` 与 `github-actions`（TD-054）：测试策略在 Host 策略上补它们的配置 schema。 */
const GITHUB_REPOSITORY_SCHEMA = Object.fromEntries(['repositoryExternalId', 'repositoryOwner', 'repositoryName'].map((name) => [name, { kind: 'string', required: true, pattern: '[^\\s]+', maxLength: 200 }]))
function bindingPolicy() {
  const host = hostStoragePolicy(PROVIDER_CATALOG)
  return { allowedSecretHandles: host.allowedSecretHandles, configurations: new Map([...host.configurations, ['development.github', GITHUB_REPOSITORY_SCHEMA], ['github-actions', GITHUB_REPOSITORY_SCHEMA]]) }
}
const localGit = (repositoryId = REPOSITORY, overrides = {}) => ({
  domain: 'development', implementationKey: 'development.local-git', configuration: { repositoryPath: `/srv/git/${repositoryId}`, repositoryExternalId: repositoryId }, ...overrides,
})
const github = (accountId, repositoryId = REPOSITORY, overrides = {}) => ({
  domain: 'development', implementationKey: 'development.github', accountId, configuration: { repositoryExternalId: repositoryId, repositoryOwner: 'octo', repositoryName: repositoryId }, ...overrides,
})
const actions = (accountId, repositoryId = REPOSITORY, overrides = {}) => github(accountId, repositoryId, { domain: 'delivery', implementationKey: 'github-actions', ...overrides })
const repositoryRequest = (references, overrides = {}) => ({ workspaceId: WORKSPACE, repositoryId: REPOSITORY, references, ...overrides })
const mountRows = (mounts) => mounts.map(({ id, domain, implementationKey, enabled, isDefault }) => [id, domain, implementationKey, enabled, isDefault])

async function workspaceWithAccount(setup) {
  assert.equal(codeOf(await setup.createWorkspace(workspaceRequest())), 'ok')
  const account = await setup.connectAccount(accountRequest())
  assert.equal(codeOf(account), 'ok')
  return account.value.accountId
}

/** 端口没有按种类列实体的方法：内存读导出状态，SQLite 读转储的 entity 表。 */
async function repositoryEntities(store) {
  const snapshot = await store.snapshot()
  return (typeof snapshot === 'string' ? JSON.parse(snapshot).entities : JSON.parse(snapshot.entity)).filter((entity) => entity.kind === 'repository').length
}

for (const kind of ['memory', 'sqlite']) {
  test(`AC1-353 一个仓库并列持有 Local Git 与 GitHub 引用及各自连接；同请求重发零写入（${kind}）`, async (t) => {
    const store = await openStore(kind, bindingPolicy())
    t.after(() => store.close())
    const accountId = await workspaceWithAccount(createWorkspaceSetup(store.storage))
    const input = { ...envelope('repository-1'), ...repositoryRequest([localGit(), github(accountId)]) }
    const spy = writeSpy(store.storage)
    const commands = createSetupCommands(createWorkspaceSetup(spy.storage))
    const first = await commands.bindRepository(input)
    assert.deepEqual([first.writeState, first.authoritative, first.value?.repositoryId, first.value?.bindingIds.length], ['local_only', false, REPOSITORY, 2], '只写本地事实：local_only，结果按请求顺序给出两个 bindingId')
    const [local, remote] = first.value.bindingIds
    const { storage } = store
    assert.deepEqual(mountRows(await storage.listProviderBindings(WORKSPACE)).sort(), [[local, 'development', 'development.local-git', true, false], [remote, 'development', 'development.github', true, false]].sort(), '两条启用、非默认的 development 挂载')
    for (const [bindingId, reference] of [[local, localGit()], [remote, github(accountId)]]) {
      const configuration = (await storage.getBindingConfiguration({ workspaceId: WORKSPACE, bindingId, domain: 'development' }))?.configuration
      assert.deepEqual([await storage.getProviderBindingAccount(bindingId), configuration], [reference.accountId, reference.configuration], '连接的账号与配置等于请求')
    }
    const primary = await storage.findExternalIdentity(local, 'repository', REPOSITORY)
    assert.deepEqual(await storage.listRepositories(WORKSPACE), [{ id: REPOSITORY, workspaceId: WORKSPACE, externalIdentityId: primary?.id }], '仓库挂载指向 Local Git 下的身份')
    assert.deepEqual((await storage.listIdentitiesForEntity(primary.entityId)).map(({ bindingId, role }) => [bindingId, role]).sort(), [[local, 'primary'], [remote, 'alias']].sort(), '同一实体上恰两条身份：Local Git primary、GitHub alias')
    assert.equal(await repositoryEntities(store), 1, '恰一个 repository 实体')

    const before = await store.snapshot()
    spy.writes.length = 0
    assert.deepEqual([await commands.bindRepository(input), spy.writes], [first, []], '账本内同键重发：结果深等，零写入')
    const reopened = writeSpy(store.reopen())
    const fresh = createSetupCommands(createWorkspaceSetup(reopened.storage))
    const replayed = [await fresh.bindRepository(input), await fresh.bindRepository({ ...input, ...envelope('repository-2') })]
    const nullPrototype = Object.assign(Object.create(null), localGit().configuration)
    const sameValue = await createWorkspaceSetup(reopened.storage).bindRepository(repositoryRequest([localGit(REPOSITORY, { configuration: nullPrototype }), github(accountId)]))
    assert.deepEqual([replayed, sameValue, reopened.writes, await store.snapshot()], [[first, first], { ok: true, value: first.value }, [], before], '账本丢失后同键、新键同请求，以及同值的空原型配置（#384）：结果与首次深等，零写入，库不变')
  })

  test(`AC4-353 GitHub Actions 作为已绑定仓库的交付来源加入，不替换交付来源（${kind}）`, async (t) => {
    const store = await openStore(kind, bindingPolicy())
    t.after(() => store.close())
    const spy = writeSpy(store.storage)
    const setup = createWorkspaceSetup(spy.storage)
    const accountId = await workspaceWithAccount(setup)
    const [local] = (await setup.bindRepository(repositoryRequest([localGit(), github(accountId)]))).value.bindingIds
    const mounts = await store.storage.listProviderBindings(WORKSPACE)
    const added = await setup.bindRepository(repositoryRequest([actions(accountId)]))
    assert.equal(codeOf(added), 'ok', '已绑定的仓库再绑 Actions 成功')
    const [delivery] = added.value.bindingIds
    assert.deepEqual(added.value, { repositoryId: REPOSITORY, bindingIds: [delivery] }, '结果只含本次请求的引用')
    const newMounts = (await store.storage.listProviderBindings(WORKSPACE)).filter((mount) => !mounts.some((old) => old.id === mount.id))
    assert.deepEqual(mountRows(newMounts), [[delivery, 'delivery', 'github-actions', true, true]], '只新增一个启用、默认的 delivery 挂载')
    const configuration = (await store.storage.getBindingConfiguration({ workspaceId: WORKSPACE, bindingId: delivery, domain: 'delivery' }))?.configuration
    assert.deepEqual([await store.storage.getProviderBindingAccount(delivery), configuration], [accountId, actions(accountId).configuration], '交付连接的账号与配置等于请求')
    const primary = await store.storage.findExternalIdentity(local, 'repository', REPOSITORY)
    const alias = await store.storage.findExternalIdentity(delivery, 'repository', REPOSITORY)
    assert.deepEqual([alias?.entityId, alias?.role, (await store.storage.listRepositories(WORKSPACE)).map((record) => record.externalIdentityId)], [primary.entityId, 'alias', [primary.id]], '同一实体上的 alias，仓库挂载不改指')

    const before = await store.snapshot()
    spy.writes.length = 0
    const outcomes = [
      await setup.bindRepository(repositoryRequest([actions(accountId)])),
      await setup.bindRepository(repositoryRequest([actions(accountId, REPOSITORY, { configuration: { ...actions(accountId).configuration, repositoryOwner: 'someone-else' } })])),
      await setup.bindRepository(repositoryRequest([localGit('repo-beta'), actions(accountId, 'repo-beta')], { repositoryId: 'repo-beta' })),
    ]
    assert.deepEqual([outcomes.map(codeOf), outcomes[0].value, spy.writes, await store.snapshot()], [['ok', 'conflict', 'conflict'], added.value, [], before], '同请求重发零写入；换 Actions 配置、另一仓库绑 Actions 都 conflict：零写入，库不变')
  })

  test(`首次绑定的锚点是 Development 引用：引用按 [Actions, Local Git] 给出时，仓库挂载仍指向 Local Git 下的 primary（${kind}）`, async (t) => {
    const store = await openStore(kind, bindingPolicy())
    t.after(() => store.close())
    const setup = createWorkspaceSetup(store.storage)
    const accountId = await workspaceWithAccount(setup)
    const bound = await setup.bindRepository(repositoryRequest([actions(accountId), localGit()]))
    assert.equal(codeOf(bound), 'ok')
    const [delivery, local] = bound.value.bindingIds
    const { storage } = store
    const primary = await storage.findExternalIdentity(local, 'repository', REPOSITORY)
    assert.deepEqual((await storage.listRepositories(WORKSPACE)).map((record) => record.externalIdentityId), [primary?.id], '仓库挂载指向 Local Git 下的身份，不是排在前面的 Actions')
    assert.deepEqual((await storage.listIdentitiesForEntity(primary.entityId)).map(({ bindingId, role }) => [bindingId, role]).sort(), [[local, 'primary'], [delivery, 'alias']].sort(), 'Local Git primary、Actions alias，同一实体')
  })

  test(`ADR-0015 约束②：每个仓库在每个连接下至多一条现行引用——同一实现换目标被拒、零写入（存储按自然键收拢由 tests/contract 存储套件覆盖）（${kind}）`, async (t) => {
    const store = await openStore(kind, bindingPolicy())
    t.after(() => store.close())
    const spy = writeSpy(store.storage)
    const setup = createWorkspaceSetup(spy.storage)
    const accountId = await workspaceWithAccount(setup)
    const [local, remote] = (await setup.bindRepository(repositoryRequest([localGit(), github(accountId)]))).value.bindingIds
    const { storage } = store
    const primary = await storage.findExternalIdentity(local, 'repository', REPOSITORY)
    const references = async () => (await storage.listIdentitiesForEntity(primary.entityId)).map(({ id, bindingId, role }) => [id, bindingId, role]).sort()
    const initial = await references()
    const before = await store.snapshot()
    spy.writes.length = 0
    const elsewhere = localGit(REPOSITORY, { configuration: { repositoryPath: '/srv/git/elsewhere', repositoryExternalId: REPOSITORY } })
    const outcomes = [
      await setup.bindRepository(repositoryRequest([elsewhere])),
      await setup.bindRepository(repositoryRequest([github(accountId), elsewhere])),
      await setup.bindRepository(repositoryRequest([github(accountId, REPOSITORY, { configuration: { ...github(accountId).configuration, repositoryOwner: 'someone-else' } })])),
    ]
    assert.deepEqual([outcomes.map(codeOf), spy.writes, await store.snapshot()], [['conflict', 'conflict', 'conflict'], [], before], '已有引用的实现换目标（单独给或与同目标的引用同给）：conflict，零写入，库不变')
    assert.deepEqual([(await storage.listProviderBindings(WORKSPACE)).map(({ id }) => id).sort(), await references()], [[local, remote].sort(), initial], '没有第二个同实现的连接，也没有第二条引用')
  })

  test(`绑定仓库拒绝：形状、缺失、未登记无 Development、锚点不在挂载下与改绑都结构化拒绝且零写入（${kind}）`, async (t) => {
    const store = await openStore(kind, bindingPolicy())
    t.after(() => store.close())
    const spy = writeSpy(store.storage)
    const setup = createWorkspaceSetup(spy.storage)
    const accountId = await workspaceWithAccount(setup)
    assert.equal(codeOf(await setup.bindRepository(repositoryRequest([localGit(), github(accountId)]))), 'ok')
    // 生产尚无解绑（M4.1）：经端口卸载 repo-gamma 唯一的挂载，制造「已登记、锚点不在本工作区任何挂载下」。
    const orphan = await setup.bindRepository(repositoryRequest([localGit('repo-gamma')], { repositoryId: 'repo-gamma' }))
    await store.storage.removeProviderBinding({ workspaceId: WORKSPACE, bindingId: orphan.value.bindingIds[0], domain: 'development' })
    const delta = (overrides) => repositoryRequest([localGit('repo-delta'), ...overrides], { repositoryId: 'repo-delta' })
    const before = await store.snapshot()
    spy.writes.length = 0
    const cases = [
      ['invalid_input', { ...repositoryRequest([localGit()]), token: CANARY }],
      ['invalid_input', repositoryRequest([])],
      ['invalid_input', repositoryRequest(localGit())],
      ['invalid_input', repositoryRequest([localGit()], { repositoryId: ' ' })],
      ['invalid_input', repositoryRequest([{ ...localGit(), token: CANARY }])],
      ['invalid_input', repositoryRequest([{ ...localGit(), domain: 'planning' }])],
      ['invalid_input', repositoryRequest([{ ...localGit(), implementationKey: 7 }])],
      ['invalid_input', delta([localGit('repo-delta', { configuration: { repositoryPath: '/srv/git/delta-copy', repositoryExternalId: 'repo-delta' } })])],
      ['invalid_input', delta([actions(accountId, 'repo-delta'), actions(accountId, 'repo-delta', { implementationKey: 'delivery.other' })])],
      ['not_found', repositoryRequest([localGit()], { workspaceId: OTHER_WORKSPACE })],
      ['not_found', repositoryRequest([github('00000000-0000-4000-8000-0000000000ff')])],
      ['invalid_input', repositoryRequest([actions(accountId, 'repo-delta')], { repositoryId: 'repo-delta' })],
      ['conflict', repositoryRequest([localGit('repo-gamma')], { repositoryId: 'repo-gamma' })],
      ['conflict', repositoryRequest([localGit(REPOSITORY, { configuration: { repositoryPath: '/srv/git/elsewhere', repositoryExternalId: REPOSITORY } })])],
    ]
    const outcomes = []
    for (const [, request] of cases) outcomes.push(await setup.bindRepository(request))
    assert.deepEqual(outcomes.map(codeOf), cases.map(([code]) => code), '逐行对照 Design 的拒绝表')
    assert.deepEqual([spy.writes, await store.snapshot()], [[], before], '全部在任何写之前拒绝：没有写调用，库不变')
    assert.ok(!JSON.stringify(outcomes).includes(CANARY), '文案不回显请求值')
  })

  test(`绑定仓库原子性：后一条引用的配置不合 schema 时，已写的挂载一并回滚（${kind}）`, async (t) => {
    const store = await openStore(kind, bindingPolicy())
    t.after(() => store.close())
    const spy = writeSpy(store.storage)
    const setup = createWorkspaceSetup(spy.storage)
    const accountId = await workspaceWithAccount(setup)
    const before = await store.snapshot()
    spy.writes.length = 0
    const { configuration } = github(accountId)
    const outcomes = [
      await setup.bindRepository(repositoryRequest([localGit(), github(accountId, REPOSITORY, { configuration: { repositoryExternalId: REPOSITORY, repositoryOwner: 'octo' } })])),
      await setup.bindRepository(repositoryRequest([localGit(), github(accountId, REPOSITORY, { configuration: { ...configuration, token: CANARY } })])),
    ]
    assert.deepEqual(outcomes.map(codeOf), ['invalid_input', 'invalid_input'])
    assert.deepEqual(outcomes[0].error, outcomes[1].error, '存储拒绝映射成固定错误值，不回显输入')
    assert.ok(!JSON.stringify(outcomes).includes(CANARY), '结果不回显令牌')
    assert.ok(spy.writes.includes('putProviderBinding'), '阳性对照：Local Git 挂载在被拒之前确实写过')
    assert.deepEqual(await store.snapshot(), before, '整笔回滚：没有挂载、账号关联、配置、身份或仓库挂载留下')
  })
}

/*
 * 规划来源的名字（#383）：Host 组合下插件页面不传名字（`sourceNames: {}`），列表与详情显示 wire 带来的项目标题，而不是「未提供」，也绝不是实现键；
 * 页面给了名字仍以页面为准。Host 启动后首轮引导读到项目之前名字未知：字段缺席（wire 与加入它之前逐字相同），页面仍是「未提供」。
 * 新字段只有绑定 id 与名字：不带账号、句柄或凭据值。
 */
const PROJECT_TITLE = 'E1 Project A'
for (const kind of ['memory', 'sqlite']) {
  test(`#383 规划来源名经 controller 快照到达列表与详情，不带账号或凭据（${kind}）`, async (t) => {
    const store = await openStore(kind)
    t.after(() => store.close())
    const { accountId, bindingId } = await setupAll(createWorkspaceSetup(store.storage))
    const replay = replayFetch()
    let online = false
    const { core } = await compose(store.storage, { fetch: (...args) => (online ? replay.fetch(...args) : Promise.reject(new TypeError('offline'))) }, CANARY)
    const controller = createController(core)
    const connected = async () => {
      const sync = createSync(createTransport(controller), createEntityStore())
      await sync.connect()
      return sync
    }
    const input = (sync, metadata) => ({ read: sync.read(), metadata, phase: 'received', refreshing: false })
    assert.deepEqual(Object.keys(await controller.baseline()).sort(), ['capabilities', 'entities', 'revision', 'source', 'workspace'], '首轮引导没读到项目：名字未知，头字段与加入 planningSource 之前逐字相同')
    assert.equal(deriveWorkItemListView(input(await connected(), { sourceNames: {} })).planningSourceName, '规划来源名称未提供', '名字未知时仍是「未提供」，不退到实现键')
    online = true
    assert.equal((await core.commands.bootstrapWorkspace()).ok, true)
    const snapshot = await controller.baseline()
    assert.deepEqual(snapshot.planningSource, { bindingId, name: PROJECT_TITLE }, '闭集：只有绑定 id 与项目标题')
    for (const needle of [CANARY, HANDLE, accountId, PLANNING]) assert.ok(!JSON.stringify(snapshot).includes(needle), `wire 不带账号、凭据或实现键：${needle.slice(0, 8)}`)

    const sync = await connected()
    const page = input(sync, { sourceNames: {} })
    const list = deriveWorkItemListView(page)
    const row = list.body.rows.find((candidate) => candidate.kind === 'item')
    const target = { projectId: WORKSPACE, itemId: row.key }
    assert.deepEqual([list.planningSourceName, row.source, deriveWorkItemDetailView(page, target).body.source], [PROJECT_TITLE, PROJECT_TITLE, PROJECT_TITLE], '插件页面不传名字：显示项目标题，不是「未提供」')
    const named = input(sync, { planningSourceName: '规划源', sourceNames: { [bindingId]: '来源一' } })
    assert.deepEqual([deriveWorkItemListView(named).planningSourceName, deriveWorkItemDetailView(named, target).body.source], ['规划源', '来源一'], '页面给的名字优先')

    sync.receive({ kind: 'metadata', metadata: toWireMetadata(snapshot) })
    assert.deepEqual(sync.read().planningSource, snapshot.planningSource, '同修订 metadata 帧携带 planningSource，client 接受')
    for (const planningSource of [null, 'x', { bindingId, name: '' }, { bindingId: '', name: PROJECT_TITLE }, { bindingId, name: 7 }, { bindingId, name: PROJECT_TITLE, accountId }]) {
      assert.throws(() => sync.receive({ kind: 'metadata', metadata: { ...toWireMetadata(snapshot), planningSource } }), /帧头不合契约/, JSON.stringify(planningSource))
    }
    const poll = (change) => {
      const next = structuredClone(snapshot)
      change(next)
      return watchWorkspace({ baseline: async () => next }, { afterRevision: snapshot.revision, seed: snapshot }).poll()
    }
    const renamed = await poll((next) => { next.planningSource.name = '改名后的项目' })
    assert.deepEqual([renamed.kind, renamed.metadata.planningSource], ['metadata', { bindingId, name: '改名后的项目' }], '只有 planningSource 变化也是来源变化，发 metadata')
    const advanced = await poll((next) => { next.revision += 1; next.source.revision += 1 })
    assert.deepEqual([advanced.kind, advanced.delta.planningSource], ['delta', snapshot.planningSource], 'delta 携带 planningSource')
  })
}
