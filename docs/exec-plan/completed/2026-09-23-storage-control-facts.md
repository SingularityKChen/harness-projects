# Storage 控制事实 ExecPlan

> 状态：Completed（2026-09-26 随 #157 合并归档；#28 保持开启，关闭归属待人类伙伴决定——见收敛计划 Decision Log）
> 创建：2026-09-23
> 范围：L3 / issue #28；为执行、关系、同步观察、游标、webhook、外部写入与工作区修订建立 SQLite 003 迁移，并将 R4/R5/R8 的可用语义放入 Storage 端口与内存替身。
> 上游输入：`docs/exec-plan/completed/2026-09-23-sqlite-v1-stack.md`、`docs/architecture/gate-e1-ruling.md` §4 R4/R5/R6/R8、`docs/architecture/gate-e1-uncertain-create.md` §2、`docs/exec-plan/completed/2026-09-23-storage-identity-membership.md`、`docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md`、`docs/adr/ADR-0005-projection-anchor-and-behaviour-2-enforcement.md`

## Purpose / Big Picture

完成后，L2 已建成的身份与成员关系表之上有一层可追溯的控制事实模型：执行上下文与运行、确认关系与候选关系、观察定序、同步/对账游标、webhook 订阅、未决外部写入和工作区修订均可落库。`Storage.recordObservation` 在内存替身中明确区分重复/乱序未应用，且对账游标按工作区隔离；003 集成测试从空库验证十一张表、约束和 D8 出处映射。

最小成功证据：

1. `node --test tests/integration/execution-relation-write-schema.test.js` 通过，空库建表、重跑 no-op、出处逐表 token 断言、R4/R5/R6/R8 与外键约束均有判别性断言。
2. `node --test tests/contract` 通过，内存替身的观察定序、去重和对账游标契约通过。
3. 全部用户指定验证命令通过，且 `git diff --check "$BASE"...HEAD` 无输出（`BASE=$(gh pr view 157 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`；原文写死的 `7138a5d` 是观察时刻快照，级联后不可复跑）。

## Context and Orientation

`002_identity_membership.sql` 已提供 `workspace`、`provider_binding`、`workspace_binding`、`entity`、`external_identity`、`project_item_membership`、`planning_field_value`、`workspace_projection`。003 只新增本层拥有的十一张表，不改 001/002。关系端点必须引用 `entity`；字段值的成员关系外键落在 `project_item_membership(item_external_id)`，不落内容身份；**观察账本不引用成员关系**（账本是只追加的历史，成员关系是会被改写的当前挂载点，见 003 注释与 PR170 评审的判据）。R4 的 `updated_at` 是平台快照版本列，`observed_at` 是本地接收时刻；同版本整快照替换，旧版本拒绝。R5 的对账游标是 workspace 级全量对账时刻，列集合必须恰好是声明集合且不含平台 `updated_at`。R8 的 pending 状态恰好为 `confirmed`、`reconciled`、`failed`、`uncertain`；内容 id 是既有内容写入的幂等键，未决行用部分唯一索引阻止第二次外部写。

**Superseded by 003 / 本层 Batch C（2026-09-24）**：写尝试表是 `mutation_attempt`、模型是**一行一键**（主键 `(workspace_id, idempotency_key)`，写入是幂等覆盖 UPSERT），状态列取 `packages/domain` 的 `WriteState`（pending / saved / unknown / conflict / failed）；原文的四个取值是 L1 的**获知方式**标注，映射见 D14。"未决行存在时不得发起第二次外部写"是**调用方**的义务（**第五轮订正**：当前没有调用方先 `findMutationAttempt`——core 在外部写完成后才记录，#204），不是库层的部分唯一索引。回读命令：`BASE=$(gh pr view 157 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`；`git show "$BASE":packages/storage/sqlite/migrations/003_control_facts.sql | sed -n '/CREATE TABLE mutation_attempt/,/);/p'`。

工作边界严格限于用户列出的文件；不改 `packages/core/**`、001/002、控制计划或其它层计划，不 push，不做 gh 写操作。

## Design / Spec

### 表与约束

003 创建：`repository`、`execution_context`、`execution_run`、`relation`、`candidate_relation`、`sync_observation`、`sync_cursor`、`reconcile_cursor`、`webhook_subscription`、`pending_external_write`、`workspace_revision`。每张表和每条约束在 SQL 上方写 D8 注释。能用 `CHECK`、`UNIQUE`、外键和部分唯一索引表达的性质不使用触发器；本批没有需要触发器的性质。执行上下文以 `(workspace_id, work_item_id, repository_id)` 的 active 部分唯一索引表达；候选关系单独存储，规则发现关系不得进入确认关系表；pending 的未决状态由部分唯一索引保护。

