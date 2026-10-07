# 交付事实的唯一写者与最后确认快照 ExecPlan

> 状态：Active。设计已定稿（定稿评审者，2026-10-08），产品批次尚未实施。
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
| PR-B #291 | #219 | Development 按仓库路由 |
| PR #289 | #232 | GitHub Actions 读取、Delivery 完整分页与 `factFor(status, conclusion)` |
| #287 | #279 | 变更请求带 `headBranch` |

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
| 截断 | 写者自己翻页 | 守卫 | 写者翻页 | **`gated` 里一个守卫**；Delivery 部分由 #289 取代（K4） |
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
      readonly ok: boolean          // 提交失败为 false
      readonly anchored: boolean    // 有已观察的执行上下文与工作树；没有时什么也不写
      readonly applied: boolean     // 本次读取被提交；更晚的读取已提交时为 false（乱序守卫）
      readonly gaps: readonly CapabilityGap[]
      readonly error: ProjectError | undefined
    }
    export async function refreshDeliveryFacts(context: CoreContext, scope: DeliveryScopeInput): Promise<DeliveryRefreshResult>

算法分六步，顺序固定：

1. `attemptedAt = context.clock()`。
2. 在事务外调用 `readChainFacts(context, scope)`，这是唯一一次 provider 读取。
3. 若 `!facts.context.observed || !facts.worktree.observed`，返回 `anchored: false, applied: false, ok: true`，不写任何东西。
4. 用 `completeSets(facts)` 算出完整集合，规则见下表。它只消费 `facts.gaps` 的能力键与节点的 `observed`（契约 K4）。
5. 在**一个** `context.storage.transaction` 里依次做：
   1. `existing = await tx.getDeliveryFacts(ws, contextId)`；若 `existing.attemptedAt` 晚于 `attemptedAt`（按 `Date.parse` 比较），返回 `applied: false`。
   2. 对每个完整集合里已观察的节点：先 `tx.putEntity({ id, kind })`，再用 `recordEdges({ workspaceId, storage: tx }, edges)` 写候选边。边的规则：提交 → 工作树 `derived_from`，变更请求 → 工作树 `produced_by`，流水线 → 提交 `runs_on`，检查 → 变更请求 `runs_on`，provenance 都是 `ProviderRead`。
   3. `tx.putDeliveryFacts({ workspaceId, contextId, attemptedAt, sets })`。四个集合按固定顺序写：完整的集合是 `{ kind, confirmedAt: attemptedAt, stale: false, nodes }`；不完整的集合是 `{ ...(旧集合 ?? { kind, confirmedAt: undefined, nodes: [] }), stale: true }`。
6. 事务抛错时，先用第二个事务尽力处理：读回旧行；如果它不比本次晚，就整行写回，全部集合标 `stale: true`，`attemptedAt` 前移。这一步若也失败，吞掉异常。然后返回 `ok: false, error: projectError(ProjectErrorCode.Unavailable, '交付事实未能提交；已确认的事实保持不变')`。不转发异常原文（K2）。

不调用 `advanceRevision`（K1），不写任何游标（K5），不写 `reconcile_cursor`。

完整性规则（`completeSets`）：

| 集合 | 完整的条件 | 不完整时 |
|---|---|---|
| `commit` | `gaps` 里没有 `DevelopmentRepositoryRead` | 全部四个集合都不完整（锚点未读到） |
| `change_request` | 提交集合完整，且（没有 head，或者 `gaps` 里没有 `DevelopmentChangeRequestRead`） | 保留并标 stale；检查也不完整 |
| `pipeline_run` | 提交集合完整，且（没有 head，或者 `gaps` 里没有 `DeliveryPipelineRead`） | 保留并标 stale |
| `check_run` | 变更请求集合完整，且（没有变更请求，或者 `gaps` 里没有 `DeliveryCheckRead`） | 保留并标 stale |

「没有 head」只有一种来源：分支列表被完整读到，而且其中确实没有这个分支。这时提交集合是完整的空集合，下游三个集合也都是完整的空集合，事实被删除。这是 H2 的默认裁决。

### chain-facts 改动

文件是 `packages/core/src/chain-facts.ts`，只动三处：

1. **路由缝（K3）**：删掉 `resolveRepository`，换成模块私有的路由缝，`readChainFacts` 与 `readChangeRequest` 都只用它返回的 `repository` 去调 provider：

        type ReadRoute = { readonly ok: true; readonly binding: ResolvedBinding; readonly repository?: ExternalObjectRef } | { readonly ok: false; readonly error: ProjectError | undefined }
        async function developmentReadBinding(context: CoreContext, key: CapabilityKey, repositoryId: string): Promise<ReadRoute>
        // 今天的函数体：gateCommand(context.registry, key, 'read')；成功时 repository = refFor(gate.binding, 'repository', repositoryId)

   Delivery 两处读取用 `deliveryRead(context, key): ReadRoute`，这个函数不带 `repository`。

