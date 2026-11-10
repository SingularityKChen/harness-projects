# 共享工作区、List 与 Delivery 视觉落地 ExecPlan

> 状态：Active；已批准设计，待 A 能力实施与验收
> 创建：2026-11-10
> 规范：根 `PLANS.md`；关联 #614、#604、#603
> 正式路径：`docs/exec-plan/active/2026-11-10-release-list-delivery.md`

## Purpose / Big Picture

用户在真实工作区识别来源、查询工作项、调整列、切换 List/Delivery 并打开同一详情时，看到已批准 v3 的层次、密度与 Host 外观；权限、读取和工程事实仍清楚可靠。成功至少需要同场景真实 before/after/reference、可用控件、安全回归及独立设计评审。A 完成只关闭 #614，完整 #604 由后续 B 累计验收。

## Context and Orientation

分支 `feature/release-workspace-polish`，工作树 `.worktrees/release-workspace-polish`；现 PR #611 改为 `Closes #614`、`Refs #604`，base 为 `docs/release-visual-target`。B 分支 `feature/release-detail-settings` 基于 A；Board #612 以 B 为 base。A issue #614作为#604的native subissue；原 `#604 blocked-by #603`、`#605 blocked-by #604`、其他 native 边及所有 Status 保持原值，不新增blocked关系。分支依赖不等于规划依赖。

参考是 `docs/product/release-visual-target-v3/README.md`、`handoff-v3.md` 与冻结 manifest；人类已针对 `release-workspace-v3` 明确“批准 v3，开始实施”，manifest SHA-256 为 `d714cea12faa96bb6411c4e19c3712914af98bad199dd3787cdb419ecbf48c29`。冻结 handoff 内未接受字样为历史状态，由 README 与设计 ExecPlan 的批准记录取代；不改冻结文件，不重复申请同一设计许可。

`WorkItemApp.screenOf` 先验证 route 所属工作区；`WorkItemProjectPage` 拥有 view mode 和唯一详情 opener；`WorkItemListPage` 持续挂载并拥有 query 与列宽。`DeliveryOverview` 拥有现有仓库选择、本页刷新及分页，`DeliveryLineageSection` 消费共享 execution 呈现。A 改共享角色会影响旧 detail/settings，必须保持其可用；B 完成其局部 v3 排印。

## Design / Spec

保留已批准正常 1440 场景：44px Host 顶部上下文、表头约 y196/高44px、短行58px，标题22/30、任务及正文14/22、来源身份12/18。长文、异常和200%文字自然增高，不能以固定高度裁掉安全事实。参考采用7行、visible 5-of-8配置；产品默认显示5列不改，8字段完整访问能力保留。Board/Timeline尚未交付，不提前启用。

共享样式仅消费 Host CSS 角色：base/layer-1、label-primary/secondary、border-l2/l4、hover-solid、bg-multi-select；selected 面加2px中性 secondary 边标。primary-fill/hover 与 primary-foreground 必须成对；focus 继承 Host ring color/width，与 selected 独立，保留 pointer modality 可透明的合同。小链接用中性必要字和 link 下划线，success/warn/error仅冗余标记。必要 input/select 边界用主字与layer1作54%混合；缺角色使用 Canvas/CanvasText、成对 ButtonFace/ButtonText，缺 color-mix 使用 CanvasText 边界。无生产 hex、`:root`主题、theme JS/bootstrap、明暗检测或第二 palette/store/router。

List 保留语义 table、局部 XY、sticky 表头/标题、拖动与键盘 resize、长标题完整访问。复用 native details 收纳 sort、8字段、清条件/默认列、独立 reset-width及说明；query/count/condition-adjusted/异常常显。query/width仍由现 owner持有，reset只经显式callback调用；关闭披露后焦点必须回到可见summary，不能藏在隐藏控件。