**Superseded by 003 / 本层 Batch C（2026-09-24）**：表集合里的 `pending_external_write` 现名 `mutation_attempt`；"pending 的未决状态由部分唯一索引保护"不再成立——`mutation_attempt` 的主键是 `(workspace_id, idempotency_key)`，未决阻塞由调用方按 `WriteState` 判定。

`sync_observation` 使用成员关系键 `(workspace_id, item_external_id, observed_at)`，保存 `updated_at`、`snapshot_json` 和处理状态。定序（更大 `updated_at` 更新；相等时整快照替换；更小者拒绝）**由 Storage 端口实现**，不是库级约束：跨行比较无法用 CHECK 表达，本层也不用触发器。它的证据在契约套件（两个实现共用），DDL 只钉住"主体 + 本地接收时刻"这个键。**Superseded by 本节（2026-09-23 复验）**：原文写"DDL 注释与集成测试共同钉住定序"，实测库层 0 触发器、集成用例的拒绝来自主键冲突，属过度声称。003 只定义事实约束，不新增 SQLite Storage 适配器。

**Superseded by 003 / 本层 Batch C（2026-09-24）**：`sync_observation` 的主键是**端口主体 + 本地接收时刻 + 去重键** `(binding_id, object_kind, object_external_id, observed_at, dedupe_key)`（连接级），另有 `UNIQUE(binding_id, dedupe_key)`；原文的成员关系键与 `workspace_id` 已不在键里。`updated_at` 是平台版本载体（`undefined` 落空串，读回还原成 `undefined`），载体校验取**非空 ASCII 可打印**（`isComparableSourceVersion`），不是定宽 ISO-8601——development 域合法地用提交 sha 当 `sourceVersion`，ISO-8601 会拒绝它。回读命令：`git show "$BASE":packages/storage/sqlite/migrations/003_control_facts.sql | grep -n 'PRIMARY KEY (binding_id'`。

### D13. 关系按 `state` 路由，provenance 记在 `source` 上，候选不得降级确认（2026-09-23）

**判据**：关系是**一个事实**（两个实体间的一条边，带类别、来源、确认态），candidate / confirmed 是它的**状态**而不是第二种事实；`#28` 的"分开存"是**存储表示**的关切（不变量 5：关键关联显式优先，候选不得冒充确认）。因此职责切分是"**调用方给语义，storage 定表示**"：`putRelation(workspaceId, relation)` 按 `relation.state` 路由到两张表，升为 confirmed 时删除候选行，`listRelations` 合并返回。

**被放弃的方案**：给 `candidate_relation` 单独开端口方法（`putCandidateRelation` 等）。放弃理由：它把存储表示泄漏进端口，并迫使 core 的两个调用点分叉（`recordEdges` 走候选、`confirmRelation` 走确认），而 core 在本轮不可改。

**provenance 的粒度**：端口能表达的就是 domain 的 `RelationSource`（explicit / deterministic / lineage）；更细的 `EdgeProvenance` 是 core 的推导输入，落库前已被 `sourceForProvenance` 归约，且没有任何消费者按它分支——按"没有消费者的列不加"归入 `source`。

**补上的一条规则（不变量 5 的直接推论）**：同键已有 confirmed 行时，写入 candidate 是 **no-op**（候选不得降级确认）。契约套件有判别性用例（去掉规则 → 407/408 红）。

### D14. 写尝试只有一个家：合并到端口的 `WriteState`（2026-09-23）

**问题**：L3 的 `pending_external_write`（L1 证据的 4 个取值）与端口既有的 `MutationAttemptRecord`（`WriteState` 的 5 个取值）是**同一事实的两个家**——正是 L2 评审时拆掉的那类结构。

**判据**：两者是**不同的轴**，不是一个轴的两种粒度。`WriteState` 是**结果轴**（pending / saved / unknown / conflict / failed）；L1 的四个取值是**"怎么得知结果的"**（响应 / 对账 / 显式拒绝 / 无法判定）。消费者只按结果轴分支（core 的写状态机决定重试/对账/上报；ADR-0004 的产品可见性判据问的是"结果是否已确立"），"响应 vs 对账"不是产品可见差异。

