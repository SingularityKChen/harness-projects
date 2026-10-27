# PR #406–#409 MMP 评审收尾 ExecPlan

> 状态：Completed（评审、修复、独立验收交付物收口；外部发布/合并按回读规程继续）；创建：2026-10-27；范围：四个已指定 PR 的评审、非阻塞修复、复评与授权 rebase 合并。
> 执行上下文：检出 `chore/plugin-demo-artifact` 的 `.worktrees/plugin-demo-artifact`；各 PR 源码修改与证据只在所属 worktree。

## Purpose / Big Picture

本计划归档边界为评审、修复、独立验证与可发布交付物；按人类要求，提交整合/issue处理/合并是归档后的外部收尾程序。Completed不表示PR已合并；外部结果以逐PR review和队列表的当前回读为准。

接手者可以从四份逐 PR 证据判断安装→绑定→显式 Start Work→交付谱系的各自闭环及组合边界，按人类本轮直接授权处理全部非阻塞意见后合并。成功证据是当前不可变版本的 review、可失败反例、独立复评、真实必需门禁、issue 回读及 rebase merge 结果，不能只靠测试绿色。

## Context and Orientation

#406/#230 是安装包，#407/#356 是绑定 UI，#408/#142 是显式工作入口，#409/#234 是谱系抽屉。四个 PR 初始均独立基于 main；已有实现会话负责原交付。初审先在各 worktree 的 `docs/review/pr-N-mmp-review.md` 建 P0–P3 矩阵再读代码。三位 `gpt-6.1-sol` high 子评审分管 UI，协调者审包并综合复核；使用 Superpowers、Qian Systems Router、First Principles Development。实时版本通过 `gh pr view -R SingularityKChen/harness-projects N --json headRefOid,baseRefOid,baseRefName,statusCheckRollup,closingIssuesReferences` 回读；初始版本见逐 PR 记录。

## Design / Spec

只修有反例的新问题：已配置的 repository 不等于三 Provider 实际可用；Start Work 的通用 conflict 不等于绑定缺失。状态判断消费 Host 已有权威数据，不新增本地权威缓存、不改 Core 状态机。先提交完整初审，再在各分支补判别性测试、最小修复、独立复评。#124 的证据回传区分单 PR 源、已冻结组合与未覆盖的 Desktop/模型/R1。

替代方案是把所有旧债并入本轮，拒绝它是因为 #338/#359/TD-042 等已有独立边界；无证据扩大范围会降低交付可审阅性。另一个方案是绿门禁后直接合并，拒绝它是因为缺产品、反例与当前版本评审。

## Global Constraints

文件集合：四个 PR 自己的 `docs/review/pr-406-mmp-review.md`、`docs/review/pr-407-mmp-review.md`、`docs/review/pr-408-mmp-review.md`、`docs/review/pr-409-mmp-review.md`；`docs/exec-plan/completed/2026-10-26-plugin-demo-artifact.md`、`docs/exec-plan/completed/2026-10-26-repository-binding-ui.md`、`docs/exec-plan/completed/2026-10-26-start-work-drawer.md`、`docs/exec-plan/completed/2026-10-26-delivery-lineage-drawer.md`；`docs/README.md`、`docs/review/README.md`、`docs/project-management/merge-queue.md`；本控制计划及 `docs/review/2026-10-27-pr406-pr409-mmp-review.md`；被确认 P2 的 `packages/client/src/repository-binding.ts`、`packages/client/src/start-work.ts`、`packages/ui/src/start-work-section.ts`、`packages/ui-model/src/repository-binding.ts`、`tests/contract/ui-repository-binding.test.js`、`tests/contract/ui-start-work.test.js`、`tests/integration/harness-plugin-repository-binding.test.js`、`tests/integration/harness-plugin-start-work.test.js`。实现修复仅修改各自 worktree，不共享源码写 owner。无新 Provider/Core schema、无规划 Status 或依赖边写入。PR 规模遵循代码1000/文档1500；文档中文、公开 issue 内容英文；外部评审用 gh-review，开发/回复/issue/合并用 gh。不得公开运行态路径/访问地址。四个现有 worktree 都是 canonical allowed-root 内，无 Git 中间操作；主检出用户未跟踪文件保留。

## Plan of Work

### B1 · 全矩阵初审

读当前 diff、全部线程、checks、issue 与追踪项，完成代码、产品、边界、测试、反例后每 PR 一次性发布完整 review；P0/P1 时 REQUEST_CHANGES 并按会话归属交接，否则 APPROVE。验证 `gh-review api user --jq .login` 期望评审账号，回读 review id/commit/event/comments 期望与当前锁定版本一致。发布幂等标记为 `mmp-review-N-<head>-initial`；冲突时重锁版本。

### B2 · 非阻塞修复与证据回传

首次源码修改前先建立四条 `refs/backup/mmp-review-20261027/pr-N-initial` 并回读；主文件见 Global Constraints。先实际重现已确认 P2，再加断言得到 RED，最小修改后相同命令 GREEN；不写镜像测试。独立评审不得由修复者自验代替。更新原交付计划的新发现/决策/结果，完成后保留 completed 状态。#124 回传一条证据评论并回读确认；重复调用以正文标记查重。撤销本批源码可退回先建的 backup ref；公开评论若需更正原位补订正。

### B3 · 整理、组合与远端门禁

复核 B2 的恢复锚点及当前远端 SHA，整理为各能力独立可回滚的 Conventional Commit。采用 #406→#407→#408→#409 顺序；在临时 clone 预演全部前序后，按真实 main 逐条 rebase，公共接线/索引冲突两边保留并跑组合验证。推前 disclosure、size、diff check；共享历史只精确 lease，远端漂移即停止覆盖并重新取证。

