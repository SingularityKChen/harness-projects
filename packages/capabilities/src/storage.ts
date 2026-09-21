/**
 * Storage port：控制事实与投影的持久化边界。
 *
 * 上游只给了 `Storage` 这个名字，没有签名。**以下分组与命名由本批次冻结，不是上游给定的**：
 * 事务 / 工作区与绑定 / 身份 / 规划 / 工程 / 执行 / 关系 / 同步 / 写尝试 / 投影修订号。
 * 方法只读写本地权威控制事实，不做任何外部调用；外部事实必须先由 provider 观察、由 core 写入。
 * 身份记录故意不带 workspaceId（不变量 3）：同一外部对象在两个工作区只有一份身份。
 */
import type {
  Entity,
  EntityId,
  ExecutionContextId,
  ExecutionContextStatus,
  ExecutionRunId,
  ExecutionRunStatus,
  ExternalIdentity,
  ExternalIdentityId,
  ProjectErrorCode,
  ProviderBindingId,
  Relation,
  StatusPolicy,
  WorkspaceId,
  WorkspaceProjection,
  WriteState,
} from '@harness-projects/domain'
import type { CapabilityDomain } from './capability-keys.ts'
import type { ProviderObservation } from './observation.ts'

export interface WorkspaceRecord {
  readonly id: WorkspaceId; readonly name: string; readonly statusPolicy: StatusPolicy
}

/** 一个工作空间同一时刻只能有一个启用的 planning 绑定；putProviderBinding 必须自行保证 isDefault 唯一。 */
export interface ProviderBindingRecord {
  readonly id: ProviderBindingId; readonly workspaceId: WorkspaceId; readonly domain: CapabilityDomain
  readonly implementationKey: string; readonly enabled: boolean; readonly isDefault: boolean
}

export interface RepositoryRecord {
  readonly id: EntityId; readonly workspaceId: WorkspaceId; readonly externalIdentityId: ExternalIdentityId
}

export interface ExecutionContextRecord {
  readonly id: ExecutionContextId; readonly workspaceId: WorkspaceId; readonly workItemId: EntityId
  readonly repositoryId: EntityId; readonly status: ExecutionContextStatus
  readonly branchExternalId: string | undefined; readonly worktreeExternalId: string | undefined
}

export interface ExecutionRunRecord {
  readonly id: ExecutionRunId; readonly workspaceId: WorkspaceId; readonly contextId: ExecutionContextId
  readonly status: ExecutionRunStatus; readonly updatedAt: string
}

export interface MutationAttemptRecord {
  readonly id: string; readonly workspaceId: WorkspaceId; readonly bindingId: ProviderBindingId
  readonly commandName: string; readonly idempotencyKey: string; readonly state: WriteState
  readonly expectedSourceVersion: string | undefined; readonly errorCode: ProjectErrorCode | undefined
}

/** 同步游标状态；degraded 表示还在推进但有失败，failed 表示必须人工介入。 */
export const SyncState = { Idle: 'idle', Syncing: 'syncing', Healthy: 'healthy', Degraded: 'degraded', Failed: 'failed' } as const
export type SyncState = (typeof SyncState)[keyof typeof SyncState]

export interface SyncCursorRecord {
  readonly bindingId: ProviderBindingId; readonly scopeKey: string; readonly cursorValue: string | undefined
  readonly state: SyncState; readonly lastErrorCode: string | undefined
}

/** 观察的处理状态：ignored 表示已按去重规则丢弃，不再进入投影。 */
export const ObservationState = { Pending: 'pending', Processed: 'processed', Ignored: 'ignored', Failed: 'failed' } as const
export type ObservationState = (typeof ObservationState)[keyof typeof ObservationState]

export interface ObservationRecord {
  readonly observation: ProviderObservation; readonly state: ObservationState
}

export interface Storage {
  // ── 事务：一个 transaction 内的写入要么全部生效，要么全部不生效 ──
  transaction<T>(work: (tx: StorageTransaction) => Promise<T>): Promise<T>

