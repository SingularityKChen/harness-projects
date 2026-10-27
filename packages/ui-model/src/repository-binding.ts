import type { RepositoryBindingSnapshot } from '@harness-projects/client'
export function repositoryBindingView(snapshot: RepositoryBindingSnapshot) {
  const recovery = snapshot.error?.recovery
  return { notice: snapshot.state === 'active' ? '仓库已连接' : snapshot.state === 'configured' ? snapshot.activationBlocked ? '配置已记录，仓库能力尚未就绪；请检查本地路径、授权及输出目录，修复后重启宿主再重试' : '配置已记录，尚未确认激活' : snapshot.state === 'pending' ? '正在验证并绑定仓库' : undefined,
    recovery: recovery === 'fix_permission' ? '请在宿主补充授权' : recovery === 'open_provider' ? '请检查 来源仓库是否可见' : recovery === 'manual_execution' ? '请联系管理员检查宿主' : recovery === 'none' ? '请检查本地路径及仓库名称' : '请重试以读取并恢复绑定' }
}
