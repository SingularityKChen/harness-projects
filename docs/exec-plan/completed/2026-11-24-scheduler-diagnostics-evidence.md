# 定时刷新诊断吸收与 stop/dispose 后拒绝的证据收口（#336）ExecPlan

> 状态：Completed（2026-11-24 三批全部完成并归档；独立对抗验收完成、P3 处置与评审记录随附；PR 仍为 draft，push 与 ready 请求由 lead 执行）
> 创建：2026-11-24
> 范围：test-only 证据收口。生产实现（`packages/core/src/diagnostics.ts` 的共享吸收器、`packages/core/src/planning-reconcile.ts` 的定时 tick 调用点）已由 #571（`6bb3c06d9fb4`）合入；本计划只补两条 scheduler 集成用例与可归因的变异证据，不改生产代码、公共导出、类型或错误码。
> 执行检出：`.worktrees/iteration12-diagnostics-evidence`，分支 `test/diagnostics-evidence-20261124`，基于 `main` @ `c24d1491`（2026-11-24 观察，创建时工作树干净）。
> 上游输入：issue #336（含 2026-11-16 replan 的当前范围与 #571 的 "Evidence and limits"）；两份本地独立设计的收敛结论已写入本计划，本计划不依赖仓库外文件。

## Purpose / Big Picture

完成后，定时刷新 tick 的剩余证据边界由持续回归钉住：非 Error 失败值按原对象恰好交给宿主诊断出口，sink 的非常规返回值不成为进程级未处理拒绝且下一 tick 照常读取；`stop()` / `dispose()` 之后到达的在途拒绝仍恰好上报一次、重复 `dispose()` 不重复上报。每条用例都有可杀死它的变异锚点，证据链是「未变异基线绿 → 施加变异 → 指定用例红 → 逐字节还原 → 全绿」。

最小成功证据（全部实跑；命令在 `Validation and Acceptance` 定义一次）：V2 两文件 `tests 77 / pass 77 / fail 0`（改动前基线 75，调度器 12 → 14）；V3 六条变异全部 `KILLED` 且前后基线绿、源码逐字节还原、exit 0；V4 体量/发布面/diff 检查 exit 0。PR 只关闭 #336 的证据缺口，不声称重新实现共享吸收器或改变生产行为；`Status` 仍由规划所有者决定。

## Context and Orientation

- **诊断出口 / sink**：`CoreDeps.diagnostics.syncRoundFailed?: (error: unknown) => unknown`（TD-030）。同步失败原因不进命令结果与读侧，只经这个回调交给宿主。
- **共享吸收器**：`reportSyncRoundFailure`（`packages/core/src/diagnostics.ts:13-21`，包内模块、不经入口导出）。不等待 sink；`:17` 用 `new Promise((resolve) => { resolve(pending) }).catch(() => undefined)` 同化 sink 的任何非 `undefined` 返回值并吞掉拒绝，吸收原生 promise、跨 realm promise、thenable 与 `then` 读写抛错。
- **定时 tick**：`createPlanningReconciler`（`packages/core/src/planning-reconcile.ts:65-68`）用 `void triggerNow().catch((error) => reportSyncRoundFailure(options, error))` 处理一轮拒绝；tick 没有调用方，拒绝没有别的接住者。
- **在途轮次**：`triggerNow()` 的单飞槽；`stop()` / `dispose()` 只清 timer，不取消在途轮次、不摘除已挂上的拒绝处理器，因此其后的拒绝仍会上报。
- **原对象身份 / 进程安全**：交给 sink 的是同一个失败值（字符串、普通对象也原样）；无人接住的拒绝触发 `unhandledRejection`（Node 默认会结束进程），测试用文件内既有 `collectUnhandled` 有界监听。

当前状态（设计期在 `main@c24d1491` 只读核对；文内测试行号除另行注明外按归档 head 回读；新增用例在未改动树上应为绿，RED 由 `scripts/review-mutate.mjs` 的变异提供）：

- 生产：`diagnostics.ts:13-21`；`planning-reconcile.ts:13-21` 的 `diagnostics` 选项注释（恰好一次、按对象身份去重、stop/dispose 后仍上报的既有约定）与 `:65-68` 的 tick。
- `tests/integration/planning-refresh-scheduler.test.js` 12 条（行号按归档 head `0eb15a5b` 回读；`main@c24d1491` 上因无 `import vm` 各早 1 行）：`:234-269` stop 后在途**成功**；`:271-294` 普通 `Error` 每 tick 上报一次；`:296-316` sink 同步抛/原生拒绝/永不 resolve；`:318-346` 双故障一次。设计期缺口（Batch 2 已补齐，新用例 `:348-377`、`:379-404`）：tick 上的非 `Error` 拒绝、sink 的跨 realm/`then` 方法体形态、stop/dispose 后在途**拒绝**。
- `tests/integration/sync-revision-freshness.test.js:371-456` 的 Core 诊断矩阵已覆盖跨 realm 拒绝、rejecting thenable、`then` getter 抛、非 Error 值、永不 resolve，但都经 `composeCore` / `bootstrapWorkspace`，不经定时 tick。
- #571 记录共享实现已合入、剩余"未单独演示的证据边界"（非已复现缺陷）；#335、TD-030 不在本闭环；`docs/README.md` 维护 ExecPlan 索引，`tests/integration/README.md` 是主题清单、无 scheduler 小节，本 PR 不新增行；`windows-native-checks.mjs` 的 `SETS` 不含本测试文件（`minTests` 单调下界）。

## Design / Spec

### 选择

只改 `tests/integration/planning-refresh-scheduler.test.js`，新增 2 条中文名用例；仅新增 `import vm from 'node:vm'`，复用既有 `OK`、`fakeTimers()`、`collectUnhandled()`、`waitFor()`、`turn()`，不新增 helper、测试文件或生产符号。实现轮文档只新增本计划与 `docs/README.md` 一行；验收处置轮另加评审记录与两处索引（见 Global Constraints 与 D9）。

