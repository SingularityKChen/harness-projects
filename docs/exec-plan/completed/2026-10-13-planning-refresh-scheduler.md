# Planning Refresh Scheduler ExecPlan

> 状态：Completed（2026-10-14 归档，随 PR #331 收尾；Host 侧由 #335 承接）
> 创建：2026-10-13
> 范围：完成 issue #334：在 #134A 的 membership scope contract 之上提供 explicit refresh 与 bounded periodic scheduler；复用现有 bootstrap/fence，不实现 Host UI 或 watch。真实 Host lifecycle 与工作区 scheduled acceptance 移交 #335，#134 保持总能力 issue。
> 上游输入：AGENTS.md、PLANS.md、issue #134、#134A ExecPlan、#305、ADR-0003、ADR-0012、packages/core/src/context.ts、packages/core/src/bootstrap.ts、packages/controller/src/commands.ts。

## Purpose / Big Picture

完成后，Core 层有一个真实的显式 refresh 命令和一个可停止、单飞、有限周期的 Host-neutral scheduler primitive。无事件时 provider 字段变化可由显式或触发器读取；失败保留最后确认 projection 并标记 stale/degraded；同内容重复轮不推进 revision；旧结果不能覆盖新轮。refresh 只读 provider，不调用任何 provider write。#334 以 #134A 为唯一产品依赖，保持可独立回滚；#335 负责把它接入真实 Host lifecycle。

## Context and Orientation

#305 已在 packages/core/src/bootstrap.ts 提供 latest-started round token 与 commit-time fence；#220 已统一 same-projection revision 规则；#199 已把 provider/storage 失败变成结构化 degraded 并保留 last-known。当前 CoreCommands 只有 bootstrapWorkspace，controller command 有 replay/idempotency 语义；直接复用 replay 会让手动 refresh 可能返回旧结果，因此 refresh 必须是独立 local-only command。#134A 提供成功 full read 的 membership scope convergence。

## Design / Spec

- 新增 core-owned refreshPlanning 或等价明确命名 command，复用 full read+commit，不重复 #305 round logic。
- 新增 host-neutral PlanningReconciler：每个 workspaceId/bindingId 一个 in-flight Promise；tick、triggerNow、显式 command 共享同一单槽；再次触发返回同一 Promise，不并发 provider read。**Superseded in part by `Decision Log` 2026-10-14（单槽范围）**：「显式 command」只指 `refreshPlanning`（Core `core.commands.refreshPlanning` 与 Controller `commands.refreshPlanning`）；既有 `bootstrapWorkspace` 命令保持原语义，每次调用独立一轮、不进单槽，与刷新并发时由 #305 的轮次栅栏裁决。
- 定时 tick 没有调用方：一轮被拒绝（双重故障 TD-031、编程错误）时，先把原拒绝交给 `PlanningReconcilerOptions.diagnostics.syncRoundFailed`（与 `CoreDeps.diagnostics` 同一契约，宿主传同一个对象）再吞掉；钩子同步抛出或返回被拒绝的 promise 不改变调度、不被等待；显式 `triggerNow()` 的拒绝只交给调用方。固定间隔重试，不做退避（理由与承接见 `Decision Log` 2026-10-14（退避））。
- scheduler 显式 start/stop/dispose，由 host lifecycle 接线；不在 composeCore 隐藏 setInterval，避免 timer 泄漏和测试挂起；timer 使用 bounded interval，必要时 unref。
- provider reconcile 仍是 advisory observation，不作为 correctness source；权威仍是 getProject/listPlanningItems 全量读取。
- 新轮成功后才写 reconcile cursor/healthy；失败保留 rows/membership，只有仍为 latest round 时才更新 stale/degraded；被 superseded 的失败不能把 newer success 退回 degraded。
- refresh 不写 status policy、不调用 provider write；#134A 的 scope replace 只在完整成功读后生效。

## Global Constraints

