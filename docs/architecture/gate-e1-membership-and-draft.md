# Gate E1 多项目成员关系与 Draft 转换观测

> 本文件记录 Gate E1 的两条实验：同一个 issue 同时出现在两个 project 时成员关系与规划字段值是什么形状，以及一个 draft 被转换成真实 issue 后哪些 id 变了、哪些没变。
> 沙箱的对象清单、创建 / 重建 / 拆除步骤与九字段模板见 [gate-e1-sandbox.md](gate-e1-sandbox.md)；沙箱级 `$E1_*` 变量在那里赋值一次，这里只引用。本批次自己的夹具变量见 §2.2（沙箱定义没有为它们定义变量）。
> 全部观测来自 2026-09-21 对 GitHub.com 真实 API 的调用。**没有一条结论来自记忆或推断**：字段缺失按缺失记录，取不到的字段给出报错原文。

## 1. 这两条实验判定什么

判定目标是下面这句话，它必须在真实平台上成立，而不是只在设计文档里成立：

> 一个底层对象改变成员关系（进入第二个 project）时，**内容身份不变**，新增的只是一条成员关系；改变自身形态（draft → issue）时，**成员关系身份不变**（id 与 `createdAt` 逐字节相同），变的是外部内容 id（`DI_*` → `I_*`），旧的外部身份被降级为历史别名而不是被删除重建。两种场景下内部 `Entity`（工作项）都不变——它是唯一跨场景恒定的那一层。

两条实验各自回答一个子问题：

| 实验 | 子问题 | 结论摘要 | 判定 |
|---|---|---|---|
| 1 · 多项目成员关系与字段隔离 | 同一个 issue 在两个 project 里是几条成员关系、几条内容身份？两个工作区的规划字段值会不会互相覆盖？ | 1 条内容身份、2 条成员关系（id 与 `createdAt` 各自独立）；写入不同 Status 后两条读回路径都返回各自的值 | pass |
| 2 · Draft 转换前后的身份变化 | 转换后成员关系 id 与内容 id 各是什么？"内部工作项 id 不变"如何判定？ | 成员关系 id 与 `createdAt` **没变**，内容 id 与 `type` **变了**，旧 `DI_*` 立即不可解析；内部工作项 id 按"解析到同一条内容身份"判定为不变 | pass |

## 2. 本批次用到的对象

### 2.1 沙箱级对象

| 对象 | 引用 |
|---|---|
| 仓库 | `$E1_OWNER/$E1_REPO`，node id `R_kgDOUjWAlw` |
| Project A | `$E1_PROJECT_A`（number 11），node id `$E1_PROJECT_A_ID` |
| Project B | `$E1_PROJECT_B`（number 12），node id `$E1_PROJECT_B_ID` |

赋值与重建步骤在 [gate-e1-sandbox.md](gate-e1-sandbox.md) §2、§4。

### 2.2 本批次夹具

夹具与 E1-1 的三个内容夹具（issue-alpha / draft-beta / pr-gamma）以及 E1-3 的可写夹具互不重叠；沙箱定义 §2.3 已经把 `issue-shared` 与 `draft-convert` 的所有权标为 E1-2。沙箱定义 §2.1 没有为这两个夹具定义变量，因此**本文件是它们的唯一赋值处**，后续引用只写变量名：

```bash
E1_ISSUE_SHARED=I_kwDOUjWAl88AAAABST4Wtw            # issue-shared 的内容 id（编号 2）
E1_ITEM_SHARED_A=PVTI_lAHOAY1ahM4BkJ9rzg75k64      # issue-shared 在 Project A 的成员关系
E1_ITEM_SHARED_B=PVTI_lAHOAY1ahM4BkJ9szg75k8c      # issue-shared 在 Project B 的成员关系
E1_ITEM_CONVERT=PVTI_lAHOAY1ahM4BkJ9rzg75lAw       # draft-convert 在 Project A 的成员关系
E1_DRAFT_CONVERT=DI_lAHOAY1ahM4BkJ9rzgLKQZ0        # draft-convert 转换前的内容 id
E1_ISSUE_CONVERT=I_kwDOUjWAl88AAAABSUC8og          # draft-convert 转换后的内容 id（编号 6）
E1_STATUS_FIELD_A=PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY   # Project A 的 Status 字段（同沙箱定义 §2.4）
E1_STATUS_FIELD_B=PVTSSF_lAHOAY1ahM4BkJ9szhi7jXQ   # Project B 的 Status 字段
```

| 引用名 | 种类 | 位置 | 成员关系 id | 成员关系 `createdAt` |
|---|---|---|---|---|
| `issue-shared` | Issue（`#2`） | `$E1_PROJECT_A` + `$E1_PROJECT_B` | `$E1_ITEM_SHARED_A` / `$E1_ITEM_SHARED_B` | 2026-09-21T06:59:14Z / 2026-09-21T06:59:18Z |
| `draft-convert` | DraftIssue | `$E1_PROJECT_A` | `$E1_ITEM_CONVERT` | 2026-09-21T06:59:28Z |

两个夹具的标题与正文见沙箱定义 §2.3；本文件不重复它们。

### 2.3 两个 project 的 Status 字段

沙箱定义 §2.4 只列出 Project A 的字段。Project B 的 Status 字段实测为另一个 id，但可选值 id 与 A 相同：

| project | Status 字段 id | 可选值（名称 → optionId） |
|---|---|---|
| `$E1_PROJECT_A` | `$E1_STATUS_FIELD_A` | Todo → `f75ad846`；In Progress → `47fc9ee4`；Done → `98236657` |
| `$E1_PROJECT_B` | `$E1_STATUS_FIELD_B` | Todo → `f75ad846`；In Progress → `47fc9ee4`；Done → `98236657` |

## 3. 两条实验记录

下面两节按 [gate-e1-sandbox.md](gate-e1-sandbox.md) §6 的九字段模板逐条填写，字段顺序固定、编号即模板编号。

### 实验 1 · 多项目成员关系与字段隔离

**1 · 实验编号与目的**：实验 1。判定"同一个底层 issue 进入第二个工作区时，平台给出的是 1 条内容身份 + 2 条成员关系，且两个工作区的规划字段值互不覆盖"（issue #4 第 1 条、issue #23 验收条件 1、2）。

