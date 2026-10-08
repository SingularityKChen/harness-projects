/**
 * 离线 Development 替身的契约套件装配，外加五条判别性用例、坏 adapter 子进程 meta-test 与主用例自检。
 * 判别性用例保护的不变量：变更请求的反向谱系记在提交上（不变量 6）；能力未启用时不落任何外部对象；
 * 分支已存在时报 conflict；外来 binding 的仓库引用不读也不写。删掉替身里任一处实现，对应用例必须失败。
 *
 * 五个额外适配器各自钉住一种真实 provider 形态且必须同样通过套件：只读子集（读/写是两个独立 key）、
 * 未声明工作树移除（不索取未声明的破坏性能力，#205）、能读不能建、能建不能读、真正省略可选方法
 * （`fn === undefined` 那条分支在本地 Git provider 上是真实形态，#160）。末尾 meta-test 用 `execFile`
 * 把 `tests/fixtures/development-suite-adapters.mjs` 的每个 adapter 放进独立 `node --test` 子进程：
 * 合法子集零退出，坏 adapter 非零退出且失败消息命中预期片段——隔离避免预期红污染本文件的绿色。
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createFakeDevelopmentProvider } from '@harness-projects/provider-fake'
import { developmentContractSuite, assertUndeclaredRejected, withUndeclaredMethod } from './suites/development.js'

const bindingId = 'binding-fake-development'
const repository = { bindingId, objectKind: 'repository', externalId: 'repo-alpha', url: undefined }
const changeRequestInput = { repository, head: 'main', base: 'main', title: '标题占位', body: '正文占位' }
// 预置对象身份与 `objects` 钩子与 fixture 的 `SUITE_EXPECT` 共用一份定义，避免两处漂移；
// `baseProvider` 是真实 fake + 三条预置分支 + 一份预置工作树。
const adapterFixture = fileURLToPath(new URL('../fixtures/development-suite-adapters.mjs', import.meta.url))
const { OPTIONAL_METHOD_KEYS, RULE_LIAR_NAMES, SUITE_ADAPTERS, SUITE_EXPECT, baseProvider, omitMethods } = await import('../fixtures/development-suite-adapters.mjs')

developmentContractSuite({
  label: '离线 Development 替身',
  makeProvider: (scenario = {}) => baseProvider(scenario),
  expect: SUITE_EXPECT,
})

developmentContractSuite({
  label: '离线 Development 替身（只读凭据：可读变更请求、不可建）',
  makeProvider: (scenario = {}) => baseProvider({
    ...scenario, capabilities: { changeRequestCreate: false, ...scenario.capabilities },
  }),
  expect: SUITE_EXPECT,
})

developmentContractSuite({
  label: '离线 Development 替身（未声明工作树移除）',
  makeProvider: (scenario = {}) => baseProvider({
    ...scenario, capabilities: { worktreeRemove: false, ...scenario.capabilities },
  }),
  expect: SUITE_EXPECT,
})

// 真实「能读不能建」：创建关闭但读取仍声明。读取用例必须读 expect.worktreeRef 指向的预置工作树。
developmentContractSuite({
  label: '离线 Development 替身（能读工作树、不能创建）',
  makeProvider: (scenario = {}) => baseProvider({
    ...scenario, capabilities: { worktreeCreate: false, ...scenario.capabilities },
  }),
  expect: SUITE_EXPECT,
})

// 真实「能建不能读」：创建声明但读取关闭。创建后不得向未声明的 read 索取结果。
developmentContractSuite({
  label: '离线 Development 替身（能创建工作树、不能读取）',
  makeProvider: (scenario = {}) => baseProvider({
    ...scenario, capabilities: { worktreeRead: false, ...scenario.capabilities },
  }),
  expect: SUITE_EXPECT,
})

developmentContractSuite({
  label: '离线 Development 替身（省略可选方法）',
  makeProvider: (scenario = {}) => omitMethods(
    baseProvider({ ...scenario, capabilities: { changeRequestCreate: false, worktreeRemove: false, ...scenario.capabilities } }),
    'createChangeRequest', 'removeWorktree',
  ),
  expect: SUITE_EXPECT,
})

test('Development 替身：变更请求的反向谱系记在提交上，不重新识别对象', async () => {
  const provider = createFakeDevelopmentProvider({ bindingId })
  const created = await provider.createChangeRequest(changeRequestInput)
  assert.equal(created.ok, true)
  const commit = provider.state.commits.find((record) => record.sha === 'sha-1')
  assert.ok(commit, '种子提交必须存在')
  assert.equal(commit.changeRequest.externalId, created.value.ref.externalId, '头部提交必须记住自己属于哪个变更请求')
  assert.equal(commit.changeRequest.objectKind, 'change_request')
})

test('Development 替身：四种 reviewState 逐个精确透出，union 之外的来源枚举投影为 unknown，不从 open 状态猜结论', async () => {
  const provider = createFakeDevelopmentProvider({ bindingId })
  const base = {
    repository, title: '标题占位', body: '正文占位', state: 'open',
    headBranch: 'feature/review', headCommit: 'sha-1', sourceVersion: 'sha-1',
  }
  const states = ['approved', 'changes_requested', 'review_required', 'unknown']
  // fake 专属判别器直接构造记录：投影层只要把某一档压成 unknown，approved / changes_requested 正控就会红；
  // 末尾的 dismissed 是 union 之外的来源枚举，原样透传会让下面的集合比较与 pr-4 的读回一起红。
  for (const [index, reviewState] of [...states, 'dismissed'].entries()) {
    provider.state.changeRequests.push({
      ...base, ref: { ...repository, objectKind: 'change_request', externalId: `pr-${index}` },
      number: index + 1, reviewState,
    })
  }
  const listed = await provider.listChangeRequests({ repository, cursor: undefined, limit: 100 })
  assert.deepEqual([...new Set(listed.value.items.map((item) => item.reviewState))].sort(), [...states].sort(),
    '四种状态必须逐个透出，不得折叠成单一值')
  const approved = listed.value.items.find((item) => item.reviewState === 'approved')
  assert.equal(approved.reviewState, 'approved', '来源明确批准是正控：压成 unknown 会让这里变红')
  assert.equal(listed.value.items.find((item) => item.reviewState === 'changes_requested').reviewState, 'changes_requested',
    '来源明确要求修改是第二个非 unknown 正控')
  const read = await provider.getChangeRequest({ ...repository, objectKind: 'change_request', externalId: 'pr-0' })
  assert.equal(read.value.reviewState, 'approved')
  assert.equal(read.value.headBranch, 'feature/review', '未知来源不改变已记录的分支事实')
  const outside = await provider.getChangeRequest({ ...repository, objectKind: 'change_request', externalId: 'pr-4' })
  assert.equal(outside.value.reviewState, 'unknown', 'union 之外的来源枚举必须投影为 unknown，不得透传或默认 approved')
})

test('Development 替身：同一提交上的两个分支各自只读回自己的变更请求（相等身份，不按 SHA 反推分支）', async () => {
  const provider = createFakeDevelopmentProvider({ bindingId })
  for (const name of ['feature/same-sha-a', 'feature/same-sha-b']) {
    assert.equal((await provider.createBranch({ repository, name, fromRef: 'main' })).ok, true)
  }
  const first = await provider.createChangeRequest({ ...changeRequestInput, head: 'feature/same-sha-a' })
  const second = await provider.createChangeRequest({ ...changeRequestInput, head: 'feature/same-sha-b' })
  assert.equal(first.value.sourceVersion, second.value.sourceVersion, '两个分支指向同一头部提交，版本相等')
  assert.equal(first.value.headBranch, 'feature/same-sha-a')
  assert.equal(second.value.headBranch, 'feature/same-sha-b')
  const pageA = await provider.listChangeRequests({ repository, cursor: undefined, limit: 10, headBranch: 'feature/same-sha-a' })
  assert.deepEqual(pageA.value.items.map((item) => item.ref.externalId), [first.value.ref.externalId],
    '同 SHA 不得让另一个分支的变更请求混进来')
})

test('Development 替身：同一 binding 的另一个仓库同名分支不混入过滤结果（repository 身份先于 headBranch）', async () => {
  const provider = createFakeDevelopmentProvider({ bindingId })
  const second = { ...repository, externalId: 'repo-beta' }
  provider.state.repositories.push({ ref: second, name: 'beta', defaultBranch: 'main', sourceUpdatedAt: undefined })
  provider.state.branches.push({ repository: second, ref: { ...second, objectKind: 'branch', externalId: 'main' }, name: 'main', headCommit: 'sha-1' })
  const mine = await provider.createChangeRequest(changeRequestInput)
  const theirs = await provider.createChangeRequest({ ...changeRequestInput, repository: second })
  assert.equal(mine.ok, true)
  assert.equal(theirs.ok, true)
  assert.equal(mine.value.headBranch, 'main')
  assert.equal(theirs.value.headBranch, 'main', '跨仓同名分支是不同对象，但字段形状相同')
  const page = await provider.listChangeRequests({ repository, cursor: undefined, limit: 10, headBranch: 'main' })
  assert.deepEqual(page.value.items.map((item) => item.ref.externalId), [mine.value.ref.externalId],
    '先按 repository 身份限定后，另一个仓库的同名分支变更请求不得出现')
})

test('Development 替身：能力未启用时不落任何外部对象', async () => {
  const provider = createFakeDevelopmentProvider({ bindingId, capabilities: { changeRequestCreate: false } })
  const result = await provider.createChangeRequest(changeRequestInput)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'not_supported')
  assert.deepEqual(provider.state.changeRequests, [])
  assert.equal(provider.state.commits.some((record) => record.changeRequest !== undefined), false)
})

test('Development 替身：分支已存在时返回 conflict，不静默复用同名分支', async () => {
  const provider = createFakeDevelopmentProvider({ bindingId })
  const again = await provider.createBranch({ repository, name: 'main', fromRef: 'main' })
  assert.equal(again.ok, false)
  assert.equal(again.error.code, 'conflict')
})

test('Development 替身：外来 binding 的仓库引用被冷拒，state 里不产生任何对象', async () => {
  const provider = createFakeDevelopmentProvider({ bindingId })
  const foreign = { ...repository, bindingId: 'binding-foreign-development' }
  const foreignCommit = { ...foreign, objectKind: 'commit', externalId: 'sha-1' }
  const before = {
    branches: provider.state.branches.length,
    worktrees: provider.state.worktrees.length,
    changeRequests: provider.state.changeRequests.length,
    linkedCommits: provider.state.commits.filter((record) => record.changeRequest !== undefined).length,
  }
  const results = await Promise.all([
    provider.getRepository(foreign),
    provider.listBranches({ repository: foreign, cursor: undefined, limit: 10 }),
    provider.listChangeRequests({ repository: foreign, cursor: undefined, limit: 10 }),
  ])
  results.push(
    await provider.createBranch({ repository: foreign, name: 'feature/foreign', fromRef: 'main' }),
    await provider.createWorktree({ repository: foreign, path: '/worktrees/foreign', branch: 'main' }),
    await provider.createChangeRequest({ repository: foreign, head: 'sha-1', base: 'main', title: '外来变更请求', body: '正文占位' }),
    await provider.removeWorktree({ worktree: { ...foreign, objectKind: 'worktree', externalId: '/worktrees/foreign' } }),
    await provider.getCommit(foreignCommit),
    await provider.getChangeRequest({ ...foreign, objectKind: 'change_request', externalId: 'pr-1' }),
  )
  for (const result of results) {
    assert.equal(result.ok, false, '外来 binding 的引用必须失败，不得静默读到或写入')
    assert.equal(result.error.code, 'not_found')
  }
  assert.deepEqual(
    {
      branches: provider.state.branches.length,
      worktrees: provider.state.worktrees.length,
      changeRequests: provider.state.changeRequests.length,
      linkedCommits: provider.state.commits.filter((record) => record.changeRequest !== undefined).length,
    },
    before,
    '被拒的外来引用不得改动 state：分支 / 工作树 / 变更请求 / 提交反向谱系都必须原样',
  )
})

// `node --test` 会吞掉传给测试文件的 argv（实测 `process.argv` 只剩 node 与文件路径），所以 adapter 选择
// 只能经环境变量传入。子进程必须清掉 `NODE_TEST_CONTEXT`：继承它会让 `node --test` 把这次调用当成
// 「测试文件内递归调用 run()」，直接 skip 掉全部用例并以 0 退出——那样任何坏 adapter 都会被误判成通过。
// `failures` 只收错误首行（`XxxError [CODE]: 消息`）：用例名与 adapter label 不在其中，片段只能来自失败消息。
// 这个格式属于 spec reporter，所以子进程固定 `--test-reporter=spec`，并删掉继承来的 NODE_OPTIONS 里的 reporter 参数
// （实测 Node 26 把两处 reporter 叠加，与 destination 个数不符时直接拒绝启动，而不是 CLI 覆盖 NODE_OPTIONS）。
const runAdapterRaw = (name, { keepTestContext = false } = {}) => new Promise((resolve) => {
  const env = { ...process.env, DEVELOPMENT_SUITE_ADAPTER: name }
  if (!keepTestContext) delete env.NODE_TEST_CONTEXT
  env.NODE_OPTIONS = (env.NODE_OPTIONS ?? '').replace(/--test-reporter(?:-destination)?(?:=|\s+)\S+/g, '')
  execFile(process.execPath, ['--test', '--test-reporter=spec', '--test-timeout=60000', adapterFixture], {
    env, encoding: 'utf8', timeout: 120000,
  }, (error, stdout, stderr) => {
    const output = `${stdout}\n${stderr}`
    const failures = [...output.matchAll(/^\s*\w*Error(?: \[\w+\])?: (.*)$/gm)].map((match) => match[1])
    resolve({ code: error === null ? 0 : (error.code ?? 1), output, failures })
  })
})
const runAdapter = (name) => runAdapterRaw(name)

/**
 * 主用例路径的未声明判别自检：对五个可选方法各构造「快照不声明、方法存在且真的写 state」的 liar，要求
 * 导出的 `assertUndeclaredRejected` 在具名断言处拒绝；另用「未声明却成功」的 liar 钉住 not_supported。
 *
 * 这条测试存在的理由：契约套件自己不可能验证「未声明就必须结构化拒绝」——它必须由这份**装配**对 liar
 * 自检。否则把 `assertUndeclared` 或 `assertObjectsUnchanged` 改成 no-op 时，主用例会静默变绿而只剩
 * 子进程矩阵还在拦（独立对抗验证 P1-1 实测：no-op `assertUndeclared` 时主用例 64/65 绿）。
 */
