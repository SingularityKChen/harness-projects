/**
 * @harness-projects/provider-development-github —— GitHub 研发 Provider
 *
 * Responsibility: 实现仓库、分支、提交、变更请求读取与观察，以及原生 PR 单次创建；工作树不在此包。
 * Allowed imports: @harness-projects/domain、@harness-projects/capabilities
 */

export const packageId = '@harness-projects/provider-development-github' as const

export { createGithubDevelopmentProvider, GITHUB_DEVELOPMENT_DEFINITION, type GithubDevelopmentProviderOptions } from './provider.ts'
export type { GraphqlRequest, GraphqlResponse, GraphqlTransport } from './transport.ts'
export { DEVELOPMENT_QUERIES } from './queries.ts'
