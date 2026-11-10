# 发布视觉参考确认 ExecPlan

> 状态：Completed；固定 v3 获人类批准，独立视觉、文档和发布验收通过；Ready 操作按当前远端门执行
> 创建：2026-11-10
> 范围：#603 的静态视觉参考、可比基准、工程交接与具名人审
> 规范：依据根 `PLANS.md` 维护本活文档；关联 #460、#413、#599

## Purpose / Big Picture

让人类能把当前工作台与具体新参考并排比较，并明确判断层次、密度、字体、控件和整体外观。完成的最小证据是公开可审阅的 `release-workspace-v3` 设计及handoff、真实身份说明和针对该版本的明确人类同意。设计接受只准入 #604/#605产品实现；#599继续拥有实际安装产品判定。

## Context and Orientation

本仓是Planning优先的交付工作台，Host拥有事实，UI只显示安全投影。当前 `packages/ui/src/work-item-project.ts` 组合List、Delivery和唯一detail；`work-item-list.ts`拥有局部query；`workspace-presentation.ts`、`form-presentation.ts`等提供现有样式。#603的上游产品方向已经认可；此前具体reference尚未接受的判断 Superseded by Decision Log（2026-11-10）：固定v3现已获具名同意。

本计划位于 `docs/exec-plan/completed/2026-11-10-release-visual-target.md`。工作检出是 `docs/release-visual-target`，工作树可移植路径为 `.worktrees/release-visual-target`。基线必须标记源、场景、主题、viewport与是否installed；生产组件合成数据只证明源呈现，不能改称已安装Host或完整Provider→Host链。

## Design / Spec

用户未接受v1整体参考；v2仅版式获“板式设计可以”，olive颜色被否决。v1的28px标题/69px短行/紫pill/大列井/游离能力栏均为历史候选，Superseded by 本计划Design / Spec与Global Constraints（2026-11-10）。v2早期56px表述 Superseded by 实际冻结58px短行（2026-11-10）；保留已接受v2的实际几何，v3只修颜色。初稿时完整v3具体版本/hash的人类同意仍缺失；此观察 Superseded by Decision Log（2026-11-10）的具名v3批准。仍不把设计接受扩大为安装验收或未执行的工程完成。

具名目标 `release-workspace-v3`：“v2布局保留，颜色修订”。正式参考入口 `docs/product/release-visual-target-v3/README.md`、handoff及版本manifest应自包含、相对链接可打开；旧v1资产/hash冻结保留的原约定 Superseded by Global Constraints与Idempotence and Recovery的历史指针／固定提交保留方案（2026-11-10）；最新树仅v3为完整参考，v1不再保留整套当前设计文档。六面List/Delivery/Board/Timeline/detail/settings共用相同7项场景、主题、viewport和可见列配置，source fixture/设计示例/真实composed/安装身份分别标记。v3首四帧几何／颜色独立审阅已准入全量传播；初稿认为完整矩阵的Delivery、Unknown与error图像仍需修复；此判断 Superseded by Progress的全矩阵修正后复审（2026-11-10）：定点修正已通过，35张主图及两份只读元数据冻结，具名对象以manifest SHA为准。

冻结normal1440示例在44pxHost顶条下：工作区抬头y56–112、查询y120–164、事实摘要y168–188、首表头y196/44px；真实Host按内容矩形解释，不改Host追坐标，异常/长字/200%自然增高。标题22/30、600，任务14/22、500，正文14/22、400，必要源号12/18、400；实际短行58px、长行自然增高。常规动作ghost/44px命中互不重叠，6px控件圆角。透明Board列、卡padding12/gap12自然高度；选中与focus形态独立。detail同7项背景及安全矩形observer；settings沿真实四任务导航160px+32px沟槽、max720px内容和44rem容器chooser，禁止新能力旁栏。

v3仅消费Host CSS角色，不import theme JS、不注册/覆盖root主题、不加明暗检测或主题store。静态公开包默认色仅作图像身份，不把hex写进生产：canvas=`--dsw-alias-bg-base`（Light #FFFFFF / Dark #151517），surface=`--dsw-alias-bg-layer-1`（#FFFFFF/#232324），hover=`--dsw-alias-interactive-bg-hover-solid`，正文=`label-primary`（#0F1115/#F9FAFB），必要次字=`label-secondary`（#61666B/#CFD3D6），内容/卡边=`border-l2/l4`。selected=`bg-multi-select`（#F5F6F7/#212123）加2px中性secondary边标；primary使用`--dsw-alias-button-primary-fill`/`--dsw-alias-button-primary-hover`和`--dsw-alias-button-primary-foreground`整对角色，focus独立使用Host ring色/宽（默认business-primary蓝），不把选择涂成accent或success。

