/**
 * 离线 Development 替身的契约套件装配，外加五条判别性用例。判别性用例保护的不变量：变更请求的反向谱系
 * 记在提交上（不变量 6）；能力未启用时不落任何外部对象；分支已存在时报 conflict；外来 binding 的仓库
 * 引用不读也不写、不产生任何对象。删掉替身里的任一处实现，
 * 对应用例必须失败。
 *
 * 三个额外适配器各自钉住一种**真实 provider 的形态**，它们必须同样通过套件：
 *
 * - **只读子集**（`changeRequestCreate: false`，`change_request.read` 仍声明）：读与写是两个独立 key，
 *   套件不得用读的可用性代替写的可用性（Start Work 栈第五轮评审 blocking）。它表达的是能力子集，不是
 *   `permission: read_only`——后者答 `permission_denied`，不在套件的判定范围内。
 * - **未声明工作树移除**：套件不得向 provider 索取一个它没有声明的破坏性能力（issue #205，
 *   `AGENTS.md` §7 破坏性删除默认不做）。
 * - **真正省略可选方法**：替身把两个方法定义成类方法，所以 `fn === undefined` 那条分支在其它适配器上
 *   永远不可达——而「方法不存在」正是本地 Git provider 的真实形态（#160 不实现 `createChangeRequest`
 *   与 `removeWorktree`）。这里把方法藏掉，让那条分支有覆盖与判别力。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createFakeDevelopmentProvider, createFakeProviders } from '@harness-projects/provider-fake'
import { developmentContractSuite } from './suites/development.js'

const bindingId = 'binding-fake-development'
const repository = { bindingId, objectKind: 'repository', externalId: 'repo-alpha', url: undefined }
const changeRequestInput = { repository, head: 'main', base: 'main', title: '标题占位', body: '正文占位' }
const suiteExpect = {
  repository, baseBranch: 'main', headCommit: 'sha-1', pageSize: 1, worktreePath: '/worktrees/wt-1',
  // 副作用断言要看的对象集合：替身的 state 就是它持有的全部外部对象。
  objects: (provider) => structuredClone(provider.state),
}

developmentContractSuite({
  label: '离线 Development 替身',
  makeProvider: (scenario = {}) => createFakeDevelopmentProvider({ bindingId, ...scenario }),
  expect: suiteExpect,
})

developmentContractSuite({
  label: '离线 Development 替身（只读凭据：可读变更请求、不可建）',
  makeProvider: (scenario = {}) => createFakeDevelopmentProvider({
    bindingId, ...scenario, capabilities: { changeRequestCreate: false, ...scenario.capabilities },
  }),
  expect: suiteExpect,
})

developmentContractSuite({
  label: '离线 Development 替身（未声明工作树移除）',
  makeProvider: (scenario = {}) => createFakeDevelopmentProvider({
    bindingId, ...scenario, capabilities: { worktreeRemove: false, ...scenario.capabilities },
  }),
  expect: suiteExpect,
})

/** 把两个可选方法**藏掉**：`provider[method]` 返回 undefined，快照也不再声明对应 key。 */
function omittingProvider(scenario = {}) {
  const provider = createFakeDevelopmentProvider({
    bindingId, ...scenario, capabilities: { changeRequestCreate: false, worktreeRemove: false, ...scenario.capabilities },
  })
  const omitted = new Set(['createChangeRequest', 'removeWorktree'])
  return new Proxy(provider, {
    get(target, property, receiver) {
      if (typeof property === 'string' && omitted.has(property)) return undefined
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

developmentContractSuite({
  label: '离线 Development 替身（省略可选方法）',
  makeProvider: (scenario = {}) => omittingProvider(scenario),
  expect: suiteExpect,
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