`ItemNavigation.currentItemId?: string` 只来自通过scope门的 route；Project重建navigation时透传，Web composed入口同样过门再透传。安全item行比较key，只输出布尔selected及链接 `aria-current="true"`，Escape后清除；撤权/错project/换scope不能留下旧marker、title/number或新rawID属性。redacted无marker，既有授权href/修饰键/中键保留；不解析href，不持第二selected对象。

`VisibleListRow`安全item新增 `planningStatusKey: NormalizedStatus`；在redacted早退后用实际规范枚举成员守卫（先检查string），非法结构落Unknown，不重新归一化来源文字。仅规范Done有冗余完成点；Unknown、native名“Done”、工程merged但规划Todo、redacted均不误绿，必要状态词用主/次中性文字。#605复用key且独占Unknown原生标签补充。

Delivery保留真实仓库选择、刷新本页、独立读取状态/页码/总数/上一页/下一页，各行PR/流水线/检查三组summary及原唯一detail入口。参考7项按每页20项为1/1且两页控件禁用；既有多页行为场景保留。不画List查询工具，不捏造freshness、工程成功或Planning完成。

选择成熟native控件与Host角色，是因它们覆盖当前交互、focus与ack合同；公开Host Button/Input已在 `docs/development/plugin-bundle-evidence.md` 比较。无已证实必须新库补足的需求，故不新增widget/theme依赖；如实际出现缺口，先重算ABI、fixture及预算，不以零依赖本身为目标。拒绝继续单PR拟合799、纯token基础PR或逐文件拆叶：前者已触准入门，后两者把用户闭环摊薄。

## Global Constraints

以下是唯一可写文件集合。UI源均以 `packages/ui/src/` 为前缀；测试前缀完整写出，未列路径不得顺手修改。A共享模块由本叶唯一source owner修改；原“A→B必须串行”的笼统约束已Superseded：共享roles/DTO/route/width在`ac4980b`独立代码验收后，A的TableControls/DeliveryOverview修复与B的detail/settings/forms采用disjoint ownership并行，协调者在双方交接后统一重放及集成回归。

| 集合 | 路径 | gross预测 |
|---|---|---:|
| 产品 | `workspace-presentation.ts`、`workspace-status.ts`、`work-item-project.ts`、`work-item-app.ts`、`work-item-list.ts`、`table-presentation.ts`、`table-controls.ts`、`list-states.ts`、`delivery-overview.ts`、`execution-presentation.ts`、`table-columns.ts`、`column-resize.ts`；`packages/ui-model/src/work-item-list-view.ts` | 565 |
| contract | `tests/contract/ui-work-item-list.test.js`、`tests/contract/ui-work-item-list-view.test.js`、`tests/contract/ui-column-resize.test.js`、`tests/contract/ui-workspace-status.test.js` | 70 |
| browser | `tests/browser/workspace-header.test.js`、`tests/browser/table-geometry.test.js`、`tests/browser/table-query.test.js`、`tests/browser/table-rq-integration.test.js`、`tests/browser/delivery-overview.test.js`、`tests/browser/workspace-read.test.js`、`tests/browser/table-resize.test.js`、`tests/browser/table-resize-regressions.test.js` | 155 |
| fixture | `tests/fixtures/table-geometry-browser.mjs`、`tests/fixtures/composed-workspace-browser.mjs` | 34 |
| 文档 | 本计划、`docs/README.md`、`docs/development/plugin-bundle-evidence.md`的本叶真实结论；协调者交接后打包`docs/product/release-list-delivery-evidence/README.md`及4–6张selected静态PNG（真实截图/对照，无生成器或实现代码） | 单PR严格<1300 |

初始技术代表点543、修复余量77和上界620已由独立几何裁决更新：当前实际313；剩余几何产品/测试保守265、binding代际与Delivery可达及收尾100、修复余量77，可信上界755，严格低于800，均须随真实diff复算。完整原范围的553产品+179非fixture测试+71fixture+3余量=806已触停止门，不能把拆分误称省去功能。A每次首RED、结构变化和final push前计算相对真实PR base的全部adds+deletes（含未提交/未跟踪必需内容、测试/fixture/config）；实际+剩余必需+已知修复可信上界>=800即停止扩写并修订承载。技术严格<800、文档严格<1300，不压行、不删安全测试、不藏生成例外。新增路径先修订本清单及预测。

