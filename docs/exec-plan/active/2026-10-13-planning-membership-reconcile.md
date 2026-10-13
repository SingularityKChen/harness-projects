# Planning Membership Reconcile ExecPlan

> 状态：Active
> 创建：2026-10-13
> 范围：完成 issue #134A：为 Planning 全量对账提供 scope 内 membership 收敛端口，删除 provider 已移除的 membership/field values，同时保持 entity/external identity 稳定。
> 上游输入：AGENTS.md、PLANS.md、issue #134、#305、#220、#199、packages/core/src/bootstrap.ts、packages/capabilities/src/storage.ts。

## Purpose / Big Picture

完成后，一次成功的 Planning 全量读取会在同一 Storage transaction 内使 membership、projection 和 freshness 与 provider 完整集合一致：provider 删除条目后本地 membership 与 field values 消失，移除后重新加入保留原 content identity/entity id。失败或截断读取不做收敛。该 PR 是 #134 的前置独立闭环，供 #134B 复用，不实现 scheduler 或 explicit refresh command。

## Context and Orientation

当前 live origin/main=7c7e77cc 已包含 #305 round ordering、#220 revision freshness 与 #199 degraded failure。入口 packages/core/src/bootstrap.ts 会在一轮 full read 中 replace projections，但 project_item_membership 及其 field values 没有 scope replace；Fake 与 SQLite 的 Storage transaction 仅有 put/list，没有安全的 scope reconcile。#134 acceptance 的 provider 删除 item 后 membership 消失因此无法由当前接口满足。

Membership scope 必须是 workspaceId 加 planning project externalId，不能按 entity 全局删除；entity/external identity 要保留以支持 remove/re-add identity stability。#305 的 latest-started round fence、#220 的 same-projection revision policy 与 #199 的 failure retention 均保持不变。

## Design / Spec

- 在 capabilities Storage/StorageTransaction 契约新增 replacePlanningMemberships(scope, incoming)；输入是本轮完整 membership 集合。
- Fake 与 SQLite 在同一事务内删除 scope 中不在 incoming 的 membership 与 field values，再 upsert incoming；不删除 entity、external_identity、projection identity。
- bootstrap 的 commitSync 在 full read 成功且通过 #305 fence 后，先收敛 memberships，再 replace projections、cursor、health/revision；provider failure、分页不完整、Storage reject 不执行任何 scope deletion。
- 只接收已确认完整的 incoming 集合，redacted 也按其 membership 身份参与集合比较；不把 provider reconcile advisory stream 当作 correctness source。
- 不新增 migration；复用现有表和 delete/upsert SQL。若 SQLite 现有表约束证明无法表达 scope replace，暂停实现并记录阻塞，而不是偷偷引入双写/兼容层。

## Global Constraints

- PR 使用 Refs #134；#134B 在完整能力交付后使用 Closes #134，不能让两个 PR 都声称关闭同一 issue。
- 代码≤800行、文档≤1300行；#134A 不修改 scheduler/controller/apps。
- 不改 #305 round token、#220 revision semantics、#199 error redaction。
- TDD 先写 Fake/SQLite contract red tests，再实现 port/adapter/core callsite。
- 不写 Project Status、blocked-by、blocking；外部 write 仅在人类批准后执行。

## Plan of Work

### Batch 1 · Storage contract red tests

最小闭环：在 Storage contract 中加入 provider deletion scope/identity stability 的失败用例。

涉及文件：tests/contract/suites/storage-identity-membership.js、tests/contract/storage-contract.test.js、tests/integration/planning-membership-reconcile.test.js。

- 构造两个实体、同一 project scope、不同 membership；删除一个 provider item 后运行完整 bootstrap。
- 断言现实现仍保留 stale membership/field values，且 remove/re-add identity baseline 失败。
- Fake/SQLite 各自运行，确保测试失败原因是缺失 scope replace，而非 fixture 错误。

验证命令：
node --test tests/contract/storage-contract.test.js tests/integration/planning-membership-reconcile.test.js
期望：新增 deletion/identity tests 在未实现时失败，现有 storage contract 不退化。

回滚：删除新增 red tests。

### Batch 2 · Scope replace port and adapters

最小闭环：Fake 与 SQLite 在 tx 内提供同名 scope replace，删除 stale membership/field values，保留 entity/identity。

涉及文件：packages/capabilities/src/storage.ts、packages/capabilities/src/registry.ts、packages/providers/fake/src/storage.ts、packages/storage/sqlite/src/storage.ts。

