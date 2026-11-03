# Host 原生关闭关联观察 ExecPlan

> 状态：Completed（MMP 两项 P1 与一项 P2 修复已独立复评；合并按当前版本门禁）（工程独立评审及已安装native接受完成；发布与R1另验）
> 创建：2026-11-03
> 范围：Issue #518，父项 #508 的独立能力闭环
> 调查基线：main `957451c684c546ddf8a5d19cb3a23a719940fa9b`

## Purpose / Big Picture

Host经真实remote操作在无StartWork/context/worktree时读到当前Issue的完整、可见、可恢复原生关系观察。当前scope/权限改变和晚回不会把旧事实挂给新目标。

## Context and Orientation

新Core模块是native观察唯一owner；controller/Host仅传当前workspace workItem locator，source ref都由Core从已授权projection/current primary/current membership解析。现delivery-facts必须context/worktree，manual candidate/confirm另有契约；两者不改。A7/B-H指出最高预算风险，本片不得顺手重构runtime-access。


选择PlanningProvider的可选来源读端口。权威Issue primary与Project membership由它拥有；其Issue connection是真正关系事实源。Development端口直接读Issue需要新增Issue跨binding可信桥，现有PR-only nativeIdentity不能承担；另立provider域或扫描所有PR也不必要。R7真正约束是historical不可回查，并非禁止当前primary Issue node查询；旧project-only注释随新port就地标为旧读取面的描述，不能改裁决。

Planning可见不自动证明当前workspace的目标仓库/PR准入。选择明确的两种身份承诺：`ProviderRepository.sourceRepositoryIdentity?`是独立仓库canonical source identity（namespace+opaque id），不是扩大PR-only nativeIdentity；目标closing PR可以带合法PR nativeIdentity。现有nativeIdentity只保证相等，不能假定Development的externalId编码相同，所以Host不得自己换binding拼ref。另给Development可选 `getChangeRequestByNativeIdentity({repository,identity})` 及独立能力 `development.change_request.native_identity.read`；由目标Provider自己解析、核仓库、返回自己的ref/native identity。GitHub实现可复用现有按node query/仓库核验，不新增全史扫描。这个小桥只处理PR，完全不使Issue进入bootstrap nativeIdentity。

当前source Planning permission、workspace policy、绑定repo scope以及目标Development实际repo/PR read ack必须都成立。Host native观察拥有独立receipt/epoch；已有delivery denial发生后使旧native receipt失效。显式native refresh允许按当前实现能力/策略重做actual read；PermissionDenied遮新native集合，之后新的exact成功ack只恢复native receipt，不清除delivery health、不写/创建execution context，不把native关系摄入lineage。这样有保守拒读也有可验证恢复，不靠过期derived mask永久锁死历史Issue。所有新缓存为本代Host有限内存；无需DB写、schema或迁移。若实际沿用已有health marker才能闭环，可在重估后使用既有ack记录，但绝不把native ack当执行链完整确认。

### 源查询与空集合证明

Planning port输入为current `{project,membership,issue,cursor,limit}`，绑定、种类、configured project不符先拒绝零transport。生产GraphQL同次读membership node及其project/content、Issue node及其repository、`closedByPullRequestsReferences(includeClosedPrs:true)`；每页回证membership/project/Issue相等和canonical Issue repository。不能只凭binding相等做任意node代理。

每页输出必须是 `{source:{project,membership,issue,repository},items,nextCursor}`，source proof位于顶层，空items也保留。每item含PR native identity、repo canonical identity/name、number/title/url、state/isDraft、provenance固定source_observed/native_closing。不取body/作者/branch/totalCount。includeClosedPrs显式true；userLinkedOnly/excludeUserLinked保false；普通timeline和willCloseTarget都不是此查询的替代。A独立live read已观察三历史例，B独立live115和schema；实施时仍回读source receipt，不把设计时观察当候选已接受。

## Design / Spec

