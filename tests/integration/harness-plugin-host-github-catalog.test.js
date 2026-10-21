/**
 * Host 目录收录 GitHub 研发与 Actions provider（#355，ADR-0014）。入口是 `createHostComposition` 加生产目录 `PROVIDER_CATALOG`，
 * 种子直接写库，GitHub 流量只走注入的 fetch（`githubFetch` 的录制回放；C6 的「路径与头」用只记录的桩），C1 另把 `globalThis.fetch` 换成抛错桩
 * （不触网、不需要真实凭据）。保护的不变量：
 * 已存挂载在启动时组合且身份只来自存储；权限只按账号事实推导；凭据值只出现在单次请求的 authorization 头里；配置在写库时按 schema 闭集校验。
 */
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createWorkspaceSetup } from '@harness-projects/core'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { PROVIDER_CATALOG, githubRestTransport, hostStoragePolicy, restoreProviders } from '../../apps/harness-plugin/src/host-providers.ts'
import { HOST_REMOTE } from '../../apps/harness-plugin/src/remote.ts'
import { COMMIT, runsPath } from '../fixtures/github-actions.mjs'
import {
  HANDLE, REPOSITORY_MOUNTS, WORKSPACE, account, developmentFixture, dump, githubFetch, occurrences, ref, seed, seedPlanning, seedRepositoryMount, seedWorkspace,
} from './fixtures/host-seed.js'

const DEV = '00000000-0000-4000-8000-0000000000c1'
const ACTIONS = '00000000-0000-4000-8000-0000000000c2'
const SECOND_ACTIONS = '00000000-0000-4000-8000-0000000000c3'
const MOUNT_IDS = { 'development.github': DEV, 'github-actions': ACTIONS }
const CANARY = 'canary-c1-5e2a9d71'
const DEVELOPMENT_KEYS = ['development.repository.read', 'development.change_request.read']
const DELIVERY_KEYS = ['delivery.pipeline.read', 'delivery.check.read']
/** 夹具里第一个变更请求的 head 分支：按它过滤读，命中恰是这一条。 */
const HEAD_BRANCH = developmentFixture.exchanges.find((exchange) => exchange.operationName === 'DevelopmentChangeRequests' && exchange.variables.headRefName === null)
  .body.data.repository.pullRequests.nodes[0].headRefName

const dirs = []
test.after(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }) })
async function dataRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'harness-host-github-'))
  dirs.push(root)
  return { dataDir: path.join(root, 'harness-projects'), dataPath: path.join(root, 'harness-projects', 'workspace.sqlite') }
}
const options = (dataPath, extra) => ({ dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, resolveCredential: async () => undefined, ...extra })
/** 组合一次、取 baseline 的 wire 形态（严格 JSON 化后再解析成普通对象）与禁用列表，然后关闭。 */
async function compose(dataPath, extra) {
  const host = await createHostComposition(options(dataPath, extra))
  try {
    return { disabled: host.disabled, wire: JSON.parse(JSON.stringify(HOST_REMOTE.invocations[0].result.encode(await host.call('baseline', {})))) }
  } finally { host.dispose() }
}
const entriesOf = (wire, keys) => keys.map((key) => wire.capabilities.find((entry) => entry.key === key))
const accessAll = (keys, access) => keys.map((key) => ({ key, access }))
const codesOf = (disabled) => disabled.map((item) => [item.bindingId, item.error.code])
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function bounded(promise) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('请求未在测试截止后结束')), 1000) })]) } finally { clearTimeout(timer) }
}
/** 同库再恢复一次 provider 表，拿到组合时交给 Core 的同一种端口。 */
async function restored(dataPath, env) {
  const storage = createSqliteStorage(dataPath, hostStoragePolicy(PROVIDER_CATALOG))
  try { return await restoreProviders(storage, WORKSPACE, PROVIDER_CATALOG, { worktreesDir: path.join(path.dirname(dataPath), 'worktrees'), ...env }) } finally { storage.close() }
}
const repositoryOf = (implementationKey) => ({ bindingId: MOUNT_IDS[implementationKey], objectKind: 'repository', externalId: REPOSITORY_MOUNTS[implementationKey][1].repositoryExternalId, url: undefined })
/** 按游标读到底（至多 4 页），每页都必须 ok；返回读到的外部 id。 */
async function drain(read) {
  const ids = []
  let cursor
  for (let round = 0; round < 4; round += 1) {
    const page = await read(cursor)
    assert.equal(page.ok, true, `第 ${round + 1} 页：${page.error?.code} ${page.error?.rawClass}`)
    ids.push(...page.value.items.map((item) => item.ref.externalId))
    if ((cursor = page.value.nextCursor) === undefined) return ids
  }
  assert.fail('四页内没有读完')
}

