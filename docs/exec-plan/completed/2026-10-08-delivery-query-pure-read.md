# 交付查询只读已提交事实 ExecPlan

> 状态：Completed（2026-10-09，PR #293 合并前归档；三轮 MMP 评审均 APPROVED，见 `docs/review/pr-293-mmp-review.md`）。设计已定稿（定稿评审者，2026-10-08）；D0–D2 与 D3 的文档回填、变异已由实现者完成（2026-10-08）；对抗验证第一轮的 15 条发现已处置（Progress、Surprises 第 9–14 条、Decision Log 第 16–22 行）；最终验收与重构已完成（2026-10-08 09:20 CST，Progress 的两条验收记录、Decision Log 第 23–24 行），等待人类评审；整合提交、推送由协调者做，归档在人类评审之后。接口已在 PR-C 的实现 head `d1fc382` 上重新锁定（D0）；PR-C 的规模收敛（C7）之后重新 rebase，接口不变，见 Progress 的重新 rebase 一条；对抗验证第二轮（在 `101305e` 上，1 个 P2、7 条 P3）的发现与 PR-C 第四轮留下的五条 P3 断言已在本 PR 处置（Progress 最后第二条、Surprises 第 17–19 条、Decision Log 第 25–28 行）。2026-10-08 19:55 CST 随 PR-C 的批次 C9 重新 rebase 到含 #295 / #289 的 main 之上，main 的两份 CI 集成测试改为先刷新再读（Progress 倒数第二条、Decision Log 第 29–30 行）。2026-10-08 22:05 CST 随 PR-C 的批次 C10 再 rebase 一次，并处理 rebase 之后独立对抗验证留给本 PR 的三项：两条负向用例之一补「对 Development 与 Delivery 零调用」，两份集成包装断言刷新本身不失败，Surprises 末条补第三条空转用例（Progress 最后一条、Surprises 末三条、Decision Log 第 31–33 行）；K3 接线由 #297 单独做。2026-10-09 处理 #293 第一轮 MMP 评审与协调者调研后的决定：`confirmedAt` 改存墙钟读数、刷新命令退出重放账本、作用域类型诚实化、T17 变体与 `.putRelation(` 静态守卫，ADR-0011 修订后按人类裁决改为 Accepted（r1 Progress、Decision Log 第 34–46 行）。2026-10-09 处理 #293 复评轮（APPROVE）的 4 条 P3 与 #292 复评轮留给本层的判别用例：完整性表补「变更请求页形非法」（变异 R1），订正刷新命令不进账本的模块头、ADR 转为 Accepted 之后残留的 Proposed、#134 的承接方与 Decision Log 第 37 行的理由（rr2 Progress、Decision Log 第 47、48 行）。
> 创建：2026-10-08 CST。规范：`PLANS.md`。
> 关联：issue #222，由 PR 正文尾注关闭；epic #216 Batch 3B；前置是 #221。
> 执行上下文：检出 `fix/delivery-query-pure-read` 的工作树根目录（`.worktrees/delivery-query-pure-read`）。
> 栈结构：本 PR 栈在 PR-C（`feature/delivery-fact-writer`，#221）上，栈深 2；PR-C 合并后，base 改为 `origin/main`。写入本计划时，分支与 PR-C 都在 `origin/main@6417d45`；2026-10-08 本分支已快进到 PR-C 的规划提交 `b7c8fb3`（draft PR #292），本计划的规划提交在它之上；PR-C 实现完成后（D0）本分支 rebase 到它的 head `d1fc382`，PR-C 本身仍未推送。
> 上游输入：
> - PR-C 的计划 `2026-10-08-delivery-fact-writer.md`（合并前在 `docs/exec-plan/active/`，合并后在 `docs/exec-plan/completed/`）；
> - `docs/adr/ADR-0011-delivery-facts-last-confirmed-snapshot.md`（Proposed，随 PR-C 落地；本 PR 修订之后 Accepted，Decision Log 第 39 行）；
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
| `getDeliveryProjection` 的过渡形态：先 `refreshDeliveryFacts`，再 `readDeliveryProjection`；刷新失败、被放弃（`anchored && !applied`）或没有锚点而仍显示旧快照时，逐跳标 `stale` 并降级；`degraded` 并上刷新的缺口，`error` 取刷新的错误 | 同上 | 整层删掉（刷新、`unconfirmed` 标陈旧、并缺口、`error`），只剩空输入分支与 `readDeliveryProjection`；被放弃的刷新那一层由刷新命令的 `applied` 承接（PR-C Decision Log 第 27 行） |
| `DeliveryFactsRecord`：`{ attemptedAt, sets: [{ kind, confirmedAt, stale, nodes }] }` | `packages/capabilities/src/storage.ts` | 算 `freshness` 与 `gaps` |
| `DeliveryLineageHop.stale` | `packages/core/src/delivery.ts` | 原样保留 |
| 测试辅助 `const ingest = (core, scope) => core.queries.getDeliveryProjection(scope)`。**PR-C 的 head 上有 11 处用到 `ingest` 的返回值**（D0 回读，见 Surprises & Discoveries 第 6 条） | `tests/e2e/delivery-lineage.test.js` | 改这一行，并改其中 9 处 |

PR-C 留给本 PR 的事实：

- 查询仍然触发刷新，首读会把关系从 2 写到 9。PR-C 原型实测，P3 原命令输出 `relations 2 -> 9 | ci online 5 | ci offline 5 | degraded true`。
- PR-C 的写者已经承担了 #222 验收 2 的机制：乱序守卫、只有完整空集合才删除、重复刷新收敛。对应的用例在 PR-C 里经查询路径通过，本 PR 把 `ingest` 换成命令后，它们改走命令路径。（重新 rebase 订正：PR-C 的 C7 把这几条用例合进了「乱序」七个变体、两条「离线保留」的完整性表与「唯一写者」，对应关系见 PR-C 计划的 S31。）
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
    readonly freshness: readonly DeliveryFreshness[]   // 快照四个集合的投影，按固定顺序 commit、change_request、pipeline_run、check_run；从未刷新（没有快照）时是 []，不是四个「未知」：那个状态由四个 `not_refreshed` 缺口和 `degraded` 表达
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
  - `composeCore` 绑定 `(scope) => refreshDeliveryFacts(context, normalizeScope(scope))`；`normalizeScope` 容忍缺失的作用域（`undefined` / `null`）：`workItemId` 为 `undefined`，由写者与查询已有的守卫折成 `invalid_input`，不在这里同步抛 `TypeError`（第二轮 P3-5，Decision Log 第 25 行）；
  - `unavailableCore` 返回 `{ ok: false, anchored: false, applied: false, gaps: [], error }`；
  - `unavailableCore.queries.getDeliveryProjection` 补上新增的三个字段。
- **写者**（`packages/core/src/delivery-facts.ts`）：对抗验证之后共有三处改动，都不触及乱序、完整性与删除三条规则（Decision Log 第 5、16、18、21 行）：
  1. 函数开头加一行守卫（2026-10-09 起是与查询共用的 `isDeliveryScope`，Decision Log 第 41 行）。`scope.workItemId` 不是字符串或 `trim() === ''` 时返回 `{ ok: false, anchored: false, applied: false, gaps: [], error: projectError(ProjectErrorCode.InvalidInput, 'workItemId 不能为空') }`。原因：查询不再先挡空输入，命令直接调写者；不是字符串的输入也是 `invalid_input`，不是裸抛的 `TypeError`；
  2. 没有锚点的刷新什么也没读，但已有快照时不再静默：它与提交失败共用 `markStale`，把四个集合标陈旧并前移 `attemptedAt`，确认时刻、节点与锚点原样，不推进修订号；没有快照时什么也不写。已提交的快照不比本次读取旧（`>=`，与提交路径同一个 `superseded`）时什么也不写，较旧的无锚点刷新因此不能覆盖较新的提交（第二轮 P2-1）；这一步失败走外层 `catch`，返回结构化失败（命令报 `failed`，`anchored` 此时仍是 false）；
  3. 结果的 `gaps` 只带能力键（`DeliveryRefreshGap`）。`readChainFacts` 的缺口原因取自 provider 的错误文字，结果会原样到达 controller 的 wire，所以不转发（K2）。
- **controller**（`packages/controller/src/commands.ts`）：
  - `ControllerCommands` 加 `refreshDeliveryFacts(scope: DeliveryScope, envelope: CommandEnvelope): Promise<CommandResult<DeliveryRefreshResult>>`（Superseded by Decision Log 第 36 行（2026-10-09）：第二个参数是 `Pick<CommandEnvelope, 'actorRef'>`，不带幂等键）；
  - （Superseded by Decision Log 第 36 行（2026-10-09）：刷新命令不进重放账本，每次调用都是一次真的读取。）实现走实例内的重放账本，键含作用域：`replay('refreshDeliveryFacts:<作用域>', envelope, ...)`，同键同作用域返回原结果，同键换作用域是另一个请求（#194 同类，Decision Log 第 19 行）；结果 `ok` 为真报 `local_only`（只写本地已确认事实，没有外部写入，不是权威确认），否则报 `failed`。`local_only` 不说明这次是否提交了新事实，调用方要读 `value.applied` / `anchored` / `gaps`（接口注释写明）。
- **controller 查询**（`packages/controller/src/queries.ts`）：`ControllerQueries` 加 `getDeliveryProjection(scope): Promise<DeliveryProjection>`，原样转发 `core.queries.getDeliveryProjection(scope)`。

不接进 `bootstrapWorkspace`，见 `Decision Log` 第 1 行。

### 收敛与删除（#222 验收 2）

机制都在 PR-C 的写者里：

- 乱序：已提交快照的 `attemptedAt` 更晚时整次放弃；
- 重复：节点与关系不变，修订号不推进；
- 删除：只有完整的空集合才删除。

本 PR 不改写者的这三条规则；对写者的三处改动（空输入守卫、无锚点的刷新标陈旧、缺口只带能力键）见上面的「刷新命令」。验收证据是 PR-C 的「乱序」「重复刷新收敛」「完整空集合才删除」「失败不清空」四条用例在 `ingest` 换成命令之后仍然通过。

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

**实测**（2026-10-08，`node scripts/rule-checks.mjs size feature/delivery-fact-writer`，D3 的实现者部分之后）：代码 227 行（CI 口径 ≤ 1000，规划上限 800），文档 539 行（CI 口径 ≤ 1500，规划上限 1300）。代码比估算多的部分都在测试：`delivery-lineage` 的 113 行（估算约 51）包含改写的 9 处读 `ingest` 返回值的用例（Surprises 第 6 条）、空工作项一条、「被放弃的刷新」按刷新结果重写；`controller-roundtrip` 的 39 行（估算 22）多了「core 不可用」一条与新鲜度、`attemptedAt` 的断言；实现部分约 71 行（估算约 60），多在缺口原因的注释与新字段的文档注释；测试约 156 行（估算约 76）。

**对抗验证第一轮之后的实测**（2026-10-08，同一命令）：代码 426 行（CI 口径 ≤ 1000，规划上限 800）。比上一次多出的约 200 行几乎都在测试：`delivery-lineage` 235 行（整库快照与全部 provider 方法的「纯读」、K1 三个步骤、半提交的缺口原因、两个 Storage 的「缺口」与「无锚点的刷新」、缺口不转发 provider 文字、非字符串输入），`controller-roundtrip` 76 行（wire 用例与重放账本的作用域用例）；实现多约 20 行（`markStale`、`DeliveryRefreshGap`、作用域键、`typeof` 守卫与注释）。文档桶以提交后的回读为准（见 Progress），仍远低于 1300。

**验收重构之后的实测**（2026-10-08 09:20 CST，同一命令，`refactor(core)` 提交之后、验收文档提交之前）：代码 434 行。多出的 8 行来自 controller-roundtrip 的组合辅助函数与 `openWorkItems`，以及刷新命令拆成两行的账本键；文档以 Progress 末行为准。

**对抗验证第二轮之后的实测**（2026-10-08 11:40 CST，同一命令，`fix(core)` 提交之后）：代码 541 / 1000 行（规划上限 800），文档见 Progress 的同一条。比重新 rebase 时的 439 多出的 102 行里，实现 1 行（`normalizeScope`），其余是 7 条新用例与对既有用例的断言补充：delivery-lineage 88 行，controller-roundtrip 14 行。PR-C 的代码桶仍是 799，没有新增一行（`node scripts/rule-checks.mjs size origin/main` 在检出 `feature/delivery-fact-writer` 的工作树根目录运行）。

## Global Constraints

- 保持 `AGENTS.md` §1.1 七条不变量。不改 Project 的 `Status`、`blocked-by` / `blocking`。合并由人类决定。
- 规模：代码不超过 800（CI 硬门 1000），文档不超过 1300（K8）。
- 先红：第一个产品改动之前，「纯读」两条用例必须在 PR-C 的 head 上见红，失败信息记进 `Progress`。红用例的本地提交在整合时并入交付物提交，`main` 上不留红提交，也不用 `skip` / `todo`。
- 不改 PR-C 写者的完整性、乱序与删除规则；需要改，就回到 PR-C 的计划与 ADR-0011。不推进修订号（K1），不写任何游标（K5）。对抗验证之后对写者做了三处不触及这三条规则的改动（空输入守卫、无锚点的刷新标陈旧、缺口只带能力键），理由与撤销方式见 Decision Log 第 16、18、21 行。
- 不改 `packages/core/src/chain-facts.ts`（K3、K4 的接缝在那里）、`bootstrap.ts`，也不改任何 provider 或 Storage 端口。
- e2e 命令一律带 `--test-timeout`。不改 git config；提交身份用 `git -c` 单次传入开发账号，推送前核对作者。tracker 手工编辑。
- Node 用本机 `v26.10.0`，pnpm 用 `10.28.2`。不新增依赖。

本 PR 的文件集合（只在此处声明）：

| 区域 | 文件 |
|---|---|
| core | `packages/capabilities/src/storage.ts`（2026-10-09 起，只改 `confirmedAt` 与 `attemptedAt` 两行注释，Decision Log 第 45 行）、`packages/core/src/delivery.ts`、`packages/core/src/delivery-facts.ts`、`packages/core/src/context.ts`、`packages/core/src/queries.ts` |
| controller | `packages/controller/src/commands.ts`、`packages/controller/src/queries.ts` |
| 测试 | `tests/e2e/delivery-lineage.test.js`、`tests/e2e/controller-roundtrip.test.js`、`tests/e2e/status-policy.test.js`、`tests/mvp0/chain.test.js`。条件文件：若 D0 回读到 `origin/main` 已有 PR #289 的 `tests/integration/github-actions-ci-facts.test.js`，它也算进来（2026-10-08 起成立：#289 与 #295 都已合并，该文件与 #295 的 `tests/integration/delivery-pages-complete.test.js` 都进文件集合，Decision Log 第 29 行） |
| 文档 | 本计划、`docs/review/pr-293-mmp-review.md`、`docs/adr/README.md`（ADR-0011 的状态，2026-10-09）、`docs/README.md`、`docs/product/vertical-path.md`（§2.1 第 10、11 行）、`tests/mvp0/README.md`（节点 6、7 的入口）、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`（P3 的原地标注与 Progress 一行）、`docs/exec-plan/tech-debt-tracker.md`（TD-045–TD-049，K6 预分配的号段）、`docs/adr/ADR-0011-delivery-facts-last-confirmed-snapshot.md`（只改第 3、5、9 条，Decision Log 第 27 行） |

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
   - `git ls-tree origin/main packages/core/src/development-route.ts`：PR-B 已合并时，路由缝的替换由 PR-C 或 PR-B 负责（K3），本 PR 不碰。（Superseded by PR-C Decision Log 第 45 行（2026-10-08）：替换由 #297 单独做。）
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

   在 PR-C 的 head 上，期望失败信息为 `首读前后关系、修订号与交付事实逐字不变`：关系从 2 变成 9，快照从无到有。修订号不变，因为写者从不推进修订号（K1）；所以这条验收是靠关系与快照这两项见红的。（Superseded by Decision Log 第 20 行（2026-10-08）：对抗验证后的最终形态比较整库，包括实体与游标；记录四个 provider 域的全部方法；同时覆盖 core 与 controller 的 `getDeliveryProjection`、`getDeliveryLineage`、`getExecutionContext`；刷新前后各跑一遍。标题前缀 `纯读（内存替身）` / `纯读（SQLite）` 不变，后半句改为「刷新前后的交付查询（core 与 controller）前后整库逐字不变，且不调用任何 provider 方法」。）
2. 同一文件加 `缺口：未观察到的变更请求显示为缺口，出现后只落一条关系（#222）`。步骤：
   1. `startWork`，不创建变更请求；
   2. 第一次读投影，断言 `gaps` 的原因是四个 `not_refreshed`，`degraded === true`；
   3. `ingest` 后再读，断言 `gaps` 恰为 `[{ entityKind: 'change_request', reason: 'not_observed' }, { entityKind: 'check_run', reason: 'not_observed' }]`；
   4. 断言存储里每条关系的两端都是已登记实体；
   5. 在替身里创建变更请求，`ingest` 两次后读投影：`gaps` 为 `[]`，`produced_by` 关系恰为 1 条，而且它的 `from` 等于 `produced_by` 跳的 `from`。

   在 PR-C 的 head 上，期望失败在第一条 `gaps` 断言（`gaps` 为 `undefined`）。（Superseded by Decision Log 第 20 行：这条用例跑两个 Storage，标题改为 `缺口（内存替身）` / `缺口（SQLite）`，存储读取改走 `storage.listRelations` 与整库的实体表。）
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
2. `tests/e2e/delivery-lineage.test.js` 只改 `ingest` 一行：（Superseded by Surprises 第 6 条与 Decision Log 第 9 行（2026-10-08）：另改 9 处读 `ingest` 返回值的用例，实际改了 113 行；对抗验证之后又按 Decision Log 第 16、20 行补了断言，见 `Progress`。）

        /** 摄入的唯一调用点：交付事实只经显式刷新命令写入（#222）；查询只读它提交的结果。 */
        const ingest = (core, scope) => core.commands.refreshDeliveryFacts(scope)

3. `tests/e2e/status-policy.test.js` 在 `getDeliveryLineage` 之前加一行刷新：

        await core.commands.refreshDeliveryFacts({ workItemId, repositoryId: REPOSITORY }) // 查询纯读（#222）：交付事实只经刷新命令摄入

4. `tests/mvp0/chain.test.js` 节点 6 在 `lineage(scope)` 之前、节点 7 在 `push` 失败运行之后、`lineage(scope)` 之前，各加一行：

        await needMethod(api, 'commands.refreshDeliveryFacts', '<节点名>', invariant)(scope)

   节点 6 的节点名是 `分支/变更请求`，节点 7 的是 `CI`。文件头要求换 API 名时显式改断言，这一行就是显式改动。
