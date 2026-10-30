# PR #488 MMP 交付评审

## Purpose / Big Picture
验证当前能力能让用户完成工作区任务，并保持 Host 权威、规划轴正交与可恢复操作。

## Context and Orientation
2026-11-02 +08 评审快照：head `505081442d017e976e4b5337dd5cd85748aee290`，base `fix/ui-workspace-shell` @ `dee917b9712af698019e9945f55280e9ae12c574`。执行上下文：`.worktrees/ui-settings-tasks`，检出 `feature/ui-settings-tasks`。回读：`gh pr view 488 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,statusCheckRollup,closingIssuesReferences`。

## Design / Spec
先建风险矩阵，再独立子评审并综合代码、用户任务、设计、边界、测试与 issue 验收；评审意见全部收齐后一次提交。严重度采用仓库 MMP 定义，不采用产品需求优先级标签。

| 等级 | 风险与反例 | 判定证据 / 当前状态 |
|---|---|---|
| P0 | 合并破坏 main；泄露凭据；Planning 第二权威或绕过外部确认 | 精确 diff 未发现；新增私有组合仅持导航，业务写入仍经既有 source；无 schema/Provider/权限/凭据路径变更 |
| P1 | 核心任务无可达出口；错误恢复失败；状态虚假；设置导致丢失用户工作 | 代码与71条聚焦契约未发现；共享恢复不随任务隐藏，unknown先读，confirmed显式编辑，scope隔离；实际Host组合由主评审补证 |
| P2 | 限定视口或失败分支的局部可用性、可访问性或契约缺陷 | 本子评审无确定新增项；标签/aria-controls/current、空草稿、焦点所有权与局部重试通过；窄屏物理/原生键盘与主题等待主评审证据 |
| P3 | 文案、层级、一致性、文档和维护性的小问题 | 无需单列的新增项；四固定任务+原生控件是当前范围内最小组合，无router、依赖或通用框架；#155/#446/#449边界保留 |

## Global Constraints
评审文档仅本 PR 的 `docs/review/pr-488-mmp-review.md`；本阶段不修改实现。gh-review 为 Singularity-AI-Bot；作者与修复使用 gh/git。不得把自动测试写作人类 UAT 或 R1 验收。

## Plan of Work
- [x] 锁定当前 head/base、checks 和所有现有 review threads（均为空）。
- [x] 在逐文件检查前建立 P0–P3 风险矩阵。
- [x] 完成独立代码/产品语义/架构/判别性测试评审和相关 issue 排重；视觉与实际 Host 组合仍由主评审综合。
- [x] 一次提交所有 inline 意见及 review。（2026-11-02 已完成）
- [x] 2026-11-02：P2 修复与独立复评完成；#486/#488 已原子 rebase 合并，#487 的最终 CI/批准/合并按下文当前版本门执行。
验证：在上述检出运行最窄相关测试；修改后按风险扩大。回滚：本阶段仅恢复本评审文档。

## Validation and Acceptance
| 项 | 证据 |
|---|---|
| 代码、边界、故障反例 | 71条聚焦契约全通过（零skip）；精确diff/状态所有权检查无确定新增缺陷；5个有效变异KILLED、无害class GREEN；3类迟到失败焦点反例通过 |
| 用户任务、设计、issue 验收 | #485逐条映射见下；语义与组合合同通过，实际Host短高/主题/文字/键盘/安装接受由主评审补充，不能据此勾选人类UAT |
| 当前 head hosted checks / threads | PR Fast Gate 与 Merge Gate 成功；可选 review session 失败和取消检查仍须逐项归因 |

### 独立子评审证据（2026-11-02）

使用 Superpowers、Qian Systems Router、First Principles Development 与 design-critique：当前阶段是交付审计，目标是现有四类设置任务可找、可完成、可返回且不丢草稿/intent。最高风险不确定性为隐藏生命周期与共享恢复的组合，而非单个表单的静态渲染。

- 代码：`workspace-settings.ts:11–20`以固定key和hidden保留四个表单，分类本身没有业务调用。`workspace-setup.ts:73–85`优先处理read/refresh恢复，unknown不重发安装；`:90–108`confirmed摘要、显式编辑与真实前置条件；`:120–122`由scope隔离且保留同scope的设置子树。映射确认抑制pending/error/未应用草稿，执行确认只描述binding事实。
- 架构：本PR只改UI组合、呈现和测试。无Provider、DTO、store、公共router、依赖或迁移变更；Host仍是确认事实owner。四槽私有固定组件没有为假想扩展引入通用配置框架。
- 产品与设计：已确认规划有摘要和显式编辑，映射/执行/仓库均有具名任务与状态/前置条件；共享恢复先于四面板，避免跨任务隐藏。宽rail与窄原生chooser共享同一active状态，hidden表单不进入可见交互；实际视觉层级、字形、触达与原生键盘行为须以主评审实际Host观察收口。
- 排重：已读当前open-issues快照。#485是本闭环；#482/#483分别拥有滚动/退出机制；#484拥有持久事实摘要；#155保留完整policy/unbind管理，#446保留视觉系统，#449保留精确安装候选的人类接受。没有把这些后续范围升级成此PR的新缺陷。

