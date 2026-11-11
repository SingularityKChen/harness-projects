# 详情、设置与完整工作台视觉收口 ExecPlan

> 状态：Completed；本地累计、独立验收与首次当前远端门完成，最终归档head继续回读。Superseded by Batch 4 MMP 修复与待独立复评门（2026-11-11）
> 创建：2026-11-10
> 规范：根 `PLANS.md`；关联 #604、#614、#603、#605
> 正式路径：`docs/exec-plan/completed/2026-11-10-release-workspace-polish.md`

## Purpose / Big Picture

用户从同一工作台连续阅读安全详情、展开还原而不丢读位/草稿，再完成真实规划连接、字段映射、执行和仓库设置；界面达到已批准v3且pending、unknown、error、Host确认清楚区分。B完成局部呈现并累计A+B的完整workspace/navigation、List/Delivery、detail、settings/forms/feedback验收后，才能关闭原完整#604。

## Context and Orientation

B分支 `feature/release-detail-settings`，工作树 `.worktrees/release-detail-settings`，新PR实际base为 `feature/release-workspace-polish`，`Closes #604`、`Refs #614`。A由现#611承载且base为 `docs/release-visual-target`，只关闭新A；Board #612以B为base，理由是继续遵守完整604先决，并非虚构B新增业务API。A issue #614作为#604的native subissue；原 `#604 blocked-by #603`、`#605 blocked-by #604`、其他native边和所有Status不变；只保留真实共享依赖的线性分支栈，不创建额外native边。

上游参考 `docs/product/release-visual-target-v3/README.md`、`handoff-v3.md` 及manifest SHA-256 `d714cea12faa96bb6411c4e19c3712914af98bad199dd3787cdb419ecbf48c29` 已获人类“批准 v3，开始实施”。冻结handoff的未接受字样是历史状态，由README/设计ExecPlan的批准记录取代；不重做设计、不改冻结图像、不重复询问。

A计划为 `docs/exec-plan/completed/2026-11-10-release-list-delivery.md`，拥有共享Host角色、List/Delivery、安全规范key与scope-derived selection。`WorkItemProjectPage`继续拥有mode、opener与唯一detail；`WorkItemDetailDrawer`保持mounted dialog、preview/expanded、内容矩形observer和读位。`WorkspaceSettings`已有四任务rail/chooser/hidden panels，`WorkspaceSetupGate`与client sources拥有真实表单事务；B只改安全内容头、metadata和局部样式。

## Design / Spec

完整#604范围不缩减：共享workspace/navigation、现有List/Delivery、唯一detail、真实四任务settings/forms/feedback。A提供前两部分和共享接口；B提供后两部分并负责父scope累计完成账。产品默认显示5字段不改，完整8字段访问保留，7行/visible5-of8只用于同内容参考；Board/Timeline仍不提前激活。正常1440参考的44px Host、表头约y196/44px、短行58px保持；异常/长文/200%自然增高，不能裁安全事实。

详情保持来源限定编号→长标题→规划状态连续层次，metadata改语义dl，unknown/read/refresh/native事实完整；正文14/22、必要身份12/18、页级22/30，消除重复视觉标题带。preview参考约510px但仍服从真实容器矩形；禁止删observer、用viewport硬定位或按mode/item重挂载。保持business sections、StartWork draft/pending、滚动读位、Tab containment、inert、Escape和原opener/安全标题回焦；不新增dialog/route/query owner。

Settings原四任务“规划连接/字段映射/执行/仓库”沿既有hidden identities，宽屏160px rail+32px沟槽+最多720px单内容列，窄屏原chooser；不新建sidebar、能力栏、表单框架或配置源。label/help/error关联、44px互不覆盖命中与安全恢复均可达，隐藏任务之外的共享task-independent recovery仍可见。切任务/后台读不覆盖draft，unknown不自动重发，pending不Saved，只有Provider ack/reconcile确认。

