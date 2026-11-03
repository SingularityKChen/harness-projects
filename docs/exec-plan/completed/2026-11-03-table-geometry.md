# 可滚动表格的稳定上下文 ExecPlan

> 状态：Completed（实现与独立 MMP 评审完成；实际合并、产品发布和 R1 各自回读）
> 创建：2026-11-03
> 范围：Issue #514，父项 #507 的独立能力闭环
> 调查基线：main `957451c684c546ddf8a5d19cb3a23a719940fa9b`

## Purpose / Big Picture

100+工作项与长迭代/来源仍可比较；横滚保标题，竖滚保列头，窄Host保其它列上下文。此片自身解决基本阅读，不等待query/resize，也不把#446当前基础阅读义务延期给controls。

## Context and Orientation

现有 `work-item-list.ts` 八列百分比配auto table；`list-states.ts` 76rem最小宽且只overflow-x，不能证明真实竖sticky。生产入口是有界Host slot→WorkspaceSetupGate→WorkItemApp→WorkItemListPage；A3/B-G均要求从真实scroll owner建立几何。

## Design / Spec

保留semantic table/caption/th scope、TitleLink导航与redacted占位；新增稳定列ID、label、default/min/max width和optional定义，colgroup与fixed layout共用列几何。整表总宽由列宽和可见集合求和，header/body不分别算。一个 `.hp-list-scroll` 同时拥有XY overflow和受实际Host可用高度约束的block-size，父flex链min-block-size:0；不用无限长页面充当竖滚owner。head sticky top、title sticky inline-start，层级body<title<header<corner，用不透明Host surface、必要separate border避sticky绘制缝隙。

标题可见measure最多约3行，真实可访问名称不截断；有导航时focus能展开全文、touch打开同一详情，无导航的独立table用原生details获取全文，禁止hover-only title。迭代/来源合理换行，date-only原样。冻结标题按container width和context reserve夹紧，例如至少保留约96–128px其它列窗口；极窄时Host上界优先于配置min，不能让min宽吞掉整个root。为后续width/display保稳定ID，不预装controls。拒绝CSS grid模拟表格、virtual grid和无consumer证据的新框架。

## Global Constraints

分支 `feature/table-geometry`，base为 `main`；在该分支的工作树根执行验证。用户已授权两路独立方案经第三位综审后持续实施；不重复确认、不自行合并、不改变规划 Status 或 native dependency。文件全集：`packages/ui/src/table-columns.ts`、`packages/ui/src/table-presentation.ts`、`packages/ui/src/work-item-list.ts`、`packages/ui/src/list-states.ts`、`tests/contract/ui-work-item-list.test.js`、`tests/contract/ui-work-item-list-browser.test.js`、`tests/contract/ui-work-item-detail.test.js`、`tests/integration/github-projects-bootstrap.test.js`、`tests/browser/table-geometry.test.js`、`tests/browser/fixture-host-contract.test.js`、`tests/fixtures/workspace-frame-browser.mjs`、`tests/fixtures/table-geometry-browser.mjs`、`docs/exec-plan/completed/2026-11-03-table-geometry.md`、`docs/README.md`。owner：table-integrator。不引入 Provider 读写、规划写入、路由或持久化偏好层。

代码、测试、配置、fixture 新增加删除严格少于800行，文档少于1300行；估计代码390–580，接近790时先查真实重复或重新划分独立闭环，不删必要安全验收。锁文件和生成目录按仓库规则排除。命令以 `pnpm` 简写，实际使用锁定工具链 `npx --yes --package pnpm@10.28.2 pnpm`。计划完成后移入 `docs/exec-plan/completed/` 并更新文档索引；安装证据和工程测试分开记录。

## Plan of Work

Batch 1闭环为真实受限scroll上的可读语义表格。先做100+行、长title/iteration/source、mixed Issue/PR、missing/redacted、narrow/shortheight夹具，测scrollHeight>clientHeight及scrollTop实际变化；旧auto/无局部竖界必须红。建立列契约和colgroup，安排上下文冻结、标题夹紧及全文入口。主文件table-columns/table-presentation和现有ItemTable。验证 `pnpm test:file tests/contract/ui-work-item-list.test.js tests/contract/ui-work-item-list-browser.test.js`、`pnpm test:file tests/browser/table-geometry.test.js`、`pnpm typecheck`。期望双轴滚动后header/title相对surface坐标稳定、列界误差≤1px、页面不横溢、焦点不被固定层盖住。revert恢复static几何，无数据回滚。

