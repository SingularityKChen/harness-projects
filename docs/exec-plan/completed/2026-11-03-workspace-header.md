# 工作区首屏与状态披露 ExecPlan

> 状态：Completed；创建：2026-11-03；规范：根 `PLANS.md`。
> 闭环：Closes #528；Refs #446、#427、#449。
> 执行上下文：检出 `fix/workspace-header` 的 `.worktrees/workspace-header` 根目录；独立以 `main` 为 PR base，无 stack 前提。

## Purpose / Big Picture

用户打开工作区后，先看到一个工作区身份、一个页面标题和能直接操作的工作项工具栏。正常宿主连接与来源读取事实用紧凑状态行表达；来源、映射、完整确认时间与诊断可用键盘展开；具体异常即使折叠也看得见。最小证据是生产组合的真实浏览器首屏、键盘披露与异常状态断言，以及受影响契约全部通过。

本 child 只完成上述工程闭环。#446 的具体视觉参数人类确认、#449 的精确安装产物 UAT、#427 的完整 Core 质量验收继续由原验收者判断；自动化与 PR Ready 都不能替代它们。

## Context and Orientation

调查基线为 2026-11-03 SGT 的 `main @ f5ae377d98c43ed216f680cb72e5f35d73a2b8e1`。#446 的 2026-11-02 评论明确要求紧凑状态、键盘披露、工具栏去重与可读时区时间；它延续已冻结的导航与 Host 主题，不要求重新选择视觉方向。

`WorkspaceStatusPanel` 订阅 setup/read/refresh/mapping/repository 快照并调用既有 `deriveWorkspaceStatus`；`WorkspaceSetupGate` 拥有设置导航与返回；`WorkItemApp` 拥有列表/详情路由；`WorkItemProjectPage` 组合唯一抽屉；`WorkItemListPage` 输出列表标题、上下文和表格。目前身份、来源和时间在这些层重复，刷新又占独立行。`packages/ui/src/detail-presentation.ts` 的 float 与 `table-presentation.ts` 的局部覆盖并存，不能仅凭 float 字符串认定全部空白根因。

实际生产调用链是 StatusPanel → SetupGate → WorkItemApp → ProjectPage → ListPage；导出名或独立 fixture 不证明必须保留旧呈现。既有表格几何、列控制、Markdown 与详情展开已经合入，相关浏览器测试是本批回归边界。

## Design / Spec

采用“持久紧凑状态行 + 原生 details/summary + 单一列表工具栏”。状态 owner 保持不变，正常行明确区分宿主 transport 与来源 read，两者不得合成总体绿色健康。普通字号且宽度充足时目标高度 40–48 CSS px；长名称、窄容器与 200% 文本允许换行，不能用固定高度、缩字或 overflow 裁掉事实。

一个真实工具栏承载标题、刷新规划与连接设置；本地表格控制沿用现有 owner。移除生产路径重复 workspace/source/time 块与旧 float/clear 结构，必要的 UI 回调沿组合链显式传递。先以消费者清单确认现用接口；不为旧测试增设 compact/legacy 双模式，不用 CSS hide 掩盖重复的可访问文本。列表标题仍须为详情关闭后的可定位回焦点，设置进入/返回与模态动作保留现有语义。

披露详情包含来源名、映射、最后完整确认时刻和已有安全诊断。宿主断连、来源未知/不完整/陈旧、刷新 pending/error、操作 unknown 均保留具体可见提示；同类提示由一个 owner 汇总，不能把唯一异常藏进详情，也不能把部分读取改成成功。沿用现有 announcement owner，时间变化或展开状态不重复播报；设置表单与详情模态的既有公告职责保留。scope 切换或权限撤回后不能保留旧来源/时间/诊断 canary。来源名、映射和确认时刻由既有 ui-model 统一投影；能力未知或 unavailable 时，即使同 scope 元数据仍留在输入也不披露。能力裁决复用 accessIndex，先于 transport；available/read_only/degraded 的授权离线/陈旧观察仍可保留。reason 可描述已提交 partial round，不单独替代帧级读取许可。