**2 · 夹具**：issue-shared（`$E1_ISSUE_SHARED`，编号 2），它在 `$E1_PROJECT_A` 里的成员关系是 `$E1_ITEM_SHARED_A`、在 `$E1_PROJECT_B` 里的是 `$E1_ITEM_SHARED_B`。夹具见 §2.2，字段见 §2.3。

**3 · 请求**：

```bash
# 基线：一条内容 id 是否对应两条成员关系
gh api graphql -f query='
query($projectA: ID!, $projectB: ID!, $issue: ID!) {
  a: node(id: $projectA) { ... on ProjectV2 { number items(first: 20) { totalCount nodes {
    id createdAt type
    content { __typename ... on Issue { id number } }
    fieldValues(first: 20) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2SingleSelectField { id name } } } } } } } } }
  b: node(id: $projectB) { ... on ProjectV2 { number items(first: 20) { totalCount nodes {
    id createdAt type
    content { __typename ... on Issue { id number } }
    fieldValues(first: 20) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2SingleSelectField { id name } } } } } } } } }
  issue: node(id: $issue) { ... on Issue { id number projectItems(first: 10) { totalCount nodes { id project { id number } } } } }
}' -f projectA="$E1_PROJECT_A_ID" -f projectB="$E1_PROJECT_B_ID" -f issue="$E1_ISSUE_SHARED" \
  --jq '{a: [.data.a.items.nodes[] | select(.content.id == "'"$E1_ISSUE_SHARED"'") | {item: .id, createdAt, project: 11, status: (.fieldValues.nodes[] | select(.name != null) | {name, optionId, field: .field.id})}], b: [.data.b.items.nodes[] | select(.content.id == "'"$E1_ISSUE_SHARED"'") | {item: .id, createdAt, project: 12, status: (.fieldValues.nodes[] | select(.name != null) | {name, optionId, field: .field.id})}], issue: {id: .data.issue.id, number: .data.issue.number, projectItems: .data.issue.projectItems.totalCount}}'

# 写 Project A = In Progress（47fc9ee4）
gh api graphql -f query='
mutation($project: ID!, $item: ID!, $field: ID!) {
  updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: "47fc9ee4" } }) {
    projectV2Item { id updatedAt } } }' \
  -f project="$E1_PROJECT_A_ID" -f item="$E1_ITEM_SHARED_A" -f field="$E1_STATUS_FIELD_A" \
  --jq '.data.updateProjectV2ItemFieldValue.projectV2Item'

# 写 Project B = Done（98236657）
gh api graphql -f query='
mutation($project: ID!, $item: ID!, $field: ID!) {
  updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: "98236657" } }) {
    projectV2Item { id updatedAt } } }' \
  -f project="$E1_PROJECT_B_ID" -f item="$E1_ITEM_SHARED_B" -f field="$E1_STATUS_FIELD_B" \
  --jq '.data.updateProjectV2ItemFieldValue.projectV2Item'

# 分别读回（按 item id 取节点）
gh api graphql -f query='
query($a: ID!, $b: ID!) {
  a: node(id: $a) { ... on ProjectV2Item { id updatedAt fieldValues(first: 20) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2SingleSelectField { id } } } } } } }
  b: node(id: $b) { ... on ProjectV2Item { id updatedAt fieldValues(first: 20) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2SingleSelectField { id } } } } } } }
}' -f a="$E1_ITEM_SHARED_A" -f b="$E1_ITEM_SHARED_B" \
  --jq '{a: (.data.a.fieldValues.nodes[] | select(.name != null) | {name, optionId, field: .field.id}), b: (.data.b.fieldValues.nodes[] | select(.name != null) | {name, optionId, field: .field.id})}'
```

**4 · 观测**（原文，只删了空白；id 字面量来自本次沙箱）：

共同基线——两条成员关系都停在 Todo，且指向同一个内容 id：

```json
{"a":{"content":"I_kwDOUjWAl88AAAABST4Wtw","createdAt":"2026-09-21T06:59:14Z","item":"PVTI_lAHOAY1ahM4BkJ9rzg75k64","project":"PVT_kwHOAY1ahM4BkJ9r","status":{"field":"PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY","name":"Todo","optionId":"f75ad846"}},"b":{"content":"I_kwDOUjWAl88AAAABST4Wtw","createdAt":"2026-09-21T06:59:18Z","item":"PVTI_lAHOAY1ahM4BkJ9szg75k8c","project":"PVT_kwHOAY1ahM4BkJ9s","status":{"field":"PVTSSF_lAHOAY1ahM4BkJ9szhi7jXQ","name":"Todo","optionId":"f75ad846"}},"issue":{"id":"I_kwDOUjWAl88AAAABST4Wtw","number":2,"projectItems":2}}
```

两次写入的返回（`projectV2Item` 只有 id 与 `updatedAt`，**平台不回显字段值**）：

```json
{"id":"PVTI_lAHOAY1ahM4BkJ9rzg75k64","updatedAt":"2026-09-21T07:16:13Z"}
{"id":"PVTI_lAHOAY1ahM4BkJ9szg75k8c","updatedAt":"2026-09-21T07:16:14Z"}
```

写入后按 item id 读回，两个工作区各自拿到自己写入的值：

```json
{"a":{"content":"I_kwDOUjWAl88AAAABST4Wtw","createdAt":"2026-09-21T06:59:14Z","item":"PVTI_lAHOAY1ahM4BkJ9rzg75k64","project":"PVT_kwHOAY1ahM4BkJ9r","status":{"field":"PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY","name":"In Progress","optionId":"47fc9ee4"}},"b":{"content":"I_kwDOUjWAl88AAAABST4Wtw","createdAt":"2026-09-21T06:59:18Z","item":"PVTI_lAHOAY1ahM4BkJ9szg75k8c","project":"PVT_kwHOAY1ahM4BkJ9s","status":{"field":"PVTSSF_lAHOAY1ahM4BkJ9szhi7jXQ","name":"Done","optionId":"98236657"}},"issue":{"id":"I_kwDOUjWAl88AAAABST4Wtw","number":2,"projectItems":2}}
```

再从 **project 一侧**（`ProjectV2.items` 连接，而不是按 item id 取节点）读回，结论相同：

