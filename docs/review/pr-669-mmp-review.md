# PR #669 MMP 交付评审

> 状态：首轮评审 APPROVE 已提交（review `6002157434`）
> 日期：2026-11-21
> 范围：独立审查 PR #669；首轮评审记录在本文件，后续依授权同步归档 ExecPlan 与索引
> 锁定基线：`main` @ `33fcde299ae16666ca936b61e7687041a1c0f35e`
> 锁定 head：`fix/default-branch-restriction-explanation` @ `4b88fd3e095587422acd8b1f671ec15bf567ee66`
> 关联：`Closes #580`、`Refs #556`

## Purpose / Big Picture

判断 PR #669 是否在合并前为 eligible 的默认分支 closing 选择提供清楚可访问的解释，同时维持非默认分支拒绝行为、原有关系选择和精确预览。最小交付证据包括 immutable head 上的差异、分层反例验证、GitHub checks/threads 回读和可复核的逐项验收结论；绿色测试不等于真实用户验收。

## Context and Orientation

PR #669 针对 #580，为 #556 已接受的 PR Issue 关系流程补充提交前说明。工作树为 `.worktrees/default-branch-restriction-explanation`。PR/Issue 远端快照由本次任务提供，PR 当前线程快照为空；可复核回读命令：`gh -R SingularityKChen/harness-projects pr view 669 --json baseRefName,baseRefOid,headRefName,headRefOid,mergeable,mergeStateStatus,isDraft,commits,closingIssuesReferences`、`gh -R SingularityKChen/harness-projects pr checks 669`、`gh api repos/SingularityKChen/harness-projects/pulls/669/reviews`、`gh api repos/SingularityKChen/harness-projects/pulls/669/comments`。#580 要求 eligible closing 时说明 GitHub 默认分支限制，保持 reference 默认、closing/none 显式选择、非默认分支强制及既有预览。

## Design / Spec

评审按 `docs/review/mvp-review.md` 的风险矩阵与分层核查执行，矩阵先行。首轮结论绑定指定 base/head；review `6002157434` 已提交 APPROVE。该记录及本次收尾不改产品实现，也不代表 PR 已合并。

## Global Constraints

- 首轮评审记录只写入本文件；后续经授权的归档收尾同步更新 ExecPlan 与 `docs/README.md`。
- 不改产品/测试，不提交、不 push、不合并；首轮 APPROVE 已由 root 提交。
- 真实测试只使用仓库命令；必要变异仅通过 `scripts/review-mutate.mjs`，并遵循其还原机制。
- 评审范围为 P0/P1/P2/P3、产品闭环、架构边界、测试反例、Issue 验收、设计取舍和重复 Issue。

## Plan of Work

### Batch 1 · 风险矩阵与分层审查

**最小闭环**：锁定 PR 事实，审阅全部层面，验证可观察行为并写出可行动结论。
**涉及文件**：`docs/review/pr-669-mmp-review.md`

1. 建立下表风险矩阵，再审查实现、产品闭环、架构、测试、Issue 与设计范围。
2. 运行有判别力的窄验证，回读结果与当前 PR 状态。
3. 按固定章节记录 findings、验收、测试和剩余门禁。

**验证命令**：在检出 `fix/default-branch-restriction-explanation` 的 `.worktrees/default-branch-restriction-explanation` 根目录执行；使用指定 SHA 的 `git diff`、聚焦测试命令及 `gh -R SingularityKChen/harness-projects pr view/checks`。期望：head/base 不漂移、命令结果与评审结论相符；任何失败均如实记录。
**回滚点**：本任务只新增评审记录；误写可由该文件单独修订，不影响产品状态。

### 风险矩阵（先行）