- PR base 是 #330（#134A），本 PR 使用 Closes #334 + Refs #134；#330 使用 Closes #332 + Refs #134。#335 另行承接 Host lifecycle，不让本 PR 提前关闭 #134。
- 代码≤800行、文档≤1300行；不修改 #305 round fence、#228 host composition、#214 git provisioning。
- TDD 先写 single-flight/scheduler/refresh red tests；不使用真实 sleep 作为唯一判据。
- 不写 Project Status、blocked-by、blocking；#134A 合并前先回读其 current head/base/checks。

## Plan of Work

## Concrete Steps

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

### Batch 4 · 独立闭环与 Host 转交

最小闭环：在 #134A current head 上重锁，完成 Core 侧验证，补 source/lifecycle 对抗证据，修正本 PR linkage，并把真实工作区 scheduled acceptance 明确转交 #335。

涉及文件：本计划与 tests。

- 验证 #134A current head/base/checks/threads，确认它已具备 membership contract。
- 运行 full verify、workflow、disclosure、size、diff-check。
- 回读 Closes #334、Refs #134、#334 reverse link 与 #335 转交；不写 Project Status、blocked-by 或 blocking。

验证命令：
pnpm verify
node scripts/workflow-check.mjs
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD
期望：全绿；PR base 指向 #134A 分支，未沿用历史 checks；#134 仍为 OPEN，直到 #335 的 Host acceptance 完成。

回滚：反向 scheduler/controller commits；不删数据库、不改变外部 provider。

### Batch 5 · 评审修复（2026-10-14）

最小闭环：处置第二轮 MMP 评审的 2 × P2 与 9 × P3 inline 意见；定时 tick 的拒绝交给宿主诊断出口，补齐单飞槽释放、interval 边界、Controller 共槽、no-write 五个写方法与不挂起等待的判别用例，订正文档与易失证据。

涉及文件：`packages/core/src/planning-reconcile.ts`、`packages/core/src/context.ts`（注释）、`packages/controller/src/commands.ts`（注释）、`tests/integration/planning-refresh-scheduler.test.js` 与本计划。不改 #330 的文件（`packages/core/src/bootstrap.ts`、`packages/storage/sqlite/src/storage-sync.ts`、fake storage、#330 的 ExecPlan 与测试）。

验证命令（在检出 `docs/planning-refresh-scheduler-plan` 的工作树根目录运行）：
node --test --test-timeout=120000 tests/integration/planning-refresh-scheduler.test.js
node scripts/review-mutate.mjs <spec> --root .
期望：scheduler 用例全绿；变异整表除四个等价变异外全部 KILLED（spec 形状与读数见 `Outcomes & Retrospective` 的 2026-10-14 小节）。

回滚：反向本批三个提交（实现 + 用例、用例补齐、注释订正）；恢复锚点为本地分支 `backup/pr331-before-review-fix-20261014`。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | explicit refresh | field change with no event appears after refresh |
| 2 | periodic scheduler primitive | bounded tick triggers at most one in-flight round; Host reachability is #335 |
| 3 | failure semantics | last-known retained, stale/degraded; success clears |
| 4 | no provider write | write spy call count zero |
| 5 | same-state idempotence | entity/membership/revision unchanged |
| 6 | late result fencing | old result cannot overwrite newer content/health |
| 7 | lifecycle | stop/dispose prevents future ticks and closes timer |
| 8 | linkage/release | #134A bottom + #334 top; #335 owns Host scheduled acceptance and #134 remains open |
| 9 | scheduled failure reaches the host | 定时 tick 的拒绝恰好一次交给 `diagnostics.syncRoundFailed`（原对象）；钩子失败不停调度、无未处理拒绝；显式触发只拒绝给调用方 |

## Progress

