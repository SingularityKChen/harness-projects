# SQLite 身份与成员表（Batch L2）ExecPlan

> 状态：Completed（2026-09-26 随 #122 合并归档；#27 保持开启：验收 3 只到「至多一个 primary」，理由见 `Decision Log` 的 `Refs #27` 条）
> 创建：2026-09-23
> 范围：控制计划 `docs/exec-plan/active/2026-09-23-sqlite-v1-stack.md` 的 Batch L2（issue #27）。把 Gate E1 裁决的 R1 / R2 / R3 / R7 落成迁移 `002_identity_membership.sql` 的表与约束，并让成员关系与字段值在 `Storage` 端口面可触达（本合并点只有内存替身注册契约套件，SQLite 侧在 L4/L5/L6 注册同一套断言）。不做执行/关系/写入表（L3）、不做 SQLite 端口实现（L4）、不改 `packages/core/**`。002 的表集合与约束形状以 D12 与 D13 为准（2026-09-24 订正后是八张表）。
> 上游输入：`docs/exec-plan/active/2026-09-23-sqlite-v1-stack.md`（D6 / D8 / D10、Batch L2、文件所有权与 Global Constraints）、`docs/architecture/gate-e1-ruling.md` §2.1 / §2.2 / §4 的 R1–R3 与 R7、§5、§6.1、`docs/adr/ADR-0002-membership-identity-separate-from-content.md`、`packages/capabilities/src/storage.ts`、`packages/storage/sqlite/src/migrate.ts`

## Purpose / Big Picture

完成后，一个没有本次对话历史的人可以做到三件事：

1. 在一个空目录上跑迁移，建出本地数据模型 v1 的身份与成员部分（**八张表**，见 D12 与 D13 的设计订正），并且在每张表、每条约束上读到它追溯到裁决的哪一条（R1 / R2 / R3 / R7）或 `AGENTS.md` §1.1 的哪一条不变量；
2. 对着同一套 storage 契约用例，看到"同一内容在两个工作区是两条成员关系且互不覆盖""字段值按 `(workspace, item, projectField)` 定位且不含可选值 id"在内存替身上成立——L4 接上 SQLite 实现后同一套断言必须继续成立；
3. 读到一份诚实的清单：哪些性质由库级约束保证、哪些属于 core 的推导义务（D12 / D13 / ADR-0005），以及各自的收口条件。

最小成功证据（三条，缺一条本层不算完成）：

| # | 证据 | 判定命令（在检出 `feature/storage-identity-membership-tables` 的工作树根目录运行） |
|---|---|---|
| 1 | 空库建出八张表、二次运行是 no-op、每张表都能在"表 → 出处"映射里找到出处 | `node --test tests/integration`（期望 `fail 0`，用例数 > 5） |
| 2 | 同一套 storage 契约用例在内存替身上全绿，且新增成员关系与字段值断言 | `node --test tests/contract`（期望 `fail 0`） |
| 3 | R1 / R2 / R3 / R7 由约束保证，删掉约束对应用例必变红 | 注入实验：删掉 `project_item_membership_project_content` → 红；还原 → 绿（**订正 2026-09-24**：R1 的第一条唯一约束已删除——它被主键严格蕴含，见 D13） |

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 成员关系（membership） | 一个内容对象挂在某个工作区的某个 project 条目上的那一行：`project_item_membership`。它不是内容身份，字段值与观察都挂在它上面（R1） |
| 内容身份 | `external_identity` 的一行，键 `(binding, 对象种类, 平台全局 node id)`，**故意不含工作区**（ADR-0001）；`binding` 指向连接锚点而不是工作区挂载（ADR-0006） |
| 原样值 | 平台返回的未经归一化的值（例如 Status 的显示名）。storage 只存它，归一化由 core 做（控制计划 D6） |
| 连接锚点 | `provider_binding(id, implementation_key)`：与某个 provider 账号之间的一条连接，跨工作区共享（issue #27 Scope 的 connector accounts；ADR-0006） |
| 工作区挂载 | `workspace_binding(workspace_id, binding_id, domain, enabled, is_default)`：「某工作区启用了某条连接」这一条工作区作用域的事实（ADR-0006） |
| 分类行（**已删除**） | `work_item` / `change_request`：一条成员关系按内容种类落地成本地工作项或变更请求的那一行。三张分类/连接表已按 D12 删除，**Superseded by D12 / D13（2026-09-23 / 2026-09-24）** |
| 出处映射 | 集成用例里的"表名 → R# / 不变量"表；它与 `sqlite_master` 的实际表集合必须互相覆盖（控制计划 D8） |

### 开工时的事实（2026-09-23 取证；交付后的表集合见 D13）

| 事实 | 证据（取证命令，在检出 `feature/storage-identity-membership-tables` 的工作树根目录运行） |
|---|---|
| 迁移清单只有 001；`packages/storage/sqlite` 只有迁移运行器、连接助手与迁移清单 | `packages/storage/sqlite/src/migrations.ts`、`packages/storage/sqlite/migrations/001_init.sql` |
| `Storage` 端口没有成员关系与字段值的表示 | `packages/capabilities/src/storage.ts`（127 行，无 `Membership` / `FieldValue`） |
| `ExternalIdentityKind` 有五个取值，没有 `ProjectV2Item`——R1 明确要求保持这样 | `packages/domain/src/identity.ts`、`tests/contract/domain-enums.test.js` 的 golden 断言 |
| storage 契约套件已参数化：`{ label, makeStorage(), restart() }`，新增断言随适配器注册运行；本合并点只有内存替身注册（SQLite 侧在 L4/L5/L6 注册） | `tests/contract/suites/storage.js`、`tests/contract/storage-contract.test.js` |
| `tests/integration` 只有 `migration-runner.test.js`（5 条用例，全绿） | `node --test tests/integration` → `tests 5 / pass 5 / fail 0` |
| 迁移运行器把每个迁移体放在 `BEGIN IMMEDIATE` 事务里执行，版本号在迁移体成功之后写入 | `packages/storage/sqlite/src/migrate.ts` |
| 连接级 `PRAGMA foreign_keys = ON`，因此外键在 SQLite 上真的会被校验 | `packages/storage/sqlite/src/db.ts` |
| E1-2 §5 的"本地应有行"表给出的键：成员关系 `(workspaceId, itemExternalId)`、`IdentityProjection` `(workspaceId, identityId)`、`WorkspaceProjection` `(workspaceId, entityId)` | `docs/architecture/gate-e1-membership-and-draft.md` §5 |
| `node:sqlite` 接受"复合外键指向显式唯一索引"与"部分唯一索引"，`UPDATE` 降级后再 `INSERT` 同域默认绑定可成功 | 本层的 DDL 探针（`node -e` 内存库，见 `Progress` 2026-09-23 条） |

### 相关文件

- `packages/domain/src/identity.ts`：`ExternalIdentityKind` / `IdentityRole` / `IdentityProjection`。本层只加 `MembershipContentKind`。
- `packages/capabilities/src/storage.ts`：`Storage` 端口。本层加 `MembershipRecord` / `FieldValueRecord` 与五个读写方法。
- `packages/providers/fake/src/storage.ts`：内存替身，契约套件的第一个实现。
- `tests/contract/suites/storage.js`：接受任意适配器的共用断言；本合并点只有内存替身注册，SQLite 侧在 L4/L5/L6 注册。
- `packages/storage/sqlite/migrations/002_identity_membership.sql`：本层的 DDL。
- `packages/storage/sqlite/src/migrations.ts`：迁移清单。本层加一行清单项，并按控制计划 D10 重写模块注释（原注释与 D10 相反，见 D13 与 `Surprises & Discoveries`）。
- `tests/integration/identity-membership-schema.test.js`：DDL 层面的拒绝用例与出处映射。
- `docs/architecture/gate-e1-ruling.md` §4 的 R1–R3 / R7 与 §5 / §6.1：本层的设计输入，本层不修改它。

## Design / Spec

> **当前设计以 D13 为准（2026-09-24 评审响应轮）**；D12 是上一轮（第三轮）的订正记录。D1–D12 里与 D13 冲突的段落（D1 的"十张表"、D2 的"两条唯一约束"、D3、D5 的外键清单、D7、D8 的表计数、D11 的 `identity_projection` 复合外键与 `UNIQUE (id, entity_id)` 父键、D12 第 2 条的"第二个工作项行在 schema 上不可达"）保留原文但视为历史；读实现请以 `002_identity_membership.sql` 与 D13 为准。

### D1. 表形状取 E1-2 §5 的落行表，不取"最小可建"

`docs/architecture/gate-e1-membership-and-draft.md` §5 已经把行为 1 的本地落行写成一张键表（成员关系 `(workspaceId, itemExternalId)`、`IdentityProjection` `(workspaceId, identityId)`、`WorkspaceProjection` `(workspaceId, entityId)`）。**Superseded by D12（2026-09-23）与 D13（2026-09-24）**：本节按十张表定形状，当前设计是八张表（分类/连接表已删，连接锚点与工作区挂载拆开）。

本层的十张表按那张表定形状：它是实测的落行计数，不是猜测；R1 的两条唯一约束作为附加唯一索引加在同一张表上（R1 要求的两条键都能唯一标识一条成员关系，但不取代 `(workspace, item)` 这个挂载点键）。

### D2. （历史，见 D13）成员关系的定位键与两条唯一约束都要，不能只留一条