2. **截断守卫（K4）**：`gated(route, key, run, settled)` 接收路由结论，并多一个 `settled(page)` 谓词。provider 成功但 `settled` 为假时，返回 `{ value: undefined, gap: { key, reason: '分页未读完' } }`。各处读取的谓词：

   | 读取 | `settled` 谓词 |
   |---|---|
   | 流水线、检查 | 默认的 `page.nextCursor === undefined`（#289 用完整分页取代） |
   | 分支查找 | `page.nextCursor === undefined \|\| page.items.some((item) => item.name === branch)` |
   | 变更请求查找 | `page.nextCursor === undefined \|\| page.items.some((item) => item.sourceVersion === head)` |

   两类查找找到即完整。

3. **函数签名**：`readHeadCommit(route, branch, gaps)`、`readChangeRequest(context, repositoryId, head, gaps)`。`commitNode` 与 `changeRequestNode` 继续用路由缝给的 `repository?.bindingId` 构造身份槽位，与今天相同。

`readChainFacts` 的返回形状不变：`tests/integration/provider-binding-registration.test.js` 直接调用它，PR #289 也在改它的内部。

### 读路径与查询

`packages/core/src/delivery.ts`：

- 删掉 `provenanceFor`、`chainEdges`、`gapKeysFor`、`toHop`，以及对 `readChainFacts` 和 `recordEdges` 的调用。全仓只有本文件使用它们（已 `git grep` 核对）。
- `DeliveryLineageHop` 加 `readonly stale: boolean`。
- 新增导出 `readDeliveryProjection(context, scope: DeliveryScopeInput)`。它只读本地数据，不调 provider，不写任何东西：
  1. `contextId = contextIdFor(...)`；`record = storage.getExecutionContext(contextId)`；`relations = storage.listRelations(ws)`；`snapshot = record ? storage.getDeliveryFacts(ws, contextId) : undefined`；`worktreeId = worktreeEntityId(ws, record?.repositoryId ?? scope.repositoryId ?? '', scope.workItemId)`。
  2. 有 `record` 时：
     - `tracks` 跳 = `type === tracks && to === asEntityId(contextId)` 的关系，节点外部 id 为 `contextId`；
     - `has_worktree` 跳 = `type === has_worktree && from === contextId && to === worktreeId` 的关系，外部 id 是 `record.worktreeExternalId`，label 是 `record.branchExternalId`。

     两者的 provenance 都是 `Command`，`stale: false`。
  3. 按 `commit`、`change_request`、`pipeline_run`、`check_run` 的顺序，遍历快照的每个集合与每个节点，找关系 `from === node.entityId && type === 该集合的边类型`。`derived_from` 与 `produced_by` 另要求 `to === worktreeId`。跳的 `stale` 取集合的 `stale`，provenance 为 `ProviderRead`，`observed: true`，`detail: undefined`。`unavailable` 只对流水线与检查按本地 registry 的 `gateCommand(..., 'read').allowed` 判定。找不到关系的节点跳过。
  4. `degraded = snapshot?.sets.some((set) => set.stale) ?? false`。
- `getDeliveryProjection` 在 #221 的过渡形态：保留 `workItemId` 为空时的 `invalid_input` 分支，然后：

        const refreshed = await refreshDeliveryFacts(context, normalized)   // #222 删除这一行
        const projection = await readDeliveryProjection(context, normalized)
        return { ...projection, degraded: projection.degraded || !refreshed.ok || refreshed.gaps.length > 0 }

不改 `queries.ts`、`context.ts`、`bootstrap.ts`。`getDeliveryLineage` 仍是 `getDeliveryProjection(...).hops`。

### 不变量

| # | 不变量 | 守护用例 |
|---|---|---|
| I1 | 交付事实只有一个写入调用点，在 `delivery-facts.ts`；谱系边只由开始工作与该写者记录 | 「唯一写者」的静态部分 |
| I2 | 一次刷新只开一个事务，事务外没有关系、实体或交付事实写入 | 「唯一写者」的行为部分 |
| I3 | 不完整读取不删除、不增补、不改写已确认事实 | 「失败不清空」「提交失败」 |
| I4 | 交付写者不推进修订号、不改规划状态 | 「重复刷新收敛」 |
| I5 | 交付写者不写 tracks / has_worktree | 「谱系写者不写命令边」 |
| I6 | 更旧的读取不覆盖更新的提交 | 「乱序」 |
| I7 | 关系端点必须是已登记实体，两个 Storage 同语义 | 契约「关系端点必须是已登记实体」 |

