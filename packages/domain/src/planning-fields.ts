/**
 * 规划字段（#133）：Provider 报告的原生值、工作区显式映射与列表展示事实。
 *
 * 权威链：Provider 只报告原生事实，以 project field id 为键（裁决 R2：同一 option id 会在不同 Project 重复）；core
 * 按工作区映射把状态选项归一到投影的 `planningStatus`——那是唯一的规划状态事实源（不变量 1）；其余角色只取展示事实。
 * 映射没有列出的选项一律不归一，绝不按字段名或选项名猜测。
 */
import { NormalizedStatus } from './enums.ts'

/** 平台原生字段值。日期是严格的 `YYYY-MM-DD`；迭代保留 title 与 date-only 起始日、工期天数，不推算末日。 */
export type NativePlanningFieldValue =
  | { readonly kind: 'single_select'; readonly optionId: string; readonly name: string | null }
  | { readonly kind: 'iteration'; readonly iterationId: string; readonly title: string; readonly startDate: string; readonly durationDays: number }
  | { readonly kind: 'date'; readonly date: string }

/** 工作区对其 Planning 项目的字段角色映射：Host 显式给出 project field id 与 option id，不按名称发现。 */
export interface WorkspacePlanningFieldMapping {
  /** 承载规划状态的单选字段，及其 option id → 规范状态；未列出的 option 不归一。 */
  readonly status?: { readonly projectFieldId: string; readonly options: Readonly<Record<string, NormalizedStatus>> }
  readonly iterationFieldId?: string
  readonly targetDateFieldId?: string
}

/**
 * 列表展示事实：随投影在同一 Storage 事务里确认，缺省的键表示这次读取没有该值。规范状态不在这里（见
 * `WorkspaceProjection.planningStatus`）；`statusName` 是映射的状态字段上的原生选项名，只在规范状态为 unknown 时
 * 用来说明「未映射」。
 */
export interface PlanningFieldsSnapshot {
  readonly statusName?: string
  readonly iterationTitle?: string
  readonly targetDate?: string
}

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