`(workspace_id, item_external_id)` 是主键：它是字段值外键的目标（R1 的连带影响：`planning_field_value` 指向成员关系而不是内容身份），也是 `getMembership` 的入参。R1 的 `UNIQUE(workspace_id, project_external_id, item_external_id)` 与 `UNIQUE(workspace_id, project_external_id, content_external_kind, content_external_id)` 原样加上：前者保证"同一条目只登记一次"，后者来自 E1-3 实验 3 §4.2 实测的"`(project, content)` 在平台侧唯一"。

**Superseded by D13（2026-09-24）**：R1 的第一条 `UNIQUE (workspace_id, project_external_id, item_external_id)` 已删除——它被主键 `(workspace_id, item_external_id)` 严格蕴含，是死约束；现行只有 `project_item_membership_project_content` 这一条唯一索引（对应本节的第二条）。

### D12. 设计订正：七张表、分类表删除、行为 2 的强制点回到身份与主键（2026-09-23，第三轮）

**Superseded by 本节（2026-09-23）**：D3 / D7 与下文多处描述的是重构前的**十张表**设计（含 `work_item`、`change_request`、`identity_projection` 三张分类/连接表，以及"分类行 + 复合外键"的闸门）。当前设计如下，D3 与 D7 的对应段落按 `PLANS.md` §4 保留原文并视为历史。

**订正（2026-09-24）**：本条的表数是七张，按 D13 现为八张（连接锚点与工作区挂载拆开）；第 2 条把行为 2 的强制点写成"第二个工作项行在 schema 上不可达"，该表述不成立——storage 不强制内容种类一致性，真实强制点见 D13 第 4 条。

1. **三张分类/连接表已删除**（表数 10 → 7）。它们没有独立平台事实、没有写者、没有读者：`identity_projection` 可由 `membership → external_identity → entity → workspace_projection` 复算；`work_item` / `change_request` 只是成员关系内容种类的分类投影。留着它们就是同一事实的第二个存放处（控制计划 D6）。
2. **（历史）行为 2 的强制点回到身份与主键**——**Superseded by D13（2026-09-24）**（见上）。"内容为 change request 的成员关系不得产生第二个工作项"的真实机制是：同一底层对象经身份解析只得到一个实体（`external_identity` 的唯一键 + 实体锚点），而 `workspace_projection` 的主键是 `(workspace_id, entity_id)`——因此**第二个工作项行在 schema 上不可达**。集成用例直接断言这条性质（同一实体的 issue 与回指 change request 只可能有一行；裸 INSERT 第二行被主键拒绝；不同实体各自一行）。
3. **尝试过并放弃的中间方案：在 `workspace_projection` 上加成员关系锚点 + 两条 kind 触发器。** 放弃的判据有两条：① 那个锚点列（`item_external_id`）**在端口契约里没有来源**——`WorkspaceProjection` 没有成员关系键，`putPlanningProjection` 无法填充它，SQLite 实现只能靠一条未写进任何契约的多跳 join；② "投影的内容种类必须与成员关系的种类一致"**不是任何验收标准**（#27 的标准是"不产生第二个工作项"），它属于推导质量，与"标题是否正确"同类，强制点在 core 的推导处而不在 storage（D6）。用一个填不进去的列去代理它，等于把守卫建在没有输入的地方。
4. **放弃的部分必须点名**：种类一致性从此**不是库级约束**。它是 core 推导的义务，收口条件写进 `Outcomes & Retrospective` 的遗留问题（真实 provider 切片出现推导实现时补断言）。
5. 决定与取舍记入 `docs/adr/ADR-0005-projection-anchor-and-behaviour-2-enforcement.md`。

### D13. 设计订正：连接锚点与工作区挂载拆开、八张表、行为 2 的强制点在 core（2026-09-24，评审响应轮）

**Superseded by 本节（2026-09-24）**：D1–D12 里与本节冲突的表述（表数、`provider_binding` 的作用域、行为 2 的强制点、D2 的第一条唯一约束、D11 的投影复合外键）保留原文并视为历史。

1. **连接锚点与工作区挂载拆开（ADR-0006）**：`provider_binding(id, implementation_key)` 是跨工作区共享的**连接锚点**（issue #27 Scope 的 connector accounts）；`workspace_binding(workspace_id, binding_id, domain, enabled, is_default)` 是工作区作用域的**挂载**。`external_identity` 的键形状 `(binding_id, external_kind, external_id)` **逐字不变**（裁决 R1 的「键形状不变」继续成立），只是 `binding_id` 指向连接锚点，因此同一外部对象进入第二个工作区仍然只命中一条身份（Gate E1 行为 1）。理由与被放弃的方案见 `docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md`。因此 **002 建出的是 8 张表**：`workspace`、`provider_binding`、`workspace_binding`、`entity`、`external_identity`、`project_item_membership`、`planning_field_value`、`workspace_projection`。
2. **第一条成员关系唯一约束已删除**：`(workspace_id, project_external_id, item_external_id)` 被主键 `(workspace_id, item_external_id)` 严格蕴含，是死约束；现行唯一索引只有 `project_item_membership_project_content`。
3. **验收 1 改实现到字面**：`workspace_binding.domain` 的 CHECK 绑定到 `packages/capabilities/src/capability-keys.ts` 的 `CapabilityDomain`（自由文本绕不过闸门）；planning 专用部分唯一索引 `workspace_binding_planning_enabled` 让同一工作区里第二个**启用**的 planning 挂载被数据库拒绝（与 `is_default` 无关，这正是 issue #27 验收 1 的字面要求）；`is_default` 蕴含 `enabled`。
4. **行为 2 的强制点在 core，不在 storage**：真实强制点是 core 的 `entityKindFor`（`packages/core/src/identity.ts:35`）——它按内容种类决定实体种类，change request 态绝不产生工作项实体——以及 e2e（`tests/e2e/chain-bootstrap.test.js:46`，issue #76）。**storage 不强制内容种类一致性**；它保证的是「同一工作区里同一实体只有一行投影」（`workspace_projection` 主键 `(workspace_id, entity_id)`）。D12 第 2 条与 ADR-0005 原文的「第二个工作项行在 schema 上不可达」按本条订正。

### D3. （历史，见 D12）分类行 + 复合外键的内容种类闸门

历史结论："change request 成员关系不得产生工作项"由外键保证，不由 CHECK 单独保证。

只写 `CHECK (content_kind = 'work_item')` 是一句同义反复：它只记录"这张表装的是工作项"，挡不住"把一条 change request 成员关系写成工作项行"。因此分类行的内容种类列存**成员关系的内容种类**，并与成员关系组成复合外键：

```text
work_item(workspace_id, item_external_id, entity_id, content_external_kind)
  CHECK (content_external_kind IN ('issue', 'draft'))
  FOREIGN KEY (workspace_id, item_external_id, content_external_kind)
    REFERENCES project_item_membership (workspace_id, item_external_id, content_external_kind)
```

于是有两条独立的拒绝路径：内容种类是 `change_request` 的成员关系，既过不了 `CHECK`，也找不到匹配的父行。`change_request` 表同形，`CHECK (content_external_kind = 'change_request')`。

被放弃的方案：**只写 `CHECK (content_kind = 'work_item')`**（同义反复，不保护不变量）；**用触发器读父行**（把不变量放进过程代码，与"由约束而不是调用方保证"相反）；**把 `work_item` 建成 `entity` 的子类型表**（键变成 `entity_id`，就丢掉了"这条成员关系产生了工作项"这个事实，`change request` 成员关系仍能借同一个实体混进工作项表）。

### D4. `planning_field_value` 的列集合恰好是声明的五个

`(workspace_id, item_external_id, project_field_id, value, observed_at)`，主键是前三列。R3 要求不设 `revision` / `etag` / `version`，因此集成用例用"列集合恰好等于声明集合"的断言钉住它——断言写"等于"而不是"不含"，这样以后悄悄加回一列也会变红。`value` 是平台原样值（例如 Status 的显示名），不是可选值 id；可选值 id 在实测里跨 project 相同，不能用来定位（R2）。

`value` 是 `NOT NULL`：平台对没有值的字段根本不返回节点（E1-1 实验 2 §6：draft 条目 2 个 `fieldValues`、issue / change request 条目 3 个），"没有值"的忠实表示是"没有行"，不是空字符串。

### D5. 外键按"关键关联显式优先"补齐，代价由本层承担

`AGENTS.md` §1.1 不变量 5 要求关键关联显式优先。**Superseded by D12（2026-09-23）与 D13（2026-09-24）**：当前八张表之间的关联是——挂载 → 工作区与连接锚点，身份 → 实体与连接锚点，成员关系 → 工作区，字段值 → 成员关系，投影 → 工作区与实体（见 D13）。

（历史）十张表之间的关联因此都落成外键：绑定 → 工作区，身份 → 实体与绑定，成员关系 → 工作区，字段值 → 成员关系，分类行 → 成员关系与实体，两张投影表 → 工作区 / 实体 / 身份。

这条决定的代价落在契约套件上：SQLite 实现打开 `PRAGMA foreign_keys = ON`，因此套件里的每条前置行（工作区、绑定、实体）都必须真的存在。**这个代价必须由本层付**——L4 的文件所有权把 `tests/contract/suites/**` 列为只读，L4 改不了套件，只能让实现去迎合套件；如果本层把套件留在"外键悬空"的状态，L4 会被迫在"实现端口"和"守自己的文件边界"之间二选一。因此本层把套件里已有的用例补齐到满足前置行（只加前置行，不改任何既有断言）。

### D6. `putMembership` 的冲突语义：后者胜

`putMembership` 的冲突规则：同一 `(workspaceId, itemExternalId)` 重复写入是幂等覆盖；同一 `(workspaceId, projectExternalId, contentExternalKind, contentExternalId)` 的第二次写入取代旧行（平台保证该键唯一，出现第二个 item id 意味着旧的成员关系已被移除并重新加入，对账语义下取最新观测），被取代条目的字段值一并删除（端口契约，见 `packages/capabilities/src/storage.ts`）。两条规则都进契约套件，因此两个实现必须一致。

