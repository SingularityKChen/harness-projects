/**
 * 解码：`data` → 项目、一页条目行或字段定义。纯函数，任何不符都抛错，由 provider 映射成 `unavailable` + `malformed_response`；必填性以
 * schema 为准（成员关系的 id / type / 两个时间戳、内容的 id / title / body / updatedAt 都是非空类型）。种类只由 `type` 与 `__typename`
 * 对照决定，不解析 id 前缀；REDACTED 与 `content = null` 不读 content，也不读字段值。时间戳一律经 `sourceVersionFromTimestamp` 归一。
 */
import {
  PLANNING_MEMBERSHIP_OBJECT_KIND, sourceVersionFromTimestamp,
  type ExternalObjectRef, type ProviderIteration, type ProviderPlanningContent, type ProviderPlanningFieldDefinition,
  type ProviderPlanningItem, type ProviderProject,
} from '@harness-projects/capabilities'
import type { NativePlanningFieldValue } from '@harness-projects/domain'

export type Obj = Readonly<Record<string, unknown>>
/** 条目行：`content` 只服务内容观察，没有内容身份时为 undefined。 */
export interface ItemRow { readonly item: ProviderPlanningItem; readonly content: { readonly version: string; readonly fields: Obj } | undefined }

const KINDS: Readonly<Record<string, { readonly typename: string; readonly objectKind: string }>> = {
  ISSUE: { typename: 'Issue', objectKind: 'issue' }, DRAFT_ISSUE: { typename: 'DraftIssue', objectKind: 'draft' },
  PULL_REQUEST: { typename: 'PullRequest', objectKind: 'change_request' },
}
const emptyFields = (nativeValues: Readonly<Record<string, NativePlanningFieldValue>> = {}) =>
  ({ statusKey: undefined, priority: undefined, assigneeRefs: [], iterationId: undefined, startDate: undefined, targetDate: undefined, customFields: {}, nativeValues })

const fail = (): never => { throw new TypeError('响应形状不符') }
export const isRecord = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value)
const obj = (value: unknown): Obj => (isRecord(value) ? value : fail())
const str = (value: unknown): string => (typeof value === 'string' ? value : fail())
const id = (value: unknown): string => (str(value) === '' ? fail() : str(value))
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
/** 只接受真实存在的日历日（`2026-02-30` 失败），不做时区换算。 */
function dateOnly(value: unknown): string {
  const match = DATE_ONLY.exec(str(value)) ?? fail()
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? match[0] : fail()
}
const days = (value: unknown): number => (Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fail())
/** 一个 Project 至多 50 个字段（含系统字段），按 100 取的一页必然是全部：`hasNextPage` 不为 false 即前提被打破，整次失败。 */
const singlePage = (connection: Obj): readonly unknown[] =>
  (Array.isArray(connection.nodes) && obj(connection.pageInfo).hasNextPage === false ? connection.nodes : fail())

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
  const common = { project, membership, sourceVersion: sourceVersionFromTimestamp(membership.updatedAt), sourceUpdatedAt: membership.updatedAt }
  const { bindingId } = project
  if (kind === undefined || node.content === null) {
    const ref = { bindingId, objectKind: PLANNING_MEMBERSHIP_OBJECT_KIND, externalId: membership.externalId, url: undefined }
    return { item: { ...common, fields: emptyFields(), ref, content: { kind: 'redacted', reason: 'unavailable' } }, content: undefined }
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
  const fields = emptyFields(decodeFieldValues(obj(node.fieldValues)))
  return { item: { ...common, fields, ref, content }, content: { version: sourceVersionFromTimestamp(str(source.updatedAt)), fields: { kind: objectKind, number, title, body } } }
}

/** 一个字段值；只解码已实现读取的三种值类型，其余（Text / Labels / Repository …）返回 undefined 被跳过。schema 里可空的单选 `optionId` 与日期为 null 返回 null：字段在、没有值，仍参与同字段去重。 */
function decodeFieldValue(node: Obj): NativePlanningFieldValue | null | undefined {
  const typename = str(node.__typename)
  if (typename === 'ProjectV2ItemFieldSingleSelectValue') {
    return node.optionId === null ? null : { kind: 'single_select', optionId: id(node.optionId), name: node.name === null ? null : str(node.name) }
  }
  if (typename === 'ProjectV2ItemFieldIterationValue') {
    return { kind: 'iteration', iterationId: id(node.iterationId), title: str(node.title), startDate: dateOnly(node.startDate), durationDays: days(node.duration) }
  }
  if (typename === 'ProjectV2ItemFieldDateValue') return node.date === null ? null : { kind: 'date', date: dateOnly(node.date) }
  return undefined
}

/** 条目的字段值，以 project field id 为键（R2：option id 会在不同 Project 重复，不能拿来定位）；同一字段出现两次即形状错误。 */
function decodeFieldValues(connection: Obj): Readonly<Record<string, NativePlanningFieldValue>> {
  const entries: [string, NativePlanningFieldValue | null][] = []
  for (const raw of singlePage(connection)) {
    const node = obj(raw)
    const value = decodeFieldValue(node)
    if (value !== undefined) entries.push([id(obj(node.field).id), value])
  }
  // `fromEntries` 定义自有属性：任何字段 id（含 `__proto__`）都按字面成为键，不会落到原型上。
  if (new Set(entries.map(([fieldId]) => fieldId)).size !== entries.length) fail()
  return Object.fromEntries(entries.filter((entry): entry is [string, NativePlanningFieldValue] => entry[1] !== null))
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

function decodeIterations(configuration: Obj, projectFieldId: string): readonly ProviderIteration[] {
  const list = (raw: unknown, completed: boolean): readonly ProviderIteration[] => (Array.isArray(raw) ? raw : fail()).map((entry: unknown) => {
    const node = obj(entry)
    return { id: id(node.id), projectFieldId, title: str(node.title), startDate: dateOnly(node.startDate), durationDays: days(node.duration), completed }
  })
  return [...list(configuration.iterations, false), ...list(configuration.completedIterations, true)]
}

function decodeFieldDefinition(raw: unknown): ProviderPlanningFieldDefinition {
  const node = obj(raw)
  const [fieldId, name, dataType] = [id(node.id), str(node.name), str(node.dataType)]
  if (dataType === 'SINGLE_SELECT') {
    const options = (Array.isArray(node.options) ? node.options : fail()).map((option: unknown) => ({ id: id(obj(option).id), name: str(obj(option).name) }))
    return { id: fieldId, name, kind: 'single_select', options }
  }
  if (dataType === 'ITERATION') return { id: fieldId, name, kind: 'iteration', iterations: decodeIterations(obj(node.configuration), fieldId) }
  return { id: fieldId, name, kind: dataType === 'DATE' ? 'date' : 'unsupported' }
}

/** 项目的字段定义：只按 `dataType` 判别形状；重复的字段 id 即形状错误（同一响应不能有两种解释）。 */
export function decodeFieldDefinitions(node: Obj): readonly ProviderPlanningFieldDefinition[] {
  const definitions = singlePage(obj(node.fields)).map(decodeFieldDefinition)
  return new Set(definitions.map((definition) => definition.id)).size === definitions.length ? definitions : fail()
}
