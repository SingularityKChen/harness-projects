# Gate E1 · 写确认与事件可靠性观测记录

> 状态：Active
> 创建：2026-09-21
> 批次：E1-3（issue #24），四层栈第三层，base `test/e1-membership-and-draft`
> 上游：`docs/architecture/gate-e1-sandbox.md`（沙箱定义与九字段记录模板，由 E1-1 交付）
> 相关：`docs/architecture/gate-e1-content-identities.md`、`docs/architecture/gate-e1-membership-and-draft.md`

本文件记录三条实验：**写确认与版本字段**、**事件可用性**、**结果不确定的创建**。每条按
`docs/architecture/gate-e1-sandbox.md` 固定的九字段模板填写，顺序一致。

本批次的夹具是沙箱里专属于 E1-3 的可写条目：`issue-writable`（issue #3）在 Project A 的成员关系
`PVTI_lAHOAY1ahM4BkJ9rzg75k-I`。E1-1 与 E1-2 的夹具（`issue-alpha`、`draft-beta`、`pr-gamma`、
`issue-shared`、`draft-convert`）在本批次中只读，未被修改。

## 命令约定

记录里的命令统一用下列变量，值在 `docs/architecture/gate-e1-sandbox.md` 里定义一次：

```bash
E1_OWNER=<sandbox owner>          # 公开账号名，见沙箱定义文件
E1_REPO=e1-sandbox
E1_PROJECT_A=<Project A id>
E1_ITEM_WRITABLE=<issue-writable 在 Project A 的 ProjectV2Item id>
E1_ITEM_DUPE=<issue-dupe 在 Project A 的 ProjectV2Item id>
E1_FIELD_STATUS=<Status field id>
E1_FIELD_TEXT=<E1 Text field id>
E1_FIELD_DATE=<E1 Date field id>
E1_FIELD_ITERATION=<E1 Iteration field id>
```

`gh` 不打印 token；下列命令均以已登录的 `gh` 会话执行，记录里不出现任何凭据。命令里需要临时文件时统一写成 `$E1_CLONE/<file>`；`$E1_CLONE` 是会话内的临时目录占位符，值在 `docs/architecture/gate-e1-sandbox.md` §2.1。

**GraphQL 输入对象不能用 `-f` 传值。** `gh api graphql -f value.text=...` 与
`-f 'value={"text":"..."}'` 都会被当作字符串，平台返回
`Variable $value of type ProjectV2FieldValue! was provided invalid value`。正确做法是把 query 与
variables 组成 JSON 后 `gh api graphql --input <file>`。这是复现实验时的第一个坑。

---

### 实验 1 · 写确认与版本字段

**1. 实验编号与目的**

判定 issue #24 的"写路径端到端被记录"：规划字段写入后，平台响应回显什么、写后读回是否可见、
是否存在足以支撑冲突检测的版本类字段。对应 ExecPlan 的 D2 三个可观察量。

**2. 夹具**

| 引用名 | 对象 | id |
|---|---|---|
| `issue-writable` | issue #3（内容） | `I_kwDOUjWAl88AAAABST4XVQ` |
| — | 它在 Project A 的成员关系 | `PVTI_lAHOAY1ahM4BkJ9rzg75k-I` |
| `E1 Project A` | user-owned Project v2 | `PVT_kwHOAY1ahM4BkJ9r` |
| `Status` | 单选用字段 | `PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY` |
| `E1 Text` | 文本字段 | `PVTF_lAHOAY1ahM4BkJ9rzhi7k8M` |
| `E1 Date` | 日期字段 | `PVTF_lAHOAY1ahM4BkJ9rzhi7k9I` |
| `E1 Iteration` | 迭代字段 | `PVTIF_lAHOAY1ahM4BkJ9rzhi7k9M` |
| `E1 Sprint 1` | 迭代取值 | `7b232bc3` |

写入前的基线：`createdAt = 2026-09-21T06:59:22Z`，字段只有 `Title` 与 `Status = Todo`。

**3. 请求**

四条字段写入用同一个 mutation，只换 `field` 与 `value`：

```graphql
mutation($project:ID!,$item:ID!,$field:ID!,$value:ProjectV2FieldValue!){
  updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:$value}){
    projectV2Item{ id updatedAt fieldValues(first:12){ nodes{
      __typename
      ... on ProjectV2ItemFieldTextValue{ text }
      ... on ProjectV2ItemFieldDateValue{ date }
      ... on ProjectV2ItemFieldSingleSelectValue{ name optionId }
      ... on ProjectV2ItemFieldIterationValue{ title iterationId }
    } } }
  }
}
```

```bash
# 写成 JSON 后执行；query 已存为 $E1_CLONE/mut.graphql（内容见上面的 mutation）
python3 - "$E1_PROJECT_A" "$E1_ITEM_WRITABLE" "$E1_FIELD_TEXT" '{"text":"observed-by-e1-3"}' <<PY > "$E1_CLONE/req.json"
import json, sys
print(json.dumps({"query": open('$E1_CLONE/mut.graphql').read(), "variables": {
    "project": sys.argv[1], "item": sys.argv[2], "field": sys.argv[3],
    "value": json.loads(sys.argv[4])}}))
PY
gh api graphql --input "$E1_CLONE/req.json"
```

四次调用的 `value` 依次为：

| 序 | 字段 | `value` |
|---|---|---|
| 1 | `E1 Text` | `{"text":"observed-by-e1-3"}` |
| 2 | `E1 Date` | `{"date":"2026-09-24"}` |
| 3 | `E1 Iteration` | `{"iterationId":"7b232bc3"}` |
| 4 | `Status` | `{"singleSelectOptionId":"47fc9ee4"}` |