A不带B已有35行settings smoke及7 gross JSX修复。Host仍拥有权威状态，未Provider ack/reconcile不Saved；凭据只存secret句柄。无Provider/core/schema/持久化迁移、额外事实源、业务写入、build/manifest/lock/workflow修改；无merge、Status或native关系写入。

## Plan of Work

### Batch 1 · 载体与真实RED

**最小闭环**：A公开承载及文件差分准确，真实App缺失行为有RED证据。
**涉及文件**：本计划、`tests/browser/workspace-header.test.js`、`tests/contract/ui-work-item-list-view.test.js`。

协调者先物化新A issue与#611映射，按实际diff把B准备工作完整移交，保留原806与RED证据。重新在真实 bindWorkspaceStatusApp→WorkspaceSetupGate→WorkItemApp→Project入口写选中断言：打开授权项后缺aria-current应失败，Escape移除。补规范key正控及非法/native Done/merged Todo/redacted负控；仅补现有矩阵缺口。依赖或fixture启动失败先修正并计账，不冒充行为RED。首RED后立即重算完整A上界。

功能/发布命令集中在本批、bundle命令只在Batch3；后批按风险复用而不另抄命令。除bundle注明位置外，均在检出 `feature/release-workspace-polish` 的工作树根运行；缺依赖/Chromium按 `tests/browser/README.md`准备，不skip。

    pnpm test:file tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list.test.js tests/contract/ui-column-resize.test.js
    pnpm test:file tests/browser/workspace-header.test.js tests/browser/table-geometry.test.js tests/browser/table-query.test.js tests/browser/table-rq-integration.test.js tests/browser/delivery-overview.test.js tests/browser/workspace-read.test.js tests/browser/table-resize.test.js tests/browser/table-resize-regressions.test.js
    pnpm test:file tests/contract/ui-work-item-detail.test.js tests/contract/ui-workspace-settings.test.js tests/contract/ui-workspace-setup.test.js tests/contract/ui-delivery-overview.test.js
    pnpm test:file tests/browser/detail-expand.test.js tests/browser/workspace-execution.test.js
    pnpm typecheck
    pnpm boundaries

期望新增行为先RED且原因明确，实施后全部相关测试GREEN、零skip/pageerror；既有detail/settings/执行功能和焦点不退化。没有外部业务请求；本地真实Host组合测试允许其既有测试RPC。

发布检查前将 `leaf_base` 设为当前远端PR的base SHA，最终push后重读。以下命令在同一shell依次执行；技术/docs人工严格门另计未提交及未跟踪内容，不以仓库宽门替代：

    leaf_base="$(gh api repos/SingularityKChen/harness-projects/pulls/611 --jq .base.sha)"
    git rev-parse HEAD
    git diff --check "$leaf_base"...HEAD
    git diff --numstat "$leaf_base"...HEAD
    node scripts/rule-checks.mjs disclosure "$leaf_base"
    node scripts/rule-checks.mjs size "$leaf_base"
    gh pr view 611 -R SingularityKChen/harness-projects --json number,headRefName,headRefOid,baseRefName,body,isDraft,closingIssuesReferences,reviewDecision,statusCheckRollup
    gh pr checks 611 -R SingularityKChen/harness-projects
    gh api graphql --paginate -F owner=SingularityKChen -F name=harness-projects -F number=611 -f query='query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$endCursor){nodes{id isResolved comments(first:100){totalCount nodes{body url} pageInfo{hasNextPage endCursor}}} pageInfo{hasNextPage endCursor}}}}}'

