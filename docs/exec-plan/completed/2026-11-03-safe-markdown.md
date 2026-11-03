# 安全正文阅读 ExecPlan

> 状态：Completed（局部 P2 键盘修复与定向验证完成，待独立复评及当前候选发布回读）
> 创建：2026-11-03
> 范围：Issue #505 的独立能力闭环
> 调查基线：main `957451c684c546ddf8a5d19cb3a23a719940fa9b`

## Purpose / Big Picture

用户在同一详情直接读GFM结构，代码仍是代码，图片只有用户显式动作才打开。最小成功证据为实际安装候选读取#115，heading/list/task/code/table正确且页面没有自动图片请求。

## Context and Orientation

现有 `WorkItemDetailDrawer.contentPanel` 把安全body放p；`deriveWorkItemDetailView`已完成scope、读门、redaction与撕裂读保护。新presenter只能在content分支装配。现有detail reset把pre/code改成white-space:normal，必须局部纠正。生产链为WorkItemApp→安全detail view→唯一drawer→presenter。两路独立方案已由第三位评审者综审。

## Design / Spec

推荐 `react-markdown` + `remark-gfm` 输出React节点；不解释raw HTML，不启用rehypeRaw。只承诺heading、列表、只读tasks、inline/fenced code、blockquote、links、tables；不自写parser、不加editor/highlight/远端HTML。首版安全URL函数只收显式绝对http/https，用不带base的URL验证，先拒控制字符、relative、fragment、protocol-relative与其他scheme。拒绝时普通文字，不生成空href。新窗口固定noopener/noreferrer，自定义组件不spread未审props。

图片永不输出img/picture/src/srcSet/CSS-url；只显示alt和安全的“打开图片来源”链接。relative/unsafe图源只有alt。对 `[![alt](image)](outer)` 外层a如果有图片或 anchor 后代改非交互容器，保留后代唯一显式动作，避免nested anchor。task checkbox disabled/readOnly且没有写入事件。pre与pre code明确white-space:pre、overflow-wrap:normal；pre/table wrapper在prose内部横滚，遵守Host tokens和阅读measure。正文字符串、存储与现有来源URL契约不变。

代码块由本叶子显式呈现为 `tabIndex=0`、具名 region 的 pre，保留原 children。这样只有长代码的只读详情也能通过既有抽屉焦点枚举 Tab 到达，并用方向键横滚；不修改公共 focus selector 或 cycleFocus。

在 remark 转换阶段、mdast→HAST 和 React/DOM 递归之前，以迭代遍历检查 AST children 深度，root 为 0、预算 64。超过时将本次渲染树替换成包含完整原始正文的 code 节点，按安全纯文本显示；不截断正文、不写回存储、不依赖 ErrorBoundary。64 是保守的局部结构预算，保留普通嵌套引用和列表，不建立通用资源框架。

## Global Constraints

用户明确授权方案综审后直接实施和并行交付；不在批次间重复确认，不自行合并或改变规划 Status。验证命令以 `pnpm` 简写，实际使用锁定工具链 `npx --yes --package pnpm@10.28.2 pnpm`；在本节指定分支的工作树根执行。正文只依赖本计划和仓库代码。完成后把本计划移入 `docs/exec-plan/completed/` 并更新 `docs/README.md`，这些生命周期修改属于本片范围。

