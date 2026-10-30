# docs 文档地图

本目录保存**持久文档**：删掉之后，接手的人会缺失决策依据的内容。运行态内容（`.superpowers/`、`.worktrees/`）不进这里。

## 1. 目录职责

| 路径 | 放什么 | 不放什么 |
|---|---|---|
| `docs/exec-plan/active/` | 进行中的 ExecPlan（spec + plan 合一的活文档） | 已完成的历史计划 |
| `docs/exec-plan/completed/` | 已验收完成的 ExecPlan，按原文件名保留 | 需要继续修订的计划 |
| `docs/exec-plan/tech-debt-tracker.md` | 实施时明确接受延期的技术债及其解决/取代记录 | 未裁决的设计候选与功能路线图 |
| `docs/architecture/` | 长期有效的架构说明：模块边界、依赖方向、数据流、集成方式 | 一次性的实施计划 |
| `docs/adr/` | 不可回退的技术决策（ADR），一条决策一份文件 | 可以随时改的偏好设置 |
| `docs/product/` | 产品范围、术语表、目标形态、非目标 | 工程实现细节 |

约定来源见 `AGENTS.md` §3；计划格式见 `PLANS.md`。

## 1.1 Agent 工作流入口

开发、CI 和发布面细则在 [docs/development/workflow.md](development/workflow.md)、[docs/development/ci.md](development/ci.md)、[docs/development/repository-rules.md](development/repository-rules.md) 和 [docs/development/publication.md](development/publication.md)；一段流程知识该住在 `docs/`、`.agents/skills/` 还是脚本里，见 [docs/development/content-placement.md](development/content-placement.md)。MVP 交付评审与回复评审分别见 [docs/review/mvp-review.md](review/mvp-review.md) 和 [docs/review/responding.md](review/responding.md)；评审标准总览仍在 [docs/review/README.md](review/README.md)。

## 2. ExecPlan 索引

### Active

| 计划 | 用途 |
|---|---|
| [2026-10-30-ui-detail-text-reflow](exec-plan/completed/2026-10-30-ui-detail-text-reflow.md) | 实际App样式归属、放大文字标题重排（#479） |
| [2026-09-29-prelaunch-system-architecture-renewal](exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md) | 发布前系统与架构收敛 |

### Completed

