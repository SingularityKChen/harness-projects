import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { parse as parseYaml } from 'yaml'

import * as engineering from '../../scripts/sync-engineering-state.mjs'
import * as signal from '../../scripts/engineering-state-signal.mjs'

test('状态只能经唯一构造器产生，且不能写入规划状态', () => {
  for (const value of engineering.STATES) {
    assert.deepEqual(engineering.setEngineeringState(value), { kind: 'set', value })
  }
  assert.throws(() => engineering.setEngineeringState('In Review'), /非法 Engineering 状态/)
})

test('当前 PR snapshot 决定状态，事件 payload 不参与判定', () => {
  const cases = [
    [{ state: 'MERGED', merged: true, isDraft: false, reviewDecision: null }, { kind: 'set', value: 'Merged' }],
    [{ state: 'MERGED', merged: true, isDraft: false, reviewDecision: 'APPROVED' }, { kind: 'set', value: 'Merged' }],
    [{ state: 'CLOSED', merged: false, isDraft: false, reviewDecision: 'APPROVED' }, { kind: 'clear' }],
    [{ state: 'OPEN', merged: false, isDraft: true, reviewDecision: 'APPROVED' }, { kind: 'clear' }],
    [{ state: 'OPEN', merged: false, isDraft: false, reviewDecision: 'CHANGES_REQUESTED' }, { kind: 'set', value: 'Changes requested' }],
    [{ state: 'OPEN', merged: false, isDraft: false, reviewDecision: 'APPROVED' }, { kind: 'set', value: 'Approved' }],
    [{ state: 'OPEN', merged: false, isDraft: false, reviewDecision: 'REVIEW_REQUIRED' }, { kind: 'set', value: 'PR open' }],
    [{ state: 'OPEN', merged: false, isDraft: false, reviewDecision: null }, { kind: 'set', value: 'PR open' }],
  ]

  for (const [snapshot, expected] of cases) {
    assert.deepEqual(engineering.stateForSnapshot(snapshot), expected)
  }
})

test('接受的 PR state 集合精确等于 GitHub GraphQL PullRequestState 枚举', () => {
  // 这条不是机械可推导的（离线拿不到 schema），所以它是一条**钉死**：把接受集合
  // 改成别的字面量，必须有人解释为什么。
  //
  // 它针对的正是 2026-09-22 的故障：当时接受集合是 ['OPEN','CLOSED']——REST 的
  // 形态——而 GraphQL 对已合并 PR 返回 'MERGED'。于是产出 `Merged` 的分支不可达，
  // 合并事件上的 reconcile 每次都失败，而其余用例全绿（issue #110）。
  assert.deepEqual([...engineering.PR_STATES], ['OPEN', 'CLOSED', 'MERGED'])
})

test('接受的每个 PR state 都有决策，不存在"接受但未处理"的取值', () => {
  // 键集合与 PR_STATES 精确相等，且每个取值都能走出一条决策路径。
  //
  // 这条单独防不住上面的故障（当时两个取值恰好都有决策），所以它与"枚举域钉死"
  // 必须成对存在：枚举域那条防"漏接受"，这条防"漏处理"。
  const representatives = {
    OPEN: { state: 'OPEN', merged: false, isDraft: false, reviewDecision: null },
    CLOSED: { state: 'CLOSED', merged: false, isDraft: false, reviewDecision: null },
    MERGED: { state: 'MERGED', merged: true, isDraft: false, reviewDecision: null },
  }
  assert.deepEqual([...engineering.PR_STATES].sort(), Object.keys(representatives).sort())

  for (const state of engineering.PR_STATES) {
    const decision = engineering.stateForSnapshot(representatives[state])
    assert.ok(
      decision.kind === 'set' || decision.kind === 'clear',
      `state ${state} 必须走出一条决策路径，实际为 ${JSON.stringify(decision)}`,
    )
  }
})

test('state 与 merged 矛盾时响亮失败，不挑一个信', () => {
  // 两者矛盾说明枚举语义漂移。旧代码在 'CLOSED' + merged:true 上按 REST 语义
  // "蒙对"成 Merged——正是这条暗路让故障藏了两天。
  assert.throws(
    () => engineering.stateForSnapshot({ state: 'CLOSED', merged: true, isDraft: false, reviewDecision: null }),
    /GraphQL 枚举语义漂移/,
  )
  assert.throws(
    () => engineering.stateForSnapshot({ state: 'MERGED', merged: false, isDraft: false, reviewDecision: null }),
    /MERGED 但 merged 不是 true/,
  )
})

