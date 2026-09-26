/**
 * @harness-projects/storage-sqlite —— 写者 / 读者路径机制与同步面（Batch L5 / #164）：成员关系、字段值、观察账本与游标。
 *
 * **机制只有这一份**，落在 `SqliteSyncSurface`：`SqliteStorage`（地基面 `storage.ts`）继承它，因此两个面在同一个
 * 实例上排**同一条**队列，而不是各有一条。四件机制各自只有一处声明：
 *   - `#queue`：实例级串行点。`mutate` 是唯一入口，`read` 复用同一条队列——外部读因此拿到**结算后**的值，
 *     永远看不到未提交的写入；`write` 是单语句变更的便捷入口，`atomic` 是多语句变更的**唯一原子入口**
 *     （作用域内直接执行，根实例上包一层 `transaction`），方法体不再各自决定要不要开事务。
 *   - `TX_SCOPE`（`AsyncLocalStorage<TransactionToken>`）：事务作用域标记。令牌是**可变对象**（2026-09-24 评审）：
 *     `active` 在结算的 `finally` 里置假，因此 work 里派生的定时器或回调在提交之后调外层实例不再被误判成
 *     "队列内自等"；作用域实例自己也检查 `active`，泄漏出 work 的 `tx` 在结算后以 `SETTLED_TRANSACTION_MESSAGE`
 *     快速失败，而不是绕开队列、被并进**下一个**在途事务（调用方拿到 resolved，写入却随那次回滚消失）。
 *   - `#state`：根实例与作用域实例**共用**的关闭标记——否则 `close()` 之后 work 里的 `tx.*` 仍打到已关闭的句柄上。
 *     `close()` 幂等；关闭后的任何调用（含在途事务与已排队变更）以 `CLOSED_MESSAGE` 快速失败，不把驱动文案抛给调用方。
 * 事务在队列内从 `BEGIN IMMEDIATE` 持有到 `COMMIT` / `ROLLBACK`；作用域实例再开事务在 `transaction()` 入口被拒。
 * 快速失败文本是同一族的**约定**文本：两个字面量各自维护（依赖方向不允许共享常量），漂移由契约套件的整串断言钉住。
 * 与内存替身的差别在三处——读取时刻（事务在途时替身的外部读立刻看到旧值，队列化的读者等到结算）、活性（在 work 里调外层实例：SQLite 快速失败，替身的写排到本事务之后、await 即永久挂起）、作用域生命周期（结算后与未 await 的 `tx.*`：SQLite 拒绝，替身照常落库）——不在可见性：两者都不暴露未提交数据；分叉登记在本层计划的遗留清单。
 *
 * 观察账本的主体是**端口主体** `(binding_id, object_kind, object_external_id)`（L3 的 003）：端口的去重键
 * `(bindingId, dedupeKey)` 与定序主体 `subject` 都是连接级的，而条目 id 是会被 `putMembership` 改写的**当前挂载点**，
 * 不能进只追加账本的身份键——放进去会让定序主体随成员关系漂移、"对账先到、成员关系后到"表达不出来。由此观察
 * **不解析落点、也不要求成员关系存在**，端口与 DDL 不再各说一套。定序与 committed 的主体与端口 subject 逐字相同：
 * 一个工作区可以连接多个提供方（不变量 2），每个绑定有**自己的**版本序列，少了这一维第二个 provider 的首条观察
 * 会被判成乱序而静默丢弃。比较器只有 `capabilities` 的 `compareSourceVersion` 一份（码点序，与视图的 BINARY 等价）；
 * `recordObservation` 在入口拒绝非 ASCII 的 `sourceVersion`，让"载体必须可比"从注释变成契约。
 *
 * 落库形态（安全，本层决定）：`snapshot_json` **原样**持久化整条 `ProviderObservation`——`payload` 由 provider 负责脱敏，storage 不裁剪、不改写、不丢弃（见 `ProviderObservation` 的契约注释；本层计划遗留「`payload` 由 provider 先脱敏」已收口）。
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { compareSourceVersion, isComparableSourceVersion, type FieldValueRecord, type MembershipRecord, type ObservationRecord, type ReconcileCursorRecord, type StorageTransaction, type SyncCursorRecord } from '@harness-projects/capabilities'
import type { ProviderBindingId, WorkspaceId } from '@harness-projects/domain'
import type { WorkspaceDatabase } from './db.ts'
import { optional, rowToFieldValue, rowToMembership, rowToReconcileCursor, rowToSyncCursor, type Row } from './storage-rows.ts'
import { UnimplementedPort } from './storage-unimplemented.ts'

// 列清单只写一次：不写 SELECT *，加列时形状变化必须是显式的，而不是被映射层静默忽略。
const MEMBERSHIP_COLUMNS = 'workspace_id, project_external_id, item_external_id, content_external_kind, content_external_id, membership_created_at, membership_updated_at'
const FIELD_VALUE_COLUMNS = 'workspace_id, item_external_id, project_field_id, value, observed_at'
const SYNC_CURSOR_COLUMNS = 'binding_id, scope_key, cursor_value, state, last_error_code'
/** 观察账本列（与 003 的 DDL 同序）：主体是端口主体 `(binding_id, object_kind, object_external_id)`，`observed_at` 是本地接收时刻（同版本的 tie-breaker），`updated_at` 是平台版本载体（R4），`dedupe_key` 是端口去重键的落点。 */
const OBSERVATION_COLUMNS = 'binding_id, object_kind, object_external_id, observed_at, dedupe_key, updated_at, snapshot_json, state'

