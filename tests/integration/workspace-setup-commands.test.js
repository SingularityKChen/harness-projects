/**
 * 工作区设置命令（#127）：`createWorkspaceSetup` 的三条 create-or-verify 命令在内存替身与 SQLite 文件上各跑一轮，GitHub 流量走录制回放（不触网）。
 * 保护的不变量：AC1 命令写出的正是 Host 恢复读取的行集，下一次组合的引导读到该项目；AC2 第二个启用的规划来源以 conflict 拒绝且零写入，
 * 并发两次绑定恰好一个成功（不变量 1）；AC3 #202 之前的切换以 not_supported 拒绝且零写入；AC5 凭据只以句柄落库，令牌不进库、不上结果；
 * 原子性：被拒绝的命令不留任何行（#353 继承同一事务模式），只有存储写口的 RangeError 映射成 invalid_input（#376）；AC4 controller 的 `createSetupCommands` 账本丢失后同键重发，由命令按自然键找回同一结果、零写入，
 * 拒绝只在账本存活期间重放（账本丢失后按当时状态重判），账本内同键异请求以 conflict 拒绝且不进 core。
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createSetupCommands } from '@harness-projects/controller'
import { composeCore, createWorkspaceSetup } from '@harness-projects/core'
import { createFakeStorage, emptyStorageData, exportFakeStorageState } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
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

/** 同一份 Host 策略下的两种存储：`reopen` 换一个实例读同一份内容，`snapshot` 是全部行的转储，`scan` 数落盘内容里 needle 的出现次数。 */
async function openStore(kind) {
  const policy = hostStoragePolicy(PROVIDER_CATALOG)
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
