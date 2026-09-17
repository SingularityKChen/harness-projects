# Architecture Decisions v0.1

> 日期：2026-09-17  
> 状态：Accepted for Engineering Spike；Schema v1 冻结前允许根据真实证据修订。

## ADR-001：Host authoritative，Client 只维护镜像

**Decision**

Project Core、SQLite、mutation ordering、access policy 和 stream production 位于 Host。Client Model 只维护 React-free snapshot / delta 镜像。

**Why**

这与 DeepSeek Harness 当前 Web Client 的所有权方向一致，也允许 Harness 内嵌和独立 Web 共享业务模型。

**Rejected**

- React Store 作为业务事实源；
- UI 直接调用 GitHub / Jira。

## ADR-002：ConnectorAccount 与 ProviderBinding 分离

**Decision**

凭据连接与 Workspace 能力角色拆开。

**Why**

同一 GitHub installation 可以同时承担 Planning、Development、Delivery；角色变化不应复制 credential。

## ADR-003：建立 ExternalIdentity 注册表

**Decision**

内部 Entity ID 与外部对象 ID 分离，并允许一个 Entity 拥有 primary / alias / historical external identity。

**Why**

必须正确处理 Draft → Issue、外部对象迁移与多 Project membership。

## ADR-004：PlanningItem 与 WorkItem / ChangeRequest 分离

**Decision**

Project membership 是 PlanningItem；内容对象是 WorkItem 或 ChangeRequest。

**Why**

GitHub ProjectV2Item content 当前可以是 DraftIssue、Issue、PullRequest。同一个 Issue 也可以属于多个 Project。

## ADR-005：SQLite current-state model，不采用 Event Sourcing

**Decision**

SQLite 保存当前 projection、local control state、provider event inbox、mutation attempts 与 activity projection。

**Why**

当前需求是可靠恢复和可解释性，不需要从事件日志重建全部业务状态。完整 Event Sourcing 会提高 schema、migration 与 debugging 成本，却没有对应 required property。

## ADR-006：Webhook 是 accelerator，不是 correctness dependency

**Decision**

所有 Provider 必须支持周期 reconciliation / explicit refresh；webhook 只降低延迟。

**Why**

外部 webhook 可能丢失、重复、延迟或不覆盖全部平台范围。

## ADR-007：Provider write 先确认，再更新 authoritative projection

**Decision**

UI 可显示 Saving，但只有 Provider ack / reconcile 后才显示 Saved。

**Why**

本地缓存不能篡位成为外部事实源。

## ADR-008：External create 的 ambiguous result 不自动重试

**Decision**

当网络断开导致“可能已创建成功”时，mutation 进入 unknown 并先 reconcile。

**Why**

盲目 retry 可能生成重复 Issue / PR。

## ADR-009：Capability ∩ Permission ∩ Policy 决定 Effective Access

**Decision**

UI 与 Core 使用稳定 capability key；Provider 名称不是业务分支条件。

**Why**

这是 Jira / GitHub / Local 能平滑替换的前提。

## ADR-010：Start Work 使用补偿式编排，不追求跨系统 ACID

**Decision**

先创建 pending ExecutionContext，再创建 Git worktree/branch，再启动 Harness。Harness failure 降级 manual_fallback。

**Why**

SQLite、Git、Harness 不存在共同事务管理器。补偿式流程比伪事务更真实、更可恢复。

## ADR-011：MVP 不引入 Redis / Queue / Search Service

**Decision**

优先 SQLite WAL、Provider pagination、incremental projection、client delta stream。

**Why**

尚无真实负载证据表明单 Host 模型不足。

## ADR-012：最终 repository-level ExecPlan 必须在真实仓库上生成

**Decision**

当前 Delivery Plan 是 repository-neutral。拿到实际仓库后必须读取 AGENTS.md / PLANS.md、确认 package 路径与测试命令，再生成正式 ExecPlan。

**Why**

仓库级执行计划必须让一个无上下文的实现者可以按真实路径完成任务，不能用假路径冒充执行规格。
