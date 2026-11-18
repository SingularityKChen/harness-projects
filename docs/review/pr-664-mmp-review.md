# PR #664 MMP 交付评审

评审日期：2026-11-18。目标：收口已合并 PR #656–#659 的非阻塞评审遗留（umbrella #663；#662 悬空 reparse；#660 入口 fail-closed 子项；storage 夹具/文档；apps→storage 构建边）。锁定首审 head `78233077`、base `main@3b1c5f44`；执行上下文：`.worktrees/mmp-review-followup`。评审账号 `Singularity-AI-Bot`（review 5950132510），开发/提交/合并账号 `SingularityKChen`。评审方法：4 路独立子评审（Windows 安全、CI 门禁、storage/边界、产品/issue）+ 根代理独立复核；路由与判定使用 Superpowers、Qian Systems Router、First Principles Development。

## 结论

首审 **APPROVE WITH NOTES（P2 × 5、P3 × 10，无 P0/P1）**，不阻塞 MMP 交付；行级意见已一次性提交为一份 review，未因首个 P2 收工。按仓库流程完成修复与独立复评：交付提交 `b41ae86f`（Windows reparse）、`ffe8c562`（lane marker）、`4e436016`（storage/文档）、`d93c1cc8`（包边界）与包含本记录的 docs 归档提交。范围边界：#647 人验、R1、#660 其余子项、#313 Node 契约保持独立。

## 锁定事实与边界

- 首审 head `78233077`（远端回读一致，worktree clean）；base `main@3b1c5f44`；16 files +318/−21；size code 180/1000、docs 159/1500。
- checks：12 pass；唯一 FAIL 为非必需 `Create review session`（本地评审端点 404，`PR Fast Gate` pass）；`mergeStateStatus=UNSTABLE` 只源于它。首审前 reviews/comments/threads 均为空。
- 4 个提交作者/提交者均为 `26040964+SingularityKChen@users.noreply.github.com`；disclosure、diff-check、workflow-check 通过。
- `closingIssuesReferences=[#662,#663]`；#660/#313/#647/#642/R1 保持 OPEN，未被本 PR 误导关闭。

## 风险矩阵（P0–P3）

| 级别 | 代码 | 产品闭环 | 架构/测试 | 工作项 | 结论 |
|---|---|---|---|---|---|
| P0 | 未发现新的树外写入路径 | 不改 Host ABI/固定文案/发布面 | 无 lane/边界假绿 | 无撤销 issue 关系 | 无 |
| P1 | 无 | 无 | 无 | 无 | 无 |
| P2 | 原生 reparse 回归只覆盖文件对象、无法判别两条机制；目录分支（root/worktrees/digest）无负控 | 旧 tgz 的「6 件/单份 migrations」与保留的折叠前旧包 12 件矛盾 | marker fail-closed 无负控、契约只验文本；gate/boundary 规则变更与产品修复同 PR | 标题「remaining」大于 #663 子集；#662/#663 验收 checkbox 未记录 | 5 项，非阻塞 |
| P3 | 架构门 env vs Design；probe→create 与准入后残余未登记；新文件 minTests=1 | ExecPlan 与最终 head 不一致；001 头部指针只覆盖一半；connector 编号散文残留 | marker 的 files=3 与 SETS 硬耦合；package-boundaries 只覆盖静态 import | body 未披露 advisory FAIL；ADR 指针等残余无 issue 追踪 | 10 项，非阻塞 |

## 分层证据（首审）

1. **代码/安全**：`CreateFileW` 加 `FILE_FLAG_OPEN_REPARSE_POINT`、目录 `ProbeChecked` 先探测、adopt 仍走既有 `Open`；IL 常量（35651584 / 2097280）、错误码映射（2→create；3/5/32→有界拒绝；183/80→Open）、错误 token 白名单与固定文案均正确；probe 句柄即时关闭。未发现可导致树外写入的创建路径回退。
2. **门禁**：两个入口捕获 runner 输出并断言 marker；`native-git` 同时检查 `$LASTEXITCODE`，`private-data` 在 marker 缺失时把 `$nativeExit` 置 1 并 exit。首审发现契约只做文本包含：`-notmatch` 反向、`exit 1`→0、`$nativeExit = 1`→0 三种变异均存活。
3. **产品/issue**：#663 的 7 项均有实现；#662 第 1、3 条成立、第 2 条部分；#660 仅 fail-closed 子项、`Refs #660` 正确；未发现重复追踪 issue，但 #659 P3-5（ADR 指针）等残余无追踪。
4. **测试/反例**：storage fixture 现写真实 generation 6 且截断守卫有效；`trustedAcl` 收紧；package-boundaries 只解析字面量 import（`createRequire` 实测未覆盖）；contract marker 变异见上；本机 `pnpm verify` 因离线 store 缺 `@deepseek-ai/dsh-client-connection` 失败（环境性，hosted Verify 在 head 上 pass）。
5. **架构**：apps→storage 构建边已登记，未新增反向依赖、第二权威源或 workflow 数量。
6. **发布面**：commit author 为 noreply；无凭据/本机路径；advisory FAIL 未披露（P3）。

## 首审意见与处置

