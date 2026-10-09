# 交付事实的唯一写者与最后确认快照 ExecPlan

> 状态：Completed（2026-10-09，PR #292 合并前归档；三轮 MMP 评审均 APPROVED，见 `docs/review/pr-292-mmp-review.md`）。设计已定稿（定稿评审者，2026-10-08）；批次 C1、C2 与 C3 的回填、债务行、变异已由实现者完成并本地提交，第一轮对抗验证（`3aef993`）的 1 个 P1、5 个 P2 与可修的 P3 已按根因修复（批次 C4）；第二轮（`ed554d0`）的 3 个 P2、7 条 P3 已处置（批次 C5）；第三轮（`0bf8b70`）的发现由验收者处置（批次 C6，见 Progress）；验收之后的规模收敛（批次 C7）把代码桶收到规划上限 800 以内，判别力不降；第四轮（`a256dda`）通过，没有 P0、P1、P2，P3 的处置见批次 C8；批次 C9 把本分支 rebase 到 `origin/main@a357ef8c`，适配 #295 已合并的完整分页与新读取签名（K4）；K3 接线原定等 #291 合并后由本 PR 做，人类伙伴已改为由 #297 单独做（Decision Log 第 44、45 行）；批次 C10 处理 rebase 后独立对抗验证的 P3：完整性表补两条路由门、`settled` 的默认谓词改成 fail closed、文档订正，代码桶仍不超过 800；批次 C11 处理 #292 第一轮 MMP 评审：变更请求查找改按 `headBranch` 过滤（TD-050 解决，TD-040 收窄为分支一侧、承接 #233），补判别用例，订正过期事实（C11 Progress）。批次 C12 处理 #292 复评轮（APPROVE）的 3 条 P3 与 #293 复评轮里属于本层的迁移 006 列注释：变更请求查找把页形非法的成功页记成缺口，订正用例注释、TD-040 的引用与 `attempted_at` 列注释，永久的判别用例随 #293（C12 Progress）。整合提交、推送与归档由协调者在人类评审后做。
> 创建：2026-10-08 CST。规范：`PLANS.md`。
> 关联：issue #221，由 PR 正文尾注关闭；属于 epic #216 的 Batch 3A。下一层是 PR-D（#222，分支 `fix/delivery-query-pure-read`，栈在本 PR 上），计划见 `docs/exec-plan/active/2026-10-08-delivery-query-pure-read.md`（将新建，随 PR-D 落地）。
> 执行上下文：检出 `feature/delivery-fact-writer` 的工作树根目录（`.worktrees/delivery-fact-writer`），base 是 `origin/main`。
> 上游输入：
> - 控制计划 `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` Batch 3；
> - `docs/adr/ADR-0011-delivery-facts-last-confirmed-snapshot.md`（Proposed，与本计划同批写入）；
> - 三份独立设计稿（α 最小闭环、β 系统与不变量、γ 同类工具调研）与协调者的跨 PR 契约 K1–K8。后两类是本地运行态输入，不随仓库分发，本文只引用它们的结论，并在本文内重述。

## Purpose / Big Picture

完成后，交付链上的 commit、变更请求、流水线运行与检查运行，有且只有一个拥有者：core 的 `refreshDeliveryFacts`。它在一个 Storage 事务里，按执行上下文写一份「最后确认快照」，同时写入谱系候选边与端点实体。

用户看到的变化有四点：

- Delivery 离线、权限被拒或分页读不全时，交付视图仍返回最后确认的 CI 事实，并逐跳标 `stale`。
- 只有完整读到的空集合才会删除事实。
- 查询自己不再写边，只委托这个写者；查询纯读是 #222 的事。
- SQLite Storage 上的首次交付读取不再抛外键异常。

最小成功证据有三条，都在检出本分支的工作树根目录运行：

- issue #221 的验收命令退出 0：

        node --test --test-timeout=60000 tests/e2e/delivery-lineage.test.js tests/contract/storage-contract.test.js tests/integration/execution-relation-write-schema.test.js

- 控制计划的 P3 原命令（见下文「复现」）输出 `relations 2 -> 9 | ci online 5 | ci offline 5 | degraded true`。base 上的输出是 `ci offline 0`。
- `tests/e2e/delivery-lineage.test.js` 的「离线保留（SQLite）」用例通过。base 上它抛 `FOREIGN KEY constraint failed`。

## Context and Orientation

### 术语

| 术语 | 含义 |
|---|---|
| 执行上下文 | `contextIdFor(workspace, workItem, repository)` 确定的那条记录，由开始工作创建 |
| 锚点 | 交付事实挂靠的、已观察到的上游节点：工作树 → 提交 → 流水线；工作树 → 变更请求 → 检查 |
| 集合 | 每个上下文四个：`commit`、`change_request`、`pipeline_run`、`check_run` |
| 完整读取 | 能力可用、provider 成功，且分页已读完（或查找目标就在这一页） |
| 陈旧（stale） | 最近一次被应用的刷新没能重新确认该集合，节点是最后确认的值 |
| 唯一写者 | 新文件 `packages/core/src/delivery-facts.ts` 导出的 `refreshDeliveryFacts` |
| `ingest` 辅助 | `tests/e2e/delivery-lineage.test.js` 里唯一的摄入调用点：本 PR 调查询，PR-D 只改这一处改调命令 |

### 当前代码

观察时刻是 2026-10-08，在检出 `feature/delivery-fact-writer`（等于 `origin/main@6417d45`）的工作树根目录。

查询本身在写：

- `packages/core/src/delivery.ts` 的 `getDeliveryProjection` 先 `readChainFacts` 读 provider，再对已观察的跳调 `recordEdges` 写关系。`queries.ts` 的注释却写「只读」。
- `packages/core/src/relations.ts` 的 `recordEdges` 不登记端点实体，SQLite 的 `relation` / `candidate_relation` 两端有外键指向 `entity`（迁移 003 第 43–68 行）。
- 开始工作只在 `start-work.ts` 的 `registerParents` 里登记了上下文与工作树两个实体（#187）。
- 内存替身的 `putRelation` 接受悬空端点。`tests/contract/storage-contract.test.js` 的分叉格与 `tests/contract/suites/storage-execution.js` 末尾的 `storageExecutionDivergenceSuite`，都把这一格点名给了 #221。

读取不完整也会被当成完整：

- `packages/core/src/chain-facts.ts` 的四处 provider 读取只读第一页（`PAGE_LIMIT = 50`），不看 `nextCursor`。
- 失败经 `gated` 折成 `CapabilityGap`。

现有表都放不下交付事实：

- `entity` 只有 `(id, kind)`。
- 关系表没有属性列。
- `external_identity` 的种类 CHECK 不含 commit、pipeline、check。
- `sync_observation` 是连接级、只追加的账本，端口上没有它的读方法。

迁移号 005 已被 `005_source_version_carrier.sql` 占用（`packages/storage/sqlite/src/migrations.ts`）。控制计划第 172 行（写入集合）与第 228 行（3A）写的 `005_delivery_facts.sql` 已过期。

修订号只由 `bootstrap.ts` 与 `status-policy.ts` 推进，controller 的快照只含规划投影。

相关技术债：

- TD-007：读 Ready 上下文时全量 `listRelations`。
- TD-009：读谱系把 Unknown 的半提交「修复」成 confirmed 的 tracks / has_worktree。
- TD-014：开始工作的最终事务不升级同端点的 candidate。
- TD-021：出现第二个游标写者时，要补「挂载存在」的约束。

TD-009 与 TD-014 都写明「随 #221 处理」。

### 复现

以下 E1–E6 都在上述检出上运行。

| # | 场景 | 观察 |
|---|---|---|
| E1 | 控制计划 P3 原命令（第 323–338 行） | `relations 2 -> 9 \| ci online 5 \| ci offline 0 \| degraded true` |
| E2 | P3 加探针 `[关系, 修订号, 实体]` | 首读前 `[2,1,8]`，首读后 `[9,1,8]`；新增的 7 条边端点全部未登记 |
| E3 | 给 head（`sha-1`）再种 60 条运行，共 62 条 | 只返回 50 条流水线跳，`degraded false`：截断被当成完整 |
| E4 | Delivery `PermissionDenied` | CI 跳为 0，`error none` |
| E5 | Development 离线 | 只剩 `execution_context`、`worktree` 两跳 |
| E6 | 同样流程换成 `createSqliteStorage(':memory:')` | `getDeliveryProjection` 抛 `FOREIGN KEY constraint failed`，关系 2 → 2 |

