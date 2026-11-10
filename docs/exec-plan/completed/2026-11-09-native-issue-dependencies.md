# 原生 Issue 双向阻塞读取 ExecPlan

> 状态：Active，本地工程闭环已实现，独立评审和远端回读待主控执行；创建：2026-11-09（Asia/Singapore）
> 正式路径：`docs/exec-plan/completed/2026-11-09-native-issue-dependencies.md`
> 工程子项：#589；父 Issue：#543；必要技术父 PR：#592；本 PR：#590；仅关闭本工程首叶；规范：`PLANS.md`、`AGENTS.md`

## Purpose / Big Picture

用户打开当前 Issue 详情，能分别看到“阻塞此 Issue”和“此 Issue 阻塞”的来源原生 Issue，包含已关闭目标和当前 Project 外的目标，能用来源限定号与安全链接导航。目标无需成为本地实体或 Project 成员。最小成功证据是生产 Provider→Core→typed Host remote→strict client→真实详情浏览器链正确展示两个方向，权限/范围变更或迟到结果不泄露旧事实，关系和 Planning 数据零写入。

本叶只实现 blockedBy/blocking。父 #543 继续承担 parent/subIssues、完整 installed artifact 映射和人类验收；工程 PR 使用 `Refs #543` 和新工程叶的关闭关联，不能关闭父项。

## Context and Orientation

现有 Planning 项目查询没有 native blocking；`ProviderIssueClosingLink` 专门表示 PR closing/reference，要求 PR 的 draft/merged 语义，并经 Development 路由核对，不能拿来装 Issue target。`packages/domain/src/relations.ts` 是确认业务关系，读取源关系不写入该模型。新能力用独立 typed 来源观察。

2026-11-09 官方 GitHub GraphQL Issue schema 的只读 introspection 已确认 blockedBy/blocking 为 IssueConnection，支持 first/after；parent/subIssues另有字段。本证据只证明字段存在，不证明具体账号内容/权限完整。现有 Host 操作声明位于 `apps/harness-plugin/src/host-operations.ts`，remote/host-surface 从它派生；无需手改三份 schema。实际 client 经 workspace-setup→work-item-app→work-item-project→work-item-detail 传给详情，必须接通生产链，不能止于 Provider。

## Design / Spec

裁定新增 capability `PlanningIssueDependenciesRead: 'planning.issue_dependencies.read'` 和可选 port `listIssueDependencies`，方向 `'blocked_by' | 'blocking'`。Provider 输入 `{project,membership,issue,direction,cursor,limit}`；每页回证三元 source refs、source repository identity 与 direction。目标字段仅原生 Issue identity、repository identity/name、number、title、canonical url、state(open/closed)。identity namespace 显式含 github.com；跨仓库同号不能合并。每方向独立静态 query，由已验证方向选择，不插入任意 query 文本，不改原三段录制 query hash。

采用一个显式 I/O 命令 `refreshIssueDependencies(scope)` 返回本次完整安全观察；Controller/Host 沿已有 refresh/listOptions 的只读外部观察命令模式包装。无 unused get、Core事实缓存、last-good fallback、持久表、receipt重放或第二权限框架。client 暴露 `IssueDependenciesReader.refresh({workspaceId,workItemId})`；首次打开安全来源的 effect 和用户刷新按钮调用，React render、普通 snapshot/query不调用Provider。没有为“兼容”保留两种读取模型。

Core 负责按当前 workspace、唯一 planning binding、project、primary Issue identity 与当前 membership 定位 source，核对 planning.item.read、本新 capability 与 policy。只读当前已提交事实，使用 `committedFence`、runtime planning epoch、本代 source stamp、每 workItem 请求序号拒绝变化；stamp包含实际绑定、account/config身份和源三元引用，不能只比显示仓库名。Host 在返回后再次拒绝 retired/换代 assembly。Provider 的单页必须实际回证 source project/member/content/Issue/repository，empty也不跳过。实际消费父 PR #592 的 `issueAuthorityReadAccess` / `observeIssueAuthority` 和 `issueSourceReadAccess`。内部票据包含 generation、epoch、bigint receipt，在首次异步 source/describe 以前捕获；current、恢复与发布比较原三元票据，不在另一个 Issue 恢复后重新签票。descriptor 只在新拒读 cohort 记录否定，每次当前源 actual permission_denied/not_supported 记录否定；not_found 保持 resource/sourceVersions 语义。共同观察器由父 PR 独占，本 PR 不修改。

