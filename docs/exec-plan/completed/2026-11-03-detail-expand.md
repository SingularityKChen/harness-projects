# 详情展开还原 ExecPlan

> 状态：Completed（实现与独立 MMP 评审完成；实际合并、产品发布和 R1 各自回读）
> 创建：2026-11-03
> 范围：Issue #506 的独立能力闭环
> 调查基线：main `957451c684c546ddf8a5d19cb3a23a719940fa9b`

## Purpose / Big Picture

用户把同一详情展开到Host内容区后继续阅读、编辑草稿和等待操作，随时还原。成功最小证据为toggle前后同dialog/body/业务节点身份相等，路由与选中项不变，Provider调用不增加。

## Context and Orientation

现有原生dialog独占modal/focus/Escape，layout observer观察Host root裁剪矩形。当前340px是旧预览宽度，不是新展开契约。两路独立方案均支持同实例模式，详情入口与Markdown接线由同一owner串行应用，功能无语义依赖。

## Design / Spec

drawer唯一local mode为preview/expanded；按钮用“展开详情”/“还原详情”和可见当前模式说明，可用aria-describedby，不把仍显示正文误报为collapsed。只改变class/data/CSS矩形与阅读measure，toggle不showModal/close、不重聚焦标题，不改变key、route、reader依赖或业务树。preview宽度取Host内clamp(22rem,38%Host,32rem)的等价显式数值，极窄时以Host上界优先；expanded严格取clipped Host content rect。列表宽屏占位跟实际preview宽度，expanded不额外挤背景。native sidebar始终在rect外。

header标题min-width:0且动作独立固定组，长title不能把expand/close推走。expanded阅读measure约70–80ch，属性紧凑。保留同一body滚动元素；toggle前捕获scrollTop，新layout后恢复到合法区间，内容变短仅允许浏览器clamp，测试明确这项物理限制。按模式记上次可达读位（旧规则，Superseded by Decision Log (2026-11-03)）；现规则为每次toggle只保留当下body.scrollTop，新layout仅因合法范围变短而clamp，禁止旧模式历史偏移覆盖新阅读进度。不为plain paragraph引入复杂逐文本anchor算法。窗口resize重算几何但不重置mode/draft/pending。另建page/modal、序列化业务状态或OS fullscreen均拒绝。

## Global Constraints

用户明确授权方案综审后直接实施和并行交付；不在批次间重复确认，不自行合并或改变规划 Status。验证命令以 `pnpm` 简写，实际使用锁定工具链 `npx --yes --package pnpm@10.28.2 pnpm`；在本节指定分支的工作树根执行。正文只依赖本计划和仓库代码。完成后把本计划移入 `docs/exec-plan/completed/` 并更新 `docs/README.md`，这些生命周期修改属于本片范围。

分支 `feature/detail-expand`，base为回读main，无Markdown依赖；归档计划 `docs/exec-plan/completed/2026-11-03-detail-expand.md`。受控全集：`packages/ui/src/work-item-detail.ts`、`packages/ui/src/detail-presentation.ts`、`tests/contract/ui-detail-reflow.test.js`、`tests/contract/ui-work-item-detail.test.js`、`tests/browser/detail-expand.test.js`、`tests/fixtures/workspace-frame-browser.mjs`与本片ExecPlan。fixture只修正关闭按钮的量测定位，避免新增展开按钮被误量作关闭动作。owner为detail-integrator。预算代码430–660、文档250–400；硬上限为代码、测试、配置与fixture的added+deleted严格小于800行，文档严格小于1300行。不改client/router/Provider/Storage；不与其他owner同时改同一详情fixture区域。

## Plan of Work

Batch 1闭环为连续实例上的可达展开/还原。先加失败测试：body identity、业务节点增删计数、draft、未决promise完成、focused element、route/selection、scrollTop与refresh/read/mutate spies。实现mode、Host矩形和header动作，局部scroll恢复。主要文件detail-presentation及drawer header。验证 `pnpm test:file tests/contract/ui-detail-reflow.test.js tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-browser.test.js tests/contract/ui-work-item-list-browser.test.js tests/browser/detail-expand.test.js`、`pnpm typecheck`；期望全绿，toggle所有Provider计数新增0。回滚恢复preview布局，不改变业务状态模型。

