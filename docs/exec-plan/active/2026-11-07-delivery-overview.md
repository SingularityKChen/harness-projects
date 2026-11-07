# 跨工作项交付总览 ExecPlan

> 状态：Active；创建：2026-11-07；关联：Closes #281。本计划遵循根 `PLANS.md`。目标是只读工程交付视图，不作部署或发布就绪判断。

## Purpose / Big Picture

操作者在当前工作区切换“工作项 / 工程交付”，查看本页工作项在明确仓库下的 PR、流水线和检查状态，再打开同一个工作项详情。无 PR 必须显示缺口，未知、陈旧、断连和刷新失败均不能显示当前通过。打开总览和点击刷新执行现有 refresh 命令后重读 Host 投影；单纯读取、时间翻转和恢复前台均不摄入。

最小成功证据是一页同时展示无 PR、失败、未知和新鲜 CI，真实浏览器能键盘打开详情并回焦，撤权后的迟到标题与身份不回显，规划写调用恒为零。

## Context and Orientation

研究基线 `45330b54`。`WorkItemApp` 负责唯一工作区 scope 门，`WorkItemProjectPage` 组合列表与唯一详情抽屉；现有路由只表示工作项详情。`deriveWorkItemListView` 产生授权安全行，redacted 行只有框架 key；`deriveWorkItemDetailView` 只有 ContentKind.WorkItem 才给 executionTarget，并给每仓库 deliveryAccessTokens。不得按展示字符串“Issue”判断业务类型。

`DeliveryLineageReader.refresh(scope)` 调用 Host 显式摄入，`read(scope)` 严格解码 Host 已提交 projection。`DeliveryLineageSection` 已有 open/manual refresh→read、StrictMode、scope/reader/accessToken 失效、时钟边界与 pageshow 纯读。`deriveDeliveryLineageStrip` 是六位置纯派生，`deliverySetFreshness` 是唯一年龄规则：confirmedAt 起算，默认 5 分钟，等于阈值即陈旧；attemptedAt 不参与新鲜度。

## Design / Spec

采用现有 section 的紧凑只读 summary 呈现，保留同一异步读取实现。拒绝复制 loader、每行完整六层详情/创建表单、新 Core 聚合 API、Provider 直连和新 delivery status 数据库。新总览只是同一 Host 事实的消费者。

项目工具栏加两个普通按钮、aria-pressed 表示模式，不制造不完整 tabs。总览一次只选一个仓库，默认按仓库 id 排序的首项，原生 select 清楚标注当前仓库；多个仓库可逐个选择。工作项沿既有安全列表顺序，每页20个，只统计获准且 typed executionTarget 存在的条目。没有合法工作项、没有仓库、Planning 不可读分别显示安全说明，不发谱系请求；Draft/PR-backed/redacted 不产生 scope 或隐藏数量提示。原“typed executionTarget 足以排除 Draft”假设已被证伪，Superseded by Decision Log（2026-11-07）；Draft 通过安全 list/detail gate 后的原生 `externalKind` 排除，不改变既有详情能力。仓库目前没有可靠展示名时标“仓库”并显示已获准 repository id，不虚构名字。

每行展示工作项编号/标题、PR节点或缺口、流水线节点和检查节点各自的文字状态与 confirmedAt；多 PR 与多个 CI 节点保留分开的来源/关系态，不聚成一个“交付通过”灯。不根据邻居、其它仓库、其它工作项或其它提交借成功。新鲜 ci_passed 只叫“已观察 CI 通过”，不是 required checks、可合并、R1 或发布接受。候选/拒绝关系、不可用节点均清楚标注；summary 中 unavailable 或 relationState 不为 confirmed 的 CI 节点将 passed 保守呈现为 unknown，并保留原关系说明。零 PR/零检查绝不空集成功。投影没有安全 URL，不拼接 GitHub 外链。

summary 只展示 change_request/pipeline_run/check_run slots，复用原 strip 与 blocked 下 passed→unknown 规则，隐藏原 section 的单行刷新和创建 UI。页级“刷新本页交付”驱动当前20 scopes，每个显式打开/翻页/换仓库/手动刷新只 enqueue 一次，最多3个 refresh 同时进行，随后逐 scope read；一行失败不阻断其它行。变更 workspace/repo/page/access generation、离开总览时失效尚未 dispatch 的排队任务，已发出的只允许完成而不回填旧屏。显式 refresh 的 command payload 不能提供展示节点。

