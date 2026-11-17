# Storage 逻辑单基线（#595）ExecPlan

> 状态：Active（2026-11-17 实现中；全部验收后移入 `docs/exec-plan/completed/`，文件名不变）
> 创建：2026-11-17
> 范围：空库初始化只记录一个 baseline 版本，且运行时、插件构建、packed artifact 检查共用唯一 SQL inventory；不合并/删除 SQL 文件（物理单资产归 #596）。
> 上游输入：issue #595（验收与 replan-20261116 预测）、issue #417（父项，CodeBudget0）、issue #596（物理叶子）、issue #304（阻断与证据）、`docs/architecture/release-gates.md` §2 第 2 条、`docs/exec-plan/completed/2026-10-28-storage-baseline-admission.md`、`docs/adr/ADR-0016-start-work-owner-generation.md`。

## Purpose / Big Picture

完成后，一个全新数据库由唯一初始化器在**一个事务**内建立完整当前 schema，并在 `schema_migrations` 中只记录**一行**基线版本；同一个库再次打开时不做任何初始化写。SQL 输入资产的唯一权威清单只存在于 `packages/storage/sqlite/src/migrations.ts`，运行时初始化、`apps/harness-plugin/scripts/build.mjs` 的安装件收集、packed artifact 检查与真实 Host 启动都从它派生。旧/未知数据库（包括 #595 之前 main 接受的「完整 shape + 7 行账本」库）仍以既有结构化错误原样拒绝、零写入，并保留备份/用户决定重建的恢复路径。

判断成功的最小证据：

1. 空库首开：`migrate()` 返回 `{ applied: [BASELINE_VERSION], version: BASELINE_VERSION }`，`schema_migrations` 恰好一行且值等于 `BASELINE_VERSION`，`PRAGMA user_version = 6`。
2. 二次打开：`{ applied: [], version: BASELINE_VERSION }`，schema、账本、数据库文件字节不变。
3. 旧 main 完整库（完整当前 shape + 7 行账本 + `user_version=6`）：两个入口（`migrate` 与 `createSqliteStorage`）均以 `incompatible_database`/`version_list` 拒绝，拒绝前后快照与文件 SHA-256 不变。
4. 生产代码中只有 `packages/storage/sqlite/src/migrations.ts` 持有 `.sql` 文件名；`build.mjs` 与 `host.ts` 的 `.sql` 字面量为零，packed artifact 的清单/字节/缺失负控全部从同一 inventory 派生。

## Context and Orientation

**术语。** *baseline version*：当前唯一逻辑基线的账本标记，不是迁移步号序列。*账本*：`schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`。*schema generation*：`packages/storage/sqlite/src/migrate.ts` 的 `CURRENT_SCHEMA_GENERATION`，表示被接受的完整物理/逻辑 schema 世代，经 `PRAGMA user_version` 持久化。*inventory*：`MIGRATIONS` 有序输入资产清单。*admission*：`migrate()` 内的完整结构/账本/世代准入。*packed artifact*：`build.mjs` 产出的 `package/`（`lib/index.js` + `migrations/*.sql` 等）。

**当前状态（main `ddb94c9440815626a3932dcaf050653f70eedb18`，2026-11-17 实测）。**

- 初始化已经满足「单事务 / 单 initializer / 重开零初始化写」：`migrate.ts:93-105` 用 `BEGIN IMMEDIATE` 包住空库建库与准入，`storage.ts:222-233` 的 `createSqliteStorage` 是唯一生产 opener，非空库只做 `assertCurrent` 不写行。
- 尚未满足本任务两件事：空库逐条写 7 行账本（`migrate.ts:99-102`，`assertCurrent` 逐项比对 7 个版本）；SQL 文件名清单存在 4 份硬编码 + 1 处哨兵：`packages/storage/sqlite/src/migrations.ts:17-25`（权威）、`apps/harness-plugin/scripts/build.mjs:74-78`、`apps/harness-plugin/src/host.ts:18-22` 的 `001_init.sql` 哨兵、`tests/integration/harness-plugin-migrations.test.js:18-21`、`tests/integration/harness-plugin-demo-artifact.test.js:16-19`。
- 当前 SQL 资产 7 份、合计 363 行；`005_source_version_carrier.sql` 为纯注释占位。`MIGRATIONS` 形状为 `readonly { version: number; file: string }[]`，版本 1–7 严格递增；`migrate()` 的 `entries` 选项是仅测试可用的第二清单入口，并带「必须使用完整当前清单」守卫。
- `CURRENT_SCHEMA_GENERATION = 6`（#190 已合并）；`#643`/`#645` 已合并，与本叶无文件交集。`#596` 被 `#595` 阻塞；`#595` 的原生 `blockedBy` 当前为 `{304, 416, 415, 190}`、`blocking` 为 `{596}`；用户 2026-11-17 已批准**仅移除 `#595 ← #304` 这一条**，`#304` 保持 OPEN（证据与批准记录见 Decision Log D1）。
- 分支/worktree：`refactor/storage-logical-baseline`，检出在 `.worktrees/storage-logical-baseline`，base = 上述 main，依赖已安装。验证命令均在该工作树根目录运行。
- 本叶的验收原文（issue #595）：(1) 最终 identity/claim schema 就绪后，空库一事务建全 schema 并记录单一 baseline version，重开零初始化写；(2) 一个 runtime initializer + 一份权威 SQL asset inventory，且被 plugin build 与 artifact checks 消费，物理 fragment 可暂留为输入资产；(3) 精确 generation/schema/ledger 准入保持 fail closed，旧/未知布局原样拒绝并保留备份/重建路线，保留原子初始化、失败/提交回滚与 content/integrity/FK 检查；(4) 删除被取代的逐步 data hook/version loop，保留两个 adapter 契约、真实 packed Host 重开与 missing/extra/schema-drift 负控。

## Design / Spec

### 选定方案

以 `packages/storage/sqlite/src/migrations.ts` 作为唯一 owner 定义「当前基线是什么」：`MIGRATIONS: readonly string[]`（保留导出名，元素为按依赖顺序排列的输入资产文件名）+ 新增 `BASELINE_VERSION = 1`；`migrate()` 保留唯一事务与唯一准入，把逐条版本记账改为单行基线记账，把「逐项等于 7 个版本」改为「恰好一行且等于 `BASELINE_VERSION`」；`build.mjs`、`host.ts`、packed/artifact 测试只消费该 inventory，不再持有副本。SQL 文件与字节零改动，物理合并/删除归 #596。

### 三路设计对照与取舍

