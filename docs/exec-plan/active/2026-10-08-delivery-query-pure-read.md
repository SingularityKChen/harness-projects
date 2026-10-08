# 交付查询只读已提交事实 ExecPlan

> 状态：Active。设计已定稿（定稿评审者，2026-10-08），产品批次未实施，**开工前须等 PR-C 的接口落地并重新锁定**。
> 创建：2026-10-08 CST。规范：`PLANS.md`。
> 关联：issue #222，由 PR 正文尾注关闭；epic #216 Batch 3B；前置是 #221。
> 执行上下文：检出 `fix/delivery-query-pure-read` 的工作树根目录（`.worktrees/delivery-query-pure-read`）。
> 栈结构：本 PR 栈在 PR-C（`feature/delivery-fact-writer`，#221）上，栈深 2；PR-C 合并后，base 改为 `origin/main`。写入本计划时，分支与 PR-C 都在 `origin/main@6417d45`；2026-10-08 本分支已快进到 PR-C 的规划提交 `b7c8fb3`（draft PR #292），本计划的规划提交在它之上。
> 上游输入：
> - PR-C 的计划 `2026-10-08-delivery-fact-writer.md`（合并前在 `docs/exec-plan/active/`，合并后在 `docs/exec-plan/completed/`）；
> - `docs/adr/ADR-0011-delivery-facts-last-confirmed-snapshot.md`（Proposed，随 PR-C 落地）；
> - 控制计划 `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` Batch 3B；
> - 协调者的跨 PR 契约 K1–K8（本地运行态输入，不随仓库分发，结论在本文重述）。

## Purpose / Big Picture

完成后，`queries.getDeliveryProjection` 与 `queries.getDeliveryLineage` 只读已提交的事实：不调用任何 provider，不写关系、实体或交付事实，不推进修订号。

交付事实只经显式命令 `commands.refreshDeliveryFacts(scope)` 摄入，controller 有同名命令。交付投影带三类元数据，controller 的查询原样转发：

- `stale`：逐跳；
- `degraded`；
- `freshness`：逐集合；
- `gaps`：逐位置。

缺失的谱系节点只显示为缺口，从不落成关系；节点出现后由同一个确定性身份落**一条**关系。

最小成功证据，在检出本分支的工作树根目录运行：

- 「纯读」两条用例在 PR-C 的 head 上先红，修复后转绿。
- issue #222 的验收命令退出 0：

        node --test --test-timeout=120000 tests/integration tests/e2e
        pnpm run boundaries

- 下文的 P3′ 命令输出 `read relations 2 -> 2 | refresh relations -> 9 | ci online 5 | ci offline 5 | stale true | degraded true`。

## Context and Orientation

### 术语

术语沿用 PR-C 的计划：执行上下文、锚点、集合、完整读取、陈旧、唯一写者、`ingest` 辅助。本计划新增两个：

| 术语 | 含义 |
|---|---|
| 缺口（gap） | 链上某个位置当前没有跳，带一个原因码；读时由本地事实算出，不落库，也不进关系表 |
| 摄入 | 调 provider 并把结果交给唯一写者提交；本 PR 之后只有刷新命令做这件事 |

### PR-C 合并后的世界（前提，D0 要重新锁定）

本 PR 以 PR-C 合入后的接口为前提，开工时重新锁定。下表是 PR-C 计划里的接口；若实际合入的形状不同，先改本计划再动代码。

| 接口 | 位置 | 本 PR 怎么用 |
|---|---|---|
| `refreshDeliveryFacts(context, scope): Promise<DeliveryRefreshResult>`，结果 `{ ok, anchored, applied, gaps, error }` | `packages/core/src/delivery-facts.ts`，从 `index.ts` 导出 | 刷新命令直接调用 |
| `readDeliveryProjection(context, scope): Promise<DeliveryProjection>`：只读，不调 provider | `packages/core/src/delivery.ts` | 查询改成只调它 |
| `getDeliveryProjection` 的过渡形态：先 `refreshDeliveryFacts`，再 `readDeliveryProjection`，`degraded` 并上刷新的缺口 | 同上 | 删掉刷新那一行 |
| `DeliveryFactsRecord`：`{ attemptedAt, sets: [{ kind, confirmedAt, stale, nodes }] }` | `packages/capabilities/src/storage.ts` | 算 `freshness` 与 `gaps` |
| `DeliveryLineageHop.stale` | `packages/core/src/delivery.ts` | 原样保留 |
| 测试辅助 `const ingest = (core, scope) => core.queries.getDeliveryProjection(scope)`；所有用例都不把 `ingest` 的返回值当投影 | `tests/e2e/delivery-lineage.test.js` | 只改这一行 |

PR-C 留给本 PR 的事实：

- 查询仍然触发刷新，首读会把关系从 2 写到 9。PR-C 原型实测，P3 原命令输出 `relations 2 -> 9 | ci online 5 | ci offline 5 | degraded true`。
- PR-C 的写者已经承担了 #222 验收 2 的机制：乱序守卫、只有完整空集合才删除、重复刷新收敛。对应的用例在 PR-C 里经查询路径通过，本 PR 把 `ingest` 换成命令后，它们改走命令路径。
- 下列既有测试**直接**用查询读出新观察，本 PR 必须先调刷新命令：
  - `tests/e2e/status-policy.test.js` 的「交付谱系里的 CI 失败只进 derived 块」（读谱系前先往替身里加失败运行）；
  - `tests/mvp0/chain.test.js` 的节点 6、节点 7。