- 按现有 Storage naming/transaction convention 固定参数与返回值。
- Fake 以 draft state 做删除/upsert；SQLite 以 scope predicate 做 delete/upsert。
- 验证删除范围只作用于 workspace+project external id；同 entity 出现在另一 scope 时不被误删。

验证命令：
node --test tests/contract/storage-contract.test.js tests/integration/identity-membership-schema.test.js
node_modules/.bin/tsc --noEmit
期望：Fake/SQLite 同一 contract 结果，删除 scope 外数据保持不变。

回滚：反向 port/adapter commit；无 migration。

### Batch 3 · Bootstrap convergence

最小闭环：成功 full read 将 incoming membership 传入 scope replace；失败/截断 round 保持 last-known state。

涉及文件：packages/core/src/bootstrap.ts、tests/integration/planning-membership-reconcile.test.js。

- 把 membership collection 与 projection upsert 共享同一 full-read completeness 判据。
- 保留 #305 latest-started fence；被拒绝旧 round 不执行 deletion。
- 添加 remove/re-add identity stability 与 field values 删除断言。

验证命令：
node --test tests/integration/planning-membership-reconcile.test.js tests/integration/planning-round-order.test.js tests/integration/sync-revision-freshness.test.js
pnpm run boundaries
期望：删除收敛、重加 identity 稳定、乱序/失败策略既有测试全绿。

回滚：反向 bootstrap callsite，保留已验证 port 可单独回滚。

### Batch 4 · 对抗验收与 draft linkage

最小闭环：验证截断、失败、scope 混淆与 mutation，创建 draft PR 作为 #134 stack bottom。

涉及文件：本计划、contract/integration tests。

- provider list 截断、page loop、transaction reject 必须不删 membership。
- mutation：删除 scope predicate、把 incoming 传空、误用 entity-global delete，均应被 contract/integration tests 杀死。
- 运行发布门禁并创建 draft PR，使用 Refs #134，回读 issue↔PR 与 Project agent-owned fields。

验证命令：
pnpm verify
node scripts/workflow-check.mjs
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD
期望：全绿；PR draft 不关闭 #134，#134B 后续使用 Closes #134。

回滚：反向提交，保留数据库不变；无 migration。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | provider deletion | membership 与 field values 消失 |
| 2 | identity stability | remove/re-add 保持 entity/external identity |
| 3 | failure safety | failure/truncation/old round 不执行 deletion |
| 4 | scope isolation | workspace+project scope 外数据保持 |
| 5 | adapter parity | Fake/SQLite contract 同结果 |
| 6 | revision policy | same-state 不增 revision，#305 fence 保持 |
| 7 | size/release | code≤800/docs≤1300，checks/disclosure/diff-clean |
| 8 | linkage | draft PR 使用 Refs #134；#134 未被提前关闭 |

## Progress

- [x] 2026-10-13：两份独立 #134 设计与总审阅完成，确定必须先做 membership scope replace。
- [ ] Batch 1–4 未实现；#134A draft 未创建。

## Surprises & Discoveries

- 2026-10-13：现有 replacePlanningProjections 只删 projection，不删 project_item_membership/field values；这是 issue #134 deletion acceptance 的直接根因。
- 2026-10-13：按 entity 全局删除会破坏跨 project scope，必须按 workspace+planning project external id 收敛。
- 2026-10-13：完整 membership incoming 只能在 provider full read 成功且分页完整后应用；失败 round 不能用空集合清空。

## Decision Log

- 2026-10-13：#134 拆为 A/B 两个 PR；A 只做 storage membership convergence，B 只做 refresh/scheduler。理由是共享契约、两适配器、core、controller、timer 一起改会超过 800 行且无法独立回滚。
- 2026-10-13：A 使用 scope replace 而不是 tx 外比较后逐条删除；同一事务内由完整 incoming 集合决定删除，避免竞态。
- 2026-10-13：A 使用 Refs #134；B 在完整能力交付后使用 Closes #134，防止 stack bottom 过早关闭 issue。

## Idempotence and Recovery

scope replace 在同一 tx 内可重复；相同集合不推进 revision。rebase/stack 冲突使用 git rebase --abort 和 backup ref。无 migration；回滚不删除 entity/external identity。

## Interfaces and Dependencies

Storage capability contract、Fake/SQLite adapters、bootstrap commitSync、#305 round fence、#220/#199 semantics、#134B refresh callback。不得依赖 #228/#214 文件。

## Outcomes & Retrospective

完成后回填 adapter parity、mutation、deletion/re-add、failure/truncation 与 current-head linkage；在 B 合并前保持 Active。

## Bottom Change Note

- 2026-10-13：创建 #134A ExecPlan，记录 membership scope replace 为 #134 的必要前置能力。
