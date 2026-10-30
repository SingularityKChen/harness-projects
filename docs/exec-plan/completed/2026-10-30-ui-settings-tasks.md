# 聚焦响应式 Core 设置任务 ExecPlan

> 状态：Completed（工程与隔离 Web 安装验收）；创建：2026-10-30；分支：`feature/ui-settings-tasks`。
> 范围：关闭 #485；检出 `.worktrees/ui-settings-tasks`；初始 PR base：`fix/ui-workspace-shell`；遵守根 `PLANS.md`。

## Purpose / Big Picture

人在设置首屏能看懂当前任务、工作区、返回入口与主要动作，并在规划连接、字段映射、执行、仓库四个真实任务之间切换，保留草稿和未决写入。已确认连接重访先显示配置摘要，通过显式编辑进入连接表单。宽面板不过度拉伸字段；320/375px和200%文字仍可完成任务。成功需要匹配尺寸/theme的实际Host截图与行为证据，SSR样式字符串不足以验收。

## Context and Orientation

现有设置把四个任务堆成长页；FORM_STYLES使字段满宽。Gate持项目草稿/导航，mapping/repository表单持局部草稿，sources持提交identity和Host读回。repository卸载会cancelAttempt，mapping refresh替换data可能清草稿，分类不能靠条件卸载完成。

本PR确实依赖shell PR关闭#482/#483所提供的语义合同：外层显式workspace/settings本地view；顶部返回不依赖pending/confirmed；唯一有界正文scroller；同scope设置子树跨leave/reopen保持type/key/位置；mapping refresh不由导航触发；隐藏表单完成不抢焦点。本PR在稳定设置子树内部增加分类，不复制这些机制。仅共享文件不是堆叠理由；若移除该合同，#485的短高可达、草稿/intent与inflight切换验收就不成立，因此不能基于缺陷main独立宣称完成。

工作树最初可能只含main@417349a和文档；先准备独立新组件/专项测试，等shell实现owner完成后同步其当前提交，再由一个组合owner改Gate。B状态摘要独立基于main；本PR无需导入B，当前工作区上下文与原状态仍需自包含。

## Design / Spec

采用私有固定四任务`WorkspaceSettings`组合。宽面板用约10rem分类rail和max-inline-size:46rem正文；窄于约44rem改原生任务select+单列正文。select以可见“任务”label关联，完整提供四个任务选项；宽侧栏与窄select由CSS只显示一种，使用同一个局部active状态。compact label允许intrinsic flex-wrap；select以6em basis参与分行，空间不足时独占完整行，不缩字号、不截断任务名；空间足够保留紧凑同行。容器尺寸来自面板，避免以浏览器window宽度误判嵌入slot；可用现有CSS容器查询或能满足同等观测的最小CSS，不能引ResizeObserver状态副本只为布局。rail是局部任务导航，不复制Host sidebar。原生button、aria-current、清晰关联heading即可，不冒充tabs。按钮和select保持至少44px目标；选择后保留原生控件焦点，Tab进入当前任务，背景响应不移动焦点。任务导航先于长工作区context与共享setup恢复出口；context/出口是固定leading slot，仍在hidden任务面板之外。显式进入/重入设置才在提交后把当前任务控件移入既有正文与极短高root回退的可见范围；仅修改这两个既有元素的scrollTop，不移动焦点、不滚Host/document。普通回读、theme、resize和晚响应不触发该重定位。

只显示当前panel，其余用hidden保持相同tree identity。分类选择纯local，不save/bind/refresh/install/reset/cancel。不要把ReactElement放到会在每次render变type/key的临时组件工厂；固定组件定义和稳定task keys。同scope跨分类、leave/reopen保留project空草稿、mapping IDs/options、repo未提交值/intent。scope换代按shell合同清晰隔离，不把旧draft套新target；source继续控制迟到响应。