- [x] 2026-10-13：两份独立设计与总审阅完成；确定 #334 必须在 #134A 之上，真实 Host acceptance 单独交给 #335。
- [x] 2026-10-13：Batch 1 完成 explicit refresh、no-provider-write、same-state revision、failure stale/success recovery 与 controller local-only red/green tests。
- [x] 2026-10-13：Batch 2 完成 host-neutral single-flight reconciler，支持 injected timer、start/stop/dispose 与 tick/explicit trigger 共享 in-flight。
- [x] 2026-10-13：Batch 3 完成 Core refresh command 与 Controller local-only wiring；复用 #305 round fence，未改 #228/#214。
- [x] 2026-10-13：补 source-level single-flight、fake-timer stale callback 与 idempotent lifecycle 判别测试；两项定向 mutation 均 KILLED。
- [x] 2026-10-13：创建 #334（Core 独立闭环）与 #335（Host lifecycle scheduled acceptance），本 PR linkage 改为 Closes #334 + Refs #134。
- [x] 2026-10-13：当前 head 复评先以临时 Fake Storage 反例复现跨 project redacted item 被提交（回归为 `ok: true`、revision 推进），随后恢复 #330 的整批 project scope 校验，并补回 Fake/SQLite 判别测试；focused suite 14/14 通过。
- [x] 2026-10-13：Batch 4 的 Core 侧 full release gates 与当前 head linkage 回读完成；真实 Host scheduled acceptance 仍由 #335 承接。
- [x] 2026-10-14：人类伙伴把 #328–#331 的修复与收尾 owner 指定给本会话（问「四个 PR 的修复与收尾由谁负责？」，答「本会话负责（推荐）」）；本 PR 的修复只在本层文件内进行，base（#330）由另一位实施者并行修复。
- [x] 2026-10-14：Batch 5 完成。先写红用例（三条诊断出口用例在实现前因钩子 0 次调用而失败），再实现 `PlanningReconcilerOptions.diagnostics`；其余用例补齐与注释订正见 `Decision Log` 2026-10-14 的处置表；最终树证据见 `Outcomes & Retrospective` 的 2026-10-14 小节。
- [ ] 本 PR 收尾：修复本身的独立复评 → 归档本计划到 `docs/exec-plan/completed/` 并更新 `docs/README.md` → 整合提交 → 勾选 #334 验收；合并需人类伙伴授权。

## Surprises & Discoveries

- 2026-10-13：Controller 的现有 command replay 语义不适合 explicit refresh；必须声明 local-only refresh。
- 2026-10-13：不能把 provider reconcile advisory stream 当作 correctness；GitHub Project 没有可靠 webhook scope，updatedAt 也不是增量 cursor。
- 2026-10-13：#305 已覆盖 round policy，#134B 只需消费该 fence，不重写旧机制。
- 2026-10-13：#329 的 Host composition 尚未进入 #330/#331 的 base；当前 `apps/harness-plugin/src/host.ts` 仍只有 ready 占位 apply，直接接线会形成不可达的假闭环。
- 2026-10-13：评审要求的真实工作区 scheduled acceptance 移交 #335；#134 不能由 Core-only PR 关闭。
- 2026-10-13：#331 初始实现删除了 #330 的 `validatePlanningItems` 与 cross-project redacted regression，虽然 scheduler focused tests 仍全绿，但 stacked union 会重新允许 scope 混淆进入 `commitSync`；这不是 scheduler 范围内的可接受删减，已恢复并记录为本次 head 修复。
- 2026-10-13：独立复评发现 top PR 不应回写 bottom #330 ExecPlan 的完成事实；底层计划保持已完成状态，当前 head 的门禁与链接证据只记录在本计划。
- 2026-10-14：定时 tick 是 `composeCore` 之外第二个「没有调用方、吞掉拒绝」的位置，原实现没有走诊断出口。评审探针（head `9ec97d4b`）：Fake Storage 的 `putSyncCursor` 被拒、provider 离线时触发一次 tick，读侧前后都是 `{"degraded":false,"stale":false}`、宿主诊断 0 次。本轮新增用例「scheduled double fault … reaches the host diagnostics sink once」在实现前红（等待 500 轮事件循环后钩子仍 0 次），实现后绿。读侧仍报新鲜是 TD-031 的既有形态，本层不改。
- 2026-10-14：原用例的等待 `while (reads === 0) await Promise.resolve()` 只让出微任务；实现退化成不再读 provider 时会饿死事件循环，`--test-timeout` 永不触发（评审实测 40s 后仍 100% CPU）。改成每轮让出事件循环、500 轮上限的 `waitFor` 后，变异 M10（Core refresh 不读 provider）在整表里以断言失败结束，不再挂起。
- 2026-10-14：原 no-write spy 只覆盖替身实现的 3 个写方法；变异 M11（引导时调用端口可选的 `updateWorkItemContent?.()` 与 `movePlanningItem?.()`）在旧用例下存活（同一夹具对 `9ec97d4b` 的用例文件读回 SURVIVED），五个都装 spy 后 KILLED。

