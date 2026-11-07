import { createHash } from 'node:crypto'
import { CapabilityKey, ProjectErrorCode, projectError, type ExternalObjectRef, type StorageTransaction, type ChangeRequestIssueSelection, type ProviderIssueLinkTargetInput, type ProviderIssueLinkTarget } from '@harness-projects/capabilities'
import type { EntityId } from '@harness-projects/domain'
import type { CoreContext } from './context.ts'
import { gateBinding } from './capabilities.ts'
import { selectDevelopment } from './development-route.ts'
import { refreshIssueClosingLinks, issueSourceReadAccess, observeIssueTargetRead } from './issue-closing-links.ts'
import { committedFence } from './runtime-access.ts'
export type IssueRelation = ChangeRequestIssueSelection['relation']
export interface ChangeRequestIssueScope { readonly workItemId: string; readonly repositoryId: string; readonly base: string }
export interface ChangeRequestIssueOptions { readonly target?: ProviderIssueLinkTarget; readonly targetStamp?: string; readonly defaultRelation: IssueRelation; readonly relations: readonly IssueRelation[]; readonly reason?: string }
const proofs = new WeakMap<CoreContext, Map<string, { sourceStamp: string; version: string; targetStamp: string }>>()
const address = (scope: { workItemId: string; repositoryId: string }) => JSON.stringify([scope.workItemId, scope.repositoryId])
export const issueTargetStamp = (t: ProviderIssueLinkTarget) => createHash('sha256').update(JSON.stringify(t)).digest('hex')
const key = (r: { bindingId: string; objectKind: string; externalId: string }) => JSON.stringify([r.bindingId, r.objectKind, r.externalId])
const identity = (r: { namespace: string; id: string }) => JSON.stringify([r.namespace, r.id])
async function source(context: CoreContext, workItemId: string, storage: StorageTransaction = context.storage) {
  const access = await context.runtimeAccess.planning(storage), binding = access.binding, project = context.projectRef
  const row = await storage.getPlanningProjection(context.workspaceId, workItemId as EntityId)
  if (access.masked || row?.content.contentKind !== 'work_item' || !binding?.planning?.getIssueLinkTarget || !project || project.bindingId !== binding.ref.bindingId || !gateBinding(binding, CapabilityKey.PlanningItemRead, 'read').allowed) throw new Error('Issue 来源不可用')
  const primary = (await storage.listIdentitiesForEntity(row.entityId)).find(i => i.role === 'primary')
  if (!primary || primary.bindingId !== binding.ref.bindingId || primary.externalKind !== 'issue') throw new Error('不是原生 Issue')
  const member = (await storage.listMemberships(context.workspaceId, project.externalId)).find(m => m.contentKind === 'issue' && m.contentExternalId === primary.externalId)
  if (!member) throw new Error('成员关系不可用')
  const input: ProviderIssueLinkTargetInput = { project: { bindingId: project.bindingId, objectKind: project.objectKind, externalId: project.externalId, url: undefined }, membership: { bindingId: primary.bindingId, objectKind: 'project_item', externalId: member.itemExternalId, url: undefined }, issue: { bindingId: primary.bindingId, objectKind: 'issue', externalId: primary.externalId, url: undefined } }
  return { input, provider: binding.planning, stamp: JSON.stringify([input, member, context.runtimeAccess.epoch]) }
}
export async function getChangeRequestIssueOptions(context: CoreContext, scope: ChangeRequestIssueScope): Promise<ChangeRequestIssueOptions> {
  try {
    const fence = committedFence(context.storage), before = await source(context, scope.workItemId)
    const ticket = issueSourceReadAccess(context, before.input, await before.provider.describeCapabilities())
    if (ticket.denied) throw new Error('来源已知拒读尚未恢复')
    const route = await selectDevelopment(context, scope.repositoryId, CapabilityKey.DevelopmentChangeRequestCreate)
    if (!route.ok || !gateBinding(route.binding, CapabilityKey.DevelopmentRepositoryRead, 'read').allowed) throw new Error('仓库不可用')
    const ack = await before.provider.getIssueLinkTarget!(structuredClone(before.input))
    if (!ack.ok && ['permission_denied', 'not_found'].includes(ack.error.code)) observeIssueTargetRead(context, before.input, true)
    const repo = await route.provider.getRepository(route.repository)
    const after = await source(context, scope.workItemId), access = issueSourceReadAccess(context, after.input, await after.provider.describeCapabilities())
    if (!ack.ok || !repo.ok || fence !== committedFence(context.storage) || before.stamp !== after.stamp || !repo.value.sourceRepositoryIdentity || ticket.version !== access.version || access.denied) throw new Error('来源未回证')
    const t = ack.value
    if (['project', 'membership', 'issue'].some(k => key(t.source[k as keyof typeof t.source]) !== key(before.input[k as keyof typeof before.input]))
      || typeof t.nativeIssueIdentity.namespace !== 'string' || !t.nativeIssueIdentity.namespace.trim() || t.nativeIssueIdentity.id !== before.input.issue.externalId || !Number.isSafeInteger(t.number) || t.number < 1
      || key(repo.value.ref) !== key(route.repository) || identity(t.repository.identity) !== identity(repo.value.sourceRepositoryIdentity) || !/^[\w.-]+\/[\w.-]+$/.test(t.repository.name)) throw new Error('目标身份不符')
    observeIssueTargetRead(context, after.input, false, ticket.version)
    let receipts = proofs.get(context); if (!receipts) { receipts = new Map(); proofs.set(context, receipts) }
    receipts.set(address(scope), { sourceStamp: after.stamp, version: access.version, targetStamp: issueTargetStamp(t) })
    while (receipts.size > 100) receipts.delete(receipts.keys().next().value!)
    return { target: structuredClone(t), targetStamp: issueTargetStamp(t), defaultRelation: 'reference', relations: scope.base === repo.value.defaultBranch ? ['reference', 'closing', 'none'] : ['reference', 'none'], ...(scope.base === repo.value.defaultBranch ? {} : { reason: '合并关闭仅适用于仓库默认分支' }) }
  } catch { proofs.get(context)?.delete(address(scope)); return { defaultRelation: 'none', relations: ['none'], reason: '当前来源或仓库不可验证，可选择不关联 Issue' } }
}
export async function assertChangeRequestIssueSource(context: CoreContext, workItemId: string, selection: ChangeRequestIssueSelection) {
  if (selection.relation === 'none') return
  const current = await source(context, workItemId)
  if (['project', 'membership', 'issue'].some(k => key(current.input[k as keyof typeof current.input]) !== key(selection.target.source[k as keyof typeof current.input]))) throw projectError(ProjectErrorCode.Conflict, '当前 Issue 来源已变化；原请求只能显式恢复')
}
export async function visibleChangeRequestIssue(context: CoreContext, scope: { workItemId: string; repositoryId: string }, selection: ChangeRequestIssueSelection, storage: StorageTransaction = context.storage): Promise<boolean> {
  if (selection.relation === 'none') return false
  try {
    const current = await source(context, scope.workItemId, storage), access = issueSourceReadAccess(context, current.input), proof = proofs.get(context)?.get(address(scope))
    return !access.denied && !access.missing && proof?.version === access.version && proof.sourceStamp === current.stamp && proof.targetStamp === issueTargetStamp(selection.target)
  } catch { return false }
}
export async function selectChangeRequestIssue(context: CoreContext, scope: ChangeRequestIssueScope, relation?: IssueRelation): Promise<ChangeRequestIssueSelection> {
  if (relation === 'none') return { relation }
  const options = await getChangeRequestIssueOptions(context, scope), selected = relation ?? options.defaultRelation
  if (!options.relations.includes(selected)) throw projectError(ProjectErrorCode.InvalidInput, options.reason ?? 'Issue 关联不可用')
  return selected === 'none' ? { relation: selected } : { relation: selected, target: options.target! }
}
export const issueClause = (s: ChangeRequestIssueSelection) => s.relation === 'none' ? '' : `\n${s.relation === 'closing' ? 'Closes' : 'Refs'} ${s.target.repository.name}#${s.target.number}`
export async function verifyChangeRequestIssue(context: CoreContext, scope: ChangeRequestIssueScope, selected: ChangeRequestIssueSelection) {
  if (selected.relation !== 'none' && JSON.stringify(await selectChangeRequestIssue(context, scope, selected.relation)) !== JSON.stringify(selected)) throw projectError(ProjectErrorCode.Conflict, 'Issue 来源或权限已变化')
}
export async function confirmChangeRequestIssue(context: CoreContext, workItemId: string, repositoryId: string, selected: ChangeRequestIssueSelection, ref: ExternalObjectRef): Promise<'none' | 'confirmed' | 'denied' | 'unknown'> {
  if (selected.relation === 'none') return 'none'
  try {
    const current = await source(context, workItemId)
    if (['project', 'membership', 'issue'].some(k => key(current.input[k as keyof typeof current.input]) !== key(selected.target.source[k as keyof typeof current.input]))) return 'unknown'
    const view = await refreshIssueClosingLinks(context, { workItemId })
    if (view.state === 'denied') return 'denied'
    if (view.state !== 'complete' && view.state !== 'partial') return 'unknown'
    if ((await source(context, workItemId)).stamp !== current.stamp) return 'unknown'
    const kind = selected.relation === 'reference' ? 'native_reference' : 'native_closing'
    if (view.coverage[kind].stale) return 'unknown'
    return view.links.some(l => l.repositoryId === repositoryId && l.bindingId === ref.bindingId && l.externalId === ref.externalId && l.repositoryName === selected.target.repository.name && l.relations.includes(selected.relation === 'reference' ? 'native_reference' : 'native_closing')) ? 'confirmed' : 'unknown'
  } catch { return 'unknown' }
}
