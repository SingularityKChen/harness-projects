# 同步修订号与结构化同步失败 ExecPlan

> 状态：Completed（2026-10-08）。Batch 0（设计定稿、本计划、ADR-0012、索引）与 Batch 1–3（实现者）已完成；Batch 4 的三轮对抗验证共 21 条发现（P2×5、P3×16）已逐条复现并处理（Progress、`Surprises & Discoveries` S13–S29、`Decision Log`、`Artifacts and Notes` A8–A10）；PR #290 的 MMP 评审（Singularity-AI-Bot，APPROVED，2 × P2、3 × P3）与人类伙伴的四项裁决已在 Batch 5（评审修复轮）处理（S30–S33、`Decision Log`、A11），ADR-0012 随之采纳；第二轮评审（Singularity-AI-Bot，在 head `375d8a75` 上出 1 × P2、5 × P3，其中 PR 正文一条由协调者处理）与人类伙伴对「诊断出口接线的承接 issue」的裁决已在 Batch 6 处理（S34–S37、`Decision Log`、A12）；第三轮评审（Singularity-AI-Bot，1 × P3：`composeCore` 冷启动调用点不等待钩子没有用例）已在 Batch 7 处理（S38、`Decision Log`、A13）；整合、推送、回读与合并由协调者与人类执行，合并状态以 `gh pr view 290 -R SingularityKChen/harness-projects --json state,mergedAt,headRefOid` 回读为准。
> 创建：2026-10-08 CST；规范：`PLANS.md`（全部强制章节；另含本仓库计划 lint 要求的 `Concrete Steps` 与 `Artifacts and Notes`）。
> 范围：一个 PR 同时关闭 #220（业务修订号只随已提交内容变化推进）与 #199（Storage 拒绝等异常变成结构化同步失败）。只改 `packages/core` 的同步写者、新鲜度读取与一个可选的宿主诊断出口（`CoreDeps.diagnostics`，评审修复轮），外加两处端口 / client 注释；不改 Storage 端口签名、适配器、迁移、wire 形状与 client 行为。
> 关联：epic #216 的 Batch 2E（控制计划 `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`）；规则正文 `docs/adr/ADR-0012-business-revision-advances-only-on-content-change.md`（Accepted，见 `Decision Log` 2026-10-08 18:40 CST）。
> 执行上下文：检出 `fix/sync-revision-freshness` 的工作树根目录（`.worktrees/sync-revision-freshness`，起点 `origin/main@6417d45`，依赖已装；评审修复轮已变基到 `origin/main@a357ef8`，无冲突，`git range-diff` 三个提交逐一等价，S31）。下文所有命令都在这个目录运行；下文的「base」读回仍指起点 `6417d45`，main 在这段增量里没有改 `bootstrap.ts` 与新鲜度读取，读回在新 main 上相同（A11）；`gh` 一律带 `-R SingularityKChen/harness-projects`。
> 上游输入：#199、#220 的正文与评论；`docs/architecture/release-gates.md` §2.1.1；`docs/product/vertical-path.md` §2.1；ADR-0003；`docs/exec-plan/tech-debt-tracker.md` 的 TD-020、TD-022、TD-023、TD-024；协调者 2026-10-08 的跨 PR 契约 K1–K8 与三份独立设计稿（α 最小闭环、β 系统与不变量、γ 同类工具调研）。契约与设计稿是运行态文件，不随仓库分发；本计划只重述其中仍然有效的结论，冲突时以本计划为准。

## Purpose / Big Picture

完成后：

1. **修订号只表示业务变化**。相同输入的引导（含重启后组合期的那次引导、同一观察重复投递、更旧的观察晚到）不推进业务修订号，也不重写任何行的修订号；已提交的规划快照有新增、修改或移除时恰好推进一次。watch 对内容不变的刷新不再发 delta，客户端不再整表重渲染。
2. **刷新只记新鲜度**。内容不变的成功刷新把同步游标写成 healthy，并把 `reconcile_cursor.lastReconciledAt` 写成本轮时刻（ADR-0003 第 3 条的「上次全量对账时刻」第一次有写者）。
3. **未提交的一轮不再裸抛**。从读取到提交之间的任何异常（Storage 拒绝观察、provider 抛出、编程错误）都变成结构化失败：命令返回 `{ ok: false, degraded: true, error.code: 'unavailable' }`，游标 degraded 带错误码，读侧每行标陈旧，修订号与对账时刻不动，原异常文字不进命令结果，只经可选的 `diagnostics.syncRoundFailed` 交给宿主（评审修复轮，TD-030，D12）。
4. **从未成功同步过的工作区不报新鲜**：同步游标缺失读作 `{ degraded: true, stale: true, reason: 'idle' }`。
5. **规则可被兄弟 PR 引用**：ADR-0012（Accepted，人类伙伴 2026-10-08 批准）写明修订号规则，交付写者（#221、#222）据此不推进修订号。

最小成功证据（在本分支的工作树根目录）：P2 读回 `revision 1 -> 1 | entities 5 -> 5`（base 为 `2 -> 3`）；重写后的 X2 读回 `bootstrap false unavailable | cursor degraded unavailable | any view degraded true`（base 为 `bootstrap threw RangeError | cursor healthy undefined | any view degraded false`）；`Design / Spec` 的 D11 列出的 71 条用例（按 Storage 展开；最终验收时为 52 条，评审修复轮新增 11 条，第二轮评审新增 6 条，第三轮评审新增 2 条）在 base 源码上全红、在本分支上全绿；变异表 M1–M46 每条都有用例变红。

## Context and Orientation

### 术语

| 词 | 在本计划里的意思 |
|---|---|
| 业务修订号 | Storage 端口的 `currentRevision` / `advanceRevision`（表 `workspace_revision`），controller 快照与 watch 帧的版本号。规则见 ADR-0012 |
| 行修订号 | `WorkspaceProjection.revision`，经 wire 成为每行的 `source.revision` |
| 一轮同步 | 一次 `bootstrapWorkspace(context)` 调用：读观察、读项目、分页读全部条目、在一个 Storage 事务里提交。#134 的定时对账与手动刷新复用它 |
| 提交 / 未提交 | 事务成功返回为提交；provider 结构化失败、任何异常与回滚都是未提交 |
| 新鲜度 | 读侧的 `SyncSummary`（`degraded` / `stale` / `reason`），唯一来源是同步游标；对账时刻是另一份事实（`reconcile_cursor`） |
| 双重故障 | 一轮未提交，而且连 degraded 游标也写不进 Storage |
| base | `origin/main@6417d45` |

### 相关文件（行号以 base 为准）

- `packages/core/src/bootstrap.ts`：`bootstrapWorkspace`（:49–63）在门禁之后直接调用读取与 `commitSync`，没有 try/catch；`commitSync`（:115–138）在事务第一句无条件 `tx.advanceRevision`（:120），`upsertItems` 逐行 `putPlanningProjection`（:153，随后被 :123 的 `replacePlanningProjections` 整批覆盖，是多余写入）；`fail`（:213–226）只服务 provider 的结构化失败。
- `packages/core/src/queries.ts`：`syncSummary`（:85–97）在 `cursor === undefined` 时返回 fresh（:91）。
- `packages/core/src/context.ts`：`composeCore`（:129–148）用 `catch {}` 吞掉组合期引导的异常，注释说「降级交给游标状态表达」，但 base 上这条路径不写游标。本计划不改这个文件。**Superseded by `Decision Log` 2026-10-08 18:40 CST（评审修复轮）**：为 TD-030 的诊断出口，`context.ts` 只新增可选的 `CoreDiagnostics` 与 `CoreDeps.diagnostics`，`composeCore` 的 `catch {}` 与其注释不动。**Superseded in part by Batch 6（第二轮评审）**：`composeCore` 的 `catch` 现在绑定异常、在吞掉之前交给同一个诊断出口（D12、S36），仍然吞掉，不改任何命令结果。
- `packages/core/src/status-policy.ts`：第二个修订号写者 `writePlanningStatus`（:83–101），只在 `decision.wrote` 为真时推进，已符合 ADR-0012；本计划不改。
- `packages/capabilities/src/storage.ts`：`recordObservation` 的端口注释（:214–222）写着「拒绝是裸异常……（#199 承载结构化失败）」；`ReconcileCursorRecord`（:109–113）与 `get/putReconcileCursor`（:226–227）存在，两个适配器都实现了，但 core 从未调用；`advanceRevision`（:236–238）。
- `packages/controller/src/watch.ts`：同修订上业务签名变化发 gap，来源变化发 metadata，修订号前进发 delta。
- `packages/client/src/sync.ts` 与 `workspace-read.ts`：`lastUpdatedAt` = 客户端接受一帧宿主判定为当前值的帧的时刻；idle poll 不推进，metadata 只在由 degraded 恢复时推进（`workspace-read.ts` :12–15 的注释）。
- `packages/capabilities/src/observation.ts` :146–150：`assertComparableSourceVersion` 抛 `RangeError`，消息里带着输入值本身。
- 测试：`tests/e2e/chain-bootstrap.test.js`（替身上的引导）；`tests/e2e/workspace-read-assembly.test.js` :33–35 的 `cursor()` 辅助函数和 :98、:259 两处「手写 healthy 游标模拟恢复」——它们绕开真实引导，正是因为真实引导会推进修订号；`tests/integration/storage-sync-surface.test.js`（#220 验收 4 点名的文件）。

### 当前状态（在 base 上实测，探针见 `Artifacts and Notes`）

- **P2**：`revision 2 -> 3 | entities 5 -> 5`。
- **#199 可移植触发**：provider 交出一条 `sourceVersion: 'vé'` 的观察（绕过 `emitObservation` 的入口校验），在替身与 SQLite 上都到达 `recordObservation` 并被拒绝：已同步过的工作区 `threw RangeError | cursor healthy | sync {"degraded":false,"stale":false} | items 5`；冷启动 `cursor none | sync fresh | items 0`。
- **#199 SQLite 旧载体触发**（TD-020 记录的起点）在 `:memory:` 上同样复现：`bootstrap threw Error | cursor healthy undefined | sync {"degraded":false,"stale":false}`。
- **客户端冷启动**：首轮引导被拒后 `sync.connect()` 读到 0 行、`lastUpdatedAt` 已设置、`reason` 为 undefined，也就是显示成「已读取当前快照，共 0 项」（#199 评论 2）。
- **`reconcile_cursor` 没有写者**：两次刷新后 `getReconcileCursor` 仍是 undefined。

### 上游验收原文（逐条落在 `Validation and Acceptance`）

- #220：相同引导两次修订号不变（`tests/e2e/chain-bootstrap.test.js`，修复前红）；内容变化的较新全量快照恰好推进一次；内容不变的手动刷新记录新鲜度而不推进修订号；`node --test tests/integration/storage-sync-surface.test.js` 通过。
- #199：被拒绝的观察让同步游标 degraded 并带错误码，新鲜度读取报告它；一条共享或集成用例证明失败后的游标状态，撤掉翻译的注入实验让它变红。评论 2 建议的验收：冷启动或成功之后的裸异常都不让 client 的 `lastUpdatedAt` 前进，用例从 `composeCore` 出发读 `sync.read().lastUpdatedAt`。
- 控制计划 2E：同一观察 N 次业务修订号等同一次，较旧观察不能覆盖较新快照，相同全量内容的手动刷新只记新鲜度；合并时更新矩阵第 3 行与 R1 第 7 行。

## Design / Spec

### D1 语义定义

- **业务修订号**：规则正文只在 ADR-0012 第 1–7 条（本计划不复述条文）。要点：快照内容变化才推进、一个事务至多一次、移除也算变化；未提交不推进；刷新、游标、对账时刻、账本、成员关系、查询都不推进；交付写者不推进；扩大覆盖面者负责。
- **一轮同步（R-ROUND）**：每轮的持久结果只有三样——同步游标（提交成功写 healthy，有不可锚定条目时附 `permission_denied`；未提交写 degraded + 错误码）、对账时刻（只在提交成功时写 `context.clock()`）、业务修订号（只在快照内容变化时推进）。不新增轮次计数或尝试时刻。
- **新鲜度（R-FRESH）**：唯一来源仍是同步游标。游标缺失（从未写进过任何结果）读作 `{ degraded: true, stale: true, reason: SyncState.Idle }`；其余分支不变。
- **覆盖面前提**：快照 = 投影行 + 每行主身份。今天一轮同步只会新建实体与身份（`packages/core/src/identity.ts` 的 `ensureEntity` 找到即返回、找不到才新建），从不把已有实体改指到另一个主身份，所以「比较投影行」等价于「比较快照」。#283 若引入改指，按 ADR-0012 第 6 条把身份纳入比较。

### D2 变化检测：写后重读、深比较、整批重盖

在同一个事务里：先读出事务前的全部投影 `before`；按每行原来的行修订号（新行用当前修订号）写一次 `replacePlanningProjections`；再读出 `after`；两边去掉 `revision`、按 `entityId` 排序后用 `node:util` 的 `isDeepStrictEqual` 比较。不同则 `advanceRevision` 一次，并把本轮写入的行重写成新修订号。

- **经得起 SQLite 往返**：比较的两侧都是同一个 Storage 的读回，键序与缺省字段的表示一致；`isDeepStrictEqual` 本身也不看键序。实测 SQLite 读回与 core 计算值的整对象 `JSON.stringify` 全部不等、深比较全部相等（`Artifacts and Notes` A3）。
- **移除也是变化**：`replacePlanningProjections` 按 Storage 自己的作用域（本连接的身份所指实体）删掉不再出现的行，`after` 自然少一行；core 不复制作用域逻辑。
- **#202 的旧源残留不被误判**：停用旧源后残留的旧源投影同时出现在 `before` 与 `after` 里，比较相等。用例 T6 与变异 M9 钉住这一点。
- **整批重盖**：推进修订号时，本轮写入的每一行都盖上新修订号（ADR-0012 第 2 条），保留 `wire.ts` 的 `revisionOf` 兜底（不传 `workspaceRevision` 的 controller 用行修订号最大值当工作区修订号）在「只有移除」后的正确性。代价是 delta upsert 全部行，登记为 TD-033。
- **顺便删去多余写入**：`upsertItems` 不再逐行 `putPlanningProjection`，改为返回不带修订号的行 `UnstampedProjection`。

**裁决**（相对三份设计稿）：采纳 α 的写后重读 + `isDeepStrictEqual` + 整批重盖。放弃 β 的显式字段元组 `businessKey` 与「只重盖变化行」：元组要随字段增减手工维护（漏一列就静默丢变化），移除判定要在 core 里复制 Storage 的作用域；β 实测的键序陷阱只在「计算值对读回值」时出现，读回对读回不受影响。放弃 γ 的规范化 `contentKey` 与 `createRevisionStamp` 助手并让 `status-policy.ts` 改用它：`status-policy.ts` 已经只在 `wrote` 时推进，改它不保护任何验收；γ 的移除判定逐行调 `listIdentitiesForEntity`，同样复制作用域。

### D3 错误语义：整轮 catch、固定 `unavailable`、不转发原文

`bootstrapWorkspace` 在门禁之后把「读观察 → 读项目 → 读条目 → 提交」收进 `syncRound`，外面一层 `try { … } catch { return fail(…, unavailable, 固定文案) }`；provider 的结构化失败仍走原来的 `fail`。`fail` 本身不吞异常：双重故障时以游标写入的错误拒绝，三重故障（游标已写进、随后读修订号失败）时以该读取的错误拒绝（最终验收补，S27）。

| 情形 | 命令结果 `BootstrapResult` | 同步游标 | `getPlanningSync()` | 业务修订号 | 对账时刻 |
|---|---|---|---|---|---|
| 提交，快照内容变化 | `ok: true`，`revision` = 推进后的值 | healthy（有不可锚定条目时带 `permission_denied`） | fresh（带缺口码时 `degraded: true, stale: false`） | +1 | `context.clock()` |
| 提交，快照内容不变 | `ok: true`，`revision` = 当前值 | 同上 | 同上 | 不变 | `context.clock()` |
| provider 结构化失败 | `ok: false, degraded: true`，`error` = provider 码映射 | degraded + 该码 | `{ degraded: true, stale: true, reason: 该码 }` | 不变 | 不变 |
| 任何异常（Storage 拒绝、provider 抛出、编程错误） | `ok: false, degraded: true`，`error.code = 'unavailable'`，`error.message = SYNC_ROUND_FAILED` | degraded + `unavailable` | `{ degraded: true, stale: true, reason: 'unavailable' }` | 不变 | 不变 |
| 双重故障 | Promise 以游标写入的错误拒绝（文字是 Storage 驱动原文，controller 命令层不翻译，泄漏面与出口见 TD-031；组合期的水合里这个拒绝被 `composeCore` 吞掉，吞掉之前交给诊断出口，D12） | 不变（缺失或保持原值） | 游标缺失时 `{ degraded: true, stale: true, reason: 'idle' }`；原为 healthy 时仍报 fresh（TD-031） | 不变 | 不变 |
| 三重故障：degraded 游标已写进，随后读当前修订号失败 | Promise 以该读取的错误拒绝（驱动原文，同 TD-031） | degraded + 本轮错误码（已落账） | `{ degraded: true, stale: true, reason: 该码 }` | 不变 | 不变 |
| 门禁不通过（有规划绑定） | 与 base 相同：`ok: false, degraded: true`，`error` = 门禁错误 | degraded + 门禁错误码（与 base 相同） | 走门禁分支：`{ degraded: true, stale: true, reason: 门禁文案 }` | 不变 | 不变 |
| 没有规划绑定 | 与 base 相同 | 不写 | 与 base 相同 | 不变 | 不变 |

`SYNC_ROUND_FAILED` 是固定安全文案（建议：`同步异常中止，本轮没有提交任何事实；读侧保留最后已知值`），不含驱动文字、SQL、版本值或堆栈：`RangeError` 的消息里带着 provider 给的版本值，这条消息会经 controller 的命令结果发给 client。文案本身由 `assertRoundFailed` 钉住「非空」、I10 钉住「四种触发给出同一句话」（对抗验证第 2 轮：它曾被改成空串而 64 条用例全绿，M23）；不导出常量（那会把它变成 core 的公共 API），也不钉具体措辞。

**裁决**：采纳 α。放弃 β 的「`StorageInputError` 透传 `e.failure`」：今天同步路径上抛不出 `StorageInputError`（它只用于 `putExecutionContext`），这个分支是没有用例能触达的死代码。放弃 γ 的「为观察拒绝新增类型化 `StorageInputError`（`invalid_input`），其余异常尽力标降级后原样重抛」：重抛违反协调者契约 K2（任何异常都转成结构化失败、绝不裸抛）；类型化拒绝要改端口、两个适配器与共享拒绝矩阵（约 +45 行实现），#199 的验收只要求「带错误码」。永久拒绝与暂时故障同码的代价登记为 TD-030。**Superseded in part（评审修复轮，2026-10-08）**：原异常不再丢失，宿主可经 `diagnostics.syncRoundFailed` 取到（D12）；命令结果与读侧仍同码同文案，同码问题与类型化拒绝的出口仍是 TD-030。

**K2 的边界**：K2 覆盖「从读取到提交」的路径。双重故障发生在记录失败本身，此时返回 `ok: false, degraded: true` 会让调用方以为降级已经落账，而读侧仍可能报 fresh；本计划让它拒绝（响亮失败），冷启动时由 R-FRESH 兜住，非冷启动的残余登记为 TD-031。这是对 K2 的解释，已写进 `Decision Log`，可由协调者或人类推翻。

### D4 游标缺失读作陈旧

采纳 α、β（放弃 γ 的保持 fresh）：「没有任何成功证据」不得读成新鲜，这是 fail closed 的默认值，只改 `queries.ts` 一行。对抗验证第 1 轮指出同一原则也覆盖游标存在但 `state=idle`（从未成功）的形态，已并入同一分支（I9、M18）；`syncing`（一轮在途）今天没有写者，读侧语义留给 #134 的调度器（TD-034）。修复后，经 `composeCore` 装配的工作区游标缺失只发生在冷启动的双重故障（组合期引导成功写 healthy、失败写 degraded），所以它有判别用例（I4 用 Proxy 让第二个事务与游标写入都拒绝）。原型在 base 的 contract / integration / e2e / mvp0 全量上没有打破任何既有用例（`Artifacts and Notes` A5）。对抗验证第 2 轮复核：`idle` 与 `syncing` 今天都没有写者（`git grep -n putSyncCursor -- packages apps` 只有 `bootstrap.ts` 的 healthy 与 degraded 两处，A9），`syncing` 不是新缺陷；它的读侧语义取决于「此前是否成功过」，游标记录里没有这条信息，所以维持推迟给 #134 的调度器（TD-034）。

### D5 新鲜度通道：写 `reconcile_cursor`，不改 wire 与 client

- **写对账时刻**（采纳 β、γ 的这一半）：`commitSync` 在同一事务里 `putReconcileCursor({ workspaceId, lastReconciledAt: context.clock() })`。它保护 #220 验收 3「刷新记录新鲜度」在「healthy → healthy」时的可判定性：没有它，内容不变的刷新在 Storage 里不留任何痕迹（游标本来就是 healthy）；它也是 ADR-0003 第 3 条定义过、端口与两个适配器都已实现、却从无写者的事实。实现 1 行。
- **不把它带上 wire、不改 client 的确认规则**（放弃 β 的 Batch 3）。`lastUpdatedAt` 的定义（「接受一帧宿主判定为当前值的帧的时刻；idle poll 不推进」）一个字不改；base 上内容不变的刷新会推进它，靠的是 P2 产生的伪 delta。修复后它不再前进，这是定义本身的结果，不是悄悄改含义。本计划用两步把它钉住：W2 的末段断言「恢复之后再刷新一次，poll 为 idle、修订号不变、`lastUpdatedAt` 仍是恢复时刻」；`packages/client/src/workspace-read.ts` 的注释写明这一点。把对账时刻暴露给页面由 #229 决定、在 #218 的单次 summary 之上实现（TD-032）。理由：β 的方案要改 `SyncSummary`、wire 头、client 的确认规则与约 6 处 `SyncSummary` 深比较，并与 #218 正要改写的两次游标读（TD-024）撞在同一处。
- #199 评论 2 的建议验收（失败不推进 `lastUpdatedAt`）由 I3 直接覆盖，与 TD-024 的撕裂读无关：I3 的失败帧整表 degraded、每行也 degraded。
- **需人类在评审时明确接受的解释**（对抗验证第 1 轮，F8）：#220 验收 3 原文是「手动刷新记录新鲜度」。本计划把「记录」落在 Storage 的 `reconcile_cursor.lastReconciledAt`（T5 钉住 t1 到 t2、修订号不变），读侧（`getPlanningSync`、wire、client）看不到刷新发生，成功的空刷新也不推进 client 的 `lastUpdatedAt`（W2 末段钉住）；base 上它会前进，但那来自 P2 的伪 delta。若人类认为验收 3 要求读侧可见，出口是 TD-032（在 #218 的单次 summary 里带 `reconciledAt`）。PR 描述把这一点单列为待确认项，不当作已无争议的完成。**已裁决（2026-10-08 18:40 CST，`Decision Log`）**：人类伙伴接受「只落 Storage」的解释，PR 仍 `Closes #220`；读侧可见的「最后确认时间」归 #229 的验收，TD-032 的下一步指向它；本 PR 不改这部分代码。

### D6 规则落点

修订号规则写进 `docs/adr/ADR-0012-business-revision-advances-only-on-content-change.md`（起草时 Proposed，采纳权在人类；**Superseded by `Decision Log` 2026-10-08 18:40 CST**：已采纳为 Accepted），条款编号供兄弟 PR 与代码注释引用；`packages/capabilities/src/storage.ts` 的 `advanceRevision` 注释只加一句指向 ADR-0012，不复述条文。理由：规则是 controller watch、client 续传与 #218 代际共同依赖的接口语义，推翻它要重做已写好的代码，符合 `docs/adr/README.md` 的 ADR 判据；兄弟 PR（#221、#222）需要稳定的引用点。放弃「端口注释 + ExecPlan」：ExecPlan 归档后不是规则的自然落点，端口注释承载不了 Rejected 与 Consequences。

### D7 TS 签名与事务内顺序

公共签名一律不变：`bootstrapWorkspace(context): Promise<BootstrapResult>`、`BootstrapResult`、Storage 端口、`CoreQueries`、`SyncSummary`、wire、client。`BootstrapResult.revision` 的语义写进它的字段注释：本轮结束时的工作区业务修订号（内容不变或未提交时即当前值）。core 内部：

    // packages/core/src/bootstrap.ts（只新增 import { isDeepStrictEqual } from 'node:util'）
    type UnstampedProjection = Omit<WorkspaceProjection, 'revision'>
    interface SyncedItems { counts: SyncCounts; projections: readonly UnstampedProjection[] }
    const SYNC_ROUND_FAILED: string                      // 固定安全文案，见 D3
    async function syncRound(context: CoreContext, bindingId: ProviderBindingId, planning: PlanningProvider): Promise<ProviderResult<BootstrapResult>>
    function sameProjections(left: readonly WorkspaceProjection[], right: readonly WorkspaceProjection[]): boolean
    async function upsertItems(tx: StorageTransaction, context: CoreContext, items: readonly ProviderPlanningItem[]): Promise<SyncedItems>   // 去掉 revision 参数与逐行写投影
    function toProjection(workspaceId, entityId, item, mapping): UnstampedProjection                                                         // 去掉 revision 参数
    function reportSyncRoundFailure(context: CoreContext, error: unknown): void                                                               // 评审修复轮，D12；第二轮评审移到内部模块 `diagnostics.ts`（不经包入口导出）：不等待钩子，用 Promise 构造器吸收任何返回值，同步抛错与任何 thenable 的拒绝都吞掉
    // packages/core/src/context.ts（评审修复轮）：export interface CoreDiagnostics { readonly syncRoundFailed?: (error: unknown) => void }；CoreDeps.diagnostics?: CoreDiagnostics；CoreContext.diagnostics: CoreDiagnostics | undefined；第二轮评审：`composeCore` 的水合 `catch (error)` 调用 `reportSyncRoundFailure(context, error)`

    // bootstrapWorkspace：门禁原样；之后
    const bindingId = binding.ref.bindingId
    let round: ProviderResult<BootstrapResult>
    try { round = await syncRound(context, bindingId, planning) }
    catch (error) { reportSyncRoundFailure(context, error); return fail(context, bindingId, projectError(ProjectErrorCode.Unavailable, SYNC_ROUND_FAILED)) }   // 评审修复轮：原异常先交给宿主（D12）
    return round.ok ? round.value : fail(context, bindingId, toProjectError(round.error))
    // syncRound：原 :57–62 的四步；provider 失败 return providerErr(x.error)，成功 return providerOk(await commitSync(...))

`commitSync` 的事务内顺序（全部用 `tx`，不得用根句柄 `context.storage`；这条约束由 I11 与 I12 钉住：M20–M22 把推进修订号、对账时刻、healthy 游标各挪到事务之外后被 I11 杀死，M24、M25 把观察账本或实体 / 身份 / 成员关系写入挪到事务之前后被 I12 杀死）：

1. `before = await tx.listPlanningProjections(workspaceId)`；`let revision = await tx.currentRevision(workspaceId)`。
2. `synced = await upsertItems(tx, context, items)`：成员关系、实体与主身份照旧写入，不写投影。
3. `await recordObservations(tx, observations)`（不读返回值，TD-022 不变）。
4. `kept = new Map(before.map((row) => [row.entityId, row.revision]))`；`await tx.replacePlanningProjections(scope, synced.projections.map((row) => ({ ...row, revision: kept.get(row.entityId) ?? revision })))`。
5. `if (!sameProjections(before, await tx.listPlanningProjections(workspaceId)))`：`revision = await tx.advanceRevision(workspaceId)`，再 `await tx.replacePlanningProjections(scope, synced.projections.map((row) => ({ ...row, revision })))`。
6. `await tx.putSyncCursor(healthy …)`（与 base 相同）。
7. `await tx.putReconcileCursor({ workspaceId, lastReconciledAt: context.clock() })`。
8. 返回 `{ revision, counts }`。

`sameProjections`：两侧 `rows.map(({ revision: _revision, ...row }) => row).sort((a, b) => (a.entityId < b.entityId ? -1 : 1))` 后 `isDeepStrictEqual`。`node:util` 与 core 已用的 `node:crypto` 同属 Node 内置，不新增依赖。

### D8 文件所有权与行数估算

一个实现者串行改完全部代码文件（`bootstrap.ts` 被 Batch 1、2 共同修改）；文件集合只在 `Global Constraints` 声明。原型（`Artifacts and Notes` A6）实测：`bootstrap.ts` +46 / −15，`queries.ts` +1 / −1，`chain-bootstrap.test.js` +77，`workspace-read-assembly.test.js` +6 / −7，新集成文件 98 行。加上注释，估算实现约 80 行、测试约 190 行，代码桶合计约 270 行（规划上限 800、实现上限 350）；文档桶约 700 行（本计划约 520、ADR 约 40、证据回填约 80、债务行约 10、索引 3；规划上限 1300）。

### D9 被放弃的方案（汇总）

