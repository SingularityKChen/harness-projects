# ADR-0006：连接锚点与工作区挂载分开，外部身份的键形状不变

> 状态：Proposed
> 日期：2026-09-24
> 来源：`docs/exec-plan/completed/2026-09-23-storage-identity-membership.md`（L2 / #27）、PR #122 的 2026-09-24 评审意见、用户裁定（2026-09-24；批准者 handle 与批准位置待人类伙伴确认，范围＝采用本 ADR 方案，不裁定「一个库一个工作区」）

## Context

`002_identity_membership.sql` 早先把外部身份的键定为 `(binding_id, external_kind, external_id)`（ADR-0001），并让 `binding_id` 引用 `provider_binding`，而 `provider_binding.workspace_id` 是 `NOT NULL`——**一个绑定只能属于一个工作区**。

这三件事因此无法同时成立：

1. ADR-0001 的 Consequences 写着「内容身份可以跨工作区复用：同一个对象加入第二个工作区不产生第二条内容身份」；
2. Gate E1 行为 1 要求「同一外部对象出现在两个工作区时，产生一条外部身份、两条成员关系、每个工作区一条投影」，该行为已判 `pass`（裁决 §2.1）；
3. `AGENTS.md` §1.1 不变量 6 要求工程产物关系沿谱系传播、不反复重新识别。

评审在内存 SQLite 上独立复现（依次执行 001 + 002）：

```text
REJECTED  同一绑定 id 挂到第二个工作区 :: UNIQUE constraint failed: provider_binding.id
ACCEPTED  A 下登记 I_shared
ACCEPTED  B 下再登记同一个 I_shared（只能挂 B 自己的绑定）
    identity rows for I_shared: 2 | distinct entities: 2
```

即：同一对象进入第二个工作区必然得到**第二条身份与第二个实体**，正是不变量 6 所说的「反复重新识别」。issue #27 的 Scope 明列了 connector accounts（跨工作区的连接锚点），002 既没有建，也没有在任何地方登记为推迟。

**根因不是「少建了一张表」，而是 `provider_binding` 同时装着两个作用域不同的事实**：「与某个 provider 账号之间的一条连接」（跨工作区）与「某工作区启用了它」（工作区作用域）。键挂在这张表上时，两个作用域就被强制合并成一个。

## Decision

**把两个事实拆开，`external_identity` 的键形状逐字不变。**

- `provider_binding(id, implementation_key)` 收窄为**连接锚点**：`id` 由调用方给定，同一个 `id` 就是同一条连接，可被多个工作区挂载。
- 新增 `workspace_binding(workspace_id, binding_id, domain, enabled, is_default)` 承载**工作区挂载**；`workspace_binding` 是工作区作用域的唯一权威，两条部分唯一索引（启用的 planning 挂载、启用的默认挂载）都落在它上面。
- `external_identity` 继续用 `(binding_id, external_kind, external_id)`，`binding_id` 现在指向连接锚点——因此同一对象跨工作区只有一条身份、一个实体，行为 1 在库层面成立。
- 端口形状不变：`ProviderBindingRecord` 仍是「某工作区挂载了哪条连接」的视图（`id` / `workspaceId` / `domain` / `implementationKey` / `enabled` / `isDefault`），`putProviderBinding` / `listProviderBindings` 的签名不动，只有语义被写清（见 `packages/capabilities/src/storage.ts`）。

**为什么不需要新的门禁裁定**：三条权威文档指向同一个形状——#27 的 Scope 要求 connector accounts、ADR-0001 的 Consequences 要求跨工作区复用、裁决 §2.1 已把行为 1 判 `pass`；而裁决 R1 的「`external_identity` 的键形状不变」在本决定下**逐字成立**。本决定是把已采纳的要求落地，不是改写它们。

## Alternatives

1. **由人类裁定「一个库只放一个工作区」并删掉多工作区键**：实现上最省，但它要撤回一条已判 `pass` 的行为、ADR-0001 的 Consequences 与不变量 6 的跨工作区谱系复用能力，属于**反向裁定**——采纳权在人类伙伴，不在 agent。用户于 2026-09-24 明确选择本 ADR 的方案（批准者与批准位置待人类伙伴确认，范围见文首「用户裁定」）。
2. **把键换成 `(connector_account_id, external_kind, external_id)`（另建一张 connector account 表）**：效果与本决定相同，但它改动了 `external_identity` 的键形状，使裁决 R1 的字面表述失效，从而需要一次门禁裁定。本决定用「`provider_binding` 即连接锚点」避免了这次裁定，代价是 `provider_binding` 的名字要按「连接」而不是「工作区绑定」来读。
3. **保持现状，把 connector accounts 登记为带收口条件的推迟项**：缺陷从「静默」变成「已登记」，但行为 1 仍未落地，而 L3–L6 正在这组键上继续建表——推迟的成本随层数增长。用户否决。

## Consequences