**决定**：表改名为 `mutation_attempt`，列集合就是端口既有的 `MutationAttemptRecord`（+ 审计时间戳），`state` 用 `WriteState`；R8 的实质"未决行存在时不得发起第二次外部写"由 `(workspace_id, idempotency_key) WHERE state IN ('pending','unknown')` 的部分唯一索引表达。L1 的四个取值**作为证据与映射**留在本计划（confirmed→saved、reconciled→saved、failed→failed、uncertain→unknown），不冻结成第二套状态列。

**Superseded by 003 / 本层 Batch C（2026-09-24）**：实际落地的是**一行一键**——主键 `(workspace_id, idempotency_key)` 加 `UNIQUE(workspace_id, id)` 与 UPSERT，没有 `WHERE state IN ('pending','unknown')` 的部分唯一索引；"未决行存在时不得发起第二次外部写"改由调用方先 `findMutationAttempt` 判定（**第五轮订正**：当前没有调用方这样做，#204）。

**连带效果**：这张表不再有"无端口路径"的例外——端口已有 `putMutationAttempt` / `findMutationAttempt` / `listMutationAttempts`，它的写者与读者是这三个端口方法（SQLite 实现由 L4–L6 接入）。

### D15. R4 的"乱序不覆盖"是构造性的：`committed_observation` 视图（2026-09-23）

**判据**：库里只有一个写者（端口实现），所以"实现会不会忘记定序"由契约套件钉住；但**结构**应当让"两个互相竞争的已提交快照"不可表示。`sync_observation` 是**账本**（PK 含本地接收时刻），"已提交"由账本派生。

**决定**：加视图 `committed_observation` = 每个主体（**绑定 + 条目**，即 `(workspace_id, binding_id, item_external_id)`）`updated_at` 最大、同版本时 `observed_at` 最新、再同则 `rowid` 最大（最后追加）的那一行。 **Superseded by 003 / 本层 Batch C（2026-09-24）**：视图主体是端口 subject `(binding_id, object_kind, object_external_id)`（连接级），不再含 `workspace_id` / `item_external_id`；末级 tie-break 仍是最后追加。于是 R4 的"乱序观察不得覆盖新观察"**由构造保证**：旧行即使落进账本，也永远不是 committed。视图是声明式的，不需要触发器。`workspace_revision` 的单调仍登记为**端口职责**（跨时间比较无法声明式表达，本层不用触发器），由契约套件钉住。

### 端口

新增 `ReconcileCursorRecord` 与 `getReconcileCursor` / `putReconcileCursor`。`recordObservation` 注释明确 `false` 表示本次观察未被应用（重复或乱序），调用方不得读成已应用。内存替身按 `(bindingId, dedupeKey)` 去重，并按同一主体比较 `sourceVersion`：旧版本拒绝，相同版本整条观察替换；不同主体可独立推进。对账游标按 workspace upsert。

### 放弃方案

**Superseded by D14（2026-09-23）**：原文写"不把 `pending_external_write` 做成五态，状态集合必须精确四态"。按第一性原理重判后改为合并到端口既有的 `WriteState`——L1 的四个取值是"**怎么得知结果的**"（响应 / 对账 / 显式拒绝 / 无法判定），不是结果轴；`confirmed` 与 `reconciled` 都落到 `saved`，`uncertain`→`unknown`，`failed`→`failed`。消费者（core 的写状态机、产品可见性）只按结果轴分支。不以 webhook 作为字段值/成员关系的外键来源；R6 只要求不存在该外键，正确性仍由全量对账收敛。不用触发器实现定序或 pending 幂等，因为唯一索引与端口写入语义足够表达，且触发器会增加插入/更新双向测试和维护成本。

## Global Constraints

- 只修改用户允许的文件；不改 core、001、002、其它层计划和控制计划。
- 代码 ≤1000 行，文档 ≤1500 行；单文件 ≤200 行、单函数 ≤40 行；不新增依赖。
- SQLite 只使用现有 `node:sqlite`；外键连接级开启由现有 `openDatabase` 保证。
- 每条守卫必须有判别性证据，并记录改坏→变红→还原→变绿。
- 提交格式 `<type>(<scope>): <中文摘要>`，不 push。

## Plan of Work

### Batch L3-A · 先写判别性契约与 schema 集成用例

**最小闭环**：用例先证明新端口和十一张表不存在/不满足时会失败。
**涉及文件**：`tests/contract/suites/storage.js`、`tests/integration/execution-relation-write-schema.test.js`

