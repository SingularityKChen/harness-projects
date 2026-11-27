# 崩溃残留 Pending Git 意图的重启对账 ExecPlan

> 状态：Active（设计已收敛，待实现与验证）
> 创建：2026-11-27
> 范围：issue #682 —— 把 #673 的「同 key 重放前只读对账」从 `unknown` 行扩展到崩溃残留的 `pending` Git 意图（`createBranch` / `createWorktree`），在持久租约过期后由同 key 重放在认领事务内采纳或重发，保留现有 owner/generation 围栏；不新增列、表、端口、迁移或第二权威。
> 上游输入：issue #682 正文与验收；issue #191（保持 OPEN）；issue #683（跨 key/后继所有权，保持 OPEN）；`docs/exec-plan/completed/2026-11-21-restart-reconciliation.md`（D6/D20/D21/D23）；`docs/adr/ADR-0016-start-work-owner-generation.md`；`AGENTS.md` §1.1、§2、§7–§9；`PLANS.md`。
> 执行上下文：分支 `fix/crash-left-pending-recovery`，隔离工作树 `.worktrees/crash-left-pending-recovery/`；初始基线 `origin/main f5b731a4`（易失值不回抄正文，用 `git rev-parse HEAD` 回读）。

## Purpose / Big Picture

完成之后，一个在**外部 Git 写之前**或**写调用期间**进程被杀掉的 Start Work，不再永久停在「正在处理」：重启（或重新组装 Core）后，用户用**同一份表单、同一个 idempotency key** 再提交一次，core 先按持久 `externalIntent` 里的精确目标做一次只读对账，再决定答复与续跑：

- 目标其实已经在外部落地（分支已存在 / 工作树已登记且检出期望分支）：**采纳**并把这次开始工作做完，报 `saved` / `ready`，不重发那一步外部写；
- 目标被完整读取证明不存在（分支读完所有分页无同名 / 工作树确定 `not_found`）：在认领事务里覆盖旧槽位后**恰好重发一次**那一步，其余步骤照旧，报 `saved` / `ready`；
- 读不出来（不可用、权限拒绝、缺能力、缺持久句柄、provider 抛错）：保持 `unknown`，**零写入、零外部写、不起第二个 run**，错误里说清「对账只读，未重发」；
- 对账读到目标被别的分支占用：结构化 `conflict`，两侧值都报出，零写入；
- 资格不满足（租约未过期、进程内仍有 owner、run 已存在、代际/绑定/指纹不一致、上下文已记录不一致步骤）：完全沿用今天的重放语义（`pending` 答复），不探测、不写。

用户可见的最小成功证据：一个 `pending` 的 Start Work 在重启且租约过期后，用同一 key 再提交一次即收敛到 `ready`，分支、工作树、run 各只有一份；provider 仍不可读时再提交仍是 `unknown` 而不是伪 Saved，也不会产生第二份外部对象。

## Context and Orientation

### 问题形状（已核实）

Start Work 在**每个真实外部写之前**用 `beforeExternal`（`packages/core/src/start-work.ts` 585–593）在同一事务里写 `mutation_attempt`：根 `state='pending'`、`externalIntent.state='pending'`、精确 input、`contextId`、`ownerGeneration`、`bindingId`。provider 调用返回后，成功路径立刻 `recordStep` 回填上下文并把该步标成 `saved`；失败路径在 settle 里把根写成 `unknown`/`failed`。

因此**崩溃残留**有三种形状：

| 崩溃点 | 根 state | intent.state | 上下文 | 今天的行为 |
|---|---|---|---|---|
| 认领事务已提交、`beforeExternal` 之前 | pending | intent 不存在 | provisioning | `safeResume` 可续跑（已工作） |
| `beforeExternal` 已提交、该步外部写/回执之前 | **pending** | **pending** | provisioning | **永久 pending（本 issue 的缺口）** |
| 某步已回填、下一步 `beforeExternal` 之前 | pending | 上一步 saved | provisioning | `safeResume` 可续跑（已工作） |
| 写结果不确定、settle 已提交 | unknown | unknown | failed | #673 已实现只读对账 |

只有第二行是 #682 的目标。它今天无法恢复：`reconcileReplay`（`start-work.ts` 198–224）用 `unknownGitIntent`（`git-provisioning.ts` 386–391）作谓词，后者只接受 `attempt.state === 'unknown'`；同 key 重放于是走 `replayRequest`（`start-work.ts` 169–182）的 `unresolved` 分支，把根 `pending` 逐字投影成 `pending` 报告，永远不再尝试。基线实测：崩溃残留行在越过 31s 租约后同 key 重放仍是 `writeState='pending'`、探针读 0 次、代际不变（证据见 `Surprises & Discoveries` S1）。

### 与既有机制的关系

- **#673（已完成）**：`unknown` 行的同 key 只读对账与「采纳 / 重发 / 冲突 / 未知」四态、采样行逐字复核、写门拒绝保留可恢复 unknown。本计划**复用同一形状**，不改其行为。
- **#191（保持 OPEN）**：其关闭条件没有子集限定；本 PR 只补一个子集（同 key / 崩溃残留 pending / Git 两创建步），关闭关系与范围口径沿用 #673 的 D20/D23 处理方式（见 D5）。
- **#683（保持 OPEN）**：跨 key 接管（新 key 取代旧未决槽位）与后继所有权。本计划**不**放开跨 key：新 key 在旧行未决时仍被 `pendingClaim` 挡成 `pending`。
- **#193**：Ready 缺 run 的对账属执行域，本计划不碰；`record.status === 'ready'` 一律不接受 pending 恢复（见 D8）。

### 关键术语

- **未决写（unresolved）**：`unresolved(attempt)`（`start-work.ts` 226–228）为真，即 intent 存在且（intent.state ∈ {pending, unknown} 或根 state 为 unknown）。它是 `safeResume` 的否决条件，也是今天 pending 行永久重放的机制。
- **崩溃残留 pending 意图**：根 `state='pending'` 且 `externalIntent.state='pending'` 的 Git 创建步。
- **只读对账（reconcile）**：用持久 intent 的精确输入读回外部目标，返回 `adopted` / `absent` / `conflict` / `inconclusive`；只在一次调用内存在，不落盘（`GitReconcileOutcome`，`git-provisioning.ts` 376–383）。
- **探针（probe）**：分支走 `branchProbe`（逐页读到 `nextCursor === undefined` 才敢说不存在）；工作树走 `getWorktree`，句柄**只能是** `intent.input.path`。
- **租约**：`PROVISIONING_LEASE_MS = 30_000`（`start-work.ts` 403）；`needsSupply`（422–424）在上下文终态或 `provisioning` 且租约过期时为真。租约只决定**何时允许探测/接管**，不是「外部没发生」的证据。
- **代际（generation）**：`provisioningGeneration`，每次认领 +1；`owned()`（297–302）是唯一写围栏。旧 owner 的迟到写一律 `OwnerLost`。
- **进程内 owner 否决（activeOwners veto）**：`activeOwners`（`start-work.ts` 104、124、239）记录本 CoreContext 内正在供应的 context。它只用于**拒绝发起恢复**，不授予任何权限。

