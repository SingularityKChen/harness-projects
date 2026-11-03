# 原生关闭关联来源读取 ExecPlan

> 状态：Completed（实现与独立 MMP 评审完成；实际合并、产品发布和 R1 各自回读）
> 创建：2026-11-03
> 范围：Issue #517，父项 #508 的独立能力闭环
> 调查基线：main `957451c684c546ddf8a5d19cb3a23a719940fa9b`

## Purpose / Big Picture

生产Provider对当前Issue给出严格逐页的原生closing facts，并能由当前Development绑定证明目标repo/PR原生身份与可见性。此片是可调用完整Provider能力，不是只有type的脚手架；不关闭#508。

## Context and Orientation

Planning provider当前 `call` 固定走projectNode，不能直接复用后假装Issue已decode。新增独立native query/classifier/decode调用面，复用安全错误分类。Development `getRepository`目前只返回Host repo键；新sourceRepositoryIdentity通过真实repo node ack取得。`getChangeRequest`的现有decoder已核目标repo node相等，native getter复用它但由Provider承担native identity翻译。A6/B-N及独立身份调查已综审。


选择PlanningProvider的可选来源读端口。权威Issue primary与Project membership由它拥有；其Issue connection是真正关系事实源。Development端口直接读Issue需要新增Issue跨binding可信桥，现有PR-only nativeIdentity不能承担；另立provider域或扫描所有PR也不必要。R7真正约束是historical不可回查，并非禁止当前primary Issue node查询；旧project-only注释随新port就地标为旧读取面的描述，不能改裁决。

Planning可见不自动证明当前workspace的目标仓库/PR准入。选择明确的两种身份承诺：`ProviderRepository.sourceRepositoryIdentity?`是独立仓库canonical source identity（namespace+opaque id），不是扩大PR-only nativeIdentity；目标closing PR可以带合法PR nativeIdentity。现有nativeIdentity只保证相等，不能假定Development的externalId编码相同，所以Host不得自己换binding拼ref。另给Development可选 `getChangeRequestByNativeIdentity({repository,identity})` 及独立能力 `development.change_request.native_identity.read`；由目标Provider自己解析、核仓库、返回自己的ref/native identity。GitHub实现可复用现有按node query/仓库核验，不新增全史扫描。这个小桥只处理PR，完全不使Issue进入bootstrap nativeIdentity。

当前source Planning permission、workspace policy、绑定repo scope以及目标Development实际repo/PR read ack必须都成立。Host native观察拥有独立receipt/epoch；已有delivery denial发生后使旧native receipt失效。显式native refresh允许按当前实现能力/策略重做actual read；PermissionDenied遮新native集合，之后新的exact成功ack只恢复native receipt，不清除delivery health、不写/创建execution context，不把native关系摄入lineage。这样有保守拒读也有可验证恢复，不靠过期derived mask永久锁死历史Issue。所有新缓存为本代Host有限内存；无需DB写、schema或迁移。若实际沿用已有health marker才能闭环，可在重估后使用既有ack记录，但绝不把native ack当执行链完整确认。

### 源查询与空集合证明

Planning port输入为current `{project,membership,issue,cursor,limit}`，绑定、种类、configured project不符先拒绝零transport。生产GraphQL同次读membership node及其project/content、Issue node及其repository、`closedByPullRequestsReferences(includeClosedPrs:true)`；每页回证membership/project/Issue相等和canonical Issue repository。不能只凭binding相等做任意node代理。

每页输出必须是 `{source:{project,membership,issue,repository},items,nextCursor}`，source proof位于顶层，空items也保留。每item含PR native identity、repo canonical identity/name、number/title/url、state/isDraft、provenance固定source_observed/native_closing。不取body/作者/branch/totalCount。includeClosedPrs显式true；userLinkedOnly/excludeUserLinked保false；普通timeline和willCloseTarget都不是此查询的替代。A独立live read已观察三历史例，B独立live115和schema；实施时仍回读source receipt，不把设计时观察当候选已接受。

## Design / Spec

