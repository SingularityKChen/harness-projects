# 详情文字放大重排 ExecPlan

> 状态：Completed（P2 短高度修复已独立复评）；创建：2026-10-30；关联：Closes #479，Refs #430、#427
> 规范：根 `AGENTS.md`、`PLANS.md`

## Purpose / Big Picture

用户在320/375px窗口、200%文字或窄嵌入工作区中，能读到工作项标题并操作“关闭详情”，正文仍能独立滚动。最小成功证据是实际 WorkItemApp 组合浏览器中dialog四边padding为0、标题有可读行宽、关闭动作可见、无横向溢出；两个根因独立回退时各自失败。

## Context and Orientation

调查检出为2026-10-30 +08、`main @ b19b4eac4f12aa40c05d75b492f3335299874641`。Drawer和ProjectPage先插入workspace+detail样式，WorkItemApp最后又插入workspace样式。dialog同时带hp-workspace和hp-detail；两个单class padding规则优先级相同，最后的workspace规则获胜。父任务实际IAB测得320px/root30px下dialog260px、padding30px、title宽0；本审稿独立核对源码因果链，不将父任务量测声称为独立重测。

header当前nowrap，title的flex:1基准为0，close为flex:none，title已有min-width:0。因此padding叠加、固定按钮与gap能把标题压到0。observeDetailLayout只负责可见工作区矩形、340px上限和1200阈值，现无证据表明算法有错。旧detail browser fixture直接挂ProjectPage，缺少App最后样式；已有workspace-frame fixture真实挂WorkItemApp/store/ui-model且支持font=200、long和两主题，应复用后者。

## Design / Spec

2026-10-30 +08 / F1修订：原自然换行只约束横向容量，不能保证短高度正文可用。比较三个方案：按按钮字体估算标题max-height容易在Host字体/换行时失准；整体改成两行grid会扩大常规布局；选择最小退路——保留现有header/title，正文保留独立滚动且有容纳完整行/动作的最小高度，dialog在内容合计超出实际高度时允许整体滚动。低高度用户可先滚到正文再独立读到底，关闭始终可通过向上滚动或键盘回到；正常高度不增加整体滚动。以真实App三种短高度和既有宽度矩阵判别，不能只靠clientHeight>0。

选择明确drawer私有几何边界，加内容驱动的header换行。将dialog几何规则限定至`.hp-workspace.hp-detail`或同等明确的私有双class选择器，使padding:0不受shared workspace插入顺序影响；不移动样式出口、不加!important、不改共享token。header用flex-wrap，title用有意义的非零preferred basis（首选12rem，最终由真实几何确定），保留min-width:0、现有换行/30dvh垂直滚动；close保持固有文字与44px最小尺度，必要时换行并靠末端。

DOM仍为标题→close，保持aria-labelledby、title焦点和原生dialog，不用CSS order、缩小用户文字或无标签图标回避宽度问题。状态/路由/Host主题owner/布局观察器均不变。拒绝固定像素min-width和viewport媒体查询：嵌入宽度不等于window宽，强制最小宽会溢出。固定两行grid虽更简单，但普通340px也占更多首屏高度；仅当自然换行实测不稳定时改为这一单一退路，记录取舍后复测，不能并存两套逻辑或加JS状态。

## Global Constraints

唯一文件集合及owner：D owner只修改 `packages/ui/src/detail-presentation.ts` 的私有CSS；新增最窄 `tests/contract/ui-detail-reflow.test.js` 保护真实App装配与原生语义，允许仅扩展 `tests/fixtures/workspace-frame-browser.mjs` 的浏览器几何探针/嵌入宽度输入，不改其store/source业务；必要时补 `tests/contract/ui-work-item-detail.test.js` 的既有原生行为反例。正式文档为本计划、`docs/review/pr-480-mmp-review.md` 与最终交付记录、由parent维护的 `docs/product/ui-detail.md`（说明drawer几何/spacing owner、200%文字自然换行、真实App组合测试边界）及协调者串行收敛的 `docs/README.md` 索引行。

