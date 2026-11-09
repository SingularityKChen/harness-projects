# PR #581 MMP 工程评审

## Purpose / Big Picture

验收创建PR前预选原生负责人、原意图持久化和恢复；PR确认、来源Issue关系及分配结果互相独立。工程Ready不替代安装、人类UAT或R1。

## Context and Orientation

2026-11-07 SGT，在检出 `feature/pr-assignee-creation` 的工作树根审查。受验源 `7b89d9fc`，唯一父/PR层base `8f0e2f8a`（上游#568）；完整tree等于owner最终3964914f。overview#569独立，必要native stack582仅#568→#581。因非默认base的关键词未自动产生关闭连接，已显式原生关联并读回581↔557两向。

易失事实运行 `gh pr view 581 --repo SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup`、`gh pr checks 581 --repo SingularityKChen/harness-projects`；另用GraphQL分页读完reviewThreads、closingIssuesReferences和Issue557的closedByPullRequestsReferences及stack entries。期望当前head/base正确、required PR Fast Gate与相关lane成功、557两向成立、无未决线程；旧Ready不能代替新head。

## Design / Spec

| 风险 | 最终裁定 |
|---|---|
| P0 事实源 | 无发现；原actor/作者、Planning与Issue关系原链保留，完整Planning投影前后相等。 |
| P1 身份/副作用 | 首await前冻结IDs、非空根metadata/canonical；同binding三cap预检；稳定key只指原create operation和原IDs，完整actor/receipt校验。已有记录不重复写，未知只恢复。 |
| P1 最终出口 | A公共拒绝和早捕获version、最后create receipt、Host末读均保护独立分配摘要；创建失败add0、部分读回保留PR确认。 |
| P2 UI权威 | 原旧写响应压过新Host unknown已修：current access/operationId/targetStamp匹配的新读主导；等待/blocked/mismatch不恢复旧成功。 |
| P3 就绪/草稿 | 正常StartWork结果通知只重挂picker；父Create key为scopeKey，内部owner/token围栏保留。迟到请求完成屏障、同项草稿/currentpending真实浏览器验证。 |

## Global Constraints

代码/测试/配置<800、文档<1300；实际按PR层base计数。独立评审只读产品树，实验仅精确源导出；不为覆盖率删除防护或伪报变异。当前未发布A003DDL与旧shape拒绝/原库保留/匹配artifact裁定继承，不新增迁移或版本兼容框架，不改Planning Status/阻塞边。

## Plan of Work

Task1完成TDD与纵向链；独立任务审查发现P2/P3后交原owner一批修复，真实浏览器再发现父key重挂丢草稿并在同scope修复。随后补精确旧请求完成屏障，scoped复评全部ADDRESSED。整理完整同tree提交后新最终席做全分支、最终源变异及组合解析审读；源码head托管/两向Issue/线程全部通过后Ready。归档文档head继续同门，未经人类决定不merge。

## Validation and Acceptance

在上述分支根执行过 `pnpm verify`：548f05f对应contract1404/1404、integration2072/2072、e2e226/226及typecheck；独立Git比较548→最终7b只变browser与计划，生产/其它测试层/fixture逐字相同。396对应当前 `pnpm test:file tests/browser/workspace-execution.test.js` 11/11且完整tree等于7b；boundaries9/9、workflow7文件、披露/规模/diff检查通过。集合重叠不累加，未声称后续重复本地全量。

最终源独立新执行Core/UI7/7和生产browser3/3；精确export946跟踪普通文件实验后逐字差异0。所有危险变异基线/恢复退出0，错误结果为具名业务AssertionError。

| 危险变异 | 判别 | 结果 |
|---|---|---|
| metadata不进入fingerprint | Fake/SQLite原IDs冻结 | KILLED |
| 原稳定恢复错用latest | 较新人工终态不能替代原operation | KILLED |
| A公共已有record guard移除 | 完整原actor+同stable key，saved/failed外部add2违反至多1 | KILLED，继承防护实测 |
| 原actor比较删除 | 同IDs/PR的另一actor不得继承 | KILLED |
| 最后create receipt比较删除 | 末次授权await替换receipt不得confirmed | KILLED |
| Host最后分配观察去掉 | 旧confirmed不能越过最新遮蔽 | KILLED，observation seam |
| permission两围栏同时移除 | 原拒绝保留及version传递两处修改，regrant旧成功不能洗白 | KILLED，明确复合 |
| 仅去B original分支 / 仅去result拒绝 | 各自仍被另一层保护 | 两项0→0→0，不计KILLED |