在 #407 分支根运行 `pnpm test:file tests/contract/ui-repository-binding.test.js tests/integration/harness-plugin-repository-binding.test.js tests/integration/harness-plugin-host-recomposition.test.js tests/integration/harness-plugin-setup-client.test.js`；在 #408 分支根运行 `pnpm test:file tests/contract/ui-start-work.test.js tests/integration/harness-plugin-start-work.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-setup-client.test.js`（期望全部 pass）；跨包依赖 `pnpm run boundaries`（期望9项pass）；新组合跑 `pnpm verify`（期望 typecheck、契约/集成主测试及 MVP0 全部pass），并 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`。`node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD` 期望exit0。新改动/失败才扩大回归。

### B4 · 归档后执行的授权合并与回读规程

每条最终 push 后重新核 current head/base、全部 checks/review threads、issue 双向关联；独立复评当前头并用 gh-review 批准。只以开发账号调用 `merge_method=rebase` 且绑定当前 SHA；每条合入后 fetch 真实main再处理下一条，回读 PR merged/mergeCommit、issue acceptance/关闭状态。看板 Status 保留。完成后把本计划移入completed并更新索引；剩余远端易失事实用回读命令或具时刻快照表达。

## Validation and Acceptance

| 验收 | 证据 |
|---|---|
| 先矩阵、完整一次性评审 | 四份review文档、GitHub review事件/inline |
| P2最小修复且不损害边界 | 原反例RED→GREEN、相关回归、独立复评 |
| 产品证据可定位且不夸大 | #124评论回读、四份原交付计划的冻结源与包摘要 |
| 组合完整 | 全前序冲突预演、组合verify/pack及接线测试 |
| 可回滚与授权收尾规程 | backup refs、明确授权、逐版本发布/门禁/issue/rebase merge的可执行回读与恢复路径；实际外部结果不能由归档状态推断 |

## Progress

- [x] 2026-10-27 +08：锁定四条初始版本、归属、全部线程与真实门禁，先建矩阵并分派子评审。
- [x] 2026-10-27 +08：安装包38项及三变异通过，当前tgz与实测包摘要/12文件相同；额外红检查逐个核实并由#364承接。
- [x] 2026-10-27 +08：完成全矩阵，四条review均由评审账号一次性APPROVE；两P2 inline、两P3 PR级，提交后actor/head/event/comments已回读。
- [x] 2026-10-27 +08：所有非阻塞问题修复、独立复评、新组合Web和#124回传完成。
- [x] 2026-10-27 +08：交付物与恢复锚点齐备，完整组合2086+7、边界9及新Web验收通过；B3/B4的归档后发布/合并按当前头门禁执行，不在此预写外部成功。

## Surprises & Discoveries

已确认两个P2反例：绑定后输出目录外部变化被Host安全禁用，client却按repository存在报active；真实工作树分支冲突被client误判needsBinding而阻止原地重试。谱系首次offline打开后重连只query、显示未刷新并可手动refresh，符合明确“不重放”策略，不作为缺陷。完整细节留所属review，不在此重复复现内容。

## Decision Log

2026-10-27 +08 / 协调者：按人类明确的“复评→归档→整合→issue→合并”顺序，将本计划Completed限定为评审/修复交付物验收完成，外部发布/合并是归档后的继续程序。原Purpose关于合并的总体目标保留，不能由归档状态外推合并已发生；最终事实以当前版本回读命令判定。

2026-10-27 +08 / 人类本轮直接授权，目标PR #406–#409：原话“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合 commit → 核对并处理对应 issue → merge_method=rebase 合并”。本授权按点名的四条PR条件执行，不改变规划状态。若P0/P1且原会话负责则交接实现，不并行改同分支。

2026-10-27 +08 / 协调者：采用原能力分支修复再按406→407→408→409整合；不创建新的产品PR或重复issue。每次重写先backup、精确lease，变化后重新评审。理由是维持独立能力闭环及真实main严格门禁。

## Idempotence and Recovery

外部写入actor/目标/幂等标记/结果保存在逐PR记录或本计划；先回读查重再写，提交后回读。已公开分支重写有backup ref，远端新提交不能覆盖；恢复通过另建分支取回backup而非破坏性清理。合并后回滚以各能力commit revert，issue/comment外部状态需单独处理；用户仓库和持久业务数据保留。

## Interfaces and Dependencies

依赖仓库PLANS/评审规范、GitHub gh-review/gh两账号与可用runner。strict保护唯一必需PR Fast Gate；可选评审端点失败逐run确认且#364已有追踪，不借红检查排除代码问题。所用模型与effort只在本任务适用，不变成仓库默认。

## Outcomes & Retrospective

评审/修复/独立验收交付物已完成并归档，当前完整组合2086+7、边界9、workflow8、新官方Web与#124回传均通过。归档后仍持续执行B3/B4的发布、issue和rebase合并程序；其实际结果只写在review当前版本回读，不把本计划Completed当合并证明。无新增实质延期债务。

## Bottom Change Note

2026-10-27 +08：在全矩阵初审期间建立收尾控制计划，明确人类按PR条件的直接授权、独立写入区、最小修复及回滚门禁。

2026-10-27 +08：按独立计划审查补齐确切文件集、可执行窄命令，恢复锚点提前至首次源码修改之前；本地 PLANS.md 的13章节优先于通用lint的额外章节。

2026-10-27 +08：两P2新增真实反例各先2项RED；最小修复后407相关32、408相关26通过，原子评审正在独立复评；选择四门权威投影判定与显式重启恢复，避免扩大Host共享重组机制。

2026-10-27 +08：独立新Web与#124回传完成后归档评审/修复计划，明确外部发布与合并继续执行，绝不预写合并结果。
