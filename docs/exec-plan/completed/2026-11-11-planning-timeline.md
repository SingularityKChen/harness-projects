# 真实数据只读 Timeline ExecPlan

> 状态：Completed（独立工程验收通过；最终远端门禁以PR回读为准）
> 创建：2026-11-11；格式依据：根 `PLANS.md`。
> Issue：#607；检出：`feature/planning-timeline`；初始基线：`main@063e427a`。

## Purpose / Big Picture

同一授权工作项在真实七日轴显示来源目标日与独立迭代窗口，所有未排期/无效/窗口外条目完整可读；筛选、选择、唯一详情与安全回焦保持。真实浏览器几何和v3同条件对照是最小证据。

## Context and Orientation

#606提供持久日期与安全schedule，故本PR以feature/source-schedule为base，是唯一必要stack。现有WorkItemProjectPage拥有mode/唯一detail opener，WorkItemListPage持续挂载拥有local query/列宽；Board已消费同次安全rows。v3 Timeline为已批准视觉接线参考，不能把静态语法示例当任务事实。

## Design / Spec

两份独立设计经第三位独立评审收敛：新增纯ui-model derivePlanningTimeline与ui renderer。ProjectPage只加timeline mode，ListPage持续拥有query与日期窗口，renderer消费受控anchor、不读store/Provider。窗口附带定位来源的安全key，仅用于来源不可读时同次清掉派生header，不持有业务内容副本。复用search/status/iteration和行排序，隐藏List专用列控件但保留原配置。scope变化/读门撤回清派生窗口，唯一drawer/真实href/修饰键及回焦沿既有owner。

固定周一七日，前周/本周/后周与行内“定位日期”（有效target优先否则iteration开始，且该优先日期必须在窗口外才出现）；边界禁用，9999年末无效格中性。所有safe query行保留，图形裁剪不做业务过滤；窗口外日期完整文字。每行自己的relative track，target菱形与中性虚线iteration band不同lane可共存；0/invalid不画，不造range。DOM仅七表头＋每行常量，跨度数百年仍有界。

语义table/list＋原生链接，冗余图形aria-hidden；不新造ARIA grid。继承Host中性token与字体、v3密度/自然长行/44px触达，局部XY滚动，<40rem同safe row文字回退并隐藏几何导航/定位；普通宽轴行不重复完整日期或普遍的缺失迭代句，完整来源事实留在AT与窄区文字，复杂迭代/零天/无效与窗口外仍明确可读。今天日期与Asia/Singapore始终默认显示在原生日期说明summary中，扩展图例折叠；窄区仍保留可见日历summary自然换行，正常宽轴首屏只增加一行44px周导航。展示边界now()可注，显式Asia/Singapore经Intl生成today，一个可清理分钟timer跨午夜更新；纯模型无时钟，date-only不偏移。today不决定数据freshness。

沿原loading/empty/filter-zero/partial/offline/denied/unknown门，撤权不得留下title/date/count/facet/axis旧范围。拒绝Gantt库/canvas/自动全跨度轴/多尺度zoom/新store与写入；#608/#609及完整#147仍后续。

## Global Constraints

每PR技术新增＋删除严格小于800行，文档小于1300行，含测试、fixture、配置与删除；按实际base计量，不以net抵扣。保持Host权威、单Planning源、规划/工程正交、授权撤回、事务/revision与ack/reconcile。无正式发布兼容层、自动迁移/删库、真实安装或模型调用。只操作临时测试数据；不写Planning Status、Iteration或原生依赖。依赖及主题沿当前Host，不引入新库。

写集：新`packages/ui-model/src/planning-timeline.ts`及index、新`packages/ui/src/work-item-timeline.ts`，ui `work-item-project.ts`、`work-item-list.ts`、`table-controls.ts`；既有execution-drawer-browser/table-geometry-browser的最少fixture，`tests/contract/ui-planning-timeline.test.js`与`tests/browser/planning-timeline.test.js`；本计划、docs索引及简短使用/证据说明。不得改Core/Storage/Host API。技术工作上限770、docs200–350。代表性合成数据截图与身份说明放在 `docs/product/timeline-evidence/`，完整矩阵/日志留在忽略目录。

## Plan of Work

### Batch 1 · 真实日期轴和唯一交互

最小闭环是#606的安全rows进入Timeline并打开原唯一详情。先模型/组合浏览器红例，再纯日序几何、renderer与mode接线。验证target+iteration共存、0/invalid/undated、0001/9999有界窗口/定位；共享筛选和selection，Tab/Enter详情与Escape回焦。

在检出`feature/planning-timeline`、base为#606实际head的工作树根运行：

    pnpm test:file tests/contract/ui-planning-timeline.test.js tests/contract/ui-work-item-app.test.js tests/contract/ui-work-item-detail.test.js
    pnpm test:file tests/browser/planning-timeline.test.js tests/browser/planning-board.test.js tests/browser/table-query.test.js
    pnpm typecheck
    pnpm boundaries
    pnpm --filter @harness-projects/app-harness-plugin pack:plugin
    pnpm verify
    node apps/harness-plugin/scripts/bundle-report.mjs --out .superpowers/sdd/2026-11-11-planning-timeline/bundle --base-report "$TIMELINE_PARENT_REPORT"