期望远端head等于本地HEAD、实际base/closing614/Refs604正确；扫描与diff通过、required PR Fast Gate通过、全部实质thread解决且评论证据读全。若任一thread评论超过100，继续分页该thread评论后再判定；不拿旧head或仅首屏作为验收。**回滚**：只撤本叶未完成改动，保留ignored失败日志，不动用户工作或Planning。

### Batch 2 · 真实List/Delivery GREEN

**最小闭环**：共享壳、List和Delivery达v3且旧detail/settings仍可用。
**涉及文件**：Global Constraints的完整产品、contract、browser及fixture集合；新增几何合同由`table-columns.ts`、`column-resize.ts`和既有resize判别承担，route代际仍在`work-item-app.ts`。

先接安全key/route selection与受控工具callback，再原地替换层次/角色/排印；删除被替代style与已定位镜像断言，保留活observer/sticky/resize及安全判别证据。几何carrier保留120项stress另增7项参考、44px Host及真实role输入；composed只增过scope的locator。复用Batch1相关命令获得GREEN，每次结构变化更新预算。

真实capture使用生产组件+EntityStore/client source，记录同数据/主题/宽度before、after和冻结reference：1440/1200/1024/390、明暗；另看长文、异常、200%、工具打开、selected+keyboard focus及无role fallback。computed配对、44px命中不重叠、长标题/局部滚动、Delivery多页与旧detail/settings可达均需实际观察。独立设计review比较层次、字体、密度、动作与跨面一致性，material差异解决后继续。**验证**：复用Batch1；截图、功能、安全各自有证据。**回滚**：完整revert本叶呈现提交，恢复旧浏览能力，无迁移。

### Batch 3 · 独立验收、真实包体与Ready

**最小闭环**：当前精确head有独立功能/视觉/发布证据，可由人类review。
**涉及文件**：本计划、`docs/development/plugin-bundle-evidence.md`。

独立验收者在owner交接后审查issue、候选图像、route/权限/焦点及读取反例，做必要重构后重跑受影响验证并更新体量。整理本地commit序列；已推历史重写先backup ref并由 `git-expert-operations` 走精确lease。最终push后重用Batch1全部发布回读，满足当前门才把#611 Ready，不merge。

包体须在clean实际base与clean候选、同一工具链/config下比较。以下在本叶工作树根执行，realpath得到已登记的设计base工作树；若远端实际base已变，先检出其精确SHA的clean工作树并将 `bundle_base` 设为其realpath，不能测错源。filter exec会切到插件目录，故先规范化全部输入/输出：

    bundle_head="$(pwd -P)"
    bundle_base="$(realpath ../release-visual-target)"
    pnpm --filter @harness-projects/app-harness-plugin exec node "$bundle_head/apps/harness-plugin/scripts/bundle-report.mjs" --source-root "$bundle_base" --out "$bundle_head/.superpowers/bundle-a/base"
    pnpm --filter @harness-projects/app-harness-plugin exec node "$bundle_head/apps/harness-plugin/scripts/bundle-report.mjs" --source-root "$bundle_head" --out "$bundle_head/.superpowers/bundle-a/head" --base-report "$bundle_head/.superpowers/bundle-a/base/report.json"

期望两report source.head匹配已锁定base/head、source.dirty=false，raw/gzip/pack/inputs/externals实际delta可解释、React external且bundledReact=[]；无theme module/build漂移。旧baseline或dirty观察不当candidate证据。**回滚**：B未落地可revert A；后层已消费则按Board/B→A逆序，保留恢复锚点。

## Validation and Acceptance

Batch1证明实际缺口与准入，Batch2证明List/Delivery与共享角色的完整可用/视觉/安全闭环，Batch3证明当前head可审阅；三者不能替代。A独立关闭新A issue，Refs604，不能关闭原604或解锁605。Ready、source测试、静态稿、installed Host美观和人类产品/UAT接受分别记录；#599安装验收与R1独立。

## Progress

