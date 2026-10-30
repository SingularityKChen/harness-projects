# PR #487 MMP 交付评审

## Purpose / Big Picture
验证当前能力能让用户完成工作区任务，并保持 Host 权威、规划轴正交与可恢复操作。

## Context and Orientation
2026-11-02 +08 评审快照：head `9924daf50f3b7207b7a6780ddf0c377412b875df`，base `main` @ `417349a3b6504b73594362a3253d9ee1565ba5c5`。执行上下文：`.worktrees/ui-workspace-status`，检出 `feature/ui-workspace-status`。回读：`gh pr view 487 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,statusCheckRollup,closingIssuesReferences`。

## Design / Spec
先建风险矩阵，再独立子评审并综合代码、用户任务、设计、边界、测试与 issue 验收；评审意见全部收齐后一次提交。严重度采用仓库 MMP 定义，不采用产品需求优先级标签。

| 等级 | 风险与反例 | 判定证据 / 当前状态 |
|---|---|---|
| P0 | 合并破坏 main；泄露凭据；Planning 第二权威或绕过外部确认 | 子评审未发现。投影无命令/时钟/原始错误输出；依赖边 9/9；最终发布面由协调者复核 |
| P1 | 核心任务无可达出口；错误恢复失败；状态虚假；设置导致丢失用户工作 | 子评审未发现。配置/确认、scope fence、未知结果与权限不可读保持；本地测试不代替安装及人类接受 |
| P2 | 限定视口或失败分支的局部可用性、可访问性或契约缺陷 | F487-1：规划刷新 pending 从列表导航到设置后消失；协调者浏览器复现。窄屏/主题/完整组合证据由协调者补充 |
| P3 | 文案、层级、一致性、文档和维护性的小问题 | 子评审未发现应提报项。薄组合层与纯投影符合单一责任；无新 store、timer、probe、依赖或公共 Host API |

## Global Constraints
评审文档仅本 PR 的 `docs/review/pr-487-mmp-review.md`；本阶段不修改实现。gh-review 为 Singularity-AI-Bot；作者与修复使用 gh/git。不得把自动测试写作人类 UAT 或 R1 验收。

## Plan of Work
- [x] 锁定当前 head/base、checks 和所有现有 review threads（均为空）。
- [x] 在逐文件检查前建立 P0–P3 风险矩阵。
- [x] 完成独立评审、产品与设计检查、判别性验证和相关 issue 排重。（2026-11-02 已完成）
- [x] 一次提交所有 inline 意见及 review。（2026-11-02 已完成）
- [x] 2026-11-02：P2 修复与独立复评完成；#486/#488 已原子 rebase 合并，#487 的最终 CI/批准/合并按下文当前版本门执行。
验证：在上述检出运行最窄相关测试；修改后按风险扩大。回滚：本阶段仅恢复本评审文档。

## Validation and Acceptance
| 项 | 证据 |
|---|---|
| 代码、边界、故障反例 | 当前 head：专项 15/15、相关回归 59/59、boundaries 9/9；typecheck 和 diff --check 均 exit 0；隔离副本最终整表 8/8 具名变异 KILLED，基线/还原后 GREEN |
| 用户任务、设计、issue 验收 | #484 的维度分离、scope、时间、无写入等源码/真实 source 条件通过；跨页规划刷新可见性存在 F487-1；屏幕阅读器语音与 #449/R1 人类接受不在本地证据范围 |
| 当前 head hosted checks / threads | PR Fast Gate 与 Merge Gate 成功；可选 review session 失败和取消检查仍须逐项归因 |

## Progress
- [x] 2026-11-02：事实快照与初始风险矩阵。
- [x] 2026-11-02：独立 MMP 子评审完成全部代码/产品/架构/测试/issue 分层，锁定 merge base、运行窄验证并完成 8 个具名变异；发现一项 P2，尚未发布。 Superseded by 主评审综合与收尾门（2026-11-02）。
- [x] 2026-11-02：首轮一次性 review 已发布。

## Surprises & Discoveries
原实现会话存在且空闲；只有发现 P0/P1 才按本次用户指令交回原 owner。#488 依赖 #486，#487 独立。

## Decision Log
2026-11-02：用户明确授权在无 P0/P1 时由本评审会话修复、复审并以 rebase 合并 #486、#487、#488；规划 Status 和原生依赖关系无更改授权。

