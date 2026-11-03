# PR #529 MMP 交付评审

> 状态：P2 修复独立复评通过，无未关闭发现；观察日期：2026-11-04（Asia/Singapore）。

## Purpose / Big Picture

判断“唯一工作区身份、工具栏和 Host/来源状态披露”能否独立验收、合并和回滚。当前结论：无未关闭 P0/P1/P2/P3；首轮一条 P2 窄 Host 容器重排缺陷已修复并独立复评。工程验收不替代 #446 的人类视觉确认、#449 的安装产物 UAT 或 Gate R1。

## Context and Orientation

评审检出 `fix/workspace-header`，执行目录为 `.worktrees/workspace-header` 根目录。首轮及末次只读回读均锁定 head `382233955e9a6df86e582989b0d23743640989e6`、base `main @ f5ae377d98c43ed216f680cb72e5f35d73a2b8e1`，远端为 OPEN、Ready、MERGEABLE/CLEAN。当前分支只有一项交付物提交；Closes #528，Refs #446/#427/#449。review、inline comments、review threads 均为零，threads 分页 `hasNextPage=false`。

原实现会话“筛选迭代紧急重要 Issue”负责本分支，评审未改产品或测试的最终字节。独立评审使用 Superpowers 的验证/系统调试方法、qian-systems-router 的分析综合方法、first-principles-development 的 review/integration 阶段；先建风险矩阵，再逐层检查。额外探针仅存在于本检出的 `.superpowers/pr529-review/`，合成输入不含安装 Host 私有数据。

## Design / Spec

结果目标是身份、标题和动作清楚且唯一，异常事实不被正常样式掩盖。事实：生产入口是 `apps/harness-plugin/src/client.ts` 的 `bindWorkspaceStatusApp`；StatusPanel → SetupGate → WorkItemApp → ProjectPage → ListPage 为组合链。硬约束：Host 权威、来源确认与 transport 正交、明确读取许可先于元数据披露、Provider ack/reconcile 和秘密边界保持。偏好：普通宽度约 40–48px，窄容器自然重排。主不确定性是窗口宽度能否代表 Host 实际可用宽度；独立反例推翻了这一假设。

保持原生 details/summary、复用 accessIndex、私有 ObservedTime 与现有工具栏 owner 的方案适度。没有增加状态机、业务 store、Provider 调用、依赖、导航框架或兼容层；公开 API 仅增加可选的呈现 actions 输入。P2 修复宜比较两个局部方案：容器查询直接复用现有窄屏两列规则，可保持“观察在前、身份整行”的已选语义；intrinsic flex/grid wrap 可少一个断点，但必须额外验证身份排序及未知/断连文案。无需引入 JS 尺寸订阅或新布局 owner。

## Global Constraints

唯一正式评审写入文件为本文件；未执行 GitHub 写入、commit、push、rebase、merge，未改 Planning Status/依赖关系。变异只按 `scripts/review-mutate.mjs` 瞬时施加，首轮结束时产品/测试 diff 为空；本轮只读复评保留另一 owner 的两文件修复。首次无效变异轮次不计入结果；完整重跑后才记录有效整表。评审发现集中交协调者一次发布；P2 修复由协调者指定 owner，独立复评不得由修复者自证。

## Plan of Work

1. 已锁定 refs、commits、checks、review threads、#528 与 #446/#427/#449；读全实现 ExecPlan 和实际 diff。
2. 已审代码/产品/架构/测试/故障/权限/时间/键盘/浏览器/工作项，并完成定向测试、有效整表变异和独立窄容器反例。
3. 协调者发布统一 review、安排 P2 修复；修复后重锁 SHA，以固定窗口/窄 slot 新判据和原浏览器/权限合同独立复评，再按直接授权收尾。

可复现命令均在上述执行目录运行：

    pnpm test:file tests/contract/ui-workspace-status.test.js tests/contract/ui-workspace-setup.test.js tests/contract/ui-work-item-list.test.js tests/browser/workspace-header.test.js tests/browser/workspace-read.test.js
    pnpm run boundaries
    node scripts/review-mutate.mjs .superpowers/pr529-review/mutations.json
    node .superpowers/pr529-review/probe.mjs
    node .superpowers/pr529-review/container-probe.mjs
    node scripts/rule-checks.mjs size f5ae377d98c43ed216f680cb72e5f35d73a2b8e1
    node scripts/rule-checks.mjs disclosure f5ae377d98c43ed216f680cb72e5f35d73a2b8e1
    git diff --check f5ae377d98c43ed216f680cb72e5f35d73a2b8e1...HEAD