### 相关文件

- `packages/core/src/start-work.ts`：入口、`reconcileReplay`、`claimContext`、`provision`、`saveContext`、`existingResult`。
- `packages/core/src/git-provisioning.ts`：`unknownGitIntent`、`reconcileGitStep`、`provisionGit`、`branchProbe`。
- `packages/core/src/write-machine.ts`：`WriteLedger.record/replay`（`record` 不写 `externalIntent`，155–164）。
- `packages/capabilities/src/storage.ts`：`MutationAttemptRecord` / `StartWorkExternalIntent` / `ExecutionContextRecord`（85–120、145–208、358–403）。
- `packages/storage/sqlite/migrations/001_init.sql`：329、338 两行 DDL 注释（**只读，不修改**，见 D3）。
- 测试：`tests/integration/start-work-step-recording.test.js`（#673 判别用例）、`start-work-external-intent.test.js`、`start-work-request-binding.test.js`、`start-work-owner-fencing.test.js`、`local-git-core-provisioning.test.js`、夹具 `tests/integration/local-git-fixture.js`。

### 当前状态与基线证据（历史时点，易失值以回读命令为准）

以下在 `f5b731a4` 的主检出根目录实测（工作树与主检出同 commit；工作树内运行前需先执行 V0）：

- V1 `pnpm run typecheck`：exit 0、无输出。
- V3 四个文件：`tests 142 / pass 142 / fail 0`。
- V4 三个文件：`local-git-core-provisioning` 20/20；`execution-uniqueness + retry-identity` 54/54。
- 一次性只读探针（未入库，见 S1）：`createBranch` 与 `createWorktree` 的崩溃残留 pending 行，越过 31s 租约后同 key 重放均得到 `writeState='pending'`、探针 0 次、代际仍为 1、外部对象计数不变。

## Design / Spec

### 方案（采纳）

在**既有**同 key 重放路径上把对账入口的谓词与资格从「unknown 行」扩到「崩溃残留 pending 行」，其余形状完全复用 #673：

1. **谓词（`git-provisioning.ts`）**：把 `unknownGitIntent` 改名为 `recoverableGitIntent`（调用点只有 `start-work.ts` 一处），保持 `unknown` 分支逐字不变，新增 `pending` 分支：
   - `attempt.commandName === 'startWork'`；
   - `attempt.state === 'unknown'`（原路径，不改），或 `attempt.state === 'pending' && intent.state === 'pending'`（新路径）；
   - `intent.operation ∈ {createBranch, createWorktree}`；
   - 返回值形状不变（`GitIntent`），`reconcileGitStep` / `gitIntentKey` 零改动。
2. **入口资格（`start-work.ts` `reconcileReplay`）**：在现有守卫之外，对新路径追加：
   - `record.status === 'Provisioning'` 且 `leaseExpired(record.provisioningStartedAt, now)`（不碰终态与 Ready；terminal 的 pending 行不是合法产品状态）；
   - 失败步骤一致性（同一意图目标）：`createBranch` 要求 `record.branchExternalId === undefined`；`createWorktree` 要求 `record.branchExternalId === intent.input.branch` 且 `record.worktreeExternalId === undefined`；
   - `!activeOwners.get(context)?.has(contextId)`（进程内 owner 否决；unknown 路径同样加，语义上 unknown 时 owner 已退出，不改变现有行为）。
   - 现有守卫全部保留：`!requestMismatch`、record 存在且 `needsSupply`、无 run、`intent.contextId === contextId`、`intent.ownerGeneration === record.provisioningGeneration`、`selectDevelopment` 成功且 `bindingId === attempt.bindingId`。
3. **只读对账**：直接调用现有 `reconcileGitStep(context, route, intent)`，零改动；结论语义见下表。
4. **认领事务内的时序资格复核（`claimContext`）**：`Resuming` 增加 `record: ExecutionContextRecord`；`sampled` 的判定从「只比 attempt 行」改为「attempt 行与 execution_context 记录都逐字相同」（用事务内的 `tx` 读取）；不等即视为「没有对账证据」，完全回落到今天的 replay/observe 语义（不抛错、不采纳、不写）。`generation = nextGeneration(existing)` 只在 sampled 成立时执行。
5. **被采纳句柄的持久化**：`claimContext` 的过期 Provisioning 续跑分支（`start-work.ts` 508）今天只写 `adoptedBranch`；本轮在同一事务里把 `adoptedWorktree` 也写回（`worktreeExternalId`），并订正该处「unknown 行归属终态接管分支，写在这里不可判别」的注释——pending 行让这个分支第一次可携带对账证明的工作树句柄。其它写路径（分支回填、settle、`has_worktree` 边）不动。
6. **不新增任何持久形状**：不加列/表/端口/迁移/开关；`reconcileGitStep` 结论不落盘；不存在「怎么知道的」第二状态轴。

### 对账结论 → 行为

| 结论 | 判定依据 | 行为 | 用户可见 |
|---|---|---|---|
| `adopted`（branch） | `branchProbe` 读完所有分页并命中 `intent.input.name` | 认领事务写 adopted branch + 代际 +1；`provisionGit` 因 `record.branchExternalId` 已存在而跳过 `ensureBranch`；继续工作树与 run | `saved` / `ready`；`branchExternalId` = 持久 intent 的名字；`branchHeadCommit` 来自探针 |
| `adopted`（worktree） | `getWorktree({externalId: intent.input.path})` 命中且 `branch === intent.input.branch` | 认领事务写 adopted branch（若有）与 **adopted worktree 句柄** + 代际 +1；`provisionGit` 跳过 `ensureWorktree`；预检使用被采纳路径 | `saved` / `ready`；`worktreeExternalId` = 探针命中的路径 |
| `absent` | 分支读完所有分页无同名；工作树确定 `not_found` | 认领事务覆盖同 key 旧槽位后，该步**恰好重发一次**；工作树重发输入固定为 `intent.input.path`（`resendPath`），绝不用本次请求重新推导 | `saved` / `ready`；外部对象各一份 |
| `conflict` | 工作树命中但检出分支 ≠ `intent.input.branch` | 零写入，报告 `attemptedValue` / `lastKnownAuthoritative` | `conflict`，两侧值都可见 |
| `inconclusive` | 读失败/权限/缺能力/缺 `intent.input.path`/provider 抛错 | 零写入、零外部写；保留 pending 行与 provisioning 上下文 | `unknown` + 读失败自身 code + 「对账只读，未重发」 |
| 不合资格 | 任一资格条件不满足 | 完全沿用今天：`replayRequest` / `safeResume` / observe | `pending`，零写入 |

**报告阶段（WritePhase）的诚实口径**：最终结果面的 report 来自**最后一个实际步骤**。被采纳的是 branch、工作树随后被真实创建时，最终 report 是 `confirmed`；被采纳的是 worktree（末步）时是 `reconciled`。两者 `writeState='saved'`、`confirmed=true`。本计划**不为**「必须报 reconciled」新增合成报告（见 D10）；验收只断言 `writeState` / `confirmed` / `status` / 外部对象计数。

