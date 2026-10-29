# MMP 工作区视觉框架 ExecPlan

> 状态：Completed；本闭环实现、独立审查与本地/支持 Host 呈现验收完成；PR 门禁以最终远端回读为准。
> 创建：2026-10-29；Issue：#446；Batch：visual-foundation。
> 分支：`feature/mmp-ui-frame`；计划遵守根 `PLANS.md`。

## Purpose / Big Picture

用户打开工作项入口时，能清楚辨认工作区、规划来源、事实新鲜度和当前动作，且列表、状态和导航呈现一致的 Host 视觉语言。
最小成功证据是当前真实入口在两种主题、1440/1200/1024 和窄宽中呈现一致框架，实际浏览器没有页级横向滚动，事实文字与安全导航保持正确。
本闭环只实现已经存在的列表与导航；实际安装件的 Host 验收单列，不能由截图或 token fixture 代替。

## Context and Orientation

`packages/ui/src/work-item-app.ts` 拥有 scope 门、局部路由和页面替换焦点；业务数据经注入的 source 读取。
`work-item-list.ts` 消费 ui-model 安全 view，已有八列原生表格、真实 href、redacted 占位和局部横滚；`list-states.ts` 已有局部 CSS。
`work-item-project.ts` 拥有详情组合和关闭回焦，由 #430 修改；设置、仓库和映射表单由 #447 修改。
当前导航只有工作项和连接设置。冻结设计要求 Planning-first、一个业务 UI、一个详情、来源与新鲜度清楚、中文术语、44px 主动作和 Host light/dark。
设计偏好是安静的中性表面、紧凑中文排版、单一蓝色动作强调；颜色和字体权威仍属于 Host。
`docs/exec-plan/completed/2026-10-28-plugin-bundle-evidence.md` 记录公开 Host token 与构建边界；theme 包不是任意可新增的 Loader runtime external。

## Design / Spec

选择原生语义 HTML 和局部 CSS，直接用于当前工作项入口；不新增全局侧栏、未交付页面 tab 或组件库产品。
具体目标：标题区突出工作区名，次层完整显示规划来源、来源确认时刻和最后接收时刻，动作区保持次要刷新与连接设置；状态说明处于正文前且始终可读。
正文继承 Host 字体与前景/背景，基准 14–15px 等效正文、约 22–24px 标题、元信息不小于 12–13px；以 rem 和 Host 基准协调，不能固定覆盖 Host 的字号选择。
间距采用 4/8/12/16/24px 等效尺度、细边框、8px 等效圆角与极少阴影；元信息不能靠降低对比度隐藏。正文与控件文字须达 4.5:1，控件可辨边界和焦点达 3:1。
主动作使用强调边框和正常高对比文字，避免在没有已核实反色 token 时硬编码白字蓝底；状态保留完整文字，颜色只作辅助。
1440/1200/1024 均保留真实内容；根 `min-width:0;max-width:100%`，只有表格容器横滚。320 CSS px 和 200%/400% 等效缩放时标题、元信息和动作换行，不能删列或省略事实来通过。
不新增动画；若确有过渡，`prefers-reduced-motion:reduce` 时消除位移与时长。

共享合同固定为私有模块 `packages/ui/src/workspace-presentation.ts` 的 `export const WORKSPACE_STYLES: string`，不经包 `index.ts` 发布新公共 API。
样式仅作用于 `.hp-workspace` 根及其后代；`WorkItemApp` 给现有根 section 加该类并注入同一 CSS，保留 ref、aria-label 和焦点逻辑。
根定义 `--hp-accent:var(--dsw-alias-state-business-primary,currentColor)`、`--hp-focus-color:var(--dsw-focus-ring-color,var(--hp-accent))`、`--hp-focus-width:var(--dsw-focus-ring-width,2px)`。
中性 `--hp-surface` 为 currentColor 4% 混合透明，`--hp-border` 为 22%，`--hp-control-border` 为 58%；`--hp-radius:.5rem`；`--hp-space-1/2/3/4/6` 分别为 `.25/.5/.75/1/1.5rem`。
若实测控件边界或文字对比度不足，使用继承前景提高对比度；不能另造明暗调色板。焦点轮廓使用共享 focus 两个变量、offset 至少 2px。
共享 `.hp-action` 提供原生按钮字体、44px 最低高度、间距和 focus；`.hp-action-primary` 只提供强调边框与字重。两者在本 PR 的 unresolved 返回动作真实消费，随后由详情/表单采用。
现有 LIST_STYLES 只保留列表专有规则；移除与共享根重复的定义，保留当前 LIST_STYLES 出口以免无收益改名扩散。独立列表渲染仍可用继承与 Host focus fallback。

