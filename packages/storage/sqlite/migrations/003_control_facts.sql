-- 003_control_facts：Gate E1 R4/R5/R6/R8 与执行、关系、恢复不变量；每张表和约束均在上方标注 D8 出处。
-- 首次 MVP 发布前遵循控制计划 D10，不承担迁移兼容成本。

-- repository：执行事实必须有可追溯的工作区仓库（AGENTS.md §1.1 不变量 5：关键关联显式优先；本层计划 Batch L3-A）。
CREATE TABLE repository (
  id TEXT PRIMARY KEY, -- 执行表主键（D6）
  workspace_id TEXT NOT NULL REFERENCES workspace (id), -- AGENTS.md §1.1 不变量 1
  external_identity_id TEXT NOT NULL REFERENCES external_identity (id), -- R7 身份锚点
  UNIQUE (workspace_id, external_identity_id), -- 一个工作区不重复登记同一仓库
  UNIQUE (workspace_id, id) -- 供执行上下文的复合外键引用，让"仓库属于同一工作区"由库保证（不变量 5）
);

-- execution_context：执行上下文属于工作项、仓库和工作区（AGENTS.md §1.1 不变量 5；本层计划 Batch L3-A）。
CREATE TABLE execution_context (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace (id),
  work_item_id TEXT NOT NULL REFERENCES entity (id),
  repository_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','provisioning','ready','closed','failed')),
  branch_external_id TEXT,
  worktree_external_id TEXT,
  provisioning_started_at TEXT,
  -- 不变量 5：执行上下文引用的仓库必须属于同一个工作区（复合外键，2026-09-24 评审）。
  FOREIGN KEY (workspace_id, repository_id) REFERENCES repository (workspace_id, id),
  -- 供 execution_run 的复合外键引用（见下）。
  UNIQUE (workspace_id, id)
);
-- 同一工作项与仓库最多一个 active 上下文（docs/architecture/release-gates.md R1 第 10 项：Start Work 失败恢复的补偿语义；本层计划 Batch L3-A）。
CREATE UNIQUE INDEX execution_context_active ON execution_context (workspace_id, work_item_id, repository_id) WHERE status IN ('planned','provisioning','ready');

-- execution_run：一次执行运行属于一个上下文（docs/architecture/release-gates.md R1 第 10 项：Start Work 失败恢复已验证；本层计划 Batch L3-A）。
CREATE TABLE execution_run (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace (id),
  context_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','starting','running','succeeded','failed','canceled','timed_out','unknown')),
  updated_at TEXT NOT NULL,
  -- 不变量 5：运行引用的执行上下文必须属于同一个工作区（复合外键，2026-09-24 评审）。
  FOREIGN KEY (workspace_id, context_id) REFERENCES execution_context (workspace_id, id)
);

-- relation：确认态关系；两个端点都必须是 entity（AGENTS.md §1.1 不变量 5 与 6；本层计划 Batch L3-A）。
CREATE TABLE relation (
  workspace_id TEXT NOT NULL REFERENCES workspace (id),
  from_entity_id TEXT NOT NULL REFERENCES entity (id),
  to_entity_id TEXT NOT NULL REFERENCES entity (id),
  relation_type TEXT NOT NULL,
  relation_class TEXT NOT NULL CHECK (relation_class IN ('business_semantics','system_fact','lineage')),
  -- 来源取 domain 的 RelationSource 全部取值：显式确认产出 (explicit, confirmed)，而"确定性候选升为 confirmed"
  -- 保留 deterministic（packages/core/src/relations.ts 的 confirmRelation 只改 state、不改 source）。
  source TEXT NOT NULL CHECK (source IN ('explicit','deterministic','lineage')),
  state TEXT NOT NULL CHECK (state = 'confirmed'),
  PRIMARY KEY (workspace_id, from_entity_id, to_entity_id, relation_type)
);
-- candidate_relation：规则发现只能进入候选表（AGENTS.md §1.1 不变量 5）。
-- provenance 记在 source 上：端口能表达的 provenance 粒度就是 domain 的 RelationSource（explicit / deterministic /
-- lineage）；更细的 EdgeProvenance 属于 core 的推导输入，落库前已被 sourceForProvenance 归约。
CREATE TABLE candidate_relation (
  workspace_id TEXT NOT NULL REFERENCES workspace (id),
  from_entity_id TEXT NOT NULL REFERENCES entity (id),
  to_entity_id TEXT NOT NULL REFERENCES entity (id),
  relation_type TEXT NOT NULL,
  relation_class TEXT NOT NULL CHECK (relation_class IN ('business_semantics','system_fact','lineage')),
  source TEXT NOT NULL CHECK (source IN ('deterministic','lineage')),
  -- 候选行的 state 恒为 candidate：SQLite 实现必须由 putRelation 按 relation.state 路由（L6 接入；端口不新增方法）。
  state TEXT NOT NULL CHECK (state = 'candidate'),
  PRIMARY KEY (workspace_id, from_entity_id, to_entity_id, relation_type)
);

