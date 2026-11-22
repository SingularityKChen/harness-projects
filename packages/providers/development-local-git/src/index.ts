/**
 * @harness-projects/provider-development-local-git —— 本地 Git 研发 Provider
 *
 * Responsibility: 实现 Development 能力契约的本地子集：仓库识别、分支与工作树的创建/读取/显式移除，全部经
 * argv 调用 Git。Allowed imports: domain、capabilities。
 */

export const packageId = '@harness-projects/provider-development-local-git' as const

export * from './branch-names.ts'
export { defaultGitRunner, type GitInvocation, type GitRunner } from './git-runner.ts'
export { localGitPathProblem, resolveWorktreePath, type WorktreePathInput, type WorktreePathRejection, type WorktreePathResolution } from './paths.ts'
export * from './provider.ts'
