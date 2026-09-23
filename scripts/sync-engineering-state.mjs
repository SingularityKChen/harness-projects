#!/usr/bin/env node
// 事件只负责唤醒 reconcile；GitHub 当前的 PR 真值才是 `Engineering` 的真值来源。
//
// 本文件是工程轴的**投影权威**：单快照投影 `stateForSnapshot` 与「同一 issue 被多个
// PR 引用时谁说了算」的选择策略 `expectedFor` 都住在这里。写入口（本文件的 `main`）
// 与漂移观察者（`engineering-drift.mjs`）共用这两者，因此两侧由构造一致（issue #115）。

import { pathToFileURL } from 'node:url'

export const OWNER = 'SingularityKChen'
export const PROJECT_NUMBER = 10
export const FIELD_NAME = 'Engineering'
export const STATES = Object.freeze(['PR open', 'Changes requested', 'Approved', 'Merged'])

/**
 * `stateForSnapshot` 接受的 PR state 集合——即 GitHub GraphQL `PullRequestState`
 * 枚举的**完整**取值。
 *
 * 这里曾经写成 `['OPEN', 'CLOSED']`，那是 **REST** 的形态（REST 的已合并 PR 返回
 * `state: "closed"` 配 `merged: true`）。GraphQL 不是这样：已合并的 PR 返回
 * `state: "MERGED"` 且 `merged: true`。于是 `MERGED` 被当成未知枚举抛错，产出
 * `Merged` 的那条分支永远不可达——2026-09-22 的实测：合并事件上的 reconcile 三次
 * 全部失败于 `未知 PR state：MERGED`，看板上没有任何条目由本自动化写进过 `Merged`
 * （见 issue #110）。
 *
 * 因此这个常量是"我们认识哪些 state"的唯一声明，由
 * `tests/contract/engineering-state.test.js` 钉死为字面量并穷举验证：改动它必须是
 * 一次有意识的决定，而不是一次静默的编辑。
 */
export const PR_STATES = Object.freeze(['OPEN', 'CLOSED', 'MERGED'])

const constructedSets = new WeakSet()

export function setEngineeringState(value) {
  if (!STATES.includes(value)) throw new Error(`非法 Engineering 状态：${String(value)}`)
  const decision = { kind: 'set', value }
  constructedSets.add(decision)
  return Object.freeze(decision)
}

const CLEAR = Object.freeze({ kind: 'clear' })

export function stateForSnapshot(snapshot) {
  if (!snapshot || !PR_STATES.includes(snapshot.state)) {
    throw new Error(`未知 PR state：${String(snapshot?.state)}`)
  }
  if (typeof snapshot.merged !== 'boolean' || typeof snapshot.isDraft !== 'boolean') {
    throw new Error('PR snapshot 缺少 merged/isDraft 布尔值')
  }
  if (![null, 'APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'].includes(snapshot.reviewDecision)) {
    throw new Error(`未知 reviewDecision：${String(snapshot.reviewDecision)}`)
  }

  // `state` 与 `merged` 必须互相印证。两者矛盾时不能挑一个信——那正是本次故障的
  // 形状：旧代码只认 REST 的 `CLOSED` + `merged: true`，于是在 GraphQL 的 `MERGED`
  // 上抛错，又在该组合上按 REST 语义"蒙对"。两种偏差都应当是响亮的错误。
  if (snapshot.state === 'MERGED') {
    if (snapshot.merged !== true) throw new Error('PR state 为 MERGED 但 merged 不是 true')
    return setEngineeringState('Merged')
  }
  if (snapshot.state === 'CLOSED') {
    if (snapshot.merged === true) {
      throw new Error('PR state 为 CLOSED 但 merged 为 true：GraphQL 枚举语义漂移，拒绝按 REST 语义猜测')
    }
    return CLEAR
  }
  if (snapshot.merged) throw new Error('OPEN PR 不得同时标记为 merged')
  if (snapshot.isDraft) return CLEAR
  if (snapshot.reviewDecision === 'CHANGES_REQUESTED') return setEngineeringState('Changes requested')
  if (snapshot.reviewDecision === 'APPROVED') return setEngineeringState('Approved')
  return setEngineeringState('PR open')
}