## Decision Log

- 2026-10-13：#134 使用 A→B 两层 stack；A 是 membership/storage contract，B 是 refresh/scheduler。理由是独立回滚和 800 行硬门。
- 2026-10-13：scheduler 不隐藏在 composeCore；由 host lifecycle 显式 start/stop/dispose，避免不可见 timer 泄漏。
- 2026-10-13：refresh 走独立 local-only command，不复用 replay cache；显式 refresh 的语义是一次真实读取。
- 2026-10-13：不修改 #305 round implementation；通过 tests 复用其 latest-started/late-failure policy。
- 2026-10-13：`createPlanningReconciler` 只持有 timer 与单飞 Promise；Core command 自身也持有单飞槽，使 host tick、reconciler trigger 与显式 controller refresh 共享同一真实读取。
- 2026-10-13：timer callback 带 generation guard；stop/dispose 后即使旧 callback 已排队，也不得启动新读取。理由是 fake-timer 对抗测试能稳定判别生命周期竞态。
- 2026-10-13：本 PR 使用 `Closes #334` + `Refs #134`；#335 负责 Host 接线与 scheduled E2E，避免两个 PR 共同声称关闭 #134。
- 2026-10-13：保留 #330 的跨 project fail-closed 校验作为 stacked base 不变量；任何 refresh/scheduler 路径都必须在进入 membership/projection transaction 前拒绝混淆项目条目，Fake 与 SQLite 各自保留回归证据。
- 2026-10-13：#330 ExecPlan 是 bottom 的事实源；#331 只在自身 ExecPlan 记录本轮 current-head full-gate/linkage 回读，避免 stacked PR 通过文档 diff 改写底层完成状态。
- 2026-10-14（诊断出口；本会话，owner 由人类伙伴指定）：定时 tick 的拒绝交给 `PlanningReconcilerOptions.diagnostics`，类型直接用 `CoreDiagnostics`。理由：宿主只需要一个诊断出口，把传给 `composeCore` 的同一个对象传给 reconciler 即可；语义与组合期吞拒绝前上报一致（`packages/core/src/context.ts` 的 `CoreDiagnostics` 注释已同步列出这两个位置）。钩子吸收逻辑在 `planning-reconcile.ts` 内联一份，与 `packages/core/src/diagnostics.ts` 的 `reportSyncRoundFailure` 同法；没有改后者的签名，因为它的调用方在 #330 正在修改的 `bootstrap.ts` 里，合并两处留到栈合并之后。
- 2026-10-14（退避）：本层不做退避，定时 tick 按固定间隔重试。理由：单飞加有界间隔已限定成本（每个间隔至多一次全量读，与成功时相同）；永久拒绝与暂时故障今天同码同文案（TD-030），在类型化拒绝落地前，退避无法只针对永久拒绝；本层修复后，被拒绝的一轮（异常）会到达宿主诊断出口；provider 的结构化失败按 `CoreDiagnostics` 契约不上报，只在读侧标 degraded / stale（修复复评订正：原写「现在每次失败都会到达宿主诊断出口」不成立，复评以 `PermissionDenied` 连跑 3 个 tick，诊断 0 次、读侧 `degraded:true, stale:true`）。TD-030 记载的「#134 的调度会对永久拒绝反复重试」由此成真但可观测；TD-031 的读侧缺口（双重故障后仍报新鲜）不变。承接：Host 选择的间隔与限流预算、是否退避由 #335 决定；TD-030 的下一步（类型化拒绝）不变。
- 2026-10-14（单槽范围）：`bootstrapWorkspace` 不进单飞槽，改文档不改代码。理由：让它走单槽会改变既有命令语义（每次调用独立一轮；Controller 侧还带 replay 账本），影响面超出本层；并发正确性已由 #305 栅栏保证。代价是被取代的一轮报 `failed / stale_revision` 而数据其实是新的，所以 Host 应只暴露 `refreshPlanning` 作为刷新入口（见「待主控落实」一条）。Design / Spec 的原句已就地标注 Superseded。
- 2026-10-14（待主控落实）：以下事项需要写入 issue，**待主控在 issue 上落实，本计划不记为已完成**：#335 承接 Host 暴露显式 refresh（走 `refreshPlanning`，不走带 replay 的 `bootstrapWorkspace`）、scheduled 失败接宿主诊断出口（把同一个 `diagnostics` 传给 `createPlanningReconciler`）、transport 超时释放单飞槽（provider 读挂住时单飞槽被钉住，恢复后显式 refresh 仍挂起，`transport.ts` 写明超时由宿主负责），以及 Host 选择的 interval 与限流预算；#134 的验收框到 #332 / #334 / #335 的拆分映射写成决策评论。（**Superseded by 本节 2026-10-14（已落实）**）
- 2026-10-14（已落实）：上一条所列 issue 写入已由主控用开发账号 SingularityKChen 完成并回读：#335 正文增补四条验收（Host 经 `refreshPlanning` 暴露显式 refresh、同一个 `diagnostics` 传给 `createPlanningReconciler`、Host 侧超时释放单飞槽、间隔与限流预算由 Host 决定），更新时刻 2026-10-14T07:33:55Z；#134 写拆分映射决策评论，2026-10-14T07:33:57Z。回读：`gh issue view 335 -R SingularityKChen/harness-projects --json body`、`gh issue view 134 -R SingularityKChen/harness-projects --comments`。
- 2026-10-14（归档时机）：本计划在本 PR 收尾时归档（`docs/review/mvp-review.md` §5：修复 → 复评 → 归档 → 整合 → 合并），#335 用自己的 ExecPlan 承接 Host 侧，不再让本计划的生命周期跟随 #335。