为什么是 2 条而不是复制 Core 矩阵：吸收路径（`diagnostics.ts:17`）不按失败值类型分支，只按 sink 返回值形态分支；Core 矩阵已覆盖 rejecting thenable、`then` getter 抛、原生拒绝、永不 resolve，复制它们不增加判别力。scheduler 调用点仍需自己的证据，因为"把 tick 的共享吸收器换回本地窄实现"是真实历史回归（#290 记录过原始 `instanceof Promise` 窄化），Core 覆盖 helper 本身、不覆盖这个调用点。

### 用例 1（组合矩阵，2 行）

测试名：`诊断出口：定时 tick 的非 Error 拒绝按原对象上报一次；sink 返回跨 realm 拒绝 promise 或 then 方法体抛错的 thenable 都被吸收，下一 tick 照常读取且无进程级未处理拒绝`

| 行 | 轮次失败值（每行只创建一次） | sink 返回值 |
|---|---|---|
| 1 | `'round-failed-as-string'`（字符串） | `vm.runInNewContext('Promise.reject(new Error("sink elsewhere"))')`（跨 realm 已拒绝 promise） |
| 2 | `{ code: 'round-failed-as-object' }`（普通对象） | `{ then() { throw new Error('sink then body') } }`（`then` 方法体同步抛错） |

每行：`fakeTimers()` + `createPlanningReconciler(() => { calls += 1; return calls === 1 ? Promise.reject(roundValue) : Promise.resolve(OK) }, { intervalMs: 1000, timers, diagnostics: { syncRoundFailed: (error) => { reported.push(error); return sink() } } })`；`collectUnhandled` 内 `start()` → `handles[0].fn()` → 两次 `turn()` → 断言 `reported.length === 1` 且 `strictEqual(reported[0], roundValue)` → `handles[0].fn()` → 两次 `turn()` → 断言 `calls === 2`、`reported.length === 1`；`dispose()` 后断言 `unhandled` 为空。

为什么保留 2 行：跨 realm 行是「`instanceof Promise` 窄化」唯一的可观测判别（窄化后该行产生 unhandled，`then` 方法体行不产生）；`then` 方法体行是 issue 明确列出的验收项，落在 `diagnostics.ts:16` 注释承诺的另一半（读取/调用 `then` 的同步抛出都变为被吸收的拒绝），并对 M6 有判别力——但它对窄化变异没有唯一判别力，不提"唯一"。

### 用例 2（stop/dispose 后拒绝）

测试名：`诊断出口：stop()/dispose() 之后到达的在途拒绝仍各恰好上报一次，不成为进程级未处理拒绝；重复 dispose 不重复上报`

对 `[['stop', (r) => r.stop()], ['dispose', (r) => r.dispose()]]` 各跑：`failure = new Error('<action> late round failure')`（用 `Error`，让本用例只承担生命周期语义，不混入非 Error 归因）；gated source `new Promise((_resolve, reject) => { rejectRound = reject })`；`start()` → `handles[0].fn()` → `waitFor(() => typeof rejectRound === 'function', ...)` → `halt(reconciler)` → `rejectRound(failure)` → 两次 `turn()` → 断言 `reported.length === 1` 且 `strictEqual(reported[0], failure)` → `reconciler.dispose()`（dispose 分支即第二次 dispose）→ `turn()` → 断言仍为 1；外层 `collectUnhandled` 断言无未处理拒绝。两个动作都跑：`if (disposed) return` 变异只会被 dispose 支路杀死（stop 时 `disposed === false`），只测 stop 会漏掉它。

### 残留项 → 用例 → 变异 → 诚实判别力边界

| issue #336 残留项 | 用例 | 杀死它的变异 | 诚实边界 |
|---|---|---|---|
| scheduler 特有的 unusual-return / 非 Error 组合 | 用例 1 两行 | M1、M4、M5、M6 | 只对两种 sink 异常返回与两种非 Error 值各取一格，不复制 Core 矩阵 |
| `then` 方法体抛错 | 用例 1 行 2 | M6 | 对 M4（窄化）无判别力；保留因 issue 列出且成本近零，不宣称唯一判别 |
| stop()/dispose() 后在途拒绝恰好一次 | 用例 2 | M2（仅 dispose 支路）、M3（两支路） | 只断言「该 tick 的 catch 对本身上报 0 次的拒绝恰好上报一次」；轮内已报 + tick 再报一次的双故障语义由既有 `:317` 与选项注释定义，本条不重定义 |
| 原始 `instanceof Promise` 窄化变异 | 用例 1 行 1 | M4 | 该变异同时红既有 `sync-revision-freshness.test.js:407-439` 的跨 realm 子用例；两处都记录，KILLED 归因取新用例名 |
| post-stop-report-removal 变异 | 用例 2 | M2、M3 | `disposed` 守卫只被 dispose 支路杀；`handle === undefined` 守卫两支路都杀 |

变异矩阵（6 条，M1–M6 落在 2 个锚点，锚点在 `main@c24d1491` 各出现 1 次，规划期只读核对；可运行 spec 见 V3）：M1/M2/M3 均锚 `packages/core/src/planning-reconcile.ts:67` 的 tick 行，分别替换为上报前 `if (error instanceof Error)`、上报前 `if (disposed) return`、上报前 `if (handle === undefined) return`；M4/M5/M6 均锚 `packages/core/src/diagnostics.ts:17` 的吸收行，分别替换为 `if (pending instanceof Promise) pending.catch(() => undefined)`（窄化）、`if (pending !== undefined) void pending`（不吸收）、`if (pending !== undefined) new Promise((resolve) => { resolve(pending) })`（不接拒绝）。期望 killedBy：M1/M4/M5/M6 → 用例 1（M4 仅行 1），M2 → 用例 2 的 dispose 支路，M3 → 用例 2 两支路。

