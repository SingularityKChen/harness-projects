# Storage 物理单 SQL 资产（#596）ExecPlan

> 状态：Completed（2026-11-17 实现与验证完成、独立验收归档；评审记录 `docs/review/pr-659-mmp-review.md`；stacked base `refactor/storage-logical-baseline`，合并顺序为 #658 → 本 PR retarget/rebase）
> 创建：2026-11-17
> 范围：把 `packages/storage/sqlite/migrations/` 的 001–007 七个 SQL 片段合并为单一自包含基线资产（沿用 `001_init.sql`），删除 002–007，让 runtime inventory、build manifest、安装件 SQL 字节与 artifact/demo 负控全部经 #595 的共享 inventory 一致；不改 schema 内容、不 bump `CURRENT_SCHEMA_GENERATION`。
> 上游输入：issue #596（含 replan-20261116 与 2026-11-10 处置段）、issue #595、issue #417、`AGENTS.md`、`PLANS.md`、`docs/development/workflow.md`、`docs/architecture/release-gates.md`、`.superpowers/iteration11-batch3/research-storage.md`（其 2026-11-16 结论已按 main `ddb94c94`、#190 合并与 #595 新契约复核）。

## Purpose / Big Picture

交付后世界：`packages/storage/sqlite/migrations/` 只剩一个 375 行的 `001_init.sql`，它同时包含 `schema_migrations` 与全部当前表/索引/约束（001 的建表 + 002/003/004/006/007 原文按原顺序）。任何读者只读这一份 SQL 就能建出完整当前库。

成功的**最小证据**（全部可在 `.worktrees/storage-single-asset` 检出、无凭据、无网络的条件下复现）：

1. 目录与 inventory 都只有一个资产：`MIGRATIONS.length === 1`、`MIGRATIONS[0] === '001_init.sql'`（#595 的 inventory 是文件名字符串数组，等价形状）；`git grep -nE '00[2-7]_[a-z_]+\.sql' -- ':!docs'` 只命中 `migration-runner.test.js` 运行时写入临时目录的合成探针 `002_next.sql`，没有被删资产引用。
2. 新资产的 `sqlite_schema` 与 #595 head 七片段链建出的库**逐字相同**（31 个对象），`PRAGMA integrity_check` 为 `ok`、`PRAGMA foreign_key_check` 为空。
3. 真实 packed Host（把 build 产物装进临时 `node_modules` 再 `import()`）用包内单资产建库；`schema_migrations` 恰好一行（baseline 版本），二次 open `applied: []`、库字节不变；旧/未知库仍结构化拒绝且零写入。
4. 安装 tarball 的 `migrations/` 恰好 1 个文件、字节等于源资产；缺失/多余/篡改三种负控都由共享 inventory 派生并被拒绝。
5. PR 体量：代码增删合计 ≤800（本计划估算 782–799），文档 ≤1300；`rule-checks disclosure` 通过。

不关闭 #417/#223：本 PR 只关闭 #596，`Refs #417`。

## Context and Orientation

### 当前事实（观察 2026-11-17，基线 main `ddb94c94`）

- 仓库 `SingularityKChen/harness-projects`，main = `ddb94c9440815626a3932dcaf050653f70eedb18`，含 #643（Windows 私有根准入）、#645（Windows Git 路径）、#190（主身份约束）。迭代 11 剩余实现叶子：#644/#646/#595/#596；输出 PR 只有 #555（旧 UAT fixture）且与本任务无关。
- `packages/storage/sqlite/migrations/` 七个文件共 378 行：001=6、002=177、003=170、004=2、005=4（纯注释、无 DDL，`#415` 退役说明）、006=10、007=9。**004 的 2 行是 `ALTER TABLE execution_run ADD COLUMN ...`，不是可直接折叠的列定义。**
- 运行时唯一权威 inventory 是 `packages/storage/sqlite/src/migrations.ts` 的 `MIGRATIONS`（7 条 `{version, file}`）与 `MIGRATIONS_DIR`；`migrate.ts` 当前逐条 `exec` 并逐条写 `schema_migrations` 行，`CURRENT_SCHEMA_GENERATION = 6`；`assertCurrent` 用同一批 SQL 建内存参考库后逐对象比较 `sqlite_schema`。
- 共享 inventory 之外仍有硬编码文件名假设：`apps/harness-plugin/scripts/build.mjs` 的 `MIGRATION_FILES`（7 个名字；manifest 的 `files` 与拷贝循环分别在第 155、231 行使用）；`tests/integration/harness-plugin-demo-artifact.test.js` 的 `migrations` 字面量（含删除 `007_planning_sync_round.sql` 的缺失负控）；`tests/integration/harness-plugin-migrations.test.js` 的 readdir 期望；`tests/integration/identity-membership-schema.test.js` 与 `tests/integration/execution-relation-write-schema.test.js` 直接 `new URL(.../002_*.sql|003_*.sql)`；`apps/harness-plugin/src/host.ts:18-22` 用 `001_init.sql` 存在性识别打包目录（否则回落源码树）。
- 测试对旧账本形状的断言：`schema_migrations` 的 `[1,2,3,4,5,6,7]` / `version: 7` 出现在 `tests/integration/{migration-runner,storage-baseline-admission,storage-connector-account,harness-plugin-migrations,harness-plugin-artifact,harness-plugin-host-providers}.test.js`。**这些是 #595 把七行 ledger 折成单一 baseline 版本的直接后果，必须由 #595 收口，不能留给 #596 重写。**
- #595 分支 `refactor/storage-logical-baseline` 与 worktree `.worktrees/storage-logical-baseline` 已存在；观察时刻（2026-11-17 11:50）`git -C .worktrees/storage-logical-baseline log --oneline main..HEAD` 为空（说明 #595 尚未成形），复核时重跑同一命令。**这是本计划唯一的阻塞性不确定项**：本计划以 #595 head 满足 `Interfaces and Dependencies` 第 1 条为开工前提。
- #304 的 `blocked-by #595` 已于 2026-11-17 获人类批准移除（理由与证据写入 **#595** 的 ExecPlan Decision Log）；#596 不重复记录，也不再把 #304 当本 PR 的阻塞。
- 当前没有正式发布（`docs/architecture/release-gates.md` R1 未通过）。不做旧数据/旧设计兼容、迁移或修复。但 #595 期建出的库必须仍可被 #596 的 runtime 打开：物理布局变化不改变 `sqlite_schema` 文本与 baseline 版本。
- 当前文档中只有 `docs/product/demo-install.md:20` 是**现行**产物计数（“七份 migrations …… 共 12 个文件”）；`docs/development/backup-rollback-rehearsal.md`、`docs/adr/ADR-0011/ADR-0016` 等是带日期的历史记录，保留原文。

### 已实测的决定性事实

