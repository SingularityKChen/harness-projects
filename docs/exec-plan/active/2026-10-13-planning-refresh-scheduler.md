# Planning Refresh Scheduler ExecPlan

> 状态：Active
> 创建：2026-10-13
> 范围：完成 issue #134B：在 #134A 的 membership scope contract 之上提供 explicit refresh 与 bounded periodic scheduler；复用现有 bootstrap/fence，不实现 Host UI 或 watch。
> 上游输入：AGENTS.md、PLANS.md、issue #134、#134A ExecPlan、#305、ADR-0003、ADR-0012、packages/core/src/context.ts、packages/core/src/bootstrap.ts、packages/controller/src/commands.ts。

## Purpose / Big Picture

完成后，Planning binding 有一个真实的显式 refresh 命令和一个可停止、单飞、有限周期的 scheduler。无事件时 provider 字段变化会在下一轮出现；失败保留最后确认 projection 并标记 stale/degraded；同内容重复轮不推进 revision；旧结果不能覆盖新轮。refresh 只读 provider，不调用任何 provider write。#134B 以 #134A 为唯一产品依赖，保持可独立回滚。

## Context and Orientation

#305 已在 packages/core/src/bootstrap.ts 提供 latest-started round token 与 commit-time fence；#220 已统一 same-projection revision 规则；#199 已把 provider/storage 失败变成结构化 degraded 并保留 last-known。当前 CoreCommands 只有 bootstrapWorkspace，controller command 有 replay/idempotency 语义；直接复用 replay 会让手动 refresh 可能返回旧结果，因此 refresh 必须是独立 local-only command。#134A 提供成功 full read 的 membership scope convergence。

## Design / Spec

- 新增 core-owned refreshPlanning 或等价明确命名 command，复用 full read+commit，不重复 #305 round logic。
- 新增 host-neutral PlanningReconciler：每个 workspaceId/bindingId 一个 in-flight Promise；tick、triggerNow、显式 command 共享同一单槽；再次触发返回同一 Promise，不并发 provider read。
- scheduler 显式 start/stop/dispose，由 host lifecycle 接线；不在 composeCore 隐藏 setInterval，避免 timer 泄漏和测试挂起；timer 使用 bounded interval，必要时 unref。
- provider reconcile 仍是 advisory observation，不作为 correctness source；权威仍是 getProject/listPlanningItems 全量读取。
- 新轮成功后才写 reconcile cursor/healthy；失败保留 rows/membership，只有仍为 latest round 时才更新 stale/degraded；被 superseded 的失败不能把 newer success 退回 degraded。
- refresh 不写 status policy、不调用 provider write；#134A 的 scope replace 只在完整成功读后生效。

## Global Constraints

- PR base 是 #134A，使用 Closes #134；#134A 使用 Refs #134。两个 PR 都必须保持可独立审阅和回滚。
- 代码≤800行、文档≤1300行；不修改 #305 round fence、#228 host composition、#214 git provisioning。
- TDD 先写 single-flight/scheduler/refresh red tests；不使用真实 sleep 作为唯一判据。
- 不写 Project Status、blocked-by、blocking；#134A 合并前先回读其 current head/base/checks。

## Plan of Work

### Batch 1 · Refresh API red contract

最小闭环：为 explicit refresh、no provider write、same-state revision 和 failure stale 写失败测试。

涉及文件：packages/core/src/context.ts、packages/controller/src/commands.ts、tests/integration/planning-refresh-scheduler.test.js、tests/e2e/controller-roundtrip.test.js。

- 先写独立 refresh command 测试，证明现有 bootstrap/replay 不能替代 explicit refresh。
- 加 provider write spy，断言 refresh 只调用 full read。
- 加失败保留 last-known/stale→success clear 与 same-state revision tests。

验证命令：
node --test tests/integration/planning-refresh-scheduler.test.js tests/e2e/controller-roundtrip.test.js
期望：未实现 refresh API 时失败，失败原因是缺失 command/行为而非 fixture 解析。

回滚：删除新增 tests。

### Batch 2 · Core reconciler single-flight and lifecycle

最小闭环：实现 host-neutral start/triggerNow/stop/dispose，保证同 scope 单飞、停止后不再开启新轮次。

涉及文件：packages/core/src/planning-reconcile.ts 或 bootstrap 内薄 runner、packages/core/src/context.ts、packages/core/src/index.ts。

- 以 injected timer/clock 使 fake time 可控。
- tick 与 explicit trigger 共享 in-flight Promise。
- stop/dispose 解除 timer；in-flight completion 仍按 #305 fence 提交或被拒绝。