### 你不该期待的行为（边界）

- 租约未过期时同 key 重放仍报 `pending`，**不探测**：租约是既有接管边界，不是新时间权威；用户等 30s 后再试即可。
- 进程内仍有 owner 在供应时，即使租约过期也不探测、不取代：本进程的 owner 是唯一能让「外部调用还在飞」成立的证据，不能被时间阈值推翻（D1）。
- 跨 key（换 idempotency key）仍被保守阻挡成 `pending`：这是 #683 的范围，本 PR 不开（D4）。
- `intent.input.path` 缺失的 pending 工作树意图只能停在 `unknown`：没有持久句柄就无法证明目标，新增耐久输入字段越出范围（#673 D21 的 R-A 同源残余）。
- `absent` 的分支重发会按 provider 当前默认分支重新取基线（`ensureBranch → baseRef`），不重放 `intent.input.fromRef`：与 #673 同一残余（分支名不变、只影响起点），不产生第二份对象。

### 被放弃的方案

1. **给 `mutation_attempt` 加 `resolution`/`last_known_state` 列或新表**：把「怎么知道的」物化成第二状态轴（L1/#119 已拆掉），且结论会过期；issue #682 验收 1 明示禁止第二列/第二权威。
2. **把 pending 行按「租约过期」直接判成可重发（不探测）**：租约不是外部副作用的证据；不探测就重发会违反「先对账再动作」，且可能对已落地的分支/工作树再发一次写。issue 验收 2 明示禁止。
3. **启动时批量扫描 `mutation_attempt` 做对账**：把宿主启动与外部可用性硬耦合，且仍要落「上次对账结论」才能避免重复扫描，等于方案 1 的变体。
4. **新 key 接管旧未决槽位**：与端口契约「未决槽位由 core 跨 key 阻挡」（`capabilities/storage.ts` 398–400）与 DDL 注释冲突；属 #683，需要新 authority 规则。
5. **由对账直接结算并对外报 Saved（不续跑供应）**：会让「分支在、工作树/run 未建」冒充权威 Saved，违反「外部写 ack/reconcile 前本地不得显示权威 Saved」（`AGENTS.md` §1.1）。
6. **自动推进「退休代际」的 pending 意图**（某设计提出：认领后如遗留 ownerGeneration < 当前代际的 pending intent，就替它推进）：**不可达**（见 D7 的证明），且会让写者在 `owned(generation)` 之外改 intent 行，等于第二个写者；驳回。
7. **把恢复探测放进查询/读路径或 `WriteLedger.replay`**：读路径调 provider 越过读门与 Host 权威；`replay` 只回答已结算收据。
8. **修改 `001_init.sql` 的过期注释**：单资产基线字节冻结（#596/#658/#659），SQL 不得改（D3）。

### 不变量（实现与测试都必须成立）

- I1 对账只读：`adopted/absent/conflict/inconclusive` 任一结论在认领事务之前零写入；结论不落盘。
- I2 所有恢复写入只发生在认领事务或 `owned(generation)` 内；provider I/O 不进事务。
- I3 时序资格：认领事务内 attempt 行**与** execution_context 记录都必须与采样逐字相同，否则不得采纳。
- I4 代际围栏不变：旧 owner 的迟到写一律 `OwnerLost`，不得覆盖后继；`preflight`/provider 读不能绕过写门。
- I5 采纳不重发：被证明落地的步骤不发起外部写；被证明缺失才重发，且恰好一次。
- I6 `absent` 只能来自完整读取（分支分页读完 / 确定 `not_found`）；读失败、权限、缺能力、provider 抛错一律 `inconclusive`。
- I7 不确定不冒充：`inconclusive` 保持 `unknown`，零外部写、不起第二个 run；不得把 unknown 显示成 Saved。
- I8 未决槽位跨 key 仍保守阻挡；新 key 不因本改动获得接管能力。
- I9 `unknown` 行（#673）行为逐字不变；本次只扩谓词与 pending 专属资格。
- I10 只有被 ack 或被只读对账证明的句柄才可耐久；`has_worktree` 边仍只由成功结算写。

### 命名与边界决策

- 谓词函数改名 `recoverableGitIntent`（旧名 `unknownGitIntent` 在扩展后不再准确）；结论类型与 `reconcileGitStep` 形状不变。
- 不新增 wire 字段、不新增客户端状态、不改 UI 文案；`pending` 与 `unknown` 的既有展示语义不变。
- 恢复的判定只由「持久记录 + 当次只读探测」组成；`activeOwners` 只用于否决，不作为授权。

## Global Constraints

- **允许改的文件（唯一声明处）**：
  - `packages/core/src/git-provisioning.ts`
  - `packages/core/src/start-work.ts`
  - `tests/integration/start-work-pending-recovery.test.js`（新增）
  - `tests/integration/start-work-external-intent.test.js`
  - `tests/integration/start-work-request-binding.test.js`
  - `docs/exec-plan/active/2026-11-27-crash-left-pending-git-recovery.md`（本计划）
  - `docs/README.md`（仅 Active 索引一行）
- **禁止改**：`packages/capabilities/`、`packages/domain/`、`packages/storage/sqlite/`（含 `001_init.sql` 与任何迁移）、`packages/client/`、`packages/controller/`、`packages/ui/`、`packages/ui-model/`、`packages/providers/`、`apps/`、`tests/contract/`、`tests/e2e/`、`.github/`、`docs/adr/`、`docs/architecture/`、`docs/product/`、`package.json`、`pnpm-lock.yaml`。
- 不新增依赖、端口、表、列、事件、迁移、兼容层或开关；不做数据修复。
- **体量**（估）：生产 `+60/−19`；测试 `+370/−14`（新文件约 340、两个既有文件约 44）；文档 360 行（本计划 359 + `docs/README.md` 索引 1）。技术改动合计约 463（用户预算 800，仓库硬上限 1000）；文档 360（用户 1300，硬上限 1500）。实现后以 V6 回读的实测数为准；若实测技术改动 > 800，先取得人类对预算的确认，不得静默越过。
- **判别力**：只允许新增用例与新增断言；不删既有用例、不放宽既有断言、不改变既有注入语义。`unknown` 行（#673）的 142 条既有用例必须逐字保持绿。
- **行为边界**：不放开跨 key；不改变 `pending`/`unknown`/`saved` 的 `WriteState` 映射；不改 UI；不改 provider 契约；不新增公开 API。
- 语言：文档正文中文；代码标识符、路径与命令英文；提交信息 `<type>(<scope>): <中文摘要>`，正文说明为什么，末尾 `Closes #682` + `Refs #191` + `Refs #683`（PR body 同一口径）。
- 验证命令只在 `Validation and Acceptance` 定义一次（V0–V8），批次只引用编号；同一命令不重复展开。
- 证据带执行上下文：所有验证在检出 `fix/crash-left-pending-recovery` 的工作树 `.worktrees/crash-left-pending-recovery/` 根目录运行；先执行 V0 安装依赖；不把本机绝对路径写进文档。
- 易失值（head SHA、测试条数、行数、check 列表）一律写成「回读命令 + 期望」，不回抄成正文事实。

