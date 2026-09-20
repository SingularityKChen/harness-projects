/**
 * 离线 Development 替身的契约套件装配，外加五条判别性用例。判别性用例保护的不变量：变更请求的反向谱系
 * 记在提交上（不变量 6）；能力未启用时不落任何外部对象；分支已存在时报 conflict；外来 binding 的仓库
 * 引用不读也不写、不产生任何对象。删掉替身里的任一处实现，
 * 对应用例必须失败。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createFakeDevelopmentProvider, createFakeProviders } from '@harness-projects/provider-fake'
import { developmentContractSuite } from './suites/development.js'

const bindingId = 'binding-fake-development'
const repository = { bindingId, objectKind: 'repository', externalId: 'repo-alpha', url: undefined }
const changeRequestInput = { repository, head: 'main', base: 'main', title: '标题占位', body: '正文占位' }

developmentContractSuite({
  label: '离线 Development 替身',
  makeProvider: (scenario = {}) => createFakeDevelopmentProvider({ bindingId, ...scenario }),
  expect: { repository, baseBranch: 'main', headCommit: 'sha-1', pageSize: 1, worktreePath: '/worktrees/wt-1' },
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