精确patch/selector/SHA256/原始日志保留在该工作树 `.superpowers/sdd/2026-11-07-pr-assignee-creation/final-review/`；没有将环境、语法或空selector当成死亡率。不同binding只有显式guard静态审查，未冒称独立执行。

真实carrier/Host/SQLite与合成GitHub Provider覆盖丢create/assignment ack、partial、create403、原failed只读、token/断连/迟到/pendingconsumer和三关系。关系控件使用原生selectOption+Tab可达，checkbox为Space、提交/恢复为Enter；独立最小HTML的原生菜单箭头限制不计产品RED。浏览器source target是fixture；native Planning target decoder证据属于Host三态用例，两者不扩大合称全原生Planning浏览器。

## Progress

- [x] (2026-11-07 SGT) Task1及修复复评完成，最终系统审查零未决P0–P3；7项业务变异和2项分层保护如实归因。
- [x] (2026-11-07 SGT) 源码7b89d9fc全部11项托管checks、双向557、stack582和完整线程通过后Ready回读成立；后续文档head重新检查。

## Surprises & Discoveries

首轮verify只有descriptor arity10→11遗漏；第二轮只有默认无人多传空[]的primitive差异，分别止于contract/integration且未启动后续层。之后空选省略可选尾参、非空传冻结IDs，均具名判别。旧组件测试没覆盖父key实际重挂，native403/Host元数据浏览器RED暴露后只改Create子树key；旧sharedlineage与A事后区安全key不改。测试晚到断言原先缺响应完成屏障，最终按原Request完成和下一帧闭合，未靠sleep。

## Decision Log

2026-11-07 SGT：复用A稳定协议而非随机client key/latest发现；不把进度写回createReceipt。可选ABI采用空选缺席、非空11参数；已有结果通知仅触发picker重读，非授权事实。父Create key保留scope，内部token/generation裁定当前读取。若这些选择错，分别损害幂等、Host ABI或草稿/迟到安全，均有对应具名反例。

2026-11-07 SGT：总览独立，文本交叠不增加stack。组合有两个机械解析块：函数签名联合presentation/refreshToken/onSettled与creationRefreshToken；末尾保持summary隐藏Create/刷新按钮，同时Create用scopeKey并转发creationRefreshToken，detail onConfirmed仍纯读。两种刷新token不混用；未发现语义依赖或新P0–P3。

## Idempotence and Recovery

同create key+规范IDs幂等，换IDs冲突；空/省略同义。原failed保持原记录，修权限后事后区可新显式intent；unknown不补写原未决操作。先撤B再撤A，保留外部PR/负责人和原库。旧读端可能拒绝新增根JSONmetadata，运行旧artifact须用其匹配的已验证备份/隔离库，不把代码revert冒充原数据无缝兼容。

## Interfaces and Dependencies

同一Core assignment协议、可选三cap与当前权限围栏，Host严格尾参、client单次冻结、picker局部key和现有source watch。GitHub关闭关联与Project机械字段按明确repo回读，不写规划Status或native blocking。复核时以当前PR native base为准，不以main累计diff替代单层预算。

## Outcomes & Retrospective

源码7b独立验收与该head托管Ready成立，未merge。B+UI本地组合受验synthetic `ae0574b`（B396 tree等于7b，UI c6dcf8c1），解析blob `9deaf156da07d9f606b4ac5506b7abfab632d4fa`；窄147/147、完整browser67/67、boundaries9/9、typecheck通过。这个组合含两处已审读文本解析，不是自动无冲突合并、远端merge或组合全量verify；合并这些独立PR时需保留上述解析规则。

