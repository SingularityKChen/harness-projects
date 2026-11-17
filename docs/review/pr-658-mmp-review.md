# PR #658 MMP 交付评审

评审日期：2026-11-17。目标：空库初始化只记录单一 baseline 版本、运行时/构建/packed artifact 共用唯一 SQL inventory；关联 #595。锁定 head `5e7db48791a39ab9d167b00074f8f1675dbc6a14`，base `ddb94c9440815626a3932dcaf050653f70eedb18`（`main`）。执行上下文：检出本 PR 分支的 `.worktrees/storage-logical-baseline`。独立评审未修改产品/测试/ExecPlan/commit，未写 GitHub；本记录随 PR 合并。

结论：**首审 APPROVE WITH NOTES（P3×4，无 P0/P1/P2）**。该结论只覆盖 Storage 逻辑基线闭环；#596 的物理单资产、#417/#223 的父项接受、R1 发布接受保持独立。

## 锁定事实与边界

- 远端回读 head/base 与上述值一致；`isDraft=false`、`mergeable=MERGEABLE`、`mergeStateStatus=UNSTABLE`（唯一红为非必需 `Create review session`）、`closingIssuesReferences=[#595]`、reviews/comments/threads 为空。
- 规模：17 files +542/−172；`rule-checks size main` 代码 343/1000、文档 371/1500；ExecPlan 声明的 4 生产 + 10 测试 + 3 文档文件集与实际一致；`.github/workflows`、`scripts/workflow-check.mjs`、`package.json`、`pnpm-lock.yaml`、SQL 资产、`tests/contract`、`tests/e2e` 均零 diff。
- 精确 head `5e7db487` 的 `CI` run `44018102213`：Verify（job `133820784914`）、Browser（`133820784534`）、`PR Fast Gate`（`133821993746`）均 pass；被并发取消的 Rule checks 在同一 head 的 run `44023487427` 中有成功的 PR size / Disclosure scan / Resolve PR base。
- 提交序列 6 个（`7a4cf5db`、`c18a912f`、`9558d4d7`、`ee384266`、`f92c413c`、`5e7db487`），标题符合 Conventional Commits，正文含 `Refs #595`，无 debug/fixup。
- **证据环境说明**：首次 `pnpm verify` 期间工作树被外部并发进程短暂改写（`migrations.ts` 少一项 `007`），该轮结果作废；随后工作树恢复干净，改用运行前后 HEAD + 4 个关键文件 hash 指纹复核，本记录全部证据来自恢复后的干净树。这是评审环境事件，不是 PR 缺陷。

## 风险矩阵

| 级别 | 代码与反例 | 产品闭环与架构 | 测试与工作项 | 结果 |
|---|---|---|---|---|
| P0 | 旧库被自动改写、数据损坏、第二 schema 权威 | 七条不变量、Host 权威、备份/重建路径 | 真实旧库/新库/打包件 | 无；旧/未知库 `version_list`/`generation`/`unknown_objects`/`schema_shape` 拒绝且零写入 |
| P1 | 单事务被拆、重开写初始化、inventory 漏项、packed 字节不一致 | 真实 Host 首启/重开/打包 | 独立 probe 56/56 + 变异 | 无；单行账本、重开零写、字节一致 |
| P2 | — | — | — | 无 |
| P3 | F2 build 脚本 Node 下限与 engines；F3 boundaries 不含 scripts | F1 005 注释过期；F4 PR 正文/计划状态陈旧 | 真实验证覆盖 | 4 项，均非阻塞 |

## 分层证据与结论

1. **单事务单基线**：`migrate.ts` 在既有 `BEGIN IMMEDIATE` 内执行全部资产后只写一行 `schema_migrations`（integer `1`）；独立 probe（不复用仓库测试）确认空库 `user_version=6`、24 张用户表、`integrity_check=ok`、空 `foreign_key_check`；第二次 `migrate` 与 factory 重开返回 `applied=[]/version=1`，schema 与文件 SHA-256 不变，WAL 连接 `total_changes()=0`。
2. **唯一 inventory**：`MIGRATIONS` 是唯一 SQL 资产清单；生产侧只有 `storage.ts` 一处 opener 调用 `migrate`；`build.mjs` 与 3 个 packed/artifact 测试全部派生自 inventory；静态守卫限定 `.sql` 字面量只存在于 `migrations.ts`。
3. **fail closed 准入**：旧「完整 shape + 1..7 行账本 + 世代 6」经 `migrate` 与 `createSqliteStorage` 均 `incompatible_database/version_list`，`back_up_and_rebuild` 文案与恢复锚点未改；世代 5 → `generation`；未知对象 → `unknown_objects`；缺列 → `schema_shape`；拒绝前后逻辑快照与文件 hash 不变。
4. **回滚与事务**：坏资产 SQL、事务中途注入、账本 INSERT 后注入三类失败均整体回滚（0 表/0 账本/`user_version=0`，同库可重试成功）。
5. **packed Host**：真实 `pnpm pack` 产物解包后按包名 import，默认目录解析到包内 migrations，建库单行账本；二次 open 仍单行；缺失/多余/篡改资产负控保留且不回显注入值。
6. **issue #595 验收**：四条验收标准全部满足；`CURRENT_SCHEMA_GENERATION` 保持 6（无 DDL 变更，D2）；`#417/#223` 保持 OPEN，本 PR 不宣称父项关闭。