写后读回用独立 query：

```graphql
query($item: ID!) {
  node(id: $item) { ... on ProjectV2Item {
    id updatedAt createdAt
    fieldValues(first: 12) { nodes {
      __typename
      ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { id name } } }
      ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { id name } } }
      ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2FieldCommon { id name } } }
      ... on ProjectV2ItemFieldIterationValue { title iterationId field { ... on ProjectV2FieldCommon { id name } } }
    } }
  } }
}
```

条目顺序写入：

```graphql
mutation($project:ID!,$item:ID!,$after:ID!){
  updateProjectV2ItemPosition(input:{projectId:$project,itemId:$item,afterId:$after}){
    items(first: 20){ totalCount nodes{ id type } }
  }
}
```

**4. 观测**

**4.1 四次字段写入的响应回显与写后读回**

四条写入全部成功，没有 `errors`。响应与紧随其后的独立读回**逐字一致**：

| 字段 | 响应回显（`projectV2Item.fieldValues`） | 写后读回 | `updatedAt`（响应） | `updatedAt`（读回） |
|---|---|---|---|---|
| `E1 Text` | `{"__typename":"ProjectV2ItemFieldTextValue","text":"observed-by-e1-3"}` | 同值，`field.name = "E1 Text"` | `07:10:57Z` | `07:10:57Z` |
| `E1 Date` | `{"__typename":"ProjectV2ItemFieldDateValue","date":"2026-09-24"}` | 同值，`field.name = "E1 Date"` | `07:10:58Z` | `07:10:58Z` |
| `E1 Iteration` | `{"__typename":"ProjectV2ItemFieldIterationValue","title":"E1 Sprint 1","iterationId":"7b232bc3"}` | 同值，`field.name = "E1 Iteration"` | `07:11:00Z` | `07:11:00Z` |
| `Status` | `{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"In Progress","optionId":"47fc9ee4"}` | 同值，`field.name = "Status"` | `07:11:00Z` | `07:11:00Z` |

写后读回**立即一致**：每次读回都发生在响应返回后的同一秒内，读到的值与响应回显相同，没有观察到
读己之写延迟。最终读回（清理阶段）确认四个字段同时保持：`Status = In Progress`、
`E1 Text = observed-by-e1-3`、`E1 Date = 2026-09-24`、`E1 Iteration = E1 Sprint 1`。

**4.2 响应回显的完整性不可靠**

把 `field{... on ProjectV2FieldCommon{id name}}` 加进 mutation 响应后，同一条 mutation 的回显出现了
**字段值缺失**：

```json
{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"PVTI_lAHOAY1ahM4BkJ9rzg75k-I",
 "updatedAt":"2026-09-21T07:11:00Z","fieldValues":{"nodes":[
  {"__typename":"ProjectV2ItemFieldRepositoryValue"},
  {"__typename":"ProjectV2ItemFieldTextValue","text":"fixture writable (field writes)",
   "field":{"id":"PVTF_lAHOAY1ahM4BkJ9rzhi7jWQ","name":"Title"}},
  {"__typename":"ProjectV2ItemFieldSingleSelectValue"},
  {"__typename":"ProjectV2ItemFieldTextValue","text":"observed-by-e1-3",
   "field":{"id":"PVTF_lAHOAY1ahM4BkJ9rzhi7k8M","name":"E1 Text"}},
  {"__typename":"ProjectV2ItemFieldDateValue"},
  {"__typename":"ProjectV2ItemFieldIterationValue"}]}}}}}
```

`Status`、`E1 Date`、`E1 Iteration` 三个节点只回了 `__typename`，值字段为空；而同一秒的另一次调用
（`updateProjectV2ItemFieldValue` 返回全量 `fieldValues`）三个值都在。**同一个 connection 在两次调用
之间给不出稳定结果**，因此响应回显不能当作唯一的确认来源。

作为对照，`fieldValueByName` 在 mutation payload 上**定向取单字段**是可靠的：

```graphql
projectV2Item{ id updatedAt
  e1Text: fieldValueByName(name:"E1 Text"){ __typename ... on ProjectV2ItemFieldTextValue { text } }
}
```

返回 `{"e1Text":{"__typename":"ProjectV2ItemFieldTextValue","text":"observed-by-e1-3"}}`，与读回一致。

**4.3 `updatedAt` 只在值真正改变时推进**

对同一个值连续重写四次（`E1 Text` 已等于 `observed-by-e1-3`），`updatedAt` 保持不变：

| 操作 | `updatedAt` | 本地时钟 |
|---|---|---|
| 读当前 | `2026-09-21T07:11:00Z` | — |
| 同值重写 1 | `2026-09-21T07:11:00Z` | `07:11:36Z` |
| 同值重写 2 | `2026-09-21T07:11:00Z` | `07:11:37Z` |
| 同值重写 3 | `2026-09-21T07:11:00Z` | `07:11:38Z` |

对照的真实改变：`Status` 从 `In Progress` 改成 `Todo` → `updatedAt` 由 `07:11:00Z` 推进到 `07:11:54Z`；
再改回 `In Progress` → 推进到 `07:11:56Z`。

结论：`ProjectV2Item.updatedAt` **不是修订计数器**，它是"最后一次内容变更"的墙钟标记；同值写入不推进它。

**4.4 `updatedAt` 的粒度是秒，同秒内碰撞可复现**

