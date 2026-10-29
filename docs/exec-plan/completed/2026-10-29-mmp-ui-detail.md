# MMP 响应式工作项详情 ExecPlan

> 状态：Completed；本闭环实现、独立审查与本地/支持Host呈现验收完成；PR门禁以最终远端回读为准。
> 创建：2026-10-29；Issue：#430；Batch：responsive-detail。
> 分支：`feature/mmp-ui-detail`；计划遵守根 `PLANS.md`。

## Purpose / Big Picture

用户在宽屏能同时看见保留空间的主列表和右侧详情，在窄屏得到可滚动覆盖抽屉；长正文、身份、路径和时间不会把页面撑宽。
打开、刷新、关闭和撤权时保持同一详情实例、真实动作与正确焦点，避免视觉现代化破坏 Start Work 或交付读取。
最小证据是实际浏览器的尺寸、键盘与状态变化检查，结合现有真实 Host 读侧集成；安装件支持 Host 验收单独记录。

## Context and Orientation

`packages/ui/src/work-item-detail.ts` 是唯一详情，已用 `<dialog>.showModal()`、可聚焦标题、原生 cancel/Escape 和首尾 Tab 循环。
`work-item-project.ts` 组合列表与详情，拥有 opener 记录、关闭回焦和 opener 已移除时列表 h2 fallback。
执行、开始工作和交付分别由 `execution-context-section.ts`、`start-work-section.ts`、`delivery-lineage-section.ts` 的现有 source/reader 管理，不能复制状态。
`tests/fixtures/work-item-detail-browser.mjs` 提供真实组件和产品 history adapter 的可服务页面，但其 Node 契约本身主要是 VM/SSR/HTTP，不能冒充实际浏览器。
#446 提供 `workspace-presentation.ts` 私有 CSS/变量；#430 的 native prerequisite 为 #428（已关闭）与 #446，现有关系保持。
冻结布局是 1440 最佳、1200 完整、1024 overlay、宽屏主区加 300–340px 详情，以及标题、键盘、44px 主动作和状态文字。

## Design / Spec

选择继续唯一原生模态 dialog。宽屏只是右侧排列：背景列表可见但仍 inert，不能宣称桌面主列表已可并行操作。
可用工作区宽度≥1200 CSS px时右侧详情固定340px，主列表为详情预留340px加16px间距；1025–1199和≤1024均为覆盖模式，避免中间宽度挤压主区。
断点依据实际工作区可用宽度，不能以物理显示器或 Host 全窗口宽度代替插件主区宽度；窄屏宽度不超可用区域且最窄320 CSS px可读。
原生 top-layer dialog 的位置要落在实际工作区可见矩形内。project owner 只测量布局根与可见 viewport 交集，读 `getBoundingClientRect()` 并以 ResizeObserver 更新尺寸；这些几何值是表现事实，不是业务状态。
project 将同一个布局根 ref 作为私有 `layoutRoot` 传给 drawer；只在这两个文件内使用。布局变化只更新 CSS/几何，不卸载、不再次 showModal、不触发读写；初次尚未测量时先用保守覆盖布局。
宽屏预留由 `.hp-project` 的布局属性控制；drawer 私有 `DETAIL_STYLES`/`.hp-detail` 只属于本闭环，不能改 #446 共享模块。根采用 #446 `.hp-workspace` 和相同 CSS 合同。
详情头含标题与明确的关闭按钮，正文独立纵向滚动；关闭可见，正文和 focus outline 不被固定头遮住，不加无证据需要的固定 footer。
身份、时间、路径和正文 `overflow-wrap:anywhere`，规划字段可用语义定义列表。保留全部事实，不靠隐藏字段、减小字体或省略ID适配340px。
关闭及主要动作≥44px，消费 `--hp-space-*`、`--hp-radius`、`--hp-border`、`--hp-surface`、`--hp-focus-*`、`.hp-action`；无 Host 新 import 或独立主题状态。

初始焦点落标题 `tabIndex=-1`，Tab/Shift+Tab 保持在可用控件内，Escape/关闭一次导航；cleanup 只关闭原生窗口、不导航。
保留当前焦点循环。只有实际支持浏览器和安装 Host 的首尾、动态 disabled/hidden 控件反例都证明原生行为充分，才能删除重复脚手架；删除不是本闭环的先决目标。
详情 view 更新不重开 dialog；redacted/unavailable/unresolved 使用通用标题、正确说明和关闭。不能把旧标题、身份、target写进新 DOM、aria-label、data属性或缓存。
opener 尚在原列表容器内则回焦 opener；被移除/替换则回列表 h2。异步状态与 refresh/Start Work 的禁用和调用次数沿用现有合同。