1. **逐字拼接保持 schema 文本一致**：用 001(第 3–6 行)+002+003+004+006+007 原文顺序执行，与七片段链执行，`SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name` 的 JSON 完全相同（31 个对象）。
2. **004 不能折叠**：SQLite 的 `ALTER TABLE ... ADD COLUMN` 会改写 `sqlite_schema.sql` 文本（实测 `execution_run` 的存储文本已含追加的两列）。若把两列折进 `CREATE TABLE`，新库与本 PR 前 #595 建出的库 schema 文本不同，会被 `assertCurrent(reason=schema_shape)` 拒绝，只能改世代或备份重建——这是用户可见损害，收益为零。
3. **SQL 位移的精确 diff**：新 375 行资产替换 6 行 001 得 `+371/−2`；删除 002–007 共 `−372`。SQL 部分增删合计 **745**。
4. **identity D8 约束级扫描需要切片**：合并后全文扫描得到 30 条 CREATE、**54 条**行内约束无出处（主要来自 003/006/007 的列级 CHECK/REFERENCES 与索引）。该用例的验收对象是 002（#27 验收 4），因此在 `-- workspace：`（002 首表注释）到 `-- repository：`（003 首表注释）之间切片即可：切片后 15 条 CREATE、无未出处约束，`creates >= 10` 判别力不变。
5. **execution D8 全文 token 扫描无需改判据**：合并后全文 49 个出处 token 全部落在 `ALLOWED_TOKENS` 内，逐表注释仍唯一；只需把读取路径指向单资产。
6. **单资产直接可用**：375 行一次性 `exec` 成功，`integrity_check=ok`，`foreign_key_check` 为空，与链式结果一致。
7. **一条 #595 收尾缺口**：`tests/integration/storage-baseline-admission.test.js` 的“清单选项不能提供不完整当前清单”用 `MIGRATIONS.slice(0, 1)`；inventory 缩成 1 条后该切片等于完整清单，断言会失效。必须由 #595 改写为 `entries: []`（对 7 条与 1 条都成立），或在 #596 花 2 行改（见 Open Questions）。

### 相关测试与文档

- schema 所有权：`tests/integration/identity-membership-schema.test.js`（002 的表/约束/列白名单/D8）、`tests/integration/execution-relation-write-schema.test.js`（003/004/006 的 D8、列集、约束拒绝矩阵）。
- 迁移与准入：`tests/integration/{migration-runner,storage-baseline-admission,storage-restart,storage-connector-account}.test.js`、`tests/contract/storage-contract.test.js`。
- 打包与真实 Host：`tests/integration/harness-plugin-migrations.test.js`（包内 migrations 建库、无源码回落）、`tests/integration/harness-plugin-demo-artifact.test.js`（真实 `pnpm pack` 的 tarball 审计与负控）、`tests/integration/harness-plugin-artifact.test.js`（安装进临时 `node_modules`、`import()` 真实 packed Host 并建库/重载）。
- 文档：`docs/product/demo-install.md`（现行安装指南）、`docs/exec-plan/active/`（本计划落点）。

## Design / Spec

### 选定方案（A）：原地合并进 `001_init.sql`，不新增生成器、不改包结构

**资产内容（固定，不再设计）**：
- 新 `packages/storage/sqlite/migrations/001_init.sql` = 3 行头 + 现 001 的第 3–6 行（`CREATE TABLE schema_migrations`）+ 现 002、003、004、006、007 的文件内容**按序逐字拼接**（各自保留首行出处注释与换行；不插空行、不改写、不重排、不压缩）。
- 头 3 行固定为：
  1. `-- 001_init：单一自包含物理基线（issue #417；#596）：迁移记账表与全部当前业务表、索引与约束，按原迁移顺序排列。`
  2. `-- 决策：不提供 downgrade；首次 MVP 发布前允许整份基线重写，回滚靠从备份恢复。`
  3. `-- 原 002–007 片段已并入本文件；005 的版本载体历史（issue #203/#415）不含 DDL，其退役说明保留在此。`
- 第 1 行必须含 `issue #417` 这类可解析出处 token，使 identity D8 约束扫描把 `schema_migrations` 的 CREATE 计入有出处。
- 005 的 4 行不进入资产；其语义（载体退役、写入期拒绝非规范版本）已由 003 的 `sync_observation` 注释与头第 3 行承接。
- 删除 002–007 六个文件。旧文件名不再是兼容承诺，只保留在 docs 历史记录与 git 历史中。

**状态拥有**（不新增抽象）：
- 权威 inventory 唯一在 `packages/storage/sqlite/src/migrations.ts`（#595 建立 `BASELINE_VERSION` 单 baseline 语义）；唯一 SQL 字节在 `migrations/001_init.sql`。
- `migrate.ts` / `storage.ts` 的初始化与准入语义归 #595，本 PR 不改（除 inventory 条目数外不碰逻辑）。
- build / 安装件 / artifact 测试从 inventory 派生（#595 的验收义务；本 PR 只消耗结果）。
- DB 两个权威不变：`PRAGMA user_version` = 物理布局世代（保持 6），`schema_migrations` 单行 = 逻辑 baseline 版本（保持 #595 的 `BASELINE_VERSION`，不新增语义）。

**关键不变量**：
- I1 磁盘 `migrations/` 目录、inventory、`manifest.files` 三处的 migration 集合相等，且都只有 `001_init.sql`。
- I2 安装件内 SQL 字节与源资产逐字节相同。
- I3 空库一次事务建出的 `sqlite_schema` 与 #595 head 七片段链逐字相同（31 个对象），ledger 单行、`user_version=6`。
- I4 初始化失败整事务回滚：零 ledger 残留、不写 `user_version`（#595 的 late-ddl/ledger/marker/commit 四相注入用例保持不变）。
- I5 旧/未知物理契约仍以 `incompatible_database` + `back_up_and_rebuild` 零写入拒绝；拒绝先于任何写。
- I6 打包 Host 只读包内资产；缺资产在事务前失败，**不回落源码树**（`lib/index.js` 不含 `packages/storage/sqlite/migrations` 字符串）。
- I7 迁移顺序的语句边界不因合并而改变（004 的 ALTER 原样保留）；语义注释保留，不做只为体量的 SQL 压缩。
- I8 Fake/SQLite 两适配器契约、身份/权限/事务/ack/reconcile/恢复语义不受影响。

**失败语义**：构建期清单引用不存在文件 → 抛错（#595 的 `assertManifestIntegrity`）；运行期缺文件 → `迁移文件缺失`（ENOENT 包装）且不写库；已安装资产被篡改但可解析 → 打开期结构化拒绝（`schema_shape`/`version_list`）零写入；不可解析 → SQLite 报错且事务回滚。多余资产 → 构建/归档审计失败，不回显注入内容。

### 三路设计的对抗性比较（收敛依据）

三路设计在“A 方案、保留 `001_init.sql`、删 005、不 bump 世代、stacked on #595”上一致；差异经过实测与 #595 边界校正后收敛为本计划，未默认选择最长方案：

- **设计 1（系统/架构）**：主结构与估算最接近实测（SQL 745、identity 54 条切片）。过度：把 `host.ts` 哨兵列为“#595 未接则本批补”，但保留文件名后它零改动；假设 #595 已含 build/artifact 派生（对这两项成立），却低估了 #595 的收尾面（5 个未被其写入面覆盖的 ledger 断言）。不足：声称现有 demo audit 已覆盖“缺失/多余/篡改”，实际只有缺失是显式负控；漏掉 `docs/product/demo-install.md` 的现行计数。
- **设计 2（安全/失败路径）**：逐字拼接、schema 文本对等、004 不折叠、自指假绿的变异证据均正确并被吸收。过度：在 #596 重写 `migration-runner` 的单资产断言、再写一遍“清单恰 1”，与 #595 的写入面重复；负控矩阵给得过大，我们只保留最小新增（多余、篡改）而非重写现有审计。事实小错：SQL 751 与实测 745 不符。不足：未指出 `MIGRATIONS.slice(0,1)` 在 shrink 后失效，也未把未被 #595 写入面覆盖的 ledger 断言列成阻塞；OQ 偏多。
- **设计 3（产品/验证）**：packed Host 的 `integrity_check`/`foreign_key_check`/二次 open 证据与 demo 三负控、文件名收益论证、堆叠而非等待的判断被吸收。不足：一边说测试改动归 #596、一边建议 #595 顺手改两个 schema 测试，边界摇摆；缺 #595 契约硬门，估算 771–795 依赖未验证的 #595 输出。
- **收敛结果**：采用设计 1 的合并/文件名/切片/规模结构，吸收设计 2 的逐字拼接与 schema 对等证据、设计 3 的 packed Host 与三负控；删除三者的重复改写（#595 文件、`migration-runner`、host.ts）、未验证假设与超量 OQ。最终代码估算 782–799（设计 1 783、设计 2 796、设计 3 771–795，均已用本计划实测的 745 SQL 校正）。