5. D0 回读到 PR #289 的集成测试已合并时，在它每次读投影之前补 `await core.commands.refreshDeliveryFacts(scope)`。（2026-10-08 执行：两份集成测试都在组合根包装里先刷新再读，Decision Log 第 29 行）

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
2. 控制计划的 P3 标题行，追加 `Superseded by docs/exec-plan/completed/2026-10-08-delivery-query-pure-read.md 的 P3′（2026-10-08）：#222 之后查询纯读，P3 原命令输出 relations 2 -> 2 | ci online 0 | ci offline 0 | degraded true，摄入要先调 commands.refreshDeliveryFacts`。这个输出是 PR-D 原型实测的。Progress 加一行 3B 的完成记录。
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
| B1 | 首次读取交付视图前后关系与修订号相同，修复前失败（#222 验收 1） | 「纯读（内存替身）」「纯读（SQLite）」在 PR-C 的 head 上红、本 PR 绿；P3′ 的 `read relations 2 -> 2`。最终版用例在 PR-C 的源码上先因 controller 没有 `getDeliveryProjection` 而红；只给 PR-C 的源码补这一行转发后，两条都红在「从未刷新：查询前后整库……逐字不变」（验收者复测，见 Progress） |
| B2 | 重复与乱序观察收敛，只有完整空集合才删除（#222 验收 2） | PR-C 的「乱序」「重复刷新收敛」「完整空集合才删除」「失败不清空」「提交失败」在 `ingest` 改成命令后仍然通过（重新 rebase 后是「乱序」七个变体、「唯一写者」的重复刷新部分、两条「离线保留」的完整性表与「提交失败」；PR-C 的 C10 删去被蕴含的时钟递增与回拨两个变体后，「乱序」是三个变体，PR-C S34） |
| B3 | 缺失节点显示为缺口，从不被重新识别成第二条关系（#222 验收 3） | 「缺口（内存替身）」「缺口（SQLite）」；半提交上下文的缺口原因与 `degraded` 在「谱系写者不写命令边」里固定 |
| B4 | `node --test tests/integration tests/e2e` 与 `pnpm run boundaries` 退出 0（#222 验收 4） | D2 的验证命令 |
| B5 | 摄入只由刷新命令触发 | 「唯一写者」两条静态断言（写者只被 `context.ts` 调用；命令只被 controller 的命令转发）；「纯读」两条动态用例：整库快照、四个域的全部 provider 方法、core 与 controller 三个查询，刷新前后各一遍（绕开静态正则的变异 N50b 也被杀死） |
| B6 | controller 的查询面转发 stale / degraded / freshness / gaps，刷新报 `local_only` | controller-roundtrip 的新用例；刷新结果到达 wire 的用例（缺口只带能力键、没开始工作的工作项也报 `local_only` 而 `applied` 为 false）；重放账本按作用域区分的用例 |
| B7 | 全量回归 | 全量与 `tests/mvp0` 都是 `ℹ fail 0`；`tsc` 无输出 |
| B8 | 守卫有判别力 | 下面的变异表全部被杀死 |
| B9 | 刷新命令从不推进修订号（K1）：首次刷新、把集合标陈旧的刷新、没有锚点的刷新都一样 | 「重复刷新收敛」（重新 rebase 后并在「唯一写者」里）；变异 N1a–N1d |
| B10 | 没有锚点的刷新不让旧 CI 显示成最新（TD-047） | 「无锚点的刷新（内存替身）」「无锚点的刷新（SQLite）」「被放弃的刷新」（重新 rebase 后是「乱序」七个变体的无锚点部分；PR-C 的 C10 之后是三个变体）；变异 N-F6a–N-F6g |
| B11 | 刷新结果不转发 provider 文字（K2） | 「刷新结果不转发 provider 文字」；controller-roundtrip 的 wire 用例；变异 N-F7 |
| B12 | 两条「负向」用例仍经刷新命令摄入，守卫被削弱时变红 | 变异 N30、N37：PR-C 的 head 上 5 条变红，对抗验证前的 PR-D head 上 3 条，现在 10 条，两条负向用例都在其中。rr：「负向：未创建执行上下文时」另断言刷新对 Development 与 Delivery 零调用，变异 HOW（链读取把没有句柄的上下文当作有工作树）由存活变为杀死 |
| B13 | 无锚点分支的乱序与失败守卫有判别用例；字符串 / 对象作用域是同一个请求；缺失的作用域是结构化失败（第二轮 P2-1、P3-1、P3-2、P3-5） | 「乱序（内存替身 / SQLite，没有锚点的较旧刷新）」「无锚点标陈旧失败（内存替身 / SQLite）」；controller-roundtrip 的归一用例；「空工作项」；变异 S16、S20、S10、S4、NULLSCOPE |
| B14 | PR-C 第四轮留下的五条 P3 在本 PR 有断言：墙钟项、读回顺序、空集合遇提交失败、从未确认的集合没有确认时刻、从未开始工作的作用域不降级、替身按（工作区，上下文）各存一行；另有 freshness 顺序与重复的无锚点刷新前移 `attemptedAt` | 「读取开始时刻的墙钟项」；两条离线保留的读回顺序；「提交失败：完整读到的空集合同样标陈旧」；「没有可提交的快照时」；两条「负向」；「两个上下文共享同一头提交」；「无锚点的刷新」×2；变异 WALL、ORDER、EMPTYSTALE、CONFAT、NEGDEG、UPSERT、FRESHORDER、ADVANCE |
| B15 | #293 第一轮评审与调研决定（2026-10-09）：`confirmedAt` 是读取开始时的墙钟读数；刷新命令天然幂等、不重放；作用域守卫由类型强制；T17 与 `.putRelation(` 有杀手 | 「读取开始时刻的墙钟项」「刷新结果与快照时刻」、controller-roundtrip 的四条交付用例、「乱序」六个变体、「唯一写者」；变异见下文第一轮评审之后的表 |
| B16 | 变更请求查找把页形非法的成功页记成缺口，不是完整空集合；这一格在 #292 单独合并时没有用例，由本 PR 补上（#292 复评轮 P3） | 完整性表「变更请求页形非法」（内存替身与 SQLite 两条离线保留）；变异 R1（撤掉查找谓词的 `Array.isArray(page.items)`）2 红 |

变异表。D-M1–D-M6 先在原型上实测；D3 在真实 head（D2 提交）的 `git archive` 导出目录里重做并补了 D-M7–D-M18；对抗验证第一轮之后，**在最终树（`fix(core)` 提交）的导出目录里整表重做**：D-M1–D-M17 加对抗验证的 N 系列共 48 条。（重新 rebase 后，第三列里 PR-C 的旧用例名按 PR-C 计划 S31 对应到合并后的用例；验收者的 A 系列在重新 rebase 后整表重做，见 Progress 最后一条。）每条先用 `git diff --no-index -U0` 证明每个被改文件恰有一个 hunk、锚点在 pristine 里恰出现一次，再跑点名文件（`tests/e2e/delivery-lineage.test.js`、`tests/e2e/controller-roundtrip.test.js`、`tests/e2e/status-policy.test.js`、`tests/mvp0`，`--test-timeout=20000`，基线 58 条全绿），最后用 `/bin/cp -f` 还原并 `cmp` 证明还原一致、同一命令 `ℹ fail 0`。**48 条全部被杀死**，导出目录已删除。D-M18 被 N-F6a 取代（TD-047 已在写者里修复，见 Decision Log 第 16 行）。

| # | 变异 | 应变红的用例 |
|---|---|---|
| D-M1 | 查询重新调用写者 | 纯读 ×2、唯一写者 |
| D-M2 | controller 查询丢掉 `freshness`、`gaps`、`degraded` | controller-roundtrip 的新用例 |
| D-M3 | `gaps` 恒为 `[]` | 缺口 |
| D-M4 | 刷新命令报 `confirmed`（锚点必须落在刷新命令上） | controller-roundtrip 的新用例 |
| D-M5 | 从未刷新不算降级 | 缺口 |
| D-M6 | 未观察到的变更请求也落成关系（真实 head 上改的是写者的 `seen`，把骨架节点也算作已观察） | 缺口、完整空集合才删除 ×2 |
| D-M7 | 写者的空 `workItemId` 守卫移除 | 空工作项 |
| D-M8 | 从未完整读到的集合报 `not_observed`，不是 `unconfirmed` | 没有可提交的快照时 |
| D-M9 | `unavailableCore` 的刷新命令报成功 | controller-roundtrip 的「core 不可用」 |
| D-M10 | 没有执行上下文也算降级 | 没有可提交的快照时 |
| D-M11 | 没有执行上下文时命令位置的缺口原因报 `not_observed` | 没有可提交的快照时 |
| D-M12 | `freshness` 丢掉 `stale` | controller-roundtrip 的新用例 |
| D-M13 | 投影不转发 `attemptedAt` | controller-roundtrip 的新用例 |
| D-M14 | core 刷新命令不经写者 | 18 条，含 controller-roundtrip 的新用例与 delivery-lineage 的多数用例 |
| D-M15 | 写者的乱序守卫移除（验证改过的用例仍有判别力） | 乱序 ×6 等共 7 条 |
| D-M16 | 没有锚点的刷新报 `anchored: true` | 刷新结果与快照时刻、被放弃的刷新、没有可提交的快照时 |
| D-M17 | 被放弃的刷新报 `applied: true` | 被放弃的刷新 |
| D-M18 | 没有锚点的刷新照样写陈旧标记 | （Superseded by N-F6a：TD-047 已在写者里修复，方向相反——现在要杀死的是「什么也不写」） |
| N50–N52 | controller 的 `getDeliveryProjection` / `getDeliveryLineage` / `getExecutionContext` 先调刷新命令 | 唯一写者（命令只被 controller 的命令转发）、纯读 ×2（controller 一路）；N50 / N51 / N52 各 3 条 |
| N50b | controller 查询解构出刷新命令再调（绕开静态正则） | 纯读 ×2 |
| N2 | core 的 `getDeliveryLineage` 先调写者 | 纯读 ×2、唯一写者 |
| N1a–N1d | 首次写快照 / 每次提交 / 有集合标陈旧 / 标陈旧的尝试推进修订号 | 重复刷新收敛（N1d 另有被放弃的刷新等） |
| N3 / N4 / N4c | 查询调 `describeCapabilities` / 登记一个实体 / 推进修订号 | 纯读 ×2 |
| N10、N16、N16b | 记录在而命令边不在时，缺口原因报 `not_started` / 不报 `execution_context` / 不报 `worktree` | 谱系写者不写命令边 |
| N30、N37 | 写者的无锚点守卫移除；同名分支制造工作树谱系（链读取把没有句柄的上下文当作已观察，且写者守卫移除，两个文件各一处） | 两条「负向」用例、刷新结果与快照时刻、被放弃的刷新、没有可提交的快照时、重复刷新收敛等 10 条 |
| N-F6a–N-F6g | 无锚点的刷新什么也不写 / 标陈旧不前移 `attemptedAt` / 丢确认时刻 / 只标流水线 / 不查乱序守卫 / 清空节点；提交失败不再标陈旧 | 无锚点的刷新 ×2、被放弃的刷新、提交失败、刷新结果与快照时刻 |
| N-F7 | 刷新结果原样带 provider 的缺口原因 | 刷新结果不转发 provider 文字、controller-roundtrip 的 wire 用例 |
| N-F8a、N-F8b | 重放账本不含作用域 / 丢掉仓库 | controller-roundtrip 的重放账本用例（Superseded 2026-10-09：刷新命令不再进重放账本，这两条与 A-C1、A-C2、S4 一起退役，由 RPL 取代，见下文第一轮评审之后的变异） |
| N-F9a、N-F9b | 没有提交新事实的刷新不报 `local_only` / 失败的刷新也报 `local_only` | controller-roundtrip 的 wire 用例 / core 不可用 |
| N-F11a、N-F11b | 写者 / 查询的守卫只认空串 | 空工作项 |
| A-G7 | 验收重构把缺口并进算跳的循环之后：集合位置的缺口在推入它的跳之前判断 | 缺口 ×2、谱系写者不写命令边、没有可提交的快照时、controller-roundtrip 的新用例，共 5 条 |

验收者复测（2026-10-08 09:20 CST，`refactor(core)` 提交的 `git archive` 导出目录，同一组点名文件，基线 `ℹ tests 58`、`ℹ fail 0`）：重构触及的三个文件，加上 controller 查询、写者缺口出口与 `unavailableCore` 各一处，共 20 条，记作 A 系列（A-G1–A-G12 在 `delivery.ts`，A-C1–A-C8 在 controller 与写者）。其中 17 条重做上表的 D-M2/3/4/8/9/11/12/13、N10、N16、N16b、N-F7、N-F8a/b、N-F9a/b 与对抗验证的 N11（缺口顺序颠倒），3 条新增：A-G7（见上表）、「从未刷新报 `unconfirmed`」、「没有上下文时集合位置报 `not_refreshed`」。每条的 `git diff --no-index -U0` 恰为 1 个 hunk，锚点在 pristine 里恰出现一次；**20 条全部被杀死**；每条都用 `/bin/cp -f` 还原，`cmp` 一致，复跑 `ℹ fail 0`。导出目录已删除。


**对抗验证第二轮之后的变异**（2026-10-08 11:40 CST，在 `fix(core)` 提交 `d69246e` 的 `git archive` 导出目录里重做，点名文件同上，基线 `ℹ tests 57`、`ℹ fail 0`；修复前是重新 rebase 后的 `30db4b1`，基线 50 条）。每条先用 `cmp` 证明与 pristine 不同、`git diff --no-index -U0` 证明恰有一个 hunk，再运行；用 `/bin/cp -f` 还原后 `cmp` 一致，复跑 `ℹ fail 0`。14 条新增变异、A 系列 20 条与 N-F6a–N-F6g 7 条共 41 条，**全部变红**，导出目录已删除。第三列是同一变异在修复前 `30db4b1` 的结果（存活即没有判别断言）：

| # | 变异 | 修复前 | 修复后变红的用例 |
|---|---|---|---|
| S16 | 无锚点分支的标陈旧换成不带乱序守卫的内联事务 | 存活 | 「乱序（内存替身 / SQLite，没有锚点的较旧刷新）」 |
| S20 | 无锚点标陈旧的异常被吞掉，命令返回 `ok: true` | 存活 | 「无锚点标陈旧失败（内存替身 / SQLite）」 |
| S10 | core 刷新命令不再归一字符串作用域 | 存活 | controller-roundtrip 的归一用例、「空工作项」 |
| S4 | controller 重放键改成 `JSON.stringify(scope)` | 存活 | controller-roundtrip 的归一用例 |
| NULLSCOPE | `normalizeScope` 不再容忍 `undefined` / `null`（即修复本身） | 不适用：修复前两条用例红在 `TypeError` | controller-roundtrip 的归一用例、「空工作项」 |
| WALL | 令牌去掉墙钟项 | 存活 | 「读取开始时刻的墙钟项」 |
| ORDER | SQLite 读回时节点反序 | 存活 | 「离线保留（SQLite）」 |
| EMPTYSTALE | 提交失败后，空集合不标陈旧 | 存活 | 「提交失败：完整读到的空集合同样标陈旧」 |
| FRESHORDER | `freshness` 顺序颠倒 | 存活 | 「无锚点的刷新」×2、「没有可提交的快照时」 |
| ADVANCE | 已全部陈旧的快照不再被无锚点的刷新前移 `attemptedAt` | 存活 | 「无锚点的刷新」×2 |
| NOSNAP | 从未刷新又无锚点的上下文，刷新后写出一行空快照 | 杀死（5 条） | 6 条，含「刷新结果与快照时刻」「两条负向」 |
| NEGDEG | 没有执行上下文也算降级（D-M10） | 杀死（「没有可提交的快照时」） | 「没有可提交的快照时」、两条「负向」 |
| UPSERT | 替身 `putDeliveryFacts` 的 upsert 谓词 `&&` 改成 `||` | 杀死（「两个上下文共享同一头提交」） | 同一条用例 |
| CONFAT | 从未确认的集合记成已确认 | 杀死（「没有可提交的快照时」，经 `unconfirmed` 缺口间接） | 同一条用例 |

A 系列沿用验收者的清单（A-G1–A-G12、A-C1–A-C8），查找文本按重新 rebase 后的 `delivery.ts` 改写（A-G1 落在 `missing` 的函数体，A-G5、A-G6 去掉两个命令位置外面的 `missing(...)`，A-G7 改成「集合位置一律记缺口」，A-G9 落在集合原因表达式上），各变红 1–5 条。N-F6a–N-F6g 在本计划里只有一行文字描述，没有留存执行器，这次按那行描述对 `markStale` 与无锚点分支重新定义：不写、不前移 `attemptedAt`、丢确认时刻、只标流水线、不查乱序守卫、清空节点、提交失败不再标陈旧；各变红 4–12 条。（2026-10-08 19:55 CST 重新 rebase 后再做一次：A 系列 20 条、N-F6a–N-F6g 7 条与上表 14 条共 41 条按当前代码重写查找文本，在 `git archive HEAD` 的导出上全部变红，基线 57 条；另 3 条作用于两份 CI 集成测试，见 Progress 最后一条。）


**rebase 之后独立对抗验证的变异**（rr，2026-10-08，在本批代码提交前后的 `git archive` 导出目录里做；全量命令跳过导出副本里依赖 git 检出的一条 CLI 用例，集成层命令是两份集成测试，`--test-timeout=20000`）：

| # | 变异 | 修复前 | 修复后变红的用例 |
|---|---|---|---|
| HOW | 链读取把没有句柄的上下文当作有工作树（`hasObservedWorktree` 恒真，PR-C 的 `chain-facts.ts`） | 全量下存活 | 「负向：未创建执行上下文时」（全量另有「真实层 tests/e2e」守卫） |
| I6 | 刷新的成功路径在有缺口时带结构化错误 | 集成层存活（e2e 的两条离线保留杀死它） | 集成层 5 条：`delivery-pages-complete` 的三条分页用例与「任一运行或检查属于别的提交」、`github-actions-ci-facts` 的「第二页故障」 |
| I2b | 未观察锚点时用合法的 40 位 SHA 读流水线 | 刷新包装下杀死（2 条） | 同左：两份文件的「未观察锚点零请求」 |
| I2b-nowrap | I2b 再去掉 `github-actions-ci-facts` 的刷新包装 | — | 变红的 3 条里没有「未观察锚点时 adapter 收到零请求」：纯读下它空转（Surprises 末条） |

**#293 第一轮评审之后的变异**（r1，2026-10-09，在本轮代码 WIP 提交的 `git archive` 导出目录里做，导出目录在 `$TMPDIR` 下带任务名与随机后缀；点名文件与 rr 相同：主表 `tests/e2e/delivery-lineage.test.js tests/e2e/controller-roundtrip.test.js tests/e2e/status-policy.test.js tests/mvp0`，基线 56 条全绿；集成层两份集成测试，基线 10 条全绿；`--test-timeout=20000`。每条先用 `cmp` 与 `git diff --no-index -U0` 证明生效，`/bin/cp -f` 还原后 `cmp` 一致、复跑全绿）。rr 的 43 条主表规格里，A-C1、A-C2、S4 针对已删除的账本键，退役；A-C3–A-C5、NULLSCOPE、WALL、K1 与集成层的 I2b-nowrap 按新代码改写查找文本，语义不变；新增 9 条。整表 49 + 6 条全部被杀死。

