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
  ProviderBindingId,
  Relation,
  StatusPolicy,
  WorkspaceId,
  WorkspacePlanningFieldMapping,
  WorkspaceProjection,
  WriteState,
  ConnectorAccountId,
} from '@harness-projects/domain'
import type { BindingConfigurationRecord, ConnectorAccountRecord } from './connector-account.ts'
import type { CapabilityDomain } from './capability-keys.ts'
import type { ExternalObjectRef, ProviderObservation } from './observation.ts'
import { ProjectErrorCode, projectError, type ProjectError } from './result.ts'

/**
 * 本地 Storage 对**已知输入缺陷**的类型化拒绝（#196）。以 Promise 拒绝（异常）传递，而不是结果值：
 * 异常令外层 `transaction` 整笔回滚，而返回值可以被忽略、让先前暂存的写入随提交生效。目前只承诺一种：
 * `putExecutionContext` 引用未登记的工作项；closed / busy / 磁盘 / 编程错误保持原来的响亮失败，不统一映射成 invalid_input。
 * `failure` 是 Storage 端口调用方可见的结构化错误（恢复动作 none：外部平台补不了本地父行）；message 不含驱动文字、SQL 与父行细节。
 * core 的 `startWork` 认领目前不透传它，而是压平成 `unavailable / retry`（守卫先返回 not_found，该路径不可达；TD-023）。
 */
export class StorageInputError extends Error {
  readonly operation: 'putExecutionContext'
  readonly resource: 'work_item'
  readonly failure: ProjectError
  private constructor(failure: ProjectError) {
    super(failure.message)
    this.name = 'StorageInputError'
    this.operation = 'putExecutionContext'; this.resource = 'work_item'; this.failure = failure
  }
  /** 唯一已知情形：两个实现共用同一个构造点，字段与文案因此不会漂移。 */
  static unregisteredWorkItem(): StorageInputError {
    return new StorageInputError(projectError(ProjectErrorCode.InvalidInput, '执行上下文引用的工作项未登记'))
  }
}

export interface WorkspaceRecord {
  readonly id: WorkspaceId; readonly name: string; readonly statusPolicy: StatusPolicy
  /** 本工作区已确认的字段角色映射（#133）：可选，省略 = 未配置；重启从这条记录恢复，不靠调用者每次传回。 */
  readonly planningFieldMapping?: WorkspacePlanningFieldMapping
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
  /** 执行 provider 签发的运行引用：重启后路由 getRun / cancelRun 的唯一依据；core 是唯一写者，取消时与状态一起原子替换。 */
  readonly providerRef?: ExternalObjectRef
  /** 这次运行由降级产生（主执行起不来之后才有它）。只在为真时写；读回路径据此报 `manual_fallback`。 */
  readonly fallback?: boolean
}

export interface MutationAttemptRecord {
  readonly id: string; readonly workspaceId: WorkspaceId; readonly bindingId: ProviderBindingId
  readonly commandName: string; readonly idempotencyKey: string; readonly state: WriteState
  readonly expectedSourceVersion: string | undefined; readonly errorCode: ProjectErrorCode | undefined
}

/** 同步游标状态；degraded 表示还在推进但有失败，failed 表示必须人工介入。 */
export const SyncState = { Idle: 'idle', Syncing: 'syncing', Healthy: 'healthy', Degraded: 'degraded', Failed: 'failed' } as const
export type SyncState = (typeof SyncState)[keyof typeof SyncState]

/** 同步游标按 `(工作区, 连接, scopeKey)` 定位（#189）：同一条连接挂在两个工作区时，各自的同步健康度互不覆盖。 */
export interface SyncCursorRecord {
  readonly workspaceId: WorkspaceId; readonly bindingId: ProviderBindingId; readonly scopeKey: string
  readonly cursorValue: string | undefined; readonly state: SyncState; readonly lastErrorCode: string | undefined
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
 * `value` 是同一套原生值形状的 JSON 编码（`FieldValueRecord` 保持字符串，两个 Storage 的行形状因此一致）。
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
  /** 卸载一个挂载（工作区 + 连接锚点 + 域）：只删该挂载及其配置；账号、连接锚点、外部身份与同步历史保留；缺失挂载重复移除是 no-op。 */
  removeProviderBinding(ref: { readonly workspaceId: WorkspaceId; readonly bindingId: ProviderBindingId; readonly domain: string }): Promise<void>

  // ── 连接账号与工作区配置（#126）：账号是连接锚点级身份，配置是挂载级事实 ──
  // 自然键 = (platformFamily, platformOrigin, identityKind, externalId)：同 id 换自然键、同自然键换 id 都拒绝（快照不得改动）；
  // 显示名、句柄与连接观察状态可更新。句柄与配置写入必须满足受信策略：句柄是 allowlist 精确成员（POSIX 名称形状只是必要条件），
  // 配置按**真实锚点的 implementationKey** 分派 schema，不接收调用者声称的实现键。所有新校验失败使用 `RangeError` 与固定无输入文本。
  putConnectorAccount(record: ConnectorAccountRecord): Promise<void>
  getConnectorAccount(id: ConnectorAccountId): Promise<ConnectorAccountRecord | undefined>
  listConnectorAccounts(): Promise<readonly ConnectorAccountRecord[]>
  /** 初次关联只允许账号、锚点均存在且锚点尚无外部身份、观察、游标、webhook 或写尝试事实；同账号重复关联是 no-op；换账号或给已有事实的锚点补账号必须拒绝（调用者应创建新 bindingId）。 */
  setProviderBindingAccount(bindingId: ProviderBindingId, accountId: ConnectorAccountId): Promise<void>
  getProviderBindingAccount(bindingId: ProviderBindingId): Promise<ConnectorAccountId | undefined>
  putBindingConfiguration(record: BindingConfigurationRecord): Promise<void>
  getBindingConfiguration(ref: { readonly workspaceId: WorkspaceId; readonly bindingId: ProviderBindingId; readonly domain: string }): Promise<BindingConfigurationRecord | undefined>