### 不 bump `CURRENT_SCHEMA_GENERATION`（Decision D2）

`CURRENT_SCHEMA_GENERATION` 表示“已接受的逻辑 schema 世代”，准入比较的是 `sqlite_schema` 文本、对象集合与 ledger 基线版本；这三者都不因物理文件数变化而改变（已实测 I3）。bump 的唯一效果是让 #595 期建出的合法库被拒绝，且没有自动恢复路径——用户可见损害、零收益。baseline 版本同理保持 #595 的值（`BASELINE_VERSION`，当前语义为 1），不因“文件变少”改数值。

### 被放弃的方案

| 方案 | 放弃原因 |
|---|---|
| B 改名 `001_baseline.sql` | 语义略准，但 `host.ts` 哨兵、两个 schema 测试路径、归档/负控路径都要改，多 10–14 行且无行为收益；贴近 800 上限时拒绝。保留 `001_init.sql` 还使打包目录探测与源码回落路径零改动。 |
| C 构建期把 7 个 fragment 拼接成安装件 | 产生“源 fragment”与“生成单资产”两个 SQL 权威，源码树与安装件两条字节路径，违反 #595 单 inventory 验收与 #596 单资产要求；无法逐字节对照唯一源。 |
| D 只合并一部分（先 004/006/007）或先加后删两 PR | 中间态仍是多资产/双权威，且第二次搬迁重复计算行数，不构成可独立验收、合并、回滚的闭环。 |
| E 把 004 的 ALTER 折进 `CREATE TABLE execution_run` | 会改变 `sqlite_schema.sql` 文本（已实测 ALTER 会改写该文本），导致 #595 期库被 `schema_shape` 拒绝，需 bump 世代或备份重建；违反“schema 内容不变”。 |
| F 给合并后全文 54 条约束逐条补出处注释 | 约 +54 行，且 003/006/007 的出处责任不在本用例（#27 验收 4 只覆盖 002）；用语义段切片既保留判别力又不动 SQL。 |
| G 保留 005 为空资产、保留版本 5 槽位 | 单 baseline 下没有“版本槽位”；4 行纯注释只会增加改名/断言负担，语义并入头注释。 |
| H 顺手重写历史文档/ADR 中的旧文件名 | 带日期的演练与 ADR 是历史证据，改写会篡改记录；只更新现行的 `docs/product/demo-install.md` 产物计数。 |
| I 新增 inventory 类/生成器/测试框架 | 无证据支持的抽象；只缩短数组、复用现有测试与负控。 |

### Open Questions（交 lead 裁决，≤3）

- **OQ1（阻塞）**：#595 是否按 `Interfaces and Dependencies` 第 1 条冻结契约（`MIGRATIONS`/`BASELINE_VERSION`、单 baseline ledger、build/artifact/demo/plugin-migrations 从 inventory 派生、受影响测试在 #595 head 全绿）。若 #595 head 与契约不符，本计划停在 Batch 0，由 lead 先对齐 #595，**不**在 #596 重复实现其义务。
- **OQ2（预算归属，预授权请求）**：若 #595 绿灯但把 demo/plugin 的 migration 列表派生留在原地（只在 7 条时成立），#596 需多付约 9–15 行，估算变为约 799；若届时实测仍 >800，预授权按 D11 顺序把该派生移入仍开着的 #595，而不是给 #596 要例外。请 lead 确认该预授权；若拒绝，则需要一条具名人类预算例外（见下）。
- **OQ3（可选）**：是否要求 `apps/harness-plugin/src/host.ts` 的目录哨兵也改为从 inventory 取文件名（约 +4 行）。建议不改（D9）；若评审坚持“零硬编码文件名”，在 Batch 3 追加即可。

**Lead 裁决（2026-11-17）**

- OQ1：接受。`#595` 的 head 满足共享 inventory/单 baseline 契约是本计划的硬门；未满足时停在 Batch 0 并回报 lead，不在 #596 重复实现 #595 的义务。
- OQ2：预授权。若 #595 绿灯但 demo/plugin-migrations 的清单派生仍留在原地，且 #596 实测超出 800，允许把该派生补进仍开着的 #595 分支（同一 capability 闭环），而不是给 #596 申请预算例外；不得删除判别测试或压缩 SQL。
- OQ3：不改 `apps/harness-plugin/src/host.ts` 的目录哨兵语义；#595 已在 D6 删除该函数时收口目录判定，若 #595 实际保留则本计划按 D9 不追加。

**需人类决策点：0 条**（在合法简化内代码 ≤800、文档 ≤1300）。

### Open Questions（历史；已由上方 Lead 裁决关闭）

### 共享 inventory 契约（本计划开工前提，由 #595 交付）

1. `packages/storage/sqlite/src/migrations.ts` 仍导出 `MIGRATIONS`（有序输入资产）、`MIGRATIONS_DIR`、`migrationPath`、`readMigrationSql`，并新增/导出 `BASELINE_VERSION`（单 baseline 版本，当前语义 1）；`migrate()` 空库返回 `applied: [BASELINE_VERSION]`、`version: BASELINE_VERSION`，`schema_migrations` 恰好一行。
2. `apps/harness-plugin/scripts/build.mjs` 不再持有 `MIGRATION_FILES` 字面量；manifest `files` 与 `migrations/` 拷贝都由 `MIGRATIONS` 派生。
3. artifact/demo/plugin-migrations 测试中“包内有哪几个 migration”的期望由 `MIGRATIONS` 派生（至少不再维护第二份 7 名字清单）；缺失负控的目标文件名从 inventory 取。
4. 所有 `schema_migrations` 版本断言（`[1..7]`/`version: 7`/`MIGRATIONS.map(...)` 比较）已按单 baseline 改写；观察时刻必须能在 #595 head 上全部通过（见 Batch 0 的 gate 命令）。
5. `tests/integration/storage-baseline-admission.test.js` 的“不完整清单”用例用 `entries: []`（或等价的对 7 条/1 条都成立的形状）。

## Global Constraints

- 实现只允许发生在分支 `refactor/storage-single-asset`、worktree `.worktrees/storage-single-asset`（从 `refactor/storage-logical-baseline` 创建，stacked PR，base = #595 分支）。#595 未稳定前不开工；不预合并。
- 文件集合（本任务唯一一次声明；批次只列主文件，不再复述）：
  - 改写：`packages/storage/sqlite/migrations/001_init.sql`。
  - 删除：`packages/storage/sqlite/migrations/{002_identity_membership,003_control_facts,004_execution_run_identity,005_source_version_carrier,006_delivery_facts,007_planning_sync_round}.sql`。
  - 修改：`packages/storage/sqlite/src/migrations.ts`、`tests/integration/identity-membership-schema.test.js`、`tests/integration/execution-relation-write-schema.test.js`、`tests/integration/harness-plugin-migrations.test.js`、`tests/integration/harness-plugin-demo-artifact.test.js`、`tests/integration/harness-plugin-artifact.test.js`、`tests/integration/storage-baseline-admission.test.js`（**仅** legacy/partial 夹具构造，见 D13；断言不得放宽）。
  - 新增文档：`docs/exec-plan/active/2026-11-17-storage-single-asset.md`；修改文档：`docs/README.md`（计划索引）、`docs/product/demo-install.md`（现行产物计数与恢复段安装文件计数）。
  - 只读（本 PR 不改，由 #595 收口）：`packages/storage/sqlite/src/{migrate,storage}.ts`、`apps/harness-plugin/scripts/build.mjs`、`apps/harness-plugin/src/host.ts`、`tests/integration/{migration-runner,storage-restart,storage-connector-account,harness-plugin-host-providers}.test.js`、`.github/**`。
