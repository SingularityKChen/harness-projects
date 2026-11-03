# 安全工作项局部查询与显示 ExecPlan

> 状态：Completed（实现与独立 MMP 评审完成；实际合并、产品发布和 R1 各自回读）
> 创建：2026-11-03
> 范围：Issue #516，父项 #507 的独立能力闭环
> 调查基线：main `957451c684c546ddf8a5d19cb3a23a719940fa9b`

## Purpose / Big Picture

用户在当前已加载可读行里搜title、筛status/iteration、单列稳定排序和选择显示列；知道0匹配与源为空不同，一键恢复default view。

## Context and Orientation

`VisibleListRow`已剥离redacted字段，唯一query输入必须是它。现有展示把missing压成“—”；此片不回raw推真实缺失。Q的纯model/control可与G/R并行，显示列接线真依赖G稳定列契约；base G而非R。Superseded by Decision Log「共享UI接线后的线性依赖」（2026-11-03）。纯model已完成并行交付；最终UI接线实际消费R共享header/width生命周期，base改为R。A5/B-Q完整综审保留。

## Design / Spec

ui-model新增纯 `queryVisibleWorkItems(rows,conditions)`，只接safe rows与本地条件。title大小写不敏感includes；status/iteration options仅当前item白名单，缺失首版按安全展示值“—”匹配并明确名为“未提供/显示为空”，不声称区分真实字面值。排序限title/status/iteration/targetDate单列，默认输入顺序；equal以输入index稳定，missing升降都末；合法date-only按字面，非法按缺失，不做Date时区换算。

redacted只在固定尾部占位区保留原安全语义，不进search/sort/options/count，也不拿key作tie-break或DOM属性。新结果数为“当前已加载可读条目：显示x项”，只计item；同步修原status的总数计算，不能旁边仍显示含redacted的query总数。保留partial/stale来源提示，0匹配显示条件为空，不复用EmptyState的confirmed source empty。

条件scope显式为workspaceId+current Planning binding，opaque scopeKey只作内存key不进DOM。refresh保合法条件；切scope同步reset。options撤权后旧facet label/value/chip在当前render前就规范化清除并公告，不等effect；用户自填search可以保留，不能从撤权字段自动补全。display menu用fieldset+checkbox，title必显；默认可显示title/status/iteration/date/engineering，将identity/source/freshness作为可选，安全详情/现有meta仍提供其上下文。clear一次复位search/facets/sort/display；列宽另有明确reset，不误称clear同时改宽。无saved/shared view或Provider写。

## Global Constraints

分支 `feature/table-query`，base为 `feature/table-resize`；原base `feature/table-geometry` Superseded by Decision Log「共享UI接线后的线性依赖」（2026-11-03）。在该分支的工作树根执行验证。用户已授权两路独立方案经第三位综审后持续实施；不重复确认、不自行合并、不改变规划 Status 或 native dependency。文件全集：`docs/README.md`、`docs/exec-plan/completed/2026-11-03-table-query.md`、`packages/ui-model/src/index.ts`、`packages/ui-model/src/local-table-view.ts`、`packages/ui-model/src/work-item-list-view.ts`、`packages/ui/src/table-controls.ts`、`packages/ui/src/table-presentation.ts`、`packages/ui/src/work-item-app.ts`、`packages/ui/src/work-item-list.ts`、`tests/browser/table-geometry.test.js`、`tests/browser/table-query.test.js`、`tests/browser/table-resize-regressions.test.js`、`tests/browser/table-resize.test.js`、`tests/browser/table-rq-integration.test.js`、`tests/contract/ui-local-table-view.test.js`、`tests/contract/ui-table-controls.test.js`、`tests/contract/ui-work-item-detail-browser.test.js`、`tests/contract/ui-work-item-detail.test.js`、`tests/contract/ui-work-item-list-browser.test.js`、`tests/contract/ui-work-item-list-view.test.js`、`tests/contract/ui-work-item-list.test.js`、`tests/contract/ui-workspace-status.test.js`、`tests/fixtures/execution-drawer-browser.mjs`、`tests/fixtures/table-geometry-browser.mjs`、`tests/integration/github-projects-bootstrap.test.js`、`tests/integration/harness-plugin-host-watch.test.js`。owner：query-owner owns ui-model/control leaf; table-integrator owns table wiring。工具栏独立契约测试用于安全输出与原生控件语义；原列表两份契约测试同步可读计数口径，不抹去 redacted 占位。不引入 Provider 读写、规划写入、路由或持久化偏好层。