缺role时canvas/surface回退Canvas、正文/必要次字回退CanvasText，primary回退成对ButtonFace/ButtonText，细线/hover沿既有中性轻混合。必要input/select边界由主字与layer1作54% srgb混合；缺color-mix时CanvasText边界。小链接用中性必要文字与link角色下划线，保留href/修饰键；success/warn/error只作冗余标记，必要状态词仍用主/次文字。Light蓝字及success绿字不承担12–14px必要文字，4.49763的红字不能舍入4.5冒充通过。实际Host可覆盖默认值；computed主题/键盘/200%和可访问性须在真实候选另验，静态色对计算不代表安装或整页WCAG通过。

正式矩阵含light/dark六面、1440/1200/1024/390、控件default/hover/pressed/selected/focus/selected+focus/disabled/loading/error，及正常/partial/offline/denied/unknown/pending/error/ack-Saved/真实空/筛选零/长文。窄List保留语义table及局部横滚、全部操作与8字段路径；Board只有过滤授权结果存在的规范组，Unknown卡内原生未映射标签，不留虚假四空井。Timeline为未来设计，current导航仅实际目的地。不得删安全事实以满足构图。实现中的冗余Completed绿点只能根据604提前投影的安全规范planningStatusKey=Done；不得解析中文/native显示文字或engineering merged，Unknown与工程提示保持正交。

## Global Constraints

唯一完整PR文件集：本计划、`docs/README.md`索引、`docs/product/release-visual-target-v3/`的自包含`README.md`、`handoff-v3.md`、`host-role-palette-v3.json`、`release-workspace-v3-manifest.json`与静态PNG；`docs/product/release-visual-target-v1/README.md`改为短Superseded历史指针；以及从最新树退役 `docs/product/release-visual-target-v1/`下本任务自建的其余文件（包括旧handoff、manifest和全部PNG）。退役集合严格取固定提交 `3f1f98127236875cdd3fc26769b4b132d0d2ba83`中该目录的已跟踪文件减README；不触及此集合以外的文件、用户内容或产品。清理前逐项核对当前diff与任务所有权，遇未知/混入修改先保留并调查，不递归删除整目录。

历史指针保留明确“v1未获接受、已由v3取代”的边界，链接完整不可变public commit/tree而非分支latest；记录该提交中 `docs/product/release-visual-target-v1/release-workspace-v1-manifest.json` 的SHA-256 `c900d19307e683e1ee617830e0fab0373a989fbf61ce2528c3a67a89130ed00c`。原PNG/hash同时保存在现有ignored冻结运行态资产和上述未改Git提交中；不删旧Git对象，不依赖公开文档中的运行态路径恢复。v3必须自包含，不链接本机或ignored材料作当前handoff。

技术代码目标0；PNG为静态设计资产，不保留生成器、SVG/prototype或probe代码。当前PR #610完整文档新增+删除而非仅本轮净增严格<1300；本次退役与元数据变更完整入整理账，实际PR规模仍相对真实base重新计算，不能把移走历史材料当负数抵扣产品。manifest可用可读精简结构减少重复，保留版本、场景、来源身份和hash证据。

不改产品、Provider、schema、Status/native关系、stack #613或其他worktree。此举是未接受设计材料的文档整理，不是产品兼容/数据迁移或抹去历史接受记录。公开正文中文、issue/PR英文，执行publication五类人工检查；设计owner独占文件集，无merge/Ready权限扩大。

## Plan of Work

### Batch 1 · 固定可审阅设计与 Draft

**最小闭环**：任何审阅者能通过PR打开完整reference和诚实基线。
**涉及文件**：本计划、设计入口与handoff。

先核对根Git/worktree状态与本分支base，确认Global Constraints固定历史锚点在Git及公开端可读，核验manifest SHA与ignored冻结资产，再逐项退役旧v1任务文件，仅留短历史指针。整理图像内容密度；修复Delivery/Unknown/error全矩阵缺口并定点复审，完整传播v3并核对已接受布局未漂移，核对窄屏动作路径、detail背景、Unknown语义和current/future导航。比较当前公开Host组件合同，把具体可用/不可用事实写入handoff，不把旧包版本当当前安装证据。静态图打包到文件集后人工检查每个主题/宽度，入口区分真实基线、设计示例、未知安装身份。通过发布检查后整理commit，更新既有以main为base、关联 #603的Draft PR #610，不重复创建，描述闭环、ExecPlan+Batch、`Closes #603`、未同意状态、证据、风险与回滚；读取远端issue关联和元数据后才能推进。`Closes`关系不表示现在已验收。