- 预算：代码（除 `docs/` 外）增删合计 ≤800；文档 ≤1300；用 `node scripts/rule-checks.mjs size <base>` 自检（该脚本仓库硬上限为 1000/1500，本任务采用更严的 800/1300，PR 里两者都要报）。**不得**通过 SQL 压缩、删判别测试、把搬移行当免费或改写生成目录来压线。
- 不新增依赖、不新增抽象、不改包边界、不改 Loader external 列表、不加源码兜底、不做旧文件名/旧库兼容或数据迁移。
- 保持真实 Host ABI、身份、权限、事务、ack/reconcile、恢复不变量与 `PRAGMA user_version`/baseline 语义。
- 旧/未知库拒绝路径与错误文案（含备份/重建指引 URL）不变；`CURRENT_SCHEMA_GENERATION` 不改。
- 文档中文、标识符/路径/命令英文；不写本机绝对路径；证据注明检出（分支/worktree）与回读命令。
- 公开面（commit/PR/issue 正文）用英文；ExecPlan 与内部汇报用中文。commit 标题沿用仓库 `<type>(<scope>): <摘要>` 形状。不写看板 `Status`，不自行合并。
- 只把 #596 的验收作为本 PR 的完成判据；不声称 #417/#223 关闭。

## Plan of Work

### Batch 0 · 前置门：#595 契约与绿基线（只读，不产生提交）

**最小闭环**：确认 #595 head 满足共享 inventory/单 baseline 契约且受影响测试全绿；不满足就停在本批，不创建分支，不吸收 #595 的工作。

**涉及文件**：无（只读；`gh` 只读回读）。

步骤：
1. 回读 #595 分支与 PR 状态：`git -C .worktrees/storage-logical-baseline log --oneline -3`、`gh pr view <#595-PR> -R SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,state`（期望：head 有实现提交、base=main、最终由人类合并；数字以回读为准）。
2. 在 main 检出确认 worktree 目录被忽略：`git check-ignore -v .worktrees/`（期望命中 `.gitignore` 的 `.worktrees/`）。
3. 创建分支/worktree：`git worktree add -b refactor/storage-single-asset .worktrees/storage-single-asset refactor/storage-logical-baseline`；在 worktree 根 `git status --short --branch`（期望干净、分支名正确）。
4. Gate 命令（在 `.worktrees/storage-single-asset` 根运行，全部期望 `fail 0`）：
   - `pnpm test:file tests/integration/migration-runner.test.js tests/integration/storage-baseline-admission.test.js tests/integration/storage-restart.test.js tests/integration/storage-connector-account.test.js`
   - `pnpm test:file tests/integration/execution-relation-write-schema.test.js tests/integration/identity-membership-schema.test.js tests/integration/harness-plugin-migrations.test.js tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-host-providers.test.js`
   - `git grep -n "MIGRATION_FILES" -- apps/harness-plugin/scripts/build.mjs`（期望无输出、exit 1）。
   - `git grep -n "MIGRATIONS" -- apps/harness-plugin/scripts/build.mjs`（期望至少 1 行，证明 build 从共享 inventory 派生）。
   - `node --input-type=module -e "import('./packages/storage/sqlite/src/migrations.ts').then((m)=>{console.log(m.MIGRATIONS.length, m.BASELINE_VERSION)})"`（期望 `7 1`；若 `BASELINE_VERSION` 未导出或名字不同，本批失败并回报 lead，在 #595 对齐后再继续）。
   - `git grep -nE '\[1, 2, 3, 4, 5, 6, 7\]|version: 7' -- tests`（期望无输出；证明 #595 已收口 ledger 断言）。
5. 记录实际 head SHA 与上述命令的观察值到 PR 描述/本计划 Progress；易失值不写死进正文。

**验证**：上述命令全部符合期望；任何一条不符即阻塞并上报，不修改 #595 的文件。

**回滚**：删 worktree/分支：`git worktree remove .worktrees/storage-single-asset`、`git branch -D refactor/storage-single-asset`（不触碰 main 与任何数据库）。

### Batch 1 · 计划落地与判别性红测试

**最小闭环**：把本计划落进 `docs/exec-plan/active/` 并开 draft PR；再用 4 个测试文件钉住“单资产”行为，先在 #595 head 上得到可解释的红色。

**涉及文件**：`docs/exec-plan/active/2026-11-17-storage-single-asset.md`（新增）；`tests/integration/{identity-membership-schema,execution-relation-write-schema,harness-plugin-migrations,harness-plugin-demo-artifact}.test.js`。

步骤：
1. 将本文件复制为 `docs/exec-plan/active/2026-11-17-storage-single-asset.md`（状态 Active；不含占位符），提交 `docs(storage): add single-asset baseline plan`；创建 draft PR（base `refactor/storage-logical-baseline`，标题英文 `refactor(storage): consolidate the current baseline into one SQL asset`，正文英文，`Closes #596`、`Refs #417`，附本计划路径与批次表）。
2. identity 测试：把 `MIGRATION_FILE` 由 `new URL('.../002_identity_membership.sql')` 改为 `migrationPath(MIGRATIONS[0])`（import 加 `migrationPath`、去不再使用的 `fileURLToPath`/`URL`）；D8 约束级扫描的 `lines` 改为 `readFileSync(MIGRATION_FILE, 'utf8').split('-- repository：')[0].split('\n')`（保留 `creates >= 10` 与逐条出处断言）。
3. execution 测试：同样把 `MIGRATION_FILE` 改为 `migrationPath(MIGRATIONS[0])`；全文 token 扫描判据不变（已实测合并后 49 token 全在白名单）。
4. `harness-plugin-migrations`：从 `@harness-projects/storage-sqlite` import `MIGRATIONS`；readdir 期望改为 `MIGRATIONS.map(({ file }) => file).sort()`；新增一行字面量守卫 `assert.deepEqual(MIGRATIONS.map(({ file }) => file), ['001_init.sql'], '物理基线必须只有一个资产')`；新增 `manifest.files` 的 migration 项等于 inventory 派生项（`filter(file => file.startsWith('migrations/'))`）。
5. `harness-plugin-demo-artifact`：import `MIGRATIONS` 与 `cp`；`migrations` 改为 `MIGRATIONS.map(({ file }) => file)` 并加同样的单资产字面量守卫；缺失负控文件名改为 `migrations/${migration}`；新增“多余”负控（把唯一资产复制为 `999_extra.sql`，重打包时显式加入该条目，期望 `/inventory/` 失败）与“篡改”负控（把唯一资产内容改写，期望 `/migration bytes differ/` 失败）；重打包过滤表达式随负控更新。
6. 先只提交测试（`test(storage): pin single-asset baseline expectations`），并执行 Batch 1 验证。

**验证**（worktree 根；期望红色且失败原因与预期一致）：
- `pnpm test:file tests/integration/identity-membership-schema.test.js tests/integration/execution-relation-write-schema.test.js` → identity 的“至少 10 条 CREATE”/002 表出处断言失败；execution 的 `-- repository：` 表出处断言失败（001 只有 6 行）。
- `pnpm test:file tests/integration/harness-plugin-migrations.test.js` → 单资产字面量守卫失败（inventory 仍 7 条）。
- `pnpm test:file tests/integration/harness-plugin-demo-artifact.test.js` → 单资产字面量守卫失败（7 条）。
- 记录每条失败的首行与失败用例名，作为“测试先红”的证据写进 PR 描述。

**回滚**：`git revert <两个提交>`；draft PR 可关闭（不删除分支），worktree 与 DB 无副作用。

### Batch 2 · 合并物理基线（green）

