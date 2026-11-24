# PR #676 MMP 验收处置记录（issue #368 · provider unbind）

## 锁定事实

- 日期：2026-11-24。
- PR：#676（实现期历史 draft，Superseded by 下方本轮 MMP 评审）；base：`main` / `c24d1491`（验收时 `origin/main` 回读同值）；验收对象 head：`034867e3`（`git rev-parse HEAD` 实测；独立验收开始时本地分支 ahead 4，远端 head 仍是 Batch 1 文档提交 `e126058a`）。处置提交随后使本地 head 前移，最终 head 以 `git rev-parse HEAD` 回读为准（本记录不内联自身提交 hash）。
- 执行上下文：`.worktrees/iteration12-provider-unbind`，分支 `feature/provider-unbind-20261124`。独立验收为只读：不改 tracked 文件、不提交、不 push、不写 issue/PR/Project 字段；本记录的提交与计划回填由验收负责人在同一隔离工作树完成，root 主检出与 `main` 未改动。
- 证据边界：本轮是**独立 agent 对抗验收**——非 PR 作者、非 root 主检出，只读验收；原报告 `.superpowers/iteration12/368/verification-1.md` 是运行态证据、未入库。它**不等于人类评审、R1/UAT、平台资格或安装验收**；合并、ready 与 issue 关闭由人类伙伴/Lead 决定。
- 方法：完整读独立验收报告，再读 ExecPlan、`git diff main...HEAD`、`git log` 与实现/测试源码；逐条处置 P0–P3。

## 范围

issue #368 的交付面：工作区挂载的显式解绑（disable-not-delete，仅 Development / Delivery）与 `bindRepository` 同目标 revive；只改 core、controller 及其集成测试，无 Host wire/UI、无 Storage 端口/schema/迁移/依赖、无 `apps/` diff。验收处置轮只新增一条覆盖测试（AC5-368）与文档/证据，不改生产行为。

## P0–P3 矩阵

| 等级 | 结论 | 处置 |
|---|---|---|
| P0（阻塞） | 无 | — |
| P1（高） | 无 | — |
| P2（中） | 无已证实缺陷 | — |
| P3（低/建议） | 7 条，均为测试覆盖、证据自包含与过程一致性，不是功能缺陷 | 6 修（P3-01、03、04、05、06、07）；1 条显式不修（P3-02，理由见下） |

独立验收结论为 `PASS`：V1–V7 与 M1–M8 独立重跑与实现声明一致，另 20 组计划外反例 A–J（memory/sqlite 各一遍）全部通过；未发现错误被吞成成功、不变量被破坏、第二权威源或写状态冒充 Saved 的路径。

## 逐条处置与证据

| 编号 | 原 finding | 处置 | 证据 / 落点 |
|---|---|---|---|
| P3-01 | 决策表“解绑后另一实现重绑”没有 committed 测试 | 修：新增 AC5-368 ×2 存储（V1 36→38），不改既有断言 | `tests/integration/workspace-setup-commands.test.js`；V1 `38/38`；ExecPlan D11 |
| P3-02 | 写失败整笔回滚只有计划声明、无 committed 测试 | **不修**：行为已由既有 `writeSpy(storage, failing)` 原子性模式（#376）与独立验收反例 A/J 覆盖（写失败→`invalid_input`、行仍启用/停用、快照不变、重试成功）；再加注入会重复绑定路径的原子性断言，扩测试面而非判别面 | ExecPlan D11 与 Outcomes；本记录残余风险 |
| P3-03 | M3 变异归因漏列 AC4-368 | 修：计划改为 `M3→AC1-368、AC4-368`，并说明 `killedBy` 只记录最小判别用例 | ExecPlan Surprises；本轮 M 复跑红名单两条（各 2 存储） |
| P3-04 | 计划要求末提交 `Closes #368`，实际提交为 `Refs #368` | 修计划措辞：提交统一 `Refs #368`，issue 关闭由 PR 描述正文 `Closes #368` 承担（`closingIssuesReferences` 已解析）；不改写已推送 `e126058a` | ExecPlan Global Constraints、D12 |
| P3-05 | PR 编号未记录到 Progress | 修：Batch 1/Progress 记录 PR **#676**（draft、base=main、初始 head `e126058a`） | ExecPlan Progress 与 Batch 1 |
| P3-06 | 变异 spec 不自包含（只存在于被忽略的 `.superpowers/`） | 修：M1–M8 完整 spec 内联进计划，给出复现命令与“运行态不入库”的说明；未新增未声明文件 | ExecPlan Surprises「变异 spec 自包含」、D14 |
| P3-07 | 静态 HEAD/base 写成易失事实 | 修：计划「当前状态」改为设计期观察 + `git rev-parse` / `git status` 回读命令与期望；Outcomes/记录用回读而非静态 head | ExecPlan Context、Outcomes |