拒绝新增 UI 依赖：当前没有原生 HTML 无法承担的交互缺口。拒绝硬编码暖白背景和插件主题状态，避免第二主题权威。
拒绝把未来 IA 画成可点击入口；React 的状态结构建议用于避免重复状态，本 PR 不新增业务 store、路由或新鲜度副本。

## Global Constraints

每 PR 代码、测试、配置和 fixture 的 additions+deletions 严格 `<800`，文档严格 `<1300`；本闭环预测代码 400–550、文档 180–350。
唯一产品写集：`packages/ui/src/workspace-presentation.ts`、`work-item-app.ts`、`work-item-list.ts`、`list-states.ts`。
测试写集：`tests/contract/ui-work-item-app.test.js`、`ui-work-item-list.test.js`、`ui-work-item-list-browser.test.js`；如需新增可服务的屏幕 fixture，仅新增 `tests/fixtures/workspace-frame-browser.mjs`，计入上述预算。
文档写集：本计划迁入 `docs/exec-plan/completed/2026-10-29-mmp-ui-frame.md`；另含 `docs/product/ui-workspace-frame.md`、`docs/review/pr-461-mmp-review.md`；`docs/README.md` 仅整合 owner 串行维护。
不改 project/detail/form、ui-model/client/Host、生产 build、依赖/lockfile、数据库或 Provider；不修改看板 Status 或 native dependency。
不引兼容适配、旧实验数据库迁移或双轨实现；保持当前受支持 Host ABI、包依赖方向和安全事实边界。

## Plan of Work

Batch F0 形成代码前可审阅结果：在本分支工作树根核对 Git 状态和基线，提交这份自包含计划，创建关联 #446 的 draft PR，回读 base/head/draft/closing issue 后才修改产品代码。
相关命令：`gh pr view -R SingularityKChen/harness-projects feature/mmp-ui-frame --json headRefOid,baseRefName,isDraft,closingIssuesReferences`；期望 draft=true、base=main、关联 #446。
若尚无 PR，以 `gh pr create -R SingularityKChen/harness-projects --draft --base main --head feature/mmp-ui-frame --body-file <已准备的描述文件>` 创建；描述文件不放本机身份或内部输入路径。

Batch F1 闭环是实际入口消费共享框架。先给当前可运行 fixture 增加/记录有判别力的目标：根框架间距、44px 返回动作、长内容可读、状态与 redacted canary 不泄露；先在旧实现中观察目标断言失败。
实现共享模块与根消费者，再整理列表样式；不搬动 scope、导航、source 订阅或状态解释。新增 fixture 如有需要，必须渲染真实 WorkItemApp、真实 client store 与 ui-model 投影，不复制 renderer。
运行 `pnpm test:file tests/contract/ui-work-item-app.test.js tests/contract/ui-work-item-list.test.js tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list-browser.test.js`；期望全部 pass、零 skip。
由整合 owner 用既有浏览器能力打开 fixture，记录 1440/1200/1024/320 CSS px、两主题、长中文/英文、键盘、200%/400% 等效缩放的截图与 computed layout；已有 SSR/bundle 契约不冒称真实浏览器测试。
临时令共享 CSS 为空，必须使框架间距/主动作/焦点的目标断言失败；恢复原文件再跑 green。原本已无页横滚的输入只算保持行为，不能虚称修复旧 bug。
回滚点为 F0 计划提交；整体撤回 F1 即恢复原呈现，无数据操作。