分支 `feature/safe-markdown`，base为创建时经回读的main，无其他功能依赖；归档计划为 `docs/exec-plan/completed/2026-11-03-safe-markdown.md`。受控文件全集：`packages/ui/src/safe-markdown.ts`、`packages/ui/src/markdown-presentation.ts`、`packages/ui/src/work-item-detail.ts`、`packages/ui/package.json`、`pnpm-lock.yaml`、`tests/contract/ui-safe-markdown.test.js`、`tests/browser/safe-markdown.test.js`、`tests/fixtures/safe-markdown-browser.mjs`、`tests/fixtures/markdown-vm.mjs`、`tests/fixtures/work-item-detail-browser.mjs`、`tests/fixtures/workspace-frame-browser.mjs`、`tests/fixtures/execution-drawer-browser.mjs`、`tests/contract/ui-detail-reflow.test.js`、`tests/contract/ui-work-item-detail-browser.test.js`、`tests/contract/ui-work-item-list-browser.test.js`、`tests/integration/harness-plugin-artifact.test.js`、`tests/integration/harness-plugin-bundle-report.test.js`及本片ExecPlan。新增 fixture 是真实浏览器和既有 VM SSR 对官方 parser 的必要环境适配；不改变生产构建、包边界或 CI 门禁。新叶子由markdown-owner写；detail content单点由detail-integrator串行集成。预算代码560–750、文档250–450，实际到790前重新估算，保安全测试。

## Plan of Work

Batch 1闭环为共享安全正文阅读。先在新contract和browser测试锁结构与攻击输入，当前plain-p必须红；加parser、URL/components与prose局部样式，再替换contentPanel一个节点。主要文件是safe-markdown和markdown-presentation，不重构安全投影。验证 `pnpm test:file tests/contract/ui-safe-markdown.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js`、`pnpm test:file tests/browser/safe-markdown.test.js`，期望结构、安全、无图请求、真实pre whitespace和table scroll均绿；`pnpm typecheck`期望0错误。回滚本片恢复plain text，不改数据。

