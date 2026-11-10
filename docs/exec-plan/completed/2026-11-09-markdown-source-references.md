# 来源上下文 Markdown 引用 ExecPlan

> 状态：工程实现已验证，待主控独立验收与远端回读；创建：2026-11-09（Asia/Singapore）
> 正式路径：`docs/exec-plan/completed/2026-11-09-markdown-source-references.md`
> 工程子项：#587；父 Issue：#539；仅关闭本工程子项；规范：`PLANS.md`、`AGENTS.md`

## Purpose / Big Picture

用户阅读已获准的 GitHub Issue/PR 正文时，可以通过 `#328` 和 `owner/repo#328` 打开正确原生对象；同号跨仓库、切换条目或撤权不会借用上一条目的来源。最小证据是生产详情投影和 Markdown 组件在真实浏览器生成精确安全目的地址，键盘可达，渲染期间没有网络请求或关系写入。

父 #539 保留完整 support matrix 研究、增强标题/状态、代码 permalink 卡片及原 installed Desktop 人类验收；本工程子项只交付两个引用形式与其完整安全闭环。子项 PR 使用 `Refs #539` 并关闭明确工程子项，不关闭父项。

## Context and Orientation

`packages/ui/src/safe-markdown.ts` 用 `react-markdown@10.1.0` 与 `remark-gfm@4.0.1`，已有绝对 HTTP(S) URL gate、惰性 HTML、注释隐藏、显式媒体链接及深度限制。它只接 body，因此缺少解析 bare reference 的仓库上下文。`packages/providers/planning-github-projects/src/decode.ts` 已从同一授权内容提供 SourceNumber，namespace 精确为 `github.com/graphql/Repository`，id 为原生 repository ID，scopeName 为 nameWithOwner；这比显示标签 sourceName 有明确来源意义。SourceNumber 已走 domain 校验、Host wire 与 client 安全行，不需新一套 DTO。

`packages/ui-model/src/work-item-detail-view.ts` 是详情安全门，redacted/unavailable 等分支不挂正文。#308 的已给定比较包含 #228/#229/#276 和 commit permalink URL；普通引用、标题状态装饰、远程代码卡片是三个层次。

## Design / Spec

裁定保留现有 Markdown 栈；先用同一判别夹具比较受限 `remark-github` 与小型 mdast text-node transformer，仅保留胜出的一种。remark-github 官方 buildUrl 可对非 issue 类型返回 false，但仍须实测它是否重写现有 URL、repo#N、mentions 或丢 escape；默认配置读取 cwd/package repository 不允许。只有可精确限制到本叶语法且安全夹具全部通过时采用依赖；否则使用有界 AST 转换器。禁止全文 regex 替换、React 字符串 split、换 parser 或远程 Markdown API 渲染。

安全投影新增 `markdownSource?: { platform: 'github'; repository: string }`。仅当 detail 当前 primary binding 等于 planningSource、externalKind 为 issue/change_request、SourceNumber namespace 精确匹配 GitHub repository、id 非空、scopeName 严格为 owner/repo 时产生；显示 sourceName 不参与判定。来源不明、不匹配、撤权或非 GitHub 保持原文。上下文是当次 props，无跨条目缓存、无 Provider 请求、无从 checkout/branch/title/URL 猜来源。现有数据已能证明这个来源，不扩大 domain/controller/client wire。Superseded by 本节下一段（2026-11-09）：平台格式 dispatch 不属于 ui-model。

最终接口为 `markdownSource?: { namespace: string; repository: string }`：ui-model 在现有详情安全门、当前 primary/planning binding、issue/change_request 与非空 scope ID 之后，只复制 SourceNumber canonical namespace/scopeName。UI Markdown transformer 才精确匹配 `github.com/graphql/Repository` 并校验 GitHub owner/repository 语法；其他 namespace 原样保留为事实，但正文引用保持 plain。显示名不参与，未扩大 wire。此调整保持 ui-model 不含平台名的既有架构契约。

接受形式只有正安全整数 `#N` 与 `owner/repo#N`，明确排除0、unsafe integer、文字粘连歧义和不合法仓库；链接文字保持原 token，不伪装已读取标题或状态。qualified 扫描候选 owner/repository 最多39/100字符，严格合法性仍由既有语法门判断，防止长纯文无界回扫。GitHub 共用 issue/PR 编号空间，目的 `/issues/N` 由原生路由处理。已有 HTTP(S) gate 最终裁决所有链接。