两个方向逐页有界，最多各10页、每页100、整个刷新共用10秒绝对期限；limit/cursor/重复游标/循环/节点形状/源错配均验证。成功页统一完成后才发布该方向 complete；后页失败或截断返回 partial，不能降成 empty complete。可保留本次已验证的可见前页，但不保留上次刷新事实；null/受限/错误形状所在方向保守清项，显示不完整且不透露隐藏数量。GraphQL errors 不与 data 混用为成功。只有complete可带成功观察时刻；partial可带本次尝试时刻且不得标新鲜/完整。

Core 输出 `{workItemId, blockedBy, blocking}`；每方向明确 state：unread/complete/partial/denied/unsupported/unavailable，含安全 items、stale，成功时 observedAt。只有 complete 且 items空时显示“来源未返回可见的阻塞此项”（反向对应文案）；这里 complete仅指当前授权可见API分页读完，不宣称平台不存在不可见关系。禁止 totalCount/隐藏item数和其aria/title泄漏。

实际否定推进父观察器内部 receipt；snapshot.nativeAccessVersion 继续只表达可见拒读 cohort 的 epoch，不把每次 receipt 变化变成 metadata 或自动探测。所有已打开依赖section通过 metadata清除事实，不能触发自动probe循环。拒读之前开始的成功不能恢复权限；只有拒读后显式刷新、同源实际成功才能恢复。来源/账号已换的旧拒读也不能遮蔽新源。Provider descriptor capability/policy依然是硬门；已知permission拒绝允许显式只读恢复探测，但不能以探测名义绕过policy。没有单独的新通用权限cache。

UI新增 `issueDependenciesTarget`（workspaceId/workItemId/sourceToken/accessToken）与 `issueDependenciesReader`。target由当前primary Issue且绑定与planningSource一致时产生；accessToken沿现generation/nativeAccessVersion/planningSource/capabilities组合。section render先比较当前token、reader、connected，再看state；错代立即无DOM/AX旧事实。effect首次来源实际刷新；仅权限metadata变化时清为未确认，等用户显式刷新，不重复探测。A→B→A、断开/重连、unmount均取消旧effect接纳；同token下也以request ordinal判断。每次刷新先清本section上次项，不制造宿主仍可读旧值的承诺。

放弃项目全量sync夹带nested relations：全列表无关读取、分页失败放大且与Planning事实混合。放弃PR links payload复用和domain relations摄入：目标类型与业务权威都不同。放弃父四向一次实现：预算和验收不可控。新 typed API 必须被生产 client/UI调用；不得将测试中的direct Provider调用当闭环。

## Global Constraints

分支 `feature/native-issue-dependencies`，工作树 `.worktrees/native-issue-dependencies-20261109`。现有能力已独立复现 receipt 因果缺陷，因此必要 stack 固定为 #592→#590；#592 从 main 独立修现有 PR 观察器，本 PR 实际消费其 API，计划 base 为 `origin/fix/native-authority-receipts`。当前临时装配父 API 做生产路径验证，最终安全 rebase 与精确 parent/base/diff 回读由主控执行。父计划为 `docs/exec-plan/completed/2026-11-09-native-authority-receipts.md`；回退时先回退本 consumer，再回退父 API。#585虽也改host-composition.ts，其CI验证/装配变更与本项handler声明、typed dispatch、retired read列表不同；没有技术依赖。#584 lifecycle owner同理，不改其lifetime实现。若存在真实文本冲突由主控单一owner合入并做组合预演，不虚挂stack。