/** 端口层的写参数只出现这三种（id / 文本 / 0-1 标志），不需要把驱动的完整输入类型暴露到方法签名上。 */
type WriteParam = string | number | null

/** 事务作用域误用的约定文本族（调用方按前缀识别），完整文本由契约套件的整串断言钉住；关闭与结算后各有文本。 */
export const NESTED_TRANSACTION_MESSAGE = '嵌套事务不被支持：一个事务内不得再开事务'
export const OUTER_INSTANCE_MESSAGE = '嵌套事务不被支持：事务内必须用 tx.*，调用外层实例会在队列内自等'
export const CLOSED_MESSAGE = '存储实例已关闭：关闭前必须等在途事务结算'
export const SETTLED_TRANSACTION_MESSAGE = '事务作用域已结算：tx.* 只能在所属事务的 work 内使用（常见成因是漏写 await）'
/**
 * 事务作用域令牌：只有"本实例 work 内部"的调用看得见，事务在途时的外部读照常排队，不会被误判成自等。
 * `active` 可变：见文件头注释（结算后作用域实例快速失败、外层实例不再被误判）。
 */
export interface TransactionToken { readonly owner: SqliteSyncSurface; active: boolean }
const TX_SCOPE = new AsyncLocalStorage<TransactionToken>()

/** 重写前的 003 缺端口主体列与 `dedupe_key`：显式报错，把"旧库"变成一句可执行的处置，而不是第一次写观察时的驱动级报错。 */
const REWRITTEN_003_MESSAGE = '本地库是重写前的 003（sync_observation 缺端口主体列或 dedupe_key）：请删除库文件重建'

/** 列值 → 端口版本：`undefined` 的 `sourceVersion` 落库时空串（列 NOT NULL），读回必须还原，否则两条都没有 `sourceVersion` 的合法观察里第二条会被判成乱序。 */
const columnToVersion = (value: string | undefined): string | undefined => (value === '' ? undefined : value)

/** SQLite 可能已经自动回滚；不要用回滚错误覆盖真正的失败原因。 */
const rollbackQuietly = (db: WorkspaceDatabase): void => { try { db.exec('ROLLBACK') } catch { /* 已回滚 */ } }

/**
 * 写者 / 读者路径机制 + 同步面。机制只在这里声明一次：子类（地基面）不再各写一份队列。
 * 私有 `#` 辅助（`#assertRewrittenSchema` / `#hasSeenObservation` / `#committedVersion`）**不是入口**：它们只在构造函数里
 * 或 `mutate` 体内被调用，自己从不单独碰连接——因此"读必须经过 `read`"这条对端口方法成立，对它们也成立。
 */
