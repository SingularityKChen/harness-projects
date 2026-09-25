/**
 * @harness-projects/storage-sqlite —— Storage 端口的 SQLite 实现（Batch L4 / #163，只交付地基面）：事务机制 + 工作区 / 绑定 / 实体 / 身份 / 规划投影 / 仓库 / 投影修订号；其余方法继承 `UnimplementedPort` 并显式抛出 `not implemented in L4: <method>`，让"还没做"与"没有数据"可区分。
 * 写者路径：单语句变更排同一条实例级队列，多语句写入走唯一原子入口 `atomic`（作用域实例内直接执行，根实例上包一层事务）；事务在队列内从 BEGIN IMMEDIATE 持有到 COMMIT / ROLLBACK——重叠事务串行提交，在途事务期间的直接写入等到结算后才执行。读者路径：读排同一条队列，外部读因此拿到**结算后**的值，永远看不到未提交的写入；事务作用域内的 `tx.*` 直接执行，读得到本事务自己的未提交写入。与内存替身的差别在三处——读取时刻（事务在途时替身的外部读立刻看到旧值，队列化的读者等到结算）、活性（在 work 里调外层实例：SQLite 快速失败，替身的写排到本事务之后、await 即永久挂起）、作用域生命周期（结算后与未 await 的 `tx.*`：SQLite 拒绝，替身照常落库）——不在可见性：两者都不暴露未提交数据；分叉登记在本层计划的遗留清单。快速失败（不静默挂起、不把驱动文案抛给调用方）：作用域实例再开事务、结算后再用泄漏的 `tx.*`；在 work 里调**外层实例**（队列内自等，用 AsyncLocalStorage 标记事务作用域）；`close()` 之后的任何调用。事务作用域的错误文本是同一族的**约定**文本：两个字面量各自维护（依赖方向不允许共享常量），漂移由 `suites/storage.js` 的整串断言钉住。列表顺序：端口没有规定，本实现按 rowid（插入序）返回，与内存替身的数组序一致。
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ProviderBindingRecord, RepositoryRecord, Storage, StorageTransaction, WorkspaceRecord } from '@harness-projects/capabilities'
import type { Entity, EntityId, ExternalIdentity, ProviderBindingId, WorkspaceId, WorkspaceProjection } from '@harness-projects/domain'
import { openDatabase, type WorkspaceDatabase } from './db.ts'
import { migrate } from './migrate.ts'
import { contentColumns, rowToBinding, rowToIdentity, rowToProjection, rowToRepository, rowToWorkspace, toFlag, type Row } from './storage-rows.ts'
import { UnimplementedPort } from './storage-unimplemented.ts'

export const NESTED_TRANSACTION_MESSAGE = '嵌套事务不被支持：一个事务内不得再开事务'
export const OUTER_INSTANCE_MESSAGE = '嵌套事务不被支持：事务内必须用 tx.*，调用外层实例会在队列内自等'
export const CLOSED_MESSAGE = '存储实例已关闭：关闭前必须等在途事务结算'
export const SETTLED_TRANSACTION_MESSAGE = '事务作用域已结算：tx.* 只能在所属事务的 work 内使用（常见成因是漏写 await）'
/**
 * 事务作用域令牌：只有"本实例 work 内部"的调用看得见，事务在途时的外部读照常排队，不会被误判成自等。
 * **令牌是可变对象**（2026-09-24 评审）：`active` 在事务结算的 `finally` 里置假，因此 work 里派生的定时器或
 * 回调在提交之后调外层实例不再被误判成"队列内自等"；作用域实例自己也检查 `active`，泄漏出 work 的 `tx`
 * 在结算后快速失败，而不是绕开队列、被并进**下一个**在途事务（调用方拿到 resolved，写入却随那次回滚消失）。
 */
interface TransactionToken { readonly owner: SqliteStorage; active: boolean }
const TX_SCOPE = new AsyncLocalStorage<TransactionToken>()
const BINDING_COLUMNS = 'b.id AS id, wb.workspace_id AS workspace_id, wb.domain AS domain, b.implementation_key AS implementation_key, wb.enabled AS enabled, wb.is_default AS is_default'
const IDENTITY_COLUMNS = 'id, entity_id, binding_id, external_kind, external_id, role'
const PROJECTION_COLUMNS = 'workspace_id, entity_id, planning_status, content_kind, content_title, content_body, content_number, redaction_reason, revision'
const REPOSITORY_COLUMNS = 'id, workspace_id, external_identity_id'
const rollbackQuietly = (db: WorkspaceDatabase): void => { try { db.exec('ROLLBACK') } catch { /* 已回滚 */ } }
const optional = <T>(row: unknown, map: (row: Row) => T): T | undefined => (row === undefined ? undefined : map(row as Row))

