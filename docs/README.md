# docs 文档地图

本目录保存**持久文档**：删掉之后，接手的人会缺失决策依据的内容。运行态内容（`.superpowers/`、`.worktrees/`）不进这里。

## 1. 目录职责

| 路径 | 放什么 | 不放什么 |
|---|---|---|
| `docs/exec-plan/active/` | 进行中的 ExecPlan（spec + plan 合一的活文档） | 已完成的历史计划 |
| `docs/exec-plan/completed/` | 已验收完成的 ExecPlan，按原文件名保留 | 需要继续修订的计划 |
| `docs/architecture/` | 长期有效的架构说明：模块边界、依赖方向、数据流、集成方式 | 一次性的实施计划 |
| `docs/adr/` | 不可回退的技术决策（ADR），一条决策一份文件 | 可以随时改的偏好设置 |
| `docs/product/` | 产品范围、术语表、目标形态、非目标 | 工程实现细节 |

约定来源见 `AGENTS.md` §3；计划格式见 `PLANS.md`。

## 1.1 Agent 工作流入口

开发、CI 和发布面细则在 [docs/development/workflow.md](development/workflow.md)、[docs/development/ci.md](development/ci.md)、[docs/development/repository-rules.md](development/repository-rules.md) 和 [docs/development/publication.md](development/publication.md)。MVP 交付评审与回复评审分别见 [docs/review/mvp-review.md](review/mvp-review.md) 和 [docs/review/responding.md](review/responding.md)；评审标准总览仍在 [docs/review/README.md](review/README.md)。

## 2. ExecPlan 索引

### Active

| 计划 | 范围 | 状态 |
|---|---|---|
| [2026-09-20-mvp0-parallel-stacks](exec-plan/active/2026-09-20-mvp0-parallel-stacks.md) | MVP-0 并行堆叠 PR 交付的**控制计划**：栈拓扑、文件所有权、模型路由、批次顺序与合并顺序 | Active |
| [2026-09-20-contract-plane](exec-plan/active/2026-09-20-contract-plane.md) | 契约栈（A）：领域模型、五域能力契约、契约套件与离线替身 | Active |
| [2026-09-20-persistence-plane](exec-plan/active/2026-09-20-persistence-plane.md) | 持久化栈（B）：从空库可重复执行的迁移运行器 | Active |
| [2026-09-20-mvp0-slice](exec-plan/active/2026-09-20-mvp0-slice.md) | 切片栈（C）：core 引导、Start Work、交付谱系、controller/client 与进度断言变绿 | Active |
| [2026-09-20-vertical-path-and-gates](exec-plan/active/2026-09-20-vertical-path-and-gates.md) | 文档栈（D）：把纵向链路与 R1 门禁逐条重述进仓库 | Active |
| [2026-09-21-review-session-reliability](exec-plan/active/2026-09-21-review-session-reliability.md) | 评审会话可靠性：事件负载只从 `GITHUB_EVENT_PATH` 读、并发按 head 提交去重，两条性质由契约测试固定 | Active |
| [2026-09-18-review-feedback-convergence](exec-plan/active/2026-09-18-review-feedback-convergence.md) | 评审反馈根因收敛：#12/#19/#21/#35 的 workflow 不变量、自托管威胁模型与 area 词表单源化 | Active |
| [2026-09-18-delivery-planning-and-board](exec-plan/active/2026-09-18-delivery-planning-and-board.md) | 交付规划与工作看板重整：重述原始交付 MVP、建立里程碑与迭代、拆分过大工作项、收敛看板自动化 | Batch 1–9 已完成；剩余人工项为两个 view 的分组设置（无法经 API 回读） |
| [2026-09-20-rule-checks-pr-base](exec-plan/active/2026-09-20-rule-checks-pr-base.md) | PR 体量检查的基线解耦：把"哪些 PR 进入门禁"与"用哪条基线度量"分开，栈上 PR 按自己声明的 base 判定 | Active |

### Completed

| 计划 | 结论 |
|---|---|
| [2026-09-17-repo-bootstrap](exec-plan/completed/2026-09-17-repo-bootstrap.md) | 仓库引导完成：文档治理约定、pnpm 工作区骨架、包边界契约测试、`PR Fast Gate` 与 `main` 分支保护（只允许 rebase 合并） |
| [2026-09-17-disclosure-audit-and-license](exec-plan/completed/2026-09-17-disclosure-audit-and-license.md) | 发布面审计完成：上游设计输入从仓库历史移除并保留本地只读副本；采用 Apache-2.0；残余暴露面（PR ref）已记录待决 |
| [2026-09-17-issue-convention](exec-plan/completed/2026-09-17-issue-convention.md) | Issue 标题、标签、正文与 PR 关联约定已归档，检查 workflow 保持 advisory |
| [2026-09-17-repo-collaboration-setup](exec-plan/completed/2026-09-17-repo-collaboration-setup.md) | 协作建设完成：README 参考致谢、GitHub Projects 工作项看板、PR 评审体系（含聚合必需检查）、Engram 记忆作用域；四项各自成独立 PR |

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
| [board-semantics.md](product/board-semantics.md) | `Status` 与 `Engineering` 字段分别属于规划轴还是工程轴、谁写、不变量 3 在看板上如何被满足、九条内置工作流该开该关、`Size` 为什么是信号而不是控制 |
| [vertical-path.md](product/vertical-path.md) | 纵向链路的步骤枚举、MVP-0 / MVP-1 / 首发范围各自的判定方式、MVP-0 的非目标 |