- **设计 1（系统/状态所有权）**：正确识别「main 已有单事务/单 initializer/重开零写，真实增量只剩账本 + inventory」，并给出单 PR、单 owner、文件级批次。不足：`host.ts` 只把 `001_init.sql` 哨兵换成 `MIGRATIONS[0]`，仍保留第二套目录判定；build 导入路线未实测证据。本计划采纳其账本/所有权/批次骨架，补强 host 删除与 build 实测证据。
- **设计 2（安全/失败路径）**：正确保留完整 fail-closed 矩阵与四相故障注入。但保留 `{version,file}` 会让「版本」在单基线后成为无消费者的死数据；新增「目录 `*.sql` 必须等于清单」的扫描检查既与 `migrations.ts` 既有注释（刻意不扫描目录，避免删/改名静默失效）冲突，又引入新失败面而无验收要求。两处均不采纳。
- **设计 3（产品/交付）**：正确给出「删除 `host.ts` 的 `migrationsDir()`、让 `MIGRATIONS_DIR` 按模块位置解析」的方向与「单 PR + 3 批次 + 尺寸下调」的交付形态。其「build 直接 import TS 在 Node 26 可用」已由本计划实测确认。本计划采纳该方向，但用现有 packed Host 用例而非新增探针作为证据，并把 ExecPlan 归档列在收口而不是独立批次。
- **三路共识（采纳）**：`BASELINE_VERSION = 1`；generation 保持 6；不合并 SQL；单 PR；`build.mjs`/artifact 测试消费同一 inventory。
- **三路分歧（已裁决）**：`MIGRATIONS` 形状改为 `string[]` 并删除 `Migration` 接口（D4）；不做目录扫描等式（D5）；删除而非改写 `host.ts` 哨兵（D6）；packed/artifact 测试在 #595 内适配（D10）。
- **事实核对**：三路对 main 现状（单事务初始化、单 initializer、重开零写、generation=6、SQL 363 行）的判断一致，经本计划复核均成立；没有推翻 main 事实的硬错误。偏差集中在三处：设计 2 保留 `{version,file}`（单基线后是死数据）并新增目录扫描（过度）；设计 1 的 `host.ts` 只换哨兵字面量（收敛不足）；设计 3 的「删哨兵后改传 `MIGRATIONS_DIR`」与「让 storage 默认解析」等价但未区分（本计划取后者，D6）。

### 状态所有权

| 组件 | 拥有 | 不拥有 |
|---|---|---|
| `packages/storage/sqlite/src/migrations.ts` | 基线是什么：`BASELINE_VERSION`、有序资产清单、读取函数、清单自检 | 能否打开某个库、事务、世代 |
| `packages/storage/sqlite/src/migrate.ts` | 库能否被打开：参考结构、单事务初始化、账本/形状/世代准入、marker、回滚 | 资产清单内容 |
| `apps/harness-plugin/scripts/build.mjs` | 产物收集：只消费 inventory，把源字节写入安装件 | 任何 SQL 文件名清单或迁移目录决策 |
| `apps/harness-plugin/src/host.ts` | Host 组合 | migrations 目录（由 storage 模块的 `MIGRATIONS_DIR` 按模块位置解析） |
| `tests/integration/harness-plugin-{migrations,demo-artifact}.test.js` | packed/artifact 的清单、字节与负控，全部从 inventory 派生 | 第二份文件清单 |
| `apps/harness-plugin/src/host-composition.ts`、`packages/storage/sqlite/src/storage.ts` | 透传可选 `migrationsDir`（测试/打包注入点保留） | 清单 |

### 接口

```ts
// packages/storage/sqlite/src/migrations.ts
export const BASELINE_VERSION = 1                    // 新增
export const MIGRATIONS: readonly string[]           // 形状变化，导出名保留；顺序 = 依赖顺序
export const MIGRATIONS_DIR: string
export function migrationPath(file: string, dir?: string): string
export function readMigrationSql(file: string, dir?: string): string
export function assertManifestIntegrity(files?: readonly string[], dir?: string): void
// packages/storage/sqlite/src/migrate.ts
export interface MigrateOptions { readonly dir?: string }   // entries 删除
export interface MigrateResult { applied: number[]; version: number } // 首建 [1]/1，重开 []/1
export const CURRENT_SCHEMA_GENERATION = 6
export function migrate(db: WorkspaceDatabase, options?: MigrateOptions): MigrateResult
// apps/harness-plugin/scripts/build.mjs
import { MIGRATIONS, readMigrationSql } from '@harness-projects/storage-sqlite' // 唯一清单来源
```

`assertManifestIntegrity` 只保留单基线仍有意义的检查：非空、元素非空字符串、无重复文件名、每个文件存在。版本正整数/严格递增检查随逐条版本模型一起删除（D4）。

### 不变量

- **I1 空库原子初始化**：`BEGIN IMMEDIATE` 内按顺序执行全部资产、写入恰好一行 `(BASELINE_VERSION, ISO 时间)`、把 `user_version` 从 0 盖成 `CURRENT_SCHEMA_GENERATION`、`assertCurrent` 通过后 `COMMIT`；任一阶段失败 `ROLLBACK` 并原样上抛原错，可重试。
- **I2 重开零写**：非空库只做准入；成功时 `applied=[]`、`version=BASELINE_VERSION`，schema/账本/`user_version`/文件字节均不变。
- **I3 准入顺序与 reason 不变**：`generation`（0 或当前世代）→ `unknown_objects` → 账本自身 `schema_shape` → `version_list` → 全量 `schema_shape`；账本用 `CAST(version AS TEXT)` 比较以保留 int64 边界拒绝；错误类、`action='back_up_and_rebuild'`、恢复文案与 demo-install 链接不变。
- **I4 旧布局仍拒绝**：#595 前 main 接受过的「完整当前 shape + 7 行账本 1–7 + `user_version=6`」必须以 `version_list` 拒绝且零写入（新增判别性反控）；旧 generation、残缺账本、shape 漂移的反控全部保留。单行值 1 与旧迁移步号 1 的语义重叠不会让旧库被误认：旧库是 7 行，部分建库的库在 `version_list` 通过后由 `schema_shape` 拒绝。
- **I5 唯一 inventory**：生产代码中只有 `migrations.ts` 持有 `.sql` 文件名；`build.mjs`/`host.ts` 零 `.sql` 字面量；packed 归档清单与逐文件字节、缺失负控均由 inventory 派生；packed 字节 = 源字节。
- **I6 SQL 零改动**：`git diff main...HEAD -- packages/storage/sqlite/migrations` 为空；不合并/删除资产、不改文件名、不改文件内容。
- **I7 边界零改动**：Host ABI、身份/权限/事务/ack/reconcile/恢复不变量、`schema_migrations` 表结构、两个 Storage adapter 契约均不变；不新增依赖或抽象。
- **I8 现有校验不抽空**：`harness-plugin-artifact.test.js` 的 peer/patch/包边界断言、demo 的部署字节审计、migrations 的源码树路径反例保持；只把「SQL 清单」类预期改为从 inventory 派生。
- **I9 CI/平台零改动**：不碰 `.github/workflows/`、`scripts/workflow-check.mjs`、Windows 准入接线；唯一必需检查仍是 `PR Fast Gate`。