### 被放弃的方案

| 方案 | 来源 | 放弃原因 |
|---|---|---|
| 复用 `sync_cursor` 存新鲜度 | α、β | 游标按单个 binding 定位，而一份快照由 Development 与 Delivery 两条连接拼成；没有 Delivery 绑定时记不了「从未读到」；触发 TD-021（K5）；`cursor_value` 审计口径是「provider 游标值」 |
| 关系形状：每实体一行，或每（种类，binding，外部 id）一行 | α、β | 验收不需要跨上下文查询。替身与 SQLite 要多出按种类替换、实体外键、种类连接三种可分叉的语义，原型估算实现再多约 60 行。Gate E1 前不冻结细粒度模型（`AGENTS.md` §1.2）。代价见 TD-041 |
| JSON 快照里存 digest、`observed_at` | γ | digest 只为「变化才推进修订号」服务，K1 已否定；`observed_at` 被 `attempted_at` 加集合级 `confirmedAt` 取代 |
| 截断集合部分增补 | γ | 要求按节点算陈旧；截断由 #289 的完整分页消除 |
| 写者自己翻页 | α、γ | K4 把 Delivery 分页归 #289。在 Development 一侧翻页属于另一个 owner（TD-040） |
| 乱序守卫留给 PR-D | α、γ | 本 PR 的查询会触发刷新，并发查询就是并发写者；没有守卫，本 PR 自己就会引入「较旧读取覆盖较新事实」 |
| 写者也写 tracks / has_worktree | α、γ | 会延续 TD-009（读路径把半提交「修复」成命令边），也会让 TD-014 的触发条件成立 |
| 「`confirmedAt !== attemptedAt` 即陈旧」 | γ | 原型实测：毫秒时钟下，连续两次刷新拿到同一时刻，陈旧丢失（S4） |
| 交付变化推进修订号 | α、γ | K1 |
| 存原样 `status` / `conclusion` | β | 要改 `chain-facts` 的读出形状，与 #289 冲突；TD-043 |
| 按 D3 预设切缝拆成「存储层 PR + core 写者 PR」 | 规划 D3 | 只在超过 800 行时启用；原型约 670 行（见下节），不触发 |

### 文件所有权与行数估算

一个实现者拥有全部产品与测试文件，不并行；对抗验证者只读不写。下表是原型实测的增删行数，用 `diff -U0` 计数，观察时刻 2026-10-08，按 `node scripts/rule-checks.mjs size` 的口径，即 `docs/` 与 `.md` 以外都算代码：

| 文件 | 行数 |
|---|---|
| `packages/core/src/delivery.ts` | 111 |
| `packages/core/src/delivery-facts.ts`（新） | 87 |
| `packages/core/src/chain-facts.ts` | 78 |
| `packages/capabilities/src/storage.ts` | 34 |
| `packages/providers/fake/src/storage.ts` | 17 |
| `packages/storage/sqlite/src/storage-execution.ts` | 16 |
| `packages/storage/sqlite/src/storage-rows.ts` | 16 |
| `packages/storage/sqlite/migrations/006_delivery_facts.sql`（新） | 10 |
| `packages/capabilities/src/registry.ts`、`packages/storage/sqlite/src/migrations.ts`、`packages/core/src/index.ts` | 4 |
| **实现小计** | **约 373** |
| `tests/e2e/delivery-lineage.test.js` | 190 |
| `tests/contract/suites/storage-execution.js` | 57 |
| `tests/integration/execution-relation-write-schema.test.js` | 20 |
| `tests/contract/storage-contract.test.js` | 14 |
| `tests/integration/storage-source-version-upgrade.test.js` | 8 |
| `tests/integration/start-work-retry-identity.test.js` | 6 |
| `tests/contract/suites/storage.js` | 2 |
| **测试小计** | **约 297** |
| **代码合计** | **约 670**，不超过 800 |

实现约 373 行，比 K8 的「约 350」多 23 行。多出的部分来自 K3 补充要求的路由缝形状（`chain-facts.ts` 从 52 行增到 78 行）。`delivery.ts` 的 111 行里约 45 行是删除。

文档：