test('主用例路径：五个可选方法的未声明成功、真实副作用与错误语义都被具名断言拦截', async () => {
  const inputs = {
    createBranch: { repository, name: 'feature/liar', fromRef: 'main' },
    createWorktree: { repository, path: '/worktrees/liar', branch: 'prepared/source' },
    getWorktree: { worktree: SUITE_EXPECT.worktreeRef },
    createChangeRequest: changeRequestInput,
    removeWorktree: { worktree: SUITE_EXPECT.worktreeRef },
  }
  // 三种 liar 各自的调用方式与它**唯一**能触发的具名断言：
  //   未声明却成功（真调用 fake，会回 ok:true）/ 结构化拒绝却写 state / 结构化拒绝但 retryable=true。
  const liars = {
    'undeclared-success': { expected: /未声明能力时必须返回结构化结果/, call: (target, input, method) => target[method].call(target, input) },
    'ns-sideeffect': {
      expected: /不得改动任何对象/,
      call: (target, input, method) => {
        // 只读方法本身没有合法写入，用 state 变更模拟「拒绝却动了对象」的坏 provider。
        if (method === 'getWorktree') target.state.worktrees.splice(0, target.state.worktrees.length)
        else target[method].call(target, input)
        return { ok: false, error: { code: 'not_supported', retryable: false } }
      },
    },
    'ns-retryable-true': { expected: /不是可重试的平台错误/, call: () => ({ ok: false, error: { code: 'not_supported', retryable: true } }) },
  }
  for (const [spec, liar] of Object.entries(liars)) {
    for (const [method, key] of Object.entries(OPTIONAL_METHOD_KEYS)) {
      const provider = withUndeclaredMethod(baseProvider(), method, (target, input) => liar.call(target, input, method))
      // 前提：这些 liar 的快照必须真的不声明对应 key，否则测的就不是未声明路径。
      assert.equal((await provider.describeCapabilities()).capability[key], undefined, `${method} 的 liar 快照必须不声明 ${key}`)
      await assert.rejects(
        () => assertUndeclaredRejected(provider, method, inputs[method], SUITE_EXPECT),
        (error) => {
          assert.match(error.message, liar.expected, `${spec} ${method}（${key}）必须被具名断言抓到，实际：${error.message}`)
          assert.ok(error.message.includes(method) && error.message.includes(key), `${spec} 的失败信息必须同时点名方法与 key，实际：${error.message}`)
          return true
        },
        `${spec} × ${method} 必须让主用例路径的未声明判定失败`,
      )
    }
  }
})