预计代码/测试/fixture增删100–240，严格<800；文档80–160，严格<1300。不修改App/ProjectPage/Drawer业务、共享workspace样式、observeDetailLayout算法、340/1200阈值、执行三section、list、setup/Host/controller、Provider或#472 production carrier/CI lane。不新增dependency/framework、布局/主题state或兼容路径；本轮#476/#477/#478产品文件集disjoint。

## Plan of Work

### Batch 3 · F1 短高度正文恢复

先加强既有fixture的真实几何判据并补可执行浏览器反例，确认640×320/320×320/640×240、200%文字和长标题的旧CSS为RED。最小CSS修复后同输入必须GREEN；正文可容纳完整文字行和44px以上动作，并可经合法滚动路径滚到底。复测普通/长标题、normal/200%文字、两主题、原宽度与六种样式顺序；Tab/ShiftTab、Enter/Space、Escape/opener保持。使用`node scripts/review-mutate.mjs .superpowers/pr480-fix/mutants.json`，指定`killedBy`检验撤销外层滚动和撤销正文最小高度分别RED，恢复后GREEN。命令从检出`fix/ui-detail-text-reflow`的工作树根运行；定向测试沿用Batch1，期待23项及新增用例通过；`node node_modules/typescript/bin/tsc --noEmit`期待exit0。

完成后交原审查者独立复评，归档由主会话在复评通过后进行。本实现者不commit/push/回复/resolve/merge。回滚只撤销本批CSS、测试、fixture和文档变化。

### Batch 1 · 真实装配红基线与私有CSS修复

先提交本计划，协调者在产品代码前创建Closes #479的docs-only draft并回读base/head/draft/关联。主文件为私有呈现和现有App fixture。先以未改CSS保存实际App的geometry JSON与截图，再实现两项CSS修复。浏览器探针只测DOM/computed style/rect，不推导业务事实；可在既有fixture导出 `measureDetailReflow()` 并从页面调用，包含dialog/header/title/close/body的rect、computed padding/font、client/scroll尺寸。Node用例可证明真实WorkItemApp和native dialog装配，不能把SSR/string断言当布局证据。

在检出 `fix/ui-detail-text-reflow` 的工作树根运行：

    pnpm test:file tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-browser.test.js tests/contract/ui-work-item-app.test.js tests/contract/ui-work-item-list-browser.test.js tests/contract/ui-detail-reflow.test.js
    pnpm typecheck
    node tests/fixtures/workspace-frame-browser.mjs 0

前两条期望全pass；最后一条保持server运行并输出实际本地URL。打开`/?scenario=long&font=200&theme=light`，点击实际列表入口进入native dialog；用既有IAB/browser runtime运行探针。旧CSS必须在父任务复现尺寸失败；修复后满足下节几何。证据存本工作树运行态目录，正文记录source head与浏览器/字体/viewport/实际root宽度，不提交本机绝对路径。

### Batch 2 · 两根因负控、顺序对抗与交付

独立负控P：保留header修复，只把drawer padding选择器恢复为旧单class语义，再最后插入原样WORKSPACE_STYLES，computed padding=0断言必须失败。独立负控T：保留padding修复，仅回退header nowrap/title flex:1，在真实260px可用dialog/root30px使可读行宽或交叠断言失败。不得同时撤两项，不人工扩大close按钮伪造失败；若原尺寸不能复现，记录实际有效宽后在受控嵌入root缩窄至原失败状态。每项恢复后重测通过。

正控至少包含：生产原顺序、额外后插原样workspace样式、将已有workspace样式移到detail前/后、无害复制shared style、添加不影响语义的class/CSS注释。几何必须仍通过；不得锁style数目、CSS字符串、声明顺序、精确12rem或exact class列表。负控变异可以定位修复规则，但通过判据必须是computed结果和真实交互。

