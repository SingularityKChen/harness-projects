# restart-reconciliation ExecPlan

> 状态：Active
> 创建：2026-11-21
> 范围：issue #191 —— Start Work 的同 key 重放在报告未决 Git 外部写之前，先重跑一次只读对账，用对账结论决定「采纳 / 重发 / 冲突 / 未知」；不新增列、表、port、兼容层
> 上游依据：issue #191 正文与验收（`kind:fix area:core`，Milestone M2.1）；`docs/adr/ADR-0004-unknown-external-create-is-product-visible.md`；`docs/architecture/gate-e1-ruling.md` §4 R8 与 §9 的偏离说明；`docs/product/vertical-path.md` §2
> 执行上下文：分支 `fix/restart-reconciliation`，隔离工作树 `.worktrees/restart-reconciliation/`，基线 `main@f74a3b8b`

## Purpose / Big Picture

完成之后，Start Work 的写路径满足 issue #191 的关闭条件「restart always re-runs reconciliation first」：一个已经落成 `mutation_attempt.state='unknown'` 的 Git 外部写（`createBranch` / `createWorktree`），在进程/宿主重启后用**同一 idempotency key** 再次进入时，core 先用持久 intent 里的精确输入做一次只读对账，再决定答复——

- 外部对象其实已经落地：直接采纳并继续把这次开始工作做完（分支、工作树、run 齐备，报 `reconciled`/Saved），**不重发同一步外部写**；
- 外部对象确定没落地（读完所有分页 / 确定 `not_found`）：重发那一步并继续，报 `confirmed`/Saved；
- 对账读到目标被别的分支占用：结构化 `conflict`，两侧值都报出，零写入；
- 对账读不出来（不可用 / 权限拒绝 / 缺能力 / provider 抛错）：保持 `unknown`，**零写入、零外部写**，错误里说清「对账跑过、未重发」。

用户可见的最小成功证据：一个 `unknown` 的 Start Work 在 provider 恢复可读后，用同一份表单再提交一次就收敛到 Ready，且工作项下的分支、工作树、run 各只有一份；provider 仍不可读时，再提交仍得 `unknown` 而不是伪 Saved，也不会产生第二份外部对象。

## Context and Orientation

**问题形状（已核实）**。Start Work 在每个真实外部 Git 调用之前把 operation + 精确 input + `contextId` + `ownerGeneration` + `bindingId` + `state` 写进 `mutation_attempt.external_intent_json`（`packages/core/src/start-work.ts:507-515`，类型见 `packages/capabilities/src/storage.ts:105-139`）。调用失败后 `ensureBranch`/`ensureWorktree` 只对 provider 返回的 `ambiguous_result`/`conflict` 读回一次（`packages/core/src/git-provisioning.ts:239-254`、`:270-295`）；**provider 抛异常的路径只 `markUnknown`、从不探测**（`:234`、`:268`）。因此落库的 `unknown` 可能表示「对过一次账没结论」，也可能表示「一次都没对过账」。

重放路径把这一行直接投影成报告：`startWork` 在 `packages/core/src/start-work.ts:55` 读到行，`:58` 若不能安全续跑就交给 `replayRequest`（`:155-168`），未决且非 run intent 时用 `createWriteLedger().replay()`（`packages/core/src/write-machine.ts:149-173`）把 `state` 翻译成 `Unknown`，**不调用任何 provider 读**。于是 provider 恢复可读之后，同一个 key 的重试永远得到 `unknown`，而没有任何代码路径会去读回——ADR-0004 要求「产品可见 unknown」以「对账窗口结束后仍无唯一结论」为条件，这个条件在重启后失效。

run intent 的重放**已经**重跑对账：`replayRequest:159` 走 `recoverAttempt`（`start-work.ts:178-212`）读回运行并 CAS 结算。缺的只是两个 Git 创建步骤，所以本修复与既有形状同构，不是新范式。

**关键术语**。

- 未决写（unresolved write）：`mutation_attempt` 中 `state='unknown'`、`externalIntent.operation ∈ {createBranch, createWorktree}` 的一行。
- 自然键：`createBranch` 的分支名（`intent.input.name`）、`createWorktree` 的工作树句柄（`intent.input.path`，由 provider 的 `preflightWorktree` 规范化后写进 intent；生产 local-git 与离线 fake 都提供它）。
- 同 key 重放：客户端对 `unknown` 复用同一个 idempotency key（`packages/client/src/start-work.ts:52,59`），表单在 `unknown`/`pending` 时冻结、可再次提交（`packages/ui/src/start-work-section.ts:27`）；client 实例每次插件加载只组合一次（`apps/harness-plugin/src/client.ts:72`），因此「关掉再打开对话框再提交」取到同一个 key。只有页面/插件重载才换 key。
- 归还点（recovery owner）：core 的命令 resume 所有者 `start-work.ts`；storage 不拥有分支语义，`write-machine.replay` 只回答已结算收据，查询路径不得调 provider。

**当前状态**。基线 `main@f74a3b8b` 全绿：`pnpm run typecheck` exit 0；`pnpm run boundaries` 10/10；`tests/integration/start-work-step-recording.test.js` 11/11；V3 列出的六个文件加 `tests/integration/local-git-core-provisioning.test.js` 同批合计 186/186。本轮另用一次性只读探针（未入库）确认红态：同 key 重放后 `listBranches`/`getWorktree` 调用数 **0**、外部写 **0**、结果仍是 `unknown` + `status=failed`。

**相关文件**。