### 失败语义与兼容

任何准入失败都在事务内 `ROLLBACK`，不写用户数据、不盖 marker、不改文件；旧/未知库维持「备份 + 用户决定重建」路线，无自动迁移、无兼容层、无旧版修复 SQL。整 PR revert 后，本 PR 建立的单行账本库会被旧代码以 `version_list` 拒绝并从备份重建——因为当前无正式发布，这是可接受且被文档化的恢复方式。

### 风险与缓解

- **R1 旧布局被误接受**：新增「完整 shape + 7 行账本 + 当前世代 → `version_list` 且文件 hash 不变」判别性反控；原有 prefix/gap/int64/shape 反控保留。
- **R2 inventory 成为单点错误**：清单错误会同时影响 runtime 与 build/测试；由运行时 schema 断言（`identity-membership-schema`、`execution-relation-write-schema` 的表全集/列约束、`storage-contract`）覆盖每个片段的实际效果，packed 字节比对覆盖资产内容；不另造第二清单去「交叉验证」（那正是本叶要删除的第二权威）。
- **R3 host 目录解析回退**：删除 `migrationsDir()` 后由真实 packed Host 用例兜底（临时 `node_modules` 按包名 import）；解析错误以「迁移文件缺失」fail closed。
- **R4 写入面冲突**（#644 win32 skip 行、#596 的 SQL 资产与派生值）：Global Constraints 声明唯一文件集合；文件集合内的 3 个 artifact/packed 测试在 #595 只改账本与清单派生行，#644/#596 不并发写同 hunk；回滚必须逆序。
- **R5 build 脚本 import TS**：依赖 Node type stripping（`.nvmrc` = 26）；2026-11-17 已实测从 `apps/harness-plugin/scripts` 解析 `@harness-projects/storage-sqlite` 成功（D7）；测试与 CI 均用同一 Node 来源。

### 规模与简化点

| 项 | 估算 add+del |
|---|---:|
| `migrations.ts` | 30–40 |
| `migrate.ts` | 20–30 |
| `build.mjs` | 10–15 |
| `host.ts` | ~11 |
| 测试 10 件（含新判别性反控与 fixture 重写） | 160–240 |
| 静态 inventory 守卫 | ~8 |
| **合计代码** | **300–450（中心约 350）** |
| ExecPlan 与两处文档索引/注记 | 250–280 |

预计代码（`docs/` 外）增删合计约 **300–450 行**（中心约 350），文档约 **250–280 行**，均远低于本批 800/1300 与仓库 1000/1500 硬上限。可删/简化：`Migration` 接口与版本单调校验、`MigrateOptions.entries` 与「完整当前清单」守卫及其绕过用例、`build.mjs` 的 `MIGRATION_FILES`/`MIGRATIONS_DIR` 副本、`host.ts` 的 `migrationsDir()` 与 3 个仅它使用的 import、5 处测试文件名清单、fixture 的逐条账本循环（约 −80 行）。不压缩 SQL、不删有判别力的负控、不把搬移行当免费。500–800 的原始预测下调理由见 Decision Log D9。

## Global Constraints

- 当前无正式发布：**不做**旧数据/旧设计兼容、迁移、修复或双写；不得为旧库提供自动升级。
- 本 PR 只做逻辑单基线 + inventory 收敛：**不改**任何 `.sql` 文件/文件名/字节，不合并 SQL（#596），不改 `CURRENT_SCHEMA_GENERATION`（保持 6），不改 `schema_migrations` 表结构，不改 Host ABI/身份/权限/事务/ack/恢复语义。
- TDD：每个行为变化先写判别性失败测试；删除类改动先证明其验证已由其他证据拥有。不为覆盖率铺测试，不写实现镜像（除 D8 的一条 inventory 形状静态守卫）。
- 拒绝过度设计：不新增文件（除 ExecPlan）、不新增依赖、不新增抽象层、不扩大 workflow/CI 面；先删 dead code 再谈预算。
- 文档正文中文，标识符/路径/命令英文；不写本机绝对路径，证据写明检出（分支/工作树）与观察日期；公开面正文英文（issue/PR/commit 正文），commit 标题沿用仓库 `<type>(<scope>): <摘要>` 格式。
- 一个 shared architecture unit 一个 owner；本计划声明的文件集合之外不动，尤其不碰 `#644` 的 win32 skip 行与 `#596` 的 SQL 资产。

### 文件集合（本计划唯一声明处）

生产代码 4：

- `packages/storage/sqlite/src/migrations.ts`
- `packages/storage/sqlite/src/migrate.ts`
- `apps/harness-plugin/scripts/build.mjs`
- `apps/harness-plugin/src/host.ts`

测试 10：

- `tests/integration/migration-runner.test.js`
- `tests/integration/storage-baseline-admission.test.js`
- `tests/integration/storage-restart.test.js`
- `tests/integration/identity-membership-schema.test.js`
- `tests/integration/execution-relation-write-schema.test.js`
- `tests/integration/storage-connector-account.test.js`
- `tests/integration/harness-plugin-host-providers.test.js`
- `tests/integration/harness-plugin-migrations.test.js`
- `tests/integration/harness-plugin-artifact.test.js`
- `tests/integration/harness-plugin-demo-artifact.test.js`

文档 3：

- `docs/exec-plan/active/2026-11-17-storage-logical-baseline.md`（本计划；验收后移入 `docs/exec-plan/completed/`）
- `docs/README.md`（Active 行；验收后改 Completed 行）
- `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`（仅第 56 行就地 `Superseded by` 注记）

## Plan of Work

### Batch 1 · 运行时单基线契约

**最小闭环**：空库只记 1 个 baseline version，重开零写；旧 7 行账本库仍结构化拒绝。SQL 文件不动。

