# Start Work 抽屉 ExecPlan

> 状态：Completed（实现与验收；远端交付按下述回读门执行）；创建：2026-10-26；关联：#142；批次：B1–B3。
> 执行上下文：检出 `feature/start-work-drawer` 的 `.worktrees/start-work-drawer` 根；基线观察为 2026-10-26 `f6ea971`；PR base 为 `main`。

## Purpose / Big Picture

可见工作项的详情内，用户明确选择已绑定仓库并提交开始工作；没有执行器也能人工执行，重复提交只产生一个上下文。最小成功证据是实际 Host 中显式提交后唯一 context、分支和 worktree 的读回，以及无隐式启动的反例。

## Context and Orientation

需求真源是 issue #142 正文、2026-10-08 no-route 恢复评论及 #351 D1；`docs/product/vertical-path.md` §2 步骤 6–8 定义用户结果。#353 已提供逐仓库四门元数据；#282 已提供执行状态区，本项只消费并触发重读。Core 已支持人工 fallback，而 UI 的 `START_WORK_KEYS` 仍错误要求 `execution.run.start`。Host 当前 catalog 没有实际 Harness 执行装配，Provider 包存在不能证明会话可用。`PLANS.md` 为本计划规范。

## Design / Spec

沿用唯一原生详情 dialog，在内部展开有标题/label 的 Start Work 表单；仓库来自同工作区 watch.repositories，不复制目录。只接受可见 `work_item`；PR-backed、redacted、unresolved 无入口；打开、选择和关闭均不启动。分支名可留空交给 Core 既有默认命名，非空时提交用户值；base 使用仓库默认分支，不给 executor/base/worktreePath 输入。

可用性使用 `repositoryAccessIndex` 的 branch.create/worktree.create 两个写门和 repository.read/worktree.read 两个读门；读门 `read_only` 可读，写门 `read_only` 拒绝，移除执行器必需门。别的 Development 连接不能放行选中仓库。无路由显示“绑定仓库”导航并禁止 replay；依据当前 route 元数据或安全恢复字段判定，不匹配 raw message。

Host 新增 `getStartWorkOptions(workItemId)`，返回受 scope/可见性保护的明确 `executionMode: manual|harness`；从当前实际选定、可用的执行装配判断，human provider 仍是 manual。UI 不从 capability key 猜 Harness。不补 #359 会话生命周期。`startWork(actorRef,key,workItemId,repositoryId,branchName?)` 严格闭合位置参数；可省略的 branchName 在 descriptor 明确携带官方 `acceptsUndefined: true`，JSON 省略该键后仍能通过 Gateway，必需身份/信封字段不放宽；Host 注入 workspace，检查工作项与已绑定仓库后转现有 controller。

client 保存完整 target/repository/branch intent；在途双提交共享 Promise/key，transport/畸形响应/Pending/Unknown 保留原键并先读回；确定失败后用户再次提交产生新 attempt key（Controller `local_only` 仅当已验证 `value.status=failed` 时作为确定失败；其余 `local_only` 不轮换），改 payload/target 产生新 intent。成功只触发现有执行区重读，不另造执行状态；降级、local_only、unknown、error 分别呈现，不显示未确认 Saved。target 切换/卸载用 generation 丢弃晚响应。拒绝嵌套 modal、列表直接启动和通用 command store，减少焦点与状态拥有者。

## Global Constraints