B消费A共享Host角色，不复制主题：Canvas/CanvasText与成对ButtonFace/ButtonText fallback；primary-fill/hover/foreground成对，移除FORM局部CanvasText冲突覆盖；必要input/select边界用主字54%与layer1混合、无color-mix回退CanvasText。必要次字/状态/error保持中性，语义色仅冗余；focus沿Host独立ring，pointer modality不为截图强行改写。无theme JS/root override/明暗检测/store/router或新库。A独占execution-presentation，B的FORM与Markdown仍影响其消费者，故须回归Delivery/Execution/StartWork。

复用成熟真实控件、source/barrier和mounted owners可减少状态风险；公开Host组件/替代路径已有 `docs/development/plugin-bundle-evidence.md` 的比较。若实际需要新组件先测ABI/构建/fixture成本，不以零依赖拒绝明确需求。拒绝单PR勉强799、纯CSS额外PR及四个独立表单：前者越已批准停止门，后者摊薄能力或制造第二owner。

## Global Constraints

以下是B唯一可写文件集合；UI源均以 `packages/ui/src/` 为前缀，测试使用完整路径。A共享接口及旧流程已通过独立代码验收后，允许与A剩余两组件视觉修复并行：B独占本清单，A仅改自己的query/Delivery组件；共享WORKSPACE/DTO/route/width接口冻结，每个架构子单元与文件只有一个owner。最终由协调者重放至A最终接受head并组合验收，交接后独立reviewer可必要重构。

| 集合 | 路径 | gross预测 |
|---|---|---:|
| 产品 | `detail-presentation.ts`、`work-item-detail.ts`、`workspace-settings.ts`、`form-presentation.ts`、`markdown-presentation.ts` | 153 |
| contract | `tests/contract/ui-work-item-detail.test.js`、`tests/contract/ui-work-item-detail-view.test.js` | 5 + 修复实测 |
| 安全投影修复 | `packages/ui-model/src/work-item-detail-view.ts`；只复制既有安全行的规范状态 key | 修复实测 |
| browser | `tests/browser/detail-expand.test.js`、`tests/browser/workspace-settings-presentation.test.js` | 65 |
| fixture | `tests/fixtures/workspace-frame-browser.mjs`、`tests/fixtures/workspace-forms-browser.mjs`（含JSX修复） | 37 |
| 文档 | 本计划、`docs/README.md`、`docs/development/plugin-bundle-evidence.md`、`docs/product/release-detail-settings-evidence/README.md`与选定静态PNG的本叶/累计真实结论、`docs/review/pr-615-mmp-review.md` 作者追加证据 | 单PR严格<1300 |

代表点260、修复/不确定余量90、B可信上界350均是预测；execution原12由B移A，未增加总体产品553。现有settings smoke35及JSX+4/-3=7共42实测全部归B，不能把它们当v3完成或重复计42。B相对真实A base计所有adds+deletes、测试/fixture/config与必需未提交/未跟踪文件；首RED、结构变化、final push前重算实际+剩余必需+已知修复。可信上界>=800停止扩写，技术严格<800/docs严格<1300；不压行、删安全测试或藏生成目录。新增路径先修清单/预算。

Host权威、未ack/reconcile不Saved、secret只存句柄、规划与工程正交均保持；无Provider/core/schema/持久化迁移、外部业务写入、build/manifests/locks/workflows、第二事实源。原setup/settings合同优先原样复用，仅真实缺判别证据才扩写并计账。无merge、Status或native边写入。

## Plan of Work

### Batch 1 · B承载与局部真实RED

**最小闭环**：B只含自己的准备/计划，真实detail/settings缺口可重现。
**涉及文件**：本计划、`tests/browser/detail-expand.test.js`、`tests/browser/workspace-settings-presentation.test.js`。

协调者将原42行test+JSX修复一起移交B，保留完整父scope及806停止事实；新B PR不重复建父issue。先确认A稳定接口与旧流程GREEN（启动候选ac4980bd已经独立代码验收，A的剩余F1/F2不改B消费接口），再在真实frame/WorkspaceSetupGate+setup/mapping/repository source及barrier中补安全头/dl、真实primary配对/控件边界或反馈布局缺口，取得行为/几何RED后改生产。已有carrier smoke保持GREEN，不能当作新增v3 RED；bootstrap失败单独诊断/计账。

