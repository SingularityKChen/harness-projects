/**
 * Host 按实现键从已存挂载组合 provider（#132，ADR-0014）。入口是 `createHostComposition` 加生产目录 `PROVIDER_CATALOG`，
 * 种子直接写库，GitHub 流量走录制回放（不触网、不需要真实凭据）。保护的不变量：
 * I1 身份只来自存储（重启不变）、I2 运行期失效不写库、I3 宿主级失败整体关闭、挂载级失败局部隔离、I4 凭据值只存在于一次 provider 操作内。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { SqliteStorage } from '@harness-projects/storage-sqlite'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { describeError } from '../../apps/harness-plugin/src/host-diagnostics.ts'
import { PROVIDER_CATALOG, catalogOf } from '../../apps/harness-plugin/src/host-providers.ts'
import { HOST_REMOTE } from '../../apps/harness-plugin/src/remote.ts'
import {
  ACCOUNT, GITHUB, HANDLE, WORKSPACE, account, dump, fakePlanningEntry, mount, occurrences, projectNodeId, ref, replayFetch, seed, seedPlanning, seedWorkspace,
} from './fixtures/host-seed.js'
import { REPOSITORY_ID, fixtureFor, registerWorkItem, worktreePaths } from './local-git-fixture.js'

const LOCAL = '00000000-0000-4000-8000-0000000000a2'
const RETIRED = '00000000-0000-4000-8000-0000000000a3'
const DORMANT = '00000000-0000-4000-8000-0000000000a4'
const BOOM = '00000000-0000-4000-8000-0000000000a5'
const PEER = '00000000-0000-4000-8000-0000000000a6'
const MISPLACED = '00000000-0000-4000-8000-0000000000a7'
const FAKE = '00000000-0000-4000-8000-0000000000b1'
const OPERATION_FAILED = 'harness-projects：操作失败，原因已写入宿主诊断日志'

const RESTART_CHILD = fileURLToPath(new URL('./fixtures/host-restart-child.mjs', import.meta.url))

const dirs = []
test.after(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }) })
async function dataRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'harness-host-providers-'))
  dirs.push(root)
  return { root, dataDir: path.join(root, 'harness-projects'), dataPath: path.join(root, 'harness-projects', 'workspace.sqlite') }
}

async function seedLocalGit(storage, id, repositoryPath, overrides = {}, repositoryExternalId = 'repo-alpha') {
  await storage.putProviderBinding(mount(id, 'development', 'development.local-git', overrides))
  await storage.putBindingConfiguration({ ref: ref(id, 'development'), configuration: { repositoryPath, repositoryExternalId } })
}
const options = (dataPath, extra = {}) => ({ dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, resolveCredential: async () => undefined, ...extra })
const bootstrap = (host, idempotencyKey) => host.call('bootstrapWorkspace', { actorRef: { kind: 'agent' }, idempotencyKey })

/** 变化的表：两次转储里 JSON 不同的表名。 */
const changedTables = (before, after) => Object.keys(after).filter((table) => before[table] !== after[table]).sort()
const rowsOf = (dumped, table) => JSON.parse(dumped[table])

/** 宿主诊断日志：每行一个 JSON；文件不存在即没有行。 */
async function logLines(dataDir) {
  const text = await readFile(path.join(dataDir, 'diagnostics.log'), 'utf8').catch(() => '')
  return text.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line))
}
/** `harness.fake` 规划挂载：测试专用目录，不在生产目录里；`onCreate` 可以包 Proxy 注入故障。 */
const fakeCatalog = (onCreate) => catalogOf([...PROVIDER_CATALOG.values(), fakePlanningEntry(onCreate)])
const seedFake = async (storage) => { await seedWorkspace(storage); await storage.putProviderBinding(mount(FAKE, 'planning', 'harness.fake')) }

test('AC1 空数据根：建库迁移 1–7，零工作区，重启仍为零', async () => {
  const { dataPath } = await dataRoot()
  for (const key of ['ac1-1', 'ac1-2']) { // 第二轮是同一文件上的重启
    const host = await createHostComposition(options(dataPath))
    try {
      const [baseline, command] = [await host.call('baseline', {}), await bootstrap(host, key)]
      assert.deepEqual([baseline.workspace, baseline.entities, command.writeState, command.error.code], [undefined, [], 'failed', 'not_supported'], '没有工作区：baseline 为空而不是编造一个，命令是结构化 not_supported')
    } finally { await host.dispose() }
    const dumped = dump(dataPath)
    assert.deepEqual(rowsOf(dumped, 'schema_migrations').map((row) => row.version), [1, 2, 3, 4, 5, 6, 7])
    assert.deepEqual([rowsOf(dumped, 'workspace').length, rowsOf(dumped, 'provider_binding').length], [0, 0], '空数据根不得写出任何工作区或连接锚点')
  }
})

