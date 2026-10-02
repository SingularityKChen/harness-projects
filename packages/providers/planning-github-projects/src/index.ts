/**
 * @harness-projects/provider-planning-github-projects —— GitHub Projects 项目规划 Provider
 *
 * Responsibility: 实现 Planning 能力契约：项目条目分页、内容联合类型、字段映射与外部身份解析。
 * Allowed imports: @harness-projects/domain、@harness-projects/capabilities
 */

export const packageId = '@harness-projects/provider-planning-github-projects' as const

export { createGithubProjectsPlanningProvider, GITHUB_PROJECTS_PROVIDER_DEFINITION, type GithubProjectsPlanningProviderOptions } from './provider.ts'
export type { GraphqlRequest, GraphqlResponse, GraphqlTransport } from './transport.ts'
export { PLANNING_QUERIES } from './queries.ts'