```json
{"a":{"items":7,"project":11,"shared":[{"content":"I_kwDOUjWAl88AAAABST4Wtw","item":"PVTI_lAHOAY1ahM4BkJ9rzg75k64","status":{"field":"PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY","name":"In Progress","optionId":"47fc9ee4"}}]},"b":{"items":1,"project":12,"shared":[{"content":"I_kwDOUjWAl88AAAABST4Wtw","item":"PVTI_lAHOAY1ahM4BkJ9szg75k8c","status":{"field":"PVTSSF_lAHOAY1ahM4BkJ9szhi7jXQ","name":"Done","optionId":"98236657"}}]}}
```

汇总（观测时间窗 2026-09-21T06:59Z – 07:16Z）：

| 观测项 | `$E1_PROJECT_A` | `$E1_PROJECT_B` |
|---|---|---|
| 内容 `Issue.id` | `I_kwDOUjWAl88AAAABST4Wtw` | `I_kwDOUjWAl88AAAABST4Wtw` |
| 内容 `number` | 2 | 2 |
| 成员关系 id | `PVTI_lAHOAY1ahM4BkJ9rzg75k64` | `PVTI_lAHOAY1ahM4BkJ9szg75k8c` |
| 成员关系 `createdAt` | 2026-09-21T06:59:14Z | 2026-09-21T06:59:18Z |
| 成员关系 `type` | `ISSUE` | `ISSUE` |
| Status 字段 id | `PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY` | `PVTSSF_lAHOAY1ahM4BkJ9szhi7jXQ` |
| 写入的 Status | In Progress（`47fc9ee4`） | Done（`98236657`） |
| 读回的 Status | In Progress（`47fc9ee4`） | Done（`98236657`） |

内容侧 `projectItems.totalCount` 为 **2**，两条成员关系的 id 与上表一致：平台没有为第二个工作区复制内容对象，也没有为同一工作区生成第二条成员关系。Project A 的条目数 `7` 与沙箱定义 §4.1 的重建判据一致。

**5 · 本地应有行**：

按 `packages/domain` 已冻结的结构（`packages/domain/src/entities.ts`、`packages/domain/src/identity.ts`）落行。左列是领域结构名，括号里是本仓库架构文档使用的同义说法（沙箱定义与 E1-1 记录里用的是后者）：

| 结构（同义说法） | 键 | 行数 | 内容 |
|---|---|---|---|
| `Entity`（工作项表） | `id` | **1** | `{ id: E_shared, kind: work_item }` |
| `ExternalIdentity`（外部身份注册表） | `(bindingId, externalKind, externalId)` | **1** | `{ entityId: E_shared, externalKind: issue, externalId: I_kwDOUjWAl88AAAABST4Wtw, role: primary }` |
| 成员关系定位（成员关系表） | `(workspaceId, itemExternalId)` | **2** | `(A, PVTI_lAHOAY1ahM4BkJ9rzg75k64)`、`(B, PVTI_lAHOAY1ahM4BkJ9szg75k8c)` |
| `IdentityProjection`（投影） | `(workspaceId, identityId)` | **2** | `(A, ID_shared)`、`(B, ID_shared)`，两条的 `entityId` 都是 `E_shared` |
| `WorkspaceProjection`（工作区投影） | `(workspaceId, entityId)` | **2** | `(A, E_shared, planningStatus: in_progress)`、`(B, E_shared, planningStatus: done)` |

**计数：内容身份 1 条、成员关系 2 条、`IdentityProjection` 2 条、`WorkspaceProjection` 2 条、工作项 1 个。**

为什么是这些行：

1. 内容 id 只有一条，因此 `ExternalIdentity` 只有一行。`externalObjectKey` 里**没有** `workspaceId`：把工作区加进身份键就等于把同一个对象复制成两份身份（`packages/domain/src/identity.ts` 的 `externalObjectKey`；`tests/contract/domain-identity.test.js` 的"同一外部对象出现在两个工作区时，外部身份一份、投影两份"）。这与 E1-1 实验 1 的结论一致——内容身份的键里不含 project。
2. 两条成员关系各自有独立的 id 与 `createdAt`，且规划字段值挂在其上（本实验的两次写入互不覆盖即为证据），因此成员关系必须按 `(workspaceId, itemExternalId)` 各记一行，不能合并成一行。
3. 平台原始状态 In Progress / Done 经 `NormalizedStatus` 收敛为 `in_progress` / `done`（`packages/domain/src/enums.ts`）；规划状态属于工作区投影，因此 `WorkspaceProjection` 两行、值不同。

**成员关系这一行的落点是本实验暴露的模型缺口**：`ExternalIdentityKind` 目前只有 `draft` / `issue` / `change_request` / `branch` / `worktree` 五个取值，**没有**给 `ProjectV2Item` 留位置。也就是说成员关系的外部 id（`PVTI_*`）在当前冻结的领域模型里无法登记成 `ExternalIdentity`。本记录的立场是：成员关系不是内容身份，它的外部 id 需要一个独立于 `ExternalIdentity` 的落点（例如按 `(workspaceId, entityId, itemExternalId)` 存的成员关系记录）；具体落点由 E1-4 裁决，本批次不新增代码。在这条决定之前，"两条成员关系"只能按上表的形式记录，**不能**写成两行 `ExternalIdentity`——那会让同一个内容对象拥有两份身份，直接违反 issue #4 第 1 条。

**6 · 意外行为**：有，一条，且只观测到一次——**首轮写入后的读回出现了一次与写入值不符的结果；后续 8 轮（含 8 次重置写入）共 23 次字段写入—读回都没能复现。**

首轮原始时序（命令逐条执行，时间戳取自平台返回的 `updatedAt`）：

| 时刻（UTC） | 动作 | 平台返回 |
|---|---|---|
| 07:10:37Z | 写 `$E1_PROJECT_A` = In Progress（`47fc9ee4`） | `{"id":"PVTI_lAHOAY1ahM4BkJ9rzg75k64","updatedAt":"2026-09-21T07:10:37Z"}` |
| 07:10:42Z | 写 `$E1_PROJECT_B` = Done（`98236657`） | `{"id":"PVTI_lAHOAY1ahM4BkJ9szg75k8c","updatedAt":"2026-09-21T07:10:42Z"}` |
| 07:10:44Z | 读回两条成员关系 | A = **Done**（`98236657`，字段 id 仍是 A 的 `PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY`），`updatedAt` 2026-09-21T07:10:44Z；B = Done（`98236657`），`updatedAt` 2026-09-21T07:10:44Z |