**涉及文件**：`packages/storage/sqlite/src/{migrations,migrate}.ts` + 测试 9 件：`migration-runner`、`storage-baseline-admission`、`storage-restart`、`identity-membership-schema`、`execution-relation-write-schema`、`storage-connector-account`、`harness-plugin-host-providers`、`harness-plugin-migrations`、`harness-plugin-artifact`（后两件只改账本断言/标题）。

**TDD（先 RED）**

1. 先只加 `BASELINE_VERSION` 导出（行为不变），再写下列测试确认 RED（引用新常量或新行为失败）：
   - 空库：`applied=[BASELINE_VERSION]`、`schema_migrations` 恰一行、`version=BASELINE_VERSION`、`user_version=6`（当前 RED：7 行）；
   - 重开：`{applied:[], version:BASELINE_VERSION}` 且 schema/账本/文件字节不变（当前 RED：version=7）；
   - 双 Worker 屏障：`[[], [BASELINE_VERSION]]`、账本单行、`integrity_check=ok`、`foreign_key_check` 空（当前 RED）；
   - 旧 main 完整库（`fixture` 全量 shape + 手写 7 行账本 + `user_version=6`）：两入口 `version_list`、快照与文件 SHA-256 不变（当前会接受 → RED，这是本叶最关键的新反控）；
   - 单行错值/两行/空账本/int64 max/min → `version_list` 且零写入（部分为现有控制的语义重写）；
   - 清单自检：空清单、重复文件名、缺失文件显式失败（空清单当前静默 → RED）；
   - 四相故障注入（late-ddl/ledger/marker/commit）全回滚可重试，`ledger` 相位命中唯一基线 INSERT（当前按 `version===7` 注入 → RED）。
2. 删除只测试可用的 `MigrateOptions.entries` 与「完整当前清单」守卫及对应用例；删除版本单调/正整数的清单自检分支。
3. 实现：`MIGRATIONS` 改 `readonly string[]`、`Migration` 接口删除、`migrate` 单行记账与单行版本断言、`applied/version` 返回基线值；`BASELINE_VERSION` 由 `migrations.ts` 拥有。
4. 适配 fixture：`fixture(db, count, transform)` 改为按 `MIGRATIONS.slice(0,count)` 执行后一次性 `INSERT` 基线行；`storage-baseline-admission` 的 prefix/gap/future 用例重写为「旧 N 行账本」族；`unicodeSpaces` 的重复探针改用 `BASELINE_VERSION`；ASCII 空白/引号正例期望 `{applied:[], version:BASELINE_VERSION}`。

**变更点（实现提要）**：`migrate.ts` 删除 `entries` 选项与守卫、`assertManifestIntegrity(MIGRATIONS, dir)`、`sql = MIGRATIONS.map((file) => readMigrationSql(file, dir))`、空库循环只 `exec` 资产、循环后 `INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)` 一次、`assertCurrent` 的版本检查改「长度 1 且 `CAST(version AS TEXT) === String(BASELINE_VERSION)`」、返回基线值；`migrations.ts` 重写清单与自检，保留「刻意不扫描目录」注释并说明 baseline 是账本标记而非步号。

**验证**：在 `.worktrees/storage-logical-baseline` 根目录运行

```
pnpm typecheck
pnpm test:file tests/integration/migration-runner.test.js tests/integration/storage-baseline-admission.test.js \
  tests/integration/storage-restart.test.js tests/integration/identity-membership-schema.test.js \
  tests/integration/execution-relation-write-schema.test.js tests/integration/storage-connector-account.test.js \
  tests/integration/harness-plugin-host-providers.test.js tests/integration/harness-plugin-migrations.test.js \
  tests/integration/harness-plugin-artifact.test.js
```

期望：`pnpm typecheck` 静默、退出码 0；测试退出码 0、`ℹ fail 0`。基线参考（2026-11-17 在 `.worktrees/storage-logical-baseline`@`ddb94c94` 实测）：上述 9 件合计 264 pass/0 fail，`pnpm typecheck` 通过，`pnpm boundaries` 9/9 pass。

**回滚**：`git revert <Batch 1 commit>`；本批只影响临时库与测试，恢复 7 行账本语义；本批建立的实验库按备份/重建路线处理。

**实际记录（2026-11-17，检出 `.worktrees/storage-logical-baseline`）**

- RED：先只加 `BASELINE_VERSION` 导出，改写后的 `migration-runner` 与 `storage-baseline-admission` 随即变红（空库仍写 7 行、清单自检静默放过空清单、旧 7 行账本被接受）；实现后转绿。
- GREEN：三组窄命令分别 180、58、30 pass，9 件合计 **268 pass / 0 fail**（基线 264；新增判别用例并删除 `entries` 绕过用例后的净值）。
- `pnpm typecheck` 退出码 0；`pnpm run boundaries` 9/9 pass；`git diff main...HEAD -- packages/storage/sqlite/migrations` 为空。
- 判别证据：`legacy-ledger-7`（完整当前 shape + 1..7 行账本 + 当前世代）经 `migrate` 与 `createSqliteStorage` 两入口均以 `version_list` 拒绝，内存快照与文件 SHA-256 不变；`CURRENT_SCHEMA_GENERATION` 仍为 6。
- 提交：`c18a912f refactor(storage): 空库只记录单一基线版本`。

### Batch 2 · 唯一 SQL inventory

**最小闭环**：`build.mjs`、`host.ts`、packed/artifact 测试全部消费 `MIGRATIONS`，生产消费方不再持有第二份 SQL 清单；packed 资产字节仍等于源字节。

**涉及文件**：`apps/harness-plugin/{scripts/build.mjs,src/host.ts}` + 测试 2 件：`harness-plugin-migrations`、`harness-plugin-demo-artifact`（`harness-plugin-artifact`、`harness-plugin-host-providers` 本批只回归，不新增改动）。

**TDD（先 RED）**

1. 在 `harness-plugin-migrations.test.js` 加静态形状守卫：读 `apps/harness-plugin/scripts/build.mjs` 与 `apps/harness-plugin/src/host.ts`，断言不含 `['"][0-9A-Za-z_]+\.sql['"]` 字面量（当前 RED：两文件各有清单/哨兵）。
2. 把 `harness-plugin-migrations` 的 readdir 期望、`harness-plugin-demo-artifact` 的 `migrations`/`expected`/字节比对/缺失负控/重打包过滤改为从 `MIGRATIONS` 派生（`victim = MIGRATIONS.at(-1)`，并在测试内断言非空）。
3. 实现：`build.mjs` 从 `@harness-projects/storage-sqlite` 导入 `MIGRATIONS`/`readMigrationSql`，删除 `MIGRATIONS_DIR` 与 `MIGRATION_FILES`，manifest `files` 与拷贝循环改用 inventory + `readMigrationSql`；`host.ts` 删除 `migrationsDir()`、`existsSync`/`path`/`fileURLToPath` import 与 `createHostComposition({... migrationsDir})` 实参，让 storage 的 `MIGRATIONS_DIR` 作为唯一目录权威。
4. 记录 `host.ts` 删除的等价性证据：现有真实 packed Host 用例（安装到临时 `node_modules` 后按包名 `import` `lib/index.js`，见 `harness-plugin-artifact.test.js` 的「宿主半边是 Node 可直接加载的 JS」组）在删除前后都建库成功；若 `MIGRATIONS_DIR` 解析错误，该用例以「迁移文件缺失」红。