- `packages/core/src/start-work.ts`：命令入口、认领事务、供应序列、结算、`existingResult`。
- `packages/core/src/git-provisioning.ts`：读门、`branchProbe`、`ensureBranch`/`ensureWorktree`、`provisionGit`。
- `packages/core/src/write-machine.ts`：写阶段与 `WriteLedger`（本 PR 零改动）。
- `packages/core/src/development-route.ts`：`selectDevelopment`/`routeDevelopment`、`START_WORK_ROUTE`。
- `packages/capabilities/src/storage.ts`：`MutationAttemptRecord`/`StartWorkExternalIntent`（本 PR 零改动）。
- 测试：`tests/integration/start-work-{step-recording,external-intent,request-binding,owner-fencing,retry-identity,execution-uniqueness}.test.js`、`tests/integration/local-git-core-provisioning.test.js`、`tests/e2e/start-work-recovery.test.js`。

## Design / Spec

### 方案（采纳）

在同 key 重放路径上插入一次**只读对账**，结论只在本次调用内存在：

| 对账结论 | 判定依据 | 行为 | 用户可见 |
|---|---|---|---|
| `adopted` | 分支：`branchProbe` 读完所有分页后命中同名；工作树：`getWorktree` 命中且检出分支等于持久 intent 的 `branch` | 带着证据进入现有认领/供应序列，**跳过被证明的那一步外部写**，其余步骤照旧跑完 | `reconciled`（Saved/Ready），报出分支头提交 |
| `absent` | 分支：读完全部分页仍无同名（`nextCursor === undefined`）；工作树：确定 `not_found` | 旧槽位在认领事务里先被覆盖，再重发那一步一次，其余步骤照旧 | `confirmed`（Saved/Ready） |
| `conflict` | 工作树命中但检出分支 ≠ 持久 intent 的 `branch` | 结构化拒绝，零写入 | `conflict`，两侧值都给出 |
| `inconclusive` | 读失败 / 权限拒绝 / 缺能力 / 缺持久句柄 / provider 抛错 | 保持 Unknown，零写入、零外部写 | `unknown` + 读失败自身的 code/message + 「对账只读，未重发」 |

**改写点 1 · `git-provisioning.ts`**：新增 `unknownGitIntent(attempt)`（只认 `commandName==='startWork'`、`state==='unknown'`、intent operation 是两种 Git 创建）与 `reconcileGitStep(context, route, attempt)`（返回 `adopted`/`absent`/`conflict`/`inconclusive`，或无候选时 `undefined`）。探测复用既有实现：分支走 `branchProbe`（同一文件、已按页读到 `nextCursor===undefined`、有页数上限），工作树走 `route.provider.getWorktree`，两者都经 `guardedDevelopmentReads`（同一读门与 capability 记账口径）。工作树的句柄只能是持久 `intent.input.path`；没有它时返回 `inconclusive`（不得用本次请求重新派生）。

**改写点 2 · `provisionGit` 接受 `adopted`**：`adopted.operation==='createBranch'` 时用 `reportFor(WritePhase.Reconciled, …)` + 证据里的 `value`/`headCommit` 代替 `ensureBranch`，并且预检必须用被采纳的分支名；`adopted.operation==='createWorktree'` 时用 `reportFor(WritePhase.Reconciled, …)` + 证据里的 path 代替 `ensureWorktree`，预检的 `path` 取被采纳的路径（预检本身照跑，preflight 仍是权限/安全边界）。两种跳过都**不得**调用 `context.runtimeAccess.observeOperation(..., false, version)` 把没做过的写记成能力健康。请求里声明的 `branchName` 若与被采纳/已决定的分支身份不同，仍按 `#183` 的语义结构化拒绝（`invalid_input`）。

**改写点 3 · `start-work.ts` 入口**：新增 `reconcileReplay(context, contextId, request, attempt)`，按顺序守卫后才探测：`attempt.commandName==='startWork'`；`attempt.state==='unknown'`；`!requestMismatch`；存在 Git intent；`record = getExecutionContext(contextId)` 存在且 `needsSupply(record, now)`（终态，或 `Provisioning` 且租约过期）；`getExecutionRun(runIdFor(contextId)) === undefined`；`intent.contextId === contextId`；`intent.ownerGeneration === record.provisioningGeneration`；`selectDevelopment(…, START_WORK_ROUTE.anchor[0])` 成功且 `bindingId === attempt.bindingId`。任一不满足 → 返回 `undefined`，走原行为（因此在途、Ready、已结算、路由已变、换请求指纹都完全不变）。`startWork` 把原来的 `:58` 守卫改成「有 `resuming` 证据则跳过 replay」，`inconclusive`/`conflict` 直接作为本次答复（用 `existingResult(contextId, report, false)` 保留既有句柄与状态，零写入），`adopted`/`absent` 继续走正常流程。

**改写点 4 · `claimContext(..., resuming)`**：`resuming` 携带被采样的 attempt 与 adopted 证据。(a) 第 `:383` 行的 replay 判定只在「当前行与采样行 `isDeepStrictEqual`」时跳过；(b) 第 `:389-394` 的 `pendingClaim → observe` 只对**同 key 的证据行**放行，其它分支行为不变（不同 key 的未决行仍 observe，第 `:399` 的结算分支仍只处理不同 key）；(c) 两个上下文写分支（`:425-427`、`:431-432`）在 adopted 是 `createBranch` 时把分支身份写进同一事务（与 `saveContext` 的「已决定的分支身份写一次」一致；**不**在此写工作树句柄——工作树句柄仍只由步骤回填产生，保持谱系锚点纪律）；(d) 认领事务覆盖同 key 行（`:411-412`）发生在任何外部调用之前，满足 R8「未决行不得先于结算发起第二次外部写」。

### 被放弃的方案

