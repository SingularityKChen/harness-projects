# restart-reconciliation ExecPlan

> 状态：Completed（2026-11-22 评审修复轮收敛；修复轮 1–4 已实施并经评审方四轮独立复评，最终发布文案已对齐；含独立对抗验证 F1 残余修复轮 2、读侧观察面门修复轮 3 与写事务内锚点复核修复轮 4；`delivery-facts.ts` 范围扩展记录见 D24，评审追加段来源与快照见 D25/Surprises 20–22）
> 创建：2026-11-21
> 范围：issue #191 —— Start Work 的同 key 重放在报告未决 Git 外部写之前，先重跑一次只读对账，用对账结论决定「采纳 / 重发 / 冲突 / 未知」；不新增列、表、port、兼容层
> 上游依据：issue #191 正文与验收（`kind:fix area:core`，Milestone M2.1）；`docs/adr/ADR-0004-unknown-external-create-is-product-visible.md`；`docs/architecture/gate-e1-ruling.md` §4 R8 与 §9 的偏离说明；`docs/product/vertical-path.md` §2
> 执行上下文：分支 `fix/restart-reconciliation`，隔离工作树 `.worktrees/restart-reconciliation/`；初始基线 `main@f74a3b8b`，2026-11-22 评审修复轮前已 rebase 到 `main@4907adaa`（当前 head 以 `git rev-parse HEAD` 回读为准，不在正文抄写易失值）

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
2. **由新 idempotency key 接管旧未决槽位，并「取代」旧行**（设计 b 的跨 key 分支）：与端口契约「未决槽位由 core 跨 key 阻挡」（`packages/capabilities/src/storage.ts:396-398`）、DDL 注释「未知步骤跨 key/lease 保守阻挡，非自动恢复日志」（`packages/storage/sqlite/migrations/001_init.sql:338`）与 R8 偏离说明「未决槽位不因换 key 或租约过期解除」（`docs/architecture/gate-e1-ruling.md:242`）直接冲突；并且证成的写发生在旧行、操作交给新请求时，旧行无论记 `saved` 还是 `failed` 都会把获知方式塞回结果轴，还必须新增「谁能接管别人的未决操作」的 authority 规则。留作 follow-up 建议（本 PR 未创建 issue，见 Decision Log D1/D19）。
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
- 明确不做：`pending` 行的对账（硬崩溃残留会变成永久的「正在处理」，需独立 issue，本 PR 未创建）、Ready 缺口的自动收敛（#193）、一般 Planning 写的重启对账（#191 的审计行仍保留）、真实平台 provider 的端到端验证。

## Global Constraints

- 只允许改：`packages/core/src/start-work.ts`、`packages/core/src/git-provisioning.ts`、`packages/core/src/delivery-facts.ts`（修复轮 3 读侧观察面门：Failed 句柄不得单独产生交付投影；同能力闭环内的最小范围扩展，依据与 blast radius 见 D24）、`tests/integration/start-work-step-recording.test.js`、`tests/integration/start-work-external-intent.test.js`、`tests/integration/start-work-request-binding.test.js`、`tests/integration/local-git-core-provisioning.test.js`、本计划自身（修复轮 4 期间位于 `docs/exec-plan/active/2026-11-21-restart-reconciliation.md`，收尾归档回 `docs/exec-plan/completed/2026-11-21-restart-reconciliation.md`）、`docs/README.md`（仅索引）。
- 禁止改：`packages/capabilities/`、`packages/domain/`、`packages/storage/sqlite/`（含 `001_init.sql` 与任何迁移）、`packages/client/`、`packages/ui/`、`packages/controller/`、`providers/`、`docs/adr/`、`docs/architecture/`、`docs/product/`。不新增依赖、不新增 port/表/列/事件、不做数据迁移、不加兼容层或开关。
- 体量：技术改动（代码+测试+夹具，增删之和）≤800 行，目标 ≈380；文档 ≤1300 行，目标 ≈360。仓库硬上限 1000/1500 是外层边界。修复轮 4 终验代码 796/1000（用户预算 800，余量 4：本轮判别回归只增 7 行，其余以压缩既有新增代码的重复/冗长注释与断言腾出空间）：后续任何生产代码增量都须先取得人类对预算的确认或压缩既有改动，不得静默越过用户预算。
- 判别力：只允许「新增断言 / 新增用例」；不删既有用例、不放宽任何既有断言、不改既有用例的失败注入语义。负控用例（读不可用 → 仍 unknown）必须保持最优。
- 行为边界：不放开新 key 接管；不改变 `pending` 行语义；不改变 `unknown`/`saved` 的 `WriteState` 映射；不改 UI 文案与交互。
- 语言：文档正文中文、代码标识符与命令英文；提交信息 `<type>(<scope>): <中文摘要>`，正文说明为什么，末尾按 D23 的交付口径用 `Refs #191`（PR body 同样用 `Refs`，不宣告关闭）。
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

1. M1 删掉认领事务里被采纳分支的身份写回（原计划的 `provisionGit` adopted 分支块不可判别，按 D15 删除后改到这里）→ 用例 1 红（`createBranch` 再被调用）。
2. M2 把 `probe.error` 当 `absent` → 第 5 组负控红（外部写计数 >1）。
3. M3 同时放宽「未决状态」与 `needsSupply` 两处守卫（单独放宽任一处都不会被杀死，见 Progress）→ 第 8(a) 组在途负控红（在途同 key 重放开始探测/改写）。
4. M4 把「同 key 证据行」判定改成「任意未决行」 → `start-work-step-recording`「conflict 后列表读取失败…恢复读取也不能用新键盲写」红（证明新 key 边界没被放开）。
5. M5 删掉「`intent.ownerGeneration === record.provisioningGeneration`」守卫 → 第 8(b) 组旧代际负控红。
6. M6 用本次请求的 `namesFor(request)` 重新派生工作树句柄 → 用例 2/6 红（读不到持久句柄或读到错的位置）。
7. M7 删掉工作树分支一致性检查 → 用例 4 红（冲突被误报成 adopted）。
8. M8 让 adopted 也照常调用 `ensureBranch`/`ensureWorktree` → 用例 1/2 红（外部写计数增加）。
9. 若某个变异跑不出红：不得保留无法判别的守卫，也不得用「看起来对」代替证据——在 Batch 1 补一条针对该守卫的负控（只加断言），再重跑该变异；补不出判别用例的守卫按最小化原则删除并记入 Decision Log。
10. 归档（已完成）：计划文件移入 `docs/exec-plan/completed/2026-11-21-restart-reconciliation.md`（文件名不变），`docs/README.md` 索引行从 Active 移到 Completed，回填 `Outcomes & Retrospective` 与 `Progress`。

**验证**：V6、V7、V8（期望分别达标 / 「机械扫描通过」/ 无输出）；V1–V5 在恢复所有变异后再跑一遍全绿。

**回滚**：文档与归档单独一个 commit，可整体 revert；变异只存在于工作区，不提交。

### Batch 5 · 评审修复轮（2026-11-22；修复轮 1–4 已实施并经评审方四轮独立复评，已归档）

**状态：5.1–5.8 已实施并经评审方四轮独立复评（第四轮锁定生产修复 head 为候选技术通过；最终远端批准仍须由 Lead/人类锁定发布 head 与 checks）；第三轮复评的读侧提交时序 P2 与注释 P3 已由修复轮 4 关闭，计划已归档回 Completed。**

**最小闭环**：关闭 `docs/review/pr-673-mmp-review.md` 的 F1（采纳后 claim 覆盖旧槽位时必须原子耐久保存精确恢复身份；
absent 复用已对账精确输入）、F2（采样后的写门拒绝不得留下 failed 根 + unknown 旧槽，保留可恢复 unknown）、
F3（#191 关闭范围与裁定来源诚实记录，不借人类 R1 或已关闭 #193/#421 承接余项）、F4（PR 描述回填改为历史记录，
过去时 + 快照日期）。不得静默降低安全承诺；边界不可实现时给出替代与人类裁决点。
**涉及文件**：见 `Global Constraints` 的允许集（本轮实际改动三个生产文件（含修复轮 3 增列的 `delivery-facts.ts`）、四个测试文件、本计划与 `docs/README.md` 索引）；
`docs/review/pr-673-mmp-review.md` 原样保留，只随 PR 提交，不改其内容（追加段来源与快照见 D25、Surprises 20–22）。
**背景**：评审 head `120423b1`；复核分支 `d0e77b37`；协调者 rebase 到 `main@4907adaa` 后本轮从 `68dad565` 开始
（本 PR 文件内容不变，修复前复测 494/432、19/174/19 的红态与既有 18/170/18 基线一致）。最终设计裁定见运行态
`.superpowers/review-fix-20261122/specs/673.md`（不入库）；本批次记录实施事实。

**5.1 判别性回归先行（红，只改测试）**
四组用例，全部用真实状态迁移取证，红态是行为断言而不是文案/缺文件错误：
1. T1 `start-work-step-recording.test.js`（fake）：`preflightWorktree` 先答 `.worktrees/original-target`，首次
   `createWorktree` 写前抛错 → `unknown`；把默认目标改为 `.worktrees/new-default` 后同 key 重放，断言重发恰好一次
   且输入仍是持久 `intent.input.path`。修复前红：`writes[1].path='.worktrees/new-default'`。
2. T2 `start-work-request-binding.test.js`（fake + 真实 SQLite）：首次 `createWorktree` 落盘后抛错 → `unknown`；
   同 key 重放时用 Proxy 计 `tx.putExecutionContext`，在**提交后**第 1 次（认领）/ 第 2 次（分支回填）抛错模拟崩溃；
   关库重开、默认目标改 `new-default`、推进时钟后同 key 重放，断言 saved/ready、库内句柄仍是 original、只 1 份工作树、
   `createWorktree` 共 2 次（第二次 conflict 复用）。修复前红：崩溃后 `worktreeExternalId=undefined`。
3. T3 `start-work-request-binding.test.js`（真实 SQLite，`for method of ['createBranch','createWorktree']`）：
   首次写前抛错 → `unknown`；`policy {DevelopmentWorktreeCreate: ReadOnly}` 下同 key 重放，断言答复
   `unknown + permission_denied`、attempt 行与 context 记录逐字不变、外部对象计数不变、恢复前新 key 仍 `unknown`；
   恢复策略 + 关库重开后同 key saved/ready、新 key conflict。修复前红：两 operation 均答 `failed` 并改写根/代际/未决行。
4. T4 `local-git-core-provisioning.test.js`（真实临时仓库 + 真实 SQLite）：`createWorktree` 落盘后抛错 → `unknown`；
   认领提交后抛错；关库重开、默认根改 `new-default`、推进时钟后同 key 重放，断言 saved/ready、
   `worktreePaths === [repositoryPath, original]`、`refs/heads/work/*` 1 条、`createCalls===2`（同路径 conflict 复用）。
   修复前红：崩溃后 `worktreeExternalId=undefined`。
**注入陷阱**：崩溃注入不能按 `storage.transaction` 序号——事务序列是 `claim#1`、`checkOwner#2`、读门 ticket#3、
`recordStep#4/#5`、`settle#6`，第 3 个是读门，抛错会被 `guardedDevelopmentReads` 吞成 `unavailable`；必须在事务
**提交后**按 `putExecutionContext` 计数抛错（事务体内抛错会整笔回滚，模拟不出目标窗口）。
**验证（红态实测，修复前 @ `68dad565`）**：V2 `19 tests / 18 pass / 1 fail`；request-binding
`25 tests / 21 pass / 4 fail`（T2 两窗口 + T3 两 operation）；V4 `19 tests / 18 pass / 1 fail`。
**回滚**：`git revert <test commit>`（只删测试，产品行为不变）。

**5.2 生产修复 S1–S4（绿）**
1. `git-provisioning.ts`：`stepRecord` 增末参 `worktreeExternalId` 并写入结果；分支步回填传
   `recorded?.worktreeExternalId`（F1b：分支回填不得清掉认领刚写下的句柄）；`provisionGit` 增可选 `resendPath`，
   `durablePath = recorded?.worktreeExternalId ?? resendPath` 决定工作树输入，absent 的精确输入只用于本次重发、
   不写记录。
2. `start-work.ts`：`Resuming` 增 `resendPath` 与 `key`（`gitIntentKey(intent)`）；`reconcileReplay` 计算两者
   （absent 只对 `createWorktree` 带回 `intent.input.path`）；`Claim` 增 `unsettled` 变体并给 `new|resume` 增
   `resendPath`；`claimContext` 在 route 计算之后、跨 key 结算之前对「已采样未决行 + 写门拒绝」返回
   `unsettled`（此前语句全是读，返回即整笔零写入）；终态接管条件写 `worktreeExternalId: adoptedWorktree`，
   过期 Provisioning 分支只透传 `resendPath`（不写被采纳句柄：unknown 行恒伴随 Failed 根，归属终态分支）；
   `startWork` 对 `unsettled` 用 `existingResult(..., reportFor(Unknown, beginWrite(key).values, 写门错误), false)`
   作答，错误码保持写门自身 code 并注明「只读对账已确认未决步骤、写能力暂不可用、未发起外部写入、恢复后同 key 重试」；
   `provision` 增末参并透传到 `provisionGit`。
