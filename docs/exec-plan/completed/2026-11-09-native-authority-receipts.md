# Native authority 因果票据 ExecPlan

> 状态：Active，已实现并完成本地窄验证，待独立验收与发布；创建：2026-11-09（Asia/Singapore）
> 正式路径：`docs/exec-plan/completed/2026-11-09-native-authority-receipts.md`
> Issue：#591；范围：独立修复现有 Issue→PR 读取的 P1 因果缺陷；规范：`PLANS.md`、`AGENTS.md`

## Purpose / Big Picture

最近一次实际拒读以前启动的原生关联刷新，不能因为另一 Issue 后来恢复权限而重新发布旧事实。用户在现有 Issue 详情中看到的 PR 必须有最近拒读之后的明确证明；metadata仍只撤销事实，不自动探测。最小成功证据是现有生产Host读取与真实浏览器同时拒绝旧成功，新的显式刷新仍可恢复，业务数据零写入。

本PR从main独立完成，不引入新的Issue dependencies功能。#590随后实际消费本PR提供的同一Core票据API，形成唯一必要stack；仅合入本修复不会自动修好#590 consumer。

## Context and Orientation

调查基线为main在2026-11-09观察的`c9bb17b833295f26c750bd8c4bf425df53e9701f`；执行前锁定实际base/head。`packages/core/src/issue-closing-links.ts`的owner持有authority Set、metadata epoch、sourceVersions、请求序号与本代cache。`observeAuthority`只在首次Set插入时推进epoch，完整成功只比较epoch再清authority。Provider自己的denialEpoch只限制descriptor恢复，不能证明旧Core请求获得新授权。

独立现有能力反例：B实际拒读使epoch进入1；hold A的实际读取；B再次实际拒读但epoch仍1；B之后显式完整恢复；release A，旧A仍返回complete/links=1。另一条Issue恢复了当前布尔权限，却没有给旧A补足最近一次否定之后的因果证明。这已在真实生产Host服务、只替换HTTP transport时复现，不能由简单串行B deny→A恢复→B deny通过而否认。它不是实际GitHub权限事件或installed接受。

现UI在同来源metadata变化时仅query，首次来源/用户按钮才refresh；该无probe循环合同保持。`getIssueClosingLinks`是本地cache查询，不读Provider。

## Design / Spec

裁定在现owner增加一个CoreContext内单调`negativeReceipt`，与metadata cohort epoch分开。epoch继续只在首次进入拒读cohort时换代，控制可见事实失效通知；receipt证明异步请求发生在最后一次否定之后。每次当前source的actual permission_denied/not_supported均推进receipt，即使authority已在Set；descriptor首次建立新的明确拒读同样推进，反复query/describe同一已知denied不制造新事件。成功、恢复、watch、cache读取不推进也不回退receipt；NOT_FOUND继续沿已有resource/sourceVersions机制，不变成binding级authority拒读。

最小Core内部API固定为`issueAuthorityReadAccess(context, bindingId, keys)`返回`{generation, epoch, receipt, denied}`，以及`observeIssueAuthority(context, bindingId, key, denied, proof?)`。`proof`包含原`generation`、`epoch`与`receipt`；成功清拒读必须三者仍相等，缺proof不清。receipt使用bigint内部计数避免静默溢出；不序列化到wire。现有module已经由core/index的export-star导出，无需再手工加barrel。observer调用方必须先证明否定仍属于当前source，不能把该API当任意恢复权限的入口。

refresh在首次异步scope/describe/Provider等待以前捕获原ticket；`current()`、各key实际成功恢复、complete/partial事实发布和cache写入均要求原receipt仍有效。不得在成功页、target ack、B恢复或descriptor变available后给A重新签票。acceptDenial路径只允许提交空denied/unsupported/unread，不得更新原成功ticket或保留旧links、title、URL、时间/属性。cache entry记录receipt，get只有scope/epoch/receipt都匹配才返回；因果失效禁止offline/partial/lastgood fallback复活旧事实。`issueSourceReadAccess.version`纳入同一receipt字符串，使既有PR选择的source proof也不能绕过否定；不改变它的public wire形状。**Superseded by 本节下一段的 granular source proof 决策（2026-11-09）。**