功能/发布命令集中在本批、bundle命令只在Batch3，后批复用而不另抄；默认在检出 `feature/release-detail-settings` 的工作树根运行，缺依赖/Chromium按 `tests/browser/README.md`准备，不skip。

    pnpm test:file tests/contract/ui-work-item-detail.test.js tests/contract/ui-workspace-settings.test.js tests/contract/ui-workspace-setup.test.js
    pnpm test:file tests/browser/detail-expand.test.js tests/browser/workspace-settings-presentation.test.js tests/browser/workspace-execution.test.js tests/browser/delivery-overview.test.js
    pnpm test:file tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list.test.js
    pnpm test:file tests/browser/workspace-header.test.js tests/browser/table-geometry.test.js tests/browser/table-query.test.js tests/browser/table-rq-integration.test.js tests/browser/workspace-read.test.js
    pnpm typecheck
    pnpm boundaries

期望B新判别先真实RED，实施后B及A核心回归全部GREEN，零skip/pageerror；保留mounted/读位/draft/pending/unknown不重发/权限/ESC/回焦。不得有外部业务请求；真实Host组合测试允许既有本地RPC。因为跨面共享角色及FORM影响，B最终累计head执行一次现有全suite；仅有新失败/未决风险才重复扩大：

    pnpm test

发布前从当前分支解析新B PR及实际base SHA（创建PR后再执行），final push后重读；不要固定旧SHA或把B量成设计base：

    leaf_pr="$(gh pr view -R SingularityKChen/harness-projects --json number --jq .number)"
    leaf_base="$(gh api "repos/SingularityKChen/harness-projects/pulls/$leaf_pr" --jq .base.sha)"
    git rev-parse HEAD
    git diff --check "$leaf_base"...HEAD
    git diff --numstat "$leaf_base"...HEAD
    node scripts/rule-checks.mjs disclosure "$leaf_base"
    node scripts/rule-checks.mjs size "$leaf_base"
    gh pr view "$leaf_pr" -R SingularityKChen/harness-projects --json number,headRefName,headRefOid,baseRefName,body,isDraft,closingIssuesReferences,reviewDecision,statusCheckRollup
    gh pr checks "$leaf_pr" -R SingularityKChen/harness-projects
    gh api graphql --paginate -F owner=SingularityKChen -F name=harness-projects -F number="$leaf_pr" -f query='query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$endCursor){nodes{id isResolved comments(first:100){totalCount nodes{body url} pageInfo{hasNextPage endCursor}}} pageInfo{hasNextPage endCursor}}}}}'

期望远端head等于本地HEAD、当前base/Closes604/Refs614正确，扫描/diff及严格人工gross通过，required PR Fast Gate通过，实质threads解决且评论证据读全；thread评论超过100继续分页该thread。**回滚**：撤本批不完整改动，保持A已知GREEN及原42准备，RED证据留ignored。

### Batch 2 · 详情、四任务与反馈GREEN

**最小闭环**：在A上完整交付安全详情/真实设置与反馈，原事务合同保持。
**涉及文件**：`packages/ui/src/work-item-detail.ts`、`packages/ui/src/detail-presentation.ts`、`packages/ui/src/workspace-settings.ts`、`packages/ui/src/form-presentation.ts`。

原地改safe contentPanel头、dl与局部排印，保留dialog/observer/business挂载；原地调rail/chooser/form/markdown，不改source和提交owner。删被替代样式及确证镜像断言，保留所有有判别力安全/事务/读位测试。frame保留原2项/裁剪stress另增与参考一致7项；forms保留真实barrier，补role/capture模式及pending/error/unknown分离反馈。每次结构变化重算预算，用Batch1相关命令令RED转GREEN，FORM变更必须回归Delivery及Execution。

