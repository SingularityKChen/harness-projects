/**
 * 规划字段投影（#133）：原生值 + 工作区映射 → 规范状态与列表展示事实。纯函数，不读 Storage 与时钟。
 *
 * 规范状态只来自映射里显式列出的 option；未列出、字段不存在、值类型不符都得到 unknown，绝不按名称猜。状态写进投影的
 * `planningStatus`（唯一的规划状态事实源），展示事实里不另存第二份。redacted 内容不取任何字段值。
 */
import type { ProviderPlanningItem } from '@harness-projects/capabilities'
import {
  ContentKind, NormalizedStatus, normalizePlanningStatus,
  type NativePlanningFieldValue, type PlanningFieldsSnapshot, type WorkspacePlanningFieldMapping,
} from '@harness-projects/domain'

const MAPPABLE: ReadonlySet<unknown> = new Set(Object.values(NormalizedStatus).filter((status) => status !== NormalizedStatus.Unknown))
const ROLES: ReadonlySet<string> = new Set(['status', 'iterationFieldId', 'targetDateFieldId'])
const isPlain = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
function fieldId(value: unknown, path: string): void {
  if (typeof value !== 'string' || value === '') throw new TypeError(`planningFieldMapping.${path} 必须是非空字符串`)
}

/**
 * 组装输入的闸门：先深拷贝再校验并冻结，调用方事后改自己的对象不影响已校验的映射。只校验形状——角色键是闭集、字段 id
 * 是非空字符串、映射与 options 是普通对象、option 只能映射到确定的规范状态（unknown 是缺失哨兵，不是人工目标）；不合法即
 * 注册前以 TypeError 拒绝。不拿字段定义校验存在性：引用不存在的字段或 option 降级为 unknown。
 */
export function planningFieldMappingSnapshot(mapping: WorkspacePlanningFieldMapping): WorkspacePlanningFieldMapping {
  const copy: unknown = structuredClone(mapping)
  if (!isPlain(copy)) throw new TypeError('planningFieldMapping 必须是普通对象')
  for (const key of Object.keys(copy)) if (!ROLES.has(key)) throw new TypeError(`planningFieldMapping.${key} 不是字段角色`)
  for (const key of ['iterationFieldId', 'targetDateFieldId']) if (copy[key] !== undefined) fieldId(copy[key], key)
  const { status } = copy
  if (status !== undefined) {
    if (!isPlain(status) || !isPlain(status.options)) throw new TypeError('planningFieldMapping.status 与其 options 必须是普通对象')
    fieldId(status.projectFieldId, 'status.projectFieldId')
    for (const [optionId, target] of Object.entries(status.options)) {
      if (!MAPPABLE.has(target)) throw new TypeError(`planningFieldMapping.status.options.${optionId} 的 ${String(target)} 不是可映射的规范状态`)
    }
    Object.freeze(Object.freeze(status).options)
  }
  return Object.freeze(copy) as WorkspacePlanningFieldMapping
}

/** Provider 没有原生字段读取面（`nativeValues` 缺省）时沿用它给的 `statusKey`，没有展示事实。 */
export function planningFieldsOf(
  item: ProviderPlanningItem, mapping: WorkspacePlanningFieldMapping | undefined,
): { readonly planningStatus: NormalizedStatus; readonly planningFields?: PlanningFieldsSnapshot } {
  const values = item.fields.nativeValues
  if (values === undefined) return { planningStatus: normalizePlanningStatus(item.fields.statusKey ?? 'unknown') }
  if (item.content.kind === ContentKind.Redacted) return { planningStatus: NormalizedStatus.Unknown }
  const valueOf = (fieldId: string | undefined): NativePlanningFieldValue | undefined =>
    (fieldId !== undefined && Object.hasOwn(values, fieldId) ? values[fieldId] : undefined)
  const status = valueOf(mapping?.status?.projectFieldId)
  const option = status?.kind === 'single_select' ? status : undefined
  const options = mapping?.status?.options ?? {}
  const iteration = valueOf(mapping?.iterationFieldId)
  const date = valueOf(mapping?.targetDateFieldId)
  const fields: PlanningFieldsSnapshot = {
    ...(option?.name ? { statusName: option.name } : {}),
    ...(iteration?.kind === 'iteration' ? { iterationTitle: iteration.title } : {}),
    ...(date?.kind === 'date' ? { targetDate: date.date } : {}),
  }
  const mapped = option !== undefined && Object.hasOwn(options, option.optionId) ? options[option.optionId] : undefined
  return { planningStatus: mapped ?? NormalizedStatus.Unknown, ...(Object.keys(fields).length === 0 ? {} : { planningFields: fields }) }
}