3. **不做**：不改 write-machine / capabilities / domain / storage / providers / schema / wire；不新增字段、端口、依赖、
   兼容层或开关；不放开跨 key 与 pending 边界；不改 `saveContext` 的既有纪律（工作树句柄只由 ack / 步骤回填产生）。
**验证（绿态实测）**：V1 exit 0；V2 `19/19`；V3 `174/174`；V4 `19/19`；V5 `10/10`；既有断言零放宽。
**回滚**：`git revert <fix commit>`——返回「unknown 只翻报告」旧行为，无 schema/迁移；回滚会重新打开 F1/F2 窗口，
只作为「否决该修复」的一部分，不作运维降级。

**5.3 变异验证 M10–M13**
逐个在临时工作区改生产代码 → 跑对应套件记录 RED → 用备份文件字节还原（sha1 校验一致）→ 跑对应套件确认 GREEN：

| 变异 | 改动 | 实测只让谁红 |
|---|---|---|
| M10 | 删认领事务的 `worktreeExternalId` 写回 | T2 两个窗口 + T4 + T5×2 + T6 + T7（同一认领守卫；这些用例都断言认领持久化；修复轮 3 实测 7 条），其余绿 |
| M11 | 删分支回填携带 `recorded?.worktreeExternalId` | 仅 T2 分支回填窗口红；认领窗口与 T4 绿 |
| M12 | 把 `resendPath` 恒置 `undefined` | 仅 T1 红 |
| M13 | 删 `unsettled` 提前返回 | 仅 T3 两个 operation 红 |

**5.4 F3/F4 文档订正（只改本计划）**
1. 状态头改为 `Completed（2026-11-22 评审修复轮收敛）`；执行上下文补 rebase 事实。
2. 原误编号的「D18 评审修复轮」改为 **D20**（actor = 人类交办 + 评审；范围 = review F1–F4；未覆盖 = pending / 跨 key /
   一般 Planning；#191 余项无 owner；#193/#421 已于 2026-11-02 CLOSED 且属执行域，不承接）。
3. AC 表关闭条件改为「已验证子集：同 key / `unknown` / Git `createBranch`|`createWorktree`；跨 key 保守阻挡有端口
   契约与 DDL 依据，范围选择是 AI 协调者工程裁定，不是人类 R1 裁定」，行尾追加 `Superseded by D20–D22（2026-11-22）`。
4. D13 前缀改为「AI 协调者在人类授权（调研后自主判断、存疑才询问）范围内的 Q1–Q5 工程裁定（未逐项获得人类接受；
   不是人类 R1 裁定）」。
5. `Idempotence and Recovery` 的崩溃窗口条目保留原文并追加 `Superseded by D21（2026-11-22）`：原文「不会产生第二份
   外部对象」的绝对断言已被反例证伪。
6. 新增 **D21**（F1）与 **D22**（F2）；D19 追加 `Superseded by D20`；AC5 与「交付面遗留」按「历史时点 + 2026-11-22
   回读快照」改为过去时。
**验证**：V7 机械扫描通过；`git diff --check` 无输出；归档前后链接各回读一次（active/ → completed/）。

**5.5 归档、索引与交付面回读**
1. 计划移回 `docs/exec-plan/completed/2026-11-21-restart-reconciliation.md`（文件名不变），`docs/README.md` 索引行
   由 Active 移回 Completed（描述保留「2026-11-22 评审修复轮」）。
2. V6 `node scripts/rule-checks.mjs size main`：代码 754 / 1000（用户预算 800）、文档 533 / 1500（用户预算 1300）；V7 通过；V8 无输出。
3. 交付面（规划所有者 / 人类执行，本轮不做）：PR body 的 ExecPlan 链接改指归档路径、Batch 引用补 1–5、补最终 head 与
   V1–V8 实测；`Refs #191`（D23）与已验证子集的关系按 X1 裁决处理；push 后回读 head/base/checks/issue/threads。
**5.6 独立对抗验证 F1 残余修复（round-2，2026-11-22）**
独立对抗验证（运行态 `verify/673.md`）判定 FAIL：F1 的普通失败路径仍会丢掉已采纳工作树 A 的最后耐久引用——同 key unknown → 对账 adopted A → 认领事务已耐久 A 并消费旧 intent → 后续 preflight 临时 `unavailable` 或 `listBranches` 临时 `permission_denied` → `gitFailure` 写死 `worktreeExternalId: undefined` → settle/saveContext 清掉 A → 根 failed、无 intent、无 A 引用。恢复能力 + SQLite 关库重开 + 新 key + 默认 B 后 Fake 产生 A/B 两份，真实 Git 则永久 `failed/invalid_input`、磁盘 A 成为无主对象。
1. T5 `start-work-request-binding.test.js`（fake + 真实 SQLite，两条）：adopted 后 preflight 临时 unavailable / listBranches 临时 permission_denied → 答复 failed 且保留读失败 code；断言 context 仍耐久 A、attempt 如实落 failed、同 key 逐字回放；恢复能力 + 关库重开 + 默认目标 B + 新 key → saved/ready 且只存在 A、无 B。修复前红：`worktreeExternalId=undefined`（两条）。
2. T6 `local-git-core-provisioning.test.js`（真实临时仓库 + 真实 SQLite）：adopted 后 preflight 临时 unavailable → 同上前半；恢复 + 重开 + 默认根 B + 新 key → saved/ready、createWorktree 共 2 次（conflict 复用）、磁盘 `[repositoryPath, A]`。修复前红：`worktreeExternalId=undefined`。
3. 生产修复：`git-provisioning.ts` 的 `gitFailure` 增末参，所有 recorded 已知的失败点（预检、分支 prior probe、分支名矛盾、分支步、工作树步）都携带 `recorded?.worktreeExternalId`；`start-work.ts` 的 settle 在失败路径不写 `has_worktree` 边（关系仍只由成功结算产生）。不伪造 Ready/Saved、不改 owner 语义、不吞失败码；同 key 已结算失败逐字回放（I3），恢复动作是换新 key（#184）。
**验证（round-2 实测）**：V1 exit 0；V2 `19/19`；V3 `176/176`（新增 T5×2）；V4 `20/20`（新增 T6）；V5 `10/10`；M14（忽略失败携带）只让 T5×2 + T6 + T7 变红（修复轮 3 实测 4 条），还原后全绿；V6/V7/V8 见 `Validation and Acceptance`。验证者运行态探针的期望字段（`slotAfterFailure=['unknown','unknown']`、同 key saved）与本轮「已结算同 key 逐字回放」语义冲突，未按该期望实现；`handleAfterFailure=A`、`worktrees=[A]`、真实磁盘 `[repo, A]` 三项与其期望一致（见 Surprises 17）。
**回滚**：revert round-2 的三笔提交（test / fix / docs），无 schema/迁移。

**5.7 读侧观察面门（round-3，2026-11-22）**
复验轮 2 判 PASS WITH FINDINGS：失败结算保留耐久句柄后，`refreshDeliveryFacts` 把 Failed 上下文的句柄当已观察锚点（`anchored=true/applied=true`），交付投影出现 commit / pipeline hop，与 D21「失败句柄不是新观察」冲突。修复（`delivery-facts.ts`）：anchored 只认非失败上下文（Ready / 供应中的步骤回填）或已提交的 `has_worktree` 关系；Failed 且无关系边时 `anchored=false`、不提交快照，投影不出现 commit / pipeline hop。判别回归 T7（Fake + 真实 SQLite）：失败后 refresh 修复前 `[true,true]`、修复后 `[false,false]` 且 hops 为空；既有 TD-009「Provisioning 半提交可读、不补写命令边」e2e 保持绿（36/36）。
**验证**：V1 exit 0；V2 `19/19`；V3 `177/177`（新增 T7）；V4 `20/20`；V5 `10/10`；`tests/e2e/delivery-lineage.test.js` 36/36（TD-009 读侧语义不回归）；V6/V7/V8 见终验。
**回滚**：revert round-3 的 fix / docs 提交，无 schema/迁移。

**5.8 写事务内锚点复核（round-4，2026-11-22）**
第三轮独立复评的 P2（提交时序）：`delivery-facts.ts` 只在事务外采样「非 Failed」，写 edges/快照的短事务内没有用 `tx` 复核。真实反例：adopted claim 已耐久 A、preflight 挂起；refresh 事务外采样判定有锚点，随后真实失败事务先提交（Failed、无 `has_worktree`），再进入 refresh 写事务仍 `applied=true` 并产生 fresh commit/pipeline hop。修复：在写 edges/快照的同一短事务内用 `tx` 重新读取上下文状态与 `has_worktree` 关系，不合格直接返回 false（不提交 fresh 事实、`applied=false`）；Provider I/O 仍在事务外；TD-009 合法 Provisioning 正控保持不变。P3：`start-work.ts` 注释改为「读侧只把非失败上下文或 `has_worktree` 关系当锚点」。
判别回归 T8（Fake + 真实 SQLite）：包装 `storage.transaction`，在携带 `putDeliveryFacts` 的目标事务 BEGIN 前放行真实失败事务并等其提交；修复前 `applied=true` + fresh hop，修复后 `applied=false` 且无 hop；正控（静态 Failed、Ready、历史 `has_worktree`、TD-009 Provisioning）由 T7 与 delivery-lineage e2e 覆盖保持绿。事务证据：`packages/storage/sqlite/src/storage-sync.ts` 的唯一事务体使用 `BEGIN IMMEDIATE`，在队列内持有至 COMMIT/ROLLBACK（当前 SQLite 实现并非延迟事务）；不得把「tx 复核与提交之间仍有延迟事务理论窗口」写成已证残余风险或新增批准门（该结论仅限当前 adapter，不推广到未来 Provider）。
**验证**：V1 exit 0；V2 `19/19`；V3 `178/178`（新增 T8）；V4 `20/20`；V5 `10/10`；delivery-lineage e2e `36/36`；M10 kill 集 8 条（T2×2+T4+T5×2+T6+T7+T8）、M14 4 条（T5×2+T6+T7）、M16（删事务内复核）仅 T8 红。V6/V7/V8 见终验。
**回滚**：revert round-4 的 test/fix/docs 提交，无 schema/迁移。

**回滚**：revert 本批文档提交（含归档、索引与 round-2/3/4 文档），无代码行为变化。


## Validation and Acceptance

以下命令是唯一来源，批次只引用编号；均在工作树 `.worktrees/restart-reconciliation/` 根目录运行，且不要同时跑其他重负载命令（`start-work-step-recording.test.js` 里「游标永不结束」用例有 5s 预算，本机在并发负载下观察到过超时，见 `Surprises & Discoveries`）。

- **V1** `pnpm run typecheck` → 期望 exit 0、无输出。
- **V2** `pnpm test:file tests/integration/start-work-step-recording.test.js` → 期望 `fail 0`；最终 head 实测 `19 tests / 19 pass / 0 fail`（基线 11；2026-11-21 实现后 18，评审修复轮新增 T1、修复轮 3 新增 T7 后为 19），新增用例出现在 pass 列表。
- **V3** `pnpm test:file tests/integration/start-work-external-intent.test.js tests/integration/start-work-request-binding.test.js tests/integration/start-work-owner-fencing.test.js tests/integration/start-work-retry-identity.test.js tests/integration/start-work-execution-uniqueness.test.js tests/e2e/start-work-recovery.test.js` → 期望 `fail 0`。最终 head 实测 `177 tests / 177 pass / 0 fail`（2026-11-21 基线 170；评审修复轮 T2×2/T3×2 → 174，修复轮 2 T5×2 → 176，修复轮 3 T7 → 177）。
- **V4** `pnpm test:file tests/integration/local-git-core-provisioning.test.js` → 期望 `fail 0`，且真实磁盘采纳用例出现。最终 head 实测 `20 tests / 20 pass / 0 fail`（基线 18 + 评审修复轮 T4 + 修复轮 2 T6）。
- **V5** `pnpm run boundaries` → 期望 `tests 10` / `pass 10` / `fail 0`；最终 head 实测一致。
- **V6** `node scripts/rule-checks.mjs size main` → 期望首行打印 base/head SHA 后给出 `代码：≤800 / 1000 行` 与 `文档：≤1300 / 1500 行`。
- **V7** `node scripts/rule-checks.mjs disclosure main` → 期望输出含「机械扫描通过」。
- **V8** `git diff --check main...HEAD` → 期望无输出、exit 0。
- **补充证据（非 V 编号）** `pnpm test:file tests/e2e/delivery-lineage.test.js` → 期望 `36 tests / 36 pass / 0 fail`（修复轮 3 读侧观察面门的回归面，含 TD-009）。

**验收判据**（全部满足才算完成）：

