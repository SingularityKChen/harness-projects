# PR #659 MMP 交付评审

评审日期：2026-11-17。目标：把 001–007 七个 SQL 片段折叠为单一自包含基线资产，并让 runtime inventory、build manifest、安装件字节与 artifact/demo 负控经 #595 的共享 inventory 保持一致；关联 #596。锁定 head `f4b692b31fd6d0ccf9f50be6442fe3402a146cfc`，diff base `5e7db48791a39ab9d167b00074f8f1675dbc6a14`（stacked base `refactor/storage-logical-baseline`）。执行上下文：检出本 PR 分支的 `.worktrees/storage-single-asset`。独立评审未修改产品/测试/ExecPlan/commit，未写 GitHub；本记录随 PR 合并。

结论：**首审 APPROVE WITH NOTES（P3×8，无 P0/P1/P2）**。该结论只覆盖物理单资产闭环；#658 必须先合并、本 PR 需 retarget/rebase 后重取门禁；#417/#223 父项与 R1 发布接受保持独立。

## 锁定事实与边界

- 远端回读 head/base 与上述值一致；`isDraft=false`、`mergeable=MERGEABLE`、`mergeStateStatus=UNSTABLE`（唯一红为非必需 `Create review session`）、`closingIssuesReferences=[]`（stacked PR，retarget 到 `main` 后解析 `Closes #596`）。
- 规模：17 files +778/−404；`rule-checks size` 代码 **799/1000**（本任务自设 800，余量 1 行）、文档 383/1500；SQL 搬移按全额计（新资产 +371/−2、删除六文件 −372、inventory 13、测试/夹具 41）。
- 精确 head `f4b692b3` 的 CI run `44020973405` success：Verify（job `133830129975`）、Browser（`133830130362`）、`PR Fast Gate`（`133831324621`）；`Create review session` 为本地端点 404 的环境性红。
- `CURRENT_SCHEMA_GENERATION` 保持 6、`BASELINE_VERSION` 保持 1；本 PR 未改 `build.mjs`/`migrate.ts`/`storage.ts`/`host.ts`/`.github/**`。

## 风险矩阵

| 级别 | 代码与反例 | 产品闭环与架构 | 测试与工作项 | 结果 |
|---|---|---|---|---|
| P0 | SQL 语义丢失/改写、旧库被误接受、数据损坏 | 单一 schema 权威、事务边界、恢复路径 | 逐行语义对等与真实 packed Host | 无；31 对象 `sqlite_schema.sql` 逐字相同，无 DML/PRAGMA/TRIGGER 丢失 |
| P1 | 资产/inventory/安装件字节不一致、负控被删、旧库拒绝失效 | 真实 Host 建库/重开/拒绝 | 红先行、字面量守卫与三负控 | 无；tarball 恰 6 文件且字节相同，旧 7 行账本仍拒绝且零写入 |
| P2 | — | — | — | 无 |
| P3 | 断言/诊断散文陈旧、ADR 指针失效 | F1 计划易失事实；F8 文件集漏项 | F3 夹具现实性下降；F5 005 退役语义保留不完整 | 8 项，均非阻塞 |

## 分层证据与结论

1. **SQL 语义等价（最重要）**：独立程序化对比（旧 002–007 原文 vs 新 `001_init.sql`）显示 31/31 对象、`sqlite_schema.sql` 逐字相同；列/外键/索引列表 diff=0；`integrity_check=ok`、`foreign_key_check` 为空。002/003/004/006/007 逐字各出现 1 次且按原序，004 的 2 条 `ALTER` 原位保留；资产内 0 条 DML/PRAGMA/TRIGGER/事务控制（旧片段同为 0），事务边界仍在 `migrate.ts`。
2. **变异控制**：修改 `status_policy` CHECK、删表、删 VIEW、删 UNIQUE INDEX、翻 ON DELETE 五个变异，独立对比脚本 5/5 判为 DIFFERENT（对比非恒绿）。
3. **inventory 与安装件**：`MIGRATIONS=['001_init.sql']`；`git grep` 旧片段名只剩资产内出处注释与 `migration-runner` 的临时探针 `002_next.sql`；真实 `pnpm pack` tarball 恰 6 个文件且 migration 字节与源资产 `cmp` 相同；缺失/多余/篡改三负控仍失败且不回显注入值。
4. **真实 packed Host**：构建→安装 node_modules→`import()`，建库 `PRAGMA integrity_check=ok`、空 `foreign_key_check`、恰一行 `schema_migrations`，二次 open 仍单行（零重迁移）。
5. **测试判别力**：Batch 1 在 7 资产 inventory 上按设计先红（`creates=1`、无出处 token、两处 `['001_init.sql']` 字面量守卫），说明期望不是从实现派生；6 个测试文件的断言数未减少（61→61、56→56、6→7、114→117、36→37、43→43），新增 2 个显式负控。
6. **issue #596 验收**：四条验收标准全部满足；无 SQL 压缩、无删判别测试；#658 逻辑基线语义未被物理合并破坏（单事务、单账本行、单 inventory、重开零写）。