test('AC2 AC4 同文件重启：身份不变，凭据按操作解析且只以句柄落库', async () => {
  const { dataDir, dataPath } = await dataRoot()
  await seed(dataPath, PROVIDER_CATALOG, async (storage) => {
    await seedWorkspace(storage, 'host_authoritative') // 非默认状态策略：重启不得被重置
    await seedPlanning(storage)
    // 两个对等 development 挂载：默认角色由 Core 按挂载数推导为 0（TD-053），种子直接写成派生值，使首次组合对身份表零改写。
    await seedLocalGit(storage, LOCAL, path.join(dataDir, 'repository-not-created'), { isDefault: false })
    await seedLocalGit(storage, PEER, path.join(dataDir, 'repository-peer-not-created'), { isDefault: false }, 'repo-beta')
  })
  const seeded = dump(dataPath)
  const replay = replayFetch()
  const resolved = []
  const canaries = ['canary-v1-6f0d2b7a91c4', 'canary-v2-b83e5d10f7a2']
  const runs = []
  for (const canary of canaries) { // 每次组合换一个凭据值：值只在当次 provider 操作内解析
    const host = await createHostComposition(options(dataPath, { fetch: replay.fetch, resolveCredential: async (handle) => { resolved.push(handle); return canary } }))
    const baseline = await host.call('baseline', {})
    await host.dispose()
    runs.push({ dumped: dump(dataPath), entities: baseline.entities.length, wire: JSON.stringify(HOST_REMOTE.invocations[0].result.encode(baseline)) })
  }
  const identity = ['workspace', 'provider_binding', 'workspace_binding', 'connector_account']
  assert.ok(identity.every((table) => rowsOf(seeded, table).length > 0), '夹具自检：身份表都有种子行')
  assert.deepEqual(identity.map((table) => runs[0].dumped[table]), identity.map((table) => seeded[table]), 'I1 身份只来自存储：首次组合不新增也不改写工作区（含状态策略）、连接锚点、挂载（含对等挂载的默认角色）与账号')
  assert.deepEqual(changedTables(runs[0].dumped, runs[1].dumped), ['planning_sync_round', 'reconcile_cursor'], '重启只推进同步轮次与对账游标：修订号、工作区、挂载、身份与实体逐字节不变')
  assert.ok(runs[0].entities > 0 && runs[1].entities === runs[0].entities, '重启前后实体数相同且非零')
  assert.deepEqual(replay.misses, [], '回放没有未命中')

  assert.deepEqual([...new Set(replay.requests.map((request) => request.authorization))], canaries.map((canary) => `bearer ${canary}`), '每次请求带当时的凭据，两种值依次出现')
  assert.equal(resolved.length, replay.requests.length, '凭据每次 provider 操作解析一次：解析次数等于请求次数')
  assert.deepEqual([...new Set(resolved)], [HANDLE])
  assert.ok(replay.requests.every((request) => request.redirect === 'error' && request.signal instanceof AbortSignal && request.url === 'https://api.github.com/graphql'), 'redirect: error 与超时信号逐请求存在')

  for (const needle of canaries.flatMap((canary) => [canary, Buffer.from(canary).toString('base64')])) assert.equal(await occurrences(dataDir, needle), 0, `数据目录不含凭据值：${needle.slice(0, 12)}`)
  assert.ok(await occurrences(dataDir, HANDLE) >= 1, '阳性对照：同一扫描函数在同一数据目录里找得到库里存的句柄名')
  assert.ok(runs.every((run) => !run.wire.includes('canary-v')), 'wire 上没有凭据值')
})