真实生产合成before/after/reference同数据、主题、宽度记录：1440/1200/1024/390明暗，detail背景同7项，settings四任务与pending/error/unknown/Host确认；另审长文、异常、200%、无role fallback、实际computed配对、44px不重叠和键盘。现stress场景保留，不拿Canvas fallback冒充Host角色。独立设计review检查层次/排印/密度/动作及跨面统一，material差异先解决。**验证**：复用Batch1；功能与图像证据分别成立。**回滚**：revert B呈现提交保留A和旧detail/settings，无数据删除。

### Batch 3 · 完整604累计验收、包体及Ready

**最小闭环**：A+B全部原scope在当前B head有可审查证据，等待人类merge。
**涉及文件**：本计划、`docs/development/plugin-bundle-evidence.md`。

独立最终验收者在owner交接后核对原604六项：准确范围/预算；全部真实面层次密度；Host选型及构建证据；List/Delivery/selection/filter/focus/唯一detail与四任务恢复；同场景before/after/reference及独立设计review；替代样式清理、保留安全判别与可逆恢复。复用Batch1跑A+B并记录累计证据索引，不能只看B diff。必要重构后重测；整合前A须独立验收，关闭604前A须先交付/合入，B及完整父scope累计验收全部通过。Ready不等于允许merge或Planning接受。

包体使用plugin scoped工具，在clean实际A base和clean B候选、同工具链/config下比较；另测设计base→B累计delta。以下在B工作树根，所有路径先realpath，避免工具拒绝含`..`的source-root；若任一实际base已改变，先准备其精确SHA的已登记clean worktree并替换相应变量：

    bundle_head="$(pwd -P)"
    bundle_base="$(realpath ../release-workspace-polish)"
    bundle_design="$(realpath ../release-visual-target)"
    pnpm --filter @harness-projects/app-harness-plugin exec node "$bundle_head/apps/harness-plugin/scripts/bundle-report.mjs" --source-root "$bundle_base" --out "$bundle_head/.superpowers/bundle-b/base"
    pnpm --filter @harness-projects/app-harness-plugin exec node "$bundle_head/apps/harness-plugin/scripts/bundle-report.mjs" --source-root "$bundle_head" --out "$bundle_head/.superpowers/bundle-b/head" --base-report "$bundle_head/.superpowers/bundle-b/base/report.json"
    pnpm --filter @harness-projects/app-harness-plugin exec node "$bundle_head/apps/harness-plugin/scripts/bundle-report.mjs" --source-root "$bundle_design" --out "$bundle_head/.superpowers/bundle-b/design"
    pnpm --filter @harness-projects/app-harness-plugin exec node "$bundle_head/apps/harness-plugin/scripts/bundle-report.mjs" --source-root "$bundle_head" --out "$bundle_head/.superpowers/bundle-b/cumulative" --base-report "$bundle_head/.superpowers/bundle-b/design/report.json"

期望source.head逐一匹配锁定身份、dirty=false，raw/gzip/pack/inputs/externals实际差值可解释、React external且bundledReact=[]；无theme/build漂移，不用旧源数字代替candidate。

整理commit与publication人工五类审查后final push；已推历史重写先backup ref并走 `git-expert-operations` 精确lease。复用Batch1当前head/base/checks/完整threads/issue关联回读，独立结论与必需checks通过才Ready。父scope未完成时B保持Draft，不提前自动关闭604；#605仍受完整604先决约束。**回滚**：先B后A，Board等后层已落地则先撤后层；不删除共享base/用户worktree。

### Batch 4 · MMP 全部意见修复（2026-11-11）

**最小闭环**：在线连接下陈旧条目与长正文仍在首屏给出条目来源／最后已知限定；超长未映射状态在头部保持简短且诚实，原文在可达 metadata 中完整保留。只调整本叶文件集合；协调者额外批准安全 DTO 与其既有契约路径，不改共享列表／表格／Board／宽度 owner。