| # | 变异 | 变红的用例 |
|---|---|---|
| RPL | 刷新命令重新进重放账本（按作用域定键） | 2：controller-roundtrip 的「刷新命令报 local_only，查询原样转发……」「刷新命令不进重放账本」 |
| W1 | `confirmedAt` 改回乱序令牌 | 3：controller-roundtrip 的第一条交付用例、「刷新结果与快照时刻」「读取开始时刻的墙钟项」 |
| W2 | 墙钟读数不能解析时仍写入 | 1：「读取开始时刻的墙钟项」 |
| W3 | `confirmedAt` 取读完时的墙钟读数 | 1：「读取开始时刻的墙钟项」 |
| T17 | （#292 评审编号）事务内守卫按集合的 `confirmedAt` 判断 | 4：「乱序」两种时钟下的「较新的读取遇到 Development 离线」与「较旧的读取提交成功」（墙钟改动之后提交成功的变体也能看出） |
| T11 | （#292 评审编号）降级事务的守卫 `>=` 改 `>` | 1：「乱序（两个 core 上下文对象，较旧的读取提交失败）」 |
| G1 | 交付写者绕过 `recordEdges` 直接写关系（不可达的调用点） | 1：「唯一写者」的 `.putRelation(` 静态断言 |
| SC1、SC2 | 作用域守卫不判 `undefined` / `normalizeScope` 放过不是字符串的工作项 | SC1 2：归一用例、「空工作项」；SC2 1：「空工作项」 |

**复评轮之后的变异**（rr2，2026-10-09，`git archive` 导出目录，`$TMPDIR` 下带任务名与随机后缀；`--test-timeout=20000`，点名文件为 `tests/e2e/delivery-lineage.test.js tests/e2e/controller-roundtrip.test.js tests/contract/storage-contract.test.js tests/integration/execution-relation-write-schema.test.js tests/integration/start-work-retry-identity.test.js tests/integration/storage-source-version-upgrade.test.js tests/integration/provider-binding-registration.test.js tests/e2e/status-policy.test.js`，基线 250 条全绿；每条的替换文本只匹配一处，跑完用原文写回并断言逐字相等）：

| # | 变异 | 变红的用例 |
|---|---|---|
| H5 | 变更请求查找的 `find` 不再比对 `sourceVersion`（#292 评审编号） | 2：离线保留（替身）、离线保留（SQLite）（「变更请求确认不存在」） |
| B2 | `collectDeliveryPages` 去掉页形守卫（#292 评审编号） | 2：同上（「流水线页形非法」） |
| T11 | 降级事务的守卫 `>=` 改 `>`（#292 评审编号） | 1：「乱序（两个 core 上下文对象，较旧的读取提交失败）」 |
| T17 | 事务内守卫按集合的 `confirmedAt` 判断（#292 评审编号） | 4：「乱序」两种时钟下的「较新的读取遇到 Development 离线」与「较旧的读取提交成功」 |
| G1 | 交付写者模块里加一个不可达的直接 `putRelation` 调用点 | 1：「唯一写者」的 `.putRelation(` 静态断言 |
| R1 | 变更请求查找谓词去掉 `Array.isArray(page.items)`（rr2 新增） | 2：离线保留（替身）、离线保留（SQLite）（「变更请求页形非法」，断言消息「不完整的读取不得删除、增补或改写已确认的 CI 事实」，actual 少了三条检查事实）。全量 1458 条下 4 红：这两条、「真实层 tests/e2e」汇总用例（转发 e2e 的红），以及导出目录没有 `origin` 远端造成的那一条 CLI 用例（与变异无关） |

## Progress

- [x] (2026-10-08 CST) 定稿评审。在 PR-C 原型之上实施本计划的原型（不提交）：D1 的四处新断言在 PR-C 原型上全红；D2 之后全量测试只剩一条失败，是导出副本缺 `.git` 引起的 CLI 用例，`tests/mvp0` 7/7；D-M1–D-M6 全部被杀死；规模约 136 行。写入本计划与 `docs/README.md` 索引行。
- [x] (2026-10-08 01:55 CST) 规划提交推送，开 draft PR #293（base `feature/delivery-fact-writer`），与 #292 用 `gh stack link 292 293` 建成原生栈 #294；`node scripts/policy-check.mjs pr 293` 通过；#222 `Status` 置 In Progress（见 Decision Log）。GitHub 只为指向默认分支的 PR 建立关闭引用，所以 #293 的 `closingIssuesReferences` 暂为空，#292 合并、#293 的 base 改为 `main` 后再回读。
- [x] (2026-10-08 06:28 CST) Batch D0：备份 `backup/delivery-query-pure-read-cab4e251`，rebase 到 PR-C 的 head `d1fc382`（冲突只在 `docs/README.md` 的索引表，保留两行）；`range-diff` 显示本分支自己的两个提交内容不变（仅 `docs/README.md` 的 PR-C 行随 PR-C 更新）。接口回读：`refreshDeliveryFacts` / `DeliveryRefreshResult`、`readDeliveryProjection`、两处 `readonly stale: boolean`、`ingest` 都有输出；与本计划的表有四处偏差（原型基线更早、过渡形态更厚、`ingest` 返回值被当投影用、PR-C 另留一条 TD-045 债务），另有纯读后没有锚点的刷新不再标陈旧，见 Surprises & Discoveries 第 5–8 条。相邻 PR：`origin/main` 上没有 `tests/integration/github-actions-ci-facts.test.js`（#289 未合并，D2 第 5 步不适用）；`context.ts` 无 PR-A 的改动；没有 `development-route.ts`（PR-B 未合并）。基线 `node --test --test-timeout=60000 tests/e2e/delivery-lineage.test.js tests/contract/storage-contract.test.js tests/integration/execution-relation-write-schema.test.js`：`ℹ tests 184`、`ℹ fail 0`。
- [x] (2026-10-08 06:38 CST) Batch D1：红用例，在 PR-C 的 head（`d1fc382` 之上只加了本计划）上运行 `node --test --test-timeout=20000 tests/e2e/delivery-lineage.test.js tests/e2e/controller-roundtrip.test.js`：`ℹ tests 40`、`ℹ pass 35`、`ℹ fail 5`，恰是新增的五处断言，其余用例全绿。每条的标题与第一条失败信息：
  - `纯读（内存替身）…`、`纯读（SQLite）…`：`AssertionError: 首读前后关系、修订号与交付事实逐字不变`。首读把关系与快照写了进去；独立探针里首读前后是关系 2 → 5（该探针没有创建变更请求，创建后是 2 → 9）、快照 none → present、修订号 1 → 1，所以这条验收靠关系与快照见红，不靠修订号（K1）。
  - `缺口：未观察到的变更请求显示为缺口，出现后只落一条关系（#222）`：`AssertionError: 从未刷新：四个位置都是 not_refreshed`，actual 为 `undefined`（投影没有 `gaps`）。
  - `唯一写者：交付事实与谱系边只经 refreshDeliveryFacts 在一个事务里写入（#221）`：`AssertionError: 摄入只经刷新命令，查询不调用写者（#222）`，actual 为 `['core/src/delivery.ts']`，expected 为 `['core/src/context.ts']`。
  - `交付：刷新命令报 local_only，查询原样转发陈旧、降级、新鲜度与缺口（#222）`：`TypeError: controller.commands.refreshDeliveryFacts is not a function`。
- [x] (2026-10-08 06:42 CST) Batch D2：实现 `Design / Spec` 的三节；`ingest` 换成 `core.commands.refreshDeliveryFacts(scope)`，按 Surprises 第 6 条改了 9 处读 `ingest` 返回值的用例（被放弃的刷新改读 `applied` / `anchored`，没有可提交的快照时的「只有缺口」改读 `not_started` 缺口），`status-policy` 与 `tests/mvp0` 节点 6、7 各补一次刷新命令。另补两条判别用例：空工作项（写者守卫）、core 不可用时的刷新与查询（`unavailableCore` 的新增成员）；controller 的新用例加同键重放。验证（`.worktrees/delivery-query-pure-read`）：`node_modules/.bin/tsc --noEmit` 无输出；`node --test --test-timeout=120000 tests/integration tests/e2e` 退出 0、`ℹ fail 0`；`pnpm run boundaries` 退出 0；`node --test tests/mvp0` 7/7；`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` `ℹ tests 1243`、`ℹ pass 1243`。D1 的五条红用例全部转绿。P3′ 输出 `read relations 2 -> 2 | refresh relations -> 9 | ci online 5 | ci offline 5 | stale true | degraded true`，与计划一致。
- [x] (2026-10-08 06:49 CST) Batch D3 的实现者部分：文档回填（`vertical-path.md` §2.1 第 10、11 行与 P3、`tests/mvp0/README.md` 节点 6、7、控制计划 P3 标注与 3B 一行、tracker 的 TD-045–TD-048）；变异 D-M1–D-M18 全部被杀死（见 `Validation and Acceptance`）；新增引用用例的回读按 `vertical-path.md` 的命令读回一行 ✔、`ℹ tests 1`，负对照 `ℹ tests 0`。
- [x] (2026-10-08 07:55 CST) 对抗验证第一轮的 15 条发现（P2 ×7、P3 ×8）：逐条在 `.worktrees/delivery-query-pure-read` 复现后处置。先写红：F6、F7、F8、F11 的用例在修复前变红（无锚点的快照没有标陈旧 / 缺口带 provider 原文 / 同键换作用域返回上一个结果 / `undefined` 的 `workItemId` 裸抛 `TypeError`），改完转绿；F1–F5、F15 是测试缺口，用变异证明（见变异表）。
  - **F1**（P2，controller 读去刷新没人发现）：属实。静态断言覆盖命令的全部调用点；「纯读」改成整库快照、四个 provider 域的全部方法、core 与 controller 的三个查询，刷新前后各一遍。N50–N52、N50b、N2 被杀死。
  - **F2**（P2，刷新命令的 K1）：属实（缺判别证据，行为本来正确）。「重复刷新收敛」在首次刷新之前取修订号，并覆盖标陈旧的刷新与没有锚点的刷新。N1a–N1d 被杀死。
  - **F3**（P2，「纯读」比承诺窄）：属实。同 F1；SQLite 一路读整库每张表。N3、N4、N4c 被杀死。
  - **F4**（P2，半提交上下文的缺口原因）：属实（缺断言）。「谱系写者不写命令边」固定刷新前后的 `gaps` 与 `degraded`；`degraded` 只表达新鲜度，Decision Log 第 17 行。N10、N16、N16b 被杀死。
  - **F5**（P2，两条负向用例空转）：属实。两条用例加回经刷新命令摄入，并断言刷新结果 `[true, false, false]`。N37 的杀伤集：PR-C 的 head 上 5 条（含这两条）、对抗验证前的 PR-D head 上 3 条（不含）、现在 10 条（含）；N30 现在也是 10 条。
  - **F6**（P2，TD-047 复发）：属实，修在写者，Decision Log 第 16 行。探针（确认 CI 快照 → 清空工作树句柄 → 刷新 → 读）修复前输出 `{"r":[true,false,false],"hops":7,"stale":0,"degraded":false}`，修复后 `{"r":[true,false,false],"hops":7,"stale":7,"degraded":true,"freshness":[true,true,true,true]}`。TD-047 移到 Resolved。
  - **F7**（P2，provider 文字到 wire）：属实。修复前 `gaps` 为 `[{key, reason: 'RAW-PROVIDER-TEXT token=…'}]`，整个 `CommandResult` 含原文；修复后只有 `[{"key":"delivery.pipeline.read"}]`、不含原文。Decision Log 第 18 行。
  - **F8**（P3，重放账本不含作用域）：属实（修复前同键换作用域返回同一个对象）。键含作用域，Decision Log 第 19 行。
  - **F9**（P3，`local_only` 说明不了无操作与离线）：属实但不改映射：没有合适的非成功状态，接口注释写明调用方读 `value`，controller-roundtrip 固定「没开始工作的工作项」与「provider 缺口」两种情形。Decision Log 第 19 行。
  - **F10**（P3，`attemptedAt` 文档）：属实。字段注释改为「最近一次记下快照的刷新尝试」。Decision Log 第 21 行。
  - **F11**（P3，非字符串 `workItemId`）：属实（`TypeError: Cannot read properties of undefined (reading 'trim')`，写者与查询都是）。两处守卫都先判 `typeof`。Decision Log 第 21 行。
  - **F12**（P3，计划卫生）：属实。D2 第 2 步就地标注 Superseded；看板写入行补成四格并编号为第 15 行。
  - **F13**（P3，ADR-0011 第 7 条）：属实，不在本 PR 的文件集。登记 TD-049，交 PR-C 的评审修订（Decision Log 第 22 行）。
  - **F14**（P3，推送顺序与红提交）：属实，是协调者的步骤，本轮不推送：`node scripts/rule-checks.mjs size origin/feature/delivery-fact-writer` 因远端 PR-C 仍是规划提交而超限；`cc9a30a4` 红提交与本轮的修订提交在整合时并入交付物提交；推送前建 backup ref 并用精确的 `--force-with-lease`。
  - **F15**（P3，缺口只跑内存替身）：属实。缺口用例跑两个 Storage，标题改为 `缺口（内存替身）` / `缺口（SQLite）`，`vertical-path.md` 的引用同步并按回读命令逐条读回（各一行 ✔、`ℹ tests 1`，负对照 `ℹ tests 0`）；「无锚点的刷新」另跑两个 Storage。新鲜度不会随时间老化是 TD-045 已声明的范围，不在本 PR。
  - 验证（本轮提交 `fix(core)` 之上）：`node_modules/.bin/tsc --noEmit` 无输出；`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` `ℹ tests 1249`、`ℹ pass 1249`、`ℹ fail 0`；`node --test tests/mvp0` 7/7；`node --test --test-timeout=120000 tests/integration tests/e2e` `ℹ tests 412`、`ℹ fail 0`；`pnpm run boundaries` 退出 0；P3′ 输出 `read relations 2 -> 2 | refresh relations -> 9 | ci online 5 | ci offline 5 | stale true | degraded true`；48 条变异全部被杀死；`node scripts/rule-checks.mjs size feature/delivery-fact-writer` 代码 426 / 1000、文档约 590 / 1500（规划上限 800 / 1300），`disclosure` 与 `git diff --check` 退出 0，`node scripts/workflow-check.mjs` 退出 0。
- [x] (2026-10-08 09:20 CST) 最终验收（验收者 Claude Opus，`.worktrees/delivery-query-pure-read`）。对抗验证的复验没有产出，验收者在最终树上独立复跑并补测（第二轮的替代，不冒充第二轮）。
  - **复跑**（重构前的 `e57b191`）：`node_modules/.bin/tsc --noEmit` 无输出；`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` `ℹ tests 1249`、`ℹ pass 1249`、`ℹ fail 0`；`node --test tests/mvp0` 7/7；`pnpm run boundaries` `ℹ pass 8`、`ℹ fail 0`；`size`、`disclosure`、`git diff --check`、`workflow-check` 都退出 0。
  - **重构**（`refactor(core)` 提交，不改行为，Decision Log 第 23 行）：缺口并进算跳的循环；刷新命令的账本键复用 `normalizeScope`；controller-roundtrip 的交付用例共用组合辅助函数。重构后：`tsc` 无输出；全量 `ℹ tests 1249`、`ℹ fail 0`；#222 的验收命令 `node --test --test-timeout=120000 tests/integration tests/e2e` `ℹ tests 412`、`ℹ fail 0`、退出 0；`pnpm run boundaries` 退出 0；`tests/mvp0` 7/7；P3′ 输出 `read relations 2 -> 2 | refresh relations -> 9 | ci online 5 | ci offline 5 | stale true | degraded true`。
  - **变异**：A 系列 20 条全部被杀死，方法与清单见 `Validation and Acceptance` 变异表之后的「验收者复测」。
  - **先红复核**：把 PR-C 的源码（`feature/delivery-fact-writer`）与本 PR 的测试拼成导出目录，`纯读` ×2、`缺口` ×2、`唯一写者`、controller 的新用例共 6 条全红：纯读 ×2 红在 `TypeError: queries.getDeliveryProjection is not a function`，缺口 ×2 红在「从未刷新：四个位置都是 not_refreshed」，唯一写者红在「摄入只经刷新命令，查询不调用写者（#222）」，controller 用例红在 `refreshDeliveryFacts is not a function`。只给 PR-C 的源码补上 controller 的 `getDeliveryProjection` 转发一行后，纯读 ×2 红在「从未刷新：查询前后整库（实体、关系、交付事实、修订号、游标……）逐字不变」，`ℹ tests 2`、`ℹ fail 2`。
  - **探针**（导出目录，内存替身与 SQLite 各一遍，结果相同）：首次刷新、并发刷新与查询、无锚点的刷新之后，修订号不变；`Promise.allSettled` 交错的两次刷新与两次查询没有 reject；无锚点的刷新之后四个集合陈旧、`degraded` 为 true，恢复工作树句柄再刷新后四个集合不陈旧、`degraded` 为 false、`gaps` 为 `[]`；controller 以字符串作用域与 `{ workItemId, repositoryId: undefined }` 同键刷新，命中同一条账本记录。
