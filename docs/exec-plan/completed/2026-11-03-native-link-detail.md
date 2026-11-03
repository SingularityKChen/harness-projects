# 原生关联 PR 安全详情 ExecPlan

> 状态：Completed（实现与独立 MMP 评审完成；实际合并、产品发布和 R1 各自回读）
> 创建：2026-11-03
> 范围：Issue #519，父项 #508 的独立能力闭环
> 调查基线：main `957451c684c546ddf8a5d19cb3a23a719940fa9b`

## Purpose / Big Picture

用户打开#115/#110/#233无需StartWork，准确看到#159/#111/#397和来源关系/观察状态；不会把原生关闭链接误认为本产品人工已确认implements或执行链产物。

## Context and Orientation

与现DeliveryLineageSection并列新增“来源关联的PR”，放正文之后、执行谱系之前。mount目标来自safe current Issue locator+Host token，不依赖executionTarget/context是否存在，更不能让UI拼native query。A8/B-V全部输入已综审。


选择PlanningProvider的可选来源读端口。权威Issue primary与Project membership由它拥有；其Issue connection是真正关系事实源。Development端口直接读Issue需要新增Issue跨binding可信桥，现有PR-only nativeIdentity不能承担；另立provider域或扫描所有PR也不必要。R7真正约束是historical不可回查，并非禁止当前primary Issue node查询；旧project-only注释随新port就地标为旧读取面的描述，不能改裁决。

Planning可见不自动证明当前workspace的目标仓库/PR准入。选择明确的两种身份承诺：`ProviderRepository.sourceRepositoryIdentity?`是独立仓库canonical source identity（namespace+opaque id），不是扩大PR-only nativeIdentity；目标closing PR可以带合法PR nativeIdentity。现有nativeIdentity只保证相等，不能假定Development的externalId编码相同，所以Host不得自己换binding拼ref。另给Development可选 `getChangeRequestByNativeIdentity({repository,identity})` 及独立能力 `development.change_request.native_identity.read`；由目标Provider自己解析、核仓库、返回自己的ref/native identity。GitHub实现可复用现有按node query/仓库核验，不新增全史扫描。这个小桥只处理PR，完全不使Issue进入bootstrap nativeIdentity。

当前source Planning permission、workspace policy、绑定repo scope以及目标Development实际repo/PR read ack必须都成立。Host native观察拥有独立receipt/epoch；已有delivery denial发生后使旧native receipt失效。显式native refresh允许按当前实现能力/策略重做actual read；PermissionDenied遮新native集合，之后新的exact成功ack只恢复native receipt，不清除delivery health、不写/创建execution context，不把native关系摄入lineage。这样有保守拒读也有可验证恢复，不靠过期derived mask永久锁死历史Issue。所有新缓存为本代Host有限内存；无需DB写、schema或迁移。若实际沿用已有health marker才能闭环，可在重估后使用既有ack记录，但绝不把native ack当执行链完整确认。

### 源查询与空集合证明

Planning port输入为current `{project,membership,issue,cursor,limit}`，绑定、种类、configured project不符先拒绝零transport。生产GraphQL同次读membership node及其project/content、Issue node及其repository、`closedByPullRequestsReferences(includeClosedPrs:true)`；每页回证membership/project/Issue相等和canonical Issue repository。不能只凭binding相等做任意node代理。

每页输出必须是 `{source:{project,membership,issue,repository},items,nextCursor}`，source proof位于顶层，空items也保留。每item含PR native identity、repo canonical identity/name、number/title/url、state/isDraft、provenance固定source_observed/native_closing。不取body/作者/branch/totalCount。includeClosedPrs显式true；userLinkedOnly/excludeUserLinked保false；普通timeline和willCloseTarget都不是此查询的替代。A独立live read已观察三历史例，B独立live115和schema；实施时仍回读source receipt，不把设计时观察当候选已接受。

## Design / Spec

