import type { WorkspaceSetupSnapshot } from '@harness-projects/client'
import type { Recovery } from '@harness-projects/domain'
const recovery: Record<Recovery, { readonly label: string; readonly action?: 'retry' | 'refresh' | 'reapply' }> = {
  retry: { label: '重试', action: 'retry' }, refresh: { label: '重新读取', action: 'refresh' }, reapply: { label: '重新应用', action: 'reapply' },
  open_provider: { label: '前往来源平台检查项目' }, fix_permission: { label: '请在宿主检查访问授权' }, manual_execution: { label: '请联系管理员人工处理' }, none: { label: '请检查输入' },
}
export function workspaceSetupView(snapshot: WorkspaceSetupSnapshot, providerLabel = '来源平台') {
  const { setup } = snapshot, original = snapshot.error ?? setup?.activationError ?? setup?.error
  const messages = { credential_rejected: `${providerLabel} 拒绝了当前凭据，请在宿主检查或更新凭据。`, permission_missing: `${providerLabel} 明确报告所需权限不足，请在宿主补充授权。`, target_unavailable: `项目不存在或当前授权不可见，请在 ${providerLabel} 核对项目标识与访问范围。` }
  const cause = snapshot.connectionFailure?.cause
  const error = original ? { ...original, message: cause ? messages[cause] : original.code === 'permission_denied' ? '当前访问被拒绝，请在宿主检查访问授权。' : original.message } : undefined
  return { error, recovery: error ? recovery[error.recovery] : undefined,
    notice: setup?.activationError ? '配置已记录，激活失败' : setup?.planning.state === 'configured' ? '配置已记录，正在读取项目' : setup?.planning.state === 'degraded' ? '项目读取不完整' : undefined }
}
