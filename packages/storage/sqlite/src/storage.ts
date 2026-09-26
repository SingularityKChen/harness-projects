/**
 * @harness-projects/storage-sqlite —— Storage 端口的 SQLite 实现：地基面（Batch L4 / #163）、同步面（Batch L5 / #164）与执行面（Batch L6 / #120、#5）。本文件是地基面：工作区 / 绑定 / 实体 / 身份 / 规划投影 / 仓库 / 投影修订号；同步面（成员关系 / 字段值 / 观察 / 游标）与**写者 / 读者路径机制**在 `storage-sync.ts`，执行面（执行上下文与运行 / 关系 / 写尝试）在 `storage-execution.ts`，本类按面逐层继承——机制只有那一份，本文件不再有队列、作用域标记、关闭标记、`mutate`、`transaction` 或 `close()`。端口三组的方法已全部落地（L6），因此没有 `UnimplementedPort` 桩。
 * 读写路径：每个方法都经过基类的唯一入口（`read` / `mutate` / `write`），因此外部读拿到**结算后**的值、看不到未提交的写入；事务在队列内从 BEGIN IMMEDIATE 持有到 COMMIT / ROLLBACK，重叠事务串行提交，在途事务期间的直接写入等到结算后才执行。多语句写入只有一个原子入口 `atomic`。代价也相同：事务的 work 里必须用 `tx.*`（队列内自等，用 AsyncLocalStorage 标记事务作用域）；嵌套事务在运行时被拒绝，抛错后 ROLLBACK、重开句柄读不到半写行（L3 计划遗留「嵌套事务在运行时静默吞写」）。快速失败文本由基类持有，这里只把它们转出包外；约定文本的整串断言在 `tests/contract/suites/storage.js`。列表顺序：端口未承诺顺序；本实现各列表的排序见各方法（地基面与同步面按 rowid / 业务键，执行面按主键序），调用方不得依赖。
 */
import type { ProviderBindingRecord, RepositoryRecord, Storage, StorageTransaction, WorkspaceRecord } from '@harness-projects/capabilities'
import type { Entity, EntityId, ExternalIdentity, ProviderBindingId, WorkspaceId, WorkspaceProjection } from '@harness-projects/domain'
import { openDatabase } from './db.ts'
import { migrate } from './migrate.ts'
import { contentColumns, optional, rowToBinding, rowToIdentity, rowToProjection, rowToRepository, rowToWorkspace, toFlag, type Row } from './storage-rows.ts'
import { SqliteExecutionSurface } from './storage-execution.ts'
import { type TransactionToken } from './storage-sync.ts'

export { CLOSED_MESSAGE, NESTED_TRANSACTION_MESSAGE, OUTER_INSTANCE_MESSAGE, SETTLED_TRANSACTION_MESSAGE } from './storage-sync.ts'

// 列清单只写一次：不写 SELECT *，加列时形状变化必须是显式的，而不是被映射层静默忽略。绑定列名与拆表前一致（工作区作用域三列来自挂载、实现键来自连接锚点），`rowToBinding` 因此不用改。
const BINDING_COLUMNS = 'b.id AS id, wb.workspace_id AS workspace_id, wb.domain AS domain, b.implementation_key AS implementation_key, wb.enabled AS enabled, wb.is_default AS is_default'
const IDENTITY_COLUMNS = 'id, entity_id, binding_id, external_kind, external_id, role'
const PROJECTION_COLUMNS = 'workspace_id, entity_id, planning_status, content_kind, content_title, content_body, content_number, redaction_reason, revision'
const REPOSITORY_COLUMNS = 'id, workspace_id, external_identity_id'

/** 地基面。事务作用域与存储实例共用同一连接与同一条队列，因此同一个类同时充当 Storage 与 StorageTransaction；作用域实例（`scoped`）已持有队列，它的读写直接执行。 */
export class SqliteStorage extends SqliteExecutionSurface implements Storage {
  /** 作用域实例就是本类的一个 `scoped` 副本：同一个连接、同一条队列、**共用**的关闭标记与本事务的令牌（见基类的 `transaction()`）。 */
  protected override scopedInstance(state: { closed: boolean }, token: TransactionToken): StorageTransaction { return new SqliteStorage(this.location, this.db, true, state, token) }