- [x] (2026-11-10 SGT) v3已批准；完整806停止门确认，保持完整父scope并选定A→B承载。
- [x] (2026-11-10 SGT) 独立架构/产品拆分审阅后固定唯一文件集、接口与预测，见Global Constraints。
- [x] (2026-11-10 SGT) Batch1：协调者已实读#614/#611双向关联与准确base；B准备留在依赖叶。真实Header入口selection RED为`aria-current: null != true`；修正规范key用例排序后，以临时移除key归约行取得独立RED，恢复后GREEN。
- [ ] (2026-11-10 SGT) Batch2：完整A实现、本地86项contract与61项browser已GREEN（零skip/pageerror），typecheck及boundaries已通过；最终截图按冻结源码重启carrier生成并交接，独立设计/代码接受仍由协调者完成。
- [ ] (2026-11-10 SGT) 独立整分支代码/spec/质量在`ac4980b`获PASS；完整视觉评审Request changes两项P2（F1填值后目的、F2窄summary密度及Host slot）；本轮F1/F2真实RED→GREEN，23/23相关browser及13/13 renderer contract通过、typecheck通过；新head scoped复核仍待协调者。
- [ ] (2026-11-10 SGT) Batch3：独立验收、clean bundle、最终远端回读及Ready。

## Surprises & Discoveries

B累计全套暴露旧modal生命周期契约仍假定同workspace换binding保持旧route；在A单例复现undefined≠空notice的RED后，仅更新既有contract，经真实navigation.open重开后继续证明degraded/recovery/timestamp与缺binding历史清除，不改变产品scope代码。新增该文件到唯一contract集合；此前86/61不包含这条旧契约，不冒称已覆盖。

独立完整视觉评审发现初帧正常不代表填值态：font-size:0隐藏label，placeholder消失及非all option未带字段前缀导致F1；F2的旧viewport媒体规则既把每组label/value堆成两行，也无法响应1440窗口内390 Host slot。新增真实控件/选项、三组label/value盒测量与窄slot RED后，仅在原两组件修复，使用既有inline-size容器，无JS布局owner、固定行高或裁字。

实施读源码发现`defaultLocalTableConditions()`原本显示5列，完整字段为8；冻结handoff要求保留默认值。原“默认8”事实错误，已更正为默认显示5/完整8可达，没有改变query owner或默认行为。

首轮新增规范key测试误取EntityStore按key排序后的redacted首行；已改为`a-safe`/`z-hidden`并以移除真实key归约行确认判别RED。旧误取失败不作key实现证明。结构化非法status的`toString`可曾被标签表转换成Done文字；新增文本断言取得RED后，在既有pick函数先检查string，非法结构显示未知。

新增来源副标题曾在拒读时复述retained metadata，既有同scope安全测试捕获；已仅对安全content呈现副标题。原生显示选项打开后需border-box与fieldset min-inline-size归零，避免窄/200%产生第二X owner；关闭含焦点控件的details由onToggle把焦点交回summary，查询及列宽重置仍由原owner显式callback处理。

首次组合shell末尾capture exit0遮蔽了前一测试非零；“14全过”口头记录由真实`green-3.log`的12/14取代。失败是窄标题最小宽与经典scrollbar焦点行；旧消费者同时为83/84 contract、25/26 browser。后续各测试/capture独立调用，以独立exit/log为准。detail失败来自扩大全局space对旧抽屉完整行的侵蚀，已恢复原space刻度并将页面padding约束在窄slot；数据属性CSS误触旧泄漏断言，改以既有aria-current选择当前行，未删除安全断言。

几何三项真实RED后，采用唯一resolver与既有宽度owner：首次auto调宽冻结当前可见effective map，已manual时保留requested而不把窄窗title临时cap写回，取消恢复完整pre-drag快照；reset/scope epoch使旧cleanup失效。新判别覆盖首status拖+24/键盘+8时兄弟列不动，取消后1200→1440恢复auto，manual title640窄窗调status后回宽仍640，ARIA与真实title动态边界一致。旧resize用例三次找不到已收纳的reset控件，现通过真实披露抵达；捕获中reset的专用测试保留显式hidden locator调用以判别旧session清理，不拿它证明交互可达。旧RQ固定144/168断言改以实际auto起点检查+40/+24，保留独立重置、scope和捕获反例。

