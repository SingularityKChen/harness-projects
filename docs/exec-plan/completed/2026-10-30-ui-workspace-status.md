# 持续真实工作区状态摘要 ExecPlan

> 状态：Completed（工程与隔离安装验收）；创建：2026-10-30；分支：`feature/ui-workspace-status`；PR base：`main`。
> 范围：关闭 #484；检出 `.worktrees/ui-workspace-status`；遵守根 `PLANS.md`。

## Purpose / Big Picture

人在工作项和设置之间移动、滚动时始终看见当前工作区、Planning 确认层级、Host transport 和必要的未决操作事实。configured 不会显示成 confirmed，断线不会显示在线，未知写入不会因离开表单变成 Saved。最小证据是生产绑定 Panel 中的同 scope 状态、真实 source 状态矩阵和 false-success/stale-scope 负对照。

## Context and Orientation

现有 `WorkspaceSetupGate` 拥有设置导航和表单组合；各表单有局部 notice，列表有 freshness，但没有跨视图的稳定摘要。setup snapshot 只有 pending，没有 active operation kind，failure 不能当成正在进行的动作。WorkspaceRead 有 workspace/connection/planningSource/reconciledAt；最后一个是 Host 的规划来源确认时间，lastUpdatedAt 是 client 接收帧时间。mapping snapshot 有完整 scope/intentState；repository snapshot 没有 workspace identity。

生产入口 `apps/harness-plugin/src/client.ts` 创建现有 sources 后调用 bindWorkspaceSetupApp。状态 UI 可以通过一个小型生产绑定包装函数组合摘要与原 Gate，不争夺 Gate 导航实现。初始观察为 2026-10-30 的 main@417349a；当前 SHA 与 PR 状态须重新读取。

## Design / Spec

选纯 `deriveWorkspaceStatus` 加私有 `WorkspaceStatusSummary` 与绑定 Panel。包装层在实际生产入口消费既有 sources，使用 useSyncExternalStore，不复制 snapshot 到 state、不创建 store、poll、probe 或 timer。布局常规路径为不滚动摘要+可收缩 Gate，给后代传递实际父高度。原“不制造第二 scroller”绝对约束已被有界窄屏实测推翻（Superseded）：匹配完整来源时间和三项操作使摘要超过整个 Host 高度。摘要最多占实际父容器 50%，内容超出时成为带 Host 焦点环、可键盘/滚轮操作的具名滚动区；Gate 保留另一半及其既有短高回退。常规高度摘要不滚动；不以 body/页面隐藏滚动代替可达性，不猜 viewport 高度、不缩小字号、不隐藏事实。时间行上下堆叠并保留精确 datetime。B 独立面向 main 时，基线 Gate 的长内容由 `.hp-status-body` 的 overflow:auto 承接；A 已提供有界正文 owner 时，该 companion fallback 必须没有实际滚动范围（scrollHeight=clientHeight，容许1px舍入），不复制 A 的导航/布局。摘要自身定位为 relative，为既有绝对定位的隐藏 announcer 提供包含块，避免它逃出 clip 产生 HTML 隐藏滚动。不给正文重复增加 tabindex/焦点站。稳定摘要用普通 labeled dl/text；dt 不收缩，字段行 intrinsic flex-wrap，值放不下时自然移到下一行使用整行宽，短字段仍可同行。窄屏换行，不做 global footer、总健康灯或新 Host slot。

稳定维度为工作区（缺观测“状态未知”，明确 null“尚未创建”）、Planning（未绑定/配置已记录待确认/已确认/读取不完整）、transport（已连接/连接中断/未知）。transport 仅用与 setup workspace 匹配的 WorkspaceRead；规划确认时间还必须匹配当前 binding。缺 binding/不一致时省略时间并标当前来源观测未知，不回显旧 workspace 名字、旧来源身份或时间。confirmed+disconnected 同时显示 Planning 最后已知已确认和连接中断。禁止 new Date/lastUpdatedAt 冒充来源确认时间。新增独立当前来源读取观察：仅在 workspace/binding 匹配后，以既有 capability key/accessIndex、read.reason 的存在性与 lastUpdatedAt 是否已观测分类当前读取、读取不完整、不可用、未知或最后已知值。这里只消费 Host/client 读数；不枚举实体、不新增权限判断，不回显 raw reason。lastUpdatedAt 的存在性沿用现有新鲜度语义，仍不充当来源确认时间。