1. 判别性：Batch 1 第 1–4、6、7 组用例在 Batch 1 红、Batch 3 后全绿；第 5、8 组负控在旧实现即绿并在新实现保持；八个变异全部按预期变红并逐条记录输出。
2. 产品面：`unknown` 之后用同一份表单再提交（同 key），provider 恢复可读时收敛到 Ready 且分支/工作树/run 各 1 份；仍不可读时保持 `unknown`、零外部写；工作树分支不一致时得到 `conflict` 且两侧值可见。
3. 守卫面：V3 全绿——读不可用仍 unknown 且外部写只 1 次、在途不被接管、Ready 不触发外部写、已结算同 key 逐字回放、新 key 仍被挡。
4. 边界：`git diff --stat` 只含 `Global Constraints` 列出的文件（含修复轮 3 增列的 `delivery-facts.ts`，见 D24）；无 schema/契约/UI 变化；V6 达标、V7 清洁、V8 干净。
5. 不做未验证声明：真实平台 provider 与 Host 端到端不在本 PR 证据内；证据面 = fake + 真实 local-git 临时仓库 + 真实 SQLite 关库重开。PR 描述由规划所有者回填（独立验收按约定不改 PR 描述；2026-11-21 当时 body 仍是占位验证段与已归档路径，见 `Outcomes & Retrospective` 的「交付面遗留」；2026-11-22 回读 body 已回填 `completed/` 路径、V1–V8 摘要与「follow-up 未创建」，本轮按 Lead 约定仍不改 PR 描述）。

## Progress

- [x] 2026-11-21：事实核对与基线取证（`main@f74a3b8b`）：V1 exit 0；V5 10/10；V2 11/11；V3 与 V4 的文件同批 186/186（其中 V2 文件单独跑过 3 次：1.8s / 2.7s 通过，并发负载下 5.0s 超时）。
- [x] 2026-11-21：一次性只读探针确认红态——同 key 重放后 `listBranches`/`getWorktree` 调用数 0、外部写 0、结果 `unknown` + `status=failed`（分支采纳、工作树采纳、缺失重发三种场景都复现）。
- [x] 2026-11-21：Batch 1 · 判别性用例先行（红）。V2 `tests 17 / pass 13 / fail 4`（新增 4 条正控分别卡在 `unknown !== saved`×3 与 `unknown !== conflict`；两条负控在旧实现即绿）；V3 前半 `external-intent + request-binding` `73 tests / 60 pass / 13 fail`（12 条 Git 创建步用例卡在「读计数没有增加」、1 条 SQLite 重开收敛用例卡在 `unknown !== saved`）；V4 `18 tests / 17 pass / 1 fail`（真实磁盘采纳卡在 `unknown !== saved`）。
- [x] 2026-11-21：Batch 2 · 只读对账接入（inconclusive/conflict）。GREEN 证据：V2 `tests 17 / pass 14 / fail 3`（冲突用例转绿，三条 adopted/absent 用例仍红——本批显式过渡态）；V3 前半 `external-intent + request-binding` `73 tests / 72 pass / 1 fail`（12 条 Git 创建步的读计数断言转绿，仅剩 SQLite 重开收敛用例等 Batch 3）；V1 exit 0。inconclusive 消息以「对账只读，未重发外部写入」结尾并保留读失败 code（D4）；conflict 两侧值都进入报告。
- [x] 2026-11-21：Batch 3 · 结论驱动续跑（adopted/absent）。GREEN：V2 `tests 17 / pass 17 / fail 0`（3 条 adopted/absent 正控转绿；当时新增用例共 6 条）、V3 `170/170`、V4 `18/18`（真实磁盘采纳）、V1 exit 0。
- [x] 2026-11-21：Batch 4 · 变异验证（八个变异各自只让对应判别用例变红，逐个改回后重跑）：
  - M1（去掉认领事务里被采纳分支的身份写回）→ V2「外部已建同名分支」红（`createBranch` 被再调一次；D15 说明变异点为何从 `provisionGit` 移到这里）。
  - M2（`probe.error` 当 absent）→ external-intent 六条 `createBranch` lost-ack 用例红（外部写计数 2 ≠ 1）。
  - M3（未决状态放宽到 `pending` + 去掉 `needsSupply` 守卫）→ V2「在途的同 key 重放不得探测」红；单独放宽任一处不会被杀死，两处联合承重。
  - M4（同 key 证据行判定改成任意未决行）→ V2「conflict 后列表读取失败…新键盲写」红。
  - M5（去掉 `intent.ownerGeneration === record.provisioningGeneration`）→ V2「旧代际的同 key 重放不得探测」红。
  - M6（用 `intent.input.worktreeKey` 代替持久 `path`）→ V4 真实磁盘采纳用例红（`createWorktree` 被再调一次）。
  - M7（去掉工作树分支一致性检查）→ V2「工作树检出别的分支」红（冲突被误报 adopted）。
  - M8（让 adopted 也照常调用 `ensureWorktree`）→ V2「工作树已落盘但 ack 丢失」红（`createWorktree` 被再调一次）。
- [x] 2026-11-21：Batch 4 · 文档与归档：本计划移入 `docs/exec-plan/completed/`（文件名不变），`docs/README.md` 索引从 Active 移到 Completed。
- [x] 2026-11-21 23:2x（Asia/Singapore，独立验收，实现 head `adf77c83` + 本收尾提交）：P2-1 文档真实性修正——本计划自身路径改指 `docs/exec-plan/completed/2026-11-21-restart-reconciliation.md`（active/ 路径在 head 上 404）、follow-up 统一改为「建议，本 PR 未创建」（D1/D6/D13/D19）、`docs/README.md` 索引复核为 Completed（2026-11-22 评审修复轮重开期间本计划重新位于 `active/`，归档时回 `completed/`）。
- [x] 2026-11-21 23:2x（独立验收）：P2-2 并发守卫补判别用例——「对账采样后同 key 未决行被别的写者推进时不得采纳」。RED→GREEN 证据：把 `packages/core/src/start-work.ts:429,438` 两处「当前行与采样行逐字相同」守卫放宽成「任意未决行」（M9）后 V2 `18 tests / 17 pass / 1 fail`，新用例红（`行已不是采样行：必须按原有重放语义作答，不得拿旧证据续跑`），既有 17 条全绿；`git checkout -- packages/core/src/start-work.ts` 还原后 V2 `18 tests / 18 pass / 0 fail`。实现未改动（D18）。
- [x] 2026-11-21 23:2x（独立验收复跑）：V1 exit 0；V2 连跑 3 次均 `18/18`（游标用例 2469 / 1792 / 1869 ms，5s 预算内）；V3 `170/170`；V4 `18/18`；V5 `10/10`；V7「机械扫描通过」；V8 无输出；V6 见 `Outcomes & Retrospective` 的规模行（数字按最终 head 重算）。逐条 AC 对照同章节。
- [x] 2026-11-22 评审修复轮 · 5.1 判别性回归先行（红，只改测试；`test(core)` commit）：
  - V2 `19 tests / 18 pass / 1 fail`——T1 失败形态 `writes[1].path='.worktrees/new-default'`（期望持久 `.worktrees/original-target`）；
  - request-binding `25 tests / 21 pass / 4 fail`——T2 两崩溃窗口均卡在崩溃后 `worktreeExternalId=undefined`；T3 两 operation 均答 `failed`（期望 `unknown + permission_denied`）；
  - V4 `19 tests / 18 pass / 1 fail`——T4 认领提交后 `worktreeExternalId=undefined`。
- [x] 2026-11-22 评审修复轮 · 5.2 生产修复 S1–S4（绿，`fix(core)` commit）：V1 exit 0；V2 `19/19`；V3 `174/174`；V4 `19/19`；V5 `10/10`；既有断言零放宽。
- [x] 2026-11-22 评审修复轮 · 5.3 变异 M10–M13：M10 → T2 两窗口 + T4 + T5×2 + T6 红（同一认领守卫；修复轮 3 补测 T7 后实测 7 条）；M11 → 仅 T2 分支回填窗口红；M12 → 仅 T1 红；M13 → 仅 T3 两 operation 红；每项按备份文件字节还原（sha1 一致）后重跑 GREEN。
- [x] 2026-11-22 评审修复轮 · 5.4 F3/F4 文档订正：状态头、D20–D22、D13 前缀、AC 表、D19 与交付面历史化；V7 通过、V8 无输出。
- [x] 2026-11-22 评审修复轮 · 5.5 归档与索引：本计划移回 `docs/exec-plan/completed/`，`docs/README.md` 索引回 Completed；V6 代码 754/1000（用户预算 800）、文档 533/1500（用户预算 1300）。独立复评与合并仍待人类伙伴。
- [x] 2026-11-22 修复轮 2（5.6）· 独立对抗验证 FAIL（F1 残余）后的判别回归（红）：V3 `27 tests / 25 pass / 2 fail`（T5 两条卡在崩溃/普通失败后 `worktreeExternalId=undefined`）；V4 `20 tests / 19 pass / 1 fail`（T6 同形态）。
- [x] 2026-11-22 修复轮 2（5.6）· 生产修复（绿）：`gitFailure` 在所有 recorded 已知的失败点携带已耐久工作树句柄、失败结算不写 `has_worktree` 边；V1 exit 0、V2 `19/19`、V3 `176/176`、V4 `20/20`、V5 `10/10`；M14（忽略携带）只让 T5×2 + T6 红（修复轮 3 补测 T7 后为 4 条），还原后全绿。
- [x] 2026-11-22 修复轮 2（5.6）· 文档与交付口径：D21 补残余与修复、D23 记录 `Refs #191` 的交付子集与剩余跟踪；Batch 5.6、Outcomes/Surprises/Change Note 回填；评审追加段随 docs 提交保留。
- [x] 2026-11-22 修复轮 3（5.7）· 读侧观察面门：失败后 refresh 修复前 `anchored=true/applied=true` 且投影出现 commit/pipeline hop（T7 RED），修复后 `false/false`、无 hop（T7 GREEN）；delivery-lineage e2e 36/36 保持绿；V3 `177/177`。
- [x] 2026-11-22 修复轮 3（5.7）· 最终独立验收（accept673fix，非实现者/非验证者）：复验轮 3 判 PASS WITH FINDINGS（无 P0/P1；P2 范围一致性、P3 文档陈旧）。本轮完成 P2 范围一致性（`Global Constraints` 增列 `packages/core/src/delivery-facts.ts`，D24 记录依据与 blast radius）与 P3 订正（M10/M14 kill 集补 T7、AC 表与验证读数按当前 head 订正、代码余量 13 行（787/800）记为后续增量约束），并记录评审追加段来源/时间/快照 head（D25、Surprises 20）。**归档暂停**：评审方 2026-11-22 11:47 追加「第三轮独立复评」，锁定候选 `fc7d28bd` / head `daaef005`（tree `29c7cc80`），提出 1 P2 + 1 P3（见 Outcomes 末段、D25 与 Surprises 20）；按 Lead 裁决暂停归档：本计划从 `docs/exec-plan/completed/` 移回 `docs/exec-plan/active/`、README 索引回到 Active，转修复轮 4，不写 Completed/收敛。
- [x] 2026-11-22 修复轮 4（Lead 裁决；已由 5.8 实施并复验，见下）：读侧提交事务内复核发布权威——`delivery-facts.ts` 在写 edges / `putDeliveryFacts` 的同一短事务内用 tx 复核上下文与对应命令关系，不合格不提交新的 fresh 快照并返回 `applied=false`（Provider I/O 仍在事务外，保留 TD-009 合法 Provisioning，不收紧成只 Ready）；`start-work.ts:781` 注释改为非 Failed 支持面；补「BEGIN 前让公开失败事务先提交」的判别回归；修复 + 复验后在最终 head 重跑 V1–V8、delivery-lineage e2e 并回填 Completed、规模读数与归档/索引。
- [x] 2026-11-22 修复轮 4（5.8）· P2 提交时序判别回归（红）：T8 包装 `storage.transaction`，在 refresh 写事务 BEGIN 前让真实失败事务先提交；修复前 `applied=true` 且投影出现 fresh commit/pipeline hop；P3 注释与门表述不一致。
- [x] 2026-11-22 修复轮 4（5.8）· 生产修复（绿）：写 edges/快照的同一短事务内用 `tx` 复核上下文状态与 `has_worktree` 关系，不合格不提交 fresh 事实（`applied=false`）；Provider I/O 仍在事务外，TD-009 正控不变。V1 exit 0、V2 `19/19`、V3 `178/178`、V4 `20/20`、V5 `10/10`、delivery-lineage e2e `36/36`；M10 8 条 / M14 4 条 / M16 仅 T8 红，还原后全绿。
- [x] 2026-11-22 修复轮 4（5.8）· 文档与归档：Outcomes/Surprises 21/Batch 5.8/Progress/Bottom Change Note 回填；状态头回 Completed，计划从 `active/` 归档回 `completed/`，README 索引回 Completed；评审追加段（第三段）只读保留。
- [ ] 人类评审与 PR ready（由人类伙伴决定合并）。

## Surprises & Discoveries

