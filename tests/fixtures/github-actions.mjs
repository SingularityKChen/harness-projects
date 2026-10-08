/**
 * GitHub Actions / Checks 的合成公开协议 envelope 与严格 replay transport（不触网、不需要凭据）。
 * `createRecordedTransport` 校验 method 与静态 headers 完全一致、记录全部请求，未录制即抛错（未录制不等于离线）；
 * `actionsRoutes` 是一个最小的只读合成服务端：按 head_sha/branch/filter 过滤、按 per_page/page 分页、带 rel=next Link。
 * Link 默认用 GitHub 真实使用的 `/repositories/{数字 id}/…` 形态（2026-10-08 对真实 API 只读回读）。
 * 所有 id 都是合成整数，owner/repo 无真实个人数据；仓库数字 id 取自 GitHub 分页文档的示例。
 */
import assert from 'node:assert/strict'

export const OWNER = 'acme-widgets'
export const REPO_NAME = 'widgets'
export const REPOSITORY_EXTERNAL_ID = 'repo-alpha'
export const COMMIT = 'a'.repeat(40)
export const OTHER_COMMIT = 'b'.repeat(40)
export const MAIN_BRANCH = 'main'
export const NESTED_BRANCH = 'feature/nested/branch'
export const STATIC_HEADERS = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }

const base = `/repos/${OWNER}/${REPO_NAME}`
const LINK_BASE = '/repositories/1300192'
export const runsPath = () => `${base}/actions/runs`
export const checksPath = (commit) => `${base}/commits/${commit}/check-runs`
export const suitesPath = (commit) => `${base}/commits/${commit}/check-suites`

export const runItem = ({ id, commit = COMMIT, branch = MAIN_BRANCH, status = 'completed', conclusion = 'success' }) =>
  ({ id, name: `run-${id}`, head_sha: commit, head_branch: branch, status, conclusion })
export const checkItem = ({ id, name, commit = COMMIT, status = 'completed', conclusion = 'success' }) =>
  ({ id, name, head_sha: commit, status, conclusion })
export const suitesBody = (totalCount) => ({ total_count: totalCount, check_suites: [{ id: 1 }] })

/** 一条 Link 项；`path` 默认换成 `/repositories/{id}` 形态，`byRepoPath` 保留请求时的 `/repos/{owner}/{repo}` 形态。 */
export function linkTo({ path, query, page, rel = 'next', byRepoPath = false, host = 'api.github.com' }) {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))
  params.set('page', String(page))
  return `<https://${host}${byRepoPath ? path : path.replace(base, LINK_BASE)}?${params}>; rel="${rel}"`
}

/** GitHub request id 的真实形状（十六进制、冒号分段）；取值是合成的。 */
export const REQUEST_ID = '0F1E:2D3C4:5B6A79:887766:5544AA33'

/**
 * 脱敏的真实形状两页 runs 或 check runs：键集合与 Link（`/repositories/{id}`，next/last、prev/first）照 2026-10-08 对真实 API
 * 的只读回读，id、SHA、仓库号、名称与 request id 换成合成值，去掉 actor/repository/app 等账号字段。
 */
export function recordedPages(kind) {
  const checks = kind === 'checks'
  const [path, key, query] = checks ? [checksPath(COMMIT), 'check_runs', { filter: 'latest', per_page: 1 }] : [runsPath(), 'workflow_runs', { head_sha: COMMIT, per_page: 1 }]
  const links = (...pairs) => pairs.map(([page, rel]) => linkTo({ path, query, page, rel })).join(', ')
  const item = (id, conclusion) => (checks
    ? { id, name: 'build', node_id: `CR_${id}`, head_sha: COMMIT, external_id: '', status: 'completed', conclusion, check_suite: { id: 7 }, output: { title: null, annotations_count: 0 }, pull_requests: [] }
    : { id, name: 'CI', node_id: `WFR_${id}`, head_branch: MAIN_BRANCH, head_sha: COMMIT, path: '.github/workflows/ci.yml', run_number: 7, run_attempt: 1, event: 'push', status: 'completed', conclusion, workflow_id: 7, check_suite_id: id + 1, pull_requests: [] })
  return (request) => (request.path === suitesPath(COMMIT) ? { status: 200, headers: {}, body: suitesBody(2) } : request.query.page === 1
    ? { status: 200, headers: { Link: links([2, 'next'], [2, 'last']), 'X-GitHub-Request-Id': REQUEST_ID }, body: { total_count: 2, [key]: [item(90000000001, 'success')] } }
    : { status: 200, headers: { Link: links([1, 'prev'], [1, 'first']) }, body: { total_count: 2, [key]: [item(90000000003, 'failure')] } })
}

export function requestKey(request) {
  return JSON.stringify([request.method, request.path, Object.entries(request.query).sort(([left], [right]) => (left < right ? -1 : 1))])
}

/** 严格 replay：校验 GET 与静态 headers（无 Authorization），记录全部请求；handler 可返回 `{ failure }` 模拟网络异常。 */
export function createRecordedTransport(handler) {
  const calls = []
  const transport = async (request) => {
    assert.equal(request.method, 'GET', '只读 provider 只发 GET')
    assert.deepEqual(request.headers, STATIC_HEADERS, '请求只带静态头：不得携带 Authorization 或其它凭据')
    calls.push(structuredClone(request))
    const response = await (typeof handler === 'function' ? handler(request) : handler)
    if (response === undefined) throw new Error(`未录制的请求：${requestKey(request)}`)
    if (response.failure !== undefined) throw response.failure
    return { status: response.status, headers: { ...(response.headers ?? {}) }, body: structuredClone(response.body) }
  }
  return { transport, calls }
}

/** 合成服务端：runs 按 head_sha/branch 过滤，checks 按提交路径定位，suites 只报计数；`overrides` 按 path 覆盖单个端点（值可为函数）。 */
export function actionsRoutes({ runs = [], checks = [], suites = 1, overrides = {} } = {}) {
  const slice = (rows, request, key) => {
    const page = Number(request.query.page)
    const perPage = Number(request.query.per_page)
    const items = rows.slice((page - 1) * perPage, page * perPage)
    const query = Object.fromEntries(Object.entries(request.query).filter(([name]) => name !== 'page'))
    const headers = page * perPage < rows.length ? { link: linkTo({ path: request.path, query, page: page + 1 }) } : {}
    return { status: 200, headers, body: { total_count: rows.length, [key]: items } }
  }
  return (request) => {
    const override = overrides[request.path]
    const resolved = typeof override === 'function' ? override(request) : override
    if (resolved !== undefined) return resolved
    if (request.path === runsPath()) {
      return slice(runs.filter((run) => (request.query.head_sha === undefined || run.head_sha === request.query.head_sha)
        && (request.query.branch === undefined || run.head_branch === request.query.branch)), request, 'workflow_runs')
    }
    const commitPath = request.path.slice(base.length)
    const checksMatch = /^\/commits\/([0-9a-f]{40})\/check-runs$/.exec(commitPath)
    if (checksMatch !== null) return slice(checks.filter((check) => check.head_sha === checksMatch[1]), request, 'check_runs')
    const suitesMatch = /^\/commits\/([0-9a-f]{40})\/check-suites$/.exec(commitPath)
    if (suitesMatch !== null) return { status: 200, headers: {}, body: suitesBody(suites) }
    return undefined
  }
}