test('C1 已存研发与 Actions 挂载在启动时组合并经宿主出口读通；凭据只在单次请求的 authorization 头里', async (t) => {
  const stray = t.mock.method(globalThis, 'fetch', async () => { throw new Error('测试不得触网') })
  const timeouts = t.mock.method(AbortSignal, 'timeout') // 原实现照常生效，只记录参数与返回的 signal
  const { dataDir, dataPath } = await dataRoot()
  await seed(dataPath, PROVIDER_CATALOG, async (storage) => {
    await seedWorkspace(storage)
    await seedPlanning(storage)
    await seedRepositoryMount(storage, DEV, 'development.github')
    await seedRepositoryMount(storage, ACTIONS, 'github-actions')
  })
  const seeded = dump(dataPath)
  const github = githubFetch()
  const resolved = []
  const env = { fetch: github.fetch, resolveCredential: async (handle) => { resolved.push(handle); return CANARY } }
  const { disabled, wire } = await compose(dataPath, env)
  assert.deepEqual(disabled, [], '两个挂载都被组合，没有挂载被禁用')
  assert.deepEqual(entriesOf(wire, DEVELOPMENT_KEYS), accessAll(DEVELOPMENT_KEYS, 'available'), '研发两 key 经组合期探针确认为 available')
  assert.deepEqual(entriesOf(wire, DELIVERY_KEYS), accessAll(DELIVERY_KEYS, 'degraded'), '交付两 key 是 Host 传入的 degraded：有句柄但未验证')
  assert.deepEqual([github.requests.filter((request) => request.operationName === 'DevelopmentRepository').length, github.requests.filter((request) => request.path !== '/graphql').length], [1, 0],
    '组合期研发只发一次仓库探针，Actions 不触网')
  const identity = ['workspace', 'provider_binding', 'workspace_binding', 'connector_account']
  const composed = dump(dataPath)
  assert.deepEqual(identity.map((table) => composed[table]), identity.map((table) => seeded[table]), '身份只来自存储：首次组合不改写四张身份表')

  const ports = await restored(dataPath, env)
  assert.deepEqual(ports.disabled, [])
  const development = ports.table.development[0]
  const changes = await development.listChangeRequests({ repository: repositoryOf('development.github'), cursor: undefined, limit: 100, headBranch: HEAD_BRANCH })
  assert.deepEqual([changes.ok, changes.value?.items.map((item) => item.headBranch)], [true, [HEAD_BRANCH]], '恢复的研发端口按 head 分支读到夹具里的变更请求')
  assert.equal((await development.getRepository(repositoryOf('development.github'))).ok, true, '同一端口的第二次读：凭据按请求解析，不在构造时缓存')
  const actions = { repository: repositoryOf('github-actions'), commit: COMMIT, limit: 1 }
  assert.deepEqual(await drain((cursor) => ports.table.delivery.listPipelineRuns({ ...actions, cursor })), ['90000000001', '90000000003'], 'runs 经 REST 出口读完两页')
  assert.deepEqual(await drain((cursor) => ports.table.delivery.listChecks({ ...actions, cursor })), ['90000000001', '90000000003'], 'check runs 经 REST 出口读完两页')
  assert.deepEqual(github.misses, [], '回放没有未命中：REST 只落在白名单的三条路径上')
  assert.equal(stray.mock.callCount(), 0, '条目只用注入的 fetch，不碰 globalThis.fetch')

  const configurations = Object.fromEntries(JSON.parse(dump(dataPath).workspace_binding).map((row) => [row.binding_id, row.configuration_json]))
  for (const id of [DEV, ACTIONS]) assert.deepEqual(Object.keys(JSON.parse(configurations[id])).sort(), ['repositoryExternalId', 'repositoryName', 'repositoryOwner'], '挂载配置恰为三个字段')
  assert.deepEqual(await readdir(dataDir, { recursive: true }), ['workspace.sqlite'], '扫描范围：存储不开 WAL（没有 -wal、-shm），C1 没有失败路径、不写诊断日志')
  for (const needle of [CANARY, Buffer.from(CANARY).toString('base64')]) assert.equal(await occurrences(dataDir, needle), 0, `库文件不含凭据值：${needle}`)
  assert.ok(await occurrences(dataDir, HANDLE) >= 1, '阳性对照：同一扫描找得到库里存的句柄名')
  assert.equal(JSON.stringify([wire, disabled, ports.disabled]).includes(CANARY), false, 'wire 与禁用记录不含凭据值')

  const runs = github.requests.filter((request) => request.path === runsPath())
  assert.ok(runs.length > 0 && runs.every((request) => request.query.head_sha === COMMIT), 'runs 请求按提交过滤：查询串带 head_sha')
  assert.equal(resolved.length, github.requests.length, '每次请求解析一次凭据，不缓存')
  assert.deepEqual([...new Set(resolved)], [HANDLE])
  assert.equal(new Set(github.requests.map((request) => request.signal)).size, github.requests.length, '超时按请求计：每个请求一个新的 signal，不跨请求共用')
  for (const { href, origin, path: pathname, method, headers, redirect, signal } of github.requests) {
    const { authorization, ...others } = headers
    assert.equal(authorization, `bearer ${CANARY}`, '凭据只以宿主 bearer 出现在 authorization 头')
    assert.equal(JSON.stringify([href, others]).includes(CANARY), false, 'URL 与其它请求头不含凭据值')
    const timeoutMs = timeouts.mock.calls.find((call) => call.result === signal)?.arguments[0]
    assert.deepEqual([origin, others['user-agent'], redirect, timeoutMs], ['https://api.github.com', 'harness-projects', 'error', 30_000], `${method} ${pathname}：只发往 api.github.com，不跟随重定向，signal 恰是 AbortSignal.timeout(30_000)`)
    if (pathname === '/graphql') assert.deepEqual([method, others['content-type']], ['POST', 'application/json'], 'GraphQL 只用 POST')
    else assert.deepEqual([method, others.accept, others['x-github-api-version']], ['GET', 'application/vnd.github+json', '2022-11-28'], 'REST 只用 GET 且带 provider 的静态头')
  }
})

