import { isDeepStrictEqual } from 'node:util'
import type { Storage } from '@harness-projects/capabilities'
import { planningFieldMappingSnapshot, ProjectErrorCode, type WorkspaceId, type WorkspacePlanningFieldMapping } from '@harness-projects/domain'
import { assertClosed, refuse, runSetup } from './workspace-setup.ts'
export interface SetPlanningMappingRequest {
  readonly workspaceId: WorkspaceId
  readonly expectedBindingId: string
  readonly expectedProjectExternalId: string
  readonly mapping: WorkspacePlanningFieldMapping
}
/** 本地唯一写者：live 定义由 Host 检查，事务再检查 scope，历史记录仍允许孤儿 ID。 */
export function setPlanningMapping(storage: Storage, request: SetPlanningMappingRequest) {
  return runSetup(storage, async (tx) => {
    assertClosed(request, ['workspaceId', 'expectedBindingId', 'expectedProjectExternalId', 'mapping'])
    let mapping: WorkspacePlanningFieldMapping
    try { mapping = planningFieldMappingSnapshot(request.mapping) } catch { refuse(ProjectErrorCode.InvalidInput, '字段映射不合契约') }
    const mount = (await tx.listProviderBindings(request.workspaceId)).find((item) => item.enabled && item.domain === 'planning')
    const configuration = mount && await tx.getBindingConfiguration({ workspaceId: request.workspaceId, bindingId: mount.id, domain: 'planning' })
    if (!mount || mount.id !== request.expectedBindingId || configuration?.configuration.projectNodeId !== request.expectedProjectExternalId) refuse(ProjectErrorCode.Conflict, '规划来源已改变，请重新读取')
    const record = { workspaceId: request.workspaceId, bindingId: mount.id, projectExternalId: request.expectedProjectExternalId, origin: 'user' as const, mapping }
    if (!isDeepStrictEqual(await tx.getWorkspacePlanningMapping(request.workspaceId), record)) await tx.putWorkspacePlanningMapping(record)
    return { bindingId: mount.id }
  })
}