1. **给 `mutation_attempt` 加 `resolution` 列/新表/新 port**（issue 明示否决）：把「怎么知道的」重新物化成第二状态列，正是 L1（#119/#28）刚拆掉的轴；且落盘结论会过期，能力恢复后仍要重对账，还要额外失效规则。
2. **由新 idempotency key 接管旧未决槽位，并「取代」旧行**（设计 b 的跨 key 分支）：与端口契约「未决槽位由 core 跨 key 阻挡」（`packages/capabilities/src/storage.ts:396-398`）、DDL 注释「未知步骤跨 key/lease 保守阻挡，非自动恢复日志」（`packages/storage/sqlite/migrations/001_init.sql:338`）与 R8 偏离说明「未决槽位不因换 key 或租约过期解除」（`docs/architecture/gate-e1-ruling.md:242`）直接冲突；并且证成的写发生在旧行、操作交给新请求时，旧行无论记 `saved` 还是 `failed` 都会把获知方式塞回结果轴，还必须新增「谁能接管别人的未决操作」的 authority 规则。留作 follow-up issue（见 Decision Log D1）。
3. **claim 之前先 CAS 结算旧行，再重入 claim**（设计 b 的同 key 机制）：在「尚无 owner generation」的时刻引入第二个写者决定旧行结果；本方案改为对账零写入、所有写入留在既有 claim/provision 事务内（I1）。
4. **启动时扫描 `mutation_attempt` 批量对账**：把宿主启动与外部可用性硬耦合，且仍要落「上次对账时间/结论」才能避免重复扫描，等于方案 1 的变体；与 #193/#421 的责任边界也冲突。
5. **只修答复不续跑**（重探一次，命中就把答复改成 Saved）：会让「分支已存在但工作树/run 未建」冒充权威 Saved，违反「外部写入得到 ack/reconcile 前本地不得显示权威 Saved」。
6. **把未决 Git 写的对账下沉进 `write-machine` 投影层或查询路径**：前者让 `replay` 依赖 provider 语义抽象，后者让读路径调 provider、越过读门与 Host 权威。

### 不变量

- I1 对账只读：`inconclusive`/`conflict` 不写 context、attempt、relation；它不改变所有权，只改变这一次的答复。
- I2 未决写的结论只能来自当次对账；`WriteLedger.replay` 继续只回答已结算收据。
- I3 已结算（saved/failed/conflict）同 key 逐字回放、不再试。
- I4 只有 `needsSupply` 且无 run、intent 的 context/generation/binding 与记录和路由一致时才探测；在途与 Ready 不探测、不写。
- I5 `unknown` 仍是产品可见的不确定态；不得把读失败说成未发生，也不得把 `unknown` 显示为 Saved。
- I6 `absent` 只能来自完整读取（分页读完 / 确定 `not_found`）；读失败、缺能力、权限拒绝一律 `inconclusive`。
- I7 跨 key 与跨租约仍保守阻挡；解除阻挡的唯一依据是对账的唯一结论，不是时间或换 key。
- I8 被证明的步骤不重发；被证明缺失才重发，且重发前旧槽位已在 claim 事务里被覆盖。

### 命名与边界决策

- 读结论类型放在 `git-provisioning.ts`（它是「Git 读回」的唯一实现处），不新增模块。
- 对外只复用既有 `StartWorkResult` 与 `WritePhase`；不新增 wire 字段、不新增客户端状态。
- 明确不做：`pending` 行的对账（硬崩溃残留会变成永久的「正在处理」，另开 issue）、Ready 缺口的自动收敛（#193）、一般 Planning 写的重启对账（#191 的审计行仍保留）、真实平台 provider 的端到端验证。

## Global Constraints

- 只允许改：`packages/core/src/start-work.ts`、`packages/core/src/git-provisioning.ts`、`tests/integration/start-work-step-recording.test.js`、`tests/integration/start-work-external-intent.test.js`、`tests/integration/start-work-request-binding.test.js`、`tests/integration/local-git-core-provisioning.test.js`、`docs/exec-plan/active/2026-11-21-restart-reconciliation.md`、`docs/README.md`（仅索引）。
- 禁止改：`packages/capabilities/`、`packages/domain/`、`packages/storage/sqlite/`（含 `001_init.sql` 与任何迁移）、`packages/client/`、`packages/ui/`、`packages/controller/`、`providers/`、`docs/adr/`、`docs/architecture/`、`docs/product/`。不新增依赖、不新增 port/表/列/事件、不做数据迁移、不加兼容层或开关。
- 体量：技术改动（代码+测试+夹具，增删之和）≤800 行，目标 ≈380；文档 ≤1300 行，目标 ≈360。仓库硬上限 1000/1500 是外层边界。
- 判别力：只允许「新增断言 / 新增用例」；不删既有用例、不放宽任何既有断言、不改既有用例的失败注入语义。负控用例（读不可用 → 仍 unknown）必须保持最优。
- 行为边界：不放开新 key 接管；不改变 `pending` 行语义；不改变 `unknown`/`saved` 的 `WriteState` 映射；不改 UI 文案与交互。
- 语言：文档正文中文、代码标识符与命令英文；提交信息 `<type>(<scope>): <中文摘要>`，正文说明为什么，末尾 `Closes #191`。
- 验证命令只在 `Validation and Acceptance` 定义一次（V1–V8），批次只引用编号；同一条命令不重复展开。
- 证据带执行上下文：所有验证在检出 `fix/restart-reconciliation` 的工作树 `.worktrees/restart-reconciliation/` 根目录运行；不写本机绝对路径。

## Plan of Work

### Batch 1 · 判别性用例先行（红，只改测试）

