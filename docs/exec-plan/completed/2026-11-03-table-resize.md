# 可访问列宽调整 ExecPlan

> 状态：Completed（实现与独立 MMP 评审完成；实际合并、产品发布和 R1 各自回读）
> 创建：2026-11-03
> 范围：Issue #515，父项 #507 的独立能力闭环
> 调查基线：main `957451c684c546ddf8a5d19cb3a23a719940fa9b`

## Purpose / Big Picture

用户可发现并用pointer或键盘调列宽，取消与重置有确定结果，不误触排序或导航。R可独立于query接受与回滚。

## Context and Orientation

此片真实依赖G列ID和几何min/max，所以base `table-geometry`；Q纯模型不依赖R。共享header和scroll surface由table-integrator串行修改。A4/B-R均要求pointer生命周期和键盘替代。

## Design / Spec

宽度为当前workspace本地presentation state。明确handle配native range/数值输入作为键盘替代，或完整slider语义handle；中文列名、最小/最大/当前值可访问，Arrow小步、Shift大步、Home/End边界。拖动只收主pointer/左键，捕获pointerId，setPointerCapture；move共用纯clamp reducer；up结束，cancel恢复drag start并释放capture，lostcapture/unmount也清listener/drag class。交互区可达，不用2px视觉线充触摸目标。

handle和sort按钮hit area独立，resize stopPropagation，不open row、不sort、不误选文本。reset真button恢复initial宽及G的动态title夹紧；双击可以补充但不能是唯一入口。宽更新不更换列key/scroll容器，滚动与焦点保持。同workspace refresh保偏好，workspace/planning-binding切换清宽度；不写localStorage/Provider/Storage。拒绝仅CSS resize或整套grid库。

## Global Constraints

分支 `feature/table-resize`，base为 `feature/table-geometry`；在该分支的工作树根执行验证。用户已授权两路独立方案经第三位综审后持续实施；不重复确认、不自行合并、不改变规划 Status 或 native dependency。文件全集：`packages/ui/src/column-resize.ts`、`packages/ui/src/work-item-app.ts`、`packages/ui/src/work-item-project.ts`、`packages/ui/src/work-item-list.ts`、`packages/ui/src/table-presentation.ts`、`tests/contract/ui-column-resize.test.js`、`tests/contract/ui-work-item-list.test.js`、`tests/contract/ui-work-item-detail.test.js`、`tests/fixtures/table-geometry-browser.mjs`、`tests/browser/table-resize.test.js`、`tests/browser/table-resize-regressions.test.js`、`docs/exec-plan/completed/2026-11-03-table-resize.md`、`docs/README.md`。owner：table-integrator。不引入 Provider 读写、规划写入、路由或持久化偏好层。

代码、测试、配置、fixture 新增加删除严格少于800行，文档少于1300行；估计代码450–690，接近790时先查真实重复或重新划分独立闭环，不删必要安全验收。锁文件和生成目录按仓库规则排除。命令以 `pnpm` 简写，实际使用锁定工具链 `npx --yes --package pnpm@10.28.2 pnpm`。计划完成后移入 `docs/exec-plan/completed/` 并更新文档索引；安装证据和工程测试分开记录。

## Plan of Work

Batch 1闭环为可恢复、可访问列宽。先红测clamp、键盘min/max、pointerId隔离、非主键、cancel/lostcapture/unmount、reset和navigation/sort spies；加纯reducer与生命周期，再接header handle和reset。主要文件column-resize与header接线。验证 `pnpm test:file tests/contract/ui-column-resize.test.js tests/contract/ui-work-item-list.test.js`、`pnpm test:file tests/browser/table-resize.test.js tests/browser/table-geometry.test.js`、`pnpm typecheck`。期望width真实变、header/body对齐、取消恢复、reset确定且误触计数0。revert保G固定默认宽。

