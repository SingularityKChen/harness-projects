# ADR-0003：事件不是正确性机制，对账是

> 状态：Proposed
> 日期：2026-09-21
> 来源：`docs/exec-plan/completed/2026-09-21-gate-e1-ruling.md`（Batch 1，issue #25）；证据见 `docs/architecture/gate-e1-write-and-events.md`（E1-3 / #24）

## Decision

1. 事件投递（webhook / 推送）只作为同步的**加速器**，不作为正确性机制；任何依赖"收到事件才会收敛"的设计都不成立。
2. 同步的正确性由**周期性全量对账**提供：按 `(project, content)` 列出当前条目集合与字段值，与本地投影逐项比对，差异只在"集合成员不同"或"某字段值不同"时产生。
3. 对账游标 `reconcile_cursor` 的语义是"上次全量对账时刻"，**不得**用平台对象的 `updated_at` 作为增量游标。
4. 重复观察按稳定自然键幂等 upsert；乱序观察按 `sync_observation` 的规则处理（拒绝更旧的 `updated_at`，相等时整快照替换）。

## Why

- E1-3 实验 2 §4.1 实测 `projects_v2_item` 在仓库 webhook 上被显式拒绝：HTTP `422`，原文 `These events are not allowed for this hook: projects_v2_item`；同一次会话里 `pull_request` / `issues` 订阅成功（§4.2，HTTP `201`），说明这是事件白名单限制，不是权限不足。
- E1-3 实验 2 §4.3 实测其他作用域都给不出项目条目事件：组织端点 `404`（沙箱 owner 是 user，不是 organization），用户级与 project 级端点都不存在。
- E1-3 实验 2 §4.4 实测 legacy `project` / `project_card` / `project_column` 事件名被接受（各返回 `201`），但它们属于 classic Projects；本批次没有观察到它们因 Project v2 的字段写入而投递。
- E1-3 实验 1 §4.3、§4.4 实测 `ProjectV2Item.updatedAt` 的语义：同值重写四次不推进；连续四次真实改变中两次落在同一秒，`updatedAt` 相同。E1-3 实验 2 §4.6 据此判定"`updatedAt` 不足以定序"，也就不能做增量游标。
- E1-3 实验 3 §4.1、§4.2 实测 `(project, content)` 在平台侧唯一、重复加入的计数为 1，因此对账重跑不会制造重复成员关系——这是"对账可以安全地周期性重跑"的前提。

## Rejected

- **把 webhook 当作唯一同步驱动**：项目条目事件订不到（上面前两条），依赖它的设计在真实平台上无法收敛。
- **用 `updated_at` 做增量游标**：秒级 + 同秒碰撞 + 同值不推进，三者叠加使"按时间戳拉增量"不可靠。
- **用 legacy `project*` 事件替代**：订阅被接受不等于能收到 Project v2 事件，本批次没有观察到对应投递。
- **把"事件不可用"当作本批次的失败**：issue #24 Notes 的表述是 "Event delivery is an accelerator here, never the correctness mechanism"；结论是正确性路径改为对账，不是降低证据标准。

## Consequences

- 需要 `reconcile_cursor` 表（`UNIQUE(workspace_id)`），以及对账的固定入口；同步收敛不依赖任何订阅状态。
- 需要 `webhook_subscription` 表记录订阅尝试与结果；该表不得成为 `planning_field_value` 或 `project_item_membership` 的唯一更新来源。
- 事件订阅失败或根本不可订时，必须有一条显式降级路径，且同步仍收敛。
- 乱序与重复的处理落在 `sync_observation` 上，不落在事件序上：观察自带本地接收时刻，`updated_at` 相等时整快照替换。
- 对账的成本是全量比对，不能靠时间戳裁剪；分页边界尚未观测（E1-1 实验 3 §3），跨页行为落地前不得假设单页足够。