refresh只读外部来源，query只读本代Host native observation。scope stamp含workspace、current Planning binding/project/membership/Issue primary、当前registered repository现行ref与policy、access epochs和Host generation；UI不能输入nodeId/URL/任意binding。dispatch前先核授权可见Issue/current member及实现能力/策略；missing/draft/PR-backed/redacted拒绝或unsupported，unknown不借缓存。

通过当前Development路由及真实getRepository ack取得sourceRepositoryIdentity，核exact ref ack和当前workspace登记，不按repo number/name/URL猜。native source逐页回证同scope与Issue repo，目标repo必须在canonical映射中；然后用目标Provider native getter逐个actual read ack核PR native identity和当前repo。只读已关联PR、无全史扫描。target title/source URL优先采用当前目标ack；native provenance/draft状态是本次来源观察，不伪造business relation。未映射/拒读/partial不返回其标题、ID、URL或隐藏数量，generic partial不说“有1个隐藏PR”。

每页、每个target ack后及发布/return前重验authority signature/fence/epochs。同scope自增request序号负责latest-started-wins，不用墙钟定序；游标Set拒环，page预算或timeout耗尽为partial，重复同native PR一致者去重、不一致者partial。同number不同repo保独立。只有终页及全部身份/visibility准入完成才complete；complete空亦需顶层source与repo scope证明。partial可以只返回当前获准facts但不称source total/confirmed zero。

缓存为有限容量、context生命周期的Map，只有完整scope/权限仍明确有效时offline/error保last-known并stale；denied/unknown立即隐藏旧值，旧success不能恢复新denial。已有delivery denial/access change使旧native receipt失效；显式refresh重做真实Provider ack，新成功只替换native receipt，绝不调用delivery recover/settle使旧执行谱系转fresh。权限恢复路径必须通过本片测试。重组/重启unread。

独立综审P1补充：同一native binding的另一Issue明确拒读也必须使旧receipt和旧在途请求失效。native owner独立保有单调拒读epoch；缓存、dispatch、每个await和return都校验epoch。本代对已观察拒读作保守整集合失效，authority仅按当前选中binding+固定capability key记录（有限于已组合挂载），不保存任意Issue/node/ref。连续相同拒读去重，不持续推进epoch；pending dispatch从不写入权限证明，任何已观察403均保守fence旧epoch；仅同当前epoch内、已完成身份核验的新实际identity ack可解除该key的拒读cohort，以使下一次真实拒读再次换代。成功不回退epoch，不复活其它Issue的旧receipt，offline同样不能恢复旧epoch。

系统同步面新增可选 `nativeAccessVersion:string`：只在本代已有明确native准入拒绝后出现，是随机Host代+拒读序号，不编码binding/原生refs/隐藏数量。Core WorkspaceMetadata、controller baseline/delta/metadata及client接受头同步保留它；同Planning revision仅版本变化也发布metadata，不推进规划确认时间。消费者在接收该帧时必须同步使旧native展示失效；版本变化后的自动工作仅query，恢复由用户显式actual refresh，不以每帧自动probe形成拒读循环。后继UI将其纳入安全target签名，不能只依赖旧delivery health。

## Global Constraints

分支 `feature/native-link-host`，base为 `feature/native-link-provider`；在该分支的工作树根执行验证。用户已授权两路独立方案经第三位综审后持续实施；不重复确认、不自行合并、不改变规划 Status 或 native dependency。文件全集：`packages/core/src/issue-closing-links.ts`、`packages/core/src/context.ts`、`packages/core/src/queries.ts`、`packages/core/src/index.ts`、`packages/controller/src/commands.ts`、`packages/controller/src/queries.ts`、`packages/controller/src/wire.ts`、`packages/client/src/workspace-read.ts`、`packages/client/src/sync.ts`、`packages/client/src/store.ts`、`tests/e2e/workspace-read-assembly.test.js`、`tests/contract/ui-model-presentation.test.js`、`apps/harness-plugin/src/host-operations.ts`、`apps/harness-plugin/src/host-composition.ts`、`tests/integration/issue-closing-links-scope.test.js`、`tests/integration/harness-plugin-issue-closing-links.test.js`、`tests/contract/harness-host-remote-adapter.test.js`、`docs/exec-plan/completed/2026-11-03-native-link-host.md`、`docs/README.md`。owner：native-host-owner。不改变现有执行谱系、业务关系确认、bootstrap 原生身份登记、Storage schema 或 Planning 状态。

