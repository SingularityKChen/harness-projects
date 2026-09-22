# Gate E1 三类内容身份观测

> 本文件记录 Gate E1 的三条实验：一个 project membership 指向 issue、draft 或 change request 时，成员关系身份与内容身份各是什么形状、如何映射到本地行。
> 沙箱的对象清单、创建 / 重建 / 拆除步骤与九字段模板见 [gate-e1-sandbox.md](gate-e1-sandbox.md)；本文件里的 `$E1_*` 变量在那里赋值一次，这里只引用。
> 全部观测来自 2026-09-21 对 GitHub.com 真实 API 的调用。**没有一条结论来自记忆或推断**：字段缺失按缺失记录，取不到的字段给出报错原文。

## 1. 这三条实验判定什么

判定目标是下面这句话，它必须在真实平台上成立，而不是只在设计文档里成立：

> 一个 project membership 指向 issue、draft 或 change request 三种内容之一；三种内容映射到内部身份时**成员关系身份与内容身份分离**，且 change request 不产生第二个工作项。

三条实验各自回答一个子问题：

| 实验 | 子问题 | 结论摘要 | 判定 |
|---|---|---|---|
| 1 · issue-backed membership | issue 作为内容时，成员关系与内容是否各有独立 id 与时间戳？ | 是。成员关系 `PVTI_*`、内容 `I_*`，时间戳两套 | pass |
| 2 · draft-backed membership | draft "没有仓库、没有编号"是什么形态，如何影响本地键？ | 不是返回 null，而是**类型上不存在**这两个字段；内容键只能落在 node id 上 | pass |
| 3 · change-request-backed membership | 同一个 change request 在三个 API 面的 id 是否一致？它产生几个工作项？ | 三个 id 互不相等；工作项计数 **2**，change request 解析为变更请求 | pass |

## 2. 三条实验记录

下面三节按 [gate-e1-sandbox.md](gate-e1-sandbox.md) §6 的九字段模板逐条填写，字段顺序固定、编号即模板编号。

### 实验 1 · issue-backed membership

**1 · 编号与目的**：实验 1。判定"一个 issue 被加入 project 后，成员关系与内容各自有独立身份，且内容身份能跨 API 复现"。

**2 · 夹具**：issue-alpha（`$E1_ISSUE_ALPHA` = `#1`，node id `I_kwDOUjWAl88AAAABST4WDQ`），它在 `$E1_PROJECT_A` 里的成员关系是 `$E1_ITEM_ALPHA`。沙箱定义见 [gate-e1-sandbox.md](gate-e1-sandbox.md) §2.3。

**3 · 请求**：

```bash
# 一次取回成员关系与内容两侧的字段
gh api graphql -f query='
query($project: ID!) {
  node(id: $project) { ... on ProjectV2 {
    items(first: 20) { nodes {
      id type createdAt updatedAt
      content { __typename
        ... on Issue { id number createdAt updatedAt repository { nameWithOwner id } } } } } } }
}' -f project="$E1_PROJECT_A_ID" --jq '.data.node.items.nodes[] | select(.content.number == 1)'

# 同一对象的 REST 面
gh api "repos/$E1_OWNER/$E1_REPO/issues/$E1_ISSUE_ALPHA" \
  --jq '{id,node_id,number,title,state,created_at,updated_at,repository_url}'
```

**4 · 观测**（原文，只删了空白；id 字面量来自本次沙箱）：

```text
# GraphQL：$E1_PROJECT_A 的条目连接里内容编号为 1 的那一条
{"id":"PVTI_lAHOAY1ahM4BkJ9rzg75k2w","type":"ISSUE",
 "createdAt":"2026-09-21T06:59:07Z","updatedAt":"2026-09-21T06:59:09Z",
 "content":{"__typename":"Issue","id":"I_kwDOUjWAl88AAAABST4WDQ","number":1,
   "createdAt":"2026-09-21T06:57:27Z","updatedAt":"2026-09-21T06:57:27Z",
   "repository":{"nameWithOwner":"SingularityKChen/e1-sandbox","id":"R_kgDOUjWAlw"}}}

# REST issues/1
{"created_at":"2026-09-21T06:57:27Z","id":5523772941,"node_id":"I_kwDOUjWAl88AAAABST4WDQ",
 "number":1,"repository_url":"https://api.github.com/repos/SingularityKChen/e1-sandbox",
 "state":"open","title":"fixture alpha (issue-backed membership)","updated_at":"2026-09-21T06:57:27Z"}
```

