# ADR-0005：投影的锚点与行为 2 的强制点

> 状态：Proposed
> 日期：2026-09-23
> 来源：`docs/exec-plan/completed/2026-09-23-storage-identity-membership.md`（D12、D13）、PR #122 的两轮评审意见

## Context

本地数据模型 v1 里，规划投影（`workspace_projection`）是**派生**事实：它由平台原样事实（成员关系 `project_item_membership`、字段值 `planning_field_value`）与内容推导而来，主键是 `(workspace_id, entity_id)`。

Gate E1 的行为 2 要求"内容为 change request 的成员关系不产生第二个工作项"。第二轮重构删除了三张分类/连接表（`work_item`、`change_request`、`identity_projection`）之后，一度改为在投影上保存成员关系锚点 `item_external_id` 并用两条 `BEFORE INSERT/UPDATE` 触发器要求"投影的内容种类与成员关系的种类一致"。

评审实测暴露两处缺陷：

1. **那个锚点在端口契约里没有来源**：`WorkspaceProjection` = `{workspaceId, entityId, planningStatus, content, revision}`，`putPlanningProjection(workspaceId, projection)` 无法填充 `item_external_id`；SQLite 实现只能靠一条未写进任何契约的多跳 join（`entity → external_identity → membership`），而契约套件的 `assert.deepEqual` 又禁止把该键暴露出来。
2. **闸门是单向的**：两条触发器只守在投影写入上；直接 `UPDATE project_item_membership SET content_external_kind='change_request'` 可以让"work_item 投影 + change_request 成员关系"这一对成立，且 `PRAGMA foreign_key_check` 干净。

## Decision

**删除投影上的成员关系锚点与两条触发器；行为 2 的强制点在 core 的身份推导，不在 storage 的内容种类闸门。**

- 同一底层对象经身份解析只得到一个实体（`external_identity` 的 `UNIQUE (binding_id, external_kind, external_id)` + 实体锚点；`binding_id` 指向跨工作区共享的连接锚点，键形状不变，见 ADR-0006）；
- 真实强制点是 core 的 `entityKindFor`（`packages/core/src/identity.ts`）：它按内容种类决定实体种类，change request 态绝不产生工作项实体；e2e（`tests/e2e/chain-bootstrap.test.js`，issue #76）断言系统层行为；
- **storage 保证的是另一条**：同一工作区里同一实体只有一行投影（`workspace_projection` 主键 `(workspace_id, entity_id)`）。它排除的是"同一实体的第二行"，**不**排除"这一行的内容种类推导错了"——storage 不强制内容种类一致性；
- "投影的内容种类必须与成员关系的种类一致"是**推导质量**，与"标题/正文是否正确"同类：强制点在 core 的推导处（`storage` 只存原样值、推导归 core，见控制计划 D6），不在 storage。

**订正（2026-09-24，PR #122 评审）**：本节原写「`workspace_projection` 的主键 `(workspace_id, entity_id)` 因此使"同一工作区里同一实体的第二个工作项行"**在 schema 上不可达**」。该表述不成立——主键只排除同一实体的第二行，storage 接受任何 `content_kind` 的投影行（`content_kind` 只受自身 CHECK 约束）；真实强制点是 core 的 `entityKindFor` 与 e2e。

## Consequences

- 集成用例改成断言 storage 真正保证的那条（同一工作区里同一实体只有一行投影：同一实体 UPSERT 更新、裸 `INSERT` 第二行被主键拒绝、不同实体各自一行），不再把这条用例称作"行为 2"——行为 2 本身由 core 的 `entityKindFor` 与 e2e 断言。
- **放弃的部分必须点名**：种类一致性不再是库级约束。它是 core 推导的义务，收口条件写在 `docs/exec-plan/completed/2026-09-23-storage-identity-membership.md` 的 `遗留问题与技术债务` 第 5 条（真实 provider 切片出现推导实现时补断言）。
- 端口形状不变：`WorkspaceProjection` 不需要成员关系键，L4 可以实现。
- 删除 `external_identity` 上为复合外键准备的 `UNIQUE (id, entity_id)`（其消费者已不存在）。

## Alternatives

1. **把成员关系键加进 `WorkspaceProjection`（扩端口）**：可以让种类闸门成立，但会让投影承载一个只有 storage 关心的锚点，并波及 core 的三个写入点与契约套件；换来的是对"推导出的一个字段"的库级校验——投影的其余字段（标题、正文、归一化状态）同样可能推导错，却没有任何库级校验。判据：这条性质不是验收标准，不值得一次公共接口变更。
2. **把闸门挪到 `project_item_membership` 的 `BEFORE UPDATE` 触发器上**：仍然是过程代码，仍然需要一个锚点才能判断"哪条投影引用了它"，且 `UPDATE` 成员关系的种类在真实流程里意味着"内容换了"，那本身就应当是新成员关系而不是改种类。
3. **把投影建成按成员关系（`item_external_id`）键控**：在"一个工作区一个 Planning 事实源"（`AGENTS.md` §1.1 不变量 1）下与按实体键控等价，但会改变 `getPlanningProjection` 的入参并波及 core 与 client；收益与方案 1 相同。

**重新评估的触发条件**：真实 provider 切片里出现推导实现后，若发现"种类标错"确实是可达且代价高的缺陷（例如它会让规划状态写回错误的对象），按本 ADR 的 Alternatives 重新评估。
