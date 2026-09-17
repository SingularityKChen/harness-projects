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

## 2. ExecPlan 索引

### Active

| 计划 | 范围 | 状态 |
|---|---|---|
| — | 当前没有进行中的计划 | — |

### Completed

| 计划 | 结论 |
|---|---|
| [2026-09-17-repo-bootstrap](exec-plan/completed/2026-09-17-repo-bootstrap.md) | 仓库引导完成：文档治理约定、pnpm 工作区骨架、包边界契约测试、`PR Fast Gate` 与 `main` 分支保护（只允许 rebase 合并） |

## 3. 上游输入

`deepseek-harness-project-delivery-engineering-pack-v0.1/`（仓库根目录）是冻结的上游输入，包含 PRD、UI Spec、Engineering Design、SQLite Schema、API/Provider Contract、Identity Spike 计划、Test & Release Plan 与 ADR 初稿。

它**不**属于 `docs/`：本目录下的文档是对其中概念的仓库内权威表述，两者冲突时以本目录为准，并在 ExecPlan 的 Decision Log 中记录原因（`AGENTS.md` §1.5）。

后续可能出现的独立批次：

- 把上游 ADR 逐条重述为 `docs/adr/ADR-XXXX-<slug>.md`；
- 把上游 Engineering Design 中仍然有效的部分重述为 `docs/architecture/` 下的主题文档；
- 把 PRD 中仍然有效的产品结论重述为 `docs/product/` 下的范围与术语文档。

在这些批次完成之前，上游文件是这些主题的当前依据。