操作摘要按独立 scope 保留：setup.pending 只叫“工作区设置正在处理”；setup safe error 为失败/结果未知；mapping 必须完整匹配 workspaceId/bindingId/projectExternalId 才展示 pending/local_only/unknown。repository 未决只称“仓库操作正在处理/结果未知”，不显示本机路径、账号或无证据的当前工作区归属；若已观察 workspace 换代，保守称先前仓库操作且不回显 repository identity，不清除 source。local_only 永不等于权威 Saved。CI/执行不参与 Planning 或权限决策。

单一新 live announcer只播报 transport/当前来源读取观察的变化；操作摘要是普通可读文本，由现有表单 status/alert 播报原操作，避免同一事件新增第二播报。整块摘要和壳不设 aria-live。若测试发现既有消息重复，先按同一事件归属修正最小呈现，不新增公告 store/事件总线。稳定 rerender 和仅 reconciledAt 推进不改变 live 文本。列表在外层拥有 freshness/availability 时，仅保留显式刷新/失败以及连续可读期间的安全数量变化公告；不可读/未知即清空旧数量文字与 AX 输出，恢复不重播数量。原生模态内沿用已有 detail notice，由同一纯观察 helper 提供安全降级/恢复信息，外摘要保持原生 inert。用键盘和 screen reader 观察验证，不以 SSR 证明实际播报次数。

备选“页尾复制 notice”无法持续可见；“全局状态 store/Host footer API”无必要且增加权威成本；“直接写 Gate”行数少但与 shell/tasks 同一 owner，故采用实际生产 Panel 的薄组合，不做通用框架。该包装单独回退不改变任何请求或事实。

## Global Constraints

代码/测试/fixture/config 新增+删除≤799 行，文档≤1299 行；估计300–500/200–300，≥740重新收敛。无迁移、新依赖、Provider、路由、主题状态、权限刷新、持久化或第二事实源。Host/ack/reconcile/secret handle 与 Planning 正交不变。禁止写 Planning Status、native dependencies 或自行合并。文档中文、仓库相对路径；日志截图留 `.superpowers/`，不发布账号/本机路径/原始错误/会话访问 URL。

B owner 文件集合：`packages/ui-model/src/workspace-status.ts`（新）、`packages/ui-model/src/index.ts`、`packages/ui/src/workspace-status.ts`（新，含局部样式和生产绑定包装）、`packages/ui/src/index.ts`、`packages/ui/src/workspace-setup.ts`（仅透传播报责任）、`packages/ui/src/work-item-app.ts`（含同一安全来源观察 helper 的 detail notice 消费）、`packages/ui/src/work-item-project.ts`、`packages/ui/src/work-item-list.ts`（仅列表公告文字责任） 、`tests/integration/harness-plugin-artifact.test.js`（既有断言的维度限定）、`apps/harness-plugin/src/client.ts`（仅绑定 import/call）、`tests/contract/ui-workspace-status.test.js`（新）、`tests/integration/harness-plugin-workspace-status.test.js`（新）、本计划 `docs/exec-plan/active/2026-10-30-ui-workspace-status.md`（完成后同名移 completed）、`docs/README.md`（整合 owner 串行）。不编辑 workspace-setup 的导航/布局、form/scroll 文件或共享 fixture；需增强 carrier 时由整合 owner 串行处理并显式计入对应 diff，不能隐形越界。A/C 无 B API 依赖，B 主分支 PR 独立验收/回退。

## Plan of Work

### Batch T0 · 事实与真实 source 的 RED

在检出 feature/ui-workspace-status 的工作树根完成 `git rev-parse --git-dir --git-common-dir`、`git status --short --branch`、`git worktree list --porcelain`、`git check-ignore -v .worktrees/`，并运行 `pnpm install --frozen-lockfile`（lock 无变化）。回读 #484 与生产 apply，先写专项 tests：真实 setup/mapping/repository sources 经受控 port 到状态 view/Panel；含缺 read、错误 workspace/binding、unknown、断线与恢复。

运行 `pnpm test:file tests/contract/ui-workspace-status.test.js tests/integration/harness-plugin-workspace-status.test.js`，必须先看到目标行为 RED，不能把缺模块/导出错误算有效 RED。可先用可编译空摘要占位令行为失败，但不要提交临时占位实现。已有 draft 不重复创建；回读 base=main/draft=true/Closes #484。回滚到只含计划的基线。