## Plan of Work

### Batch 1 · 判别性用例先行（红，只改测试）

**最小闭环**：新用例在旧实现上按预期失败（失败形态是行为断言：`pending` 而非 `saved`/`conflict`/`unknown`，或探针 0 次），两条守卫负控在旧实现上本来就绿；产品代码零改动。

**涉及文件**：`tests/integration/start-work-pending-recovery.test.js`（新增）、`tests/integration/start-work-external-intent.test.js`、`tests/integration/start-work-request-binding.test.js`。

1. **新文件的结构**：沿用 `start-work-external-intent.test.js` 的 `setup(kind)` / `depsOf` / `sqlite()` / `controllableClock` 形状，`kind ∈ {'Fake','SQLite'}`；新增两个夹具：
   - `crashAfterIntentCommit(w, operation)`：包装 `storage.transaction`，在某个事务提交之后检查同 key 行，若 `externalIntent.operation === operation && externalIntent.state === 'pending'` 则抛 `Error('测试注入：意图提交后进程退出')`，且只抛一次。它把「答复 `unknown`、落库 `pending`」的崩溃残留状态造出来（与 `start-work-external-intent.test.js` 既有注入同一手法）。
   - `restart(w)`：SQLite 关库 → 同路径 `openDatabase`/`createSqliteStorage`；Fake 用 `createFakeStorage(exportFakeStorageState(w.storage))`；两者都重新 `composeCore(depsOf(w))`。provider 对象保持（外部对象活在 provider 内存/磁盘上）。
   - 计数辅助：`probes(w)`（包装 `listBranches` 与 `getWorktree`）、`creates(w)`（包装 `createBranch`/`createWorktree`）、`counts(w)`（分支/工作树/run 数）、`attempt(w)`、`record(w)`。**零写入判据 = `mutation_attempt` 行 + `execution_context` 记录逐字相等 + 外部对象计数不变**；不要用整库快照：只读对账经过读门时会写 `sync_cursor`/运行权限记账（S7）。
2. **用例表**（每条都断言「探针 ≥1」与「外部写计数」两个判别点，而不是只看最终 saved；除 C8/C9 外，每条都按表内前置重启或重新组装 core 并推进 31s 越过租约后，用**同一 key** 重放；C8 不推进时钟、C9 保留进程内 owner）：

| # | 场景 | 关键注入 / 前置 | 断言（恢复后同 key） |
|---|---|---|---|
| C1 | pending createBranch，目标不存在 | 崩溃残留后不预建分支 | `saved`/`ready`；探针≥1；`createBranch` 共 1 次（重发恰好一次）；分支 1、工作树 1、run 1；行 `saved` |
| C2 | pending createBranch，目标已存在 | 崩溃前用 provider 直接预建同名分支 | `saved`/`ready`；探针≥1；核心 `createBranch` 0 次；`branchExternalId`=持久 intent 名；`branchHeadCommit`=预建头 |
| C3 | pending createWorktree，目标不存在且默认目标漂移 | 崩溃后把 preflight 默认目标从 `.worktrees/original-target` 改为 `.worktrees/new-default` | `saved`/`ready`；探针≥1；`createWorktree` 共 1 次且输入 `path` 等于持久 `intent.input.path`；工作树只 1 份且路径为 original |
| C4 | pending createWorktree，目标已落地 | 崩溃后用 provider 按 `intent.input.path` 直接建工作树 | `saved`/`ready`；探针≥1；核心 `createWorktree` 0 次；`worktreeExternalId`=持久路径；工作树 1 份 |
| C5 | pending createWorktree，命中但分支不符 | 崩溃后把同路径工作树记录的分支改成 `work/other` | `conflict`；消息点名两侧分支；attempt 行与 context 记录逐字不变；零外部写 |
| C6 | pending 意图 + 读不可用 | 崩溃后把 `listBranches` 或 `getWorktree` 换成 `unavailable` | `unknown`；消息含「对账只读，未重发」；attempt 行与 context 记录逐字不变（读门记账见 S7）；零外部写、无 run |
| C7 | pending 意图 + 写门只读 | 崩溃后用 `policy` 把 `DevelopmentBranchCreate` 与 `DevelopmentWorktreeCreate` 都设为 `ReadOnly` 组装 core | `unknown` + `permission_denied`；行/记录逐字不变、零外部写；恢复策略 + 同 key 后 `saved`/`ready`（F2 形状） |
| C8 | 租约内同 key（负控） | 崩溃后不推进时钟 | `pending`；探针 0；记录与行逐字不变；零外部写 |
| C9 | 进程内 owner 越过租约（负控，M3 判别） | 用 barrier 把 `createWorktree` 挂在半空（同 `start-work-step-recording` 在途用例手法），推进 31s 后同 key 再发 | `pending`；探针 0；记录与行逐字不变 |
| C10 | 采样后记录被别的写者改（M2 判别） | 崩溃残留 createBranch + 已存在分支；在 `listBranches` 探针里直接写 `execution_context`：`status='ready'`、`provisioningGeneration += 5`（行不动） | 不得采纳：`pending`；探针≥1；记录仍为注入值、行逐字不变、零外部写 |
| C11 | 认领提交后崩溃、被采纳工作树句柄必须耐久（M8 判别） | C4 的采纳路径；在同 key 恢复时注入「认领事务提交后抛错」，再重启、改默认目标、推进租约、再同 key | 第一次恢复 `rejects`；重启后同 key `saved`/`ready`；工作树只 1 份且仍是 original 路径；记录 `worktreeExternalId`=original |
| C12 | 手工构造跨步错位记录（M10 判别） | 崩溃残留 createWorktree，但直接改记录 `branchExternalId` 为另一个分支 | 不合资格、不采纳：`pending`；探针 0；attempt 行与 context 记录不变 |

3. **真实 Git / SQLite 重开矩阵**（同一新文件；复用 `tests/integration/local-git-fixture.js` 的 `fixtureFor` / `providerFor` / `controllableClock` / `LEASE_EXPIRED_MS` / `coreContextFor` / `registerWorkItem` / `worktreePaths` / `git`）：
   - G1 pending createBranch 不存在 → 关库重开 → 同 key：`ready`、`refs/heads/work/*` 恰好 1 条、`worktreePaths == [repositoryPath, expectedPath]`；
   - G2 pending createWorktree 不存在 → 关库重开 → 同 key：`ready`、真实磁盘只有主检出 + 1 份工作树、`createWorktree` 真实执行 1 次；
   - G3 pending createWorktree 已落地（用 provider 按持久 `intent.input.path` 直接建）→ 关库重开 → 同 key：`ready`、工作树仍 1 份、不新增登记。
