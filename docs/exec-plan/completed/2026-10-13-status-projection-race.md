# Status Projection Race Repair ExecPlan

> 状态：Completed（2026-10-15：第三轮 MMP 评审 APPROVE，评审修复与两轮独立复评后由评审会话整合发布；Batch 4 的推送、回读与 PR 描述更新以 PR #316 最终 head 的回读为准）
> 创建：2026-10-13（2026-10-15 按 PR #316 全部评审的根因复盘重写 Design / Plan，旧结论就地标注 Superseded；同日经独立计划评审修订，见 `Bottom Change Note`）
> 范围：issue #303 / PR #316：状态命令在一个 Storage 事务内原子读-判-写；对当前凭据不可见的目标（缺失或 redacted）统一以不可重试的 `not_found` 拒绝且无副作用；竞态回归改为「小范围调度探索 + 串行参照预言机」。不改动的边界见 D4。
> 上游输入：`AGENTS.md` §1.1 / §5 / §6 / §7 / §9、`PLANS.md`、`docs/review/responding.md`、issue #303、issue #273、PR #316 全部 review 与 thread、`packages/core/src/status-policy.ts`、`packages/core/src/bootstrap.ts`、`packages/domain/src/errors.ts`、`packages/capabilities/src/result.ts`、`packages/controller/src/commands.ts`、`packages/providers/fake/src/storage.ts`、`packages/storage/sqlite/src/storage-sync.ts`、`tests/e2e/status-policy.test.js`、`tests/contract/suites/storage.js`。

## Purpose / Big Picture

完成后：

1. 规划状态命令（`applyPlanningStatus` → `writePlanningStatus`）的读取、决策与写入落在同一个 Storage 事务里；任何时刻提交的同步（redact、移除、可见内容刷新）都不会被状态命令用旧整行覆盖。
2. 目标对当前凭据不可见（投影缺失，或内容为 redacted）时，命令一律返回同一个 `StatusDecision`：`wrote=false`、`status=unknown`、`error.code=not_found`（`recovery=open_provider`、`retryable=false`）；`reason` 与 `error` 既不随 `RedactionReason` 变化，也不区分缺失与 redacted；不推进任何 revision、不改任何行。
3. 竞态回归不再手工摆放 barrier：对命令与同步两个 actor 在每个抢占点逐一暂停，要求每个调度的可观察结果都等于两种串行顺序之一，并用防空转断言保证每个停点真的命中、两种串行结果都被复现。

最小成功证据：在检出 `fix/status-projection-race` 的工作树根目录，`Validation and Acceptance` 第 1–7 行全部满足；判别力来自第 5 行的变异矩阵，其中原实现 M1 被竞态用例杀死即 #303 AC1 的「改动前为红」。

## Context and Orientation

术语与代码位置：

- **投影**：`WorkspaceProjection`，每个规划条目一行，含 `content`（`work_item` / `change_request` / `redacted` 三态）、展示字段、`planningStatus` 与行 `revision`。
- **同步**：`core.commands.bootstrapWorkspace()`，`packages/core/src/bootstrap.ts` 先用一个事务登记轮次（`beginSyncRound`），读 provider，再由 `commitSync` 在一个 Storage 事务内整批替换投影；内容变化才推进工作区 revision 并整批重盖行 revision（ADR-0012）。同步对每行的 `planningStatus` 直接取 provider 值，这正是 #273 尚未裁决的问题，本计划不改。
- **状态命令**：`core.commands.applyPlanningStatus`（`packages/core/src/context.ts`）→ `writePlanningStatus`（`packages/core/src/status-policy.ts`）；controller 侧 `packages/controller/src/commands.ts` 用幂等重放账本包一层，失败结果按幂等键缓存，整个 `StatusDecision` 作为 `CommandResult.value` 上 wire。
- **Storage 事务语义**：Fake（`packages/providers/fake/src/storage.ts`，`#mutate` 队列，队列内克隆草稿、成功后整体替换）与 SQLite（`packages/storage/sqlite/src/storage-sync.ts`，读写同一条队列，`BEGIN IMMEDIATE` 持有到提交）都把重叠事务串行化、不暴露未提交写入；契约套件 `tests/contract/suites/storage.js` 的「重叠事务串行提交」与「事务未提交的写入不得被事务外的读看到」对两个适配器钉住这一点。两者的根实例读不同：Fake 不排队，直接读最后提交值（返回已提交对象的引用）；SQLite 排在在途事务之后。
- **错误分类**：`packages/domain/src/errors.ts` 的 `RECOVERY_BY_CODE` / `isRetryable`；`packages/capabilities/src/result.ts` 的说明：`not_found` = 「目标对象不存在，或对当前凭据不可见」，`unavailable` = 「平台或网络暂时不可用，可原样重发」。

原缺陷（#303）：原实现在事务外读整行投影，事务内把这份旧整行写回；中间提交的 redact 会被覆盖成 `work_item -> redacted -> work_item`。

#303 验收项（下文以 AC1–AC4 引用）：AC1 确定性的 barrier 式回归复现旧内容复活，且在改动前为红；AC2 redact 或移除提交后，挂起的命令不恢复旧内容、身份或展示字段，拒绝不改最新行；AC3 可见内容刷新与状态命令并发时保留两种被允许的结果，行与工作区 revision 自洽；AC4 `node --test tests/e2e/status-policy.test.js tests/integration/sync-revision-freshness.test.js tests/contract/storage-contract.test.js` 与 `node_modules/.bin/tsc --noEmit` 通过。

评审历程（事实；易失状态以回读为准）：

| review | 对象 head | 结论 | 本计划的判定 |
|---|---|---|---|
| 5487111530 | 18982d93 | CHANGES_REQUESTED：P1 barrier 只包根实例读取，`tx.getPlanningProjection` 不受控，关键断言在 `phase=completed` 下被跳过；P2 缺 missing / revision / 可见刷新判据 | 属实，不过严；「旧实现也能通过」一句不准确（当时旧实现在 2/5 用例上红），但关键断言确实不可达 |
| 5488356890 | 6bf06c8e | APPROVED | 过度结论：未发现删除 redacted 拒绝的变异存活；被同一 head 上的 5489788790 取代 |
| 5489788790 | 6bf06c8e | CHANGES_REQUESTED：P1 tx 分支先放行命令再提交 redacted，`unavailable` 断言不可达，删除 guard 的变异 SURVIVED；P2×1、P3×2 细节在评审者本地文件、未发布 | P1 属实，不过严；「让交错用例证明新实现拒绝」在 barrier 位于串行化事务内部时不可实现，在事务入口之前停住时可实现（本计划 D3 的 k=0 调度） |

两轮 P1 的共同根因见 `Design / Spec` 的「根因复盘」。相关 issue（状态于 2026-10-15 观察，回读 `gh issue view <n> -R SingularityKChen/harness-projects --json state`）：#273 open，状态策略矩阵待人类裁决；#305 closed，经 PR #318 合并，同步轮次 fence；#334 / #335 刷新调度器，`createPlanningReconciler` 尚未接进任何 app（`git grep -n createPlanningReconciler -- apps`，期望无输出、exit 1）。

易失状态回读（在任意检出运行，均需 GitHub 读权限；本文不写死值，期望按最终 push 后判定）：

- `gh pr view 316 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,mergeStateStatus,isDraft,reviewDecision,closingIssuesReferences`：期望 `headRefOid` 等于本地 `git rev-parse HEAD`，`baseRefOid` 等于 `git rev-parse origin/main`，`mergeStateStatus=CLEAN`，`closingIssuesReferences` 含 303。
- `gh pr checks 316 -R SingularityKChen/harness-projects`：期望全部 pass。
- `gh api graphql -f query='query{repository(owner:"SingularityKChen",name:"harness-projects"){pullRequest(number:316){reviewThreads(first:100){nodes{isResolved isOutdated comments(last:1){nodes{author{login} createdAt}}}}}}}'`：期望每条 thread `isResolved=true`，且最后一条评论晚于最终 push。

## Design / Spec

### 根因复盘（症状 → 直接原因 → 根机制 → 使能条件）

| 层 | 症状 | 直接原因 | 根机制 | 使能条件 | 本计划的修正 |
|---|---|---|---|---|---|
| 生产 | 状态命令恢复已 redacted / 已移除 / 已刷新的内容 | 写回事务外读到的整行 | 读-判-写不在 Storage 串行点内，丢失更新 | 命令在根实例上读 | D1：读、判、写同一事务 |
| 证据 | 两轮评审都发现关键断言不可达；第二轮另证删除 redacted guard 的变异存活 | barrier 手工放在某个读点，放行顺序按实现分支（`phase === 'tx'` / root）选择 | 测试编码了「实现在哪里读」，而不是枚举调度、用结果判定；期望按分支手写，某个分支不执行时静默变空 | 没有防空转断言；`gate.source()` 这类结构钉子让等价重构误红、让错误位置的 barrier 看似生效 | D3：调度探索 + 串行参照预言机 + 防空转 |
| 契约 | redacted 拒绝声明 `retryable=true` | 沿用 `start-work.ts` 的 `unavailable` 先例 | 「不可见目标」没有单一的结果定义，各命令自选错误码 | `retryable` / `recovery` 目前没有生产消费者，错误语义缺口不会立刻显形 | D2：状态命令的不可见目标统一为 `not_found`。本层根机制只修到状态命令：Start Work 的同一缺口留在 D4 的 follow-up（#349） |

### D1 · 原子读-判-写（保留 2026-10-12 的生产修复）

`writePlanningStatus` 在 `context.storage.transaction` 内依次读取投影与工作区策略、判定、只在 `decision.wrote` 时写入 `{ ...当前行, planningStatus, revision: advanceRevision() }`。事务内读到的行就是当前已提交行，整行写回等价于只写 `planningStatus` 与 `revision`；不新增字段级写口。不变量：命令的写入要么基于同一事务内读到的行，要么不发生。

被放弃：Storage 原生 CAS / 字段级写口（扩大公共 Storage 端口、两个适配器与契约面，而串行化事务已足够）；命令携带 expected revision 的乐观并发（改 controller wire 形状；没有调用方能提供该 revision，`applyPlanningStatus` 目前没有 UI 调用方）。

### D2 · 不可见目标的统一拒绝：`not_found`

前置条件只有一条：「目标是对当前凭据可见的规划条目」。投影缺失与 `content.contentKind === 'redacted'` 是同一前置条件的两种失败，合并为一个分支，在策略判定之前执行：