拒绝宽屏变 non-modal、窄屏变 modal 的双交互模型：会同时改变导航、focus与背景操作语义，需要独立行为验收，当前没有该要求。
拒绝以 Host Modal/Radix 替换现有 primitive：当前没有能力缺口；未知安装 Host 行为和包输入变化不能被美化预算掩盖。
WAI APG 的模态规则已核对：背景 inert、Tab 循环、Escape、标题可聚焦和关闭回 opener；这些是选择现有语义的依据，不是已通过的产品证据。

## Global Constraints

每 PR 代码/测试/配置/fixture additions+deletions 严格 `<800`，文档 `<1300`；预计代码500–700、文档180–350。若几何+回归预计达到800，先缩减装饰或重新拆闭环，不删判别测试。
唯一产品写集：`packages/ui/src/work-item-detail.ts`、`work-item-project.ts`、新增 `detail-presentation.ts`。
测试写集：`tests/contract/ui-work-item-detail.test.js`、`ui-work-item-detail-browser.test.js`、`tests/fixtures/work-item-detail-browser.mjs`；`tests/integration/ui-work-item-detail-read.test.js` 仅必要行为断言。
文档写集：本计划迁入 `docs/exec-plan/completed/2026-10-29-mmp-ui-detail.md`；另含 `docs/product/ui-detail.md`、`docs/review/pr-462-mmp-review.md`；索引由整合 owner 串行维护。
不改 app/list/shared foundation/forms、三个执行/交付业务 section、client/ui-model/Host/Provider、build、依赖/lockfile或数据库；不改 Status/native dependency。
只有界面私有的布局 ref可新增；不新增业务 authority、公共路由、兼容双轨或实验数据库迁移。

## Plan of Work

Batch D0 代码前提交计划并建立关联 #430 的 draft PR；先以现有 main为base，#446稳定基础提交可用后按受控 Git 流程切到同一基础，PR base为 `feature/mmp-ui-frame`，形成真实扇出依赖。
PR 描述写入 `.superpowers/ui-delivery-20261029/detail-pr.md`，包含闭环、计划+Batch、`Closes #430`、验证、风险与回滚。
运行 `gh pr create -R SingularityKChen/harness-projects --draft --base main --head feature/mmp-ui-detail --title 'feat(ui): make the work item detail responsive' --body-file .superpowers/ui-delivery-20261029/detail-pr.md`；已有 PR 则只回读。
回读 `gh pr view -R SingularityKChen/harness-projects feature/mmp-ui-detail --json headRefOid,baseRefName,isDraft,closingIssuesReferences`，期望当前基础、draft=true和关联 #430；之后才修改代码。

Batch D1 先在现有详情 fixture 增加可判定长ID/时间/路径与disabled边界场景，复用真实组件、投影和 history；不能重造业务 store 或改成第二详情。
在旧实现记录340px右侧/预留主区目标失败，再实现布局根测量、单一 dialog、稳定头和可滚正文。focus与关闭行为的既有断言必须先保持 green。
运行 `pnpm test:file tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail-browser.test.js tests/integration/ui-work-item-detail-read.test.js`，期望全部pass、零skip。
再运行 `pnpm test:file tests/contract/ui-start-work.test.js tests/contract/ui-delivery-lineage-section.test.js`；如真实文件名不同先用 `rg --files tests/contract` 定位现有同职责测试后把精确命令写回本计划，不能跳过对应行为。
回滚点是 D0；D1 整体撤回恢复旧展示，无业务状态恢复动作。

Batch D2 由整合 owner 在实际浏览器打开 `node tests/fixtures/work-item-detail-browser.mjs` 打印的本地URL，使用既有浏览器能力，不引浏览器依赖或新 CI lane。
测1440/1200/1024、320 CSS px和200%/400%等效缩放；另用窄Host主区模拟全窗口宽但容器不足1200，必须仍覆盖。两主题各有截图与布局测量。
键盘正控：标题获焦、Tab/Shift+Tab不逃逸、禁用或隐藏控件跳过、Escape只关闭一次；opener存活回焦，删除opener落列表h2。刷新/resize不重复reader或Start Work，撤权不重开、不保留canary。
临时取消 responsive CSS/预留规则，布局断言必须失败；临时破坏一次关闭回焦路径，焦点断言必须失败。恢复后重新green，mutant不得提交。
真实 Start Work/交付调用和迟到响应保持证据来自原有组件/Host集成；本fixture的UI状态切换不宣称修复 #457。