4. **两个既有文件的改写**：
   - `start-work-external-intent.test.js` 末尾「committed intent before call interruption remains conservative」（139–146）：**改写契约**——崩溃残留（答复 `unknown`、落库 `pending`）后，越过 31s **同 key** 重放必须收敛为 `saved`/`ready`、核心 `createBranch` 恰好 1 次、最终行 `saved`；插入断言前先保留「恢复前新 key `replacement` 仍 `pending` 且不占键」作为跨 key 负控（#683 边界）。
   - `start-work-request-binding.test.js` 的「Pending exact replay observes without lease takeover」（55–71）：改名为「进程内 owner 在租约内外都否决接管」，加入 `listBranches`/`getWorktree` 探针计数，断言 `advance ∈ {0, 60_000}` 两档都 `pending`、`probes === 0`、库快照逐字不变。它编码的新契约是：**保护来自进程内 owner 否决，不是「pending 永远不可恢复」**（D1/D11）；数值期望不变是为了保住 in-flight 安全。
   - 不改 `start-work-request-binding.test.js` 的 SQLite 关库重开三阶段用例（145–155）：它用「provider 内抛错」造的是 `unknown` 行，属 #673 已覆盖行为，重复的恢复矩阵由新文件持有，避免同一行为两份用例。
5. **验证（红态）**：V0（首次安装）、V1、V2（期望 C1–C7、C10–C12、G1–G3 失败，失败形态为 `pending !== saved/conflict/unknown` 或 `probes 0 !== ≥1`；C8/C9 绿——负控的定义）、V3（期望既有 142 条仍绿，除被改写的两条按新期望红）、V4。
6. **回滚**：`git revert <Batch 1 commit>`（只删/改测试，产品行为不变）。

### Batch 2 · 生产修复（绿）

**最小闭环**：谓词扩展 + pending 资格 + 认领事务内时序复核 + adopted 句柄耐久；四个新文件用例与两条改写全绿，`unknown` 路径（#673）142 条既有用例逐字保持绿。

**涉及文件**：`packages/core/src/git-provisioning.ts`、`packages/core/src/start-work.ts`（见 `Global Constraints`）。

1. `git-provisioning.ts`（386–391）：`unknownGitIntent → recoverableGitIntent`；新增 pending 分支；注释写清「pending 行是 beforeExternal 已提交、写结果未知的崩溃残留；unknown 行是 settle 已提交的未决结论；两者共用同一只读对账与同一结论类型」。
2. `start-work.ts` 的 `Resuming`（183–187）：加 `record: ExecutionContextRecord`；`reconcileReplay`（198–224）返回它，并按 Design 第 2 条加入 pending 专属资格与 activeOwners 否决；`unknown` 路径只增加 veto、其余不变。
3. `claimContext`（434–516）：先读 `attempt` 与 `existing`，再算 `sampled = resuming !== undefined && isDeepStrictEqual(attempt, resuming.attempt) && isDeepStrictEqual(existing, resuming.record)`；`resuming !== undefined && !sampled` 时按「无 resuming」路径处理（现有 replay / `safeResume` / observe 判定不动）。注意 `pendingClaim` 的「同 key 证据行」放行判定（454–458）继续用 `resuming.attempt`，只在 sampled 成立时才可能进入；不成立时该行会走 observe/replay。
4. `claimContext` 过期 Provisioning 续跑分支（508）：把 `adoptedWorktree` 与 `adoptedBranch` 一并写入同一事务，并订正注释；**不**在其它路径凭空产生句柄（`has_worktree` 边仍只由 settle 写）。
5. 不改 `provisionGit` 的 adopted 逻辑（196–241 已具备：预检使用 adopted 路径、跳过被采纳步骤、不把跳过记成能力健康、branch headCommit 透传）；pending 路径走同一代码。
6. **验证（绿态）**：V1、V2、V3、V4、V5；记录每条用例的实测输出到 `Progress`。
7. **回滚**：`git revert <Batch 2 commit>`——回到「pending 行永久重放」的旧行为；无 schema/迁移，pending 行仍在且仍被保守阻挡，无数据损坏风险。

### Batch 3 · 变异验证、文档与归档前收尾

**最小闭环**：十个变异各自只让对应判别用例变红（输出逐条记入 `Progress`），每个变异还原后重跑映射命令确认绿；文档（本计划 + `docs/README.md`）落盘，V6/V7/V8 达标。

**涉及文件**：本计划、`docs/README.md`（仅索引），以及变异期间临时改动的两个生产文件（必须逐个还原）。

| 变异 | 改动 | 期望只让谁红 |
|---|---|---|
| M1 | `recoverableGitIntent` 只保留 `state==='unknown'` 分支 | V2 全部 pending 正控（C1–C7、C10–C12、G1–G3） |
| M2 | 删认领事务里的 `isDeepStrictEqual(existing, resuming.record)` | C10 |
| M3 | 删 `reconcileReplay` 的 activeOwners 否决 | C9 |
| M4 | pending 资格去掉 `leaseExpired` / `record.status === 'Provisioning'` | C8 |
| M5 | 工作树 absent 重发改用 `namesFor(request)`（当前默认目标） | C3、G2 |
| M6 | 把 `probe.error` 当 `absent` | C6 |
| M7 | 删工作树探针的分支一致性检查 | C5 |
| M8 | 删 508 的 `adoptedWorktree` 写回 | C11 |
| M9 | 删 508 的 `adoptedBranch` 写回 | C2（核心 createBranch 变成 1 次） |
| M10 | 删 pending 的跨步一致性资格（Design 第 2 条第 2 项） | C12 |

变异纪律：一次只改一处 → 跑映射命令记录 RED → `git checkout -- <file>`（或字节备份还原）→ 重跑确认 GREEN → 才做下一个。任何变异跑不出红：先补一条针对该守卫的负控（只加断言），补不出判别用例的守卫按最小化原则删除并记入 `Decision Log`。

**文档步骤**：

1. 本计划已写在 `docs/exec-plan/active/2026-11-27-crash-left-pending-git-recovery.md`；实现后回填 `Progress`、`Surprises & Discoveries`、`Outcomes & Retrospective`。
2. `docs/README.md` 的 `### Active` 表加一行（本计划路径 + 一句话用途）。
3. 交付面（规划所有者/人类执行，不在本计划内）：PR body 写清闭环、ExecPlan + Batch、`Closes #682` / `Refs #191` / `Refs #683`、V0–V8 实测、残余风险与回滚；push 后回读 head/base/checks/issue 关联/threads；不自行合并。

**验证**：V6、V7、V8；还原全部变异后重跑 V1–V5。
**回滚**：文档单独 commit，可整体 revert；变异只存在于工作区，不提交。

## Validation and Acceptance

以下命令是唯一来源，均在工作树 `.worktrees/crash-left-pending-recovery/` 根目录运行（批次只引用编号）：

