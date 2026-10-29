# 真实且可读的工作项列表 ExecPlan

> 状态：Completed；本地组合、独立复评与构建测量完成，最终远端门禁按下述命令回读；创建：2026-10-29；规范：根 `PLANS.md`。
> 闭环：同仓 #366 与 #429；分支 `feature/truthful-readable-list`；PR base 为 `main`。

## Purpose / Big Picture

用户看到的列表状态仅反映可见行及工作区级读取状态；隐藏行自身新鲜度不能改变列表状态文案。隐藏实体的 wire freshness 跟随工作区同步摘要。随后用已评估的 Host 主题面改善同一列表的间距、标题与来源换行、状态层次及局部滚动，保留全部现有事实、链接与详情入口。成功由 controller→client→ui-model 的判别测试、真实浏览器六组宽度/主题截图和当前 base/head 构建体积共同证明。

## Context and Orientation

2026-10-29 独立取证基线为 `main@bb9a7a259ab81ca89f01d03aa837555607a74fdd`，执行工作树 `.worktrees/truthful-readable-list`；执行前回读 `git rev-parse HEAD origin/main`、`git status --short --branch`。所有本地命令在检出 `feature/truthful-readable-list` 的工作树根执行，除明确标注的 bundle 比较步骤。

`packages/core/src/projection.ts/toPlanningItemView` 收到既有 `SyncSummary`：`degraded` 表示工作区本轮不完整，`stale` 表示行是最后已知值；部分成功时前者 true、后者 false。当前所有实体使用 `sync.stale`。`packages/controller/src/wire.ts/toWireSnapshot` 的整表 source 却使用 `sync.degraded`。因此 decision E 的缺口出现在部分成功且含 redacted 时；全离线场景二者相等，不能作为唯一反例。

`packages/ui-model/src/derive.ts/deriveWorkItemList` 把包含 redacted 的全部条目传给 `degradationOf`；decision D 要求列表页级 freshness 只统计可见行。`work-item-list-view.ts` 已过滤隐藏行的内容与原因，但现有测试明确记录隐藏 freshness 可以改变状态文案。`packages/ui/src/work-item-list.ts` 是原生八列表格，输入为安全 view；`list-states.ts` 只接收安全文字。标题真实 anchor、修饰键导航、组合页 drawer 与焦点恢复均已存在，不重新设计。

已完成的 #428 计划 `docs/exec-plan/completed/2026-10-28-plugin-bundle-evidence.md` 与 `docs/development/plugin-bundle-evidence.md` 选定零新增依赖、Host public primitives/token 优先。它未迁移页面；其旧 Δ=0 只属于其记录的检出。当前浏览器契约是 bundle+VM+SSR，不能证明布局/焦点；现有 `tests/fixtures/work-item-detail-browser.mjs/startServer` 可运行真实 list/route/drawer，不需引入浏览器依赖。本地已有浏览器运行环境的观察不构成 CI 或真实 Host 部署证据。

事实与约束如上。主要未知是长内容在主题和宽度组合下的实际尺寸，使用现有浏览器 fixture 直接裁决；不以固定估计宽度替代观测。#366 的 D/E 是既有行为裁决；本轮不重新裁决权限或规划状态。

## Design / Spec

先完成 truth，再改善同一 view 的呈现，作为一个 owner、一个 Batch、一个可整体回滚的列表能力闭环。系统设计与故障设计均要求 D/E 先于呈现、保留 authority 和真实浏览器证据；评审曾比较在 controller 追加工作区同步投影的备选，完整源码复核后改选更小的既有语义 owner：在 `toPlanningItemView` 仅对 redacted 用 `sync.degraded`，可见行仍用 `sync.stale`，reason 只在选定的 degraded=true 时取 `sync.reason`。该函数已用于 snapshot、getEntity、详情与增量来源；无需改 controller API、追加读取或制造第二状态源。

D 仅改变 `deriveWorkItemList` 传给既有降级归约器的集合：过滤 redacted 后计算整页 stale/connection/reason，rows 仍保留原次序与 redacted 占位。工作区 read.reason、断线、从未收到成功时刻、刷新及读能力降级仍保持保守规则；真实可见陈旧行仍使列表陈旧。不要修改首页统计或全局 `degradationOf`，不删除行来制造 fresh。同步修正 derive/types 的“首页与列表同结论”注释，让注释承认 D 的有意可见集合差异。已完成 #256 计划 `docs/exec-plan/completed/2026-10-01-work-item-list-states.md` 的原开放问题及仍称未裁决的摘要/结果就地加 `Superseded by` 指向本计划 D 决策，保留历史原文，避免同一计划同时宣称未裁决和已裁决。