capabilities新增 `planning.issue_closing_links.read` 与optional `listIssueClosingLinks`；另新增前述Development native getter与独立能力，缺方法不声明key。方法先检查能力，再校验输入；本binding/project/membership/Issue必须回证，空页同样证明身份。pagination limit夹100，next页需要非空新cursor；partial GraphQL data+errors整页失败，null/坏shape/unknown必要enum不滤掉冒充成功。PR state/isDraft按原生事实，不凭merged倒推人工implements。

repository identity字段只附在真实getRepository receipt，不写storage身份表；native getter接受合法PR identity与当前repo ref，namespace/类型不支持显式not_supported，拒绝外来repo/binding。通过生产decoder核当前repo.id和exact PR native identity后返回Provider自有ref；Host从不替Provider编码opaque ref。Fake/local没有这项能力时显式unsupported，不加旧协议分支。

## Global Constraints

分支 `feature/native-link-provider`，base为 `main`；在该分支的工作树根执行验证。用户已授权两路独立方案经第三位综审后持续实施；不重复确认、不自行合并、不改变规划 Status 或 native dependency。文件全集：`packages/capabilities/src/capability-keys.ts`、`packages/capabilities/src/planning-provider.ts`、`packages/capabilities/src/development-provider.ts`、`packages/capabilities/src/index.ts`、`packages/core/src/registry.ts`、`packages/providers/planning-github-projects/src/provider.ts`、`packages/providers/planning-github-projects/src/queries.ts`、`packages/providers/planning-github-projects/src/issue-closing-links.ts`、`packages/providers/development-github/src/provider.ts`、`packages/providers/development-github/src/decode.ts`、`tests/contract/planning-issue-closing-links.test.js`、`tests/contract/development-github-contract.test.js`、`docs/exec-plan/completed/2026-11-03-native-link-provider.md`、`tests/contract/capabilities-keys.test.js`、`docs/README.md`、`tests/integration/provider-binding-registration.test.js`、`packages/capabilities/src/registry.ts`、`packages/providers/development-github/src/queries.ts`、`tests/contract/development-github-create.test.js`、`tests/contract/fixtures/github-development/sandbox.json`、`tests/contract/planning-github-projects-mapping.test.js`、`tests/e2e/repository-routing.test.js`、`tests/fixtures/github-development-create.mjs`、`tests/integration/github-development-lineage.test.js`、`tests/integration/harness-plugin-host-github-catalog.test.js`。owner：native-source-owner。不改变现有执行谱系、业务关系确认、bootstrap 原生身份登记、Storage schema 或 Planning 状态。

代码、测试、配置、fixture 新增加删除严格少于800行，文档少于1300行；估计代码630–790，接近790时先查真实重复或重新划分独立闭环，不删必要安全验收。锁文件和生成目录按仓库规则排除。命令以 `pnpm` 简写，实际使用锁定工具链 `npx --yes --package pnpm@10.28.2 pnpm`。本计划已归档并更新文档索引；安装证据和工程测试分开记录。

## Plan of Work

Batch 1闭环为生产来源逐页读及明示身份桥。先写旧接口缺失的红测：顶层empty proof、bound Project/membership、不匹配Issue type/id/repo、historical159、two pages、partial/errors/cursor、native manual与非default keyword准确source行为；加native PR getter对错namespace/跨repo/deny/recover的真实transport测。实现query、strict decoder、能力与permission。主要文件issue-closing-links和两个Provider的小接线；保原有query文本，只有新增query有新hash（Development仓库query部分 Superseded by Decision Log 的单次真实仓库身份读取裁决，2026-11-03；Planning旧三段文本仍保持不变）。验证 `pnpm test:file tests/contract/planning-issue-closing-links.test.js tests/contract/planning-github-projects-contract.test.js tests/contract/planning-github-projects-mapping.test.js tests/contract/development-github-contract.test.js`、`pnpm typecheck`、`pnpm boundaries`；期望生产adapter路径全绿、无mutation或全史PR scan。回滚先移consumer，Provider可独立revert。