| 观测项 | 实测值 |
|---|---|
| 成员关系 id | `PVTI_lAHOAY1ahM4BkJ9rzg75k2w` |
| 成员关系 `type` | `ISSUE` |
| 成员关系 `createdAt` / `updatedAt` | `2026-09-21T06:59:07Z` / `2026-09-21T06:59:09Z` |
| 内容 `Issue.id` | `I_kwDOUjWAl88AAAABST4WDQ` |
| 内容 `number` | `1` |
| 内容 `repository` | `SingularityKChen/e1-sandbox`（`R_kgDOUjWAlw`） |
| 内容 `createdAt` / `updatedAt` | `2026-09-21T06:57:27Z` / `2026-09-21T06:57:27Z` |
| REST `issues/1.id` | `5523772941` |
| REST `issues/1.node_id` | `I_kwDOUjWAl88AAAABST4WDQ`（与 GraphQL `Issue.id` 逐字相同） |

从数字本身读出的三件事：

1. 成员关系 id 与内容 id 没有公共前缀（`PVTI_` 对 `I_`），也不是同一个值的两种写法。
2. 时间戳是**两套**：成员关系的 `createdAt`（`06:59:07Z`）是"加入 project"的时刻，内容的 `createdAt`（`06:57:27Z`）是"issue 被创建"的时刻，相差约 100 秒。成员关系的 `updatedAt` 比自己的 `createdAt` 晚 2 秒，而内容的两个时间戳完全相同——即加入 project 更新了成员关系，没有更新内容。
3. 该条目实测有 3 个 `fieldValues`（`ProjectV2ItemFieldRepositoryValue`、`Title` 文本、`Status` 单选 `Todo`），全部挂在**成员关系**上，没有一个挂在内容上；按 [gate-e1-sandbox.md](gate-e1-sandbox.md) §6 对「行数」的定义，其中只有 `Status` 计入「规划字段值」行。

**5 · 本地应有行**：

| 表 | 键 | 行数 | 内容 |
|---|---|---|---|
| 外部身份注册表 | `(platform=github, kind=issue, id=I_kwDOUjWAl88AAAABST4WDQ)` | 1 | 内容身份；附带 `number=1`、`repository=R_kgDOUjWAlw` |
| 成员关系表 | `(project=PVT_kwHOAY1ahM4BkJ9r, item=PVTI_lAHOAY1ahM4BkJ9rzg75k2w)` | 1 | 指向上面那条内容身份；自己的 `createdAt` / `updatedAt` 独立存储 |
| 工作项表 | 由内容身份派生 | 1 | issue 解析为一个工作项 |
| 规划字段值 | 挂在成员关系键上 | 1 | 按 [gate-e1-sandbox.md](gate-e1-sandbox.md) §6 对「行数」的定义计：该条目只有 `Status` 可写（`Title` 是内容字段，不计入） |

**计数：成员关系 1 条、工作项 1 个。**

为什么是这些行：内容身份的键里**不含 project**——同一个 issue 可以被加入多个 project；本批次已用 issue-shared（issue #2）实测 Project A 与 Project B 各有一条成员关系，内容 id 同为 `I_kwDOUjWAl88AAAABST4Wtw`，成员关系 id 分别为 `PVTI_lAHOAY1ahM4BkJ9rzg75k64` 与 `PVTI_lAHOAY1ahM4BkJ9szg75k8c`，因此内容身份不能按 project 分裂。规划字段只能挂在成员关系上；实测 3 个 `fieldValues` 全部在 item 上，但按 [gate-e1-sandbox.md](gate-e1-sandbox.md) §6 的定义只有 `Status` 计入规划字段值，因此"规划状态"与"内容"必须落在两个键上。

