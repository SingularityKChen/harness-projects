# Markdown 阅读一致性 ExecPlan

> 状态：Completed；创建：2026-11-06；执行分支：`fix/markdown-readability`
> 范围：#538 与 #542 的同一阅读闭环；遵循根级 `PLANS.md`。

## Purpose / Big Picture

详情正文的任务列表只显示 checkbox 任务标记，长行按正文起点换行；正文 HTML 注释不进入可见 prose。
相邻正常文字、普通列表、代码字面量和既有安全阅读行为完整保留。
最小证据是受控浏览器的 marker/几何/可见与可访问文本断言，以及真实 renderer 的代码和安全正控。

## Context and Orientation

用户于 2026-11-06 批准四 issue、三 PR，其中 #538+#542 合为一个可独立验收、合并和回滚的 Markdown PR。
#538 是任务 marker/缩进显示缺陷，不是 checked state 错误；不能引入 checkbox 交互或 Provider 写回。
`packages/ui/src/safe-markdown.ts` 使用现有 react-markdown 与 remark-gfm；HTML 目前保持惰性文字，图片只能显式打开来源。
现有深度检查迭代遍历 mdast，过深输入回退完整 code literal，保护后续递归与 DOM。
`packages/ui/src/markdown-presentation.ts` 给普通列表缩进、checkbox margin，但没有 task-item marker 规则。
`tests/browser/safe-markdown.test.js` 已有真实 drawer、窄屏、代码/表格横滚、网络与权限安全载体。
两独立设计在当前依赖上发现：`<!--hidden-->tail` 可产生同一个 html AST 节点，节点 value 同时含 comment 与可见 tail。
因此删除整个 html node 会丢正文；修复必须处理注释跨度而不是删尽 HTML。

## Design / Spec

### 任务列表

仅 `.hp-markdown .task-list-item` 取消普通 list marker；普通 ul/ol marker 保留。
保持原 checked 状态、disabled/readOnly 和不进入 Tab 顺序；不新增本地编辑状态。
用局部 marker 槽位与悬挂缩进使 checkbox 位于正文左侧，换行与首行正文起点对齐。
同时支持 tight list 的 direct input 与 loose list 的首段 input、nested task、任务内普通子列表及多 block 内容。
过滤后首段没有可见文字时，task li 与首段仍各保留至少一个当前字体行盒（`1lh`），防止绝对定位 checkbox 重叠或挤入后续段落。
不把整个 li 改为 flex/grid：那会破坏 nested list 与多段 block 的纵向结构。
使用 logical CSS 属性，保留 Host 字体/颜色/主题，普通列表、code/table 局部横滚与详情 focus trap 不变。
具体尺寸以真实 rect 判据收敛，不依赖 screenshot 像素 hash 或仅数 checkbox 通过。

### HTML 注释

增加私有 remark transformer；先运行既有深度 guard，再迭代检查剩余树的 `html` 节点。
只过滤 AST 已认定 raw HTML segment 内的 comment spans，不扫描原始 body、text、inlineCode 或 code。
识别 `<!--` 到首个 `-->`，支持多个跨度和多行；移除跨度后完整保留同节点前后所有非注释字符与 Unicode/空白。
剩余 raw value 继续现有 escaped/inert 显示路径，不重新解析为 Markdown/HTML，不创建 DOM、不启用 rehype-raw。
不得删除整个非空节点，不能把行首注释后 tail、多个 comment 间 visible text 一并吞掉；仅空剩余节点可移除。
有限线性扫描跟踪 tag/引号，属性值中的 `<!--literal-->` 属惰性 HTML 属性文字，必须保留；不能把它错当 prose comment。
raw tag 之外真实 comment（例如 `<div><!--hidden--></div>`）过滤跨度，其它 tag 字符仍是惰性文字。
2026-11-06 评审 F551-1 后补充：raw-text/RCDATA 元素内容与 CDATA 整段属于惰性字面量，保留其中的注释形状文字；只在正确结束标签/`]]>` 后恢复真实 comment 过滤。内联 HTML 可能分为多个 sibling 节点，按文档顺序共享 paragraph/heading/tableCell 的局部上下文；独立 Markdown block 与表格单元格不共享，避免未闭合 raw tag 吞掉另一块正文注释。
此 helper 是注释过滤器，不是通用 HTML parser；不承担 entity decoding、tag normalization 或 DOM 修复。