Batch 2闭环为同构建安装证据。执行 `pnpm --filter @harness-projects/app-harness-plugin bundle:report` 和 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`，按脚本实际参数把报告写运行态目录；记录同flags baseline/candidate raw、gzip、tgz、input graph与React-singleton。主控已在clean基线测得client228372 raw/52371 gzip、Host546786/131091、tgz198345字节；这仅是2026-11-03该基线观察，必须用同工具链重算可比差值。安装候选真实Host走#115与长code/table、光暗、320宽、200%文字和keyboard links。回滚候选包后原数据不变。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| GFM结构/Unicode/empty | SSR真实元素及浏览器可读结构，#115安装截图 |
| code缩进与长table | pre text逐字一致、computed white-space和实际scroll几何；移除局部修复会红 |
| 仅代码的键盘路径 | 320×480、production bundle、正文仅 600 字符 fenced code：关闭按钮→Tab 到 pre→ArrowRight 实际横滚；Shift+Tab 与末项 Tab 保持抽屉循环，Escape 关闭 |
| HTML/协议/嵌套攻击 | script/onerror/SVG/iframe不执行，javascript/data/file/custom/relative/fragment无导航；nested图片与autolink无nested anchor |
| 深层正文可用性 | production Chromium 精确 4004 字符、2000 层引用降级为完整原文，无 crash，降级态按钮可关闭；普通嵌套仍为语义引用/列表 |
| 无自动图请求 | browser network记录点击前图请求0，DOM无img/srcSet |
| 安全门 | redacted/unavailable/unresolved/wrong-workspace中body/URL/alt哨兵都不在DOM，presenter mount=0 |
| 依赖成本 | 同build报告、包hash、React singleton、安装件实际渲染；不以npm包大小替代 |

## Progress

- [x] (2026-11-03 SGT) A/B完整输入与独立源码综审完成。
- [x] (2026-11-03 SGT) Batch 1：SSR/真实浏览器先红后绿；新增安全矩阵与现有详情回归首轮 29/29；移除局部 code 修复的变异运行按预期失败（computed pre/code 从 pre 变 normal 且不再横滚）。
- [x] (2026-11-03 SGT) 固定版本 frozen install 与 typecheck 通过；完整 `pnpm test` 最终 3389/3389，失败/取消/跳过均 0。命令在检出 `feature/safe-markdown` 的工作树根执行；用同命令可重算。`pnpm test:mvp0` 7/7、`pnpm test:browser` 8/8（含组合读取与恢复）、`node scripts/workflow-check.mjs` 8 个文件无 findings。
- [x] (2026-11-03 SGT) Batch 2 成本部分：同 flags build/pack 报告已测，详情见本节成本记录；不据此宣称安装接受。
- [x] (2026-11-03 SGT) 独立综审修复波：P1/P2 精确反例先红后绿，聚焦安全/详情/VM安装件 65/65、完整组合浏览器 9/9、typecheck 0。完整 `pnpm test` 3391 项中 3389 pass / 2 fail；两项临时检出未安装新依赖的测试环境修复后，相关 suite + 安全/browser 19/19。未把分次运行宣称为单次完整绿。
- [x] (2026-11-03 SGT) P1/P2 scoped 独立复审PASS，精确crash输入存活且完整可读可关闭，旧guard变异失败；最终聚焦76/76与typecheck通过。clean source `7630f2bc6379a65650fdefd2bd7bd43903d721b4` 的tarball SHA-256 `bcc19e884f75556cae459a22a5f6db0df11d824f554f06bc69bc610481b8483a` 安装到隔离Web Host0.2.0-rc.2，所有文件字节与tarball一致。#115语义标题/4列表/40代码节点，#110实际pre/code white-space为pre、表格301px视口承载424px内容并局部横滚；#233六个checkbox全disabled，实际320×480仍在Host227px内容区内。浅色/深色均可读；深色188px表格可聚焦，ArrowRight实际scrollLeft=40。实际样本DOM无img/picture；攻击与网络零自动图请求、键盘安全链接及200%字号由生产Chromium fixture证明，不冒称安装Host200%或有图输入网络验收。证据 `.superpowers/ui-505-508-20261103/installed-host-markdown/`。
- [x] (2026-11-03 SGT) #512 独立 MMP 评审发现 code-only P2 后，先新增 browser 回归及必要 SSR 语义断言；`pnpm test:file --test-name-pattern 'code-only read-only|detail renders semantic GFM' tests/browser/safe-markdown.test.js tests/contract/ui-safe-markdown.test.js` 实际 0 pass / 2 fail，分别为 Tab 未到达 pre、缺显式具名焦点入口，才加入一行 pre presenter。随后 `pnpm test:file tests/browser/safe-markdown.test.js tests/contract/ui-safe-markdown.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js` 33/33，`pnpm typecheck` exit0。执行上下文为 `feature/safe-markdown@4d0a656ab81322c91fca4b8405233f53730542de` 加本次未提交修复的 `.worktrees/safe-markdown` 根；使用锁定 pnpm10.28.2 且 PATH 包含相同工具链。日志在主仓库 `.superpowers/mmp-review-20261103/markdown-code-fix/`。独立复评、最终 hosted checks 和新安装件由主控后续验证，本轮未替代这些门。
- [x] (2026-11-03 SGT) `node scripts/review-mutate.mjs <本轮mutation.json>` 删除新增 pre 的显式 tabIndex，具名 `code-only read-only detail exposes long fenced code` 用例 KILLED，runner exit0、还原后基线绿；主仓库原始 `node --test .superpowers/mmp-review-20261103/markdown-code-keyboard.test.mjs` 也为 1/1 pass。`git diff --check` exit0，变异后没有残留产品差异。以上为局部验证，不声称本轮重跑了历史完整 suite 或安装接受。
- [x] (2026-11-03 SGT) 组合测试纠偏：`test/mmp-pr512-pr525-review@ff1bdbdb7f27eaddbc851a0689fbc3da664fcad9` 中 #513 已新增合法的首个 header 展开按钮，原末项 Tab 必回关闭按钮的断言单独 RED；此前 Tab→pre、ArrowRight 和 Shift+Tab 均通过。仅改末项断言为回到首个可访问且启用的 header 按钮，保留其余判别。相同测试文件分别在 `.worktrees/safe-markdown`（`0ac53a917389bd16b42d5c32fb5072a2dc05e3e0` 加此测试修补）及 `.worktrees/mmp-pr512-pr525-review`（上述组合 head 加此测试修补，既有 workspace 配置由主控持有）执行 `pnpm test:file --test-name-pattern 'code-only read-only' tests/browser/safe-markdown.test.js`，均 1/1 pass、exit0。日志为本轮目录下 `union-header-order-red.log`、`owner-header-order-green.log`、`union-header-order-green.log`；未改任何生产文件或原评审记录。

## Surprises & Discoveries

旧reset会抹掉缩进；nested image link需要主动避免嵌套anchor。没有证据要求修改boundary门禁白名单，保留现有边界测试。

`pnpm test:file tests/contract/ui-safe-markdown.test.js tests/browser/safe-markdown.test.js` 在实施前退出 1：5 项中 4 失败，plain-p 没有语义 h1、安全 a 或图片来源动作；浏览器找不到标题。既有安全门正控通过。修正测试自身的 dependency resolveDir 与 escaped HTML 正则后重新确认此 RED，才写生产代码。

首次完整 `pnpm test` 的 3389 项里 3369 pass、7 fail、13 cancelled；失败集中在既有 VM fixture 只认识 react，以及 browser parser 顶层读取 detached DOM。已给 fixture 提供同一 React 的真实 jsx-runtime 和官方 node 实体 decoder 驱动的最小 detached `<i>` 面；未知模块和其它 DOM 操作仍拒绝。旧 browser 输入检查只新增两个固定依赖根独立算出的精确传递图。最终同命令 3389/3389 通过。

首次完整 `pnpm test:browser` 为 8 项中 3 pass / 5 fail：组合 fixture 把所有 require 都错答为 React，导致详情 parser 取不到 jsx；已在组合 fixture 精确补同一 React 的官方 runtime，其它模块一律拒绝。

官方 parser 会先将 URL path 中 `&#x09;` 变为 `%09`：新增此输入与 `%0A`、`%00` 的 RED 确认旧 guard 错放 `%09` anchor；guard 现同时拒绝字面与百分号编码的 C0/C1 控制字符，随后 SSR/真实浏览器安全矩阵 5/5 通过；最终补全后相关 SSR/详情/浏览器 29/29 与 typecheck 再次通过。3389 项完整回归及 8 项组合浏览器的证据来自补全前实现树，最后只增加 URL 拒绝条件，按风险不重复全量。

