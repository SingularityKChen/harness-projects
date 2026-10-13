# PR #325 MMP 交付评审

> 评审时间：2026-10-13（Asia/Singapore）。对象：`fix/identity-conflict@bc8ec2fc6fbf5ceae146b03ca802590adee84c0f`，PR 基线 `main@ee07c323194dd13fbfc093add0639acd0e55998b`；评审时远端 `main@79d016920c7a1456ceb617eb4f693df232a7fb38`。本记录只适用于该 head/base，改写或更新分支后必须重锁。

## 1. 先建风险矩阵

| 级别 | MMP 失败形态与判据 | 本轮结果 |
|---|---|---|
| P0 | 双键冲突改写另一个身份的 stable id/entity，或破坏数据库、凭据、规划权威硬约束，合入即破坏主线 | 未发现。冲突写在任何 mutation 前拒绝；schema 与凭据路径未改 |
| P1 | Fake/SQLite 结果分叉、冲突后任一 owner 被改写、并发窗口使预检失效、合法 replay 断裂 | 未发现。共享双适配器反例与原子路径支持；现有 primary 约束保留 |
| P2 | 端口错误/恢复/边界或测试缺口令该身份闭环在真实入口不能验收 | 未发现新增缺陷。现有 `#190`、`#201`、`#311` 分别追踪 broader identity、mutation coverage、Fake alias 问题 |
| P3 | 可读性、记录或合并准备问题，不影响本闭环语义 | 有收尾项：ExecPlan 仍在 active、#310 验收勾选仍空、七个提交含多次文档修订；当前分支落后 main |

按代码、产品闭环、架构边界、测试/反例、issue 验收逐层核对，绿色检查只作为局部证据。

## 2. 锁定事实与范围

- `gh pr view 325 -R SingularityKChen/harness-projects`：PR open、ready、base `main@ee07c323`、head `bc8ec2fc`，`mergeStateStatus=BEHIND`、`mergeable=MERGEABLE`、`reviewDecision` 空；GitHub reviews/threads 都为 0。PR 的 native `closingIssuesReferences` 只指向 #310，反向 `closedByPullRequestsReferences` 也指向 #325；issue 尚 open。
- 远端 `main@79d0169` 已前进；`git merge-tree --write-tree origin/main HEAD` 返回 tree `700f9c256c87528ecb83ded3cea5d071ee9843b7`，无文本冲突。它只证明可自动组合，尚不证明组合树运行结果。主线此段变更 Fake Storage 的 sync-round 字段与端口，不修改 `putExternalIdentity`；PR 的 SQLite 身份预检无交集。
- 变更为代码 39/1000 行、文档 112/1500 行；四个文件：`packages/storage/sqlite/src/storage.ts`、两份 contract 文件、一份 ExecPlan。PR 的七个提交中，行为变化只有 `3b7d0569`，其余为计划修订。
- 当前 head 的 `PR Fast Gate`、CI verify、Merge Gate 各 lane、规则、issue policy 均成功；本轮以 `gh pr checks 325` 回读。此前取消的旧 run 不用来判当前 head。

## 3. 分层证据

### 3.1 代码、原子性与反例

SQLite 在 `packages/storage/sqlite/src/storage.ts:129-140` 先查 record-id owner，再以同一 `(binding_id, external_kind, external_id)` 查 natural-key owner；若 id 已指向不同 natural key，先抛与 Fake 相同文本的错误。UPSERT 仍只改 `role`，数据库唯一键及 primary 唯一索引继续兜底。Fake 的相应预检在 `packages/providers/fake/src/storage.ts:221-236`，写入排在一个 `#mutate` 槽里。

SQLite 的 `atomic` 通过 `packages/storage/sqlite/src/storage-sync.ts:184-196,211-224` 在同一实例队列内执行 `BEGIN IMMEDIATE`、两次 SELECT、UPSERT 和 COMMIT；异常回滚。在外部事务作用域中，同一数据库连接和作用域令牌执行，不另开事务。因此同一进程重叠调用及多连接写入都不能在双读与 UPSERT 之间插入另一个已提交身份写。没有引入独立事实源。

共享反例 `tests/contract/suites/storage-identity-membership.js:83-106` 对两个适配器分别种下 `i1→issue1`、`i2→issue2`，让 `i1→issue2` 写入被同一错误拒绝，再逐字段读回两条 owner。另一用例证明 natural-key replay 用新 record id 更新 role，同时保留原 id/entity/binding/kind/externalId。既有用例 `:59-80` 还覆盖 same-id 换键、第二 primary 拒绝、换 entity replay。后者与新增用例合起来覆盖 issue #310 的合法 replay 边界。