- 返回 `{ wrote: false, status: unknown, derived: [], reason: <固定文案>, error: projectError(NotFound, <固定文案>) }`，固定文案为「规划条目不存在或对当前凭据不可见，不写入状态」，`reason` 与 `error.message` 共用；缺失与四种 reason 的整个决策深相等（同一 `entityId` 与策略下）；`confirmedValue`、`attemptedValue` 保持 `undefined`（与同函数其它拒绝一致）。
- 不调用 `putPlanningProjection`、不调用 `advanceRevision`。
- `status=unknown` 是固定占位，不透出存量值，所以不泄露信息。存量值因 provider 而异（`packages/core/src/planning-fields.ts` 先判 `nativeValues === undefined`，再判 redacted）：带 `nativeValues` 的 provider（GitHub Projects 总是带）上 redacted 行的存量就是 `unknown`；没有原生字段读取面的 provider（Fake）沿用它给的 `statusKey`，redacted 行可以留着旧状态。
- 顺序：可见性先于策略。缺失行无法进入 `decideFromCommand`（`origin/main` 已如此）；redacted 行的状态是固定占位 `unknown`，拿它做策略比较没有意义。代价是 `provider_authoritative` 下不可见目标得到 `not_found/open_provider` 而不是 `not_supported/manual_execution`：两者都指向「到平台处理」，工作区策略对调用方本就可见，两种顺序都不泄露条目信息。
- 同步对「按成员关系也找不回实体」的条目报 `permission_denied`（`packages/core/src/bootstrap.ts`）：那是整轮读取的缺口，没有命令目标，与 D2 不冲突。

理由：`not_found` 的定义本身就是「不存在，或对当前凭据不可见」，恢复动作 `open_provider` 正确，`retryable=false` 正确（原样重发必然再次失败；controller 重放账本还会按幂等键缓存这次失败）。仓库已有同类裁决：`docs/exec-plan/completed/2026-10-01-start-work-sqlite-prerequisites.md` 记录「永久冲突误报成可重试的 `unavailable`，是产品语义退化」。业界口径一致：gRPC `UNAVAILABLE` 只用于「原样重试同一调用即可」的瞬时故障，AIP-194 只允许自动重试 `UNAVAILABLE`；GitHub Projects 对无权查看的条目返回 `REDACTED`，REST 对私有资源有意以 404 代替 403。

被放弃：

| 方案 | 放弃原因 |
|---|---|
| 保持 `unavailable` | 违反仓库自己的错误分类，宣称可原样重发 |
| `permission_denied` | `fix_permission` 对 `deleted` 不成立；GitHub provider 只产出 reason `unavailable`（`packages/providers/planning-github-projects/src/decode.ts`） |
| `RedactionReason → ProjectErrorCode` 映射表 | 透出撤权与删除的区别，违反 `packages/ui/src/work-item-list.ts` 的「不透出是否撤权或删除」 |
| 新增 `failed_precondition` | 打破 11 个调用方码的闭集（`tests/contract/capabilities-errors.test.js` 钉住），需要 ADR，收益只是措辞 |

公开行为影响：`applyPlanningStatus` 对 redacted 目标的 `CommandResult.error` 由 `unavailable/retry/true` 变为 `not_found/open_provider/false`，缺失目标的 `reason` 与 `error.message` 改为固定文案。该拒绝本身是本 PR 新增（`origin/main` 上直接写入），MMP 前无真实用户，可逆，无枚举或接口变更；在 PR 描述「Public behaviour」小节显式标注，由评审者确认。

### D3 · 竞态证据：小范围调度探索 + 串行参照预言机

**Actor 与抢占点**：命令（`applyPlanningStatus`）与同步（先改 provider 状态，再 `bootstrapWorkspace`）各跑一次。用 `AsyncLocalStorage` 给每个 Storage 调用打 actor 标签；抢占点 = 某个 actor **不在自己事务体内**时发出的每个 Storage 调用（含 `transaction` 入口本身），停在调用发出之前。事务体由 Storage 契约保证原子；根实例调用在两个适配器上也都等价于排在某个在途事务整体之前（Fake 根读不排队，读最后提交值）或之后（SQLite 根读排队），所以事务体内不设抢占点不丢可达结果。调度里停住的一方总停在自己事务体之外，另一方运行时没有在途事务，两种适配器的这一差异不进入调度。当前实现命令只有 1 个抢占点（`transaction` 入口），同步有 2 个（`beginSyncRound` 与 `commitSync` 的事务入口），三场景、两适配器实测一致（见 `Surprises & Discoveries`）；命令只有一个原子单元时，抢占界 1 的调度就是两者原子单元的全部交错（CHESS 式抢占界；小范围假设见 Alloy）。

**调度**：对 `who ∈ {command, sync}` 和 `k = 0..N`（N = who 的抢占点数，k = N 表示不停），让 who 单独运行到第 k 个抢占点之前停住，另一个 actor 完整跑完后放行 who。每个调度使用全新且确定的工作区（固定 workspace / binding / entity / identity / relation id 与时钟）；同一适配器内的结果直接 `isDeepStrictEqual`，不做归一化。竞态期间不分配新 id；若将来分配且顺序随调度变化，只会假红（fail closed）。

**预言机**：同一 fixture 上分别串行执行「命令→同步」与「同步→命令」，得到两个参照结果；每个调度的可观察结果必须深相等于其中之一。可观察结果 = 命令决策（`wrote`、`status`、`error.code`）、同步结果（`ok`、`error.code`）、目标行、其它行、目标实体的外部身份、`getItemDetail`、工作区 revision。期望来自实现自己的串行运行，所以断言不绑定读点位置，也不绑定 #273 的同步状态策略（#273 改变同步行为时，两个参照结果随之改变，用例仍然成立）。据此，AC3 的「保留两种被允许的结果」解释为「等于两种串行顺序之一」：#273 裁决前，「命令→同步」下同步按 provider 值覆盖状态是被允许的串行结果，不是本 PR 的缺陷。预言机只判「等于某个串行结果」，两个参照一致地错时它也通过，所以 refresh 的两个串行参照本身另有绝对断言（见下文「参照用例」）。

**防空转**（每条都对应一次已发生的评审缺陷）：

1. 每个 actor 单独执行都必须改变工作区（`mid ≠ initial`），否则交错没有可观察的差异。
2. 每个 actor 至少有一个抢占点；每个 k < N 的调度必须真的停住（`paused === true`），k = N 不停。
3. 没有未打标签的 Storage 调用（标签丢失即失败，而不是静默归入另一方）。
4. 在 k = 0 停住必须复现「另一方先行」的串行结果，不停必须复现「自己先行」的串行结果——两种串行结果都被实际观察到。

**场景**：`redact`（provider 条目改为 redacted）、`remove`（`removeItem`）、`refresh`（标题与目标日期改变，且 provider 状态改为 `todo`，与命令的 `done` 不同，不掩盖 #273）；Fake 与 SQLite 各一遍。夹具里的工作项带原生字段（`nativeValues`：状态单选、迭代、目标日期），工作区配置对应的 `planningFieldMapping`，所以目标行有展示字段，「状态命令用旧展示字段覆盖新值」在成功写入路径上可观察。Fake 种子本身只有 `statusKey`，没有展示字段。

**串行规格用例**（预言机只判「等价于某个串行结果」，不判串行结果本身对不对，所以保留）：「同步→命令」后命令必须被 D2 拒绝，且命令前后的观察结果深相等；redact 场景对四种 `RedactionReason` 各跑一遍，另有一个去掉 `nativeValues` 的 redact 变体，走 Fake 的 `statusKey` 分支，前置条件是 redacted 行留着非 `unknown` 的旧状态。正向一条：状态选项从一开始就不在映射里的条目可见、状态为 `unknown`，命令照常写入。这两条钉住「可见性按内容判定，不按状态是否为 `unknown` 判定」（R10）。带原生字段的 redacted 行同步后是不是 `unknown` 取决于 #273 的同步策略，不作前置条件。

**参照用例**（AC3 的绝对判据，两适配器各一条）：refresh 的两个串行参照都要保留新标题与新展示字段；目标行 revision 等于工作区 revision，且两个操作各推进一次；其它行的内容不变，命令不碰其它行。「同步→命令」下状态为命令值 `done`。「命令→同步」下状态允许 `todo` 或 `done`：前者是 #273 裁决前的现状（同步按 provider 值覆盖 Host 状态），后者是「同步保留 Host 状态」的修法（E2）。只写死 `todo` 会让 E2 变红，所以这一格是二选一，#273 落地时再收紧为其中之一。

**命名约定**：三类用例各用一个词开头——预言机用例名含「竞态」，串行规格用例名含「串行」，参照用例名含「参照」；三个词两两互不出现在别类的用例名里。变异矩阵的 `killedBy` 依赖这三个词（夹具按失败用例名做子串归因，见 `Surprises & Discoveries` 2026-10-15 / Batch 3 与第三轮评审复评）。当前 `--test-name-pattern` 命中数：竞态 6、串行 14、参照 2。

**被放弃**：

| 方案 | 放弃原因（证据见 `Surprises & Discoveries`） |
|---|---|
| 保留现有交错用例、只删 `gate.source()` / `decision.wrote` 钉子 | M6、E3 存活；只包 `getPlanningProjection` 的 barrier 在等价重构 E1 下不触发、用例空转变绿；refresh 用例把 provider 状态设成 `done` 才通过，掩盖 #273 |
| 只暂停命令、在每个调用处都停 | 命令 5 个调用中 4 个在事务体内，在契约下冗余，需要「是否持有事务」分支；漏掉同步一侧的竞态（E3 存活） |
| 双方在每个调用处都停 | 同步 28–30 个调用（remove 28，redact / refresh 30）只有 2 个在事务体外，约 35 个调度、没有额外判别力 |
| DPOR / Loom 式多次抢占模型检查 | 两个 actor 不需要这套机制 |

**残余风险**：抢占界为 1，命令将来若有 ≥ 2 个原子单元，需要双方同时被抢占的缺陷不在覆盖内（界 2 的成本是 N_command × N_sync）；健全性依赖 Storage 契约，不隔离的适配器由契约套件而不是本用例发现；`holding` 按 actor 标签记录在途事务，假设同一 actor 内没有并发分支，否则它持有事务期间从根实例发出的调用会被记为原子；Fake 根读返回已提交对象的引用（#311），观察值的深相等依赖没有原地改写，SQLite 每次读出新对象，两适配器并跑兜住这一点。

### D4 · 范围边界