**最小闭环**：单资产落地、旧片段删除、inventory 缩为 1 条；全部 storage/schema/迁移测试转绿，包内文件数随之收敛。

**涉及文件**：`packages/storage/sqlite/migrations/001_init.sql`（改写并删除 002–007）、`packages/storage/sqlite/src/migrations.ts`、`tests/integration/identity-membership-schema.test.js`、`tests/integration/execution-relation-write-schema.test.js`。

步骤：
1. 按 Design 的固定内容生成新 `001_init.sql`（3 行头 + 001 第 3–6 行 + 002/003/004/006/007 原文按序）；用 `cmp`/diff 确认被拼接部分的字节与源文件一致；删除 002–007。
2. `migrations.ts`：`MIGRATIONS` 只留 `{ version: BASELINE_VERSION, file: '001_init.sql' }`（或 #595 等价形状），删除 005 的位置注释与其余 6 条；不改 `Migration`/`migrationPath`/`readMigrationSql`/`assertManifestIntegrity` 语义。
3. 跑 Batch 2 验证；如 identity/execution 仍红，按失败信息修测试（只允许改路径/切片，不允许放宽断言）。
4. 用一次性的 schema 对等证据（见 Validation 的 schema 对等一次性证据）证明与 #595 链逐字相同；把输出写入 PR 描述。
5. 提交 `refactor(storage): merge physical baseline into one SQL asset`。

**验证**（worktree 根）：
- `pnpm test:file tests/integration/identity-membership-schema.test.js tests/integration/execution-relation-write-schema.test.js` → `fail 0`。
- `pnpm test:file tests/integration/migration-runner.test.js tests/integration/storage-baseline-admission.test.js tests/integration/storage-restart.test.js tests/integration/storage-connector-account.test.js tests/contract/storage-contract.test.js` → `fail 0`（旧/未知库拒绝、四相回滚、双 worker、二次 open 不变）。
- `pnpm typecheck` → exit 0。
- `git grep -nE '00[2-7]_[a-z_]+\.sql' -- ':!docs'` → 只命中合成探针 `002_next.sql`（清单自检临时文件），没有被删资产引用。
- schema 对等脚本（见 Validation）→ `schema_identical: true objects: 31`、`integrity: ok fk: 0`。

**回滚**：`git revert <merge-commit>` 恢复 7 文件与 inventory；因为不 bump 世代且 schema 文本未变，任何已存在库在新的或不回退的 runtime 下都可打开；测试数据库都在临时目录，无需清理。

### Batch 3 · 打包、安装件与真实 packed Host 证据

**最小闭环**：证明最终单资产被真实构建/打包/安装/宿主加载，且缺失/多余/篡改负控都由共享 inventory 派生；补齐 packed Host 的 integrity/FK/二次 open 断言。

**涉及文件**：`tests/integration/harness-plugin-artifact.test.js`（新增只读断言）；`tests/integration/harness-plugin-demo-artifact.test.js`、`tests/integration/harness-plugin-migrations.test.js`（若 Batch 1 已改则只验证）。

步骤：
1. 在 packed Host 用例（`harness-plugin-artifact.test.js` 中真实安装并 `import()` 的用例）第一次打开 DB 后、关闭前加：`PRAGMA integrity_check` 为 `ok`、`PRAGMA foreign_key_check` 为空、`schema_migrations` 恰好一行且版本等于 baseline；在“同 artifact 原库可以重新加载”之后重新只读打开同一 DB，断言 ledger 仍是一行（二次 open 零迁移）。
2. 运行本批验证；确认 demo 三个负控（缺失/多余/篡改）各自以 inventory 派生的文件名失败且不回显注入值；确认 tarball 恰好 6 个文件（`package.json` + 5 个 manifest 条目，其中 migration 1 个）。
3. 提交 `test(apps): prove packed host loads the single base asset`（若本批只有断言）。

**验证**（worktree 根）：
- `pnpm test:file tests/integration/harness-plugin-migrations.test.js tests/integration/harness-plugin-demo-artifact.test.js tests/integration/harness-plugin-artifact.test.js` → `fail 0`；这三条分别覆盖：包内 migrations 目录建库且无源码回落、真实 tarball 归档/字节/负控、安装进 node_modules 的真实 packed Host 建库与重载。
- `pnpm --filter @harness-projects/app-harness-plugin pack:plugin && tar -tzf apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.1.0-demo.1.tgz | sort` → 恰好 6 行：`package/LICENSE`、`package/cordis.patch.yml`、`package/lib/client.js`、`package/lib/index.js`、`package/migrations/001_init.sql`、`package/package.json`。
- `git grep -n "packages/storage/sqlite/migrations" -- apps/harness-plugin/dist 2>/dev/null` → 无输出（不进入 git，可跳过；源码侧由用例内 `doesNotMatch` 覆盖）。

**回滚**：`git revert <commit>`；已安装的旧 tarball 仍可装回（安装件布局 ABI 不变，仍是同名包/同 exports/同 peer），不需要数据库回退。

### Batch 4 · 文档与门禁收口

**最小闭环**：更新现行产物计数与计划状态，跑完整门禁，回读 PR 当前状态。

**涉及文件**：`docs/product/demo-install.md`（1 行）；`docs/exec-plan/active/2026-11-17-storage-single-asset.md`（Progress/Decision Log/Surprises/Outcomes/Bottom Change Note）。

步骤：
1. `docs/product/demo-install.md:20`：把“七份 migrations …… 共 12 个文件”改为单 migration/共 6 个文件，并把负控提示改为“缺失/多余/篡改 migration”。只改这一行现行描述，不动历史记录。
2. 更新 ExecPlan：Progress 勾选并记日期、Decision Log 落定 D1–D12、Surprises 记录实际偏差、Outcomes 记录实际行数与验证输出、Bottom Change Note 追加。
3. 提交 `docs(storage): record single-asset delivery evidence`。
4. 门禁与 ready：`pnpm verify`、size/disclosure/diff-check、PR 回读；确认 base 仍是 #595 分支、head 是最新提交、checks 全绿后 `gh pr ready`；不合并。

**验证**（worktree 根）：
- `pnpm verify` → exit 0（contract/integration/e2e 三层非空且全绿；browser lane 由 CI 的 PR Fast Gate 覆盖，本次无 UI 改动）。
- `node scripts/rule-checks.mjs size refactor/storage-logical-baseline` → 代码 ≤800、文档 ≤1300（本计划预计代码 782–799、文档约 360）。
- `node scripts/rule-checks.mjs disclosure refactor/storage-logical-baseline` → “机械扫描通过”；再按 `docs/development/publication.md` 五类目人工过一遍。
- `git diff --check refactor/storage-logical-baseline...HEAD` → 无输出、exit 0。
- `gh pr view <PR> -R SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,mergeStateStatus,closingIssuesReferences` 与 `gh pr checks <PR> -R ...` → base 正确、`Closes #596` 在关联里、checks 全部 pass；回读 `gh issue view 596 ... --json state`（仍 OPEN，合并由人类执行）。

**回滚**：`git revert <docs-commit>`；若整 PR 放弃，关闭 draft PR 并保留 7 片段分支（revert Batch 2 即可运行）。

## Validation and Acceptance

按 issue #596 的验收逐条给出最小证据（命令都在 `.worktrees/storage-single-asset` 根、base `refactor/storage-logical-baseline` 上运行）：

