# 持久 PR 命令与原操作恢复 ExecPlan

> 状态：Completed（本轮 P2 已修复并独立复评；最终发布按当前 head 回读）；创建：2026-11-02；Closes #494；Refs #437。
> 按根 `PLANS.md` 维护；本 PR 交付独立 Core/controller 能力，不关闭 #437；原详情计划的单 PR 规模结论由本计划与详情修订版取代。

## Purpose / Big Picture

受信 controller 消费者可用正式 GitHub adapter 创建一次 PR；丢响应与 SQLite 重开后，仅凭当前授权 scope 与不透明 operationId 发现、读取和恢复原操作，不需要原正文、原 peer 或重建 create 请求。恢复在结构上不能 dispatch。收据、原生身份与精确显式谱系共同确认，刷新失败与当前目标变化仍如实报告。Host/详情入口由独立上层 PR #491 交付。

## Context and Orientation

源快照固定为 `feature/pull-request-detail-creation@0232ad484fa69a6cba3ca8ac357e0dc108618194`，来源 base `554e6fefb1ad9781becf879b9f96e367e9f6ceff`。2026-11-02 作者报告顶部记录：clean、code/test/config789 A+D、docs121、完整 verify2778+7、相关194、独立探针8/8；这些是作者证据，本计划未重跑。F1/F2/F3/F5 窄修已落，两个新增探针尚未成为永久测试，F4 完全未实现；旧 artifact digest 不对应此 head。789+永久20–28+F4至少90–140已超单 PR799，已批准只新增一个 child 与现491组成两层，总4 issues/4 PRs。

当前状态机位于 `packages/core/src/create-change-request.ts`，已有 pending/单次 mutation/marker 全页唯一对账；typed intent/SQL CHECK 是单一当前物理合同。当前 relations owner 已能 candidate→explicit/confirmed，Core 已按实际 PR set 判断 lineageStale 并在最后刷新后复核 scope。不能将这些已修路径退回旧 c2f 快照。Actual OperatorPeer.id 是 randomUUID 的 Connection 生命周期审计身份；它不是稳定人类或权限 principal。原请求身份不可因此换写。

## Design / Spec

2026-11-02 P2 修复：稳定 worktree 的历史显式 PR 边继续保留；刷新以当前 context/generation/head/worktree 的 durable create operation 及 confirmedRef 限定 exact 显式边，不按分支/SHA、顺序或时间重新猜身份。当前多个 operation、未决 operation 或缺失/外来 confirmedRef 都保守 gap。当前 target 谓词抽为仅依赖类型的叶子模块，由 query/resume 与刷新共用，避免 chain-facts → create → delivery-facts 的循环。原读门与 native identity 复核保持。

保留一个 Core create/resume 状态机与 **Core 内唯一 post-create/reconcile 刷新协调者**。创建先持久 pending，再调用正式 adapter 一次；same-key actor/payload 精确绑定继续保留。resume 先解析已存 operation，再只调用 exact list/get 与原 receipt/关系结算，根本没有“找不到就登记并创建”分支；私有观察函数仅接收 `Pick<DevelopmentProvider, 'listChangeRequests' | 'getChangeRequest'>`，不得接收 create 回调/provider write port。create 的 existing 分支与 resume 共用观察器，不能遗留另一套“重输完整字段”恢复协议。

原 intent 的 actor、fingerprint、key、marker、input 永久不变。新被 Host 接纳的 observer 按当前工作区可见性、仓库挂载、原 binding 的 repository-read/PR-read 与当前 target 授权观察；不要求 observer 等于 creator，不建立人类映射。peer-B 用 peer-A 的旧 **create key** 仍 Conflict。operationId 是 attempt.id，仅为 scoped selector，不能绕过授权。读取门适用于每次恢复；create-write 只约束首次 dispatch，撤写权而保留读权仍能恢复。

新增纯本地 operation query：所有读取通过同一个 local resolver 校验 command/op、workspace/context/repository、原 binding、严格 canonical fingerprint 与 intent 一致性，拒绝畸形/不一致记录；绝无 Provider I/O、receipt/关系/事实/修订写入。Superseded：原“无id仅未决、Saved只按精确id”漏掉整份成功响应丢失。无id候选为同context全部pending/unknown（旧target仍保留）并上复用同一currentTarget谓词精确匹配的Saved；历史Saved的generation/head/worktree任一不同即不参与，failed/conflict仍exact-ID-only。对整个并集计数：0为none，1经原binding读门/完整canonical与intent校验后为operation，多个blocked/ambiguous，绝不取first/latest。读取失败或匹配当前目标的坏Saved不能当none。指定id仍只能取同scope精确操作；target已变时currentTarget=false，不向当前详情冒称确认。非法授权只给固定 blocked/unavailable，不泄漏历史摘要。

