# MMP 工作区与连接表单 ExecPlan

> 状态：Completed（工程实现及本轮独立复评）；2026-10-30 已结算安装件语义断言后的精确组合验证；最终发布版本的远端门禁仍须按下述回读命令执行。人类产品接受不在本状态中。
> 创建：2026-10-29；Issue：#447；Batch：setup-forms。
> 分支：`feature/mmp-ui-forms`；计划遵守根 `PLANS.md`。

## Purpose / Big Picture

用户创建工作区、连接规划项目、绑定仓库和映射字段时，看到同一套清楚的字段、帮助、动作和状态；失败可恢复且草稿不丢。
用户能分辨“配置已记录”“来源尚未确认”“结果未知”和“已经激活”，不能把本地意图误认成外部平台已保存。
最小证据是三份真实组件消费当前 client source 的浏览器成功/失败/待处理流程，结合已有 Host command 集成；实际安装 Host 验收单列。

## Context and Orientation

`packages/ui/src/workspace-setup.ts` 的 WorkspaceSetupGate 只持名称、project ID和list/settings导航草稿；确认和identity来自Host。
`repository-binding.ts` 只持仓库选择草稿；离开表单调用现有 `cancelAttempt()`，它不解绑已经确认的配置。
`planning-mapping.ts` 只持mapping意图，当前client source负责scope、未知结果重读、同一意图键、ack与确认读回。
`packages/ui-model/src/workspace-setup.ts` 和 `repository-binding.ts` 已提供安全notice/recovery；结构化错误分类由#434负责，本闭环不得解析原始异常或猜测权限。
#446提供 `workspace-presentation.ts` 的私有共享CSS；本任务消费同一视觉参数，native prerequisite #446保持。
当前setup/仓库/映射契约包含single-flight、scope更换、unmount/dispose、unknown重试键和Host确认反例；本轮必须保留，不能用UI假成功替换。

## Design / Spec

选择现有导航内的三段连接设置：规划连接（含映射）、执行、仓库；使用section标题、fieldset/legend或清楚分组，不增加wizard路由、嵌套装饰卡片或确认store。
WorkspaceSetupGate根采用 `.hp-workspace` 并注入 #446 的 `WORKSPACE_STYLES`；列表/设置切换、root ref和页面更换焦点保持。
新增私有 `form-presentation.ts` 只导出 `FORM_STYLES: string` 与 `focusFormError(root:DOMElement|null):void`。后者只聚焦当前form的可聚焦错误摘要，不持状态、不提交、不读source。
`.hp-form`、`.hp-field`、`.hp-form-actions`、`.hp-form-notice` 是本闭环专有类；共享按钮用 `.hp-action`/`.hp-action-primary`，颜色/间距/focus消费 #446的 `--hp-*`。
所有三个现有表单真实消费这些规则；不创建未消费的字段组件或公开包出口。原生input/select保持host字体，控件边界和focus可辨，主要动作最低44px。
字段顺序：工作区名称或Project node ID；仓库localPath、owner、name；映射status、iteration、targetDate及原生状态选项。每个控件有显式label、稳定唯一id和简短帮助，通过aria-describedby关联帮助/错误。
动态映射id使用React生成的安全本地id，不把受保护内容或raw provider错误编码进DOM属性。可见字段/option的ID保留以区分同名对象和已删除定义，不因美观隐藏来源身份。
Project ID帮助说明其来自项目设置，不在UI猜ID；path输入可在控件内水平编辑，帮助/错误长路径可换行，不能撑宽页面。
语义提示使用完整文字和小标题，错误不只靠红色。正常文字至少4.5:1，控件与focus边界至少3:1；两主题都实测，缺乏合法反色token时采用强调描边。
320 CSS px及200%/400%等效缩放时字段/动作纵向排列；不截断帮助、错误或recovery。无新增动画。