### 畸形、代码与安全边界

先用当前 parser 锁定 malformed 样例的 AST 归属：只有 html 节点中的真正 opener 才受处理。
html 节点内未闭合 comment 从 opener 过滤到该节点结束，确定性终止；不跨节点寻找结束，不吞后续独立 code。
嵌套 opener 不增加嵌套深度，首个 closing delimiter 结束跨度；内部 `--`、`<!-->`、`<!--->` 用 fixture 明确行为。
escaped text 或 parser 未识别为 html 的 opener 原样保留；inline/fenced code 的同样标记逐字可见。
深度 fallback 本身是 code literal，保留原文注释示例是正确行为，不能为了隐藏 prose canary 破坏该保护。
普通 inert script/img/svg/attribute text 不成为可执行元素；URL 白名单、零自动媒体、权限 gated presenter 不变。
注释隐藏不是保密机制；authoritative body 仍原样存在，不能声称删除了源数据或安全清洗了任意 HTML。

### 方案取舍

选择现有 parser + AST span 过滤 + 局部 task CSS，保持读取 owner 与安全架构。
拒绝全局 body regex：会误删代码、转义示例并跨 Markdown 节点。
拒绝 skipHtml/整 node 删除：会静默丢弃正常 HTML 文字及同节点 comment 后正文。
拒绝新 parser/rehype-raw/整套 GitHub CSS：扩大解析、安全和样式范围，不能改善本轮最小证据。
拒绝定制 li wrapper：多 block 与 nested list 结构代价大，当前 class 已有精确任务标记。

## Global Constraints

唯一完整改动集合：`packages/ui/src/safe-markdown.ts`、`packages/ui/src/markdown-presentation.ts`、`tests/contract/ui-safe-markdown.test.js`、`tests/browser/safe-markdown.test.js`、按需 `tests/fixtures/safe-markdown-browser.mjs`、本计划及必要阅读说明。
本 PR 一个 owner 同时修改两个展示器；#547/#548 的 execution/PR owner 不写这些文件，文档索引由协调者维护。
不改 parser 依赖版本、公共 SafeMarkdown API、存储、权限源、Planning/Provider 状态、表单交互或 Host 设置。
不新增 DDL、兼容层、媒体请求、外部写入、模型调用或 Desktop 操作；代码正文不重写 source body。
每 PR code/test/config 增删少于 800 行、文档少于 1300 行；预计规模只作预算，实际 diff 审核后记录。
#538/#542 工程修复可交 Ready；实际安装件视觉复查及 #72/#143/#449/R1 的人类判断另行保留。
若 issue 的 human AC 需要后续记录，只报告工程子项并保留明确人类 follow-up，不勾未观察项。

## Plan of Work

所有命令在检出 `fix/markdown-readability` 的 `.worktrees/iteration9-markdown-readability` 根目录运行；记录实际 head、时间与结果。

### Batch 1 · 设计冻结与 Draft PR

最小闭环：收敛两 issue 的一个阅读契约，关联 draft PR，并锁定 renderer/parser 实际基线。
涉及主文件：本计划；建立 fixtures 与 red 测试设计，生产行为保持基线。
步骤：核对 realpath/branch/status，确认 renderer 的当前 AST/DOM，记录同节点 tail 与列表 marker 的判别方法；协调者整理文档提交并创建关联两 issue 的 draft PR。
验证命令：

    pnpm test:file tests/contract/ui-safe-markdown.test.js
    pnpm test:file tests/browser/safe-markdown.test.js
    git diff --check origin/main...HEAD

期望：既有 baseline pass；新契约未实现时不得声称 comment/marker 已修复。
回滚：撤销本批文档提交，source body、数据库、Provider 无变化。

