/**
 * @harness-projects/ui-model —— 领域对象到展示结构的转换
 *
 * Responsibility: 把客户端领域对象转换为页面展示结构（项目首页、工作项列表、统一详情）与能力驱动的动作可用性；不含组件、不访问外部平台。
 * Allowed imports: @harness-projects/domain、@harness-projects/client
 */

export const packageId = '@harness-projects/ui-model' as const

export * from './types.ts'
export * from './capability-access.ts'
export * from './derive.ts'