-- sync_observation：R4 的观察账本。**主体 = 端口的观察主体** `(binding, object_kind, object_external_id)`，作用域是**连接**。
-- 判据：端口的去重键 `(bindingId, dedupeKey)` 与定序主体 `subject` 都是连接级的；条目 id 是会被 `putMembership`
-- 改写的**当前挂载点**，因此它不能进只追加账本的身份键——放进去会让定序主体随成员关系漂移、"对账先到、成员关系
-- 后到"表达不出来、同一条连接挂多个工作区时落点取决于挂载顺序（第三轮评审实测的三格）。
-- 由此：观察**可以先于成员关系落账**；账本不引用 `project_item_membership`。
-- `observed_at` 取 provider 填入的 `receivedTime`（同版本的 tie-breaker），`updated_at` 是平台版本载体（R4），`dedupe_key` 是端口去重键。
-- `updated_at` 的落库编码（NOT NULL）：`undefined` 落**空串**；空串**不是合法载体**（`isComparableSourceVersion` 要求非空），
-- 因此空串只表示「没有版本」，读回时必须还原成 `undefined`。
-- 定序（updated_at 更小者拒绝、相等时整快照替换）**由 Storage 端口实现**，不是库级约束：跨行比较无法用 CHECK 表达，
-- 判据是 `packages/capabilities` 导出的 `compareSourceVersion`（码点序，与下面的 BINARY 比较等价）。
CREATE TABLE sync_observation (
  binding_id TEXT NOT NULL REFERENCES provider_binding (id),
  object_kind TEXT NOT NULL,
  object_external_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL, -- provider 控制的 payload（脱敏责任在 provider，storage 原样保存）；凭据列审计见 tests/integration/execution-relation-write-schema.test.js
  state TEXT NOT NULL CHECK (state IN ('pending','processed','ignored','failed')),
  PRIMARY KEY (binding_id, object_kind, object_external_id, observed_at, dedupe_key)
);
-- R4 的去重键是端口的 `(bindingId, dedupeKey)`：做成库级唯一之后，同一观察在物理上不可能落两行，
-- 端口也不必靠"先查后插"维持只追加（查与插之间的窗口在库层被关掉）。
CREATE UNIQUE INDEX sync_observation_dedupe ON sync_observation (binding_id, dedupe_key);

-- committed_observation：每个**端口主体**的已提交快照 = updated_at 最大、同版本时 observed_at 最新、
-- 再同则 rowid 最大（最后追加）的那一行。主体键与端口 subject 逐字相同：本层只有内存替身，SQLite 实现由
-- L4–L6 接入，接入后必须按同一个键定序。同版本时替身取最后写入、本视图取 observed_at 最新，两者可能选出不同快照（统一规则见 #201）。
-- 比较是 SQLite 的 BINARY（UTF-8 字节序），与 `compareSourceVersion` 的码点序等价。
-- R4 的"乱序观察不得覆盖新观察"因此是**构造性**的：旧行即使落进账本也永远不是 committed，不需要触发器。
-- 它是视图而不是表：committed 是由账本派生的当前事实，物化成第二张表就是同一事实的第二个家。
CREATE VIEW committed_observation AS
SELECT ledger.* FROM sync_observation AS ledger
WHERE NOT EXISTS (
  SELECT 1 FROM sync_observation AS newer
  WHERE newer.binding_id = ledger.binding_id
    AND newer.object_kind = ledger.object_kind
    AND newer.object_external_id = ledger.object_external_id
    AND (newer.updated_at > ledger.updated_at
      OR (newer.updated_at = ledger.updated_at AND newer.observed_at > ledger.observed_at)
      OR (newer.updated_at = ledger.updated_at AND newer.observed_at = ledger.observed_at AND newer.rowid > ledger.rowid))
);