## Validation and Acceptance

矩阵在逐文件审查前建立，以下为证据后的判定；P2 不作为 P0/P1 合并阻塞，但本批已有授权将其修复并独立复评。

| 等级 | 代码/反例 | 产品闭环 | 架构边界 | 测试与工作项 | 结果 |
|---|---|---|---|---|---|
| P0 | 无数据、迁移或秘密写路径；正常/空库入口可运行 | 真实 Host/SQLite 创建成功 | 无第二事实源或依赖跳层 | 必需 PR Fast Gate 成功 | 无发现 |
| P1 | unknown/unavailable 元数据与异 scope 清除，授权 partial/offline 保留 | 断连、拒读、pending/error/unknown 不冒充成功；设置/详情回焦可完成 | 七不变量、Provider ack、Host 权威未改变 | 定向65项、权限负控及9条边界通过 | 无发现 |
| P2 | viewport 响应断点不代表实际 Host slot | 窄 slot 身份碎裂并占满半屏，仍可局部滚动且动作可达 | 单一局部 CSS 根因，无业务状态影响 | 首轮缺 slot 断言；修复后新增8组宽窗口/窄slot组合 | F529-1 已关闭，见复评 |
| P3 | 检查重复结构、原始时间、诊断安全文本与维护成本 | 父级人验/安装/R1 均未被冒认 | 无额外抽象/依赖 | 标签、预算、Closes/Refs 与归档索引匹配 | 无独立新增发现 |

**F529-1 / P2：按实际 Host 容器宽度触发状态重排。首轮发现，Superseded by 下述修复独立复评（已关闭）。** 新增行 `packages/ui/src/workspace-status.ts:14`。触发条件是宿主窗口 1200px、当前 panel/slot 320px、正常 15px 字号，毋须超长工作区名。`@media(max-width:40rem)` 读取窗口宽度，因此仍保持 `minmax(0,1fr) auto auto` 三列；“Table workspace”身份列只有 14.34px、文字高270px，summary 高288px，状态区被50%上限压为210px，普通身份也须在局部区域滚动才能读全。相同实际320px但窗口320px时，规则命中，身份列275px、文字22.5px、summary85.5px；长身份的窗口1200/slot320对照更扩大为5130px文字高。实际影响是狭窄 Host panel 首屏身份碎裂、额外占用列表空间；Host/source 状态及操作仍可达，故定为非阻塞 P2。

证据：`container-probe.mjs` 在真实生产组件上完成4组同输入几何对照，`container-probe.json` 与 `container-1200-false.png` 保存数值及图像；正常320px viewport为正控。此前10个 probe 场景只断言通达性，图像审读才发现可读性问题，未将“pass”当产品结论。修复方向：以组件实际宽度应用现有两列及身份整行布局，保留明确的宿主/来源观察与原生披露语义；补固定宽窗口、独立窄 Host slot 的身份宽度/位置与首屏高度断言。此缺陷直接属于 #528 当前验收，不能只转给 #446/#449 或用已有绿色 viewport 矩阵放过。扫描全部开放 issue 未发现另一个专门承接此 CSS 响应边界的工作项。

有效变异整表（同一最终产品树，第二次完整运行 exit0，前后基线均绿，脚本逐字节还原）：

| ID | 破坏 | killedBy 归因 | 结果 |
|---|---|---|---|
| M1-readable-gate | 去掉元数据明确读取许可 | `unknown/unavailable status` | KILLED |
| M2-offline-before-access | 将 offline 提前到能力判定之前 | `unknown/unavailable status` | KILLED |
| M3-original-datetime | 丢弃 time.dateTime | `one identity and toolbar` | KILLED |
| M4-native-keyboard | summary 阻断默认键盘行为 | `one identity and toolbar` | KILLED |

工程证据：定向命令65/65通过（含6个 header 浏览器场景及7个真实生产组合场景）；boundaries 9/9；独立 probe 10/10无 pageerror，覆盖320px/200%文字、260/420px高度、固定1200px窗口下320px slot、多异常、America/New_York时区和完整动作焦点；后续4组容器对照精确复现 F529-1。size 为代码/测试282行、文档160行，符合 #528 的800/1300预算；disclosure 及 diff --check 通过。人工检查五类发布面无新增敏感值；本次机械扫描未通过 PR_BODY 输入，PR 描述另已人工审读。