test('C2 权限只按账号事实推导：研发要 github.com 账号带句柄，Actions 无可用凭据时组合但显式 unavailable', async (t) => {
  const noMount = DELIVERY_KEYS.map((key) => ({ key, access: 'unavailable', reason: `没有挂载提供能力 ${key}` }))
  for (const [label, accountOverrides, expected, delivery] of [
    ['无关联账号', undefined, [[DEV, 'not_supported']], accessAll(DELIVERY_KEYS, 'unavailable')],
    ['github.com 账号不带句柄', { secretHandle: undefined }, [[DEV, 'not_supported']], accessAll(DELIVERY_KEYS, 'unavailable')],
    ['非 github.com 账号（带句柄）', { platformOrigin: 'https://github.example.com' }, [[DEV, 'not_supported'], [ACTIONS, 'not_supported']], noMount],
    ['非 github.com 账号（不带句柄）', { platformOrigin: 'https://github.example.com', secretHandle: undefined }, [[DEV, 'not_supported'], [ACTIONS, 'not_supported']], noMount],
    ['非 github.com 账号（来源以 github.com 为前缀）', { platformOrigin: 'https://github.com.example' }, [[DEV, 'not_supported'], [ACTIONS, 'not_supported']], noMount],
  ]) await t.test(label, async () => { // 子用例：变异归因到具体的一行
    const { dataPath } = await dataRoot()
    const linked = accountOverrides !== undefined
    await seed(dataPath, PROVIDER_CATALOG, async (storage) => {
      await seedWorkspace(storage)
      if (linked) await storage.putConnectorAccount(account(accountOverrides))
      await seedRepositoryMount(storage, DEV, 'development.github', { linked })
      await seedRepositoryMount(storage, ACTIONS, 'github-actions', { linked })
    })
    const github = githubFetch()
    const env = { fetch: github.fetch, resolveCredential: async () => CANARY } // 凭据可解析：被组合并放行就会发请求
    const { disabled, wire } = await compose(dataPath, env)
    assert.deepEqual(codesOf(disabled), expected, label)
    assert.deepEqual(entriesOf(wire, DELIVERY_KEYS), delivery, '有挂载但不可用：reason 为空，区别于「没有挂载」')
    const ports = await restored(dataPath, env)
    if (ports.table.delivery !== undefined) assert.deepEqual((await ports.table.delivery.describeCapabilities()).permission, Object.fromEntries(DELIVERY_KEYS.map((key) => [key, 'unavailable'])), '恢复的端口报告 Host 传入的 unavailable')
    assert.equal(github.requests.length, 0, '被禁用或权限 unavailable 的挂载不发请求')
  })
})