每个任务有h3、一句目的、当前确认状态和单一主要动作：规划连接为连接/编辑连接；映射为应用映射；执行为显式启用或已启用配置说明；仓库为绑定/恢复。未创建工作区保持创建入口；mapping无完整binding/project或无source时展示真实prerequisite和下一步，不做死导航/空白页。执行绑定已启用不称会话/模型已就绪。

confirmed重访默认显示安全workspace/project确认摘要与“编辑连接”；现有project form保持mounted但hidden，显式编辑后打开。form未决/error/unknown不能被摘要遮掉；工作区设置级错误/恢复使用任务面板外单一出口，规划input继续关联其ID；mapping/repository字段错误仍归各自表单；当前提交未确认时展示实际恢复，不自动编辑、连接或claimSaved。用户主动编辑中的draft不因同scope重复snapshot回读而静默折叠/覆盖；source目标变化才按新scope初始化。用本地edit状态，不新增业务确认状态。

保留原生label、required、help/error关联、同名和删除的映射ID/options、repo路径/owner/name校验与safe errors。必要help/前置条件/错误常显；重复技术解释可原生details“填写说明”折叠，aria-describedby目标仍有效。控制浅边框、中性表面、Host tokens、单一accent，不引图标库/主题状态/阴影卡阵列。若预算紧，先取消特殊宽屏label行和可选disclosure，不删未知结果与生命周期验证。

窄面板备选横向滚动按钮需要维护active可见位置并增加第二轴；四按钮完整堆叠在320×420/200%会先消耗四个44/77px目标高度，实际安装已证明当前类别藏在首屏以下，因此由原生select取代该首轮意图。备选accordion代码少但仍可能回到长页扫描、当前任务不清晰；应用router/通用settings framework/新设计系统依赖无必要；条件render选中表单有实际取消/草稿风险，故均不选。两份设计的main独立建议在本综合中修订为真实shell→tasks堆叠，理由是上述验收合同。

## Global Constraints

相对实际shell base的代码/测试/fixture/config新增+删除≤799行、docs≤1299行；预计450–650/220–330，≥740收敛。不得靠压行、搬整文件或另开无用户闭环PR规避。无迁移、新Provider/依赖/router/store/主题authority/权限刷新。Planning与执行/CI正交、Host权威、ack/reconcile/secret handle不变；不改Status/native dependency、不自行merge。

C owner文件集合：`packages/ui/src/workspace-settings.ts`（新、私有固定任务组合）、`packages/ui/src/workspace-setup.ts`（shell owner停止后同一组合owner串行编辑）、`packages/ui/src/form-presentation.ts`（仅settings局部规则）、`packages/ui/src/planning-mapping.ts`与`packages/ui/src/repository-binding.ts`（仅必要help/markup，不改source语义）、`tests/contract/ui-workspace-settings.test.js`（新）、`tests/contract/ui-workspace-setup.test.js`、`tests/contract/ui-planning-mapping.test.js`、`tests/contract/ui-repository-binding.test.js`、`tests/fixtures/workspace-forms-browser.mjs`（仅C场景，carrier owner串行）、本计划`docs/exec-plan/active/2026-10-30-ui-settings-tasks.md`（完成移同名completed）、`docs/README.md`（整合owner串行）。无需修改ui-model/index/apps；不修改shell滚动规则或新增第二scroller。公开文档中文/相对路径；运行截图日志留.superpowers/，不发布访问URL或身份。

## Plan of Work

### Batch U0 · 依赖合同、视觉目标与RED

在检出feature/ui-settings-tasks的根运行`git rev-parse --git-dir --git-common-dir`、`git status --short --branch`、`git worktree list --porcelain`、`git check-ignore -v .worktrees/`及`pnpm install --frozen-lockfile`（lock不变）。回读shell branch/head、其Plan进度与合同。shell未稳定时只做新组件与专项测试准备，不并发改Gate/共享fixture；不在尚缺合同的检出记完整GREEN。

