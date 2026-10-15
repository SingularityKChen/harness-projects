/**
 * #231 验收 1 / 4 的 core 端到端接缝（不触网、无凭据）：Start Work 用离线 Development 替身建出执行上下文，再在同一份 Storage 上换成
 * 真 GitHub Development provider 加脚本化平台重新组合，跑 core 的交付刷新。保护：PR 只经 head 分支（同仓库、字节精确）挂上谱系；
 * 标题、fork 同名分支、大小写三个诱饵与目标头部提交相同、排在目标之前，在平台精确过滤与忽略过滤两种模式下都不入库；目标之前还有
 * 60 个 fork 同名 PR，core 只读首页（limit 50），provider 不在一次调用内补满一页就读不到目标；变更请求实体 id 是 core 派生的哈希，
 * provider node id 不成为实体、关系端点或仓库行的主键。provider 层的形状与失败矩阵在
 * tests/contract/development-github-contract.test.js，录制夹具上的完整谱系属 #233。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { composeCore } from '@harness-projects/core'
import { createFakeProviders, exportFakeStorageState } from '@harness-projects/provider-fake'
import { createGithubDevelopmentProvider } from '@harness-projects/provider-development-github'

/** 离线替身播种的仓库键：Start Work 把它写成仓库主键，GitHub provider 的 `repository.externalId` 必须与它相同。 */
const REPOSITORY = 'repo-alpha'
const HEAD = 'c'.repeat(40)
const ok = (data) => ({ status: 200, headers: {}, body: { data } })
const pr = (id, number, headRefName, overrides = {}) => ({
  id, number, title: `PR ${number}`, body: '', state: 'OPEN', url: `https://example.test/pull/${number}`, updatedAt: '2026-10-15T00:00:00Z',
  headRefName, headRefOid: HEAD, isCrossRepository: false, reviewDecision: null, ...overrides,
})

test('core 端到端：PR 只经 head 分支挂上谱系，标题 / fork / 大小写诱饵不入库，provider node id 不作任何主键', async () => {
  for (const mode of ['精确', '忽略']) {
    const providers = createFakeProviders()
    const workspace = { id: newWorkspaceId(), name: `github-development/${mode}`, statusPolicy: StatusPolicy.ManualOnly }
    const first = await composeCore({ workspace, providers })
    const item = (await first.queries.listPlanningItems()).find((view) => view.kind === 'work_item' && view.content.contentKind === 'work_item')
    const started = await first.commands.startWork({ repositoryId: REPOSITORY, actor: { kind: 'agent' }, workItemId: item.entityId, idempotencyKey: `lineage-${mode}` })
    assert.equal(started.confirmed, true, '前置：Start Work 建出分支与工作树')
    const branch = exportFakeStorageState(providers.storage).contexts[0].branchExternalId
    // 诱饵在 CREATED_AT DESC 下排在目标之前：后过滤或平台过滤一旦失守，core「取第一个头部提交相等的项」就会挂错；前置的 60 个 fork 占满首页。
    const nodes = [...Array.from({ length: 60 }, (_, index) => pr(`PR_far_${index}`, 100 + index, branch, { isCrossRepository: true })), pr('PR_title', 4, 'feature/other', { title: branch }), pr('PR_fork', 3, branch, { isCrossRepository: true }), pr('PR_case', 2, branch.toUpperCase()), pr('PR_target', 1, branch)]
    const platform = ({ operationName, variables }) => {
      if (operationName === 'DevelopmentRepository') return ok({ repository: { name: 'sandbox', updatedAt: '2026-10-15T00:00:00Z', defaultBranchRef: { name: 'main' } } })
      if (operationName === 'DevelopmentBranches') return ok({ repository: { refs: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ name: branch, target: { oid: HEAD } }] } } })
      const listed = mode === '精确' ? nodes.filter((node) => node.headRefName === variables.headRefName) : nodes
      const offset = variables.after === null ? 0 : Number(variables.after.slice(1))
      return ok({ repository: { pullRequests: { pageInfo: { hasNextPage: offset + variables.first < listed.length, endCursor: `C${offset + variables.first}` }, nodes: listed.slice(offset, offset + variables.first) } } })
    }
    const development = createGithubDevelopmentProvider({
      bindingId: 'binding-github-development', repository: { externalId: REPOSITORY, owner: 'sandbox-owner', name: 'sandbox' }, transport: async (request) => platform(request),
    })
    const core = await composeCore({ workspace, providers: { ...providers, development }, storage: providers.storage })
    const scope = { workItemId: item.entityId, repositoryId: REPOSITORY }
    assert.equal((await core.commands.refreshDeliveryFacts(scope)).error, undefined, `${mode}：刷新本身不得失败`)
    const hops = (await core.queries.getDeliveryProjection(scope)).hops
    const changeRequest = hops.find((hop) => hop.entityKind === 'change_request')
    assert.deepEqual([mode, changeRequest?.externalId, changeRequest?.observed], [mode, 'PR_target', true], `平台${mode}过滤：只挂上同仓库、分支字节相等的 PR`)
    assert.match(changeRequest.from, /^change_request-[0-9a-f]{32}$/, '`produced_by` 的变更请求端是 core 派生的哈希，不是 node id')
    const state = exportFakeStorageState(providers.storage)
    const stored = JSON.stringify(state)
    assert.deepEqual(nodes.filter((node) => node.id !== 'PR_target' && stored.includes(node.id)).map((node) => node.id), [], `${mode}：诱饵的 node id 不得入库`)
    const keys = [...state.entities.map((entity) => entity.id), ...state.relations.flatMap(({ relation }) => [relation.from, relation.to]), ...state.repositories.map((row) => row.id)]
    assert.deepEqual([stored.includes('PR_target'), keys.filter((key) => nodes.some((node) => node.id === key))], [true, []], `${mode}：目标 node id 只作属性入库，不作任何主键`)
  }
})