- `tests/integration/start-work-retry-identity.test.js` 的两条 #165 探针经 PR-C 补了 `hop.to` 断言。它们只依赖开始工作写的 `has_worktree`，纯读后仍然成立，不需要改。
- controller（`packages/controller/src/queries.ts`）今天只转发 `getDeliveryLineage`，也就是跳；没有 `getDeliveryProjection`，也没有刷新命令。

#222 的验收：

1. 首次读交付视图前后，关系与修订号相同（修复前失败）。
2. 重复与乱序的交付观察收敛，只有完整的空集合才删除事实。
3. 缺失的谱系节点显示为缺口，从不被重新识别成第二条关系。
4. `node --test tests/integration tests/e2e` 与 `pnpm run boundaries` 退出 0。

## Design / Spec

### 查询纯读

`packages/core/src/delivery.ts`：

- `getDeliveryProjection` 保留 `workItemId` 为空时返回 `invalid_input` 的分支（新增的三个字段填 `undefined` / `[]` / `[]`），其余情况只 `return readDeliveryProjection(context, normalized)`。
- 删掉对 `refreshDeliveryFacts` 的 import 与调用。
- `packages/core/src/queries.ts` 的注释从「只读，不触发任何外部写入」改成「纯读已提交事实，不调 provider、不写任何东西（#222）」。

### 投影的新字段

    /** 一个集合的新鲜度：最后一次完整确认的时刻，与「最近一次刷新没能重新确认」。 */
    export interface DeliveryFreshness { readonly kind: DeliveryFactSetKind; readonly confirmedAt: string | undefined; readonly stale: boolean }
    export const DeliveryGapReason = { NotStarted: 'not_started', NotObserved: 'not_observed', NotRefreshed: 'not_refreshed', Unconfirmed: 'unconfirmed' } as const
    export type DeliveryGapReason = (typeof DeliveryGapReason)[keyof typeof DeliveryGapReason]
    export interface DeliveryGap { readonly entityKind: EntityKind; readonly reason: DeliveryGapReason }
    // DeliveryProjection 新增：
    readonly attemptedAt: string | undefined          // 快照的 attemptedAt；从未刷新时 undefined
    readonly freshness: readonly DeliveryFreshness[]   // 快照四个集合的投影；从未刷新时 []
    readonly gaps: readonly DeliveryGap[]

`readDeliveryProjection` 在算完跳之后，按链的六个位置依次判断，没有对应跳的位置记一个缺口：

| 位置 | 缺口原因 |
|---|---|
| `execution_context`、`worktree` | 上下文记录不存在时为 `not_started`；记录存在但关系不在时为 `not_observed`（例如开始工作的最终事务失败，见 TD-009） |
| `commit`、`change_request`、`pipeline_run`、`check_run` | 上下文记录不存在时为 `not_started`；没有快照时为 `not_refreshed`；集合的 `confirmedAt` 为 `undefined` 时为 `unconfirmed`；否则为 `not_observed`，即集合被完整确认且为空 |

`degraded` 改为：`record !== undefined && (snapshot === undefined || snapshot.sets.some((set) => set.stale))`。意思是：已开始工作，但从未刷新或有集合陈旧，就算降级；没有上下文时不算降级，这时只有 `not_started` 缺口。

缺口不落库，也不进关系表。节点出现后，它的关系由唯一写者按 `chainEntityId` 的确定性身份写一次，不变量 6 不受影响。

### 刷新命令

- **core**（`packages/core/src/context.ts`）：
  - `CoreCommands` 加 `refreshDeliveryFacts(scope: DeliveryScope): Promise<DeliveryRefreshResult>`；
  - `composeCore` 绑定 `(scope) => refreshDeliveryFacts(context, normalizeScope(scope))`；
  - `unavailableCore` 返回 `{ ok: false, anchored: false, applied: false, gaps: [], error }`；
  - `unavailableCore.queries.getDeliveryProjection` 补上新增的三个字段。
- **写者**（`packages/core/src/delivery-facts.ts`）：函数开头加一行守卫。`scope.workItemId.trim() === ''` 时返回 `{ ok: false, anchored: false, applied: false, gaps: [], error: projectError(ProjectErrorCode.InvalidInput, 'workItemId 不能为空') }`。原因：查询不再先挡空输入，命令直接调写者。
- **controller**（`packages/controller/src/commands.ts`）：
  - `ControllerCommands` 加 `refreshDeliveryFacts(scope: DeliveryScope, envelope: CommandEnvelope): Promise<CommandResult<DeliveryRefreshResult>>`；
  - 实现走实例内的重放账本：`replay('refreshDeliveryFacts', envelope, ...)`，结果 `ok` 为真报 `local_only`（只写本地已确认事实，没有外部写入，不是权威确认），否则报 `failed`。
- **controller 查询**（`packages/controller/src/queries.ts`）：`ControllerQueries` 加 `getDeliveryProjection(scope): Promise<DeliveryProjection>`，原样转发 `core.queries.getDeliveryProjection(scope)`。

不接进 `bootstrapWorkspace`，见 `Decision Log` 第 1 行。

### 收敛与删除（#222 验收 2）

机制都在 PR-C 的写者里：

- 乱序：已提交快照的 `attemptedAt` 更晚时整次放弃；
- 重复：节点与关系不变，修订号不推进；
- 删除：只有完整的空集合才删除。

本 PR 不改写者。验收证据是 PR-C 的「乱序」「重复刷新收敛」「完整空集合才删除」「失败不清空」四条用例在 `ingest` 换成命令之后仍然通过。

### 被放弃的方案