**验证**：

```
pnpm typecheck
pnpm test:file tests/integration/harness-plugin-migrations.test.js tests/integration/harness-plugin-demo-artifact.test.js \
  tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-host-providers.test.js
git grep -nE "['\"][0-9A-Za-z_]+\.sql['\"]" -- apps/harness-plugin/src apps/harness-plugin/scripts   # 期望无输出
```

期望：退出码 0、`ℹ fail 0`；`git grep` 无输出（`001_init.sql` 等文件名只允许出现在 `packages/storage/sqlite/src/migrations.ts`）。

**回滚**：`git revert <Batch 2 commit>`；恢复 build/host 的本地清单与哨兵，packed 断言恢复为硬编码清单；packed 测试重跑。

**实际记录（2026-11-17，检出 `.worktrees/storage-logical-baseline`）**

- RED：先加静态守卫用例；`build.mjs` 的 `MIGRATION_FILES` 与 `host.ts` 的 `001_init.sql` 哨兵使该用例红，实现后转绿。
- GREEN：`pnpm test:file harness-plugin-migrations + harness-plugin-demo-artifact + harness-plugin-artifact + harness-plugin-host-providers` → **61 pass / 0 fail**；`pnpm typecheck` 退出码 0。
- `git grep -nE "['\"][0-9A-Za-z_]+\.sql['\"]" -- apps/harness-plugin/src apps/harness-plugin/scripts` 无输出（`.sql` 文件名字面量只剩 `packages/storage/sqlite/src/migrations.ts`）。
- 实测 `build.mjs` 以裸包名导入 `@harness-projects/storage-sqlite`（Node 26.13.1，`.nvmrc`=26），manifest `files`、`migrations/` readdir、逐文件字节与缺失负控全部从 `MIGRATIONS` 派生；packed 字节 = 源字节。
- 删除 `host.ts` 的 `migrationsDir()` 后，真实 packed Host 用例（装进临时 `node_modules`、按包名 import、由 `lib/index.js` 的 `MIGRATIONS_DIR` 解析包内 `migrations/`）仍建库成功且账本为 `[1]`，即 D6 的等价性证据。
- 提交：`9558d4d7 refactor(harness-plugin): 安装件只消费唯一 SQL inventory`。

### Batch 3 · 文档与门禁

**最小闭环**：ExecPlan 落盘、索引与就地订正、全门禁证明；不改变代码行为。

**涉及文件**：本计划（写入 `docs/exec-plan/active/2026-11-17-storage-logical-baseline.md`）、`docs/README.md`、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`（仅第 56 行追加就地 `Superseded by`）。

**步骤**：

1. 写入本计划（含 Decision Log 的 D1 批准记录与 D9 尺寸下调 Rationale）；`docs/README.md` Active 表加一行（验收归档后改为 Completed 行）。
2. 在 prelaunch 计划当前第 56 行（“当前完整 1–7 仍可打开”所在段落）原处追加：**Superseded by `docs/exec-plan/active/2026-11-17-storage-logical-baseline.md`（2026-11-17，#595）**——新库账本为单一基线版本 `[1]`；合并前创建的完整 1–7 库（7 行账本）按 `version_list` 结构化拒绝，备份/用户决定重建通道不变；物理折叠仍归 #596。
3. 跑门禁并记录实际数字。

**验证**：

```
pnpm verify
pnpm boundaries
node scripts/rule-checks.mjs size main
node scripts/rule-checks.mjs disclosure main
git diff --check main...HEAD
git diff --stat main...HEAD -- .github/workflows scripts/workflow-check.mjs
```

期望：`pnpm verify` 退出码 0（typecheck 静默；contract/integration/e2e 三层非空且全绿）；`pnpm boundaries` 9/9 pass；size 退出码 0 且输出中「代码」≤800、「文档」≤1300（本计划预测代码 300–450、文档 250–280）；disclosure 退出码 0；`git diff --check` 退出码 0；`git diff --stat main...HEAD -- .github/workflows scripts/workflow-check.mjs` 无输出（本 PR 不改 CI/workflow）。

**回滚**：`git revert <Batch 3 commit>`；文档回退不影响行为。

**实际记录（2026-11-17，检出 `.worktrees/storage-logical-baseline`）**

- 已在本计划回填 Progress / Surprises / Decision Log / Outcomes / Bottom Change Note，`docs/README.md` 的 Active 索引行保持；prelaunch 计划第 56 行就地追加 `Superseded by` 注记。
- 门禁实测：`pnpm verify` 退出码 0（contract / integration / e2e 三层非空全绿）；`pnpm run boundaries` 9/9 pass；`node scripts/rule-checks.mjs size main` 退出码 0 且代码/文档行数见 Outcomes；`node scripts/rule-checks.mjs disclosure main` 退出码 0；`git diff --check main...HEAD` 退出码 0；`.github/workflows` 与 `scripts/workflow-check.mjs` 零 diff。

### 交付（非批次）

1. 本地整理为 3 个可独立审阅的提交（Batch 1 / Batch 2 / Batch 3），无临时提交/调试痕迹；提交标题按仓库格式，正文说明为什么并 `Closes #595` / `Refs #417 #596`。
2. 推送分支后开 **draft** PR（base `main`；正文英文：闭环、ExecPlan + Batch、`Closes #595`、真实验证证据、风险与回滚）。
3. 执行已批准的 #595←#304 单边移除（精确目标：仅 `blockedBy: #304`；`#304` 保持 OPEN，`blocking: #596` 与其余边、`Status` 不变），并用下列只读查询回读（期望 `blockedBy` 不含 304，其余节点按操作前快照不变）：
   `gh api graphql -f query='query{repository(owner:"SingularityKChen",name:"harness-projects"){issue(number:595){number blockedBy(first:20){nodes{number}} blocking(first:20){nodes{number}}}}}'`