-- sync_cursor：增量游标属于 provider binding 与调用方 scope（既有端口 SyncCursorRecord 的形状；本层计划 Batch L3-A）。作用域语义上是工作区级（ADR-0006），但键只含 binding：两个工作区共用一条连接时会串台，收口见 #189。
CREATE TABLE sync_cursor (
  binding_id TEXT NOT NULL REFERENCES provider_binding (id),
  scope_key TEXT NOT NULL,
  cursor_value TEXT,
  state TEXT NOT NULL CHECK (state IN ('idle','syncing','healthy','degraded','failed')),
  last_error_code TEXT,
  PRIMARY KEY (binding_id, scope_key)
);

-- reconcile_cursor：R5 只记录工作区上次全量对账时刻；不含平台 updated_at 增量游标列。
CREATE TABLE reconcile_cursor (
  workspace_id TEXT NOT NULL REFERENCES workspace (id),
  last_reconciled_at TEXT NOT NULL,
  UNIQUE (workspace_id)
);

-- webhook_subscription：R6 记录订阅事实，但不是成员关系或字段值的外键来源。作用域：工作区（唯一键含 workspace_id）。
CREATE TABLE webhook_subscription (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace (id),
  binding_id TEXT NOT NULL REFERENCES provider_binding (id),
  scope_key TEXT NOT NULL,
  event_name TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  UNIQUE (workspace_id, binding_id, scope_key, event_name)
);

-- mutation_attempt：R8 的外部写入尝试，端口既有 `MutationAttemptRecord` 的**唯一一个家**
-- （`putMutationAttempt` / `findMutationAttempt` / `listMutationAttempts`），写者与读者就是这三个端口方法（SQLite 实现由 L4–L6 接入）。作用域：工作区（主键含 workspace_id）。
-- **模型：一行一键**——`(workspace_id, idempotency_key)` 是主键，写入是幂等覆盖（UPSERT），`id` 在工作区内唯一。
-- 判据：三个消费者需求（未决行是否阻塞重试、上一次结果是什么、审计记录）都由同一行回答，不需要定序列，
-- 也不需要"取最后一次"。历史尝试不是任何消费者的需求（YAGNI）；"一行一次尝试"要为此引入 `attempt_seq`、
-- 端口序号语义与 core 派生 id 的改动，代价大于收益。
-- 结果轴用 domain 的 `WriteState`（pending / saved / unknown / conflict / failed），不自造第二套词表：
-- L1 记录的四个取值是"怎么得知结果的"（confirmed / reconciled / rejected / unresolved），映射到结果轴，
-- 作为证据记在层计划里，不冻结成第二套状态列。
-- **"未决行存在时不得发起第二次外部写"是调用方的义务，当前没有强制点**：core 在外部写完成后才落写尝试行，Start Work 靠执行上下文租约防重（#204）；
-- storage 只保证同键只有一行、不会被并发写成两行。端口注释与替身与本表同模型。
CREATE TABLE mutation_attempt (
  workspace_id TEXT NOT NULL REFERENCES workspace (id),
  idempotency_key TEXT NOT NULL,
  id TEXT NOT NULL,
  binding_id TEXT NOT NULL REFERENCES provider_binding (id),
  command_name TEXT NOT NULL,
  -- R8：幂等键由调用方选择；"加入既有内容"这一步取 content_id，"创建内容"这一步的键形状仍未证明（L1 记录 §3 第 6 条）。
  state TEXT NOT NULL CHECK (state IN ('pending','saved','unknown','conflict','failed')),
  expected_source_version TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, idempotency_key),
  -- id 由调用方派生（core 用 `write:<commandName>:<idempotencyKey>`，不含工作区），因此唯一性只能限定在工作区内。
  UNIQUE (workspace_id, id)
);

-- workspace_revision：工作区修订计数器（AGENTS.md §1.1 不变量 7：Host 拥有权威状态）。
-- 单调增长是**端口职责**（advanceRevision / currentRevision），库层只保证非负；契约套件钉住单调性。
CREATE TABLE workspace_revision (
  workspace_id TEXT PRIMARY KEY REFERENCES workspace (id),
  revision INTEGER NOT NULL CHECK (revision >= 0)
);
