# 同步修订号与结构化同步失败 ExecPlan

> 状态：Active。Batch 0（设计定稿、本计划、ADR-0012 Proposed、索引）已完成；Batch 1–4 未开始。
> 创建：2026-10-08 CST；规范：`PLANS.md`（全部强制章节；另含本仓库计划 lint 要求的 `Concrete Steps` 与 `Artifacts and Notes`）。
> 范围：一个 PR 同时关闭 #220（业务修订号只随已提交内容变化推进）与 #199（Storage 拒绝等异常变成结构化同步失败）。只改 `packages/core` 的同步写者与新鲜度读取，外加两处端口 / client 注释；不改 Storage 端口签名、适配器、迁移、wire 形状与 client 行为。
> 关联：epic #216 的 Batch 2E（控制计划 `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`）；规则正文 `docs/adr/ADR-0012-business-revision-advances-only-on-content-change.md`（Proposed）。
> 执行上下文：检出 `fix/sync-revision-freshness` 的工作树根目录（`.worktrees/sync-revision-freshness`，起点 `origin/main@6417d45`，依赖已装）。下文所有命令都在这个目录运行；`gh` 一律带 `-R SingularityKChen/harness-projects`。
> 上游输入：#199、#220 的正文与评论；`docs/architecture/release-gates.md` §2.1.1；`docs/product/vertical-path.md` §2.1；ADR-0003；`docs/exec-plan/tech-debt-tracker.md` 的 TD-020、TD-022、TD-023、TD-024；协调者 2026-10-08 的跨 PR 契约 K1–K8 与三份独立设计稿（α 最小闭环、β 系统与不变量、γ 同类工具调研）。契约与设计稿是运行态文件，不随仓库分发；本计划只重述其中仍然有效的结论，冲突时以本计划为准。

## Purpose / Big Picture

完成后：

1. **修订号只表示业务变化**。相同输入的引导（含重启后组合期的那次引导、同一观察重复投递、更旧的观察晚到）不推进业务修订号，也不重写任何行的修订号；已提交的规划快照有新增、修改或移除时恰好推进一次。watch 对内容不变的刷新不再发 delta，客户端不再整表重渲染。
2. **刷新只记新鲜度**。内容不变的成功刷新把同步游标写成 healthy，并把 `reconcile_cursor.lastReconciledAt` 写成本轮时刻（ADR-0003 第 3 条的「上次全量对账时刻」第一次有写者）。
3. **未提交的一轮不再裸抛**。从读取到提交之间的任何异常（Storage 拒绝观察、provider 抛出、编程错误）都变成结构化失败：命令返回 `{ ok: false, degraded: true, error.code: 'unavailable' }`，游标 degraded 带错误码，读侧每行标陈旧，修订号与对账时刻不动，原异常文字不进命令结果。
4. **从未成功同步过的工作区不报新鲜**：同步游标缺失读作 `{ degraded: true, stale: true, reason: 'idle' }`。
5. **规则可被兄弟 PR 引用**：ADR-0012（Proposed）写明修订号规则，交付写者（#221、#222）据此不推进修订号。

最小成功证据（在本分支的工作树根目录）：P2 读回 `revision 1 -> 1 | entities 5 -> 5`（base 为 `2 -> 3`）；重写后的 X2 读回 `bootstrap false unavailable | cursor degraded unavailable | any view degraded true`（base 为 `bootstrap threw RangeError | cursor healthy undefined | any view degraded false`）；`Design / Spec` 的 D11 列出的 14 条用例在 base 上全红、在本分支上全绿；变异表 M1–M10 每条都有用例变红。

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
- `packages/core/src/context.ts`：`composeCore`（:129–148）用 `catch {}` 吞掉组合期引导的异常，注释说「降级交给游标状态表达」，但 base 上这条路径不写游标。本计划不改这个文件。
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

`bootstrapWorkspace` 在门禁之后把「读观察 → 读项目 → 读条目 → 提交」收进 `syncRound`，外面一层 `try { … } catch { return fail(…, unavailable, 固定文案) }`；provider 的结构化失败仍走原来的 `fail`。`fail` 本身不吞异常：双重故障时以游标写入的错误拒绝。

| 情形 | 命令结果 `BootstrapResult` | 同步游标 | `getPlanningSync()` | 业务修订号 | 对账时刻 |
|---|---|---|---|---|---|
| 提交，快照内容变化 | `ok: true`，`revision` = 推进后的值 | healthy（有不可锚定条目时带 `permission_denied`） | fresh（带缺口码时 `degraded: true, stale: false`） | +1 | `context.clock()` |
| 提交，快照内容不变 | `ok: true`，`revision` = 当前值 | 同上 | 同上 | 不变 | `context.clock()` |
| provider 结构化失败 | `ok: false, degraded: true`，`error` = provider 码映射 | degraded + 该码 | `{ degraded: true, stale: true, reason: 该码 }` | 不变 | 不变 |
| 任何异常（Storage 拒绝、provider 抛出、编程错误） | `ok: false, degraded: true`，`error.code = 'unavailable'`，`error.message = SYNC_ROUND_FAILED` | degraded + `unavailable` | `{ degraded: true, stale: true, reason: 'unavailable' }` | 不变 | 不变 |
| 双重故障 | Promise 以游标写入的错误拒绝 | 不变（缺失或保持原值） | 游标缺失时 `{ degraded: true, stale: true, reason: 'idle' }`；原为 healthy 时仍报 fresh（TD-031） | 不变 | 不变 |
| 门禁不通过或没有规划绑定 | 与 base 相同 | 不写 | 与 base 相同 | 不变 | 不变 |

`SYNC_ROUND_FAILED` 是固定安全文案（建议：`同步异常中止，本轮没有提交任何事实；读侧保留最后已知值`），不含驱动文字、SQL、版本值或堆栈：`RangeError` 的消息里带着 provider 给的版本值，这条消息会经 controller 的命令结果发给 client。