1. **「丢 ack 就一定对过账」不成立**：`ensureBranch`/`ensureWorktree` 只在 provider 返回 `ambiguous_result`/`conflict` 时读回；**throw 路径只 `markUnknown`**（`packages/core/src/git-provisioning.ts:234`、`:268`）。所以持久化的 `unknown` 至少有两种来源，文案不能默认「对账已跑过」。证据：上述文件与行，加上探针对 `throw` 场景的复现（探针读计数 0）。
2. **新 key 阻挡有契约级依据**，不只是测试习惯：`packages/capabilities/src/storage.ts:396-398`「未决槽位由 core 跨 key 阻挡」、`packages/storage/sqlite/migrations/001_init.sql:338`「未知步骤跨 key/lease 保守阻挡，非自动恢复日志」、`docs/architecture/gate-e1-ruling.md:242` 的人类采纳说明。这条把「restart 是否包含新 key」的裁定从偏好问题变成契约问题。
3. **产品的恢复动作就是同 key**：`packages/client/src/start-work.ts:52,59` 在 `uncertain` 时复用 key，`packages/ui/src/start-work-section.ts:27` 冻结表单但允许再次提交，client 只在插件加载时组合一次（`apps/harness-plugin/src/client.ts:72`）。因此同 key 重放不是边缘路径。
4. **一条既有用例在修复后会失去判别力**：`tests/integration/start-work-request-binding.test.js:139-149` 的失败注入是永久的，修复后重放会真的再探测/再试一次，但最终仍是 `unknown`、外部对象计数不变，断言仍绿。因此必须新补「探针确实被调用」的断言（Batch 1 第 5/6 项），否则「没跑对账」与「跑了但读不到」无法区分。
5. **基线存在一个 5s 预算的时序敏感用例，且 main 基线同样复现（预存在 flake）**：`tests/integration/start-work-step-recording.test.js:336`「游标永不结束」在并发负载下观察到 `test timed out after 5000ms`（同批 8 文件 5125ms、另一个并发运行 5015ms），空闲单跑 1832ms / 2651ms 通过。独立验证者在**同一测试文件的 main 基线副本**上复现 5009.9ms 超时（4262.9ms 通过 / 5009.9ms 超时），证明它与本 PR 无关；本 PR 未改该用例、未改 `branchProbe` 的 1000 页上限、未改预算。独立验收本轮复跑 3 次分别 2469 / 1792 / 1869 ms 通过（`18/18`×3），当前 head 的 CI 全绿（见 `Outcomes & Retrospective`）。**不改测试、不改预算**，验证时避免并发并在 Progress/本条目记录实际观察值。
6. **本轮验证期间宿主上还有其他工作树在跑整套测试**：实现阶段最终 V2 运行中该用例观察到 5004ms（5s 预算），与第 5 条同一时序敏感形态；node 的汇总为 `tests 17 / pass 16 / fail 0` 且 exit 0，但失败列表仍打印该超时诊断。空闲时 2.7s 通过。按第 5 条约定不改测试与预算，只如实记录。
7. **两个变异揭示了守卫的真实承重点**：(a) 原计划 M1 指向 `provisionGit` 的 adopted 分支块，但认领事务写回身份后它不可判别，删掉它不会变红——按最小化删除并改到认领事务（D15）；(b) M3 单独放宽「未决状态」或单独去掉 `needsSupply` 都不会被杀死，两者联合才让在途同 key 重放开始探测，负控因此补了 `getWorktree` 读计数。
8. **`getWorktree` 的句柄在两种 provider 上都可重建**：local-git 的 `getWorktree` 按 externalId 解析路径再读 `worktree list`（`packages/providers/development-local-git/src/provider.ts:274-292,318-330`），fake 的工作树 externalId 就是 `path ?? worktreeKey`（`packages/providers/fake/src/development.ts:202-243`），而两者的 `preflightWorktree` 都会把规范化路径写进持久 intent，所以「用持久 intent 的 path 读回」在两种实现上都成立。没有 preflight 的 provider 没有持久句柄，本方案按 `inconclusive` 处理，不猜。
9. **一条既有断言按 spec 被「同 key 化」替换，覆盖因此转移**：`tests/integration/start-work-external-intent.test.js` 里关库重开后的重放从新 key `'restart'` 改成同 key `'first'`（spec §7.5 明确要求，为的是证明重启后同 key 会先对账收敛）。因此「关库重开后**新 key** 仍被阻挡」不再由该文件断言；它仍由同文件前置循环、`start-work-step-recording.test.js:311-334`、`tests/e2e/start-work-recovery.test.js` 与 `start-work-execution-uniqueness.test.js` 覆盖。后续可补回一条最小的新 key 断言，不阻塞本 PR。
10. **并发守卫此前没有判别用例（P2-2）**：把 `packages/core/src/start-work.ts:429,438` 的「当前行与对账采样行逐字相同」放宽为「任意未决行」后，原 6 条同 key 重放用例全绿（M9 SURVIVED），说明「另一写者在对账采样后推进了同一行」这个窗口没有负控。补的用例在探针读之后把同 key 行推进成新的 `pending` 行，断言重放回落原语义（`Pending`、不采纳、不重发、记录与槽位一字不改）；同一变异下该用例红、其余 17 条绿（D18）。
11. **崩溃注入点必须按「提交后」的 `putExecutionContext` 计数，不能按事务序号**：实测事务序列是 `claim#1`、`checkOwner#2`、读门 ticket#3、`recordStep#4/#5`、`settle#6`；在第 3 个事务抛错会被 `guardedDevelopmentReads` 捕获成 `unavailable`，模拟不出目标窗口。正确形态：包 `tx.putExecutionContext` 计数，在 `storage.transaction` 返回（已提交）之后抛错——事务体内抛错会整笔回滚。窗口 2 的提交后抛错会经 `localWrite` 转成 `LocalWriteFailed`，调用方看到 `unknown` 而不是拒绝；认领窗口则直接拒绝。两种形态都表示「已提交但进程死掉」。
12. **三处收紧由变异/不可判据证伪**：被采纳身份的 `adopted` 回退永不触发（认领事务已把句柄写库，`recorded` 必可见）；过期 Provisioning 分支写 `adoptedWorktree` 不可判别（unknown 行恒伴随 Failed 根，归属终态接管分支）；把 `provision` 形参改成 `reconciled` 对象等价但不必要。按 D15 最小化后见 D21。
13. **T3 两个 operation 共用同一个写门拒绝点**：`START_WORK_ROUTE.anchor` 是 `DevelopmentWorktreeCreate` 的写门，所以 `createBranch` / `createWorktree` 两种未决 intent 都在 `claimContext` 的 route 计算处被同一点拒绝；`policy {DevelopmentWorktreeCreate: ReadOnly}` 因此能同时覆盖两个 operation。
14. **M10 会同时杀死 T4**：T4 也断言认领事务持久化被采纳身份，所以删掉认领写回时真实磁盘用例一起红；这不是注入错误，而是同一守卫的第二份证据（M11 才是分支回填的专属判别）。
15. **本轮验证无环境噪声**：游标 5s 预算用例在本轮各次运行 146–169ms 通过，未观察到此前记录过的并发超时。

16. **独立对抗验证在 round-1 后判 FAIL：F1 的普通失败路径仍丢耐久身份（修复轮 2 的依据）。** 运行态报告 `verify/673.md`：同 key unknown → 对账 adopted A → 认领事务已耐久 A 并消费旧 intent → 后续 preflight 临时 `unavailable` 或 `listBranches` 临时 `permission_denied` → `gitFailure` 写死 `worktreeExternalId: undefined` → `settle`/`saveContext` 清掉 A → 根 failed、无 intent、无 A 引用；Fake+SQLite 恢复后产生 A/B 两份且 Saved，真实 Git+SQLite 永久 `failed/invalid_input`、磁盘 A 成为无主对象。评审账号 2026-11-22T02:56Z 在原 F1 线程追加同一复现，工作树内评审文档的「候选复审」段（`docs/review/pr-673-mmp-review.md` 末尾，+12 行）记录了同一结论并随本轮 docs 提交保留。
17. **验证者 residual 探针的期望字段与本轮「已结算同 key 逐字回放」语义冲突，未按该期望实现。** 运行态验证探针 `attack-f1-residual*.mjs`（未入库）期望 `slotAfterFailure=['unknown','unknown']` 且同 key 重放 saved；但那要求把已结算的失败行退回「未决可对账」形态，与 I3（已结算同 key 逐字回放）和 F2 的「不留下 failed 根 + unknown 旧槽」冲突，也与既有 #184「失败后换新 key 接管」的恢复动作不一致。本轮实现保留诚实失败（根/attempt 均 failed、保留读失败 code）并靠新 key 用持久 A 收敛；修复后探针实测 `handleAfterFailure=A`、`worktrees=[A]`、真实磁盘 `[repo, A]`，与该期望一致的三项为绿，两项口径差异按 D21 记录，供 Lead/人类裁决。
18. **普通失败与进程中断的落库形态不同，但修复后共享同一耐久身份保证。** 认领提交后的进程中断会以 reject / LocalWriteFailed→unknown 形式出现；普通 preflight/probe 失败则是可诊断的 failed 结算（错误码保留）。两者都必须在 failure settlement 里保留 `recorded?.worktreeExternalId`，否则默认目标漂移会把「已证明落地的对象」变成第二份对象或无主对象。

19. **读侧观察面门的设计约束（复验轮 2 P2）**：只按「Ready 上下文」设门会破坏 TD-009——Provisioning 半提交（工作树已 ack、最终事务失败）在既有 e2e 中仍要求可读且不补命令边（36/36 中的一例）。最终门 = **非失败上下文（Ready / 供应中的步骤回填）或已提交的 `has_worktree` 关系**；Failed + 无关系边 = 失败句柄不是新观察，不得单独产生交付投影。T7 先红（`anchored=true/applied=true`、commit/pipeline hop）后绿（`false/false`、无 hop）。

20. **评审文档的追加段是外部评审证据，不是对本计划的收尾授权。** `docs/review/pr-673-mmp-review.md` 现存四段评审方追加：第一段「候选复审」以 `3a23053e` 附近快照取证、结论是 F1 未关闭，标题已由评审方自己标注为「历史：F1 未关闭，已被第二轮取代」；第二段「第二轮独立复评」锁定 head `140baef5`、结论为候选技术通过且「未发现剩余 P0–P3 技术 finding」；第三段「第三轮独立复评」于 2026-11-22 11:47 追加，锁定候选 `fc7d28bd` / head `daaef005`（tree `29c7cc80`，即最终 head tree），结论是 F1/F2 保持关闭但存在 1 P2（读侧提交时序）+ 1 P3（注释），并明确不能写成「无剩余 finding」。第二段是快照结论：在该 head 上失败后 refresh 仍会出现 commit/pipeline hop（复验轮 3 的 T7 RED 证据），修复轮 3 正是为关闭这个观察面问题；第三段则指出修复轮 3 的事务外复核仍有时序残余；第四段「第四轮独立复评 · 2026-11-22（候选技术通过）」于 2026-11-22 12:03 追加，锁定生产修复 head `eb541927`，确认第三轮 P2/P3 已关闭、未发现剩余 P0–P3，并附发布文案核对清单与 SQLite `BEGIN IMMEDIATE` 事务证据。收尾时只把四段作为评审证据原样保留（不改写、不删除；第三段随临时 docs 提交、第四段随单独 docs(review) 提交），并在 D25 记录来源与快照 head；不把任一段的绝对结论当作最终 head 的放行结论（最终远端 head/checks 与 R1 仍须 Lead/人类回读）。

21. **提交时序的读侧残余（第三轮独立复评 P2）与修复的复核点**：事务外采样「非 Failed」与写事务之间允许其它真实 start-work 事务提交；反例是 adopted claim 已耐久 A、preflight 挂起，refresh 事务外采样判定有锚点，随后失败事务先提交（Failed、无 `has_worktree`），而写事务仍提交 fresh 快照并投影 commit/pipeline。修复把同一权威的复核移进写 edges/快照的短事务（`tx.getExecutionContext` + `tx.listRelations`），不合格返回 false；Provider I/O 仍在事务外，TD-009「Provisioning 半提交可读、不补写命令边」与静态 Failed/Ready/历史关系正控不变。判别测试 T8 的注入点是「在携带 `putDeliveryFacts` 的目标事务 BEGIN 前放行真实失败事务并等其提交」——不能在事务体内抛错（会回滚，模拟不出「已提交但 refresh 尚未 BEGIN」），也不能在 provider 读阶段就提交失败（事务外采样会因此提前看到 Failed，退化成静态路径）。事务证据补充：`packages/storage/sqlite/src/storage-sync.ts` 的唯一事务体实际使用 `BEGIN IMMEDIATE`，在队列内持有至 COMMIT/ROLLBACK（当前 SQLite 实现并非延迟事务）；因此不得把「tx 复核与提交之间仍有延迟事务理论窗口」写成已证残余风险或新增批准门。该结论来自当前 adapter 源码，不推广为所有未来 Storage Provider 的实测证据。