**6 · 意外行为**：无。加入 project 没有改动 issue 自身的任何字段（内容 `updatedAt` 与 `createdAt` 相同），符合"规划状态与工程执行状态正交"（`AGENTS.md` §1.1 第 3 条）的预期。成员关系与内容的时间戳是两套，这不是异常，而是必须记住的形态（见第 4 项第 2 条）。

**7 · 决策影响**：

- 支持"成员关系身份与内容身份分离"：两者都是稳定 id，且都能在一次 GraphQL 查询里同时取到，不需要额外往返。
- 外部身份注册表的键不能含 project（依据见上）。
- 规划字段值必须挂成员关系键；内容侧不存规划字段。
- 时间戳必须分两套存储，任何一侧都不能用另一侧的时间戳代替。

**8 · 判定**：**pass**。依据：一次查询同时取到成员关系 id 与内容 id，两者不同且各自带独立时间戳；REST `issues/1.node_id` 与 GraphQL `Issue.id` 逐字相同，说明内容身份跨 API 可复现。

**9 · 复现**：前置条件是沙箱定义 §4.1(b) 的重建等价判据通过（`$E1_PROJECT_A` 有 7 个条目、三种 `type` 齐全）。然后重跑第 3 项的两条命令。在重建出来的沙箱里 id 字面量会不同，但两条**关系**必须成立：成员关系 id 与内容 id 不同源；REST `node_id` == GraphQL `Issue.id`。

### 实验 2 · draft-backed membership

**1 · 编号与目的**：实验 2。判定 draft 作为内容时，"没有仓库、没有编号"究竟是什么形态，以及这个形态如何决定本地内容键。

**2 · 夹具**：draft-beta（`$E1_DRAFT_BETA` = `DI_lAHOAY1ahM4BkJ9rzgLKQZo`），它在 `$E1_PROJECT_A` 里的成员关系是 `$E1_ITEM_BETA`。

**3 · 请求**：

```bash
# 成员关系与 draft 内容
gh api graphql -f query='
query($project: ID!) {
  node(id: $project) { ... on ProjectV2 {
    items(first: 20) { nodes {
      id type createdAt updatedAt
      content { __typename ... on DraftIssue { id title createdAt updatedAt } } } } } }
}' -f project="$E1_PROJECT_A_ID" --jq '.data.node.items.nodes[] | select(.type == "DRAFT_ISSUE")'

# 形态探针：直接向 DraftIssue 要 repository 与 number
gh api graphql -f query='
query($draft: ID!) {
  node(id: $draft) { ... on DraftIssue { id title repository { nameWithOwner } number } }
}' -f draft="$E1_DRAFT_BETA"

# 对照：仓库的 REST issue 面里有多少对象
gh api "repos/$E1_OWNER/$E1_REPO/issues?state=all&per_page=100" --jq 'length'
```

**4 · 观测**（原文）：

```text
# GraphQL 条目（type == DRAFT_ISSUE 有两条，本实验取 draft-beta 那条）
{"id":"PVTI_lAHOAY1ahM4BkJ9rzg75k_g","type":"DRAFT_ISSUE",
 "createdAt":"2026-09-21T06:59:25Z","updatedAt":"2026-09-21T06:59:26Z",
 "content":{"__typename":"DraftIssue","id":"DI_lAHOAY1ahM4BkJ9rzgLKQZo",
   "title":"fixture beta (draft-backed membership)",
   "createdAt":"2026-09-21T06:59:25Z","updatedAt":"2026-09-21T06:59:25Z"}}

# 形态探针：原文，exit 1
{"errors":[
 {"path":["query","node","... on DraftIssue","repository"],
  "extensions":{"code":"undefinedField","typeName":"DraftIssue","fieldName":"repository"},
  "message":"Field 'repository' doesn't exist on type 'DraftIssue'"},
 {"path":["query","node","... on DraftIssue","number"],
  "extensions":{"code":"undefinedField","typeName":"DraftIssue","fieldName":"number"},
  "message":"Field 'number' doesn't exist on type 'DraftIssue'"}]}
gh: Field 'repository' doesn't exist on type 'DraftIssue'
Field 'number' doesn't exist on type 'DraftIssue'

# DraftIssue 的字段全集（introspection，按返回顺序原文）
assignees, body, bodyHTML, bodyText, createdAt, creator, id, projectV2Items, projectsV2, title, updatedAt

# 对照：REST 的 issue 面只有 5 个对象（#1–#4 与 PR #5），两个 draft 都不在其中
gh api "repos/$E1_OWNER/$E1_REPO/issues?state=all&per_page=100" --jq 'length'
5
```