观察时刻用 UI 私有纯函数/组件格式化为绝对本地时间，明确显示 IANA 时区或数字 UTC offset；保留原始 ISO 的 `time.dateTime`，详情可读原值。测试显式传入 Asia/Singapore 与 UTC；无效时刻给安全“时间未知”，不取当前时钟补事实。目标日期仍是 date-only，年龄/新鲜度算法不动。

被放弃的方案是将全部状态订阅下移到 SetupGate/ProjectPage：会扩大设置恢复和业务状态的修改半径；只改 CSS 隐藏重复项则留下结构和可访问树重复；新增主题、导航、总览页或组件库没有本闭环需要。两份独立设计的一致结论是保留状态权威与紧凑披露，综合评审进一步去掉了为独立 fixture 保留呈现兼容模式、以及向 ui-model 新增时间 API 的建议。

## Global Constraints

UI owner 独占本闭环，不与其他工作流共改 UI 组合入口。允许文件集只在此声明：`packages/ui-model/src/workspace-status.ts`、`packages/ui/src/workspace-status.ts`、`packages/ui/src/workspace-setup.ts`、`packages/ui/src/work-item-app.ts`、`packages/ui/src/work-item-project.ts`、`packages/ui/src/work-item-list.ts`、`packages/ui/src/workspace-presentation.ts`、`packages/ui/src/detail-presentation.ts`、`packages/ui/src/list-states.ts`、新增 `packages/ui/src/observed-time.ts`；`packages/ui/src/table-presentation.ts` 仅可清除失去消费者的刷新覆盖，不改表格几何算法；`tests/contract/ui-workspace-status.test.js`、`tests/contract/ui-workspace-shell.test.js`、`tests/contract/ui-work-item-app.test.js`、`tests/contract/ui-work-item-list.test.js`、`tests/contract/ui-work-item-list-browser.test.js`；`tests/contract/ui-planning-refresh.test.js`、`tests/contract/ui-work-item-list-view.test.js`、`tests/contract/ui-workspace-setup.test.js`、`tests/integration/harness-plugin-artifact.test.js`、`tests/integration/harness-plugin-host-watch.test.js`、`tests/integration/harness-plugin-planning-refresh-ui.test.js`、`tests/integration/harness-plugin-workspace-status.test.js`；`tests/fixtures/table-geometry-browser.mjs`、必要的 `tests/fixtures/workspace-frame-browser.mjs`；新增 `tests/browser/workspace-header.test.js`、`tests/browser/workspace-read.test.js`；`docs/product/ui-workspace-status.md`、`docs/product/ui-workspace-frame.md` 与本计划。索引允许在 `docs/README.md` 为本计划写一条记录，由集成 owner 串行更新；实施者暂不编辑。

代码/测试/config/fixtures additions+deletions 预计 420–690，必须 ≤800；文档预计 200–400，必须 ≤1300。超过上限先找真实简化并重估，不能删判别案例或机械拆连续布局。无新依赖、无 Provider/Host ABI/业务 store/规划字段写入，无 schema 或数据迁移；Host 拥有权威，UI 只消费快照。公开文档自包含、中文且不写本机路径/内部系统。

## Plan of Work

### Batch 1 · 固化规格与 draft

最小闭环是让实现范围和独立验收可审阅。主文件为本计划。回读 #528/#446 当前正文与评论，对照本计划的工程/人类验收边界；记录实际消费者、现有 header/状态/滚动 owner；保存同构建 bundle 基线后，提交计划并建立 base=main 的 draft PR。回读 draft 的 head/base、文件和 issue 关联后才写实现。