实际token/GitHub写入、安装Desktop、人类UAT和R1均无本轮新接受证据。最终归档head的checks/Issue/线程与Ready须重新回读，不借历史代码head放行。

2026-11-09 SGT事后回读：源码 `7b89d9fc` 在Ready之后触发的可选GitHub review session（run42363402667）失败，日志为自动评审入口HTTP404，mergeStateStatus为UNSTABLE；此前11项checks仍SUCCESS。独立工程评审已完成，此辅助流程失败不扩大为产品验证失败或本轮重跑结果。最终文档head仍须push后回读checks、关联和线程。

## Bottom Change Note

2026-11-07 SGT：归档完整任务/最终矩阵、原失败与修复、7项危险变异/2项分层保护、机械解析组合与源码head Ready；保留最终文档head门。

2026-11-09 SGT：恢复中断后的收尾，限定源码Ready前11项checks的历史身份，补记事后自动评审入口404；未重跑产品suite或修改运行环境。

## 2026-11-09 独立 immutable-head 复评

本轮受验 head 为 `773d117f17a7057b6b4814358a204e066efc43d9`，净层 base 为 `8f0e2f8ac33ea7a58700750626748d85502e278a`（`feature/pr-assignee-management`）。在 `.worktrees/pr-assignee-creation-20261107` 执行，只追加本节，不把旧 head 的结论移作当前证据。包含系统是工作项到原生 PR 的交付链；目标是用户的原生负责人选择随创建身份持久化，重开或丢回执后恢复同一操作，且创建、Issue 关系、负责人确认保持独立。硬约束是 Host 权威、Provider ack/readback、原 actor/目标身份及 Planning 状态不变；安装态与真实 token 验收仍是独立门。

### 先验风险矩阵及最终裁定

| 级别 / 层 | 必须证伪的失败 | 本轮验证路径与当前状态 |
|---|---|---|
| P0 / 代码与架构 | 破坏 main、凭据泄露、第二 Planning 事实源、未获确认冒充 Saved | 全净 diff、边界 9/9、typecheck、披露机械扫描及人工五类检查通过；未发现。 |
| P1 / 创建身份 | 首 await 后 IDs 被改写、同 key 换 IDs、恢复关联错误 PR/actor/binding | Core/client 冻结、fingerprint、稳定 key、receipt 校验与具名反例通过；未发现。 |
| P1 / 持久副作用 | create/add ack 丢失或进程重开重复写、原未决记录丢失、并发绕过准入 | SQLite 重开、两个 Core 并发、原 pending/unknown 只读恢复与 failed 新显式 intent 通过；未发现。 |
| P1 / 产品闭环 | create/link/assign 部分成功被混同、当前权限撤销被旧成功覆盖 | 独立摘要、当前 Host 观察、deny/regrant、最后 create receipt 和部分读回反例通过；未发现。 |
| P2 / 交互 | late request 污染新 scope、重读或刷新丢 draft、denied/unsupported 无可操作反馈 | 组件及完整生产组合浏览器 11/11，包含原请求完成屏障、同项草稿及 pending 消费者；初始“未发现”被下节 repo-only 反例 F1 Superseded（2026-11-09）。 |
| P3 / 维护和工作项 | 无必要第二协议、过度框架、测试只镜像实现、漏验 #557 或重复问题 | 单一分配协议复用、四项新变异判别、净层预算和 #557 对照通过；无新增跟踪项。 |

事实锁定来自本轮缓存读回：PR 非 draft，mergeable=`MERGEABLE`、mergeStateStatus=`CLEAN`，11 项 check 均 `SUCCESS`，含 `PR Fast Gate`；#557 双向关闭关联存在。检查是托管证据，不代替本轮本地执行。完整 review/comments/threads 由主评审统一回读并汇总；本子评审不提交外部 review。

### 关键机制与交付闭环