F2 的关系升级留在 relations owner，并与 saved receipt 同事务：仅精确 PR→worktree triple 的 candidate 可升 explicit/confirmed；已有确认不降级，ProviderRead不提升，无关边不变，Superseded：原评审所述rejected运行态不是当前合同；domain与Fake/SQLite只接受candidate/confirmed。两Store写前拒绝不支持状态，原关系不变；不新增enum/DDL。既有人工confirmed保留确认，并由当前显式命令提升同一精确关系来源。

F3/F5 保留真实刷新 await，不能通过移走 listBranches/refresh 让旧探针不命中。刷新结束后，**最后一个 awaited 短事务**同时核对当前可见性、仓库挂载、原 binding 读门、target、receipt，并读取当前 DeliveryFactsRecord。target 是 workspace/workItem/repository/context/generation/head/worktree/original binding；targetStamp 为此 tuple 的不透明稳定摘要。变化时返回非权威 Conflict，原 Saved/confirmedRef 不动。lineageStale只看 exact worktree anchor 的 change_request set：stale=false、confirmedAt存在、nodes包含原 entityId/ref 才为false；503/未确认/错身份为true。旧刷新 applied=false **不单独决定陈旧**：读取最终赢得的快照，若新赢家已确认同 PR 则false；仅 pipeline/check 缺口不误报 PR 未刷新。此事务是明确的观察线性化点，不承诺响应离开后状态永不变化。

creator/resumer 竞态必须单调：原 create 已接受但 ack 被hold，另一个合法 observer 恢复并 Saved；原 create 迟到 ambiguous/definite failure/ack 不得降级 Saved、覆盖 confirmedRef/新快照，返回当前原操作的安全结果。结算比较完整 attempt/intent/target 快照；已变化则读取当前结果，不拿旧 attempt spread覆盖。无新 lease、第二账本或第二 mutation。

## Global Constraints

分支 `feature/pull-request-command-recovery`，工作树 `.worktrees/pull-request-command-recovery`，以重新回读的 main 为 base；现491稍后以其冻结head堆叠。代码/测试/配置每 PR严格<800、docs<1300；本层预测730–790，目标≤780留余量，实际达到790即审查剩余范围，不再挤压单PR。独立子 issue 为 #494；不新增第二child，不改Planning Status/native blockers，不合并。 **Superseded by 本节本轮规模与 Decision Log 的合并授权（2026-11-02）**。

本轮以用户当前提供的根 `AGENTS.md` §6 代码变更≤1000为硬门，文档仍<1300；当前最小修复候选代码/测试/配置841 A+D，超过原<800预测，保留实际Start Work跨代际、同SHA decoy、真歧义与原路径的判别性回归，不删测试或机械挤行，也不为预测数字拆出无法独立验收的半闭环。最终rebase后重新计量；若超过1000则重新细化交付，不自行放宽。

本层唯一允许文件集：`packages/core/src/change-request-target.ts`（本轮 P2 的纯 target 谓词）；`packages/core/src/create-change-request.ts`、`packages/core/src/context.ts`、`packages/core/src/queries.ts`、`packages/core/src/index.ts`、`packages/core/src/relations.ts`、`packages/core/src/chain-facts.ts`；`packages/core/src/start-work.ts`仅保留源快照已有commandName谓词，与#193由执行owner按当前base串行合并；`packages/controller/src/commands.ts`、`packages/controller/src/queries.ts`；`packages/capabilities/src/storage.ts`；`packages/providers/fake/src/storage.ts`；`packages/storage/sqlite/src/storage-execution.ts`、`packages/storage/sqlite/src/storage-rows.ts`、`packages/storage/sqlite/migrations/003_control_facts.sql`；新 `tests/fixtures/change-request-world.mjs`（仅共享world/ready装配）；`tests/integration/create-change-request.test.js`、新 `tests/integration/change-request-operation.test.js`、`tests/integration/storage-baseline-admission.test.js`、`tests/e2e/delivery-lineage.test.js`（仅新增命令的精确caller清单）；本计划active/completed路径；docs/README.md由root串行维护。不修改Host/client/UI/正式Provider transport/ABI，不加迁移、兼容、outbox、auth平台。

