# PR #588 MMP 交付评审

> 状态：首轮两项 P2 的修复树独立复评通过，无剩余 finding；最终提交、当前 main 组合及远端门由主控核验。
> 创建：2026-11-10（Asia/Singapore）；范围：#587 工程子项，Refs #539。

## Purpose / Big Picture

判断来源上下文 Markdown 引用是否形成可独立验收、合并和回滚的工程闭环。最小证据为生产详情对两种接受 token 产生精确目的地，来源缺失或撤权时不借用旧上下文，惰性语法不升级，且不增加自动网络或规划写入。

## Context and Orientation

### 锁定事实

- 日期：2026-11-10（Asia/Singapore）。首轮 immutable head：`fa413ebd05450b10b805f0af955d0aa0d8efeec0`；base 分支 `main`，首轮 diff base：`c9bb17b833295f26c750bd8c4bf425df53e9701f`。
- 评审账号 `Singularity-AI-Bot`；开发、作者回复与合并账号 `SingularityKChen`。
- 用户直接授权：无 P0/P1 时由主控评审会话负责修复、独立复评、归档、提交整理、issue 核验及 rebase 合并；有阻塞项先交已有实现会话。本子评审不执行外部写入或实现修复。
- 完整13文件 immutable diff 已读；核心拥有模块为 `packages/ui-model/src/work-item-detail-view.ts`、`packages/ui/src/safe-markdown.ts`、`packages/ui/src/markdown-references.ts`，向上追溯同一内容的 SourceNumber decode/domain/client 门，向下检查生产 drawer、既有 HTML/URL/media 栈及其全部相关测试。
- #587 是两个接受引用形式的工程子项；父 #539 的完整研究、标题/状态、code permalink cards、确切安装物 Desktop 人类反馈保持开放。检索 Markdown 标题工作项还包含已关闭 #538/#542，未观察到本轮两项反例的独立开放重复项。远端生命周期、旧线程与当前 main 的组合证据由主控统一回读，不能把本记录的旧 head 结论迁移到新 head。

## Design / Spec

### 审查前风险矩阵的最终核销

矩阵已在逐文件审查前建立；下表替换原待证状态，不是事后把未查项目当成通过。

| 等级 | 代码与反例 | 产品闭环与架构 | 测试与 issue 验收 | 状态 |
|---|---|---|---|---|
| P0 | 全diff未发现破坏 main、泄密或数据损坏路径 | 不新增权威状态、持久化或外部写入路径 | 机械发布扫描、规模与diff空白检查通过 | 未发现 P0 |
| P1 | 当前来源/撤权、深度fallback、code/link、巨号与有界扫描主链有正负证据 | Host安全投影后复制事实；UI格式dispatch，无Provider/业务关系写入 | 48窄契约、13生产浏览器、typecheck与9边界通过；未用本地测试替代安装门 | 未发现 P1 |
| P2 | F1：惰性关闭标记内的HTML节点可重开/截短raw区间；F2：Unicode边界按UTF-16码元检查 | 两项均为局部安全导航误判，未见执行HTML、自动联网或来源越权 | 既有全绿但3项独立判别断言失败，生产浏览器确认 | 首轮两项；现已 ADDRESSED，见 Outcomes & Retrospective |
| P3 | 未发现需单独修复的一致性问题 | 69行窄AST复用既有parser与decoder，未见无依据扩大架构 | 父子边界明确，成本/限制如实标注；不重复创建父项 | 无新增 P3 |

### 分层证据与设计判断