| 文件 | 行数 |
|---|---|
| 本计划 | 约 730 |
| ADR | 约 90 |
| 两份索引 | 3 |
| `vertical-path.md` | 约 10 |
| 控制计划的原地标注 | 约 8 |
| tracker 的五行与两次移动 | 约 12 |
| **合计** | **约 860**，不超过 1300 |

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
| 文档 | 本计划、`docs/adr/ADR-0011-delivery-facts-last-confirmed-snapshot.md`（新）、`docs/adr/README.md`、`docs/README.md`、`docs/product/vertical-path.md`（§2.1 第 10、13 行与 13.5）、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`（第 172、228 行与 P3 的原地标注、Progress 一行）、`docs/exec-plan/tech-debt-tracker.md`（TD-040–TD-044 新增；TD-009、TD-014 移动） |

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

### Batch C0 · 计划与 ADR（定稿评审者已写入，未提交）

**最小闭环**：裁决、契约与测试计划进入仓库，可以独立评审。
**涉及文件**：本计划、ADR-0011、`docs/adr/README.md`、`docs/README.md`。

- [ ] 协调者用一个 `docs(exec-plan)` 提交它们，正文说明原因，尾注 `Refs #221`，不写关闭关键字。然后推送并开 draft PR，正文尾注写关闭 #221。
- [ ] PR-D 把自己的分支 rebase 到这个提交上。

**验证**：

    python3 ~/.claude/skills/exec-plan/scripts/lint_execplan.py docs/exec-plan/active/2026-10-08-delivery-fact-writer.md
    grep -c '^## ' docs/exec-plan/active/2026-10-08-delivery-fact-writer.md
    node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js
    git diff --check origin/main...HEAD

期望：lint 输出 `OK`，或者只有与 `PLANS.md` 冲突的通用告警；`grep` 输出 `13`；测试 `ℹ fail 0`；`diff --check` 无输出。

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
   - 既有用例「交付谱系：每一跳」「正向：真实链路走完后 CI 跳出现」「候选关系」「缺可选能力」：在 `startChain` 之后各加一行 `await ingest(core, chain.scope)`。「候选关系」里「重复读取不得产生第二个三元组」之前那次 `getDeliveryLineage`，改成 `await ingest(core, chain.scope)`。在本 PR 里这些改动都不改变行为。
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
   - **第 172 行**：在 `005_delivery_facts` 后追加 `Superseded by docs/exec-plan/active/2026-10-08-delivery-fact-writer.md（2026-10-08）：005 已被 #203 的载体世代占用，交付事实是 006_delivery_facts.sql；本批另增的写入路径见该计划 Global Constraints`。
   - **第 228 行**的 `需要时先加 005_delivery_facts.sql`：同样标注。
   - **P3 观察行**（`# 观察：relations 2 -> 9 | ci online 5 | ci offline 0 | degraded true`）：追加 `Superseded by #221（2026-10-08）：PR-C 之后观察为 ci offline 5`。
   - **Progress** 加一行 3A 的完成记录，带 PR 号与回读命令。
3. `docs/exec-plan/tech-debt-tracker.md`：
   - 按 `Decision Log` 第 12 行，在 Open Items 末尾手工追加 TD-040 至 TD-044，全文见 `Interfaces and Dependencies` 末尾。
   - TD-009 移到 Resolved Items，证据是「谱系写者不写命令边」用例与变异 M9。
   - TD-014 移到 Superseded Items，取代依据是 ADR-0011 第 4 条：谱系写者不再写 tracks / has_worktree，触发条件从结构上不再成立；证据是「唯一写者」的静态断言与变异 M9。
   - TD-007、TD-021 不动，理由见 `Decision Log`。
4. **变异**：在 `git archive HEAD` 导出的临时目录里逐条执行 `Validation and Acceptance` 的变异表。每条变异先打出非空 diff，确认改到的是目标位置（同一文本可能出现多次），再运行指定命令（带 `--test-timeout=20000`），期望 `ℹ fail` 大于等于 1；还原后同一命令为 `ℹ fail 0`。
5. **对抗验证者**（只读）：
   - 在 PR head 上独立重跑 `Validation and Acceptance` 全表与 P3；
   - 尝试至少三种本计划没列出的打破方式，例如同一毫秒的两次刷新、Development 权限被拒、上下文 Failed 后的刷新；
   - 用 P0–P3 分级报告，不写文件。
6. **收口**：
   - 按 `docs/development/publication.md` 做发布面扫描；
   - 运行下面三条命令，期望代码约 670、不超过 800，文档不超过 1300，其余两条退出 0：

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
| A3 | 截断、权限受限或失败的读取从不被记成「确认不存在」（#221 验收 3） | 「失败不清空」的四种故障；「完整空集合才删除」是正控 |
| A4 | #221 的验收命令退出 0（#221 验收 4） | `Purpose` 里的命令输出 `ℹ fail 0` |
| A5 | 关系端点在两个 Storage 上同语义 | 契约「关系端点必须是已登记实体」两个适配器都通过；分叉守卫为 `[1, 1]` |
| A6 | 修订号与规划状态不受交付刷新影响（K1） | 「重复刷新收敛」 |
| A7 | 交付写者不写命令边（TD-009、TD-014） | 「谱系写者不写命令边」 |
| A8 | 006 schema 可审计、没有凭据列 | 「006 显式 schema 审查」 |
| A9 | 全量回归 | 全量 `tests/contract tests/integration tests/e2e` 与 `tests/mvp0` 都是 `ℹ fail 0`；`tsc` 无输出；`pnpm run boundaries` 退出 0 |
| A10 | 守卫有判别力 | 下面的变异表全部被杀死 |
| A11 | 规模 | `node scripts/rule-checks.mjs size origin/main`：代码不超过 800，文档不超过 1300 |