  // ── 身份：外部身份全局一份，实体是内在锚点 ──
  // 强制面（ADR-0006）：storage 强制「至多一个 primary」与引用完整性（身份必须指向存在的实体与连接锚点，被拒绝的写入不留行）。
  // 「恰好一个」由写入生命周期保证：`putEntity` 必须与 primary 身份在同一事务里写入（core 的 `ensureEntity` 如此），e2e 有断言。
  // 种类（#195）：`putExternalIdentity` 对未知 `externalKind` 以 `RangeError('unsupported external identity kind')` 经 Promise 拒绝，且早于任何写入；两个实现都经 domain 的 `parseExternalIdentityKind`。
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
  /**
   * 全组替换某成员关系的原生字段值（#133）：空组清空该 membership 的全部值。先校验全组（跨 scope 或
   * 悬挂成员关系一律拒绝），再在**一个**原子入口里删除并写入——不允许「先删后插」变成两个顶层写入，
   * 否则失败会留下半组。不变量：同一 `(工作区, 条目, 项目字段)` 只剩一条。
   */
  replaceFieldValues(workspaceId: WorkspaceId, itemExternalId: string, values: readonly FieldValueRecord[]): Promise<void>
  listFieldValues(workspaceId: WorkspaceId, itemExternalId: string): Promise<readonly FieldValueRecord[]>

  // ── 规划：投影承载权威归一化状态与三态内容 ──
  // replace 的实体语义：移除本 scope 的投影但保留实体与身份（实体仍被身份引用，与 002 的外键同语义）。
  putPlanningProjection(workspaceId: WorkspaceId, projection: WorkspaceProjection): Promise<void>
  replacePlanningProjections(scope: { readonly workspaceId: WorkspaceId; readonly bindingId: ProviderBindingId }, items: readonly WorkspaceProjection[]): Promise<void>
  getPlanningProjection(workspaceId: WorkspaceId, entityId: EntityId): Promise<WorkspaceProjection | undefined>
  listPlanningProjections(workspaceId: WorkspaceId): Promise<readonly WorkspaceProjection[]>

  // ── 工程：仓库是可开始工作的前置 ──
  // 挂载键是 (工作区, id)：同一个 id 可以挂在多个工作区上、互不影响；同键换外部身份、同工作区同身份换 id 都被拒绝（不覆盖、不留行），同值重复登记是 no-op；工作区与外部身份必须已存在，且身份必须是 `repository` 种类（TD-004）。
  putRepository(record: RepositoryRecord): Promise<void>
  listRepositories(workspaceId: WorkspaceId): Promise<readonly RepositoryRecord[]>

  // ── 执行：同一工作项 + 仓库最多一个 **active** 上下文（重复开始不得产生第二份） ──
  //
  // `active` 的判据是**状态不是终态**：`Closed` 与 `Failed` 都不是 active，因此它们不挡下一次开始
  // （`startWork` 的 `claimContext` 会接管它们并覆写**同一条**记录——`contextIdFor` 是确定性的，
  // 所以「不得产生第二份」比删除重建更强地成立）。`findActiveExecutionContext` 回答的就是这个问题。
  // 工作项父边（#196）：`workItemId` 不是已登记实体时以 `StorageInputError.unregisteredWorkItem()` 经 Promise 拒绝，早于任何写入（SQLite 早于自己的 BEGIN），不论状态；只问实体是否登记，不问种类。
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
  // 成员关系落账**（对账先到、成员关系后到），storage 不要求成员关系存在。`sourceVersion` 必须是规范载体（定宽 UTC
  // 纳秒时间戳，由 provider 用 `sourceVersionFromTimestamp` 归一；比较器只有 `compareSourceVersion` 一份）。未归一的
  // 秒级 / 变精度 / 带偏移时间戳、不定长编号、sha、非 ASCII 与空串由 `assertComparableSourceVersion` 在任何写入之前
  // 拒绝且不留行——拒绝是裸异常，core 的同步事务整笔回滚、游标不变 degraded（#199 承载结构化失败）。
  // 对规范载体：更新者返回 true，更旧者返回 false，同版本不同 dedupeKey 返回 true（R4 ② 整快照替换）。`payload` 由 provider
  // 负责脱敏（见 `ProviderObservation` 的契约注释），storage 原样持久化。
  recordObservation(record: ObservationRecord): Promise<boolean>
  // 游标的两条父边（工作区、连接锚点）各自独立：只证明父行存在，不证明该工作区已挂载该连接；缺任一父行的写入被拒绝且不留行。
  getSyncCursor(workspaceId: WorkspaceId, bindingId: ProviderBindingId, scopeKey: string): Promise<SyncCursorRecord | undefined>
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