Client strict reader核workspace/workItem、closed schema/type和refresh/query的opaque receipt相等，拒raw error/未授权字段；已接受同步帧的generation与nativeAccessVersion透出到ClientWorkspaceRead，参与safe locator的access signature，使同workspace的Host代际或跨Issue准入变化在render前使旧观察失效；不解析scopeToken的组成。ui-model生成display union，React只呈现安全状态。展示repo/#number/title、草稿/打开/关闭/合并文字、安全http/https来源link、固定“来源记录的关闭关联”、观察时间与stale。unsupported/unread/denied/partial/offline区分；仅complete成功[]称“来源已确认无原生关闭关联”。不加确认implements、创建PR或修复执行链按钮。

首次新来源目标打开refresh一次随后query，manual“刷新来源关联”重试；sourceToken只绑定已接受的Host generation和current primary，accessToken额外包含nativeAccessVersion及既有权限快照。同一sourceToken的版本/权限metadata变化或重连只query Host，不自动actual probe，防止跨Issue拒读与恢复循环；effect只依赖stable source locator/access signature、reader与connected；普通新鲜度降级说明不进入access signature，展开mode/Markdown节点不能触发refresh。scope/permission/nativeAccessVersion/Host generation改变在render前隐藏旧view，异步按request ordinal+response scope拒晚回，unmount不set事实。UI不维护Host未授权last-good cache。draft/PR-backed/redacted/wrongscope不mount观察消费者；Host仍独立复验，UI gate不是授权。新source link使用小型严格safeURL helper，不依赖Markdown parser。

## Global Constraints

分支 `feature/native-link-detail`，base为 `feature/native-link-host`；在该分支的工作树根执行验证。用户已授权两路独立方案经第三位综审后持续实施；不重复确认、不自行合并、不改变规划 Status 或 native dependency。文件全集：`packages/client/src/issue-closing-links-reader.ts`、`packages/client/src/index.ts`、`packages/client/src/workspace-read.ts`、`packages/client/src/sync.ts`、`packages/ui-model/src/issue-closing-links-view.ts`、`packages/ui-model/src/work-item-detail-view.ts`、`packages/ui-model/src/index.ts`、`packages/ui/src/issue-closing-links-section.ts`、`packages/ui/src/work-item-detail.ts`、`packages/ui/src/work-item-project.ts`、`packages/ui/src/work-item-app.ts`、`packages/ui/src/workspace-setup.ts`、`apps/harness-plugin/src/client.ts`、`tests/contract/issue-closing-links-reader.test.js`、`tests/contract/ui-issue-closing-links.test.js`、`tests/browser/native-link-detail.test.js`、`tests/fixtures/native-link-detail-browser.mjs`、`docs/exec-plan/completed/2026-11-03-native-link-detail.md`、`docs/README.md`。owner：native-consumer-owner; shared detail入口由detail-integrator串行接线。不改变现有执行谱系、业务关系确认、bootstrap 原生身份登记、Storage schema 或 Planning 状态。

代码、测试、配置、fixture 新增加删除严格少于800行，文档少于1300行；估计代码570–780，接近790时先查真实重复或重新划分独立闭环，不删必要安全验收。锁文件和生成目录按仓库规则排除。H的authority算法、wire闭集与Store传播由Host owner持有；V保留严格边界，仅消费已接受的nativeAccessVersion与generation，不宽放未知字段、不以metadata事件触发actual恢复。命令以 `pnpm` 简写，实际使用锁定工具链 `npx --yes --package pnpm@10.28.2 pnpm`。本计划已移入 `docs/exec-plan/completed/` 并更新文档索引；安装证据和工程测试分开记录。

## Plan of Work

Batch 1闭环为生产Host到安全详情。Host跨Issue native准入失效以后，还必须验证真实watch在同Planning revision发metadata，sync接受version并使已打开A详情清除标题/仓库/URL/标识/计数；后台B的source/native403不得触发A自动probe，旧UI及Host回包不得复活，重复拒读不得热循环，显式retry重做actual read才恢复。先红测strict decoder、noncontent不mount、late reply、partial/offline不报不存在、native与manual/execution用语；用真实Host remote→client→ui-model→drawer的composed fixture，不手造最终view。实现reader/section和props传递。验证 `pnpm test:file tests/contract/issue-closing-links-reader.test.js tests/contract/ui-issue-closing-links.test.js tests/integration/harness-plugin-artifact.test.js tests/e2e/delivery-lineage.test.js`、`pnpm test:file tests/browser/native-link-detail.test.js`、`pnpm typecheck`。期望production消费全绿，toggle计数不增，no-context lineage仍为空/缺口，manual确认表不变。revert section/reader可保H/N。