被否决的方案：**B 分层归属**（Core 补 `then` 方法体、scheduler 只补 late）留空 issue 明确的 scheduler 组合；**C 完整 scheduler 自包含矩阵**（4–8 行交叉）与 Core 重复、为组合而组合；**D 只加 late** 漏掉 issue 两项；**B' 在 Core 断言 `then` 被调用**把同化细节冻结成宿主契约且仍不覆盖 tick 调用点。

不变量：I1 诊断出口不是同步的一部分（不等待 sink、sink 失败不改变本轮结果，TD-030）；I2 报告所有权（tick 交一次、显式 `triggerNow()` 只拒绝调用方、stop/dispose 不清除在途报告）；I3 失败值身份保真（同一对象/原值）；I4 被覆盖形态不产生 `unhandledRejection`；I5 不改生产代码、公共导出、类型、错误码或任何现有测试断言。

明确排除：不重写生产实现、不重写 Core 矩阵、不改 `sync-revision-freshness.test.js`；不新增 `tests/integration/README.md` 行、不更新 `tests/README.md`、不更新 `windows-native-checks.mjs`；不处理 #335 Host sink 接线、TD-030 类型化拒绝/退避、真实外部 sink、安装件或 UAT；不把「两个 tick 复用同一在途轮次时同一拒绝上报两次」固定成新断言（既有「宿主按对象身份去重」约定，本次不改不冻结）；不写 issue/PR/Project 的 `Status`、`blocked-by` / `blocking` 或看板条目。

## Global Constraints

- **全任务文件集合（实现轮，本计划只在此声明一次）**：修改 `tests/integration/planning-refresh-scheduler.test.js`；新增本计划（初始 `docs/exec-plan/active/2026-11-24-scheduler-diagnostics-evidence.md`，全部验收通过后移到 `docs/exec-plan/completed/`，文件名不变）；修改 `docs/README.md`（索引 ±1 行：Active 新增，归档时该行移到 Completed）。验收处置轮增量（见 D9）：新增 `docs/review/pr-675-mmp-review.md`（独立对抗验收记录：范围、锁定 base/head、P0–P3 处置、残余风险与最终验证）、修改 `docs/review/README.md`（§8 评审索引 +1 行）、修改本计划（事实修正与验收处置记录）；该增量仍为 docs-only。运行态 `.superpowers/iteration12/336/mutations.json` 与日志是 git 忽略的临时证据，不入库、不属于 PR 文件集合。集合外文件一律不改，尤其生产代码、其他测试、其他文档、issue/PR/Project 字段。
- test-only：不改生产代码。若新用例在未变异树上红，停止并报告，不得顺手改生产代码。
- 交付边界：单 PR `Closes #336`，只关闭证据缺口，不声称重新实现共享吸收器或改变生产行为；`Status`、合并与规划接受由人类伙伴决定，agent 不合并、不写 `Status`。
- 规模：技术新增+删除 ≤800（仓库硬上限 1000，Project CodeBudget 150）、含文档 ≤1300（硬上限 1500）；实现实测技术 +59/−0、文档 +231（计划 230 + `docs/README.md` 索引 1 行）；验收处置轮再增评审记录与计划修订，最终行数以 V4 回读为准（见 Outcomes）。
- 证据纪律：命令、期望输出与执行上下文（检出 `.worktrees/iteration12-diagnostics-evidence`、分支名）成对出现；易失值（PR 编号/head/checks）默认只写回读命令与期望，不写快照值；例外是本计划 `Progress`/`Outcomes`/`Bottom Change Note` 的验收处置记录可写被验收 head 快照（注明 `git rev-parse HEAD` 来源与易失性，push 后以远端回读为准，见 D11）。
- 文档正文中文；代码标识符、路径和命令英文；不写本机绝对路径。
- 提交格式 `<type>(<scope>): <中文摘要>`（实现提交 `test`，验收处置 `docs`），正文说明为什么，末尾 `Refs #336`；`Closes #336` 由 PR body 承担（AGENTS.md §6 允许 `Closes` 或 `Refs`，§8 要求 PR 描述含关闭关系；见 D8）；每批一个可独立审阅的提交；不 push `main`、不自行合并。
- 分支与 PR：base `main`，分支 `test/diagnostics-evidence-20261124`；PR 标题镜像 issue 英文标题，labels 为 `kind:refactor` + `area:core` + `area:tests`，milestone 与 issue 相同，assignee `SingularityKChen`；不加入 Project 看板条目（Lead 跨 PR 决策）。

## Plan of Work

批次验证命令统一在 `Validation and Acceptance` 定义一次，本节只引用编号。

### Batch 1 · ExecPlan 入库、索引与 draft PR（文档）

**最小闭环**：本计划可被仓库内读者独立执行，`docs/README.md` Active 表有一行可用索引，draft PR 已建立并 link #336。
**涉及文件**：本计划、`docs/README.md`。

步骤：① 写入本计划并在 `docs/README.md` §2 `Active` 表新增一行（链接本计划、用途一句话）；② 跑 V1 后在检出的分支工作树根目录提交（docs-only）；③ push 分支、创建 **draft** PR（base `main`、标题镜像 issue、labels/milestone/assignee 见 Global Constraints，body 含闭环/`Closes #336`/本 ExecPlan 与 Batch 1–3/证据/风险/回滚）；④ `gh pr view <n> -R SingularityKChen/harness-projects --json ...` 回读 base/head/isDraft/closingIssuesReferences/files。

**验证**：V1 → plan 存在、索引行数 1、`git diff --check main...HEAD` 无输出。PR 回读期望：`isDraft=true`、`baseRefName=main`、`headRefName=test/diagnostics-evidence-20261124`、closing 引用含 `336`。
**回滚**：revert 该文档提交（计划与索引一起撤回）；PR 字段错误时修正或关闭 draft PR，不涉及代码与外部状态。

