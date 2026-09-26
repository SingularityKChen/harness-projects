/** 内存 Storage 实现：A2 冻结的 Storage port（事务 / 工作区与绑定 / 身份 / 规划 / 工程 / 执行 / 关系 / 同步 / 写尝试 / 投影修订号）。只读写本地控制事实，不做外部调用，也不持久化；导出/导入内部状态让"换一个实例读同一份内容"能模拟重启。 */
import * as cap from '@harness-projects/capabilities'
import * as domain from '@harness-projects/domain'
export interface FakeProviderBindingAnchor {
  id: domain.ProviderBindingId
  implementationKey: string
}
export interface FakeWorkspaceBindingMount {
  workspaceId: domain.WorkspaceId
  bindingId: domain.ProviderBindingId
  domain: cap.CapabilityDomain
  enabled: boolean
  isDefault: boolean
}
export interface FakeStorageData {
  workspaces: cap.WorkspaceRecord[]
  providerBindings: FakeProviderBindingAnchor[]
  workspaceBindings: FakeWorkspaceBindingMount[]
  entities: domain.Entity[]
  identities: domain.ExternalIdentity[]
  projections: domain.WorkspaceProjection[]
  repositories: cap.RepositoryRecord[]
  contexts: cap.ExecutionContextRecord[]
  runs: cap.ExecutionRunRecord[]
  relations: { workspaceId: domain.WorkspaceId; relation: domain.Relation }[]
  observations: cap.ObservationRecord[]
  cursors: cap.SyncCursorRecord[]
  reconcileCursors: cap.ReconcileCursorRecord[]
  attempts: cap.MutationAttemptRecord[]
  revisions: { workspaceId: domain.WorkspaceId; revision: number }[]
  memberships: cap.MembershipRecord[]
  fieldValues: cap.FieldValueRecord[]
}
export function emptyStorageData(): FakeStorageData {
  return { workspaces: [], providerBindings: [], workspaceBindings: [], entities: [], identities: [], projections: [], repositories: [],
    contexts: [], runs: [], relations: [], observations: [], cursors: [], reconcileCursors: [], attempts: [], revisions: [], memberships: [], fieldValues: [] }
}
/** 版本定序的唯一判据来自 capabilities（与 SQLite 的 BINARY 同判据）；本文件不再自写一份比较器。 */
const compareSourceVersion = cap.compareSourceVersion
function upsert<T>(list: T[], record: T, match: (item: T) => boolean): void {
  const index = list.findIndex(match)
  if (index === -1) list.push(record); else list[index] = record
}
function toBindingRecord(mount: FakeWorkspaceBindingMount, anchors: readonly FakeProviderBindingAnchor[]): cap.ProviderBindingRecord {
  const anchor = anchors.find((candidate) => candidate.id === mount.bindingId)
  if (anchor === undefined) throw new Error('workspace binding has no connection anchor')
  return { id: mount.bindingId, workspaceId: mount.workspaceId, domain: mount.domain,
    implementationKey: anchor.implementationKey, enabled: mount.enabled, isDefault: mount.isDefault }
}
function toBindingMount(record: cap.ProviderBindingRecord): FakeWorkspaceBindingMount {
  return { workspaceId: record.workspaceId, bindingId: record.id, domain: record.domain, enabled: record.enabled, isDefault: record.isDefault }
}
/** 成员关系升序：按码点序比较（SQLite 的 TEXT 排序是 BINARY/UTF-8 字节序，等价于码点序；JS 的 `<` 比 UTF-16 码元，增补平面字符上会分叉）。 */
function byItemExternalId(left: cap.MembershipRecord, right: cap.MembershipRecord): number {
  const a = [...left.itemExternalId].map((unit) => unit.codePointAt(0) ?? 0)
  const b = [...right.itemExternalId].map((unit) => unit.codePointAt(0) ?? 0)
  for (let i = 0; i < a.length && i < b.length; i++) if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0)
  return a.length - b.length
}
/** 状态 / 来源枚举：替身侧按 domain 的取值拒绝未知值，与 003 各表的 CHECK 同语义（枚举只有 domain 一份事实源）。 */
const CONTEXT_STATUSES: readonly string[] = Object.values(domain.ExecutionContextStatus)
const RUN_STATUSES: readonly string[] = Object.values(domain.ExecutionRunStatus)
const WRITE_STATES: readonly string[] = Object.values(domain.WriteState)
const RELATION_STATES: readonly string[] = Object.values(domain.RelationState)
const RELATION_SOURCES: readonly string[] = Object.values(domain.RelationSource)
const isActiveContext = (status: domain.ExecutionContextStatus): boolean =>
  status !== domain.ExecutionContextStatus.Closed && status !== domain.ExecutionContextStatus.Failed