1. 增加观察新旧定序、重复 N 次等价、游标隔离契约。
2. 增加空库/出处双向覆盖、R4/R5/R6/R8、关系候选分表、执行唯一性、修订单调和外键用例。
3. 运行两份新增用例，确认在实现未完成时按预期失败；记录失败摘要。

### Batch L3-B · 端口与内存替身

**最小闭环**：契约测试在内存替身上全绿。
**涉及文件**：`packages/capabilities/src/storage.ts`、`packages/capabilities/src/registry.ts`、`packages/providers/fake/src/storage.ts`

增加记录形状、StorageSurface 锁和内存定序/游标实现；运行 `node --test tests/contract` 与 tsc。

### Batch L3-C · 003 迁移、清单和文档

**最小闭环**：空库能应用 003，所有 DDL 约束和出处可被集成测试验证。
**涉及文件**：`packages/storage/sqlite/migrations/003_control_facts.sql`、`packages/storage/sqlite/src/migrations.ts`、`docs/README.md`

编写十一张表和声明式约束，清单新增 version 3，索引登记本 ExecPlan。运行集成用例并做一次破坏性变异实验后还原。

### Batch L3-D · 全门禁与提交

**最小闭环**：用户指定验证命令全部有实际摘要，计划 Progress/Surprises/Outcomes 同步，提交单一可回滚闭环。
**回滚点**：回退本层提交即可恢复本层 base（L2 head；`BASE=$(gh pr view 157 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`；原文写死的 `7138a5d` 是观察时刻快照，不可复跑）的 schema、端口和文档。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 003 十一表、二次 no-op | `execution-relation-write-schema.test.js` 首测 |
| 表→出处逐表覆盖 | 每张表的出处注释必须带该表期望 token（逐条 `assert.match`），全文 token 在白名单内，表集合与 sqlite_master 相等 |
| R4 定序与整快照 | 旧观察拒绝、同版本替换、注释 marker、账本不要求成员关系父行存在 |
| R5 游标 | `reconcile_cursor` 列集合恰好声明集合、workspace 唯一 |
| R6 外键边界 | 两张 L2 表的 foreign_key_list 不含 webhook_subscription |
| R8 | 五态集合相等、同键写入是幂等覆盖（后写取代先写）、同键只有一行（**Superseded by 003 / 本层 Batch C（2026-09-24）**：原文写"未决行拒绝同键重复、已决行可被同键新写入取代"，现行模型是一行一键） |
| 关系/执行/修订 | entity 外键、candidate 分表、active 唯一、修订删除不倒退 |
| 全仓门禁 | 用户指定验证命令均通过（观察时刻快照：本轮 5 条；以命令回读为准） |

## Progress