**最小闭环**：六条新用例在旧实现上按预期失败、两组新守卫断言在旧实现上本来通过，其余用例全绿；产品代码零改动。

**涉及文件**：四个测试文件（见 `Global Constraints`）。

1. `tests/integration/start-work-step-recording.test.js` 新增「分支采纳」：外部先建同名分支 + 把 `listBranches` 换成 `unavailable`（复用本文件既有的 offline 替身与 `localGitLikeBranch` 计数包装）→ 首答断言 `unknown`；恢复 `listBranches` 并给探针加计数；推进 31_000ms 租约后用**同一 key** 重放，断言：`writeState==='saved'`、`confirmed===true`、`status==='ready'`、`branchExternalId` 等于分支名、`branchHeadCommit` 等于该分支头、`createBranch` 调用计数与首次相同、探针计数 ≥1、`worktrees.length===1`、run 计数只增 1、同 key 的 `mutation_attempt` 最终 `state==='saved'`。
2. 同文件新增「工作树采纳」：`createWorktree` 首次执行完再抛（写已落盘、ack 丢失）→ 首答 `unknown`；恢复后同 key 重放，断言 `saved`/`ready`、`getWorktree` 探针 ≥1、`createWorktree` 调用计数不变、`worktrees.length` 不变、`worktreeExternalId` 等于首次落盘的路径。
3. 同文件新增「缺失重发」：`createWorktree` 首次未落盘即抛 → 首答 `unknown`；同 key 重放，断言探针命中 `not_found` 后 `createWorktree` **恰好再调用 1 次**、最终 `saved`/`ready`、`worktrees.length===1`。
4. 同文件新增「冲突」：首答 `unknown` 后把替身里已落地的工作树分支改成 `work/other`，同 key 重放，断言 `writeState==='conflict'`、错误消息同时点名两侧分支、工作树/分支/run 计数与 context 记录一字不改、零外部写。
5. `tests/integration/start-work-external-intent.test.js`：在既有「accepted … with … lost ack blocks keys and expired leases」（`:67-82`）的循环里**只加断言**：同 key 重放后 `listBranches`/`getWorktree` 的读计数必须增加（证明对账真的跑了），外部写计数仍为 1、`mutation_attempt` 行与 `execution_context` 记录逐字不变；SQLite 分支在关库重开后再用**同一 key** 重放一次并断言同样的事实（今天那次重放用的是新 key）。
6. `tests/integration/start-work-request-binding.test.js` 新增「SQLite 真实重开 + 同 key 收敛」：沿用本文件 `setup('SQLite')`，把 `createBranch`（或 `createWorktree`）首次调用变成一次性 throw（第二次调用走真实实现）→ 首答 `unknown`；`storage.close()` + 重新 `openDatabase`/`createSqliteStorage` + `composeCore`；同 key 重放断言 `saved`/`ready`、探针 ≥1、外部对象各 1 份。既有「永久失败注入 → 仍 unknown」的用例保持原样不改。
7. `tests/integration/local-git-core-provisioning.test.js` 新增「真实磁盘采纳」：沿用本文件的真实临时仓库与 `withHooks`；`createWorktree` 首次真实执行后抛（ack 丢失）→ 首答 `unknown`；同 key 重放断言 `ready`、`git worktree list --porcelain` 仍是主检出 + 1 份登记、`refs/heads/work/*` 仍 1 条、`createWorktree` 的 argv 调用次数不变。

8. 两组守卫负控（在旧实现上本来就绿，用于给 Batch 4 的 M3/M5 提供判别）：(a) **在途同 key 重放不得探测**：用一个握手把 `createWorktree` 挂在半空（同 `start-work-retry-identity`「在途」用例的 barrier 手法），用**同一 key** 再发一次，断言结果仍是 `pending`、探针计数为 0、外部写计数不变；(b) **旧代际同 key 重放不得探测**：首答 `unknown` 后把 `execution_context.provisioningGeneration` 抬高（沿用 `start-work-execution-uniqueness` 的 fixture 写法），同 key 重放断言仍 `unknown`、探针计数为 0、记录一字不改。

**验证**：V1（期望 exit 0）、V2（期望 4 条新增用例失败，失败形态是「期望 saved 实际 unknown」与「探针调用数 0 不等于 ≥1」）、V3、V4（期望既有用例全绿）；第 5、8 项的负控断言在旧实现上本来就绿，这是负控的定义，不是漏红。

**回滚**：`git revert <Batch 1 commit>`（只删测试，产品行为不变）。

### Batch 2 · 只读对账接入（refusal 面闭环）

**最小闭环**：同 key 重放对未决 Git 写真的做一次只读探测；`inconclusive` 与 `conflict` 改变答复且零写入；`adopted`/`absent` 此时仍走旧 replay（这个过渡态在 Batch 2 显式声明，避免后续批次自行猜测）。

**涉及文件**：`packages/core/src/git-provisioning.ts`、`packages/core/src/start-work.ts`。

1. `git-provisioning.ts`：加 `unknownGitIntent(attempt)` 与 `ReconcileOutcome` 四态；实现 `reconcileGitStep(context, route, attempt)`（分支 `branchProbe`；工作树 `getWorktree`，句柄取 `intent.input.path`，缺句柄即 `inconclusive`；分支不一致即 `conflict`；`not_found` 即 `absent`；其余 `inconclusive`，provider 抛错也归 `inconclusive`，消息带读失败 code/message）；所有读经 `guardedDevelopmentReads`。
2. `start-work.ts`：加 `reconcileReplay`（`Design / Spec` 的四条守卫顺序），在 `startWork` 的 `:57` 之后插入调用；`inconclusive` 用 `existingResult(context, contextId, reportFor(WritePhase.Unknown, beginWrite(<自然键>).values, 读失败错误), false)` 返回（保留既有句柄与 Failed 状态、零写入）；`conflict` 用 `existingResult(context, contextId, reportFor(WritePhase.Conflict, {attemptedValue: 持久分支, lastKnownAuthoritative: 读到分支}, 结构化 conflictError), false)`；`adopted`/`absent` 本批返回 `undefined` 继续走旧 replay。
3. 错误文案：`inconclusive` 的消息必须以「对账只读，未重发外部写入」结尾并保留读失败的 code（不压平成 `result_unknown`，理由见 Decision Log D4）。