取当前真实settings截图并画一张相同1024×短高、light/dark的具体目标（rail+bounded task），在本计划记录层级/密度取舍。先写语义RED：点击真实类别显示真实任务heading/主动作；confirmed先摘要再显式edit；切换零命令；草稿和held未知响应保留。运行`pnpm test:file tests/contract/ui-workspace-settings.test.js tests/contract/ui-workspace-setup.test.js tests/contract/ui-planning-mapping.test.js tests/contract/ui-repository-binding.test.js`。新case须因目标缺陷RED，缺import不是有效RED。draft PR base为fix/ui-workspace-shell，Closes #485/Refs #482 #483，回读关联与draft。

### Batch U1 · 分类组合与GREEN

主文件为workspace-settings与局部form样式。把既有表单作为固定四任务slots组合；无workspace创建保持原路径。初始默认Planning，confirmed摘要+显式edit；每个任务都含真实prerequisite/state/action。所有inactive任务hidden而不卸载；避免category change触发mapping.refresh。shell稳定后，由指定组合owner一次性把Gate接入新组件，保持外层header/body/lifetime合同。

运行U0命令，期望新旧GREEN、零skip；再运行`pnpm typecheck`、`pnpm boundaries`、`pnpm test:file tests/contract/ui-work-item-app.test.js tests/contract/ui-workspace-shell.test.js tests/integration/harness-plugin-workspace-setup.test.js tests/integration/harness-plugin-repository-binding.test.js`。既有shell专项测试不得删弱。若确认摘要/异步状态导致误隐藏恢复，先补对应RED再最小修复。回滚只撤C的分类/样式/局部markup，回到shell已通过状态。

### Batch U2 · DOM矩阵、负对照与安装

运行`node tests/fixtures/workspace-forms-browser.mjs`与`node tests/fixtures/execution-drawer-browser.mjs`（分别启动），用实际浏览器操作产品设置/返回/分类控件。沿用shell的bounded carrier与生产apply，不造新的浏览器carrier。forms真实source受控port用于held account/bind/baseline、unknown/conflict/error/retry；生产carrier与安装候选用于真实布局/装配证据，不能互相替代。

隔离probe依次禁用分类按钮、使heading不随任务、confirmed自动connect、改成条件卸载、删unknown恢复；具名case须RED，还原GREEN。无害class/wrapper不应失败。记录精确变异和实际命中，不把计划当完成。

最终干净提交运行`node apps/harness-plugin/scripts/bundle-report.mjs --source-root . --out .superpowers/ui-tasks-bundle`，用相同工具链干净shell base重算delta；执行`pnpm --filter @harness-projects/app-harness-plugin pack:plugin`、`shasum -a 256 apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.1.0-demo.1.tgz`、`pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-demo-artifact.test.js`，期望0，记录source/artifact/inputs/externals/raw+gzip。无新依赖不能代替delta。

按`docs/product/demo-install.md`逐条执行artifact-only、隔离DSH_HOME/Documents overlay、固定@deepseek-ai/dsh@0.2.0-rc.2 Web安装。记录实际Host/layout版本和artifact hash，在同尺寸/theme比较baseline/目标/安装截图，由人判断hierarchy/density/action clarity；Desktop rc5另记观察。#449保留精确候选人类接受；无真实Provider凭据的受控source矩阵不可称真实Provider验收。

当前base检查为`node scripts/rule-checks.mjs disclosure fix/ui-workspace-shell`、`node scripts/rule-checks.mjs size fix/ui-workspace-shell`、`git diff --check fix/ui-workspace-shell...HEAD`；核对base为实际PR基底，人工更严799/1299与公开面五类目。整合owner补验B+A+C组合，不把B未合并当C失败，也不夹带B实现。