- **V0** `pnpm install --frozen-lockfile` → 期望 exit 0（工作树首次运行前的一次性准备；不改变 lockfile）。
- **V1** `pnpm run typecheck` → 期望 exit 0、无输出。
- **V2** `pnpm test:file tests/integration/start-work-pending-recovery.test.js` → 期望 `fail 0`；实现后回读实测 `tests / pass / fail` 条数并记入 `Progress`（C1–C12 各 `kind` 两条 + G1–G3，预计 27 条上下，以实测为准）。
- **V3** `pnpm test:file tests/integration/start-work-external-intent.test.js tests/integration/start-work-request-binding.test.js tests/integration/start-work-step-recording.test.js tests/integration/start-work-owner-fencing.test.js` → 期望 `fail 0`；基线 `142 / 142 / 0`（历史时点），改写后条数以回读为准，`step-recording` 的 #673 用例必须逐条出现在 pass 列表。
- **V4** `pnpm test:file tests/integration/local-git-core-provisioning.test.js tests/integration/start-work-execution-uniqueness.test.js tests/integration/start-work-retry-identity.test.js` → 期望 `fail 0`；基线 `20/20` 与 `54/54`（历史时点），条数以回读为准。
- **V5** `pnpm run boundaries` → 期望 `tests 10` / `pass 10` / `fail 0`。
- **V6** `node scripts/rule-checks.mjs size main` → 期望首行打印 base/head 后给出代码与文档行数；判据：代码 ≤800（用户预算）/ ≤1000（仓库硬上限），文档 ≤1300 / ≤1500；实测值回读记入 `Progress`。
- **V7** `node scripts/rule-checks.mjs disclosure main` → 期望输出含「机械扫描通过」。
- **V8** `git diff --check main...HEAD` → 期望无输出、exit 0。

**验收判据（全部满足才算完成）**：

1. **判别性**：Batch 1 的 C1–C7、C10–C12、G1–G3 在旧实现上红、Batch 2 后全绿；C8/C9 在两个阶段都绿（负控定义）。M1–M10 各自只让表中用例红，逐条记录 RED/GREEN 输出。
2. **产品面**：崩溃残留 pending 在重启且租约过期后，同 key 重放收敛到 `ready`，分支/工作树/run 各一份；provider 不可读时保持 `unknown` 且零外部写；工作树分支不符时 `conflict` 且零写入；租约内/进程内在途时不探测、`pending` 且库快照不变。
3. **守卫面**：V3 全绿——`unknown` 行四态行为、写门拒绝保留 unknown、采样行推进不采纳、旧代际与在途不探测逐条保持；新 key 仍被保守阻挡（改写的负控与 `owner-fencing` 的 `winner` 用例）。
4. **边界面**：`git diff --stat` 只含 `Global Constraints` 列出的文件；无 schema/契约/API/UI 变化；V5/V6/V7/V8 达标。
5. **诚实的证据边界**：证据面 = Fake + 真实 local-git 临时仓库 + 真实 SQLite 关库重开 + barrier；真实平台 Host/Provider 端到端、双进程并发、跨 key 不在此声明（残余见 `Outcomes & Retrospective`）；#191 保持 OPEN，`Closes #682`，`Refs #683`。

**issue #682 验收对照**：

| #682 验收 | 本计划的落点 | 判别证据 |
|---|---|---|
| AC1 记录 owner/代际与活性证据；保留 active-owner fence；不把时间阈值/进程内标志变成权威；不加第二列 | Design 第 1–4 条 + D1/D2/D6/D7；无 schema | V2 C8/C9；M3/M4 |
| AC2 硬崩溃 fixture 停在写前/写后/回执前边界，重建 Core/SQLite 后对同一目标对账再动作；唯一既有目标可采纳，含糊/不可读保持 unknown 且不起第二个 run | C1–C7、G1–G3、C11；C6/C7 | V2、V4 |
| AC3 旧 owner 与迟到回复不可取代/覆盖新代际；transaction-time 反例；保留同 key unknown 与不可变回执 | 认领事务时序复核 + `owned()`；C9/C10；V3 #673 用例 | V2 C10、V3 |
| AC4 恢复保留耐久对象身份、一个外部对象、诚实可见状态；不声称一次 Provider 调用 | 采纳/重发/冲突结论表；WritePhase 口径 D10；C1–C5 | V2 |
| AC5 #191 关闭条件与残余跨 key/Planning/真实 Host 证据显式记录；若需不同 authority 先取决定 | D5 + Outcomes 残余清单 + Decision Log | 文档 |

## Progress

- [x] (2026-11-27 15:38–15:52 Asia/Singapore) 事实核对与基线取证：读 `start-work.ts`、`git-provisioning.ts`、`write-machine.ts`、`capabilities/storage.ts`、`001_init.sql`、ADR-0016、`2026-11-21-restart-reconciliation.md` D6/D20/D21/D23 与相关测试；在 `f5b731a4` 主检出实测 V3 `142/142`、`local-git-core-provisioning 20/20`、`execution-uniqueness + retry-identity 54/54`；一次性只读探针确认崩溃残留 pending 行同 key 重放仍 `pending`、探针 0、代际不变（S1）。
- [x] (2026-11-27 Asia/Singapore) 独立验证（只读，未改文件）：Q1「退休代际 pending intent 不可达」证明成立（代际推进事务总在同事务清空 intent 行）；Q2「无 veto 时 31s 后同 key 会探测并改代际」与「加 veto 后 pending、零探针、零写」均确认；Q3 被采纳分支最终阶段为 `confirmed`（末步是工作树）；Q4 事务内只采样两条契约行、`AdmissionInvalid` 整笔回滚不构成误杀；Q5 `unsettled` 写门路径对 pending 恢复同样成立（零写入保留可恢复 unknown）。据此补充 S7/D13 与零写入判据。
- [ ] Batch 1 · 判别性用例先行（红，只改测试）：V2 期望按用例表失败、C8/C9 绿；记录条数与失败形态。
- [ ] Batch 2 · 生产修复（绿）：V1–V5 全绿，记录 `unknown` 路径零回归证据。
- [ ] Batch 3 · 变异 M1–M10、文档与 `docs/README.md` 索引、V6/V7/V8 收尾。

## Surprises & Discoveries