**裁决**：采纳 α。放弃 β 的「`StorageInputError` 透传 `e.failure`」：今天同步路径上抛不出 `StorageInputError`（它只用于 `putExecutionContext`），这个分支是没有用例能触达的死代码。放弃 γ 的「为观察拒绝新增类型化 `StorageInputError`（`invalid_input`），其余异常尽力标降级后原样重抛」：重抛违反协调者契约 K2（任何异常都转成结构化失败、绝不裸抛）；类型化拒绝要改端口、两个适配器与共享拒绝矩阵（约 +45 行实现），#199 的验收只要求「带错误码」。永久拒绝与暂时故障同码的代价登记为 TD-030。

**K2 的边界**：K2 覆盖「从读取到提交」的路径。双重故障发生在记录失败本身，此时返回 `ok: false, degraded: true` 会让调用方以为降级已经落账，而读侧仍可能报 fresh；本计划让它拒绝（响亮失败），冷启动时由 R-FRESH 兜住，非冷启动的残余登记为 TD-031。这是对 K2 的解释，已写进 `Decision Log`，可由协调者或人类推翻。

### D4 游标缺失读作陈旧

采纳 α、β（放弃 γ 的保持 fresh）：「没有任何成功证据」不得读成新鲜，这是 fail closed 的默认值，只改 `queries.ts` 一行。修复后，经 `composeCore` 装配的工作区游标缺失只发生在冷启动的双重故障（组合期引导成功写 healthy、失败写 degraded），所以它有判别用例（I4 用 Proxy 让第二个事务与游标写入都拒绝）。原型在 base 的 contract / integration / e2e / mvp0 全量上没有打破任何既有用例（`Artifacts and Notes` A5）。

### D5 新鲜度通道：写 `reconcile_cursor`，不改 wire 与 client

- **写对账时刻**（采纳 β、γ 的这一半）：`commitSync` 在同一事务里 `putReconcileCursor({ workspaceId, lastReconciledAt: context.clock() })`。它保护 #220 验收 3「刷新记录新鲜度」在「healthy → healthy」时的可判定性：没有它，内容不变的刷新在 Storage 里不留任何痕迹（游标本来就是 healthy）；它也是 ADR-0003 第 3 条定义过、端口与两个适配器都已实现、却从无写者的事实。实现 1 行。
- **不把它带上 wire、不改 client 的确认规则**（放弃 β 的 Batch 3）。`lastUpdatedAt` 的定义（「接受一帧宿主判定为当前值的帧的时刻；idle poll 不推进」）一个字不改；base 上内容不变的刷新会推进它，靠的是 P2 产生的伪 delta。修复后它不再前进，这是定义本身的结果，不是悄悄改含义。本计划用两步把它钉住：W2 的末段断言「恢复之后再刷新一次，poll 为 idle、修订号不变、`lastUpdatedAt` 仍是恢复时刻」；`packages/client/src/workspace-read.ts` 的注释写明这一点。把对账时刻暴露给页面由 #229 决定、在 #218 的单次 summary 之上实现（TD-032）。理由：β 的方案要改 `SyncSummary`、wire 头、client 的确认规则与约 6 处 `SyncSummary` 深比较，并与 #218 正要改写的两次游标读（TD-024）撞在同一处。
- #199 评论 2 的建议验收（失败不推进 `lastUpdatedAt`）由 I3 直接覆盖，与 TD-024 的撕裂读无关：I3 的失败帧整表 degraded、每行也 degraded。

### D6 规则落点

修订号规则写进 `docs/adr/ADR-0012-business-revision-advances-only-on-content-change.md`（Proposed，采纳权在人类），条款编号供兄弟 PR 与代码注释引用；`packages/capabilities/src/storage.ts` 的 `advanceRevision` 注释只加一句指向 ADR-0012，不复述条文。理由：规则是 controller watch、client 续传与 #218 代际共同依赖的接口语义，推翻它要重做已写好的代码，符合 `docs/adr/README.md` 的 ADR 判据；兄弟 PR（#221、#222）需要稳定的引用点。放弃「端口注释 + ExecPlan」：ExecPlan 归档后不是规则的自然落点，端口注释承载不了 Rejected 与 Consequences。

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

    // bootstrapWorkspace：门禁原样；之后
    const bindingId = binding.ref.bindingId
    let round: ProviderResult<BootstrapResult>
    try { round = await syncRound(context, bindingId, planning) }
    catch { return fail(context, bindingId, projectError(ProjectErrorCode.Unavailable, SYNC_ROUND_FAILED)) }
    return round.ok ? round.value : fail(context, bindingId, toProjectError(round.error))
    // syncRound：原 :57–62 的四步；provider 失败 return providerErr(x.error)，成功 return providerOk(await commitSync(...))

`commitSync` 的事务内顺序（全部用 `tx`，不得用根句柄 `context.storage`）：

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
| 写后重读 + 深比较才推进 | #220 验收 1、2；R1 第 7 条；2E | T1、T2、T3、T4、I1、W1、W2 | M1 |
| 比较整个工作区读回（不只比本轮输入行） | 移除也是变化（#220 验收 2） | T4 | M2（同时杀死 T6） |
| 比较整个工作区读回（不只比本轮写入后的行） | #202 残留不被误判 | T6 | M9 |
| 推进时整批重盖 | ADR-0012 第 2 条；`revisionOf` 兜底 | T4、W1 | M3 |
| 写对账时刻 | #220 验收 3 | T5、I2 | M6 |
| 整轮 catch 转结构化失败 | #199 验收 1、2；#199 评论 2；K2 | I2、I3 | M4 |
| 固定文案、不转发原文 | K2；wire 不泄漏 provider 数据 | I2 | M7 |
| 双重故障拒绝 | D3 的 K2 边界 | I4 | M8 |
| 游标缺失读作陈旧 | #199 评论 2 的冷启动面（双重故障下） | I4 | M5 |
| Storage 拒绝更旧观察，经 core 观察 | R1 第 8 条；2E「较旧观察不能覆盖较新快照」 | T3 | M10 |

