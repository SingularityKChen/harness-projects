# PR #610 · MMP 交付评审

## Purpose / Big Picture

确认 #603 具名获批的视觉参考可核对、可交接；安装件和 R1 由 #599 / #73 分别验收。

## Context and Orientation

2026-11-11 SGT 首轮：base `982517c73951563797612472339970f015e7c62f`（main），head `d449f90b12a114cea78f2de97953a4266204b2b9`（`docs/release-visual-target`）。原生栈 #616：#610 → #611 → #615 → #612。#603 与 #610 双向关闭引用存在；首轮前 review threads 为零。

## Design / Spec

| 优先级 | 风险及分层结论 |
|---|---|
| P0 | 发布面／事实边界：无产品代码或外部写入；机械扫描、图中示例标记及历史锚点核对未发现阻塞。 |
| P1 | 交付／设计：六面、明暗、四宽度及状态交接可审阅；固定摘要与人类具名批准匹配，示例工程值与源码基线区分。 |
| P2 | Issue 验收／架构：冻结 handoff 没有把阅读者接到仓库现有 Host／选择性库／现行控件比较；在可变入口补链。 |
| P3 | 证据导航：冻结文件中的批准前措辞由 README 与 ExecPlan 明确标为历史，保留原字节。 |

## Global Constraints

只改 v3 可变入口、已归档 ExecPlan 和本记录；35 张 PNG、两份绑定元数据和 manifest 字节原样保留。设计批准不扩大为安装验收或规划写入。

## Plan of Work

本批在 `docs/release-visual-target` 检出核对冻结资产和 #603；在入口补选型证据链接，独立复核后按 #616 顺序交付。回滚只撤该设计层，依赖层已合并时先处理依赖。

## Validation and Acceptance

首轮在 `.worktrees/release-visual-target` 核对 35 PNG 的尺寸、字节及 SHA-256，另两份元数据和 manifest 摘要；50 个相对链接通过。用 `git diff --check 982517c...HEAD` 和 `node scripts/rule-checks.mjs {disclosure|size} 982517c` 分别核对空白、发布面、规模，首轮代码 0／文档 682 行。固定 v1 manifest 经 GitHub contents 读取重算摘要，与历史指针一致。

## Progress

- [x] 2026-11-11 SGT：首轮独立视觉交接审阅；一次性提交 1 条 P2 并 APPROVE。
- [x] 2026-11-11 SGT：独立复评确认链接直接到既有比较，包含 Host 根入口、Loader、选择性 Radix Dialog 和保留现行控件的决策；38 个冻结文件与首轮字节完全相同。
- [x] 2026-11-11 SGT：协调者已回读修订 `bd3a9152109a8cbbdd35f1363717e5bf58dbfc01` 的 CI 与独立复评通过；09:00:52 SGT 以 rebase merge 合入 `4320baac082fc89106ce8d533a7300a8053024c7`，#603 为 CLOSED。

## Surprises & Discoveries

`gh pr checks 610 -R SingularityKChen/harness-projects`：首轮 Fast Gate、Verify、Browser 成功；重复 Rule checks 取消、同 head 后继成功。可选自动创建评审会话收到 404，不是分支门禁。已核对旧方案由既有选型证据覆盖，无须新 issue。

## Decision Log

2026-11-11 SGT：P2 补交接索引，采用已有公开包证据；避免重复维护或改动获批资产。用户在本评审会话授权无 P0/P1 层修复、复评及 rebase merge。

## Idempotence and Recovery

按固定摘要重复读取；发现远端 head/base 变化则重新锁定。不修改旧参考恢复锚点。

## Interfaces and Dependencies

GitHub 双账号；栈 #616 逐层进入实际 main；合并前使用当前 head、必需检查、批准、issue 双向关联与线程回读。

## Outcomes & Retrospective

首轮无 P0/P1；#599、Timeline 交付和 R1 均保留独立门禁。

## Bottom Change Note

2026-11-11 SGT：记录首轮矩阵及冻结证据，明确唯一 P2 的修复边界。

2026-11-11 SGT：按用户授权核销最后的 CI／合并待办；原回读命令、历史首轮观察和冻结参考保持。