- [x] (2026-10-08 09:20 CST) 验收文档回填：本计划的状态行、文件集合与 K6 的号段、B1 与变异表、Decision Log 第 23–24 行、Outcomes、Bottom Change Note（按时间重排并追加）；`docs/README.md` 的状态格。exec-plan 技能自带的 `lint_execplan.py` 通过。`node scripts/rule-checks.mjs size feature/delivery-fact-writer` 在 `refactor(core)` 提交上是代码 434、文档 592；本次文档提交只增加文档行，提交后的数字见 PR 正文的验证证据。
- [x] (2026-10-08 10:25 CST) 重新 rebase 到 PR-C 的规模收敛（C7）之上。执行上下文 `.worktrees/delivery-query-pure-read`；恢复锚点 `backup/delivery-query-pure-read-pre-shrink-rebase`（`4130084`）；`git rebase feature/delivery-fact-writer` 把 10 个提交从 PR-C 的 `d1fc382` 移到 `a256dda`。只做本地提交，不推送、不写 GitHub。
  - PR-C 的 C7 是行为不变的重排：完整性表、「唯一写者」并入重复刷新收敛、「乱序」七个变体并入「被放弃的刷新」、`readDeliveryProjection` 改用返回数组的 `hop` 组装跳。所以冲突都按「PR-C 的重排保留，本 PR 的语义改动落到重排后的位置」解决：
    - `docs/README.md`（5 个提交）：两行各取各自 PR 的最新版本。tracker（2 个）：本 PR 的 TD-045–TD-049 排在 PR-C 的 TD-050、TD-051 之前。`vertical-path.md` 第 10、11 行（2 个）：取本 PR 的版本，再套上 PR-C C7 把「失败不清空：离线」改指两条离线保留的那处改写。
    - `fix(core)` 交付查询只读（`delivery.ts`）：保留 PR-C 的 `hop` 结构，缺口一段按本提交原样加在跳之后；补回 PR-C C7 删掉的 `DeliveryFactSetKind` 导入（`DeliveryFreshness` 要用）。
    - 同一提交的 e2e：`ingest` 换成命令；把 PR-C C7 移出的四条既有用例里的 `await ingest` 行与「候选关系」那处替换补回；「被放弃的刷新」与「路由失败不清空」已在 PR-C 里合并，本提交对它们的改动落到「乱序」七个变体（断言刷新结果 `[ok, anchored, applied]` 是 `[commits, true, false]`，没有锚点的刷新什么也不写）与完整性表上（表本来就先刷新、再另调查询读投影）；「没有可提交的快照时」自动合并。
    - `fix(core)` 无锚点的刷新标陈旧：保留本提交新增的两条「无锚点的刷新」、第二条静态断言与「刷新结果不转发 provider 文字」；「重复刷新收敛」新增的 K1 断言（首次、标陈旧、没有锚点的刷新都不推进修订号）并入「唯一写者」；「被放弃的刷新」新增的标陈旧断言落到「乱序」七个变体的无锚点部分。
    - `refactor(core)` 缺口与跳同一趟遍历：原来的合并循环建立在 `push` 闭包上，按 PR-C 的结构重写为 `missing(found, kind, reason)`：它记下缺口并原样返回这一位置的跳，于是缺口仍在算跳的同一趟里记，四个集合只查一次快照，顺序与原因不变。这个提交另做一次 `--amend`（提交信息不变），后面的文档提交重新 cherry-pick。
  - 验证（`49ff0ae` 之上，最后的文档提交之前）：`tsc --noEmit` 无输出；全量 `tests/contract tests/integration tests/e2e` 1237/1237（重新 rebase 前 1249，差的 12 条正是 PR-C C7 合并掉的用例）；`tests/mvp0` 7/7；`pnpm run boundaries` 8/8；#222 的验收命令 `node --test tests/integration tests/e2e` 404/404、退出 0。规模（观察时刻，`node scripts/rule-checks.mjs size feature/delivery-fact-writer`）：代码 439 / 1000（重新 rebase 前 434），文档 609 / 1500。`git diff --check feature/delivery-fact-writer...HEAD` 无输出；`node scripts/rule-checks.mjs disclosure feature/delivery-fact-writer` 通过。重新 rebase 前后本 PR 改动的文件集合（相对各自的 PR-C）用 `comm` 比对，完全相同。
  - 变异：验收者的 A 系列 20 条在 `git archive` 导出（`49ff0ae`）上重做，5 条按新代码等价改写了锚点：A-G1 改在 `missing` 的函数体上；A-G5、A-G6 去掉执行上下文、工作树那两个位置外面的 `missing(...)`；A-G7（集合的缺口在看到自己的跳之前判断）改成「集合位置一律记缺口」；A-G9 改在集合原因表达式上。20 条全部恰好改动一处（一个 hunk）并变红；用 `/bin/cp -f` 还原后 `cmp` 一致，复跑全绿。基线 50 条（重新 rebase 前 58 条，差的 8 条是 PR-C C7 合并掉的 e2e 用例）。导出目录已删除。
- [x] (2026-10-08 11:40 CST) 对抗验证第二轮（在 `101305e` 上，独立验证者，只读）的处置，以及 PR-C 第四轮留下的五条 P3 断言。执行上下文：检出 `fix/delivery-query-pure-read` 的工作树根目录；恢复锚点 `backup/delivery-query-pure-read-pre-fix-rebase`（`101305e`）；先 `git rebase feature/delivery-fact-writer` 到 PR-C 的 C8（只改文档，无冲突），再提交。不推送、不写 GitHub。
  - 方法：先在重新 rebase 后的树 `30db4b1` 的 `git archive` 导出上跑每条点名变异，确认它们存活（存活即没有判别断言），再补断言，最后在 `d69246e` 的导出上整表重做（变异表之后的「对抗验证第二轮之后的变异」一段）。发现 P2-1 与 P3-1、P3-2 的实现本来就对，缺的是断言，所以它们先「存活」而不是先「红」；只有 P3-5 是实现缺陷，先红后绿。
  - 处置：

    | 发现 | 处置 | 判别证据 |
    |---|---|---|
    | P2-1 无锚点分支的乱序守卫没有判别用例（S16 全绿） | 属实。新增「乱序（内存替身 / SQLite，没有锚点的较旧刷新）」：较旧的无锚点刷新 U 读到没有句柄的上下文后挂起（包装 `getExecutionContext`），期间句柄恢复、较新的有锚点刷新 R 提交，放行 U；断言 U 的 `[ok, anchored, applied]` 为 `[true, false, false]`，已提交的快照逐字不变（`attemptedAt` 不倒退，四个集合不陈旧） | S16：修复前存活，修复后 2 条红 |
    | P3-1 标陈旧那一步的事务失败 | 属实。新增「无锚点标陈旧失败（内存替身 / SQLite）」：controller 命令 `writeState` 为 `failed`，`value` 的 `ok / anchored / applied` 都是 false，结果里没有异常原文，快照原样 | S20：修复前存活，修复后 2 条红 |
    | P3-2 字符串作用域与重放键 | 属实。controller-roundtrip 新增归一用例：字符串、`{ workItemId }`、`{ workItemId, repositoryId: undefined }` 命中同一条账本记录，字符串作用域不是 `invalid_input` | S10、S4：修复前存活，修复后 2 条与 1 条红 |
    | P3-3 `freshness` 顺序 | 属实。「无锚点的刷新」×2 断言四个集合的固定顺序 | FRESHORDER：存活 → 3 条红 |
    | P3-4 重复的无锚点刷新前移 `attemptedAt` | 属实。「无锚点的刷新」×2 再刷新一次，断言 `attemptedAt` 严格更晚、其余字段不变 | ADVANCE：存活 → 2 条红 |
    | P3-5 缺失的作用域同步抛 `TypeError` | 属实，先红后绿。`refreshDeliveryFacts(undefined)` 在 core 与 controller 上都是 `TypeError: Cannot read properties of undefined (reading 'workItemId')`。修：`normalizeScope` 一行（Decision Log 第 25 行）。「空工作项」与 controller 归一用例断言：缺失的作用域与空工作项同形（`ok: false`、`anchored: false`、`applied: false`、`invalid_input`），查询同样 | 修复前两条红；NULLSCOPE 修复后 2 条红 |
    | P3-6 从未刷新又无锚点的上下文，刷新后无可见变化 | 属实，不修。TD-046 补一句；「刷新结果与快照时刻」断言刷新前后的投影逐字相同，把当前行为钉住（Decision Log 第 28 行，不新开号） | NOSNAP：6 条红 |
    | P3-7 文档漂移 | 属实。ADR-0011 第 3、5、9 条补无锚点情形（Decision Log 第 27 行）；Design 里写明 `freshness` 从未刷新时是 `[]`；TD-049 的说明改成修订发生在 PR-C | exec-plan 技能自带的 `lint_execplan.py` 通过 |
    | （PR-C 第四轮）令牌的墙钟项没有用例 | 新增「读取开始时刻的墙钟项」：第一次刷新的 `attemptedAt` 等于注入时钟的读数 | WALL：存活 → 1 条红 |
    | （PR-C 第四轮）从未开始工作的作用域不降级没有断言 | 两条「负向」加 `degraded === false`。在本 PR 的语义下 D-M10 本来就被「没有可提交的快照时」杀死，直接断言让「负向」用例自己也能杀死它 | NEGDEG：修复前 1 条，修复后 3 条红 |
    | （PR-C 第四轮）替身 upsert 谓词没有用例 | 「两个上下文共享同一头提交」加显式的「两个上下文各一行」断言。本来就被该用例杀死（第二个上下文的写入覆盖第一个，读不到第一个的快照），显式断言让杀手是有意的 | UPSERT：修复前后都是该用例 |
    | （PR-C 第四轮）SQLite 读回节点顺序没有断言 | 两条离线保留的读回前置加顺序断言（`run-1, run-2, check-build, check-lint, check-test`，即 provider 返回的顺序） | ORDER：存活 → 1 条红（SQLite 那条） |
    | （PR-C 第四轮）从未确认的集合 `confirmedAt` | 「没有可提交的快照时」加 `freshness` 断言：只有流水线集合没有确认时刻。本来就被 `unconfirmed` 缺口间接杀死 | CONFAT：修复前后都是该用例 |
    | （PR-C 第四轮）空集合遇提交失败仍标陈旧没有断言 | 新增「提交失败：完整读到的空集合同样标陈旧」 | EMPTYSTALE：存活 → 1 条红 |
    | （PR-C 第四轮）手写行里的 JSON `null` 不再归一 | 不适用，维持 S30 | 无 |

  - 验证（`d69246e` 之上，文档提交之前；检出 `fix/delivery-query-pure-read`）：`node_modules/.bin/tsc --noEmit` 无输出；`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` `ℹ tests 1244`、`ℹ pass 1244`、`ℹ fail 0`（重新 rebase 时是 1237，净增 7 条新用例）；`node --test tests/mvp0` 7/7；`pnpm run boundaries` `ℹ pass 8`、退出 0；#222 的验收命令 `node --test tests/integration tests/e2e`（不带 `--test-timeout`）退出 0，`ℹ tests 411`（带 `--test-timeout=120000` 同为 411/411）；`node scripts/workflow-check.mjs` 无发现；P3′ 输出 `read relations 2 -> 2 | refresh relations -> 9 | ci online 5 | ci offline 5 | stale true | degraded true`，另一条探针 `refreshDeliveryFacts(undefined)` 输出 `[false,false,false,"invalid_input"]`。规模（观察时刻，文档提交之后，`node scripts/rule-checks.mjs size feature/delivery-fact-writer`，S28 同款口径）：代码 541 / 1000（规划上限 800），文档 691 / 1500（规划上限 1300）；`disclosure` 与 `git diff --check feature/delivery-fact-writer...HEAD` 通过。
- [x] (2026-10-09 CST) Batch D3 的其余部分，由协调者在人类评审前后做（已完成：整合为规划 / 代码 / 回填归档三个提交、精确 lease 推送、归档；合并由评审会话按人类伙伴的直接授权进行）：发布面扫描、整合提交（红用例与修订提交并入交付物提交）、`comm` 比对文件集合、建 backup ref 后精确 `--force-with-lease` 推送；人类评审后把本计划移到 `docs/exec-plan/completed/` 并更新 `docs/README.md`。
- [x] (2026-10-08 CST) 协调者（验收）：修复本身的独立复评 pass（无 P0 / P1 / P2，`range-diff` 证实上一次 rebase 只换了基）。按其 P3 处置三项：「乱序（没有锚点的较旧刷新）」断言闸门生效（变异「闸门不挂起」生效后 2 条红，还原后复绿）；`unavailableCore` 的交付查询改走 `normalizeScope`，「core 不可用」用例补缺失作用域断言（变异「恢复直接读 `scope.workItemId`」生效后 1 条红，还原后复绿）；ADR-0011 第 3 条的降级事务改为「读取或提交失败后」（与 PR-C 同步订正）。BigInt `workItemId` 让 controller 的重放键同步抛错，越过类型契约，不处理。先在 PR-C 的文档订正上重新 rebase（恢复锚点 `backup/delivery-query-pure-read-pre-p3-rebase`），冲突只在 ADR-0011 同一句。

