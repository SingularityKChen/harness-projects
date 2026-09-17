# DeepSeek Harness Project Delivery MVP Delivery Plan v0.1

> 日期：2026-09-17  
> 当前状态：Pre-implementation；没有实际 repository working tree，因此本文件是 repository-neutral delivery control plan，而不是最终仓库级 ExecPlan。  
> 一旦获得目标仓库，必须把本计划映射到真实路径并生成 repository-native ExecPlan。

## Purpose / Big Picture

完成 MVP 后，用户可以从一个 GitHub Project 中看到真实 PlanningItem，打开一个 Issue-backed WorkItem，显式“开始工作”，创建本地 worktree / branch，启动 DeepSeek Harness Session，创建 GitHub PR，读取 GitHub Actions，并在 WorkItem Detail 与 Delivery 中看到完整交付谱系。

整个过程中：

- GitHub Projects 仍拥有 Planning state；
- Engineering state 不会污染 Planning；
- PR-backed Project item 不会被重复建模；
- Provider 失败只导致局部 degraded；
- 无 LLM 参与状态或关系控制。

## Progress

- [x] (2026-09-17 17:04 SGT) 产品 PRD v0.4 与 UI Spec v0.1 已完成。
- [x] (2026-09-17 17:04 SGT) Engineering Design v0.1、Schema v0.1、API Contract v0.1 已形成候选。
- [ ] 完成 GitHub Projects Identity & Sync Spike 并冻结 Schema v1。
- [ ] 在目标 repository 中完成 package / controller / storage reconnaissance。
- [ ] 建立 repository-native ExecPlan。
- [ ] 完成 Milestone 1：Domain + SQLite + Fake Providers。
- [ ] 完成 Milestone 2：GitHub Projects read projection。
- [ ] 完成 Milestone 3：Planning write + conflict handling。
- [ ] 完成 Milestone 4：Start Work + Local Git + Harness。
- [ ] 完成 Milestone 5：GitHub PR + Actions + Delivery Graph。
- [ ] 完成 Milestone 6：Client Model + minimum UI vertical slice。
- [ ] 完成 Milestone 7：Capability degradation + Diagnostics。
- [ ] 完成 Milestone 8：MVP planning views broadening。
- [ ] 通过 Release Gate R1。

## Surprises & Discoveries

- Observation: GitHub ProjectV2Item 允许 DraftIssue、Issue 和 PullRequest 作为内容，因此 membership 与内容对象必须分离。
  Evidence: GitHub GraphQL `ProjectV2ItemContent` union 与 `ProjectV2ItemType`。

- Observation: GitHub Projects webhook 当前仍有 public-preview / availability 限制，因此不能把 webhook 作为唯一同步正确性机制。
  Evidence: GitHub `projects_v2_item` webhook documentation。

## Decision Log

- Decision: 先做 identity/sync spike，再冻结数据库。
  Rationale: 身份模型一旦错误会污染全部关系和投影，是最早且影响最大的技术不确定性。
  Date/Author: 2026-09-17 17:04 SGT / ChatGPT

- Decision: MVP 使用 SQLite，不引入 Redis、Kafka 或独立搜索服务。
  Rationale: 当前 required property 是单 Host 权威状态与最终一致的 Provider projection，没有证据证明需要分布式基础设施。
  Date/Author: 2026-09-17 17:04 SGT / ChatGPT

- Decision: Webhook 只作为 low-latency hint，reconciliation 才是 correctness backstop。
  Rationale: Provider event coverage 与 delivery reliability 不能作为产品 correctness 前提。
  Date/Author: 2026-09-17 17:04 SGT / ChatGPT

## Outcomes & Retrospective

当前尚未进入代码实现。本计划的第一个可验证成果是 Gate E1：真实 GitHub 行为能够映射到 Schema v1，且不破坏 PlanningItem / WorkItem / ChangeRequest 身份不变量。

## Context and Orientation

目标产品有五类能力域：Planning、Development、Delivery、Execution、Storage。

Planning Source of Truth 在一个 Workspace 中只有一个。GitHub Projects 是 MVP 的主要 Planning Provider。Local Git 与 GitHub 是 Development Provider。GitHub Actions 是只读 Delivery Provider。DeepSeek Harness 与 Human 是 Execution Provider。

`ExecutionContext` 是 Planning WorkItem 进入 Engineering 的显式桥。用户点击“开始工作”后才创建 worktree、branch 和可选 Harness session。

MVP 不要求把所有视觉稿同时实现。视觉稿用于确保产品目标形态一致，实施必须按纵向价值链推进。

## Milestone 0: Identity / Sync Spike

先完成 `github-project-identity-spike-v0.1.md`。

Milestone 完成时必须存在一组可复现证据，证明：

- 同一 Issue 出现在多个 Project Workspace 时复用同一个 ExternalIdentity，且各 Workspace 本地 projection 不发生身份冲突；
- PR-backed Project item 指向 ChangeRequest；
- Draft → Issue 保持 WorkItem internal identity；
- webhook 缺失时 polling/reconciliation 最终正确；
- ambiguous create 不会盲目产生重复外部对象。

如果任何一项失败，修改 Schema / Contract 后重新验证。不要继续 Milestone 1。

