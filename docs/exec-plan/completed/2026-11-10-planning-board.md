# 真实只读 Planning Board ExecPlan

> 状态：Completed；Batch4 修复、独立复评、公开证据及观察头远端门已完成；本轮按当前 head 执行 rebase merge，#599 安装人验独立。
> 原页首“Active；固定v3产品实施与本地验证已完成，待独立验收及发布”已 Superseded by 本页 Progress 与 Batch 4（2026-11-11），保留首轮复评未通过事实。
> 创建：2026-11-10
> 范围：#605授权已加载Planning的只读Board，不关闭 #145完整能力
> 规范：根 `PLANS.md`；关联 #603、#604、#145、#599

## Purpose / Big Picture

用户可在真实当前Planning规范状态列扫描工作项，用同一查询筛选并打开同一个详情，清楚知道只显示已加载授权子集及其新鲜度。最小证据是生产Provider→SQLite→Host→client→ui-model→UI组合浏览器里实际分组、键盘开关详情/回焦、切view保留query、权限撤回立即消除秘密和零业务写入；同时复现已接受Board视觉。

## Context and Orientation

`packages/ui-model/src/work-item-list-view.ts`是读取/权限状态的唯一归约点，`rowView`在redacted早退后复制安全字段；源基线982517c安全行只有显示文字`planningStatus`；前层604计划先暴露稳定规范key，本层开工必须回读其实际接口。`local-table-view.ts`的 `queryVisibleWorkItems`已从安全item计算facets/count并同步清理撤权facet。`packages/ui/src/work-item-list.ts`拥有唯一query及列宽；ProjectPage拥有局部mode、navigation、唯一detail与opener。沿用这条事实链，不再订阅Provider或持有last-good缓存。

计划路径为 `docs/exec-plan/completed/2026-11-10-planning-board.md`；分支 `feature/planning-board`、工作树 `.worktrees/planning-board`，PR base `feature/release-detail-settings`。具体参考在 `docs/product/release-visual-target-v3/README.md`及handoff；此前用户仅认可v2版式而v3尚未接受；此观察 Superseded by Decision Log（2026-11-10）的固定v3批准；只有人类点名接受具体v3版本/hash后开始产品实现，#604共享视觉可用后再落地此后继层。独立PR表示可验收/回滚，不表示main-based并发。

## Design / Spec

用户未接受v1整体参考；v2仅版式获“板式设计可以”，olive颜色被否决。v1的28px标题/69px短行/紫pill/大列井/游离能力栏均为历史候选，Superseded by 本计划Design / Spec与Global Constraints（2026-11-10）。v2早期56px表述 Superseded by 实际冻结58px短行（2026-11-10）；保留已接受v2的实际几何，v3只修颜色。初稿时完整v3具体版本/hash的人类同意仍缺失；此观察 Superseded by Decision Log（2026-11-10）的具名v3批准。设计接受仍不代表未执行的工程完成或安装验收。

前层604已提供安全item的 `planningStatusKey: NormalizedStatus`（为v3完成冗余色标，guard与redacted反例已在前层），本层不重复生产/归一化；仅Unknown且有原生显示名时复制可选 `nativePlanningStatus`，redacted始终只有kind/key。由Host已有规范状态显式投影，不调用normalize从标题/中文标签/CI猜值，不扩Provider/Host/schema。

新增纯 `derivePlanningBoard(rows)`只消费query结果的安全item，固定顺序Todo、InProgress、Blocked、Done、Canceled、Unknown。只输出当前过滤后存在的规范组；Unknown卡内显示原生名+未映射或明确未知。已支持规范状态词汇不是完整原生option schema；本轮不请求/声称所有原生空列。筛选后无item显示明确筛选零/真实空，不保留旧列；count只数可见item，redacted不增卡/count/group/AX/DOM文字。工程提示独立footer，failed/passed/merged不改变列。