呈现保留原生 table/caption/thead/tbody/th scope 与八列，不新增排序、筛选、列隐藏、虚拟化或工具栏。标题与来源可换行（含无空格长串），短标签避免逐字断行；统一 cell padding、行间分隔、标题/辅助说明层次。共享状态组件与页面使用同一小组样式/token；优先继承 Host 已应用字体/前景/背景，颜色和焦点使用 #428 已核对的公开 `--dsw-*` 契约及安全 fallback，不另建主题状态或导入 theme/deep path。只读表格不强塞无对应需求的 Button/Modal；这里复用的是已评估主题面与原生语义 primitives，新增依赖与 build 外置键为零。

缩放约束由页面与滚动区域承担：根与组合布局能收缩、表格区域 max-width=100% 且 overflow-x=auto；内容多时仅该区域产生所需滚动，文档不横向溢出。不隐藏事实列、authority、缺值占位、来源确认时间 `reconciledAt` 或本地接收时间 `lastUpdatedAt`，两种时间保持不同标签。保留持续 role=status、aria-busy 与读失败解释；redacted 仍只显示“内容不可见”和占位，不增加 tooltip、隐藏文字或 DOM identity。

放弃新 UI 库、通用数据表、全局设计系统、controller 重复 freshness 规则和新浏览器 harness：均扩大维护/ABI/预算。也放弃仅 SSR 或仅 emulateMedia 的主题证明：必须在真实浏览器注入公开 Host token 的 light/dark 两组值并记录实际样式。若实际变更无法在 800 行内同时保留 D/E 与视觉验收，先简化局部呈现；仍不可行则明确重分闭环，不删安全反例凑数。