test('未知 snapshot 枚举 fail closed', () => {
  assert.throws(
    () => engineering.stateForSnapshot({ state: 'OPEN', merged: false, isDraft: false, reviewDecision: 'PENDING' }),
    /未知 reviewDecision/,
  )
  assert.throws(
    () => engineering.stateForSnapshot({ state: 'DRAFT', merged: false, isDraft: false, reviewDecision: null }),
    /未知 PR state/,
  )
})

test('GITHUB_REPOSITORY 分层解析 owner/repo，畸形输入 fail closed', () => {
  assert.deepEqual(engineering.parseRepository('SingularityKChen/harness-projects'), {
    owner: 'SingularityKChen',
    repo: 'harness-projects',
  })
  for (const value of ['', 'owner', '/repo', 'owner/', 'owner/repo/extra']) {
    assert.throws(() => engineering.parseRepository(value), /GITHUB_REPOSITORY/)
  }
})

test('投影权威不再导出 CLI main 或触发 PR 读取：唯一 writer 在 reconcile-engineering-project.mjs', () => {
  assert.deepEqual(['main', 'loadTriggerPullRequest'].filter((name) => name in engineering), [])
})

test('字段名与所有受控 Engineering 值保持固定', () => {
  assert.equal(engineering.FIELD_NAME, 'Engineering')
  assert.deepEqual(engineering.STATES, ['PR open', 'Changes requested', 'Approved', 'Merged'])
})

const response = ({ ok = true, status = 200, json }) => ({ ok, status, json })

test('GraphQL transport 对网络、HTTP、JSON、errors 与缺失 data 全部 fail closed', async () => {
  const query = 'query { viewer { login } }'
  const failures = [
    [async () => { throw new Error('offline') }, /GraphQL 网络请求失败.*offline/],
    [async () => response({ ok: false, status: 503, json: async () => ({ message: 'down' }) }), /GraphQL HTTP 503/],
    [async () => response({ json: async () => { throw new Error('bad json') } }), /GraphQL 响应不是合法 JSON/],
    [async () => response({ json: async () => ({ errors: [{ message: 'denied' }] }) }), /GraphQL errors.*denied/],
    [async () => response({ json: async () => ({ data: null }) }), /GraphQL 响应缺少 data/],
  ]

  for (const [fetchImpl, pattern] of failures) {
    const gql = engineering.createGraphQLClient({ token: 'not-a-real-token', fetchImpl })
    await assert.rejects(gql(query, {}), pattern)
  }

  const gql = engineering.createGraphQLClient({
    token: 'not-a-real-token',
    fetchImpl: async () => response({ json: async () => ({ data: { viewer: { login: 'octo' } } }) }),
  })
  assert.deepEqual(await gql(query, {}), { viewer: { login: 'octo' } })
})

const validProjectData = () => ({
  user: { projectV2: { id: 'PVT_project' } },
  node: {
    id: 'PVTF_engineering',
    name: 'Engineering',
    dataType: 'SINGLE_SELECT',
    project: { id: 'PVT_project' },
    options: engineering.STATES.map((name, index) => ({ id: `option-${index}`, name })),
  },
})

test('Engineering 字段按稳定 ID 查询并核对所属 project、名称、类型和选项', async () => {
  const seen = []
  const resolved = await engineering.resolveProjectField({
    gql: async (query, variables) => {
      seen.push({ query, variables })
      return validProjectData()
    },
    engineeringFieldId: 'PVTF_engineering',
  })

  assert.equal(seen[0].variables.fieldId, 'PVTF_engineering')
  assert.deepEqual([seen[0].variables.owner, seen[0].variables.number], ['SingularityKChen', 10])
  await engineering.resolveProjectField({
    gql: async (query, variables) => { seen.push({ query, variables }); return validProjectData() },
    engineeringFieldId: 'PVTF_engineering', owner: 'octo', projectNumber: 7,
  })
  assert.deepEqual([seen[1].variables.owner, seen[1].variables.number], ['octo', 7])
  assert.match(seen[0].query, /node\(id:\$fieldId\)/)
  assert.deepEqual(resolved, {
    projectId: 'PVT_project',
    fieldId: 'PVTF_engineering',
    options: validProjectData().node.options,
  })
})

