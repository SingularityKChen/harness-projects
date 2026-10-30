# PR #486 MMP 交付评审

## Purpose / Big Picture
验证当前能力能让用户完成工作区任务，并保持 Host 权威、规划轴正交与可恢复操作。

## Context and Orientation
2026-11-02 +08 评审快照：head `dee917b9712af698019e9945f55280e9ae12c574`，base `main` @ `417349a3b6504b73594362a3253d9ee1565ba5c5`。执行上下文：`.worktrees/ui-workspace-shell`，检出 `fix/ui-workspace-shell`。回读：`gh pr view 486 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,statusCheckRollup,closingIssuesReferences`。

## Design / Spec
先建风险矩阵，再独立子评审并综合代码、用户任务、设计、边界、测试与 issue 验收；评审意见全部收齐后一次提交。严重度采用仓库 MMP 定义，不采用产品需求优先级标签。

| 等级 | 风险与反例 | 判定证据 / 当前状态 |
|---|---|---|
| P0 | 合并破坏 main；泄露凭据；Planning 第二权威或绕过外部确认 | 未发现：改动只在 UI 与测试/文档；`pnpm boundaries` 9/9。未新增 Provider/Storage/权限/规划状态写入。公开面最终复核由整合者完成。 |
| P1 | 核心任务无可达出口；错误恢复失败；状态虚假；设置导致丢失用户工作 | 独立代码审查未发现 P1；正常/失败/unknown、pending 返回、晚完成、scope 草稿与隐藏焦点的 57 项相关契约通过。真实浏览器由整合者继续核验。 |
| P2 | 限定视口或失败分支的局部可用性、可访问性或契约缺陷 | 发现 F486-1：confirmed + 明确不可读能力落入安全摘要，却显示“正在等待工作项”，抹掉原失败说明（新增行 85）。作用域/草稿/导航契约通过；窄屏视觉与几何留给整合者。 |
| P3 | 文案、层级、一致性、文档和维护性的小问题 | 未另提 P3：隐藏子树维持未决表单生命周期，scope key 隔离目标，导航 owner 与正文 scroller 均有具体因果；未引入路由、store 或依赖。 |

## Global Constraints
评审文档仅本 PR 的 `docs/review/pr-486-mmp-review.md`；本阶段不修改实现。gh-review 为 Singularity-AI-Bot；作者与修复使用 gh/git。不得把自动测试写作人类 UAT 或 R1 验收。

## Plan of Work
- [x] 锁定当前 head/base、checks 和所有现有 review threads（均为空）。
- [x] 在逐文件检查前建立 P0–P3 风险矩阵。
- [x] 完成独立代码/产品/设计评审、相关契约与故障反例，并对 91 个 open issue 快照排重；浏览器视觉证据由整合者补齐。
- [x] 一次提交所有 inline 意见及 review。（2026-11-02 已完成）
- [x] 2026-11-02：P2 修复与独立复评完成；#486/#488 已原子 rebase 合并，#487 的最终 CI/批准/合并按下文当前版本门执行。
验证：在上述检出运行最窄相关测试；修改后按风险扩大。回滚：本阶段仅恢复本评审文档。

## Validation and Acceptance
| 项 | 证据 |
|---|---|
| 代码、边界、故障反例 | 当前 immutable head 的聚焦测试 57/57，`pnpm boundaries` 9/9，`pnpm typecheck` exit 0；SSR 反例确定 F486-1。 |
| 用户任务、设计、issue 验收 | #482/#483 与一个可回滚壳层闭环匹配；无新增公共 API/依赖。当前代码仍有 F486-1 的摘要文案问题。安装/实际浏览器和 #449 人类接受分开，由整合者补证。 |
| 当前 head hosted checks / threads | PR Fast Gate 与 Merge Gate 成功；可选 review session 失败和取消检查仍须逐项归因 |

## Progress
- [x] 2026-11-02：事实快照与初始风险矩阵。
- [x] 2026-11-02：独立评审锁定 `git merge-base HEAD origin/main` = `417349a3b6504b73594362a3253d9ee1565ba5c5`，与 base 快照一致；完整 diff 321 additions / 39 deletions，涉及 12 个文件。
- [x] 2026-11-02：聚焦测试、边界、类型检查和只读 SSR 反例完成；收齐发现一次回传，尚未发布 review。 Superseded by 主评审综合与收尾门（2026-11-02）。
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
### 独立子评审结论（初始锁定 head；发布与修复状态见主评审综合）