`WorkItemListPage`保持同一个挂载实例，新增受控 `presentation: 'table' | 'board'`，query state及scope reset留在原owner，body renderer选择table或Board。loading/unavailable/stale/partial/notice与计数继续走同一view，Board不另算读状态。table-only宽度/显示列工具在Board隐藏，search/status/iteration/sort继续共用；切List/Board保留query和安全选择，不触发Provider请求。Delivery原body替换路径保持原合同。

将前层已安全标记的TitleLink抽到小 `item-link.ts`供两view，保留真实href、普通左键open、修饰键/中键浏览器语义与键盘Enter；不可整卡button套anchor。共享基础 #614 已在scoped route后透传 `ItemNavigation.currentItemId?`，Board只在kind=item后比较，输出boolean class与link aria-current；不新增raw key的data/id/title/ARIA文字属性（既有安全item href继续保留），也不给redacted添加selected marker，不解析href/另存selection。ProjectPage继续唯一route/detail/opener，关闭时原卡仍存在回原opener，否则回安全heading；撤权不通过关闭再开逃避安全状态。

列背景透明、16px间距，卡padding12px/gap12px，源身份—标题—真实iteration/date—工程footer决定自然高度，不固定144px或撑空白；selected不复制实体。1024内有标签可聚焦的局部水平/纵向滚动不撑根；390按同样组语义纵向卡片，不另持业务状态。长标题自然增高，全文通过真实链接/detail可访问。readonly显式，无拖拽手柄、WIP/aging、analytics或Planning写回。空/partial/offline/denied均用真实view说明，offline只保留已经授权且明确stale值。

v3仅消费Host CSS角色，不import theme JS、不注册/覆盖root主题、不加明暗检测或主题store。静态公开包默认色仅作图像身份，不把hex写进生产：canvas=`--dsw-alias-bg-base`（Light #FFFFFF / Dark #151517），surface=`--dsw-alias-bg-layer-1`（#FFFFFF/#232324），hover=`--dsw-alias-interactive-bg-hover-solid`，正文=`label-primary`（#0F1115/#F9FAFB），必要次字=`label-secondary`（#61666B/#CFD3D6），内容/卡边=`border-l2/l4`。selected=`bg-multi-select`（#F5F6F7/#212123）加2px中性secondary边标；primary使用`button-primary-fill/hover`和`button-primary-foreground`整对角色，focus独立使用Host ring色/宽（默认business-primary蓝），不把选择涂成accent或success。

缺role时canvas/surface回退Canvas、正文/必要次字回退CanvasText，primary回退成对ButtonFace/ButtonText，细线/hover沿既有中性轻混合。必要input/select边界由主字与layer1作54% srgb混合；缺color-mix时CanvasText边界。小链接用中性必要文字与link角色下划线，保留href/修饰键；success/warn/error只作冗余标记，必要状态词仍用主/次文字。Light蓝字及success绿字不承担12–14px必要文字，4.49763的红字不能舍入4.5冒充通过。实际Host可覆盖默认值；computed主题/键盘/200%和可访问性须在真实候选另验，静态色对计算不代表安装或整页WCAG通过。

## Global Constraints

唯一文件集与gross技术预测如下，新增/删除/测试/fixture/config均计：

| 路径 | 预测 |
|---|---:|
| `packages/ui-model/src/work-item-list-view.ts`仅Unknown原生label投影 | 12 |
| 新 `packages/ui-model/src/planning-board.ts`与`index.ts` export | 48 |
| 新 `packages/ui/src/work-item-board.ts`含局部样式 | 165 |
| 新 `packages/ui/src/item-link.ts`与原link删除 | 44 |
| `packages/ui/src/work-item-list.ts` | 48 |
| `packages/ui/src/work-item-project.ts` | 30 |
| `packages/ui/src/table-controls.ts` | 20 |
| `packages/ui/src/work-item-app.ts`仅修正共享partial说明 | 2 |
| `tests/contract/ui-workspace-status.test.js`既有modal说明期望 | 6 |
| `tests/contract/ui-planning-board.test.js`与安全投影既有断言 | 102 |
| 新 `tests/browser/planning-board.test.js` | 215 |
| `tests/fixtures/execution-drawer-browser.mjs`及`table-geometry-browser.mjs`的必要场景 | 60 |
| **技术目标** | **752** |