## Milestone 1: Domain + SQLite + Fake Providers

建立最小 domain / core / storage 骨架。

预期模块概念：

```text
project-domain
project-capabilities
project-core
project-storage-sqlite
project-provider-fake
project-controller
project-client
```

结束时可以完全不接 GitHub，用 Fake Planning Provider 演示：

1. 创建 Workspace；
2. bootstrap 3 个 PlanningItem；
3. 一个 Issue-backed；
4. 一个 Draft-backed；
5. 一个 PR-backed；
6. 查询 ProjectItemProjection；
7. duplicate observation 不产生重复 entity；
8. restart 后 SQLite 能恢复同一 identity。

验收重点不是 UI，而是 identity 与 storage contract。

## Milestone 2: GitHub Projects Read Projection

实现 Planning GitHub Projects Provider 的 read path。

必须支持：

- Project；
- ProjectV2Item pagination；
- content union；
- field definitions；
- status；
- iteration；
- target date；
- raw custom fields；
- PR-backed membership。

结束时 UI/CLI debug surface 能展示真实 Project 列表，并证明 external ID 到 internal Entity ID 映射稳定。

## Milestone 3: Planning Write + Conflict Handling

实现：

- create Issue-backed WorkItem；
- create Draft；
- edit WorkItem content；
- update Project fields；
- move item / rank（若 Spike 证明可稳定支持）；
- permission denied；
- unknown result；
- conflict / stale write UI contract。

结束时不允许存在 optimistic authoritative state。

## Milestone 4: Start Work + Local Git + Harness

实现最关键产品动作：

```text
WorkItem
→ ExecutionContext
→ Worktree
→ Branch
→ Harness Session or Human fallback
```

必须验证：

- 同 WorkItem + Repo 重复 Start Work 不误建重复 active context；
- Git failure 不启动 Harness；
- Harness failure 保留 worktree 并转 manual_fallback；
- Worktree dirty 时 cleanup 不自动破坏用户修改；
- restart 后 ExecutionContext 仍可恢复。

## Milestone 5: GitHub PR + Actions + Delivery Graph

实现：

- GitHub ChangeRequest read/create；
- Branch / Commit / PR native lineage；
- Actions workflow run / checks read；
- Environment / Deployment 最小读取；
- `references / contributes_to / resolves` semantic relation；
- Delivery projection。

结束时一个 WorkItem 可以显示：

```text
WorkItem
→ ExecutionContext
→ Branch
→ Commit
→ PR
→ CI
→ Deployment
```

且 Planning status 仍来自 GitHub Projects。

## Milestone 6: Client Model + Minimum UI Vertical Slice

只实现首条链路所需的 UI：

- Projects Home；
- Workspace create；
- WorkItem List 或 Board（二选一先做 List）；
- unified WorkItem Detail Drawer；
- Start Work；
- ExecutionContext；
- Delivery；
- Settings / Access minimum；
- global Loading / Stale / Error patterns。

`project-client` 必须是 React-free；UI 不直接访问 Provider。

## Milestone 7: Degradation + Diagnostics

实现：

- capability snapshot；
- permission snapshot；
- provider health；
- stale / offline；
- sync status；
- candidate relation；
- mutation activity；
- provenance detail。

故障注入必须证明单个 Provider offline 不会让整个 Workspace 崩溃。

## Milestone 8: MVP Planning Views Broadening

在首条纵向链路稳定后再打开：

- Backlog；
- Sprint；
- Board；
- Kanban WIP；
- basic Roadmap；
- Milestones；
- Work Method；
- Relations UI。

Analytics 留到 V1。

## Validation and Acceptance

MVP 通过的用户级验收流程：

1. 新建 Project Workspace；
2. 连接 GitHub Project；
3. 看见 Issue、Draft、PR-backed items，类型正确；
4. 创建一个 Issue-backed WorkItem；
5. 编辑 Status / Iteration；
6. 刷新 GitHub 后两边一致；
7. Start Work；
8. worktree 与 branch 出现；
9. Harness Session 启动；
10. 创建 PR；
11. Actions 状态出现在 Delivery；
12. CI failure 不自动改变 Planning Status；
13. Provider 权限撤销后 Planning 退化为只读；
14. webhook 停止后 reconciliation 最终修正投影；
15. restart Host 后 identity、relation、ExecutionContext 不丢失。

## Idempotence and Recovery

所有 migration 必须可重复检查版本。

所有 Provider event 必须 dedupe。

所有外部 create 在结果 unknown 时先 reconcile，不盲目重放。

所有外部 update 在 conflict 时保留 Last Known Authoritative Value。

所有 Start Work 重试必须识别已经存在的 ExecutionContext / worktree / branch。

## Interfaces and Dependencies

必须最终存在以下稳定能力：

```text
PlanningProvider
DevelopmentProvider
DeliveryProvider
ExecutionProvider
Storage
ProjectQueries
ProjectCommands
ProjectRemoteAPI
```

具体 repository path 在仓库 reconnaissance 后冻结。

## Bottom Change Note

2026-09-17：首次创建。原因：产品与视觉设计已经冻结，需要把工作从页面驱动切换到 identity-first vertical slice delivery。
