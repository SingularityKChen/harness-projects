/**
 * 解码：`data` → 项目或一页条目行。纯函数，任何不符都抛错，由 provider 映射成 `unavailable` + `malformed_response`；必填性以
 * schema 为准（成员关系的 id / type / 两个时间戳、内容的 id / title / body / updatedAt 都是非空类型）。种类只由 `type` 与 `__typename`
 * 对照决定，不解析 id 前缀；REDACTED 与 `content = null` 不读 content。时间戳一律经 `sourceVersionFromTimestamp` 归一。
 */
import {
  PLANNING_MEMBERSHIP_OBJECT_KIND, sourceVersionFromTimestamp,
  type ExternalObjectRef, type ProviderPlanningContent, type ProviderPlanningItem, type ProviderProject,
} from '@harness-projects/capabilities'

export type Obj = Readonly<Record<string, unknown>>
/** 条目行：`content` 只服务内容观察，没有内容身份时为 undefined。 */
export interface ItemRow { readonly item: ProviderPlanningItem; readonly content: { readonly version: string; readonly fields: Obj } | undefined }

const KINDS: Readonly<Record<string, { readonly typename: string; readonly objectKind: string }>> = {
  ISSUE: { typename: 'Issue', objectKind: 'issue' }, DRAFT_ISSUE: { typename: 'DraftIssue', objectKind: 'draft' },
  PULL_REQUEST: { typename: 'PullRequest', objectKind: 'change_request' },
}
const emptyFields = () => ({ statusKey: undefined, priority: undefined, assigneeRefs: [], iterationId: undefined, startDate: undefined, targetDate: undefined, customFields: {} })

const fail = (): never => { throw new TypeError('响应形状不符') }
export const isRecord = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value)
const obj = (value: unknown): Obj => (isRecord(value) ? value : fail())
const str = (value: unknown): string => (typeof value === 'string' ? value : fail())
const id = (value: unknown): string => (str(value) === '' ? fail() : str(value))

/** 项目节点；undefined 表示项目不可见（node 为 null 或不是 ProjectV2）：调用方报 not_found，绝不读成空页。 */
export function projectNode(body: unknown): Obj | undefined {
  const node = obj(obj(body).data).node
  return node === null || (isRecord(node) && node.__typename !== 'ProjectV2') ? undefined : obj(node)
}

export function decodeProject(node: Obj, project: ExternalObjectRef): ProviderProject {
  return node.id !== project.externalId ? fail() : { ref: { ...project, url: str(node.url) }, title: str(node.title), sourceUpdatedAt: str(node.updatedAt) }
}

function decodeRow(raw: unknown, project: ExternalObjectRef): ItemRow {
  const node = obj(raw)
  const type = str(node.type)
  const kind = type === 'REDACTED' ? undefined : Object.hasOwn(KINDS, type) ? KINDS[type] : fail()
  const membership = { externalId: id(node.id), createdAt: str(node.createdAt), updatedAt: str(node.updatedAt) }
  const common = { project, membership, fields: emptyFields(), sourceVersion: sourceVersionFromTimestamp(membership.updatedAt), sourceUpdatedAt: membership.updatedAt }
  const { bindingId } = project
  if (kind === undefined || node.content === null) {
    const ref = { bindingId, objectKind: PLANNING_MEMBERSHIP_OBJECT_KIND, externalId: membership.externalId, url: undefined }
    return { item: { ...common, ref, content: { kind: 'redacted', reason: 'unavailable' } }, content: undefined }
  }
  const { typename, objectKind } = kind
  const source = obj(node.content)
  if (source.__typename !== typename) fail()
  const [externalId, title, body, isDraft] = [id(source.id), str(source.title), str(source.body), objectKind === 'draft']
  const number = isDraft ? null : Number.isInteger(source.number) && Number(source.number) > 0 ? Number(source.number) : fail()
  const content: ProviderPlanningContent = objectKind === 'change_request' && number !== null
    ? { kind: 'change_request', changeRequest: { externalId, number, title, body } }
    : { kind: 'work_item', workItem: { externalId, title, body } }
  const ref = { bindingId, objectKind, externalId, url: isDraft ? undefined : str(source.url) }
  return { item: { ...common, ref, content }, content: { version: sourceVersionFromTimestamp(str(source.updatedAt)), fields: { kind: objectKind, number, title, body } } }
}

/** 一页条目；`after` 是本次请求带的游标：hasNextPage 为真但 endCursor 缺失、为空或等于 after 即形状错误，否则调用方会死循环。 */
export function decodeItemsPage(node: Obj, project: ExternalObjectRef, after: string | undefined): { readonly rows: readonly ItemRow[]; readonly nextCursor: string | undefined } {
  const items = obj(node.items)
  const pageInfo = obj(items.pageInfo)
  if (!Array.isArray(items.nodes) || typeof pageInfo.hasNextPage !== 'boolean') fail()
  const rows = (items.nodes as unknown[]).map((raw) => decodeRow(raw, project))
  if (!pageInfo.hasNextPage) return { rows, nextCursor: undefined }
  const nextCursor = id(pageInfo.endCursor)
  return nextCursor === after ? fail() : { rows, nextCursor }
}