- **行为 1 在库层面成立，但有一个前提**（2026-09-24 评审补登）：同一连接 + 同一对象在两个工作区 → 一条 `external_identity`、一个 `entity`、两条 `project_item_membership`、每工作区一行 `workspace_projection`。**前提是"同一个 provider 账号只登记一条连接锚点"**——`provider_binding.id` 由调用方给定，表里没有账号级自然键（host / 账号 / installation），两个工作区为同一账号各建一条锚点时库照样全部接受，同一对象就会得到两条身份与两个实体，正是本 ADR 要消除的"反复重新识别"。收口条件＝真实 provider 切片为锚点加上账号自然键与唯一约束（见下方"未收口"）。**判别性用例在本层只跑内存替身**：SQLite 端口实现要到 L4（地基组）与 L5/L6（同步组）才注册同一套；002 本身由 `tests/integration/identity-membership-schema.test.js` 直接断言。
- **`provider_binding` 的读法变了**：任何直接读 `provider_binding.workspace_id` / `domain` / `enabled` / `is_default` 的代码必须改读 `workspace_binding`（L4–L6 的 SQLite 适配器）。
- **`putProviderBinding` 多了一条拒绝**：同一个 `id` 换 `implementationKey` 必须被拒绝——同一条连接不可能通向两个 provider 实现。这条由端口写入逻辑保证（本合并点只有内存替身实现，SQLite 侧在 L4 落地时按同一规则写），**不是库级约束**：裸 `UPDATE provider_binding SET implementation_key = …` 实测被接受（2026-09-24 评审）。`implementationKey` 的含义因此必须写清：它是 **provider 实现标识**，不是能力域。core 目前传的是域（`packages/core/src/registry.ts` 的 `implementationKey: domain`），于是同一条连接无法在同一工作区里服务两个域——这是 core 的缺陷，**本轮不修**，由 #197 承载（收口条件＝core 传入真实实现标识，或端口放弃这条拒绝）。**该缺陷已按前一种条件收口，见下段。**

  **已收口（2026-10-02，#197，`docs/exec-plan/completed/2026-10-01-provider-binding-registration.md`）**：四个外部 port 必需静态 `definition`（`implementationKey` + `domains`，由实现作者声明，Core 不从域、类名或平台名推断）；`collectBindings` 先静态校验、再收集并按挂载域切片全部快照，用 `providerRegistry` 在写前验证整批，最后只在**一个** `storage.transaction` 里写工作区与全部挂载，ack 之后才发布 Registry。同 id 同 key 跨域是两个合法挂载；同 id 异 key 在同一批内由 Core 写前拒绝，与既有锚点冲突时由 Storage 权威拒绝并整批回滚；同 `(工作区, id, 域)` 重复是组装错误，不覆盖持久化的一行。命令门携带完整挂载，写目标与链读不再按裸 id 重找，执行取消回到签发它的 Execution 挂载。账号自然键与下方 `SyncCursorRecord` 等「未收口」项原文不变。
- **「恰好一个 primary」仍不在库层面**：库保「至多一个」（部分唯一索引），生命周期保「恰好一个」（`ensureEntity` 建实体即建 primary、`promoteDraftToIssue` 保持恰好一个），后者由 `tests/e2e/chain-bootstrap.test.js` 的生命周期断言钉住。**订正 2026-09-24（评审）**：原文的理由「issue #27 验收 3 的措辞不含『由数据库拒绝』」不成立——#27 的 Scope 明确要求把不变量编码进数据库，且 `DEFERRABLE INITIALLY DEFERRED` 外键可以表达它。真实理由是代价：声明式表达要求 `putEntity` 与 primary 身份在同一事务里写入（端口语义变化）并改写套件里独立的 `putEntity` 前置，不是 `Entity` 加列；收口条件＝L2 / L4 代码预算允许时，或六层重新划分尺寸时。
- **按 `bindingId` 取键的工作区级事实（2026-09-24 评审补登）**：连接变成跨工作区共享之后，端口里凡是按 `bindingId` 取键、语义上属于工作区的记录都必须逐个判定作用域。**本表只写本合并点存在的端口记录**；`webhook_subscription` 一行与 003 的键形状移到 L3 的 ADR 或 L3 计划。逐条结论：

  | 端口记录 | 作用域 | 结论 |
  |---|---|---|
  | `SyncCursorRecord`（`getSyncCursor(workspaceId, bindingId, scopeKey)`） | **工作区级** | 连接级键会串台：ws-1 同步失败写 `degraded`，ws-2 随后成功写 `healthy`，ws-1 就显示 `healthy`（core 的 freshness 只读这一处，`packages/core/src/queries.ts` 的 `syncSummary`）。**已收口（2026-10-03，#189，`docs/exec-plan/active/2026-10-03-workspace-sync-scope.md`）**：记录带必需 `workspaceId`，SQLite 主键 `(workspace_id, binding_id, scope_key)`，工作区与连接两条外键各自独立、只证明父行存在，不证明已挂载（游标无 domain，连不到带 domain 的挂载键）；Core 成功事务、失败结算与 `syncSummary` 都显式传 `context.workspaceId`。旧两元主键的实验库在打开时由 `assertRewritten003Shape` 拒绝并关闭句柄，不升级也不删库。证据：`tests/integration/workspace-sync-scope.test.js` 经 `composeCore` 在 Fake 与 SQLite 上跑两种失败时序与并发结算，A 都保持 degraded、B 的结算不恢复 A，并覆盖文件库重开与事务回滚；共享契约「同步游标：同连接同scope跨workspace隔离」与旧形状拒绝用例（`tests/integration/storage-sync-surface.test.js`）各自钉住键与守卫；终树负对照逐项变红，见该计划 Progress |
  | 观察账本（`recordObservation`） | **连接级** | 端口的去重键 `(bindingId, dedupeKey)` 与定序主体 `subject` 都是连接级的，账本因此按连接记账。代价是两个工作区共用一条连接时共享处理状态，收口条件＝第一个多工作区宿主路径出现之前（#189 之前写作「同上」，指游标行的同一条件；没有承接 issue，登记为 `docs/exec-plan/tech-debt-tracker.md` 的 TD-022） |
  | `MutationAttemptRecord` | 工作区级 | 端口的键含 `workspaceId`，作用域一致 |

- **未收口**：连接锚点的 `implementation_key` 之外没有账号级元数据（账号名、权限范围）；真实 provider 切片需要时再加列，发布前可整份重写（控制计划 D10）。