单一owner精确生产文件集：`packages/capabilities/src/planning-provider.ts`、`packages/capabilities/src/capability-keys.ts`、`packages/capabilities/src/registry.ts`；`packages/providers/planning-github-projects/src/issue-dependencies.ts`（新增）、`packages/providers/planning-github-projects/src/queries.ts`、`packages/providers/planning-github-projects/src/provider.ts`；`packages/core/src/issue-dependencies.ts`（新增）、`packages/core/src/index.ts`、`packages/core/src/context.ts`、`packages/core/src/queries.ts`、`packages/core/src/registry.ts`；`packages/controller/src/commands.ts`；`packages/client/src/issue-dependencies-reader.ts`（新增）、`packages/client/src/index.ts`；`apps/harness-plugin/src/host-operations.ts`、`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/client.ts`；`packages/ui-model/src/work-item-detail-view.ts`；`packages/ui/src/issue-dependencies-section.ts`（新增）、`packages/ui/src/work-item-detail.ts`、`packages/ui/src/work-item-project.ts`、`packages/ui/src/work-item-app.ts`、`packages/ui/src/workspace-setup.ts`。

测试文件集：`tests/contract/planning-issue-dependencies.test.js`（新增）、`tests/integration/issue-dependencies-scope.test.js`（新增）、`tests/browser/issue-dependencies.test.js`（新增）、`tests/fixtures/native-link-detail-browser.mjs`、`tests/contract/harness-host-operations.test.js`；完整 remote/capability golden 同步另涉及 `tests/contract/harness-host-remote-adapter.test.js`、`tests/contract/planning-github-projects-mapping.test.js`；仅在既有key或port golden锁要求时更新 `tests/contract/capabilities-keys.test.js`、`tests/contract/planning-contract.test.js`。生产Host集成可以直接复用native-detail fixture的实际service，不额外复制一个Host搭建套件。文档仅正式路径本ExecPlan；docs/README由主控维护。

与#539共享文件只在 `WorkItemDetailContent` 新target字段及target派生处、drawer参数/section挂载处改动；#539只动markdownSource与contentPanel传参。两个worktree各一owner，最终由主控一个owner整合并验证二者同时生效；不允许在同一worktree双owner写同文件。

代码新增+删除严格 <800，文档 <1300，包含所有tests/config/fixtures；初始预测 contract/golden45、Provider140、Core140、跨层接线110、strict client/UI95、判别测试/fixture225，总755，留44余量。此为可行性假设，尚无真实diff证据；10页/10秒/无cache等简化必须先确认再实施。严禁把测试移到被排除路径、删除scope/denial反例、压成不可读长行或计净新增。无旧数据迁移、兼容API、Provider/关系/Planning写入、模型请求或自行merge。

## Plan of Work

### Batch 1 · 有界双向读取到生产详情

最小闭环：两个方向的当前安全来源观察从生产port经真实Host协议到详情，安全失败与empty明确区分。主文件为新Provider/Core/client/section模块及typed Host接线。

准入首门：先列真实全部接线路径、复用现有Host fixture，写出必要测试场景并测算逐文件新增+删除上界。只保留一个显式refresh，取消缓存/get/lastgood这类非本叶需求。预计>799则先进一步简化；仍>799时停止整个单PR实现宣称，回到本节切分门，不砍验收。可以先写未发布骨架估计，骨架不作为验收通过或PR ready证据。

先RED Provider用例证明port缺失、两个方向和source echo语义；用schema形状人工夹具，不访问真实私有内容。再RED Core source/binding/account/policy/committed-fence与晚回应；生产Host service断言remote声明和client闭集契约可达；复用native-detail server扩静态HTTP响应，browser打开实际app并验证标签、目标与状态。实现只补最小机制，capability与port golden锁同步，unavailableCore给安全unsupported空观察。

在检出上述分支的工作树根运行：V1 `pnpm test:file tests/contract/planning-issue-dependencies.test.js tests/integration/issue-dependencies-scope.test.js tests/contract/harness-host-operations.test.js`，期望判别RED后全部通过。V2 `node --test tests/browser/issue-dependencies.test.js tests/browser/native-link-detail.test.js`，期望生产apply新section/旧PR section同时正确且零业务写。V3 `pnpm run typecheck`、`pnpm run boundaries`，期望编译期port锁和包依赖均通过；Host协议变更同时跑 `node scripts/workflow-check.mjs`，期望退出0。无需先扩完整suite，新增失败/跨边界信号再扩大。