4. 最终 push 后回读 `gh pr view <n> -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,isDraft,closingIssuesReferences,mergeable`、`gh pr checks <n> -R SingularityKChen/harness-projects`（期望 Verify / Browser / PR Fast Gate 全 pass，`PR Fast Gate` 是唯一必需检查）、以及 issue 双向关联与 review threads；全部满足后 `gh pr ready <n>`。不合并、不发版、不写规划 `Status`。

## Validation and Acceptance

| issue #595 验收 | 判定证据 |
|---|---|
| 空库一事务建全 schema、单一 baseline version、重开零初始化写 | Batch 1 的 `migration-runner` 空库/幂等/双 Worker 用例 + `storage-restart` 重开用例；`schema_migrations` 单行断言 |
| 一个 runtime initializer + 一份权威 inventory，被 build 与 artifact checks 消费；无并行 legacy initializer/第二 authority | Batch 2 静态守卫 + packed readdir/字节/缺失负控派生 + `git grep` 无 `.sql` 字面量；`migrate` 是唯一 initializer（`storage.ts` 唯一生产 opener 不变） |
| 精确 generation/schema/ledger 准入 fail closed；旧布局拒绝、零写入、备份/重建路线 | `storage-baseline-admission` 现有 30+ 反控 + 新增「旧 main 完整库 7 行账本 → version_list 且 hash 不变」 |
| 删除逐步 data hook/version loop；保留 adapter 契约、真实 packed Host 重开与 missing/extra/schema-drift 负控 | `MigrateOptions.entries` 及守卫/用例删除；`tests/contract/storage-contract.test.js`（Fake+SQLite）在 `pnpm verify` 全绿；packed Host 真实重开用例保留并通过；demo/artifact 缺失与篡改负控保留 |

额外的完成判据：`CURRENT_SCHEMA_GENERATION` 仍为 6 且 `IncompatibleDatabaseError` 字段/文案不变；SQL 目录零 diff；workflow 零 diff；尺寸在 800/1300 内；PR 仅 Draft→Ready，人类评审决定合并。

## Progress

- [x] 2026-11-17：Batch 1 运行时单基线（RED→GREEN；9 个测试文件 268 pass/0 fail；`pnpm typecheck`、`boundaries` 通过）— `c18a912f`
- [x] 2026-11-17：Batch 2 唯一 SQL inventory（build.mjs/host.ts + 4 个 packed/artifact 测试 61 pass/0 fail；静态守卫与 `git grep` 无 `.sql` 字面量）— `9558d4d7`
- [x] 2026-11-17：Batch 3 文档与门禁（ExecPlan 回填、README 索引保持、prelaunch 就地订正、`pnpm verify`/size/disclosure/diff 全绿）
- [x] 2026-11-17：交付（3 个可独立审阅的提交、draft PR #658、最终 head/base/checks 回读；#595←#304 单边移除与 `gh pr ready` 不在本实现 owner 的写入范围，由交付负责人/人类伙伴执行）
- [x] 2026-11-17：PR #658 body 写入真实验证命令、计数、风险/回滚与 #596 交接（只改 SQL 资产与派生常量/路径）；评审与合并由人类伙伴决定

## Surprises & Discoveries

1. **main 已具备本任务大半机制。** `migrate.ts:93-105` 已是 `BEGIN IMMEDIATE` 单事务初始化，`storage.ts:222-233` 是唯一 opener，非空库只准入不写行。因此 issue 的 550–800 预测高估了本叶；实际增量只剩账本语义与 inventory 收敛（见 D9）。
2. **每次 `CURRENT_SCHEMA_GENERATION` bump 都伴随 SQL 改动（main 历史）。** `git log -p --format='COMMIT %h %s' -- packages/storage/sqlite/src/migrate.ts` 显示 1→2（`cfbdca6b`，003 +1）、2→3（`bc3d7f2c`，003 +2）、3→4（`9ab95c49`，002 +2）、4→5（`3b86d30f`，003/005 变更）、5→6（`ddb94c94`，002 +21）；ADR-0016 也把「在 003 增加列与 CHECK」与「不兼容世代 1→2」绑定。本叶 SQL 字节零改动，故世代保持 6（D2）。
3. **委托单版本 `[1]` 早已被记录为 #417 的目标。** `docs/exec-plan/completed/2026-10-28-storage-baseline-admission.md` 明确写「新空库返回完整实际版本清单，**不提前实现 #417 的单版本 `[1]`**」；issue #595 验收也写「single baseline version[1]」。故 `BASELINE_VERSION = 1` 不是新发明（D3）。
4. **`host.ts` 的 `migrationsDir()` 是冗余路径判定。** `MIGRATIONS_DIR` 由 `new URL('../migrations/', import.meta.url)` 解析：源码检出指向 `packages/storage/sqlite/migrations`，packed 后 `lib/index.js` 指向 `<package>/migrations`（`build.mjs` 复制目的地）。现有真实 packed Host 用例（安装到临时 `node_modules` 后按包名 import）证明两布局都能建库；哨兵可整体删除（D6）。
5. **`harness-plugin-artifact.test.js` 头部声明「预期值不 import 构建脚本常量，否则构建与测试会一起错」。** 本次按 issue 验收 2 的要求，对「SQL 清单」这一类预期改由唯一 inventory 派生（构建也消费它）；其余 peer/patch/导出预期仍是独立字面量。该例外的残余风险由运行时 schema 断言（`identity-membership-schema`、`execution-relation-write-schema` 的表全集与列约束）兜底（见 R2）。
6. **基线 admission 测试把「前缀版本」当作旧库模型**（`prefix1/prefix2/prefix4`）。单基线后这些用例不再能表达旧布局，必须重写为「旧 N 行账本」族；否则会保留一个与实现无关的旧概念。
7. **旧 1 行账本与新单基线账本无法从账本区分。** 实测 `legacy-ledger-1`（旧 main 只应用首步：账本 `[1]`、形状不完整）通过 `version_list` 检查，最终由 `schema_shape` 拒绝；只有 ≥2 行的旧账本才以 `version_list` 拒绝。这印证 I4 的预测，也说明判别性反控必须用「完整 shape + 7 行账本」，而不是任意旧前缀。
8. **D12 的「非空清单」在实现中扩成三条显式检查。** 除空清单外，空字符串文件名也会让 `join(dir, '')` 命中目录、`existsSync` 通过；`assertManifestIntegrity` 因此额外拒绝空字符串元素（D12 的实现细节，不新增抽象）。
9. **`build.mjs` 裸包名导入会连带加载 storage 包 index。** 该 index 含 `storage.ts` 与 `node:sqlite`；实测 Node 26.13.1 从 `apps/harness-plugin` 解析并调用 `readMigrationSql` 成功，构建不需要额外 flag 或 loader（复核 D7）。
10. **9 件 Batch 1 测试总数从 264 变为 268。** 新增「旧 7 行账本」「单行错值/空账本/多余行」「清单空/空元素」等判别用例，同时删除 `entries` 绕过用例与版本单调用例；净 +4。