MMP 修复继续限定 `work-item-list.ts` 的 `bodyOf`、`table-controls.ts` 与 `tests/browser/planning-board.test.js`；不修改表格/焦点/宽度或共享 fixture。作者证据追加到 `docs/review/pr-612-mmp-review.md`，保留其首轮全文。

文档文件集为本计划、`docs/README.md`索引、`docs/development/plugin-bundle-evidence.md`、`docs/product/planning-board-evidence/README.md`与选定静态PNG，目标250–450且严格<1300；技术必须严格<800，不加依赖/配置/兼容/迁移。若新增必要路径先修订此唯一集合和预测，每次结构变更与首个RED后测实际gross加剩余必需工作，完整可信上界到800先停止重估，不能删撤权/焦点/composed证据或压行。单UI/DTO owner串行写，独立最终验收者接手前显式交接，不与 #604并发写共享单元。不得改Status/native依赖或任何上游Planning事实；公开数据和路径脱敏。

## Plan of Work

### Batch 1 · 前层准入与 Draft

**最小闭环**：精确依赖/预算和issue关联可审阅，尚未产品编码。
**涉及文件**：本计划、文档索引。

确认 #603具名版本接受，#604视觉系统/相关测试可用，建立后继隔离分支。本次准入观察：A当前代码与视觉独立接受并Ready；B在8268f7b组合树上的完整3961测试、74浏览器、独立代码和视觉交互均通过，两个窄200%问题已局部复核关闭。B最终证据/发布与前层纯文档归档并行，运行态接口冻结，Board不会写B文件。既有Draft #612已base为 `feature/release-detail-settings`并关联605；先更新完整plan与body，body含 `Closes #605`、ExecPlan+Batch、真实未实施状态、风险与回滚；回读head/base/closing issue/metadata。未满足门只允许读证据与完善计划，不能执行产品TDD或实现。

在检出 `feature/planning-board` 的工作树根运行；以下发布命令在final push后再次使用，计量始终相对实际PR base：

    git diff --check feature/release-detail-settings...HEAD
    node scripts/rule-checks.mjs disclosure feature/release-detail-settings
    node scripts/rule-checks.mjs size feature/release-detail-settings
    git diff --numstat feature/release-detail-settings...HEAD
    gh issue view 605 -R SingularityKChen/harness-projects --json body,state
    gh pr view 612 -R SingularityKChen/harness-projects --json number,url,headRefOid,baseRefName,isDraft,closingIssuesReferences,reviewDecision,statusCheckRollup
    gh pr checks 612 -R SingularityKChen/harness-projects

期望：Draft、base正确、closing issue含605、敏感扫描/diff通过；人工汇总技术<800/docs<1300，仓库1000脚本不替代本次限额。required checks必须最终通过，Draft时只记录真实状态。
**回滚**：保留plan-only Draft或撤销本分支提交，不更改前层。

### Batch 2 · RED→GREEN真实Board

**最小闭环**：安全分组到真实浏览器navigation/权限闭环。
**涉及文件**：安全投影、新纯helper、Board renderer、共享link、List/Project wiring和对应测试。

先写纯反例：Todo规范key配原生“Done”仍在Todo；工程failed/passed/merged切换不移动；Unknown+native与无native不冒充规范列；source-qualified同编号不混淆；redacted秘密title/id/status完全不能进入组/计数。验证RED由于尚无接口/行为失败，再实现安全字段与小helper。

先写composed browser新失败例，再接Board renderer与mode。复用真实production carrier的query种子、inspect账单、hold/revoke控制，不能另造App/store。实际键盘Tab→Enter开唯一detail、Escape回卡，过滤或撤权令opener消失则回heading；同一filter切List/Board保持，scope切换清空。验证view切换前后read/create/write计数不变。撤权/迟到回复使用真实barrier，必须同帧撤cards、native labels、source number、count/groups及失效facet，释放旧回复不回流；offline正控保留授权stale并清晰说明。

