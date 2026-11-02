# 详情中创建并重载恢复 PR ExecPlan

> 状态：Completed（本轮 P2 已修复并独立复评，最终发布按当前 head 回读）；创建：2026-11-02；既有 PR #491，Closes #437，Refs #494。
> 按根 `PLANS.md` 维护；本计划在原单PR计划原处标注Superseded后取代该规格。后端闭环见 `docs/exec-plan/completed/2026-11-02-pull-request-command-recovery.md`。

## Purpose / Big Picture

人从现有工作项详情明确创建PR，遇丢响应、浏览器reload或真实Host/Connection重建后，能看到Host持久原operation摘要，点击“读回原操作”恢复同一PR，不必记住或逐字重输title/body/key。当前被接纳的新peer可按当前read授权观察原操作，原creator身份不可改写，整个过程只发生一次外部mutation。确认状态与谱系新鲜度分别诚实呈现。

## Context and Orientation

来源完整快照是 `feature/pull-request-detail-creation@0232ad484fa69a6cba3ca8ac357e0dc108618194`，来源base554e6fe。2026-11-02作者顶部报告实际789code/test/config、121docs、完整2778+7与独立探针8/8；F1/F2/F3/F5已有窄修，两个probe尚未纳入永久，F4未实现，旧artifactdigest不是当前证据。本计划不把这些作者数字当独立重跑结果。已批准一个新增后端child；本491以其当前冻结head为base，只交Host/client/UI，不重复承担后端diff。

现有表单与client Map只在内存保存unknown原输入；真实Chromium reload会回空表单，这是F4的RED。peer.id由OperatorPeer以randomUUID产生，生命周期属于Connection；browser reload可能沿用operator，不能代替Host重建/newpeer测试，也不能把新peer视为同一个人类principal。

## Design / Spec

采用child已冻结的纯本地operation query与显式resume，不下载原body/key/actor/marker让UI重建create。详情打开、scope变化、重连时先query；loading/失败/blocked期间禁止显示可提交的新建表单。none才显示现有base/title/body创建表单；唯一合格原操作（pending/unknown，或匹配当前目标的 Saved）显示只读head/base/title的“已保存原请求”摘要及恢复按钮，不显示可提交的空正文表单，也不以空body再次create；currentTarget=false、多个候选、读授权失败都明确blocked，不取first，不盲目新建。指定operationId可读其terminal状态，便于同组件确认后重读。

浏览器submit只发新意图；unknown若有operationId即转resume，响应连id也丢失则重新scope query发现durable合格原操作。resume不生成create key、不重造actor/body/fingerprint、不调用submit。客户端只保留必要in-flight传输协调；删除旧full-body Map“未知只能精确重输重放”的恢复分支，不留两套协议。新create调用的key在同一传输重试内稳定；跨重载安全由child持久slot负责，不用localStorage/sessionStorage。

Host两个新操作沿现行descriptor/RemoteResult与可信commandActor覆盖actorRef。query自身纯local零Provider/零持久写。resume的actorRef映射为当前observer，不覆盖原creator；没有稳定人类映射。newpeer使用旧createkey仍Conflict，但当前授权newpeer resume旧operation应成功。operationId是selector而非凭证，错workspace/workitem/repository、不可见或原binding读门拒绝时均不泄露原摘要。

create/resume完成后，Host **最后一个await** 调child纯本地指定operation query；只有operation.state=saved、currentTarget=true且targetStamp与返回操作一致，才发布authoritative confirmed/reconciled。最后检查拒绝或target变化时给固定非权威Conflict/安全失败，原Saved/confirmedRef保留。scope/creator/connection代数与operationId检查拒绝迟到回复；UI不把旧target确认宣告为当前target。UI 的当前确认文案必须同时获得最新成功读数：同 operationId、同 targetStamp、state=saved 且 currentTarget=true；后续 loading、失败、blocked、身份不匹配或目标变化都优先撤下旧确认文案，历史 Saved 不回滚。最新合法 none 撤下缓存成功提示并允许当前目标的新意图表单，不用旧成功结果继续阻止新目标创建。不得复制后端状态机、provider扫描或自行改receipt。

保留child Core作为唯一post-create/resume refresh协调者，结果lineageStale按最后事务的actual exact PRset给出。本层onConfirmed只让现有DeliveryLineageSection `load(false)`纯读；不能又refresh一次。普通open/manual刷新维持现有section责任。503/未确认/错PR显示“PR已确认，谱系暂未刷新”且保留receipt确认；optional CI缺口不能误报PR未刷新；superseded刷新依据child读取的最终winning snapshot，不照搬refresh.ok/applied猜测。UI不由ack创建第二份交付快照。