## Idempotence and Recovery
提交前重新核对 head；漂移时重锁证据。共享历史改写先建 backup ref，推送使用精确 lease。review 发布核验 actor、commit_id 和已有 review，防重复。

## Interfaces and Dependencies
依赖 GitHub 当前 PR/issue/check/thread 事实、Host 安装与 UI 入口。研究参考仅作设计输入，正式证据应自包含。

## Outcomes & Retrospective
独立子评审结论：未发现 P0/P1；一项 P2（F487-1），按本仓库严重度定义不阻塞交付。协调者仍须综合真实浏览器/安装/CI 和修复后的当前 head；本记录尚未发布 GitHub review。 Superseded by 主评审综合与收尾门（2026-11-02）。

## Bottom Change Note
2026-11-02：先于逐文件检查建立风险矩阵与可恢复评审流程。

## 独立子评审 · 2026-11-02

### 系统判定与边界

使用 Qian Systems Router 的接口/反馈闭环检查及 First Principles Development 的 audit 路由：目标是用户从任一工作区页面识别当前作用域、来源确认、连接和未决操作；包含系统仍由 Host 拥有权威状态，摘要只消费已有快照。事实与硬约束分开：setup 的 Planning 确认、watch 的当前读取/transport、映射 intent、仓库 intent 各自投影；连接成功不推出 Planning 成功，工程状态与 CI 不参与规划确认。缺读数、权限未知/不可用、未决结果均不会生成 Saved。独立子评审不执行产品修改、commit、push 或 review 发布。

核验结果：本地 HEAD=`9924daf50f3b7207b7a6780ddf0c377412b875df`，origin/main 与 merge base 都是 `417349a3b6504b73594362a3253d9ee1565ba5c5`。15 文件、562 additions/15 deletions；只新增一个交付提交，Closes #484。初始工作树只有本评审文档未跟踪。当前远端 checks、threads 和可选失败的最终归因由协调者负责，不能从本地 GREEN 推导。

### F487-1 · P2 · 持续摘要遗漏跨设置导航的规划刷新

新增行锚点：`packages/ui/src/workspace-status.ts:23-26`（`WorkspaceStatusPanel` 的既有 source 订阅区域）。

触发：在已确认且可读工作区点击列表的“刷新规划”，令现有 `PlanningRefreshSource` 的 port Promise 保持 pending，再进入“连接设置”。`refreshSource` 已通过 Props 传入 Panel，但 Panel 仅订阅 setup/read/mapping/repository；只有列表内的 `WorkItemApp` 订阅该 source。设置导航卸载 WorkItemApp 后，刷新 pending 提示随之消失，摘要仍显示“读取：当前读取已确认”。若刷新随后失败，错误同样仅会在重新打开列表时呈现。

证据：`packages/client/src/planning-refresh.ts` 的 `refresh()` 先发布 `{ pending: true }`；`packages/ui/src/work-item-app.ts:87-88` 消费其 pending/error，`packages/ui/src/workspace-setup.ts:47` 的 list 分支才挂载该 App；本 PR Panel 的 `deriveWorkspaceStatus` 输入没有 refresh。协调者于 2026-11-02 在真实 `bindWorkspaceStatusApp` + `createPlanningRefreshSource` 受控 port 组合浏览器复现 pending→进入设置→提示消失；执行上下文为临时组合检出 `test/ui-mmp-review-20261102` @ `91e6a68`（#488 + #487，保留 C Gate 并透传 `announceListStatus`）。组合证据用于验证真实导航，不替代 #487 独立基线测试。

影响与规则：本项是局部反馈缺口，未修改 Host 事实或写入结果，不上升为 P1。#484 要求 pending/failed/last-known 在适当范围跨页面持续可见；用户在设置无法判断显式刷新仍在进行或已经失败。来源最后确认事实本身仍然真实，应继续与读取操作状态分开显示。

修复建议：在同一薄 Panel 消费已经传入的 `refreshSource`，将刷新 pending/error 作为独立读取操作事实投影并保留安全文案；复用同一 source 的已有 scope/epoch 逻辑，不新增请求、store 或定时器。补一个生产绑定行为用例：列表开始 deferred refresh→真实设置导航→pending 仍可见→失败可见→后续同源确认按现有 source 规则清除，避免刷新提示与原列表 live region 双播报。

