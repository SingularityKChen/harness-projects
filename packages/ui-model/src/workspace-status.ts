import { CapabilityKey } from '@harness-projects/client/keys'
import { AccessLevel } from '@harness-projects/domain/values'
import { accessIndex } from './capability-access.ts'
import type { ClientWorkspaceRead, WorkspaceSetupSnapshot, PlanningMappingSnapshot, RepositoryBindingSnapshot } from '@harness-projects/client'
export interface WorkspaceStatusInput {
  readonly setup: WorkspaceSetupSnapshot
  readonly read?: ClientWorkspaceRead | undefined
  readonly mapping?: PlanningMappingSnapshot | undefined
  readonly repository?: RepositoryBindingSnapshot | undefined
  /** 仅表示呈现期间观察到 workspace 换代，不赋予仓库操作任何 workspace 归属。 */
  readonly repositoryFromEarlierWorkspace?: boolean | undefined
}
/** 已有读数的安全观察；不决定权限、不枚举实体、不回显 Provider reason。 */
export function workspaceSourceObservation(read: ClientWorkspaceRead | undefined) {
  if (!read) return '读取状态未知'
  if (!read.connection.connected) return '最后已知值'
  const access = accessIndex(read.capabilities ?? []).get(CapabilityKey.PlanningItemRead)
  return access === undefined ? '读取状态未知' : access === AccessLevel.Unavailable ? '读取不可用'
    : read.reason !== undefined || access === AccessLevel.Degraded ? '读取不完整'
    : read.lastUpdatedAt === undefined ? '读取状态未知' : '当前读取已确认'
}
const unknown = (code: string | undefined): boolean => code === 'result_unknown' || code === 'ambiguous_result'
/** 只投影现有事实；连接、Planning 与未决操作互不代替，不读取浏览器时钟或原始错误。 */
export function deriveWorkspaceStatus({ setup: snapshot, read, mapping, repository, repositoryFromEarlierWorkspace }: WorkspaceStatusInput) {
  const setup = snapshot.setup, workspace = setup?.workspace
  const sameWorkspace = workspace != null && read?.workspace.id === workspace.id
  const matched = sameWorkspace && setup?.planning.bindingId !== undefined && read?.planningSource?.bindingId === setup.planning.bindingId
  const transport = !sameWorkspace ? '连接状态未知' : read?.connection.connected ? '已连接' : '连接中断'
  const sourceObservation = matched ? workspaceSourceObservation(read) : '读取状态未知'
  const state = setup?.planning.state
  const planning = state === 'unbound' ? '未绑定' : state === 'configured' ? '配置已记录，待确认' : state === 'degraded' ? '读取不完整'
    : state === 'confirmed' ? transport === '连接中断' ? '最后已知已确认' : '已确认' : '规划状态未知'
  const operations: string[] = [], setupError = snapshot.error ?? setup?.activationError ?? setup?.error
  if (snapshot.pending) operations.push('工作区设置正在处理')
  else if (setupError) operations.push(unknown(setupError.code) ? '工作区设置结果未知，请重新读取确认' : '工作区设置未完成')
  if (workspace && setup?.planning.bindingId && setup.planning.projectNodeId && mapping?.scope?.workspaceId === workspace.id
    && mapping.scope.bindingId === setup.planning.bindingId && mapping.scope.projectExternalId === setup.planning.projectNodeId) {
    const fact = mapping.pending ? '正在处理' : mapping.intentState === 'local_only' ? '配置已记录，待确认' : mapping.intentState === 'unknown' ? '结果未知，请重新读取确认' : mapping.error ? '未完成' : undefined
    if (fact) operations.push(`字段映射${fact}`)
  }
  if (repository) {
    const fact = repository.state === 'pending' ? '正在处理' : unknown(repository.error?.code) ? '结果未知，请重新读取确认'
      : repository.state === 'configured' ? '配置已记录，待确认' : repository.state === 'failed' ? '未完成' : undefined
    if (fact) operations.push(`${repositoryFromEarlierWorkspace ? '先前' : ''}仓库操作${fact}`)
  }
  return { workspace: workspace === undefined ? '工作区状态未知' : workspace === null ? '尚未创建工作区' : workspace.name,
    planning, transport, sourceObservation, source: matched ? read!.planningSource!.name : '当前来源观测未知', confirmedAt: matched ? read?.reconciledAt : undefined, operations }
}