| 方案 | 来源 | 放弃理由 |
|---|---|---|
| Storage 判定「有没有变化」（`replace` 返回 changed 或新端口方法） | α、β、γ 都考虑过 | 改两个适配器与契约套件，Storage 要知道业务覆盖面；修订号须在写行前确定，顺序冲突 |
| 显式字段元组 `businessKey`、只重盖变化行 | β | 见 D2 裁决；TD-033 记录「只重盖变化行」的出口 |
| `contentKey` + `createRevisionStamp`，`status-policy.ts` 改走它 | γ | 见 D2 裁决 |
| `StorageInputError` 透传 | β | 同步路径上不可达，见 D3 |
| 观察拒绝类型化 + 其余重抛 | γ | 违反 K2，规模大，见 D3；出口 TD-030 |
| 游标缺失保持 fresh | γ | 见 D4 |
| 对账时刻上 wire 头、client 据此推进 `lastUpdatedAt` | β | 见 D5；出口 TD-032 |
| 只包住 `commitSync` | α 考虑过 | provider 抛出时游标仍 healthy，同类缺陷留着 |
| 删掉 `composeCore` 的 `catch` | α 考虑过 | 宿主启动变成响亮失败；该文件不在本 PR 的文件集 |
| 内容指纹列、刷新计数器 | β、γ 考虑过 | 要迁移；没有验收需要 |
| 把 `writePlanningStatus` 的投影读移进事务（γ 的 H6） | γ | 不保护 #199 / #220 的任何验收；是既有缺陷，交给人类决定是否开 issue（`Surprises & Discoveries` S7） |

### D10 每个机制保护什么

| 机制 | 保护的验收或不变量 | 用例 | 变异 |
|---|---|---|---|
| 写后重读 + 深比较才推进 | #220 验收 1、2；R1 第 7 条；2E | T1、T2、T3、T4、I1、I5–I8、I13、W1、W2 | M1 |
| 比较整个工作区读回（不只比本轮输入行） | 移除也是变化（#220 验收 2） | T4、I5 的「移除条目」、I13（移除全部条目） | M2（同时杀死 T6） |
| 比较整个工作区读回（不只比本轮写入后的行） | #202 残留不被误判 | T6 | M9 |
| 推进时整批重盖 | ADR-0012 第 2 条；`revisionOf` 兜底 | T4、I5、W1 | M3 |
| 写对账时刻 | #220 验收 3 | T5、I2、I7、I11、I12、I14 | M6 |
| 整轮 catch 转结构化失败 | #199 验收 1、2；#199 评论 2；K2 | I2、I3、I10、I11、I12 | M4 |
| 固定文案：非空、与触发无关、不转发原文 | K2；wire 不泄漏 provider 数据 | I2、I10、I11、I12 | M7、M23 |
| 双重故障拒绝 | D3 的 K2 边界 | I4 | M8 |
| 游标缺失读作陈旧 | #199 评论 2 的冷启动面（双重故障下） | I4 | M5 |
| Storage 拒绝更旧观察，经 core 观察 | R1 第 8 条；2E「较旧观察不能覆盖较新快照」 | T3、I8 | M10（替身）、M19（SQLite） |
| 比较不丢列：内容、规划状态、规划字段各自参与 | #220 验收 2（任何会进快照的变化都推进） | I5 的各类变化（标题、正文、状态、规划字段、可见与 redacted 互转、新增、移除，两个 Storage） | M14、M15、M16 |
| 没变的行保留原行修订号（`kept`） | ADR-0012 第 2 条后半（不推进的事务不改写任何行）；宿主权威下状态写后追平 | I6 | M11 |
| 整轮 catch 覆盖任何异常（不收窄成某种异常、不只包提交） | #199；K2 | I10、I11、I12 | M12、M13 |
| 不可锚定条目不是内容变化，缺口提交仍记对账时刻 | ADR-0012 第 2、7 条 | I7 | M17 |
| 游标 `state=idle` 读作陈旧 | R-FRESH（fail closed） | I9 | M18 |
| 一轮提交原子：推进修订号、healthy 游标、对账时刻、观察账本、实体 / 外部身份 / 成员关系与内容写入在同一个事务里（全部用 `tx`，不用根句柄） | ADR-0012 第 2、3 条；D5、D7；#199 验收（失败后读侧状态）；#220 验收 2（内容与修订号一起前进或一起回滚） | I11、I12 | M20、M21、M22、M24、M25 |
| 快照被清空也是变化（判定不以本轮有行为前提） | #220 验收 2 | I13 | M26 |
| provider 结构化失败不写对账时刻、不推进修订号 | ADR-0012 第 7 条；D3 表第 3 行 | I14 | M27 |
| 记录失败本身出错时拒绝，不吞（双重、三重故障） | D3 的 K2 边界 | I4（游标写不进） | M8；N29（读修订号失败时吞掉）有意不钉，见 Decision Log |
| 变化判定不依赖读回的行序（`sameProjections` 的排序） | ADR-0012 第 2 条；端口对 `listPlanningProjections` 的顺序没有承诺（评审修复轮，P3） | I15（行序，两个 Storage） | M28（评审的 X15） |
| 变化判定不依赖读回的键序（`isDeepStrictEqual`，不是序列化相等） | 同上；SQLite 与替身读回的键序不同（S2） | I15（键序，两个 Storage） | M29（评审的 X16） |
| 诊断出口：一轮异常中止时原异常原样（同一个对象）交给宿主，冷启动的首轮也一样 | TD-030（评审修复轮，P2）；D12 | I16、I17、I19 | M30、M32、M35 |
| 诊断出口只服务异常中止：成功提交与 provider 的结构化失败不调用钩子 | D12 | I17 | M33 |
| 钩子自己失败（同步抛错、抛非 Error 值、返回被拒绝的 promise，含另一个 realm 的被拒绝 promise、thenable 与读取 then 即抛错的对象）被吞掉，结果与没有钩子时相同 | D12；K2（钩子不得改变结构化失败的结果） | I18 | M31、M34、M41、M42 |
| 钩子先于 `fail`：记录失败时 Storage 再出错（双重故障）也不丢原因 | D12 | I4（追加的断言） | M36 |
| 钩子的返回值不被等待：永不 resolve 的钩子拖不住组合期的轮次异常（`bootstrapWorkspace` 里的调用点）与显式命令（第二轮评审 P3） | D12 | I20 | M37 |
| 钩子的返回值不被等待：永不 resolve 的钩子也拖不住冷启动的记录失败拒绝（`composeCore` 水合 `catch` 这个调用点；I20 的毒化观察到不了它，第三轮评审 P3） | D12；TD-031 | I20b | M46 |
| 组合期记录失败本身被拒绝（provider 结构化失败加游标写不进；游标写进后读修订号失败）时，拒绝在被 `composeCore` 吞掉之前交给宿主；显式命令里的同一拒绝只到调用方（第二轮评审 P3） | D12；TD-031 | I21、I22、I4 | M43、M44、M45 |
| 命令结果整体（core 的结果与 controller 的 `CommandResult` 两层，任何字段、任何深度）不含原异常文字（第二轮评审 P3） | K2；#199 | `assertRoundFailed`（I2、I10–I12、I16–I19 共用） | M38、M39、M40 |

### D11 测试计划（全部在 base 源码上实测为红、在本分支上为绿；最终验收后共 52 条，评审修复轮新增 11 条后共 63 条，第二轮评审再新增 6 条（I20×2、I21×2、I22×2）后共 69 条，第三轮评审再新增 2 条（I20b×2）后共 71 条，实测见 `Artifacts and Notes` A8、A9、A10、A11、A12、A13）

| # | 文件 | 用例名（标题前缀唯一） | base 上为什么红 |
|---|---|---|---|
| T1 | `tests/e2e/chain-bootstrap.test.js`（新增） | `修订号：相同输入的重复引导不推进业务修订号，也不重写行修订号（#220 验收 1，P2）` | 第 1 次相同引导的结果修订号前进 |
| T2 | 同上（新增） | `重复观察：同一观察经 core 投递 N 次，实体、账本与修订号同投递一次（R1 第 7 条）` | 打开 `FaultKind.DuplicateEvent` 后引导三次，修订号前进三次 |
| T3 | 同上（新增） | `乱序观察：经 core 先投递新观察再投递旧观察，旧观察不落账本，投影与修订号不变（R1 第 8 条）` | 旧观察被拒绝、账本不增，但修订号前进 |
| T4 | 同上（新增） | `修订号：内容变化的全量快照恰好推进一次，移除也是变化，随后相同引导不再推进（#220 验收 2）` | 标题变化后的相同引导仍推进 |
| T5 | 同上（新增） | `新鲜度：内容不变的手动刷新记录对账时刻，不推进修订号（#220 验收 3）` | 对账游标为 undefined |
| T6 | 同上（新增） | `修订号：换 Planning 源后旧源残留的投影不被当成每轮的变化（#202 交接）` | 新源内容不变的引导仍推进 |
| W1 | `tests/e2e/workspace-read-assembly.test.js`（改） | `metadata：同 revision 的来源降级与恢复各发一个窄事件`（标题不变；恢复改为真实 `core.commands.bootstrapWorkspace()`） | 恢复引导推进修订号，poll 得到 delta 而不是 metadata |
| W2 | 同上（改） | `metadata：同 revision 降级 / 恢复同时更新整表与每行 source`（标题不变；恢复改为真实引导，并追加「再刷新一次」的钉住断言） | 同 W1；钉住段在 base 上 poll 为 delta、`lastUpdatedAt` 前进 |
| I1 | `tests/integration/sync-revision-freshness.test.js`（新） | `修订号：相同输入的重复引导与重启后的组合都不推进业务修订号（#220，内存替身）` 与 `…（#220，SQLite）` | 同一份 Storage 上重新组合即推进 |
| I2 | 同上 | `存储拒绝：被拒绝的观察让同步结构化失败，游标 degraded 带错误码、读侧陈旧、修订号与对账时刻不动（#199，内存替身）` 与 `…（#199，SQLite）` | `bootstrapWorkspace` 以 `RangeError` 拒绝 |
| I3 | 同上 | `客户端时间：冷启动被拒或成功之后被拒，lastUpdatedAt 都不前进（#199 评论的建议验收）` | 冷启动 `lastUpdatedAt` 被设置、`reason` 为 undefined |
| I4 | 同上 | `双重故障：连失败都记不下时命令拒绝，从未成功的工作区读作陈旧而不是新鲜`（评审修复轮追加：连失败都记不下的两轮，原异常都已先交给宿主） | 游标缺失读作 fresh；base 上没有诊断出口 |
| I5 | 同上 | `修订号：标题变化恰好推进一次，本轮写入的行整批重盖，随后相同引导不再推进（#220 验收 2，<Storage>）`；同形的还有「正文变化」「状态变化」「规划字段变化」「可见变 redacted」「redacted 变可见」「新增条目」「移除条目」（8 类 × 2 个 Storage = 16 条；规划字段只由 `nativeValues` 改变，状态只由 `statusKey` 改变） | 随后的相同引导仍推进 |
| I6 | 同上 | `修订号：宿主权威下状态命令写一行、provider 追平后，相同引导不推进，也不重写没变的行修订号（ADR-0012 第 2 条，<Storage>）`（2 条） | 追平后的引导仍推进 |
| I7 | 同上 | `修订号：有不可锚定条目的重复引导不推进业务修订号，仍记对账时刻（#220，ADR-0012 第 7 条，<Storage>）`（2 条） | 重复引导推进、对账游标没有写者 |
| I8 | 同上 | `观察顺序：经 core 先投递新观察再投递旧观察，旧观察不落账本，投影与修订号不变（R1 第 8 条，<Storage>）`（2 条；账本行数以「新观察 +1 行」作对照，SQLite 经内部句柄读行数） | 旧观察被拒绝、账本不增，但修订号前进 |
| I9 | 同上 | `新鲜度：游标 state=idle（从未成功）与游标缺失同样读作陈旧，不读作新鲜（fail closed，<Storage>）`（2 条） | idle 游标读作 fresh |
| I10 | 同上 | `异常：provider 抛出任何值或观察流中途抛出，同样是结构化失败，不转发原文，恢复后照常（K2，#199，<Storage>）`（2 条；触发含 `listPlanningItems` 抛带秘密文字的 `TypeError`、抛字符串，`getProject` 抛普通对象，观察流 `reconcile` 中途抛 `TypeError`） | 以原异常裸抛 |
| I11 | 同上 | `原子提交：<方法>被拒绝时整轮回滚，内容、行修订号、修订号与对账时刻都与事务前逐字相同，游标 degraded（ADR-0012 第 2、3 条，<Storage>）`（3 个注入点 × 2 个 Storage = 6 条；注入点 `advanceRevision`、`putSyncCursor`（只拒 healthy，降级游标要能写）、`putReconcileCursor`，Proxy 在 tx 级与根级同时拒绝；改一个标题后引导，断言结构化失败、游标 degraded，修订号、各行的实体 / 行修订号 / 标题与对账时刻都与事务前相同，撤掉注入后同一改动恰好推进一次） | 以注入的错误裸抛 |
| I12 | 同上 | `整轮回滚：事务的最后一笔写入被拒绝时，本轮新登记的实体、外部身份、成员关系与观察账本也不留下（ADR-0012 第 3 条，<Storage>）`（2 条；新增一个条目并发一条更新的观察，`putReconcileCursor` 在 tx 级与根级都拒绝；实体、外部身份、成员关系、观察账本四张表的行数与事务前相同，撤掉注入后各多一行；替身读导出状态，SQLite 经内部句柄计数，S18） | 对账时刻没有写者，注入不触发，这一轮成功提交 |
| I13 | 同上 | `修订号：快照被清空也是变化，恰好推进一次，随后相同引导不再推进（#220 验收 2，<Storage>）`（2 条） | 随后的相同（空）引导仍推进 |
| I14 | 同上 | `结构化失败：provider 离线的一轮同样不推进修订号、不记对账时刻，游标 degraded 带码（ADR-0012 第 7 条，<Storage>）`（2 条；共用 `assertRoundFailed` 但不查文案：provider 结构化失败的文案本来就是 provider 给的） | 对账时刻没有写者，读回 undefined 而不是上一次提交的时刻 |
| I15 | 同上 | `顺序不依赖：读回的行序隔次被打乱（端口没有承诺），相同输入的引导仍不推进修订号，内容变化仍恰好推进一次（ADR-0012 第 2 条，<Storage>）` 与同形的「键序」（2 种打乱 × 2 个 Storage = 4 条；代理在每个事务内把第 1、3、5…次 `listPlanningProjections` 读回倒序整张表或递归倒序每个对象的键序，第 0、2、4…次原样；引导三次断言修订号与各行修订号不动，并断言代理确实改变了每次读回的序列化形态；最后改一个标题，断言恰好推进一次） | base 上每轮引导都推进修订号 |
| I16 | 同上 | `诊断出口：毒化观察让一轮异常中止，原 RangeError 交给宿主，命令结果与读侧仍只有固定文案；冷启动的首轮也一样（TD-030，<Storage>）`（2 条；钩子收到的是 `RangeError` 且原文带版本值；命令结果与 `getPlanningSync()` 的序列化不含原文） | base 上没有诊断出口，钩子不被调用 |
| I17 | 同上 | `诊断出口：provider 抛出的任何值都原样（同一个对象）交给宿主，命令结果不含它；成功提交与结构化失败不调用钩子（TD-030，<Storage>）`（2 条；复用 I10 的四种触发，`strictEqual` 同一个对象；成功提交与 provider 离线的一轮之后钩子计数不变） | 同 I16 |
| I18 | 同上 | `诊断出口：钩子自己抛错、抛非 Error 值或返回被拒绝的 promise，都被吞掉，结构化失败的结果与没有钩子时相同（TD-030，<Storage>）`（2 条；同一毒化触发下文案与没有钩子时逐字相同，恢复后照常；监听 `unhandledRejection` 断言没有进程级未处理拒绝；第二轮评审另加三种钩子：另一个 realm（`node:vm`）里被拒绝的 promise、then 里拒绝的 thenable、读取 then 即抛错的对象） | base 上毒化观察的一轮裸抛 `RangeError`；第二轮评审前的跨 realm 钩子让进程级未处理拒绝漏出 |
| I19 | 同上 | `诊断出口：SQLite 账本里的旧载体（TD-020 起点）让一轮异常中止，宿主收到的原文含 repairLegacySource，命令结果不含（TD-030）`（只有 SQLite 一条，内存替身的入口已断言、旧载体不可达；经 `storage.db` 写一条版本为 `v9` 的已提交观察，再对同一对象发规范版本的观察） | base 上裸抛 `Error`，宿主拿不到也没有出口 |
| I20 | 同上 | `诊断出口：钩子返回永不 resolve 的 promise，也不拖住一轮同步，组合期与显式命令都在期限内结束（TD-030，<Storage>）`（2 条；毒化观察，钩子记录调用并返回永不 resolve 的 promise；`world.open()` 与随后的显式命令各与 1 s 的计时器竞争，都必须先于计时器 settle，结果仍是固定文案的 `unavailable`，读侧陈旧；钩子被调用 1 次、2 次，免得用例空转） | 绿于修复前（实现本来就不等待）；红在 M37（`await` 钩子，评审的 H8） |
| I20b | 同上 | `诊断出口：冷启动记录失败也被拒绝、钩子返回永不 resolve 的 promise 时，不挂住组合期，显式命令仍直接拒绝（TD-030、TD-031，<Storage>）`（2 条；I21 的坏存储——provider 离线 + `putSyncCursor` 拒绝同一个 `Error`——加返回永不 resolve 的 promise 的钩子：`world.open()` 与 1 s 的计时器竞争，必须先于计时器 settle，钩子恰好 1 次；随后显式命令 `rejects` 同一个对象，同样先于计时器。I20 的毒化观察只走 `bootstrapWorkspace` 里的调用点，`fail` 成功，到不了 `composeCore` 的水合 `catch`，所以这个调用点要单独钉住） | 在 base 上钩子 0 次而红；在本分支上实现本来就不等待，红在 M46（只在这个调用点 `await` 钩子，评审的 H8c） |
| I21 | 同上 | `诊断出口：组合期记录失败本身也被拒绝时，那个拒绝在被吞掉之前交给宿主；显式命令的同一拒绝仍直接到调用方（TD-030、TD-031，<Storage>）`（2 条；provider 离线 + `putSyncCursor` 拒绝同一个 `Error`：组合期钩子恰好 1 次且 `strictEqual` 同一个对象，游标缺失、读侧 `idle` 陈旧；显式命令 `rejects` 同一个对象，钩子计数仍为 1） | base 与修复前：组合期钩子 0 次 |
| I22 | 同上 | `诊断出口：降级游标已写进、随后读当前修订号失败的三重故障，组合期同样把那个拒绝交给宿主（TD-030、TD-031，<Storage>）`（2 条；provider 离线 + 根句柄 `currentRevision` 拒绝：钩子 1 次且是同一个对象，degraded 游标已落账、读侧陈旧） | 同 I21 |

各用例的构造与断言见 `Plan of Work` 的步骤；关键辅助代码见 `Concrete Steps` C3。I1、I2、I5–I10、I12–I14、I16–I18、I20–I22、I20b 各按两个 Storage 注册，前缀回读为 2；I11 按三个注入点 × 两个 Storage 注册，前缀回读为 6；I15 按（行序、键序）× 两个 Storage 注册，前缀回读为 4；I19 只在 SQLite 上注册，前缀回读为 1。I2、I10、I11、I12、I17、I18、I19 共用 `assertRoundFailed` 判据（结构化失败、不含原文、文案非空、游标 degraded + `unavailable`、读侧每行陈旧、修订号与对账时刻不动；第二轮评审起它经 controller 发命令，一轮只跑一次，对 core 的结果与 `CommandResult` 两层都做 `JSON.stringify` 与 `util.inspect(showHidden)` 的 `doesNotMatch`，因为 Error 对象序列化成 `{}`，只查 `error.message` 或只查序列化都会放过把原异常挂到别的字段）；I14 也用它，但不查文案；I10 另断言四种触发给出同一句话。

**变异表**（在 `git archive` 导出目录里逐条应用，规程见 `Concrete Steps` C4；原型上的实测结果见 `Artifacts and Notes` A4，M11–M19 与第 1 轮的整表重测见 A8，M20–M23 与第 2 轮后的整表重测见 A9，M37–M45 与第二轮评审后的整表重测见 A12，M46 与第三轮评审后受影响行的重测见 A13）：

| 编号 | 文件 | 变异 | 期望变红 |
|---|---|---|---|
| M1 | `bootstrap.ts` | 判定改为恒推进（`if (true \|\| !sameProjections(…))`） | T1–T6、W1、W2，以及 integration 文件里的 I1×2、I2×2、I5×16、I6×2、I7×2、I8×2、I13×2（共 36；Batch 2 时为 12，第 2 轮后为 34）；评审修复轮后为 40（+I15×4） |
| M2 | `bootstrap.ts` | `before` 只保留本轮输入行再比较 | T4、T6、I5 的「移除条目」×2、I13×2（共 6；第 2 轮后为 4） |
| M3 | `bootstrap.ts` | 推进后不重写行（删第二次 `replacePlanningProjections`） | T4、W1、I5×16（共 18） |
| M4 | `bootstrap.ts` | catch 改为 `catch (error) { throw error }`（撤掉翻译，#199 验收 2 的注入实验） | I2×2、I3、I10×2、I11×6、I12×2（共 13；第 1 轮后为 5，第 2 轮后为 11）；评审修复轮后为 21（+I4、I16×2、I17×2、I18×2、I19）；第二轮评审后为 23（+I20×2） |
| M5 | `queries.ts` | 游标缺失改回 fresh | I4；第二轮评审后为 3（+I21×2） |
| M6 | `bootstrap.ts` | 删 `putReconcileCursor` | T5、I2×2、I7×2、I11×6、I12×2、I14×2（共 15；第 1 轮后为 5，第 2 轮后为 11） |
| M7 | `bootstrap.ts` | 失败文案改为 `String((error as Error).message)` | I2×2、I10×2、I11×6、I12×2（共 12；第 1 轮后为 4，第 2 轮后为 10）；评审修复轮后为 19（+I16×2、I17×2、I18×2、I19） |
| M8 | `bootstrap.ts` | `fail` 的游标写入追加 `.catch(() => undefined)` | I4；第二轮评审后为 3（+I21×2）；第三轮评审后为 5（+I20b×2） |
| M9 | `bootstrap.ts` | `after` 只保留本轮输入行再比较 | T6 |
| M10 | `packages/providers/fake/src/storage.ts` | `recordObservation` 删掉「更旧版本返回 false」那一行 | T3、I8 的内存替身一条 |
| M11 | `bootstrap.ts` | 第一次 `replacePlanningProjections` 的行修订号不再取 `kept`，一律用当前工作区修订号（`revision: kept.get(row.entityId) ?? revision` 改成 `revision`） | I6×2 |
| M12 | `bootstrap.ts` | catch 收窄成只接 `RangeError`（`catch (error) { if (!(error instanceof RangeError)) throw error; … }`） | I10×2、I11×6、I12×2（共 10；第 1 轮后为 2，第 2 轮后为 8）；评审修复轮后为 14（+I4、I17×2、I19） |
| M13 | `bootstrap.ts` | 把 try/catch 从 `bootstrapWorkspace` 挪进 `syncRound`，只包住 `commitSync`（读取阶段的异常裸抛） | I10×2；评审修复轮后为 4（+I17×2） |
| M14 | `bootstrap.ts` | `sameProjections` 比较时丢掉 `planningFields` | I5 的「规划字段变化」×2 |
| M15 | `bootstrap.ts` | `sameProjections` 比较时丢掉 `planningStatus` | I5 的「状态变化」×2 |
| M16 | `bootstrap.ts` | `sameProjections` 比较时丢掉 `content` | T4、I5 的「标题变化」「正文变化」「可见变 redacted」「redacted 变可见」×2、I11×6（撤掉注入后「同一改动恰好推进一次」的对照断言；共 15；第 1 轮后为 9）；评审修复轮后为 19（+I15×4） |
| M17 | `bootstrap.ts` | 有不可锚定条目即推进（`synced.counts.unanchored > 0 \|\| !sameProjections(…)`） | I7×2 |
| M18 | `queries.ts` | `state=idle` 的游标读作新鲜（只保留 `cursor === undefined` 分支） | I9×2 |
| M19 | `packages/storage/sqlite/src/storage-sync.ts` | `recordObservation` 删掉「更旧版本返回 false」那一行 | I8 的 SQLite 一条 |
| M20 | `bootstrap.ts` | 把推进修订号与第二次 `replacePlanningProjections` 挪到内容事务提交之后，改用根句柄 `context.storage` 写 | I11 的 `advanceRevision` ×2 |
| M21 | `bootstrap.ts` | 把 `putReconcileCursor` 挪到内容事务之后，改用根句柄写 | I11 的 `putReconcileCursor` ×2、I12×2（共 4；第 2 轮后为 2） |
| M22 | `bootstrap.ts` | 把 healthy 的 `putSyncCursor` 挪到内容事务之后，改用根句柄写 | I11 的 `putSyncCursor` ×2 |
| M23 | `bootstrap.ts` | `SYNC_ROUND_FAILED` 改为空串 | I2×2、I10×2、I11×6、I12×2（共 12；第 2 轮后为 10）；评审修复轮后为 17（+I17×2、I18×2、I19） |
| M24 | `bootstrap.ts` | 把 `recordObservations` 挪到内容事务之前，改用根句柄写 | I12×2 |
| M25 | `bootstrap.ts` | 把 `upsertItems`（实体、外部身份、成员关系）挪到内容事务之前，改用根句柄写 | I12×2 |
| M26 | `bootstrap.ts` | 快照为空时不推进（`synced.projections.length > 0 && !sameProjections(…)`） | I13×2 |
| M27 | `bootstrap.ts` | provider 结构化失败的一轮也写对账时刻（`fail` 之前先 `putReconcileCursor`） | I14×2；评审修复轮后为 4（+I17×2） |
| M28 | `bootstrap.ts` | `sameProjections` 去掉 `.sort(…)`（评审的 X15） | I15 的「行序」×2 |
| M29 | `bootstrap.ts` | `isDeepStrictEqual(content(left), content(right))` 换成 `JSON.stringify` 相等（评审的 X16） | I15 的「键序」×2 |
| M30 | `bootstrap.ts` | 去掉 `reportSyncRoundFailure(context, error)` 这一句 | I4、I16×2、I17×2、I19（共 6）；第二轮评审后为 8（+I20×2） |
| M31 | `diagnostics.ts`（第二轮评审前在 `bootstrap.ts`） | `reportSyncRoundFailure` 的 `catch` 改成重新抛出（钩子抛错不吞） | I18×2 |
| M32 | `diagnostics.ts`（此前在 `bootstrap.ts`） | 交给宿主的不是原异常（`syncRoundFailed?.(String(error))`） | I4、I16×2、I17×2、I19（共 6）；第二轮评审后为 10（+I21×2、I22×2） |
| M33 | `bootstrap.ts` | provider 的结构化失败也调用钩子（`if (!round.ok) reportSyncRoundFailure(context, round.error)`） | I17×2；第二轮评审后为 6（+I21×2、I22×2）；第三轮评审后为 8（+I20b×2） |
| M34 | `diagnostics.ts`（此前在 `bootstrap.ts`） | 去掉对返回值的接住（第二轮评审后是 `new Promise(…).catch(…)` 那一行；此前是 `if (pending instanceof Promise) pending.catch(…)` 整行） | I18×2 |
| M35 | `context.ts` | `createContext` 不把 `deps.diagnostics` 放进 `CoreContext`（`diagnostics: undefined`） | I4、I16×2、I17×2、I19（共 6）；第二轮评审后为 12（+I20×2、I21×2、I22×2）；第三轮评审后为 14（+I20b×2） |
| M36 | `bootstrap.ts` | 钩子挪到 `fail` 之后调用（`const failed = await fail(…); reportSyncRoundFailure(…); return failed`） | I4 |
| M37 | `diagnostics.ts`、`bootstrap.ts`、`context.ts` | 出口改成 `async` 并 `await` 钩子返回值，两个调用点也 `await`（评审的 H8） | I20×2；第三轮评审后为 4（+I20b×2） |
| M38 | `bootstrap.ts` | 结果加 `cause: error`（评审的 H11） | I2×2、I10×2、I11×6、I12×2、I17×2、I18×2、I19（共 17；`assertRoundFailed` 带 `forbidden` 的全部调用方） |
| M39 | `bootstrap.ts` | 结果加 `detail`：对象则展开成副本，否则原值（评审的 H11c） | I10×2、I17×2（字符串与普通对象两种触发；Error 对象展开成空对象，查不出，共 4） |
| M40 | `bootstrap.ts` | 结构化错误对象 `error` 上挂 `cause: error` | 同 M38（共 17） |
| M41 | `diagnostics.ts` | 只认 `instanceof Promise`（评审的跨 realm，第二轮评审前的实现） | I18×2 |
| M42 | `diagnostics.ts` | 手写 `typeof pending.then === 'function'` 探测并放在 `try` 之外 | I18×2（去掉 I18 的 getter 钩子后存活，所以该钩子承重） |
| M43 | `context.ts` | `composeCore` 的 `catch` 不把拒绝交给钩子（回到 `catch {}`） | I4、I21×2、I22×2（共 5）；第三轮评审后为 7（+I20b×2） |
| M44 | `context.ts` | 组合期交给宿主的不是原拒绝（`String(error)`） | 同 M43（5） |
| M45 | `bootstrap.ts` | 显式命令与组合期里 `fail` 的拒绝都在 `bootstrapWorkspace` 内先交给钩子再重抛 | I21×2、I22×2（共 4：组合期被交两次、显式命令的拒绝被另交一次）；第三轮评审后为 6（+I20b×2：组合期钩子被调用两次，计数断言变红） |
| M46 | `diagnostics.ts`、`bootstrap.ts`、`context.ts` | 出口改成 `async` 并 `await` 吸收用的 promise，`bootstrap.ts` 的调用点用 `void` 不等待，只有 `composeCore` 水合 `catch` 的调用点 `await`（评审的 H8c） | I20b×2（只有它们；M37 是两个调用点都 `await` 的对照组，I20×2 与 I20b×2 都红） |

