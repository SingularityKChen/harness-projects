# PR #551 MMP 交付评审

> 首轮发现及各修复波次属于明确标注的历史对象；当前工程闭环结论见末尾“实际 main 接合与最终复评”。

## 锁定事实与边界

- base：`609463d8ee78a0cc83352512994e2b943e6e57bc`。
- head：`f5b41ff4194b94f6ae7f05bcc075bb3b52e38827`。
- 执行上下文：`.worktrees/iteration9-markdown-readability`；独立只读评审，唯一跟踪写入为本记录。
- 目标：验证 Markdown 评论隐藏及任务列表展示满足 #538/#542，保持只读展示、原始正文与信任边界。远端状态与提交评审由主评审汇总。

## 初始 P0/P1/P2/P3 风险矩阵

| 层 | P0 / P1 待证伪风险 | P2 / P3 待核查风险 | 最小判别证据 |
|---|---|---|---|
| 代码 | 评论过滤破坏代码/链接/原始 HTML 语义；脚本或交互输入进入展示 | 多行/内联/嵌套任务列表格式退化 | diff、解析 AST 与渲染反例 |
| 产品闭环 | 原始正文或规划事实被展示层修改；验收主路径不成立 | 只读复选框可访问性、对齐与可读性 | 组件入口、#538/#542、DOM 与样式 |
| 架构 | 新事实源、跨层 API、信任边界扩大 | 重复解析、过度抽象或依赖范围增加 | 数据流、依赖差异 |
| 测试 | 安全与多块解析缺少有效断言，测试只镜像实现 | 布局/键盘/空输入未覆盖 | 有关测试真实输出、反例与有判别力变异 |
| 工作项 | scope 与 acceptance 不一致、重复关闭已有跟踪 | 文档证据或回滚不完整 | ExecPlan、issue 接受标准与仓库检索 |

初始矩阵为风险假设，不是缺陷结论。

## 评审结论

当前 head 未发现 P0/P1；两项 P2：F551-1 是惰性 HTML 字面量丢失，F551-2 是 PR closing references 与未完成的人类验收不一致。按仓库严重度，结论建议为 APPROVE 并记录两项修复；不推导合并授权或产品验收。

采用 Superpowers、Qian Systems Router 和 First Principles Development 的审查路径：从“授权正文的只读阅读结果”追踪到展示 owner，再用最小反例核查注释语义、布局及安全边界。事实是 HTML 仍被转义、源 body 不变；“html AST 节点的所有注释形状文字都是真注释”是被反例推翻的假设。

## 完成矩阵

| 层 | P0/P1 结果 | P2/P3 结果与证据 |
|---|---|---|
| 代码 | 无执行、持久化、并发或恢复新增路径；扫描迭代终止，深度 guard 先运行 | F551-1；inline/block/multiline、多跨度、tail、引号属性、code/autolink 正控通过 |
| 产品闭环 | 单一 task marker、checked/unchecked 只读、普通列表及多块任务保留 | F551-2；人类安装件复验缺席，不等同工程失败 |
| 架构 | 七条系统不变量与依赖边不变；唯一输入仍是已授权 body，UI 不触及 Provider | 现有 AST + 局部 CSS 方案适当；无需新 parser、rehype-raw、li wrapper 或整体样式替换 |
| 测试 | 相关 15/15；原有 URL/media/redaction/depth/focus 保护通过 | 当前回归缺少 raw-text/RCDATA/CDATA 字面量正控；独立反例在绿色 suite 外复现 F551-1 |
| 工作项 | 规模为 410 insertions / 4 deletions，未扩大到同步/编辑/#539 reference 功能 | #538/#542 human AC 仍存在；ExecPlan completed 可描述工程完成，但 Closes 不应自动关闭待 UAT 工作项 |

## F551-1 · P2 · 保留惰性 raw-text/RCDATA/CDATA 内的注释形状字面量

最小新增行锚点：`packages/ui/src/safe-markdown.ts:41–44`。

`inTag` 在 opening tag 的 `>` 后复位，后续任意 `<!--` 都被删除。但 mdast 的 `html` 节点也承载 raw-text/RCDATA 与 CDATA，不只承载实际 HTML comment。真实 renderer 当前结果：

| 输入 | 当前可见结果 |
|---|---|
| `<textarea><!--VISIBLE--></textarea>` | `<textarea></textarea>` |
| `<script>const example = "<!--VISIBLE-LITERAL-->";</script>` | `<script>const example = "";</script>` |
| `<![CDATA[<!--FIRST--> <!--SECOND-->]]>` | `<![CDATA[<!--FIRST--> ]]>` |