**验证**：V1；V2（期望第 4 条「冲突」用例转绿，第 1–3 条仍红）；V3（期望既有全绿，第 5 项负控断言通过）。

**回滚**：`git revert <Batch 2 commit>`——回到「完全不探测、逐字 replay」，无数据遗留。

### Batch 3 · 结论驱动续跑（adopted / absent）

**最小闭环**：`adopted` 跳过被证明的步骤并续跑到 Ready；`absent` 重发一次并续跑到 Ready；两者都只发生在同 key 的未决证据行上。

**涉及文件**：两个生产文件（见 `Global Constraints`）。

1. `git-provisioning.ts`：`provisionGit` 增可选 `adopted`；预检输入取被采纳的身份（分支名取 `decided ?? adopted.value`，工作树路径取 `adopted.value`），因此预检看到的就是已经落地的那个目标；`decided ?? adopted` 与请求声明的 `branchName` 不一致时仍结构化拒绝；用 `reportFor(WritePhase.Reconciled, {attemptedValue: value, lastKnownAuthoritative: value}, undefined)` 合成被证明步骤的结果并跳过 `ensureBranch`/`ensureWorktree`；跳过时不得把该写能力记成健康（两个 `observeOperation(..., false, version)` 调用加守卫）；分支头提交从证据透传到 `GitOutcome.branchHeadCommit`。
2. `start-work.ts`：`claimContext` 增 `resuming`（采样 attempt + adopted）；`:383` 的 replay 判定、`:389-394` 的 observe 判定只在「当前行与采样行 `isDeepStrictEqual`」时对同 key 证据行放行；两个上下文写分支在 adopted 是 `createBranch` 时把分支身份写进同一事务（不写工作树句柄）；`adopted` 由 `provision` 透传到 `provisionGit`。
3. 结构要求：任何写入都必须在 claim 事务或 `owned(generation)` 内；对账函数保持纯读。

**验证**：V1；V2（期望 4 条新增全绿）；V3（期望既有全绿）；V4（期望真实磁盘采纳例绿）。

**回滚**：`git revert <Batch 3 commit>`——保留 Batch 2 时探测仍生效、成功路径回到旧 replay。

### Batch 4 · 变异验证、文档收尾与归档

**最小闭环**：八个变异各自只让对应的判别用例变红（输出记录进 `Progress`），计划归档、索引更新、体量与发布面检查通过。

**涉及文件**：本 ExecPlan、`docs/README.md`（仅索引），以及变异期间临时改动的两个生产文件（必须逐个恢复后跑 V1/V2/V3/V4）。

1. M1 删掉 `provisionGit` 的 adopted 分支 → 用例 1 红（`createBranch` 再被调用或结果不是 reconciled）。
2. M2 把 `probe.error` 当 `absent` → 第 5 组负控红（外部写计数 >1）。
3. M3 把「`state==='unknown'`」放宽成「任何 unresolved（含 `pending`）」 → 第 8(a) 组在途负控红（在途同 key 重放开始探测/改写）。
4. M4 把「同 key 证据行」判定改成「任意未决行」 → `start-work-step-recording`「conflict 后列表读取失败…恢复读取也不能用新键盲写」红（证明新 key 边界没被放开）。
5. M5 删掉「`intent.ownerGeneration === record.provisioningGeneration`」守卫 → 第 8(b) 组旧代际负控红。
6. M6 用本次请求的 `namesFor(request)` 重新派生工作树句柄 → 用例 2/6 红（读不到持久句柄或读到错的位置）。
7. M7 删掉工作树分支一致性检查 → 用例 4 红（冲突被误报成 adopted）。
8. M8 让 adopted 也照常调用 `ensureBranch`/`ensureWorktree` → 用例 1/2 红（外部写计数增加）。
9. 若某个变异跑不出红：不得保留无法判别的守卫，也不得用「看起来对」代替证据——在 Batch 1 补一条针对该守卫的负控（只加断言），再重跑该变异；补不出判别用例的守卫按最小化原则删除并记入 Decision Log。
10. 归档：`docs/exec-plan/active/2026-11-21-restart-reconciliation.md` → `docs/exec-plan/completed/`（文件名不变），`docs/README.md` 索引行从 Active 移到 Completed，回填 `Outcomes & Retrospective` 与 `Progress`。

**验证**：V6、V7、V8（期望分别达标 / 「机械扫描通过」/ 无输出）；V1–V5 在恢复所有变异后再跑一遍全绿。

**回滚**：文档与归档单独一个 commit，可整体 revert；变异只存在于工作区，不提交。

## Validation and Acceptance

以下命令是唯一来源，批次只引用编号；均在工作树 `.worktrees/restart-reconciliation/` 根目录运行，且不要同时跑其他重负载命令（`start-work-step-recording.test.js` 里「游标永不结束」用例有 5s 预算，本机在并发负载下观察到过超时，见 `Surprises & Discoveries`）。