第二轮 MMP 评审（head `9ec97d4b`）意见处置：

| 意见 | 属实 | 处置 | 证据 |
|---|---|---|---|
| P2 `planning-reconcile.ts:58` 定时 tick 吞拒绝、不交诊断出口 | 是 | 已修：`diagnostics` 选项，tick 先报后吞 | 三条新用例实现前红、实现后绿；变异 M8、M8b–M8e KILLED |
| P2 `planning-reconcile.ts:51` 单飞槽释放无判别用例 | 是 | 已修：成功 / reject / 同步 throw 后下一 tick 重新读取，无未处理拒绝 | 变异 M7 KILLED |
| P3 `planning-reconcile.ts:36` interval 边界无用例；下界允许 1ms | 是 | 已修用例（表驱动拒绝 0、-0、-1、NaN、±Infinity、2^31、1e12，接受 1、2^31-1，省略为 60s）；下界不改，转 #335 的间隔与限流预算 | 变异 M3a–M3d KILLED |
| P3 `commands.ts:237` Controller 与 scheduler 共槽无用例 | 是 | 已修：Core、Controller、reconciler 三条入口并发只读一次，Controller 拿到同一结果对象 | 变异 M4 KILLED |
| P3 `context.ts:163` `bootstrapWorkspace` 不经单飞槽 | 是 | 改文档：接口注释写明例外，Design 就地标 Superseded；Host 只暴露 refresh 转 #335 | 本节 2026-10-14（单槽范围） |
| P3 `commands.ts:8` 文件头第 2 行与刷新例外矛盾 | 是 | 已修：两条刷新命令都例外 | diff |
| P3 测试第 105 行微任务自旋可能永久挂起；末条用例名说多了 | 是 | 已修：`waitFor` 让出事件循环、500 轮上限；用例名改为它实际覆盖的内容 | 变异 M10 以断言失败结束 |
| P3 测试第 43 行 no-write spy 只覆盖 3/5 | 是 | 已修：五个写方法都装 spy | 变异 M11 旧用例 SURVIVED、新用例 KILLED |
| P3 计划第 180 行写了本机临时目录的绝对路径、spec 未持久化 | 是 | 已修：删除本机路径；读数改为最终树整表；修复复评指出 spec 仍不可重放（部分成立），收尾时把 spec 全文附进 `docs/review/pr-331-mmp-review.md` | `Outcomes & Retrospective` 2026-10-14 小节 |
| P3 计划第 170–173 行易失状态写成正文事实 | 是 | 已修：标注观察时刻与 head，改写为回读命令 + 期望 | 同上小节 |
| P3 计划第 166 行「#335 完成前保持 Active」 | 是 | 已修：本 PR 收尾时归档 | 本节 2026-10-14（归档时机） |
| PR 级 P2：#134 拆分映射、显式 refresh 的 Host owner、#335 验收增补 | 是 | 已在 issue 落实 | 本节 2026-10-14（已落实） |
| PR 级 P3：provider 读挂住钉死单飞槽 | 是 | 已转 #335（Host 侧超时验收） | 同上 |

