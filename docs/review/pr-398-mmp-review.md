# PR #398 MMP 交付评审

## Purpose / Big Picture
评审目标：完成计划归档后仍可发现、证据诚实、相对链接与索引一致。判定当前 PR 是否可独立验收、合并与回滚。

## Context and Orientation
2026-10-22 锁定：PR #398，issue #363，head `9cbaf6f7dfb02b502c198688e60e700e08cc65c5`，base `main@6aa6592d0070239f1957e504e2130baf84ff329e`。08:46Z 回读时 head/base 未变、`closingIssuesReferences` 含 #363、issue 仍 OPEN；reviews/comments 均为 0。

## Design / Spec
先建立全级别风险矩阵，再分层验证代码/配置、产品闭环、架构、测试与反例、issue 验收及重复追踪；测试绿不替代用户结果。本子评审只产出记录和机器报告，不提交 GitHub review。有 P0/P1 应 REQUEST_CHANGES；只有 P2/P3 或无问题应 APPROVE。

## Global Constraints
只读检查远端 PR、issue、checks 与 threads；只修改本评审记录和机器报告。不修改实现、ExecPlan、issue、PR 或规划状态，不发布 review。记录不含本机绝对路径或敏感信息。

## Plan of Work
1. 锁定事实与风险矩阵。
2. 分层审查与最窄判别验证，检查已有追踪项。
3. 更新本记录与机器报告，交根协调会话复核；不提交 GitHub review。
恢复：仅本评审文件与机器报告属于本批输出，不触碰实现或远端状态。

## Validation and Acceptance
最终矩阵（2026-10-22；以下按已核证结果填写）：

| 层 | P0 | P1 | P2 | P3 | 核证结果 |
|---|---|---|---|---|---|
| 代码 / 配置 | 0 | 0 | 0 | 0 | 可执行逻辑未变；仅更新路径引用、测试路径常量和配置注释。 |
| 产品闭环 | 0 | 0 | 0 | 0 | 13 个候选计划在 Completed 唯一可达；两个 view 人工分组及历史未实测实验仍明确未核实。 |
| 架构 / 七条不变量 | 0 | 0 | 0 | 0 | Gate E1 状态修正与 #4 人类裁决、#223 基线职责相符；未发现状态拥有权或依赖方向变化。 |
| 测试与反例 | 0 | 0 | 0 | 0 | 聚焦契约 74/74、`git diff --check` 通过；历史变异实验未重跑，记录仍称未核实。 |
| 工作项与交付 | 0 | 0 | 2 | 0 | 两项 P2 见下方发现；#363 关联正确，#99 验收 5 由 TD-090 承接。 |

**独立验证**：`pnpm test:file tests/contract/e1-evidence-consistency.test.js tests/contract/rule-checks.test.js tests/contract/resolve-pr-base.test.js tests/contract/plan-facts-consistency.test.js` 为 74 pass / 0 fail；`git diff --check 6aa6592d0070239f1957e504e2130baf84ff329e...9cbaf6f7dfb02b502c198688e60e700e08cc65c5` exit 0。Active 计划为 1/1、Completed 为 102/102，`docs/README.md` 18,658 bytes；索引相对链接无缺失，13 个候选旧完整路径检索零命中。

**远端与证据边界**：08:47Z 回读的 PR #398 当前 head checks 中 PR Fast Gate、Verify、Merge Gate 及其四条 lane、PR size、Disclosure scan、Issue policy 均成功；`Create review session` 失败，`Reconcile engineering state` 与 `matrix.check` 有取消项。根协调会话回读确认分支保护仅要求 strict `PR Fast Gate`，#364 跟踪可选 review endpoint 故障。ExecPlan 中 `pnpm verify` 1886+7 为作者记录；根协调会话另在组合 head `7824aaac` 实跑 1924+7，不能替代 #398 单独 head 的 CI，也不改变本次仅聚焦验证的范围。

## Progress
- [x] 2026-10-22 建立 P0–P3 先验风险矩阵并锁定初始 head/base。
- [x] 分层审查代码/配置、产品、架构、测试反例、issue 验收与重复追踪。
- [x] 完成最窄验证并复锁远端 head/base、checks、reviews/comments。
- [x] 更新本记录及机器报告；未提交 GitHub review。