test('development-subset-matrix-rejects-liars：合法子集零退出，坏 adapter 非零退出且失败消息命中预期片段', async () => {
  // 合法形态必须**全部**零退出：判别不是「任何失败都算拒绝」。
  for (const [name, adapter] of Object.entries(SUITE_ADAPTERS).filter(([, entry]) => entry.liar !== true)) {
    const good = await runAdapter(name)
    assert.equal(good.code, 0, `合法 adapter「${name}」必须零退出，不能把「任何失败都算拒绝」。输出：\n${good.output}`)
  }

  const cases = Object.entries(SUITE_ADAPTERS).filter(([, entry]) => entry.liar === true)
  const required = Object.keys(OPTIONAL_METHOD_KEYS)
    .flatMap((method) => ['available-absent', 'undeclared-success', 'ns-sideeffect', 'bare-throw'].map((spec) => `${spec}-${method}`))
    .concat(['getChangeRequest', 'listChangeRequests'].flatMap((method) => [`undeclared-success-${method}`, `ns-sideeffect-${method}`]))
  // 变更请求分支与评审规则的坏形态（RULE_LIAR_NAMES）逐个必需：套件里任一条新断言被改成 no-op，对应的坏形态就会零退出。
  const ruleLiars = ['fresh-reports-approved', 'fresh-reports-changes-requested', 'sha-create-infers-branch', 'sha-reject-not-found',
    'sha-reject-not-supported', 'sha-reject-retryable', 'sha-reject-side-effect', 'readonly-review-squashed', 'readonly-filter-casefold',
    'filter-prefix', 'filter-suffix', 'empty-branch-wrong-code', 'missing-prepared-change-request-field']
  assert.deepEqual([...RULE_LIAR_NAMES].sort(), [...ruleLiars].sort(), '规则坏形态清单必须与夹具一致，不得静默删减')
  for (const name of [...required, ...ruleLiars, 'worktree-identity-swapped', 'cr-read-offline-first', 'cr-create-ambiguous-first', 'ns-sideeffect-createChangeRequest-lineage-input']) {
    assert.ok(cases.some(([candidate]) => candidate === name), `坏 adapter 矩阵必须覆盖 ${name}`)
  }
  for (const [name, adapter] of cases) {
    const result = await runAdapter(name)
    assert.notEqual(result.code, 0, `坏 adapter「${name}」必须非零退出，实际 ${result.code}。输出：\n${result.output}`)
    const hit = result.failures.some((message) => adapter.expectIncludes.every((fragment) => message.includes(fragment)))
    assert.ok(hit, `坏 adapter「${name}」必须有一条失败消息同时点名 ${adapter.expectIncludes.join(' + ')}。失败消息：\n${result.failures.join('\n')}`)
  }
})