代码、测试、配置、fixture 新增加删除严格少于800行，文档少于1300行；估计代码670–790，接近790时先查真实重复或重新划分独立闭环，不删必要安全验收。锁文件和生成目录按仓库规则排除。命令以 `pnpm` 简写，实际使用锁定工具链 `npx --yes --package pnpm@10.28.2 pnpm`。本计划已移入 `docs/exec-plan/completed/` 并更新文档索引；安装证据和工程测试分开记录。

## Plan of Work

Batch 1闭环为Core当前scope全页观察。先红测scope错误零目标Provider读、无context可成功、top-level complete zero、多页error/cycle、同number跨repo、跨binding伪造、primary转historical、target repo撤销、A→B→A与两次反序reply。实现source解析、exact repo/native ack、全页聚合与epoch发布/安全query。主文件issue-closing-links。验证 `pnpm test:file tests/integration/issue-closing-links-scope.test.js tests/integration/delivery-read-fence.test.js tests/integration/delivery-pages-complete.test.js tests/integration/github-development-lineage.test.js`；期望哨兵不泄漏、只有真正完成可零。回滚新模块不碰持久业务数据。

Batch 2闭环为真实Host remote可消费与恢复。把typed refresh/query接Host operation；受控fetch走生产GraphQL/decoder，非Core stub。先deny→hide→late old success仍hide→恢复实际repo/PR read→native新receipt可见，既有delivery lineage health仍拒/缺context；offline保值后deny立即遮。验证 `pnpm test:file tests/integration/harness-plugin-issue-closing-links.test.js tests/e2e/delivery-lineage.test.js tests/integration/harness-plugin-delivery-lineage.test.js`、`pnpm typecheck`、`pnpm boundaries`，随后因身份/权限/并发跑 `pnpm verify`。fail-on-call spies证明DB业务写及branch/worktree/run/PR/Planning/relations全部0。回滚V后移H operation；N仍可调用。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| production remote | composeHost真实operation→controller→source query+target actual ack，非手造DTO |
| current scope | dispatch/ingest/return三处核验，member/primary/repo/binding变化均拒晚回 |
| current visibility | source+repo/native target实际ack；deny立即遮、旧success不复活、新explicit成功可恢复native |
| 完整性 | 第二页错误/循环/null/预算为partial不报confirmed zero，empty须顶层proof |
| 正交性 | context/worktree负控仍有效，native receipt不清delivery health或确认business candidate |
| 错误安全 | restricted title/id/url/count/raw error不进wire/DOM，out-of-scope不产生隐藏数量 |

## Progress

- [x] (2026-11-03 SGT) 子项 #518 已建立，独立验收边界与父项区分。

