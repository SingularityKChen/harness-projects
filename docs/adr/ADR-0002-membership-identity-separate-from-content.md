# ADR-0002：成员关系身份与内容身份分离，成员关系落在独立的工作区作用域表

> 状态：Proposed
> 日期：2026-09-21
> 来源：`docs/exec-plan/completed/2026-09-21-gate-e1-ruling.md`（Batch 1，issue #25）；证据见 `docs/architecture/gate-e1-content-identities.md`（E1-1 / #22）与 `docs/architecture/gate-e1-membership-and-draft.md`（E1-2 / #23）

## Decision

1. **内容身份**落在 `external_identity`，键为 `(binding_id, external_kind, external_id)`，**故意不含** `workspace_id`（见 ADR-0001）。
2. **成员关系**不是内容身份，落在独立表 `project_item_membership(workspace_id, project_external_id, item_external_id, content_external_kind, content_external_id, …)`，唯一约束为 `UNIQUE(workspace_id, project_external_id, item_external_id)` 与 `UNIQUE(workspace_id, project_external_id, content_external_kind, content_external_id)`。
3. `ProjectV2Item` **不**加入 `ExternalIdentityKind`。
4. 规划字段值、条目顺序、同步观察三者的外键都指向 `project_item_membership.item_external_id`，不指向 `external_identity`。**Superseded（2026-09-24，第三轮评审；2026-09-26 订正为只划掉同步观察一项）**：同步观察一项不再成立——观察账本已改为以**端口主体** `(binding, objectKind, externalId)` 为键、作用域是连接，因此它不引用成员关系——条目 id 是会被改写的当前挂载点，放进只追加账本的身份键会让定序主体随成员关系漂移。见 `packages/storage/sqlite/migrations/003_control_facts.sql` 的 `sync_observation` 注释。规划字段值与条目顺序两项不变。

## Why

它保护的不变量是"同一个底层对象只有一条内容身份，而它的工作区侧状态按工作区各自持有"。实测：

- E1-2 实验 1 §4：同一个内容 id `I_kwDOUjWAl88AAAABST4Wtw` 对应两条成员关系（`PVTI_lAHOAY1ahM4BkJ9rzg75k64` / `PVTI_lAHOAY1ahM4BkJ9szg75k8c`），两条的 `createdAt` 不同（`06:59:14Z` / `06:59:18Z`），内容侧 `projectItems.totalCount = 2`；对两条分别写入 Status 后，两条独立读回路径各自返回写入值（A = In Progress、B = Done），互不覆盖。
- E1-1 实验 1 §4：成员关系 id 与内容 id 没有公共前缀（`PVTI_*` 对 `I_*`），时间戳是两套——成员关系的 `createdAt` 是"加入 project"的时刻，内容的 `createdAt` 是"对象被创建"的时刻；该条目的 3 个 `fieldValues` 全部挂在成员关系上，没有一个挂在内容上。

**为什么不能把成员关系登记成 `external_identity` 行**：成员关系是工作区作用域的（上面第一条实测），而 `external_identity` 的键故意不含工作区（第二条实测 + `packages/domain/src/identity.ts` 的 `externalObjectKey`）。把成员关系塞进该表，就必须给它加 `workspace_id`，于是同一个内容对象在两个工作区会产生两条内容身份——直接违反 issue #4 第 1 条。E1-2 实验 1 §5 末段已给出同一结论。

## Rejected

- **把 `ProjectV2Item` 加进 `ExternalIdentityKind`**：要求 `external_identity` 的键带工作区，从而复制内容身份。这也是本裁决对 E1-3 实验 1 §5 与实验 3 §5 的 `external_identity (kind=ProjectV2Item)` 行的处理依据（见 `docs/architecture/gate-e1-ruling.md` §6.1）。
- **把两条成员关系合并成一行**：两条成员关系的 id 与 `createdAt` 各自独立，且字段值互不覆盖，合并会丢掉工作区维度的规划状态。
- **把规划字段值挂到内容身份上**：实测 3 个 `fieldValues` 全部在成员关系上（E1-1 实验 1 §4），挂到内容上会让两个工作区共用一份规划状态。
- **让成员关系 id 复用一个通用"外部对象"表**：需要在该表里再加一个作用域判别列，等价于把两张表的键混在一张表里，代价高于独立表。

## Consequences

- `external_identity` 的键形状保持不变，ADR-0001 不受影响。
- `planning_field_value`、条目顺序表、`sync_observation` 的外键目标是成员关系，不是内容身份；成员关系被移除时这三处随外键处理，内容身份保留。**Superseded（2026-09-24）**：`sync_observation` 不再属于这一条（见上），其余两处不变。
- 对账的最小作用域是 `(workspace, project, content)`，与第二条唯一约束同形（E1-3 实验 3 §4.2 实测 `(project, content)` 在平台侧唯一）。
- 工作区投影按 `(workspace_id, entity_id)` 各记一行；实体表仍由内容身份派生。
- 尚未观测的形态（成员关系被移除或归档、`REDACTED` 条目类型）落地前，不得给本表增加"成员关系必然长期存在"的假设（见 `docs/architecture/gate-e1-sandbox.md` §8、`docs/architecture/gate-e1-ruling.md` §8）。