**根因与设计**：详情把安全状态提升到 header，却把 source/stale 留在长正文之后；header 又直接放入任意长 native 文本。继续使用 `row.stale`、`view.body.refreshing` 与安全来源名，在状态旁显示简短来源和“当前值／最后已知值”；来源长名可省略显示，完整 source/authority/identity/time 仍在原 dl。将列表安全行的 `planningStatusKey` 同次复制到 detail content，Unknown 头显示“未知”，完整 `planningStatus` 原样新增到 dl。不从本地化显示文本猜规范状态，不读第二次 raw getter 重算，不新增状态权威。

默认在检出 `feature/release-detail-settings` 的本叶根执行；采用服务端自动 restack 后的修复起点 `823ff8faeaf396f6ba95a3b1f004d1db246bd76c`，实际父层 `7aa347b7051b3df38c8a72ac1580fc77b42de539`（2026-11-11 观察）。这两个 SHA 用于本次历史执行归因，协调者后续重放必须重新取实际 base/head。

    pnpm test:file tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js tests/browser/detail-expand.test.js
    pnpm test:file tests/browser/workspace-execution.test.js tests/browser/delivery-overview.test.js tests/browser/workspace-settings-presentation.test.js tests/contract/ui-safe-markdown.test.js tests/contract/ui-workspace-status.test.js

期望分别 36/36、60/60，零 skip；其中真实组合 `WorkItemApp` 测 connected + stale + 16000 字正文，以及 320×320 / 200% 的 1520 字未映射 native、1000 字 iteration、950 字 external identity。宽窄首屏 source/stale、Unknown 头最多两行、完整 raw metadata 的实际滚动可达与无水平溢出必须成立；`metadata-nowrap` 负控必须被相同长值断言检出。复用 Batch 1 的 typecheck/boundaries 与发布扫描命令；没有共享样式／事务改动，不重复完整 suite。

before/after 使用同场景、主题、字体、viewport 与 fixture，保留实际 HEAD/dirty、生产／fixture／PNG／浏览器 bundle SHA-256；窄屏初始动作区截图相同，另拍真实滚动到 status 与 metadata 的画面，不把滚动后图称为首屏。选择公开 contact sheet 和重放后的包体由协调者最终发布；原旧图像／bundle 身份不改写。**回滚**：revert 本次修复提交恢复本叶原呈现，保留历史评审全文与 RED 证据；无数据迁移或外部写入。

## Validation and Acceptance

B局部验收证明详情与四任务可用、美观及事务安全；累计验收还必须证明A的workspace/List/Delivery完整保留。功能测试、同场景真实图像、独立设计review、clean bundle及当前remote门各自成立，任何一项缺失不能关闭604。静态稿/source Ready不是#599安装美观/真实数据交互、人类UAT或R1放行。

## Progress

- [x] (2026-11-11 SGT) Batch 4：两条原反例先 RED；安全 key 契约 3 项 RED 后 GREEN，详情／挂载／读位／焦点 36/36、相关真实消费者 60/60、typecheck 与 boundaries 9/9 通过。保留首轮评审全文，仅 append 作者修复证据。
- [ ] Batch 4 后续：协调者重放实际父层、独立复评、重新取当前 remote head/base/checks/threads、发布选定 contact sheet 与 fresh bundle；本叶 local GREEN 不替代这些门。


- [x] (2026-11-10 15:08 SGT) 人类批准具名v3及固定manifest，授权实施，无需重询。
- [x] (2026-11-10 SGT) 原完整单PR首真实selection RED；真实settings carrier1/1和相关合同43/43 GREEN，技术42/docs209为当时checkpoint，未改产品。
- [x] (2026-11-10 SGT) 实测后完整上界806触>=800停止门；独立架构/产品复核确定A→B承载和完整父验收。
- [x] (2026-11-10 SGT) Batch1本地：承接原42准备；真实安全头/设置列宽RED，以及Host14px预览448→510px RED；实际父层仍锁定ac4980bd，最终远端base由Batch3回读。
- [x] (2026-11-10 SGT) Batch2：本地detail/settings浏览器8/8、原事务与Delivery/Execution消费者77/77、A核心回归53/53均GREEN；双主题四宽度before/after各48图、含四任务与四类反馈，另128场景量测通过；该历史等待 Superseded by 本节最终累计证据（2026-11-10）。
- [x] (2026-11-10 SGT) B独立代码复核F1/F2局部闭合：真实320px/root28与30、preview/expanded及900/320高度先RED；编号和metadata值自然换行后GREEN，正常390保留两列、正常1440几何不变。详情/Markdown/contract32项、消费者26项与typecheck通过；完整累计复验仍待最终A base。
- [x] (2026-11-10 SGT) Batch3：累计源与交互、独立代码/视觉identity、clean bundle及静态证据均齐；首次发布0ee6c0e的实际base37c84f92、PR Fast Gate、双向closing604与完整threads通过后置Ready。本次归档后仍按Batch1命令回读最终head，不沿用旧checks。

