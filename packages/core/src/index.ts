/**
 * @harness-projects/core —— 应用核心：工作空间、策略、关系图与投影
 *
 * Responsibility: 工作空间生命周期、Provider 组合、状态策略、关系图与工程投影；不依赖任何具体 Provider。
 * Allowed imports: @harness-projects/domain、@harness-projects/capabilities
 */
export const packageId = '@harness-projects/core' as const
export * from './context.ts'
export * from './registry.ts'
export * from './capabilities.ts'
export * from './identity.ts'
export * from './projection.ts'
export * from './bootstrap.ts'
export * from './queries.ts'