## Idempotence and Recovery

single-flight state machine 可重复 start/stop；triggerNow 在运行中复用同一 Promise；generation guard 拒绝旧 timer callback。stack rebase 前保留 A head backup ref；冲突用 abort。回滚 #334 不影响 #330 的已验证 membership contract，无 migration。

## Artifacts and Notes

本批次产物为 `packages/core/src/planning-reconcile.ts`、`packages/core/src/context.ts`、`packages/controller/src/commands.ts` 与 `tests/integration/planning-refresh-scheduler.test.js`；#335 承接 Host 侧产物。ExecPlan 与索引保持在 `docs/exec-plan/active/`，直到 #334 与 #335 的职责分别验收。**Superseded by `Decision Log` 2026-10-14（归档时机）**：本计划在本 PR 收尾时归档，#335 另行承接。

## Interfaces and Dependencies

#134A scope replace、#305 round fence、#220/#199 freshness/error、CoreCommands、ControllerCommands、#335 Host lifecycle、fake timer/provider write spies。

## Outcomes & Retrospective

Core 侧 explicit refresh、single-flight scheduler、late-result fence、controller local-only wire 与 adversarial policy 已完成并通过验证；#334 的独立闭环保持可回滚，真实 Host lifecycle 与 workspace scheduled acceptance 由 #335 继续承接，因此本计划在 #335 完成前保持 Active。**Superseded by `Decision Log` 2026-10-14（归档时机）**：本计划在本 PR 收尾时归档，#335 用自己的 ExecPlan 承接 Host 侧。

技术债务与转交（2026-10-14）：定时 tick 无退避、永久拒绝每个间隔重试一次并上报诊断出口（与 TD-030 的关系见 `Decision Log` 2026-10-14（退避））；定时双重故障后读侧仍报新鲜（TD-031，不变）；provider 读挂住会钉住单飞槽（#335 的 transport 超时）；interval 下界只排除 ≤0（#335 的间隔与限流预算）；诊断钩子吸收逻辑在 `planning-reconcile.ts` 与 `diagnostics.ts` 各一份（栈合并后可合并）。

