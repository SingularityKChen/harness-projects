# PR #318 MMP 交付评审

- PR：#318 `fix(core): reject superseded Planning snapshots before commit`
- 当前 head：`da863d0ecf44fdd32d9cf193fa72fe2f9fdc6b68`
- base：`main@ee07c323`（PR #317 合并提交）
- worktree：`.worktrees/fix-planning-round-order`
- 评审视角：MMP 交付；结论基于当前 immutable head
- 关联 issue：#305，PR body 使用 `Closes #305`

## 风险矩阵

| 等级 | 代码 / 产品 / 架构 / 测试 / 工作项检查 | 当前判定 |
|---|---|---|
| P0 | 合并即破坏 main、发布面或不可恢复数据 | 未发现 |
| P1 | 乱序提交、失败结算、事实拥有、跨层边界、外部写入安全 | 未发现；Fake/SQLite 竞态与失败排序均通过 |
| P2 | MMP 证据完整性、验收覆盖、反例可判别性、重复 issue | 已补齐；复评证据见下 |
| P3 | 文档/流程和后续跟踪 | 1 项建议，见下 |

## 锁定事实与工作项

`gh-review pr view 318` 读到：`mergeable=MERGEABLE`、`mergeStateStatus=CLEAN`、`isDraft=false`；当前 PR checks 全部通过，包括 `PR Fast Gate`、Boundaries、E2E、Integration、MVP-0、typecheck/contract、size、disclosure、Issue policy 和 Reconcile engineering state。没有已有 GitHub review 或 inline thread。

#305 当前仍为 OPEN，`closedByPullRequestsReferences` 已指向 PR #318；在 PR 合并前不把 issue 关闭当作已完成。检索到的相关工作项中，#216 是 pre-launch renewal 的父级范围，#189 已关闭且只负责 workspace-scoped sync facts，#202 负责切换 Planning source 后旧 projection 清理，均不是 #305 的重复 owner。#134 是调度 owner，ExecPlan 也明确本 PR 不新增 scheduler。

## 分层检查

### 代码与状态机

`packages/core/src/bootstrap.ts` 在 Provider IO 前通过 `beginSyncRound` 于 Storage transaction 内递增 `(workspaceId, bindingId, PLANNING_SYNC_SCOPE)` 的 round。Provider IO 在事务外执行。`commitSync` 在同一个 Storage transaction 内重新读取 round；若当前 `latestStartedRound` 已前进，返回结构化 `stale_revision`，不写 projection、membership、observation、revision、sync cursor 或 reconcile cursor。最新成功轮将 projection、revision、healthy cursor、reconcile cursor 和 `latestCommittedRound` 一起结算。

失败路径 `fail()` 同样在 transaction 内重新读取 round；旧失败轮不能覆盖较新轮的健康状态。最新失败轮只保留最后已知 projection，并写 `degraded`；旧成功轮随后提交仍被拒绝，因而不能伪装 fresh。

### 产品闭环

Planning 投影仍由 Host/Core 持有，Provider 只提供读取事实；提交前没有向调用方报告 Saved。新轮失败后的读侧结果为 stale/degraded，最后已知内容保留；完整对账即使没有事件仍从 Provider 全量读取。这个闭环符合 #305 的 acceptance 以及 AGENTS 的“Host 拥有权威状态”约束。

### 架构边界与 schema

新增 `PlanningSyncRoundRecord` 只通过 capabilities Storage port 暴露；Fake 与 SQLite 都实现同一端口。SQLite migration 007 建立独立 `planning_sync_round` 表，round token 不复用 provider cursor。主键为 `(workspace_id, binding_id, scope_key)`，`latest_committed_round` 有 `NULL 或 <= latest_started_round` 的 CHECK；Fake 与 SQLite 都拒绝 started/committed token 回退。未见 Provider→Provider、UI→Provider 或 Core→Storage 反向依赖。

### 测试与反例

已运行：

```text
node --test tests/integration/planning-round-order.test.js tests/integration/sync-revision-freshness.test.js tests/integration/workspace-sync-scope.test.js
88 passed, 0 failed

pnpm verify
1490 contract/integration/e2e tests passed；7 MVP-0 tests passed；typecheck passed
```

PR 自带的 `planning-round-order.test.js` 覆盖 Fake/SQLite：重启读回与 takeover、非法值域和单调约束、旧成功轮晚于新成功轮、旧失败轮晚于新成功轮、最新失败轮后旧成功轮仍被拒绝，以及失败结算的 transaction-scope round read。测试通过结构化错误、revision、reconcile cursor、健康/陈旧状态断言，具有判别性。

## P2 复评证据

1. **已修复：共享连接的 bootstrap 级双工作区竞态用例。** 新增 `tests/integration/planning-round-order.test.js` 用例，直接从 `bootstrapWorkspace` 入口并发启动两个 workspace，共享同一 Planning provider；先释放新 snapshot、再释放旧 snapshot，Fake 与 SQLite 均断言两个 workspace 各自提交自己的 round、projection、revision 与 reconcile cursor。

2. **已修复：commit-time round guard 的变异证明。** 运行 `node scripts/review-mutate.mjs /tmp/pr318-round-mutate.json --root .`，删除 `packages/core/src/bootstrap.ts` 的 superseded guard 后，4 个旧轮竞态用例变红；`killedBy` 命中“较旧 Planning snapshot 在较新 snapshot 后提交时被拒绝”，结果为 `KILLED`。变异文件已按字节恢复，工作树保留本次测试与文档修改。

## P3 建议

- PR 合并后按仓库流程把 active ExecPlan 移到 `docs/exec-plan/completed/` 并更新 `docs/README.md`，再回读 #305 的 closing reference 和 issue 状态。

## 结论

当前没有 P0/P1/P2。代码、失败排序、持久 round owner、Fake/SQLite parity、共享 provider 的双 workspace ordering、restart takeover、freshness/health/reconcile cursor、变异判别性和架构边界均有通过证据。按评审规则，结论为 **APPROVE**；不得把绿色 checks 单独当作产品闭环证明。