## Decision Log

- **D1（2026-11-21）restart 范围 = 同 idempotency key 重放；新 key 接管不在本 PR。** 依据：端口契约（`capabilities/storage.ts:396-398`）、DDL 注释（`001_init.sql:338`）、R8 偏离说明（`gate-e1-ruling.md:242`）与五条既有用例；跨 key 需要「取代」语义与 authority 决策。跟进：**建议 follow-up（本 PR 未创建 issue，需规划所有者决定；见 D19）**，标题建议 `fix(core): allow a later idempotency key to take over a reconciled start-work attempt`；若创建，PR 描述用 `Refs` 关联。
- **D2（2026-11-21）关闭点 = `start-work.ts` 的命令 resume 路径；对账只读，写入全在既有认领/供应事务内。** 否决 storage / 投影层 / 查询路径 / 启动扫描 / claim 前 CAS 结算，理由见 `Design / Spec` 的「被放弃的方案」。
- **D3（2026-11-21）不新增任何持久形状。** 四态结论只存在于一次调用的返回值；`mutation_attempt.state` 仍是唯一结果轴。
- **D4（2026-11-21）`inconclusive` 保留读失败自身的错误码（`unavailable`/`permission_denied`/`not_supported`/`result_unknown`），`writeState` 仍是 `unknown`。** 理由：与首遇路径（`start-work-step-recording.test.js:326` 已把「探测失败原因」钉成 `unavailable`）一致，且 client 的 `permission 层拒绝` 恢复文案依赖真实 code；压平成 `result_unknown` 会丢掉「为什么读不出来」这个可操作信息。消息必须含「对账只读，未重发外部写入」。
- **D5（2026-11-21）`absent` 在同一个调用里重发那一步（不先落 `failed` 等用户再按一次）。** 依据：ADR-0004 第 2 条「找到就直接采纳、找不到才重试」；用户的再次提交本身就是显式重试；认领事务先覆盖旧槽位再调用 provider，满足 R8。被否决的替代（先 CAS 结算 `failed`，让用户用新 key 重试）需要 claim 之外的第二个写者，且把可恢复状态呈现成终态失败。
- **D6（2026-11-21）只对 `state='unknown'` 的行对账，不动 `pending` 行。** `pending`（硬崩溃残留）会长期停在「正在处理」；把它纳入需要同时决定「租约过期 + 时间证据」的语义，与 owner-fencing 的「时间不是证据」冲突，需独立 issue（**本 PR 未创建**）；该跟进项写进 PR 风险段（由规划所有者回填）。
- **D7（2026-11-21）工作树对账只用持久 `intent.input.path`；没有句柄就 `inconclusive`。** 不用本次请求重新派生，避免读到另一个目标；不新增「从请求推导句柄」的便利路径。
- **D8（2026-11-21）采纳按自然键，不额外校验分支 head 与 `intent.input.fromRef` 是否一致。** 与既有 conflict/ambiguous 采纳同判据；额外校验会改变 `#160` 的冲突复用语义，属独立决策。
- **D9（2026-11-21）不同的 `branchName` 声明仍结构化拒绝。** 与 `#183` 的「重放不得改变已决定的分支身份」一致；adopted 的分支名视同已决定身份。
- **D10（2026-11-21）跳过被证明的写步骤时不得记 capability 健康。** `observeOperation(..., false, version)` 只表示「刚刚成功写过」，跳过时记健康会污染 runtimeAccess 的事实。
- **D11（2026-11-21）不改 `ADR-0004`、`gate-e1-ruling`、audit 文档。** 它们是人类采纳的决策/证据记录；本计划只在 Decision Log 记录解释，PR 描述说明「与 ADR-0004 第 2 条一致，不修改决策记录」。
- **D12（2026-11-21）验证命令 V1–V8 唯一来源在 `Validation and Acceptance`。** 批次只引用编号，避免同一命令多处副本在执行期间不同步。
- **D13（2026-11-21；2026-11-22 订正来源与范围）AI 协调者在人类授权（调研后自主判断、存疑才询问）范围内的 Q1–Q5 工程裁定（未逐项获得人类接受；不是人类 R1 裁定）。** Q1 restart 范围 = 同 key 重放，新 key 接管旧未决槽位不在本 PR（见 `Outcomes & Retrospective` 的 follow-up 建议；本 PR 未创建 issue）；Q2 对账读被 capability 门拒绝时保留读失败自身 code、`writeState=unknown`，消息注明「对账只读，未重发外部写入」；Q3 不改 ADR-0004 / R8 偏离文案，解释只记在本 Decision Log（与 D11 一致）；Q4 不把硬崩溃 `pending` 残留纳入对账（与 D6 一致）；Q5 采纳不额外校验分支 head 与 `intent.input.fromRef` 一致（与 D8 一致），该风险写入 `Outcomes & Retrospective`。
- **D14（2026-11-21）对账结论的答复面用 `existingResult(record, report, verify=false)`。** 触发对账的前提是上下文可续跑（终态或租约过期）且没有 run，因此记录不可能是「完整 Ready」；仍显式跳过 Ready 验证读，让 conflict / inconclusive 的答复与零写入是同一个事实。被采纳的分支身份在认领事务里写回（`branchExternalId`），**不**在那里写工作树句柄：句柄继续只由步骤回填产生，谱系锚点纪律不变。

- **D15（2026-11-21）`provisionGit` 不再消费 adopted 分支证据：认领事务写回的分支身份已是唯一来源。** 变异验证发现「provisionGit 的 adopted 分支块」在认领事务已写回 `branchExternalId` 之后不可判别（删掉它，用例 1 仍绿：`decided` 路径本来就跳过 `ensureBranch`）。按计划第 9 条的最小化原则删除这份同义实现，并把 M1 变异点改到认领事务的身份写回（那里删掉会让 `createBranch` 被再调一次，用例 1 变红）。adopted 只驱动两件事：预检看到被采纳的工作树路径、以及跳过被证明的工作树步。

- **D16（2026-11-21，独立验收）「对账只读」的精确边界 = 零契约事实写入；runtimeAccess/`sync_cursor` 记账例外被接受。** `reconcileGitStep` 经 `guardedDevelopmentReads` 读 provider，与 `verifyExistingWorktree` 同形：`DevelopmentRepositoryRead` 会捕获 delivery ticket 并推进 `sync_cursor`（fake 观察 `cursorValue` version 2→3；SQLite 表 `sync_cursor`，`migrations/001_init.sql:292`）。context / mutation_attempt / relation / entity / run 等契约事实轴全部不变（V2 冲突例整库快照不变、V3 在途负控记录不变）。因此文档与 PR 文案里的「零写入」必须限定为「零契约事实写入」，不得被读成「一次数据库写都不发生」；本计划把该记账接受为已知成本，不为此新增抑制机制。
- **D17（2026-11-21，独立验收）存在不同 key 的未决行时仍会先探测一次：接受成本。** `reconcileReplay` 在 `claimContext` 判定 `pendingClaim` 之前就调用了 `reconcileGitStep`，因此「另一个 key 有未决行、本次注定被保守阻挡」的路径会多一次只读 provider 调用（无写入、行为不变）。把阻塞判定前移需要复制 `pendingClaim` 的跨事务语义（且仍要在认领事务里复核），收益不抵重复实现与 TOCTOU 风险，故保留现状并记录。
- **D18（2026-11-21，独立验收）并发守卫必须有判别用例；只补测试，不放宽实现。** P2-2：`start-work.ts:429,438` 的「当前行与对账采样行逐字相同」守卫原来没有负控——把两处放宽成「任意未决行」后原 6 条同 key 用例全绿（M9 SURVIVED）。在 `start-work-step-recording.test.js` 新增「对账采样后同 key 未决行被别的写者推进时不得采纳」：对账探针读回后、认领事务前把同 key 行推进成新的 `pending` 行，断言答复回落原重放语义（`Pending`）、不采纳分支、不重发外部写、不起 run、记录与槽位一字不改。M9 下该用例红（其余 17 条绿），还原实现后 V2 `18/18`。生产代码零改动。
- **D19（2026-11-21，独立验收）follow-up 的状态如实记录为「未创建」。** 本 PR 不新建 issue、不改 capabilities/R8 契约；ExecPlan 原先「另开 issue / 在 PR 描述里 Refs 它」的表述改为「建议 follow-up（本 PR 未创建，需规划所有者决定）」。PR #673 描述当时写着「已记 follow-up」且链接指向已归档的 `active/` 路径——按验收约定**验收者不改 PR 描述**，该更正由规划所有者在合并前完成（见 `Outcomes & Retrospective` 的「交付面遗留」）。`Superseded by D20（2026-11-22）`：2026-11-22 回读 PR body 已回填 `completed/` 路径、V1–V8 摘要与「follow-up 未创建」，不再存在「已记 follow-up」的过期表述。