提取前由root依git-expert-operations建立并验证 `refs/backup/pull-request-detail-creation-0232ad4` 指向上述完整789快照，并记录当前远端head作精确lease。所有Git用argv/library，路径realpath核对.worktrees。按 base554e6fe→源0232ad 的允许文件/精确hunk构造patch，应用到child当前base，不能全文件覆盖含无关修改的文件。每个 transferred hunk 与冻结源比对；变动只来自本计划修正。原 source/remote/其他工作树不重置。Host imports与原两项真实Host case必须从Core集成文件移至上层新Host测试，名称/断言建立一对一清单；共享fixture由本层拥有，不能把Host移除误报为验收删除或LOC节省。提取后Core测试不得import apps。

## Plan of Work

### Batch 1 · 保留已证修复并建立独立后端树

最小闭环：当前durable create经composed controller可调用，正式adapter/SQLite/显式谱系证据保留。主文件为Core命令、relations与集成测试。先验证backup/source/base，再受控转移全部本层文件，将world/ready提为唯一fixture，移出Host case到上层待应用patch清单。永久加入“新刷新supersede旧刷新完整读”“最后read后撤可见性”两探针的Core版，断言barrier确实命中、Saved保持、当前结果/PRset正确。运行 `pnpm test:file tests/integration/create-change-request.test.js tests/contract/development-github-create.test.js tests/integration/pull-request-identity-convergence.test.js tests/integration/storage-baseline-admission.test.js`，期望全pass，F1/F2/F3/F5原RED→GREEN证据沿源保留，不把转移重述成重新发现。回滚本层patch，backup与数据库不动。

### Batch 2 · 操作发现、结构无dispatch恢复与最后快照

最小闭环：新controller不需原输入即可discover/resume，new observer不改原actor。主文件为Core/Controller query+command与新operation测试。先写 query缺失、newobserver resume、missingop零dispatch RED；实现下节冻结接口与单一resolver/观察器。补读撤权、write-only撤权正控、fullsnapshot竞态和creator/resumer迟到单调性，最后事务整合授权/target/receipt/PRset读。运行 `pnpm test:file tests/integration/create-change-request.test.js tests/integration/change-request-operation.test.js tests/contract/storage-contract.test.js tests/integration/pull-request-identity-convergence.test.js`，期望 query任何Provider调用/持久delta=0，所有resume mutation增量=0，整条lost-ack总mutation=1。回滚本批补丁保留原receipt；不靠清空intent恢复。

### Batch 3 · 独立API交付与当前head门