最终push后运行`gh pr view -R SingularityKChen/harness-projects feature/ui-settings-tasks --json headRefOid,baseRefName,isDraft,closingIssuesReferences,reviewDecision,statusCheckRollup`、`gh pr checks -R SingularityKChen/harness-projects feature/ui-settings-tasks`并读全部threads。人类merge A后才按git-expert-operations先backup再同步/retarget main，重算diff、范围、focused/组合证据与当前head checks；不得自动合并A/C。必需PR Fast Gate和当前验证通过才ready，所有未验/失败明确保留。

## Validation and Acceptance

| 验收 | 判定证据 |
|---|---|
| 聚焦真实任务 | 窄短高初始viewport可辨当前select任务、return、workspace context开头；完整identity可垂直读，不截断。宽面板任务heading/primary清楚；四类均真实设置或prerequisite，无死按钮 |
| 确认与编辑 | first-time创建/连接清楚；confirmed重访先摘要，显式edit；pending/unknown/error恢复可见，不隐式写/重连 |
| 生命周期 | project空draft、mapping IDs/options、repo输入与held bind跨分类+leave/reopen保留；同scope/key，零额外命令，无晚响应抢焦点 |
| 可达/视觉 | 1440/1024/375/320、short-height、200%text、light/dark；bounded reading width，labels/help/actions可达，无page横溢出；真实安装截图人审 |
| 键盘 | 原生button+aria-current有清晰任务名；焦点可预测，native controls/dialog优先，hidden内容不可tab |
| 回归/负对照 | source/retry/safe error及shell suite全GREEN；真实navigation/confirmation/lifetime mutants RED→还原GREEN |
| 当前交付 | shell合同SHA、C head/base、tarball/Host identity、same-builddelta、当前CI、安装/人类接受边界分别记录 |

## Progress

- [x] (2026-10-30 +08) 独立综合完成；确认真实依赖shell合同，修订为A→C堆叠。
- [x] (2026-10-30 +08) U0：隔离、frozen install（lock无变化）、draft与具体视觉目标完成。初始四文件51例为49个既有GREEN/2个新Gate outcome RED（缺分类导航、缺显式编辑，无missing-import错误），后续实现修复。shell同步通过恢复锚点/range-diff保留C提交；当前依赖基底为A最终`dee917b`（产品与`b5eb1bc`等价）。
- [x] (2026-10-30 +08) U1：基于shell`294e8ae`完成固定任务接入、confirmed摘要与显式编辑、scope隔离和真实prerequisite。五文件focused共66例全GREEN/零skip；typecheck、boundaries 9例、额外app/Host集成18例全GREEN。state文案专项先RED（缺映射确认/仓库idle文案）再GREEN；已应用映射确认不会盖过未应用草稿。
- [x] (2026-10-30 +08) U2：独立功能与导航复评、真实 source/DOM/负对照、最终组合完整 verify 2732+7，以及官方 rc2/rc5 安装验收完成。最终提交整理和公开面检查由整合者执行；最终 push 后仍须回读当前 head/base/checks/双向关联/threads，必需门禁通过才 ready。A 仍未合并，C 保持真实堆叠，不从本条推断 hosted CI 或人类接受。

- [x] (2026-10-30 +08) P2复核修复：真实source专项先3例RED、DOM明确执行alert=0且仍enable/映射pending及失败仍claim-confirmed；修复共享setup恢复出口与pending/error确认条件后，69例focused、18例回归、9例边界、typecheck全GREEN。connect/install的unknown/failed/conflict及普通read失败/执行ack后read失败共32个跨任务出口检查GREEN；unknown恢复只读、ack后只读、提交聚焦与hidden晚响应不抢焦点、pending返回重入intent相同均通过。最终confirmed入口和16格几何重跑GREEN；6个有效source mutant RED、无害class 24例GREEN。

