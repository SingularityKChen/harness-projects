# Core namespace 与 DeliveryScope 单契约 ExecPlan

> 状态：Completed；创建：2026-11-03；规范：根 `PLANS.md`。
> 闭环：Closes #418；Refs #224。
> 执行上下文：检出 `chore/core-namespaces` 的 `.worktrees/core-namespaces` 根目录；独立以 `main` 为 PR base，无 stack 前提。

## Purpose / Big Picture

生产调用者只面对普通 `core.queries` / `core.commands` 对象和显式对象 DeliveryScope。链路仍能经过工作区、规划、Start Work 与交付事实；不再为了链测试 helper 使 namespace 本身可调用。成功证据是对象接口的真实链路、无效旧输入的结构化拒绝、缺节点明确诊断及两壳相关合同通过。

## Context and Orientation

调查基线为 2026-11-03 SGT 的 `main @ f5ae377d98c43ed216f680cb72e5f35d73a2b8e1`。`CoreNamespace<T> = T & (() => T)` 和 `namespace()` 将成员对象 assign 到函数；实际生产调用使用 `.queries.method()` / `.commands.method()`。MVP0 的 `needMethod` 在每个路径段都要求 function，正是无业务必要可调用性的来源。

DeliveryScope 目前是 `string | DeliveryScopeInput`，`normalizeScope` 把字符串转成 `{ workItemId, repositoryId: undefined }`。Host 现用对象调用，controller 引用该类型；旧字符串正例仍在测试。`EdgeProvenance.ChainSkeleton` 只有声明，但 `chain-facts.ts` 的真实未观察节点/缺口仍被读取。删除未使用常量不意味着删真实 missing-node 行为。

## Design / Spec

采用直接收敛当前契约。`CoreApi.queries` 类型为 `CoreQueries`、`commands` 为 `CoreCommands`；正常和 unavailable 组合根直接返回普通对象，删除 callable 类型与包装器，不加 overload/adapter。终端方法名、参数、返回、Host codec、执行/规划语义保持原合同。

`DeliveryScope` 保留现有导出名，采用 `repositoryId` 可省略的对象接口；内部 `DeliveryScopeInput` 归一后显式持有 `repositoryId: string | undefined`。一个现有归一化/守卫入口共同服务查询与命令：只从对象读取声明字段；string、null、undefined、数组、空白/非字符串 workItemId、错误 repositoryId 类型返回结构化 invalid_input，不裸抛 TypeError、不静默接受旧字符串、不调用 Provider 或摄入事实。合法 `{workItemId}` 与显式 `repositoryId: undefined` 继续同义；有仓库的 scope 不丢仓库身份。unavailableCore 仍报告 not_supported，而非假成功。

链 helper 逐段检查存在，只在末端检查 callable；缺中间 namespace、缺末端和末端非函数仍输出指定节点与完整路径的 assert 诊断。修注释中的已过期“必须失败”陈述，保留完整轨道断言。建立生产/fixture 消费者清单后删除确无用的 ChainSkeleton 成员，保留当前实际使用的 hop 字段与缺口算法。

两个独立设计都支持以上最小路线。放弃新的严格 parser 状态机与 delivery 整体类型重写：现有 normalize/guard 足以在入口拒绝非法值，重做增加接口半径；放弃保留 callable factory 或 runtime string 兼容：未完成 issue 的单形态闭环。没有旧实验 API 的兼容义务，也不借清理删除真实数据/行为。

## Global Constraints

Core namespace/delivery owner 独占本批；不修改 start-work、execution-run、其存储边界及对应恢复测试，因而与 #458 无共享写区。允许文件集只在此声明：`packages/core/src/context.ts`、`packages/core/src/delivery.ts`、`packages/core/src/queries.ts`、`packages/core/src/relations.ts`；`packages/core/src/delivery-facts.ts` 仅随入口类型需要调整；`packages/controller/src/queries.ts`、`packages/controller/src/commands.ts` 仅随引用类型需要调整；`tests/mvp0/chain.test.js`、`tests/e2e/controller-roundtrip.test.js`、`tests/e2e/delivery-lineage.test.js` 与本计划。现有 root index 自动 re-export，无证据不另改出口；其他真实 caller 若发现必须先补本集合及预算。索引允许在 `docs/README.md` 为本计划写一条记录，由集成 owner 串行更新；实施者暂不编辑。