## Global Constraints

现分支 `feature/pull-request-detail-creation`、工作树 `.worktrees/pull-request-detail-recovery`；native stack基于 `feature/pull-request-command-recovery` 的冻结head。严格code/test/config<800、docs<1300；原本层相对 child 预计380–470 A+D 的估计 Superseded by 当前480–600 A+D预测（上限预测600）：独立评审新增成功 Saved 整份回复丢失、后续观察撤下旧确认和严格枚举的永久反例，`afa0af2` 实际已485；不扩大产品范围，严格实际 code/test/config<800、docs<1300不变。只有本层完整reload/newpeer/authorization/lineage/artifact闭环通过才Closes437；child不关闭437。只新增一个child，总4issues/4PRs；不合并、不改PlanningStatus/nativeblocking。

本层独占允许文件：`apps/harness-plugin/src/host-operations.ts`、`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/client.ts`；`packages/client/src/create-change-request.ts`、`packages/client/src/index.ts`；`packages/ui/src/create-change-request-section.ts`、`packages/ui/src/delivery-lineage-section.ts`、`packages/ui/src/workspace-setup.ts`、`packages/ui/src/work-item-app.ts`、`packages/ui/src/work-item-project.ts`、`packages/ui/src/work-item-detail.ts`；`tests/contract/ui-create-change-request.test.js`、`tests/contract/harness-host-operations.test.js`、`tests/contract/harness-host-remote-adapter.test.js`、`tests/contract/ui-delivery-lineage-section.test.js`；新 `tests/integration/harness-plugin-change-request-operation.test.js`（承接原Core文件里的两项实际Host测试）；`tests/integration/harness-plugin-artifact.test.js`、`tests/integration/harness-plugin-delivery-lineage.test.js`；本计划active/completed路径；docs/README由root串行登记。child拥有所有core/controller/capabilities/storage/SQL与 `tests/fixtures/change-request-world.mjs`；本层只import共享fixture，禁止复制world或修改后端来绕UI问题。

调整现公开491之前，root按git-expert-operations验证 `refs/backup/pull-request-detail-creation-0232ad4` 保存完整789源，记录remote exacthead与新child head。按源base554e6fe→0232ad的本层hunk受控转移到新child上；不reset source、不丢未发布修复、不复制整文件覆盖无关工作。用文件清单/测试ID映射/range-diff证明两层并集保留当前修复与新增coverage；原Host测试移新文件而非删除，移动不声称省验收。实际路径先realpath核对.worktrees，Git全用argv/library。公开历史改写建立backup、精确force-with-lease；由root操作，本计划未执行Git mutation。

## Plan of Work

### 本轮评审修复 · F1 失败反馈

最小闭环：真实 Host 拒绝创建时，详情显示固定安全失败/冲突说明并保留输入；不改权威读数和外部写入。判别性永久用例先 RED，再只改消息优先级转 GREEN；保留 permission/loading/blocked/currentTarget 门。运行本层 Host/UI 窄套件、typecheck、当前 artifact；独立复评后归档、单交付提交、精确 lease、当前 CI/线程/issue 回读及 rebase 合并。回滚只移除消息修复及对应回归，不触碰 receipt 或外部 PR。

### Batch 1 · 实际Host恢复合同

最小闭环：新peer经真实installHostRemote可发现并resume旧operation。主文件为Host operations/composition与新Host集成测试。先将原Core测试里的Host imports和两项case完整移入本层新文件，保留forged actor/extra head/最后refresh换target的原断言；加入新query/resume descriptor与actualhandler RED。真实SQLite：peer-A create→dropAck→disposeHost/close→重建Host并接纳peer-B→localquery→resume；原actor/fingerprint/key不变、mutation总1；B旧createkey仍Conflict。运行 `pnpm test:file tests/integration/harness-plugin-change-request-operation.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js`，期望RED→GREEN、纯queryProvider/持久delta0、缺peer/错scope拒绝。回滚Host入口至child，不动原操作。

### Batch 2 · Client/详情reload恢复

