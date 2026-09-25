import type { CapabilityDomain, ProviderBindingRecord, RepositoryRecord, WorkspaceRecord } from '@harness-projects/capabilities'
import type { EntityId, ExternalIdentity, ExternalIdentityId, IdentityRole, NormalizedStatus, PlanningContent, ProviderBindingId,
  RedactionReason, StatusPolicy, WorkspaceId, WorkspaceProjection } from '@harness-projects/domain'

export type Row = Record<string, unknown>

const text = (row: Row, column: string): string => row[column] as string
const flag = (row: Row, column: string): boolean => row[column] === 1
export const toFlag = (value: boolean): number => (value ? 1 : 0)

export const rowToWorkspace = (row: Row): WorkspaceRecord => ({ id: text(row, 'id') as WorkspaceId,
  name: text(row, 'name'), statusPolicy: text(row, 'status_policy') as StatusPolicy })

export const rowToBinding = (row: Row): ProviderBindingRecord => ({ id: text(row, 'id') as ProviderBindingId,
  workspaceId: text(row, 'workspace_id') as WorkspaceId, domain: text(row, 'domain') as CapabilityDomain,
  implementationKey: text(row, 'implementation_key'), enabled: flag(row, 'enabled'), isDefault: flag(row, 'is_default') })

export const rowToIdentity = (row: Row): ExternalIdentity => ({ id: text(row, 'id') as ExternalIdentityId,
  entityId: text(row, 'entity_id') as EntityId, bindingId: text(row, 'binding_id') as ProviderBindingId,
  externalKind: text(row, 'external_kind') as ExternalIdentity['externalKind'], externalId: text(row, 'external_id'),
  role: text(row, 'role') as IdentityRole })

export const rowToRepository = (row: Row): RepositoryRecord => ({ id: text(row, 'id') as EntityId,
  workspaceId: text(row, 'workspace_id') as WorkspaceId, externalIdentityId: text(row, 'external_identity_id') as ExternalIdentityId })

export function contentColumns(content: PlanningContent): readonly [string, string | null, string | null, number | null, string | null] {
  if (content.contentKind === 'redacted') return [content.contentKind, null, null, null, content.reason]
  if (content.contentKind === 'change_request') return [content.contentKind, content.title, content.body, content.number, null]
  return [content.contentKind, content.title, content.body, null, null]
}

function rowToContent(row: Row): PlanningContent {
  const kind = text(row, 'content_kind')
  if (kind === 'redacted') return { contentKind: 'redacted', reason: text(row, 'redaction_reason') as RedactionReason }
  if (kind === 'change_request') return { contentKind: 'change_request', number: row['content_number'] as number, title: text(row, 'content_title'), body: text(row, 'content_body') }
  return { contentKind: 'work_item', title: text(row, 'content_title'), body: text(row, 'content_body') }
}

export const rowToProjection = (row: Row): WorkspaceProjection => ({ workspaceId: text(row, 'workspace_id') as WorkspaceId,
  entityId: text(row, 'entity_id') as EntityId, planningStatus: text(row, 'planning_status') as NormalizedStatus,
  revision: row['revision'] as number, content: rowToContent(row) })