Batch 2闭环为真实安装历史Issue阅读。`pnpm --filter @harness-projects/app-harness-plugin pack:plugin`并安装确切tarball，在真实Host依次115/110/233，回读对应159/111/397与完整source receipts/paging终止。记录source SHA、tarball hash、Host/profile、截图、remote readback与branch/worktree/run/PR/Planning/relations写入计数0。复验deny/recover、offline/partial、target switch晚回、keyboard link与light/dark/narrow。只有本片与N/H所有接受齐全才能Closes #508，否则Refs #508且保未验项。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 三历史例 | 安装Host115→159、110→111、233→397，未StartWork，exact source/artifact+完整readback |
| current scope/visibility | restricted title/id/url/count/alt/raw error不在DOM/aria/attributes；换scope无旧title闪现 |
| 状态含义 | unsupported/unread/denied/partial/offline/complete empty各自文案；拒读恢复需actual新receipt |
| 来源边界 | native manual按source_observed显示，mentions不入implements，willCloseTarget=false历史159仍发现 |
| 生命周期 | D toggle不重读，旧promise不挂新target，unmount无可见事实写回 |
| 无副作用 | 所有创建/Planning/业务关系写0；旧lineage/context和manual candidate测试未弱化 |

2026-11-03 SGT 初版父层上的本地工程验证（不代表安装Host或托管CI；跨Issue新父层证据见后续段）：

| 命令 | 实际结果 |
|---|---|
| `pnpm test:file tests/contract/issue-closing-links-reader.test.js tests/contract/ui-issue-closing-links.test.js tests/integration/ui-work-item-detail-read.test.js tests/browser/native-link-detail.test.js` | 10/10通过；包含代际变更、effect replay、同scope迟到、断线/纯来源降级不改安全详情 |
| `pnpm test:file tests/contract/issue-closing-links-reader.test.js tests/contract/ui-issue-closing-links.test.js tests/integration/harness-plugin-artifact.test.js tests/e2e/delivery-lineage.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail-browser.test.js tests/contract/ui-delivery-lineage-section.test.js` | 首轮99/99通过；后补代际边界见上一行 |
| `pnpm test:file tests/browser/native-link-detail.test.js` | 最终1/1通过；真实Provider/Host到production apply、两页、拒读恢复、Host重建、窄屏light/dark和键盘外链，主题/几何变化不重读 |
| `pnpm verify` | 最终typecheck通过，主套件3425/3425、MVP 7/7通过；没有弱化原有manual候选或执行谱系断言 |
| `pnpm boundaries` | 9/9通过 |
| `node scripts/workflow-check.mjs` | 8份workflow无finding |

旧父层完整3425+7结果不自动适用于后续Host authority修订或rebase。首轮reader/ui红测4项均因缺少真实功能失败；补强的strict boxed-state、同步generation透出和安全签名红测3项失败，修复后恢复。browser首次有效红测在来源section缺失处超时，接线后通过。实际运行日志位于执行上下文`.superpowers/ui-505-508-20261103/`，不作为发布产物提交。

新Host跨Issue准入版本适配的本地验证：