2026-11-03 SGT 成本记录：在检出 `feature/safe-markdown` 的 clean 工作树根运行 `pnpm --filter @harness-projects/app-harness-plugin bundle:report`，以同脚本 main 基线报告比较。报告 `source.head` 应与 `git rev-parse HEAD` 相等、`source.dirty=false`；完整 inputGraph、externalImports、bundle/tgz SHA256 保存在该次运行态报告。相同 Node 26.12.1 / pnpm 10.28.2 / esbuild 0.28.2、生产 build hash 与 gzip level 9 下，客户端 645753 raw / 135679 gzip，相比基线 228372 / 52371 增加 417381 / 83308 字节；Host 546786 / 131091 不变；tgz 282123，增加 83778 字节。首次能力提交的 gzip 增量是 83268；编码控制字符补全后以 83308 为当前观察值，约 81.4 KiB，超过工具 20 KiB target。React/ReactDOM bundle 输入为空，新增外置只有 `react/jsx-runtime`，实际安装还需验证。Superseded by 本节“综审修复波成本”（2026-11-03），此处保留修复前观察。

旧混合 fixture 中 Chromium 会把可横滚 pre 放入 Tab 顺序；该观察不能证明 code-only 抽屉可达：既有 cycleFocus 只枚举显式焦点目标，只有关闭按钮时会提前循环。2026-11-03 的独立最小反例推翻了此前完整键盘接受假设；当前叶子显式提供 pre 焦点入口，并用独立 code-only 浏览器用例覆盖。