**验证**：本批唯一测试命令组，缺依赖/Chromium按 `tests/browser/README.md`准备，不skip：

    pnpm test:file tests/contract/ui-planning-board.test.js tests/contract/ui-work-item-list-view.test.js tests/contract/ui-local-table-view.test.js
    pnpm test:file tests/browser/planning-board.test.js tests/browser/table-query.test.js tests/browser/detail-expand.test.js tests/browser/workspace-read.test.js tests/browser/delivery-overview.test.js
    pnpm typecheck
    pnpm boundaries

期望：新测试有明确RED记录，实施后GREEN；所有source/权限/布局/键盘回归通过。Capture实际light/dark1440/1024/390、长卡、empty/partial/unknown与已接受reference对照；内容不溢出Host根，只有局部scroll。静态fixture不能替代真实composed新场景。
**回滚**：revert本批仅移除Board与扩展字段，List/Delivery/唯一detail仍可用；无数据回滚。

### Batch 3 · 独立对抗验收、重构与 Ready

**最小闭环**：当前head的完整Board能力及真实门禁齐备。
**涉及文件**：本计划及必要同owner重构。

未参与A/B设计的最终验收者逐条审查issue、真实composed证据、zero writes、redacted/迟到回复与视觉；交接后允许必要refactor，复用Batch2验证，保持单owner/query owner。整理commits、发布检查、严格预算后final push；历史重写先backup ref并走精确lease专家流程。

本地包体在已登记clean父层与候选上使用同一工具/config实测；累计对照设计父层。以下在本叶工作树根运行，先确认三个分支检出对应实际接受版本，路径使用realpath，不使用含`..`的source-root：

    board_root="$(pwd -P)"
    board_base="$(realpath ../release-detail-settings)"
    board_design="$(realpath ../release-visual-target)"
    pnpm --filter @harness-projects/app-harness-plugin exec node "$board_root/apps/harness-plugin/scripts/bundle-report.mjs" --source-root "$board_base" --out "$board_root/.superpowers/bundle-board/base"
    pnpm --filter @harness-projects/app-harness-plugin exec node "$board_root/apps/harness-plugin/scripts/bundle-report.mjs" --source-root "$board_root" --out "$board_root/.superpowers/bundle-board/head" --base-report "$board_root/.superpowers/bundle-board/base/report.json"
    pnpm --filter @harness-projects/app-harness-plugin exec node "$board_root/apps/harness-plugin/scripts/bundle-report.mjs" --source-root "$board_design" --out "$board_root/.superpowers/bundle-board/design"
    pnpm --filter @harness-projects/app-harness-plugin exec node "$board_root/apps/harness-plugin/scripts/bundle-report.mjs" --source-root "$board_root" --out "$board_root/.superpowers/bundle-board/cumulative" --base-report "$board_root/.superpowers/bundle-board/design/report.json"

期望：source.head逐一对应锁定版本、dirty=false，raw/gzip/pack及input/external差值有解释、React仍external，无主题/Loader变化。静态参考与source证据不代替安装验收。


复用Batch1命令回读当前head/base、issue、全部checks；GraphQL `repository.pullRequest.reviewThreads`完整分页确认实质线程已解决。实际required Fast Gate通过才用 `gh pr ready`且显式 `-R SingularityKChen/harness-projects`，不merge。计划全部验收后移completed、更新索引；记录 #145完整能力与 #599安装人验仍未成立。
**回滚**：独立revert本PR移除Board入口；前层视觉及既有List/Delivery继续可用。

### Batch 4 · MMP 反例修复与独立复评交接

