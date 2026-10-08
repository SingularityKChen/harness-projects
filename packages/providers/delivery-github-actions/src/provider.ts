/**
 * GitHub Actions 交付 Provider：只读的 workflow runs 与 check runs 精确提交读取。
 *
 * 只依赖 capabilities/domain：网络、凭据与超时由宿主注入的 GET-only transport 拥有；请求只带静态 Accept 与
 * `X-GitHub-Api-Version: 2022-11-28`，**不带 Authorization**。定位锚点是调用方已观察到的完整提交 SHA，绝不自行
 * GET 当前 PR 再读 head（那会引入第二个权威读取时刻）。每页都校验形状并复验 head_sha（指定 branch 时连
 * head_branch 一起）：错误定位整页失败，不允许过滤坏行后成功。游标由本 provider 生成，携 endpoint/repository/
 * commit/branch/page/pageSize 与首个 total_count、累计 readCount、checks 的 expectedSuiteCount；scope 或 limit
 * 改变即拒绝。checks 在每次读页前额外做 suites 计数探针——check-runs 的 total_count 是 runs 数，证明不了 suite
 * 全集，两种 1000 上界必须分开。写尝试无条件 not_supported、retryable false、零 transport。
 */
import {
  AccessLevel, CapabilityKey, providerErr, providerError, providerOk,
  type DeliveryProvider, type ExternalObjectRef, type ProviderCapabilitySnapshot, type ProviderCheckRun,
  type ProviderDefinition, type ProviderListChecksInput, type ProviderListPipelineRunsInput, type ProviderPage,
  type ProviderPipelineRun, type ProviderResult,
} from '@harness-projects/capabilities'
import { ProviderErrorCode, type ProviderBindingId } from '@harness-projects/domain'
import {
  PageShapeError, decodeChecksPage, decodeCursor, decodeRunsPage, decodeSuitesCount, encodeCursor,
  isFullCommit, nextPageFromLink, type PageCursor, type PageScope,
} from './decode.ts'

export type GithubActionsTransport = (request: {
  readonly method: 'GET'
  readonly path: string
  readonly query: Readonly<Record<string, string | number>>
  readonly headers: Readonly<Record<string, string>>
}) => Promise<{ readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: unknown }>

export interface GithubActionsProviderOptions {
  readonly bindingId: ProviderBindingId
  readonly repository: { readonly externalId: string; readonly owner: string; readonly name: string }
  readonly transport: GithubActionsTransport
  readonly observedAt: string
  readonly permission: Partial<Record<CapabilityKey, AccessLevel>>
  readonly clock?: () => number
}

/** 与仓库既有 REST 协议一致：只声明 API 版本，不因文档样例升级其它 Provider。 */
const STATIC_HEADERS: Readonly<Record<string, string>> = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
const MAX_PAGE_SIZE = 100
/** 搜索结果与 suites 各自的 1000 上界；达到即保守上报不可用，不尝试日期切分抓无限历史。 */
const SEARCH_LIMIT = 1000
const MAX_PAGE = 1000
const MAX_RETRY_AFTER_MS = 86_400_000
/** GitHub request id 的形状（十六进制、冒号分段，如 `0F1E:2D3C4:5B6A79:887766:5544AA33`）；token 形态的值不透出。 */
const REQUEST_ID = /^[0-9A-F]{1,8}(?::[0-9A-F]{1,16}){3,5}$/i
/** RFC 9110 的 IMF-fixdate；Retry-After 的 delay-seconds 只认纯数字，`''`、`1e3`、`0x10` 都不是限流证据。 */
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/
const DIGITS = /^\d+$/
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SHAPE_MESSAGE = 'GitHub 响应形状或分页完整性校验失败，本次读取不完整'

export const GITHUB_ACTIONS_DEFINITION: ProviderDefinition = { implementationKey: 'github-actions', domains: ['delivery'] }