在检出 `docs/release-visual-target` 的工作树根运行以下命令；所有后续批次复用本组检查，不另列副本：

    git rev-parse --git-dir --git-common-dir
    git status --short --branch
    git worktree list --porcelain
    git check-ignore -v .worktrees/
    git diff --check origin/main...HEAD
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --numstat origin/main...HEAD
    gh issue view 603 -R SingularityKChen/harness-projects --json number,title,state,body,comments
    gh pr view 610 -R SingularityKChen/harness-projects --json number,url,headRefOid,baseRefName,isDraft,closingIssuesReferences,reviewDecision,statusCheckRollup
    gh pr checks 610 -R SingularityKChen/harness-projects

期望：diff/disclosure无命中；docs严格<1300、无产品技术文件；PR base=main且为Draft、closing issue含603，公开页面可打开全部PNG。Draft阶段checks可排队/失败，必须如实记录；最终必须通过实际required checks。逐图人工检查不是WCAG/产品行为证明。
**回滚**：保持Draft；需要恢复旧材料时按Idempotence and Recovery从固定提交逐文件恢复，不移动HEAD或覆盖用户文件。已公开分支不用追加删除冒充泄露修复，按publication流程处理。

### Batch 2 · 独立视觉复核与具名人审

**最小闭环**：经独立审视后，人类面对固定完整artifact作具体判断。
**涉及文件**：handoff与本计划。

独立审阅者检查六面层次、字体、密度、明暗、窄屏、状态与长内容，不以测试代替审美。修复全矩阵材料缺口后，在PR/issue链接同一v3版本/hash与比较图，明确v2版式已认可而v3颜色/整套仍待决定，向人类展示可审阅结果。明确记录同意原文、时间、对象和要求修改；若只有产品方向同意、含糊“继续”或无回应，保持等待，不实施 #604/#605。若人类提出实质改图，迭代并重新固定版本。

**验证**：复用Batch1发布/元数据检查，另人工确认具名同意确实涵盖hierarchy/density/typography/controls/modern appearance，且未扩大为Status/native关系、merge或安装接受。
**回滚**：同意前可更换参考；同意后若改视觉目标必须新版本并重审，保留旧版本接受范围。

### Batch 3 · 最终验收与 Ready

**最小闭环**：设计PR的当前head证据与人类同意一致。
**涉及文件**：本计划与文档索引。

由未参与A/B设计作者的最终验收者对材料和具名门作对抗验收；只做必要文档重构，运行Batch1检查。push后回读当前head/base、issue关联、全部checks及review threads（通过GraphQL `repository.pullRequest.reviewThreads`完整分页）；清除实质未解决问题，记录当前观察时刻。全部成立才将此PR Ready，不merge；若人类同意未到则保持Draft。计划仅在本设计闭环全部验收时移completed并更新索引。
**回滚**：保持Draft可继续修订；Ready可退回Draft，不改任何Planning状态。

## Validation and Acceptance

Batch1提供可打开、可比较、可追溯的静态artifact；Batch2提供具名人类视觉接受；Batch3提供当前head的发布/评审/required-check闭环。三者齐备才称 #603设计交付完成。source fixture、设计图和安装产品三类证据必须在入口中可区分；无产品行为测试要求，也不增加镜像测试。

## Progress

- [x] (2026-11-10 SGT) 既有Draft #610关联 #603及stack，初版plan-only Fast Gate通过；这不是视觉接受。
- [x] (2026-11-10 SGT) 记录v1未接受、v2版式认可/olive否决，独立v3首帧审阅准入完整传播。
- [x] (2026-11-10 SGT) Batch1本地材料：Delivery/Unknown/error修正及全矩阵/定点复审通过，35PNG与两份只读元数据冻结，逐项退役旧v1材料并建立历史指针；当前v3发布head回读见Batch3。
- [x] (2026-11-10 15:08 SGT) Batch2：人类明确“批准 v3，开始实施”，对象为冻结manifest；#604/#605产品TDD设计门已满足。
- [x] (2026-11-10 SGT) Batch3 本地验收：独立最终文档/发布审阅无未决发现；manifest 及 37 个绑定文件、13 章节、相对链接、disclosure/size/diff 均通过。发布前远端回读同时确认 base=main、双向 #603/#610 引用、零未解决线程及 required Fast Gate 成功；计划归档后仍须对最终 push 的当前 head 重复远端门，才执行 Ready，不 merge。

## Surprises & Discoveries