- [x] (2026-11-10 18:43 SGT) 最终累计候选8268f7ba（实际父cde887f7）完整3961/3961、组合browser74/74、typecheck通过，零skip/pageerror；before/after各72图及128场景审计绑定同一真实身份。前层旧modal失败已由A安全scope修复，本轮完整suite未复现。
- [x] (2026-11-10 18:43 SGT) 重放到A最终归档后的clean候选2773147f（实际父37c84f92）；475个生产/测试/app文件逐字等价，图像仍归8268/cde实际拍摄版本。clean本叶client gzip+335、完整A+B+2915，Host无变化，React external及输入图未变。静态证据与完整hash见 `docs/product/release-detail-settings-evidence/README.md`。

- [x] (2026-11-10 SGT) 独立最终Spec/Code quality/A+B累计能力与B Visual/Interaction/图像身份均ACCEPT，无新finding或必要重构；静态11图、真实版本哈希与clean bundle已写入正式证据。当前remote验收仍按Batch3最终head回读。

## Surprises & Discoveries

2026-11-11 补充 P3：头部中间候选曾一律“未知（未映射）”，缺失 native 标签时会过度断言；两项真实 RED 后改为中性“未知”，缺失与有 native 的完整 metadata 各有正控。该项未增加 DTO flag 或后缀解析。

2026-11-11 MMP：原短 native／短 metadata 的绿色测试不足以证明任意长值。真实 RED 下未映射状态头高约 4706.5px、正文 y5113.2；同输入修复后状态一行约 38.6px，正文 y552.4，短高度沿既有外层滚动可达。在线条目 source/stale 的首屏缺失与页面 live notice 为空是同时存在的，不能用 transport connected 推断条目已确认。首次新增 fixture 未配置来源名，纠正后在原生产源码上重新取得具名来源 RED；这次 fixture 接线错误没有记为产品行为通过。


历史完整单PR方案为产品553+测试fixture219+余量3=775；**Superseded by 本节实测修订与Global Constraints（2026-11-10）**。首真实carrier发现forms缺react/jsx-runtime，需要7 gross接线，smoke35；geometry120项/frame2项且无参考Host角色，原fixture40不能覆盖7项同场景，修订为71。完整553+179+71+3=806是可信上界，不是实际diff或数学下限；已触门，未继续产品扩写。

历史拆叶预测A592/B325及“两个新叶issue各自关闭”的恢复建议，**Superseded by 本计划Context and Orientation与Global Constraints（2026-11-10）**：仅新A issue，B关闭完整604；A400+143、B153+107，guarded上界620/350。execution原12已归A，因为Delivery实际消费；B FORM变化需回归A，不重复记12。

原owner报告selection aria-current为null而非true的真实RED；runtime缺失不是行为RED。已报告typecheck与boundaries9/9通过、settings1/1/相关43/43只证明carrier及既有合同，不证明新叶v3、完整视觉、bundle、hosted CI或安装接受；本计划当时尚未取得B工程GREEN；该观察 Superseded by Progress最终累计验证（2026-11-10）。

