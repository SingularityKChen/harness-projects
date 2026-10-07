/**
 * 规划字段投影与映射校验（#133，Batch 2）。
 *
 * 本模块是「原生值 + 工作区显式映射 → 展示快照」的**唯一纯函数**实现：不读 Storage、不读时钟、不改入参。
 * 事实分层（AGENTS.md §1.1 不变量 5 / 7）：Provider 只报告原生事实，Host 按显式映射决定角色；角色未配置、
 * 字段不存在或选项未列出时一律降级（unset / native_only），**绝不**按名称猜角色或把 `Done` 自动归一。
 * 校验是写前闸门：非法映射以裸 `TypeError` 拒绝，让外层事务整笔回滚、不留下半确认状态。
 */
import {
  NormalizedStatus,
  type NativePlanningFieldValue,
  type PlanningFieldsSnapshot,
  type PlanningStatusSnapshot,
  type ProviderBindingId,
  type WorkspacePlanningFieldMapping,
} from '@harness-projects/domain'
import type { ProviderPlanningFieldDefinition } from '@harness-projects/capabilities'

/** 映射的期望作用域：binding 与 project 两者都必须逐字相符，否则映射不适用于本次读取。 */
export interface PlanningFieldMappingScope {
  readonly bindingId: ProviderBindingId
  readonly projectExternalId: string
}

const NORMALIZED_STATUSES: ReadonlySet<string> = new Set(Object.values(NormalizedStatus))
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value)
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
/** 裸 `TypeError`：调用方（context / bootstrap）据此在写任何行之前拒绝，外层事务整笔回滚。 */
function fail(message: string): never { throw new TypeError(message) }

/**
 * 静态校验（注册前与 bootstrap 写前都调用）：作用域逐字相符、field id 非空、枚举值属于 `NormalizedStatus`
 * 闭集、可选键用自有属性判定。`Unknown` 是内部缺失哨兵，不得作为人工映射目标。
 */
export function assertWorkspacePlanningFieldMapping(mapping: WorkspacePlanningFieldMapping, scope: PlanningFieldMappingScope): void {
  if (!isRecord(mapping)) fail('planningFieldMapping 必须是对象')
  if (mapping.bindingId !== scope.bindingId) fail(`planningFieldMapping 的 bindingId ${String(mapping.bindingId)} 与工作区绑定 ${scope.bindingId} 不符`)
  if (mapping.projectExternalId !== scope.projectExternalId) fail(`planningFieldMapping 的 projectExternalId ${String(mapping.projectExternalId)} 与工作区项目 ${scope.projectExternalId} 不符`)
  if (Object.hasOwn(mapping, 'status')) {
    const status = mapping.status
    if (!isRecord(status)) fail('planningFieldMapping.status 必须是对象')
    if (!nonEmpty(status.projectFieldId)) fail('planningFieldMapping.status.projectFieldId 必须是非空字符串')
    if (!isRecord(status.options)) fail('planningFieldMapping.status.options 必须是 optionId → NormalizedStatus 的对象')
    const options = Object.entries(status.options)
    if (options.length === 0) fail('planningFieldMapping.status.options 不得为空：没有可映射的选项应省略 status 角色')
    for (const [optionId, normalized] of options) {
      if (optionId.trim() === '') fail('planningFieldMapping.status.options 含空 optionId')
      if (typeof normalized !== 'string' || !NORMALIZED_STATUSES.has(normalized)) fail(`planningFieldMapping.status.options.${optionId} 的 ${String(normalized)} 不是 NormalizedStatus`)
      if (normalized === NormalizedStatus.Unknown) fail(`planningFieldMapping.status.options.${optionId} 不得映射为 Unknown：它是内部缺失哨兵，不是人工目标`)
    }
  }
  for (const role of ['iterationFieldId', 'targetDateFieldId'] as const) {
    if (Object.hasOwn(mapping, role) && !nonEmpty(mapping[role])) fail(`planningFieldMapping.${role} 必须是非空字符串`)
  }
}