代码+tests 增删合计 ≤800，文档 ≤1300；目标生产约350、测试约350，超限先砍重复封装。文件全集：`tests/integration/harness-plugin-setup-client.test.js`、`packages/client/src/start-work.ts`、`packages/client/src/index.ts`、`packages/ui-model/src/capability-access.ts`、`packages/ui-model/src/work-item-detail-view.ts`、`packages/ui/src/start-work-section.ts`、`packages/ui/src/work-item-detail.ts`、`packages/ui/src/work-item-project.ts`、`packages/ui/src/work-item-app.ts`、`packages/ui/src/workspace-setup.ts`、`packages/ui/src/execution-context-section.ts`、`packages/ui/src/index.ts`、`apps/harness-plugin/src/host-operations.ts`、`apps/harness-plugin/src/remote.ts`、`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/client.ts`、`tests/contract/ui-start-work.test.js`、`tests/contract/ui-model-presentation.test.js`、`tests/contract/ui-work-item-detail-browser.test.js`、`tests/contract/ui-work-item-detail.test.js`、`tests/contract/harness-host-remote-adapter.test.js`、`tests/integration/harness-plugin-start-work.test.js`、本计划；完成归档另改 `docs/README.md`。不改 Core 策略、schema、native deps、planning Status、依赖关系或用户文件。

公共接线由协调者串行整合：OPERATIONS 在 getExecutionContext 后只追加本项两操作；handlersFor 的 Pick/handlers 只加同名键；plugin client 在 reader 后建立 start adapter；UI prop 链只透传 `startWork` 与 `onBindRepository`，section 放执行区后、关闭按钮前。禁止整段重写共享函数/格式化，其他功能接口不预埋。四 PR 独立基于 main；本项用预绑定仓库验收，实际“绑定后可选”由组合 candidate 单独验证。

## Plan of Work

### B1 · 命令身份、四门与安全 Host 面

最小闭环：真实 controller/core 中双提交、确定失败与未知恢复可判别。主文件：`packages/client/src/start-work.ts`、`packages/ui-model/src/capability-access.ts`、`apps/harness-plugin/src/host-operations.ts`。
先新增测试并执行下列窄命令保存 RED，再实现严格输入/结果白名单、options Host 模式与 intent。未知字段、伪造 workspaceId、越 scope、PR/redacted 在调用写命令前拒绝；模式测试包括无执行者、human、Harness 三组。真实 controller 缓存 failed 的反例必须证明新 attempt 被重新执行。

    pnpm test:file tests/contract/ui-start-work.test.js tests/integration/harness-plugin-start-work.test.js tests/e2e/repository-routing.test.js

期望 RED 至少命中新行为，再 GREEN 全部 fail 0、非空用例；真实 SQLite 唯一 context、Git 写调用一次。回滚本批 adapter/门改动恢复只读，不删除已产生 Git 对象。

### B2 · 表单和恢复接线

最小闭环：真实组件沿生产 prop 链提交，目标切换隔离，执行区明确重读。主文件：`packages/ui/src/start-work-section.ts`、`apps/harness-plugin/src/client.ts`。先 RED 工作项/PR/遮蔽、仅绑定仓库、A仓库拒绝+B可用、no-route导航、Unknown原键、失败新键与 A→B 晚响应，再实现。

    pnpm test:file tests/contract/ui-start-work.test.js tests/integration/harness-plugin-start-work.test.js tests/contract/ui-work-item-detail-browser.test.js tests/contract/ui-model-presentation.test.js
    pnpm typecheck
    pnpm run boundaries
    pnpm --filter @harness-projects/app-harness-plugin pack:plugin

期望全 exit 0；无 start source 的旧只读面保持成立；清理监听/晚响应、焦点与一次 Escape 有断言。回滚 section/props 可独立撤 UI，不补偿删除 context/worktree。

### B3 · 真实 Host 和交付

