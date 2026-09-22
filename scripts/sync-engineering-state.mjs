#!/usr/bin/env node
// 事件只负责唤醒 reconcile；GitHub 当前 PR snapshot 才是 Engineering 真值。

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

export async function loadPullRequestSnapshot({ gql, owner, repo, prNumber, projectId }) {
  const data = await gql(
    `query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){
      pullRequest(number:$pr){state merged isDraft reviewDecision
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

  return {
    snapshot: {
      state: pullRequest.state,
      merged: pullRequest.merged,
      isDraft: pullRequest.isDraft,
      reviewDecision: pullRequest.reviewDecision,
    },
    items,
  }
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
  const current = await loadPullRequestSnapshot({
    gql, ...repository, prNumber, projectId: field.projectId,
  })
  const decision = stateForSnapshot(current.snapshot)

  if (current.items.length === 0) {
    log(`PR #${prNumber} 没有通过 closing keyword 关联到目标 project item，无事可做。`)
    return 0
  }

  for (const item of current.items) {
    const clientMutationId = `${env.RECONCILE_ID}:${item.itemId}`
    await writeEngineeringState({ gql, ...field, itemId: item.itemId, decision, clientMutationId })
    const value = decision.kind === 'clear' ? 'cleared' : decision.value
    log(`::notice::confirmed #${item.issue}: ${FIELD_NAME}=${value}; item=${item.itemId}; mutation=${clientMutationId}`)
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