1. **内容完整、不压缩**：新资产 = 001 DDL + 002/003/004/006/007 原文；证据为下面的 schema 对等脚本输出 `schema_identical: true objects: 31`，加上 `identity-membership-schema` 与 `execution-relation-write-schema` 的 D8/列集/约束拒绝用例全绿；`wc -l` 显示 375 行。
2. **旧片段与硬编码假设清除、共享 inventory 一致**：`git grep -nE '00[2-7]_[a-z_]+\.sql' -- ':!docs'` 只命中合成探针 `002_next.sql`、没有被删资产引用；`MIGRATIONS.length === 1`；`harness-plugin-migrations` 断言包内目录 = inventory；tar 审计断言字节相等；demo 的缺失/多余/篡改负控的目标名来自 inventory。
3. **初始化/重开/完整性与旧库拒绝**：`migration-runner`（空库、二次 no-op、双 worker、清单自检）、`storage-restart`、`storage-baseline-admission`（旧/未知契约拒绝、零写、四相回滚）、`storage-connector-account`、`tests/contract/storage-contract.test.js` 全绿。
4. **真实 packed Host**：`harness-plugin-artifact` 安装真实产物并 `import()` Host，建库后 `integrity_check=ok`、`foreign_key_check` 空、ledger 单行；重载同一 artifact 后再次打开仍单行（零迁移）；`lib/index.js` 不含源码树路径（现有断言）；`harness-plugin-demo-artifact` 对真实 `pnpm pack` 的 tarball 做归档/字节/负控审计。
5. **规模与门禁**：`rule-checks size` 代码 ≤800、文档 ≤1300；`disclosure` 通过；`git diff --check` 干净；`pnpm verify` 绿；PR Fast Gate（CI）在最终 head 上全绿。
6. **不越界**：`CURRENT_SCHEMA_GENERATION` 仍为 6、baseline 版本仍为 #595 的值；`#417`/`#223` 仍 OPEN（`Refs` 不 `Closes`）。

Schema 对等一次性证据（保留在 PR 描述，不写成源码快照）：

```sh
node --input-type=module -e '
import { DatabaseSync } from "node:sqlite"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
const base = "refactor/storage-logical-baseline"
const files = ["001_init.sql","002_identity_membership.sql","003_control_facts.sql","004_execution_run_identity.sql","006_delivery_facts.sql","007_planning_sync_round.sql"]
const chain = new DatabaseSync(":memory:")
for (const file of files) chain.exec(execFileSync("git", ["show", base + ":packages/storage/sqlite/migrations/" + file], { encoding: "utf8" }))
const single = new DatabaseSync(":memory:")
single.exec(readFileSync("packages/storage/sqlite/migrations/001_init.sql", "utf8"))
const dump = (db) => JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB \"sqlite_*\" ORDER BY name").all())
console.log("schema_identical:", dump(chain) === dump(single), "objects:", JSON.parse(dump(chain)).length)
console.log("integrity:", single.prepare("PRAGMA integrity_check").get().integrity_check, "fk:", single.prepare("PRAGMA foreign_key_check").all().length)
'
```

期望输出：`schema_identical: true objects: 31`、`integrity: ok fk: 0`。变异证据（实现期执行一次，不改提交）：把新资产里任一 `CHECK` 或 `REFERENCES` 改动一个字符，重跑同一脚本必须输出 `schema_identical: false` 并 exit 非零；还原后复跑通过——证明该证据不是恒绿。

规模估算（相对 #595 head；以 `rule-checks size` 实测回读为准）：

| 变更面 | 位置 | 估算增删合计 |
|---|---|---|
| SQL：375 行新资产替换 6 行 + 删除 6 片段 372 行 | `migrations/001_init.sql`、002–007 | 745（实测 `+371/−2` 与 `−372`） |
| inventory 7→1 | `packages/storage/sqlite/src/migrations.ts` | 8–12 |
| identity 测试：路径派生 + 语义段切片 | `tests/integration/identity-membership-schema.test.js` | 8–9 |
| execution 测试：路径派生 | `tests/integration/execution-relation-write-schema.test.js` | 5 |
| 包内单资产守卫 | `tests/integration/harness-plugin-migrations.test.js` | 3–9 |
| 归档/字节/三负控 | `tests/integration/harness-plugin-demo-artifact.test.js` | 8–14 |
| packed Host 证据 | `tests/integration/harness-plugin-artifact.test.js` | 5 |
| **代码合计** | | **782–799** |
| 文档：ExecPlan + demo-install 现行计数 | `docs/exec-plan/active/…`、`docs/product/demo-install.md` | 340–380 |

若实测 >800：按 Open Questions OQ2 先要求 #595 吸收 demo/plugin 期望派生（其验收本就要求 build/artifact 消费共享 inventory，约 −15），仍超才提出具名人类预算例外；**不**压缩 SQL、**不**删负控或判别测试、**不**把搬移行当免费。810–860 的朴素估算来自“#595 未消费 inventory + 改名 baseline + 全资产补 54 条出处注释 + 折叠 004 引出世代升级”等重复/越界工作；本计划用 L1–L6 简化压到上表：L1 #595 吸收 build/artifact/ledger 收尾；L2 沿用 `001_init.sql`；L3 005 只删不搬；L4 期望从 inventory 派生而非第二份清单；L5 复用现有负控只加多余/篡改两项；L6 不重写 #595 已改断言。

## Progress

- [x] (2026-11-17) Batch 0：#595 head 满足共享 inventory/单 baseline 契约且 gate 命令全绿；分支/worktree 就绪，rebase 到 `ee384266` 后 gate 复跑 `fail 0`（186 + 83）。
- [x] (2026-11-17) Batch 1：ExecPlan 落入 `docs/exec-plan/active/`；4 个测试文件在 #595 head 上按预期先红（`creates=1`、无出处 token、两处 `['001_init.sql']` 字面量守卫），提交 `7994614e`（rebase 前旧对象 `6bd97f99` 仅存于 backup 分支）。
- [x] (2026-11-17) Batch 2：新 375 行 `001_init.sql`、删除 002–007、inventory 缩为 1 条；schema 对等证据 `schema_identical: true objects: 31`、`integrity: ok fk: 0`；schema/迁移/准入 473 + 36 用例全绿；提交 `61e256cc`。
- [x] (2026-11-17) Batch 3：packed Host integrity/FK/二次 open 断言补齐；真实构建/打包/安装与缺失/多余/篡改负控全绿；tarball 恰好 6 个文件且 migration 字节与源资产 `cmp` 相同；提交 `121a313f`。
- [x] (2026-11-17) Batch 4：`docs/product/demo-install.md` 现行计数更新；`pnpm verify`、typecheck、boundaries、size/disclosure/diff-check 通过；PR body 回读后交人类评审（不 ready、不合并）。

## Surprises & Discoveries