净层全部 20 个文件已审读。`packages/core/src/create-change-request.ts:219` 在首 await 前取得原字段、复制并规范 IDs，`:237` 保存根 metadata、`:53` 将其纳入 canonical；不把可变 assignees 放入 Provider PR 身份证明。`packages/core/src/change-request-assignees.ts:28` 以原 createOperationId 与原 IDs 派生稳定键，`:29` 比较完整原 actor 指纹，`:75` 后已有记录仅恢复原 operation；没有记录才沿 A 的持久准入认领。人工后续 sequence 不取代原创建摘要，原失败记录不被新显式添加改写。

`packages/core/src/create-change-request.ts:143` 至 `:157` 分别处理 Issue 关系、负责人和 PR 结果，最后核验原 create receipt。`apps/harness-plugin/src/host-composition.ts:72` 的末读及 `packages/ui/src/create-change-request-section.ts:73` 的当前 operation/access/target 匹配阻止旧写响应覆盖最新遮蔽。创建拒绝 add=0；创建成功、分配拒绝或部分读回保留 PR 确认和原 Planning 投影。断连和迟到响应都未出现第二创建入口。

本设计与规模适当：只扩展既有 create JSON metadata 和可选第 11 个 Host 参数，复用原 A 的 add/resume、receipt、权限版本和序号协议；无需新表、Provider 实现、持久队列或兼容框架。两模块存在静态循环 import，但互调仅发生在函数调用期，本轮导入、typecheck 和运行验证无初始化问题；未据此提出纯审美拆分。默认无人省略尾参并保持原 canonical，来源关系仍由独立 issueSelection 决定。

### 本轮执行证据

以下命令在上述受验 worktree 根执行，均退出 0；不同测试集合不合并计数。

| 命令 | 实际结果与边界 |
|---|---|
| `pnpm test:file tests/integration/create-change-request-assignees.test.js tests/contract/ui-create-change-request.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-change-request-operation.test.js` | 99/99；冻结、同 key 冲突、丢回执、稳定记录、原 actor、并发、权限、Host ABI/摘要与 UI 消费。 |
| `pnpm test:file tests/integration/create-change-request.test.js tests/integration/change-request-operation.test.js tests/integration/create-change-request-link-recovery.test.js tests/integration/change-request-assignees.test.js tests/contract/storage-contract.test.js` | 298/298；既有无负责人路径、Draft、Issue reference/closing/none、关系发现、恢复和 Storage 合同回归。 |
| `pnpm test:file tests/browser/workspace-execution.test.js` | 11/11；真实 Host/client/SQLite carrier，合成 Provider；负责人 Tab/Space、Enter 提交/恢复，关系 selectOption 与 Tab 可达。 |
| `pnpm run typecheck`；`pnpm run boundaries` | typecheck 退出 0；边界 9/9。 |
| `node scripts/rule-checks.mjs disclosure 8f0e2f8ac33ea7a58700750626748d85502e278a 773d117f17a7057b6b4814358a204e066efc43d9`；同参数 `size` | 披露通过（该命令未注入 PR_BODY，PR 正文另行人工审读）；净层代码/测试/配置 570 行、文档 290 行，均低于计划更严预算。 |
| `git diff --check 8f0e2f8ac33ea7a58700750626748d85502e278a...773d117f17a7057b6b4814358a204e066efc43d9`；`git diff --check` | immutable diff 与本地追加记录均无空白错误。 |

为检验本轮读到的四个关键防护，使用仓库 `scripts/review-mutate.mjs` 在精确 head archive 的独立临时导出执行整表；未修改受验工作树的生产或测试文件。每项都有 `killedBy` 具名归因，基线及还原后基线均绿，948 个导出跟踪条目前后逐字相同。运行态 spec、日志和 equality 结果保存在主检出 `.superpowers/pr568-pr581-review-20261109/581-independent-*`，下表自含判定，不依赖该目录充当正式说明。

| 变异 | 具名判别 | 本轮结果 |
|---|---|---|
| 从 create canonical 删除 requestedAssigneeIds | Fake/SQLite `preselected native IDs freeze before first await and assign only confirmed PR` | KILLED，两种介质均业务断言失败。 |
| 创建摘要改为最新 assignment | `lost assignment ack reopens exact stable operation without redispatch` | KILLED，人工后续终态不能替代原操作。 |
| 删除原 create actor 指纹比较 | `stable key cannot adopt another actor even when native IDs and PR target match` | KILLED。 |
| 删除最终 create receipt 比较 | `last local assignment authorization await cannot return a replaced create receipt` | KILLED。 |