test('C4 第二个启用的交付挂载走槽位冲突，第一个照常组合', async () => {
  const { dataPath } = await dataRoot()
  await seed(dataPath, PROVIDER_CATALOG, async (storage) => {
    await seedWorkspace(storage)
    await storage.putConnectorAccount(account())
    await seedRepositoryMount(storage, ACTIONS, 'github-actions')
    await seedRepositoryMount(storage, SECOND_ACTIONS, 'github-actions', { isDefault: false })
  })
  const env = { fetch: githubFetch().fetch, resolveCredential: async () => CANARY }
  const { disabled, wire } = await compose(dataPath, env)
  assert.deepEqual(disabled.map((item) => [item.bindingId, item.implementationKey, item.error.code]), [[SECOND_ACTIONS, 'github-actions', 'conflict']], '只有第二个交付挂载被禁用')
  assert.deepEqual(entriesOf(wire, DELIVERY_KEYS), accessAll(DELIVERY_KEYS, 'degraded'), '第一个挂载照常提供交付能力')
  assert.equal((await (await restored(dataPath, env)).table.delivery.describeCapabilities()).bindingId, ACTIONS, '槽位归先写入的挂载')
})

test('C5 仓库条目的配置在写库时按闭集 schema 校验', async (t) => {
  for (const implementationKey of ['development.github', 'github-actions']) await t.test(implementationKey, async () => {
    const { dataPath } = await dataRoot()
    const [domain, valid] = REPOSITORY_MOUNTS[implementationKey]
    const id = MOUNT_IDS[implementationKey]
    await seed(dataPath, PROVIDER_CATALOG, async (storage) => {
      await seedWorkspace(storage)
      await seedRepositoryMount(storage, id, implementationKey, { linked: false }) // 阳性对照：合法配置能写入
      for (const [label, configuration, message] of [
        ['owner 含分隔符', { ...valid, repositoryOwner: 'a/b' }, /does not match the declared pattern/],
        ['name 是 ..', { ...valid, repositoryName: '..' }, /does not match the declared pattern/],
        ['name 以 . 开头', { ...valid, repositoryName: '.github' }, /does not match the declared pattern/],
        ...Object.keys(valid).map((field) => [`缺 ${field}`, Object.fromEntries(Object.entries(valid).filter(([name]) => name !== field)), /missing a required field/]),
        ['多出 token 字段', { ...valid, token: 'canary-c5-0d4b' }, /field is not declared/],
      ]) await assert.rejects(storage.putBindingConfiguration({ ref: ref(id, domain), configuration }), (error) => error instanceof RangeError && message.test(error.message), label)
    })
  })
})