连续四次真实值改变（`E1 Text` = `burst-1`…`burst-4`）的响应：

```
write 1 -> {"updatedAt":"2026-09-21T07:13:32Z"}
write 2 -> {"updatedAt":"2026-09-21T07:13:33Z"}
write 3 -> {"updatedAt":"2026-09-21T07:13:34Z"}
write 4 -> {"updatedAt":"2026-09-21T07:13:34Z"}
local clock: 2026-09-21T07:13:34Z
```

第 3、4 次落在同一秒，`updatedAt` 相同。**同秒内的多次真实写入无法用 `updatedAt` 区分先后。**

**4.5 不存在版本类字段与 CAS 前置条件**

- `ProjectV2Item` 的全部字段：`content`、`createdAt`、`creator`、`fieldValueByName`、`fieldValues`、
  `fullDatabaseId`、`id`、`isArchived`、`project`、`type`、`updatedAt`。**没有 ETag、revision、
  version、lock 之类的字段。**
- `UpdateProjectV2ItemFieldValueInput` 的输入项：`clientMutationId`、`projectId`、`itemId`、`fieldId`、
  `value`。**没有任何前置条件参数**（没有 `expectedVersion` / `ifMatch`）。
- REST `GET /repos/$E1_OWNER/$E1_REPO/issues/3` 返回 `Etag: W/"8357..."` 与
  `Last-Modified: Mon, 21 Sep 2026 06:57:29 GMT`，但那是 **issue 内容资源**的弱 ETag，与
  `ProjectV2Item` 的字段写入不是同一个资源；用 `If-Match` 也约束不到 `updateProjectV2ItemFieldValue`。

**4.6 条目顺序写入**

`updateProjectV2ItemPosition` 的 payload 返回**变更后的完整顺序**，可直接用作确认：

```json
{"data":{"updateProjectV2ItemPosition":{"items":{"totalCount":7,"nodes":[
 {"id":"PVTI_lAHOAY1ahM4BkJ9rzg75k2w","type":"ISSUE"},
 {"id":"PVTI_lAHOAY1ahM4BkJ9rzg75k4g","type":"PULL_REQUEST"},
 {"id":"PVTI_lAHOAY1ahM4BkJ9rzg75k64","type":"ISSUE"},
 {"id":"PVTI_lAHOAY1ahM4BkJ9rzg75k_g","type":"DRAFT_ISSUE"},
 {"id":"PVTI_lAHOAY1ahM4BkJ9rzg75lAw","type":"DRAFT_ISSUE"},
 {"id":"PVTI_lAHOAY1ahM4BkJ9rzg75lGI","type":"ISSUE"},
 {"id":"PVTI_lAHOAY1ahM4BkJ9rzg75k-I","type":"ISSUE"}]}}}}
```

注（2026-09-21 独立验收补充）：上面这段是 07:13Z 的**历史观测原文**，当时
`PVTI_lAHOAY1ahM4BkJ9rzg75lAw` 还是 `DRAFT_ISSUE`。该条目在 07:18:02Z 被 E1-2 用
`convertProjectV2DraftIssueItemToIssue` 转成了 issue #6，因此今天重跑同一查询会得到
`"type":"ISSUE"`。**历史观测值不因后续变化而改写**；当前值见 §4.4 的注记。

把 `issue-writable` 移到 `issue-dupe` 之后：响应里它出现在末位，随后的独立读回顺序一致。再用
`afterId=issue-shared` 还原，顺序回到变更前，条目数始终为 7。

一个必须记录的失败形态：payload 里的 `items` 是 connection，**不给 `first`/`last` 会整个 payload 变 null**：

```json
{"data":{"updateProjectV2ItemPosition":{"items":null}},
 "errors":[{"type":"MISSING_PAGINATION_BOUNDARIES","path":["updateProjectV2ItemPosition","items"],
 "message":"You must provide a `first` or `last` value to properly paginate the `items` connection."}]}
```

注意这次调用**已经生效**（顺序确实变了），只是响应读不到。这是本批次观察到的第二次"写成功但响应不可用"。

**5. 本地应有行**

本仓库当前没有实现写路径的持久化，因此给出**契约层**应有的行，供后续实现对照：

| 表（预期） | 键 | 计数 | 为什么是这些行 |
|---|---|---|---|
| `external_identity` | (platform, kind=`ProjectV2Item`, id=`PVTI_...75k-I`) | 1 | 成员关系身份是写路径的目标对象，`updatedAt` 附属于它 |
| 规划字段值 | (workspace=A, item=`PVTI_...75k-I`) | **4** | 按 [gate-e1-sandbox.md](gate-e1-sandbox.md) §6 对「行数」的定义计：该条目只有 `Status` / `E1 Text` / `E1 Date` / `E1 Iteration` 四个用户可写字段 |
| `sync_observation` | (item=`PVTI_...75k-I`, observed_at) | 每次读回一行 | `updatedAt` 秒级且可碰撞，观察必须自带本地接收时刻才能定序 |
| `item_position` | (workspace=A, item) | 7 | 顺序是 workspace 级属性，条目数恒为 7 |

上表「规划字段值」行覆盖的四个用户可写字段，各自的值见 §4.1 的响应回显与写后读回表；本表只记键与计数，不重复这些值。

关键点：**不能**把 `updatedAt` 当作 `revision` 列存进权威状态并拿它做 CAS；它只能作为"观察到的
平台修改时间"参与对账。

**6. 意外行为**