### Batch 2 · RED → GREEN 两项阅读缺陷

最小闭环：先用实际 drawer renderer 和浏览器让每个独立 defect 的判别测试 RED，再实现 span filter 和局部 task CSS。
涉及主文件：两个展示器与对应 safe-markdown tests。
comment RED 必含 inline/block/multiline、行首 tail、多 comment 中间文本、comment-only、属性引号、未闭合/畸形，以及代码/转义正控。
marker RED 必含 task li computed list-style none、普通 ul/ol marker 保留、多行首/次行 rect 对齐、nested 与 loose task，禁止仅数 checkbox。
GREEN 后逐项负控：临时关闭 comment transformer 只让 comment prose 判据失败；临时撤销 task CSS 使 marker/geometry 判据失败；负控变更不能提交。
验证命令：

    pnpm test:file tests/contract/ui-safe-markdown.test.js tests/browser/safe-markdown.test.js
    pnpm typecheck

期望：两缺陷各有独立 RED/GREEN 与负控，全部安全正控 pass；不扩大为 HTML parser。
回滚：撤销本批展示器与测试提交，无源正文修改或数据反向迁移。

### Batch 3 · 独立验收、组合与 Ready

最小闭环：独立审读 AST/样式边界，在生产 drawer 与实际应用样式组合中复核，然后交最终可评审 head。
涉及主文件：本计划实际证据与必要 fixture/test 修订。
受控矩阵至少 320px/1024px/1440px、正常/200%文字、light/dark、preview/expanded；选择覆盖风险的最小组合，不机械跑全笛卡尔积。
使用 Range rect 在各层级比较正文首/次行 x（容差 2 CSS px），checkbox 在正文左侧且不重叠；普通列表与任务内多段结构保持。
注释 prose canary 从 innerText 与 accessibility snapshot 消失，代码正控保留；零媒体请求、零 pageerror/crash，Tab/Escape 与代码/表格滚动保持。
验证命令：

    pnpm test:file tests/contract/ui-safe-markdown.test.js tests/browser/safe-markdown.test.js tests/browser/detail-expand.test.js
    pnpm typecheck
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD
    gh pr view --repo SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,mergeStateStatus,statusCheckRollup,closingIssuesReferences,reviewDecision
    gh pr checks --repo SingularityKChen/harness-projects

期望：相关 tests、人工发布五类目与实际规模通过；最后 push 后回读当前 head/base、全部线程、两 issue 关联及 checks，`PR Fast Gate` pass；其它 advisory 真实归因。
协调者在三个最终 head 的组合检出复跑本浏览器 suite，核对实际 WorkItemApp 插入样式顺序没有覆盖局部 task 规则。
整理临时/fixup 提交后 push；已推历史重写遵守 backup ref 与精确 lease；独立验收通过后由协调者标 Ready，不合并。
回滚：整 PR revert，阅读缺陷重新出现但 source body/外部状态保持；不需数据恢复。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 单一 task marker | task computed marker 为 none，普通 ul/ol 保留；checked/unchecked disabled/readOnly |
| 隐藏全部任务文字 | tight/loose/multiblock 首行≥当前字体行高、marker纵向不交叠、后续段落独立 |
| 长行/层级可读 | tight/loose/nested 多行 rect 同起点、无 checkbox 重叠、窄屏/200%无页面横溢 |
| 注释隐藏且邻文保留 | inline/block/multiline 与 `<!--x-->tail`、多个 span 的可见文本断言 |
| 代码/属性字面量保留 | inline/fenced/escaped 与 quoted attribute 正控逐字相等 |
| 畸形确定终止 | 未闭合、内部双横线与嵌套 opener fixtures；无跨节点删除、无新递归 |
| 既有安全不变 | inert HTML、safe URL、无图片请求、redacted/unavailable/loading/unresolved/wrong-workspace 不挂载 |
| 键盘与深度可用 | disabled checkbox 不抢焦点；Tab/Escape、code/table 横滚、deep fallback 正控 |
| 可独立评审回滚 | 两独立负控、独立验收、远端最终 head/readback、发布与规模记录 |