## 最终验证命令与结果

命令均在 `.worktrees/iteration12-provider-unbind` 根目录、处置后最终树上运行（判定对象 `origin/main`，本轮实测 `c24d1491`）。

| 项 | 命令 | 实测 |
|---|---|---|
| V1 | `node --test --test-timeout=120000 tests/integration/workspace-setup-commands.test.js` | `ℹ tests 38 / pass 38 / fail 0`，exit 0 |
| V2 | `node --test --test-timeout=120000 tests/e2e/repository-routing.test.js` | `ℹ tests 21 / pass 21 / fail 0`，exit 0 |
| V3 | `pnpm typecheck` | exit 0，无诊断 |
| V4 | `pnpm run boundaries` | `ℹ tests 10 / pass 10 / fail 0`，exit 0 |
| V5 | `node scripts/rule-checks.mjs size origin/main` | `代码：216 / 1000 行`、`文档：420 / 1500 行`，exit 0 |
| V6 | `node scripts/rule-checks.mjs disclosure origin/main` | 机械扫描通过，无 `::error::` 命中，exit 0 |
| V7 | `git diff --check origin/main...HEAD` | 无输出，exit 0 |
| M1–M8 | `node scripts/review-mutate.mjs .superpowers/mutants-provider-unbind.json --root .` | SUMMARY 逐条 KILLED，exit 0；`workspace-setup.ts` 逐字节还原（SHA-256 前后一致）；跑完 `git status --porcelain` 为空；另按计划内联 spec 提取的副本复跑一次，同样 8/8 KILLED |
| 范围 | `git diff --name-status main...HEAD`、`git diff --stat main...HEAD` | 恰 9 个文件、无 `apps/`；生产代码只有 core/controller 与集成测试 |

未执行（由 Lead 在 push 后负责）：V8（`gh pr view --json baseRefName,headRefOid,closingIssuesReferences` 与 `gh pr diff --name-only` 回读）、V9（`gh pr checks`，含 `PR Fast Gate`）。本轮不 push、不执行 gh 写操作。

## 残余风险

- R1 被停用 Development 挂载上的在途 `mutation_attempt` 在 revive 前恢复为 `blocked`；R2 交付默认槽被其他仓库占用时 revive 先 `conflict`，需先解绑当前来源；R3 并发解绑/重绑无跨命令锁，以重读为准；R4 产品层无 Host/UI 入口，将来接 wire 时须同步 `development-route.ts` 与 ADR-0015 文案，并把 `unbindProviderBinding` 加入 `host-composition.ts` 的 setup allowlist。
- P3-02 的“写失败整笔回滚”没有 committed 回归测试（行为由既有原子性模式与独立验收手工反例覆盖）；若该失效模式将来升级为高风险，应补写失败注入用例。
- 独立验收报告与计划外反例脚本是运行态证据、未入库；其结论已摘录到本记录与 ExecPlan。PR 远端 head 仍为 Batch 1，最终 head、checks 与 PR 描述以 push 后回读为准。**Superseded by 下方本轮 MMP 评审（2026-11-24）**。

