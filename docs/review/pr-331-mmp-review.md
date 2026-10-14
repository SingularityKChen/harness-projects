# PR #331 MMP 交付评审

评审对象：PR #331（栈顶），immutable head `9ec97d4b8de4d59d4cad9d70353b49ace2cc2c56`；base 为 PR #330 head `55a994947f18a8a88ce3380c1fec508602b2d27a`（#330 的 base 是 `main@7c7e77ccc770b77f8c1cc7d3d6827ac6d854bc60`）。评审日期：2026-10-14（第二轮）。评审账号：Singularity-AI-Bot。

## 锁定事实

| 项 | 当前事实 |
|---|---|
| 状态 | OPEN，非 draft，MERGEABLE，mergeStateStatus=CLEAN |
| commits | `33097b87` docs(exec-plan)（Refs #134）→ `65d79255` feat(planning)（Refs #334、Refs #134）→ `9ec97d4b` docs(exec-plan)（Refs #334）；三个提交正文均无关闭关键字 |
| tree | `9ec97d4b`、整合前 `58966be5`、第一轮后的 `e70a1292` 三者 tree 相同（`4b22aff8`）：2026-10-14 整合只改提交元数据 |
| linkage | PR 正文 `Closes #334`、`Refs #134`；native closingIssuesReferences=[#334]；#134、#335 OPEN 且无 closing PR |
| checks | PR Fast Gate、CI Verify、Merge Gate 四 lane、Issue policy、Rule checks（size / disclosure）均有同 head、同 base 的成功运行。被取消的 CI `38522193827`、Merge Gate `38522193724`、Rule checks `38522193693` / `38522194458`、Issue policy `38522193643`、Engineering state `38522190338` / `38522191451` 分别被 `38522194454`、`38522194429`、`38522233093`、`38522194439`、全域重算 `38522233783`（changed=0）取代 |
| 既有批准 | Singularity-AI-Bot 的 APPROVED 提交于 2026-10-13T16:08Z，早于当前 head 的提交时刻（2026-10-14T06:11Z）；GitHub 因 tree 不变把它的 commit_id 重映射到当前 head。本轮视为当前 head 没有批准 |
| threads | 3 条，均已 resolve；本轮按原条件复跑，不采信 resolve 状态 |
| 规模 | 本层代码 329 / 文档 187；#330 + #331 合计 571 / 354 |

## 并集预演

四个开放 PR（#328、#329、#330→#331）在 `main@7c7e77cc` 上按两种顺序合并：#328→#329→#330→#331，以及 #331 栈→#329→#328。唯一冲突是 `docs/README.md` Active 索引的 add/add 行，保留全部行即可；两种顺序得到的 tree 除索引行序外逐文件相同。并集 `pnpm verify`：contract/integration/e2e 1542 pass、MVP-0 7 pass，0 fail。

## P0–P3 风险矩阵

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 | 未见 | 未见 | 定时 tick 吞掉 refresh 的拒绝且不交 `syncRoundFailed`（双重故障下读侧仍报 fresh、诊断 0 次） | `bootstrapWorkspace` 命令不走单飞槽，与 refresh 并发时两次读取；interval 下界允许 1ms；provider 读挂住会钉死单飞槽（超时属 Host，见 #335） |
| 产品闭环 | 未见 | 未见：显式 refresh 与 scheduler 在本栈都不可达，但 #334 的 Out of scope 明确排除 Host 接线，#335 承接 scheduled 验收 | 显式 refresh 在 Host 侧没有 owner；#134 正文与验收没有同步拆分 | — |
| 架构 | 未见：依赖方向正确，只读、无 provider 写入，timer 由 Host 拥有 | 未见 | — | — |
| 测试 | — | — | reconciler 单飞槽的释放与 tick 遇 reject 没有判别测试（M7、M8 存活） | interval 边界、Controller 与 scheduler 共槽、no-write spy 覆盖 3/5、微任务自旋等待可致测试永久挂起 |
| 工作项 | 未见 | 未见 | 见产品闭环 P2 | ExecPlan 变异证据写本机 `/tmp` 路径且 spec 未持久化；易失读数写成正文事实且已过期；「#335 完成前保持 Active」与归档流程冲突；controller 文件头注释过时 |

## 分层检查

- **不调用 provider 写方法**：成立（spy 覆盖 3/5 个写方法，另外两个 core 当前不调用，P3）。
- **不进 Controller replay 账本**：成立，两次已完成调用各读一次。
- **失败保留最后已知、成功清除 stale**：成立。
- **复用 #305 round fence**：成立；Controller refresh 被并发 bootstrap 取代时旧结果不覆盖新结果。
- **#330 scope 收敛与跨 project fail-closed**：经定时 tick 与 Controller refresh 两条入口、Fake 与 SQLite 两个适配器复现，删除收敛、重加身份保留、跨 project 返回 `invalid_input` 且不写入，均成立。
- **生命周期**：start/stop/dispose 幂等；interval 对 0、负数、NaN、±Infinity、超上界抛 RangeError；source 同步抛出或 reject 不卡死单飞槽。
- **新缺陷**：`planning-reconcile.ts` 的 tick 为 `void triggerNow().catch(() => undefined)`。探针（provider Offline + `putSyncCursor` 拒绝）显示定时 tick 后读侧 `degraded:false, stale:false`、诊断 0 次；同一故障经显式命令以 `disk full` 拒绝到调用方，组合期则交给诊断出口。`CoreDiagnostics.syncRoundFailed` 的契约（`context.ts`）因此在 scheduler 入口上缺一条路径。

## 上一轮意见复核（第一轮 head `0e41dfe3`）

| 意见 | 结论 | 证据 |
|---|---|---|
| P1 无 Host caller 却宣称完成 #134 | 不成立（已修） | #334 正文 Out of scope 排除 Host composition 与真实工作区 scheduled 验收；#335 验收框承接 Host start/stop/dispose、无事件时 scheduled 读到变化与 stale/no-write；PR 正文与 ExecPlan 没有超出本层的完成声明。尾巴：显式 refresh 没有 Host owner，#134 未同步拆分（P2，PR 级） |
| P2 scheduler 单飞无独立判别力 | 成立（已修） | M1 删 in-flight guard 被「standalone refresh source is single-flight」杀死；变体 M7（槽永不释放）存活，另列 P2 |
| P2 生命周期 guard 无反例 | 成立（已修） | M2a/M2b/M2c3/M2d/M2g 被「fake timer lifecycle」等杀死；M2c1、M2c2、M2e、M2f 为等价变异（多重守卫冗余）；变体 M8（tick 不 catch）存活，并入 P2 |
| #330 正文误把 #134 写成闭合 | 不成立（已修） | #330 native closing 只有 #332 |

## 变异表（当前 head，`scripts/review-mutate.mjs`，4 个测试文件 100 条用例）

| id | 位置 | 结论 | killedBy |
|---|---|---|---|
| M1 | reconcile 删 in-flight guard | KILLED | standalone refresh source is single-flight |
| M2a | 删 start 的 handle guard | KILLED | fake timer lifecycle |
| M2b | 删 generation 比较 | KILLED | fake timer lifecycle |
| M2c1 / M2c2 | stop 或 start 单独不递增 generation | SURVIVED（等价） | — |
| M2c3 | start 与 stop 都不递增 | KILLED | fake timer lifecycle |
| M2d | dispose 不清 timer | KILLED | fake timer lifecycle；stop and dispose |
| M2e / M2f | tick 去掉 handle 或 disposed 判断 | SURVIVED（等价） | — |
| M2g | triggerNow 不检查 disposed | KILLED | fake timer lifecycle |
| M3a/b/c | interval 校验删除 / 允许 0 / 去掉上界 | SURVIVED | — |
| M4 | Controller 改调 bootstrapWorkspace | SURVIVED | — |
| M5 | core 删 refreshInFlight guard | KILLED | explicit and scheduled triggers share one in-flight refresh |
| M6 | core 槽永不释放 | KILLED | failed refresh retains last-known rows；controller refresh never replays |
| M7 | reconciler 槽永不释放 | SURVIVED | — |
| M8 | tick 不 catch | SURVIVED | — |
| M9 | 删 unref | KILLED | stop and dispose cancel periodic ticks |

M3、M4、M7、M8 在评审探针加入后均被杀死，探针可作修复样例；变异后工作树逐字节还原。

## 意见清单（inline 11 条 + PR 级）

- P2 `planning-reconcile.ts:58` tick 吞拒绝且不交诊断出口。
- P2 `planning-reconcile.ts:51` 单飞槽释放无判别测试（M7、M8）。
- P3 × 9：interval 边界无测试、Controller 共槽无测试、`bootstrapWorkspace` 不走单飞槽、controller 文件头注释、微任务自旋等待、no-write spy 覆盖、ExecPlan 变异证据路径、易失读数、Active 状态声明。
- PR 级 P2：#134 正文与验收未同步拆分；显式 refresh 在 Host 暴露、scheduled 失败接 `syncRoundFailed`、transport 超时释放单飞槽，建议写入 #335 或新 issue 的验收，并在 #134 写决策评论映射各验收框的 owner。

## 结论

**APPROVE**：无 P0 / P1。核心不变量（不写 provider、不进 replay、stale 保留与清除、round fence、跨 project fail-closed）都有当前 head 的证据；两条代码 P2 可在 Core 内局部修复，工作项 P2 只需 issue 评论与验收增补。

## 后续 owner 与合并条件

- 作者为 Codex 会话，本机无 Claude 作者会话；修复 owner 需人类伙伴指定，指定原话写入本 PR ExecPlan 的 Decision Log。
- owner 收尾：修复 P2 与机械 P3 → 修复本身的独立复评 → 归档 ExecPlan → 整合提交 → 勾选 #334 验收 → 等人类逐 PR 给出合并授权后 rebase merge。#330 必须先合并。
- 合并前须在真实 `main` 上重建并集并重跑 `docs/README.md` 索引的删除行核对。

## 提交回读

2026-10-14 由 Singularity-AI-Bot 一次性提交 review `5514311789`（APPROVE，inline 11 条，commit_id 为本记录锁定的 head）；回读 inline 数一致。提交后 mergeStateStatus=BLOCKED，原因是分支保护要求所有对话已解决。

## 修复与复评（2026-10-14）

- **owner**：人类伙伴在本会话指定「本会话负责」修复与收尾（问「四个 PR 的修复与收尾由谁负责？」，答「本会话负责（推荐）」）。
- **修复**：两条 P2 已修——定时 tick 的拒绝经 `PlanningReconcilerOptions.diagnostics`（类型复用 `CoreDiagnostics`）交给宿主诊断出口，钩子失败被吸收、不被等待，显式 `triggerNow()` 只交调用方；单飞槽在成功、reject、同步 throw 后都释放。机械 P3 九条中七条已修（interval 边界、三入口共槽、文件头注释、`bootstrapWorkspace` 例外说明、`waitFor`、五个写方法 spy、易失读数与归档时机），interval 下界与限流预算转 #335。
- **修复的独立复评**（head `52f02007`）：第二轮 11 条中 10 条按原条件复核成立、1 条部分（spec 不可重放）；无 P0 / P1 / P2，新提 4 条 P3。处置：上报次数与时机写进 `diagnostics` 选项注释与 `CoreDiagnostics` 注释（C1 文档部分）；退避理由中「每次失败都会到达诊断出口」按事实订正（C3）；spec 全文附于下节（C4）；内联吸收逻辑去重与跨 realm / thenable 用例、stop 后在途轮次上报的用例转跟进 issue（C1 用例缺口、C2）。
- **issue 落实**：#335 增补四条验收（2026-10-14T07:33:55Z），#134 写拆分映射决策评论（2026-10-14T07:33:57Z）。
- **变基**：本分支变基到整合后的 #330 head `91f3f1a5`；range-diff 显示代码提交全部为 `=`，只有索引行因 #330 归档而变化。变基后在最终树上整表复跑下节 spec：22 KILLED、4 SURVIVED（M2c1、M2c2、M2e、M2f，等价变异，理由见 ExecPlan）。
- **归档**：ExecPlan 移到 `docs/exec-plan/completed/`，`docs/README.md` 索引行改为 Completed。

## 可重放的变异 spec

在检出本分支的工作树根目录，把下面的 JSON 存为任意文件后运行 `node scripts/review-mutate.mjs <spec.json> --root .`。

```json
{
 "command": [
  "node",
  "--test",
  "--test-timeout=120000",
  "tests/integration/planning-refresh-scheduler.test.js",
  "tests/integration/planning-round-order.test.js",
  "tests/integration/sync-revision-freshness.test.js",
  "tests/e2e/controller-roundtrip.test.js"
 ],
 "mutants": [
  {
   "id": "M1 reconciler in-flight guard removed",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "    if (inFlight !== undefined) return inFlight\n",
   "replacement": "",
   "killedBy": "standalone refresh source is single-flight"
  },
  {
   "id": "M2a start handle guard removed",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "      if (handle !== undefined) return\n      const generation",
   "replacement": "      const generation",
   "killedBy": "fake timer lifecycle"
  },
  {
   "id": "M2b tick generation compare removed",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": " || generation !== timerGeneration) return",
   "replacement": ") return",
   "killedBy": "fake timer lifecycle"
  },
  {
   "id": "M2c1 stop generation increment removed",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "      handle = undefined\n      timerGeneration += 1\n    },\n    triggerNow,",
   "replacement": "      handle = undefined\n    },\n    triggerNow,",
   "killedBy": "fake timer lifecycle"
  },
  {
   "id": "M2c2 start generation increment removed",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "      const generation = timerGeneration + 1\n      timerGeneration = generation\n",
   "replacement": "      const generation = timerGeneration\n",
   "killedBy": "fake timer lifecycle"
  },
  {
   "id": "M2c3 start+stop generation increments both removed",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "      const generation = timerGeneration + 1\n      timerGeneration = generation\n      handle = timers.setInterval(() => tick(generation), intervalMs)\n      const unref = (handle as { unref?: () => void } | undefined)?.unref\n      if (typeof unref === 'function') unref.call(handle)\n    },\n    stop(): void {\n      if (handle === undefined) return\n      timers.clearInterval(handle)\n      handle = undefined\n      timerGeneration += 1\n",
   "replacement": "      const generation = timerGeneration\n      handle = timers.setInterval(() => tick(generation), intervalMs)\n      const unref = (handle as { unref?: () => void } | undefined)?.unref\n      if (typeof unref === 'function') unref.call(handle)\n    },\n    stop(): void {\n      if (handle === undefined) return\n      timers.clearInterval(handle)\n      handle = undefined\n",
   "killedBy": "fake timer lifecycle"
  },
  {
   "id": "M2d dispose does not clear timer",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "      if (handle !== undefined) timers.clearInterval(handle)\n",
   "replacement": "",
   "killedBy": "fake timer lifecycle"
  },
  {
   "id": "M2e tick handle guard removed",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "if (disposed || handle === undefined || generation",
   "replacement": "if (disposed || generation",
   "killedBy": "fake timer lifecycle"
  },
  {
   "id": "M2f tick disposed guard removed",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "if (disposed || handle === undefined || generation",
   "replacement": "if (handle === undefined || generation",
   "killedBy": "fake timer lifecycle"
  },
  {
   "id": "M2g triggerNow disposed guard removed",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "    if (disposed) return Promise.reject(new Error('Planning reconciler is disposed'))\n",
   "replacement": "",
   "killedBy": "fake timer lifecycle"
  },
  {
   "id": "M3a interval bound check removed",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > MAX_INTERVAL_MS) {",
   "replacement": "  if (false) {",
   "killedBy": "interval must be"
  },
  {
   "id": "M3b interval allows zero",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "intervalMs <= 0 ||",
   "replacement": "intervalMs < 0 ||",
   "killedBy": "interval must be"
  },
  {
   "id": "M3c interval upper bound dropped",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": " || intervalMs > MAX_INTERVAL_MS) {",
   "replacement": ") {",
   "killedBy": "interval must be"
  },
  {
   "id": "M3d default interval changed",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "const DEFAULT_INTERVAL_MS = 60_000",
   "replacement": "const DEFAULT_INTERVAL_MS = 1_000",
   "killedBy": "interval must be"
  },
  {
   "id": "M4 controller refresh bypasses core single-flight",
   "file": "packages/controller/src/commands.ts",
   "anchor": "      const result = await core.commands.refreshPlanning()\n",
   "replacement": "      const result = await core.commands.bootstrapWorkspace()\n",
   "killedBy": "share one in-flight refresh (Core command, Controller command"
  },
  {
   "id": "M5 core refreshInFlight guard removed",
   "file": "packages/core/src/context.ts",
   "anchor": "    if (refreshInFlight !== undefined) return refreshInFlight\n",
   "replacement": "",
   "killedBy": "explicit and scheduled triggers share one in-flight refresh"
  },
  {
   "id": "M6 core refresh slot never released",
   "file": "packages/core/src/context.ts",
   "anchor": "      if (refreshInFlight === task) refreshInFlight = undefined\n",
   "replacement": "",
   "killedBy": "refresh"
  },
  {
   "id": "M7 reconciler slot never released",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "      if (inFlight === task) inFlight = undefined\n",
   "replacement": "",
   "killedBy": "reconciler frees its slot"
  },
  {
   "id": "M8 tick swallows nothing (no catch)",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "    void triggerNow().catch(reportScheduledFailure)\n",
   "replacement": "    void triggerNow()\n",
   "killedBy": "reconciler frees its slot"
  },
  {
   "id": "M8b tick swallows without reporting",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "    void triggerNow().catch(reportScheduledFailure)\n",
   "replacement": "    void triggerNow().catch(() => undefined)\n",
   "killedBy": "scheduled double fault"
  },
  {
   "id": "M8c sink sync throw escapes",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "    try {\n      const pending: unknown = options.diagnostics?.syncRoundFailed?.(error)\n      // 与 Core 的 `reportSyncRoundFailure` 同法：用 Promise 构造器吸收任何 thenable 的拒绝与读取 `then` 的同步抛出。\n      if (pending !== undefined) new Promise((resolve) => { resolve(pending) }).catch(() => undefined)\n    } catch {\n      // 诊断出口自己的失败不改变调度：下一个 tick 照常读取。\n    }\n",
   "replacement": "    const pending: unknown = options.diagnostics?.syncRoundFailed?.(error)\n    if (pending !== undefined) new Promise((resolve) => { resolve(pending) }).catch(() => undefined)\n",
   "killedBy": "a failing diagnostics sink never stops the schedule"
  },
  {
   "id": "M8d sink rejection not absorbed",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "      if (pending !== undefined) new Promise((resolve) => { resolve(pending) }).catch(() => undefined)\n",
   "replacement": "",
   "killedBy": "a failing diagnostics sink never stops the schedule"
  },
  {
   "id": "M8e explicit trigger also reports",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "    inFlight = task\n    return task\n",
   "replacement": "    inFlight = task\n    task.catch(reportScheduledFailure)\n    return task\n",
   "killedBy": "explicit trigger rejects to its caller only"
  },
  {
   "id": "M9 unref dropped",
   "file": "packages/core/src/planning-reconcile.ts",
   "anchor": "      if (typeof unref === 'function') unref.call(handle)\n",
   "replacement": "",
   "killedBy": "stop cancels periodic ticks"
  },
  {
   "id": "M10 core refresh never reads the provider (wait must not hang)",
   "file": "packages/core/src/context.ts",
   "anchor": "    task = bootstrapWorkspace(context).finally(() => {",
   "replacement": "    task = Promise.resolve({ ok: true, entities: 0, workItems: 0, changeRequests: 0, unanchored: 0, revision: 0, degraded: false, error: undefined } as BootstrapResult).finally(() => {",
   "killedBy": "explicit and scheduled triggers share one in-flight refresh"
  },
  {
   "id": "M11 refresh calls the two optional port writes",
   "file": "packages/core/src/bootstrap.ts",
   "anchor": "  const observations = await collectObservations(planning)\n",
   "replacement": "  await planning.updateWorkItemContent?.({} as never)\n  await planning.movePlanningItem?.({} as never)\n  const observations = await collectObservations(planning)\n",
   "killedBy": "without invoking provider writes"
  }
 ]
}
```
