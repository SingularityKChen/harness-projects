# 交付谱系抽屉 ExecPlan

> 状态：Completed（实现与验收；远端交付按下述回读门执行）；创建：2026-10-26；关联：#234；批次：B1–B3。
> 执行上下文：检出 `feature/delivery-lineage-drawer` 的 `.worktrees/delivery-lineage-drawer` 根；基线观察为2026-10-26 `f6ea971`；PR base为`main`。

## Purpose / Big Picture

用户在详情里查看六位置交付谱系与具名缺口，打开或明确刷新后看到重读投影；陈旧、未知、候选与通过分别显示。最小成功证据是Host步骤11、纯读零摄入，以及保持抽屉打开跨失鲜边界也不会保留旧绿。

## Context and Orientation

issue #234正文及2026-10-22 timer/TD-083评论是需求；#222已分离refresh写者与纯query，#357已提供`deriveDeliveryLineageStrip`、Host时间参数和Unix-ms `nextFlipAt`。旧`detail.lineage`按workspace capability派生，与真实逐跳projection可冲突。`tests/integration/delivery-repository-routing.test.js`已有真实Core路由拒绝/历史保留装配。`docs/product/vertical-path.md` §2步骤11与`PLANS.md`约束本项。

## Design / Spec

详情内独立section按明确repository scope消费既有派生；不默认第一个仓库，不另造age规则或delivery cache。work-item可见/绑定scope先过Host门；撤权或目标替换丢弃旧结果。缺口保留原因、不补关系；state是事实/新鲜度，relationState单独写候选/已确认，available仅表明该投影逐跳可读，不代表当前刷新路由通畅。

新增`getDeliveryProjection(workItemId,repositoryId)`纯读，精确返回`workspaceId`、`workItemId`、`repositoryId`、`projection`、`now`；Host在查询完成后取ISO now，读前后重验可见性。新增`refreshDeliveryFacts(actorRef,workItemId,repositoryId)`无key、不走replay。打开/目标改变/手动刷新按refresh→re-read→derive；命令失败仍读最后事实，命令local_only/applied不直接渲染节点。同scope在途可共享Promise，结束后下一次明确refresh必须真读。

每scope只保一个timeout，delay由`nextFlipAt−Host now`计算，不复制confirmedAt+threshold。到期/阈值变化/外部projection替换/visibility或pageshow恢复时撤旧timer，先同步切“正在核对新鲜度”遮住passed，再纯读取实际Host now→派生→安装下一boundary；undefined不设重复timer。当前pure read接受新对象只派生并换timer，不再次触发自身读取。到期不调用refresh、不摄入Provider。Host读失败、断线或pending也保留节点但不呈现passed；恢复后先核对，不能闪回挂起前的绿。两个集合边界各自生效，async读期间允许核对态。

read/timer/listener 的提交由 scope generation 隔离，target替换/unmount清理，晚resolve/reject不影响新目标。显式 refresh 的 Promise 按 scope 与 reader 保留，纯时钟读取必须等待当前命令链完成再重读；读代际不能取消命令后的最终重读。多个明确 refresh intent 顺序真执行，无 key/replay；同源 effect cleanup/setup 仅等待同一在途命令，不重新摄入。渲染结果同时绑定 reader 身份，换源首帧遮住旧 passed。真实Core的CHANGE_REQUEST_READ_ROUTE denial可留下available=true而stale的CR节点，保持最后已知/不完整提示；不以workspace key覆盖。移除`WorkItemDetail.lineage`字段及derive赋值/相关竞争呈现，保留独立`lineageEntryPoints`导出用于既有单独契约；不改#357纯年龄算法。旧提交CI标最后已知，slot顺序不创造它与新head的确认关系。

拒绝setInterval/provider轮询、把projection塞baseline及浏览器时钟冒充Host时钟；这些增加协议/时钟假设且混合摄入与读取。工程区无规划字段编辑，无candidate自动确认。

## Global Constraints