- 不改：schema、Storage 端口、controller wire 形状、#273 的策略矩阵、#305 的轮次 fence。
- `packages/core/src/start-work.ts` 的 `prepareRegistration` 对 redacted 目标同样返回 `unavailable`，且在根实例预检投影、另开事务登记（同形 TOCTOU，但不写回投影，不会复活内容）：同一错误语义缺口，属于已合并、已写入文档的 Start Work 行为（`tests/integration/start-work-sqlite-registration.test.js`、`docs/product/vertical-path.md`）。follow-up 是 #349 `fix(core): reject redacted Start Work targets with a non-retryable not_found`（第三轮评审会话于 2026-10-15 开立，`kind:fix`、`area:core`）。#349 的验收也包括上面的同形 TOCTOU：可见性检查与登记写入必须在同一个 Storage 事务里。
- `packages/core/src/relations.ts` 的 `confirmRelation` 在根实例 `listRelations` 后整行 `putRelation`，与 #303 同形；当前是否存在与之并发的关系写者没有核实，不在本 PR 判定。**Superseded by 本条下一行（2026-10-15）**。
- `confirmRelation` 核实结论（2026-10-15 / 主控 agent）：形状同形，但丢失更新不可达。关系的写者只有 `confirmRelation`（把已有边整行改为 `confirmed`）与 `recordEdges`（只新建缺失的边、从不改已有边）；Storage 的 `putRelation` 在同一次队列变更内按 `(from, to, type)` upsert，且同键已有 `confirmed` 时写入 candidate 是 no-op（`packages/providers/fake/src/storage.ts` 与 `packages/storage/sqlite/src/storage-execution.ts` 的「候选不得降级已确认」，契约套件 `tests/contract/suites/storage-execution.js` 对两个适配器钉住）。因此并发的 `recordEdges` 不能降级确认，并发确认是幂等的，不开 follow-up。
- 理由：`docs/review/responding.md` §2「不把不相关的清理、模型迁移或架构重写混入回复」与 §3「P2/P3 只有在改动机械、范围清晰时才顺手修；否则留在 issue 或 PR 级 follow-up」。Start Work 一项的 follow-up 已登记为 #349。

### 原 2026-10-13 设计条目（保留原文，按 PLANS.md §4 就地标注）

1. 直接 redacted 拒绝是主判据……必须返回 wrote=false 与结构化 unavailable。**Superseded by D2（2026-10-15）**：错误码改为 `not_found`；直接用例改写为 D3 的「串行规格用例」。
2. 直接 missing 拒绝……必须返回 not_found，目标仍不存在，另一个控制行和 workspace revision 深相等。**Superseded by D3 串行规格用例（2026-10-15）**：语义不变，改由共享 fixture 与观察函数表达。
3. 真实交错用例：barrier 必须包住 transaction scope 中实际的 tx.getPlanningProjection……固定实现的 tx phase 必须执行 redacted/missing guard。**Superseded by D3（2026-10-15）**：该句不成立——停点在串行化事务内部时同步无法先提交，guard 不可达；改为枚举抢占点。
4. 范围边界：不修改 schema、Storage port、controller/wire、#273 状态策略矩阵或 #305 round ordering。CAS Storage 方案作为被否决的替代方案记录。仍有效，并入 D1 / D4。

## Global Constraints

- 本计划改动的文件集合（只在此声明一次）：`packages/core/src/status-policy.ts`、`tests/e2e/status-policy.test.js`、`tests/e2e/controller-roundtrip.test.js`、`docs/exec-plan/active/2026-10-13-status-projection-race.md`（归档后为 `completed/`）、`docs/README.md`，以及评审会话随整合加入的评审记录 `docs/review/pr-316-mmp-review.md`。原 2026-10-13 约束「只改 tests/e2e/status-policy.test.js 与本计划；代码 ≤ 800、文档 ≤ 1300 行」**Superseded by 本条与 D2（2026-10-15）**。
- PR 仍用 `Closes #303`；不新建重复 issue / PR；不写 Project `Status`、`blocked-by`、`blocking`；不合并。
- 规模：代码 ≤ 1000 行、文档 ≤ 1500 行（`node scripts/rule-checks.mjs size origin/main`）。
- TDD：行为变化先写会失败的判别性用例，观察失败原因落在被测断言上（不是解析或夹具错误），再改实现。
- 并行所有权：每批只写自己「涉及文件」所列文件；本计划与 `docs/README.md` 只由 Batch 3 写。Batch 1 / 2 把 Progress、Surprises、Decision 候选写进执行报告交给 Batch 3。理由：两批各自追加相邻的 Progress 行会在合入时冲突，违反同一文件单一 owner（`AGENTS.md` §5）。
- 并行起点：Batch 1 / 2 的工作区都从包含本计划 2026-10-15 修订的 `fix/status-projection-race` 提交建立（先在主检出以 `docs(exec-plan)` 提交本计划并推送，作为远端恢复锚点；Batch 4 再整理提交序列）；新工作区先运行 `pnpm install --frozen-lockfile`，否则 `node --test` 解析不到 workspace 包，`node_modules/.bin/tsc` 也不存在。
- 隔离工作区位于 `.worktrees/<task-slug>/`。变异夹具 `scripts/review-mutate.mjs` 的 spec 属运行态内容，放在执行检出根目录下的 `.superpowers/status-race/`（已被 `.gitignore` 忽略），内容由 `Validation and Acceptance` 的变异定义表推出，不进 `docs/`；夹具要求基线全绿，基线红时 exit 2、结论不可用。
- 提交格式 `<type>(<scope>): <中文摘要>`，正文说明为什么，末尾 `Refs #303`；最终 push 前整理为可独立审阅的提交序列，建立 backup ref 后用精确 old head 的 force-with-lease。
- 发布面：提交与 push 前运行 `node scripts/rule-checks.mjs disclosure origin/main` 并人工过五类目；文档与提交信息不写本机绝对路径、内部地址或端口。

## Plan of Work

### Batch 0 · 重锁到当前 main（已完成）

**最小闭环**：PR 分支 rebase 到当前 `origin/main`，解决 `docs/README.md` 索引表冲突（两侧新增行都保留）。
**涉及文件**：`docs/README.md`。
- [x] 建立本地 backup 分支后 rebase，精确 old head 的 force-with-lease 推送。
**验证**：在检出 `fix/status-projection-race` 的工作树根目录运行 `node --test tests/e2e/status-policy.test.js tests/integration/sync-revision-freshness.test.js tests/contract/storage-contract.test.js` 与 `node_modules/.bin/tsc --noEmit`；期望全部通过、exit 0。
**回滚**：重置到 backup 分支。

### Batch 1 · 不可见目标的统一拒绝（D2）

**最小闭环**：controller wire 上，对 redacted（四种 reason）与缺失目标的状态命令返回同一个 `CommandResult`（`writeState=failed`，`error` 为 `not_found / open_provider / retryable=false`），换幂等键重发结果不变，且无写入。
**涉及文件**：`packages/core/src/status-policy.ts`、`tests/e2e/controller-roundtrip.test.js`。
**工作区**：`.worktrees/status-race-contract/`，分支 `fix/status-race-contract`（起点见 `Global Constraints`「并行起点」）。
- [x] 先在 `tests/e2e/controller-roundtrip.test.js` 增加用例（用例名含「不可见」）：同一 fixture 里把目标 provider 条目依次改为四种 `RedactionReason` 的 redacted 并同步，各发一次状态命令；再 `removeItem` 并同步后发一次。断言每次 `writeState=failed`，`error` 的 `code/recovery/retryable` 为 `not_found/open_provider/false`；五次的整个 `CommandResult`（含 `value.reason`）两两深相等；换新幂等键重发与首发深相等；命令前后 `currentRevision` 不变。运行确认在当前实现上失败，且失败断言是 `unavailable` 对 `not_found`。
- [x] 改 `writePlanningStatus`：缺失与 redacted 合并为一个分支，改用 `ProjectErrorCode.NotFound`，`reason` 与错误文案共用 D2 的固定文案，删除不再使用的 import。
- [x] 变异自检：在本工作区写 `.superpowers/status-race/contract.json`，`command` 为 `["node","--test","tests/e2e/controller-roundtrip.test.js"]`，变异 B1–B3（定义见变异定义表）。
**验证**：在 `.worktrees/status-race-contract/` 依次运行 `pnpm install --frozen-lockfile`、`node --test tests/e2e/controller-roundtrip.test.js`（期望 `# fail 0`）、`node_modules/.bin/tsc --noEmit`（期望 exit 0）、`node scripts/review-mutate.mjs .superpowers/status-race/contract.json`（期望 exit 0，B1–B3 全部 KILLED）。本工作区里 `tests/e2e/status-policy.test.js` 的直接 redacted 用例会因期望 `unavailable` 变红——它属 Batch 2，Batch 1 不改，写进执行报告。
**回滚**：丢弃该分支；生产与测试改动同在一个提交内。

### Batch 2 · 竞态证据重建（D3）

**最小闭环**：`tests/e2e/status-policy.test.js` 的 #303 部分由调度探索 + 串行参照预言机 + 串行规格用例组成；删除手工 barrier。
**涉及文件**：`tests/e2e/status-policy.test.js`。
**工作区**：`.worktrees/status-race-explorer/`，分支 `test/status-race-explorer`（起点见 `Global Constraints`「并行起点」）；原型参考 `.worktrees/research-schedules/tests/e2e/status-policy.test.js`（未提交的研究原型，只读参考）。
- [x] 按 D3 实现 `instrument`、确定性 `raceFixture`、`runSerial`、`runSchedule` 与三场景 × 两适配器的预言机用例；文件头注释写明抢占点依赖的 Storage 契约；用例名遵守 D3 的命名约定。
- [x] 串行规格用例：redact（四种 reason）与 remove 都期望 `[wrote, code] = [false, 'not_found']`，命令前后观察结果深相等。当前实现上 redact 的串行规格用例应因 `unavailable` 失败；转绿核对：临时把 `packages/core/src/status-policy.ts` redacted 分支的 `ProjectErrorCode.Unavailable` 改为 `ProjectErrorCode.NotFound`，确认转绿后还原，`git diff --exit-code -- packages/core/src/status-policy.ts` 期望 exit 0（不提交生产文件）。
- [x] 删除 `gatedProjectionRead`、`finishInterleaving`、`visibleWorkItem`、`providerWorkItem`、`Promise.race(ready vs completed)` 相位逻辑、全部 `gate.source()` / `decision.wrote` 钉子、`statusKey: 'done'`，以及被串行规格用例取代的四条直接用例；能复用 `workItemIdOf` 等既有帮助函数的不再重复实现。
- [x] 夹具自检：在本工作区写 `.superpowers/status-race/fixture.json`，`command` 为 `["node","--test","--test-name-pattern=竞态","tests/e2e/status-policy.test.js"]`（只跑预言机用例：本工作区 redact 串行规格用例在 Batch 1 合入前为红，夹具要求基线全绿），变异 V1、V2、V4、V5、M3、M6、E3。M1 / M2 的锚点依赖 Batch 1 改后的文本，完整矩阵留给 Batch 3。
**验证**：在 `.worktrees/status-race-explorer/` 依次运行 `pnpm install --frozen-lockfile`；`node --test tests/e2e/status-policy.test.js`（期望只有 redact 串行规格用例失败，失败断言是 `not_found` 对 `unavailable`）；`node --test --test-name-pattern=竞态 tests/e2e/status-policy.test.js`（期望 `# fail 0`）；`node_modules/.bin/tsc --noEmit`（期望 exit 0）；`node scripts/review-mutate.mjs .superpowers/status-race/fixture.json`（期望 exit 0，全部 KILLED）；`Validation and Acceptance` 第 6 行的循环加上 `--test-name-pattern=竞态`（期望无输出）。
**回滚**：丢弃该分支；测试改动单独成一个提交。

