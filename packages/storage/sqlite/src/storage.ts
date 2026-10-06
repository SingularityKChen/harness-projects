/**
 * @harness-projects/storage-sqlite —— Storage 端口的 SQLite 实现：地基面（Batch L4 / #163）、同步面（Batch L5 / #164）与执行面（Batch L6 / #120、#5）。本文件是地基面：工作区 / 绑定 / 实体 / 身份 / 规划投影 / 仓库 / 投影修订号；同步面（成员关系 / 字段值 / 观察 / 游标）与**写者 / 读者路径机制**在 `storage-sync.ts`，执行面（执行上下文与运行 / 关系 / 写尝试）在 `storage-execution.ts`，本类按面逐层继承——机制只有那一份，本文件不再有队列、作用域标记、关闭标记、`mutate`、`transaction` 或 `close()`。端口三组的方法已全部落地（L6），因此没有 `UnimplementedPort` 桩。
 * 读写路径：每个方法都经过基类的唯一入口（`read` / `mutate` / `write`），因此外部读拿到**结算后**的值、看不到未提交的写入；事务在队列内从 BEGIN IMMEDIATE 持有到 COMMIT / ROLLBACK，重叠事务串行提交，在途事务期间的直接写入等到结算后才执行。多语句写入只有一个原子入口 `atomic`。代价也相同：事务的 work 里必须用 `tx.*`（队列内自等，用 AsyncLocalStorage 标记事务作用域）；嵌套事务在运行时被拒绝，抛错后 ROLLBACK、重开句柄读不到半写行（L3 计划遗留「嵌套事务在运行时静默吞写」）。快速失败文本由基类持有，这里只把它们转出包外；约定文本的整串断言在 `tests/contract/suites/storage.js`。列表顺序：端口未承诺顺序；本实现各列表的排序见各方法（地基面与同步面按 rowid / 业务键，执行面按主键序），调用方不得依赖。
 */
import type { BindingConfigurationRecord, ConnectorAccountRecord, ProviderBindingRecord, RepositoryRecord, Storage, StorageTransaction, StorageValidationPolicy, WorkspaceRecord } from '@harness-projects/capabilities'
import { EMPTY_POLICY, bindingRefOf, parseBindingConfiguration, parseBindingRef, parseConnectorAccount, snapshotPolicy } from '@harness-projects/capabilities'
import { parseExternalIdentityKind, type ConnectorAccountId, type Entity, type EntityId, type ExternalIdentity, type ProviderBindingId, type WorkspaceId, type WorkspaceProjection } from '@harness-projects/domain'
import { openDatabase } from './db.ts'
import { migrate } from './migrate.ts'
import { contentColumns, optional, rowToBinding, rowToBindingConfiguration, rowToConnectorAccount, rowToIdentity, rowToProjection, rowToRepository, rowToWorkspace, toFlag, type Row } from './storage-rows.ts'
import { SqliteExecutionSurface } from './storage-execution.ts'
import { CONNECTOR_ACCOUNT_SCHEMA_MESSAGE, isConnectorAccountShapeMissing, type TransactionToken } from './storage-sync.ts'

export { CLOSED_MESSAGE, CONNECTOR_ACCOUNT_SCHEMA_MESSAGE, LEGACY_COMMITTED_VERSION_MESSAGE, NESTED_TRANSACTION_MESSAGE, OUTER_INSTANCE_MESSAGE, SETTLED_TRANSACTION_MESSAGE } from './storage-sync.ts'

// 列清单只写一次：不写 SELECT *，加列时形状变化必须是显式的，而不是被映射层静默忽略。绑定列名与拆表前一致（工作区作用域三列来自挂载、实现键来自连接锚点），`rowToBinding` 因此不用改。
const BINDING_COLUMNS = 'b.id AS id, wb.workspace_id AS workspace_id, wb.domain AS domain, b.implementation_key AS implementation_key, wb.enabled AS enabled, wb.is_default AS is_default'
const IDENTITY_COLUMNS = 'id, entity_id, binding_id, external_kind, external_id, role'
const PROJECTION_COLUMNS = 'workspace_id, entity_id, planning_status, content_kind, content_title, content_body, content_number, redaction_reason, revision'
const REPOSITORY_COLUMNS = 'id, workspace_id, external_identity_id'
/** #126：账号列清单只写一次。 */
const ACCOUNT_COLUMNS = 'id, platform_family, platform_origin, identity_kind, external_id, display_name, secret_handle, connection_state'