完成验收后在同分支根运行 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`，期望零失败，人工五类公开面检查。整理提交并final push后回读当前PR head/base/checks/issue/threads，全部当前证据通过才ready；不合并、不改规划Status。回滚点是完整CSS/测试PR，无数据迁移或外部写入。

## Validation and Acceptance

| 场景 | 可核验结果 |
|---|---|
| 320×640/375×720，root15/30px，light/dark，普通/长无空格标题 | dialog四边computed padding=0；title宽≥min(160px,header内容可用宽度)−1px；close可见rect≥44×44且在dialog/viewport内；两rect无面积交叠 |
| 1440窗口内260/320px实际root，root30px | 以root宽自然重排，dialog在root/viewport交集；body内容高度扣除padding后至少可容纳完整行/44px动作，且可经整体或独立滚动进入视口，不依赖window宽 |
| 1440/1200/1199/1024实际工作区，root15px | 保持340px上限、1200预留/1199覆盖；document与detail-body scrollWidth≤clientWidth+1；header/body不横溢 |
| 极长标题超过30dvh、长正文 | 标题完整DOM/accessible name保留，能滚到末尾，close可经整体滚动或键盘聚焦进入视口，正文独立滚动；标题/close/body横向不逃出dialog |
| 键盘、resize、字体切换 | 初焦点可见title；Tab/ShiftTab循环；Enter/Space操作close；Escape只关一次；opener在则回焦、移除则列表标题；dialog节点身份不变、不重新showModal/派command |
| 两独立负控与顺序正控 | P只因padding失败、T只因标题可读性/交叠失败；恢复/插入顺序/无害CSS变化均通过 |

不能只用title.width>0判通过，1px仍不可读；header内容宽取clientWidth扣左右padding。CSS-only不机械跑全量verify；若实现引入边界/API变化先重开设计。受控浏览器证据不代表installed Host #449、UAT或R1。

## Progress

- [x] (2026-10-30 +08) Batch 3实现：短高度RED→GREEN、4项归因负控、三低高度完整键盘滚动与26项矩阵通过；24项定向与typecheck通过。
- [x] (2026-10-30 +08) Batch 3由原审查者独立复评通过并归档；当前head的提交/托管CI/批准/issue与rebase合并由主会话按回读门执行。

- [x] (2026-10-30 +08) 两份独立设计及第三位审稿核对源码，确定双根因/owner/几何判据。
- [x] (2026-10-30 +08) Batch 1：实际App在root30px/260px容器复现padding30px、title0px；私有CSS修复后padding0、title198px，23项定向契约及typecheck通过。
- [x] (2026-10-30 +08) Batch 2本地几何：两个独立负控分别命中padding/可读行宽；追加、前后重排、复制shared与无害class/comment五项正控均通过。
- [x] (2026-10-30 +08) 独立浏览器、代码验收、正式文档和交付回读均已完成；远端最终状态按本计划命令重新核对，未宣称安装Host/UAT/R1通过。

## Surprises & Discoveries

通用`exec-plan`技能linter要求`Concrete Steps`/`Artifacts and Notes`，与本仓库PLANS.md固定章节不同，因此该通用lint报缺章节；按仓库规范人工核对13个强制章节及底部变更说明，不为工具假阳性改规范结构。

2026-10-30 +08 / F1修复：旧CSS在640×320/root30时dialog290、header249、body60，扣除上下padding后内容为0；加强探针后`short dialog retains reachable body content and actions`为RED（body escapes / lacks a complete content row）。两条CSS修复后body150、内容90；640×240/root30仍通过合法外层滚动把正文77px刷新动作带入视口。初次键盘End探针立即读scrollTop=0是浏览器滚动动画尚未完成，改为等待scrollTop等于最大值再断言，未修改产品行为。

孤立ProjectPage fixture漏掉最后App样式；伪DOM布局测试只验证变量和cleanup，不验证CSS。已有min-width:0容许title消失，重复添加它无效。修复必须分别保护cascade归属与header内容容量。

2026-10-30 +08 / 实施浏览器发现：CUA只读evaluate不暴露页面自定义window函数，故fixture将真实DOM几何写入隐藏`output#detail-reflow-report`；验收只读其JSON，不借evaluate改DOM。`rootWidth`指定嵌入`#app`宽度，真实`.hp-project`还受实际App padding影响，必须读probe的`root.width`，不能把query值当实测。