test('AC3 未知实现键、域不匹配与构造抛错只禁用该挂载，其余挂载照常', async () => {
  const { dataDir, dataPath } = await dataRoot()
  const retired = { definition: { implementationKey: 'vendor.retired', domains: ['development'] }, configuration: { note: { kind: 'string', required: true, pattern: '[a-z]+', maxLength: 10 } }, create: async () => ({}) }
  // 构造抛错的实现：异常原文（可能带凭据或本机路径）不得进入禁用记录与日志，只留固定文案。
  const boom = { definition: { implementationKey: 'vendor.boom', domains: ['development'] }, configuration: {}, create: async () => { throw new Error('canary-ac3-boom ~/private') } }
  await seed(dataPath, catalogOf([...PROVIDER_CATALOG.values(), retired]), async (storage) => {
    await seedWorkspace(storage)
    await seedPlanning(storage)
    await storage.putProviderBinding(mount(RETIRED, 'development', 'vendor.retired'))
    await storage.setProviderBindingAccount(RETIRED, ACCOUNT)
    await storage.putBindingConfiguration({ ref: ref(RETIRED, 'development'), configuration: { note: 'legacy' } })
    await storage.putProviderBinding(mount(BOOM, 'development', 'vendor.boom', { isDefault: false }))
    await seedLocalGit(storage, DORMANT, '/does/not/matter', { enabled: false, isDefault: false })
    // 规划实现键挂在 development 域，且账号与配置都合格：没有域检查时它会被构造并让整个 Host 起不来。
    await storage.putProviderBinding(mount(MISPLACED, 'development', 'planning.github-projects', { isDefault: false }))
    await storage.setProviderBindingAccount(MISPLACED, ACCOUNT)
    await storage.putBindingConfiguration({ ref: ref(MISPLACED, 'development'), configuration: { projectNodeId } })
  })
  const mounts = (dumped) => [dumped.provider_binding, dumped.workspace_binding]
  const before = mounts(dump(dataPath))
  const replay = replayFetch()
  const host = await createHostComposition(options(dataPath, { catalog: catalogOf([...PROVIDER_CATALOG.values(), boom]), fetch: replay.fetch, resolveCredential: async () => 'canary-ac3-9c1e' }))
  const expected = [[RETIRED, 'vendor.retired', 'not_supported'], [BOOM, 'vendor.boom', 'unavailable'], [MISPLACED, 'planning.github-projects', 'invalid_input']]
  try {
    assert.deepEqual(host.disabled.map((item) => [item.bindingId, item.implementationKey, item.error.code]), expected, '只有无法构造的挂载被禁用；用户主动停用的挂载不算禁用')
    assert.equal(JSON.stringify(host.disabled).includes('canary'), false, '构造异常原文不进禁用记录')
    assert.ok((await host.call('baseline', {})).entities.length > 0, '其余挂载照常')
  } finally { await host.dispose() }
  assert.deepEqual(mounts(dump(dataPath)), before, 'I2：连接锚点与挂载行逐字节不变，被禁用与被停用的挂载也一样')
  assert.deepEqual((await logLines(dataDir)).map(({ at, ...line }) => line), expected.map(([bindingId, implementationKey, code]) => ({ event: 'bindingDisabled', bindingId, domain: 'development', implementationKey, code })), '每个被禁用的挂载写一行、停用的不写，只含允许名单字段，构造异常原文不进日志')
})

test('AC3 AC4 账号来源不是 github.com 或账号不带句柄的规划挂载被禁用；凭据值解析不到时不发请求，命令是结构化失败；库只接受宿主常量里的句柄', async (t) => {
  for (const [label, accountOverrides, disabled] of [
    ['来源 github.example.com', { platformOrigin: 'https://github.example.com' }, [[GITHUB, 'not_supported']]],
    ['github.com 账号不带句柄', { secretHandle: undefined }, [[GITHUB, 'not_supported']]],
    ['github.com 账号带句柄', {}, []],
  ]) await t.test(label, async () => { // 子用例：变异归因到具体的一行
    const { dataPath } = await dataRoot()
    await seed(dataPath, PROVIDER_CATALOG, async (storage) => { await seedWorkspace(storage); await seedPlanning(storage, accountOverrides) })
    const replay = replayFetch()
    const host = await createHostComposition(options(dataPath, { fetch: replay.fetch })) // resolveCredential 缺省返回 undefined
    try {
      assert.deepEqual(host.disabled.map((item) => [item.bindingId, item.error.code]), disabled, label)
      assert.deepEqual([(await host.call('baseline', {})).entities, (await bootstrap(host, 'ac4-nocred')).writeState], [[], 'failed'])
      assert.equal(replay.requests.length, 0, '被禁用或没有凭据值：不发请求，更不会带空 bearer')
    } finally { await host.dispose() }
  })
  const { dataPath } = await dataRoot()
  await assert.rejects(() => seed(dataPath, PROVIDER_CATALOG, (storage) => storage.putConnectorAccount(account({ secretHandle: 'GITHUB_TOKEN' }))), RangeError, '句柄 allowlist 是宿主常量，用户环境里通用的名字进不了库')
})