### D7. （历史，见 D12）端口面只加父 agent 点名的五个方法；三张表暂时没有端口方法，登记为债务

**Superseded by D12（2026-09-23）**：三张分类/连接表已删除，本节描述的缺口随之消失。

本层加 `putMembership` / `getMembership` / `listMemberships` / `putFieldValue` / `listFieldValues`（控制计划 D6 的最小集合）。`identity_projection`、`work_item`、`change_request` 三张表在本层结束时**没有**端口方法：

- 它们的写者是 core 的投影构建（控制计划 D6 的原则：原样值归 storage、推导归 core），而 core 侧的投影改造不在本栈的任何一层里；
- L4 的步骤明确"不新增端口方法（D6）"，因此这三张表在本栈里没有第二个可以补上写入口的层；
- 现在发明它们的端口形状，等于在消费者不存在时猜公共接口——正是控制计划 D6 的"刻意不新增"要避免的形态。

因此本层把这条缺口写进 `Outcomes & Retrospective` 的遗留问题并上报，而不是靠猜接口把它盖过去。验收表第 11 项（每张冻结的表都能通过端口触达）在本层结束时对这三张表不成立，这是**已知且被点名**的缺口，不是遗漏。

### D8. 追溯写在迁移注释与用例映射里，不另开 schema 文档

沿用控制计划的 D8：每张表、每条约束在 `002_identity_membership.sql` 里带一行注释写明出处；`tests/integration/identity-membership-schema.test.js` 持有一份"表名 → 出处"映射，并断言它与 `sqlite_master` 的实际表集合互相覆盖（多一张表、少一条映射都失败）。另外断言迁移文件里每张表各有出处注释（原文写「十张表」，现行是八张，见 D13）、R1 / R2 / R3 / R7 四个标记都出现——把"注释写了"从声明变成可失败的检查。

### D9. `MembershipContentKind` 放在 `identity.ts`，取值断言放在 storage 契约套件

`MembershipContentKind`（`issue` / `draft` / `change_request`）加在 `packages/domain/src/identity.ts`，与 `ExternalIdentityKind` 相邻，但**不加进** `ExternalIdentityKind`（R1）。取值集合的断言放在 `tests/contract/suites/storage.js`：该文件在本层的文件所有权内，且它同时钉住"`ExternalIdentityKind` 仍然只有五个取值"——把 R1 的禁止项写成一条会失败的断言，而不是一句注释。

### D10. 端口一变，`packages/capabilities/src/registry.ts` 的成员锁必须同步（跨列改动）

`registry.ts` 第 59 行的 `StorageSurface` 是编译期成员锁：`Expect<Exact<keyof Storage, '...'>>` 与 golden 成员表双向相等，端口删或新增成员都会让 `tsc --noEmit` 失败（这正是它的设计目的）。因此"加端口方法"这件事的文件集合天然包含这一行，即使控制计划的 L2 行没有单列 `registry.ts`。本层把它按接口顺序插入 `listIdentitiesForEntity` 与 `putPlanningProjection` 之间，并在 PR 描述里点名这条跨列改动（`Global Constraints` 要求跨列改动必须点名并说明理由）。

**代价**：L3 也要加端口方法（`getReconcileCursor` / `putReconcileCursor`），会改同一行。这是栈内的预期冲突，由 L3 变基时解决——本层不做预留，也不为"以后少冲突"把 golden 表写成别的形状（控制计划 D10：不承担兼容成本）。

### D11. 投影的实体由复合外键钉住，DDL 的取值集合绑定到 domain 常量

**Superseded by D12（2026-09-23）与 D13（2026-09-24）**：本节第一处（`identity_projection` 的复合外键、以及 `external_identity` 上为它准备的父键 `UNIQUE (id, entity_id)`）随三张分类/连接表删除而消失——父键的消费者已不存在，002 里没有它；第二处（DDL 的 CHECK 取值集合逐值绑定到 domain 常量）仍是现行设计。

对抗验收暴露了两处"同一事实两份存储、可以互相矛盾"：

- `identity_projection.entity_id` 与 `external_identity.entity_id`：修复前 `INSERT INTO identity_projection VALUES ('ws-1','identity-1','entity-2')` 被接受，而 `identity-1` 属于 `entity-1`。按本层已有的复合外键模式（D3）收紧：`external_identity` 加 `UNIQUE (id, entity_id)` 作为父键，`identity_projection` 的身份外键改成 `FOREIGN KEY (identity_id, entity_id) REFERENCES external_identity (id, entity_id)`。两个单列外键做不到这件事——它们允许投影指向另一个**存在**的实体，正是这条意见指出的矛盾形态。
- DDL 的 `CHECK (col IN (...))` 字面量与 `packages/domain` 的常量：把 `planning_status` 的 `'canceled'` 改成 `'cancelled'`、`status_policy` 的 `'manual_only'` 改成 `'manual_only_typo'` 不会让任何既有用例变红（实测两个套件仍全绿）。绑定用例放在 `tests/integration/identity-membership-enums.test.js`：对每个受约束列断言三件事——CHECK 的字面量集合恰好等于枚举集合（多一个 DDL 独有的取值也变红）、枚举里每个值都能真的插入、枚举外的哨兵值被 `CHECK constraint failed` 拒绝。哨兵行的外键父行必须先补齐，否则拒绝来自外键，断言就退化成假判别。

被放弃的方案：**只断言"CHECK 文本包含每个枚举值"**（挡不住 DDL 多出一个 domain 没有的取值，因此改成集合相等）；**把绑定用例并进 `identity-membership-schema.test.js`**（195 + 约 45 行，越过"单文件 ≤ 200 行"）；**顺手删掉 `db.ts` 的 `PRAGMA foreign_keys = ON`**（`node:sqlite` 当前默认为开，但 SQLite 本身与 sqlite3 CLI 默认为关，删掉就把正确性押在驱动默认值上）。

### 被放弃的方案

（表中与 `work_item` / `change_request` / `identity_projection` 有关的四行、以及"R1 的两条唯一约束"的措辞，属于 D12 / D13 之前的设计记录，保留为历史；现行表集合见 D13。）

| 方案 | 为什么放弃 |
|---|---|
| 只加 R1 的两条唯一约束，不建 `(workspace, item)` 主键 | 字段值的外键没有合法父键，只能指向内容身份，与 R1 的连带影响相反（ADR-0002 第 4 条） |
| `work_item` 只写 `CHECK (content_kind = 'work_item')` | 同义反复：它挡不住把 change request 成员关系写成工作项行（见 D3） |
| 给 `identity_projection` / `work_item` / `change_request` 发明端口方法 | 消费者（core 的投影构建）不存在，形状会随它变；且超出父 agent 点名的端口增量（见 D7） |
| 把 `value` 设成可空以表示"字段被清空" | 平台对没有值的字段不返回节点，"没有值"的忠实表示是没有行；可空会引入"行存在但值为 NULL"这个平台不会产生的状态 |
| 把 `work_item` / `change_request` 建成 `entity` 的子类型表（键 `entity_id`） | 丢掉"哪条成员关系产生了它"，change request 成员关系仍能借同一实体混进工作项表 |
| （已推翻 2026-09-24）本层顺手把 `tests/contract/storage-contract.test.js` 也改掉 | 当时的判据是「那是 L4 的文件」；实际注册行与套件分组的分工在本层完成（见 Decision Log 的跨列接管记录），原判据不成立 |

## Global Constraints

- 只改本层拥有的文件（控制计划 `Global Constraints` 的 L2 行）：`packages/domain/src/identity.ts`（只加 `MembershipContentKind`）、`packages/capabilities/src/storage.ts`（成员关系与字段值的记录与读写）、`packages/providers/fake/src/storage.ts`（同一语义的内存实现）、`tests/contract/suites/storage.js`、`packages/storage/sqlite/migrations/002_identity_membership.sql`、`packages/storage/sqlite/src/migrations.ts`（清单项 +1，并按控制计划 D10 重写模块注释）、`tests/integration/identity-membership-schema.test.js`、本文件。**2026-09-24 第四轮评审补登的实际改动**：`tests/contract/storage-contract.test.js`（注册行）、`tests/contract/suites/storage-identity-membership.js`（新套件）、`tests/e2e/chain-bootstrap.test.js`（生命周期断言）、`docs/adr/ADR-0005-projection-anchor-and-behaviour-2-enforcement.md` / `docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md` / `docs/adr/README.md`、`docs/review/2026-09-24-pr-122-mmp-round3.md`（逐层记录各一份，命名规则见 `docs/review/README.md` §8）、`docs/exec-plan/active/2026-09-24-stack-review-response.md` 与 `docs/exec-plan/active/2026-09-24-review-root-cause-convergence.md`。只读：`packages/core/**`、`001_init.sql`、L3/L4 的文件。
- **跨列改动（必须点名）**：`packages/capabilities/src/registry.ts` 第 59 行的 `StorageSurface` 成员锁。端口新增五个方法会让 `tsc --noEmit` 失败，同步 golden 成员表是"加端口方法"这件事的一部分（见 D10）。除此之外本层不改 `packages/capabilities` 的其它文件。
- **对抗验收回复轮（2026-09-23）把文件集合扩了两处**：`packages/storage/sqlite/src/db.ts`（只改 `openDatabase` 的注释，不在控制计划 L2 行里）与新增的 `tests/integration/identity-membership-enums.test.js`（DDL 的 CHECK 取值集合与 `packages/domain` 常量的绑定用例）。后者之所以独立成文件：把它塞进 `identity-membership-schema.test.js` 会让那个文件越过本计划「单文件 ≤ 200 行」的约束（2026-09-23 观察：当时 195 行，合并后约 240 行；该约束的现状见下方订正）（D11）。
- `docs/README.md` 的 Active 计划索引加本计划一行（控制计划把该文件列进 L2 的文件集合，只加自己那一行）。
- `packages/storage/sqlite` 只依赖 `@harness-projects/domain` 与 `@harness-projects/capabilities`；判据是 `node --test tests/contract/package-boundaries.test.js`。
- 不新增运行时依赖；数据库只用 Node 内建的 `node:sqlite`。
- 单文件 ≤ 200 行、单函数 ≤ 40 行（**订正 2026-09-24**：单文件约束已被 `tests/contract/suites/storage.js` 与 `packages/providers/fake/src/storage.ts` 突破，处置见遗留问题第 6 条；单函数约束沿用 2026-09-23 的观察，未做新的机械核对）。
- 首次 MVP 发布之前不承担迁移与兼容成本（控制计划 D10）：002 可以整份重写，不写纠正迁移、不做兼容层。
- 不 push、不开 PR、不合并、不改 `main`（**订正 2026-09-24**：本层已推送为 PR #122 并进入评审；「不合并、不改 `main`」仍然有效）。
- 发布面：不写本机绝对路径、凭据、账号个人信息、内部系统域名（`docs/development/publication.md`）。