- [x] (2026-10-08 19:55 CST) 随 PR-C 的批次 C9 重新 rebase 到含 #295 / #289 的 main 之上。执行上下文：检出 `fix/delivery-query-pure-read` 的工作树根目录；恢复锚点 `backup/delivery-query-pure-read-pre-main-rebase`（旧 head `84fbdea`）；`git rebase --onto feature/delivery-fact-writer 7fef195 fix/delivery-query-pure-read`（`7fef195` 是 PR-C 的旧 head），本分支的三个提交逐个重放。只做本地提交，不推送、不写 GitHub。
  - 冲突（Decision Log 第 30 行）：规划提交与回填提交在 `docs/README.md` 的索引（取 PR-C 的新行与本 PR 的行）；代码提交在 `tests/e2e/delivery-lineage.test.js`「没有可提交的快照时」的首次读不完一段（取 PR-C 的 `endless` 注入，保留本 PR 的「先刷新、再另调查询」）；回填提交在 `vertical-path.md` 第 10、11 行（取本 PR 的两行，第 10 行里 PR-C 写的「分页截断」按 PR-C 的 C9 改成「分页读不完」）。其余文件自动合并，产品代码没有冲突。
  - 适配（Decision Log 第 29 行，Surprises 末条）：rebase 后全量 1353 条里 8 条红，都在 main 新增的两份 CI 集成测试（`delivery-pages-complete` 5 条、`github-actions-ci-facts` 2 条）与随之变红的「真实层 tests/integration」守卫。两份文件各加一个组合根包装，每次交付读取先调 `commands.refreshDeliveryFacts` 再读；改后两份文件 10/10。
  - 绿：`node_modules/.bin/tsc --noEmit` 无输出；全量 `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 1353/1353；`tests/mvp0` 7/7；`pnpm run boundaries` 8/8；#222 的验收命令 `node --test tests/integration tests/e2e` 带与不带 `--test-timeout` 都是 459/459、退出 0；P3′ 输出 `read relations 2 -> 2 | refresh relations -> 9 | ci online 5 | ci offline 5 | stale true | degraded true`。
  - 变异：在 `git archive HEAD` 的导出上，点名文件（`tests/e2e/delivery-lineage.test.js`、`tests/e2e/controller-roundtrip.test.js`、`tests/e2e/status-policy.test.js`、`tests/mvp0`，`--test-timeout=20000`，基线 57 条）跑 A 系列 20 条、N-F6a–N-F6g 7 条与对抗验证第二轮之后的 14 条（S16、S20、S10、S4、NULLSCOPE、WALL、ORDER、EMPTYSTALE、FRESHORDER、ADVANCE、NOSNAP、NEGDEG、UPSERT、CONFAT），查找文本按当前代码重写（前一轮的规格文件没有留存，语义按本计划的文字描述）。每条先 `cmp` 与 `git diff --no-index -U0` 证明生效，`/bin/cp -f` 还原后 57/57。41 条全部变红，各 1–12 条。另在两份集成测试上（基线 10 条）跑 3 条：#295 的 `collectDeliveryPages` 读完第一页就返回（4 条红）、两个包装各去掉刷新（5 条、2 条红），证明包装承重、两条在纯读下会空转的用例（「checks 第二页故障」「首屏 429/5xx」）重新有判别力。导出目录已删除。
  - 规模（提交之后量）：`node scripts/rule-checks.mjs size feature/delivery-fact-writer` 代码不超过 800（观察值见 Outcomes 的重新 rebase 部分）。

- [x] (2026-10-08 22:05 CST) rr：随 PR-C 的批次 C10 再 rebase，并处理 rebase 之后独立对抗验证留给本 PR 的三项。执行上下文：检出 `fix/delivery-query-pure-read` 的工作树根目录；恢复锚点 `backup/delivery-query-pure-read-pre-rr`（旧 head `655e0eb`）。只做本地提交，不推送、不写 GitHub。
  - rebase：`git -c core.commentChar=';' rebase --onto <PR-C 新 head> <PR-C 旧 head `5e224ca`> fix/delivery-query-pure-read`，五个提交逐个重放；两个正文第 3 行以 `#` 开头的提交（代码提交与「两条 CI 集成测试」提交）在 `commentChar=';'` 下保留原行，`diff <(git log --format=%B -1 旧) <(git log --format=%B -1 新)` 对五个提交都无输出。冲突只在规划提交与回填提交的 `docs/README.md` 索引、回填提交的 `vertical-path.md` 第 10、11 行，按 Decision Log 第 31 行解决；`git range-diff` 显示两个代码提交与两份文档以外的部分逐字相同。rebase 后全量 1349/1349（之前 1353，PR-C 删去四条时钟变体）。
  - 负向用例零调用（Decision Log 第 32 行）：在 rebase 之后、改动之前的导出上，变异 HOW 全量 `ℹ fail 0`（基线 1348 条，跳过那一条 CLI 用例）；「负向：未创建执行上下文时」补 `recordProviderCalls` 与「刷新对 Development 与 Delivery 零调用」断言之后，HOW 全量 2 条红，还原后复绿。
  - 集成包装（Decision Log 第 33 行）：改动之前，I6 在两份集成测试上 `ℹ fail 0`（基线 10 条）；包装断言刷新结果的 `error` 为 `undefined` 之后，I6 在集成层 5 条红，还原后复绿。单行包装拆成 7 行的块。
  - Surprises 末条：空转的是三条，补上 `github-actions-ci-facts` 的「未观察锚点时 adapter 收到零请求」与 I2b、I2b-nowrap 的证据（Validation 的 rr 表）。
  - 变异整表（最终树的导出，每条先 `cmp` 与 `git diff --no-index -U0` 证明生效，`/bin/cp -f` 还原后 `cmp` 一致并复跑全绿）：点名文件命令（`tests/e2e/delivery-lineage.test.js`、`tests/e2e/controller-roundtrip.test.js`、`tests/e2e/status-policy.test.js`、`tests/mvp0`，`--test-timeout=20000`，基线 53 条，之前 57 条，差的是 PR-C 删去的四条时钟变体）跑上一轮的 41 条加 HOW 与 K1（PR-C 的 K1，与 WALL 同义），43 条全部变红，各 1–8 条；PR-C 删去时钟变体没有让任何一条失去杀手。集成层（基线 10 条）跑上一轮的 3 条（两条 INT-WRAP 按新包装改写查找文本，语义仍是「包装不再刷新」）加 I6、I2b、I2b-nowrap，6 条全部变红。导出目录在本批结束时删除。
  - 绿：`node_modules/.bin/tsc --noEmit` 无输出；全量 `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 1349/1349；`tests/mvp0` 7/7；`pnpm run boundaries` 8/8；#222 的验收命令 `node --test tests/integration tests/e2e` 带与不带 `--test-timeout` 都是 455/455、退出 0；P3′ 输出 `read relations 2 -> 2 | refresh relations -> 9 | ci online 5 | ci offline 5 | stale true | degraded true`；`node scripts/workflow-check.mjs` 无发现；`disclosure` 与 `git diff --check`（base 都是 `feature/delivery-fact-writer`）通过；`lint_execplan.py` 输出 `OK`。规模（提交之后量，`node scripts/rule-checks.mjs size feature/delivery-fact-writer`）：代码 570 / 1000（规划上限 800），文档以提交后的输出为准。
  - K3：PR-C 的人类裁决（PR-C Decision Log 第 44、45 行）改为由 #297 单独接线；本 PR 仍不碰 `chain-facts.ts` 的路由缝，计划里写「后合并者 / PR-C 接线」的三处就地标 Superseded。

- [x] (2026-10-09 00:20 CST) r1：#293 第一轮 MMP 评审（Singularity-AI-Bot，review 5459001209，1 × P2、5 × P3）的修复轮，以及协调者调研后的决定与人类伙伴的两次裁决。执行上下文：检出 `fix/delivery-query-pure-read` 的工作树根目录；恢复锚点 `backup/delivery-query-pure-read-pre-r1fix`（`ddb20ff3`）；只做本地提交，不推送、不写 GitHub。逐条处置见 `docs/review/pr-293-mmp-review.md` 的「修复轮」。
  - rebase：随 PR-C 的 C11 用 `git -c core.commentChar=';' rebase --onto` 换基，三个冲突（e2e 两处、tracker、矩阵第 10 行）按 Decision Log 第 46 行解决，换基后 `tsc --noEmit` 无输出、交付相关的 6 个文件 64/64。
  - 红：先改测试再改实现，`delivery-lineage` 与 `controller-roundtrip` 46 条里 4 条红：刷新命令同一请求第二次返回首次的对象（两条，重放账本）；时钟回拨后 `confirmedAt` 读回 `2026-10-08T00:00:02.002Z`，期望 `2000-01-01T00:00:00.000Z`；读回 `2031-01-02T03:04:05.679Z`（令牌），期望 `2030-06-01T00:00:00.000Z`。T17 变体与 `.putRelation(` 静态断言守的是已有行为，修复前就是绿的，判别力见变异。绿：46/46。
  - 变异：Validation 的「#293 第一轮评审之后的变异」表，主表 49 条、集成层 6 条全部被杀死。
  - 绿（代码定稿之后，工作树）：`tsc --noEmit` 无输出；全量 `tests/contract tests/integration tests/e2e` 1458/1458；`tests/mvp0` 7/7；`pnpm run boundaries` 8/8；#222 的验收命令 563/563、退出 0；P3′ `read relations 2 -> 2 | refresh relations -> 9 | ci online 5 | ci offline 5 | stale true | degraded true`。规模：代码 630 / 1000（规划上限 800），文档见本批提交后的输出。
  - 外部写入：没有。#234、#281 的验收框与 #233 的验收框由协调者写入（Decision Log 第 38、40 行）。

- [x] (2026-10-09 01:42 CST) rr2：#293 复评轮（Singularity-AI-Bot，APPROVE，4 条 P3）与 #292 复评轮留给本层的判别用例。执行上下文：检出 `fix/delivery-query-pure-read` 的工作树根目录；恢复锚点 `backup/delivery-query-pure-read-pre-rr2`（旧 head `9ba1af5f`）；只做本地提交，不推送、不写 GitHub。逐条处置见 `docs/review/pr-293-mmp-review.md` 的「复评轮」。
  - rebase：PR-C 先做了 C12（`f32488ec`，Progress C12），本分支用 `git -c core.commentChar=';' rebase --onto f32488ec bb3ef949 fix/delivery-query-pure-read` 重放，没有冲突，`git range-diff` 显示三个提交逐一 `=`；换基后 base 指向 PR-C 的新 head。
  - 判别用例（Decision Log 第 47 行）：完整性表新增「变更请求页形非法」，放在这里是因为 PR-C 的代码桶 800 已在规划上限；只合并 #292 时这一格没有用例。变异 R1（撤掉查找谓词的 `Array.isArray(page.items)`）在 PR-C 单独存活，在本分支 2 红（两条离线保留），断言消息「变更请求页形非法：不完整的读取不得删除、增补或改写已确认的 CI 事实」，actual 少了三条检查事实；还原后 36/36。`delivery-lineage` 完整性表的表头注释补上变更请求页形非法的归属（一行换一行）。
  - P3 `commands.ts:2`、`commands.ts:8`：模块头补上刷新命令的例外：除 `refreshDeliveryFacts` 外每条命令都带 actorRef 与 idempotencyKey；刷新天然幂等，只带 actorRef，不带键、不进账本；第 8 行的「同键重放」加「刷新除外」。只改注释，一行换一行。
  - P3 ADR-0011 转为 Accepted 之后残留的旧说法：`docs/README.md:28` 状态列的「ADR-0011 仍是 Proposed」、TD-009 末尾的「（目前是 Proposed）」、TD-014 末尾的「人类不采纳时本项重新开放」改成已 Accepted（2026-10-09，来源 Decision Log 第 39 行），TD-014 维持 Superseded；TD-049 的范围改成「改了第 3、5、7（前半，令牌的定义）、8、9 条与 Rejected 表，第 7 条末句未动」，与 ADR 的实际 diff 一致。PR-C 的旧记录（它自己的计划与 Outcomes 里「ADR-0011 Proposed」）是带时间的历史，保留。
  - P3 #134：ADR-0011 的 Consequences 改成「#234、#281 的打开与手动刷新调用同一个命令；定时、节流与合并由宿主或调度器持有，本 ADR 不规定调度」；「与相邻工作的接口」里的 #134 条目标 Superseded by 第 40 行并改写承接方；Outcomes 遗留条加订正尾注（Decision Log 第 48 行）。
  - P3 第 37 行的理由：原理由写「会破坏「纯读」用例的整库逐字比较」，不对：那条用例比较的是存储转储（`dump(storage)`），读时算出的字段不落库。真正受影响的是比较投影本身的断言（controller-roundtrip「三种写法读到同一个投影」的 `deepEqual`、delivery-lineage「刷新结果与快照时刻」里刷新前后投影的 `deepEqual`）与查询结果的确定性。理由就地订正，决定不变。
  - 变异：本分支的 `git archive` 导出（代码提交 `6bb66826`；最终 head 的导出上复跑，结果相同），点名文件 8 个，基线 250 条：H5 2 红、B2 2 红、T11 1 红、T17 4 红、G1 1 红、R1 2 红，全部变红（见 Validation 的「复评轮之后的变异」）；每条改动只落在一处，还原后逐字相等。导出目录在本批结束时删除。
  - 绿与规模：`node_modules/.bin/tsc --noEmit` 无输出；全量 `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 1458/1458（条数不变：新行是参数表的一行，不增用例）；`tests/mvp0` 7/7；`pnpm run boundaries` 8/8；#222 的验收命令 `node --test tests/integration tests/e2e` 带与不带 `--test-timeout` 都是 563/563、退出 0；P3′ 输出 `read relations 2 -> 2 | refresh relations -> 9 | ci online 5 | ci offline 5 | stale true | degraded true`；`node scripts/workflow-check.mjs` 无发现；`disclosure` 与 `git diff --check`（base 都是 `feature/delivery-fact-writer`）通过；`lint_execplan.py` 输出 `OK`。规模（提交之后量，`node scripts/rule-checks.mjs size feature/delivery-fact-writer`）：代码 637 / 1000（规划上限 800；r1 是 630，加 7：模块头两行各一换一、完整性表一行加表头注释一换一），文档 920 / 1500。

## Surprises & Discoveries

- **P3 原命令在本 PR 之后失去意义**。PR-D 原型上，它的输出是 `relations 2 -> 2 | ci online 0 | ci offline 0 | degraded true`，因为查询不再摄入。所以 P3 要原地标注，并换成先刷新再读的 P3′。
- **`ingest` 的返回值不能当投影**。PR-C 原型的第一版里，有几条用例写成 `const online = await ingest(...)`。把 `ingest` 换成命令之后，它们全部以 `Cannot read properties of undefined (reading 'filter')` 失败，因为命令返回的是刷新结果。PR-C 的计划因此写明「一律另调查询读投影」，这样本 PR 才能只改一行。
- **刷新命令的变异锚点会落到别的命令上**。`commands.ts` 里，`bootstrapWorkspace` 与刷新命令用的是同一行 `resultOf(result.ok ? CommandWriteState.LocalOnly : CommandWriteState.Failed, result, result.error)`。按第一次出现替换时，变异实际改的是 `bootstrapWorkspace`，于是 D-M4「存活」。锚点带上 `core.commands.refreshDeliveryFacts(scope)` 后，D-M4 被杀死。
- **首读纯读用例靠关系与快照见红，不靠修订号**。在 PR-C 的 head 上首读，修订号也不变，因为写者遵守 K1。#222 验收 1 的「修复前失败」由关系从 2 变成 9、快照从无到有来承担。
- **原型的基线早于 PR-C 的最终 head**（D0 回读）。原型叠在 PR-C 的原型上，那时 `getDeliveryProjection` 只有「刷新、读、并缺口」三步，快照没有 `anchorId`，也没有刷新结果驱动的逐跳标陈旧。PR-C 经三轮对抗验证（C4–C6）之后，过渡形态变厚（见 Context 表第 56 行），`readDeliveryProjection` 按集合的 `anchorId` 取边。所以原型补丁只当参考：实现按真实 head 重写，测试逐条按真实 head 的用例调整。
- **`ingest` 的返回值在 PR-C 的 head 上有 11 处被用到**，与 PR-C 计划「一律另调查询读投影」的约定不符。其中 2 处读的是刷新结果的 `error`（`失败不清空`、`提交失败`），换成命令后仍成立；其余 9 处把它当投影用（`.hops` / `.degraded` / `ciFacts(...)`）：`完整空集合才删除：变更请求…`、`被放弃的刷新`（`dropped`、`unanchored`）、`路由失败不清空`（三处）、`没有可提交的快照时`（`failed`、`truncated`、`blind`）。换成命令后，这 9 处会以 `Cannot read properties of undefined` 失败。处置：改成「先调刷新命令，再另调查询读投影」，断言内容不变，只是读取的对象换成查询结果。例外是「被放弃的刷新」：纯读之后，查询看不到刷新结果，所以那一层改读刷新结果的 `applied` / `anchored`，并断言快照没有被改写（见下一条）。
- **纯读之后，「没有锚点的刷新」不再把旧快照标陈旧**。PR-C 的过渡形态在 `anchored: false` 且仍显示旧快照时逐跳标陈旧，这是查询用刷新结果算出来的，不落库；写者在没有锚点时什么也不写（`刷新结果与快照时刻` 用例固定了这一点），所以纯读只能看到上一次提交的快照，不陈旧。PR-C 的 Decision Log 第 27 行预先接受了这一点：这一层随查询对刷新的调用一起删除，由刷新结果的 `applied` / `anchored` 承接。本 PR 不改写者的规则，所以：调用方要从刷新命令的结果知道「这次没能确认」，查询只反映已提交的 `stale`。登记为 TD-047（见 `Interfaces and Dependencies` 末尾）。（Superseded by Surprises 第 9 条与 Decision Log 第 16 行（2026-10-08）：对抗验证复现这是 PR-C 第三轮 S25 的复发，改在写者里补，TD-047 已解决。）
- **PR-C 的收尾另留一条债务给 TD-045**：PR-C 计划的「遗留」写着「号段用完，待协调者分配 TD-045：查询读半边的存储异常原样 reject、写者 `catch` 没有内部诊断」（PR-C Decision Log 第 28 行）。本计划的 TD-045 已被「没有定时刷新」占用（K6 把 TD-045–TD-049 预分配给 PR-D）。处置：PR-C 那条用本计划号段里的 TD-048 登记，并在 Decision Log 记一行；TD-047–TD-049 不再是「不用、不预留」。（重新 rebase 订正：PR-C 的 C7 把那句改成这两条不在 PR-C 另占号，另用 TD-050、TD-051 登记了共享头部提交与令牌平手两条；TD-048 仍是这两条唯一的 tracker 行。）
- **纯读删掉的那一层，正是 PR-C 第三轮对抗验证刚修好的 P2（S25）**（对抗验证第一轮，F6）。同一探针在 PR-C 的 head 上输出 `degraded true`、`provider_read` 跳陈旧 7/7，在 PR-D 上输出 `degraded false`、陈旧 0/7。PR-C 当时为了不让旧快照被当成最新，在查询里加了 `unconfirmed`；#222 把查询里的刷新删掉，这一行跟着没了，而写者在没有锚点时什么也不记。根因不在查询，在写者没有记下「这次没能重新确认」；提交失败那条路径早就这样做了。修法与它共用 `markStale`，见 Decision Log 第 16 行。ADR-0011 第 5 条「不完整的集合原样保留，只标 `stale`」与第 9 条「没有锚点而仍显示旧快照时，逐跳标陈旧并报降级」因此重新成立。
- **`ingest` 换成命令之后，两条具名负向用例空转了**（F5）。「负向：锚点未观察时」与「负向：未创建执行上下文时」只调查询；PR-C 的 head 上查询会触发写者，现在查询不能写，「0 跳、0 条关系」是恒真。同一个变异（N37：链读取把没有句柄的上下文当作已观察、写者守卫移除）：PR-C 的 head 上 5 条变红且含这两条，对抗验证前的 PR-D head 上 3 条且不含，补回 `ingest` 之后 10 条且含。教训：换掉用例的触发方式时，要对每条具名的失败路径用例重算杀伤集，而不是只看全绿。
- **刷新结果的 `gaps` 第一次把 provider 文字送到 wire**（F7）。`readChainFacts` 的 `CapabilityGap.reason` 取自 `error.message`；PR-C 里它只用来算布尔 `degraded`，PR-D 的刷新命令把它放进了 controller 的 `CommandResult.value`。真实的 planning provider 用固定词表，所以现在不是活的泄露，但 K2 与 TD-046 都写着不让 provider 文字进 wire。`chain-facts.ts` 不在本 PR 的文件集（K3、K4 的接缝），所以在写者出口收窄成只带能力键。
- **「纯读」原先只证明了三项**（F3）：关系、修订号、一行快照，外加四个具名的读方法。实体写入（#221 的 SQLite 缺陷就是实体 / 外键问题）、游标、`describeCapabilities` 这类调用都不在里面；变异 N3、N4 存活。改成整库快照（SQLite 读每张表）与全部 provider 方法后被杀死。
- **变异执行器的三处自查**。N4b（查询把同一条执行上下文再 `put` 一次）是等价变异——整库快照不变——所以换成 N4c（查询推进修订号）；N37 单独改 `chain-facts.ts` 也是等价变异：写者的无锚点守卫在它之前返回，必须两个文件各改一处才能表达「同名分支制造工作树谱系」；N-F8b 最初存活，因为重放账本的用例只换了工作项，没换仓库，补了同一工作项、另一个仓库的作用域之后被杀死。
- **半提交的上下文刷新后 `degraded` 为 false**（F4）。开始工作的最终事务失败（TD-009）时，`execution_context` / `worktree` 缺口的原因是 `not_observed`，刷新不补写命令边，投影的 `degraded` 只看快照新鲜度。PR-C 的 head 上同一场景也是 false，不是本 PR 引入的退化；取舍见 Decision Log 第 17 行。
- **收紧后的「纯读」在 PR-C 上红的原因变了**（验收）。D1 记下的红信息是「首读前后关系、修订号与交付事实逐字不变」；对抗验证之后，用例在比较整库之前先把 core 与 controller 的三个查询都跑一遍，而 PR-C 的 controller 没有 `getDeliveryProjection`，于是先以 `TypeError` 变红，到不了整库断言。红仍然成立，但它证明的是「缺 controller 转发」，不是 #222 验收 1。只给 PR-C 的源码补上这一行转发后，两条都红在整库断言上，验收 1 的「修复前失败」才由最终版用例本身证明（Progress 验收行）。教训：收紧一条先红用例之后，要在修复前的源码上重跑，确认它仍然红在原来要证明的那条断言上。
- **PR-C 的规模收敛把本 PR 的几处语义改动推宽了**（重新 rebase）。PR-C 把「被放弃的刷新」并成「乱序」的第七个变体，并让七个变体都断言被放弃与没有锚点的刷新；本 PR 对它的语义改动（刷新结果说明没有提交、没有锚点的刷新把快照标陈旧）随之从一个两对象场景扩到七个时钟与提交组合上。完整性表在替身与 SQLite 上各跑一遍，并且先经命令刷新、再另调查询读投影，所以 `ingest` 换成命令后不用改。被合掉的旧用例名与新用例的对应见 PR-C 计划的 S31。
- **共用一个函数的两条调用路径，守卫只有一条被钉住**（第二轮 P2-1）。`markStale` 抽出后，无锚点和提交失败两处共用它，乱序守卫在函数里；但「乱序」七个变体里只有提交失败那一路让较旧的刷新抢在较新的提交之后，没有一个变体让**无锚点**的较旧刷新这样做。把无锚点分支的 `await markStale(...)` 换成不带守卫的内联事务（S16），全量仍绿。同一批里还有 S20（吞掉异常）、S10 / S4（字符串作用域）、墙钟项、读回顺序、空集合、freshness 顺序、重复前移，共 9 条变异在 `30db4b1` 上存活，补断言后全部被杀死。教训：重构把两条路径合并成一个函数时，要对每条调用路径各写一个会让守卫变红的用例，而不是只在一条路径上证明函数。
- **`normalizeScope` 先于写者，缺失的作用域同步抛 `TypeError`**（第二轮 P3-5）。`core.commands.refreshDeliveryFacts(undefined)` 与 controller 的同名命令都抛 `TypeError: Cannot read properties of undefined (reading 'workItemId')`，而且是同步抛，不是 reject；Decision Log 第 21 行的「写者承诺不裸抛」只在 `workItemId` 不是字符串时成立，没有覆盖整个作用域缺失。修在 `normalizeScope` 一处（Decision Log 第 25 行），因为 core 命令、controller 账本键和查询都经过它。
- **PR-C 第四轮的六条 P3 里，三条在本 PR 的语义下已被间接杀死**。负向降级（D-M10）、替身 upsert 谓词、从未确认集合的 `confirmedAt`，在 `30db4b1` 上分别被「没有可提交的快照时」「两个上下文共享同一头提交」「没有可提交的快照时」杀死：本 PR 的缺口原因把「上下文记录是否存在」和「集合是否确认过」暴露成了可断言的输出。墙钟项、读回顺序、空集合遇提交失败才是真缺口（WALL、ORDER、EMPTYSTALE 存活）。三条间接被杀死的仍补了直接断言，让杀手是有意的，不是巧合。
- **负向用例的「没有锚点就不读」只看存储结果**（rr，独立对抗验证）。「负向：未创建执行上下文时」断言的是刷新结果、投影与关系表；写者在没有锚点时提前返回，链读取即使把没有句柄的上下文当作有工作树、照样去读同名分支、变更请求与 CI，存储结果也不变。变异 HOW（`hasObservedWorktree` 恒真，代码在 PR-C 的 `chain-facts.ts`）在本 PR 的全量下存活；用例补 `recordProviderCalls`，断言刷新期间 `development.*` / `delivery.*` 调用为 0 之后被杀死。测试放在本 PR：PR-C 的代码桶是 800，「未观察锚点零请求」也是本 PR 纯读的一部分。
- **集成层看不出刷新把缺口报成失败**（rr，独立对抗验证 I6）。两份集成测试的刷新包装只调刷新、不看结果：变异 I6（刷新成功路径在有缺口时带结构化错误）在两份文件上存活（只有 e2e 的两条离线保留杀死它）。包装改成断言刷新结果的 `error` 为 `undefined` 之后，I6 在集成层变红 5 条。provider 读不全是缺口而不是失败，这是 ADR-0011 第 5 条与 K2 的约定，集成层现在也钉住它。
- **main 的两份 CI 集成测试在纯读下有两种坏法**（重新 rebase）。#295 的 `delivery-pages-complete` 与 #289 的 `github-actions-ci-facts` 经查询读 provider 的结果：纯读之后，需要请求账本或事实的 7 条变红；另有两条（「checks 第二页故障」「首屏 429/5xx」）只断言降级与没有事实，而从未刷新的投影本来就降级、没有事实，于是空转变绿。补刷新命令同时修好两种，空转的两条由 #295 守卫的变异（读完第一页就返回）证明重新有判别力。（rr 订正：空转变绿的是三条，第三条是 `github-actions-ci-facts` 的「未观察锚点时 adapter 收到零请求」：纯读的查询本来就不调用 provider，零请求恒真。证据是变异 I2b（未观察锚点时用合法的 40 位 SHA 读流水线）：在刷新包装下它让这条用例变红（同时变红的还有 `delivery-pages-complete` 的「未观察的锚点不发出任何 Delivery 请求」）；同一变异再去掉 `github-actions-ci-facts` 的包装（I2b-nowrap），这条用例就不在变红之列。`delivery-pages-complete` 的同名用例后半段要求「有提交无变更请求时只读流水线」，纯读下会红，所以不算空转。）
- **墙钟改动之后，T17 也被「较旧的读取提交成功」杀死**（r1）。T17 让事务内守卫比较集合的 `confirmedAt`；`confirmedAt` 改存墙钟读数后，固定时钟下它恒小于令牌，较旧的读取就会覆盖较新的快照，所以 PR-C 里只靠「较新的读取遇到 Development 离线」才能看出的变异，在本 PR 有 4 个杀手。前者守的是状态（较新的刷新全部不完整），不依赖确认时刻的取法，两种都保留。

### Artifacts and Notes · 原型证据（观察时刻快照，原型未提交）

- 执行上下文：PR-C 原型的导出副本，基于 `origin/main@6417d45`，再叠加本计划的 D1、D2；Node v26.10.0。
- `tests/e2e/delivery-lineage.test.js` 19/19；全量 `tests/contract tests/integration tests/e2e` 1226 条只失败 1 条，是 `issue-policy` 的 CLI 改名用例，依赖 git 检出，导出副本没有 `.git`，在真实工作树上 40/40；`tests/mvp0` 7/7；`package-boundaries` 8/8。
- P3′ 输出 `read relations 2 -> 2 | refresh relations -> 9 | ci online 5 | ci offline 5 | stale true | degraded true`。

## Decision Log

除标注「人类专属」的条目外，各行都按证据决定，可由人类在 PR 评审时推翻。

| # | 日期 / 作者 | 决定 | Rationale |
|---|---|---|---|
| 1 | 2026-10-08 / 定稿评审者 | 摄入只有显式刷新命令，不接进 `bootstrapWorkspace` | 理由见「被放弃的方案」。这一点需要人类确认，是 PR-C 计划里 H3 的同一问题（2026-10-09 维持，协调者按人类授权调研后决定，人类可推翻：读路径从不摄入，RS9–RS11 的同类工具都如此；节流、抖动、合并与启动后首次刷新由宿主或调度器持有，不在 bootstrap 里做，写进 TD-045，第 34 行） |
| 2 | 同上 | 缺口原因只有四个：`not_started`、`not_observed`、`not_refreshed`、`unconfirmed`，读时在本地算出 | 足以区分「没开始」「确认为空」「从未刷新」「从未完整读到」；provider 失败的具体原因不落库（TD-046） |
| 3 | 同上 | `degraded` 的定义是：已开始工作，且从未刷新或有集合陈旧 | 纯读之后，「从未刷新」是用户首次打开时最常见的状态，不能显示成完整 |
| 4 | 同上 | controller 的刷新命令报 `local_only`，经实例内重放账本，同键返回原结果 | 没有外部写入；与 `bootstrapWorkspace` 同一先例（Superseded by 第 36 行（2026-10-09）：刷新命令不再经重放账本） |
| 5 | 同上 | 空 `workItemId` 的守卫移进写者 | 查询不再先挡，命令直接调写者 |
| 6 | 同上 | 写入集合超出控制计划的部分在本计划登记 | `controller-roundtrip` 是控制计划要求的「controller 查询面转发」的证据；`status-policy` 的读谱系用例纯读后必须先刷新；`delivery-facts.ts` 是 PR-C 的新文件 |
| 7 | 同上 | 红用例的本地提交整合时并入交付物提交 | `main` 上不留红提交；红的证据记在 `Progress` 与 PR 正文 |
| 8 | 同上 | TD 号段只用 TD-045、TD-046；TD-047–TD-049 不用、不预留（**第 11 行取代**：D0 之后用了 TD-047、TD-048） | K6 预分配；合并时回读 tracker 的最大号 |
| 9 | 2026-10-08 06:28 CST / 实现者（Claude） | D0 回读到 PR-C 的 head 与计划的假设不一致后，实现按真实 head 重写，原型补丁只当参考；`ingest` 换成命令后，9 处把返回值当投影的用例改成「先调命令、再另调查询」 | Surprises 第 5、6 条。断言内容不变，只换读取的对象，所以 B2（收敛与删除）的证据仍是 PR-C 的原用例 |
| 10 | 2026-10-08 06:28 CST / 实现者（Claude） | 「被放弃的刷新」用例改读刷新结果的 `applied` / `anchored`，并断言已提交的快照逐字不变，不再断言查询把旧快照标陈旧 | PR-C Decision Log 第 27 行预先接受：纯读之后，由刷新结果驱动的逐跳标陈旧随查询对刷新的调用一起删除。本 PR 不改写者的规则（Global Constraints），所以这一层的缺口登记为 TD-047，不在本 PR 里补。（Superseded by 第 16 行（2026-10-08）：对抗验证复现这是 PR-C 的 S25 复发，改在写者里补；「被放弃的刷新」末尾现在断言快照被标陈旧而其余字段逐字不变。） |
| 11 | 2026-10-08 06:49 CST / 实现者（Claude） | 用本 PR 的号段多登记两条债务：TD-047（没有锚点的刷新不再把旧快照标陈旧；**已于第 16 行解决，移到 tracker 的 Resolved Items**）、TD-048（PR-C 留的「查询读半边的存储异常原样 reject、写者 `catch` 没有内部诊断」）；取代第 8 行「不用、不预留」 | TD-047–TD-049 本来就是 K6 预分配给 PR-D 的号段；PR-C 的 Decision Log 第 28 行请协调者分配 TD-045，而 TD-045 已被「没有定时刷新」占用，改用 TD-048。PR-C 计划里「待协调者分配 TD-045」那一句要由协调者在 PR-C 一侧订正 |
| 12 | 2026-10-08 06:49 CST / 实现者（Claude） | 矩阵第 10、11 行回填后结论仍是「部分」，没有升级；缺口只是收窄为「变更请求由直接调用替身种下（TD-002）」 | 两行的缺口由 #222 交付：controller 转发投影、读路径不再写关系、缺口可见；证据是 `controller-roundtrip`「交付：刷新命令报 local_only…」、`delivery-lineage`「纯读」「缺口」，与第 9 行（创建变更请求）未交付的事实一致。未改变任何一行的结论计数 |
| 13 | 2026-10-08 06:49 CST / 实现者（Claude） | 控制计划 P3 的 `Superseded by` 放在原有「Superseded by #221」那一行之后（观察行之后），不是标题行；3A 行末的「3B（#222）未做」不改，由新增的 3B 行声明作废 | 与 PR-C 的标注位置一致，读者在看观察值的地方就看到新值；不改 PR-C 写的那一行，避免它在评审中修订时产生冲突（K7） |
| 14 | 2026-10-08 06:49 CST / 实现者（Claude） | D2 第 5 步（PR #289 的集成测试补刷新命令）不适用；该条件文件不进文件集合 | D0 回读 `git ls-tree origin/main tests/integration/github-actions-ci-facts.test.js` 无输出，#289 未合并；K4 规定后合并者负责（Superseded by Decision Log 第 29 行（2026-10-08）：#289 与 #295 都已合并，条件文件进入文件集合） |
| 15 | 2026-10-08 01:55 CST / 协调者（开发账号 SingularityKChen） | 开 draft PR #293 后把 #222 的 Project 10 `Status` 由 `Todo` 置 `In Progress`、`ExecPlan` 文本字段写本计划路径（机械回填） | 依据：`docs/exec-plan/completed/2026-10-07-iteration-5-6-planning.md` Decision Log 的 H3 行（D7 所列条目在开 draft PR 时由 agent 置 In Progress），写入前已回读原文。撤销：`Status` 写回 `Todo`、清空 `ExecPlan`。（编号与四格补于对抗验证的 F12：原行只有两格，在四列表里错位渲染。） |
| 16 | 2026-10-08 07:55 CST / 实现者（Claude） | 没有锚点的刷新在已有快照时把四个集合标陈旧：与提交失败共用 `markStale`，前移 `attemptedAt`，确认时刻、节点与锚点原样，不推进修订号；没有快照时什么也不写。TD-047 在本 PR 解决，取代第 10 行「不在本 PR 里补」。**需要人类在评审时确认**（同第 1 行） | 对抗验证（F6）可复现：同一探针 PR-C 的 head 上陈旧 7/7、`degraded true`，PR-D 上 0/7、`false`；PR-C 第三轮把同一现象判为 P2（S25）并修了，纯读删掉了修复所在的那一层，所以是复发，不是新需求。根因是写者没有记下「这次没能重新确认」，与 ADR-0011 第 5 条「不完整的集合原样保留，只标 `stale`」同一规则，不触及乱序、完整性、删除三条规则（乱序守卫照常，确认时刻、节点、锚点不变）。写者规则属 PR-C 与 ADR-0011（Proposed），实现者先做并标明，不替人类采纳 ADR。**撤销**：删掉 `delivery-facts.ts` 无锚点分支里的 `await markStale(...)` 一行，再把「被放弃的刷新」末尾、「重复刷新收敛」末尾与「无锚点的刷新」两条用例改回「什么也不写」，TD-047 移回 Open。判别：「无锚点的刷新」×2、「被放弃的刷新」；N-F6a–N-F6g（2026-10-09 维持，协调者按人类授权调研后决定，人类可推翻：「失去锚点」指本地执行上下文或工作树记录缺失、什么都没读到，对应 Kubernetes condition 的 `Unknown` 与 Argo CD 的 `Unknown`（RS1、RS9），所以保留旧值并标陈旧；完整读到「分支无 head」属于确认不存在，对应 Argo CD 的 `Missing`，走删除规则） |
| 17 | 2026-10-08 07:55 CST / 实现者（Claude） | `degraded` 只表达新鲜度：上下文记录在而命令边缺失（TD-009 半提交）时，刷新后 `degraded` 为 false，缺失由 `execution_context` / `worktree` 的 `not_observed` 缺口表达，不计入降级 | 对抗验证（F4）。PR-C 的 head 上同一场景刷新后也是 false，不是本 PR 的退化；上下文的 `status` 为 `provisioning`，已经有一个独立的可见信号；把命令边缺失也算降级会让 #234 / #281 的徽标和缺口重复提示。若要改，只改 `degraded` 的一行（加上「命令位置有缺口」）。判别：「谱系写者不写命令边」固定刷新前后的 `gaps` 与 `degraded`；N10、N16、N16b（2026-10-09 维持，协调者按人类授权调研后决定，人类可推翻：Kubernetes 的正交 conditions、Argo CD 的 Sync / Health 分开都是这个做法（RS1、RS9）。补两点：UI 文案不直接显示「降级」二字，在这些语境里 Degraded 意味着坏了；「缺命令边」与「完整确认为空」共用 `not_observed` 有歧义，专门原因码登记进 TD-046，本 PR 不做） |
| 18 | 2026-10-08 07:55 CST / 实现者（Claude） | 刷新结果的 `gaps` 只带能力键（`DeliveryRefreshGap { key }`），provider 的错误文字不进结果 | 对抗验证（F7）。刷新结果原样进 controller 的 `CommandResult.value`，是 `CapabilityGap.reason`（取自 `error.message`）第一次到达 wire，与 K2 / TD-046 的「防止 provider 文字进入 wire」相悖。`chain-facts.ts` 不在文件集（K3、K4），在写者出口收窄；要原因码走 TD-046（词表取 `ProviderErrorCode`）。判别：「刷新结果不转发 provider 文字」、controller-roundtrip 的 wire 用例；N-F7 |
| 19 | 2026-10-08 07:55 CST / 实现者（Claude） | controller 刷新命令的重放账本键含作用域（工作项 + 仓库）；`local_only` 的映射不改，含义写进 `ControllerCommands.refreshDeliveryFacts` 的注释 | 对抗验证（F8、F9）。同键换作用域原先返回上一个作用域的结果且不刷新，是 #194「同键不同请求」在新命令上的实例；在账本键里加作用域是局部修，不替 #194 定整体语义。`local_only` 是 `bootstrapWorkspace` 的先例；`CommandWriteState` 里没有合适的非成功状态（`pending` / `unknown` / `conflict` 都不对），所以调用方读 `value.applied` / `anchored` / `gaps`，controller-roundtrip 固定「没开始工作的工作项」（`applied` false）与「provider 缺口」两种情形。失败的结果在账本里随实例缓存，UI 每次刷新用新键。判别：N-F8a、N-F8b、N-F9a、N-F9b（2026-10-09，协调者按人类授权调研后决定，人类可推翻：信封报 `local_only` 维持，参照 GraphQL 的 data 加 errors、WebDAV 207、AIP-151（RS12），UI 以重读后的投影为准，不以命令结果为准；「账本键含作用域」与「UI 每次刷新用新键」Superseded by 第 36 行，刷新命令不进重放账本） |
| 20 | 2026-10-08 07:55 CST / 实现者（Claude） | 收紧三组用例：「纯读」比较整库并记录全部 provider 方法、覆盖 core 与 controller 的三个查询、刷新前后各跑一遍；「缺口」跑两个 Storage（标题 `缺口（内存替身）` / `缺口（SQLite）`，`vertical-path.md` 同步）；两条「负向」用例加回经刷新命令摄入；另加「无锚点的刷新」×2 | 对抗验证（F1、F3、F5、F15；F2 的 K1 断言写在「重复刷新收敛」）。判别证据在变异表；标题前缀变更后的引用已按回读命令读回 |
| 21 | 2026-10-08 07:55 CST / 实现者（Claude） | `DeliveryProjection.attemptedAt` 的注释改为「最近一次记下快照的刷新尝试」；不是字符串的 `workItemId` 与空串同为 `invalid_input`（写者与查询的守卫都先判 `typeof`） | 对抗验证（F10、F11）。失败与无锚点的尝试也会前移 `attemptedAt`，原注释说「被应用的刷新」不准确；写者承诺不裸抛。判别：「空工作项」；N-F11a、N-F11b |
| 22 | 2026-10-08 07:55 CST / 实现者（Claude） | ADR-0011 第 7 条末句在 #222 后不成立，不在本 PR 改 ADR，登记 TD-049 交 PR-C 的评审修订 | 对抗验证（F13）。ADR 随 PR-C 落地，不在本 PR 的文件集，共享文件只改自己的行（K7）；PR-C 单独合并时第 7 条仍真，#222 之后才假，所以把它改成与第 9 条一致的过渡措辞放在 PR-C 一侧最稳。第 9 条是过渡措辞，且因第 16 行重新成立。（重新 rebase 订正：PR-C 的 C7 已把第 7 条末句改成过渡措辞，TD-049 移到 tracker 的 Resolved Items。第 27 行：本 PR 只改 ADR 的第 3、5、9 条，不触第 7 条。） |
| 23 | 2026-10-08 09:20 CST / 验收者（Claude Opus） | 三处不改行为的重构：`readDeliveryProjection` 在算跳的同一个循环里记缺口，不再为缺口把四个集合再遍历、再查一次快照；controller 刷新命令的账本键复用 core 导出的 `normalizeScope`，不再手写它的字符串分支；controller-roundtrip 的三条交付用例共用 `composeDelivery` 与 `openWorkItems` | 重复与手写副本是以后改一处漏一处的来源（`normalizeScope` 若加字段，账本键会静默少一项）。缺口顺序依赖「命令位置在前、集合位置随循环」，合并循环的风险是在推入跳之前判断缺口，所以补了变异 A-G7。判别：A 系列 20 条全部被杀死；全量 1249、`tests/mvp0` 7/7 与重构前相同。撤销：revert `refactor(core)` 提交 |
| 24 | 2026-10-08 09:20 CST / 验收者（Claude Opus） | 验收通过，第 1、16、17 行保持「需要人类确认」进入评审，不在验收时替人类定；第 16 行（无锚点的刷新标陈旧）按证据保留在本 PR | 第 16 行是 PR-C 的 S25 在纯读之后的复发修复：去掉它，没有锚点时旧 CI 会显示成最新（对抗验证的探针与「无锚点的刷新」×2 证明），所以默认保留，撤销方式写在第 16 行。第 1 行（不接进 `bootstrapWorkspace`）与第 17 行（`degraded` 只表达新鲜度）是产品语义，证据只能说明各自的代价 |
| 25 | 2026-10-08 11:40 CST / 修复者（Claude Sonnet 5.5） | 缺失的作用域（`undefined` / `null`）在 `normalizeScope` 里容忍（`scope?.workItemId`），由写者与查询已有的守卫折成 `invalid_input`；不加新的守卫，不改签名 | 第二轮 P3-5。备选：在 core 命令与 controller 命令各包一层 `try/catch`（两处，且以后每个新入口都要记得加）。`normalizeScope` 是 core 命令、controller 账本键和查询的共同入口，一行解决。撤销：把 `scope?.` 改回 `scope.`。判别：「空工作项」、controller-roundtrip 的归一用例；NULLSCOPE（2026-10-09，协调者按人类授权调研后决定，人类可推翻：行为维持，参照 W3C TAG 的 Promise 指南「不同步抛」（RS13）；类型修正见第 41 行） |
| 26 | 同上 | PR-C 第四轮留下的五条 P3 断言放在本 PR 文件集里的两个 e2e 文件（delivery-lineage、controller-roundtrip），不碰契约套件，也不改 PR-C 文件里的实现；JSON `null` 一项不适用 | PR-C 的代码桶是 799 / 800；契约套件的用例台账（`ADDED_CASE_COUNT`）在 PR-C 的文件里，在那里加用例要连带改 PR-C 的台账。三条在本 PR 的语义下已被间接杀死，仍补直接断言（Surprises 末条）。`null` 按 PR-C 的 S30 维持现状 |
| 27 | 同上 | ADR-0011 的订正落在本 PR：第 3 条 `attemptedAt` 的定义与第 5 条补无锚点的情形，第 9 条末句补「陈旧标记由写者落进快照」；文件集合加 ADR-0011；第 22 行与 TD-049 说的「不在本 PR 的文件集」只针对第 7 条 | 无锚点的刷新标陈旧是本 PR 加的写者行为（第 16 行），只有本 PR 合并后这几句才成立；栈底只写自己的事实，PR-C 的 C8 只订正了 PR-C 成立的部分（提交失败也前移 `attemptedAt`）。ADR 仍是 Proposed，本 PR 不替人类采纳 |
| 28 | 同上 | 从未刷新又没有锚点的上下文，刷新后查询没有可见变化：不修，在 TD-046 补一句，用例钉住当前行为，不新开号 | 第二轮 P3-6。修法要么落一行只带 `attemptedAt` 的空快照，要么把原因码落库，都属于 TD-046 的范围（尝试的原因不落库）；#222 的验收只要求 stale / degraded，且发起刷新的调用方能从结果的 `anchored: false` 看出来。判别：NOSNAP |
| 29 | 2026-10-08 19:55 CST / rebase 适配者 | main 的两份 CI 集成测试（#295 的 `delivery-pages-complete`、#289 的 `github-actions-ci-facts`）进入本 PR 的文件集合；各在组合根加一个包装，每次交付读取（`getDeliveryProjection`、`getDeliveryLineage`）先调 `commands.refreshDeliveryFacts` 再读，不逐处改调用点 | 本计划 D0 第 3 步与 K4 写明：#289 先合并时由本 PR 替它补刷新命令。包装等于「打开视图时刷新」（#234 的用法），被测的仍是 core 的完整分页、提交核对与状态映射；逐处改要动约 20 个调用点，包装各 2 行。查询纯读本身由本 PR 的「纯读」用例证明，不靠这两份文件。判别：包装去掉刷新时 5 + 2 条红，#295 守卫的变异 4 条红（2026-10-09，协调者按人类授权调研后决定，人类可推翻：维持，参照 SWE at Google 第 12 章「行为变化在一个层面适配」（RS14）；包装改名为 `refreshBeforeRead`，两份文件都改，不与生产 API 同名，免得 DAMP 意义上的隐藏因果） |
| 30 | 同上 | rebase 冲突一律保留两边的事实：索引两行都留；e2e 取 PR-C 的 `endless` 注入并保留本 PR 的「刷新与查询分开」；矩阵第 10、11 行取本 PR 的版本，并把 PR-C 写的「分页截断」同步成「分页读不完」 | 栈底只写自己的事实：PR-C 的 C9 已把截断用例改成 #295 下的「读不完」，本 PR 不另改语义，只在冲突处叠加 |
| 31 | 2026-10-08 22:05 CST / 修复者（rr） | 随 PR-C 的 C10 再 rebase：`git -c core.commentChar=';' rebase --onto <PR-C 新 head> <PR-C 旧 head>`，五个提交逐个重放，正文逐字节不变；冲突按第 30 行的规则保留两边的事实：索引行取 PR-C 的新行与本 PR 的行，矩阵第 10 行取本 PR 的版本，再把 PR-C 在 C10 里改的两格（`delivery-github-actions` 已是只读 adapter；承接列去掉已关闭的 #232）叠上去，本 PR 的承接说明相应改为「现为『—』」 | #232 已由 #295、#289 交付并关闭，#222 的缺口由本 PR 交付，第 10 行不再有承接 issue；剩下的「部分」来自 TD-002，不是承接 issue。`--onto` 只换基，不改本 PR 的提交（`range-diff` 只在冲突的两份文档上有差异） |
| 32 | 同上 | 「负向：未创建执行上下文时」补 `recordProviderCalls` 与「Development / Delivery 零调用」断言，测试放在本 PR，不改 PR-C 的 `chain-facts.ts` | 独立对抗验证：变异 HOW 在全量下存活（Surprises 倒数第三条）。代码在 PR-C，但 PR-C 的代码桶是 800；「未观察锚点零请求」是本 PR 纯读要守的性质之一，`recordProviderCalls` 也是本 PR 已有的夹具。+2 行 |
| 33 | 同上 | 两份集成测试的刷新包装断言刷新结果的 `error` 为 `undefined`；约 300 字符的单行包装拆成 7 行的块，并注明「读不全是缺口、不是失败」 | 独立对抗验证 I6（Surprises 倒数第二条）。断言放在包装里，每次读取都检查，不需要逐条用例改；可读性只拆行、不改语义（INT-WRAP 两条变异按新包装改写查找文本，语义仍是「包装不再刷新」）。每份文件 +7 行 |
| 34 | 2026-10-09 / 协调者（协调者按人类授权调研后决定，人类可推翻；修复者记录） | 第 1、16、17、19、25、29 行全部维持，各行末尾补了决定与依据 | 人类伙伴 2026-10-08 的授权原话「对于决策点，先调研同类系统和业界最佳实践，并深入思考和权衡，再决定。」；依据集中在下文「调研依据」 |
| 35 | 同上 | `confirmedAt` 改存读取开始时的墙钟读数；`attemptedAt` 保留为行级逻辑定序令牌，逻辑不动，类型注释写明可以领先墙钟、不得展示、不得做减法；降级事务不改 `confirmedAt`；读数不能被 `Date.parse` 解析时走既有降级路径，不写入非法值；`superseded` 不改，不对已存的非法令牌 fail closed，否则会永久卡死写入 | 同类系统都把定序令牌与给人看的时间分开存（RS1、RS2、RS3）；现令牌是 HLC 论文指出漂移无界的朴素算法（RS5）；取读取开始而不是结束，以请求发起时刻为基准，更保守（RS4）。只有本 PR 把 `confirmedAt` 作为 freshness 转发出去，PR-C 单独合并时它只在写者内部使用（PR-C Decision Log 第 52 行）。判别：W1、W2、W3 |
| 36 | 同上 | controller 的 `refreshDeliveryFacts(scope, { actorRef })` 不再读写重放账本：第二个参数是 `Pick<CommandEnvelope, 'actorRef'>`，其它命令的信封不变；注释写明天然幂等、重复调用会重新读取、不重放；这个命令尚未发布，不做兼容；同作用域在途合并不做，记进 TD-045 作为宿主职责 | 没有外部写入，重复执行效果等价，按 RFC 9110 §9.2.2 就是幂等的（RS3）；Stripe 不给 GET / DELETE 带键（RS7），EC2 的天然幂等动作不需要 client token（RS8）。重放缓存对刷新是负价值：返回过期结果，还缓存失败。#194 讲的是同键不同请求，不是账本有界，去掉之后有界问题也消失。第 4、19 行的相应部分 Superseded。判别：RPL |
| 37 | 同上 | `degraded` 与 `DeliveryFreshness` 的注释写明只反映最近一次刷新的结果、不含年龄；新鲜度与年龄只能从 `confirmedAt` 起算，年龄规则是 `ui-model` 里以当前时间为参数的纯函数，由 #281 / #234 实现；core 投影不加随时间变化的字段 | 查询结果保持确定：同一份已提交事实读出同一个投影，比较投影本身的断言（controller-roundtrip「三种写法读到同一个投影」的 `deepEqual`、delivery-lineage「刷新结果与快照时刻」里刷新前后投影的 `deepEqual`）与调用方缓存都依赖这一点；年龄依赖 now，放在 `ui-model` 的纯函数里由调用方传入；负年龄夹到 0（RS4）。（2026-10-09 订正理由：原写「加随时间变化的字段会破坏「纯读」用例的整库逐字比较」，不对，那条用例比较的是存储转储，读时算出的字段不落库，不会让它变红；决定本身不变。） |
| 38 | 2026-10-09 / 人类伙伴（人类专属，在协调者会话里直接回答） | 老化规则的承接，所选答复原文「Add to #281 and #234 (Recommended)」：协调者在 #281、#234 各加一条验收框，原文引在 TD-045 | 第 37 行的年龄规则需要一个消费方 |
| 39 | 2026-10-09 / 人类伙伴（人类专属，在协调者会话里直接回答） | ADR-0011 的状态，所选答复原文「Adopt after #293's fixes (Recommended)」：本 PR 的回填提交把 ADR-0011 改为 Accepted，照 ADR-0012 的状态行格式写批准时刻、提问与所选原话，并写明前提是本 PR 落地 `confirmedAt` 墙钟读数与文字修订之后；`docs/adr/README.md` 的索引行与来源句同步；PR-C 里 ADR-0011 保持 Proposed | 第 35、42 行落地之后，第 3、7 条不再自相矛盾 |
| 40 | 2026-10-08 / 人类伙伴（人类专属，在协调者会话里直接回答；2026-10-09 记录） | #293 第一轮评审 P2 的承接，所选答复原文「Add boxes to #234 and #281 (Recommended)」：协调者在 #234、#281 各加一条验收框，2026-10-09 改写为不再要求新幂等键（现文引在 TD-045）；TD-045 的承接由 #134 改为 #234、#281 与 #233 | #134 的 Scope 明确排除交付绑定，原先的「下一步」没有承接方 |
| 41 | 2026-10-09 / 修复者 | `normalizeScope` 返回诚实的 `NormalizedDeliveryScope`（`workItemId: string \| undefined`，不是字符串的工作项也归一成 `undefined`），写者与查询共用守卫 `isDeliveryScope`，tsc 由此强制先过守卫；`DeliveryProjection.workItemId` 相应可空 | 评审 P3 `delivery.ts:63`：原类型写 `string`，运行时是 `undefined`。判别：SC1、SC2、NULLSCOPE |
| 42 | 同上 | ADR-0011 修订：第 3 条写明 `confirmedAt` 是读取开始时的墙钟读数、`attemptedAt` 是逻辑定序令牌，`stale: false` 不表示新近、年龄按 `max(0, now − confirmedAt)` 由消费方算；第 5 条补「完整」的前提是 provider 保证范围内的完整（RS6）；第 7 条去掉「与墙钟无关」与确认时刻的矛盾；第 8 条就地标 Superseded，指向 TD-048（#224）；Rejected 表的代际整数列改为推迟到 Gate E1 冻结数据模型 v1，登记 TD-052；TD-048 与 K2 行的「Proposed」「#290 或 #224」改为「Accepted」「#224」 | 评审 P3（ADR-0011 第 8 条与 TD-048）与第 35 行的决定；协调者按人类授权调研后决定，人类可推翻 |
| 43 | 同上 | #292 的 T17 变体（较新的读取遇到 Development 离线）与 `.putRelation(` 静态守卫放在本 PR：只合并 #292 时这两格没有用例，本 PR 随后合并补上 | PR-C 的代码桶 800（PR-C Decision Log 第 50 行）。判别：T17、G1 |
| 44 | 同上 | 整合提交时用 `git -c core.commentChar=';'` 重写规划提交的正文：原首行以 `#221` 开头，被当成注释删掉，正文从半句开始；补完整，且不让任何一行以 `#` 开头 | 评审 P3 |
| 45 | 同上 | 端口文件 `packages/capabilities/src/storage.ts` 只改两行注释（`confirmedAt` 与 `attemptedAt` 的语义），不改签名；文件集合加这一项、ADR README 与评审记录 | Global Constraints 的「不改 Storage 端口」指接口；注释随语义同批订正 |
| 46 | 同上 | 随 PR-C 的 C11 再 rebase：`git -c core.commentChar=';' rebase --onto <PR-C 新 head> <PR-C 旧 head>`；冲突按第 30 行保留两边的事实：完整性表在线断言取本 PR 的节点顺序、删去 PR-C 删掉的来源集合断言；乱序循环取 PR-C 的「两个对象也跑提交失败」；TD-050 取 PR-C 的 Resolved；矩阵第 10 行叠上 PR-C 补记的分支查找上限，承接列由「—」改为「#233」 | 栈底只写自己的事实；第 10 行剩下的承接只有分支查找的首页上限（TD-040） |
| 47 | 2026-10-09 / 修复者（rr2） | 完整性表补「变更请求页形非法」一行，放在本 PR；PR-C 的查找谓词先要求 `Array.isArray(page.items)`，页形非法的成功页是缺口，不是完整空集合 | #292 复评轮 P3：`{ items: null, nextCursor: undefined }` 曾被当成「完整读到没有变更请求」而删掉最后确认的变更请求和它的三条检查。PR-C 的代码桶 800 已在规划上限，一行用例就越过，所以判别用例随本 PR（PR-C Decision Log 第 53 行）；只合并 #292 时这一格没有用例，变异 R1 存活，本 PR 合并后 2 红杀死。分支查找的谓词不加同样的守卫（PR-C 第 54 行：坏页走 K2，没有事实被删，唯一差别是返回值带不带 `error`） |
| 48 | 同上 | 文字订正落点：①刷新命令的例外写进 `commands.ts` 模块头；②ADR-0011 转为 Accepted 后，`docs/README.md`、TD-009、TD-014 的旧说法就地改成已 Accepted，TD-049 的范围改成实际改过的第 3、5、7（前半）、8、9 条与 Rejected 表；③#134 不是定时刷新的承接方：ADR Consequences、「与相邻工作的接口」与 Outcomes 遗留条都改指 #234、#281 与 #233，定时、节流与合并归宿主；④第 37 行的理由改成「查询结果保持确定」 | 全是 #293 复评轮的 P3，都是第 39、40 行与第 37 行的决定落地之后留下的旧说法；第 37 行与第 40 行的决定本身不变。第 37 行原理由指错了被保护的对象，以后有人按它判断「不落库的时间字段可以加进投影」会得出错误结论，所以只订正理由 |

### 调研依据

第 34–37、42 行与第 1、16、17、19、25、29 行末尾的决定，是协调者按人类授权（2026-10-08）调研后作出的，人类可推翻。出处如下，引用的是它们的公开约定，不是本仓库的事实：

| # | 依据 | 出处 |
|---|---|---|
| RS1 | Kubernetes：定序用 `resourceVersion` / `generation`，与 condition 的 `lastTransitionTime` 分开；conditions 彼此正交，`status` 有 `Unknown` | https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md |
| RS2 | Jira Software Cloud 的开发信息与构建数据：定序号（`updateSequenceId` / `updateSequenceNumber`）与给人看的 `lastUpdated` 分开 | https://developer.atlassian.com/cloud/jira/software/rest/api-group-development-information/ 、https://developer.atlassian.com/cloud/jira/software/rest/api-group-builds/ |
| RS3 | HTTP：`ETag` 与 `Last-Modified` 分开（§8.8）；幂等方法的定义（§9.2.2） | https://www.rfc-editor.org/rfc/rfc9110 |
| RS4 | HTTP 缓存的年龄以请求发起时刻为基准，负值夹到 0（§4.2.3） | https://www.rfc-editor.org/rfc/rfc9111#section-4.2.3 |
| RS5 | 混合逻辑时钟论文：只取「墙钟与已见值加一」最大值的朴素逻辑物理时钟，与物理时钟的偏差无界 | https://cse.buffalo.edu/tech-reports/2014-04.pdf |
| RS6 | GitHub REST 分页：按游标或页码读，不承诺翻页期间的一致快照 | https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api |
| RS7 | Stripe：幂等键用于 POST，GET 与 DELETE 按定义幂等，不需要键 | https://docs.stripe.com/api/idempotent_requests |
| RS8 | Amazon EC2：部分动作天然幂等，不需要 client token | https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html |
| RS9 | Argo CD：Sync 与 Health 两个状态分开；资源健康含 `Missing`、`Unknown` | https://argo-cd.readthedocs.io/en/stable/operator-manual/health/ |
| RS10 | Backstage：目录的摄入由后台处理循环做，读接口不触发摄入 | https://backstage.io/docs/features/software-catalog/life-of-an-entity |
| RS11 | GitHub Desktop 与 VS Code 的 GitHub Pull Requests 扩展：远端状态由后台或手动刷新拉取，展示只读本地状态（协调者调研） | https://github.com/desktop/desktop 、https://github.com/microsoft/vscode-pull-request-github |
| RS12 | 部分成功的结果形状：GraphQL 的 data 与 errors 并存、WebDAV 207、AIP-151 的长时操作 | https://spec.graphql.org/October2021/#sec-Errors 、https://www.rfc-editor.org/rfc/rfc4918#section-13 、https://google.aip.dev/151 |
| RS13 | W3C TAG 的 Promise 指南：返回 Promise 的函数不同步抛错，用被拒绝的 Promise 表达失败 | https://www.w3.org/2001/tag/doc/promises-guide |
| RS14 | Software Engineering at Google 第 12 章：测试经公共 API、DAMP 而非 DRY、行为变化在一个层面适配 | https://abseil.io/resources/swe-book/html/ch12.html |

## Idempotence and Recovery

- 刷新命令可以重复执行：同一输入只前移 `attemptedAt`，关系、节点与修订号都不变（PR-C 的「重复刷新收敛」，重新 rebase 后在「唯一写者」里）。查询可以任意重复，没有任何副作用（「纯读」）。
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
| K2 结构化失败（规则正文是 ADR-0012，2026-10-09 订正为 Accepted，PR #290 已合并；读路径的统一归 #224，TD-048） | 刷新命令的失败是结构化的 `{ ok: false, error }`，不转发异常原文；结果的 `gaps` 只带能力键，provider 的错误文字不进 wire（Decision Log 第 18 行）；交付域不写 `reconcile_cursor` |
| K3 Development 路由（PR-B #291） | 本 PR 不碰 `chain-facts.ts` 的路由缝 `developmentReadBinding`（返回 `{ binding, repository }`）。PR-B 与 PR-C 都合并后，由后合并者换成 `routeDevelopment(source, repositoryId, key, mode)`（`packages/core/src/development-route.ts`，不从 `index.ts` 导出），并补一条已登记仓库的多挂载正例（2026-10-08：人类伙伴裁决合并顺序 #290 → #291 → #292 → #293，接线由 PR-C 在 #291 合并后承担，本 PR 仍不碰）（Superseded by PR-C Decision Log 第 45 行（2026-10-08）：人类伙伴改为由 #297 在 #219 与 #221 都进 main 后单独接线并补正例，本 PR 仍不碰） |
| K4 Delivery 读取（PR #289） | 本 PR 不改 Delivery 读取。PR #289 的集成测试（将新建）经 `getDeliveryProjection` 读取：#289 先合并时，本 PR 的 D2 第 5 步替它补刷新命令；#289 后合并时，由 #289 先调刷新命令，冲突由后合并者解决（2026-10-08：#232 拆成 #295 与 #289，两者都已先合并；PR-C 的 C9 适配了读取，本 PR 替两份集成测试补了刷新，Decision Log 第 29 行） |
| K5 新鲜度 | 不写任何游标，不影响 `getPlanningSync()` |
| K6 编号 | 号段 TD-045–TD-049 全部用到：TD-045、TD-046 是定稿时的两条，TD-047（已解决）、TD-048、TD-049（已由 PR-C 的 C7 解决）见 Decision Log 第 11、22 行；ExecPlan 日期 2026-10-08 |
| K7 共享文件 | `docs/README.md`、tracker、`vertical-path.md` §2.1、控制计划只改本 PR 自己的行。`docs/README.md` 的索引行与 PR-C 的行相邻，rebase 时会冲突，保留两行即可 |
| K8 规模 | 见 Design 的估算 |

### 与相邻工作的接口

- **PR-C（#221）**：本 PR 只消费 PR-C 的接口，不改写者的规则。若 PR-C 在评审中改了接口，D0 必须先同步本计划。
- **PR-A #290**：PR-A 也会改 `packages/core/src/context.ts`（`CoreCommands` 与 `composeCore`），后合并者合并成员列表；本 PR 的成员只有 `refreshDeliveryFacts` 一个。
- **#234（抽屉谱系条）**：打开抽屉与手动刷新时调 `commands.refreshDeliveryFacts`；读 `gaps` 显示缺口，读 `stale` 与 `freshness[].confirmedAt` 显示「最后确认于…」；陈旧跳按 `hop.to` 归组（TD-042）。
- **#281（交付视图）**：同上。
- **定时刷新**（Superseded by Decision Log 第 40 行：原写 #134，但 #134 的范围排除交付绑定，不是承接方）：定时、节流、抖动与在途合并由宿主或调度器持有，承接是 #234、#281 的打开与手动刷新，加 #233 的同步；按工作区批量调刷新命令需要一个列出执行上下文的端口，本 PR 不提供。
- **#233（谱系同步）**：扩展 PR-C 的写者，不另起写者；刷新入口仍是本 PR 的命令。
- **#224（形状清理）**：`DeliveryScope` 的字符串分支仍由 `normalizeScope` 处理，本 PR 不删；`EdgeProvenance.ChainSkeleton`、恒为 `true` 的 `observed`、恒为 `undefined` 的 `detail` 已由 PR-C 登记给 #224。
- **#72（真实交付 provider）**：不在本 PR 的范围内（#222 Out of scope）。

### 拟新增的技术债行（D3 手工追加到 tracker 的 Open Items；已追加，另有 D0 之后新增的 TD-047（已解决，在 Resolved Items）、TD-048，以及对抗验证之后新增的 TD-049（已由 PR-C 的 C7 解决，在 Resolved Items），全文见 tracker）

| ID | 日期（本地） | 状态 | ExecPlan | 子系统 | 分支 | 记录者 | 简述 | 延期理由 | 遗留影响 | 下一步 |
|---|---|---|---|---|---|---|---|---|---|---|
| TD-045 | 2026-10-08 | Open | `docs/exec-plan/completed/2026-10-08-delivery-query-pure-read.md` | 核心与 controller（`packages/core/src/context.ts`、`packages/controller/src/commands.ts`） | `fix/delivery-query-pure-read` | #222 定稿评审者 | 交付事实只在有人调 `commands.refreshDeliveryFacts` 时更新：既没有定时刷新，也没有「打开视图时刷新」，从未刷新的上下文显示四个 `not_refreshed` 缺口并标降级 | #222 只要求显式命令触发；定时归 #134，抽屉打开时调用归 #234；接进 `bootstrapWorkspace` 会把规划同步与交付读取耦合，而且那是 PR-A 的文件 | 首次打开交付视图看不到 CI，直到宿主或 UI 调一次刷新 | #234 在抽屉打开与手动刷新时调命令；#134 按工作区定时批量刷新（需要列出执行上下文的端口） |
| TD-046 | 2026-10-08 | Open | 同上 | 核心与存储端口（`packages/core/src/delivery.ts`、`packages/capabilities/src/storage.ts`） | 同上 | 同上 | 刷新失败的原因不落库：查询只能说某个集合陈旧，说不出是离线、权限被拒、截断还是提交失败；刷新命令的结果也不带原因，缺口只带能力键（provider 的错误文字不进 wire） | 原因码要定词表，还要防止 provider 文字进入 wire（K2）；#222 的验收只要求 stale / degraded | 用户看到陈旧，却不知道该重试还是去修权限。同源的另一种情形：从未刷新、又没有锚点的上下文，刷新什么也不写（没有快照可标陈旧），刷新前后的查询没有任何可见变化（`attemptedAt` 仍为空，四个位置仍是 `not_refreshed`），只有发起刷新的调用方能从结果的 `anchored: false` 看出这次尝试；delivery-lineage「刷新结果与快照时刻」固定了这一点 | 需要时给 `sets_json` 的集合加 `reason` 码（JSON 加字段，不需迁移），词表取 `ProviderErrorCode` 加 `truncated`，并由 `freshness` 转发；同时决定从未刷新的上下文是否记一行只带 `attemptedAt` 与原因的快照，让「尝试过」可见 |

r1 订正：TD-045、TD-046、TD-048 按 Decision Log 第 36–42 行改写，新增 TD-052，现行文字以 tracker 为准。

## Outcomes & Retrospective

实现者部分（2026-10-08 06:49 CST）：

- **与计划的偏差**：PR-C 的 head 比原型晚了三轮对抗验证，D0 回读到四处出入（Surprises 第 5–8 条）。实现按真实 head 重写；9 处读 `ingest` 返回值的用例改成先调命令再另调查询；「被放弃的刷新」那一层由刷新结果的 `applied` / `anchored` 承接，没有锚点的刷新不再标陈旧，登记为 TD-047。
- **D1 的红信息**：见 Progress。在 PR-C 的 head 上恰有五处新断言失败，其余 35 条全绿。
- **D2 的结果**：`tsc` 无输出；`tests/contract tests/integration tests/e2e` 1243/1243；`tests/mvp0` 7/7；`boundaries` 退出 0；P3′ 与计划一致；P3 原命令观察 `relations 2 -> 2 | ci online 0 | ci offline 0 | degraded true`。
- **变异**：18 条全部被杀死（计划的 D-M1–D-M6 加实现者补的 D-M7–D-M18）。对抗验证第一轮之后在最终树整表重做：D-M1–D-M17 加 N 系列共 48 条全部被杀死（D-M18 被 N-F6a 取代）。
- **对抗验证第一轮**（2026-10-08 07:55 CST）：15 条发现（P2 ×7、P3 ×8）全部属实，已处置——测试缺口 6 条（F1–F5、F15）用 48 条变异的整表重测证明；行为缺陷 4 条（F6 无锚点的刷新、F7 缺口原文到 wire、F8 重放账本、F11 非字符串输入）先红后绿；文档 / 交接 4 条（F9、F10、F12、F13）；F14 是协调者的推送与整合步骤。逐条见 Progress。F6 是 PR-C 第三轮 S25 的复发，也是本轮唯一改变写者行为的一条，需要人类在评审时确认（Decision Log 第 16 行，含撤销方式）。
- **最终验收**（2026-10-08 09:20 CST，验收者 Claude Opus）：#222 的四条验收逐条有证据——验收 1 由「纯读」×2 证明，修复前红在整库断言（Surprises 末条）；验收 2 由 PR-C 的乱序、重复刷新收敛、完整空集合才删除、失败不清空经刷新命令仍然通过，另有 K1 三步；验收 3 由「缺口」×2 证明；验收 4 的两条命令退出 0。重构三处不改行为（Decision Log 第 23 行），A 系列 20 条变异全部被杀死。对抗验证的复验没有产出，验收者的复测与探针不替代独立的第二轮；需要人类决定的是 Decision Log 第 1、16、17 行（第 24 行）。
- **遗留**：#234 在抽屉打开与手动刷新时调 `commands.refreshDeliveryFacts`，读 `gaps`、`stale` 与 `freshness[].confirmedAt`；#234、#281 承接打开与手动刷新，#233 承接同步，定时与节流由宿主或调度器持有（TD-045；2026-10-09 订正：这里原写 #134 按工作区定时刷新，#134 的范围排除交付绑定，见 Decision Log 第 40 行）；#233 扩展写者的集合，不另起写者；TD-046 刷新失败原因；TD-048 查询读半边的存储异常与写者诊断；TD-049 ADR-0011 第 7 条末句交 PR-C 订正；PR-C 计划里「待协调者分配 TD-045」要订正为 TD-048（重新 rebase 订正：两项都已由 PR-C 的 C7 处理——第 7 条改成过渡措辞，TD-049 已解决；PR-C 计划里的占位改成「不在 PR-C 另占号」，没有写成 TD-048，因为栈底不引用只在本 PR 存在的号）；#289 后合并时，它的集成测试在每次读投影前先调刷新命令；TD-047 已在本 PR 解决，不再遗留。

对抗验证第二轮（2026-10-08 11:40 CST，修复者）：

- **结论**：在 `101305e` 上 1 个 P2、7 条 P3，全部属实：P2-1、P3-1、P3-2、P3-3、P3-4 的实现本来就对，补的是断言；P3-5 是实现缺陷（缺失的作用域同步抛 `TypeError`），一行修复；P3-6 不修，TD-046 补一句；P3-7 的文档漂移已订正。PR-C 第四轮留下的五条 P3 断言在本 PR 补上（Progress）。
- **变异**：14 条新增、A 系列 20 条、N-F6a–N-F6g 7 条共 41 条，在 `d69246e` 的导出上全部变红；其中 9 条在修复前 `30db4b1` 上存活。
- **数字**：全量 1244/1244，`tests/mvp0` 7/7，#222 的验收命令 411/411，代码 541 / 1000（规划上限 800）；PR-C 的代码桶仍是 799。
- **交人类**：Decision Log 第 1、16、17 行不变；第 25 行（`normalizeScope` 容忍缺失的作用域）与第 27 行（ADR-0011 第 3、5、9 条的订正落在本 PR，ADR 仍是 Proposed）可在评审时推翻。

重新 rebase 到含 #295 / #289 的 main（2026-10-08 19:55 CST，rebase 适配者）：

- **结果**：随 PR-C 的 C9 rebase，产品代码没有冲突；main 的两份 CI 集成测试改为先刷新再读（Decision Log 第 29 行）。全量 1353/1353，`tests/mvp0` 7/7，#222 的验收命令 459/459，41 条变异全部变红，另 3 条集成层变异变红。
- **数字**：`node scripts/rule-checks.mjs size feature/delivery-fact-writer` 代码 554 / 1000（规划上限 800），文档以提交后的输出为准；PR-C 的代码桶是 800。
- **交人类与协调者**：K3 接线归 PR-C（#291 合并后），本 PR 不碰（Superseded by PR-C Decision Log 第 45 行：接线由 #297 单独做）；Decision Log 第 1、16、17、25、27 行不变。

rebase 之后独立对抗验证的修复者部分（2026-10-08 22:05 CST，rr）：

- **结果**：随 PR-C 的 C10 再 rebase，代码提交与集成测试提交的补丁不变；三项处置都有修复前存活、修复后变红的变异证据（HOW、I6），第三条空转用例由 I2b 证明重新有判别力。全量 1349/1349，`tests/mvp0` 7/7，#222 的验收命令 455/455，43 条变异与 6 条集成层变异全部变红。
- **数字**：代码 570 / 1000（规划上限 800），PR-C 的代码桶是 800。
- **交人类与协调者**：K3 接线由 #297 单独做；Decision Log 第 1、16、17、25、27 行不变。

修复轮部分（2026-10-09，r1）：

- **结果**：#293 第一轮评审的 P2 由人类裁决承接到 #234、#281（与 #233）；五条 P3 中三条修复（作用域类型、ADR-0011 第 8 条与 TD-048、规划提交正文），两条由协调者调研后决定并实现（刷新退出重放账本、老化只在注释与 #281 / #234 的验收里）；`confirmedAt` 改存墙钟读数；ADR-0011 按人类裁决改为 Accepted。主表 49 条、集成层 6 条变异全部被杀死；代码 630。

复评轮部分（2026-10-09，rr2）：

- **结果**：变更请求页形非法有了判别用例（R1 在 PR-C 单独存活，在本分支 2 红）；刷新命令不进账本的模块头、ADR 转为 Accepted 之后残留的 Proposed、#134 的承接方与 Decision Log 第 37 行的理由全部订正，决定本身不变；H5、B2、T11、T17、G1、R1 六条变异全部变红；代码规模见本批最后一次回读。

## Bottom Change Note

- Change Note (2026-10-08 CST，定稿评审者)：初稿。为什么写：#222 要求单独的 ExecPlan，并以 PR-C 的 spec 为前提。写了什么：重锁接口的步骤、红用例与变异表、P3′，以及与 PR-A、PR-B、#289 的交接。开工时以 PR-C 合入后的接口为准，重新锁定。
- Change Note (2026-10-08 06:49 CST，实现者 Claude)：D0–D3 的实现者部分完成。为什么改：PR-C 经三轮对抗验证后，head 上的过渡形态更厚、测试里有 9 处把 `ingest` 的返回值当投影用，原型的假设不再成立。改了什么：Context 表第 56、59 行、Surprises 第 5–8 条、Decision Log 第 9–14 行、变异表（D-M7–D-M18 与真实 head 实测）、Progress、Outcomes、TD-047 与 TD-048 的登记；实现与测试见 `fix(core)` 与红用例两个提交。
- Change Note (2026-10-08 07:55 CST，实现者 Claude)：处理对抗验证第一轮的 15 条发现。为什么改：验证者复现了纯读删掉 PR-C 的 S25 修复层、两条具名负向用例空转、刷新结果把 provider 文字送到 wire、刷新命令的 K1 与 controller 一路的纯读没有判别证据等问题，全部属实。改了什么：Design 里写者的三处改动与重放账本的作用域、Global Constraints 的例外、D1 / D2 的就地标注、验收矩阵 B3 / B5 / B6 与新增的 B9–B12、变异表（整表在最终树重做，新增 N 系列，D-M18 被 N-F6a 取代）、Progress、Surprises 第 9–14 条（第 7 条就地标注）、Decision Log 第 15–22 行（第 10、11 行就地标注）、Interfaces 的 K2 行与 TD 表、Outcomes；tracker 的 TD-047 移到 Resolved、TD-046 更新、新增 TD-049；`vertical-path.md` 的缺口用例标题前缀。实现与测试见 `fix(core)` 提交。
- Change Note (2026-10-08 09:20 CST，验收者 Claude Opus)：最终验收。为什么改：对抗验证的复验没有产出，验收者在最终树上独立复跑、重构并补测，计划要与之一致。改了什么：状态行；文件集合与 K6 的号段改成实际用到的 TD-045–TD-049；行数估算加验收后的实测；B1 写明最终版用例在 PR-C 上红的原因；变异表加 A-G7 与「验收者复测」一段（A 系列 20 条）；Progress 两行验收记录；Surprises 末条（收紧后的「纯读」红的原因）；Decision Log 第 23、24 行；Outcomes 的最终验收段；本节的三条既有 Change Note 按时间重排（07:55 那条原先排在 06:49 之前）。重构见 `refactor(core)` 提交。
- Change Note (2026-10-08 10:25 CST，PR-C 规模收敛者)：重新 rebase 到 PR-C 的 C7 之上。为什么改：PR-C 把代码规模收到 800 以内，合并了本 PR 改过的几条用例并改写了 `readDeliveryProjection` 的结构。改了什么：状态行；第 64 行、B2、B9、B10 与变异表说明里合并后的用例名；Surprises 末条；重新 rebase 的 Progress；Decision Log 第 22 行与 Surprises 里关于 TD-045 / TD-048 / TD-049 的订正；Idempotence 里重复刷新收敛的位置；K6 与 Outcomes 里 TD-049 已由 PR-C 解决。
- Change Note (2026-10-08 11:40 CST，修复者 Claude Sonnet 5.5)：处理对抗验证第二轮（`101305e`）的 1 个 P2、7 条 P3，并补 PR-C 第四轮留下的五条 P3 断言。为什么改：验证者复现了无锚点分支的乱序守卫、标陈旧失败、字符串作用域等 9 处「删掉守卫仍全绿」，以及缺失的作用域同步抛 `TypeError`；ADR-0011 与计划里还有与实现不符的描述。改了什么：状态行；Design 里 `freshness` 从未刷新是 `[]`、无锚点标陈旧受乱序守卫约束、`normalizeScope` 容忍缺失的作用域；文件集合加 ADR-0011；规模实测一段；B13、B14 与第二轮之后的变异表；Progress、Surprises 第 17–19 条、Decision Log 第 25–28 行（第 22 行加指针）、TD-046 一句、Outcomes；tracker 的 TD-046 与 TD-049；ADR-0011 第 3、5、9 条。实现与测试见 `fix(core)` 提交。
- Change Note (2026-10-08 19:55 CST，rebase 适配者)：随 PR-C 的 C9 重新 rebase 到含 #295 / #289 的 main。为什么改：main 合并了 #295 的完整分页与 #289 的 adapter，它们的两份集成测试经查询读 provider，本 PR 的纯读让它们变红或空转。改了什么：状态行；文件集合的条件文件、D2 第 5 步、Decision Log 第 14 行与 K3、K4 的就地标注；变异说明段；最后一条 Progress、Surprises 末条、Decision Log 第 29–30 行、Outcomes 的重新 rebase 部分。
- Change Note (2026-10-08 22:05 CST，修复者)：rr。为什么改：PR-C 处理了 rebase 之后独立对抗验证的 P3（C10），本 PR 随之再 rebase；同一轮验证给本 PR 留了三项。改了什么：状态行；D0 第 3 步、B2、B10、B12 与 K3 行的就地订正；Validation 的 rr 变异表；rr 的 Progress；Surprises 末条的订正与新增两条；Decision Log 第 31–33 行；Outcomes 的 rr 部分与重新 rebase 部分的 K3 订正。
- Change Note (2026-10-09 00:20 CST，修复者)：r1。为什么改：#293 第一轮 MMP 评审、协调者按人类授权调研后的决定、人类伙伴对承接与 ADR-0011 状态的裁决。改了什么：状态行与上游输入；刷新命令一节与写者守卫的 Superseded 标注；文件集合；B15 与第一轮评审之后的变异表；Decision Log 第 1、4、16、17、19、25、29 行末尾的补记与第 34–46 行、「调研依据」；K2 行；r1 Progress、Surprises 末条、技术债行的订正说明与 Outcomes 的修复轮部分。
- Change Note (2026-10-09 01:42 CST，修复者)：rr2。为什么改：#293 复评轮的 4 条 P3 与 #292 复评轮留给本层的判别用例，全部属实。改了什么：状态行；验收矩阵 B16；Validation 的「复评轮之后的变异」；第 37 行理由、「与相邻工作的接口」的 #134 条目与 Outcomes 遗留条的订正；rr2 Progress、Decision Log 第 47、48 行与 Outcomes 的复评轮部分。