test('Engineering 字段契约任一不匹配都拒绝写入', async () => {
  const corruptions = [
    [(data) => { data.user.projectV2 = null }, /找不到 project/],
    [(data) => { data.node = null }, /找不到 Engineering 字段 ID/],
    [(data) => { data.node.project.id = 'other' }, /不属于目标 project/],
    [(data) => { data.node.name = 'Status' }, /字段名.*Engineering/],
    [(data) => { data.node.dataType = 'TEXT' }, /SINGLE_SELECT/],
    [(data) => { data.node.options.pop() }, /选项集合/],
  ]

  for (const [corrupt, pattern] of corruptions) {
    const data = validProjectData()
    corrupt(data)
    await assert.rejects(
      engineering.resolveProjectField({ gql: async () => data, engineeringFieldId: 'PVTF_engineering' }),
      pattern,
    )
  }
})

test('mutation 携带 clientMutationId，且只接受匹配 target item 的 ack', async () => {
  const options = validProjectData().node.options
  const seen = []
  const gql = async (query, variables) => {
    seen.push({ query, variables })
    return {
      updateProjectV2ItemFieldValue: {
        clientMutationId: variables.clientMutationId,
        projectV2Item: { id: variables.itemId },
      },
    }
  }

  await engineering.writeEngineeringState({
    gql, projectId: 'p', fieldId: 'f', options, itemId: 'item-1',
    decision: engineering.setEngineeringState('Approved'), clientMutationId: 'run-1:item-1',
  })
  assert.match(seen[0].query, /clientMutationId/)
  assert.equal(seen[0].variables.clientMutationId, 'run-1:item-1')

  await assert.rejects(
    engineering.writeEngineeringState({
      gql, projectId: 'p', fieldId: 'f', options, itemId: 'item-1',
      decision: { kind: 'set', value: 'Approved' }, clientMutationId: 'forged:item-1',
    }),
    /未经构造器验证/,
  )

  await assert.rejects(
    engineering.writeEngineeringState({
      gql: async (_query, variables) => ({ updateProjectV2ItemFieldValue: {
        clientMutationId: 'forged-ack',
        projectV2Item: { id: variables.itemId },
      } }),
      projectId: 'p', fieldId: 'f', options, itemId: 'item-1',
      decision: engineering.setEngineeringState('Approved'), clientMutationId: 'run-3:item-1',
    }),
    /mutation ack clientMutationId 不匹配/,
  )

  await assert.rejects(
    engineering.writeEngineeringState({
      gql: async (_query, variables) => ({ updateProjectV2ItemFieldValue: {
        clientMutationId: variables.clientMutationId,
        projectV2Item: { id: 'wrong-item' },
      } }),
      projectId: 'p', fieldId: 'f', options, itemId: 'item-1',
      decision: engineering.setEngineeringState('Approved'), clientMutationId: 'run-2:item-1',
    }),
    /mutation ack item 不匹配/,
  )
})

const REF_A_MERGED = {
  id: 'PR_150', number: 150, repository: { nameWithOwner: 'o/r' }, state: 'MERGED', merged: true, isDraft: false, reviewDecision: null, createdAt: '2026-09-22T00:00:00Z',
}
const REF_B_OPEN = {
  id: 'PR_200', number: 200, repository: { nameWithOwner: 'o/r' }, state: 'OPEN', merged: false, isDraft: false, reviewDecision: null, createdAt: '2026-09-23T00:00:00Z',
}

// ── 共享选择策略：语义与 fail closed（写入口与观察者共用一份）────────────────