test('C6 REST 出口：凭据缺失时零请求，URL 只落在 api.github.com，宿主 bearer 不可被 provider 头覆盖', async (t) => {
  const request = { method: 'GET', path: runsPath(), query: { head_sha: COMMIT, per_page: 1, page: 1 }, headers: {} }
  for (const [label, token] of [['凭据 undefined', undefined], ['凭据空串', '']]) await t.test(label, async () => {
    const github = githubFetch()
    await assert.rejects(githubRestTransport(github.fetch, async () => token)(request))
    assert.equal(github.requests.length, 0, '凭据解析不到：reject 且 fetch 0 次')
  })
  await t.test('路径与头', async () => {
    const sent = []
    const fetch = async (href, init) => { sent.push({ origin: new URL(href).origin, headers: Object.fromEntries(new Headers(init.headers)) }); return new Response('{}') }
    const transport = githubRestTransport(fetch, async () => CANARY)
    for (const pathname of ['.evil.example/x', '//evil.example/x']) await transport({ ...request, path: pathname })
    await transport({ ...request, headers: { authorization: 'bearer provider', Authorization: 'token provider', 'User-Agent': 'provider' } })
    assert.deepEqual(sent.map((item) => item.origin), Array(3).fill('https://api.github.com'), 'pathname 赋值保住 origin：拼接会把 .evil.example 拼成别的主机，相对解析会把 //evil.example 当成主机')
    assert.deepEqual([sent[2].headers.authorization, sent[2].headers['user-agent']], [`bearer ${CANARY}`, 'harness-projects'], 'provider 头（含大小写变体）覆盖不了宿主的 bearer 与 user-agent')
  })
})

