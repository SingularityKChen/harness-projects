// 看板工作流语义的运行时边界 adapter。
//
// 规则与裁决表只存在于 board-workflow-check.mjs；本文件只把 GitHub GraphQL 的
// 完整快照交给那个纯函数，并把传输、结构、完整性或规则异常统一变成 exit 1。

import { pathToFileURL } from 'node:url'

import { boardWorkflowFindings } from './board-workflow-check.mjs'

const ENDPOINT = 'https://api.github.com/graphql'

const QUERY = `
  query BoardWorkflows($owner: String!, $number: Int!) {
    user(login: $owner) {
      projectV2(number: $number) {
        workflows(first: 100) {
          totalCount
          nodes {
            name
            enabled
          }
        }
      }
    }
  }
`

/**
 * 执行一次实时观察。所有非成功状态都返回 1，只有完整且合规的九条快照返回 0。
 * fetch 与输出函数可注入，使契约测试保持离线。
 */
export async function runBoardWorkflowCheck({
  env = process.env,
  fetchImpl = globalThis.fetch,
  write = console.log,
} = {}) {
  try {
    const config = readConfig(env)
    const workflows = await fetchWorkflows(config, fetchImpl)
    const findings = boardWorkflowFindings(workflows)

    if (findings.length > 0) {
      for (const finding of findings) {
        write(`::error::[${finding.kind}] ${finding.name}：${finding.message}`)
      }
      write(`看板工作流检查失败：${findings.length} 条偏离。`)
      return 1
    }

    write(`已检查 ${workflows.length} 条看板内置工作流，全部符合裁决表。`)
    return 0
  } catch (error) {
    write(`::error::看板工作流运行时观察失败：${errorMessage(error)}`)
    return 1
  }
}

function readConfig(env) {
  const token = requiredString(env.PROJECTS_TOKEN, 'PROJECTS_TOKEN')
  const owner = requiredString(env.PROJECT_OWNER, 'PROJECT_OWNER')
  const rawNumber = requiredString(env.PROJECT_NUMBER, 'PROJECT_NUMBER')
  if (!/^[1-9]\d*$/.test(rawNumber)) {
    throw new Error('PROJECT_NUMBER 必须是正整数')
  }
  return { token, owner, projectNumber: Number(rawNumber) }
}

async function fetchWorkflows({ token, owner, projectNumber }, fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前 Node.js 运行时不提供 fetch')
  }

  let response
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'harness-projects-board-observer',
      },
      body: JSON.stringify({ query: QUERY, variables: { owner, number: projectNumber } }),
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
    if (!Array.isArray(body.errors)) {
      throw new Error('GitHub GraphQL errors 字段不是数组')
    }
    if (body.errors.length > 0) {
      throw new Error(`GitHub GraphQL 返回 ${body.errors.length} 个 errors`)
    }
  }

  const data = requiredObject(body.data, 'data')
  const user = requiredObject(data.user, 'data.user')
  const project = requiredObject(user.projectV2, 'data.user.projectV2')
  const workflows = requiredObject(project.workflows, 'data.user.projectV2.workflows')

  if (!Array.isArray(workflows.nodes)) {
    throw new Error('data.user.projectV2.workflows.nodes 必须是数组')
  }
  if (!Number.isInteger(workflows.totalCount) || workflows.totalCount < 0) {
    throw new Error('data.user.projectV2.workflows.totalCount 必须是非负整数')
  }
  if (workflows.nodes.length !== workflows.totalCount) {
    throw new Error(
      `看板工作流响应不完整：nodes=${workflows.nodes.length}，totalCount=${workflows.totalCount}`,
    )
  }

  return workflows.nodes
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} 未配置`)
  }
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
  process.exitCode = await runBoardWorkflowCheck()
}
