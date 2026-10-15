/**
 * GitHub 只读 Development provider（#231）。失败一律是结构化 `ProviderResult`，任何路径都不抛错（core 的交付刷新把裸异常折成整次失败，逐跳缺口原因随之丢失）；唯一的例外是宿主注入的时钟违约（见 `now` 选项）。
 * 只读：仓库 / 分支 / 提交 / 变更请求，不实现任何写方法与工作树方法（省略，不是返回 `not_supported` 的桩）。无状态：不缓存、不重试、不退避、
 * 不持有凭据；鉴权、超时与重试属于宿主注入的 transport（ADR-0013 第 3 条）。输入闸门全部在发请求之前，闸门拒绝时 transport 调用次数为 0。
 */
import {
  AccessLevel, CapabilityKey, makeObservation, providerErr, providerError, providerOk, sourceVersionFromTimestamp,
  type DevelopmentProvider, type ExternalObjectRef, type ProviderChangeRequest, type ProviderDefinition, type ProviderObservation, type ProviderPage, type ProviderResult,
} from '@harness-projects/capabilities'
import { ProviderErrorCode, type ProviderBindingId } from '@harness-projects/domain'
import { classifyResponse, failure, requestIdOf } from './classify.ts'
import {
  SHA, decodeBranches, decodeChangeRequest, decodeChangeRequests, decodeCommit, decodeRepository, isRecord, type ChangeRequestRow, type DecodedPage, type Obj,
} from './decode.ts'
import { DEVELOPMENT_QUERIES } from './queries.ts'
import type { GraphqlRequest, GraphqlTransport } from './transport.ts'

export interface GithubDevelopmentProviderOptions {
  readonly bindingId: ProviderBindingId
  /** externalId：宿主选定的工作区仓库键（core 把它写成仓库主键，绝不能是 GitHub node id）；owner / name 只用于平台寻址。 */
  readonly repository: { readonly externalId: string; readonly owner: string; readonly name: string }
  readonly transport: GraphqlTransport
  /** 毫秒时钟，缺省 Date.now；必须返回有限的毫秒数（否则 describeCapabilities 在构造 observedAt 时抛 RangeError，reconcile 则一条不产出）。只用于快照的 observedAt、观察的 receivedTime 与限流等待换算。 */
  readonly now?: () => number
}

/** 平台单页上限（`first: 101` 报 EXCESSIVE_PAGINATION）；调用方给的 limit 钳位到这里。观察流至多扫描 MAX_SCAN_PAGES 页（1 万个 PR）。 */
const [MAX_PAGE_SIZE, MAX_SCAN_PAGES] = [100, 100]
const invalid = (message: string): ProviderResult<never> => providerErr(providerError(ProviderErrorCode.InvalidInput, message))
const notFound = (): ProviderResult<never> => providerErr(failure(ProviderErrorCode.NotFound, undefined))

export const GITHUB_DEVELOPMENT_DEFINITION: ProviderDefinition = Object.freeze({ implementationKey: 'development.github', domains: Object.freeze(['development'] as const) })