未发现 P0/P1，发现一个 P2（F486-1）。依据本仓库严重度，属于可机械修复的局部恢复说明问题。此结论不覆盖整合者尚未完成的浏览器视觉检查，也不代替当前远端必需 checks 回读或 #449/R1 的人类接受。

第一性原理目标是让用户在有界 Host 内到达末内容，并在任意 setup 结果下可逆地离开设置；包含系统仍由 Host 拥有事实。新增的本地 navigation 只影响可见性，按钮在 pending 时不禁用；稳定 hidden 子树保留表单与 client intent，错误焦点只移到可见摘要；同 source/workspace/binding/project 的草稿不因导航或 definitions object identity 变化丢失。最小整体方案是这一个壳层，不需要新路由、持久化或 Provider 探测。主要不确定性是安装 Host 几何，整合者继续核验；代码侧最小判别实验转向“合法能力 unavailable 仍被说成等待”。

#### F486-1 · P2 · 对明确不可读的列表保留失败说明

- 定位：`packages/ui/src/workspace-setup.ts:85`（当前 head 新增行）。第 32–33 行只让 `available/read_only/degraded` 进入列表；confirmed 工作区在 `planning.item.read=unavailable` 或未观测到该 capability 时均进入摘要，但第 85 行一律显示“正在等待工作项。”。
- 影响：原 `WorkItemApp` → `deriveWorkItemListView` 会显示“无法读取工作项”及“读取能力恢复之前不显示条目，也不显示此前的缓存”。新摘要将已经确定的不可读状态表述成等待，且当前没有 pending 读取；用户丢失故障判断与恢复边界。未观察到泄露保护数据或虚假 Saved，因此为 P2。
- 复现证据：真实 `createWorkspaceSetupSource` 返回 workspace `ws`、Planning `confirmed`、binding/project；`createEntityStore` 接受空基线；工作区 read 同 id、connected=true，分别注入合法 `access=unavailable` 或空 capabilities（尚未观测）。分别 SSR `WorkspaceSetupGate` 与原列表路由的 `WorkItemApp`。两行输出均为 `candidateWaiting=true, candidateUnavailable=false, originalUnavailable=true`；unavailable 原路由存在上述缓存禁显说明，未观测能力原路由说明“尚未确认读取工作项的能力”。该实验不代表浏览器/安装验收。
- 修复方向：按 capability 的已观测不可读、尚无匹配 read/仍待首次数据、来源未确认三类原因选择安全摘要；保留原模型的不可读说明或复用其不含条目的 unavailable 呈现。保持禁显数据，不需要新增权限刷新机制。增加具名断言，阻止 unavailable/未观测能力被写成 pending/waiting。
- Issue 排重：#483 要求不可读目标返回 truthful safe summary，直接覆盖该交付缺陷；#484/PR #487 只投影 Planning/transport/operations，当前不检查 planning read capability。#144 的原 access page 已抽取到 #457；#457 及 #465/#472 跟踪运行时权限机制，不能作为本次新增摘要回归已解决的证据。不需要重复开新 issue。

#### 验证证据与边界

在执行上下文 `.worktrees/ui-workspace-shell` 工作树根运行：

- `pnpm test:file tests/contract/ui-workspace-shell.test.js tests/contract/ui-workspace-setup.test.js tests/contract/ui-planning-mapping.test.js tests/contract/ui-repository-binding.test.js`：57 tests、57 pass、0 fail、0 skip。
- `pnpm boundaries`：9 tests、9 pass、0 fail。
- `pnpm typecheck`：exit 0。
- 上述合法 `unavailable` 与未观测 capability 的只读 SSR 反例：均暴露 F486-1。已有 shell “only matching readable planning capability” 只断言 `WorkItemApp` 是否存在，未断言其替代摘要的原因说明，因此绿色不覆盖此缺陷。

本子评审没有修改产品、提交 commit/push、发布 review 或操作 Project。未自行执行产品文件变异；历史实现计划中的六项变异不是本次重新运行的证据。整合者最终按当前 head 补真实浏览器/远端 checks、一次性发布全部意见，并在修复后重锁版本复评。

## Bottom Change Note
2026-11-02：先于逐文件检查建立风险矩阵与可恢复评审流程。