### #557 验收、去重与结论

| #557 条件 | 本轮工程裁定 |
|---|---|
| 允许候选或不指定，明确 unsupported/denied 反馈 | 创建 picker、清空按钮、缺方法/三能力预检、native403 和修复连接反馈具名通过；默认无人不依赖新增能力。 |
| 原生 IDs、ack/readback 匹配，作者独立 | 冻结原 IDs、严格原 PR 和 actor 校验、部分 readback 保持 unknown；Provider create 不传 author，未复制 Planning assignees。 |
| 恢复保留原元数据，不重建 PR 或改 Planning Status | SQLite/新 Host peer 重开、两个 Core 并发和不可重复 add 通过；Planning 投影前后相等。 |
| 区分创建与分配拒绝/unknown，负责人为空不影响 Issue 关系 | partial/denied/create403 与三种关系、既有无人关系恢复回归通过；独立摘要不更改 issueSelection。 |

本轮检索全状态 assignee/assignment/负责人及 #557/#567 的当前说明，未找到需要重复登记的新增缺陷；#567 是上游实际能力叶子。初始“当前净层无 actionable P0/P1/P2/P3，建议 APPROVE”的无 P2 判断，被下节 F1 Superseded（2026-11-09）；既有绿色命令与身份仍按本节保留。未重跑全库 `pnpm verify`，未执行真实 GitHub mutation、安装 Desktop、人类 UAT 或 R1 接受。不同 binding 的创建前拒绝仍是显式 guard 静态审查，本轮未新增动态反例；后续 head/base 变化须重锁，合并由人类授权。

### 后续反例 F1 / P2：仓库单独拒读未使旧候选失效

新增行锚点为 `packages/ui/src/delivery-lineage-section.ts:73` 的稳定 `scopeKey`；关联 `packages/ui/src/create-change-request-section.ts:16` 与 `:93` 的选择 receipt / picker key 只消费 creator access。稳定创建区解决重挂和在途消费者丢失，但仓库目录的原生拒绝只改变 repository accessVersion，未改变 creatorAccessToken，故不能再借原广泛 key 清除旧人员和选择。

在原始受验 `773d117f17a7057b6b4814358a204e066efc43d9` 的生产 Host/client/SQLite 浏览器夹具实跑：确认一个 PR 后选择 `browser-assignee`，由另一个原生目录调用触发 403；等待生产 console 的 `[harness-projects] watch metadata` 接受报告、随后自动 `getDeliveryProjection` 的同一响应完成及下一渲染帧。Provider descriptor 此时 `development.assignee.list=unavailable`，旧候选仍为 1 且 checked=true，create=1/add=0。原始结果保存在主检出 `.superpowers/pr568-pr581-review-20261109/581-repo-denial-probe.json`。固定组合 `3c2df2d4` 上也得到同一结果；没有把仅在未发布 A 修复中产生的现象归给原 B。

影响是已观察目录拒绝后仍显示旧候选和可选择状态；没有证明越权写入或向另一主体披露，定级 P2。原 `native candidate denial masks late browser response while keeping same-item Draft fields` 同时触发 Issue 来源拒绝，后者改变 creatorAccessToken，因而未隔离此 repo-only 路径。原四项绿色变异与测试计数不覆盖该反例，不撤回其真实运行结果。

修复契约是保留创建区稳定 scope/pending owner，只让选中仓库的访问 receipt 进入负责人消费者与本地选择失效；receipt 改变立即清除人员和选择、拒绝旧成功，但不因每次不透明版本改变自动重读成环。首次 scope/连接就绪仍可自动读，后续按安全手动重读恢复；同 scope 的允许名单失败文案可保守保留。Core/Provider 当前授权围栏不变。当时状态：已交回修复，尚未完成权限反馈条款；被下节修复候选独立复评 Superseded。整体仍无已证明 P0/P1，外部追加 review 及后续复评由主评审一次处理。