V4 `node scripts/rule-checks.mjs disclosure origin/fix/native-authority-receipts`、`node scripts/rule-checks.mjs size origin/fix/native-authority-receipts`、`git diff --check origin/fix/native-authority-receipts...HEAD`、`git diff --numstat origin/fix/native-authority-receipts...HEAD`，期望机械检查通过、人工逐类发布面检查无未处理秘密/本机身份/个人信息/内部系统/保密字样，实际包含测试代码计数≤799。PR记录工程叶+Refs父、本计划Batch1、真实验证和剩余installed门。最终push回读当前head/base/checks/issue linkage/所有threads后才ready；不自行merge。

原预算门保留：若完整 child 闭环相对实际 parent 仍不可在799内完成，只有两种合规调整：延期本叶，保留#309/#539和#554证据门；或必要stack两PR，第一PR把safe typed read通过生产Host remote提供真实可调用端到端API并具备Core/Host集成验收，第二PR消费这个确切API交付UI/浏览器。第一PR不能只有Provider/无人调用的内部API；必须有现有Host实际调用入口及明确调用实例，若做不到便延期。两个PR各独立验收/回滚/Issue/预算，第二PR对第一PR确有类型/操作契约技术依赖；不依赖#585。切分时主控更新独立ExecPlan与精确owner，不能把单PR草稿原样标完成。

回滚点为完整本叶提交；无schema改变。若已切为stack，先回退UI消费再回退typed API，避免在线consumer调用不存在操作。

## Validation and Acceptance

V1覆盖：两方向独立分页、闭合目标、Project外目标/跨仓同号、complete empty、unread/unsupported/denied/unavailable/partial、null与GraphQL error、错source/member/repository/方向、非法URL/数字、重复/循环cursor、总deadline；后页失败不是无关系，受限节点不泄漏字段或数量。实际source确认能支持的范围必须明确，不声称知道API不可见关系。

Core/Host判别：redacted/错误workspace/非primary/alias/无membership不读Provider；policy拒绝不可探测绕过；account/binding/source/committed fence改变丢旧响应；旧成功不能跨新deny；旧源deny不污染新源；source_missing不恢复旧目标；刷新只有本次安全页、不复用上次事实；真实remote回传strict client拒绝未知/错scope/不合法状态字段。已关闭native目标保留，不要求ExecutionContext或本地repository registration。

V2覆盖真实App：A→B→A、metadata撤权与后台同binding拒读立即清DOM/AX且不probe loop、Host换代/断开、重读恢复、双向文本正确、安全外链Tab/Enter/Escape、320px明暗主题；render/theme/geometry不增加Provider请求。读取前后比较SQLite dump，零entity/membership/relation/Planning/MutationAttempt写入，零模型/Provider mutation；原PR关联仍独立正确。工程测试完成后父installed、人类、R1门仍开放。

若必要反例无法在预算内保留，单PR判定失败，执行切分/延期门；不得以“测试通过”跳过未建立的source/权限安全契约。

## Progress

- [x] (2026-11-09 19:54 +08) 独立综合两路方案、官方schema证据、真实typed remote与App透传路径；消除#585伪技术依赖。
- [x] (2026-11-09 20:17 +08) 预算准入：真实 tracked diff 与全部 untracked 代码逐路径计入，代码增删760行，未拆stack；测试未移入排除目录。 Superseded by Decision Log 的必要#592→#590（2026-11-09）。
- [x] (2026-11-09 20:17 +08) Batch1本地工程：Provider/Core/strict client/Host/browser 已完成RED/GREEN，最后窄scope9项、真实浏览器新旧7项、typecheck均通过。
- [x] (2026-11-09 20:36 +08) 独立评审F1/F2/F3已补RED/GREEN；最终窄49项、浏览器7项、完整verify（contract1430 / integration2083 / e2e226）及typecheck全部通过，代码798/文档124。 该阶段F1结论已被后续原始receipt消费与最终scoped验收取代。
- [x] (2026-11-09 21:07 +08) 必要父receipt API消费完成；最终父文件逐字核对一致，完整verify1430/2084/226、browser8项通过；feature暂测799，实际parent rebase由主控负责。
- [x] (2026-11-09 21:23 +08) 主控独立scoped复评和提交整理完成；组合预演、最终push和远端回读按发布即时门执行，不把历史head状态当当前事实。
- [x] (2026-11-09 21:23 +08) 工程边界归档；人类PR评审及父hierarchy/installed接受仍未完成，不由本计划代替。