## Surprises & Discoveries
PR #398 的 `Create review session` 失败与 #364 追踪项一致；该项不是必需检查。两个旧计划状态/完成记录仍需修正，详见下方 P2 发现。旧路径零命中、活动/完成态索引集合相等。

## Decision Log
- 2026-10-22 / 用户：要求使用 subagent；候选模型为 `gpt-6.1-sol`、`gpt-6-luna`。子评审使用宿主支持的 `gpt-6-luna` / `xhigh`。
- 2026-10-22 / 用户：P0/P1 有实现会话则完整交接后复评；无阻塞项的 PR 由本会话负责修复、复评、归档、整理提交、核对 issue 并 rebase merge。该授权覆盖 #398，最终仍须通过当前 head 门禁。
- 2026-10-22 / 根协调会话对子评审的当前授权：只读完成评审记录与机器报告；不修改实现/计划，不提交 GitHub review，不写入或合并远端状态。此子任务边界优先于较早的后续处理授权。

## Idempotence and Recovery
远端 head/base 变化后重锁事实；历史批准不自动转移。问题未复现不当作事实，无法验证则明确证据边界。评审前不创建重复 issue。

## Interfaces and Dependencies
PR 正式评审使用 `gh-review`；配置与 Project 的 owner 只读核验、作者侧提交和回复使用 `gh`，本地验证使用 Git、pnpm、Node。仓库评审标准见 `docs/review/mvp-review.md`。当前没有需交接给实现 owner 的 P0/P1。

## Outcomes & Retrospective
最终建议：`APPROVE`（仅两项非阻塞 P2；无 P0/P1）。P2-1：新增归档 Outcomes 声明 PR #56–#61 已合并，但原句仍称等待评审、无 PR 合并，未按 `PLANS.md` 在原处标 `Superseded`；F1–F5 勾选仍空，且 F2 中 PR #63 未写入新 Outcomes。P2-2：`PROJECTS_ENGINEERING_FIELD_ID` 已配置且当前值匹配 Project 10 的 `Engineering` 字段，但已归档计划仍留“待人类执行”未勾项。最小位置、证据和建议修订见机器报告。

上述为初审输入的发现；Superseded by 本段修复记录（2026-10-22）：review `5611681765` 已一次性提交两条 inline 并 APPROVE。协调者独立核验七个历史 PR 均 MERGED，并再次比较变量与 Engineering 字段相等；据此完成 F1–F5 与配置步骤勾选，将 #63 纳入 Outcomes，在旧“等待评审”和“仍待配置”原处标 Superseded。历史实验过程框、两个 view 人工分组和 TD-090 保留原真实边界。修复只改文档，未以 PR 合并推断历史变异或线程操作已逐项执行。

最终 push 后须针对新 head/base 复评并回读 `gh pr checks 398 -R SingularityKChen/harness-projects`、全部 review threads 和 #363 双向关闭关联；作者回复只在新 head 验证后发出。合并后以 `gh pr view 398 -R SingularityKChen/harness-projects --json state,headRefOid,baseRefOid,mergeCommit,reviews,closingIssuesReferences` 和 issue 回读核实，不固定未来 SHA。

真实 main 更新到 #397 的 rebase 合并 `97f54ebb` 后，仅 README 内容冲突；保留归档短索引与 #397 的完成计划行。变基后工作树独立结构回读为 Active 1 / Completed 103、README 18,784 字节、13 个候选旧路径零命中、全部 README 相对链接有效。原产品文件未改；旧批准仅作初审历史，新的 head 仍须独立复评。

初审输入的 head/base 与 #363 原生关闭关联已回读，子评审读取时 reviews/comments 为 0；远端事件随后由协调者提交。#363 的索引、旧路径与初审 CI 验收成立；`#99` 的历史验收 5 仍未满足，并由 TD-090 保持 OPEN，不把普通 CI 描述成真实 stack 成员分歧证据。现有 #182 是 active ExecPlan 路径守卫，范围不同；#364 是可选评审端点故障，均非 #363 重复项。

## Bottom Change Note
2026-10-22：在逐文件审查前建立风险矩阵与当前 immutable 输入，作为独立子评审入口。
2026-10-22：完成全矩阵、当前 head 远端回读及聚焦验证；记录两项 P2，并输出机器报告；不提交 GitHub review。
2026-10-22：协调者提交初审并据独立 API 回读修正两项 P2；保留原发现和其适用 head，后续证据只适用于重新锁定的输入。