- [x] (2026-10-30 +08) 窄短高视觉修复（单独C）：具名DOM RED确认正文0时选中仓库位于y541–618，另两条新contract RED。原生chooser/leading/显式局部重定位后71 focused、18回归、9边界、typecheck GREEN；320/375×420×light/dark×四任务（200%）16格首屏物理检查GREEN，零业务命令、表单DOM身份保留；289行真实列表滚至42070后entry=0，阅读位置160经read/theme/resize仍160。真实union`0e60b968`（A最终+B7c+C视觉b8e4f74）追加16格首屏物理检查GREEN：状态区210px/50%，匹配来源时间且三源pending，chooser350.766–419.766、return251.266–328.266；bodyTop0/rootTop74/statusBodyTop0/documentTop0。289行列表末端42155后显式重入保留任务/草稿/DOM与三条原intent；四个末primary可达。完整安装与后续B标签微调候选仍由整合owner核验。

## Surprises & Discoveries

主分支缺外壳滚动与可逆设置生命周期；即使分类单独可渲染，完整#485不能独立验收。两份设计初提main独立，综合已因实际验收依赖修订。hidden保留状态也保留effects，因此shell focus/refresh合同必须在本PR负例中继续验证。初始focused结果为49既有GREEN/2新增RED，新增失败明确是缺少任务导航与confirmed显式编辑；不是依赖/构建错误。独立组件分类保留identity专项GREEN仅证明私有组合，不证明尚未同步的shell合同。组件视觉目标采用10rem rail+46rem正文与原生CanvasText/Canvas主动作，light/dark均有清晰层级；目标使用静态slot内容，不是实际安装或Provider验收。运行证据保存在`.superpowers/sdd/2026-10-30-ui-settings-tasks/`的`red.log`、`component.log`、`target-light-1024x600.png`与`target-dark-1024x600.png`。有效负对照为禁用分类、固定heading、条件卸载、confirmed重访自动connect、删除unknown恢复，分别命中分类/identity、confirmed零命令或unknown具名case；无害class仍7例GREEN。首次子进程pnpm调用因工具链runtime状态检查失败，不计mutation结果；后以同一Node直接运行真实contract得到有效RED/GREEN。运行态日志为`focused.log`、`regression.log`、`boundaries.log`、`browser.log`、`held-lifecycle.log`、`geometry.log`与`mutants.json`。16格初次严格末边界失败仅0.735px，复核精确rect及最大scrollTop后采用1px整数滚动度量容差，不改产品布局。依赖shell的carrier confirmed读数引用不稳定已由shell修复并同步为`b5eb1bc`；重启后真实列表入口验证通过。最终复跑日志为`final-focused.log`、`final-typecheck.log`、`final-boundaries.log`、`final-regression.log`、`final-confirmed.log`、`final-held-lifecycle.log`和`final-geometry.log`；`dom-conditional-mutant.log`明确RED（丢仓库草稿），`dom-conditional-restored.log`同操作GREEN。浅深色实际受控carrier截图与源候选一致；它们仍不能替代真实Host安装/Provider接受。候选安装和CI由整合owner另验。

独立评审在首轮66例GREEN后发现执行error被hidden规划panel藏住、缓存mapping确认忽略当次读取失败；这是两个未覆盖的组合，不把旧GREEN当完整验收。本批真实source+DOM RED/修复/GREEN证据为`p2-red.log`、`p2-dom-red.log`、`p2-dom-green.log`、`p2-error-matrix.log`、`p2-submission-focus.log`、`p2-pending-reopen.log`、`p2-restored-focused.log`、`p2-regression.log`、`p2-boundaries.log`、`p2-final-confirmed.log`与`p2-final-geometry.log`。`p2-mutants.json`记录禁类别、固定heading、条件卸载、自动重连、隐藏install恢复、复活stale-confirmed六项KILLED及无害class GREEN。

实际Host二轮视觉验收发现“可滚到动作”不足以证明首屏方向：320×420/200%的当前仓库/执行任务落在viewport之外，长workspace与四按钮占据首屏。受控carrier复现仓库top540.766/bottom617.766（正文top0）；见`visual2-dom-initial-red.log`。修复后320上chooser top214.766/bottom283.766、return115.266–192.266、context321.266起可见，完整context可继续垂直阅读。`visual2-orientation.log`与`visual2-long-entry.log`记录实际物理与289行列表末端重入证据；隐藏fixture controls时显式固定app在grid第二行，避免空toolbar移除导致测试slot塌缩。