test('expectedFor 的三条规则与编号兜底', () => {
  assert.deepEqual(
    engineering.expectedFor({ references: [REF_B_OPEN, REF_A_MERGED] }),
    { value: 'Merged', prNumber: 150, rule: 'merged' },
  )
  assert.deepEqual(
    engineering.expectedFor({ references: [REF_B_OPEN] }),
    { value: 'PR open', prNumber: 200, rule: 'open' },
  )
  const closed = {
    id: 'PR_10', number: 10, state: 'CLOSED', merged: false, isDraft: false, reviewDecision: null, createdAt: '2026-09-20T00:00:00Z',
  }
  assert.deepEqual(engineering.expectedFor({ references: [closed] }), { value: null, prNumber: 10, rule: 'closed' })

  // createdAt 相同时按编号降序兜底：排序确定，不依赖输入顺序。
  const lower = { ...REF_B_OPEN, id: 'PR_11', number: 11, createdAt: '2026-09-23T00:00:00Z' }
  const higher = { ...REF_B_OPEN, id: 'PR_12', number: 12, createdAt: '2026-09-23T00:00:00Z', reviewDecision: 'APPROVED' }
  assert.deepEqual(engineering.expectedFor({ references: [lower, higher] }), { value: 'Approved', prNumber: 12, rule: 'open' })
  assert.deepEqual(engineering.expectedFor({ references: [higher, lower] }), { value: 'Approved', prNumber: 12, rule: 'open' })
})

test('expectedFor 只在完整零引用证据下清空；缺证据或畸形输入仍是错误', () => {
  assert.deepEqual(engineering.expectedFor({ references: [], complete: true }), { value: null, prNumber: null, rule: 'unreferenced' })
  for (const references of [[], null, undefined, 'x']) {
    for (const complete of [false, undefined, 'yes']) {
      assert.throws(() => engineering.expectedFor({ references, complete }), /至少一个引用 PR/)
    }
  }
  for (const references of [null, undefined, {}]) {
    assert.throws(() => engineering.expectedFor({ references, complete: true }), /至少一个引用 PR/)
  }
})

test('跨仓同号同时间的引用与输入顺序无关，按全局 PR id 码元升序兜底；同 Issue 重复或缺 id 被拒', () => {
  // 'PR_B' < 'PR_a' 按 UTF-16 码元成立，而 localeCompare 会反过来：判别「码元」与「区域排序」。
  const same = { number: 7, state: 'OPEN', merged: false, isDraft: false, createdAt: '2026-09-23T00:00:00Z' }
  const lower = { ...same, id: 'PR_a', reviewDecision: 'APPROVED' }
  const upper = { ...same, id: 'PR_B', reviewDecision: 'CHANGES_REQUESTED' }
  const expected = { value: 'Changes requested', prNumber: 7, rule: 'open' }
  assert.deepEqual(engineering.expectedFor({ references: [lower, upper] }), expected)
  assert.deepEqual(engineering.expectedFor({ references: [upper, lower] }), expected)
  assert.throws(() => engineering.expectedFor({ references: [lower, { ...lower }] }), /重复的 PR id/)
  assert.throws(() => engineering.expectedFor({ references: [{ ...lower, id: '' }] }), /缺少稳定的全局 id/)
})

test('expectedFor 校验每一个引用：未被选中的未知枚举同样响亮失败', () => {
  // 只校验被选中的那一个时，一个带未知 state 的引用会掉进 closed 桶被当成
  // 「未合并」——那是一扇假绿的门。
  assert.throws(
    () => engineering.expectedFor({ references: [REF_A_MERGED, { ...REF_B_OPEN, number: 201, state: 'DRAFT' }] }),
    /PR #201 的快照无法投影：未知 PR state/,
  )
  assert.throws(
    () => engineering.expectedFor({ references: [REF_A_MERGED, { ...REF_B_OPEN, number: 202, reviewDecision: 'PENDING' }] }),
    /PR #202 的快照无法投影：未知 reviewDecision/,
  )
  assert.throws(
    () => engineering.expectedFor({ references: [{ ...REF_B_OPEN, createdAt: 'not-a-date' }] }),
    /PR #200 缺少可解析的 createdAt/,
  )
  assert.throws(
    () => engineering.expectedFor({ references: [{ ...REF_B_OPEN, number: 0 }] }),
    /缺少正整数编号/,
  )
})

// ── 关闭引用读取：分页、查询形状与 fail closed ──────────────────────────────

const issueConnection = (nodes, overrides = {}) => ({
  totalCount: nodes.length,
  pageInfo: { hasNextPage: false, endCursor: 'CURSOR-1' },
  nodes,
  ...overrides,
})