变异表。M1–M14 已在原型上实测，全部被杀死；原型是观察时刻快照，见 `Surprises & Discoveries` 的 Artifacts，C3 要在真实 head 上重做。

| # | 变异 | 应变红的用例 |
|---|---|---|
| M1 | `completeSets` 总是返回四个集合 | 失败不清空、离线保留 ×2、乱序 |
| M2 | 删掉写边前的 `putEntity` 循环 | 离线保留（SQLite）、交付谱系、候选关系等 10 条 |
| M3 | 写者事务里调用 `advanceRevision` | 重复刷新收敛 |
| M4 | 不完整集合写 `stale: false` | 失败不清空、离线保留 ×2 |
| M5 | 替身 `putRelation` 删掉端点检查 | 契约「关系端点必须是已登记实体」（替身） |
| M6 | 替身 `putDeliveryFacts` 按集合合并旧行 | 契约「交付事实整行往返与覆盖」（替身） |
| M7 | `gated` 删掉 `settled` 判断 | 失败不清空（truncated） |
| M8 | 删掉乱序守卫 | 乱序 |
| M9 | 写者额外写 tracks 边 | 谱系写者不写命令边 |
| M10 | 提交失败后不把集合标为陈旧 | 提交失败 |
| M11 | 读路径用 binding 求工作树身份 | start-work-retry-identity 的两条 #165 探针 |
| M12 | SQLite 读回时省略未定义的键 | 契约「交付事实整行往返与覆盖」（SQLite） |
| M13 | 锚点不完整时下游仍算完整 | 失败不清空（development） |
| M14 | 在事务内用根实例写边 | 交付谱系等（以 `--test-timeout` 超时失败） |

## Progress

- [x] (2026-10-08 CST) 定稿评审。核对三份设计与 base 事实（E1–E6）；按 K1–K8 与 K3 补充裁决分歧；在导出副本里实施本计划的原型（不提交），测得 C1 与 C2 全绿、14 条变异全部被杀死、规模约 670 行；写入本计划、ADR-0011 与两份索引行。
- [ ] Batch C0：提交、推送、开 draft PR，回读双向关闭引用。
- [ ] Batch C1：存储层红 → 绿，并记录红的输出。
- [ ] Batch C2：core 红 → 绿，并记录红的输出、P3 新观察。
- [ ] Batch C3：回填、变异、对抗验证、整合与归档。

## Surprises & Discoveries