- [x] (2026-11-03 SGT) A7/B-H与实际identity/runtime-access机制综审。
- [x] (2026-11-03 SGT) N契约冻结；Core首组4/4先红后绿，扩展native专项13/13，生产remote走真实Planning/Development decoder。
- [x] (2026-11-03 SGT) 原执行链与manual candidate负控组合76/76、boundaries 9/9、workflow检查通过。
- [x] (2026-11-03 SGT) 最终 `pnpm verify`：主套件3413/3413、MVP 7/7；typecheck通过。
- [x] (2026-11-03 SGT) staged候选机械扫描与人工五类目检查通过，代码增删434、文档增删少于1300；本地实现提交交主控独立评审。
- [x] (2026-11-03 SGT) 补齐原spec仓库显示名：先红11/14、后绿14/14，typecheck通过；保留原实现提交，另立未发布小提交。
- [x] (2026-11-03 SGT) P1跨Issue双生产回归与wire/client闭集专项66/66通过；重复拒读版本稳定、恢复/old pending隔离、metadata不调用Provider。
- [x] (2026-11-03 SGT) P1最终完整 `pnpm verify`：3422/3422主套件、MVP 7/7；受影响专项88/88、boundaries 9/9、workflow通过。
- [x] (2026-11-03 SGT) P1第二轮：双生产RED为Host7项5绿2红；移除pending权限排序后offline/success双结果及原native20/20、受影响专项92/92；reviewer原文件7/7、完整3426+7全绿。
- [x] (2026-11-03 SGT) 准确09ffd45的第二轮P1独立scoped复评PASS：reviewer原三文件7/7、新增合约反例7/7，原P1关闭；Provider实际拒读epoch候选b0c0eff亦获独立PASS，最终父层重放保持owner代码字节等价。
- [x] (2026-11-03 SGT) 最终N/H/V准确source0e9257f、artifact eff55818的隔离Web Host真实安装已接受：115→159、110→111、233→397各唯一目标，23项审计计数前后相同。
- [x] (2026-11-03 SGT) 独立工程评审、已安装native接受与文档归档完成；最终外部门禁与有序发布仍由主控回读，本轮未push/ready/merge。

## Surprises & Discoveries

P1第一次修复并未闭合：独立复评新增C旧cache、A实际403、B更大request仅pending的双生产反例，证明request排序错误地把尚未完成的dispatch当作权限证明。此事实推翻原并发假设；第二轮移除pending对authority的影响，补offline和success两种B返回，旧epoch成功也被拒。两条原reviewer race、原跨Issue反例、容量/clone七项均在当前树回放全绿。

独立综审在准确90e9507版本复现跨Issue拒读泄漏：B已denied而A旧receipt仍complete/fresh。生产回归先红3绿2红；仅修Core后metadata仍缺帧，再补完整wire/client路径。P1首轮完整测试3422项仅fixture头字段机械清单漏新optional字段而失败（3421绿1红），补undefined键保留完整形状断言后全绿。现有deadline末尾才观察到拒读的分支还需将当前安全拒读receipt挂到新epoch，不能误回unread；此既有具名断言也保持。

首轮完整验证3412项中唯一失败是严格remote descriptor清单未包含新增操作；更新两个操作及其参数数量后通过。额外跨页仓库proof反例先得到complete（9绿1红），锁定首次canonical Issue repository后13项native专项全绿。最终总量为3413项，不把前轮结果当最终修订证据。

既有delivery health不是通用native cache协议；把native成功塞其恢复面会误宣称执行谱系已确认。只保守拒绝而没有恢复也不能闭环，因此独立native receipt配actual重新读回。

## Decision Log

Decision：推翻第一次epoch实现的并发假设，移除authority中的dispatch request排序，改为固定binding/key的拒读cohort Set。Rationale：生产反例证明较新pending/offline请求不构成实际权限成功，不能压掉较旧403；已观察拒读优先换代，旧epoch的任何success都不能恢复，新epoch actual身份证明仅恢复自己的receipt。每scope request序号仍只负责latest-started-wins，不进入权限控制。Date/Author：2026-11-03 SGT / 主控授权P1第二轮修复。

Decision：接受独立综审已生产路径证实的P1，在native owner增加独立拒读epoch，并补齐opaque nativeAccessVersion的完整wire/client同步链。Rationale：B的source native key或target native key明确403后，A旧缓存曾仍complete/fresh；旧delivery健康仅覆盖四个旧key，不是新native权限真源。query保持纯本地，不能用会发PlanningProject探针的describeCapabilities补丁。Date/Author：2026-11-03 SGT / 主控授权同一fix wave。