即：A 在写入 In Progress 之后、B 写入 Done 之后，读回成了 Done，且 A 的 `updatedAt` 被推到读回那一刻；两条成员关系的 `updatedAt` 相同，都等于读回时刻。

后续复现尝试（每次都是"重置为 Todo → 写 A = In Progress → 写 B = Done → 读回"，或等价的单项写入）：

| 轮次 | 改变值的写入次数 | 结果 |
|---|---|---|
| 第 1 轮（先写 A，再对已为 Done 的 B 重写 Done） | 1 | A = In Progress，B = Done，互不覆盖 |
| 第 2 轮（写 B = Todo；再写 A = Done） | 2 | 两次都只有被写的那条变化，另一条不动 |
| 第 3 轮（写 A = In Progress；写 B = Done） | 2 | 互不覆盖 |
| 第 4、5 轮（同上，写入间隔 5s，读回延迟 2s 与 10s） | 4 | 互不覆盖 |
| 第 6、7、8 轮（读回查询额外取 `content` 与 `issue.projectItems`） | 6 | 互不覆盖 |

合计 8 轮、23 次字段写入（其中 15 次改变值、8 次重置）与读回，全部显示严格互不覆盖；"写 B 后 A 变 Done"这一形态一次都没有再出现。

最接近的解释类别已经由同沙箱的实测给出：沙箱定义 §4.2 记录过 `gh project item-add` 返回成功后、紧随其后的 `items` 查询少看到一条、约 3 秒后才补齐——**project 条目连接存在读后写延迟**。首轮的不一致出现在写入后 2 秒的读回，落在同一量级，属于同一类读路径延迟的候选解释。但本批次后续 8 轮重跑没能复现，因此**不把它写成已确认的机制**，只按未复现的单次观测登记，并附上完整时间戳。

判定取舍：issue #23 验收条件 2 的判定依据取**可复现**的后续 23 次字段写入—读回与 project 一侧的独立读回（**通过**）；首轮那一次不一致作为**未复现的单次观测**保留，交给 E1-4 与后续同步实现作为残余风险处理——它不能用来推翻可复现结论，也不能被当作不存在。

**7 · 决策影响**：

- **不改变** issue #23 Scope 里"不做跨工作区全局工作项聚合、每个工作区各看各的投影"这一选择：两条成员关系的字段值在可复现观测里互不覆盖，工作区级投影成立。
- **加强** `AGENTS.md` §1.1 第 7 条（Host 拥有权威状态，前端只是消费者）与实现级硬约束"外部写入得到 Provider ack / reconcile 前本地不得显示权威 `Saved`"：本实验里写请求的响应**不回显字段值**，只回 `id` 与 `updatedAt`，所以写入后必须靠一次显式读回来确认值；这正是"ack 不是值"的一个实例。
- **暴露一个模型缺口**：成员关系（`ProjectV2Item`）在当前冻结的 `ExternalIdentityKind` 里没有对应取值，需要 E1-4 决定它的落点（见第 5 项末段）。
- **字段值定位键必须带 project 作用域的字段 id**：两个 project 的 Status 字段 id 不同（`PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY` / `PVTSSF_lAHOAY1ahM4BkJ9szhi7jXQ`），但可选值 id 完全相同（`f75ad846` / `47fc9ee4` / `98236657`）。因此 `(optionId)` 不能作为字段值的定位键，`(projectId, fieldId)` 才能。可选值 id 相同这一点只记为观测；是否为 GitHub 内置默认选项的固定 id，本批次没有做跨项目对照实验，不作断言。
- **读后写延迟要进同步模型**：写入后的第一次读回不可当作权威（沙箱定义 §4.2 与本次未复现观测都指向这一点）。

**8 · 判定**：**pass**（issue #23 验收条件 1、2 通过）。依据：

1. 同一个内容 id `I_kwDOUjWAl88AAAABST4Wtw` 对应两条 `ProjectV2Item.id`，内容侧 `projectItems.totalCount = 2`，两条成员关系的 `createdAt` 不同（06:59:14Z / 06:59:18Z），说明平台把它们当作两条独立成员关系；
2. 对两条成员关系写入不同的 Status 值后，两条独立读回路径（按 item id 取节点、按 project 取 `items` 连接）都返回各自写入的值，互不覆盖；
3. "本地应有行"给出 1 条 `Entity` + 1 条 `ExternalIdentity` + 2 条成员关系 + 2 条 `IdentityProjection` + 2 条 `WorkspaceProjection`。

残余风险：第 6 项的单次未复现观测。它不影响上述判定，但必须在同步实现里被显式处理（写入后以读回为准，且读回失败时不提交投影）。

**9 · 复现**：前置条件是沙箱定义 §4.1 的重建判据通过（`$E1_PROJECT_A` 有 7 个条目、三种 `type` 齐全；`$E1_PROJECT_B` 有 1 个条目且是 issue-shared）。然后：