export function createGithubDevelopmentProvider({ bindingId, repository, transport, now = Date.now }: GithubDevelopmentProviderOptions): DevelopmentProvider {
  const nonEmpty = (value: unknown): boolean => typeof value === 'string' && value !== ''
  if (![repository?.externalId, repository?.owner, repository?.name].every(nonEmpty) || typeof transport !== 'function') {
    throw new TypeError('repository.externalId / owner / name 必须是非空字符串，transport 必须是函数')
  }
  const { externalId: repositoryKey, owner, name } = repository
  const repositoryRef: ExternalObjectRef = { bindingId, objectKind: 'repository', externalId: repositoryKey, url: undefined }
  const isRepository = (ref: ExternalObjectRef): boolean => ref.bindingId === bindingId && ref.objectKind === 'repository' && ref.externalId === repositoryKey
  const ask = (operationName: keyof typeof DEVELOPMENT_QUERIES, variables: Obj): GraphqlRequest =>
    ({ operationName, query: DEVELOPMENT_QUERIES[operationName], variables: { owner, name, ...variables } })

  /** 唯一的 try/catch：transport 抛错或 reject → transport_error；分类命中即失败；decode 返回 undefined → not_found；其余任何不符 → malformed_response。 */
  async function call<T>(request: GraphqlRequest, decode: (data: Obj) => T | undefined): Promise<ProviderResult<T>> {
    let rawClass = 'transport_error'
    let requestId: string | undefined
    try {
      const response = await transport(request)
      rawClass = 'malformed_response'
      requestId = requestIdOf(response.headers)
      const error = classifyResponse(response, now())
      if (error !== undefined) return providerErr(error, requestId)
      const found = decode(isRecord(response.body) && isRecord(response.body.data) ? response.body.data : Object.freeze({}))
      return found === undefined ? providerErr(failure(ProviderErrorCode.NotFound, requestId), requestId) : providerOk(found, requestId)
    } catch {
      return providerErr(failure(ProviderErrorCode.Unavailable, requestId, rawClass), requestId)
    }
  }

  const badPaging = (limit: number, cursor: string | undefined): ProviderResult<never> | undefined =>
    !Number.isInteger(limit) || limit < 1 ? invalid('limit 必须是不小于 1 的整数')
      : cursor !== undefined && (typeof cursor !== 'string' || cursor === '') ? invalid('cursor 必须是非空字符串或 undefined') : undefined

  const changeRequestsPage = (cursor: string | undefined, limit: number, headRefName: string | null): Promise<ProviderResult<DecodedPage<ChangeRequestRow>>> =>
    call(ask('DevelopmentChangeRequests', { headRefName, first: Math.min(limit, MAX_PAGE_SIZE), after: cursor ?? null }), (data) => decodeChangeRequests(data, bindingId, cursor))

  /**
   * 先过滤再分页（端口义务）：平台的 headRefName 过滤会带出 fork 上同名分支的 PR，后过滤之后不足一页时在本次调用内接着取平台页，每次只取还差的
   * 条数，直到凑满 `min(limit, 100)` 个命中或平台读完。交出的游标因此总是最后一个被完整消费的平台页的 endCursor：不跳过、不重复，单调前进。
   * 后过滤只用 headBranch 相等这一条谓词，不看标题、编号或前缀。一次调用至多 MAX_SCAN_PAGES 个平台请求，到上界仍未凑满时交出已得命中与游标
   * （core 把「未读完且未找到」记成缺口）；平台页多于所请求的条数、游标成环都按形状错误处理；任一请求失败整次失败。
   */
  async function filteredPage(cursor: string | undefined, limit: number, headBranch: string | undefined): Promise<ProviderResult<ProviderPage<ProviderChangeRequest>>> {
    const size = Math.min(limit, MAX_PAGE_SIZE)
    const items: ProviderChangeRequest[] = []
    const sent = new Set<string | undefined>()
    const malformed = (requestId: string | undefined) => providerErr(failure(ProviderErrorCode.Unavailable, requestId, 'malformed_response'), requestId)
    let after = cursor
    let requestId: string | undefined
    do {
      sent.add(after)
      const result = await changeRequestsPage(after, size - items.length, headBranch ?? null)
      if (!result.ok) return result
      if (result.value.rows.length > size - items.length) return malformed(result.requestId)
      items.push(...result.value.rows.map((row) => row.item).filter((item) => headBranch === undefined || item.headBranch === headBranch))
      after = result.value.nextCursor
      requestId = result.requestId
    } while (after !== undefined && items.length < size && !sent.has(after) && sent.size < MAX_SCAN_PAGES)
    return after !== undefined && sent.has(after) ? malformed(requestId) : providerOk({ items, nextCursor: after }, requestId)
  }

  /** 读完全部页；游标回到已发送过的值（成环）或超过页数上界按形状错误处理，不死循环。 */
  async function scan(): Promise<ProviderResult<readonly ChangeRequestRow[]>> {
    const rows: ChangeRequestRow[] = []
    const sent = new Set<string | undefined>()
    let cursor: string | undefined
    do {
      sent.add(cursor)
      const result = await changeRequestsPage(cursor, MAX_PAGE_SIZE, null)
      if (!result.ok) return result
      rows.push(...result.value.rows)
      cursor = result.value.nextCursor
    } while (cursor !== undefined && !sent.has(cursor) && sent.size < MAX_SCAN_PAGES)
    return cursor === undefined ? providerOk(rows) : providerErr(failure(ProviderErrorCode.Unavailable, undefined, 'malformed_response'))
  }

  const getRepository: DevelopmentProvider['getRepository'] = async (ref) => {
    if (!isRepository(ref)) return notFound()
    return call(ask('DevelopmentRepository', {}), (data) => decodeRepository(data, repositoryRef))
  }

  const provider: DevelopmentProvider = {
    definition: GITHUB_DEVELOPMENT_DEFINITION,
    /**
     * 每次调用用 `getRepository` 的同一路径探测一次，不缓存：成功 → available；任何结构化失败（权限、不可见、限流、不可用）→ degraded。
     * 选 degraded 而不是 unavailable：core 对 unavailable 的读门直接拒绝（`NotSupported`），degraded 仍放行读，缺口原因来自单次调用的结构化错误，
     * 补授权后无需重新组合就恢复。只声明已实现的两个读 key（评审结论是变更请求快照的字段，不是独立能力）。
     */
    async describeCapabilities() {
      const probe = await getRepository(repositoryRef)
      const keys = [CapabilityKey.DevelopmentRepositoryRead, CapabilityKey.DevelopmentChangeRequestRead]
      const level = (access: AccessLevel) => Object.fromEntries(keys.map((key) => [key, access]))
      return { bindingId, capability: level(AccessLevel.Available), permission: level(probe.ok ? AccessLevel.Available : AccessLevel.Degraded), observedAt: new Date(now()).toISOString() }
    },
    getRepository,
    async listBranches({ repository: ref, cursor, limit }) {
      if (!isRepository(ref)) return notFound()
      const bad = badPaging(limit, cursor)
      if (bad !== undefined) return bad
      const result = await call(ask('DevelopmentBranches', { first: Math.min(limit, MAX_PAGE_SIZE), after: cursor ?? null }), (data) => decodeBranches(data, bindingId, cursor))
      return result.ok ? providerOk({ items: result.value.rows, nextCursor: result.value.nextCursor }, result.requestId) : result
    },
    async getCommit(ref) {
      if (ref.bindingId !== bindingId || ref.objectKind !== 'commit') return notFound()
      if (typeof ref.externalId !== 'string' || !SHA.test(ref.externalId)) return invalid('提交引用必须是 40 位小写十六进制 sha')
      return call(ask('DevelopmentCommit', { oid: ref.externalId }), (data) => decodeCommit(data, bindingId))
    },
    async getChangeRequest(ref) {
      if (ref.bindingId !== bindingId || ref.objectKind !== 'change_request') return notFound()
      if (!nonEmpty(ref.externalId)) return invalid('变更请求引用的 externalId 必须是非空字符串')
      const result = await call(ask('DevelopmentChangeRequest', { id: ref.externalId }), (data) => decodeChangeRequest(data, bindingId))
      return result.ok ? providerOk(result.value.item, result.requestId) : result
    },
    async listChangeRequests({ repository: ref, cursor, limit, headBranch }) {
      if (!isRepository(ref)) return notFound()
      const bad = badPaging(limit, cursor)
      if (bad !== undefined) return bad
      if (headBranch !== undefined && !nonEmpty(headBranch)) return invalid('headBranch 必须是非空字符串或 undefined')
      return filteredPage(cursor, limit, headBranch)
    },
    /**
     * 全量比对（R5，忽略 scope.cursor），全有或全无：读完全部页并全部构造成功后才逐条产出；任何失败（含时间戳归一的 `RangeError` 与时钟
     * 非有限值）一条不产出，也不抛错。`sourceVersion` 是 `observation.ts` R4 的定宽规范载体，由 PR 的 `updatedAt` 归一，绝不是头部 sha
     * （sha 只作 payload 的 `headCommit`）。payload 不含请求头、游标、`requestId` 或凭据材料。
     */
    async *reconcile() {
      let observations: readonly ProviderObservation[] = []
      try {
        const scanned = await scan()
        const receivedTime = new Date(now()).toISOString()
        if (scanned.ok) {
          observations = scanned.value.map(({ item, updatedAt }) => {
            const version = sourceVersionFromTimestamp(updatedAt)
            const fields = { number: item.number, state: item.state, title: item.title, body: item.body, headBranch: item.headBranch ?? null, headCommit: item.sourceVersion ?? null, reviewState: item.reviewState }
            return makeObservation({ subject: item.ref, type: 'development.change_request.observed', eventTime: version, receivedTime, sourceVersion: version, stablePayloadFields: fields, payload: fields })
          })
        }
      } catch {
        return
      }
      yield* observations
    },
  }
  return provider
}