- **S1 SQLite 上交付视图今天根本读不出来**（E6）。替身接受悬空端点，掩盖了这个外键失败；控制计划此前没有登记。因此 SQLite 必须进入 A1 的用例矩阵。
- **S2 截断与权限被拒都被读成完整**（E3、E4）。改成「完整读取才整组替换」之后，旧行为会把截断变成「确认不存在」，所以截断守卫必须与写者同批落地。
- **S3 迁移 005 已被占用**。`005_source_version_carrier.sql`（#203）是载体世代步骤，控制计划第 172、228 行已过期，改用 006。`tests/integration/storage-source-version-upgrade.test.js` 有**三处**写死了「005 是最后一个迁移」：第 133、171、252 行。设计稿只看到了第 252 行。
- **S4 用时间戳相等推断陈旧会丢标记**。原型第一版按 `confirmedAt !== attemptedAt` 推断陈旧：替身上连续两次刷新拿到同一毫秒，离线、权限、截断、Development 离线四个场景的 `stale` 都读回 `false`，只有 SQLite 那一路因为慢一些而碰巧正确。改成集合上的显式 `stale` 之后，四个场景都正确。
- **S5 替身端点对齐会立刻打红 7 条既有用例**：delivery-lineage 4 条、status-policy 1 条、start-work-retry-identity 1 条、mvp0 节点 6 与 7。原因是旧查询写的是悬空边。所以对齐必须放在 C2，与「写边前登记端点」同批；C1 不对齐。
- **S6 在事务内写根实例会挂起，而不是失败**。变异 M14 让替身的写队列自等，没有 `--test-timeout` 时 `node --test` 一直挂起。所以 e2e 命令一律带超时。
- **S7 #165 的两条探针会悄悄失去判别力**。查询不再写边后，「读一次谱系不得写出第二条关系」恒真，需要补 `hop.to` 断言（C2 第 4 步）。变异 M11 证明补上的断言能杀死身份派生的分叉。
- **S8 契约补充（K3，2026-10-08 01:35）**：路由缝必须返回 `{ binding, repository }`，调用方只用这个引用。原型据此改写之后，`chain-facts.ts` 从 52 行增到 78 行，实现小计因此超过 350。

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
| 3 | 同上 | 写者只写 `derived_from`、`produced_by`、`runs_on` 三类边与端点实体；替身端点对齐。TD-009 关闭，TD-014 被取代 | 第三种解法（写者不写命令边、查询不写任何边）同时满足 TD-009 的两条验收建议：Unknown 之后不写命令边，Failed 上下文仍显示 tracks 跳（tracks 由 `settle` 写，读路径照常读到） |
| 4 | 同上 | 乱序守卫放在本 PR | 本 PR 的查询就是并发写者 |
| 5 | 同上 | 截断守卫放在 `gated` 一处；Development 查找「找到即完整」 | K4 只要求 Delivery。Development 一侧如果不守，新的删除语义会把「分支不在第一页」变成「锚点确认不存在」，进而删掉全部下游事实 |
| 6 | 同上 | 测试统一经 `ingest` 辅助摄入，用例从不把它的返回值当投影 | PR-D 只改一行，所有既有用例自动改走命令路径 |
| 7 | 同上 | 存 core 派生的 `fact` 与 `label`，不存原样 `status` / `conclusion` | 不改 `readChainFacts` 的读出形状，避开与 #289 的冲突；TD-043 |
| 8 | 同上 | 不把交付刷新接进 `bootstrapWorkspace`（H3 的默认值） | `bootstrap.ts` 属于 PR-A；把规划同步与交付读取耦合在一起，会让一方的失败遮住另一方。#222 的「bootstrap 或 refresh 命令」由 PR-D 的刷新命令满足 |
| 9 | 同上 | 写入集合超出控制计划的部分（见 Global Constraints）在本计划登记 | 新写者需要新文件；替身与成员锁是端口的另一半；三处测试是新增表与身份断言的必然改动 |
| 10 | 同上 | 锚点（分支）被完整读到不存在时，删除下游事实（H2 的默认值） | 这符合「只有完整读取才删除」：没有当前 head，就没有「当前 head 上的运行」。历史保留归 #233（`headBranch`，#279） |
| 11 | 同上 | 陈旧集合按记录时的锚点显示，`hop.to` 可能是旧提交（H6 的默认值） | 锚点变化不等于旧运行被确认不存在；TD-042 |
| 12 | 同上 | TD 号段：本 PR 只用 TD-040–TD-044，不预留其它号（K6） | 并行 PR 预分配；合并时回读 tracker 的最大号 |
| 13 | 同上，人类专属 | ADR-0011 写成 Proposed，采纳与否由人类决定（H1） | `docs/adr/README.md` 规定 Proposed 的采纳权在人类伙伴 |
| 14 | 同上 | TD-007 不在本 PR 处理 | 读路径仍然全量 `listRelations`；按端点读关系的端口方法要改成员锁、两个适配器与契约，不服务任何 #221 验收；TD-044 记下二者叠加 |

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
| K2 结构化失败（PR-A，规则正文是 ADR-0012，Proposed，在 PR #290） | 写者从读到提交的任何异常都折成结构化结果，不转发原文。双重故障（降级记录也写不进）时返回诚实的失败，不算裸抛。交付域不写 `reconcile_cursor`（ADR-0012 第 7 条） |
| K3 Development 路由（owner：PR-B #291） | 本 PR 把 `chain-facts.ts` 的 Development 绑定解析收拢到模块私有的 `developmentReadBinding(context, key, repositoryId): Promise<{ ok: true, binding, repository } \| { ok: false, error }>`，调用方只用返回的 `repository` 调 provider。PR-B 的路由是 `routeDevelopment(source: { workspaceId, registry, storage: Pick<Storage,'listRepositories'\|'findExternalIdentity'> }, repositoryId, key, mode)`，位于 `packages/core/src/development-route.ts`，不从 `index.ts` 导出，返回 `{ ok: true, binding, provider, repository } \| { ok: false, error }`。两者都合并后，**后合并的一方**把缝的函数体换成 `routeDevelopment(...)` 并去掉 `provider` 字段（预计不超过 20 行，允许越过文件边界，并在 PR 正文写明），同时补一条「已登记仓库的多 Development 挂载谱系读」正例。在此之前，多挂载工作区的谱系读取退化为缺口，不会读错连接。PR-B 不改 `chain-facts.ts`、`delivery.ts`、`relations.ts`、`queries.ts`、`context.ts`、`bootstrap.ts`。本 PR 的 C3 收口时回读 `git ls-tree origin/main packages/core/src/development-route.ts`：有输出就说明 PR-B 已合并，由本 PR 做这次替换 |
| K4 Delivery 读取内部（owner：PR #289 / #232） | 本 PR 不实现 `collectDeliveryPages`、`factFor(status, conclusion)`、`readChecks` 的新签名与 Delivery 端口的改动。完整性判定只消费 `chain-facts` 产出的缺口。最小截断守卫只放在 `gated` 一处，注明由 #289 取代。冲突由后合并者解决：#289 后合并时删掉 Delivery 两处的 `settled` 谓词，换成它的完整收集 |
| K5 新鲜度落点 | 不写 `PLANNING_SYNC_SCOPE` 游标，不影响 `getPlanningSync()`，不复用 `sync_cursor`（不触发 TD-021） |
| K6 编号 | ADR-0011；迁移 006；TD-040–TD-044；ExecPlan 日期 2026-10-08 |
| K7 共享文件 | `docs/README.md`、tracker、`vertical-path.md` §2.1、控制计划只改本 PR 自己的行；后合并者 rebase 时解决冲突 |
| K8 规模 | 见 Design 的估算 |