托管证据绑定当前 head：CI run `41630538746` 的 Verify、Browser、PR Fast Gate 成功；Merge Gate run `41630538947` 成功；Rule checks run `41630542032` 的 base/size/disclosure 成功；Issue policy run `41630542015` 和 Engineering run `41630543085` 成功。取消的 `41630535608`、`41630538824`、`41630538912` 分别有上述同名成功后继，不把取消当作绿色。

产物证据为已有、当前回读的同工具链报告：`.superpowers/iteration9/bundle-final/report.json` 的 `source.head` 为当前完整 head、dirty=false，基线为精确 base，Node v26.12.1/pnpm10.28.2/esbuild0.28.2及构建配置一致。Host raw/gzip不变；client +1190/+269字节，包+282字节，只增加 observed-time 输入、externalImports 集合不变。`git diff 33a84b2ca523305fa8890beef058d060712da0ca HEAD -- packages apps` 为空；已审生产代码与先前 clean-build代码一致。这是回读已有构建记录，本轮未重建或验证安装 Host。独立测试运行环境为 Node v26.13.0。

#528 首轮五项验收映射（slot缺口已由修复复评替代）：唯一身份/工具栏有正常与浏览器证据，但当时窄 Host slot 尚须 F529-1；状态正交/元数据安全由模型、Browser与变异支持；确认时刻 SGT/UTC/纽约及无效值可读且保留 dateTime，date-only路径未变；窄/zoom/键盘/回焦覆盖保留上述 slot 缺口；同构建报告与公告/撤权证据已核对。issue checkbox 仍由协调者在修复复评后核对，不提前打勾。

## Progress

- [x] 2026-11-04：初始 refs、账号、worktree、线程与风险矩阵已建立。
- [x] 2026-11-04：完成全层独立审查、65项定向回归、9项边界、四项有效变异和独立浏览器反例；末次 refs未漂移。
- [x] 2026-11-04：完整发现交协调者；没有在首个问题后停止。
- [x] 2026-11-04：F529-1由其他owner修复，本评审者独立复评通过；执行快照为下述HEAD加两文件摘要。
- [ ] 协调者统一发布、验收回读与授权收尾。

## Surprises & Discoveries

首次mutation四个目标均触发预期失败，但末尾恢复基线被信号终止exit128；整轮按夹具规则不可用。确认产品diff为空、独立基线2/2通过后，完整整表重跑exit0，才采纳表中结果；没有清理或终止其他worktree进程。

通达性探针全部通过仍不足以证明首屏可读。实际截图暴露viewport与Host slot两个不同边界；普通身份的对照即可复现，不依赖极端字符串。现有viewport宽度矩阵未覆盖该组合，不能据此宣布所有窄Host容器验收完成。

## Decision Log

- 2026-11-04 / 用户（协调者记录）：PR #529–531无P0/P1或仅P2/P3时，授权本会话修复、独立复评、归档、整合并按PR使用rebase merge；有P0/P1且已有实现会话则交其修复。
- 2026-11-04 / 独立评审：F529-1定P2，因为普通窄slot显著降低身份可读性但可局部滚动、动作仍可完成；已有父级人验不消除本child的直接验收缺口。
- 2026-11-04 / 协调者：P2交其他owner修复，本评审者独立复评；优先比较局部container query与intrinsic wrap两小方案，不扩展设计。
- 2026-11-04 / 独立评审：首轮建议事件为APPROVE（只有P2）；协调者按已获授权先修复并独立复评，再提交最终统一事件。本独立评审者未发布远端review，统一事件由协调者负责。

## Idempotence and Recovery

远端动作前重锁head/base，使用review commit_id绑定；发生force-push/rebase/retarget后旧首轮结论不能代替新head复评。失败保留本地证据，不更改规划状态。回退单位仍为整个呈现PR，无schema迁移或用户数据清理；评审材料可重复运行，变异由脚本负责精确恢复。复评必须覆盖本条固定窗口/独立slot反例，不能只重跑原viewport矩阵。

## Interfaces and Dependencies

评审读取通过 `gh-review` 的评审账号；未执行远端写入。UI只订阅既有client sources，ui-model沿用accessIndex，ObservedTime只格式化已有观察。无Host ABI、Provider、Storage、凭据或持久化变化；包边界9项通过。#446继续拥有具体视觉人验，#449拥有精确安装产物/Host/人类接受，#427汇总完整Core品质，#73与#459继续承担发布门及已知风险裁决。

## Outcomes & Retrospective

