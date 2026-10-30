# PR #480 MMP 交付评审

## Purpose / Big Picture

判断窄嵌入区及 200% 文字下，用户能否读到详情标题、触达关闭动作，并保持原有滚动与键盘闭环。

## Context and Orientation

2026-10-30 锁定 PR #480：base `main@b19b4eac4f12aa40c05d75b492f3335299874641`，head `b9ed830288119d833b91c4f2a2c8ef6ff0575708`；仅一个能力提交，关联 `Closes #479`。远端回读为 OPEN、非 draft、CLEAN/MERGEABLE，所有当前检查 SUCCESS，reviews 与 reviewThreads 均空。检出为 `.worktrees/ui-detail-text-reflow` 的 `fix/ui-detail-text-reflow`，开始时干净。

## Design / Spec

按 Superpowers 独立审查模板、Qian Systems Router 的系统边界/分析综合、First Principles Development 的 audit 模式检查。事实是四处 CSS 声明和测试夹具变更；硬约束是原生 dialog、Host 事实拥有和 CSS 表现层边界；待验证假设是自然换行足以保护完整用户任务。

先立矩阵，后逐文件审查：

| 严重度 | 层/初始风险 | 最小判别证据 | 当前结果 |
|---|---|---|---|
| P0 | 代码/架构：全局布局破坏 main；增加状态权威或跨层调用 | diff、选择器作用域、依赖与状态追踪 | 未见破坏；私有双 class、仅表现层，无状态/依赖变更 |
| P1 | 产品：320/375px、200% 文字标题/关闭/关键动作不可达 | 实际 App 浏览器几何、正文滚底、键盘闭环 | 目标矩阵通过；短高度正文退化见 F1（P2） |
| P2 | 代码/测试：共享样式顺序、窄宽阈值或测试判别遗漏 | 样式正控、分离根因负控、断言代码 | 六种顺序正控通过；P/T 独立负控均 KILLED |
| P3 | 文档/维护：冗余样式或证据超过实际验证 | 逐文件、计划/产品文档/issue 对照 | 文档、规模、issue 关联相符，无新增 P3 |

## Global Constraints

只写本评审文件；临时探针限本检出的 `.superpowers/`。不改生产代码，不 commit/push/发布 review/resolve/合并。不把本地 fixture 几何等同 installed Host、人类 UAT 或 R1。

## Plan of Work

1. 锁定远端、建立矩阵；2. 逐文件和 issue 验收核对；3. 最窄测试与反例；4. 完成矩阵并一次性报告。

## Validation and Acceptance

在上述 head 的工作树根目录执行定向测试、类型检查和需要的浏览器探针；记录真实输出与缺口。远端命令显式指定 `--repo SingularityKChen/harness-projects`。

## Progress

- [x] 2026-10-30 锁定元数据、issue、空线程，先建立风险矩阵。
- [x] 2026-10-30 完成六个变更文件、相关 Drawer/Project/App/共享样式、测试、issue 验收及必要反例。

## Surprises & Discoveries

F1：新换行标题栏仍为 `flex:none`，高度仅由 `30dvh` 标题上限、间距和按钮叠加决定，未为正文保留实际可见高度。实际 Chromium、640×320、root30px、长标题时：dialog高290，header高249，body高60（上下padding合计60），body top280/bottom340超过dialog bottom320；探针报告 `body escapes dialog`。正文内容没有完整行或44px动作的可见空间。640×240时body top256已完全在viewport外，普通滚动正文也无法显露正文区域。

同一实际App中，把所有内联 `DETAIL_STYLES` 逐字替换成锁定base的原样CSS作因果对照（其余DOM/主题/夹具不变）：640×320时header157、body71、body top218/bottom289，body未越界；base仍保留本次要修的padding/title行宽失败。640×240的base也存在部分正文越界，故不把低高度能力整体归咎于本PR；本PR明确加重并在320高场景引入正文越界。

这是未纳入当前纵向矩阵的设计边界；#430已关闭，按 `detail`、`scroll`、`height overflow reflow`、`landscape` 搜索未发现专门承接该缺陷的开放issue。#449保留最终安装Host/zoom验收，不能代替修复追踪。

