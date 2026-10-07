/**
 * 规划字段（#133）：Provider 报告的原生值、工作区显式映射与列表展示事实。
 *
 * 权威链：Provider 只报告原生事实，以 project field id 为键（裁决 R2：同一 option id 会在不同 Project 重复）；core
 * 按工作区映射把状态选项归一到投影的 `planningStatus`——那是唯一的规划状态事实源（不变量 1）；其余角色只取展示事实。
 * 映射没有列出的选项一律不归一，绝不按字段名或选项名猜测。
 */
import type { NormalizedStatus } from './enums.ts'

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