| 方案 | 放弃原因 |
|---|---|
| 把交付刷新接进 `bootstrapWorkspace` | `bootstrap.ts` 属于 PR-A，而且会把规划同步的失败与交付读取的失败耦合；#222 的「bootstrap 或 refresh 命令」由刷新命令满足；调度归 #134 与 #234（TD-045） |
| 查询在「陈旧」或「从未刷新」时自动刷新 | 查询会重新成为第二个写者，正是 #222 要消除的东西 |
| 保留一个会刷新的查询，另开一个纯读查询 | 同一个读取有两种副作用语义，调用方会选错；#222 要求的是查询本身纯读 |
| 把缺口原因落库 | 原因码要定词表，还要防止 provider 文字进入 wire（K2）；验收只要 stale / degraded（TD-046） |
| 刷新命令报 `confirmed` | 没有外部写入，`confirmed` 是外部写入得到 ack 的语义（`AGENTS.md` §1.1 硬约束）；本地写入按 `bootstrapWorkspace` 的先例报 `local_only` |

### 文件所有权与行数估算

一个实现者拥有全部文件；对抗验证者只读。下表是原型在 PR-C 原型之上实测的增删行数，观察时刻 2026-10-08：

| 文件 | 行数 |
|---|---|
| `packages/core/src/delivery.ts` | 33 |
| `packages/core/src/context.ts` | 9 |
| `packages/controller/src/commands.ts` | 9 |
| `packages/controller/src/queries.ts` | 5 |
| `packages/core/src/queries.ts` | 2 |
| `packages/core/src/delivery-facts.ts` | 2 |
| **实现小计** | **约 60** |
| `tests/e2e/delivery-lineage.test.js` | 约 51 |
| `tests/e2e/controller-roundtrip.test.js` | 22 |
| `tests/mvp0/chain.test.js` | 2 |
| `tests/e2e/status-policy.test.js` | 1 |
| **测试小计** | **约 76** |
| **代码合计** | **约 136**，不超过 800 |

文档：

| 文件 | 行数 |
|---|---|
| 本计划 | 约 480 |
| `vertical-path.md` | 约 8 |
| `tests/mvp0/README.md` | 约 4 |
| 控制计划 | 约 6 |
| tracker 两行 | 约 4 |
| 索引一行 | 1 |
| **合计** | **约 500** |

## Global Constraints

- 保持 `AGENTS.md` §1.1 七条不变量。不改 Project 的 `Status`、`blocked-by` / `blocking`。合并由人类决定。
- 规模：代码不超过 800（CI 硬门 1000），文档不超过 1300（K8）。
- 先红：第一个产品改动之前，「纯读」两条用例必须在 PR-C 的 head 上见红，失败信息记进 `Progress`。红用例的本地提交在整合时并入交付物提交，`main` 上不留红提交，也不用 `skip` / `todo`。
- 不改 PR-C 写者的完整性、乱序与删除规则；需要改，就回到 PR-C 的计划与 ADR-0011。不推进修订号（K1），不写任何游标（K5）。
- 不改 `packages/core/src/chain-facts.ts`（K3、K4 的接缝在那里）、`bootstrap.ts`，也不改任何 provider 或 Storage 端口。
- e2e 命令一律带 `--test-timeout`。不改 git config；提交身份用 `git -c` 单次传入开发账号，推送前核对作者。tracker 手工编辑。
- Node 用本机 `v26.10.0`，pnpm 用 `10.28.2`。不新增依赖。

本 PR 的文件集合（只在此处声明）：