AST 扩展放在深度 guard 后、惰性 HTML 处理之后；跳过 code/inlineCode/link/linkReference/image/html 与原始 HTML literal 区间，保留逃逸源位置语义。`\#328`、`&#35;328` 等解码 text.value 不等于源 token，不能仅凭 value 重新识别。raw-text/RCDATA/script 已有状态机定义惰性区域，引用插件不得把该区域相邻 text 节点升级为链接；raw closing marker 在属性、换行与带引号 `>` 终点前保持惰性，真正尾部普通 prose 才恢复；需要信息时在同一解析过程传递有界 inert range，不另造 HTML parser。超过结构限额的原文 code fallback 始终惰性。

关键不变量：Host 授权投影单向消费；无 context 则 plain；不嵌套 anchor；不在已有链接文字内二次 linkify；HTML 不激活、媒体不自动抓取；引用不生成业务 edge、lineage、Planning 或 Provider 写入。

## Global Constraints

分支 `feature/markdown-source-references`，工作树 `.worktrees/markdown-source-references-20261109`，独立 main PR；#309/#543/#583/#584/#585 都不是技术前提。

单一 owner 文件集：`packages/ui-model/src/work-item-detail-view.ts`、`packages/ui/src/work-item-detail.ts`、`packages/ui/src/safe-markdown.ts`、`packages/ui/src/markdown-references.ts`（新增，仅当选小转换器）、`packages/ui/package.json`、`pnpm-lock.yaml`（仅选择新增依赖时）、`tests/contract/ui-safe-markdown.test.js`、`tests/contract/ui-work-item-detail-view.test.js`、`tests/browser/safe-markdown.test.js`、`tests/fixtures/safe-markdown-browser.mjs`，以及正式路径本 ExecPlan 和 `docs/product/markdown-support.md`（新增）。主控独占 docs/README 索引。

共享文件责任边界：本项只在 detail view 的 content 数据中新增 `markdownSource` 并派生，在 detail 的 contentPanel→SafeMarkdown 传 props；#543 只增加其 reader/target/section 位置。两个独立工作树可以各自实现，集成时由主控一个 owner 合并同文件并验证语义；文本冲突不建立技术依赖。

代码新增+删除（含 fixtures/tests/config）严格 <800，文档 <1300。预计生产 150–260、测试/fixture 180–300、依赖配置 0–15，总 330–575，保留到799的实现余量；锁文件按仓库政策单列，不把测试挪至排除目录。首先简化，不压缩控制流凑行。无旧数据迁移、兼容 fallback、自动 unfurl、真实模型调用、Planning 状态写入或自主合并。

## Plan of Work

### Batch 1 · 安全上下文到生产详情链接

最小闭环：同一授权正文中的两种引用，经当前安全 context 形成精确源链接，所有未接受语法和惰性范围不误链。主文件为详情安全投影、SafeMarkdown 与选定 AST 扩展。

先用既有浏览器构建测 baseline，再把两个策略放运行态独立试验（只作依赖选择，不替代 committed tests），同输入比较 escaping、HTML literal 与功能开关。选择后删除未采用试验实现，不保留双 renderer。记录实际依赖版本、包依赖树/React 副本、同 flags bundle/gzip 字节与结论。

先在 committed test 中写裸引用精确目的地及 context gate 的 RED；旧实现必须因未链接变红。加省略/非GitHub/错误binding/同号双仓库/A→B→A/撤权、escaped token、已有 link、code/fence、惰性 HTML/comment/script/RCDATA/CDATA、巨号、标点边界、深度 fallback。再接最小 projection 与选定 AST 策略。浏览器测试复用生产详情派生与 drawer，不能只渲染 SafeMarkdown 伪造上下文。

在检出上述分支的工作树根运行：V1 `pnpm test:file tests/contract/ui-safe-markdown.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-model-presentation.test.js`，期望判别 RED 后全部 GREEN；V2 `node --test tests/browser/safe-markdown.test.js`，期望全部通过且新场景零自动网络、Tab 可达和精确 href。V3 `pnpm run typecheck` 和 `pnpm run boundaries`，期望退出0。

V4 在改动前后各一次，以完全相同 fixture/flags 执行：`node --input-type=module -e "import {markdownBundle} from './tests/fixtures/safe-markdown-browser.mjs'; import {gzipSync} from 'node:zlib'; const b=await markdownBundle({production:true,composite:true}); console.log(JSON.stringify({bytes:Buffer.byteLength(b),gzip:gzipSync(b).length}))"`；同时 `pnpm --filter @harness-projects/ui list react react-dom react-markdown remark-gfm remark-github --depth 20 --json`，记录包增量与是否新增 React 副本。若受限现成库通过全部夹具且成本合理，采用库；否则记录具体失败选择小 AST。不要用网上包大小当同 build 结果。