test('关闭引用逐页读完，查询显式要求 includeClosedPrs 且不读正文', async () => {
  const seen = []
  const pages = [
    issueConnection([REF_A_MERGED], { totalCount: 2, pageInfo: { hasNextPage: true, endCursor: 'CURSOR-1' } }),
    issueConnection([REF_B_OPEN], { totalCount: 2 }),
  ]
  const references = await engineering.loadClosingPullRequests({
    gql: async (query, variables) => {
      seen.push({ query, variables })
      return { repository: { issue: { closedByPullRequestsReferences: pages[seen.length - 1] } } }
    },
    owner: 'o', repo: 'r', issueNumber: 34,
  })

  assert.deepEqual(seen.map((call) => call.variables.cursor), [null, 'CURSOR-1'])
  assert.deepEqual(references.map((reference) => reference.number), [150, 200])
  assert.equal(references[0].createdAt, REF_A_MERGED.createdAt)

  // `includeClosedPrs` 的 schema 默认值是 false、字段自述是「open pull requests」，
  // 而 2026-09-24 实测它不带该参数时也返回了已合并 PR。不依赖默认值：参数必须出现
  // 在查询里，否则平台侧一旦按描述收敛，已合并 PR 会被静默漏掉——正是本 issue 的形状。
  assert.match(seen[0].query, /includeClosedPrs:true/)
  // 关闭引用是**登记事实**，不是正文的函数（merge-queue.md §7 实测）：写入口不得
  // 从正文重新推导引用，因此查询里不请求 body。
  assert.doesNotMatch(seen[0].query, /\bbody\b/)
})

test('关闭引用读取的任何不完整都 fail closed', async (t) => {
  const cases = [
    ['repository 为 null', { repository: null }, /找不到 repository/],
    ['issue 为 null', { repository: { issue: null } }, /找不到 issue/],
    ['字段为 null', { repository: { issue: { closedByPullRequestsReferences: null } } }, /缺少 closedByPullRequestsReferences/],
    ['字段是数组', { repository: { issue: { closedByPullRequestsReferences: [] } } }, /缺少 closedByPullRequestsReferences/],
    ['nodes 不是数组', { repository: { issue: { closedByPullRequestsReferences: { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: 'x' } } } }, /nodes 必须是数组/],
    ['totalCount 不是非负整数', { repository: { issue: { closedByPullRequestsReferences: issueConnection([REF_B_OPEN], { totalCount: -1 }) } } }, /totalCount 必须是非负整数/],
    ['截断', { repository: { issue: { closedByPullRequestsReferences: issueConnection([REF_B_OPEN], { totalCount: 5 }) } } }, /关闭引用不完整/],
    ['pageInfo 为 null', { repository: { issue: { closedByPullRequestsReferences: issueConnection([REF_B_OPEN], { pageInfo: null }) } } }, /pageInfo 必须是对象/],
    ['hasNextPage 不是布尔值', { repository: { issue: { closedByPullRequestsReferences: issueConnection([REF_B_OPEN], { pageInfo: { hasNextPage: 'false', endCursor: null } }) } } }, /hasNextPage 必须是布尔值/],
    ['hasNextPage 但 endCursor 为空', { repository: { issue: { closedByPullRequestsReferences: issueConnection([REF_B_OPEN], { totalCount: 2, pageInfo: { hasNextPage: true, endCursor: '' } }) } } }, /endCursor 必须是非空字符串/],
    ['引用缺全局 id', { repository: { issue: { closedByPullRequestsReferences: issueConnection([{ ...REF_B_OPEN, id: '' }]) } } }, /缺少稳定的全局 id/],
    ['引用缺 repository', { repository: { issue: { closedByPullRequestsReferences: issueConnection([{ ...REF_B_OPEN, repository: null }]) } } }, /缺少 repository/],
    ['引用缺编号', { repository: { issue: { closedByPullRequestsReferences: issueConnection([{ ...REF_B_OPEN, number: 0 }]) } } }, /缺少正整数编号/],
    ['引用缺 createdAt', { repository: { issue: { closedByPullRequestsReferences: issueConnection([{ ...REF_B_OPEN, createdAt: 'x' }]) } } }, /缺少可解析的 createdAt/],
    ['引用缺 reviewDecision 键（缺失不得补成 null）', { repository: { issue: { closedByPullRequestsReferences: issueConnection([{ ...REF_B_OPEN, reviewDecision: undefined }]) } } }, /reviewDecision 必须是字符串或 null/],
    ['reviewDecision 不是字符串', { repository: { issue: { closedByPullRequestsReferences: issueConnection([{ ...REF_B_OPEN, reviewDecision: 7 }]) } } }, /reviewDecision 必须是字符串或 null/],
  ]

  for (const [name, data, pattern] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        engineering.loadClosingPullRequests({ gql: async () => data, owner: 'o', repo: 'r', issueNumber: 34 }),
        pattern,
      )
    })
  }
})