最小闭环：真实React+productionclient在无原输入内存的状态呈现并恢复原操作。主文件为creator/表单与UI测试。先做loading/none/operation/blocked、unknown丢id再query、scope/断线迟到的RED，再实现下节冻结client协议和单飞。删除旧fullbody重放恢复分支。运行 `pnpm test:file tests/contract/ui-create-change-request.test.js tests/contract/ui-delivery-lineage-section.test.js tests/integration/harness-plugin-delivery-lineage.test.js`，期望unknown/failed/query拒绝时绝不误放create，确认后只read不post-create二次refresh，lineageStale准确显示。

用owned loopback carrier装配真实WorkItemApp、production creator/reader、实际Hostservice、正式adapter strict transport、SQLite，在Chromium录制：输入空白/换行/Unicodebody→accepted/dropAck→unknown→reload→重开同详情→无需重输的原operation摘要→显式resume→确认，mutation总1。另做真实Host重建newpeer流程，不能把固定peer或仅componentremount当替代。保存各态截图/DOM与mutation/receipt证据；本carrier不冒称安装件人工UAT。回滚本批到childAPI可调用状态，保留数据库/远端PR。

### Batch 3 · 真实窗口、当前产物与两层交付

主文件为Host/artifact与现有谱系测试。在本分支根目录Node26/pnpm10.28.2执行 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`，再 `pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/e2e/delivery-lineage.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/integration/harness-plugin-delivery-lineage.test.js`，期望当前bundle里的新操作真实可达、参数位置/实际发送/安全decode符合合同。新artifactdigest重新测，不沿用0232ad之前摘要。

加入真实Host最后local operation-view窗口换generation/head、撤projection/解绑仓库；先证明barrier实际命中，再验证返回非authoritative、历史Saved不动。保留Core刷新协调、Host纯read后置检查，不能移走await让原F3探针“未命中即绿”。actualread503/supersededwinner/CI-only-gap从child经HostclientUI分别呈现正确。运行 `pnpm verify`、`pnpm run boundaries`，以及child指定operation/Create/StartWork组合回归，期望全pass无关键skip。

最终 `node scripts/rule-checks.mjs disclosure feature/pull-request-command-recovery`、`node scripts/rule-checks.mjs size feature/pull-request-command-recovery`，Git argv `git diff --check feature/pull-request-command-recovery...HEAD`，期望0并确认实际<800/<1300；另记录main累计差异，不能把child藏入生成物。人工五类发布扫描；整理commit后按merge-queue先建立默认分支issue reciprocal link，再原生stack link父child，回读base/Closes437/Refschild。最终push回读exacthead/base/issue/checks/分页reviewthreads，必需checks通过才ready，只请求人类评审。

## Validation and Acceptance

| 闭环 | 必须证据 |
|---|---|
| F4 reload真实修复 | Chromium真实Host/生产client/adapter/SQLite，unknown→reload→summary→resume；不重输title/body，mutation总1 |
| Host重建/newpeer | A创建、Connection销毁/Host与SQLite重建、Bquery/resume成功；原actor/fingerprint/key/marker/input字节不变；B原createkeyConflict |
| scope发现保守 | 回应连operationId也丢失仍lookup发现 Unknown 或当前目标 Saved；loading/failed/blocked/multiple/currentTargetfalse均不放create；none唯一放行 |
| F1/当前授权 | query/resume原bindingrepo/PRread拒绝→零provider/无摘要；仅写权撤销可恢复；缺peer/forgedscope/伪造authority输入拒绝 |
| F3末尾窗口 | Core实际refresh中的旧探针继续命中，Host最后localquery期间target/授权变化也命中；Saved不变、当前结果非权威 |
| F5消费 | 503→confirmed+PRstale；只CIgap→PR非stale；supersededwinningexactPR依最终快照；onConfirmed纯read，无第二post-create刷新 |
| 迟到/单飞 | submit/resume双击各共享task；scope/creator/connection代数过期不污染新详情；unknown不生成新create请求 |
| 测试完整/产物 | 原两项Hostcase名字/断言保留，child/Core测试不含apps；当前pack操作实际可达；不把合成carrier或旧digest当人工UAT |

## Progress

- [x] (2026-11-02) 实际main重放后的组合 `pnpm verify` 3023+7、boundaries9与workflow-check通过，0失败/跳过/取消；原独立评审者核对重放源码等价。最终直接base技术行#495为839、#491为565；远端门按最终head回读。

- [x] (2026-11-02) 本轮 F1：实际 Host 缺 context 永久用例 1/1 RED→GREEN；Host/UI 两文件27/27，当前 artifact26/26，typecheck通过。独立复评43/43永久用例、7/7输入及优先级探针、原反例1/1与文案回退变异KILLED，修复候选无残留P0–P3。

- [x] (2026-11-02 Asia/Singapore) 确认789检查点、F4未实现、单child拆分授权与实际peer寿命。
- [x] (2026-11-02) Batch1原两 Host case 保留，Unknown/SQLite/真实 Host 重建/newpeer 和四类末尾本地查询窗口已 GREEN；Saved 成功响应整体丢失的新发现闭环另列下一项。
- [x] (2026-11-02) Batch2 Unknown 的真实 Chromium reload、Host 重建/newpeer 恢复已录制；同作用域查询乱序测试 RED→GREEN，无原输入缓存。
- [x] (2026-11-02) 独立评审 F2/F3：旧确认压过新读数、数组枚举被接纳均复现 RED；修复后 UI/Host 窄回归 39/39，含真实 Host resume 后改目标/授权的永久用例。
- [x] (2026-11-02) 独立评审 F1 的 child `531ffff7` 已原生 rebase；实际 Host 成功 confirmed 后丢整份响应、SQLite 重建/newpeer、Saved scope 发现与 resume 永久用例 GREEN，query 零 Provider/revision delta、原指纹/输入/confirmedRef 不变、mutation=1。
- [x] (2026-11-02) 运行源码 `05ac0d6` 在 child `531ffff7` 上完成真实 Chromium Saved 整份成功响应丢失→reload→Host/SQLite 重建/peer-B→reload→原摘要→resume；create RPC=1、resume RPC=1、mutation=1，整份 Saved receipt 不变。Unknown 原证据继续单独保留。
- [x] (2026-11-02) 同一源码当前 pack、124项八文件回归、完整 verify2848+7、边界9项、机械发布/规模/diff-check均通过且无 skip；本层524代码行，文档仍低于1300。
- [x] (2026-11-02 Asia/Singapore) 最终独立SPEC/QUALITY均PASS、零残留，权限提示窄修也复评通过；当前远端head/base/checks/全部线程与Ready按Plan of Work回读，本地绿项不替代hosted CI或人工UAT。
- [x] (2026-11-02 Asia/Singapore) Batch3真实最后窗口及两个栈组合验证完成：3020+7、边界9、当前组合产物80项均通过、零跳过；最终归并后重建本层current-head产物并执行远端门。

## Surprises & Discoveries

原“unknown重用key成功”只证明同组件内存协议；真实reload回空表单。browserreload不必改变peer，Host/Connection重建不能假定peer不变。原完整verify通过并未覆盖F4；两个额外永久probe和当前artifact当时仍需补齐。Superseded by Progress的最终验证（2026-11-02）。原结论：“完整单PR目标745–790行可行”。Superseded by `Global Constraints` 的两层预算与后端计划（2026-11-02），实际789仍缺F4与永久用例。原恢复流程隐含“重载仍可使用原peer/原create信封”的假设；Superseded by `Design / Spec` 的当前observer显式resume协议（2026-11-02），Connection随机peer不能视为稳定人类。旧文字保留为被推翻记录，不再当执行规则。

## Decision Log

2026-11-02 / 本轮协调者：人类本会话指定无 P0/P1 或只有 P2/P3 时由本会话负责修复、独立复评、归档、整合提交、核对 issue，并以 merge_method=rebase 合并，明确覆盖 #490/#491/#492/#495。#491 全矩阵只有 F1 P2，已由评审账号一次提交 APPROVE 与 inline；选择在当前组件消息优先级窄修，未就绪时隐藏表单会引入额外 readiness 查询及权限耦合，故不采用。

2026-11-02 / 独立评审 F1–F3：原“只发现 pending/unknown 即覆盖丢响应”的规则 Superseded；成功 Host 响应整体丢失时 receipt 已 Saved，也必须保守发现当前 target 的可信原操作，冻结选择规则是同 context 全部 pending/unknown 并上复用现行完整 currentTarget 谓词的 Saved，历史 Saved 忽略、failed/conflict 仅按 ID、多候选 ambiguous；不能取 first。UI 原“confirmed/reconciled 先于后续 query 拒绝”的呈现优先级 Superseded：最新同身份、同 stamp、Saved/currentTarget=true 才能声明当前确认；其余后续读数先行降级。Client 枚举先做 string 类型检查。原 receipt 与 Core 唯一刷新责任均保持。

2026-11-02 / 独立综合评审：选择独立purequery+显式resume；UI不重造原请求、不持久原body/actor，不设第二状态权威。保留Core唯一post-create刷新与lineageStale，详情确认后仅read；这保留并加强F3/F5原真实窗口。只新增一个child，当前491完成用户闭环后关闭437。

## Idempotence and Recovery

operation query与resume可重复，resume在结构上只有观察，未决0匹配不允许新建。未知时保留operationId并重新query，不靠浏览器存储复原权限身份。revert本491回child只移Host/client/UI入口，后端controller仍独立可调用恢复；本层无SQL基线变化，数据库与远端PR保留。若连child回退，遵其当前SQL CHECK不兼容旧reader的停用/备份限制，不自动删除或重建。必要延期如实记tech-debt-tracker，未完不关闭437。

## Interfaces and Dependencies

唯一前置是 #494 / PR #495 的冻结协议。Core/Controller query名 `getChangeRequestOperation({workItemId,repositoryId,operationId?})` 返回none/blocked/operation union；operation含operationId/state/currentTarget/targetStamp/head/base/title，绝无body/actor/key/marker/binding/generation。Core resume输入scope+operationId+observer；Controller输入scope+operationId+actorRef，无idempotencyKey。已有create输入不变，CommandResult value新增admission后必有operationId/targetStamp，保留phase/ref/entityId/error/lineageStale。

冻结Host位置参数：`getChangeRequestOperation(actorRef,workItemId,repositoryId,operationId?)` 与 `resumeChangeRequest(actorRef,workItemId,repositoryId,operationId)`，均由现commandActor用当前admittedpeer覆盖actorRef；不新增primitiveABI。query返回现RemoteResult包装的 `{workspaceId,workItemId,repositoryId,operation:PrOperationView}`；resume/create返回现CommandResult。queryhandler显式丢弃actorRef后传纯scope；resume映射observer，不改原actor。

冻结client：`ChangeRequestCreator.operation(scope,operationId?):Promise<ChangeRequestOperationRead>`；`submit(intent):Promise<ChangeRequestCreation>`；`resume(scope,operationId):Promise<ChangeRequestCreation>`。scope含workspaceId供闭合校验；OperationRead为scope+operationunion；Creation含writeState、可选operationId/targetStamp/lineageStale/recovery，admitted操作必须有id/stamp。复用现reader只读，不给DeliveryLineageReader添write，UI不importCore/Provider运行时。state/reason 必须先验证 typeof string 再匹配枚举，拒绝数组、null、对象及未知值，不做字符串强制转换。

官方status-resource原则仅支持独立可寻址观察：`https://google.aip.dev/151`、`https://learn.microsoft.com/en-us/azure/architecture/patterns/asynchronous-request-reply`；请求身份/迟到原则见 `https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/`。无新auth映射、outbox、migration或服务端exactly-once保证。