- **004 的 ALTER 会改写 `sqlite_schema.sql`**：实测 `execution_run` 建表后 `ALTER TABLE ... ADD COLUMN` 两次，存储文本已把两列追加进 `CREATE TABLE`；因此“把 004 折进 CREATE”会改变 schema 文本并拒绝 #595 期库。合并必须保留 ALTER 语句原位置（对应 Decision D4）。
- **SQL 位移不是 751 而是 745**：精确 `git diff --no-index --numstat` 显示新资产替换 001 为 `+371/−2`，加 6 文件 `−372`，合计 745；先前 750–760 的估算偏高。
- **identity 约束级扫描的假失败面是 54 条**：合并后全文扫描 30 条 CREATE 中 54 条行内约束无出处；按 `-- workspace：`→`-- repository：` 切片后 15 条 CREATE、0 条未出处，且 `creates >= 10` 的判别力保持。
- **execution D8 全文扫描天然通过**：合并后 49 个出处 token 全部在白名单；该测试无需改判据，只需换路径。
- **#595 分支在观察时还没有实现提交**（`git log main..HEAD` 为空）：本计划把“契约落地”做成 Batch 0 的硬门，而不是假设它已完成。
- **#595 的收尾面比 coordination 的写入面更宽**：`execution-relation-write-schema`、`storage-connector-account`、`harness-plugin-artifact`、`harness-plugin-host-providers`、`harness-plugin-migrations` 都含七行 ledger 断言，单 baseline 后必须先由 #595 改写，否则 #595 head 不可能绿。
- **`MIGRATIONS.slice(0, 1)` 的“不完整清单”用例在 inventory 缩为 1 后失效**：必须由 #595 改成 `entries: []`（对两种长度都成立）。
- **现行文档只有一处产物计数**：`docs/product/demo-install.md:20` 的“七份 migrations/12 个文件”需改为单 migration/6 个文件；其他出现旧文件名的文档都是带日期的历史记录，保留。
- **`storage-baseline-admission` 的旧库夹具在单资产后必然退化（实测 6 红）**：它用 `MIGRATIONS.slice(0,count)` 从**当前** inventory 派生“旧 main 7/4/2/1 片段库”；inventory 缩为 1 后，`legacyFixture(db)` 建出的就是合法单基线库，`fixture(db, 1)` 也从“只有记账表”退化为完整库，于是 6 个“必须拒绝”用例变成 `Missing expected exception`。这不是 #595 的疏漏，而是“夹具从被测 inventory 派生”与“inventory 本身要收缩”的结构冲突；修复见 D13。
- **#595 head 在实现期前进**：开工时 `ee384266`，独立验收追加 `f92c413c`（静态守卫覆盖模板字面量）与 `5e7db487`（验收文档）；分支已 rebase 到 `5e7db487`，PR 判定基线以该 head 为准。
- **体量实测落在估算上沿**：`rule-checks size` 代码 799/1000（本任务 ≤800），其中 SQL 位移 745、夹具重建 14、inventory 13、其余测试 27；没有压缩 SQL、没有删判别测试，也没有把搬移行当免费。
- **tarball 由 12 文件变 6 文件后 demo 审计仍全绿**：`expected` 由 `MIGRATIONS` 派生，缺失负控自动指向唯一资产；新增的“多余”用显式注入条目、新增的“篡改”用同名字节改写，都只经 `audit()` 的既有判别面失败。

## Decision Log

| # | 决策 | Rationale | 日期/作者 |
|---|---|---|---|
| D1 | 采用方案 A：把 001–007 原地合并进 `001_init.sql`（保留该文件名），逐字拼接，不写生成器。 | 唯一可独立验收/合并/回滚的闭环；保留文件名使 `host.ts` 哨兵、打包相对路径、字节对照路径零改动，省 10–14 行且无行为收益损失。 | 2026-11-17 / 设计评审 |
| D2 | 不 bump `CURRENT_SCHEMA_GENERATION`（保持 6），baseline 版本保持 #595 的值（当前语义 1）。 | 物理文件数不是逻辑 schema；`sqlite_schema` 文本、对象集合与 ledger 形状都不变（实测 31 对象逐字相同）。bump 会拒绝 #595 期合法库且无恢复路径，纯损害。 | 2026-11-17 / 设计评审 |
| D3 | 删除 005 的 4 行纯注释资产；退役说明并入资产头第 3 行。 | 单 baseline 没有“版本 5 槽位”；保留只会增加断言与改名负担；005 无 DDL，删除不改变 schema。 | 2026-11-17 / 设计评审 |
| D4 | 004 的 `ALTER TABLE execution_run ...` 原样保留在新资产中，绝不折进 `CREATE TABLE`。 | SQLite ALTER 会改写存储的 CREATE 文本；折叠会改变 `sqlite_schema`，使 #595 期库 schema_shape 拒绝，需世代升级/备份重建。 | 2026-11-17 / 设计评审 |
| D5 | identity D8 约束级扫描限定在 `-- workspace：` 到 `-- repository：` 的 002 语义段；不补 54 条全文出处注释。 | 该用例验收对象是 002（#27 验收 4）；切片后 15 条 CREATE、0 条未出处，判别力（`creates>=10` + 逐条出处）保持；补 54 行既超预算又扩面。 | 2026-11-17 / 设计评审 |
| D6 | artifact/demo 负控：缺失沿用现有用例并改从 inventory 取名；新增“多余”和“篡改”两个显式负控，均由 inventory 派生。 | issue #596 要求 Recheck missing/extra/tampered；现有审计能拒绝多余/篡改但没有显式反例，补两项成本约 4–6 行，收益是可判别证据。 | 2026-11-17 / 设计评审 |
| D7 | 共享 inventory（`MIGRATIONS`/`BASELINE_VERSION`/build/artifact 派生/ledger 断言收尾）由 #595 全权拥有；#596 只在 #595 head 绿后开工，不重复其改动。 | #595 的验收本就要求 inventory 被 build 与 artifact checks 消费；把收尾留在 #596 会把 782–799 推到 810+，且违反“逻辑/物理顺序叶子”边界。 | 2026-11-17 / 设计评审 |
| D8 | 带日期的历史文档、ADR、演练记录保留旧文件名原文；只更新 `docs/product/demo-install.md` 的现行产物计数。 | 历史记录是当日证据，改写等于篡改；现行安装指南面对未来接收者，必须与新产物一致。 | 2026-11-17 / 设计评审 |
| D9 | 不改 `apps/harness-plugin/src/host.ts` 的 `001_init.sql` 目录哨兵。 | 文件名保留后哨兵语义仍正确；它是“打包目录探测”而非第二份 inventory 清单；改它会扩大 app 面且无判别力收益（若评审要求，+4 行可做）。 | 2026-11-17 / 设计评审 |
| D10 | 包/归档测试的 migration 期望从 `MIGRATIONS` 派生，但保留一行 `['001_init.sql']` 字面量守卫。 | 满足“经共享 inventory 一致”，同时避免 build 与 test 同源同错；`tests/integration/README.md` 的“不 import 构建脚本常量”针对宿主兼容常量，而 migration 集合是本任务的被测对象，从 storage inventory 派生并保留一行 `['001_init.sql']` 字面量守卫即可。 | 2026-11-17 / 设计评审 |
| D11 | 超限兜底顺序：① 要求 #595 吸收 demo/plugin 期望派生；② 保留已声明的两负控、砍可选表述；③ 最后才是具名人类例外；不压缩 SQL、不删判别测试。 | #595 有充足预算（其 forecast 550–800，实测增量远低），先消除重复工作比给 #596 要例外更安全；SQL 压缩与删负控会破坏安全逻辑或判别力。 | 2026-11-17 / 设计评审 |
| D12 | 本 PR 只 `Closes #596`、`Refs #417`；不关闭 #417/#223，也不复制 #304 的批准记录。 | #304 解除阻塞的批准只针对 #595 且已写入其 Decision Log；#417/#223 的收口证据超出本 PR。 | 2026-11-17 / 设计评审 |
| D13 | `storage-baseline-admission` 的旧库夹具改为语义等价重建：**多行账本用例**用完整当前 shape（I3 已证旧链与新资产建出的 `sqlite_schema` 逐字相同）逐条写 1..N 行账本；**只应用过 001 的旧库**用单资产在 `-- 002_identity_membership：` 之前的截断前缀 + 账本 `[1]`。不改断言、不改其它用例。 | 单资产后不可能再从当前 inventory 派生“旧 main 的部分 shape”；这是“夹具从被测 inventory 派生”与 inventory 收缩的结构冲突，不是 #595 的缺陷。lead 2026-11-17 裁决：作为 #596 职责记录，不回填 #595（#595 分支不由本任务推送）。 | 2026-11-17 / lead 裁决 |

## Idempotence and Recovery