V5 发布检查：`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`、`git diff --numstat origin/main...HEAD`；机械检查退出0并手算更严预算，人工审查五类发布信息。PR 记录新工程子项、Refs父、本计划 Batch 1、真实测试/成本证据与风险回滚。最终 push 回读当前 head/base/checks/issue/完整 threads 后才能 ready，merge 由人类决定。

支持矩阵正文至少列：#N、qualified、repo#N、mentions、SHA/compare、URL/email、relative/anchor、task lists/tables、footnotes、HTML、media、title/status、commit cards；状态区分本叶实现、当前已有、明确阻断、后续/来源依赖，并给官方主源与本次实际测试例。父完整研究/installed门不由子项关闭。回滚点为本 PR 整体；失败退回 parser/fixture，不改别的候选。

## Validation and Acceptance

V1–V2 证明用户在两仓库相同编号下得到正确目的地，context 撤销时同一 render 不出现旧链接，阻断 view 无上下文/正文泄漏；所有非接受区域保持原文且安全边界不退化。浏览器检查320px、明暗主题、Tab/Enter及noopener noreferrer，不发生自动外连或焦点抢占。V4 只证明工程成本和实际依赖选择，不是渲染时延或 installed Host 接受。

必须独立对抗审读一次：去掉 source namespace/binding gate、忽略 source escaping、只跳 html节点不跳 raw literal区间，测试均应有判别失败。真实 Desktop artifact、键盘观察和人类反馈留父 #539，测试/clean Web 不能替代。

## Progress

- [x] (2026-11-09 19:56 +08) 综合两路设计与既有 SourceNumber/安全渲染链，冻结两个引用形式及不扩 wire 的上下文路线。
- [x] (2026-11-09) Batch 1：A/B试验、RED/GREEN、矩阵与成本完成；初轮V1窄契约46项、V2生产浏览器12项、V3 typecheck/boundaries9项通过；完整 verify 的contract1427、integration2072、e2e226全部通过。工作树发布扫描零命中，人工五类目未发现新增敏感信息。
- [x] (2026-11-09) 独立初评发现P1无界qualified扫描与P2 raw closing literal误链，已先RED后修复；修复后窄契约48项、browser13项、typecheck与boundaries9项通过。主控安排scoped复评、最终远端回读；父installed人类门继续保留。（独立复评完成；易失远端状态按发布命令即时核对。）

- [x] (2026-11-10 +08) 本轮两项P2先RED再局部修复；最终V1为50/50、原独立反例3/3、V2为13/13、V3 typecheck及boundaries9/9通过，两机制变异均KILLED并恢复；待独立复评与主控整合后门禁，不冒领新head批准。

## Surprises & Discoveries

- 远端 CodeQL review 把浏览器测试中数组 `requests.includes(完整URL)` 误识别为 URL substring sanitization；该代码是已收集请求的测试断言，不是产品URL校验。未改变产品或压制扫描，改为精确数组相等，同时加强「唯一用户导航目的」断言。

- 独立评审揭示原qualified `+`候选扫描对无斜杠普通ASCII超线性；200k纯文生产transformer子进程在旧实现触发4秒timeout保护。仅把候选限定39/100字符后，该判别通过，不引入性能基准平台。
- rawTextEnd 的既有返回值是关闭标签起点，不等于整个closing literal终点。旧SSR/browser对 `</textarea #2>` 额外链接#2；修复只扫描已识别raw closing marker到含引号的完整结束，并在同inline上下文跨leaf传递referenceEnd。8tag×5形态保留#2 literal、尾部#3链接。

- 受限 `remark-github@12.0.0` 即使显式 repository、mentionStrong:false、buildUrl 只返回 issue，仍链接 GH-/repo-only forms、escape/entity 解码结果及 textarea text；同夹具的本叶安全契约失败，因此不采用。
- Markdown text leaf 的 source position 可含 blockquote/list 续行前缀，且 CRLF 在 value 中保留。新增判别 RED 后，采用每行 decoded raw 必须严格以 parser value 为后缀的有界对齐；无法证明则保持原文。
- 首次完整 `pnpm verify`：typecheck通过，contract 1427项中1426通过、1失败；失败为 `ui-model-presentation.test.js` 的平台名边界。原设计把语法识别放进安全投影的位置假设被推翻；没有放宽扫描，按下述决策改为事实投影与 UI 格式 dispatch。

