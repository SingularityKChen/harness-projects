/**
 * 字段与迭代解码（#133）：字段定义连接、条目值连接（含首页）与成员关系续页。
 *
 * 纯函数：任何不符响应形状都抛错，由 provider 统一映射成 `unavailable` + `malformed_response`。红线：
 * - 只解码已实现读取的三个 kind（single_select / iteration / date），其余 dataType 一律 `unsupported`，不伪造空 options；
 * - 日期严格校验真实 `YYYY-MM-DD`（`2026-02-30` 不是日期），迭代工期必须是非负整数；
 * - 值以 project field id 为键，同一连接里重复出现同一字段即形状错误（重复冲突字段）；
 * - 续页只在 `hasNextPage === true` 时给出游标，游标缺失、为空或等于本次 `after` 都是形状错误（否则调用方会死循环）。
 */
import type { NativePlanningFieldValue } from '@harness-projects/domain'
import type { ExternalObjectRef, ProviderIteration, ProviderPlanningFieldDefinition } from '@harness-projects/capabilities'
import { id, obj, str, type Obj } from './decode.ts'

/** 平台上界：字段定义、条目值首页之外的单次值续页都用它。 */
export const FIELD_PAGE_SIZE = 100

const fail = (): never => { throw new TypeError('字段响应形状不符') }
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/** 只接受真实存在的日历日；闰日合法，`2026-02-30` 与 `2026-13-01` 一律失败。 */
function dateOnly(value: unknown): string {
  const text = str(value)
  const match = DATE_ONLY.exec(text)
  const [year, month, day] = match === null ? fail() : [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) fail()
  return text
}
const optionalDate = (value: unknown): string | undefined => (value === null || value === undefined ? undefined : dateOnly(value))
const durationDays = (value: unknown): number => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : fail())

function nextCursor(pageInfo: Obj, after: string | undefined): string | undefined {
  if (typeof pageInfo.hasNextPage !== 'boolean') fail()
  if (!pageInfo.hasNextPage) return undefined
  const cursor = id(pageInfo.endCursor)
  return cursor === after ? fail() : cursor
}

function decodeIterations(raw: unknown, projectFieldId: string, completed: boolean): readonly ProviderIteration[] {
  if (!Array.isArray(raw)) fail()
  return (raw as unknown[]).map((entry) => {
    const node = obj(entry)
    return {
      id: id(node.id), projectFieldId, title: str(node.title),
      startDate: optionalDate(node.startDate), durationDays: durationDays(node.duration), completed,
    }
  })
}

/** 只按 dataType 判别形状；未知 dataType 返回 unsupported，不读它的 options / configuration。 */
function decodeFieldDefinition(raw: unknown): ProviderPlanningFieldDefinition {
  const node = obj(raw)
  const [fieldId, name, dataType] = [id(node.id), str(node.name), str(node.dataType)]
  if (dataType === 'SINGLE_SELECT') {
    if (node.__typename !== 'ProjectV2SingleSelectField' || !Array.isArray(node.options)) fail()
    return {
      id: fieldId, name, kind: 'single_select',
      options: (node.options as unknown[]).map((option) => { const entry = obj(option); return { id: id(entry.id), name: str(entry.name) } }),
    }
  }
  if (dataType === 'ITERATION') {
    if (node.__typename !== 'ProjectV2IterationField') fail()
    const configuration = obj(node.configuration)
    return {
      id: fieldId, name, kind: 'iteration',
      iterations: decodeIterations(configuration.iterations, fieldId, false),
      completedIterations: decodeIterations(configuration.completedIterations, fieldId, true),
    }
  }
  if (dataType === 'DATE') return { id: fieldId, name, kind: 'date' }
  return { id: fieldId, name, kind: 'unsupported' }
}

/** 一页字段定义；`after` 是本次请求带的游标，用于拒绝停滞游标。 */
export function decodeFieldDefinitionsPage(
  node: Obj, after: string | undefined,
): { readonly definitions: readonly ProviderPlanningFieldDefinition[]; readonly nextCursor: string | undefined } {
  const fields = obj(node.fields)
  if (!Array.isArray(fields.nodes)) fail()
  return { definitions: (fields.nodes as unknown[]).map(decodeFieldDefinition), nextCursor: nextCursor(obj(fields.pageInfo), after) }
}

/**
 * 条目字段值。只解码三个已实现 kind；其他 value 类型（Text / Repository / Labels 等）没有可报告的原生形状，返回 undefined 被调用方跳过。
 * 键是 project field id，而不是 optionId：同一 optionId 出现在两个字段时各归其位（R2）。
 */
function decodeFieldValue(raw: unknown): { readonly fieldId: string; readonly value: NativePlanningFieldValue } | undefined {
  const node = obj(raw)
  const typename = str(node.__typename)
  if (typename === 'ProjectV2ItemFieldSingleSelectValue') {
    const field = obj(node.field)
    return { fieldId: id(field.id), value: { kind: 'single_select', optionId: id(node.optionId), name: node.name === null ? null : str(node.name) } }
  }
  if (typename === 'ProjectV2ItemFieldIterationValue') {
    const field = obj(node.field)
    return {
      fieldId: id(field.id),
      value: { kind: 'iteration', iterationId: id(node.iterationId), title: str(node.title), startDate: dateOnly(node.startDate), durationDays: durationDays(node.duration) },
    }
  }
  if (typename === 'ProjectV2ItemFieldDateValue') {
    const field = obj(node.field)
    return { fieldId: id(field.id), value: { kind: 'date', date: node.date === null ? null : dateOnly(node.date) } }
  }
  return undefined
}

/** 一页字段值（`fieldValues` 连接对象）：重复出现同一 project field id 即形状错误。 */
export function decodeFieldValuesPage(
  fieldValues: Obj, after: string | undefined,
): { readonly nativeValues: Readonly<Record<string, NativePlanningFieldValue>>; readonly nextCursor: string | undefined } {
  if (!Array.isArray(fieldValues.nodes)) fail()
  const nativeValues: Record<string, NativePlanningFieldValue> = {}
  for (const raw of fieldValues.nodes as unknown[]) {
    const decoded = decodeFieldValue(raw)
    if (decoded === undefined) continue
    if (Object.hasOwn(nativeValues, decoded.fieldId)) fail()
    nativeValues[decoded.fieldId] = decoded.value
  }
  return { nativeValues, nextCursor: nextCursor(obj(fieldValues.pageInfo), after) }
}

/**
 * 成员关系的一页字段值：`node` 必须是 ProjectV2Item，且返回的成员关系 id 与 project id 都要和本次请求的成员关系一致。
 * 内容 id / 历史 Draft id 一律不作为查询参数（R7），跨 project 响应整次失败。
 */
export function decodeItemFieldPage(
  node: Obj, project: ExternalObjectRef, membershipId: string, after: string | undefined,
): { readonly nativeValues: Readonly<Record<string, NativePlanningFieldValue>>; readonly nextCursor: string | undefined } {
  if (str(node.__typename) !== 'ProjectV2Item') fail()
  if (id(node.id) !== membershipId) fail()
  if (id(obj(node.project).id) !== project.externalId) fail()
  return decodeFieldValuesPage(obj(node.fieldValues), after)
}