代码/测试/config/fixtures additions+deletions 预计 200–470，必须 ≤800；文档预计 180–320，必须 ≤1300。不为预算填行，不机械拆算法、不删安全案例。保持包依赖方向、Provider ack/reconcile 前无 Saved、规划与执行正交、Host 权威、真实缺口与无效输入拒绝。无依赖、schema、数据、路由或 Host ABI 迁移；不得兼容旧形态或删除用户数据。

## Plan of Work

### Batch 1 · 消费者清单与 draft

主文件为本计划。回读 #418 当前 scope；搜索 callable 与 DeliveryScope 生产导出/调用，把真实调用和可替换 fixture 分开。确认无需 namespace 调用兼容；核查 ChainSkeleton 只有定义。提交计划并开独立 draft，回读 base=main、head、draft、关联 #418 后才改实现。

执行 `gh issue view 418 -R SingularityKChen/harness-projects --json title,body,state`、`rg -n 'CoreNamespace|ChainSkeleton|DeliveryScope|\.queries\(|\.commands\(' packages apps tests --glob '*.{ts,js,mjs}'`，期望每个命中有明确处置；真实 missing-node 不在删除范围。回滚点为计划提交，无业务变化。

### Batch 2 · 判别性红绿与单契约实现

主文件为 context/delivery、chain helper 及两项 e2e。先写断言证明正常/unavailable namespace 都是 object 且终端 callable；用普通对象正控跑完整链，负控覆盖缺 namespace、缺叶子/非函数叶子；字符串与各类非法 scope 在 query/command 都结构化拒绝且不摄入事实；合法对象、多仓选择与纯读继续成立。

保存当前失败断言后删除 callable 包装和 string 兼容、调整真实 callers/fixtures、删除无消费者常量。执行 `pnpm test:file tests/mvp0/chain.test.js tests/e2e/controller-roundtrip.test.js tests/e2e/delivery-lineage.test.js`，期望全部 pass；临时重加 string 分支或恢复 helper 每段必须 function，分别应让 string 拒绝/普通对象链断言失败，撤销负控后重跑。用例不能以导入错误当业务红，不能靠删除轨道断言过关。回滚该批完整 API/test 提交，不碰数据。

### Batch 3 · 类型、两壳与交付

主文件为本计划的执行记录。执行 `pnpm run typecheck`、`pnpm run boundaries`、`pnpm test:file tests/e2e/workspace-read-assembly.test.js tests/integration/harness-plugin-start-work.test.js`，期望两壳装配与原参数/返回合同通过。没有新失败或跨边界风险信号时不为凑证据扩大重构；有失败先定位该 API 收敛是否根因。