## 首审意见

### P3-1 计划易失事实陈旧

`docs/exec-plan/active/2026-11-17-storage-single-asset.md:3` 写「未 ready」而实际已 ready；Batch 1 提交写 `6bd97f99`（rebase 前对象，实际 `7994614e`）；未含最终 head `f4b692b3`。已在本归档提交订正并改为回读式表述。

### P3-2 切片描述与实现不符

计划 D5 称从 `-- workspace：` 切到 `-- repository：`，实测 `identity-membership-schema.test.js:87` 从文件开头切到 `-- repository：`（含 `schema_migrations`，15 个 CREATE；从 `-- workspace：` 起则 14）。功能正确，仅文档措辞需统一；本归档提交保留原实现并记录该差异。

### P3-3 D13 夹具可重建性下降

`storage-baseline-admission.test.js:18-22` 对 fragments=4/2 改用「完整 shape + N 行账本」，同一函数对 fragments=1 已有按注释切片，说明 2/4 片段同样可精确重建。现用例不再是真实旧库形状，但 `version_list` 期望与零写入断言未变、用例名/期望 reason 与 base 一致，判别力仍在。代码/测试改动会突破本任务 799/800 预算，登记为后续项。

### P3-4 005 退役语义保留不完整

issue 要求「Preserve useful semantic comments」；005 的 4 行只并成头注释 1 行，其中「写入期拒绝非规范的新版本与已提交版本」在资产中无对应文字（仅存于 `storage-sync.ts:66`）。建议后续补注释或确认归 #417。

### P3-5 历史 ADR 指针失效

`docs/adr/ADR-0002-…md:12` 指向已删除的 `003_control_facts.sql`；按 D8 有意保留历史原文。建议后续按 ADR 规则就地追加一行注记，不重写历史。

### P3-6 陈旧断言消息

`tests/integration/execution-relation-write-schema.test.js:67` 消息仍写「003 里没有任何可解析的出处 token」，实际已读整份单资产。属测试文案，后续修正。

### P3-7 PR 正文口径

「Stacked on #595」混淆 issue #595 与 base PR **#658**；「`gh pr checks` exit 0 / 8/8 pass」在最终 head 上不成立（`Create review session` 环境性红，仓库 8 项门禁全 pass）。合并前更新正文。

### P3-8 计划文件集合漏列 `docs/README.md`

Global Constraints 自称「唯一一次声明」的写集漏了实际被修改的 `docs/README.md`（新增计划要求更新索引）。已在本归档提交补入。

## 实际执行与结果

所有命令在 `.worktrees/storage-single-asset` 根执行。

| 命令 | 观察到的结果 |
|---|---|
| 独立语义对比（node:sqlite，旧链 vs 新资产） | 31/31 对象、`sqlite_schema.sql` 逐字相同；列/外键/索引 diff=0；`integrity=ok`、`fk=0` |
| 变异控制 | 5/5 判为 DIFFERENT（对比非恒绿） |
| 语句审计 | 24 CREATE TABLE + 6 CREATE UNIQUE INDEX + 1 CREATE VIEW + 2 ALTER；0 DML/PRAGMA/TRIGGER |
| `pnpm verify` | exit 0（contract + integration + e2e） |
| `pnpm run boundaries` | 9 pass / 0 fail |
| 定向 4 suites（runner/admission/plugin-migrations/artifact） | 200 tests / fail 0；identity-membership + execution-relation 36/36；demo-artifact 14/14 |
| 独立 fresh DB（真实 `migrate()`） | applied=[1]、ledger=[1]、integrity=ok、fk=0、user_version=6、31 对象；二次 open applied=[] 且 schema 不变 |
| 旧 main 7 行账本库 | `IncompatibleDatabaseError/version_list`，文件字节不变 |
| `rule-checks size/disclosure 5e7db487` | 799/383；机械扫描通过 |
| `gh pr checks 659` | 仓库 8 项门禁 pass，仅 `Create review session` 环境性红 |

## 残余风险 / 未验证项

- 代码 799 距本任务自设 800 仅 1 行，后续任何代码增行需先回 #658 或另取预算裁决（PR 正文已声明）。
- Browser lane 只回读 hosted 结果，未本地重跑；Windows 行为不受本 PR 影响。
- 历史文档/ADR 中旧文件名按 D8 有意保留；仓库没有文档链接门禁，属已知遗留。
- #658 若在合并前再前进，本 PR 增量基线失效，必须重新 rebase 并重读 diff/checks。

## 归档说明

本次归档 docs-only 提交把计划移入 `docs/exec-plan/completed/`、更新两处索引、订正 P3-1/P3-8 与 `docs/product/demo-install.md` 恢复段的安装文件计数（12→6，与 manifest/packed 实测一致），并记录其余 P3 的后续处置；产品/测试/SQL 字节不变，因此代码 head `f4b692b3` 的评审证据继续有效，最终 head 的 `PR Fast Gate` 以 `gh pr checks` 回读为准。合并顺序：先 #658，再 retarget/rebase 本 PR 到新 main 并重跑门禁。