### Batch 3 · 集成、对抗验收与重构

**最小闭环**：两批合入 PR 分支后，独立验收者复现全部判据、做不改变验收结果的重构，并把各批执行报告合并进本计划。
**涉及文件**：本计划、`docs/README.md`，以及验收中发现问题的上述文件。
- [x] 把 `fix/status-race-contract` 与 `test/status-race-explorer` 合入 `fix/status-projection-race`（两批文件不重叠，期望无冲突），运行 `Validation and Acceptance` 第 1–4、6、7 行。
- [x] 变异矩阵：以合入后的源码为锚点写 `.superpowers/status-race/kill.json` 与 `equiv.json`（变异定义表），运行第 5 行。
- [x] 对抗验收：检查断言是否可能空转、是否钉住实现结构、`CommandResult` 是否泄露 reason；读代码核对 D1–D4 与不变量。
- [x] 重构后重跑第 1–7 行；把各批执行报告并入 Progress / Surprises / Decision Log；更新 `docs/README.md` 索引行文字。
**验证**：`Validation and Acceptance` 第 1–7 行全部满足。
**回滚**：PR 分支重置到合入前的 head。

### Batch 4 · 整理提交与发布

**最小闭环**：提交序列可逐个验证、按依赖回滚；push 后回读远端，逐条回复评审并请求复审。
- [x] 重锁检查：`git fetch origin --prune && git merge-base --is-ancestor origin/main HEAD`，期望 exit 0；否则先按 Batch 0 重锁。（评审会话 2026-10-15 整合发布时执行；结果以 PR #316 最终 head 的回读为准，不在本文写值）
- [x] 按文件集合重建三个提交（不用交互式 rebase），提交信息按 `Global Constraints`：（评审会话 2026-10-15 整合发布时执行；结果以 PR #316 最终 head 的回读为准，不在本文写值）

  ```sh
  old=$(git rev-parse HEAD); lease=$(git rev-parse origin/fix/status-projection-race)
  git branch "backup/pr-316-$(git rev-parse --short HEAD)" "$old"
  git reset --soft origin/main && git restore --staged .
  git add packages/core/src/status-policy.ts tests/e2e/controller-roundtrip.test.js && git commit   # fix(core)：D1 + D2 + controller 用例
  git add tests/e2e/status-policy.test.js && git commit                                               # test(core)：D3
  git add docs/exec-plan/active/2026-10-13-status-projection-race.md docs/README.md && git commit      # docs(exec-plan)
  git diff --exit-code "$old" HEAD && git status --short                                             # 期望均无输出：只改历史不改内容
  git rebase --exec 'node --test tests/e2e/status-policy.test.js tests/e2e/controller-roundtrip.test.js' origin/main   # 期望每个提交都绿、SHA 不变
  ```

  依赖：`fix(core)` 中 `tests/e2e/status-policy.test.js` 仍是 `origin/main` 版本，所以三个提交各自为绿；单独回滚 `test(core)` 仍绿（只丢证据）；单独回滚 `fix(core)` 会让 `test(core)` 变红（即 AC1 的红灯），因此回滚顺序为先 `test(core)` 后 `fix(core)`，或整 PR 回滚。
- [x] 按 D4 开 Start Work 的 follow-up issue（先 `gh issue list -R SingularityKChen/harness-projects --state all --search "start work redacted"` 去重；标题与标签按 `AGENTS.md` §8；开 issue 是外部写入，先取得人类伙伴确认），编号回填 D4 与 PR 描述。原「开两个」**Superseded by D4 `confirmRelation` 核实结论（2026-10-15）**。结果：第三轮评审会话开立 #349，编号已回填 D4；PR 描述的回填随下一项发布执行（回读 `gh issue view 349 -R SingularityKChen/harness-projects --json state,labels`）。
- [x] `git push --force-with-lease=fix/status-projection-race:"$lease" origin HEAD:fix/status-projection-race` → 按 `Context and Orientation` 的回读清单回读 → 更新 PR 描述（含 Public behaviour、AC3 的解释、follow-up 编号）→ 回复两条既有 thread 并在 PR 评论汇总根因修复与证据 → 请求复审。（评审会话 2026-10-15 整合发布时执行；结果以 PR #316 最终 head 的回读为准，不在本文写值）
**验证**：`Validation and Acceptance` 第 7 行；回读清单的期望全部成立。
**回滚**：确认 `git status --short` 无输出后 `git reset --hard "$old"`（命令块里的整理前 head，即新建 backup 分支所指），再以精确 lease 回推。

## Validation and Acceptance

| # | 验收项 | 判定证据（在检出 `fix/status-projection-race` 的工作树根目录运行） |
|---|---|---|
| 1 | AC4 | `node --test tests/e2e/status-policy.test.js tests/integration/sync-revision-freshness.test.js tests/contract/storage-contract.test.js` 期望 `# fail 0`；`node_modules/.bin/tsc --noEmit` 期望 exit 0 |
| 2 | 不可见目标统一拒绝（D2） | `node --test tests/e2e/controller-roundtrip.test.js` 期望 `# fail 0`；其中「不可见」用例覆盖四种 reason 与缺失目标：`error` 为 `not_found/open_provider/false`，整个 `CommandResult` 两两深相等，换键重发不变 |
| 3 | AC2：拒绝无副作用 | `tests/e2e/status-policy.test.js` 的串行规格用例：命令前后目标行、其它行、身份、详情、工作区 revision 深相等（Fake、SQLite） |
| 4 | AC2 / AC3：交错可串行化 | `node --test --test-name-pattern=竞态 tests/e2e/status-policy.test.js` 期望 `# pass 6`（三场景 × 两适配器）、`# fail 0`，防空转断言全部成立；AC3 的串行参照本身：`node --test --test-name-pattern=参照 tests/e2e/status-policy.test.js` 期望 `# pass 2`（两适配器）、`# fail 0` |
| 5 | AC1 与判别力 | `node scripts/review-mutate.mjs .superpowers/status-race/kill.json` 期望 exit 0、SUMMARY 全部 KILLED（无 KILLED_OTHER / NOT_APPLIED），且 M1 的 failing 列表含 Fake 与 SQLite 两侧的竞态用例；`node scripts/review-mutate.mjs .superpowers/status-race/equiv.json` 期望 exit 1 且 SUMMARY 全部 SURVIVED（即保持绿；NOT_APPLIED 不算）。两份 spec 的 `command` 均为 `["node","--test","tests/e2e/status-policy.test.js"]` |
| 6 | 稳定性 | `for i in $(seq 1 10); do node --test tests/e2e/status-policy.test.js >/dev/null \|\| echo FAIL $i; done` 期望无输出 |
| 7 | 发布门禁 | `pnpm verify`、`node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD` 全部 exit 0；最终 push 后 `gh pr checks 316 -R SingularityKChen/harness-projects` 全部 pass |

变异定义表（锚点按执行检出的当前源码写，且必须恰好出现一次；B* 的 spec 见 Batch 1，fixture 子集见 Batch 2）：

| id | 文件 | 变换 | spec | 期望 | killedBy |
|---|---|---|---|---|---|
| M1 | `packages/core/src/status-policy.ts` | `workspacePolicy` 与 `writePlanningStatus` 两个函数整体替换为 `git show origin/main:packages/core/src/status-policy.ts` 中的同名函数（原实现） | kill | KILLED | 竞态 |
| M2 | 同上 | 不可见分支条件中的 redacted 判定（`… === ContentKind.Redacted`）替换为 `false`，缺失判定保留 | kill | KILLED | 串行 |
| M3 | 同上 | 事务前加 `const stale = await context.storage.getPlanningProjection(context.workspaceId, command.entityId)`，事务内以 `stale` 代替 `tx.getPlanningProjection(…)` 的结果，拒绝与策略判定照常 | kill、fixture | KILLED | 竞态 |
| M6 | 同上 | 事务内只读取、判定并返回决策与读到的行；`decision.wrote` 时另开第二个事务写入该行 | kill、fixture | KILLED | 竞态 |
| E3 | `packages/core/src/bootstrap.ts` | `commitSync` 事务前以根实例 `context.storage.listPlanningProjections(workspaceId)` 预读各行状态；事务内 `upsertItems` 之后，工作区策略为 `host_authoritative` 时已有行的 `planningStatus` 取该预读值（错误的 #273 修法） | kill、fixture | KILLED | 竞态 |
| V1 | `tests/e2e/status-policy.test.js` | `runSchedule` 启动被停 actor 时不经 `AsyncLocalStorage.run` | kill、fixture | KILLED | 竞态 |
| V2 | 同上 | 事务回调内用 `actor.exit` 丢弃 actor 标签 | kill、fixture | KILLED | 竞态 |
| V4 | 同上 | 停点下标比较改为 `k + 1000`（停点永不触发） | kill、fixture | KILLED | 竞态 |
| V5 | 同上 | 同步 actor 不施加 provider 变化 | kill、fixture | KILLED | 竞态 |
| E1 | `packages/core/src/status-policy.ts` | `tx.getPlanningProjection(…)` 改为 `(await tx.listPlanningProjections(context.workspaceId)).find((row) => row.entityId === command.entityId)`（等价重构） | equiv | SURVIVED | — |
| E2 | `packages/core/src/bootstrap.ts` | 同 E3，但保留值取自事务内的 `before`（正确的 #273 修法模拟） | equiv | SURVIVED | — |
| S1 | `packages/core/src/bootstrap.ts` | `commitSync` 事务内 `upsertItems` 之后，`before` 里已有行的 `planningStatus` 与本轮值不同时，该行保留旧 `content`（同步在状态分歧时丢掉可见内容刷新；编号沿用第三轮评审记录） | kill | KILLED | 参照 refresh |
| R8b | `packages/core/src/status-policy.ts` | 事务前以根实例预读目标行；事务内读到的行只把 `planningFields` 换成预读值（预读带该键时才换，避开键存在性差异），content 与状态仍取事务内读值 | kill | KILLED | 竞态：状态命令与 refresh |
| R10 | `packages/core/src/status-policy.ts` | 不可见分支条件中的 redacted 判定换成 `projection.planningStatus === NormalizedStatus.Unknown`（按状态而不是内容判定可见性；编号沿用第三轮评审复评） | kill | KILLED | statusKey 分支 |
| B1 | `packages/core/src/status-policy.ts` | 不可见分支的 `ProjectErrorCode.NotFound` 改为 `ProjectErrorCode.Unavailable` | contract | KILLED | 不可见 |
| B2 | 同上 | 错误文案末尾拼接 `projection?.content.contentKind === ContentKind.Redacted ? projection.content.reason : ''` | contract | KILLED | 不可见 |
| B3 | 同上 | 同一表达式拼进 `reason` 字段，错误文案不变 | contract | KILLED | 不可见 |