- `pnpm typecheck` 通过；冲突解法保留两个合法字段及继承的严格header/Store传播。
- `pnpm test:file tests/contract/issue-closing-links-reader.test.js tests/contract/ui-issue-closing-links.test.js tests/browser/native-link-detail.test.js tests/integration/harness-plugin-issue-closing-links.test.js tests/integration/issue-closing-links-scope.test.js tests/integration/ui-work-item-detail-read.test.js tests/e2e/delivery-lineage.test.js`：65/65通过。
- 在上述路径增加artifact、client sync/stream、workspace stream/read assembly、client浏览器、安全详情和旧执行/交付消费者的17文件组合：207/207通过，包含最终source/native两路真实403浏览器负控；本轮没有重跑全量verify，旧3425+7仅为原父层证据。
- `pnpm boundaries` 9/9通过，`node scripts/workflow-check.mjs` 8份无finding。
- 有效红测9项中6通过、3失败：安全签名缺version、同source变化重复probe、实际metadata到达后A旧UI仍未清。适配后绿；reader私有scope签名被spread进响应事实的新增红测1失败，改为精确workspaceId/workItemId白名单返回后也绿。
- 新浏览器夹具记录的是实际交付的wire frame；生产follower只对开场baseline调用accept，不能用该回调假装metadata未交付。UI按新version清空事实与strict sync单测一起证明实际接受路径。H另一个pending-newer/older403并发修订仍由Host owner独立验收，不由本组合绿替代。

## Progress

- [x] (2026-11-03 SGT) 最终N/H父层无冲突重放，V owner生产与测试文件先逐字节等同cbdd115；原17文件集在新父层211/211通过（H新增4项）。
- [x] (2026-11-03 SGT) 授权的官方JSX runtime fixture兼容小修，V单独真实浏览器3/3通过；组合已在最终6ab2e38源码通过31项browser，native真实安装三例随后由主控完成。

- [x] (2026-11-03 SGT) 子项 #519 已建立，独立验收边界与父项区分。

- [x] (2026-11-03 SGT) A8/B-V与生产props路径综审。
- [x] (2026-11-03 SGT) H冻结后consumer红绿与真实生产browser组合完成，工程验证见下表。
- [x] (2026-11-03 SGT) 适配Host nativeAccessVersion，保留已校验generation；版本变化同步遮蔽并仅本地query，新增真实跨Issue source/native403浏览器负控。
- [x] (2026-11-03 SGT) 独立V评审PASS：reader/UI/真实browser 11/11、控制46/46、6个变异均KILLED；N/H权限P1亦获各自独立PASS。
- [x] (2026-11-03 SGT) 主控已真实安装准确native source0e9257f与artifact eff55818：三历史例各唯一目标、观察时间/来源/merged/安全外链正确，v2审计23项前后相同。
- [x] (2026-11-03 SGT) 最终本地组合browser31/31及分清修订边界的3458+7回归通过，文档归档；联合M/D/G/R/Q的zoom与进一步布局接受由对应任务记录，发布/R1由主控另行裁决。

## Surprises & Discoveries

最终组合源码触达react/jsx-runtime，旧native浏览器夹具把该名字错误映射为React；组合三项失败，V单独三项原绿不能作为该组合路径已验证的证据。仅修官方runtime载入与模块精确分派；新独立V载体3/3通过，组合修补由集成器在最终6ab2e38源码实际回读31/31，不回写成原V独立PASS证据。

WorkItemDetail当前executionTarget不是Issue原生关系准入条件，不能复用它决定历史来源section。关闭/合并state不取消已有closing关系。

ClientWorkspaceRead原先没有head.generation；相同workspace/binding的Host重建不能仅用locator检测，所以按Global Constraints窄扩两个既有client文件，只透出已经校验的帧头。全量回归首轮3424项中3422通过、2项失败，原因是签名误含read.reason，使纯断线/来源降级改变完整详情；以新红测固定“新鲜度原因不是权限变化”，移除该项后窄测恢复。

H独立review发现跨Issue native403不使旧A观察失效，新增nativeAccessVersion经既有metadata路径传播；V重放时只在workspace-read/sync相邻字段冲突，保留双方合法字段、H严格校验与Store传播。本消费者区分稳定sourceToken和权限accessToken；后者变化不能自动重新探测Provider。H pending-newer/older403并发修订由Host owner持有，本消费者不改Core算法。