## Decision Log

- 2026-10-30：先验证实际组合与交互，避免由静态 CSS 或绿测试推断完整交付。
- 2026-10-30：F1定P2：320×640/375×720的直接验收闭环完整；触发限定于200%文字、长标题与较矮可见区域。仍为可复现的新增正文退化，建议本轮小范围修正或明确issue承接。父UI/R1/安装Host验收仍由人类门禁拥有。

## Idempotence and Recovery

审查默认只读；探针可重复。若执行变异，只用 `scripts/review-mutate.mjs` 并指定 `killedBy`，完成后验证字节恢复。

## Interfaces and Dependencies

`packages/ui/src/detail-presentation.ts`、实际 WorkItemApp、共享样式、浏览器 fixture、`pnpm test:file`。

## Outcomes & Retrospective

结论：无P0/P1；一个可行动P2，按仓库映射建议 `APPROVE` 并保留F1修复建议；最终严重度与统一发布由主审独立复核。Superseded by「F1 独立复评」：未提交修复树已消除F1（2026-10-30）。

### F1 · [P2] 为换行标题栏保留正文的可见高度

Superseded by「F1 独立复评」（2026-10-30）；以下为首轮锁定head的历史缺陷，不代表修复树仍存在。

新增行锚点：`packages/ui/src/detail-presentation.ts:16–17`。在实际App夹具使用 `?scenario=long&font=200&detail=1`，把viewport设为640×320（或320×320），标题栏的不可收缩换行高度挤尽正文；详情外层又是 `overflow:hidden`，正文不再有可用内容视口。修复方向：依据实际dialog高度约束header/title的总高度并为正文保留有意义的可滚动空间，或在低高度时提供一条可操作的整体滚动路径；保持标题、关闭与正文动作都可达，增加短高度反例。不要只用 `body.clientHeight>0` 作为可用判据，当前60px恰好全部是padding。

### 已执行证据

以下命令在锁定head的工作树根执行：

| 命令/检查 | 实际结果 |
|---|---|
| `pnpm test:file tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-browser.test.js tests/contract/ui-work-item-app.test.js tests/contract/ui-work-item-list-browser.test.js tests/contract/ui-detail-reflow.test.js` | 23 tests，23 pass，0 fail/skip |
| `pnpm typecheck` | exit0 |
| `git diff --check b19b4eac4f12aa40c05d75b492f3335299874641...HEAD` | exit0，无输出 |
| `gh pr checks 480 --repo SingularityKChen/harness-projects` | 当前head所有15个显示项pass，含PR Fast Gate |
| `node tests/fixtures/workspace-frame-browser.mjs 0` + 独立Playwright session | 实际App浏览器；服务/本次浏览器结束后已停止 |
| `node scripts/review-mutate.mjs .superpowers/pr480-review/mutants.json` | P-padding-only和T-header-only均KILLED；`killedBy` 均为 `reflow geometry rejects restored roots`；exit0，原文字节恢复 |

独立浏览器8项几何：320×640/root15、320×640/root30、375×720/root30深色、1440×900内实际root260/320且root30、实际root1200/1199且root15、1024×768/root15均 `failures=[]`。实际root1200为wide，1199为overlay。320×640/root30实测title198、close167×77、body263、dialog padding全0。六个样式正控production/append/workspace-before/workspace-after/duplicate/noop全部通过。

实际键盘验证：初焦点H2；Tab依次close→refresh→close，Shift+Tab回refresh；Escape关闭并回列表H2；列表anchor的Enter打开后，Enter/Space操作关闭均回该anchor。长标题和正文分别滚到scrollTop1833/21177，等于各自最大值，几何仍通过。这里只做程序化独立滚底；不将其冒称实际Host触屏/滚轮验收。

### 覆盖边界与未判定项

- 仓库新测试是实际入口装配/SSR语义合同；几何回归由本地实际浏览器探针证明，托管CI不会自动跑该几何矩阵。该边界已在计划披露，不另提重复finding。
- 本轮未重复安装Host、真实桌面缩放、人类UAT、全部状态/权限端到端，这些由#449等现有工作项承担；未默默视为接受。
- 未重复作者的全部浏览器矩阵、组合PR及每个边界命令；本PR没有业务、依赖、CI、Provider或持久化变更，当前托管检查已核对。
- 逐文件未发现多余新框架、布局state、第二主题owner或过度设计；四处CSS修正保持最小范围。