| 观测项 | 实测值 |
|---|---|
| 成员关系 id | `PVTI_lAHOAY1ahM4BkJ9rzg75k_g` |
| 成员关系 `type` | `DRAFT_ISSUE` |
| 成员关系 `createdAt` / `updatedAt` | `2026-09-21T06:59:25Z` / `2026-09-21T06:59:26Z` |
| 内容 `__typename` / id | `DraftIssue` / `DI_lAHOAY1ahM4BkJ9rzgLKQZo` |
| 内容 `number` | **不存在**：`DraftIssue` 类型上没有这个字段 |
| 内容 `repository` | **不存在**：`DraftIssue` 类型上没有这个字段 |
| 内容 `createdAt` / `updatedAt` | `2026-09-21T06:59:25Z` / `2026-09-21T06:59:25Z` |
| REST 可达性 | 无。REST issue 面计数为 5，draft 不在其中 |

三点从观测直接读出：

1. "没有仓库"不是"返回了 `null`"，而是**类型上不存在这个字段**：`repository` 与 `number` 都在 `DraftIssue` 上未定义（`undefinedField`，exit 1）。两次独立证据一致：字段探针报错，introspection 的字段全集里没有它们。
2. draft 只在 **project 条目连接**里可达（`ProjectV2ItemContent` 联合的第三个成员，实测联合成员为 `DraftIssue` / `Issue` / `PullRequest`），仓库面（REST issues、GraphQL `repository.issue`）都没有它。
3. 这条的成员关系与内容时间戳几乎相同（相差 0–1 秒），因为 draft 与它的成员关系是同一次 `item-create` 调用产生的两个对象——与实验 1（issue 先存在、之后才加入 project）形态不同。

**5 · 本地应有行**：

| 表 | 键 | 行数 | 内容 |
|---|---|---|---|
| 外部身份注册表 | `(platform=github, kind=draft_issue, id=DI_lAHOAY1ahM4BkJ9rzgLKQZo)` | 1 | 内容身份；没有 `number`、没有 `repository` 可记 |
| 成员关系表 | `(project=PVT_kwHOAY1ahM4BkJ9r, item=PVTI_lAHOAY1ahM4BkJ9rzg75k_g)` | 1 | 指向上面那条内容身份 |
| 工作项表 | 由内容身份派生 | 1 | draft 解析为一个工作项 |
| 规划字段值 | 挂在成员关系键上 | 1 | 按 [gate-e1-sandbox.md](gate-e1-sandbox.md) §6 对「行数」的定义计：该条目只有 `Status` 可写（`Title` 是内容字段，不计入） |

**计数：成员关系 1 条、工作项 1 个。**

这个形态对本地键的影响，是本实验的判定对象：

- **不能用 `(repository, number)` 做内容键**：draft 两个分量都不存在，这个键在 draft 上无法构造。
- **不能用 REST 的数字 id**：draft 在 REST 上完全没有对象，拿不到数字 id。
- 唯一可用的键是 GraphQL 全局 node id（`DI_*`），即"平台 + 对象种类 + id"里的 id 分量。
- 实测该条目的 `fieldValues` 只有 2 个（`Title` 文本、`Status` 单选 `Todo`），比 issue / change request 条目少一个 `ProjectV2ItemFieldRepositoryValue`——draft 没有仓库可指。也就是说**条目上的字段值集合本身会随内容种类变化**，本地不能假设它固定。