Decision：合法native关联增加必需 `repositoryName:string`，取本次canonical identity和exact ref均准入的真实 `getRepository` ack.name；空白或非字符串name降为partial。Rationale：原产品接受要求展示repository/number/title，而安全Workspace metadata没有仓库名；不能借执行写权限面、opaque Host键或URL猜名，也不把source页可伪造name升级为显示事实。Date/Author：2026-11-03 SGT / 主控明确补充原spec接受字段。

Decision：新增两个native远端操作必须同步严格descriptor清单；文件集扩入既有remote adapter契约测试。Rationale：首轮完整测试3412项仅固定清单落后失败，保留strict parser和参数数量穷举。Date/Author：2026-11-03 SGT / native-host-owner。

Decision：Host独立native观察owner和epoch，current Provider actual ack可只恢复native观察。Rationale：没有context也能恢复来源阅读，同时保既有执行健康与manual relation边界。Date/Author：2026-11-03 SGT / 独立综审。

## Idempotence and Recovery

refresh幂等、无外部写；query每次重验scope后才返回cache。Host dispose/recompose使旧generation失效，restart unread。回滚H无需恢复DB；V先移除。

## Interfaces and Dependencies

实际API冻结为 `getIssueClosingLinks({workItemId})` 与 `refreshIssueClosingLinks({workItemId})`；controller刷新另收actor，Host remote位置参数为 `getIssueClosingLinks(workItemId)` / `refreshIssueClosingLinks(actorRef,workItemId)`。query envelope为 `{workspaceId,workItemId,observation}`，refresh为非权威local_only CommandResult的value。Observation闭集含 `workItemId/scopeToken/state/links/stale`：unread/denied/unsupported/unavailable恒空links且stale；complete/partial带注入clock的observedAt。随机Host代加单调序号的scopeToken不编码原生ref。每次读取总deadline 10秒、100页预算、最多100份内存receipt；时间只展示和deadline，不作请求定序。source成功回证在actual目标读取之前，拒读source不触发目标Provider读。complete空只需要来源与实际仓库proof；不存在的PR不要求target ack。

nativeAccessVersion是独立可选workspace头字段，兼容旧读取面；必须通过baseline/delta/metadata、sourceSignature、client strict header与metadata白名单及ClientWorkspaceRead，不能借Planning revision或旧delivery accessVersion。

合法Link必需 `repositoryName:string`，与repositoryId和number/title一同返回。原“仅取 actual 仓库短 name”规则 Superseded by 本次 MMP P2 修复（2026-11-03）：source 提供的 qualified label 必须非空，且其 repository canonical identity 与实际仓库回执一致，PR native identity/number 再经实际目标回执核验后才呈现。caller 不提供 label；实际仓库回执非空 name 校验保留。denied/unsupported/unread/unavailable 仍恒空 links，不外露仓库名。

依赖N两个typed read能力与repo identity proof；controller refresh沿现有无replay的read-refresh模式带actor，query返回closed safe union。Host生命周期guard必须在dispatch与return都有效；scope token只用于客户端失效，不替Host授权。

## Outcomes & Retrospective

### 最终已安装native接受（2026-11-03）

主控在隔离Web Host 0.2.0-rc.2安装准确source `0e9257f86bc03f674bdb1d8d71b385eec16bd6e5` 的native stack；包SHA256为 `eff5581858865aa849b7dca06debe85d28d777fa1dc48598cfb6b4b66318f758`，已安装文件逐字节匹配。真实UI读取115→159、110→111、233→397，各恰好一个合法目标，均显示已合并、来源关闭关联和Host观察时间；公开链接为_blank且rel含noopener noreferrer。无需StartWork即可观察，来源事实没有升级为人工implements或执行谱系。