Batch 2闭环为真实Host基本阅读。pack与安装同artifact，在320/640/1024/1200/1440、短高、200%文字、light/dark实际双轴滚动、focus/touch全文入口。保存source/artifact与bbox/截图，不能拿CSS字符串或fixture Host外观代替。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 真实scroll owner | local surface的client/scroll大小与实际scrollTop/Left变化；删除高度约束测试红 |
| frozen context | header/title/corner相对surface稳定，body/header列界≤1px |
| 窄Host | 标题夹紧后可见其它列窗口，无页面X溢出；移除夹紧测试红 |
| full title/语义 | focus/touch可得完整title，th/caption/真实anchor保留 |
| 长内容/100+ | title不碎裂，iteration/source合理换行，missing/date/redacted安全稳定 |
| 主题与焦点 | 光暗200%/短高、固定层不遮focus，安装接受单列记录 |

## Progress

- [x] (2026-11-03 SGT) 子项 #514 已建立，独立验收边界与父项区分。

- [x] (2026-11-03 SGT) A3/B-G与生产有界slot调查完成。
- [x] (2026-11-03 SGT) Batch 1：稳定列定义、fixed table/colgroup、单一表格 XY owner、冻结 header/title/corner 与全文入口已实现；相关 renderer/VM/Chromium 检查通过。
- [x] (2026-11-03 SGT) Chromium 实际几何覆盖 320/640/1024/1200/1440 × 320/480/720 高度 × 100%/200% 文字 × light/dark（60 组合），含真实 setup→app→list、120 可见项与 redacted、长标题/迭代/来源、Issue/PR、缺值与 date-only。
- [x] (2026-11-03 SGT，旧基线历史证据，非当前CSS等价证明) Batch 2 基础阅读实际安装接受：主控在source7f7b3d7/artifact e3745e3995cdd444a31305d871e315960fc3e8667111ad4445a462f205d48695上验证五宽1440/1200/1024/640/320×480；局部XY、sticky header/title、无页面横溢、320标题focus展开与AX全文、无写入。

- [x] (2026-11-03 SGT) 当前新CSS组合安装、字节比对与浏览器原生200%九项接受完成，source/artifact及复现上下文见Outcomes；不是原生桌面壳完整接受。

## Surprises & Discoveries

2026-11-03 CI复查：三个stack Browser lane均在320×320/200%文字焦点标题被sticky header遮挡。Mac默认隐藏滚动条掩盖了问题；显式显示Chromium传统16px滚动条后本机同样复现：210px外框仅192px可用，固定表头107.78px，标题因竖滚条挤窄换为三行144px。新增回归先红，表格/列表体最小高度7→9.5rem、setup body14→16.5rem后绿，短Host仍由setup纵向抵达表格。

现有scroll面没有竖向上界，单改position:sticky不闭环。固定标题min宽必须服从极窄Host上界。

2026-11-03 实测：单设祖先 `overflow:hidden` 虽有局部 Y scroll，但 320 宽/200% 文字会使元信息把表格推到可见 slot 外；相对自身的 bbox 不能证明可达。新增实际 slot 可达断言先红后绿。上下文以可聚焦区域收缩并自行 Y 滚动，最少保留完整一行；短高沿已有 setup 根 Y 滚动到表格。原setup body至少14rem、表格窗口至少7rem的判断已被传统滚动条反例推翻：当前分别为16.5rem与9.5rem；只有表格拥有XY滚动。

新增 fixture 是必要的独立测试输入，包含真实 WorkspaceSetupGate、WorkItemApp、EntityStore 和 view 派生；不存在 Provider 网络或规划写命令。fixture 是受限 slot 模拟，不能代替安装 Host。

完整 `pnpm test` 首轮发现三个旧 SSR 消费者要求既有 anchor 形状；移除不必要的 anchor class，改以表格行标题结构选择器呈现后保持原导航契约。

2026-11-03 组合夹具反例：官方parser需要react/jsx-runtime，但table fixture只映射React，实际组合pageerror且0行；独立jsx owner/hook检查先红。workspace-frame没有有界slot，G的真实flex链使Project根塌为0，原reflow判据先红；只为fixture设置真实100dvh flex slot。产品代码未改，官方JSX runtime仍只绑定页面唯一React，未知module仍拒绝。

## Decision Log

Decision：以当前新CSS组合source/tgz逐字匹配及浏览器原生200%九项接受补齐G组合运行面证据。Rationale：旧7f包与7/14rem几何不能证明当前9.5/16.5rem和114px预留；保留旧测量历史并就地标注，不声称桌面壳/VoiceOver或Gate R1通过。Date/Author：2026-11-03 SGT / 主控实际安装接受。

