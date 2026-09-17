# GitHub Projects Identity & Sync Spike v0.1

> 日期：2026-09-17  
> 性质：实现前强制验证，不是产品功能  
> 目标：用最小真实实验确认 Schema v1 与 GitHub Projects 真实对象模型兼容。

## 1. 为什么必须先做

本项目最危险的错误不是页面不好看，而是把：

- ProjectV2Item；
- Issue；
- DraftIssue；
- PullRequest；
- 同一 Issue 在不同 Project 中的 membership

错误地折叠成一个 WorkItem。

一旦 identity 错误进入数据库，后续 Relation、Activity、Write Conflict、Deployment lineage 都会建立在错误主键上，修复成本远高于先做一个小型 spike。

## 2. Spike 环境

建议使用一个独立 GitHub organization / sandbox repository，不使用生产项目。

准备：

- Project A；
- Project B；
- Repo `project-delivery-spike`；
- GitHub App 或测试凭据；
- 一个 webhook receiver；
- 一个临时 SQLite 数据库。

Project A 中建立 Status、Priority、Iteration、Target Date 字段。

## 3. 实验 A：Issue-backed Item

步骤：

1. 创建 Issue `#1`；
2. 添加到 Project A；
3. GraphQL 拉取 ProjectV2Item；
4. 记录 ProjectV2Item ID；
5. 记录 Issue Node ID；
6. 写入 SQLite：
   - PlanningItem；
   - WorkItem；
   - 两个不同 ExternalIdentity；
   - `PlanningItem.content_entity_id = WorkItem.id`。

通过标准：

- PlanningItem ID 与 WorkItem ID 不相同；
- status / iteration 位于 PlanningItem；
- title / body 位于 WorkItem；
- UI projection 能组合成一个 ProjectItemProjection。

## 4. 实验 B：同一 Issue 加入两个 Project Workspace

步骤：

1. 把 Issue `#1` 再加入 Project B；
2. 为 Project A、Project B 分别建立两个 Project Workspace；
3. 使用同一个 GitHub ConnectorAccount 同步两边。

MVP 通过标准：

```text
ExternalIdentity(issue #1) count = 1
Workspace A local WorkItem projection = 1
Workspace B local WorkItem projection = 1
PlanningItem count = 2
```

两个 Workspace 的 PlanningItem 可以拥有不同 Status / Iteration。它们不会共享 ExecutionContext 或本地状态策略，但必须解析到同一个 GitHub external content identity。

该实验验证的是“membership 不等于 content identity”，而不是要求 MVP 构建跨 Workspace 的 global WorkItem aggregate。

## 5. 实验 C：PR-backed Item

步骤：

1. 创建 PR `#2`；
2. 把 PR 加入 Project A；
3. 同步。

通过标准：

```text
PlanningItem.content_kind = change_request
PlanningItem.content_entity_id = ChangeRequest.id
```

不得创建第二个 WorkItem。

## 6. 实验 D：Draft-backed Item

步骤：

1. 使用 `addProjectV2DraftIssue` 创建 Draft；
2. 同步；
3. 建立内部 WorkItem W-DRAFT；
4. 验证 Draft external identity 绑定 W-DRAFT。

通过标准：

- Draft 可以作为 WorkItem 使用；
- 没有 Repository 时 Start Work 必须要求用户显式选择项目已连接 Repository。

## 7. 实验 E：Draft → Issue

步骤：

1. 调用 `convertProjectV2DraftIssueItemToIssue`；
2. 重新同步；
3. 检查 ProjectV2Item / Issue identity；
4. 更新 entity external aliases。

通过标准：

```text
internal WorkItem ID before == internal WorkItem ID after
```

Draft identity 变为 historical alias；Issue identity 变为 primary。

如果 GitHub 实际 mutation 返回的 ProjectV2Item ID 发生变化，也只能更新 membership identity，不能重建 WorkItem。

## 8. 实验 F：Project 字段写入

至少验证：

- Status；
- Iteration；
- Target Date；
- position / rank。

记录：

- mutation request；
- mutation response；
- read-after-write；
- observed updated_at / version-like field。

通过标准：

- API Contract 不依赖一个 GitHub 实际不存在的 CAS 字段；
- UI 的 `Saving → Confirmed/Reconciled` 能有明确实现。

## 9. 实验 G：Webhook

订阅：

- `projects_v2_item`；
- pull request；
- workflow_run / check suite（视 GitHub App 支持配置）。

验证：

- Project item field edit 是否产生预期事件；
- event payload 是否足够直接更新 projection；
- duplicate delivery；
- out-of-order 模拟。

特别记录：

> 当前 GitHub 文档将 Projects webhook 标为 public preview，并将 `projects_v2_item` 描述为 organization-level project 事件，因此 user-owned Project 必须有 polling / reconciliation fallback。

通过标准：

- 关闭 webhook 后，周期 reconciliation 最终修正所有状态；
- webhook 永远只是加速器。

## 10. 实验 H：Ambiguous Create

模拟：

1. 发起 create Issue；
2. Provider 已创建成功；
3. 客户端在收到成功响应前断连；
4. mutation state 变为 `unknown`。

验证恢复流程：

- 不盲目重试 create；
- 先通过 external correlation / query 尝试确认；
- 只有确认未创建后才允许新 attempt。

如果 GitHub 无法提供可靠恢复自然键，MVP 必须把该场景暴露为“结果不确定，需要刷新/人工核对”，而不是冒险制造重复 Issue。

## 11. 结果记录模板

每个实验记录：

```text
Experiment:
GitHub API:
Observed IDs:
Observed timestamps:
Webhook behavior:
SQLite rows:
Unexpected behavior:
Decision impact:
Pass / Fail:
```

## 12. Gate E1

全部通过才冻结 schema v1。

允许的结果不是“GitHub 行为必须符合当前设计”，而是：

> 当前设计必须能够在不破坏产品不变量的前提下容纳实际 GitHub 行为。

若失败，优先修正 Engineering Design / Schema，而不是在 Provider 中堆特殊 case。