### D11 测试计划（全部在 base 上实测为红、在原型上为绿）

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
| I4 | 同上 | `双重故障：连失败都记不下时命令拒绝，从未成功的工作区读作陈旧而不是新鲜` | 游标缺失读作 fresh |

各用例的构造与断言见 `Plan of Work` 的步骤；关键辅助代码见 `Concrete Steps` C3。I1、I2 各按两个 Storage 注册，前缀回读为 2。

**变异表**（在 `git archive` 导出目录里逐条应用，规程见 `Concrete Steps` C4；原型上的实测结果见 `Artifacts and Notes` A4）：

| 编号 | 文件 | 变异 | 期望变红 |
|---|---|---|---|
| M1 | `bootstrap.ts` | 判定改为恒推进（`if (true \|\| !sameProjections(…))`） | T1–T6、W1、W2、I1×2、I2×2（共 12） |
| M2 | `bootstrap.ts` | `before` 只保留本轮输入行再比较 | T4、T6 |
| M3 | `bootstrap.ts` | 推进后不重写行（删第二次 `replacePlanningProjections`） | T4、W1 |
| M4 | `bootstrap.ts` | catch 改为 `catch (error) { throw error }`（撤掉翻译，#199 验收 2 的注入实验） | I2×2、I3 |
| M5 | `queries.ts` | 游标缺失改回 fresh | I4 |
| M6 | `bootstrap.ts` | 删 `putReconcileCursor` | T5、I2×2 |
| M7 | `bootstrap.ts` | 失败文案改为 `String((error as Error).message)` | I2×2 |
| M8 | `bootstrap.ts` | `fail` 的游标写入追加 `.catch(() => undefined)` | I4 |
| M9 | `bootstrap.ts` | `after` 只保留本轮输入行再比较 | T6 |
| M10 | `packages/providers/fake/src/storage.ts` | `recordObservation` 删掉「更旧版本返回 false」那一行 | T3 |

## Global Constraints

- 保持 `AGENTS.md` §1.1 七条不变量与依赖方向；不新增包间依赖；`packages/client` 不引入 React。
- 不改 Storage 端口签名、两个适配器的行为、SQLite 迁移、wire 形状、client 行为；`packages/core/src/context.ts`、`status-policy.ts`、`registry.ts`（#219 的分支在改）、`chain-facts.ts` / `delivery.ts` / `relations.ts`（#221 / #222 的分支在改）不动。
- MMP 之前不写兼容层；不为压规模删判别性断言。
- 原异常文字（驱动文字、SQL、provider 给的版本值、堆栈）不得进入 `BootstrapResult.error.message` 与 wire。
- 规模：代码桶 ≤ 800（实现 ≤ 350），文档桶 ≤ 1300（规划上限，`node scripts/rule-checks.mjs size origin/main`）；CI 硬门 1000 / 1500。
- 不提交本机绝对路径；不改 git config（作者用仓库现有身份，提交前 `git log -1 --format='%an <%ae>'` 核对）；不直接推 `main`、不合并 PR。
- 人类专属：ADR-0012 的采纳、Project `Status` 与 `blocked-by` / `blocking`、改写 issue 正文（含 #134 收窄）。agent 只起草，外部写入前用一句可批准的陈述直接问人类。
- 技术债务编号只用 TD-030–TD-034；`docs/exec-plan/tech-debt-tracker.md` 手工追加，不用债务更新脚本（它会抹掉既有条目）。

文件集合（只在此处声明；其余章节提到时写「见 `Global Constraints`」）：

| 区域 | 文件 | 批次 |
|---|---|---|
| core | `packages/core/src/bootstrap.ts` | 1、2 |
| core | `packages/core/src/queries.ts`（`syncSummary` 一行） | 2 |
| 端口注释 | `packages/capabilities/src/storage.ts`（`advanceRevision` 指向 ADR-0012；`recordObservation` 注释改写 #199 的落点） | 1、2 |
| client 注释 | `packages/client/src/workspace-read.ts`（`lastUpdatedAt` 注释） | 2 |
| 测试 | `tests/e2e/chain-bootstrap.test.js`、`tests/e2e/workspace-read-assembly.test.js`、`tests/integration/sync-revision-freshness.test.js`（新） | 1、2 |
| 规则与索引 | 本计划、`docs/adr/ADR-0012-business-revision-advances-only-on-content-change.md`（新）、`docs/adr/README.md`、`docs/README.md` | 0 |
| 证据回填 | `docs/product/vertical-path.md`（简称表、第 3、13、13.4、13.8 行、X2、更新说明段）、`docs/architecture/release-gates.md`（§2.1.1 第 7、8 行与汇总、观察更新一行）、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`（P2 观察、Progress 的 2E）、`docs/exec-plan/completed/2026-10-07-iteration-5-6-planning.md`（D6 表 #220 + #199 行的依赖格）、`docs/exec-plan/tech-debt-tracker.md`（TD-020 转 Resolved，新增 TD-030–TD-033） | 3 |

## Plan of Work

每批遵循：先写红用例并确认失败集合与本节一致 → 改实现 → 全绿 → 跑该批变异 → 本地提交。提交格式 `<type>(<scope>): <中文摘要>`，正文写原因，尾注只写 `Refs #220` / `Refs #199`（提交正文不写关闭关键字），末行加实现者自己的 `Co-Authored-By`。

### Batch 0 · 设计定稿（已完成）