## Plan of Work

### Batch L2.1 · 先写会失败的用例（红）

**最小闭环**：本层要保护的每条不变量都有一条"缺陷存在时必须变红"的用例，且这些用例现在确实红。

**涉及文件**：`tests/contract/suites/storage.js`、`tests/integration/identity-membership-schema.test.js`、本文件

**步骤**：

- [x] `tests/contract/suites/storage.js`：加成员关系与字段值断言——同一内容在两个工作区是两条成员关系且互不覆盖；同一 `(工作区, 项目, 内容)` 只有一条成员关系（后者胜）；重复 `putMembership` 幂等；字段值按 `(workspace, item, projectField)` 定位、同键覆盖、跨工作区互不影响、记录键集合不含可选值 id；`MembershipContentKind` 恰好三个取值且 `ExternalIdentityKind` 仍是五个取值
- [x] 给套件里已有用例补前置行（工作区、连接锚点、工作区挂载、实体），使 SQLite 实现在外键打开时也能跑（只加前置行，不改既有断言；**订正 2026-09-24**：原文写「工作区、绑定、实体」，D13 拆开连接锚点与工作区挂载后是四类前置行）
- [x] `tests/integration/identity-membership-schema.test.js`：空库建表、二次运行 no-op、表 → 出处映射与实际表集合互相覆盖、迁移文件里每张表有出处注释且 R1/R2/R3/R7 都出现、每条约束一条拒绝用例、每张表的外键指向存在的表

**验证**：

```bash
node --test tests/contract          # 期望红：putMembership / putFieldValue 不存在
node --test tests/integration       # 期望红：002 还没有建出表（当时的目标是十张，D12 后为七张，D13 后为八张）
```

**回滚**：`git checkout -- tests/` 或 revert 本批次提交；本批次只加测试，不动实现。

### Batch L2.2 · 落 002 与端口面（绿）

**最小闭环**：上一步的用例全绿，且 R1 / R2 / R3 / R7 由约束而不是调用方保证。

**涉及文件**：`packages/domain/src/identity.ts`、`packages/capabilities/src/storage.ts`、`packages/providers/fake/src/storage.ts`、`packages/storage/sqlite/migrations/002_identity_membership.sql`、`packages/storage/sqlite/src/migrations.ts`

**步骤**：

- [x] `packages/domain/src/identity.ts` 加 `MembershipContentKind`（`issue` / `draft` / `change_request`），不加进 `ExternalIdentityKind`
- [x] `packages/capabilities/src/storage.ts` 加 `MembershipRecord` / `FieldValueRecord` 与 `putMembership` / `getMembership` / `listMemberships` / `putFieldValue` / `listFieldValues`；契约注释写明"storage 只存原样值，归一化由 core 做"与 D6 的两条冲突规则
- [x] `packages/providers/fake/src/storage.ts` 实现同一语义（内存）
- [x] `002_identity_membership.sql`：八张表（D13）+ 唯一约束 + R2 的键 + R3 的列集合 + R7 的 `role` CHECK + `workspace_binding` 的 planning 部分唯一索引与 `domain` CHECK + 每个实体至多一个 primary 身份的部分唯一索引 + D5 的外键；每张表、每条约束一行出处注释（**Superseded by D12 / D13（2026-09-23 / 2026-09-24）**：原文写「十张表 + R1 的两条唯一约束 + … + `work_item` / `change_request` 的内容种类约束」，那些表与约束已删除，见 D13）
- [x] `packages/storage/sqlite/src/migrations.ts`：清单项 +1，并按控制计划 D10 重写模块注释（**订正 2026-09-24**：原文写「只加一行清单项」；本 PR 已改写模块注释，见 `Surprises & Discoveries`）

**验证**：

```bash
node --test tests/integration
node --test tests/contract
../../node_modules/.bin/tsc --noEmit
node --test tests/contract/package-boundaries.test.js
体量用回读式 `BASE=$(gh pr view 122 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)` 配方（原文写分支名，按 `PLANS.md` §4 订正）
git diff --check test/e1-uncertain-create
```

**回滚**：`git revert` 本批次提交（迁移文件与实现一起回滚）。已跑过 002 的本地库按 `docs/` 的备份恢复流程重建——本轮不发布，不存在生产库。

### Batch L2.3 · 注入实验与收尾

**最小闭环**：约束确实是那些用例变红的原因，而不是碰巧。

**步骤**：

- [x] 注入实验：临时删掉唯一索引 `project_item_membership_project_content` → 对应用例必须变红；还原 → 复跑确认变绿，两次实际输出记入 `Progress`（**订正 2026-09-24**：原文写「R1 的第二条唯一索引（`membership_project_content`）」，索引名与「第二条」的措辞都不准——R1 的第一条已删除，现行只有这一条，见 D13）
- [x] 按 `docs/development/publication.md` 的机械扫描检查本层新增行
- [x] 整理提交（先失败的用例 / 再实现），提交信息末尾写关闭断言（**订正 2026-09-24**：原文末尾写「不 push」；本层随后推送为 PR #122 并进入评审，见 `docs/review/2026-09-24-pr-122-mvp-review.md`。本层实际以 `Refs #27` 交付，理由见 `Decision Log`；`Closes` 的唯一权威是回读 `closingIssuesReferences`）

**验证**：

```bash
node scripts/rule-checks.mjs disclosure "$BASE"
体量用回读式 `BASE=$(gh pr view 122 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)` 配方（原文写分支名，按 `PLANS.md` §4 订正）
git diff --check test/e1-uncertain-create
```