v2审计窗口从已确认的本地仓库绑定之后开始：04:52:56.175Z到05:03:15.304Z，23项计数完全相同。context、带worktree引用的context、branch/worktree/run及其它执行实体均0；business/manual/explicit/candidate relation与mutation_attempt（含StartWork/createChangeRequest）均0。既有15个PR实体和15个PR身份未变化。操作路径未执行StartWork、资源创建或Planning UI写入。计数审计只证明这23项未变，不等同安装库全字段逐字不变，也不单独证明所有可能外部调用；provider/account/credential、仓库绑定和Planning sync总量不在该审计内。

首次profile位于仓库内时被既有LocalGit输出根守卫正确拒绝；主控核验并保留profile后将其迁至仓库外，真实UI仓库绑定获ack后才取baseline。这是接受前配置动作，不能算作native阅读的零写入窗口，也没有因此修改产品。已安装三历史例，加上受控生产链的拒绝/恢复和独立工程反例，共同关闭本Host native能力；托管CI、公开发布、人类合并和R1仍是独立门。

工程闭环：Core只在当前可见Issue primary和Project membership下读取真实source，并对来源仓库、目标仓库和native PR做实际回证；Host操作通过controller进入生产Provider decoder。双页来源响应是明确合成GraphQL协议，repo/PR响应复用已有公开沙箱录制；没有声称真实多页或安装Host接受。查询与刷新前后SQLite整库逐字相同，业务写方法fail-on-call，既有无context/worktree与manual candidate负控保持。原delivery拒读持久marker逐字不变，native成功仅替换本代内存receipt。完整验证在分支工作树根执行，最终 `pnpm verify` 为3413+7全绿，专项组合76/76，boundaries 9/9，workflow无发现。上述是当时本地工程证据，最终已安装接受见本节新增记录；本计划已归档，发布门与R1另验。

本片用 Refs #508；原“尚无 UI 产品接受” Superseded by 本轮新组合实际安装（2026-11-03，下段）：本 Host 层仍不单独关闭父项，完整 UI 闭环由 #525 承接。未采用DB写是可逆简化；若实际故障恢复证据要求已有health marker ack，先修本计划与预算并证明不误恢复执行链，不私自新增schema/迁移。

## Bottom Change Note

2026-11-03 SGT：P1第二轮在准确e8cdc2e基线上修正pending≠actual proof，未改wire/client；完整3426+7、专项92/92及原reviewer7项通过，独立复评仍待执行。

2026-11-03 SGT：P1同一fix wave补独立native拒读epoch和opaque版本的完整wire/client同步链；3422+7全绿，88项专项通过。计划继续Active，等待独立复评和后继已打开UI接受。

2026-11-03 SGT：补齐来自实际仓库回执的repositoryName，14项专项和typecheck通过；3413+7完整证据属于原实现提交，未重复全量。实现与本地验证完成，记录真实生产decoder与合成source协议的证据边界；安装和父项UI接受待协调者验收。

2026-11-03 SGT：独立H scoped PASS（14/14）后重放到已独立接受的最终N并整理为单能力提交；保留安装与父#508产品门，未将工程评审代替产品接受。

2026-11-03 SGT：已安装native三历史例与v2计数审计由主控完成，归档H计划；最终只整理文档与本地提交，生产/测试树必须与已安装source0e9257f等价。


### MMP 评审修复批次（2026-11-03）

原完成结论 Superseded by 本批次：准确 `afe3975184ca94c7438614b30923b4688b56d2d6` 的两项 P1 与一项 P2 已由独立评审及主控复现，并一次性提交 PR #524 review 5748400748。超时后的真实拒读须推进 native visibility epoch；明确 NOT_FOUND 不等于 offline，须撤销旧 receipt，但不冒称权限拒绝。晚成功仍不得恢复旧资料；缺失资源按请求身份去重，当前 epoch 严格回证成功后才解除。继续使用现有全局 fence，避免新通知协议/持久化层；不改 delivery health 或业务数据。qualified 仓库展示沿来源回执与目标实际仓库/PR 的相同 canonical identity，修正旧 Interfaces 中仅取短 name 的约束。