在该分支工作树根使用Node26/pnpm10.28.2，先 `pnpm install --frozen-lockfile`。运行 `pnpm test:file tests/integration/start-work-external-intent.test.js tests/integration/start-work-owner-fencing.test.js tests/e2e/start-work-recovery.test.js`、`pnpm verify`、`pnpm run boundaries`，期望全pass无关键skip。运行 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`；Git argv `git diff --check origin/main...HEAD`，期望0；原按A+D确认<800/<1300（Superseded by Global Constraints 本轮≤1000/<1300，2026-11-02），并人工五类发布扫描。PR Closes实际child、Refs437，不能Closes437。最终push回读exacthead/base/issue/全部checks/分页reviewThreads，当前必需检查通过才ready，只请求人类评审。

### Batch 4 · 当前代际精确谱系

最小闭环：真实 Start Work Ready→工作树丢失→Failed→generation 3→第二 PR，首次创建及重启重复刷新都选择 PR_2，旧边仍在。先在 `tests/integration/change-request-operation.test.js` 写 Fake/SQLite 永久 RED；再窄改 chain-facts 与共享 target 谓词，补当前 Saved/Saved 和 Saved/Unknown 歧义不选择 first/latest。运行 `pnpm test:file tests/integration/change-request-operation.test.js tests/integration/create-change-request.test.js tests/integration/pull-request-identity-convergence.test.js tests/e2e/delivery-lineage.test.js`，期望全部通过；`pnpm run typecheck`、`pnpm run boundaries`、disclosure、size、diff-check 由当前树实际结果记录。回滚只撤本批 target 选择与回归，保留历史关系和外部 PR。先报实际 A+D；原 <800 预测不能在超限后继续声称满足，预算由协调者按当前根约定明确处置。

## Validation and Acceptance

| 闭环 | 必须证据 |
|---|---|
| 原38测试保留 | 精确逐test映射，原Core病例在本层，原2Host病例移上层；原证据和新head结果分列 |
| F1当前read授权 | SQLite reopen禁repo/PR读→零Provider、receipt不变；仅create写read_only→resume可确认；query同样拒绝 |
| F2精确关系 | StartWork→dropAck→先refresh candidate→resume→explicit/confirmed→sameSHAdecoy再refresh仍原PR；无关边不变、不支持关系态写前拒绝，已人工confirmed仍保留并归显式命令来源 |
| F3/F5真实窗口 | 原listBranches换generation/head probe仍命中；刷新后撤projection/解绑仓库返回非权威且Saved不变；503stale=true、CI-only-gap=false、superseded winner exactPR=false |
| query纯读 | none/Unknown与当前Saved/历史Saved三个target分量/整个并集multiple/specific terminal/targetchanged/malformed/readauth负例；Provider总调用、attempt/relations/facts/revision全快照不变 |
| new observer独立恢复 | SQLite reopen后B lookup+resumeA：mutation总1、Aactor/fingerprint/key/marker/input字节不变；B旧createkey仍Conflict |
| resume无dispatch | missing/wrongscope/id/target/read-denied/0/multiple/incomplete/throw均零mutation；spy令write方法抛错，所有resume路径不调用；不能fallback到create |
| 已Saved单调 | Aaccepted/holdack→BresumeSaved→Alateambiguous/failure/ack；Saved/ref/identity/关系不降级、currentresult不冒旧失败、外部数1 |
| 负控 | 临时撤readgate击败F1、撤candidate升级击败F2、撤最后scopecheck击败F3、将freshness改成refresh.ok击败F5；记录命中/失败并按字节还原 |

## Progress

- [x] (2026-11-02) 实际main重放后的组合 `pnpm verify` 3023+7、boundaries9与workflow-check通过，0失败/跳过/取消；原独立评审者核对重放源码等价。最终直接base技术行#495为839、#491为565；远端门按最终head回读。

- [x] (2026-11-02) F1独立复评无残留P0–P3：189/189永久用例、3/3生命周期与纯读、7/7权限/身份反例、typecheck与边界9/9；三项current-generation/history-ref/ambiguity正式变异attributed KILLED且逐字恢复，详见本轮报告。

- [x] (2026-11-02 Asia/Singapore) P2 根因与真实生命周期复现；Fake/SQLite 永久 successor 用例在当前源码均 RED（0 passed / 2 failed），失败为当前合法 PR 的 lineageStale=true。
- [x] (2026-11-02 Asia/Singapore) P2 最小补丁：永久两项 RED→GREEN，当前操作歧义保守；四文件相关回归 189/189，typecheck 与 boundaries 9/9。
- [ ] 独立复评、实际规模与预算处置后，由协调者归档和当前 head 发布。

- [x] (2026-11-02 Asia/Singapore) 读取原作者顶部、独立A/B细化、五项发现与clean0232ad源码，批准拆分已在上游明确。
- [x] Batch1：受控提取完成并建立后端基线40f3596；缺失永久窗口用例已补。冻结0232ad原38实际用例中36Core留本层、2Host按一对一源码/断言清单上移；world/ready共享fixture不改原行为。指定四套件291 passed、零skip，实际代码测试配置541 A+D。
- [x] Batch2：query/resume缺接口RED→GREEN；64个创建/operation用例全pass，其中36原Core病例保留。指定四套件290 passed；随后整成功响应丢失裁决已落实；当前代码测试配置785 A+D，API字段不变。
- [x] (2026-11-02 Asia/Singapore) Batch3：独立规格/质量均PASS，28独立探针、8项当前树正式变异、零残留；最终push后的head/base/checks/全部线程与Ready按交付门回读。

## Surprises & Discoveries

2026-11-02 P2：稳定 worktree 有多个历史 explicit/confirmed produced_by 边是合法生命周期，不是当前歧义。当前 generation 的 durable Saved/ref 才能限定当前边；但没有显式边的 Unknown 原操作仍需保持 ProviderRead→candidate→显式恢复的原流程，不能因缺 ref 直接封死观察。Fake/SQLite 新永久生命周期均以两个同 branch/head/SHA 的 PR 证明差异；旧边逐条不变。

整份成功响应丢失与provider丢ack不同：前者真实收据已Saved，旧pending-only过滤让重建客户端误见none。裁决以同一本地target谓词纳入当前Saved，并保留历史Saved新target→none、未决旧target保守发现与全并集歧义。初始新病例6个RED，修后指定套件309 passed；没有新表、索引、TTL或历史平台。

原单PR预测被真实789+缺失永久用例+F4推翻；旧单PR可行性说明原处标注Superseded到本计划/上层计划。SQL虽无新表列，当前CHECK闭集已改，旧DDL会被shape admission拒绝，不可称无物理基线变化。原8/8含两个忽略的私人probe，不等于永久coverage。peer随机Connection身份不能当稳定人类。

## Decision Log

2026-11-02 / 本轮协调者：本会话人类直接指示四PR在无P0/P1或仅P2/P3时，由本会话负责修复、独立复评、归档、整理提交、处理issue并以 `merge_method=rebase` 合并，具体覆盖#490/#491/#492/#495。人类同时提供的当前根AGENTS §6允许代码变更≤1000；本层保留完整P2修复及永久反例，按841实测修订旧<800预测，不声称旧预算满足，也不把本决策写成新增的人类豁免。技术与产品验收不减弱，Planning Status/native关系不改。

2026-11-02 / 本轮修复 owner：接受已复现的 P2，以现有 durable operation/ref 选择当前 exact relation；不更换 worktree 身份、不删除历史边、不取最新/首条，不增加 Provider/Host/Storage 合同。协调者要求先完成可审阅最小补丁及实际规模，再显式处置旧 <800 预算；不得通过删测或机械压行伪装满足。

2026-11-02 / 完成状态发现窄裁决：query可选selector与resume必填selector不混用；默认发现加入唯一当前Saved以覆盖整个成功响应丢失。currentTarget的workspace/workItem/repository/context/generation/head/worktree比较抽为唯一小predicate，同时服务eligibility与返回view；原绑定授权/receipt/canonical守卫保持。新增三类历史target、Saved+Saved/Saved+Unknown、Saved读撤权/仅写撤权/畸形记录永久回归；whole-success由真实Saved、丢弃返回值、SQLite重开、新controller/B observer证明，Host/newpeer/browser病例归上层。

2026-11-02 / 合同纠偏：现场核实RelationState只有candidate/confirmed，协调者确认原rejected夹具/规格Superseded。Fake与SQLite各有不支持状态拒绝、candidate升级及先人工确认后命令来源升级的判别用例；不扩enum或DDL。授权新增e2e的两个精确调用者清单，唯一快照/关系写者及query负面守卫保持。query仅在本地短读事务中使用resolver，无Provider调用或持久delta；finish最后await独立短事务共同观察授权/target/receipt/获胜PR set。

2026-11-02 / 后端提取：验证backup ref仍精确指向0232ad；转移14允许路径，提取唯一world/ready fixture，并将两实际Host场景完整写入本地split-host-cases清单交上层owner。Core集成无apps imports；先提交已验证基线供上层沿真实祖先开发，不将尚无query/resume当作已实现。

2026-11-02 / 独立综合评审：选保留已纠正Core刷新，保持F3/F5真实窗口与独立API闭环；不以移动await规避发现。采用纯query+显式resume，原请求immutable、当前读授权准入。只新增一个child，原491独立关闭437，机械LOC不驱动算法拆分。

## Idempotence and Recovery

query可重复无副作用；resume只观察同一receipt，no-match不允许再次create。代码提取/公开历史整理前保留backup和exactremotelease，失败按清单重放本任务patch，不重置其他任务。回退本层前停调用方并整库备份；旧main的SQL reader不认识当前CHECK/PR intent，不自动升级、重建或删除。继续读取时部署同物理合同修复版，或由人另处新建并保留旧库；不关远端PR。无新增平台债，必要延期写tech-debt-tracker且不隐匿未满足验收。

## Interfaces and Dependencies

冻结后端协议（字段都是readonly；scope不接收workspace，取CoreContext）：`PrScope={workItemId:string,repositoryId:string}`；`PrOperationQuery=PrScope & {operationId?:string}`；`PrOperationView={kind:'none'} | {kind:'blocked',reason:'unavailable'|'ambiguous'|'invalid_operation'} | {kind:'operation',operationId:string,state:'pending'|'unknown'|'saved'|'failed'|'conflict',currentTarget:boolean,targetStamp:string,head:string,base:string,title:string}`。summary不含原actor/key/body/marker/binding/generation；targetStamp不是凭据。

`CoreQueries.getChangeRequestOperation(query):Promise<PrOperationView>`；ControllerQueries同签名直通。既有 `createChangeRequest` 输入不变；`CoreCommands.resumeChangeRequest(PrScope & {operationId:string,observer:{kind:string,id?:string}}):Promise<CreateChangeRequestResult>`；ControllerCommands输入为scope+operationId+actorRef，映射observer，**无idempotencyKey、无新receipt**。结果沿用phase/ref/entityId/error/lineageStale，新增可选operationId/targetStamp；一旦durable admission已有operation，这两字段必填，写前拒绝可缺。Controller继续用phase映射CommandResult，不永久Map缓存Unknown。unavailableCore/query显式返回safe失败/blocked。

依赖正式GitHub adapter/现有refreshDeliveryFacts/relations/Storage契约，无Host/UI依赖。官方operation/status资源仅支持可寻址持久观察，不引入队列：`https://google.aip.dev/151`、`https://learn.microsoft.com/en-us/azure/architecture/patterns/asynchronous-request-reply`。late-arrival与immutable请求原则：`https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/`。这些原则不赋予现Provider exactly-once保证。

