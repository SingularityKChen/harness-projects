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
