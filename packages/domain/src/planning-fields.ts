/**
 * Provider 报告的 GitHub Project 原生字段值（#133）。
 *
 * 值以 project field id 为键；Provider 只报告平台事实，不决定字段角色，也不做规范状态映射。
 * Host 侧的字段角色映射与展示投影由后续 stack 层定义。
 */
export type NativePlanningFieldValue =
  | { readonly kind: 'single_select'; readonly optionId: string; readonly name: string | null }
  | { readonly kind: 'iteration'; readonly iterationId: string; readonly title: string; readonly startDate: string; readonly durationDays: number }
  | { readonly kind: 'date'; readonly date: string | null }