test('AC7 同步异常经脱敏写入宿主诊断日志，不上 wire', async () => {
  const { dataDir, dataPath } = await dataRoot()
  const secrets = ['canary-ac7-sync-4d8e21', dataDir, 'Secret Project Title', 'example.invalid']
  const fault = Object.assign(new Error(`${secrets[0]} ${dataDir} "Secret Project Title" https://example.invalid/x`), { code: 'ERR_TEST_FAULT', errcode: 13, path: dataDir })
  const catalog = fakeCatalog((provider) => new Proxy(provider, {
    get: (target, property, receiver) => (property === 'listPlanningItems' ? async () => { throw fault } : Reflect.get(target, property, receiver)),
  }))
  await seed(dataPath, catalog, seedFake)
  const host = await createHostComposition(options(dataPath, { catalog }))
  try {
    const wire = JSON.stringify([await host.call('baseline', {}), await bootstrap(host, 'ac7-sync-1')].map((result) => HOST_REMOTE.invocations[0].result.encode(result)))
    const logged = await readFile(path.join(dataDir, 'diagnostics.log'), 'utf8')
    const { at, ...first } = JSON.parse(logged.split('\n')[0])
    assert.deepEqual([typeof at, first], ['string', { event: 'syncRoundFailed', name: 'Error', code: 'ERR_TEST_FAULT', errcode: 13 }], '诊断记录只含允许名单字段')
    for (const secret of secrets) assert.equal(logged.includes(secret) || wire.includes(secret), false, `诊断日志与 wire 都不含 ${secret.slice(0, 12)}`)
    // 允许名单按形状过滤：不合格的 name、code、errcode 一律丢弃，原文不外泄。
    const shaped = (props, name = 'Error') => Object.defineProperty(Object.assign(new Error('x'), props), 'name', { value: name })
    assert.deepEqual([shaped({ code: '~/secret' }), shaped({}, 'My Error at ~'), shaped({ errcode: 1.5 })].map(describeError), Array(3).fill({ name: 'Error' }))
  } finally { await host.dispose() }
})

test('AC7 命令拒绝映射为固定文案，诊断日志写不进去时也一样', async (t) => {
  const { dataDir, dataPath } = await dataRoot()
  const catalog = fakeCatalog()
  await seed(dataPath, catalog, seedFake)
  const host = await createHostComposition(options(dataPath, { catalog }))
  const logFile = path.join(dataDir, 'diagnostics.log')
  try {
    assert.deepEqual(await logLines(dataDir), [], '夹具自检：组合期没有诊断记录')
    // 双重故障：命令里的事务以含数据目录路径的异常拒绝，Controller 不吞它。
    t.mock.method(SqliteStorage.prototype, 'transaction', async () => { throw new Error(`disk fault at ${dataDir}`) })
    await assert.rejects(() => bootstrap(host, 'ac7-command-1'), (error) => error.message === OPERATION_FAILED && error.cause === undefined)
    // Core 也会把这次事务拒绝当作未提交的同步轮次交给 syncRoundFailed；这里只要求 wire 出口多出恰好一行 operationFailed。
    assert.equal((await logLines(dataDir)).filter((line) => line.event === 'operationFailed').length, 1)
    assert.equal((await readFile(logFile, 'utf8')).includes(dataDir), false, '诊断日志不含数据目录路径')
    await rm(logFile); await mkdir(logFile) // 日志路径变成目录：之后每次追加都失败，query 一侧的漏斗也只露固定文案
    t.mock.method(SqliteStorage.prototype, 'currentRevision', () => { throw new Error(`disk fault at ${dataDir}`) })
    await assert.rejects(() => host.call('baseline', {}), (error) => error.message === OPERATION_FAILED)
  } finally { await host.dispose() }
})

/** 种子：工作区、指向 `repositoryPath` 的 L 挂载与一个可开始的工作项。 */
const seedStartable = (repositoryPath) => (storage) => seedWorkspace(storage)
  .then(() => seedLocalGit(storage, LOCAL, repositoryPath))
  .then(() => registerWorkItem(storage, WORKSPACE, 'wi-1'))