**最小闭环**：同一 confirmed read 下零授权内容的 List/Board DOM 与 AX 等价；Board 清除只重置共享查询；固定规范列序下说明组内排序并诚实保留从 List 继承的规划状态排序；归档状态与实际进度一致。
**涉及文件**：见 Global Constraints 的 MMP 修复集合。
先运行新增三个 composed 浏览器反例并确认 RED；页面页首与已完成 Batch3 的矛盾以本地文档核对确认。`bodyOf` 改用 `loadedReadableCount` 选空态；不改变 mixed、loading、denied、stale 或 filtered-zero 的读状态 owner。Board clear 保留 `visibleColumns`，List 原 reset 合同继续有效。Board 只提供标题/迭代/日期新排序选项，继承的规划状态排序显示为禁选的真实已选标记；仍使用同一查询结果，不额外计算或清空 List 条件。

**验证**：在检出 `feature/planning-board` 的 `.worktrees/planning-board` 根目录复用 Batch2 命令组；新增判别命令如下，期望原实现三个测试失败、修复后全部通过，完整现有 Board 浏览器和消费者亦通过：

    pnpm test:file --test-name-pattern='zero authorized|Board clear preserves|Board explains within' tests/browser/planning-board.test.js
    pnpm test

原首轮评审 `docs/review/pr-612-mmp-review.md` 只追加作者证据；当前提交的独立 MMP 复评、远端 current-head checks 与线程关闭由协调者在串行整合后回读。Ready 历史、旧检查与本地 GREEN 均不替代本轮复评，更不构成 #599 或 R1 接受。
**回滚**：撤销本批提交恢复原候选；无 Provider 写入、数据迁移或规划状态变更。

## Validation and Acceptance

Batch2的反例证明规范规划authority、redacted不泄露、共享query/route/detail与真实withdrawal/held reply；实际captures和独立设计审视证明对应reference外观。Batch3证明当前精确head的远端门禁/issue/线程闭环，才称Ready。不能声明全原生状态完整、全Kanban、安装Host人验或R1释放。

## Progress

- [x] (2026-11-10 15:08 SGT) 具名v3人类设计门已满足，manifest固定；产品RED/GREEN与当前版本工程验证仍须实际执行。

- [x] (2026-11-10 SGT) 既有Draft #612已关联605并以完整 #604分支为base，plan-only Fast Gate通过。
- [x] (2026-11-10 SGT) 独立重核v3透明列/自然卡高、typed安全分组和前层currentItemId接口；见Global Constraints。
- [x] (2026-11-10 SGT) Batch1：具名v3已批准；冻结父层 `8268f7ba` 已接受，产品分支从 `558ac7bc`实施。首RED时技术实际45行，完整上界718行；不重放或改写父层。
- [x] (2026-11-10 SGT) Batch2：模型首RED为缺失分组接口；浏览器首RED为缺失Board入口。安全分组、共享query/唯一详情、真实composed权限/abort旧baseline/zero writes（旧例不证明迟到响应抵达，见round1）、自然卡高与12组响应矩阵已GREEN；37条窄合同、15条共享notice合同、27条浏览器、typecheck与9条边界通过。完整`pnpm test`最终1553 contract + 2185 integration + 226 e2e，共3964条通过；首次contract因两条既有旧说明期望失败，精确更新后重跑通过。
- [x] (2026-11-10 SGT) Round1：V1短链接22px与I2双重zero说明先RED；最小44px anchor/唯一global zero状态后29条受影响浏览器、52条合同、typecheck与9条边界GREEN。I1保留原abort例，新增真实旧Provider成功响应返回后当前权限复核与轮次栅栏拒绝两例；Provider returned=1、迟到unary真实解析、SQLite及UI持续脱敏，业务写账单为空。新CSS的40张PNG独立归f23候选；独立scoped代码、视觉、交互及identity均接受，I1/V1/I2已关闭。
- [x] (2026-11-10 SGT) Batch3：全新独立整体Spec/Quality/Whole capability均APPROVED，无未结finding或必要重构；首次发布dd67a525当前base22db967、required Fast Gate、双向closing605、metadata与完整threads均通过后置Ready。归档后仍按Batch1命令精确回读最终head，未merge。