代码+tests增删≤800、文档≤1300；生产约340、测试约390。文件全集：`tests/integration/harness-plugin-setup-client.test.js`、`packages/client/src/delivery-lineage-reader.ts`、`packages/client/src/index.ts`、`packages/ui-model/src/types.ts`、`packages/ui-model/src/derive.ts`、`packages/ui-model/src/work-item-detail-view.ts`、`packages/ui/src/delivery-lineage-section.ts`、`packages/ui/src/work-item-detail.ts`、`packages/ui/src/work-item-project.ts`、`packages/ui/src/work-item-app.ts`、`packages/ui/src/workspace-setup.ts`、`packages/ui/src/index.ts`、`apps/harness-plugin/src/host-operations.ts`、`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/client.ts`、`tests/contract/ui-delivery-lineage-section.test.js`、`tests/contract/ui-model-presentation.test.js`、`tests/contract/harness-host-remote-adapter.test.js`、`tests/e2e/delivery-lineage.test.js`、`tests/integration/harness-plugin-delivery-lineage.test.js`、本计划；完成归档另改`docs/README.md`。不改Core摄入/纯derive、schema、native deps、Status或native依赖关系。

公共桥由协调者串行应用：OPERATIONS在watch前只加本项两operation；handlersFor只扩本项Pick/handler；plugin client在Panel前建delivery reader；prop链仅加`deliveryReader`，section在panelBody后、ExecutionContextSection前。禁止整段重排/写其他PR接口。四main PR独立，本项可用已有seeded Core链实证，不等待#142。

## Plan of Work

### B1 · 查询/刷新wire与真实路由反例

最小闭环：真实Host纯读无副作用、refresh每次执行、真实Core路由拒绝保留历史stale。主文件：`packages/client/src/delivery-lineage-reader.ts`、`apps/harness-plugin/src/host-operations.ts`。先RED顺序/命令结果不入UI/严格scope，利用现有routing装配Start Work→成功refresh→保留引用而拒RepositoryRead→refresh→projection，再实现。

    pnpm test:file tests/integration/harness-plugin-delivery-lineage.test.js tests/integration/delivery-repository-routing.test.js tests/contract/ui-delivery-lineage-strip.test.js

期望先新断言RED，GREEN后纯读provider calls=0、facts/relations/revision不变；两次refresh均真执行；拒路由后CR available=true且stale、旧集合confirmedAt/关系保留，本次dev/CI读为零。回滚wire/adapter不删事实。

### B2 · section与单timer闭环

最小闭环：生产prop链可读刷新，跨边界/挂起/目标切换都不误绿。主文件：`packages/ui/src/delivery-lineage-section.ts`、`packages/ui-model/src/derive.ts`。先RED gap、unknown/stale、candidate+passed、真实Core反例消费、pending遮绿、两边界/visibility/unmount，再接既有derive并去竞争lineage字段。

    pnpm test:file tests/contract/ui-delivery-lineage-section.test.js tests/integration/harness-plugin-delivery-lineage.test.js tests/contract/ui-delivery-lineage-strip.test.js tests/contract/ui-model-presentation.test.js
    pnpm typecheck
    pnpm run boundaries
    pnpm --filter @harness-projects/app-harness-plugin pack:plugin

期望全exit0：B1−1ms passed；到B1先核对，drain Host纯读后仅首集合stale；B2才后集合stale；undefined零重复timer。挂起跨两边界恢复当帧无passed；旧target timeout/read/reject不能改新target；卸载零callback/listener。删generation、从available推passed、用command结果填节点应各让定向用例失败。回滚section/接线保留已摄入事实。

### B3 · 当前产物Host步骤11与交付

依`docs/exec-plan/completed/2026-10-26-plugin-workspace-setup.md` Batch3完整命令建立官方0.2.0-rc.2 Web scratch，确认documentsDirectory overlay后安装本分支pack产物。冻结head/tgzSHA，同PID在授权sandbox的已有执行链打开详情→refresh→六位置/缺口→断网最后已知与stale→恢复纯读；记录当前projection/Host时间/页面及规划字段前后未变。Web证据不扩为Desktop、部署或release readiness。

    pnpm verify
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

期望全exit0并人工核800/1300和公开面；整理提交push后，`gh pr view -R SingularityKChen/harness-projects "$HP_PR" --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup`、`gh pr checks -R SingularityKChen/harness-projects "$HP_PR"`及所有review threads回读当前头才ready。HP_PR取本分支实际draft编号。隔离/凭据不足保留未完成；回滚安装旧tgz，不删谱系。

## Validation and Acceptance

| 验收 | 证据 |
|---|---|
| 缺口不造边，unknown/stale不绿，候选独立 | B2组件与真实Core投影，关系数不变 |
| open/refresh只命令后重读、query不摄入 | B1计数trace、两次真refresh、command/projection反例 |
| 单timer、两边界、挂起与晚target | B2 fake Host clock+pending/visibility/unmount反例 |
| route denial的available与state正交 | B1真Core产生→B2真section呈现，禁止手填stale替身 |
| 无planning写，Host步骤11 | B2无控件/命令；B3当前产物实点及前后规划摘要 |