Batch 2在真实Host光暗、窄宽、200%/短高用pointer和keyboard重做resize/reset，记录source/artifact与测量；确认scroll和focus未被sticky覆盖。原全安装提案Superseded by本计划Decision Log的R独立接受边界（2026-11-03）；实际键盘/刷新与工程pointer/矩阵分列。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 两种输入路径 | 拖动与keyboard同reducer且读得当前/min/max；非仅鼠标 |
| 生命周期 | cancel恢复start，lostcapture/unmount清理；错pointerId不动 |
| 几何 | min/max与窄Hosttitle上界都成立，reset恢复G策略 |
| 独立动作 | resize不sort/open/navigation，滚动容器DOM身份保留 |
| scope | refresh保偏好，workspace/binding换代清空，无任何Provider写 |

## Progress

- [x] (2026-11-03 SGT) 子项 #515 已建立，独立验收边界与父项区分。

- [x] (2026-11-03 SGT) A4/B-R完整综审。
- [x] (2026-11-03 SGT) G 列契约已消费；共享 clamp、pointer lifecycle、可访问 slider、键盘替代和 reset 已实现。
- [x] (2026-11-03 SGT) 实际 Chromium 验证拖动/键盘、取消/capture丢失/卸载、scope刷新与切换；20 个 resize 宽度/主题/200%组合和 G 的60个几何组合通过。
- [x] (2026-11-03 SGT，旧基线历史证据，非当前CSS等价证明) 主控接受R独立闭环：实际安装source6b4ad9d/artifact1ebd71b88bba328d8a03c5b5e99d5eb49b317899cd7e716d1889265f018c389d，320×480键盘104→112→144→96→240→reset104；focus在owner内，page/Y稳定，136在显式刷新动作完成后保留。

- [x] (2026-11-03 SGT) 当前新CSS组合实际安装与浏览器原生200%九项接受完成，含键盘调宽及跨详情保留；证据与复现见Outcomes。

## Surprises & Discoveries

lostpointercapture与cancel是不同退出路径；reset也必须服从当前Hosttitle上界，不能只回常量。

2026-11-03 独立复审两个P2已在owner检出先红确认：pointer完成未reveal，窄宽handle完全离窗；drag中Tab移焦后Escape无法取消原capture。完成pointer交互复用只移动X的reveal，失焦立即回滚并释放capture。两条独立反例入库，pointer完成覆盖100%与200%+dark并断言Y=300不变。

2026-11-03：实际窄屏键盘 End 会把已聚焦的列边界移出窗口，新 bbox 断言先红；修复只调整必要 X，使手柄留在冻结标题之外，Y 不变。原生 scrollIntoView 对 sticky header 会拉回原文档 Y，所以不用于宽度更新。pointer 聚焦使用 preventScroll。

现有 view 只有显示名称，不能用于 workspace/binding 身份；需要从 App 经 ProjectPage 显式传入 scopeKey。专用 fixture 增加安全只读 snapshot 的刷新/scope/unmount 控制和 React 祖先点击探针；不制造 Provider 写路径。

首轮完整回归有一个旧手工组件 walk 假设列表没有 hook；最小调整为在测试 dispatcher 中提取真实 anchor 回调，保留修饰键、redacted 和导航断言；列宽状态和 pointer 生命周期由真实浏览器承担。

## Decision Log

Decision：接受当前新CSS组合在浏览器原生200%下的实际键盘调宽、焦点可达及跨详情保留；保留pointer和原生桌面壳未覆盖的边界。Rationale：新source/tgz/安装字节一致并完成九项组合接受，旧6b包不能替代当前几何。Date/Author：2026-11-03 SGT / 主控实际安装接受。

Decision：纯width reducer与明确pointer生命周期、原生键盘替代。Rationale：有限列模型可直接证明行为，无需引库。Date/Author：2026-11-03 SGT / 独立综审。

Decision：扩充文件全集见 Global Constraints。Rationale：scope 真身份必须由 App/ProjectPage 微接线；共享 fixture 要能证明刷新/切换/卸载，既有 renderer 与浅层回调提取消费者要容纳纯展示控制而不削弱业务泄漏边界。Date/Author：2026-11-03 SGT / table-integrator。

Decision：header 的 label 与 resize handle 是独立兄弟 slot，handle 使用完整 slider 语义（24px × 至少44px），不引入尚未实现的 sort。Rationale：pointer 与键盘共用 clamp，事件隔离可实测；未来排序按钮消费 label slot，并须在最终组合复验。Date/Author：2026-11-03 SGT / table-integrator。