Batch 2闭环为安装候选在真实Host矩形内工作。pack候选，实拍1440/1200/1024/640/320、短高、200%文字、light/dark、Host resize/scroll；量测dialog四边包含关系、动作bbox/焦点与至少一完整正文行。先保存draft并挂起真实受控操作，toggle后完成，核结果仍同实例。恢复原包可回到已知良好呈现。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 同实例/route | dialog/body/业务section严格相等、MutationObserver节点增删计数不增、route/selection逐字不变 |
| reading/draft/pending | preview0→展开阅读N→还原仍N，反方向新进度同样保持；仅新range物理clamp单列证明；draft和promise结果同实例继续 |
| 不重读 | toggle不新增refresh/read/Provider写调用 |
| modal/focus | toggle不跳title，Tab包含，一次Escape close一次，回有效opener或已有fallback |
| 几何 | dialog在Host内容visible rect内、导航无覆盖、long title不挤动作、短高非padding-only body |
| 生产接受 | 真实安装source/artifact一致，矩阵截图及操作记录 |

## Progress

- [x] (2026-11-03 SGT) A/B完整设计与生产dialog契约核验。
- [x] (2026-11-03 SGT) Batch 1：三个生产组件浏览器测试先红（缺少展开操作与mode），实现后全绿；增加既有App reflow矩阵回归，相关组合命令24/24通过，typecheck通过。执行上下文为检出 `feature/detail-expand` 的工作树根；验证命令见Plan of Work。
- [x] (2026-11-03 SGT) P2局部修复：在640×480真实Chromium先复现新阅读进度被旧模式覆盖，删除历史offset权威后，两项读位/物理clamp测试由2/2红转2/2绿，Plan of Work相关组合25/25通过，typecheck通过。同节点/draft/pending/focus/zero-Provider覆盖保持；修复前全仓3385/3385为主控在 `249eeb400b9eaf7312809c05124777bdf299d916` 的证据，本次局部修复不冒称重跑全仓。
- [x] (2026-11-03 SGT) Batch 2：修复 source `08f810778e9725294b4177404e10fd8d4d0b4ba7` 重新 pack/install 到隔离 Web Host `0.2.0-rc.2`，tarball SHA-256 `24260279b383d588fbb621d416a8101db7a61f2bef4bce229462b3c4a797c7c6`，逐文件字节相同。实际640×480中展开读位2804.5→还原2804.5（合法max3905），另验证双向824.5保持与合法clamp；五宽1440/1200/1024/640/320×480展开/还原10组合均记录实际innerWidth/innerHeight与动作边界。640浅色/深色截图、原生Tab/Escape通过。200%字号及draft/pending/零调用由生产组件Chromium证明，未冒称实际安装Host200%接受。运行证据位于 `.superpowers/ui-505-508-20261103/installed-host-detail-fixed/`。

## Surprises & Discoveries

2026-11-03 / 最终八片组合：独立详情fixture原先把所有require都映到React，在组合安全Markdown的官方 `react/jsx-runtime` external后无法渲染dialog。fixture现单独打包官方runtime并接到页面唯一React UMD；缩短正文也改为更新安全view.body，让真实呈现器重渲染，不依赖旧段落class。此修正只涉及受控测试载体，产品源码不变；表格根的有界slot输入由表格owner修正后再验组合。

CSS不remount不能单独证明scroll连续性；滚动合法范围会随宽高变化而clamp，须分开记录。已有短高outer-scroll判据应保留，不能只看宽屏截图。

2026-11-03：既有App reflow探针把header首按钮当关闭动作；新增合法展开动作后会误量。将探针限定为可见文字“关闭详情”，保留原有关闭可达性、完整正文行和outer-scroll判据。实际Chromium覆盖light/dark、100%/200%字号与1440/1200/1024/640（短高320）/320宽度，共40组旧探针路径通过；新几何测试另覆盖Host偏移、scroll、四边viewport裁剪和resize不重置mode。

2026-11-03：首轮测试fixture缺少 `metadata.sourceNames` 导致没有列表入口；补完整fixture结构后，确认真正红因是不存在“展开详情”按钮及mode，而非fixture异常。实现后首次组合运行18/20，两个旧contract依赖新增ref前的序号和340px数值；改为dialog真实ref及新的手算预览几何后24/24通过，未删验收。

2026-11-03T10:26:07+08:00 / 实际已安装Web `0.2.0-rc.2`，source `249eeb400b9eaf7312809c05124777bdf299d916`，artifact SHA-256 `2fecbc69150c8b7f152721f7e08ca6510293ff593bbf0f7668f201a625abd57f`：640×480，详情115从preview0展开，在body按PageDown读到344.5，随后还原到0；目的preview最大合法值3905，本可保持344.5。这是P2语义失败，不是物理clamp；`positions.current[next]` 优先恢复旧模式0覆盖新进度，原per-mode测试只保护了错误假设。修复红测在同尺寸真实Chromium复现0→展开PageDown181→还原0（应181），单列clamp用例也显示旧历史765覆盖当前576。

## Decision Log