### Batch 2 · 两条用例与变异证据链（测试）

**最小闭环**：两条用例在未变异树全绿；变异 spec 落到运行态并 6/6 KILLED；源码按字节还原。
**涉及文件**：`tests/integration/planning-refresh-scheduler.test.js`。

步骤：① 按 Design 实现两条用例（仅加 `import vm from 'node:vm'`、复用既有 helper、断言消息带行/动作标签）；② 跑 V2（77/77），若失败按 D1 停止并记录；③ 把 V3 的内联 spec 原样写入 `.superpowers/iteration12/336/mutations.json`（git 忽略）；④ 跑 V3，确认 RED 归因、`SUMMARY` 全 `KILLED`、exit 0、`git diff -- packages/core` 为空；⑤ 把实际失败用例名与输出记入 `Surprises & Discoveries` / `Progress`。

**验证**：V2 → 77/77/0 fail；V3 → 6/6 KILLED、前后基线绿、exit 0。
**回滚**：撤回该测试提交，删除运行态 spec；生产代码与既有测试零改动。

### Batch 3 · 最终门禁、计划归档与 ready 请求（文档）

**最小闭环**：最终 head 证据完整，计划归档到 `completed/`、索引迁移，PR 在最终 push 后回读并转 ready 请求人类评审。
**涉及文件**：本计划（移动与更新）、`docs/README.md`。

步骤：① 更新 `Progress`、`Surprises & Discoveries`、`Outcomes & Retrospective`；② 跑 V2、V3、V4（最终 head 证据）；③ 把本计划移到 `docs/exec-plan/completed/`、索引行从 Active 移到 Completed（行数不变）；④ 跑 V1/V4 后提交，push 后回读 PR head/base/checks/closingIssuesReferences/review threads，`gh pr ready <n>` 只在最终 push 回读通过后执行并请求人类评审，不合并。

**验证**：V1（命令已写 `completed` 路径，归档 head 上可直接执行）→ 索引与链接完整；V2 → 77/77；V3 → 6/6 KILLED；V4 → exit 0。
**回滚**：revert 文档提交（索引与归档一起撤回）；分支保留，CI 结论按回读时 head 重新计算。

## Validation and Acceptance

以下命令在检出 `.worktrees/iteration12-diagnostics-evidence`（分支 `test/diagnostics-evidence-20261124`）的工作树根目录运行；批次只引用编号。

**V1 文档入库完整性**

```
git diff --check main...HEAD && test -f docs/exec-plan/completed/2026-11-24-scheduler-diagnostics-evidence.md && grep -c '\[2026-11-24-scheduler-diagnostics-evidence\](' docs/README.md
```

期望：无空白/冲突标记输出；`test -f` exit 0；`grep -c` 输出 `1`；整条 exit 0。Batch 1/2 期间该行使用 `active` 路径；Batch 3 归档提交已把命令内路径改为 `completed`，归档/验收 head 上可原样执行（验收处置轮复跑见 `Progress`）。

**V2 两文件集成基线**

```
pnpm test:file tests/integration/planning-refresh-scheduler.test.js tests/integration/sync-revision-freshness.test.js
```

期望：`ℹ tests 77`、`ℹ pass 77`、`ℹ fail 0`、`ℹ cancelled 0`、`ℹ skipped 0`，exit 0（改动前基线 75：调度器 12 + freshness 63）。

**V3 变异证据链**

```
node scripts/review-mutate.mjs .superpowers/iteration12/336/mutations.json --root .
```

期望：先跑变异前基线（全绿），再逐条 `RED` 且失败名含 `killedBy`；`SUMMARY` 中 M1–M6 全 `KILLED`，无 `SURVIVED` / `KILLED_OTHER` / `NOT_APPLIED`；每条结束后按字节还原，最后重跑基线全绿；exit 0。spec 全文（运行时原样写入 `.superpowers/iteration12/336/mutations.json`，不入库）：

```json
{
  "command": ["node", "--test", "--test-timeout=120000", "tests/integration/planning-refresh-scheduler.test.js", "tests/integration/sync-revision-freshness.test.js"],
  "mutants": [
    {"id": "M1", "file": "packages/core/src/planning-reconcile.ts", "anchor": "void triggerNow().catch((error) => reportSyncRoundFailure(options, error))", "replacement": "void triggerNow().catch((error) => { if (error instanceof Error) reportSyncRoundFailure(options, error) })", "killedBy": "定时 tick 的非 Error 拒绝按原对象上报一次"}, {"id": "M2", "file": "packages/core/src/planning-reconcile.ts", "anchor": "void triggerNow().catch((error) => reportSyncRoundFailure(options, error))", "replacement": "void triggerNow().catch((error) => { if (disposed) return; reportSyncRoundFailure(options, error) })", "killedBy": "stop()/dispose() 之后到达的在途拒绝仍各恰好上报一次"}, {"id": "M3", "file": "packages/core/src/planning-reconcile.ts", "anchor": "void triggerNow().catch((error) => reportSyncRoundFailure(options, error))", "replacement": "void triggerNow().catch((error) => { if (handle === undefined) return; reportSyncRoundFailure(options, error) })", "killedBy": "stop()/dispose() 之后到达的在途拒绝仍各恰好上报一次"},
    {"id": "M4", "file": "packages/core/src/diagnostics.ts", "anchor": "if (pending !== undefined) new Promise((resolve) => { resolve(pending) }).catch(() => undefined)", "replacement": "if (pending instanceof Promise) pending.catch(() => undefined)", "killedBy": "定时 tick 的非 Error 拒绝按原对象上报一次"}, {"id": "M5", "file": "packages/core/src/diagnostics.ts", "anchor": "if (pending !== undefined) new Promise((resolve) => { resolve(pending) }).catch(() => undefined)", "replacement": "if (pending !== undefined) void pending", "killedBy": "定时 tick 的非 Error 拒绝按原对象上报一次"}, {"id": "M6", "file": "packages/core/src/diagnostics.ts", "anchor": "if (pending !== undefined) new Promise((resolve) => { resolve(pending) }).catch(() => undefined)", "replacement": "if (pending !== undefined) new Promise((resolve) => { resolve(pending) })", "killedBy": "定时 tick 的非 Error 拒绝按原对象上报一次"}
  ]
}
```