```bash
# 1) 确认夹具与两条成员关系仍在（§2.2 的表）
gh api graphql -f query='
query($issue: ID!) { node(id: $issue) { ... on Issue { id number projectItems(first: 10) { totalCount nodes { id project { id number } } } } } }' \
  -f issue="$E1_ISSUE_SHARED" \
  --jq '{id: .data.node.id, number: .data.node.number, projectItems: .data.node.projectItems.totalCount, itemIds: [.data.node.projectItems.nodes[] | .id]}'
# 期望：projectItems 2；itemIds 为 $E1_ITEM_SHARED_A 与 $E1_ITEM_SHARED_B

# 2) 共同基线：两条成员关系都置回 Todo（把第 3 项两条 mutation 的 singleSelectOptionId 换成 "f75ad846"）
# 3) 写入两个不同的值（第 3 项的两条 mutation）
# 4) 分别读回（第 3 项的两条读回查询），期望 A = In Progress、B = Done
# 5) 交叉验证：从 project 一侧读回
gh api graphql -f query='
query($projectA: ID!, $projectB: ID!, $issue: ID!) {
  a: node(id: $projectA) { ... on ProjectV2 { number items(first: 20) { nodes { id content { ... on Issue { id } } fieldValues(first: 20) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } } }
  b: node(id: $projectB) { ... on ProjectV2 { number items(first: 20) { nodes { id content { ... on Issue { id } } fieldValues(first: 20) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } } }
}' -f projectA="$E1_PROJECT_A_ID" -f projectB="$E1_PROJECT_B_ID" -f issue="$E1_ISSUE_SHARED" \
  --jq '{a: [.data.a.items.nodes[] | select(.content.id == "'"$E1_ISSUE_SHARED"'") | {item: .id, status: (.fieldValues.nodes[] | select(.name != null) | .name)}], b: [.data.b.items.nodes[] | select(.content.id == "'"$E1_ISSUE_SHARED"'") | {item: .id, status: (.fieldValues.nodes[] | select(.name != null) | .name)}]}'
```

在重建出来的沙箱里 id 字面量会不同，但两条**关系**必须成立：同一个内容 id 对应两条成员关系；两条成员关系的字段值互不覆盖。本实验全部是读与可重复的字段写入，重跑不产生新对象；重复写入只覆盖同一个字段值。若条目数比期望少，按沙箱定义 §8 先重查一次再判断。

### 实验 2 · Draft 转换前后的身份变化

**1 · 实验编号与目的**：实验 2。判定"draft 被提升为真实 issue 时哪些 id 变了、哪些没变"，并据此给出"内部工作项 id 不变"的可判定形式与历史别名的登记方式（issue #4 第 3 条、issue #23 验收条件 3、4、5）。

**2 · 夹具**：draft-convert（转换前 `$E1_DRAFT_CONVERT`），它在 `$E1_PROJECT_A` 里的唯一一条成员关系是 `$E1_ITEM_CONVERT`。转换**不可逆**，本批次只执行一次。夹具见 §2.2。

**3 · 请求**：

```bash
# 转换前：成员关系 + 内容 + 仓库
gh api graphql -f query='
query($item: ID!, $repo: ID!) {
  item: node(id: $item) { ... on ProjectV2Item {
    id createdAt updatedAt type isArchived project { id number title }
    content { __typename ... on DraftIssue { id title createdAt updatedAt creator { login } } }
    fieldValues(first: 20) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2SingleSelectField { id name } } } } } } }
  repo: node(id: $repo) { ... on Repository { id nameWithOwner isPrivate issues(first: 1) { totalCount } } }
}' -f item="$E1_ITEM_CONVERT" -f repo="R_kgDOUjWAlw"

# 转换前：旧的两个 id 都可解析
gh api graphql -f query='
query($draft: ID!, $item: ID!) {
  d: node(id: $draft) { __typename id ... on DraftIssue { title } }
  i: node(id: $item) { __typename id }
}' -f draft="$E1_DRAFT_CONVERT" -f item="$E1_ITEM_CONVERT"

# 转换（不可逆，只执行一次）
gh api graphql -f query='
mutation($item: ID!, $repo: ID!) {
  convertProjectV2DraftIssueItemToIssue(input: { itemId: $item, repositoryId: $repo }) {
    item { id createdAt updatedAt type project { id number title } content { __typename ... on Issue { id number title } } } } }' \
  -f item="$E1_ITEM_CONVERT" -f repo="R_kgDOUjWAlw"

# 转换后：独立读回成员关系与新内容
gh api graphql -f query='
query($item: ID!) {
  node(id: $item) { ... on ProjectV2Item {
    id createdAt updatedAt type project { id number title }
    content { __typename ... on Issue { id number title createdAt updatedAt repository { id nameWithOwner } } }
    fieldValues(first: 20) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2SingleSelectField { id name } } } } } } }
}' -f item="$E1_ITEM_CONVERT"

# 转换后：旧 draft id 是否仍可解析
gh api graphql -f query='query($draft: ID!) { node(id: $draft) { __typename id } }' -f draft="$E1_DRAFT_CONVERT"

# 转换后：新 issue 从仓库一侧可达
gh api graphql -f query='
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    issues(first: 10, orderBy: {field: CREATED_AT, direction: ASC}) { totalCount nodes {
      number id title projectItems(first: 5) { totalCount nodes { id project { id number } } } } }
    pullRequests(first: 5) { nodes { number id } } } }' -f owner="$E1_OWNER" -f repo="$E1_REPO"
```

`ConvertProjectV2DraftIssueItemToIssueInput` 只有 `itemId` 与 `repositoryId` 两个必填字段（`clientMutationId` 可选，实测该类型只有这三个 input field），payload 只回 `item`。

**4 · 观测**（原文，只删了空白）：

转换前（夹具创建于 2026-09-21T06:59Z，转换前读回在 07:17Z）：

```json
{"item":{"contentTypename":"DraftIssue","createdAt":"2026-09-21T06:59:28Z","draftCreatedAt":"2026-09-21T06:59:28Z","draftId":"DI_lAHOAY1ahM4BkJ9rzgLKQZ0","draftTitle":"fixture convert (draft to issue)","id":"PVTI_lAHOAY1ahM4BkJ9rzg75lAw","isArchived":false,"project":"PVT_kwHOAY1ahM4BkJ9r","status":{"field":"PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY","name":"Todo","optionId":"f75ad846"},"type":"DRAFT_ISSUE","updatedAt":"2026-09-21T06:59:29Z"},"repo":{"id":"R_kgDOUjWAlw","isPrivate":true,"issueCount":4,"nameWithOwner":"SingularityKChen/e1-sandbox"}}
```

转换前旧的两个 id 都可解析：

```json
{"draftNode":{"__typename":"DraftIssue","id":"DI_lAHOAY1ahM4BkJ9rzgLKQZ0","title":"fixture convert (draft to issue)"},"itemNode":{"__typename":"ProjectV2Item","id":"PVTI_lAHOAY1ahM4BkJ9rzg75lAw"}}
```

转换调用的返回（2026-09-21T07:18:02Z）：

