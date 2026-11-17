-- 001_init：单一自包含物理基线（issue #417；#596）：迁移记账表与全部当前业务表、索引与约束，按原迁移顺序排列。
-- 决策：不提供 downgrade；首次 MVP 发布前允许整份基线重写，回滚靠从备份恢复。
-- 原 002–007 片段已并入本文件；005 的版本载体历史（issue #203/#415）不含 DDL，其退役说明保留在此。
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
-- 002_identity_membership：Gate E1 裁决 R1 / R2 / R3 / R7 与 AGENTS.md §1.1 不变量在库层面的落点（issue #27）。

-- workspace：AGENTS.md §1.1 不变量 1（一个工作空间同一时刻只有一个 Planning 事实源）的作用域。
CREATE TABLE workspace (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- 取值集合来自 packages/domain/src/status.ts 的 StatusPolicy（不变量 3：规划状态与工程执行状态正交）。
  status_policy TEXT NOT NULL CHECK (status_policy IN ('provider_authoritative', 'host_authoritative', 'manual_only'))
);

-- connector_account：连接账号的**全局身份**（issue #126）。自然键 (platform_family, platform_origin, identity_kind, external_id) 由唯一索引拒绝重复；
-- 不变量 5（关键关联显式优先）：账号对上层可见，凭据值不进库——`secret_handle` 只保存受信策略 allowlist 里的引用名。
CREATE TABLE connector_account (
  id TEXT PRIMARY KEY,
  platform_family TEXT NOT NULL,
  -- 规范 HTTPS origin（无 userinfo / 路径 / query / fragment）；显式区分 github.com 与 Enterprise。
  platform_origin TEXT NOT NULL,
  -- 取值集合来自 packages/capabilities/src/connector-account.ts 的 ConnectorIdentityKind（不变量 5：身份种类是显式关联语义）。
  identity_kind TEXT NOT NULL CHECK (identity_kind IN ('account', 'installation')),
  external_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  -- 可空：NULL 表示无认证账号；allowlist 的权威在受信策略，不由 SQL 内容反推（issue #126）。
  secret_handle TEXT,
  -- 取值集合来自 ConnectorConnectionState（不变量 3：观察状态不承诺句柄可 resolve 或 Provider 权限仍有效）。
  connection_state TEXT NOT NULL CHECK (connection_state IN ('connected', 'disconnected', 'reauth_required')),
  -- 不变量 6：账号自然键唯一，重复登记不产生第二行。
  UNIQUE (platform_family, platform_origin, identity_kind, external_id)
);

-- provider_binding：**连接锚点**（issue #27 Scope 的 connector accounts；ADR-0006）。
CREATE TABLE provider_binding (
  id TEXT PRIMARY KEY,
  -- 连接通向哪个 provider 实现；同一个 id 换实现即冲突（由写入端口拒绝，不是库级约束，见 ADR-0006）。
  implementation_key TEXT NOT NULL,
  -- 可空 FK（issue #126）：账号是连接锚点级的身份，挂载级配置与外部身份都留在原表；初次关联的事实检查在写入端口（不变量 5）。
  connector_account_id TEXT REFERENCES connector_account (id)
);