只读真实union`0e60b968`使用生产`bindWorkspaceStatusApp`和同一受控ports（仅内存入口装配，不修改集成树），`facts=complete`使binding/source匹配且lastUpdated/reconciled时间均来自固定fixture事实。状态区client209/scroll699、max50%为210；同时execution/mapping/repository-account三条pending事实存在。`visual2-union.log`的16格均在任何滚至primary之前记录首屏，三条intent不变，Host/document和B正文不滚。`visual2-union-primary.log`另证四个primary经同一body可达；`visual2-orientation.log`、`visual2-wide.log`分别覆盖单独C窄16格、宽16格。去掉chooser选择或显式entry重定位分别命中新用例RED，无害class仍10例GREEN；恢复后focused71例GREEN。测试调度器以提交后effect判定scroll，避免把即时handler时机误写成产品合同。

实际rc5安装再次发现有效plugin264/正文232/client227/文字32px组合下，同行label占64px加8px gap后select仅155px，四字末端裁切。先前viewport320和html根字号放大并未覆盖这一Host有效宽度/仅文字放大的组合，因此不能用旧方向GREEN替代字符完整接受。按Host相同16px rem、逐元素200%文字与5px gutter复现RED：select155、文本121.38、保守native文本空间113。仅两条CSS（compact flex-wrap、select 6em basis）后select227/文本空间185；24格264/320/375×themes×四任务在32px下当前文字、返回、末动作可达均GREEN，71focused与typecheck GREEN。真实union`00149d74`（已含B最终标签与两CSS产品）进一步通过24格264/320/375×themes×四任务的匹配32px测量；50%状态区210px、匹配来源时间与三pending同时存在。A正文仅48px，58px chooser矩形362.156–420.156、实际可视交集371.953–419.953（48px），上边框约10px被极短高body裁掉；32px当前文字完整、返回293.953–359.953完整。该边界已获整合owner明确接受：可读类别+48px可见命中区，非完整外框；不改A/B合同。

字符修复运行证据为`visual3-matched-red.log`（264/body232/client227/32px/select155）与`visual3-matched-green.log`（select227），截图同名`visual3-matched-*`。仅将flex-wrap改回nowrap的独立source负控再次RED，见`visual3-nowrap-mutant.log`。`visual3-physical-matrix.log`与`visual3-union.log`分别记录C/真实union各24格；union readonly生产binder源身份在`visual3-union-identity.json`，集成树未写。C复跑71focused/typecheck；没有以旧union的全域通过代替此CSS/安装验收。新C/union产物和实际重装接受由整合owner另记。

## Decision Log

2026-10-30 +08 / 综合评审：选普通button分类+固定hidden任务，避免半套tabs和表单卸载；confirmed显示摘要并显式edit，不改变source确认。C基于A的实际semantics合同堆叠，B保持独立，不建立native blocked-by写入。用户已委托此设计/独立审定流程，无需批间重复设计批准；人类合并与#449接受仍由原owner裁决。

2026-10-30 +08 / P2修复：选任务面板外单一setup-error出口而非复制每个任务的error；提交DOM owner与当前焦点/hidden共同约束聚焦，failure只用于已有失败恢复语义，不推断当前任务。unknown/refresh先读，执行false缓存只说“尚无已确认的执行绑定”；映射确认文案在当次pending/error时保守抑制。原source/DTO/intent/权限不变。

2026-10-30 +08 / 安装视觉修订：窄容器选compact native任务chooser，否决横滚按钮和四按钮堆叠；宽rail保持。保留单一任务owner与稳定五slot（context+四任务）；仅显式导航重定位既有body/root，背景无重置。该决定替代首轮窄四按钮意图；A滚动owner/返回语义保持。