来源显示标签不构成平台证据，但当前 SourceNumber 已含 Provider 明确 repository namespace/id/nameWithOwner；无需新增另一套权威 DTO。已有 HTML literal 状态机覆盖 script 双重转义；只跳 html AST 节点不足以保证相邻 text 惰性，不能为短代码忽略。remark-github有 buildUrl 排除类型能力，但可否精确接受本叶形式尚需真实夹具试验。Superseded by 本节受限库反例及 Decision Log 的单一 AST 决策（2026-11-09）。

2026-11-10补充：既有完整closing marker终点只约束text，属性里的parser HTML leaf仍能开启raw状态，导致真实尾部引用被抑制或原终点被截短。另两次邻接检查读取UTF-16码元，即使Unicode正则使用`u`也看不到supplementary L/N/M。原独立反例0/3，新committed回归18项中16通过/2失败，失败均为已复现导航结果而非装配错误。

## Decision Log

Decision：限定qualified候选长度，并只推进已识别raw closing marker完整惰性终点。Rationale：独立P1/P2有生产探针与RED证据；accepted语法不变、generic事实投影不变，不新增通用HTML parser。Date/Author：2026-11-09 / 独立评审输入、主控批准修复、实施者执行。

Decision：ui-model 只复制授权后的 canonical namespace/repository，GitHub namespace 与仓库语法在 UI transformer 判别。Rationale：完整契约证据证明平台格式规则不属于 ui-model；来源事实仍由现有 Host 安全链单向提供，没有新权威源或 Provider 请求。Date/Author：2026-11-09 / 主控裁定、实施者执行。

Decision：仅保留窄 AST，并直接声明现有 `micromark-util-decode-string@2.0.1`。Rationale：候选库缺少 raw token/position 配置边界，decoder 用于现有 parser 的 escape/entity 对齐，不另造解析器。Date/Author：2026-11-09 / 实施者，主控确认依赖边界。

Decision：保留 parser，复用明确来源 namespace，仅增加安全详情 props，库与小转换器由同夹具/同 build 成本判定。Rationale：提供用户可达导航，同时把权限事实和格式规则分开；不为链接增加 Provider 网络或新权威字段。Date/Author：2026-11-09 19:56 +08 / 独立收敛评审者。

Decision：独立 main，与 #543 共享文件不同责任区由主控集成。Rationale：只存在组合/合并成本，没有能力因果依赖。Date/Author：2026-11-09 19:56 +08 / 独立收敛评审者。

Decision：HTML token若起点仍位于既定referenceEnd内则整体保持惰性，不让其中的raw/comment语法改变状态；后续真实text/HTML仍照常处理。Rationale：mdast已拥有token边界；切开token并重扫后半段会把原惰性comment/tag内容解释成新语法，另造parser则扩大范围。Unicode两次边界共用最多检查一对surrogate的code-point helper，不对整行做重复Array.from。Date/Author：2026-11-10 / 主控指定修复owner；两项范围已由用户条件授权。

## Idempotence and Recovery

渲染纯消费当前 props，可重复；正文与既有身份不改写，回退 PR 恢复原始 plain refs，无数据库恢复步骤。依赖试验只在任务工作树，失败不改变根工作树或用户安装物。若现有来源事实无法证明 context，保持 plain 并回设计门，不能靠显示名/URL猜测放行。

## Interfaces and Dependencies

Node >=22、pnpm10.28.2、当前 React/react-markdown/remark-gfm。新增 props 为可省略的展示上下文，非权限 API；候选 remark-github 版本必须安装前核查并记录，明确 repository 与 buildUrl 配置，禁止 cwd 默认。最终未保留该候选；直接声明 `micromark-util-decode-string@2.0.1`，复用现有 transitive 包，不增加 React 副本。外部主源为 GitHub autolink 文档、remark-github/react-markdown/remark-gfm README；矩阵公开内容自包含，运行态原始抓取不替代文档。

## Outcomes & Retrospective

2026-11-09 远端测试断言反馈修复：在 `feature/markdown-source-references` 工作树将用户 Enter 导航结果改为精确单元素请求数组；重新执行 V2，13/13 通过、零失败/skip，证明此前渲染无请求且 Enter 仅打开当次精确目的。产品、fixture、依赖与bundle未改；最终远端检查由主控回读。