### Batch T1 · 最小投影、生产消费与 GREEN

主文件为 workspace-status 两模块、index 和 apps client 绑定。实现明确维度与 scope 限制；传入既有 sources、原样透传 Gate props。生产测试必须通过 apply 取得 main Panel，不能只测孤立组件；确认没有新增 port 调用、重复 command、第二 store 或 Provider import。稳定订阅快照不能在每次 getSnapshot 生成新对象。

运行 T0 命令，再运行 `pnpm test:file tests/contract/ui-workspace-setup.test.js tests/contract/ui-work-item-app.test.js tests/contract/ui-planning-mapping.test.js tests/contract/ui-repository-binding.test.js tests/integration/harness-plugin-workspace-setup.test.js`、`pnpm typecheck`、`pnpm boundaries`，期望 exit 0、零 skip。回滚此批投影/绑定即回原 Gate，不碰 source、Host 或数据库。

### Batch T2 · 组合、负对照和交付

运行 `node tests/fixtures/execution-drawer-browser.mjs`，现有 carrier 从真实 Host/remote 到生产 apply 自动消费新 Panel。实际浏览器使用真实设置入口检查两面 status，320/375/1024/1440、短高、200% text、light/dark；观察摘要可见/换行、键盘、transport 变更只宣告一次。受控 ports 的完整状态矩阵仍属于无凭据 source 证据，不冒充实际 Provider/安装。

在隔离 probe 依次把 configured→confirmed、无 read→connected、local_only→Saved、删除 workspace/binding fence、用 browser clock/lastUpdatedAt 替代 reconciledAt；对应具名 case 必须 RED，还原 GREEN。无害 wrapper/class 变化不应破坏语义 test。不得为追求 mutant 数量加镜像断言。

最终干净提交运行 `node apps/harness-plugin/scripts/bundle-report.mjs --source-root . --out .superpowers/ui-status-bundle`，对相同工具链干净 main base 比较；执行 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`、`shasum -a 256 apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.1.0-demo.1.tgz`、`pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-demo-artifact.test.js`。期望全部0，记录 source/artifact SHA、raw+gzip delta/inputs/externals。

逐条执行 `docs/product/demo-install.md` 的隔离 DSH_HOME/Documents overlay、artifact-only 和固定 @deepseek-ai/dsh@0.2.0-rc.2 Web profile 安装；核对实际安装 bundle/hash。当前 Desktop rc5另记兼容观察。安装候选截图须显示同 scope 的 settings/list 状态；若缺 Provider 凭据只记录未验，并保留 #449 的精确候选人类接受门。

运行 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`，人工五类目和更严799/1299检查后整理提交。最终 push 后回读 `gh pr view -R SingularityKChen/harness-projects feature/ui-workspace-status --json headRefOid,baseRefName,isDraft,closingIssuesReferences,reviewDecision,statusCheckRollup`、`gh pr checks -R SingularityKChen/harness-projects feature/ui-workspace-status` 及全部 review threads；当前 head 必需 PR Fast Gate/验证通过才 ready，不自行合并。记录未运行/失败项，不沿用旧 head 绿色状态。

## Validation and Acceptance

| 验收 | 判定证据 |
|---|---|
| 四态与transport正交 | 真实 source驱动 unbound/configured/confirmed/degraded；无 read unknown，断线 last-known，恢复按真实 snapshot |
| scope安全 | 旧 workspace/binding/project迟到，不显示旧名字/时间；mapping完整scope；repo无workspace归属时保守概述 |
| 未决事实真实 | setup/mapping/repository pending、failed、unknown、local_only跨settings/list存在；从未显示权威Saved |
| 时间来源 | 只有匹配来源的reconciledAt；缺失省略/未知；无浏览器时钟与假last-sync |
| 持续可访问 | B独立生产apply与A+B组合均验证，不能互相替代；main Panel、320/200% text、两主题、短高；正常文本labels、一次transport变更一次简短宣告 |
| 回归/负对照 | false-success/stale-scope等具名mutants RED→还原GREEN，原source参数/次数不变 |
| 发布证据 | 当前source/tgz/Host identity、same-build delta、当前head checks；本地/组合/安装/人类接受分开 |

## Progress