1. **mutation 响应回显不完整**：同一 connection 在不同调用间对 `Status`/`E1 Date`/`E1 Iteration`
   只返回 `__typename`、不返回值字段（§4.2）。预期是回显完整，实测不是。
2. **同值重写不推进 `updatedAt`**（§4.3）。预期"写一次就更新一次"，实测只在值真正改变时推进。
3. **`updatedAt` 秒级且同秒碰撞**（§4.4）。预期可以拿它定序，实测同秒内多次真实写入不可区分。
4. **`updateProjectV2ItemPosition` 不给分页参数时 payload 整体为 null，但写入已生效**（§4.6）。
   预期是"报错即未生效"，实测是"报错也可能已生效"。
5. **`gh api graphql -f value.text=...` 无法传 GraphQL 输入对象**（见"命令约定"）。这是工具层坑，
   但会让复现者以为平台拒绝写入。

**7. 决策影响**

- **D2 第 1 项（响应回显）判定为"部分可用"**：值会被回显，但 `fieldValues` connection 会丢值。
  写入确认必须**定向读取目标字段**（`fieldValueByName`）或依赖独立读回，不能只解析回显里的
  `fieldValues` 数组。
- **D2 第 2 项（read-after-write）判定为"可用"**：本批次没有观察到写后读延迟。
- **D2 第 3 项（版本类字段）判定为"不存在 CAS"**：只有秒级 `updatedAt`，没有 ETag / revision，
  mutation 也没有前置条件参数。**契约不得依赖 compare-and-set。** 见下面的结论行。
- 条目顺序写入的确认**可以依赖响应**，但必须显式传 `first`，并且要能容忍"响应为 null 但已生效"。
- 这改变了 `packages/capabilities` 里写路径确认语义的输入：`Saving… → Saved` 的 `Saved` 只能由
  **独立读回**支撑，不能由 mutation 响应单独支撑。

**结论（CAS）**：平台在 `ProjectV2Item` 字段写入上**不存在 compare-and-set**。可用的版本类输入只有
`ProjectV2Item.updatedAt`，它是**秒级、只在真实变更时推进、同秒可碰撞**的墙钟标记；`ProjectV2Item`
没有 ETag / revision 字段，`updateProjectV2ItemFieldValue` 也没有任何前置条件参数。因此
**契约不得依赖 compare-and-set**：冲突处理只能是"读回 → 比较 → 显式决定"，由本地策略承担覆盖语义，
平台不提供"只在某版本上才允许写"的保证。REST issue 的弱 ETag 属于另一个资源，不能用来约束
project item 的字段写入。

**8. 判定**

**pass**（就"如实记录写确认语义"这一目标）。依据：四次写入各有请求、响应回显、写后读回值与
`updatedAt` 变化；D2 三个可观察量逐项有实测值；CAS 结论由字段列表、输入类型列表与秒级碰撞三条
独立证据支撑。

**9. 复现**

1. 按 `docs/architecture/gate-e1-sandbox.md` 重建沙箱并导出变量（见"命令约定"）。
2. 读基线：跑 §3 的读回 query，确认 `Status = Todo`、无 `E1 Text` / `E1 Date` / `E1 Iteration`。
3. 按 §3 的四行 `value` 表依次执行 mutation，每次紧接一次读回 query，对比回显与读回。
4. 复现 §4.2：把 `field{... on ProjectV2FieldCommon{id name}}` 加进 mutation 响应，重复调用直到
   观察到某个节点只剩 `__typename`。
5. 复现 §4.3：对同一值连写三次，确认 `updatedAt` 不变；再写一个不同的值，确认推进。
6. 复现 §4.4：连写四个不同的值，确认至少两次落在同一秒。
7. 复现 §4.6：执行位置 mutation，分别带与不带 `first`，对比 payload。
8. 还原：把四个字段写回基线（或按沙箱定义重建），位置用 `afterId=issue-shared` 还原。

---

### 实验 2 · 事件可用性

**1. 实验编号与目的**

判定 issue #24 的"事件关闭时对账仍收敛"：平台是否允许为沙箱仓库订阅项目条目事件与变更请求 /
issue 事件，以及重复观察与乱序观察在平台侧有什么可判别输入。对应 ExecPlan 的 D1 与 D3。

**2. 夹具**

不新增夹具。目标仓库 `$E1_OWNER/$E1_REPO`（私有，user-owned），Project A
`PVT_kwHOAY1ahM4BkJ9r`，观察对象复用实验 1 的 `issue-writable` 成员关系。
webhook URL 固定用 `https://example.invalid/e1-sandbox-hook`（保留域名，不会真实投递）。

**3. 请求**

```bash
# 订阅项目条目事件
gh api --method POST /repos/$E1_OWNER/$E1_REPO/hooks \
  -f name=web -F active=true -f 'events[]=projects_v2_item' \
  -f 'config[url]=https://example.invalid/e1-sandbox-hook' -f 'config[content_type]=json'

# 订阅变更请求与 issue 事件
gh api --method POST /repos/$E1_OWNER/$E1_REPO/hooks \
  -f name=web -F active=true -f 'events[]=pull_request' -f 'events[]=issues' \
  -f 'config[url]=https://example.invalid/e1-sandbox-hook' -f 'config[content_type]=json'

# 其他作用域探测
gh api --method POST /orgs/$E1_OWNER/hooks ...          # org 级
gh api --method POST /users/$E1_OWNER/hooks ...         # 用户级
gh api --method POST /projects/11/hooks ...             # project 级
```

**4. 观测**

**4.1 `projects_v2_item` 被拒绝**

HTTP `422`，响应原文：

