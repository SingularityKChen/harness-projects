# PR #549–#551 MMP 评审与收尾 ExecPlan

> 状态：Active；创建：2026-11-06。
> 范围：三个独立工程闭环的全矩阵评审、非阻塞修复、独立复评及条件授权 rebase 合并。

## Purpose / Big Picture

确认明确任务交接、原生 Draft 创建、Markdown 阅读三个交付可以独立审阅和回滚。测试通过只是工程证据；安装态、真实模型、父项和 R1 人类验收分别保留。

## Context and Orientation

初始观察基线为 `main@609463d8ee78a0cc83352512994e2b943e6e57bc`。三个初始候选分别为 #549 `3d80acfd087e5f3594446835e5fe76ee5ec698ca`、#550 `6a28a7a99d7bc78dc1354093c110740a9f3f48bd`、#551 `f5b41ff4194b94f6ae7f05bcc075bb3b52e38827`。各自完整矩阵见 `docs/review/pr-549-mmp-review.md`、`docs/review/pr-550-mmp-review.md`、`docs/review/pr-551-mmp-review.md`。

## Design / Spec

采用三名独立评审者，各自以 gpt-6.1-sol / high 检查一个 PR，协调者复核系统闭环、当前外部事实和组合。先写 P0/P1/P2/P3 矩阵，再读实现；完成全范围后，以评审账号一次性提交各 PR 的所有 inline 意见。无 P0/P1 才进入本会话修复及独立复评。

| 优先级 | 首要风险 | 判定门 |
|---|---|---|
| P0 | Planning 权威被工程事实覆盖；凭据或危险 HTML 跨越信任边界 | 保持七条不变量、权限/脱敏和惰性 HTML |
| P1 | 任务原文错配、重启重复副作用、错误 PR 身份或 Draft 确认 | 沿真实生产调用链与持久化恢复做反例 |
| P2 | 阅读缺陷、验收引用越界、兼容性误分类 | 可复现且不阻断工程闭环，独立修复复评 |
| P3 | 维护成本、重复实现、文档和诊断可读性 | 按实际收益决定最小改动，避免范围膨胀 |

## Global Constraints

本计划主文件、三个单 PR 评审记录、`docs/review/2026-11-06-pr549-pr551-mmp-review.md`、`docs/README.md`、`docs/review/README.md`、`docs/project-management/merge-queue.md` 为评审收尾文档集合；产品修复必须先在对应单 PR 记录中确认根因、文件范围和验证。

保留各自 worktree 和已有提交；不写 main。单 PR 代码/测试上限遵循已批准 800 行，文档 1300 行。开发/作者回复/合并使用 SingularityKChen；评审使用 Singularity-AI-Bot。每次共享历史调整前建 backup ref，精确 lease 发布后重新核对当前 head/base/checks/threads/issue 双向关联。只使用 rebase merge，不推进 Planning Status 或原生依赖。

## Plan of Work

### Batch 1 · 完整矩阵评审

涉及文件：三个 PR 各自的 `docs/review/pr-549-mmp-review.md`、`docs/review/pr-550-mmp-review.md`、`docs/review/pr-551-mmp-review.md`；后两份分别随未来层 #550/#551 发布。

锁定当前 SHA、全部线程、真实 CI 和 issue；三名独立评审者检查代码、产品闭环、架构、测试、反例、验收及设计；查找重复跟踪；协调者复核后一次性提交 review。

验证：在各 PR 工作树运行记录内的 scoped 命令；`gh pr view <n> -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,reviewDecision,statusCheckRollup,closingIssuesReferences`，期望与记录一致。发现 P0/P1 则全部交原实现会话修复，不合并。

回滚：本批只写评审记录和 GitHub review；本地记录可从本轮 backup 恢复，远端 review 只能追加当前版本结论，不能伪装撤回历史发现。

### Batch 2 · 非阻塞修复与组合

涉及文件：#551 的 `packages/ui/src/safe-markdown.ts`、`tests/contract/ui-safe-markdown.test.js`、`tests/browser/safe-markdown.test.js` 及其原 ExecPlan/评审记录；其余实现保持不变。

核实意见、最小修复、独立复评。按 #549 → #550 → #551 在仓库外一次性 clone 预演完整前序；保留两个 Host ABI 参数和全部文档索引。组合运行 `pnpm verify`、`pnpm run boundaries` 和 `pnpm test:file tests/browser/workspace-execution.test.js tests/browser/detail-expand.test.js tests/browser/safe-markdown.test.js`，期望 exit 0、全部用例通过。

回滚：单个能力可以整体 revert；本地重排可从 backup ref 恢复，外部已确认副作用和人工验收不会由源码 revert 撤回。

### Batch 3 · 当前版本发布与合并

涉及文件：本计划、`docs/README.md`、`docs/review/README.md`、`docs/project-management/merge-queue.md` 和三个单 PR 记录。