Decision：用传统滚动条的可用client viewport补齐焦点回归，最小表格窗口同时容纳固定表头和三行短标题；集成行定位直接读native summary文字，不再泛化删除标签。Rationale：hosted CI证明原窗口存在焦点遮挡，本机传统滚动条复现证明该窗口不足，CodeQL指出测试标签删除不是可靠文本提取。Date/Author：2026-11-03 SGT / CI修复。

Decision：继续原语义table，显式列几何和一个bounded XY surface。Rationale：不引入新的行模型/主题/可访问性权威，可用真实bbox判定。Date/Author：2026-11-03 SGT / 独立综审。

Decision：文件全集扩充见 Global Constraints。Rationale：真实几何需要专用有界 slot fixture；既有 SSR/VM renderer 与集成行提取对独立无导航列表的全文入口须与 native details 对齐；集成测试改读 row-header 的文字，不再假定标题后立即结束 th。Date/Author：2026-11-03 SGT / table-integrator。

Decision：所有独立无导航安全标题使用 native details/summary，导航标题 focus 展开文本、touch 进入同一详情；redacted 仍是纯占位。Rationale：字符数不能判断窄屏/200% 文字是否截断，避免短字符串在窄列丢失全文入口。Date/Author：2026-11-03 SGT / table-integrator。

Decision：G基础阅读闭环按实际安装五宽/焦点证据接受并归档。Rationale：source与安装artifact逐字匹配，实际Host证明独立最低阅读能力；光暗/200%/pointer矩阵保留为生产fixture工程证据，最终组合Host覆盖由父#507承担，不将其冒充本轮实际测量。Date/Author：2026-11-03 SGT / 主控接受裁决。

## Idempotence and Recovery

纯展示，可反复scroll/resize；回滚先处理已消费列契约的R/Q再撤G，或同组revert。无业务数据迁移。

## Interfaces and Dependencies

列ID/min/default/max是R/Q共享契约；table-integrator管理其变更。历史方案“G→R可用native线性stack、G→Q以G为base，工具限制不能制造R→Q依赖”已由Q Decision Log「共享UI接线后的线性依赖」Superseded：当前真实base链为main→G→R→Q，Q base为R。Q实际消费R共享header slots、width owner及交互生命周期，依赖来自已验证的共享UI契约，不是工具要求；纯model/control叶子曾并行完成的历史保持。局部scroll高度来自当前Host layout，不读Provider，也不新建layout状态权威。

共享列契约为 `TABLE_COLUMNS`（readonly `id/label/minWidth/defaultWidth/maxWidth/optional`）与 `TableColumnId`；宽度单位 px，列顺序为 title、identity、planningStatus、iteration、targetDate、engineering、source、freshness。`--hp-column-<id>` 可提供列宽，colgroup 和总宽读取相同变量；title 的有效宽度受当前容器宽减 114px 的上下文 reserve 夹紧（96px其它列、16px传统滚动条及2px边框）。resize/query 消费此契约，不复制安全行模型。

## Outcomes & Retrospective

当前新CSS组合安装接受（2026-11-03 SGT）：组合source `dca3e6f7844dbef7ce0da94f3ff080dadc65f0f0`，tgz SHA-256 `cf710bec2ec6a5a296facea9b1ba174599b60c2a53cfae3918520fca077a9509`，安装文件与该tgz逐字相同。使用隔离的full Chromium `156.0.8078.4`，通过浏览器原生`tabs.setZoom`设置2并以`tabs.getZoom`回读2，无页面CSS或应用状态覆盖。联合流程实际CSS viewport为720×480；另测light/dark×实际720×480、640×480、320×480、320×320，共9cases PASS、errors为空；表格样本均无页面X溢出。这是当前已安装Host的浏览器运行面接受，不能表述为原生桌面壳完整验收或VoiceOver已测；Gate R1仍按`docs/architecture/release-gates.md`独立判断。

复现上下文：固定上述组合source并build/pack，核对tgz SHA并安装后比对安装字节；在同一Host工作空间快照用隔离full Chromium原生tab zoom=2，浏览器视口请求1440×960、1280×960、640×960、640×640分别回读实际CSS viewport720×480、640×480、320×480、320×320，再按两主题重复。联合流程在实际720×480从Issue #115搜索、排序、键盘调列宽进入含6个heading/40个code节点的Markdown详情，读取来源关联PR #159，完成详情展开/还原与Escape，返回列表后查询及列宽保持。原CSS字体放大矩阵仍是独立工程证据，不能替代这次浏览器原生缩放量测。证据路径：`.superpowers/ui-505-508-20261103/installed-host-combined-ci-fix/browser-zoom-acceptance/report.json`。