- **V1** `pnpm run typecheck` → 期望 exit 0、无输出。
- **V2** `pnpm test:file tests/integration/start-work-step-recording.test.js` → 期望 `fail 0`；`tests` 由基线 11 增至 15（新增 4 条），且 4 条新增用例出现在 pass 列表。
- **V3** `pnpm test:file tests/integration/start-work-external-intent.test.js tests/integration/start-work-request-binding.test.js tests/integration/start-work-owner-fencing.test.js tests/integration/start-work-retry-identity.test.js tests/integration/start-work-execution-uniqueness.test.js tests/e2e/start-work-recovery.test.js` → 期望 `fail 0`。2026-11-21 基线实测：V3 六个文件与 V4 一个文件同批运行共 186 pass / 0 fail / 0 cancelled（两批未分开计数，分开的数字在 Batch 1 的验证记录里补记）。
- **V4** `pnpm test:file tests/integration/local-git-core-provisioning.test.js` → 期望 `fail 0`，且真实磁盘采纳用例出现。
- **V5** `pnpm run boundaries` → 期望 `tests 10` / `pass 10` / `fail 0`（2026-11-21 基线实测）。
- **V6** `node scripts/rule-checks.mjs size main` → 期望首行打印 base/head SHA 后给出 `代码：≤800 / 1000 行` 与 `文档：≤1300 / 1500 行`。
- **V7** `node scripts/rule-checks.mjs disclosure main` → 期望输出含「机械扫描通过」。
- **V8** `git diff --check main...HEAD` → 期望无输出、exit 0。

**验收判据**（全部满足才算完成）：

1. 判别性：Batch 1 第 1–4、6、7 组用例在 Batch 1 红、Batch 3 后全绿；第 5、8 组负控在旧实现即绿并在新实现保持；八个变异全部按预期变红并逐条记录输出。
2. 产品面：`unknown` 之后用同一份表单再提交（同 key），provider 恢复可读时收敛到 Ready 且分支/工作树/run 各 1 份；仍不可读时保持 `unknown`、零外部写；工作树分支不一致时得到 `conflict` 且两侧值可见。
3. 守卫面：V3 全绿——读不可用仍 unknown 且外部写只 1 次、在途不被接管、Ready 不触发外部写、已结算同 key 逐字回放、新 key 仍被挡。
4. 边界：`git diff --stat` 只含 `Global Constraints` 列出的文件；无 schema/契约/UI 变化；V6 达标、V7 清洁、V8 干净。
5. 不做未验证声明：真实平台 provider 与 Host 端到端不在本 PR 证据内，PR 描述必须写明（本 PR 的证据面是 fake + local-git + 真实 SQLite 重开）。

## Progress

- [x] 2026-11-21：事实核对与基线取证（`main@f74a3b8b`）：V1 exit 0；V5 10/10；V2 11/11；V3 与 V4 的文件同批 186/186（其中 V2 文件单独跑过 3 次：1.8s / 2.7s 通过，并发负载下 5.0s 超时）。
- [x] 2026-11-21：一次性只读探针确认红态——同 key 重放后 `listBranches`/`getWorktree` 调用数 0、外部写 0、结果 `unknown` + `status=failed`（分支采纳、工作树采纳、缺失重发三种场景都复现）。
- [x] 2026-11-21：Batch 1 · 判别性用例先行（红）。V2 `tests 17 / pass 13 / fail 4`（新增 4 条正控分别卡在 `unknown !== saved`×3 与 `unknown !== conflict`；两条负控在旧实现即绿）；V3 前半 `external-intent + request-binding` `73 tests / 60 pass / 13 fail`（12 条 Git 创建步用例卡在「读计数没有增加」、1 条 SQLite 重开收敛用例卡在 `unknown !== saved`）；V4 `18 tests / 17 pass / 1 fail`（真实磁盘采纳卡在 `unknown !== saved`）。
- [x] 2026-11-21：Batch 2 · 只读对账接入（inconclusive/conflict）。GREEN 证据：V2 `tests 17 / pass 14 / fail 3`（冲突用例转绿，三条 adopted/absent 用例仍红——本批显式过渡态）；V3 前半 `external-intent + request-binding` `73 tests / 72 pass / 1 fail`（12 条 Git 创建步的读计数断言转绿，仅剩 SQLite 重开收敛用例等 Batch 3）；V1 exit 0。inconclusive 消息以「对账只读，未重发外部写入」结尾并保留读失败 code（D4）；conflict 两侧值都进入报告。
- [ ] Batch 3 · 结论驱动续跑（adopted/absent）。
- [ ] Batch 4 · 变异验证、文档收尾与归档。
- [ ] 人类评审与 PR ready（由人类伙伴决定合并）。

## Surprises & Discoveries