- **D20（2026-11-22，评审修复轮）F3 的 actor / 范围 / 未覆盖与跟踪状态。** 来源：人类交办 + PR #673 MMP 评审（REQUEST_CHANGES，F1–F4）；实施是原实现 session 的修复 subagent，范围严格限定 review 文档 F1–F4，不扩 PR、不改规划 Status/blocked、不合并/approve、不改 PR 描述与 Closes 行（交付面由 Lead 统一处理）。更正两处来源表述：「跨 key 由 §2 R1 裁定排除」「Q1–Q5 已获人类接受」不再成立——同 key 重放范围是 AI 协调者在人类授权（调研后自主判断、存疑才询问）范围内的工程选择，不是人类 R1 裁定；跨 key 保守阻挡另有端口契约与 DDL 依据（`packages/capabilities/src/storage.ts:396-398`、`packages/storage/sqlite/migrations/001_init.sql:338`、`docs/architecture/gate-e1-ruling.md:242`）。当前 PASS 只覆盖已验证子集：同 key / `unknown` / Git `createBranch`|`createWorktree`。未覆盖清单：硬崩溃 `pending`（D6）、跨 key 接管（D1）、一般 Planning 写、真实平台 provider 与 Host 端到端；`#191` 的关闭条件没有子集限定，交付面口径见 D23（Lead 裁定 PR body 用 `Refs #191`）；#193/#421 均于 2026-11-02 CLOSED 且属执行域，不承接本 PR 余项，余项当前无 owner（本 PR 未创建 follow-up issue）。
- **D21（2026-11-22，F1）被采纳身份必须在同一耐久事务里保存，回填不得清掉它。** 机制：认领事务覆盖同 key 槽位会清空 `externalIntent`，被采纳工作树身份只活在 `Claim.adopted` 内存；分支步回填写死 `worktreeExternalId: undefined`，会把认领刚写入的句柄清掉（F1a/F1b）；absent 结论不携带 `intent.input.path`，重发会用变化后的默认目标（F1c）。修复：`reconcileReplay` 携带 absent 的精确输入与报告用自然键；终态接管在认领事务内同事务写回 `branchExternalId` 与 `worktreeExternalId`；分支回填写入 `recorded?.worktreeExternalId`；`provisionGit` 以 `recorded?.worktreeExternalId ?? resendPath` 决定工作树输入，absent 的精确输入只用于本次重发、不写记录。**观察面修订**：D14 原先「认领不写工作树句柄」改为「认领只写被 ack / 对账证明的句柄；`has_worktree` 边仍只由 settle 写」——Provisioning 期间记录可见 `worktreeExternalId` 而边尚未写，这是「读回证据即观察」的诚实观察面，不是新缺陷。**残余窗口**：R-A absent 跨崩溃目标漂移——absent 的精确输入只在同一调用内传递，若认领提交后、首次外部写前崩溃，重启按 provider 当前默认目标重发；对象已被证明不存在，不会产生第二份对象，但对账证明不适用于新目标，严格稳定需新增耐久输入字段（越出 Global Constraints，另立计划）。R-E 一次被拒绝的重发——恢复会对持久句柄重发一次 `createWorktree`，由端口契约「同仓同路径同分支 → conflict 复用」吸收，不产生第二份对象；provider 不遵守该契约时会 `invalid_input`（端口违约，不在支持面内）。R-B pending 硬崩溃残留语义不变（D6）。
**修复轮 2（2026-11-22，独立对抗验证 FAIL 后补）**：普通读取/预检失败（preflight 临时 `unavailable`、分支 prior probe `listBranches` 临时 `permission_denied`）同样会经 `gitFailure` 写死 `worktreeExternalId: undefined` → `settle`/`saveContext` 清掉认领刚持久化的 A（`git-provisioning.ts` 的 `gitFailure` → `:200/:203` 失败返回 → `start-work.ts` 的 settle → `saveContext`）。修复：`gitFailure` 增末参，所有 `recorded` 已知的失败点都携带 `recorded?.worktreeExternalId`（预检失败、分支 prior probe、分支名矛盾、分支步失败、工作树步失败）；失败结算保留已耐久句柄，`has_worktree` 边仍只由成功结算写（失败句柄是「最后已确认」身份，不是新观察）。失败语义不变：根 `failed`、attempt 落 `failed`、错误码保留；恢复动作是换新 key（既有 #184 语义），同 key 已结算失败逐字回放（I3）。判别回归：SQLite × preflight / listBranches 两条 + 真实 Git × preflight 一条；M14（忽略携带）只让这三条变红。
**修复轮 3（2026-11-22，复验轮 2 的 P2）**：失败结算保留 A 后，读侧曾把该句柄当已观察锚点——adopted 后 preflight 失败（context failed、句柄 A、无 `has_worktree` 边）时 `refreshDeliveryFacts` 返回 `anchored=true/applied=true`，交付投影出现 commit/pipeline hop，与「失败句柄不是新观察」冲突。修复：`delivery-facts.ts` 的 anchored 只认非失败上下文（Ready / 供应中的步骤回填）或已提交的 `has_worktree` 关系；Failed 且无关系边时 `anchored=false`、不提交快照。判别回归 T7（SQLite × 失败后 refresh）：修复前 `[true,true]`+hop，修复后 `[false,false]`+无 hop；TD-009「Provisioning 半提交可读、不补写命令边」e2e 保持绿。
- **D22（2026-11-22，F2）可对账行遇写门拒绝必须零写入并保留可恢复 unknown。** 机制：对账采样放行后跳过 unresolved observe，落入原 `!route.ok` 分支：`saveContext(Failed)` + 代际 +1 + `writeReceipt('failed')`；`unknownGitIntent` 只认 `attempt.state==='unknown'`，此后不再对账；`pendingClaim` 又因未决 intent 永久阻挡新 key，一次临时只读就把命令锁死。修复：`claimContext` 在 route 计算之后、跨 key 结算之前，若 route 被拒且本次携带采样证据，返回 `unsettled`（该点之前全是读，返回即整笔零写入）；`startWork` 以 `existingResult(reportFor(Unknown, beginWrite(自然键), 写门错误), false)` 作答，错误码保持 `permission_denied` / `not_supported` 并注明「只读对账已确认未决步骤、写能力暂不可用、未发起外部写入、恢复后同 key 重试」。**诚实分类**：永久能力缺失时保持 `unknown` 而不静默落 `Failed`，是否为结构性 `not_supported` 提供终态失败待人类裁决。**未修 R-D**：非采样的写门拒绝（过期 Provisioning 续跑、无未决行）仍走原 `!route.ok` 终态化并清句柄——F2 字面范围外，如实记录为既有行为。不放开跨 key，不改变 `pending` 行语义。
- **D23（2026-11-22，Lead 裁定，交付口径）PR body 用 `Refs #191`，不宣告关闭；计划如实记录已验证子集与剩余跟踪。** 依据：`#191` 关闭条件没有子集限定，本 PR 只证明同 key / `unknown` / Git `createBranch`|`createWorktree` 子集；Lead 将把 PR body 的关闭关系从 `Closes`（#191）改为 `Refs #191`。剩余跟踪（pending 硬崩溃 D6、跨 key 接管 D1、一般 Planning 写、真实平台/Host E2E）当前无 owner，不在本 PR 宣告；不新建 follow-up issue、不改规划 Status/blocked。第三笔提交与其后的修复轮 2 提交均已按 `Refs #191` 书写，本计划同步口径。
- **D24（2026-11-22，修复轮 3 的 P2 范围一致性）`delivery-facts.ts` 的范围扩展记录。** 背景：复验轮 2 的 P2 要求失败结算保留的耐久句柄不得被读侧当作已观察锚点（否则交付投影出现 commit/pipeline hop）；修复点只能落在 `packages/core/src/delivery-facts.ts`，但该文件不在原 Global Constraints 的允许清单内，本轮独立验收把清单补全并记录扩展本身。依据：这是同一能力闭环（重启对账的失败结算身份）的读侧收口——D21 只写了「失败句柄不是新观察」，若不设读侧门，写入侧与本计划声明会分叉；改动是单点 anchored 条件（净 +5 行、增删合计 9 行：1 个 import 行 + 1 个条件行 + 2 行注释），无 schema/port/列/事件/依赖/迁移，不触碰 capabilities/domain/storage/providers/client/ui，未新增第二事实源。blast radius：只影响 `refreshDeliveryFacts` 的 anchored/applied 判定与失败上下文是否提交快照（Failed + 无关系边 → 不锚定、不提交快照、不投影 commit/pipeline）；Ready、Provisioning（TD-009 半提交可读）、已提交 `has_worktree` 关系三条可读路径均保持，delivery-lineage e2e `36/36` 不回归。判别：T7（修复前 `[true,true]` 且有 hop，修复后 `[false,false]` 且无 hop）与复验轮 3 的 M15 反向变异（把门退回 round-2 行为只让 T7 红）。批准来源：该扩展来自复验轮 2 P2 的收口要求并经 Lead 收尾交办、由本独立验收记录；不在初始批准清单内这一事实如实保留，最终由人类评审确认；此文件后续任何进一步增量都需重新走范围确认；代码余量约束见 Global Constraints 的体量行。

- **D25（2026-11-22，评审证据的保真处理）`docs/review/pr-673-mmp-review.md` 的追加段是评审证据，原样保留，不随修复改写。** 现有四段追加：第一段「候选复审」（评审方，2026-11-22；复评起点 `611ae33a`，后续快照 `3a23053e`；标题由评审方自己改为「历史：F1 未关闭，已被第二轮取代」），结论是普通失败仍会丢掉已采纳工作树 A 的耐久引用；第二段「第二轮独立复评 · 2026-11-22（候选技术通过）」锁定快照 head `140baef5`，生产 blob 固定，结论为候选技术通过且「全矩阵未发现剩余 P0–P3 技术 finding」。因此该结论只对 `140baef5` 快照成立，不是对最终 head 的结论：修复轮 3（读侧观察面门、T7）恰好关闭该快照上仍存在的 commit/pipeline hop 观察面问题。**第三段「第三轮独立复评 · 2026-11-22（1 P2 + 1 P3 待修）」由评审方在 2026-11-22 11:47 追加（未提交，随本临时 docs 提交原样保留）**，锁定候选 `fc7d28bd` 与 head `daaef005`（完整 tree 同为 `29c7cc80`，即针对最终 head tree），提出读侧提交时序 P2 与注释 P3；这是当前 open finding 的现状证据，不能读成已收敛，也不推翻其确认的 F1/F2 CLOSED。**第四段「第四轮独立复评 · 2026-11-22（候选技术通过）」由评审方在 2026-11-22 12:03 追加（工作树未提交）**，锁定生产修复 head `eb541927`（base `main@4907adaa`）与生产 blob，确认上轮读侧提交时序 P2 与注释 P3 已关闭、F1/F2 保持关闭、相关套件 142/142 与独立探针 17/17、typecheck/boundaries/diff-check 通过、未发现剩余 P0–P3 技术 finding；同时附「最终发布文案核对清单」（AC 表「至多一份外部对象」、Batch 4/全文 `Refs #191`、评审索引与 merge-queue 回读、不预写未来合并 SHA）与 SQLite `BEGIN IMMEDIATE` 事务证据。第四段随单独 docs(review) 提交原样收录，仍不替代最终远端发布 head/checks 与人类 R1。本轮只把四段作为外部评审证据随 docs 提交保留（未改写、未删除其正文/标题/结论），来源、时间与快照 head 记在这里与 Surprises 20，避免后来者把任一段的绝对结论误读为最终 head 的放行结论。


## Idempotence and Recovery

- **对账本身幂等**：`reconcileGitStep` 是纯读（只调用 `listBranches`/`getWorktree` 与 `runtimeAccess` 记账），可任意重跑，不产生外部或本地写入。
- **批次可独立回滚**：每个 Batch 一个 commit；`git revert <commit>` 即可回到上一个已知良好状态。Batch 1（测试）与 Batch 2/3（代码）互不依赖回滚顺序；Batch 4 只有文档与归档，可整体 revert。
- **崩溃窗口**：认领事务覆盖同 key 行会丢掉 intent。若在「认领之后、被采纳步骤的回填之前」崩溃，下一次重启会看到 `state='pending'` 且无 intent（不在本 PR 的对账范围），退化为按既有 `safeResume`/冲突复用路径重跑；分支名与工作树路径都是幂等身份，最坏得到结构化失败，不会产生第二份外部对象。该窗口与今天「步骤之间崩溃」同类，必须写进 PR 风险段。 `Superseded by D21（2026-11-22）`：这条绝对断言已被评审反例证伪——认领事务会清空外部意图，被采纳的工作树身份原先只留在进程内，重启后按变化的默认目标重发会产生第二份外部对象（本地 Git 则在分支已被检出时变成 `invalid_input`）。现在认领事务在同一事务内持久化被采纳身份、分支回填携带它；残余窗口见 D21 的 R-A / R-E。
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

实现完成（2026-11-21，分支 `fix/restart-reconciliation`，基于 `main@f74a3b8b`）。同 key 重放一条未决 Git 外部写时，core 先用持久 intent 的精确输入做一次只读对账，再决定答复：

- 分支已落盘（分页读完命中同名）→ 采纳：认领事务把被采纳的分支名写成已决定身份，跳过分支创建，续跑工作树与 run，报 Saved/Ready（头提交来自对账证据）。
- 工作树已落盘且检出同一分支 → 采纳：跳过 `createWorktree`，报 Saved/Ready，句柄取持久 `path`。
- 确定不存在（分页读完仍无同名 / `not_found`）→ 认领先覆盖旧槽位，再重发那一步一次，报 Saved/Ready。
- 工作树检出别的分支 → `conflict`，两侧分支名都报出，零写入。
- 读失败 / 权限拒绝 / 缺能力 / provider 抛错 → `unknown`，保留读失败自身 code，消息以「对账只读，未重发外部写入」结尾，零写入、零外部写。

独立验收（2026-11-21 23:2x Asia/Singapore；分支 `fix/restart-reconciliation`，实现 head `adf77c83`，本收尾提交在其后）。验收者与实现者、验证者都不是同一 agent：重新跑 V1–V8、重放 P2-2 的变异、逐条对照 issue #191 与 spec §7 的判据。

**issue #191 验收对照**

| 判据 | 结论 | 本轮证据 |
|---|---|---|
| 关闭条件「restart always re-runs reconciliation first」（已验证子集：同 key / `unknown` / Git `createBranch`｜`createWorktree`；跨 key 保守阻挡有端口契约与 DDL 依据（`capabilities/storage.ts:396-398`、`001_init.sql:338`、`gate-e1-ruling.md:242`），范围选择是 AI 协调者工程裁定，不是人类 R1 裁定） `Superseded by D20–D22（2026-11-22）` | PASS（同 key） | V2 三条 adopted/absent 正控：探针 ≥1、`createBranch`/`createWorktree` 计数不变或恰好 +1；V3 SQLite 关库重开同 key 收敛；V4 真实磁盘 adopt；2026-11-22 评审修复轮追加 T1–T4 与 F1/F2 证据；修复轮 2 追加 T5（SQLite × 普通失败）与 T6（真实 Git）证据（见 `Outcomes & Retrospective`） |
| ADR-0004「`unknown` 只在本次对账跑过且无唯一结论时出现」 | PASS | 在途/旧代际负控探针 = 0；读不可用、权限拒绝、缺持久句柄 → `unknown` 且保留读失败 code；`absent` 只来自完整分页读或确定 `not_found` |
| vertical-path §2「失败形状是 unavailable，不是静默空列表」 | PASS | `inconclusive` 不压平成 `result_unknown`：保留 `unavailable` / `permission_denied` / `not_supported`，消息含「对账只读，未重发外部写入」 |
| 不新增 `resolution` 轴 / 列 / 表 / port | PASS | 边界 diff 为空（`capabilities`、`domain`、`storage/sqlite`、`client`、`ui` 零改动）；结论只在一次调用的返回值里 |
| 至多一份外部对象、既有守卫不削弱 | PASS | V2 冲突例整库快照不变；V2/V4 外部写计数断言（恢复可能再次调用 create，由端口「同仓同路径同分支 → conflict 复用」吸收，不产生第二份对象）；V3 `178/178` 保留读不可用、在途、Ready、已结算、新 key 阻挡 |
| 规模（仓库 1000/1500、用户预算 800/1300 与 issue 500–800 预报） | PASS | 2026-11-22 修复轮 4 后按最终 head 重算：代码 796 / 1000（用户预算 800，余量 4）、文档 687 / 1500（用户预算 1300） |

**本轮实际输出**（V1–V8，均在工作树 `.worktrees/restart-reconciliation/` 根目录运行）：V1 `pnpm run typecheck` exit 0、无输出；V2 `pnpm test:file tests/integration/start-work-step-recording.test.js` 连跑 3 次均 `18 tests / 18 pass / fail 0`（游标用例 2469 / 1792 / 1869 ms）；V3 六文件 `170 tests / 170 pass / 0 fail`；V4 `18 tests / 18 pass / 0 fail`；V5 `tests 10 / pass 10 / fail 0`；V7「机械扫描通过」；V8 无输出与 exit 0；V6 见上表。宿主 1 分钟负载 39–46（其他工作树并发）下 V2 未复现 5s 超时（见 Surprises 5/6）。