2026-11-09 初轮工程验证（独立评审修复前）：`pnpm verify` 退出0，三测试层分别1427/2072/226通过且零失败/skip；生产browser12项通过，boundaries9项通过。既有CLI V5对HEAD只有草稿计划，所以另外使用同一规则导出函数扫描含未提交/新增文件的整个工作树，零命中；最终提交后仍须主控重跑正式CLI与远端回读。

2026-11-09 工程结果：当前 props 形成精确来源链接；无 context/错误 namespace/binding/阻断态保持 plain 或不挂正文；代码、已有链接、HTML literal 与超深 fallback 不升级。生产 browser 证明320px明暗主题、Tab/Enter精确目的、A→B→A、无自动网络与焦点不抢占。依赖仍为 react-markdown10.1.0 / remark-gfm4.0.1，React/react-dom18.3.1。

独立评审修复后验证：V1窄契约48项、V2 browser13项、V3 typecheck/boundaries9项全通过；随后在最终源稳态重新执行整次 `pnpm verify`，typecheck与contract1429/integration2072/e2e226全部通过，零失败/skip；主控负责scoped复评与最终提交门。

同基线 fixture（`242b8317b60bb53601104961dd5d8069be2c7d9f` 中的 browser fixture）、同 V4 flags：baseline 882370/gzip182450 bytes，受限库891617/184816，最终AST（含独立评审修复）887693/183699，最终实现增量5323/gzip1249。最终新增source输入fixture实际构建888123/gzip183827，fixture变化未混入实现增量。直接依赖声明复用既有包，安装包与React副本无增量。字节不是时延或installed接受证据。

原草稿只有设计输入，未运行测试/成本比较、未决定依赖。Superseded by 本节2026-11-09工程结果及修复后验证（2026-11-09）。无新维护债已被接受；若有暂缓项，父 #539 持续记录完整矩阵/增强卡片/installed gate，不能把未验需求写成已支持。实施结果应记录选型反例、实际字节和 React 依赖、作用范围及未验证 Host 边界。

2026-11-10 P2收尾本地证据（`feature/markdown-source-references`工作树，`fa413ebd`加本轮未提交修复）：F1新增8类raw标签的nested开闭/单双引号/真实后续raw区间及literal comment正负控；F2覆盖裸号与qualified、supplementary字母/数字/组合标记、十六进制/十进制entity和emoji标点正控。最终V1为50/50、V2为13/13、V3 typecheck退出0且boundaries9/9；`node --test .superpowers/pr588-review-20261110/findings.test.mjs`从0/3转为3/3。`node scripts/review-mutate.mjs .superpowers/pr588-fix-20261110/mutations.json`最终整表两项均KILLED，killedBy分别为`raw closing attributes keep nested HTML inert`与`supplementary Unicode and decoded entity word boundaries`，工具恢复后基线通过。仅本地窄证据，未重复整次verify；主控负责组合全量、独立复评、最终提交和远端即时门。本轮无依赖、公开接口或存储变更。

## Bottom Change Note

2026-11-09 19:56 +08：创建最终工程草稿，综合现有明确 SourceNumber 与两路 AST 方案，补 escaping/HTML literal 风险、同build成本、共享文件责任和父子验收边界。

2026-11-09：实测受限库反例并选择窄 AST；完整验证发现 ui-model 平台名架构门，按主控裁定把 namespace 格式 dispatch 移到 UI，保留原门禁，补多行 source/CRLF 与 decoded boundary 证据。

2026-11-09：记录最终全层验证、生产浏览器与工作树发布检查；保持active等待独立安全/组合审读及最终远端回读，不把本地工程证据写成installed接受。

2026-11-09：按独立评审一次修复P1有界候选扫描与P2完整raw closing literal；补RED/GREEN、48窄契约/13browser、同input成本，等待scoped复评。

2026-11-09：最终修复源树整次pnpm verify退出0（1429/2072/226），不沿用修复前日志作为最终证据。

2026-11-09 20:18 +08：独立 scoped 复评确认两项均 ADDRESSED、无新增 finding；独立48契约、13浏览器、typecheck和80个关闭标签探针通过，200k纯文约18ms。工程闭环归档，保留父#539 installed人类门。

2026-11-09：针对远端CodeQL的数组includes误识别，加强浏览器唯一请求精确断言；V2整份13项通过，不压制扫描、不改产品。

2026-11-10：按两项已确认P2补判别RED，采用既有惰性终点的HTML token守卫和有界code-point邻接，记录50契约/13browser/3反例/9边界、类型与双机制变异证据；独立复评和公开写入仍由主控安排。