| 严重度 | 核查面 | 初始风险/判据 | 当前结论 |
|---|---|---|---|
| P0 | 正常/失败路径、提交与恢复 | 若 UI 说明触发额外写入、错误状态伪装成功或破坏主分支，合并即破坏交付 | 无发现；说明为纯渲染，提交路径不变 |
| P1 | 正确性、不变量、安全与架构 | 若 closing eligibility 或目标身份被 UI 篡改，或非默认分支仍能提交 closing，则阻塞 | 无发现；消费 Core 的 `relations` 与 `target`，没有新增 wire/Provider/状态写入 |
| P2 | 用户可观察闭环、可访问性、异常态 | 若说明未贴近关系选择/精确预览、辅助技术不可达或多仓库重复 ID 导致错误关联 | 无发现；说明紧邻预览，选择器通过 `aria-describedby` 指向仓库作用域 id；静态帮助无需 live region |
| P3 | 文案/范围、测试判别力、Issue/计划完整性、设计取舍 | 核实缺陷是否仅为已授权的默认分支规则说明，且无冗余契约、重复 Issue 或未覆盖验收 | 实现与 #580 scope 一致；三项均为工程验收且证据已齐。#580 checklist 由 root 按用户授权核对更新；安装态人工验收/R1 另有边界，不是 #580 闭环门 |

## Validation and Acceptance

实现闭环验收：eligible 默认分支在提交前显示精确说明；reference 默认与 closing/none 选项保持，精确 `Refs`/`Closes` 预览未被改写；`aria-describedby` 只在 eligible 时绑定说明；非默认分支移除该说明、保留 reason、禁用 closing 和提交；ID 加入编码后的 `scope.repositoryId`，组件与浏览器断言均检查仓库作用域 ID。浏览器场景不调用真实 GitHub、不创建 PR、不启动模型，`prCreates === 0` 是测试断言。

未发现 P0/P1/P2 行级缺陷。P3 范围判断：单仓库测试通过精确仓库作用域 id 断言，代码用 `encodeURIComponent(scope.repositoryId)` 生成描述 ID；实现满足多仓库隔离机制，未发现可复现冲突。未运行双表单 DOM 场景；这是覆盖范围边界，不足以推翻基于唯一仓库身份的简单编码实现。三项 #580 acceptance 都是本 PR 可验证的工程验收：UI 说明与辅助关联、非默认分支既有拒绝及 reason、组件/生产组合浏览器判别与无创建。它们由组件与全浏览器测试覆盖；#556 已关闭。用户已授权 root 核对证据并勾选 #580，不需要另设人类验收阻塞。安装态人工验收与 R1 发布门禁属于独立范围，不构成 #580 闭环条件。

最终建议：无代码阻塞项；root 已提交首轮 APPROVE（review `6002157434`）。首轮 `PR Fast Gate`、Verify、Browser、Windows Native、CodeQL、Issue policy、Disclosure scan、PR size、Resolve PR base、Reconcile engineering state 均 pass；`Create review session` fail 是本地评审端点 HTTP 404 的可选检查。随后 root 在源文件已还原且不与变异并行时串行重跑全浏览器命令，22/22、0 fail、0 skip，耗时 197962 ms。此前我的并行整文件结果 19/22 不再作为最终证据。Review/CI 通过不等于 PR 已合并；R1 发布门禁仍独立。

## Progress

- [x] 2026-11-21 锁定本地 worktree、指定 base/head 并完成先行风险矩阵。
- [x] 2026-11-21 分层审查：代码、产品闭环、架构、测试反例、Issue、设计取舍及重复 Issue。
- [x] 2026-11-21 聚焦验证完成，root 串行全浏览器回归 22/22；首轮 APPROVE 已提交，#580 工程验收清单更新已获授权，由 root 按证据核对处理。

## Surprises & Discoveries

最终复评（head `0eaaf4efd0958a95dc80b574afb4348abce87574`）发现一项 P3：归档计划 Outcomes 的 LOC 台账与最终 UI id 修订不一致，已由评审账号在 review `6002309824` 一次性 inline 并 APPROVE。协调者删除易失 LOC 值，保留“一处 UI、两个测试文件”的稳定范围和动态规模回读规则；此修订不改产品或测试，修订后须独立复核、按新 head 回读门禁并回复/resolve 该 thread。