## Progress

- [x] 2026-10-26 23:24 +08：具名 seam 后当前产物 S3 已完成，冻结 source `01ee9961842d100c78bde8a011868a21a58bd680` 与 tar SHA256 `161c957adcdb975e330a6b5704d9d7fcf4923022b4dd7717243bd45410da2efc`；官方 Web 同 PID 实点、在线五分钟边界及浏览器传输中断/恢复已回读。早前未执行判断 Superseded by 本节及 Outcomes；独立审计与远端交付仍由协调者完成。

- [x] 2026-10-26 +08：两设计/完整issue/基线审评，明确时钟与三轴语义。
- [x] 2026-10-26 +08：B1真实Core/Host RED→GREEN；纯读零 Provider 方法、事实/关系/修订不变、两次真 refresh、前后可见性与 scope 守卫。
- [x] 2026-10-26 +08：B2组件与生产 prop 链已接线；两边界、RPC pending、挂起恢复、同 scope 乱序、目标切换、卸载、阈值与 error 遮绿均有判别用例；B3 尚未验收。该轮对 pending+resume 完整性的原判断 Superseded by 下述独立审查修复记录（2026-10-26）。
- [x] 2026-10-26 +08：独立审查修复：持久测试先复现 pageshow/visible 抢占 pending refresh、换 reader 首帧与同源 effect 重放；共享命令 Promise 后保持遮绿和最终纯读，原两边界/同 scope 乱序与 ABA 控制均保留。
- [x] 2026-10-26 23:41 +08：当前具名产物 S3、独立 P1/P2 修复复评、协调者字节/规划快照核对与组合候选审计完成，归档实现计划。最终 push 后按 B3 回读当前 head、双向 issue 关联、checks 和 threads，通过后才 ready；不合并。

## Surprises & Discoveries

2026-10-26 / 当前 S3：启动初期凭据服务短暂未就绪，同 PID 的真实只读结果随后 confirmed，页面既有“重试”进入列表。原生 offline flag 首次并未立即证明断线；只按后续实际连接中断通知、截图和恢复纯读计入浏览器传输故障证据。CDP 关闭尝试没有确认结果，不算关闭成功，不扩称 Provider 网络故障。真实 CI 集合为空，保留两处 not_observed 缺口，不制造节点补齐。

2026-10-26独立审查发现：原读 generation 能被 pageshow/visible 增代，绕过 pending refresh 并丢掉其最终重读；原 77 tests 未覆盖此交错。新增持久 RED 四项后以同 scope/reader 的命令 Promise 分离生命周期修复。reader 替换是条件性组件契约问题，当前生产 reader 稳定，未声称真实 Host 已触发；effect replay 仅手工同源调度探针，不扩称真实 StrictMode DOM 证据。

2026-10-26实现取证：阈值替换前一帧可能复用旧 passed，新增 RED 后以读取所用阈值标记同步遮绿；投影 error 同样遮绿，刷新失败仍重读事实。临时删除 generation、从 available 推 passed、用刷新结果替代 query 各使定向测试失败，恢复后相关测试通过。

2026-10-26源码观察：nextFlipAt已有，消费timer尚无；CR节点available可与当前路由拒绝同时出现；旧detail.lineage取workspace keys不能替代投影。纯derive通过不证明抽屉定时行为，之前S3也不覆盖本项。

## Decision Log

2026-10-26 23:24 +08 / S3 执行者：只验当前具名 seam 的官方 Web tarball，逐项比对全部 12 安装文件；不改产品、不追加关系、不发模型 prompt、不写规划或远端。浏览器 DOM 时间仅为观测时间，产品仍用 Host now。真实 through-CI 通过节点缺席，验收边界写为四实节点、两具名缺口及已有节点年龄翻转；CI passed 的定向抑制仍由 B2 判别测试证明。

2026-10-26 22:45 +08 / 整合owner：三个独立UI PR把不同SDK放到同一工厂第四位置，组合时含义冲突。经独立窄复核，统一第四options对象，每PR只声明本功能具名字段并显式转发，不预嵌别的能力、不spread覆盖前三输入、不加容器。真实mount消费者契约先RED再GREEN，旧三参数调用仍有效；客户端产物重新freeze并在B3复验。