1. **「丢 ack 就一定对过账」不成立**：`ensureBranch`/`ensureWorktree` 只在 provider 返回 `ambiguous_result`/`conflict` 时读回；**throw 路径只 `markUnknown`**（`packages/core/src/git-provisioning.ts:234`、`:268`）。所以持久化的 `unknown` 至少有两种来源，文案不能默认「对账已跑过」。证据：上述文件与行，加上探针对 `throw` 场景的复现（探针读计数 0）。
2. **新 key 阻挡有契约级依据**，不只是测试习惯：`packages/capabilities/src/storage.ts:396-398`「未决槽位由 core 跨 key 阻挡」、`packages/storage/sqlite/migrations/001_init.sql:338`「未知步骤跨 key/lease 保守阻挡，非自动恢复日志」、`docs/architecture/gate-e1-ruling.md:242` 的人类采纳说明。这条把「restart 是否包含新 key」的裁定从偏好问题变成契约问题。
3. **产品的恢复动作就是同 key**：`packages/client/src/start-work.ts:52,59` 在 `uncertain` 时复用 key，`packages/ui/src/start-work-section.ts:27` 冻结表单但允许再次提交，client 只在插件加载时组合一次（`apps/harness-plugin/src/client.ts:72`）。因此同 key 重放不是边缘路径。
4. **一条既有用例在修复后会失去判别力**：`tests/integration/start-work-request-binding.test.js:139-149` 的失败注入是永久的，修复后重放会真的再探测/再试一次，但最终仍是 `unknown`、外部对象计数不变，断言仍绿。因此必须新补「探针确实被调用」的断言（Batch 1 第 5/6 项），否则「没跑对账」与「跑了但读不到」无法区分。
5. **基线存在一个 5s 预算的时序敏感用例**：`tests/integration/start-work-step-recording.test.js:336`「游标永不结束」在并发负载下观察到 `test timed out after 5000ms`（同批 8 文件 5125ms、另一个并发运行 5015ms），空闲单跑 1832ms / 2651ms 通过。它是 1000 页分页上限用例，与本改动无关；**不改测试、不改预算**，验证时避免并发即可，且必须在 Progress 记录每次实际观察值。
6. **`getWorktree` 的句柄在两种 provider 上都可重建**：local-git 的 `getWorktree` 按 externalId 解析路径再读 `worktree list`（`packages/providers/development-local-git/src/provider.ts:274-292,318-330`），fake 的工作树 externalId 就是 `path ?? worktreeKey`（`packages/providers/fake/src/development.ts:202-243`），而两者的 `preflightWorktree` 都会把规范化路径写进持久 intent，所以「用持久 intent 的 path 读回」在两种实现上都成立。没有 preflight 的 provider 没有持久句柄，本方案按 `inconclusive` 处理，不猜。

## Decision Log

- **D1（2026-11-21）restart 范围 = 同 idempotency key 重放；新 key 接管不在本 PR。** 依据：端口契约（`capabilities/storage.ts:396-398`）、DDL 注释（`001_init.sql:338`）、R8 偏离说明（`gate-e1-ruling.md:242`）与五条既有用例；跨 key 需要「取代」语义与 authority 决策。跟进：另开 issue（标题建议 `fix(core): allow a later idempotency key to take over a reconciled start-work attempt`），在 PR 描述里 `Refs` 它。
- **D2（2026-11-21）关闭点 = `start-work.ts` 的命令 resume 路径；对账只读，写入全在既有认领/供应事务内。** 否决 storage / 投影层 / 查询路径 / 启动扫描 / claim 前 CAS 结算，理由见 `Design / Spec` 的「被放弃的方案」。
- **D3（2026-11-21）不新增任何持久形状。** 四态结论只存在于一次调用的返回值；`mutation_attempt.state` 仍是唯一结果轴。
- **D4（2026-11-21）`inconclusive` 保留读失败自身的错误码（`unavailable`/`permission_denied`/`not_supported`/`result_unknown`），`writeState` 仍是 `unknown`。** 理由：与首遇路径（`start-work-step-recording.test.js:326` 已把「探测失败原因」钉成 `unavailable`）一致，且 client 的 `permission 层拒绝` 恢复文案依赖真实 code；压平成 `result_unknown` 会丢掉「为什么读不出来」这个可操作信息。消息必须含「对账只读，未重发外部写入」。
- **D5（2026-11-21）`absent` 在同一个调用里重发那一步（不先落 `failed` 等用户再按一次）。** 依据：ADR-0004 第 2 条「找到就直接采纳、找不到才重试」；用户的再次提交本身就是显式重试；认领事务先覆盖旧槽位再调用 provider，满足 R8。被否决的替代（先 CAS 结算 `failed`，让用户用新 key 重试）需要 claim 之外的第二个写者，且把可恢复状态呈现成终态失败。
- **D6（2026-11-21）只对 `state='unknown'` 的行对账，不动 `pending` 行。** `pending`（硬崩溃残留）会长期停在「正在处理」；把它纳入需要同时决定「租约过期 + 时间证据」的语义，与 owner-fencing 的「时间不是证据」冲突，另开 issue（Decision Log D6 的跟进项写进 PR 风险段）。
- **D7（2026-11-21）工作树对账只用持久 `intent.input.path`；没有句柄就 `inconclusive`。** 不用本次请求重新派生，避免读到另一个目标；不新增「从请求推导句柄」的便利路径。
- **D8（2026-11-21）采纳按自然键，不额外校验分支 head 与 `intent.input.fromRef` 是否一致。** 与既有 conflict/ambiguous 采纳同判据；额外校验会改变 `#160` 的冲突复用语义，属独立决策。
- **D9（2026-11-21）不同的 `branchName` 声明仍结构化拒绝。** 与 `#183` 的「重放不得改变已决定的分支身份」一致；adopted 的分支名视同已决定身份。
- **D10（2026-11-21）跳过被证明的写步骤时不得记 capability 健康。** `observeOperation(..., false, version)` 只表示「刚刚成功写过」，跳过时记健康会污染 runtimeAccess 的事实。
- **D11（2026-11-21）不改 `ADR-0004`、`gate-e1-ruling`、audit 文档。** 它们是人类采纳的决策/证据记录；本计划只在 Decision Log 记录解释，PR 描述说明「与 ADR-0004 第 2 条一致，不修改决策记录」。
- **D12（2026-11-21）验证命令 V1–V8 唯一来源在 `Validation and Acceptance`。** 批次只引用编号，避免同一命令多处副本在执行期间不同步。
- **D13（2026-11-21）Lead 批准的 Q1–Q5 执行裁定（本轮不重新讨论）。** Q1 restart 范围 = 同 key 重放，新 key 接管旧未决槽位不在本 PR（见 `Outcomes & Retrospective` 的 follow-up）；Q2 对账读被 capability 门拒绝时保留读失败自身 code、`writeState=unknown`，消息注明「对账只读，未重发外部写入」；Q3 不改 ADR-0004 / R8 偏离文案，解释只记在本 Decision Log（与 D11 一致）；Q4 不把硬崩溃 `pending` 残留纳入对账（与 D6 一致）；Q5 采纳不额外校验分支 head 与 `intent.input.fromRef` 一致（与 D8 一致），该风险写入 `Outcomes & Retrospective`。
- **D14（2026-11-21）对账结论的答复面用 `existingResult(record, report, verify=false)`。** 触发对账的前提是上下文可续跑（终态或租约过期）且没有 run，因此记录不可能是「完整 Ready」；仍显式跳过 Ready 验证读，让 conflict / inconclusive 的答复与零写入是同一个事实。被采纳的分支身份在认领事务里写回（`branchExternalId`），**不**在那里写工作树句柄：句柄继续只由步骤回填产生，谱系锚点纪律不变。

