/**
 *
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
  MembershipContentKind,
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

/**
 * 工作区挂载视图：**一条连接锚点 + 某工作区对它的启用状态**（ADR-0006）。写入语义（两个实现必须一致）：
 * 同一个 `id` 换 `implementationKey` 被拒绝（它是 provider **实现**标识，不是能力域）；同一工作区同一 `domain`
 * 的第二个**启用** planning 挂载被拒绝（不变量 1，issue #27 验收 1 要求由数据库拒绝）；同一工作区同一 `domain`
 * 至多一个启用的默认挂载，写新的默认把同域旧的默认降级；挂载所属的工作区必须已存在（与 002 的外键同语义），否则拒绝且不留行。
 */
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
  /** 认领（Provisioning）开始的时间；终态为 undefined。在途与中断只能靠它区分，见 ExecPlan D3。 */
  readonly provisioningStartedAt: string | undefined
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

/** R5：游标表示某工作区最近一次全量对账完成时刻，不是平台 updated_at 增量游标。 */
export interface ReconcileCursorRecord {
  readonly workspaceId: WorkspaceId
  readonly lastReconciledAt: string
}

/**
 * 成员关系（裁决 R1）：内容对象挂在某工作区某 project 条目上的那一行。同一 `(workspaceId, projectExternalId,
 * contentKind, contentExternalId)` 至多一条；同一内容出现在两个工作区时是**两条**、互不覆盖（行为 1，ADR-0002）。
 */
export interface MembershipRecord {
  readonly workspaceId: WorkspaceId
  readonly projectExternalId: string
  readonly itemExternalId: string
  readonly contentKind: MembershipContentKind
  readonly contentExternalId: string
  readonly membershipCreatedAt: string | undefined
  readonly membershipUpdatedAt: string | undefined
}

/**
 * 规划字段值：**只存平台原样值**，归一化由 core 做（裁决 R2 / R3）；定位键不含可选值 id；不设版本列。
 */
export interface FieldValueRecord {
  readonly workspaceId: WorkspaceId
  readonly itemExternalId: string
  readonly projectFieldId: string
  readonly value: string
  readonly observedAt: string
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
  // 强制面（ADR-0006）：storage 强制「至多一个 primary」与引用完整性（身份必须指向存在的实体与连接锚点，被拒绝的写入不留行）。
  // 「恰好一个」由写入生命周期保证：`putEntity` 必须与 primary 身份在同一事务里写入（core 的 `ensureEntity` 如此），e2e 有断言。
  putEntity(record: Entity): Promise<void>
  putExternalIdentity(record: ExternalIdentity): Promise<void>
  findExternalIdentity(bindingId: ProviderBindingId, externalKind: string, externalId: string): Promise<ExternalIdentity | undefined>
  listIdentitiesForEntity(entityId: EntityId): Promise<readonly ExternalIdentity[]>

  // ── 成员关系与字段值：平台原样事实，storage 只存不推导 ──
  // 冲突规则：同一 (workspaceId, itemExternalId) 幂等覆盖；同 (工作区, 项目, 内容) 的第二次写入取代旧行（须 UPSERT）。
  // 引用完整性是**共有的契约**：指向不存在的父行必须被拒绝，且被拒绝的写入不得留下任何行；`listMemberships` 按 `itemExternalId` 的码点序升序（等价于 SQLite TEXT 的 BINARY/UTF-8 字节序，不是 JS 的 UTF-16 码元序）。
  putMembership(record: MembershipRecord): Promise<void>
  getMembership(workspaceId: WorkspaceId, itemExternalId: string): Promise<MembershipRecord | undefined>
  listMemberships(workspaceId: WorkspaceId, projectExternalId: string): Promise<readonly MembershipRecord[]>
  putFieldValue(record: FieldValueRecord): Promise<void>
  listFieldValues(workspaceId: WorkspaceId, itemExternalId: string): Promise<readonly FieldValueRecord[]>

  // ── 规划：投影承载权威归一化状态与三态内容 ──
  // replace 的实体语义：移除本 scope 的投影但保留实体与身份（实体仍被身份引用，与 002 的外键同语义）。
  putPlanningProjection(workspaceId: WorkspaceId, projection: WorkspaceProjection): Promise<void>
  replacePlanningProjections(scope: { readonly workspaceId: WorkspaceId; readonly bindingId: ProviderBindingId }, items: readonly WorkspaceProjection[]): Promise<void>
  getPlanningProjection(workspaceId: WorkspaceId, entityId: EntityId): Promise<WorkspaceProjection | undefined>
  listPlanningProjections(workspaceId: WorkspaceId): Promise<readonly WorkspaceProjection[]>