按 `docs/exec-plan/completed/2026-10-26-plugin-workspace-setup.md` Batch 3 的完整命令建立官方 `0.2.0-rc.2` Web scratch 环境；执行 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`，冻结 head/tgz SHA，先确认 documentsDirectory overlay 生效再开页面。用已授权 sandbox 的预绑定 repository，记录：打开详情无启动→表单→双击提交→同 PID remote/SQLite 唯一 context/branch/worktree→执行区重读；规划字段前后不变，不发模型 prompt。manual 实证不冒充 Harness 会话实证。

    pnpm verify
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

期望全 exit 0并人工核本轮800/1300及五类公开面；整理 commits 后 push，`gh pr view -R SingularityKChen/harness-projects "$HP_PR" --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup`、`gh pr checks -R SingularityKChen/harness-projects "$HP_PR"`及完整 review threads 回读当前头后才 ready。`HP_PR`由本分支 draft PR 实际编号设置。宿主缺凭据/隔离失败保留未完成；回滚安装旧已知 tgz，保留用户产物。

## Validation and Acceptance

| 验收 | 证据 |
|---|---|
| 仅 work_item 明确触发，仓库范围正确 | B2 组件阴阳对照；B3 打开无启动 |
| 四门/人工与Harness标签/no-route恢复 | B1 实际路由与三个Host模式；B2无必败replay |
| 双提交一次、失败可重试、未知不重复执行 | B1真实账本/SQLite，B2 intent及晚响应 |
| 降级/失败恢复、执行读回 | B2 safe状态矩阵与reader计数；B3当前产物实点 |
| 独立/组合边界 | 单PR预绑定通过；组合候选另记source树，禁止混作单PR |

## Progress

- [x] 2026-10-26 22:45 +08：新接线 S3 发现留空分支 Gateway 拒绝；修复后按 Outcomes 的新 source/tgz 重新实点通过，旧冻结身份保留为历史。

- [x] 2026-10-26 +08：独立审读两设计、issue 与基线源码，收敛本计划。
- [x] 2026-10-26 +08：B1 RED/GREEN；首轮窄命令 26 项中 5 项预期失败（四门、缺 client intent、缺 Host 操作），补齐后真实 controller 失败账本、新 attempt、SQLite 唯一 context、Git 分支/工作树各写一次通过。
- [x] 2026-10-26 +08：B2 组件/接线；组件缺失 RED、逐仓库无元数据借路由 RED、Host 读间撤权与分支原文 RED 均已转 GREEN；当前窄回归 47 项、类型检查、边界与插件 pack 通过。
- [x] 2026-10-26 +08：独立验收 F1/F2 已转成持久测试并完成 RED/GREEN：确认 failed context 的 local_only 可显式新 attempt；同步抛错后可先读回再原键恢复；原丢失确认响应控制仍只启动一次。
- [x] 2026-10-26 +08：S3 留空分支 wire 缺口已用持久 descriptor/JSON 测试和官方 Gateway 探针先 RED 再 GREEN；不改变 Core 默认命名，当前产物须重新 freeze 后实点。
- [x] 2026-10-27 00:00 +08：当前单 PR S3、独立组合窄复验、修复复评与证据核对完成；归档实现计划。最终 push 后回读当前 head/base、checks、全部 threads 与双向 issue 关联，通过后才 ready；不合并。

## Surprises & Discoveries

2026-10-26观察 `capability-access.ts` 的五门与Core manualFallback不一致；human也声明run.start，因此该key不能区分Harness。已有执行区属于#282，不在本项重造。以上为源码观察，不是本轮新功能通过证据。

2026-10-26 / B1–B2：`repositoryAccessIndex` 允许工作区级 fallback；当选中仓库缺四门元数据时，另一个连接可能放行它。新增生产 App→page→drawer 测试先得到 `true !== false`，因此本项四门只以该仓库元数据求交，缺省 fail closed。Host 在仓库 baseline 读取后重新检查可见性，消除读间撤权后仍进入写命令的窗口；RED 为写调用数 `1 !== 0`。非空分支名原样交 Core 校验，避免静默 trim 用户值。

全量首轮的两项旧字段白名单失败通过无仓库时省略可选字段解决，生产无仓库表单仍提供绑定导航。另两项旧契约失败分别由 descriptor 固定名单新增两个操作、dialog hook 桩新增真实 `useState` 同步解决；未知操作与 Escape/Tab 原断言保留。新 human 模式用例的 issuerKey 不足 32 字节是夹具错误，修正后才作为模式证据，不计产品 RED。

2026-10-26 / 独立验收：初版只覆盖无 context 的预检失败，漏掉 Core 已登记 context 且 branch ack 后 worktree 确定失败的 `local_only`。真实 Core/controller/SQLite 持久反例首轮仍重放旧 key，而直接新 key 控制可 confirmed；据此保留安全且已校验的 contextStatus 作为重试终态证据。另一个持久反例证明 port 同步抛错会在 pending 赋值前运行 finally；已将执行延后到 Promise microtask，保持同 intent 的 Promise 身份。

2026-10-26 / S3 optional wire：协调者在冻结 source `eda080b27cc51546a6c710cc520b27f221d4db54`、tgz SHA-256 `f3fb23a75c1104bf29eb40580f4b4a59634ade1279c53c1156df439739dfb723` 的官方 0.2.0-rc.2 浏览器实点发现留空分支被 Gateway 以 `gateway/arguments-invalid` / missing branchName 拒绝，context/run 仍为 0。源码真实的 `assertExactArguments` 只对 descriptor 标记 `acceptsUndefined=true` 的 strict 参数允许缺键；官方 `directoryPicker/list` 的可选 path 同时携带该标记。此前只有 parser 接受 undefined，JSON 丢掉属性后仍被当成必需参数。持久 descriptor/序列化测试与真实官方 TypertRegistry + TypertGatewayService 均复现 RED，补齐同一标记后转 GREEN，必需字段和未知字段拒绝控制仍通过。

## Decision Log

2026-10-27 +08 / 人类本轮直接指定PR #406–#409无P0/P1或只有P2/P3时由评审会话负责修复、独立复评、归档及rebase合并。采用上述最小方案，理由是修复误分类/假成功，不扩展公共Host接口、不改变工程/规划状态所有权；保持原独立能力交付边界。

2026-10-26 22:45 +08 / 整合owner：三个独立UI PR把不同SDK放到同一工厂第四位置，组合时含义冲突。经独立窄复核，统一第四options对象，每PR只声明本功能具名字段并显式转发，不预嵌别的能力、不spread覆盖前三输入、不加容器。真实mount消费者契约先RED再GREEN，旧三参数调用仍有效；客户端产物重新freeze并在B3复验。

2026-10-26 / 设计评审：采用明确 Host mode、四门与局部intent；拒绝从run.start推Harness及失败永用旧键，理由见Design。用户已授权完整设计审评、实现验证至ready，无须批次间再批准；不授权改Project Status/native deps或自行合并。四份独立main PR，公共桥由协调者串行落增量。

2026-10-26 / B2：经协调者确认，将两项旧契约测试纳入 `Global Constraints`，原因是实际新增操作与 hook 需要同步精确名单/最小桩；不放宽名单和行为断言。保持表单局部请求状态，以递增 refresh token 驱动既有执行区重新读 Host；不建立第二份执行事实缓存。

2026-10-26 / F1/F2：只以 `local_only + contextStatus=failed` 追加确定失败分类，不把所有本地记录视为可重起；Unknown/Pending 即使携带 failed status 也保留原 key 并先读回，manual fallback/ready 控制不轮 key。UI 只在有已确认 failed context 时说明本地记录保留；一般 failed 不声明存在本地记录。pending 赋值先于 Promise 内执行，不新增命令框架。

2026-10-26 / S3 wire：采用运行时既有 optional positional 合同 `acceptsUndefined`，只从本项 branchName 声明传播到 Host/Client 共用 descriptor，不引入 nullable 值、不修改 Core 或 UI 默认输入。将 `remote.ts` 纳入 `Global Constraints` 是因为遗漏发生在声明到 descriptor 的传播边界；保持零新增宿主依赖，原 freeze source/tgz 作为失败历史保留。

## Idempotence and Recovery

读、build、测试可重跑；写按B1的尝试边界复用/轮换key。Unknown先对账不新起run。revert本PR恢复旧UI并保留执行事实、分支和worktree；不自动清理用户工作。未push临时提交先收敛；已推送整理按仓库expert流程建立backup ref和精确lease。

## Interfaces and Dependencies

沿用Controller CommandResult/StartWorkView、Core START_WORK_ROUTE、watch.repositories和已有executionReader。RemoteResult外层仅plugin adapter解包，client校验内层且过滤raw错误/路径；Host生命周期沿现有lease/barrier。外部实证用授权sandbox与宿主credential句柄，不打印值。需变量HP_PR与固定官方runtime，不能借本机不兼容版本放宽peer。

## Outcomes & Retrospective

2026-10-27 +08 / 评审收尾：本功能的完整初审及适用P2修复已独立复核，新组合官方Web验收通过；#124评论`6435452681`补齐指定位置的实证回传。当前组合产品源/包摘要、恢复/卸载、规划副本证据及范围边界见 `docs/review/2026-10-27-pr406-pr409-mmp-review.md`。旧单PR S3只属于其标明的历史冻结源，最终远端门禁及授权rebase合并按逐PR review回读，不预写结果。

2026-10-27 +08 / 本轮MMP评审P2修复：删除按通用conflict推断needsBinding的无依据分支；绑定引导仅依据实际逐仓库路由，工作树等普通conflict保留原地重新提交。新增真实Core/controller/SQLite工作树分支冲突→修复→同client新键成功，以及实际组件通用冲突的恢复控制，先2项RED，再26项GREEN。 独立复评与最终组合的当前版本证据追加于所属review记录。下列2026-10-26冻结source/S3是对应历史源码的实测，不能替代此次变化后的当前版本实测。

B1/B2 已实现：在本计划执行上下文运行 B1 命令 32/32、B2 扩展窄回归 47/47；`pnpm verify` 通过（当时全量 2023、MVP0 7），补充两项恢复矩阵测试后最终 `pnpm test` 2025/2025；`pnpm typecheck`、`pnpm run boundaries` 9/9、`node scripts/workflow-check.mjs` 与插件 pack 均 exit 0。完整组件、真实 controller/SQLite、路由回归和插件打包验证已完成。F1/F2 修复后同工作树再运行相关扩展命令 73/73、原独立探针 3/3、`pnpm verify` 2030/2030 + MVP0 7/7、边界 9/9、workflow-check 与 pack，均 exit 0；optional wire 修复后执行 descriptor/Host 窄测 27/27、官方 Gateway 机制探针 1/1、完整主测试 2032/2032、MVP0 7/7、类型/边界/pack 均 exit 0；这些结果尚不能替代浏览器验收。当时 B3 已开始但留空分支实点失败；Superseded by 本节“最终 S3 与归档”（2026-10-26）。初版本地通过结论对“留空参数可穿过官方 Gateway”的推断已被否证：Superseded by Surprises & Discoveries / S3 optional wire（2026-10-26）；当时当前修复需重新冻结并实点；Superseded by 本节“最终 S3 与归档”（2026-10-26）。保留TD-070进程内setup账本边界与#359真实会话生命周期范围；若产生新实质债务，执行者在 `docs/exec-plan/tech-debt-tracker.md` 登记后纳入文件范围。验收全过后归档并更新索引。

最终 S3 与归档（2026-10-27 00:00 +08）：在本计划分支冻结产品 source `9d968935571644bf053b24283951a8b9c42fb9b5`，tgz SHA256 `2b959baf82db7b2196b8df385684b86b0e72ce042b8263e7df0b595e4f8426e9`，15 个产品源码摘要与全部 12 个安装文件逐字节核对。官方 `0.2.0-rc.2` Web、全新重装后的同一自有 Host PID 完成：预绑定 fixture 的详情打开/仓库选择后 context/run 仍零；空分支表单双击只发一次实际 typed 请求，JSON 确实省略 branchName。Gateway 返回 confirmed/authoritative，Core 创建默认 `work/<work-item-id>` 分支；RPC、SQLite 与 Git 一致，仅一个 context/run/mutation、新分支和新 worktree。执行区重读显示 context ready、manual_fallback、run failed，恢复为 manual_execution；不把 Git 准备成功说成模型执行成功。前后 Project A 16 字段/9 成员规范化快照相同，SHA256 `350f91fb9cc3c8b059508034b1758c71727cace4ab2363b61fb09daa1abdbaa5`。协调者另外直接执行 resolution-check 与四份相关 node test 24/24 通过。

独立组合复验：旧候选 `d37877af` / tree `afbb9321` 已通过 2081 主测试、MVP0 7、窄测 100、边界 9，并在空库真实执行创建、连接、绑定、非空分支 Start Work、谱系刷新、卸载重启；规划不变，Git checkpoint 与业务表保留，游标可以推进。该旧树不覆盖新 optional marker。随后独立验收者仅合入本次产品/测试修复，排除计划增量，得到 `c5320303` / tree `40999631`；窄回归 17/17、pack 通过，新 tgz SHA256 `f2ab18347e15d37dbe48b5212f8d6bf78143cb3ceddcb2844524495a72a53e04`。新实际官方 Web 对另一原先无 context 的可见工作项留空分支双击，仍只新增一个 context/run/mutation、默认分支和 worktree；随后真实 refresh/query/SQL/UI 六位置一致，context/worktree 确认，后四项 not_observed，规划前后相同。source/安装字节与 wire 原件分别冻结；未重跑全量组合测试，不把旧树全量结果移作新树证明。

独立对抗验收关闭原确定失败重试 P1、同步 throw P2，官方 Gateway 及最终组合的窄复评未发现新增阻塞项。TD-070 进程内 setup 账本与 #359 真实 Harness 会话生命周期继续保留；本项只验收人工降级切片，没有新增待补偿迁移、后台框架或发布声明。单 PR 使用真实 Host setup 预绑定 fixture，组合才证明 UI 绑定后的实际选择。真实证据限 Web，不能扩为 Desktop、真实模型执行或 R1。

远端交付以可重算命令为准：在本分支根执行 `gh pr checks -R SingularityKChen/harness-projects 408`，并回读 head/base、全部 review threads、当前 CodeQL、closingIssuesReferences 和 #142 的 closedByPullRequestsReferences；与最终发布 head 一致且无未处理阻塞意见后执行 `gh pr ready -R SingularityKChen/harness-projects 408`。本计划不预写未发生的远端结果。

## Bottom Change Note

2026-10-27 00:00 +08：补充最终空分支官方 Web 与独立新组合实证，保留旧产物失败和回归身份；归档计划，远端易失状态按命令回读。

2026-10-26 22:48 +08：具名参数消费者验收GREEN、typecheck与pack通过；S3以本次新产物身份重验。

2026-10-26 22:45 +08：以三份真实消费者RED收口并行工厂参数碰撞，仅改本功能具名接线；新增setup-client验收路径，最终产物重新freeze。

2026-10-26 +08：由两份独立设计与当前源码审评收敛初稿，固定四门、Host模式、尝试身份及独立/组合证据边界。

2026-10-26 +08：记录 B1/B2 RED/GREEN、读间撤权与逐仓库门修正、最小旧契约同步和 B3 接手边界；计划保持 Active。

2026-10-26 +08：依据独立验收 F1/P1 与 F2/P2 修正确定失败分类和 Promise 清理时序，追加真实终态恢复、同步异常及丢失确认响应持久控制；B3 与独立 scoped 复评继续保留未完成。

2026-10-26 +08：用官方 0.2.0-rc.2 S3 失败否证 optional wire 假设，保留原 source/tgz 冻结身份；补齐 branchName 的官方 optional descriptor 标记并记录双层 RED/GREEN，B3 仍未勾选。

2026-10-27 +08：按MMP完整初审修复新增P2，保留原S3的冻结源码/时间边界，新增判别性RED/GREEN证据；未改变规划Status。

2026-10-27 +08：追加MMP评审收口与新组合证据回传，保留各历史源码的实测身份，不混用为新单PR精确产物。