Decision：同一dialog与业务树，只增加本地presentation mode；scroll按合法范围保持。Rationale：最小状态半径，直接保护draft/pending与focus。Date/Author：2026-11-03 SGT / 独立综审。

Decision：按mode记录离开时的body.scrollTop，首次进入另一mode复用当前读位；几何更新后限制到新scrollHeight/clientHeight区间。Rationale：保持最近可达读位而不引入文本anchor或业务状态副本。Date/Author：2026-11-03 SGT / detail-integrator。Superseded by Decision Log (2026-11-03)：实际Host证明旧模式偏移会覆盖用户新阅读进度，按用户验收取代该假设。

Decision：每次toggle捕获当下body.scrollTop，新layout后恢复此值；只允许新scrollHeight/clientHeight合法范围不足时物理clamp，删除per-mode历史offset状态。Rationale：Issue #506要求连续保留当前阅读进度；实际安装反例证明“恢复旧模式位置”不满足该要求，用户验收优先于计划假设。保持同一dialog/body/业务树与最小呈现状态，不添加anchor、迁移兼容或资源框架。Date/Author：2026-11-03 SGT / 主控验收裁决与detail-integrator。

Decision：扩充Global Constraints中的既有fixture文件仅修复关闭动作定位。Rationale：主控确认第二动作引入后必须保护原验收语义；不新增业务fixture协议。Date/Author：2026-11-03 SGT / 主控与detail-integrator。

## Idempotence and Recovery

observer重装只清listener/CSS属性，不关闭dialog；unmount照旧cleanup。revert本PR恢复preview，不触数据。多次toggle与resize可重复验证。

## Interfaces and Dependencies

layout observer明确接mode或计算两套CSS变量，mode变化不进入业务refresh effect；showModal effect仍仅mount。M/D最终集成后按最终style顺序再跑窄布局验证，无须建立功能stack。

## Outcomes & Retrospective

Batch 1已实现同一dialog的preview/expanded、Host矩形与78ch阅读measure、独立header动作组及per-mode合法读位恢复（此读位规则已被取代，Superseded by Decision Log (2026-11-03)）。真实生产ProjectPage、drawer和执行表单的Chromium测试证明toggle期间dialog/body/业务section身份和业务节点增删计数不变，草稿、未决提交和路由连续，所有受控外部read/refresh/write计数新增0，原生showModal/close计数不增；未决提交完成后仍由原表单确认。Tab/Escape/入口回焦由真实浏览器和既有contract共同验证。

P2修复改为每次toggle只捕获当前body读位，移除per-mode历史map；局部真实Chromium证据同时保护双向新阅读进度与物理clamp，相关组合25/25通过，独立修复复评3/3通过并杀死旧规则变异。上述精确source/artifact已在实际安装Host证明尺寸、当前阅读进度与光暗呈现。

Batch 2修复后安装验证完成，精确视口记录为 `exact-viewport-scroll.json`、`final-width-matrix.json`；截图为 `final-expanded-640.png`、`final-light-640.png`。安装接受与受控生产组件验收按上文分层；Host原生字号设置仅影响会话，实际安装200%字号未取得，不能以请求的viewport或字号冒充实际量测。托管CI以最终发布head回读为准，R1产品发布门独立。当前最小修复按toggle当下数值读位恢复，未引入block anchor。持久布局偏好和另开窗口不在本片。

## Bottom Change Note

2026-11-03 SGT：综合A2/B-D，收紧同实例及scroll可达范围语义，避免无证据声称阅读位置已保持。

2026-11-03 SGT：记录Batch 1实际红绿、既有probe定位修正、窄范围验证与真实安装待验；计划保持Active。

2026-11-03 SGT：以真实已安装Host反例在原spec/decision/outcome处标记旧per-mode规则被取代，改为每次保当前读位，仅允许物理clamp；补相同操作序列的红测和单列clamp证明，待修复后主控重装接受。

2026-11-03 SGT：最终修复经独立复评和精确source/artifact实际重装，完成可达几何与读位验收；保留实际安装200%未测边界，归档本计划。

2026-11-03 SGT：八片组合暴露的fixture runtime与正文缩短输入已回归到本片测试owner修正；保持产品实现和真实安装验收边界不变。

2026-11-03：本会话独立 MMP 全层评审 #513 完成，矩阵及真实验证见 `docs/review/pr-513-mmp-review.md`；本层未发现新增 P0/P1/P2/P3。人类本次直接授权本会话负责本 PR 的后续修复、独立复评、归档、提交整理、issue 核对及当前门禁通过后的 rebase merge，替代旧交付阶段“不自行合并”限制；不覆盖 Planning Status、原生依赖或 R1 裁决。此计划已在 completed，无需另建重复实现计划。