## Outcomes & Retrospective

上一完整本地运行源码 `05ac0d64456057c54ea60b0747a9dedb6b461c78`（最新状态Superseded by本节最终独立验收，2026-11-02）、父层 `531ffff764b9883e7846e3616f006d5290a356dd`。F1 Saved whole-response-loss、F2 后续操作观察控制确认、F3 严格原始字符串枚举均有永久 GREEN，合法 none 允许当前新意图且不沿用旧确认。真实 Chromium 的原 Unknown 证据 source `28307cf` 与新增 Saved 证据 source `05ac0d6` 分开记录，后者真实确认 Host 返回 confirmed 后才丢整份响应，原 Saved receipt 在 peer-B resume 前后逐字段一致。当前 artifact tarball SHA256 为 `2fec54dd0926f8428b425f1122ce9c95b2674ab177abaa213ebdb50cc8ee0f55`；124项窄回归、verify2848+7及边界9项均通过，无 skip。Core 仍独占刷新，onConfirmed 仅纯读。当时只是本地交付证据，独立复验与远端发布门未完成。Superseded by本节最终独立验收（2026-11-02）；最终远端值仍按当前head回读。

实现检查点 `3ecb6e7` 相对冻结 child `a5d8c612` 为437代码/104文档行；作者完整 verify2817+7、独立当前产物113项及边界9项已通过，但独立三反例 RED 判定 REQUEST_CHANGES，不能据这些绿项宣称整个闭环完成。Unknown 浏览器证据的实际 source 是 `28307cf`；新的 Saved 发现、F2/F3 修复、最终产物与组合验证必须各自记录新精确 head。