## Decision Log

- **D1（2026-11-17，用户批准；执行者：交付负责人）**：#595 的 `blocked-by: #304` 单边移除，`#304` 保持 OPEN。Rationale/证据：#304 的 claim/generation schema 已在 main 的 `003_control_facts.sql`（`provisioning_generation`、`external_intent_json`），子 PR #420/#421 已合并；#554 使用既有 `provider_ref_json`/`external_intent_json` 列，无新 DDL；#304/#554 剩余为原始事故只读证据与人类验收。执行动作与回读见「交付（非批次）」第 3 步；只移除这一条，其余边、`Status`、`#304` 状态不变。
- **D2（2026-11-17，本计划裁决）**：`CURRENT_SCHEMA_GENERATION` 保持 6，不升 7。Rationale：SQL 字节零改动，被接受的 schema 形状未变；main 历史 5 次 bump 全部与 DDL 同提交（见 Surprises 2）；升代会把「7 行账本」旧库的拒绝原因从精确的 `version_list` 变成 `generation`，削弱本叶新增反控的判别力；还要求改约 5 处夹具/快照并让 #596 再裁决一次。
- **D3（2026-11-17，本计划裁决）**：`BASELINE_VERSION = 1`，首建 `applied=[1]`、`version=1`。Rationale：issue 验收写「single baseline version[1]」；2026-10-28 completed plan 明确把 `[1]` 记为 #417 目标并当时刻意延后；用 7 会延续旧步号，让 #596 物理合并后再次改账本值。
- **D4（2026-11-17，本计划裁决）**：`MIGRATIONS` 改为 `readonly string[]`，删除 `Migration` 接口与版本单调校验。Rationale：单基线之后没有消费者需要逐条版本；保留 `{version,file}` 会让版本字段成为死数据（与验收 4「删除被取代的 version loop」相反）；`string[]` 更小且让 #596 的 1 资产清单自然成立。`assertManifestIntegrity` 仅保留非空/无重复/文件存在。
- **D5（2026-11-17，本计划裁决）**：不新增「目录 `*.sql` 必须等于清单」扫描检查。Rationale：`migrations.ts` 既有注释明确选择显式清单而非目录扫描（删/改名要变成可见自检失败）；未被清单列出的多余文件不会被 build 复制、不会被 runtime 应用，是惰性的，不构成第二权威；加扫描只增加新失败面与代码，无验收要求。
- **D6（2026-11-17，本计划裁决）**：删除 `host.ts` 的 `migrationsDir()` 函数（含 3 个仅它使用的 import 与调用实参），而不是把哨兵改成 `MIGRATIONS[0]`。Rationale：`MIGRATIONS_DIR` 在源码与 packed 两布局都解析正确（Surprises 4），保留函数等于保留第二套目录判定；删除后若目录判定出错，真实 packed Host 用例会以「迁移文件缺失」红，失败仍 fail closed。
- **D7（2026-11-17，本计划裁决）**：`build.mjs` 用裸包名 `@harness-projects/storage-sqlite` 导入 `MIGRATIONS` 与 `readMigrationSql`。Rationale：`apps/harness-plugin` 已声明该 workspace 依赖，build 脚本已依赖裸包名（`esbuild`）；Node 26（`.nvmrc`）的 type stripping 已在 2026-11-17 实测可从 `apps/harness-plugin/scripts` 解析并加载该 TS 包；避免在脚本里再写一份 `../../../packages/...` 路径算术。不选择 JSON manifest：会新增第二个源文件与解析错误面，收益无证据。
- **D8（2026-11-17，本计划裁决）**：加一条静态形状守卫：`apps/harness-plugin/scripts/build.mjs` 与 `apps/harness-plugin/src/host.ts` 不得出现 `.sql` 文件名子串字面量。Rationale：「唯一 inventory」否则没有机械证据；这是架构边界静态检查（AGENTS §5 允许按其真实责任保留），不是源码快照；测试文件仍可命名具体资产作为负控受害对象。
- **D9（2026-11-17，本计划裁决）**：尺寸目标由 issue 的 500–800 下调为 300–450 代码行（中心约 350），文档 250–280。Rationale：main 已交付单事务/单 initializer/重开零写（Surprises 1），真实增量是账本语义 + inventory 收敛 + 10 个测试文件的适配与判别性反控；为凑 500 行扩面会违反「不做无证据扩面」。仓库 1000/1500 与本批 800/1300 上限不变。
- **D10（2026-11-17，本计划裁决 / lead 交付说明）**：packed/artifact 与 schema 测试的适配归 #595，不留给 #596。Rationale：账本单行与 inventory 是同一能力闭环；若把 `harness-plugin-{migrations,demo-artifact,artifact}.test.js`、`identity-membership-schema`、`execution-relation-write-schema` 的断言留给 #596，#595 自身无法通过验证（先红后绿不可能）。#596 在 #595 合并后只改 SQL 资产、文件名/路径派生值与相应计数；两边不并发写同一批测试。
- **D11（2026-11-17，本计划裁决）**：不新增 ADR。Rationale：本叶不改变长期架构决策（七份 SQL 仍是输入资产），账本/准入契约记录在本 ExecPlan 与代码注释；物理单资产与其最终布局记录在 #596 的计划。
- **D12（2026-11-17，本计划裁决）**：`assertManifestIntegrity` 增加「非空清单」显式失败。Rationale：空清单当前会走到误导性的 `schema_shape`；两行代码把配置错误变成明确错误，且不新增抽象。

- **D13（2026-11-17，实现中裁决）**：单基线 admission 的拒绝用例族按「账本行数/值」重排：`legacy-ledger-{2,4,7}` 与「多余行/空账本/错值/int64 边界」归 `version_list`；`legacy-ledger-1` 归 `schema_shape`。Rationale：旧 main 只应用首步的库账本恰好是 `[1]`，与单基线账本值相同，账本检查无法也不应区分两者——形状由完整 `schema_shape` 准入拒绝，这正是 I4 的预测。把该用例写成 `version_list` 会断言一个实现上不可能的错误原因。
- **D14（2026-11-17，实现中裁决）**：`assertManifestIntegrity` 在 D12 之外显式拒绝空字符串文件名。Rationale：`join(dir, '')` 得到目录本身，`existsSync` 会通过；不显式拒绝会让「空元素」成为静默通过的清单错误。两行代码纳入同一个自检，不新增抽象。