Batch 2用真实只读API记录三历史例和schema参数receipt；生产多页以受控transport通过真实Provider验证，线上单页证据不冒充多页。真实手动native链接与non-default keyword以精确来源语义fixture和已录权威receipt为证；不得为测试创建/修改用户repo关系。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 历史来源 | includeClosedPrs=true生产query，115→159、110→111、233→397回读；参数边界变异红；当前false仍含MERGED159，不能宣称线上漏159 |
| bound身份/零集合 | top-level source proof在empty仍存在；错Project/member/Issue/type/repo拒读，历史alias不查询 |
| 原生语义 | timeline mentions不入closing；willCloseTarget=false不漏159；manual与non-default关键词按exact source事实 |
| 分页与错误 | pageInfo/limit/cursor严格，partial errors整页失败，不滤null成complete |
| 合法PR桥 | native getter由Provider翻译，wrong namespace/target repo/binding拒绝；真实repo/native ack精确 |
| 权限 | source key permission不借PlanningItemRead或Project可见推PR可见；deny后真实read可恢复 |

## Progress

- [x] (2026-11-03 SGT) 子项 #517 已建立，独立验收边界与父项区分。

- [x] (2026-11-03 SGT) 双独立来源设计、primary/membership与identity桥综审。
- [x] (2026-11-03 SGT) Provider红绿、scope/身份对抗与live receipts：Planning初始6红、Development初始3红，生产实现后转绿；输入快照、来源URL与lazy原生权限时钟各补1红并转绿。
- [x] (2026-11-03 SGT) 生产来源回读115→159、110→111、233→397及目标PR实际读取；三例均单页终止。515→521在非默认base上的显式native连接也由生产来源读回。
- [x] (2026-11-03 SGT) 独立评审认可Provider闭环；P2同页重复canonical PR身份、P2异常输入读取与P3测试命名均按判别性红绿完成小修。
- [x] (2026-11-03 SGT) 小修独立scoped复审通过：39项通过、原2项P2与1项P3全部关闭；准确行为候选c46d已再次用7次生产Provider只读请求回读三历史例。完成Provider能力验收与发布准备；本片不代替父#508安装Host产品验收。Superseded by Decision Log 的实际拒读观察epoch裁决（2026-11-03）：后续P1反例推翻该候选权限并发接受。
- [x] (2026-11-03 SGT) prepared `65894e9d1a674e3c9f439fe3dfed30cfadb0f9f6` 的source/native两条P1反例已核实；12项同/跨Issue与目标并发时序RED→GREEN，改为实际拒读观察epoch。独立原始2例脚本2/2、限定契约158/158、typecheck和boundaries9/9通过。
- [x] (2026-11-03 SGT) 实际拒读epoch修复在准确b0c0eff候选获独立scoped PASS / P1 ADDRESSED：原始反例2/2、新增独立变体20/20；原P2/P3关闭结论保留。后继父层重放、安装接受和外部门禁仍由主控按准确新head核验，不挪用旧APPROVE。

## Surprises & Discoveries

空items没有逐item proof，必须顶层回证；现有nativeIdentity不规定任意Provider的lookup编码。旧Planning query的project-only是实现注释，R7只限制historical不可平台回查。

2026-11-03实证：`includeClosedPrs:false`在115仍返回MERGED159，因此旧“去参数导致159丢失”假设不成立；保留显式true覆盖CLOSED集合是查询契约，参数变异红只证明请求边界。115的timeline另含121/179/181等mentions；159的`willCloseTarget=false`，来源connection仍准确只含159。515→521是协调者已创建的显式native链接，PR base为`feature/table-geometry`；它证明该native连接可见，不证明非默认分支的body关键词自动生效。所有在线取证均只读。

2026-11-03后续P1实证：已有available之后A/B均在途，A实际403会被B仅dispatch的generation压掉，B离线又把拒读改为degraded；source/native两路都成立。旧“只接受最新dispatch结果”的实现不足以满足实际拒读约束；即使B先完成严格成功，稍后实际观察的A403也必须失效当下权威。不能用新的调用序号或因果success水位代替拒读发生后的新证明。

## Decision Log

Decision：来源端口归权威Planning，目标PR lookup用明示Development native能力，不伪装ref。Rationale：保来源关系单一权威与跨binding身份边界，且无需Issue identity迁移。Date/Author：2026-11-03 SGT / 独立综审。

Decision：DevelopmentRepository直接在原查询一次取得id/nameWithOwner并严格核配置目标，更新该query的hash与两条真实Repository exchanges；其余录制不变。Rationale：没有正式发布兼容负担，旧hash不是公共接口；一次真实receipt比独立第二读或合成兼容回包更小、更可靠。Date/Author：2026-11-03 SGT / 协调者裁决与native-source-owner实施。