/** 地基面。事务作用域与存储实例共用同一连接与同一条队列，因此同一个类同时充当 Storage 与 StorageTransaction；作用域实例（`scoped`）已持有队列，它的读写直接执行。 */
export class SqliteStorage extends SqliteExecutionSurface implements Storage {
  /** 作用域实例就是本类的一个 `scoped` 副本：同一个连接、同一条队列、**共用**的关闭标记与本事务的令牌（见基类的 `transaction()`），并传同一份受信策略。 */
  protected override scopedInstance(state: { closed: boolean }, token: TransactionToken): StorageTransaction { return new SqliteStorage(this.location, this.db, true, state, token, this.policy) }

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
  /** 卸载一个挂载：配置是同一行的列，随行删除；账号 FK、连接锚点、外部身份与同步历史都在别的表上，故意不动（#126）。畸形 ref 先以 `RangeError` 拒绝（对抗验证 P3-3），缺失挂载重复移除仍是 no-op（DELETE 命中 0 行）。 */
  async removeProviderBinding(ref: { readonly workspaceId: WorkspaceId; readonly bindingId: ProviderBindingId; readonly domain: string }): Promise<void> {
    const parsed = parseBindingRef(ref)
    return this.write('DELETE FROM workspace_binding WHERE workspace_id = ? AND binding_id = ? AND domain = ?', parsed.workspaceId, parsed.bindingId, parsed.domain)
  }