人类 Desktop 复查须另记 source/build/installed artifact/Host version 与实际视图；未做时写“工程验证完成，人类 Desktop 复查待做”，不阻止工程 Ready，也不替代父项产品验收。

## Progress

- [x] (2026-11-06 SGT) 综合两份独立设计与当前 owning code，记录 AST tail 风险。
- [x] (2026-11-06 SGT) Batch 1：设计冻结；既有 9 项 contract/browser baseline 通过；Draft PR #551 双向关联 #538/#542（协调者回读）。
- [x] (2026-11-06 SGT) Batch 2：先得 3 项预期 RED（注释 contract/browser + task marker），实现后相关 12 项 GREEN；两独立负控分别失败且已还原。
- [x] (2026-11-06 SGT) Batch 3 首轮本地部分：相关 contract/browser/detail-expand 17/17；typecheck；完整 pnpm test 3593/3593。
- [x] (2026-11-06 SGT) 独立评审 F1 修复：三种 comment-only task 先 RED，再为 li 与首段各保留 1lh；8 项 browser GREEN。仅撤掉首段行盒的负控使 loose/multiblock 两项失败，证明 li 行盒本身不足；最终 covering 20/20、full 3593/3593、typecheck 通过。
- [x] (2026-11-06 SGT) Batch 3 余项：协调者独立验收、三个 PR 组合检出、最终发布检查与远端回读。
- [x] (2026-11-06 SGT) Batch 3：独立验收、组合与最终 Ready。

## Surprises & Discoveries

2026-11-06 两独立探针与源码审读：html AST 节点可能包含 comment 后 tail，因此删节点会静默丢正文。
2026-11-06 源码审读：当前 suite 只数 disabled checkbox，不能发现重复圆点或错误缩进；必须增加 computed style 与几何证据。
以上两条是设计依据。实测 parser 将行首 `<!-->`/`<!--->` 分到 html 节点；段落内未闭合 opener 是 text，后续独立 fenced code 仍为 code。实现只处理 html 节点，遵守此边界。
2026-11-06 本地负控：停用 transformer 时仅两项注释测试失败，10 项通过；撤掉 task CSS 时仅布局测试失败，11 项通过，首/次行 x 为 86.1875/57 CSS px，差 29.1875。已恢复两项生产改动。
2026-11-06 初版 App fixture 未设置有界 Host shell，flex project 高度为 0、dialog 高度为 2px，按钮中心命中 backdrop；baseline 与实现均相同。补齐既有 shell 合同（100dvh flex 容器）后，两者 dialog 高 836px，320px/200% 下 pointer 点击展开、键盘 Enter 还原均成功。新测试恢复 pointer 点击，并先把任务滚入正文 scrollport，断言首个 checkbox 可见，防止离屏几何假阳性。

2026-11-06 独立评审 F1：隐藏 task 唯一 prose 后，绝对定位 checkbox 使 tight/loose 空行坍缩，multiblock 首段为零高；已用三项独立浏览器回归确认，并用当前字体行盒同时约束 task li 与首段。

## Decision Log

2026-11-06 / 人类授权、综合审读者记录：#538+#542 是一个阅读闭环，同一 PR；不扩大到编号/linkification/编辑。
2026-11-06 / 综合审读者：沿用 remark pipeline、先深度 guard 后 HTML span filter；理由是保留代码语义及安全 fallback。
2026-11-06 / 综合审读者：仅 task-item 局部 CSS；理由是普通列表与多 block/nested 结构不能被全局 marker/flex 改动破坏。
2026-11-06 / 实现者依据独立评审 F1：保留悬挂 checkbox 与原 block 结构，只为 task li 和首个段落各设置 min-block-size:1lh；不改变 parser 或普通列表。
2026-11-06 / 综合审读者：工程 Ready 与安装件视觉/父 issue/R1 人类裁决分开；无需新增付费模型或完整 UAT。

## Idempotence and Recovery