**6 · 意外行为**：

1. draft 条目的 `fieldValues` 数量与 issue / change request 条目不同（2 对 3），差异来自一个调用方无法写入的 `ProjectV2ItemFieldRepositoryValue`。预期是"字段值只由用户写入决定"，实测还存在**由内容种类派生**的系统字段值。
2. draft 与它的成员关系落在同一秒：本地按"先建内容、再建成员关系"的两步模型写入时，会写出与平台不同的时间关系（平台上是同一个动作产生的两个对象）。

**7 · 决策影响**：

- 外部身份注册表必须接受**没有仓库、没有编号**的对象种类；键不能以 `(repository, number)` 为前提。
- 本地工作项的稳定键不能依赖编号：编号是 issue 与 change request 的属性，不是"内容"的普遍属性。
- 同步面必须知道：**按仓库同步 issue 永远看不到 draft**。draft 只能从 project 条目侧发现，因此"只按仓库做 bootstrap"的实现会漏掉全部 draft 工作项。
- 条目字段值的同步不能假设集合固定：内容种类变了（例如 draft 被转换成 issue，见 §5），条目上会出现新的系统字段值。

**8 · 判定**：**pass**。依据：`DraftIssue` 无 `number` / `repository` 由两次独立证据确认（字段探针 `undefinedField` 报错、introspection 字段全集），且 REST issue 面计数为 5（不含两个 draft），说明 draft 在仓库面上完全不可达。

**9 · 复现**：前置条件同实验 1。重跑第 3 项的三条命令。期望：条目查询返回两个 `DRAFT_ISSUE`；形态探针 **exit 1** 并逐字报出两个 `undefinedField`；REST 计数等于"issue 数 + change request 数"（本次为 5），**不等于** project 条目数（本次为 7）。

### 实验 3 · change-request-backed membership

**1 · 编号与目的**：实验 3。判定 change request 作为内容时：(a) 成员关系与内容身份的形状；(b) 同一个 change request 在三个 API 面上给出的 id 是否一致；(c) 它产生几个工作项。

**2 · 夹具**：pr-gamma（`$E1_PR_GAMMA` = `#5`，head 分支 `fixture/gamma`，base `main`，head commit `f6c8908f63d2b37b8a4638536078808bb91cfd77`），它在 `$E1_PROJECT_A` 里的成员关系是 `$E1_ITEM_GAMMA`。

**3 · 请求**：

```bash
# 成员关系与 change request 内容
gh api graphql -f query='
query($project: ID!) {
  node(id: $project) { ... on ProjectV2 {
    items(first: 20) { nodes {
      id type createdAt updatedAt
      content { __typename
        ... on PullRequest { id number createdAt updatedAt repository { nameWithOwner id } } } } } } }
}' -f project="$E1_PROJECT_A_ID" --jq '.data.node.items.nodes[] | select(.type == "PULL_REQUEST")'

# 同一个编号在 REST 的两个面上的 id
gh api "repos/$E1_OWNER/$E1_REPO/pulls/$E1_PR_GAMMA" \
  --jq '{id,node_id,number,title,state,created_at,updated_at}'
gh api "repos/$E1_OWNER/$E1_REPO/issues/$E1_PR_GAMMA" \
  --jq '{id,node_id,number,pull_request}'

# 反向探针：GraphQL 的 issue 面能不能按编号取到它
gh api graphql -f query='
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { __typename id number } }
}' -f owner="$E1_OWNER" -f name="$E1_REPO" -F number="$E1_PR_GAMMA"
```

**4 · 观测**（原文）：