**V4 体量、发布面与差异检查**

```
node scripts/rule-checks.mjs size main && node scripts/rule-checks.mjs disclosure main && git diff --check main...HEAD
```

期望：exit 0；`size` 代码新增+删除 ≤800（实测 59）、文档 ≤1300（归档 head 231，验收处置轮后以实跑回读为准）；`disclosure` 机械扫描通过；`git diff --check` 无输出。

**验收映射**：① scheduler 特有 unusual-return / 非 Error 组合 → 用例 1、V2、V3（M1/M4/M5/M6）；② `then` 方法体抛错 → 用例 1 行 2、V3（M6）；③ stop/dispose 后在途拒绝恰好一次 → 用例 2、V3（M2/M3）；④ 两个未单独记录的变异 → M4（另见既有 freshness 跨 realm 子用例同红）与 M2/M3（post-stop-report-removal）；⑤ PR 关闭 #336 只表示证据边界补齐，不是生产行为变更声明，`Status` 不由本 PR 写。

## Progress

- [x] Batch 1（2026-11-24，lead）：本计划入库、`docs/README.md` Active 索引一行、draft PR 建立并关联 #336；V1 回读索引行数 1、`git diff --check` 无输出。PR 编号/head/checks 属易失值，按 Global Constraints 不写快照，只保留回读命令与期望。
- [x] Batch 2（2026-11-24，impl-336）：`tests/integration/planning-refresh-scheduler.test.js` 新增 2 条用例（+59 行，唯一新增 import 为 `node:vm`，复用既有 helper）；V2 实跑 `tests 77 / pass 77 / fail 0`（exit 0）；V3 实跑 6/6 `KILLED`（exit 0，前后基线绿、逐字节还原后生产文件 blob 与 `HEAD` 相同）。未变异树新增用例全绿（计划预期），D1 停止条件未触发。逐条失败名与必要性对照见 `Surprises & Discoveries` 9–11。
- [x] Batch 3（2026-11-24，impl-336）：最终 head 实跑 V1（归档后路径）/V2/V3/V4 全绿（V2 `tests 77 / pass 77 / fail 0`；V3 6/6 `KILLED`；V4 `size` 代码 59/1000、文档 231/1500，`disclosure` 通过、`git diff --check` 无输出）；计划归档到 `docs/exec-plan/completed/`、索引行由 Active 迁移到 Completed（行数不变）；push/PR head/base/checks 回读与 `gh pr ready` 属 lead 操作，本实现 owner 按授权未执行。
- [x] 验收处置（2026-11-24，a-336）：完整读取独立对抗验收报告 `.superpowers/iteration12/336/verification-1.md`（PASS WITH FINDINGS：无 P0/P1/P2，P3×4 + 仅观察项）并逐条处置。P3-2 修正本计划措辞（提交 trailer 用 `Refs #336`，`Closes #336` 由 PR body 承担，不改写已提交历史）；P3-3 把 scheduler 行号改为归档 head 回读；P3-4 把 V1 命令改为 `completed/` 路径并复跑 exit 0；P3-1（PR body 回填）与 P3-2 的 PR 侧按授权留给 lead；P3-5 以及判别力重叠、重复 `dispose()` 无独立变异、unhandled 归因串扰等仅观察项记入评审记录残余风险，未改测试。新增 `docs/review/pr-675-mmp-review.md` 与 `docs/review/README.md` 索引行。处置后树复跑 V1 exit 0、V2 `tests 77 / pass 77 / fail 0`、V3 6/6 `KILLED`（前后基线绿、`packages/core` 逐字节还原）、V4 `size` 代码 59/1000、文档 322、`disclosure` 通过、`git diff --check` 无输出。

## Surprises & Discoveries