代码、测试、配置、fixture 新增加删除严格少于800行，文档少于1300行；估计代码610–790，接近790时先查真实重复或重新划分独立闭环，不删必要安全验收。锁文件和生成目录按仓库规则排除。命令以 `pnpm` 简写，实际使用锁定工具链 `npx --yes --package pnpm@10.28.2 pnpm`。计划完成后移入 `docs/exec-plan/completed/` 并更新文档索引；安装证据和工程测试分开记录。

## Plan of Work

Batch 1闭环为safe query及其条件语义。先红测：raw数据仅不可见字段改变→safe投影后matches/order/options/count/DOM完全不变，且故意先raw排序再redact会红；补Unicode、equal/missing/date-only、撤权facet同步清理。实现纯model，再做原生controls和安全scope/reset；最后单owner接table。验证 `pnpm test:file tests/contract/ui-local-table-view.test.js tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list.test.js`、`pnpm test:file tests/browser/table-query.test.js`、`pnpm typecheck`。期望控件state/aria-sort/count可观察、refresh保条件、换workspace/binding清、Provider写0。回滚只丢局部条件保G/R。

Batch 2走生产App/store→safe view→table，在100+行/partial/source empty/zero match/撤权后真实键盘筛选、sort、show/hide、clear；与已集成R复验handle不sort，Host光暗窄宽200%操作实拍。只有G/R/Q与#507安装矩阵全满足，最终consumer PR才可Closes #507，否则Refs #507。该门现已由Outcomes的完整功能rollup接受满足，主控授权最终consumer PR使用Closes #507；旧Refs待验状态被取代。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 不可见值非干扰 | matches/order/facets/readable counts/DOM对secret变更不变，raw-first变异红 |
| 撤权 | 当前render无失效label/value/chip/options，未等effect；清理公告可读 |
| sort/日期 | 同值稳定、missing末、date-only跨时区逐字不变，aria-sort唯一 |
| 状态 | loading/unconfirmed/source empty/no matches/partial各自正确，无source total误称 |
| 生命周期/交互 | refresh保合法条件、换scope reset、菜单键盘可达、一键clear、无Provider写 |

## Progress

- [x] (2026-11-03 SGT) 子项 #516 已建立，独立验收边界与父项区分。

- [x] (2026-11-03 SGT) A5/B-Q与安全行契约核查。
- [x] (2026-11-03 SGT) 纯 model 与受控 controls 叶子先红后绿；在 `feature/table-query` 的工作树根执行 `pnpm test:file tests/contract/ui-local-table-view.test.js tests/contract/ui-table-controls.test.js tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list.test.js`，33/33 通过；`pnpm typecheck` 通过，`pnpm run boundaries` 9/9 通过；`pnpm test` 3391/3391 通过。该观察仅为叶子接线前本地证据。
- [x] (2026-11-03 SGT) 串行接线：safe result驱动列集合/宽度/表头排序与aria-sort；显式workspace+binding scope、同步撤权归一和计数口径已完成。
- [x] (2026-11-03 SGT) 真实Provider→SQLite→Host→App的124可读+1占位查询/排序/显隐/clear、Provider读权限撤销与零写路径通过；20个控件组合和G原60几何组合通过。
- [x] (2026-11-03 SGT) 独立R/Q组合：检出test/table-rq-integration，在b0dae4763d9dedc22027dccad696e071a7a238d3观察组合浏览器8/8、完整工程3392/3392通过。
- [x] (2026-11-03 SGT，旧基线历史证据，非当前CSS等价证明) 主控实际安装接受：source8e6c3ff/artifact9a1df7064363f3d98d6fd864059491b410940f4802000b70402ccf3c8f8c6d78，313已加载可读行，组合query精确1、descending、列显隐集合一致，两种reset互不覆盖；实际Host光暗五宽×480共10组合，无页面横溢。

- [x] (2026-11-03 SGT) 当前新CSS组合实际安装与浏览器原生200%九项接受完成；主控接受父#507功能rollup，Gate R1独立。source/artifact及复现见Outcomes。

## Surprises & Discoveries

missing值已压成“—”，不能凭safe string区分真实字面值；明确展示值匹配比回raw更安全。原list status含rows.length，新增readable统计必须一起保持redacted不入总数。

2026-11-03 SGT：frozen 安装成功（33 包均复用），报告 ignored esbuild build script；这不是插件安装或 Host 接受证据。仓库 TypeScript 不含完整 DOM lib，工具栏沿既有 UI 使用结构化 `event.target` 类型，未扩大全局编译环境。

