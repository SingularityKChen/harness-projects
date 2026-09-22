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

test('repository 或 pullRequest 为 null 时 fail closed，不折叠为空列表', async () => {
  const base = { repository: { pullRequest: null } }
  await assert.rejects(
    engineering.loadPullRequestSnapshot({ gql: async () => ({ repository: null }), owner: 'o', repo: 'r', prNumber: 1, projectId: 'p' }),
    /找不到 repository/,
  )
  await assert.rejects(
    engineering.loadPullRequestSnapshot({ gql: async () => base, owner: 'o', repo: 'r', prNumber: 1, projectId: 'p' }),
    /找不到 pull request/,
  )
})

test('PR snapshot 同时提供权威评审结论与目标 project items', async () => {
  const loaded = await engineering.loadPullRequestSnapshot({
    gql: async () => ({
      repository: { pullRequest: {
        state: 'OPEN', merged: false, isDraft: false, reviewDecision: 'APPROVED',
        closingIssuesReferences: { totalCount: 1, nodes: [
          { number: 34, projectItems: { totalCount: 2, nodes: [
            { id: 'item-target', project: { id: 'project-target' } },
            { id: 'item-other', project: { id: 'project-other' } },
          ] } },
        ] },
      } },
    }),
    owner: 'o', repo: 'r', prNumber: 37, projectId: 'project-target',
  })

  assert.deepEqual(loaded, {
    snapshot: { state: 'OPEN', merged: false, isDraft: false, reviewDecision: 'APPROVED' },
    items: [{ issue: 34, itemId: 'item-target' }],
  })
})

test('PR snapshot 对 closing issues 与 project items 的截断 fail closed', async () => {
  const base = {
    repository: { pullRequest: {
      state: 'OPEN', merged: false, isDraft: false, reviewDecision: null,
      closingIssuesReferences: { totalCount: 2, nodes: [
        { number: 34, projectItems: { totalCount: 1, nodes: [
          { id: 'item-1', project: { id: 'project-target' } },
        ] } },
      ] },
    } },
  }
  await assert.rejects(
    engineering.loadPullRequestSnapshot({ gql: async () => base, owner: 'o', repo: 'r', prNumber: 37, projectId: 'project-target' }),
    /closingIssuesReferences snapshot 不完整/,
  )

  base.repository.pullRequest.closingIssuesReferences.totalCount = 1
  base.repository.pullRequest.closingIssuesReferences.nodes[0].projectItems.totalCount = 2
  await assert.rejects(
    engineering.loadPullRequestSnapshot({ gql: async () => base, owner: 'o', repo: 'r', prNumber: 37, projectId: 'project-target' }),
    /projectItems snapshot 不完整/,
  )
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
        clientMutationId: variables.clientMutationId,
        projectV2Item: { id: 'wrong-item' },
      } }),
      projectId: 'p', fieldId: 'f', options, itemId: 'item-1',
      decision: engineering.setEngineeringState('Approved'), clientMutationId: 'run-2:item-1',
    }),
    /mutation ack item 不匹配/,
  )
})

test('ack 未匹配前 main 不得打印 confirmed 成功日志', async () => {
  const logs = []
  const fetchImpl = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body)
    let data
    if (query.includes('node(id:$fieldId)')) data = validProjectData()
    else if (query.includes('pullRequest(number:$pr)')) data = {
      repository: { pullRequest: {
        state: 'OPEN', merged: false, isDraft: false, reviewDecision: 'APPROVED',
        closingIssuesReferences: { totalCount: 1, nodes: [
          { number: 34, projectItems: { totalCount: 1, nodes: [{ id: 'item-1', project: { id: 'PVT_project' } }] } },
        ] },
      } },
    }
    else data = { updateProjectV2ItemFieldValue: {
      clientMutationId: variables.clientMutationId,
      projectV2Item: { id: 'wrong-item' },
    } }
    return response({ json: async () => ({ data }) })
  }

  await assert.rejects(
    engineering.main({
      env: {
        PROJECTS_TOKEN: 'not-a-real-token',
        ENGINEERING_FIELD_ID: 'PVTF_engineering',
        GITHUB_REPOSITORY: 'SingularityKChen/harness-projects',
        RECONCILE_ID: 'run-1',
      },
      argv: ['node', 'script', '37'], fetchImpl, log: (line) => logs.push(line),
    }),
    /mutation ack item 不匹配/,
  )
  assert.equal(logs.some((line) => line.includes('confirmed')), false)
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

  assert.ok(workflow.on.pull_request_target)
  assert.ok(workflow.on.workflow_run)
  assert.equal(workflow.on.pull_request, undefined)
  assert.equal(workflow.on.pull_request_review, undefined)
  assert.deepEqual(workflow.on.workflow_run.workflows, ['Engineering state signal'])
  assert.equal(workflow.concurrency['cancel-in-progress'], false)

  const checkout = workflow.jobs.sync.steps.find((step) => step.uses?.startsWith('actions/checkout@'))
  const setupNode = workflow.jobs.sync.steps.find((step) => step.uses?.startsWith('actions/setup-node@'))
  assert.equal(checkout.uses, 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1')
  assert.equal(setupNode.uses, 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020')
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' })
  assert.equal(workflow.jobs.sync.steps.find((step) => step.uses?.startsWith('actions/download-artifact@')), undefined)
  assert.equal(checkout.with.ref, '${{ github.event.repository.default_branch }}')
  assert.equal(checkout.with['persist-credentials'], false)
  assert.match(source, /ENGINEERING_FIELD_ID: \$\{\{ vars\.PROJECTS_ENGINEERING_FIELD_ID \}\}/)
  assert.doesNotMatch(source, /REVIEW_STATE|PR_MERGED/)
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