  // ── 工作区与绑定 ──
  putWorkspace(record: WorkspaceRecord): Promise<void>
  getWorkspace(id: WorkspaceId): Promise<WorkspaceRecord | undefined>
  putProviderBinding(record: ProviderBindingRecord): Promise<void>
  listProviderBindings(workspaceId: WorkspaceId): Promise<readonly ProviderBindingRecord[]>

  // ── 身份：外部身份全局一份，实体是内在锚点 ──
  putEntity(record: Entity): Promise<void>
  putExternalIdentity(record: ExternalIdentity): Promise<void>
  findExternalIdentity(bindingId: ProviderBindingId, externalKind: string, externalId: string): Promise<ExternalIdentity | undefined>
  listIdentitiesForEntity(entityId: EntityId): Promise<readonly ExternalIdentity[]>

  // ── 规划：投影承载权威归一化状态与三态内容 ──
  putPlanningProjection(workspaceId: WorkspaceId, projection: WorkspaceProjection): Promise<void>
  replacePlanningProjections(scope: { readonly workspaceId: WorkspaceId; readonly bindingId: ProviderBindingId }, items: readonly WorkspaceProjection[]): Promise<void>
  getPlanningProjection(workspaceId: WorkspaceId, entityId: EntityId): Promise<WorkspaceProjection | undefined>
  listPlanningProjections(workspaceId: WorkspaceId): Promise<readonly WorkspaceProjection[]>

  // ── 工程：仓库是可开始工作的前置 ──
  putRepository(record: RepositoryRecord): Promise<void>
  listRepositories(workspaceId: WorkspaceId): Promise<readonly RepositoryRecord[]>

  // ── 执行：同一工作项 + 仓库最多一个 active 上下文（重复开始不得产生第二份） ──
  putExecutionContext(record: ExecutionContextRecord): Promise<void>
  getExecutionContext(id: ExecutionContextId): Promise<ExecutionContextRecord | undefined>
  findActiveExecutionContext(workspaceId: WorkspaceId, workItemId: EntityId, repositoryId: EntityId): Promise<ExecutionContextRecord | undefined>
  putExecutionRun(record: ExecutionRunRecord): Promise<void>
  getExecutionRun(id: ExecutionRunId): Promise<ExecutionRunRecord | undefined>

  // ── 关系：类别与确认态由 domain 规则决定，storage 只如实保存 ──
  putRelation(workspaceId: WorkspaceId, relation: Relation): Promise<void>
  listRelations(workspaceId: WorkspaceId): Promise<readonly Relation[]>

  // ── 同步：dedupe 由 (binding, dedupeKey) 唯一约束实现；重复观察返回 false 且不覆盖 ──
  recordObservation(record: ObservationRecord): Promise<boolean>
  getSyncCursor(bindingId: ProviderBindingId, scopeKey: string): Promise<SyncCursorRecord | undefined>
  putSyncCursor(record: SyncCursorRecord): Promise<void>

  // ── 写尝试：以 (workspace, idempotencyKey) 唯一去重，同键重放返回原结果 ──
  findMutationAttempt(workspaceId: WorkspaceId, idempotencyKey: string): Promise<MutationAttemptRecord | undefined>
  putMutationAttempt(record: MutationAttemptRecord): Promise<void>
  listMutationAttempts(workspaceId: WorkspaceId): Promise<readonly MutationAttemptRecord[]>

  // ── 投影修订号：单调递增；客户端从 afterRevision 续传，发现缺口就重新拉基线 ──
  currentRevision(workspaceId: WorkspaceId): Promise<number>
  advanceRevision(workspaceId: WorkspaceId): Promise<number>
}

/** 事务内的 Storage：不允许嵌套事务，因此去掉 transaction 本身。 */
export type StorageTransaction = Omit<Storage, 'transaction'>