2026-10-30 +08 / 字符裁切修复：以两条局部CSS实现不足宽度时label/select分行，否决缩字号、ellipsis、改变A/B合同；select basis以自身字体em适应文字放大，wide rail保持。先交可复评产品候选，再按实际组合几何判断极短高可视范围。

## Idempotence and Recovery

分类/返回纯local且可重复。scope换代清晰隔离，已接纳外部操作不回滚。probe只撤自己的mutation。C回退恢复shell的四表单组合，不撤A的scroll/navigation/lifetime，也不删数据库/仓库/intent。shell变动时先校验合同；失败不继续叠加视觉代码。stack同步/retarget先恢复锚点、精确lease、range/diff检查，禁止把A的提交计成C自己的闭环或遗漏真实差异。

## Interfaces and Dependencies

Node≥22、pnpm10.28.2、React18、现有esbuild/浏览器/固定Host；私有WorkspaceSettings只接既有React表单内容与当前安全scope/context，不建通用公共settings API。不引Provider/Host业务调用。A是本PR真实代码语义依赖；B的status绑定可独立组合。source intent与权限/ack仍归现有Host/client；#155完整policy/unbind、#457权限机制不在此处实现。

## Outcomes & Retrospective

四个固定任务、确认摘要/显式编辑、前置条件、同 scope 草稿与未决操作已实现。独立完整审查发现的两个 P2（执行恢复出口随 Planning 面板隐藏、缓存映射确认盖过 pending/error）均经真实 RED/GREEN 和独立复评解决；之后的首屏导航与实际 Host 四字裁切也分别通过独立小差异复评。没有新增 Provider、DTO、store、router、依赖或迁移。

在 `feature/ui-settings-tasks` 检出根，最终产品 `392b0f6` 的 71 个聚焦契约和 typecheck 通过；此前同一行为树的 18 个 App/Host 回归、9 个边界检查以及 32 个跨任务错误/恢复 DOM 用例通过。unknown/执行 ack 后读回失败只重新读取，不盲目重发；hidden 晚响应不抢焦点。源语义未因最后两条 CSS 变化重新裁决。正常宽屏 rail、窄宽 264/320/375×420、两主题、32px 控件文字的四任务共 24 格，完整选项文字、真实入口、返回和主动作可达均通过；取消换行的具名负控重现不足文本预算，还原 GREEN。

受控真实 source 的组合 A+B+C@00149d74 包含匹配来源时间、长工作区名和三 pending。进入/重入只改变既有 body/root 滚动位置，类别、表单 DOM、草稿和 intent 保留；后台读取/主题不重置阅读位置，尺寸变化仅自然重排。独立复评与作者都记录了极短高的真实裁剪交集：A 原有正文回退为 48px，原生选择器外框为 58px，顶部边框/留白约 9.8px 被局部裁剪；四字 glyph 完整，可见连续命中区 48px≥44px，返回按钮完整。此处验收是可读类别和可操作区域，不声称完整外框可见，也不为此扩大 A/B 的高度合同。

整合者在 `.worktrees/ui-482-integration` 的 00149d74 完整执行 pnpm verify：2732 项和 MVP-0 7 项，零失败/跳过；此前独立包边界 9 项通过。相同 Node26.12.1/pnpm10.28.2/esbuild0.28.2 的干净 C 来源 889f539（产品等于392b0f6）相对 A@dee917b：Host bytes/hash 不变，client +7869 raw/+1668 gzip bytes，无新依赖/externals；tgz 175026 bytes，SHA-256 `bc5565facd663f22d2f917be9950345058cd4f069b104a6f296e902abb7cedfb`。在 main 检出根运行 bundle-report，source-root 为 `.worktrees/ui-settings-tasks`、out 为 `.superpowers/ui-482-485/tasks-r3`、base-report 为 `.superpowers/ui-482-485/shell-final/report.json`；最终整理的干净 head 仍须重建确认相同字节。