render 与只读测试可重复，不保存派生正文；过滤只影响当前展示，权威 source body 不变。
负控仅为本地验证，完成立即还原；提交前 diff 确认不存在关闭安全转换或 marker 修复的调试改动。
parser 分类若推翻假设，先更新原设计结论与判据，不用删除整个 node/放宽测试绕过。
回滚整 PR 无数据迁移。若发现必须延期的维护缺口，记录 `docs/exec-plan/tech-debt-tracker.md`；不得延期邻文保留、代码或安全正控。

## Interfaces and Dependencies

保持 react-markdown@10.1.0、remark-gfm@4.0.1 与现有浏览器 Playwright；不新增 parser/HTML DOM 依赖。
SafeMarkdown 仍只接受已通过详情权限门的 `body:string`，不接触 raw store/Provider/来源 URL。
浏览器 fixture 必须复用真实产品 renderer；可测 rect/可访问文本，但不为测试向产品插额外语义包装。

## Outcomes & Retrospective

本地实现完成：深度 guard 后迭代过滤 HTML comment spans，同节点尾文、属性/代码/转义字面量保留；局部 task marker 与悬挂 checkbox 保留 ordinary/nested/loose block 结构。
真实 WorkItemApp（production React）fixture 验证工作区 style 位于 drawer style 之后，四个风险组合覆盖 320/1024/1440px、100%/200%文本、light/dark、preview/expanded；每层 task 首/次行 Range x 差 ≤2 CSS px，checkbox 不重叠、无页面横溢，普通 disc/decimal 保留。
F1 修复后相关 20 项测试与完整 3593 项 suite 无失败、跳过或取消；可见与 AX 文本不含 prose canary、代码/属性正控保留、自动请求为 0、无 pageerror/crash。发布机械检查在实现提交后回跑；人工五类目已审查新增源/测试/计划，无凭据、本机身份、账号个人信息、内部系统或保密字样。
工程实现已通过协调者安排的独立验收；人类 Desktop 复查待做，不替代 #72/#143/#449/R1 人类判断。
最终工程结果与计划迁移见本节收口记录；未做的真实安装件复查保留明确 human follow-up。



2026-11-06 17:21 SGT / 协调者最终工程验收：代码在 `768b0a30ca8b` 已经独立全量审读及修复复评，P0/P1/P2/P3 均无遗留。安全 AST 注释跨度过滤保留邻文与字面量；任务 marker、长行悬挂与过滤后空首段的行盒通过真实生产组合验证。
完整 pnpm test 3593/3593；contract/browser/detail 20/20；独立 tight/loose/multiblock 探针与 4/4 scoped 正控通过；注释、marker 与首段行盒负控均产生预期失败并已恢复。
最终三能力组合在 `test/iteration9-critical-path-integration`、观察 head `58259b340fa9` 运行 `pnpm verify`（typecheck、3566/3566、MVP-0 8/8）、`pnpm boundaries`（9/9）、两能力 Host/ABI/恢复定向 243/243，以及 `pnpm test:file tests/browser/workspace-execution.test.js tests/browser/safe-markdown.test.js tests/browser/detail-expand.test.js`（17/17），均通过。组合只在本地模拟；两份 Host ABI 测试冲突保留了 task 与 Draft 两侧断言，不包含仓库 main 合并。
最终发布 head 仅在上述已审代码上收口本计划、索引及必要用户说明；以 `gh pr view 551 --repo SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,mergeStateStatus,statusCheckRollup,closingIssuesReferences`、`gh pr checks 551 --repo SingularityKChen/harness-projects` 和 reviewThreads 回读当前状态；只有最终 head 的 `PR Fast Gate` 通过才转 Ready。不能沿用旧 head 的 checks。
工程验收完成，计划迁入 completed；真实模型、安装件 Desktop 复查、#72/#143/#449 与 R1 人类裁决继续保留。未新增必须延期的技术债；revert 不撤销已确认的外部资源或未知回执。

## Bottom Change Note

2026-11-06 SGT：结合两独立设计锁定 comment span 而非整节点删除、局部 task marker/几何验收与工程/人类证据边界。