## Bottom Change Note

- 2026-10-30：按锁定 head 建立审查范围与初始风险矩阵。

- 2026-10-30：完成全部矩阵，记录短高度P2、真实浏览器base CSS对照、定向与双根因负控证据。

### F1 修复回传（2026-10-30 +08，等待独立复评）

本批未提交差异保持原HEAD `b9ed830288119d833b91c4f2a2c8ef6ff0575708`。实现者复核原反例后，先加强探针：扣除body上下padding，至少能容纳实际文字行/44px动作；超出初始视口的元素只有在可滚动范围内、尺寸能完整放进dialog时才算可达。实际640×320/root30的原CSS被命名用例判RED（body escapes / lacks a complete content row）。产品仅改dialog `overflow:auto`与正文最小高度`3em + 上下padding`，保留标题和正文各自滚动；高度不足时提供整体滚动路径，短高度关闭可经滚动/聚焦到达。

修复树：24项定向全绿、0失败/跳过，typecheck exit0；26项真实Chromium几何涵盖三个短高度×normal/200%×短/长标题、旧宽度矩阵及六顺序正控，全部`failures=[]`。三短高度/root30的body内容为90px，close/refresh为167×77px；实际键盘End将标题滚到1322/1929/1346最大值，Tab到close/refresh完整可见；正文End滚到14330/21290/14330最大值，ShiftTab返回close，Escape回列表标题，列表Enter→Space关闭回anchor。原P/T和新增取消外层滚动/正文空间四项由正式review-mutate执行，均由`short dialog retains reachable body content and actions`命名断言杀死并恢复。首次End读取未等滚动动画导致探针失败，改为等待最终scrollTop后通过，未以即时值冒称滚底。

本批证据仅为本地fixture/未提交修复树，等待原审查者独立复评；不代替新head托管CI、installed Host或人类验收。ExecPlan已回active并记录主会话转交的授权范围和执行边界；无commit/push/远端回复/resolve/merge。


### F1 独立复评（2026-10-30 +08）

复评对象为 `fix/ui-detail-text-reflow` 工作树、HEAD仍 `b9ed830288119d833b91c4f2a2c8ef6ff0575708`，叠加本批未提交差异；base仍 `b19b4eac4f12aa40c05d75b492f3335299874641`。已重新读全部diff、active ExecPlan、产品说明、contract/fixture与实现者回传；结论基于重新启动的实际App和独立浏览器session，不将实现者日志代替复测。原首轮F1结论由本节覆盖。

**结论：F1已修复，无新增P0/P1/P2/P3；支持主会话归档、更新base后按当前head重新完成交付门禁。** 生产只有两条CSS差异：外层允许滚动，正文保留3em内容加上下padding。该退路在空间不足时提供明确滚动路径，常规高度保持正文独立滚动；没有新JS状态、布局算法、断点或第二套组件。新增纯判据从实际geometry扣除padding，避免原60px假绿；设计与修复范围适当，无过度设计证据。

独立执行定向命令（与首轮同五个文件）结果 **24 tests / 24 pass / 0 fail / 0 skip**；`pnpm typecheck` exit0；`git diff --check` exit0。下列为独立Chromium真实几何及键盘结果：

| viewport / 字体 / 主题 | dialog / body / 有效内容高 | 外层最大滚动 | 实际结果 |
|---|---|---|---|
| 640×320 / 200% / light | 290 / 150 / 90px | 111px | 无failure，标题End1322=max；close/refresh各167×77且聚焦完整可见；正文End14330=max |
| 320×320 / 200% / dark | 290 / 150 / 90px | 111px | 无failure，标题End1929=max；两动作完整可见；正文End21290=max |
| 640×240 / 200% / dark | 210 / 150 / 90px | 167px | 无failure，标题End1346=max；两动作完整可见；正文End14330=max |
| 320×640 / 200% / light | 610 / 263 / 203px | 0px | 无failure，标题/正文分别滚到1833/21177最大值 |
| 375×720 / 200% / dark | 690 / 319 / 259px | 0px | 无failure，标题/正文分别滚到1404/20641最大值 |
| 1440×900 / normal / light | 885 / 582 / 552px | 0px | 无failure，标题/正文分别滚到186/2344最大值 |

