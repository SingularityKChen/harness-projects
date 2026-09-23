// `Engineering` 字段漂移的运行时边界 adapter。
//
// 规则与投影只存在于 `engineering-drift.mjs` 与 `sync-engineering-state.mjs`；
// 本文件只把 GitHub GraphQL 的完整快照交给那个纯函数，并把传输、结构、完整性或
// 规则异常统一变成 exit 1。
//
// 用法：
//   PROJECTS_TOKEN=... PROJECT_OWNER=... PROJECT_NUMBER=... GITHUB_REPOSITORY=owner/repo \
//     node scripts/check-engineering-drift-live.mjs [--json]

import { pathToFileURL } from 'node:url'

import { describeFinding, engineeringDriftFindings } from './engineering-drift.mjs'
import { FIELD_NAME, MAX_PAGES, PAGE_SIZE } from './sync-engineering-state.mjs'

const ENDPOINT = 'https://api.github.com/graphql'

const PULL_REQUESTS_QUERY = `
query EngineeringDriftPullRequests($owner:String!,$repo:String!,$cursor:String){
  repository(owner:$owner,name:$repo){
    pullRequests(first:${PAGE_SIZE},states:[OPEN,CLOSED,MERGED],
      orderBy:{field:CREATED_AT,direction:DESC},after:$cursor){
      totalCount pageInfo{hasNextPage endCursor}
      nodes{number state merged isDraft reviewDecision createdAt
        closingIssuesReferences(first:50){totalCount nodes{number}}}
    }
  }
}`

const ITEMS_QUERY = `
query EngineeringDriftItems($owner:String!,$number:Int!,$cursor:String){
  user(login:$owner){
    projectV2(number:$number){
      items(first:${PAGE_SIZE},after:$cursor){
        totalCount pageInfo{hasNextPage endCursor}
        nodes{id
          content{... on Issue{number repository{nameWithOwner}}}
          fieldValues(first:50){nodes{... on ProjectV2ItemFieldSingleSelectValue{
            name field{... on ProjectV2FieldCommon{name}}}}}
        }
      }
    }
  }
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
    const pullRequests = await fetchPullRequests(config, fetchImpl)
    const items = await fetchItems(config, fetchImpl)
    const { findings, skipped, checked } = engineeringDriftFindings({ pullRequests, items })

    if (asJson) {
      write(JSON.stringify({ findings, skipped, checked, pullRequests: pullRequests.length, items: items.length }))
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
      write(`已比较 ${checked} 个看板条目，全部等于 PR 真值（${skipped} 个条目没有被任何 PR 引用，跳过）。`)
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
  const repository = requiredString(env.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY')
  const parts = repository.split('/')
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new Error('GITHUB_REPOSITORY 必须是非空 owner/repo')
  }
  return { token, owner, projectNumber: Number(rawNumber), repoOwner: parts[0], repo: parts[1] }
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

/** 逐页取完为止；超过 `MAX_PAGES` 就失败，不把截断的输入当完整输入。 */
async function paginate({ config, query, variables, extract, label, fetchImpl }) {
  const nodes = []
  let cursor = null
  let totalCount = null

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await gql({ token: config.token, query, variables: { ...variables, cursor } }, fetchImpl)
    const connection = extract(data)
    if (!Array.isArray(connection.nodes)) throw new Error(`${label} 的 nodes 必须是数组`)
    if (!Number.isInteger(connection.totalCount) || connection.totalCount < 0) {
      throw new Error(`${label} 的 totalCount 必须是非负整数`)
    }
    if (totalCount === null) totalCount = connection.totalCount
    nodes.push(...connection.nodes)

    const pageInfo = requiredObject(connection.pageInfo, `${label}.pageInfo`)
    if (pageInfo.hasNextPage !== true) {
      if (nodes.length !== totalCount) {
        throw new Error(`${label} 响应不完整：nodes=${nodes.length}，totalCount=${totalCount}`)
      }
      return nodes
    }
    cursor = requiredString(pageInfo.endCursor, `${label}.pageInfo.endCursor`)
  }

  throw new Error(`${label} 超过 ${MAX_PAGES} 页（${PAGE_SIZE} 条/页）上限，拒绝在截断的输入上判定`)
}

async function fetchPullRequests(config, fetchImpl) {
  const nodes = await paginate({
    config,
    query: PULL_REQUESTS_QUERY,
    variables: { owner: config.repoOwner, repo: config.repo },
    extract: (data) => requiredObject(requiredObject(data.repository, 'data.repository').pullRequests, 'pullRequests'),
    label: 'pullRequests',
    fetchImpl,
  })

  // 只做纯函数做不到的那件事：`closingIssuesReferences` 的**完整性**。映射出来的每个
  // 字段都由 `normalizePullRequest` 校验——那是同一份契约的权威，在这里再验一遍只会
  // 造出第二处会漂移的副本。
  return nodes.map((node, index) => {
    const path = `pullRequests[${index}].closingIssuesReferences`
    const closing = requiredObject(node?.closingIssuesReferences, path)
    if (!Array.isArray(closing.nodes) || closing.nodes.length !== closing.totalCount) {
      throw new Error(`${path} 快照不完整`)
    }
    const { number, state, merged, isDraft, reviewDecision, createdAt } = node
    return {
      number, state, merged, isDraft, reviewDecision, createdAt,
      closingIssues: closing.nodes.map((issue) => issue?.number),
    }
  })
}

async function fetchItems(config, fetchImpl) {
  const nodes = await paginate({
    config,
    query: ITEMS_QUERY,
    variables: { owner: config.owner, number: config.projectNumber },
    extract: (data) => requiredObject(requiredObject(data.user, 'data.user').projectV2, 'projectV2').items,
    label: 'projectV2.items',
    fetchImpl,
  })

  // 项目是 user 级的，可以容纳任意仓库的条目；不按来源仓库过滤的话，他仓的 issue #N
  // 会被拿去和本仓库 close #N 的 PR 比较，既可能假红也可能掩盖真漂移。
  // 这个过滤同时排除了非 issue 的条目（PR、draft issue 都没有 `repository`），
  // 所以不再需要单独判一次 `content.number`。
  const wanted = `${config.repoOwner}/${config.repo}`
  const items = []
  for (const [index, node] of nodes.entries()) {
    if (node?.content?.repository?.nameWithOwner !== wanted) continue
    const path = `items[${index}]`

    const fieldValues = requiredObject(node.fieldValues, `${path}.fieldValues`)
    if (!Array.isArray(fieldValues.nodes)) throw new Error(`${path}.fieldValues.nodes 必须是数组`)
    const matches = fieldValues.nodes.filter((value) => value?.field?.name === FIELD_NAME)
    if (matches.length > 1) {
      throw new Error(`${path} 有 ${matches.length} 个 ${FIELD_NAME} 字段值，无法判定`)
    }
    items.push({
      itemId: requiredString(node.id, `${path}.id`),
      issue: node.content.number,
      engineering: matches.length === 0 ? null : (matches[0].name ?? null),
    })
  }
  return items
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
