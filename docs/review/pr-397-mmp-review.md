# PR #397 MMP 交付评审

## Purpose / Big Picture
评审目标：分页谱系刷新必须保持最后确认事实、唯一 writer 和规划轴隔离。判定当前 PR 是否可独立验收、合并与回滚。

## Context and Orientation
2026-10-22 锁定：PR #397，issue #233，head `81c989e27cdcef9d632d5cfa11ce8841a1d6e12e`，base `main@6aa6592d0070239f1957e504e2130baf84ff329e`；执行上下文为检出分支对应的 `.worktrees/lineage-refresh` 根目录。提交评审前重新回读 head/base、threads、checks。

## Design / Spec
先建立全级别风险矩阵，再分层验证代码、产品闭环、架构、测试与反例、issue 验收及重复追踪；测试绿不替代用户结果。每个 PR 全部意见以一份 review 提交。有 P0/P1 则 REQUEST_CHANGES；只有 P2/P3 或无问题则 APPROVE。

## Global Constraints
子评审只维护本记录，不改实现；协调者负责远端评审和证据归档，不改规划 Status 或阻塞关系。评审身份为 `Singularity-AI-Bot`（`gh-review`），作者侧与合并为 `SingularityKChen`（`gh` / git）。仓库记录不含本机绝对路径或敏感信息。

## Plan of Work
1. 锁定事实与风险矩阵。
2. 分层审查与最窄判别验证，检查已有追踪项。
3. 形成评审记录和机器报告，交协调者一次性处理远端评审。
回滚：只撤销本评审记录；本子评审未做实现变更。

## Validation and Acceptance
先验矩阵（2026-10-22，在逐文件检查前建立；各格是待验证风险，非已发现缺陷）：

| 层 | P0 硬约束 / 主线破坏 | P1 MMP 阻塞 | P2 非阻塞缺陷 | P3 可维护性 | 最小判别证据 |
|---|---|---|---|---|---|
| 代码 | 数据 / 执行边界被破坏 | 正常或失败路径丢事实 / 越界 | 有界边缘路径错误 | 错误定位与命名 | 当前 diff、针对性反例 |
| 产品闭环 | 权威事实被篡位 | 声称交付却无法完成用户任务 | 降级 / 提示不完整 | 文案与发现性 | issue 场景到真实入口 |
| 架构 | 七条不变量 / secret 边界被破坏 | 第二 writer、反向依赖或边界漏洞 | 契约边界表述缺口 | 局部耦合 | 调用链与 boundaries |
| 测试与反例 | 门禁可被伪造通过 | 关键路径无判别 / 外部代码先执行 | 少量边界缺测 | 测试组织 | 基线、失败路径、对照 |
| 工作项与交付 | 公开敏感信息 / 破坏性闭环 | issue 验收不成立却关闭 | 重复追踪 / 引用或规模问题 | 索引与证据简洁性 | issue、ExecPlan、相关追踪 |

最终结果（2026-10-22）：

| 层 | 检查结果 | P0 / P1 | P2 / P3 |
|---|---|---|---|
| 代码 | `findDevelopment` 逐页校验引用和目标字段，命中早停；空页续读，坏页、坏游标、成环、异常及 100 页耗尽成为 gap，由单一 writer 保留最后确认集合。Delivery 全集读取未改。 | 无 | 无 |
| 产品闭环 | 公共刷新与查询返回六位置投影。按 ADR-0011：分支由 `ExecutionContext.branchExternalId` 和 Worktree hop label 表达；commit 与 PR 共锚 Worktree。录制用例断言 label 完全相等，commit external id 等于 PR `sourceVersion`。不新增独立 Branch hop 或 Commit→PR 边；按既有图契约满足概念链验收。CI failure 在三种 StatusPolicy 下不写 Planning。Delivery 离线保值由两种 Storage 的既有 E2E 矩阵覆盖。新增录制双 adapter 离线用例实际先遇 Development 故障，未单独证明真实 Actions adapter 离线。#367 是已移出的 PR-backed 身份范围。 | 无 | 证据边界已记录 |
| 架构 | 单一 `refreshDeliveryFacts` writer、查询纯读、Planning 存储字节不变；无新依赖边、Provider 互调或 secret 写入。 | 无 | 无 |
| 测试与反例 | 本地变更测试 50/50；typecheck 通过；boundaries 9/9；`git diff --check` 通过。将分页循环变异为 1 页后，`listBranches：第 51 项` 用例归因杀死，变异工具确认原文件字节恢复。协调者另行报告组合 `pnpm verify` 1924 + 7 全绿，不冒充本子评审实跑。 | 无 | 未在本子评审重跑全量 verify |
| 工作项与交付 | #233 body 与 10-15 issue comment 的验收均检查；PR closing reference 指向 #233。TD-040/068 在分支记为 Resolved；TD-063 保持 Open，本 PR 不消费 `reconcile`。未发现重复分页 issue。 | 无 | 无 |
| 远端事实 | 精确 head/base 未变，PR OPEN；reviews/comments/threads 为 0。当前 PR Fast Gate、Merge Gate lanes、CodeQL 与规则检查成功；`Create review session` 失败但属仓库记录的可选非门禁检查。 | 无 | 本子评审不提交远端 review |