原规格阶段结论（Superseded by 上述当前本地实现与验证记录，远端/UAT边界保留）：本阶段完成规格，不声称F4已实现、currentartifact已通过或ready。完成记录child/UI确切head/base、两层各自A+D、所有五finding永久GREEN、reload/newpeer与artifactdigest、真实hostedchecks和liveGitHub/人工Host/R1未验证边界。全部工程验收通过后归档并保持Closes #437关联；issue保持open，合并后由GitHub关闭；原380–470预测 Superseded by 当前480–600预测（上限预测600），实际仍须<800，文档<1300。

2026-11-02 最终独立验收绑定技术源码 `5ac032f90fed9cc650b583106321bafcdf122255` / 父层 `531ffff764b9883e7846e3616f006d5290a356dd`，SPEC/QUALITY均PASS，P0–P3零残留。原3独立反例、5补充探针、42永久窄回归与typecheck通过；05ac0d6的六正式关键守卫变异及5ac032f的权限优先级因果回退变异均按各自精确head归因KILLED并逐字恢复，未伪称后者重跑六项。自包含矩阵见 `docs/review/pr-491-mmp-review.md`。

协调者在 `test/iteration9-final-acceptance@4e70656`（两个栈合并、保留#490完整start-work实现）执行 `pnpm verify` 为3020/3020与MVP-0 7/7，边界9、当前组合产物/Host/谱系80项通过，零失败/跳过/取消，包含最后权限提示永久回归。相对技术父层本层代码542行；最终历史整理仅文档，own-layer非文档patch逐字等价，严格规模与current-head产物在最终归并后重测，见交付门。末轮不改Saved/Unknown浏览器路径，录制仍分别绑定05ac0d6与28307cf，不冒称重新录制5ac。无新增接受延期技术债；人工installed Host/#143/#449/R1仍独立。