- [x] (2026-10-30 +08) 两份独立方案与源码综合完成，采用现有source纯投影与实际生产薄绑定。
- [x] (2026-10-30 +08) T0：a2483eb 基线与既有 frozen 依赖；回读 draft #487/main/Closes #484。真实 source 的 5 个行为 RED、生产 apply 的 2 个缺摘要行为 RED 均已观测；缺模块未作为 RED。
- [x] (2026-10-30 +08) T1：10 个专项 GREEN；59 个相关回归、typecheck、9 个边界检查通过。列表播报责任按观测作最小扩展，后续需重新验证最终候选。
- [x] (2026-10-30 +08) T1R：复现独立评审 P1/P2 的 DOM/行为 RED；11 个有界几何/键盘/滚轮用例通过；实际 apply 连续来源降级/不可用/未知/恢复和原生模态 AX 公告通过；最终 pnpm verify（2710+7）、boundaries、40 个专项/artifact 通过。
- [x] (2026-10-30 +08) T1R2：独立复评保留的 P1 已复现 standalone body overflow:visible 的 DOM RED；仅两项 CSS 修复后，6 个 standalone 布局/Tab/真实返回用例、11 个 A+B 无额外正文 range 用例及双方 table/detail 独立滚动观察通过。移除 fallback 的具名负对照重新失败；40 项 targeted/artifact 与 tsc 通过。P2 源未变，本轮不重新裁决。
- [x] (2026-10-30 +08) 呈现跟进：按实际 rc5 安装图复现工作区标签逐字纵排；dt flex-shrink:0 配合字段 flex-wrap:wrap 后标签1行、长名称2行。12个独立B/A+B窄宽/两主题用例无横溢出，摘要≤50%、滚动owner不变，40项专项/artifact和tsc通过。未修改两份整合owner未提交文档。
- [x] (2026-10-30 +08) T2：独立 P1/P2 复评、两项标签呈现复评、隔离安装与最终产品树验证通过。最终 push 后仍须回读当前 head/base/checks/关联/threads，必需门禁通过后才 ready；本条不提前推断 hosted CI。

## Surprises & Discoveries

setup没有active操作kind；repository没有workspaceId；因此完整精确的跨工作区操作归属无法由现有读数建立，必须保守显示而非补造authority。lastUpdatedAt不是来源确认时间。源码证据已读。浏览器证实旧列表 freshness 与新增 transport 各变更一次 live 文本；改为列表普通 freshness 文本加独立安全数量/加载/刷新/错误公告后，同一断线只观察到摘要的一次 polite 文本变更。这是 DOM mutation 观察，尚非屏幕阅读器语音验收。初次全套 2703 项中 2701 通过、2 个 artifact 断言失败：新包装改了根元素，现已保持原 section 可访问名称；旧整体 no-已连接 断言混淆了 Planning 与 transport，现缩小到规划字段并保留全局 noSaved/受保护条目断言。修正后 artifact 与专项共 35 项通过，完整 pnpm test 2704/2704、零跳过通过；最终紧凑布局后重跑相关 artifact/source 验证。未验证安装/CI。

独立评审与实现方均在有界 A+B 实际组件复现：320×420/200% 文字、匹配完整时间时摘要约 627–628px、正文 0；多项真实 source pending 更高。只紧凑文案不足，故修订滚动合同。修复后 320/375×420、200% 文字、两主题、三项 pending 与长合法名称共 9 个窄屏用例均为摘要 209px、正文 210px；可 End/滚轮到摘要末项，主区 End/焦点到完整绑定仓库按钮，随后返回工作区成功，app 隐藏滚动始终 0。1024×768/100% 与 1440×900/200% 摘要分别 82/213px，无摘要滚动。探针只以 immutable A 门/样式 892a614 与当前 B 源码组合，不改整合工作树。

来源连续降级不刷新 setup，故原方案只看 setup state 会漏报。新增 pure source observation 后，保持 scope/count/time/transport 不变的 degraded/unavailable/unknown/恢复各只有一次非空 polite 变化，time-only 为 0；unknown/unavailable 下链接与旧数量 AX 输出均为空。原生模态 source 降级/恢复在 AX 中只见 detail notice，背景摘要 inert；两个 DOM mutation 不等于两个有效公告。完整语音与 installed Host 仍待整合验收。