有界预算限制：真实 GitHub Development adapter 与公共刷新入口的无网络合成探针持续返回同分支 fork 项并推进 cursor；100 个端口页后 core 以 Development gap 结束，实际 adapter transport 计数为 10,000。该数来自适配器每次至多 100 个平台页与 core 至多 100 个端口页的乘积；需极端同名 fork 规模才接近，不列为 P2，也不把端口页说成平台请求。

## Progress
- [x] 2026-10-22 建立 P0–P3 先验风险矩阵并锁定初始 head/base。
- [x] 2026-10-22 完成全矩阵审查、窄验证、反例、issue 与已有追踪核对。
- [x] 2026-10-22 全部初审意见一次性提交为 `APPROVE`，review `5611550105`，actor 为评审账号；无 inline 缺陷。
- [ ] 证据归档提交后的新 head 回读、独立复评与授权 rebase merge。

## Surprises & Discoveries
分页层数相乘在合成极端路径上可产生 10,000 次 adapter transport 调用，但总预算有限；一般 MMP 仓库规模不会达到此路径。本轮不把它升级为缺陷。Actions failure 与 merged 状态使用明确标记的合成响应，不代表同一次真实平台全链录制。

## Decision Log
- 2026-10-22 / 用户：要求使用 subagent；候选模型为 `gpt-6.1-sol`、`gpt-6-luna`。子评审使用宿主支持的 `gpt-6-luna` / `xhigh`。
- 2026-10-22 / 用户：P0/P1 有实现会话则完整交接后复评；无阻塞项的 PR 由本会话负责修复、复评、归档、整理提交、核对 issue 并 rebase merge。该授权覆盖 #397，最终仍须通过当前 head 门禁。
- 2026-10-22 / 协调者：本子评审只写本记录和机器报告，不提交 GitHub review；远端一次性评审与后续处置由根会话执行。
- 2026-10-22 / 评审：issue #233 概念箭头按 ADR-0011 和既有六位置投影解释；证据确认 `branchExternalId` 与 Worktree label 精确一致，commit external id 等于录制 PR `sourceVersion`。不新增 Branch hop 或 Commit→PR 边。
- 2026-10-22 / 评审：adapter 与 core 的有限分页预算乘积作为非阻塞边界记录，不增加公共端口参数或重复 issue。

## Idempotence and Recovery
远端 head/base 变化后重锁事实；历史批准不自动转移。问题未复现不当作事实，无法验证则明确证据边界。评审前不创建重复 issue。

## Interfaces and Dependencies
`gh-review`、`gh`、Git、pnpm、Node；仓库评审标准见 `docs/review/mvp-review.md`。实现 owner 会话已由会话列表定位，问题交接前核对当前归属。

## Outcomes & Retrospective
初审结论为 APPROVE（无 P0–P3 代码发现），已由协调者提交评审事件。证据支持 #233 的有界分页、最后确认事实、唯一 writer 与 Planning 隔离闭环。协调者在组合检出 `test/lineage-controls-acceptance@7824aaac` 实跑 `pnpm verify`，1924 + 7 全绿；5 个关键实现 blob 与三个输入 head 相同，110 个受管测试的正文和首 import 并集均保持。组合绿色不覆盖 #399 独立反例发现的 P1；该项交回原实现会话，不阻塞本 PR 的独立闭环。

证据归档只增加文档，产品源码与初审 head 相同。最终 push 后执行 `gh pr view 397 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,state,mergeCommit,reviews,closingIssuesReferences`、`gh pr checks 397 -R SingularityKChen/harness-projects` 并读取全部 review threads；须由新 head 的 CI 与复评成立后才 rebase merge。合并后回读 #233 关闭、main 的树与批准 head 相同；不将旧批准转移为新 head 的证据。

## Bottom Change Note
2026-10-22：完成 PR #397 当前 immutable head 的独立 MMP 评审，记录全矩阵结果、合成证据边界和协调者可用结论。
2026-10-22：记录一次性初审 APPROVE、协调者组合实跑和授权收尾规则；保留来源边界，不把 sibling PR 的 P1 藏在全绿测试后。