const startWork = (host) => host.controller.commands.startWork({ workItemId: 'wi-1', repositoryId: REPOSITORY_ID, actorRef: { kind: 'agent' }, idempotencyKey: 'k-1' })
const contextOf = (host) => host.controller.queries.getExecutionContext({ workItemId: 'wi-1', repositoryId: REPOSITORY_ID })

test('AC5 AC6 新进程重启恢复执行上下文与谱系，工作树在检出之外', async (t) => {
  const fixture = await fixtureFor(t)
  const { dataDir, dataPath } = await dataRoot()
  await seed(dataPath, PROVIDER_CATALOG, seedStartable(fixture.repositoryPath))
  const host = await createHostComposition(options(dataPath))
  let first
  try {
    await startWork(host)
    first = await contextOf(host)
  } finally { await host.dispose() }
  assert.equal(first?.status, 'ready')
  assert.ok((await realpath(first.worktreeExternalId)).startsWith(path.join(await realpath(dataDir), 'worktrees') + path.sep), '工作树在宿主数据根的 worktrees 之下，即仓库检出之外')
  assert.equal(await fixture.run(['status', '--porcelain']), '', '仓库检出里没有任何新文件')

  const before = dump(dataPath)
  const tables = ['entity', 'external_identity', 'repository', 'execution_context', 'relation']
  assert.ok(tables.every((table) => rowsOf(before, table).length > 0), '夹具自检：五张表都有行，逐字节比较不是空转')
  const child = spawnSync(process.execPath, [RESTART_CHILD, dataPath, WORKSPACE, 'wi-1', REPOSITORY_ID], { encoding: 'utf8', timeout: 60_000 })
  assert.equal(child.status, 0, child.stderr)
  assert.deepEqual(JSON.parse(child.stdout), JSON.parse(JSON.stringify(first)), '新进程读回的执行上下文视图与重启前一致')
  const after = dump(dataPath)
  assert.deepEqual(tables.map((table) => after[table]), tables.map((table) => before[table]), '新进程重启不改写实体、身份、仓库、执行上下文与谱系关系')
})

// 数据根落在仓库检出之内时，允许根随之落进检出，挂载必须被禁用：守卫比的是检出根（repositoryPath 可以是检出的子目录），数据根或仓库路径经符号链接给出时也绕不过它。
// 只覆盖这四种形状：数据根下的 worktrees 或摘要分量本身是符号链接时守卫看不到，承接 #338（#132 计划 D35）。
const link = async (target, at) => { await mkdir(target, { recursive: true }); await symlink(target, at); return at }
for (const [shape, layout] of [
  ['repositoryPath 是检出根', async ({ repositoryPath: repo }) => [path.join(repo, 'host-data'), repo]],
  ['repositoryPath 是检出的子目录', async ({ repositoryPath: repo }) => [path.join(repo, 'host-data'), path.join(repo, 'sub')]],
  ['数据根经符号链接给出', async ({ root, repositoryPath: repo }) => [await link(path.join(repo, 'host-data'), path.join(root, 'data-link')), repo]],
  ['repositoryPath 经符号链接给出', async ({ root, repositoryPath: repo }) => [path.join(repo, 'host-data'), await link(repo, path.join(root, 'repo-link'))]],
]) {
  test(`AC6 允许根落进仓库检出时禁用该挂载（${shape}）`, async (t) => {
    const fixture = await fixtureFor(t)
    const [dataDir, repositoryPath] = await layout(fixture)
    await mkdir(repositoryPath, { recursive: true })
    const dataPath = path.join(dataDir, 'workspace.sqlite')
    await seed(dataPath, PROVIDER_CATALOG, seedStartable(repositoryPath))
    const host = await createHostComposition(options(dataPath))
    try {
      assert.deepEqual(host.disabled.map((item) => [item.bindingId, item.error.code]), [[LOCAL, 'invalid_input']], '数据根在检出之内：允许根随之落进检出，挂载被禁用')
      assert.notEqual((await startWork(host)).value?.status, 'ready', '没有可路由的开发挂载：Start Work 不得就绪')
      assert.equal(await contextOf(host), undefined)
      assert.equal((await worktreePaths(fixture)).length, 1, '检出内没有建出任何链接工作树')
    } finally { await host.dispose() }
  })
}