/** 新配置的字段角色与选项归属校验（同步写之前）：字段必须存在且 kind 匹配，每个 option id 必须属于该字段。 */
export function assertPlanningFieldRoleDefinitions(
  mapping: WorkspacePlanningFieldMapping, definitions: readonly ProviderPlanningFieldDefinition[],
): void {
  const fieldOf = (fieldId: string): ProviderPlanningFieldDefinition | undefined => definitions.find((definition) => definition.id === fieldId)
  if (mapping.status !== undefined) {
    const field = fieldOf(mapping.status.projectFieldId)
    if (field === undefined) fail(`映射的 status 字段 ${mapping.status.projectFieldId} 不在本次字段定义里`)
    if (field.kind !== 'single_select') fail(`映射的 status 字段 ${field.id} 的 kind 是 ${field.kind}，不是 single_select`)
    const known = new Set(field.options.map((option) => option.id))
    for (const optionId of Object.keys(mapping.status.options)) {
      if (!known.has(optionId)) fail(`映射的 status 选项 ${optionId} 不在字段 ${field.id} 的 options 里`)
    }
  }
  const roleKinds = [['iterationFieldId', 'iteration'], ['targetDateFieldId', 'date']] as const
  for (const [role, kind] of roleKinds) {
    const fieldId = mapping[role]
    if (fieldId === undefined) continue
    const field = fieldOf(fieldId)
    if (field === undefined) fail(`映射的 ${role} ${fieldId} 不在本次字段定义里`)
    if (field.kind !== kind) fail(`映射的 ${role} ${fieldId} 的 kind 是 ${field.kind}，不是 ${kind}`)
  }
}

/**
 * 原生值 + 定义 + 映射 → 展示快照。角色字段不存在即 unset；选项未列出或值不是 single_select 即 native_only；
 * iteration / targetDate 只在值与类型都匹配时出现，其它情况**缺省该键**（不出现 = 这次确认没有该值）。
 */
export function projectPlanningFields(
  values: Readonly<Record<string, NativePlanningFieldValue>>,
  definitions: readonly ProviderPlanningFieldDefinition[],
  mapping: WorkspacePlanningFieldMapping | undefined,
): PlanningFieldsSnapshot {
  const fieldOf = (fieldId: string | undefined): ProviderPlanningFieldDefinition | undefined =>
    fieldId === undefined ? undefined : definitions.find((definition) => definition.id === fieldId)
  const valueOf = (fieldId: string | undefined): NativePlanningFieldValue | undefined =>
    fieldId === undefined ? undefined : (Object.hasOwn(values, fieldId) ? values[fieldId] : undefined)

  let status: PlanningStatusSnapshot = { kind: 'unset' }
  const statusField = fieldOf(mapping?.status?.projectFieldId)
  if (mapping?.status !== undefined && statusField !== undefined && statusField.kind === 'single_select') {
    const value = valueOf(statusField.id)
    if (value !== undefined && value.kind === 'single_select') {
      const normalized = Object.hasOwn(mapping.status.options, value.optionId) ? mapping.status.options[value.optionId] : undefined
      status = normalized === undefined
        ? { kind: 'native_only', nativeName: value.name }
        : { kind: 'mapped', nativeName: value.name, normalized }
    } else {
      status = { kind: 'native_only', nativeName: null }
    }
  }

  const iterationValue = valueOf(mapping?.iterationFieldId)
  const dateValue = valueOf(mapping?.targetDateFieldId)
  return {
    status,
    ...(iterationValue !== undefined && iterationValue.kind === 'iteration'
      ? { iteration: { title: iterationValue.title, startDate: iterationValue.startDate, durationDays: iterationValue.durationDays } } : {}),
    ...(dateValue !== undefined && dateValue.kind === 'date' && dateValue.date !== null ? { targetDate: dateValue.date } : {}),
  }
}

/**
 * 原生值 → `FieldValueRecord.value` 的**确定性 JSON**：键顺序固定（与对象字面量顺序无关），因此两个 Storage
 * 只做「原样存字符串」也能得到逐字相同的行。storage 不引入编解码模块，编解码只有 core 这一份。
 */
export function encodeNativePlanningFieldValue(value: NativePlanningFieldValue): string {
  if (value.kind === 'single_select') return JSON.stringify({ kind: value.kind, optionId: value.optionId, name: value.name })
  if (value.kind === 'iteration') {
    return JSON.stringify({ kind: value.kind, iterationId: value.iterationId, title: value.title, startDate: value.startDate, durationDays: value.durationDays })
  }
  return JSON.stringify({ kind: value.kind, date: value.date })
}