2026-11-03 SGT：默认5列改变旧SSR对8列及逐行新鲜度的假设；显示列后的实际browser保留逐行badge验收。旧手工walk仅提取anchor回调并使用合法测试dispatcher，不能把展示hook当导航行为失败。

## Decision Log

Decision：接受当前新CSS组合的浏览器原生200%九项及Issue #115联合流程，父#507完整功能rollup接受并授权最终consumer PR使用Closes #507；Gate R1仍独立。Rationale：source/tgz/安装字节一致，实际查询/排序/键盘调宽到Markdown、来源关联PR #159与详情展开/还原/Escape后状态保持，补齐旧锁屏导致的组合运行面缺口；不声称原生桌面壳完整接受或VoiceOver已测。Date/Author：2026-11-03 SGT / 主控实际安装与功能rollup接受裁决。

Decision：safe-only纯model、固定redacted尾部占位、显式scope与同步条件归一。Rationale：控制对不可见数据的因果输入，防刷新后的旧facet成为泄漏。Date/Author：2026-11-03 SGT / 独立综审。

Decision：G/R使用native线性stack；Q保持base=G的普通dependent PR，不加入要求线性的同一stack。Rationale：这是G→R、G→Q的真实DAG，工具限制不能制造R→Q语义依赖。Date/Author：2026-11-03 SGT / 主控与独立综审。Superseded by Decision Log「共享UI接线后的线性依赖」（2026-11-03）。

Decision：叶子只暴露纯 `queryVisibleWorkItems`、`defaultLocalTableConditions`、精确类型与 `TableControls({result,onChange})`；scope、列几何与 `aria-sort` 由唯一接线 owner 串行连接。Rationale：不复制 scope 权威、不把 Q 依赖到 R，保留生产浏览器验证的独立门。Date/Author：2026-11-03 SGT / query-owner。

Decision：扩充文件全集见Global Constraints。Rationale：真实Provider权限与写端口、可控safe帧scope/撤权需要既有fixture小扩充；默认列改变的消费者断言改按当前显示语义，保留全部安全非干扰与可选列实际browser检查。Date/Author：2026-11-03 SGT / table-integrator。

Decision：归一结果同步持久化到当前scope的本地条件，并单独保留安全adjusted公告到下一次用户操作。Rationale：当前commit不闪现撤权旧值，后续facet恢复也不能自动复活已清条件。Date/Author：2026-11-03 SGT / table-integrator。

Decision（共享UI接线后的线性依赖）：最终UI交付采用G→R→Q，Q base为R；保留纯model/control叶子已经并行完成的历史事实。Rationale：实际组合出现6处共享header/fixture/消费者接线冲突，同一table owner显式合成后已通过真实交互，最终Q消费R的width owner和header slot生命周期。必要性来自实际共享UI契约与可验组合，不是为了工具串行。Date/Author：2026-11-03 SGT / 主控修订裁决。

Decision：按实际安装query/display/sort、两种reset独立性及光暗五宽10组合接受Q子闭环并归档。Rationale：source/artifact逐字匹配；当时actualHost200%受系统锁屏阻塞、仅有工程矩阵；当前隔离full Chromium原生tab zoom=2的实际组合证据及父#507功能rollup接受见本节新Decision与Outcomes，原生桌面壳和Gate R1边界不变。Date/Author：2026-11-03 SGT / 主控接受裁决。

## Idempotence and Recovery

clear幂等；无数据写或兼容层，revert Q保G/R。若完整query/display超过790，先去真实重复；仍超则将可独立接受display menu闭环另立片，不裁撤权/非干扰测试。

## Interfaces and Dependencies

`VisibleListRow`为唯一数据输入；scopeKey由App显式传至List，计数只认可读行，不把raw field带回。纯model只依赖G column IDs；最终UI另消费R列宽及header插槽，本地columns visibility不是权限权威。

叶子接口：`queryVisibleWorkItems(rows: readonly VisibleListRow[], input?: Partial<LocalTableConditions>): LocalTableResult` 返回归一条件、当前完整安全 facets、匹配行与固定尾部占位、可读 loaded/matched counts、`hasQuery` 和不复述旧值的 `conditionsAdjusted`。`LocalTableConditions` 包含 search、nullable planningStatus/iteration/sort 与 visibleColumns；sort 只允许 title/planningStatus/iteration/targetDate 的 asc/desc。`TableControls` 是完全受控组件；facet DOM option 用 `all` 与 `value:<safe-label>` 区分全部和真实同名字面值。接线必须消费返回的归一条件，不能把未归一 input 的旧 label 再渲染。