在`.worktrees/ui-settings-tasks`执行：

    node --test --test-timeout=120000 tests/contract/ui-workspace-settings.test.js tests/contract/ui-workspace-setup.test.js tests/contract/ui-planning-mapping.test.js tests/contract/ui-repository-binding.test.js tests/contract/ui-workspace-shell.test.js
    git diff --check dee917b9712af698019e9945f55280e9ae12c574...505081442d017e976e4b5337dd5cd85748aee290

结果：71 tests、71 pass、0 fail、0 skip，diff检查退出0。运行证据文件名`488-focused.log`。首次窄运行另有65 pass；最终71条含真实shell测试，不把不存在的navigation文件名当覆盖证据。

只读反例在临时副本运行：复制本head的`workspace-setup.ts`、`workspace-settings.ts`和settings契约，仅将import指向相同检出的真实依赖；原产品文件未修改。另补具名`review counterexample: late setup failure respects hidden origin and moved focus`：保持原提交焦点时聚焦共享错误一次，origin隐藏或焦点移走时零次；11 tests全部通过，证据`488-focus-counterexample.log`。这证明钩子/source语义，不能代替真实DOM或人类键盘接受。

变异通过仓库`review-mutate.mjs`在上述临时副本上运行，全部有`killedBy`，最终整表复跑；基线和还原后基线均绿。命令形状：

    node scripts/review-mutate.mjs <temporary-snapshot>/mutants.json --root <temporary-snapshot>

| 变异 | 结果与具名归因 |
|---|---|
| 删除宽rail任务切换 | KILLED：`category activation selects one task` |
| 卸载inactive表单 | KILLED：同上，同时命中identity/原生chooser保留 |
| 移除confirmed显式编辑入口 | KILLED：`confirmed revisit shows a safe summary` |
| 移除共享恢复出口 | KILLED：`execution unknown uses one shared task-independent recovery` |
| 禁用窄chooser状态切换 | KILLED：`native task chooser shares selection` |
| 无害追加class | SURVIVED/GREEN，符合预期；不将报告器因该无害控制退出1解释成产品测试失败 |

证据`488-mutation.log`。本批没有对原产品树施加变异；结束时只有本评审文件未跟踪。

### #485 验收映射

| 验收项 | 子评审判定与下一道门 |
|---|---|
| 当前任务/工作区/返回与真实分类 | 代码与契约已覆盖；初始实际Host可视由主评审核验 |
| heading/context/状态/primary，切换零业务命令 | 四固定任务与真实前置条件已覆盖，导航只setActive |
| bounded宽度、320/375与200% | 代码有46rem正文、44rem容器切换和原生chooser；物理尺寸/主题证据由主评审提供 |
| IDs、pending/unknown/conflict/retry、草稿与intent | 真实source与71条契约覆盖，含scope切换、空草稿、返回重入及ack/unknown恢复 |
| 标签/关联/目标/键盘焦点 | 标签与aria关系保留；迟到响应与返回焦点契约通过，真实DOM及原生菜单待主评审 |
| 同尺寸主题视觉、人类层级审阅 | 不从SSR/契约推断完成；#449仍保留精确候选人类接受 |
| Host短高+inflight+负控+bundle | 5项有效负控有判别力；真实Host/组合与same-build bundle delta由主评审综合 |

本子评审无可发布的新增inline发现（P0=0、P1=0、P2=0、P3=0）；该结论限于上述immutable head和已验证语义。主评审完成实际Host与组合验证并重锁远端后决定最终review事件。

## Progress
- [x] 2026-11-02：事实快照与初始风险矩阵。
- [x] 2026-11-02：独立代码/产品语义/架构/issue排重和71条聚焦契约；临时只读副本11条反例与完整变异表复跑，原产品树未改。
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
独立子评审在当前head未发现确定新增缺陷。导航/草稿/intent/恢复语义与判别性证据已完成；主评审仍须综合实际Host视觉、原生键盘、组合、安装与远端检查，review尚未发布。 Superseded by 主评审综合与收尾门（2026-11-02）。

## Bottom Change Note
2026-11-02：先于逐文件检查建立风险矩阵与可恢复评审流程。

2026-11-02：完成#488独立分层审查与#485逐条映射，记录71条聚焦GREEN、只读副本焦点反例及5个KILLED/1个无害GREEN；保留主评审实际Host和最终review门。

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