export class SqliteSyncSurface extends UnimplementedPort {
  protected readonly db: WorkspaceDatabase
  /** 库文件位置：重启用例靠它关掉句柄后再打开同一个文件。 */
  readonly location: string
  /** 事务作用域标记：作用域实例已持有队列（读写直接执行），并在 `transaction()` 入口拒绝嵌套。 */
  protected readonly scoped: boolean
  /** 实例级写队列：直接写入、事务与读排同一条队列，因此同一实例只有一个串行点。 */
  #queue: Promise<unknown> = Promise.resolve()
  /** 作用域实例与根实例**共用**同一份状态（2026-09-24 评审）：否则 `close()` 之后 work 里的 `tx.*` 仍打到已关闭的句柄上。 */
  #state: { closed: boolean }
  /** 本实例作为作用域实例时所持的令牌；根实例上写入它没有读者（根实例认 `TX_SCOPE` 里的令牌）。 */
  #token: TransactionToken | undefined
  constructor(location: string, db: WorkspaceDatabase, scoped = false, state?: { closed: boolean }, token?: TransactionToken) {
    super(); this.location = location; this.db = db; this.scoped = scoped
    this.#state = state ?? { closed: false }; this.#token = token
    // 自检失败必须把句柄关掉（P3）：`createSqliteStorage` 拿不到实例，它那条 catch 也就无从关闭，句柄会一直泄漏。
    if (!scoped) { try { this.#assertRewrittenSchema() } catch (error) { this.db.close(); throw error } }
  }

  /**
   * 003 重写后的库自检（P3）：`migrate()` 只按**版本号**判断是否已应用、不校验迁移体内容，因此已应用版本 3 的旧库
   * 会保留旧列集合，直到第一次写观察才炸在驱动层（实测 `recordObservation -> no such column: dedupe_key`）。这里把
   * 驱动级报错换成一句可执行的处置。只在根实例上跑（作用域实例共用同一个刚查过的句柄）；未迁移时不判定。
   */
  #assertRewrittenSchema(): void {
    const migrated = this.db.prepare(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`).get()
    if (migrated === undefined) return
    const schema = this.db.prepare(`SELECT (SELECT count(*) FROM schema_migrations WHERE version = 3) AS applied,
      (SELECT count(*) FROM pragma_table_info('sync_observation') WHERE name IN ('object_kind','dedupe_key')) AS subject_columns`).get() as { applied: number; subject_columns: number }
    if (schema.applied > 0 && schema.subject_columns < 2) throw new Error(REWRITTEN_003_MESSAGE)
  }

  /**
   * **唯一读写入口**。轮到自己之前不碰连接：事务在途时的直接写入与外部读都等到结算（提交或回滚）后再执行，
   * 而不是被静默并进事务、随回滚一起消失，也不会读到未提交的值。作用域实例已持有队列、直接执行；在 work 里调
   * 外层实例会队列内自等，命中事务作用域标记即拒；关闭后一律快速失败。
   */
  protected mutate<T>(fn: () => T | PromiseLike<T>): Promise<T> {
    if (this.#state.closed) return Promise.reject(new Error(CLOSED_MESSAGE))
    if (this.scoped) {
      // 作用域实例只在所属事务的**动态范围**内有效：结算之后再用它就是误用（泄漏出 work 的 tx、漏写 await）。执行时再查一次：fn 推迟一个微任务，未 await 的写入否则会在 ROLLBACK 之后以自动提交落库（第五轮评审）。
      if (this.#token === undefined || !this.#token.active) return Promise.reject(new Error(SETTLED_TRANSACTION_MESSAGE))
      const token = this.#token; return Promise.resolve().then(() => { if (!token.active) throw new Error(SETTLED_TRANSACTION_MESSAGE); return fn() })
    }
    const token = TX_SCOPE.getStore()
    if (token !== undefined && token.owner === this && token.active) return Promise.reject(new Error(OUTER_INSTANCE_MESSAGE))
    const run = this.#queue.then(() => { if (this.#state.closed) throw new Error(CLOSED_MESSAGE); return fn() })
    this.#queue = run.then(() => undefined, () => undefined); return run
  }
  /** 读入口：复用**同一条**队列（不是第二个串行点）。读与写在同一个 `mutate` 上排队，外部读因此只看到已结算的值。 */
  protected read<T>(fn: () => T): Promise<T> { return this.mutate(fn) }
  /** 单语句变更：与多语句变更走同一条队列，方法体因此不必各自包一层 `mutate`。 */
  protected write(sql: string, ...params: readonly WriteParam[]): Promise<void> {
    return this.mutate(() => { this.db.prepare(sql).run(...params) })
  }
  /**
   * 多语句写入的**唯一原子入口**（2026-09-24 评审）：作用域实例已在事务内，直接执行；根实例上包一层
   * `transaction`。写者路径因此只有"单语句"与"一个原子作用域"两种，方法体不再各自决定要不要开事务。
   */
  protected atomic<T>(fn: () => T): Promise<T> {
    if (this.scoped) return this.mutate(fn)
    return this.transaction(async () => fn())
  }

  /**
   * 事务作用域实例的构造点：与根实例**同一个类**、同一个连接、同一条队列，只有 `scoped` 置真——`tx.*` 因此直接
   * 执行，而 `tx.transaction()` 在入口被拒。基类不能引用子类（子类要继承它），所以由地基面覆写；没有覆写时显式
   * 失败，而不是悄悄把根实例当作用域实例用（那会让 work 里的 `tx.*` 排到自己后面，队列内自等）。作用域实例必须
   * 拿到**共用**的关闭标记与本事务的令牌，否则结算后的 `tx.*` 会绕开队列。
   */
  protected scopedInstance(_state: { closed: boolean }, _token: TransactionToken): StorageTransaction {
    throw new Error('SqliteSyncSurface 的子类必须实现 scopedInstance()：作用域实例不能由基类构造')
  }

  /** 事务在队列内持有 BEGIN IMMEDIATE 到提交/回滚：重叠事务按调用顺序串行，不会撞上"事务里再开事务"的驱动级错误。失败一律 ROLLBACK——半写行重开句柄就再也读不到（集成用例的判别点）；关闭时未提交的事务以 CLOSED_MESSAGE 失败，而不是驱动文案。 */
  async transaction<T>(work: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    if (this.scoped) throw new Error(NESTED_TRANSACTION_MESSAGE)
    return this.mutate(async () => {
      this.db.exec('BEGIN IMMEDIATE')
      const token: TransactionToken = { owner: this, active: true }
      this.#token = token
      try {
        const result = await TX_SCOPE.run(token, () => work(this.scopedInstance(this.#state, token)))
        if (this.#state.closed) throw new Error(CLOSED_MESSAGE)
        this.db.exec('COMMIT'); return result
      } catch (error) { rollbackQuietly(this.db); throw error } finally { token.active = false }
    })
  }
  /** 关闭底层句柄：重启用例必须真的关掉再打开。它不是端口方法（内存替身没有这一步）。**幂等**；调用方必须先在途事务结算，未结算就关时在途事务与已排队变更都以 CLOSED_MESSAGE 快速失败。 */
  close(): void { if (this.#state.closed) return; this.#state.closed = true; this.db.close() }

  /**
   * 成员关系（R1）：两条唯一索引都必须收敛——同 `(工作区, 条目)` 幂等覆盖，同 `(工作区, 项目, 内容)` 后者胜。
   * 后者胜意味着旧条目已经不存在，所以它挂载的字段值先清掉：DDL 没有 ON DELETE CASCADE，端口是唯一写者，
   * 留着就是挂在不存在条目上的行。**观察账本不在这里清**（P1）：账本只追加，删行会让"同一观察再投递必须返回
   * false"在换条目这一格上失效，而调用方正是据此决定是否重放副作用；旧条目上的账本行是历史，不随条目 id 消失
   * （003 本轮去掉了账本到成员关系的外键）。三条语句必须整体生效，因此走 `atomic`（根实例上是**一个事务**）。
   */
  putMembership(record: MembershipRecord): Promise<void> {
    return this.atomic(() => {
      const stale = 'workspace_id = ? AND project_external_id = ? AND content_external_kind = ? AND content_external_id = ? AND item_external_id <> ?'
      const staleParams: readonly WriteParam[] = [record.workspaceId, record.projectExternalId, record.contentKind, record.contentExternalId, record.itemExternalId]
      const orphans = `SELECT item_external_id FROM project_item_membership WHERE ${stale}`
      this.db.prepare(`DELETE FROM planning_field_value WHERE workspace_id = ? AND item_external_id IN (${orphans})`).run(record.workspaceId, ...staleParams)
      this.db.prepare(`DELETE FROM project_item_membership WHERE ${stale}`).run(...staleParams)
      this.db.prepare(`INSERT INTO project_item_membership (${MEMBERSHIP_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (workspace_id, item_external_id) DO UPDATE SET project_external_id = excluded.project_external_id,
          content_external_kind = excluded.content_external_kind, content_external_id = excluded.content_external_id,
          membership_created_at = excluded.membership_created_at, membership_updated_at = excluded.membership_updated_at`)
        .run(record.workspaceId, record.projectExternalId, record.itemExternalId, record.contentKind, record.contentExternalId,
          record.membershipCreatedAt ?? null, record.membershipUpdatedAt ?? null)
    })
  }

  getMembership(workspaceId: WorkspaceId, itemExternalId: string): Promise<MembershipRecord | undefined> {
    return this.read(() => optional(this.db.prepare(`SELECT ${MEMBERSHIP_COLUMNS} FROM project_item_membership WHERE workspace_id = ? AND item_external_id = ?`).get(workspaceId, itemExternalId), rowToMembership))
  }

  /** 列表按项目作用域：同一个工作区里别的项目不得混进来（R1 的 `(工作区, 项目, 内容)` 唯一约束正是这个作用域）。 */
  listMemberships(workspaceId: WorkspaceId, projectExternalId: string): Promise<readonly MembershipRecord[]> {
    return this.read(() => (this.db.prepare(`SELECT ${MEMBERSHIP_COLUMNS} FROM project_item_membership WHERE workspace_id = ? AND project_external_id = ? ORDER BY item_external_id`).all(workspaceId, projectExternalId) as Row[]).map(rowToMembership))
  }

  /** 字段值（R2）：键 `(工作区, 条目, 项目字段)`，不含可选值 id；挂在成员关系上，悬空写入由外键拒绝。 */
  putFieldValue(record: FieldValueRecord): Promise<void> {
    return this.write(`INSERT INTO planning_field_value (${FIELD_VALUE_COLUMNS}) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (workspace_id, item_external_id, project_field_id) DO UPDATE SET value = excluded.value, observed_at = excluded.observed_at`,
      record.workspaceId, record.itemExternalId, record.projectFieldId, record.value, record.observedAt)
  }

  listFieldValues(workspaceId: WorkspaceId, itemExternalId: string): Promise<readonly FieldValueRecord[]> {
    return this.read(() => (this.db.prepare(`SELECT ${FIELD_VALUE_COLUMNS} FROM planning_field_value WHERE workspace_id = ? AND item_external_id = ? ORDER BY project_field_id`).all(workspaceId, itemExternalId) as Row[]).map(rowToFieldValue))
  }

  /**
   * 观察（R4）：`false` = 本次观察未被应用（重复**或**乱序），调用方不得读成"已应用"。账本只追加，插入是裸
   * `INSERT`——键里含 `dedupe_key`，两条**不同**的观察在物理上不可能互相顶掉；已见的 `(bindingId, dedupeKey)`
   * 在入口就被挡回，因此"同一观察再投递一次"永远第二次返回 `false`（换条目也一样，见 `putMembership`）。
   * `sourceVersion` 缺失时按空串落 `updated_at`，读回时由 `columnToVersion` 还原再比较；非 ASCII 在入口拒绝。
   */
  recordObservation(record: ObservationRecord): Promise<boolean> {
    return this.mutate(() => {
      const { observation } = record
      if (observation.sourceVersion !== undefined && !isComparableSourceVersion(observation.sourceVersion)) {
        throw new Error(`sourceVersion 必须是可比的 ASCII 载体：${observation.sourceVersion}`)
      }
      if (this.#hasSeenObservation(observation.bindingId, observation.dedupeKey)) return false
      const committed = this.#committedVersion(observation.bindingId, observation.subject.objectKind, observation.subject.externalId)
      if (committed !== undefined && compareSourceVersion(observation.sourceVersion, committed) < 0) return false
      this.db.prepare(`INSERT INTO sync_observation (${OBSERVATION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(observation.bindingId, observation.subject.objectKind, observation.subject.externalId, observation.receivedTime,
          observation.dedupeKey, observation.sourceVersion ?? '', JSON.stringify(record), record.state)
      return true
    })
  }

  /** 去重账本：`dedupe_key` 是 003 的一等列（`(binding_id, dedupe_key)` 上有唯一索引），不再靠 `json_extract` 扫快照。 */
  #hasSeenObservation(bindingId: ProviderBindingId, dedupeKey: string): boolean {
    const row = this.db.prepare('SELECT 1 AS seen FROM sync_observation WHERE binding_id = ? AND dedupe_key = ? LIMIT 1')
      .get(bindingId, dedupeKey)
    return row !== undefined
  }

  /**
   * 已提交版本：同一**端口主体** `(绑定, 对象种类, 对象 id)` 里 `updated_at` 最大、同版本时 `observed_at` 最新的
   * 那一行（与 `committed_observation` 视图同一判据）。主体与端口 subject 逐字相同：一个工作区可以连接多个提供方，
   * 各自的版本序列互不相干，少了 binding 这一维第二个 provider 的首条观察会被判成乱序而静默返回 `false`。
   */
  #committedVersion(bindingId: ProviderBindingId, objectKind: string, objectExternalId: string): string | undefined {
    const row = this.db.prepare(`SELECT updated_at FROM sync_observation WHERE binding_id = ? AND object_kind = ? AND object_external_id = ?
      ORDER BY updated_at DESC, observed_at DESC LIMIT 1`).get(bindingId, objectKind, objectExternalId) as { updated_at: string } | undefined
    return row === undefined ? undefined : columnToVersion(row.updated_at)
  }

  getSyncCursor(bindingId: ProviderBindingId, scopeKey: string): Promise<SyncCursorRecord | undefined> {
    return this.read(() => optional(this.db.prepare(`SELECT ${SYNC_CURSOR_COLUMNS} FROM sync_cursor WHERE binding_id = ? AND scope_key = ?`).get(bindingId, scopeKey), rowToSyncCursor))
  }

  /**
   * 增量游标按 `(绑定, scopeKey)` 定位：同一个 scopeKey 在不同绑定下是两条游标，scope 由调用方定义（R5）。
   * **工作区维度缺失**（#189 / ADR-0006 的逐记录作用域表把 `SyncCursorRecord` 判为工作区级）：绑定是跨工作区
   * 共享的连接锚点，同一绑定被多个工作区挂载时，ws-1 同步失败写 `degraded`、ws-2 随后成功写 `healthy`，ws-1
   * 就显示 `healthy`（core 的 freshness 只读这一处）。收口条件在**端口层**——键里补 `workspaceId` 是签名变更、
   * 会波及 core，所以本层不改 DDL、也不在 SQLite 侧单方面加列；本行只记录结论并指向 #189。
   */
  putSyncCursor(record: SyncCursorRecord): Promise<void> {
    return this.write(`INSERT INTO sync_cursor (${SYNC_CURSOR_COLUMNS}) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (binding_id, scope_key) DO UPDATE SET cursor_value = excluded.cursor_value, state = excluded.state, last_error_code = excluded.last_error_code`,
      record.bindingId, record.scopeKey, record.cursorValue ?? null, record.state, record.lastErrorCode ?? null)
  }

  /** 对账游标（R5）：只记工作区上次全量对账时刻，**没有**平台 `updated_at` 增量游标列。 */
  getReconcileCursor(workspaceId: WorkspaceId): Promise<ReconcileCursorRecord | undefined> {
    return this.read(() => optional(this.db.prepare('SELECT workspace_id, last_reconciled_at FROM reconcile_cursor WHERE workspace_id = ?').get(workspaceId), rowToReconcileCursor))
  }

  putReconcileCursor(record: ReconcileCursorRecord): Promise<void> {
    return this.write(`INSERT INTO reconcile_cursor (workspace_id, last_reconciled_at) VALUES (?, ?)
      ON CONFLICT (workspace_id) DO UPDATE SET last_reconciled_at = excluded.last_reconciled_at`, record.workspaceId, record.lastReconciledAt)
  }
}