## Surprises & Discoveries

现有PR closing port不是可泛化的Issue关系读取面，其target必须为PR且映射Development；复用会引入错误语义和额外repository注册依赖。实际Host remote是单一OPERATIONS派生，host-surface/remote不用再手改。默认两操作+事实缓存并非本叶所需，单次显式refresh能移除无用户收益的状态与测试负担；真正成本在source/permission fencing和全生产接线。

实际完整测量在保留判别测试并展开测试语句后为760行，单PR可容纳。首次完整verify暴露两个整对象golden必须同步（remote描述符和GitHub capability自述），修复后contract1430、integration2080、e2e226均通过。其后新增Core白名单反例先RED，再改为显式字段投影，窄scope9项通过；全量证据与最后窄修复证据分开记录。浏览器Host retired反例发现夹具原先先等待remote drain，未实际中断inflight；改为先调用生产host.stop，并正确结束已发送headers的旧watch，再确认旧调用被拒绝。

## Decision Log

Decision：只做双向native阻塞工程叶，采用单refresh返回本次观察，无缓存/持久化。Rationale：用户任务是当前来源辨方向，restart持久lastcomplete属于#544；不为省行数削权限或把新语义塞入PR契约。Date/Author：2026-11-09 19:54 +08 / 独立收敛评审者。

Decision：独立main，单PR只在实际完整预算≤799时准入；超预算必要typed API→UI stack或延期。Rationale：共享host-composition是文本集成成本；真实stack只能来自本能力API依赖。Date/Author：2026-11-09 19:54 +08 / 独立收敛评审者。

Decision：完整契约golden扩展两处测试文件，保持所有正式反例并采用单PR。Rationale：两个失败来自新增公开操作和capability闭集，属于真实契约维护；760行仍低于799硬上限。Date/Author：2026-11-09 20:17 +08 / 实施者。

Decision：本能力permission_denied复用binding/key authority，not_found保留source resource；只在双流完整回证后恢复。所有source复核均受共同10秒期限，超期actual否定只按此前已提交fence及runtime epoch同步回证，不再发起Storage I/O。Rationale：重复resource missing不会通知已被其他Issue恢复的详情，而现有authority cohort已有正确的否定/恢复因果；只需受限导出既有helper，无须第二权限代际框架。Date/Author：2026-11-09 20:35 +08 / 评审修复实施者。

Decision：采用真实必要 stack #592→#590，base计划改为origin/fix/native-authority-receipts；首次异步前保存父API原generation/epoch/receipt，descriptor不重复实际否定，actual permission_denied/not_supported换receipt，所有成功恢复与发布使用原票据。Rationale：现有PR读取已独立复现同cohort重复拒读+第三方恢复夹持旧A的缺陷，父PR独立修现有功能；本consumer需要该确切契约，不能仅比较metadata epoch或在B恢复后重签A。Date/Author：2026-11-09 21:01 +08 / receipt消费实施者。

## Idempotence and Recovery

刷新仅读来源，可重复；每次新序号与同源围栏，无幂等写回执，无旧缓存恢复。失败清本次不可证实数据，不对Project做补偿写，不修改用户数据库。权限恢复必须当前源显式读成功；不得清deny epoch来造成功。全部回退本叶即可去掉新section/操作，数据库不变。触发deadline后消费迟到settlement但拒绝发布，不能让未处理Promise错误逃逸。

## Interfaces and Dependencies

父 #592 提供的内部 authority 三元票据（不进wire）为本 PR 的真实接口依赖。Node>=22、pnpm10.28.2、现有GraphqlTransport、ProviderResult、Core runtimeAccess、typed OPERATIONS、strict client和React effect。新provider port可选，未实现provider报告unsupported；capability/port golden与Core可选方法锁同步。本叶不新增Provider跨调、Storage接口、外部凭据或关系写权限；账号沿既有Host服务解析。公开API名称和方向固定于本计划，不为未来parent/subIssues预造general graph API。