test('C7 宿主出口的失败经真实端口安全映射，故障解除后同一端口恢复读取', async (t) => {
  for (const [failure, developmentCode, actionsCode] of [
    ['credential', 'unavailable', 'unavailable'], ['network', 'unavailable', 'unavailable'],
    ['abort', 'unavailable', 'unavailable'], ['json', 'unavailable', 'unavailable'], ['body', 'unavailable', 'unavailable'],
    [302, 'unavailable', 'unavailable'], [401, 'permission_denied', 'permission_denied'],
    [403, 'permission_denied', 'permission_denied'], [404, 'unavailable', 'not_found'], [429, 'rate_limited', 'rate_limited'],
  ]) await t.test(String(failure), async (st) => {
    const { dataDir, dataPath } = await dataRoot()
    await seed(dataPath, PROVIDER_CATALOG, async (storage) => {
      await seedWorkspace(storage)
      await storage.putConnectorAccount(account())
      await seedRepositoryMount(storage, DEV, 'development.github')
      await seedRepositoryMount(storage, ACTIONS, 'github-actions')
    })
    const github = githubFetch()
    let failing = true
    let fetches = 0
    const secretFailure = () => new Error(`upstream failure ${CANARY}`)
    // 提前中止真实 signal，独立验证 provider 如何处理 AbortSignal 的失败；30 s 参数由 C1 判别。
    if (failure === 'abort') st.mock.method(AbortSignal, 'timeout', () => AbortSignal.abort(secretFailure()))
    const env = {
      resolveCredential: async () => { if (failing && failure === 'credential') throw secretFailure(); return CANARY },
      fetch: async (href, init) => {
        fetches += 1
        if (!failing) return github.fetch(href, init)
        if (failure === 'network') throw secretFailure()
        if (failure === 'abort') init.signal.throwIfAborted()
        if (failure === 'json') return new Response(`invalid JSON ${CANARY}`)
        if (failure === 'body') return new Response(new ReadableStream({ start(controller) { controller.error(secretFailure()) } }))
        return new Response(JSON.stringify({ message: CANARY }), { status: failure, headers: { 'x-github-request-id': CANARY } })
      },
    }
    const { disabled, wire } = await compose(dataPath, env)
    assert.deepEqual(disabled, [], '出口失败不删除或禁用已存挂载')
    assert.deepEqual(entriesOf(wire, [...DEVELOPMENT_KEYS, ...DELIVERY_KEYS]), accessAll([...DEVELOPMENT_KEYS, ...DELIVERY_KEYS], 'degraded'))
    const ports = await restored(dataPath, env)
    const readDevelopment = () => ports.table.development[0].getRepository(repositoryOf('development.github'))
    const readActions = () => ports.table.delivery.listPipelineRuns({ repository: repositoryOf('github-actions'), commit: COMMIT, limit: 1 })
    const results = await Promise.all([readDevelopment(), readActions()])
    assert.deepEqual(results.map((result) => [result.ok, result.error?.code]), [[false, developmentCode], [false, actionsCode]])
    assert.equal(fetches, ['credential', 'abort'].includes(failure) ? 0 : 3, '凭据失败或入口预算已中止时零 fetch；其余恰为组合探针与两次读取，无重试或重定向请求')
    assert.equal(JSON.stringify([disabled, wire, results]).includes(CANARY), false, '错误正文、异常与伪 request id 均不上 wire 或端口结果')
    assert.equal(await occurrences(dataDir, CANARY), 0, '失败路径的库文件与宿主诊断日志均不含凭据')
    st.mock.restoreAll()
    failing = false
    assert.deepEqual((await Promise.all([readDevelopment(), readActions()])).map((result) => result.ok), [true, true], '同一端口下一次调用可恢复，无失败缓存')
    assert.deepEqual(github.misses, [])
  })
})

test('C8 仓库绑定写者按生产目录策略写入后，Host 重启恢复并读取同一仓库的研发与交付端口', async () => {
  const { dataPath } = await dataRoot()
  let bindingIds
  const repositoryId = REPOSITORY_MOUNTS['development.github'][1].repositoryExternalId
  await seed(dataPath, PROVIDER_CATALOG, async (storage) => {
    await seedWorkspace(storage)
    await storage.putConnectorAccount(account())
    const references = Object.entries(REPOSITORY_MOUNTS).map(([implementationKey, [domain, configuration]]) => ({
      domain, implementationKey, configuration, accountId: account().id,
    }))
    const result = await createWorkspaceSetup(storage).bindRepository({ workspaceId: WORKSPACE, repositoryId, references })
    assert.equal(result.ok, true, '真实绑定命令使用 Host schema，无临时放宽的测试策略')
    bindingIds = result.value.bindingIds
    assert.equal(bindingIds.length, 2)
  })
  const before = dump(dataPath)
  const github = githubFetch()
  const env = { fetch: github.fetch, resolveCredential: async () => CANARY }
  const { disabled, wire } = await compose(dataPath, env)
  assert.deepEqual(disabled, [])
  assert.deepEqual(entriesOf(wire, DEVELOPMENT_KEYS), accessAll(DEVELOPMENT_KEYS, 'available'))
  assert.deepEqual(entriesOf(wire, DELIVERY_KEYS), accessAll(DELIVERY_KEYS, 'degraded'))
  const ports = await restored(dataPath, env)
  const ref = (index) => ({ bindingId: bindingIds[index], objectKind: 'repository', externalId: repositoryId, url: undefined })
  assert.equal((await ports.table.development[0].getRepository(ref(0))).ok, true)
  assert.deepEqual(await drain((cursor) => ports.table.delivery.listPipelineRuns({ repository: ref(1), commit: COMMIT, limit: 1, cursor })), ['90000000001', '90000000003'])
  const after = dump(dataPath)
  for (const table of ['provider_binding', 'connector_account', 'external_identity', 'repository']) {
    assert.equal(typeof before[table], 'string', '核对的表必须实际存在')
    assert.deepEqual(after[table], before[table], `Host 恢复不改写绑定写者的 ${table}`)
  }
  const configurations = (snapshot) => JSON.parse(snapshot.workspace_binding).map(({ is_default, ...row }) => row)
  assert.deepEqual(configurations(after), configurations(before), '账号与配置仍归绑定写者；Core 按既有规则把唯一研发挂载归一为默认')
  assert.deepEqual(JSON.parse(after.workspace_binding).map((row) => row.is_default), [1, 1])
  assert.deepEqual(github.misses, [])
})