- **代码**：链接目的完全由当前 props 与原始 token 构造，最终仍过既有 absolute HTTP(S) gate。解析树迭代遍历并跳过 code、既有 link、image、html，保留源文本对齐与结构深度fallback。原始候选长度门修复有效；F1/F2是边界遗漏，不要求换 parser。
- **产品闭环**：生产 fixture 使用真实详情投影与 drawer/App；同号双仓库 A→B→A、320px、明暗主题、Tab/Enter、精确目的、缺来源/错binding/遮蔽/阻断和焦点保持已有证据。当前 child 的基本链接行为成立；父项的 installed Desktop 人类接受与 R1不由这些结果核销。
- **权威/安全/架构**：SourceNumber 在 Provider decode 从同一可见内容建立，domain白名单校验，client拒绝遮蔽编号；详情在现有安全门后要求当前 primary/planning binding 一致、Issue/PR与非空原生scope ID。ui-model只复制canonical事实，UI才匹配GitHub namespace和仓库语法；不读显示名、checkout或旧条目缓存。无新业务edge、Provider请求、Planning状态或secret持久化。
- **测试判别力**：既有断言覆盖 namespace、binding、escape/entity、code、link、raw close、CRLF和长纯文，并在生产浏览器验证实际href与无自动请求。F1/F2的3项新运行态断言全部变红，说明现有覆盖缺口；本子评审未改动实现做mutation，不把阅读断言或自编探针称为KILLED变异表。
- **对抗/性能**：1500项确定性Markdown组合探针在移除新加引用anchor后，与无context渲染逐字一致，未观察到正文丢失。200k/400k/800k的ASCII、无效qualified、密集引用和巨号共12项transformer探针均完成；200k与800k ASCII约22.9/70.1ms，密集引用约21.0/60.5ms，未重现原无界扫描问题。数字是本机单次探针，不是Host延迟或性能SLO。
- **范围/成本/过度设计**：提交只有13文件，代码/test/config增删297行、文档187行，满足子项<800/<1300。新增decoder直接声明复用同一2.0.1路径；React/react-dom18.3.1均单一路径。当前fixture构建独立复算888123/gzip183827 bytes；文档的历史A/B增量按其锁定fixture解释，本轮未重做已放弃候选的安装试验。窄AST与同次raw状态机符合当前两个token闭环，无需引入通用HTML/Markdown引擎或远程renderer。

## Global Constraints

只修改本评审文档；实现、committed tests、提交、push、公开review与消息均由主控/被指定owner处理。运行态探针仅放在 `.superpowers/pr588-review-20261110/`，未进入发布diff。保留原工作树和immutable head；不改变任何Planning状态或原生依赖关系。

## Plan of Work

### Batch 1 · 完整diff与分层独立反例

最小闭环：全矩阵审查后一次性交回全部actionable意见。主文件是本记录。以下命令在检出首轮head的工作树根运行，结果均为2026-11-10本轮新观测；`gh`读取使用显式仓库。

| 命令 | 预期与实际 |
|---|---|
| `pnpm test:file tests/contract/ui-safe-markdown.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-model-presentation.test.js` | 48通过，0失败/skip，退出0 |
| `node --test tests/browser/safe-markdown.test.js` | 13通过，0失败/skip，退出0 |
| `pnpm run typecheck` | 退出0 |
| `pnpm run boundaries` | 9通过，0失败/skip，退出0 |
| `node .superpowers/pr588-review-20261110/adversarial.mjs` | 1500正文保留组合未见差异；定向样例输出供边界复核，退出0 |
| `node .superpowers/pr588-review-20261110/browser-probe.mjs` | 真实安全详情生产bundle复现F1/F2，自动requests/errors均为空，退出0；是观测探针，未声称缺陷已修复 |
| `node --test .superpowers/pr588-review-20261110/findings.test.mjs` | 当前树3项预期失败，0通过，退出1；分别锁定F1抑制、F1误链、F2 Unicode边界 |
| `node .superpowers/pr588-review-20261110/perf.mjs` | 12组200k–800k输入完成，退出0；仅工程保护探针 |
| `node scripts/rule-checks.mjs disclosure c9bb17b833295f26c750bd8c4bf425df53e9701f` | 已提交差异/各提交新增/commit message机械扫描通过，退出0；本次未通过PR_BODY重扫描述 |
| `node scripts/rule-checks.mjs size c9bb17b833295f26c750bd8c4bf425df53e9701f` | 代码297、文档187，退出0；锁文件单列 |

另以Python `subprocess.run` 的argv形式执行immutable base/head的 `git diff --check`、`git diff --numstat` 与状态检查：退出0，实际改动仅本记录未跟踪；已完整人工核对提交新增行的凭据、本机身份、账号个人信息、内部系统和保密字样，无新增命中。依赖树只读核对与当前bundle复算结果见 Design / Spec，不把shell拼接用于Git。

回滚：本批没有实现或外部状态变更；删除运行态探针不改变PR产品树。主控后续修复必须新锁head并重跑相关证据。

## Validation and Acceptance

首轮静态/动态审查已完成，两个基本接受token、来源门和主要惰性区域有有效工程证据；F1/F2在首轮head可复现的状态已由 Outcomes & Retrospective 的修复树独立复评取代（2026-11-10）。正式相关证据已新跑；当前main组合/最终远端门禁由主控执行。

本子评审未运行installed Desktop或人类任务，也未重新运行整次 `pnpm verify`、历史候选库安装A/B与硬件延迟测量；作者过去全层输出不能表述成本轮独立证据。

## Progress