/**
 * 分页上限。超过就 fail closed，不把截断的输入当完整输入。
 *
 * 写入口（读一个 issue 的关闭引用）与观察者（读仓库的 PR 列表）共用这一对上限：
 * 「读到一半」这件事对两者都是不可接受的输入。
 */
export const MAX_PAGES = 5
export const PAGE_SIZE = 100

function newestFirst(entries) {
  return [...entries].sort((a, b) => {
    const left = Date.parse(a.reference.createdAt)
    const right = Date.parse(b.reference.createdAt)
    if (left !== right) return right - left
    // createdAt 相同时用编号兜底，保证排序是确定的而不是依赖输入顺序。
    return b.reference.number - a.reference.number
  })
}

function projectionFor(reference) {
  let decision
  try {
    decision = stateForSnapshot({
      state: reference.state,
      merged: reference.merged,
      isDraft: reference.isDraft,
      reviewDecision: reference.reviewDecision,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`PR #${reference.number} 的快照无法投影：${message}`)
  }
  return decision.kind === 'clear' ? null : decision.value
}

function assertReference(reference) {
  if (!reference || !Number.isInteger(reference.number) || reference.number <= 0) {
    throw new Error(`引用 PR 缺少正整数编号：${String(reference?.number)}`)
  }
  if (typeof reference.createdAt !== 'string' || Number.isNaN(Date.parse(reference.createdAt))) {
    throw new Error(`PR #${reference.number} 缺少可解析的 createdAt：${String(reference.createdAt)}`)
  }
}

/**
 * 选择策略——「同一 issue 被多个 PR 引用时谁说了算」的**唯一**实现。
 *
 * 写入口与漂移观察者都调用它，因此两侧对同一份输入由构造一致；它住在投影权威
 * 里而不是观察者里，因为**写入口才是「字段该是什么」的权威**（issue #115）。
 *
 * 规则按优先级：
 *
 * 1. **有任一 PR 已合并 → 取该 PR 的投影。** 已合并是**终态且单调**：一个 PR 合并
 *    之后不会再变回 open，所以这一条没有歧义。多个已合并 PR 时取创建时间最新的
 *    那个——取值必然都是 `Merged`，选谁只影响回显的 PR 编号。
 * 2. **否则有任一 PR 处于 open → 取创建时间最新的那个 open PR 的投影。** 多个 open
 *    PR 引用同一 issue 本身可疑，但「最新」是可机械判定且确定的。
 * 3. **否则（全部 closed 且未合并）→ 取创建时间最新的那个的投影**，也就是清空。
 *
 * 没有被任何 PR 引用的条目**不参与比较**：`Engineering` 为空是合法状态，不是漂移；
 * 但**空集合传进来是错误**，不是「清空」——调用方必须保证引用集合是完整的。
 *
 * 返回 `{ value, prNumber, rule }`，`value` 为 `null` 表示该 issue 应当清空。
 */
export function expectedFor({ references }) {
  if (!Array.isArray(references) || references.length === 0) {
    throw new Error('expectedFor 需要至少一个引用 PR；空集合不是「清空」')
  }

  // **每一个**引用都必须落在投影域内，而不只是被选中的那一个：否则一个带未知
  // state 的引用会掉进第 3 条被当成「closed 且未合并」，那是一扇假绿的门。
  // 全部校验之后，第 3 条的候选集合与 CLOSED 精确重合。
  const projected = references.map((reference) => {
    assertReference(reference)
    return { reference, value: projectionFor(reference) }
  })

  const pick = (rule, candidates) => {
    const chosen = newestFirst(candidates)[0]
    return { value: chosen.value, prNumber: chosen.reference.number, rule }
  }

  const merged = projected.filter((entry) => entry.reference.state === 'MERGED')
  if (merged.length > 0) return pick('merged', merged)

  const open = projected.filter((entry) => entry.reference.state === 'OPEN')
  if (open.length > 0) return pick('open', open)

  return pick('closed', projected)
}

export function parseRepository(value) {
  const parts = String(value ?? '').split('/')
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new Error('GITHUB_REPOSITORY 必须是非空 owner/repo')
  }
  return { owner: parts[0], repo: parts[1] }
}