- **S1 缺口实测（2026-11-27，f5b731a4，主检出）**：用 `crashAfterIntentCommit` 手法造出崩溃残留 pending 行（`createBranch` 与 `createWorktree` 各一次），越过 `LEASE_EXPIRED_MS` 后同 key 重放：`writeState='pending'`、`status='provisioning'`、探针读 0 次、`provisioningGeneration` 仍 1、外部对象计数不变、行与记录逐字不变。结论：本 issue 的缺口是「谓词不认 pending」，不是「没有对账实现」。
- **S2 对三份设计一处共同说法的订正**：三份设计都写「request-binding 的在途用例只保护 within-lease」。实测与代码表明，今天 0ms 与 60s 两档都由 `unresolved(attempt)` 的重放分支保护（`replayRequest` 174），与租约无关；本改动后 60s 档的保护改由 `activeOwners` 否决承担。因此该用例的**数值期望不变**，真正变化的是它所编码的契约（D1/D11）。
- **S3 DDL 注释有两处过时，不止 338**：`001_init.sql` 的 329（「同键精确回放只观察，不接管租约」）与 338（「未知步骤跨 key/lease 保守阻挡，非自动恢复日志」）在 #673 之后都已部分失真；本计划只按 D3 在计划与代码注释里 supersede，**不改 SQL**（单资产基线字节冻结）。
- **S4 `unknown` 与 `pending` 的上下文状态不同构**：`unknown` 恒伴随 `failed` 上下文（settle 原子写），`pending` 恒伴随 `provisioning` 上下文；`failed + pending intent` 只可能由手工写库构造（跨 key 的 467 行 markFailed 只作用于 intent 已 saved 的行）。因此 pending 恢复要求 `record.status === 'Provisioning'`，unknown 路径的 `needsSupply` 语义保持不变。
- **S5 Fake 的默认 worktree 句柄是稳定的 key 形状，不是文件系统路径**：默认请求下 `preflightWorktree` 返回 `worktreeKey`（工作项 id 归一化串），所以持久 `intent.input.path` 在 Fake 里没有路径分隔符；测试断言必须与**回读的 intent.input.path** 比较，不能写死 `.worktrees/...`。真实 Git 矩阵里它是规范化绝对路径。
- **S6 被采纳分支的报告阶段是 `confirmed` 不是 `reconciled`**：`provisionGit` 用 `recorded.branchExternalId` 跳过分支步并合成 `confirmWrite` 报告，最终结果面取末步（工作树）报告；只有末步被采纳时才是 `reconciled`。验收因此不断言阶段名（D10），避免把实现细节钉成产品契约。

- **S7 只读对账不是「对整库零副作用」**：探针经 `guardedDevelopmentReads` 的读门会写 `sync_cursor` 与运行权限记账（`runtime-access.ts` 的版本/交付票），因此「零写入」的判别对象必须是 **`mutation_attempt` 行 + `execution_context` 记录 + 外部对象计数**，不是整库快照；同理，认领事务内做逐字复核时只采样这两条契约行（全库快照会把自己与读门记账一起卷进来）。独立验证（2026-11-27）另确认：记录-only 写者（Ready 读回校验）不可能与 pending Git intent 共存，因此「记录变了」只可能来自外部写者，判为失效不是误杀。

## Decision Log

- **D1（2026-11-27，评审收敛；D1 处置）保留进程内 `activeOwners` 否决；「租约过期可被取代」只适用于进程外/活性不可知的 owner。** Rationale：in-process owner 是「外部调用可能仍在飞」的唯一进程内证据；一旦越过租约就取代它，会让同一步在同一进程内被并发重发两次，而收益为零——真正的 #682 场景（进程崩溃）里新 CoreContext 的 activeOwners 为空，恢复不受影响。否决只**拒绝发起恢复**，不构成时间/进程内标志成为权威（符合 #682 AC1）。跨进程双活 owner 的取代仍然是 D1 批准的行为（见 D4），安全依据是「先只读探测再动作」+ provider 的 conflict 复用契约，不是租约本身。若 Lead 要求「进程内也按租约取代」，需要人类确认，因为它会改变 `start-work-request-binding` 的 in-flight 契约与并发的对外写次数。
- **D2（2026-11-27；D2 处置）不新增耐久活性谓词。** Rationale：活性证据 = 既有 `provisioningGeneration`/binding/指纹围栏 + 当次只读探测结论；加 heartbeat/last-seen/租约续期列会成为第二状态轴（AC1 禁止）且结论会过期。记录：本题的「活性」是**决策是否需要动作**的证据，不是产品状态。
- **D3（2026-11-27；D3 处置）`001_init.sql` 保持字节冻结；329/338 的表述在计划与代码注释里 supersede，不改 SQL。** Rationale：单资产基线（#596/#658/#659）要求安装件字节一致；DDL 注释不是运行时契约，但**是**发布面事实，故用 `Superseded by` 记录。不在 SQL 里写「pending 也可恢复」，以免把过期句子留成假事实。
- **D4（2026-11-27；D4 处置）跨进程双 Host 同 profile DB 仍是文档化残余，不在本 PR。** Rationale：第二个进程无法观察第一个进程的 activeOwners；它可能在租约过期后取代一个仍活着的 owner。后果被本设计限住（探测先于动作；旧 owner 的本地写被代际围栏拒绝；同一目标的重发由 provider conflict 复用吸收），但「谁是活性权威」需要新的 authority 规则，超出 #682 的「不新增权威」，归 #683/后续。记录在 `Outcomes & Retrospective`。
- **D5（2026-11-27；D5 处置）#191 保持 OPEN，`Closes #682`，`Refs #683`。** Rationale：#191 关闭条件没有子集限定；本 PR 只补「同 key / 崩溃残留 pending / Git 两创建步」子集，沿用 #673 的 D20/D23 交付口径。PR body 必须写已验证子集与残余清单，不宣告 #191 关闭。
- **D6（2026-11-27）租约只决定「何时允许探测/接管」，探测结论才是动作依据；不引入心跳或时间证据。** Rationale：#682 验收 1/2 明确「elapsed lease time alone is not proof」；本设计的动作全部由完整读取（`nextCursor === undefined` / 确定 `not_found`）或明确的 `conflict`/`inconclusive` 决定。
- **D7（2026-11-27）驳回「退休代际 pending intent 自动推进」。** 证明：`provisioningGeneration` 只在 `claimContext` 的 `nextGeneration` 处推进（`start-work.ts` 461、487、501、508）与 route 失败路径的 `saveContext(..., generation)`（472）；前四处与 `createWriteLedger.record`（479，写入不含 `externalIntent` 的新行）在**同一事务**内；472 处若 `attempt !== undefined`，同事务的 `writeReceipt` 会把根改成 `failed` 并把 intent.state 从 pending 推进成 failed，若 `attempt === undefined` 则根本没有遗留行。因此「根 pending、intent.state pending、且 intent.ownerGeneration < record.provisioningGeneration」不能被任何产品路径产生；`beforeExternal` 的 `unresolved` 拒绝是自洽性断言（触发即内部错误），不是可恢复状态。放宽它会在 `owned(generation)` 之外增加第二个 intent 写者，违反 I2/I4。
- **D8（2026-11-27）pending 恢复要求 `record.status === 'Provisioning'`，不碰终态与 Ready。** Rationale：`unknown` 行恒配 `failed` 上下文；`Ready + pending intent` 是 settle 与 recordRun 之间的既有缺口（#193 域），用 pending 恢复去驱动它会越过执行域边界并可能重复起 run。
- **D9（2026-11-27）过期 Provisioning 续跑分支（508）要写 adopted worktree 句柄，并订正旧注释。** Rationale：这是 #673 D21「被采纳身份必须与认领同事务耐久」的 pending 对应面。反例：采纳的 worktree A 在认领提交后、工作树步回填前崩溃，句柄只在内存里；重启后 `durablePath` 回落成请求/默认目标，默认目标漂移时会产生第二份工作树（C11/M8）。句柄来源仍是只读对账的 ack 等价证据，`has_worktree` 边仍只由成功结算写（I10）。
- **D10（2026-11-27）不为「必须报 reconciled」新造合成报告；验收断言 `writeState`/`confirmed`/`status`。** Rationale：report 来自末步；被采纳 branch + 新建 worktree 时阶段是 `confirmed`（S6）。把阶段名钉死会迫使代码伪造证据链，违反「权威 Saved 必须有证据」的类型流。
- **D11（2026-11-27）测试改写范围：`start-work-external-intent.test.js` 改契约（同 key 现在必须恢复），`start-work-request-binding.test.js` 改语义并补 veto 计数断言；不在 request-binding 里重复 SQLite 重开恢复矩阵。** Rationale：行为矩阵只应在最小地点出现一次（`docs/development/workflow.md` §2）；新文件持有完整矩阵，两个既有文件各自只改「编码了旧契约」的那一处。
- **D12（2026-11-27）预算与越界处理。** 目标技术改动约 463 行（用户预算 800）；若实测超过 800，先取得人类确认再继续，不静默越过；若需压缩，优先压缩新文件的重复矩阵（保留 C1/C3/C5/C6/C8/C11 与 G1/G2），不得删判别断言或把断言改成空断言。
- **D13（2026-11-27，独立验证补充）零写入与采样范围固定在两条契约行。** Rationale：只读对账经过读门会写 `sync_cursor`/运行权限记账，整库快照既不适合作为「零写入」判据，也会让认领事务内的时序复核被无关记账干扰；只采样 `mutation_attempt` 行与 `execution_context` 记录，正是「决策是否需要动作」所需的全部事实。