**P2/P3 处理**：P2-1 文档真实性 → 本计划自身路径改指 `docs/exec-plan/completed/2026-11-21-restart-reconciliation.md`，follow-up 统一为「建议（本 PR 未创建）」，`docs/README.md` 索引复核为 Completed（D19）；P2-2 并发守卫 → 新增判别用例，M9 RED→GREEN（D18、`Progress`）。P3-1 → `Progress` 勾选/重复段/编号已订正；P3-2 → 5s 预算按「main 基线同样复现的预存在负载敏感 flake」记录（Surprises 5/6，CI 对该 head 全绿）；P3-3 → `sync_cursor` 记账接受为 D16；P3-4 → 阻塞路径先探测一次接受为 D17；P3-5 → 关库重开后新 key 断言被同 key 化替换记入 Surprises 9。

**评审修复轮（2026-11-22，PR #673 REQUEST_CHANGES 的 F1–F4）**：

- F1（P1）采纳后身份丢失：认领事务同事务持久化被采纳工作树身份、分支回填携带它、absent 重发复用精确输入。判别回归 T1/T2/T4，变异 M10/M11/M12 各自在对应窗口变红；残余窗口 R-A/R-E 与观察面修订见 D21。**round-2 补记**：该结论只覆盖认领/回填/absent 三条窗口；独立对抗验证发现普通读取/预检失败仍会清掉 A，已由 D21 修复轮 2 修复并补 T5/T6 判别回归。
- F2（P1）写门拒绝锁死未决行：采样行遇写门拒绝时整笔零写入、保留可恢复 `unknown`。判别回归 T3（`createBranch`/`createWorktree` 两 operation），变异 M13 使两条变红；未修的 R-D 与能力缺失的诚实分类见 D22。
- F3（P2）`#191` 关闭范围与裁定来源：D20 记录 actor / 已验证子集 / 未覆盖清单 / 跟踪状态；交付口径见 D23——Lead 将 PR body 改为 `Refs #191`，余项当前无 owner、不宣告关闭（本 PR 只证明同 key / unknown / Git 子集）。
- F4（P3）PR 描述回填遗留：交付面记录改为历史时点 + 2026-11-22 回读快照；本轮不改 PR 描述（交付面由 Lead 统一处理，口径见 D23）。
- 证据面：Fake + 真实 SQLite 关库重开 + 真实 local-git 临时仓库；真实平台 provider 与 Host 端到端不在证据内。
- 修复轮 4 终验读数（最终 head 实跑，详见 Batch 5.8 与 Outcomes 末段）：V1 exit 0；V2 `19/19`；V3 `178/178`；V4 `20/20`；V5 `10/10`；delivery-lineage e2e `36/36`；V7「机械扫描通过」；V8 无输出；V6 见 AC 表规模行（代码 796 / 1000、文档 687 / 1500）；M10 8 条 / M14 4 条 / M16 仅 T8 红。

**修复轮 2（2026-11-22，独立对抗验证判定 FAIL 后的 F1 残余）**：独立对抗验证确认 F1 的普通失败路径仍会丢掉已采纳工作树 A 的最后耐久引用（preflight 临时 unavailable / listBranches 临时 permission_denied → `gitFailure` 写死 undefined → settle 清掉 A），Fake+SQLite 恢复后产生 A/B 两份、真实 Git 永久 `failed/invalid_input` 且磁盘 A 无主。修复：`gitFailure` 在所有 recorded 已知的失败点携带 `recorded?.worktreeExternalId`，失败结算保留耐久句柄、不写 `has_worktree` 边；失败语义保持诚实（根/attempt 均 failed、保留读失败 code），恢复动作是换新 key（#184），同 key 已结算失败逐字回放（I3）。RED→GREEN：T5（SQLite × preflight/listBranches，修复前 `worktreeExternalId=undefined`）与 T6（真实 Git × preflight）转绿；M14 只让这三条红。证据面同上（Fake + 真实 SQLite 关库重开 + 真实 local-git 临时仓库）；验证者运行态 residual 探针的两处期望口径（`slotAfterFailure`、同 key saved）与 I3 冲突未采纳，差异见 Surprises 17。评审追加段（`docs/review/pr-673-mmp-review.md` 末尾「候选复审」）随本轮 docs 提交保留。

**修复轮 3（2026-11-22，复验轮 2 判 PASS WITH FINDINGS 后的唯一 P2）**：失败结算保留耐久句柄后，读侧曾把该句柄当已观察锚点——adopted 后 preflight 失败（context failed、句柄 A、无 `has_worktree` 边）时 `refreshDeliveryFacts` 返回 `anchored=true/applied=true`，交付投影出现 commit / pipeline hop。修复：`delivery-facts.ts` 的 anchored 只认非失败上下文（Ready / 供应中的步骤回填）或已提交的 `has_worktree` 关系；Failed 且无关系边时 `anchored=false`、不提交快照、投影不出现 commit/pipeline hop。RED→GREEN：T7（Fake + 真实 SQLite）修复前 `[true,true]` / 有 hop → 修复后 `[false,false]` / 无 hop；既有 TD-009 e2e 36/36 保持绿。P3 文档同步：AC 表 V3 改为 `177/177`、M10 kill 集补 T5×2+T6（最终验收再补 T7，见 5.3）。

**最终独立验收（2026-11-22，修复轮 3 收尾；验收者 accept673fix，非实现者、非验证者）——历史：当时因第三轮 open P2 暂停归档，已由修复轮 4 关闭**：复验轮 3 判 PASS WITH FINDINGS（无 P0/P1；P2 为范围一致性，P3 为文档陈旧）。本轮完成 P2 范围一致性（Global Constraints 增列 `delivery-facts.ts`、D24）与 P3 订正（M10/M14 kill 集补 T7、AC 表与验证读数按 head 订正、代码余量 13 行记为后续约束），未改生产代码与测试。当时评审方于 2026-11-22 11:47 追加「第三轮独立复评」并提出 1 P2 + 1 P3，按 Lead 裁决暂停归档、保留 In Progress；该 P2/P3 已由修复轮 4 关闭并经第四轮复评确认（见 5.8 与下段）。F1–F4 的既有结论如下。

| 项 | 等级 | 最终结论 | 判别证据 |
|---|---|---|---|
| F1 采纳后耐久身份丢失 | P1 | CLOSED | T1、T2×2、T4、T5×2、T6、T7 全绿；M10（7 条）、M11、M12、M14（4 条）分别按预期变红；残余见下 R-A/R-B/R-C/R-D |
| F2 写门拒绝锁死未决行 | P1 | CLOSED（按 X2 口径） | T3 两 operation + M13；写门拒绝零写入、保留 `unknown` 与读失败 code |
| F3 `#191` 关闭范围与裁定来源 | P2 | CLOSED（记录层） | D20/D23：只声明已验证子集，余项无 owner、不宣告关闭（X1 待人类裁决） |
| F4 PR 描述回填遗留 | P3 | CLOSED（记录层） | 交付面按历史时点 + 回读快照记录；PR body 由 Lead 统一回填，本验收不改 PR |

**残余窗口（不静默降低承诺）**

| 编号 | 内容 | 状态 |
|---|---|---|
| R-A | absent 的精确输入只在同一调用内传递；若认领提交后、首次外部写前崩溃，重启按 provider 当前默认目标重发。对象已被证明不存在，不会产生第二份对象；严格稳定需新增耐久输入字段（越出本计划 Global Constraints） | 接受为残余（X4 待人类裁决） |
| R-B | `pending` 硬崩溃残留的重启语义未纳入（D6）；本 PR 不改变 | 既有边界，未覆盖 |
| R-C | 跨 key 接管仍按端口契约保守阻挡（D1）；恢复动作只有同 key | 未覆盖，无 follow-up issue |
| R-D | 非采样写门拒绝（过期 Provisioning 续跑、无未决行）仍走原 `!route.ok` 终态化并清句柄（F2 字面范围外） | 既有行为，已记录 |
| R-E/R-F/R-G/R-H | R-E：恢复对持久句柄重发一次 `createWorktree`，由端口「同路径同分支 → conflict 复用」吸收，provider 违约才 `invalid_input`；R-F：Provisioning 期间记录可见 `worktreeExternalId` 而 `has_worktree` 边尚未写（D21 观察面修订，X5）；R-G：永久能力缺失保持 `unknown`（X3）；R-H：证据面 = Fake + 真实 SQLite 关库重开 + 真实 local-git 临时仓库 | 已记录（D21/D22） |

**支持边界（不冒充超出验证范围的结论）**

- X1 `#191` 关闭关系：关闭条件无子集限定，本 PR 只证明同 key / `unknown` / Git `createBranch`|`createWorktree` 子集；交付口径按 D23 用 `Refs #191`，最终 Closes/Refs 与余项归属由人类 / 规划所有者裁决。
- X2 F2 语义：采纳「保留可恢复 unknown」而非原子结算 failed（D22；复验轮 2 判定诚实、可接受）。
- X3 永久能力缺失分类：保持 `unknown` 直到能力恢复；是否对结构性 `not_supported` 提供终态失败待人类裁决。
- X4 R-A 严格性：接受 absent 跨重启目标漂移为残余，不新增耐久输入字段。
- X5 D14/观察面修订：接受 Provisioning 期间记录可见句柄而关系边尚未写——认领事务只写被 ack / 对账证明的句柄，`has_worktree` 边仍只由成功结算写。
- X6 F3 措辞：D20/Q1–Q5 记为 AI 协调者在人类授权（调研后自主判断、存疑才询问）范围内的工程裁定，未逐项获得人类接受；不是人类 R1 裁定。
- X7 证据面与不承接：真实平台 provider、Host 端到端不在证据内；`pending` 硬崩溃、跨 key、一般 Planning 写未覆盖；#193/#421 已于 2026-11-02 CLOSED 且属执行域，不承接本 PR 余项。

**范围与 blast radius（P2 范围一致性）**：`packages/core/src/delivery-facts.ts` 不在初始允许清单，修复轮 3 因复验轮 2 的 P2 增列（D24）。该文件净 +5 行、增删合计 9 行（1 个 import 行、1 个条件行、2 行注释），无 schema/port/列/事件/依赖/迁移，不触碰 storage/providers/client/ui；只影响 `refreshDeliveryFacts` 的 anchored/applied 判定，Ready / Provisioning（TD-009）/ 已提交 `has_worktree` 关系三种可读路径不变（delivery-lineage e2e `36/36`），并由 T7（RED `[true,true]`+hop → GREEN `[false,false]`+无 hop）与 M15 反向变异判别。

**第三轮独立复评（评审方，2026-11-22 11:47 追加；锁定候选 `fc7d28bd` 与 head `daaef005`，完整 tree 同为 `29c7cc80`，即针对最终 head tree）**：在确认 F1/F2 保持 CLOSED、八个核心恢复文件 + 七个 delivery/lineage 文件 **336/336**、原三个 probe + 第二轮 extra probe **13/13**、typecheck exit 0、boundaries **10/10** 的同时，提出 1 P2 + 1 P3，并明确「不能把本轮写成无剩余 finding」：

- **P2（当时 open，已由修复轮 4 关闭）读侧提交事务内复核发布权威。** 锚点：`packages/core/src/delivery-facts.ts:94-96`（事务外采样上下文状态），发布事务从第 107 行开始。根因：新门只在事务外读上下文并决定 anchored；读到 Provisioning 后，真实供应命令仍可先结算为 Failed 且无 `has_worktree`，随后刷新事务没有用 tx 复核当前状态 / 关系，仍把早期允许态用于新的 fresh 快照。最小公共路径复现（真实 SQLite + Fake provider，未手工改上下文/关系）：A 真实落地但 lost ack → 同 key 恢复、claim 已耐久 A、preflight 用 barrier 挂起 → 并发公开 refresh 在新门读到 Provisioning，并把其事务暂停在 BEGIN 之前 → 释放 preflight 让真实 startWork 普通失败事务先提交（status=Failed、locator=A、无 `has_worktree`）→ 放行刷新，实测 `anchored=true/applied=true` 且新增 fresh `commit` 与两条 `pipeline_run` hop（评审方独立临时探针，未入库；期望 `applied=false`）。影响：失败句柄不得单独产生交付投影的规则仍可被普通并发供应失败绕过，属读侧 P2 的时序残余；不是 F1 的对象丢失/重复创建，未升级 P1。修复方向：在写 edges / `putDeliveryFacts` 的同一短事务内用 tx 复核上下文与对应命令关系是否仍支持发布，不合格时不提交新的 fresh 快照并返回 `applied=false`（Provider I/O 仍在事务外；继续允许 TD-009 的合法 Provisioning，不收紧成只 Ready；anchored 可保留 probe 阶段采样含义）。
- **P3（当时 open，已由修复轮 4 关闭）`start-work.ts:781` 注释与非 Failed 支持面一致。** 当前注释仍写「读侧只认 Ready 上下文或 `has_worktree` 关系」，而实际门是非 Failed（含合法 Provisioning）；改注释即可，行为不变。