期望：首次目的地/geometry缺失RED，最终组合Host链、几何/安全/键盘全部pass。真实light/dark1440/1024/390及200%内容、长标题/20+行、window外/SGT午夜、withdrawal/held旧帧与offline的DOM/AX断言；相同clock/data/viewport与v3比较，capture标明source/composed/reference身份。

### Batch 2 · 独立对抗验收和交付

独立验收者核查真实来源几何/撤权/日历/长文、设计层级与维护成本，再做必要重构；复用测试、实际bundle与包体证据，修订后重跑受影响命令。只回滚本层即可去除目的地/renderer，#606详情仍独立。

## Validation and Acceptance

真实目标/迭代双lane与完整日期文字、未排期和窗口外可达；每个marker/band落在自己row并与header对齐，DOM有界且窄区无全页横溢；筛选/选择/详情/回焦沿既有owner；撤权/旧帧不泄露。使用Batch 1命令及同条件视觉证据。源测试/截图不替代#599安装美观接受或R1。

## Progress

- [x] (2026-11-11 14:41 SGT) 完成当前Project/PR取证、两份独立设计及第三位独立修订，建立隔离检出。
- [x] (2026-11-11) Batch 1：#621 draft 关联 #607 后完成 RED→GREEN；模型、真实 Host 组合链、共享查询/详情、SGT 午夜、撤权/held 旧帧及 24 组合视觉几何全部通过。
- [x] (2026-11-11) 首次独立验收完成；工程与安全接受，视觉/连续性发现 V1/F1/U1 三项 P2，并各自以真实浏览器 RED 复现后修复。
- [x] (2026-11-11) Batch 2：独立scoped复评在 `9c7b6d1b` 接受工程与源码设计，V1/F1/U1全已解决；独立运行、更新八图、默认日历/午夜与键盘证据通过。最终远端head/checks与Ready按本文规则回读。

## Surprises & Discoveries

共享 List 样式默认隐藏 caption，且固定 58px 单元格在窄区 block 回退后使行内容重叠；浏览器可见图例与 rowOverflow 断言分别 RED，Timeline 局部覆盖后 GREEN。前一版“普遍可见图例”的呈现选择已 Superseded by Decision Log 的 V1 修复（2026-11-11）：完整语义保留在 AT caption 与原生日期说明披露，避免普遍顶部说明占高；自然行高修复保留。零天窗口在周一不应显示窗口外；模型 RED 后按起始日位置修正，仍无几何。

2026-11-11 在 `feature/planning-timeline`、旧父版 `4c049d38` 上完整测试：contract 1560 通过，integration 2187/2188；唯一失败为 `identity-membership-schema.test.js` 的旧 schema 列白名单。独立 E2E 224/226，两项 `status-policy.test.js` 旧字段预期失败。协调者已确认新父版修复这些日期层 fixture；本层不改上游测试，接入新父版后重新验证。

静态v3只读任务目标日与底部语法示例分开；当前Provider没有真实任务range。自动min/max全跨度会随极远日期失去可读性，固定窗口＋完整文字/定位是最小受控方案。

## Decision Log

- Decision：2026-11-11 用户在本评审会话直接点名 PR#618–621，并授权无 P0/P1（或只有 P2/P3）时由本会话完成修复、独立复评、归档、提交整理、issue 核对与 `merge_method=rebase` 合并，明确覆盖 #621。Rationale：原实施阶段禁止自行合并约束由这条直接条件授权更新；不授权 Planning Status/原生依赖。Date/Author：2026-11-11 / 用户、主审。

固定七日及Asia/Singapore显示日历（用户环境与已批准v3），明确为本次展示决定；原生date-only不带时区。#606→#607只建工程stack，不写规划blocking。记录日期/作者：2026-11-11 14:41 SGT / 协调者，独立评审后执行。

2026-11-11 / 实现者，V1/F1/U1 修复：窗口状态并入 List 原有 local presentation owner，普通切换视图保留；scope、读门或定位来源不可读时同次安全重算。宽轴首屏只保留一行44px周导航，今天日期及Asia/Singapore默认可见，扩展图例折叠；仅窗口外优先日期可定位，文字回退隐藏全部几何动作。普通行去掉重复日期/普遍缺值句，完整事实保留在AT及窄区；复杂来源自然增高。理由是首次独立验收实测 y349.7、104.4px 行和无效窄区动作，而非由测试数决定审美。

## Idempotence and Recovery

窗口/筛选均是可重复的本地展示操作；scope/读门变更重算安全输入并清旧定位。没有业务写入或数据迁移。revert本层并恢复旧mode即可；下层schema/schedule变更先同步后重验，不能以旧head证据冒充当前消费者通过。

## Interfaces and Dependencies