  /** 账号写入（#126）：闭集解析走 capabilities 共用解析器；同 id 换自然键、同自然键换 id 在任何写入之前拒绝（`ON CONFLICT … DO UPDATE` 只更新可变列）。 */
  async putConnectorAccount(record: ConnectorAccountRecord): Promise<void> {
    const parsed = parseConnectorAccount(record, this.policy)
    const key = [parsed.platformFamily, parsed.platformOrigin, parsed.identityKind, parsed.externalId]
    return this.atomic(() => {
      const sameId = this.db.prepare('SELECT platform_family, platform_origin, identity_kind, external_id FROM connector_account WHERE id = ?').get(parsed.id) as Row | undefined
      if (sameId !== undefined && [sameId.platform_family, sameId.platform_origin, sameId.identity_kind, sameId.external_id].some((value, index) => value !== key[index])) {
        throw new RangeError('connector account id already points at another identity')
      }
      const owner = this.db.prepare('SELECT id FROM connector_account WHERE platform_family = ? AND platform_origin = ? AND identity_kind = ? AND external_id = ?').get(...key) as { id: string } | undefined
      if (owner !== undefined && owner.id !== parsed.id) throw new RangeError('connector account identity is already registered under another id')
      this.db.prepare(`INSERT INTO connector_account (id, platform_family, platform_origin, identity_kind, external_id, display_name, secret_handle, connection_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name, secret_handle = excluded.secret_handle, connection_state = excluded.connection_state`)
        .run(parsed.id, ...key, parsed.displayName, parsed.secretHandle ?? null, parsed.connectionState)
    })
  }
  /** 账号读口：读回**独立副本**并复验闭集（对抗验证 P2-3）：裸 SQL / 旧进程写进不允许的句柄时不静默返回它，而是与写口同文本拒绝。 */
  getConnectorAccount(id: ConnectorAccountId): Promise<ConnectorAccountRecord | undefined> {
    return this.read(() => optional(this.db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM connector_account WHERE id = ?`).get(id), rowToConnectorAccount))
      .then((record) => (record === undefined ? undefined : parseConnectorAccount(record, this.policy)))
  }
  listConnectorAccounts(): Promise<readonly ConnectorAccountRecord[]> {
    return this.read(() => (this.db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM connector_account ORDER BY rowid`).all() as Row[]).map(rowToConnectorAccount))
      .then((records) => records.map((record) => parseConnectorAccount(record, this.policy)))
  }
  /** 初次关联（#126）：账号与锚点必须存在；锚点已有外部身份 / 观察 / 游标 / webhook / 写尝试事实时拒绝。事实检查与写 FK 同在 `atomic` 内；同账号重复是 no-op。 */
  async setProviderBindingAccount(bindingId: ProviderBindingId, accountId: ConnectorAccountId): Promise<void> {
    return this.atomic(() => {
      if (this.db.prepare('SELECT 1 AS present FROM provider_binding WHERE id = ?').get(bindingId) === undefined) throw new RangeError('connection anchor does not exist')
      if (this.db.prepare('SELECT 1 AS present FROM connector_account WHERE id = ?').get(accountId) === undefined) throw new RangeError('connector account does not exist')
      const current = this.db.prepare('SELECT connector_account_id FROM provider_binding WHERE id = ?').get(bindingId) as { connector_account_id: string | null }
      if (current.connector_account_id !== null) {
        if (current.connector_account_id === accountId) return
        throw new RangeError('connection anchor is already associated with another connector account')
      }
      const facts = [
        'SELECT 1 FROM external_identity WHERE binding_id = ? LIMIT 1',
        'SELECT 1 FROM sync_observation WHERE binding_id = ? LIMIT 1',
        'SELECT 1 FROM sync_cursor WHERE binding_id = ? LIMIT 1',
        'SELECT 1 FROM webhook_subscription WHERE binding_id = ? LIMIT 1',
        'SELECT 1 FROM mutation_attempt WHERE binding_id = ? LIMIT 1',
      ]
      if (facts.some((sql) => this.db.prepare(sql).get(bindingId) !== undefined)) {
        throw new RangeError('connection anchor already has external facts: create a new binding id instead')
      }
      this.db.prepare('UPDATE provider_binding SET connector_account_id = ? WHERE id = ?').run(accountId, bindingId)
    })
  }
  getProviderBindingAccount(bindingId: ProviderBindingId): Promise<ConnectorAccountId | undefined> {
    return this.read(() => {
      const row = this.db.prepare('SELECT connector_account_id FROM provider_binding WHERE id = ?').get(bindingId) as { connector_account_id: string | null } | undefined
      return row?.connector_account_id == null ? undefined : row.connector_account_id as ConnectorAccountId
    })
  }
  /** 配置写入（#126）：先校验 record / ref 外形（畸形 ref 在解引用之前以 `RangeError` 拒绝），再查真实挂载与它的 implementationKey，按受信 schema 逐字段校验；不接收调用者声称的实现键。 */
  async putBindingConfiguration(record: BindingConfigurationRecord): Promise<void> {
    const ref = bindingRefOf(record)
    return this.atomic(() => {
      const mount = this.db.prepare('SELECT b.implementation_key AS implementation_key FROM workspace_binding AS wb JOIN provider_binding AS b ON b.id = wb.binding_id WHERE wb.workspace_id = ? AND wb.binding_id = ? AND wb.domain = ?')
        .get(ref.workspaceId, ref.bindingId, ref.domain) as { implementation_key: string } | undefined
      if (mount === undefined) throw new RangeError('binding configuration references an unknown workspace mount')
      const parsed = parseBindingConfiguration(record, this.policy, mount.implementation_key)
      this.db.prepare('UPDATE workspace_binding SET configuration_json = ? WHERE workspace_id = ? AND binding_id = ? AND domain = ?')
        .run(JSON.stringify(parsed.configuration), ref.workspaceId, ref.bindingId, ref.domain)
    })
  }
  /** 配置读口：按真实锚点的 implementationKey 复验闭集并返回独立副本；`async` 让畸形 ref 与其它端口方法一样异步拒绝（P3-R1）。 */
  async getBindingConfiguration(ref: { readonly workspaceId: WorkspaceId; readonly bindingId: ProviderBindingId; readonly domain: string }): Promise<BindingConfigurationRecord | undefined> {
    const parsed = parseBindingRef(ref)
    return this.read(() => optional(this.db.prepare('SELECT wb.workspace_id, wb.binding_id, wb.domain, wb.configuration_json, b.implementation_key FROM workspace_binding AS wb JOIN provider_binding AS b ON b.id = wb.binding_id WHERE wb.workspace_id = ? AND wb.binding_id = ? AND wb.domain = ? AND wb.configuration_json IS NOT NULL')
      .get(parsed.workspaceId, parsed.bindingId, parsed.domain), (row) => ({ record: rowToBindingConfiguration(row), implementationKey: row.implementation_key as string })))
      .then((found) => (found === undefined ? undefined : parseBindingConfiguration(found.record, this.policy, found.implementationKey)))
  }
  putEntity(record: Entity): Promise<void> { return this.write('INSERT INTO entity (id, kind) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET kind = excluded.kind', record.id, record.kind) }
  /** 身份全局一份：重复登记保留已分配的 id 与 entityId（否则引用会断），只更新角色。种类先过 domain 的解析器：未知种类在任何写入之前以与替身相同的 RangeError（Promise 拒绝）失败，不依赖 002 的 CHECK 措辞；CHECK 是第二道防线。 */
  async putExternalIdentity(record: ExternalIdentity): Promise<void> {
    parseExternalIdentityKind(record.externalKind)
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
  /** 挂载键是 `(工作区, id)`（#187 / #188）：同值重复登记是 no-op；同键换外部身份响亮失败而不覆盖——`ON CONFLICT … DO NOTHING` 对它是静默忽略，所以先比对；同工作区同身份换 id 由 `UNIQUE (workspace_id, external_identity_id)` 拒绝。 */
  putRepository(record: RepositoryRecord): Promise<void> {
    return this.atomic(() => {
      const kind = this.db.prepare('SELECT external_kind FROM external_identity WHERE id = ?').get(record.externalIdentityId) as { external_kind: string } | undefined
      if (kind !== undefined && kind.external_kind !== 'repository') throw new Error('repository external identity is not a repository identity') // TD-004；不存在由外键拒绝
      const mounted = this.db.prepare('SELECT external_identity_id FROM repository WHERE workspace_id = ? AND id = ?').get(record.workspaceId, record.id) as { external_identity_id: string } | undefined
      if (mounted !== undefined && mounted.external_identity_id !== record.externalIdentityId) throw new Error('repository mount already points at another external identity')
      this.db.prepare(`INSERT INTO repository (${REPOSITORY_COLUMNS}) VALUES (?, ?, ?) ON CONFLICT (workspace_id, id) DO NOTHING`).run(record.id, record.workspaceId, record.externalIdentityId)
    })
  }
  listRepositories(workspaceId: WorkspaceId): Promise<readonly RepositoryRecord[]> { return this.read(() => (this.db.prepare(`SELECT ${REPOSITORY_COLUMNS} FROM repository WHERE workspace_id = ? ORDER BY rowid`).all(workspaceId) as Row[]).map(rowToRepository)) }
  currentRevision(workspaceId: WorkspaceId): Promise<number> { return this.read(() => (this.db.prepare('SELECT revision FROM workspace_revision WHERE workspace_id = ?').get(workspaceId) as { revision: number } | undefined)?.revision ?? 0) }
  /** 单调递增是端口职责（库层只保证非负）：UPSERT + RETURNING 让读改写在一个语句里完成，排队保证并发调用不会读到同一个旧值。 */
  advanceRevision(workspaceId: WorkspaceId): Promise<number> {
    return this.mutate(() => this.db.prepare('INSERT INTO workspace_revision (workspace_id, revision) VALUES (?, 1) ON CONFLICT (workspace_id) DO UPDATE SET revision = workspace_revision.revision + 1 RETURNING revision').get(workspaceId) as { revision: number }).then((row) => row.revision)
  }
}

/**
 * 打开（必要时创建）库、应用缺失迁移并返回端口实现；迁移幂等，失败关句柄后原样抛出。
 * `preflight`（#126）：旧 002 形状（版本 2 已记账但没有连接账号表/列）必须在任何待应用迁移之前只读拒绝（`migrate` 只按版本号跳过）；拒绝零写入，构造函数自检再查同一判据。
 * 受信策略先在任何 IO 之前快照（P2-R1）：非法策略既不留迁移写入，也不打开句柄；构造函数也在 `try` 内。
 */
export function createSqliteStorage(location: string | ':memory:', policy: StorageValidationPolicy = EMPTY_POLICY): SqliteStorage {
  snapshotPolicy(policy)
  const db = openDatabase(location)
  try {
    if (isConnectorAccountShapeMissing(db)) throw new Error(CONNECTOR_ACCOUNT_SCHEMA_MESSAGE)
    migrate(db)
    return new SqliteStorage(location, db, false, undefined, undefined, policy)
  } catch (error) { try { db.close() } catch { /* 构造函数已关：幂等 */ } throw error }
}
