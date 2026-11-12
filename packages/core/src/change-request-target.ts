import type { ChangeRequestExternalIntent, OriginalChangeRequestReceipt, ExecutionContextRecord } from '@harness-projects/capabilities'

/** 当前操作目标只取现有 context/intent；不依赖刷新或命令模块。 */
export const matchesPrTarget = (workspace: string, scope: { readonly workItemId: string; readonly repositoryId: string | undefined }, record: ExecutionContextRecord | undefined, intent: ChangeRequestExternalIntent | OriginalChangeRequestReceipt) =>
  record?.workspaceId === workspace && record.id === intent.contextId && record.workItemId === scope.workItemId && record.repositoryId === scope.repositoryId
    && record.provisioningGeneration === intent.ownerGeneration && record.branchExternalId === intent.input.head && record.worktreeExternalId === intent.worktree
