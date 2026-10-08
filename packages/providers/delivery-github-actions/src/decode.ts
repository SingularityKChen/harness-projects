/**
 * GitHub Actions / Checks 原生页的解码与游标契约（只依赖 capabilities/domain 的类型，不做 IO）。
 *
 * 形状错误与「完整性证据不成立」在解码层一律抛 `PageShapeError`；provider 把它翻成结构化 unavailable，
 * 绝不在坏行上过滤后宣称成功。游标是本 provider 自造的 scope（endpoint/repository/commit/branch/page/pageSize），
 * 携首个 totalCount 与累积 readCount：改变 scope 或 limit 重用会被拒绝，URL 形态的外部游标一律不认。
 */

/** 解码失败：整页不可用，不产生部分结果。`rawClass` 是拦下这一页的守卫名（固定分类标签），让调用方能判别失败点。 */
export class PageShapeError extends Error {
  readonly rawClass: string
  constructor(message: string, rawClass = 'shape') { super(message); this.rawClass = rawClass }
}

export type PageEndpoint = 'workflow_runs' | 'check_runs'

export interface PageScope {
  readonly endpoint: PageEndpoint
  readonly repositoryId: string
  readonly commit: string | undefined
  readonly branch: string | undefined
  readonly page: number
  readonly pageSize: number
}

export interface PageCursor extends PageScope {
  /** 首个响应的 total_count：后续页必须相等，没有 next 时累计必须恰好等于它。 */
  readonly totalCount: number
  /** 本页之前已累计读取的条目数。 */
  readonly readCount: number
  /** checks 专用：首个 suites 探针的计数，后续每页复验相等。 */
  readonly expectedSuiteCount?: number
}

const HEX40 = /^[0-9a-f]{40}$/
const ENDPOINTS: readonly PageEndpoint[] = ['workflow_runs', 'check_runs']

export function isFullCommit(value: unknown): value is string {
  return typeof value === 'string' && HEX40.test(value)
}

/** 游标是 base64url 的 JSON：不是可解析的 scope 时返回 undefined，由调用方报 invalid_input。 */
export function decodeCursor(raw: string): PageCursor | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const cursor = parsed as PageCursor
  const valid = ENDPOINTS.includes(cursor.endpoint)
    && typeof cursor.repositoryId === 'string' && cursor.repositoryId !== ''
    && (cursor.commit === undefined || isFullCommit(cursor.commit))
    && (cursor.branch === undefined || typeof cursor.branch === 'string')
    && Number.isInteger(cursor.page) && cursor.page >= 1
    && Number.isInteger(cursor.pageSize) && cursor.pageSize >= 1 && cursor.pageSize <= 100
    && Number.isInteger(cursor.totalCount) && cursor.totalCount >= 0
    && Number.isInteger(cursor.readCount) && cursor.readCount >= 0
    && (cursor.expectedSuiteCount === undefined || (Number.isInteger(cursor.expectedSuiteCount) && cursor.expectedSuiteCount >= 0))
  return valid ? cursor : undefined
}

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function record(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new PageShapeError(`${what} 不是对象`)
  return value as Readonly<Record<string, unknown>>
}

function count(value: unknown, what: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new PageShapeError(`${what} 不是非负整数`)
  return value as number
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw new PageShapeError(`${what} 不是非空字符串`)
  return value
}

/** 原生 id 是数字；有的平台对象用字符串。两种都接受，但空值是形状错误。 */
function identifier(value: unknown, what: string): string {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value)
  return text(value, what)
}

function optionalText(value: unknown, what: string): string | undefined {
  if (value === null || value === undefined) return undefined
  return text(value, what)
}

