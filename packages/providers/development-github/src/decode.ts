/**
 * 解码：`data` → 仓库、一页分支、提交、变更请求（单个与一页）。纯函数，任何不符都抛 `TypeError`，由 provider 的读 `call` 包装映射成
 * `unavailable` + `malformed_response`，不做「过滤坏行后成功」。返回 undefined 表示平台说目标不存在或不可见（调用方报 `not_found`），
 * 绝不读成空页。种类只由 `__typename` 决定，不解析 id 前缀；list 与 get 共用同一个变更请求解码函数，所以两面逐字段相同。
 */
import type { ExternalObjectRef, ProviderBranch, ProviderChangeRequest, ProviderCommit, ProviderRepository, ProviderReviewState, ProviderCreateChangeRequestInput } from '@harness-projects/capabilities'
import type { ProviderBindingId } from '@harness-projects/domain'

export type Obj = Readonly<Record<string, unknown>>
/** 变更请求行：`updatedAt` 只服务观察流（归一成 sourceVersion），不属于端口投影。 */
export interface ChangeRequestRow { readonly item: ProviderChangeRequest; readonly updatedAt: string }
export interface DecodedPage<T> { readonly rows: readonly T[]; readonly nextCursor: string | undefined }

const fail = (): never => { throw new TypeError('响应形状不符') }
export const isRecord = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value)
const obj = (value: unknown): Obj => (isRecord(value) ? value : fail())
const str = (value: unknown): string => (typeof value === 'string' ? value : fail())
const id = (value: unknown): string => (str(value) === '' ? fail() : str(value))
export const SHA = /^[0-9a-f]{40}$/
const sha = (value: unknown): string => (SHA.test(str(value)) ? str(value) : fail())
/** 评审结论只认平台枚举的三值；null、DISMISSED 一类 union 之外的值都是 unknown，绝不默认 approved。 */
const REVIEW: Readonly<Record<string, ProviderReviewState>> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested', REVIEW_REQUIRED: 'review_required' }
const reviewStateOf = (decision: unknown): ProviderReviewState => (typeof decision === 'string' && Object.hasOwn(REVIEW, decision) ? REVIEW[decision] ?? 'unknown' : 'unknown')

/** 仓库节点；`repository: null`（平台说不可见）返回 undefined。 */
const repositoryOf = (data: Obj): Obj | undefined => (data.repository === null ? undefined : obj(data.repository))

/** 一页：`after` 是本次请求带的游标。hasNextPage 为真但 endCursor 缺失、为空或等于 after 即形状错误，否则调用方会死循环。 */
function pageOf<T>(connection: Obj, after: string | undefined, decodeNode: (raw: unknown) => T): DecodedPage<T> {
  const info = obj(connection.pageInfo)
  if (!Array.isArray(connection.nodes) || typeof info.hasNextPage !== 'boolean') fail()
  const rows = (connection.nodes as unknown[]).map(decodeNode)
  if (!info.hasNextPage) return { rows, nextCursor: undefined }
  const nextCursor = id(info.endCursor)
  return nextCursor === after ? fail() : { rows, nextCursor }
}

export function decodeRepository(data: Obj, ref: ExternalObjectRef): ProviderRepository | undefined {
  const node = repositoryOf(data)
  if (node === undefined) return undefined
  return { ref, name: id(node.name), defaultBranch: node.defaultBranchRef === null ? undefined : id(obj(node.defaultBranchRef).name), sourceUpdatedAt: str(node.updatedAt) }
}

export function decodeBranches(data: Obj, bindingId: ProviderBindingId, after: string | undefined): DecodedPage<ProviderBranch> | undefined {
  const node = repositoryOf(data)
  if (node === undefined) return undefined
  return pageOf(obj(node.refs), after, (raw) => {
    const branch = obj(raw)
    const name = id(branch.name)
    return { ref: { bindingId, objectKind: 'branch', externalId: name, url: undefined }, name, headCommit: sha(obj(branch.target).oid) }
  })
}

