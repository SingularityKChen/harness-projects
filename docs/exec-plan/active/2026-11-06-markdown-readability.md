# Markdown 阅读一致性 ExecPlan

> 状态：Active；创建：2026-11-06；执行分支：`fix/markdown-readability`
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
- [ ] (2026-11-06 SGT) Batch 1：设计冻结、baseline、关联 draft PR。
- [ ] (2026-11-06 SGT) Batch 2：两缺陷 RED/GREEN 与独立负控。
- [ ] (2026-11-06 SGT) Batch 3：独立验收、组合与最终 Ready。

## Surprises & Discoveries

2026-11-06 两独立探针与源码审读：html AST 节点可能包含 comment 后 tail，因此删节点会静默丢正文。
2026-11-06 源码审读：当前 suite 只数 disabled checkbox，不能发现重复圆点或错误缩进；必须增加 computed style 与几何证据。
以上是设计依据，不是本 PR 新实现或真实 Desktop 验证结果。

## Decision Log

2026-11-06 / 人类授权、综合审读者记录：#538+#542 是一个阅读闭环，同一 PR；不扩大到编号/linkification/编辑。
2026-11-06 / 综合审读者：沿用 remark pipeline、先深度 guard 后 HTML span filter；理由是保留代码语义及安全 fallback。
2026-11-06 / 综合审读者：仅 task-item 局部 CSS；理由是普通列表与多 block/nested 结构不能被全局 marker/flex 改动破坏。
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

当前仅完成可执行设计综合；未改展示器、未运行新增用例、未操作 Desktop，不能宣称实际缺陷已修复。
工程完成后写实际结果/偏差并迁至 completed，由协调者更新索引；未做的真实安装件复查保留明确 human follow-up。

## Bottom Change Note

2026-11-06 SGT：结合两独立设计锁定 comment span 而非整节点删除、局部 task marker/几何验收与工程/人类证据边界。
