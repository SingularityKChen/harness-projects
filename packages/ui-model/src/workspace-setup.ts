import type { WorkspaceSetupSnapshot } from '@harness-projects/client'
import type { Recovery } from '@harness-projects/domain'
const recovery: Record<Recovery, { readonly label: string; readonly action?: 'retry' | 'refresh' | 'reapply' }> = {
  retry: { label: '重试', action: 'retry' }, refresh: { label: '重新读取', action: 'refresh' }, reapply: { label: '重新应用', action: 'reapply' },
  open_provider: { label: '前往来源平台检查项目' }, fix_permission: { label: '请在宿主补充授权' }, manual_execution: { label: '请联系管理员人工处理' }, none: { label: '请检查输入' },
}
export function workspaceSetupView(snapshot: WorkspaceSetupSnapshot) {
  const { setup } = snapshot, error = snapshot.error ?? setup?.activationError ?? setup?.error
  return { error, recovery: error ? recovery[error.recovery] : undefined,
    notice: setup?.activationError ? '配置已记录，激活失败' : setup?.planning.state === 'configured' ? '配置已记录，正在读取项目' : setup?.planning.state === 'degraded' ? '项目读取不完整' : undefined }
}