| 区域 | 文件 |
|---|---|
| core | `packages/core/src/delivery.ts`、`packages/core/src/delivery-facts.ts`、`packages/core/src/context.ts`、`packages/core/src/queries.ts` |
| controller | `packages/controller/src/commands.ts`、`packages/controller/src/queries.ts` |
| 测试 | `tests/e2e/delivery-lineage.test.js`、`tests/e2e/controller-roundtrip.test.js`、`tests/e2e/status-policy.test.js`、`tests/mvp0/chain.test.js`。条件文件：若 D0 回读到 `origin/main` 已有 PR #289 的 `tests/integration/github-actions-ci-facts.test.js`，它也算进来 |
| 文档 | 本计划、`docs/README.md`、`docs/product/vertical-path.md`（§2.1 第 10、11 行）、`tests/mvp0/README.md`（节点 6、7 的入口）、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`（P3 的原地标注与 Progress 一行）、`docs/exec-plan/tech-debt-tracker.md`（TD-045、TD-046） |

超出控制计划「唯一计划写入集合」的路径：`delivery-facts.ts`（PR-C 新建）、`controller-roundtrip.test.js`、`status-policy.test.js`。理由见 `Decision Log` 第 6 行。

## Plan of Work

实现者是 Sonnet 子 agent，按 TDD 执行；对抗验证者是另一个 Sonnet 子 agent，只读；验收者是协调者。命令都在检出 `fix/delivery-query-pure-read` 的工作树根目录运行。

### Concrete Steps · 每批开工前与收工时

开工前运行：

    git status --short --branch
    git log --oneline -3
    node --input-type=module -e "console.log(import.meta.resolve('@harness-projects/core'))"

期望：工作区干净；最近的提交里有 PR-C 的 head；解析结果在本工作树的 `packages/core/src/index.ts`。解析结果不对时，运行 `pnpm install --frozen-lockfile --offline`。

收工时运行：

    node_modules/.bin/tsc --noEmit
    node --test --test-timeout=120000 tests/contract tests/integration tests/e2e
    node --test tests/mvp0

期望：`tsc` 无输出，两组测试都是 `ℹ fail 0`。

### Batch D0 · 重锁基线与接口

**最小闭环**：本分支栈在 PR-C 的最新 head 上，PR-C 的接口与本计划 `Context and Orientation` 的表逐项一致。
**涉及文件**：本计划（只在接口不一致时修改）。

1. 把本分支 rebase 到 PR-C 的最新 head（PR-C 已合并时，rebase 到 `origin/main`）。rebase 前建恢复锚点 `git branch backup/delivery-query-pure-read-<短 SHA>`。
2. 用回读命令锁定接口，期望每条都有输出，且签名与本计划一致：

        git grep -n "export async function refreshDeliveryFacts\|export interface DeliveryRefreshResult" -- packages/core/src/delivery-facts.ts
        git grep -n "export async function readDeliveryProjection\|refreshDeliveryFacts(context, normalized)" -- packages/core/src/delivery.ts
        git grep -n "readonly stale: boolean" -- packages/capabilities/src/storage.ts packages/core/src/delivery.ts
        git grep -n "^const ingest = " -- tests/e2e/delivery-lineage.test.js

3. 回读三个相邻 PR 的状态：
   - `git ls-tree origin/main tests/integration/github-actions-ci-facts.test.js`：有输出说明 PR #289 已合并，D2 要把它的每次 `getDeliveryProjection` 读取前补一次刷新命令，并把该文件写进 `Decision Log`。
   - `git log origin/main --oneline -- packages/core/src/context.ts`：PR-A（#290）若改过 `CoreCommands`，按它的形状追加本 PR 的成员。
   - `git ls-tree origin/main packages/core/src/development-route.ts`：PR-B 已合并时，路由缝的替换由 PR-C 或 PR-B 负责（K3），本 PR 不碰。
4. 运行 PR-C 的验收命令，确认基线全绿：

        node --test --test-timeout=60000 tests/e2e/delivery-lineage.test.js tests/contract/storage-contract.test.js tests/integration/execution-relation-write-schema.test.js

**验证**：上面的命令期望 `ℹ fail 0`，再按 `Concrete Steps` 跑全量，期望全绿。接口不一致时，先改本计划，并在 `Bottom Change Note` 记一条。

**回滚**：`git reset --hard backup/delivery-query-pure-read-<短 SHA>`。这一步交给 `git-expert-operations`。

### Batch D1 · 红用例

**最小闭环**：#222 的三条验收各有一条在 PR-C 的 head 上失败的具名用例，失败信息记录在案。
**涉及文件**：`tests/e2e/delivery-lineage.test.js`、`tests/e2e/controller-roundtrip.test.js`。

1. `tests/e2e/delivery-lineage.test.js` 末尾，用 PR-C 的 `STORAGES` 生成两条：`纯读（内存替身）：首次读取交付视图前后关系、交付事实与修订号逐字不变，且不调用 provider（#222）` 与 `纯读（SQLite）：…`。步骤：
   1. 用 `open(providers)` 得到 storage，`compose(providers, { storage })`，`startChain`；
   2. 包装 `providers.development.listBranches`、`listChangeRequests`，以及 `providers.delivery.listPipelineRuns`、`listChecks`，每次调用往 `calls` 里记方法名；
   3. 定义 `state = JSON.stringify([listRelations(ws), currentRevision(ws), getDeliveryFacts(ws, chain.started.executionContextId)])`；
   4. 调一次 `getDeliveryProjection` 和一次 `getDeliveryLineage`；
   5. 断言 `state` 不变（信息：`首读前后关系、修订号与交付事实逐字不变`），并断言 `calls` 为 `[]`（信息：`查询不调用任何 provider 读方法`）。

   在 PR-C 的 head 上，期望失败信息为 `首读前后关系、修订号与交付事实逐字不变`：关系从 2 变成 9，快照从无到有。修订号不变，因为写者从不推进修订号（K1）；所以这条验收是靠关系与快照这两项见红的。
2. 同一文件加 `缺口：未观察到的变更请求显示为缺口，出现后只落一条关系（#222）`。步骤：
   1. `startWork`，不创建变更请求；
   2. 第一次读投影，断言 `gaps` 的原因是四个 `not_refreshed`，`degraded === true`；
   3. `ingest` 后再读，断言 `gaps` 恰为 `[{ entityKind: 'change_request', reason: 'not_observed' }, { entityKind: 'check_run', reason: 'not_observed' }]`；
   4. 断言存储里每条关系的两端都是已登记实体；
   5. 在替身里创建变更请求，`ingest` 两次后读投影：`gaps` 为 `[]`，`produced_by` 关系恰为 1 条，而且它的 `from` 等于 `produced_by` 跳的 `from`。

   在 PR-C 的 head 上，期望失败在第一条 `gaps` 断言（`gaps` 为 `undefined`）。