**回滚**：注入实验只改本地文件，还原后复跑即回到已知良好状态。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 空库建出八张表，二次运行 no-op | `node --test tests/integration` 的迁移用例 | 通过（用例数是易失值，以该命令的实时输出为准；2026-09-23 的两次输出见 `Progress`） |
| 2 | 表 → 出处映射与实际表集合互相覆盖（多一张表或少一条映射都失败） | 同名用例的 `deepEqual` 断言 | 通过 |
| 3 | R1 的唯一索引 `project_item_membership_project_content` 有拒绝用例 | 集成用例的拒绝断言 | 通过；注入实验见 `Progress`（**Superseded by D13（2026-09-24）**：原写「R1 的两条唯一约束各有一条拒绝用例」；第一条被主键严格蕴含，已删除） |
| 4 | R2：字段值按键 `(workspace, item, projectField)` 定位，不含可选值 id | 集成用例的列集合断言 + 契约套件的记录键集合断言 | 通过 |
| 5 | R3：`planning_field_value` 的列集合恰好等于声明的五个 | 集成用例的"列集合相等"断言 | 通过 |
| 6 | R7：`external_identity.role` 受 CHECK 约束 | 集成用例的拒绝断言 | 通过 |
| 7 | issue #27 验收 1：一个工作区至多一个**启用的** planning 挂载（与 `is_default` 无关） | 集成用例的拒绝断言（`workspace_binding_planning_enabled`）+ `domain` 的 CHECK 逐值绑定用例 | 通过（**Superseded by D13（2026-09-24）**：原写「一个工作区至多一个启用的默认绑定」，只覆盖 `is_default = 1` 的第二个挂载，不是验收 1 的字面要求） |
| 8 | change request 成员关系不得产生工作项 | 强制点在 core 的 `entityKindFor`（`packages/core/src/identity.ts`）+ e2e（`tests/e2e/chain-bootstrap.test.js`，issue #76）；storage 侧只保证同一工作区同一实体一行投影 | 通过（**Superseded by D12 / D13（2026-09-23 / 2026-09-24）**：原判据「集成用例的两条拒绝断言（CHECK 与复合外键）」随分类表与触发器删除，不再是本项的证据） |
| 9 | 每个实体至多一个 primary 身份 | 集成用例的拒绝断言 | 通过 |
| 10 | 同一内容在两个工作区是两条成员关系且互不覆盖 | 契约套件用例（本合并点只注册内存替身；SQLite 侧在 L4/L5/L6 注册） | 内存替身通过；复核用 `node --test tests/contract`（期望 fail 0） |
| 11 | 注入实验：删掉 `project_item_membership_project_content` 后对应用例变红，还原后变绿 | `Progress` 里的两次实际输出 | 通过（1 fail → 0 fail） |
| 12 | 发布面与体量合规 | 体量用回读式 `BASE` 配方 + `disclosure "$BASE"` + `git diff --check "$BASE"...HEAD` | 见 `Progress` |
| 13 | 端口面覆盖每一张冻结的表 | `Outcomes & Retrospective` 的表 → 端口方法映射（D12 / D13 订正后的八张表） | 通过（分类/连接表已按 D12 删除；连接锚点与工作区挂载按 D13 拆开，两者由同一组端口方法读写） |
| 14 | storage 保证的那一条：同一工作区里同一实体只有一行投影 | 集成用例「同一工作区里同一实体只有一行投影（storage 保证的那一条）」：UPSERT 更新、裸 `INSERT` 第二行被主键拒绝、不同实体各自一行 | 通过（**Superseded by D13（2026-09-24）**：本行原写「行为 2 由 schema 强制」，真实强制点在 core `entityKindFor` + e2e，见第 8 项） |
| 15 | 对抗验收四条意见的修复各有一条"修复前红、修复后绿"的实测 | `Progress` 2026-09-23 回复轮的两次实际输出 | 通过（4/4；**Superseded by D12（2026-09-23）**：四条里的 `identity_projection` 复合外键随该表删除而不再适用，其余三条仍是现行断言） |
| 16 | DDL 的 CHECK 取值集合与 `packages/domain` / `packages/capabilities` 常量逐值绑定 | `tests/integration/identity-membership-enums.test.js` | 通过（含评审补的 `external_identity.role` 与本轮新增的 `workspace_binding.domain`；哨兵必须由 **CHECK** 拒绝，被外键或唯一约束拒绝不算通过） |
| 17 | 出处注释覆盖到**约束级**（#27 验收 4） | 集成用例逐条断言：每条 `CREATE TABLE` / `CREATE INDEX` 上方三行内、每条表内 `PRIMARY KEY` / `FOREIGN KEY` / `UNIQUE` / 表级 `CHECK` 与每个带 `CHECK` 的列上方一行内必须有写明出处的注释 | 通过（逐条删掉六处注释的变异全部变红） |
| 18 | #27 验收 5：没有列能存凭据材料，且审查是**显式**的 | `tests/integration/identity-membership-schema.test.js` 的「#27 验收 5」用例（逐列白名单与 `pragma_table_info` 互相覆盖；列名命中 token / password / secret / credential / private_key / access_key / api_key 且不以 `_handle` / `_ref` 结尾即失败）+ 用例内逐列四类用途的审计结论 | 通过（凭据只保存 secret 服务句柄，不进入 Project 数据库；`AGENTS.md` §1.1） |
| 19 | 评审点名的判别力缺口逐条补上 | 契约套件新增 8 条：行为 1（两工作区同连接一条身份）、身份 primary 与主键、投影引用、**project 分量**、**item 分量**、**孤儿字段值**、绑定规则、**排序**；集成用例补 project 分量与行为 1 | 通过（20 条注入实验全部 RED、逐条还原后 GREEN；缺口的实测见 `Surprises & Discoveries`） |

## Progress

- [x] (2026-09-24) **第三轮评审响应（本层 20 条）**：按根因修，不逐条打补丁。① 替身不再删除**仍有身份指向**的实体——旧行为下"移出 project 再移回"让 core 同步永久失败（P1）；② 替身补上端口注释已声明却只写在注释里的引用完整性（身份 → 实体/锚点、仓库 → 工作区/身份、修订号 → 工作区）；③ 契约套件的前置状态只走端口，SQLite 侧不再需要裸 SQL 预置；④ 002 补 `entity.kind` 的 CHECK，出处用例改成要求注释里有可解析来源；⑤ 凭据审查改成逐列白名单 + `pragma_table_info` 互相覆盖；⑥ #27 验收 3 补生命周期断言（e2e），并删掉"不能声明式表达"这句不成立的表述。关闭断言改为 `Refs #27`（**订正 2026-09-26**：原写「验收 3 的字面需要端口签名变更」，该前提已被第四轮推翻；真实理由见 `Decision Log` 的 `Refs #27` 条）。逐条处置与证据见 `docs/exec-plan/active/2026-09-24-review-root-cause-convergence.md` 的 Batch B 与逐条处置表。
- [x] (2026-09-23) 取证：读控制计划、裁决 R1–R3/R7、端口面、契约套件、迁移运行器与 E1-2 §5 的落行表
- [x] (2026-09-23) DDL 探针：在内存库上验证复合外键指向显式唯一索引、部分唯一索引、`UPDATE` 降级后 `INSERT` 同域默认绑定；并据此把 `work_item` 的内容种类列改成"成员关系的内容种类"（见 D3）
- [x] (2026-09-23) Batch L2.1 · 先写会失败的用例（红）：`node --test tests/integration` → `tests 14 / pass 5 / fail 9`；`node --test tests/contract` → storage 契约文件整体失败（`putMembership` 不存在）
- [x] (2026-09-23) Batch L2.2 · 落 002 与端口面（绿）：`node --test tests/integration` → `tests 14 / pass 14 / fail 0`；`node --test tests/contract` → `tests 406 / pass 406 / fail 0`；`../../node_modules/.bin/tsc --noEmit` → 0（先红后绿：端口成员锁未同步时 `registry.ts(59,37): error TS2344`）（**订正 2026-09-24**：用例数是易失值，本条记录的是当时的中间态输出；栈级收口在 head 上复读为集成 15/15、契约 408/408，见 `docs/exec-plan/active/2026-09-23-sqlite-v1-stack.md` 的 `Surprises & Discoveries`；复核以 `node --test tests/integration` / `node --test tests/contract` 的实时输出为准）
- [x] (2026-09-23) Batch L2.3 · 注入实验（删掉 `project_item_membership_project_content`）：
  - 红：`node --test tests/integration` → `tests 14 / pass 13 / fail 1`，退出码 1；失败原文 `AssertionError [ERR_ASSERTION]: Missing expected exception: (项目, 内容) 在平台侧唯一，本地不得留下第二条`（`tests/integration/identity-membership-schema.test.js:101`）
  - 绿：还原后逐字节一致（`diff` 无输出），复跑 → `tests 14 / pass 14 / fail 0`，退出码 0
- [x] (2026-09-23) 其余验证：`node --test tests/contract/package-boundaries.test.js` → 7 pass / 0 fail；`node --test tests/e2e` → 38 pass / 0 fail；`node --test tests/mvp0` → 7 pass / 0 fail
- [x] (2026-09-23) 对抗验收回复轮：四条意见全部先复现、再按根因修复，零条拒绝（细节见 `Surprises & Discoveries`）。每条都做了变异实验，两次实际输出：
  - **字段值的 `itemExternalId` 分量**（P1）：修复前改坏 `listFieldValues`（只按工作区过滤）→ `node --test tests/contract` → `tests 406 / pass 406 / fail 0`（无判别力）；补断言后同一变异 → `tests 19 / pass 18 / fail 1`，失败原文 `AssertionError [ERR_ASSERTION]: 同工作区另一个条目不得进入 item-1，同字段的不同条目也不得互相覆盖`；还原 → `pass 19 / fail 0`。改坏 `putFieldValue` 的匹配键（丢掉 `itemExternalId`）同样由这条断言抓到（1 fail → 还原后 0 fail）。
  - **`identity_projection` 的实体**（P2）：修复前 `INSERT INTO identity_projection VALUES ('ws-1','identity-1','entity-2')` 被接受（实测输出 `MISMATCH ACCEPTED -> [{"workspace_id":"ws-1","identity_id":"identity-1","entity_id":"entity-2"}]`）；加复合外键后，把 002 还原成修复前版本 → `node --test tests/integration` → `tests 16 / pass 15 / fail 1`，失败原文 `AssertionError [ERR_ASSERTION]: Missing expected exception: 投影的实体与身份不符时必须被拒绝（identity-2 属于 entity-2，不属于 entity-1）`；还原 → `pass 16 / fail 0`。（**Superseded by D12（2026-09-23）**：`identity_projection` 已随三张分类/连接表删除，这条修复不再适用于现行 schema；证据本身仍是当时的事实。）
  - **DDL 的 CHECK 取值集合**（P2）：修复前把 `planning_status` 的 `'canceled'` 改成 `'cancelled'`、`status_policy` 的 `'manual_only'` 改成 `'manual_only_typo'` → `node --test tests/integration` → `tests 14 / pass 14 / fail 0`、`node --test tests/contract` → `tests 406 / pass 406 / fail 0`（无判别力）；补绑定用例后同一变异 → `tests 16 / pass 15 / fail 1`，失败原文 `AssertionError [ERR_ASSERTION]: workspace.status_policy 的 CHECK 取值集合必须恰好等于 domain 常量（多一个或少一个都变红）`；还原 → `pass 16 / fail 0`。
  - **`db.ts` 的注释**（P3）：`new DatabaseSync(':memory:')` 后 `PRAGMA foreign_keys` 实测 `1`，`sqlite3 :memory: "PRAGMA foreign_keys;"` 实测 `0`；注释改成"显式声明是为了不依赖驱动默认值"，保留"关掉时悬空引用会被静默接受"的后果说明。
