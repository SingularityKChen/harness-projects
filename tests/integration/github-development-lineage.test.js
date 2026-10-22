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
import { composeCore, createWorkspaceSetup } from '@harness-projects/core'
import { createFakeProviders, createFakeStorage, exportFakeStorageState } from '@harness-projects/provider-fake'
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
    const policy = { allowedSecretHandles: new Set(), configurations: new Map([['development.github', {}]]) }
    const storage = createFakeStorage(undefined, policy)
    const providers = { ...createFakeProviders(), storage }
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
    // 通过公共命令把同一仓库实体补上 GitHub alias，保留 Start Work 的 Fake 锚点。
    const bound = await createWorkspaceSetup(storage).bindRepository({ workspaceId: workspace.id, repositoryId: REPOSITORY,
      references: [{ domain: 'development', implementationKey: 'development.github', configuration: {} }] })
    assert.equal(bound.ok, true, '前置：公共仓库绑定为 GitHub 建合法 alias')
    const development = createGithubDevelopmentProvider({
      bindingId: bound.value.bindingIds[0], repository: { externalId: REPOSITORY, owner: 'sandbox-owner', name: 'sandbox' }, transport: async (request) => platform(request),
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

// #233 只扩展现有测试正文；首个 guard import 由独立任务维护。
import { fakeChain, offline, page } from '../fixtures/lineage-refresh.mjs'

for (const [method, key, kind] of [
  ['listBranches', 'development.repository.read', 'commit'],
  ['listChangeRequests', 'development.change_request.read', 'change_request'],
]) {
  test(`${method}：第 51 项与第 100 个端口页找到即停止，保留精确分支和当前 head`, async () => {
    for (const last of [2, 100]) {
      const w = await fakeChain()
      const target = method === 'listBranches' ? w.branch : w.target
      const decoy = method === 'listBranches' ? { ...target, name: 'feature/other' } : { ...target, sourceVersion: 'old-head' }
      const calls = []
      w.providers.development[method] = async (input) => {
        calls.push(input)
        assert.equal(input.limit, 50)
        if (method === 'listChangeRequests') assert.equal(input.headBranch, w.started.branchExternalId)
        const index = input.cursor === undefined ? 1 : Number(input.cursor)
        return page(index === last ? [target] : Array(50).fill(decoy), String(index + 1))
      }
      const result = await w.core.commands.refreshDeliveryFacts(w.scope)
      assert.deepEqual([result.ok, result.applied, result.gaps], [true, true, []])
      const set = (await w.snapshot()).sets.find((set) => set.kind === kind)
      assert.equal(set.nodes[0].externalId, method === 'listBranches' ? w.branch.headCommit : w.target.ref.externalId)
      assert.equal(calls.length, last, '命中后即使有下一页也不再读取')
    }
  })

  test(`${method}：空中间页仍续读，只有完整终页才确认目标不存在`, async () => {
    const w = await fakeChain()
    const target = method === 'listBranches' ? w.branch : w.target
    let calls = 0
    w.providers.development[method] = async ({ cursor }) => { calls++; return cursor === undefined ? page([], 'second') : page([target]) }
    assert.deepEqual((await w.core.commands.refreshDeliveryFacts(w.scope)).gaps, [])
    assert.equal(calls, 2)
    w.providers.development[method] = async () => page([])
    assert.deepEqual((await w.core.commands.refreshDeliveryFacts(w.scope)).gaps, [])
    const set = (await w.snapshot()).sets.find((set) => set.kind === kind)
    assert.deepEqual([set.nodes, set.stale], [[], false], '完整空必须清空旧快照')
  })

  test(`${method}：坏页、游标、成环、二页故障和预算耗尽保留最后确认集合`, async () => {
    for (const fault of ['null', 'items', 'row', 'empty-cursor', 'number-cursor', 'cycle', 'offline', 'throw', 'budget', ...(method === 'listBranches' ? ['no-head'] : [])]) {
      const w = await fakeChain()
      await w.core.commands.refreshDeliveryFacts(w.scope)
      const before = await w.snapshot()
      let calls = 0
      w.providers.development[method] = async ({ cursor }) => {
        calls++
        if (fault === 'no-head') return page([{ ...w.branch, headCommit: undefined }])
        if (fault === 'null') return { ok: true, value: null }
        if (fault === 'items') return { ok: true, value: { items: 'bad' } }
        if (fault === 'row') return page([null])
        if (fault === 'empty-cursor') return page([], '')
        if (fault === 'number-cursor') return page([], 7)
        if (fault === 'cycle') return page([], cursor === 'A' ? 'B' : 'A')
        if (fault === 'budget') return page([], String(calls))
        if (cursor === undefined) return page([], 'second')
        if (fault === 'throw') throw new Error('offline')
        return offline()
      }
      const result = await w.core.commands.refreshDeliveryFacts(w.scope)
      assert.equal(result.ok, true, fault)
      assert.ok(result.gaps.some((gap) => gap.key === key), fault)
      const after = await w.snapshot()
      for (const old of before.sets.filter((set) => method === 'listBranches' || ['change_request', 'check_run'].includes(set.kind))) {
        assert.deepEqual(after.sets.find((set) => set.kind === old.kind), { ...old, stale: true }, `${fault}/${old.kind}：节点、anchor、confirmedAt 不变`)
      }
      assert.ok(calls <= 100, fault)
      if (fault === 'budget') assert.equal(calls, 100)
      if (fault === 'cycle') assert.equal(calls, 3, '不得重复请求 A')
    }
  })
}