-- workspace_binding：**工作区挂载**（不变量 2；ADR-0006）。
CREATE TABLE workspace_binding (
  -- 不变量 5（关键关联显式优先）：挂载属于一个存在的工作区与一条存在的连接。
  workspace_id TEXT NOT NULL REFERENCES workspace (id),
  -- 不变量 5：挂载必须指向存在的连接锚点（provider_binding 是跨工作区的连接，ADR-0006）。
  binding_id TEXT NOT NULL REFERENCES provider_binding (id),
  -- 字面集合绑定到 packages/capabilities/src/capability-keys.ts 的 CapabilityDomain（issue #27 验收 1：由数据库而不是调用方拒绝）。
  domain TEXT NOT NULL CHECK (domain IN ('planning', 'development', 'delivery', 'execution', 'storage')),
  -- 取值 0 / 1（不变量 1 与 2：只有启用的挂载才是「这个工作区正在用这条连接」，禁用只是登记）。
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  -- 取值 0 / 1（不变量 1：默认绑定必然是启用的）。
  is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
  -- 挂载级配置（issue #126）：可空；非空时必须是 JSON 对象（值仍由受信 schema 在写入端口逐字段校验，不变量 5）。
  configuration_json TEXT CHECK (configuration_json IS NULL OR (json_valid(configuration_json) AND json_type(configuration_json) = 'object')),
  -- 不变量 1：禁止 enabled = 0 且 is_default = 1（否则「默认」无法被读取方解释）。（表级约束必须排在全部列定义之后。）
  CHECK (is_default = 0 OR enabled = 1),
  -- 不变量 5：同一条连接在同一工作区的同一 domain 只挂载一次。
  PRIMARY KEY (workspace_id, binding_id, domain)
);
-- 不变量 1：同一工作区至多一个启用的 planning 挂载。
CREATE UNIQUE INDEX workspace_binding_planning_enabled ON workspace_binding (workspace_id) WHERE domain = 'planning' AND enabled = 1;
-- 不变量 1 与 2：同一工作区同一 domain 至多一个启用的默认绑定。
CREATE UNIQUE INDEX workspace_binding_default ON workspace_binding (workspace_id, domain) WHERE is_default = 1;

-- entity：AGENTS.md §1.1 不变量 6 的内部锚点。
CREATE TABLE entity (
  -- issue #190：复合外键的实体键分量必须非 NULL，避免 SQLite 跳过整个关系检查。
  id TEXT PRIMARY KEY NOT NULL,
  -- 取值集合来自 packages/domain 的 EntityKind；这一列是 core 的 entityKindFor 推导结果的落点（ADR-0005 把行为 2 的强制点放在 core）。
  kind TEXT NOT NULL CHECK (kind IN ('work_item', 'change_request', 'repository', 'branch', 'worktree', 'commit', 'execution_context', 'execution_run', 'pipeline_run', 'check_run')),
  primary_identity_id TEXT,
  registered INTEGER GENERATED ALWAYS AS (primary_identity_id IS NOT NULL) STORED,
  primary_role TEXT GENERATED ALWAYS AS ('primary') STORED,
  -- issue #190：源对象不得以零身份提交；内部锚点可以没有外部对象。
  CHECK (primary_identity_id IS NOT NULL OR kind IN ('worktree', 'commit', 'execution_context', 'execution_run', 'pipeline_run', 'check_run')),
  -- issue #190：反向登记外键的父键，generated 标志不能由 caller 伪造。
  UNIQUE (id, registered),
  -- issue #190：主身份必须同实体且真实为 primary，晋升只在提交时检查最终组。
  FOREIGN KEY (primary_identity_id, id, primary_role) REFERENCES external_identity (id, entity_id, role) DEFERRABLE INITIALLY DEFERRED
);

-- external_identity：R1 的键形状不变（ADR-0001）与 R7 的角色约束。
CREATE TABLE external_identity (
  id TEXT PRIMARY KEY,
  -- 不变量 6：身份挂在实体上；同一底层对象只解析出一个实体。
  entity_id TEXT NOT NULL REFERENCES entity (id),
  -- R1：键形状不变——binding_id 指向**连接锚点**而不是工作区挂载，因此同一对象跨工作区只有一条身份（ADR-0006）。
  binding_id TEXT NOT NULL REFERENCES provider_binding (id),
  -- R1：ExternalIdentityKind 只有这六个取值。ProjectV2Item 不是身份种类——成员关系落在 project_item_membership。issue #195 在发布前原位加入 repository（控制计划 D10：首发前不追加迁移；已应用旧 002 的开发库删库重建）。
  external_kind TEXT NOT NULL CHECK (external_kind IN ('draft', 'issue', 'change_request', 'branch', 'worktree', 'repository')),
  external_id TEXT NOT NULL,
  -- R7：只有 primary external_id 可作为平台查询参数或同步游标。
  role TEXT NOT NULL CHECK (role IN ('primary', 'alias', 'historical')),
  registered INTEGER GENERATED ALWAYS AS (1) STORED,
  -- issue #190：任何外部登记都要求所属实体已经选择主身份，包括内部种类的 alias-only 反例。
  FOREIGN KEY (entity_id, registered) REFERENCES entity (id, registered) DEFERRABLE INITIALLY DEFERRED,
  -- issue #190：角色绑定外键的父键。
  UNIQUE (id, entity_id, role),
  -- R1 的唯一自然键：同一条连接上的同一对象只有一条身份。
  UNIQUE (binding_id, external_kind, external_id)
);
-- issue #190：角色绑定 deferred 外键保证「至少一个」，本索引保留「至多一个」；两者共同保证恰好一个。
CREATE UNIQUE INDEX external_identity_primary ON external_identity (entity_id) WHERE role = 'primary';