六场景实际按键均验证初焦点H2→End标题滚底→Tab关闭→Tab刷新→End正文滚底→ShiftTab关闭；动作rect完整落在dialog与viewport内。Escape后回列表H2，列表anchor Enter打开后Tab→Space关闭回anchor。低高度外层可滚到正文，正文仍能独立滚底；普通场景外层scrollMax=0。1024×768→320×320的同次dialog/title节点身份保持、探针无failure；短高度生产/append/workspace-before/workspace-after/duplicate/noop六样式正控均无failure且有效内容90px。

独立执行 `node scripts/review-mutate.mjs .superpowers/pr480-rereview/mutants.json`：原padding、原header、撤销outer-scroll、撤销body-room四项均KILLED，失败用例均为 `independent short dialog re-review`，exit0且字节恢复。变异只作用本次运行态控制输入、真实浏览器分别撤一项CSS；生产源码未修改。运行态探针在 `.superpowers/pr480-rereview/`；浏览器与本次fixture server由复评者关闭。

本节只确认本地未提交修复树；未把旧托管CI用于新树，未重装Host、未执行真实桌面zoom/UAT。后续归档与base更新若改变内容，需要主会话重新核对新head/base、定向与远端门禁；发布和人类验收边界保持。

- 2026-10-30：原审查者独立复评F1，首轮缺陷结论就地标记superseded；未改生产、未提交、未推送或远端写入。

### 本批交付收口与外部写入

本PR最终base更新到前三条实际rebase合并后的main；此前三个结果已回读：#477→`4cb28303a448205c0599ac0cdf6a0efd694cdd2c`（#475 CLOSED）、#476→`85fdc602437c48525bcddbc64e67899808901cd6`（#448 CLOSED）、#478→`8fe2d4eea4f2b0d5bcfc0c6a17f9d9bb87658e23`（#434 CLOSED）。本PR自己的最终merge SHA/issue结果只由 `gh pr view 480 -R SingularityKChen/harness-projects --json state,headRefOid,mergeCommit` 与 `gh issue view 479 -R SingularityKChen/harness-projects --json state,closedByPullRequestsReferences` 回读确认，不预写未来成功。

外部写入目标均为 `SingularityKChen/harness-projects` 的明确PR/issue；本CLI没有另一个运行态ProviderBinding。评审actor为 `Singularity-AI-Bot`，键 `mmp-review-20261030:pr<N>:initial/final`；首轮review ID依次5709022543、5709023163、5709048691、5709049195，全部APPROVED且锚定锁定head。作者/提交/验收正文/线程回复与merge actor为 `SingularityKChen`，键 `mmp-review-20261030:pr<N>:acceptance/resolve/rebase`；已完成前三个merge API均返回merged=true并双向回读issue，#478原P2线程已resolve。#480需同样在最终push后对当前head检查并结算线程；不使用旧批准替代新head。上述键对应运行态结果清单，公开正文只保留必要判断与可重算命令。

所有四条各自一个可独立审阅/回滚的Conventional Commit；worktree和恢复ref保留。逐条机械disclosure/size、人工五类公开面、产品/测试全部路径存在/缺失与blob比较、README冲突仅索引行均已执行；任何产品blob不同都回到复评门。合并只推进工程事实，不写Planning Status/native dependency，不替代#449、#427或R1接受。

最终四项组合（检出 `fix/ui-detail-text-reflow`、base `8fe2d4eea4f2b0d5bcfc0c6a17f9d9bb87658e23`，修复产品树）：`node scripts/resolution-check.mjs`、`node node_modules/typescript/bin/tsc --noEmit`、`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e`、`node --test --test-timeout=120000 tests/mvp0` 全部exit0，主测试2613、MVP7，0失败/跳过；与独立浏览器和原审查者负控分开记账。此后只补文档链接和证据，全部产品/测试blob保持已验证树。