计时器只用 strip.nextFlipAt 安排重读；pageshow/visibility恢复只 read。新 reader、accessToken、scope 或断连立即使旧成功失效，撤权先遮蔽旧身份和计数，迟到响应不能恢复。页级一个 polite 状态区汇总“本页已刷新 / 部分行未确认”；summary 行使用静态文字，避免20个 live region。标题沿现有 ItemNavigation 打开唯一抽屉；关闭回原行，行消失回总览标题。模式切换保持按钮焦点，异步更新不抢焦点。模式按钮置于既有 context 内的统一工具栏；同一个 WorkItemListPage 壳持续挂载，仅替换正文及诚实标题/region 标签，总览隐藏不作用于它的列表搜索/筛选/列宽控件与列表计数。

宽屏四段、窄屏单列且都有可见标签，沿现有 Host tokens 与局部滚动 owner，320px/200%缩放无横向溢出；不加图表、头像、字体或动画。初版不增加保存筛选、排序、deep link 或 release 分数。

## Global Constraints

唯一文件集：`packages/ui-model/src/delivery-overview.ts`（新，安全 targets）、`packages/ui-model/src/index.ts`；`packages/ui/src/delivery-lineage-section.ts`（summary与显式刷新trigger，保留唯一loader）、`packages/ui/src/delivery-overview.ts`（新，仓库/分页/并发队列）、`packages/ui/src/work-item-project.ts`、`packages/ui/src/work-item-app.ts`、`packages/ui/src/work-item-list.ts`（稳定 context/toolbar，仅允许展示正文/标题/region 标签替换）；`tests/contract/delivery-overview-model.test.js`（新）、`tests/contract/ui-delivery-overview.test.js`（新）、`tests/contract/ui-delivery-lineage-section.test.js`、`tests/contract/ui-work-item-detail.test.js`（既有 hook/子组件定位夹具适配，保留焦点断言）、`tests/fixtures/execution-drawer-browser.mjs`、`tests/browser/delivery-overview.test.js`（新）；本计划与整合者串行维护的 `docs/README.md`。summary 时间呈现复用既有 `packages/ui/src/observed-time.ts`（仅依赖，不修改该源）；不扩大 ui-model 年龄规则、不修改现有 PR 创建功能；组件内部直接 import，无须为内部 UI 添加公共出口。

预算 additions+deletions：safe model及测试100、section复用及回归160、overview200、装配60、浏览器/fixture/其余测试190，目标710，硬门 <800 code/test/config；文档目标220，硬门 <1300。一个 owner 修改本 UI 单元；和负责人 PR 的 create section 改动分开，唯一共同组合处由整合者串行处理。Node>=22、pnpm10.28.2，不增依赖、不改 Provider/Storage/Host wire，不碰 #552 审计文档、不改 Planning Status/blocking。

## Plan of Work

### Task 1 · 单一 owner 实现完整可见总览

主文件为新 `packages/ui-model/src/delivery-overview.ts` 与 `packages/ui/src/delivery-overview.ts`。先写下文模型/组件判别用例并确认 RED。安全 target 派生复用现有 list/detail gate：只在安全 item 行上调用 deriveWorkItemDetailView，只有 content.executionTarget 才输出 scoped item；不从 redacted key 或 identity 字符串猜业务类型。只在新模型复制安全展示字段，不返回原始 WorkspaceRead。

在既有 section 增加 summary 和 refreshToken 接口，同一 effect 保留年龄、授权和单飞围栏；默认 detailed 行为不变。实现当前页 reader wrapper 的3并发刷新队列，队列入场前核验当前scope世代；overview 用该 reader 渲染 summary rows，并以 refreshToken 驱动整页显式刷新。项目页模式仍共享 detailView/navigation，只切列表面板。先实现无 PR 缺口与刷新链，再补权限晚到、分页失效、焦点与小范围样式。

在检出 `feature/delivery-overview` 的工作树根运行：

    pnpm test:file tests/contract/delivery-overview-model.test.js tests/contract/ui-delivery-overview.test.js tests/contract/ui-delivery-lineage-section.test.js tests/contract/ui-delivery-lineage-strip.test.js
    pnpm test:file tests/browser/delivery-overview.test.js tests/browser/workspace-execution.test.js
    pnpm run typecheck
    pnpm run boundaries

期望新行为 RED→GREEN，最终 tests>0、fail/cancelled/skipped=0，原 detailed section 合同全绿。真实浏览器使用生产 Host/client、SQLite 与合成 Provider；不做真实平台或模型写入。回滚完整本 PR，持久事实与现有详情不受迁移影响。

### Task 2 · 独立 spec/产品/质量验收

独立验收者重读保存后的计划、diff、具名测试和截图/浏览器结果，核对20行/仓库范围、最大并发、无PR、5分钟等值、撤权晚到、真实详情回焦、无规划控件。临时将无PR当成功、把 confirmedAt 换成 attemptedAt、去掉 accessToken 失效三种变异，各必须被具名判别测试杀死；还原后重跑对应套件。没有新的跨边界风险，不机械扩成完整 verify。