test('多页读取中的矛盾快照 fail closed：totalCount 变化、cursor 重复、节点重复', async () => {
  const page = (node, overrides) => issueConnection([node], { totalCount: 2, pageInfo: { hasNextPage: true, endCursor: 'C1' }, ...overrides })
  const last = { pageInfo: { hasNextPage: false, endCursor: null } }
  for (const [pages, pattern] of [
    [[page(REF_A_MERGED), page(REF_B_OPEN, { ...last, totalCount: 3 })], /SourceChanged/],
    [[page(REF_A_MERGED), page(REF_B_OPEN)], /endCursor.*重复/],
    [[page(REF_A_MERGED), page(REF_A_MERGED, last)], /重复的 PR id/],
  ]) {
    let at = 0
    await assert.rejects(engineering.loadClosingPullRequests({
      gql: async () => ({ repository: { issue: { closedByPullRequestsReferences: pages[at++] } } }), owner: 'o', repo: 'r', issueNumber: 34,
    }), pattern)
  }
})

test('关闭引用分页超过上限时 fail closed，不按截断输入写入', async () => {
  let calls = 0
  await assert.rejects(
    engineering.loadClosingPullRequests({
      gql: async () => {
        calls += 1
        return { repository: { issue: { closedByPullRequestsReferences: issueConnection([{ ...REF_B_OPEN, id: `PR_${calls}` }], {
          totalCount: 999, pageInfo: { hasNextPage: true, endCursor: `next-${calls}` },
        }) } } }
      },
      owner: 'o', repo: 'r', issueNumber: 34,
    }),
    /超过 5 页/,
  )
  assert.equal(calls, engineering.MAX_PAGES)
})

test('signal job 判定表对 skipped/success 放行，其它输入 fail closed', () => {
  assert.deepEqual(signal.classifySignalRun({ jobs: [{ name: 'signal', conclusion: 'skipped' }] }), {
    decision: 'noop', reason: 'signal job 被准入控制跳过，无需 reconcile',
  })
  assert.deepEqual(signal.classifySignalRun({ jobs: [{ name: 'signal', conclusion: 'success' }] }), {
    decision: 'reconcile', reason: 'signal job 成功完成，执行 reconcile',
  })
  for (const jobs of [[], [{ name: 'signal', conclusion: 'failure' }], [{ name: 'other', conclusion: 'success' }]]) {
    assert.throws(() => signal.classifySignalRun({ jobs }), /jobs 为空|无法接受|找不到唯一/)
  }
})

test('触发 run 必须恰好关联一个正整数 PR', () => {
  assert.equal(signal.selectAssociatedPullRequest({ pullRequests: [{ number: 37 }] }), 37)
  for (const pullRequests of [[], [{ number: 1 }, { number: 2 }], [{ number: 0 }], [{ number: -1 }], [{ number: '37' }]]) {
    assert.throws(() => signal.selectAssociatedPullRequest({ pullRequests }), /恰好关联一个|正整数/)
  }
})

test('signal CLI 对 HTTP、JSON、字段缺失全部 fail closed 且不写 output', async () => {
  for (const fetchImpl of [
    async () => response({ ok: false, status: 503, json: async () => ({}) }),
    async () => response({ json: async () => { throw new Error('bad json') } }),
    async () => response({ json: async () => ({}) }),
  ]) {
    const output = []
    await assert.rejects(signal.main({
      env: {
        GITHUB_REPOSITORY: 'owner/repo', RUN_ID: '123', GITHUB_TOKEN: 'token', GITHUB_OUTPUT: '/tmp/output',
        PULL_REQUESTS_JSON: '[]',
      },
      fetchImpl,
      writeOutput: (line) => output.push(line),
    }))
    assert.deepEqual(output, [])
  }
})