初次全浏览器文件运行与变异脚本存在时间重叠，且全文件中 3 个非本次场景因 `HostAuthorityError: Host project data is unavailable` 失败；不将该轮作为最终证据。变异还原后定向浏览器场景 4/4 通过，之后 root 又在无并行变异的情况下串行重跑全文件，22/22、0 fail/skip。

## Decision Log

- 2026-11-21：以任务指定 immutable base/head 为评审对象；若发生漂移则中止当前结论并回报。理由：评审结论必须绑定确切 diff。
- 2026-11-21：首轮评审记录保存在本文件；计划归档时依授权同步更新 ExecPlan 与 `docs/README.md`，不改产品/测试。理由：满足仓库评审记录与计划生命周期。

## Idempotence and Recovery

读取与测试可重复执行；若 PR head/base 改变，重新锁定并从矩阵开始复审。文档修改前后检查 `git status` 和 diff，确认只有本文件变化；无需恢复产品代码。

## Interfaces and Dependencies

依赖仓库评审规范 `docs/review/mvp-review.md`、`PLANS.md`，本地 Git、`pnpm` 和 `gh` 只读访问。PR/Issue 快照由任务提供；易失的远端状态需以执行时的 `gh` 回读为准。

## Outcomes & Retrospective

最终结果：无 P0/P1/P2 代码发现；#580 三项工程验收由组件与全浏览器测试验证，首轮 APPROVE 已提交。#580 的 checklist 更新已由用户授权 root 核对后执行；#556 已关闭。安装态人工验收与 R1 发布门禁保持独立；未声称 PR 已合并或新 head checks 已通过。

关键证据：

- `pnpm test:file tests/contract/ui-create-change-request.test.js`：33 pass、0 fail。
- `node scripts/resolution-check.mjs && node --test --test-timeout=120000 --test-name-pattern='preselected Draft preserves native browser Issue choice|nondefault base removes the eligible restriction and keeps closing enforcement' tests/browser/workspace-execution.test.js`：4 pass、0 fail。
- `node scripts/review-mutate.mjs <temporary JSON spec>`：变异 A 将 `options.relations.includes('closing')` 替换为 `options.relations.includes('reference')`，`killedBy` 为 `eligible default-branch closing explains the restriction beside exact clause and nondefault base still enforces`；变异 B 将 `'aria-describedby': issueRestriction ? restrictionId : undefined` 替换为 `'aria-describedby': undefined`，`killedBy` 为同一用例。两者均 `KILLED`，脚本逐字节还原源文件；临时 spec 已删除。
- 全浏览器文件最终权威回归由 root 串行运行：`pnpm test:file tests/browser/workspace-execution.test.js`，22/22 pass、0 fail、0 skip，197962 ms。
- 我最初的并行全浏览器文件轮次为 19 pass、3 fail；失败均为 Host 测试数据不可用，且运行与变异重叠，已被 root 的串行 22/22 结果取代。
- GitHub 回读：base/head 与锁定 SHA 相同，closing issue 为 #580；首轮 review `6002157434` 为 APPROVE。review 当时 threads/comments 为空。
- `gh -R SingularityKChen/harness-projects pr checks 669`：全部必需/产品门禁 pass，只有可选 `Create review session` fail。`git diff --check` 通过，产品及测试源码相对 HEAD 无变异残留。
- Issue 搜索与读取：#580 是唯一当前开放的相近工作项；#556 已关闭。#580 三项验收均是工程验收，root 已获用户授权据证核对并更新 checklist；本任务没有进行 Issue 外部写入。

变异 spec 只在评审期间存放于系统临时目录，运行后删除；未将临时文件留在仓库。

## Bottom Change Note

- 2026-11-21：完成 P0–P3 矩阵、全层审查、窄验证与 root 的串行全浏览器复验；首轮 APPROVE 已提交。#580 三项为工程验收；安装态人工验收和 R1 独立保留。

- 2026-11-21 10:38 SGT：记录最终复评唯一 P3、删除陈旧行数台账的根因修正与新 head 复核规则；不改变产品和工程验收结论。