本地checkpoint相对ac4980bd的技术gross216（包含原42准备）、文档gross173；当前没有新增正式路径，剩余已知源码必需改动为0，保留90修复/不确定余量的可信技术上界306，未触>=800停止门。最终base和静态资产交付后的文档预算仍由协调者重计。

本地B呈现保持原modal、observer、滚动、任务hidden identities与source事务owner；仅将编号/标题/状态合成安全头、metadata改dl，并消费共享Host角色。为24px正文padding同步修正最小body空间，原PageDown坐标落入空白导致焦点仍在长标题；改为先点击同body真实刷新控件，再保留原PageDown/读位断言。510px cap由CSS与observer共享一个rem常量，不新增第二布局owner。

本轮完整 `pnpm test` 在contract层1550项中1549通过、1失败：`ui-workspace-status.test.js` 的modal lifecycle在同工作区binding切换后从已关闭dialog提取notice得到undefined，旧断言期待空串。已通知共享owner，B未改越界文件；不得记全suite GREEN。继续执行后续原层：integration2185/2185、E2E226/226通过，零skip。当前源typecheck与boundaries9/9通过；独立最终累积重验仍归协调者。

独立复核发现窄200%下header动作占满grid、编号0px宽，以及metadata的6rem标签最小列将dd压到0–7px。真实RED为root28编号0×900、来源身份dd7×1672；局部intrinsic flex-wrap修复后196×108及196×176，root30分别约190×116及190×236。字段、原scroll/mounted owner与安全测试均保留；正常1440编号284.5px、值337.125px前后相等。相对冻结A技术gross现为259，剩余已知必需产品改动0，保留90修复余量的可信上界349；文档以最终numstat回读。

## Decision Log

Decision：MMP 两条意见全部在本叶 TDD 修复；协调者明确授权 detail 安全 DTO 和既有 detail-view contract 路径加入唯一写集。Rationale：仅 UI 字符串无法区分真正 mapped 状态与同文 native 标签，复制现有安全 key 比猜中文或读取原始实体更小且安全；redacted/unavailable/loading/unresolved 分支保持完整抹除。Date/Author：2026-11-11 SGT / 协调者授权，本叶 owner 实施。


Decision：具名v3已获“批准 v3，开始实施”。Rationale：明确针对固定manifest的完整视觉同意，取代仅v2版式认可；不扩大到merge、Status/native边或#599接受。Date/Author：2026-11-10 15:08 SGT / 人类伙伴，协调者记录。

Decision：806停止后采用新A issue/#611，再B新PR累计关闭原完整604，不削范围；同一UI owner串行。Superseded by 本节稳定接口后的disjoint并行决定（2026-11-10）。Rationale：真实共享角色/安全locator是A依赖，B能在A上独立验收/revert并保留其浏览能力；避免空协调父项及并发共享CSS写入。Date/Author：2026-11-10 SGT / 交付协调者及独立spec reviewer。

Decision：A完整产品代码在ac4980bd获独立spec/quality/wholebranch接受，86contract/61browser及旧消费者GREEN；剩余视觉F1/F2只改TableControls/DeliveryOverview，B现在可在独立工作树按唯一文件集合并行。Rationale：共享role/locator/DTO/route/width合同已冻结，消除最初串行的共享写入风险；B的FORM消费影响由最终Delivery回归和累计验收捕获。启动时本地父层候选与远端Draft父head不同，发布前必须重放到A最终接受head，按真实PR base重算，不提前称完整604完成。Date/Author：2026-11-10 SGT / 交付协调者。

## Idempotence and Recovery

读命令、测试、capture可重复；输出在ignored目录。提取原42按实际diff将test与JSX一起搬运，不丢原RED/806证据、不碰用户改动。失败回最后GREEN，未知结果不重发且不改Planning“解锁”；真实source/ack/reconcile语义沿原owner恢复。

B可独立revert回A+旧detail/settings；整体恢复按后层→B→A逆序，无Provider写入/数据库迁移。前层合入后B重放到实际main，锁定新head/base并重验，不能继承旧批准。真正有意延期实现债写 `docs/exec-plan/tech-debt-tracker.md`；不把本次安全/视觉范围延期或将已有#145/#606/#607/#599冒充新债。全部原604验收完成后将本计划移completed并更新索引。