**最小闭环**：三份设计经裁决收敛为本计划与 ADR-0012（Proposed），索引可达。
**涉及文件**：本计划、ADR-0012、`docs/adr/README.md`、`docs/README.md`。
**验证**：`python3 <exec-plan 技能目录>/scripts/lint_execplan.py docs/exec-plan/active/2026-10-08-sync-revision-freshness.md`（期望 `OK: ExecPlan passed lint checks.`）；`grep -c '^## ' docs/exec-plan/active/2026-10-08-sync-revision-freshness.md`（期望 15）。
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
2. 跑红：`node --test-reporter=spec tests/e2e/chain-bootstrap.test.js tests/e2e/workspace-read-assembly.test.js tests/integration/sync-revision-freshness.test.js`。期望失败集合恰为 T1–T6、W1、W2、I1×2（10 条），其余全绿。多红或少红都先停下查原因，写进 `Surprises & Discoveries`。
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
2. 跑红：`node --test-reporter=spec tests/integration/sync-revision-freshness.test.js`，期望恰为 I2×2、I3、I4 四条失败（I1 仍绿）。
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
   - X2 片段：把 `planning.emitObservation({ … sourceVersion: 'vé' })` 一行换成 `planning.state.observations.push({ ...planning.state.observations[0], dedupeKey: 'poison-1', sourceVersion: 'vé' })`，`outcome` 改为 `` `${r.ok} ${r.error?.code}` ``，输出加 `cursor.lastErrorCode`（即 `Artifacts and Notes` A2 的片段）；观察行写「修复前（base）`bootstrap threw RangeError | cursor healthy undefined | any view degraded false`；本分支 `bootstrap false unavailable | cursor degraded unavailable | any view degraded true`」；原观察行保留并标「Superseded by 本片段的新触发（2026-10-08，#199）」。
   - 在「第 4、5 行的 #178 订正」段之后加一段「第 3、13、13.4、13.8 行与 X2 更新于 2026-10-08（#199、#220）」：说明在检出 `fix/sync-revision-freshness` 的工作树根目录按回读命令逐条回读了本次新增的引用（各读回 `ℹ tests 1`，sync-revision-freshness 的「存储拒绝」前缀为 2，伪造前缀读回 `ℹ tests 0`），X2 在同一检出上重放；其余各行仍是上文基线。
2. `docs/architecture/release-gates.md` §2.1.1：
   - 第 7 行：断言用例补 chain-bootstrap「修订号：相同输入的重复引导」「重复观察：同一观察经 core 投递」与 sync-revision-freshness「修订号：相同输入的重复引导与重启后」；层写「core 入口（内存替身与 SQLite）」；变异证据写 M1（恒推进）使三条变红、还原后复绿；缺口格写「P2 在本分支读回 `revision 1 -> 1 | entities 5 -> 5`」；结论「已断言（core 入口；内存替身与 SQLite）」，原「反例（#220）」保留并标 Superseded。
   - 第 8 行：断言用例补 chain-bootstrap「乱序观察：经 core 先投递新观察」；变异证据写 M10（替身接受更旧版本）与 M1 各使它变红；结论「已断言（core 入口：内存替身；端口：两适配器）」，原结论保留并标 Superseded。
   - 汇总行改为「已断言 2、部分 5、反例 3」，原句保留并标 Superseded；§2.1 末尾的「观察更新」后追加一行「观察更新（2026-10-08，#220 / #199）：第 7、8 行升为已断言，见 §2.1.1」。
