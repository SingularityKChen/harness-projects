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