## Decision Log

2026-10-30 +08 / 主会话记录人类直接原话（仅本会话，不以转交代替授权）：用户指定「按照流程评审 PR#476-#478、#480」，并在无P0/P1或只有P2/P3时要求「你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → `merge_method=rebase` 合并」。条件授权覆盖四条PR，取代此前未获授权时禁止自行合并；不覆盖Planning Status、native依赖或R1。

2026-10-30 +08 / F1实现者：采用外层overflow:auto+正文最小内容高度3em的单一CSS退路，常规高度外层无滚动，短高度保留正文独立视口。理由是不用估计Host关闭按钮高度，也不新增布局state、容器query或第二套低高度布局；实际200%动作77px，内容90px可完整容纳。代价是短高度关闭不始终固定在屏内，但整体滚动与Tab/ShiftTab能完整带入；产品说明已同步，不再称短高度头部稳定固定。

2026-10-30 +08 / 主会话转交的人类授权范围：PR #476/#477/#478/#480 无P0/P1时由评审会话负责“修复→独立复评→归档→整理commit→核对issue→rebase merge”；该授权优先于旧文档禁止自行合并。本子任务仅实现#480 F1并回传，明确不执行commit/push/remote回复/resolve/merge；实际合并仍由主会话持有人类原话证据执行，不把转交信息当本子任务自行合并许可。

2026-10-30 +08 / 第三位独立spec/plan审稿：两设计均支持私有双class+自然换行；选择最小CSS闭环、真实App几何验收和两个独立回退，不扩大为布局state或新carrier。文件集/预算唯一声明见Global Constraints；无规划字段/关系写入授权。

2026-10-30 +08 / 实施：保留12rem preferred basis，实际260px容器下title为198px且close167×77px，满足可读行宽；增加close自动起始margin使独立换行后靠末端。生产仅四处私有CSS声明变化；实验仅在fixture复制并禁用React原style节点，不移动React拥有的节点，避免关闭时破坏React清理。

## Idempotence and Recovery

探针/重复style/resize可重复且无外部副作用。负控仅作用本次fixture浏览器或临时本分支CSS，每次移除临时style/恢复源后复测，不能把负控提交产品。server结束时停止本次进程；失败保留证据后修当前分支，不删除他人工作树或用户数据。

## Interfaces and Dependencies

分支 `fix/ui-detail-text-reflow`、工作树 `.worktrees/ui-detail-text-reflow` 独立基于main。沿用React/native dialog/Host token/现有browser runtime。PR回读：`gh pr list -R SingularityKChen/harness-projects --head fix/ui-detail-text-reflow --json number,headRefOid,baseRefName,isDraft,statusCheckRollup,closingIssuesReferences`，对唯一结果再回读review threads。

## Outcomes & Retrospective

2026-10-30 +08 / 原审查者独立复评：原三个短高度反例消失，body150px/有效内容90px，167×77px关闭与刷新动作可经Tab/合法滚动完整进入视口；标题/正文End滚到底、Escape/列表opener恢复通过。常规320/375/1440尺寸外层最大滚动0，六样式正控、同dialog resize通过；独立24定向、typecheck、四命名负控KILLED。完整记录见本PR评审文档；恢复后产品树已固定，后续rebase需全产品blob核对。