CI修复本地验证（2026-11-03）：`pnpm test:browser`完整13/13通过，含原60组合与新增光暗传统滚动条回归；`pnpm test:file tests/contract/ui-work-item-list.test.js tests/integration/github-projects-bootstrap.test.js`21/21通过；`pnpm typecheck`通过。以上为当前工作树本地证据，最终远端head仍需重新执行hosted检查。

工程验证记录：在 `feature/table-geometry` 检出运行 `pnpm test:file tests/contract/ui-work-item-list.test.js tests/contract/ui-work-item-list-browser.test.js tests/browser/table-geometry.test.js`，期望且观察到 19/19 通过；`pnpm typecheck` 与 `pnpm run boundaries`（9/9）通过。`node scripts/workflow-check.mjs` 无 findings。`pnpm test` 完整回归在 2026-11-03 SGT 本批工作树观察到 3385/3385 通过（重算命令：`pnpm test`，期望全部通过）；安装证据不得从这些检查推导；本轮实际安装接受另见本节独立证据。

Chromium 负控分别移除本地高度约束、sticky header 和 title 窄宽夹紧，实际量测捕获失去 Y scroll、表头随内容移出与标题吞掉上下文；ArrowDown 能移动本地 surface，native summary 实际 touch 打开。可选 `TABLE_GEOMETRY_EVIDENCE_OUT=<evidence-dir> pnpm test:file tests/browser/table-geometry.test.js` 生成每组合 bbox/scroll/focus JSON 与窄屏截图。

本片不关闭#507；只提供可独立接受的基本几何。若Host祖先无可用高度，先依据实际slot修最小布局传递，不做全workspace框架重构；超预算重估闭环并记录实质延期债务。

## Bottom Change Note

2026-11-03 SGT：综合A3/B-G，明确真实双轴owner、极窄标题上界及独立全文入口。

2026-11-03 SGT：记录 Batch 1 红绿与短高反例，稳定共享列契约；专用真实组件 fixture 和无导航全文披露检查扩充见 Global Constraints。该记录时安装 Host 留待 Batch 2；Superseded by 本节实际安装接受与归档裁决（2026-11-03）。

2026-11-03 SGT：修复组合fixture运行时及Host slot，新增独立真实DOM合同；当时产品源码与原7f完全相同、12个安装package文件SHA逐字相同；该等价只对应夹具修复阶段，已被后续生产几何修复推翻，不能用于当前包。

2026-11-03 SGT：实际安装证据来源为source7f7b3d71c1a069b7f9db2ebc5fa8d654b73f11b3与artifact e3745e3995cdd444a31305d871e315960fc3e8667111ad4445a462f205d48695；五宽均pageOverflow=false，320 owner外框227×112，focus后标题display:block、无line clamp并保留AX全文，无规划写。当时光暗/200%仅有fixture G60，该条只保留旧包基本阅读事实；当前新CSS组合的浏览器原生200%接受见Outcomes，不从旧包或fixture外推。

2026-11-03 SGT（旧基线，已被CI生产几何修改推翻）：夹具修复阶段与原7f的packages/apps/manifest/lock文件树完全一致；独立旧树与当时树build的12个安装package文件SHA逐一相同，不适用于当前CSS。主控授权归档本计划并将未发布G收敛为一个能力提交；原plan/能力/fixture提交由backup引用保留。

2026-11-03 SGT：CI修复改变生产几何，旧7f安装artifact仍只证明原基线的五宽基本阅读；当前生产源码及安装package不再与旧artifact逐字等价。新增传统滚动条回归仍仅为工程证据；当前浏览器原生200%接受由Outcomes的新组合安装记录独立补齐，不能从该回归外推。

2026-11-03 SGT：完整传统16px滚动条矩阵进一步暴露窄宽上下文仅94px；标题reserve112→114px补齐surface边框，保留至少96px其它列窗口；同一回归覆盖100%与200%文字。hosted日志未量测滚动条，传统滚动条属于本地可复现条件，不将其直接断言为runner原因。

2026-11-03 SGT独立复核补强：96px上下文断言移到scroll/focus之后，与实际双轴gutter及clientWidth同次DOM量测；此前提前量测不能杀死112px旧值。临时114→112变异在真实gutter下测得client256/title162/context94并按新断言失败；恢复114后通过。只补测试与契约文档，生产几何字节不变。

2026-11-03：本会话独立 MMP 全层评审 #520 完成，矩阵及真实验证见 `docs/review/pr-520-mmp-review.md`；本层未发现新增 P0/P1/P2/P3。人类本次直接授权本会话负责本 PR 的后续修复、独立复评、归档、提交整理、issue 核对及当前门禁通过后的 rebase merge，替代旧交付阶段“不自行合并”限制；不覆盖 Planning Status、原生依赖或 R1 裁决。此计划已在 completed，无需另建重复实现计划。