## Progress

- [x] 2026-10-12：生产修复 D1（事务内读-判-写）与首版交错用例。
- [x] 2026-10-13：直接 redacted / missing 用例、barrier 改包事务作用域；删除重复的旧 active 计划（其中的三方案比较与不变量已并入本计划 D1 / D2）。
- [x] 2026-10-15：Batch 0 完成：rebase 到当前 `origin/main` 并推送；AC4 命令组 216/216、typecheck 通过（检出 `fix/status-projection-race` @ 8300d10；同日独立计划评审在同一 head 复跑，结果相同）。
- [x] 2026-10-15：三路独立调研（测试方法、错误语义、评审审计）完成，结论并入 Design / Spec。
- [x] 2026-10-15：独立计划评审完成，修订见 `Bottom Change Note`。
- [x] 2026-10-15：并行起点：在主检出以 `docs(exec-plan)` 提交并推送本计划修订（`fix/status-projection-race` @ 7196cbb，当时 `git rev-parse origin/fix/status-projection-race` 读回同一 SHA）；两批工作区都从 7196cbb 建立。
- [x] 2026-10-15：Batch 1 完成（`.worktrees/status-race-contract`，分支 `fix/status-race-contract` @ 3f1acf6，基于 7196cbb，只改 `packages/core/src/status-policy.ts` 与 `tests/e2e/controller-roundtrip.test.js`）：`writePlanningStatus` 把缺失与 redacted 合并为一个先于策略的分支，返回 `not_found`（`open_provider`、`retryable=false`），`reason` 与 `error.message` 共用 D2 固定文案；controller「不可见」用例在 `harness_managed` 与 `source_managed` 两种策略下各跑四种 `RedactionReason` 与移除后缺失：整个 `CommandResult` 两两深相等、换幂等键重发不变、工作区 revision 与目标行不变，并对 `wrote=false`、`status=unknown`、`derived=[]`、策略字段与固定文案做绝对断言。红灯：改动前失败于 `['unavailable','retry',true]` 对 `['not_found','open_provider',false]`，失败在被测断言而非夹具（独立验收者经变异夹具把生产区域还原到 7196cbb 复现，同一断言）；绿灯：controller 20/20、`tsc --noEmit` exit 0；`contract.json` 的 B1–B3 全部 KILLED。首轮独立验收 FAIL（N7 / N8 存活，见 Surprises），补强后 amend 为同一提交（59ac1ce → 3f1acf6），复验通过。
- [x] 2026-10-15：Batch 2 完成（`.worktrees/status-race-explorer`，分支 `test/status-race-explorer` @ 6340e90，基于 7196cbb，只改 `tests/e2e/status-policy.test.js`，+145 / -159）：按 D3 实现 `instrument`、确定性 `raceFixture`、`runSerial`、`runSchedule`，预言机用例三场景 × 两适配器共 6 条，串行规格用例 remove 与四种 reason × 两适配器共 10 条；计划列出的旧 barrier 帮助函数、相位逻辑、钉子、`statusKey: 'done'` 与四条旧直接用例全部删除。单独检出时全文件 19 条中 8 条红，恰为 redact 串行规格用例（`[false,'unavailable']` 对 `[false,'not_found']`）；临时改错误码后 19/19，还原后 `git diff --exit-code -- packages/core/src/status-policy.ts` exit 0；竞态 6/6，稳定性循环 10 次无输出；`fixture.json` 的 V1 / V2 / V4 / V5 / M3 / M6 / E3 全部 KILLED。独立验收 PASS，无阻断项。
- [x] 2026-10-15：Batch 3 完成（主检出 `fix/status-projection-race`：`--no-ff` 依次合入两批，无冲突，得 1426aea；其后是验收重构 aa3287c 与本文档提交。合入提交只作集成用，Batch 4 按文件集合重建；回读 `git log --oneline origin/main..fix/status-projection-race`）：第 1–6 行满足；第 7 行中 workflow-check、disclosure、size、diff-check 均 exit 0，`pnpm verify` 在本沙箱未 exit 0（环境原因见 Surprises），gh 回读留给 Batch 4；变异矩阵与自加变异见 Outcomes；验收重构只改一处类型标注与两个用例名，不改断言；各批执行报告已并入 Progress / Surprises / Decision Log。
- [x] 2026-10-15：Batch 4 提交整理（主检出 `fix/status-projection-race`，base `origin/main` @ 21cb29e，`git merge-base --is-ancestor origin/main HEAD` exit 0，无需重锁）：按文件集合重建为 `fix(core)` → `test(core)` → `docs(exec-plan)` 三个提交，`git diff --exit-code <整理前 head> HEAD` 无输出，`git rebase --exec` 逐提交运行两个 e2e 文件全绿；整理前 head 保存在 `backup/pr-316-` 前缀的本地分支。
- [x] 2026-10-15：Start Work follow-up 登记为 #349（第三轮评审会话开立，`kind:fix`、`area:core`），编号回填 D4 与 Batch 4。
- [x] 2026-10-15：第三轮评审（review 5530341235，APPROVE）意见处置：F1 / F3 补强 `tests/e2e/status-policy.test.js`，F4 改写 D2 理由，F2 改为引用 #349；F5 / F6 与 PR 正文的 AC3 解释留给整合提交与发布。逐条处置与证据见 Decision Log 同日条目（检出 `.worktrees/status-projection-race-r3`）。
- [x] 2026-10-15：第三轮评审修复的复评（P0–P2 为 0）另提 4 条 P3：N1 补 `statusKey` 分支的 redact 变体与「未映射状态照常写入」正向用例，N2 把参照用例改名，N3 在 Surprises 引用 #201，N4 补 #349 的事务验收与开立依据。处置见 Decision Log 同日条目。
- [x] Batch 4 发布：push、回读、更新 PR 描述（含 AC3 的解释与 #349）、回复 thread、请求复审——结果以 `Context and Orientation` 的回读清单在最终 head 上读取为准，不在本文写值。（评审会话 2026-10-15 整合发布时执行；结果以 PR #316 最终 head 的回读为准，不在本文写值）

## Surprises & Discoveries

- 2026-10-13：PR 当时 9/9 绿不能证明 redacted guard；删除 guard 的 mutation 仍 9/9 绿，说明交错测试只证明 transaction serialization。
- 2026-10-13：Fake 与 SQLite 都会串行化 root/tx 操作，但这不会自动让状态命令读到 redacted projection。
- 2026-10-13：在 tx barrier 下同步不能先于命令事务提交，因此 redacted 交错用例的判据应是"当前实现先写 visible、同步随后提交 redacted"；redacted 是否拒绝由 direct 用例独立证明。**Superseded by D3（2026-10-15）**：在事务入口之前（k=0）停住时同步可以先提交，交错用例能直接到达拒绝分支。visible refresh 额外改变 provider statusKey，以验证新标题和新状态不会被陈旧整行覆盖。**Superseded by 本节 2026-10-15「可见刷新用例把 provider statusKey 设成 done」一条（2026-10-15）**：该 statusKey 与命令同为 `done`，用例靠掩盖 #273 成立。
- 以下 2026-10-15 前四条的证据都在 `.worktrees/research-schedules`（HEAD 8300d10 加未提交原型）得到：变异结果来自 `node scripts/review-mutate.mjs research/matrix-head.json`（当时的用例）与 `research/matrix-nopins.json`（去钉子）；statusKey 改 `todo` 的结果来自 `node --test research/status-policy-nopins-todo.test.js`（两条「可见内容刷新」用例 not ok）。
- 2026-10-15：去掉 `gate.source()` / `decision.wrote` 钉子后，原实现仍在 4 条交错用例上因内容复活变红——现有交错用例对原实现有行为判别力，钉子是冗余的结构约束。
- 2026-10-15：把读与写拆成两个事务（M6）在现有用例下存活；错误的 #273 修法 E3（同步在事务外预读状态）也存活；带钉子时等价重构 E1 误红，去钉子后 E1 绿但 barrier 不触发。
- 2026-10-15：现有可见刷新用例把 provider `statusKey` 设成 `done`（与命令一致）才通过；改成 `todo` 后 Fake 与 SQLite 均红（期望 `done`、实际 `todo`），即用例靠掩盖 #273 成立。
- 2026-10-15：直接 missing 用例在原实现上也通过——它是行为刻画而不是判别；移除场景的交错（原实现会复活已移除的行）此前没有用例。
- 2026-10-15：`unavailable` 在 `packages/domain/src/errors.ts` 中映射为 `recovery=retry`、`retryable=true`；controller 重放账本按幂等键缓存失败，换键重发同样确定失败。`retryable` / `recovery` 目前没有任何生产消费者（client、ui-model、ui、controller、apps 均无读取）。
- 2026-10-15 / 独立计划评审（同一检出）：抢占点实测在三场景、两适配器上一致——命令 1 个（`transaction`，事务内另 4 个调用），同步 2 个（两次 `transaction`；事务内 remove 26 个、redact / refresh 28 个）；6 组里两种串行结果都互不相同。原型上 `matrix-B.json`：M1/M2/M3/M6/E3 KILLED（M2 只被串行规格用例杀死，E3 只在 redact / refresh 上），E1/E2 SURVIVED（即保持绿，夹具因此 exit 1）；`meta-B.json`：V1–V5 KILLED，V6（只暂停命令）SURVIVED——它是覆盖缩减而不是空转，只能由 E3 判别。
- 2026-10-15 / 独立计划评审：`scripts/review-mutate.mjs` 要求基线全绿（否则 exit 2）；Batch 2 工作区的 redact 串行规格用例在 Batch 1 合入前为红，原计划在 Batch 2 跑完整变异批不可执行，M1 / M2 的锚点也依赖 Batch 1 改后的文本。
- 2026-10-15 / 独立计划评审：controller 把整个 `StatusDecision` 作为 `value` 发上 wire，只比较 `error` 挡不住 `reason` 字段的泄露。
- 2026-10-15 / 独立计划评审：仓库内除 `tests/e2e/status-policy.test.js`（Batch 2 所有）外，没有测试或文档依赖状态命令对 redacted 的 `unavailable` 或现有拒绝文案（`grep -rn "规划条目内容不可见\|没有该规划条目的投影" tests packages` 只命中 `packages/core/src/status-policy.ts`；`docs/` 里只有本计划提到它们）。Batch 1 改动后同一命令无输出。