2026-11-02：独立子评审完成矩阵、57/9/typecheck 与合法拒读与未观测能力反例；记录 F486-1，保持 review 未发布，浏览器和整体裁决由整合者收尾。 Superseded by 主评审综合与收尾门（2026-11-02）。

## 主评审综合与收尾门（2026-11-02 +08）
首轮已由 Singularity-AI-Bot 在锁定 head 一次性提交完整 review；#486/#487 各一条 P2，#488 无新增发现，三条均 APPROVE，无 P0/P1。可选 review-session 三次失败逐条核验均为本地接收端不可达；取消的 Rule/Issue 检查均有相同 head 的成功后继。必需 PR Fast Gate 与 Merge Gate 均通过。

产品经理视角按问题→用户任务→可观察验收回查 #482–#485，并与 #144/#151/#155/#427/#446/#449/#450/#457 排重。设计 critique 检查层级、阅读顺序、主要动作、原生控件、Host token、返回与局部滚动，结论为四个固定任务与一个持久摘要足够，不引入全局路由、主题权威或新状态存储。上游 UI 参考包只采纳来源/失败可见、任务聚焦和状态轴分离的原则，不将未实现整套页面作为本轮需求。

新鲜受控浏览器组合（真实产品组件和 client source；非安装 Host）：宽屏 rail 与 320px chooser 均可切任务；真实“连接设置→返回工作区→重入”保留仓库草稿；320×420/200% 文字深色中焦点可进入末端字段，document 无横溢出，summary/正文各有明确滚动 owner。原生菜单完整键盘、屏幕阅读器实际播报及精确 Desktop 候选仍由 #449 接受，不能由受控 source、SSR 或自动化推导。正式 UAT、R1 与 Planning Status 不随本批合并改变。

F486-1：同 workspace 合法 unavailable 与能力未观测的固定安全摘要，缺帧/异 workspace 仍等待；新具名测试先 RED（6/7）后 GREEN。独立复审 41+3 与另一复审 31 项均通过，不放宽 list gate，不枚举保护缓存。
F487-1：直接订阅既有 PlanningRefreshSource；matching workspace+binding 后才显示固定 pending/error，保留最后确认时间，将操作中的当前读数降为最后已知。中央拥有 refresh 公告，列表仅播数量，standalone 默认及 modal 内公告保留。新增测试先 RED（12/13）后 GREEN；实浏览器 pending→settings→failed 后摘要仍可见安全失败文案。独立复审 29 与 14+18、typecheck 均通过；另固化 pending→failed 的恰好一次公告，防止相同“最后已知值”吞掉错误转换。

验证命令均在本 PR 分支检出根执行：`pnpm test:file tests/contract/ui-workspace-shell.test.js`（#486），`pnpm test:file tests/contract/ui-workspace-status.test.js tests/integration/harness-plugin-workspace-status.test.js`（#487），`pnpm test:file tests/contract/ui-workspace-settings.test.js tests/contract/ui-workspace-setup.test.js tests/contract/ui-planning-mapping.test.js tests/contract/ui-repository-binding.test.js tests/contract/ui-workspace-shell.test.js`（#488）。组合验证在检出 `test/ui-mmp-review-20261102` 执行 `pnpm verify`，其产品变化由两个原始 PR commit 与本节两项已复审补丁构成；最终树与实际 main 接合后须重新比对产品 blob，变化则重测。

共享历史恢复锚点为 `refs/backup/pr<N>-before-mmp-review-20261102`。最终 push 使用精确旧 head lease；回读当前 head/base/checks/threads、issue 双向关联后重新批准，再以 `merge_method=rebase` 合并。所有公开内容经机械扫描与凭据/本机身份/个人信息/内部系统/保密五类人工检查。最终易失结果以当前回读为准，不预写合并成功。

2026-11-02 +08 最终本地组合：`pnpm verify` 为 2734+7 全通过、零 skip。修复负对照通过仓库 `review-mutate.mjs` 最终整表复跑：恢复虚假等待、移除 refresh 订阅、吞掉 pending→failed 公告、移除 matching scope 四项全部由具名测试 KILLED，还原基线 GREEN。当前 head 的 hosted CI 与批准仍须最终 push 后回读。

2026-11-02 +08 收尾订正：本 PR 已原子 rebase 合并；对应 issue 已回读 CLOSED。新官方组合安装烟测的可复现版本、产物 hash、几何与明确边界见 `pr-487-mmp-review.md` 的实际接合与新安装烟测段；该记录不代替 #449/R1。