**需要人类裁决的点：0 条。** 唯一前置人类批准（#595←#304 单边移除）已于 2026-11-17 取得并见 D1；其余由本计划自行裁决并记录。合并与否仍由人类伙伴决定。

## Idempotence and Recovery

- `migrate()` 本身幂等：成功后重开零写；失败回滚后可重试；`assertManifestIntegrity` 在任何事务前失败，不留写入。
- 批次回滚顺序必须逆序：Batch 3（文档）→ Batch 2（inventory）→ Batch 1（运行时契约）。Batch 2 依赖 Batch 1 的 `string[]` 形状，先回滚 Batch 1 会使 build 导入路径类型不匹配。
- 恢复锚点：main `ddb94c9440815626a3932dcaf050653f70eedb18`，分支 `refactor/storage-logical-baseline`，检出 `.worktrees/storage-logical-baseline`。分支已推送后如需重写历史，先建 backup ref，再用精确 old head 的 `--force-with-lease`（共享历史改写交 `git-expert-operations` 流程）。
- 数据库恢复：本 PR 不迁移、不修复任何既有库。若本地实验 profile/库在切换代码后被拒（`version_list`），按 `docs/product/demo-install.md#database-recovery` 停止进程、备份数据根、在新位置重建；qualification 等临时 profile 在复跑前整体删除重建。旧库与备份保留作恢复依据，禁止只改 `user_version`。
- 交付回滚：整 PR revert 即回到 7 行账本语义；本 PR 期间产生的空实验库无发布价值，重建即可。

## Interfaces and Dependencies

- 运行时接口：见 Design/Spec「接口」；`packages/storage/sqlite/src/index.ts` 通过 `export *` 自动导出 `BASELINE_VERSION`，无需单独改动。
- 生产消费者：`packages/storage/sqlite/src/storage.ts`（唯一 `migrate` 调用）、`apps/harness-plugin/src/host-composition.ts`（透传可选 `migrationsDir`）、`apps/harness-plugin/scripts/build.mjs`（inventory 消费）；`apps/harness-plugin/src/host.ts` 不再有 migrations 目录决策。
- 测试消费者：`tests/contract/storage-contract.test.js`（Fake+SQLite 共享合同，零改动）、`tests/integration/*`（见 Global Constraints 文件集合）、`tests/browser` 与 `tests/e2e`（零改动，账本无断言）。
- 工具链：Node 版本取 `.nvmrc`（26），SQLite 经 `node:sqlite`，构建经 `esbuild`；无新增依赖。在检出 `.worktrees/storage-logical-baseline` 根目录运行命令前若依赖缺失，先 `pnpm install --frozen-lockfile`。`pnpm verify` 是本地全量门禁；`PR Fast Gate`（Verify + Browser 聚合）是分支保护唯一必需检查，本 PR 不改 workflow。
- 仓库设置/关系：`#595` 的原生 `blocking` 仍为 `{596}`；`#595` 的 `blockedBy` 在 D1 执行后不含 `304`；不写规划 `Status`；不合并 PR。
- 交接：#596 在 #595 合并后从 main 起分支，只改 `packages/storage/sqlite/migrations/**` 与由 inventory 派生的路径/计数；不回收本计划的测试断言所有权。

## Outcomes & Retrospective

设计阶段结论：本叶的真实增量是账本语义与 inventory 收敛，单 PR 可在 300–450 代码行内闭合，SQL 字节零改动，世代保持 6；三路设计中只有「删除 host 哨兵」「`string[]`」与「单 PR 三批次」被采纳，「目录扫描等式」与「保留逐条版本」被否决。

实现回填（2026-11-17，检出 `.worktrees/storage-logical-baseline`）：

- 规模实测（`node scripts/rule-checks.mjs size main`）：**代码 342 行**（预测 300–450，中心 350）、**文档 367 行**（预测 250–280）；仓库 1000/1500 与本批 800/1300 上限均未触发。
- 判别性 RED→GREEN 四组：空库 7 行账本 → 单行基线；空清单静默 → 显式失败；旧完整 7 行账本被接受 → `version_list` 拒绝且文件 hash 不变；`build.mjs`/`host.ts` 的 `.sql` 字面量 → 静态守卫红 → 删除后绿。
- 预期外失败：无阻塞性失败；唯一语义偏差是旧 1 行账本的拒绝原因落在 `schema_shape`（Surprises 7），已按实际语义写进用例族（D13）。
- 与 D9 预测的偏差：代码落在预测区间内；文档比预测多出实现记录（RED/GREEN 证据、实际计数、D13/D14），按 PLANS.md「Progress / Surprises / Decision Log 必须可执行地记录」处理。
- 遗留风险：#596 必须在本 PR 合并后只改 SQL 资产、文件名与派生计数，且保持 ≤800 行；账本值 `1` 与旧步号 `1` 重叠，但旧完整库（7 行）由 `version_list`、部分库由 `schema_shape` 拒绝，已由 admission 反控覆盖，不产生误接受。

## Bottom Change Note

- 2026-11-17：创建。依据三路独立设计（系统/安全/产品透镜）对抗比较后收敛为唯一最小充分方案；记录 D1–D12、被放弃方案、文件集合、批次与 TDD 判别测试；尺寸由 issue 的 500–800 下调为 300–450（D9）。
- 2026-11-17（lead 裁决）：批准 D1–D12；`#595←#304` 单边移除已获用户点名批准，执行前本计划保持 Active；本 PR 以 `Closes #595` 交付、base 为 `main`。
- 2026-11-17（Batch 1，`c18a912f`）：运行时单基线落地；9 件测试 268 pass/0 fail；SQL 资产零改动，`CURRENT_SCHEMA_GENERATION` 保持 6，旧 7 行账本仍 `version_list`。
- 2026-11-17（Batch 2，`9558d4d7`）：`build.mjs`/`host.ts` 删除第二份 SQL 清单与目录判定；4 件插件/packed 测试 61 pass/0 fail；静态守卫证明 `.sql` 字面量只剩 `migrations.ts`。
- 2026-11-17（Batch 3，`本次文档提交`）：ExecPlan 回填（Progress/Surprises/D13–D14/Outcomes/Bottom Change Note）、README 索引保持、prelaunch 就地 `Superseded by`；门禁见 Batch 3 实际记录。