## Interfaces and Dependencies

B只消费A的Host别名、安全 `planningStatusKey`、过scope `currentItemId`，不改其owner。query/width在ListPage，mode/opener/唯一detail在Project，表单transaction/ack在既有source；无新增业务API。Node/pnpm、Chromium、gh及已登记clean worktree/真实barrier是执行依赖；安装Host身份另由#599验证。

## Outcomes & Retrospective

本地B呈现、RED→GREEN、共享消费者回归及真实图像/量测已完成；该阶段的“完整604未完成” Superseded by Progress最终累计验证（2026-11-10）。A+B完整scope与关键交互、独立最终验收与首次当前remote门已完成，PR已Ready；Superseded by Batch 4 MMP 修复与待独立复评门（2026-11-11）；归档head的远端门仍按Batch3命令重新回读。B技术gross259，图像与bundle各自绑定真实版本，后续只有文档变化时保持生产身份映射；无新实现债、兼容/迁移层或第二owner。#599安装、人类UAT和R1不由此放行。

## Bottom Change Note

2026-11-10 SGT：保持原完整604 scope与775→806历史，就地Superseded单PR/旧恢复建议；B消费A并独占detail/settings/forms，保留42载体成本、完整累计验收、真实base/head包体与current remote门。A采用已创建issue #614；后续易失状态仍按当前远端回读。

2026-11-10 SGT：按 `packages/ui-model/src/local-table-view.ts` 实际 defaultLocalTableConditions 订正默认5列/可用8字段；先前“默认8字段”是计划事实错误，不构成改变产品默认行为的授权。

2026-11-10 SGT：共享接口与旧流程独立验收后，将实施次序细化为disjoint子系统并行；A仅修两处局部视觉，B独占详情/设置/FORM文件；保留最终重放、真实base计量及累计604验收。

2026-11-10 SGT：记录B实际局部RED/GREEN、唯一observer的510px上限、四任务真实角色配对及完整suite的具名失败；源交接不等于累计父scope、独立视觉、clean bundle或远端Ready验收。

2026-11-10 SGT：B独立复核两项P2按真实内容宽度与字体自然wrap原地修复，只动detail呈现与既有browser判别；本地修复证据不替代A最终base上的完整累计suite/图像/bundle/远端门。

2026-11-10 SGT：B已重放到已接受A生产与契约树cde887f7；五个B生产文件逐字等于已独立接受979c5b3。当前累计验证与exactbase capture在此clean树执行；前层后续纯文档归档若重放，必须比较生产/fixture指纹、标注真实捕获身份，当前CI仍锁最终head。补充静态公开证据文件集合。

2026-11-10 18:43 SGT：记录最终实际父层上的累计3961+74、144图/128场景与475文件等价重放，补充静态公开证据和clean本叶/累计bundle；保留真实捕获身份，不以文档归档后的新SHA改写历史执行。

2026-11-10 SGT：独立最终代码/累计能力与视觉identity门全部接受，正式静态证据和本叶/累计包体齐备；保留远端门、A先合入及#599/UAT/R1的独立责任。

2026-11-10 SGT：首次accepted发布0ee6c0e当前Fast Gate/metadata/双向closing/完整threads通过且已Ready，归档本计划并修正文档索引；源不变，最终归档head仍须新远端核验，不继承旧checks。

2026-11-11 SGT：追加 Batch 4 全部 MMP 意见的真实 RED/GREEN、同输入长值场景与安全 key 决策；原审查正文保留，历史累计验收就地标注 Superseded。源修复交接后仍须协调者独立复评、重放／当前远端门与包体，不触碰 Status/native 边、#599、merge 或 R1。

2026-11-11 SGT：将复评补充 P3 并入 Batch 4，Unknown 头统一中性“未知”，分别验证缺失 native／有未映射 native 两种输入；原文在 metadata 原样保留，局部最终证据更新为 36 项。
