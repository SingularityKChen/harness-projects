// `Engineering` 字段漂移的运行时边界 adapter。
//
// 规则与投影只存在于 `engineering-drift.mjs` 与 `sync-engineering-state.mjs`；
// 本文件只把 GitHub GraphQL 的完整快照交给那个纯函数，并把传输、结构、完整性或
// 规则异常统一变成 exit 1。
//
// 用法：
//   PROJECTS_TOKEN=... PROJECT_OWNER=... PROJECT_NUMBER=... GITHUB_REPOSITORY=owner/repo \
//   ENGINEERING_FIELD_ID=... \
//     node scripts/check-engineering-drift-live.mjs [--json]

import { pathToFileURL } from 'node:url'

import { describeFinding, engineeringDriftFindings } from './engineering-drift.mjs'
import {
  CLOSING_REFERENCES_CONNECTION, FIELD_NAME, loadClosingPullRequests, MAX_PAGES, PAGE_SIZE, parseRepository,
  resolveProjectField,
} from './sync-engineering-state.mjs'

const ENDPOINT = 'https://api.github.com/graphql'

// 每个 item 的选择集；只用 fieldValueByName 定向读 Engineering，不读 fieldValues 全列，更不读 Status。
const ITEM_FIELDS = `id
  content{__typename ... on Issue{id number repository{nameWithOwner}
    closedByPullRequestsReferences(first:${PAGE_SIZE},includeClosedPrs:true){${CLOSING_REFERENCES_CONNECTION}}}}
  fieldValueByName(name:"${FIELD_NAME}"){... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{id}}}}`

const ITEMS_QUERY = `
query EngineeringProjectItems($owner:String!,$number:Int!,$cursor:String){
  user(login:$owner){
    projectV2(number:$number){
      id
      items(first:${PAGE_SIZE},after:$cursor,archivedStates:[ARCHIVED,NOT_ARCHIVED]){
        totalCount pageInfo{hasNextPage endCursor}
        nodes{${ITEM_FIELDS}}
      }
    }
  }
}`

const ITEM_QUERY = `
query EngineeringProjectItem($itemId:ID!){
  node(id:$itemId){... on ProjectV2Item{project{id} ${ITEM_FIELDS}}}
}`

/**
 * 执行一次实时观察。漂移存在、取数失败或快照不完整都返回 1；完整且无漂移返回 0。
 * fetch 与输出函数可注入，使契约测试保持离线。
 */
export async function runEngineeringDriftCheck({
  env = process.env,
  fetchImpl = globalThis.fetch,
  write = console.log,
  argv = process.argv,
} = {}) {
  const asJson = argv.includes('--json')
  try {
    const config = readConfig(env)
    const call = (query, variables) => gql({ token: config.token, query, variables }, fetchImpl)
    const { owner, projectNumber, repository } = config
    const field = await resolveProjectField({ gql: call, engineeringFieldId: config.fieldId, owner, projectNumber })
    const snapshot = await loadProjectEngineeringSnapshot({
      gql: call, owner, projectNumber, projectId: field.projectId, fieldId: field.fieldId, repository,
    })
    const { findings, checked } = engineeringDriftFindings(snapshot)

    if (asJson) {
      write(JSON.stringify({ findings, checked, ...snapshot.counts }))
    } else {
      for (const finding of findings) {
        write(`::error::[Engineering 漂移] ${describeFinding(finding)}`)
      }
    }

    if (findings.length > 0) {
      if (!asJson) {
        write(`看板 ${FIELD_NAME} 漂移检查失败：${findings.length} / ${checked} 个条目与 PR 真值不符。`)
      }
      return 1
    }

    if (!asJson) {
      write(`已比较 ${checked} 个看板条目，全部等于 PR 真值（排除 ${snapshot.counts.excluded} 个非本仓 Issue 条目）。`)
    }
    return 0
  } catch (error) {
    write(`::error::${FIELD_NAME} 漂移检查失败：${errorMessage(error)}`)
    return 1
  }
}

