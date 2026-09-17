# docs/adr

不可回退的技术决策记录（Architecture Decision Record）。判断标准：如果这个决定被推翻，会导致已经写好的代码或已经发布的接口需要重做，它就该在这里有一条记录。

## 命名与格式

- 文件：`ADR-XXXX-<slug>.md`，四位递增编号，`<slug>` 为小写英文连字符。
- 编号不复用、不回收；被推翻的决策保留原文件，在文末追加 `Superseded by ADR-YYYY`。

每条 ADR 至少包含：

```markdown
# ADR-XXXX：<一句决策>

> 状态：Proposed | Accepted | Superseded by ADR-YYYY
> 日期：YYYY-MM-DD
> 来源：<ExecPlan 路径 / 讨论 / 上游文档>

## Decision
<做了什么决定>

## Why
<为什么；它保护哪条不变量>

## Rejected
<放弃了什么方案，为什么>

## Consequences
<代价、限制、后续需要遵守的约束>
```

## 索引

| ADR | 决策 | 状态 |
|---|---|---|
| — | 尚无仓库内 ADR | — |

上游工程包 `architecture-decisions-v0.1.md` 中已给出 12 条初稿决策（Host 权威、ConnectorAccount 与 ProviderBinding 分离、ExternalIdentity 注册表、PlanningItem/WorkItem/ChangeRequest 分离、SQLite current-state 模型、webhook 非正确性依赖、先确认再更新投影、ambiguous create 不自动重试、Capability ∩ Permission ∩ Policy、Start Work 补偿式编排、MVP 不引入 Redis/Queue/Search、ExecPlan 必须在真实仓库上生成）。它们在被逐条重述到本目录之前，仍是这些主题的当前依据。
