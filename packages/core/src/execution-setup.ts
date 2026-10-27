import type { Storage } from '@harness-projects/capabilities'
import { ProjectErrorCode, newProviderBindingId, type ProviderBindingId, type WorkspaceId } from '@harness-projects/domain'
import { assertClosed, readMountTarget, refuse, runSetup, sameMountTarget, writeMount } from './workspace-setup.ts'

export interface InstallExecutionRequest { readonly workspaceId: WorkspaceId }
export interface ExecutionBindingPair { readonly bindingIds: readonly [ProviderBindingId, ProviderBindingId] }
const roles = [{ implementationKey: 'execution.harness', isDefault: true }, { implementationKey: 'execution.human', isDefault: false }] as const

/** 显式安装才创建；现存 pair 按角色验证，disabled、自定义或残缺挂载一律保留并拒绝。 */
export function createExecutionSetup(storage: Storage) {
  return { installExecutionBindings: (request: InstallExecutionRequest) => runSetup(storage, async (tx): Promise<ExecutionBindingPair> => {
    assertClosed(request, ['workspaceId'])
    if (typeof request.workspaceId !== 'string' || !request.workspaceId.trim()) refuse(ProjectErrorCode.InvalidInput, '工作区 id 必须是非空字符串')
    if (await tx.getWorkspace(request.workspaceId) === undefined) refuse(ProjectErrorCode.NotFound, '工作区不存在')
    const existing = (await tx.listProviderBindings(request.workspaceId)).filter((mount) => mount.domain === 'execution')
    const ids: ProviderBindingId[] = []
    for (const role of roles) {
      const target = { implementationKey: role.implementationKey, accountId: undefined, configuration: {} }
      if (existing.length) {
        const matches = existing.filter((mount) => mount.isDefault === role.isDefault)
        const mount = matches[0]
        if (existing.length !== 2 || matches.length !== 1 || mount === undefined || !mount.enabled || !sameMountTarget(await readMountTarget(tx, mount), target)) refuse(ProjectErrorCode.Conflict, '已有执行挂载与安装目标冲突')
        ids.push(mount.id)
      } else {
        const id = newProviderBindingId()
        await writeMount(tx, { id, workspaceId: request.workspaceId, domain: 'execution', enabled: true, isDefault: role.isDefault }, target)
        ids.push(id)
      }
    }
    return { bindingIds: ids as [ProviderBindingId, ProviderBindingId] }
  }) }
}
