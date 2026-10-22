import type { ExecutionContextDTO } from '@harness-projects/client'
import type { ExecutionRunStatus } from '@harness-projects/domain'
const LABELS: Record<ExecutionRunStatus, string> = { queued: '排队中', starting: '正在启动', running: '运行中', succeeded: '已完成', failed: '失败', canceled: '已取消', timed_out: '超时', unknown: '状态未知' }
/** 运行与人工承接是独立事实；不从 context Ready / degraded 推断运行结果。 */
export function executionContextText(context: ExecutionContextDTO) {
  return { path: context.worktreeExternalId ?? '工作树路径尚未提供', branch: context.branchExternalId ?? '分支尚未提供',
    run: context.runStatus === undefined ? '尚无运行记录' : LABELS[context.runStatus],
    manual: context.fallback === 'manual_fallback' ? '人工处理，可在该工作树继续' : undefined }
}