```json
{"message":"Validation Failed","errors":[{"resource":"Hook","code":"custom",
 "message":"These events are not allowed for this hook: projects_v2_item"}],
 "documentation_url":"https://docs.github.com/rest/repos/webhooks#create-a-repository-webhook","status":"422"}
```

**仓库 webhook 不允许订阅 `projects_v2_item`。** 这是平台的显式拒绝，不是权限不足（同一会话下
`pull_request` / `issues` 订阅成功）。

**4.2 `pull_request` / `issues` 被接受**

HTTP `201`，返回体（截取关键字段）：

```json
{"type":"Repository","id":682617671,"name":"web","active":true,
 "events":["pull_request","issues"],
 "config":{"content_type":"json","url":"https://example.invalid/e1-sandbox-hook","insecure_ssl":"0"},
 "created_at":"2026-09-21T07:12:42Z","updated_at":"2026-09-21T07:12:42Z"}
```

**4.3 其他作用域都给不出项目条目事件**

| 作用域 | 端点 | 结果 |
|---|---|---|
| 仓库 | `POST /repos/$E1_OWNER/$E1_REPO/hooks` | `422`：`These events are not allowed for this hook: projects_v2_item` |
| 组织 | `POST /orgs/$E1_OWNER/hooks` | `404 Not Found`（沙箱 owner 是 user，不是 organization） |
| 用户 | `POST /users/$E1_OWNER/hooks` | `404 Not Found`（端点不存在） |
| project | `POST /projects/11/hooks` | `404 Not Found`（端点不存在） |

user-owned Project v2 **没有任何可用的 webhook 作用域**能订阅到项目条目事件。项目条目事件只能来自
organization 级 webhook 或 GitHub App webhook，两者在本沙箱都不适用。

**4.4 legacy 事件名被接受，但不对应 Project v2**

`project`、`project_card`、`project_column` 三个事件名都被接受（各返回 `201`），但它们属于
**classic Projects**，不是 Project v2。本批次没有观察到它们会因 Project v2 的字段写入而投递；
本记录不把"订阅被接受"当作"能收到 Project v2 事件"的证据。

**4.5 webhook 清理**

本实验创建了 4 个 webhook（id `682617671`、`682617676`、`682617681`、`682617686`），全部在记录前删除：

```bash
for id in 682617671 682617676 682617681 682617686; do
  gh api --method DELETE /repos/$E1_OWNER/$E1_REPO/hooks/$id   # 每个返回 204 No Content
done
gh api /repos/$E1_OWNER/$E1_REPO/hooks --jq 'length'           # 返回 0
```

未创建任何 secret（URL 是保留域名，不需要签名验证）。

**4.6 重复观察与乱序观察的可判别输入**

平台为这两种情况提供的输入是有限的，实测如下：

| 可判别输入 | 实测形态 | 能否定序 |
|---|---|---|
| `ProjectV2Item.id` | 稳定（`PVTI_...75k-I` 跨多次读取不变） | 能识别**同一**对象（去重键），不能定序 |
| `ProjectV2Item.updatedAt` | 秒级，只在真实变更时推进，同秒碰撞（实验 1 §4.3、§4.4） | **不能**作为全序：同秒内多次写入无法区分先后 |
| `ProjectV2Item.createdAt` | 秒级，创建后不变 | 只用于创建排序 |
| `ProjectV2.createdAt` / `updatedAt` | 秒级；`updatedAt` 随条目字段写入推进 | 只能粗判"这个 project 变过" |
| `Issue.createdAt` / `updatedAt` / `lastEditedAt` | `lastEditedAt = null`（未被编辑过） | 同上 |
| REST issue 的 `Etag` / `Last-Modified` | 弱 ETag + 秒级 `Last-Modified` | 属于 issue 内容资源，不覆盖 project item 字段值 |

**重复观察**的判据：`(platform, kind=ProjectV2Item, id)` 是稳定自然键。同一次读取被投递两次，
两份观察的该键相同 → 本地按**幂等 upsert** 处理，实体与关系计数不变。这一步**不需要**时间戳。

**乱序观察**的判据：`updatedAt` **不足以**定序。必须叠加本地接收时刻（`sync_observation.observed_at`）
作为 tie-breaker，并遵循两条规则：

1. `updatedAt` 更大者更新；相等时**不能**判定谁新。
2. `updatedAt` 相等时，用"同一次对账读取的快照"整体替换，而不是逐字段合并——因为同秒内的两次写入
   在平台侧已经不可区分，任何逐字段合并都可能拼出一个从未存在过的组合。
3. 丢弃"比本地已提交观察更旧的 `updatedAt`"的观察（`updatedAt < committed.updatedAt` 时拒绝），
   这是能安全执行的唯一乱序保护；`==` 时按规则 2 走快照替换。

**对账兜底的判据**：既然项目条目事件订不到（§4.1、§4.3），正确性**只能**由周期性对账提供。
对账的最小判据是：按 `(project, content)` 列出当前条目集合与字段值，与本地投影逐项比对；
差异只在"集合成员不同"或"某字段值不同"时产生。因为 `addProjectV2ItemById` 幂等（实验 3），
对账重跑不会制造重复成员关系；因为 `updatedAt` 秒级可碰撞，对账**不能**用 `updatedAt` 做增量游标，
必须按对象全量比对，或用 `updatedAt >= 上次对账时刻 - 安全边界` 做粗筛后再全量确认。

**5. 本地应有行**

