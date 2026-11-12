import type { WorkspaceSetupSnapshot } from '@harness-projects/client'
import type { ProjectErrorCode, Recovery } from '@harness-projects/domain'
const recovery: Record<Recovery, { readonly label: string; readonly action?: 'retry' | 'refresh' | 'reapply' }> = {
  retry: { label: '重试', action: 'retry' }, refresh: { label: '重新读取', action: 'refresh' }, reapply: { label: '重新应用', action: 'reapply' },
  open_provider: { label: '前往来源平台检查项目' }, fix_permission: { label: '请在宿主检查访问授权' }, manual_execution: { label: '请联系管理员人工处理' }, none: { label: '请检查输入' },
}
const guidance: Record<ProjectErrorCode, string> = {
  invalid_input: '输入未通过检查，请修改后再次提交。',
  permission_denied: '当前访问被拒绝，请在宿主检查访问授权。',
  not_found: '项目不存在或当前授权不可见，请核对项目标识与访问范围。',
  not_supported: '当前宿主不支持此设置操作，请查看恢复说明。',
  conflict: '设置已发生变化，请核对当前设置后重新应用。',
  stale_revision: '设置版本已更新，请核对当前设置后重新应用。',
  rate_limited: '请求受到速率限制，请稍后重试。',
  offline: '当前无法连接宿主或来源，请恢复连接后重试。',
  unavailable: '暂时无法完成此操作，请检查宿主中 Harness Projects 插件的启动状态后重试。',
  ambiguous_result: '结果未知，请重新读取设置确认。',
  result_unknown: '结果未知，请重新读取设置确认。',
}
export function workspaceSetupView(snapshot: WorkspaceSetupSnapshot, providerLabel = '来源平台') {
  const { setup } = snapshot, original = snapshot.error ?? setup?.activationError ?? setup?.error
  const messages = { credential_rejected: `${providerLabel} 拒绝了当前凭据，请在宿主检查或更新凭据。`, permission_missing: `${providerLabel} 明确报告所需权限不足，请在宿主补充授权。`, target_unavailable: `项目不存在或当前授权不可见，请在 ${providerLabel} 核对项目标识与访问范围。` }
  const cause = snapshot.connectionFailure?.cause, readFailed = snapshot.failure === 'read'
  const readGuidance = setup === undefined
    ? '尚未读取到宿主设置，无法确认是否已有工作区。请检查宿主中 Harness Projects 插件的启动错误，处理后重新读取。'
    : '未能读取最新工作区设置，当前状态尚未重新确认。请检查宿主启动状态，处理后重新读取。'
  const error = original ? { ...original, message: cause ? messages[cause] : readFailed ? readGuidance : guidance[original.code] } : undefined
  return { error, errorTitle: readFailed ? '无法读取工作区设置' : '工作区设置未完成',
    recovery: error ? readFailed || snapshot.failure === 'install' && error.code === 'result_unknown' ? { label: '重新读取设置', action: 'refresh' as const } : recovery[error.recovery] : undefined,
    notice: readFailed ? undefined : setup?.activationError ? '配置已记录，激活失败' : setup?.planning.state === 'configured' ? '配置已记录，正在读取项目' : setup?.planning.state === 'degraded' ? '项目读取不完整' : undefined }
}