- 2026-10-15 / Batch 1（`.worktrees/status-race-contract`）：首版「不可见」用例只有 `writeState` 与 `[code, recovery, retryable]` 两处绝对断言，其余都是五个场景互相比较，所以「五个场景一致地错」的变异全部漏过：独立验收的 N7（`provider_authoritative` 下策略先于可见性，得到 `not_supported`）与 N8（`status=command.status`）存活；实现者用 `.superpowers/status-race/pins.json` 对旧测试复现，N5（拒绝时改写 redacted 行但不推进 revision）、N7、N8、N9（`wrote=true`）、N10（`derived` 非空）、N21（固定文案被改）、N22 / N23（`policy` / `mode` 字段被改）8 个全部 SURVIVED；补两种策略循环、字面值绝对断言与命令前后整行深相等后全部 KILLED，验收者的 `verify-mut.json`（12 个）也全部 KILLED。教训：跨场景深相等只证明「一致」，不证明「正确」。
- 2026-10-15 / Batch 1：controller 的 `snapshot().revision` 默认取各实体 `source.revision` 的最大值，只有构造 controller 时传入 `workspaceRevision` 才是工作区 revision，而 `createController(core, { authority })` 没有传；拒绝不改行时它本来就不变，用它断言会空转。用例改经 `providers.storage.currentRevision(workspaceId)` 读真实工作区 revision（`packages/controller/src/queries.ts` 的 `snapshot`、`packages/controller/src/wire.ts` 的 `toWireSnapshot`）。
- 2026-10-15 / Batch 1：合并分支后 `status-policy.ts` 没有变成未使用的 import（`ContentKind`、`ProjectErrorCode`、`projectError` 仍被使用，`tsc --noEmit` 在 `noUnusedLocals` 下 exit 0），Batch 1 第二项里「删除不再使用的 import」实际无需执行。
- 2026-10-15 / Batch 1：旧的 4 条 redacted / visible 交错用例在错误码改为 `not_found` 后仍全部通过，即它们没有断言错误码；这些用例已由 Batch 2 删除，错误码现由 controller「不可见」用例与串行规格用例守护。
- 2026-10-15 / Batch 2（`.worktrees/status-race-explorer` @ 6340e90）：夹具挑目标直接复用 `workItemIdOf(core)`，再经 `getItemDetail(entityId).content.identity.externalId` 反查 provider 条目，不必在夹具里重复一份 `listPlanningItems().find(...)`；变异与竞态结果与原型一致。
- 2026-10-15 / Batch 2：四个防空转变异各自落在预期守卫上，不是被无关断言顺带杀死：V1 报「command 必须至少有一个抢占点」，V2 报「每个 Storage 调用都必须归属某个 actor」，V4 报「停点必须真的命中」，V5 报「同步单独执行必须改变工作区」；E3 只被 redact 与 refresh 的竞态用例杀死（remove 场景没有可保留的状态）。V* 改的是正在运行的测试文件，夹具按字节还原，前后 sha256 一致；竞态用例单次约 0.7 秒，没有时间相关的抖动。
- 2026-10-15 / Batch 2 独立验收：弱化预言机的副本证明两部分都承重——只比决策（W1）或只访问 k=0 与不停（W8）时，8 个生产变异（M1、N1、N4、N5、S1、M3、M6、E3）全部存活；逐个去掉观察分量时 8 个仍全部被杀，唯一例外是去掉 `others` 后 X3（陈旧整批回写其它行）存活，所以 `others` 承重。等价重构 Q1（事务内 list+find）、Q2（先读策略）、Q3（事务前多一次无用根读，多一个抢占点）均保持绿。
- 2026-10-15 / Batch 3（主检出 `fix/status-projection-race`）：变异夹具的 `killedBy` 是对失败用例名的子串匹配，而合入时竞态用例名含「结果都等于某个串行顺序」，也含「串行」：`killedBy: 串行` 会把竞态用例的失败算作归因成功，M2「只被串行规格用例杀死」无从判别。验收重构改名为「两种先后顺序之一」后，`node --test --test-name-pattern=串行 tests/e2e/status-policy.test.js` 由 16 条变为 10 条（只剩串行规格用例），kill.json 中 M2 的 failing 列表恰为 8 条 redact 串行规格用例。
- 2026-10-15 / Batch 3：`pnpm verify` 在本沙箱不能作为第 7 行证据。沙箱自带 Node v22.22.0，`node --test tests/contract` 这种目录参数直接 `Cannot find module`（3/3 层失败）；`.nvmrc` 为 26，CI 按它取 Node。改用校验过 SHASUMS256 的 Node v26.12.0 后：typecheck 通过，`pnpm run test` 1595 条中 2 条失败——`tests/integration/development-local-git.test.js`「拒绝：占用路径、被别处检出的分支与不可访问的目录都不伪造成功」（期望 `invalid_input`、实际 `undefined`：沙箱以 root 运行，不可访问目录对 root 仍可访问）与 `tests/contract/run-test-layer.test.js`「真实层 tests/integration」（嵌套运行同一层，因同一用例失败）；同一 integration 文件以非特权用户（uid 65534）运行 73/73；`pnpm run test:mvp0` 7/7。两处失败都与本 PR 的文件无关，权威结论以 Batch 4 push 后的 `PR Fast Gate` 为准。
- 2026-10-15 / Batch 3 自加变异：X1（拒绝时把尝试的状态写进 redacted 行、不推进 revision）被 controller「不可见」用例与 Fake / SQLite 的 redact 串行规格用例同时杀死，行级副作用有两道独立防线；X2（写入时行 revision 不推进）被 client / watch 等 e2e 用例杀死，不属 #303 用例的职责；X5（事务体内改用根实例读工作区）只在 SQLite 上被杀，SQLite 以「嵌套事务不被支持：事务内必须用 tx.*」拒绝，Fake 允许这种调用；X3（`instrument` 去掉 `holding`）在当前实现下保持绿——没有 actor 在持有事务时从根实例发调用，`holding` 只在出现这种调用时（目前只可能在 Fake 上）把它排除出抢占点，与 D3 抢占点定义一致；X6（`runSerial` 的 `mid ??=` 改为 `mid =`）在正确实现上保持绿，它让串行规格用例的副作用比较退化为自比，此时 X1 仍由 controller 用例杀死。

- 2026-10-15 / 第三轮评审修复（检出 `.worktrees/status-projection-race-r3`，变异 spec 在其 `.superpowers/fix-316/`）：Fake planning provider 不产出 `nativeValues`（`git grep nativeValues -- packages/providers/fake/src` 无输出），竞态夹具的行因此没有 `planningFields`，R8b 在原用例下存活。给夹具的工作项补原生字段与映射后，redact 场景的目标行也走 `nativeValues` 分支：redact 之后状态为 `unknown`、不留展示字段（此前沿用 `statusKey`，是 `in_progress`）。于是 S1 除了被「参照 refresh」（当时名为「串行参照 refresh」）杀死，也被 8 条 redact 串行规格用例杀死：状态由 `in_progress` 变为 `unknown` 属于「分歧」，S1 保留旧 work_item 内容，前置条件「已提交的 redact」不成立。
- 2026-10-15 / 第三轮评审修复：「命令→同步」下只写死 `todo` 会误伤正确的 #273 修法。把参照用例的二选一改成 `assert.equal(..., todo)` 的副本（`.superpowers/fix-316/strict-todo.json`），在当前实现上基线绿，即当前两适配器都是 `todo`；施加 E2 后两适配器的参照用例都红。
- 2026-10-15 / 第三轮评审修复：「命令→同步」里同步推进 revision 时按 ADR-0012 把本轮写入的行整批重盖，其它行的行 revision 也随之变化；「其它行不变」只对内容成立。命令本身不碰其它行（含行 revision），在两个顺序里分别断言。
- 2026-10-15 / 第三轮评审修复的复评：夹具改走 `nativeValues` 后，本文件不再覆盖「redacted 行留着旧状态」的分支。R10（可见性按状态 `unknown` 判定）在 c2014cfc 的用例下被 8 条 redact 串行规格用例杀死，在 57b4dc4d 的用例下于本文件内存活（`.superpowers/fix-316/r10-before.json` 复现 SURVIVED），只剩 controller「不可见」用例能杀死它。生产里 R10 还会把「可见但状态选项未映射」的条目当成不可见拒绝。补 `statusKey` 分支的 redact 变体与正向用例后，R10 被这 4 条用例杀死（两适配器各 2 条）。
- 2026-10-15 / 第三轮评审修复的复评：补用例的第一版给每个 redact 变体断言同步后的状态（带原生字段为 `unknown`），正向用例也先同步出 `unknown` 再发命令；E2（同步保留 Host 状态）因此在 10 条串行用例上变红。这些前置条件把 #273 的现行同步策略写进了用例，改为只对 `statusKey` 变体断言「不是 `unknown`」，正向用例改为首次同步就是 `unknown`（没有旧行可保留）。改后 E2、E1 保持绿。
- 2026-10-15 / 第三轮评审修复的复评：`killedBy` 子串归因再次含糊。新用例名「串行参照 refresh」含「串行」，M2 的 `killedBy` 正是「串行」，`--test-name-pattern=串行` 由 10 条变为 12 条。复评的 V-ADV2（只破坏参照用例）在 `killedBy: 串行` 下报 KILLED。改名为「参照 refresh」后同一变异报 KILLED_OTHER（`.superpowers/fix-316/adv.json`），M2 的 failing 恰为 10 条 redact 串行规格用例（四种 reason 与 `statusKey` 变体，两适配器）。
- 2026-10-15 / 第三轮评审修复的复评（main 既有，不在本 PR 修）：两个存储适配器在「同步覆盖命令写过的状态」上可以分歧而不被发现。复评的 V-E2F 只在 Fake 上保留命令写过的状态，契约、集成、e2e 与 MVP-0 全量都存活；契约套件只用空列表调用 `replacePlanningProjections`。评审会话已登记到 #201（issuecomment-6188693500），这条路径正是 #273 要改的地方。

## Decision Log