| 表（预期） | 键 | 计数 | 为什么是这些行 |
|---|---|---|---|
| `webhook_subscription` | (workspace, event=`projects_v2_item`) | **0** | 平台拒绝订阅，不产生行；这条"零行"是结论本身 |
| `webhook_subscription` | (workspace, event=`pull_request` / `issues`) | 2 | 可订阅，但只覆盖内容事件，不覆盖规划字段 |
| `sync_observation` | (item, observed_at) | 每次对账读取一行 | 观察自带本地接收时刻，是乱序判定的 tie-breaker |
| `reconcile_cursor` | (workspace) | 1 | 游标只能是"上次全量对账时刻"，不能是 `updatedAt` |

**6. 意外行为**

1. **`projects_v2_item` 在仓库 webhook 上被显式拒绝**（`422`），而同一次会话里 `pull_request` /
   `issues` 订阅成功——说明这是事件白名单限制，不是权限问题。
2. **user-owned Project v2 没有任何 webhook 作用域**：org 端点 `404`（owner 不是 organization）、
   用户级与 project 级端点都不存在。
3. **legacy `project*` 事件名被接受**，容易让人误以为"能订到项目事件"。它们属于 classic Projects。
4. **`updatedAt` 不能当增量游标**：秒级 + 同秒碰撞 + 同值不推进，三者叠加使"按时间戳拉增量"不可靠。

**7. 决策影响**

- **D1 落地**：事件订不到**不是本批次失败**。结论写成"正确性由对账提供"，与 issue #24 Notes
  "Event delivery is an accelerator here, never the correctness mechanism" 一致。
- **D3 落地**：重复与乱序**用观察表达**。重复靠稳定 id 幂等 upsert；乱序靠 `updatedAt` 比较加
  本地接收时刻 tie-breaker，`==` 时整快照替换而不是逐字段合并。
- 对账**必须全量比对**，不能依赖 `updatedAt` 增量游标；这直接影响后续同步实现的设计。
- 契约层需要一条显式的"事件不可用"降级路径：事件订阅失败（或根本不可订）时同步仍必须收敛。

**8. 判定**

**pass**（就"如实记录事件可用性与对账兜底判据"这一目标）。依据：订阅尝试有请求与平台原文响应，
接受与拒绝的形态都记录在案，创建的 webhook 已删除并回读为 0；重复/乱序的可判别输入逐项列出实测形态，
并明确给出"`updatedAt` 不足以定序"这一否定结论及其依据。

**9. 复现**

1. 按 `docs/architecture/gate-e1-sandbox.md` 重建沙箱；确认 `$E1_OWNER` 是 user 而非 organization。
2. 跑 §3 的三条订阅命令，确认 `projects_v2_item` 返回 `422` 且原文含
   `These events are not allowed for this hook`，`pull_request` + `issues` 返回 `201`。
3. 跑 §3 的三条作用域探测，确认 `404`。
4. 删除第 2 步创建的全部 webhook（`DELETE /repos/$E1_OWNER/$E1_REPO/hooks/<id>`），
   用 `gh api /repos/$E1_OWNER/$E1_REPO/hooks --jq 'length'` 确认回到 0。
5. 可判别输入用实验 1 的读回 query 直接复现：重复读同一条目确认 id 稳定；跑实验 1 §4.3、§4.4
   确认 `updatedAt` 不推进与同秒碰撞。

---

### 实验 3 · 结果不确定的创建

**1. 实验编号与目的**

判定 issue #24 的"结果不确定先对账再重试"：对同一内容重复执行加入 project 会不会产生第二条成员关系，
以及是否存在不依赖响应的自然键。对应 ExecPlan 的 D4。

**2. 夹具**

| 引用名 | 对象 | id |
|---|---|---|
| `issue-dupe` | issue #4（内容） | `I_kwDOUjWAl88AAAABST4X6Q` |
| — | 它在 Project A 的成员关系 | `PVTI_lAHOAY1ahM4BkJ9rzg75lGI` |
| `pr-gamma` | change request #5（内容，用于探测 `contentId` 接受范围） | `PR_kwDOUjWAl88AAAABEYNntg` |
| `draft-beta` | draft issue（用于探测 `contentId` 接受范围） | `DI_lAHOAY1ahM4BkJ9rzgLKQZo` |

探测 `contentId` 接受范围时临时创建了两个 draft 夹具（`PVTI_lAHOAY1ahM4BkJ9rzg75sRg`、
`PVTI_lAHOAY1ahM4BkJ9rzg75sTE`），已在记录前删除，Project A 回到 7 条。

**3. 请求**

```graphql
mutation($project:ID!,$content:ID!){
  addProjectV2ItemById(input:{projectId:$project,contentId:$content}){
    item{ id createdAt updatedAt type content{ __typename ... on Issue{ id number } } }
  }
}
```

```bash
# 写成 JSON 后执行；query 已存为 $E1_CLONE/add.graphql（内容见上面的 mutation）
python3 - "$E1_PROJECT_A" "I_kwDOUjWAl88AAAABST4X6Q" <<PY > "$E1_CLONE/req.json"
import json, sys
print(json.dumps({"query": open('$E1_CLONE/add.graphql').read(), "variables": {
    "project": sys.argv[1], "content": sys.argv[2]}}))
PY
gh api graphql --input "$E1_CLONE/req.json"     # 执行两次，参数完全相同
```

**4. 观测**

**4.1 两次相同请求返回同一条成员关系**

第一次：