- [x] (2026-11-10 SGT) 原候选39f73d3与纯文档重放4c6ba51d的480文件等价已独立核验，最终父层为22db967；round1实际候选f23b7d3技术gross493。其29条受影响浏览器、52条合同、clean Board6条、typecheck与9条边界通过；40张新图与480源文件、逐图来源经独立复核，已批准参考未改变。
- [x] (2026-11-10 SGT) clean实际B父层→f23生产候选client gzip增1143 bytes、完整UI增4058，Host零增量；输入仅新增三个职责清晰模块，external/React保持原合同。正式源码/图像身份与限制见 `docs/product/planning-board-evidence/README.md`。

- [x] (2026-11-11 SGT) Batch4 作者本地修复：三个新增反例先 RED 后 GREEN；受影响浏览器32、合同39、边界9、typecheck及完整3964测试通过。完整suite仍有两项既有SSR warning；来源、截图及每项根因见首轮评审的追加作者证据。
- [x] (2026-11-11 SGT) Batch4 独立复评和最终组合通过，观察头5771ae92正式批准、全部检查成功、四线程解决；本轮重放只有已批准的前层文档变化，最终文档 push 继续核对当前门；#599独立。

## Surprises & Discoveries

旧740预算为v1估算，Superseded by Global Constraints的v3逐项候选（2026-11-10）。本次renderer增加自然卡高/透明列与角色层次空间，技术目标744（Superseded by Global Constraints的752候选及本节最终493实测，2026-11-10）；前层完成后必须按实际新接口重估，不能假设旧line count有效。typed规范状态改由前层604安全rowView提供，本层仅补Unknown原生显示名，不能按中文格式化文字建列。#604将提供route-derived currentItemId，Board直接复用安全boolean选择；不再另造selection chain。

原watch barrier测试会在断连时取消旧流，不能证明frame抵达客户端；该过强解释已在原执行记录原处标Superseded。本轮改用真实同Host/Core的成功Provider响应先hold、既有bootstrap新round确认拒读、再release，实际返回及真实remote解析均可观测。当前权限门与epoch/round门分别拒绝两个真实路径；没有为测试某个内部code改生产保护。

历史39完整3964测试含两条既有 `useLayoutEffect` SSR警告（reflow与plugin artifact的服务端渲染测试），不是零warning；本叶未新增layout effect。M1按真实边界披露，功能失败与既有日志噪声分开；f23仅重复受影响窄验证，不冒称完整suite在该新head重跑。

MMP 首个 composed 反例证明零可读分流不只影响 Board：List 的全脱敏占位也能区分空快照。因此最小修复在既有 `bodyOf` 入口统一空态，保留安全 DTO 和 mixed 占位合同；未新增事实源。修复前观测包含真实 empty/all-redacted HTML/AX 差异、Board clear 的来源列丢失及规划状态排序选项有效。

## Decision Log

Decision：根据本会话人类“继续评审流程”及原 rebase merge 收尾要求，在 #611/#615 合入后合本叶，仅关闭 #605。Rationale：当前源交付五项验收和所有原意见均已独立闭合；#145/#608/#599及R1保持独立，不新增规划关系或Status写入。Date/Author：2026-11-11 SGT / 人类直接指令，评审协调者记录。

Decision：人类明确批准固定 `release-workspace-v3` 的配色、六面视觉参考与工程交接，并授权开始 #604/#605 的TDD实施。原文：“批准 v3，开始实施”。对象manifest SHA-256：`d714cea12faa96bb6411c4e19c3712914af98bad199dd3787cdb419ecbf48c29`。Rationale：这是针对具名完整版本的明确同意，取代此前仅版式认可；没有扩大到merge、Planning Status/native关系或 #599安装验收。Date/Author：2026-11-10 15:08 SGT / 人类伙伴（当前对话），由交付协调者记录。

Decision：继续ListPage挂载/query/width owner及typed规范分组，Unknown卡内native标签。Rationale：来源authority/权限撤回/筛选调整与唯一detail链复用，UI不推native universe。Date/Author：2026-11-10 SGT / independent final spec reviewer。