P3 原命令如下（在工作树根目录运行）：

    node --input-type=module -e "
    import { composeCore } from '@harness-projects/core'
    import { FaultKind, createFakeProviders, refOf } from '@harness-projects/provider-fake'
    const providers = createFakeProviders()
    const api = await composeCore({ workspace: { name: 'probe' }, providers })
    const workItemId = (await api.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item').entityId
    const started = await api.commands.startWork({ workItemId, repositoryId: 'repo-alpha', actor: { kind: 'agent' }, idempotencyKey: 'p3' })
    await providers.development.createChangeRequest({ repository: refOf(providers.development.gate.bindingId, 'repository', 'repo-alpha'), head: started.branchExternalId, base: 'main', title: 'p3', body: 'p3' })
    const scope = { workItemId, repositoryId: 'repo-alpha' }
    const ci = (p) => p.hops.filter((h) => h.entityKind === 'pipeline_run' || h.entityKind === 'check_run').length
    const r0 = providers.storage.data.relations.length
    const online = await api.queries.getDeliveryProjection(scope)
    const r1 = providers.storage.data.relations.length
    providers.delivery.faultsSwitch.set(FaultKind.Offline, true)
    const offline = await api.queries.getDeliveryProjection(scope)
    console.log('relations', r0, '->', r1, '| ci online', ci(online), '| ci offline', ci(offline), '| degraded', offline.degraded)
    "

基线（观察时刻 2026-10-08，`origin/main@6417d45`，本工作树）：#221 的验收命令 153/153 通过；全量 `tests/contract tests/integration tests/e2e` 1206/1206；`tests/mvp0` 7/7。重算命令见 `Plan of Work` 的 `Concrete Steps`。

### 在途的相邻工作

| PR | 关联 issue | 与本 PR 的关系 |
|---|---|---|
| PR-A #290 | #199、#220 | 修订号规则与结构化失败，ADR-0012（Proposed） |
| PR-B #291 | #219 | Development 按仓库路由（C10：K3 接线由 #297 单独做，Decision Log 第 45 行） |
| PR #289 | #232 | GitHub Actions 读取、Delivery 完整分页与 `factFor(status, conclusion)`（Superseded by C9 Progress（2026-10-08）：#232 拆成 #295（端口、`collectDeliveryPages`、`factFor`、`readChecks` 新签名的 base 片）与 #289（adapter 片），两者都已合并，本 PR 已 rebase 到其上） |
| #287 | #279 | 变更请求带 `headBranch`（Superseded by C11（2026-10-08）：#287 早于本 PR 的 base 已在 main，C9 没有回读；C11 起变更请求查找按它过滤，Decision Log 第 48 行） |

契约见 `Interfaces and Dependencies`。

## Design / Spec

### 裁决总览

| 议题 | α | β | γ | 本计划裁决 |
|---|---|---|---|---|
| 持久化形状 | 每（上下文，实体）一行 | 每（上下文，种类，binding，外部 id）一行 | 每上下文一行 JSON | **每上下文一行，集合放进一个 JSON 列**，去掉 γ 的 digest 与 `observed_at` |
| 新鲜度落点 | `sync_cursor`，每种类一条 | `sync_cursor` | 表内 | **表内**：集合级 `confirmedAt` 加显式 `stale`，行级 `attempted_at` |
| 修订号 | 推进 | 不推进 | 推进 | **不推进**（契约 K1） |
| 写入面 | 全部链边 | 只写三类，不写 tracks / has_worktree | 全部链边 | **只写三类**，加端点 `putEntity`，替身外键对齐 |
| 不完整集合 | 保留 | 保留 | 截断时部分增补 | **整组保留并标 stale**，不部分增补 |
| 乱序守卫 | PR-D | PR-C | PR-D | **PR-C**：本 PR 的查询会触发并发刷新 |
| 截断 | 写者自己翻页 | 守卫 | 写者翻页 | **`gated` 里一个守卫**；Delivery 部分由 #289 取代（K4）（Superseded by C9（2026-10-08）：Delivery 部分已由 #295 的 `collectDeliveryPages` 取代，守卫只留在 Development 两类查找，Decision Log 第 40 行） |
| Development 绑定解析 | `gated` / `resolveRepository` | `readBindingFor` | 原样 | **一个路由缝 `developmentReadBinding`**，返回 `{ binding, repository }`（K3 补充） |

每一列由哪条验收或不变量支撑，见下面三节。被放弃的方案与原因见本节末尾。

### 持久化：迁移 006

新增 `packages/storage/sqlite/migrations/006_delivery_facts.sql`，并在 `migrations.ts` 的清单里加 `{ version: 6, file: '006_delivery_facts.sql' }`：

    -- 006_delivery_facts：交付事实的最后确认快照（#221，ADR-0011）。唯一写者是 core 的 refreshDeliveryFacts；首次 MVP 发布前不承担迁移兼容成本。
    -- delivery_fact：一个执行上下文一行（键 = 工作区 + contextIdFor 的确定性 id）；没有执行上下文就没有交付事实（复合外键）。
    CREATE TABLE delivery_fact (
      workspace_id TEXT NOT NULL,
      context_id TEXT NOT NULL,
      attempted_at TEXT NOT NULL, -- 最近一次被应用的刷新的读取开始时刻：乱序守卫的基准
      sets_json TEXT NOT NULL CHECK (json_valid(sets_json) AND json_type(sets_json) = 'array'), -- 四个集合的节点、confirmedAt 与 stale；core 写入，storage 不解释
      PRIMARY KEY (workspace_id, context_id),
      FOREIGN KEY (workspace_id, context_id) REFERENCES execution_context (workspace_id, id)
    );

逐列说明：

| 列 / 字段 | 它保护的验收或不变量 |
|---|---|
| `workspace_id` + `context_id`（主键与复合外键） | 缓存键（#221 Scope 的「cache key」）；没有上下文不写事实，保持 delivery-lineage 两条负向用例；`execution_context` 已有 `UNIQUE (workspace_id, id)` 供复合外键引用 |
| `attempted_at` | 乱序守卫（#222 验收 2，由本 PR 的写者承担） |
| 集合的 `kind` | 完整性按集合判定，一个集合截断时不删另一个（#221 验收 3） |
| 集合的 `anchorId` | 读路径按 `(节点, 边类型, anchorId)` 取边，不在全局关系里按 `(节点, 边类型)` 重新找：同一头提交上的两个上下文共享同一个流水线实体，它的 `runs_on` 边有多条（对抗验证 P1，S12）；陈旧集合按记录时的锚点显示（Decision Log 第 11 行） |
| 集合的 `confirmedAt` | 「最后确认」的时刻，PR-D 的 freshness 直接转发（#222 的 freshness 元数据） |
| 集合的 `stale` | 离线返回值必须标陈旧（#221 验收 1）。不能用时间戳是否相等来推断，原因见 `Surprises & Discoveries` S4 |
| 节点的 `entityId` | 读路径按它找关系表里的那条边，不重新识别（不变量 6） |
| 节点的 `externalId`、`label`、`fact` | 离线时显示的值（#221 验收 1）；`fact` 是 core 在确认时派生的工程事实（TD-043） |

不新增 SQLite 的 CHECK 词表，也不加节点外键。理由：唯一写者在同一事务里先登记实体，关系表的外键已经守住端点；JSON 内部形状由 core 保证（TD-041）。

### 端口

在 `packages/capabilities/src/storage.ts` 的 `Storage` 关系段之后加端口，同时更新 `packages/capabilities/src/registry.ts` 的 `StorageSurface` 成员锁（加 `'getDeliveryFacts' | 'putDeliveryFacts'`）：

    export interface DeliveryNodeFact {
      readonly entityId: EntityId; readonly externalId: string; readonly label: string | undefined
      readonly fact: EngineeringFactKind | undefined
    }
    export type DeliveryFactSetKind = 'commit' | 'change_request' | 'pipeline_run' | 'check_run'
    export interface DeliveryFactSet {
      readonly kind: DeliveryFactSetKind
      readonly anchorId: EntityId | undefined    // 节点确认时挂靠的锚点实体（提交 / 变更请求挂工作树，流水线挂提交，检查挂变更请求）；从未完整读到时为 undefined
      readonly confirmedAt: string | undefined   // 最近一次完整读到该集合的刷新时刻；undefined = 从未完整读到
      readonly stale: boolean                    // 最近一次被应用的刷新没能重新确认它
      readonly nodes: readonly DeliveryNodeFact[]
    }
    export interface DeliveryFactsRecord {
      readonly workspaceId: WorkspaceId; readonly contextId: ExecutionContextId
      readonly attemptedAt: string               // 最近一次被应用的刷新的读取开始时刻
      readonly sets: readonly DeliveryFactSet[]
    }
    // Storage：
    getDeliveryFacts(workspaceId: WorkspaceId, contextId: ExecutionContextId): Promise<DeliveryFactsRecord | undefined>
    putDeliveryFacts(record: DeliveryFactsRecord): Promise<void>

两个实现必须同语义：

- **整行覆盖**：不合并旧集合。
- **父行**：`(workspaceId, contextId)` 必须是同一工作区里已登记的执行上下文，否则拒绝且不留行。
- **读回**：逐字段读回，缺省值是显式的 `undefined`。

各实现的落点：

- **替身**（`packages/providers/fake/src/storage.ts`）：
  - `FakeStorageData` 加 `deliveryFacts: cap.DeliveryFactsRecord[]`，`emptyStorageData` 补 `deliveryFacts: []`。
  - `put` 时检查 `contexts` 里存在同 id、同工作区的记录，然后 `upsert(structuredClone(record))`。
  - `get` 返回 `structuredClone`。
- **SQLite**：
  - `packages/storage/sqlite/src/storage-execution.ts` 的 `put` 是单语句 UPSERT（`ON CONFLICT (workspace_id, context_id) DO UPDATE SET attempted_at = excluded.attempted_at, sets_json = excluded.sets_json`），`get` 走基类的 `read`。
  - 列清单写一次：`workspace_id, context_id, attempted_at, sets_json`。
  - `packages/storage/sqlite/src/storage-rows.ts` 新增 `rowToDeliveryFacts`：`JSON.parse` 之后逐字段重建，`label ?? undefined`、`fact ?? undefined`、`confirmedAt ?? undefined`。
- **替身外键对齐**（在 C2 做，见 `Plan of Work`）：`putRelation` 在工作区检查之后加一行：`from` 与 `to` 都必须在 `entities` 里，否则 `throw new Error('relation endpoint entity does not exist')`。同时改写方法注释，删掉「仍然分叉」。

### 写者

新文件 `packages/core/src/delivery-facts.ts`。从 `packages/core/src/index.ts` 只导出 `refreshDeliveryFacts` 与 `DeliveryRefreshResult`，因此该文件内其余函数不加 `export`。

    export interface DeliveryRefreshResult {
      readonly ok: boolean          // 读取或提交失败为 false
      readonly anchored: boolean    // 有已观察的执行上下文与工作树；没有时什么也不写；读取阶段就失败时还不知道，记为 false
      readonly applied: boolean     // 本次读取被提交；没有锚点、读取或提交失败、令牌平手或更晚的读取已先提交（乱序守卫）时都为 false
      readonly gaps: readonly CapabilityGap[]
      readonly error: ProjectError | undefined
    }
    export async function refreshDeliveryFacts(context: CoreContext, scope: DeliveryScopeInput): Promise<DeliveryRefreshResult>

算法分六步，顺序固定：

1. 取读取开始时刻 `attemptedAt`，它同时是乱序令牌：先在事务外读一次已提交快照的 `attemptedAt`（读失败按 0 处理，不阻断刷新），再取 `context.clock()`、「已提交值加 1 毫秒」、「同一个 core 上下文对象内上一次的令牌加 1 毫秒」三者的最大值。令牌因此对任何先于本次读取提交的刷新严格递增（I6），与墙钟、上下文对象、进程重启（含时钟回拨）都无关；只靠墙钟或对象内计数都会失效（S13，S19、S20）。
2. 在 `try` 里、事务外调用 `readChainFacts(context, scope)`，这是唯一一次 provider 读取；它抛出的异常和第 5 步的异常一样走第 6 步（K2，S14）。
3. 若 `!facts.context.observed || !facts.worktree.observed`，返回 `anchored: false, applied: false, ok: true`，不写任何东西。
4. 用 `completeSets(facts)` 算出完整集合，规则见下表。它只消费 `facts.gaps` 的能力键与节点的 `observed`（契约 K4）。
5. 在**一个** `context.storage.transaction` 里依次做：
   1. `existing = await tx.getDeliveryFacts(ws, contextId)`；若 `existing.attemptedAt` 不早于 `attemptedAt`（按 `Date.parse` 比较，`>=`），返回 `applied: false`：它是乱序的旧读取，或读取开始时彼此看不见而令牌平手的并发读取，先提交者胜。
   2. 对每个完整集合里已观察的节点：先 `tx.putEntity({ id, kind })`，再用 `recordEdges({ workspaceId, storage: tx }, edges)` 写候选边。边的规则：提交 → 工作树 `derived_from`，变更请求 → 工作树 `produced_by`，流水线 → 提交 `runs_on`，检查 → 变更请求 `runs_on`，provenance 都是 `ProviderRead`。
   3. `tx.putDeliveryFacts({ workspaceId, contextId, attemptedAt, sets })`。四个集合按固定顺序写：完整的集合是 `{ kind, anchorId: 该集合的锚点节点 id, confirmedAt: attemptedAt, stale: false, nodes }`；不完整的集合是 `{ ...(旧集合 ?? { kind, anchorId: undefined, confirmedAt: undefined, nodes: [] }), stale: true }`（保留旧集合的锚点）。
6. 读取或事务抛错时，先用第二个事务尽力处理：读回旧行；如果它早于本次令牌，就整行写回，全部集合标 `stale: true`，`attemptedAt` 前移。这一步若也失败，吞掉异常。然后返回 `ok: false, error: projectError(ProjectErrorCode.Unavailable, '交付事实未能提交；已确认的事实保持不变')`。不转发异常原文（K2）。

不调用 `advanceRevision`（K1），不写任何游标（K5），不写 `reconcile_cursor`。

完整性规则（`completeSets`）：

| 集合 | 完整的条件 | 不完整时 |
|---|---|---|
| `commit` | `gaps` 里没有 `DevelopmentRepositoryRead` | 全部四个集合都不完整（锚点未读到） |
| `change_request` | 提交集合完整，且（没有 head，或者 `gaps` 里没有 `DevelopmentChangeRequestRead`） | 保留并标 stale；检查也不完整 |
| `pipeline_run` | 提交集合完整，且（没有 head，或者 `gaps` 里没有 `DeliveryPipelineRead`） | 保留并标 stale |
| `check_run` | 变更请求集合完整，且（没有变更请求，或者 `gaps` 里没有 `DeliveryCheckRead`） | 保留并标 stale |

「没有 head」只有一种来源：分支列表被完整读到，而且其中确实没有这个分支。这时提交集合是完整的空集合，下游三个集合也都是完整的空集合，事实被删除。这是 H2 的默认裁决。分支在列表里、但头部提交未知（`headCommit` 为 `undefined`），不是「没有 head」：记 `DevelopmentRepositoryRead` 缺口，全部集合保留并标陈旧（S15）。

### chain-facts 改动

文件是 `packages/core/src/chain-facts.ts`，只动四处：

1. **路由缝（K3）**：删掉 `resolveRepository`，换成模块私有的路由缝，`readChainFacts` 与 `readChangeRequest` 都只用它返回的 `repository` 去调 provider：

        type ReadRoute = { readonly ok: true; readonly binding: ResolvedBinding; readonly repository?: ExternalObjectRef } | { readonly ok: false; readonly error: ProjectError | undefined }
        async function developmentReadBinding(context: CoreContext, key: CapabilityKey, repositoryId: string): Promise<ReadRoute>
        // 今天的函数体：gateCommand(context.registry, key, 'read')；成功时 repository = refFor(gate.binding, 'repository', repositoryId)

   Delivery 两处读取用 `deliveryRead(context, key): ReadRoute`，这个函数不带 `repository`（C7 改名为 `readRoute`）。

2. **截断守卫（K4）**：`gated(route, key, run, settled)` 接收路由结论，并多一个 `settled(page)` 谓词。provider 成功但 `settled` 为假时，返回 `{ value: undefined, gap: { key, reason: '分页未读完' } }`。各处读取的谓词：

   | 读取 | `settled` 谓词 |
   |---|---|
   | 流水线、检查 | 默认的 `page.nextCursor === undefined`（#289 用完整分页取代）。Superseded by C9（2026-10-08）：#295 已合并，两处经 `collectDeliveryPages` 完整分页、读不完即缺口；`gated` 的 `run` 回到泛型结果，`settled` 默认恒真，只由下面两类查找传入（Decision Log 第 40 行）。C10：默认谓词改为 `Array.isArray(value)`，只认 `collectDeliveryPages` 交来的完整数组，单页结果不带谓词即缺口（Decision Log 第 46 行） |
   | 分支查找 | `page.nextCursor === undefined \|\| page.items.some((item) => item.name === branch)` |
   | 变更请求查找 | `Array.isArray(page.items) && (page.nextCursor === undefined \|\| page.items.some((item) => item.sourceVersion === head))`（C11：列表先按 `headBranch: branch` 过滤再分页；C12：先要求 `items` 是数组，页形非法即缺口，Decision Log 第 53 行。分支查找不加这一项，第 54 行） |

   两类查找找到即完整。

3. **函数签名**：`readHeadCommit(route, branch, gaps)`、`readChangeRequest(context, repositoryId, head, gaps)`（C11 加 `branch`：`readChangeRequest(context, repositoryId, branch, head, gaps)`）。`commitNode` 与 `changeRequestNode` 继续用路由缝给的 `repository?.bindingId` 构造身份槽位，与今天相同。

4. **头部提交未知是缺口**：`readHeadCommit` 在分支存在而 `headCommit` 为 `undefined` 时，记一条 `DevelopmentRepositoryRead` 缺口（理由「分支没有头部提交」），而不是把它当作「没有 head」。

`readChainFacts` 的返回形状不变：`tests/integration/provider-binding-registration.test.js` 直接调用它，PR #289 也在改它的内部（C9：#295 已合并，内部换成完整分页、`factFor(status, conclusion)` 与按「仓库 + 已观察提交」读检查，返回形状仍不变）。

### 读路径与查询

`packages/core/src/delivery.ts`：

- 删掉 `provenanceFor`、`chainEdges`、`gapKeysFor`、`toHop`，以及对 `readChainFacts` 和 `recordEdges` 的调用。全仓只有本文件使用它们（已 `git grep` 核对）。
- `DeliveryLineageHop` 加 `readonly stale: boolean`。
- 新增导出 `readDeliveryProjection(context, scope: DeliveryScopeInput)`。它只读本地数据，不调 provider，不写任何东西：
  1. `contextId = contextIdFor(...)`；`record = storage.getExecutionContext(contextId)`；`snapshot = record ? storage.getDeliveryFacts(ws, contextId) : undefined`；**之后**再 `relations = storage.listRelations(ws)`（写者在一个事务里同时提交两者、且从不删边，两次读取之间提交了新刷新时，较晚读到的关系只会更全；反过来会把新快照里的节点静默丢掉，S16）；`worktreeId = worktreeEntityId(ws, record?.repositoryId ?? scope.repositoryId ?? '', scope.workItemId)`。
  2. 有 `record` 时：
     - `tracks` 跳 = `type === tracks && to === asEntityId(contextId)` 的关系，节点外部 id 为 `contextId`；
     - `has_worktree` 跳 = `type === has_worktree && from === contextId && to === worktreeId` 的关系，外部 id 是 `record.worktreeExternalId`，label 是 `record.branchExternalId`。

     两者的 provenance 都是 `Command`，`stale: false`。
  3. 按 `commit`、`change_request`、`pipeline_run`、`check_run` 的顺序，遍历快照的每个集合与每个节点，找关系 `from === node.entityId && type === 该集合的边类型 && to === 该集合的 anchorId`。跳的 `stale` 取集合的 `stale`，provenance 为 `ProviderRead`，`observed: true`，`detail: undefined`。`unavailable` 只对流水线与检查按本地 registry 的 `gateCommand(..., 'read').allowed` 判定。找不到关系的节点跳过。
  4. `degraded = snapshot?.sets.some((set) => set.stale) ?? false`。
- `getDeliveryProjection` 在 #221 的过渡形态：保留 `workItemId` 为空时的 `invalid_input` 分支，然后：

        const refreshed = await refreshDeliveryFacts(context, normalized)   // #222 删除这一行
        const projection = await readDeliveryProjection(context, normalized)
        // 失败、被丢弃（令牌平手或更晚的并发读取已提交）或没有锚点（工作树句柄被失败的重新供应清空）的刷新，只要仍显示旧快照，
        // 就不能证明它是最新：降级，并把 provider 读取的跳逐跳标陈旧（controller 只转发跳；命令事实 tracks / has_worktree 不受影响）
        const unconfirmed = !refreshed.ok || (!refreshed.applied && (refreshed.anchored || projection.hops.some((hop) => hop.provenance === EdgeProvenance.ProviderRead)))
        const hops = unconfirmed ? projection.hops.map((hop) => hop.provenance === EdgeProvenance.ProviderRead ? { ...hop, stale: true } : hop) : projection.hops
        return { ...projection, hops, degraded: projection.degraded || unconfirmed || refreshed.gaps.length > 0, error: refreshed.error }

不改 `queries.ts`、`context.ts`、`bootstrap.ts`。`getDeliveryLineage` 仍是 `getDeliveryProjection(...).hops`。

### 不变量

| # | 不变量 | 守护用例 |
|---|---|---|
| I1 | 交付事实只有一个写入调用点，在 `delivery-facts.ts`；谱系边只由开始工作与该写者记录 | 「唯一写者」的静态部分 |
| I2 | 一次刷新只开一个事务，事务外没有关系、实体或交付事实写入；事务内的失败让已写的实体与边随回滚撤销 | 「唯一写者」的行为部分、「提交失败」（事务内写快照时抛错） |
| I3 | 不完整读取不删除、不增补、不改写已确认事实 | 「离线保留（内存替身）」「离线保留（SQLite）」的故障表、「提交失败」（C7 之前是「失败不清空」「提交失败」） |
| I4 | 交付写者不推进修订号、不改规划状态，不写同步游标与对账游标（K5） | 「唯一写者」的重复刷新部分（C7 之前是单独的「重复刷新收敛」） |
| I5 | 交付写者不写 tracks / has_worktree | 「谱系写者不写命令边」 |
| I6 | 更旧的读取不覆盖更新的提交，同一毫秒、时钟回拨、另一个 core 上下文对象、进程重启时也一样；令牌对先提交的刷新严格递增，所以新读取不会被一个跑在墙钟前面的旧令牌丢弃；被放弃或没有锚点的刷新让仍显示的旧快照降级并逐跳标陈旧 | 「乱序」七个变体（第七个是两个 core 上下文对象；每个变体都断言被放弃与没有锚点的刷新逐跳标陈旧，C7 之前是「乱序」六个变体加「被放弃的刷新」）、「刷新结果与快照时刻」 |
| I7 | 关系端点必须是已登记实体，两个 Storage 同语义 | 契约「悬空父边与非法枚举必须被拒绝」的关系两端（C7 之前是单独的「关系端点必须是已登记实体」） |
| I8 | 每个快照节点的跳按它记录的锚点取边；读路径先读快照再读关系 | 「两个上下文共享同一头提交」（四类跳的锚点与端点实体种类）「读路径先读快照再读关系」 |
| I9 | 从读取到提交的任何异常都折成结构化结果，不转发原文 | 两条离线保留故障表的「provider 抛出裸异常」、「提交失败」 |

### 被放弃的方案

| 方案 | 来源 | 放弃原因 |
|---|---|---|
| 复用 `sync_cursor` 存新鲜度 | α、β | 游标按单个 binding 定位，而一份快照由 Development 与 Delivery 两条连接拼成；没有 Delivery 绑定时记不了「从未读到」；触发 TD-021（K5）；`cursor_value` 审计口径是「provider 游标值」 |
| 关系形状：每实体一行，或每（种类，binding，外部 id）一行 | α、β | 验收不需要跨上下文查询。替身与 SQLite 要多出按种类替换、实体外键、种类连接三种可分叉的语义，原型估算实现再多约 60 行。Gate E1 前不冻结细粒度模型（`AGENTS.md` §1.2）。代价见 TD-041 |
| JSON 快照里存 digest、`observed_at` | γ | digest 只为「变化才推进修订号」服务，K1 已否定；`observed_at` 被 `attempted_at` 加集合级 `confirmedAt` 取代 |
| 截断集合部分增补 | γ | 要求按节点算陈旧；截断由 #289 的完整分页消除（C9：已由 #295 消除，读不完即缺口，不交出部分集合） |
| 写者自己翻页 | α、γ | K4 把 Delivery 分页归 #289。在 Development 一侧翻页属于另一个 owner（TD-040）（C9：Delivery 分页已由 #295 落地） |
| 乱序守卫留给 PR-D | α、γ | 本 PR 的查询会触发刷新，并发查询就是并发写者；没有守卫，本 PR 自己就会引入「较旧读取覆盖较新事实」 |
| 写者也写 tracks / has_worktree | α、γ | 会延续 TD-009（读路径把半提交「修复」成命令边），也会让 TD-014 的触发条件成立 |
| 「`confirmedAt !== attemptedAt` 即陈旧」 | γ | 原型实测：毫秒时钟下，连续两次刷新拿到同一时刻，陈旧丢失（S4） |
| 交付变化推进修订号 | α、γ | K1 |
| 存原样 `status` / `conclusion` | β | 要改 `chain-facts` 的读出形状，与 #289 冲突；TD-043（C9：#295 已合并，冲突不再存在，改存原样值仍是 TD-043 的下一步） |
| 读回在全局关系里按 `(from, type)` 找边（实现者原稿） | 本计划初稿 | 同一个流水线实体在关系表里有多条 `runs_on` 边（共享同一头提交的每个上下文各一条），后一个上下文的 CI 会挂到先写入的那个上下文的提交上；对抗验证 P1（S12） |
| 行里加代际整数列当乱序令牌 | 对抗验证的建议之一 | 要改端口、006 与两个适配器；`attemptedAt` 兼作逻辑时钟（取已提交值加 1 毫秒，S19、S20、Decision Log 第 26 行）已经对先提交的刷新严格递增，行里本来就有这个值 |
| 按 D3 预设切缝拆成「存储层 PR + core 写者 PR」 | 规划 D3 | 触发条件是超过 800 行。实测已超（见下节），是否启用交给协调者裁决（Decision Log 第 24、29 行）；两半各自的行数见下节 |

### 文件所有权与行数估算

一个实现者拥有全部产品与测试文件，不并行；对抗验证者只读不写。下面是增删行数的实测（`git diff origin/main HEAD --numstat`，按 `node scripts/rule-checks.mjs size` 的口径，即 `docs/` 与 `.md` 以外都算代码）：C6 是最终验收之后、规模收敛之前；C7 是规模收敛（批次 C7）之后，删改清单见 C7 Progress 与 Decision Log 第 34–38 行。原型阶段的估算（实现约 373、代码约 670）已被实测取代，演变见 Progress 与 Decision Log 第 24、29 行。

实测（C6 → C7）：实现 418 → 384，其中 `delivery.ts` 121 → 112、`delivery-facts.ts`（新）109 → 100、`chain-facts.ts` 87 → 85、`capabilities/src/storage.ts` 36 → 30、替身与 SQLite 适配器（`fake/src/storage.ts`、`storage-execution.ts`、`storage-rows.ts`）51 → 43、迁移 006（新）10 → 10、`registry.ts` / `migrations.ts` / `index.ts` 4 → 4；测试 572 → 415，其中 `tests/e2e/delivery-lineage.test.js` 450 → 315、`tests/contract/suites/storage-execution.js` 68 → 49、其余五个契约与集成文件 54 → 51；代码合计 990（超过规划上限 800）→ 799。

实现仍比 K8 的「约 350」多 34 行：路由缝与截断守卫（`chain-facts.ts`）、`readDeliveryProjection` 的逐集合遍历与逐跳标陈旧、`anchorId`、读取阶段的 `try`、取自已提交快照的令牌，每一处都对应一个已复现的缺陷（Decision Log 第 29 行）。C7 没有删掉任何一个杀死变异的判别断言：测试从 572 收到 415，靠的是合并同构的故障场景、共享链路夹具与去掉不独占任何变异的重复断言（Decision Log 第 34–36 行）。

C6 时按 D3 的切缝（存储层 / core 写者）是存储层 218、core 770；关系端点对齐随写者走时约 173 与 815（Decision Log 第 29 行）。C7 之后整体已不超过 800，D3 不再需要。C9（rebase 到 `origin/main@a357ef8c`、适配 #295 之后）：`chain-facts.ts` 仍为 85、e2e 316，其余不变，代码合计 800（观察时刻与重算命令见 C9 Progress）。

文档（同一口径）：C6 合计 1079、C7 合计 1132（本计划 955 → 1006，其余 ADR、索引、矩阵、控制计划标注与 tracker 124 → 126）；之后各批的读数见对应批次的 Progress。

## Global Constraints

- 保持 `AGENTS.md` §1.1 七条不变量。不改 Project 的 `Status`、`blocked-by` / `blocking`，ADR-0011 只写 `Proposed`。合并、改看板、采纳 ADR 都由人类决定。
- 规模：代码不超过 800（规划上限；CI 硬门 1000），实现约 350，文档不超过 1300（K8）。超出时先审设计膨胀，不机械拆分。
- PR 只合入绿测试。#222 的「查询纯读」红用例不进本 PR，也不得以 `skip` / `todo` 消音。批次内允许先写红用例的本地提交，整合时并入交付物提交，`main` 上不留红提交。
- 修订号：交付写者不调用 `advanceRevision`（K1）。新鲜度：不写 `sync_cursor`（含 `PLANNING_SYNC_SCOPE`）、`reconcile_cursor`（K5、ADR-0012 第 7 条）。失败：不裸抛，不转发异常原文（K2）。
- 不改 `packages/core/src/{queries,context,bootstrap}.ts`（PR-A、PR-D 的地盘），也不改 `packages/capabilities/src/development-provider.ts`、`packages/providers/fake/src/development.ts`、`tests/contract/suites/development.js`（#287 / #288）。
- 首发前不写兼容迁移：已经在本机建库、却没有 006 的旧库，打开时自动应用 006。应用过 006 的库不能被旧二进制打开（`migrate` 的「已应用版本与迁移清单不一致」），处置是删库重建。
- e2e 命令一律带 `--test-timeout`：在 Storage 事务内写根实例，会让替身的写队列自等挂起（S6）。
- 不改 git config；提交身份用 `git -c user.name=… -c user.email=…` 单次传入开发账号。推送前核对作者。tracker 手工编辑，不用 `update_tech_debt_tracker.py`，那个脚本会抹掉既有条目。
- Node 用本机 `v26.10.0`，pnpm 用 `10.28.2`（`package.json` 钉定）。不新增依赖。

本 PR 的文件集合（只在此处声明）：

| 区域 | 文件 |
|---|---|
| 端口与存储 | `packages/capabilities/src/storage.ts`、`packages/capabilities/src/registry.ts`、`packages/providers/fake/src/storage.ts`、`packages/storage/sqlite/migrations/006_delivery_facts.sql`（新）、`packages/storage/sqlite/src/migrations.ts`、`packages/storage/sqlite/src/storage-execution.ts`、`packages/storage/sqlite/src/storage-rows.ts` |
| core | `packages/core/src/delivery-facts.ts`（新）、`packages/core/src/delivery.ts`、`packages/core/src/chain-facts.ts`、`packages/core/src/index.ts` |
| 测试 | `tests/e2e/delivery-lineage.test.js`、`tests/contract/suites/storage-execution.js`、`tests/contract/storage-contract.test.js`、`tests/contract/suites/storage.js`、`tests/integration/execution-relation-write-schema.test.js`、`tests/integration/storage-source-version-upgrade.test.js`、`tests/integration/start-work-retry-identity.test.js` |
| 文档 | 本计划、`docs/adr/ADR-0011-delivery-facts-last-confirmed-snapshot.md`（新）、`docs/adr/README.md`、`docs/README.md`、`docs/product/vertical-path.md`（§2.1 第 10、13 行与 13.5）、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`（第 172、228 行与 P3 的原地标注、Progress 一行）、`docs/exec-plan/tech-debt-tracker.md`（TD-040–TD-044 新增；TD-009 收窄后仍在 Open Items，TD-014 移到 Superseded Items） |

超出控制计划「唯一计划写入集合」的路径有：`delivery-facts.ts`、`index.ts`、`registry.ts`、替身 `storage.ts`、`006_delivery_facts.sql`、`tests/contract/suites/storage.js`、`storage-source-version-upgrade.test.js`、`start-work-retry-identity.test.js`、ADR-0011。理由见 `Decision Log` 第 9 行。

## Plan of Work

实现者是 Sonnet 子 agent，按 TDD 执行；对抗验证者是另一个 Sonnet 子 agent，只读；验收者是协调者。每批遵循：对齐 → 隔离 → 实现 → 验证 → 记录 → 提交 → 汇报。以下命令都在检出 `feature/delivery-fact-writer` 的工作树根目录运行。

### Concrete Steps · 每批开工前与收工时

开工前运行：

    git status --short --branch
    git rev-parse HEAD origin/main
    node --input-type=module -e "console.log(import.meta.resolve('@harness-projects/core'))"

期望：

- 工作区干净；
- 解析结果在本工作树的 `packages/core/src/index.ts` 内；如果不在，先运行 `pnpm install --frozen-lockfile --offline`；
- `origin/main` 若已前移，先 rebase，再重跑本节与上一批的验证。

每个红用例写完后，先跑一次，把失败标题与第一条断言信息写进 `Progress`，再实现。

收工时运行：

    node_modules/.bin/tsc --noEmit
    node --test --test-timeout=120000 tests/contract tests/integration tests/e2e
    node --test tests/mvp0

期望：`tsc` 无输出，两组测试都是 `ℹ fail 0`。

### Batch C0 · 计划与 ADR（已提交 `b7c8fb3`、`ed0705f`，draft PR #292）

**最小闭环**：裁决、契约与测试计划进入仓库，可以独立评审。
**涉及文件**：本计划、ADR-0011、`docs/adr/README.md`、`docs/README.md`。

- [x] 协调者用一个 `docs(exec-plan)` 提交它们，正文说明原因，尾注 `Refs #221`，不写关闭关键字。然后推送并开 draft PR，正文尾注写关闭 #221。
- [x] PR-D 把自己的分支 rebase 到这个提交上（原生栈 #294，#293 在 #292 之上）。

**验证**：

    lint_execplan.py docs/exec-plan/completed/2026-10-08-delivery-fact-writer.md
    grep -c '^## ' docs/exec-plan/completed/2026-10-08-delivery-fact-writer.md
    node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js
    git diff --check origin/main...HEAD

第一行是 `exec-plan` 技能自带的 lint 脚本（不在仓库内，按本机技能目录运行）。期望：lint 输出 `OK`，或者只有与 `PLANS.md` 冲突的通用告警；`grep` 输出 `13`；测试 `ℹ fail 0`；`diff --check` 无输出。

**回滚**：revert 这个提交。

### Batch C1 · 存储层：端口、迁移 006 与两个适配器

**最小闭环**：两个 Storage 以同一语义整行往返交付事实快照、拒绝悬空父行，006 有显式的 schema 审查，全量测试仍绿。这一批**不**对齐替身的关系端点：查询仍然直接写悬空边，对齐要等 C2 让写者先登记端点（S5）。
**主文件**：`packages/capabilities/src/storage.ts`、`packages/storage/sqlite/migrations/006_delivery_facts.sql`、`tests/contract/suites/storage-execution.js`。

1. 先写红用例：
   - **`tests/contract/suites/storage-execution.js`**，在 `storageExecutionSuite` 里：
     - 解构 `const { label, makeStorage, restart } = adapter`。
     - 在「写尝试一行一键」之前加两条，并定义 `factsContext`（`context-facts`，状态 ready）与 `facts(contextId, overrides)` 两个夹具。夹具里的 `sets` 含一个 `pipeline_run` 集合（`confirmedAt` 与 `attemptedAt` 相同，`stale: false`，一个节点 `{ entityId: 'entity-2', externalId: 'run-1', label: undefined, fact: 'ci_passed' }`）和一个空的 `commit` 集合（`confirmedAt: undefined`，`stale: true`）。
       - `${label}：交付事实整行往返与覆盖，重启后逐字段读回（#221）`：写入后 `deepEqual` 读回；写入 `sets: []` 的新行后整行替换；`storage = await restart(storage)` 之后再读；`ws-other` 读到 `undefined`。
       - `${label}：交付事实的执行上下文不在该工作区时被拒绝且不留行（#221）`：`context-none` 与 `{ workspaceId: 'ws-other' }` 都 `assert.rejects`，被拒绝后读回 `undefined`；正控是同形状写在已登记的上下文上被接受。
     - `READ_ISOLATION_CASES` 加 `getDeliveryFacts` 一行：`write` 在事务里先写 `context('context-facts')` 再写 `{ workspaceId: WORKSPACE, contextId: 'context-facts', attemptedAt: '2026-10-08T00:00:01.000Z', sets: [] }`，`rolledBack: undefined`。
   - **`tests/integration/execution-relation-write-schema.test.js`** 末尾加 `006 显式 schema 审查：delivery_fact 一个执行上下文一行，父行是同一工作区的执行上下文，没有列能存凭据材料（#221）`。断言五点：
     - 列恰为 `['attempted_at','context_id','sets_json','workspace_id']`；
     - `pragma_foreign_key_list` 按 `seq` 排序后恰为 `['execution_context.workspace_id','execution_context.context_id']`；
     - 裸 SQL 插 `ws-2 × context-1` 与 `ws-1 × context-none` 抛 `FOREIGN KEY`；
     - 把 `sets_json` 改成 `'{not json'` 或 `'{}'` 抛 `CHECK`；
     - 同键再插抛 `UNIQUE` 或 `PRIMARY KEY`。
   - 先跑一次，期望：契约新用例以 `storage.putDeliveryFacts is not a function` 失败，schema 用例因为没有这张表而失败。
2. 实现：按 `Design / Spec` 的「端口」「持久化」两节修改端口、成员锁、替身、SQLite 与迁移清单。
3. 修正因新增表而失效的断言：
   - `execution-relation-write-schema.test.js` 第 57 行（期望表清单）与第 80 行（排除清单）加 `'delivery_fact'`。
   - `storage-source-version-upgrade.test.js` 在常量区加 `const AFTER_4 = MIGRATIONS.filter((entry) => entry.version > 4).map((entry) => entry.version)`。三处写死的期望要改：第 133 与 171 行的 `[5]` 改成 `AFTER_4`，第 252 行的 `[1, 2, 3, 4, 5]` 改成 `MIGRATIONS.map((entry) => entry.version)`。以后再加迁移就不必改这里。
   - `tests/contract/storage-contract.test.js` 的 `CASE_LEDGER.execution.added` 从 `13` 改为 `16`（两条新用例加一行隔离），`tests/contract/suites/storage.js` 的 `ADDED_CASE_COUNT` 从 `20` 改为 `23`。

**验证**：

    node_modules/.bin/tsc --noEmit
    node --test --test-timeout=60000 tests/contract/storage-contract.test.js tests/integration/execution-relation-write-schema.test.js tests/integration/storage-source-version-upgrade.test.js tests/integration/migration-runner.test.js

期望 `ℹ fail 0`，然后按 `Concrete Steps` 跑全量，同样期望 `ℹ fail 0`。

**回滚**：revert 本批提交。本机若已用新二进制建过库，删库重建，因为首发前没有需要保护的数据。

### Batch C2 · core：唯一写者、读路径与替身端点对齐

**最小闭环**：查询经唯一写者在一个事务里提交最后确认快照，离线、权限、截断、提交失败都不清空事实，SQLite 首读不再抛错，替身拒绝悬空端点。
**主文件**：`packages/core/src/delivery-facts.ts`、`packages/core/src/delivery.ts`、`tests/e2e/delivery-lineage.test.js`。

1. 先改 `tests/e2e/delivery-lineage.test.js` 的公共部分：
   - import 加 `mkdtempSync, readFileSync, readdirSync, rmSync`、`tmpdir`、`join`、`after`、`FaultKind`、`createFakeStorage`、`createSqliteStorage`；`compose(providers, extra = {})` 把 `extra` 展开进 `composeCore` 的参数。
   - 新增下列辅助：

         /** 摄入的唯一调用点（#221 起）：此时查询委托唯一写者；#222 只把这一处换成 `core.commands.refreshDeliveryFacts(scope)`。 */
         const ingest = (core, scope) => core.queries.getDeliveryProjection(scope)
         const ciHops = (projection) => projection.hops.filter((hop) => hop.entityKind === 'pipeline_run' || hop.entityKind === 'check_run')
         const ciFacts = (projection) => ciHops(projection).map((hop) => `${hop.externalId}:${hop.fact ?? '-'}`).sort()
         const tickingClock = () => { let n = 0; return () => new Date(Date.UTC(2026, 9, 8, 0, 0, n++)).toISOString() }
         // STORAGES：[['内存替身', { open: (p) => p.storage, reopen: (s) => createFakeStorage(exportFakeStorageState(s)) }],
         //            ['SQLite', { open: () => createSqliteStorage(<mkdtemp 目录>/lineage-N.sqlite), reopen: (s) => { const at = s.location; s.close(); return createSqliteStorage(at) } }]]

   - 规则：任何用例都不把 `ingest` 的返回值当投影用。读投影一律另调 `core.queries.getDeliveryProjection`。原因是 PR-D 里 `ingest` 返回的是刷新结果。
   - 既有用例「交付谱系：每一跳」「正向：真实链路走完后 CI 跳出现」「候选关系」「缺可选能力」：在 `startChain` 之后各加一行 `await ingest(core, chain.scope)`。「候选关系」里「重复读取不得产生第二个三元组」之前那次 `getDeliveryLineage`，改成 `await ingest(core, chain.scope)`。在本 PR 里这些改动都不改变行为。（Superseded by C7（2026-10-08）：这五行只为 #222 的切换服务，C7 把它们移出本 PR，由 #222 在把 `ingest` 换成命令时补上，见 Decision Log 第 36 行。）
2. 写红用例，用例名逐字使用下表。「base 上的红」一列是原型在 `origin/main@6417d45` 上实测的第一条失败信息。

   | 用例 | 要点 | base 上的红 |
   |---|---|---|
   | `离线保留（内存替身）：交付方离线后最后确认的 CI 仍返回并逐跳标陈旧，重启后仍在（#221）`；`离线保留（SQLite）：…` 两条由 `STORAGES` 生成 | `ingest` → 读投影（5 条 CI）→ Delivery 离线 → `ingest` → 读投影。**先**断言 `ciFacts` 不变，再断言在线时的 CI 跳 `stale === false`、离线后 CI 跳全为 `stale === true`、提交跳 `stale === false`、`degraded === true`；最后 `reopen` 后重组 core，读到的 `ciFacts` 不变 | 替身：`离线刷新不得丢掉最后确认的 CI 事实`（actual `[]`）；SQLite：`Error: FOREIGN KEY constraint failed` |
   | `唯一写者：交付事实与谱系边只经 refreshDeliveryFacts 在一个事务里写入（#221）` | 静态：递归读 `packages/**/*.ts`（跳过 `node_modules`），断言 `callers(/\.putDeliveryFacts\(/)` 恰为 `['core/src/delivery-facts.ts']`，`callers(/(?<!function )\brecordEdges\(/)` 恰为 `['core/src/delivery-facts.ts','core/src/start-work.ts']`。行为：包装根实例的 `putRelation`、`putEntity`、`putDeliveryFacts` 记录调用，包装 `transaction` 计数，一次 `ingest` 后根写入为 `[]`、事务数为 `1` | `交付事实只有一个写入调用点`（actual `[]`） |
   | `失败不清空：离线、权限被拒、Development 离线与分页截断都不把已确认事实记成不存在（#221）` | 表驱动四种故障：Delivery `Offline`、Delivery `PermissionDenied`、Development `Offline`、截断（复制 `runs[0]` 60 次，改 `externalId` 为 `run-extra-N`）。每种都是 `ingest` → 记下 `ciFacts` → 注入（故障保持到读完）→ `ingest` → 读投影 → `ciFacts` 不变、流水线跳全部 stale、`degraded` | `offline：不完整的读取不得删除、增补或改写已确认的 CI 事实` |
   | `提交失败：写者事务被拒时返回结构化结果，已确认事实逐字保留并标陈旧（#221、CONTRACTS K2）` | `ingest` 后，让 `providers.storage.transaction` 下一次调用 `Promise.reject(new Error('注入的提交失败 /secret/path'))`，再清空 `runs`；`result = await ingest(...)`。断言：`JSON.stringify(result)` 不含 `/secret/path`；`exportFakeStorageState(...).deliveryFacts[0]` 的各集合 `nodes` 与注入前逐字相同；全部 `stale === true` | `TypeError: Cannot read properties of undefined (reading '0')`（没有快照） |
   | `完整空集合才删除：确认没有运行时删除，锚点被确认不存在时下游一并删除（#221 / #222）` | 清空 `runs` 后 `ingest`：流水线跳 0、检查跳 3；再从 `providers.development.state.branches` 删掉本链分支后 `ingest`：跳类型只剩 `['has_worktree','tracks']` | 绿（回归护栏，由变异 M6、M1 证明有判别力） |
   | `乱序：较旧的读取晚提交时不覆盖较新的事实（#222 的收敛性质，由唯一写者承担）`，注册时带 `{ timeout: 5000 }` | `compose(providers, { clock: tickingClock() })`；先 `ingest` 一次；包装 `providers.delivery.listPipelineRuns`，让第一次调用读完原状态后等待 `release`；启动 `older = ingest(...)`，等它进入等待；把 `run-1` 的 `conclusion` 改成 `'failure'`；再 `ingest` 一次；放行 `older` 并等它结束；Delivery 离线后读投影，断言 `run-1` 跳的 `fact === 'ci_failed'` | `TypeError: Cannot read properties of undefined (reading 'fact')` |
   | `重复刷新收敛：N 次与一次的关系、事实与修订号相同，规划状态不变（#222、CONTRACTS K1）` | 一次 `ingest` 后记下 `[关系数, currentRevision]`；再 `ingest` 两次，两项不变；`ciFacts` 不变；`planningSnapshot` 不变 | 绿（护栏，由变异 M3 证明有判别力） |
   | `谱系写者不写命令边：开始工作的最终事务失败后刷新不补写 tracks / has_worktree（TD-009、TD-014）` | 用 Proxy 包 `providers.storage.transaction`，让事务内的 `putMutationAttempt` 抛错（最终事务 `settle` 写写账本），`startWork` 后恢复原 `transaction`。前置断言：上下文为 `provisioning`，且有 `worktreeExternalId`。`ingest` 后存储里的关系类型不含 `tracks` 与 `has_worktree` | `刷新不得把半提交"修复"成命令边` |

   最后一行的注入方式见 `tests/integration/start-work-sqlite-registration.test.js` 的 `injectAfterWrite`，这里改成「调用即抛」。
3. 在 `tests/contract/suites/storage-execution.js` 把关系端点格移进共享执行组：
   - 删掉 `storageExecutionDivergenceSuite` 的 `GRIDS` 里 `'relation'` 那一项；把文件头与函数注释里「两格」「仍分叉」的说法改成「只剩仓库一格，工作项（#196）与关系端点（#221）已对齐并移入共享执行组」。
   - 在共享组加 `${label}：关系端点必须是已登记实体，悬空时被拒绝且不留行（#221）`：`from` 与 `to` 分别为 `entity-none` 时都 `assert.rejects`，`listRelations` 为 `[]`；正控是 `entity-1 → entity-2` 被接受，之后关系数为 1。
   - 同步修改 `tests/contract/storage-contract.test.js`：
     - 两个分叉适配器的 `acceptsDanglingCoreParents` 改为 `{ repository: false }`；
     - 守卫用例改名为 `执行组守卫：依赖 core 的仓库格用例必须在两个适配器上都注册`，期望由 `[2, 2]` 改为 `[1, 1]`；
     - 注释改成关系端点已对齐；
     - `CASE_LEDGER.execution.added` 从 `16` 改为 `17`，`ADDED_CASE_COUNT` 从 `23` 改为 `24`。

   这一步先红：替身上报 `起点必须已登记`（Missing expected rejection）。
4. 在 `tests/integration/start-work-retry-identity.test.js` 的两条 #165 探针（「身份只有一处派生」「身份的作用域是仓库而不是 binding」）里，把 `getDeliveryLineage` 的返回值存为 `hops`，断言 `hops.find((hop) => hop.relationType === 'has_worktree')?.to === expectedWorktreeId(providers, workItemId)`。查询不再写边之后，旧断言 `after.length === 1` 恒真，判别力要靠这条新断言保住。它在 base 上也是绿的。
5. 实现：
   - 按 `Design / Spec` 的「写者」「chain-facts 改动」「读路径与查询」三节；
   - 在替身 `putRelation` 加端点检查；
   - `packages/core/src/index.ts` 在 `export * from './delivery.ts'` 之后加 `export * from './delivery-facts.ts'`。

**验证**：

    node --test --test-timeout=60000 tests/e2e/delivery-lineage.test.js tests/contract/storage-contract.test.js tests/integration/execution-relation-write-schema.test.js
    node --test --test-timeout=60000 tests/integration/start-work-retry-identity.test.js tests/integration/provider-binding-registration.test.js tests/e2e/status-policy.test.js
    pnpm run boundaries

期望：全部 `ℹ fail 0`，`boundaries` 退出 0。然后跑全量与 `tests/mvp0`，同样 `ℹ fail 0`。再运行 P3 原命令，期望输出 `relations 2 -> 9 | ci online 5 | ci offline 5 | degraded true`。

**回滚**：revert 本批提交。查询回到直接写边，C1 的端口与表留着，没有读方，无害。

### Batch C3 · 文档回填、变异与对抗验证、收口

**最小闭环**：矩阵、控制计划、tracker 与代码一致；变异表全部被杀死；对抗验证没有未处理的 P0 / P1；计划归档。
**主文件**：`docs/product/vertical-path.md`、`docs/exec-plan/tech-debt-tracker.md`、本计划。

1. `docs/product/vertical-path.md` §2.1：
   - **第 10 行**：成功列加 delivery-lineage 的「离线保留（内存替身 / SQLite）」；失败列改成「失败不清空」「提交失败」，删掉 P3 的「CI 跳 5 → 0」；结论改为「部分：controller 不转发投影的 stale / degraded（#222）；变更请求由直接调用替身种下（TD-002）」。
   - **13.5**：结论改为「已交付（替身与 SQLite）」，证据写上述用例。
   - **第 13 行**：结论只剩「反例：#194（P4）」，承接列去掉 #221。
   - 原句不删，用 `Superseded by` 加日期就地标注。
2. 控制计划 `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`：
   - **第 172 行**：在 `005_delivery_facts` 后追加 `Superseded by docs/exec-plan/completed/2026-10-08-delivery-fact-writer.md（2026-10-08）：005 已被 #203 的载体世代占用，交付事实是 006_delivery_facts.sql；本批另增的写入路径见该计划 Global Constraints`。
   - **第 228 行**的 `需要时先加 005_delivery_facts.sql`：同样标注。
   - **P3 观察行**（`# 观察：relations 2 -> 9 | ci online 5 | ci offline 0 | degraded true`）：追加 `Superseded by #221（2026-10-08）：PR-C 之后观察为 ci offline 5`。
   - **Progress** 加一行 3A 的完成记录，带 PR 号与回读命令。
3. `docs/exec-plan/tech-debt-tracker.md`：
   - 按 `Decision Log` 第 12 行，在 Open Items 末尾手工追加 TD-040 至 TD-044，全文见 `Interfaces and Dependencies` 末尾。
   - TD-009 收窄后保持 Open（Decision Log 第 23 行）；已解决部分的证据是「谱系写者不写命令边」用例与变异 M9、N11。
   - TD-014 移到 Superseded Items，取代依据是 ADR-0011 第 4 条：谱系写者不再写 tracks / has_worktree，触发条件从结构上不再成立；证据是「唯一写者」的静态断言与变异 M9。
   - TD-007、TD-021 不动，理由见 `Decision Log`。
4. **变异**：在 `git archive HEAD` 导出的临时目录里逐条执行 `Validation and Acceptance` 的变异表。每条变异先打出非空 diff，确认改到的是目标位置（同一文本可能出现多次），再运行指定命令（带 `--test-timeout=20000`），期望 `ℹ fail` 大于等于 1；还原后同一命令为 `ℹ fail 0`。
5. **对抗验证者**（只读）：
   - 在 PR head 上独立重跑 `Validation and Acceptance` 全表与 P3；
   - 尝试至少三种本计划没列出的打破方式，例如同一毫秒的两次刷新、Development 权限被拒、上下文 Failed 后的刷新；
   - 用 P0–P3 分级报告，不写文件。
6. **收口**：
   - 按 `docs/development/publication.md` 做发布面扫描；
   - 运行下面三条命令，期望代码约 670、不超过 800，文档不超过 1300，其余两条退出 0（代码一项 Superseded by C4–C6 的实测，2026-10-08：C6 之后是 990，见 A11 与 Decision Log 第 24、29、33 行）：

         node scripts/rule-checks.mjs size origin/main
         node scripts/rule-checks.mjs disclosure origin/main
         git diff --check origin/main...HEAD

   - 整合提交为三类：`docs(exec-plan)` 计划与 ADR、`feat(core)` 代码交付物（C1 与 C2 合并）、`docs(exec-plan)` 回填与归档；
   - 用 `comm` 比对整合前后 `git diff --name-only origin/main...` 的文件集合，期望两者相同；
   - 把本计划移到 `docs/exec-plan/completed/`，并更新 `docs/README.md` 的索引行。

**回滚**：只 revert 文档提交；代码提交独立。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| A1 | Delivery 离线时仍返回最后确认的 CI 事实并标陈旧（#221 验收 1） | 「离线保留（内存替身）」「离线保留（SQLite）」通过；P3 输出 `ci offline 5` |
| A2 | 只有一条代码路径写交付事实，失败的刷新从不清空完整的缓存（#221 验收 2） | 「唯一写者」「提交失败」通过 |
| A3 | 截断、权限受限或失败的读取从不被记成「确认不存在」（#221 验收 3） | 「离线保留（内存替身）」「离线保留（SQLite）」的故障表：离线、权限被拒、Development 离线、分页截断（C9 起是「检查分页读不完」，Decision Log 第 42 行）、查找未尽、头部提交缺失、读异常、路由失败与上下文 Failed；表里「确认没有运行」「分支确认不存在」「变更请求确认不存在」三行是正控（C7 之前分在「失败不清空」「Development 查找」「路由失败不清空」与两条「完整空集合才删除」里，且只在替身上跑）；C11 加「流水线页形非法」「变更请求查找，别的分支的 60 条排在前面」两行 |
| A4 | #221 的验收命令退出 0（#221 验收 4） | `Purpose` 里的命令输出 `ℹ fail 0` |
| A5 | 关系端点在两个 Storage 上同语义 | 契约「悬空父边与非法枚举必须被拒绝」的关系两端在两个适配器上都通过；分叉守卫为 `[1, 1]` |
| A6 | 修订号与规划状态不受交付刷新影响（K1） | 「唯一写者」的重复刷新部分 |
| A7 | 交付写者不写命令边（TD-009、TD-014） | 「谱系写者不写命令边」 |
| A8 | 006 schema 可审计、没有凭据列 | 「006 显式 schema 审查」 |
| A9 | 全量回归 | 全量 `tests/contract tests/integration tests/e2e` 与 `tests/mvp0` 都是 `ℹ fail 0`；`tsc` 无输出；`pnpm run boundaries` 退出 0 |
| A10 | 守卫有判别力 | 下面的变异表（M、N、X、Z 64 条；C6 加 12 条：第三轮对抗验证点名存活、C6 补断言后被杀死的 NV 10 条，与验收者的 Q1、Q3）全部被杀死；其余存活变异是等价变异、base 既有的缺口或已接受的边角，逐条见 C6 Progress。C7 在规模收敛后整表重做 97 条：91 条被杀死，存活的仍是 C6 判定过的 NV5、NV6、NV36、NV37、NV56、Q2，收敛前被杀死的每一条都仍被杀死。C9 在 rebase 后的导出上整表重做：X8 不再适用、由 #295 的守卫覆盖，换成等价探针 X8r；被杀死的仍是 91 条，存活的仍是这 6 条（C9 Progress）。C10 加 11 条（V2、V9、V2p、V10、V11、V9r 六条路由门，K1–K3 三条令牌探针，S1、S2 两条默认谓词），在最终代码树上整表重做 108 条：100 条被杀死，存活的是这 6 条与 K1、S1（C10 Progress）。C11 加 H1、H2、B2、T11、T17，整表 113 条：104 条被杀死，存活的是 C10 的 8 条与 T17（由 #293 杀死，Decision Log 第 50 行） |
| A11 | 规模 | `node scripts/rule-checks.mjs size origin/main`：代码不超过 800，文档不超过 1300。C6 之后代码为 990（CI 硬门 1000 以内，余量 10 行），A11 在规划上限 800 上不成立，取舍交人类（Decision Log 第 24、29、33 行）。**C7 之后代码 799，A11 成立**（观察时刻的数字与文档桶见 C7 Progress；Decision Log 第 34–37 行）。C9 之后代码 800，仍成立，但没有余量留给 K3 接线（Decision Log 第 43 行）。C10：K3 接线改由 #297 承担（Decision Log 第 45 行）；补两行完整性用例、删去两个被蕴含的时钟变体后代码仍不超过 800（C10 Progress）。C11 之后代码 800（Decision Log 第 50、51 行） |

变异表（C5 在 `93bb5e1` 的导出上整表重做；C6 在 `afcf582` 的导出上整表重做，并加 NV 与 Q 两组；C7 在规模收敛后的导出上整表重做，第三列已换成 C7 的结果）。M 系列来自定稿评审者的原型；N 系列是第一轮对抗验证修订（C4）的守卫；X 系列是实现者补做的变异；Z 系列沿用第二轮对抗验证者的编号（Z36–Z40 是 C5 为新令牌与逐跳标记补做的）。每条变异在 `git archive` 导出的临时目录里执行：先 `cmp` 与 `git diff --no-index -U0` 证明变异生效，再运行下面的命令，期望 `ℹ fail` 大于等于 1；还原后同一命令为 `ℹ fail 0`。导出目录用后删除。

    node --test --test-timeout=20000 tests/e2e/delivery-lineage.test.js tests/contract/storage-contract.test.js tests/integration/execution-relation-write-schema.test.js tests/integration/start-work-retry-identity.test.js tests/integration/storage-source-version-upgrade.test.js tests/integration/provider-binding-registration.test.js tests/e2e/status-policy.test.js

C7 的基线 223 条全绿（C6 是 235 条：C7 把 e2e 由 31 条并成 23 条，契约少两条 × 两个适配器）。第三列是 C7 变异后 `ℹ fail` 的条数，以及变红的用例（至多三个，按首次出现，多于三个记「等」；N2、N3 的条数写成区间，因为它们取决于同一毫秒令牌碰撞的运行时序，不是固定值；M14 以 `--test-timeout` 超时失败，其余用例被取消；Z39 是四个文件级超时）。C7 有 11 条按新代码等价改写了查找文本（M12、N11、N14、X6、X7、Z12、NV11、NV17、NV18、NV38、NV45，改写见 C7 Progress），变异的语义不变。以下是 C6 的记录：64 条全部 applied、变红、还原后 `ℹ fail 0`（C6 复测时 M1、M4 变红 7 条，Z12 4 条，X13 2 条，其余与本表相同）。NV 系列沿用第三轮对抗验证者的编号（第三轮已被杀死的 18 条 NV 在 C6 复测仍被杀死，不再列出），Q 系列是验收者为 C6 的判定补做的。X9–X12 在这里钉死：分支查找与变更请求查找各两条，一条把谓词缩成 `page.nextCursor === undefined`（X9、X11），一条把谓词缩成 `page.items.some(...)`（X10、X12）。

| # | 变异 | 变红 |
|---|---|---|
| M1 | `completeSets` 总是返回四个集合 | 4：离线保留（替身）、离线保留（SQLite）、刷新结果与快照时刻等 |
| M2 | 删掉写边前的 `putEntity` 循环 | 20：交付谱系、正向、候选关系等 |
| M3 | 写者事务里调用 `advanceRevision` | 1：唯一写者 |
| M4 | 不完整集合写 `stale: false` | 4：离线保留（替身）、离线保留（SQLite）、刷新结果与快照时刻等 |
| M5 | 替身 `putRelation` 删掉端点检查 | 1：替身：悬空父边 |
| M6 | 替身 `putDeliveryFacts` 按集合合并旧行 | 1：替身：整行往返 |
| M7 | `gated` 删掉 `settled` 判断 | 3：离线保留（替身）、离线保留（SQLite）、没有可提交的快照时（C9：Delivery 不再经 `settled`，2：两条离线保留的查找行） |
| M8 | 删掉乱序守卫 | 4：乱序、乱序（两个对象） |
| M9 | 写者额外写一条 `has_worktree` 边 | 1：谱系写者不写命令边 |
| M10 | 提交失败后不把集合标为陈旧 | 1：提交失败 |
| M11 | 读路径用 binding 求工作树身份 | 7：交付谱系、离线保留（替身）、离线保留（SQLite）等 |
| M12 | SQLite 读回时省略未定义的键 | 2：SQLite：整行往返、SQLite：读隔离 |
| M13 | 锚点不完整时下游仍算完整（删掉 `DevelopmentRepositoryRead` 缺口的提前返回） | 2：离线保留（替身）、离线保留（SQLite） |
| M14 | 在事务内用根实例写边 | 1：交付谱系、正向、候选关系等 |
| N1 | 写者把流水线集合的锚点存成工作树 | 1：共享头提交 |
| N2 | 令牌只用 `clock()` | 随时序 7–10：离线保留（替身）、离线保留（SQLite）、刷新结果与快照时刻等 |
| N3 | 令牌三项都不加 1 毫秒（平手） | 随时序 7–10：离线保留（替身）、离线保留（SQLite）、提交失败等 |
| N4 | 被放弃的刷新不让查询降级（`unconfirmed` 去掉 `applied` 一项） | 7：乱序、乱序（两个对象） |
| N5 | 读路径先读关系后读快照 | 1：读路径先读快照 |
| N6 | 分支存在而头部提交未知不记缺口 | 2：离线保留（替身）、离线保留（SQLite） |
| N7 | `readChainFacts` 移出 `try` | 4：离线保留（替身）、离线保留（SQLite）、刷新结果与快照时刻等 |
| N8 | 提交失败的降级写入不看乱序守卫 | 3：乱序 |
| N9 | 提交失败的降级写入不推进 `attemptedAt` | 1：提交失败 |
| N10 | 纯读路径的 `degraded` 恒为 `false` | 1：刷新结果与快照时刻 |
| N11 | Failed 的上下文藏起 tracks / has_worktree 跳 | 2：离线保留（替身）、离线保留（SQLite） |
| N12 | 替身 `getDeliveryFacts` 不克隆 | 1：替身：整行往返 |
| N13 | 替身 `putDeliveryFacts` 不克隆 | 1：替身：整行往返 |
| N14 | SQLite 读回丢掉 `anchorId` | 3：SQLite：整行往返、SQLite：读隔离、离线保留（SQLite） |
| N15 | 过渡期投影不转发刷新的结构化错误 | 4：离线保留（替身）、离线保留（SQLite）、提交失败等 |
| X1 | 替身不检查父行 | 1：替身：悬空父边 |
| X2 | 替身父行只按 id 找、不看工作区 | 1：替身：悬空父边 |
| X3 | 006 去掉复合外键 | 2：SQLite：悬空父边、006 schema 审查 |
| X4 | 006 去掉 JSON 数组 CHECK | 1：006 schema 审查 |
| X5 | SQLite 同键不覆盖（`DO NOTHING`） | 2：SQLite：整行往返、离线保留（SQLite） |
| X6 | SQLite 读绕过读队列 | 1：SQLite：读隔离 |
| X7 | SQLite 读回丢掉 `confirmedAt` 的显式 `undefined` | 2：SQLite：整行往返、SQLite：读隔离 |
| X8 | 检查读取的 `settled` 恒为真 | 2：离线保留（替身）、离线保留（SQLite）（C9：不再适用，检查读取不经 `settled`，读不完由 #295 的 `collectDeliveryPages` 报成缺口；等价探针见 X8r） |
| X8r | （C9）`collectDeliveryPages` 读完第一页就返回，不看 `nextCursor` | 3：离线保留（替身）、离线保留（SQLite）、没有可提交的快照时 |
| X9 | 分支查找：谓词只留 `nextCursor === undefined`（目标在第一页但页没读完，被当作未读完） | 2：离线保留（替身）、离线保留（SQLite） |
| X10 | 分支查找：谓词只留 `items.some(...)`（页读完而目标不在其中，被当作未读完） | 2：离线保留（替身）、离线保留（SQLite） |
| X11 | 变更请求查找：同 X9 | 2：离线保留（替身）、离线保留（SQLite） |
| X12 | 变更请求查找：同 X10 | 2：离线保留（替身）、离线保留（SQLite） |
| X13 | 写者不检查工作树锚点 | 8：刷新结果与快照时刻、乱序、乱序（两个对象） |
| X14 | 读路径取边不按锚点过滤 | 1：共享头提交 |
| X15 | 完整集合不写 `confirmedAt` | 1：刷新结果与快照时刻 |
| X16 | 写者把未观察的骨架节点也写成边 | 2：离线保留（替身）、离线保留（SQLite） |
| X17 | 流水线集合无视 Delivery 缺口 | 4：离线保留（替身）、离线保留（SQLite）、刷新结果与快照时刻等 |
| X18 | 检查集合无视变更请求集合是否完整 | 2：离线保留（替身）、离线保留（SQLite） |
| Z1 | tracks 跳不要求 `to` 是本上下文 | 1：共享头提交 |
| Z2 | has_worktree 跳不要求 `from`、`to` | 1：共享头提交 |
| Z3 | `unconfirmed` 去掉 `!refreshed.ok` | 1：没有可提交的快照时 |
| Z4 | 降级不看刷新的缺口 | 1：没有可提交的快照时 |
| Z9 | `toFact` 丢掉 `label` | 2：离线保留（替身）、离线保留（SQLite） |
| Z12 | CI 跳的 provenance 标成 Command | 10：离线保留（替身）、离线保留（SQLite）、共享头提交等 |
| Z16 | `hop.unavailable` 恒为 `false` | 2：离线保留（替身）、离线保留（SQLite） |
| Z24 | 守卫 `>=` 改 `>`（平手也提交） | 1：乱序（两个对象） |
| Z26 | 删掉 Development 路由失败的缺口 | 3：离线保留（替身）、离线保留（SQLite）、没有可提交的快照时 |
| Z31 | 006 的 `attempted_at` 去掉 NOT NULL | 1：006 schema 审查 |
| Z32 | 006 的 `sets_json` 去掉 NOT NULL | 1：006 schema 审查 |
| Z35 | 提交失败的结果里 `anchored` 为 false | 1：刷新结果与快照时刻 |
| Z36 | 令牌去掉「已提交值加 1」一项 | 2：刷新结果与快照时刻、乱序（两个对象） |
| Z37 | 令牌去掉「对象内上一次令牌」一项 | 1：刷新结果与快照时刻 |
| Z38 | 取令牌的读失败不吞掉 | 1：刷新结果与快照时刻 |
| Z39 | 逐跳标陈旧也标命令事实 | 4：（文件级超时） |
| Z40 | 不逐跳标陈旧 | 7：乱序、乱序（两个对象） |
| NV1 | 检查的边挂到工作树 | 1：共享头提交 |
| NV2 | 变更请求的边挂到提交 | 1：共享头提交 |
| NV3 | 端点实体一律登记成 `commit` | 1：共享头提交 |
| NV4 | 被放弃时只把流水线与检查跳标陈旧 | 7：乱序、乱序（两个对象） |
| NV7 | 变更请求取列表第一条，不按头部提交匹配 | 2：离线保留（替身）、离线保留（SQLite） |
| NV11 | 写者多写一条 `planning.project` 同步游标 | 1：唯一写者 |
| NV17 | has_worktree 跳丢掉分支 label | 1：共享头提交 |
| NV18 | tracks 跳丢掉外部 id | 1：共享头提交 |
| NV25 | 从未确认的集合存成 `stale: false` | 1：没有可提交的快照时 |
| NV40 | 事务内吞掉 `putDeliveryFacts` 的异常（边提交、快照没写） | 1：提交失败 |
| Q1 | `unconfirmed` 只认有锚点的被放弃刷新（C5 的判定） | 7：乱序、乱序（两个对象） |
| Q3 | 四个集合一律算完整 | 4：离线保留（替身）、离线保留（SQLite）、刷新结果与快照时刻等 |
| V2 | （C10）`readChecks` 的路由门换成 `bindingForCapability` 直取，不看能力与策略 | 2：离线保留（替身）、离线保留（SQLite） |
| V9 | （C10）`readChangeRequest` 改按 `DevelopmentRepositoryRead` 路由 | 2：同上 |
| V2p | （C10）`readPipelines` 的路由门换成 `bindingForCapability` 直取 | 2：同上 |
| V10 | （C10）`readChecks` 按流水线读能力路由 | 2：同上 |
| V11 | （C10）`readPipelines` 按检查读能力路由 | 2：同上 |
| V9r | （C10）锚点（分支头）读取按变更请求读能力路由 | 3：离线保留（替身）、离线保留（SQLite）、没有可提交的快照时 |
| K2 | （C10）令牌取三项的最小值 | 5：离线保留（替身）、离线保留（SQLite）、刷新结果与快照时刻等 |
| K3 | （C10）令牌去掉「已提交值加 1」（与 Z36 同义，作对照） | 3：离线保留（替身）、刷新结果与快照时刻、乱序（两个对象） |
| S2 | （C10）`settled` 的默认谓词恒假 | 15：交付谱系、正向、缺可选能力等 |
| H1 | （C11）变更请求查找不传 `headBranch` | 3：离线保留（替身）、离线保留（SQLite）、两个上下文共享同一头提交 |
| H2 | （C11）变更请求查找按 `main` 过滤，不按工作树的分支 | 13：交付谱系、离线保留（替身）、离线保留（SQLite）等 |
| B2 | （C11，评审编号）`collectDeliveryPages` 去掉页形守卫 | 2：离线保留（替身）、离线保留（SQLite）（「流水线页形非法」） |
| T11 | （C11，评审编号）降级事务的乱序守卫 `>=` 改 `>` | 1：乱序（两个 core 上下文对象，较旧的读取提交失败） |
| T17 | （C11，评审编号）事务内守卫按集合的 `confirmedAt` 判断 | 0：本 PR 单独合并时存活，#293 的「较新的读取遇到 Development 离线」变体杀死（Decision Log 第 50 行） |
| H5 | （C12 复测）变更请求查找的 `find` 不再比对 `sourceVersion` | 2：离线保留（替身）、离线保留（SQLite）（「变更请求确认不存在」） |
| G1 | （C12 复测，评审编号）交付写者模块里加一个不可达的直接 `putRelation` 调用点 | 0：本 PR 单独合并时存活，#293 的 `.putRelation(` 静态断言杀死（Decision Log 第 50 行） |
| R1 | （C12）变更请求查找谓词去掉 `Array.isArray(page.items)` | 0：本 PR 单独合并时存活，#293 完整性表的「变更请求页形非法」杀死（Decision Log 第 53 行） |

## Progress

- [x] (2026-10-08 CST) 定稿评审。核对三份设计与 base 事实（E1–E6）；按 K1–K8 与 K3 补充裁决分歧；在导出副本里实施本计划的原型（不提交），测得 C1 与 C2 全绿、14 条变异全部被杀死、规模约 670 行；写入本计划、ADR-0011 与两份索引行。
- [x] (2026-10-08 01:12 CST) Batch C1：存储层红 → 绿（执行上下文 `.worktrees/delivery-fact-writer`，base `origin/main@6417d45`，Node v26.10.0）。
  - 开工前：工作区干净，`import.meta.resolve('@harness-projects/core')` 落在本工作树的 `packages/core/src/index.ts`，`origin/main` 未前移。
  - 红：`node --test --test-timeout=60000 tests/contract/storage-contract.test.js tests/integration/execution-relation-write-schema.test.js`，153 条里 8 条失败：契约新用例 3 条 × 两个适配器共 6 条，第一条断言信息是 `TypeError [Error]: storage.putDeliveryFacts is not a function`（读隔离那一行是 `tx.putDeliveryFacts is not a function`）；`006 显式 schema 审查` 失败，信息 `四列全部被审计`、actual `[]`（没有这张表）；`storage 契约套件切分守卫` 失败，`execution` 实际 19、期望 16（台账尚未加 3）。失败集合与计划一致，台账那条是计划第 3 步要改的计数。
  - 绿之前的连带失败（计划 S3、第 3 步已预见）：加上 006 后，`空库建出 L3 十一张表`、`D8` 两处表清单，以及 `storage-source-version-upgrade` 的 U3、U5 / U7、U9 三条写死「005 是最后一个迁移」的断言，按计划第 3 步修正（表清单加 `delivery_fact`，`AFTER_4`，台账 13 → 16、`ADDED_CASE_COUNT` 20 → 23）。
  - 绿：`node_modules/.bin/tsc --noEmit` 无输出；上述四个文件（加 `migration-runner`）168/168；全量 `tests/contract tests/integration tests/e2e` 1213/1213（基线 1206，净增 7：契约 3 条 × 2 个适配器加 1 条 schema 审查）；`tests/mvp0` 7/7。
  - 变异（`git archive` 导出的临时目录，逐条先 `cmp` 与 `git diff --no-index -U0` 证明生效，再跑 `tests/contract/storage-contract.test.js` 或 schema 审查，还原后同命令全绿）：M6、M12 与本批新增的 X1 替身不检查父行、X2 替身父行只按 id、X3 006 去掉复合外键、X4 006 去掉 JSON 数组 CHECK、X5 SQLite 同键不覆盖、X6 SQLite 读绕过读队列、X7 SQLite 读回丢掉 `confirmedAt` 的显式 `undefined`，共 9 条，全部变红（各 1–2 条用例）且还原后 `ℹ fail 0`。
- [x] (2026-10-08 01:26 CST) Batch C2：core 红 → 绿（执行上下文 `.worktrees/delivery-fact-writer`，基于 C1 提交 `94309ce`，base `origin/main@6417d45`）。
  - 红：`node --test --test-timeout=60000 tests/e2e/delivery-lineage.test.js`，16 条里 7 条红、9 条绿，与计划表一致：
    - `离线保留（内存替身）`：`离线刷新不得丢掉最后确认的 CI 事实`，actual `[]`；
    - `离线保留（SQLite）`：`Error: FOREIGN KEY constraint failed`；
    - `唯一写者`：`交付事实只有一个写入调用点`，actual `[]`；
    - `失败不清空`：第一种故障 `Delivery 离线：不完整的读取不得删除、增补或改写已确认的 CI 事实`，actual `[]`；
    - `提交失败`：`TypeError: Cannot read properties of undefined (reading 'sets')`（计划记的是 `reading '0'`，差别见 S9）；
    - `乱序`：`TypeError: Cannot read properties of undefined (reading 'fact')`；
    - `谱系写者不写命令边`：`刷新不得把半提交"修复"成命令边，实际 tracks,has_worktree,derived_from,runs_on,runs_on`，前置的 `provisioning` 与 `worktreeExternalId` 断言已通过；
    - 两条护栏（`完整空集合才删除`、`重复刷新收敛`）与既有的 7 条在 base 上都是绿的。
  - 红（替身端点对齐）：`node --test --test-timeout=60000 tests/contract/storage-contract.test.js tests/integration/start-work-retry-identity.test.js`，149 条里只有 1 条红：`内存 Storage 替身：关系端点必须是已登记实体…`，`AssertionError: Missing expected rejection: 起点必须已登记`；SQLite 适配器同一用例是绿的，两条 #165 探针补上 `hop.to` 断言后在 base 上也是绿的。
  - 实现一次到全绿：C2 验证命令三条（`delivery-lineage` + 契约 + schema 共 172 条；`start-work-retry-identity` + `provider-binding-registration` + `status-policy` 共 41 条）都是 `ℹ fail 0`；`pnpm run boundaries` 退出 0；`tsc --noEmit` 无输出；全量 `tests/contract tests/integration tests/e2e` 1225/1225（C1 为 1213，净增 12：计划的 9 条 e2e，加下面三条补充用例；共享组新增的关系端点用例与分叉格里移走的那一格各 2 条，相抵）；`tests/mvp0` 7/7。
  - P3 原命令：`relations 2 -> 9 | ci online 5 | ci offline 5 | degraded true`（base：`ci offline 0`）。SQLite 版 P3：`ci online 5 | ci offline 5 | all stale true | commit stale false | degraded true`（base 上这一路抛 `FOREIGN KEY constraint failed`）。
  - 补充用例（计划之外，理由见 Decision Log 第 15 行与 S10）：`Development 查找`、`刷新结果与快照时刻`、`读路径按本上下文的工作树取 derived_from`（第三条在 C5 删除，见 Decision Log 第 31 行）。
  - 变异（`git archive` 导出的临时目录，逐条先 `cmp` 与 `git diff --no-index -U0` 证明生效）：M1–M14 全部变红，各自变红的用例与计划表一致或更多（M2 是 12 条，M14 是整组超时失败）；补充的 X8–X15 全部变红；还原后同一命令 `ℹ fail 0`。C3 在最终 head 上整表重做。
  - 规模：`git diff origin/main --numstat` 排除 `docs/` 与 `.md` 后增 656、删 134，合计 790（计划估算 670，规划上限 800）。
- [x] (2026-10-09 CST) Batch C3：回填、变异、对抗验证、整合与归档。实现者部分 2026-10-08 01:37 CST 完成，对抗验证见 C4–C10，整合、推送与归档由协调者在 C11–C12 之后完成：
  - [x] 回填（文档，只改计划的文件集合）：
    - `docs/product/vertical-path.md` §2.1：第 10 行由「反例：#221（P3）」升为「部分：controller 不转发投影的 stale / degraded（#222）；变更请求由直接调用替身种下（TD-002）」，13.5 升为「已交付（替身与 SQLite）」，第 13 行只剩「反例：#194（P4）」，承接列去掉 #221；成功 / 失败 / 旁证各格与「结论计数」「13.x 共 10 面」就地加 `Superseded by 2026-10-08（#221）`，原句保留；P3 探针的观察行加 `Superseded`；新增一段「第 10、13 行与 13.5 的 #221 订正」，写明回读范围。升级证据见 Decision Log 第 16 行。
    - 控制计划：第 172 行与第 228 行的 `005_delivery_facts` 加 `Superseded by`（005 已被 #203 的载体世代占用，交付事实是 `006_delivery_facts.sql`），P3 观察行加 `Superseded by #221（2026-10-08）：PR-C 之后观察为 ci offline 5`，Progress 的 Batch 3 下加 3A 一行（PR #292，回读命令）。
    - 债务表：Open Items 末尾手工追加 TD-040 至 TD-044（「同上」按计划表展开为本计划路径、`feature/delivery-fact-writer`、`#221 定稿评审者`）；TD-009 收窄后保持 Open（Decision Log 第 23 行），TD-014 移到 Superseded Items（新增该节的表头），两行的证据与依据写在最后一列；TD-007、TD-021 不动。
  - [x] 回读：矩阵引用的四个用例按矩阵的回读命令（不加 `--test`，`--test-name-pattern`）在本工作树逐条回读，`离线保留（内存替身）`、`离线保留（SQLite）`、`失败不清空`、`提交失败：写者事务被拒时` 各读回一行 ✔、`ℹ tests 1`、`ℹ fail 0`，伪造前缀 `不存在的前缀` 都读回 `ℹ tests 0`、`ℹ fail 0`，命令退出码 0。exec-plan 技能自带的 `lint_execplan.py` 输出 `OK`；`node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js` 为 `ℹ fail 0`（9/9）；`node scripts/workflow-check.mjs` 无发现。
  - [x] 变异（在 `git archive 3db4aaf` 导出的临时目录里，逐条先 `cmp` 与 `git diff --no-index -U0` 证明生效，再跑指定用例，`--test-timeout=20000`；还原后同一命令全绿）：M1–M14 全部变红，各自变红的用例与上方表一致或更多（M2 变红 14 条，M14 变红 6 条，M5、M6、M12 各变红 1 条契约用例），补充的 X1–X15 全部变红；共 29 条，全部 `applied=True`、变异后 `ℹ fail` 至少 1、还原后 `ℹ fail 0`。导出目录已删除。
  - [x] K3 回读：`git ls-tree origin/main packages/core/src/development-route.ts` 无输出（`origin/main@6417d45`，PR-B #291 未合并），本 PR 不做 `routeDevelopment` 替换。
  - [x] 对抗验证已由独立验证者在 `3aef993` 上执行，发现的修订见下面的 C4。
  - [x] (2026-10-09 CST) 协调者：发布面人工五类目检查、整合为规划 / 代码 / 回填归档三个提交、精确 lease 推送、移到 `completed/` 并把 `docs/README.md` 的索引行移进 Completed 表；合并由评审会话按人类伙伴的直接授权进行（rebase merge）。
- [x] (2026-10-08 01:55 CST) Batch C0：规划提交 `b7c8fb3` 推送，开 draft PR #292（`closingIssuesReferences` = #221，#221 的 `closedByPullRequestsReferences` = #292）；`gh stack link 292 293` 建成原生栈 #294；`node scripts/policy-check.mjs pr 292` 通过；#221 `Status` 置 In Progress（见 Decision Log）。
- [x] (2026-10-08 02:24 CST) Batch C4：对抗验证（`3aef993`）发现的修订。执行上下文 `.worktrees/delivery-fact-writer`，base `origin/main@6417d45`，Node v26.10.0；代码与测试一个本地提交，文档一个本地提交。
  - 逐条处置（P1 一条、P2 五条、P3 四条；发现全部属实，复现命令的输出与验证者一致）：

    | 发现 | 处置 | 判别证据 |
    |---|---|---|
    | P1 共享头提交时 CI 跳挂到别的上下文的提交 | 修：集合记录 `anchorId`，读回按 `(from, type, to)`（S12，Decision Log 18） | 「两个上下文共享同一头提交」；N1、X14 |
    | P2 乱序守卫同一毫秒打平 | 修：严格递增的读取开始时刻（S13，Decision Log 19） | 「乱序」六个变体；N2、N3 |
    | P2 先读关系后读快照 | 修：先快照后关系（S16，Decision Log 22） | 「读路径先读快照再读关系」；N5 |
    | P2 头部提交未知被当成没有 head | 修：记缺口（S15，Decision Log 21） | 「失败不清空」的「分支头部提交缺失」；N6 |
    | P2 TD-009 过度声明、Failed 无用例 | 部分：TD-009 回 Open 并收窄，补 Failed 用例与候选边断言，不做门控（S17，Decision Log 23） | 「Failed 的上下文仍显示 tracks 与 has_worktree 跳」；N11 |
    | P2 K2 读取阶段的异常 | 修：读取进 `try`，错误转发进过渡期的投影（S14，Decision Log 20） | 「失败不清空」的「provider 抛出裸异常」；N7、N15 |
    | P3 墙钟回拨时刷新被静默丢弃 | 修：进程内由严格递增时刻消除；重启后的回拨由「被丢弃的刷新让投影降级」兜底（Decision Log 19；C5 起令牌取自已提交快照，回拨后的刷新照常生效，见 Decision Log 26） | 「刷新结果与快照时刻」；N4 |
    | P3 变异存活的测试缺口 | 补：Y1 检查截断、Y3、Y8、Y14、Y18、Y21 / Y22、Y4 各有用例；Y5 `hop.unavailable` 不补（Decision Log 25） | X8、N8、N9、X13、N11、N12 / N13、N10 |
    | P3 投影丢掉结构化错误、写者 catch 没有诊断 | 半修：转发错误；不加内部 cause（Decision Log 20、25） | N15 |
    | P3 文档订正 | 修：S18 的①–⑥ | `tests/contract/plan-facts-consistency.test.js`、`content-placement.test.js` 9/9 |
    | P3 规模与过程 | 记：Decision Log 24；整合提交、标题改写、TD 依赖 ADR 的注记（tracker） | `node scripts/rule-checks.mjs size origin/main` |

  - 红（先写用例再修）：新的 `tests/e2e/delivery-lineage.test.js` 在 `3aef993` 的导出上 27 条里 8 条红，其余护栏用例为绿，由 N 系列变异证明有判别力。红的是：`失败不清空`（头部提交缺失，再往后的读异常在同一个用例里，另按条目逐个回放：`分支头部提交缺失` 红，`provider 抛出裸异常` 红，第一条断言信息 `PROVIDER-RAW /secret/path`，其余五种故障绿）、`两个上下文共享同一头提交`（`流水线跳挂在本上下文自己的提交上，不是别的上下文的`）、`读路径先读快照再读关系`（`快照里的六个 CI 节点都有跳`）、`刷新结果与快照时刻`（并入了「重启后时钟早于已提交时刻」，`被丢弃的刷新让投影降级`）、`乱序` 的时钟不前进与时钟回拨各两个变体（`较旧的读取晚提交时不得覆盖较新的事实`、`较旧读取的失败也不得把较新已确认的集合标陈旧`）。时钟递增的两个变体在修复前后都是绿（原有的守卫用例）。
  - 绿：`node_modules/.bin/tsc --noEmit` 无输出；`tests/e2e/delivery-lineage.test.js` 27/27；#221 的验收命令（含契约与 schema 审查）180/180；全量 `tests/contract tests/integration tests/e2e` 1233/1233（C2 为 1225，净增 8：e2e 由 19 增到 27 条，其余不变）；`tests/mvp0` 7/7；`pnpm run boundaries` 退出 0；`node scripts/workflow-check.mjs` 无发现。P3 原命令仍输出 `relations 2 -> 9 | ci online 5 | ci offline 5 | degraded true`；验证者的 P1 复现脚本（两个工作项、同一仓库）在修复后两个上下文的流水线跳都回指各自的提交。
  - 变异（在 `git archive` 导出的临时目录里，逐条先 `cmp` 与 `git diff --no-index -U0` 证明生效，再跑指定用例，`--test-timeout=20000`；还原后同一命令全绿，导出目录已删除）：M1–M14、X1–X18、N1–N15 共 47 条，全部 applied、变异后 `ℹ fail` 至少 1、还原后 `ℹ fail 0`。整表在最终代码提交的导出上重做（文档提交只改文档）。
  - 规模：`node scripts/rule-checks.mjs size origin/main` 代码 903 / 1000（C3 时 790，规划上限 800，超出 103 行），文档见 Outcomes；决策见 Decision Log 第 24 行。
- [x] (2026-10-08 05:30 CST) Batch C5：第二轮对抗验证（`ed554d0`）发现的处置。执行上下文 `.worktrees/delivery-fact-writer`，base `origin/main@6417d45`，Node v26.10.0；代码与测试一个本地提交（`93bb5e1`），文档一个本地提交，本批之前已有 6 个未推送的本地提交。
  - 逐条处置（P2 三条、P3 七条；每条先复现，复现脚本是运行态文件，不入库，输出写在表里）：

    | 发现 | 复现 | 处置 | 判别证据 |
    |---|---|---|---|
    | P2 被放弃的刷新在逐跳上看不见（墙钟领先、时钟回拨） | 属实：时钟拨回一小时的第二个 core 对象刷新被放弃，`run-1` 的跳是 `ci_passed`、`stale = false`、投影 `degraded = true`；同一对象背靠背 25 次刷新后，已提交时刻领先墙钟 21 毫秒，另一个对象立刻刷新被放弃 | 修：令牌取已提交值加 1 毫秒（S19、S20，Decision Log 第 26 行）；被放弃或失败的刷新让 provider 读取的跳逐跳标陈旧（Decision Log 第 27 行） | 「被放弃的刷新」「刷新结果与快照时刻」在 `ed554d0` 的导出上变红；N2、N3、N4、Z3、Z24、Z36、Z37、Z39、Z40 |
    | P2 A11 规模，Decision Log 第 24 行的理由与数字矛盾 | 属实：`node scripts/rule-checks.mjs size origin/main` 在 `ed554d0` 上是代码 903 / 1000（规划上限 800），C5 后 988 | 不修，交协调者：设计膨胀审查、D3 两半的行数（存储层约 218、core 约 770，关系端点对齐随写者走则约 173 与 815）与估算表都已改成实测（Decision Log 第 24、29 行） | 无（决策项） |
    | P2 路由失败分支没有用例（Z26 存活） | 属实：删掉 `route?.ok === false` 那行，相关测试全绿；在线刷新后重组没有 Development 能力的 core，快照被整组删除 | 补：「路由失败不清空」；K3 的「多挂载 fail closed」改成可验证的说法（S21、S22） | Z26、Z16 |
    | P3 X12 存活 | 属实：变更请求被完整读到并确认不存在时，X12 把它当作未读完，变更请求与检查标陈旧而不是删除 | 补：「完整空集合才删除：变更请求被完整读到并确认不存在时…」；X9–X12 的定义在 Validation 钉死 | X12、X10 |
    | P3 其它存活变异（Z1、Z2、Z3、Z4、Z9、Z12、Z16、Z24、Z31、Z32、Z35）与 `apps/` 未扫 | 属实：逐条变异存活 | 补：共享头提交的用例扩到 tracks / has_worktree；「没有可提交的快照时」（首次刷新失败、只有缺口、首次读取就截断）；来源标注与 label 非空；006 的 NOT NULL 审查；`anchored` 断言；单写者静态扫描加上 `apps/`；`unavailable` 用 `policy` 构造（S23） | 11 条变异都被杀死 |
    | P3 令牌的 `WeakMap` 只在一个对象内 | 属实：两个 core 对象、常量时钟、旧读取晚提交，`older A applied true`，最终 `ci_passed` | 修：同第一条 | 「被放弃的刷新」；Z36、Z37 |
    | P3 计划自相矛盾、过程项 | 属实 | 修：Decision Log 第 3、19、25 行；C3 步骤、文件集合与 C3 Progress 里 TD-009 的说法；估算表；A10、A11；Progress 按时间排序；C0 的复选框。tracker 的 TD-009 本来就注明「解决的部分依赖 ADR-0011 被采纳」，没有改 | `lint_execplan.py` 输出 `OK`、`content-placement`、`plan-facts-consistency` 9/9 |
    | P3 K2 只对写者成立 | 属实：`getDeliveryFacts` 抛错时 `getDeliveryProjection` 带原文 reject | 收窄 K2 与 ADR-0011 第 8 条到唯一写者，不折成降级投影（S24，Decision Log 第 28 行） | 无（文字） |
    | P3 首次读取截断时 base 显示 50 条、head 没有 | 属实，是 TD-040 已写明的取舍 | 保留，用例钉住，请协调者确认（Decision Log 第 30 行） | 「没有可提交的快照时」第三段 |
    | P3 发布状态：本地提交未推送、PR #292 的 head 与正文是旧的、提交 `3db4aaf` 标题误导 | 属实 | 不在实现者范围：整合提交、重写标题、刷新 PR 正文、备份引用加 force-with-lease 推送、TD-045 由协调者做（C7 订正：TD 号见 Decision Log 第 38 行） | 无 |

  - 红（先写用例再修）：新的 `tests/e2e/delivery-lineage.test.js` 与 `execution-relation-write-schema.test.js` 在 `ed554d0` 的导出上 44 条里 2 条红，其余是由变异证明有判别力的护栏。红的是：`被放弃的刷新`（`较旧的读取晚提交时不得覆盖较新的事实`，actual `ci_passed`、expected `ci_failed`）和 `刷新结果与快照时刻`（`令牌按已提交的 attemptedAt 递增：重启后时钟回拨的刷新照常生效，不等时钟追上`，actual `false`、expected `true`）。
  - 绿：`node_modules/.bin/tsc --noEmit` 无输出；`tests/e2e/delivery-lineage.test.js` 31/31；#221 的验收命令 184/184；全量 `tests/contract tests/integration tests/e2e` 1237/1237（C4 为 1233，净增 4：e2e 由 27 增到 31）；`tests/mvp0` 7/7；`pnpm run boundaries` 8/8；`node scripts/workflow-check.mjs` 无发现；`node scripts/rule-checks.mjs disclosure origin/main` 与 `git diff --check origin/main...HEAD` 通过。P3 原命令仍输出 `relations 2 -> 9 | ci online 5 | ci offline 5 | degraded true`。
  - 变异：M、N、X、Z 共 64 条（M 14 条、N 15 条、X 18 条、Z 17 条）在最终代码提交的导出上整表重做，全部 applied、变红、还原后 `ℹ fail 0`；N2、N3、N4、X14 等按新代码重新定义，表见 Validation。导出目录已删除。
  - 规模：代码 988 / 1000（规划上限 800，超出 188 行），文档见 Outcomes。

- [x] (2026-10-08 06:45 CST) Batch C6：最终验收与重构（验收者）。执行上下文 `.worktrees/delivery-fact-writer`，base `origin/main@6417d45`（`git fetch` 后核对未前移），Node v26.10.0，pnpm 10.28.2；起点 `0bf8b70`，工作区干净。代码与测试一个本地提交（`afcf582`），注释订正一个本地提交（`a8e2a14`），文档一个本地提交；未推送、未写 GitHub。
  - 起点复跑：`node_modules/.bin/tsc --noEmit` 无输出；全量 `tests/contract tests/integration tests/e2e` 1237/1237；`tests/mvp0` 7/7；`size` 代码 988、文档 1033；`disclosure` 与 `git diff --check origin/main...HEAD` 通过。
  - 第三轮对抗验证（`0bf8b70`）的处置：

    | 发现 | 复现 | 处置 | 判别证据 |
    |---|---|---|---|
    | P2 没有锚点的刷新把旧快照当新鲜显示 | 属实：`{"n":9,"ci":5,"staleProvider":0,"degraded":false}`（S25） | 修：`unconfirmed` 一行（Decision Log 第 31 行）；修复后同一探针 `{"n":9,"ci":5,"staleProvider":7,"degraded":true}`，从未开始工作的作用域仍 `degraded false` | 「被放弃的刷新」新增的无锚点断言在 `0bf8b70` 的代码上变红（31 条里 1 条，信息 `没有锚点的刷新什么也没读：旧快照照样显示，但逐跳标陈旧并降级`）；Q1 |
    | P2 A11 规模 | 属实 | 不修，交人类（Decision Log 第 33 行） | 无 |
    | P2 三条契约级守卫没有判别断言（K5、事务内回滚、从未确认集合的陈旧） | 属实（S26） | 补断言，不新增用例（Decision Log 第 32 行） | NV11、NV40、NV25 由存活变为杀死 |
    | P3 拓扑与属性断言缺口、升级测试同义反复 | 属实 | 补断言；升级测试改回字面期望 | NV1、NV2、NV3、NV4、NV7、NV17、NV18 由存活变为杀死；NV6 见下 |
    | P3 计划与代码不一致（I8、Decision Log 第 15 行引用已删的用例，C3 第 6 步的「约 670」） | 属实 | 订正（Decision Log 第 31 行补记删除） | `lint_execplan.py` OK |
    | P3 残留：平手时较新的读取被放弃、共享头提交选错变更请求、读半边原样 reject、首次截断不显示 | 属实（按设计） | 不修，交人类，TD 号段已用完（Decision Log 第 26、28、30、33 行） | 无 |
    | P3 发布状态 | 属实 | 不在验收者范围（不推送、不改写历史） | 无 |
    | （验收者自查）矩阵回读前缀撞名 | `「失败不清空」` 回读 `ℹ tests 2` | 改成唯一前缀（S27） | 回读各 `ℹ tests 1`，负对照 `ℹ tests 0` |

  - 重构（行为不变，不删判别断言）：写者每个集合只算一次 `setOf`；e2e 新增 `flood`、`throwInside` 两个辅助，取代四处 60 条造数与两处事务内注入；契约夹具 `deliveryFacts` 复用 `facts(...)`；`DeliveryRefreshResult.applied` 的注释列出全部为 false 的情形。
  - 绿：`tsc --noEmit` 无输出；全量 1237/1237（条数不变：只加断言，不加用例）；`tests/mvp0` 7/7；`pnpm run boundaries` 8/8；#221 的验收命令按 issue 原文（不带 `--test-timeout`）184/184、退出 0；P3 原命令 `relations 2 -> 9 | ci online 5 | ci offline 5 | degraded true`；`node scripts/workflow-check.mjs` 无发现；矩阵引用的四个用例按矩阵回读命令各 `ℹ tests 1`。
  - 变异：在 `git archive afcf582` 的导出目录里，用第三轮对抗验证者的规格整表重做 97 条（M、N、X、Z 64 条，NV 30 条，Q 3 条；N4、Z3、NV36、NV40 按新代码改写了查找文本），每条先 `cmp` 与 `git diff --no-index -U0` 证明生效，再跑 Validation 的 7 文件命令（`--test-timeout=20000`），用 `/bin/cp -f` 还原后同一命令 `ℹ fail 0`。M、N、X、Z 64 条全部变红（M14 在整表里以进程超时计；另用 `--test-timeout=2000` 只跑 e2e 文件单独复测，`ℹ fail 1`，还原后 31/31）；NV 与 Q 的 33 条里 27 条变红。7 文件命令下存活的 6 条在全量（含 `tests/mvp0`，基线 1244 条全绿）上重跑仍存活，逐条判定：NV36（不完整集合里只有未观察的骨架节点，过滤后为空）、NV37（006 的复合外键保证没有执行上下文就没有快照行）、NV56（没有 head 时下游读取不会产生缺口）是等价变异；NV6 只改变 provider 调用与返回的缺口，写者没有锚点时提前返回，存储状态相同；NV5（空 `workItemId` 时 `degraded` 的取值）是 base 既有代码，本 PR 未改，没有用例；Q2 只在「有锚点、被放弃、快照里没有 provider 跳」时改变 `degraded`，是 Decision Log 第 31 行接受的边角。导出目录已删除。
  - 规模：`node scripts/rule-checks.mjs size origin/main` 代码 990 / 1000（C5 为 988），文档 1079 / 1500（提交之后量，S28）。

- [x] (2026-10-08 10:05 CST) Batch C7：规模收敛（验收之后）。执行上下文 `.worktrees/delivery-fact-writer`，base `origin/main@6417d45`（`git ls-remote origin refs/heads/main` 回读未前移），起点 `d1fc382`，工作区干净；恢复锚点 `backup/delivery-fact-writer-pre-shrink`。只做本地提交，不改写已有历史、不推送、不写 GitHub。
  - 起点：`node scripts/rule-checks.mjs size origin/main` 代码 990（实现 418、测试 572），文档 1079。人类伙伴的规划上限是 800，要求先找 dead code 与可简化的部分，不机械拆分，也不删唯一能杀死某个变异的判别断言。
  - 先建「变异 → 杀死它的全部用例」表：在 `git archive d1fc382` 的导出上把 97 条规格重跑一遍，用 TAP 记录每条变异的全部变红用例（C6 的日志只记前三个）。91 条被杀死，存活的 6 条与 C6 相同。没有独占杀死任何变异的用例是「离线保留（内存替身）」「唯一写者」和「乱序」的六个变体；其中「时钟递增」「时钟回拨」四个变体杀死的变异，都被「时钟不前进」的两个变体覆盖（S29）。其余每条新用例都至少独占一条变异，所以收敛只能靠合并同构场景、共享夹具和去掉被蕴含的断言。
  - 删改清单（每处为什么不损失判别力，见 Decision Log 第 34–37 行）：

    | 位置 | C7 的改动 | 判别力的去向 |
    |---|---|---|
    | e2e「失败不清空」「Development 查找」「路由失败不清空」、两条「完整空集合才删除」、「Failed 的上下文仍显示 tracks 与 has_worktree 跳」 | 合成一张 17 行的完整性表 `COMPLETENESS`，由两条「离线保留（内存替身 / SQLite）」各跑一遍。每行断言：不转发异常原文与结构化错误、CI 事实、保留的跳的种类、降级、逐跳的陈旧与 `unavailable`、重启后读回 | 通用断言比原来的更强：逐跳比较陈旧，原来只看一类跳；CI 事实整体相等，原来只数条数；`unavailable` 每行都断言。SQLite 也从只有离线一种故障扩到整张表。原来独占的 N6、N11、X8–X12、X18、Z16、NV7、NV8、NV15 都由这两条杀死 |
    | e2e「重复刷新收敛」 | 并入「唯一写者」：同一条链先断言单事务，再刷新两次，断言关系、修订号、事实、规划与游标都不变 | M3、NV11 由「唯一写者」独占杀死 |
    | e2e「被放弃的刷新」 | 成为「乱序」的第七个变体（两个 core 上下文对象）。被放弃的刷新与没有锚点的刷新逐跳标陈旧，这两条断言七个变体都做 | Z24 由第七个变体独占；N4、Z40、NV4、NV9、Q1 被七个变体杀死 |
    | e2e「同一个 core 上下文对象内并发的两次刷新令牌不平手」 | 并入「刷新结果与快照时刻」：时钟回拨的那个对象同时发起两次刷新，两次都要被应用 | Z37 仍由它独占 |
    | e2e 夹具 | 新增 `chainOf`（开始工作、建变更请求，默认再摄入一次）和 `stub`；`flood` 加条数参数；`throwInside` 与 `holdFirstRead` 改用它们（后者用 `Promise.withResolvers`） | 只改构造，不改断言 |
    | e2e 冗余 | 删掉没有使用的 `makeRelation`、`chainEntityId` 导入。删掉「两个上下文共享同一头提交」里的「流水线跳挂在本上下文自己的提交上」：同一用例的锚点断言已要求流水线跳 `to` 是本上下文的提交，并要求 7 条 provider 跳齐全 | N1、X14 等 9 条仍由该用例独占 |
    | e2e 既有四条用例 | 移出为 #222 切换准备的四行 `await ingest`，以及「候选关系」里的那处替换（Decision Log 第 36 行） | 本 PR 里查询自己会刷新，这五行不改变行为 |
    | 契约 | 交付事实父行的拒绝、关系两端的拒绝，并入已有的「悬空父边与非法枚举必须被拒绝」；`factsContext` 改用组里已有的 `context(...)`；台账 17 → 15，`ADDED_CASE_COUNT` 24 → 22 | M5、X1、X2 由替身的这条用例独占；正控（同一形状写在已登记的上下文上被接受）保留 |
    | 006 schema 审查 | 删掉凭据列正则，它被「四列恰为 …」的字面断言蕴含；消息并入那一句 | X4、Z31、Z32、NV33、NV34 仍由它独占 |
    | `delivery.ts` | `readDeliveryProjection` 的跳由返回数组的 `hop` 组装，取代 `push` 闭包与两层循环；`SETS` 去掉冗余的 `satisfies` 与它带来的导入（集合种类拼错时，比较本身就会报类型错误） | 新实现跑 C6 的旧测试 1237/1237；97 条在「新实现加旧测试」上被杀死的集合与 C6 相同 |
    | `chain-facts.ts`、`delivery-facts.ts`、端口、两个适配器 | 路由缝复用 key 级解析 `readRoute`（原 `deliveryRead`）；`rowToDeliveryFacts` 用解构重建，缺省的键仍还原成显式 `undefined`（S30）；注释收紧，几处单行化 | 同上 |

  - 变异规格的等价改写：查找文本按新代码重写，替换的语义不变。M12 是读回时省略节点的未定义键；N11 是在两条命令跳的 `find` 里加 `record.status !== 'failed'`；N14、X7、NV45 落在解构重建里的 `anchorId`、`confirmedAt`、`stale` 上；X6 是 `getDeliveryFacts` 绕过读队列；Z12、NV17、NV18、NV38 落在 `hop` 的实参与返回值上；NV11 的导入改在单行导入上。
  - 绿：`tsc --noEmit` 无输出；全量 `tests/contract tests/integration tests/e2e` 1225/1225（C6 是 1237，净减 12：e2e 由 31 条变成 23 条，契约少 2 条乘两个适配器）；`tests/mvp0` 7/7；`pnpm run boundaries` 8/8；#221 的验收命令按 issue 原文（不带 `--test-timeout`）172/172、退出 0；P3 原命令 `relations 2 -> 9 | ci online 5 | ci offline 5 | degraded true`。
  - 变异：在 C7 的树的 `git archive` 导出上整表重做 97 条。每条先用 `cmp` 与 `git diff --no-index -U0` 证明变异生效，再跑 Validation 的 7 文件命令（`--test-timeout=2000`，TAP 记录全部变红用例），用 `/bin/cp -f` 还原后 `cmp` 一致，复跑 223/223。结果：91 条被杀死，存活的是 NV5、NV6、NV36、NV37、NV56、Q2，与 C6 相同；收敛前被杀死的 91 条全部仍被杀死。另在「新实现加 C6 旧测试」的导出上跑同一套规格：被杀死的集合相同；变红用例集合只有 N2、N3 不同，原因是同一毫秒的令牌碰撞随运行时序变化。导出目录已删除。
  - 矩阵回读：`vertical-path.md` §2.1 引用的「离线保留（内存替身）」「离线保留（SQLite）」「提交失败：写者事务被拒时」按矩阵的回读命令逐条回读，各读回一行 ✔、`ℹ tests 1`、`ℹ fail 0`；伪造前缀读回 `ℹ tests 0`；命令退出码都是 0。
  - 文档：ADR-0011 第 7 条末句改成 PR-C 合并时成立的过渡措辞；tracker 加 TD-050、TD-051，TD-009 的证据改指两条离线保留里的「上下文 Failed」一行；`vertical-path.md` 里本 PR 写的引用由「失败不清空：离线」改指两条离线保留；旧用例名与新用例的对应见 S31。
  - 规模（观察时刻，提交之后量，S28）：`node scripts/rule-checks.mjs size origin/main` 代码 799 / 1000，文档 1132 / 1500。

- [x] (2026-10-08 11:19 CST) Batch C8：第四轮对抗验证（`a256dda`）的结论与 ADR-0011 的措辞订正。执行上下文：检出 `feature/delivery-fact-writer` 的工作树根目录，base `origin/main@6417d45`，起点 `a256dda`，工作区干净。只改文档，不加任何代码行，不推送、不写 GitHub。
  - 第四轮对抗验证（独立验证者，只读，在 `a256dda` 上做）的结论：**通过，没有 P0、P1、P2**。给出 6 条 P3，逐条处置如下；代码桶保持 799，余量只有 1 行（Decision Log 第 39 行）。

    | P3 | 属实性 | 处置 |
    |---|---|---|
    | 手写行里的 JSON `null` 不再归一成 `undefined` | 属实，已知（S30） | 维持现状：写者经 `JSON.stringify` 写入，不会写出 `null`，只有绕过写者手写的行才受影响，属于 TD-041 的范围 |
    | 令牌里的墙钟项没有用例 | 属实 | 本 PR 没有行数余量补断言，已移交 #222 的分支补断言 |
    | 从未开始工作的作用域不降级，没有断言 | 属实 | 同上，已移交 #222 的分支补断言 |
    | 替身 `putDeliveryFacts` 对多个上下文的 upsert 谓词没有用例 | 属实 | 同上，已移交 #222 的分支补断言 |
    | SQLite 读回的节点顺序没有断言 | 属实 | 同上，已移交 #222 的分支补断言 |
    | 从未确认集合的 `confirmedAt`、空集合遇到提交失败仍标陈旧，两者没有断言 | 属实 | 同上，已移交 #222 的分支补断言 |

  - ADR-0011 与代码不一致的一句（栈上层的对抗验证指出）：第 3 条把 `attemptedAt` 写成「最近一次被应用的刷新开始读取的时刻」，但提交失败后的降级事务（`delivery-facts.ts` 的 `catch`）也会把本行的 `attemptedAt` 前移到本次读取开始的时刻，同时把全部集合标陈旧。已订正为「最近一次写入本行的刷新开始读取的时刻」，并写明这两种写入。订正前后的对照：在检出 `feature/delivery-fact-writer` 的工作树根目录运行 `git log -p -1 -- docs/adr/ADR-0011-delivery-facts-last-confirmed-snapshot.md`。
  - 变异表 N2、N3 的变红条数由固定值改成区间「随时序 7–10」：C7 已在说明里承认它们随同一毫秒的令牌碰撞时序变化，表里留一个固定数字会误导复核者。
  - 验证：exec-plan 技能自带的 `lint_execplan.py` 对本计划通过；`node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js` 通过；`node scripts/rule-checks.mjs size origin/main` 代码仍为 799（提交之后量，S28）。
- [x] (2026-10-08 CST) 协调者（验收）：修复本身的独立复评 pass，无 P0 / P1 / P2；按其 P3 把 ADR-0011 第 3 条的降级事务措辞订正为「读取或提交失败后」（写者的 `catch` 同时覆盖读取阶段，探针：读取阶段 `listBranches` 抛错时 `attemptedAt` 前移、全部集合标陈旧、确认时刻不变）。只改文档，代码桶仍为 799。

- [x] (2026-10-08 19:40 CST) Batch C9：rebase 到 `origin/main@a357ef8c`，适配 #295 已合并的 Delivery 读取（K4）。执行上下文：检出 `feature/delivery-fact-writer` 的工作树根目录；恢复锚点 `backup/delivery-fact-writer-pre-main-rebase`（旧 head `7fef195`）；rebase 后 `pnpm install --frozen-lockfile --offline` 链上 main 新增的 `provider-delivery-github-actions`。只做本地提交，不推送、不写 GitHub。
  - 冲突：三个提交里只有代码提交冲突，都在 `packages/core/src/chain-facts.ts`（导入、`readPipelines`、`readChecks` 三处）；文档提交自动合并（main 自 `6417d45` 起没改 `vertical-path.md`、tracker 与本 PR 的其余文件）。C10 订正：括号里的说法不完整，main 自 `6417d45` 起在本 PR 的文件里改过两个：`chain-facts.ts`（上面的冲突）与 `docs/README.md`（#295、#289、#279、#205、#274 的已完成计划索引行，与本 PR 的 active 行不相邻，自动合并）；回读命令 `comm -12 <(git diff --name-only 6417d45 origin/main | sort) <(git diff --name-only origin/main...HEAD | sort)`。解决见 Decision Log 第 40 行：Delivery 两处保留 main 的 `collectDeliveryPages`、`factFor(status, conclusion)` 与 `readChecks(context, repositoryId, commit, gaps)`，只把能力门换成路由结论；`settled` 只留给 Development 两类查找；路由缝 `developmentReadBinding` 不变。
  - 新读取语义的逐条核对（Decision Log 第 41 行，S33）：`completeSets` 不变；写者的边与锚点不变（检查仍以 `runs_on` 挂变更请求，与 main 的读路径和已记录的谱系一致）；Delivery 读不完现在以缺口到达写者。探针在 base（`origin/main@a357ef8c` 的 `git archive` 导出）与本 PR 上各跑一次：P3 原命令 base `ci offline 0`、本 PR `ci offline 5`；E3（head 上 62 条运行）两边都是 62 条、`degraded false`（S32）。
  - 测试适配：rebase 后直接跑 `tests/e2e/delivery-lineage.test.js`，23 条里 3 条红（两条离线保留在「流水线分页截断」一行读到 62 条运行，「没有可提交的快照时」读到 62 条流水线跳），原因见 S32。改法见 Decision Log 第 42 行，改后 23/23。
  - 绿：`node_modules/.bin/tsc --noEmit` 无输出；全量 `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 1334/1334（含 main 新增的 `delivery-pages-complete`、`github-actions-ci-facts`）；`tests/mvp0` 7/7；`pnpm run boundaries` 8/8；#221 的验收命令带与不带 `--test-timeout` 都是 172/172、退出 0；`node scripts/workflow-check.mjs` 无发现；`disclosure origin/main` 与 `git diff --check origin/main...HEAD` 通过。
  - 变异：在 `git archive HEAD` 的导出上整表重做 97 条，Validation 的 7 文件命令（`--test-timeout=2000`），每条先 `cmp` 与 `git diff --no-index -U0` 证明生效，`/bin/cp -f` 还原后 223/223。C7 改写过查找文本的 11 条（M12、N11、N14、X6、X7、Z12、NV11、NV17、NV18、NV38、NV45）按 C7 Progress 的语义对当前代码重写一遍（C7 的规格文件没有留存），全部变红。X8 不再适用（检查读取不经 `settled`），换成作用于 #295 守卫的等价探针 X8r（`collectDeliveryPages` 读完第一页就返回），3 条变红。合计 91 条被杀死，存活的仍是 NV5、NV6、NV36、NV37、NV56、Q2；C7 被杀死的每一条（X8 除外）都仍被杀死。导出目录已删除。
  - 规模（观察时刻，提交之后量，S28）：`node scripts/rule-checks.mjs size origin/main` 代码 800 / 1000，文档见本批提交后的输出。K3 接线约 20 行实现加一条正例，会越过规划上限（Decision Log 第 43 行）。（Superseded by Decision Log 第 45 行：K3 接线由 #297 单独做，不进本 PR 的代码桶。）
  - K3：#291 尚未合并，本批不接线。#291 合并后在同一检出上再 rebase 一次，按 Decision Log 第 43 行接线并补正例。（Superseded by Decision Log 第 45 行（2026-10-08）：人类伙伴改为由 #297 单独接线，本 PR 不再等 #291 合并。）

- [x] (2026-10-08 21:40 CST) Batch C10：rebase 之后独立对抗验证的 P3 与 K3 的落点。执行上下文：检出 `feature/delivery-fact-writer` 的工作树根目录，base `origin/main@a357ef8c`，起点 `5e224ca`；恢复锚点 `backup/delivery-fact-writer-pre-rr`（`5e224ca`）。只做本地提交，不推送、不写 GitHub。变异与全量复测都在 `git archive` 导出的唯一临时目录里做。
  - 独立对抗验证（rebase 之后，只读）的结论是可接受，没有 P0–P2。四条 P3 逐条处置：

    | P3 | 处置 | 判别证据 |
    |---|---|---|
    | P3-1 完整性表缺两条路由门：变异 V2（`readChecks` 的路由门换成 `bindingForCapability` 直取，不看能力与策略）与 V9（`readChangeRequest` 改按 `DevelopmentRepositoryRead` 路由）在全量下存活 | 补「检查读能力被摘掉」「变更请求读能力被摘掉」两行（Decision Log 第 47 行） | 在 `5e224ca` 的导出上跑全量，V2、V9 都是 `ℹ fail 0`；补行之后同一命令下各 3 条红（两条离线保留与「真实层 tests/e2e」守卫），还原后复绿。导出副本没有 `.git`，全量用 `--test-skip-pattern` 跳过依赖 git 检出的一条 CLI 用例（「脚本被改名成不带扩展名的副本后，无参调用仍然 exit 2」），基线 1333/1333。同族的 V2p（流水线路由门直取）、V10（检查按流水线读能力路由）、V11（流水线按检查读能力路由）、V9r（锚点读取按变更请求读能力路由）在全量下也都被杀死 |
    | P3-2 `gated` 的 `settled` 默认恒真，是 fail-open | 默认谓词改为 `Array.isArray(value)`，零行（Decision Log 第 46 行） | S2（默认恒假）15 条红，证明默认谓词就在 Delivery 路径上；S1（改回恒真）存活，是今天的等价变异 |
    | P3-3 `ecd9cae` 单独检出时 3 条用例是红的（`4a19b30` 才修好） | 整合时把 `4a19b30` 与本批的代码、测试并进代码提交 | 代码提交的树在整合前先单独检出：把计划提交 `68d72d5` 加上 `ecd9cae`、`4a19b30` 与本批两个代码提交的改动，在一次性索引里建出树 `e153454`（与整合后代码提交的树相同），检出它：`tsc --noEmit` 无输出，全量 `tests/contract tests/integration tests/e2e` 1330/1330，`tests/mvp0` 7/7 |
    | P3-4 文档 | Outcomes 的「遗留」把 C9 已做完的事写成将来时；C9 Progress 说 main 没改本 PR 的其余文件（main 改过 `docs/README.md`）；`vertical-path.md` 第 10 行仍写 `delivery-github-actions` 是占位包、承接列仍有已关闭的 #232；ADR-0011 Consequences 用「已由 #295 取代」的过程语言；C0 的验证命令与 C3 Progress 写的是本机路径的 lint 脚本；S33 与 Decision Log 第 41 行的「第二条 `runs_on`」论证过头。全部就地订正或标 Superseded | `lint_execplan.py` 输出 `OK`；`content-placement`、`plan-facts-consistency` 通过 |

  - 规模：补两行之后代码桶 802（规划上限 800）。按 C7 的办法先审简化，再谈删减，结论见 Decision Log 第 47 行：
    - main 新增的夹具与 helper：`tests/fixtures/` 下 #295、#289、#279、#205 新增的导出（`github-actions.mjs`、`development-suite-adapters.mjs` 等）没有与本 PR 的 `flood`、`stub`、`endless`、`throwInside`、`holdFirstRead` 同功能的；#295 的 `stubDelivery` 是 `delivery-pages-complete` 的文件内函数。没有可复用的。
    - 同构用例：「乱序」的「时钟递增」「时钟回拨」四个变体不独占任何变异（S34），删去参数表的两行。写者层同构但保留的：「Delivery 权限被拒」（#221 验收 3 点名「权限受限」）与「检查分页读不完」（A3 与矩阵第 10 行引用的「读不完」证据）。
    - 实现分支：写者的 `!facts.context.observed ||` 被 `!facts.worktree.observed` 蕴含（没有执行上下文就没有工作树句柄），删掉不省行，还要改 X13 的规格，保留；其余分支都有杀手。
    - 结果：代码 800 / 1000，文档见本批提交后的输出。
  - 变异（「变异 → 全部杀手」表）：规格是 C9 的 97 条（C7 改写过查找文本的 11 条用 C9 的改写），加 C10 的 V2、V9、V2p、V10、V11、V9r、K1（令牌去掉墙钟项）、K2（令牌取三项最小值）、K3（令牌去掉已提交值加 1），共 106 条；最终树另加 S1、S2，共 108 条。每条在 `git archive` 导出上先用 `cmp` 与 `git diff --no-index -U0` 证明生效，再跑 Validation 的 7 文件命令（`--test-timeout=2000`，记下全部变红用例），`/bin/cp -f` 还原后 `cmp` 一致并复跑全绿。
    - 补行之后、删时钟变体之前（`a2dea6b`，基线 223 条）：106 条里 99 条被杀死，存活的是 C6 判定过的 NV5、NV6、NV36、NV37、NV56、Q2 与 K1。
    - 最终代码树（`49e4ee7`，基线 219 条）：108 条里 100 条被杀死。两棵树共有的 106 条被杀死的集合相同（99 条），没有因删去时钟变体而失去任何杀手；多出的一条是 S2。存活的 8 条：C6 判定过的 NV5、NV6、NV36、NV37、NV56、Q2；K1（墙钟项没有乱序用例，C8 已移交 #222 的分支，见 S34）；S1（`settled` 默认谓词改回恒真，今天没有调用点走「单页加默认谓词」，是等价变异，Decision Log 第 46 行）。新增规格的变红条数见变异表。另在全量下复测：全量（基线 1329 条，同样跳过那一条 CLI 用例）下 V2、V9、V2p、V10、V11 各 3 条红，V9r 4 条，S2 24 条，K1、S1 仍存活。导出目录在本批结束时删除。
  - K3：人类伙伴先后两次裁决（Decision Log 第 44、45 行）。第一次「#290 → #291 first, #292 does the wiring (Recommended)」，第二次「Separate small PR (Recommended)」：接线改由 #297 在 #219 与 #221 都进 main 之后单独做，本 PR 不再等 #291。`chain-facts.ts` 里路由缝的注释改指 #297（不增行）；第 43 行、K3 行、相邻工作表、S21、C9 Progress、A11、Outcomes 的相关句子就地标 Superseded；ADR-0011 Consequences 与 `docs/README.md` 的索引行同步改写；tracker 里没有写到接线归属的行，不改。
  - 绿：`node_modules/.bin/tsc --noEmit` 无输出；全量 `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 1330/1330（C9 是 1334，删去四条时钟变体）；`tests/mvp0` 7/7；`pnpm run boundaries` 8/8；#221 的验收命令带与不带 `--test-timeout` 都是 168/168、退出 0；P3 原命令 `relations 2 -> 9 | ci online 5 | ci offline 5 | degraded true`；`node scripts/workflow-check.mjs` 无发现；`disclosure origin/main` 与 `git diff --check origin/main...HEAD` 通过；`lint_execplan.py` 输出 `OK`，`content-placement`、`plan-facts-consistency` 9/9。规模（提交之后量，S28）：代码 800 / 1000，文档见本批提交后的输出。

- [x] (2026-10-09 00:06 CST) Batch C11：#292 第一轮 MMP 评审（Singularity-AI-Bot，review 5458999632，1 × P2、6 × P3）的修复轮。执行上下文：检出 `feature/delivery-fact-writer` 的工作树根目录；协调者先把本分支 rebase 到 `origin/main@f945c6b0`（含 #290、#291）；恢复锚点 `backup/delivery-fact-writer-pre-r1fix`（`18c92715`）；只做本地提交，不推送、不写 GitHub。逐条处置见 `docs/review/pr-292-mmp-review.md` 的「修复轮」。
  - P2：`readChangeRequest(context, repositoryId, branch, head, gaps)` 以 `headBranch: branch` 调 `listChangeRequests`（Decision Log 第 48、49 行）。红：先补完整性表「变更请求查找，别的分支的 60 条排在前面」与共享头提交里逐上下文的变更请求断言，修复前 19 条里 3 条红（两条离线保留读回 `degraded true`、4 跳陈旧；共享头提交读回 `pr-1`、期望 `pr-2`），修复后 20/20。探针（60 条别的分支上的变更请求排在前面）：修复前 `cr hops 0 | check hops 0 | degraded true`，修复后 `cr hops 1 | check hops 3 | degraded false`；分支一侧的评审探针修复前后都是 `hops execution_context,worktree | ci 0 | degraded true`，即 TD-040 写明的上限。TD-050 移到 Resolved Items，TD-040 收窄并写明承接 #233，矩阵第 10 行同步。
  - P3：B2、T11 在本 PR 杀死，T17 与 `.putRelation(` 的静态守卫放进 #293（第 50 行）；ADR-0011 第 6 条改为 ADR-0012（Accepted），`docs/adr/README.md` 的「上表十二条」与索引的 12 行一致；相邻工作表、函数签名、K2 行与 #287 接口条目就地订正（S35）；`confirmedAt` 见第 52 行。ADR-0011 在本 PR 保持 Proposed：人类伙伴已裁决在 #293 的修订之后采纳，由 #293 改状态行。
  - 变异：Validation 的 7 文件命令在 `git archive` 导出（`$TMPDIR` 下带任务名与随机后缀的目录）上整表重做 113 条（C10 的 108 条加 H1、H2、B2、T11、T17），基线 224 条全绿：104 条被杀死，存活的是 C10 的 8 条与 T17。与 C10 整表比，没有一条由杀死变为存活，杀手集合变小的只有 Z12（第 51 行）。
  - 绿：`tsc --noEmit` 无输出；全量 `tests/contract tests/integration tests/e2e` 1437/1437；`tests/mvp0` 7/7；`pnpm run boundaries` 8/8；#221 的验收命令带与不带 `--test-timeout` 都是 169/169；P3 原命令 `relations 2 -> 9 | ci online 5 | ci offline 5 | degraded true`。规模：代码 800 / 1000（新增 3 行用例，删去被蕴含的断言 3 行、注释并回一行，第 51 行）；文档与其余门禁见本批提交后的输出。

- [x] (2026-10-09 01:35 CST) Batch C12：#292 复评轮（Singularity-AI-Bot，两个 PR 均 APPROVE；本 PR 3 条 P3，另有 #293 复评轮点名、归属本层的迁移 006 列注释）的修复轮。执行上下文：检出 `feature/delivery-fact-writer` 的工作树根目录，base `origin/main@f945c6b0`；恢复锚点 `backup/delivery-fact-writer-pre-rr2`（`bb3ef949`）；只做本地提交，不推送、不写 GitHub。逐条处置见 `docs/review/pr-292-mmp-review.md` 的「复评轮」。
  - P3 `chain-facts.ts:168`：变更请求查找的 `settled` 谓词先要求 `Array.isArray(page.items)`，原地改写，不增行（Decision Log 第 53 行）。红绿在 `git archive` 导出（`$TMPDIR` 下 `fix-292-293-rr2-*`）里做：临时在完整性表加一行「变更请求页形非法」（`listChangeRequests` 返回 `{ ok: true, value: { items: null, nextCursor: undefined } }`，期望 `change_request`、`check_run` 标陈旧）。修复前 20 条里 2 条红（离线保留的替身与 SQLite），消息「变更请求页形非法：不完整的读取不得删除、增补或改写已确认的 CI 事实」，actual 少了三条检查事实；修复后 20/20。探针（在线确认一次，再让 `listChangeRequests` 返回上面的坏页，最后 Development 权限被拒）：修复前 `change_request:1 check_run:3` → `0 / 0 | degraded false` → 权限被拒后仍是 `0 / 0`，已确认的值找不回来；修复后 `1s / 3s | degraded true` → 权限被拒后 `1s / 3s | degraded true`（`s` 表示逐跳标陈旧）。
  - 永久的判别用例放进 #293：本 PR 代码桶 800 正好在规划上限，一行用例就越过；只合并 #292 时这一格没有用例，变异 R1 存活（Decision Log 第 53 行）。
  - 分支查找的谓词不改（Decision Log 第 54 行）：同一种坏页的临时行放在分支查找上，不加守卫时保留的 CI 事实、逐跳陈旧、`degraded` 与重启读回都和加守卫相同，只差刷新返回值带不带 `error`（不加守卫：`read.value?.items.find` 在 `null` 上抛出，走 K2，返回结构化的 `unavailable`；加守卫：缺口，没有 `error`）。
  - P3 `delivery-lineage.test.js:227`：「变更请求确认不存在」那一行的注释改成「列表完整，只剩本分支上头提交不同的变更请求，且排在前面：它不得被挂进本链（只认 `sourceVersion === head`）」，一行换一行，断言不动。H5 仍只被这一行杀死（2 红）。
  - P3 TD-040：「协调者在 #233 加的验收框原文」改成 2026-10-09 用 `gh issue view 233 --json body` 回读后的逐字复制，补上括号里的「test with more than 50 branches; from #221 review, decided 2026-10-08」，`not` 改回 `never`。
  - 迁移 006 的 `attempted_at` 列注释（#293 复评轮第 1 条里归属本层的部分）：从「最近一次被应用的刷新的读取开始时刻」改为乱序令牌的说明：取读取开始时的墙钟、已提交令牌加 1 毫秒与同一个 core 上下文对象上一次发出的令牌加 1 毫秒三者的最大值，可能领先墙钟，只用来定序，不是读取开始时刻，不得展示。首发前迁移直接改写（Global Constraints），一行换一行。
  - 变异：`git archive 02538fc5` 导出（`$TMPDIR` 下 `fix-292-293-rr2-*`），Validation 的 7 文件命令（`--test-timeout=20000`），基线 224/224，每条先证明一处改动落地、跑完用原文写回并断言逐字相等：H5 2 红、B2 2 红、T11 1 红，与 C11 一致；T17、G1、R1 存活（0 红；全量 1437 条下只有导出目录没有 `origin` 远端造成的那一条 CLI 用例红，与变异无关），三个杀手都在 #293。本轮只复测这五条与新增的 R1，不重做 113 条整表：代码改动只有一个谓词，整表里其余变异的锚点没有变化。
  - 绿：`node_modules/.bin/tsc --noEmit` 无输出；全量 `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 1437/1437（条数不变：本轮不加用例）；`tests/mvp0` 7/7；`pnpm run boundaries` 8/8；#221 的验收命令（带与不带 `--test-timeout`）169/169、退出 0；P3 原命令 `relations 2 -> 9 | ci online 5 | ci offline 5 | degraded true`。规模：代码 800 / 1000（原地改写，不增行），文档 1324 / 1500；其余门禁（`disclosure`、`git diff --check`、`lint_execplan.py`）见提交后的输出。导出目录在本批结束时删除。

## Surprises & Discoveries

- **S1 SQLite 上交付视图今天根本读不出来**（E6）。替身接受悬空端点，掩盖了这个外键失败；控制计划此前没有登记。因此 SQLite 必须进入 A1 的用例矩阵。
- **S2 截断与权限被拒都被读成完整**（E3、E4）。改成「完整读取才整组替换」之后，旧行为会把截断变成「确认不存在」，所以截断守卫必须与写者同批落地。
- **S3 迁移 005 已被占用**。`005_source_version_carrier.sql`（#203）是载体世代步骤，控制计划第 172、228 行已过期，改用 006。`tests/integration/storage-source-version-upgrade.test.js` 有**三处**写死了「005 是最后一个迁移」：第 133、171、252 行。设计稿只看到了第 252 行。
- **S4 用时间戳相等推断陈旧会丢标记**。原型第一版按 `confirmedAt !== attemptedAt` 推断陈旧：替身上连续两次刷新拿到同一毫秒，离线、权限、截断、Development 离线四个场景的 `stale` 都读回 `false`，只有 SQLite 那一路因为慢一些而碰巧正确。改成集合上的显式 `stale` 之后，四个场景都正确。
- **S5 替身端点对齐会立刻打红 7 条既有用例**：delivery-lineage 4 条、status-policy 1 条、start-work-retry-identity 1 条、mvp0 节点 6 与 7。原因是旧查询写的是悬空边。所以对齐必须放在 C2，与「写边前登记端点」同批；C1 不对齐。
- **S6 在事务内写根实例会挂起，而不是失败**。变异 M14 让替身的写队列自等，没有 `--test-timeout` 时 `node --test` 一直挂起。所以 e2e 命令一律带超时。
- **S7 #165 的两条探针会悄悄失去判别力**。查询不再写边后，「读一次谱系不得写出第二条关系」恒真，需要补 `hop.to` 断言（C2 第 4 步）。变异 M11 证明补上的断言能杀死身份派生的分叉。
- **S8 契约补充（K3，2026-10-08 01:35）**：路由缝必须返回 `{ binding, repository }`，调用方只用这个引用。原型据此改写之后，`chain-facts.ts` 从 52 行增到 78 行，实现小计因此超过 350。

- **S9 红用例的第一条失败信息与原型不同**。`提交失败` 在 C1 之后读到的是 `reading 'sets'`，不是计划记的 `reading '0'`：C1 已经给替身加了 `deliveryFacts: []`，`[0]` 不再是对 `undefined` 取下标。红的集合没变。
- **S10 计划的 9 条 e2e 没有覆盖四类守卫，补三条用例**。计划没有任何用例覆盖 Development 两处查找的谓词（Decision Log 第 5 行的「找到即完整」），所以先补了 `Development 查找`；在这之后用 M1–M14 以外的变异检查本批新增的守卫，三处存活：写者不检查锚点（X13）、读路径不按 `to === worktreeId` 过滤 `derived_from` / `produced_by`（X14）、完整集合不写 `confirmedAt`（X15）。补 `刷新结果与快照时刻`（也直接断言 `DeliveryRefreshResult` 的形状和提交失败的结构化错误）杀死 X13、X15，补 `读路径按本上下文的工作树取 derived_from` 杀死 X14；Development 查找谓词的四个变异 X9–X12 中，X9、X10、X12 只有 `Development 查找` 一条用例杀死。代码合计由约 730 行增到 790 行，仍不超过 800。
- **S11 计划里 K2 的文字与算法的覆盖面不一致**。`Interfaces and Dependencies` 的 K2 行写「从读到提交的任何异常都折成结构化结果」，`Design / Spec` 的算法只折事务内的异常；`readChainFacts` 是在事务外调用的，provider 违反端口契约、抛出裸异常时，写者会把它原样抛给查询。本批按算法实现，没有扩大；端口约定 provider 失败是结构化的 `ProviderResult`，`composeCore` 对 bootstrap 也只做同样的兜底。需要折时在 `refreshDeliveryFacts` 外层包一层，不改调用方，登记给对抗验证者与人类评审裁决。（对抗验证用 `listPipelineRuns` 抛裸异常坐实了：查询 reject 并带出原文。已按 K2 的文字扩到读取阶段，见 S14 与 Decision Log 第 20 行。）
- **S12 共享同一头提交的两个上下文，读路径把后一个上下文的 CI 挂到先写入的那个上下文的提交上（对抗验证 P1，相对 base 的回归）**。同一仓库上两个工作项各自开始工作、都还没有新提交时，两条分支的头都是 `sha-1`；`sha-1` 上的流水线运行是同一个实体（`chainEntityId` 的槽位是 `binding|externalId`，不含提交，也不含上下文），关系表主键含 `to`，所以它有两条 `runs_on` 边，读路径按 `(from, type)` 取第一条。base 上每次读谱系现算锚点，没有这个问题。修法：快照的每个集合记录确认时的锚点 `anchorId`，读回按 `(from, type, to)` 取边，同时保住 Decision Log 第 11 行（陈旧集合按记录时的锚点显示）；只把 `to` 钉在快照当前的提交上会让「head 前移而 Delivery 离线」的陈旧流水线跳消失，所以没有采用对抗验证的字面建议。同根因的 `readChangeRequest` 按 `sourceVersion === head` 匹配，共享同一头提交的两个上下文会选到同一个变更请求（#279，PR #287 的 `headBranch`），不在本 PR；新用例只断言流水线跳回指各自的提交。
- **S13 乱序守卫比的是墙钟毫秒，同一毫秒与时钟回拨都会让较旧的读取覆盖较新的提交（对抗验证 P2、P3）**。S4 已经证明同一毫秒在替身上是常态，原用例只用了严格递增的时钟，没有钉住打平的情形。修法：读取开始时刻在同一个 core 上下文对象内严格递增（`max(clock(), 上一次 + 1ms)`，`WeakMap` 按上下文对象记账）；没有加代际整数列，那要改端口与迁移（见被放弃的方案）。残留：进程重启后时钟早于已提交的 `attemptedAt`（例如系统时钟被手动拨回）时，读取被守卫丢弃（`applied: false`）；查询对被丢弃的刷新报 `degraded`，不再把旧事实当最新显示，但刷新要等时钟追上才会重新生效。登记在 Decision Log 第 19 行，没有占用新的 TD 号。（这一修法与残留在 C5 被取代：令牌的计数只在一个上下文对象内成立，也会跑在墙钟前面，见 S19、S20，Decision Log 第 26 行。）
- **S14 S11 的读异常被坐实**（对抗验证 P2）：`listPipelineRuns` 抛 `new Error('PROVIDER-RAW /secret/path')` 时，`getDeliveryProjection` reject 并带出原文，违反 K2 与 ADR-0011 第 8 条。修法：把 `readChainFacts` 放进 `try`，失败走同一个降级事务；`contextId` 改成进入函数就按 `contextIdFor` 算出，读取失败时也能把已有集合标陈旧。
- **S15 分支存在而头部提交未知，被当成「没有 head」而整组删除下游事实**（对抗验证 P2）：`ProviderBranch.headCommit` 是 `string | undefined`，原代码的 `readHeadCommit` 在这种情形下返回 `undefined`，`completeSets` 把它读成「分支列表完整、分支不在其中」。设计文字（「没有 head」只有一种来源）与代码不一致。修法：记 `DevelopmentRepositoryRead` 缺口。
- **S16 读路径先读关系后读快照**（对抗验证 P2）：两次读取之间提交了新刷新时，新快照里的节点在旧关系里找不到边，被静默跳过，投影 `degraded: false`，一次瞬态读起来像「确认不存在」。写者在一个事务里同时提交实体、边与快照，且从不删边，所以先读快照再读关系是单调安全的；当前是单进程，今天只在测试里能打出来，#222 / #134 的并发刷新会让它成为真实竞态。
- **S17 TD-009 的 Resolved 过度声明**（对抗验证 P2）：TD-009 自己的下一步是「谱系读对非 Ready 的上下文只读不落边」加两条用例，本 PR 只做到了前半的核心危害（写者不写命令边），Provisioning / Unknown 的上下文上一次查询仍写出候选边与一行快照；「Failed 上下文仍显示 tracks 跳」没有用例，变异也杀不死。已把 TD-009 改回 Open 并收窄（见 Decision Log 第 23 行），补了 Failed 用例；Decision Log 第 3 行的措辞同步订正。
- **S18 对抗验证的 P3 与文档订正**：①controller 的 `getDeliveryLineage` 原样转发 core 的跳，所以逐跳 `stale` 已经转发，只有投影级的 `degraded` 与 `optional` 没有；`vertical-path.md` 第 10 行、13.5 与订正段已改成这个说法，13.5 的「已交付」标明替身四类故障、SQLite 只有离线保留一条。②Decision Log 里协调者的那一行只有两个单元格，已补成四列并按时间移到第 17 行。③`docs/README.md` 索引行不再写「产品批次未实施」。④TD-014 的取代依据 ADR-0011 目前是 Proposed，已在 tracker 注明人类不采纳时重新开放。⑤`hop.unavailable` 恒为 `false` 的变异存活；当时判断替身没有开关能把 Delivery 的流水线读能力从 registry 里去掉，C5 证明判断是错的（S23），已补用例。⑥提交 `3db4aaf` 的标题「查询不再写边」读起来像查询已经不写，本 PR 里查询仍经写者写候选边：整合提交时由协调者改标题（写成「写者提交快照，读路径只读已提交事实」一类）。
- **S19 令牌的墙钟分量会跑在真实时钟前面，被放弃的刷新在逐跳上看不见（第二轮对抗验证 P2，可复现）**：严格递增的令牌在突发刷新下超前于墙钟（同一上下文对象背靠背 25 次刷新后，已提交的 `attemptedAt` 比当前时刻晚 21 毫秒）；同一份 Storage 上的另一个 core 对象立刻用真实时钟取令牌，比已提交值早，被守卫放弃（`applied: false`），run-1 在 provider 一侧已是失败，快照里仍是 `ci_passed`。时钟拨回一小时后的第二个 core 对象同理。而 controller 只转发跳（`getDeliveryLineage` 返回 `hops`），原来只有投影级的 `degraded` 为真，逐跳 `stale` 仍是 `false`：展示出去的是「新鲜的」旧值。变异 N4（去掉 `applied` 一项）只被读投影级 `degraded` 的用例杀死，所以没人发现。修法：令牌取已提交值加 1 毫秒（S20），被放弃或失败的刷新让 provider 读取的跳逐跳标陈旧（Decision Log 第 26、27 行）。
- **S20 令牌的对象内计数只在一个 core 上下文对象内成立（第二轮对抗验证 P3，可复现）**：`WeakMap` 按对象记账。两个 `createContext` 对象、同一份 Storage、常量时钟：较旧的读取（对象 a）停在读完之后，对象 b 的较新读取（run-1 已失败）先提交，放行 a 后 `applied: true`，最终快照里 run-1 是 `ci_passed`。S13 的根因没有消除：令牌必须来自所有写者共享的东西，也就是已提交的行。修法同 S19；对象内计数保留，保证同一对象内并发取号不平手。读取开始时彼此看不见、令牌平手的并发读取（只可能来自不同对象）先提交者胜，后者被放弃并让投影降级，自愈于下一次刷新。
- **S21 K3 的「多挂载退化为缺口」今天是空命题**：`CoreProviderTable` 每域只有一个 provider；`bindingForCapability` 在有多个挂载时取默认挂载，并不 fail closed。能构造的路由失败只有能力被策略摘掉、没有绑定两种。`chain-facts.ts` 的注释与 K3 行里「多挂载 fail closed」的说法已改成可验证的版本，多挂载正例留给 PR-B。（C10：正例改由 #297 补；#291 合并后同域多个 Development 挂载一律非默认，key 级解析对 Development 键 fail closed，多挂载才真正退化为缺口，见 Decision Log 第 45 行。）
- **S22 路由失败分支（Development 能力被摘掉）没有用例，删掉那一行所有相关测试都绿（第二轮对抗验证 P2，变异 Z26）**：原来的故障表只注入 provider 故障。删掉 `route?.ok === false` 那行后，在线刷新一次再重组一个没有 Development 能力的 core，快照被整组删除（跳 9 → 2，`degraded` 由 true 变 false），因为锚点读不到被读成「完整的空集合」。「路由失败不清空」补上这格。
- **S23 `hop.unavailable` 其实可测（第二轮对抗验证 P3）**：S18 ⑤ 与 Decision Log 第 25 行说替身没有开关，加开关超出文件集合，是错的：`composeCore` 的 `policy` 能把 `delivery.pipeline.read` 置为 `Unavailable`，只用测试文件就能构造出「流水线跳 unavailable、检查跳不 unavailable」。
- **S24 K2 只对唯一写者成立（第二轮对抗验证 P3，可复现）**：`readDeliveryProjection` 的 `getDeliveryFacts` 抛 `RAW-STORAGE /secret/path` 时，`getDeliveryProjection` 带着原文 reject；写者自己（`refreshDeliveryFacts`）返回结构化结果。读路径与所有其它查询对存储异常的处理一致（base 上同样），结构化失败归 ADR-0012 与 #222；ADR-0011 第 8 条与 K2 行已收窄到「唯一写者」（Decision Log 第 28 行）。
- **S25 没有锚点的刷新把旧快照当新鲜显示（第三轮对抗验证 P2，可复现，相对 base 的行为变化）**：`start-work.ts` 的 `saveContext` 只保留分支、不保留工作树句柄，失败的重新供应因此清空 `worktreeExternalId`。此后刷新 `anchored: false`，什么也没读、没写，查询却把旧快照的跳原样显示：在线摄入 → 清空句柄 → Delivery 离线 → 查询，输出 `{"n":9,"ci":5,"staleProvider":0,"degraded":false}`（base 上同样步骤只有 1 跳）。与 S19 同类：C5 的 `unconfirmed` 只认 `anchored && !applied`。修法见 Decision Log 第 31 行。
- **S26 三条契约级守卫原先没有判别断言（第三轮对抗验证 P2）**：①K5 只守了修订号，写者多写一条 `planning.project` 游标时全量仍绿（NV11）；②「提交失败」的注入让事务在执行事务体之前就被拒绝，「事务内已写的边随回滚撤销」从未被执行，在事务内吞掉 `putDeliveryFacts` 的异常（边提交、快照没写）时全量仍绿（NV40）；③首次截断后，从未确认的集合存成 `stale: true` 只经查询的缺口间接体现，快照本身没有断言（NV25）。另有拓扑断言缺口（NV1–NV4、NV7、NV17、NV18）。升级测试的期望由迁移清单推导，删掉清单项期望也跟着变，是同义反复。C6 全部用断言补上，不新增用例（Decision Log 第 32 行）。
- **S27 矩阵回读的前缀被 C5 的新用例撞上**：`vertical-path.md` 引用的「失败不清空」是 C5 新增标题「路由失败不清空：…」的子串（`--test-name-pattern` 按正则匹配，不是前缀），回读读到 `ℹ tests 2`，与矩阵「一行 ✔、`ℹ tests 1`」的期望不符；13.5 格的「提交失败」同样命中乱序的「较旧的读取提交失败」变体与「刷新结果与快照时刻」。已改成唯一前缀「失败不清空：离线」「提交失败：写者事务被拒时」，回读各为 `ℹ tests 1`。
- **S28 `node scripts/rule-checks.mjs size` 量的是 HEAD 提交，不是工作树**：未提交的改动不计入。C6 在工作树上先量到 988，提交后是 990；规模要在提交之后量。
- **S29 C6 的变异日志看不出冗余**：日志只记每条变异前三个变红的用例，看不出哪条用例只是重复杀死别人也杀死的变异。C7 先用 TAP 重建了「变异 → 全部杀手」表，才找到可以合并的用例（C7 Progress）。以下用例没有独占任何变异：「离线保留（内存替身）」（与 SQLite 版、「失败不清空」重叠）、「唯一写者」（它守的是 A2 与 I1、I2，没有对应的变异）和「乱序」六个变体中的每一个。
- **S30 `rowToDeliveryFacts` 对 `null` 的处理有细微差别**：旧实现逐字段写 `?? undefined`，顺带把 JSON 里的 `null` 也变成 `undefined`；新实现用解构重建，缺省的键同样还原成显式 `undefined`，但不改写 `null`。唯一写者经 `JSON.stringify` 写入，未定义的键直接省略，不会写出 `null`，所以写者能产生的行读回不变。只有绕过写者手写的行会看到差别，那属于 TD-041 的范围。
- **S31 C7 改名与合并后的用例对应**：本计划 C2–C6 的记录用的是当时的用例名。对应关系如下：
  - 「失败不清空」「Development 查找」「路由失败不清空」、两条「完整空集合才删除」、「Failed 的上下文仍显示 tracks 与 has_worktree 跳」，现在都是「离线保留（内存替身）」「离线保留（SQLite）」完整性表里的行；
  - 「重复刷新收敛」现在是「唯一写者」的后半部分；
  - 「被放弃的刷新」现在是「乱序（两个 core 上下文对象，较旧的读取提交成功）」；
  - 「同一个 core 上下文对象内并发的两次刷新令牌不平手」现在在「刷新结果与快照时刻」里；
  - 契约「关系端点必须是已登记实体」「交付事实的执行上下文不在该工作区时被拒绝且不留行」，现在在「悬空父边与非法枚举必须被拒绝」里。

- **S32 #295 合并后，60 条造数不再是截断**：`collectDeliveryPages` 按游标读完全部页，`flood` 在 head 上种下的 62 条运行被完整读回，所以完整性表的「流水线分页截断」「检查分页截断」两行与「没有可提交的快照时」的首次截断都变成完整读取，三条用例变红。新读取下截断只剩「读不完」一种形态：页失败、游标成环、重复投递、超过页数上界或读回不属于已观察提交的项，都报成该集合的缺口，不交出任何一页。Development 两类查找仍只读第一页（TD-040 收窄为这一半）。
- **S33 #295 换了检查的读取键，没换检查的边**：`readChecks` 现在按「仓库 + 已观察提交」读并核对每项的 `commit`，但 `readChainFacts` 仍要求变更请求已观察才读检查（main 文件头：「检查另以已观察的变更请求为前置门」），main 的 `chainEdges` 仍把检查的 `runs_on` 挂在变更请求上。写者的锚点与 `completeSets` 因此不需要改，理由有三：①ADR-0011 第 3 条把检查集合的 `anchorId` 定为变更请求；②main 的 `chainEdges`（本 PR 用写者取代它）一直把检查的 `runs_on` 挂在变更请求上，写者沿用同一锚点，已记录的谱系不改形；③读取前置门要求变更请求已观察才读检查，检查集合的完整性本来就依赖变更请求集合。改挂提交是新的设计决定（要改 ADR 第 3 条、完整性规则与读路径的取边），不属于 rebase 适配。（C10 订正：原句说改挂提交「会给同一检查实体写出第二条 `runs_on`（不变量 6）」，论证过头：关系三元组是 `(from, to, type)`、写者不删边，只有已经写过检查 → 变更请求边的库才会多出一条；那是锚点换了，不是重新识别。）
- **S34 「乱序」的时钟递增与时钟回拨两个变体被时钟不前进的变体蕴含**（C10）。在补完两行完整性用例的树（`a2dea6b`）上，用 Validation 的 7 文件命令（`--test-timeout=2000`）跑 106 条规格（C9 的 97 条与 C10 新增的 9 条），记下每条变异的全部变红用例：被这四条用例杀死的 14 条变异（M2、M8、M14、N2、N3、N4、N8、X13、Z12、Z40、NV4、NV9、NV10、Q1）每一条都还被至少一条保留的用例杀死；其中只靠「乱序」杀死的 7 条（M8、N4、N8、Z40、NV4、NV9、Q1）都由「时钟不前进」的两个变体或「两个 core 上下文对象」杀死。原因在令牌的形状：它取墙钟、已提交值加 1、对象内上一次加 1 三者的最大值；递增的时钟让墙钟项领先，回拨的时钟让墙钟项落后、等同于不前进，而不前进的时钟把墙钟项钉成常数，令牌的先后只能靠后两项，是守卫最难的情形。墙钟项本身没有乱序用例能杀死（K1「令牌去掉墙钟项」在两棵树上都存活，C8 已把墙钟项的断言移交 #222 的分支，那里有「读取开始时刻的墙钟项」）。删去两个变体后整表重做，被杀死的集合不变（C10 Progress）。
- **S35 #287 早于本 PR 的 base 已在 main**（C11）：C9 的 rebase 只处理了冲突文件，没有回读相邻工作表，计划与 TD-050 仍把它当在途。`headBranch` 过滤只有替身实现（先按仓库、再按分支字节精确过滤、最后分页）；本地 Git 对变更请求读答 `not_supported`，`development-github` 只有包名；契约套件的 `change-request-filter-before-pagination` 守护所有声明变更请求读能力的实现。

### Artifacts and Notes · 原型证据（观察时刻快照，原型未提交）

- **执行上下文**：在 `feature/delivery-fact-writer`（`origin/main@6417d45`）的导出副本里，按本计划 C1、C2 实施；Node v26.10.0。
- **全量测试**：`tests/contract tests/integration tests/e2e` 共 1222 条，只有 1 条失败。失败的是 `issue-policy` 的 CLI 改名用例，它依赖 git 检出，导出副本没有 `.git`；在真实工作树上 40/40 通过。`tests/mvp0` 7/7。
- **P3 原命令**：`relations 2 -> 9 | ci online 5 | ci offline 5 | degraded true`。
- **探针**：
  - SQLite 版 P3：`ci offline 5`，CI 跳全部陈旧，提交跳不陈旧；
  - 权限被拒：5 条 CI 保留、全部陈旧；
  - 截断：2 条旧流水线保留、陈旧；
  - Development 离线：全部七跳保留，交付四类全部陈旧；
  - 完整空集合：流水线 0、检查 3；
  - 乱序：`run-1` 读回 `ci_failed`，去掉守卫后读回 `ci_passed`；
  - 提交失败：5 条 CI 保留、全部陈旧，结果里没有注入的文字。
- **在 base 上运行新的 e2e 文件**：7 条红（`离线保留` ×2、`唯一写者`、`失败不清空`、`提交失败`、`乱序`、`谱系写者不写命令边`），2 条护栏为绿，信息见 C2 的表。

## Decision Log

除标注「人类专属」的条目外，各行都是按证据做出的决定，可由人类在 PR 评审时推翻。

| # | 日期 / 作者 | 决定 | Rationale |
|---|---|---|---|
| 1 | 2026-10-08 / 定稿评审者 | 持久化形状：每个执行上下文一行，四个集合放在 `sets_json` 里 | 每一列都对应一条验收（见 Design 的逐列表）。关系形状多出三种替身与 SQLite 可分叉的语义，又没有验收需要它；首发前与 Gate E1 前不冻结细粒度模型。代价见 TD-041 |
| 2 | 同上 | 新鲜度在快照内（集合级 `confirmedAt` 加显式 `stale`，行级 `attempted_at`），不复用 `sync_cursor`，因此不触发 TD-021（K5） | 游标按单个 binding 定位，而快照跨两条连接；见 S4 |
| 3 | 同上 | 写者只写 `derived_from`、`produced_by`、`runs_on` 三类边与端点实体；替身端点对齐。TD-009 收窄后保持 Open，TD-014 被取代（取代依据 ADR-0011 目前是 Proposed） | 第三种解法（写者不写命令边；查询自己不写边要等 #222，在那之前经唯一写者写候选边）只满足 TD-009 验收建议的前半：Unknown 之后不写命令边，Failed 上下文仍显示 tracks 跳（tracks 由 `settle` 写，读路径照常读到；对抗验证后补了用例）；「非 Ready 的上下文不落边」没有做，TD-009 因此保持 Open（第 23 行） |
| 4 | 同上 | 乱序守卫放在本 PR | 本 PR 的查询就是并发写者 |
| 5 | 同上 | 截断守卫放在 `gated` 一处；Development 查找「找到即完整」 | K4 只要求 Delivery。Development 一侧如果不守，新的删除语义会把「分支不在第一页」变成「锚点确认不存在」，进而删掉全部下游事实 |
| 6 | 同上 | 测试统一经 `ingest` 辅助摄入，用例从不把它的返回值当投影 | PR-D 只改一行，所有既有用例自动改走命令路径。（C7 订正：C4–C6 的新用例里有几处读的是 `ingest` 的返回值，本 PR 的过渡查询本来就返回投影，被放弃的刷新只有这次返回值能看到；既有四条用例里为切换准备的 `ingest` 行已移出本 PR，见第 36 行。） |
| 7 | 同上 | 存 core 派生的 `fact` 与 `label`，不存原样 `status` / `conclusion` | 不改 `readChainFacts` 的读出形状，避开与 #289 的冲突；TD-043 |
| 8 | 同上 | 不把交付刷新接进 `bootstrapWorkspace`（H3 的默认值） | `bootstrap.ts` 属于 PR-A；把规划同步与交付读取耦合在一起，会让一方的失败遮住另一方。#222 的「bootstrap 或 refresh 命令」由 PR-D 的刷新命令满足 |
| 9 | 同上 | 写入集合超出控制计划的部分（见 Global Constraints）在本计划登记 | 新写者需要新文件；替身与成员锁是端口的另一半；三处测试是新增表与身份断言的必然改动 |
| 10 | 同上 | 锚点（分支）被完整读到不存在时，删除下游事实（H2 的默认值） | 这符合「只有完整读取才删除」：没有当前 head，就没有「当前 head 上的运行」。历史保留归 #233（`headBranch`，#279） |
| 11 | 同上 | 陈旧集合按记录时的锚点显示，`hop.to` 可能是旧提交（H6 的默认值）；锚点显式存在集合的 `anchorId` 里（第 18 行） | 锚点变化不等于旧运行被确认不存在；TD-042 |
| 12 | 同上 | TD 号段：本 PR 只用 TD-040–TD-044，不预留其它号（K6）（C7 订正：协调者另分配 TD-050–TD-053，本 PR 用了 TD-050、TD-051，见第 38 行） | 并行 PR 预分配；合并时回读 tracker 的最大号 |
| 13 | 同上，人类专属 | ADR-0011 写成 Proposed，采纳与否由人类决定（H1） | `docs/adr/README.md` 规定 Proposed 的采纳权在人类伙伴 |
| 14 | 同上 | TD-007 不在本 PR 处理 | 读路径仍然全量 `listRelations`；按端点读关系的端口方法要改成员锁、两个适配器与契约，不服务任何 #221 验收；TD-044 记下二者叠加 |
| 15 | 2026-10-08 01:26 CST / 实现者 | C2 在计划的 9 条 e2e 之外补三条判别用例：`Development 查找`、`刷新结果与快照时刻`、`读路径按本上下文的工作树取 derived_from` | 计划的变异表只覆盖到 M14；补做的变异 X9–X15 在原用例下存活（S10）。每条补充用例对应一个被计划写明的设计点（Decision Log 第 5 行的「找到即完整」、K2 的结构化结果、「derived_from 与 produced_by 另要求 `to === worktreeId`」），不增加新机制；代码合计 790 行，仍在 800 以内。第三条在 C5 删除，见第 31 行 |
| 16 | 2026-10-08 01:40 CST / 实现者 | `vertical-path.md` §2.1：第 10 行由「反例：#221（P3）」升为「部分：controller 不转发投影的 stale / degraded（#222）；变更请求由直接调用替身种下（TD-002）」，13.5 由「反例：#221（P3）」升为「已交付（替身与 SQLite）」，第 13 行只剩「反例：#194（P4）」；原句不删，用 `Superseded by` 加日期就地标注；`结论计数` 与「13.x 共 10 面」同步更新 | 反向升级需要在所属 ExecPlan 的 Decision Log 写明证据（矩阵的「只往保守方向修正」规则）。证据：①引用的四个用例（`离线保留（内存替身）`、`离线保留（SQLite）`、`失败不清空`、`提交失败：写者事务被拒时`）按矩阵的回读命令在本工作树逐条回读，各读回一行 ✔、`ℹ tests 1`、`ℹ fail 0`，伪造前缀读回 `ℹ tests 0`；②P3 原命令在同一检出上输出 `ci offline 5`（base 上是 `ci offline 0`），SQLite 版也是 5 且逐跳 `stale`；③变异 M1、M4、M7、M10、M13 使这些用例变红（见 C3 的变异记录）。第 10 行仍是「部分」而不是「已交付」，因为 controller 不转发 `stale` / `degraded`、变更请求由直接调用替身种下，两者都不是本 PR 的范围 |
| 17 | 2026-10-08 01:55 CST / 协调者（开发账号 SingularityKChen） | 开 draft PR #292 后把 #221 的 Project 10 `Status` 由 `Todo` 置 `In Progress`、`ExecPlan` 文本字段写本计划路径（机械回填） | 依据：`docs/exec-plan/completed/2026-10-07-iteration-5-6-planning.md` Decision Log 的 H3 行（人类批准迭代 5–6 的条目在开 draft PR 时由 agent 置 In Progress），写入前已回读原文。撤销：`Status` 写回 `Todo`、清空 `ExecPlan`。 |
| 18 | 2026-10-08 02:24 CST / 实现者（对抗验证修订） | 快照的每个集合记录确认时的锚点 `anchorId`，读回按 `(from, type, to)` 取边；不把 `to` 钉在快照当前的提交上 | 对抗验证 P1（S12）：同一流水线实体在关系表里有多条 `runs_on` 边。钉在当前提交上会让陈旧集合（第 11 行）的旧提交跳消失；记录锚点既修 P1，又保住第 11 行。端口多一个字段，SQLite 的 JSON 列不需要迁移，首发前不写兼容（旧行读回 `anchorId` 为 `undefined`，那一跳不显示，下一次完整读取重写）。判别：「两个上下文共享同一头提交」，变异 N1、X14 |
| 19 | 2026-10-08 02:24 CST / 实现者（对抗验证修订） | 乱序令牌是同一个 core 上下文对象内严格递增的读取开始时刻（`max(clock(), 上一次 + 1ms)`），不加代际整数列；被守卫丢弃的刷新让投影报 `degraded`。残留：重启后时钟早于已提交的 `attemptedAt` 时刷新被丢弃，直到时钟追上（**第 26 行取代**：令牌改取已提交值加 1 毫秒，这个残留与对象内计数的限制都不再存在） | 对抗验证 P2、P3（S13）。进程内顺序就是调用顺序，同步取号即可，不改端口与迁移；跨重启的时钟回拨极少，且已经由降级而不是静默丢弃表达。降级会让「刚好输给并发刷新」的那次查询也报 `degraded`（此时快照其实是最新的），宁可保守；#222 之后刷新是命令，结果里有 `applied`。判别：「乱序」六个变体、「刷新结果与快照时刻」，变异 N2、N3、N4 |
| 20 | 2026-10-08 02:24 CST / 实现者（对抗验证修订） | K2 扩到读取阶段：`readChainFacts` 在 `try` 里，读取失败走与提交失败相同的降级事务与结构化结果；结构化错误转发进过渡期的投影；不加内部诊断 cause | 这是 S11 留给验证者与人类评审的裁决，按 K2 与 ADR-0011 第 8 条的文字办。`CoreContext` 没有诊断出口，加一个是接口决定（PR-A 的 ADR-0012 管结构化失败），不在本 PR；代价是写者的 `catch` 里程序错误与存储失败不可区分，已登记给 PR-A。判别：「失败不清空」里的「provider 抛出裸异常」，变异 N7、N15 |
| 21 | 2026-10-08 02:24 CST / 实现者（对抗验证修订） | 分支存在而头部提交未知记 `DevelopmentRepositoryRead` 缺口，不当作「没有 head」 | 对抗验证 P2（S15）：验收 3 要求没能确认不存在的读取不得删除。代价：一个真的没有提交的分支（空仓库）上，下游集合会一直标陈旧而不是空，这是保守方向。判别：「失败不清空」里的「分支头部提交缺失」，变异 N6 |
| 22 | 2026-10-08 02:24 CST / 实现者（对抗验证修订） | 读路径先读快照再读关系，不加「节点找不到边就降级」 | 对抗验证 P2（S16）：单调安全，改一行顺序即可；找不到边只在手写快照（TD-041）时出现，不为它再加一条分支。判别：「读路径先读快照再读关系」，变异 N5 |
| 23 | 2026-10-08 02:24 CST / 实现者（对抗验证修订） | TD-009 改回 Open 并收窄，不对非 Ready 的上下文做门控；Decision Log 第 3 行与 tracker 的措辞订正，补「Failed 的上下文仍显示 tracks 与 has_worktree 跳」用例，并在 Provisioning 用例里断言只写候选边 | 对抗验证 P2（S17）。门控要把非 Ready 的记录在 `readChainFacts` 里当未观察：Failed / Closed 的旧快照从此既不刷新也不标陈旧，是新的行为取舍，应在 #222 的刷新命令里由人类裁决，不在本 PR 里顺手定。判别：变异 N11 |
| 24 | 2026-10-08 02:24 CST / 实现者（对抗验证修订） | 代码规模：本批修复后代码桶超过 800 的规划上限（C4 后 903，C5 后 988，CI 硬门 1000 以内）；不启用 D3 切缝，也不为凑数删判别用例，请协调者裁决上限（第 29 行有两半的行数） | 增量几乎都是对抗验证点名问题的判别用例（用例在修复前变红）与 `anchorId`、读取阶段的 `try`、严格递增时刻三处实现（约 30 行）；D3 的触发条件写的是「超过 800 行」，而第二轮对抗验证指出切缝能让两半都在 800 以内，C5 的实测（第 29 行）是：core 半在关系端点对齐随写者走之后仍约 815，`AGENTS.md` §5 也不要求为 LOC 数字机械拆分；先审设计膨胀：除上面三处没有可删的机制 |
| 25 | 2026-10-08 02:24 CST / 实现者（对抗验证修订） | 对抗验证里不修的 P3：`hop.unavailable` 恒为 `false` 的变异存活；写者 `catch` 没有内部诊断 | 前者当时判断需要替身开关、超出文件集合；**判断是错的**（S23），C5 用 `composeCore` 的 `policy` 补了用例，变异 Z16 被杀死。后者见第 20 行，仍未做。号段 TD-040–TD-044 已用完，请协调者决定是否分配 TD-045（第 28 行）（C7 订正：不另占号，见第 38 行） |
| 26 | 2026-10-08 05:20 CST / 实现者（第二轮对抗验证修订） | 乱序令牌取墙钟、「读取开始时已提交的 `attemptedAt` 加 1 毫秒」、「对象内上一次令牌加 1 毫秒」三者的最大值；守卫改成 `>=`（已提交的不早于本次令牌即放弃）；不加代际整数列 | S19、S20。令牌必须来自所有写者共享的东西，已提交的行本来就有 `attemptedAt`，把它当逻辑时钟用，既消除「令牌跑在墙钟前面」与「时钟回拨后刷新丢失」，又不改端口与迁移。取舍：读取开始时彼此看不见的并发读取令牌平手（只可能来自不同的 core 上下文对象），先提交者胜，后者放弃并让投影降级，自愈于下一次刷新；这比「平手时后提交者胜、较旧读取覆盖较新事实」保守。多一次事务外的本地读（读失败按 0 处理，不阻断刷新）。第 19 行的残留不再存在。判别：「被放弃的刷新」「乱序」六个变体「刷新结果与快照时刻」；变异 N2、N3、Z24、Z36、Z37、Z38 |
| 27 | 同上 | 失败或被放弃的刷新（`!ok`，或 `anchored && !applied`）让查询把 provider 读取的跳逐跳标 `stale`，命令事实（tracks / has_worktree）不变；`anchored` 在读取阶段失败时记为 false | S19：controller 只转发跳，投影级 `degraded` 到不了 UI。被放弃的刷新让并发中较晚读到的、其实更新的快照也被标陈旧，是保守取舍（第 19 行已接受），刷新命令（#222）有 `applied` 之后这一层随刷新调用一起删除。读取阶段就失败时还不知道有没有锚点，`anchored: true` 是过度声明。判别：「被放弃的刷新」「没有可提交的快照时」「刷新结果与快照时刻」；变异 N4、Z3、Z35、Z39、Z40 |
| 28 | 同上 | K2 与 ADR-0011 第 8 条收窄到「唯一写者」，读路径的存储异常原样 reject，不折成结构化降级投影；不新增 TD 号 | S24。所有其它查询对存储异常都是原样 reject（base 同样），只把这一个查询做成特例，会在 ADR-0012 之前造出第二套失败约定；PR-A 的规则正文落地后统一。号段 TD-040–TD-044 已用完，请协调者分配 TD-045，登记「查询读半边的存储异常原样 reject」与第 20 行的「写者 catch 没有内部诊断」（C7 订正：这两条不在本 PR 另占号，见第 38 行） |
| 29 | 同上 | 规模取舍交协调者：本批不删判别用例，也不启用 D3 | 数字见 Design 的估算表：代码 988，实现 421（K8 约 350），测试 567。设计膨胀审查：实现多出的 71 行都对应一个有复现的缺陷（锚点、读取阶段 `try`、令牌、头部提交缺口、逐跳标陈旧、路由缝），没有可删的机制；测试是实现的 1.3 倍，几乎每行对应一个杀死变异的判别用例，删了就是放掉一个已复现的缺陷。D3 的切缝按文件分，存储层约 218、core 约 770；但关系端点对齐（替身 5 行加契约约 40 行）必须随写者走，否则 S5 的 7 条既有用例变红，按此口径约 173 与 815，core 半仍超 800 约 15 行。选项：①明确放宽到 CI 硬门 1000 以内；②启用 D3，并在 core 半再删约 15 行；③两者都不选，就必须删掉已有的判别用例。代码桶一旦超过 1000，只剩②和③ |
| 30 | 同上 | 第一页就截断的首次读取不展示未确认的第一页，保留 TD-040 的取舍并用例钉住 | 第二轮对抗验证 P3：base 显示第一页的 50 条流水线，head 只有检查（3 条）。显示未确认的第一页就要部分增补，而「不部分增补」是第 1 行与被放弃方案的前提（要按节点算陈旧）；#232 完整分页落地后此情形消失。判别：「没有可提交的快照时」的第三段。请协调者确认取舍。**Superseded by #295（2026-10-08，main `a357ef8` 起）**：main 的 `collectDeliveryPages` 遇到读不完同样整组放弃，base 不再显示第一页，这一行不再是需要确认的取舍；用例仍钉住「读不完不展示未确认的页」 |
| 31 | 2026-10-08 06:30 CST / 验收者 | 过渡期查询的 `unconfirmed` 改为「刷新失败，或没有被应用而仍显示旧快照（有锚点，或有 provider 读取的跳）」；从未开始工作的作用域（没有锚点也没有快照）不降级。同时补记：C5 删除了「读路径按本上下文的工作树取 derived_from」，X14 由「两个上下文共享同一头提交」杀死，I8 已同步 | S25。这是第 27 行同一条规则漏掉的实例，改一行判定，不是新机制。只看 `!applied` 会让从未开始工作的作用域也降级（「负向」用例说的「没有观察不是降级」）；保留 `anchored ||`，有锚点而快照里没有 provider 跳的被放弃刷新照旧降级（变异 Q2 存活：要构造「已确认为空的快照又被放弃」，不补用例）。判别：「被放弃的刷新」新增的无锚点断言在修复前的代码（`0bf8b70`）上变红；变异 Q1 |
| 32 | 同上 | 第三轮对抗验证点名的存活变异用断言补上，不新增用例；两个测试辅助取代复制的代码；升级测试恢复字面期望 | S26。全量用例条数不变（1237）。`flood` 取代四处 60 条造数，`throwInside` 取代两处事务内注入。「提交失败」改为事务内抛错；「事务体执行前就被拒绝」的路径仍由「刷新结果与快照时刻」的双重故障与「乱序」的较旧读取提交失败覆盖。升级测试改回字面 `[5, 6]` 与 `[1, 2, 3, 4, 5, 6]`，代价是下一个迁移要改这三处，换来钉住「005 恰好执行一次」。写者每个集合只算一次 `setOf`。判别：NV1–NV4、NV7、NV11、NV17、NV18、NV25、NV40 |
| 33 | 同上 | 规模：验收后代码 990 / 1000、文档见 C6 Progress；规划上限 800 是否放宽仍交人类。验收者不启用 D3、不删判别断言，也不再接收新的行为修复 | 第 24、29 行。D3 要改写分支与提交历史，验收者被约束不改写历史；删断言会放掉已复现的缺陷。CI 硬门只剩 10 行余量：K3 的 `routeDevelopment` 替换（约 20 行）与 K4 的 #289 冲突解决都由后合并者承担，本 PR 若后于 PR-B 或 #289 合并，就可能越过硬门，所以建议本 PR 先合并，或由后合并的那一方承担替换 |
| 34 | 2026-10-08 10:05 CST / 规模收敛者（C7） | 测试按机制合并，不删独占杀死变异的断言：完整性表 `COMPLETENESS` 由两条离线保留各跑一遍，取代「失败不清空」「Development 查找」「路由失败不清空」、两条「完整空集合才删除」与 Failed 用例；「重复刷新收敛」并入「唯一写者」；「被放弃的刷新」成为「乱序」的第七个变体；并发令牌并入「刷新结果与快照时刻」；契约的父行与端点拒绝并入「悬空父边与非法枚举必须被拒绝」 | 人类伙伴要求代码不超过 800，并先找 dead code 与可简化之处。「变异 → 全部杀手」表（S29）说明，这些用例的场景同构（在线确认、注入、刷新、读、比较），重复的是构造，不是判别力。合并后的通用断言更强（逐跳陈旧、CI 事实整体相等、每行断言 `unavailable`），SQLite 也覆盖了整张故障表；97 条变异整表重做，被杀死的集合不变（C7 Progress）。代价：一条用例里一个场景失败会遮住同一用例里后面的场景，失败消息带场景名 |
| 35 | 同上 | 实现只做行为不变的收紧：`readDeliveryProjection` 的跳组装、`rowToDeliveryFacts` 的解构重建、路由缝复用 `readRoute`、`SETS` 去掉冗余的 `satisfies`、注释与几处单行化；不改端口、不改 K1–K8 写明的接口 | 逐个机制问「它保护哪条验收或不变量」之后，实现里没有可删的机制（第 29 行的结论仍成立），能收的只有表达方式。行为不变的证据有两条：新实现跑 C6 的旧测试 1237/1237；97 条变异在「新实现加旧测试」上被杀死的集合与 C6 相同。`rowToDeliveryFacts` 对 `null` 的差别见 S30 |
| 36 | 同上 | 既有四条用例（「交付谱系：每一跳」「正向」「候选关系」「缺可选能力」）里为 #222 切换准备的 `await ingest` 行与「候选关系」里的那处替换移出本 PR，由 #222 在把 `ingest` 换成命令时补上；第 6 行据此订正 | 栈底只写自己的事实：这五行在本 PR 里不改变行为（查询自己会刷新），只为让栈上层的切换少改几行；补回它们属于 #222 的切换 |
| 37 | 同上 | 删掉三处被蕴含的断言或死导入：schema 审查的凭据列正则（被四列字面清单蕴含）、「两个上下文共享同一头提交」里「流水线跳挂在本上下文自己的提交上」（被同一用例的锚点断言蕴含）、e2e 没有使用的 `makeRelation` 与 `chainEntityId` 导入 | 三处都不独占任何变异；前两处在同一用例里有更强的断言覆盖同一性质，第三处是 C5 删掉用例后留下的死代码 |
| 38 | 同上 | TD 号：协调者另分配 TD-050–TD-053，本 PR 用 TD-050（共享头部提交的两个上下文取到同一个变更请求）与 TD-051（令牌平手时较新的读取被丢弃到下一次刷新）；「查询读半边的存储异常原样 reject」与「写者 `catch` 没有内部诊断」不在本 PR 另占号；ADR-0011 第 7 条末句改成 PR-C 合并时成立的过渡措辞 | 协调者裁定：栈上层会在自己的号段登记同一件事，本 PR 不重复登记，本计划也不引用只在栈上层存在的号。代价：本 PR 单独合并、#222 未合并时，那两条只记在第 20、28 行，tracker 里没有对应行，交人类决定是否接受。ADR 第 7 条原句把 #221 期间查询的行为写成了长期规则，#222 之后不成立（栈上层的对抗验证指出），改法与第 9 条的过渡写法一致 |
| 39 | 2026-10-08 11:19 CST / 修复者（C8） | 第四轮对抗验证通过，6 条 P3 不在本 PR 补断言：JSON `null` 一项维持现状（S30），其余五项已移交 #222 的分支补断言；ADR-0011 第 3 条的 `attemptedAt` 订正为「最近一次写入本行的刷新开始读取的时刻」 | 代码桶 799 / 800，补任何一条断言都会越过规划上限（Decision Log 第 34 行的取舍是不删独占杀死变异的断言，也不再加行）；这些 P3 守的是已有行为的边角，本 PR 的验收（#221 的四条）不依赖它们。ADR 的订正是事实纠错而不是新决策：`delivery-facts.ts` 的 `catch` 在 PR-C 起就前移 `attemptedAt`（第 8 条），第 3 条的定义漏写了这一路 |
| 40 | 2026-10-08 19:40 CST / rebase 适配者（C9） | `chain-facts.ts` 的冲突按 K4 解决：Delivery 两处保留 main 的 `collectDeliveryPages`、`factFor(status, conclusion)` 与 `readChecks(context, repositoryId, commit, gaps)`，只把能力门换成路由结论 `readRoute(context, key)`；`gated` 的 `run` 回到泛型结果，`settled` 默认恒真，只由 Development 两类查找传入；路由缝 `developmentReadBinding` 不变 | K4 把 Delivery 的分页与映射归 #232，本 PR 是后合并者，负责适配。旧的默认谓词「页带 `nextCursor` 即缺口」对 `collectDeliveryPages` 返回的数组没有意义，留着就是第二道、永不触发的守卫；删掉后 Delivery 的完整性只有 #295 一个 owner。判别：M7、X9–X12 仍被杀死，X8 不再适用，X8r 证明 #295 的守卫被本 PR 的用例钉住（C9 Progress） |
| 41 | 同上 | 完整性规则、写者的边与锚点不随 #295 改变：检查的 `runs_on` 仍挂变更请求，`check_run` 的完整仍依赖 `change_request` 完整 | S33。main 换了检查的读取键（仓库 + 已观察提交），没换前置门（变更请求已观察才读检查），也没换 `chainEdges` 里检查的锚点。变更请求被完整读到而不存在时，下游检查是完整的空集合；变更请求读取有缺口时，检查集合保留并标陈旧——两条与新读路径的前置门逐一对应。改挂提交会给同一检查实体写出第二条 `runs_on`（不变量 6）（C10 订正：这句论证过头，真实理由是 ADR-0011 第 3 条、main 的 `chainEdges` 与读取前置门，见 S33） |
| 42 | 同上 | 测试适配：完整性表的两行 Delivery 截断改为一行「检查分页读不完」（替身让页永远带 `nextCursor` 并重复投递，#295 报成缺口），「没有可提交的快照时」的首次截断改用同一个注入，删去流水线那一行 | S32：60 条造数在完整分页下被完整读完，原期望（标陈旧）不再成立。流水线的单键缺口已由「流水线读能力被摘掉」一行覆盖，#295 在流水线上的读不完路径仍由「没有可提交的快照时」覆盖，删去不损失判别力（X8r、X17 仍被杀死）；代码桶因此停在 800 |
| 43 | 同上 | K3 接线本轮不做。#291 合并进 main 之后，本 PR 再 rebase 一次：把 `developmentReadBinding` 的函数体换成 `routeDevelopment(...)`，补「已登记仓库的多挂载谱系读只进路由到的挂载」正例，并先证明正例在缝没接上时变红 | 人类伙伴 2026-10-08 裁决的合并顺序是 #290 → #291 → #292 → #293，本 PR 是 K3 的后合并者；#291 现在仍是 open。接线约 20 行实现加一条正例，代码桶会从 800 越过规划上限（硬门 1000 以内），届时按 K8 先审设计，再把是否放宽交人类（Superseded by 第 45 行：接线由 #297 单独做） |
| 44 | 2026-10-08 / 人类伙伴（人类专属，在协调者会话里直接回答；C10 补记原文） | K3 接线的第一次裁决，所选答复原文「#290 → #291 first, #292 does the wiring (Recommended)」，选项说明写的是 "#292's rebase onto main also takes the K3 routing wiring (with a test that goes red if the seam isn't wired)"。对本 PR 的含义：#291 合并后本 PR 再 rebase 一次，把 `developmentReadBinding` 的函数体换成 `routeDevelopment`，并补一条缝没接上就变红的正例（第 43 行据此写）。接线会让代码桶越过规划上限，怎么处理当时待人类再裁决。**第 45 行取代**：接线不再由本 PR 承担 | 合并顺序与接线归属是人类专属的取舍；第 43 行只记了合并顺序，没有记原文与选项说明，这里补齐，让第 45 行取代的是什么可查 |
| 45 | 2026-10-08 / 人类伙伴（人类专属，在协调者会话里直接回答；C10 记录） | K3 接线的落点，所选答复原文「Separate small PR (Recommended)」：接线改由新 issue #297（"feat(core): route delivery lineage reads through repository routing"，#216 的子 issue）在 #219 与 #221 都进 main 后单独做，内容是把 `developmentReadBinding` 的函数体换成 `routeDevelopment`，并补一条正例：两个 Development 挂载、仓库登记在其中一个上，只调用那个挂载并记下提交与变更请求跳，缝没接上时该正例变红。本 PR 不再等 #291 合并；第 43 行、K3 行与 C9 Progress 里「后合并者接线」「本 PR rebase 时接线」的安排作废。协调者已在 #221 发决策评论（issuecomment-6060231866） | 接线放进本 PR 会让代码桶越过规划上限 800；单独的小 PR 把接线与它的正例做成可以独立评审、合并与回滚的闭环。#297 之前不会读错连接：#291 合并前多 Development 挂载不可构造（S21）；#291 合并后同域多个挂载一律非默认，`bindingForCapability` 对 Development 键 fail closed，`readRoute` 失败，谱系读取退化为缺口（由完整性表的「Development 读能力被摘掉」「变更请求读能力被摘掉」两行覆盖同一条缺口路径）。`chain-facts.ts` 里路由缝的注释改指 #297，不增行 |
| 46 | 2026-10-08 / 修复者（C10） | `gated` 的 `settled` 默认谓词由恒真改为 `(value) => Array.isArray(value)`：只有 `collectDeliveryPages` 交来的完整数组算读完；返回单页的调用点不传自己的谓词，就一律是缺口 | rebase 后独立对抗验证 P3-2：恒真的默认值是 fail-open，以后给 `gated` 加一个返回单页的调用点而忘了传谓词，截断就会被当成完整读取。改法零行，今天的四个调用点行为不变（Delivery 两处交数组，Development 两处自带谓词），所以把默认值改回恒真是今天的等价变异（变异 S1，C10 Progress）；它保护的是以后的调用点。它不检查数组是否读完，不是第 40 行删掉的「第二道 Delivery 完整性守卫」，Delivery 的完整性仍只有 #295 一个 owner |
| 47 | 2026-10-08 / 修复者（C10） | 完整性表补「检查读能力被摘掉」「变更请求读能力被摘掉」两行；为不越过规划上限 800，删去「乱序」参数表里「时钟递增」「时钟回拨」两行（四条用例），其余用例与实现不删 | rebase 之后独立对抗验证 P3-1：V2、V9 在全量下存活，两行补上之后代码桶 802。先按 C7 的办法审简化（C10 Progress 的三类）：main 新增的夹具与 helper 里没有与本 PR 测试辅助同功能的；同构用例里只有两个时钟变体不独占任何变异（S34）；「Delivery 权限被拒」与「Delivery 离线」、「检查分页读不完」与新的「检查读能力被摘掉」在写者层同构，但前者是 #221 验收 3 点名的「权限受限」，后者是 A3 与矩阵第 10 行引用的「读不完」证据，保留；实现里没有可删的分支（写者的 `!facts.context.observed ||` 被工作树句柄蕴含，删掉不省行）。删后代码 800；补行之后、删除之前与最终代码树共有的 106 条规格，被杀死的集合相同（C10 Progress） |
| 48 | 2026-10-08 / 人类伙伴（人类专属，在协调者会话里直接回答；C11 记录） | #292 第一轮评审 P2 的落点，所选答复原文「PR side here, branch to #233 (Recommended)」：本 PR 把变更请求查找改用 main 上已有的 `listChangeRequests({ headBranch })`（#287），据此关闭 TD-050；分支查找仍是首页 50 条，上限写进 TD-040 与矩阵第 10 行，承接 #233（协调者在 #233 加的验收框原文见 TD-040） | 评审探针：60 条排在 `work/` 之前的分支时 head 只有降级、没有 CI，base 是静默为空，不是本 PR 的回归；变更请求一侧零成本可修，端口语义见 S35 |
| 49 | 2026-10-09 / 修复者（C11） | 变更请求只经服务端过滤认分支，仍只认 `sourceVersion === head`；客户端不再判 `headBranch === branch`，也不退回无过滤的查找 | 过滤是端口契约、有契约套件守护，客户端复判在任何合规 provider 上都是等价变异，没有判别用例；退回无过滤查找会让同一头提交上别的分支的变更请求重新挂进本链（TD-050 的原样）。以直接提交 sha 创建、没有分支身份的变更请求不进谱系（端口不按 sha 反推分支）。判别：H1、H2 |
| 50 | 同上 | 判别用例的落点：B2 由完整性表新增的「流水线页形非法」杀死；T11 由「两个 core 上下文对象」加跑「较旧的读取提交失败」杀死（零行）；T17 的变体（较新的读取遇到 Development 离线）与 `.putRelation(` 的静态守卫放进 #293。只合并 #292 时这两格没有用例，#293 随后合并补上 | 代码桶 800，四项都放进来要越过规划上限；纯测试性质的补充先放栈上层。B2 只在本 PR 单独合并时没有杀手（#293 的刷新包装断言刷新不失败），所以留在本 PR |
| 51 | 同上 | 删去两处被蕴含的断言：完整性表在线时「命令事实与 provider 读取的来源分开标注」的集合断言，「刷新结果与快照时刻」里没有执行上下文时的 `record() === undefined` | 前者不独占任何变异：Z12 少了两条离线保留这两个杀手，仍被共享头提交与乱序 5 条杀死；后者被同一用例的结果断言与 Storage 的父行约束蕴含。113 条整表里没有一条由杀死变为存活 |
| 52 | 同上 | `confirmedAt` 在本 PR 只在写者内部使用（等于乱序令牌），由 #293 改为读取开始时的墙钟读数 | 协调者按人类授权调研后决定，人类可推翻；依据与出处见 #293 计划的「调研依据」。本 PR 的代码不变 |
| 53 | 2026-10-09 / 修复者（C12） | 变更请求查找的 `settled` 谓词先要求 `Array.isArray(page.items)`：页形非法的成功页是缺口，不是「完整读到的空集合」；永久的判别用例（完整性表的「变更请求页形非法」）随 #293，不放本 PR | #292 复评轮 P3：`{ items: null, nextCursor: undefined }` 因 `nextCursor` 为 `undefined` 直接算读完，`?? []` 又把 `null` 折成空数组，等于完整读到没有变更请求，最后确认的变更请求和它的三条检查被整组删除，与 ADR-0011 第 5 条「只有完整读到的集合才能删除」矛盾。Delivery 一侧由 #295 的形状守卫报成缺口，本处补齐同一个读侧约定；原地改写，不增行。本 PR 代码桶 800 正好在规划上限，一行用例就越过，所以用例放栈上层，只合并 #292 时这一格没有用例，变异 R1 存活（与 T17、G1 同类，第 50 行）。红绿与探针见 C12 Progress |
| 54 | 同上 | 分支查找的 `settled` 谓词不加 `Array.isArray(page.items)` | 复评轮建议「分支那一处同样处理」，但同一种坏页在分支查找上本来就不会被当成确认不存在：`read.value?.items.find` 在 `null` 上抛出，走 K2，四个集合逐跳标陈旧，返回结构化的 `unavailable`，不转发异常原文，没有事实被删。用临时行逐项对比加不加守卫（导出目录）：保留的 CI 事实、逐跳陈旧、`degraded`、重启读回都相同，唯一的差别是刷新返回值带不带 `error`，即错误通道上的差别，不是事实被删的差别。加守卫没有修任何缺陷，还要多一条永久用例，所以不改。以后若要让两类查找对坏页走同一种出口，是一行改动加一行用例 |

## Idempotence and Recovery

- **迁移 006 只执行一次**：由 `schema_migrations` 记账，第二次 `migrate` 的 `applied` 为 `[]`。测试库都建在临时目录里，可以重复跑。
- **刷新可以重复执行**：同一输入重复刷新，关系、快照节点与修订号都不变，只有 `attemptedAt` 前移。这一点由「重复刷新收敛」守护。
- **回到已知良好状态**：
  - 本地提交之前：`git restore --source=origin/main -- <文件>`。
  - 推送之前改写历史：先用 `git branch backup/delivery-fact-writer-<短 SHA>` 建恢复锚点。
  - 推送之后改写历史：走 `git-expert-operations`，用精确的 `--force-with-lease=<分支>:<回读到的远端 SHA>` 推送。
- **合并之后回滚**：revert 代码交付物提交。已经应用 006 的本机库被旧二进制拒绝打开，处置是删库重建（首发前没有用户数据，见 Global Constraints）。
- **对抗验证与变异只在导出目录里做**，不改工作树。导出目录要用带任务名与随机后缀的名字：临时目录可能被并行会话共用，通用目录名（例如 `proto`）会被别的会话覆盖。

## Interfaces and Dependencies

本节列出与本 PR 有关的跨 PR 契约（协调者 2026-10-08 裁定），以及本 PR 与相邻工作的接口。

### 契约 K1–K8

| 契约 | 本 PR 的落点 |
|---|---|
| K1 修订号（owner：PR-A #290） | 修订号是规划快照的版本，交付事实不在快照里，交付写者从不推进修订号；新鲜度由交付投影自己携带。以后若有 PR 把交付派生事实折进快照行，那个 PR 必须在同一提交里让它们参与「内容变化 ⇒ 推进」 |
| K2 结构化失败（PR-A，规则正文是 ADR-0012，C11 订正为 Accepted，PR #290 已合并） | 写者从读到提交的任何异常都折成结构化结果，不转发原文；读路径 `readDeliveryProjection` 的存储异常不在 K2 范围内，与其它查询一样原样 reject，结构化由 ADR-0012 与 #222 统一（Decision Log 第 28 行）。双重故障（降级记录也写不进）时返回诚实的失败，不算裸抛。交付域不写 `reconcile_cursor`（ADR-0012 第 7 条） |
| K3 Development 路由（owner：PR-B #291） | 本 PR 把 `chain-facts.ts` 的 Development 绑定解析收拢到模块私有的 `developmentReadBinding(context, key, repositoryId): Promise<{ ok: true, binding, repository } \| { ok: false, error }>`，调用方只用返回的 `repository` 调 provider。PR-B 的路由是 `routeDevelopment(source: { workspaceId, registry, storage: Pick<Storage,'listRepositories'\|'findExternalIdentity'> }, repositoryId, key, mode)`，位于 `packages/core/src/development-route.ts`，不从 `index.ts` 导出，返回 `{ ok: true, binding, provider, repository } \| { ok: false, error }`。两者都合并后，**后合并的一方**把缝的函数体换成 `routeDevelopment(...)` 并去掉 `provider` 字段（预计不超过 20 行，允许越过文件边界，并在 PR 正文写明），同时补一条「已登记仓库的多 Development 挂载谱系读」正例。在此之前，路由失败（能力被策略摘掉、没有绑定）退化为缺口，不会读错连接，由「路由失败不清空」覆盖；`CoreProviderTable` 每域只有一个 provider，多挂载的 Development 在 PR-B 之前不可构造，所以「多挂载退化为缺口」今天没有可运行的用例，由 PR-B 补那条正例。PR-B 不改 `chain-facts.ts`、`delivery.ts`、`relations.ts`、`queries.ts`、`context.ts`、`bootstrap.ts`。本 PR 的 C3 收口时回读 `git ls-tree origin/main packages/core/src/development-route.ts`：有输出就说明 PR-B 已合并，由本 PR 做这次替换（C9（2026-10-08）：合并顺序 #290 → #291 → #292 → #293 已由人类伙伴裁决，本 PR 是后合并者；#291 尚未合并，接线留到它合并后的下一次 rebase，Decision Log 第 43 行。Superseded by Decision Log 第 45 行（C10）：接线与多挂载正例由 #297 在 #219 与 #221 都进 main 后单独做，本 PR 不再等 #291；「后合并的一方」的安排作废） |
| K4 Delivery 读取内部（owner：PR #289 / #232） | 本 PR 不实现 `collectDeliveryPages`、`factFor(status, conclusion)`、`readChecks` 的新签名与 Delivery 端口的改动。完整性判定只消费 `chain-facts` 产出的缺口。最小截断守卫只放在 `gated` 一处，注明由 #289 取代。冲突由后合并者解决：#289 后合并时删掉 Delivery 两处的 `settled` 谓词，换成它的完整收集（C9（2026-10-08）：#295 已合并，本 PR 作为后合并者已删掉 Delivery 两处的 `settled` 谓词，换成它的完整收集，Decision Log 第 40 行） |
| K5 新鲜度落点 | 不写 `PLANNING_SYNC_SCOPE` 游标，不影响 `getPlanningSync()`，不复用 `sync_cursor`（不触发 TD-021） |
| K6 编号 | ADR-0011；迁移 006；TD-040–TD-044，C7 另用协调者分配的 TD-050、TD-051（TD-052、TD-053 未用）；ExecPlan 日期 2026-10-08 |
| K7 共享文件 | `docs/README.md`、tracker、`vertical-path.md` §2.1、控制计划只改本 PR 自己的行；后合并者 rebase 时解决冲突 |
| K8 规模 | 见 Design 的估算 |

### 与相邻工作的接口

- **PR-D（#222，`fix/delivery-query-pure-read`，栈在本 PR 上）**：
  - 以本 PR 合并后的接口为前提：`refreshDeliveryFacts`、`DeliveryRefreshResult`（`ok: false` 也覆盖读取阶段的异常，`anchored` 在读取阶段失败时为 false；`applied: false` 是令牌平手或更晚的并发读取已提交，或没有锚点而根本没读（`anchored: false`）；只要仍显示旧快照，查询据此降级并逐跳标陈旧；令牌取自已提交快照，刷新命令不需要自己管时钟）、`readDeliveryProjection`、`DeliveryFactsRecord`（集合多了 `anchorId`）、`DeliveryLineageHop.stale`，以及测试里的 `ingest`（C7 起，「交付谱系：每一跳」「正向」「候选关系」「缺可选能力」四条既有用例里为切换准备的 `ingest` 行不在本 PR，#222 换成命令时补上；本 PR 的新用例经 `chainOf` 夹具摄入）。#222 把 `getDeliveryProjection` 里的刷新调用删掉之后，「被丢弃的刷新让投影降级」那一条随之由刷新命令的 `applied` 承接。
  - PR-D 删掉 `getDeliveryProjection` 里的刷新调用，新增 `CoreCommands.refreshDeliveryFacts` 与 controller 的命令 / 查询，并让「首读纯读」先红。
  - 本 PR 改名或改形任何一项，都必须同步写进 PR-D 的计划。
- **PR-A #290（#199、#220）**：
  - 修订号的共享原语如果先落地，本 PR 不需要它，因为本 PR 不推进修订号。
  - 本 PR 不碰 `bootstrap.ts`、`queries.ts`、`context.ts`，没有文本冲突。
  - `StorageSurface` 那一行如果两边都改，后合并者合并成员列表。
- **PR #289（#232）**：
  - `chain-facts.ts` 的 `readPipelines`、`readChecks`、`gated` 会有文本冲突，按 K4 处理。（C9：#232 拆成 #295 与 #289 并都已合并，冲突在本 PR rebase 时按 K4 解决，见 Decision Log 第 40 行）
  - #289 的集成测试 `tests/integration/github-actions-ci-facts.test.js`（将新建）经 `getDeliveryProjection` 读取，在本 PR 之后仍然可行。#222 之后它必须先调刷新命令，由 PR-D 的计划承接。（C9：它与 #295 的 `tests/integration/delivery-pages-complete.test.js` 都已在 main，rebase 后在本 PR 上通过）
- **#287（#279）**：给变更请求加 `headBranch`；本 PR 按 `sourceVersion === head` 查找，不受影响。（Superseded by C11（2026-10-08）：#287 已在 main，`readChangeRequest` 改按 `headBranch` 过滤，TD-050 已解决。）
- **#233（谱系同步）**：必须扩展本写者的集合，不得另起第二个写者。变更请求实体以后改走身份表时，下一次刷新会改写 `entityId`，不需要迁移。
- **#234（抽屉谱系条）与 #281（交付视图）**：读 `hop.stale`，以及 PR-D 加的 `freshness`、`gaps`。陈旧值不能显示成当前值，要按 `hop.to` 归组（TD-042）。
- **#134**：范围排除交付绑定（2026-10-09 订正：原写「#134（定时刷新）调用 PR-D 的命令」；定时刷新与节流归宿主，承接方见 #293 的计划），按工作区列出执行上下文的端口仍待定。
- **#223（SQLite 基线）**：把 006 并入单一建库基线。`committed_observation` 仍然没有消费者。
- **#4（Gate E1）**：缓存键只依赖执行上下文 id（ADR-0006 的连接锚点与工作区挂载），节点身份依赖 `chainEntityId` 的工作区哈希。E1 推翻时，由 #223 的基线重写承担。
- **#224（dead code）**：`EdgeProvenance.ChainSkeleton` 在生产代码里不再有生产者，`DeliveryLineageHop.observed` 恒为 `true`、`detail` 恒为 `undefined`。本 PR 不删它们，登记给 #224。

### 拟新增的技术债行（C3 手工追加到 tracker 的 Open Items；TD-050、TD-051 是 C7 追加的）

| ID | 日期（本地） | 状态 | ExecPlan | 子系统 | 分支 | 记录者 | 简述 | 延期理由 | 遗留影响 | 下一步 |
|---|---|---|---|---|---|---|---|---|---|---|
| TD-040 | 2026-10-08 | Open | `docs/exec-plan/completed/2026-10-08-delivery-fact-writer.md` | 核心（`packages/core/src/chain-facts.ts`） | `feature/delivery-fact-writer` | #221 定稿评审者 | Delivery 两类读取只读第一页（`PAGE_LIMIT = 50`），页带 `nextCursor` 即整组按未知处理：超过 50 条运行或检查的集合，在 #232 完整分页落地前不会再更新，只保留最后确认值并标陈旧；首次读取就截断时没有 CI 跳。Development 的分支与变更请求查找也不翻页，目标不在第一页且有下一页时同样记缺口 | K4 把 Delivery 完整分页归 PR #289（#232），本 PR 只放最小守卫；Development 分页没有 owner，替身与本地 Git 的分支和变更请求远少于 50 条 | 真实大仓库（分支或 PR 超过 50）上谱系会长期陈旧或为空，但不会读错，也不会删除已确认事实 | #289 合并时用它的完整收集取代 Delivery 两处 `settled` 谓词；Development 两处随 #72 / #233 补完整翻页，之后删掉 `settled` 参数（Superseded by C9 Progress（2026-10-08）：Delivery 部分已由 #295 的 `collectDeliveryPages` 取代，本 PR rebase 时删掉了 Delivery 两处谓词；TD-040 收窄为 Development 两处查找，现行文本以 tracker 为准） |
| TD-041 | 2026-10-08 | Open | 同上 | 存储（`packages/storage/sqlite/migrations/006_delivery_facts.sql`、`packages/capabilities/src/storage.ts`） | 同上 | 同上 | 交付事实快照是一列 JSON（`sets_json`）：storage 只校验它是 JSON 数组、父行存在，不校验集合种类词表、节点 `entityId` 是否已登记、`confirmedAt` 格式；schema 审计看不到 JSON 内部字段 | 首发前与 Gate E1 前不冻结细粒度模型；唯一写者是 core，没有跨上下文查询；关系形状要多三种可分叉的适配器语义 | 直接调用端口的宿主或测试能写入形状错误的快照，读路径只能按缺字段降级；跨上下文查询（#134、#233）要全表扫描 | #223 合并基线时重审；出现跨上下文查询或第二个读方时，规范化成（上下文，集合，节点）行 |
| TD-042 | 2026-10-08 | Open | 同上 | 核心（`packages/core/src/delivery.ts`） | 同上 | 同上 | 陈旧集合按记录时的锚点显示：head 前移而 Delivery 离线时，旧提交上的流水线仍作为陈旧跳显示，`hop.to` 指向旧提交实体，而提交跳已经是新 head | 只有完整读取才能删除（#221 验收 3），锚点前移不等于旧运行被确认不存在 | 消费方如果按位置、而不是按 `hop.to` 归组，会把旧提交的 CI 挂到新 head 下 | #234 / #281 按 `hop.to` 归组并显示陈旧；或由 #233 决定锚点前移时把旧集合降为历史 |
| TD-043 | 2026-10-08 | Open | 同上 | 核心（`packages/core/src/chain-facts.ts`、`packages/core/src/projection.ts`） | 同上 | 同上 | 快照存的是 core 在确认时派生的 `fact` 与显示用的 `label`，不是平台原样的 `status` / `conclusion`：#289 把 `factFor` 改成 `(status, conclusion)` 之后，已存的行要等下一次完整刷新才会按新映射更新；陈旧的 `ci_passed` 仍会被 `toDeliveryFacts` 折成派生标记 | 改存原样值要改 `readChainFacts` 的读出形状，与 #289 正在重写的读取冲突（K4）；折叠规则属于 #234 的展示 | 映射变更后到下一次刷新之间显示旧的派生值；陈旧的「通过」可能被当成当前的「通过」 | #289 合并后评估改存原样值（JSON 加字段，不需迁移）；#234 规定陈旧跳不进派生标记，或显式标「最后已知」（C9 订正（2026-10-08）：`factFor(status, conclusion)` 由 #295 落地并已合并，现行文本以 tracker 为准） |
| TD-044 | 2026-10-08 | Open | 同上 | 核心与存储端口（`packages/core/src/relations.ts`、`packages/capabilities/src/storage.ts`） | 同上 | 同上 | 被取代的候选边不删除：head 前移后，旧提交的 `derived_from`、旧运行的 `runs_on` 留在关系表里成为历史；读路径因此每次读取都全量 `listRelations`，与 TD-007 叠加 | 端口没有删除关系的方法；当前集合由快照承载，关系是历史，删除要单独的保留策略 | 关系表随 head 推进单调增长，读的代价线性增长 | 与 TD-007 同批：端口加按端点读关系的方法，或在 #223 基线里给候选边加保留策略 |
| TD-050 | 2026-10-08 | Open | `docs/exec-plan/completed/2026-10-08-delivery-fact-writer.md` | 核心（`packages/core/src/chain-facts.ts`） | `feature/delivery-fact-writer` | #221 规模收敛（Claude），依据第三轮对抗验证 | 两个执行上下文共享同一个头部提交时（同一仓库上两个工作项各自开始工作、都还没有新提交），`readChangeRequest` 只按 `sourceVersion === head` 查找，两个上下文会把同一个变更请求与它的检查记进各自的快照；流水线跳已按集合的 `anchorId` 区分上下文，变更请求没有（S12 的同根因残留） | 按分支匹配要用变更请求的 `headBranch`，那是 #279（PR #287）的端口改动，不在本 PR 的文件集（Global Constraints） | 共享头部提交的两个上下文显示同一个变更请求与检查，直到其中一条分支有新提交 | #287 合并后，`readChangeRequest` 先按 `headBranch === branch` 匹配、找不到再退回 `sourceVersion`，并在「两个上下文共享同一头提交」里补变更请求的断言 |
| TD-051 | 2026-10-08 | Open | `docs/exec-plan/completed/2026-10-08-delivery-fact-writer.md` | 核心（`packages/core/src/delivery-facts.ts`） | `feature/delivery-fact-writer` | #221 规模收敛（Claude），依据第二、三轮对抗验证 | 乱序令牌平手时先提交者胜：读取开始时彼此看不见的两次刷新（只可能来自不同的 core 上下文对象）拿到同一个令牌，守卫按 `>=` 放弃后提交的那次，即使它读到的 provider 状态更新；较新的事实要等下一次刷新才落库（Decision Log 第 26 行） | 消除平手要在快照行里加代际整数列（改端口、006 与两个适配器），或在提交事务里按已提交行重算令牌；今天一个进程只有一个 core 上下文对象，平手只在测试构造的两对象场景出现 | 平手时较新的读取被丢弃到下一次刷新；#221 期间查询把这次放弃显示为逐跳陈旧并降级，#222 起由刷新结果的 `applied: false` 表达 | 出现多个写者（#134 定时刷新、#233 谱系同步或多进程宿主）时，改成事务内按已提交行重算令牌或加代际列，并补「平手时较新的读取胜出」的用例 |

C11 订正：TD-040 收窄为分支一侧（承接 #233），TD-050 已解决，现行文字以 tracker 为准（Decision Log 第 48、49 行）。

## Outcomes & Retrospective

实现者部分（2026-10-08 01:37 CST；C4、C5 就地更新）：

- **行数**：`node scripts/rule-checks.mjs size origin/main` 的代码桶 C5 之后是 988 / 1000（规划上限 800；原型估算 670，C2 时 790，C4 后 903）。实现 421（K8 约 350），测试 567。设计膨胀审查与 D3 两半的行数见 Design 的估算表与 Decision Log 第 24、29 行：没有可删的机制，D3 单独也不能让两半都不超规划上限，取舍交协调者。文档桶见本批提交后的 `size` 输出。
- **变异**：M、N、X、Z 共 64 条全部在最终代码上被杀死（Validation 的变异表）；第二轮对抗验证点名的存活变异（X12、Z1、Z2、Z3、Z4、Z9、Z12、Z16、Z24、Z26、Z31、Z32、Z35）都已有用例杀死。
- **P3**：`relations 2 -> 9 | ci online 5 | ci offline 5 | degraded true`；SQLite 版同样保留 5 条并逐跳标陈旧。
- **全量**：`tests/contract tests/integration tests/e2e` 1237/1237（C5 之后；C4 时 1233，C2 时 1225），`tests/mvp0` 7/7，`tsc` 无输出，`boundaries` 退出 0。
- **对抗验证**：第一轮（`3aef993`）1 个 P1、5 个 P2、4 条 P3，全部属实，C4 已修（S12–S18，Decision Log 第 18–25 行）。第二轮（`ed554d0`）3 个 P2、7 条 P3，全部属实：令牌与逐跳可见性（S19、S20）、路由失败与若干存活变异（S21–S23）、K2 的范围（S24）已修或收窄；规模与首次读取截断的取舍、发布状态交协调者（Decision Log 第 29、30 行）。
- **遗留**：PR-D（#222）删掉 `getDeliveryProjection` 里的刷新调用并新增命令，被放弃的刷新逐跳标陈旧那一层随之由刷新结果的 `applied` 承接；#289（#232）后合并时用完整分页取代 Delivery 两处 `settled`（TD-040）（C10 订正：这件事已在 C9 做完——#295 已合并，本 PR rebase 时删掉了 Delivery 两处谓词，TD-040 收窄为 Development 两处查找）；#233 扩展本写者的集合，不得另起第二个写者；整合提交与归档后，tracker 里 TD-040 至 TD-044 的 ExecPlan 路径要由 `active` 改成 `completed`。C7 补登 TD-050（共享头部提交的两个上下文取到同一个变更请求）与 TD-051（令牌平手时较新的读取被丢弃到下一次刷新）；查询读半边的存储异常原样 reject、写者 `catch` 没有内部诊断两条不在本 PR 另占号（Decision Log 第 28、38 行）。

验收者部分（2026-10-08 06:45 CST，批次 C6）：

- **验收结论**：#221 的四条验收都有经入口的判别证据：离线保留（替身与 SQLite）、唯一写者（静态与行为）与提交失败（事务内抛错后已写的边随回滚撤销）、失败不清空（七种故障）与路由失败不清空、issue 原文的验收命令 184/184。第三轮对抗验证的 P2「没有锚点的刷新把旧快照当新鲜显示」已修（Decision Log 第 31 行），其余 P2 / P3 已补断言或交人类。
- **数字**：代码 990 / 1000（实现 418、测试 572），文档见 C6 Progress；全量 1237/1237，`tests/mvp0` 7/7；变异 97 条整表重做，存活的 6 条逐条说明见 C6 Progress。
- **交人类**：规划上限 800 是否放宽与合并次序（Decision Log 第 33 行）、ADR-0011 是否采纳（TD-009 收窄与 TD-014 取代都依赖它）、TD-045 起的号段（读半边原样 reject、写者 `catch` 没有内部诊断、共享头提交选错变更请求、平手时较新读取被放弃）、首次截断不显示的取舍（第 30 行）。（C7 订正：规划上限在 C7 之后已满足；号段落为 TD-050、TD-051，前两条不另占号，见 Decision Log 第 34、38 行。）整合提交时改写 `3db4aaf` 的标题（S18 ⑥）。

规模收敛者部分（2026-10-08 10:05 CST，批次 C7）：

- **数字**：代码 990 → 799（实现 418 → 384，测试 572 → 415），文档见 C7 Progress；全量 1225/1225，`tests/mvp0` 7/7；97 条变异整表重做，被杀死的集合不变，存活的仍是 C6 判定过的 6 条。
- **怎么收的**：没有删任何独占杀死变异的断言。测试按机制合并（完整性表、写者边界、乱序与被放弃）；实现没有可删的机制，只收紧表达（Decision Log 第 34–37 行）。
- **交人类**：
  - 规划上限只剩 1 行余量：K3 的 `routeDevelopment` 替换（约 20 行）若由本 PR 承担（PR-B 先合并），本 PR 会再次超过 800。（Superseded by Decision Log 第 45 行：替换由 #297 承担。）
  - 读半边原样 reject、写者 `catch` 没有诊断出口：本 PR 单独合并时这两条没有 tracker 行（Decision Log 第 38 行）。
  - ADR-0011 是否采纳，不变。

第四轮对抗验证（2026-10-08 11:19 CST，批次 C8）：

- **结论**：在 `a256dda` 上通过，没有 P0、P1、P2；6 条 P3 中 JSON `null` 一项维持现状（S30），其余五项（墙钟项、从未开始工作的作用域不降级、替身多上下文 upsert 谓词、SQLite 读回节点顺序、从未确认集合的 `confirmedAt` 与空集合提交失败）已移交 #222 的分支补断言，因为本 PR 的代码桶只剩 1 行余量。
- **文档**：ADR-0011 第 3 条 `attemptedAt` 的定义与代码一致。

rebase 适配者部分（2026-10-08 19:40 CST，批次 C9）：

- **结果**：本分支 rebase 到 `origin/main@a357ef8c`，唯一的冲突在 `chain-facts.ts`，按 K4 保留 #295 的读取实现；完整性规则、边与锚点不变（Decision Log 第 40、41 行）。全量 1334/1334、`tests/mvp0` 7/7，97 条变异被杀死的集合除 X8 换成 X8r 外与 C7 相同；代码 800。
- **交人类与协调者**：K3 接线等 #291 合并后由本 PR 承担，届时代码桶越过 800（Decision Log 第 43 行）（Superseded by Decision Log 第 45 行：人类伙伴改为由 #297 单独接线）；ADR-0011 是否采纳，不变。

rebase 之后对抗验证的修复者部分（2026-10-08 21:40 CST，批次 C10）：

- **结果**：对抗验证可接受，没有 P0–P2；四条 P3 都已处置（C10 Progress）。完整性表补两条路由门，V2、V9 由存活变为杀死；`settled` 的默认谓词改为 fail closed；删去两个被蕴含的时钟变体后代码桶 800。全量 1330/1330（C9 是 1334，删去四条时钟变体）、`tests/mvp0` 7/7；108 条变异 100 条被杀死，存活的 8 条逐条说明见 C10 Progress。
- **交人类与协调者**：K3 接线由 #297 单独做（Decision Log 第 45 行）；ADR-0011 是否采纳，不变。

修复轮部分（2026-10-09，批次 C11）：

- **结果**：P2 的变更请求一侧在本 PR 修复，TD-050 解决，分支一侧的首页上限交 #233；B2、T11 有了杀手，T17 与 `putRelation` 守卫随 #293；113 条变异 104 条被杀死；代码 800。

复评轮部分（2026-10-09，批次 C12）：

- **结果**：变更请求查找不再把页形非法的成功页当成完整空集合（探针 `0 / 0 | degraded false` 变为 `1s / 3s | degraded true`），分支查找经核对不改；订正用例注释、TD-040 的引用与迁移 006 的列注释；永久的判别用例随 #293，R1 与 T17、G1 一样在只合并 #292 时存活；代码 800。

## Bottom Change Note

- Change Note (2026-10-08 CST，定稿评审者)：初稿。为什么写：#221 需要一份 ExecPlan 与 ADR，PR-D 依赖它的接口。写了什么：裁决三份设计的分歧，收录 K1–K8 与 K3 补充；用原型实测给出文件、行数、红用例与变异表。
- Change Note (2026-10-08 CST，实现者)：按计划实施 C1、C2，并完成 C3 的文档回填、债务行与变异。为什么写：把每批的红、绿、变异与规模记进 `Progress`，让独立验证者与协调者可以复查。写了什么：S9–S11 与 Decision Log 第 15、16 行（补三条用例的理由，矩阵反向升级的证据），Outcomes 的实现者部分；计划的算法、接口与文件集合没有改。
- Change Note (2026-10-08 02:24 CST，实现者)：处理对抗验证对 `3aef993` 的发现（批次 C4）。为什么写：验证者复现了 1 个 P1（共享头提交时 CI 跳挂错上下文）、5 个 P2 与 4 条 P3，全部属实。写了什么：Design 里集合的 `anchorId`、严格递增的读取开始时刻、读取阶段的 `try`、头部提交未知的缺口与读路径的读取顺序；I6 的扩写与 I8、I9；两条被放弃的方案；S12–S18；Decision Log 第 17（协调者行归位）与 18–25 行；N1–N15 变异；TD-009 回 Open 的收窄，`vertical-path.md`、ADR-0011 与索引行的订正。
- Change Note (2026-10-08 05:30 CST，实现者)：处理第二轮对抗验证对 `ed554d0` 的发现（批次 C5）。为什么写：验证者复现了令牌在墙钟与对象之外失效、被放弃的刷新逐跳不可见、路由失败分支与十余条变异没有用例等问题，全部属实。写了什么：Design 里令牌与守卫（取自已提交快照）、过渡期查询的逐跳标陈旧、`anchored` 的含义；I6；两条被放弃方案的订正；S19–S24；Decision Log 第 26–30 行与第 3、19、24、25 行的订正；64 条变异的整表与 X9–X12 的定义；估算表改成实测；C0 复选框与 Progress 的顺序；K2、K3 行的收窄。
- Change Note (2026-10-08 06:45 CST，验收者)：最终验收与重构（批次 C6）。为什么写：第三轮对抗验证在 `0bf8b70` 上复现了没有锚点的刷新把旧快照当新鲜显示，以及三条契约级守卫与若干拓扑断言没有判别力；验收还发现矩阵回读的前缀被新用例撞上。写了什么：读路径与查询一节的 `unconfirmed` 判定、`applied` 的含义；I2、I4、I6、I8；S25–S28；Decision Log 第 31–33 行与第 15 行的补记；变异表的 C6 复测与 12 条新增；估算表改成 C6 的实测；A10、A11；C3 第 6 步的订正；C6 Progress 与 Outcomes 的验收者部分。
- Change Note (2026-10-08 10:05 CST，规模收敛者)：批次 C7。为什么改：C6 之后代码 990，超过人类伙伴的规划上限 800。改了什么：状态行；文件所有权与行数估算改成 C6、C7 两列；I3、I4、I6、I7、I9，A3、A5、A6、A10、A11；变异表第三列与说明；C2 第 1 步、Decision Log 第 6、12、25、28 行、C5 表与 Outcomes 里 TD 号的订正；C7 Progress、S29–S31、Decision Log 第 34–38 行、规模收敛者的 Outcomes；拟新增的技术债行加 TD-050、TD-051；K6 行；PR-D 接口里 `ingest` 的说明。
- Change Note (2026-10-08 11:19 CST，修复者)：批次 C8。为什么改：第四轮对抗验证通过，但有 6 条 P3 和一处 ADR 措辞与代码不一致，需要记下处置。改了什么：状态行；变异表 N2、N3 的变红条数写成区间；C8 Progress、Decision Log 第 39 行、Outcomes 的第四轮部分；ADR-0011 第 3 条 `attemptedAt` 的定义。
- Change Note (2026-10-08 19:40 CST，rebase 适配者)：批次 C9。为什么改：main 已合并 #295 / #289（#232），本 PR 按 K4 作为后合并者适配新的 Delivery 读取。改了什么：状态行；相邻工作表、裁决总览、chain-facts 一节、被放弃方案与 K3、K4、#289 接口条目里「将被 #289 取代」的结论就地标注为已由 #295 取代；A3、A10、A11 与变异表 M7、X8（新增 X8r）；C9 Progress、S32、S33、Decision Log 第 40–43 行、Outcomes 的 C9 部分；拟新增技术债行 TD-040、TD-043 的就地标注（tracker 的两行同步收窄或订正）。
- Change Note (2026-10-08 21:40 CST，修复者)：批次 C10。为什么改：rebase 之后的独立对抗验证可接受，但留下四条 P3；人类伙伴又两次裁决了 K3 接线的落点。改了什么：状态行；A11；C0 的 lint 命令；chain-facts 一节的 `settled` 谓词表；相邻工作表、S21、S33、Decision Log 第 41、43 行与 K3 行的就地订正；C3、C9 Progress 的订正与 C10 Progress；S34；Decision Log 第 44–47 行；变异表的新增行；Outcomes 的遗留条、C7 与 C9 部分的订正与 C10 部分。
- Change Note (2026-10-09 00:06 CST，修复者)：批次 C11。为什么改：#292 第一轮 MMP 评审的 1 条 P2 与 6 条 P3，以及人类伙伴对 P2 落点的裁决。改了什么：状态行；相邻工作表、`settled` 谓词表、函数签名、K2 行与 #287 接口条目的订正；A3、A10、A11 与变异表 H1、H2、B2、T11、T17；C11 Progress、S35、Decision Log 第 48–52 行、技术债行的订正说明与 Outcomes 的修复轮部分。
- Change Note (2026-10-09 01:35 CST，修复者)：批次 C12。为什么改：#292 复评轮的 3 条 P3 与 #293 复评轮里归属本层的迁移列注释，全部属实。改了什么：状态行；`settled` 谓词表；变异表 H5、G1、R1；C12 Progress、Decision Log 第 53、54 行与 Outcomes 的复评轮部分。
