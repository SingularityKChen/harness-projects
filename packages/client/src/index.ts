/**
 * @harness-projects/client —— React-free 客户端模型
 *
 * Responsibility: 稳定对象身份、快照与增量、命令与连接恢复；不得依赖 React。
 * Allowed imports: @harness-projects/domain、@harness-projects/controller
 */
export const packageId = '@harness-projects/client' as const
export * from './store.ts'
export * from './transport.ts'
export * from './sync.ts'