- [x] (2026-09-24) **第三轮评审响应（本层 12 条）**：按根因修，不逐条打补丁。① **账本主体改成端口主体** `(binding, object_kind, object_external_id)`、作用域定为**连接**——旧主体用成员关系派生出的条目 id，于是定序主体随成员关系漂移、"对账先到"表达不出来、同连接多工作区时落点取决于挂载顺序（三格都由评审实测）；顺带关掉了"core 的 `recordObservations` 不写成员关系 → SQLite 整笔同步事务回滚"这条 P1 遗留。② **版本定序收敛到一个导出的比较器** `compareSourceVersion`（码点序，与 SQLite 的 BINARY 等价），两个实现都用它，并在 `recordObservation` 入口拒绝非 ASCII 载体——分叉从"未被发现"变成"不可达"。**没有**采纳"只接受 ISO-8601"：development 域合法地用提交 sha 作 `sourceVersion`，收窄会打断它。③ **写尝试取一行一键模型**（主键 `(workspace_id, idempotency_key)`、`id` 工作区内唯一、UPSERT），把 DDL / 端口 / 替身 / core 四份说法收敛成一份。④ 工作区作用域经**复合外键**传递（仓库→执行上下文→运行），并给 `relation` 两端、`candidate_relation` 来源、`mutation_attempt` 的绑定/幂等键/状态补上只因该约束失败的判别性用例。逐条处置见 `docs/exec-plan/completed/2026-09-24-review-root-cause-convergence.md`。
- [x] (2026-09-23) 阅读控制计划、裁决、L2 迁移与既有契约模式；确认文件边界。
- [x] (2026-09-23) 完成 L3-A 判别性测试并记录 RED：先运行既有 L2 schema 用例，确认 003 新表使旧七表精确集合断言变红；新增 L3 用例随后在实现前覆盖端口/DDL 缺口。
- [x] (2026-09-23) 完成 L3-B 端口与内存替身：契约用例通过（观察时刻快照：20 条），包含旧观察 false、重复/同版本替换和 workspace 游标隔离。
- [x] (2026-09-23) 完成 L3-C 003 迁移、清单与索引：集成用例通过（观察时刻快照：L3 schema 7 条，L2 原有 9 条）。
- [x] (2026-09-23) 完成全门禁、提交与最终记录。
- [x] (2026-09-23) 复验修复：relation/candidate 与端口一致（source 放宽到 domain 全集、候选行加 state、provenance 并入 source、按 state 路由）、内存替身去重持久化、R8 四态断言改成完整集合、部分唯一索引的"部分性"用例、D8 token 白名单、revision 断言不再空转、计划与 DDL 的过度声称对齐。
- [x] (2026-09-23) 评审修复轮（PR157/PR170）：账本去掉成员关系外键、`committed_observation` 主体含 `binding_id` 且末级 tie-break 取最后追加、`mutation_attempt` 已决行可被同键新写入取代、D8 改逐表期望 token 断言、出处引用改指发布门禁 R1 第 10 项；三条变异实验（⑥⑦⑧）红→还原绿。
- 注入实验（改坏 → 红 → 还原 → 绿，摘要）：① 删 `pending_external_write_content` 索引 → 集成 21/22 红 → 还原 22/22；② CHECK 加第 5 个取值 `retrying` → 复验时仍绿（已修为完整集合断言）；③ 去掉部分索引的 `WHERE state='uncertain'` → 复验时仍绿（已补"未决之外的状态不阻塞同键写入"用例）；④ D8 把 `R5` 改成 `R95` → 复验时仍绿（已改 token 白名单）；⑤ 内存替身同版本替换体改坏 → 契约仍绿（**未覆盖**：契约套件里唯一的同版本调用复用同一个 `dedupeKey`（`tests/contract/suites/storage.js` 的"定序按字典序比较 ISO 版本"用例），在去重那一步就返回 `false`，走不到 tie-break，替身里 `compareSourceVersion(...) >= 0` 这一分支因此没有判别性用例——收口条件见遗留 2）；⑥ D8 把 `reconcile_cursor` 与 `webhook_subscription` 的 `R5`/`R6` 对调 → 集成红（逐表期望 token）→ 还原绿；⑦ `committed_observation` 的 `NOT EXISTS` 去掉 `binding_id` → 集成红（两个绑定各有一行 committed）→ 还原绿；⑧ 给 `sync_observation` 加回指向 `project_item_membership` 的外键 → 集成红（成员关系消失后账本行仍在）→ 还原绿。

验证摘要（在检出 `feature/storage-execution-relation-write-tables` 的工作树根目录运行；**条数与体量一律回读，不写死**）：`BASE=$(gh pr view 157 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`；`node --test tests/integration`、`node --test tests/contract`（含 `tests/contract/package-boundaries.test.js`）、`node --test tests/e2e`、`node --test tests/mvp0`、`tsc --noEmit`、`node scripts/rule-checks.mjs size "$BASE"`、`git diff --check "$BASE"...HEAD` 均通过。2026-09-23 评审修复轮复跑的观察时刻快照（不可复跑）：集成 24、契约 409（boundaries 7）、e2e 38、mvp0 7、代码 437/1000、文档 186/1500。`pnpm run boundaries` 在隔离工作区因沙箱不允许创建临时安装目录而未执行，边界证据改由 `tests/contract/package-boundaries.test.js` 直接给出。

## Surprises & Discoveries

- 当前 `recordObservation` 只按 dedupe key 去重，不比较主体的 `sourceVersion`；L3 必须扩展为同主体定序而不能只改注释。
- 003 不需要触发器：**能用声明式表达的性质**均由 CHECK/UNIQUE/外键/部分索引表达，并由集成用例覆盖。例外是 R4 的定序与 `workspace_revision` 的单调——跨行/跨时间比较无法声明式表达，二者明确登记为**端口职责**（契约套件钉住两个实现），不在 DDL 里声称。
- **复验暴露的三处过度声称**（2026-09-23）：R4 定序写成 DDL 约束、R8 四态断言先 filter 再比较（加第 5 个取值不变红）、D8 出处只查 marker 存在（把 R5 改成 R95 仍全绿）。三处都已按类修：断言改成完整集合相等 / token 白名单校验 / 文档与机制对齐。