**仍需人类/Lead 的决定**：

1. D1 的「进程内 owner 是否也允许越过租约被取代」：本计划建议**不允许**（保留否决）。若 Lead 选择允许，需人类确认，并同时改写 `start-work-request-binding` 的 in-flight 契约与并发外部写次数证据。
2. 若 V6 实测技术改动 > 800 行用户预算：是否继续（需人类确认）或按 D12 压缩。
3. 关闭口径（D5）与 #683 归属由规划所有者/Lead 在 PR body 确认；这是机械交付面，不阻塞实现。

## Idempotence and Recovery

- **可重复执行**：只读对账、探针、V0–V8 全部幂等；同 key 重放在每次失败后都可再次执行，结论只由当次读取决定，不落盘。
- **单批失败**：Batch 1 失败只涉及测试，`git revert` 即可；Batch 2 失败回滚到「pending 永久重放」，pending 行仍在、仍被保守阻挡，无数据迁移、无需修库。Batch 3 文档可整体 revert。
- **实现期间的状态清洁**：变异只改工作区且逐个还原（`git checkout -- <file>` 或字节备份 + sha1 校验）；提交前 `git status --short` 必须只剩允许集合的改动，V8 无输出。
- **回到已知良好状态**：`git checkout -- packages/core/src/start-work.ts packages/core/src/git-provisioning.ts` + 删除新测试文件即可回到基线绿（V3 142/142、V4 20/54 的历史时点证据）；不涉及数据库文件、外部平台或凭据。
- **不做的事**：不删除/不做数据修复、不 prune 工作树、不动真实用户 profile、不创建 commit/PR（交付面由 Lead/人类执行）。

## Interfaces and Dependencies

- **代码内契约**：只改 `packages/core` 内两个文件的私有函数与类型（`recoverableGitIntent`、`Resuming`、`claimContext` 内部判定）；`packages/capabilities` 的 `Storage`/`MutationAttemptRecord`/`ExecutionContextRecord` 与 `GitReconcileOutcome` 形状不变。
- **Provider 能力**：分支探针需要 `DevelopmentRepositoryRead`（`listBranches`）；工作树探针需要 `DevelopmentWorktreeRead`（`getWorktree`），两者都经 `guardedDevelopmentReads` 的读门与能力记账；缺能力 → `inconclusive`。写门仍走 `runtimeAccess.operation(..., 'write')`。
- **Storage**：只用既有 `transaction` / `findMutationAttempt` / `putMutationAttempt` / `getExecutionContext` / `putExecutionContext` / `getExecutionRun`；SQLite 事务体是 `BEGIN IMMEDIATE`（#673 记录），认领内比较与写入串行。
- **运行时**：Node 版本按 `.nvmrc`、pnpm 按 `package.json`；租约 `30_000ms` 与测试的 `LEASE_EXPIRED_MS = 31_000`（`tests/integration/local-git-fixture.js`）耦合，改租约必须同改夹具（夹具注释已写明）。
- **外部系统**：无新增凭据、网络、平台 API；真实 Git 用例只在本机临时仓库与临时 SQLite 上跑，需 `git` 可执行。
- **发布/流程**：issue #682 是 `kind:fix area:core area:tests`；PR 用 `Closes #682`、`Refs #191`、`Refs #683`；分支保护只需 `PR Fast Gate`；不改 workflow。

## Outcomes & Retrospective

（执行完成后回填：实际改动行数、V0–V8 实测、M1–M10 结果、与计划的偏差、残余风险的实际状态。当前记录设计阶段的结论与已知残余。）

**已知残余（设计阶段）**：

1. **R1 跨进程双活 owner**（D4）：第二个 Host 可能在租约过期后取代一个仍活着的 owner；后果由「探测先于动作 + 代际围栏 + provider conflict 复用」限住，但活性权威问题归 #683/后续。
2. **R2 分支 absent 重发不重放 `fromRef`**：按 provider 当前默认分支重新取基线；分支名不变、只影响起点；与 #673 D21 R-A 同源，不产生第二份对象。
3. **R3 `conflict` 会留下长期 pending 行**：目标被别的分支占用时，同 key 会一直得到 `conflict`，需要外部修复（移除错误工作树）后才能收敛；这是诚实拒绝，不是自动修复。
4. **R4 缺持久 `intent.input.path` 的 pending 工作树意图**：只能 `inconclusive`（未知），不会重发、不会产生第二份对象；新增耐久输入字段越界。
5. **R5 provider 不遵守「同目标 conflict 复用」端口契约**：重发会得到 `invalid_input` 而非复用；属端口违约，不在支持面内。
6. **R6 证据边界**：无真实平台 Host/Provider 端到端、无双进程并发、无 Windows 原生证据；本 PR 只声明 Fake + 真实 local-git + 真实 SQLite 重开 + barrier。
7. **#191/#683 边界**：跨 key 与后继所有权仍 OPEN；#191 的关闭条件未全部覆盖。

**待执行时确认**：V6 实测行数、新文件实际条数、两个既有测试改写后的条数；如与估计偏差超过 30%，在 `Progress` 与本节记录原因（不静默调整预算）。

## Bottom Change Note

- 2026-11-27（Asia/Singapore）修订 1：并入独立验证结论（Q1–Q5），补 S7（零写入判据固定在两条契约行）、D13（采样范围）与 Progress 的独立验证条目；用途是让测试断言不误把读门记账当写入。
- 2026-11-27（Asia/Singapore）创建本计划：收敛三份独立设计，裁定 D1–D12；确定谓词扩展 + pending 专属资格 + 认领事务时序复核 + adopted 句柄耐久的实现面；给出 Batch 1–3、M1–M10、V0–V8 与残余风险。无代码改动。