1. **设计期只读证据（基线）**：2026-11-24 在 `.worktrees/iteration12-diagnostics-evidence`（`main@c24d1491`）只读运行两文件得到 `tests 75 / pass 75 / fail 0`（调度器 12 + freshness 63，约 0.7s），与设计文档一致；这是改动前基线，不是新增用例的 RED。
2. **设计期只读证据（prototype）**：两份独立设计在仓库外逐字节副本上模拟本案断言，未变异树全绿；`instanceof Promise` 窄化只让跨 realm 行产生 unhandled（`then` 方法体行保持绿）；`disposed` 守卫只被 dispose 支路杀死；`handle === undefined` 守卫两支路都杀死。Batch 2 必须在实现树用 V3 重测，设计期读数不作为最终证据。
3. **设计期只读证据（锚点）**：两个变异锚点在 `main@c24d1491` 各出现恰好 1 次（`planning-reconcile.ts` 的 tick 行、`diagnostics.ts:17` 的吸收行），`NOT_APPLIED` 不会掩盖施加失败。
4. `then` 方法体行对 M4 无判别力：普通 thenable 在窄化实现下被忽略也不产生拒绝，真正判别 narrowing 的是跨 realm 行；按 issue 保留契约覆盖，不宣称唯一判别力。
5. `if (disposed) return` 只被 dispose 支路杀死（stop 时 `disposed === false`）；`if (handle === undefined) return` 两支路都杀死；因此用例 2 必须同时跑 `stop` 与 `dispose`。
6. `diagnostics.ts:17` 让两个 tick 复用同一在途轮次时同一拒绝可上报 2 次，与 `planning-reconcile.ts:16-18` 注释「宿主按对象身份去重」一致；本次不改、不固定该边界。
7. 既有 P336 一次性 probe 在 `docs/product/core-release-audit.md:314-333`（5 项各 1 次、unhandled 空），但未进 CI、无变异归因；不把它当等价证据。
8. `tests/integration/README.md` 无 scheduler 小节，`windows-native-checks.mjs` 的 `SETS` 不含该文件（`minTests` 单调下界），本 PR 无需同步这两处清单。
9. **Batch 2 必要性对照（变异先红）**：在尚未加入新用例的树（Batch 1 文档提交之上）先跑同一 V3 spec：M1/M2/M3 为 `SURVIVED`，M4/M5/M6 为 `KILLED_OTHER`（M4 由 freshness 跨 realm 子用例杀死；M5/M6 由既有 scheduler `a failing diagnostics sink never stops the schedule…` 与 freshness 钩子用例杀死）。加入两条用例后同一 spec 6/6 `KILLED`，说明 M1–M3 的判别力由新用例唯一提供，而 M4–M6 在 scheduler 调用点本来缺少归因。这次对照临时把 spec 命令跑在未加用例树上，未改任何文件，跑完 `git status` 仍干净。
10. **Batch 2 V3 实跑失败名（加用例后）**：M1 → 用例 1；M2、M3 → 用例 2；M4 → 用例 1 与 freshness `诊断出口：钩子自己抛错…` 两个适配器子用例；M5、M6 → 用例 1 与既有 scheduler `a failing diagnostics sink never stops the schedule…` 及 freshness 钩子子用例。`SUMMARY` 全 `KILLED`，exit 0；结束基线复跑绿，两处锚点各回到 1 次，生产文件 `git hash-object` 与 `HEAD:` 相同（逐字节还原）。
11. **M4 的归因粒度**：review-mutate 只报失败用例名，不区分子行；M4 的 RED 归因是「用例 1 整体」（两行同属一条用例名）。因此「`then` 方法体行对窄化无唯一判别力」仍是设计期只读结论，本次变异证据没有把它升级成唯一判别；用例 1 的两行都保留，理由仍是 issue 明确列出的两项契约。
12. **独立对抗验收结论（2026-11-24，PASS WITH FINDINGS）**：验收 agent 在实现 head `0eb15a5b` 上独立重跑 V2 77/77（连续 10 次稳定）、V3 6/6 `KILLED`、计划外反例 X1–X6 全 `KILLED`、语义等价重构 R1–R3 全 `SURVIVED`，并在未加用例的 main 测试副本上精确复现「M1–M3 `SURVIVED` / M4–M6 `KILLED_OTHER`」的必要性对照；未发现生产代码改动、既有断言删除、进程级监听泄漏或计时不稳定。全集成层 2378/2350/28 skip。验收报告在运行态 `.superpowers/iteration12/336/verification-1.md`（git 忽略），结论已整理进 `docs/review/pr-675-mmp-review.md`。
13. **4 条 P3 的性质是文档/发布面精度，不是代码或判别力缺陷**：P3-1 PR body 滞后（lead push 后回填）、P3-2 trailer 措辞、P3-3 行号偏移、P3-4 归档路径不可原样执行。处置选择「改文档事实 + 补评审记录」，不改测试、不改生产、不 reword 已提交历史（D8–D10）。P3-5（固定两轮 `setImmediate` 排空与进程级 unhandled 监听造成故障归因串扰）与判别力重叠、重复 `dispose()` 无独立变异、设计期 prototype 不可从仓库复现、远端 checks 只覆盖 `b4d7542a` 等仅观察项，按价值/成本不修，记入评审记录残余风险；P3-1 与 P3-2 的 PR 侧由 lead 处理。

## Decision Log

