/**
 * @harness-projects/provider-development-local-git —— 本地 Git 研发 Provider
 *
 * Responsibility: 实现 Development 能力契约的本地子集：仓库识别、分支与工作树的创建，全部经 argv 调用
 * Git；工作树移除不在本层（#137 的 Out of scope，由 #138 交付）。Allowed imports: domain、capabilities。
 */

export const packageId = '@harness-projects/provider-development-local-git' as const

export * from './branch-names.ts'
export * from './git-runner.ts'
export * from './paths.ts'
export * from './provider.ts'
