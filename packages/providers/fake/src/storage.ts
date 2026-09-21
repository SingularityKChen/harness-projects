/** 内存 Storage 实现：A2 冻结的 Storage port（事务 / 工作区与绑定 / 身份 / 规划 / 工程 / 执行 / 关系 / 同步 / 写尝试 / 投影修订号）。只读写本地控制事实，不做外部调用，也不持久化；导出/导入内部状态让"换一个实例读同一份内容"能模拟重启。 */
import * as cap from '@harness-projects/capabilities'
import * as domain from '@harness-projects/domain'
export interface FakeStorageData {
  workspaces: cap.WorkspaceRecord[]
  bindings: cap.ProviderBindingRecord[]
  entities: domain.Entity[]
  identities: domain.ExternalIdentity[]
  projections: domain.WorkspaceProjection[]
  repositories: cap.RepositoryRecord[]
  contexts: cap.ExecutionContextRecord[]
  runs: cap.ExecutionRunRecord[]
  relations: { workspaceId: domain.WorkspaceId; relation: domain.Relation }[]
  observations: cap.ObservationRecord[]
  cursors: cap.SyncCursorRecord[]
  attempts: cap.MutationAttemptRecord[]
  revisions: { workspaceId: domain.WorkspaceId; revision: number }[]
}
export function emptyStorageData(): FakeStorageData {
  return {
    workspaces: [], bindings: [], entities: [], identities: [], projections: [], repositories: [],
    contexts: [], runs: [], relations: [], observations: [], cursors: [], attempts: [], revisions: [],
  }
}
function upsert<T>(list: T[], record: T, match: (item: T) => boolean): void {
  const index = list.findIndex(match)
  if (index === -1) list.push(record)
  else list[index] = record
}
const isActiveContext = (status: domain.ExecutionContextStatus): boolean =>
  status !== domain.ExecutionContextStatus.Closed && status !== domain.ExecutionContextStatus.Failed