-- project_item_membership：R1（工作区作用域的挂载点，不是内容身份）。
CREATE TABLE project_item_membership (
  -- 不变量 5：成员关系属于一个存在的工作区。
  workspace_id TEXT NOT NULL REFERENCES workspace (id),
  project_external_id TEXT NOT NULL,
  item_external_id TEXT NOT NULL,
  -- R1：内容种类只有三个取值；branch / worktree 不是条目内容。
  content_external_kind TEXT NOT NULL CHECK (content_external_kind IN ('issue', 'draft', 'change_request')),
  content_external_id TEXT NOT NULL,
  membership_created_at TEXT,
  membership_updated_at TEXT,
  -- R1 第一条唯一约束被本主键严格蕴含，单独建索引不增加约束力（2026-09-24 评审：死约束，已删）。
  PRIMARY KEY (workspace_id, item_external_id)
);
-- R1 第二条唯一约束：同一项目中的同一内容至多一条成员关系（端口的「后者胜」须用 UPSERT 或先删后插实现）。
CREATE UNIQUE INDEX project_item_membership_project_content ON project_item_membership (workspace_id, project_external_id, content_external_kind, content_external_id);

-- planning_field_value：R2（键与定位）与 R3（列集合）。
CREATE TABLE planning_field_value (
  workspace_id TEXT NOT NULL,
  item_external_id TEXT NOT NULL,
  project_field_id TEXT NOT NULL,
  -- 平台原样值；不设 revision / etag / version 列。
  value TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  -- R2：定位键是 (工作区, 条目, 项目字段 id)，不含可选值 id（两个 project 的 Status 字段 id 不同而可选值 id 相同）。
  PRIMARY KEY (workspace_id, item_external_id, project_field_id),
  -- R1 的连带影响：字段值挂在成员关系上，不挂在内容身份上。
  FOREIGN KEY (workspace_id, item_external_id) REFERENCES project_item_membership (workspace_id, item_external_id)
);

-- identity_projection、work_item、change_request 是可由原样事实复算的派生分类，不再单独存储（ADR-0005）。
-- workspace_projection：不变量 1 与 3（工程事实不得改写规划状态）。
CREATE TABLE workspace_projection (
  -- 不变量 5：投影属于一个存在的工作区。
  workspace_id TEXT NOT NULL REFERENCES workspace (id),
  -- 不变量 6：投影按实体键控；同一工作区里同一实体只有一行投影（主键见下）。内容种类一致性不在 storage（ADR-0005）。
  entity_id TEXT NOT NULL REFERENCES entity (id),
  -- 归一化状态（R2 / R3）：原样字段值留在 planning_field_value，归一化由 core 做。
  planning_status TEXT NOT NULL CHECK (planning_status IN ('todo', 'in_progress', 'blocked', 'done', 'canceled', 'unknown')),
  -- 内容三态（ADR-0005：分类没有库级闸门，redacted 由本列与下面的 CHECK 约束）。
  content_kind TEXT NOT NULL CHECK (content_kind IN ('work_item', 'change_request', 'redacted')),
  content_title TEXT,
  content_body TEXT,
  content_number INTEGER,
  source_number_json TEXT,
  redaction_reason TEXT,
  -- #133 列表展示的字段事实（映射的状态字段上的原生选项名、迭代 title、date-only 目标日期）；可空 = 没有该值。规范状态只在 planning_status。
  field_status_name TEXT,
  field_iteration_title TEXT,
  field_iteration_start_date TEXT,
  field_iteration_duration_days INTEGER,
  field_target_date TEXT,
  revision INTEGER NOT NULL,
  -- 不变量 6 / Gate E1 行为 2 的 storage 侧强制点：同一工作区里同一实体只有一行投影。
  PRIMARY KEY (workspace_id, entity_id),
  -- ADR-0005 的内容三态：redacted 内容没有标题，调用方必须显示占位，不得回退到缓存标题。
  CHECK (content_kind <> 'redacted' OR (content_title IS NULL AND source_number_json IS NULL))
);

