/**
 * @harness-projects/storage-sqlite —— 执行面（Batch L6 / #120、#5）：执行上下文与运行、关系、写尝试。
 *
 * 这是端口三组里最后落地的一组，继承 `SqliteSyncSurface`（写者 / 读者路径机制 + 同步面），因此三组在同一个实例上排
 * **同一条**队列。**本文件的每个读方法都经过基类的 `read`**（`getExecutionContext` / `findActiveExecutionContext` /
 * `getExecutionRun` / `listRelations` / `findMutationAttempt` / `listMutationAttempts`），与写方法共用同一个 `mutate`：
 * 事务在途时的外部读排到结算之后，因此拿到的永远是已提交的值，看不到未提交的写入（直接读同一连接会看见自己的事务）。
 * 多语句写入走基类的 `atomic`（作用域实例上直接执行，根实例上包一个事务）：`putExecutionContext`（先关同键旧 active、
 * 再写新行）与 `putRelation`（先写 confirmed、再删候选行）失败时整体回滚，不留半写。
 *
 * 执行上下文：同一 (工作区, 工作项, 仓库) 最多一个 active，由 003 的部分唯一索引
 * `execution_context_active`（`status IN ('planned','provisioning','ready')`）保证。端口因此必须先把同键的旧 active 置为
 * `closed` 再写新行——与内存替身同一语义，且两步在同一个队列槽里，中间态不会被别的写入看见。
 *
 * 关系：按 `relation.state` 路由——confirmed 进 `relation`，candidate 进 `candidate_relation`；候选升为 confirmed 时删掉
 * 候选行，同键已有 confirmed 时写 candidate 是 no-op（AGENTS.md §1.1 不变量 5：关键关联显式优先，候选不得降级已确认）。
 * `listRelations` 合并两张表返回，读路径不依赖"某个键只在其中一张表里"。
 *
 * 写尝试：落在 `mutation_attempt`，模型是**一行一键**——003 的主键就是 `(workspace_id, idempotency_key)`，同键写入是
 * **幂等覆盖**（后写的状态取代先写的），`id` 由调用方派生、在工作区内唯一（`UNIQUE (workspace_id, id)` 拒绝复用）。
 * 覆盖写成单语句 UPSERT，查与写之间没有窗口。DDL 的 `created_at` / `updated_at` 是 NOT NULL 而端口记录没有时间戳，
 * 插入时用同一个 ISO-8601 UTC 时刻填两列（覆盖时保留 `created_at`）；端口不读回这两列，因此它们不构成第二套事实。
 */
import type { ExecutionContextRecord, ExecutionRunRecord, MutationAttemptRecord } from '@harness-projects/capabilities'
import type { EntityId, ExecutionContextId, ExecutionRunId, Relation, WorkspaceId } from '@harness-projects/domain'
import { optional, rowToExecutionContext, rowToExecutionRun, rowToMutationAttempt, rowToRelation, type Row } from './storage-rows.ts'
import { SqliteSyncSurface } from './storage-sync.ts'

// 列清单只写一次：不写 SELECT *，加列时形状变化必须是显式的，而不是被映射层静默忽略。
const CONTEXT_COLUMNS = 'id, workspace_id, work_item_id, repository_id, status, branch_external_id, worktree_external_id, provisioning_started_at'
const RUN_COLUMNS = 'id, workspace_id, context_id, status, updated_at'
const ATTEMPT_COLUMNS = 'id, workspace_id, binding_id, command_name, idempotency_key, state, expected_source_version, error_code'
/** 两张关系表的列名相同：路由到哪张表由 `state` 决定，读回形状因此只有一份。 */
const RELATION_COLUMNS = 'from_entity_id, to_entity_id, relation_type, relation_class, source, state'
/** 关系定位键的 SQL 片段：两张表的主键相同，路由、去重与删除都按它定位。 */
const RELATION_KEY = 'workspace_id = ? AND from_entity_id = ? AND to_entity_id = ? AND relation_type = ?'
/** 与 003 的部分唯一索引 `execution_context_active` 写的是同一组状态：只有这三个算 active。 */
const ACTIVE_CONTEXT_STATUSES: readonly string[] = ['planned', 'provisioning', 'ready']
const ACTIVE_CONTEXT_SQL = ACTIVE_CONTEXT_STATUSES.map((status) => `'${status}'`).join(', ')
/** `mutation_attempt` 的两个时间戳列：端口没有这两个字段，插入时用同一个时刻填上（读回不暴露）。 */
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