有意不钉的形态：N29（`fail` 读当前修订号失败时吞掉并返回哨兵）在 76 条用例上存活；它把三重故障从「拒绝」改成「结构化失败」，是 D3 的 K2 边界取舍，不是判别力缺口（`Decision Log`）。第 1–3 轮对抗验证证明为等价变异的（去掉排序、`JSON.stringify` 比较、`before` 晚读、第二次重盖漏 `await` 等）不计入本表。**Superseded in part by M28、M29（评审修复轮，2026-10-08）**：去掉排序与 `JSON.stringify` 比较不是等价变异——端口对读回的行序与键序都没有承诺，这两条在端口允许的行为下会让相同引导推进修订号，已有 I15 钉住（S30）；`before` 晚读、第二次重盖漏 `await` 仍是等价变异。

### D12 宿主诊断出口（评审修复轮，TD-030）

**要解决的问题**：整轮 `catch` 把所有异常变成同一句固定文案与 `unavailable`；不进 wire 是对的（K2），但宿主侧也拿不到原异常，需要人工处理的永久拒绝（如 TD-020 的 SQLite 旧载体，原文里有 `repairLegacySourceVersions` 的修复指令）无处可查，MMP 首次接真实 GitHub 时 provider 或 core 的任何编程错误都只显示成「同步异常中止」。

**方案**（人类伙伴裁决「Add a host diagnostics hook in #290」）：`composeCore` 的 `CoreDeps` 加可选的 `diagnostics?: CoreDiagnostics`，`CoreDiagnostics` 目前只有 `syncRoundFailed?: (error: unknown) => void`；`createContext` 把它放进 `CoreContext`；`bootstrapWorkspace` 的整轮 `catch (error)` 先调用内部的 `reportSyncRoundFailure(context, error)`，再 `fail(…)`。

- **缺省 no-op**：不传、传空对象、只传别的钩子都是同一行为。
- **只交给宿主，绝不进 wire**：返回值与命令结果仍是固定文案的 `unavailable`；钩子收到的是抛出的那个值本身（同一个对象，非 Error 值也原样），I16、I17 钉住「原样」，同时断言命令结果与读侧序列化不含原文。
- **只在异常中止时调用**：成功提交与 provider 的结构化失败（离线、权限）不是异常，不调用（I17、M33）；门禁失败、没有规划绑定同理，它们不经过这条 `catch`。
- **钩子自己失败被吞掉**：同步抛错（含非 Error 值）与返回被拒绝的 promise 都不改变结构化失败的结果。后者是类型 `=> void` 接受 `async` 函数带来的陷阱——被拒绝的 promise 会成为进程级未处理拒绝（I18、M31、M34）。**第二轮评审更正（P3）**：原实现只认 `instanceof Promise`，另一个 realm 的被拒绝 promise 认不出来，拒绝没人接就是进程级未处理拒绝（I18 的 `node:vm` 钩子、M41，S34）；改为用 Promise 构造器吸收任何返回值（读取 `then`、调用 `then` 的同步抛出也变成它自己的拒绝，M42），并且**不等待钩子**（慢的或永不 resolve 的钩子不能拖住同步，I20、M37）。调用点移到内部模块 `diagnostics.ts`，不经包入口导出。
- **先于 `fail`**：`fail` 在双重故障时会以 Storage 的错误拒绝；若钩子在它之后调用，记录失败时 Storage 再出错就会丢掉原因（I4 追加的断言、M36）。组合期的首轮引导也走同一条 `catch`，所以冷启动被拒的原因同样交给宿主（I16）。**第二轮评审更正（P3，Superseded in part）**：这句只覆盖 `syncRound` 抛出的异常。组合期若遇到 provider 的结构化失败（或门禁失败），而 `fail` 写降级游标时 Storage 又拒绝（或写进后读不出当前修订号），`fail` 的拒绝原来被 `composeCore` 的 `catch {}` 静默吞掉，钩子调用 0 次（S36）。现在 `composeCore` 的 `catch (error)` 在吞掉之前把它交给同一个钩子（同一调用约定，I21、I22、M43–M45）：命令结果与 wire 不变，显式命令里的同一拒绝仍直接到调用方（TD-031 不变），所以没有收窄 D12，也不违反 D3——D3 的「双重故障时拒绝」讲的是命令的返回值，这里只是多交一份给宿主。同一轮最多交两次：轮次的原异常，以及记录失败本身的拒绝（组合期）。
- **脱敏义务在宿主**（第二轮评审 P3）：交给宿主的原异常可能含凭据片段、本机磁盘路径、SQL 与提供方原文（本 PR 自己的 `THROWS` 夹具就把原异常建模成 `request failed, token <SECRET>`，旧载体原文里有库文件路径）；`AGENTS.md` §7 把自托管日志列为发布面。所以 `CoreDiagnostics` 的注释写明：宿主写日志或遥测前负责脱敏，不得转发到 wire 或 UI。宿主接线（把 `syncRoundFailed` 接到宿主诊断日志、承担脱敏、补一条经宿主入口的用例）由 #132 承接（`Decision Log` 2026-10-08「诊断出口接线的承接 issue」，TD-030）。

**放弃的方案**：把原异常放进 `BootstrapResult` 的非 wire 字段（命令结果会被 controller 序列化给 client，难以保证「不进 wire」，且改公共返回形状）；在 `catch` 里直接 `console.error`（core 不拥有日志出口，宿主无法接管、测试无法断言）；新增类型化的 Storage 拒绝并透传（TD-030 的另一半，要改端口与两个适配器，本 PR 不做）。

**仍是 TD-030 的部分**：命令结果与读侧对永久拒绝和暂时故障仍是同码同文案，#134 的调度对永久拒绝仍会反复重试；诊断出口只让宿主「能查到」，不让系统「能区分」。

## Global Constraints

- 保持 `AGENTS.md` §1.1 七条不变量与依赖方向；不新增包间依赖；`packages/client` 不引入 React。
- 不改 Storage 端口签名、两个适配器的行为、SQLite 迁移、wire 形状、client 行为；`packages/core/src/context.ts`（**Superseded by `Decision Log` 2026-10-08 18:40 CST**：评审修复轮只在其中新增可选的 `CoreDiagnostics` / `CoreDeps.diagnostics`，其余不动）、`status-policy.ts`、`registry.ts`（#219 的分支在改）、`chain-facts.ts` / `delivery.ts` / `relations.ts`（#221 / #222 的分支在改）不动。
- MMP 之前不写兼容层；不为压规模删判别性断言。
- 原异常文字（驱动文字、SQL、provider 给的版本值、堆栈）不得进入 `BootstrapResult.error.message` 与 wire。
- 规模：代码桶 ≤ 800（实现 ≤ 350），文档桶 ≤ 1300（规划上限，`node scripts/rule-checks.mjs size origin/main`）；CI 硬门 1000 / 1500。
- 不提交本机绝对路径；不改 git config（作者用仓库现有身份，提交前 `git log -1 --format='%an <%ae>'` 核对）；不直接推 `main`、不合并 PR。
- 人类专属：ADR-0012 的采纳、Project `Status` 与 `blocked-by` / `blocking`、改写 issue 正文（含 #134 收窄）。agent 只起草，外部写入前用一句可批准的陈述直接问人类。
- 技术债务编号只用 TD-030–TD-034；`docs/exec-plan/tech-debt-tracker.md` 手工追加，不用债务更新脚本（它会抹掉既有条目）。

文件集合（只在此处声明；其余章节提到时写「见 `Global Constraints`」）：

| 区域 | 文件 | 批次 |
|---|---|---|
| core | `packages/core/src/bootstrap.ts` | 1、2、5、6 |
| core | `packages/core/src/context.ts`（`CoreDiagnostics`、`CoreDeps.diagnostics`、`CoreContext.diagnostics`，各一处；批次 6 另改 `composeCore` 的水合 `catch` 与 `CoreDiagnostics` 的注释） | 5、6 |
| core | `packages/core/src/diagnostics.ts`（新；`reportSyncRoundFailure`，内部模块，不经包入口导出） | 6 |
| core | `packages/core/src/queries.ts`（`syncSummary` 一行） | 2 |
| 端口注释 | `packages/capabilities/src/storage.ts`（`advanceRevision` 指向 ADR-0012；`recordObservation` 注释改写 #199 的落点） | 1、2 |
| client 注释 | `packages/client/src/workspace-read.ts`（`lastUpdatedAt` 注释） | 2 |
| 测试 | `tests/e2e/chain-bootstrap.test.js`、`tests/e2e/workspace-read-assembly.test.js`、`tests/integration/sync-revision-freshness.test.js`（新） | 1、2、5、6、7（5 起只有最后一个文件） |
| 规则与索引 | 本计划、`docs/adr/ADR-0012-business-revision-advances-only-on-content-change.md`（新；批次 5 改为 Accepted）、`docs/adr/README.md`、`docs/README.md` | 0、5、6、7 |
| 证据回填 | `docs/product/vertical-path.md`（简称表、第 3、13、13.4、13.8 行、X2、更新说明段；第 2 轮后补 13.4 的原子提交引用与双重故障缺口；最终验收补 13.4 的「整轮回滚」「结构化失败」引用与只读库读回，13.8 的结论改回词表内写法）、`docs/architecture/release-gates.md`（§2.1.1 第 7、8 行与汇总、观察更新一行）、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`（P2 观察、Progress 的 2E；第 2 轮后补：诊断表与 P2 之后的事实清单里「重复 bootstrap 推进 revision」「`bootstrap.ts:110` 无条件推进」两处 base 事实标 Superseded）、`docs/exec-plan/completed/2026-10-07-iteration-5-6-planning.md`（D6 表 #220 + #199 行的依赖格）、`docs/exec-plan/tech-debt-tracker.md`（TD-020 转 Resolved，新增 TD-030–TD-034；最终验收补 TD-031 的三重故障与只读库读回；批次 5 更新 TD-030、TD-032 并把五条的 ExecPlan 列改为 completed 路径）；批次 5 归档时本计划移到 `docs/exec-plan/completed/`，指向旧路径的引用同步改正（`release-gates.md`、控制计划、迭代规划、`vertical-path.md`、ADR-0012 的来源行）；评审记录 `docs/review/pr-290-mmp-review.md`（新，`docs/review/README.md` 没有记录索引，不加行；批次 6 更正合并顺序一条并追加第二轮修复一节，批次 7 追加第三轮修复一节）；批次 6 另改 `tech-debt-tracker.md` 的 TD-030（宿主接线归 #132）与 TD-031 | 3、5、6 |

## Plan of Work

每批遵循：先写红用例并确认失败集合与本节一致 → 改实现 → 全绿 → 跑该批变异 → 本地提交。提交格式 `<type>(<scope>): <中文摘要>`，正文写原因，尾注只写 `Refs #220` / `Refs #199`（提交正文不写关闭关键字），末行加实现者自己的 `Co-Authored-By`。

### Batch 0 · 设计定稿（已完成）

**最小闭环**：三份设计经裁决收敛为本计划与 ADR-0012（起草时 Proposed；**Superseded by `Decision Log` 2026-10-08 18:40 CST**：已采纳为 Accepted），索引可达。
**涉及文件**：本计划、ADR-0012、`docs/adr/README.md`、`docs/README.md`。
**验证**：`python3 <exec-plan 技能目录>/scripts/lint_execplan.py docs/exec-plan/completed/2026-10-08-sync-revision-freshness.md`（期望 `OK: ExecPlan passed lint checks.`）；`grep -c '^## ' docs/exec-plan/completed/2026-10-08-sync-revision-freshness.md`（期望 15）。
**提交与 draft PR（协调者执行，先于 Batch 1）**：把本批四个文件提交为 `docs(exec-plan): 规划同步修订号与结构化同步失败`（尾注 `Refs #220`、`Refs #199`）；`git push -u origin fix/sync-revision-freshness`；`gh pr create -R SingularityKChen/harness-projects --draft --base main`，正文按 `.github/pull_request_template.md`，用关闭关键字关联 #199 与 #220、`Refs #216`；回读 `closingIssuesReferences` 恰为 #199、#220；按 Batch 4 第 4 步引用的人类批准把两个 issue 的 Project `Status` 置 In Progress，补 PR 的标签与里程碑。
**回滚**：删除新增的两份文件，revert 两处索引行；draft PR 关闭、`Status` 写回 `Todo`。

### Batch 1 · #220 业务修订号只随内容变化推进

**最小闭环**：相同输入不推进、变化恰好推进一次（含移除）、刷新只记对账时刻，替身与 SQLite 一致。
**涉及文件**：`packages/core/src/bootstrap.ts`、`tests/e2e/chain-bootstrap.test.js`、`tests/e2e/workspace-read-assembly.test.js`、`tests/integration/sync-revision-freshness.test.js`（新）。

0. 确认 Batch 0 的规划提交已在 HEAD（协调者已提交并开 draft PR），之后的变异导出依赖 `git archive HEAD`。
1. 红用例（全部追加在 `tests/e2e/chain-bootstrap.test.js` 文件末尾；新增 import `sourceVersionFromTimestamp` 自 `@harness-projects/capabilities`、`createFakePlanningProvider` 已在既有 import 里）。先在文件末尾定义两个辅助：`revisionOf(providers)` 返回 `providers.storage.currentRevision(WORKSPACE.id)`；`rowRevisions(providers)` 返回 `listPlanningProjections(WORKSPACE.id)` 的 `` `${entityId}@${revision}` `` 排序数组。
   - T1：`threeItemComposition()` + `compose`；记下修订号、`rowRevisions`、`exportFakeStorageState(...).memberships.length`；循环两次 `core.commands.bootstrapWorkspace()`，每次断言 `[result.ok, result.revision]` 等于 `[true, 起始修订号]`；最后断言工作区修订号、`rowRevisions`、成员关系数都不变（成员关系数对应 #134 验收 4）。
   - T2：记下 `[signatures(listPlanningItems), 账本行数, 修订号]`；`providers.planning.setFault(FaultKind.DuplicateEvent, true)`；引导三次且每次 `ok`；三元组不变。
   - T3：取第一个 `objectKind === 'issue'` 的条目 `ref`；组合后 `emitObservation({ ref, type: 'issue.updated', stableFields: { v: 2 }, sourceVersion: sourceVersionFromTimestamp('2026-10-04T00:00:02Z') })` 并引导一次；记下 `[listPlanningItems(), 账本行数, 修订号]`；再发 `stableFields: { v: 1 }`、`'2026-10-04T00:00:01Z'` 的观察并引导；三元组深等。
   - T4：记起始修订号 `s`；把第一个 issue 条目的 `record.content` 换成同形对象、`workItem.title` 改为 `'改过的标题'`；引导结果 `revision === s + 1`；`rowRevisions` 每项以 `@${s + 1}` 结尾；再引导仍为 `s + 1`；`removeItem(providers.planning.state, record.ref)` 后引导为 `s + 2`；再引导仍为 `s + 2`；工作区修订号为 `s + 2`。
   - T5：`composeCore({ workspace: WORKSPACE, providers, clock })`，`clock` 依次返回 `'2026-10-08T00:00:01.000Z'`、`'2026-10-08T00:00:02.000Z'`；组合后 `getReconcileCursor(WORKSPACE.id)` 深等 `{ workspaceId, lastReconciledAt: …01 }`；引导一次，结果修订号不变，对账游标变为 `…02`，工作区修订号不变。
   - T6：按控制计划 P5 的做法：组合一次；把规划挂载写成 `{ ...old, enabled: false, isDefault: false }`；用 `{ ...providers, planning: createFakePlanningProvider() }` 与同一个 `providers.storage` 再组合；记修订号；`second.commands.bootstrapWorkspace()` 的结果修订号与工作区修订号都不变。
   - 新建 `tests/integration/sync-revision-freshness.test.js`：文件头注释说明它覆盖 #199 / #220 的一轮三种结局；import `node:assert/strict`、`node:test` 的 `test`、`@harness-projects/domain` 的 `newWorkspaceId`、`@harness-projects/core` 的 `PLANNING_SYNC_SCOPE, composeCore`、`@harness-projects/provider-fake` 的 `createFakeProviders, createFakeStorage`、`@harness-projects/storage-sqlite` 的 `createSqliteStorage`；`STORAGES = [['内存替身', () => createFakeStorage()], ['SQLite', () => createSqliteStorage(':memory:')]]`；`setup(storage)` 见 `Concrete Steps` C3；对每个 Storage 注册 I1：`world.open()` 一次记修订号，再 `world.open()`（同一份 Storage 上重新组合，模拟重启）后修订号不变，`restarted.commands.bootstrapWorkspace()` 结果修订号不变。
   - `tests/e2e/workspace-read-assembly.test.js`：W1、W2 里把 `await cursor({ id, providers }, 'healthy', undefined)` 换成 `await core.commands.bootstrapWorkspace()`，从两处解构里去掉 `id`；删除 `cursor` 辅助函数（:32–35）与 import 里的 `PLANNING_SYNC_SCOPE`。W2 在最后一条断言之后追加：`await core.commands.bootstrapWorkspace()`，然后断言 `[(await sync.poll()).kind, sync.revision, sync.read().lastUpdatedAt]` 深等 `['idle', rows[0].revision, T(2)]`，消息写「内容不变的成功刷新不产生帧，也不推进 lastUpdatedAt（#220 决定）」。
2. 跑红：`node --test --test-reporter=spec tests/e2e/chain-bootstrap.test.js tests/e2e/workspace-read-assembly.test.js tests/integration/sync-revision-freshness.test.js`。期望失败集合恰为 T1–T6、W1、W2、I1×2（10 条），其余全绿。多红或少红都先停下查原因，写进 `Surprises & Discoveries`。
3. 实现：按 D7 改 `commitSync`、`upsertItems`、`toProjection`、新增 `sameProjections` 与 `UnstampedProjection`、删除逐行 `putPlanningProjection`、写 `putReconcileCursor`；改 `bootstrap.ts` 文件头注释（去掉「修订号 +1」，写「快照内容变化才推进修订号，规则见 ADR-0012」）；`BootstrapResult.revision` 加字段注释；`packages/capabilities/src/storage.ts` 的 `advanceRevision` 上方注释追加一句「何时推进由写者按 ADR-0012 决定：快照内容变化才推进，一个事务至多一次」。
4. 跑绿：同第 2 步的命令，期望 0 fail；再跑 `node --test tests/integration/storage-sync-surface.test.js tests/integration/workspace-sync-scope.test.js tests/e2e/client-sync.test.js tests/e2e/controller-roundtrip.test.js`，期望 0 fail；`./node_modules/.bin/tsc --noEmit` 无输出。
5. 变异：M1、M2、M3、M6、M9、M10（`Concrete Steps` C4），每条的红集合与 D11 变异表一致（本批时 I2 尚未存在，只比对已存在的用例）。
6. 提交：`fix(core): 业务修订号只随已提交内容变化推进`，尾注 `Refs #220`。

**回滚**：revert 本批提交（若 Batch 2 已提交，先 revert Batch 2）；无数据迁移，已有库的修订号与行修订号保持写入时的值。

### Batch 2 · #199 一轮同步的任何异常都变成结构化失败

**最小闭环**：Storage 拒绝观察时命令返回结构化失败、游标 degraded 带码、读侧陈旧、client 时间不前进；双重故障响亮失败且冷启动读作陈旧。
**涉及文件**：`packages/core/src/bootstrap.ts`、`packages/core/src/queries.ts`、`tests/integration/sync-revision-freshness.test.js`。

1. 红用例（追加到 `tests/integration/sync-revision-freshness.test.js`；新增 import：`createController` 自 `@harness-projects/controller`，`createEntityStore, createSync, createTransport` 自 `@harness-projects/client`）。辅助 `poison` / `heal` / `clockOf` / `T` 见 `Concrete Steps` C3。
   - I2（每个 Storage 一条）：组合；记修订号与 `listPlanningItems()`；`poison(planning)`；`result = await core.commands.bootstrapWorkspace()`（必须 resolve）；断言 `[ok, degraded, error.code, revision]` 为 `[false, true, 'unavailable', 起始修订号]`；`assert.doesNotMatch(result.error.message, /vé|sourceVersion|RangeError/)`；游标 `[state, lastErrorCode]` 为 `['degraded', 'unavailable']`；`getPlanningSync()` 深等 `{ degraded: true, stale: true, reason: 'unavailable' }`；条目 id 集合不变且每行 `freshness.degraded`；修订号不变、对账时刻仍是 `T(1)`。然后 `heal(planning)` 并引导：`[ok, 修订号, 对账时刻]` 为 `[true, 起始修订号, T(2)]`，`getPlanningSync()` 深等 `{ degraded: false, stale: false, reason: undefined }`。
   - I3（只用内存替身）：冷启动——先 `poison` 再组合；`createSync(createTransport(createController(core, { workspaceRevision })), createEntityStore(), { clock: clockOf(T(5)) })` 后 `connect()`；`[行数, lastUpdatedAt, reason]` 为 `[0, undefined, 'unavailable']`。成功之后——新世界正常组合并 `connect()`（时钟 `T(5), T(6), T(7)`），再 `poison`、引导、`reconnect()`；`[lastUpdatedAt, reason]` 为 `[T(5), 'unavailable']`。
   - I4：用 C3 的 Proxy 包内存替身（第一个 `transaction` 放行给 `createContext`，之后的 `transaction` 与所有 `putSyncCursor` 都以 `new Error('disk full')` 拒绝）；组合（组合期引导的拒绝被 `composeCore` 吞掉）；断言游标为 undefined；`getPlanningSync()` 深等 `{ degraded: true, stale: true, reason: 'idle' }`；`await assert.rejects(core.commands.bootstrapWorkspace(), /disk full/)`。
2. 跑红：`node --test --test-reporter=spec tests/integration/sync-revision-freshness.test.js`，期望恰为 I2×2、I3、I4 四条失败（I1 仍绿）。
3. 实现：按 D7 新增 `syncRound` 与 `SYNC_ROUND_FAILED`、在 `bootstrapWorkspace` 包 try/catch；`queries.ts` 的 `if (cursor === undefined)` 改为返回 `{ degraded: true, stale: true, reason: SyncState.Idle }`，上方注释补一句「从未写进过任何结果即陈旧」；`packages/capabilities/src/storage.ts` :218–219 改写为「拒绝仍是裸异常（端口不新增类型）；core 的一轮同步整笔回滚，并把它转成结构化失败：游标 degraded + `unavailable`（#199）」；`packages/client/src/workspace-read.ts` 的 `lastUpdatedAt` 注释把「（宿主误报 fresh 时也推进，#199）」改为「（宿主误报 fresh 时也推进；#199 之后只剩双重故障会误报，见 TD-031）」，并在「即使数据未变」之后补「内容不变的成功刷新不产生帧（#220、ADR-0012），所以不推进」。
4. 跑绿：`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e`、`node --test --test-timeout=120000 tests/mvp0`，期望 0 fail；`./node_modules/.bin/tsc --noEmit` 无输出；`node --test tests/contract/package-boundaries.test.js` 0 fail。
5. 变异：M4、M5、M7、M8。
6. 提交：`fix(core): 把一轮同步的任何异常转成结构化失败`，尾注 `Refs #199`。

**回滚**：revert 本批提交；读侧回到「游标缺失即 fresh」，Storage 拒绝回到裸抛。

### Batch 3 · 证据与债务回填

**最小闭环**：矩阵、R1 快照、控制计划、迭代规划与债务表只写本 PR 在本分支 head 上能复跑的事实。
**涉及文件**：见 `Global Constraints` 的「证据回填」行。写进表格单元格的读回值里的 `|` 一律转义为 `\|`。

1. `docs/product/vertical-path.md`：
   - 简称表的 integration 行加 `sync-revision-freshness`。
   - 第 3 行失败列：把「存储拒绝观察时 `bootstrapWorkspace` 抛出裸 `Error`……（#199，X2）」改为经入口的两条引用——sync-revision-freshness「存储拒绝：被拒绝的观察让同步结构化失败」（`commands.bootstrapWorkspace` + `queries`，替身与 SQLite）与「客户端时间：冷启动被拒或成功之后被拒」（controller + `sync.connect` / `sync.reconnect`），标「2026-10-08 起，#199」；结论改为「部分：写侧被拒绝而不排队重放没有用例」，并在格内保留原结论加「Superseded（#199 修复，见本行失败列）」；承接列去掉 #199。
   - 第 13 行：失败列删去「重复与乱序观察」，承接列去掉 #199；13.4 行的经入口用例补 sync-revision-freshness「存储拒绝：被拒绝的观察让同步结构化失败」，旁证与缺口列改写 X2 的新读回，结论改为「已交付（替身 + 真实 storage-sqlite，集成）」并保留原结论加 Superseded；13.8 行的经入口用例改为 chain-bootstrap「重复观察：同一观察经 core 投递」「乱序观察：经 core 先投递新观察」，结论改为「已交付（替身）」并保留原结论加 Superseded。
   - X2 片段：把 `planning.emitObservation({ … sourceVersion: 'vé' })` 一行换成 `planning.state.observations.push({ ...planning.state.observations[0], dedupeKey: 'poison-1', sourceVersion: 'vé' })`，`outcome` 改为 `r.ok + ' ' + r.error?.code`（不用反引号模板，S12），输出加 `cursor.lastErrorCode`（即 `Artifacts and Notes` A2 的片段）；观察行写「修复前（base）`bootstrap threw RangeError | cursor healthy undefined | any view degraded false`；本分支 `bootstrap false unavailable | cursor degraded unavailable | any view degraded true`」；原观察行保留并标「Superseded by 本片段的新触发（2026-10-08，#199）」。
   - 在「第 4、5 行的 #178 订正」段之后加一段「第 3、13、13.4、13.8 行与 X2 更新于 2026-10-08（#199、#220）」：说明在检出 `fix/sync-revision-freshness` 的工作树根目录按回读命令逐条回读了本次新增的引用（各读回 `ℹ tests 1`，sync-revision-freshness 的「存储拒绝」前缀为 2，伪造前缀读回 `ℹ tests 0`），X2 在同一检出上重放；其余各行仍是上文基线。
2. `docs/architecture/release-gates.md` §2.1.1：
   - 第 7 行：断言用例补 chain-bootstrap「修订号：相同输入的重复引导」「重复观察：同一观察经 core 投递」与 sync-revision-freshness「修订号：相同输入的重复引导与重启后」；层写「core 入口（内存替身与 SQLite）」；变异证据写 M1（恒推进）使三条变红、还原后复绿；缺口格写「P2 在本分支读回 `revision 1 -> 1 | entities 5 -> 5`」；结论「已断言（core 入口；内存替身与 SQLite）」，原「反例（#220）」保留并标 Superseded。
   - 第 8 行：断言用例补 chain-bootstrap「乱序观察：经 core 先投递新观察」；变异证据写 M10（替身接受更旧版本）与 M1 各使它变红；结论「已断言（core 入口：内存替身；端口：两适配器）」，原结论保留并标 Superseded。
   - 汇总行改为「已断言 2、部分 5、反例 3」，原句保留并标 Superseded；§2.1 末尾的「观察更新」后追加一行「观察更新（2026-10-08，#220 / #199）：第 7、8 行升为已断言，见 §2.1.1」。