Browser初次partial夹具错误地让第一页即缺cursor，实际Provider拒绝整页后Host只能保留旧complete stale；修为第一页成功、第二页协议失败，才验证到真实partial。Host重建会执行既有Planning启动读取；零写入断言分别比较重建前native读取和重建后native读取的全表快照，不能把Host启动写入归为native副作用。

## Decision Log

Decision：组合M parser使React JSX runtime成为实际外部模块后，仅修本V浏览器夹具carrier：从已安装官方react/jsx-runtime构建，React保持页面唯一UMD，require仅精确放行react与react/jsx-runtime。Rationale：旧window.require对任意模块都返回React，使组合真实浏览器无法挂来源section；不能伪造JSX runtime或依赖本分支不存在的M helper。Date/Author：2026-11-03 SGT / 主控授权最终本地整合。

Decision：来源PR独立section与safe union，native关系只读、不进入人工/执行状态。Rationale：用户能看到真实历史而不制造工程或规划事实。Date/Author：2026-11-03 SGT / 独立综审。

Decision：以已接受wire generation加current primary Issue、Planning来源、能力快照和逐repository accessVersion形成稳定权限签名，refresh返回receipt仅作为随后的query成功集合的相等约束。失败/断线不从UI缓存保留旧native事实；Host明确允许的stale结果可以展示。Rationale：跨代际或错scope不复活旧观察；不新增权威事实源，不把scopeToken解码为平台身份。Date/Author：2026-11-03 SGT / native-consumer-owner。

Decision：nativeAccessVersion只参与accessToken；sourceToken仅为Host generation/current primary。相同来源的失效metadata和重连只query，不借失效事件做actual恢复；新来源目标或用户按钮才refresh。Rationale：跨Issue同能力拒读不能由观察者立即重探测并制造权限循环，render先遮蔽，Host自行裁决允许的当前集合。Date/Author：2026-11-03 SGT / native-consumer-owner。

## Idempotence and Recovery

打开/刷新可重复且无资源创建；Host允许的offline保值才呈现，denied/unknown马上清旧。先revert V可独立回旧详情，不损数据；H/N无需一起撤除。

## Interfaces and Dependencies

只依赖H wire/remote契约，不依赖M/D。使用Host locator+authority token，UI不看Provider ref/凭据。最终M/D/V接线后按同artifact复验style与toggle/read计数。

## Outcomes & Retrospective

### 最终真实安装与审计（2026-11-03）

主控在隔离Web Host 0.2.0-rc.2安装准确native source `0e9257f86bc03f674bdb1d8d71b385eec16bd6e5`；tarball SHA256为 `eff5581858865aa849b7dca06debe85d28d777fa1dc48598cfb6b4b66318f758`，所有已安装文件与该包逐字节相同。实际DOM/截图中的结果如下，每组仅一个公开安全外链，target为_blank、rel为noopener noreferrer：

| 当前Issue | 实际PR | 状态与来源文字 | Host观察时间（UTC） |
|---|---|---|---|
| #115 | #159 | 已合并；来源记录的关闭关联 | `2026-11-03T04:53:46.230Z` |
| #110 | #111 | 已合并；来源记录的关闭关联 | `2026-11-03T04:56:53.361Z` |
| #233 | #397 | 已合并；来源记录的关闭关联 | `2026-11-03T05:01:41.971Z` |

读取全程无需StartWork，未操作资源创建或Planning UI写入。安装v2审计窗口为04:52:56.175Z至05:03:15.304Z，23项计数完全一致：contexts、branch、worktree、run、业务/manual/explicit/candidate关系和mutation_attempt均0，已有PR实体15与PR身份15保持不变。该证据只覆盖列出的计数，不等于全库所有字段逐字不变，也不单独证明所有可能外部调用未发生；provider/account/credential行、仓库绑定与Planning sync总量明确不纳入此审计。旧受控生产fixture的全表逐字不变、fail-on-call写入口与安装计数是两类不同证据。

本地仓库绑定是取baseline之前的有意配置：最初仓库内profile被既有LocalGit输出根守卫正确拒绝，核验保留profile并迁至仓库外、真实UI绑定ack成功后才开始native读取审计。此过程没有产品修改，不把绑定写入冒充为零副作用窗口的一部分。