首轮历史结论是0×P0、0×P1、1×P2、0×独立P3；没有遗漏的已知阻塞。新P2完整锚定新增行、触发条件、可观察影响、对照证据与局部修复方向。正常生产链、来源安全、键盘披露、绝对确认时间、设置/详情回焦、断连和权限恢复有可判别证据；首轮窄slot缺口由以下修复复评关闭。本地、托管、历史构建回读、安装Host和人类/R1证据保持区分；不替代父级产品接受。


修复独立复评（2026-11-04）：执行目录仍为 `.worktrees/workspace-header`，`fix/workspace-header @ 382233955e9a6df86e582989b0d23743640989e6` 加另一 owner 的未提交修复。正式产品/测试变更只有 `workspace-status.ts` 两处 CSS 和 `workspace-header.test.js` 新增25行，27A/2D；本评审者未实施该修复。状态面板声明局部命名 `hp-status` inline-size container，断点改为查询该容器；保留原两列观察优先/身份整行语义。intrinsic wrap 方案会另改排序与宽度分配，此处复用既定规则的成本更小，无 JS 量宽、外部依赖或新状态。

独立复跑 `node --test --test-timeout=120000 tests/browser/workspace-header.test.js`，7/7通过，0fail/skip，涵盖固定窗口1200/slot320与窗口320正控、普通/长身份、100%/200%、Tab/Enter/Space、设置/详情回焦、权限unknown/unavailable及授权离线/partial。普通身份由原14.34px列/270px文字高恢复为275px/22.5px，状态区86.5px；图像审读确认身份整行、宿主/来源观察在前，原F529-1不再复现。

另用 `.superpowers/pr529-review/repair-layout-independent.mjs` 完成12个真实生产组合矩形对照（固定1440px窗口、slot320/640/1240、字号15/30、预览/展开），Host slot带left72/top48偏移与420px短高。抽屉始终匹配根矩形与视口裁剪的交集，表格高至少140px，详情正文正高度，无整页横溢出、无pageerror，Escape后回到原列表link。新增containment未使top-layer dialog发生坐标偏移或破坏表格本地几何。探针首次错误要求抽屉top等于未裁剪的负root.top，按既有 `observeDetailLayout` 的视口裁剪合同纠正判据后12/12通过；没有为通过更改产品代码。短Host/200%长身份仍按原合同使用局部滚动，不声称全部文本同时完整显示。

核实修复交接的最终六项整表 `final-mutations.json` / `final-mutations.log`：原四项与H1恢复viewport断点、H2删除container声明均由明确killedBy杀死，SUMMARY全KILLED；脚本只有还原后基线通过才输出SUMMARY。未重复跑变异。当前修复文件SHA256与该表交接完全一致：`workspace-status.ts` 为 `be010b714533604ac50e831406711904f1cc249a44de293f50f396d69c16d9a8`，正式Browser测试为 `57b1e5676cd53b645d2ae3185996a318c998b1702cc37e6f2bb3c47947a99615`。修复owner的相关38项与typecheck为其交接证据；本评审者新跑7项与12组独立探针，`git diff --check`通过。

当前结论：F529-1关闭，无新增P0/P1/P2/P3，修复可接受。首轮构建报告仅代表修复前代码；CSS已变化，协调者须在最终整理的clean head重建/回读产物和托管门禁，不能把旧构建或旧head检查用于新产物。#446/#449/#427与R1保留原人类/安装/整体产品门禁，issue勾选与远端收尾由协调者执行。

## Bottom Change Note

2026-11-04：保留原先13章风险矩阵，补全当前SHA事实、分层结果、有效变异、65+9验证、产物回读与P2窄Host容器对照；协调者统一发布及安排修复复评。

2026-11-04：以独立7项Browser与12组偏移slot/抽屉矩形验证接受局部container修复，原F529-1标记Superseded并关闭；最终发布head/产物门保留给协调者。

2026-11-04 / 协调者最终产物复算：旧Node v26.12.1基线因工具链不同被拒；在主检出清洁 `main @ f5ae377d` 以Node v26.13.0重新生成 `.superpowers/pr529-531-review/bundle-base-current/report.json`。本分支清洁候选 `2bf595ef` 的实际比较为Host零增量、client +1239 raw/+280 gzip字节、packed archive +261字节，React及外部specifier不变。最终文档整合后再次生成同工具链报告并将source.head绑定发布head；PR正文承载最终测量。原始初审bundle值仅是其旧head快照，不能当最终值。