Decision：active handle失焦即取消，pointer正常完成后保持focus的边界必须可见。Rationale：取消不依赖后来焦点所在handle，也不引入全局Escape业务listener；正常完成只改必要X，不改Y。Date/Author：2026-11-03 SGT / table-integrator（独立评审P2闭环）。

Decision：按实际安装keyboard与refresh保留配置、生产Chromium pointer/cancel/blur及独立反例证据接受R子闭环并归档。Rationale：IAB pointer drag API不可用，当时实际Host zoom受系统锁屏阻塞；该阻塞已由Outcomes的隔离full Chromium浏览器原生200%接受补齐，不扩大为桌面壳或pointer实际安装接受，也不声称刷新获得权威freshread。Date/Author：2026-11-03 SGT / 主控接受裁决。

## Idempotence and Recovery

reset可重复，取消返回drag start；revert R丢局部偏好保G。无schema或旧数据处理。

## Interfaces and Dependencies

R自身只消费G稳定列契约和当前scopeKey，不反向依赖Q；当前最终UI交付链为main→G→R→Q，Q实际消费R共享header slots与width owner，resize和sort互相负控按该最终组合复验。原“不建立R→Q依赖”仅属纯叶子并行设计，已由Q Decision Log「共享UI接线后的线性依赖」Superseded，不再描述当前consumer base。

`WorkItemListPage.presentationScopeKey?: string` 从 App 的 workspaceId/planning-bindingId JSON 身份经 ProjectPage 传入，不进入 DOM。独立调用者可显式给 scope，缺省只代表该组件实例。

`useColumnWidths(scopeKey)` 返回 widths/setWidth/reset/interactionKey；切换 scope 清 override，refresh 同 scope 保留。reset 清 override 并更换交互 generation，以释放仍 active 的 capture，但不替换表格或 scroll owner。

`ColumnResizeHandle({column,width,onChange})` 为 label slot 的独立兄弟，消费 G `TABLE_COLUMNS`；`clampColumnWidth` 和 `widthForKey` 是共用宽度规则。CSS 仍经 `--hp-column-<id>` 进入 G 同一 colgroup/总宽；title 的有效上界仍由 G 当前容器减114px计算（含传统滚动条和边框预留）。

## Outcomes & Retrospective

当前新CSS组合安装接受（2026-11-03 SGT）：组合source `dca3e6f7844dbef7ce0da94f3ff080dadc65f0f0`，tgz SHA-256 `cf710bec2ec6a5a296facea9b1ba174599b60c2a53cfae3918520fca077a9509`，安装文件与该tgz逐字相同。使用隔离的full Chromium `156.0.8078.4`，通过浏览器原生`tabs.setZoom`设置2并以`tabs.getZoom`回读2，无页面CSS或应用状态覆盖。联合流程实际CSS viewport为720×480；另测light/dark×实际720×480、640×480、320×480、320×320，共9cases PASS、errors为空；表格样本均无页面X溢出。这是当前已安装Host的浏览器运行面接受，不能表述为原生桌面壳完整验收或VoiceOver已测；Gate R1仍按`docs/architecture/release-gates.md`独立判断。

复现上下文：固定上述组合source并build/pack，核对tgz SHA并安装后比对安装字节；在同一Host工作空间快照用隔离full Chromium原生tab zoom=2，浏览器视口请求1440×960、1280×960、640×960、640×640分别回读实际CSS viewport720×480、640×480、320×480、320×320，再按两主题重复。联合流程在实际720×480从Issue #115搜索、排序、键盘调列宽进入含6个heading/40个code节点的Markdown详情，读取来源关联PR #159，完成详情展开/还原与Escape，返回列表后查询及列宽保持。原CSS字体放大矩阵仍是独立工程证据，不能替代这次浏览器原生缩放量测。证据路径：`.superpowers/ui-505-508-20261103/installed-host-combined-ci-fix/browser-zoom-acceptance/report.json`。