Batch F2 锁定交付证据。在同一分支根运行 `pnpm typecheck`、`pnpm boundaries`，期望均 pass；不改变 workflow，无需新增浏览器 CI lane。
在 clean 最终提交运行 `node apps/harness-plugin/scripts/bundle-report.mjs --source-root . --out .superpowers/ui-frame-bundle`，使用当前同工具链 clean base report 比较；报告工具对 dirty 或配置不同必须拒绝 Δ。
运行 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`；记录 Host/client raw+gzip、pack bytes/hash、完整 input/external diff 与 React 输入，不能由零新依赖推断零增量。
最终检查 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main` 和 `git diff --check origin/main...HEAD`；期望无敏感命中、符合本任务更严预算、无 whitespace error。
独立对抗性评审须核对当前 head/base、P0–P3、issue 全部验收和公开面；修复后复验。最终 push 后回读 `gh pr checks -R SingularityKChen/harness-projects feature/mmp-ui-frame`、PR head/base/issue/review threads；条件满足才 ready，不自行合并。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 真正消费的框架 | WorkItemApp 实际入口与当前列表截图；共享 CSS 负控失败再恢复 |
| 响应式可读 | 两主题 × 1440/1200/1024、320 CSS px、缩放；页级无横滚、八列表局部横滚、逐格无覆盖或裁字 |
| 事实与安全保持 | loading/confirmed-empty/stale/offline/redacted 的真实投影；canary 不在文本、href、属性；时间和来源不改写 |
| 可访问性 | 键盘可达、可见 focus、主动作≥44px、对比度实测；无 dead navigation |
| 包边界 | 同构建 clean base/head report、pack、完整图与 React 检查；+20KiB client gzip仅是评估信号 |
| 实际支持 Host | 从最终 tarball 核对 Loader、主题跟随、slot 和主入口；缺证据明确保留未验收，不能称 Host 通过 |
| 可评审交付 | code/docs预算、公开面检查、独立评审、最终 head 的 checks/关联/线程回读 |

本地浏览器和 token fixture 只证明本地布局；#449 的安装 Host UAT、人类产品接受、R1 与 #457 运行时权限 P0 均不因此完成。

## Progress

- [x] (2026-10-29 +08) 核对现有源码、冻结约束、两份独立方案和 native 依赖，收敛私有共享合同。
- [x] (2026-10-29 +08) F0：计划提交后建立 draft PR #461；回读 base=main、draft=true、head=计划提交，PR closingIssuesReferences 与 #446 closedByPullRequestsReferences 双向包含。
- [x] (2026-10-29 +08) F1：目标 RED 已记录于 `.superpowers/frame-red.log`；共享框架、实际入口消费者、列表样式收敛和 fixture 已实现，focused GREEN 35 tests、typecheck、boundaries 通过；真实浏览器负控与截图待整合 owner 执行。
- [x] (2026-10-29 +08) F2：clean同工具链报告、base差异、独立复评、实际浏览器与官方Host呈现检查通过；最终远端当前head回读按PR门禁执行后才ready。

## Surprises & Discoveries

现有名为 browser 的列表/详情契约主要执行 bundle、VM、SSR 和 HTTP；文件名不能充作真实 DOM/viewport 证据。
主列表已有局部横滚与安全 href；本轮应改善层次并保持这些性质，不从名称推断现存 overflow bug。
公开 theme 包可查阅并不等于 Loader 可新增其 runtime import；仅消费已核实 CSS 合同。
本地 HTTP fixture 可在 `node tests/fixtures/workspace-frame-browser.mjs 4173` 启动；`/?theme=dark&scenario=long&font=400` 可切换主题、场景与等效字号。它打包真实 `WorkItemApp`、client store 与 ui-model 后由 ReactDOM 挂载，仍不代表 Host 安装件验收。

## Decision Log

2026-10-29 / 独立规格审阅者：选择 #446/#430/#447 三个呈现闭环；#457 完整链路估算不能可靠低于800，独立保留 P0/R1 阻塞，不宣称修复。
2026-10-29 / 独立规格审阅者：共享 CSS 字符串和私有类/变量由本闭环唯一 owner 定义；详情与表单均从 #446 的同一基础提交扇出，避免相互依赖。
2026-10-29 / 独立规格审阅者：采用原生控件与强调描边，原因是无新交互缺口且 Host 反色 token 未建立证据；用实测对比度约束视觉细节。
2026-10-29 / 浏览器预览反馈（agent 浏览器观察，非人类参数确认；关闭验收结论由本节 2026-10-30 决定替代）：状态说明收敛为轻量左边线，不增加整块框；刷新动作的真实布局由组合页 owner 维护，不引入跨组件结构选择器。
2026-10-29 / 独立评审修正：移除共享样式中按 DOM 层级命中的动作间距；项目页动作布局归组合组件 owner，共享模块仅维护已约定的变量、类与通用规则。
2026-10-29 / 实施：共享私有样式固定于 `packages/ui/src/workspace-presentation.ts`，列表仅保留专有规则；返回动作消费 `.hp-action hp-action-primary`，未新增公共包出口。