官方 [WAI Tables Tutorial](https://www.w3.org/WAI/tutorials/tables/) 支持保留表头与数据单元的语义关联；[WCAG Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) 允许需要二维关系的数据表局部滚动，外围内容仍应适应宽度；[Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) 支持可见键盘焦点。它们是设计依据，不代表已取得 WCAG 合规或真实 Host 验收。

## Global Constraints

本次评审收尾允许集追加：`docs/review/pr-443-mmp-review.md`。其余文件边界保持下文定义。

完整修改允许集仅在此声明：`packages/core/src/projection.ts`、`packages/ui-model/src/derive.ts`、`packages/ui-model/src/types.ts`（仅修正首页与列表同结论的旧注释）、`packages/ui-model/src/work-item-list-view.ts`（仅同步过时注释）、`packages/ui/src/work-item-list.ts`、`packages/ui/src/list-states.ts`、`tests/e2e/workspace-read-assembly.test.js`、`tests/contract/ui-model-presentation.test.js`、`tests/contract/ui-work-item-list-view.test.js`、`tests/contract/ui-work-item-list.test.js`、`tests/contract/ui-work-item-list-browser.test.js`、`tests/fixtures/work-item-detail-browser.mjs`、`tests/contract/ui-work-item-detail.test.js`（仅收紧身份前缀边界，保留全 HTML canary）、`tests/integration/harness-plugin-planning-refresh-ui.test.js`（仅部分成功 E 断言）、本计划、上述 #256 已完成计划、`docs/README.md` 索引行（整合 owner）。不为用满允许集而编辑每个文件；整合 owner 的临时浏览器驱动与截图放忽略运行态目录，不成为新产品模块。

代码/测试/配置新增+删除预计 500–700，严格小于 800；文档严格小于 1300。无新依赖、lockfile、build 参数、Loader ABI、公共 DTO、controller/client 状态、storage、migration 或兼容层变更。仅一个 owner 修改该 UI 单元。遵守七条系统不变量，不写 Status、blocked-by、blocking 或原生依赖，不把局部测试当作产品或发布接受。人类 Demo #143/#236 与 R1 保持单独验收，原「不自行合并」Superseded by 本节上方评审收尾与 Decision Log 的点名授权（2026-10-29）；不安装用户 Host。

## Plan of Work

### Batch 1 · 新鲜度闭环与可读列表

最小闭环是同一列表先真实、再可读且可导航。主文件为 core projection、列表 derive 与 renderer，完整文件面见 Global Constraints。

第一步 RED：以真实 controller snapshot 为基线，经既有 transport/sync 到 list view；复制基线并只覆盖隐藏行 source.freshness 形成 D 的对抗输入（显式记为 wire 负控，不冒称正常 Provider 生产这种组合）；比较仅隐藏 freshness 不同的输入，整页状态完全相同，同时保留可见 stale 正控。E 使用部分读取成功的 `sync.degraded=true/stale=false`，确认可见 wire source=fresh、redacted wire source=degraded 且等于整表；健康恢复、离线、直接 getEntity 和已有 watch/metadata 链保持同一规则。snapshot 是源头，不只手写 UI DTO；允许额外的恶意 canary DTO 验证 ui-model 防御。反例必须分别在当前代码红于 D 与 E，不能用全离线令两者恰好相等。

第二步 GREEN 与小重构：在上述两个既有 owner 落实 D/E，保留 visible 行的新鲜度与 workspace reason；更新过时注释及 #256 裁决标注。新鲜度 focused 通过后，先用当前 renderer 捕获长标题/来源、窄宽度与两组主题的基线，再修改局部样式与共享状态。扩展既有真实浏览器 fixture 的长内容与 empty 情景和 light/dark 公开 token 选择；不复制路由或 drawer。调整 SSR 结构断言时保留 canary 泄漏、语义、状态、链接正控，不把旧精确 style 字串简单删除后留下空验收。

第三步真实浏览器：运行 fixture，打开其打印的同源地址 `/projects/ws-1/items`。在 1440×900、1200×900、1024×900 各验证 light/dark token 主题，保存六组主列表截图与 document/region/table 实测宽度；记录 computed token 证明主题真的改变，不能只改浏览器 colorScheme。每组含长无空格标题、长来源、稀疏字段、可见与 redacted 行；页面 scrollWidth 不大于 clientWidth+1px，溢出时局部 region.scrollWidth>clientWidth。1024 下补 loading、empty、offline、redacted 截图与键盘焦点，确认状态不混淆、Tab 焦点可见、canonical href/修饰键行为保留、打开/关闭 drawer 后焦点返回原有约定位置。该组是本地实际浏览器 token 主题证据；若仅模拟 token，明确标注，不能宣称用户 Host 已部署或完整 a11y 通过。

在本分支工作树根执行：

    pnpm test:file tests/e2e/workspace-read-assembly.test.js tests/contract/ui-model-presentation.test.js tests/contract/ui-work-item-list-view.test.js
    pnpm test:file tests/contract/ui-work-item-list.test.js tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list-browser.test.js
    UI_FIXTURE_OUT=.superpowers/list-fixture.html pnpm test:file tests/contract/ui-work-item-list.test.js
    node tests/fixtures/work-item-detail-browser.mjs

第一条在修改前新增 D/E 失败、修改后全部通过；后两组契约 GREEN 且导出 fixture，运行态目录需先创建。最后一条打印 HTTP 地址并持续服务，浏览器 QA 完毕用 Ctrl-C 停止，仅结束本次 server。浏览器执行器使用已有本地运行环境或人工浏览器，不为这项检查安装新项目依赖。将当前 UI 整体回退或移除 wrap/region 约束作临时视觉负控时，至少一个长内容尺寸/截图判据失败；恢复后重跑这一个判据，证明验收会识别声明的可读性问题。

最后做必要局部重构并验证：

    pnpm verify
    pnpm run boundaries
    pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-bundle-report.test.js
    pnpm --filter @harness-projects/app-harness-plugin pack:plugin
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

期望全部 exit 0。renderer 精确 HTML 测试不代替布局；六组 screenshots 不代替契约。提交前人工复核当前 working diff、新增文件、五类公开面与严格用户预算，提交后重新执行提交对的扫描与 size。回滚点是本批独立提交，整批撤回恢复原投影/渲染，不触碰数据。

clean 提交后按 `docs/development/plugin-bundle-evidence.md` 准备当前 PR base 的独立已登记检出与 frozen 依赖。原含 `../` 的命令 Superseded by 本段命令（2026-10-29 10:16 SGT）：报告工具拒绝 source-root traversal。以下两条从包含 `.worktrees/` 的共同主检出根运行，使用同一个当前 PR 报告工具与显式 sourceRoot：

    node .worktrees/truthful-readable-list/apps/harness-plugin/scripts/bundle-report.mjs --source-root .worktrees/truthful-readable-list-base --out .superpowers/iteration-priority-20261029/final-bundle-base
    node .worktrees/truthful-readable-list/apps/harness-plugin/scripts/bundle-report.mjs --source-root .worktrees/truthful-readable-list --out .superpowers/iteration-priority-20261029/final-bundle-head --base-report .superpowers/iteration-priority-20261029/final-bundle-base/report.json

base 检出名 `truthful-readable-list-base` 位于仓库 `.worktrees/`，由整合 owner 用 argv 创建并校验 realpath，HEAD 必须等于回读的当前 PR base SHA；不复用已知旧 #428 base。期望两个 source.dirty=false、工具链/配置一致、报告含实际 raw/gzip（level=9）、input/external 图和 pack，并能计算 Δ。记录 client gzip 增量与 +20 KiB 选型目标；超目标要解释或缩小，不能擅自升格为 R1/CI 门禁。不兼容报告只写无法比较，不凭“零依赖”推断 Δ=0。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| D：隐藏行不控制整页状态 | 真实 snapshot 链及 canary 对照：只变隐藏 freshness 时 list stale/connection/statusText 不变；可见 stale 仍传播 |
| E：隐藏 wire freshness 跟随工作区 | 部分成功 true/false 差异反例先 RED 后 GREEN；snapshot、getEntity、watch/metadata 与恢复对照 |
| 内容与来源真实 | 八列、authority、两个不同时间、unknown/缺值、safeNotice 继续可见；redacted 内容/身份/字段/reason canary 不进 DOM |
| 可读与主题 | 六组实际浏览器 screenshots、实际 token/computed style、长串换行与尺寸记录；全页无横溢、局部可滚 |
| 可用状态与导航 | loading/empty/offline/redacted，键盘 focus、真实 href、修饰键与 drawer 回焦证据 |
| 生产交付边界 | 当前 clean base/head 报告、真实 pack、原 Loader 测试；记录实际 Δ，区分本地/hosted/Demo |
| 历史结论不自相矛盾 | #256 原开放问题及仍称待裁决的状态/结果就地 Superseded 标注 |

## Progress

- [x] 2026-10-29 09:11 SGT：独立核对 issue、core/ui-model/UI、#428 与浏览器入口，比较设计并选最小 owner。
- [x] 2026-10-29：Batch 1 的 D/E RED→GREEN、局部呈现、六组浏览器与导航/状态验收、自审与完整本地验证完成（结果见 Outcomes）。Superseded by Outcomes 的 F1 验收修复（2026-10-29）：原六组合未覆盖长迭代与多工程事实，不能推出全部事实可读。
- [x] 2026-10-29：F1 局部修复后，长迭代与多工程事实的全部单元格 ink containment 在六组真实浏览器通过；受影响契约 39/39、D/E focused 64/64；最终组合 verify 由整合 owner 执行。
- [x] 2026-10-29 10:16 SGT：独立 F1 复评 PASS；新增 18 组 D 对抗及独立 Chromium 两组 24 格检查通过。同配置 clean base/head 测量、组合检出 2459+7 完整验证、归档与索引完成；最终 push 后另读当前 head/base/checks/threads，再 ready。

## Surprises & Discoveries

2026-10-29：完整回归第一次执行发现两个过时断言：L3 的无边界 `ext-` 与静态 CSS `text-align` 相撞；部分成功 refresh 用 all-fresh 断言覆盖隐藏行，违反 E。按 Decision Log 窄修并保留全 HTML canary。第一次 typecheck 还发现一次局部编辑误把变量加到 `withEngineeringFacts`，已删除错误插入，没有变更该函数。

2026-10-29：E 无需新增 controller plumbing；core projection 已收到 coherent SyncSummary，且直接查询也经此路径。部分成功是 degraded 与 stale 唯一有判别力的既有差异。现有 browser 命名测试实为 bundle/VM/SSR，不能当作 viewport 证据。当前 base 的短 fixture 没有全页 overflow，不能据此声称实现修复了已有全页溢出；本轮主张改善长内容的可读层次与可验证的局部布局。

## Decision Log

- 2026-10-29：本次用户指令明确点名 #441–#443，授权无 P0/P1 后由评审会话收尾、整理提交、核对 issue 并 rebase merge。本 PR 独立评审无 P0–P3 可行动发现，证据见 `docs/review/pr-443-mmp-review.md`。不包含规划 Status/依赖写入。

2026-10-29 / 独立计划评审者：采纳 D 的 visible-only 列表归约和 E 的 core projection 实施点；拒绝 controller 新参数/第二次读取。Rationale：沿既有单一语义 owner 传播所有查询，保留 D23 的部分成功可见行 fresh。

2026-10-29 / 独立计划评审者：合并 #366/#429 为同一列表能力、单批内部先 truth 后 presentation；采用 #428 零依赖 Host token 与原生 table，保留既有八列与路由。Rationale：可在小于 800 行内形成一次验收/回滚，避免先美化错误状态；文件面见 Global Constraints。用户已授权设计收敛与实施，不变更 Status、原生依赖或人类 Demo 裁决。

2026-10-29 / 整合 owner：完整回归暴露两个旧断言，批准 Global Constraints 的窄扩展。Rationale：真实部分成功链的 all-fresh 断言须按 E 分开 visible/redacted；身份前缀扫描需要词边界以区别 `ext-` ID 与静态 CSS `text-align`，仍扫描完整 HTML 中的 canary，不剥离 style 内容。徽章保留原始 span，样式改用父级选择器，避免修改 Host watch 测试。

2026-10-29 / 实施 owner：按独立验收 F1，在原生 table 采用自动列宽；固定比例只作宽度提示。Rationale：真实浏览器比较 auto 与 selective-wrap，两者均消除重叠；auto 仅改一个声明并容纳任意可变事实，不为迭代/工程提示另加字段假设，状态/日期保持自然单行，标题/来源继续换行。代价是病理长内容在窄宽度的行高增加，接受以保留全部事实并避免覆盖。

## Idempotence and Recovery

focused 与 verify 可重复；fixture server/screenshot 不触及 Provider 或用户数据，执行后停止自己启动的进程。临时视觉/语义 mutant 先保存精确文件，finally 恢复并复跑对应判据，不能提交。bundle 只使用明确允许输出目录，沿现有报告工具清理保护，不手动 rm 用户路径。撤本批提交即可恢复，无数据迁移、旧接口兼容或库升级。预算或主题来源不成立时就地修订、保留未验收项，不伪造截图或把 emulateMedia 充作 Host theme。

## Interfaces and Dependencies

保留 `toPlanningItemView` 签名、WorkItemList/View DTO、controller/client、ItemNavigation 与组合页接口。沿现有 React18.3.1/createElement、esbuild、pnpm、公开 Host token 和浏览器 fixture；不引 UI/浏览器依赖、theme import 或深层私有包路径。真实 Host 安装、完整屏幕阅读器/a11y 与人类 Demo 不由本地证据替代；若执行中产生已接受延期的维护债，按 `docs/exec-plan/tech-debt-tracker.md` 登记，当前不制造新债条目。

最终提交后整合 owner 执行 `gh pr view -R SingularityKChen/harness-projects feature/truthful-readable-list --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup`，期望 base=main、同时关联 #366/#429、checks 对应最终 head；另读所有 review threads。当前 head 验证通过才 ready，由人类决定合并，不推进规划状态。

## Outcomes & Retrospective

2026-10-29 本地能力实现与浏览器验收已完成：D 在列表 owner 过滤归约集合但保留全部占位，E 在 core owner 按内容类型选择 degraded/stale，reason 随选定结论条件输出。原八列、source + authority、ISO 的本地接收与来源确认时间、真实 anchor/修饰键、drawer 与回焦约定均保留；共享状态与原生表格使用局部 CSS 和公开 focus token。Superseded by 本节 F1 验收修复（2026-10-29）：此时只验证 title/source，尚不能称全部八列事实已可读。整合 owner 完成 clean base/head Δ、最终当前 PR 回读与独立复核后归档。人类 #143/#236 与 R1 仍为独立验收，不因这两个 issue 的本地证据自动关闭。

在检出 `feature/truthful-readable-list` 的工作树根运行本计划命令：D/E 新反例先出现三个预期失败（生产 partial E、snapshot 派生 D、旧不安全文案反向断言），最小实现后原三文件 focused 64/64；列表 renderer/view/browser 与同步 freshness/Host watch focused 98/98，修正完整回归发现的三个断言相关场景 32/32。artifact + bundle-report integration 36/36（含 8 suites），`boundaries` 9/9，workflow-check 检查 8 个文件无 finding；原 `pack:plugin` 成功生成真实 tarball；当时 `pnpm verify` 的 typecheck、2444/2444 回归与 7/7 MVP0 全通过。Superseded by 本节 F1 验收修复（2026-10-29）：该完整结果属于修复前能力提交，修复后 focused 与最终组合验证分开记录。静态 fixture 导出只证明 SSR；本地 Chromium 的测量与截图才作为下列视口证据。完整日志、runner 与 screenshots 均在本工作树 `.superpowers/sdd/2026-10-29-truthful-readable-list/`，不进入正式源码。

| 浏览器场景 | 本地实际结果 |
|---|---|
| 1440×900 light / dark | document client/scroll 都为 1440；region client/scroll 都为 1390；各保存主列表 screenshot |
| 1200×900 light / dark | document client/scroll 都为 1200；region client/scroll 都为 1150；各保存主列表 screenshot |
| 1024×900 light / dark | document client/scroll 都为 1024；region client=974、scroll=1064，只滚动表格；各保存主列表 screenshot |
| 1024 light / dark 补充 | loading、empty、offline、redacted、focus 与 drawer 各有 screenshot；无 canary；Tab 进入 anchor 时 2px solid ring，Enter 打开 canonical 详情，Escape 关闭且回原标题 anchor |
| 两种主题确实变化 | computed focus token 为 `#4176E6` / `#7AAAFF`，ring 为 `rgb(65,118,230)` / `rgb(122,170,255)`；继承表面分别为白底深字 / 深底浅字 |
| 换行负控与恢复（修复前历史；Superseded by 本节 F1 验收修复） | 浏览器临时移除 title/source wrap 时两单元格 client/scroll 为 252/2000 与 173/1656，包含判据按预期失败；撤销 override 后恢复 252/252 与 173/173，通过相同判据 |

主题 fixture 使用已核对 `@deepseek-ai/dsh-client-ui-theme@0.2.0-rc.2` 公开 README 的两组 focus token 值，其余中性表面在 fixture 声明并继承；未导入 theme、未安装用户 Host，不把模拟宿主表面称为真实 Host 验收。初始长内容在旧 renderer 中也没有文档溢出，因此本轮不宣称修复一个已证明存在的全页溢出。与初稿差异仅为两个经整合 owner 批准的测试允许集扩展；没有新增 dependency/build/DTO/migration，也未创建维护债。


### F1 验收修复（2026-10-29）

独立验收发现 P2：`table-layout:fixed` 与 td nowrap 组合让合法 `Iteration 2026 Platform Integration` 及 `ci_failing + execution_failed` 压入相邻日期/来源列。1200 的旧 head 迭代 client/scroll=120/237、工程提示=110/129；同输入 base 可完整容纳。这是本轮布局回归，不是已知旧问题。以保留的独立 probe 和扩展后的既有 long fixture 先复现 RED，1440 的迭代同样为 144/237，新的逐格 ink 判据失败。

改为自动列宽后，六组 1440/1200/1024 × light/dark 对全部三行八列检查 scrollWidth 与 Range ink 边界，均未出格；长迭代与工程提示分别稳定为 251/251、143/143，1200 的 ink 为 436.19–659.53 和 805.34–919.84，均在各自 cell 内。document、region/table 尺寸仍为上表值；1024 长 title/source 分别 179/179、121/121，行高 444px，是自然列宽的已观测取舍。六主图、两主题 1024 的状态/焦点/drawer 与 opener 回焦全部重新跑过。

换行负控随布局语义更新：临时关闭 title/source wrap 时自动表格宽 4409.28px，两个单元格虽按内容扩列但高度都降为 45px，原有多行可读判据失败；撤销 override 后 table=1064px、title/source 高度 444px，判据恢复，文档仍无横溢。既有 title/source 的旧负控数据保留为历史，不混称最终布局测量。

最窄回归命令 `pnpm test:file tests/contract/ui-work-item-list.test.js tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list-browser.test.js tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-browser.test.js` 39/39（含新增长迭代/多工程事实不截断的真实 HTML 断言）；原 D/E 三文件命令仍 64/64。最终完整组合 verify 与 clean bundle 留整合 owner，未重复旧完整套件。运行态 `f1-red.log`、`f1-options.json`、`f1-green.log`、`browser-results.json`、`f1-focused.log`、`f1-freshness.log` 提供精确记录。

整合 owner 另验证 bundle 工具拒绝旧计划命令的 `../` source-root traversal，并已从主检出用仓库相对允许路径成功测得 base；归档时由其修正可复现命令，本轮不更改报告工具。

### 整合 owner 收尾（2026-10-29 10:16 SGT）

独立全分支验收的唯一 P2（固定列宽与 nowrap 覆盖相邻列）已修复并在 `76a163bdadaa50d24f07b602eb11f5fd6385d073` scoped 复评通过，无新 P0–P3、无需额外架构重构。评审新增 18 组隐藏 freshness 与读取/连接/刷新门的安全 view 等价探针通过；独立 Chromium 在 1200 light、1024 dark 各检查全部 24 个单元格，均无文字出格。源码无临时变异残留。

在检出 `test/iteration9-parallel-integration` 的组合工作树、`f4387cf444e554399d00bdeed36449fd8b5403cc` 运行原 `pnpm verify`：typecheck、2459/2459 契约/集成/E2E 与 MVP0 7/7 全通过，无失败或 skip。该树精确包含 #441 的 `4a927e1816bc`、#442 的 `55dc72480fd5` 与本 PR 的 `76a163bdadaa` 产品/测试文件；仅 `docs/README.md` 索引并集需要文字合并。这是独立组合验证，不把其它 PR 变成本 PR 的依赖或 stacked base。

同一个生产报告工具、Node `v26.12.1`、pnpm `10.28.2`、esbuild `0.28.2`、gzip level 9 和相同 build 配置下，base `bb9a7a259ab81ca89f01d03aa837555607a74fdd` 与 reviewed head `76a163bdadaa50d24f07b602eb11f5fd6385d073` 都为 clean。实际结果：

| 产物 | base bytes | reviewed head bytes | Δ bytes |
|---|---:|---:|---:|
| Host raw | 441879 | 441970 | +91 |
| Host gzip | 109774 | 109788 | +14 |
| Client raw | 161126 | 163238 | +2112 |
| Client gzip | 37544 | 38294 | +750 |
| 实际 pack tarball | 161568 | 162336 | +768 |

两半边 input/external 图均无新增或移除；client gzip +750 bytes 小于既有 +20 KiB 选型目标，但该目标不是 R1 门禁。此后仅证据/索引归档与提交文案整理；最终 clean head 仍用本计划命令复算并在 PR #443 记录，其 hosted checks、双向关联与 review threads 在最终 push 后回读。未安装真实 Host、未做完整屏幕阅读器/WCAG 认证，也未接受人类 Demo #143/#236 或 R1；公开 token 夹具的边界保持明确。

## Bottom Change Note

- 2026-10-29：首次形成单批列表计划；将 E 收敛到既有 core owner，固定 D、真实浏览器/主题证据和当前 clean base/head 测量，避免 controller 与依赖扩张。

- 2026-10-29：吸收完整独立系统设计，补 types 过时注释允许面，明确 D 使用真实 snapshot 基线的对抗 wire 输入与 E 正常部分成功路径的证据区别。

- 2026-10-29：修正 controller 备选的归属为评审者探索，避免将独立故障设计未提出的 API/读取扩张归到该报告。

- 2026-10-29：完整回归后吸收整合 owner 对两个既有断言文件的窄扩展；保留 canary 与真实 partial refresh 的连接、时间和保行证据。

- 2026-10-29：回填 D/E RED→GREEN、局部表格/状态样式、真实浏览器六组合和换行负控证据；区分公开 token fixture、SSR 与真实 Host 的接受边界。

- 2026-10-29：处理独立验收 F1；原处标记先前视觉完成结论的范围缺口，记录自动列宽与选择性换行比较、逐格 ink 的六组合证据和最窄回归；完整组合验证与 clean bundle 保持整合 owner 的门。

- 2026-10-29 10:16 SGT：F1 独立复评后记录当前产品树组合验证、同配置真实 bundle/pack 增量，修正 sourceRoot 可复制命令并归档；保留真实 Host 与最终远端门禁边界。

- 2026-10-29：补充本次完整 MMP 交付评审、直接授权与最终门禁回读要求；计划保持 Completed。
