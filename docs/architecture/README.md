# docs/architecture

长期有效的架构说明。这里写的不是"我们打算怎么做"（那是 ExecPlan 的事），而是"系统现在长什么样、为什么这样分"。

## 内容范围

| 主题 | 说明 |
|---|---|
| 包边界与依赖方向 | 与 `AGENTS.md` §2 一致；改动必须同步契约测试 |
| 数据模型 | 本地权威状态、外部身份注册表、投影与关系图的结构 |
| 同步模型 | bootstrap、增量同步、去重与乱序、reconciliation 的正确性兜底 |
| 外部写入模型 | 校验 → 写入 → 确认/对账 → 提交投影；unknown / conflict 的处理 |
| 执行编排 | 从工作项到工作树、分支与执行会话的补偿式流程 |
| 前端模型 | 快照 + 增量、稳定身份、重连与陈旧标记 |

## 当前依据

在本目录下的主题文档补齐之前，以下上游文档是这些主题的当前依据（冻结输入，只读）：

- `deepseek-harness-project-delivery-engineering-pack-v0.1/engineering-design-v0.1.md` —— 总体技术设计与依赖方向；
- `deepseek-harness-project-delivery-engineering-pack-v0.1/api-provider-contract-v0.1.md` —— Query / Command / 错误模型 / Provider 契约 / 订阅模型；
- `deepseek-harness-project-delivery-engineering-pack-v0.1/schema-v0.1.sql` —— SQLite v1 数据模型（可执行）；
- `deepseek-harness-project-delivery-engineering-pack-v0.1/test-release-plan-v0.1.md` —— 测试分层、故障矩阵与发布门禁。

## 写作要求

- 与代码同步：包边界、依赖方向这类内容必须能被 `pnpm verify` 中的测试证明；文档只是解释，不是唯一保证。
- 不复制上游全文：只重述仍然有效的结论，并说明与上游的差异及原因。