### 与相邻工作的接口

- **PR-D（#222，`fix/delivery-query-pure-read`，栈在本 PR 上）**：
  - 以本 PR 合并后的接口为前提：`refreshDeliveryFacts`、`DeliveryRefreshResult`、`readDeliveryProjection`、`DeliveryFactsRecord`、`DeliveryLineageHop.stale`，以及测试里的 `ingest`。
  - PR-D 删掉 `getDeliveryProjection` 里的刷新调用，新增 `CoreCommands.refreshDeliveryFacts` 与 controller 的命令 / 查询，并让「首读纯读」先红。
  - 本 PR 改名或改形任何一项，都必须同步写进 PR-D 的计划。
- **PR-A #290（#199、#220）**：
  - 修订号的共享原语如果先落地，本 PR 不需要它，因为本 PR 不推进修订号。
  - 本 PR 不碰 `bootstrap.ts`、`queries.ts`、`context.ts`，没有文本冲突。
  - `StorageSurface` 那一行如果两边都改，后合并者合并成员列表。
- **PR #289（#232）**：
  - `chain-facts.ts` 的 `readPipelines`、`readChecks`、`gated` 会有文本冲突，按 K4 处理。
  - #289 的集成测试 `tests/integration/github-actions-ci-facts.test.js`（将新建）经 `getDeliveryProjection` 读取，在本 PR 之后仍然可行。#222 之后它必须先调刷新命令，由 PR-D 的计划承接。
- **#287（#279）**：给变更请求加 `headBranch`；本 PR 按 `sourceVersion === head` 查找，不受影响。
- **#233（谱系同步）**：必须扩展本写者的集合，不得另起第二个写者。变更请求实体以后改走身份表时，下一次刷新会改写 `entityId`，不需要迁移。
- **#234（抽屉谱系条）与 #281（交付视图）**：读 `hop.stale`，以及 PR-D 加的 `freshness`、`gaps`。陈旧值不能显示成当前值，要按 `hop.to` 归组（TD-042）。
- **#134（定时刷新）**：调用 PR-D 的命令，需要按工作区列出执行上下文的端口。
- **#223（SQLite 基线）**：把 006 并入单一建库基线。`committed_observation` 仍然没有消费者。
- **#4（Gate E1）**：缓存键只依赖执行上下文 id（ADR-0006 的连接锚点与工作区挂载），节点身份依赖 `chainEntityId` 的工作区哈希。E1 推翻时，由 #223 的基线重写承担。
- **#224（dead code）**：`EdgeProvenance.ChainSkeleton` 在生产代码里不再有生产者，`DeliveryLineageHop.observed` 恒为 `true`、`detail` 恒为 `undefined`。本 PR 不删它们，登记给 #224。

### 拟新增的技术债行（C3 手工追加到 tracker 的 Open Items）