test('C9 只挂研发且凭据永不返回时，Host 组合在请求预算后结束且零 fetch', async (t) => {
  const { dataDir, dataPath } = await dataRoot(), entered = deferred(), deadlines = []
  t.mock.method(AbortSignal, 'timeout', (ms) => { assert.equal(ms, 30_000); const controller = new AbortController(); deadlines.push(controller); return controller.signal })
  await seed(dataPath, PROVIDER_CATALOG, async (storage) => { await seedWorkspace(storage); await storage.putConnectorAccount(account()); await seedRepositoryMount(storage, DEV, 'development.github') })
  let fetches = 0
  const pending = compose(dataPath, { resolveCredential: () => { entered.resolve(); return new Promise(() => {}) }, fetch: async () => { fetches++; throw new Error('不能到 fetch') } })
  await bounded(entered.promise)
  assert.equal(deadlines.length, 1, '请求必须在等待凭据之前建立 30 s 预算')
  deadlines[0].abort(new Error(CANARY))
  const { disabled, wire } = await bounded(pending)
  assert.deepEqual(disabled, []); assert.deepEqual(entriesOf(wire, DEVELOPMENT_KEYS), accessAll(DEVELOPMENT_KEYS, 'degraded'))
  assert.equal(fetches, 0); assert.equal(JSON.stringify([disabled, wire]).includes(CANARY), false); assert.equal(await occurrences(dataDir, CANARY), 0)
})

test('C10 凭据、fetch 与响应体共用入口预算，不合作的晚结果被消费且不晚发请求', async (t) => {
  const deadlines = []
  t.mock.method(AbortSignal, 'timeout', (ms) => { assert.equal(ms, 30_000); const controller = new AbortController(); deadlines.push(controller); return controller.signal })
  const request = { method: 'GET', path: runsPath(), query: {}, headers: {} }
  for (const stage of ['credential-resolve', 'credential-reject', 'fetch', 'body']) await t.test(stage, async () => {
    const credential = deferred(), fetchResult = deferred(), body = deferred(), entered = deferred(), bodyEntered = deferred()
    const before = deadlines.length
    let fetches = 0, signal
    const pending = githubRestTransport(async (_, init) => { fetches++; signal = init.signal; entered.resolve(); return fetchResult.promise }, () => credential.promise)(request)
    assert.equal(deadlines.length, before + 1, '每次请求只建一个新预算，且从凭据前开始')
    const rejected = assert.rejects(() => bounded(pending), (error) => error.message === CANARY)
    const deadline = deadlines.at(-1)
    if (stage === 'fetch' || stage === 'body') {
      credential.resolve(CANARY); await bounded(entered.promise)
      assert.equal(signal, deadline.signal, 'fetch 复用凭据阶段已经建立的同一个预算')
      if (stage === 'body') { fetchResult.resolve({ status: 200, headers: new Headers(), json: () => { bodyEntered.resolve(); return body.promise } }); await bounded(bodyEntered.promise) }
    }
    deadline.abort(new Error(CANARY)); await rejected
    if (stage === 'credential-resolve') credential.resolve(CANARY)
    else if (stage === 'credential-reject') credential.reject(new Error('LATE-CREDENTIAL'))
    else if (stage === 'fetch') fetchResult.reject(new Error('LATE-FETCH'))
    else body.reject(new Error('LATE-BODY'))
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(fetches, stage.startsWith('credential') ? 0 : 1, '超时后凭据晚到不得发 fetch，fetch/body 只消费晚拒绝')
  })
})