2026-10-30 / 本轮主评审：用户授权本轮无 P0/P1 时自行修复、独立复评并以 rebase 合并 #461–#463。#446 修正首项尚缺具体屏幕/遗漏参数的人类确认，因此本 PR 改为 `Refs #446`，保留 issue OPEN 和该验收未勾选；冻结设计基线和 agent 浏览器检查不替代人类确认。#449 完整安装 UAT 仍是另一道门。

## Idempotence and Recovery

测试、构建和截图可重复；只停止本任务启动的 fixture，运行态日志和截图置于忽略的 `.superpowers/`，不提交个人路径。
临时 mutant 先保存原文件并在 finally 恢复；恢复后复跑同一断言，任何临时修改不得进入提交。
回滚整个呈现提交即可；不清库、不改绑定、不删用户工作树。已推分支整理需 backup ref 和精确 lease，由整合 owner 按仓库 Git 流程执行。

## Interfaces and Dependencies

保留 WorkspaceSource、WorkItemApp props、WorkItemListView、ItemNavigation 与公开包 API；新增合同只在 packages/ui 内部。
#430 native prerequisites 为 #428（已关闭）与 #446；#447 prerequisite 为 #446，关系保持。先稳定本模块，再让两个消费者以同一基础提交并行开发/验收，不建立 detail→forms 链。
官方设计依据已核对：React “Choosing the State Structure” 的避免重复状态；WAI Forms Notifications 的清楚、行动导向反馈。地址为 `https://react.dev/learn/choosing-the-state-structure`、`https://www.w3.org/WAI/tutorials/forms/notifications/`；必要规则已嵌入本计划。
当前不新增维护债。若执行发现必须延期的代码负担，写入 `docs/exec-plan/tech-debt-tracker.md`，不能把未满足验收改记债后关闭。

## Outcomes & Retrospective

实际完成共享呈现、当前入口消费和列表层次收敛；零新增依赖、公共API或事实状态。独立审查未发现P0/P1；P3结构选择器已删除并复评。原生控件和Host变量已足够，无需引入新组件系统。
在本分支产品树运行focused35、UI172、typecheck和boundaries9均通过；F1共享CSS清空变异经仓库runner精确归因KILLED，恢复字节一致。整合检出 `test/mmp-ui-integrated` 首轮 `pnpm verify` 为2566+7通过，属于本地证据。
实际浏览器1440/1200/1024/320无页横滚；窄表格只在局部滚动。正常文字和200%/400%等效文字缩放分别记录；light/dark、长内容、redacted及键盘focus均检查。计算负控关闭共享CSS后根padding由15px变0、返回按钮44px变24.5px；恢复后回到15/44，证明目标判据可辨失败。
官方Harness0.2.0-rc.2干净Web profile实际安装整合tarball并创建验收工作区、连接真实GitHub Project、呈现列表/详情/设置、跟随Host明暗主题。首次整合产物身份为07a7089/sha2567e975d57d41b21f6049e5beb547c410d714835ead7f1dcbc2a87fe6b730b125c；该观察只覆盖本分支相同产品输入，不把后续表单修复或最终新产物冒称已验收。最终产物另按当前报告回读。
最终同工具链clean base/head报告、完整inputs/externals/React及pack身份在 `.superpowers/ui-frame-bundle/report.json` 重算，数值不以“没有加依赖”推断。远端CI与ready必须读取当前head的真实检查；本计划归档不代表已merge或人类接受R1。
#449人类完整UAT、#457运行时权限P0、父UI和R1均保持独立，不由本PR关闭。没有新增技术债；当前布局局部横滚、原生控件和Host继承的取舍已纳入产品文档。

## Bottom Change Note

2026-10-29：独立综合两份方案与现有源码，固定三个呈现闭环、私有 CSS 交接、真实浏览器/Host 证据边界及严格预算。

2026-10-29：记录最小实现、真实 app/store fixture、RED/GREEN 和 CSS 装配负控；保留浏览器与实际 Host 未验收边界。

2026-10-29：按独立评审 P3 删除跨组件结构选择器，保留共享合同与原生动作。

2026-10-29：整合独立审查、实际浏览器负控和官方Host呈现证据，归档实现闭环；远端当前head门禁继续由PR回读控制。

2026-10-30：按本轮 P2 审查保留 #446 人类具体屏幕确认门，修正先前反馈的证据归属；加入当前 head 的独立全矩阵记录与条件合并授权。