## Decision Log

- **Decision**：把 `ReconcileCursorRecord` 放入现有 Storage，而不新增观察查询方法。**Rationale**：D6/D7 明确端口要覆盖冻结表，R5 只需要 workspace 级游标。**Date/Author**：2026-09-23 / gpt-5.6-sol。
- **Decision**：内存观察的定序比较同一 `(bindingId, subject)` 的 `sourceVersion`，undefined 只与 undefined 相等。**Rationale**：ProviderObservation 的平台版本载体只有 sourceVersion，无法凭空引入新端口列。**Date/Author**：2026-09-23 / gpt-5.6-sol。
- **Decision**：账本主体取**端口主体** `(bindingId, objectKind, externalId)`，作用域是**连接**，观察可以先于成员关系落账。**Rationale**：条目 id 是会被 `putMembership` 改写的当前挂载点，放进只追加账本的身份键会让定序主体随成员关系漂移、"对账先到、成员关系后到"表达不出来、同一条连接挂多个工作区时落点取决于挂载顺序（第三轮评审实测的三格）。**Date/Author**：2026-09-24 / L3 第三轮修复执行者。
- **Decision**：写尝试取**一行一键**模型（主键 `(workspace_id, idempotency_key)`，写入是幂等覆盖 UPSERT，`id` 工作区内唯一）。**Rationale**：三个消费者需求（未决是否阻塞重试、上一次结果、审计）由同一行回答，不需要定序列；DDL / 端口 / 替身 / core 的四份说法收敛成一份。**Date/Author**：2026-09-24 / L3 第三轮修复执行者。
- **Decision**：版本载体校验取**非空 ASCII 可打印**（`ASCII_SOURCE_VERSION`），放弃收敛计划 D3 的 ISO-8601 方案。**Rationale**：development 域合法地把提交 sha 当 `sourceVersion`，ISO-8601 会拒绝它；而 sha 本身不可定序（哈希的字典序与提交先后无关）——那是 provider 侧的缺口，已登记在 `packages/capabilities/src/observation.ts` 的定序约定注释里。两个实现共用 `compareSourceVersion` 一份比较器。**Date/Author**：2026-09-24 / L3 第三轮修复执行者。

## Idempotence and Recovery

迁移运行器通过 `schema_migrations` 保证 003 二次运行 no-op；每个集成用例用独立临时目录。契约测试的 `restart` 仍使用既有内存导出/导入。若测试或变异实验失败，先还原被故意改坏的 SQL/实现，再重跑最窄测试；若提交前发现设计错误，回退本层提交到本层 base（`BASE=$(gh pr view 157 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`；原文写死的 `ad76def` 是观察时刻快照，不可复跑），不修改 L2 文件。

## Interfaces and Dependencies

依赖现有 `@harness-projects/domain` 的 EntityId、Relation、状态枚举与 `ProviderObservation`，现有 `@harness-projects/storage-sqlite` 的迁移清单与 `openDatabase`，Node 内建 test/sqlite/fs。无需外部网络、凭据或 provider API。

## Outcomes & Retrospective

**实际交付**：迁移 `003_control_facts.sql` 十一张表 + `migrations.ts` 一行清单；端口加 `ReconcileCursorRecord` 与 `getReconcileCursor` / `putReconcileCursor`（`StorageSurface` 同步）；内存替身实现观察定序与去重（去重账本按 `(bindingId, dedupeKey)` 只追加，快照取该主体 `sourceVersion` 最大者）；契约套件加观察定序/去重/游标隔离用例；集成用例条数是观察时刻快照（不可复跑：24 条，其中 L3 文件 9 条）。验证以回读为准（`BASE=$(gh pr view 157 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`）：`node --test tests/integration`、`node --test tests/contract`、`node --test tests/e2e`、`node --test tests/mvp0`、`tsc --noEmit`、`node scripts/rule-checks.mjs size "$BASE"`、`git diff --check "$BASE"...HEAD` 均通过；2026-09-23 评审修复轮复跑的观察时刻快照（不可复跑）：集成 24、契约 409、e2e 38、mvp0 7、代码 437/1000、文档 186/1500。

**表 → 端口方法映射**（控制计划 D6 的验收项）：