3. 在 PR-C 的「唯一写者」用例里加一行：

        assert.deepEqual(callers(/\brefreshDeliveryFacts\(context,/), ['core/src/context.ts'], '摄入只经刷新命令，查询不调用写者（#222）')

   在 PR-C 的 head 上，期望失败的 actual 为 `['core/src/delivery.ts']`。这个正则特意要求逗号：它排除了函数定义 `refreshDeliveryFacts(context: CoreContext`，也排除了 controller 的方法签名与 `core.commands.refreshDeliveryFacts(scope)` 这类方法调用。
4. `tests/e2e/controller-roundtrip.test.js` 加 `交付：刷新命令报 local_only，查询原样转发陈旧、降级、新鲜度与缺口（#222）`。步骤：
   1. import 加 `FaultKind`；
   2. `composeCore` 时不带状态策略参数，`createController(core)`；
   3. 从 `baseline()` 里取 `openWorkItem`，经 `controller.commands.startWork` 开始工作，不创建变更请求；
   4. 调 `refreshDeliveryFacts(scope, envelope('delivery-refresh-1'))`，断言 `writeState === 'local_only'`，且 `isAuthoritativeWriteState` 为 `false`；
   5. Delivery 离线后，用新的幂等键再刷新一次；
   6. 读 `controller.queries.getDeliveryProjection(scope)`，断言：`degraded === true`；`freshness` 里有 `pipeline_run` 且 `stale`；流水线跳全部 `stale`；`gaps.map((gap) => gap.entityKind)` 为 `['change_request','check_run']`。

   期望在 PR-C 的 head 上失败：`controller.commands.refreshDeliveryFacts is not a function`。
5. 跑下面的命令，把每条失败的标题与第一条信息写进 `Progress`：

        node --test --test-timeout=20000 tests/e2e/delivery-lineage.test.js tests/e2e/controller-roundtrip.test.js

**验证**：恰有上面几条新断言失败，其余用例全绿。

**回滚**：删掉本批新增的用例。

### Batch D2 · 纯读查询、刷新命令与元数据

**最小闭环**：查询纯读；刷新命令是唯一的摄入入口；投影带 `freshness` 与 `gaps`；controller 转发它们；全部既有用例改走命令后仍然通过。
**主文件**：`packages/core/src/delivery.ts`、`packages/core/src/context.ts`、`packages/controller/src/commands.ts`。

1. 按 `Design / Spec` 的「查询纯读」「投影的新字段」「刷新命令」三节修改实现。
2. `tests/e2e/delivery-lineage.test.js` 只改 `ingest` 一行：

        /** 摄入的唯一调用点：交付事实只经显式刷新命令写入（#222）；查询只读它提交的结果。 */
        const ingest = (core, scope) => core.commands.refreshDeliveryFacts(scope)

3. `tests/e2e/status-policy.test.js` 在 `getDeliveryLineage` 之前加一行刷新：

        await core.commands.refreshDeliveryFacts({ workItemId, repositoryId: REPOSITORY }) // 查询纯读（#222）：交付事实只经刷新命令摄入

4. `tests/mvp0/chain.test.js` 节点 6 在 `lineage(scope)` 之前、节点 7 在 `push` 失败运行之后、`lineage(scope)` 之前，各加一行：

        await needMethod(api, 'commands.refreshDeliveryFacts', '<节点名>', invariant)(scope)

   节点 6 的节点名是 `分支/变更请求`，节点 7 的是 `CI`。文件头要求换 API 名时显式改断言，这一行就是显式改动。
5. D0 回读到 PR #289 的集成测试已合并时，在它每次读投影之前补 `await core.commands.refreshDeliveryFacts(scope)`。

**验证**：

    node --test --test-timeout=120000 tests/integration tests/e2e
    pnpm run boundaries
    node --test tests/mvp0
    node_modules/.bin/tsc --noEmit

期望：前两条是 #222 的验收命令，都以 `ℹ fail 0` 或退出码 0 结束；`tests/mvp0` 7/7；`tsc` 无输出。D1 的红用例全部转绿。

然后运行 P3′，期望输出 `read relations 2 -> 2 | refresh relations -> 9 | ci online 5 | ci offline 5 | stale true | degraded true`：

    node --input-type=module -e "
    import { composeCore } from '@harness-projects/core'
    import { FaultKind, createFakeProviders, refOf } from '@harness-projects/provider-fake'
    const providers = createFakeProviders()
    const api = await composeCore({ workspace: { name: 'probe' }, providers })
    const workItemId = (await api.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item').entityId
    const started = await api.commands.startWork({ workItemId, repositoryId: 'repo-alpha', actor: { kind: 'agent' }, idempotencyKey: 'p3' })
    await providers.development.createChangeRequest({ repository: refOf(providers.development.gate.bindingId, 'repository', 'repo-alpha'), head: started.branchExternalId, base: 'main', title: 'p3', body: 'p3' })
    const scope = { workItemId, repositoryId: 'repo-alpha' }
    const ci = (p) => p.hops.filter((h) => h.entityKind === 'pipeline_run' || h.entityKind === 'check_run')
    const rel = () => providers.storage.data.relations.length
    const r0 = rel(); await api.queries.getDeliveryProjection(scope); const r1 = rel()
    await api.commands.refreshDeliveryFacts(scope); const online = await api.queries.getDeliveryProjection(scope); const r2 = rel()
    providers.delivery.faultsSwitch.set(FaultKind.Offline, true)
    await api.commands.refreshDeliveryFacts(scope); const offline = await api.queries.getDeliveryProjection(scope)
    console.log('read relations', r0, '->', r1, '| refresh relations ->', r2, '| ci online', ci(online).length, '| ci offline', ci(offline).length, '| stale', ci(offline).every((h) => h.stale), '| degraded', offline.degraded)
    "

**回滚**：revert 本批提交。查询回到 PR-C 的过渡形态，命令与新字段随之消失。

### Batch D3 · 文档回填、变异与对抗验证、收口

**最小闭环**：矩阵、P3 与 MVP-0 说明和代码一致；变异表全部被杀死；对抗验证没有未处理的 P0 / P1；计划归档。
**主文件**：`docs/product/vertical-path.md`、`tests/mvp0/README.md`、本计划。

1. `docs/product/vertical-path.md` §2.1。原句保留，用 `Superseded by` 加日期就地标注。
   - **第 10 行**：入口加 `commands.refreshDeliveryFacts`，以及 controller 的 `commands.refreshDeliveryFacts` / `queries.getDeliveryProjection`。结论从 PR-C 写的「部分：controller 不转发投影的 stale / degraded（#222）；TD-002」改为「部分：变更请求由直接调用替身种下（TD-002）」。成功列加 controller-roundtrip 的「交付：刷新命令报 local_only…」。
   - **第 11 行**：失败列加「缺口：未观察到的变更请求显示为缺口…」，说明缺口现在可见。结论从「部分：变更请求跳依赖第 9 行的直接替身调用；读路径写关系（P3 首读关系 2 → 9）」改为「部分：变更请求跳依赖第 9 行的直接替身调用（TD-002）」。
2. 控制计划的 P3 标题行，追加 `Superseded by docs/exec-plan/active/2026-10-08-delivery-query-pure-read.md 的 P3′（2026-10-08）：#222 之后查询纯读，P3 原命令输出 relations 2 -> 2 | ci online 0 | ci offline 0 | degraded true，摄入要先调 commands.refreshDeliveryFacts`。这个输出是 PR-D 原型实测的。Progress 加一行 3B 的完成记录。
3. `tests/mvp0/README.md` 节点 6、7 的入口列改成 `commands.refreshDeliveryFacts` + `queries.getDeliveryLineage`。
4. `docs/exec-plan/tech-debt-tracker.md` 的 Open Items 末尾手工追加 TD-045、TD-046，全文见 `Interfaces and Dependencies` 末尾。
5. 变异：在 `git archive HEAD` 导出的临时目录里逐条执行 `Validation and Acceptance` 的变异表。每条先确认 diff 落在目标位置：`commands.ts` 里 `bootstrapWorkspace` 与刷新命令有同一行 `resultOf(result.ok ? CommandWriteState.LocalOnly …)`，锚点必须带上 `core.commands.refreshDeliveryFacts(scope)`。然后带 `--test-timeout=20000` 运行指定文件，期望 `ℹ fail` 大于等于 1；还原后同一命令 `ℹ fail 0`。
6. 对抗验证者（只读）：在 PR head 上独立重跑 `Validation and Acceptance` 与 P3′；至少再试三种打破方式，例如同一 controller 用同一个幂等键刷新两次、刷新与查询交错、`unavailableCore` 下的查询与命令；用 P0–P3 报告。
7. 收口：
   - 按 `docs/development/publication.md` 做发布面扫描；
   - 运行下面三条命令，期望代码约 136、不超过 800，文档不超过 1300，其余两条退出 0：

         node scripts/rule-checks.mjs size origin/main
         node scripts/rule-checks.mjs disclosure origin/main
         git diff --check origin/main...HEAD

     PR-C 未合并时，`size` 的 base 用 PR-C 的 head。
   - 整合提交：红用例提交并入 `fix(core)` 交付物提交，另有 `docs(exec-plan)` 计划与回填提交；用 `comm` 比对整合前后的文件集合，期望两者相同；
   - 计划移到 `docs/exec-plan/completed/`，更新 `docs/README.md`。

**回滚**：只 revert 文档提交。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| B1 | 首次读取交付视图前后关系与修订号相同，修复前失败（#222 验收 1） | 「纯读（内存替身）」「纯读（SQLite）」在 PR-C 的 head 上红、本 PR 绿；P3′ 的 `read relations 2 -> 2` |
| B2 | 重复与乱序观察收敛，只有完整空集合才删除（#222 验收 2） | PR-C 的「乱序」「重复刷新收敛」「完整空集合才删除」「失败不清空」「提交失败」在 `ingest` 改成命令后仍然通过 |
| B3 | 缺失节点显示为缺口，从不被重新识别成第二条关系（#222 验收 3） | 「缺口：未观察到的变更请求…」 |
| B4 | `node --test tests/integration tests/e2e` 与 `pnpm run boundaries` 退出 0（#222 验收 4） | D2 的验证命令 |
| B5 | 摄入只由刷新命令触发 | 「唯一写者」新增的静态断言；「纯读」的 provider 调用为 `[]` |
| B6 | controller 的查询面转发 stale / degraded / freshness / gaps，刷新报 `local_only` | controller-roundtrip 的新用例 |
| B7 | 全量回归 | 全量与 `tests/mvp0` 都是 `ℹ fail 0`；`tsc` 无输出 |
| B8 | 守卫有判别力 | 下面的变异表全部被杀死 |

变异表。D-M1–D-M6 已在原型上实测，全部被杀死；原型是观察时刻快照，D3 要在真实 head 上重做。

| # | 变异 | 应变红的用例 |
|---|---|---|
| D-M1 | 查询重新调用写者 | 纯读 ×2、唯一写者 |
| D-M2 | controller 查询丢掉 `freshness`、`gaps`、`degraded` | controller-roundtrip 的新用例 |
| D-M3 | `gaps` 恒为 `[]` | 缺口 |
| D-M4 | 刷新命令报 `confirmed`（锚点必须落在刷新命令上） | controller-roundtrip 的新用例 |
| D-M5 | 从未刷新不算降级 | 缺口 |
| D-M6 | 未观察到的变更请求也落成关系 | 缺口、完整空集合才删除 |

## Progress

- [x] (2026-10-08 CST) 定稿评审。在 PR-C 原型之上实施本计划的原型（不提交）：D1 的四处新断言在 PR-C 原型上全红；D2 之后全量测试只剩一条失败，是导出副本缺 `.git` 引起的 CLI 用例，`tests/mvp0` 7/7；D-M1–D-M6 全部被杀死；规模约 136 行。写入本计划与 `docs/README.md` 索引行。
- [ ] Batch D0：PR-C 落地后 rebase、重锁接口、回读相邻 PR。
- [ ] Batch D1：红用例与失败记录。
- [ ] Batch D2：纯读、命令与元数据，P3′。
- [ ] Batch D3：回填、变异、对抗验证、整合与归档。

## Surprises & Discoveries

- **P3 原命令在本 PR 之后失去意义**。PR-D 原型上，它的输出是 `relations 2 -> 2 | ci online 0 | ci offline 0 | degraded true`，因为查询不再摄入。所以 P3 要原地标注，并换成先刷新再读的 P3′。
- **`ingest` 的返回值不能当投影**。PR-C 原型的第一版里，有几条用例写成 `const online = await ingest(...)`。把 `ingest` 换成命令之后，它们全部以 `Cannot read properties of undefined (reading 'filter')` 失败，因为命令返回的是刷新结果。PR-C 的计划因此写明「一律另调查询读投影」，这样本 PR 才能只改一行。
- **刷新命令的变异锚点会落到别的命令上**。`commands.ts` 里，`bootstrapWorkspace` 与刷新命令用的是同一行 `resultOf(result.ok ? CommandWriteState.LocalOnly : CommandWriteState.Failed, result, result.error)`。按第一次出现替换时，变异实际改的是 `bootstrapWorkspace`，于是 D-M4「存活」。锚点带上 `core.commands.refreshDeliveryFacts(scope)` 后，D-M4 被杀死。
- **首读纯读用例靠关系与快照见红，不靠修订号**。在 PR-C 的 head 上首读，修订号也不变，因为写者遵守 K1。#222 验收 1 的「修复前失败」由关系从 2 变成 9、快照从无到有来承担。

### Artifacts and Notes · 原型证据（观察时刻快照，原型未提交）

- 执行上下文：PR-C 原型的导出副本，基于 `origin/main@6417d45`，再叠加本计划的 D1、D2；Node v26.10.0。
- `tests/e2e/delivery-lineage.test.js` 19/19；全量 `tests/contract tests/integration tests/e2e` 1226 条只失败 1 条，是 `issue-policy` 的 CLI 改名用例，依赖 git 检出，导出副本没有 `.git`，在真实工作树上 40/40；`tests/mvp0` 7/7；`package-boundaries` 8/8。
- P3′ 输出 `read relations 2 -> 2 | refresh relations -> 9 | ci online 5 | ci offline 5 | stale true | degraded true`。

## Decision Log

除标注「人类专属」的条目外，各行都按证据决定，可由人类在 PR 评审时推翻。

| # | 日期 / 作者 | 决定 | Rationale |
|---|---|---|---|
| 1 | 2026-10-08 / 定稿评审者 | 摄入只有显式刷新命令，不接进 `bootstrapWorkspace` | 理由见「被放弃的方案」。这一点需要人类确认，是 PR-C 计划里 H3 的同一问题 |
| 2 | 同上 | 缺口原因只有四个：`not_started`、`not_observed`、`not_refreshed`、`unconfirmed`，读时在本地算出 | 足以区分「没开始」「确认为空」「从未刷新」「从未完整读到」；provider 失败的具体原因不落库（TD-046） |
| 3 | 同上 | `degraded` 的定义是：已开始工作，且从未刷新或有集合陈旧 | 纯读之后，「从未刷新」是用户首次打开时最常见的状态，不能显示成完整 |
| 4 | 同上 | controller 的刷新命令报 `local_only`，经实例内重放账本，同键返回原结果 | 没有外部写入；与 `bootstrapWorkspace` 同一先例 |
| 5 | 同上 | 空 `workItemId` 的守卫移进写者 | 查询不再先挡，命令直接调写者 |
| 6 | 同上 | 写入集合超出控制计划的部分在本计划登记 | `controller-roundtrip` 是控制计划要求的「controller 查询面转发」的证据；`status-policy` 的读谱系用例纯读后必须先刷新；`delivery-facts.ts` 是 PR-C 的新文件 |
| 7 | 同上 | 红用例的本地提交整合时并入交付物提交 | `main` 上不留红提交；红的证据记在 `Progress` 与 PR 正文 |
| 8 | 同上 | TD 号段只用 TD-045、TD-046；TD-047–TD-049 不用、不预留 | K6 预分配；合并时回读 tracker 的最大号 |

## Idempotence and Recovery

- 刷新命令可以重复执行：同一输入只前移 `attemptedAt`，关系、节点与修订号都不变（PR-C 的「重复刷新收敛」）。查询可以任意重复，没有任何副作用（「纯读」）。
- 回到已知良好状态：
  - 推送前改写历史：先建 `backup/delivery-query-pure-read-<短 SHA>`。
  - 推送后改写历史：走 `git-expert-operations`，用精确的 `--force-with-lease`。
  - 栈底 PR-C 合并后，GitHub 自动把本 PR 的 base 改成 `main`。改写前用 `git range-diff` 核对本 PR 自己的提交没有变化。
- 回滚：revert `fix(core)` 交付物提交，查询回到 PR-C 的过渡形态（刷新再读）。没有数据迁移，不需要处置本机库。
- 变异与对抗验证只在带任务名与随机后缀的导出目录里做。临时目录可能被并行会话共用，通用目录名会被别的会话覆盖。

## Interfaces and Dependencies

本节列出与本 PR 有关的跨 PR 契约（协调者 2026-10-08 裁定），以及本 PR 与相邻工作的接口。

### 契约

| 契约 | 本 PR 的落点 |
|---|---|
| K1 修订号（owner：PR-A #290） | 查询不写任何事实，也不推进修订号；交付写者从不推进修订号；交付新鲜度由投影自己携带（`freshness`、`stale`），watch 帧不承载交付变化 |
| K2 结构化失败（规则正文是 ADR-0012，Proposed，在 PR #290） | 刷新命令的失败是结构化的 `{ ok: false, error }`，不转发异常原文；交付域不写 `reconcile_cursor` |
| K3 Development 路由（PR-B #291） | 本 PR 不碰 `chain-facts.ts` 的路由缝 `developmentReadBinding`（返回 `{ binding, repository }`）。PR-B 与 PR-C 都合并后，由后合并者换成 `routeDevelopment(source, repositoryId, key, mode)`（`packages/core/src/development-route.ts`，不从 `index.ts` 导出），并补一条已登记仓库的多挂载正例 |
| K4 Delivery 读取（PR #289） | 本 PR 不改 Delivery 读取。PR #289 的集成测试（将新建）经 `getDeliveryProjection` 读取：#289 先合并时，本 PR 的 D2 第 5 步替它补刷新命令；#289 后合并时，由 #289 先调刷新命令，冲突由后合并者解决 |
| K5 新鲜度 | 不写任何游标，不影响 `getPlanningSync()` |
| K6 编号 | TD-045、TD-046；ExecPlan 日期 2026-10-08 |
| K7 共享文件 | `docs/README.md`、tracker、`vertical-path.md` §2.1、控制计划只改本 PR 自己的行。`docs/README.md` 的索引行与 PR-C 的行相邻，rebase 时会冲突，保留两行即可 |
| K8 规模 | 见 Design 的估算 |

### 与相邻工作的接口

- **PR-C（#221）**：本 PR 只消费 PR-C 的接口，不改写者的规则。若 PR-C 在评审中改了接口，D0 必须先同步本计划。
- **PR-A #290**：PR-A 也会改 `packages/core/src/context.ts`（`CoreCommands` 与 `composeCore`），后合并者合并成员列表；本 PR 的成员只有 `refreshDeliveryFacts` 一个。
- **#234（抽屉谱系条）**：打开抽屉与手动刷新时调 `commands.refreshDeliveryFacts`；读 `gaps` 显示缺口，读 `stale` 与 `freshness[].confirmedAt` 显示「最后确认于…」；陈旧跳按 `hop.to` 归组（TD-042）。
- **#281（交付视图）**：同上。
- **#134（定时刷新）**：按工作区批量调刷新命令，需要一个列出执行上下文的端口，本 PR 不提供。
- **#233（谱系同步）**：扩展 PR-C 的写者，不另起写者；刷新入口仍是本 PR 的命令。
- **#224（形状清理）**：`DeliveryScope` 的字符串分支仍由 `normalizeScope` 处理，本 PR 不删；`EdgeProvenance.ChainSkeleton`、恒为 `true` 的 `observed`、恒为 `undefined` 的 `detail` 已由 PR-C 登记给 #224。
- **#72（真实交付 provider）**：不在本 PR 的范围内（#222 Out of scope）。

### 拟新增的技术债行（D3 手工追加到 tracker 的 Open Items）

| ID | 日期（本地） | 状态 | ExecPlan | 子系统 | 分支 | 记录者 | 简述 | 延期理由 | 遗留影响 | 下一步 |
|---|---|---|---|---|---|---|---|---|---|---|
| TD-045 | 2026-10-08 | Open | `docs/exec-plan/active/2026-10-08-delivery-query-pure-read.md` | 核心与 controller（`packages/core/src/context.ts`、`packages/controller/src/commands.ts`） | `fix/delivery-query-pure-read` | #222 定稿评审者 | 交付事实只在有人调 `commands.refreshDeliveryFacts` 时更新：既没有定时刷新，也没有「打开视图时刷新」，从未刷新的上下文显示四个 `not_refreshed` 缺口并标降级 | #222 只要求显式命令触发；定时归 #134，抽屉打开时调用归 #234；接进 `bootstrapWorkspace` 会把规划同步与交付读取耦合，而且那是 PR-A 的文件 | 首次打开交付视图看不到 CI，直到宿主或 UI 调一次刷新 | #234 在抽屉打开与手动刷新时调命令；#134 按工作区定时批量刷新（需要列出执行上下文的端口） |
| TD-046 | 2026-10-08 | Open | 同上 | 核心与存储端口（`packages/core/src/delivery.ts`、`packages/capabilities/src/storage.ts`） | 同上 | 同上 | 刷新失败的原因不落库：查询只能说某个集合陈旧，说不出是离线、权限被拒、截断还是提交失败；原因只在那一次刷新命令的结果里 | 原因码要定词表，还要防止 provider 文字进入 wire（K2）；#222 的验收只要求 stale / degraded | 用户看到陈旧，却不知道该重试还是去修权限 | 需要时给 `sets_json` 的集合加 `reason` 码（JSON 加字段，不需迁移），词表取 `ProviderErrorCode` 加 `truncated`，并由 `freshness` 转发 |

## Outcomes & Retrospective

尚未实施。D3 收口时在这里写：PR-C 实际接口与本计划的偏差、D1 的红信息、变异实测、对抗验证的发现与处置、遗留给 #234 / #134 / #233 的事项。

## Bottom Change Note

- Change Note (2026-10-08 CST，定稿评审者)：初稿。为什么写：#222 要求单独的 ExecPlan，并以 PR-C 的 spec 为前提。写了什么：重锁接口的步骤、红用例与变异表、P3′，以及与 PR-A、PR-B、#289 的交接。开工时以 PR-C 合入后的接口为准，重新锁定。
