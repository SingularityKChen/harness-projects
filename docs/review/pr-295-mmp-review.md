# PR #295 MMP 评审记录

## 锁定事实

- PR #295「feat(capabilities): collect Delivery pages before publishing CI facts」，`Refs #232`，是 #289（GitHub Actions adapter）的栈底。
- 第一轮评审 head `28b454a2`，base `main`（merge-base `6417d459`），draft，7 个提交；评审前没有标签、review 或 thread；12 项 checks（含 PR Fast Gate）在该 head 上 success。
- 评审账号：Singularity-AI-Bot（`gh-review`）；开发、回复与合并：SingularityKChen。

## P0–P3 风险矩阵（第一轮）

| 层 | 结论 |
|---|---|
| 代码 | 页收集器正确：失败页、游标成环、重复对象、页数超限都丢弃整次收集并记 gap。core 不核对 run / check 的 `commit` 是否等于被观察的 head（P2，base 对 pipelines 已如此）；`startup_failure` 不产生 fact（P3） |
| 产品闭环 | 三种 StatusPolicy 下 CI facts 只增加派生标记、不改规划（变异证实）；降级读取不发布 facts |
| 架构 | 端口变化安全：fake 是唯一另一个 Delivery provider，依赖边不变，core 仍是 CI 映射的唯一拥有者 |
| 测试 | 成环用例无判别力，缺「非终态 + failure」行，fake 的 checks 过滤没有负控 |
| 工作项 | **P1**：栈底计划写入只在 #289 存在的 adapter 实现与决策（403 限流决策、adapter 体量与回归说明、#289 的 draft 状态）；旧结论没有原处取代（P2）；易失数字过期、允许改动集缺新测试文件、段落重复（P3） |

结论：1 × P1、3 × P2、9 × P3，`REQUEST_CHANGES`。P1 的三点对照：base 上没有这份计划；本层没有 `provider.ts`、Delivery 包里没有 `x-ratelimit`；`#289` 上两者都有。

## inline 意见与处理

| 级别 | 意见 | 处理 |
|---|---|---|
| P1 | 栈底计划写入只在 #289 存在的事实 | 移出本层，改为「#289 负责…；状态以 PR #289 回读为准」；原文保留给 #289 在自己的 diff 中补回 |
| P2 | core 不核对 run / check 的 commit | 任一元素的 commit 不等于被观察的 head 时整次集合作废并记 gap；新增 `ci-facts-only-on-observed-commit` |
| P2 | fake 的 checks 过滤没有负控 | fake 专属用例：别的提交与别的仓库上的 check 都被排除（M14 / M15 变红） |
| P2 | 拆分没有原处取代旧结论 | 各处标注 Superseded；与归档裁决「#232 不拆」的冲突交人类裁决 |
| P3 × 9 | 重复段落、易失数字、允许改动集、索引行、文件头注释、成环用例、真坏形状页、非终态 + failure 行、端口词表与 `startup_failure` | 全部修复；`startup_failure` 映射为 CiFailed，端口写明原生 status / conclusion 词表 |

## 人类裁决

人类伙伴 2026-10-08 在评审会话中裁定：本拆分取代 `docs/exec-plan/completed/2026-10-07-iteration-5-6-planning.md` D3 表中「#232 | 不拆」一行，#232 仍是一个 issue，由 #295 与 #289 先后交付。理由是两片合计超过单 PR 1000 行的硬上限。裁决同时写在 issue #232 的评论与 ExecPlan 的 Decision Log「人类裁决·拆分」。修订与合并收尾的 owner 也由人类指定为评审会话（作者是 Codex 会话）。

## 修复与复评

- 第一轮修复后，修复本身经独立复评：0 × P0–P2，5 × P3。其中一条是相对 main 的小回归：`providerOk(undefined)` 在 main 上被当成空集，修复后会抛异常。
- 第二轮修复：页值与元素的形状守卫（页值缺失、元素非对象、缺 `ref` 或 `ref.externalId` 都降级为 gap，fail closed）；第二页才出现的别的提交与显式缺 commit 两条负控；计划里 #289 实现细节的残留、未标注的取代与体量标签改正。
- 最终树变异：第一轮评审脚本的 M1–M21 中，M19 / M21 在公共投影上与原实现等价；其余，以及本轮新增守卫的 MC1–MC7、MS1、MN1–MN4，全部 RED。
- 验证：定向 delivery 27/27；全量 contract/integration/e2e 1274/1274；typecheck exit 0；boundaries 8/8；文档契约 15/15；代码 483/1000；disclosure 与 diff-check 通过。本层 + #289 的并集全量 1292/1292。

## 整体结论

P1 已按根因修复，修复经两轮独立复评，没有新的阻塞项。本层只写在自己合并点上为真的事实；adapter 的事实由 #289 在自己的 diff 中补回。合并次序：本层先合并，#289 更新到 main 后合并。