```json
{"data":{"convertProjectV2DraftIssueItemToIssue":{"item":{"id":"PVTI_lAHOAY1ahM4BkJ9rzg75lAw","createdAt":"2026-09-21T06:59:28Z","updatedAt":"2026-09-21T07:18:02Z","type":"ISSUE","project":{"id":"PVT_kwHOAY1ahM4BkJ9r","number":11,"title":"E1 Project A"},"content":{"__typename":"Issue","id":"I_kwDOUjWAl88AAAABSUC8og","number":6,"title":"fixture convert (draft to issue)"}}}}}
```

转换后独立读回（不依赖转换调用的返回）：

```json
{"item":{"contentCreatedAt":"2026-09-21T07:18:01Z","contentId":"I_kwDOUjWAl88AAAABSUC8og","contentTypename":"Issue","contentUpdatedAt":"2026-09-21T07:18:01Z","createdAt":"2026-09-21T06:59:28Z","id":"PVTI_lAHOAY1ahM4BkJ9rzg75lAw","number":6,"project":"PVT_kwHOAY1ahM4BkJ9r","repo":"R_kgDOUjWAlw","status":{"field":"PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY","name":"Todo","optionId":"f75ad846"},"title":"fixture convert (draft to issue)","type":"ISSUE","updatedAt":"2026-09-21T07:18:02Z"}}
```

转换后旧的 DraftIssue id **不再可解析**：

```json
{"data":{"d":null},"errors":[{"type":"NOT_FOUND","path":["d"],"locations":[{"line":2,"column":10}],"message":"Could not resolve to a node with the global id of 'DI_lAHOAY1ahM4BkJ9rzgLKQZ0'."}]}
```

新 issue 从仓库一侧可达，并指向**同一条**成员关系：

```json
{"issueCount":5,"nodes":[{"id":"I_kwDOUjWAl88AAAABST4WDQ","itemIds":["PVTI_lAHOAY1ahM4BkJ9rzg75k2w"],"number":1,"projectItems":1,"title":"fixture alpha (issue-backed membership)"},{"id":"I_kwDOUjWAl88AAAABST4Wtw","itemIds":["PVTI_lAHOAY1ahM4BkJ9rzg75k64","PVTI_lAHOAY1ahM4BkJ9szg75k8c"],"number":2,"projectItems":2,"title":"fixture shared (multi-project membership)"},{"id":"I_kwDOUjWAl88AAAABST4XVQ","itemIds":["PVTI_lAHOAY1ahM4BkJ9rzg75k-I"],"number":3,"projectItems":1,"title":"fixture writable (field writes)"},{"id":"I_kwDOUjWAl88AAAABST4X6Q","itemIds":["PVTI_lAHOAY1ahM4BkJ9rzg75lGI"],"number":4,"projectItems":1,"title":"fixture dupe (duplicate add)"},{"id":"I_kwDOUjWAl88AAAABSUC8og","itemIds":["PVTI_lAHOAY1ahM4BkJ9rzg75lAw"],"number":6,"projectItems":1,"title":"fixture convert (draft to issue)"}]}
```

仓库的 change request 编号未受影响（`[{"id":"PR_kwDOUjWAl88AAAABEYNntg","number":5}]`）。

逐项"变了/没变"：

| 观测项 | 转换前 | 转换后 | 结论 |
|---|---|---|---|
| 成员关系 id | `PVTI_lAHOAY1ahM4BkJ9rzg75lAw` | `PVTI_lAHOAY1ahM4BkJ9rzg75lAw` | **没变** |
| 成员关系 `createdAt` | 2026-09-21T06:59:28Z | 2026-09-21T06:59:28Z | **没变** |
| 成员关系 `updatedAt` | 2026-09-21T06:59:29Z | 2026-09-21T07:18:02Z | 变了 |
| 成员关系 `type` | `DRAFT_ISSUE` | `ISSUE` | 变了 |
| 内容 `__typename` | `DraftIssue` | `Issue` | 变了 |
| 内容 id | `DI_lAHOAY1ahM4BkJ9rzgLKQZ0` | `I_kwDOUjWAl88AAAABSUC8og` | **变了** |
| 内容 `number` | 不存在 | 6 | 新增 |
| 内容 title | `fixture convert (draft to issue)` | `fixture convert (draft to issue)` | **没变** |
| 内容 `createdAt` | 2026-09-21T06:59:28Z | 2026-09-21T07:18:01Z | 变了 |
| 所属 project | `PVT_kwHOAY1ahM4BkJ9r`（number 11） | `PVT_kwHOAY1ahM4BkJ9r`（number 11） | **没变** |
| Status 字段值与字段 id | Todo（`f75ad846`），字段 `PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY` | Todo（`f75ad846`），字段 `PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY` | **没变** |
| 旧 `DI_*` id 的可解析性 | 可解析（`DraftIssue`） | 不可解析（`NOT_FOUND`） | 变了 |

新 issue 的 `number` 是 **6** 而不是 5：仓库里 `PR_kwDOUjWAl88AAAABEYNntg` 已占用编号 5，issue 与 change request 共用同一套编号（转换前仓库 `issues.totalCount = 4`，转换后为 5）。

**5 · 本地应有行**：

按 `packages/domain/src/identity.ts` 的 `promoteDraftToIssue` 语义落行：

| 结构（同义说法） | 键 | 转换前 | 转换后 | 内容 |
|---|---|---|---|---|
| `Entity`（工作项表） | `id` | 1 行 | **1 行（同一条）** | `{ id: E_convert, kind: work_item }`；转换不新建实体 |
| `ExternalIdentity`（外部身份注册表） | `(bindingId, draft, DI_lAHOAY1ahM4BkJ9rzgLKQZ0)` | 1 行，`role: primary` | 同一行，`role: historical`（`id` 与 `entityId` 不变） | 旧 draft 身份降级为历史别名 |
| `ExternalIdentity`（外部身份注册表） | `(bindingId, issue, I_kwDOUjWAl88AAAABSUC8og)` | 0 行 | 1 行，`role: primary` | 新身份，`externalKind: issue` |
| `activePrimary` | 按 `entityId` 过滤 | 1 行（draft） | **1 行（issue）** | 同一实体任一时刻只有一个 active primary |
| 成员关系定位（成员关系表） | `(workspaceId, itemExternalId)` | `(A, PVTI_lAHOAY1ahM4BkJ9rzg75lAw)` | **同一行** | 成员关系 id 没变，无需更新 |
| `IdentityProjection`（投影） | `(workspaceId, identityId)` | 1 行 | 1 行（同一行） | 投影指向 `E_convert`，不因内容 id 变化而新增 |
| `WorkspaceProjection`（工作区投影） | `(workspaceId, entityId)` | `(A, E_convert, todo)` | **同一行** | 转换不改规划状态：Status 仍是 Todo |