export function decodeCommit(data: Obj, bindingId: ProviderBindingId): ProviderCommit | undefined {
  const node = repositoryOf(data)
  if (node === undefined || node.object === null || (isRecord(node.object) && node.object.__typename !== 'Commit')) return undefined
  const commit = obj(node.object)
  const oid = sha(commit.oid)
  return { ref: { bindingId, objectKind: 'commit', externalId: oid, url: undefined }, sha: oid, message: str(commit.messageHeadline) === '' ? undefined : str(commit.messageHeadline) }
}

function decodeChangeRequestNode(raw: unknown, bindingId: ProviderBindingId): ChangeRequestRow {
  const node = obj(raw)
  const [externalId, headRefName] = [id(node.id), id(node.headRefName)]
  const number = Number.isInteger(node.number) && Number(node.number) > 0 ? Number(node.number) : fail()
  if (typeof node.isCrossRepository !== 'boolean') fail()
  const item: ProviderChangeRequest = {
    nativeIdentity: { namespace: 'github.com/graphql/PullRequest', id: externalId },
    ref: { bindingId, objectKind: 'change_request', externalId, url: str(node.url) }, number, title: str(node.title), body: str(node.body),
    state: str(node.state).toLowerCase(), sourceVersion: sha(node.headRefOid),
    // fork 上的同名分支不是本仓库的分支身份：headBranch 只在 head 与 base 同仓库时才有。
    headBranch: node.isCrossRepository ? undefined : headRefName, reviewState: reviewStateOf(node.reviewDecision),
  }
  return { item, updatedAt: str(node.updatedAt) }
}

export function decodeChangeRequests(data: Obj, bindingId: ProviderBindingId, after: string | undefined): DecodedPage<ChangeRequestRow> | undefined {
  const node = repositoryOf(data)
  return node === undefined ? undefined : pageOf(obj(node.pullRequests), after, (raw) => decodeChangeRequestNode(raw, bindingId))
}

/** 单个变更请求；不是 PR 的 node 与别的仓库的 PR（成员关系核对）都按不存在处理。 */
export function decodeChangeRequest(data: Obj, bindingId: ProviderBindingId): ChangeRequestRow | undefined {
  const repository = repositoryOf(data)
  const { node } = data
  if (repository === undefined || node === null || (isRecord(node) && node.__typename !== 'PullRequest')) return undefined
  return id(obj(obj(node).repository).id) === id(repository.id) ? decodeChangeRequestNode(node, bindingId) : undefined
}

/** 预检先验证完整形状，再报告身份是否匹配；不存在与不匹配是两种证据。 */
export function decodeCreatePreflight(data: Obj, owner: string, name: string, head: string, base: string): { repositoryId: string; matches: boolean } | undefined {
  const repository = repositoryOf(data)
  if (repository === undefined || repository.head === null || repository.base === null) return undefined
  const repositoryId = id(repository.id)
  let matches = id(repository.nameWithOwner).toLowerCase() === `${owner}/${name}`.toLowerCase()
  for (const [raw, expected] of [[repository.head, head], [repository.base, base]] as const) {
    const ref = obj(raw), target = obj(ref.target)
    if (target.__typename !== 'Commit') fail()
    sha(target.oid)
    const actualName = id(ref.name), prefix = id(ref.prefix), refRepositoryId = id(obj(ref.repository).id)
    matches = actualName === expected && prefix === 'refs/heads/' && refRepositoryId === repositoryId && matches
  }
  return { repositoryId, matches }
}

/** 写回执必须完整且逐字对应本次意图；任何不符由写 wrapper 折成 ambiguous。 */
export function decodeCreatedChangeRequest(data: Obj, bindingId: ProviderBindingId, repositoryId: string, input: ProviderCreateChangeRequestInput): ProviderChangeRequest {
  const node = obj(obj(data.createPullRequest).pullRequest)
  if (node.__typename !== 'PullRequest' || id(obj(node.repository).id) !== repositoryId || id(obj(node.headRepository).id) !== repositoryId
    || node.isCrossRepository !== false || node.headRefName !== input.head || node.baseRefName !== input.base
    || node.title !== input.title || node.body !== input.body || !Number.isSafeInteger(node.number)) fail()
  return decodeChangeRequestNode(node, bindingId).item
}