Batch D3 在本分支根执行 `pnpm typecheck`、`pnpm boundaries`；clean 提交后运行 `node apps/harness-plugin/scripts/bundle-report.mjs --source-root . --out .superpowers/ui-detail-bundle` 和 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`。
与本 PR精确base同工具链clean报告比较，记录Host/client raw+gzip、pack bytes/hash、完整inputs/externals、React；另可记录相对main累计量，不能混同两个Δ。
执行 `node scripts/rule-checks.mjs disclosure feature/mmp-ui-frame`、`node scripts/rule-checks.mjs size feature/mmp-ui-frame`、`git diff --check feature/mmp-ui-frame...HEAD`，期望无敏感/空白问题且满足更严预算。
独立对抗性评审覆盖当前head/base、全部线程、checks、P0–P3和issue验收；最终push后回读head/base/checks/issue/threads，当前证据满足才ready，人类决定是否merge。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 一套详情与尺寸 | 浏览器宽屏主区+340px、窄容器覆盖、resize不重挂载；布局负控先失败后恢复 |
| 内容可读 | 长ID/正文/时间/路径不撑页；正文可滚、关闭可见、无覆盖；320 CSS px与缩放 |
| 原生模态可访问性 | 可访问标题、标题初始焦点、背景inert、Tab/ShiftTab、disabled/hidden、Escape和opener/fallback的真实DOM检查 |
| 动作与状态保持 | Start Work/交付/刷新调用数、禁用态、stale/unknown/redacted与迟到响应回归；canary不入DOM或属性 |
| 包与公开面 | 精确base/head同构建图、bytes/pack/React和敏感扫描；<800 code、<1300 docs |
| 实际支持 Host | 最终tarball在Host中的标题、modal、嵌套菜单、viewport、焦点与reader检查；未完成就记录未验收 |

本地 Chromium/fixture、SSR和Host安装验收分别陈述；#449人类UAT、#457权限P0、R1或完整MMP不会因本PR自动完成。

## Progress

- [x] (2026-10-29 +08) 审阅现有dialog、回焦、依赖和两份独立方案，裁定保留所有宽度的原生模态语义。
- [x] (2026-10-29 +08) D0：计划提交后建立 draft PR #462；回读 base=main、draft=true、head=计划提交，closing issue #430 已关联；实现前仍待 #446 #461 基础稳定。
- [x] (2026-10-29 +08) D1：在 `feature/mmp-ui-detail` 检出、基础 `227eed7` 上先记录两个判别 RED（缺少宽容器预留；Tab 落入隐藏控件），实现后六个 focused 文件共55项通过、零skip；`pnpm typecheck` 通过、`pnpm boundaries` 9项通过。
- [x] (2026-10-29 +08) D2：真实浏览器断点/长内容/键盘/刷新/遮蔽/关闭回焦通过；预留计算负控356→0→356px通过；官方固定Host实际安装整合件、真实Project详情与明暗主题已检查。四项仓库runner变异归因KILLED，最终新产物另核。
- [x] (2026-10-29 +08) D3：clean测量、独立评审、最终当前head回读按PR门禁控制后才ready。

## Surprises & Discoveries

既有dialog最大宽度38rem且由UA居中；仅加右定位不能说明主区已预留，也不能忽略Host主区与窗口宽度差异。
原手写Tab循环只过滤disabled；判别RED实际落入CSS隐藏控件。本批补上hidden/inert祖先、无可见rect控件过滤，以及标题初始Shift+Tab回末；真实DOM反例仍由浏览器验收，不能从SSR得出支持结论。
整合owner实际浏览器发现fixture在列表路由仍强制scenario目标，遮蔽后Escape没有卸载详情；补canonical列表路由判别用例先RED，再让scenario目标仅覆盖已打开的itemId。此缺陷属于夹具而非产品路由。
宽屏side-detail是视觉排列，不自动意味着non-modal；此处明确保留inert，消除两份方案对桌面交互的含混。

## Decision Log

2026-10-29 / 独立规格审阅者：选择340px右模态+主区预留；1200以下覆盖。原因是冻结尺寸要求和当前可访问交互均可在单一primitive保持。
2026-10-29 / 独立规格审阅者：由project/drawer同一owner处理几何与回焦，#446不改这两个文件；仅表现测量可更新，业务source不迁移。
2026-10-29 / 独立规格审阅者：#430和#447从同一#446基础扇出；没有detail→forms依赖，不改原生关系。

2026-10-29 / 实现 owner：通过同一 `layoutRoot` 的CSS变量让top-layer dialog继承矩形；ResizeObserver与resize/捕获scroll只写表现属性，不增加React状态或业务回调。SSR和无DOM环境保持保守覆盖。

2026-10-30 / 本轮主评审：按用户直接条件授权修复非阻塞 P2 后复评并 rebase 合并。340px 详情导致合法长仓库 ID 的 h4 与原生 select 越界，属于本闭环的容器责任；只在详情呈现约束标题换行和 input/select 最大行内宽度，不扩展为 #447 设置表单或 #448 反馈系统。先以同一实际组合页断言复现 RED，再修复并复测；Node SSR 不作为布局证据。

## Idempotence and Recovery

focused测试、fixture和构建可重复；临时SQLite/HTTP由现有fixture清理，停止自己启动的进程，不清用户库或工作树。
临时CSS/焦点mutant保存原文件并finally恢复，green复验后才提交；截图与运行态日志仅在忽略的 `.superpowers/`。
整体revert本PR恢复旧呈现，不修改持久配置、权限或Provider事实。已推历史整理按backup ref和精确lease流程执行。

## Interfaces and Dependencies

消费 #446私有 `WORKSPACE_STYLES`、`.hp-workspace`、`--hp-*`和`.hp-action`；private布局ref只在project/drawer间传递，公开应用导航和source合同不改。
WAI APG Modal Dialog官方依据：`https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/`；背景inert、焦点循环、Escape、标题focus与返回opener规则已在本计划展开。
无新依赖和维护债；若340px无法完整呈现既有事实，先调整换行和装饰，再修订计划；不能把信息丢失登记债后关闭。

## Outcomes & Retrospective

2026-10-30 后续复评已修复长仓库标识/原生控件 P2：h3/h4按任意位置换行、input/select限制到详情可用宽度；同一实际组合页几何断言和独立CSS开关负控通过，17项聚焦回归及`test/mmp-ui-final@a9c277a`完整2567+7通过。独立复评覆盖两种合法长ID、1440/320、720重排/双倍文本、焦点循环/刷新/Escape/回焦；实际桌面缩放仍留在#449。此段替代首轮无产品缺陷判断用于当前修复结果。

实际交付同一原生modal的容器响应式右详情、稳定标题/关闭区、正文滚动、隐藏/禁用控件焦点过滤及真实关闭回焦。没有新增业务状态或依赖。独立审查未发现新增P0/P1；预留CSS测试证据缺口由实际计算样式负控补齐。
在本分支产品树运行55项聚焦测试、typecheck和9项boundaries均通过。仓库runner四项变异精准KILLED、前后基线绿色、源码恢复一致。夹具遮蔽场景强制保留目标的问题经RED/GREEN修复，不把夹具错误记为产品修复。
实际浏览器1440/1200为340px右侧且主区预留356px，1199/1024及320为overlay；宽1440但实际容器1000仍overlay且右界不超容器。长标题/路径/时间不撑页，正文滚动、关闭44px；Tab首尾与隐藏/禁用跳过、刷新单次禁用、redacted清除旧标题/身份、Escape单次关闭、opener与fallback均通过。
临时夹具CSS负控中，宽屏computed padding-right356→0→356px；相同预留判据在mutant失败、恢复后通过。该证据来自实际浏览器，不冒称NodeCI布局测试。
官方固定Host干净Web profile中的整合产物实际连接Project并打开真实#430，工作区宽1128时按overlay呈现340px，背景inert、标题focus、关闭44px、无页横滚且Escape返回原链接；Host明暗主题跟随已核对。观察产物07a7089/sha2567e975d57d41b21f6049e5beb547c410d714835ead7f1dcbc2a87fe6b730b125c，当前产品输入未因文档/提交整理而改变；最终新产物另行核对。
与最终精确PRbase的clean同构建报告按本计划命令重算，不能把对main累计差异当成自己的增量。最终远端head/checks/关联/线程通过后才ready；人类评审、#449、#457、R1均不由计划归档替代。无新增技术债。

## Bottom Change Note

2026-10-29：独立综合两份方案，消除modal/sidepanel歧义，固定容器断点、340px几何所有权、扇出依赖和真实证据边界。

2026-10-29：记录D1的真实RED/GREEN、无DOM类型环境修正、两项负控及仍待整合owner执行的浏览器/Host门禁；Node契约不升级为浏览器验收。

2026-10-29：修正浏览器暴露的fixture关闭路径，记录55项focused和仓库review-mutate整表4/4归因KILLED，保持安装Host验收待办。

2026-10-29：按整合owner实际浏览器反馈补记响应式、键盘、遮蔽和三条关闭回焦结果，明确缩放、安装Host与最终CI仍不升级为已验收。

2026-10-29：整合独立审查及实际浏览器/Host证据，归档实现闭环；最终远端门禁仍以当前head回读控制。

2026-10-30：本轮独立评审发现 P2 长仓库标识/原生控件溢出；实际组合页的精确 base/head 对照确认根因，最小呈现修复后同一浏览器断言由 RED 转 GREEN，完整并集验证与独立限定复评另行核对。