变异判别力：在本 PR 检出上用 `node scripts/review-mutate.mjs /tmp/pr325-mutation.json --root .`，分别移除 SQLite/Fake 的 double-conflict guard，两个变异均 `KILLED`，失败用例都包含「identity id 与 natural key 双冲突」；脚本还原后基线为绿，工作树仅有本评审文件。变异 spec 是本机临时输入，持久判据与结果写在这里：锚点分别为 SQLite 的 `if (sameId !== undefined && (sameKey === undefined || sameKey.id !== sameId.id)) {` 和 Fake 的 `if (sameId !== undefined && sameId !== existing) throw ...`，替换为 `if (false)`；`killedBy` 均为上述双冲突用例。旧 SQLite 的红灯事实来自本 PR ExecPlan 的 2026-10-12 记录，本轮未重新运行旧树。未单独安排跨进程 barrier，因为 `BEGIN IMMEDIATE` 是既有单一事务入口，当前改动没有新增事务机制。

### 3.2 产品闭环与架构

此 PR 的可观察用户结果是同一外部对象不因 record-id/natural-key 交叉重放而悄悄换 owner 或角色；冲突响亮失败且两条既有身份不变，合法重放继续使用稳定内部实体。它不宣称 Gate E1 已通过，也不宣称全产品可发布。`packages/core/src/identity.ts:43-81` 的身份解析/提升依赖 Storage 保留 stable entity，PR 保持该接口与核心路径不变。

Storage 层只依赖 domain/capabilities；没有引入 Provider 调用、Planning 状态写入、外部写入或 secret 材料。`pnpm run boundaries` 的 8 项通过。数据库 `external_identity` 自然键与 `external_identity_primary` 约束见 `packages/storage/sqlite/migrations/002_identity_membership.sql:69-85`，PR 未改 schema。#190 的「恰好一个 primary」模型决策仍待独立处理，不能因本 PR 的至多一个约束和绿色测试而视为已解决。

### 3.3 验证

在检出 `fix/identity-conflict@bc8ec2fc` 的工作树根目录，本轮执行：

```text
node --test tests/contract/storage-contract.test.js tests/integration/identity-membership-schema.test.js
→ 154 pass / 0 fail / 0 skip
node --test tests/e2e/chain-bootstrap.test.js tests/integration/storage-restart.test.js tests/integration/sync-revision-freshness.test.js
→ 89 pass / 0 fail / 0 skip
node_modules/.bin/tsc --noEmit
→ exit 0
pnpm run boundaries
→ 8 pass / 0 fail
node scripts/rule-checks.mjs size origin/main
→ code 39/1000, docs 112/1500
node scripts/rule-checks.mjs disclosure origin/main
→ 机械扫描通过
git diff --check origin/main...HEAD
→ exit 0
```

人工公开面复核了本 PR 的新增行、提交标题/正文与 PR 描述的五类目：凭据、本机身份、账号个人信息、内部系统、保密字样；未见命中。上述命令在 PR 检出上运行；`merge-tree` 后的合成树没有运行测试，更新到当前 main 后须重做相关验证。PR 原有 `pnpm verify`（1484 + 7）是作者记录，本轮未重跑全套。

### 3.4 Issue 验收与交叉追踪

Issue #310 的四条验收：双冲突统一拒绝且两行不变、合法 natural-key replay 保留 stable id/entity 只改允许字段、其他 primary/identity 约束保留、指定两套件通过，均有上述代码与实际测试证据。Issue checklist 仍未勾选，合并前应按验收结果回填；PR 的 `Closes #310` 只建立关闭关联，不等于已合并交付。

交叉查重：#303 是 status 写回 redacted 内容的竞态（open）；#305 是 Planning 全量读取轮次定序（closed）；#306 是 Controller 请求身份指纹（closed）；#307 是 Controller Pending/in-flight replay（closed）；#311 是 Fake Storage 普通端口的对象 alias/snapshot 语义（open）。它们各有不同状态拥有者或故障入口，不覆盖本 PR 的 record-id/natural-key 交叉冲突。#190 与 #201 也分别追踪 exactly-one-primary 建模和更广的约束变异测试；不是本 PR 重复 issue。

## 4. 结论与下一门

**本轮未发现可定位的 P0/P1/P2 代码或产品闭环缺陷；P3 为流程收尾。** 无需行级缺陷意见。按本次评审规则可给当前 head 一份 `APPROVE` review，但仍须在负责者收尾后，基于新 head/base 重锁、复审并完成 strict required gate：归档 ExecPlan 到 `docs/exec-plan/completed/` 并更新 `docs/README.md`、把七个提交收敛为可独立审阅和回滚的交付序列、勾选 #310 的已证实验收项、更新到当前 main 后重跑相关验证。`mergeStateStatus=BEHIND` 时不能仅凭旧的绿色 checks 进入合并。

本文件由只读子评审写入 PR worktree；GitHub review、代码修改、提交与合并均由主任务负责。