3. 控制计划 `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`：P2 的观察行后追加「Superseded by #220 修复（2026-10-08，`fix/sync-revision-freshness`）：读回 `revision 1 -> 1 | entities 5 -> 5`」；Progress 的「Batch 2」条目下加一条子项「2E（#199 #220）在 `fix/sync-revision-freshness` 实现，计划 `docs/exec-plan/active/2026-10-08-sync-revision-freshness.md`；合并状态以 PR 回读为准」。
4. 迭代规划 `docs/exec-plan/completed/2026-10-07-iteration-5-6-planning.md` D6 表「#220 + #199（一个 PR）」行的依赖格追加「Superseded by `docs/exec-plan/active/2026-10-08-sync-revision-freshness.md` Decision Log（2026-10-08）：本 PR 与 #219 都不改 `context.ts`，先后约束解除」。
5. `docs/exec-plan/tech-debt-tracker.md`（手工编辑）：TD-020 行移到 `Resolved Items`，状态改 Resolved，下一步列末尾追加「已解决（2026-10-08，`fix/sync-revision-freshness`）：X2 改用可移植触发重写并在本分支 head 重放；TD-020 起点的 SQLite 旧载体触发在 `:memory:` 上复现同一修复后结果；证据见该分支计划的 `Artifacts and Notes`」。在 `Open Items` 表末追加下列四行（全文，日期列 `2026-10-08`，状态 Open，ExecPlan 列 `docs/exec-plan/active/2026-10-08-sync-revision-freshness.md`，分支列 `fix/sync-revision-freshness`，记录者列「#199 / #220 实现者（依据定稿评审）」；以下按「子系统 \| 简述 \| 延期理由 \| 遗留影响 \| 下一步」给出其余五列）。TD-034 不使用。
   - **TD-030** \| Core 同步（`packages/core/src/bootstrap.ts`）与存储端口（`recordObservation`） \| 未提交的一轮同步只有一个错误码：Storage 拒绝观察（非规范载体、SQLite 账本里的旧载体）、provider 抛出与编程错误都报 `unavailable`（恢复动作 retry）与固定文案，原异常既不进 wire 也没有诊断出口 \| #199 只要求「游标 degraded 带错误码」；类型化拒绝要扩 `StorageInputError`（TD-023 的泛化）、改两个适配器与共享拒绝矩阵，约 +45 行实现，本 PR 没有按结构区分这些失败的调用方 \| 需要人工修库的永久拒绝（如 `LEGACY_COMMITTED_VERSION_MESSAGE` 所指的旧载体）与暂时故障在命令结果与读侧同形，#134 的调度会对永久拒绝反复重试；排障只能复现 \| #134 设计退避、或页面需要「请修库」类恢复提示时：把 `recordObservation` 的已知输入拒绝收进 `StorageInputError`（`operation` 扩成联合，`invalid_input` / 恢复 `none`），core 的同步 catch 透传 `error.failure`，与 TD-023 同批；同时给宿主一个不进 wire 的诊断出口
   - **TD-031** \| Core 同步（`bootstrap.ts` 的 `fail`）与读侧（`queries.ts` 的 `syncSummary`） \| 双重故障：一轮没有提交、连 degraded 游标也写不进时，`bootstrapWorkspace` 以游标写入的错误拒绝；若此前游标是 healthy，读侧仍报 fresh，client 重连拿到的基线仍被判为当前值 \| 进程内「失败未落账」覆盖层是第二个事实源，要先定义它与持久游标的先后与清除；冷启动已由「游标缺失读作陈旧」兜住（sync-revision-freshness「双重故障」用例）；现有适配器关库后读写都失败，不会静默报 fresh \| 只在「写失败、读成功」的存储故障（磁盘满、只读文件系统、长时间 busy）且此前同步成功过的工作区出现：命令调用方看到拒绝，读侧却显示新鲜 \| 出现第一个「只写失败」的真实故障面（SQLite `SQLITE_FULL` / `SQLITE_READONLY`）或宿主健康信号（#132）时：core 进程内记「最近一次失败未落账」，`syncSummary` 读到它报 degraded，下一次成功提交时清除；把「双重故障」用例扩成「先成功、再双重故障」
   - **TD-032** \| Core 查询、controller wire 与 client（`packages/core/src/queries.ts`、`packages/controller/src/wire.ts`、`packages/client/src/sync.ts`） \| `reconcile_cursor.lastReconciledAt` 只有写者（规划同步成功提交时）没有读者：`getPlanningSync`、wire 头与 client 都不暴露；client 的 `lastUpdatedAt` 仍是「接受一帧宿主判定为当前值的帧的时刻」，内容不变的成功刷新不产生帧，所以它不前进（workspace-read-assembly「metadata：同 revision 降级」用例钉住）；换 Planning 源（#202）后、新源首次成功之前，对账时刻仍是旧源的 \| 暴露它要改 #178 的确认规则、wire 形状与约 6 处 `SyncSummary` 深比较，并与 #218 正在合并的两次游标读（TD-024）撞在同一处 \| 页面上的「最后更新时间」在手动刷新确认「内容没变」之后不移动，用户可能以为刷新没发生；偏差方向保守，不会把旧值说成新值 \| #229 决定抽屉的「最后更新时间」显示什么；若要宿主对账时刻：在 #218 的单次 summary 里加 `reconciledAt`，controller 只放进整表头 `source`，client 在「整表 fresh 且 `reconciledAt` 前进」时推进 `lastUpdatedAt`，补「内容不变的刷新推进 lastUpdatedAt、修订号不变」的用例，并处理 #202 换源后的旧时刻
   - **TD-033** \| Core 同步与 controller wire（`packages/core/src/bootstrap.ts`、`packages/controller/src/wire.ts`） \| 推进修订号的规划同步把本轮写入的每一行重盖成新修订号（ADR-0012 第 2 条），一个标题变化就让 watch 的 delta upsert 全部行、client 整表重渲染；保留它是因为 `wire.ts` 的 `revisionOf` 兜底在「只有移除」的事务后会落后于工作区修订号 \| 只重盖变化行要多写逐行比较，并先删掉兼容兜底；#220 只要求内容不变时不推进 \| 条目上千时一次小改动产生整表 delta；不影响正确性 \| #132 让宿主总传 `workspaceRevision`、#224 删去 `revisionOf` 之后：只给内容变化的行盖新修订号（行修订号 = 该行最后变化时的工作区修订号），补「一个标题变化只 upsert 一行」的用例，并修订 ADR-0012 第 2 条
6. 验证：对第 1、2 步新增的每个引用按 `docs/product/vertical-path.md` §2.1「用例回读」的子 shell 命令回读（正例与伪造前缀负对照各一次）；在本工作树根目录重放 P2 与新 X2；`node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js` 0 fail；`git diff --check origin/main...HEAD` 无输出。
7. 提交：`docs(product): 回填 #199 / #220 的证据与技术债务`，尾注 `Refs #199`、`Refs #220`。

**回滚**：revert 本批提交；文档回到 base 的结论（与代码 revert 同时进行时不会出现「代码回退、文档仍说已交付」）。

### Batch 4 · 对抗验证、整合与 draft PR

**最小闭环**：独立验证者在最终树上复跑全部证据并整表重测变异；提交整合为交付物级；推送后回读 PR 与 checks。