- 2026-10-13：选择直接 redacted/missing 用例 + 修正 barrier，而不是引入 Storage-native CAS；理由是当前生产 guard 已有正确边界，CAS 会扩展公共 Storage port、两适配器和契约面，超过本 PR 的最小修复范围。（CAS 部分仍有效，并入 D1；用例部分 **Superseded by D3（2026-10-15）**。）
- 2026-10-13：保留 visible refresh 作为独立交错判据；不把它当成 redacted guard 的替代证据。**Superseded by D3（2026-10-15）**：refresh 成为预言机三场景之一，且不再让 provider 状态与命令一致。
- 2026-10-13：direct missing 用例同时冻结目标身份、另一控制行和工作区修订号；理由是"not_found"单独返回不足以证明拒绝没有副作用。（仍有效，由 D3 串行规格用例的观察函数承接。）
- 2026-10-13：barrier helper 用 `phase === 'tx'` 与 `phase === 'root'` 分别表达固定实现和旧实现对照。**Superseded by D3（2026-10-15）**：按实现分支选择放行顺序正是两轮 P1 的根机制。
- 2026-10-13：PR #316 先 rebase/relock，再接受任何旧 review 结论；BEHIND 会使历史批准失效。（仍有效。）
- 2026-10-15 / 主控 agent：不可见目标（缺失或 redacted）统一返回 `not_found`，错误对象不随 reason 变化。Rationale 与被放弃方案见 D2。Cost if wrong：一处错误码常量与一条 controller 用例。需要评审者在 PR「Public behaviour」小节确认。
- 2026-10-15 / 主控 agent：竞态回归采用 D3 的调度探索 + 串行参照预言机，而不是继续修补手工 barrier。Rationale：两轮 P1 同一根机制；原型对 M6、E3 有判别力而现有用例没有，等价重构 E1 下不误红，测试代码净减。Cost if wrong：回退到现有 barrier 用例（backup 分支保留）。
- 2026-10-15 / 主控 agent：Start Work 的 redacted 错误码与 `confirmRelation` 的读-判-写不在本 PR 改，作为 follow-up（见 D4）。Rationale 见 D4（独立计划评审更正引用：原写「§3——不把相邻行为变更混入回复」，该原则实际在 §2）。
- 2026-10-15 / 主控 agent：Batch 1 与 Batch 2 由两个并行实现者在各自工作区完成，文件集合互不重叠；最终由独立验收者合并、对抗验证与重构。**Superseded by `Global Constraints`「并行所有权」（2026-10-15 独立计划评审）**：原安排让两批都在本计划追加 Progress，并不互不重叠；改为只由 Batch 3 写本计划。
- 2026-10-15 / 独立计划评审：完整变异矩阵（含 M1 / M2 与 E1 / E2）放在 Batch 3、以合入后的源码为锚点，并对每个应杀死的变异指定 `killedBy`；Batch 2 只跑竞态子集。Rationale：夹具要求基线全绿（见 Surprises）；没有 `killedBy` 时 M1 可能只被串行规格用例杀死，不能作为 AC1「barrier 式回归为红」的证据。Cost if wrong：多维护一份 spec。
- 2026-10-15 / 独立计划评审：提交顺序 `fix(core)` → `test(core)` → `docs(exec-plan)`，每个提交为绿，不留红提交；AC1 的「改动前为红」由 M1 证明。Rationale：可二分，可用 `git rebase --exec` 逐提交验证。Cost if wrong：评审要求红提交时，把 `test(core)` 移到 `fix(core)` 之前重建。

- 2026-10-15 / Batch 1 实现者（`fix/status-race-contract` @ 3f1acf6）：固定文案用模块级常量 `INVISIBLE_TARGET`，由 `reason` 与 `projectError` 的 message 共用。Rationale：D2 要求两处同一文案，单一常量使它们不会漂移，B2 / B3 也各有清晰锚点。Cost if wrong：内联即可。
- 2026-10-15 / Batch 1 实现者：「不可见」用例在 `harness_managed` 与 `source_managed` 两种策略下循环，并对字面值做绝对断言（`wrote=false`、`status='unknown'`、`derived=[]`、`[policy, mode]` 等于 `[POLICY_BY_MODE[mode], mode]`、`[reason, error.message]` 等于 D2 固定句）；拒绝无副作用用 `currentRevision` 不变与命令前后整行深相等并列断言（N3 推进 revision 不改行，N5 改行不推进 revision，二者可独立违反）；redacted 与缺失分别断言前置条件。Rationale：D2 的「可见性先于策略」代价必须有用例守护；跨场景深相等挡不住一致的错；沿用 D3 防空转原则。Cost if wrong：固定句在常量与用例里各存一份，改文案要两处同改；用例多跑一轮同步。
- 2026-10-15 / Batch 1 实现者：`compose()` 额外返回 `providers` 与 `workspaceId`，不在新用例里另起一套组合。Rationale：复用既有帮助函数；现有调用点都是解构取字段，不受影响。Cost if wrong：回退为用例内局部组合。
- 2026-10-15 / Batch 1 实现者：验收者的阻断发现经复现属实，补强测试后 amend 进同一个批次提交（59ac1ce → 3f1acf6），不拆第二个提交。Rationale：一批一提交，Batch 4 再整理历史。Cost if wrong：Batch 4 按文件集合重建，不受影响。
- 2026-10-15 / Batch 2 实现者（`test/status-race-explorer` @ 6340e90）：`raceFixture` 的第二个参数是 provider 侧变化函数 `(state, item) => void`，`CHANGES` 是三场景映射，`redactedAs(reason)` 让串行规格用例对四种 `RedactionReason` 复用同一个变化函数。Rationale：同一份夹具与观察函数同时服务预言机与串行规格。Cost if wrong：需要按名字记录场景时再加一层。
- 2026-10-15 / Batch 2 实现者：预言机断言保留「按决策挑最接近的串行参照」的 `??` 链，只为失败时给出 diff；通过与否只取决于是否深相等于某个串行结果（`assert/strict` 的 `deepEqual` 与 `isDeepStrictEqual` 同一相等性，独立验收确认不会造成假通过）。Cost if wrong：改成 `assert.ok` 加序列化输出。
- 2026-10-15 / Batch 2 实现者：`runSchedule` 先 `disarm()` 再 `observe()`，不依赖对象字面量求值顺序，避免观察时的 Storage 调用计入抢占点；保留一处 `Promise.race([reached, running])`，它只用于判断 actor 是否真的停住（k = N 时必须靠它），不按实现分支选择放行顺序，与被删除的旧相位逻辑不是同一件事。抢占点依赖的 Storage 契约写在 #303 段的说明注释里，点名两个契约用例，文件顶部的 Batch C4 总注释不动。
- 2026-10-15 / Batch 1 实现者：提交 3f1acf6 的署名行写 `Co-Authored-By: Claude Sonnet 5.5`（实现者按其会话的系统级署名提示，认为这才是写提交的模型），Batch 2 的 6340e90 与 Batch 3 的提交写 `Claude Opus 5.5`；`Claude-Session` 行一致。Batch 3 不改写已有提交（历史整理归 Batch 4）。Cost if wrong：Batch 4 重建提交时按其会话的署名提示统一。（Batch 4 / 主控 agent：重建的三个提交统一使用本会话的署名行，已处理。）
- 2026-10-15 / Batch 3 验收者：竞态用例名改为「两种先后顺序之一」，使「竞态」「串行」两个命名词互不包含；`workspacePolicy` 的参数改写为 `WorkspaceRecord | undefined`；controller 用例名里的计划内编号 D2 改为 #303。Rationale：前者是 `killedBy` 归因的前提（见 Surprises），后两者只为可读。Cost if wrong：三处字面量，回退即可。
- 2026-10-15 / Batch 3 验收者：保留 `instrument` 的 `holding`。Rationale：X3 在当前实现下等价，但它是 D3「抢占点 = 不在自己事务体内的调用」定义的直接实现；去掉后，将来若生产代码在事务体内经根实例调用，Fake 上会把这次调用当成抢占点，停在持有事务的位置。Cost if wrong：3 行代码。
- 2026-10-15 / Batch 3 验收者：`docs/architecture/release-gates.md` 与 `docs/product/vertical-path.md` 不改。Rationale：`grep -nE "#303|竞态|并发|原子读|丢失更新|状态命令|applyPlanningStatus" docs/architecture/release-gates.md docs/product/vertical-path.md` 命中的行（vertical-path 第 12、13.7 行与示例代码、release-gates §2.1.1 第 8 行的观察定序）都不覆盖状态命令与同步的原子性，没有应引用 #303 新证据的行。Cost if wrong：Batch 4 在 PR 评审中补一行引用。
- 2026-10-15 / Batch 3 验收者：第 7 行的 `pnpm verify` 用与 `.nvmrc` 一致的 Node 26 复跑，并以非特权用户单独复跑失败文件来区分环境性失败，不改测试、不改 `package.json`。Rationale：两处失败都由沙箱以 root 运行引起，与本 PR 文件无关；改动它们超出 D4 范围。Cost if wrong：Batch 4 以 CI 的 `PR Fast Gate` 为准，红则回到本批。

- 2026-10-15 / 评审会话的修复实施者：评审 2026-10-15（Singularity-AI-Bot review id 5530341235，第三轮，APPROVE）意见处置。整合提交、PR 正文与 thread 回复由评审会话执行，证据在 PR。
  - F1 [P2] AC3 只有相对判据（`tests/e2e/status-policy.test.js`）→ 属实，已修。新增「参照 refresh」用例（两适配器；复评前名为「串行参照 refresh」），断言见 D3「参照用例」。证据：`node scripts/review-mutate.mjs .superpowers/fix-316/new.json`，S1 在补强前 SURVIVED，补强后 KILLED，failing 含 Fake 与 SQLite 的参照用例；`allowed.json` 中 E2、E1 保持绿；`strict-todo.json` 证明只写死 `todo` 会让 E2 变红。Rationale：预言机只证明「一致」，绝对断言证明「正确」，与 Batch 1 的 N7 / N8 是同一教训。Cost if wrong：#273 落地时把「命令→同步」一格从二选一收紧为其一。
  - F3 [P3] 竞态夹具无展示字段 → 属实，已修。夹具工作项带 `nativeValues`（状态单选、迭代、目标日期），工作区配置 `planningFieldMapping`；refresh 另改目标日期。证据：R8b 补强前 SURVIVED，补强后 KILLED，failing 恰为 Fake 与 SQLite 的「竞态：状态命令与 refresh」；回归子集 M2、M3、M6、E3（`regress.json`）补强前后都 KILLED，killedBy 与 Outcomes 记录一致。Rationale：GitHub provider 总带 `nativeValues`，夹具改后更接近真实输入。Cost if wrong：夹具回到只有 `statusKey`，同时丢掉 R8b 的判别力。
  - F4 [P3] D2 理由与事实不符 → 属实（`packages/core/src/planning-fields.ts` 先判 `nativeValues === undefined`），已改写 D2 第三条；结论「固定返回 unknown、不泄露信息」不变。
  - F2 [P2] Start Work 缺口无追踪 → 属实，转承接：#349，已回填 D4、Batch 4 与 Progress；PR 正文 Scope 的回填随 Batch 4 发布。
  - F5 [P2，PR 级] 私有会话链接进入发布面 → 属实，整合提交时三个提交去掉 `Claude-Session:` 尾行，PR 正文同步删除；新提交正文的草稿已交评审会话。扫描器补模式是否另开 issue 由评审会话决定。
  - F6 [P3，PR 级] 提交身份与 `fix(core)` 正文「此前……」一句 → 属实：`origin/main` 上状态命令从未拒绝 redacted，那句话指的是旧 PR 草案。整合时统一为开发账号，并改写该句，草稿同上。
  - PR 正文要补 AC3 的解释与「Start Work 缺口由 #349 承接」，英文草稿已交评审会话，发布时写入。