/** 执行面。地基面（`storage.ts`）继承它；事务、写队列、读入口与同步面由 `SqliteSyncSurface` 提供。 */
export class SqliteExecutionSurface extends SqliteSyncSurface {
  /**
   * 同一 (工作区, 工作项, 仓库) 最多一个 active：写入 active 行前先把同键的其它 active 置为 `closed`，
   * 否则 003 的部分唯一索引会拒绝第二行（内存替身做的是同一件事）。非 active 写入不关闭任何行。
   * 被强制关闭的行连同 `provisioning_started_at` 一起清成 NULL：端口契约写明该列"终态为 undefined"，
   * 而终态是**实现**在这里产生的状态迁移，不是调用方传进来的记录（L6 评审 F3）。
   * 两条语句（先关同键旧 active、再 UPSERT 新行）必须整体生效，因此走 `atomic`：根实例上第二条语句失败时，第一条
   * 关掉的旧 active 必须随事务回滚，而不是留下"旧行已关、新行没写"的半写（第五轮评审）。
   */
  putExecutionContext(record: ExecutionContextRecord): Promise<void> {
    return this.atomic(() => {
      if (ACTIVE_CONTEXT_STATUSES.includes(record.status)) {
        this.db.prepare(`UPDATE execution_context SET status = 'closed', provisioning_started_at = NULL
          WHERE workspace_id = ? AND work_item_id = ? AND repository_id = ? AND id <> ? AND status IN (${ACTIVE_CONTEXT_SQL})`)
          .run(record.workspaceId, record.workItemId, record.repositoryId, record.id)
      }
      this.db.prepare(`INSERT INTO execution_context (${CONTEXT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET workspace_id = excluded.workspace_id, work_item_id = excluded.work_item_id,
          repository_id = excluded.repository_id, status = excluded.status, branch_external_id = excluded.branch_external_id,
          worktree_external_id = excluded.worktree_external_id, provisioning_started_at = excluded.provisioning_started_at`)
        .run(record.id, record.workspaceId, record.workItemId, record.repositoryId, record.status,
          record.branchExternalId ?? null, record.worktreeExternalId ?? null, record.provisioningStartedAt ?? null)
    })
  }

  /** 读走基类的 `read`：事务在途时排到结算之后，拿到的是已提交的值。 */
  getExecutionContext(id: ExecutionContextId): Promise<ExecutionContextRecord | undefined> {
    return this.read(() => optional(this.db.prepare(`SELECT ${CONTEXT_COLUMNS} FROM execution_context WHERE id = ?`).get(id), rowToExecutionContext))
  }

  /** 与 `putExecutionContext` 用同一份 active 状态集：唯一的 active 行由部分唯一索引保证，取一行即可。读同样走 `read`。 */
  findActiveExecutionContext(workspaceId: WorkspaceId, workItemId: EntityId, repositoryId: EntityId): Promise<ExecutionContextRecord | undefined> {
    return this.read(() => optional(this.db.prepare(`SELECT ${CONTEXT_COLUMNS} FROM execution_context
      WHERE workspace_id = ? AND work_item_id = ? AND repository_id = ? AND status IN (${ACTIVE_CONTEXT_SQL}) ORDER BY id LIMIT 1`)
      .get(workspaceId, workItemId, repositoryId), rowToExecutionContext))
  }

  putExecutionRun(record: ExecutionRunRecord): Promise<void> {
    return this.write(`INSERT INTO execution_run (${RUN_COLUMNS}) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET workspace_id = excluded.workspace_id, context_id = excluded.context_id,
        status = excluded.status, updated_at = excluded.updated_at`,
      record.id, record.workspaceId, record.contextId, record.status, record.updatedAt)
  }

  getExecutionRun(id: ExecutionRunId): Promise<ExecutionRunRecord | undefined> {
    return this.read(() => optional(this.db.prepare(`SELECT ${RUN_COLUMNS} FROM execution_run WHERE id = ?`).get(id), rowToExecutionRun))
  }