- [x] (2026-09-23) 回复轮后的完整验证：`node --test tests/integration` → `tests 16 / pass 16 / fail 0`；`node --test tests/contract` → `tests 406 / pass 406 / fail 0`；`../../node_modules/.bin/tsc --noEmit` → exit 0；`node --test tests/contract/package-boundaries.test.js` → 7 pass / 0 fail（用例数是易失值；2026-09-24 栈级收口复读与这里的数字不同，复核以命令的实时输出为准，见上一条注）
- [x] (2026-09-24) 评审响应轮 · 文档清扫（Batch 6）：按 D13 订正表集合（七张 → 八张）、行为 2 的强制点、D2 / D11 / D12 的过期表述、验收表与 `Outcomes & Retrospective`；本轮实现与端口面的改动见 `docs/exec-plan/active/2026-09-24-stack-review-response.md` 的 Batch 4 / Batch 5

## Surprises & Discoveries

- (2026-09-23) **复合外键不能表达"issue/draft → 工作项"这层映射**。第一版把 `work_item.content_kind` 写成 `CHECK (content_kind = 'work_item')` 并让它参与指向成员关系的外键；探针显示 `INSERT INTO work_item VALUES (..., 'work_item')` 直接 `FOREIGN KEY constraint failed`——成员关系那一列存的是 `issue` / `draft`，两边永远不相等。改成"分类行的内容种类列存成员关系的内容种类"之后，CHECK 与复合外键同时成立（见 D3）。证据：`node -e` 内存库探针，报错原文 `Error: FOREIGN KEY constraint failed`（`errcode 787`）。
- (2026-09-23) 契约套件现有的前置行不满足外键：SQLite 实现打开 `PRAGMA foreign_keys = ON`，而套件里 `putProviderBinding` / `putExternalIdentity` / `putPlanningProjection` 的用例没有先建工作区、绑定与实体。因为 L4 不能改 `tests/contract/suites/**`，这个代价只能由本层付（见 D5）。
- (2026-09-23) **端口面有一把编译期成员锁**：`packages/capabilities/src/registry.ts` 的 `StorageSurface` 用 `Expect<Exact<keyof Storage, '...'>>` 把 31 个成员名钉死，加五个端口方法后 `tsc --noEmit` 报 `packages/capabilities/src/registry.ts(59,37): error TS2344: Type 'false' does not satisfy the constraint 'true'`。这不是缺陷，是设计：它保证端口变化无法悄悄发生。代价是"加端口方法"的文件集合比控制计划 L2 行列的多一个文件（见 D10）。
- (2026-09-23) 契约套件的行数上限逼出一次真实的取舍：加完成员关系与字段值断言后 `tests/contract/suites/storage.js` 是 213 行，超过本层"单文件 ≤ 200 行"的约束。处理方式是把两条成员关系用例合并、压缩工厂函数与既有用例的空行，压到 194 行，而不是新建第二个套件文件——新增套件文件会落在控制计划的 L2 文件集合之外。
- (2026-09-23) `packages/storage/sqlite/src/migrations.ts` 的模块注释仍写着"已应用过的迁移文件不得再修改"，与控制计划 D10（首次 MVP 发布之前不承担迁移与兼容成本）相反。本层**没有**改它：控制计划把该文件的改动限制为"只加一行清单项"。这条陈旧表述留给控制计划的持有者决定（改注释，或在 D10 生效期结束后保持原样）。**订正（2026-09-24）**：该注释后来被改写为"首次 MVP 发布前允许整份迁移体重写；发布后的变更另行评审，不在本清单里暗示兼容层或双写路径"，文件集合随之从「只加一行清单项」扩为「清单项 +1 + 注释重写」，已在 `Global Constraints` 与 `Outcomes & Retrospective` 订正。
- (2026-09-23) **契约套件对"字段值按条目定位"没有判别力**：套件里所有 `putFieldValue` 都写 `item-1`，唯一写 `item-2` 的那次落在 `ws-2`，被工作区过滤挡住。把 `listFieldValues` 改成只按工作区过滤（丢掉 `itemExternalId`），`tests/contract` 仍然 `406/406` 全绿；`putFieldValue` 的匹配键丢掉 `itemExternalId` 也一样。修复是在**同一工作区内**再写一条属于 `item-2` 的字段值，并断言 `listFieldValues(WORKSPACE,'item-1')` 不含它、`listFieldValues(WORKSPACE,'item-2')` 只含它、`listFieldValues(WORKSPACE,'item-nonexistent')` 返回 `[]`。
- (2026-09-23) **DDL 的 CHECK 字面量与 domain 常量是同一事实的两份存储，且没有任何东西把它们绑在一起**：`planning_status` 的 `'canceled'` → `'cancelled'`、`status_policy` 的 `'manual_only'` → `'manual_only_typo'`，集成与契约两个套件仍然全绿。这类漂移不会自己暴露：`domain-enums.test.js` 钉的是 domain 常量，集成用例钉的是表与列，中间那层映射两边都不管。修复是按"CHECK 字面量集合 == 枚举集合 + 每个值都能插入 + 哨兵被 CHECK 拒绝"三条断言绑定。
- (2026-09-23) **`node:sqlite` 默认就打开外键**：`new DatabaseSync(':memory:')` 之后 `PRAGMA foreign_keys` 实测为 `1`（`sqlite3` CLI 实测为 `0`）。`db.ts` 原注释写"SQLite 默认不校验外键"因此不准确。**结论不是删掉 `PRAGMA foreign_keys = ON`**：SQLite 本身与 CLI 默认为关，显式声明的价值是"不依赖驱动默认值"，这一点在换驱动或换打开方式时才会显现。
- (2026-09-24) **「第二个工作项行在 schema 上不可达」不成立**（评审实测）：storage 不强制投影的内容种类与成员关系的种类一致——`workspace_projection.content_kind` 只受自身 CHECK 约束，主键 `(workspace_id, entity_id)` 只排除同一实体的第二行，不排除"这一行推导错了"。行为 2 的真实强制点是 core 的 `entityKindFor`（`packages/core/src/identity.ts:35`）与 e2e（`tests/e2e/chain-bootstrap.test.js:46`，issue #76）。订正落在 D13 第 4 条与 ADR-0005。
- (2026-09-24) **R1 的第一条唯一约束是死约束**：`(workspace_id, project_external_id, item_external_id)` 被主键 `(workspace_id, item_external_id)` 严格蕴含，删掉它不改变任何拒绝路径（002 的注释记录了这次实测）。见 D13 第 2 条。
- (2026-09-24) **身份键挂在单工作区绑定上，行为 1 在 002 里表达不了**（评审实测）：同一外部对象进入第二个工作区必然得到第二条身份与第二个实体，因为 `provider_binding` 带 `workspace_id`。修法是把连接锚点与工作区挂载拆开（D13 第 1 条 / ADR-0006），`external_identity` 的键形状逐字不变，裁决 R1 的「键形状不变」继续成立。

## Decision Log

- **Decision**（**Superseded by D12（2026-09-23）**：`work_item` / `change_request` 已删除，本条不再适用于现行 schema）：`work_item` / `change_request` 的内容种类列存成员关系的内容种类，并与成员关系组成复合外键（D3）。
  **Rationale**：只写 `CHECK (content_kind = 'work_item')` 是同义反复，挡不住把 change request 成员关系写成工作项行；复合外键让"内容为 change request 的成员关系不得产生工作项"成为数据库事实。
  **Date/Author**：2026-09-23 / agent

- **Decision**（**Superseded by D12 / D13（2026-09-23 / 2026-09-24）**：现行是八张表，外键清单见 D13；「把契约套件的前置行补到满足外键」这一半仍然有效）：补齐十张表之间的外键，并由本层把契约套件的前置行补到满足外键（D5）。
  **Rationale**：`AGENTS.md` §1.1 不变量 5 要求关键关联显式优先；L4 不能改 `tests/contract/suites/**`，把套件留在悬空状态会逼 L4 越界或让 SQLite 实现跑不过套件。
  **Date/Author**：2026-09-23 / agent

- **Decision**：`putMembership` 的冲突语义取"后者胜"，并写进契约套件（D6）。
  **Rationale**：同一键必须有唯一行为：重复 `(workspaceId, itemExternalId)` 幂等覆盖，同一 `(工作区, 项目, 内容)` 的第二次写入取代旧行并删除被取代条目的字段值；语义写进套件才能保证两个实现不漂移。
  **Date/Author**：2026-09-23 / agent

- **Decision**（**Superseded by D12（2026-09-23）**：三张表已删除，缺口随之消失；「端口只加五个方法」这一半仍有效）：端口只加父 agent 点名的五个方法；`identity_projection` / `work_item` / `change_request` 的端口入口留空并上报（D7）。
  **Rationale**：这三张表的写者属于 core 的投影构建（消费者还不存在），而 L4 明确不新增端口方法；现在发明形状等于无消费者地猜公共接口。代价是验收表第 11 项在本层不成立，因此写成点名缺口而不是沉默。
  **Date/Author**：2026-09-23 / agent

- **Decision**：`MembershipContentKind` 加在 `identity.ts`，取值断言放在 storage 契约套件（D9）。
  **Rationale**：`domain-enums.test.js` 的 golden 表不在本层文件所有权内；契约套件在本层所有权内，且能同时钉住 R1 的禁止项（`ExternalIdentityKind` 仍是五个取值）。
  **Date/Author**：2026-09-23 / agent

- **Decision**：`planning_field_value.value` 为 `NOT NULL`。
  **Rationale**：平台对没有值的字段不返回节点，"没有值"的忠实表示是没有行；可空会引入平台不会产生的状态。
  **Date/Author**：2026-09-23 / agent

- **Decision**：同步 `packages/capabilities/src/registry.ts` 的 `StorageSurface` 成员锁（D10）。
  **Rationale**：它是端口面的编译期成员锁，不同步就让 `tsc --noEmit` 失败；这条跨列改动在 PR 描述里点名。L3 会改同一行，冲突由 L3 变基时解决。
  **Date/Author**：2026-09-23 / agent