Decision：v3透明列、自然卡高与Host中性selected+独立focus，使用前层scoped currentItemId。Rationale：视觉改进不需要新状态owner或ID泄露。Date/Author：2026-11-10 SGT / independent final spec reviewer。

Decision：保护 #605<-#604和 #604<-#603 native先决链，仍在现有stack后层串行。Rationale：原“仅接受v2版式”的观察 Superseded by 本节具名v3批准（2026-11-10）；既有native边仍未获修改授权，拆叶A也不等于完整 #604。Date/Author：2026-11-10 SGT / independent final spec reviewer。

Decision：将 `work-item-app.ts` 纳入本叶唯一文件集（预测2行gross），把共享partial notice改为不推断行新鲜度的中性说明。Rationale：真实Provider不可锚定项→Host→store产生partial，已确认可见行仍为当前值；旧notice却泛称最后已知值，违反本叶truthful partial验收。保持同一view/statusText与row stale owner，不增加Board读状态。Date/Author：2026-11-10 SGT / 交付协调者具名裁决。

Decision：将 `tests/contract/ui-workspace-status.test.js` 纳入本叶唯一文件集（预测6行gross），精确更新两条既有modal/恢复合同内三处旧说明期望。Rationale：完整suite显示共享notice的直接消费者仍绑定旧文案；保留公告优先级、恢复一次及timestamp稳定的全部判别，不能放宽断言规避行为。Date/Author：2026-11-10 SGT / 交付协调者具名裁决。

Decision：I1初步机制预期“迟到成功值必须返回stale_revision”已 **Superseded by 本轮实际生产观察**：权限仍不可用时，旧值返回后先经 `bootstrap.ts` 当前权限复核得到 `unavailable/failed`；声明恢复但尚未重新确认时，既有epoch/round栅栏才返回 `stale_revision/failed`。Rationale：不为命中特定内部code绕过正确权限门。使用现有UI refresh与既有 `remote.bootstrapWorkspace` 独立轮次，保持同一Host/Core/SQLite/App，不暴露第二Core或生产调试API；只有Provider返回计数及迟到unary真实解析均确认后才断言不回流。旧watch例只证明abort取消。Date/Author：2026-11-10 SGT / 交付协调者按实际证据修正机制裁决。

Decision：V1仅给Board真实标题anchor至少44px块向命中区，保持自然长卡与12px间距；I2由原query owner识别filtered zero并只保留TableControls一处global说明，redacted-only中性空面、真实来源空/未读/拒读仍各自保留。该零可读分流结论 Superseded by Batch 4（2026-11-11）：相同读取状态下真实空与全部脱敏必须 DOM/AX 等价。Rationale：不覆盖邻近元数据或把整卡改成button，不增加查询/读取状态owner。Date/Author：2026-11-10 SGT / 独立代码与视觉复评后由交付协调者授权round1。

Decision：只按实际交付事实回填 #604/#605 的ExecPlan归档路径、Batch3，以及 #605 原生open PR对应的Engineering；不写规划Status或任何native blocking边。Rationale：字段指针应指向本次已发布归档文档，工程关联只由当前原生PR事实机械推导；发布后回读字段确认Provider ack，不把Ready当Planning接受。Date/Author：2026-11-10 SGT / 交付协调者。

Decision：MMP 修复使用已有可读计数和原 query owner；Board 新排序只作用组内，继承的 List 规划状态排序保留为明确禁选标记。Rationale：不重算查询、不默默重置 List 条件，也不把固定规范组序误称可排序。原交付 Completed 与本轮复评、#599 安装门分别记录。Date/Author：2026-11-11 SGT / 作者本地修复。

## Idempotence and Recovery

测试/control只在每例临时SQLite、loopback和合成外部端口，无业务网络；view切换本身只改局部mode。读证据/测试可重复；按PR查询避免重复开PR。失败保持Draft并修复，不通过Status或native关系“解锁”。出现超预算先重估独立完整切片，保留父验收。不存在数据迁移/删除，恢复为revert；先保护用户其他改动。

## Interfaces and Dependencies