  putWorkspace(record: WorkspaceRecord): Promise<void> {
    return this.write('INSERT INTO workspace (id, name, status_policy) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, status_policy = excluded.status_policy', record.id, record.name, record.statusPolicy)
  }
  getWorkspace(id: WorkspaceId): Promise<WorkspaceRecord | undefined> { return this.read(() => optional(this.db.prepare('SELECT id, name, status_policy FROM workspace WHERE id = ?').get(id), rowToWorkspace)) }
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
  listProviderBindings(workspaceId: WorkspaceId): Promise<readonly ProviderBindingRecord[]> { return this.read(() => (this.db.prepare(`SELECT ${BINDING_COLUMNS} FROM workspace_binding AS wb JOIN provider_binding AS b ON b.id = wb.binding_id WHERE wb.workspace_id = ? ORDER BY wb.rowid`).all(workspaceId) as Row[]).map(rowToBinding)) }
  putEntity(record: Entity): Promise<void> { return this.write('INSERT INTO entity (id, kind) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET kind = excluded.kind', record.id, record.kind) }
  /** 身份全局一份：重复登记保留已分配的 id 与 entityId（否则引用会断），只更新角色。 */
  putExternalIdentity(record: ExternalIdentity): Promise<void> {
    return this.write(`INSERT INTO external_identity (${IDENTITY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (binding_id, external_kind, external_id) DO UPDATE SET role = excluded.role`, record.id, record.entityId, record.bindingId, record.externalKind, record.externalId, record.role)
  }
  findExternalIdentity(bindingId: ProviderBindingId, externalKind: string, externalId: string): Promise<ExternalIdentity | undefined> {
    return this.read(() => optional(this.db.prepare(`SELECT ${IDENTITY_COLUMNS} FROM external_identity WHERE binding_id = ? AND external_kind = ? AND external_id = ?`).get(bindingId, externalKind, externalId), rowToIdentity))
  }
  listIdentitiesForEntity(entityId: EntityId): Promise<readonly ExternalIdentity[]> { return this.read(() => (this.db.prepare(`SELECT ${IDENTITY_COLUMNS} FROM external_identity WHERE entity_id = ? ORDER BY rowid`).all(entityId) as Row[]).map(rowToIdentity)) }
  putPlanningProjection(workspaceId: WorkspaceId, projection: WorkspaceProjection): Promise<void> { return this.mutate(() => this.upsertProjection(workspaceId, projection)) }
  /** 投影 UPSERT：put 与 replace 共用；同 `(workspaceId, entityId)` 的第二次写入是覆盖，不是追加。 */
  protected upsertProjection(workspaceId: WorkspaceId, projection: WorkspaceProjection): void {
    const [kind, title, body, number, reason] = contentColumns(projection.content)
    this.db.prepare(`INSERT INTO workspace_projection (${PROJECTION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (workspace_id, entity_id) DO UPDATE SET planning_status = excluded.planning_status, content_kind = excluded.content_kind, content_title = excluded.content_title, content_body = excluded.content_body, content_number = excluded.content_number, redaction_reason = excluded.redaction_reason, revision = excluded.revision`).run(workspaceId, projection.entityId, projection.planningStatus, kind, title, body, number, reason, projection.revision)
  }
  getPlanningProjection(workspaceId: WorkspaceId, entityId: EntityId): Promise<WorkspaceProjection | undefined> {
    return this.read(() => optional(this.db.prepare(`SELECT ${PROJECTION_COLUMNS} FROM workspace_projection WHERE workspace_id = ? AND entity_id = ?`).get(workspaceId, entityId), rowToProjection))
  }
  listPlanningProjections(workspaceId: WorkspaceId): Promise<readonly WorkspaceProjection[]> { return this.read(() => (this.db.prepare(`SELECT ${PROJECTION_COLUMNS} FROM workspace_projection WHERE workspace_id = ? ORDER BY rowid`).all(workspaceId) as Row[]).map(rowToProjection)) }
  /** 收敛语义与内存替身一致：作用域 = 该 binding 的身份所指实体；作用域内未出现在 items 中的投影被移除，作用域外不受影响。刻意不删除实体——身份以外键指向 entity，删了会留下悬空身份；内存替身同语义（实体与身份保留），判据是共享地基组「投影被收敛移除后实体与身份保留，条目可以重新加入」。 */
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
  listRepositories(workspaceId: WorkspaceId): Promise<readonly RepositoryRecord[]> { return this.read(() => (this.db.prepare(`SELECT ${REPOSITORY_COLUMNS} FROM repository WHERE workspace_id = ? ORDER BY rowid`).all(workspaceId) as Row[]).map(rowToRepository)) }
  currentRevision(workspaceId: WorkspaceId): Promise<number> { return this.read(() => (this.db.prepare('SELECT revision FROM workspace_revision WHERE workspace_id = ?').get(workspaceId) as { revision: number } | undefined)?.revision ?? 0) }
  /** 单调递增是端口职责（库层只保证非负）：UPSERT + RETURNING 让读改写在一个语句里完成，排队保证并发调用不会读到同一个旧值。 */
  advanceRevision(workspaceId: WorkspaceId): Promise<number> {
    return this.mutate(() => this.db.prepare('INSERT INTO workspace_revision (workspace_id, revision) VALUES (?, 1) ON CONFLICT (workspace_id) DO UPDATE SET revision = workspace_revision.revision + 1 RETURNING revision').get(workspaceId) as { revision: number }).then((row) => row.revision)
  }
}

/** 打开（必要时创建）库、应用缺失迁移并返回端口实现。迁移幂等：对已迁移的文件重复调用是 no-op。自检失败时构造函数已关掉句柄（P3），因此这里不重复关闭。 */
export function createSqliteStorage(location: string | ':memory:'): SqliteStorage {
  const db = openDatabase(location)
  try { migrate(db) } catch (error) { db.close(); throw error }
  return new SqliteStorage(location, db)
}