- **Decision**（**Superseded by D12（2026-09-23）与 D13（2026-09-24）**：`identity_projection` 与父键 `UNIQUE (id, entity_id)` 都已删除，本条不再适用于现行 schema）：`identity_projection` 的身份外键改成复合外键 `(identity_id, entity_id) → external_identity (id, entity_id)`，父键用 `UNIQUE (id, entity_id)`（D11）。
  **Rationale**：两个单列外键允许投影把身份挂到另一个**存在**的实体上，于是"这个身份属于哪个实体"有了两份可以互相矛盾的存储（实测被接受）。复合外键让矛盾在库层面不可表达，与本层 `work_item` / `change_request` 的既有模式一致。
  **Date/Author**：2026-09-23 / agent

- **Decision**：DDL 的 CHECK 取值集合与 domain 常量的绑定用例独立成 `tests/integration/identity-membership-enums.test.js`（D11）。
  **Rationale**：本计划约束"单文件 ≤ 200 行"，并进 `identity-membership-schema.test.js` 会到约 240 行；该文件的职责（表与约束的拒绝用例、出处映射）与"防止 DDL 与 domain 常量漂移"也是两件事，分开后各自的失败信息直接指向根因。
  **Date/Author**：2026-09-23 / agent

- **Decision**（**Superseded by D13（2026-09-24）**：其中「行为 2 的强制点回到身份解析 + 主键」的机制表述不成立，真实强制点是 core 的 `entityKindFor` 与 e2e，见 D13 第 4 条；「删除三张分类/连接表、不加锚点、不用触发器」这一半仍然有效）：删除 `work_item` / `change_request` / `identity_projection` 三张分类/连接表；行为 2 的强制点回到身份解析 + `workspace_projection` 的 `(workspace_id, entity_id)` 主键；不在投影上加成员关系锚点、不用触发器做种类闸门。
  **Rationale**：评审 P1 实测那个锚点列在端口契约里没有来源（`putPlanningProjection` 无法填充 NOT NULL 列），而它要保护的性质不是任何验收标准；真实机制是"同一底层对象只有一个实体"，主键使第二个工作项行在 schema 上不可达。放弃的部分（种类一致性不再是库级约束）登记为 core 推导义务并带收口条件。
  **Date/Author**：2026-09-23 / agent（按人类伙伴的裁决执行）

- **Decision**：端口契约要求引用完整性——`putMembership` 指向不存在的工作区、`putFieldValue` 指向不存在的成员关系都必须被拒绝，两个实现语义一致（内存替身补上同样的检查）。
  **Rationale**：评审实测三行分歧表（fake 接受 / schema 拒绝）；端口若允许一个实现写垃圾而另一个拒绝，契约就不成立。
  **Date/Author**：2026-09-23 / agent

- **Decision**：`provider_binding` 收窄为连接锚点 `(id, implementation_key)`，新增 `workspace_binding(workspace_id, binding_id, domain, enabled, is_default)` 承载工作区挂载（D13 第 1 条）。
  **Rationale**：用户裁定（2026-09-24）。三条权威文档同时指向这个形状：issue #27 的 Scope 明列 connector accounts、ADR-0001 的 Consequences 要求跨工作区复用、裁决 §2.1 已把行为 1 判 `pass`；`external_identity` 的键形状逐字不变，因此裁决 R1 的「键形状不变」继续成立，不需要新的门禁裁定。理由与放弃的方案见 `docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md`。
  **Date/Author**：2026-09-24 / 用户裁定（批准者 handle 与批准位置待人类伙伴确认，范围＝采用 ADR-0006 方案，不裁定「一个库一个工作区」），agent 记录

- **Decision**：行为 2 的强制点改判到 core 的 `entityKindFor` 与 e2e；storage 只保证「同一工作区里同一实体只有一行投影」（D13 第 4 条，ADR-0005 订正）。
  **Rationale**：评审实测「第二个工作项行在 schema 上不可达」不成立——storage 不强制内容种类一致性，主键只排除同一实体的第二行。把不属于 storage 的性质写成库级保证，会让下一个人去补一个没有输入来源的闸门（D12 第 3 条已记录那次尝试的代价）。
  **Date/Author**：2026-09-24 / agent

- **Decision**：issue #27 验收 1 改实现到字面（`domain` 的 CHECK 绑定 `CapabilityDomain` + `workspace_binding_planning_enabled` 部分唯一索引），并删除被主键严格蕴含的第一条成员关系唯一约束（D13 第 2、3 条）。
  **Rationale**：原实现只拒绝「启用且默认」的第二个挂载，不是验收 1 的字面要求，而本层的集成用例当时断言的恰是相反行为；第一条唯一约束删掉后集成与契约用例全绿，证明它是死约束。收窄验收需要人类批准，按字面实现不需要。
  **Date/Author**：2026-09-24 / agent

- **Decision**：第四轮评审响应轮接管两处跨列改动：`tests/contract/storage-contract.test.js`（注册新套件）与 `tests/e2e/chain-bootstrap.test.js`（#27 验收 3 的生命周期断言）。
  **Rationale**：注册行是「一个端口面一个套件文件」分工的一部分；e2e 断言是 #27 验收 3 在本合并点唯一的判别性证据，而该文件属于 base 的既有测试。两处都由本层实际改动，原「那是 L4 的文件」的放弃理由因此不成立。
  **Date/Author**：2026-09-24 / agent

- **Decision**：本层以 `Refs #27` 交付，不写 `Closes`。
  **Rationale**：#27 验收 3 要求「恰好一个 primary」由数据库保证；002 的部分唯一索引只保证「至多一个」，零个 primary 在替身与 SQLite 上都被接受（第五轮评审复现）。`DEFERRABLE INITIALLY DEFERRED` 复合外键可以声明式表达它，代价是 `putEntity` 与 primary 身份同事务写入并改写套件里独立的 `putEntity` 前置——不是端口签名变更（第四轮已推翻该前提），但本层代码体量已是 1000 / 1000。收口条件＝L2 / L4 代码预算允许或六层重新划分尺寸时，承载 #190；本层未钉住的约束变异由 #201 承载。
  **Date/Author**：2026-09-26 / agent（第五轮 MMP 评审，评审者就地订正）

## Idempotence and Recovery

- 本层的验证命令都是只读且可重复的；注入实验要求还原并复跑确认变绿。
- 迁移运行器幂等：重复运行只报告"无事可做"；每个集成用例用自己的临时目录与临时库。
- 提交序列按"先失败的用例 / 再实现"两段：第一段只加测试（红），第二段让它们变绿。要在两段之间回到已知良好状态，`git checkout -- tests/` 即可。
- 002 已在本机跑过之后要回到干净状态：删除临时目录里的库文件（集成用例自带临时目录，不会留下共享库）。本轮不发布，不存在生产库。

## Interfaces and Dependencies

**本层对内提供的接口**

```text
packages/domain/src/identity.ts
  MembershipContentKind = { Issue: 'issue', Draft: 'draft', ChangeRequest: 'change_request' }

packages/capabilities/src/storage.ts
  ProviderBindingRecord  # 形状不变，语义收敛为「某工作区挂载某连接」的视图；锚点 id 跨工作区共享（D13 / ADR-0006）
  MembershipRecord  = (workspaceId, projectExternalId, itemExternalId, contentKind, contentExternalId,
                       membershipCreatedAt, membershipUpdatedAt)
  FieldValueRecord  = (workspaceId, itemExternalId, projectFieldId, value, observedAt)
  putMembership(record) / getMembership(workspaceId, itemExternalId) / listMemberships(workspaceId, projectExternalId)
  putFieldValue(record) / listFieldValues(workspaceId, itemExternalId)

packages/storage/sqlite/migrations/002_identity_membership.sql
  workspace, provider_binding, workspace_binding, entity, external_identity,
  project_item_membership, planning_field_value, workspace_projection
```

**依赖的既有决策与外部条件**

- `docs/architecture/gate-e1-ruling.md` §4 的 R1 / R2 / R3 / R7、§5 的被推翻假设、§6.1 的成员关系落点结论。
- `docs/adr/ADR-0002-membership-identity-separate-from-content.md`（成员关系独立表、外键指向 `item_external_id`）。
- `docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md`（`provider_binding` 是跨工作区的连接锚点，`workspace_binding` 是工作区挂载；`external_identity` 的键形状不变）。
- `packages/storage/sqlite/src/migrate.ts` 的运行器语义（版本单调、从空库可重复、版本号在迁移体成功之后写入）。
- Node 26 的 `node:sqlite`；无第三方运行时依赖。
- 本层不依赖网络、凭据与沙箱：全部证据在本地临时库上产生。

## Outcomes & Retrospective

实际体量与验证（2026-09-23 观察，在检出 `feature/storage-identity-membership-tables` 的工作树根目录运行）。行数是易失值：下表是观察时刻的值，复核用 `wc -l packages/domain/src/identity.ts packages/capabilities/src/storage.ts packages/providers/fake/src/storage.ts packages/storage/sqlite/migrations/002_identity_membership.sql packages/storage/sqlite/src/migrations.ts packages/storage/sqlite/src/db.ts tests/contract/suites/storage.js tests/integration/identity-membership-schema.test.js tests/integration/identity-membership-enums.test.js packages/capabilities/src/registry.ts`。