export class SqliteStorage extends UnimplementedPort implements Storage {
  protected readonly db: WorkspaceDatabase
  readonly location: string
  #queue: Promise<unknown> = Promise.resolve()
  #scoped: boolean
  /** 作用域实例与根实例**共用**同一份状态（2026-09-24 评审）：否则 `close()` 之后 work 里的 `tx.*` 仍打到已关闭的句柄上。 */
  #state: { closed: boolean }
  #token: TransactionToken | undefined
  constructor(location: string, db: WorkspaceDatabase, scoped = false, state?: { closed: boolean }, token?: TransactionToken) {
    super(); this.location = location; this.db = db; this.#scoped = scoped
    this.#state = state ?? { closed: false }; this.#token = token
  }

  /** 读写统一入口：轮到自己之前不碰连接，因此事务在途时的直接写入与外部读都等到结算（提交或回滚）后再执行。作用域实例已持有队列、直接执行；在 work 里调外层实例会队列内自等，命中事务作用域标记即拒；关闭后一律快速失败。 */
  protected mutate<T>(fn: () => T | PromiseLike<T>): Promise<T> {
    if (this.#state.closed) return Promise.reject(new Error(CLOSED_MESSAGE))
    if (this.#scoped) {
      // 作用域实例只在所属事务的**动态范围**内有效：结算之后再用它就是误用（泄漏出 work 的 tx、漏写 await）。执行时再查一次：fn 推迟一个微任务，未 await 的写入否则会在 ROLLBACK 之后以自动提交落库（第五轮评审）。
      if (this.#token === undefined || !this.#token.active) return Promise.reject(new Error(SETTLED_TRANSACTION_MESSAGE))
      const token = this.#token; return Promise.resolve().then(() => { if (!token.active) throw new Error(SETTLED_TRANSACTION_MESSAGE); return fn() })
    }
    const token = TX_SCOPE.getStore()
    if (token !== undefined && token.owner === this && token.active) return Promise.reject(new Error(OUTER_INSTANCE_MESSAGE))
    const run = this.#queue.then(() => { if (this.#state.closed) throw new Error(CLOSED_MESSAGE); return fn() })
    this.#queue = run.then(() => undefined, () => undefined); return run
  }
  /**
   * 多语句写入的**唯一原子入口**（2026-09-24 评审）：作用域实例已在事务内，直接执行；根实例上包一层
   * `transaction`。写者路径因此只有"单语句"与"一个原子作用域"两种，方法体不再各自决定要不要开事务。
   */
  protected atomic<T>(fn: () => T): Promise<T> {
    if (this.#scoped) return this.mutate(fn)
    return this.transaction(async () => fn())
  }
  protected write(sql: string, ...params: readonly (string | number | null)[]): Promise<void> { return this.mutate(() => { this.db.prepare(sql).run(...params) }) }
  /** 事务在队列内持有 BEGIN IMMEDIATE 到提交/回滚：重叠事务按调用顺序串行，不会撞上"事务里再开事务"的驱动级错误。失败一律 ROLLBACK——半写行重开句柄就再也读不到（集成用例的判别点）；关闭时未提交的事务以 CLOSED_MESSAGE 失败，而不是驱动文案。 */
  async transaction<T>(work: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    if (this.#scoped) throw new Error(NESTED_TRANSACTION_MESSAGE)
    return this.mutate(async () => {
      this.db.exec('BEGIN IMMEDIATE')
      const token: TransactionToken = { owner: this, active: true }
      this.#token = token
      try {
        const result = await TX_SCOPE.run(token, () => work(new SqliteStorage(this.location, this.db, true, this.#state, token)))
        if (this.#state.closed) throw new Error(CLOSED_MESSAGE)
        this.db.exec('COMMIT'); return result
      } catch (error) { rollbackQuietly(this.db); throw error } finally { token.active = false }
    })
  }
  /** 关闭底层句柄：重启用例必须真的关掉再打开。它不是端口方法（内存替身没有这一步）。调用方必须先在途事务结算；未结算就关时，在途事务与已排队变更都以 CLOSED_MESSAGE 快速失败。 */
  close(): void { if (this.#state.closed) return; this.#state.closed = true; this.db.close() }

  putWorkspace(record: WorkspaceRecord): Promise<void> {
    return this.write('INSERT INTO workspace (id, name, status_policy) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, status_policy = excluded.status_policy', record.id, record.name, record.statusPolicy)
  }
  getWorkspace(id: WorkspaceId): Promise<WorkspaceRecord | undefined> { return this.mutate(() => optional(this.db.prepare('SELECT id, name, status_policy FROM workspace WHERE id = ?').get(id), rowToWorkspace)) }
  /** 绑定写入是两条语句——连接锚点（跨工作区共享）与工作区挂载——必须整体生效：挂载被唯一索引或 CHECK 拒绝时留下孤儿锚点，"被拒绝的挂载不得留下任何行"就不成立。拒绝先于写入：`ON CONFLICT (id) DO NOTHING` 会静默吞掉"同一个 id 换实现"，所以先比对实现键；其余拒绝由 002 的约束给出，事务把它们与前面的写入一起回滚。 */
  putProviderBinding(record: ProviderBindingRecord): Promise<void> {
    const write = () => {
      const anchor = this.db.prepare('SELECT implementation_key FROM provider_binding WHERE id = ?').get(record.id) as { implementation_key: string } | undefined
      if (anchor !== undefined && anchor.implementation_key !== record.implementationKey) throw new Error('provider binding id already points at another implementation')
      this.db.prepare('INSERT INTO provider_binding (id, implementation_key) VALUES (?, ?) ON CONFLICT (id) DO NOTHING').run(record.id, record.implementationKey)
      if (record.isDefault) this.db.prepare('UPDATE workspace_binding SET is_default = 0 WHERE workspace_id = ? AND domain = ? AND binding_id <> ? AND is_default = 1').run(record.workspaceId, record.domain, record.id)
      this.db.prepare('INSERT INTO workspace_binding (workspace_id, binding_id, domain, enabled, is_default) VALUES (?, ?, ?, ?, ?) ON CONFLICT (workspace_id, binding_id, domain) DO UPDATE SET enabled = excluded.enabled, is_default = excluded.is_default').run(record.workspaceId, record.id, record.domain, toFlag(record.enabled), toFlag(record.isDefault))
    }
    return this.atomic(write)
  }
  listProviderBindings(workspaceId: WorkspaceId): Promise<readonly ProviderBindingRecord[]> { return this.mutate(() => (this.db.prepare(`SELECT ${BINDING_COLUMNS} FROM workspace_binding AS wb JOIN provider_binding AS b ON b.id = wb.binding_id WHERE wb.workspace_id = ? ORDER BY wb.rowid`).all(workspaceId) as Row[]).map(rowToBinding)) }
  putEntity(record: Entity): Promise<void> { return this.write('INSERT INTO entity (id, kind) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET kind = excluded.kind', record.id, record.kind) }
  putExternalIdentity(record: ExternalIdentity): Promise<void> {
    return this.write(`INSERT INTO external_identity (${IDENTITY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (binding_id, external_kind, external_id) DO UPDATE SET role = excluded.role`, record.id, record.entityId, record.bindingId, record.externalKind, record.externalId, record.role)
  }
  findExternalIdentity(bindingId: ProviderBindingId, externalKind: string, externalId: string): Promise<ExternalIdentity | undefined> {
    return this.mutate(() => optional(this.db.prepare(`SELECT ${IDENTITY_COLUMNS} FROM external_identity WHERE binding_id = ? AND external_kind = ? AND external_id = ?`).get(bindingId, externalKind, externalId), rowToIdentity))
  }
  listIdentitiesForEntity(entityId: EntityId): Promise<readonly ExternalIdentity[]> { return this.mutate(() => (this.db.prepare(`SELECT ${IDENTITY_COLUMNS} FROM external_identity WHERE entity_id = ? ORDER BY rowid`).all(entityId) as Row[]).map(rowToIdentity)) }
  putPlanningProjection(workspaceId: WorkspaceId, projection: WorkspaceProjection): Promise<void> { return this.mutate(() => this.upsertProjection(workspaceId, projection)) }
  protected upsertProjection(workspaceId: WorkspaceId, projection: WorkspaceProjection): void {
    const [kind, title, body, number, reason] = contentColumns(projection.content)
    this.db.prepare(`INSERT INTO workspace_projection (${PROJECTION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (workspace_id, entity_id) DO UPDATE SET planning_status = excluded.planning_status, content_kind = excluded.content_kind, content_title = excluded.content_title, content_body = excluded.content_body, content_number = excluded.content_number, redaction_reason = excluded.redaction_reason, revision = excluded.revision`).run(workspaceId, projection.entityId, projection.planningStatus, kind, title, body, number, reason, projection.revision)
  }
  getPlanningProjection(workspaceId: WorkspaceId, entityId: EntityId): Promise<WorkspaceProjection | undefined> {
    return this.mutate(() => optional(this.db.prepare(`SELECT ${PROJECTION_COLUMNS} FROM workspace_projection WHERE workspace_id = ? AND entity_id = ?`).get(workspaceId, entityId), rowToProjection))
  }
  listPlanningProjections(workspaceId: WorkspaceId): Promise<readonly WorkspaceProjection[]> { return this.mutate(() => (this.db.prepare(`SELECT ${PROJECTION_COLUMNS} FROM workspace_projection WHERE workspace_id = ? ORDER BY rowid`).all(workspaceId) as Row[]).map(rowToProjection)) }
  /** 收敛语义与内存替身一致：作用域 = 该 binding 的身份所指实体；作用域内未出现在 items 中的投影被移除，作用域外不受影响。刻意不删除实体——身份以外键指向 entity，删了会留下悬空身份。与内存替身的分叉见 `docs/exec-plan/active/2026-09-23-storage-sqlite-port.md` 遗留「`replacePlanningProjections` 的实体清理在两个实现间不一致」——按**名字**引用而不是编号：编号在重排与级联后必然漂移。 */
  replacePlanningProjections(scope: { readonly workspaceId: WorkspaceId; readonly bindingId: ProviderBindingId }, items: readonly WorkspaceProjection[]): Promise<void> {
    return this.atomic(() => {
      const incoming = items.map((item) => item.entityId)
      const keep = incoming.length === 0 ? '' : ` AND entity_id NOT IN (${incoming.map(() => '?').join(', ')})`
      this.db.prepare(`DELETE FROM workspace_projection WHERE workspace_id = ? AND entity_id IN (SELECT entity_id FROM external_identity WHERE binding_id = ?)${keep}`).run(scope.workspaceId, scope.bindingId, ...incoming)
      for (const item of items) this.upsertProjection(scope.workspaceId, item)
    })
  }
  putRepository(record: RepositoryRecord): Promise<void> {
    return this.write(`INSERT INTO repository (${REPOSITORY_COLUMNS}) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET workspace_id = excluded.workspace_id, external_identity_id = excluded.external_identity_id`, record.id, record.workspaceId, record.externalIdentityId)
  }
  listRepositories(workspaceId: WorkspaceId): Promise<readonly RepositoryRecord[]> { return this.mutate(() => (this.db.prepare(`SELECT ${REPOSITORY_COLUMNS} FROM repository WHERE workspace_id = ? ORDER BY rowid`).all(workspaceId) as Row[]).map(rowToRepository)) }
  currentRevision(workspaceId: WorkspaceId): Promise<number> { return this.mutate(() => (this.db.prepare('SELECT revision FROM workspace_revision WHERE workspace_id = ?').get(workspaceId) as { revision: number } | undefined)?.revision ?? 0) }
  advanceRevision(workspaceId: WorkspaceId): Promise<number> {
    return this.mutate(() => this.db.prepare('INSERT INTO workspace_revision (workspace_id, revision) VALUES (?, 1) ON CONFLICT (workspace_id) DO UPDATE SET revision = workspace_revision.revision + 1 RETURNING revision').get(workspaceId) as { revision: number }).then((row) => row.revision)
  }
}

/** 打开（必要时创建）库、应用缺失迁移并返回端口实现。迁移幂等：对已迁移的文件重复调用是 no-op。 */
export function createSqliteStorage(location: string | ':memory:'): SqliteStorage {
  const db = openDatabase(location)
  try { migrate(db) } catch (error) { db.close(); throw error }
  return new SqliteStorage(location, db)
}
