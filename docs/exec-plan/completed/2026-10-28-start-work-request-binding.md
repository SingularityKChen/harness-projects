# Start Work 首请求绑定 ExecPlan

> 状态：Completed（实现与独立验收）；远端交付以本计划实时回读命令核对，合并由人类决定。
> 创建：2026-10-28；关联：#194；分支：`fix/start-work-request-binding`。
> 调查基线：2026-10-28 09:11 SGT @ `4be26d55e7d921676b79ad5abc1bbc2b2a4b71cc`；执行前以 argv 调用 `git rev-parse HEAD` 重读。
> 规范：`PLANS.md`；上游：[issue #194](https://github.com/SingularityKChen/harness-projects/issues/194) 与 `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`。

## Purpose / Big Picture

同工作区的一个 Start Work 幂等键只能代表首次获准请求。相同键改变 actor、目标 binding、工作项、仓库或显式分支/工作树参数，会得到结构化冲突，且不会改变本地事实或执行外部写入；完全相同请求只观察原操作，不再次供应。这在在途、中断、重启与两个 context 竞争时均成立。最小证据是 Fake/SQLite 的异请求拒绝、同请求零新增供应、SQLite 真实重开与双句柄竞争测试。

## Context and Orientation

事实：`startWork` 先经 `createWriteLedger.replay` 按 `(workspaceId,idempotencyKey)` 找报告，再经 `claimContext` 按确定性 context id 认领租约；账本直到 Git `settle` 才保存。context 租约保护工作项/仓库资源，不能保护跨 context 的同键请求。`MutationAttemptRecord` 当前允许同键覆盖；已有主键和 Storage 事务足以建立原子认领，不需要第二张表。Fake 事务串行，SQLite 采用 `BEGIN IMMEDIATE`。`existingResult` 会在工作树确定丢失时把 Ready 改成 Failed，因而异请求判断必须先于它。

入口在 core 的 `start-work.ts`；请求类型在 `execution-context.ts`，声明的完整 actor 只有 `kind/id`。`development-route.ts` 根据持久仓库身份选择 Development binding，再在同一 binding 上检查能力；`git-provisioning.ts` 当前再次路由。执行 Provider 的发行身份仍由 run 的 `providerRef` 拥有。账本只记录请求身份与 Git 尝试状态，context/run 继续拥有资源与执行状态，不承诺完整响应逐字重放。

优先级依据：2026-10-28 09:18 SGT 回读 Project #10（`gh project item-list 10 --owner SingularityKChen --limit 500 --format json`），#194 是 P0，计划在迭代 9（2026-11-02 至 2026-11-08）；当前迭代 8 是 2026-10-26 至 2026-11-01，#143 仍为 P0 人类 Demo 走查关键路径。本批提前修复事实可信度，不代表 agent 完成 #143，不修改规划 Status 或依赖关系。后续选择前用同一命令重读，日期不按“当前迭代 9”解释。

假设：Core 的 registry 在一次调用期间是已组合配置；跨重组 binding 漂移仍须检测。主风险是最小拆出路由选择后改变 #219 的拒绝顺序，以及新增 Pending 行使旧故障注入失去判别力。两者都由现有回归与新测试控制。父任务报告基线验证已通过；本计划作者未运行产品测试，不把其报告当实施 head 的证据。

## Design / Spec

选择在现有 `mutation_attempt` 同一行增加 `requestFingerprint?: string`，表示不可变请求身份；可选只为其它命令不在本范围，不是旧 Start Work 兼容。所有新 Start Work 行必须有非空指纹，state/error 可以推进。直接修订当前 003 schema 的列与条件 CHECK，不生成迁移、不推导历史指纹。

指纹保存固定顺序 JSON 元组原文：`["startWork:v1",workspaceId,developmentBindingId,[actor.kind,actor.id??null],workItemId,repositoryId,branchName??null,worktreePath??null]`。字符串严格保留输入字节，不 trim、不做 Unicode 归一、不替换默认值、不用分隔符拼接、不调用调用方对象的 `toJSON`。入口先验证并同步复制全部声明字段到 primitive 快照，后续认领和供应只用快照。`actor` 必须是非空对象、kind 为非空字符串；id/path 若提供必须是字符串，null/非字符串拒绝；原有 workItem/repository/key/branch 规则保留。因为 null 不接受为输入，缺省哨兵无歧义；省略与 undefined 等价，显式默认值、空/空白 path 与缺省各自不同。idempotencyKey 是调用方令牌，不由参数推导。仓库引用当前固定为所选 binding 下 `repositoryId`，不重复存第二份引用路由。

处理顺序与唯一写者如下。

1. 校验和快照后只读已有行；已有 command 不同、指纹缺失或用该行 binding 重建的指纹不同，立即返回 `phase=conflict`、`writeState=conflict`、`confirmed=false`、`error.code=conflict`，固定 reason `idempotency_request_mismatch`。错误与日志不带原请求、路径、actor id 或两份指纹。
2. 指纹相同后，用现行仓库路由的共享只读选择检查当前目标。选中 binding 与记录相同才观察；目标变更、缺失或歧义返回固定 reason `idempotency_target_changed` 的同类冲突，零 Provider 调用、零本地写。原绑定恢复后可重放。选择不检查 create 权限，因此同一 binding 改只读不阻止已有键观察；正常工作树读回仍检查自己的读能力。
3. 无已有行时，保留新 context 的工作项预检、能力门与仓库 read ack。路由拒绝尚未获准，不占键。既有 Ready/in-flight 只选择身份，不要求写权限；需要 new/resume 供应的路径仍过原有能力门。仅抽出共用目标选择，保留无挂载、缺路由及各门的现有错误优先级；`routeDevelopment` 继续用同一选择与门逻辑，不复制算法。
4. 在现有 `claimContext` Storage transaction 内首先重读 workspace/key。若已被认领，完整比较后返回 replay/conflict，不改 context。无行时按事务内持久路由复核所选 binding，并按实际 context 分支检查原有供应门；先写 Pending attempt，再做原有父行登记/context 认领。new/resume/existing/in-flight 的首次获准调用都绑定键。任一步失败整笔回滚；事务内不调 Provider。若预检与事务内目标不同，拒绝并回滚，不临时改道。既有 context 的续跑在能力拒绝时保留原有 Failed/分支/清除工作树/命令边的本地结算语义；只在事务内先复核同键身份后执行，且不建立新 receipt。这是已有恢复事实的观察结算，不代表新的外部操作获准；新 context 拒绝仍零修改。
5. 仅首次认领并返回 new/resume 的调用供应。把该次选定 route 传给 `provisionGit`，供应不再次选择另一 binding；已决定 branch、worktree 和 run 的恢复规则保留。Provider 抛出仍表示中断，不被当作普通本地失败吞掉。
6. `settle` 在同一行推进 Git state/error，保留首次 command/binding/fingerprint；不得以未选到 binding 为由漏掉已认领行的结算。Storage 两实现对已带指纹行拒绝改绑、换 command、改/清指纹，且原行不变；SQLite 守卫必须在其原子写回调/条件 UPSERT 内实现，不能是根接口先读后写的竞争窗口。

Pending 不是永久缓存的响应：同键相同请求走 `existingResult` 时不把 Pending 报告作为 supplied，而读取当前 context/run；即便租约过期也不接管。Saved/Failed/Unknown 则保留当前 supplied 报告与读回降级规则，不能把失败/未知因 Ready 提升。新键命中 Ready/in-flight 的观察收据允许保持 Pending，后续同键从 context 读实时结果，不增加观察结算或第二套响应缓存。显式恢复沿用新 key 与现有租约；本批不解决不同新 key 的租约 fencing（#420）。

不变量：Host 的 mutation_attempt 是请求绑定唯一权威；context 与 run 的原状态所有权保持；异请求冲突在所有修改之前；同键相同请求无 createBranch/createWorktree/startRun；事务回滚不消耗键；外部 ack 不能因本地失败被标 Saved。并发首次预检可能已有只读 Provider 调用，竞争失败者必须零变更型调用且不留本地父行/context。

放弃的方案：仅在 settle 加指纹会漏掉 Pending/崩溃/跨 context；扩大 key 主键会把错用解释为新请求；新建 receipt 表、通用 durable replay 平台或 controller 账本会扩大事实源与接口；hash/通用序列化框架增加无必要机制；本批不改变 contextId 编码、Controller envelope（#306/#307）或租约算法。

一手依据：[AWS Builders’ Library — Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) 的 “Same client request ID, different intent” 与 ACID 认领论述支持保存初始参数、异意图拒绝和本地原子边界。这里只原子化本地认领，SQLite 与外部 Git/执行 Provider 不具备跨系统 ACID；外部不确定性继续用原分步记录与 reconcile。

## Global Constraints

本批单一实现 owner 独占下表；测试与实现不得分给共享区域的并行写者。首轮代码/测试按增删合计预估 600–680 行，保留至少 100 行独立评审修复空间，总量必须小于 800；文档小于 1300 行。接近预算先消除重复 fixture/说明并复核闭环，不删持久化或竞争证据、不机械拆算法。

| 精确所有权（本节为文件集合唯一登记处） | 负责内容 |
|---|---|
| `packages/capabilities/src/storage.ts` | 字段与不可变身份契约 |
| `packages/core/src/start-work.ts`、`packages/core/src/start-work-request.ts`（新）、`packages/core/src/write-machine.ts` | 专用快照/指纹、同事务认领、回放、保留指纹结算 |
| `packages/core/src/development-route.ts`、`packages/core/src/git-provisioning.ts` | 共用只读目标选择、供应使用认领 route |
| `packages/storage/sqlite/migrations/003_control_facts.sql`、`packages/storage/sqlite/src/storage-execution.ts`、`packages/storage/sqlite/src/storage-rows.ts`、`packages/providers/fake/src/storage.ts` | 当前结构、往返、原子不可变身份守卫 |
| `tests/integration/start-work-names.test.js`（CodeQL 跟进）、`tests/integration/start-work-request-binding.test.js`（新）、`tests/contract/suites/storage-execution.js`、`tests/integration/storage-restart.test.js` | 命名语义与有界性能、请求矩阵、barrier/双句柄竞争、真实重开、两实现共享契约 |
| `tests/integration/execution-relation-write-schema.test.js`、`tests/integration/start-work-sqlite-registration.test.js`、`tests/e2e/delivery-lineage.test.js`、`tests/e2e/repository-routing.test.js` | 当前列 fixture、人工 attempt 与故障注入按阶段适配 |
| `docs/exec-plan/completed/2026-10-28-start-work-request-binding.md`（完成时同名移至 completed） | 单一设计、实施与证据记录 |
| `docs/review/pr-432-mmp-review.md` | 本 PR 评审矩阵、判别证据与交付门 |
| `docs/README.md`、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`、`docs/product/vertical-path.md`、`docs/architecture/release-gates.md` | 父任务 owner 串行整理；实施 owner 不争写 |

#414 独占 `migrate.ts`、`migrations.ts` 与 admission 测试，本批不碰；003 的不同区域如需合流由父任务串行整合并重新验证。无旧设计/旧数据兼容、迁移器、双读或默认旧指纹；开发验收使用新临时库。无新依赖/公共 API/规划写入，无 credential/request 内容写入公开材料。遵守 package boundaries，不修改 Provider 能力合同、UI、controller 或执行 fallback。

## Plan of Work

### Concrete Steps

以下各批次给出顺序、直接验证命令和回滚点；先完成计划提交与双向 issue/PR 关联，再写 RED 测试或产品代码。

所有验证在检出 `fix/start-work-request-binding` 的工作树根运行（执行上下文 `.worktrees/start-work-request-binding`）。每批记录当时 head/命令/实际结果；不能沿用 main 的验证。Git 调用经 argv/library API，工作树路径先 realpath 并限定根内。以下是一个 PR 的连续批次，无重复批准门。

### Batch 0 · 可审阅入口

最小闭环：本计划通过结构和独立语义审读后，父任务只提交计划并建立关联 #194 的 draft PR，把 PR 链接回写 issue，回读双向关联后才写 RED 测试或产品代码。主文件为本计划。回读 `gh pr view <pr> --repo SingularityKChen/harness-projects --json isDraft,baseRefName,headRefName,headRefOid,closingIssuesReferences`，期望 draft、base=main、head 为本分支、关联 #194。回滚为撤回计划提交/关闭 draft；不触碰用户数据。用户已授权自治设计至 ready，不暂停计划批准。

### Batch 1 · 判别性 RED 与账本边界

最小闭环：先证明同键跨 context、完整 actor 与在途窗口错误，并为两 Storage 固定不可变契约。主文件：`tests/integration/start-work-request-binding.test.js` 与 `tests/contract/suites/storage-execution.js`。先写 settled 同键换不存在 workItem/repo、actor.kind/id/branch/path 的参数化测试；捕获完整本地行快照与变更型 Provider 计数，避免只断言 error.code。再以 barrier 停在首次认领提交/供应前，让第二个不同 context 复用 key。加入 Pending→Saved 指纹保留、改/清指纹或换 command/binding 拒绝且旧行不变的契约。

验证：`pnpm test:file tests/integration/start-work-request-binding.test.js tests/contract/storage-contract.test.js`。期望新增反例因旧实现错误 Saved、重复供应或缺失指纹而 RED，原断言仍有效；记录实际失败名称后继续。回滚只撤本批新测试，不删原行为守卫，不提交一个伪装完成的红实现。

### Batch 2 · GREEN 与耐久认领

最小闭环：落地 Design 的快照、专用指纹、共享路由选择与事务认领，指纹先于所有 mutation；所有新反例变绿。主文件：`packages/core/src/start-work.ts` 与 `packages/storage/sqlite/src/storage-execution.ts`；其余同批文件见 Global Constraints。适配人工 Start Work attempt fixture 和 SQL 显式列；旧结算故障注入必须按 Pending/settle 阶段命中，不能把第一次写失败从“ack 后”机械改成无外部调用，也不能删 Unknown/Ready/run-gap 断言。ack 后结算失败现在留下 Pending receipt，context/最终关系仍按原事务回滚。

验证：`pnpm test:file tests/integration/start-work-request-binding.test.js tests/contract/storage-contract.test.js tests/integration/storage-restart.test.js tests/integration/execution-relation-write-schema.test.js tests/integration/start-work-sqlite-registration.test.js`；`pnpm typecheck`。期望全部 pass、零类型错误，原故障注入确实触发指定阶段。回滚整批代码/fixture/003，保留 RED 证据；只用新临时库，不尝试 downgrade。

### Batch 3 · 重启、竞争与交付

主文件：`tests/integration/start-work-request-binding.test.js`。最小闭环：补齐 SQLite 真 close/reopen 的 Pending、branch ack 后中断、settled 三种状态；第二 core/第二 SQLite 句柄使用同文件、同 workspace/key、不同 context；barrier 先使两调用读到无 attempt，再让第一笔 admission 提交、第二笔事务重读，一胜一冲突。barrier 不在持锁事务中等待另一个同线程同步 SQLite 句柄，避免 busy_timeout 阻塞事件循环；不因此新增存储调度器。验证同键 Pending 在租约前后都不供应，新键仍可恢复；Ready/in-flight 新键先占键，后续换目标被拒；快照前后调用方改原对象不能改供应输入。恢复原 binding 可重放，添加无关 binding 不改变身份，同 binding 的 create 只读允许观察。

验证先执行 `pnpm test:file tests/integration/start-work-request-binding.test.js tests/e2e/start-work.test.js tests/e2e/start-work-recovery.test.js tests/integration/start-work-retry-identity.test.js tests/integration/start-work-step-recording.test.js tests/integration/local-git-start-work-resume.test.js tests/integration/local-git-core-provisioning.test.js`，期望全 pass，尤其保留 #219 门顺序/只读/多 binding 及 Unknown 回归。随后执行 `pnpm boundaries`、`pnpm verify`、`node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`，并以 argv 调用 `git diff --check origin/main...HEAD`，期望全 pass。身份、持久化、并发与外部写入横跨边界，因此本次全验证有必要；新失败未解决不得 ready。

独立审读通过后收敛 commits，格式为 `fix(core): <中文摘要>`，正文解释原因并 `Closes #194`。publication 五类人工检查完成后 push；若整理已发布历史先 backup ref 与精确 lease。最终 push 后回读当前 head/base、checks、issue 关联和全部 review threads；通过后 `gh pr ready <pr>`，保留人类评审，不合并。父任务完成计划归档/索引与机械元数据，Status 仍由人类批准。回滚为整批 revert 并恢复实施前开发库备份，保留外部 ack 资源，不自动删除分支/工作树。

### Batch 4 · CodeQL 命名复杂度跟进

主文件：`packages/core/src/git-provisioning.ts` 与 `tests/integration/start-work-names.test.js`。在分支 `fix/start-work-request-binding` 工作树根运行 `pnpm test:file tests/integration/start-work-names.test.js`：改代码前短语义表通过、独立 Worker 的百万内部连字符输入超过 5 秒操作期限后安全终止，形成 RED；改后两项均通过。只用索引循环替换首尾裁剪，不改原字符替换、默认分支/工作树 key、内部连字符或退化拒绝。随后运行原 Batch 3 的命名相关供应/回放/本地 Git 回归和 `pnpm verify`；期望全部 pass。回滚为本次最小修复提交的 revert，不改 schema/请求绑定语义；告警不抑制、不 dismiss，父任务负责发布后重新回读 hosted security check。

## Validation and Acceptance

| 验收 | 可核对证据 |
|---|---|
| 完整声明身份、无编码歧义 | actor.kind/id、workspace、所选 binding、workItem/repo、branch/path 逐字段；不同对象键序/undefined 相同，显式默认/分隔符/引号/反斜线/Unicode 不别名；跨 workspace 的同 key 各自独立 |
| 异请求无假成功/无修改 | settled 与 Pending 换不存在目标均 structured conflict、confirmed=false；本地行快照不变、变更型 Provider 增量 0；已有行快路径连读 Provider 也不调用 |
| 精确重放保留诚实结果 | Saved/Failed/Unknown 与现有读回/缺口规则一致，Pending 跟随 context；createBranch/createWorktree/startRun 增量 0 |
| 首次原子与竞争 | admission 任一步注入失败不留 attempt/context/父行/关系；双句柄跨 context 一胜一拒，loser 零 mutation |
| 重启不中断绑定 | 实际关闭/重开同文件后指纹与 state 逐字段相同；Pending/branch ack/settled 的 mismatch 拒绝；相同 Pending 不接管、新 key 可恢复 |
| 路由与调用同源 | 指纹 binding 等于供应收到 binding；漂移/消失/歧义冲突且不改道；无关挂载不改变身份；只读观察与 #219 错误顺序保留 |
| 存储最终防线 | Fake/SQLite 共享契约拒绝身份覆盖/擦除并保持旧行；允许原地状态推进；Start Work 缺指纹被拒 |
| 审阅与发布面 | 代码/测试增删合计 <800、文档 <1300，真实验证与当前远端 head 对应；无原请求/凭据/本机身份/内部系统泄漏；人类决定合并 |

## Progress

- [x] (2026-10-28 CodeQL 跟进) hosted security check 在 head `bea6aa34905896172970836774b4b633f8a0a4fb` 发现命名裁剪正则多项式复杂度；有界 Worker RED 后以索引循环修复，聚焦 102/102、源码冻结后完整 `pnpm verify` 2179 主测试 + 7 MVP（含类型检查）通过；hosted CodeQL 复验仍由父任务执行。

- [x] (2026-10-28 09:18 SGT) 核对 issue、两份独立设计与实际源码，完成最终设计及范围收敛。
- [x] (2026-10-28 09:25 SGT) Batch 0：计划 lint 与独立语义审读通过，draft PR #432 已创建；双向 closing 关联、base/head/draft、标签、assignee、milestone 及 Project ExecPlan/Batch 写入已确认。
- [x] (2026-10-28) Batch 1：新增判别性 RED（162 项中 14 项失败）与共享存储契约；失败覆盖无指纹、在途漏认领、改意图假 Saved、SQLite 重启和双句柄跨 context 竞争。
- [x] (2026-10-28) Batch 2：primitive 快照、固定元组、原子认领与两存储守卫已实现；聚焦套件 311/311 通过，ack 后注入改在第二次 attempt 写入并保留 Unknown/句柄/事务回滚断言；`pnpm typecheck` exit 0。
- [x] (2026-10-28 10:09 SGT) 独立验收与交付准备完成；最终远端 head/checks/threads/ready 按本计划命令实时核对，不能以本地测试替代。

## Surprises & Discoveries

2026-10-28 CodeQL 跟进：analysis workflow 成功不代表 security check 通过；最终 head 的一个高严重级告警定位 `git-provisioning.ts` 的首尾连字符裁剪。合法输入 `a` + 长内部连字符 + `b` 会让尾锚定匹配在每个内部起点重试；既有语义测试只覆盖短输入，不能排除该资源消耗缺陷。

2026-10-28 实施（分支 `fix/start-work-request-binding`，根目录）：`pnpm test:file tests/integration/start-work-request-binding.test.js tests/contract/storage-contract.test.js` 的干净 RED 结果为 148 pass / 14 fail（162 tests），产品实现尚未改动。新增共享契约还证明 Fake attempt 的输入/读回引用能绕过不可变守卫；隔离对象后两实现通过。`pnpm verify` 首轮为 2168 pass / 5 fail（2173 tests）：发现两个未列 fixture 分别把首写当结算、把 R5 事务内路由变更预期为 unavailable；已把必要的精确文件补入 Global Constraints。另两项为既有能力拒绝后的 context/句柄语义，按 Decision Log 保留原断言并修复；完整验证仍须重跑。运行态日志按根约定保存在任务 SDD 目录，计划只记录结论。

2026-10-28 09:18 SGT：实际 `existingResult` 的 Ready→Failed 写入否定“先读结果再检查请求”的安全性；`start-work.ts` 的入口与该函数是判据。新 key 命中 Ready/in-flight 原先不落账本，必须补认领。现有 SQLite registration 测试把第一次 `putMutationAttempt` 当 settle，本批增加 admission 后必须把旧注入和预期明确改成阶段语义。与方案 A 的差异是无需额外结算观察 receipt，采用 Pending 加实时 context 观察即可保持闭环。

## Decision Log

- 2026-10-28：人类在本轮 #431–#433 评审会话明确要求无 P0/P1 或只有 P2/P3 时“你负责后续：三思后修复 → re-review → 归档 ExecPlan → … → merge_method=rebase 合并”。本 PR 经首轮 APPROVE 后由该评审会话收尾；授权覆盖本 PR，不涉及规划 Status 或依赖改写。审查证据见 `docs/review/pr-432-mmp-review.md`。

- Decision：保留原字符替换正则，仅用单调索引循环和 slice 裁剪首尾连字符。Rationale：有界 Worker 在合法长内部连字符输入上复现 5 秒超时，短语义表仍通过；循环对首尾各走一次，既消除反复尾匹配，又不增加输入限制、不改默认值、不中和退化拒绝、不抑制告警。Date/Author：2026-10-28 CodeQL 跟进 / 实施者。

- Decision：局部证据矩阵去掉本 issue 已修复的反例，但保留更大产品/发布门的未证实范围。Rationale：独立验收覆盖本闭环，不自动批准 R1、Board 或 #143；历史统计标注观察日期而不冒充当前汇总。Date/Author：2026-10-28 10:09 SGT / 交付协调者。

- Decision：保留既有 context 能力拒绝后的原恢复语义作为明确例外。Rationale：完整回归 R2/R3 要求 Failed 与已决定分支如实返回、失效工作树句柄清除；这些是旧 context 的恢复观察，不是新获准的外部操作。全部清理先经事务内同键复核，异请求仍零修改；拒绝不占新键、不调用外部写，新 context 拒绝零修改。该边界由父任务审定，R2/R3 原断言保持不变。Date/Author：2026-10-28 / 实施者、交付协调者。

- Decision：授权 GitHub 元数据已写入并回读。Rationale：actor `SingularityKChen`，目标同仓 PR #432 / issue #194、Project #10，幂等关联键 `delivery-20261028-194`；PR closing 与 issue closedBy 双向一致，未写规划 Status 或依赖。Date/Author：2026-10-28 09:25 SGT / 交付协调者。

- Decision：现有账本不可变指纹 + 原认领事务，固定 primitive JSON 元组。Rationale：闭合 key/context 两种锁域，无第二权威或通用平台成本。Date/Author：2026-10-28 09:18 SGT / 最终设计审读者。
- Decision：Pending 精确回放不接管；观察 receipt 可保持 Pending。Rationale：同键从不重复外部创建，同时不会缓存过期在途答案；恢复沿用新 key。Date/Author：2026-10-28 09:18 SGT / 最终设计审读者。
- Decision：所有目标不可确定的已有键回放统一冲突；首次路由拒绝不消耗键。Rationale：旧意图不可被新配置解释，未获准请求不建立耐久操作。Date/Author：2026-10-28 09:18 SGT / 最终设计审读者。
- Decision：直接修订当前 schema，不做历史兼容；不修改 #414 loader。Rationale：用户明确尚未正式发布；并行 owner 的架构边界优先。Date/Author：2026-10-28 09:18 SGT / 用户授权、最终设计审读者记录。
- Decision：自治继续 draft→TDD→ready，不改 Status、不合并、不代替 #143 人类走查。Rationale：本任务授权与规划事实所有权边界。Date/Author：2026-10-28 09:18 SGT / 用户授权、最终设计审读者记录。

## Idempotence and Recovery

读检查、测试与 fresh DB fixture 可重复。事务回滚则键未被消费；已提交 Pending 即使进程中断也保留第一次身份。ack 后本地失败留下现有 context/句柄和 Pending，不删除远端资源，不盲重试；相同键只观察，新键依原租约恢复。开发库先备份，schema 直接修订后只用新临时库或恢复原备份，不让不同结构二进制混用一个库。Git 整批 revert 是恢复点，force/清理遵循专家流程与 backup ref。

未接受新的技术债。#306/#307 的 envelope/控制器生命周期、#420 fencing 与 #414 旧物理形状拒绝是既有独立范围，不算本批已完成。若实施为预算刻意延期本闭环必要验证或守卫，必须先收敛设计；其它明确接受延期按 `docs/exec-plan/tech-debt-tracker.md` 记录并关联本计划。

## Interfaces and Dependencies

使用仓库 Node >=22、pnpm@10.28.2、现有 Fake/SQLite 与 Storage transaction，无新依赖或凭据。专用 helper 不导出公共包 API。`MutationAttemptRecord.requestFingerprint` 是唯一新增持久字段；ProjectError 复用 Conflict 与固定 reason，冲突报告用现有 `reportFor`/`toResult`，不借 `startWorkUnavailable` 产生错误 phase。公开 GitHub 写入由父任务当前 actor 执行，目标为同仓 issue/PR；PR 关联 #194 即本批幂等关联，不把内部请求/测试数据发布到描述。

## Outcomes & Retrospective

2026-10-28 MMP 初审 review 5678411084 为 APPROVE，无新增 P0–P3；独立交叉复评收尾文档亦无问题。产品/测试 blob 与初审 `2ae4166` 相同，评审证据随 PR 交付；3 项文档契约通过。最终 head/base/checks/threads、issue 验收和 rebase merge 的远端收据写在对应 PR/issue，不用本地预期替代 API ack。

2026-10-28 10:53 SGT CodeQL 补丁独立复评：锁定 `d8b97f80` / tree `8958f78c`，102 项相关测试、19,608 个短输入旧新语义对照及3个百万连字符边界输入、类型检查均通过；独立旧表达式 Worker 再现5秒期限失败。无 P0–P3 或必要重构项。组合检出 `test/iteration-8-9-integration` @ `5792f2a` 完整 `pnpm verify` 为2226主测试+7MVP，零失败/取消/跳过。下面旧2177/2224及约460行记录只属于其标注阶段，Superseded by 本段与 CodeQL 跟进结果；当前规模以 base 差异重算。最终 hosted CodeQL、PR head/base/threads 与 ready 仍按本计划命令实时回读，不由本地通过推定。


2026-10-28 CodeQL 跟进本地结果：在 hosted head `bea6aa34905896172970836774b4b633f8a0a4fb` 上，合法长内部连字符输入的有界 Worker 测试先失败（5 秒），语义表先通过；以首尾单调索引与 slice 替换后，102 项相关回归通过，源码冻结后的 `pnpm verify` 为 2179 主测试 + 7 MVP 全绿、含类型检查。循环在首尾各扫描一次，避免每个内部连字符重复尾匹配；不增加输入限制或改变身份/命名结果。此本地修复不等于 hosted CodeQL 已通过；远端最终 head 的安全门由父任务重跑和回读。

以下 10:09 记录是当时已验收闭环的观察；其“无待修”范围 Superseded by 本节 CodeQL 跟进结果（2026-10-28）。

2026-10-28 10:09 SGT 实施验收结果：本闭环全部 AC 已完成独立验收，锁定实现 `fd0afeff` / tree `6c4d804a`；独立执行402 项聚焦测试、9 项边界和6个独立临时探针及类型检查均通过，无待修 P0–P3 或必要重构项。实现完整验证为2177主测试加7个MVP，零失败/取消/跳过。组合检出 `test/iteration-8-9-integration` @ `17efb3b` 已无冲突拼合同批三个实现并通过 `pnpm verify`（2224主测试+7MVP）；该组合是本地协同证据，不替代各 PR 的 hosted CI。最终 PR #432 的 head/base/checks/issue/threads/ready 用本计划命令回读，未宣称合并、规划接受或 #143 人类验收完成。

以下阶段回顾保留，Superseded by 本节实施验收结果（2026-10-28）。


2026-10-28 09:18 SGT：完成设计收敛，未实现产品代码、未宣称产品测试通过。产品完成以 Validation 表与最终 head 证据为准。Superseded by 本节下段实施结果（2026-10-28）。

2026-10-28 实施结果（分支 `fix/start-work-request-binding` 工作树根）：完整请求 primitive 快照和不可变指纹由 `mutation_attempt` 唯一持有；首次认领同事务写 Pending 与父行/context；精确 Pending 只观察；供应使用事务选定 route。新增请求用例 20/20，通过 SQLite 真 close/reopen、双句柄跨 context barrier、事务各写点回滚、调用方改对象、绑定漂移/歧义/恢复、无关挂载与冻结供应目标验证。共享契约拒绝换 command/binding/fingerprint 和对象别名绕过，允许 state 推进。R2/R3、#219 与 ack 后 Unknown 的原断言保留。

`pnpm verify` 最终产品树运行 exit 0：契约/集成/E2E 2177/2177，MVP 7/7，含 typecheck；`pnpm boundaries` 重跑 9/9（首次独立启动触发 pnpm runtime 无 TTY 环境错误，直接重跑通过），workflow-check 无发现。提交前扫描包含暂存差异；提交后再对 `origin/main...HEAD` 运行 disclosure/size 与 diff 检查。当前代码/测试规模按增删合计预估约 460 行，最终值由同一 base 重算；文档低于预算。未引入新技术债；旧 schema 文件不迁移的产品边界、#420 fencing 与 #414 loader 的边界维持 Design。独立验收与远端 checks 尚未由实施者完成，不代报 ready。

### Artifacts and Notes

正式产物是本 ExecPlan。结构 lint 首次发现技能通用模板要求 Concrete Steps/Artifacts and Notes，已作为从属章节补齐，保留 `PLANS.md` 的强制顶层顺序；第二次语义审读已逐项核对结果、路径、证据、风险、恢复、债务与决策，结论 pass。`lint_execplan.py` 磁盘检查输出 `OK: ExecPlan passed lint checks.`（exit 0）；这是文档验证，不是产品验证。

## Bottom Change Note

2026-10-28 09:18 SGT：依据 issue、两份独立方案和实际源代码建立最终计划；收敛为原账本原子认领、Pending 实时观察、最小路由抽取，并保留独立评审的行数空间。

Change Note (2026-10-28 09:20 SGT)：磁盘回读后补齐从属操作/证据章节、draft 前置双向关联与 SQLite 竞争 barrier 边界；顶层章节遵循仓库 PLANS.md。

Change Note (2026-10-28 09:25 SGT)：记录 plan-only draft #432 与机械元数据 ack；允许实施者开始 RED。

Change Note (2026-10-28 实施)：记录 RED/GREEN 与全套首轮失败，补齐实际 fixture 所有权；保留 draft ack，完整验证仍在进行。

Change Note (2026-10-28 回归修复)：将既有 context 能力拒绝后的观察结算明确写入 Design/Decision Log；R2/R3 验收保持不变，路由并发仍拒绝并不占键。

Change Note (2026-10-28 本地验收)：记录最终产品树完整验证、20 项请求测试与逐步事务回滚；Batch 3 的远端和独立审阅门仍由父任务完成。

Change Note (2026-10-28 10:09 SGT)：独立验收通过后归档，补工程证据与父计划/矩阵/索引；公开面与最终远端门仍以当前分支回读为准。

Change Note (2026-10-28 CodeQL 跟进启动)：登记命名性能测试所有权与安全门失败；不关闭或抑制告警，保持既有命名与退化拒绝语义。

Change Note (2026-10-28 CodeQL RED→修复)：短输入语义表通过，合法百万内部连字符 Worker 超时为 RED；据此将原首尾裁剪替换为线性索引循环与 slice，待完整验证。

Change Note (2026-10-28 CodeQL 本地验证)：冻结最小源码后完成 102 项聚焦与 2179+7 完整验证，补有界 RED/GREEN 和独立 hosted 安全门边界；不修改其它 PR 文件。

Change Note (2026-10-28 10:53 SGT)：记录命名补丁的独立复评与更新后的组合2226+7证据；收敛为同一可回滚提交，等待最终远端安全门。

- 2026-10-28：补 MMP 评审与交付授权；无产品修复，保持原实现证据与已归档路径。
