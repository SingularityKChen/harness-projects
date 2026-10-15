/**
 * @harness-projects/provider-development-github —— GitHub 研发 Provider
 *
 * Responsibility: 实现 Development 能力契约的只读部分（#231）：仓库、分支、提交、按 head 分支读变更请求与观察流；写入与工作树不在此包。
 * Allowed imports: @harness-projects/domain、@harness-projects/capabilities
 */

export const packageId = '@harness-projects/provider-development-github' as const

export { createGithubDevelopmentProvider, GITHUB_DEVELOPMENT_DEFINITION, type GithubDevelopmentProviderOptions } from './provider.ts'
export type { GraphqlRequest, GraphqlResponse, GraphqlTransport } from './transport.ts'
export { DEVELOPMENT_QUERIES } from './queries.ts'