pending使用当前source pending值、`aria-busy`和进行中文案，禁用重复提交；source的single-flight和意图键逻辑保持唯一权威。
confirmed/active只消费Host/source已确认结果；configured说明“配置已记录，尚未确认激活”；local_only为“本地已保存，来源尚未确认”；unknown为“结果未知，请重新读取/确认”；failed保留草稿并使用现有recovery动作。
不能从本地submit完成、disabled按钮或视觉状态推导“Saved”。已激活执行/仓库只显示有效状态，不附重启指令；当前source对未激活配置的安全恢复指示保持其真实含义。
原生required/invalid提交由浏览器聚焦第一个无效控件；异步失败仅在该form刚提交的attempt结束后聚焦其错误摘要 `tabIndex=-1`，未知结果以行动导向提示呈现。
用form局部ref记录“本次提交需要错误焦点”，成功/失败后清除；repository 的 `configured` 是 baseline 前的中间读数，提交归属必须跟随这次 `bind()` Promise 完成，不以该业务状态提前结束；后台snapshot刷新、初次read和其他form状态变化仅宣告，不无条件抢焦点。不得按原始错误文本推断具体字段。
失败摘要说明哪一步失败、已保留什么和可执行下一步；aria-describedby连到实际错误。恢复行为严格服从source的retry/refresh/reapply，不为文案改command顺序。
不新增凭据输入或secret handle展示；当前三个表单不需要显示句柄。若已有脱敏状态提及凭据，仅“由宿主管理”，不把句柄或token放入value、title、aria属性、日志或测试截图。

拒绝重写client source、乐观success toast、前端权限缓存和向Provider直连。React官方避免重复状态原则在这里落实为“只保留草稿与导航”。
拒绝通用表单框架/新依赖：当前三表单的原生标签、状态与焦点可由小型呈现模块完成，额外状态框架会扩大失败面。
WAI Forms Notifications官方指导已核对：内联和总体反馈清楚简短、错误说明可行动、帮助用户定位和恢复；不把live status等同于已确认事实。

## Global Constraints

每PR代码/测试/配置/fixture additions+deletions严格 `<800`，文档 `<1300`；预计代码600–750、文档180–350。完整fixture和删除旧markup均计入，不以净行数或删反例挤预算。
唯一产品写集：`packages/ui/src/workspace-setup.ts`、`repository-binding.ts`、`planning-mapping.ts`、新增 `form-presentation.ts`。
测试写集：`tests/contract/ui-workspace-setup.test.js`、`ui-repository-binding.test.js`、`ui-planning-mapping.test.js`、`tests/integration/harness-plugin-artifact.test.js`；新增窄职责 `tests/fixtures/workspace-forms-browser.mjs`。
文档写集：本计划迁入 `docs/exec-plan/completed/2026-10-29-mmp-ui-forms.md`；另含 `docs/product/ui-forms.md`、`docs/review/pr-463-mmp-review.md`；索引由整合owner串行维护。
不改 app/list/project/detail/shared foundation、client/ui-model/Host/Provider、build、依赖/lockfile、数据库或当前source合同；不改Status/native dependency。
无兼容双轨、旧实验数据库迁移、隐藏字段或第二业务authority；当前真实ABI、安全、scope和Provider确认边界保持。

## Plan of Work

Batch S0 提交本计划，在代码前建立关联#447的draft PR。把闭环、计划+Batch、`Closes #447`、验证、风险与回滚写入 `.superpowers/ui-delivery-20261029/forms-pr.md`。
执行 `gh pr create -R SingularityKChen/harness-projects --draft --base main --head feature/mmp-ui-forms --title 'feat(ui): unify workspace connection forms' --body-file .superpowers/ui-delivery-20261029/forms-pr.md`；已有PR则不重复创建。
回读 `gh pr view -R SingularityKChen/harness-projects feature/mmp-ui-forms --json headRefOid,baseRefName,isDraft,closingIssuesReferences`，期望draft=true、关联#447。
#446共享基础提交可用后按受控Git流程纳入该基础，PR base改为 `feature/mmp-ui-frame`；与detail并行，不依赖detail文件或PR。

Batch S1 先补有判别力的呈现断言：label/help/error关联、44px主动作、pending/unknown/configured与confirmed区别、后台更新不抢焦点；旧实现目标应在实际DOM中失败。
新增表单CSS/错误焦点helper，逐段改三个组件并删除被替换的重复布局；保留原source实例、hook订阅、submit/reset/cancel顺序和draft生存期。
运行 `pnpm test:file tests/contract/ui-workspace-setup.test.js tests/contract/ui-repository-binding.test.js tests/contract/ui-planning-mapping.test.js`，期望全部pass、零skip。
保留仓库unknown复用key/failed新attempt、mapping unknown先重读同key/definitive failure新key、离开表单后迟到account不能续写的旧反例。
运行 `pnpm test:file tests/integration/harness-plugin-workspace-setup.test.js tests/integration/harness-plugin-repository-binding.test.js tests/integration/harness-plugin-host-planning-mapping.test.js tests/integration/workspace-setup-commands.test.js`；期望当前Host命令与确认回读全部pass。
回滚点是S0；S1整体撤回只恢复呈现，不解绑/清配置。