type Failure = { readonly code: ProviderErrorCode; readonly message: string; readonly requestId: string | undefined; readonly retryAfterMs: number | undefined; readonly rawClass: string }
interface PageRead<TShape, T> {
  readonly path: string; readonly query: Readonly<Record<string, string | number>>; readonly scope: PageScope
  readonly cursor: PageCursor | undefined; readonly decode: (body: unknown) => { readonly items: readonly TShape[]; readonly totalCount: number }
  readonly verify: (items: readonly TShape[]) => void; readonly map: (items: readonly TShape[]) => readonly T[]
  readonly saturation: { readonly message: string; readonly rawClass: string }; readonly expectedSuiteCount?: number | undefined
}
type Target = { readonly repository: ExternalObjectRef; readonly commit?: string | undefined; readonly limit: number }

export function createGithubActionsDeliveryProvider(options: GithubActionsProviderOptions): DeliveryProvider {
  const { bindingId, repository, transport, permission } = options
  if (typeof repository !== 'object' || repository === null) throw new TypeError('repository 必须是对象')
  for (const [field, value] of [['externalId', repository.externalId], ['owner', repository.owner], ['name', repository.name]] as const) {
    if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`repository.${field} 必须是非空字符串`)
  }
  for (const [field, value] of [['owner', repository.owner], ['name', repository.name]] as const) {
    if (!PATH_SEGMENT.test(value)) throw new TypeError(`repository.${field} 必须是合法的单路径分量（拒绝分隔符与控制字符）`)
  }
  if (typeof options.observedAt !== 'string' || !ISO_WITH_ZONE.test(options.observedAt) || Number.isNaN(Date.parse(options.observedAt))) {
    throw new TypeError('observedAt 必须是可解析的带时区 ISO 时间文本')
  }
  if (typeof transport !== 'function') throw new TypeError('transport 必须是函数')
  const clock = options.clock ?? Date.now
  const base = `/repos/${repository.owner}/${repository.name}`

  const failure = (code: ProviderErrorCode, message: string, rawClass: string, extras: { readonly requestId?: string | undefined; readonly retryAfterMs?: number | undefined } = {}): Failure =>
    ({ code, message, rawClass, requestId: extras.requestId, retryAfterMs: extras.retryAfterMs })
  const invalid = (message: string): Failure => failure(ProviderErrorCode.InvalidInput, message, 'invalid_input')
  const fail = (f: Failure): ProviderResult<never> => providerErr(providerError(f.code, f.message, {
    ...(f.requestId === undefined ? {} : { requestId: f.requestId }),
    ...(f.retryAfterMs === undefined ? {} : { retryAfterMs: f.retryAfterMs }),
    rawClass: f.rawClass,
  }))

  /**
   * 公共输入闸门：仓库引用形状与绑定归属、commit 完整性（checks 要求必填）、limit 正整数；全部先于任何请求。
   * 坏类型是 invalid_input，形状合法但不属于本绑定/本仓库是 not_found。
   */
  function targetOf(input: Target, requireCommit: boolean): { readonly ok: true; readonly pageSize: number } | { readonly ok: false; readonly failure: Failure } {
    const ref = input?.repository
    if (typeof ref !== 'object' || ref === null || typeof ref.bindingId !== 'string' || typeof ref.objectKind !== 'string' || typeof ref.externalId !== 'string') {
      return { ok: false, failure: invalid('repository 引用的类型不合法') }
    }
    if (ref.bindingId !== bindingId || ref.objectKind !== 'repository' || ref.externalId !== repository.externalId) {
      return { ok: false, failure: failure(ProviderErrorCode.NotFound, '配置的仓库之外的对象对当前绑定不可见', 'foreign_ref') }
    }
    if ((requireCommit && !isFullCommit(input.commit)) || (input.commit !== undefined && !isFullCommit(input.commit))) {
      return { ok: false, failure: invalid('commit 必须是完整 40 位小写十六进制 SHA') }
    }
    if (!Number.isInteger(input.limit) || input.limit < 1) return { ok: false, failure: invalid('limit 必须是正整数') }
    return { ok: true, pageSize: Math.min(input.limit, MAX_PAGE_SIZE) }
  }

  /** 读请求的唯一出口：transport 抛出（网络/超时/坏 body）只翻成结构化 unavailable；响应头做一次小写归一。 */
  async function send(request: { readonly method: 'GET'; readonly path: string; readonly query: Readonly<Record<string, string | number>> }): Promise<{ readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: unknown } | { readonly failure: Failure }> {
    try {
      // 每次请求一份静态头副本：宿主就地改入参（例如注入凭据）不能串到别的请求或绑定。
      const response = await transport({ ...request, headers: { ...STATIC_HEADERS } })
      const headers: Record<string, string> = {}
      for (const [name, value] of Object.entries(response.headers)) headers[name.toLowerCase()] = value
      return { status: response.status, headers, body: response.body }
    } catch {
      return { failure: failure(ProviderErrorCode.Unavailable, 'GitHub 请求未完成', 'transport_error') }
    }
  }

  /**
   * HTTP 状态 → 八码模型。限流证据只有两种：`x-ratelimit-remaining === '0'`（exhausted），或合法的 Retry-After
   * （secondary rate limit，见 retryAfterOf）。单有 `x-ratelimit-reset` 不是限流证据——普通 403 经常带着它，把它当限流会把权限
   * 拒绝误报成可重试限流。message 是固定安全文案，绝不回显响应正文。
   */
  function classify(status: number, headers: Readonly<Record<string, string>>): Failure {
    const requestId = REQUEST_ID.test(headers['x-github-request-id'] ?? '') ? headers['x-github-request-id'] : undefined
    const exhausted = headers['x-ratelimit-remaining'] === '0'
    const retryAfterMs = retryAfterOf(headers, exhausted)
    const limited = failure(ProviderErrorCode.RateLimited, 'GitHub 限流，稍后可原样重发', 'http_403_rate_limit', { requestId, retryAfterMs })
    if (status === 403) return exhausted || retryAfterMs !== undefined ? limited : failure(ProviderErrorCode.PermissionDenied, '当前凭据没有读取该仓库的权限', 'http_403', { requestId })
    if (status === 401) return failure(ProviderErrorCode.PermissionDenied, '当前凭据没有读取该仓库的权限', 'http_401', { requestId })
    if (status === 404) return failure(ProviderErrorCode.NotFound, '仓库或提交对当前凭据不可见', 'http_404', { requestId })
    if (status === 429) return failure(ProviderErrorCode.RateLimited, 'GitHub 限流，稍后可原样重发', 'http_429', { requestId, retryAfterMs })
    return failure(ProviderErrorCode.Unavailable, 'GitHub 暂时不可用，可原样重发', `http_${status}`, { requestId })
  }

  /**
   * retryAfterMs 只从合法 Retry-After 得出：delay-seconds（纯数字）或 HTTP-date（按 clock 换算）；x-ratelimit-reset
   * （epoch 秒，纯数字）仅在 exhausted 时作为退避来源。范围 0..86400000；不合法的值不产出数值，也不算限流证据。
   */
  function retryAfterOf(headers: Readonly<Record<string, string>>, exhausted: boolean): number | undefined {
    const retryAfter = headers['retry-after'] ?? ''
    const reset = headers['x-ratelimit-reset'] ?? ''
    const raw = DIGITS.test(retryAfter) ? Number(retryAfter) * 1000 : HTTP_DATE.test(retryAfter) ? Date.parse(retryAfter) - clock()
      : exhausted && DIGITS.test(reset) ? Number(reset) * 1000 - clock() : undefined
    return raw === undefined || Number.isNaN(raw) ? undefined : Math.min(Math.max(Math.trunc(raw), 0), MAX_RETRY_AFTER_MS)
  }

  /** 游标 scope 必须与本次请求逐字一致：改变 repository/commit/branch/limit 重用一律 invalid_input。 */
  function cursorFor(raw: string | undefined, scope: PageScope): { readonly ok: true; readonly cursor: PageCursor | undefined } | { readonly ok: false; readonly failure: Failure } {
    if (raw === undefined) return { ok: true, cursor: undefined }
    const cursor = decodeCursor(raw)
    const mismatch = cursor === undefined || cursor.endpoint !== scope.endpoint || cursor.repositoryId !== repository.externalId
      || cursor.commit !== scope.commit || cursor.branch !== scope.branch || cursor.pageSize !== scope.pageSize
      || cursor.page > MAX_PAGE || cursor.readCount > cursor.totalCount
    return mismatch ? { ok: false, failure: invalid('游标不是本 provider 为该 scope 签发的') } : { ok: true, cursor }
  }

  /** 每次读一页并逐项校验；任何完整性证据不成立都放弃整页，返回结构化 unavailable。 */
  async function readPage<TShape, T>(args: PageRead<TShape, T>): Promise<ProviderResult<ProviderPage<T>>> {
    const response = await send({ method: 'GET', path: args.path, query: args.query })
    if ('failure' in response) return fail(response.failure)
    if (response.status !== 200) return fail(classify(response.status, response.headers))
    try {
      const page = args.decode(response.body)
      args.verify(page.items)
      if (page.totalCount >= SEARCH_LIMIT) return fail(failure(ProviderErrorCode.Unavailable, args.saturation.message, args.saturation.rawClass))
      const readCount = (args.cursor?.readCount ?? 0) + page.items.length
      if (args.cursor !== undefined && page.totalCount !== args.cursor.totalCount) throw new PageShapeError('后续页的 total_count 与首值不一致', 'total_count_changed')
      if (readCount > page.totalCount) throw new PageShapeError('累计读取数超过 total_count', 'read_over_total')
      const next = nextPageFromLink(response.headers.link, { path: args.path, query: withoutPage(args.query), page: args.scope.page })
      if (next === undefined && readCount !== page.totalCount) throw new PageShapeError('没有下一页但累计读取数不等于 total_count：缺 Link 不能当成读完整', 'missing_link')
      const nextCursor = next === undefined ? undefined : encodeCursor({
        ...args.scope, page: next, totalCount: page.totalCount, readCount,
        ...(args.expectedSuiteCount === undefined ? {} : { expectedSuiteCount: args.expectedSuiteCount }),
      })
      return providerOk({ items: args.map(page.items), nextCursor })
    } catch (error) {
      if (!(error instanceof PageShapeError)) throw error
      return fail(failure(ProviderErrorCode.Unavailable, SHAPE_MESSAGE, error.rawClass))
    }
  }

  async function listPipelineRuns(input: ProviderListPipelineRunsInput): Promise<ProviderResult<ProviderPage<ProviderPipelineRun>>> {
    const target = targetOf(input, false)
    if (!target.ok) return fail(target.failure)
    if (input.branch !== undefined && (typeof input.branch !== 'string' || input.branch === '')) return fail(invalid('branch 必须是非空字符串'))
    const scope: PageScope = { endpoint: 'workflow_runs', repositoryId: repository.externalId, commit: input.commit, branch: input.branch, page: 1, pageSize: target.pageSize }
    const decoded = cursorFor(input.cursor, scope)
    if (!decoded.ok) return fail(decoded.failure)
    const current = { ...scope, page: decoded.cursor?.page ?? 1 }
    const query: Readonly<Record<string, string | number>> = {
      ...(input.commit === undefined ? {} : { head_sha: input.commit }),
      ...(input.branch === undefined ? {} : { branch: input.branch }),
      per_page: target.pageSize, page: current.page,
    }
    return readPage({
      path: `${base}/actions/runs`, query, scope: current, cursor: decoded.cursor, decode: decodeRunsPage,
      saturation: { message: '搜索结果达到 GitHub 的 1000 条上界，本次读取不完整', rawClass: 'search_limit' },
      verify: (items) => {
        for (const run of items) {
          if (input.commit !== undefined && run.headSha !== input.commit) throw new PageShapeError('返回的运行 head_sha 与请求的提交不一致', 'head_sha')
          if (input.commit === undefined && !isFullCommit(run.headSha)) throw new PageShapeError('返回的运行没有可锚定的完整 head_sha', 'head_sha')
          if (input.branch !== undefined && run.headBranch !== input.branch) throw new PageShapeError('返回的运行 head_branch 与请求的分支不一致', 'head_branch')
        }
      },
      map: (items) => items.map((run) => ({
        ref: { bindingId, objectKind: 'pipeline_run', externalId: run.id, url: undefined },
        status: run.status, commit: input.commit ?? (run.headSha as string), branch: run.headBranch, conclusion: run.conclusion,
      })),
    })
  }

  async function listChecks(input: ProviderListChecksInput): Promise<ProviderResult<ProviderPage<ProviderCheckRun>>> {
    const target = targetOf(input, true)
    if (!target.ok) return fail(target.failure)
    const scope: PageScope = { endpoint: 'check_runs', repositoryId: repository.externalId, commit: input.commit, branch: undefined, page: 1, pageSize: target.pageSize }
    const decoded = cursorFor(input.cursor, scope)
    if (!decoded.ok) return fail(decoded.failure)
    const current = { ...scope, page: decoded.cursor?.page ?? 1 }
    // suite 计数探针：runs.total_count 不能证明 suite 全集，两种 1000 上界必须分开。
    const probe = await send({ method: 'GET', path: `${base}/commits/${input.commit}/check-suites`, query: { per_page: 1, page: 1 } })
    if ('failure' in probe) return fail(probe.failure)
    if (probe.status !== 200) return fail(classify(probe.status, probe.headers))
    let suiteCount: number
    try {
      suiteCount = decodeSuitesCount(probe.body)
    } catch (error) {
      if (!(error instanceof PageShapeError)) throw error
      return fail(failure(ProviderErrorCode.Unavailable, SHAPE_MESSAGE, 'shape'))
    }
    const expected = decoded.cursor?.expectedSuiteCount ?? suiteCount
    if (suiteCount >= SEARCH_LIMIT) return fail(failure(ProviderErrorCode.Unavailable, 'check suites 达到 GitHub 的 1000 条上界，本次读取不完整', 'suite_limit'))
    if (decoded.cursor !== undefined && decoded.cursor.expectedSuiteCount !== suiteCount) {
      return fail(failure(ProviderErrorCode.Unavailable, 'check suites 计数在读取期间变化，本次读取不完整', 'suite_count_changed'))
    }
    return readPage({
      path: `${base}/commits/${input.commit}/check-runs`, query: { filter: 'latest', per_page: target.pageSize, page: current.page },
      scope: current, cursor: decoded.cursor, decode: decodeChecksPage, expectedSuiteCount: expected,
      saturation: { message: 'check runs 达到 GitHub 的 1000 条上界，本次读取不完整', rawClass: 'run_limit' },
      verify: (items) => {
        for (const check of items) if (check.headSha !== input.commit) throw new PageShapeError('返回的检查 head_sha 与请求的提交不一致', 'head_sha')
      },
      map: (items) => items.map((check) => ({
        ref: { bindingId, objectKind: 'check_run', externalId: check.id, url: undefined },
        name: check.name, status: check.status, commit: input.commit, conclusion: check.conclusion,
      })),
    })
  }

  const describeCapabilities = (): Promise<ProviderCapabilitySnapshot> => Promise.resolve({
    bindingId, observedAt: options.observedAt,
    capability: { [CapabilityKey.DeliveryPipelineRead]: AccessLevel.Available, [CapabilityKey.DeliveryCheckRead]: AccessLevel.Available },
    permission: {
      [CapabilityKey.DeliveryPipelineRead]: permission[CapabilityKey.DeliveryPipelineRead] ?? AccessLevel.Unavailable,
      [CapabilityKey.DeliveryCheckRead]: permission[CapabilityKey.DeliveryCheckRead] ?? AccessLevel.Unavailable,
    },
  })
  const unsupported = <T,>(key: CapabilityKey): Promise<ProviderResult<T>> =>
    Promise.resolve(providerErr(providerError(ProviderErrorCode.NotSupported, `未启用的能力：${key}`)))

  return {
    definition: GITHUB_ACTIONS_DEFINITION, describeCapabilities, listPipelineRuns, listChecks,
    rerunPipeline: () => unsupported<ProviderPipelineRun>(CapabilityKey.DeliveryPipelineRerun),
    cancelPipeline: () => unsupported<void>(CapabilityKey.DeliveryPipelineRerun),
  }
}

function withoutPage(query: Readonly<Record<string, string | number>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'page').map(([key, value]) => [key, String(value)]))
}