```text
# GraphQL 条目（type == PULL_REQUEST）
{"id":"PVTI_lAHOAY1ahM4BkJ9rzg75k4g","type":"PULL_REQUEST",
 "createdAt":"2026-09-21T06:59:11Z","updatedAt":"2026-09-21T06:59:13Z",
 "content":{"__typename":"PullRequest","id":"PR_kwDOUjWAl88AAAABEYNntg","number":5,
   "createdAt":"2026-09-21T06:58:26Z","updatedAt":"2026-09-21T06:58:26Z",
   "repository":{"nameWithOwner":"SingularityKChen/e1-sandbox","id":"R_kgDOUjWAlw"}}}

# REST pulls/5
{"created_at":"2026-09-21T06:58:26Z","id":4588791734,"node_id":"PR_kwDOUjWAl88AAAABEYNntg",
 "number":5,"state":"open","title":"fixture gamma (change-request-backed membership)",
 "updated_at":"2026-09-21T06:58:26Z"}

# REST issues/5
{"created_at":"2026-09-21T06:58:26Z","id":5523780322,"node_id":"PR_kwDOUjWAl88AAAABEYNntg",
 "number":5,"pull_request":{"diff_url":"https://github.com/SingularityKChen/e1-sandbox/pull/5.diff",
   "html_url":"https://github.com/SingularityKChen/e1-sandbox/pull/5","merged_at":null,
   "patch_url":"https://github.com/SingularityKChen/e1-sandbox/pull/5.patch",
   "url":"https://api.github.com/repos/SingularityKChen/e1-sandbox/pulls/5"},
 "state":"open","title":"fixture gamma (change-request-backed membership)",
 "updated_at":"2026-09-21T06:58:26Z"}

# 反向探针：原文，exit 1
{"data":{"repository":{"issue":null}},
 "errors":[{"type":"NOT_FOUND","path":["repository","issue"],
   "message":"Could not resolve to an Issue with the number of 5."}]}
gh: Could not resolve to an Issue with the number of 5.
```

**同一个 change request 的 id 对照（本实验的核心）**：

| 取值面 | 字段 | 实测值 |
|---|---|---|
| GraphQL 内容 | `PullRequest.id` | `PR_kwDOUjWAl88AAAABEYNntg` |
| REST change request 面 | `pulls/5.id` | `4588791734` |
| REST issue 面 | `issues/5.id` | `5523780322` |
| REST change request 面 | `pulls/5.node_id` | `PR_kwDOUjWAl88AAAABEYNntg` |
| REST issue 面 | `issues/5.node_id` | `PR_kwDOUjWAl88AAAABEYNntg` |

三个 id **互不相等**：`PR_kwDOUjWAl88AAAABEYNntg` ≠ `4588791734` ≠ `5523780322`。唯一跨面一致的是 node id：GraphQL `PullRequest.id` 与两个 REST 端点的 `node_id` 逐字相同。

其余观测项：

| 观测项 | 实测值 |
|---|---|
| 成员关系 id | `PVTI_lAHOAY1ahM4BkJ9rzg75k4g` |
| 成员关系 `type` | `PULL_REQUEST` |
| 成员关系 `createdAt` / `updatedAt` | `2026-09-21T06:59:11Z` / `2026-09-21T06:59:13Z` |
| 内容 `__typename` / `number` | `PullRequest` / `5` |
| 内容 `repository` | `SingularityKChen/e1-sandbox`（`R_kgDOUjWAlw`） |
| 内容 `createdAt` / `updatedAt` | `2026-09-21T06:58:26Z` / `2026-09-21T06:58:26Z` |
| GraphQL issue 面可达性 | **不可达**：`issue(number: 5)` 返回 `null` 并报 `NOT_FOUND`（exit 1） |

**5 · 本地应有行**：