### 2026-10-14 Review-fix evidence

- 变基后最终树（观察时刻 2026-10-14，base 为整合后的 #330 head `91f3f1a5`，代码树等于本 PR 整合后的代码提交）：`pnpm verify` typecheck 通过、contract/integration/e2e 1546/1546、MVP-0 7/7；`node --test tests/integration/planning-refresh-scheduler.test.js` 12/12；`pnpm run boundaries` 8/8；`node scripts/workflow-check.mjs` 无 findings；`node scripts/rule-checks.mjs size 91f3f1a5` 代码 479、文档 548；disclosure 机械扫描通过；`git diff --check 91f3f1a5...HEAD` 无输出；同一份 spec 整表复跑 22 KILLED / 4 SURVIVED（与下列读数逐项一致）。下列两条是变基前在 `60129630`（base `55a99494`）上的读数，保留作对照。
- 执行上下文：观察时刻 2026-10-14，检出 `docs/planning-refresh-scheduler-plan` 的工作树根目录，代码树为本轮修复提交 `60129630`，base 为 #330 head `55a99494`。本分支之后会变基到修复后的 #330 head，届时以同一命令重算。
- `node --test --test-timeout=120000 tests/integration/planning-refresh-scheduler.test.js`：12/12；`pnpm verify`：typecheck 通过，contract/integration/e2e 1530/1530，MVP-0 7/7；`pnpm run boundaries`：8/8；`node scripts/workflow-check.mjs`：无 findings。规模、披露与差异检查以 `node scripts/rule-checks.mjs size 55a99494`、`node scripts/rule-checks.mjs disclosure 55a99494`、`git diff --check 55a99494...HEAD` 重算（期望：代码 ≤ 800、文档 ≤ 1300、无命中、无输出）。
- 变异：spec 全文见 `docs/review/pr-331-mmp-review.md`「可重放的变异 spec」（收尾时附入；工作时副本在检出根的 `.superpowers/review-fix/`，git 忽略），命令形状为 `node scripts/review-mutate.mjs <spec> --root .`；spec 的 command 为 `node --test --test-timeout=120000` 跑 `tests/integration/planning-refresh-scheduler.test.js`、`tests/integration/planning-round-order.test.js`、`tests/integration/sync-revision-freshness.test.js`、`tests/e2e/controller-roundtrip.test.js`，每个变异给出 `killedBy` 用例名片段。最终树上一次整表结果（26 个）：
  - KILLED（22）：M1 reconciler in-flight guard 删除；M2a start 的 handle guard 删除；M2b tick 的 generation 比较删除；M2c3 start 与 stop 的 generation 递增都删除；M2d dispose 不清 timer；M2g triggerNow 的 disposed guard 删除；M3a 删 interval 校验；M3b 允许 0；M3c 去掉上界；M3d 默认间隔改成 1s；M4 Controller refresh 改走 `bootstrapWorkspace`；M5 Core refresh 单飞 guard 删除；M6 Core refresh 槽不释放；M7 reconciler 槽不释放；M8 tick 不 catch；M8b tick 吞掉但不上报；M8c 钩子同步抛出不吸收；M8d 钩子返回的拒绝不吸收；M8e 显式触发也上报；M9 不 unref；M10 Core refresh 不读 provider（以 `waitFor` 断言失败结束，不挂起）；M11 引导时调用端口可选的两个写方法。每个 KILLED 的失败用例都含 spec 指定的 `killedBy`。
  - SURVIVED（4，等价变异）：M2c1 stop 不递增 generation（之后的 start 会递增，旧 callback 的 generation 仍不匹配）；M2c2 start 不递增（stop 与 dispose 已递增，重新 start 前必经 stop）；M2e 删 tick 的 handle guard（把 handle 置空的 stop / dispose 都同时递增 generation）；M2f 删 tick 的 disposed guard（dispose 同样递增 generation）。三道守卫互为冗余，保留作为纵深防御。