  // ── 工程：仓库是可开始工作的前置 ──
  putRepository(record: RepositoryRecord): Promise<void>
  listRepositories(workspaceId: WorkspaceId): Promise<readonly RepositoryRecord[]>

  // ── 执行：同一工作项 + 仓库最多一个 **active** 上下文（重复开始不得产生第二份） ──
  //
  // `active` 的判据是**状态不是终态**：`Closed` 与 `Failed` 都不是 active，因此它们不挡下一次开始
  // （`startWork` 的 `claimContext` 会接管它们并覆写**同一条**记录——`contextIdFor` 是确定性的，
  // 所以「不得产生第二份」比删除重建更强地成立）。`findActiveExecutionContext` 回答的就是这个问题。
  putExecutionContext(record: ExecutionContextRecord): Promise<void>
  getExecutionContext(id: ExecutionContextId): Promise<ExecutionContextRecord | undefined>
  findActiveExecutionContext(workspaceId: WorkspaceId, workItemId: EntityId, repositoryId: EntityId): Promise<ExecutionContextRecord | undefined>
  putExecutionRun(record: ExecutionRunRecord): Promise<void>
  getExecutionRun(id: ExecutionRunId): Promise<ExecutionRunRecord | undefined>

  // ── 关系：类别与确认态由 domain 规则决定，storage 只如实保存 ──
  // 关系：调用方给语义（类别、来源、确认态），storage 定表示——confirmed 与 candidate 分开存
  // （AGENTS.md §1.1 不变量 5：关键关联显式优先），listRelations 合并两者返回。
  // 不变量 5 的直接推论：**候选不得降级已确认**——同键已有 confirmed 行时，写入 candidate 是 no-op。
  putRelation(workspaceId: WorkspaceId, relation: Relation): Promise<void>
  listRelations(workspaceId: WorkspaceId): Promise<readonly Relation[]>

  // ── 同步：重复或乱序观察返回 false，表示本次观察未被应用，调用方不得读成“已应用” ──
  // 主体是 `ProviderObservation.subject = (bindingId, objectKind, externalId)`，作用域是**连接**；观察**可以先于
  // 成员关系落账**（对账先到、成员关系后到），storage 不要求成员关系存在。`sourceVersion` 必须可直接按字典序
  // 比较且是 ASCII（比较器只有 `compareSourceVersion` 一份），非 ASCII 与空串在入口被拒绝——拒绝是裸异常，core 的同步
  // 事务整笔回滚、游标不变 degraded（#199 承载结构化失败）。`payload` 由 provider
  // 负责脱敏（见 `ProviderObservation` 的契约注释），storage 原样持久化。
  recordObservation(record: ObservationRecord): Promise<boolean>
  getSyncCursor(bindingId: ProviderBindingId, scopeKey: string): Promise<SyncCursorRecord | undefined>
  putSyncCursor(record: SyncCursorRecord): Promise<void>
  getReconcileCursor(workspaceId: WorkspaceId): Promise<ReconcileCursorRecord | undefined>
  putReconcileCursor(record: ReconcileCursorRecord): Promise<void>

  // ── 写尝试：**一行一键**——同 (workspace, idempotencyKey) 只有一行，写入是幂等覆盖（后写的状态取代先写的），
  // `id` 在工作区内唯一。「未决行存在时不得发起第二次外部写」是**调用方**的义务，当前没有强制点（core 在外部写完成后才记录，#204），
  // storage 只保证同键只有一行、不会被并发写成两行。
  findMutationAttempt(workspaceId: WorkspaceId, idempotencyKey: string): Promise<MutationAttemptRecord | undefined>
  putMutationAttempt(record: MutationAttemptRecord): Promise<void>
  listMutationAttempts(workspaceId: WorkspaceId): Promise<readonly MutationAttemptRecord[]>

  // ── 投影修订号：单调递增；客户端从 afterRevision 续传，发现缺口就重新拉基线 ──
  currentRevision(workspaceId: WorkspaceId): Promise<number>
  advanceRevision(workspaceId: WorkspaceId): Promise<number>
}

/** 事务内的 Storage：不允许嵌套事务，因此去掉 transaction 本身。 */
export type StorageTransaction = Omit<Storage, 'transaction'>