影响是原先惰性可读正文被静默改写；浏览器的可见文本与 AX 文本都丢失相同字面量。不是 XSS 或源数据丢失：独立生产 App 探针确认 active textarea/script 为 0、自动请求为 0、pageerror 为 0。#542 只授权去除 parser 语义中的真正注释，并要求保留其余正文/代码与既有惰性 HTML 安全行为。应让过滤识别上述 literal 上下文，并补可见/AX 正控，同时保留已覆盖的真实注释过滤与 tail；无需启用 raw HTML 执行。

`<pre>literal <!--hidden--> after</pre>` 里的 comment 仍是真实 HTML comment，当前过滤合理；fenced/inline code 已有保留正控。`<div>\nif (a <b && c) { <!--hidden--> }\n</div>` 的 `<b` 是未结束的畸形 tag，当前选择可确定终止，语义不足以作为另一项缺陷，不另报。

## F551-2 · P2 · 用 Refs 保留两项尚待人工复验的 issue

PR 级意见，不绑定生产源码行。当前 PR 正文为 `Closes #538`、`Closes #542`，`closingIssuesReferences` 也包含两项。
#538 末项仍要求记录人类 Desktop 复验，#542 末项仍要求有确切 artifact identity 的 human installed-Desktop check。2026-11-06 refinement 明确工程与安装件证据分开，但未删除这两项验收；ExecPlan 也明确写“人类 Desktop 复查待做”。因此 rebase merge 会自动关闭尚未完成原验收的工作项。

建议改为 `Refs #538`、`Refs #542` 并保持两 issue OPEN，工程验收记录如实保留；只有人类复验完成，或明确批准把剩余 AC 转交到另一工作项后再关闭。这个差异不升级成 P1，也不阻止明确限定范围的工程 Ready。

## 验证与判别边界

本轮真实执行，cwd 为上述 worktree，head 维持不变：

- `pnpm test:file tests/contract/ui-safe-markdown.test.js tests/browser/safe-markdown.test.js`：exit 0，15/15，无失败、取消或跳过；覆盖真实 drawer 与 production WorkItemApp。
- 独立 SSR probes：inline/multiline/multiple comment、同节点 tail、quoted attribute、autolink、processing/declaration、raw script/style/textarea/CDATA 与畸形输入，记录 F551-1 的精确输出。
- 独立 production composite Chromium probe：长 inline code + strong、nested/loose/multiblock task；三项 marker 均 `none`，checked `[true,false,false]`、disabled/readOnly 为 true，普通 disc/decimal 存在，320px 无页面横溢；AX 保留 list/listitem、任务正文及 checked/disabled 状态。raw literal 可见/AX 反例亦复现；请求和错误均为 0。
- 源码/全部 diff 审读：`SafeMarkdown`、局部样式、两类测试、composite fixture、ExecPlan 与索引；未新增依赖、写回或第二事实源。对布局的 font/theme/preview/expanded 几何覆盖由本轮已通过的既有 browser case 提供，独立探针不冒充安装件证据。
- `gh issue view 538/542/539` 与 OPEN issue 关键词 `markdown`、`comment`、`checkbox`、`CDATA`、`textarea` 检索：#539 属 source-aware references，未找到 raw literal 丢失的独立重复条目；F551-1 属 #542 的修复边界，F551-2 属原 issue 验收，不重复新建 issue。
- `gh pr view 551 --json headRefOid,baseRefName,body,closingIssuesReferences`：head 与本记录一致，baseRefName 为 main，确认两条 Closes。远端 checks/review threads 与 actor 由协调者单独锁定，本记录不借用旧结果声称通过。

运行探针与输出只放根仓库 `.superpowers/pr549-551-mmp-review-20261106/agent551/`。未施加源码变异；遵守本轮只读与 disjoint ownership 边界，不把已有绿色测试称为本轮 mutation killed 证据。作者 ExecPlan 的历史负控是作者证据，不是本轮重跑。

唯一跟踪写入为本评审文档；未改生产/测试、未 commit/push、未写 GitHub review/issue/Project、未合并。修复或 head/base 改变后须重新锁定并独立复评，当前结论不能沿用。工程回滚为整体 revert；不涉及数据迁移。


## F551-1 修复者补记（待独立复评）

初审记录与结论仍指向上述原 immutable head；正式 APPROVE review 为 `5798593124`。用户随后授权本会话修复两项非阻塞意见并独立复评，以下是 F551-1 在原 head 上未提交工作树的修复者证据，不冒充新的独立评审结论。