- 2026-10-15 / 评审会话的修复实施者：第三轮评审修复的复评意见处置（复评结论：修复成立，P0–P2 为 0）。
  - N1 [P3] 夹具改走 `nativeValues` 后不再覆盖 redacted 行留旧状态的分支 → 属实，已修。见 Surprises 同日条目与 D3「串行规格用例」。证据：`.superpowers/fix-316/n.json` 中 R10 KILLED，failing 为两适配器的「redact（statusKey 分支）」与「可见但状态选项未映射」各 2 条；`r10-before.json` 证明补用例前 SURVIVED。Rationale：可见性按内容判定是 D2 的定义，状态值依 provider 与 #273 而变。Cost if wrong：两条用例。
  - N2 [P3，机械] `killedBy` 子串归因含糊 → 属实，按第一种方案改名：参照用例名不再含「串行」，命名约定改为三类三个词，验收表第 4 行的 pattern 改为「参照」（pass 2），S1 的 `killedBy` 改为「参照 refresh」。证据：`adv.json` 的 V-ADV2 在 `killedBy: 串行` 下报 KILLED_OTHER。Rationale：沿用 Batch 3 的做法，让类别词互不包含，而不是让 M2 的 `killedBy` 越写越长。
  - N3 [P3，main 既有] → 记入 Surprises 并引用 #201，本 PR 不修。
  - N4 [P3] → D4 的 #349 引用旁补上事务验收。另记开立依据：Batch 4 写的「开 issue 是外部写入，先取得人类伙伴确认」，这次由用户给评审会话的评审流程指令覆盖，原话节选为「如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续：三思后修复 → re-review → 归档 ExecPlan → … → 核对并处理对应 issue」。#349 由评审会话按这条指令开立，人类伙伴没有单独确认过 #349。

## Idempotence and Recovery

- 所有测试与变异批可重复运行；`scripts/review-mutate.mjs` 在施加前按字节读入原文、跑完写回并逐字节比对，工作树脏也安全。
- 每个调度使用全新工作区与内存 SQLite，不残留状态。
- 历史改写前保留 backup 分支（Batch 0 已建立 `backup/pr-316-10a2605`，Batch 4 的命令块再建一个指向整理前 head 的 backup）；失败时确认 `git status --short` 无输出后 `git reset --hard <backup>`，再以精确 lease 回推。
- 并行工作区在合入前互不影响；合入冲突时在 Batch 3 的 PR 分支上解决，必要时丢弃某批分支重做。`.worktrees/status-race-contract/`、`.worktrees/status-race-explorer/` 保留到 PR 合并，清理按 `AGENTS.md` §6 的恢复锚点流程，不在本计划内删除。

## Interfaces and Dependencies

- 运行时：Node ≥ 22（`node:async_hooks` 的 `AsyncLocalStorage`、`node:test`、`node:util` 的 `isDeepStrictEqual`），pnpm 10；每个新检出先 `pnpm install --frozen-lockfile`。不新增依赖。
- 测试依赖：`@harness-projects/provider-fake` 的 `createFakeProviders`（可注入 bindingId）、`createFakeStorage`、`removeItem`；`@harness-projects/storage-sqlite` 的 `createSqliteStorage(':memory:')`；`composeCore` 的 `clock` 与 `ids` 注入点。
- 契约依赖：`tests/contract/suites/storage.js` 的事务串行化与隔离用例；若该契约变化，D3 的抢占点定义需要同步复核。
- 工具：`scripts/review-mutate.mjs`（变异夹具）、`scripts/rule-checks.mjs`、`scripts/workflow-check.mjs`、`git rebase --exec`（逐提交验证）；GitHub 回读需要仓库读权限，follow-up issue 与 PR 回复需要写权限。

## Outcomes & Retrospective

- 2026-10-13：当前批次完成了测试设计、red/green 对照、rebase 与本地/远端门禁。direct guard、事务交错、visible refresh、typecheck、workflow、disclosure、size、diff-check 均有当前 head 证据；PR 仍等待新的独立 reviewer 结论，不移动到 `completed/`。**Superseded by `Surprises & Discoveries` 2026-10-15 各条（2026-10-15）**：M6、E3 在当时的用例下存活，visible refresh 靠掩盖 #273 成立，「事务交错有证据」不成立。
- 2026-10-15：Batch 1–4 尚未执行，没有新结果。**Superseded by 下一条（2026-10-15，Batch 3）**。

- 2026-10-15 / Batch 3（主检出 `fix/status-projection-race`，两批合入后加验收重构）：D1–D3 落地，D4 的边界未被触碰（`git diff --name-only origin/main...HEAD` 只有 `Global Constraints` 声明的五个文件）。
  - 判据：第 1 行 AC4 命令组 224/224、`tsc --noEmit` exit 0；第 2 行 controller 20/20；第 3 行串行规格用例 10/10；第 4 行竞态 6/6；第 6 行 10 次循环无输出（约 7.5 秒）；第 7 行 workflow-check、disclosure、size、diff-check 均 exit 0，`pnpm verify` 在本沙箱未 exit 0（Node 26 下只有 2 条与本 PR 无关的 root 环境失败，见 Surprises），`gh pr checks` 由 Batch 4 回读。
  - 变异矩阵（第 5 行，以合入后源码为锚点，锚点各恰好出现一次）：`kill.json` exit 0，M1、M2、M3、M6、E3、V1、V2、V4、V5 全部 KILLED，没有 KILLED_OTHER 或 NOT_APPLIED；M1 的 failing 列表含三场景 × Fake / SQLite 共 6 条竞态用例与 8 条 redact 串行规格用例，即 AC1「改动前为红」；M2 只被 8 条 redact 串行规格用例杀死；E3 只被 redact / refresh 的 4 条竞态用例杀死。`equiv.json` exit 1，E1、E2 均 SURVIVED（保持绿）。另有 Batch 1 的 B1–B3、补强 spec 的 8 个、Batch 1 验收者的 12 个、Batch 2 验收者的生产与夹具变异，以及 Batch 3 自加的 X1 / X2 / X5（KILLED）与 X3 / X6（等价或弱化测试，保持绿，理由见 Surprises）。
  - 规模：`node scripts/rule-checks.mjs size origin/main` 读回代码 259 / 1000、文档 343 / 1500（含本次文档提交）。
  - 回顾：并行批次按文件集合划分，合入零冲突，计划只由一个 owner 写的安排避免了 Progress 冲突。两次独立验收各自发现了实现者自检没有覆盖的缺口——一致而错误的结果（Batch 1 的 N7 / N8）与命名词重叠导致的归因含糊（Batch 3）；两者都由「先写变异、看它存活、再补断言」发现，而不是读代码。仍未完成：Batch 4 的提交重建、两个 D4 follow-up issue、push 后回读与评审回复；Batch 1 的提交署名与另两批不同（见 Decision Log 与执行报告），由 Batch 4 重建提交时统一。

## Bottom Change Note

- 2026-10-13：创建本计划，记录 PR #316 的 current-head P1 与 direct-guard repair 路径。
- 2026-10-13：补齐 direct redacted/missing 快照与真实 tx barrier 交错，并记录 guard/旧实现 mutation 红灯证据；尚未执行最终发布门禁。
- 2026-10-13：rebase 后删除重复旧计划并修正发布面；当前 head 的 reviewDecision 仍以 GitHub 新评审为准。
- 2026-10-15：按全部评审的根因复盘重写：新增 D2（不可见目标统一 `not_found`）、D3（调度探索 + 串行参照预言机），旧设计与决策就地标注 Superseded；易失状态改为回读命令；批次改为并行实现 + 独立验收。
- 2026-10-15 / 独立计划评审：变异矩阵移到 Batch 3 并补变异定义表、`killedBy` 与 kill / equiv 两份 spec 的期望（原写法在 Batch 2 基线为红时不可执行、第三方无法重放）；本计划只由 Batch 3 写（原安排两批都写，并不互不重叠）；补并行起点与 `pnpm install`；D2 补可见性先于策略的理由、`reason` 统一与整个 `CommandResult` 深相等；D3 补适配器根读差异下的健全性论证与界 1 穷尽条件（实测 N_command = 1、N_sync = 2），「逐字节」改为深相等，写明 AC3 解释与命名约定；根因表契约行改为只修到状态命令；D4 写实 Start Work TOCTOU 与 `confirmRelation` 的事实、更正 `responding.md` 引用、follow-up 归 Batch 4；Batch 4 给出非交互的三提交重建命令、逐提交验证与回滚顺序；写明 #303 AC1–AC4 并逐条映射；issue 状态加观察日期与回读命令，thread 回读给出可执行命令；恢复被删的 2026-10-13 refresh 结论与 Outcomes 原文并标注 Superseded。
- 2026-10-15 / Batch 3 验收者：两批合入 PR 分支；勾选 Batch 1–3 的计划项与 Progress（含并行起点）；把两批与两次独立验收的执行报告去重并入 Progress / Surprises / Decision Log；D3 命名约定补「两个词互不包含」；Outcomes 填入实测结果与变异矩阵，原「尚未执行」一条就地标注 Superseded；`docs/README.md` 索引行改为描述当前范围（D1–D3）。
- 2026-10-15 / 主控 agent：核实 `confirmRelation` 的丢失更新不可达（Storage 层「候选不得降级已确认」与只增不改的 `recordEdges`），D4 与 Batch 4 改为只开 Start Work 一个 follow-up；记录 Batch 4 的提交整理结果，发布结果改为回读规则。
- 2026-10-15 / 第三轮评审修复：D2 第三条理由改为按 provider 区分存量值；D3 补夹具原生字段与「串行参照用例」（复评后改名为「参照用例」）；D4、Batch 4 与 Progress 改为引用 #349；变异定义表补 S1、R8b，第 4 行补串行参照命令；Surprises、Decision Log 记录第三轮评审处置。
- 2026-10-15 / 第三轮评审修复的复评：D3 补 `statusKey` 变体与正向用例、参照用例改名、命名约定改为三类；D4 补 #349 的事务验收；变异定义表补 R10、S1 改 `killedBy`；验收表第 4 行的 pattern 改为「参照」；Progress、Surprises、Decision Log 记录复评处置与 #349 的开立依据。