| 编号 | 决策 | Rationale | 日期 / 来源 |
|---|---|---|---|
| D1 | test-only，只改 scheduler 测试文件；两条用例，不改生产代码、不重写 Core 矩阵；新用例在未变异树变红时停止并报告 | #571 已交付实现；issue 剩余是证据缺口；红意味着真实生产缺陷，超出本 PR 授权 | 2026-11-24 Lead 决策 + 两份设计收敛 |
| D2 | 用例 1 为 2 行组合矩阵，第二 tick 取成功轮（`calls===2`），不取连续两轮失败 | 钉住 Lead 措辞「上报一次…下一 tick 正常」；连续失败各报一次已有 `:270` 的普通 Error 覆盖，非 Error 每轮重复上报不在 issue 范围 | 2026-11-24 本轮评审收敛（工程设计的两轮失败序列未被采纳） |
| D3 | 用例 2 同时跑 stop 与 dispose，并在上报后再次 `dispose()` 断言不重复 | Lead 明确要求「各恰好上报一次，重复 dispose 不重复」；`disposed` 守卫只有 dispose 支路可杀 | 2026-11-24 Lead 决策 + 系统设计 |
| D4 | 变异 6 条（M1–M6，2 个锚点）写入 ExecPlan；运行时 spec 放 git 忽略的 `.superpowers/`，不保留临时变异 | Lead 指定 6 条锚点；`review-mutate.mjs` 保证施加、归因与逐字节还原 | 2026-11-24 Lead 决策 + 工程设计 |
| D5 | 不新增 `tests/integration/README.md` 行，不更新 windows-native 清单 | 该 README 是主题清单不是逐文件台账；新增行会造第二份部分清单；清单不含本文件 | 2026-11-24 两份设计 + Lead 决策 |
| D6 | Batch 1 = 计划 + 索引 + draft PR；实现从 Batch 2 起；PR `Closes #336` 只关闭证据缺口，`Status` 由人类决定 | 仓库流程要求先计划再代码；Lead 指定交付边界与 PR 关闭语义 | 2026-11-24 Lead 决策 + `docs/development/workflow.md` §1–§3 |
| D7 | test-only 的 TDD 顺序：先在未加用例树上跑同一 V3 spec 作必要性对照（M1–M3 `SURVIVED`），再实现两条用例并复跑同一 spec（6/6 `KILLED`）；未变异树新增用例全绿，判别性 RED 由 review-mutate 提供 | 本 PR 无生产实现可先红后绿；未变异树红即真实生产缺陷（D1 停止条件）。用「变异前 SURVIVED → 变异后 KILLED」构成可审阅的红绿对照，且不弱化断言、不删既有用例 | 2026-11-24 实施记录 |
| D8 | 提交正文 trailer 统一 `Refs #336`；`Closes #336` 由 PR body 承担，不 reword 已提交历史 | AGENTS.md §6 允许 `Closes` 或 `Refs`，§8 要求 PR 描述含关闭关系；PR body 已含 `Closes` 且 `closingIssuesReferences` 回读含 336；改写已提交文档提交无收益且违反不改写历史纪律 | 2026-11-24 验收处置（P3-2） |
| D9 | 在 `docs/review/` 新增本 PR 独立对抗验收记录并更新 §8 索引；文件集合由 3 文件扩为 5 文件（仍无生产代码/测试改动） | 验收报告是可复核的长期证据；仓库惯例（如 PR #659/#673 收口提交）把独立验收记录随交付归档；不新增则 P0–P3 矩阵、处置与残余风险只存在于 git 忽略的 `.superpowers/` 运行态 | 2026-11-24 验收处置 |
| D10 | 归档计划中的 scheduler 行号改为归档 head 回读，V1 命令直接写 `completed/` 路径；P3-5/仅观察项不改测试 | 归档计划应自洽可执行；行号与路径错误只影响可读性/可执行性；为取证改测试会引入未验证变更，超出验收处置授权 | 2026-11-24 验收处置（P3-3/P3-4/P3-5） |
| D11 | 验收处置轮允许在 `Progress`/`Outcomes` 记录被验收 head 快照（注明 `git rev-parse HEAD` 来源与易失性），其余 PR 编号/checks 仍只写回读命令 | 验收交接需要锁定被验收对象；push/ready 属 lead，远端 head 与 checks 必须在 push 后回读 | 2026-11-24 验收处置 |
| D12 | 将验收时仍待 lead 执行的远端回读视为历史状态：当前 PR 已非 draft，review bot 已 APPROVED；Reconcile 的两个 CANCELLED runs 有同 head SUCCESS 后继。人类伙伴明确授权 root 将 PR title 改为 `test(core): cover planning reconciler diagnostics failures`，由 root 执行并回读 | 2026-11-24 的当前远端观察 supersede 先前“push/ready/checks 待执行”的阶段性记录；标题是唯一剩余 P3，权限来自人类伙伴在本会话对 root 的直接授权 | 2026-11-24 root 协调更新 |

## Idempotence and Recovery

- V1–V4 均可重复；V2 无真实 interval、无网络；V3 由 `review-mutate.mjs` 在施加前读原文字节、结束后写回并逐字节比较，不依赖 git，工作树脏也安全；`.superpowers/` 下 spec 与日志可随时删除重写。
- 若 V3 报 `NOT_APPLIED`：锚点漂移；用只读字符串计数复核两个锚点，更新 spec 与 `Bottom Change Note`，不得把未施加当 KILLED。
- 若 V3 报 `KILLED_OTHER` 或 `SURVIVED`：先看失败用例名与 `git diff`，确认是断言不足还是变异等价；补断言属 Batch 2 范围，禁止改生产代码迎合变异。
- 若 V2 在未变异树红：按 D1 停止并报告，本计划不提供"顺手修复"路径。
- 回滚：Batch 1 / Batch 3 revert 文档提交（索引与计划一起）；Batch 2 revert 测试提交并删除运行态 spec；无数据、迁移、外部状态或 PR 之外的副作用。
- 易失状态（PR 编号、head、checks）默认不写入正文事实，以 `gh pr view <n> --json ...` 回读为准；验收处置轮的被验收 head 快照例外见 D11。

## Interfaces and Dependencies

- 运行环境：Node.js v26.13.1（2026-11-24 观察）、pnpm scripts（`test:file`）、`node scripts/resolution-check.mjs`（`test:file` 前置）、`node scripts/review-mutate.mjs`、`node scripts/rule-checks.mjs`；PR 字段回读需要已登录的 `gh`（`-R SingularityKChen/harness-projects`）。
- 无新增依赖、包导出、import 边、类型、错误码或配置；生产符号与 `packages/core/src/index.ts` 公开面不变。
- 消费的既有契约：`createPlanningReconciler(source, { intervalMs, timers, diagnostics })`、`PlanningReconciler.start/stop/triggerNow/dispose`、`diagnostics.syncRoundFailed(error: unknown): unknown`；测试只使用 `@harness-projects/core` 已导出的 `composeCore` / `createPlanningReconciler` 与既有 fixture。
- 运行态路径：`.superpowers/iteration12/336/mutations.json`（git 忽略，见 `.gitignore:18`），不进入 PR。

## Outcomes & Retrospective

**Batch 1（lead，2026-11-24）**：计划入库、索引一行、draft PR 建立（base `main`、head 分支符合预期、draft 状态回读一致）。易失值（PR 编号、head、checks）按当时约束不落盘（验收处置轮的 head 快照规则见 D11）。

**Batch 2（impl-336，2026-11-24）**：V2 实跑 `tests 77 / pass 77 / fail 0 / cancelled 0 / skipped 0`（exit 0，改动前基线 75）；V3 实跑 6/6 `KILLED`（exit 0，前后基线绿、生产文件逐字节还原）；实际技术新增 +59 行、0 删除，仅 `tests/integration/planning-refresh-scheduler.test.js`。未变异树新增用例全绿，未触发 D1 停止条件；无需变更计划文件集合。

