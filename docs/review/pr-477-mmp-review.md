# PR #477 MMP 交付评审

## 锁定事实

2026-10-30 +08 首轮观察：base `main@b19b4eac4f12aa40c05d75b492f3335299874641`，head `1a26bcc4a2d97b98912e998d4ff1442430c1d2d2`；执行上下文 `.worktrees/ui-planning-readonly-scope`。Issue #475 双向关联正确；单个交付提交，0 条既有 review thread。账号：review 为 `Singularity-AI-Bot`；开发/合并为 `SingularityKChen`。当前事实重算：`gh pr view 477 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,reviews,statusCheckRollup`。

## 风险矩阵（先建立，后填写证据）

| 级别 | 层/风险 | 验证与结果 |
|---|---|---|
| P0 | 规划事实源、Host 权威、凭据边界被改变 | 产品仅替换一条静态文字；无状态、外部写口或依赖变化，未发现 |
| P1 | 只读说明否定独立工程权限；允许/拒绝/遮蔽任务断链 | 同 store、同输入实际 derive+SSR 组合覆盖 read_only/available/missing/unavailable；工程四门独立，未发现 |
| P2 | 测试不能识别旧说明或错误领域耦合；验收遗漏 | 定向39/39；两项归因明确的负控 KILLED，字节恢复且基线绿，未发现 |
| P3 | 文案、文档、重复设计 | 提示限定 Planning；无新控件、状态或兼容层，未发现 |

## 分层证据

- 代码/架构：`WorkItemListPage` 不再宣称不能开始工作；`deriveWorkItemDetailView` 按仓库 Development 四门计算，未改动权限策略；Planning 读取未知/不可用与 redacted canary 都不显示执行目标或隐藏内容。
- 产品/反例：Planning read_only + Development available 保留 target 与按钮；缺 branch/worktree 写门时仓库 available=false；Planning available 不会代替缺少的工程权限。文案为普通段落、无新增键盘停靠点，沿用既有换行布局。没有将 SSR 当作真实交互或 installed Host 验收。
- 测试：在上述 head 工作树根先执行 `node scripts/resolution-check.mjs`（exit 0），再执行 `node --test --test-timeout=120000 tests/contract/ui-work-item-list.test.js tests/contract/ui-planning-read-only-scope.test.js tests/contract/ui-start-work.test.js tests/contract/ui-work-item-detail-view.test.js`，39 pass、0 fail/skip；`node node_modules/typescript/bin/tsc --noEmit` exit 0。本机 pnpm wrapper 自动安装曾因无 TTY 失败；直接执行同等 Node 入口通过，不把环境失败当产品失败。
- 变异：`node scripts/review-mutate.mjs .superpowers/review477-mutants.json`；恢复旧说明、错误地用 `!view.readOnly` 限制 Start Work 均 KILLED，`killedBy` 为 `Planning read-only describes only planning`；基线/恢复基线通过，文件字节还原。
- 工作项/设计：#475 全部代码验收有对应证据；不是重写权限系统。#457/#465/#468 追踪 runtime 权限恢复，#451 追踪浏览器执行恢复；均不能替代本条文案缺陷，也未借本 PR 宣告它们完成。#479 的详情文字重排独立交付。
- 托管检查：该 head 的 PR Fast Gate、Verify 与各 Merge Gate 成功；可选 Create review session 的 run `41012553014` 实际日志为 endpoint 404，不是必需检查，不推断为产品成功。

## 结论与后续

首轮无可行动 P0/P1/P2/P3，结论 APPROVE。本记录随交付提交；后续 head 改动需重锁事实与重新批准。#449 的 installed Host 人类 UAT、父项 #427 与 R1 仍保留独立验收。Planning Status 与 native dependency 不由 merge 推导。

## 独立复评（2026-10-30 +08）

独立审查者重新锁定相同 `main@b19b4eac4f12aa40c05d75b492f3335299874641` / `1a26bcc4a2d97b98912e998d4ff1442430c1d2d2`，读取全部diff、#475、主审记录、真实投影/StartWork组件和两个负控spec/日志。生产差异只有一条静态说明，未改变权限策略；组合helper从同一个store和input同时派生列表与详情，真实SSR中的Start Work区域必须经过executionTarget存在门，允许项证据有效。缺branch/worktree写门各自拒绝，Planning缺失/不可用及redacted canary也有对应断言；既有StartWork测试验证真实提交按钮的拒绝门，未把展开表单按钮误当执行授权。

独立运行 `node scripts/resolution-check.mjs` exit0，随后重跑主审列出的四个文件：39 tests、39 pass、0 fail/skip、exit0。两个负控的原锚点与当前源码一致，正式`review-mutate.mjs`日志均为指定`Planning read-only describes only planning`用例RED/exit1，并汇总KILLED；本次遵守只读代码约束，仅复核原始spec/日志，没有重复临时改写源码。未重复浏览器、全量或包差验证。

主审无可行动P0–P3的结论有证据支持，本次未发现遗漏可行动问题。当前源码diff为零，仅追加本段；未发布review或操作远端状态。
