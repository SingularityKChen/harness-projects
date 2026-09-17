/**
 * @harness-projects/provider-delivery-github-actions —— GitHub Actions 交付 Provider
 *
 * Responsibility: 实现 Delivery 能力契约：只读的流水线运行、检查与环境部署事实；不得反向污染规划状态。
 * Allowed imports: @harness-projects/domain、@harness-projects/capabilities
 */

export const packageId = '@harness-projects/provider-delivery-github-actions' as const