验证在本分支根执行 `gh issue view 528 -R SingularityKChen/harness-projects --json title,body,state`、`gh issue view 446 -R SingularityKChen/harness-projects --comments`、`pnpm --filter @harness-projects/app-harness-plugin bundle:report`，期望 scope 未被后续事实推翻、bundle 报告成功。既有本地基线报告在 `.superpowers/iteration9/bundle-before/report.json`，必须标注生成时的 head；不能把它当最终产物。回滚点是已提交的计划版本，未改业务代码。

### Batch 2 · 判别性红绿与首屏实现

主文件为 status/setup/list/project 组合及其契约、时间 helper 和真实 browser case。先写会在当前行为失败的用例：唯一可见身份/标题与同行动作；折叠时仍见断连、connected+partial、unknown/pending/error；键盘打开/关闭；一次状态公告；固定 ISO 的时区显示；source/scope canary 清理。保存红的断言与原因后，按 Design / Spec 实现最小组合，删除旧重复结构并更新直接消费者，不改业务状态归约；仅在既有安全呈现投影内收紧读取许可条件。

执行 `pnpm test:file tests/contract/ui-workspace-status.test.js tests/contract/ui-workspace-shell.test.js tests/contract/ui-work-item-app.test.js tests/contract/ui-work-item-list.test.js tests/contract/ui-work-item-list-browser.test.js` 与 `pnpm run typecheck`，期望红转绿且无导入/依赖错误。用同一具体判据分别临时恢复独立 float refresh、错误地把 source unknown 映为 confirmed、破坏 summary 键盘行为或清掉 dateTime，相关案例必须失败；恢复临时变更后重跑受影响案例。回滚为撤销本批业务与测试提交，保留计划和红绿证据。

### Batch 3 · 有界浏览器、交付与评审

主文件为浏览器案例、必要 fixture 和产品说明。真实 DOM 验证 1440/1200/1024/320 CSS px、明暗、普通/200% 文本及长身份/标题/迭代；量测状态行、按钮矩形、正文正高度、整页无横溢出、表格局部 XY 滚动与回焦。覆盖设置往返和详情关闭。fixture 必须装配真实生产组件和快照，不制作截图专用界面。

执行完整 `pnpm test:browser`（当前应包含生产组合 create/read、权限、重连及全部几何/详情案例；不以选择文件替代整层），再以 `pnpm test:file tests/browser/workspace-header.test.js tests/browser/table-geometry.test.js tests/browser/fixture-host-contract.test.js` 定位失败；执行 `pnpm run boundaries`、`pnpm --filter @harness-projects/app-harness-plugin pack:plugin` 与 `pnpm --filter @harness-projects/app-harness-plugin bundle:report`，期望全 pass、同构建产物与 bundle inputs/externals/React 单例可核对。浏览器证据证明受控容器行为；最终安装 Host 图像与人类视觉接受另记，不能借 fixture 宣称完成。