后续组合回归暴露测试末项返回目标写死为关闭按钮；有展开按钮时，正确的抽屉循环应回到首个可访问 header action。该失败不涉及代码可达或横滚失效，修正测试契约后两个实际代码变体均绿；不据此修改公共 focus 系统。

综审反例已验证适用：`'> '.repeat(2000) + 'text'` 在 production Chromium 实际 `Target crashed`，SSR 出现 RangeError；`[a <https://evil.invalid/in>](https://evil.invalid/out)` 得到两个 anchor。新增测试分别确认这些 RED，再在叶子内增加迭代深度预算和后代交互检测；修复后的降级原文包含脚本/图片语法时也只是完整安全文字，无链接或可执行节点。

综审波完整 `pnpm test` 两项失败的根因：bundle-report 的 sourceFixture 从 HEAD 创建临时 checkout，只手连工作区与 esbuild，未安装新增 parser 依赖；此前在计划 commit 上跑全量，临时 HEAD 尚无 parser 导入，所以未显现。fixture 现在确认 pnpm 10.28.2 后执行 `pnpm install --offline --frozen-lockfile --ignore-scripts`，保持 source-drift、realpath 和外部输入原判据。修复后相关 19 项全部通过。

综审修复波成本（2026-11-03 SGT，同工具链/flags）：客户端 646467 raw / 135888 gzip，较基线增加 418095 / 83517 字节（81.6 KiB）；比修复前 gzip 增加 209 字节。Host 不变；tgz 282319，较基线增加 83974 字节。最终以 clean report 的 source.head 与 `git rev-parse HEAD` 相等为证，完整 inputs、React singleton 和 hash 保留于同次报告。

## Decision Log

Decision：采用React节点parser与显式白名单组件。Rationale：保GFM解析正确性，在唯一叶子约束导航和媒体，拒绝HTML二次信任边界。Date/Author：2026-11-03 SGT / 独立综审。

Decision：固定 react-markdown 10.1.0 / remark-gfm 4.0.1，只接入 remark-gfm（后续综审补充本叶子的迭代结构预算 transformer）、允许元素集与白名单 React components；URL transform 仅收绝对 HTTP(S)。Rationale：已读两依赖官方 README Security：自定义 URL/component 是额外安全边界，所以不放行其它 plugin 或 HTML，不 spread 未审属性。Date/Author：2026-11-03 SGT / markdown-owner。

Decision：扩大受控测试文件集，保留未知模块、node:* 和工作区层的拒绝规则。Rationale：完整回归证明 browser parser 的 JSX 和 DOM 条件入口是既有 VM fixture 的真实兼容缺口；新增适配只在测试环境提供官方实现，不改生产门禁。Date/Author：2026-11-03 SGT / markdown-owner。

Decision：采纳独立综审后本波保留 react-markdown + GFM，接受修复前约 81.4 KiB、修复后 81.6 KiB gzip 增量超过 20 KiB soft target。Rationale：更轻的官方 Marked lexer 隔离入口为 16398 B gzip，只是未含完整安全 React presenter、实体语义、媒体/task/嵌套策略的 lower bound；当前没有真实 Host/SLO 失败或 hard budget 违约证据，整体替换会重新扩大已审安全边界。此裁决不把依赖成本说成轻微，也不提前宣称替代件达标。Date/Author：2026-11-03 SGT / 主控明确采纳独立综审。

Decision：不可信正文在递归转换与挂载前执行局部 64 层结构预算，超限只降级本次呈现为完整纯文本。Rationale：精确低 KB 输入确实导致 browser target crash，ErrorBoundary 无法恢复 renderer process；remark 阶段迭代预算在风险阶段之前，且不改变数据契约。Date/Author：2026-11-03 SGT / markdown-owner。