已有工作项关系：本缺口直接属于本 PR 关闭的 #484。#151 拥有完整活动/诊断/溯源，#457 拥有运行态能力恢复机制，均不替代已有显式刷新事实的最小跨页呈现；无需为本项另建重复 issue。#449 保留精确安装候选的人类接受。

### 验证与判别力

在当前 #487 检出执行：

- `pnpm test:file tests/contract/ui-workspace-status.test.js tests/integration/harness-plugin-workspace-status.test.js`：15/15，零跳过。覆盖真实 client source 与生产 apply、四态/transport、来源匹配、setup/mapping/repo 未知、连续降级/不可用/恢复、受保护数量清除、modal notice。
- `pnpm test:file tests/contract/ui-workspace-setup.test.js tests/contract/ui-work-item-app.test.js tests/contract/ui-planning-mapping.test.js tests/contract/ui-repository-binding.test.js tests/integration/harness-plugin-workspace-setup.test.js`：59/59，零跳过。
- `pnpm boundaries`：9/9；`pnpm typecheck`、`git diff --check origin/main...HEAD`：exit 0。

产品文件保持未改。由 immutable HEAD 建立仓库外隔离副本，复制本地依赖并通过 resolution guard 后，用仓库 `scripts/review-mutate.mjs` 执行最终整表；所有变异含 `killedBy`，基线和还原后基线 GREEN，最终 exit 0。第一次 M1 歧义锚点被工具正确标为 NOT_APPLIED；收窄锚点后重新执行整表，以下只报告最终有效结果。

| 变异 | killedBy 归因用例 | 结果 |
|---|---|---|
| M1 configured→confirmed | configured is not confirmed | KILLED |
| M2 无 read→已连接 | transport unknown, offline and recovery | KILLED |
| M3 删除 workspace/binding 来源 fence | source confirmation uses only matching binding | KILLED |
| M4 来源确认改用 client receive time | source confirmation uses only matching binding | KILLED |
| M5 删除 mapping 三元 scope fence | mapping local-only/unknown/pending | KILLED |
| M6 repository unknown→Saved | repository has generic unknown/configured facts | KILLED |
| M7 忽略来源 reason/access degraded | current source observation follows matched read capability | KILLED |
| M8 删除 count/source 公告 scope reset | list announcer clears protected count | KILLED |

判别性覆盖未涉及 F487-1，所以现有 GREEN 不能证明跨页刷新操作闭环。源码验证没有新增 Provider import、状态写入、权限决定、原始错误/路径输出或浏览器时间。设计采用一处纯投影及一处生产组合，改动聚焦；列表的额外公告状态只是受 scope 限制的呈现记忆，不能提升为第二事实源。真实屏幕阅读器语音效果、精确安装候选人类 UAT、#449/R1、最终公开面和 Hosted CI 由各自门禁继续承担。

## 主评审综合与收尾门（2026-11-02 +08）
首轮已由 Singularity-AI-Bot 在锁定 head 一次性提交完整 review；#486/#487 各一条 P2，#488 无新增发现，三条均 APPROVE，无 P0/P1。可选 review-session 三次失败逐条核验均为本地接收端不可达；取消的 Rule/Issue 检查均有相同 head 的成功后继。必需 PR Fast Gate 与 Merge Gate 均通过。

产品经理视角按问题→用户任务→可观察验收回查 #482–#485，并与 #144/#151/#155/#427/#446/#449/#450/#457 排重。设计 critique 检查层级、阅读顺序、主要动作、原生控件、Host token、返回与局部滚动，结论为四个固定任务与一个持久摘要足够，不引入全局路由、主题权威或新状态存储。上游 UI 参考包只采纳来源/失败可见、任务聚焦和状态轴分离的原则，不将未实现整套页面作为本轮需求。

新鲜受控浏览器组合（真实产品组件和 client source；非安装 Host）：宽屏 rail 与 320px chooser 均可切任务；真实“连接设置→返回工作区→重入”保留仓库草稿；320×420/200% 文字深色中焦点可进入末端字段，document 无横溢出，summary/正文各有明确滚动 owner。原生菜单完整键盘、屏幕阅读器实际播报及精确 Desktop 候选仍由 #449 接受，不能由受控 source、SSR 或自动化推导。正式 UAT、R1 与 Planning Status 不随本批合并改变。