## Outcomes & Retrospective

2026-11-02 P2 本轮在检出 `feature/pull-request-command-recovery`、基线 `1b7a8f104435a3e2d94507f62770a8334a0be32b` 的未提交补丁执行：两项新生命周期回归先 0/2，再 GREEN；指定 Batch 4 四文件 189/189，0 failed/skipped/cancelled；`pnpm run typecheck` 通过，`pnpm run boundaries` 9/9。实际规模须包含新增叶子文件重新核算；本轮超过旧 <800 预测，不能沿用原 785 的合规结论。预算处置和独立复评由协调者记录。

原阶段只形成计划，曾未声称新增query/resume或F4已实现。Superseded by 本节最终后端验收（2026-11-02）：#494由PR #495闭合，技术源码冻结为 `531ffff764b9883e7846e3616f006d5290a356dd`，相对 `554e6fefb1ad9781becf879b9f96e367e9f6ceff` 实际代码/测试/配置785行。独立28探针、309相关测试、8项正式变异均通过且逐字还原，规格与质量PASS，详见 `docs/review/pr-495-mmp-review.md`。作者当前源码完整 `pnpm verify` 为2818/2818与MVP-0 7/7，边界9/9、零跳过。执行上下文为本计划Global Constraints指定分支检出根；独立检出为 `.worktrees/pr495-final-review`。最终文档规模与远端门按Plan of Work重算/回读，不引用旧head绿灯。无新接受延期债务；Host/UI完整闭环、人工UAT与R1仍由相应范围判断。

## Bottom Change Note

2026-11-02：依据789实测和真实对抗发现，将原单PR拆为独立持久operation能力，保留Core单一刷新、冻结newobserver恢复与Saved单调性合同。

2026-11-02：Saved整成功响应丢失发现、必填selector及输入/绑定窄修均独立复评通过，归档后端工程闭环；保留当前SQL物理基线/备份回退限制和最终远端门。

2026-11-02：独立 P2 真实生命周期反例推翻“历史 explicit 唯一性即可定位当前 PR”的假设，重新打开本计划，先记录永久 RED 和本批边界。

2026-11-02：协调者以当前根≤1000硬门明确处置841行候选及原<800预测，保留所有判别性回归，等待独立复评、归档和最终重放后重新计量。

2026-11-02：本轮P2独立复评通过，当前scope841 A+D（旧800预测未满足，按Global Constraints本轮根≤1000门处理），计划重新归档；最终源码重放、组合与远端门仍按当前head回读。

2026-11-02：记录最终实际main组合3023+7及9项边界证据，两个修复均独立复评且重放等价；最终发布仍保留当前head门。