**Batch 3（impl-336，2026-11-24）**：最终 head 实跑 V1（归档后 `completed/` 路径）、V2 `tests 77 / pass 77 / fail 0 / cancelled 0 / skipped 0`（exit 0）、V3 6/6 `KILLED`（exit 0，前后基线绿、生产文件逐字节还原、`git diff -- packages/core` 为空）、V4 `size` 代码 59/1000、文档 231/1500，`disclosure` 机械扫描通过、`git diff --check main...HEAD` 无输出（exit 0）。实际规模：技术 +59/−0、文档 +231/−0（计划估算文档约 217，多出的 14 行是执行期补记的证据与偏差记录）；计划归档到 `docs/exec-plan/completed/`，索引行由 Active 移到 Completed（行数不变）。

**偏差与遗留**：① 交接时 `Progress` 仍写「三个批次均未开始」，Batch 1 完成事实由本实现 owner 在 Batch 2 提交中补记；② 新增 D7 的「加用例前必要性对照」，属计划外补充证据，不改变交付物与文件集合；③ push、PR head/base/checks/review threads 回读与 `gh pr ready` 属 lead 操作，本实现 owner 按授权未执行，PR 保持 draft（验收处置轮同样未执行 gh 写操作）；④ 未改生产代码、公共导出、错误码、既有测试或文件集合外文件，V3 后 `git diff -- packages/core` 为空。

**独立对抗验收与处置（a-336，2026-11-24）**：独立验收 agent 在本地实现 head `0eb15a5bc4021fc4a5d006e8edd6ccff650ada76`（`git rev-parse HEAD` 实测；分支未 push，远端 head 仍为 Batch 1 文档提交 `b4d7542a`）完成对抗验收，结论 PASS WITH FINDINGS：无 P0/P1/P2，4 条 P3（PR body 滞后、提交 trailer 措辞、scheduler 行号基于 main、V1 归档路径不可原样执行）+ 仅观察项；独立复现 V2 77/77、V3 6/6 KILLED、计划外反例 X1–X6 KILLED、语义等价重构 R1–R3 SURVIVED 与加用例前必要性对照。处置：P3-2/P3-3/P3-4 在本计划修正；P3-1 与 P3-2 的 PR 侧留给 lead 在 push 后处理；P3-5 及判别力重叠/重复 dispose/unhandled 归因串扰只记入 `docs/review/pr-675-mmp-review.md` 残余风险，不改测试。处置后树复跑 V1 exit 0、V2 `tests 77 / pass 77 / fail 0`、V3 6/6 `KILLED`（前后基线绿、生产文件逐字节还原）、V4 `size` 代码 59/1000、文档 322、`disclosure` 通过、`git diff --check` 无输出；详见评审记录与 `Progress`。

**Superseding lead follow-up（2026-11-24）**：上述“push/PR 回读与 ready 由 lead 执行”的文字保留为 implementation handoff 当时的状态，现由后续回读 supersede。当前 PR head 仍为 `990aeed85eb8f061dae17fa2027e2e878119ab4c`，base `c24d149151964c2fe8ef0d120a9facab3c65b356`，非 draft，review #6036635356 已 APPROVED。`Create review session` 因可选本机 endpoint 返回 404；早期显示为 fail 的 Reconcile runs `45358331922`、`45359931018` 实际 CANCELLED，且同一 head 有成功后继 `45358560782`、`45359408254`。人类伙伴已明确授权 root 将标题更正为 `test(core): cover planning reconciler diagnostics failures`；截至本次记录更新，title 回读仍为旧值，该 P3 等 root 执行并回读后关闭。详见 `docs/review/pr-675-mmp-review.md`。

## Bottom Change Note

- 2026-11-24：创建。逐条比较两份独立设计并按 Lead #336 决策收敛：采用 2 条用例（组合矩阵 + stop/dispose late）、6 条变异锚点、唯一文件集合与 Batch 1–3 边界；记录设计期只读证据与诚实判别力边界；未执行实现、未改动除本计划与 `docs/README.md` 之外的任何文件。
- 2026-11-24（Batch 2）：新增两条 scheduler 诊断用例（+59 行，仅加 `import vm from 'node:vm'`）；先跑未加用例树的同一 V3 spec 作必要性对照（M1–M3 `SURVIVED`），加用例后 V2 77/77、V3 6/6 `KILLED`、生产文件逐字节未变；记录 M4/M5/M6 的既有用例同红事实与 M4 归因粒度限制。
- 2026-11-24（Batch 3）：最终 head 复跑 V1–V4 全绿并归档到 `docs/exec-plan/completed/`，索引行由 Active 迁移到 Completed（行数不变）；记录技术 +59/−0、文档规模、计划外偏差（Batch 1 Progress 补记、D7 必要性对照）与 push/ready 仍属 lead 的遗留项。
- 2026-11-24（验收处置）：独立对抗验收（PASS WITH FINDINGS，无 P0–P2，P3×4）后修正归档计划的提交 trailer 约定（`Refs #336`，`Closes` 由 PR body 承担）、scheduler 行号（按 head 回读）与 V1 路径（`completed/`，可原样执行）；新增 `docs/review/pr-675-mmp-review.md` 与 `docs/review/README.md` 索引行，并把 P3-1/仅观察项作为残余风险记录；处置后复跑 V1–V4 全绿，未改测试与生产代码。
- 2026-11-24（Lead 远端复核）：回读 PR #675 当前 head/base、APPROVED review、check rollup 与 reconciliation workflow runs；将 implementation handoff 中已过期的 draft/未回读状态标记为历史，并记录人类伙伴对 title 更正的明确授权。title 更新由 root 执行，未在本轮写 GitHub。


2026-11-24 root 执行回读：PR 标题已改为 `test(core): cover planning reconciler diagnostics failures`，与测试交付范围一致；上文“待 root 执行”的记录现已失效，P3 关闭。接合 #674 真实 main 时仅合并双方 Completed/Review 索引条目，原索引全部保留；自身生产/测试 blob 与首审头不变，77/77、零 skip 再次通过。