Delivery现有flex链只在List scroll存在时生效，曾令长交付内容在y404裁掉；新增真实overflow/末行可达RED后统一既有project flex链，Delivery body独占其局部Y滚动，保留仓库/本页刷新/独立读取状态及真实20项分页。7项引用场景1/1两控件disabled；120个安全项保留6页实际切换。binding代际测试使用同步setup/read scope carrier，避免制造setup binding与read不一致的伪撤权场景；同binding拒读保持同一mounted dialog，source消失清route，暂undefined与恢复保留初始深链。

第一轮参考场景实测Host44px、表头y195.984/44px、短行58px；表宽976与title320导致长标题及Unknown额外换行。独立设计review认定为material差异，尚未通过Batch2设计门；继续采用真实resize几何，不用CSS隐式stretch制造handle脱节。精确参考数据顺序已统一，并从实际base源码重新渲染同fixture before，旧未统一顺序图不作精确对照。

原完整计划775不是保证；真实carrier暴露JSX runtime缺失7 gross、settings smoke35，几何120项/frame2项/旧role无法当7项同参考，fixture上界由40修订71，完整553+179+71+3=806。原单PR准入 Superseded by 本计划Global Constraints与B累计计划（2026-11-10）。该数是可信上界，不是数学下限或实际patch。

原owner在停止点报告真实selection RED（aria-current null而非true）、真实settings smoke1/1及相关合同43/43、typecheck、boundaries9/9；这些是准备载体证据，不是A已实施。共享executionStyles被Delivery调用且拼接FORM_STYLES，故execution-presentation整文件由A拥有；其原12预测从B移A，不额外加12。B改FORM后再回归A Delivery。

## Decision Log

Decision：独立视觉F1/F2只在TableControls/DeliveryOverview及其判别browser修复，不重启已批准v3；稳定共享roles/DTO/route/width在`ac4980b`已获独立代码PASS后，A修复与B detail/settings/forms以互不重叠源文件并行。Rationale：F1需填值后保留控件内目的与每个option字段前缀；F2需按实际组件容器宽，将窄summary label/value同排、允许自然增长。两方交接前不重放dirty tree，最终集成回归由协调者执行。Date/Author：2026-11-10 SGT / 协调者裁决、各子系统唯一owner。

Decision：独立几何裁决采用1144可读基线与真实容器surplus自动增长；首次resize在原useColumnWidths冻结整份可见effective map，取消恢复完整preference快照，所有渲染/handle/ARIA共享同一数值。Rationale：976宽已被判material；隐式CSS拉伸和只固定触及列均会造成边界/指针脱节。唯一清单新增table-columns/column-resize及现有resize判别文件；完整保守上界755。Date/Author：2026-11-10 SGT / 独立几何reviewer、协调者裁决，A实施owner执行。

Decision：既有path owner记录workspace+planning binding的代际归属，同binding撤权保留已挂载详情更新安全状态，真实scope变更使旧route失效；暂undefined的read不误清。Rationale：不能依赖Host稍后清store保护旧selection；此元数据属于route归属，不是第二selected对象或Provider源。Date/Author：2026-11-10 SGT / 协调者裁决、A实施owner。

Decision：保留源码默认5显示列及完整8字段可达，修正原默认8叙述。Rationale：现owner与冻结handoff一致；不以视觉实施改变局部query默认行为。Date/Author：2026-11-10 SGT / 协调者确认、A实施owner。

Decision：局部查询、列宽、view mode、scope和唯一drawer仍由既有owner持有。Rationale：selection只消费过scope的currentItemId，redacted早退；规范key只接受枚举string，工程merged不改变规划Done。Date/Author：2026-11-10 SGT / A实施owner。