新证据推翻上述全局 source proof 假设：`planning.issue_closing_links.read` 被拒时，`planning.item.read` 仍可独立实际读取；既有 Issue target summary 不应被无关 native port 的 deny 遮蔽。native PR refresh/recovery/cache 继续比较 Context 全局 receipt；`issueSourceReadAccess.version` 仅含 Context generation、PlanningItemRead authority version 与对应 resource version。复用现 `sourceVersions` Map，在每次有效 PlanningItemRead actual deny 单调递增该 authority address；首次 descriptor deny 同样推进，重复已知 snapshot 由 `allowed` 去重。native-only 和 Development-only deny 不改 source version。这样旧 source-held 读不能跨重复 ItemRead deny，而独立 Issue target 的权限仍保持 granular；恢复不回退 source version，不改变 wire。

恢复仍要求当前source实际且完整回证，PR source共享门必须reference/closing双流完整；unavailable/malformed/partial、pending dispatch和控制流到达均不是恢复证据。保留每workItem请求序、source资源版本与现权限/policy门；receipt不能替代这些范围检查。

actual响应及describe结果在写否定前，先同步核对已捕获committedFence与runtime planning/delivery scope代际。当前同源否定即使请求已超时/被新request supersede仍要观察；account/config/binding/primary/membership经权威Storage提交已变化时，旧否定不得污染新scope。不得为晚deny添加无期限Storage await；Host退休由独立CoreContext owner和现remote guard隔离。成功路径仍完整回证scope；同步fence不是成功授权替代。

备选按(binding,key)维护receipt向量能少废弃无关读，但PR链动态发现Development keys，增加登记/逐出/漏key风险。当前无测量证明有此吞吐需求，选择一个counter，接受本Context内其他native deny保守废弃并发读的代价。不建立权限框架，不每次deny推进metadata，不仅检查当前denied布尔。

## Global Constraints

分支`fix/native-authority-receipts`，工作树`.worktrees/native-authority-receipts-20261109`，从main独立PR；只修现有native PR读取。dependency工作树的未提交helper不是main事实，不能复制后假称原基线。#590必须后续base此修复并改为消费同一ticket，不能另造counter或只依赖旧epoch/denied。

唯一生产owner文件为`packages/core/src/issue-closing-links.ts`。测试owner文件为`tests/integration/issue-closing-links-scope.test.js`、`tests/integration/harness-plugin-issue-closing-links.test.js`、`tests/browser/native-link-detail.test.js`；仅现有barrier不能表达所需时，改`tests/fixtures/native-link-detail-browser.mjs`。文档为正式路径本ExecPlan，docs/README索引由主控维护。不改Provider/capabilities/domain/storage/controller/client/wire/Host/UI生产文件，不新增operation、schema、迁移或兼容路径。

目标代码新增+删除（含全部tests/fixtures）<250，硬上限<800；预计生产40–70、Core/Host判别70–110、browser30–50、fixture0–15，总140–245。文档<1300。超过249先审是否重复夹具/矩阵并解释，不能删必要反例、藏tests或不可读压行；超过799停止发布重新定界。无模型请求、Planning/关系写入、自主merge或用户库修复。

## Plan of Work

### Batch 1 · 现有原生读取因果修复

最小闭环是现有PR来源读取在重复拒读/第三方恢复后永久拒绝旧票据，当前显式重读恢复，无metadata探测回圈。主文件为既有observer/refresh/cache及现有Host/browser反例。

先在main独立工作树补RED，用现成intercept/barrier参数化：B actual deny→hold A→B repeated deny→B双流成功恢复→release A。两条实际持有路径至少覆盖PlanningIssueClosingLinks与DevelopmentChangeRequest；PlanningIssueReferences用同矩阵补另一source stream，不能只mock helper。原实现须因旧A complete/links泄漏而红，不能以fixture/import失败作RED。再按Design加入counter/API、捕获、恢复、发布和cache检查。

补相邻正控：B恢复后真正新启动的A显式读可complete；双流不完整不能清拒读；same-source超时late deny仍有效；Storage提交换account/binding/membership/primary后旧late deny无效；不同CoreContext/retired Host不互相污染。source/资源既有门继续由原测试保护，不借此扩成新权限机制。