```json
{"data":{"addProjectV2ItemById":{"item":{"id":"PVTI_lAHOAY1ahM4BkJ9rzg75lGI",
 "createdAt":"2026-09-21T06:59:38Z","updatedAt":"2026-09-21T06:59:40Z","type":"ISSUE",
 "content":{"__typename":"Issue","id":"I_kwDOUjWAl88AAAABST4X6Q","number":4}}}}}
```

第二次（参数完全相同）：

```json
{"data":{"addProjectV2ItemById":{"item":{"id":"PVTI_lAHOAY1ahM4BkJ9rzg75lGI",
 "createdAt":"2026-09-21T06:59:38Z","updatedAt":"2026-09-21T06:59:40Z","type":"ISSUE",
 "content":{"__typename":"Issue","id":"I_kwDOUjWAl88AAAABST4X6Q","number":4}}}}}
```

**item id 相同（`PVTI_lAHOAY1ahM4BkJ9rzg75lGI`），`createdAt` 相同（`06:59:38Z`），
`updatedAt` 也相同（`06:59:40Z`）。** 第二次调用没有创建新条目，也没有推进 `updatedAt`。

**4.2 实测条目计数**

探测期间 Project A 有 9 条（7 条原有 + 2 条临时 draft 探测夹具）。按内容过滤：
issue #4 只对应**一条**成员关系。删除临时 draft 后：

```json
{"data":{"node":{"items":{"totalCount":7,"nodes":[
 {"id":"PVTI_lAHOAY1ahM4BkJ9rzg75k2w","isArchived":false,"content":{"__typename":"Issue","number":1}},
 {"id":"PVTI_lAHOAY1ahM4BkJ9rzg75k4g","isArchived":false,"content":{"__typename":"PullRequest"}},
 {"id":"PVTI_lAHOAY1ahM4BkJ9rzg75k64","isArchived":false,"content":{"__typename":"Issue","number":2}},
 {"id":"PVTI_lAHOAY1ahM4BkJ9rzg75k-I","isArchived":false,"content":{"__typename":"Issue","number":3}},
 {"id":"PVTI_lAHOAY1ahM4BkJ9rzg75k_g","isArchived":false,"content":{"__typename":"DraftIssue"}},
 {"id":"PVTI_lAHOAY1ahM4BkJ9rzg75lAw","isArchived":false,"content":{"__typename":"DraftIssue"}},
 {"id":"PVTI_lAHOAY1ahM4BkJ9rzg75lGI","isArchived":false,"content":{"__typename":"Issue","number":4}}]}}}}
```

**重复执行"加入 project"的实测计数是 1，不是 2。** `(project, content)` 在平台侧是唯一的。

**4.3 `contentId` 接受范围**

| `contentId` | 结果 |
|---|---|
| issue node id `I_kwDOUjWAl88AAAABST4X6Q` | `200`，返回既有成员关系 |
| change request node id `PR_kwDOUjWAl88AAAABEYNntg` | `200`，返回既有成员关系 `PVTI_lAHOAY1ahM4BkJ9rzg75k4g` |
| draft issue id `DI_lAHOAY1ahM4BkJ9rzgLKQZo` | `VALIDATION`：`contentID must refer to an Issue or a Pull Request.` |
| 不存在的 id `I_kwDOUjWAl88AAAABST4XXXX` | `NOT_FOUND`：`Could not resolve to a node with the global id of '...'` |

**`addProjectV2ItemById` 只接受 Issue 或 Pull Request，不接受 draft。** 加入 draft 走的是
`addProjectV2DraftIssue`（它在 project 里**创建**新内容，而不是挂接既有内容）。

**4.4 自然键**

| 候选自然键 | 是否稳定可重查 | 依据 |
|---|---|---|
| `contentId`（issue / PR 的 node id） | **是** | 两次调用返回同一 item id；`contentId` 是调用方已知的输入 |
| `(repo, number)` → node id | **是** | `repository(owner:...,name:...){issue(number:4){id}}` 稳定返回 `I_kwDOUjWAl88AAAABST4X6Q` |
| `(project, content)` | **是** | 平台保证唯一，因此可用来反查既有成员关系 |
| issue 标题 | **否** | `GET /search/issues?q=repo:$E1_OWNER/$E1_REPO fixture` 返回 5 条（`total_count = 5`），标题不唯一 |
| `ProjectV2Item.createdAt` | 否 | 秒级，且"结果不确定"时本来就没有响应可读 |

注：该 07:13Z 历史观测保留 `total_count = 5`；由于 E1-2 后新增/转换了 issue #6，今天重跑同一查询会得到 6 条（`total_count = 6`）。

**5. 本地应有行**

| 表（预期） | 键 | 计数 | 为什么是这些行 |
|---|---|---|---|
| `external_identity` | (platform, kind=`Issue`, id=`I_kwDOUjWAl88AAAABST4X6Q`) | 1 | 内容身份，创建前后不变 |
| `external_identity` | (platform, kind=`ProjectV2Item`, id=`PVTI_...75lGI`) | 1 | 成员关系身份；重试返回同一个，不新增行 |
| `project_item_membership` | (workspace=A, content=`I_...X6Q`) | **1** | 平台保证 `(project, content)` 唯一，实测计数为 1 |
| `pending_external_write` | (idempotency_key = contentId) | 0 或 1 | 幂等键就是 `contentId`；有了它重试不需要"结果不确定"状态 |

**6. 意外行为**

1. **`addProjectV2ItemById` 拒绝 draft**（`contentID must refer to an Issue or a Pull Request.`）。
   预期是"任何 project item 内容都能挂接"，实测只接受 Issue / PR。