Decision：采用仅新增A issue、#611承载A、B基于A关闭完整604，原native边/Status不改。Rationale：两个可观察能力闭环保留全部范围，并用真实角色/locator依赖承载stack；减少空协调对象。Date/Author：2026-11-10 SGT / 交付协调者及独立spec reviewer。

Superseded（2026-11-10 SGT，稳定接口独立代码验收后）：Decision：同一UI owner串行A后B，A共享角色先保证旧消费者可用。Rationale：共享CSS、query及唯一dialog责任连续，不能以分PR制造并行共享写者。Date/Author：2026-11-10 SGT / 独立spec reviewer。

## Idempotence and Recovery

读检查、测试与capture可重复，输出放ignored任务目录；未知/失败如实保留，不改Status“解锁”。重放/提取只按实际diff处理42行B准备，test与JSX修复一起移交，不机械cherry-pick混合提交。每批恢复到最后GREEN提交，保留未完成RED的ignored证据；不清理别人的worktree。

回滚按实际依赖逆序且不触Provider事实/数据。真正有意延期的实现债写 `docs/exec-plan/tech-debt-tracker.md`，现有#145/#606/#607/#599不伪装新债；不以债务名义移除本次安全或视觉验收。全部A验收通过后移本计划至completed并更新索引，B仍负责完整604。

## Interfaces and Dependencies

A拥有安全row的规范key、过scope的可选currentItemId、受控reset-width callback及私有Host角色别名；B/Board消费，既有query/width/dialog/form transaction owner不变。Node/pnpm、Chromium、gh、现有测试barrier及已登记clean worktree是执行依赖；无新公共业务API、Provider或持久化字段。

## Outcomes & Retrospective

独立复核后的F1/F2修复以`ac4980bd2c404c3d3521f2d1610feb61fa420073`为准确fix base；此前86/61及整分支代码PASS继续归属旧head。F1/F2及旧scope契约校准后整个叶实际技术706、文档185（随后文档记录按最终numstat复算），剩余必需技术0+77修复余量，上界783<800；无新源文件或功能延期。本轮23/23相关browser、13/13 renderer、15/15 workspace-status契约及typecheck通过；另以真实binding路由browser复核scope契约，未重跑无关86/61全集。填值控件内目的与normal y196保留、窄summary按真实容器同排、正常短行从233px约收敛至153px且200%自然增长。只运行填值/窄slot判别与相关query/Delivery/header/geometry/RQ回归，不把旧接受移作新head结论；最终本轮head、实际gross、重启carrier截图hash及scoped复核记录写入交接报告。

Batch1及A工程实现已完成本地闭环，首轮`ac4980b`候选树实际技术gross为615：产品302、browser220、contract48、fixture45，包含相对准确设计base的全部新增+删除；没有新增未跟踪产品或配置。首轮以必要实施余量0及77修复余量计，可信上界692，严格小于800；文档仍低于1300。独立验收若再改变源码，须重新按整个叶差分计量，不把旧预测或已跑日志当作新候选证据。

最终本地命令得到86/86 contract、61/61 browser（含完整几何/resize、真实Host读取、Delivery、旧detail/settings/执行消费者），零fail/skip/pageerror；typecheck与boundaries9/9。实测1440/1200表铺满1392/1152，Host44、表头y195.984/44、短行58，真实numberLabel及工程“无”保留，selected只由当前授权route呈现。源码合成before/after/reference和状态矩阵为本地证据，不等于安装Host接受；代码/视觉独立review、clean bundle、静态证据打包与最终远端门由协调者在交接后完成，未声明Ready或关闭#614/#604。

## Bottom Change Note

2026-11-10 SGT：记录A本地实现、真实RED修复、scope与几何裁决及最终工程证据；静态PNG发布打包交协调者。806停止门后创建自包含A计划；保留完整604，将execution责任归A，固定安全接口、真实对照、旧消费者回归及各层当前发布门。记录已创建A issue #614及既有关系保护；后续易失状态仍按当前远端回读。
