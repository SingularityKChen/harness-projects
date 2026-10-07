/**
 * 规划字段的跨层领域值（#133）：平台原生值 + 工作区显式映射 + 已确认展示投影。
 *
 * 事实分层（AGENTS.md §1.1 不变量 5 与 7）：Provider 只报告**原生事实**，Host（core）按显式映射把这
 * 些事实投影成列表可消费的 `PlanningFieldsSnapshot`；投影是可重算的展示结构，不是第二个 Planning
 * 权威源。映射按 `(binding, project)` 定位，不按字段名称猜测角色。
 */
import type { NormalizedStatus } from './enums.ts'
import type { ProviderBindingId } from './ids.ts'

/**
 * 平台原生字段值，以 project field id 为键。三个已实现读取的 kind 才带形状：
 * 单选项保留 optionId 与平台展示名（未映射时 nativeName 原样透出）；迭代保留 title 与 date-only 起始日、
 * 工期天数，不把迭代末日冒充目标日期；日期只保留严格 `YYYY-MM-DD` 的字符串，缺失为 null。
 */
export type NativePlanningFieldValue =
  | { readonly kind: 'single_select'; readonly optionId: string; readonly name: string | null }
  | { readonly kind: 'iteration'; readonly iterationId: string; readonly title: string; readonly startDate: string; readonly durationDays: number }
  | { readonly kind: 'date'; readonly date: string | null }

/**
 * 工作区对某个 project 的字段角色映射：由 Host 显式给出，不依赖 Status / Iteration / Target Date 名称发现。
 * `status` 的角色是「哪个字段承载规范状态」以及「每个原生 optionId 映射成哪个 NormalizedStatus」，
 * 未列出的 optionId 一律 native_only。
 */
export interface WorkspacePlanningFieldMapping {
  readonly bindingId: ProviderBindingId
  readonly projectExternalId: string
  readonly status?: { readonly projectFieldId: string; readonly options: Readonly<Record<string, NormalizedStatus>> }
  readonly iterationFieldId?: string
  readonly targetDateFieldId?: string
}

/** 状态展示三态：mapped 显示规范状态；native_only 只显示原生名与「未映射」；unset 表示该角色不可用。 */
export type PlanningStatusSnapshot =
  | { readonly kind: 'mapped'; readonly nativeName: string | null; readonly normalized: NormalizedStatus }
  | { readonly kind: 'native_only'; readonly nativeName: string | null; readonly normalized?: never }
  | { readonly kind: 'unset' }

/**
 * 已确认的字段展示投影：随 `WorkspaceProjection` 在同一 Storage transaction 确认。iteration / targetDate
 * 缺省表示「这次读取确认没有该值」，不是「尚未确认」。
 */
export interface PlanningFieldsSnapshot {
  readonly status: PlanningStatusSnapshot
  readonly iteration?: { readonly title: string; readonly startDate: string; readonly durationDays: number }
  readonly targetDate?: string
}