function readConfig(env) {
  const token = requiredString(env.PROJECTS_TOKEN, 'PROJECTS_TOKEN')
  const owner = requiredString(env.PROJECT_OWNER, 'PROJECT_OWNER')
  const rawNumber = requiredString(env.PROJECT_NUMBER, 'PROJECT_NUMBER')
  if (!/^[1-9]\d*$/.test(rawNumber)) throw new Error('PROJECT_NUMBER 必须是正整数')
  const fieldId = requiredString(env.ENGINEERING_FIELD_ID, 'ENGINEERING_FIELD_ID')
  return { token, owner, projectNumber: Number(rawNumber), fieldId, repository: parseRepository(env.GITHUB_REPOSITORY) }
}

async function gql({ token, query, variables }, fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 运行时不提供 fetch')

  let response
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'harness-projects-engineering-drift-observer',
      },
      body: JSON.stringify({ query, variables }),
    })
  } catch {
    throw new Error('GitHub GraphQL 网络请求失败')
  }

  if (response === null || typeof response !== 'object' || response.ok !== true) {
    const status = Number.isInteger(response?.status) ? `（HTTP ${response.status}）` : ''
    throw new Error(`GitHub GraphQL 请求未成功${status}`)
  }

  let body
  try {
    body = await response.json()
  } catch {
    throw new Error('GitHub GraphQL 响应不是有效 JSON')
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('GitHub GraphQL 响应根必须是对象')
  }
  if (body.errors !== undefined) {
    if (!Array.isArray(body.errors)) throw new Error('GitHub GraphQL errors 字段不是数组')
    if (body.errors.length > 0) throw new Error(`GitHub GraphQL 返回 ${body.errors.length} 个 errors`)
  }
  return requiredObject(body.data, 'data')
}

/** 逐页取完；超过页数上限、totalCount 变化、cursor 重复、条数与 totalCount 不符都失败，不把截断或矛盾的输入当完整。 */
async function paginate({ gql, query, variables, extract, label }) {
  const nodes = []
  const cursors = new Set()
  let cursor = null
  let totalCount = null

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const connection = extract(await gql(query, { ...variables, cursor }))
    if (!Array.isArray(connection.nodes)) throw new Error(`${label} 的 nodes 必须是数组`)
    if (!Number.isInteger(connection.totalCount) || connection.totalCount < 0) {
      throw new Error(`${label} 的 totalCount 必须是非负整数`)
    }
    if (totalCount !== null && connection.totalCount !== totalCount) {
      throw new Error(`SourceChanged：${label} 的 totalCount 在分页期间由 ${totalCount} 变为 ${connection.totalCount}`)
    }
    totalCount = connection.totalCount
    nodes.push(...connection.nodes)

    const pageInfo = requiredObject(connection.pageInfo, `${label}.pageInfo`)
    if (typeof pageInfo.hasNextPage !== 'boolean') throw new Error(`${label}.pageInfo.hasNextPage 必须是布尔值`)
    if (!pageInfo.hasNextPage) {
      if (nodes.length !== totalCount) {
        throw new Error(`${label} 响应不完整：nodes=${nodes.length}，totalCount=${totalCount}`)
      }
      return nodes
    }
    cursor = requiredString(pageInfo.endCursor, `${label}.pageInfo.endCursor`)
    if (cursors.has(cursor)) throw new Error(`${label}.pageInfo.endCursor 重复：${cursor}`)
    cursors.add(cursor)
  }

  throw new Error(`${label} 超过 ${MAX_PAGES} 页（${PAGE_SIZE} 条/页）上限，拒绝在截断的输入上判定`)
}

/**
 * 把一个 item 读成「候选 Issue + 完整关闭引用」。PullRequest、DraftIssue 与他仓 Issue 明确排除（返回 null，
 * 调用方计数）；content 为 null、类型未知、缺 id/仓库、引用不完整、字段值不属于目标字段一律失败。
 * `referencesComplete` 只在引用读完整后给出——它是完整零引用的唯一证据。
 */