Decision：按本次已授权的评审修复，在 SafeMarkdown 的 components 增加显式、具名 pre 焦点区，不修改公共抽屉 focus 系统。Rationale：code-only 最小用户路径已先红，问题是浏览器隐式滚动焦点与现有显式枚举之间的叶子契约缺口；一行 presenter 直接补齐，保留代码文字、局部横滚及安全边界。Date/Author：2026-11-03 SGT / 本轮修复 owner。

## Idempotence and Recovery

渲染和测试幂等；依赖变化重新frozen install、pack与安全矩阵。revert本PR及重建包恢复原阅读行为，无数据库恢复。

## Interfaces and Dependencies

输入只有已获准body字符串；不加sourceURL、Provider或raw store参数。React保持Host单例；所选依赖版本以实施时官方安全文档和锁文件为证，现有peer范围兼容必须typecheck/build证明。

## Outcomes & Retrospective

Batch 1实现、P1/P2独立修复复评与Batch 2成本/实际安装分层验收完成；安装样本、精确source/artifact及字体/网络测试边界见Progress。客户端gzip+83517B（81.6KiB）超过20KiB软选择目标的取舍由主控采纳并在PR显式提示；未以lexer-only lower bound冒充完整安全替代。托管全套结果只以最终head回读为准，旧分次修复证据不合成为一次完整绿；R1发布接受独立。语言高亮、相对资源解析和自动远程图片不是本片延期债务；若实现为预算主动删去必须验收项，应记录债务并重切片。

上述安装与成本数值属于其固定历史 source。当前 code-only P2 修复改变生产 presenter 输入，不能再把旧 tarball 或旧组合安装件称作与本次修复逐字相同；本轮只完成真实生产 bundle 的局部键盘/安全/详情验证，当前候选安装、成本与独立复评仍需由主控回读。

## Bottom Change Note

2026-11-03 SGT：综合A1/B-M与源码；固定nested image安全、局部pre修复和同build成本门。

2026-11-03 SGT：记录实际 RED/GREEN、CSS 变异、3389 项完整回归；补充官方 parser 导致的既有 fixture 环境兼容范围，保留安装未验边界。

2026-11-03 SGT：补记规范化控制字符的 RED/GREEN、完整组合浏览器通过及同 flags 客户端成本；保留超目标取舍和真实安装未验事实。

2026-11-03 SGT：记录完整独立综审的真实 crash 与 nested-autolink 反例、迭代深度降级修复、临时 checkout 依赖准备和成本裁决；保留复审与安装未验状态。

2026-11-03 SGT：独立scoped复评与真实安装样本完成，保留实际安装200%与网络输入未测边界，归档计划；最终CI按发布head回读。

2026-11-03 SGT：补入 #512 唯一 P2 的 code-only Tab/横滚 RED→GREEN、局部具名 pre presenter 与旧安装证据失效边界；保留 Completed 路径和既有索引，待独立复评及主控当前候选验收。

2026-11-03：本会话人类直接授权 #512 等八 PR 经修复、独立复评和当前门禁后以 rebase merge 收尾；旧交付阶段不自行合并约束由此替代。P2 修复独立复评原反例1/1、相关33/33及typecheck通过，最终组合与新安装接受记录于本批评审；旧包不能替代新生产输入。

2026-11-03 SGT：纠正 code-only 测试对末项 Tab 返回按钮的过度指定，保留代码焦点与方向键滚动判别；记录 owner/组合两个变体的真实聚焦结果，无生产改动。

2026-11-03：最终 clean 组合 `33472f2b1451b508b3d1c15d06acf3a078058bd7` 完整3474+7、browser35、boundaries9及workflow通过；新包 `7209b6e64a5572f68312bb57b43ad7fa8010d743f7995a63c9b92541a72c115a` 实际安装12文件逐字节相同。#110真实短code两次Tab可进入显式区域；长code横滚保留生产浏览器证据边界。联合详情/表格/原生关联与200%光暗布局通过。包成本相对旧组合仅client+20B gzip/Host+198B gzip，详细原20KiB软目标权衡与计数观察边界见批次评审。