在检出上述分支的工作树根运行：V1 `pnpm test:file tests/integration/issue-closing-links-scope.test.js tests/integration/harness-plugin-issue-closing-links.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/integration/create-change-request-link-recovery.test.js`，期望新反例先RED再全部GREEN。V2 `node --test tests/browser/native-link-detail.test.js`，期望真实Host→strict client→App现有PR链通过新反例及原metadata/retired回归。V3 `pnpm run typecheck`、`pnpm run boundaries`，期望退出0；仅新失败/边界信号扩大测试，不用全量baseline替代本次反例。

V4 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`、`git diff --numstat origin/main...HEAD`，期望机械检查通过、diff整洁，含测试实际计数符合更严预算，并人工检查凭据、本机身份、个人信息、内部系统、保密字样。PR必须关联该独立P1 Issue，含本计划Batch1、真实验证、风险/回滚；最终push回读当前head/base/checks/Issue/完整threads才ready，人类决定merge。

V5 `pnpm verify`，期望 typecheck、contract、integration、e2e 均退出 0；这是相邻 consumer 证据推翻原假设后的最终扩大验证。

回滚点为完整独立提交。#590之后rebase并改consumer时独立核实其双向read也捕获和恢复完整ticket；本Batch不修改其F2/F3或新UI，不宣称consumer已修复。

## Validation and Acceptance

V1/V2必须证明repeat deny时metadata epoch稳定但内部receipt失效；B恢复不使旧A返回任何complete/partial事实或cache fallback；新A显式读可恢复。去掉receipt比较、把receipt只在首次Set插入递增两个反向修改都应使held反例重新失败。实际成功恢复、最终publish/cache以及本地query不得有任何旁路。

浏览器在release旧response后，DOM/AX无旧PR标题、号码、URL、仓库名、计数或aria/title泄漏；metadata到达仅query，refresh次数不增，settle后Provider请求不继续增长。保留原UI文案、busy/disabled、Tab/Enter/Escape合同，不做视觉改版。SQLite业务表dump和operation列表证明零Start Work/PR creation/关系/Planning写入。工程测试不替代installed、人类/UAT或R1接受。

## Progress

- [x] (2026-11-09 20:45 +08) 两位独立作者完成；第三方收敛main根因、cohort/receipt职责、生产路径与预算。
- [x] (2026-11-09) Batch1 本地实现：原生三路径 held 反例先因旧 A 返回 links=1 而 RED；修复后目标验证通过。独立反例复评由主控继续。
- [x] (2026-11-09 21:09 +08) 独立验收及粒度修正复评无可行动发现：独立91相邻测试、24 Core/运行态探针通过。工程闭环归档；发布与远端易失状态按V4即时回读，#590另行消费验证。

## Surprises & Discoveries

简单串行deny/恢复测试全部绿仍不足：只有同cohort repeated deny与第三方恢复夹住held A，才能否证epoch即因果版本的假设。Provider可保持自己的denialEpoch正确而Core仍泄漏，因为另一个请求已恢复当前descriptor。main的actual/describe写否定入口也须先检查同步source fence，不能以current()在其后运行代替写前范围验证。

## Decision Log

Decision：采用一个owner内部receipt，保持cohort metadata不变；所有成功恢复/发布/cache比较原ticket。Rationale：最小修正因果，不增加UI探测或动态key向量，完整覆盖现有能力独立P1。Date/Author：2026-11-09 20:45 +08 / 独立收敛评审者。

Decision：先独立main修复现有PR，再让#590消费同一API。Rationale：已有独立现有能力反例，且新consumer实际需要本修复契约；不以共享文件或预算凑stack。Date/Author：2026-11-09 20:45 +08 / 独立收敛评审者。

Decision：保留现有 granular 权限合同，source version 仅受 PlanningItemRead 与对应资源否定影响，native PR 读取仍用全局 receipt。Rationale：相邻既有生产 consumer 的独立可读 Issue target 正控实际失败，证明全局 source receipt 会扩大遮蔽；不修改或削弱既有断言。Date/Author：2026-11-09 / 主控裁定与实施者。

## Idempotence and Recovery

读取可重复；有效deny使receipt单调增长，恢复不归零，数值不是外部合同。ticket只存本Context内存，销毁自然失效，不持久化或逐出仍在途证明。测试仅用隔离临时库。失败保留反例，不清authority/receipt造成功；revert整体PR即可恢复原实现，无数据回滚。已有#590consumer依赖新签名时，先回退consumer或同步回base并保留P1未解决记录，不能留下编译断裂或假安全保证。

## Interfaces and Dependencies

使用现有Node>=22、pnpm10.28.2、CoreContext/committedFence/runtime access、typed Host原操作和真实浏览器fixture。新helper是Core内部因果证明，不是客户端授权令牌；receipt不进wire/nativeAccessVersion/业务revision/Storage/Provider API。已有source/resource票据和请求序各保留职责；本次不扩NOT_FOUND或业务确认语义。

## Outcomes & Retrospective

在检出 `fix/native-authority-receipts` 的工作树根完成本地实现。V1 基线 53/53；新增 held A / repeated B deny / B recovery 在 Planning closing、reference 与 Development target 三路径均先观察旧 links=1 而 RED。修复增加内部 bigint receipt，保留 cohort metadata，恢复要求原始三元 proof；实际与 descriptor 否定先同步回证 source fence。最终候选生产文件 SHA256 为 `2ca895b46888f79ae82e46e2a42e184067767632232052c07ec91543a5c8c29b`；V2 6/6、V3 typecheck 退出 0 与 boundaries 9/9；原两文件加新增 granular source proof 判别后 64/64，通过未修改的相邻创建回证 48/48；最终 V1 总计 112/112。V5 退出 0，contract 1423、integration 2083、e2e 226，共 3732 条、0 失败。新测试还覆盖原 proof 缺失/过期/异 Context、primary/membership/projection 已提交切换及实际 Host 的 account/configuration/binding A→B→A 后晚否定，保留既有同源超时晚否定、双流部分恢复与零业务写证据。

两个反向修改（receipt 仅首次递增、移除原 receipt 比较）分别使三条 held 反例 3/3 失败；移除 source fence 使三个已提交切换晚否定反例 3/3 失败，均恢复生产文件后重跑。当前未提交工作区对 `origin/main` 的实际 numstat 为代码新增 128 / 删除 24（合计 152），文档新增 109；提交发布前以 V4 重算。测试编写过程中两个 Host 种子曾因配置字符串不符合 schema、disabled binding 仍声明 default 而失败，已改为合法配置与挂载组合；这些 fixture 错误未作为缺陷 RED 证据。相邻 PR 创建回证首次扩大检查为 47/48，唯一失败 `native relation denial alone preserves independently readable Issue options and summary` 推翻了全局 source receipt 假设。**Superseded by Design / Spec 的 granular source proof 决策（2026-11-09）。** 依主控裁定保留该既有断言，通过缩小 source version 的否定范围恢复相邻 48/48；新 source 版本隔离反例先因 native-only deny 错误改版本而 RED，再随最小修复 GREEN。尚无新增技术债；receipt 的 Context 范围意味着无关 native deny 也保守废弃并发读，这是明确接受的安全取舍。没有 installed、人类/UAT 或 R1 接受声明；#590 是否实际消费并通过对抗门另行证明。

## Bottom Change Note

2026-11-09 20:45 +08：综合两路方案收敛独立P1闭环，分离可见cohort与不可回退receipt，固定捕获/恢复/cache/晚deny范围门及真实必要stack。

2026-11-09：记录真实生产 held 反例 RED/GREEN、receipt 与 source fence 的 mutation 判别、本地窄验证及 fixture 修正；独立验收、提交发布和远端回读由主控继续。

2026-11-09：相邻现有正控推翻全局 source receipt 假设，在原处标记 Superseded，改为现有 sourceVersions 的 PlanningItemRead 每次否定版本；保留既有 granular 断言，并新增 RED/GREEN source 隔离判别。

2026-11-09：granular 最终候选 V1 112/112、V2 6/6 与 V5 完整 verify 3732 条全部通过，记录最终 hash；仍待独立验收与提交发布回读。

2026-11-09 21:09 +08：独立完整及 granular scoped 复评完成，保留原 source 权限独立性；工程归档，#590消费与人类评审/合并不由本归档代替。

2026-11-09 21:12 +08：现有#583已合入main，本分支重新基于该main；生产因果模块保持既有验收hash，新增基线身份连续性由完整验证与组合门复核。最终base/head以PR回读为准。