第二轮独立复评限定了上一轮几何结论：A+B 的正文滚动 owner 掩盖了 B→main 的独立缺口。实现方用自身 production apply 复现 wheel body0/app0，末字段 focus app2251、摘要top−2251。增加正文 overflow:auto 后，发现既有 absolute announcer 无包含块还会造成 HTML 537/420 的溢出，并在一次键盘路径中使摘要top−64.5；relative 摘要使 HTML 总高回到420。最终 standalone 末字段→Tab→Tab→真实回到工作项由正文滚动承接，app/html 均0、摘要top0；A+B fallback 实测无 range。不能再将组合通过等同独立闭环通过。

## Decision Log

2026-10-30 +08 / 综合评审：B独立基于main，薄绑定是持续跨视图status的实际生产owner；不是为协调而建通用shell。操作文本不新增live播报，现有form owner继续负责，新增announcer只负责transport。无scope即unknown，DTO不扩展。

2026-10-30 +08 / 浏览器观测后的责任修正（整合 owner 授权）：新增可选 announceListStatus=false 从 Gate→WorkItemApp 显式透传；App 从已安全派生的 view 生成与 transport 无关的快照数量，保留首次加载/不可用的可读文本和显式刷新/失败公告；availability 改由摘要统一公告。连续可读时才公告安全数量变化，未知/不可用清空旧数量，恢复不重播。Project/List 只消费安全公告文字。默认独立列表输出保持原有 live 行为。不增加 context/store，不读 raw store 数量；原正文与抽屉 notice 保留。摘要播报只反映 transport、来源可观察性和降级，时间推进只更新可读 time。未批准规划字段/关系写入。

2026-10-30 +08 / 独立评审修正（整合 owner 明确批准）：以实际父容器 50% 分配摘要的极短高滚动回退，替代被测量推翻的绝对无第二 scroller 要求；相邻摘要/主区均可独立访问，正常宽高不滚动摘要。复用同一纯观察 helper，保留 Planning 确认事实/旧 reconciledAt 与当前可用性正交。公告状态仅为 presentation 过渡记忆，非第二事实源；按实际 read workspaceId + planningSource.bindingId 元组隔离，缺绑定每次清空，来源改名不算 identity 改变。同工作区 binding 换代不继承旧恢复/数量公告；不可读即清空旧 count 输出。未增加 Gate 回调、bus、probe 或规划字段写入。

2026-10-30 +08 / 第二轮独立 P1 修复：允许 B 主区作为 baseline Gate 的 companion overflow fallback，A 有界 owner 存在时自然 inactive，不做 owner 探测/新状态。仅新增 overflow:auto 与 summary position:relative 两个 CSS 属性；隐藏 announcer 的包含块属于持续摘要防全局滚动合同，不改变 P2 公告文本或权限语义。无 Gate/DTO/来源/DOM focus stop 变更。

2026-10-30 +08 / 安装图呈现修正：只增加 dt 不收缩及字段行 intrinsic wrap 两个 CSS 属性。实际320px窗口、56px宿主侧栏、32px文字时，原标签三行；只防收缩会将长name挤到窄列，故选择值自然换整行。标签和值均可辨认，未缩字号/隐藏事实/增加query或state；P1/P2语义不重开。

## Idempotence and Recovery

derive重复执行无副作用；订阅卸载正常停止监听，不dispose他人source。仅producer生命周期处理dispose。probe精确还原单次变异；失败回到最近通过批次。回退本PR投影/绑定提交不改变事实或未决intent。A/B组合在临时集成检出分别验证两种应用顺序；发现高度链相互影响时先修局部容器合同，常规高度不新增滚动，极短高按修订后的摘要/主区两个具名区域合同回退。

## Interfaces and Dependencies

Node≥22、pnpm10.28.2、现有React18/esbuild、浏览器与固定Host CLI；读取既有WorkspaceSetupSnapshot/WorkspaceRead/PlanningMappingSnapshot/RepositoryBindingSnapshot，type-only imports保持边界。ui-model 正常 export 边界暴露纯 workspaceSourceObservation，供摘要与过 route/workspace 门后的 App detail notice 复用；不做实体枚举。Panel包装签名透传既有source/options；apps只替换绑定函数。必要凭据通过Host secret服务现有句柄提供，不进入UI/Project数据库。#457运行态权限、#151完整诊断不在范围。

## Outcomes & Retrospective

纯投影与生产 Panel 已实现，独立复评确认 P1/P2 均 ADDRESSED；最终产品 `c2cc0b1` 的标签小修复也单独通过。真实 source 的配置/确认/断连/降级/不可用/未知/恢复、保护数量清除、身份换代、原生模态 AX 及 false-success/stale-scope 负对照分别留证。DOM/AX 变化不升级为屏幕阅读器语音验收。来源时间推进零公告；操作、transport 与详情各有明确公告 owner。