## 结论

`PASS`：本地实现 head `034867e3` 无 P0–P2；7 条 P3 全部显式处置。处置后分支可 push、可 request review；V8/V9、PR 描述更新与 ready 由 Lead 在 push 后执行。本记录不是人类评审或 R1/UAT 授权。


# 2026-11-24 MMP PR 评审与授权收尾

## Purpose / Big Picture
验证 #368 的 core/controller 解绑与同目标恢复构成独立闭环，修复实际缺陷并在当前版本门禁通过后 rebase 合并；不把工程合入解释成人验或 R1。

## Context and Orientation
首审锁定 `ed6ebf824cc1d6d6dcd24eff512e5ad38164d1b7`，base `main@c24d149151964c2fe8ef0d120a9facab3c65b356`；在 `feature/provider-unbind-20261124` 工作树根目录复现。首审 review threads/reviews 为空；上方记录是作者此前的独立验收历史，不能替代本轮当前 head 评审。

## Design / Spec
先锁事实和下列风险矩阵，再逐文件验证。只对有因果证据的缺陷提交一次完整 review；P0/P1 请求修改，P2/P3 批准后修复；修复交独立 agent 复审。

| 等级 | 代码 / 反例 | 产品闭环 / 工作项 | 架构 / 测试 | 首审判定 |
|---|---|---|---|---|
| P0 | 跨工作区写入、事务丢失 | 关闭未交付的硬门禁 | Planning 单源、凭据/数据安全 | 无 |
| P1 | 解绑/恢复身份漂移、交付默认槽冲突 | 解绑后无法恢复或错误成功 | Host 权威与外部 ack、失败原子性 | 无 |
| P2 | 边界错误、幂等/恢复误导 | #368 验收或消费者范围错配 | 测试漏掉有现实影响的路径 | 无 |
| P3 | 命名、重复或证据可复现性 | 过时记录、提交过碎 | 过度设计、低价值断言 | F1：归档计划的远端状态与路径数量失效；已修 |

## Global Constraints
范围为本 PR 既有文件与本记录；不新增 schema、Host/UI 或规划状态写入。账号：评审 gh-review，开发/回复/合并 gh。

