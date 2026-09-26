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
| [ADR-0001](ADR-0001-external-identity-key-shape.md) | 外部身份注册表的键是「平台绑定 + 对象种类 + 平台全局 node id」 | Proposed |
| [ADR-0002](ADR-0002-membership-identity-separate-from-content.md) | 成员关系身份与内容身份分离，成员关系落在独立的工作区作用域表 | Proposed |
| [ADR-0003](ADR-0003-events-are-not-the-correctness-mechanism.md) | 事件不是正确性机制，对账是 | Proposed |
| [ADR-0004](ADR-0004-unknown-external-create-is-product-visible.md) | 结果不确定的外部创建先对账再重试；没有自然键时它是产品可见状态。**订正 2026-09-23（L1 / #119）**：证据边界与结论句「平台不提供可对账的输入」按实测就地订正——调用方**自带**的唯一标记 + 作者 + 时间窗可对账，标记不唯一时不可判定。**订正 2026-09-24（评审响应）**：状态列的**类型**取 `packages/domain` 的 `WriteState`（结果轴），L1 给出的是**获知方式**四个标注（`confirmed` / `reconciled` / `rejected` / `unresolved`）——原文写的「状态取值集合 4 个」是两轴合一，**Superseded by `docs/architecture/gate-e1-uncertain-create.md` §2（2026-09-24）** | Proposed |
| [ADR-0005](ADR-0005-projection-anchor-and-behaviour-2-enforcement.md) | 投影的锚点与行为 2 的强制点：删除投影上的成员关系锚点与种类触发器，强制点在 core 的 `entityKindFor` + e2e；storage 只保证「同一工作区同一实体一行投影」（主键），种类一致性登记为 core 推导义务 | Proposed |
| [ADR-0006](ADR-0006-connection-anchor-and-workspace-mount.md) | 把 `provider_binding` 收窄为跨工作区的连接锚点，新增 `workspace_binding` 承载工作区挂载；`external_identity` 的键形状不变 | Proposed |
| [ADR-0007](ADR-0007-provider-error-codes-carry-system-promises.md) | provider 写方法的 `conflict` 是「请求的状态已成立且可复用」的系统级承诺，`ambiguous_result` 是「结果真的不确定」；core 在报权威 `Saved` / `confirmed` 前必须**观测**而不是相信返回码，缺观测手段时补 port 的读能力而不是把义务下推给每个 provider | Proposed |

本目录只登记**已在仓库内有证据**的决策：上表七条里四条来自 Gate E1 的实测记录，ADR-0005 与 ADR-0006 来自 #27 的 schema 评审（PR #122 的两轮），ADR-0007 来自 PR #160 连续五轮被打回的九条 P1 的机制聚类（`docs/exec-plan/active/2026-09-24-local-git-worktree.md`「系统级根因分析」），`Proposed` 表示证据已进仓库、采纳权在人类伙伴（`docs/architecture/release-gates.md` §2 第 1 行把 Gate E1 的判定者列为人类伙伴，§1 规定 R1 不得由 LLM 判定；裁决见 `docs/architecture/gate-e1-ruling.md`，该行对 `AGENTS.md` §1.2 的错误归因登记在裁决 §6.5）。

上游工程包给出的 12 条初稿决策主题如下，此处只作为**待重述清单**保留，不作为本目录的依据——上游输入不随仓库分发（`AGENTS.md` §3、`docs/README.md` §3），对外可读的结论必须在本目录内独立成立：

Host 权威、ConnectorAccount 与 ProviderBinding 分离、ExternalIdentity 注册表、PlanningItem / WorkItem / ChangeRequest 分离、SQLite current-state 模型、webhook 非正确性依赖、先确认再更新投影、ambiguous create 不自动重试、Capability ∩ Permission ∩ Policy、Start Work 补偿式编排、MVP 不引入 Redis / Queue / Search、ExecPlan 必须在真实仓库上生成。

其中 3 条已在 Gate E1 的实测证据上重述并登记：**ExternalIdentity 注册表** → ADR-0001、**webhook 非正确性依赖** → ADR-0003、**ambiguous create 不自动重试** → ADR-0004。ADR-0002（成员关系身份与内容身份分离）是 Gate E1 实测新增的结论，不在这 12 条之内。其余 9 条在逐条重述并附上仓库内证据之前，不作为任何结论的依据；需要时应先把来源与证据引入仓库，再新增 ADR。