/** 原生 page 形状 → `{ items, totalCount }`；每一项的 head_sha 由调用方按请求锚点复验。 */
export function decodeRunsPage(body: unknown): { readonly items: readonly WorkflowRunShape[]; readonly totalCount: number } {
  const page = record(body, 'workflow runs 响应')
  if (!Array.isArray(page.workflow_runs)) throw new PageShapeError('workflow_runs 不是数组')
  const items = page.workflow_runs.map((item) => {
    const row = record(item, 'workflow run')
    return {
      id: identifier(row.id, 'workflow run id'),
      status: text(row.status, 'workflow run status'),
      conclusion: optionalText(row.conclusion, 'workflow run conclusion'),
      headSha: optionalText(row.head_sha, 'workflow run head_sha'),
      headBranch: optionalText(row.head_branch, 'workflow run head_branch'),
    }
  })
  return { items, totalCount: count(page.total_count, 'workflow runs total_count') }
}

export function decodeChecksPage(body: unknown): { readonly items: readonly CheckRunShape[]; readonly totalCount: number } {
  const page = record(body, 'check runs 响应')
  if (!Array.isArray(page.check_runs)) throw new PageShapeError('check_runs 不是数组')
  const items = page.check_runs.map((item) => {
    const row = record(item, 'check run')
    return {
      id: identifier(row.id, 'check run id'),
      name: text(row.name, 'check run name'),
      status: text(row.status, 'check run status'),
      conclusion: optionalText(row.conclusion, 'check run conclusion'),
      headSha: optionalText(row.head_sha, 'check run head_sha'),
    }
  })
  return { items, totalCount: count(page.total_count, 'check runs total_count') }
}

export interface WorkflowRunShape {
  readonly id: string; readonly status: string; readonly conclusion: string | undefined
  readonly headSha: string | undefined; readonly headBranch: string | undefined
}
export interface CheckRunShape {
  readonly id: string; readonly name: string; readonly status: string
  readonly conclusion: string | undefined; readonly headSha: string | undefined
}

export function decodeSuitesCount(body: unknown): number {
  return count(record(body, 'check suites 响应').total_count, 'check suites total_count')
}

/**
 * 只解析 `rel="next"` 的页号并校验它仍指向当前 endpoint 与 filters/pageSize：多 next、变 host/path/scope、
 * 回退或不可解析都抛错。GitHub 的 Link 用仓库数字 id 路径 `/repositories/{id}/…`（2026-10-08 对真实 API 回读），
 * 故路径接受请求路径本身或 `/repositories/<数字>` 加同一 endpoint 后缀。后续请求由 provider 从配置与 scope 重建，
 * 绝不向 Link URL 携凭据请求。
 */
export function nextPageFromLink(link: string | undefined, expected: { readonly path: string; readonly query: Readonly<Record<string, string>>; readonly page: number }): number | undefined {
  if (link === undefined || link.trim() === '') return undefined
  const nexts = link.split(',').map((part) => part.trim()).filter((part) => /;\s*rel="next"\s*$/.test(part))
  if (nexts.length === 0) return undefined
  if (nexts.length > 1) throw new PageShapeError('Link 头里出现多个 rel=next', 'link_multiple')
  const target = nexts[0] as string
  let url: URL
  try {
    url = new URL(target.slice(0, target.lastIndexOf(';')).replace(/^<|>$/g, ''))
  } catch {
    throw new PageShapeError('rel=next 不是可解析的 URL', 'link_url')
  }
  if (url.host !== 'api.github.com') throw new PageShapeError('rel=next 指向了别的 host', 'link_host')
  const byId = /^\/repositories\/\d+(\/.+)$/.exec(url.pathname)?.[1]
  if (url.pathname !== expected.path && byId !== expected.path.replace(/^\/repos\/[^/]+\/[^/]+/, '')) throw new PageShapeError('rel=next 指向了别的 endpoint', 'link_path')
  const query = Object.fromEntries(url.searchParams.entries())
  if (query.page !== String(expected.page + 1)) throw new PageShapeError('rel=next 的页号没有严格前进', 'link_page')
  const rest = Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'page'))
  const wanted = Object.fromEntries(Object.entries(expected.query).sort())
  if (JSON.stringify(Object.fromEntries(Object.entries(rest).sort())) !== JSON.stringify(wanted)) {
    throw new PageShapeError('rel=next 的 filters 或 pageSize 与当前 scope 不一致', 'link_filters')
  }
  return expected.page + 1
}