| 计划 | 用途 |
|---|---|
| [2026-10-30-ui-workspace-shell](exec-plan/completed/2026-10-30-ui-workspace-shell.md) | 有界 Host 滚动、设置返回、草稿与未决请求保留（#482/#483） |
| [2026-10-30-github-pr-creation](exec-plan/completed/2026-10-30-github-pr-creation.md) | 原生 GitHub PR 创建、独立写权限与不确定回执（#436） |
| [2026-10-30-durable-write-intent](exec-plan/completed/2026-10-30-durable-write-intent.md) | Start Work 写前意图与不确定结果结算（#204） |
| [2026-10-29-mmp-ui-frame](exec-plan/completed/2026-10-29-mmp-ui-frame.md) | Host主题工作区视觉框架（#446） |
| [2026-10-29-membership-duplicate-content](exec-plan/completed/2026-10-29-membership-duplicate-content.md) | 成员替换重复内容契约（#337） |
| [2026-10-29-demo-user-guide](exec-plan/completed/2026-10-29-demo-user-guide.md) | Demo 用户路径、限制与人工走查准备（#444） |
| [2026-10-29-worktree-conflict-contract](exec-plan/completed/2026-10-29-worktree-conflict-contract.md) | 可复用工作树冲突契约（#200） |
| [2026-10-29-truthful-readable-list](exec-plan/completed/2026-10-29-truthful-readable-list.md) | 可见行新鲜度与主题列表闭环（#366/#429） |
| [2026-10-30-ui-planning-readonly-scope](exec-plan/completed/2026-10-30-ui-planning-readonly-scope.md) | 规划只读说明与独立工程能力（#475） |
| [2026-10-29-mmp-ui-detail](exec-plan/completed/2026-10-29-mmp-ui-detail.md) | 响应式详情闭环（#430） |
| [2026-10-28-pr438-pr440-review-followup](exec-plan/completed/2026-10-28-pr438-pr440-review-followup.md) | PR #438–#440 MMP 评审、非阻塞修复与授权收尾 |
| [2026-10-28-execution-run-refresh](exec-plan/completed/2026-10-28-execution-run-refresh.md) | 签发者运行刷新、变化式健康度与详情读回（#365） |
| [2026-10-30-ui-execution-feedback](exec-plan/completed/2026-10-30-ui-execution-feedback.md) | 执行/交付反馈、技术披露与局部焦点恢复（#448） |
| [2026-10-27-pr406-pr409-review-followup](exec-plan/completed/2026-10-27-pr406-pr409-review-followup.md) | PR #406–#409 MMP 评审、非阻塞修复、独立复评与授权合并 |
| [2026-10-26-plugin-demo-artifact](exec-plan/completed/2026-10-26-plugin-demo-artifact.md) | 版本化 tarball 与干净 Web profile 安装、打开、卸载验收（#230）；[安装指南](product/demo-install.md) |
| [2026-10-26-repository-binding-ui](exec-plan/completed/2026-10-26-repository-binding-ui.md) | 仓库选择、只读预检与三引用绑定（#356） |
| [2026-10-29-mmp-ui-forms](exec-plan/completed/2026-10-29-mmp-ui-forms.md) | 连接表单闭环（#447） |
| [2026-10-30-ui-connect-diagnostics](exec-plan/completed/2026-10-30-ui-connect-diagnostics.md) | 连接失败原因、安全拒绝与草稿恢复（#434） |
| [2026-10-26-start-work-drawer](exec-plan/completed/2026-10-26-start-work-drawer.md) | 详情显式开始工作、默认分支与人工降级恢复（#142） |
| [2026-10-26-delivery-lineage-drawer](exec-plan/completed/2026-10-26-delivery-lineage-drawer.md) | 交付谱系抽屉、缺口与时间核对（#234） |
| [2026-10-26-harness-execution](exec-plan/completed/2026-10-26-harness-execution.md) | Harness 会话启动与读取、取消安全拒绝及工作树目录通路（#140） |
| [2026-10-27-session-execution-binding](exec-plan/completed/2026-10-27-session-execution-binding.md) | 显式执行绑定、会话适配、稳定人工回退与安装重试（#359） |
| [2026-09-17-disclosure-audit-and-license](exec-plan/completed/2026-09-17-disclosure-audit-and-license.md) | 上游输入包下架与许可证落地 |
| [2026-09-17-issue-convention](exec-plan/completed/2026-09-17-issue-convention.md) | Issue 约定：模板、标签与 PR 关联 |
| [2026-09-17-repo-bootstrap](exec-plan/completed/2026-09-17-repo-bootstrap.md) | 仓库引导：治理约定 + 工作区骨架 + 远端保护 |
| [2026-09-17-repo-collaboration-setup](exec-plan/completed/2026-09-17-repo-collaboration-setup.md) | 协作与记忆建设：参考致谢 + 项目管理 + 评审体系 + Engram |
| [2026-09-18-delivery-planning-and-board](exec-plan/completed/2026-09-18-delivery-planning-and-board.md) | 交付规划与工作看板重整 |
| [2026-09-18-review-feedback-convergence](exec-plan/completed/2026-09-18-review-feedback-convergence.md) | 评审反馈根因收敛 |
| [2026-09-18-rule-semantics-and-checker-convergence](exec-plan/completed/2026-09-18-rule-semantics-and-checker-convergence.md) | 规则语义收敛与检查器加固 |
| [2026-09-20-contract-plane](exec-plan/completed/2026-09-20-contract-plane.md) | 契约栈（A） |
| [2026-09-20-mvp0-parallel-stacks](exec-plan/completed/2026-09-20-mvp0-parallel-stacks.md) | MVP-0 并行堆叠 PR 交付（控制计划） |
| [2026-09-20-mvp0-slice](exec-plan/completed/2026-09-20-mvp0-slice.md) | 切片栈（C） |
| [2026-09-20-persistence-plane](exec-plan/completed/2026-09-20-persistence-plane.md) | 持久化栈（B） |
| [2026-09-20-repository-guidance](exec-plan/completed/2026-09-20-repository-guidance.md) | 仓库指令与协作流程迁移 |
| [2026-09-20-rule-checks-pr-base](exec-plan/completed/2026-09-20-rule-checks-pr-base.md) | PR 体量检查的基线解耦 |
| [2026-09-20-vertical-path-and-gates](exec-plan/completed/2026-09-20-vertical-path-and-gates.md) | 纵向链路与 R1 门禁重述 |
| [2026-09-21-engineering-state-trust-boundary](exec-plan/completed/2026-09-21-engineering-state-trust-boundary.md) | 工程状态信任边界 |
| [2026-09-21-gate-e1-content-identities](exec-plan/completed/2026-09-21-gate-e1-content-identities.md) | Gate E1 · 三类内容身份 |
| [2026-10-28-pull-request-identity-convergence](exec-plan/completed/2026-10-28-pull-request-identity-convergence.md) | PR 原生身份声明、成员与谱系双入口收敛（#367） |
| [2026-09-21-gate-e1-membership-and-draft](exec-plan/completed/2026-09-21-gate-e1-membership-and-draft.md) | Gate E1 · 多项目成员关系与 Draft 转换 |
| [2026-09-21-gate-e1-ruling](exec-plan/completed/2026-09-21-gate-e1-ruling.md) | Gate E1 · 裁决与 v1 冻结建议 |
| [2026-09-21-gate-e1-write-and-events](exec-plan/completed/2026-09-21-gate-e1-write-and-events.md) | Gate E1 · 写确认与事件可靠性 |
| [2026-09-21-memory-storage-transaction](exec-plan/completed/2026-09-21-memory-storage-transaction.md) | 内存存储事务串行化 |
| [2026-09-21-merge-gate-layers](exec-plan/completed/2026-09-21-merge-gate-layers.md) | Merge Gate 车道 |
| [2026-09-21-policy-check-pr-number](exec-plan/completed/2026-09-21-policy-check-pr-number.md) | policy-check 拒绝把 PR 编号当 issue |
| [2026-09-21-review-blockers-core-invariants](exec-plan/completed/2026-09-21-review-blockers-core-invariants.md) | 核心不变量执行缺口 |
| [2026-09-21-review-session-reliability](exec-plan/completed/2026-09-21-review-session-reliability.md) | 评审会话可靠性 |
| [2026-09-21-rule-checks-api-base](exec-plan/completed/2026-09-21-rule-checks-api-base.md) | Rule checks 判定基线改用 PR API |
| [2026-09-21-stack-invariant-gaps](exec-plan/completed/2026-09-21-stack-invariant-gaps.md) | 栈内五个不变量缺口 |
| [2026-09-22-content-placement](exec-plan/completed/2026-09-22-content-placement.md) | 2026-09-22-content-placement —— 流程知识住在哪里：四个桶与一条判定规则 |
| [2026-09-22-engineering-merged-state](exec-plan/completed/2026-09-22-engineering-merged-state.md) | 2026-09-22-engineering-merged-state —— 让合并事件真正写进 `Engineering`，并让漂移可见 |
| [2026-09-22-status-field-writer](exec-plan/completed/2026-09-22-status-field-writer.md) | 2026-09-22-status-field-writer —— 给 `Status` 一个定义、一个写入口、一个防漂移的检查 |
| [2026-09-23-e1-uncertain-create](exec-plan/completed/2026-09-23-e1-uncertain-create.md) | 不确定外部创建的裁决证据 |
| [2026-09-23-sqlite-v1-stack](exec-plan/completed/2026-09-23-sqlite-v1-stack.md) | SQLite v1 数据模型栈 |
| [2026-09-23-storage-control-facts](exec-plan/completed/2026-09-23-storage-control-facts.md) | Storage 控制事实 |
| [2026-09-23-storage-identity-membership](exec-plan/completed/2026-09-23-storage-identity-membership.md) | SQLite 身份与成员表（Batch L2） |
| [2026-09-23-storage-sqlite-port](exec-plan/completed/2026-09-23-storage-sqlite-port.md) | Storage 端口落地（L4 地基面 + L5 同步面 + L6 执行面） |
| [2026-10-28-storage-baseline-admission](exec-plan/completed/2026-10-28-storage-baseline-admission.md) | 当前世代准入、结构化备份重建拒绝与整体原子初始化（#414） |
| [2026-10-29-start-work-owner-fencing](exec-plan/completed/2026-10-29-start-work-owner-fencing.md) | 持久 owner 代际、原子 run 回读与旧库拒绝（#420） |
| [2026-09-24-engineering-writer-terminal](exec-plan/completed/2026-09-24-engineering-writer-terminal.md) | 2026-09-24-engineering-writer-terminal —— 让 `Engineering` 写入口与观察者共用一份终态选择策略 |
| [2026-09-24-harness-host-spike](exec-plan/completed/2026-09-24-harness-host-spike.md) | 宿主承载能力探针 |
| [2026-09-24-human-execution-provider](exec-plan/completed/2026-09-24-human-execution-provider.md) | 2026-09-24-human-execution-provider —— 可绑定的人工执行 provider、降级承接与运行身份 |
| [2026-09-24-local-git-worktree](exec-plan/completed/2026-09-24-local-git-worktree.md) | 本地 Git 工作树与分支 provider |
| [2026-09-24-merge-queue-closing-refs](exec-plan/completed/2026-09-24-merge-queue-closing-refs.md) | 2026-09-24-merge-queue-closing-refs —— 订正关闭引用的普适断言，并回读本批次合并结果 |
| [2026-09-24-review-root-cause-convergence](exec-plan/completed/2026-09-24-review-root-cause-convergence.md) | 评审根因收敛（第三轮响应 + 第四轮收敛） |
| [2026-09-24-stack-review-response](exec-plan/completed/2026-09-24-stack-review-response.md) | 栈评审响应（PR #121 / #122） |
| [2026-09-24-start-work-recovery](exec-plan/completed/2026-09-24-start-work-recovery.md) | 2026-09-24-start-work-recovery —— 让 Start Work 的补偿序列真正可恢复 |
| [2026-09-24-ui-model-presentation](exec-plan/completed/2026-09-24-ui-model-presentation.md) | 2026-09-24-ui-model-presentation —— 从客户端模型派生首页、列表与详情 |
| [2026-09-26-development-suite-capability-driven](exec-plan/completed/2026-09-26-development-suite-capability-driven.md) | Development 契约套件按能力快照驱动 |
| [2026-09-29-e1-uncertain-create-wallclock](exec-plan/completed/2026-09-29-e1-uncertain-create-wallclock.md) | 119 验收 1 按字面补齐：不确定创建记录的逐条墙钟与确切命令 |
| [2026-09-29-github-projects-read](exec-plan/completed/2026-09-29-github-projects-read.md) | GitHub Projects 读取投影 |
| [2026-09-29-harness-plugin-package](exec-plan/completed/2026-09-29-harness-plugin-package.md) | Harness 插件打包（issue #227） |
| [2026-10-28-plugin-bundle-evidence](exec-plan/completed/2026-10-28-plugin-bundle-evidence.md) | Host 公开组件与同配置 bundle/pack 证据（#428） |
| [2026-09-29-harness-plugin-reprobe](exec-plan/completed/2026-09-29-harness-plugin-reprobe.md) | 宿主嵌入复探（issue #225） |
| [2026-09-29-source-version-order](exec-plan/completed/2026-09-29-source-version-order.md) | 观察版本载体收窄与定序 |
| [2026-09-29-start-work-resume-evidence](exec-plan/completed/2026-09-29-start-work-resume-evidence.md) | 2026-09-29-start-work-resume-evidence —— 补齐 Start Work 恢复的剩余闭环（#183） |
| [2026-10-28-start-work-request-binding](exec-plan/completed/2026-10-28-start-work-request-binding.md) | 开始工作首请求耐久绑定、无副作用冲突与真实重启/并发验证（#194） |
| [2026-10-29-start-work-visibility](exec-plan/completed/2026-10-29-start-work-visibility.md) | 不可见目标的事务准入与 Controller 重放守卫（#349） |
| [2026-10-01-board-auto-add-ruling](exec-plan/completed/2026-10-01-board-auto-add-ruling.md) | 2026-10-01-board-auto-add-ruling —— 裁决 `Auto-add to project` 并让看板工作流检查恢复 |
| [2026-10-01-engineering-reconcile-coverage](exec-plan/completed/2026-10-01-engineering-reconcile-coverage.md) | Engineering 全候选重算与独立唤醒 |
| [2026-10-01-provider-binding-registration](exec-plan/completed/2026-10-01-provider-binding-registration.md) | Provider 连接实现身份与原子注册 |
| [2026-10-01-repository-identity-contract](exec-plan/completed/2026-10-01-repository-identity-contract.md) | 仓库外部身份契约 |
| [2026-10-01-start-work-sqlite-prerequisites](exec-plan/completed/2026-10-01-start-work-sqlite-prerequisites.md) | SQLite Start Work 前置与谱系闭环 |
| [2026-10-01-work-item-list-states](exec-plan/completed/2026-10-01-work-item-list-states.md) | 工作项列表读取状态 |
| [2026-10-03-storage-work-item-rejection](exec-plan/completed/2026-10-03-storage-work-item-rejection.md) | 未登记工作项的 Storage 结构化拒绝 |
| [2026-10-03-workspace-read-assembly](exec-plan/completed/2026-10-03-workspace-read-assembly.md) | Client 工作区读取生产链 |
| [2026-10-03-workspace-sync-scope](exec-plan/completed/2026-10-03-workspace-sync-scope.md) | 工作区同步游标作用域 |
| [2026-10-05-connector-account-storage](exec-plan/completed/2026-10-05-connector-account-storage.md) | 连接账号与工作区配置存储 |
| [2026-10-05-project-field-read](exec-plan/completed/2026-10-05-project-field-read.md) | GitHub Project 字段读取与列表展示 |
| [2026-10-05-work-item-detail](exec-plan/completed/2026-10-05-work-item-detail.md) | 统一只读工作项详情 |
| [2026-10-07-detail-planning-fields](exec-plan/completed/2026-10-07-detail-planning-fields.md) | 工作项详情规划字段一致性 |
| [2026-10-07-development-change-request-facts](exec-plan/completed/2026-10-07-development-change-request-facts.md) | Development 变更请求读取事实 |
| [2026-10-07-development-subset-contract](exec-plan/completed/2026-10-07-development-subset-contract.md) | Development 真实能力子集契约 |
| [2026-10-07-github-actions-read](exec-plan/completed/2026-10-07-github-actions-read.md) | GitHub Actions 精确提交只读事实 |
| [2026-10-07-iteration-5-6-planning](exec-plan/completed/2026-10-07-iteration-5-6-planning.md) | 迭代 5–6 规划与 demo 条目规模收敛 |
| [2026-10-08-delivery-fact-writer](exec-plan/completed/2026-10-08-delivery-fact-writer.md) | 交付事实的唯一写者与最后确认快照 |
| [2026-10-08-delivery-query-pure-read](exec-plan/completed/2026-10-08-delivery-query-pure-read.md) | 交付查询只读已提交事实 |
| [2026-10-08-development-repository-routing](exec-plan/completed/2026-10-08-development-repository-routing.md) | Development 按仓库路由 |
| [2026-10-08-sync-revision-freshness](exec-plan/completed/2026-10-08-sync-revision-freshness.md) | 同步修订号与结构化同步失败 |
| [2026-10-09-review-technique-absorb](exec-plan/completed/2026-10-09-review-technique-absorb.md) | 评审变异夹具、评审约定与评审记录的吸收 |
| [2026-10-12-client-browser-wire](exec-plan/completed/2026-10-12-client-browser-wire.md) | Client 浏览器安全依赖图 |
| [2026-10-12-client-frame-validation](exec-plan/completed/2026-10-12-client-frame-validation.md) | Client Frame Ordering 与 Capability Identity |
| [2026-10-28-client-snapshot-ordering](exec-plan/completed/2026-10-28-client-snapshot-ordering.md) | 异步快照隔离、真实 Host 代际与 descriptor/引用一致读（#218） |
| [2026-10-12-controller-live-replay](exec-plan/completed/2026-10-12-controller-live-replay.md) | Controller in-flight 重放与 Pending 收敛 |
| [2026-10-12-controller-request-identity](exec-plan/completed/2026-10-12-controller-request-identity.md) | Controller 请求身份与重放冲突 |
| [2026-10-12-identity-conflict](exec-plan/completed/2026-10-12-identity-conflict.md) | Identity 双键冲突一致性 |
| [2026-10-12-planning-round-order](exec-plan/completed/2026-10-12-planning-round-order.md) | Planning 全量同步轮次顺序 |
| [2026-10-12-review-mutate-crash](exec-plan/completed/2026-10-12-review-mutate-crash.md) | Review Mutation Harness 崩溃清理 |
| [2026-10-13-harness-host-composition](exec-plan/completed/2026-10-13-harness-host-composition.md) | Harness Host Composition |
| [2026-10-29-host-command-authority](exec-plan/completed/2026-10-29-host-command-authority.md) | Host 调用身份与 profile 数据根（#423） |
| [2026-10-13-planning-membership-reconcile](exec-plan/completed/2026-10-13-planning-membership-reconcile.md) | Planning Membership Reconcile |
| [2026-10-13-planning-refresh-scheduler](exec-plan/completed/2026-10-13-planning-refresh-scheduler.md) | Planning Refresh Scheduler |
| [2026-10-13-status-projection-race](exec-plan/completed/2026-10-13-status-projection-race.md) | Status Projection Race Repair |
| [2026-10-13-worktree-root-outside-checkout](exec-plan/completed/2026-10-13-worktree-root-outside-checkout.md) | Worktree Root Outside Checkout |
| [2026-10-15-github-development-read](exec-plan/completed/2026-10-15-github-development-read.md) | GitHub Development 只读 Provider |
| [2026-10-15-harness-pid-flag-race](exec-plan/completed/2026-10-15-harness-pid-flag-race.md) | 变异夹具测试的 pid 标记竞态 |
| [2026-10-15-harness-session-api-probe](exec-plan/completed/2026-10-15-harness-session-api-probe.md) | Harness Session API Probe |
| [2026-10-15-host-provider-composition](exec-plan/completed/2026-10-15-host-provider-composition.md) | Host Provider Composition |
| [2026-10-15-host-watch-stream](exec-plan/completed/2026-10-15-host-watch-stream.md) | Host Watch Stream |
| [2026-10-21-delivery-lineage-strip](exec-plan/completed/2026-10-21-delivery-lineage-strip.md) | 交付谱系条与共享新鲜度年龄规则 |
| [2026-10-21-host-github-delivery-catalog](exec-plan/completed/2026-10-21-host-github-delivery-catalog.md) | Host 目录收录 GitHub 研发与 Actions provider |
| [2026-10-21-host-operation-registry](exec-plan/completed/2026-10-21-host-operation-registry.md) | Host 远程操作单一声明 |
| [2026-10-21-plugin-work-item-pages](exec-plan/completed/2026-10-21-plugin-work-item-pages.md) | Harness 插件挂载工作项列表与详情抽屉 |
| [2026-10-21-repository-binding](exec-plan/completed/2026-10-21-repository-binding.md) | Repository Binding |
| [2026-10-21-scans-skip-build-output](exec-plan/completed/2026-10-21-scans-skip-build-output.md) | 源码扫描不计被忽略的构建产物 |
| [2026-10-21-workspace-binding-commands](exec-plan/completed/2026-10-21-workspace-binding-commands.md) | Workspace Binding Commands |
| [2026-10-21-worktree-resolution-guard](exec-plan/completed/2026-10-21-worktree-resolution-guard.md) | 裸包名解析不逃出当前检出的守卫 |
| [2026-10-22-archive-finished-plans](exec-plan/completed/2026-10-22-archive-finished-plans.md) | 历史计划归档与短索引 |
| [2026-10-22-delivery-repository-routing](exec-plan/completed/2026-10-22-delivery-repository-routing.md) | 交付谱系按仓库与操作路由 |
| [2026-10-22-drawer-execution-state](exec-plan/completed/2026-10-22-drawer-execution-state.md) | 工作项抽屉执行上下文与运行状态 |
| [2026-10-22-host-planning-refresh](exec-plan/completed/2026-10-22-host-planning-refresh.md) | Host 拥有 Planning 定时刷新生命周期 |
| [2026-10-27-planning-refresh-confirmation](exec-plan/completed/2026-10-27-planning-refresh-confirmation.md) | 一致规划快照、来源确认时间与可取消的单飞刷新（#361、#360） |
| [2026-10-22-lineage-refresh](exec-plan/completed/2026-10-22-lineage-refresh.md) | 显式交付刷新与有界谱系分页 |
| [2026-10-22-test-layer-single-pass](exec-plan/completed/2026-10-22-test-layer-single-pass.md) | 契约套件去除真实层重复执行 |
| [2026-10-22-worktree-module-isolation](exec-plan/completed/2026-10-22-worktree-module-isolation.md) | 原生 Node 测试的工作树解析隔离 |
| [2026-10-26-planning-field-mapping](exec-plan/completed/2026-10-26-planning-field-mapping.md) | 规划字段映射持久化、有限默认与来源展示（#277） |
| [2026-10-27-planning-mapping-chooser](exec-plan/completed/2026-10-27-planning-mapping-chooser.md) | 字段定义选择、本地映射确认、同 Host 激活与失败意图保留（#358） |