-- workspace_planning_mapping：issue #277，独立的本地配置，挂载删除时随其配置一起移除。
CREATE TABLE workspace_planning_mapping (
  -- issue #277：每工作区一份配置，所属工作区必须存在。
  workspace_id TEXT PRIMARY KEY REFERENCES workspace(id),
  binding_id TEXT NOT NULL,
  -- issue #277：配置只属于 planning 挂载。
  domain TEXT NOT NULL DEFAULT 'planning' CHECK (domain = 'planning'),
  -- issue #277：显式项目 scope，禁止空身份。
  project_external_id TEXT NOT NULL CHECK (length(project_external_id) > 0),
  -- issue #277：来源闭集，不把猜测当用户配置。
  origin TEXT NOT NULL CHECK (origin IN ('derived', 'user')),
  mapping_json TEXT NOT NULL,
  -- issue #277：禁止悬空挂载，卸载清除其配置。
  FOREIGN KEY (workspace_id, binding_id, domain) REFERENCES workspace_binding(workspace_id, binding_id, domain) ON DELETE CASCADE
);
-- 003_control_facts：Gate E1 R4/R5/R6/R8 与执行、关系、恢复不变量；每张表和约束均在上方标注 D8 出处。
-- 首次 MVP 发布前遵循控制计划 D10，不承担迁移兼容成本。