- [x] 2026-11-10：先锁immutable base/head并建立P0–P3风险矩阵。
- [x] 2026-11-10：全13文件diff、拥有模块与上下游安全门、父子issue及重复跟踪完成审读。
- [x] 2026-11-10：窄契约/浏览器/typecheck/边界、对抗文本、生产浏览器、性能保护和发布面检查完成。
- [x] 2026-11-10：两项P2均有exact RIGHT锚点、当前失败断言和修复方向，交主控一次性提交。
- [x] 2026-11-10：独立owner局部修复后，锁定原head加四文件SHA-256的未提交树，独立复评F1/F2均ADDRESSED；最终新head与main组合/远端门由主控继续。

## Surprises & Discoveries

### F1 · P2 · 惰性关闭标记内的HTML节点仍能改变raw状态

首轮发现；Superseded by Outcomes & Retrospective 的F1 ADDRESSED结论（2026-11-10，精确修复树指纹见该节）。

锚点：`packages/ui/src/safe-markdown.ts` RIGHT 147–149（最小发布锚点147）。`referenceEnd`只约束text；位于该区间内的HTML leaf仍经过 `withoutCommentSpans`。parser会把关闭标记属性里的 `<title>` 独立成html节点，这会开启一个本应惰性的raw context。

在有效 `sample/alpha` 上下文渲染 `before <textarea>#1</textarea x="<title>#2"> #3`，当前href为 `[]`，期望仅 `/sample/alpha/issues/3`。更强反例 `before <textarea>#1</textarea x="<title>#2</title #3> #4"> #5` 当前链接 `/issues/4` 与 `/issues/5`；`#4`仍在外层关闭标记的引号内，期望仅 `/issues/5`。两例已由生产详情浏览器与独立SSR失败断言确认，且无自动网络或HTML执行。

修复方向：完整惰性offset区间必须约束html和text节点，不能让区间内的html开启/关闭另一个raw状态或缩短既有 `referenceEnd`；跨leaf处理后只在真正关闭标记末尾恢复普通prose。补有nested raw开闭标记的引用反例，保持现有注释/代码语义。复用同次状态机即可，无需新增通用HTML parser。

### F2 · P2 · Unicode边界检查只读取一个UTF-16码元

首轮发现；Superseded by Outcomes & Retrospective 的F2 ADDRESSED结论（2026-11-10，精确修复树指纹见该节）。

锚点：`packages/ui/src/markdown-references.ts` RIGHT 34、42–43（最小发布范围34–37）。`line[index - 1]` / `line[index + token.length]`及decoded value索引得到单个surrogate；即使正则使用 `u`，单个surrogate也不匹配 `\p{L}/\p{N}/\p{M}`。

在同一有效来源渲染 `中#328 #328中 𠀀#328 #328𠀀 𝟡#328 #328𝟡`，BMP两例保持plain，但后四例错误链接为 `/issues/328`；`&#x20000;#328 #328&#x20000; &#x1D7E1;#328 #328&#x1D7E1;`解码后也出现四个错误链接。输入未形成允许的独立引用token，违反同一函数已经声明的文字粘连排除，而非要求扩展新的GitHub语法。生产浏览器已复现；独立断言还带一个 `(#329)` 正控，实际多出8条328链接。

修复方向：raw和decoded两次边界都读取完整前/后Unicode code point，继续保留当前ASCII分隔规则与source/value对齐。补supplementary字母、数字、组合标记及entity邻接的对照；不要通过放宽Unicode排除来让误链变成接受范围。

## Decision Log

- Decision：两个反例合并为两条P2，未升级为来源越权、XSS或P1。Rationale：影响只在少见词法/惰性范围内产生或抑制已有安全目的导航，未发现HTML执行、自动网络、写入或Host事实拥有者失效。Date/Author：2026-11-10 / 独立子评审。
- Decision：修复后复评而非在评审树实现。Rationale：主控明确限制本子任务只修改记录，并保留独立复评者。Date/Author：2026-11-10 / 主控任务边界、独立子评审执行。
- Decision：不把父#539关闭、旧#538/#542安装接受或本地生产browser结果替代child新安装接受。Rationale：公开工作项已明确父子边界，child只交工程slice。Date/Author：2026-11-10 / 独立子评审核验。

## Idempotence and Recovery

所有命令可在同一source树重跑；只读检查不写Provider。运行态反例在首轮head预期退出1；该预期已由修复树3/3通过取代（2026-11-10，见 Outcomes & Retrospective）。head或本节锁定源文件改变时先核对实际diff及反例覆盖；主控合入当前main前须重锁base/head与远端结果。

## Interfaces and Dependencies