修复记录（2026-11-09 20:35 +08）：独立评审三项均先复现RED：B deny→A显式恢复→B再deny的metadata不前进；not_found→双流unavailable错误清missing；第二次scope等待在10秒后仍未settle。后续统一bounded一度使同源超期actual deny被吞，扩既有deadline表又先RED后以已提交fence/runtime epoch同步回证修复；同源晚deny推进metadata，旧fence晚deny丢弃。相关窄49项与真实浏览器7项通过。真实预算798行；测试改用标准Promise.withResolvers，重复dot URL/metadata白名单用例并入已有矩阵，所有判别断言保留。

## Outcomes & Retrospective

本地已交付Provider→Core→Controller→typed Host remote→strict client→实际详情双向读取。每方向独立分页，保留closed与Project外目标，empty、partial、denied等状态分开；当前源/账号/配置/绑定/committed fence、请求序号和拒读metadata围栏经判别测试验证；独立评审发现的重复actual权限拒读、failure-only虚假恢复和第二次scope挂起已补RED/GREEN。Core只输出白名单字段，未知隐藏计数不透传；无get/cache/persistence或业务关系写。接入必要父 API 后按 feature 文件暂测代码增删799行（排除父独占共同观察器）；最终相对实际 parent 的完整diff仍由主控安全rebase后确认，文档低于1300行。

最终父receipt API装配后，完整pnpm verify（contract1430、integration2084、e2e226）与typecheck全部通过，真实浏览器新2+旧6共8项通过。主控保留旧IssueTarget summary合同并在父模块修正source票据粒度后，本轮最终装配消除了此前唯一集成回归。consumer窄相关50项已通过，完整验证亦包含这些用例。临时feature-only预算799行，不把父fix计入child预算；最终相对origin/fix/native-authority-receipts的base/diff/规模仍由主控安全rebase后确认。上述均为离线transport与生产装配本地工程证据，不代表installed、人类UAT、父#543关闭或R1接受。未提交、push或改PR状态，scoped复评、安全rebase到实际parent及远端回读由主控继续。

## Bottom Change Note

2026-11-09 19:54 +08：创建最终草稿，压缩为单显式refresh纵向闭环，冻结完整文件与权限/分页/迟到门，消除#585虚依赖，并明确799预算失败时真实stack/延期路径。

2026-11-09 20:17 +08：记录760行真实预算、单PR实现与RED/GREEN，补齐整对象golden owner，明确全量验证和最后白名单窄修复的时序，以及尚未完成的独立评审/远端门。

2026-11-09 20:35 +08：记录独立评审F1/F2/F3一波修复、source/authority语义分离、期限与晚否定同步围栏、798行预算和内部helper精确owner。

2026-11-09 21:01 +08：接入父#592完整receipt契约并固定必要stack；真实Host初次describe held A反例已RED，复用浏览器轨迹覆盖初次describe/实际依赖页两条持有路径，原deadline/失败恢复/旧scope门保留；相对parent预算在主控rebase后确认。

2026-11-09 21:02 +08：receipt consumer已在真实Host初次describe/实际依赖页两路径通过，窄50项、browser8项、typecheck绿；临时父API暴露独立IssueTarget summary全量合同回归，根层正在修父源，child不改父模块或旧断言，最终全量验收等待最终父文件。

2026-11-09 21:07 +08：最终granular source父API装配后全仓与browser均绿，更新实际证据；原summary断言完整保留。未操作Git parent、commit、push或PR状态，实际parent diff预算交主控回读。

2026-11-09 21:20 +08：本分支已安全rebase到#592实际父提交；独立whole-source scoped复评F1/F2/F3全ADDRESSED，无新增发现，4独立竞态探针、35窄验证、8浏览器及64既有回归通过。实际parent差异799代码/133文档（归档前）；父模块不属于本PR差异，source hash保持2ca895b46888。人类installed/hierarchy门与PR评审未由工程归档代替。

2026-11-09 21:23 +08：在真实parent提交上完成最终完整verify，三层1430/2127/226全部通过、typecheck通过，实际Host新旧浏览器8/8通过；均为当前source事实，human/installed门未接受。

2026-11-10 SGT 评审收尾：#590 F1/P2 的完整 App 反例先证实 unavailable 与 unread 提示相同，现增加独立 unavailable 提示并保留显式重试；不增加状态、自动探测或缓存。F2/P3 父计划路径指向实际 completed 文件。局部恢复反馈以独立复评和当前版本验证为收尾门。