3. 控制计划 `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`：P2 的观察行后追加「Superseded by #220 修复（2026-10-08，`fix/sync-revision-freshness`）：读回 `revision 1 -> 1 | entities 5 -> 5`」；Progress 的「Batch 2」条目下加一条子项「2E（#199 #220）在 `fix/sync-revision-freshness` 实现，计划 `docs/exec-plan/completed/2026-10-08-sync-revision-freshness.md`；合并状态以 PR 回读为准」。
4. 迭代规划 `docs/exec-plan/completed/2026-10-07-iteration-5-6-planning.md` D6 表「#220 + #199（一个 PR）」行的依赖格追加「Superseded by `docs/exec-plan/completed/2026-10-08-sync-revision-freshness.md` Decision Log（2026-10-08）：本 PR 与 #219 都不改 `context.ts`，先后约束解除」。
5. `docs/exec-plan/tech-debt-tracker.md`（手工编辑）：TD-020 行移到 `Resolved Items`，状态改 Resolved，下一步列末尾追加「已解决（2026-10-08，`fix/sync-revision-freshness`）：X2 改用可移植触发重写并在本分支 head 重放；TD-020 起点的 SQLite 旧载体触发在 `:memory:` 上复现同一修复后结果；证据见该分支计划的 `Artifacts and Notes`」。在 `Open Items` 表末追加下列五行（全文，日期列 `2026-10-08`，状态 Open，ExecPlan 列 `docs/exec-plan/completed/2026-10-08-sync-revision-freshness.md`，分支列 `fix/sync-revision-freshness`，记录者列「#199 / #220 实现者（依据定稿评审）」；以下按「子系统 \| 简述 \| 延期理由 \| 遗留影响 \| 下一步」给出其余五列）。TD-034 原定不使用，对抗验证第 1 轮改用它登记重叠轮次（`Decision Log`）。
   - **TD-030** \| Core 同步（`packages/core/src/bootstrap.ts`）与存储端口（`recordObservation`） \| 未提交的一轮同步只有一个错误码：Storage 拒绝观察（非规范载体、SQLite 账本里的旧载体）、provider 抛出与编程错误都报 `unavailable`（恢复动作 retry）与固定文案，原异常既不进 wire 也没有诊断出口 \| #199 只要求「游标 degraded 带错误码」；类型化拒绝要扩 `StorageInputError`（TD-023 的泛化）、改两个适配器与共享拒绝矩阵，约 +45 行实现，本 PR 没有按结构区分这些失败的调用方 \| 需要人工修库的永久拒绝（如 `LEGACY_COMMITTED_VERSION_MESSAGE` 所指的旧载体）与暂时故障在命令结果与读侧同形，#134 的调度会对永久拒绝反复重试；排障只能复现 \| #134 设计退避、或页面需要「请修库」类恢复提示时：把 `recordObservation` 的已知输入拒绝收进 `StorageInputError`（`operation` 扩成联合，`invalid_input` / 恢复 `none`），core 的同步 catch 透传 `error.failure`，与 TD-023 同批；同时给宿主一个不进 wire 的诊断出口
   - **TD-031** \| Core 同步（`bootstrap.ts` 的 `fail`）与读侧（`queries.ts` 的 `syncSummary`） \| 双重故障：一轮没有提交、连 degraded 游标也写不进时，`bootstrapWorkspace` 以游标写入的错误拒绝；若此前游标是 healthy，读侧仍报 fresh，client 重连拿到的基线仍被判为当前值。这次拒绝的文字是 Storage 驱动原文（磁盘路径、SQL），Core 与 controller 的命令层都不翻译拒绝：`createController(core).commands.bootstrapWorkspace` 原样拒绝，`applyPlanningStatus` 等其他命令在存储故障下同形，所以这是命令边界的既有缺口，不是引导独有 \| 进程内「失败未落账」覆盖层是第二个事实源，要先定义它与持久游标的先后与清除；冷启动已由「游标缺失读作陈旧」兜住（sync-revision-freshness「双重故障」用例）；现有适配器关库后读写都失败，不会静默报 fresh \| 只在「写失败、读成功」的存储故障（磁盘满、只读文件系统、长时间 busy）且此前同步成功过的工作区出现：命令调用方看到拒绝，读侧却显示新鲜；任何把 controller 的命令拒绝序列化给 client 的宿主（#132）会把驱动文字与磁盘路径带上 wire \| 出现第一个「只写失败」的真实故障面（SQLite `SQLITE_FULL` / `SQLITE_READONLY`）或宿主健康信号（#132）时：core 进程内记「最近一次失败未落账」，`syncSummary` 读到它报 degraded，下一次成功提交时清除；把「双重故障」用例扩成「先成功、再双重故障」；#132 的宿主边界把命令的非结构化拒绝映射成固定文案（不含驱动文字与路径），并补一条经 `createController` 的同形用例
   - **TD-032** \| Core 查询、controller wire 与 client（`packages/core/src/queries.ts`、`packages/controller/src/wire.ts`、`packages/client/src/sync.ts`） \| `reconcile_cursor.lastReconciledAt` 只有写者（规划同步成功提交时）没有读者：`getPlanningSync`、wire 头与 client 都不暴露；client 的 `lastUpdatedAt` 仍是「接受一帧宿主判定为当前值的帧的时刻」，内容不变的成功刷新不产生帧，所以它不前进（workspace-read-assembly「metadata：同 revision 降级」用例钉住）；换 Planning 源（#202）后、新源首次成功之前，对账时刻仍是旧源的 \| 暴露它要改 #178 的确认规则、wire 形状与约 6 处 `SyncSummary` 深比较，并与 #218 正在合并的两次游标读（TD-024）撞在同一处 \| 页面上的「最后更新时间」在手动刷新确认「内容没变」之后不移动，用户可能以为刷新没发生；偏差方向保守，不会把旧值说成新值 \| #229 决定抽屉的「最后更新时间」显示什么；若要宿主对账时刻：在 #218 的单次 summary 里加 `reconciledAt`，controller 只放进整表头 `source`，client 在「整表 fresh 且 `reconciledAt` 前进」时推进 `lastUpdatedAt`，补「内容不变的刷新推进 lastUpdatedAt、修订号不变」的用例，并处理 #202 换源后的旧时刻
   - **TD-033** \| Core 同步与 controller wire（`packages/core/src/bootstrap.ts`、`packages/controller/src/wire.ts`） \| 推进修订号的规划同步把本轮写入的每一行重盖成新修订号（ADR-0012 第 2 条），一个标题变化就让 watch 的 delta upsert 全部行、client 整表重渲染；保留它是因为 `wire.ts` 的 `revisionOf` 兜底在「只有移除」的事务后会落后于工作区修订号 \| 只重盖变化行要多写逐行比较，并先删掉兼容兜底；#220 只要求内容不变时不推进 \| 条目上千时一次小改动产生整表 delta；不影响正确性 \| #132 让宿主总传 `workspaceRevision`、#224 删去 `revisionOf` 之后：只给内容变化的行盖新修订号（行修订号 = 该行最后变化时的工作区修订号），补「一个标题变化只 upsert 一行」的用例，并修订 ADR-0012 第 2 条
   - **TD-034** \| Core 同步（`packages/core/src/bootstrap.ts`）与读侧（`packages/core/src/queries.ts` 的 `syncSummary`） \| 同一工作区两轮重叠的引导没有单飞：A 读到旧快照后挂起，B 完整引导（修订号 1 变 2、标题是较新的），放行 A 后它提交，较旧的全量快照覆盖较新快照并再推进一次修订号（2 变 3），内存替身与 SQLite 一致，base 上同样覆盖（既有缺陷）；游标 `state=syncing` 今天没有写者，读侧仍读作新鲜，语义未定义（`idle` 已按「没有成功证据即陈旧」修复） \| #220 / #199 的字面验收针对观察账本与单轮提交，事务串行只保证不撕裂，不保证新旧次序；单飞要么在 core 进程内按工作区排队（跨进程无效），要么在事务内比较快照读取时刻，都要先定 #134 调度器的并发模型 \| 只在两轮并发时出现：手动刷新与定时对账同时在途时，最后提交者赢而不是最新快照赢，客户端可能短暂显示较旧内容并多一次整表 delta；下一轮正常引导会把内容改回 \| #134 设计调度器时：同一工作区同一时刻至多一轮在飞（后来者排队或复用在途结果），或把快照读取时刻带进事务并拒绝较旧快照；补「A 的较旧快照后提交不覆盖 B」的用例；同时定义 `syncing` 的读侧语义。承接：#134 的验收，需人类批准写进 issue 正文，agent 只起草
6. 验证：对第 1、2 步新增的每个引用按 `docs/product/vertical-path.md` §2.1「用例回读」的子 shell 命令回读（正例与伪造前缀负对照各一次）；在本工作树根目录重放 P2 与新 X2；`node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js` 0 fail；`git diff --check origin/main...HEAD` 无输出。
7. 提交：`docs(product): 回填 #199 / #220 的证据与技术债务`，尾注 `Refs #199`、`Refs #220`。

**回滚**：revert 本批提交；文档回到 base 的结论（与代码 revert 同时进行时不会出现「代码回退、文档仍说已交付」）。

### Batch 4 · 对抗验证、整合与 draft PR

**最小闭环**：独立验证者在最终树上复跑全部证据并整表重测变异；提交整合为交付物级；推送后回读 PR 与 checks。

1. 对抗验证（另一个 Sonnet 子 agent，只读本工作树、在自己的导出目录做变异）：逐条复跑 `Validation and Acceptance`；在最终树上整表重测 M1–M10（不复用实现者的变异结论）；按 #199、#220 原文条件与 K1/K2 复核；检查 `SYNC_ROUND_FAILED` 与提交信息不含原异常文字；输出 P0–P3 列表。P0/P1 必须在本 PR 修完并重新整表重测；P2/P3 修或登记。第 1 轮已完成：9 条发现（P2×3、P3×6，无 P0/P1），实现者的处理见 Progress 与 A8；第 2 轮（复评上一轮的修复本身）已完成：5 条发现（P2×1、P3×4，无 P0/P1），处理见 Progress、S20–S24 与 A9；第 3 轮（复评第 2 轮之后的最终树）已完成：7 条发现（P2×1、P3×6，无 P0/P1），由最终验收者（Opus）复现并处理，见 Progress、S25–S29 与 A10。
2. 整合提交：保留四个交付物级提交（Batch 0 规划、Batch 1 代码、Batch 2 代码、Batch 3 回填）；移除 fixup。已知的整合项：`docs(exec-plan): 记录 #290 的看板写入与 K2 解释的确认` 并入 Batch 0 的规划提交（它改的是本计划，不是独立交付物）；对抗验证各轮新增的修订提交按文件归属并入：测试与 idle 游标修复（第 1 轮 `fix(core): 补齐变化判定与整轮失败的判别用例，idle 游标读作陈旧`、第 2 轮 `test(core): 钉住一轮提交的事务原子性与固定失败文案`）并入 Batch 2 的代码提交；计划与 ADR（第 1、2 轮的 `docs(exec-plan)` 修订提交）并入 Batch 0 的规划提交；矩阵、R1、控制计划与债务表（第 1 轮 `docs(product): 回填对抗验证第 1 轮的证据与技术债务`、第 2 轮 `docs(product): 补 13.4 的双重故障缺口并标注控制计划的过期事实`）并入 Batch 3 的回填提交。最终验收的三个提交同样按文件归属：`test(core): 钉住整轮回滚的全部写入、清空快照与结构化失败的对账时刻`（测试与 `bootstrap.ts` 的注释）并入 Batch 2 的代码提交，`docs(exec-plan): 记录对抗验证第 3 轮与最终验收`（本计划与 `docs/README.md` 索引行）并入 Batch 0 的规划提交，`docs(product): 补整轮回滚与结构化失败的引用，13.8 结论词回到词表`（矩阵与债务表）并入 Batch 3 的回填提交。整合时顺带改正已写进提交正文的计数：`fix(core): 补齐变化判定…` 的正文写「7 个存活变异」，实际是 6 个（N1、N3、N3b、N4、N5、N13；N6 只被 T4 杀死，不算存活，S13）；整合前后 `git diff --name-only origin/main...HEAD | sort` 与 `Global Constraints` 文件集合逐一相等（`comm` 比对），产品与测试树 `git diff <整合前 head> HEAD -- packages tests` 无输出。
3. 发布面：`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`（期望代码 ≤ 800、文档 ≤ 1300）、`node scripts/workflow-check.mjs`、人工五类目检查（`docs/development/publication.md`）。
4. 推送与 PR 正文（draft PR 已在 Batch 0 开出）：整合后先建 backup ref，再 `git push --force-with-lease=fix/sync-revision-freshness:<远端旧 head> origin fix/sync-revision-freshness`；用 `gh pr edit` 更新正文的验证证据。PR 标题 `fix(core): 修订号只随内容变化推进，同步异常转成结构化失败`，正文按 `.github/pull_request_template.md`，「关联」段用 GitHub 关闭关键字关联 #199 与 #220、`Refs #216`、ExecPlan 路径与 Batch；「风险与回滚」写 D3 的双重故障与 TD-030–TD-033。开 draft PR 时把 #199、#220 的 Project `Status` 置 In Progress：依据是 `docs/exec-plan/completed/2026-10-07-iteration-5-6-planning.md` Decision Log「H3」行记录的人类批准（点名 D6、D7 所列条目在开 draft PR 时由 agent 置 In Progress）；写入前回读该行原文，写入后在本计划 Decision Log 记一行引用；人类另有指示时以人类为准。
5. 回读：`gh pr view <n> -R SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,isDraft`（期望 head 等于本地 HEAD、base `main`、关闭引用恰为 #199 与 #220）；`gh pr checks <n> -R SingularityKChen/harness-projects`（期望全部 pass）。是否 ready 与合并由人类决定。

### Batch 5 · 评审修复轮与归档（2026-10-08）

**最小闭环**：PR #290 的 MMP 评审（Singularity-AI-Bot，review 5455297113，APPROVED，2 × P2、3 × P3）与人类伙伴的四项裁决落地；分支变基到最新 `main`；评审通过且只剩 P2 / P3，按仓库惯例随本 PR 把计划与 ADR 归档。
**涉及文件**：见 `Global Constraints` 中批次列含 5 的行。

1. 变基：`git fetch origin`；`git branch backup/sync-revision-freshness-pre-review-rebase <变基前 HEAD>`；`git rebase origin/main`；`git range-diff backup/sync-revision-freshness-pre-review-rebase~3..backup/sync-revision-freshness-pre-review-rebase origin/main..HEAD`（期望三个提交逐一为 `=`）。任何修复之前先在变基后的树上跑 `./node_modules/.bin/tsc --noEmit` 与 `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e`（期望 0 fail）。
2. P2 诊断出口，先写红用例（`tests/integration/sync-revision-freshness.test.js`，`setup` 增加 `diagnostics` 选项，新增探针 `hostDiagnostics()`）：I16（毒化观察，冷启动与显式命令各一轮，钩子收到 `RangeError`，命令结果与 `getPlanningSync()` 的序列化不含原文）、I17（复用 I10 的四种触发，`strictEqual` 同一个对象；成功提交与 provider 离线的一轮不调用钩子）、I18（钩子同步抛 `Error`、抛字符串、返回被拒绝的 promise，文案与没有钩子时逐字相同，监听 `unhandledRejection`）、I19（SQLite 旧载体，宿主收到的原文含 `repairLegacySource`，命令结果不含）。跑红：期望 I16×2、I17×2、I19 共 5 条失败（原因是钩子不被调用），I18 在未实现时空转为绿，由 M31、M34 证明判别力。
3. 实现（`context.ts` 三处、`bootstrap.ts` 的 `catch (error)` 与 `reportSyncRoundFailure`，D12）；I4 追加「原异常先于 `fail` 交给宿主」的断言。跑绿：该文件 55 / 55。
4. P3 排序与深比较守卫：I15 的 `scrambling(storage, mode)` 代理（D10 的两行）。
5. 变异：M28–M36 在 `git archive HEAD` 的导出目录里逐条应用（`Concrete Steps` C4 的规程，每条先断言锚点恰好命中一处、`cmp` 与 `git diff --no-index -U0` 证明生效），再把 M1–M27 在最终树上整表复测。
6. P3 文档：ADR-0012 第 6 条的 Why 删掉仓库外的「协调者契约」措辞、状态改为 Accepted（照 ADR-0010 的状态行格式写批准时刻与所选原话），`docs/adr/README.md` 同步；`docs/README.md` 索引行与本计划的过时状态、数字改为回读命令加观察时刻与 head（A11）。
7. 归档：用 `git mv` 把本计划从 `docs/exec-plan/active/` 移到 `docs/exec-plan/completed/`（文件名不变）；`git grep -n 'exec-plan/activ[e]/2026-10-08-sync-revision-freshness'` 无命中（方括号写法让这条命令的文字不匹配自己）；`docs/README.md` 的行从 Active 表移到 Completed 表；`tech-debt-tracker.md` 的 TD-030–TD-034 的 ExecPlan 列改为 completed 路径，TD-030 记「诊断出口已有；同码问题仍在，下一步不变」，TD-032 的下一步指向 #229 的验收。
8. 评审记录：把评审草稿收为 `docs/review/pr-290-mmp-review.md`，末尾追加「修复轮」一节（发现、处置、证据）；`docs/review/README.md` 没有记录索引，不加行。
9. 验证与回读（协调者在推送后执行后两条）：`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e`、`node --test tests/mvp0`、`node --test tests/contract/package-boundaries.test.js`、`node scripts/rule-checks.mjs size origin/main`（期望代码 ≤ 800、文档 ≤ 1300）、`node scripts/rule-checks.mjs disclosure origin/main`、`git diff --check origin/main...HEAD`、`python3 <exec-plan 技能目录>/scripts/lint_execplan.py docs/exec-plan/completed/2026-10-08-sync-revision-freshness.md`（期望 `OK: ExecPlan passed lint checks.`）、`node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js`；推送后 `gh pr view 290 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,mergeStateStatus`（期望 head 等于本地 HEAD、base `main`、关闭引用恰为 #199 与 #220）与 `gh pr checks 290 -R SingularityKChen/harness-projects`（期望全部 pass），再逐条回复并 resolve 评审线程。
10. 提交：代码交付物 `feat(core): 给宿主一个不进 wire 的同步失败诊断出口，并钉住变化判定的排序守卫`（尾注 `Refs #220`、`Refs #199`），回填归档 `docs(exec-plan): 归档同步修订号计划，回填评审修复轮、采纳 ADR-0012 并登记评审记录`。**Superseded by 最终实际形态（第二轮评审 P3）**：整合结果是三个提交——规划 `docs(exec-plan): 规划同步修订号与结构化同步失败`、代码 `fix(core): 修订号只随快照内容变化推进，同步异常转成结构化失败`、归档 `docs(exec-plan): 归档同步修订号计划，回填证据、评审修复与人类裁决`（第二轮评审时 PR head `375d8a75` 上依次是 `747d975b`、`c155db05`、`375d8a75`；整合后 SHA 以 PR 回读为准），上面的两个提交名与「整合为两个提交」不再成立。代码提交 `c155db05` 单独检出（`git archive` 导出目录）：`tsc --noEmit` exit 0，`tests/contract tests/integration tests/e2e` 1375 / 1376，唯一失败是 S9 的环境性用例（导出目录不是带历史的仓库，同一用例在工作树里通过）。第二轮评审的修复由协调者按文件归属并入代码与归档提交。

**回滚**：revert 两个提交（**Superseded**：实际是三个提交，应 revert 的是代码与归档两个，或整个 PR；规划提交只含计划与 ADR 草稿）；`git branch` 上的 `backup/sync-revision-freshness-pre-review-rebase` 指向变基前的 `3250f04f`（远端当时的 head）。诊断出口是纯增量的可选依赖：不传 `diagnostics` 时与修复轮之前的行为逐字相同。

### Batch 6 · 第二轮评审修复轮（2026-10-08）

**最小闭环**：PR #290 第二轮评审（Singularity-AI-Bot，在 head `375d8a75` 上，1 × P2、5 × P3，无 P0 / P1）的 6 条意见逐条复现或核对，人类伙伴对「诊断出口接线的承接 issue」的裁决落地（`Decision Log`）。PR 正文一条由协调者处理，其余全部在本地提交里完成。
**涉及文件**：见 `Global Constraints` 中批次列含 6 的行。

1. 恢复锚点：`git branch backup/sync-revision-freshness-pre-rr2 375d8a75`。
2. P3 结果整体不含原文（只改测试）：`assertRoundFailed` 改经 controller 发命令（一轮仍只跑一次），对 core 结果与 `CommandResult` 两层都做 `JSON.stringify` 与 `util.inspect(showHidden)` 的 `doesNotMatch`；55 / 55 仍绿，红在变异 M38–M40（S35）。
3. P3 钩子返回值：先补 I18 的三种钩子（跨 realm、thenable、读取 then 即抛错）与 I20（永不 resolve 的钩子），确认 I18×2 红；再新增内部模块 `diagnostics.ts`（Promise 构造器吸收、不等待），57 / 57（S34）。
4. P3 冷启动吞掉的记录失败：先补 I21、I22 并更正「双重故障」用例里的次数，确认 5 条红；再让 `composeCore` 的 `catch (error)` 在吞掉之前交给同一个钩子，并在 `CoreDiagnostics` 的注释里写明脱敏义务，61 / 61（S36）。
5. 变异：M37–M45 在 `git archive HEAD` 的导出目录里逐条应用（每条先断言锚点恰好命中一处、`cmp` 与 `git diff --no-index -U0` 证明生效），再把 M1–M36 在最终树上整表重测（A12）。
6. P2 记录更正：本计划 `Decision Log` 的「合并顺序」行与评审记录的对应一条就地更正（保留原文并标 Superseded，引用选项原文），新增「诊断出口接线的承接 issue」一行，TD-030 的下一步写成由 #132 接线并承担脱敏（S37）。
7. P3 批准出处：`docs/adr/README.md`、ADR-0012 状态行与本计划 `Decision Log` 的写法统一（Decision Log）。
8. P3 计划与实际提交布局不符：Batch 5 第 10 步与回滚就地标 Superseded，最终整合形态记入 `Decision Log`，Progress 末项更正。
9. 验证：`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e`、`node --test tests/mvp0`、`./node_modules/.bin/tsc --noEmit`、`node --test tests/contract/package-boundaries.test.js`、`node scripts/rule-checks.mjs size origin/main`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/workflow-check.mjs`、`git diff --check origin/main...HEAD`、`lint_execplan.py`，以及第一轮的 #220 / #199 验收命令（V1–V8）。
10. 提交：本地小提交（`test(tests)`、`fix(core)` ×2、`docs(...)`），尾注只写 `Refs #199` / `Refs #220`；协调者并入现有三提交布局、推送与回读。

**回滚**：revert 本批提交；`backup/sync-revision-freshness-pre-rr2` 指向本批之前的 `375d8a75`。诊断出口仍是纯增量的可选依赖：不传 `diagnostics` 时与本批之前逐字相同。

### Batch 7 · 第三轮评审修复轮（2026-10-08）

**最小闭环**：PR #290 第三轮评审（Singularity-AI-Bot，在 head `47f76c7c` 上，1 × P3）：`composeCore` 水合 `catch` 里诊断钩子的调用点没有「不等待」的判别用例，只在这里 `await` 钩子的变异 H8c 在全量下存活。只补测试，实现零改动。
**涉及文件**：见 `Global Constraints` 中批次列含 7 的行。

1. 恢复锚点：`git branch backup/sync-revision-freshness-pre-r3 47f76c7c`。
2. 先证存活：在 `git archive HEAD` 的导出目录里应用 H8c（`diagnostics.ts` 的出口改 `async` 并 `await` 吸收用的 promise，`bootstrap.ts` 的调用点用 `void`，`context.ts` 的调用点 `await`），三文件 93 / 93、全量只有 S9 一条环境性失败（S38）。
3. 补 I20b（两个 Storage）：I21 的坏存储加返回永不 resolve 的 promise 的钩子；`hostDiagnostics` 探针加可选的返回值参数（缺省行为不变）。H8c 下 I20b×2 红、其余 93 条绿，还原后 95 / 95。
4. 变异：H8c 编为 M46；M37、M43–M46 与新用例可能碰到的 M8、M30–M36、M41、M42 在最终树的导出目录重测（A13）。
5. 验证：`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e`、`node --test tests/mvp0`、`./node_modules/.bin/tsc --noEmit`、`pnpm run boundaries`、`node scripts/rule-checks.mjs size origin/main`（期望代码 ≤ 800）、`node scripts/rule-checks.mjs disclosure origin/main`、`git diff --check origin/main...HEAD`、`lint_execplan.py`。
6. 提交：本地小提交（`test(tests)`、`docs(exec-plan)`），尾注只写 `Refs #199`；协调者并入现有三提交布局、推送与回读。