| 表 | 写者 | 读者 | 说明 |
|---|---|---|---|
| `repository` / `execution_context` / `execution_run` | `putRepository` / `putExecutionContext` / `putExecutionRun` | `listRepositories` / `getExecutionContext` / `findActiveExecutionContext` / `getExecutionRun` | 既有端口 |
| `relation` / `candidate_relation` | `putRelation`（**按 `relation.state` 路由**：confirmed → `relation`，candidate → `candidate_relation`；升为 confirmed 时端口删除候选行） | `listRelations`（两表合并返回） | SQLite 实现必须按 `relation.state` 路由（L6 接入）；本合并点只有替身 |
| `sync_observation` | `recordObservation` | 无端口读回（见遗留 2） | R4 定序由端口实现 |
| `sync_cursor` / `reconcile_cursor` | `putSyncCursor` / `putReconcileCursor` | `getSyncCursor` / `getReconcileCursor` | R5 |
| `mutation_attempt` | `putMutationAttempt` | `findMutationAttempt` / `listMutationAttempts` | D14：与端口 `MutationAttemptRecord` 合并后有了写者与读者 |
| `webhook_subscription` | **无端口路径**（唯一例外） | 无 | 见遗留 3 |
| `workspace_revision` | `advanceRevision` | `currentRevision` | 单调由端口负责 |

**与计划的偏差**：① 原计划写"DDL 注释与集成测试共同钉住定序"，实测不成立，已改为端口职责并把断言搬到契约套件；② `relation.source` 原写 `explicit|lineage`，与 core 的 `confirmRelation`（deterministic 升 confirmed）互斥，已放宽到 domain 全集；③ `candidate_relation.provenance` 原为 NOT NULL 而端口没有该字段，已并入 `source`。

### 遗留问题与技术债务

0. **嵌套事务在运行时静默吞写**（L4 复验发现，未修）：端口类型用 `StorageTransaction = Omit<Storage,'transaction'>` 排除嵌套，但内存替身的 `tx` 是完整实例，事务内再调 `tx.transaction(...)` 不抛错，内层写入**静默丢失**。契约套件没有运行时不变量用例。收口条件：L4 落地时在实现里显式抛错（或在套件里加一条运行时不变量用例），两个实现语义一致。**这条必须与 L4 同批修**，否则 JS 调用方会得到无提示的丢写。


1. **R8"创建内容这一步"的幂等键形状仍未证明**（L1 记录 §3 第 6 条）。表只要求 `idempotency_key` 非空，不强制它等于 `content_id`。收口条件：真实 provider 切片实测该分支后，把结论写进写尝试表的注释与用例。**订正 2026-09-24（L3）**：表名是 `mutation_attempt`（原文的 `pending_external_write` 是观察时刻快照里的旧名）。
2. **端口没有观察读回方法**：因此"整快照替换"只能用返回值 + 落库条数间接断言（契约套件的判别性用例），无法断言"已提交快照内容等于新值"。**同时暴露一个未覆盖分支**（PR157 评审实测）：套件里唯一的同版本调用复用同一个 `dedupeKey`，在去重那一步就返回 `false`，走不到替身的 tie-break（`compareSourceVersion(...) >= 0` 那一格）——注入实验 ⑤ 因此仍绿。收口条件（两条一起满足才算关闭）：① 真实 provider 切片需要读回观察时补 `listObservations`；② 补一条**同 `sourceVersion`、不同 `dedupeKey`** 的投递用例并断言读回的是后投递的快照。
3. **`webhook_subscription` 没有端口路径**：它的写者是订阅管理（真实 provider 切片的 R6 验证），当前只有"不得成为唯一更新来源"这条否定性约束可由库层断言。收口条件：R6 的实现落地时决定端口面。
4. **（已关闭，2026-09-23）** `pending_external_write` 与端口 `MutationAttemptRecord` 的两个家已按 D14 合并为一个（表 `mutation_attempt`，词表 `WriteState`）。L1 的四个取值作为证据与映射留在本计划。
5. **（新增，2026-09-23 评审修复轮）L5 重写 003 后必须重新落地本轮的账本判据**：L5 已把 `sync_observation` 主键改成含 `dedupe_key` 并加 `UNIQUE(binding_id, dedupe_key)`，级联时以 L5 的 003 为准；因此本轮两条 DDL 判据（**账本不引用 `project_item_membership`**、**`committed_observation` 主体含 `binding_id`**）与逐表 D8 token 断言必须在 L5 的文件上重新落地，否则会被 L5 的重写覆盖掉。收口条件：L5 的 003 与集成用例里同时出现这两条判据（或本层提交在级联中按 L5 的键形状重放）。 **Superseded by 本层 Batch C（2026-09-24）**：已收口——本层自己把 003 重写成端口主体（连接级），`committed_observation` 的主体含 `object_kind`，不再需要等 L5 重写。
6. **端口侧仍与 DDL 的定序判据不一致**（本轮只改了 DDL 与注释）：内存替身用 `localeCompare`（ICU 三级比较），而视图用 SQLite 的 BINARY 码元比较，大小写差异上两者结论相反；`packages/providers/fake/src/storage.ts` 不在本层授权文件内。收口条件：实现侧改用码元比较（`left < right`），并把该文件纳入某一层的授权范围。 **Superseded by 本层 Batch C（2026-09-24）**：已收口——比较器收敛到 `packages/capabilities` 导出的 `compareSourceVersion`（码点序），两个实现都用它，视图的 BINARY 与它等价。