Batch S2 建立可服务的窄表单fixture，渲染生产WorkspaceSetupGate/RepositoryBindingForm/PlanningMappingForm并使用真实create*Source，受控port仅提供确定性结果/Promise屏障。
fixture不是Host authority或完整产品carrier；Host/Core/remote行为证据继续来自原有集成。#450/#451的统一生产browser carrier和CI lane仍独立，不为本PR另造第二发布验收authority。
由整合owner实际浏览器打开 `node tests/fixtures/workspace-forms-browser.mjs` 的本地URL，走create→connect→mapping→repository；不新增浏览器依赖。
每form至少验证一次required无效提交、一次deferred pending→failed→retry、草稿保持、Tab顺序、错误摘要焦点、后台刷新不抢焦点；两主题、长path、同名不同ID和已删除option、320 CSS px与缩放都检查。
secret/raw-error canary不能出现在text/属性/日志；unknown/local_only不能出现已确认成功文字；repository pending时离开，再释放account结果，不能续发bind或清成功配置。
临时移除一处label关联及主动作高度规则，浏览器accessible-name/44px判据必须失败；临时将local_only呈现为confirmed，现有状态断言必须失败。恢复后复跑green，mutant不得提交。

Batch S3 在本分支根运行 `pnpm typecheck`、`pnpm boundaries`，clean最终提交后运行 `node apps/harness-plugin/scripts/bundle-report.mjs --source-root . --out .superpowers/ui-forms-bundle` 和 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`。
与精确PR base的同工具链clean报告比较Host/client raw+gzip、pack bytes/hash、inputs/externals与React；如另记对main累计量，清楚区分，不把foundation增量重复算成本PR。
修复独立评审 F1/F2：增加 deferred baseline rejection RED；让 repository 局部提交归属持有 bind Promise，cleanup 使旧提交失效；保留 gate frame 作用域，仅用 gate 专属 CSS 将直接嵌套列表 frame padding 归零。确认列表的标题/设置动作必须仍在 token/focus 作用域内，实际浏览器再检查两层的有效 padding。
执行 `node scripts/rule-checks.mjs disclosure feature/mmp-ui-frame`、`node scripts/rule-checks.mjs size feature/mmp-ui-frame`、`git diff --check feature/mmp-ui-frame...HEAD`，期望无敏感/空白问题且符合更严预算。
独立对抗性评审核对状态/焦点/取消/确认边界、全部issue验收和P0–P3；最终push后回读head/base/checks/关联/threads，当前证据满足才ready，不自行merge。

最终整合回归发现安装件测试仍按完整起始标签字符串判断根元素。仅将该断言改为根 section + 精确 aria-label 的语义断言，保留工作项 href 和隐藏 SVG 检查；运行 `pnpm test:file tests/integration/harness-plugin-artifact.test.js` 期望25项通过，并用仓库 `review-mutate.mjs` 分别移除/写错根标签，期望该同名用例明确KILLED，恢复后基线绿。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 同一设计语言 | 三个真实表单消费共享frame/token与form规则；两主题、窄宽和长路径截图 |
| 字段与动作可达 | 显式label、help/error关联、自然Tab、native invalid与异步error焦点、44px主动作；负控失败再恢复 |
| 安全状态可区分 | pending/configured/local_only/unknown/failed/active矩阵，未确认无Saved；只有当前source回读可称成功 |
| 恢复与草稿 | retry/refresh按source；unknown同key、失败新attempt；reset/unmount迟到结果不续写、不解绑 |
| 不抢焦点或泄露 | 后台快照不抢focus；secret/raw-error canary不在DOM/属性/日志；映射identity不被美化隐藏 |
| Host与包证据 | 原Host集成pass；精确base/head同构建report/pack；最终tarball真实Host中主题、表单、focus和恢复检查 |
| 可评审交付 | <800 code、<1300 docs；公开面、独立评审与最终head checks/关联/线程回读 |

组件fixture的受控port结果不代表真实Provider已确认；安装Host UAT #449、人类产品接受、#457权限P0和R1继续单独判定。

## Progress

- [x] (2026-10-29 +08) 核对三表单、真实client source契约、既有Host集成和两份独立方案，固定状态/焦点边界。
- [x] (2026-10-29 +08) S0：计划提交后建立 draft PR #463；回读 base=main、draft=true、head=计划提交，closing issue #447 已关联；实现前纳入已稳定共享基础 `227eed7`；最终 base/head 由整合 owner 在发布前重新锁定。
- [x] (2026-10-29 +08) S1：首轮 43 项中 4 个新增目标 RED；未知状态两项 RED；双层 frame 反例 RED。评审修复后聚焦组件 49 项、Host 集成 54 项通过，typecheck 与 boundaries 9 项通过。
- [x] (2026-10-29 +08) S2：实际三表单、创建失败重试、mapping unknown、仓库post-ack baseline失败焦点与单层有效padding均经真实DOM检查；标签/44px负控1→0→1、44→17→44恢复。官方固定Host已实际安装呈现，最终产物另核。
- [x] (2026-10-29 +08) S3：五项归因变异KILLED、独立复评通过，最终clean报告和远端当前head回读按PR门禁执行后才ready。

- [x] (2026-10-29 +08) 安装件语义断言：在分支 `feature/mmp-ui-forms` 的归一化检出复现25项中1项RED，修复后25/25GREEN；根label缺失/错误两项定向变异KILLED，typecheck通过。
- [x] (2026-10-30 +08) 在 `test/mmp-ui-final@a9c277a` 检出对三 PR 精确产品/测试并集及本轮详情 P2 修复重新执行 `pnpm verify`：2567+7通过、零失败/跳过；本轮独立复评锁定 `6819a46`，49契约+79集成、安装件根标签两变异及原5变异精准KILLED。完整当前head CI运行40866640808成功；后续任何push按PR回读门重核。旧“待整合owner”结论由本条替代，不视为人类UAT或权限验收。

## Surprises & Discoveries

当前仓库active状态已有“仓库已连接”，未激活configured分支才含重启恢复提示；不能把所有重启字样机械删除后宣称改善真实激活语义。
现有mapping用ID区分同名字段和orphan option；设计不能隐藏这些身份，也不能因字段被删除悄悄改变已存mapping。
现有tests内hook/SSR驱动不等于真实DOM焦点/原生validation，实际浏览器应单独提供证据。
2026-10-29：mapping 三个字段及原生选项原本都可选择“不映射”，不存在 required 无效提交；保持原契约，不为测试制造必填业务规则。
2026-10-29：嵌套 WorkspaceSetupGate/WorkItemApp 会重复 frame padding。新增真实渲染反例先显示 2 层，再让 list 阶段只由 WorkItemApp 持共享 frame；settings/create 仍由 gate 持有。Superseded by Decision Log 的 F2 修复（2026-10-29）：该方案把兄弟设置入口移出共享作用域。

2026-10-29：最终组合检出的完整测试2567项中仅安装件旧断言失败：它要求输出以无其他属性的 `<section aria-label="Harness Projects">` 起始。F2保留共享frame后根合法增加class/data属性，真实Host呈现未因此失败；这是测试把完整markup序列当语义的耦合。窄复现25项中24通过/1失败，修复仅放宽属性顺序和呈现属性，不放宽根section或精确可访问名称。

## Decision Log

2026-10-29 / 独立规格审阅者：只新增表单CSS与无状态错误focus helper；草稿留组件，pending/ack/key/recovery留source，避免第二确认authority。
2026-10-29 / 独立规格审阅者：错误focus只回应当前form的用户提交，后台更新使用live说明；原因是避免异步其他form抢走键盘操作。
2026-10-29 / 独立规格审阅者：#447从#446基础扇出，不修改其共享模块或#430区域；native关系和规划Status保持。

2026-10-29 / 独立评审修复：F1 的 configured 不代表 bind Promise 已结束，改用局部 Promise 归属；baseline 拒绝时保留安全摘要焦点，后台提交和 cleanup 仍无抢焦点。新增 source-backed RED 后 GREEN，独立 probe 从 actualFocusCalls=0 变为 1。
2026-10-29 / 独立评审修复：F2 保留 gate 作为完整入口的 frame，使用 `.hp-workspace[data-workspace-setup] > .hp-workspace` 仅归零直接列表的额外 padding；整合 owner 已明确批准此呈现组合规则。撤销只数 class 的测试，改验入口作用域；实际 padding 由新增 list 夹具和浏览器核对，不声称 SSR 是浏览器测量。

2026-10-29 / 整合owner明确授权：测试写集扩展到安装件集成文件，只修改根section可访问名称断言；产品markup、Artifact item链接与aria-hidden SVG断言保持。恢复/错误的根标签仍必须由同一用例拒绝，不增加兼容分支。

2026-10-30 / 本轮主评审：按当前独立测试与复评事实结算原过期待办；用户在本会话直接授权无 P0/P1 时修复、复评、整理并 rebase 合并 #461–#463。不推进 Project Status，也不以本闭环关闭 #449/#457/R1。

## Idempotence and Recovery

focused测试/fixture/pack可重复；fixture Promise使用显式屏障，关闭自己启动的服务，不以计时sleep制造顺序。
临时mutant保存原文件并finally恢复，green复验后才提交；日志和截图仅放忽略的 `.superpowers/`。
整体revert恢复呈现；不清数据库、凭据、bindings或仓库。已推分支整理依backup ref和精确lease，由整合owner执行。

## Interfaces and Dependencies

保持WorkspaceSetupSource、RepositoryBindingSource、PlanningMappingSource与bindWorkspaceSetupApp所有业务签名不变；form模块只在UI内部import，不新增包public export。
消费#446 `WORKSPACE_STYLES`、`.hp-workspace`、`.hp-action`与明确的 `--hp-*`合同；框架与详情owner不编辑本闭环文件。
官方依据已核对：`https://www.w3.org/WAI/tutorials/forms/notifications/`、`https://react.dev/learn/choosing-the-state-structure`；必要的反馈和状态归属规则已完整写入本计划。
无新依赖和维护债。若实际源数据不足以表达某错误归因，保留安全form摘要并登记事实；不在UI猜权限层或削弱验收来强行关闭。