**计数：转换后工作项 1 个、外部身份 2 条（1 historical + 1 primary）、active primary 1 条、成员关系 1 条、投影 1 条、工作区投影 1 条。**

**"内部工作项 id 不变"的判定**（按 ExecPlan 的 D4 操作定义）：D4 的定义是——转换前后两条观测解析到**同一个 Entity**（内部工作项），因此解析出的内部工作项 id 相同；判定证据是"转换后的新内容身份与转换前的历史身份共同指向同一个 Entity，而不是新建一个 Entity"。本实验按这条定义逐步核对：

1. 转换前，`(bindingId, draft, DI_lAHOAY1ahM4BkJ9rzgLKQZ0)` 是实体 `E_convert` 的 primary 身份；
2. 转换后平台给出的新内容 id 是 `I_kwDOUjWAl88AAAABSUC8og`，它登记为**同一个** `E_convert` 的 primary 身份，而不是新建一个实体；
3. 旧 draft 身份保留原 `ExternalIdentityId` 与 `entityId`，只把 `role` 降为 `historical`；
4. 因此"转换前解析出的内部工作项 id"与"转换后解析出的内部工作项 id"都是 `E_convert`——**判定成立**。

这条判定**不**依赖任何外部 id 相等：成员关系 id 确实没变，但那是成员关系 id，不是内容身份；内容 id 实际**变了**（`DI_*` → `I_*`）。如果判定写成"转换后外部 id 逐字节相同"，本实验会给出**错误**的结论。这与 `tests/contract/domain-identity.test.js` 的"Draft→Issue 提升保持内部实体 id 不变，旧身份转 historical、新身份为 primary"是同一条语义，本实验为它提供了平台侧证据。

**历史别名的登记方式**：历史别名指"曾经是"的外部 id——它不再产生新的内容身份，但保留可追溯性。本实验给出的登记方式：

| 项 | 取值 |
|---|---|
| 登记对象 | `ExternalIdentity`，键 `(bindingId, draft, DI_lAHOAY1ahM4BkJ9rzgLKQZ0)` |
| `entityId` | `E_convert`（与转换前一致，**不得**改指新实体） |
| `id`（`ExternalIdentityId`） | 沿用转换前已分配的那个 id，**不得**重新分配（`registerIdentity` 的"重复观察保留已分配的 id 与 entityId"） |
| `role` | `historical`（`IdentityRole.Historical`），不再是 primary |
| 与主身份的关系 | 新 issue 身份是 primary；`activePrimary(identities, E_convert)` 只返回 issue 那一条 |
| 幂等性 | 提升已发生过的实体再次提升是空操作（`promoteDraftToIssue` 的 `promoted: false`） |
| **平台可达性** | **旧 `DI_*` id 在平台上已不可解析**（`NOT_FOUND`）。别名因此只是**本地**的追溯记录：reconcile 不得把它当作可拉取的同步游标或查询句柄，任何"用历史别名去平台取一次"的路径都会失败 |

最后一行是本实验的硬结论：历史别名解决的是"这个新内容 id 该接到哪条内部记录上"，不是"旧 id 还能被平台查到"。

**6 · 意外行为**：无与预期不符之处。但有两条只有实测才能得到的平台事实，都不是推断能替代的：

1. **成员关系 id 在转换中保持不变**，连 `createdAt` 都不变，只有 `updatedAt` 与 `type` 变。转换前本批次准备的两条分支（"成员关系 id 变了" / "成员关系 id 没变"）中，实测落在后者：模型不需要更新成员关系身份。
2. **内容 id 变了，且旧 id 立即失效**。`DI_*` 在转换后立刻返回 `NOT_FOUND`，平台上不存在"旧 id 仍可解析"的过渡窗口。这意味着历史别名必须在转换被观测到的**同一轮** reconcile 里写入；等到下一轮再补，就只能靠本地已有的记录，平台侧已经没有可回查的凭据。

另有一条**跨批次影响**，记在这里而不是改 E1-1 的文件：沙箱定义 §4.1 的重建判据把 `draft-convert` 那一行写成 `DRAFT_ISSUE PVTI_lAHOAY1ahM4BkJ9rzg75lAw DraftIssue DI_lAHOAY1ahM4BkJ9rzgLKQZ0`。转换后该条目变成 `ISSUE`，内容 id 变成 `I_kwDOUjWAl88AAAABSUC8og`，条目数仍是 7、三种 `type` 仍齐全（`DRAFT_ISSUE` 由 draft-beta 提供），但**那一行的期望值已过期**。本批次的 Global Constraints 禁止修改 `docs/architecture/gate-e1-sandbox.md`，因此这条只记录不改动，由 E1-4 或栈级联步骤决定如何更新。

**7 · 决策影响**：

- **支持** `AGENTS.md` §1.1 第 6 条（工程产物关系沿谱系传播，不反复重新识别）与 `docs/architecture/release-gates.md` §2.1 第 4 条（Draft→Issue 内部身份不变）：平台确实把 draft 提升建模成"同一成员关系换了内容"，而不是"删一条建一条"，成员关系 id 与 `createdAt` 不变即为证据。
- **加强** `packages/domain/src/identity.ts` 里 `promoteDraftToIssue` 的形状：旧身份降级、新身份 primary、`entityId` 原样返回——本实验的三条观测（成员关系 id 不变、内容 id 变、旧 id 失效）与这个形状一一对应，没有出现该函数无法表达的观测。
- **新增一条同步约束**（本批次提出，交给 E1-4）：历史别名不可回查。转换后的 reconcile 必须**只**用新内容 id 拉取；发现本地存在 `historical` 身份时不得向平台发起以其为参数的请求。
- **不改变**"每个工作区一条投影"：转换发生在单个 project 内，`WorkspaceProjection` 的规划状态在转换前后都是 Todo，转换不触碰规划字段。