## Outcomes & Retrospective

当前新CSS组合安装接受（2026-11-03 SGT）：组合source `dca3e6f7844dbef7ce0da94f3ff080dadc65f0f0`，tgz SHA-256 `cf710bec2ec6a5a296facea9b1ba174599b60c2a53cfae3918520fca077a9509`，安装文件与该tgz逐字相同。使用隔离的full Chromium `156.0.8078.4`，通过浏览器原生`tabs.setZoom`设置2并以`tabs.getZoom`回读2，无页面CSS或应用状态覆盖。联合流程实际CSS viewport为720×480；另测light/dark×实际720×480、640×480、320×480、320×320，共9cases PASS、errors为空；表格样本均无页面X溢出。这是当前已安装Host的浏览器运行面接受，不能表述为原生桌面壳完整验收或VoiceOver已测；Gate R1仍按`docs/architecture/release-gates.md`独立判断。

复现上下文：固定上述组合source并build/pack，核对tgz SHA并安装后比对安装字节；在同一Host工作空间快照用隔离full Chromium原生tab zoom=2，浏览器视口请求1440×960、1280×960、640×960、640×640分别回读实际CSS viewport720×480、640×480、320×480、320×320，再按两主题重复。联合流程在实际720×480从Issue #115搜索、排序、键盘调列宽进入含6个heading/40个code节点的Markdown详情，读取来源关联PR #159，完成详情展开/还原与Escape，返回列表后查询及列宽保持。原CSS字体放大矩阵仍是独立工程证据，不能替代这次浏览器原生缩放量测。证据路径：`.superpowers/ui-505-508-20261103/installed-host-combined-ci-fix/browser-zoom-acceptance/report.json`。

父#507功能rollup：主控依据上述当前组合安装、原生浏览器200%联合流程及已有各片独立证据接受功能汇总；最终consumer PR已获授权使用Closes #507；本记录不执行远端Issue状态写入，也不替代Gate R1、原生桌面壳完整验收或VoiceOver。查询/排序与R键盘调宽跨Markdown、原生来源关联和详情展开/还原/Escape保持，功能范围不再沿用旧的“组合安装未验”状态。

Q实际规模及工程验证已记录；Q单片仍不独立证明父#507。当前组合安装九项接受已补齐并获主控接受父#507功能rollup；Gate R1及原生桌面壳完整接受仍独立。

叶子已完成纯计算和安全静态控件验收；生产 App/store 接线、scope 切换、真实键盘与主题矩阵、Provider 零写和 R/Q 组合仍未验证，不宣称 PR 已完成或可 Ready。Superseded by 本节串行接线工程证据（2026-11-03）。

串行接线工程证据：在feature/table-query检出运行 `pnpm test`，2026-11-03 SGT本批工作树观察3391/3391通过；`pnpm typecheck`与`pnpm run boundaries`（9/9）通过，`node scripts/workflow-check.mjs`无findings。`pnpm test:file tests/browser/table-query.test.js tests/browser/table-geometry.test.js` 验证实际查询、安全scope、20个控件组合及显式选择全部列后的60个几何组合，期望全部通过。`TABLE_QUERY_EVIDENCE_OUT=<evidence-dir> pnpm test:file tests/browser/table-query.test.js` 保存矩阵与截图。原始来源总数不再包含redacted；App连续计数公告另有占位不入数回归。

R/Q组合使用独立本地检出 `.worktrees/table-rq-integration` / `test/table-rq-integration`，以Q接线提交0c766681122f45e2e2128e1f4d0fc45ce432583f与R提交c6dffbc9400949ffd1bf8b9b1d7d763f0e4e2911显式合成共享接线；当时Q真实base保持G；该base结论Superseded by Decision Log「共享UI接线后的线性依赖」（2026-11-03）。2026-11-03 SGT @ b0dae4763d9dedc22027dccad696e071a7a238d3，运行 `pnpm test:file tests/browser/table-rq-integration.test.js tests/browser/table-query.test.js tests/browser/table-geometry.test.js` 观察8/8通过，覆盖实际同表头resize/sort、两种reset、隐藏活动handle与scope清理、20组合；`pnpm test` 3392/3392通过，`pnpm typecheck`通过。组合没有发现需要留在测试分支的实现缺陷；只有共享header/state/fixture的显式组合接线。当时真实安装Host仍由主控接受；Superseded by本节实际安装接受边界（2026-11-03）。