F486-1：同 workspace 合法 unavailable 与能力未观测的固定安全摘要，缺帧/异 workspace 仍等待；新具名测试先 RED（6/7）后 GREEN。独立复审 41+3 与另一复审 31 项均通过，不放宽 list gate，不枚举保护缓存。
F487-1：直接订阅既有 PlanningRefreshSource；matching workspace+binding 后才显示固定 pending/error，保留最后确认时间，将操作中的当前读数降为最后已知。中央拥有 refresh 公告，列表仅播数量，standalone 默认及 modal 内公告保留。新增测试先 RED（12/13）后 GREEN；实浏览器 pending→settings→failed 后摘要仍可见安全失败文案。独立复审 29 与 14+18、typecheck 均通过；另固化 pending→failed 的恰好一次公告，防止相同“最后已知值”吞掉错误转换。

验证命令均在本 PR 分支检出根执行：`pnpm test:file tests/contract/ui-workspace-shell.test.js`（#486），`pnpm test:file tests/contract/ui-workspace-status.test.js tests/integration/harness-plugin-workspace-status.test.js`（#487），`pnpm test:file tests/contract/ui-workspace-settings.test.js tests/contract/ui-workspace-setup.test.js tests/contract/ui-planning-mapping.test.js tests/contract/ui-repository-binding.test.js tests/contract/ui-workspace-shell.test.js`（#488）。组合验证在检出 `test/ui-mmp-review-20261102` 执行 `pnpm verify`，其产品变化由两个原始 PR commit 与本节两项已复审补丁构成；最终树与实际 main 接合后须重新比对产品 blob，变化则重测。

共享历史恢复锚点为 `refs/backup/pr<N>-before-mmp-review-20261102`。最终 push 使用精确旧 head lease；回读当前 head/base/checks/threads、issue 双向关联后重新批准，再以 `merge_method=rebase` 合并。所有公开内容经机械扫描与凭据/本机身份/个人信息/内部系统/保密五类人工检查。最终易失结果以当前回读为准，不预写合并成功。

2026-11-02 +08 最终本地组合：`pnpm verify` 为 2734+7 全通过、零 skip。修复负对照通过仓库 `review-mutate.mjs` 最终整表复跑：恢复虚假等待、移除 refresh 订阅、吞掉 pending→failed 公告、移除 matching scope 四项全部由具名测试 KILLED，还原基线 GREEN。当前 head 的 hosted CI 与批准仍须最终 push 后回读。

2026-11-02 +08 实际接合与新安装烟测：#486/#488 已通过原生栈原子 rebase merge，实际 main 为 `996447de6c3739a6f97dff27b053bfa00d50d7b2`。本 PR 重放到该 main，仅 `workspace-setup.ts` 发生预期接合冲突；保留分类任务、无条件返回、truthful safe summary 与 `announceListStatus` 传递。接合后 407 个 apps/packages/tests/scripts/workflows 文件的逐文件 SHA-256 与已通过 2734+7 和四项变异的组合完全相同，文档索引保留全部条目。

精确干净组合 `3df309bd0bc7be8bb328c28b930905cafd124326` 构建安装件 178185 bytes、SHA-256 `47bd712ca0b193b3365e49c2d0660d805eb1b82a50b452c1782082a6351a5112`，官方 Host CLI `0.2.0-rc.2`，Node `v26.12.1` / pnpm `10.28.2` / esbuild `0.28.2`。全新隔离 profile 和 Documents，不复制旧数据库，不注入 Provider token；官方 plugin add exit 0，12 个文件逐字节一致。实际 sidebar 产品入口完成本地工作区创建、settings→return→reentry（PVT_draft 保留）、切仓库任务与 320×420 键盘末动作。正文 clientHeight=196、scrollHeight=730、scrollTop=533.5，最后按钮 top=360.05/bottom=404.05；documentTop=0，pageWidth=viewport=320。该安装烟测不含真实 Provider、长列表、native popup 完整键盘、屏幕阅读器语音或 Desktop 人类 UAT；既有更广安装矩阵的固定版本证据保留在原实施计划，不冒充本次重测。