### 2026-10-13 Current-head Batch 4 evidence

本小节是观察时刻 2026-10-13、head `e70a1292`、base `ecc94cf` 的历史读数；2026-10-14 栈整合后 `ecc94cf` 已不是 head 的祖先，以下数值不代表当前 head，当前状态按各条的回读命令重算。

- 在检出 `docs/planning-refresh-scheduler-plan` 的当前工作树、以 PR base `ecc94cf` 为基线运行 `pnpm verify`：typecheck 通过，contract/integration/e2e 为 1526/1526，MVP-0 为 7/7；`pnpm run boundaries` 为 8/8；`node scripts/workflow-check.mjs` 无 findings。
- 同一检出运行 `node scripts/rule-checks.mjs disclosure ecc94cf`、`node scripts/rule-checks.mjs size ecc94cf` 与 `git diff --check ecc94cf...HEAD`；机械披露、规模与差异检查均通过。已安装 ExecPlan 技能自带的 `scripts/lint_execplan.py` 返回 `OK: ExecPlan passed lint checks.`；仓库内 `node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js` 为 9/9。推送后按同一仓库命令以新 head 重算易失读数。
- PR 头部回读：`gh pr view 331 -R SingularityKChen/harness-projects --json headRefName,headRefOid,baseRefName,baseRefOid,isDraft,mergeStateStatus,reviewDecision,closingIssuesReferences`（期望：base 为 `docs/planning-membership-reconcile-plan`、`closingIssuesReferences` 仅为 #334、非 draft）；`gh pr checks 331 -R SingularityKChen/harness-projects`（期望：全部 pass）。reviewDecision 与 mergeStateStatus 是人工门禁的易失状态，以回读为准，不写成值。
- 反向链接回读：`gh issue view 334 -R SingularityKChen/harness-projects --json number,state,closedByPullRequestsReferences`（期望：含 #331）；`gh issue view 134 -R SingularityKChen/harness-projects --json number,state,closedByPullRequestsReferences`（期望：#134 仍 OPEN 且无 closed-by PR）。

### 2026-10-13 Batch 1–3 evidence

- `node --test tests/integration/planning-refresh-scheduler.test.js`：8 passed（含 standalone source/lifecycle tests）。
- `node --test tests/integration/planning-round-order.test.js tests/integration/sync-revision-freshness.test.js tests/e2e/controller-roundtrip.test.js`：92 passed。
- `pnpm exec tsc --noEmit`、`pnpm run boundaries`：passed。
- 2026-10-13 曾用一份未持久化的临时 spec 跑过两项定向变异（M1 source single-flight、M2 stale timer callback，均 KILLED）；该 spec 不可重放。**Superseded by `Outcomes & Retrospective` 的「2026-10-14 Review-fix evidence」最终树整表**。

## Bottom Change Note

- 2026-10-13：创建 #134B ExecPlan，记录 explicit refresh/local-only 与 scheduler single-flight 的交付边界。
- Change Note (2026-10-13)：评审修订：#134B 重命名为 #334 Core 独立闭环；Host lifecycle 与真实 workspace scheduled acceptance 转交 #335，PR linkage 改为 `Closes #334` + `Refs #134`；补齐 source/lifecycle 判别测试与两项 mutation evidence。
- Change Note (2026-10-13)：独立复评修订：恢复 bottom #330 ExecPlan 的已完成事实；在本计划补回 Batch 4 current-head full-gate/linkage 证据，并记录旧 review gate 与 #335 Host handoff。
- Change Note (2026-10-14)：第二轮 MMP 评审修复（Batch 5）：定时 tick 的拒绝交给宿主诊断出口；补齐单飞槽释放、interval 边界、Controller 共槽、五个写方法 no-write 与不挂起等待的判别用例；单槽范围与归档时机的旧结论就地标 Superseded；删除本机临时路径，易失读数改为观察时刻 + 回读命令；变异读数改为最终树整表。