- 每个批次可重复执行：Batch 0 只读；Batch 1 的测试改动可反复跑；Batch 2 的资产生成是确定性的（固定 3 行头 + 固定拼接顺序），重跑得到相同字节；Batch 3/4 只读或文档可重复。
- 中断恢复：若 Batch 2 在“删除旧文件但未提交”中断，`git restore --source=HEAD --staged --worktree packages/storage/sqlite/migrations packages/storage/sqlite/src/migrations.ts` 回到 #595 head；若已提交但验证失败，`git revert` 对应提交，不需要恢复数据库。
- 数据库安全：本 PR 无数据迁移、无 `PRAGMA user_version` 变化、无 ledger 形状变化（#595 已定）；测试数据库都在 `mkdtemp` 临时目录，失败不触碰用户库。已安装的旧 tarball 与新 tarball 的 ABI/布局一致，回滚=重装上一个 tarball，不需库备份恢复；若真遇到不兼容库，沿用 `docs/product/demo-install.md#database-recovery` 的备份/重建路径（本 PR 不改文案语义）。
- 回滚顺序：先 revert Batch 4（文档）→ Batch 3（证据测试）→ Batch 2（资产）→ Batch 1（红测试）→ 删分支/worktree；每步后可重跑对应窄测试确认回到已知良好状态。已知良好锚点 = Batch 0 gate 全绿的 #595 head。
- 不做破坏性操作：不 `push --force`（新分支）；不删除 worktree 之外的目录；不在仓库内写运行态文件（证据放 PR/`.superpowers/`）。

## Interfaces and Dependencies

1. **#595 契约（阻塞前提）**：`packages/storage/sqlite/src/migrations.ts` 导出 `MIGRATIONS` 与 `BASELINE_VERSION`；`migrate()` 单 baseline ledger；build/artifact/demo/plugin-migrations 从 inventory 派生；受影响测试在 #595 head 全绿（见 Batch 0）。不满足时本计划不启动，回报 lead 对齐 #595。
2. **Storage 公共面不变**：`createSqliteStorage(path, policy?, { migrationsDir? })`、`migrate(db, { entries?, dir? })`、`MIGRATIONS_DIR`、`migrationPath`、`readMigrationSql`、`CURRENT_SCHEMA_GENERATION` 的签名/语义除 inventory 长度外保持不变；`packages/storage/sqlite/src/index.ts` 的导出面不变。
3. **Packaging 面不变**：`apps/harness-plugin/scripts/build.mjs` 的 `build({ outDir })` 返回 `{ packageDir, manifest, metafiles }`；manifest `files`/`exports`/peer/properties 形状不变；迁移文件仍是 `migrations/<file>` 相对路径。
4. **Host 面不变**：`apps/harness-plugin/src/host.ts` 的打包目录探测与源码回落顺序不变；本 PR 不改 Host ABI、不扩 Loader external、不新增依赖。
5. **工具与门禁**：Node 26（`.nvmrc`）运行测试与 TS 导入；pnpm 脚本 `test:file`/`verify`/`typecheck`；CI 唯一必需检查 `PR Fast Gate`（verify + browser 汇总）；本 PR 不改 workflow，也不需要 Windows 原生 lane（本变更平台无关，win32 上 packed Host 用例的既有 skip 不算资格证据）。
6. **公开面**：draft PR base = `refactor/storage-logical-baseline`，标题/正文英文，`Closes #596`、`Refs #417`；PR 描述含闭环、批次、真实验证输出、风险、回滚；看板 `Status` 不写；合并由人类执行。

## Outcomes & Retrospective

2026-11-17 实现完成（PR #659，base `refactor/storage-logical-baseline` @ `5e7db487`；实现 head `121a313f`、文档收口 `f61b5f66`；最终 head 以 PR 回读为准）。实际结果：

- **资产**：`packages/storage/sqlite/migrations/` 只剩 `001_init.sql` 375 行；`MIGRATIONS = ['001_init.sql']`，`BASELINE_VERSION` 仍为 1，`CURRENT_SCHEMA_GENERATION` 仍为 6（D2 实测支持）。002–007 与 005 注释占位已删除，逐字拼接由脚本校验（五段原文各在合并结果中出现 1 次）。
- **schema 对等（一次性证据，未写入源码快照）**：`schema_identical: true objects: 31`；`integrity: ok fk: 0`。变异证据：把 `status_policy` 的 `CHECK` 改动一个字符后同一脚本输出 `schema_identical: false` 并 exit 1，还原后复跑通过——该证据不是恒绿。
- **packed Host**：`harness-plugin-artifact` 真实安装并 `import()` 后建库，`PRAGMA integrity_check=ok`、`foreign_key_check` 为空、`schema_migrations` 恰好一行；重载同一 artifact 再开同一库仍是一行（二次 open 零迁移）；31 个用例全绿。
- **归档面**：`pnpm --filter @harness-projects/app-harness-plugin pack:plugin` 产出的 tarball 恰好 6 个文件（`package/{LICENSE,cordis.patch.yml,lib/client.js,lib/index.js,migrations/001_init.sql,package.json}`），其中 migration 字节与源资产 `cmp` 相同；真实 tarball 审计 14 个用例全绿，含缺失/多余/篡改 migration 三个负控（目标名由共享 inventory 派生，不回显注入值）。
- **体积**：`node scripts/rule-checks.mjs size origin/refactor/storage-logical-baseline` → 代码 **799** / 1000（本任务上限 800）、文档 383 / 1500（本任务上限 1300）。与估算 782–799 的上沿一致；SQL 位移 745（+371/−2 与 −372）、admission 夹具重建 14、inventory 13、其余测试 27。
- **偏差与遗留**：①`storage-baseline-admission` 的旧库夹具必须语义等价重建（D13），这是设计期未预见的 6 红，已由 lead 裁决归 #596；②#595 head 在实现期前进两个提交，PR 判定基线随之更新；③`Refs #417` 热度项（历史文档中的旧文件名、`user_version` 物理世代收口）仍需 #417/#223 处理，本 PR 不声称关闭；④未 ready、未合并，交人类评审。

## Bottom Change Note

- 2026-11-17：创建本计划。合并三路独立设计（系统/架构、安全/失败路径、产品/验证）后选唯一方案：原地合并进 `001_init.sql`、保留文件名、删 002–007 与 005 注释、不 bump 世代；新增 #595 契约硬门、schema 文本对等证据、三个负控、精确 diff 估算（745 SQL + 约 40 其余 = 782–799）与超限兜底。Decision Log D1–D12 记录全部取舍；未决项见 Open Questions。
- 2026-11-17：实现完成。Batch 0 gate 在 `ee384266` 全绿后 rebase 开工；Batch 1 四处先红（`creates=1`、无出处 token、两处字面量守卫），Batch 2 合并资产并收口 inventory（schema 对等 31 对象、`integrity=ok`），Batch 3 用真实 packed Host 与真实 tarball 补 integrity/FK/二次 open 与缺失/多余/篡改负控。实际 799 代码行（≤800）、383 文档行（≤1300），未改 `migrate.ts`/`storage.ts`/`host.ts`/`build.mjs`、未加依赖或抽象、未 bump 世代。唯一计划外改动是按 D13 重建 admission 夹具（lead 已裁决归 #596）。
- 2026-11-17（归档）：独立验收记录 `docs/review/pr-659-mmp-review.md`；计划移入 `docs/exec-plan/completed/` 并更新 `docs/README.md`、`docs/review/README.md` 索引；订正状态行与 Batch 1 提交号（`7994614e`），补记 `docs/README.md` 为改动文件集；`docs/product/demo-install.md` 恢复段安装文件计数 12→6 与 manifest/packed 实测对齐。评审 P3 处置：D13 夹具现实性、005 退役注释、ADR 旧文件名指针、陈旧断言消息均为后续项（测试/注释改动会突破本任务 799/800 预算，不在本 PR 扩面）。产品/测试/SQL 字节不变。