2026-11-06 SGT：记录 Batch 2 RED/GREEN、独立负控、真实 App 样式顺序、17/3593 本地测试结果及安装件人工复查边界。

2026-11-06 SGT：按独立评审 F1 补齐纯注释任务的当前字体行盒，保留 tight/loose/multiblock 的垂直结构与三项回归。

2026-11-06 17:21 SGT：记录最终独立复评与三能力组合证据，迁移完成计划并同步索引及必要演示说明；最终发布按当前 PR head 回读门禁，保留全部人类验收边界。


## F551-1 修复补记（2026-11-06）

正式评审 review `5798593124` 在 `f5b41ff4194b94f6ae7f05bcc075bb3b52e38827` 发现两项 P2；本段只记录 F551-1 源码修复，PR closing references 的 F551-2 由协调者另行处理。人类已授权修复、独立复评与随后按具体 PR 合并，源码修复者本轮不提交、推送或合并。

根因：原扫描器只记 tag/quote，opening tag 的 `>` 后错误地把 script/style/textarea 及 CDATA 内的字面量都当 comment。原先的 html-node 边界也不足以保护段落中的 `<textarea>`/comment/closing-tag 三个 sibling。

最小修复：保持现有 mdast → escaped text 路径，补 raw-text/RCDATA 与 CDATA 扫描上下文，普通 raw-text/RCDATA 使用匹配结束标签的名称与边界（大小写不敏感，不把 `</textareax>` 当 `</textarea>`）；script 另按下述第二轮有限状态修复处理；未闭合上下文保留剩余 literal 并终止。只在 Markdown phrasing 容器 paragraph/heading/tableCell 内共享 inline HTML 上下文；块级 html 自含，独立块/单元格不串扰。没有新依赖、HTML 执行、CSS、Provider 或存储改动。

TDD：先增加 SSR/production browser 两项用户结果回归，原代码 17 项中 15 通过、2 因 textarea 字面量缺失而失败；生产修复后 17/17。再增加 heading/tableCell 的独立 inline scope 反例，9 项 contract 中 8 通过、该项因 heading literal 缺失失败；扩展局部 scope 后最终 contract/browser 18/18、无失败/取消/跳过，`pnpm typecheck` exit 0。浏览器同时断言可见/AX literal 保留、相邻 prose canary 隐藏、active textarea/script/img/iframe/svg 和带 src/srcset 元素为 0、只存在可信 Markdown style、网络请求及 pageerror 为 0；原布局/空任务行盒/depth/permission 测试均通过。

最终树使用 `node scripts/review-mutate.mjs <spec.json>` 完整表重跑，四项均指定 `killedBy`：raw context 失效、CDATA 失效、inline sibling context 丢失由 `inert HTML literal contexts preserve…` 杀死；heading/cell scope 丢失由 `heading and table cell raw HTML literals keep their inline scope` 杀死。运行态 spec/log 保存在根仓库 `.superpowers/pr549-551-mmp-review-20261106/agent551-repair/`；源码按字节还原，变异只证明当前新回归的判别力。

本轮仅承担最窄受影响 suite 与 typecheck；完整组合、最终 immutable head、远端 checks、独立修复复评与 F551-2 回读由协调者补齐。未声称安装件 Desktop 或父项/R1 验收完成。


### F551-1 第二轮：script 双重转义（取代首轮残余边界结论）

另一独立评审者确认 `<script><!--<script> A </script><!--B--></script><!--HIDE-->tail` 仍丢 `B`。因此上节 18/18 与四项负控只证明首轮已列案例，不构成 F551-1 全部关闭；不得沿用首轮 green 宣称修复已独立通过。

第二轮先增加 contract/browser 精确反例并观察 RED：20 项中原 18 项通过，两项新增因 DOUBLE literal 缺失失败。再为 script raw context 增加 normal / escaped / double 三态；normal 的 `<!--` 进入 escaped，escaped 中 `<script` 名称及合法边界进入 double，double 中匹配 `</script` 只回到 escaped，escaped/double 中 `-->` 回到 normal，只有 normal/escaped 的匹配 closing tag 结束保护。大小写、名称边界、真实结束后的注释隐藏由独立手写 fixtures 约束；不是新增通用 HTML tokenizer 或执行路径。