Decision：Global Constraints增补编译期surface、既有能力集合golden及合成仓库transport的必要适配文件。Rationale：新增两个optional能力后必须同步surface锁；strict canonical decode不允许靠missing-id宽松分支兼容旧测试。Date/Author：2026-11-03 SGT / native-source-owner。

Decision：同页任意重复canonical PR身份（namespace/id）整页拒绝，包括字段完全一致和repo/number/state冲突；跨页去重仍由consumer维护。两个新入口仅将输入读取/snapshot纳入窄try，坏输入固定invalid_input，native不支持的namespace仍先于repo身份读取返回not_supported。Rationale：保持来源页全有或全无和结构化错误，不扩大旧Provider族重构、不泄露caller accessor错误。Date/Author：2026-11-03 SGT / 独立评审后native-source-owner修复。

Decision：两条新增权限仅维护实际拒读观察epoch，不再按dispatch序号决定权威。任何实际PermissionDenied递增本绑定epoch并置unavailable；请求启动捕获epoch，只有仍处当前epoch的严格成功可以恢复。拒读前已启动的迟到成功、pending、offline/rate-limit/malformed均不能清拒读；下一次拒读后新actual read可以恢复。source按绑定跨Issue共用该状态，native按绑定跨PR共用，接口与Storage不变。Rationale：观察到的权限拒绝优先于尚未证明的新请求，修复两条独立P1并与Host观察epoch边界对齐。Date/Author：2026-11-03 SGT / 协调者裁决与native-source-owner实施。

## Idempotence and Recovery

所有操作是read，可重试；permission evidence只更新本Provider读观察，不使Planning字段或delivery lineage变更。撤能力后consumer显式unsupported；无DB迁移/数据清理。

## Interfaces and Dependencies

外部GraphQL由Host transport持凭据；fixed errors不含原文。新capability与optional方法同时加入registry surface精确测试。Repository source identity与PR nativeIdentity为两个明确术语，Issue仍binding内primary ref。

## Outcomes & Retrospective

本片Provider接受已完成，未留下延期实现项。独立复审39/39和三历史例7次生产只读回读在2026-11-03针对`c46d0c16c0dcff49400a01b34efcdf359e4c5e13`完成；最终整理只改变计划与文档索引，生产及测试文件必须与该候选逐字等同。Superseded by Decision Log 的实际拒读观察epoch裁决（2026-11-03）：prepared候选随后确认P1，新的生产修复与限定验证记录如下。线上多页未在此声称，受控生产decoder分页测试保留。发布实时门在本分支根执行 `gh pr view 523 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,closingIssuesReferences`、`gh pr checks 523 -R SingularityKChen/harness-projects` 并分页核对review threads；期望当前head/base和同仓#517关联正确、必需PR Fast Gate通过后才Ready。


生产exported Provider已具来源逐页读取、空页回证、canonical仓库身份及明示PR native桥；未改Storage、bootstrap Issue identity、执行谱系或关系确认。描述使用Refs #508。技术债务：无新增延期实现项；真实安装Host与workspace scope准入由后继#518/#519验收，不属于本片独立Provider完成证据。

在检出`feature/native-link-provider`的工作树根运行`pnpm typecheck`、`pnpm boundaries`、`pnpm test`；2026-11-03初次实施候选`9d256acb05023f456323244a289818c6293ea191`观察为3400测试通过、0失败，boundaries 9通过；最终总数以同分支重跑命令为准。初次全套3394中6失败，均为旧仓库夹具字段和能力集合锁，已按严格新契约适配而非放宽生产decoder。参数、exact native ack与两项旧请求晚到的4个变异均观察到红；复原后才执行完整验证。线上receipt和测试输出由协调者保存于运行态证据中，正式文档不携带本机路径。