| ID | 日期（本地） | 状态 | ExecPlan | 子系统 | 分支 | 记录者 | 简述 | 延期理由 | 遗留影响 | 下一步 |
|---|---|---|---|---|---|---|---|---|---|---|
| TD-040 | 2026-10-08 | Open | `docs/exec-plan/active/2026-10-08-delivery-fact-writer.md` | 核心（`packages/core/src/chain-facts.ts`） | `feature/delivery-fact-writer` | #221 定稿评审者 | Delivery 两类读取只读第一页（`PAGE_LIMIT = 50`），页带 `nextCursor` 即整组按未知处理：超过 50 条运行或检查的集合，在 #232 完整分页落地前不会再更新，只保留最后确认值并标陈旧；首次读取就截断时没有 CI 跳。Development 的分支与变更请求查找也不翻页，目标不在第一页且有下一页时同样记缺口 | K4 把 Delivery 完整分页归 PR #289（#232），本 PR 只放最小守卫；Development 分页没有 owner，替身与本地 Git 的分支和变更请求远少于 50 条 | 真实大仓库（分支或 PR 超过 50）上谱系会长期陈旧或为空，但不会读错，也不会删除已确认事实 | #289 合并时用它的完整收集取代 Delivery 两处 `settled` 谓词；Development 两处随 #72 / #233 补完整翻页，之后删掉 `settled` 参数 |
| TD-041 | 2026-10-08 | Open | 同上 | 存储（`packages/storage/sqlite/migrations/006_delivery_facts.sql`、`packages/capabilities/src/storage.ts`） | 同上 | 同上 | 交付事实快照是一列 JSON（`sets_json`）：storage 只校验它是 JSON 数组、父行存在，不校验集合种类词表、节点 `entityId` 是否已登记、`confirmedAt` 格式；schema 审计看不到 JSON 内部字段 | 首发前与 Gate E1 前不冻结细粒度模型；唯一写者是 core，没有跨上下文查询；关系形状要多三种可分叉的适配器语义 | 直接调用端口的宿主或测试能写入形状错误的快照，读路径只能按缺字段降级；跨上下文查询（#134、#233）要全表扫描 | #223 合并基线时重审；出现跨上下文查询或第二个读方时，规范化成（上下文，集合，节点）行 |
| TD-042 | 2026-10-08 | Open | 同上 | 核心（`packages/core/src/delivery.ts`） | 同上 | 同上 | 陈旧集合按记录时的锚点显示：head 前移而 Delivery 离线时，旧提交上的流水线仍作为陈旧跳显示，`hop.to` 指向旧提交实体，而提交跳已经是新 head | 只有完整读取才能删除（#221 验收 3），锚点前移不等于旧运行被确认不存在 | 消费方如果按位置、而不是按 `hop.to` 归组，会把旧提交的 CI 挂到新 head 下 | #234 / #281 按 `hop.to` 归组并显示陈旧；或由 #233 决定锚点前移时把旧集合降为历史 |
| TD-043 | 2026-10-08 | Open | 同上 | 核心（`packages/core/src/chain-facts.ts`、`packages/core/src/projection.ts`） | 同上 | 同上 | 快照存的是 core 在确认时派生的 `fact` 与显示用的 `label`，不是平台原样的 `status` / `conclusion`：#289 把 `factFor` 改成 `(status, conclusion)` 之后，已存的行要等下一次完整刷新才会按新映射更新；陈旧的 `ci_passed` 仍会被 `toDeliveryFacts` 折成派生标记 | 改存原样值要改 `readChainFacts` 的读出形状，与 #289 正在重写的读取冲突（K4）；折叠规则属于 #234 的展示 | 映射变更后到下一次刷新之间显示旧的派生值；陈旧的「通过」可能被当成当前的「通过」 | #289 合并后评估改存原样值（JSON 加字段，不需迁移）；#234 规定陈旧跳不进派生标记，或显式标「最后已知」 |
| TD-044 | 2026-10-08 | Open | 同上 | 核心与存储端口（`packages/core/src/relations.ts`、`packages/capabilities/src/storage.ts`） | 同上 | 同上 | 被取代的候选边不删除：head 前移后，旧提交的 `derived_from`、旧运行的 `runs_on` 留在关系表里成为历史；读路径因此每次读取都全量 `listRelations`，与 TD-007 叠加 | 端口没有删除关系的方法；当前集合由快照承载，关系是历史，删除要单独的保留策略 | 关系表随 head 推进单调增长，读的代价线性增长 | 与 TD-007 同批：端口加按端点读关系的方法，或在 #223 基线里给候选边加保留策略 |

## Outcomes & Retrospective

尚未实施。C3 收口时在这里写：实际行数与估算的偏差、变异表的实测结果、对抗验证的发现与处置、遗留给 PR-D / #289 / #233 的事项。

## Bottom Change Note

- Change Note (2026-10-08 CST，定稿评审者)：初稿。为什么写：#221 需要一份 ExecPlan 与 ADR，PR-D 依赖它的接口。写了什么：裁决三份设计的分歧，收录 K1–K8 与 K3 补充；用原型实测给出文件、行数、红用例与变异表。