内联 script 的转义标记可能位于 Markdown text/code 与 HTML sibling 之间，因此状态推进使用位置 offset 对应的原始 source gap，而非可能已 entity-decode 的节点 value；不修改 code/text 内容。scope 仍限各 phrasing 容器，迭代遍历和既有深度 fallback 不变。新增位置类型首次 typecheck 因 exactOptionalPropertyTypes 与 HAST optional position 不兼容而失败，显式允许 undefined 后重跑 typecheck exit 0。

第二轮最终窄 suite：`pnpm test:file tests/contract/ui-safe-markdown.test.js tests/browser/safe-markdown.test.js`，20/20，无失败/取消/跳过（3289.380459ms）；`pnpm typecheck` exit 0。浏览器同时断言精确 double/inline/split literal 的可见与 AX 文本、有效 closing 后 canary 消失、unsafe DOM/请求/pageerror 为 0；保留全部原有 layout/code/attribute/malformed/redaction/depth 正控。

最终源码的变异整表重跑一次（`mutations-wave2.json`）：前四项加上 early script close、遗漏 `-->` 回 normal、忽略 inline source gaps，共七项均 KILLED，分别归因到指定 `killedBy`，fixture baseline 与还原校验通过。记录为 `.superpowers/pr549-551-mmp-review-20261106/agent551-repair/mutations-wave2.log`。第一轮变异表是历史证据，最终判别力以这七项为准。

第二轮修复者已停止源码写入；下一道门仍是原独立评审者复评、协调者重跑组合并锁定新 immutable head。没有提交、推送或远端写入；没有人类安装件验收结论。


### F551-1 第三轮：source-gap 权限边界（取代第二轮完整关闭假设）

第二轮独立复评只剩同根因 P2：``before <script>`</script><textarea>`<!--HIDE-->tail`` 的 code gap 虽先结束 script，却被复用的完整 HTML scanner 又开启 textarea，导致真正 prose comment 泄漏。第二轮 20/20 和七项负控未覆盖这个 authority 边界，保留为历史有界证据，不构成最终关闭。

因果修复：提取 `rawTextEnd`，它只推进已经开启的 script/raw-text/RCDATA context，并在有效 closing 立即返回；不扫描 closing 后的尾部，不开启任何新 context。HTML AST 节点仍由完整 span scanner 解释 opener；code/text 原始 source gap 只调用受限 helper，既可正确推进 script 转义状态，也可结束 textarea/style 等已有上下文。没有按特定标签尾串补丁，也没有扩大到通用 parser。

TDD：先增加确切 script→textarea、script→script、textarea→script、style→textarea 的 code-only opener 反例，以及后续真正 HTML-node opener 正控；contract/browser 22 项中原 20 项通过、两项新增因 HIDE/PROSE-CANARY 可见而失败。修复后同命令 22/22（3543.566666ms），无失败/取消/跳过；`pnpm typecheck` exit 0、`git diff --check` exit 0。浏览器正控同时保留 code 字面量与真正 HTML-node literal，可见/AX 没有 prose canary，unsafe DOM/网络请求/pageerror 均为 0。

最终树整表一次重跑 `mutations-wave3.json`：原七项加“gap 重新调用完整 scanner”和“非 script gap 不处理结束”两项，共九项全部按 `killedBy` KILLED，baseline 与按字节还原检查通过；最终日志为 `.superpowers/pr549-551-mmp-review-20261106/agent551-repair/mutations-wave3.log`。前两轮表保留为历史，仅本九项代表当前源码判别力。

第三轮源码冻结供同一独立评审者复评；协调者只在独立结论无遗留后重跑全组合与远端最终 readback。本修复者没有提交、推送或外部写入，尚不宣称 F551-1 经独立关闭。