整理 commit 后执行 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`，并用 Git argv 执行 `git diff --check origin/main...HEAD`；期望发布面清洁、体量达本计划上限。人工检查凭据、本机身份、个人信息、内部系统、保密字样。push 后执行 `gh pr view fix/workspace-header -R SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,statusCheckRollup,closingIssuesReferences,reviewDecision`、`gh pr checks fix/workspace-header -R SingularityKChen/harness-projects --required`，按 `docs/review/README.md` 回读所有 review threads（分页不得遗漏）；最终 head 验证通过后才 Ready，交人类评审，不合并。回滚整个 child 呈现闭环，不变更来源数据。

### Review repair · 2026-11-04

依据 `docs/review/pr-529-mmp-review.md` 的唯一 P2 及用户已授权的修复/复评/合并流程继续本计划。比较局部容器查询与固有 flex wrap：选择既有 scoped CSS 上的容器查询，以 Host slot 宽度触发已定义的两列/身份整行规则；不引入 JS 量宽或新断点。新增固定1200px viewport / 320px Host slot 的真实浏览器断言，先确认旧实现失败。
验证：在本分支先跑新增判别用例，修复后重跑相关测试/归因变异；独立复评通过后归档本计划，整理提交，回读当前 head 检查。回滚：恢复原 head 的引用；产品修复与本能力保持同一可回滚边界。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 正常首屏只有一个身份、一个标题；动作与列表同层 | 生产组合 DOM/矩形、1440/1200/1024 图像；浮动负控失败 |
| Host/source 正交，所有触及异常不被披露折叠隐藏 | status 契约与 browser 状态矩阵；unknown→confirmed 负控失败 |
| 披露可 Tab/Enter/Space 操作，焦点清晰，设置/抽屉回焦有效 | browser 键盘断言；click-only 负控失败 |
| 时间是已有观察的绝对时间且带时区，ISO/date-only 不丢失 | 固定 SGT/UTC 与坏值案例，dateTime 负控失败 |
| 窄屏/200% 无整页横滚、正文可用、表格几何未退化 | header、table-geometry、fixture-host-contract 实测 |
| 可独立 review/revert，且无虚构 parent 人验/规划完成 | 当前 PR head/base/checks/threads/Closes #528 + Refs #446/#427/#449 |

## Progress

- [x] 2026-11-04：P2 red/green、38相关/7正式Browser、12组独立对照与最终6变异通过；独立复评完成，计划归档。最终发布head/checks与merge仍按回读门执行。

- [x] (2026-11-03 17:18 SGT) 完成源码与 issue 证据核查，比较两个独立设计并收敛本规格。
- [x] (2026-11-03 SGT) Batch 1：集成 owner 已提交计划、建立并回读独立 draft #529（base=main；实现前 head 为 `2853262d9523e79d388aaecbe1927cd968e3ebff`；最终状态由 Batch 3 命令重读）。
- [x] (2026-11-03 SGT) Batch 2：保存真实 DOM 行为红、恢复后的绿、四类实际生产 mutation 负控；首屏身份/标题/工具栏、键盘披露、完整确认时间及设置/抽屉回焦已实现。
- [x] (2026-11-03 19:48 SGT @ `5aaf6d788d23b08654955079c4f32a2db6f9b92e`) 完成独立视觉/权限/完整 carrier 复评、原子提交、发布面与当前远端 head/base/Closes #528/零线程回读；PR Fast Gate、Verify、Browser、Merge Gate、policy/size/disclosure 均通过，PR #529 已 Ready。归档仅改文档；再次 push 后仍必须回读当前 head。

- [x] (2026-11-03 18:23 SGT @ `33a84b2ca523305fa8890beef058d060712da0ca`) 独立最终复评 PASS，已报 finding 均关闭；本地证据见 Outcomes。此处 PASS 只覆盖当时选择的 302 项；Superseded by Outcomes 的完整 Browser gate 补验（2026-11-03）。
- [x] (2026-11-03 19:48 SGT @ `5aaf6d788d23b08654955079c4f32a2db6f9b92e`) 完成独立视觉/权限/完整 carrier 复评、原子提交、发布面与当前远端 head/base/Closes #528/零线程回读；PR Fast Gate、Verify、Browser、Merge Gate、policy/size/disclosure 均通过，PR #529 已 Ready。归档仅改文档；再次 push 后仍必须回读当前 head。


## Surprises & Discoveries

2026-11-04 Review repair：仅声明局部 inline-size 命名容器并把原 40rem 窗口查询换为同值容器查询；新增正式8组宽窗口/窄slot/zoom/长身份对照先红后绿。相关38项、typecheck与最终6项归因变异通过；普通身份从14.34px列宽/270px高恢复至275px/22.5px，状态区86.5px。独立复评已通过：7项正式Browser及12组偏移slot/尺寸/字号/详情布局对照，无新增发现。

表格几何与 advanced controls 已存在并有真实浏览器矩阵；本批不重复实现。旧 float 已被表格场景局部覆盖，所以验收必须看正常文档流与实测空白，不能只搜索 CSS。初始 main 依赖缺失曾让独立调查 UI 测试无法导入；隔离检出的 frozen install 已由协调者完成，导入失败不算行为红。

长身份、320 CSS px 与 200% 文字组合曾把宿主/来源观察推至状态滚动区尾部；新增真实坐标断言后，窄屏先排观察、再完整排身份，未决操作始终在原生披露之前。独立 float 刷新、unknown→confirmed、阻断原生 summary 键盘、丢失 dateTime 四类实际生产 mutation 均被对应浏览器断言拒绝。unknown 负控的首次尝试曾因读取包含屏幕外 live 文本的 innerText 假绿，证据已保留；断言现只读可见 summary 与异常段落。

独立评审在实现检查点提出一个 P2：同 scope、保留元数据的未知/拒读帧仍披露来源/映射/时间。当前 Host 正常撤权会 mask 元数据，因此未证明生产可达泄漏；修复的是冻结的 presentation 防御合同。测试先保持元数据观察真实失败，再把三项事实统一交既有 ui-model。授权 partial round 的 reason 也可能是 permission_denied，故只认 accessIndex 的明确三个可读级别；不孤立把 reason 当作帧级撤权。恢复 offline 早 return 与放松披露 gate 的两项实际 mutation 均被新断言拒绝。

完整 verify 首次发现 12 个旧呈现断言；按新的状态披露、唯一抽屉或陈旧横幅 owner 更新直接消费者后，全套通过。bundle report 的相对输出路径先被安全拒绝；改为任务 ignored 目录的规范绝对路径。正式 compare 按设计拒绝 dirty 检出，因此当前 after 报告明确为 dirty/provisional，必须由集成 owner 在最终 clean head 重建，不能伪造 source 身份。

托管 Browser 完整运行随后暴露选择回归遗漏：真实空 SQLite 创建场景仍等待已移除的可见“当前工作区：”前缀，status summary 已显示创建后的唯一工作区名；本源按原测试重现等待超时。补丁将该直接消费者迁至真实 summary 并断言 status 内及页面可见身份各恰好一次，原 Host、SQLite、表内行数与 create RPC 次数验证保留。旧前缀仍可存在于隐藏设置上下文，故不能借 textContent 或隐藏节点满足首屏可见身份断言。

同一代码的另一工作树曾在几何矩阵勾选“新鲜度”超时；CallLog 已确认 visible/enabled/stable、scroll 完成后停在 performing click。当前检出原样单独运行完整 60 格矩阵及全 Browser 并行运行均通过，两份各 60 个坐标样本页面横溢出为零、滚动表格最小高 142.5 px。未复现拦截或布局错误；全层矩阵耗时高于单独运行与并行压力相容，但不能据此证明超时根因。没有改生产、几何测试、timeout、force-click 或门禁配置，首次失败完整保留供后续诊断。

## Decision Log

2026-11-04 / 协调者：用户在本次 PR #529–#531 评审请求中明确授权只有 P2/P3 时本会话修复、独立复评、整合和 rebase merge；采用上述最小修复，不重复请求批次许可。

- Decision：最终 gate 必须运行完整 Browser 层，定向回归仅用于定位；直接消费者必须迁移事实 owner，不能仅删除过时期待。Rationale：选择的 header/table/detail 文件未覆盖真实 create→Host→SQLite 场景；托管失败证明漏项。Date/Author：2026-11-03 SGT / UI owner、集成 owner。
- Decision：独立 child 关闭 #528，父 #446/#427/#449 仅引用；采用原生披露与私有时间格式化。Rationale：工程闭环可判定，但人类视觉/安装判定不能由代码替代；不扩大状态拥有边界。Date/Author：2026-11-03 SGT / 综合评审。
- Decision：来源名、映射和确认时刻由 ui-model 统一裁决，UI 只消费安全 view；unknown/unavailable 先于 transport，reason 不独立裁决帧级撤权。Rationale：复用 accessIndex 的明确读取许可，关闭保留元数据反例，同时保留已授权 partial、离线与陈旧事实；无新 store、状态机或时间计算 API。Date/Author：2026-11-03 SGT / UI owner、集成 owner 证据确认。
- Decision：设置时继续卸载列表；返回时原 initiator 不可用则定位新工具栏设置按钮，再回退标题。Rationale：移动动作不应新增隐藏列表生命周期、权限缓存或公告 owner；浏览器覆盖设置期间撤权和 scope 更换后的旧 canary 清除。Date/Author：2026-11-03 SGT / UI owner。
- Decision：本轮不做 #281 新页面，不重做已合并表格几何；不为 fixtures 保留实验呈现双形态。Rationale：优先修复真实入口缺口，减少共享 UI 写区；未发布实验形态无兼容义务。Date/Author：2026-11-03 SGT / 综合评审。

## Idempotence and Recovery

测试、构建与只读回读可重复；fixture 只用合成输入并清理自身 server/browser。行为失败先保留证据，回到对应批次重现；不能通过删异常或缩小矩阵变绿。Git 实际操作使用 argv/library API，不拼 shell；基线保存为本任务专用 ref 后才整理已发布历史，精确 lease 流程见根规则。已推送历史发现敏感信息时停止发布并按 publication 处理。合入后的回退单位为整个 PR，不碰用户 worktree、凭据、缓存和权威事实。

## Interfaces and Dependencies

沿用 React createElement、Host theme/font/focus token、现有 client sources、ui-model 安全投影和列表/抽屉回调；无新增外部依赖。需要仓库既定 Node/pnpm、浏览器测试依赖与已授权 GitHub 登录用于 draft/回读。看板 Status 和 native blocking 关系不在本批授权写入内。没有人工批准也可继续已授权可逆实现；具体视觉接受是 parent 验收，不能伪造为实现前等待门。

## Outcomes & Retrospective

2026-11-04 Review repair：唯一P2已修并通过独立复评；容器containment未破坏表格高度、详情坐标或焦点。旧bundle测量仅绑定修复前产品；最终清洁head以 `node apps/harness-plugin/scripts/bundle-report.mjs --out .superpowers/pr529-531-review/bundle-final-current --base-report ../../.superpowers/pr529-531-review/bundle-base-current/report.json` 重建并回读 source.head/dirty、React外置与delta，再核对当前head托管门禁。归档不表示#446/#449人验或R1完成。

原交付完成状态 Superseded by 本次 Review repair（2026-11-04）：原产品范围保留，P2 修复、复评与当前 head 门禁未完成前不合并。

设计准备时仅完成规格，未声明实现、CI 或人类 UAT；Superseded by 本节工程结果（2026-11-03）。

工程结果（2026-11-03 17:43 SGT，`fix/workspace-header @ 2853262` 加未提交实现）：`pnpm verify` exit 0，包含 typecheck、3474 项 contract/integration/e2e 与 7 项 MVP0；`pnpm run boundaries` exit 0；本计划 Batch 3 浏览器命令再加 `tests/browser/detail-expand.test.js`、`tests/browser/native-link-detail.test.js`、`tests/browser/table-rq-integration.test.js` 共 21 项全部通过。执行上下文均为本计划声明的检出。真实浏览器包含 1440/1200/1024/320 CSS px、明暗、100%/200% 文字、长身份/标题/迭代、原生 Tab/Enter/Space、撤权/换 scope、设置/抽屉回焦和表格局部 XY 几何。

`pack:plugin` 和不带 base 的 `bundle:report` exit 0；同工具链/config 的 provisional 报告显示 Host 原始字节与 gzip 不变，client 新增私有 observed-time 输入、无 bundled React，外置 specifier 集合不变（增加一个既有 react import edge）。正式增量、最终发布面、当前 PR checks/threads 与人工接受仍待集成 owner 按 Batch 3 收敛；没有把本地验证写成 hosted CI 或人类 UAT。工程全部收敛后由集成 owner 移到 completed 并更新索引。新发现的实质维护缺口记 `docs/exec-plan/tech-debt-tracker.md`；当前未引入新债务，原 parent 的人验不是可随意关闭的技术债务。

P2 修复结果（2026-11-03 SGT，`fix/workspace-header @ 223d16c` 加未提交修复）：定向 model/status、header 浏览器、runtime planning/access 与 refresh UI 共 302 项通过；完整 `pnpm verify` 为 typecheck、3476 项 contract/integration/e2e 与 7 项 MVP0 通过；boundaries 9 项通过。独立反例仅调整复制到本检出的相对 import 后 exit 0。浏览器保留元数据，覆盖三个可读级别的授权 partial/离线正控和 unknown/unavailable 的在线/离线拒读、时间缺席与单一公告；两个安全 gate/优先级 mutation 分别 exit 1。以上为本地工程证据，待独立定向复评与最终 clean-head 构建，旧 bundle 报告不能代表这次修复后的最终产物。

最终工程审读（2026-11-03 18:23 SGT，代码快照 `33a84b2ca523305fa8890beef058d060712da0ca`）：独立首轮 P2 是构造的 unknown/unavailable 同 scope 残留帧未清来源、映射和确认时刻；当前 Host 已有 mask，未证明生产可达泄漏。既有 ui-model 统一能力优先安全投影后，原反例、29 个独立矩阵和 302 个定向案例通过；formatter 未变，无 raw mapping 绕过或重复公告。清洁构建在本代码快照对比 main：Host raw/gzip 均不变，client +1190/+269 字节，包 +282 字节；只新增 observed-time 输入，外置集合不变且无 bundled React。 这是工程验收，未代替人类 PR 评审、规划接受或产品/R1 判定；最终 hosted head 另按 Plan of Work 回读。

完整 Browser 补验（2026-11-03 SGT，`fix/workspace-header @ 3c17b4d724d61243f3fe009de0a70c08e6bbb48b` 加测试/计划补丁）：本源旧 selector 红 exit 1；迁移后 create 定向 exit 0；临时恢复旧 selector 再次 exit 1，恢复后真实 composed 全部 7 场景与相关 setup/status 契约共 57 项通过。`pnpm test:browser` 原配置完整执行 41 项，全部通过、skipped/todo 均为 0；完整 `pnpm verify` 仍为 typecheck、3476 项 contract/integration/e2e 与 7 项 MVP0 通过。此补丁仅修改测试和计划，生产应用 blob 相对该 head 不变；原几何超时未复现且不归因为已证实的压力问题。最终 hosted Browser 状态仍由集成 owner 在实际发布 head 回读。

最终完整 carrier 复评（2026-11-03 19:45 SGT @ `951d798a078c63f1b022ea1e542751d8f627208a`）：独立真实 composed browser 7/7 通过；工作区创建仍验证 Host 与 Storage 名称、SQLite 一行与恰好一次 create RPC。身份断言迁到唯一摘要，计数未弱化；恢复旧 selector 的受控变异准确 KILLED 并恢复。相对已审产品代码无变化。组合检出 `test/iteration9-final-integration @ ef6b13a6d8046ca7fcfa63b79659a19271c1cded` 完整浏览器 41/41；其生产代码在先前组合快照 `e664b0a9060967fd0c3a2b029b2b6caa0d4c6782` 完整 verify 3557 + 8 通过，后续仅变浏览器断言与计划。托管失败候选已被此闭环替代，当前 head 仍需重新回读。

托管交付记录（2026-11-03 19:48 SGT @ `5aaf6d788d23b08654955079c4f32a2db6f9b92e`）：完整 Browser、PR Fast Gate、Verify、Merge Gate、Issue policy 和实际 size/disclosure 检查通过；head/base、Closes #528 与零 review threads 已回读，PR #529 已 Ready。本计划和索引现归档；本次只改文档，当前归档 head 仍按 Plan of Work 回读。#446/#427/#449 人类确认/产品接受保留，本地 fixture 不冒称已安装 Host 人验。新 build report 在最终清洁 head 重建并由交付记录绑定源版本，已审产品代码与 `33a84b2c` 相同。

## Bottom Change Note

Change Note (2026-11-03 SGT)：根据独立设计比较与实际生产消费者，建立 #528 自包含规格；明确单一状态权威、表格回归边界、人类接受保留及可执行交付门。

Change Note (2026-11-03 SGT)：完整 verify 首次暴露 12 个仍依赖旧列表来源/时间重复块与定义列表顺序的直接消费者断言；扩充 Global Constraints 以把事实断言迁移到状态披露或唯一抽屉/陈旧横幅，保留原来的撤权、异 scope、离线与 redaction 负控。

Change Note (2026-11-03 SGT)：记录实际红绿与四类 mutation、长身份布局纠正、设置返回的最小焦点恢复、完整本地验证和 dirty bundle compare 的诚实边界；交集成 owner 独立评审与最终交付。

Change Note (2026-11-03 SGT)：独立评审给出一个 P2：同 scope 的 unknown/unavailable 构造的残留元数据帧仍披露来源、映射和确认时刻（未证明当前 Host 生产可达）；先扩 Global Constraints 到既有 ui-model，再按 TDD 保持元数据写红并统一安全投影。保留三个可读级别、授权离线/陈旧和 partial committed 正控，不把自由 reason 当作帧级撤权。

Change Note (2026-11-03 SGT)：记录独立 P2 的根因、保留元数据红绿、能力优先级与 partial reason 边界、两项负控和修复后完整验证；交集成 owner 定向复评及 clean-head 交付。

Change Note (2026-11-03 18:23 SGT)：记录独立最终复评和实际根因修复；准备单一能力提交，远端 Ready 门尚待当前 head 回读。

Change Note (2026-11-03 SGT)：托管 Browser 首次全层运行发现真实 create→Host→SQLite 直接消费者仍等待已移除的重复身份前缀。扩 Global Constraints 迁移其断言至唯一状态行身份，并将完整 Browser 层纳入最终 gate；先在当前检出复现红，不删除持久化/请求次数判据。另调查本机全层中 checkbox check 超时，证据不足前不改布局、timeout 或点击语义。

Change Note (2026-11-03 SGT)：记录真实 create 直接消费者 selector 根因、唯一可见身份与持久化判据的红绿/负控、完整 Browser 41 项与 verify 补验，以及几何超时原样复跑未复现的证据与不确定性；未修改应用或测试等待语义。

Change Note (2026-11-03 19:45 SGT)：记录完整生产组合创建消费者的独立复评与组合 41 项 Browser；不将首次单次几何超时推断为已证实压力根因。

Change Note (2026-11-03 19:48 SGT)：依据真实托管门禁与 Ready 回读归档计划；保留最终归档 head 再核验和原 parent 人类接受边界。

2026-11-04：依据独立 MMP 评审重新打开计划，记录最小修复方案和 red/green/复评门。

2026-11-04：补充评审修复的实际 red/green、正式回归与最终归因变异；归档和发布等独立复评完成。

2026-11-04：P2独立复评通过后再次归档，保留清洁head产物重建和当前托管检查门。

2026-11-04：旧基线Node v26.12.1与当前v26.13.0工具链不同，可比性检查正确拒绝，未豁免。已在清洁main初始base f5ae377d根目录执行 `node apps/harness-plugin/scripts/bundle-report.mjs --out .superpowers/pr529-531-review/bundle-base-current`，再在本检出执行上述比较命令；同Node v26.13.0 / pnpm10.28.2 / esbuild0.28.2，候选 `2bf595ef` 产品树：Host不变、client +1239 raw/+280 gzip字节、包+261字节，React外置和external specifier不变。文档补录后再在最终清洁head重跑并绑定source.head；产品两文件字节保持独立复评快照。