在同一检出根运行：

    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

期望退出码0，严格规模及人工五类发布面通过。关联 #281 的 draft PR 先存在再实施；最终整理提交、push 后用 `gh pr view`/`gh pr checks`（均显式 `--repo SingularityKChen/harness-projects`）回读 head/base/issue/checks/所有 reviewThreads；当前 head 验证成立才 ready，不 merge。独立验收的问题先修订、重跑再 ready。回滚仍以整 PR 为单元。

## Validation and Acceptance

| 行为 | 判定证据 |
|---|---|
| 安全范围 | `overview excludes draft PR-backed and redacted targets without leaking counts`；不可读时 reader 调用0 |
| 无PR/CI诚实 | `missing PR and empty checks render gaps not passed`；`unknown stale unavailable and failed refresh never show current passed` |
| 唯一年龄规则 | `overview ages at exact threshold from confirmedAt and ignores attemptedAt`，复用 strip 默认与配置阈值 |
| 摄入与读取分离 | `open page and manual refresh each refresh then reread current scopes`；命令伪节点不出现；`age and pageshow only read` |
| 并发与scope失效 | `page refresh caps three flights and cancels queued old scopes`；`revocation and late old repository results never restore canary identities` |
| 用户闭环 | `delivery overview opens unique drawer and returns keyboard focus`，320px/200%缩放、Tab/Enter/Escape；planning mutation=0 |

## Progress

- [x] (2026-11-07 SGT) 同步 `origin/main` 的创建 PR 来源 Issue 语义；唯一 section 冲突保留 `creatorAccessToken`。在检出 `feature/delivery-overview` 的工作树根运行 Task 1 合同（41）、生产组合浏览器（6）、`pnpm run typecheck`、`pnpm run boundaries`（9）均退出 0，tests 的 fail/cancelled/skipped 为 0。

- [x] (2026-11-07 SGT) 三份独立方案与基线源码核对，收敛为共享 section summary、明确仓库和20项范围。
- [x] (2026-11-07 SGT) Task 1：模型与组件、共享 summary loader、20项/单仓库/3并发、红绿与生产组合浏览器实施；最终基线同步和复验记录见本节后续条目。
- [x] (2026-11-07 SGT) CI 布局修复本地验证：两项原失败矩阵 RED→GREEN，完整 `pnpm test:browser` 60通过、相关合同75通过、typecheck退出0、boundaries9通过；原断言阈值不变。
- [ ] Task 2：CI 布局修复待独立 scoped 复审；修复前独立评审的 Approved 仅覆盖旧 head，当前发布面/规模与最终远端回读门未完成。

## Surprises & Discoveries

2026-11-07：`packages/providers/fake/src/planning.ts` 明确 Draft 与 Issue 都是 WorkItem，只差原生类型。仅 `executionTarget` 不能排除 Draft；新模型在安全门后读取 typed 原生元数据。生产 Provider 观察默认生成 candidate 关系；浏览器正控先用真实 Core 确认合成关系，候选成功仍保守显示未知。模式按钮曾随列表卸载丢焦；浏览器红测捕获，曾改为独立稳定容器。该容器在 context 外占高的结构被共享布局 CI 证伪，Superseded by Decision Log 的 CI 布局修复（2026-11-07）。扩大组合回归发现旧合同夹具只实现 ref/effect，且假设列表容器只有一个子节点；补 `useState` 与按组件类型定位，保留全部原焦点断言。

现有 section 已实现完整 loader，因此无需新 hook 的搬移成本。现有安全 list row 的 identity 是展示字符串，不能以“Issue”等字符串发起执行请求；安全目标从既有 typed detail.executionTarget 取得。run-test-layer.mjs 的 countTestFiles 明确支持单 test 文件，但本计划直接用 pnpm test:file，避免命令名和层目录歧义。

## Decision Log

2026-11-07 / 实施 owner + 整合者：CI 实际旧矩阵复现后，拒绝放宽表格 slot/紧凑 toolbar 断言。新增模式块在 context 外高169px（320px/200%）使 context 最小90px + table 最小285px 超出剩余326px；宽屏多出44px空行。修复为原 WorkItemListPage/context/toolbar 始终挂载，模式按钮进入原 actions，仅替换正文/标题/region；原表格滚动 CSS、reader、mode 和唯一抽屉状态拥有者不变。总览隐藏不作用于它的列表专属控件与计数。