**回滚**：revert 本批提交；`backup/sync-revision-freshness-pre-r3` 指向本批之前的 `47f76c7c`。纯测试增量，不改实现。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| V1 | #220-1：相同引导两次修订号不变 | T1（chain-bootstrap，base 红）；I1×2 |
| V2 | #220-2：内容变化的全量快照恰好推进一次 | T4（含移除与随后的相同引导）；I5×16（八类变化 × 两个 Storage）；I13×2（快照被清空） |
| V3 | #220-3：内容不变的手动刷新记录新鲜度、不推进修订号 | T5（对账时刻 t1 → t2）；W1、W2（降级后真实刷新恢复为 metadata、修订号不变）；I2 恢复段 |
| V4 | #220-4：storage-sync-surface 通过 | `node --test tests/integration/storage-sync-surface.test.js` 0 fail |
| V5 | #199-1：被拒绝的观察让游标 degraded 带码，新鲜度读取报告它 | I2×2 |
| V6 | #199-2：集成用例证明失败后的游标状态，撤掉翻译即变红 | I2×2 + M4 |
| V7 | #199 评论 2：冷启动或成功之后被拒，`lastUpdatedAt` 不前进 | I3 + M4 |
| V8 | 2E：重复观察、较旧观察、只记新鲜度；P2 变为不推进 | T2、T3、T5；P2 读回 `revision 1 -> 1 \| entities 5 -> 5` |
| V9 | ADR-0012 / K1：未提交、刷新、查询不推进；交付写者不推进 | I2、I14（未提交：异常与 provider 结构化失败）、I11、I12（提交里任一笔写入被拒绝则整轮回滚，含实体、身份、成员关系与账本）、T5（刷新）；`git grep -n advanceRevision -- packages/core/src` 只有 `bootstrap.ts` 与 `status-policy.ts` 两处（查询路径不推进）；第 6 条由 #221 / #222 在各自计划引用 |
| V10 | K2：不裸抛、不转发原文 | I2 的 `doesNotMatch` + M7；双重故障按 D3 的解释拒绝（I4 + M8） |
| V11 | 游标缺失读作陈旧 | I4 + M5 |
| V12 | #202 残留不被误判 | T6 + M9 |
| V13 | 回归 | `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 与 `tests/mvp0` 0 fail；`tsc --noEmit` 无输出；`node --test tests/contract/package-boundaries.test.js` 0 fail；`node scripts/workflow-check.mjs` exit 0 |
| V14 | 证据回填可复跑 | Batch 3 第 6 步的回读与重放全部符合期望 |
| V15 | 规模与发布面 | `size origin/main` 代码 ≤ 800（实现 ≤ 350）、文档 ≤ 1300；`disclosure origin/main` exit 0；`git diff --check origin/main...HEAD` 无输出 |
| V16 | 守卫有判别力 | M1–M45 在最终树上整表重测，每条的红集合与 D11 一致（A12；M1–M36 的第一次整表重测见 A11）；第三轮评审只加 I20b，新用例可能碰到的 M8、M30–M37、M41–M45 与新增的 M46 在最终树上重测（A13） |
| V17 | TD-030 诊断出口 | I16–I22、I20b + I4 追加的断言；M30–M46；原异常经 `diagnostics.syncRoundFailed` 交给宿主（含组合期被吞掉的记录失败、不等待、跨 realm），命令结果与读侧不含原文（A11 的 X2 与旧载体探针，A12、A13） |
| V18 | 变化判定不依赖端口没有承诺的顺序 | I15×4；M28、M29 |
| V19 | ADR-0012 已采纳、归档完成 | ADR 状态行为 Accepted 且带批准时刻与所选原话；`git grep -n 'ADR-0012' docs/adr/README.md` 的索引行为 Accepted；`git grep -n 'exec-plan/activ[e]/2026-10-08-sync-revision-freshness'` 无命中；`docs/README.md` 的 Completed 表有本计划、Active 表没有；`lint_execplan.py` 通过 |

## Progress

- [x] (2026-10-08 00:40 CST) Batch 0：核对三份设计稿的事实与实验；在 base 的 `git archive` 导出目录实现原型、写全部用例、跑全量与变异（`Artifacts and Notes`）；写定本计划、ADR-0012（Proposed）与两处索引行。未提交、未推送。
- [x] (2026-10-08 01:20 CST) Batch 0 收尾（协调者）：规划提交 `15534f7` 推送到 `fix/sync-revision-freshness`，开 draft PR #290（`closingIssuesReferences` = #199、#220；标签 `kind:fix` `area:core` `area:adr` `area:exec-plan` `gate:E1`；里程碑 M2.1）；`node scripts/policy-check.mjs pr 290` 通过；两个 issue 的 `Status` 置 In Progress（见 Decision Log）。
- [x] (2026-10-08 00:45 CST) Batch 1：#220 修订号。红集合恰为 T1–T6、W1、W2、I1×2（10 条，其余 24 条绿）；实现后同三文件 34 / 34 绿，`storage-sync-surface` 等四个文件 39 / 39 绿，`tests/contract tests/integration tests/e2e` 1214 / 1214 绿，`tsc --noEmit` 无输出；变异 M1、M2、M3、M6、M9、M10 的红集合与 D11 变异表一致（M1 此时 10 红，I2×2 在 Batch 2 加入后为 12）。本地提交 `fix(core): 业务修订号只随已提交内容变化推进`。
- [x] (2026-10-08 00:48 CST) Batch 2：#199 结构化失败。红集合恰为 I2×2、I3、I4（4 条，I1×2 仍绿）；实现后三文件 38 / 38 绿，`tests/contract tests/integration tests/e2e` 1218 / 1218 绿，`tests/mvp0` 7 / 7，`tsc --noEmit` 无输出，`package-boundaries` 8 / 8；变异 M4、M5、M7、M8 的红集合与 D11 一致，并在 Batch 2 的树上把 M1–M10 整表重跑（M1 12 红、M2 2、M3 2、M4 3、M5 1、M6 3、M7 2、M8 1、M9 1、M10 1，还原后均复绿）。本地提交 `fix(core): 把一轮同步的任何异常转成结构化失败`。
- [x] (2026-10-08 00:56 CST) Batch 3：证据与债务回填。`vertical-path.md`（简称表、第 3、13、13.4、13.8 行、13.x 与行级计数、X2 重写、更新说明段）、`release-gates.md`（§2.1 观察更新、§2.1.1 第 7、8 行与汇总）、控制计划（P2 观察、Progress 2E 子项）、迭代规划 D6 行、`tech-debt-tracker.md`（TD-020 转 Resolved，新增 TD-030–TD-033，TD-034 不用）；新增引用逐条回读（正例与伪造前缀负对照各一次，读回值见 A7），P2、X2 与 SQLite 旧载体触发在本检出上重放（A7），`tests/contract/content-placement.test.js` 与 `plan-facts-consistency.test.js` 9 / 9，`git diff --check` 无输出。
- [x] (2026-10-08 01:25 CST) Batch 4 对抗验证第 1 轮的处理（实现者）：9 条发现（P2×3、P3×6）逐条在 HEAD 上复现或证伪（S13–S17）。P2×3 属实但实现本身没有缺陷，缺的是判别力：6 个存活变异（丢掉 kept 行修订号、catch 收窄成 `RangeError`、只包住 `commitSync`、判定忽略 `planningFields` / `planningStatus`、不可锚定条目即推进）在 38 条用例上全绿，补 I5–I10（两个 Storage 各一遍）后全部变红（M11–M19）。P3：idle 游标读作陈旧已修（I9、M18）；命令层泄漏驱动文字登记进 TD-031；重叠轮次与 `syncing` 登记为 TD-034；索引行已改；#220 验收 3 的解释点写进 D5 与待人类确认项；R1 第 8 行补 SQLite 与账本对照，ADR-0012 第 7 条写明不可锚定缺口也记对账时刻。三文件 64 / 64（原 38），`tests/contract tests/integration tests/e2e` 1244 / 1244，`tests/mvp0` 7 / 7，`tsc --noEmit` 无输出，`package-boundaries` 8 / 8；M1–M19 整表重测每条红集合与 D11 一致；新增 / 改写的 40 条用例在 `origin/main` 源码上 40 / 40 红（A8）。三个本地修订提交（用例与 idle 游标修复、计划与 ADR 第 7 条补写、证据与债务回填），待协调者整合。
- [x] (2026-10-08 02:05 CST) Batch 4 对抗验证第 2 轮的处理（实现者）：5 条发现（P2×1、P3×4）逐条在 HEAD 上复现或核对（S20–S24）。P2 属实：一轮提交的事务边界没有判别用例，把推进修订号与重盖挪到内容事务之后、把对账时刻挪出事务、把 healthy 游标挪出事务（M20–M22）在 64 条用例上全绿，实现本身没有缺陷；补 I11（3 个注入点 × 2 个 Storage = 6 条）后三个变异各被杀死 2 条。P3：固定失败文案改成空串全绿（M23 复现），`assertRoundFailed` 补非空、I10 补「四种触发同一句话」，M23 变红 10 条；矩阵 13.4 的缺口列补双重故障残余并给结论加限定语（TD-031）；计划里的计数与 TD-034 的两条冲突决策改正；控制计划两处 base 事实标 Superseded；`syncing` 游标复核后不是新缺陷，维持 TD-034。三文件 70 / 70（原 64），`tests/contract tests/integration tests/e2e` 1250 / 1250，`tests/mvp0` 7 / 7，`tsc --noEmit` exit 0，`package-boundaries` 8 / 8；M1–M23 整表重测每条红集合与 D11 一致；46 条用例在 `origin/main` 源码上 46 / 46 红（A9）。本轮只改测试与文档，没有改任何 `packages/**` 源码。三个本地提交，待协调者整合。
- [x] (2026-10-08 02:35 CST) Batch 4 对抗验证第 3 轮的处理与最终验收（最终验收者，Claude Opus）：第 3 轮（独立验证者复评第 2 轮之后的最终树）出 7 条发现（P2×1、P3×6，无 P0/P1）。P2 属实：整轮回滚只钉住推进修订号、healthy 游标与对账时刻三笔写入，把观察账本或实体 / 身份 / 成员关系写入挪到事务之前（M24、M25）在 70 条用例上全绿；实现正确，补 I12（两个 Storage）后各红 2 条。P3：快照被清空不推进、provider 结构化失败也写对账时刻两个存活变异补 I13、I14（M26、M27）；D3 表「门禁不通过」一行与代码不符（文档错，已拆行）；13.8 结论词回到词表；三重故障（degraded 游标写进后读修订号失败）与只读 SQLite 上的 #199 残余写进 D3、TD-031 与矩阵 13.4，不改实现（Decision Log）；整合与 PR 正文仍是协调者待办。重构（行为不变）：`bootstrap.ts` 的文件头与 `fail` 注释与行为对齐、`commitSync` 统一用解构的 `workspaceId`；测试里观察账本行数并入四表计数 `countsOf`，`assertRoundFailed` 的文案检查改为按需。三文件 76 / 76（原 70），`tests/contract tests/integration tests/e2e` 1256 / 1256，`tests/mvp0` 7 / 7，`tsc --noEmit` exit 0，`package-boundaries` 8 / 8，`storage-sync-surface` 12 / 12；M1–M27 在最终树上整表重测，每条红集合与 D11 一致；52 条判别用例在 `origin/main` 源码上 52 / 52 红（A10）。三个本地提交，待协调者整合。
- [x] (2026-10-08 CST) Batch 4 整合（协调者）：建 backup ref 后把 `15534f7` 之后的本地提交按文件归属收敛为「代码交付物」与「证据回填」两个提交（见 Decision Log 同日条目），整合前后树逐字节相同、文件集合 `comm` 一致；快进推送；推送后的 head、关闭引用与 checks 以 PR #290 回读为准。
- [x] Batch 4 余项（**Superseded by 上一条「Batch 4 整合」与 Batch 5**，保留原文）：整合、推送与回读（draft PR 已在 Batch 0 开出，协调者执行；整合项见 Batch 4 第 2 步，含 f681fc8a 并入已推送的规划提交需要 backup ref 与精确 lease，以及更新 PR #290 的正文：当前仍是 Batch 0 草稿，需补验证证据与待确认项）。
- [x] (2026-10-08 CST) Batch 5 评审修复轮（评审修复者，Claude Sonnet）：PR #290 的 MMP 评审（APPROVED，2 × P2、3 × P3）逐条复现或核对，人类伙伴四项裁决落地（`Decision Log`）。变基到 `origin/main@a357ef8`（无冲突，三个提交 range-diff 逐一等价，变基后 tsc 与全量 1365 / 1365 先于任何修复通过，S31）。P2：诊断出口（D12，I16–I19、M30–M36）；#220 验收 3 按裁决保留 `Closes #220`，TD-032 的下一步指向 #229。P3：排序与深比较守卫（I15、M28、M29，S30）；ADR-0012 删去仓库外的「协调者契约」措辞并采纳；索引与计划的过时状态、数字改为回读命令加观察时刻。归档：计划移到 `docs/exec-plan/completed/`，引用与 TD-030–TD-034 的 ExecPlan 列同步；评审记录 `docs/review/pr-290-mmp-review.md`。三文件 87 / 87（原 76），`tests/contract tests/integration tests/e2e` 1376 / 1376（变基后基线 1365），M1–M36 在最终树上整表重测每条红集合与 D11 一致（A11）。本地提交，待协调者整合、推送与回读。
- [x] (2026-10-08 CST) Batch 6 第二轮评审修复轮（评审修复者，Claude Sonnet）：PR #290 第二轮评审（head `375d8a75`，1 × P2、5 × P3，无 P0 / P1）逐条复现或核对（S34–S37），恢复锚点 `backup/sync-revision-freshness-pre-rr2`。P3 钩子返回值：只认 `instanceof Promise` 属实（跨 realm 的被拒绝 promise 成为未处理拒绝），改为内部模块 `diagnostics.ts` 里用 Promise 构造器吸收、仍不等待，补 I18 的三种钩子与 I20（永不 resolve 的钩子）。P3 结果整体不含原文：实现正确、缺判别力，`assertRoundFailed` 经 controller 发命令并对两层结果做 `JSON.stringify` 与 `util.inspect` 检查（M38–M40）。P3 冷启动吞掉的记录失败：`composeCore` 的 `catch` 在吞掉之前交给同一个钩子（I21、I22；没有收窄 D12），`CoreDiagnostics` 的注释写明脱敏义务。P2：「#292 负责接线」的前提不成立，Decision Log 与评审记录就地更正，承接 issue 按人类裁决为 #132，TD-030 的下一步同步。P3 文档：ADR-0012 批准出处三处统一；计划的提交步骤与最终整合形态更正。三文件 93 / 93（原 87，新增 I20×2、I21×2、I22×2），对 `origin/main@a357ef8` 的源码 93 条里 69 条红、24 条绿；全量 `tests/contract tests/integration tests/e2e` 1382 / 1382；变异 M1–M45 在最终树上整表重测，每条红集合与 D11 一致（A12）。本地提交，待协调者并入现有三提交布局、推送与回读。
- [x] (2026-10-08 CST) Batch 7 第三轮评审修复轮（评审修复者，Claude Sonnet）：PR #290 第三轮评审（head `47f76c7c`，1 × P3，无 P0 / P1 / P2）核对属实（S38），恢复锚点 `backup/sync-revision-freshness-pre-r3`。P3 冷启动调用点不等待钩子没有用例：导出目录里 H8c（出口 `async` 并 `await` 吸收用的 promise，`bootstrap.ts` 用 `void`，只有 `composeCore` 水合 `catch` 的调用点 `await`）在三文件 93 / 93 与全量 1382 条（唯一失败是 S9 的环境性用例）下存活；补 I20b（I21 的坏存储加永不 resolve 的钩子，两个 Storage）后同一变异 95 条里 I20b×2 红、其余 93 绿，还原后 95 / 95；H8c 编为 M46。只补测试，实现零改动。三文件 95 / 95（原 93），对 `origin/main@a357ef8` 的源码 95 条里 71 条红、24 条绿；M37、M43–M46 与可能受影响的 M8、M30–M36、M41、M42 在最终树上重测，M8、M33、M35、M37、M43、M45 的红数各加 I20b×2，其余不变（A13）。本地提交，待协调者并入现有三提交布局、推送与回读。
- [ ] 推送、回读与评审回复（协调者，不在本轮范围）：整合为「代码交付物」与「回填归档」两个提交（**Superseded by 实际三提交形态**：规划提交原样保留，所以是规划、代码、归档三个，见 Batch 5 第 10 步的更正与 `Decision Log`）；建 backup ref 后精确 lease 推送；回读 head、base、checks、关闭引用与评审线程；逐条回复并 resolve；在 #220 写决策评论、在 #229 的验收里加「刷新后页面上的最后确认时间可见地更新」；更新 PR 正文。
- [x] 人类决定中已裁决的两项（2026-10-08 18:40 CST 前后，见 `Decision Log`）：ADR-0012 采纳；#220 验收 3 的解释（保留 `Closes #220`，读侧显示归 #229）。
- [ ] 人类决定中仍待裁决的三项（不阻塞合并与归档）：#134 正文是否按 `Interfaces and Dependencies` 收窄；双重 / 三重故障的拒绝语义（D3、TD-031）；S7 是否另开 issue。

## Surprises & Discoveries

- **S1 三份设计稿的实测结论全部复现**（base，Node v26.10.0）：P2 为 `2 -> 3`；可移植触发与 SQLite 旧载体触发都到达 Storage 并让游标保持 healthy、读侧报 fresh；冷启动 client 显示 0 行且有 `lastUpdatedAt`；`reconcile_cursor` 无写者。α「在内存中实测修复」的结论也在本计划的原型上复现：全量回归不破（A5），变异按预期变红（A4）。
- **S2 SQLite 读回键序与 core 计算值不同**：5 行里整对象 `JSON.stringify` 全不等、`isDeepStrictEqual` 全相等（A3）。所以比较只能是「读回对读回」或键序无关的深比较；本计划两者都用。
- **S3 `RangeError` 的消息里带着 provider 给的版本值**（`packages/capabilities/src/observation.ts` :148）：任何「把 `error.message` 放进结构化失败」的写法都会把 provider 数据带上 wire，M7 钉住。
- **S4 base 上 client 的 `lastUpdatedAt` 在内容不变的刷新后前进，完全来自 P2 的伪 delta**：修复后它按自己的定义不再前进（D5）。
- **S5 空项目的首轮引导修订号停在 0**（base 为 1）：首轮没有任何行，快照没变。全量回归不受影响；记录在此，免得被当成回归。
- **S6 `context.ts` 的注释「降级交给游标状态表达」在 base 上不成立，修复后除双重故障外成立**；本 PR 不改该文件（D3、TD-031）。**Superseded in part（评审修复轮）**：`context.ts` 只新增可选的诊断出口，这条注释与 `composeCore` 的 `catch {}` 不动。**Superseded in part（第二轮评审）**：`composeCore` 的 `catch` 现在绑定异常并在吞掉之前交给诊断出口，注释保留（D12、S36）。
- **S7 既有缺陷，不在本 PR 范围**：`packages/core/src/status-policy.ts` :84 在事务外读投影，再在事务里整行写回，与并发引导之间存在丢失更新；宿主权威下的状态写入会被下一次引导覆盖（#273）。修复后这种覆盖会被正确计为一次内容变化。是否另开 issue 由人类决定。
- **S8 本仓库的计划 lint 要求 `Concrete Steps`、`Artifacts and Notes` 两节与 `Change Note (` 格式**，比 `PLANS.md` 的 13 节多两节；沿用 `docs/exec-plan/completed/2026-10-01-work-item-list-states.md` 的做法，把两节放在 `Outcomes & Retrospective` 之后、`Bottom Change Note` 之前。
- **S9 导出目录里有一条与本改动无关的失败**：`tests/contract/issue-policy.test.js`「CLI：脚本被改名成不带扩展名的副本后」在导出目录（不是 Git 仓库）读回 exit 3、期望 2；在本工作树里同一用例 2/2 通过。导出目录还需要复制各包自己的 `node_modules` 链接（`packages/ui` 需要 react），见 C4。
- **S10 计划里的 `node --test-reporter=spec <文件…>` 漏了 `--test`**：不带 `--test` 时 Node 把第一个文件当脚本运行，其余文件被当成参数静默忽略，输出像「15 条、6 红」而不是 34 条。本批第一次跑红就踩到，已在 Batch 1 / 2 的跑红步骤与 C2 改成 `node --test --test-reporter=spec <文件…>`；用例名集合以 `✖` 行比对，同时核对总数（Batch 1 的三文件合计 34 条）。
- **S11 矩阵的两处计数行也要跟着改**：`vertical-path.md` 的「13.x 共 10 面」与「结论计数」两行写着旧计数（13.x：已交付 2、部分 3、反例 3、未交付 2；行级：部分 6、反例 5）。13.4、13.8 升为已交付、第 3 行升为部分之后，它们必须同步：13.x 变为已交付 4、部分 2、反例 2、未交付 2，行级变为部分 7（第 1、3、5、7、8、11、12 行）、反例 4（第 4、6、10、13 行）、未交付 3。计划的 Batch 3 第 1 步没有点名这两行；改后用 `tests/contract/plan-facts-consistency.test.js` 回读。
- **S12 X2 的 `outcome` 不能写成反引号模板字面量**：片段放在 `node --input-type=module -e "..."` 的双引号里，bash 会把反引号当命令替换。`Artifacts and Notes` A2 的 `` `${r.ok} ${r.error?.code}` `` 改成字符串拼接 `r.ok + ' ' + r.error?.code`，读回值不变；文档里的片段按原样从 `vertical-path.md` 抽出重放过。
- **S13 第 1 轮 9 条发现在 HEAD 上全部属实或有证据**：6 个存活变异（N1 丢 kept 行修订号、N3 catch 收窄 `RangeError`、N3b 只包住 `commitSync`、N4 / N5 判定忽略 `planningFields` / `planningStatus`、N13 不可锚定条目即推进）在导出目录里都是非空 diff、三文件 38 条 fail 0；N6（判定忽略 `content`）只被 T4 的标题断言杀死。实现在 Fake 与 SQLite 上手测都对，所以修的是判别力，不是实现（A8）。
- **S14 读侧的 fail-closed 还有一格**：游标 `state=idle` 与 `syncing` 在 HEAD 上都读作 fresh（两个 Storage 一致）；`idle` 与「游标缺失」同属没有成功证据，已并入 R-FRESH（I9 先红后绿）。`syncing` 没有写者，语义要等 #134 的调度器，登记在 TD-034。
- **S15 命令层不翻译存储拒绝是普遍现象**：同一个磁盘错误文字，`createController(core).commands.bootstrapWorkspace` 与 `applyPlanningStatus` 都原样拒绝给调用方。双重故障的文字泄漏面因此是命令边界的既有缺口，不是引导独有；改 controller 不在本 PR 的文件集，登记在 TD-031，出口是 #132 的宿主边界。
- **S16 重叠的两轮引导是既有缺陷**：A 读到旧快照后挂起、B 完整引导、放行 A，较旧快照覆盖较新快照并再推进一次修订号（两个 Storage 一致，base 同样）。本 PR 的每个事务仍满足 ADR-0012 第 2 条；并发次序是 #134 调度器的前提，登记在 TD-034 与 ADR-0012 的 Consequences。
- **S17 新增 / 改写的用例里只有 I9 在修复前红**：I5–I8、I10 钉住的是已正确的实现，它们的判别力由变异证明（M11–M19），不由「修复前红」证明；在 `origin/main` 源码上整套 40 条（含 T1–T6、W1、W2、I1–I10）全红（A8；第 2 轮后为 46 条，含 I11，A9）。
- **S18 SQLite `:memory:` 的账本行数只能经内部句柄读**：端口对观察账本只写不读，替身读 `exportFakeStorageState`，SQLite 读 `storage.db`（TypeScript 里是受保护字段，测试在运行时访问，与 X2 的旧载体触发同一做法）。I8 因此以「新观察 +1 行」作对照，免得行数断言空转。
- **S19 变异规程里的 `cut -c` 会按字节截断中文用例名**：macOS 的 `cut -c` 不认 UTF-8，红集合输出出现乱码；整表重测改为保留完整 tap 输出，再用脚本解析 `not ok` 行。
- **S20 事务边界没有判别用例，三种「挪出事务」的实现都让 64 条用例全绿（第 2 轮 P2）**：ADR-0012 第 2、3 条与 D5 / D7 写明推进修订号、行写入、同步游标与对账时刻在同一个事务里，但现有失败注入（I2 的 poison、I10 的 provider 抛出）都发生在任何修订号或游标写入之前，分辨不出边界。在 HEAD 导出目录里复现：M20 / M21 / M22 / M23 的 diff 为 12 / 2 / 10 / 2 行，三文件都读回 64 条 0 红。可观察的差异（A9 的探针，替身与 SQLite 一致）：让推进修订号拒绝并同时改一个标题，HEAD 读回 `result false unavailable | rev 1 -> 1 | content changed without revision false`（整笔回滚），M20 读回同样的结果与 `... true`，即内容已提交、修订号没推进、命令却报失败。补用例的要点是 Proxy 必须在 tx 级与根级同时拒绝：只拒绝 tx 级，被挪到根句柄上的写入会从根级溜走，反之亦然。
- **S21 共享断言让几条变异的红集合变大**：I11 复用 `assertRoundFailed`，所以 M4（撤掉翻译）、M7（转发原文）、M12（catch 收窄）与 M23 的红数各加 6，M6（删对账时刻）加 6（撤掉注入后「恢复提交记对账时刻」的对照断言），M16（比较时丢掉 `content`）加 6（同一对照断言要求「改一个标题后恰好推进一次」）；D11 变异表与 A9 已按整表重测的实测值改写。
- **S22 手写计数会漂移**：计划 Progress、Decision Log 与 Batch 4 第 2 步写「两个修订提交」，第 1 轮实际新增 3 个（e6806954 代码、10552521 计划与 ADR、331d3eb2 回填）；提交 e6806954 的正文写「7 个存活变异」，计划 S13 与 A8 是 6 个。计划里的计数已改正，Batch 4 第 2 步改按提交主题描述归属；提交正文已在本地历史里，改写它要动提交，留给协调者整合时改正（Batch 4 第 2 步写明）。
- **S23 idle / syncing 今天都没有写者**：`git grep -n putSyncCursor -- packages apps` 只有 `bootstrap.ts` 的 healthy（事务内）与 degraded（`fail`）两处，`SyncState.Idle` / `Syncing` 只在端口常量与 `queries.ts` 的读侧出现（A9）。第 2 轮 P3「syncing 仍读作新鲜」复核属实但不可达，不是新缺陷：「从未成功的 syncing」与「此前成功过、现在在途的 syncing」在游标记录里无法区分，读侧语义要等 #134 的调度器（TD-034）。
- **S24 控制计划里还有两处未标注的 base 事实**：诊断表「重复 bootstrap 推进 revision」与 P2 之后的事实清单「`bootstrap.ts:110` 无条件 `advanceRevision`」在本 PR 之后不再成立，已就地标 Superseded（保留原文）。PR #290 的正文仍是 Batch 0 草稿（「当前状态：draft，只含 Batch 0」），更新它是协调者的外部写入，待办写在 Progress 的 Batch 4 余项。
- **S25 整轮回滚只钉住了三笔写入（第 3 轮 P2）**：I11 比对行、修订号与对账时刻，事务里更早的观察账本、实体、外部身份与成员关系写入没有判别用例。在最终树的导出目录复现：M24（`recordObservations` 挪到事务之前用根句柄写）、M25（`upsertItems` 挪到事务之前用根句柄写）各 2 行 diff，三文件 70 条读回 0 红。I12 让新增一个条目并发一条更新的观察，再让事务的最后一笔写入（`putReconcileCursor`）在两级都拒绝：本分支两个 Storage 上四张表的行数都与事务前相同、撤掉注入后各多一行，M24、M25 各红 2 条。对账时刻的变异 M6 因此多杀 I12×2，又因 I14 断言「对账时刻停在上一次提交」再多杀 I14×2（实测 15，比按 I12 预估的 13 多 2；以实测为准写进 D11）。
- **S26 D3 表把「门禁不通过」与「没有规划绑定」并成一行写「不写游标」，与代码不符**：有绑定而门禁不通过时 `bootstrapWorkspace` 调 `fail(context, binding?.ref.bindingId, …)`，写 degraded 游标（探针读回 `gate false not_supported | cursor degraded not_supported | reconcile undefined`）；只有没有绑定时不写。行为与 base 相同，是文档错，已拆成两行。
- **S27 三重故障**：一轮未提交、degraded 游标写进之后 `fail` 读当前修订号失败，命令以该读取的驱动原文拒绝（探针：`currentRevision` 与 `transaction` 都以带占位路径的磁盘错误拒绝，读回 `REJECTED disk full: <占位路径> | cursor degraded unavailable`，经 `createController(core).commands.bootstrapWorkspace` 同样原文拒绝）。降级已落账、读侧报陈旧，只有命令结果是拒绝。变异 N29（读修订号失败时吞掉、返回哨兵）在 76 条用例上存活：它是 D3 的取舍，不是判别力缺口（Decision Log）。
- **S28 矩阵 13.8 的首版结论「已交付（替身与 SQLite）」不在 `vertical-path.md` 的结论词表内**：`content-placement` 与 `plan-facts-consistency` 都不检查词表，9 / 9 照绿；已改为「已交付（替身 + 真实 storage-sqlite，集成）」并保留首版写法的说明。
- **S29 TD-031 的「写失败、读成功」在真实适配器上可复现**：SQLite `:memory:` 在一轮成功之后 `PRAGMA query_only = ON`，改一个标题再引导：命令以 `attempt to write a readonly database` 拒绝，`getPlanningSync()` 前后都读回 `{"degraded":false,"stale":false}`。即 #199 正文「持续失败的同步与健康的同步不可区分」在只读库 / 磁盘满这类故障上仍成立，只是缩窄到「连 degraded 游标也写不进」；#199 的验收针对「被拒绝的观察」且游标可写，所以验收成立，残余写进 TD-031 与矩阵 13.4 的缺口列，并列为人类评审时的确认项。

- **S30 「去掉排序」「`JSON.stringify` 比较」不是等价变异（评审修复轮 P3）**：前三轮对抗验证把它们判为等价，因为两个适配器今天恰好返回稳定的行序与键序。端口对 `listPlanningProjections` 的顺序没有承诺（调用方不得依赖），评审用 Proxy 让它隔次倒序或隔次倒序键序，这是端口允许的行为：去掉排序时倒序读回使相同引导的修订号 `1 -> 3`，换成 `JSON.stringify` 时打乱键序同样 `1 -> 3`；全量用例此前都读回全绿（1256 / 1256）。判据错在把「今天的适配器行为」当作「端口承诺」：判断变异是否等价，要对端口允许的全部行为量化，而不是对已有适配器的行为。补 I15（行序、键序各自打乱，两个 Storage，M28、M29 各被 I15 的 2 条杀死），行序与键序分开两种模式，免得一条用例同时杀两个变异而分不清守的是哪一道。
- **S31 变基**：评审修复轮开始时 `origin/main@a357ef8` 比分支起点 `6417d45` 多 #286、#288、#295、#287、#289 等的提交；`git rebase origin/main` 无冲突，`git range-diff` 三个提交逐一为 `=`。main 在这段增量里在 `packages/core` 只改了 `chain-facts.ts`，不碰 `bootstrap.ts`、`queries.ts` 与 `context.ts`，所以文中的 base 读回在新 main 上不变（A11 在 `origin/main` 的导出目录重放 P2、X2 与旧载体触发）。变基后的基线：tsc exit 0，`tests/contract tests/integration tests/e2e` 1365 / 1365。
- **S32 诊断钩子的两个形态陷阱**：① 钩子类型是 `(error: unknown) => void`，TypeScript 接受 `async` 函数，其被拒绝的 promise 不会被同步 `try / catch` 接住，会成为进程级未处理拒绝，所以出口同时接住被拒绝的 promise（I18 的第三个钩子、M34）；② 钩子必须先于 `fail` 调用：`fail` 在双重故障时以 Storage 的错误拒绝，晚调用会丢掉原因（I4 追加的断言、M36）。组合期的首轮引导也走同一条 `catch`，所以冷启动被拒的原因同样交给宿主（I16）。**第二轮评审更正**：① 只认 `instanceof Promise` 不够（S34）；② 的组合期一句只覆盖 `syncRound` 抛出的异常（S36）。
- **S33 易失数字写成了值**：A10 与 PR 描述写「文档桶 729」，评审读回 731；那是最终验收之后又改了索引行与计划才变的。规模、计数这类随 head 变化的读数一律写成「回读命令 + 期望 + 观察时刻与 head」（`PLANS.md` §4），A10 的规模行就地标 Superseded，A11 按此写。
- **S34 钩子返回值只认 `instanceof Promise` 不够，「不等待钩子」也没有用例（第二轮评审 P3）**：函数注释与 `CoreDiagnostics` 都承诺「返回被拒绝的 promise 都被吞掉」，实现却只对本 realm 的原生 Promise 成立；钩子返回另一个 realm（`vm` 上下文，宿主与插件分属不同 realm）里被拒绝的 promise 时，没人接住它，成为进程级未处理拒绝，默认配置下可能让宿主进程崩溃（红：I18 加上 `node:vm` 钩子后 2 条红，栈顶是 `reportSyncRoundFailure`）。「不等待钩子」同样承重（慢日志或永不 resolve 的钩子不能拖住每一轮失败的同步），却没有用例，评审的 H8（`await` 钩子）在 1376 条用例上存活。修复：`diagnostics.ts` 用 Promise 构造器吸收任何返回值（读取、调用 `then` 的同步抛出也变成它自己的拒绝，而不是漏出去），仍不等待；I20 让钩子返回永不 resolve 的 promise，组合期与显式命令都必须在期限内结束（M37 只被它杀死）；去掉 I18 的「读取 then 即抛错」钩子后 M42 存活，所以三种钩子各自承重。
- **S35 「原文不进命令结果」的断言比 D12 写的弱（第二轮评审 P3）**：D12 写「I16、I17 同时断言命令结果与读侧序列化不含原文」，实际 `assertRoundFailed` 只对 `error.message` 做 `doesNotMatch`，I16 的 `JSON.stringify` 对 Error 对象序列化成 `{}`，对「把原异常对象挂进结果」空转。评审的 H11（结果加 `cause`）、H11c（展开成 `detail` 副本）在 87 条上存活，而这些字段会经 controller 原样发给 client。实现本身正确，缺的是判别力。修复只改测试：`assertRoundFailed` 改经 controller 发命令（一轮仍只跑一次），对 core 结果与 `CommandResult` 两层都做 `JSON.stringify` 与 `util.inspect(showHidden)` 的 `doesNotMatch`——Error 对象只有后者看得到（message、stack、cause），字符串与普通对象两者都看得到；M38、M39 与 M40（挂在 `error` 对象上）各被杀死，M39 只被「字符串」与「普通对象」两种触发杀死（Error 对象展开成空对象，哪个检查都看不到，也没有泄漏）。教训同 S30：判断一条断言够不够强，要对「泄漏最可能出现的形态」量化，而不是对今天的实现。
- **S36 冷启动时 `fail` 自身的拒绝被 `composeCore` 吞掉，钩子调用 0 次（第二轮评审 P3）**：S32 ② 与 D12 写「组合期的首轮引导也走同一条 `catch`，所以冷启动被拒的原因同样交给宿主」，只覆盖 `syncRound` 抛出的异常。provider 结构化失败（或门禁失败）而 degraded 游标写不进、或写进后读不出当前修订号时，`fail` 以 Storage 的错误拒绝，`composeCore` 的 `catch {}` 吞掉它：评审探针读回 `coldHookCount 0`，读侧是 `idle` 陈旧（这是对的），原因丢了。选择：不收窄 D12，让 `composeCore` 的 `catch (error)` 在吞掉之前交给同一个钩子（同一调用约定；命令结果与 wire 不变；显式命令里的同一拒绝仍直接到调用方，TD-031 不变，所以也不违反 D3）。理由：宿主拿到的是「命令为什么会拒绝」的原因，正是 TD-030 要补的信息；收窄只是把缺口登记成债务，而修复是一个调用。副作用：组合期的「异常中止加记录失败也被拒绝」会交两次（轮次的原异常、记录失败的拒绝），「双重故障」用例里宿主收到的次数由 2 更正为 3。同时 `CoreDiagnostics` 的注释写明脱敏义务（原异常可能含凭据片段、磁盘路径、SQL 与提供方原文，宿主写日志前负责脱敏，不得转发到 wire 或 UI）。
- **S37 合并顺序里的「接线」被读成诊断出口（第二轮评审 P2）**：本计划的 Decision Log 与评审记录把「#292 does the wiring」读作「#292 是宿主组合根，在本 PR 的诊断出口之上接线」，并据此写「#292 变基时会遇到这三处新增」。协调者核对了原始提问：该选项的原文是 “After fixes and a second review, merge #290 then #291. #292's rebase onto main also takes the K3 routing wiring (with a test that goes red if the seam isn't wired) and #289's pagination, then gets reviewed again.” 其中的「接线」指契约 K3：#292 在 #291 合并后，把自己的 Development 路由缝 `developmentReadBinding` 换成 #291 的 `routeDevelopment`，与诊断出口无关。结果是 `diagnostics.syncRoundFailed` 合并后只有测试在消费（`git grep -n syncRoundFailed -- packages apps` 只命中 core 自己），没有任何 issue 承接宿主接线，修复指令与排障线索在 MMP 的宿主组合 core 不传 `diagnostics` 时会再次丢失，且没有门禁会发现。人类伙伴随后裁决「#132 compose host (Recommended)」：由 #132 在组合宿主时接线并承担脱敏（`Decision Log`，TD-030）。教训：一句裁决的前提要和被裁决选项的原文对照读，不能只用转述。
- **S38 `composeCore` 冷启动调用点的「不等待钩子」没有用例（第三轮评审 P3）**：S34 的 I20 用毒化观察让一轮异常中止，走的是 `bootstrapWorkspace` 里的调用点；`composeCore` 水合 `catch` 是 S36 新增的第二个调用点，I20 到不了它（毒化时 `fail` 成功，`catch` 不进入），I21、I22 会走到它，但它们的钩子返回 `undefined`。只在这里 `await` 钩子的变异 H8c 因此在三文件 93 条与全量 1382 条下存活；评审探针 `cold-never.mjs`（provider 离线 + `putSyncCursor` 拒绝 + 永不 resolve 的钩子）在 HEAD 上读回 `composeCore settled | hook calls 1`，H8c 下读回 `composeCore HUNG (>1s) | hook calls 1`。后果是 D10 那一行「永不 resolve 的钩子拖不住组合期与显式命令」只对「组合期的轮次异常」成立；冷启动的记录失败（磁盘满，同时宿主的日志 sink 是异步的）没有用例，谁为了「确保诊断写完再返回 core」只在这里加一个 `await`，宿主启动时就会永远挂起，没有门禁发现。实现正确，缺的是判别力。修复只改测试：I20b 沿用 I21 的坏存储加永不 resolve 的钩子，要求 `world.open()` 在期限内结束、钩子恰好 1 次、显式命令以同一拒绝在期限内结束；H8c 编为 M46，只被 I20b×2 杀死，对照组 M37 现在被 I20×2 与 I20b×2 杀死。评审建议的「用例落地前先把 D10 收窄为组合期的轮次异常」不再需要，用例同批落地，D10 改成两行各写各的用例。重测还发现：一个新用例也会让别的变异的红数变大——M8、M33、M35、M43、M45 各加 I20b×2（钩子调用次数或拒绝去向变了，它的计数断言变红）；M45 的锚点只能放在 provider 结构化失败分支，放进 `fail` 本身会连异常中止的轮次一起改，I4 也变红（共 7），不是原变异。教训同 S34、S36：一个承诺有几个调用点，就要有几条用例各自走到；新增调用点时要逐个问「哪条用例走到这里，它的钩子会不会真的慢」。

## Decision Log

| 日期 / 作者 | 决策与理由 |
|---|---|
| 2026-10-08 / 定稿评审者（Claude） | **迭代规划 D6 的「#220 + #199 排在 #219 之后（同改 `context.ts`）」作废**：本 PR 不改 `context.ts`（`Global Constraints`；**Superseded by 本表 2026-10-08 评审修复者「`context.ts` 进入文件集」一行**：诊断出口新增三处，与 #219 仍无共享改动，结论不变）；协调者契约 K3 把 `context.ts` 列为 #219 不改的文件，三份 #219 设计也都不改它。两者没有共享文件，合并先后不再约束。Batch 3 在 D6 原处标 Superseded。 |
| 2026-10-08 / 定稿评审者 | 变化检测采用写后重读 + `isDeepStrictEqual` + 整批重盖（D2）。理由：两侧同为读回，经得起 SQLite 往返；移除与 #202 残留交给 Storage 自己的作用域；实现最小。可由人类在 PR 评审时推翻。 |
| 2026-10-08 / 定稿评审者 | 一轮同步的任何异常都转成 `unavailable` 与固定文案，不新增类型化拒绝（D3）；永久拒绝与暂时故障同码登记 TD-030。可由人类推翻。 |
| 2026-10-08 / 定稿评审者 | 对 K2 的解释：双重故障时 `bootstrapWorkspace` 拒绝，而不是返回一个「降级已落账」的结构化结果（D3）；残余登记 TD-031。需协调者确认，可由人类推翻。 |
| 2026-10-08 / 协调者（主会话） | 确认上一行对 K2 的解释：双重故障时拒绝是诚实的失败，契约 K2 的「绝不裸抛」只覆盖从读取到提交的路径。 |
| 2026-10-08 01:20 CST / 协调者（开发账号 SingularityKChen） | 开 draft PR #290 后把 #199、#220 的 Project 10 `Status` 由 `Todo` 置 `In Progress`，`ExecPlan` 文本字段写本计划路径（后者为机械回填）。依据：`docs/exec-plan/completed/2026-10-07-iteration-5-6-planning.md` Decision Log 的 H3 行，人类批准「迭代 5–6 的条目在开 draft PR 时由 agent 置 In Progress」，写入前已回读原文。回读：两个 issue 的 `closedByPullRequestsReferences` 均为 #290，`Status = In Progress`。撤销：把 `Status` 写回 `Todo`、清空 `ExecPlan` 字段。 |
| 2026-10-08 / 定稿评审者 | 游标缺失读作 `{ degraded: true, stale: true, reason: 'idle' }`（D4）。可由人类推翻。 |
| 2026-10-08 / 定稿评审者 | 成功提交时写 `reconcile_cursor.lastReconciledAt`，不改 wire 与 client；`lastUpdatedAt` 的定义不变，「内容不变的成功刷新不推进 `lastUpdatedAt`」由 W2 钉住、由 `workspace-read.ts` 注释写明，暴露对账时刻归 #229 / #218（D5、TD-032）。可由人类推翻。 |
| 2026-10-08 / 定稿评审者 | 修订号规则写进 ADR-0012（Proposed），端口注释只指向它（D6）。采纳由人类决定。**Superseded by 本表 2026-10-08 18:40 CST「现在采纳 ADR 吗」一行**：已采纳为 Accepted。 |
| 2026-10-08 / 定稿评审者 | 本 PR 把 R1 §2.1.1 第 7、8 行与矩阵 13.4、13.8 行升级（「只往保守方向修正」的反向升级）：证据是 T1–T3、I1、I2 经 `commands` / `queries` 入口、两个 Storage，以及 M1、M10、M4 的变异；第 3 行只升到「部分」，因为写侧不排队重放仍无用例。 |
| 2026-10-08 / 定稿评审者 | 2E 的「较旧观察不能覆盖较新快照」在本 PR 用 T3 覆盖（#134 验收 6 可直接引用），不留给 #134。理由：约 12 行测试，零实现，R1 第 8 行的 core 缺口随之闭合。 |
| 2026-10-08 / 定稿评审者 | TD-034 不使用（编号不回收）。**Superseded by 本表 2026-10-08 01:25 CST「启用 TD-034」一行**：对抗验证第 1 轮改用它登记重叠轮次与 `syncing` 语义。 |
| 2026-10-08 00:55 CST / 实现者（Claude Sonnet） | Batch 3 的两处补充：① 13.8 升为已交付后，把它从第 13 行的失败列移到成功列（与 13.4 的做法一致），并把 `vertical-path.md` 的 13.x 与行级计数行同步（S11）；② 第 3 行「承接」列里「R1 第 7 条的反例 #220」改为「R1 第 7 条的 #220 已断言」，因为 §2.1.1 第 7 行已升级。都只是让同一份证据在各处自洽，没有新的裁决。 |
| 2026-10-08 01:25 CST / 实现者（Claude Sonnet，对抗验证第 1 轮的处理） | **P2×3 修在测试，不改实现**：N1、N3、N3b、N4、N5、N13 复现为存活变异，实现手测正确，缺的是判别力。补 I5（八类内容变化 × 两个 Storage）、I6（宿主权威下 kept 行修订号）、I7（不可锚定条目的重复引导）、I8（经 core 的乱序观察，含 SQLite）、I10（provider 抛出任何值与观察流中途抛出），变异表扩到 M19（D10、D11）。不为压规模删判别性断言（`Global Constraints`）。 |
| 2026-10-08 01:25 CST / 实现者 | **游标 `state=idle` 读作陈旧**（D4、I9、M18），与「游标缺失」同属没有成功证据；`syncing` 不改：它没有写者，语义属于 #134 调度器，登记在 TD-034。 |
| 2026-10-08 01:25 CST / 实现者 | **ADR-0012 第 7 条补写**：有不可锚定条目的一轮仍是成功提交，照写对账时刻、照第 2 条只按内容变化推进；失败、读取不完整、异常与回滚不写。依据：provider 的全量读取是完整的，缺口由游标的 `permission_denied` 表达；与当前实现一致，I7 与 M17 钉住。ADR 仍是 Proposed，采纳权在人类。 |
| 2026-10-08 01:25 CST / 实现者 | **双重故障的原文泄漏面登记 TD-031，不改 `bootstrapWorkspace` 的拒绝文字**。理由：① 命令层不翻译存储拒绝是普遍现象（S15），`applyPlanningStatus` 同形，只改引导是半吊子；② controller 与宿主边界不在本 PR 的文件集；③ 协调者已确认的 K2 解释是「双重故障时拒绝」，没有规定文字，把原文换成固定文案是另一个设计取舍，留给 #132 的宿主边界一并定。出口与用例写在 TD-031。 |
| 2026-10-08 01:25 CST / 实现者 | **启用 TD-034**（`Global Constraints` 预分配的号段内；原「TD-034 不使用（编号不回收）」只表示起初没有第五条债务，不是保留空号）：重叠两轮引导没有单飞（S16）与 `syncing` 读侧语义。不在本 PR 修：单飞要先定 #134 调度器的并发模型，字面验收也不要求。写进 #134 的验收需人类批准，agent 只起草。 |
| 2026-10-08 01:25 CST / 实现者 | **#220 验收 3 的解释点单列为待人类确认**（D5）：「记录新鲜度」落在 Storage 的对账时刻，读侧不暴露；PR 描述单列，不写成无争议的完成。若人类不接受，出口是 TD-032，不在本 PR 加 wire 或 client 改动。**已裁决：见本表 2026-10-08 18:40 CST「#220 验收 3 的处理」一行**（接受，保留 `Closes #220`，读侧显示归 #229）。 |
| 2026-10-08 01:25 CST / 实现者 | **提交序列的整合项留给协调者**：规划提交已在 PR #290 的远端 head，`docs(exec-plan): 记录 #290 的看板写入与 K2 解释的确认` 并入它需要备份 ref 加精确 lease；本轮不改写已推送历史。本轮新增两个本地修订提交，整合时的归属见 Batch 4 第 2 步。 |
| 2026-10-08 02:05 CST / 实现者（Claude Sonnet，对抗验证第 2 轮的处理） | **P2「事务边界没有判别用例」修在测试，不改实现**：M20（推进修订号与重盖挪出事务）、M21（对账时刻挪出）、M22（healthy 游标挪出）复现为存活变异，实现手测正确（A9 的探针）。补 I11：三个注入点 × 两个 Storage，Proxy 在 tx 级与根级同时拒绝（只拒一级会被挪到另一级的实现溜过），降级游标不拒（失败路径要能写），断言结构化失败、游标 degraded、修订号与各行（实体 / 行修订号 / 标题）与对账时刻都与事务前逐字相同，撤掉注入后同一改动恰好推进一次（证明失败只来自被拒绝的那一笔写入）。变异表扩到 M23（D10、D11）。 |
| 2026-10-08 02:05 CST / 实现者 | **P3「固定失败文案没有被钉住」**：`assertRoundFailed` 补非空断言、I10 补「四种触发给出同一句话」；不导出 `SYNC_ROUND_FAILED`（会把它变成 core 的公共 API），也不钉具体措辞（措辞可改，契约是「固定、非空、不含原文」）。M23（改成空串）使 10 条变红。 |
| 2026-10-08 02:05 CST / 实现者 | **P3「13.4 没写双重故障残余」**：矩阵 13.4 的旁证与缺口列补一句双重故障（失败游标也写不进、此前为 healthy 的工作区读侧仍报 fresh，TD-031），结论加限定语「双重故障的残余见旁证与缺口列」，保持「已交付」不降级：残余已登记且冷启动形态有判别用例（I4 + M5）；同时把 I11 与「双重故障」用例写进 13.4 的经入口用例并回读。 |
| 2026-10-08 02:05 CST / 实现者 | **P3「计数与整合」**：计划里的「两个修订提交」「7 个存活变异」改按事实（3 个、6 个）并改成按提交主题描述；TD-034 的「不使用」与「启用」两行并存，前者标 Superseded；控制计划两处未标注的 base 事实标 Superseded。PR #290 正文、已推送规划提交的 backup ref + 精确 lease 与整合后的 `comm` / `git diff <整合前 head> HEAD -- packages tests` 复核是协调者的外部写入与历史改写，不在实现者本轮范围（Progress 的 Batch 4 余项）。 |
| 2026-10-08 02:05 CST / 实现者 | **P3「syncing 游标仍读作新鲜」不修，维持 TD-034**：`idle` / `syncing` 今天都没有写者（S23）；`syncing` 的读侧语义取决于「此前是否成功过」，游标记录里没有这条信息，把它一律读作陈旧会让 #134 的调度器在每一轮在途时让所有行变陈旧，是调度器的设计问题。复核结论写进 D4。 |
| 2026-10-08 02:35 CST / 最终验收者（Claude Opus，对抗验证第 3 轮的处理） | **P2「整轮回滚只钉住三笔写入」修在测试，不改实现**：补 I12（两个 Storage 各一条），注入点选事务的最后一笔写入 `putReconcileCursor`，这样事务里先写的实体、外部身份、成员关系、观察账本、投影与修订号都必须一起回滚；不像 I11 那样按三个注入点展开，因为 M24、M25 是「挪到事务之前」，任何晚于它们的注入都能分辨，再展开只增加用例不增加判别力。新前缀「整轮回滚：事务的最后一笔写入」，不复用「原子提交：」，免得矩阵 13.4 与 A9 的回读计数（6）失效。 |
| 2026-10-08 02:35 CST / 最终验收者 | **P3 的两个存活变异补用例**：快照被清空不推进（M26）补 I13，provider 结构化失败也写对账时刻（M27）补 I14；I14 复用 `assertRoundFailed`，把其中的文案检查改为只在给出 `forbidden` 时做（provider 结构化失败的文案本来就是 provider 给的，K2 只管异常）。 |
| 2026-10-08 02:35 CST / 最终验收者 | **三重故障不改实现，写进 D3 表与 TD-031**：`fail` 先写 degraded 游标、再读当前修订号。倒过来（先读后写）时读修订号失败会连游标都不写，读侧可能仍报新鲜，更差；在 `fail` 里吞掉读取失败、返回哨兵修订号（N29）会把「记录失败本身出错时拒绝」这条已由协调者确认的 K2 解释改成另一种语义，而且命令层不翻译存储拒绝是所有命令共有的缺口（S15），出口在 #132 的宿主边界。可由人类推翻。 |
| 2026-10-08 02:35 CST / 最终验收者 | **文档订正**：D3 表的门禁行拆成「门禁不通过（有规划绑定）：写 degraded + 门禁码」与「没有规划绑定：不写」（S26）；矩阵 13.8 的结论改回词表内写法（S28）；13.4 与 TD-031 补只读 SQLite 的读回（S29）；`docs/README.md` 索引行改为「三轮对抗验证与最终验收已完成」。 |
| 2026-10-08 02:35 CST / 最终验收者 | **重构只做行为不变的清理**：`bootstrap.ts` 文件头写明「一轮没有提交（provider 失败或任何异常）」都只标 degraded，`bootstrapWorkspace` 里关于 `fail` 的注释覆盖三重故障，`commitSync` 的 healthy 游标改用已解构的 `workspaceId`；测试的观察账本行数辅助并入四表计数 `countsOf`（I8 与 I12 共用）。没有删除任何判别断言；重构后三文件 76 / 76，M22（healthy 游标挪出事务）按新文本重写后仍红 2 条。 |
| 2026-10-08 02:35 CST / 最终验收者 | **不由验收者做的事**：提交整合（含 f681fc8a 并入已推送的规划提交、改正 `fix(core): 补齐变化判定…` 正文的「7 个存活变异」为 6 个）、推送、更新 PR #290 正文与回读属协调者；ADR-0012 采纳、#134 收窄、#220 验收 3 的解释、双重 / 三重故障的拒绝语义与 S7 是否开 issue 属人类。 |
| 2026-10-08 / 协调者（主会话） | **整合改为三个交付物级提交，不改写已推送的规划提交**（覆盖 Batch 4 第 2 步的「保留四个」）：已推送的规划提交 `15534f7` 原样保留；其后全部本地提交按文件归属收敛为两个——代码交付物（`packages/`、`tests/` 与 ADR-0012 的修订，ADR 是许可这段代码的接口契约，与代码一起回滚）与证据回填（本计划、矩阵、R1、控制计划、迭代规划、债务表与索引）。理由：把后续计划修订并入已推送的规划提交需要改写共享历史（force-with-lease），收益只是提交更整齐；#220 与 #199 的代码在对抗验证三轮修订里交错（双方的判别用例都在同一测试文件），按 issue 拆成两个代码提交要人工重建中间树，且本 PR 是一个闭环，按 PR 整体回滚即可。推送因此是快进。可由人类在 PR 评审时推翻。 |
| 2026-10-08 18:40 CST 前后 / 人类伙伴（actor；记录者：协调者。出处：人类伙伴在协调者会话（负责迭代规划与交付这几个 PR 的会话）的一次四问提问中直接批准；本表以下带「同一次四问提问」的三行出自同一次提问） | **#220 验收 3 的处理**。问题要点：评审 P2——验收 3「记录新鲜度」只落在 Storage 的 `reconcile_cursor.lastReconciledAt`（只有写者、读侧不可见），`Closes #220` 是否把它当作已交付。所选答复原文「Keep Closes, move display to #229 (Recommended)」。执行：接受 D5 的解释（「只落 Storage」），PR 仍 `Closes #220`；协调者在 #220 写决策评论、在 #229 的验收里加「刷新后页面上的最后确认时间可见地更新」（外部写入，由协调者执行并回读）；本 PR 不改这部分代码，只把 TD-032 的「下一步」改成指向 #229 的这条验收，D5 就地标「已裁决」。 |
| 2026-10-08 18:40 CST 前后 / 人类伙伴（同一次四问提问） | **TD-030 的处理**。问题要点：评审 P2——整轮 `catch` 不保留原异常，可操作的修复提示（如 `repairLegacySourceVersions`）与排障线索全部丢失；是本 PR 补宿主诊断出口，还是接受延期。所选答复原文「Add a host diagnostics hook in #290 (Recommended)」。执行：`composeCore` 加可选的 `diagnostics.syncRoundFailed(error)`，缺省 no-op，只把原异常交给宿主，绝不进 wire（D12、I16–I19、M30–M36）；TD-031 到 TD-034 按原文延期；TD-030 更新为「诊断出口已有；同码问题仍在，下一步不变」。 |
| 2026-10-08 18:40 CST 前后 / 人类伙伴（同一次四问提问） | **现在采纳 ADR 吗**。问题要点：ADR-0012 属本 PR，ADR-0011 属 #292 的评审。所选答复原文「Adopt ADR-0012, keep ADR-0011 for #292's review (Recommended)」。执行：ADR-0012 在本 PR 的归档提交里改为 Accepted（照 ADR-0010 的状态行格式写批准时刻与所选原话），`docs/adr/README.md` 的索引行与说明段同步；ADR-0011 不在本 PR，保留给 #292 的评审。 |
| 2026-10-08 18:40 CST 前后 / 人类伙伴（同一次四问提问） | **合并顺序**。问题要点：#290、#291、#292 谁先合并（#292 是宿主组合根，要在本 PR 的修订号规则与诊断出口之上接线）（**Superseded by 本行末的更正**）。所选答复原文「#290 → #291 first, #292 does the wiring (Recommended)」。执行：本 PR 先合并（合并本身仍由人类决定、只用 rebase merge）；#292 在本 PR 之后变基并负责接线（**Superseded by 本行末的更正**），本 PR 不做宿主侧接线。**更正（2026-10-08，第二轮评审 P2；协调者核对了原始提问）**：上面两处「#292 是宿主组合根……接线」「#292 …负责接线」把「接线」的对象写错了。该选项的原文是 “After fixes and a second review, merge #290 then #291. #292's rebase onto main also takes the K3 routing wiring (with a test that goes red if the seam isn't wired) and #289's pagination, then gets reviewed again.” 其中的「接线」指契约 K3：#292 在 #291 合并后，把自己的 Development 路由缝 `developmentReadBinding` 换成 #291 的 `routeDevelopment`，与本 PR 的诊断出口无关；合并顺序本身不受影响。事实：今天没有宿主组合 core，`diagnostics.syncRoundFailed` 只有测试在消费，把它接到宿主日志是宿主组合 issue 的事，承接 issue 见下一行（#132）。 |
| 2026-10-08 / 人类伙伴（在协调者会话里直接回答；记录者：评审修复者，依据协调者转交的裁决事实） | **诊断出口接线的承接 issue**。问题要点：#290 的诊断出口今天只有测试在消费，由哪个 issue 把它接到宿主日志（含脱敏义务）。所选答复原文「#132 compose host (Recommended)」。执行：协调者已在 #132 的 Acceptance criteria 末尾加了一条验收框，原文 “The composed host passes a `diagnostics.syncRoundFailed` sink to core and writes the original sync-round exception to its own diagnostic log after redacting credentials, local paths and provider text; the exception never reaches the wire or the UI (test; from #290, decided 2026-10-08)”（外部写入由协调者执行，此处只引用，写入后以 #132 回读为准）。本 PR 不做宿主侧接线；TD-030 的下一步据此写成「由 #132 在组合宿主时接线并承担脱敏」，D12 的脱敏义务一条与 `CoreDiagnostics` 的注释指向它。 |
| 2026-10-08 / 评审修复者（Claude Sonnet） | **诊断出口的形状**（D12）：钩子只收一个参数（原异常本身），不收上下文对象；缺省 no-op；同步抛错与被拒绝的 promise 都吞掉（S32）；先于 `fail` 调用（双重故障也不丢原因）；不导出 `reportSyncRoundFailure`（内部函数）。`CoreDiagnostics` 随 `context.ts` 导出，供宿主写类型。放弃：在 `BootstrapResult` 加非 wire 字段、在 `catch` 里直接写日志（D12）。可由人类推翻。 |
| 2026-10-08 / 评审修复者 | **`context.ts` 进入文件集**：原决策（本表 2026-10-08 首行）写「本 PR 不改 `context.ts`」。诊断出口必须经 `CoreDeps` 进入，`context.ts` 因此新增三处（接口与两个字段），`composeCore` 的 `catch {}` 与其注释不动。首行决策的实质——本 PR 与 #219 没有共享改动、先后约束解除——不变（#219 不改 `context.ts`）；Global Constraints、Context 的相应句子与迭代规划 D6 行已就地标 Superseded。#292 在本 PR 之后变基。 |
| 2026-10-08 / 评审修复者 | **P3 排序与深比较守卫修在测试，不改实现**：评审的 X15、X16 在端口允许的行为下使引导推进修订号（S30），实现本身对端口承诺是正确的，缺的是判别用例。补 I15（行序、键序分开，两个 Storage 各一遍），编号为 M28、M29；原计划里「去掉排序、`JSON.stringify` 比较是等价变异」的说法就地标 Superseded。 |
| 2026-10-08 / 评审修复者 | **ADR-0012 第 6 条的 Why** 删掉「协调者 … 契约 K1 裁定」（运行态文件、非人类裁决、读者查不到），只留仓库内的理由（快照不含交付事实，推进只会产生空 delta），并写「交付写者的计划（#221、#222）引用本条」。K1 在本计划的 `Interfaces and Dependencies` 里仍是运行态契约的重述，不是 ADR 的依据。 |
| 2026-10-08 / 评审修复者（依据协调者指示） | **归档随本 PR 完成**：评审已 APPROVED、只剩 P2 / P3，修复后按仓库惯例在同一 PR 收尾归档（计划移到 `docs/exec-plan/completed/`，索引行移到 Completed 表）。归档不依赖合并结果，合并状态以 PR 回读为准。 |
| 2026-10-08 / 评审修复者 | **本轮不做的外部写入**：推送、PR 正文、评审线程的回复与 resolve、#220 的决策评论、#229 的验收补充、Project 字段，都由协调者在整合与推送后执行；本轮的 TD-032 文字只写「人类伙伴裁决 + 由协调者写入，写入后以 issue 回读为准」，不假装已写入。 |
| 2026-10-08 / 评审修复者（第二轮评审） | **钩子返回值按 thenable 吸收、不等待；调用点抽成内部模块 `diagnostics.ts`**（S34）：用 Promise 构造器吸收任何返回值，读取或调用 `then` 的同步抛出也变成它自己的拒绝；放弃「`Promise.resolve(pending).catch(…)` 加 `typeof then` 判定」的写法，因为判定要读 `then`，读取本身可能同步抛出，须再套一层 `try`，构造器一处吸收更窄。`context.ts` 要在水合 `catch` 里复用同一个函数，而 `bootstrap.ts` 与 `context.ts` 都经包入口 `export *`，放在任一文件里导出都会变成 core 的公共 API，所以抽成不经入口导出的 `diagnostics.ts`。可由人类推翻。 |
| 2026-10-08 / 评审修复者（第二轮评审） | **组合期被吞掉的记录失败也交给宿主，不收窄 D12**（S36）：改 `composeCore` 的 `catch (error)` 在吞掉之前交给同一个钩子，不新增 `bootstrapRejected`（同一调用约定，宿主少接一个出口）；放弃「收窄 D12 与 S32 的措辞并在 TD-031 记下这一格」，因为修复是一个调用，且不改命令结果与 wire，不违反 D3 / TD-031 的拒绝语义。代价是组合期的双重故障交两次、显式命令只交一次（拒绝已在调用方手里），次数由 I4、I21、I22 钉住。可由人类推翻。 |
| 2026-10-08 / 评审修复者（第二轮评审） | **「原文不进命令结果」只改测试强度**（S35）：`assertRoundFailed` 改经 controller 发命令、对 core 结果与 `CommandResult` 两层做 `JSON.stringify` 与 `util.inspect(showHidden)` 检查，不钉结果的键集合（那会让后续 PR 给 `BootstrapResult` 加字段时必改本文件，与兄弟 PR 产生无谓冲突）。M38–M40 记入变异表。 |
| 2026-10-08 / 评审修复者（第二轮评审） | **ADR-0012 批准出处统一**（P3）：`docs/adr/README.md` 的说明段（原写「PR #290 的修复会话」）、ADR-0012 状态行、本表 18:40 CST 的出处行与评审记录的修复轮一节，统一写成「人类伙伴 2026-10-08 18:40 CST 前后在协调者会话（负责迭代规划与交付这几个 PR 的会话）的一次四问提问中直接批准」。#220 上已发布的决策评论里的「planning session」由协调者订正为同一说法（外部写入，不在本轮）。 |
| 2026-10-08 / 评审修复者（第二轮评审） | **最终整合形态**（P3，计划与实际不符）：Batch 5 第 10 步写「整合为两个提交」，实际是三个——规划 `docs(exec-plan): 规划同步修订号与结构化同步失败`、代码 `fix(core): 修订号只随快照内容变化推进，同步异常转成结构化失败`、归档 `docs(exec-plan): 归档同步修订号计划，回填证据、评审修复与人类裁决`（第二轮评审时 PR head `375d8a75` 上依次是 `747d975b`、`c155db05`、`375d8a75`）。`c155db05` 单独检出：`tsc --noEmit` exit 0，`tests/contract tests/integration tests/e2e` 1375 / 1376，唯一失败是 S9 的环境性用例。Batch 5 第 10 步与回滚、Progress 末项已就地标 Superseded。第二轮评审的修复提交由协调者按文件归属并入代码与归档提交，不新增第四个提交。 |
| 2026-10-08 / 评审修复者（第二轮评审） | **本轮不做的外部写入**：推送、PR 正文（评审 P3：闭环 / 关联两节仍写 Proposed、`active/` 路径与整合前的回滚 SHA）、评审线程的回复与 resolve、#220 评论里「planning session」的订正、#132 验收框的回读，都由协调者执行；本轮只在仓库内写事实，不假装已写入。 |
| 2026-10-08 / 评审修复者（第三轮评审） | **只补测试，不改实现；D10 拆成两行而不是只收窄措辞**（S38）：I20b（两个 Storage）沿用 I21 的坏存储加永不 resolve 的钩子，H8c 编为 M46；放弃「先把 D10 的「组合期」收窄为「组合期的轮次异常」」，因为收窄只是把缺口登记成措辞，而补用例是一个测试，同批落地后 D10 的两行（I20 / M37、I20b / M46）各写各的用例。`hostDiagnostics` 探针加可选的返回值参数而不是在新用例里再造钩子，缺省行为不变、零净增行；代码桶只剩 13 行，所以新用例写得紧凑（写完正好 800，规划上限，CI 硬门 1000），没有删别的用例。可由人类推翻。 |

## Idempotence and Recovery

- 代码批次可重复执行：用例全部用离线替身与 `:memory:` SQLite，不留文件；变异只在导出目录做，工作树里的源码不被改动（C4 每条变异后 `cmp` 核对还原）。
- 运行期幂等：相同输入的引导在修复后完全不改业务修订号与行修订号，只改同步游标（同值）与对账时刻；失败的一轮整笔回滚，只写 degraded 游标。没有数据迁移；回滚代码后已有库照常可读（行修订号保持写入时的值）。
- 回到已知良好状态：未推送前 `git reset --hard origin/main` 之前先建 `git branch backup/sync-revision-freshness-<HHMM> HEAD`；已推送后只用 revert 或「backup ref + 精确 lease」（`AGENTS.md` §6，交给 `git-expert-operations` 流程）。
- 中断恢复：每批结束即本地提交（不推送也要提交），恢复会话时临时目录可能被清空；变异导出目录可随时按 C4 重建。

## Interfaces and Dependencies

**工具**：Node ≥ 22（本机 v26.10.0）、pnpm 10.28.2（`pnpm install --frozen-lockfile --offline`）、`./node_modules/.bin/tsc`、`node --test`、`gh`（带 `-R`）。无凭据、无网络依赖。

**跨 PR 契约（协调者 2026-10-08，本 PR 相关条款重述）**：

- **K1（本 PR 拥有）**：修订号规则即 ADR-0012。PR-C（`feature/delivery-fact-writer`，#221）与 PR-D（`fix/delivery-query-pure-read`，#222）的交付写者不推进修订号、查询纯读；它们的计划引用「ADR-0012 第 4–6 条」。若它们先于本 PR 合并，后合并者回读 `docs/adr/ADR-0012-business-revision-advances-only-on-content-change.md` 是否存在并补引用。
- **K2（本 PR 拥有）**：写者从读取到提交的路径上任何异常都转成结构化失败并记录降级，不转发原异常文字。本 PR 的落点是 D3；双重故障的解释见 `Decision Log`。PR-C 的交付刷新对自己的新鲜度记录遵守同一原则。
- **K5**：规划新鲜度属于本 PR。交付新鲜度不得写 `PLANNING_SYNC_SCOPE` 的游标，不得影响 `getPlanningSync()`，也不得写 `reconcile_cursor`（ADR-0012 第 7 条）。PR-D 若在 `bootstrapWorkspace` 里接入交付摄取，必须放在 `syncRound` 与规划事务之外，自己记录失败；否则交付异常会把规划游标标成 `unavailable` 并回滚规划提交。接入后 T1、I1 必须保持绿。
- **K6**：本 PR 用 ADR-0012 与 TD-030–TD-034（TD-034 起初不用，对抗验证第 1 轮改用它，见 `Decision Log`）；合并时回读 tracker 与 `docs/adr/README.md`，与兄弟 PR 的 ADR-0011 / ADR-0013、TD-035 起的编号并存。
- **K7**：共享文件只改本 PR 自己的行（`Global Constraints` 的「证据回填」与「规则与索引」）；冲突由后合并者 rebase 解决。

**兄弟 PR 与下游 issue 的交接**：

- **PR-B（#219，`feature/development-repository-routing`）**：无共享文件。本 PR 的 catch 只在 `bootstrapWorkspace` 的门禁之后，不吞 `createContext` 的注册拒绝；PR-B 的要求是 registry 改造后 `singlePlanningBinding` 与 `gateCommand` 在引导时不抛异常（它们在本 PR 的 try 之外）。
- **PR-C / PR-D 的预期订正**：本 PR 不扩展 `SyncCursorRecord`，也不导出公共的「变化才推进」助手（变化判定是 `bootstrap.ts` 的内部函数）；交付写者按 K1 不推进修订号，所以不需要这样的助手。交付新鲜度若复用 `sync_cursor`，按 K5 处理 TD-021。
- **#134（定时对账与手动刷新）**：复用 `bootstrapWorkspace` 作唯一写者。本 PR 交付了它的验收 4（相同状态对账两次，实体、成员关系、修订号不变：T1）、验收 2 的 Storage 拒绝分支（I2：失败标陈旧并记录，下一次成功清除）、验收 6（T3），以及范围里的「游标记录上次全量对账时刻」。建议人类批准把 #134 正文收窄为「定时调度、显式刷新命令、退避（TD-030）、单飞与 `syncing` 读侧语义（TD-034）与成员关系删除」，并把上述三条验收改为引用本 PR 的用例。agent 只起草，不写 issue。
- **#218（client 代际）**：可依赖「同修订即同业务内容」与修订号单调（ADR-0012）；若 #229 需要宿主对账时刻，在 #218 的单次 summary 里带上它（TD-032）。
- **#229（抽屉陈旧标记）**：「最后更新时间」读 `lastUpdatedAt` 时，它在内容不变的刷新后不前进；错误码到展示文案的映射仍是 TD-025（`unavailable`、`idle`）。
- **#132（宿主组合根）**：宿主必须给 `createController` 传 `workspaceRevision`（TD-033）；重启组合不推进修订号（I1）。
- **#202（换 Planning 源）**：T6 钉住「残留不被每轮误判」；#202 让残留被收敛移除后，换源后的第一轮应恰好推进一次，T6 按新语义改写，不删除。
- **#273**：宿主权威状态被引导覆盖仍是既有缺陷；修复后每次覆盖都推进修订号（被正确计为变化）。
- **#283**：Draft→Issue 改指主身份时，按 ADR-0012 第 6 条把身份纳入变化判定。
- **#224**：删 `revisionOf` 兜底后，按 TD-033 改为只重盖变化行。

## Outcomes & Retrospective

设计定稿阶段（2026-10-08）的结果：三份设计稿收敛为「core 内一处变化判定 + 一处整轮翻译 + 一行新鲜度默认值 + 一行对账时刻」，不改端口、适配器、wire 与 client 行为；原型实现 +47 / −16 行，14 条用例在 base 上全红、在原型上全绿，10 条变异全部被杀死。相对三份设计稿的主要删减：β 的 wire / client 新鲜度通道与显式字段元组、γ 的端口类型化拒绝与 `createRevisionStamp` 助手、`status-policy.ts` 改动。实施后的实际结果、规模与偏差由 Batch 4 追加在本节。

对抗验证第 1 轮（2026-10-08）的结果：9 条发现、无 P0 / P1。3 条 P2 都是判别力缺口——6 个存活变异在 38 条用例上全绿，实现本身没有缺陷；补 26 条用例（两个 Storage 各一遍）与 9 条变异（M11–M19）后全部被杀死。6 条 P3：idle 游标读作陈旧（修）、ADR-0012 第 7 条与 R1 第 8 行的措辞与强度（修）、索引状态行（修）；命令层泄漏驱动文字、重叠两轮引导与 `syncing` 语义（登记 TD-031、TD-034，既有缺陷）；#220 验收 3「记录新鲜度」只在 Storage 层成立（单列为待人类确认的解释点，出口 TD-032）。相对设计稿没有新增实现行：本轮实现改动只有 `queries.ts` 的 idle 一行及其注释。

对抗验证第 2 轮（2026-10-08，复评上一轮的修复本身）的结果：5 条发现、无 P0 / P1，实现零改动。P2 是判别力缺口：事务边界（推进修订号、healthy 游标、对账时刻与内容写入同一事务）没有用例，三个「挪出事务」的变异在 64 条用例上全绿；补 I11（6 条）后各被杀死 2 条（M20–M22）。P3：固定失败文案可被改成空串（补非空与同文案断言，M23）；矩阵 13.4 补双重故障残余（TD-031）；计划里的计数、TD-034 的冲突决策与控制计划两处 base 事实改正；`syncing` 游标复核后不是新缺陷，维持 TD-034。判别性用例合计 46 条（原 40），变异表 M1–M23。

对抗验证第 3 轮与最终验收（2026-10-08）的结果：7 条发现、无 P0 / P1，实现零改动。P2 仍是判别力缺口：整轮回滚没有覆盖观察账本与实体 / 身份 / 成员关系写入，补 I12 后 M24、M25 被杀死；两个 P3 的存活变异（清空快照不推进、结构化失败写对账时刻）补 I13、I14（M26、M27）。其余 P3 是文档与残余：D3 表门禁行订正、13.8 结论词回到词表、三重故障与只读 SQLite 上的 #199 残余写进 D3、TD-031 与矩阵 13.4。判别性用例合计 52 条，变异表 M1–M27，N29 是有意不钉的取舍。三轮对抗验证的 P2 都落在测试而不是实现上：实现自 Batch 2 起只多了 `queries.ts` 的 idle 一行；回头看，D10 的「每个机制保护什么」若在设计时就按「事务内每一笔写入 × 挪出事务」与「每条判定分支 × 边界输入（空快照、结构化失败）」列满，三轮里 P2 级的存活变异大多在 Batch 1–2 就能被看到。
评审修复轮（2026-10-08）的结果：PR #290 的 MMP 评审（APPROVED）出 2 条 P2、3 条 P3，无 P0 / P1。P2 两条都不是实现缺陷：#220 验收 3 的「只落 Storage」由人类裁决接受（保留 `Closes #220`，读侧显示归 #229）；整轮 `catch` 丢掉原异常由新增的可选宿主出口 `diagnostics.syncRoundFailed` 补上（D12，I16–I19，M30–M36），同码问题仍在 TD-030。P3 三条：排序与深比较守卫补 I15（M28、M29，S30），ADR-0012 删去仓库外的「协调者契约」措辞并采纳为 Accepted，索引与计划的过时状态、数字改为回读命令加观察时刻。分支变基到 `origin/main@a357ef8`，无冲突。判别性用例合计 63 条（原 52），变异表 M1–M36 在最终树上整表重测每条红集合与 D11 一致（A11）。本轮的代码改动：`context.ts` 三处、`bootstrap.ts` 一个函数与一处 `catch (error)`；与前三轮一样，评审出的缺口主要在测试而不是实现——回头看，若设计时对每个「看起来等价」的变异都问一句「端口允许的全部行为里它还等价吗」，I15 本可以在 Batch 1 就写出来。

第二轮评审修复轮（2026-10-08）的结果：第二轮评审（head `375d8a75`）出 1 条 P2、5 条 P3，无 P0 / P1。P2 不是实现缺陷：合并顺序裁决里的「接线」被读成了诊断出口，据此以为 #292 会接，实际今天没有宿主组合 core、诊断出口只有测试在消费；记录就地更正，承接 issue 由人类裁决为 #132，TD-030 的下一步指向它（S37）。P3 五条：钩子返回值只认 `instanceof Promise`（跨 realm 的拒绝成为未处理拒绝）已改为吸收任何返回值且不等待（I18、I20，S34）；「原文不进命令结果」只钉 `error.message` 已改为两层结果整体检查（M38–M40，S35）；冷启动时 `fail` 自身的拒绝被吞掉已交给同一个钩子并写明脱敏义务（I21、I22，S36）；ADR-0012 批准出处三处统一；计划的提交步骤与最终三提交形态更正。判别性用例合计 69 条（原 63），变异表 M1–M45 在最终树上整表重测（A12）。本轮的代码改动：新增内部模块 `diagnostics.ts`、`context.ts` 的水合 `catch` 与 `CoreDiagnostics` 的注释、`bootstrap.ts` 删去搬走的函数；与前几轮一样，缺口主要在测试强度（S35）和契约措辞（S36、S37）。回头看，三条的共同点是「承诺写得比实现宽」：注释说「返回被拒绝的 promise 都被吞掉」、D12 说「冷启动被拒的原因同样交给宿主」、D12 说「命令结果序列化不含原文」，设计时若逐句问一句「哪一种输入能让这句话不成立」，三处都可以更早发现。

第三轮评审修复轮（2026-10-08）的结果：第三轮评审（head `47f76c7c`）出 1 条 P3，无 P0 / P1 / P2，实现零改动。`composeCore` 水合 `catch` 这个诊断出口的调用点没有「不等待钩子」的判别用例，只在这里 `await` 钩子的 H8c 在全量下存活；补 I20b（两个 Storage）后 H8c（M46）只被它杀死（S38）。判别性用例合计 71 条（原 69），变异表 M1–M46；M8、M33、M35、M37、M43、M45 的红数各加 I20b×2（A13）。回头看，S34 补 I20 时只问了「钩子被等待会怎样」，没有再问「这句话有几个调用点」；S36 新增调用点时，也没有回头问 S34 的承诺是否仍被每个调用点的用例走到。

**最终结果（归档时）**：本计划交付 #220（业务修订号只随快照内容变化推进，移除与清空也算变化，一个事务至多一次，随后相同引导不再推进）与 #199（一轮同步的任何异常是结构化失败，游标 degraded 带码，游标缺失与 idle 读作陈旧，原异常不进 wire、只经宿主出口交出），规则落在 ADR-0012（Accepted）。相对计划的偏差：`context.ts` 在评审修复轮进入文件集（D12，`Decision Log`）；对抗验证三轮与三轮评审共补出 46 个变异的判别用例，实现本身只在 idle 游标与诊断出口两处增行。规模读数见 A11（回读命令加观察时刻与 head，不在此重复）。遗留：TD-030（同码问题）、TD-031（双重 / 三重故障与命令层不翻译存储拒绝）、TD-032（读侧可见的对账时刻，#229）、TD-033（整批重盖）、TD-034（重叠两轮与 `syncing` 语义）；待人类裁决的三项见 Progress 末项；合并、整合后的推送与回读由协调者与人类执行。

## Concrete Steps

**C1 开工前检查**（`AGENTS.md` §6）：

    git rev-parse --git-dir --git-common-dir
    git status --short --branch          # 期望：## fix/sync-revision-freshness...origin/main，无其他改动（本计划等 Batch 0 文件除外）
    git worktree list --porcelain
    git check-ignore -v .worktrees/
    node --input-type=module -e "console.log(import.meta.resolve('@harness-projects/core'))"   # 期望路径落在本工作树的 packages/core

**C2 红绿判据**：每次跑红 / 跑绿都用 `node --test --test-reporter=spec <文件…>`（必须带 `--test`，S10），以 `✖` 行的用例名集合比对本计划给出的期望集合；只看 `ℹ fail` 计数不算。

**C3 关键测试辅助**（`tests/integration/sync-revision-freshness.test.js`）：

    const T = (n) => `2026-10-08T00:00:0${n}.000Z`
    const clockOf = (...times) => { let calls = 0; return () => times[Math.min(calls++, times.length - 1)] }
    // 绕过 emitObservation 的入口校验：provider 交出非规范版本的观察，一路到达 recordObservation 被 Storage 拒绝
    const poison = (planning) => planning.state.observations.push({ ...planning.state.observations[0], dedupeKey: 'poison-1', sourceVersion: 'vé' })
    const heal = (planning) => { planning.state.observations = planning.state.observations.filter((o) => o.dedupeKey !== 'poison-1') }
    async function setup(storage, { clock = clockOf(T(1), T(2), T(3)) } = {}) {
      const providers = createFakeProviders(); const id = newWorkspaceId()
      const open = () => composeCore({ workspace: { id, name: 'sync-round' }, providers, storage, clock })
      const cursor = () => storage.getSyncCursor(id, providers.planning.bindingId, PLANNING_SYNC_SCOPE)
      return { id, providers, storage, open, cursor, revision: () => storage.currentRevision(id),
        reconciled: async () => (await storage.getReconcileCursor(id))?.lastReconciledAt }
    }
    // I4：第一个 transaction 留给 createContext，之后的事务与所有游标写入都拒绝；方法 bind 到原对象，避开私有字段的 TypeError
    let transactions = 0
    const broken = new Proxy(createFakeStorage(), { get(target, key) {
      if (key === 'transaction' && transactions++ > 0) return () => Promise.reject(new Error('disk full'))
      if (key === 'putSyncCursor') return () => Promise.reject(new Error('disk full'))
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value } })

**C4 变异规程**（只在导出目录做；`SCRATCH` 是执行者自己的、仓库之外的临时目录；本机 `cp` 可能带交互别名，一律写 `/bin/cp`）：

    rm -rf "$SCRATCH/export" && mkdir -p "$SCRATCH/export/node_modules"
    git archive HEAD | tar -x -C "$SCRATCH/export"                       # 先把本批改动本地提交
    for l in node_modules/* node_modules/.bin node_modules/.pnpm; do /bin/cp -RP "$l" "$SCRATCH/export/node_modules/"; done
    for d in $(find packages apps -maxdepth 3 -name node_modules -type d -not -path '*/node_modules/*'); do
      mkdir -p "$SCRATCH/export/$d"; for l in "$d"/* "$d"/.bin; do [ -e "$l" ] || [ -L "$l" ] && /bin/cp -RP "$l" "$SCRATCH/export/$d/"; done; done
    (cd "$SCRATCH/export" && node --input-type=module -e "console.log(import.meta.resolve('@harness-projects/core'))")   # 期望以 $SCRATCH/export/packages/core/ 开头

每条变异：用脚本做字符串替换，替换前后内容相同即以 `MUTATION NOT APPLIED` 失败退出；`git show HEAD:<path> | diff - "$SCRATCH/export/<path>"` 打出非空 diff；在导出目录跑三份测试文件（`node --test-reporter=tap <文件>`，收集 `not ok` 行），红集合与 D11 变异表比对；用 `git show HEAD:<path> > "$SCRATCH/export/<path>"` 还原，`cmp` 一致后复跑变绿。

**C5 提交与发布**：每批一个本地提交；推送前按 Batch 4 第 2–3 步整合与扫描；推送后按第 5 步回读。

## Artifacts and Notes

**A1 探针**（在本工作树根目录用 `node --input-type=module < <脚本>` 运行，使包解析落在本工作树）。P2 即控制计划的 P2 片段。#199 可移植触发与冷启动 client 的探针按 C3 的 `poison` 构造。

**A2 新 X2 片段**（Batch 3 替换 `docs/product/vertical-path.md` 的 X2）：

    import { composeCore } from '@harness-projects/core'
    import { createFakeProviders } from '@harness-projects/provider-fake'
    const providers = createFakeProviders(); const { planning } = providers
    const api = await composeCore({ workspace: { name: 'probe' }, providers })
    planning.state.observations.push({ ...planning.state.observations[0], dedupeKey: 'poison-1', sourceVersion: 'vé' })
    let outcome; try { const r = await api.commands.bootstrapWorkspace(); outcome = r.ok + ' ' + r.error?.code } catch (e) { outcome = 'threw ' + e.constructor.name }
    const binding = (await api.queries.listProviderBindings()).find((b) => b.domain === 'planning')
    const cursor = await providers.storage.getSyncCursor(binding.workspaceId, binding.id, 'planning.project')
    console.log('bootstrap', outcome, '| cursor', cursor.state, cursor.lastErrorCode, '| any view degraded', (await api.queries.listPlanningItems()).some((v) => v.freshness.degraded))

观察（2026-10-08）：base `bootstrap threw RangeError | cursor healthy undefined | any view degraded false`；原型 `bootstrap false unavailable | cursor degraded unavailable | any view degraded true`。P2：base `revision 2 -> 3 | entities 5 -> 5`；原型 `revision 1 -> 1 | entities 5 -> 5`。SQLite 旧载体触发（`:memory:`，经受保护的 `db` 句柄写入 `'v9'` 的已提交观察，再发规范版本观察）：base `bootstrap threw Error | cursor healthy undefined | sync {"degraded":false,"stale":false}`；原型 `bootstrap false unavailable | cursor degraded unavailable | sync {"degraded":true,"stale":true,"reason":"unavailable"}`。

**A3 键序**：同一默认种子分别经内存替身与 SQLite 组合，去掉 `revision` / `workspaceId` / `entityId` 后按内容排序逐行比较：`rows 5 | JSON differs 5 | deep differs 0`；差异例：SQLite 读回 `{"planningStatus":…,"content":…}`，替身 `{"content":…,"planningStatus":…}`。

**A4 原型变异结果**（导出目录，原型 = D7；红数含两个 Storage 各一条）：M1 12 红（T1–T6、W1、W2、I1×2、I2×2）；M2 2（T4、T6）；M3 2（T4、W1）；M4 3（I2×2、I3）；M5 1（I4）；M6 3（T5、I2×2）；M7 2（I2×2）；M8 1（I4）；M9 1（T6）；M10 1（T3）。base 源码 + 新用例：chain-bootstrap 6 红、workspace-read-assembly 2 红、sync-revision-freshness 6 红，其余既有用例全绿。

**A5 原型回归**（导出目录，观察于 2026-10-08）：`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 为 1218 条、1 fail（即 S9 的环境性失败）；`node --test tests/mvp0` 7 / 7；`tsc --noEmit` 无输出。重算命令即 Batch 2 第 4 步。

**A6 原型规模**：`bootstrap.ts` +46 / −15、`queries.ts` +1 / −1、`chain-bootstrap.test.js` +77、`workspace-read-assembly.test.js` +6 / −7、新集成文件 98 行（未含 Batch 1–2 的注释改动）。

**A7 实施实测**（2026-10-08，在 `.worktrees/sync-revision-freshness`，Node v26.10.0；变异在 `.superpowers/mutations/` 下的 `git archive HEAD` 导出目录里做，用完删除）：

- **红绿**：Batch 1 先写用例，base 源码上红集合恰为 T1–T6、W1、W2、I1×2（三文件共 34 条，10 红 24 绿；失败原因与 D11 一致，例如 T3 的修订号 3 对 2、W1/W2 的 poll 得到 delta 而不是 metadata、T5 的对账游标为 undefined）；实现后三文件 34 / 34。Batch 2 先加 I2–I4，红集合恰为 I2×2、I3、I4（RangeError 裸抛、冷启动 `lastUpdatedAt` 被设置而 `reason` 为 undefined、游标缺失读作 fresh）；实现后三文件 38 / 38。合计 14 条 D11 用例在 base 源码上全红、在本分支上全绿。
- **回归**（Batch 2 的树上；Batch 3 提交的树上同一组命令再跑一遍，结果相同，另有 `storage-sync-surface` 12 / 12、`workflow-check` 无发现、`disclosure origin/main` 机械扫描通过、`git diff --check origin/main...HEAD` 无输出、`git grep -n advanceRevision -- packages/core/src` 只有 `bootstrap.ts` 与 `status-policy.ts` 两处）：`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 1218 / 1218；`tests/mvp0` 7 / 7；`tsc --noEmit` 无输出；`tests/contract/package-boundaries.test.js` 8 / 8。与原型的 A5 相比少了环境性的那一条（S9）：导出目录不是 Git 仓库，本工作树里没有这个差异。
- **变异（Batch 2 树上整表）**：M1 12 红（T1–T6、W1、W2、I1×2、I2×2）、M2 2（T4、T6）、M3 2（T4、W1）、M4 3（I2×2、I3）、M5 1（I4）、M6 3（T5、I2×2）、M7 2（I2×2）、M8 1（I4）、M9 1（T6）、M10 1（T3），每条红集合与 D11 一致；每条变异先打出非空 diff，应用前后与 `git show HEAD:<path>` 逐字比较，还原后复跑 38 / 38。Batch 3 提交的树（代码与 Batch 2 相同）上重新导出、整表再跑一次，红集合逐条相同。
- **探针**（本检出 vs base `origin/main@6417d45` 的导出目录）：P2 base `revision 2 -> 3 | entities 5 -> 5`，本分支 `revision 1 -> 1 | entities 5 -> 5`；X2（A2 的片段，`outcome` 用字符串拼接，S12）base `bootstrap threw RangeError | cursor healthy undefined | any view degraded false`，本分支 `bootstrap false unavailable | cursor degraded unavailable | any view degraded true`；TD-020 起点的 SQLite 旧载体触发（`:memory:`，经 `storage.db` 句柄写一条版本为 `'v9'` 的已提交观察，再对同一 `ref` 发规范版本观察）在本分支 `bootstrap false unavailable | cursor degraded unavailable | sync {"degraded":true,"stale":true,"reason":"unavailable"}`。
- **用例回读**（正例与伪造前缀负对照，`vertical-path.md` §2.1 的命令）：chain-bootstrap「重复观察：同一观察经 core 投递」「乱序观察：经 core 先投递新观察」「修订号：相同输入的重复引导」各 `ℹ tests 1`；sync-revision-freshness「存储拒绝：被拒绝的观察让同步结构化失败」`ℹ tests 2`、「客户端时间：冷启动被拒或成功之后被拒」`ℹ tests 1`、「修订号：相同输入的重复引导与重启后」`ℹ tests 2`；伪造前缀全部 `ℹ tests 0`，`ℹ fail 0`，退出码 0。
- **规模**（`node scripts/rule-checks.mjs size origin/main`）：代码桶 273（实现 81：`bootstrap.ts` 71、`queries.ts` 4、`storage.ts` 3、`workspace-read.ts` 3；测试 192），Batch 3 提交时文档桶 605（本计划 502 行加上 A7 与 Batch 3 的补记后略有增加，以 Batch 4 第 3 步的回读为准）；上限 800 / 1300。
- **机器时钟与计划里的时间戳**：本机时钟在 2026-10-08 00:3x–01:0x CST 之间，早于 Progress 里协调者记的 01:20 CST；本节与 Progress 的实现者时间戳取 `date` 的读数，不按计划里的先后顺序重排。

- **A8 对抗验证第 1 轮的处理证据**（2026-10-08，`.worktrees/sync-revision-freshness`，Node v26.10.0；变异与 base 对照都在 `.superpowers/mutations/` 下的 `git archive` 导出目录里做，用完删除；每条变异先打出非空 diff，还原后与 `git show HEAD:<path>` 逐字比较）：
  - **复现**（导出目录 = 处理前的 HEAD，三文件 38 条）：N1（丢掉 `kept` 行修订号）、N3（catch 收窄成 `RangeError`）、N3b（只包住 `commitSync`）、N4 / N5（判定忽略 `planningFields` / `planningStatus`）、N13（不可锚定条目即推进）各为 4 / 5 / 23 / 4 / 4 / 4 行 diff，三文件都读回 `# tests 38 # fail 0`（存活）；N6（判定忽略 `content`）读回 `# fail 1`，只有 T4 一条。
  - **探针**（本检出）：游标 `state` 为 `idle` / `syncing` / `healthy` 时修复前都读回 `{"degraded":false,"stale":false}`（替身与 SQLite 一致），`degraded` / `failed` 读回 `{degraded:true,stale:true,reason}`；修复后 `idle` 读回 `{degraded:true,stale:true,reason:'idle'}`，`syncing` 不变（TD-034）。磁盘错误文字经 `createController(core).commands.bootstrapWorkspace` 与 `applyPlanningStatus` 都原样拒绝（`controller bootstrapWorkspace REJECTS: disk full: …`，S15）。重叠两轮（A 在 `listPlanningItems` 返回后挂起，B 完整引导，放行 A）：替身与 SQLite 都读回 `after B rev 2` 与 `after A rev 3 … has NEWER false`（S16）。
  - **base 对照**：三个测试文件取本分支版本、源码取 `origin/main@6417d45` 的导出目录：64 条里 40 条红、24 条绿；红的 40 条恰是 D11 的 T1–T6、W1、W2、I1–I10 按 Storage 展开，绿的 24 条是未改动的既有用例。
  - **回归**（第 1 轮后的树；**Superseded by A9**）（本分支）：三文件 64 / 64；`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 1244 / 1244；`tests/mvp0` 7 / 7；`./node_modules/.bin/tsc --noEmit` 无输出；`tests/contract/package-boundaries.test.js` 8 / 8；`tests/contract/content-placement.test.js` 与 `plan-facts-consistency.test.js` 9 / 9。
  - **变异整表**（第 1 轮后的树上 M1–M19，三文件共 64 条；红数含两个 Storage；**Superseded by A9**：第 2 轮补 I11 与断言后 M4、M6、M7、M12、M16 的红数变大，并新增 M20–M23）：M1 34、M2 4、M3 18、M4 5、M5 1、M6 5、M7 4、M8 1、M9 1、M10 2、M11 2、M12 2、M13 2、M14 2、M15 2、M16 9、M17 2、M18 2、M19 1，红集合逐条等于 D11 变异表；每条还原后 `cmp` 一致，复跑 `# tests 64 # pass 64 # fail 0`。M2（`before` 只保留本轮输入行）现在还被 I5 的「移除条目」两条杀死，M3 被 I5 的 16 条杀死。
  - **用例回读**（`vertical-path.md` §2.1 的命令，`tests/integration/sync-revision-freshness.test.js`）：「异常：provider 抛出任何值」「观察顺序：经 core 先投递新观察」「修订号：有不可锚定条目的重复引导」「修订号：宿主权威下状态命令写一行」「新鲜度：游标 state=idle」「修订号：标题变化恰好推进一次」「修订号：移除条目恰好推进一次」各读回两行 ✔、`ℹ tests 2`、`ℹ fail 0`，伪造前缀 `ℹ tests 0`。
  - **规模**（第 1 轮后；**Superseded by A9**）（`node scripts/rule-checks.mjs size origin/main`）：代码桶 398（实现 82：`bootstrap.ts` 71、`queries.ts` 5、`storage.ts` 3、`workspace-read.ts` 3；测试 316），文档桶 657；上限 800 / 1300（实现 ≤ 350），`disclosure origin/main` 机械扫描通过，`workflow-check` 无发现，`git diff --check origin/main...HEAD` 无输出，提交正文无关闭关键字。

- **A9 对抗验证第 2 轮的处理证据**（2026-10-08，`.worktrees/sync-revision-freshness`，Node v26.10.0；变异与 base 对照都在 `.superpowers/mutations/` 下的 `git archive` 导出目录里做，用完删除；每条变异先打出非空 diff，还原后与 `git show HEAD:<path>` 逐字比较）：
  - **复现**（导出目录 = 处理前的 HEAD，三文件 64 条）：M20（推进修订号与第二次重盖挪到内容事务提交之后，改用根句柄）、M21（`putReconcileCursor` 挪出事务）、M22（healthy 游标挪出事务）、M23（`SYNC_ROUND_FAILED` 改空串）的 diff 为 12 / 2 / 10 / 2 行，三文件都读回 `64 / 64` 且 0 红（存活）。
  - **探针**（让 `advanceRevision` 在 tx 级与根级都拒绝，同时把一个条目的标题改成 `changed`，引导一次；内存替身与 SQLite 一致）：HEAD 读回 `result false unavailable | rev 1 -> 1 | content changed without revision false`；把 M20 应用到导出目录后读回 `result false unavailable | rev 1 -> 1 | content changed without revision true`（内容已提交、修订号没推进、命令却报失败）。还原后与 HEAD 逐字相同。`git grep -n putSyncCursor -- packages apps`（排除端口与适配器实现）只有 `bootstrap.ts` 两处（事务内 healthy、`fail` 里 degraded），`git grep -n 'SyncState\.\(Idle\|Syncing\)' -- packages apps` 只有 `queries.ts` 的读侧（S23）。
  - **用例**（本分支）：三文件 70 / 70（原 64，新增 I11 的 6 条）。对 base 源码（`origin/main@6417d45` 的导出目录，三个测试文件取本分支版本）：70 条里 46 条红、24 条绿，红的恰是 D11 的 T1–T6、W1、W2、I1–I11 按 Storage 展开，绿的 24 条是未改动的既有用例。
  - **回归**（本分支）：`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 1250 / 1250；`tests/mvp0` 7 / 7；`./node_modules/.bin/tsc --noEmit` exit 0 且无输出；`tests/contract/package-boundaries.test.js` 8 / 8。
  - **变异整表**（最终树上 M1–M23，三文件共 70 条；红数含两个 Storage）：M1 34、M2 4、M3 18、M4 11、M5 1、M6 11、M7 10、M8 1、M9 1、M10 2、M11 2、M12 8、M13 2、M14 2、M15 2、M16 15、M17 2、M18 2、M19 1、M20 2、M21 2、M22 2、M23 10，红集合逐条等于 D11 变异表（M4 / M6 / M7 / M12 / M23 的 I11×6 与 M16 的 I11×6 见 S21）；每条先打出非空 diff，还原后与 `git show HEAD:<path>` 逐字相同，复跑 `70 / 70`。
  - **用例回读**（`vertical-path.md` §2.1 的命令，`tests/integration/sync-revision-freshness.test.js`）：「原子提交：」读回六行 ✔、`ℹ tests 6`、`ℹ fail 0`；「双重故障：连失败都记不下时」读回一行 ✔、`ℹ tests 1`；伪造前缀 `ℹ tests 0`。
  - **规模**（`node scripts/rule-checks.mjs size origin/main`，在本轮提交之后的 HEAD 上）：代码桶 451（实现 82：`bootstrap.ts` 71、`queries.ts` 5、`storage.ts` 3、`workspace-read.ts` 3；测试 369），文档桶 690；上限 800 / 1300（实现 ≤ 350），`disclosure origin/main` 机械扫描通过，`workflow-check` 无发现，`git diff --check origin/main...HEAD` 无输出，三个本轮提交的正文无关闭关键字。

- **A10 对抗验证第 3 轮的处理与最终验收证据**（2026-10-08，`.worktrees/sync-revision-freshness`，Node v26.10.0；变异与 base 对照都在 `.superpowers/mutations/` 下的 `git archive` 导出目录里做，用完删除；每条变异先断言替换恰好命中一处并打出非空 `git diff --no-index -U0`，还原后 `cmp` 与导出时的原文件逐字相同，再复跑三文件全绿）：
  - **复现**（导出目录的实现取最终树、测试文件取处理前的 `ac5cf3da`，三文件 70 条）：第 3 轮验证者的 N2、N3、N1、N7 即本计划的 M24、M25、M26、M27，diff 为 2 / 2 / 2 / 1 行，各读回 `red=0/70`，还原后 70 / 70（存活）；补用例后在最终树上各红 2 条，见下。
  - **用例**（本分支，最终树）：三文件 76 / 76（原 70，新增 I12、I13、I14 各两条）。对 base 源码（`origin/main@6417d45` 的导出目录，三个测试文件取本分支版本）：76 条里 52 条红、24 条绿，红的恰是 D11 的 T1–T6、W1、W2、I1–I14 按 Storage 展开，绿的 24 条是未改动的既有用例。
  - **回归**（本分支）：`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 1256 / 1256；`node --test tests/mvp0` 7 / 7；`./node_modules/.bin/tsc --noEmit` exit 0 且无输出；`tests/contract/package-boundaries.test.js` 8 / 8；`tests/integration/storage-sync-surface.test.js` 12 / 12；`git grep -n advanceRevision -- packages/core/src` 只有 `bootstrap.ts` 与 `status-policy.ts` 两处。
  - **变异整表**（最终树上 M1–M27，三文件共 76 条；红数含两个 Storage）：M1 36、M2 6、M3 18、M4 13、M5 1、M6 15、M7 12、M8 1、M9 1、M10 2、M11 2、M12 10、M13 2、M14 2、M15 2、M16 15、M17 2、M18 2、M19 1、M20 2、M21 4、M22 2、M23 12、M24 2、M25 2、M26 2、M27 2，红集合逐条等于 D11 变异表；每条还原后复跑 76 / 76。N29（`fail` 读修订号失败时吞掉）0 红，是有意不钉的取舍（D11 表后的说明）。
  - **探针**（本检出）：P2 读回 `revision 1 -> 1 | entities 5 -> 5`；X2 从 `docs/product/vertical-path.md` 原样抽出重放，读回 `bootstrap false unavailable | cursor degraded unavailable | any view degraded true`；有绑定而门禁不通过读回 `gate false not_supported | cursor degraded not_supported | reconcile undefined`（S26）；三重故障读回 `REJECTED disk full: <占位路径> | cursor degraded unavailable`，经 controller 同样原文拒绝（S27）；只读 SQLite 读回 `before {"degraded":false,"stale":false} | REJECTED attempt to write a readonly database | after {"degraded":false,"stale":false}`（S29）。
  - **用例回读**（`vertical-path.md` §2.1 的命令，`tests/integration/sync-revision-freshness.test.js`）：「整轮回滚：事务的最后一笔写入」「修订号：快照被清空」「结构化失败：provider 离线」各读回两行 ✔、`ℹ tests 2`、`ℹ fail 0`；「原子提交：」仍读回 `ℹ tests 6`；伪造前缀 `ℹ tests 0`；子 shell 退出码 0。
  - **规模与发布面**（**Superseded by A11**：这里的数字是最终验收提交那一刻的读数，随后又改了索引行与计划，评审读回的文档桶是 731，见 S33）（`node scripts/rule-checks.mjs size origin/main`，在最终验收的提交之后读回）：代码桶 500（实现 86：`bootstrap.ts` 75、`queries.ts` 5、`storage.ts` 3、`workspace-read.ts` 3；测试 414），文档桶 729；规划上限 800 / 1300（实现 ≤ 350）；`disclosure origin/main` 机械扫描通过，`workflow-check` 无发现，`git diff --check origin/main...HEAD` 无输出，本轮提交正文无关闭关键字，作者为 SingularityKChen 的 noreply 地址。

- **A11 评审修复轮的处理证据**（2026-10-08，检出 `fix/sync-revision-freshness` 的工作树根目录 `.worktrees/sync-revision-freshness`，Node v26.10.0；变异与 base 对照都在 `.superpowers/mutations/` 下的 `git archive` 导出目录里做，用完删除；每条变异先断言锚点恰好命中一处并打出非空 `git diff --no-index -U0`，还原后 `cmp` 与导出时的原文件逐字相同，再复跑三文件全绿）：
  - **变基**：`git range-diff backup/sync-revision-freshness-pre-review-rebase~3..backup/sync-revision-freshness-pre-review-rebase origin/main..HEAD` 三个提交逐一为 `=`；变基后、修复前：`tsc --noEmit` exit 0，`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 1365 / 1365。
  - **评审 P2、P3 的复现与探针**（本检出 vs `origin/main@a357ef8` 的导出目录，脚本从标准输入喂给 `node --input-type=module`）：P2 本分支 `revision 1 -> 1 | entities 5 -> 5`，base `revision 2 -> 3 | entities 5 -> 5`；X2（带钩子）本分支 `bootstrap false unavailable msg="同步异常中止，本轮没有提交任何事实；读侧保留最后已知值" | cursor degraded unavailable | any view degraded true | host saw RangeError: sourceVersion 必须是规范载体…`，base `bootstrap threw RangeError | cursor healthy undefined | any view degraded false | host saw (none)`；SQLite 旧载体触发（`:memory:`，经 `storage.db` 写一条版本为 `v9` 的已提交观察，再发规范版本观察，带钩子）本分支 `legacy false unavailable msg="同步异常中止…" | sync {"degraded":true,"stale":true,"reason":"unavailable"} | host saw Error has repairLegacySource=true`，base `legacy threw Error: 已提交版本不是规范载体…`（宿主无出口）。
  - **用例**（本分支）：三文件 87 / 87（原 76，新增 I15×4、I16×2、I17×2、I18×2、I19×1）。对 base 源码（`origin/main@a357ef8` 的导出目录，三个测试文件取本分支版本）：87 条里 63 条红、24 条绿，红的恰是 D11 的 T1–T6、W1、W2、I1–I19 按 Storage 展开，绿的 24 条是未改动的既有用例。
  - **新增变异**（最终树，红集合含两个 Storage）：M28（去掉排序）I15 的行序 ×2；M29（`JSON.stringify` 比较）I15 的键序 ×2——互不重叠，分别证明两道守卫；M30（去掉钩子调用）6（I4、I16×2、I17×2、I19）；M31（钩子抛错不吞）I18×2；M32（交给宿主的不是原异常）6；M33（结构化失败也调用钩子）I17×2；M34（不接住被拒绝的 promise）I18×2；M35（`createContext` 不放进钩子）6；M36（钩子挪到 `fail` 之后）I4。
  - **变异整表**（最终树上 M1–M36，三文件共 87 条；红数含两个 Storage）：M1 40、M2 6、M3 18、M4 21、M5 1、M6 15、M7 19、M8 1、M9 1、M10 2、M11 2、M12 14、M13 4、M14 2、M15 2、M16 19、M17 2、M18 2、M19 1、M20 2、M21 4、M22 2、M23 17、M24 2、M25 2、M26 2、M27 4、M28 2、M29 2、M30 6、M31 2、M32 6、M33 2、M34 2、M35 6、M36 1；红集合逐条等于 D11 变异表（受影响行的新旧数字并列写在表里）；每条还原后复跑 87 / 87。N29 仍有意不钉。
  - **回归**（本分支，最终树）：`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 1376 / 1376；`node --test tests/mvp0` 7 / 7；`./node_modules/.bin/tsc --noEmit` exit 0 且无输出；`node --test tests/contract/package-boundaries.test.js` 8 / 8；`node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js` 9 / 9。
  - **规模与发布面**（观察于 2026-10-08T11:02Z @ 8a4be127，该 head 之后的提交只回填本节与评审记录里的读数、改正自匹配命令的写法，不增减行数；重算命令 `node scripts/rule-checks.mjs size origin/main`，期望代码 ≤ 800、文档 ≤ 1300）：代码桶 670 / 1000（增删之和；实现 111：`bootstrap.ts` 87、`context.ts` 13、`queries.ts` 5、`storage.ts` 3、`workspace-read.ts` 3；测试 559），文档桶 869 / 1500（本计划 729、评审记录 44、ADR-0012 39、`vertical-path.md` 27 等）；规划上限 800 / 1300（实现 ≤ 350）；`node scripts/rule-checks.mjs disclosure origin/main` 机械扫描通过（exit 0；五类目的人工检查另做）；`git diff --check origin/main...HEAD` exit 0，无输出；`node scripts/workflow-check.mjs` no findings（已检查 8 个文件）；`python3 <exec-plan 技能目录>/scripts/lint_execplan.py docs/exec-plan/completed/2026-10-08-sync-revision-freshness.md` 读回 `OK: ExecPlan passed lint checks.`。
  - **归档回读**：`git grep -n 'exec-plan/activ[e]/2026-10-08-sync-revision-freshness'` 读回 0 行；`git grep -c 'exec-plan/completed/2026-10-08-sync-revision-freshness' -- docs` 读回 9 个文件（本计划之外的 8 个：`docs/README.md`、ADR-0012、`docs/adr/README.md`、`release-gates.md`、控制计划、迭代规划、`tech-debt-tracker.md`、`vertical-path.md`）。
- **A12 第二轮评审修复轮的处理证据**（2026-10-08，检出 `fix/sync-revision-freshness` 的工作树根目录 `.worktrees/sync-revision-freshness`，Node v26.10.0；变异、base 对照与 `c155db05` 单独检出都在 `git archive` 的导出目录里做，用完删除；每条变异先断言锚点恰好命中一处并打出非空 `git diff --no-index -U0`，还原后 `cmp` 与导出时的原文件逐字相同，再复跑三文件全绿）：
  - **复现**（评审探针 `hook.mjs`，在 `c155db05` 的导出目录与本检出各跑一遍）：`vm-reject`（钩子返回 `vm.runInNewContext('Promise.reject(…)')`）修复前 `EXIT 1`，本检出命令 2 ms 内返回 `[false,true,"unavailable",固定文案]`，钩子 1 次；`cold-double`（provider 离线 + `putSyncCursor` 拒绝）修复前 `coldHookCount 0`、`hookCountAfterCmd 0`，本检出 `coldHookCount 1`、`hookCountAfterCmd 1`，读侧都是 `idle` 陈旧，命令都以 `disk full …` 拒绝（TD-031 不变）；`never`（永不 resolve 的钩子）两边都在 0–1 ms 内返回；`thenable` 两边都 `leak clean`。
  - **红到绿**（三个本地提交各自的红绿）：补强 `assertRoundFailed` 后 55 / 55 仍绿（实现正确，红在变异）；I18 补三种钩子与 I20 后 57 条里 I18×2 红（栈顶 `reportSyncRoundFailure`，另一个 realm 的拒绝成为未处理拒绝），新增 `diagnostics.ts` 后 57 / 57；I21、I22 与「双重故障」次数更正后 61 条里 5 红（I21×2、I22×2、「双重故障」2 → 3），改 `composeCore` 的 `catch` 后 61 / 61。
  - **用例**（本分支）：三文件 93 / 93（原 87，新增 I20×2、I21×2、I22×2）。对 `origin/main@a357ef8` 的导出目录（三个测试文件取本分支版本）：93 条里 69 条红、24 条绿，红的恰是 D11 的 T1–T6、W1、W2、I1–I22 按 Storage 展开，绿的 24 条是未改动的既有用例。
  - **新增变异**（最终树，红集合含两个 Storage）：M37（评审的 H8）I20×2；M38（评审的 H11）17；M39（评审的 H11c）4，只被字符串与普通对象两种触发杀死；M40 17；M41 I18×2；M42 I18×2，去掉 I18 的 getter 钩子后三文件 57 / 57 全绿（存活），所以该钩子承重；M43 5（I4、I21×2、I22×2）；M44 5；M45 4（I21×2、I22×2）。
  - **变异整表**（最终树上 M1–M45，三文件共 93 条；红数含两个 Storage）：M1 40、M2 6、M3 18、M4 23、M5 3、M6 15、M7 19、M8 3、M9 1、M10 2、M11 2、M12 14、M13 4、M14 2、M15 2、M16 19、M17 2、M18 2、M19 1、M20 2、M21 4、M22 2、M23 17、M24 2、M25 2、M26 2、M27 4、M28 2、M29 2、M30 8、M31 2、M32 10、M33 6、M34 2、M35 12、M36 1、M37 2、M38 17、M39 4、M40 17、M41 2、M42 2、M43 5、M44 5、M45 4；与 A11 相比数字变化的恰是 M4、M5、M8、M30、M32、M33、M35（新用例 I20–I22 加入后多红，写在 D11 变异表对应行），其余逐条不变；红集合逐条等于 D11 变异表；每条还原后复跑 93 / 93，导出目录里改过的七个文件与 `git show HEAD:<path>` 逐字节 `cmp` 一致。M27 的锚点只放在 provider 结构化失败分支（放进 `fail` 本身会连异常中止的轮次一起改，红数变成 19，不是原变异）。N29 仍有意不钉。
  - **探针**（本检出）：P2 `revision 1 -> 1 | entities 5`；X2（带钩子）`bootstrap false unavailable msg="同步异常中止，本轮没有提交任何事实；读侧保留最后已知值" | cursor degraded unavailable | any view degraded true | host saw RangeError: sourceVersion 必须是规范载体…`。
  - **回归**（本分支，最终树）：`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 1382 / 1382；`node --test tests/mvp0` 7 / 7；`./node_modules/.bin/tsc --noEmit` exit 0 且无输出；`node --test tests/contract/package-boundaries.test.js` 8 / 8；`node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js` 9 / 9；第一轮的 #220 / #199 验收：`node --test tests/integration/storage-sync-surface.test.js tests/e2e/chain-bootstrap.test.js tests/e2e/workspace-read-assembly.test.js tests/integration/sync-revision-freshness.test.js` 105 / 105。`c155db05` 单独检出：`tsc --noEmit` exit 0，全量 1375 / 1376，唯一失败是 S9 的环境性用例（导出目录不是带历史的仓库，同一用例在工作树里通过）。
  - **规模与发布面**（观察于本回填提交，提交无法记录自身的 SHA，以 PR 回读的 head 为准；之后的提交只替换本行里的数字，不增减行数；重算命令 `node scripts/rule-checks.mjs size origin/main`，期望代码 ≤ 800、文档 ≤ 1300）：代码桶 787 / 1000，文档桶 945 / 1500；`node scripts/rule-checks.mjs disclosure origin/main` 机械扫描通过（exit 0；五类目的人工检查另做）；`git diff --check origin/main...HEAD` exit 0，无输出；`node scripts/workflow-check.mjs` no findings（已检查 8 个文件）；`python3 <exec-plan 技能目录>/scripts/lint_execplan.py docs/exec-plan/completed/2026-10-08-sync-revision-freshness.md` 读回 `OK: ExecPlan passed lint checks.`。
  - **归档回读**：`git grep -n 'exec-plan/activ[e]/2026-10-08-sync-revision-freshness'` 读回 0 行；`git grep -n 'PR #290 的修复会[话]中批准' -- docs` 读回 0 行。
- **A13 第三轮评审修复轮的处理证据**（2026-10-08，检出 `fix/sync-revision-freshness` 的工作树根目录，Node v26.10.0；变异与 base 对照都在 `git archive` 的导出目录里做，用完删除；每条变异先断言锚点恰好命中一处，`cmp` 与 `git diff --no-index -U0` 都显示与导出时的原文件有差异，还原后 `cmp` 逐字节相同，再复跑三文件全绿）：
  - **复现**（评审探针 `cold-never.mjs`）：HEAD 读回 `composeCore settled | hook calls 1`；H8c 下读回 `composeCore HUNG (>1s) | hook calls 1`。
  - **红到绿**：加用例前，`git archive 47f76c7c` 的导出目录里应用 H8c：三文件 93 / 93，`tests/contract tests/integration tests/e2e` 1382 条里 1381 绿，唯一失败是 S9 的环境性用例（`issue-policy` 的 CLI 用例）；加用例后同一变异 95 条里 I20b×2 红（`AssertionError: 组合期的水合 catch 是诊断出口的第二个调用点…`）、其余 93 绿；还原三个源文件后 95 / 95。
  - **用例**（本分支）：三文件 95 / 95（原 93，新增 I20b×2）。对 `origin/main@a357ef8` 的导出目录（三个测试文件取本分支版本）：95 条里 71 条红、24 条绿，红的恰是 D11 的 T1–T6、W1、W2、I1–I22 与 I20b 按 Storage 展开，绿的 24 条是未改动的既有用例。
  - **重测**（最终树，三文件共 95 条；红数含两个 Storage）：M46 2（I20b×2）；M37 4（I20×2、I20b×2；原 2）；M43 7（原 5）；M44 5；M45 6（I21×2、I22×2、I20b×2；原 4）；M8 5（原 3）；M33 8（原 6）；M35 14（原 12）；不变的有 M30 8、M31 2、M32 10、M34 2、M36 1、M41 2、M42 2。受影响行的新旧数字并列写在 D11 变异表里；每条还原后复跑 95 / 95。M45 的锚点只放在 provider 结构化失败分支（放进 `fail` 本身会连异常中止的轮次一起改，I4 也变红，共 7，不是原变异）。未重测的 M1–M7、M9–M29、M38–M40：它们改的是修订号规则、提交路径、异常中止分支的结果对象与读侧，新用例的一轮不抛、显式命令以拒绝结束，走不到这些分支，红集合不会变；本轮没有重放它们。
  - **回归**（本分支，最终树）：`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 1384 / 1384；`node --test tests/mvp0` 7 / 7；`./node_modules/.bin/tsc --noEmit` exit 0 且无输出；`pnpm run boundaries` 8 / 8。
  - **规模与发布面**（观察于本回填提交，提交无法记录自身的 SHA，以 PR 回读的 head 为准；之后的提交只替换本行里的数字，不增减行数；重算命令 `node scripts/rule-checks.mjs size origin/main`，期望代码 ≤ 800、文档 ≤ 1300）：代码桶 800 / 1000，文档桶 987 / 1500；`node scripts/rule-checks.mjs disclosure origin/main` 机械扫描通过（exit 0；五类目的人工检查另做）；`git diff --check origin/main...HEAD` exit 0，无输出；`lint_execplan.py` 读回 `OK: ExecPlan passed lint checks.`。

## Bottom Change Note

Change Note (2026-10-08 00:40 CST)：创建计划。三份 PR-A 设计稿经定稿评审裁决：变化检测采用写后重读 + 深比较 + 整批重盖；错误语义采用整轮 catch 与固定 `unavailable`，双重故障拒绝；游标缺失读作陈旧；写对账时刻但不改 wire 与 client，`lastUpdatedAt` 的现行定义由用例钉住；规则写进 ADR-0012（Proposed）。原型与变异在导出目录实测，结果见 `Artifacts and Notes`。

Change Note (2026-10-08 01:25 CST)：处理 Batch 4 对抗验证第 1 轮的 9 条发现。判别力缺口（P2×3）用 I5–I10 与变异 M11–M19 补齐，idle 游标读作陈旧（一行实现）；命令层泄漏面与重叠两轮引导登记为 TD-031 / TD-034（启用 TD-034）；ADR-0012 第 7 条、R1 第 7、8 行与矩阵 13.4、13.8 同步；#220 验收 3 的解释点单列为待人类确认。证据见 A8。

Change Note (2026-10-08 02:05 CST)：处理 Batch 4 对抗验证第 2 轮的 5 条发现（P2×1、P3×4，实现零改动）。事务边界的判别力缺口用 I11（3 个注入点 × 2 个 Storage）与变异 M20–M22 补齐，固定失败文案用 `assertRoundFailed` 的非空断言与 M23 钉住；矩阵 13.4 补双重故障残余（TD-031）；计划里的计数、TD-034 的冲突决策、控制计划两处 base 事实改正；`syncing` 游标维持 TD-034。D10、D11（46 条用例、M1–M23）、V9、V16、S20–S24 与 A9 同步。

Change Note (2026-10-08 02:35 CST)：最终验收者处理 Batch 4 对抗验证第 3 轮的 7 条发现（P2×1、P3×6，实现零改动）并做行为不变的重构。整轮回滚的判别力缺口用 I12 与 M24、M25 补齐；清空快照与结构化失败的对账时刻用 I13、I14 与 M26、M27 钉住；D3 表门禁行订正并补三重故障一行；13.8 结论词回到词表；只读 SQLite 上的 #199 残余写进矩阵 13.4 与 TD-031。D7、D10、D11（52 条用例、M1–M27）、V2、V9、V16、Progress、S25–S29、Decision Log、Outcomes 与 A10 同步。

Change Note (2026-10-08 CST，评审修复轮与归档)：处理 PR #290 的 MMP 评审（APPROVED，2 × P2、3 × P3）与人类伙伴的四项裁决。分支变基到 `origin/main@a357ef8`；新增可选的宿主诊断出口 `diagnostics.syncRoundFailed`（D12，`context.ts` 进入文件集，Global Constraints 与相关就地订正已标 Superseded）；排序与深比较守卫补 I15（M28、M29，S30）；ADR-0012 删去仓库外的「协调者契约」措辞并采纳为 Accepted；#220 验收 3 按裁决保留 `Closes #220`、读侧显示归 #229（D5、TD-032）；计划状态、索引与规模数字改为回读命令加观察时刻与 head（S33）；计划移到 `docs/exec-plan/completed/` 并同步全部引用。新增 Batch 5、V17–V19、S30–S33、D12、A11；D10、D11（63 条用例、M1–M36）、变异表受影响行的红数、Decision Log、Outcomes 同步。

Change Note (2026-10-08 CST，第二轮评审修复轮)：处理 PR #290 第二轮评审（1 × P2、5 × P3）与人类伙伴对「诊断出口接线的承接 issue」的裁决（#132）。钩子返回值改为 Promise 构造器吸收、仍不等待，调用点抽成内部模块 `diagnostics.ts`（D12、S34）；`composeCore` 的水合 `catch` 在吞掉之前把记录失败的拒绝交给同一个钩子，`CoreDiagnostics` 注释写明脱敏义务（D12、S36）；`assertRoundFailed` 经 controller 发命令并对两层结果做整体泄漏检查（S35）；合并顺序里「接线」的前提更正（S37），TD-030 的下一步指向 #132；ADR-0012 批准出处三处统一；Batch 5 第 10 步与回滚、Progress 末项更正为实际三提交形态。新增 Batch 6、S34–S37、A12，Decision Log 7 行；D10、D11（69 条用例、M1–M45）、变异表受影响行的红数、V16、V17、Outcomes 同步。

Change Note (2026-10-08 CST，第三轮评审修复轮)：处理 PR #290 第三轮评审（1 × P3，实现零改动）。`composeCore` 水合 `catch` 这个诊断出口的调用点没有「不等待钩子」的判别用例，补 I20b（两个 Storage）并把评审的 H8c 编为 M46（S38）；D10 拆成两行各写各的用例，不再需要过渡性的措辞收窄。新增 Batch 7、S38、A13，Decision Log 1 行；D10、D11（71 条用例、M1–M46）、变异表受影响行的红数（M8、M33、M35、M37、M43、M45）、V16、V17、Outcomes 同步。