使用仓库Node/pnpm/Git/gh及现有Host ABI。`TIMELINE_PARENT_REPORT` 是协调者在冻结父版干净检出以同一 build / toolchain 生成的 bundle 报告；父版以本检出 `git rev-parse feature/source-schedule` 与 `gh pr view 621 -R SingularityKChen/harness-projects --json baseRefName` 回读；2026-11-11本轮更新至 `905d87bd`，与原 `3e1c5f69` 仅父层浏览器测试/文档不同，产品接口未变。比较必须确认 `source.dirty=false`，本层也先提交为干净检出。报告包含 raw/gzip、真实 pack、inputs/externals 和 React 外置检查。GitHub写入以当前认证actor、同仓issue/PR和Project条目为目标；幂等键为issue编号＋分支，创建前查询已有PR，写后回读结果。机械回填ExecPlan/Batch、分类、负责人和既有milestone；Status与依赖由人类拥有。draft后TDD，最终push后读取head/base/checks、双向issue关联及完整review threads，当前head验证通过才Ready；人类决定合并。

公开检查在本计划指定检出的工作树根执行：`node scripts/rule-checks.mjs disclosure <base>`、`node scripts/rule-checks.mjs size <base>`、`git diff --check <base>...HEAD`，另人工核查凭据、本机身份、个人信息、内部系统、保密内容。最终提交整理为可独立理解/回滚的Conventional Commits；已推送改写先backup ref，再精确lease。

## Outcomes & Retrospective

最终父版更新后在本检出运行 `pnpm test:browser`：110/110通过、无skip/todo。干净 `9c7b6d1b` 相对干净父版 `905d87bd` 同build比较：Host不变，client raw+14321B/gzip+3010B，真实pack+3139B；无新依赖、external不变、React外置。

首次独立验收的V1/F1/U1已修复，并经同一独立验收者在 `9c7b6d1b` 接受。更新八图实际审读、独立runtime与五项定向全部通过，无新增确定发现；不以测试数量替代视觉判断。`docs/product/timeline-evidence/README.md` 提供八张代表图及来源身份；实际 Host 组合链与同 v3 的合成安全 read 分开标注。2026-11-11 在冻结父版 `3e1c5f69` 上重新执行聚焦验证 37 项、`pnpm verify` 3981 项（contract 1562、integration 2193、E2E 226）、typecheck、boundaries 9 项和真实 pack，全部通过，无 skip。旧父版列清单/字段预期失败已随父版更新消失；本层没有修改上游测试。日期 band 自身行边界、实际 List 列宽及隐藏显示列经过 Timeline 清除条件后仍保持，均有生产浏览器断言。实现无新依赖；同 build 的实际 bundle 报告由 Batch 1 命令在提交后的干净检出生成。V1 原始三项浏览器 RED 后重验 37 聚焦与 3981 全层全部通过；同7项1440浅/深首行 y281.33（v3+41.33≤44）、短行71.19px、7/7首屏，长文/复杂来源自然增高。F1 原生远日往返、U1 窄态无无效动作、单项来源遮蔽清header与读门恢复均通过。代表8图与完整24组合已重采；独立复评确认长文与200%双lane自然增高，日期窗口跨List/Board/Timeline及筛选保持，窄区无无效几何动作，日历默认可见；源证据不宣称安装、人类接受或发布。发现可靠性/维护性有意延后时在本节与技术债tracker记录；核心验收不得作为技术债延后。

## Bottom Change Note

2026-11-11 14:41 SGT：从两份独立方案及第三位修订形成首版，自包含约束/接口/验证与恢复路径；用户已授权必要时采用下一迭代内容并持续交付。

2026-11-11：记录实现红绿、窄区真实视觉缺陷及修复、聚焦与旧父版全层验证的精确限制；加入可审阅截图身份说明，保留独立验收与最终父版验证待办。

2026-11-11：接入最终日期父版，记录全层 3981 通过与 37 项聚焦验证，收紧精确安全数量、band 本行几何和跨视图显示列/宽度连续性；实际包体比较要求两端干净检出。

2026-11-11：按首次独立验收逐项修复 V1/F1/U1；窗口状态提升到原owner并加来源撤回保护，压缩普通日期行与首屏说明，窄态移除无效动作；记录精确RED/GREEN及重新捕获的视觉数值。

2026-11-11：保留冻结日历不变量：today/Asia/Singapore 在默认summary及窄态始终可见，扩展语义才折叠；默认可见性与跨午夜更新分别经浏览器RED/GREEN验证，重采全矩阵。

2026-11-11：独立修订复评接受后归档并整理为单一能力提交。V1/F1/U1经独立源码设计与工程复评解决，实际视觉、窗口连续性、撤权、日历与键盘反例通过；最终父版Browser110项全部通过。 最终head/checks/issue/threads按文内规则回读，不把本地证据等同安装或人类发布接受。

2026-11-11：追加本轮直接条件授权与独立评审入口；实施计划保留 completed，当前 head 的合并门重新核对。