| # | 级别 | 位置 | 首审意见 | 处置 |
|---|---|---|---|---|
| 1 | P2 | `.github/workflows/ci.yml:127` | marker 断言无负控、契约不约束失败方向 | `ffe8c562`：hosted 负控 A/B + 契约断言失败分支 |
| 2 | P3 | `tests/contract/ci-windows-workflow.test.js:72` | `files=3` 硬编码、SETS 变更本地全绿 | `ffe8c562`：`markerFor(setId)` 从 SETS 推导 files/skipped |
| 3 | P2 | `tests/integration/harness-plugin-windows-reparse.test.js:29` | 只测文件、不判别机制、目录/正向覆盖缺失 | `b41ae86f`：补 root dangling junction 负控 + adoption-after-release；flag 记为 defense-in-depth |
| 4 | P3 | `scripts/windows-native-checks.mjs:52` | 新文件 minTests=1 | `b41ae86f`：minTests=4 |
| 5 | P3 | `apps/harness-plugin/src/host-private-windows.ts:22` | env 架构门与 Design 不一致、可伪造/缺失 | `b41ae86f`：Decision Log D7 记录理由，lane 只声明 AMD64 正控 |
| 6 | P3 | ExecPlan `:5` | z64 笔误、Design/Progress/Outcomes 与最终 head 不一致 | `this docs commit`：计划校正 + Batch 5 Progress |
| 7 | P3 | ExecPlan `:141` | probe→create 与准入后残余未登记 | `this docs commit`：收窄措辞并写入残余 |
| 8 | P2 | `docs/development/backup-rollback.md:108` | 旧 tgz 写死 6 件，折叠前旧包 12 件 | `4e436016`：按匹配包代际写实际条目；同步 demo-install |
| 9 | P3 | `tests/integration/storage-baseline-admission.test.js:73` | 注释「1..7 行 + gen6」与夹具不符 | `4e436016`：按 7 行真实旧库 / 2/4 行合成 / 1 行截断改写 |
| 10 | P3 | `packages/storage/sqlite/migrations/001_init.sql:3` | 003 指针只覆盖新版本，缺已提交版本拒绝 | `4e436016`：指针补 `LEGACY_COMMITTED_VERSION_MESSAGE` |
| 11 | P3 | `tests/contract/package-boundaries.test.js:384` | 只覆盖静态 import（createRequire 漏检） | `d93c1cc8`：测试注释写明静态可见边边界 |
| 12 | P2 | PR 级 | gate/boundary 规则变更与产品修复同 PR | `this docs commit`：Decision Log D6 记录 #663/人类授权与独立提交边界 |
| 13 | P2 | PR 级 | 标题/首段 overclaim、#662/#663 checkbox 未记录、ADR 残余无追踪 | 收尾：标题/body 收窄、issue 验收评论与勾选、#665/#666 跟进 |
| 14 | P3 | PR 级 | body 未披露 `Create review session` advisory FAIL | 收尾：PR body 补一行 |
| 15 | P3 | `tests/integration/storage-connector-account.test.js` | 003–005 编号散文残留 | `4e436016`：改为「任何待应用迁移」语义 |

## 修复证据与独立复评（2026-11-18）

- 修复/交付提交：`b41ae86f`、`ffe8c562`、`4e436016`、`d93c1cc8` 与 docs 归档提交；修复本身经 4 位原评审子代理独立复评，均无新 P0/P1。
- 本地：contract 27/27、integration 192/192、boundaries 10/10、`pnpm typecheck` exit 0、workflow-check no findings、disclosure 通过、diff-check 干净；size 与最终 head 由 `gh pr checks` 回读（本机 `pnpm verify` 因离线 store 缺包为环境性失败，hosted `Verify` 在修复 head 上 pass）。
- hosted 修复 head `cf949b5b`：PR run `44227062981` 中 Verify 2m22s、Windows Native 4m9s（新目录 reparse 子用例通过）、Browser 2m40s、`PR Fast Gate` 全部 pass；Windows 日志 `native-git files=3 tests=22`、`private-data files=3 tests=78 skipped=0`、两入口 marker。
- hosted marker 负控 A（native-git 入口跳过 main）：scratch ref `test/neg-664-native-git-1794970778`（commit `49b38d85`），run `44227227371`：`Windows Native`/`PR Fast Gate` failure、`Verify`/`Browser` success；日志 `::error::windows-native-checks: set=native-git 缺少或不符合通过标记` + exit 1。
- hosted marker 负控 B（private-data 正常执行后抑制 marker）：scratch ref `test/neg-664-private-data-suppressed-1794972130`（commit `ad67e90a`），run `44229943037`：`Windows Native`/`PR Fast Gate` failure、`Verify`/`Browser` success；日志 `::error::windows-native-checks: set=private-data 缺少或不符合通过标记` + `standard-user exit=1`。两个 scratch ref 已删除。
- 反例/变异：修复后 contract 变异 A/B/C 全部判红（C 以“把错误分支赋值改成 0”实测 3 pass/1 fail，文件已还原）；SETS 增加文件时契约期望随动（本地即红）；package-boundaries 仍只覆盖静态可见 import（已在注释声明并留 #665 外）。
- 复评结论：storage 5/5 关闭；windows P2 关闭、两处新 P3 已修；ci F1a/F2 关闭并补 clean private-data 负控与 C 变异；product 无新 P0/P1，收尾项转入最终 head。
- 残余（不阻塞）：目录 probe→create 竞争与准入后 log/SQLite 跟随 reparse 由 #665 追踪；单资产折叠后失效的 ADR 指针由 #666 追踪；#647 人验/R1 独立。

## 最终 head 与归档

- 最终 head 为包含本记录与归档计划的 docs 提交之后的可合并 head；`PR Fast Gate`/Verify/Browser/Windows Native 以 `gh pr checks 664` 回读为准，`Create review session` 是非必需 advisory（本地评审端点 404）。
- 归档：本记录、`docs/exec-plan/completed/2026-11-18-pr656-pr659-review-followup.md`、`docs/README.md` 索引随 PR 合并；#662/#663 由 `Closes` 关闭，issue 验收证据在合并前回写。