R接受边界：本次联合流程实际执行键盘调宽并跨Markdown/来源关联/详情展开与还原/Escape保持宽度；拖动、cancel/capture/blur仍由既有工程矩阵和负控证明，不把它们冒充这次实际安装pointer测量。

工程闭环已实现；该句原称真实安装接受未完成，Superseded by本节R实际安装键盘/刷新边界接受（2026-11-03）。完整宽度持久化不在此片；实质生命周期遗漏必须修而不能列作可选。

在 `feature/table-resize` 检出运行 `pnpm test:file tests/contract/ui-column-resize.test.js tests/contract/ui-work-item-list.test.js tests/browser/table-resize.test.js tests/browser/table-geometry.test.js`，期望全部通过；`pnpm typecheck`、`pnpm test` 和 `pnpm run boundaries` 分别验证类型、完整工程回归与包边界。`TABLE_RESIZE_EVIDENCE_OUT=<evidence-dir> pnpm test:file tests/browser/table-resize.test.js` 可保存20组合的实际 bbox/scroll/focus与窄屏截图。2026-11-03 SGT 本批工作树观察到完整 `pnpm test` 3386/3386通过，boundaries9/9、typecheck通过，workflow-check无findings（均可按上述命令重算）。安装 Host 不能从这些 fixture 或测试推导接受。

## Bottom Change Note

2026-11-03 SGT：合并A4/B-R，补主pointer、lostcapture、原生键盘替代与动态reset语义。

2026-11-03 SGT：记录 R 红绿与窄屏焦点反例、真实 scope 微接线、共享 fixture 与消费者最小调整；稳定 header slots 和本地 width 生命周期接口；当时安装接受保持未完成，Superseded by本节R实际接受边界（2026-11-03）。

2026-11-03 SGT：复现并最小修复独立评审两条P2，新增真实pointer完成与跨焦点取消反例；当时真实安装接受仍未完成，Superseded by本节R实际接受边界（2026-11-03）。

2026-11-03 SGT（旧基线；不用于当前CSS等价）：实际安装source6b4ad9d6660d6cce9c45ac6167fe94da1986ffd9/artifact1ebd71b88bba328d8a03c5b5e99d5eb49b317899cd7e716d1889265f018c389d逐字匹配。320×480键盘链与focus外框274..298在owner72..299内，page/Y稳定；set136后显式planning refresh动作完成，返回last-known/unconfirmed且宽136保持，不能称成功权威freshread。pointer/cancel/blur和多维矩阵仍为生产Chromium+独立反例证据，实际IAB drag API不可用、当时zoom受系统锁屏阻塞；当前浏览器原生缩放组合接受见Outcomes，pointer仍仅工程证据。

2026-11-03 SGT（已被后续CI生产几何修改推翻的旧等价）：G夹具修复/归档阶段重放R，当时产品packages/apps/manifest/lock与原6b逐字相同，不适用于当前CSS；主控授权归档并将未发布R收敛为基于最终G的一份能力提交，所有旧plan/实现/fix由backup保留。

2026-11-03 SGT CI复查：CodeQL命中的新增列名提取改为读取专属hp-column-label文字，不以泛化标签删除假装消毒；所有既有列名、转义与泄漏断言保留。`pnpm test:file tests/contract/ui-work-item-list.test.js`本地13/13通过；最终hosted CodeQL仍待发布新head复查。

2026-11-03 SGT：继承G的传统滚动条最小高度与窄宽reserve修复；旧6b安装artifact仅保留旧基线的实际接受，当前几何不再与其逐字相同；重新安装已由Outcomes的新组合浏览器原生200%记录完成，不恢复旧包等价结论。

2026-11-03：本会话独立 MMP 全层评审 #521 完成，矩阵及真实验证见 `docs/review/pr-521-mmp-review.md`；本层未发现新增 P0/P1/P2/P3。人类本次直接授权本会话负责本 PR 的后续修复、独立复评、归档、提交整理、issue 核对及当前门禁通过后的 rebase merge，替代旧交付阶段“不自行合并”限制；不覆盖 Planning Status、原生依赖或 R1 裁决。此计划已在 completed，无需另建重复实现计划。