| 表 | 键 | 行数 | 内容 |
|---|---|---|---|
| 外部身份注册表 | `(platform=github, kind=issue, id=I_kwDOUjWAl88AAAABST4WDQ)` | 1 | 实验 1 的 issue-alpha |
| 外部身份注册表 | `(platform=github, kind=draft_issue, id=DI_lAHOAY1ahM4BkJ9rzgLKQZo)` | 1 | 实验 2 的 draft-beta |
| 外部身份注册表 | `(platform=github, kind=change_request, id=PR_kwDOUjWAl88AAAABEYNntg)` | 1 | 本实验的 pr-gamma；**不新增工作项** |
| 成员关系表 | `(project=PVT_kwHOAY1ahM4BkJ9r, item=…)` ×3 | 3 | alpha / beta / gamma 三条成员关系 |
| 工作项表 | 由内容身份派生 | **2** | issue 一个、draft 一个 |
| 变更请求表 | 指向上面那条 `change_request` 内容身份 | 1 | pr-gamma 解析为变更请求 |
| 规划字段值 | 挂在成员关系键上 | 1 / 1 / 1 | 分别对应 alpha / beta / gamma 条目；按 [gate-e1-sandbox.md](gate-e1-sandbox.md) §6 对「行数」的定义计，三个条目都只有 `Status` 可写 |

**计数：成员关系 3 条、工作项 2 个、变更请求 1 条。**

> **订正（2026-09-22）**：「规划字段值」这一行的「行数」列原先在三处含义不同——实验 1 填的是用户可写的规划字段数（`1`），实验 2 填的是原始 `fieldValues` 数（`2`），本表按"用户可写"手算时沿用了实验 2 的原始数，于是 beta 格得 `0`。现在这一列的语义只在 [gate-e1-sandbox.md](gate-e1-sandbox.md) §6 定义一次（只计用户可写的规划字段值），三处按同一定义填写：beta 实际有 1 个（`Status` = `Todo`），本表因此是 `1 / 1 / 1`。被替换掉的原值——实验 2 的 `2` 与本表 beta 格的 `0`——保留在本注记里。

上表只覆盖 E1-1 的三条夹具。把 `$E1_PROJECT_A` 的**全部 7 个条目**按同一规则映射，得到的是：内容身份 7 条（4 个 issue、2 个 draft、1 个 change request）、成员关系 7 条、**工作项 6 个**、变更请求 1 条——条目数 7 与工作项数 6 的差正好是那条 change request。

为什么工作项是 **2** 而不是 3：change request 是**交付**侧的产物。它的规划语义由成员关系承载，工程语义由变更请求承载；如果同时给它建一个工作项，同一个底层对象就有了两个工程身份，与 `AGENTS.md` §1.1 第 6 条（工程产物关系沿谱系传播，不反复重新识别）冲突。本实验里 `$E1_PROJECT_A` 的 7 个条目覆盖 4 个 issue、2 个 draft、1 个 change request；其中只有 issue 与 draft 派生工作项，change request 解析为变更请求。

**6 · 意外行为**：

1. **REST 的 issue 面把 change request 当 issue 返回，却给了另一个数字 id**：`issues/5.id = 5523780322`，而 `pulls/5.id = 4588791734`。同一个编号、同一个底层对象，在同一个平台的 REST 面上有两个不同的数字 id。这是本批次最重要的实测形态：本地若按"平台 + id"建键并混用两个端点，会为同一个 change request 建出两行。
2. **两个 API 对"编号 5 是不是一个 issue"给出的答案相反**：REST `issues/5` 返回了对象，GraphQL `repository.issue(number: 5)` 返回 `null` 并报 `NOT_FOUND`。调用方只看 `data` 就会把"这个编号不存在"当成事实。
3. `ProjectV2Item.type` 是 `PULL_REQUEST`，而 `content.__typename` 是 `PullRequest`——两个枚举词形不同（下划线 vs 驼峰）。本地做映射时不能按字符串相等匹配。

**7 · 决策影响**（含 D5 判定）：