补 raw-text/RCDATA、CDATA literal 上下文及 inline sibling 的 paragraph/heading/tableCell 局部 owner；保留转义路径、原 comment 过滤、quoting/tail、code fallback，CSS/依赖/fixtures 不变。先见两项新增回归 RED（15 pass/2 fail），再见 heading/table scope RED（8 pass/1 fail）；最终最窄 contract/browser 18/18、typecheck exit 0。四个 `review-mutate.mjs` 变异有明确 `killedBy`，均 KILLED 且已还原；详见所属 ExecPlan 补记。

F551-1 的验收下一步是其他评审者独立复评并由协调者锁定新 head；F551-2 的 PR/body/issue 元数据不由本修复者修改。本修复未做 Git/外部写入，也未把人类 Desktop follow-up 记为完成。


### F551-1 第二轮修复者补记（待同一独立评审者复评）

独立复评发现 script double-escaped 状态仍使首个 closing 被误当有效结束：精确反例见所属 ExecPlan 第二轮。首轮 18/18 与四负控仅代表已列案例，不能判 F551-1 已关闭。第二轮先 RED（18 pass / 2 新增失败），再补三态 script 扫描及基于原 source offsets 的 inline gap 状态推进；最终 20/20、typecheck exit 0，七项 final-tree 变异全部按 `killedBy` KILLED 并还原。大小写/name delimiter、double→escaped、`-->`→normal、内联 sibling、code gap 与 entity-decode 区分均有用户结果断言。源码仍只转义展示，没有通用 HTML 执行/解析框架。

本段是修复者证据，原独立评审者的第二轮复评和协调者最终 source/head/组合/远端回读尚待写入；F551-2 仍由协调者处理。


### F551-1 第三轮修复者补记（source-gap authority）

第二轮独立复评确认 code gap 会在结束已有 script 后从 code-only `<textarea>` 又开启新 context，漏出后续真正注释；第二轮 20/20/七负控的覆盖有限，不能判完整关闭。第三轮先观察新增 contract/browser RED（20 pass / 2 fail），再将 gap 处理改为只能推进/结束已有 context 的 `rawTextEnd`；只有 HTML AST node 有 opener 权限。script/textarea/style gap 反例及真实后续 HTML opener 正控均通过。

最终窄 suite 22/22、typecheck 与 diff-check 通过；最终源码九项 attributed mutation 全部 KILLED 并按字节恢复。修复者已冻结源码供原独立评审者复评，完整组合/新 immutable head/远端与 F551-2 元数据仍由协调者收尾；没有 Git 或外部写入。

## 实际 main 接合与最终复评（2026-11-06）

F551-1 已由未参与实现的同一评审者完成第三轮独立复评：22/22 定向用例、57 项边界探针、343 种 script 状态 Chromium 对照均通过，活动 raw/src、请求和 pageerror 为 0；无剩余 P0–P3 发现。只允许 HTML 节点开启上下文，源码间隙只推进已有状态，复杂度与边界恰当。最终九项 killedBy 变异全部 KILLED 且还原。

最终源码组合 `fd102e78cd4a8174a97b4bc777668f5cd8ee0a7f` 在仓库外一次性 clone 的 `pnpm verify` 通过 typecheck、3570/3570 常规和 MVP-0 8/8；boundaries 9/9，`pnpm test:file tests/browser/workspace-execution.test.js tests/browser/detail-expand.test.js tests/browser/safe-markdown.test.js` 20/20。

接合实际 base `bd7bbbd4e2820b12f1fce474751b42a90f0e06a1`，源码候选 `f94f1c79d9157ff251941401e68b4935df924bcb` 的所有产品/测试/配置 Git blob 与最终组合逐字相同，manifest SHA-256 `2542dbff2f4b38d8570ed8d1dcf8b8f1f6cfb1ecee22fdeca4371d34df22aeb2`；只解决 Completed 索引冲突，未改受审代码。之后的归档文字不改变这些 blob。前两轮绿灯只覆盖各自当时测试，已被后续独立反例推翻，不能代替此结论。

F551-2：PR 使用 Refs #538/#542，GitHub 双向关闭关联回读为空、两 issue OPEN；人类 Desktop/确切 artifact 检查仍待完成。工程归档及 rebase merge 不意味着这两项人工验收通过。

发布后重新锁定 `gh pr view 551 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,statusCheckRollup,reviewDecision,closingIssuesReferences`，核对当前 head 的 PR Fast Gate、评审账号复评和全部线程，作者在相同 inline thread 回复验证后 resolve，再执行预期 SHA 的 rebase merge。当前源码接受不预写远端合并或人类接受。