test('特权 reconcile 只由默认分支 workflow 运行，并显式 checkout 默认分支', () => {
  const path = fileURLToPath(new URL('../../.github/workflows/engineering-state.yml', import.meta.url))
  const source = readFileSync(path, 'utf8')
  const workflow = parseYaml(source)

  // 不加 workflow_dispatch、Project 变更监听或 PR/review 直接触发：写回 Engineering 不形成自触发回路。
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request_target', 'schedule', 'workflow_run'])
  assert.ok(workflow.on.pull_request_target.types.includes('edited'))
  assert.deepEqual(workflow.on.workflow_run.workflows, ['Engineering state signal'])
  // 并发组在 job 级：被 job `if` 拒绝的运行（fork 的 pull_request_target / workflow_run）不入组，
  // 不能挤掉排队中的已准入运行或 schedule。workflow 级 group 在 `if` 求值之前就排队。
  assert.equal(workflow.concurrency, undefined, '并发组不得放在 workflow 级')
  assert.deepEqual(workflow.jobs.sync.concurrency, { group: 'engineering-state-reconcile', 'cancel-in-progress': false })
  assert.equal(workflow.jobs.sync['timeout-minutes'], 10)
  // 求值 job `if`（GitHub 表达式在这里与 JS 同形）：schedule 与同仓可信事件放行，fork/untrusted/非 review/失败的 signal 不放行。
  const admitted = (github) => new Function('github', `return (${workflow.jobs.sync.if})`)({ repository: 'o/r', ...github })
  const review = (over) => ({ event_name: 'workflow_run', event: { workflow_run: {
    event: 'pull_request_review', conclusion: 'success', head_repository: { full_name: 'o/r' }, ...over,
  } } })
  const target = (head) => ({ event_name: 'pull_request_target', event: { pull_request: { head: { repo: { full_name: head } } } } })
  assert.deepEqual(
    [{ event_name: 'schedule' }, target('o/r'), review({})].map(admitted),
    [true, true, true],
  )
  assert.deepEqual(
    [target('fork/r'), review({ head_repository: { full_name: 'fork/r' } }), review({ event: 'push' }), review({ conclusion: 'failure' }),
      { event_name: 'workflow_dispatch' }].map(admitted),
    [false, false, false, false, false],
  )

  const checkout = workflow.jobs.sync.steps.find((step) => step.uses?.startsWith('actions/checkout@'))
  const setupNode = workflow.jobs.sync.steps.find((step) => step.uses?.startsWith('actions/setup-node@'))
  assert.equal(checkout.uses, 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1')
  assert.equal(setupNode.uses, 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020')
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' })
  assert.equal(workflow.jobs.sync.steps.find((step) => step.uses?.startsWith('actions/download-artifact@')), undefined)
  assert.equal(checkout.with.ref, '${{ github.event.repository.default_branch }}')
  assert.equal(checkout.with['persist-credentials'], false)
  assert.match(source, /ENGINEERING_FIELD_ID: \$\{\{ vars\.PROJECTS_ENGINEERING_FIELD_ID \}\}/)
  assert.doesNotMatch(source, /REVIEW_STATE|PR_MERGED|sync-engineering-state\.mjs|\bPR_NUMBER\b|outputs\.number/)
  // PROJECTS_TOKEN 只进入唯一 writer step 的 env（workflow/job 级 env 或别的 step 再引用 secret 就会让计数大于 1）；该 step 不接受 PR 号。
  const writer = workflow.jobs.sync.steps.filter((step) => JSON.stringify(step).includes('PROJECTS_TOKEN'))
  assert.deepEqual(writer.map((step) => step.run), ['node scripts/reconcile-engineering-project.mjs'])
  assert.equal(source.match(/secrets\.PROJECTS_TOKEN/g).length, 1)
})

test('review signal workflow 无权限、无 secret、无 checkout，且不上传 artifact', () => {
  const path = fileURLToPath(new URL('../../.github/workflows/engineering-state-signal.yml', import.meta.url))
  const source = readFileSync(path, 'utf8')
  const workflow = parseYaml(source)

  assert.deepEqual(workflow.on.pull_request_review.types, ['submitted', 'dismissed'])
  assert.deepEqual(workflow.permissions, {})
  assert.deepEqual(workflow.jobs.signal.permissions, {})
  assert.equal(workflow.jobs.signal['timeout-minutes'], 1)
  assert.doesNotMatch(source, /secrets\.|PROJECTS_TOKEN|actions\/checkout/)
  assert.equal(workflow.jobs.signal.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@')), undefined)
  assert.match(source, /Print accepted signal/)
})