### 独立评审与本地组合范围

N实际拒读epoch候选b0c0eff的原始2例及独立20变体通过；H09ffd45的独立14例通过；V cbdd115的独立reader/UI/browser 11例、控制46例及6项变异全部通过。官方JSX载体兼容修补仅改fixture，后来独立V浏览器3/3与同源组合31/31均通过；不把该新范围追记为旧V候选已覆盖。

最终native源码0e9257f在N/H最终父层上的17文件定向211/211、Provider契约158/158、typecheck、boundaries9/9及workflow检查通过。跨8片首组合 `1a72834612027e8aef179e7b6ae46f78f47afca9` 本地verify为3458/3458加MVP7/7；只修fixture/plan后的组合 `6ab2e38c67940af54a32bc04c6126d0b36356764` 保持packages/apps产品树相同，并实际运行整个browser层31/31。未机械重跑最终6ab的3458全套，未把这些受控、有限工作负载的本地证据称作Hosted CI、通用性能或R1接受。文档归档后的最终提交只改变docs与历史，生产/测试树继续与已安装source0e9257f字节等价；实际安装事实仍绑定原source/artifact。


生产客户端已接入独立native观察section，真实GitHub Planning/Development解码器经Core、Host typed remote、client、ui-model与production apply到唯一详情抽屉，覆盖complete/partial/stale、actual native PR拒读恢复、两页来源、空集合、Host重建与关闭晚回。夹具仅替换HTTP transport，不手造成功的最终DTO；全部表前后比对证明native读取不落库，未StartWork。

本native消费工程评审与三历史例真实安装接受均已完成，故归档本计划；Refs #508保留父项人工裁决，不自行关闭rollup。其它任务的M/D/G/R/Q联合zoom与布局接受、托管CI、Ready/发布、人类合并及R1分别记录，不由本计划推定通过。

## Bottom Change Note

2026-11-03 SGT：综合A8/B-V，固定独立Issue locator、真实生产reader路径、三历史安装与零写入接受。

2026-11-03 SGT：完成消费者生产闭环；记录代际失效接口、精确receipt、红绿与首轮回归发现，保留实际安装未验收边界。

2026-11-03 SGT：在新Host父层保留generation与nativeAccessVersion，增加same-revision跨Issue拒读安全消费及query-only失效路径；初版完整绿的证据保持历史范围。

2026-11-03 SGT：真实安装native三历史例、安全来源显示和23项计数审计已接受，结合各层独立评审及有界本地组合证据归档V；保留独立发布/R1和其它任务zoom边界。

2026-11-03：本会话独立 MMP 全层评审 #525 完成，矩阵及真实验证见 `docs/review/pr-525-mmp-review.md`；本层未发现新增 P0/P1/P2/P3。人类本次直接授权本会话负责本 PR 的后续修复、独立复评、归档、提交整理、issue 核对及当前门禁通过后的 rebase merge，替代旧交付阶段“不自行合并”限制；不覆盖 Planning Status、原生依赖或 R1 裁决。此计划已在 completed，无需另建重复实现计划。

2026-11-03 新组合实际接受：clean `33472f2b1451b508b3d1c15d06acf3a078058bd7` 的完整3474+7、browser35、boundaries9、workflow通过；新包SHA-256 `7209b6e64a5572f68312bb57b43ad7fa8010d743f7995a63c9b92541a72c115a` 的12文件/文件集合与实际安装逐字节相同。真实115→159、110→111、233→397均为唯一qualified仓库、native来源/时间/安全外链；M/D/G/R/Q/V联合与原生200%光暗8布局通过。07:48:23.481Z–07:48:43.500Z 的23计数无变化，后续07:56:50Z再核亦无变化；不把此计数证据外推全库或任意外部调用，已有绑定在窗口外。任务Host已核对进程组并停止。旧安装证据仍绑定其旧输入，本段新安装覆盖本轮修复；R1仍独立。详见本PR评审与批次评审，最终head/base/CI/批准以回读为准。