  /**
   * 按 `relation.state` 路由：confirmed → `relation`，candidate → `candidate_relation`。
   * 候选升为 confirmed 时删掉候选行，否则 `listRelations` 会同时返回两条同键关系；同键已有 confirmed 时写 candidate 是
   * no-op——不变量 5 的直接推论：候选不得降级已确认。顺序是先写 confirmed 再删候选：确认写入若被约束拒绝，候选行原样保留。
   * 两条语句必须整体生效，因此走 `atomic`：根实例上第二条语句失败时，已写的 confirmed 行必须随事务回滚（第五轮评审）。
   * 方法体里的 `SELECT 1 ... FROM relation` 是**写路径内部**的读改写（判据 + 写入在同一个原子作用域里，中间态不可见），
   * 不是独立的读方法；六个读方法一律走基类的 `read`。
   */
  putRelation(workspaceId: WorkspaceId, relation: Relation): Promise<void> {
    return this.atomic(() => {
      const key: readonly [string, string, string, string] = [workspaceId, relation.from, relation.to, relation.type]
      if (relation.state === 'confirmed') {
        this.#upsertRelation('relation', workspaceId, relation)
        this.db.prepare(`DELETE FROM candidate_relation WHERE ${RELATION_KEY}`).run(...key)
        return
      }
      if (this.db.prepare(`SELECT 1 AS present FROM relation WHERE ${RELATION_KEY}`).get(...key) !== undefined) return
      this.#upsertRelation('candidate_relation', workspaceId, relation)
    })
  }

  /** 关系行的 UPSERT：两张表的列与主键相同，只有表名不同，因此只有一份语句；同键重复写入是幂等覆盖。 */
  #upsertRelation(table: 'relation' | 'candidate_relation', workspaceId: WorkspaceId, relation: Relation): void {
    this.db.prepare(`INSERT INTO ${table} (workspace_id, from_entity_id, to_entity_id, relation_type, relation_class, source, state)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (workspace_id, from_entity_id, to_entity_id, relation_type)
      DO UPDATE SET relation_class = excluded.relation_class, source = excluded.source, state = excluded.state`)
      .run(workspaceId, relation.from, relation.to, relation.type, relation.class, relation.source, relation.state)
  }

  /** 合并两张表返回：确认行在前、候选行在后，各自按主键排序。端口不承诺列表顺序（本层计划遗留「列表读路径的顺序」：
   * 替身按插入序返回，SQLite 侧各列表各自 `ORDER BY`），实现只是给一个确定顺序，调用方不得依赖它。两条 SELECT 在同一个
   * `read` 槽里，因此合并结果来自同一份已结算的状态。 */
  listRelations(workspaceId: WorkspaceId): Promise<readonly Relation[]> {
    return this.read(() => {
      const order = 'ORDER BY from_entity_id, to_entity_id, relation_type'
      const confirmed = this.db.prepare(`SELECT ${RELATION_COLUMNS} FROM relation WHERE workspace_id = ? ${order}`).all(workspaceId) as Row[]
      const candidates = this.db.prepare(`SELECT ${RELATION_COLUMNS} FROM candidate_relation WHERE workspace_id = ? ${order}`).all(workspaceId) as Row[]
      return [...confirmed, ...candidates].map(rowToRelation)
    })
  }

  /**
   * 写尝试取**一行一键**模型（003 的主键就是 `(workspace_id, idempotency_key)`）：同键写入是**幂等覆盖**——后写的状态
   * 取代先写的，而不是"保留首次结果"；`id` 由调用方派生、在工作区内唯一，由 `UNIQUE (workspace_id, id)` 拒绝复用。
   * `created_at` 保留首次写入的时刻（它是"这行什么时候建的"），`updated_at` 随每次覆盖推进；两列都不在端口面上，
   * 因此不构成第二套事实。
   */
  putMutationAttempt(record: MutationAttemptRecord): Promise<void> {
    return this.write(`INSERT INTO mutation_attempt (${ATTEMPT_COLUMNS}, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${NOW_SQL}, ${NOW_SQL})
      ON CONFLICT (workspace_id, idempotency_key) DO UPDATE SET id = excluded.id, binding_id = excluded.binding_id,
        command_name = excluded.command_name, state = excluded.state, expected_source_version = excluded.expected_source_version,
        error_code = excluded.error_code, updated_at = excluded.updated_at`,
      record.id, record.workspaceId, record.bindingId, record.commandName, record.idempotencyKey, record.state,
      record.expectedSourceVersion ?? null, record.errorCode ?? null)
  }

  findMutationAttempt(workspaceId: WorkspaceId, idempotencyKey: string): Promise<MutationAttemptRecord | undefined> {
    return this.read(() => optional(this.db.prepare(`SELECT ${ATTEMPT_COLUMNS} FROM mutation_attempt WHERE workspace_id = ? AND idempotency_key = ? ORDER BY id LIMIT 1`)
      .get(workspaceId, idempotencyKey), rowToMutationAttempt))
  }

  listMutationAttempts(workspaceId: WorkspaceId): Promise<readonly MutationAttemptRecord[]> {
    return this.read(() => (this.db.prepare(`SELECT ${ATTEMPT_COLUMNS} FROM mutation_attempt WHERE workspace_id = ? ORDER BY id`).all(workspaceId) as Row[]).map(rowToMutationAttempt))
  }
}