旧图像缺口已曾定点修正，但用户仍未接受v1整体，不能把内部复查当用户接受。v2实际短行是58px而非早期56px；新v3严格只改Host分层中性角色，保留布局认可。公开token默认色/contrast复算是静态证据，实际Host覆盖和安装身份未确认。

## Decision Log

Decision：人类明确批准固定 `release-workspace-v3` 的配色、六面视觉参考与工程交接，并授权开始 #604/#605 的TDD实施。原文：“批准 v3，开始实施”。对象manifest SHA-256：`d714cea12faa96bb6411c4e19c3712914af98bad199dd3787cdb419ecbf48c29`。Rationale：这是针对具名完整版本的明确同意，取代此前仅版式认可；没有扩大到merge、Planning Status/native关系或 #599安装验收。Date/Author：2026-11-10 15:08 SGT / 人类伙伴（当前对话），由交付协调者记录。

Decision：保存v2版式部分接受，v3颜色/整套待具体图判断。Superseded by 本节具名 v3 批准（2026-11-10）。Rationale：接受范围必须与人类原话相同，不能推定沉默。Date/Author：2026-11-10 SGT / independent final spec reviewer。

Decision：颜色选择Host分层中性，通过CSS继承而非theme JS。Rationale：当前Loader不支持theme模块，且无需第二主题authority。Date/Author：2026-11-10 SGT / independent final spec reviewer。

## Idempotence and Recovery

读检查和固定提交取证可重复；仅在Global Constraints声明的任务文件集合内更换或退役，先确认ignored冻结副本与Git历史锚点内容一致。恢复anchor为 `3f1f98127236875cdd3fc26769b4b132d0d2ba83`：以argv调用 `git ls-tree -r --name-only`列该提交的v1目录，或 `git show <anchor>:<relative-path>`读取指定blob；这些是只读恢复输入，不reset/checkout整个工作树。确需恢复时逐文件写回到允许的v1目录，先拒绝当前用户改动、未知路径和符号链接，核验manifest/hash后再审阅diff。不能对其他worktree或产品文件执行清理，不删除旧Git对象或执行garbage-prune来配合文档退役。

最新树只以v3作为完整现行reference；v1短README保留不可变public链接及manifest摘要，故从最新树移除旧PNG/handoff/manifest不丢失必要来源或历史恢复能力。ignored副本是本地额外保障，不是正式文档依赖。若固定commit或hash验证失败，停止退役，保留现状并修复恢复证据；不能先删后补锚点。

v3版本/hash变更同步全部入口；当前Delivery/Unknown/error修复未通过前不freeze或请求整套最终同意。远端更新前回读base/head，遇并发变更保留用户内容并调查；设计退役不构成产品migration/compat或数据回滚。发布历史若重写另走恢复锚点与精确lease流程，不由此授权merge/Status/native变更。

## Interfaces and Dependencies

依赖pnpm/Node>=22、GitHub gh认证及当前受支持Host公开组件合同的只读证据。具体设计冻结后，下游分支 `feature/release-workspace-polish`基于本分支，后续 `feature/planning-board`再基于前层；所有层按各自实际PR base计量。Status/native关系不在本接口内。

## Outcomes & Retrospective

已完成v3自包含参考、35张PNG及两份只读元数据的hash/字节/尺寸核验、全矩阵与定点视觉复审，并取得具名人类同意。固定manifest SHA-256为`d714cea12faa96bb6411c4e19c3712914af98bad199dd3787cdb419ecbf48c29`。冻结handoff/metadata中“尚未接受”描述是冻结时观察，当前批准以本Decision Log为准；不修改已批准对象的hash。

独立最终文档/发布验收通过，无未决发现；本设计闭环已完成并归档，索引与批准链接同步更新。归档提交最终 push 后的当前 head/base/checks/双向 issue 引用与 Ready 操作仍按 Batch3 执行，不将归档前检查当最终 head 证据。产品代码实施和 #599 安装人验独立；#145/#606/#607 保持各自边界。无新技术债。

## Bottom Change Note

2026-11-10 SGT：v3修订保留v1历史否决及v2版式部分接受，冻结实际58px/y196布局，改用公开Host角色并保持完整具体人审门。


2026-11-10 SGT：包装范围修订为最新树仅v3完整参考；v1仅留Superseded指针、固定public commit和manifest SHA，明确逐文件退役/恢复与Delivery/Unknown/error尚待修复，不改其他两份计划。

2026-11-10 15:08 SGT：完成定点修正后冻结v3，逐项退役本任务v1材料，记录具名人类批准；当前发布验证独立于产品/安装接受。

2026-11-10 SGT：独立最终文档/发布验收通过，计划移 completed 并更新索引与批准链接；保留最终 push 后的当前远端门与人类合并边界。