修复后复核该单一时序门与原正控并回读最终远端发布 head：修复轮 4 已用 T8 关闭该门，第四轮复评确认候选技术通过；本验收不自行修代码（验收者非实现者）。

**修复轮 4（2026-11-22，第三轮独立复评的 1 P2 + 1 P3）**：P2 提交时序——事务外采样与写事务之间允许真实 start-work 失败事务先提交；复现为 adopted claim 已耐久 A、preflight 挂起，refresh 事务外采样 Provisioning 判定有锚点，失败事务先提交（Failed、无 `has_worktree`），refresh 写事务仍 `applied=true` 并产生 fresh commit/pipeline hop。修复：在写 edges/快照的同一短事务内用 `tx` 重读上下文状态与 `has_worktree` 关系，不合格不提交 fresh 事实、`applied=false`；Provider I/O 仍在事务外，TD-009 Provisioning 正控与静态 Failed/Ready/历史关系正控不变。RED→GREEN：T8（Fake + 真实 SQLite），注入点在携带 `putDeliveryFacts` 的目标事务 BEGIN 前放行真实失败事务并等其提交；修复前 `applied=true` + fresh hop，修复后 `applied=false` 且无 hop；M16（删事务内复核）仅 T8 红。P3：`start-work.ts` 注释改为「读侧只把非失败上下文或 `has_worktree` 关系当锚点」。最终读数：V1 exit 0；V2 `19/19`；V3 `178/178`（新增 T8）；V4 `20/20`；V5 `10/10`；delivery-lineage e2e `36/36`；M10 8 条（T2×2+T4+T5×2+T6+T7+T8）、M14 4 条、M16 仅 T8；V6 见 AC 表规模行（代码 796 / 1000、文档 687 / 1500，用户预算 800/1300）；V7「机械扫描通过」、V8 无输出。状态头回 Completed，计划归档回 `completed/`，README 索引回 Completed；评审四段追加只读保留（第四段单独 docs(review) 提交）。

**重构审查（2026-11-21 独立验收轮）**：该轮只改测试与文档。复核两个生产文件后未找到可判别的重复实现、死代码或有净收益的抽取（`reconcileGitStep` 的只读边界、`claimContext` 的采样行双检、`provisionGit` 的 adopted 跳过都是最小承重结构）；唯一候选是把未对外使用的 `GitReconcileOutcome` 类型收窄为模块私有，属纯风格且会改动已验收的生产文件，收益不抵改动风险，故不做生产重构。新用例复用本文件既有 `localGitLikeBranch` / `controllableClock` 装置，未新增夹具。

与计划的偏差（均有 Decision Log 对应条目）：

1. `provisionGit` 的 adopted 分支块按最小化删除（D15）：认领事务写回的分支身份已是唯一来源，保留它会是不可判别的第二份实现；M1 变异点因此改到认领事务的身份写回。
2. M3 需要同时放宽「未决状态」与 `needsSupply` 两处守卫才能被杀死，负控补了 `getWorktree` 读计数（`test(core): 在途负控同时计数工作树读`）。
3. V2 在实现阶段新增 6 条（4 正控 + 2 负控），计划原文「新增 4 条」只数了正控；独立验收补 1 条并发守卫负控（D18），最终 18 条（4 + 3），V2 期望已订正为 18。
4. 2026-11-22 评审修复轮按最终 spec 收紧了 A 稿的三处不可判别实现：不回退到 `adopted`、不在过期 Provisioning 分支写被采纳句柄、absent 的精确输入只作本次重发输入而不落记录（D21、Surprises 12）。
5. 修复轮 2 未采纳验证者 residual 探针的两处期望（`slotAfterFailure=['unknown','unknown']`、同 key 重放 saved）：它们要求把已结算失败退回未决可对账形态，与 I3 与 F2 的语义冲突；保留诚实 failed + 新 key 恢复。评审追加段原样保留、仅提交，未改写评审结论。

遗留项与 follow-up 建议（不新建 issue、不改 capabilities/R8 契约）：

1. 跨 key 接管仍未放开（D1），**建议 follow-up（本 PR 未创建 issue，需规划所有者决定）**：`fix(core): allow a later idempotency key to take over a reconciled start-work attempt`；
2. `pending` 硬崩溃残留仍会停在「正在处理」（D6），需独立 issue 决定租约与时间证据语义（本 PR 未创建）；
3. 采纳只按自然键、不校验 head/起点（D8），在出现「同名可被他人复用的 provider」时需要复核；
4. Ready 缺口与自动对账仍归 #193/#421，本 PR 不改变 `existingResult` 的缺口文案；
5. 真实平台 provider 与 Host 端到端不在本 PR 证据面内；
6. 5s 游标预算的负载敏感 flake（Surprises 5/6）建议另立 issue 把 1000 页压测改成可注入页数上限或独立进程，不阻塞本 PR。

交付面遗留（非代码；按验收约定，验收者不改 PR 描述、不 gh pr ready、不合并）：

1. **2026-11-21 当时**：PR #673 描述的「真实验证证据」段仍是 draft 占位句、ExecPlan 链接指向已归档的 `docs/exec-plan/active/` 路径（404）、并称「已记 follow-up」——与事实不符，需规划所有者回填。**2026-11-22 回读快照**：body 已回填 `docs/exec-plan/completed/2026-11-21-restart-reconciliation.md`、V1–V8 摘要与「follow-up 未创建」；本条保留为历史事件。剩余交付面动作（最终 head 与 V1–V8 实测、Batch 引用 1–5、`Refs #191`（D23）与已验证子集的关系按 X1 裁决）由规划所有者 / Lead 在回传前统一处理。

## Bottom Change Note

- 2026-11-21（Asia/Singapore）：创建。来源是对两份独立设计提案（variant a / variant b）的 facts 复核与裁定：采纳「同 key 重放前置只读对账 + 结论驱动续跑」，否决「新 key 接管」「`resolution` 列」「启动扫描」「只修答复」；修正了 variant a 的「丢 ack 后必已对账」与 variant b 的引用错位，并把「restart 是否含新 key」的裁定依据落到端口契约、DDL 注释与 R8 说明上。
- 2026-11-21（Asia/Singapore）impl-191：按批次实现并逐个取证：Batch 1 判别性用例（RED 4/17），Batch 2 只读对账（conflict / inconclusive 零写入），Batch 3 结论驱动续跑（adopted / absent），Batch 4 八个变异全部被对应断言杀死，并按最小化原则删除不可判别的 adopted 分支重复实现（D15）。V1 exit 0、V2 17 条（16 pass + 1 条基线时序 flake）、V3 170/170、V4 18/18、V5 10/10；计划归档到 Completed，索引同步。
- 2026-11-21（Asia/Singapore）accept-191 独立验收：P2-1 修正自身路径与 follow-up 措辞（D19）；P2-2 新增并发守卫判别用例，M9 RED → 实现 GREEN（D18、`Progress`）；P3 记录（5s flake 的 main 基线复现、`sync_cursor` 记账 D16、阻塞路径先探测 D17、关库重开新 key 断言替换 Surprises 9）；补独立验收 V1–V8 与 issue #191 AC 对照；未改生产代码。状态更新为「独立验收通过，待人类评审与合并决定」。
- 2026-11-22 / 评审修复轮：按 PR #673 的 REQUEST_CHANGES（F1–F4）重开本计划，新增 Batch 5；评审文档随 PR 提交；关闭范围与裁定来源按 F3 更正为 AI 协调者决定 + 已验证子集。
- 2026-11-22（Asia/Singapore）评审修复轮收敛：Batch 5 五步全部完成——判别回归 T1–T4 真实 RED → S1–S4 转 GREEN → M10–M13 逐个变异验证 → F3/F4 文档订正 → 归档回 `completed/`；三笔提交 `test(core)` / `fix(core)` / `docs(exec-plan)`，生产改动只落在 `start-work.ts` 与 `git-provisioning.ts`（不新增 schema/端口/依赖）。D20 更正 #191 关闭范围与裁定来源，D21/D22 记录 F1/F2 的修复、残余窗口与未修边界；归档后代码 754/1000、文档 533/1500。
- 2026-11-22（Asia/Singapore）修复轮 2：独立对抗验证判 FAIL（F1 普通失败路径丢失已采纳工作树 A 的耐久引用）后重开——新增 T5（SQLite × preflight/listBranches）与 T6（真实 Git × preflight）判别回归并先跑出红（`worktreeExternalId=undefined`），再让 `gitFailure` 在 recorded 已知的所有失败点携带已耐久句柄、失败结算不写关系；M14 只让这三条红。D21 补记残余与修复、D23 记录 `Refs #191` 交付口径；评审追加段随 docs 提交保留。
- 2026-11-22（Asia/Singapore）修复轮 3：复验轮 2 判 PASS WITH FINDINGS，唯一 P2 为「失败结算保留的句柄被读侧当作已观察锚点」（失败后 refresh anchored=true/applied=true 且投影出现 commit/pipeline hop）。在 `delivery-facts.ts` 设门：anchored 只认非失败上下文或已提交的 `has_worktree` 关系，失败句柄不得单独产生交付投影；新增 T7 判别回归（RED `[true,true]` → GREEN `[false,false]`、无 hop），TD-009 e2e 保持绿。P3：AC 表 V3 订正 177/177、M10 kill 集补 T5×2+T6；评审文档第二轮复评追加段随 docs 提交保留。
- 2026-11-22（Asia/Singapore）修复轮 3 最终独立验收（暂停归档）：复验轮 3 判 PASS WITH FINDINGS（无 P0/P1；P2 范围一致性、P3 文档陈旧）后，完成范围订正（Global Constraints 增列 `packages/core/src/delivery-facts.ts`、D24 记录依据与 blast radius：净 +5 行、无 schema/port/依赖）、M10/M14 kill 集补 T7（7 条 / 4 条）、AC 表与验证读数按当前 head 订正、代码余量 13 行（787/800）记为后续增量约束，并在 D25/Surprises 20 记录评审追加段（当时三段）的来源、时间与快照 head/tree。评审方 11:47 追加的第三轮独立复评锁定最终 head tree 并提出 1 项读侧提交时序 P2 + 1 项注释 P3；按 Lead 裁决暂停归档、计划移回 `docs/exec-plan/active/`、索引回到 Active，状态 In Progress（修复轮 4），不写 Completed/收敛；本提交未改生产代码与测试。
- 2026-11-22（Asia/Singapore）修复轮 4：关闭第三轮独立复评的 1 P2 + 1 P3。P2：写 edges/快照的同一短事务内用 `tx` 复核上下文状态与 `has_worktree` 关系，堵住「事务外采样 Provisioning、真实失败事务先提交后刷新仍发布 fresh 事实」的时序残余（T8 RED `applied=true`+fresh hop → GREEN `applied=false`+无 hop；M16 仅 T8 红）；Provider I/O 仍在事务外，TD-009/Ready/静态 Failed/历史关系正控不变。P3：`start-work.ts` 注释与非 Failed 支持面一致。M10 kill 集 8 条、M14 4 条；代码 796/1000（用户预算 800，余量 4，靠压缩既有新增代码的注释/断言腾出）。状态头回 Completed、计划归档回 `completed/`、README 索引回 Completed；评审追加段只读保留。
- 2026-11-22（Asia/Singapore）第四轮复评后的最终收尾：评审方 12:03 追加「第四轮独立复评（候选技术通过）」（锁定生产修复 head `eb541927`；142/142、17/17、typecheck/boundaries/diff-check 通过，未发现剩余 P0–P3）与发布核对清单，单独 docs(review) 提交原样收录；发布文案对齐——AC 表改「至多一份外部对象」（恢复可再 create 并由 conflict 复用）、Batch 4/全文的关闭关系 `Closes` 表述统一为 `Refs #191`（D23）、补充 `storage-sync.ts` 唯一事务体 `BEGIN IMMEDIATE` 证据并明确不得把延迟事务理论窗口写成已证残余风险或新增批准门；`docs/README.md` 索引移回 Completed，`docs/review/README.md` 评审索引与本批 merge-queue 现状回填（不预写未来合并 SHA）。最终 head 门禁：V1 exit 0、V2 `19/19`、V3 `178/178`、V4 `20/20`、delivery-lineage e2e `36/36`、V5 `10/10`，代码 796/1000、文档 687/1500，V7/V8 通过，工作树干净。


### 最终接合与历史整理（2026-11-22，评审协调者）

按原人类任务的条件合并授权，过程历史收敛为单个能力提交，并保留恢复引用；重放到 #671 合入后的 main `520ef1d7`。仅两处文档索引/队列冲突，保留双方内容与 #670/#672/#671 的合入事实；生产与测试按已复评 blob 清单逐文件核对，组合树验证与新 head CI 在合并前完成。Refs #191 保持 OPEN，不扩规划状态或余项 owner。