2026-10-26 / 独立评审修复：保留最小一个在途刷新 Promise，纯时钟读等待摄入完成后取实际 Host now；generation 只淘汰旧 UI 提交，不再淘汰显式刷新后的事实读取。状态绑定 reader 身份，跨源旧数据首帧遮蔽。不引入缓存、同步协议或第二年龄规则；同源 effect 重放复用 pending 命令。

2026-10-26 / 实现取证：首次完整回归的精确 descriptor 名单与刷新转发调用点名单仍是抽屉接线之前的集合；扩展 `Global Constraints` 中两份既有契约，只增加本项两操作与 client/Host 命令转发，保留真正写入调用点和 query 零摄入断言。此变化不引入第二写者。

2026-10-26 / 设计评审：选择Host now envelope+单timeout+边界核对态，不引时钟同步协议；删除竞争detail.lineage，三轴独立。用户已授权设计审评到ready，无批次重复批准；不授权改Status/native deps/依赖边或自行合并。组合candidate证据单独标注，不能替代单PR当前树。

## Idempotence and Recovery

query/build/测试可重复；refresh天然幂等无账本，inflight合并只活到Promise结束。generation撤销只防UI晚回填，不撤销已完成摄入。失败保留最后节点并遮绿；revert恢复旧drawer，已持久facts/relations不删除。共享历史整理遵守backup ref/精确lease。

## Interfaces and Dependencies

沿Core DeliveryProjection类型经client/delivery纯类型叶子，不复制契约；RemoteResult外层plugin解包、client严格scope/now/投影校验。Host沿lease/barrier，计时器只调纯读；测试注入Host clock/timers而不放宽年龄阈值。S3使用授权sandbox/credential句柄，本 PR 正文以 Refs #124 关联证据；外部写入按 actor、目标、幂等标记记录并回读，不将交叉引用表述为已向 #124 发表评论。

## Outcomes & Retrospective

2026-10-27 +08 / 评审收尾：本功能的完整初审及适用P2修复已独立复核，新组合官方Web验收通过；#124评论`6435452681`补齐指定位置的实证回传。当前组合产品源/包摘要、恢复/卸载、规划副本证据及范围边界见 `docs/review/2026-10-27-pr406-pr409-mmp-review.md`。旧单PR S3只属于其标明的历史冻结源，最终远端门禁及授权rebase合并按逐PR review回读，不预写结果。

2026-10-26 23:24 +08 / 当前具名 seam S3：source `01ee9961842d100c78bde8a011868a21a58bd680`，tar SHA256 `161c957adcdb975e330a6b5704d9d7fcf4923022b4dd7717243bd45410da2efc`，官方 CLI `0.2.0-rc.2`、`web` profile；安装的全部 12 文件与 tar 字节一致。浏览器前核对 effective documentsDirectory，首次 native registry/default workspace 也在一次性隔离目录；全程 Host PID `58595`。

真实详情打开和按钮刷新各完成 refresh→query 两轮；四实节点为执行上下文、工作树、提交与 PR，后两者保持 candidate；流水线/检查保留 not_observed 缺口。手动刷新 confirmedAt 为 `2026-10-26T15:11:12.987Z`，持续打开跨默认 300000ms；页面观测 `15:16:12.996Z` 进入核对，`15:16:13.002Z` 提交/PR 变 stale，关系不变。Host 后读 `15:17:48.189Z` 确认时刻未推进；定时及恢复读取前后 delivery facts、relation、candidate_relation 全等。

浏览器传输故障实际观测 `15:17:50.198Z` 连接中断/最后已知；恢复于 `15:18:57.567Z` 先核对，`15:18:57.594Z` 纯读完成仍 stale，未增加 refresh。Host `15:22:19.099Z` 回读保留 confirmedAt/节点。规划端 16 字段、9 成员规范化快照前后相同，SHA256 `350f91fb9cc3c8b059508034b1758c71727cace4ab2363b61fb09daa1abdbaa5`。这是当前产物 Web 证据，不扩为 Desktop、部署或 release readiness；无真实通过 CI 节点，因此实际 S3 不冒充 CI passed 翻转证据。当时计划保持 Active，等待协调者审计；Superseded by 本节“最终审计与归档”（2026-10-26）。

2026-10-26 修复后在本计划声明的分支工作树执行：相关命令 83 tests；`pnpm verify` 通过 typecheck、2032 主测试与 7 mvp0；boundaries 9；workflow 与 pack exit 0；原独立组件探针 6/6 与 Host 探针 2/2 回读通过。此记录覆盖修复代码，最终独立复评与 B3 由协调者继续。