使用现有Node、pnpm、TypeScript、Playwright/Chromium、React SSR及GitHub CLI只读issue接口。无新增发布依赖或凭据；当前依赖版本与路径事实见 Design / Spec。正式GitHub review由主控使用当前immutable head一次性提交。

## Outcomes & Retrospective

完成完整分层审查，首轮未发现P0/P1；两项P2在首轮head可复现。Superseded by本节修复树独立复评（2026-11-10）。scope、成本、权限和父级安装/发布门分别核验；不把修复树局部通过表述为当前main可合并或新的安装人验。

### 2026-11-10 · F1/F2修复树独立复评

锁定对象为原 `fa413ebd05450b10b805f0af955d0aa0d8efeec0` 加实现者四文件未提交修复；独立读取actual diff并按文件字节复算SHA-256，与实现者交回值吻合。不是新commit或新head批准。

| 文件 | 独立SHA-256 |
|---|---|
| `packages/ui/src/safe-markdown.ts` | `0736bf41daf3408ccea18913b184567aef40ead584eaa9ebbb953122519aac03` |
| `packages/ui/src/markdown-references.ts` | `17db8ff747be57443985c8171b42b6628f52a181e96ba196df1b9264bee3dcfd` |
| `tests/contract/ui-safe-markdown.test.js` | `a87503b763352faf2ac17f77acb56c310eacba69f75f4f47379936aae9a9eaaf` |
| `docs/exec-plan/completed/2026-11-09-markdown-source-references.md` | `7ce1815cdf8667bed6874f00ccfb44ac625717ae54a272c8cc2d532cde8659be` |

- **F1 ADDRESSED**：位于既定关闭literal终点之前的parser HTML token不再进入raw/comment状态机。独立生产浏览器确认两个原始raw反例分别只链接3/5，`<plaintext>`与`<textarea>`属性例恢复真实尾部3，属性内comment保留且不升级；新增契约覆盖8类raw标签、单双引号、嵌套开闭、后续真实raw区间及独立隐藏comment。没有切开parser token重扫或引入第二个HTML parser。
- **F2 ADDRESSED**：前邻接最多检查一对surrogate，后邻接用 `codePointAt`，raw与decoded两个过滤点均复用同一有界helper。独立核对negative/out-of-range的空边界返回及ASCII规则未放宽；契约包含裸号/qualified、supplementary L/N/M、十六/十进制entity和emoji正控。生产浏览器确认原Unicode/entity误链均消失，而普通329/qualified正控仍精确链接。
- **本轮独立新证据**：Batch 1原3反例为3/3通过、相关契约为50/50通过、生产浏览器整份13/13通过、typecheck退出0，均无失败/skip；同一生产探针requests/errors为空。没有扩展新语法或新扫全量/性能网格，现有长纯文保护契约仍绿。没有改source/projection/依赖边，父#539安装人验与R1仍独立。
- **实现者证据与独立证据分开**：已读取 `.superpowers/pr588-fix-20261110/mutations.json` 和 `mutations.log`；两项最终机制变异分别由新增raw区间测试和Unicode边界测试KILLED，归因不同，恢复后当前字节与上述指纹一致。本轮子评审没有再次修改实现施加变异，也未重跑整次verify/boundaries；主控负责一次最终组合全量及当前head远端回读。

修复范围保持两行HTML守卫/注释、有界code-point helper与两项有判别力回归，未发现新的P0/P1/P2/P3；无剩余actionable finding。最终提交整理或rebase后由主控确认源树保持该修复并重锁当前head。

## Bottom Change Note

2026-11-10：保留预建矩阵语义，补全immutable diff审读、实际窄验证、生产/SSR对抗反例、性能保护、父子issue边界、两条P2与恢复路径；只改本记录，不改产品或提交公开review。

2026-11-10 SGT 首轮正式回读：`Singularity-AI-Bot` 已在锁定 head `fa413ebd05450b10b805f0af955d0aa0d8efeec0` 一次提交完整 review `5835136175`，事件为 APPROVED。最终 push 后须重新锁定并取得当前版本结论。

2026-11-10：在冻结的四文件修复树独立复评，逐原发现标注ADDRESSED并保留首轮证据，新增精确SHA-256和3/50/13/typecheck真实输出；仅更新本记录，不作新head、组合或installed接受声明。

2026-11-10 SGT 整合门：全部四项非阻塞修复已独立复评通过，最终固定组合 f172cb02 的完整工程证据与逐实际 main 门见 `docs/review/2026-11-10-pr586-pr592-mmp-review.md`。本 PR 最终 push 后仍重读精确 head/base、托管检查、批准、全线程和双向 issue 关联；与受验前缀逐 blob 不符则回到验证。
