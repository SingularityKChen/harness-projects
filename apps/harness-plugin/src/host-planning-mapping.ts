import type { PlanningProvider, Storage } from '@harness-projects/capabilities'
import type { PlanningMappingDTO } from '@harness-projects/client'
import { planningFieldMappingSnapshot, projectError, ProjectErrorCode, type WorkspaceId, type WorkspacePlanningFieldMapping } from '@harness-projects/domain'
/** 每代装配捕获经 lifetime 包装的 read port；调用者负责 lease/configure 准入。 */
export function createHostPlanningMapping(storage: Storage, workspaceId: WorkspaceId, planning: PlanningProvider | undefined) {
  const load = async (): Promise<PlanningMappingDTO> => {
    const mount = (await storage.listProviderBindings(workspaceId)).find((item) => item.enabled && item.domain === 'planning')
    const configuration = mount && await storage.getBindingConfiguration({ workspaceId, bindingId: mount.id, domain: 'planning' })
    const projectExternalId = configuration?.configuration.projectNodeId
    if (!planning || !mount || typeof projectExternalId !== 'string' || !projectExternalId) throw new Error('规划来源尚未配置')
    const result = await planning.listFieldDefinitions({ bindingId: mount.id, externalId: projectExternalId, objectKind: 'project', url: undefined })
    if (!result.ok) throw new Error('规划定义尚未确认')
    const record = await storage.getWorkspacePlanningMapping(workspaceId)
    const matches = record?.bindingId === mount.id && record.projectExternalId === projectExternalId
    return { scope: { workspaceId, bindingId: mount.id, projectExternalId }, mapping: matches ? record.mapping : {}, ...(matches ? { origin: record.origin } : {}), confirmed: false,
      fields: result.value.map((field) => ({ id: field.id, name: field.name, kind: field.kind, ...(field.kind === 'single_select' ? { options: field.options.map(({ id, name }) => ({ id, name })) } : {}) })) }
  }
  return { load, validate: async (bindingId: string, projectExternalId: string, raw: WorkspacePlanningFieldMapping) => {
    let mapping: WorkspacePlanningFieldMapping
    try { mapping = planningFieldMappingSnapshot(raw) } catch { return projectError(ProjectErrorCode.InvalidInput, '字段映射不合契约') }
    const dto = await load()
    if (dto.scope.bindingId !== bindingId || dto.scope.projectExternalId !== projectExternalId) return projectError(ProjectErrorCode.Conflict, '规划来源已改变，请重新读取')
    const status = dto.fields.find((field) => field.id === mapping.status?.projectFieldId)
    if ((mapping.status && (status?.kind !== 'single_select' || Object.keys(mapping.status.options).some((id) => !status.options?.some((option) => option.id === id))))
      || (mapping.iterationFieldId !== undefined && !dto.fields.some((field) => field.id === mapping.iterationFieldId && field.kind === 'iteration'))
      || (mapping.targetDateFieldId !== undefined && !dto.fields.some((field) => field.id === mapping.targetDateFieldId && field.kind === 'date'))) return projectError(ProjectErrorCode.InvalidInput, '请选择当前定义中的字段与选项')
    return undefined
  } }
}