最终组合 00149d74 的 tgz 177974 bytes，SHA-256 `da5a8e0e1fd6ed0da067b2d4f04de50cb39b3863c7e1ff80ef7c5ffe3ad25797`，在官方隔离 Web 0.2.0-rc.2/0.2.1-rc.5 安装且逐文件核对；整合者另直接核对两版已安装 Host/client hash 与报告一致。两版共 80 个任务/尺寸/主题/文字组合、真实 289 项列表 12 个滚动用例通过。末端进入/重入保留仓库任务、草稿和 identity；Tab 到仓库本地路径。状态区滚轮 0→404 不动正文，正文滚轮不动摘要，B wrapper/document 均0、仅原有 root 局部回退11；表格横滚1023，rc5/rc2 原生详情分别到3141/4377且列表外层不动，Escape 返回。实际读取不完整可通过原重试恢复，不能将该失败态称已确认。

原生 Tab/焦点、选项可访问名称和实际选中状态已观察；方向键弹窗选值的自动化没有证明通过。同一浏览器的无 Host/React 空白参考页也出现可信且未阻止的键盘事件却不提交选项，故记录工具边界，不据此认定 Host/产品故障；屏幕阅读器语音、完整原生菜单和精确桌面候选的人类 UAT 仍由 #449/R1 接受。自动化 Web 安装不替代这些裁决。

产品约定更新 `docs/product/ui-forms.md`。PR #488 只关闭 #485，base 为 #486 的 `fix/ui-workspace-shell`；#487 独立。最终公开面扫描、799/1299 硬上限、文档链接、单提交树等价与远端当前 head/base/checks/threads/双向关联须在整理后确认。Project 仅机械回填 ExecPlan/Batch，Status 与 native 规划依赖不变。无计划内新技术债。

## Bottom Change Note

2026-10-30 +08：综合两份独立方案并核对失败路径；把表面并行改为基于真实外壳合同的堆叠，收敛固定四任务、显式编辑、验证和恢复。

2026-10-30 +08：记录U0有效RED、独立固定hidden组件/有限GREEN与1024短高浅深色具体目标；共享Gate/fixture未改，等待稳定shell同步后续接入。

2026-10-30 +08：记录shell294合同上的U1实现、66例focused/9例边界/18例集成、受控DOM生命周期与16格几何、真实负对照；暂停接收shell carrier修复，保留安装与最终head证据边界。

2026-10-30 +08：同步shell b5eb1bc后重验真实confirmed入口/显式编辑/返回回焦与最终16格矩阵；补真实DOM条件卸载RED→恢复GREEN，记录最终源候选6089fdb，保留整合/安装/CI边界。

2026-10-30 +08：按独立评审两项P2补真实source+DOM RED并最小修复；记录69/18/9、四任务错误/恢复矩阵、提交/隐藏焦点、intent保留和最终截图，保留独立定向复评/安装/CI边界。

2026-10-30 +08：按真实安装首屏方向失败增加窄原生任务chooser、leading顺序和仅显式entry局部重定位；记录单独C最窄GREEN，等待真实union状态50%组合测量。

2026-10-30 +08：追加真实union0e60b968的50%状态/匹配时间/三pending首屏物理测量与289行末端重入、primary可达；记录宽窄正例与两个新负对照，未把后续B标签候选或安装接受提前写成通过。

2026-10-30 +08：按真实rc5四字裁切补匹配有效264宽/32px RED与两CSS GREEN，记录24格窄宽文字完整和当前71/typecheck证据；保留50%组合与重装接受为下一门。

2026-10-30 +08：在真实union00149d74只读复验有效264宽/32px、50%状态与三pending组合，记录48px可视交集与完整字形/返回、24格和nowrap负控；保持两CSS产品范围，留新产物重装与独立小diff复评给整合owner。

2026-10-30 +08：归档工程与两版真实 Web 安装结果；明确实际宽度裁切修复、48px 可见命中区取舍、原生菜单工具边界与当前远端门禁。