2. **`deleteProjectV2Item` 的 `projectId` 是必填**：只传 `itemId` 返回
   `Argument 'projectId' on InputObject 'DeleteProjectV2ItemInput' is required.`。
3. **删除后 `items.totalCount` 一度仍返回 9**，而同一 connection 的 `nodes` 已经是 7 条；
   再次读取后 `totalCount` 才回到 7。**连接计数存在读后短暂陈旧**，对账不能只信 `totalCount`。
4. **标题不是自然键**：宽泛关键词 `fixture` 命中 5 条；即使完整标题当前唯一，它也是可变属性
   （标题可被编辑），不能作为幂等键。

**7. 决策影响**

- **D4 落地，且结论是"平台侧幂等"**：重复加入同一内容**不会**产生第二条成员关系，实测计数为 1。
  因此本批次**不需要**把"结果不确定"记为"必然产生重复"的最坏情况。
- **自然键存在，且就是 `contentId`**：成员关系的幂等键是 `(project, contentId)`，而 `contentId`
  是发起调用的那一方本来就持有的输入（issue / PR 的 node id）。**只要有 `contentId`，
  "结果不确定"就可以通过对账消除**：重读 project 条目集合，按 `contentId` 找既有成员关系即可。
- **"结果不确定"仍是必须产品可见的状态，但触发条件更窄**：它只在
  **创建 `contentId` 本身的那一步**（`createIssue` / `addProjectV2DraftIssue`）响应丢失时出现——
  此时调用方不持有任何不依赖响应的自然键（标题可变且可能不唯一，见 §4.4）。这一条**本批次没有实测**，
  见 §8 的限定。
- 恢复路径（可执行判据）：
  1. 写前把 `contentId` 与 `(project, contentId)` 作为幂等键持久化到 `pending_external_write`；
  2. 响应丢失时**先对账**：重读 project 条目集合，按 `contentId` 找成员关系；
  3. 找到 → 直接采纳，不发第二次写入，不进入"结果不确定"状态；
  4. 找不到 → 重试 `addProjectV2ItemById`（平台幂等，实测安全）；
  5. 若丢失的是**创建内容**的响应（没有 `contentId`）→ 进入**产品可见的"结果不确定"**，
     提示需要人工确认，**不允许静默重试**，因为标题不构成可靠自然键。

**8. 判定**

**pass**（就"给出重复创建的实测计数与恢复路径"这一目标）。依据：两次相同请求的响应逐字段比对
（item id / `createdAt` / `updatedAt` 全相同）、清理后的实测条目计数为 7 且 issue #4 只有一条成员关系、
`contentId` 接受范围有四种输入的实测形态、自然键候选逐项有证据。

限定（如实记录）：**"创建内容那一步响应丢失"这一分支没有实测**，本批次只观测了"加入既有内容"
这一步的幂等性。因此 §7 里第 5 条恢复路径是基于"标题不是可靠自然键"这一实测结论推导出来的，
不是直接观测到的平台行为。这一点在 ExecPlan 的 `Surprises & Discoveries` 里同样记明。

**9. 复现**

1. 按 `docs/architecture/gate-e1-sandbox.md` 重建沙箱并导出变量。
2. 执行 §3 的 mutation 两次，参数完全相同；比对两次响应的 `item.id`、`item.createdAt`、`item.updatedAt`。
3. 用 `items(first:50){ totalCount nodes{ id content{ ... on Issue{ number } } } }` 数 issue #4 的
   成员关系条数，确认是 1。
4. 按 §4.3 的四种 `contentId` 各调用一次，确认 Issue / PR 通过、draft 报 `VALIDATION`、
   不存在的 id 报 `NOT_FOUND`。
5. 探测 `contentId` 接受范围若创建了临时 draft，用
   `deleteProjectV2Item(input:{projectId:$E1_PROJECT_A,itemId:<id>})` 删除，确认 `deletedItemId`
   回显且 `nodes` 回到 7 条。

---

## 三条实验的合并结论

| # | 问题 | 实测结论 |
|---|---|---|
| 1 | 写路径的确认能否从平台响应推导 | **能，但不能只看 `fieldValues` connection**：值会回显，但该 connection 会丢值；可靠做法是定向读 `fieldValueByName` 或独立读回 |
| 2 | 平台有没有 compare-and-set | **没有**。只有秒级 `updatedAt`，无 ETag / revision，mutation 无前置条件参数。**契约不得依赖 CAS** |
| 3 | `Saving… → Saved` 能否实现 | **能**，但 `Saved` 必须由**独立读回**支撑；mutation 响应单独不足以支撑权威 `Saved` |
| 4 | 事件关闭时对账是否仍收敛 | **是，且是唯一路径**：`projects_v2_item` 在仓库 webhook 上被 `422` 拒绝，user-owned project 无其他 webhook 作用域 |
| 5 | 重复投递是否改变实体与关系计数 | **不改变**：`ProjectV2Item.id` 是稳定自然键，幂等 upsert 即可；计数不变不依赖时间戳 |
| 6 | 旧观察是否覆盖新观察 | **有保护的判据**：`updatedAt` 秒级且同秒碰撞，**不能**单独定序；需叠加本地接收时刻，`==` 时整快照替换 |
| 7 | 结果不确定是否先对账再重试 | **是，且可行**：`(project, contentId)` 幂等，实测重复加入计数为 1 |
| 8 | 无自然键时是否记为产品可见状态 | **是，但范围收窄到"创建内容"那一步**；"加入既有内容"有可靠自然键 `contentId`，不需要该状态 |