验证命令：
node --test tests/integration/planning-refresh-scheduler.test.js
node_modules/.bin/tsc --noEmit
期望：并发触发 provider read count=1；dispose 后 read count 不再增加。

回滚：反向 scheduler/lifecycle commit，#134A scope contract 保留。

### Batch 3 · Controller wiring and adversarial policy

最小闭环：controller 暴露 local-only refresh，验证 late success/failure、status policy、same revision 与 no-write。

涉及文件：packages/controller/src/commands.ts、packages/controller/src/index.ts、相关 integration/e2e tests。

- refresh 不进入旧 replay cache；每次新的显式调用都真实读 provider。
- newest success/old success、new failure/old success、old failure/new success 复用 #305 policy tests，不重写 round implementation。
- malformed/truncated provider read、Storage reject、permission/unavailable 全部 fail closed。

验证命令：
node --test tests/integration/planning-refresh-scheduler.test.js tests/integration/planning-round-order.test.js tests/integration/sync-revision-freshness.test.js
pnpm run boundaries
期望：single-flight、late result、stale/freshness、no-write 全绿。

回滚：反向 controller/core wiring；保留 #134A adapter capability。

### Batch 4 · 发布门与 stacked draft/ready

最小闭环：在 #134A current head 上重锁，完成 full validation，创建 stacked draft PR，再经过独立验收后 ready。

涉及文件：本计划与 tests。

- 验证 #134A current head/base/checks/threads，确认它已具备 membership contract。
- 运行 full verify、workflow、disclosure、size、diff-check。
- 创建 draft PR，回读 Closes #134、#134 issue reverse link、Project ExecPlan/Batch/Engineering 等 agent-owned fields。

验证命令：
pnpm verify
node scripts/workflow-check.mjs
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD
期望：全绿；PR base 指向 #134A 分支，未沿用历史 checks。

回滚：反向 scheduler/controller commits；不删数据库、不改变外部 provider。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | explicit refresh | field change with no event appears after refresh |
| 2 | periodic schedule | bounded tick triggers at most one in-flight round |
| 3 | failure semantics | last-known retained, stale/degraded; success clears |
| 4 | no provider write | write spy call count zero |
| 5 | same-state idempotence | entity/membership/revision unchanged |
| 6 | late result fencing | old result cannot overwrite newer content/health |
| 7 | lifecycle | stop/dispose prevents future ticks and closes timer |
| 8 | stacked linkage/release | #134A bottom + #134B top, checks/current refs read back |

## Progress

- [x] 2026-10-13：两份独立设计与总审阅完成；确定 #134B 必须在 #134A 之上。
- [ ] Batch 1–4 未实现；stack 未创建。

## Surprises & Discoveries

- 2026-10-13：Controller 的现有 command replay 语义不适合 explicit refresh；必须声明 local-only refresh。
- 2026-10-13：不能把 provider reconcile advisory stream 当作 correctness；GitHub Project 没有可靠 webhook scope，updatedAt 也不是增量 cursor。
- 2026-10-13：#305 已覆盖 round policy，#134B 只需消费该 fence，不重写旧机制。

## Decision Log

- 2026-10-13：#134 使用 A→B 两层 stack；A 是 membership/storage contract，B 是 refresh/scheduler。理由是独立回滚和 800 行硬门。
- 2026-10-13：scheduler 不隐藏在 composeCore；由 host lifecycle 显式 start/stop/dispose，避免不可见 timer 泄漏。
- 2026-10-13：refresh 走独立 local-only command，不复用 replay cache；显式 refresh 的语义是一次真实读取。
- 2026-10-13：不修改 #305 round implementation；通过 tests 复用其 latest-started/late-failure policy。

## Idempotence and Recovery

single-flight state machine 可重复 start/stop；triggerNow 在运行中复用同一 Promise。stack rebase 前保留 A head backup ref；冲突用 abort。回滚 B 不影响 A 的已验证 membership contract，无 migration。

## Interfaces and Dependencies

#134A scope replace、#305 round fence、#220/#199 freshness/error、CoreCommands、ControllerCommands、host lifecycle（未来 #228）、fake timer/provider write spies。

## Outcomes & Retrospective

完成后回填 scheduler timing、single-flight count、late result policy、controller wire 与 full gate 输出；在 #134A/#134B 均未验收前保持 Active。

## Bottom Change Note

- 2026-10-13：创建 #134B ExecPlan，记录 explicit refresh/local-only 与 scheduler single-flight 的交付边界。