const API = 'https://api.github.com/graphql'

export function createGraphQLClient({ token, fetchImpl = fetch, api = API }) {
  if (!token) throw new Error('PROJECTS_TOKEN 不能为空')

  return async function gql(query, variables) {
    let response
    try {
      response = await fetchImpl(api, {
        method: 'POST',
        headers: { authorization: `bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      })
    } catch (error) {
      throw new Error(`GraphQL 网络请求失败：${error.message}`, { cause: error })
    }

    if (!response?.ok) throw new Error(`GraphQL HTTP ${response?.status ?? 'unknown'}`)

    let body
    try {
      body = await response.json()
    } catch (error) {
      throw new Error(`GraphQL 响应不是合法 JSON：${error.message}`, { cause: error })
    }

    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'errors')) {
      if (!Array.isArray(body.errors)) throw new Error('GraphQL errors 不是数组')
      if (body.errors.length > 0) {
        throw new Error(`GraphQL errors：${body.errors.map((error) => error.message).join('; ')}`)
      }
    }
    if (!body || typeof body.data !== 'object' || body.data === null) {
      throw new Error('GraphQL 响应缺少 data')
    }
    return body.data
  }
}

export async function resolveProjectField({ gql, engineeringFieldId }) {
  if (!engineeringFieldId) throw new Error('未配置 ENGINEERING_FIELD_ID')
  const data = await gql(
    `query($owner:String!,$number:Int!,$fieldId:ID!){
      user(login:$owner){projectV2(number:$number){id}}
      node(id:$fieldId){... on ProjectV2SingleSelectField{
        id name dataType project{id} options{id name}
      }}
    }`,
    { owner: OWNER, number: PROJECT_NUMBER, fieldId: engineeringFieldId },
  )

  const project = data.user?.projectV2
  if (!project) throw new Error(`找不到 project ${OWNER}/#${PROJECT_NUMBER}`)
  const field = data.node
  if (!field) throw new Error(`找不到 Engineering 字段 ID ${engineeringFieldId}`)
  if (field.id !== engineeringFieldId) throw new Error('Engineering 字段返回了不匹配的 ID')
  if (field.project?.id !== project.id) throw new Error('Engineering 字段不属于目标 project')
  if (field.name !== FIELD_NAME) throw new Error(`字段名必须是 ${FIELD_NAME}，实际为 ${String(field.name)}`)
  if (field.dataType !== 'SINGLE_SELECT') throw new Error('Engineering 字段类型必须是 SINGLE_SELECT')
  if (!Array.isArray(field.options)) throw new Error('Engineering 字段缺少选项集合')

  const names = field.options.map((option) => option?.name)
  const uniqueNames = new Set(names)
  if (field.options.length !== STATES.length || uniqueNames.size !== STATES.length || STATES.some((state) => !uniqueNames.has(state))) {
    throw new Error(`Engineering 字段选项集合必须精确为：${STATES.join(', ')}`)
  }
  if (field.options.some((option) => !option?.id)) throw new Error('Engineering 字段选项缺少稳定 ID')
  if (new Set(field.options.map((option) => option.id)).size !== STATES.length) {
    throw new Error('Engineering 字段选项 ID 必须唯一')
  }

  return { projectId: project.id, fieldId: field.id, options: field.options }
}

/**
 * 读**触发事件的那个 PR** 的 `closingIssuesReferences`，解析出目标 project 上
 * 需要重算的条目。
 *
 * 它**不**读触发 PR 自己的快照：判定输入只有「该 issue 的完整关闭引用集合」
 * （见 `loadClosingPullRequests`），触发 PR 的快照在那份集合里同样会被读到并被
 * `expectedFor` 校验。留一个读取但从不参与判定的第二份快照，会让人误以为它仍然
 * 决定取值——那正是 issue #115 的成因。
 */
export async function loadTriggerPullRequest({ gql, owner, repo, prNumber, projectId }) {
  const data = await gql(
    `query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){
      pullRequest(number:$pr){
        closingIssuesReferences(first:100){totalCount nodes{
          number projectItems(first:100){totalCount nodes{id project{id}}}
        }}
      }
    }}`,
    { owner, repo, pr: prNumber },
  )
  if (!data.repository) throw new Error(`找不到 repository ${owner}/${repo}`)
  const pullRequest = data.repository.pullRequest
  if (!pullRequest) throw new Error(`找不到 pull request ${owner}/${repo}#${prNumber}`)

  const issues = pullRequest.closingIssuesReferences?.nodes
  if (!Array.isArray(issues)) throw new Error('PR snapshot 缺少 closingIssuesReferences')
  if (pullRequest.closingIssuesReferences.totalCount !== issues.length) {
    throw new Error('closingIssuesReferences snapshot 不完整')
  }
  const items = []
  for (const issue of issues) {
    if (!Array.isArray(issue?.projectItems?.nodes)) throw new Error('closing issue 缺少 projectItems')
    if (issue.projectItems.totalCount !== issue.projectItems.nodes.length) {
      throw new Error(`issue #${String(issue.number)} 的 projectItems snapshot 不完整`)
    }
    for (const item of issue.projectItems.nodes) {
      if (item?.project?.id === projectId) items.push({ issue: issue.number, itemId: item.id })
    }
  }

  return { items }
}

const CLOSING_PULL_REQUESTS_QUERY = `
query($owner:String!,$repo:String!,$issue:Int!,$cursor:String){
  repository(owner:$owner,name:$repo){
    issue(number:$issue){
      closedByPullRequestsReferences(first:${PAGE_SIZE},includeClosedPrs:true,after:$cursor){
        totalCount pageInfo{hasNextPage endCursor}
        nodes{number state merged isDraft reviewDecision createdAt}
      }
    }
  }
}`

/**
 * 读一个 issue 的**全部**关闭引用 PR（只读）。逐页读到 `hasNextPage` 为假为止，
 * 任何不完整——分页截断、超上限、字段缺失、`repository` / `issue` 为 null——都抛错，
 * 绝不把读到的部分当成完整输入。
 *
 * `includeClosedPrs: true` 是**必需**参数，不是可选项：schema 把这个字段描述成
 * "List of open pull requests referenced from this issue"，且 `includeClosedPrs`
 * 的默认值是 `false`；而 2026-09-24 实测 issue #110 上**不带**该参数时也返回了
 * 已合并的 PR #111——描述与实测行为不一致。依赖默认值等于把「已合并的 PR 被静默
 * 过滤掉」留在代码里，而那正是 issue #115 的故障形态。契约测试把这个参数钉在
 * 查询文本上。
 *
 * 返回的引用节点只保留选择策略需要的字段；`state` / `reviewDecision` 的域校验
 * 交给 `expectedFor`（同一份契约只有一处权威）。
 */
export async function loadClosingPullRequests({ gql, owner, repo, issueNumber }) {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`issue 编号必须是正整数：${String(issueNumber)}`)
  }

  const references = []
  let cursor = null
  let totalCount = null

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await gql(CLOSING_PULL_REQUESTS_QUERY, { owner, repo, issue: issueNumber, cursor })
    if (!data.repository) throw new Error(`找不到 repository ${owner}/${repo}`)
    if (!data.repository.issue) throw new Error(`找不到 issue ${owner}/${repo}#${issueNumber}`)

    const connection = data.repository.issue.closedByPullRequestsReferences
    if (connection === null || typeof connection !== 'object' || Array.isArray(connection)) {
      throw new Error(`issue #${issueNumber} 缺少 closedByPullRequestsReferences`)
    }
    if (!Array.isArray(connection.nodes)) {
      throw new Error(`issue #${issueNumber} 的 closedByPullRequestsReferences.nodes 必须是数组`)
    }
    if (!Number.isInteger(connection.totalCount) || connection.totalCount < 0) {
      throw new Error(`issue #${issueNumber} 的 closedByPullRequestsReferences.totalCount 必须是非负整数`)
    }
    if (totalCount === null) totalCount = connection.totalCount

    for (const node of connection.nodes) {
      assertReference(node)
      const reviewDecision = node.reviewDecision ?? null
      if (reviewDecision !== null && typeof reviewDecision !== 'string') {
        throw new Error(`issue #${issueNumber} 的引用 PR #${node.number} 的 reviewDecision 必须是字符串或 null`)
      }
      references.push({
        number: node.number,
        state: node.state,
        merged: node.merged,
        isDraft: node.isDraft,
        reviewDecision,
        createdAt: node.createdAt,
      })
    }

    const pageInfo = connection.pageInfo
    if (pageInfo === null || typeof pageInfo !== 'object' || Array.isArray(pageInfo)) {
      throw new Error(`issue #${issueNumber} 的 closedByPullRequestsReferences.pageInfo 必须是对象且不能为 null`)
    }
    if (typeof pageInfo.hasNextPage !== 'boolean') {
      throw new Error(`issue #${issueNumber} 的 closedByPullRequestsReferences.pageInfo.hasNextPage 必须是布尔值`)
    }
    if (pageInfo.hasNextPage !== true) {
      if (references.length !== totalCount) {
        throw new Error(`issue #${issueNumber} 的关闭引用不完整：nodes=${references.length}，totalCount=${totalCount}`)
      }
      return references
    }
    if (typeof pageInfo.endCursor !== 'string' || pageInfo.endCursor.trim().length === 0) {
      throw new Error(`issue #${issueNumber} 的 pageInfo.endCursor 必须是非空字符串`)
    }
    cursor = pageInfo.endCursor
  }

  throw new Error(`issue #${issueNumber} 的关闭引用超过 ${MAX_PAGES} 页（${PAGE_SIZE} 条/页）上限，拒绝在截断的输入上写入`)
}


function assertMutationAck(payload, itemId, clientMutationId) {
  if (payload?.clientMutationId !== clientMutationId) {
    throw new Error(`mutation ack clientMutationId 不匹配：期望 ${clientMutationId}`)
  }
  if (payload?.projectV2Item?.id !== itemId) {
    throw new Error(`mutation ack item 不匹配：期望 ${itemId}`)
  }
}

export async function writeEngineeringState({
  gql, projectId, fieldId, options, itemId, decision, clientMutationId,
}) {
  if (decision.kind === 'clear') {
    const data = await gql(
      `mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$clientMutationId:String!){
        clearProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,
          fieldId:$fieldId,clientMutationId:$clientMutationId}){
          clientMutationId projectV2Item{id}
        }
      }`,
      { projectId, itemId, fieldId, clientMutationId },
    )
    assertMutationAck(data.clearProjectV2ItemFieldValue, itemId, clientMutationId)
    return
  }

  if (!constructedSets.has(decision)) {
    throw new Error('写入边界拒绝未经构造器验证的 Engineering 决策')
  }
  const option = options.find((candidate) => candidate.name === decision.value)
  if (!option) throw new Error(`字段 ${FIELD_NAME} 没有名为「${decision.value}」的选项`)

  const data = await gql(
    `mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!,$clientMutationId:String!){
      updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,
        fieldId:$fieldId,value:{singleSelectOptionId:$optionId},clientMutationId:$clientMutationId}){
        clientMutationId projectV2Item{id}
      }
    }`,
    { projectId, itemId, fieldId, optionId: option.id, clientMutationId },
  )
  assertMutationAck(data.updateProjectV2ItemFieldValue, itemId, clientMutationId)
}

export async function main({ env = process.env, argv = process.argv, fetchImpl = fetch, log = console.log } = {}) {
  if (!env.PROJECTS_TOKEN) throw new Error('未配置 PROJECTS_TOKEN')
  if (!env.ENGINEERING_FIELD_ID) throw new Error('未配置 ENGINEERING_FIELD_ID（仓库变量 PROJECTS_ENGINEERING_FIELD_ID）')
  if (!env.RECONCILE_ID) throw new Error('未配置 RECONCILE_ID')
  const repository = parseRepository(env.GITHUB_REPOSITORY)
  const prNumber = Number(argv[2])
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error('用法：node scripts/sync-engineering-state.mjs <pr-number>')
  }

  const gql = createGraphQLClient({ token: env.PROJECTS_TOKEN, fetchImpl })
  const field = await resolveProjectField({ gql, engineeringFieldId: env.ENGINEERING_FIELD_ID })
  const trigger = await loadTriggerPullRequest({ gql, ...repository, prNumber, projectId: field.projectId })

  if (trigger.items.length === 0) {
    log(`PR #${prNumber} 没有通过 closing keyword 关联到目标 project item，无事可做。`)
    return 0
  }

  // 每个条目按**它自己的**关闭引用集合取值：同一份策略、同一份输入形态，与漂移
  // 观察者逐条一致。触发 PR 只是唤醒信号，不再是判定对象（issue #115）。
  for (const item of trigger.items) {
    const references = await loadClosingPullRequests({ gql, ...repository, issueNumber: item.issue })
    const expected = expectedFor({ references })

    // 触发 PR 必须出现在这份集合里。缺了它，剩下的引用仍可能给出一个看起来合法的
    // 取值（例如清空），而那是「退回只按触发 PR 写」的镜像错误。
    //
    // 代价如实写清：**「下一次 PR 事件会重试」这个前提已被实测证伪**。
    // `engineering-state.yml` 的 `concurrency: group: engineering-state-reconcile`
    // （`cancel-in-progress: false`）只保留同组最新的一次待运行；2026-09-23 三个
    // `ready_for_review` 在 8 秒内到达（09:24:25/27/30Z），三个 run（35842748362 /
    // 35842751381 / 35842756820）全部 `cancelled`，字段停在它们还是 draft 时写下的
    // `cleared`。事件本身会被丢掉，一次失败可能无限期停在错误取值上——与 issue #115
    // 同形，只是机制换成了「事件被并发组丢掉」。补救入口是生产路径本身（幂等）：
    // 对漂移条目所属的 PR 跑一次 `node scripts/sync-engineering-state.mjs <pr>`，
    // 再跑观察者确认它不再出现在 `findings` 里。命令与回读期望见 ExecPlan
    // 「评审响应（2026-09-23，根因修复）」一节。
    if (!references.some((reference) => reference.number === prNumber)) {
      throw new Error(
        `issue #${item.issue} 的关闭引用里没有触发 PR #${prNumber}：引用读取可能不完整，拒绝在可能不完整的集合上写入`,
      )
    }

    const decision = expected.value === null ? CLEAR : setEngineeringState(expected.value)
    const clientMutationId = `${env.RECONCILE_ID}:${item.itemId}`
    await writeEngineeringState({ gql, ...field, itemId: item.itemId, decision, clientMutationId })
    const value = decision.kind === 'clear' ? 'cleared' : decision.value
    log(`::notice::confirmed #${item.issue}: ${FIELD_NAME}=${value}; 依据 PR #${expected.prNumber}（规则 ${expected.rule}）; item=${item.itemId}; mutation=${clientMutationId}`)
  }
  log('Status 未被改动——规划状态与工程执行状态保持正交。')
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.log(`::error::${error.message}`)
    process.exit(1)
  })
}
