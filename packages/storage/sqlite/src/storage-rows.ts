/** SQLite 行 → 端口记录的映射：列名是 snake_case，端口字段是 camelCase，本模块是两者之间唯一的翻译层（换列名只改这里，改一处）。 */
import type { CapabilityDomain, ExecutionContextRecord, ExecutionRunRecord, FieldValueRecord, MembershipRecord, MutationAttemptRecord, ProviderBindingRecord, ReconcileCursorRecord, RepositoryRecord, SyncCursorRecord, SyncState, WorkspaceRecord } from '@harness-projects/capabilities'
import type { EntityId, ExecutionContextId, ExecutionContextStatus, ExecutionRunId, ExecutionRunStatus, ExternalIdentity, ExternalIdentityId, IdentityRole, MembershipContentKind,
  NormalizedStatus, PlanningContent, ProjectErrorCode, ProviderBindingId, RedactionReason, Relation, RelationClass, RelationSource, RelationState, RelationType, StatusPolicy,
  WorkspaceId, WorkspaceProjection, WriteState } from '@harness-projects/domain'

export type Row = Record<string, unknown>

const text = (row: Row, column: string): string => row[column] as string
/** 可空列 → 端口里的 `undefined`：端口用 `undefined` 表示"没有这个值"，SQLite 用 NULL，两者不得混用。 */
const optionalText = (row: Row, column: string): string | undefined => (row[column] as string | null) ?? undefined
const flag = (row: Row, column: string): boolean => row[column] === 1
export const toFlag = (value: boolean): number => (value ? 1 : 0)

/** 单行读的统一形状：`get()` 的 `undefined` 原样传回（与端口一致），有行才走映射——三个面共用，不各写一份三目。 */
export const optional = <T>(row: unknown, map: (row: Row) => T): T | undefined => (row === undefined ? undefined : map(row as Row))

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

// 同步面（Batch L5）的四张映射表。成员关系的两个时间戳可空；游标的 cursor_value / last_error_code 可空（端口用 undefined）。
export const rowToMembership = (row: Row): MembershipRecord => ({ workspaceId: text(row, 'workspace_id') as WorkspaceId,
  projectExternalId: text(row, 'project_external_id'), itemExternalId: text(row, 'item_external_id'),
  contentKind: text(row, 'content_external_kind') as MembershipContentKind, contentExternalId: text(row, 'content_external_id'),
  membershipCreatedAt: optionalText(row, 'membership_created_at'), membershipUpdatedAt: optionalText(row, 'membership_updated_at') })

export const rowToFieldValue = (row: Row): FieldValueRecord => ({ workspaceId: text(row, 'workspace_id') as WorkspaceId,
  itemExternalId: text(row, 'item_external_id'), projectFieldId: text(row, 'project_field_id'), value: text(row, 'value'),
  observedAt: text(row, 'observed_at') })

export const rowToSyncCursor = (row: Row): SyncCursorRecord => ({ bindingId: text(row, 'binding_id') as ProviderBindingId,
  scopeKey: text(row, 'scope_key'), cursorValue: optionalText(row, 'cursor_value'), state: text(row, 'state') as SyncState,
  lastErrorCode: optionalText(row, 'last_error_code') })

export const rowToReconcileCursor = (row: Row): ReconcileCursorRecord => ({ workspaceId: text(row, 'workspace_id') as WorkspaceId,
  lastReconciledAt: text(row, 'last_reconciled_at') })

// 执行面（Batch L6）的四张映射表。执行上下文的两个外部 id 与认领时刻可空（端口用 undefined），执行运行的
// `updated_at` 是 NOT NULL；两张关系表的列名相同，读回形状只有一份（路由由 `state` 决定，见 storage-execution.ts）；
// 写尝试的 `expected_source_version` / `error_code` 可空，端口同样用 undefined。
export const rowToExecutionContext = (row: Row): ExecutionContextRecord => ({ id: text(row, 'id') as ExecutionContextId,
  workspaceId: text(row, 'workspace_id') as WorkspaceId, workItemId: text(row, 'work_item_id') as EntityId,
  repositoryId: text(row, 'repository_id') as EntityId, status: text(row, 'status') as ExecutionContextStatus,
  branchExternalId: optionalText(row, 'branch_external_id'), worktreeExternalId: optionalText(row, 'worktree_external_id'),
  provisioningStartedAt: optionalText(row, 'provisioning_started_at') })

export const rowToExecutionRun = (row: Row): ExecutionRunRecord => {
  const providerRefJson = optionalText(row, 'provider_ref_json')
  return { id: text(row, 'id') as ExecutionRunId,
    workspaceId: text(row, 'workspace_id') as WorkspaceId, contextId: text(row, 'context_id') as ExecutionContextId,
    status: text(row, 'status') as ExecutionRunStatus, updatedAt: text(row, 'updated_at'),
    ...(providerRefJson === undefined ? {} : { providerRef: JSON.parse(providerRefJson) }) }
}

export const rowToRelation = (row: Row): Relation => ({ from: text(row, 'from_entity_id') as EntityId,
  to: text(row, 'to_entity_id') as EntityId, type: text(row, 'relation_type') as RelationType,
  class: text(row, 'relation_class') as RelationClass, source: text(row, 'source') as RelationSource,
  state: text(row, 'state') as RelationState })

export const rowToMutationAttempt = (row: Row): MutationAttemptRecord => ({ id: text(row, 'id'),
  workspaceId: text(row, 'workspace_id') as WorkspaceId, bindingId: text(row, 'binding_id') as ProviderBindingId,
  commandName: text(row, 'command_name'), idempotencyKey: text(row, 'idempotency_key'), state: text(row, 'state') as WriteState,
  expectedSourceVersion: optionalText(row, 'expected_source_version'), errorCode: optionalText(row, 'error_code') as ProjectErrorCode | undefined })

/** 内容三态 → 列值，列顺序与 INSERT 的列清单一致；redacted 没有标题（表级 CHECK 保证）。 */
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