2026-11-07 / 实施 owner + 整合者裁定：Draft 只在新模型安全 list/detail gate 之后按原生 `externalKind` 排除；不修改既有详情/StartWork，也不按展示字符串猜类型。队列只限制显式 refresh，读取、时间边界与恢复沿用 section 唯一实现。无 PR 仍是缺口，CI 不修改规划。

2026-11-07 SGT / 独立综审：采用 C 的单仓库/20项范围和共享 summary，拒绝 A 的全 workspace×repo 一次刷新与 B 的大段 hook 搬移。Rationale：明确刷新责任与请求上界，保留现有状态机，控制 changed-line 预算。

2026-11-07 SGT / 独立综审：每个 CI 节点只报告已观察事实，无全行成功灯。Rationale：集合成功不能证明 required checks 或发布接受。本能力范围外的部署、发布就绪、共享视图不是实现债务；若发现必要安全路径无法在预算内实现，更新本计划并在 `docs/exec-plan/tech-debt-tracker.md` 登记真实缺口，不能删测试隐藏问题。

## Idempotence and Recovery

显式刷新可重复、自然幂等，不离线排队或重放。页离开和切仓库清掉尚未 dispatch 的队列；在途 I/O 的结果只在当前 generation、reader、scope、accessToken 同时匹配时使用。失败可显示仍获准的最后已知事实，passed 降为 unknown，撤权立即清空敏感节点。下次用户显式刷新核对当前 scope，页面恢复只读。没有数据迁移；整PR回滚恢复旧工作项列表/详情。

## Interfaces and Dependencies

新纯函数固定为 `deriveDeliveryOverviewTargets(input: WorkItemListReadInput): DeliveryOverviewTargets`，输出 `{kind:'loading'|'unavailable'}` 或 `{kind:'content',items:readonly {key:string,title:string,numberLabel?:string,target:ExecutionTarget,accessTokens:Readonly<Record<string,string>>}[],repositoryIds:readonly string[]}`。blocked 无 items/count；只输出经 list/detail gate 的 work_item。每项 target.repositoryIds 与当前 workspace 仓库完全一致，accessTokens 复用 detail.deliveryAccessTokens。

`DeliveryLineageSection` 新增 `presentation?: 'detail'|'summary'`（默认detail）、`refreshToken?:number`、`onSettled?:(failed:boolean)=>void`；summary 不含 creator/单行刷新/live region，保留现有 reader、scope、connected、thresholdMs、accessToken。token 初次与变化表达一次显式 refresh，StrictMode effect 重放不会重复摄入；token 未变的重读不摄入。onSettled 经稳定ref调用，不把每次render的新callback加入effect依赖造成重复读取。新 `DeliveryOverview` 接收安全 targets、reader、connected、ItemNavigation、onBindRepository；本地持 repositoryId/page/refreshToken，非权威事实。

`WorkItemApp` 在已有 input 构建处派生 targets 并传给 project；project 持模式、复用唯一抽屉与 opener 记录，总览卸载不丢当前详情路由。依赖现有 DeliveryLineageReader、deriveDeliveryLineageStrip、ItemNavigation 和 Host tokens；不依赖 assignee 两叶或 PR #565。

## Outcomes & Retrospective

已实现总览并完成本地合同/生产组合验证；托管 CI 揭示未纳入初次窄验证的共享布局回归，已据 DOM 测量修复并完成完整浏览器层60项。CI 修复仍待独立 scoped 复审与新 head 托管验证；安装接受尚未完成。自动化只证明合成组合，不代表 R1/发布或人类接受。全部验收完成后更新本节、Progress，按 PLANS 归档并更新 docs 索引。

## Bottom Change Note

2026-11-07 SGT：综合三份设计并修订为一个完整只读总览 PR；明确 typed 安全 scope、20项/单仓库/3并发、同一 loader、精确刷新与年龄边界，拒绝额外事实源。

2026-11-07 SGT：Task 1 完成初轮实施与具名红绿；补充 Draft 类型假设订正、合成关系确认正控和键盘焦点修复证据；Task 2 独立验收仍未完成。

2026-11-07 SGT：同步新主线，保留创建入口的来源权限令牌；记录最终窄验证与既有组合合同夹具适配，独立验收门保持未完成。

2026-11-07 SGT：按独立评审 P3/F1，仅 summary 确认时间复用既有 ObservedTime 本地化并明确时区，精确 ISO 留在 dateTime；detail/loader/年龄事实不变，追加语义时间接线与320px/200%像素验证，Task 2 待修订范围独立复审。

2026-11-07 SGT：以托管 CI 两项旧布局 RED 与 DOM 前后测量订正独立模式条结构；保留既有统一 toolbar/context/滚动 owner，补完整浏览器层与75相关合同证据，Task 2 明确为CI修复待独立复审。