## Bottom Change Note

2026-11-03 SGT：综合A5/B-Q，固定redacted总数、展示值missing语义及binding级scope清理；依据主控裁决补G/R native stack与G/Q普通dependent PR的DAG映射。

2026-11-03 SGT：完成 query/control 叶子红绿与本地回归，记录冻结 API 和接线边界；扩充 Global Constraints 以覆盖必需工具栏测试和原可读计数回归，保留生产接受未完成状态。

2026-11-03 SGT：接入真实App表格与显式scope，补源权限/写端口与安全投影浏览器、默认列消费者回归；文件扩充见Global Constraints；此处“真实安装未验”仅为当时状态，已被Outcomes当前组合接受取代。

2026-11-03 SGT：记录独立R/Q组合的确切本地提交和真实浏览器/完整回归；此处真实Host未接受及Q→G基线均为历史状态，已分别由Outcomes当前组合接受和共享UI线性依赖Decision取代。

2026-11-03 SGT：依据实际共享UI契约与6处组合冲突，主控修订Q最终base为R；在旧spec/Decision原处标注Superseded。原Q plan/leaf/实现提交及证据由恢复引用完整保留，未发布提交将整理后安全迁移。

2026-11-03 SGT：在完整backup锚点保留旧plan/leaf/实现后，未发布能力收敛并迁移到R修复基线6b4ad9d；按已验证组合语义处理6处共享接线，R浏览器相容测试先显式显示可选身份列，组合回归测试进入最终Q交付。

2026-11-03 SGT：最终R基线6b4ad9d上的Q能力提交b699cd5，在同一检出运行全部表格browser14/14通过（含R两条P2反例与实际sort/resize），完整`pnpm test`3392/3392通过；typecheck、boundaries9/9、workflow/disclosure/size/diff检查通过。功能代码与测试保持该证据树，仅补本条活计划记录；当时真实Host仍未接受；Superseded by本节实际安装接受边界（2026-11-03）。

2026-11-03 SGT（旧基线；不用于当前CSS等价）：实际安装source8e6c3ff60bc974c3967597bb3cd97fd0be1b3c74/artifact9a1df7064363f3d98d6fd864059491b410940f4802000b70402ccf3c8f8c6d78逐字匹配。313已加载可读条目经title/status/iteration条件精确匹配1；header aria-sort=descending；showfreshness/hideiteration时col/header/row同为5。Q clear恢复条件/默认显示且保留R配置328，R reset320保留Engineering查询7匹配；局部0匹配与source unconfirmed/last-known提示分开。实际light/dark×1440/1200/1024/640/320×480共10组合，全部5col/header/cells、无页面横溢，sticky Canvas分别RGB255与18，table client height105/110。

2026-11-03 SGT（历史未测状态，已由Outcomes的新组合浏览器原生200%接受取代）：当时实际Host200%受系统锁屏阻塞；Q20/G60/R20/RQ20仅为工程200%矩阵，不能把该旧记录称为nativezoom实测。主控授权按此分界归档Q子项；父#507 PR范围与Refs/Closes由人类范围裁决，不随本计划归档自动关闭。G/R夹具更新与计划归档阶段，Q产品packages/apps/manifest/lock曾与原8e逐字相同；该旧等价已被CI生产几何修改推翻，不适用于当前CSS；旧plan/leaf/接线与R基线历史由backup保留。

2026-11-03 SGT CI复查：继承G传统滚动条几何修复，并保留全部列的窄宽焦点回归；列名合同按专属label span内的文字或真实sort button文字提取，不再泛化删除标签。默认五列与安全/转义断言保留；本地列表合同与bootstrap集成21/21、完整Browser24/24、typecheck通过，远端checks待新head发布复查。旧安装artifact仍只证明旧基线；当前几何的重新安装已由Outcomes的新组合记录完成，不恢复旧包等价结论。

2026-11-03：本会话独立 MMP 全层评审 #522 完成，矩阵及真实验证见 `docs/review/pr-522-mmp-review.md`；本层未发现新增 P0/P1/P2/P3。人类本次直接授权本会话负责本 PR 的后续修复、独立复评、归档、提交整理、issue 核对及当前门禁通过后的 rebase merge，替代旧交付阶段“不自行合并”限制；不覆盖 Planning Status、原生依赖或 R1 裁决。此计划已在 completed，无需另建重复实现计划。