2026-10-26 初次实现在本计划声明的分支工作树执行：B1/B2 五文件相关命令 77 tests；`pnpm verify` 通过 typecheck、2026 主回归与 7 mvp0；`pnpm run boundaries` 9 tests；`node scripts/workflow-check.mjs` 检查 8 文件无 findings；`pack:plugin` exit 0。完整回归最初的两份旧精确名单失败已按 Decision Log 修正，未隐藏失败。公开面/规模与 diff 检查由提交前后机械回读确认。

B1/B2 已完成本地实现与离线验证（该轮无已知缺陷结论 Superseded by 本节独立审查修复，2026-10-26）；真实 Core → Host → section 覆盖 available=true/stale 候选 CR，查询保持零 Provider 方法调用。B3 当前产物 Host 实点、独立验收与远端 ready 尚未完成，计划保留 Active。该行关于当前产物实点的旧判断 Superseded by 下述当前 S3 记录（2026-10-26）；当时独立审计与远端 ready 仍未完成；Superseded by 本节“最终审计与归档”（2026-10-26）。TD-045抽屉打开刷新与TD-083本消费边界由本项验证；TD-042/043历史锚点/事实映射限制保留，不因slot顺序重认关系。新实质债务由执行者登记`docs/exec-plan/tech-debt-tracker.md`并更新范围，全部通过后归档索引。

最终审计与归档（2026-10-26 23:41 +08）：协调者独立核对当前产物 12 个安装文件、冻结 source 后仅文档变动和规划完整快照相等；独立 scoped 11/11 关闭原 pending-refresh/resume P1 与 reader 首帧 P2，具名消费者 3/3 通过。TD-042/043 的历史事实映射限制保留；TD-045/083/084 在本抽屉消费边界完成验证，其他消费者的适用范围仍由原追踪项约束，不自动宣布整个发布门通过。

组合补证（仅覆盖冻结候选 `d37877af` / tree `afbb9321`，2026-10-26）：四个产品 source 的局部并集经过全量 2081 项、MVP0 7 项、窄回归 100 项与边界 9 项；独立官方 Web 实点从空库创建、连接规划、双击绑定到 Start Work 同仓库选择、刷新六位置及卸载重启。只有一个 repository、三引用、一个 context/run、新 branch/worktree；实际 ready/manual_fallback 且 run failed，不声称模型执行成功。context/worktree 有事实，后四位置 not_observed；规划三次快照相同。卸载撤回插件入口与 RPC，Git checkpoint 和业务表保留，同步游标可推进。该 source 下非空分支路径通过，不替代 #142 后续留空分支的 Gateway 修复验收，也不等同于任一单 PR 精确源码或 R1。

远端交付门以可重算命令为准：在本计划分支根执行 `gh pr checks -R SingularityKChen/harness-projects 409`，并回读 PR head/base、完整 threads、当前 CodeQL 结果及 issue #234 的 closedByPullRequestsReferences；与发布 head 一致且无未处理阻塞意见后执行 `gh pr ready -R SingularityKChen/harness-projects 409`。本计划不预写未发生的 ready/check 结果。

## Bottom Change Note

2026-10-26 23:41 +08：独立核对当前 S3、受限组合证明和债务边界，归档实现计划并把易失交付状态保留为回读规则。

2026-10-26 22:48 +08：具名参数消费者验收GREEN、typecheck与pack通过；S3以本次新产物身份重验。

2026-10-26 22:45 +08：以三份真实消费者RED收口并行工厂参数碰撞，仅改本功能具名接线；新增setup-client验收路径，最终产物重新freeze。

2026-10-26 +08：综合两设计与源码初稿，固定pure read、Host时间核对态、pending遮绿、真实route denial与旧lineage去竞争。

2026-10-26 +08：落实 B1/B2 与生产接线，记录真实路由反例和阈值/error 的 RED→GREEN；精确更新两份旧接口名单契约，保留 B3 未完成。

2026-10-26 +08：按独立审查修复 pending refresh 与恢复纯读的生命周期竞争，并加入 reader 来源身份遮绿；保留最初失败与 Superseded 标记，不改 B3 分工。

2026-10-26 23:24 +08：记录当前具名 seam 的实际官方 Web S3 与精确产物身份，更新旧未执行结论为 Superseded；保留真实 CI 缺口和浏览器传输故障的证据边界，产品字节不变。

2026-10-27 +08：追加MMP评审收口与新组合证据回传，保留各历史源码的实测身份，不混用为新单PR精确产物。