评审小修以`9d256acb05023f456323244a289818c6293ea191`为BASE：重复身份1项RED→GREEN、source/native异常输入4项RED→GREEN；后续运行`pnpm test:file tests/contract/planning-issue-closing-links.test.js tests/contract/planning-github-projects-contract.test.js tests/contract/planning-github-projects-mapping.test.js tests/contract/development-github-contract.test.js tests/integration/provider-binding-registration.test.js`得到146通过、0失败，`pnpm typecheck`与`pnpm boundaries`（9通过）通过。本轮无新跨层信号，按审查范围未重复3400全套，不把旧full-suite记为修复后HEAD验证。

本次P1修复基线为`65894e9d1a674e3c9f439fe3dfed30cfadb0f9f6`。12项新用例覆盖source/native、同/跨Issue或目标、403时另一路pending随后offline、拒读前已启动的成功在403后完成、较新success先完成再观察旧403，以及拒读后新actual read恢复；旧success晚到不能清新denial的原测保留。12项全RED→全GREEN；原独立反例脚本2项转绿。相同检出上运行前述5文件`pnpm test:file`为158通过、0失败，`pnpm typecheck`和`pnpm boundaries`（9项）通过。原3400全套及线上回读仅归原候选，本次不挪用为新HEAD证明；接口/query未变化，未重复线上读取或全盘扩审。

独立scoped复审于2026-11-03针对`b0c0eff46c78cdb09fe52fb3af5d058fb0f72f05`完成，原始两条生产Provider反例2/2、新增独立变体20/20通过，结论为本次P1 ADDRESSED / APPROVE；没有新增scoped finding。此范围只关闭N权限并发缺口，不代替H/V重放、父#508安装产品接受、托管CI或人类发布决定。最终单能力提交整理仅更新本计划的真实裁决，生产和测试文件保持与该独立候选逐字节等价。

## Bottom Change Note

2026-11-03 SGT：综合A6/B-N，新增member/empty proof与明示PR lookup桥，删除任何Host拼binding ref假设。

2026-11-03 SGT：实现Provider闭环、补充严格身份与时钟拒绝路径，记录真实单页、manual/non-default及timeline对照，订正includeClosedPrs的159证据边界；仓库query改为单次真实身份读取并重录对应receipt。

2026-11-03 SGT：接受独立评审P2/P3，拒绝同页重复身份、封装两个新入口的异常输入读取，修正来源分页测试命名；记录scoped复测与旧全套证据边界。

2026-11-03 SGT：独立复审与最终行为候选真实Provider回读完成，归档独立能力计划、维护索引；父项Host/UI接受保留在后继。

2026-11-03 SGT：后续P1反例否定latest-dispatch权限权威，保留原归档与被推翻结论，在原处标注superseded；实现实际拒读观察epoch及跨Issue/target完成顺序红绿，当时等待独立复审；后续结论见下一条。

2026-11-03 SGT：实际拒读epoch候选b0c0eff获独立scoped PASS，原始2例及独立20变体通过；记录最终N工程裁决并整理单能力提交，保留旧full-suite/live证据边界及父项接受门。

2026-11-03：本会话独立 MMP 全层评审 #523 完成，矩阵及真实验证见 `docs/review/pr-523-mmp-review.md`；本层未发现新增 P0/P1/P2/P3。人类本次直接授权本会话负责本 PR 的后续修复、独立复评、归档、提交整理、issue 核对及当前门禁通过后的 rebase merge，替代旧交付阶段“不自行合并”限制；不覆盖 Planning Status、原生依赖或 R1 裁决。此计划已在 completed，无需另建重复实现计划。

2026-11-03 新组合实际接受：clean `33472f2b1451b508b3d1c15d06acf3a078058bd7` 的完整3474+7、browser35、boundaries9、workflow通过；新包SHA-256 `7209b6e64a5572f68312bb57b43ad7fa8010d743f7995a63c9b92541a72c115a` 的12文件/文件集合与实际安装逐字节相同。真实115→159、110→111、233→397均为唯一qualified仓库、native来源/时间/安全外链；M/D/G/R/Q/V联合与原生200%光暗8布局通过。07:48:23.481Z–07:48:43.500Z 的23计数无变化，后续07:56:50Z再核亦无变化；不把此计数证据外推全库或任意外部调用，已有绑定在窗口外。任务Host已核对进程组并停止。旧安装证据仍绑定其旧输入，本段新安装覆盖本轮修复；R1仍独立。详见本PR评审与批次评审，最终head/base/CI/批准以回读为准。