/**
 * 负控：`NODE_TEST_CONTEXT` 删除行是 load-bearing 的。同一个坏 adapter（`ns-sideeffect-createBranch`）
 * 带继承来的 `NODE_TEST_CONTEXT=child-v8` 运行时，`node --test` 判定为「测试文件内递归调用 run()」，
 * skip 全部用例并以 0 退出——**看起来通过**，判别力归零；经 `runAdapter`（默认删掉该变量）运行则必须
 * 非零退出并命中具名断言。
 *
 * 将来有人删掉 `delete env.NODE_TEST_CONTEXT`，本测试的右半边（经 `runAdapter` 必须非零）会 RED——那条
 * 断言正是"删除该变量是 load-bearing 的"这一事实的机器可读证据，而不是只在注释里声明。
 */
test('NODE_TEST_CONTEXT 负控：带该变量会 skip 全部用例且零退出，删除它是 load-bearing 的', async () => {
  const contaminated = await runAdapterRaw('ns-sideeffect-createBranch', { keepTestContext: true })
  assert.equal(contaminated.code, 0, `带 NODE_TEST_CONTEXT 的坏 adapter 必须零退出（这正是危险之处）。输出：\n${contaminated.output}`)
  assert.match(contaminated.output, /skipping running files/, '负控必须展示「用例被 skip」的证据，而不是真的执行了断言')
  assert.ok(!contaminated.output.includes('不得改动任何对象'), '带 NODE_TEST_CONTEXT 时坏 adapter 的具名断言根本不该跑——否则这条负控本身失效')
  assert.ok(!/ℹ pass [1-9]/.test(contaminated.output), '负控必须证明没有任何用例真正执行')

  // 生产路径（`runAdapter`）删掉该变量后，同一个坏 adapter 必须真的跑起来并红在具名断言。
  const clean = await runAdapter('ns-sideeffect-createBranch')
  assert.notEqual(clean.code, 0, `经 runAdapter 的坏 adapter 必须非零退出；为零说明 NODE_TEST_CONTEXT 未被删除，判别力已丧失。输出：\n${clean.output}`)
  assert.ok(clean.failures.some((message) => message.includes('不得改动任何对象')), '干净运行必须命中具名副作用断言')
})