### F1 修复候选独立复评：ADDRESSED

本轮实际受验是临时顺序组合 `f789f2f124f4d58c34b855b2a4fa73f73dc2475c` 加一处测试 setup 屏障的最终工作差异；不是原 `773d117f`。生产 `CreateChangeRequestSection` SHA256 为 `879a4205e734b0454f0e373ce1623f83374e354ae01671920a00d54e9fe071fe`，组合 `DeliveryLineageSection` 为 `dc7f166bc16d87a7de9af9b553a9b25eab2b92dd35eb616004a10a6044ad0c41`。原分支移植后须逐 blob 核对，不把候选测试偷换为原 head 已修复；最终实际 head/base、checks 和 issue 关联仍由主评审重锁。

已审实际源码：创建前选择立即用独立 assignee receipt 派生，repo-only 变化不等 effect 就清空原 IDs；同一 token 传入 picker 的失效参数而不进入其 React key。创建请求的 pending owner、表单草稿、原冻结 IDs 和 PR/Issue 确认链保持；旧负责人身份和正面摘要遮蔽，明确 none/failed 保留。A 消费者已独立复评的 safe status、token-only 不自动读、迟到成功拒绝及初始 lookup 失效后的只读重试一并保留，无 Core/runtime 协议改动。

在该实际组合根独立执行 `pnpm test:file --test-name-pattern 'repo-only|repo access change preserves proven|access change preserves pending browser consumer' tests/browser/workspace-execution.test.js tests/contract/ui-create-change-request.test.js`：7/7，fail/cancelled/skipped/todo=0。覆盖创建前已选/实际晚到成功、repo-only 在途原请求、缓存负责人确认、原访问变化消费者，以及 operation/result 两种已证明 none。已审共享谱系最终 union：summary 不显示写区，创建区使用 scopeKey；creatorAccessToken 与 assigneeAccessToken 分责，summary refreshToken 与 creationRefreshToken 分责，onConfirmed 仍只纯读。

复评保留两个真实修订：初始 lookup 在 token 变化后丢弃结果但无重读出口，补当前 receipt 下的显式只读恢复；none 分支曾被通用 unknown 回退误报为存在原负责人意图，补两种 none 判别后修复。最终独立浏览器首次运行的缓存确认用例也曾失败：创建后的 picker 自动读与测试显式拒绝并发，后者被安全版本围栏拒绝，测试误读不存在的 value。只在 setup 等到 PR 确认及新的 post-create 候选读取完成，仍保留原拒绝 envelope、metadata→projection 完成、身份/选择遮蔽和无自动重读断言；生产 blob 未再改变。最终上述 7/7 是新执行，不掩盖该旧红。

最终四个文件的精确 SHA256 与命令结果见主检出 `.superpowers/pr568-pr581-review-20261109/581-final-independent-fix-files.json`，其中 browser 为 `fea70ca9e8699b85ac287a7b1dd19580ef0319c24cccf606d15c5fa8d210689a`。结论：F1 修复候选 ADDRESSED，建议该候选 `APPROVE`，无未决 actionable P0–P3。未冒称完整新 verify、真实 token、安装、人类 UAT 或 R1；主评审继续实际分支、整体组合及远端门禁。

2026-11-09 SGT实际分支移植：本地接合到#568的43f74f43后，受验代码/测试与独立最终候选对应文件逐字一致；与完整组合只差#569自己的14个文件，未提前引入总览。运行 `pnpm test:file tests/contract/ui-create-change-request.test.js tests/contract/ui-change-request-assignees.test.js tests/browser/workspace-execution.test.js` 55/55，`pnpm typecheck`退出0。基准为接合头9726569d；后续上游CI修复若改变继承模块，则重新确认差异及必要验证，不沿用旧最终head。

2026-11-09 SGT再次接合：继承上游980行的CI历史提示修复并保留完整两组browser后，在2abf1f23检出运行前述相同三个文件，59/59与typecheck通过；B自身Create/Nonecontract代码不变。最终PR的base须为上游实际当前head，不用旧43f74f43作为门禁。
