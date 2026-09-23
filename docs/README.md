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

开发、CI 和发布面细则在 [docs/development/workflow.md](development/workflow.md)、[docs/development/ci.md](development/ci.md)、[docs/development/repository-rules.md](development/repository-rules.md) 和 [docs/development/publication.md](development/publication.md)；一段流程知识该住在 `docs/`、`.agents/skills/` 还是脚本里，见 [docs/development/content-placement.md](development/content-placement.md)。MVP 交付评审与回复评审分别见 [docs/review/mvp-review.md](review/mvp-review.md) 和 [docs/review/responding.md](review/responding.md)；评审标准总览仍在 [docs/review/README.md](review/README.md)。

## 2. ExecPlan 索引

### Active

| 计划 | 范围 | 状态 |
|---|---|---|
| [2026-09-20-mvp0-parallel-stacks](exec-plan/completed/2026-09-20-mvp0-parallel-stacks.md) | MVP-0 并行堆叠 PR 交付的**控制计划**：栈拓扑、文件所有权、模型路由、批次顺序与合并顺序 | Completed |
| [2026-09-20-contract-plane](exec-plan/completed/2026-09-20-contract-plane.md) | 契约栈（A）：领域模型、五域能力契约、契约套件与离线替身 | Completed |
| [2026-09-20-persistence-plane](exec-plan/completed/2026-09-20-persistence-plane.md) | 持久化栈（B）：从空库可重复执行的迁移运行器 | Completed |
| [2026-09-20-mvp0-slice](exec-plan/completed/2026-09-20-mvp0-slice.md) | 切片栈（C）：core 引导、Start Work、交付谱系、controller/client 与进度断言变绿 | Completed |
| [2026-09-20-vertical-path-and-gates](exec-plan/completed/2026-09-20-vertical-path-and-gates.md) | 文档栈（D）：把纵向链路与 R1 门禁逐条重述进仓库 | Completed |
| [2026-09-21-review-session-reliability](exec-plan/completed/2026-09-21-review-session-reliability.md) | 评审会话可靠性：事件负载只从 `GITHUB_EVENT_PATH` 读、并发按 head 提交去重，两条性质由契约测试固定 | Completed |
| [2026-09-21-engineering-state-trust-boundary](exec-plan/completed/2026-09-21-engineering-state-trust-boundary.md) | PR37 工程状态信任边界：删除可伪造 artifact，signal 判定与特权 reconcile fail closed | Completed |
| [2026-09-21-gate-e1-membership-and-draft](exec-plan/completed/2026-09-21-gate-e1-membership-and-draft.md) | Gate E1 多项目成员关系与 Draft 转换：证明同一 issue 在两个 project 下是 1 条内容身份 + 2 条成员关系，且 Draft→Issue 提升只换外部内容 id、内部实体身份不变 | Completed |
| [2026-09-18-review-feedback-convergence](exec-plan/active/2026-09-18-review-feedback-convergence.md) | 评审反馈根因收敛：#12/#19/#21/#35 的 workflow 不变量、自托管威胁模型与 area 词表单源化 | Active |
| [2026-09-18-delivery-planning-and-board](exec-plan/active/2026-09-18-delivery-planning-and-board.md) | 交付规划与工作看板重整：重述原始交付 MVP、建立里程碑与迭代、拆分过大工作项、收敛看板自动化 | Batch 1–9 已完成；剩余人工项为两个 view 的分组设置（无法经 API 回读） |
| [2026-09-21-rule-checks-api-base](exec-plan/active/2026-09-21-rule-checks-api-base.md) | 判定输入改用 PR API 的对象对：判定固定到 `(base_sha, head_sha)` 两个不可变提交，含解析器失败策略与检查 job 的一致性 | Active |
| [2026-09-21-merge-gate-layers](exec-plan/active/2026-09-21-merge-gate-layers.md) | Merge Gate 车道：integration / 包边界 / MVP-0 / E2E 四层各自成为一条 lane，空层与零用例层响亮失败 | Active |
| [2026-09-22-engineering-merged-state](exec-plan/active/2026-09-22-engineering-merged-state.md) | 让合并事件真正写进 `Engineering`：修正 GraphQL 枚举误用导致的合并投影不可达，并补上按日的字段漂移观察 | Active |
| [2026-09-22-content-placement](exec-plan/completed/2026-09-22-content-placement.md) | 流程知识的四桶归属（机械 / 技法 / 约定 / 一次性）与判定规则：给 §0 路由表的每个入口一个可机械核对的桶 | Completed |
| [2026-09-22-status-field-writer](exec-plan/completed/2026-09-22-status-field-writer.md) | 给 `Status` 一个定义、一个写入口、一个防漂移的检查：语义收敛到 `board-semantics.md` 单一事实源、写入口写进交付流程、契约测试按「行 + 子句」设防 | Completed |
| [2026-09-21-gate-e1-write-and-events](exec-plan/active/2026-09-21-gate-e1-write-and-events.md) | Gate E1 写确认与事件可靠性：实测平台无 CAS、事件订不到、重复创建幂等 | Active |

### Completed

| 计划 | 结论 |
|---|---|
| [2026-09-24-engineering-writer-terminal](exec-plan/completed/2026-09-24-engineering-writer-terminal.md) | `Engineering` 写入口与观察者共用一份终态选择策略（issue #115 option 1）：`expectedFor` 是唯一实现，写入口聚合 issue 侧全部关闭引用并 fail closed，Merged 终态且单调。第二轮 MMP 评审无 P0 / P1；遗留 #173 / #176 / #177 与合并后的真实事件回读 | Completed |
| [2026-09-24-harness-host-spike](exec-plan/completed/2026-09-24-harness-host-spike.md) | 宿主承载能力探针：四个承载问题各按「机制存在 / 承载能力已实测」两半观测，产出一份记录与 `embed` / `fallback-web` 裁决；裁决为 `fallback-web`，由问题四（插件在一个 slot 里挂载一个页面）决定。无代码合并，探针已删除 | Completed |
| [2026-09-21-gate-e1-ruling](exec-plan/completed/2026-09-21-gate-e1-ruling.md) | Gate E1 裁决：六条行为逐条裁决（1–5 `pass`、6 `inconclusive`），汇总结论 `revise`——本地数据模型 v1 不满足冻结条件；R1–R8 落到表、键或约束上，交 #27/#28 落地；四条结论提升为 ADR（`Proposed`）。#4 保持打开 | Completed |
| [2026-09-21-gate-e1-content-identities](exec-plan/completed/2026-09-21-gate-e1-content-identities.md) | Gate E1 三类内容身份：一次性沙箱、九字段记录模板与三类内容到内部身份的映射证据；三条实验各按九字段模板填满，change request 不产生第二个工作项 | Completed |
| [2026-09-21-policy-check-pr-number](exec-plan/completed/2026-09-21-policy-check-pr-number.md) | policy-check 的目标类型判定已落地：`issue <n>` 命中 PR 编号按用法错误处理（退出码 2）并提示改用 `pr <n>`，`Closes` 指向 PR 按规则违规报出（退出码 1），`Refs` 指向 PR 保持不校验 |
| [2026-09-20-rule-checks-pr-base](exec-plan/completed/2026-09-20-rule-checks-pr-base.md) | PR 体量检查的基线解耦：把"哪些 PR 进入门禁"与"用哪条基线度量"分开，栈上 PR 按自己声明的 base 判定 |
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