-- repository：执行事实必须有可追溯的工作区仓库（AGENTS.md §1.1 不变量 5：关键关联显式优先；本层计划 Batch L3-A）。
CREATE TABLE repository (
  id TEXT NOT NULL, -- 仓库 id（请求定位字符串）：工作区挂载键的一半，同一个 id 可以挂在多个工作区上；复合主键允许 NULL，所以显式 NOT NULL
  workspace_id TEXT NOT NULL REFERENCES workspace (id), -- AGENTS.md §1.1 不变量 1
  external_identity_id TEXT NOT NULL REFERENCES external_identity (id), -- R7 身份锚点
  PRIMARY KEY (workspace_id, id), -- 执行表主键（D6）；也供执行上下文的复合外键引用，让"仓库属于同一工作区"由库保证（不变量 5）
  UNIQUE (workspace_id, external_identity_id) -- 一个工作区不重复登记同一仓库
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
  provisioning_generation INTEGER CHECK (provisioning_generation IS NULL OR (typeof(provisioning_generation) = 'integer' AND provisioning_generation BETWEEN 1 AND 9007199254740991)),
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
-- `updated_at` 的落库编码（NOT NULL）：`undefined` 落**空串**；空串**不是合法载体**（合法载体只有规范载体，见下），
-- 因此空串只表示「没有版本」，读回时必须还原成 `undefined`。
-- `updated_at` 的合法载体只有规范载体：定宽 UTC 纳秒时间戳 `YYYY-MM-DDTHH:MM:SS.fffffffffZ`（#203），由 Storage 端口入口的
-- `assertComparableSourceVersion` 强制；DDL 不校验载体（裸 SQL 写入不受约束），只在这个定义域上保证 BINARY 字节序 = 时间序。
-- 定序（updated_at 更小者拒绝、相等时整快照替换）**由 Storage 端口实现**，不是库级约束：跨行比较无法用 CHECK 表达，
-- 判据是 `packages/capabilities` 导出的 `compareSourceVersion`（码点序，在规范载体上与下面的 BINARY 比较等价）。
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

-- 当前写入定序只需每个端口主体的最大版本；账本保留全部原始观察，不派生未消费的快照。
-- 规范载体的 BINARY（UTF-8 字节序）与 capabilities 比较器的码点序等价。
CREATE VIEW committed_observation_version AS
SELECT binding_id, object_kind, object_external_id, MAX(updated_at) AS updated_at
FROM sync_observation
GROUP BY binding_id, object_kind, object_external_id;

-- sync_cursor：增量游标属于工作区、provider binding 与调用方 scope（ADR-0006：同步健康度是工作区级事实，#189）。两条外键各自独立，只证明父行存在，不证明该工作区已挂载该连接（本层计划 Batch L3-A）。
CREATE TABLE sync_cursor (
  workspace_id TEXT NOT NULL REFERENCES workspace (id),
  binding_id TEXT NOT NULL REFERENCES provider_binding (id),
  scope_key TEXT NOT NULL,
  cursor_value TEXT,
  state TEXT NOT NULL CHECK (state IN ('idle','syncing','healthy','degraded','failed')),
  last_error_code TEXT,
  PRIMARY KEY (workspace_id, binding_id, scope_key)
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
-- Start Work 在 context 认领事务中先写 Pending 请求指纹；同键精确回放只观察，不接管租约。
-- Storage 原子写入口保留首次指纹、command 与 binding，状态可推进；其它命令仍沿用原账本语义。
CREATE TABLE mutation_attempt (
  workspace_id TEXT NOT NULL REFERENCES workspace (id),
  idempotency_key TEXT NOT NULL,
  id TEXT NOT NULL,
  binding_id TEXT NOT NULL REFERENCES provider_binding (id),
  command_name TEXT NOT NULL,
  request_fingerprint TEXT CHECK (command_name NOT IN ('startWork', 'createChangeRequest') OR (request_fingerprint IS NOT NULL AND length(request_fingerprint) > 0)),
  -- Start Work 在每个实际 Provider 写前提交精确输入；未知步骤跨 key/lease 保守阻挡，非自动恢复日志。
  external_intent_json TEXT CHECK (external_intent_json IS NULL OR (json_valid(external_intent_json) AND json_type(external_intent_json) = 'object' AND ((command_name = 'startWork' AND json_extract(external_intent_json, '$.operation') IN ('createBranch', 'createWorktree', 'startRun', 'startFallbackRun')) OR (command_name IN ('createChangeRequest', 'addChangeRequestAssignees') AND json_extract(external_intent_json, '$.operation') = command_name AND (command_name != 'addChangeRequestAssignees' OR (json_type(external_intent_json, '$.sequence') IS 'integer' AND json_extract(external_intent_json, '$.sequence') BETWEEN 1 AND 9007199254740991)))))),
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
ALTER TABLE execution_run ADD COLUMN provider_ref_json TEXT CHECK (provider_ref_json IS NULL OR (json_valid(provider_ref_json) AND json_type(provider_ref_json) = 'object'));
ALTER TABLE execution_run ADD COLUMN fallback INTEGER NOT NULL DEFAULT 0 CHECK (fallback IN (0, 1));
-- 006_delivery_facts：交付事实的最后确认快照（#221，ADR-0011）。唯一写者是 core 的 refreshDeliveryFacts；首次 MVP 发布前不承担迁移兼容成本。
-- delivery_fact：一个执行上下文一行（键 = 工作区 + contextIdFor 的确定性 id）；没有执行上下文就没有交付事实（复合外键）。
CREATE TABLE delivery_fact (
  workspace_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  attempted_at TEXT NOT NULL, -- 最近一次写入本行的刷新尝试的乱序令牌：取读取开始时的墙钟、已提交令牌加 1 毫秒与同一个 core 上下文对象上一次发出的令牌加 1 毫秒的最大值，可能领先墙钟，只用来定序，不是读取开始时刻，不得展示
  sets_json TEXT NOT NULL CHECK (json_valid(sets_json) AND json_type(sets_json) = 'array'), -- 四个集合的节点、confirmedAt 与 stale；core 写入，storage 不解释
  PRIMARY KEY (workspace_id, context_id),
  FOREIGN KEY (workspace_id, context_id) REFERENCES execution_context (workspace_id, id)
);
-- #305：Planning 全量同步的持久提交世代，独立于 provider cursor。
CREATE TABLE planning_sync_round (
  workspace_id TEXT NOT NULL REFERENCES workspace (id),
  binding_id TEXT NOT NULL REFERENCES provider_binding (id),
  scope_key TEXT NOT NULL,
  latest_started_round INTEGER NOT NULL CHECK (latest_started_round >= 1),
  latest_committed_round INTEGER CHECK (latest_committed_round IS NULL OR (latest_committed_round >= 1 AND latest_committed_round <= latest_started_round)),
  PRIMARY KEY (workspace_id, binding_id, scope_key)
);