## Idempotence and Recovery

- **对账本身幂等**：`reconcileGitStep` 是纯读（只调用 `listBranches`/`getWorktree` 与 `runtimeAccess` 记账），可任意重跑，不产生外部或本地写入。
- **批次可独立回滚**：每个 Batch 一个 commit；`git revert <commit>` 即可回到上一个已知良好状态。Batch 1（测试）与 Batch 2/3（代码）互不依赖回滚顺序；Batch 4 只有文档与归档，可整体 revert。
- **崩溃窗口**：认领事务覆盖同 key 行会丢掉 intent。若在「认领之后、被采纳步骤的回填之前」崩溃，下一次重启会看到 `state='pending'` 且无 intent（不在本 PR 的对账范围），退化为按既有 `safeResume`/冲突复用路径重跑；分支名与工作树路径都是幂等身份，最坏得到结构化失败，不会产生第二份外部对象。该窗口与今天「步骤之间崩溃」同类，必须写进 PR 风险段。
- **无数据迁移**：不新增列/表，旧库直接可用；已存在的 `unknown` 行在本版本上线后即可被同 key 重放对账，不需要预先清洗或回填。
- **回到已知良好状态**：`git checkout -- <file>` 恢复变异、`git revert` 回滚批次、重跑 V1–V5；文档回滚不影响代码行为。
- **重复执行安全**：Batch 2/3 的代码改动重复应用等价（幂等补丁）；测试用例可重复运行（无真实网络/时钟依赖，租约用可控时钟推进）。

## Interfaces and Dependencies

- **依赖的既有接口（不新增）**：`DevelopmentProvider.listBranches`/`getWorktree`（`packages/capabilities/src/development-provider.ts`）；`guardedDevelopmentReads`、`branchProbe`、`ensureBranch`、`ensureWorktree`、`provisionGit`（`packages/core/src/git-provisioning.ts`）；`selectDevelopment`、`START_WORK_ROUTE`（`packages/core/src/development-route.ts`）；`needsSupply`、`claimContext`、`existingResult`、`reportFor`、`WritePhase`（`packages/core/src/{start-work,write-machine}.ts`）；`MutationAttemptRecord`/`StartWorkExternalIntent`（`packages/capabilities/src/storage.ts`）。
- **不新增**：依赖、devDependency、port、表、列、事件、wire 字段、UI 状态、配置项、环境变量。
- **工具与命令**：Node.js + pnpm 仓库脚本（`pnpm run typecheck`、`pnpm test:file`、`pnpm run boundaries`）；`node scripts/rule-checks.mjs`（两个子命令）；`git`。PR 阶段另需 `gh`（PR 描述、issue 关联回读）与 `node scripts/policy-check.mjs issue 191`（标签/area 机械核对），它们不进入代码验证。
- **命名契约**：分支 `fix/restart-reconciliation`；提交 `fix(core): …`；ExecPlan 文件名固定为 `2026-11-21-restart-reconciliation.md`；测试命名沿用本仓库中文断言习惯（每个断言都带一条中文理由）。
- **前置条件**：在 `main@f74a3b8b` 上 `pnpm install --frozen-lockfile` 已就绪；验证期间不要并发跑其他重负载任务（见 `Surprises & Discoveries` 第 5 条）。

## Outcomes & Retrospective

本计划创建于实现之前，尚无实现结果。全部批次完成后必须在此记录：实际修复的缺口形状（哪些场景收敛、哪些仍 unknown）、与计划的偏差（含被放弃方案的最终取舍）、七个变异的实际输出位置，以及遗留项。计划当前已确认的遗留：

1. 跨 key 接管仍未放开（D1），follow-up issue 待开；
2. `pending` 硬崩溃残留仍会停在「正在处理」（D6），需独立 issue；
3. 采纳只按自然键、不校验 head/起点（D8），在出现「同名可被他人复用的 provider」时需要复核；
4. Ready 缺口与自动对账仍归 #193/#421，本 PR 不改变 `existingResult` 的缺口文案；
5. 真实平台 provider 与 Host 端到端不在本 PR 证据面内。

## Bottom Change Note

- 2026-11-21（Asia/Singapore）：创建。来源是对两份独立设计提案（variant a / variant b）的 facts 复核与裁定：采纳「同 key 重放前置只读对账 + 结论驱动续跑」，否决「新 key 接管」「`resolution` 列」「启动扫描」「只修答复」；修正了 variant a 的「丢 ack 后必已对账」与 variant b 的引用错位，并把「restart 是否含新 key」的裁定依据落到端口契约、DDL 注释与 R8 说明上。