整理 commit 后执行 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`，并用 Git argv 执行 `git diff --check origin/main...HEAD`；期望本计划体量和发布面均通过，人工完成五类目扫描。push 后执行 `gh pr view chore/core-namespaces -R SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,statusCheckRollup,closingIssuesReferences,reviewDecision` 与 `gh pr checks chore/core-namespaces -R SingularityKChen/harness-projects --required`，按 `docs/review/README.md` 分页回读全部 review threads。以最终 head 的真实验证为准才 Ready，交用户评审、不合并。回滚整个 PR 恢复前一 API，无迁移补偿。

### Review repair · 2026-11-04

依据 `docs/review/pr-530-mmp-review.md` 的唯一 P2 及用户已授权的修复/复评/合并流程继续本计划。比较扩大所有入口 catch 与收紧现有 normalizeScope 隔离：选择将 Array.isArray 纳入现有 try/catch。四入口 revoked Proxy 判为 invalid_input、Provider/Storage 零副作用；不增加兼容层。
验证：在本分支先跑新增判别用例，修复后重跑相关测试/归因变异；独立复评通过后归档本计划，整理提交，回读当前 head 检查。回滚：恢复原 head 的引用；产品修复与本能力保持同一可回滚边界。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 正常/unavailable namespace 均为普通对象，叶子仍可调用 | typeof 正反控制、完整 MVP0 chain |
| 显式对象是唯一 DeliveryScope；旧字符串/非法值拒绝 | controller/core query+command invalid_input、0 Provider/事实变化；恢复 string 分支负控失败 |
| missing namespace/leaf 不变 TypeError | needMethod 指定节点与完整路径诊断；每段 callable 负控失败 |
| 真缺口、多仓隔离、只读投影和刷新摄入保留 | delivery-lineage/controller-roundtrip 既有判别测试 |
| 删除的只有无消费者实验形状 | 生产/fixture 清单与 rg 回读；chain-facts 真缺口未改 |
| 两壳与包边界保持，可独立 review/revert | typecheck、boundaries、两壳测试；最终 PR metadata/checks/threads |

## Progress

- [x] 2026-11-04：P2 red/green、Storage计数盲点修正、独立复评及最终8项归因变异通过；计划归档。当前发布head/checks与merge仍按回读门执行。

- [x] (2026-11-03 17:18 SGT) 独立审读源码与两设计，确定单契约与 disjoint ownership。
- [x] (2026-11-03 17:31 SGT) Batch 1：已在 `chore/core-namespaces` 检出确认 #418 仍 OPEN，标题与对象 API/DeliveryScope 范围一致；父任务已提供计划 commit 与 draft PR #530 的 base/head/draft/关联回读。当前生产调用均是 `core.queries.method()` / `core.commands.method()`；Host delivery 调用传对象。链测试 helper 只服务 fixture。`ChainSkeleton` 在生产源码只有 `EdgeProvenance` 定义，真实 missing-node/gap 在 `chain-facts.ts` 和 `delivery.ts`，保留未动。
- [x] (2026-11-03 17:31 SGT) Batch 2：先观察红（旧 namespace 为 function，helper 将 `queries` 报缺失；旧 string scope 刷新得到 `local_only`）。实现后目标测试 64/64 通过；恢复 string 归一的反控在 `core-namespaces-string-negative.log` 以 `local_only` 对 `invalid_input` 失败；恢复逐级 callable helper 的反控在 `core-namespaces-helper-negative.log` 因对象 namespace 失败。反控改动已撤销。
- [x] (2026-11-03 17:32 SGT) Batch 3 本地门禁：当前 working diff 代码/测试 109 行增删、文档 100 行增删；typecheck、boundaries 9/9、两壳 35/35、目标测试 64/64 通过，`git diff --check origin/main` 通过。待集成 owner 整理提交后执行发布面与远端 PR metadata/checks/threads 回读，再决定 Ready 和请求人类评审。
- [x] (2026-11-03 17:47 SGT) 独立 review P2 修复：给 accessor `{ get: undefined, set: undefined }` 加四入口（Core/controller query/command）回归，先分别复现 Core 与 controller command 未返回 `invalid_input`；按 descriptor 自有 `value` 字段修复后验证目标 64/64、typecheck、boundaries 9/9、两壳 35/35 通过。当前相对 `origin/main` 的工作 diff 是代码/测试 115 行、文档 104 行增删。详细输出见 `.superpowers/iteration9/core-namespaces-accessor-red.log`、`core-namespaces-accessor-core-red.log`、`core-namespaces-accessor-green.log` 与 fix report。

- [x] (2026-11-03 18:03 SGT) 独立复评在代码快照 `1e37713705fb389f9ea6cedc485bef17c67fbb57` 通过；唯一 P2 已关闭，未发现新增阻塞。
- [x] (2026-11-03 18:15 SGT @ `e3b929d2f7c8bf565e17a1fdca0243bef5e883e7`) 已收敛一个能力提交，发布面与体量通过；远端 main/base、Closes #418 和全部线程回读（0 线程）一致，PR Fast Gate、Verify、Browser、Merge Gate、Issue policy 与实际 size/disclosure 检查通过，PR #530 已 Ready。仅归档路径和索引随后更新；再次 push 后仍按 Plan of Work 回读当前 head。

## Surprises & Discoveries

2026-11-04 Review repair：修复把 Array.isArray 纳入已有 try；正式四入口回归先红后绿，另以 getWorkspace 正控发现并纠正 Storage 原型方法计数盲点。69 项相关、typecheck 通过；独立机制 8 项与最终8项归因变异全通过，包含错误拒绝前意外 Storage 读的负控。协调者最终四入口5项及typecheck再次通过。

消费者清单：`rg -n 'CoreNamespace|ChainSkeleton|DeliveryScope|\.queries\(|\.commands\(' packages apps tests --glob '*.{ts,js,mjs}'` 中无生产 `.queries()` / `.commands()` 调用；生产 caller 以成员方法调用普通 API。Host 的 `assertDeliveryScope` 与 client 只传 `{ workItemId, repositoryId }` 对象。旧 string 正例只在 `tests/e2e/controller-roundtrip.test.js` 的 scope forms fixture；由对象等价测试取代。`ChainSkeleton` 只在 `packages/core/src/relations.ts` 定义，生产和 fixture 无消费者；相近名字的 `chain-facts.ts` 未观察节点与 delivery gaps 是真实行为，完整保留。TDD 日志位于忽略的 `.superpowers/iteration9/`，不是正式文档。

#418 的较早 Post-Core/远期描述已被 2026-10-29 iteration 9 forecast 更新，本轮工程选择不据此自动写看板 Status。

独立 review 在 `normalizeScope` 发现一个 descriptor 边界：只比较 `get`/`set` 是否非 `undefined` 会接受 `Object.defineProperty(scope, 'repositoryId', { get: undefined, set: undefined })`，并把 accessor 误当成合法缺省仓库。该输入先由 e2e 回归稳定复现；修复改为检查 descriptor 自有 `value`，同时原有 `{ repositoryId: undefined }` data property 正例保持通过。没有扩大 normalize/parser 结构。

## Decision Log

2026-11-04 / 协调者：用户在本次 PR #529–#531 评审请求中明确授权只有 P2/P3 时本会话修复、独立复评、整合和 rebase merge；采用上述最小修复，不重复请求批次许可。

- Decision：保留 DeliveryScope 名称为对象 alias，直接移除 callable/string 运行时兼容。Superseded by 本节可省略仓库字段的接口决策（2026-11-03）。Rationale：只收敛形状，避免无价值 rename 和 parser 重写；对无效值仍 fail closed。Date/Author：2026-11-03 SGT / 综合评审。
- Decision：保留真实 hop/缺口算法，只有清单证实无用的 ChainSkeleton 成员可删除。Rationale：符号清理不能替代关系事实与可定位缺口验收。Date/Author：2026-11-03 SGT / 综合评审。

- Decision：外部 DeliveryScope 用可省略仓库字段的普通接口，内部规范对象仍保留显式 undefined 字段。Rationale：保留合法省略参数的 TypeScript 合同，不为名称 alias 迫使调用者写冗余字段。Date/Author：2026-11-03 18:03 SGT / 交付协调。

## Idempotence and Recovery

搜索、类型检查与测试可重复，测试只操作自己的临时数据。Git 用 argv/library API；先确认本任务状态再提交，不混入其他工作树改动。需要共享历史整理时先建恢复 ref，再按根规则使用精确 lease；禁止直接 push main。任一真实 callable/string 生产调用推翻清单时，回到 Batch 1 更新规格/预算，不能临时加兼容绕过。回退按整个独立 PR 执行，无用户数据删除与数据库处理。

## Interfaces and Dependencies

使用现有 TypeScript/Core/controller/两壳，依赖现有 pnpm 与 Node；无新增包或 Provider 凭据。CoreApi 的查询/命令叶子合同与 DeliveryScopeInput 字段名不变；外部 Host ABI 不改。GitHub 登录仅用于已授权 draft/metadata 回读。Planning Status、Engineering、native blocking 关系不由本批工程事件推进。

## Outcomes & Retrospective

2026-11-04 Review repair：唯一P2已修复且经独立复评，无新增发现。69相关与8项最终变异、真实Storage计数正控及协调者5项回归/typecheck通过；本次归档只表示本能力修复与评审完成。最终push后必须重读PR #530当前head/base/PR Fast Gate/issue/threads并取得当前head批准，才能按本会话人类授权合并。

原交付完成状态 Superseded by 本次 Review repair（2026-11-04）：原产品范围保留，P2 修复、复评与当前 head 门禁未完成前不合并。

本批实现已完成：`CoreApi` 正常与 unavailable 组合根返回普通 query/command 对象；`DeliveryScope` 是对象形，入口只接受已知数据字段并对字符串、null/undefined、数组、空白/非字符串 id、非法 repository、额外字段与存取器返回 `invalid_input`；查询与刷新共用归一/守卫，合法缺省 repository 仍可用。链 helper 按节点存在性遍历，只要求叶子 callable，并保留节点与全路径诊断。删除无消费者的 `ChainSkeleton` provenance 常量，没有改真实链缺口算法。

本地结果：实现阶段 working diff 原为代码/测试 109 行、文档 100 行；独立 review 发现的 undefined-accessor P2 已按 descriptor kind 修复，当前相对 `origin/main` 工作 diff 为代码/测试 115 行、文档 104 行，低于 800/1300 任务预算。目标链/controller/lineage 命令通过 64/64；`pnpm run typecheck` 通过；`pnpm run boundaries` 通过 9/9；两壳命令通过 35/35；`git diff --check origin/main` 通过。独立 P2 已在实现检出修复，并在独立检出 `1e37713705fb389f9ea6cedc485bef17c67fbb57` 定向复评通过：四入口拒绝该访问器、零 Provider 调用、整库不变，合法 data descriptor 保持有效；目标 64/64、独立 3/3 与类型检查通过，旧实现变异被杀死并恢复。上述为该代码快照的历史证据，可按 Plan of Work 命令重算；发布面、远端 head/checks/threads 回读与 Ready 已在上述发布快照完成；本计划已移入 `completed/` 并更新索引。归档后的当前 head 必须按 Plan of Work 再回读，不能复用旧 head 结论。当前未发现需要登记的技术债。

## Bottom Change Note

Change Note (2026-11-03 SGT)：由两个独立设计收敛 #418 的普通 namespace/object scope 规格，补充非法 scope 与链 helper 负控、真实缺口保护及独立交付边界。
Change Note (2026-11-03 17:31 SGT)：记录 #418 消费者清单、实际实现、红绿/反控日志和本地验证结果；发布面与远端 PR 门禁仍待集成 owner。
Change Note (2026-11-03 17:33 SGT)：记录当前 working diff 的实际代码/测试与文档规模，以及最终 fresh 类型、边界和两壳验证。
Change Note (2026-11-03 17:47 SGT)：按独立 review 修复 undefined getter/setter accessor 被误当成合法缺省 repository 的 P2，并记录先红后绿和复核结果。

Change Note (2026-11-03 18:03 SGT)：记录独立 P2 复评，按实际可省略字段接口同步规格；最终远端发布门仍未标完成。

Change Note (2026-11-03 18:15 SGT)：依据发布快照 `e3b929d2f7c8bf565e17a1fdca0243bef5e883e7` 的实际 hosted gate、双向 issue 关联和 Ready 回读归档；保留用户 PR 评审与规划接受边界。

2026-11-04：依据独立 MMP 评审重新打开计划，记录最小修复方案和 red/green/复评门。

2026-11-04：补充评审修复的实际 red/green、正式回归与最终归因变异；归档和发布等独立复评完成。

2026-11-04：独立修复复评通过后再次归档；保留最终发布/merge门，未将本地证据冒称托管CI。