## 首审意见

### P3-1（唯一实质内容缺口）005 资产注释成为假事实

`packages/storage/sqlite/migrations/005_source_version_carrier.sql:4` 写「清单与 `schema_migrations` 继续保留版本 5」，在本 PR 后账本只有 `[1]`，该句为假；`migrations.ts` 中「005 保留历史版本位置」同样不准确。因本 PR 自设「SQL 目录零 diff」不变量，本记录把它登记为 #596 物理折叠时的必办事项，不在本 PR 破坏不变量。

### P3-2 构建脚本 Node 下限与 `engines` 不一致

`apps/harness-plugin/scripts/build.mjs` 新增裸包名 import（连带 `node:sqlite` 与 type stripping），实际要求 Node ≥22.18 左右，而根 `package.json` 仍声明 `>=22.0.0`。CI 使用 `.nvmrc=26` 不受影响，ExecPlan 已记录；建议归入后续运行时契约项（#313 或独立 issue）。

### P3-3 依赖边界契约未覆盖 `apps/*/scripts/*.mjs`

`tests/contract/package-boundaries.test.js` 只收集 `<pkg>/src/**/*.{ts,tsx,mts,cts}`，因此 `build.mjs` 新增的 `apps → packages` 边不在 9/9 boundaries 约束内（方向本身合法）。建议后续把 scripts 纳入契约或注明豁免理由。

### P3-4 PR 正文与计划状态陈旧

PR 正文末段仍写「stays Draft」，且「PR checks all pass」与 `Create review session` 环境性红不符；计划「交付」一节写「整理为 3 个可独立审阅的提交」，实际为 4 个。计划侧已在本归档提交订正，PR 正文在合并前同步更新。

## 实际执行与结果

所有命令在 `.worktrees/storage-logical-baseline` 根执行（干净树，运行前后 hash 指纹一致）。

| 命令 | 观察到的结果 |
|---|---|
| `pnpm verify` | exit 0：typecheck 通过；contract 1603/1603；integration 2311 run / 2294 pass / 17 skipped / 0 fail；e2e 226/226 |
| `pnpm run boundaries` | 9 pass / 0 fail |
| 定向 `migration-runner` + `storage-baseline-admission` + `identity-membership-schema` | 188 tests / 188 pass / 0 fail |
| 独立 probe `/tmp`（56/56 PASS） | 单行账本、重开零写、旧库/世代/未知对象/缺列拒绝、三类失败回滚 |
| `rule-checks size/disclosure main` | 343/1000、371/1500；disclosure exit 0 |
| `git diff --check main...HEAD` | exit 0 |
| `gh pr checks 658 --required` | exit 0（PR Fast Gate pass） |

## 残余风险 / 未验证项

- 未复跑作者自述的 M1–M5 变异计数，改用独立 probe + 断言审读佐证，未发现冲突。
- 未在 Windows / 真实 Desktop 宿主人工验收（本 PR 未声称）；packed artifact 用例对 win32 有既有 skip。
- inventory 漏项不再由 inventory 自检兜底（D5 刻意不扫描目录），依赖下游字面 schema 断言与 packed 字节比对。
- 仓库测试直接 import 包源码，并发写同一工作树会污染验证（本次实测）；属测试架构既有属性。
- `#554` 证据门、`#417/#223` 父项与 R1 保持 OPEN，不由本 PR 关闭。

## 归档说明

本次归档 docs-only 提交把计划移入 `docs/exec-plan/completed/`、更新两处索引、订正计划内「3 个提交」为 4 个，并登记 P3-1 的 #596 交接与 P3-2/P3-3 后续项；产品/测试字节不变，因此代码 head `5e7db487` 的评审证据继续有效，最终 head 的 `PR Fast Gate` 以 `gh pr checks` 回读为准。合并后 #659 需 retarget/rebase 到新 main。

## 跨 PR 集成修复（2026-11-17，hosted Windows lane 发现）

#657 合并后 Windows lane 首次执行 `tests/integration/harness-plugin-windows-private-data.test.js`：本 PR 把 `schema_migrations` 从 1–7 多行账本收敛为单一 baseline 版本 1，而该原生用例仍断言「迁移 1–7」，Windows lane 失败（该文件在 darwin/Linux 按平台 skip，本地 `pnpm verify` 看不到）。修复提交 `ad552e1e` 把首启断言改为 `[1]`、重开断言改为单行账本；这是评审后的测试适配，产品语义不变，最终 head 由 Windows lane 重新取证。