2026-10-30 +08 / F1本地实现（HEAD仍`b9ed830288119d833b91c4f2a2c8ef6ff0575708`，工作树含本批未提交差异）：`node --test --test-timeout=120000 tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-browser.test.js tests/contract/ui-work-item-app.test.js tests/contract/ui-work-item-list-browser.test.js tests/contract/ui-detail-reflow.test.js`为24/24、0失败/跳过；`node node_modules/typescript/bin/tsc --noEmit`为exit0。26项实际Chromium几何组合涵盖640×320/320×320/640×240、normal/200%文字、短/长标题及原宽度/六顺序正控，均failures=[]；三低高度键盘End标题/正文滚到底、close/refresh聚焦完整可见、ShiftTab、Escape回列表标题及列表Enter→Space关闭回anchor通过。正式4项负控全部命名KILLED并字节恢复。未运行安装Host/UAT/R1；等待独立复评，不把旧远端CI用于未提交修复树。

2026-10-30 +08实现观察为`82a3fdb`，独立测试语义修复为`f6c93e1`；产品仅四处私有CSS声明，定向23/23、类型检查、公开面和diff检查通过。独立审查无遗留P0–P3（Superseded by Batch 3 F1短高度修复，2026-10-30）；唯一P3相邻属性断言改成分别核验title真实id/tabindex，无害data属性正常存活，丢真实id/tabindex分别被命名用例拒绝且字节恢复。最终head/base/checks以PR #480回读为准。

协调者先观测320px/30px文字下实际dialog245px、padding30px、title0px的红基线；修复后同场景padding0/title183/close167×77/body263。375px深色/30px文字title238；1440px窗口内实际root260时title198。两项独立负控分别仅失败padding（30px）或可读行宽（title16px），恢复后通过。生产、追加shared、前/后重排、重复、无害CSS六顺序正控均通过。

实际root1200/1199分别保留wide+356px预留、overlay+0px；1440/1200/1199/1024窗口、两主题和200%文字无横溢。长标题可滚到底且正文独立滚动，关闭动作保持可见。同一dialog在1024→320 resize保留title id、焦点、两个非零scrollTop，failures为空；直接路由关闭回列表标题，键盘列表Enter打开后关闭回anchor。独立审查另复测Enter/Space/Escape/Tab/ShiftTab与native modal。字体由query重新挂载，未声称livefont同节点切换；200%文字也不是浏览器zoom或installed Host验收。

无新增接受延期的技术债。本地证据不替代#449人类UAT或R1；完成本闭环不关闭父UI epic。最终提交整理仅收敛历史和文档，全部远端门禁按当前对象回读。

## Bottom Change Note

2026-10-30 +08：综合两份独立设计与源证据，收敛私有CSS方案、实际App几何、两根因独立负控及无害样式变化正控。

2026-10-30 +08：记录实际App几何RED/GREEN、两个独立负控与五项样式顺序正控、23项定向及typecheck证据，并明确实施与协调者交付边界。

2026-10-30 +08：协调者归档独立语义修复、实际几何/滚动/键盘及双根因对抗证据，更新详情说明与索引。

2026-10-30 +08：校正已完成事项遗漏的Progress勾选；源码、测试与fixture均未变化。

2026-10-30 +08：首轮MMP评审F1证实短高度正文退化，计划移回active，补Batch3、最小滚动退路与独立复评门；不把旧矩阵绿称为短高度已通过。

2026-10-30 +08：记录F1 RED→GREEN、最小两条CSS、正文有效内容判据、26项几何与4项命名负控和实际键盘滚底；保持active等待独立复评。

2026-10-30 +08：原审查者独立复评通过，无遗留P0–P3；计划归档，按直接人类条件授权更新实际main并重锁最终托管门禁后收尾。

2026-10-30 +08：前三条合入后的真实main上，四项最终组合resolution/typecheck/2613主测试+7MVP全部通过；归档链接复查发现产品说明残留active路径并已改completed。最终提交只补文档与当前审查证据，产品/测试blob等于独立复评树。