## 3. 上游设计输入

本项目的上游设计输入（产品范围、界面规范、工程设计、数据模型、接口契约、身份验证计划、实施计划、测试与发布门禁、决策记录初稿）**不随本仓库分发**：出于发布资格与品牌承诺的考虑，它已从仓库历史中移除，仅作为所有者本地的只读参考存在。审计结论与决策依据见 [2026-09-17-disclosure-audit-and-license](exec-plan/completed/2026-09-17-disclosure-audit-and-license.md)。

因此本目录下的文档是**唯一可分发表述**：对外可读的结论必须能在这里独立成立，不能依赖那份外部输入才说得通（`AGENTS.md` §3）。

后续可能出现的独立批次：

- 把上游决策记录中仍然有效的部分逐条重述为 `docs/adr/ADR-XXXX-<slug>.md`；
- 把工程设计中仍然有效的部分重述为 `docs/architecture/` 下的主题文档；
- 把产品结论中仍然有效的部分重述为 `docs/product/` 下的范围与术语文档。

在这些批次完成之前，本目录下凡涉及长期架构或产品结论的地方，都必须自包含地写明结论本身，而不是指向外部文件。

## 4. docs/product 主题文档索引

`docs/product/` 的目录职责见 §1；随着主题文档陆续落地，实际文档在这里登记（不进 §2 的 ExecPlan 索引——这些是产品结论的权威定义，不是计划）。