async function readItem({ gql, node, fieldId, repository }) {
  const path = `item ${String(node?.id)}`
  requiredString(node?.id, 'item.id')
  const content = requiredObject(node.content, `${path}.content`)
  if (content.__typename === 'PullRequest' || content.__typename === 'DraftIssue') return null
  if (content.__typename !== 'Issue') throw new Error(`${path} 的 content 类型未知：${String(content.__typename)}`)
  requiredString(content.id, `${path}.content.id`)
  if (!Number.isInteger(content.number) || content.number <= 0) throw new Error(`${path}.content.number 必须是正整数`)
  const name = requiredString(content.repository?.nameWithOwner, `${path}.content.repository`)
  if (name !== `${repository.owner}/${repository.repo}`) return null

  const references = await loadClosingPullRequests({
    gql, ...repository, issueNumber: content.number, initialConnection: content.closedByPullRequestsReferences ?? null,
  })
  const value = node.fieldValueByName
  if (value !== null && (typeof value?.name !== 'string' || value.field?.id !== fieldId)) {
    throw new Error(`${path} 的 ${FIELD_NAME} 字段值不是目标单选字段的取值`)
  }
  return { item: { itemId: node.id, issue: content.number, issueId: content.id, engineering: value?.name ?? null, referencesComplete: true }, references }
}

/** 关联视图：每条 Issue 侧引用展开成一行 PR 快照（closingIssues:[issue]）；同一 Issue 来源，不查反向关系。 */
const viewOf = (reads) => ({
  pullRequests: reads.flatMap(({ item, references }) => references.map((reference) => ({ ...reference, closingIssues: [item.issue] }))),
  items: reads.map(({ item }) => item),
})

const unique = (seen, key, what) => {
  if (seen.has(key)) throw new Error(`${what} 重复：${key}`)
  seen.add(key)
}

/** 读取目标 Project 的完整工程快照 `{ pullRequests, items, counts }`（只读）；读完全部条目与嵌套引用才返回。 */
export async function loadProjectEngineeringSnapshot({ gql, owner, projectNumber, projectId, fieldId, repository }) {
  let pages = 0
  const nodes = await paginate({
    gql, query: ITEMS_QUERY, variables: { owner, number: projectNumber }, label: 'projectV2.items',
    extract: (data) => {
      pages += 1
      const project = requiredObject(requiredObject(data.user, 'data.user').projectV2, 'projectV2')
      if (project.id !== projectId) throw new Error('projectV2 与已校验的 Engineering 字段所属 project 不一致')
      return requiredObject(project.items, 'projectV2.items')
    },
  })

  const seen = { items: new Set(), issues: new Set() }
  const snapshots = new Map()
  const reads = []
  for (const node of nodes) {
    unique(seen.items, node?.id, 'Project item id')
    const read = await readItem({ gql, node, fieldId, repository })
    if (read === null) continue
    unique(seen.issues, read.item.issueId, 'Issue id')
    for (const { id, number, state, merged, isDraft, reviewDecision, createdAt } of read.references) {
      const snapshot = JSON.stringify([number, state, merged, isDraft, reviewDecision, createdAt])
      if (snapshots.has(id) && snapshots.get(id) !== snapshot) {
        throw new Error(`SourceChanged：PR ${id} 在同一批次读到矛盾的快照`)
      }
      snapshots.set(id, snapshot)
    }
    reads.push(read)
  }

  const view = viewOf(reads)
  return { ...view, counts: { pages, items: reads.length, referenceEdges: view.pullRequests.length, excluded: nodes.length - reads.length } }
}

/** 写前新鲜复读：用稳定 item id 重读 Project/Issue 身份、Engineering 与完整引用；item 移出、换 Issue 或来源不完整都失败。 */
export async function loadIssueEngineeringSnapshot({ gql, projectId, fieldId, repository, itemId, issueId }) {
  const { node } = await gql(ITEM_QUERY, { itemId })
  if (node?.id !== itemId || node.project?.id !== projectId) throw new Error(`item ${itemId} 已不在目标 project，停止本轮`)
  const read = await readItem({ gql, node, fieldId, repository })
  if (read === null || read.item.issueId !== issueId) throw new Error(`item ${itemId} 的 Issue 已变化，停止本轮`)
  const view = viewOf([read])
  return { ...view, counts: { items: 1, referenceEdges: view.pullRequests.length } }
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} 未配置`)
  return value.trim()
}

function requiredObject(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} 必须是对象且不能为 null`)
  }
  return value
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function invokedDirectly() {
  return process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url
}

if (invokedDirectly()) {
  process.exitCode = await runEngineeringDriftCheck()
}