沿用 `NormalizedStatus`六值、`VisibleListRow`判别union、`queryVisibleWorkItems`结果、`ItemNavigation`与WorkItemListView。新helper签名为 `derivePlanningBoard(rows: readonly VisibleListRow[])`，返回只含安全item的有序组与可读数；不得保存实体原对象。Board只消费安全query/body，不调用clock/capability/Provider。组件/字体/token承接 #604，无新库、theme import/Loader扩容。

## Outcomes & Retrospective

已按 Decision Log 取得固定 v3 视觉同意，原交付工程批次与首次 Ready 已归档；2026-11-11 首轮 MMP 复评未通过，修复按 Batch 4 单独交接复评，#599 未接受。该复评等待 Superseded by Progress 与 PR #612 评审记录最终收尾（2026-11-11）：575行最终技术修复已独立接受，77项针对验证与三项归因变异通过，整合后8项组合及类型通过。原“以下工程证据状态仍需实际更新”表述 Superseded by 本节（2026-11-11）。

本叶已实施安全Board、共享标题链接、同挂载query与中性partial说明；独立代码、视觉、交互与图像身份接受均已完成；全新独立整体审查及首次发布dd67a525的当前远端门已完成；归档后的精确head仍须按Batch3回读，source证据不等于安装验收。首RED时技术实际45行、可信完整上界718；round0最终技术实测424行；round1保留全部安全与视觉范围后技术实测493行，低于800硬限额。完整 #145、#599安装验收及 #606/#607保持原范围；任何临时实现债务另记 `docs/exec-plan/tech-debt-tracker.md`，不删证据维持预算。

## Bottom Change Note

2026-11-10 SGT：v3计划保留typed安全query/唯一detail，明确布局部分接受与整套待人审，新增Host角色、自然卡高与安全route selection复用；前层生产key后744候选取代旧740/750并保留实际测量门。

2026-11-10 15:08 SGT：记录明确v3批准与固定hash，移除旧人审阻塞的当前含义，保留预算/真实验证/权限和恢复边界。

2026-11-10 SGT：原完整 #604 因实际806预算门分为 #614基础与详情/设置累计验收；Board实际PR base同步为完成完整 #604 的详情/设置层，仍串行遵守既有 #605 blocked-by #604，不改native规划关系。

2026-11-10 SGT：完整604候选在B8268f7b获本地组合测试与独立代码/视觉接受后，开始Board隔离TDD；原规划Status/native先决不改。最终发布前重放到实际B接受head并按真实base计量；若前层仅文档变化，依生产/fixture指纹记录等价，不冒称在另一head拍照。

2026-11-10 SGT：完成本叶TDD及累计3964条本地测试；真实partial反馈修正共享安全说明，同叶新增其直接合同消费者。独立验收、restack、远端当前head回读与Ready仍由交付协调者执行。

2026-11-10 SGT：round1修复44px触达和单一筛选零结果说明；保留abort旧例，补真实Provider返回与迟到unary拒绝证据。实际门优先于预设stale code，未扩大到生产安全逻辑改写；旧完整suite的两项既有SSR warning如实披露，不以零失败冒称零warning。

2026-11-10 SGT：I1/V1/I2的独立scoped代码与视觉复评均接受，发布20张静态证据并引用原批准参考；补齐实际父层/候选与累计包体及命令，保留完整3964的真实历史身份和SSR warning，当前远端门与最后整体审查仍待完成。

2026-11-10 SGT：全新独立整体审查、首次dd67发布当前Fast Gate/issue/metadata/threads门通过且已Ready，归档本计划并修正文档索引；最后归档head重新跑远端门，Planning Status和native阻塞关系仍不变。

2026-11-11 SGT：新增 Batch4 MMP 修复与逐项 RED/GREEN 交接，页首改为原交付 Completed 与本轮待复评；原首轮意见和 #599 安装门独立保留。

2026-11-11 SGT：核销 Batch4 复评与四线程，补575行最终技术实测和实际前层合入后的纯文档重放；以当前head审批/CI及issue回读进入rebase合并，不改产品或素材。