归档本计划、更新索引、整理可独立理解的提交。逐条接到真实 main 后验证产品树与已审组合一致；文档与元数据检查通过后精确 lease push，等待当前 head 的 PR Fast Gate，重读所有线程并由评审账号复评。核对 issue 验收，缺人类证据的项保留开放并使用 Refs。逐 PR 以预期 head 及 `merge_method=rebase` 合并并回读。

验证：在当前候选工作树执行 `node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`，期望均 exit 0；随后 `gh pr checks <n> -R SingularityKChen/harness-projects --required`，期望当前 head 的 PR Fast Gate pass。

回滚：共享历史调整使用已保存 backup 与精确 lease；合并后只通过单独 revert PR 回退相应能力，不改写 main，不撤销已确认外部副作用。

## Validation and Acceptance

| 验收 | 证据 |
|---|---|
| 每个 PR 覆盖四级风险与所有层 | 三份单 PR 文档、独立评审回报及一次性 GitHub review |
| 每条修复有判别性验证和独立复评 | 原反例、相关测试、当前修复 SHA |
| 顺序组合不丢接口与测试 | 仓库外完整前序预演、相关 ABI/生产浏览器与组合验证 |
| 发布面和规模合规 | `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD` |
| 最终合并与 issue 真实 | 当前 head/base/CI/线程/关联回读及 merge API 结果 |

## Progress

- [x] 2026-11-06：锁定初始三个 head/base，确认双账号可用、零已有 review thread，三名独立评审进行中。
- [x] 2026-11-06：核实可选自动评审失败均为本地端点不可达；#364 已跟踪，真实必需门禁均成功。
- [x] 2026-11-06：三份完整 APPROVE 已由评审账号一次性提交；#551 两项 P2 均记录。
- [ ] 非阻塞修复独立复评、组合和最终发布面验证。
- [ ] 归档、逐当前版本 rebase 合并及 issue 回读。

## Surprises & Discoveries

2026-11-06，第一轮修复组合 `11edccf0f4c8a994b3c9f2582a023f34be046646` 在仓库外 clone 运行 `pnpm verify` 通过 typecheck、3568/3568 常规测试和 MVP-0 8/8；`pnpm run boundaries` 9/9，三文件生产浏览器命令 18/18。原修复者最终 scoped 18/18、四项有 `killedBy` 归因的变异全部 KILLED 且逐字节还原；这些不等同安装件或人工验收。Superseded by 第二轮修复验证（2026-11-06）：独立复评发现 script double-escaped 剩余反例，第一轮证据不足以关闭 F551-1；新源码必须重测。

原实现会话已完成两轮恢复修复；历史结论不替代本轮当前 head 评审。完整顺序预演在 #550 的两份 Host ABI 测试与 Completed 索引发现冲突，需要同时保留任务参数与 Draft 参数，不能选单边。

## Decision Log

- 2026-11-06，#551 两项 P2：raw-text/RCDATA/CDATA 不是 prose comment，保留惰性文字；#538/#542 明确的人类 Desktop 验收尚待完成，PR 改用 Refs。GitHub 延迟后双向关闭关联回读为空，不预先假设正文修改即时生效。

- 2026-11-06，人类在本会话直接要求评审 #549–#551，并条件授权：有 P0/P1 且有原实现会话则交其修复；没有 P0/P1 或只有 P2/P3 则由本会话修复、复评、归档、整合提交、核对 issue 并 rebase merge。本授权具体覆盖这三个 PR。
- 2026-11-06，协调者读取会话列表及原实现会话“筛选并规划紧急交付 Issue”，确认该会话拥有三个实现分支且当前空闲；只在发现阻塞项时按人类授权发完整修复说明，不并行修改同一实现。
- 2026-11-06，评审使用 Superpowers、Qian Systems Router、First Principles Development；以状态拥有者、因果机制和端到端结果判定，不把测试数量解释为产品接受。

## Idempotence and Recovery

外部写入记录 actor、repository binding、目标、幂等标记和回读。提交 review 前重读当前 head 并查重；push 使用精确远端预期值。已有 worktree 不清理、不破坏未提交文件；并发 head 变化立即重新评审。

## Interfaces and Dependencies

依赖 gh / gh-review 双账号、GitHub API、pnpm、现有生产浏览器测试环境。分支保护实时观察：strict 且唯一必需检查为 PR Fast Gate；每次合并前重新回读。工程接受与人类安装态接受由不同证据拥有。

## Outcomes & Retrospective

目前完成事实锁定、风险矩阵与派发；最终结果以 Progress 和跨 PR 记录的当前证据更新，不预写合并或完整验收。

## Bottom Change Note

2026-11-06：建立三 PR 评审收尾计划，记录本会话条件授权、原 owner、四级矩阵、组合冲突与当前版本门禁。

2026-11-06：独立文档复评补齐每批文件、具体浏览器/发布验证及回滚；移除首条 PR 尚不可解析的跨 PR 本地链接。