## Outcomes & Retrospective

实际完成三表单的共享呈现、标签/帮助/错误关联和用户提交后错误焦点，pending/ack/key/recovery仍由既有client source拥有。独立审查发现两P2：仓库configured中间态过早清焦点标记、列表设置动作脱离样式scope；均经RED/GREEN修复并独立复评。
最终49项contract+54项Host集成共103通过，typecheck及9项boundaries通过；五项仓库runner变异精准KILLED、恢复基线绿。原独立确认读失败探针从焦点0变1。
实际浏览器创建流程的required焦点、pending禁用、failed摘要焦点/草稿/重试通过；映射unknown明确要求确认且无Saved/canary。深色320px三表单的全部标签及44px控件可达，无页横滚，同名不同ID与deleted选项保持可见。
修复后实际DOM确认外层frame15px、直接嵌套app0px，设置动作44px且在scope内；仓库account→bind ack→待确认baseline→baseline失败后焦点落repository-error，路径草稿保留。
官方固定Host干净Web profile实际创建工作区、连接真实Project、进入映射/仓库设置并跟随明暗主题；不配置模型、不发送prompt、不修改外部Project字段。初轮07a7089产物只作为初轮观察，最终表单修复新产物另行核对后交付。
最终精确base/head包差异、public扫描和当前远端checks按本计划命令重算并通过后ready。人类完整UAT#449、权限P0#457与R1保持独立；没有新增技术债或兼容迁移。

## Bottom Change Note

2026-10-29：独立综合方案与现有source/tests，固定三表单呈现、用户提交触发的错误focus、确认/未知边界和真实扇出依赖。

2026-10-29：记录 S1 的 RED/GREEN、三项归因变异与可运行夹具；保持实际浏览器/安装 Host/测量和远端门禁为未完成，不将本地组件证据升级为发布接受。

2026-10-29：按完整独立评审修复 F1/F2；新增 deferred baseline 和入口作用域 RED/GREEN、五项归因变异、list/baseline 夹具；显式标记旧 frame 结论被推翻，保留真实浏览器与最终交付门禁。

2026-10-29：整合独立审查及实际浏览器/Host证据，归档实现闭环；最终远端门禁仍以当前head回读控制。

2026-10-29：修复最终整合唯一失败的安装件旧markup断言，记录25项RED/GREEN和两项语义标签变异；工程归档保持，明确当时最终整合/独立复评/远端门禁尚待新head验证（该待办已由 Progress 的 2026-10-30 条目结算；最终发布head仍需回读）。

2026-10-30：以本轮 fresh 精确组合验证和独立复评结算 P3 过期待办，更新完成说明及授权边界，保留人类UAT与运行时权限门。