## Bottom Change Note

- 2026-09-23：建立 L3 独立 ExecPlan，承载控制计划 Batch L3 的设计、实现、验证和恢复记录。
- 2026-09-23：复验修复轮。按独立对抗验证的 6 条 P1 与可执行 P2 订正：relation/candidate 与端口一致、去重持久化、断言判别力、D8 token 白名单、revision 归属、Outcomes 与遗留问题（含两张无端口表的例外判据与"同一事实两个家"的合并条件）。
- 2026-09-23：按第一性原理 + Qian 系统视角重判三个判断点并落地：D13（关系按状态路由、provenance 并入 source、候选不得降级确认）、D14（写尝试词表合并到 WriteState，`pending_external_write` → `mutation_attempt`，唯一例外只剩 webhook_subscription）、D15（`committed_observation` 视图让 R4 的乱序不覆盖成为构造性事实）。原文按 PLANS.md §4 就地标注。
- 2026-09-23：L4 复验发现两条现存缺陷并处理：① 定序谓词按字典序比较，平台若返回不定长编号（`v9`/`v10`）会误判——已在端口契约与视图注释里写明"必须可直接按字典序比较（实测为 ISO-8601 UTC）"并加 ISO 版本的判别性用例；② 嵌套事务静默吞写——登记为遗留 0，要求与 L4 同批修。 **Superseded by 本层 Batch C（2026-09-24）**：载体校验已改为**非空 ASCII 可打印**，不是定宽 ISO-8601——development 域合法地用提交 sha 当 `sourceVersion`，ISO-8601 会拒绝它；sha 不可定序是 provider 侧的缺口，登记在 `packages/capabilities/src/observation.ts` 的定序约定注释里。
- 2026-09-23：PR157/PR170 评审修复轮（只改 003、本层集成用例与本计划）。按根因订正四处：① 去掉 `sync_observation` 指向 `project_item_membership` 的外键（账本只追加 vs 换条目必须先删行，二者在旧 DDL 下不可兼得；判据写进注释与用例）；② `committed_observation` 主体改为**绑定 + 条目**、末级 tie-break 写死为 `rowid`（最后追加），与端口主体一致（**订正 2026-09-24**：主体现为端口 subject `(binding_id, object_kind, object_external_id)`，连接级，见本层 Batch C 的 003 注释）；③ `mutation_attempt` 取 DDL 侧模型：未决同键阻塞、**已决行允许被同键新写入取代**，语义与"读者取最后一次尝试"写进注释并用例覆盖；④ D8 改成逐表期望 token 断言（对调两张表的 R5/R6 必红），出处引用从失效的 `AGENTS.md §9` 改指 `docs/architecture/release-gates.md` R1 第 10 项并把该引用纳入 token 白名单。同时订正注入实验 ⑤ 的过度声称（该判别性用例不存在）与计划里已漂移的 base 引用。**订正 2026-09-24**：写死的 `ad76def` / `7138a5d` 都是观察时刻快照，现已一律改为 `BASE=$(gh pr view 157 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)` 回读。
- 2026-09-26：第五轮 MMP 评审无 P0 / P1，评审者就地修复后归档：恢复被本层静默撤回的两条 L2 守卫；补不变量 5 的 `source` 词表与定序主体三维的判别用例、比较器的大小写与前缀两格；R8「调用方先读当前行」改成如实的「当前没有强制点」（#204）；上层事实改成义务措辞；ADR-0002 恢复原文、只划掉同步观察。未钉住的 DDL 变异与同版本 tie-break 统一见 #201，ISO 载体见 #203。