## Bottom Change Note

2026-11-02：在真实789实测后将491收敛为消费独立durableoperationAPI的Host/client/详情交付，冻结reload/newpeer恢复、最后local检查与Core单一刷新责任。

2026-11-02 独立评审修订：添加最新 operation 观察控制确认文案、严格枚举类型以及成功 Saved 丢响应待验证项；保留被推翻规则与原证据 source，等待 child F1 冻结协议。

2026-11-02 none 规格对齐：旧 cached accepted 无条件阻止新建的临时规则 Superseded；新的合法 none 必须撤下旧确认并允许当前目标新建，其余 loading/failed/blocked/非当前目标继续非权威。

2026-11-02 规模预测校正：依据 `afa0af2` 实际485及剩余 Saved 永久覆盖，将原380–470标为 Superseded，当前480–600/上限600；只补验收缺口，不增产品范围。

2026-11-02 F1 接入记录：后端 `531ffff7` 冻结的 Saved 发现协议已进入本层；完整成功响应丢失的实际 Host/SQLite/newpeer 永久用例与原 Unknown 用例同时通过，浏览器Saved录制及当前产物当时待记录。Superseded by Progress中的05ac0d6完整Saved记录（2026-11-02）。

2026-11-02 Saved 验收补记：`05ac0d6` 完成实际 Host 成功回复整体丢失的永久用例及真实 Chromium 新连接恢复；仅记本地 current-source/current-artifact 证据，独立复验与 hosted 门留给 coordinator。

2026-11-02 最终独立评审补充 P2：合法 none 的通用提示误压住当前 failed/conflict 的 fix_permission 解释；仅将当前失败的权限说明置于通用 none 前，loading/failed-query/blocked/非当前目标门仍优先，缓存成功不阻止合法 none。实际 Host403→生产 client→组件永久用例 RED→GREEN，含修复入口点击；窄回归42项及 typecheck通过，旧完整 verify/artifact/browser证据仍绑定 `05ac0d6`，本次不冒称重新全量或浏览器录制。

2026-11-02：所有独立finding修复复评后归档，记录3020+7最终组合、源码等价与最终当前产物/远端门；issue仅维持关闭关联，不提前关闭或改变规划状态。

2026-11-02：为本轮 F1 P2 暂时重新打开计划，永久实际 Host 缺 context 用例已如实 RED；探索性 422 返回 Unknown 是既定不确定边界，不写成确定失败回归。

2026-11-02：本轮 F1 P2 消息优先级窄修完成并独立复评；重新归档工程计划，最终源码重排和远端门仍逐当前 head 核验。

2026-11-02：记录最终实际main组合3023+7及9项边界证据，两个修复均独立复评且重放等价；最终发布仍保留当前head门。