- 外部身份注册表的键必须是 **平台 + 对象种类 + id**，不能是"平台 + 单一规范 id"。依据就是第 6 项第 1 条：同一个 change request 在 REST 的两个端点上给出两个不同的数字 id，只按"平台 + id"建键会产生两行。
- 跨 API 稳定的那个值是 **GraphQL 全局 node id**（`PR_kwDOUjWAl88AAAABEYNntg`），它同时是 REST 两个端点的 `node_id`。因此 id 这一格应当存 node id；REST 的数字 id 只是某个 API 面内的局部标识，不能当主键。
- 对象种类必须显式存储并参与键。`I_` / `PR_` / `DI_` 前缀确实隐含了种类，但注册表不应靠"解析 id 前缀"来决定种类：种类来自 `__typename` 或 `ProjectV2Item.type` 的显式映射，前缀只作为一致性校验。
- change request 不产生工作项：成员关系指向 change request 时，解析结果是"变更请求"，工作项计数不增加。

**8 · 判定**：**pass**。依据：三个 id 由三条独立命令实测取得且互不相等；"GraphQL issue 面不可达"有 `NOT_FOUND` 原文；工作项计数 2 由内容种类推出（issue 1 + draft 1，change request 解析为变更请求）。

**9 · 复现**：前置条件同实验 1。重跑第 3 项的四条命令。期望：条目查询返回一条 `PULL_REQUEST`；`pulls/5.id` 与 `issues/5.id` 是两个不同的数字，而两者的 `node_id` 与 GraphQL `PullRequest.id` 三者逐字相同；反向探针 **exit 1** 并报 `NOT_FOUND`。

## 3. 外部身份注册表的键：判定与依据

**判定：键是「平台 + 对象种类 + id」，id 存 GraphQL 全局 node id。**

| 依据 | 实测内容 |
|---|---|
| 同一对象在不同 API 面有不同 id | `pulls/5.id = 4588791734`，`issues/5.id = 5523780322`（实验 3） |
| 跨面一致的是 node id | GraphQL `PullRequest.id` == 两个 REST 端点的 `node_id` == `PR_kwDOUjWAl88AAAABEYNntg`（实验 3） |
| 内容身份与成员关系身份不同源 | `I_*` / `PR_*` / `DI_*` 对 `PVTI_*`（实验 1、2、3） |
| 对象种类必须显式 | `ProjectV2Item.type` 的三个取值 `ISSUE` / `PULL_REQUEST` / `DRAFT_ISSUE` 与 `__typename` 词形不同（实验 3） |
| 有的种类没有编号与仓库 | `DraftIssue` 上 `number` / `repository` 未定义（实验 2） |

反例构造：若键是"平台 + 单一规范 id"，那么对同一个 change request，`issues/5.id` 与 `pulls/5.id` 会指向同一个底层对象却产生两个键——除非实现方额外知道"该用哪个端点"，而实验 3 第 6 项第 2 条正好证明两个端点对同一编号给出相反答案，这个"额外知识"本身不可靠。

**未证明的部分**（不要在 E1-4 裁决前当成已知）：

- 同一个 change request 加入两个 project 时，成员关系身份是否如 issue 那样按 project 分裂——本批次只观测了 issue 的多 project 形态（沙箱定义 §2.3 的 issue-shared），未观测 change request 的多 project 形态。
- draft 转成 issue 之后内容 id 是否变化——那是 E1-2 的 draft-convert 夹具，本批次只读，未观测。
- `ProjectV2ItemType.REDACTED` 何时出现——枚举里有这个取值（introspection 实测），但没有夹具被删除，因此没有观测。
- 分页边界：本次所有查询都在单页内返回（条目数 ≤ 7），没有观测跨页时 id 或时间戳的行为。

## 4. 剩余未验证假设清单

| 假设 | 为什么本批次没有证据 | 归属 |
|---|---|---|
| draft 转换后内容身份的处理方式 | 转换夹具 `draft-convert` 本批次只读 | E1-2（#23） |
| 字段写入后成员关系的 `updatedAt` 如何变化 | 写字段属 E1-3 的范围，本批次只读 | E1-3（#24） |
| change request 的多 project 成员关系形态 | 本批次未建立该夹具 | E1-2 或 E1-4 |
| `REDACTED` 条目类型的触发条件与 `content` 形状 | 需要删除内容，会破坏正在被观测的夹具 | E1-4 决定是否补测 |