| 文档 | 回答的问题 |
|---|---|
| [ui-workspace-frame.md](product/ui-workspace-frame.md) | 当前工作区的主题、层次、响应式与事实呈现约定 |
| [board-semantics.md](product/board-semantics.md) | `Status` 与 `Engineering` 字段分别属于规划轴还是工程轴、谁写、不变量 3 在看板上如何被满足、全部内置工作流该开该关、`Size` 为什么是信号而不是控制 |
| [demo.md](product/demo.md) | Harness Projects 预发布 Demo 的用户路径、验收边界、已知限制与人工走查记录 |
| [ui-forms.md](product/ui-forms.md) | 连接表单的布局、状态与可访问交互约定 |
| [vertical-path.md](product/vertical-path.md) | 纵向链路的步骤枚举、MVP-0 / MVP-1 / 首发范围各自的判定方式、MVP-0 的非目标 |
| [ui-detail.md](product/ui-detail.md) | 响应式详情的布局、状态与可访问交互约定 |
| [2026-10-26-host-recomposition](exec-plan/completed/2026-10-26-host-recomposition.md) | 提交设置即时重组、同流连续读取与延迟权限探测（#354） |
| [2026-10-26-plugin-workspace-setup](exec-plan/completed/2026-10-26-plugin-workspace-setup.md) | 插件单工作区创建/连接与真实 Harness Web 沙箱验收（#131） |