test('C11 配置仓库键与绑定 repositoryId 不一致时 Host 端口拒绝且零 REST', async () => {
  const { dataPath } = await dataRoot(), repositoryId = REPOSITORY_MOUNTS['development.github'][1].repositoryExternalId
  let bindingIds
  await seed(dataPath, PROVIDER_CATALOG, async (storage) => {
    await seedWorkspace(storage); await storage.putConnectorAccount(account())
    const references = Object.entries(REPOSITORY_MOUNTS).map(([implementationKey, [domain, configuration]]) => ({ domain, implementationKey, configuration: { ...configuration, ...(domain === 'delivery' ? { repositoryExternalId: 'other-repository' } : {}) }, accountId: account().id }))
    const result = await createWorkspaceSetup(storage).bindRepository({ workspaceId: WORKSPACE, repositoryId, references })
    assert.equal(result.ok, true); bindingIds = result.value.bindingIds
  })
  const github = githubFetch(), env = { fetch: github.fetch, resolveCredential: async () => CANARY }
  assert.deepEqual((await compose(dataPath, env)).disabled, [])
  const ports = await restored(dataPath, env), before = github.requests.length
  const result = await ports.table.delivery.listPipelineRuns({ repository: { bindingId: bindingIds[1], objectKind: 'repository', externalId: repositoryId, url: undefined }, commit: COMMIT, limit: 1 })
  assert.deepEqual([result.ok, result.error?.code, result.error?.rawClass], [false, 'not_found', 'foreign_ref'])
  assert.equal(github.requests.length, before, '绑定键不一致在 provider 输入闸门被拒，读本身零 REST')
  assert.deepEqual(github.requests.map((request) => request.operationName), ['DevelopmentRepository'])
})

test('C12 回滚目录只禁用未收录挂载并保留库行，重新收录后按原身份恢复', async () => {
  const { dataPath } = await dataRoot()
  await seed(dataPath, PROVIDER_CATALOG, async (storage) => {
    await seedWorkspace(storage); await seedPlanning(storage)
    await seedRepositoryMount(storage, DEV, 'development.github'); await seedRepositoryMount(storage, ACTIONS, 'github-actions')
  })
  const before = dump(dataPath), github = githubFetch(), env = { fetch: github.fetch, resolveCredential: async () => CANARY }
  const oldCatalog = new Map([...PROVIDER_CATALOG].filter(([key]) => !['development.github', 'github-actions'].includes(key)))
  const { disabled, wire } = await compose(dataPath, { ...env, catalog: oldCatalog })
  assert.deepEqual(codesOf(disabled), [[DEV, 'not_supported'], [ACTIONS, 'not_supported']])
  assert.equal(wire.capabilities.find((entry) => entry.key === 'planning.item.read').access, 'available')
  for (const table of ['provider_binding', 'workspace_binding', 'connector_account']) assert.equal(dump(dataPath)[table], before[table], table)
  const restored = await compose(dataPath, env)
  assert.deepEqual(restored.disabled, []); assert.deepEqual(entriesOf(restored.wire, DEVELOPMENT_KEYS), accessAll(DEVELOPMENT_KEYS, 'available'))
  assert.deepEqual(entriesOf(restored.wire, DELIVERY_KEYS), accessAll(DELIVERY_KEYS, 'degraded'))
  for (const table of ['provider_binding', 'workspace_binding', 'connector_account']) assert.equal(dump(dataPath)[table], before[table], table)
})