export class MemoryStorage implements cap.Storage {
  /** 内部状态；只应由本文件的导出/导入函数与测试读取，写入一律走 port 方法。 */
  data: FakeStorageData
  /** 事务队列：重叠事务按调用顺序串行，每个事务在前一个 settle 后才克隆状态。 */
  #queue: Promise<unknown> = Promise.resolve()
  /** 事务作用域标记：类型层的 `StorageTransaction = Omit<Storage, 'transaction'>` 不会在运行时移除方法，嵌套事务必须在这里被显式拒绝（L3 计划遗留「嵌套事务在运行时静默吞写」的收口条件）。 */
  #transactionScope: boolean
  constructor(data: FakeStorageData = emptyStorageData(), transactionScope = false) {
    this.data = data
    this.#transactionScope = transactionScope
  }
  #mutate<T>(fn: () => T | PromiseLike<T>): Promise<T> {
    const run = this.#queue.then(fn)
    this.#queue = run.then(() => undefined, () => undefined); return run
  }
  /** 事务内抛错即整体回滚：草稿只在 work 成功返回后替换正式状态；克隆与执行都排在队列里，因此后到的事务看到的是前一个事务提交后的状态，不会用旧快照覆盖已提交写入。事务作用域内的实例拒绝嵌套，避免内层写入被静默丢弃。 */
  async transaction<T>(work: (tx: cap.StorageTransaction) => Promise<T>): Promise<T> {
    if (this.#transactionScope) throw new Error('嵌套事务不被支持：一个事务内不得再开事务')
    return this.#mutate(async () => {
      const draft = structuredClone(this.data)
      const result = await work(new MemoryStorage(draft, true))
      this.data = draft
      return result
    })
  }
  async putWorkspace(record: cap.WorkspaceRecord): Promise<void> {
    return this.#mutate(() => upsert(this.data.workspaces, record, (w) => w.id === record.id))
  }
  async getWorkspace(id: domain.WorkspaceId): Promise<cap.WorkspaceRecord | undefined> { return this.data.workspaces.find((w) => w.id === id) }
  async putProviderBinding(record: cap.ProviderBindingRecord): Promise<void> {
    return this.#mutate(() => {
      if (record.isDefault && !record.enabled) throw new Error('default provider binding must be enabled')
      if (!this.data.workspaces.some((workspace) => workspace.id === record.workspaceId)) throw new Error('provider binding workspace does not exist')
      const anchor = this.data.providerBindings.find((candidate) => candidate.id === record.id)
      if (anchor !== undefined && anchor.implementationKey !== record.implementationKey) {
        throw new Error('provider binding id already points at another implementation')
      }
      const planningTaken = record.domain === cap.CapabilityDomain.Planning && record.enabled
        && this.data.workspaceBindings.some((mount) => mount.workspaceId === record.workspaceId
          && mount.domain === record.domain && mount.enabled && mount.bindingId !== record.id)
      if (planningTaken) throw new Error('workspace already has an enabled planning binding')
      if (record.isDefault) {
        this.data.workspaceBindings = this.data.workspaceBindings.map((mount) => mount.workspaceId === record.workspaceId
          && mount.domain === record.domain && mount.bindingId !== record.id && mount.isDefault ? { ...mount, isDefault: false } : mount)
      }
      if (anchor === undefined) this.data.providerBindings.push({ id: record.id, implementationKey: record.implementationKey })
      upsert(this.data.workspaceBindings, toBindingMount(record), (mount) => mount.workspaceId === record.workspaceId
        && mount.bindingId === record.id && mount.domain === record.domain)
    })
  }
  async listProviderBindings(workspaceId: domain.WorkspaceId): Promise<readonly cap.ProviderBindingRecord[]> {
    return this.data.workspaceBindings.filter((mount) => mount.workspaceId === workspaceId)
      .map((mount) => toBindingRecord(mount, this.data.providerBindings))
  }
  async putEntity(record: domain.Entity): Promise<void> {
    return this.#mutate(() => upsert(this.data.entities, record, (e) => e.id === record.id))
  }
  async putExternalIdentity(record: domain.ExternalIdentity): Promise<void> {
    return this.#mutate(() => {
      const key = domain.externalObjectKey(record.bindingId, record.externalKind, record.externalId)
      const index = this.data.identities.findIndex((identity) => domain.externalObjectKey(identity.bindingId, identity.externalKind, identity.externalId) === key)
      const existing = this.data.identities[index]
      const sameId = this.data.identities.find((identity) => identity.id === record.id)
      if (sameId !== undefined && sameId !== existing) throw new Error('external identity id already points at another object')
      const entityId = existing?.entityId ?? record.entityId
      if (!this.data.entities.some((entity) => entity.id === entityId)) throw new Error('external identity entity does not exist')
      if (!this.data.providerBindings.some((anchor) => anchor.id === record.bindingId)) throw new Error('external identity binding does not exist')
      const primaryTaken = this.data.identities.some((identity) => identity.entityId === entityId
        && identity.role === domain.IdentityRole.Primary && identity !== existing)
      if (record.role === domain.IdentityRole.Primary && primaryTaken) throw new Error('entity already has a primary external identity')
      if (existing === undefined) this.data.identities.push(record)
      else this.data.identities[index] = { ...record, id: existing.id, entityId: existing.entityId }
    })
  }
  async findExternalIdentity(bindingId: domain.ProviderBindingId, externalKind: domain.ExternalIdentityKind, externalId: string): Promise<domain.ExternalIdentity | undefined> {
    return this.data.identities.find((i) => i.bindingId === bindingId && i.externalKind === externalKind && i.externalId === externalId)
  }
  async listIdentitiesForEntity(entityId: domain.EntityId): Promise<readonly domain.ExternalIdentity[]> { return this.data.identities.filter((i) => i.entityId === entityId) }
  async putMembership(record: cap.MembershipRecord): Promise<void> {
    return this.#mutate(() => {
      if (!this.data.workspaces.some((workspace) => workspace.id === record.workspaceId)) throw new Error('membership workspace does not exist')
      const key = (m: cap.MembershipRecord): string => JSON.stringify([m.workspaceId, m.projectExternalId, m.contentKind, m.contentExternalId])
      const replaced = this.data.memberships.filter((m) => key(m) === key(record) && m.itemExternalId !== record.itemExternalId)
      if (replaced.length > 0) {
        const orphans = new Set(replaced.map((m) => m.itemExternalId))
        this.data.memberships = this.data.memberships.filter((m) => !(key(m) === key(record) && orphans.has(m.itemExternalId)))
        this.data.fieldValues = this.data.fieldValues.filter((v) => !(v.workspaceId === record.workspaceId && orphans.has(v.itemExternalId)))
      }
      upsert(this.data.memberships, record, (m) => m.workspaceId === record.workspaceId && m.itemExternalId === record.itemExternalId)
    })
  }
  async getMembership(workspaceId: domain.WorkspaceId, itemExternalId: string): Promise<cap.MembershipRecord | undefined> {
    return this.data.memberships.find((m) => m.workspaceId === workspaceId && m.itemExternalId === itemExternalId)
  }
  async listMemberships(workspaceId: domain.WorkspaceId, projectExternalId: string): Promise<readonly cap.MembershipRecord[]> {
    return this.data.memberships
      .filter((m) => m.workspaceId === workspaceId && m.projectExternalId === projectExternalId)
      .sort(byItemExternalId)
  }
  async putFieldValue(record: cap.FieldValueRecord): Promise<void> {
    return this.#mutate(() => {
      if (!this.data.memberships.some((membership) => membership.workspaceId === record.workspaceId && membership.itemExternalId === record.itemExternalId)) throw new Error('field value membership does not exist')
      upsert(this.data.fieldValues, record, (v) => v.workspaceId === record.workspaceId
        && v.itemExternalId === record.itemExternalId && v.projectFieldId === record.projectFieldId)
    })
  }
  async listFieldValues(workspaceId: domain.WorkspaceId, itemExternalId: string): Promise<readonly cap.FieldValueRecord[]> {
    return this.data.fieldValues.filter((v) => v.workspaceId === workspaceId && v.itemExternalId === itemExternalId)
  }
  async putPlanningProjection(workspaceId: domain.WorkspaceId, projection: domain.WorkspaceProjection): Promise<void> {
    return this.#mutate(() => {
      if (!this.data.workspaces.some((workspace) => workspace.id === workspaceId)) throw new Error('projection workspace does not exist')
      if (!this.data.entities.some((entity) => entity.id === projection.entityId)) throw new Error('projection entity does not exist')
      upsert(this.data.projections, projection, (p) => p.workspaceId === workspaceId && p.entityId === projection.entityId)
    })
  }

  /**
   * 收敛语义：把本 scope 的规划投影集合变成 items。写入与移除在同一次队列变更内完成，
   * 因此不会出现中间态；未出现在 items 中的投影被移除，实体与身份保留（实体仍被身份引用，与 002 的外键同语义），作用域外的投影不受影响。
   * 不调用 putPlanningProjection：那会排进第二次变更，既破坏原子性，也会在队列内自等。
   */
  async replacePlanningProjections(scope: {
    readonly workspaceId: domain.WorkspaceId; readonly bindingId: domain.ProviderBindingId
  }, items: readonly domain.WorkspaceProjection[]): Promise<void> {
    return this.#mutate(() => {
      const incoming = new Set(items.map((item) => item.entityId))
      const scoped = new Set(this.data.identities
        .filter((identity) => identity.bindingId === scope.bindingId)
        .map((identity) => identity.entityId))
      const stale = new Set(this.data.projections
        .filter((projection) => projection.workspaceId === scope.workspaceId && scoped.has(projection.entityId) && !incoming.has(projection.entityId))
        .map((projection) => projection.entityId))
      this.data.projections = this.data.projections.filter((projection) => !(projection.workspaceId === scope.workspaceId && stale.has(projection.entityId)))
      for (const item of items) {
        upsert(this.data.projections, item, (p) => p.workspaceId === scope.workspaceId && p.entityId === item.entityId)
      }
    })
  }
  async getPlanningProjection(workspaceId: domain.WorkspaceId, entityId: domain.EntityId): Promise<domain.WorkspaceProjection | undefined> { return this.data.projections.find((p) => p.workspaceId === workspaceId && p.entityId === entityId) }
  async listPlanningProjections(workspaceId: domain.WorkspaceId): Promise<readonly domain.WorkspaceProjection[]> { return this.data.projections.filter((p) => p.workspaceId === workspaceId) }
  /** 仓库以外键指向工作区与身份：两者任一不存在即拒绝（与 SQLite 的 `repository` 两条外键同语义，L6 评审 F1）。 */
  async putRepository(record: cap.RepositoryRecord): Promise<void> {
    return this.#mutate(() => {
      if (!this.data.workspaces.some((workspace) => workspace.id === record.workspaceId)) throw new Error('repository workspace does not exist')
      if (!this.data.identities.some((identity) => identity.id === record.externalIdentityId)) throw new Error('repository external identity does not exist')
      upsert(this.data.repositories, record, (r) => r.id === record.id)
    })
  }
  async listRepositories(workspaceId: domain.WorkspaceId): Promise<readonly cap.RepositoryRecord[]> { return this.data.repositories.filter((r) => r.workspaceId === workspaceId) }
  /**
   * 同一 (工作项, 仓库) 最多一个 active 上下文：写入新的 active 会把旧的置为 closed，并把旧行的
   * `provisioningStartedAt` 清成 `undefined`——端口契约写明该列"终态为 undefined"（L6 评审 F3）。
   * 工作区父边与状态枚举按 SQLite 的同语义检查（`execution_context.workspace_id` 外键与 `status` 的 CHECK），
   * 两条**依赖 core 的父边仍然分叉**：`repositoryId`（core 尚无登记仓库的生产调用者，收口见本层计划遗留
   * 「没有生产代码调用 `putRepository`」，承载 issue #188）与 `workItemId`（core 会把上下文写到未登记的工作项上，
   * 承载 issue #196）——SQLite 的复合外键拒绝，替身接受；分叉由执行组的显式用例按能力位断言。
   */
  async putExecutionContext(record: cap.ExecutionContextRecord): Promise<void> {
    return this.#mutate(() => {
      if (!this.data.workspaces.some((workspace) => workspace.id === record.workspaceId)) throw new Error('execution context workspace does not exist')
      if (!CONTEXT_STATUSES.includes(record.status)) throw new Error(`execution context status is not a known value: ${record.status}`)
      if (isActiveContext(record.status)) this.data.contexts = this.data.contexts.map((c) =>
        c.workspaceId === record.workspaceId && c.workItemId === record.workItemId && c.repositoryId === record.repositoryId
          && c.id !== record.id && isActiveContext(c.status)
          ? { ...c, status: domain.ExecutionContextStatus.Closed, provisioningStartedAt: undefined } : c)
      upsert(this.data.contexts, record, (c) => c.id === record.id)
    })
  }
  async getExecutionContext(id: domain.ExecutionContextId): Promise<cap.ExecutionContextRecord | undefined> { return this.data.contexts.find((c) => c.id === id) }
  async findActiveExecutionContext(workspaceId: domain.WorkspaceId, workItemId: domain.EntityId, repositoryId: domain.EntityId): Promise<cap.ExecutionContextRecord | undefined> {
    return this.data.contexts.find((c) =>
      c.workspaceId === workspaceId && c.workItemId === workItemId && c.repositoryId === repositoryId && isActiveContext(c.status))
  }
  /** 执行运行必须挂在存在的上下文与工作区上、状态必须是已知取值：与 SQLite 的 `execution_run` 两条外键（上下文是 `(workspace_id, context_id)` 复合键：必须在同一工作区）与 `status` 的 CHECK 同语义（L6 评审 F1；第四轮评审补工作区与枚举；第六轮评审补复合键）。 */
  async putExecutionRun(record: cap.ExecutionRunRecord): Promise<void> {
    return this.#mutate(() => {
      if (!this.data.workspaces.some((workspace) => workspace.id === record.workspaceId)) throw new Error('execution run workspace does not exist')
      if (!this.data.contexts.some((context) => context.id === record.contextId && context.workspaceId === record.workspaceId)) throw new Error('execution run context does not exist in the run workspace')
      if (!RUN_STATUSES.includes(record.status)) throw new Error(`execution run status is not a known value: ${record.status}`)
      upsert(this.data.runs, record, (r) => r.id === record.id)
    })
  }
  async getExecutionRun(id: domain.ExecutionRunId): Promise<cap.ExecutionRunRecord | undefined> { return this.data.runs.find((r) => r.id === id) }
  /**
   * 关系：工作区必须存在，`state` / `source` 必须是 domain 的已知取值，candidate 不接受 `explicit`
   * （`explicit` 按 domain 的 `initialRelationState` 只能进 confirmed）——三条与 SQLite 的
   * `relation` / `candidate_relation` CHECK 同语义。两端（`from` / `to`）**仍然分叉**：SQLite 的外键拒绝未登记的
   * 实体，替身接受——core 会把谱系边写到从未 `putEntity` 的实体上（issue #187），由执行组的显式用例按能力位断言。
   */
  async putRelation(workspaceId: domain.WorkspaceId, relation: domain.Relation): Promise<void> {
    return this.#mutate(() => {
      if (!this.data.workspaces.some((workspace) => workspace.id === workspaceId)) throw new Error('relation workspace does not exist')
      if (!RELATION_STATES.includes(relation.state)) throw new Error(`relation state is not a known value: ${relation.state}`)
      if (!RELATION_SOURCES.includes(relation.source)) throw new Error(`relation source is not a known value: ${relation.source}`)
      if (relation.state === domain.RelationState.Candidate && relation.source === domain.RelationSource.Explicit) throw new Error('candidate relation source must be deterministic or lineage')
      const sameKey = (r: (typeof this.data.relations)[number]): boolean => r.workspaceId === workspaceId && r.relation.from === relation.from
        && r.relation.to === relation.to && r.relation.type === relation.type
      // 不变量 5：候选不得降级已确认——同键已有 confirmed 时，写入 candidate 是 no-op。
      if (relation.state !== 'confirmed' && this.data.relations.some((r) => sameKey(r) && r.relation.state === 'confirmed')) return
      upsert(this.data.relations, { workspaceId, relation }, sameKey)
    })
  }
  async listRelations(workspaceId: domain.WorkspaceId): Promise<readonly domain.Relation[]> { return this.data.relations.filter((r) => r.workspaceId === workspaceId).map((r) => r.relation) }
  /**
   * false 表示本次观察未被应用（重复或乱序），调用方不得读成“已应用”。
   * 观察的主体是连接：`bindingId` 必须已登记（与 SQLite 的 `sync_observation.binding_id` 外键同语义）——
   * 但**不要求成员关系存在**，账本主体是端口主体，对账可以先于成员关系落账（端口契约的执行段）。
   */
  async recordObservation(record: cap.ObservationRecord): Promise<boolean> {
    return this.#mutate(() => {
      const { observation } = record
      if (!this.data.providerBindings.some((binding) => binding.id === observation.bindingId)) throw new Error('observation binding does not exist')
      if (observation.sourceVersion !== undefined && !cap.isComparableSourceVersion(observation.sourceVersion)) {
        throw new Error(`sourceVersion 必须是可比的 ASCII 载体：${observation.sourceVersion}`)
      }
      const key = `${observation.bindingId}|${observation.dedupeKey}`
      // 去重账本与快照槽位分开：账本按 (bindingId, dedupeKey) 只追加，永不被后来的同版本观察顶掉，
      // 否则"同一观察再投递一次"会第二次返回 true，调用方据此重放副作用。
      if (this.data.observations.some((item) => `${item.observation.bindingId}|${item.observation.dedupeKey}` === key)) return false
      const sameSubject = this.data.observations.filter((item) => item.observation.bindingId === observation.bindingId
        && item.observation.subject.objectKind === observation.subject.objectKind
        && item.observation.subject.externalId === observation.subject.externalId)
      // 已提交快照 = 该主体里 sourceVersion 最大的那条（相等时取最后写入的一条，即整快照替换）。
      let committed: cap.ObservationRecord | undefined
      for (const item of sameSubject) {
        if (committed === undefined || compareSourceVersion(item.observation.sourceVersion, committed.observation.sourceVersion) >= 0) committed = item
      }
      if (committed !== undefined && compareSourceVersion(observation.sourceVersion, committed.observation.sourceVersion) < 0) return false
      this.data.observations.push(record)
      return true
    })
  }
  async getSyncCursor(bindingId: domain.ProviderBindingId, scopeKey: string): Promise<cap.SyncCursorRecord | undefined> { return this.data.cursors.find((c) => c.bindingId === bindingId && c.scopeKey === scopeKey) }
  async putSyncCursor(record: cap.SyncCursorRecord): Promise<void> {
    return this.#mutate(() => {
      // 游标必须挂在存在的连接锚点上（与 SQLite 的 sync_cursor.binding_id 外键同语义，第四轮评审 R4-4）。
      if (!this.data.providerBindings.some((anchor) => anchor.id === record.bindingId)) throw new Error('sync cursor binding does not exist')
      upsert(this.data.cursors, record, (c) => c.bindingId === record.bindingId && c.scopeKey === record.scopeKey)
    })
  }
  async getReconcileCursor(workspaceId: domain.WorkspaceId): Promise<cap.ReconcileCursorRecord | undefined> {
    return this.data.reconcileCursors.find((cursor) => cursor.workspaceId === workspaceId)
  }
  async putReconcileCursor(record: cap.ReconcileCursorRecord): Promise<void> {
    return this.#mutate(() => {
      // 对账游标必须属于存在的工作区（与 SQLite 的 reconcile_cursor.workspace_id 外键同语义，第四轮评审 R4-4）。
      if (!this.data.workspaces.some((workspace) => workspace.id === record.workspaceId)) throw new Error('reconcile cursor workspace does not exist')
      upsert(this.data.reconcileCursors, record, (cursor) => cursor.workspaceId === record.workspaceId)
    })
  }
  /** 写尝试以 (workspace, idempotencyKey) 唯一：同键重放是**幂等覆盖**（与 003 的 `PRIMARY KEY (workspace_id, idempotency_key)` 同模型），`id` 在工作区内唯一。工作区与绑定两条父边、`state` 枚举都与 SQLite 的 `mutation_attempt` 外键与 CHECK 同语义（L6 评审 F1；第四轮评审补工作区与枚举）。 */
  async findMutationAttempt(workspaceId: domain.WorkspaceId, idempotencyKey: string): Promise<cap.MutationAttemptRecord | undefined> { return this.data.attempts.find((a) => a.workspaceId === workspaceId && a.idempotencyKey === idempotencyKey) }
  async putMutationAttempt(record: cap.MutationAttemptRecord): Promise<void> {
    return this.#mutate(() => {
      if (!this.data.workspaces.some((workspace) => workspace.id === record.workspaceId)) throw new Error('mutation attempt workspace does not exist')
      if (!this.data.providerBindings.some((binding) => binding.id === record.bindingId)) throw new Error('mutation attempt binding does not exist')
      if (!WRITE_STATES.includes(record.state)) throw new Error(`mutation attempt state is not a known value: ${record.state}`)
      const clash = this.data.attempts.find((a) => a.workspaceId === record.workspaceId
        && a.id === record.id && a.idempotencyKey !== record.idempotencyKey)
      if (clash !== undefined) throw new Error('mutation attempt id already used in this workspace')
      upsert(this.data.attempts, record, (a) => a.workspaceId === record.workspaceId && a.idempotencyKey === record.idempotencyKey)
    })
  }
  async listMutationAttempts(workspaceId: domain.WorkspaceId): Promise<readonly cap.MutationAttemptRecord[]> { return this.data.attempts.filter((a) => a.workspaceId === workspaceId) }
  async currentRevision(workspaceId: domain.WorkspaceId): Promise<number> { return this.data.revisions.find((r) => r.workspaceId === workspaceId)?.revision ?? 0 }
  async advanceRevision(workspaceId: domain.WorkspaceId): Promise<number> {
    return this.#mutate(() => {
      if (!this.data.workspaces.some((workspace) => workspace.id === workspaceId)) throw new Error('revision workspace does not exist')
      const index = this.data.revisions.findIndex((r) => r.workspaceId === workspaceId)
      const revision = (this.data.revisions[index]?.revision ?? 0) + 1
      if (index === -1) this.data.revisions.push({ workspaceId, revision })
      else this.data.revisions[index] = { workspaceId, revision }
      return revision
    })
  }
}
export function createFakeStorage(data: FakeStorageData = emptyStorageData()): MemoryStorage {
  return new MemoryStorage(structuredClone(data))
}
/** 导出内部状态：换一个实例导入同一份快照即可模拟重启后读同一份内容。 */
export function exportFakeStorageState(storage: cap.Storage): FakeStorageData {
  if (!(storage instanceof MemoryStorage)) throw new Error('exportFakeStorageState 只支持 MemoryStorage')
  return structuredClone(storage.data)
}