在 `feature/ui-workspace-status` 检出根，整合者执行四文件状态/生产/artifact/demo 聚焦命令为 54/54、零跳过，typecheck 通过；此前行为候选 `63931e6` 完整 verify 为 2710 项加 MVP-0 7 项、boundaries 9 项。最后产品增量只有 CSS：正文回退、隐藏公告包含块及两项标签自然换行。独立 B 的 320/375×420、200% 与正常宽屏末字段/Tab/真实返回均保持 app/html scrollTop=0、摘要 top=0；A+B 的状态正文 client/scroll=210/210，无额外活动范围。表格横滚与原生详情纵滚归原 owner；移除正文 owner、移除包含块、恢复标签收缩的具名负控均重现原失败，精确还原 GREEN。

官方隔离 Web `0.2.0-rc.2` 与 `0.2.1-rc.5` 安装 `7c02f4a` 产品件，24 个设置聚焦/滚动用例和真实 289 项列表 6 个用例通过。真实 rc2 Host 停止只产生一次断连公告，并保留原来源确认时间；恢复后读数重新确认。表格横滚 1023、详情正文 207/3348/top3141 时外层和摘要位置不变。最终标签增量在 rc5 另装验收：实际 viewport320、侧栏56、200% 文字下标签整行、名称另起整行，末仓库字段仍可聚焦且摘要保持 y0–210，documentTop=0，无页面横溢出；宽屏布局也通过。此增量未机械重跑已通过的两版本全部语义矩阵。

相同 Node26.12.1/pnpm10.28.2/esbuild0.28.2 的干净来源 `0526f53`（产品等于 `c2cc0b1`）相对 main@417349a：Host bytes/hash 不变，client +11657 raw/+2690 gzip bytes，无新依赖/externals；tgz 175238 bytes，SHA-256 `1f545c352ecb4f0b2eaaa69f04b95d51e2a0e43c0dc45a206d96cd6481ebd31d`，与实际安装文件核对一致。在 main 检出根执行 bundle-report，source-root 为 `.worktrees/ui-workspace-status`，out 为 `.superpowers/ui-482-485/status-label`，base-report 为 `.superpowers/ui-482-485/base/report.json`。最终提交整理只改文档/历史，仍须从干净 head 重建并验证相同产物字节。

真实组合 A+B+C@254de4c 由整合者完整执行 pnpm verify：2732 项加 MVP-0 7 项、零失败/跳过；组合产物与93c2932逐字节一致。组合检查不替代 B 独立闭环；后续 C 的窄屏任务选择器修正与 B 状态语义正交，组合安装证据继续记录在 C 的交付计划。

产品约定见 `docs/product/ui-workspace-status.md`。PR #487 独立基于 main，仅关闭 #484；Project 只机械回填 ExecPlan/Batch，Status 和 native 依赖不变。最终远端门禁按 T2 命令回读，本地测试、真实安装、hosted CI 与 #449/R1 人类接受分别记录。无计划内新技术债。

## Bottom Change Note

2026-10-30 +08：实际安装截图确认label被挤为逐字纵排；用不收缩label+intrinsic value换行改善，保留P1/P2已通过语义与50%/滚动合同。

2026-10-30 +08：按独立 scoped 复评仅修原P1的 standalone overflow owner；增加 companion fallback 与隐藏 announcer 包含块，补独立/组合几何和具名移除负对照。P2不变，继续保留其独立通过证据。

2026-10-30 +08：按独立评审修复短高正文被挤至 0 与连续来源降级漏报；以测量修订极端高度滚动合同，补匹配时间/多操作/长名称/原生 modal AX、不可读旧数量清除及恢复抑制证据。

2026-10-30 +08：按真实 duplicate-live 和 artifact 证据扩展最小呈现透传与 scoped assertions；记录 RED/GREEN、7 个 mutant、未完成 bounded/安装验收。

2026-10-30 +08：综合两份独立方案，收敛生产status owner、scope未知策略与单播报责任；补齐可执行验证/回退。

2026-10-30 +08：归档工程与隔离安装结果，补齐独立复评、真实 Host 证据及标签自然换行；最终历史与公开面检查由整合者执行。