export class MemoryStorage implements cap.Storage {
  /** 内部状态；只应由本文件的导出/导入函数与测试读取，写入一律走 port 方法。 */
  data: FakeStorageData
  /** 事务队列：重叠事务按调用顺序串行，每个事务在前一个 settle 后才克隆状态。 */
  #queue: Promise<unknown> = Promise.resolve()
  constructor(data: FakeStorageData = emptyStorageData()) {
    this.data = data
  }
  #mutate<T>(fn: () => T | PromiseLike<T>): Promise<T> {
    const run = this.#queue.then(fn)
    this.#queue = run.then(() => undefined, () => undefined)
    return run
  }
  /** 事务内抛错即整体回滚：草稿只在 work 成功返回后替换正式状态；克隆与执行都排在队列里，因此后到的事务看到的是前一个事务提交后的状态，不会用旧快照覆盖已提交写入。 */
  transaction<T>(work: (tx: cap.StorageTransaction) => Promise<T>): Promise<T> {
    return this.#mutate(async () => {
      const draft = structuredClone(this.data)
      const result = await work(new MemoryStorage(draft))
      this.data = draft
      return result
    })
  }
  async putWorkspace(record: cap.WorkspaceRecord): Promise<void> {
    return this.#mutate(() => upsert(this.data.workspaces, record, (w) => w.id === record.id))
  }
  async getWorkspace(id: domain.WorkspaceId): Promise<cap.WorkspaceRecord | undefined> { return this.data.workspaces.find((w) => w.id === id) }
  /** 一个工作空间同一时刻只有一个默认绑定：写入新的默认绑定会把同域旧的默认降级。 */
  async putProviderBinding(record: cap.ProviderBindingRecord): Promise<void> {
    return this.#mutate(() => {
      if (record.isDefault) this.data.bindings = this.data.bindings.map((b) =>
        b.workspaceId === record.workspaceId && b.domain === record.domain && b.id !== record.id ? { ...b, isDefault: false } : b)
      upsert(this.data.bindings, record, (b) => b.id === record.id)
    })
  }
  async listProviderBindings(workspaceId: domain.WorkspaceId): Promise<readonly cap.ProviderBindingRecord[]> { return this.data.bindings.filter((b) => b.workspaceId === workspaceId) }
  async putEntity(record: domain.Entity): Promise<void> {
    return this.#mutate(() => upsert(this.data.entities, record, (e) => e.id === record.id))
  }
  /** 身份全局一份（故意不带 workspaceId）：重复登记保留已分配的 id 与 entityId，否则引用会断。 */
  async putExternalIdentity(record: domain.ExternalIdentity): Promise<void> {
    return this.#mutate(() => {
      const key = domain.externalObjectKey(record.bindingId, record.externalKind, record.externalId)
      const index = this.data.identities.findIndex((i) => domain.externalObjectKey(i.bindingId, i.externalKind, i.externalId) === key)
      const existing = this.data.identities[index]
      if (existing === undefined) this.data.identities.push(record)
      else this.data.identities[index] = { ...record, id: existing.id, entityId: existing.entityId }
    })
  }
  async findExternalIdentity(
    bindingId: domain.ProviderBindingId, externalKind: domain.ExternalIdentityKind, externalId: string,
  ): Promise<domain.ExternalIdentity | undefined> {
    return this.data.identities.find((i) => i.bindingId === bindingId && i.externalKind === externalKind && i.externalId === externalId)
  }
  async listIdentitiesForEntity(entityId: domain.EntityId): Promise<readonly domain.ExternalIdentity[]> { return this.data.identities.filter((i) => i.entityId === entityId) }
  async putPlanningProjection(workspaceId: domain.WorkspaceId, projection: domain.WorkspaceProjection): Promise<void> {
    return this.#mutate(() => upsert(this.data.projections, projection, (p) => p.workspaceId === workspaceId && p.entityId === projection.entityId))
  }

  /**
   * 收敛语义：把本 scope 的规划投影集合变成 items。写入与移除在同一次队列变更内完成，
   * 因此不会出现中间态；未出现在 items 中的投影及其内容实体会被移除，作用域外的投影不受影响。
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
      const retained = new Set(this.data.projections.map((projection) => projection.entityId))
      this.data.entities = this.data.entities.filter((entity) => !stale.has(entity.id) || retained.has(entity.id))
    })
  }
  async getPlanningProjection(workspaceId: domain.WorkspaceId, entityId: domain.EntityId): Promise<domain.WorkspaceProjection | undefined> { return this.data.projections.find((p) => p.workspaceId === workspaceId && p.entityId === entityId) }
  async listPlanningProjections(workspaceId: domain.WorkspaceId): Promise<readonly domain.WorkspaceProjection[]> { return this.data.projections.filter((p) => p.workspaceId === workspaceId) }
  async putRepository(record: cap.RepositoryRecord): Promise<void> {
    return this.#mutate(() => upsert(this.data.repositories, record, (r) => r.id === record.id))
  }
  async listRepositories(workspaceId: domain.WorkspaceId): Promise<readonly cap.RepositoryRecord[]> { return this.data.repositories.filter((r) => r.workspaceId === workspaceId) }
  /** 同一 (工作项, 仓库) 最多一个 active 上下文：写入新的 active 会把旧的置为 closed。 */
  async putExecutionContext(record: cap.ExecutionContextRecord): Promise<void> {
    return this.#mutate(() => {
      if (isActiveContext(record.status)) this.data.contexts = this.data.contexts.map((c) =>
        c.workspaceId === record.workspaceId && c.workItemId === record.workItemId && c.repositoryId === record.repositoryId
          && c.id !== record.id && isActiveContext(c.status) ? { ...c, status: domain.ExecutionContextStatus.Closed } : c)
      upsert(this.data.contexts, record, (c) => c.id === record.id)
    })
  }
  async getExecutionContext(id: domain.ExecutionContextId): Promise<cap.ExecutionContextRecord | undefined> { return this.data.contexts.find((c) => c.id === id) }
  async findActiveExecutionContext(
    workspaceId: domain.WorkspaceId, workItemId: domain.EntityId, repositoryId: domain.EntityId,
  ): Promise<cap.ExecutionContextRecord | undefined> {
    return this.data.contexts.find((c) =>
      c.workspaceId === workspaceId && c.workItemId === workItemId && c.repositoryId === repositoryId && isActiveContext(c.status))
  }
  async putExecutionRun(record: cap.ExecutionRunRecord): Promise<void> {
    return this.#mutate(() => upsert(this.data.runs, record, (r) => r.id === record.id))
  }
  async getExecutionRun(id: domain.ExecutionRunId): Promise<cap.ExecutionRunRecord | undefined> { return this.data.runs.find((r) => r.id === id) }
  async putRelation(workspaceId: domain.WorkspaceId, relation: domain.Relation): Promise<void> {
    return this.#mutate(() => upsert(this.data.relations, { workspaceId, relation }, (r) =>
      r.workspaceId === workspaceId && r.relation.from === relation.from && r.relation.to === relation.to && r.relation.type === relation.type))
  }
  async listRelations(workspaceId: domain.WorkspaceId): Promise<readonly domain.Relation[]> { return this.data.relations.filter((r) => r.workspaceId === workspaceId).map((r) => r.relation) }
  /** dedupe 由 (binding, dedupeKey) 唯一实现：重复观察返回 false，且不覆盖已存记录。 */
  async recordObservation(record: cap.ObservationRecord): Promise<boolean> {
    return this.#mutate(() => {
      const key = `${record.observation.bindingId}|${record.observation.dedupeKey}`
      if (this.data.observations.some((o) => `${o.observation.bindingId}|${o.observation.dedupeKey}` === key)) return false
      this.data.observations.push(record)
      return true
    })
  }
  async getSyncCursor(bindingId: domain.ProviderBindingId, scopeKey: string): Promise<cap.SyncCursorRecord | undefined> { return this.data.cursors.find((c) => c.bindingId === bindingId && c.scopeKey === scopeKey) }
  async putSyncCursor(record: cap.SyncCursorRecord): Promise<void> {
    return this.#mutate(() => upsert(this.data.cursors, record, (c) => c.bindingId === record.bindingId && c.scopeKey === record.scopeKey))
  }
  /** 写尝试以 (workspace, idempotencyKey) 唯一：同键重放返回原记录，不覆盖成新结果。 */
  async findMutationAttempt(workspaceId: domain.WorkspaceId, idempotencyKey: string): Promise<cap.MutationAttemptRecord | undefined> { return this.data.attempts.find((a) => a.workspaceId === workspaceId && a.idempotencyKey === idempotencyKey) }
  async putMutationAttempt(record: cap.MutationAttemptRecord): Promise<void> {
    return this.#mutate(() => {
      if (this.data.attempts.some((a) => a.workspaceId === record.workspaceId && a.idempotencyKey === record.idempotencyKey)) return
      this.data.attempts.push(record)
    })
  }
  async listMutationAttempts(workspaceId: domain.WorkspaceId): Promise<readonly cap.MutationAttemptRecord[]> { return this.data.attempts.filter((a) => a.workspaceId === workspaceId) }
  async currentRevision(workspaceId: domain.WorkspaceId): Promise<number> { return this.data.revisions.find((r) => r.workspaceId === workspaceId)?.revision ?? 0 }
  async advanceRevision(workspaceId: domain.WorkspaceId): Promise<number> {
    return this.#mutate(() => {
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