| 文件 | 行数（2026-09-23 观察） |
|---|---|
| `packages/domain/src/identity.ts` | 147（新增 6 行） |
| `packages/capabilities/src/storage.ts` | 171（新增 44 行） |
| `packages/providers/fake/src/storage.ts` | 199（净增 14 行：新增 21 行、压缩无关签名与空行 7 行） |
| `packages/storage/sqlite/migrations/002_identity_membership.sql` | 141（回复轮 +6：复合外键与父键；**Superseded by D12 / D13（2026-09-23 / 2026-09-24）**：复合外键与父键已随分类表删除，002 在 2026-09-24 被整份重写，行数以复核命令的实时输出为准） |
| `packages/storage/sqlite/src/migrations.ts` | 60（清单项 +1；模块注释按控制计划 D10 重写——**订正 2026-09-24**：原记「只加一行清单项，其余是重排」） |
| `packages/storage/sqlite/src/db.ts` | 26（回复轮只改注释） |
| `tests/contract/suites/storage.js` | 199（回复轮 +5：字段值的条目判别断言；2026-09-24 复读时已超过 200 行，见下） |
| `tests/integration/identity-membership-schema.test.js` | 195（回复轮 +13：投影实体的拒绝用例；**Superseded by D12（2026-09-23）**：投影实体的拒绝用例已随 `identity_projection` 删除） |
| `tests/integration/identity-membership-enums.test.js` | 95（回复轮新增：CHECK 取值集合与 domain 常量的绑定） |
| `packages/capabilities/src/registry.ts` | 59（只改第 59 行的成员锁） |

**Superseded by 本段（2026-09-24）**：原写「全部 ≤ 200 行」；2026-09-24 复读时 `tests/contract/suites/storage.js` 与 `packages/providers/fake/src/storage.ts` 都已超过 200 行——这句在写入时就不成立（评审在同一天的观察是 211 / 205，此后随评审响应轮继续增长，以复核命令的实时输出为准）。函数 ≤ 40 行沿用 2026-09-23 的观察（最长的是 `seed()`，24 行）。处置见遗留问题第 6 条。

**八张表 → 端口方法**（验收表第 13 项的核对结果；D12 / D13 订正后）：

| 表 | 写者 | 读者 |
|---|---|---|
| `workspace` | `putWorkspace` | `getWorkspace` |
| `provider_binding`（连接锚点） | `putProviderBinding`（写 `id` / `implementationKey`；同一 `id` 换实现被拒绝） | `listProviderBindings` |
| `workspace_binding`（工作区挂载） | `putProviderBinding`（写 `domain` / `enabled` / `isDefault`） | `listProviderBindings` |
| `entity` | `putEntity` | （经身份与投影间接读；无独立读方法） |
| `external_identity` | `putExternalIdentity` | `findExternalIdentity` / `listIdentitiesForEntity` |
| `project_item_membership` | `putMembership` | `getMembership` / `listMemberships` |
| `planning_field_value` | `putFieldValue` | `listFieldValues` |
| `workspace_projection` | `putPlanningProjection` / `replacePlanningProjections` | `getPlanningProjection` / `listPlanningProjections` |

（原表里的 `identity_projection` / `work_item` / `change_request` 三行已按 D12 删除——它们当时没有写者也没有读者。）

### 遗留问题与技术债务

1. **（已消失）三张表没有端口入口**——**Superseded by D12（2026-09-23）**：`identity_projection`、`work_item`、`change_request` 已删除，本项与「验收表第 13 项不成立」随之消失。原文保留：这三张表由迁移 002 建出但没有端口方法（D7），可选去向是在 L4 补方法（与 L4 的"不新增端口方法"冲突）、由 core 的投影构建落地时新增端口方法、或明确它们只被库层面用例证明。
2. **L3 的预期冲突**：`packages/capabilities/src/registry.ts` 第 59 行的成员锁与 `packages/storage/sqlite/src/migrations.ts` 的清单项都会被 L3 再改一次；变基时按"两边都保留、按接口顺序排列"解决。
3. **`entity` 没有独立的读方法**：它的读者是身份与投影查询的隐含部分。若 core 需要按种类列实体，那是新增端口方法的时刻，不在本层。
4. **`putMembership` 的"后者胜"与孤儿字段值语义只在内存替身上有断言**：这些断言在 `tests/contract/suites/storage-identity-membership.js` 的**同步组**里，SQLite 侧要等 L5/L6 的同步面落地才会跑（L4 只注册地基组）。因此这条语义在 L5/L6 落地前只被一个实现证明过——本层无法在 SQLite 上跑端口，端口实现是 L4–L6 的闭环。收口条件：L5/L6 把同步组注册给 SQLite 之后，两个实现跑同一套断言。
5. **种类一致性不再是库级约束（ADR-0005 的收口条件）**：storage 不强制投影的 `content_kind` 与成员关系的 `content_external_kind` 一致；它是 core 推导的义务，当前由 `entityKindFor`（`packages/core/src/identity.ts:35`）与 e2e（`tests/e2e/chain-bootstrap.test.js:46`）覆盖。收口条件：真实 provider 切片出现推导实现时，补一条「推导出的 `content_kind` 必须与成员关系的种类一致」的断言。ADR-0005 的 `Consequences` 指向本条。**承载（2026-09-26）**：#27 验收 2 由 #76 的 e2e 承接，委托关系同时登记在 #27 的评论里——只读 issue 的人也能看到。
6. **单文件 ≤ 200 行被两处突破**：`tests/contract/suites/storage.js` 与 `packages/providers/fake/src/storage.ts` 在 2026-09-24 观察时都超过 200 行（评审当时的实测：211 / 205；此后随评审响应轮继续增长，以 `wc -l` 的实时输出为准；复核命令见 `Outcomes & Retrospective`）。两条可选去向：按用例类别拆出第二个套件文件（需要控制计划把新文件写进 L2/L3 的文件集合，否则越界），或由控制计划的持有者放宽该约束并说明理由。本层不自行放宽。
7. **端口记录跨两张表**：`ProviderBindingRecord` 同时承载连接锚点的 `implementationKey` 与工作区挂载的 `domain` / `enabled` / `isDefault`，`putProviderBinding` 一次写 `provider_binding` 与 `workspace_binding` 两行。这是 D13 拆表后保留的端口形状（公共接口不因拆表而变），代价是"连接"这一层没有独立的写入口；若将来需要跨工作区列出某条连接的全部挂载，那是新增端口方法的时刻，不在本层。

## Bottom Change Note

- 2026-09-23：首次创建。原因：控制计划 D9 要求每一层建立自己的 ExecPlan；本层（Batch L2 / #27）的批次、验证命令与回滚点在这里承载。
- 2026-09-23：新增 D10，把 `packages/capabilities/src/registry.ts` 的成员锁写进文件集合与跨列改动。原因：端口一改，`tsc --noEmit` 就在 `registry.ts(59,37)` 失败——这条依赖关系在控制计划的 L2 行里没有写出来，不写进计划就会在下一次端口变更时被重新发现一次。
- 2026-09-23：`Surprises & Discoveries` 追加两条实测（成员锁、套件行数上限的处理），`Outcomes & Retrospective` 与 `Progress` 按实际结果填写。
- 2026-09-23：新增 D11 与回复轮记录。原因：对抗验收的四条意见里有三条是"同一事实两份存储、可以互相矛盾"的同一根因（投影实体、DDL 取值集合、字段值的条目分量），第二条改动了 002 的约束形状。把根因、被放弃的方案与两次变异输出写进计划，下一次改 002 或加受约束列的人不必重新发现一遍。
- 2026-09-23：文件集合按回复轮实际改动扩了两处（`db.ts` 注释、新增 `identity-membership-enums.test.js`），在 `Global Constraints` 里点名；`Outcomes & Retrospective` 的体量表按实测订正（002 原记 120 行，实测 135 行）。
- 2026-09-23：按 PR #122 的 8 条评审意见订正：D12（七张表、行为 2 的强制点、放弃锚点与触发器的判据）、D3/D7 就地标注为历史、验收表第 1/13 项更新并新增第 14 项、Decision Log 两条、遗留问题登记种类一致性的收口条件。原因：评审 P1 指出投影锚点在端口契约里没有来源，P2 指出种类闸门单向可绕；按第一性原理改的是强制点，不是补一个触发器。
- 2026-09-24：按 PR #122 的 2026-09-24 评审（`docs/review/2026-09-24-pr-122-mvp-review.md`）与评审响应轮（`docs/exec-plan/active/2026-09-24-stack-review-response.md` 的 Batch 4–6）做文档清扫：新增 D13（连接锚点与工作区挂载拆开、八张表、验收 1 字面化、行为 2 的强制点在 core），D1 / D2 / D5 / D11 / D12 就地标注 Superseded，验收表第 3/7/8/11/13/14 项改判并修掉两个重复的 `14` 编号，表 → 端口映射从十张改为八张，遗留问题第 1 条标记为已消失并补上第 5–7 条。原因：评审逐处点名「验收 #8 仍按 CHECK 与复合外键判通过」「两个 #14」「`migrations.ts` 本层没有改它」「十张表映射」「遗留 1 仍称三张表由 002 建出」「Interfaces 仍列十张表」「全部 ≤ 200 行不实」「横幅漏 D11」「D11 与 Decision Log 仍把 `UNIQUE (id, entity_id)` 当现行设计」。另：上一条记录称"遗留问题登记种类一致性的收口条件"，但该条当时并未写进遗留问题（ADR-0005 指向它却落空），本次补为第 5 条；两处易失值（体量表的行数、`Progress` 的用例数）改成观察时刻标注 + 回读命令。
- 2026-09-26：第五轮 MMP 评审无 P0 / P1，评审者就地订正后归档：`Refs #27` 的理由改成真实代价并补 Decision Log、D6 标题去掉不成立的类比、遗留第 5 条写明 #76 承接；约束变异的测试债由 #201 承载（本层代码已到 1000 / 1000）。