## Plan of Work
1. 锁 head/base/全部 threads/checks 与 issue；审读实现、消费者、测试和反例。
2. 一次提交完整 review，按根因修复并独立复审；更新既有 Completed ExecPlan 的授权与实际证据。
3. 备份原头、收敛提交，发布并回读当前 head 门禁；核对 issue，按直接授权 rebase 合并。
验证：在上述分支根目录运行 `pnpm test:file tests/integration/workspace-setup-commands.test.js`、`node --test --test-timeout=120000 tests/e2e/repository-routing.test.js`，期望零失败；发布前执行 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main` 与 `git diff --check origin/main...HEAD`，期望通过。

## Validation and Acceptance
技术证据以本轮实际命令和当前 immutable head 为准；检查 #368 关闭引用与 #387、#155、R1 保留范围。

## Progress
- [x] 2026-11-24 锁首审事实，先建立全级风险矩阵。
- [x] 2026-11-24 全矩阵首审与一次 APPROVE review `6036566553`（1 P3）。
- [ ] 修复、独立复审、最终提交与合并回读。

## Surprises & Discoveries
既有记录引用的是早期本地验收 head 与尚未 push 状态，须保留历史时间边界。

## Decision Log
2026-11-24：用户直接指定本评审会话负责 #674–#677 的修复、复评、归档、提交整合、issue 核对、rebase 合并及清理；本授权覆盖四条各自闭环，不授权规划 Status 或依赖关系写入。

## Idempotence and Recovery
review 提交前回读已有 review 防重复；共享历史修改前建立 `refs/backup/pr676-before-mmp-review-20261124`，精确 old-head lease 保护并发变更；任一新失败回到验证门，不合并。

## Interfaces and Dependencies
Storage/Fake/SQLite、core WorkspaceSetup、controller SetupCommands、GitHub PR 与同仓 issue。

## Outcomes & Retrospective
首审无 P0/P1/P2，F1 文档证据时效 P3 已修。测试 38/38、路由 21/21，M1–M8 全部 KILLED，第二视角原子回滚反例 2/2；详见既有 ExecPlan 本轮 MMP 评审。当前已发布 ready 九项路径与必需门禁成功，新头最终发布后仍要回读。

## Bottom Change Note
2026-11-24：追加本轮当前头 MMP 评审，先建立风险矩阵并保留此前独立验收历史。


独立第二视角复审（2026-11-24，`ed6ebf824cc1d6d6dcd24eff512e5ad38164d1b7` / base `c24d149151964c2fe8ef0d120a9facab3c65b356`；检出 `feature/provider-unbind-20261124`）：按上方矩阵独立检查命令闭集、workspace/domain/绑定三键、同键重放和账本丢失、同目标身份、delivery 默认槽、事务与实际消费者，未发现 P0/P1/P2 或代码缺陷。`runSetup` 事务内先判定再写；停用保留身份与 primary 锚点；`restoreProviders` 跳过 enabled=false；controller 只报 local_only；Host 当前 OPERATIONS/allowlist 无解绑入口，故 #368 的 core/controller + 下一次装配闭环与 #387 引用级主身份裁决、#155 设置页/stale 展示仍独立，不据此关闭后两者或 R1。已独立回读当前 ready、MERGEABLE、`Closes #368`、Fast Gate/Verify/Browser/Windows SUCCESS、reviews/threads 全空；可选 review-session 红检查日志为 HTTP 404。open issue 的 unbind 标题搜索仅返回 #368/#387，边界不同，不新增重复 issue。本视角未重跑根评审已执行的 38/21 与 M1–M8；另用 `.superpowers/pr676-independent/probe.mjs` 在 memory/sqlite 各证实“先实际 revive 旧行，再新建引用因缺必填配置失败”整笔回滚（两个 putProviderBinding 已到达、完整快照不变），随后重试仍恢复原 id，2/2 PASS。唯一 P3：已归档计划 `docs/exec-plan/completed/2026-11-24-provider-unbind.md:188` 仍将 Batch 4/V8/V9/ready 列为待执行，Outcomes/早期评审仍把远端视为 e126058a；请保留历史并追加当前 published-head 回读完成结果，更新原处 supersede/勾选，V8 的“七项”同步为声明的九项。无需生产或测试修复；当前建议 APPROVE，根协调方完成文档收尾和独立复评。


2026-11-24 F1 处置：V8 七项改九项；Batch4 与远端回读勾选到首审发布头，旧 pending/unpushed 原处标 Superseded，并保留新头必须再过门禁的要求。此修复只改计划/评审证据，未改生产或测试；最终提交/发布由 root 统一执行。


2026-11-24 独立文档修复复审（检出 `feature/provider-unbind-20261124`，HEAD `ed6ebf824cc1d6d6dcd24eff512e5ad38164d1b7`，base `c24d149151964c2fe8ef0d120a9facab3c65b356`）：PASS，无新增 P0–P3。逐行复核未提交文档 diff；V8 九项与远端实际路径逐项一致，Completed 索引目标存在；ExecPlan 全部 13 个必需章节齐全且顺序正确。Batch4/Lead 勾选明确限于原发布头回读，历史 e126058a/pending 表述已在原处 supersede，新头整理/发布后的 checks 与 threads 门禁仍明确保留；未宣称未来 CI 或合并已完成。独立回读远端仍为上述 head/base、Closes #368、PR Fast Gate SUCCESS。`git diff --quiet HEAD -- packages apps tests` exit 0，生产/测试字节未改；`git diff --check` 无输出。文档修复无需重跑行为套件；此前测试与变异结果保持原执行者归属，不冒称本复审重跑。F1 P3 已闭环，可进入统一提交整理与最终发布头门禁。
