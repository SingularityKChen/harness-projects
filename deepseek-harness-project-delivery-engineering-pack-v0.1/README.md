# DeepSeek Harness 项目交付工作台：Engineering Pack v0.1

> 日期：2026-09-17  
> 阶段：产品与视觉设计冻结后，进入工程设计冻结（Engineering Design Freeze）  
> 上游输入：
> - `deepseek-harness-project-delivery-prd-v0.5.md`（当前）
> - `deepseek-harness-project-delivery-ui-spec-v0.1.md`

## 1. 当前研发阶段

当前已经完成：

- 产品定位、范围与非目标；
- 核心领域概念；
- 24 个目标界面的视觉与交互收敛；
- Planning / Development / Delivery / Execution / Storage 的能力域边界；
- PlanningItem / WorkItem / ChangeRequest 的身份拆分；
- MVP 与 V1 的产品范围划分。

现在不应该继续增加页面，也不应该直接大规模写 UI。

当前最早仍可能推翻下游实现的风险是：

> **跨 Provider 的对象身份、外部写入语义与同步幂等性是否能用一套稳定且可恢复的模型实现。**

因此本 Engineering Pack 先冻结以下契约：

1. SQLite 数据模型；
2. 外部身份与 Provider Binding；
3. Sync / Event / Idempotency；
4. `project-core` Query / Command API；
5. Capability / Permission / Error Contract；
6. 首条 MVP 纵向切片；
7. 测试与发布门禁。

## 2. 本包文件

- `engineering-design-v0.1.md`：总体技术设计与工程边界。
- `schema-v0.1.sql`：SQLite v1 数据模型，可直接执行验证。
- `api-provider-contract-v0.1.md`：Project API、Provider Contract、错误模型与订阅模型。
- `github-project-identity-spike-v0.1.md`：实现前必须完成的 GitHub Projects 身份与同步验证。
- `mvp-delivery-plan-v0.1.md`：按纵向切片推进的实施计划。
- `test-release-plan-v0.1.md`：测试策略、故障矩阵与发布门禁。
- `architecture-decisions-v0.1.md`：本阶段的关键技术决策记录。

## 3. Engineering Gate

在进入大规模实现前，必须通过 Gate E1：

- SQLite schema 可创建、约束生效；
- GitHub Project 中 Issue / Draft / PR-backed Item 身份验证通过；
- 同一 Issue 加入两个 Project 时内部 WorkItem 只有一个内容身份；
- Draft 转 Issue 后内部 WorkItem 身份不变；
- Provider 写失败时本地不会把未确认值当成权威事实；
- duplicate / out-of-order event 不会破坏最终投影；
- Capability 缺失时 API 返回稳定的结构化错误；
- DeepSeek Harness Host 仍然拥有权威本地状态，React UI 不拥有业务事实。

Gate E1 通过后，才能冻结 repository-level ExecPlan 并开始首条纵向切片实现。

## 4. Verification

见 `VERIFICATION.md`。本包的 SQLite schema 已通过语法执行、单 Planning Binding、Planning content-kind guard、ExternalIdentity 唯一性验证；真实 GitHub 行为仍由 Gate E1 spike 冻结。