本批受控文件追加 `packages/core/src/issue-closing-links.ts`、`tests/integration/harness-plugin-issue-closing-links.test.js`、`tests/integration/issue-closing-links-scope.test.js` 与本计划/评审/索引。先写生产 Provider→Host 的迟到 source/repository/target 403、NOT_FOUND、晚成功/离线正控和 metadata/query-only 判别测试，确认 RED，再做最小观察位置和易失 receipt 修复；按资源完整回证后保留 qualified label。验证在检出 `feature/native-link-host` 根执行 `pnpm test:file tests/integration/harness-plugin-issue-closing-links.test.js tests/integration/issue-closing-links-scope.test.js` 和 `pnpm typecheck`，期望全部通过；再由原独立 reviewer 复评并在组合树重跑完整门禁。回滚至 `refs/backup/pr524-before-mmp-review-20261103`；不恢复或覆盖用户文件。

人类本会话直接授权本评审会话负责这 8 条 PR 的修复、独立复评、归档、适量 Conventional Commits、issue 核对和 `merge_method=rebase` 合并；旧实现阶段不自行合并的约束仅为当时阶段。授权不覆盖跳过保护或规划 Status/依赖写入。


2026-11-03 MMP 修复实际结果：新增生产 Host 故障矩阵先 RED（24 项中 9 fail / 15 pass），source/repository/PR 的迟到 403、迟到 NOT_FOUND 与即时 NOT_FOUND 均确认能区分旧实现；跨仓 qualified label 独立 RED。最小修复后两 integration suite 36/36、typecheck 通过。原独立 reviewer 的三个精确反例及相关 suite 51/51，另 11 个独立边界通过，覆盖晚 capability 拒读、错误身份不能清 missing、跨 Issue/epoch、非法 label；正式 F1–F7 全部归因 KILLED 且还原后基线绿。复评生产 core SHA-256 `b1bf6a3093614b19ca1917f5816ba01974f8dc3b6b7f3b16bd62d21c1dd73c25`。两 P1、一 P2 全部 addressed，候选无新增 P0–P3；具体命令、执行检出和证据见 `docs/review/pr-524-mmp-review.md`。

Decision：NOT_FOUND 单独按完整 source refs、repository ref 或 repository+PR native identity 去重，记录最多 100 个易失资源键；仅当前 epoch 且实际身份校验通过才解除，不改 binding capability 拒读集合。Rationale：明确不存在/不可见和网络离线有不同证据；全局 native fence 保守使旧 receipt 回到 unread，不宣称其它对象也被拒读，也不需要新增 scope 通知协议。

旧包 `0e9257f` 与 `dca3e6f7` 的观察仍只覆盖各自命名输入；本轮修复改变生产源码，最终组合须重新构建/安装，不能将旧包等价声明延伸到本修复。当前组合完整验证与实际新包接受另由主控记录，R1 仍由人类裁决。本计划复评后再次归档到 completed，`docs/README.md` 恢复索引；合并前以新 head 和真实门禁回读为准。

2026-11-03 新组合实际接受：clean `33472f2b1451b508b3d1c15d06acf3a078058bd7` 的完整3474+7、browser35、boundaries9、workflow通过；新包SHA-256 `7209b6e64a5572f68312bb57b43ad7fa8010d743f7995a63c9b92541a72c115a` 的12文件/文件集合与实际安装逐字节相同。真实115→159、110→111、233→397均为唯一qualified仓库、native来源/时间/安全外链；M/D/G/R/Q/V联合与原生200%光暗8布局通过。07:48:23.481Z–07:48:43.500Z 的23计数无变化，后续07:56:50Z再核亦无变化；不把此计数证据外推全库或任意外部调用，已有绑定在窗口外。任务Host已核对进程组并停止。旧安装证据仍绑定其旧输入，本段新安装覆盖本轮修复；R1仍独立。详见本PR评审与批次评审，最终head/base/CI/批准以回读为准。