**8 · 判定**：**pass**（issue #23 验收条件 3、4、5 通过）。依据：

1. 转换前后的成员关系 id、成员关系 `createdAt`、内容 id、`type`、`number`、title、所属 project、Status 字段值逐项记录，**变了/没变**都给出实测值；
2. 按 D4 的操作定义，"内部工作项 id 不变"判定**成立**：转换前后解析到同一条内容身份 `E_convert`，新内容 id 登记为该实体的 primary，旧 draft 身份保留原 id 降为 historical；
3. 历史别名的登记方式按上表逐项给出，并明确它在平台上已不可解析。

残余风险：转换不可逆，本实验只有一次观测，无法在同一个夹具上重复验证"旧 id 失效"；如需重复，必须按沙箱定义 §4 重建沙箱并重建夹具。

**9 · 复现**：本实验**不可重复执行**（转换是一次性形态变更）。要在等价沙箱上重跑：

```bash
# 1) 按沙箱定义 §4 重建沙箱（私有仓库 + 两个 user-owned Project v2 + 全部夹具）
# 2) 在 $E1_PROJECT_A 里新建一个 draft issue，记下返回的成员关系 id 与 draft id
gh api graphql -f query='
mutation($project: ID!) {
  addProjectV2DraftIssue(input: { projectId: $project, title: "fixture convert (draft to issue)" }) {
    projectItem { id content { ... on DraftIssue { id title } } } } }' -f project="$E1_PROJECT_A_ID"
# 3) 完整记录转换前状态（第 3 项的第一、二条查询）
# 4) 执行转换（第 3 项的 mutation），repositoryId 用沙箱仓库的 node id
# 5) 独立读回成员关系与新内容（第 3 项的第三、四、五条查询），确认旧 DraftIssue id 返回 NOT_FOUND
```

重跑前必须先按沙箱定义 §5 的拆除步骤清掉旧夹具，否则会在同一个 project 里留下第二个转换夹具，使"条目总数"这类计数失去判别力。

## 4. 跨实验结论

| # | 结论 | 证据 |
|---|---|---|
| 1 | 同一个内容对象出现在两个工作区时，平台给出 1 条内容身份 + 2 条成员关系，成员关系的 id 与 `createdAt` 各自独立 | 实验 1 第 4 项 |
| 2 | 规划字段值挂在成员关系上，两个工作区可以持有不同的值而互不覆盖 | 实验 1 第 4 项的两条独立读回路径 |
| 3 | draft 转换只换内容身份，不换成员关系身份：成员关系 id 与 `createdAt` 不变，内容 id 与 `type` 变 | 实验 2 第 4 项的"变了/没变"表 |
| 4 | "内部工作项 id 不变"必须按"解析到同一条内容身份"判定，不能按外部 id 相等判定 | 实验 2 第 5 项的 D4 核对（成员关系 id 没变、内容 id 变了） |
| 5 | 历史别名是本地追溯记录，平台不可回查 | 实验 2 第 4 项的 `NOT_FOUND` 响应 |
| 6 | 字段值的定位键必须带 project 作用域的字段 id；可选值 id 在两个 project 里相同 | §2.3 与实验 1 第 7 项 |
| 7 | 写请求的响应不回显字段值，写入后必须显式读回 | 实验 1 第 4 项的写入返回 |

## 5. 交给 E1-4 的输入与遗留

**直接可引用的判定**：

- 实验 1 = pass（issue #23 验收条件 1、2）；实验 2 = pass（验收条件 3、4），验收条件 5 为**空真**（前件"成员关系 id 变化"为假，行为未被触发——见下方开放项 6）。
- D4 的操作定义在本批次被实际使用了一次，且它给出与"外部 id 相等"相反的结论——可以直接引用这个反例说明为什么需要操作定义。

**需要 E1-4 裁决的开放项**：

1. **成员关系的落点**：`ExternalIdentityKind` 没有 `ProjectV2Item` 的对应取值，"两条成员关系"在冻结模型里无处安放（实验 1 第 5 项末段）。需要决定是扩展 `ExternalIdentityKind`，还是给成员关系一个独立结构。
2. **写入后以读回为准**：写请求的响应不回显字段值，加上实验 1 第 6 项那次未复现的不一致与沙箱定义 §4.2 的读后写延迟，写路径必须显式读回后再提交投影。
3. **历史别名不可回查**：需要在同步模型里写明"`historical` 身份不得作为平台查询参数"，否则转换后的第一轮 reconcile 会拿到 `NOT_FOUND`。
4. **沙箱定义 §4.1 的判据需要更新**：`draft-convert` 那一行在转换后已过期（实验 2 第 6 项末段）。
5. **验收条件 3 的字面形式不可测**：issue #23 写的是"the internal work item id is byte-identical"，本批次按 D4 的操作定义（"解析到同一个 Entity"）判定为通过。本仓库没有实现，逐字节相同这一形式无法观测；E1-4 若要按字面裁决，必须先有实现，或明确采纳 D4 的操作定义作为该条的判定形式。
6. **验收条件 5 未被触发**：该条是条件句（"若成员关系 id 变化……"），而实测成员关系 id 与 `createdAt` 在转换前后逐字节相同，前件为假，因此"成员关系 id 变化时只更新成员关系身份"这一行为没有任何平台证据。它不能被计为正面证据；需要另找触发该前件的场景（例如成员关系被移除后重新添加）才能验证。

**未覆盖**：

- 本批次没有做"两个账号"的对照实验（`docs/exec-plan/completed/2026-09-21-gate-e1-membership-and-draft.md` 的 D1 说明了为什么用两个 project 表达两个工作区）。
- 本批次没有观测成员关系被移除或归档时的身份行为；`REDACTED` 条目类型仍未观测（沙箱定义 §8）。
- 可选值 id 在两个 project 相同这一点只记录为观测，未做跨项目对照实验。
- `issue-dupe` 在沙箱定义 §2.3 里标为 "E1-2 / E1-3" 共有，但本批次的 ExecPlan 没有把它列进 Plan of Work，因此本批次只读、未使用它；重复添加的观测按沙箱定义 §3 的记录与 E1-3 的计划归属。