1. 对抗验证（另一个 Sonnet 子 agent，只读本工作树、在自己的导出目录做变异）：逐条复跑 `Validation and Acceptance`；在最终树上整表重测 M1–M10（不复用实现者的变异结论）；按 #199、#220 原文条件与 K1/K2 复核；检查 `SYNC_ROUND_FAILED` 与提交信息不含原异常文字；输出 P0–P3 列表。P0/P1 必须在本 PR 修完并重新整表重测；P2/P3 修或登记。
2. 整合提交：保留四个交付物级提交（Batch 0 规划、Batch 1 代码、Batch 2 代码、Batch 3 回填）；移除 fixup；整合前后 `git diff --name-only origin/main...HEAD | sort` 与 `Global Constraints` 文件集合逐一相等（`comm` 比对），产品与测试树 `git diff <整合前 head> HEAD -- packages tests` 无输出。
3. 发布面：`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`（期望代码 ≤ 800、文档 ≤ 1300）、`node scripts/workflow-check.mjs`、人工五类目检查（`docs/development/publication.md`）。
4. 推送与 PR 正文（draft PR 已在 Batch 0 开出）：整合后先建 backup ref，再 `git push --force-with-lease=fix/sync-revision-freshness:<远端旧 head> origin fix/sync-revision-freshness`；用 `gh pr edit` 更新正文的验证证据。PR 标题 `fix(core): 修订号只随内容变化推进，同步异常转成结构化失败`，正文按 `.github/pull_request_template.md`，「关联」段用 GitHub 关闭关键字关联 #199 与 #220、`Refs #216`、ExecPlan 路径与 Batch；「风险与回滚」写 D3 的双重故障与 TD-030–TD-033。开 draft PR 时把 #199、#220 的 Project `Status` 置 In Progress：依据是 `docs/exec-plan/completed/2026-10-07-iteration-5-6-planning.md` Decision Log「H3」行记录的人类批准（点名 D6、D7 所列条目在开 draft PR 时由 agent 置 In Progress）；写入前回读该行原文，写入后在本计划 Decision Log 记一行引用；人类另有指示时以人类为准。
5. 回读：`gh pr view <n> -R SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,isDraft`（期望 head 等于本地 HEAD、base `main`、关闭引用恰为 #199 与 #220）；`gh pr checks <n> -R SingularityKChen/harness-projects`（期望全部 pass）。是否 ready 与合并由人类决定。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| V1 | #220-1：相同引导两次修订号不变 | T1（chain-bootstrap，base 红）；I1×2 |
| V2 | #220-2：内容变化的全量快照恰好推进一次 | T4（含移除与随后的相同引导） |
| V3 | #220-3：内容不变的手动刷新记录新鲜度、不推进修订号 | T5（对账时刻 t1 → t2）；W1、W2（降级后真实刷新恢复为 metadata、修订号不变）；I2 恢复段 |
| V4 | #220-4：storage-sync-surface 通过 | `node --test tests/integration/storage-sync-surface.test.js` 0 fail |
| V5 | #199-1：被拒绝的观察让游标 degraded 带码，新鲜度读取报告它 | I2×2 |
| V6 | #199-2：集成用例证明失败后的游标状态，撤掉翻译即变红 | I2×2 + M4 |
| V7 | #199 评论 2：冷启动或成功之后被拒，`lastUpdatedAt` 不前进 | I3 + M4 |
| V8 | 2E：重复观察、较旧观察、只记新鲜度；P2 变为不推进 | T2、T3、T5；P2 读回 `revision 1 -> 1 \| entities 5 -> 5` |
| V9 | ADR-0012 / K1：未提交、刷新、查询不推进；交付写者不推进 | I2（未提交）、T5（刷新）；`git grep -n advanceRevision -- packages/core/src` 只有 `bootstrap.ts` 与 `status-policy.ts` 两处（查询路径不推进）；第 6 条由 #221 / #222 在各自计划引用 |
| V10 | K2：不裸抛、不转发原文 | I2 的 `doesNotMatch` + M7；双重故障按 D3 的解释拒绝（I4 + M8） |
| V11 | 游标缺失读作陈旧 | I4 + M5 |
| V12 | #202 残留不被误判 | T6 + M9 |
| V13 | 回归 | `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 与 `tests/mvp0` 0 fail；`tsc --noEmit` 无输出；`node --test tests/contract/package-boundaries.test.js` 0 fail；`node scripts/workflow-check.mjs` exit 0 |
| V14 | 证据回填可复跑 | Batch 3 第 6 步的回读与重放全部符合期望 |
| V15 | 规模与发布面 | `size origin/main` 代码 ≤ 800（实现 ≤ 350）、文档 ≤ 1300；`disclosure origin/main` exit 0；`git diff --check origin/main...HEAD` 无输出 |
| V16 | 守卫有判别力 | M1–M10 在最终树上整表重测，每条的红集合与 D11 一致 |

## Progress

- [x] (2026-10-08 00:40 CST) Batch 0：核对三份设计稿的事实与实验；在 base 的 `git archive` 导出目录实现原型、写全部用例、跑全量与变异（`Artifacts and Notes`）；写定本计划、ADR-0012（Proposed）与两处索引行。未提交、未推送。
- [ ] Batch 1：#220 修订号（红 10 条 → 绿；M1、M2、M3、M6、M9、M10）。
- [ ] Batch 2：#199 结构化失败（红 4 条 → 绿；M4、M5、M7、M8）。
- [ ] Batch 3：证据与债务回填（含 TD-020 转 Resolved、TD-030–TD-033）。
- [ ] Batch 4：对抗验证、整合、推送与回读（draft PR 已在 Batch 0 开出）。
- [ ] 人类决定（不阻塞 Batch 1–4）：ADR-0012 是否采纳；#134 正文是否按 `Interfaces and Dependencies` 收窄。

## Surprises & Discoveries

- **S1 三份设计稿的实测结论全部复现**（base，Node v26.10.0）：P2 为 `2 -> 3`；可移植触发与 SQLite 旧载体触发都到达 Storage 并让游标保持 healthy、读侧报 fresh；冷启动 client 显示 0 行且有 `lastUpdatedAt`；`reconcile_cursor` 无写者。α「在内存中实测修复」的结论也在本计划的原型上复现：全量回归不破（A5），变异按预期变红（A4）。
- **S2 SQLite 读回键序与 core 计算值不同**：5 行里整对象 `JSON.stringify` 全不等、`isDeepStrictEqual` 全相等（A3）。所以比较只能是「读回对读回」或键序无关的深比较；本计划两者都用。
- **S3 `RangeError` 的消息里带着 provider 给的版本值**（`packages/capabilities/src/observation.ts` :148）：任何「把 `error.message` 放进结构化失败」的写法都会把 provider 数据带上 wire，M7 钉住。
- **S4 base 上 client 的 `lastUpdatedAt` 在内容不变的刷新后前进，完全来自 P2 的伪 delta**：修复后它按自己的定义不再前进（D5）。
- **S5 空项目的首轮引导修订号停在 0**（base 为 1）：首轮没有任何行，快照没变。全量回归不受影响；记录在此，免得被当成回归。
- **S6 `context.ts` 的注释「降级交给游标状态表达」在 base 上不成立，修复后除双重故障外成立**；本 PR 不改该文件（D3、TD-031）。
- **S7 既有缺陷，不在本 PR 范围**：`packages/core/src/status-policy.ts` :84 在事务外读投影，再在事务里整行写回，与并发引导之间存在丢失更新；宿主权威下的状态写入会被下一次引导覆盖（#273）。修复后这种覆盖会被正确计为一次内容变化。是否另开 issue 由人类决定。
- **S8 本仓库的计划 lint 要求 `Concrete Steps`、`Artifacts and Notes` 两节与 `Change Note (` 格式**，比 `PLANS.md` 的 13 节多两节；沿用 `docs/exec-plan/completed/2026-10-01-work-item-list-states.md` 的做法，把两节放在 `Outcomes & Retrospective` 之后、`Bottom Change Note` 之前。
- **S9 导出目录里有一条与本改动无关的失败**：`tests/contract/issue-policy.test.js`「CLI：脚本被改名成不带扩展名的副本后」在导出目录（不是 Git 仓库）读回 exit 3、期望 2；在本工作树里同一用例 2/2 通过。导出目录还需要复制各包自己的 `node_modules` 链接（`packages/ui` 需要 react），见 C4。

## Decision Log

| 日期 / 作者 | 决策与理由 |
|---|---|
| 2026-10-08 / 定稿评审者（Claude） | **迭代规划 D6 的「#220 + #199 排在 #219 之后（同改 `context.ts`）」作废**：本 PR 不改 `context.ts`（`Global Constraints`）；协调者契约 K3 把 `context.ts` 列为 #219 不改的文件，三份 #219 设计也都不改它。两者没有共享文件，合并先后不再约束。Batch 3 在 D6 原处标 Superseded。 |
| 2026-10-08 / 定稿评审者 | 变化检测采用写后重读 + `isDeepStrictEqual` + 整批重盖（D2）。理由：两侧同为读回，经得起 SQLite 往返；移除与 #202 残留交给 Storage 自己的作用域；实现最小。可由人类在 PR 评审时推翻。 |
| 2026-10-08 / 定稿评审者 | 一轮同步的任何异常都转成 `unavailable` 与固定文案，不新增类型化拒绝（D3）；永久拒绝与暂时故障同码登记 TD-030。可由人类推翻。 |
| 2026-10-08 / 定稿评审者 | 对 K2 的解释：双重故障时 `bootstrapWorkspace` 拒绝，而不是返回一个「降级已落账」的结构化结果（D3）；残余登记 TD-031。需协调者确认，可由人类推翻。 |
| 2026-10-08 / 定稿评审者 | 游标缺失读作 `{ degraded: true, stale: true, reason: 'idle' }`（D4）。可由人类推翻。 |
| 2026-10-08 / 定稿评审者 | 成功提交时写 `reconcile_cursor.lastReconciledAt`，不改 wire 与 client；`lastUpdatedAt` 的定义不变，「内容不变的成功刷新不推进 `lastUpdatedAt`」由 W2 钉住、由 `workspace-read.ts` 注释写明，暴露对账时刻归 #229 / #218（D5、TD-032）。可由人类推翻。 |
| 2026-10-08 / 定稿评审者 | 修订号规则写进 ADR-0012（Proposed），端口注释只指向它（D6）。采纳由人类决定。 |
| 2026-10-08 / 定稿评审者 | 本 PR 把 R1 §2.1.1 第 7、8 行与矩阵 13.4、13.8 行升级（「只往保守方向修正」的反向升级）：证据是 T1–T3、I1、I2 经 `commands` / `queries` 入口、两个 Storage，以及 M1、M10、M4 的变异；第 3 行只升到「部分」，因为写侧不排队重放仍无用例。 |
| 2026-10-08 / 定稿评审者 | 2E 的「较旧观察不能覆盖较新快照」在本 PR 用 T3 覆盖（#134 验收 6 可直接引用），不留给 #134。理由：约 12 行测试，零实现，R1 第 8 行的 core 缺口随之闭合。 |
| 2026-10-08 / 定稿评审者 | TD-034 不使用（编号不回收）。 |

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
- **K6**：本 PR 用 ADR-0012 与 TD-030–TD-033（TD-034 不用）；合并时回读 tracker 与 `docs/adr/README.md`，与兄弟 PR 的 ADR-0011 / ADR-0013、TD-035 起的编号并存。
- **K7**：共享文件只改本 PR 自己的行（`Global Constraints` 的「证据回填」与「规则与索引」）；冲突由后合并者 rebase 解决。

**兄弟 PR 与下游 issue 的交接**：

- **PR-B（#219，`feature/development-repository-routing`）**：无共享文件。本 PR 的 catch 只在 `bootstrapWorkspace` 的门禁之后，不吞 `createContext` 的注册拒绝；PR-B 的要求是 registry 改造后 `singlePlanningBinding` 与 `gateCommand` 在引导时不抛异常（它们在本 PR 的 try 之外）。
- **PR-C / PR-D 的预期订正**：本 PR 不扩展 `SyncCursorRecord`，也不导出公共的「变化才推进」助手（变化判定是 `bootstrap.ts` 的内部函数）；交付写者按 K1 不推进修订号，所以不需要这样的助手。交付新鲜度若复用 `sync_cursor`，按 K5 处理 TD-021。
- **#134（定时对账与手动刷新）**：复用 `bootstrapWorkspace` 作唯一写者。本 PR 交付了它的验收 4（相同状态对账两次，实体、成员关系、修订号不变：T1）、验收 2 的 Storage 拒绝分支（I2：失败标陈旧并记录，下一次成功清除）、验收 6（T3），以及范围里的「游标记录上次全量对账时刻」。建议人类批准把 #134 正文收窄为「定时调度、显式刷新命令、退避（TD-030）与成员关系删除」，并把上述三条验收改为引用本 PR 的用例。agent 只起草，不写 issue。
- **#218（client 代际）**：可依赖「同修订即同业务内容」与修订号单调（ADR-0012）；若 #229 需要宿主对账时刻，在 #218 的单次 summary 里带上它（TD-032）。
- **#229（抽屉陈旧标记）**：「最后更新时间」读 `lastUpdatedAt` 时，它在内容不变的刷新后不前进；错误码到展示文案的映射仍是 TD-025（`unavailable`、`idle`）。
- **#132（宿主组合根）**：宿主必须给 `createController` 传 `workspaceRevision`（TD-033）；重启组合不推进修订号（I1）。
- **#202（换 Planning 源）**：T6 钉住「残留不被每轮误判」；#202 让残留被收敛移除后，换源后的第一轮应恰好推进一次，T6 按新语义改写，不删除。
- **#273**：宿主权威状态被引导覆盖仍是既有缺陷；修复后每次覆盖都推进修订号（被正确计为变化）。
- **#283**：Draft→Issue 改指主身份时，按 ADR-0012 第 6 条把身份纳入变化判定。
- **#224**：删 `revisionOf` 兜底后，按 TD-033 改为只重盖变化行。

## Outcomes & Retrospective

设计定稿阶段（2026-10-08）的结果：三份设计稿收敛为「core 内一处变化判定 + 一处整轮翻译 + 一行新鲜度默认值 + 一行对账时刻」，不改端口、适配器、wire 与 client 行为；原型实现 +47 / −16 行，14 条用例在 base 上全红、在原型上全绿，10 条变异全部被杀死。相对三份设计稿的主要删减：β 的 wire / client 新鲜度通道与显式字段元组、γ 的端口类型化拒绝与 `createRevisionStamp` 助手、`status-policy.ts` 改动。实施后的实际结果、规模与偏差由 Batch 4 追加在本节。

## Concrete Steps

**C1 开工前检查**（`AGENTS.md` §6）：

    git rev-parse --git-dir --git-common-dir
    git status --short --branch          # 期望：## fix/sync-revision-freshness...origin/main，无其他改动（本计划等 Batch 0 文件除外）
    git worktree list --porcelain
    git check-ignore -v .worktrees/
    node --input-type=module -e "console.log(import.meta.resolve('@harness-projects/core'))"   # 期望路径落在本工作树的 packages/core

**C2 红绿判据**：每次跑红 / 跑绿都用 `node --test-reporter=spec <文件…>`，以 `✖` 行的用例名集合比对本计划给出的期望集合；只看 `ℹ fail` 计数不算。

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
    let outcome; try { const r = await api.commands.bootstrapWorkspace(); outcome = `${r.ok} ${r.error?.code}` } catch (e) { outcome = 'threw ' + e.constructor.name }
    const binding = (await api.queries.listProviderBindings()).find((b) => b.domain === 'planning')
    const cursor = await providers.storage.getSyncCursor(binding.workspaceId, binding.id, 'planning.project')
    console.log('bootstrap', outcome, '| cursor', cursor.state, cursor.lastErrorCode, '| any view degraded', (await api.queries.listPlanningItems()).some((v) => v.freshness.degraded))

观察（2026-10-08）：base `bootstrap threw RangeError | cursor healthy undefined | any view degraded false`；原型 `bootstrap false unavailable | cursor degraded unavailable | any view degraded true`。P2：base `revision 2 -> 3 | entities 5 -> 5`；原型 `revision 1 -> 1 | entities 5 -> 5`。SQLite 旧载体触发（`:memory:`，经受保护的 `db` 句柄写入 `'v9'` 的已提交观察，再发规范版本观察）：base `bootstrap threw Error | cursor healthy undefined | sync {"degraded":false,"stale":false}`；原型 `bootstrap false unavailable | cursor degraded unavailable | sync {"degraded":true,"stale":true,"reason":"unavailable"}`。

**A3 键序**：同一默认种子分别经内存替身与 SQLite 组合，去掉 `revision` / `workspaceId` / `entityId` 后按内容排序逐行比较：`rows 5 | JSON differs 5 | deep differs 0`；差异例：SQLite 读回 `{"planningStatus":…,"content":…}`，替身 `{"content":…,"planningStatus":…}`。

**A4 原型变异结果**（导出目录，原型 = D7；红数含两个 Storage 各一条）：M1 12 红（T1–T6、W1、W2、I1×2、I2×2）；M2 2（T4、T6）；M3 2（T4、W1）；M4 3（I2×2、I3）；M5 1（I4）；M6 3（T5、I2×2）；M7 2（I2×2）；M8 1（I4）；M9 1（T6）；M10 1（T3）。base 源码 + 新用例：chain-bootstrap 6 红、workspace-read-assembly 2 红、sync-revision-freshness 6 红，其余既有用例全绿。

**A5 原型回归**（导出目录，观察于 2026-10-08）：`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 为 1218 条、1 fail（即 S9 的环境性失败）；`node --test tests/mvp0` 7 / 7；`tsc --noEmit` 无输出。重算命令即 Batch 2 第 4 步。

**A6 原型规模**：`bootstrap.ts` +46 / −15、`queries.ts` +1 / −1、`chain-bootstrap.test.js` +77、`workspace-read-assembly.test.js` +6 / −7、新集成文件 98 行（未含 Batch 1–2 的注释改动）。

## Bottom Change Note

Change Note (2026-10-08 00:40 CST)：创建计划。三份 PR-A 设计稿经定稿评审裁决：变化检测采用写后重读 + 深比较 + 整批重盖；错误语义采用整轮 catch 与固定 `unavailable`，双重故障拒绝；游标缺失读作陈旧；写对账时刻但不改 wire 与 client，`lastUpdatedAt` 的现行定义由用例钉住；规则写进 ADR-0012（Proposed）。原型与变异在导出目录实测，结果见 `Artifacts and Notes`。
