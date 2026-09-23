# Gate E1 沙箱定义

> 本文件定义 Gate E1 观测使用的一次性私有沙箱：对象清单与 id、创建步骤、重建步骤、拆除步骤，以及 E1-1 / E1-2 / E1-3 / E1-4 逐字复用的**九字段记录模板**。
> 它回答"这些观测是在什么对象上做的、别人怎么建出等价环境、怎么删干净"；"观测到了什么"写在记录文件里，本批次的三条记录见 [gate-e1-content-identities.md](gate-e1-content-identities.md)。
> 依据 `AGENTS.md` §3：本文件自包含，不引用不随仓库分发的外部输入。沙箱的运行态清单属于 `.superpowers/`，不进仓库；本文件是它的仓库内正式表述。

## 1. 沙箱的边界

- 沙箱是**一个私有仓库**加**两个 user-owned Project v2**，只放夹具（fixture），不放任何真实项目数据。
- 硬约束：不在 `SingularityKChen/harness-projects` 自身、也不在它的 Projects 看板上创建任何夹具。观测会写字段、会转换 draft，这些副作用不允许落在真实工作上。
- 沙箱是**一次性**的：它的价值是"观测发生时对象长这样"，不是长期基础设施。任何时刻都可以按 §5 删干净。
- 夹具按批次分所有权（§2.3）。一个批次只写自己的夹具；跨批次观测同一条记录会互相改写，因此夹具不重叠。

## 2. 对象清单

### 2.1 变量

本文件是**沙箱级 `$E1_*` 变量**的唯一赋值处：记录文件与后续批次一律引用变量名，不重复写值。这条只约束**变量赋值**——记录文件里出现的 id 字面量属观测值（「这次调用返回了哪个 id」），不构成第二赋值处。

> **已知缺口（2026-09-22）**：上面这条约束没有被完全执行，记录文件里出现过 `E1_*=…` 赋值。[gate-e1-membership-and-draft.md](gate-e1-membership-and-draft.md) §2.2 为它自己的两个夹具定义了本文件没有定义的变量（它声明那处是那些变量的唯一赋值处），并把 §2.4 已记录的 Project A `Status` 字段 id 又赋给 `E1_STATUS_FIELD_A`；[gate-e1-write-and-events.md](gate-e1-write-and-events.md) 的「命令约定」重列了沙箱级变量名（多数写成 `<...>` 占位符）。本批次**不为这一项加机械检查**——修它要动已合并的记录文件；缺口如实记在这里，不写成「全部合规」。

```bash
E1_OWNER=SingularityKChen                    # 公开账号，与本仓库 owner 相同
E1_REPO=e1-sandbox                           # 私有沙箱仓库
E1_CLONE=<sandbox-clone>                     # 会话内的临时目录占位符（不是真实路径）
E1_PROJECT_A=11                              # Project A 的 number
E1_PROJECT_B=12                              # Project B 的 number
E1_PROJECT_A_ID=PVT_kwHOAY1ahM4BkJ9r         # Project A 的 node id（GraphQL 用）
E1_PROJECT_B_ID=PVT_kwHOAY1ahM4BkJ9s         # Project B 的 node id
E1_ISSUE_ALPHA=1                             # issue-alpha 的编号
E1_PR_GAMMA=5                                # pr-gamma 的编号
E1_ITEM_ALPHA=PVTI_lAHOAY1ahM4BkJ9rzg75k2w   # issue-alpha 在 Project A 的成员关系
E1_ITEM_BETA=PVTI_lAHOAY1ahM4BkJ9rzg75k_g    # draft-beta 在 Project A 的成员关系
E1_ITEM_GAMMA=PVTI_lAHOAY1ahM4BkJ9rzg75k4g   # pr-gamma 在 Project A 的成员关系
E1_DRAFT_BETA=DI_lAHOAY1ahM4BkJ9rzgLKQZo     # draft-beta 的内容 id
```

### 2.2 仓库与项目

| 对象 | 值 |
|---|---|
| 仓库 | `$E1_OWNER/$E1_REPO`，`private`，默认分支 `main` |
| 仓库 id | REST `1379238039`；GraphQL node id `R_kgDOUjWAlw` |
| Project A | 标题 `E1 Project A`，number `11`，node id `PVT_kwHOAY1ahM4BkJ9r`，user-owned，非公开，7 个条目 |
| Project B | 标题 `E1 Project B`，number `12`，node id `PVT_kwHOAY1ahM4BkJ9s`，user-owned，非公开，1 个条目 |

两个项目都归属同一个 user（`owner.type == "User"`），不是 organization project——这条决定了条目归属与权限模型，重建时不能建成 org project。

### 2.3 夹具与所有权

沙箱建立于 2026-09-21（对象创建时间落在 `06:57Z`–`06:59Z`）。下表是全部夹具；**本批次（E1-1）对除自己三条以外的全部夹具只读**。

| 夹具 | 种类 | 位置 | 编号 / id | 归属批次 |
|---|---|---|---|---|
| issue-alpha | Issue | Project A | `#1`，node id `I_kwDOUjWAl88AAAABST4WDQ` | E1-1 |
| draft-beta | DraftIssue | Project A | `DI_lAHOAY1ahM4BkJ9rzgLKQZo` | E1-1 |
| pr-gamma | PullRequest | Project A | `#5`，node id `PR_kwDOUjWAl88AAAABEYNntg`，head 分支 `fixture/gamma` | E1-1 |
| issue-shared | Issue | Project A + Project B | `#2`，node id `I_kwDOUjWAl88AAAABST4Wtw`；成员关系 `PVTI_lAHOAY1ahM4BkJ9rzg75k64`（Project A）/ `PVTI_lAHOAY1ahM4BkJ9szg75k8c`（Project B） | E1-2 |
| draft-convert | DraftIssue | Project A | `DI_lAHOAY1ahM4BkJ9rzgLKQZ0` | E1-2 |
| issue-writable | Issue | Project A | `#3`，node id `I_kwDOUjWAl88AAAABST4XVQ` | E1-3 |
| issue-dupe | Issue | Project A | `#4`，node id `I_kwDOUjWAl88AAAABST4X6Q` | E1-2 / E1-3 |

`issue-dupe` 与 `issue-writable` 的具体归属以 E1-2（#23）与 E1-3（#24）的 ExecPlan 为准；两者在本批次都只读，因此归属分歧不影响本批次的观测。

夹具正文都是 `Gate E1 fixture.` 开头的一句话，说明它是可删除的观测目标：

| 夹具 | 标题 | 正文 |
|---|---|---|
| issue-alpha | `fixture alpha (issue-backed membership)` | `Gate E1 fixture. Read-only observation target.` |
| issue-shared | `fixture shared (multi-project membership)` | `Gate E1 fixture. Added to two projects.` |
| issue-writable | `fixture writable (field writes)` | `Gate E1 fixture. Receives field writes.` |
| issue-dupe | `fixture dupe (duplicate add)` | `Gate E1 fixture. Added to the same project twice.` |
| pr-gamma | `fixture gamma (change-request-backed membership)` | `Gate E1 fixture. Not to be merged; the sandbox is disposable.` |
| draft-beta | `fixture beta (draft-backed membership)` | `Gate E1 fixture draft.` |
| draft-convert | `fixture convert (draft to issue)` | `Gate E1 fixture draft for conversion.` |

### 2.4 自定义字段

Project A 比 Project B 多三个自定义字段，实测 `fields.totalCount` 为 `16` 对 `13`；一个刚建好的空 project 的 `fields.totalCount` 也是 `13`（2026-09-21 探针实测，见 §4.2）。

| 字段 | 类型 | id | 用途 |
|---|---|---|---|
| `Status` | single select | `PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY` | 默认字段；选项 `Todo` / `In Progress` / `Done` |
| `E1 Text` | text | `PVTF_lAHOAY1ahM4BkJ9rzhi7k8M` | E1-3 的字段写入夹具 |
| `E1 Date` | date | `PVTF_lAHOAY1ahM4BkJ9rzhi7k9I` | E1-3 的字段写入夹具 |
| `E1 Iteration` | iteration | `PVTIF_lAHOAY1ahM4BkJ9rzhi7k9M` | E1-3；含迭代 `E1 Sprint 1`（id `7b232bc3`，起始 `2026-09-21`，7 天） |

三个 `E1 *` 字段属于 E1-3 的使用范围，本批次只读。

### 2.5 清单外的 id

记录文件里出现过、但不在 §2.3（夹具）与 §2.4（字段）两张表里的 id。登记它们是为了让「记录文件里的每个 id 字面量都能在本文件找到出处」这条不变量成立。来源分四类：观测期间临时创建并已删除、转换动作产生、内置字段、另一个 project 的字段。

| id | 是什么 | 何时产生 / 删除 | 为什么不在 §2.3 / §2.4 |
|---|---|---|---|
| `PVTI_lAHOAY1ahM4BkJ9rzg75sRg` | E1-3 探测 `contentId` 接受范围时临时创建的第一个 draft 夹具在 Project A 的成员关系 | E1-3 探测期间创建，写记录前删除；删除后 Project A 回到 7 条 | 临时夹具，不是 §2.3 登记的那七个保留条目 |
| `PVTI_lAHOAY1ahM4BkJ9rzg75sTE` | 同上，第二个临时 draft 夹具 | 同上 | 同上 |
| `I_kwDOUjWAl88AAAABSUC8og` | E1-2 的 draft-convert 夹具转换后得到的内容 id（issue #6） | E1-2 执行 `convertProjectV2DraftIssueItemToIssue` 时由转换动作产生，不是新建夹具 | §2.3 登记的是转换前的 draft 内容 id `DI_lAHOAY1ahM4BkJ9rzgLKQZ0`；转换后的 issue 不是独立夹具 |
| `PVTSSF_lAHOAY1ahM4BkJ9szhi7jXQ` | Project B 的 `Status` 字段 id | 建沙箱时随 Project B 产生，未删除；E1-2 观测时读到 | §2.4 的表只列 Project A 的字段 |
| `PVTF_lAHOAY1ahM4BkJ9rzhi7jWQ` | Project A 的 `Title` 字段 id；E1-3 实验 1 §4.2 的响应里它以 `name = "Title"` 出现 | 建 Project A 时就有，未删除 | §2.4 的表只列自定义字段与 E1 用到的字段，`Title` 没有登记；它的值属内容派生，按 §6 不计入「规划字段值」行 |

### 2.6 构造的输入（不是平台对象）

- `I_kwDOUjWAl88AAAABST4XXXX`：E1-3 为取得 `NOT_FOUND` 原文而**故意写错**的 id（把一个真实 issue node id 的末四位替换成 `XXXX`），从来不是平台对象。

本节列的是**输入**，不是被观测对象：上面这个 id 没有被创建，也没有对应的平台对象；登记它是为了让「记录文件里的每个 id 字面量都能在本文件找到出处」这条不变量成立，并让复现步骤完整。

## 3. 创建步骤

命令形式以 `gh <cmd> --help` 逐条核对（2026-09-21）；对象本身创建于本批次开工之前，因此**创建步骤没有逐条重跑**——重跑会在正在被 E1-2 / E1-3 观测的沙箱里留下重复夹具。可执行的部分（字段创建、条目创建、条目读取、项目删除）在 §4.2 的一次性探针里实测过，输出见该节。

```bash
# 1) 私有仓库
gh repo create "$E1_OWNER/$E1_REPO" --private --add-readme \
  --description "Disposable Gate E1 observation sandbox"

# 2) 两个 user-owned project（用 --owner 指定用户，不要建成 org project）
gh project create --owner "$E1_OWNER" --title "E1 Project A" --format json
gh project create --owner "$E1_OWNER" --title "E1 Project B" --format json

# 3) 自定义字段：TEXT / DATE 用 gh project field-create
gh project field-create "$E1_PROJECT_A" --owner "$E1_OWNER" --name "E1 Text" --data-type TEXT --format json
gh project field-create "$E1_PROJECT_A" --owner "$E1_OWNER" --name "E1 Date" --data-type DATE --format json
# ITERATION 不在 gh project field-create 的 --data-type 取值里（只有 TEXT|SINGLE_SELECT|DATE|NUMBER），
# 必须走 GraphQL mutation createProjectV2Field：
gh api graphql -f query='
mutation($project: ID!) {
  createProjectV2Field(input: {
    projectId: $project, dataType: ITERATION, name: "E1 Iteration",
    iterationConfiguration: {startDate: "2026-09-21", duration: 7,
      iterations: [{title: "E1 Sprint 1", startDate: "2026-09-21", duration: 7}]}
  }) { projectV2Field { ... on ProjectV2IterationField { id name } } }
}' -f project="$E1_PROJECT_A_ID"

# 4) issue 夹具：四条 issue 各执行一次，标题与正文取自 §2.3 的表（下面以 issue-alpha 为例）
gh issue create --repo "$E1_OWNER/$E1_REPO" \
  --title "fixture alpha (issue-backed membership)" \
  --body "Gate E1 fixture. Read-only observation target."

# 5) change request 夹具（pr-gamma）：空提交 + 一个分支 + 一个 PR
# $E1_CLONE 见 §2.1：会话内的临时目录占位符，不是真实路径
git clone "https://github.com/$E1_OWNER/$E1_REPO.git" "$E1_CLONE" && cd "$E1_CLONE"
git checkout -b fixture/gamma && git commit --allow-empty -m "fixture gamma" && git push -u origin fixture/gamma
gh pr create --repo "$E1_OWNER/$E1_REPO" --head fixture/gamma --base main \
  --title "fixture gamma (change-request-backed membership)" \
  --body "Gate E1 fixture. Not to be merged; the sandbox is disposable."

# 6) 把内容加入 project：issue / change request 用 item-add，draft 用 item-create
gh project item-add "$E1_PROJECT_A" --owner "$E1_OWNER" \
  --url "https://github.com/$E1_OWNER/$E1_REPO/issues/1" --format json    # issue-alpha
gh project item-add "$E1_PROJECT_A" --owner "$E1_OWNER" \
  --url "https://github.com/$E1_OWNER/$E1_REPO/pull/5" --format json      # pr-gamma
gh project item-create "$E1_PROJECT_A" --owner "$E1_OWNER" \
  --title "fixture beta (draft-backed membership)" --body "Gate E1 fixture draft." --format json

# 7) E1-2 / E1-3 的夹具（本批次只读，但重建等价沙箱时必须一起建，
#    否则 §4.1(b) 的条目数判据不成立）
gh project item-add "$E1_PROJECT_A" --owner "$E1_OWNER" \
  --url "https://github.com/$E1_OWNER/$E1_REPO/issues/2" --format json    # issue-shared
gh project item-add "$E1_PROJECT_B" --owner "$E1_OWNER" \
  --url "https://github.com/$E1_OWNER/$E1_REPO/issues/2" --format json    # 同一个 issue 的第二个 project
gh project item-add "$E1_PROJECT_A" --owner "$E1_OWNER" \
  --url "https://github.com/$E1_OWNER/$E1_REPO/issues/3" --format json    # issue-writable
gh project item-add "$E1_PROJECT_A" --owner "$E1_OWNER" \
  --url "https://github.com/$E1_OWNER/$E1_REPO/issues/4" --format json    # issue-dupe
gh project item-create "$E1_PROJECT_A" --owner "$E1_OWNER" \
  --title "fixture convert (draft to issue)" --body "Gate E1 fixture draft for conversion." --format json
```

`issue-dupe` 的夹具定义是"同一个 issue 加入同一个 project 两次"。沙箱的运行态清单记录过这条观测：第二次 `item-add` 返回**同一条** item id，因此 Project A 仍然是 7 条而不是 8 条。本批次**没有重跑**这次重复添加——重跑会在正在被 E1-2 / E1-3 观测的共享沙箱里制造额外副作用；重建等价沙箱时把上面第 7 步最后一条 issue 的 `item-add` 执行两次即可复现。

`gh repo create` 会新建仓库，`gh project create` 会消耗一个 project 编号（本次沙箱拿到 `11`、`12`）。**编号不是契约**：重建出来的等价沙箱会有不同的编号与 node id，等价性由 §4.1(b) 的判据决定，不是由 id 字面量决定。

## 4. 重建步骤

### 4.1 重建判据：当前状态回读与等价判据

重建完成不是"命令都跑完了"。这一节分两段：**(a) 当前状态回读**记录某一次观测时刻的沙箱原文，它是快照；**(b) 重建等价判据**只写形状，重建出来的沙箱按它判定。

#### (a) 当前状态回读（快照，不是重建判据）

下面这条查询取回 Project A 的条目连接；`$E1_PROJECT_A_ID` 是 §2.1 里赋值的那个 node id，重建出来的沙箱换成自己的 node id：

```bash
gh api graphql -f query='
query($project: ID!) {
  node(id: $project) { ... on ProjectV2 {
    number title
    items(first: 20) { totalCount nodes {
      id type createdAt updatedAt
      content { __typename
        ... on Issue { id number repository { nameWithOwner } }
        ... on PullRequest { id number repository { nameWithOwner } }
        ... on DraftIssue { id title } } } } } }
}' -f project="$E1_PROJECT_A_ID"
```

历史观测快照（**2026-09-21 07:18:02Z 的沙箱状态**；下面把当时真实响应里的七个条目压成每个条目一行，字段值取自该响应，没有补写）：

```text
"number":11,"title":"E1 Project A","items":{"totalCount":7,
  ISSUE         PVTI_lAHOAY1ahM4BkJ9rzg75k2w  Issue        #1  I_kwDOUjWAl88AAAABST4WDQ  SingularityKChen/e1-sandbox
  PULL_REQUEST  PVTI_lAHOAY1ahM4BkJ9rzg75k4g  PullRequest  #5  PR_kwDOUjWAl88AAAABEYNntg SingularityKChen/e1-sandbox
  ISSUE         PVTI_lAHOAY1ahM4BkJ9rzg75k64  Issue        #2  I_kwDOUjWAl88AAAABST4Wtw  SingularityKChen/e1-sandbox
  ISSUE         PVTI_lAHOAY1ahM4BkJ9rzg75k-I  Issue        #3  I_kwDOUjWAl88AAAABST4XVQ  SingularityKChen/e1-sandbox
  DRAFT_ISSUE   PVTI_lAHOAY1ahM4BkJ9rzg75k_g  DraftIssue       DI_lAHOAY1ahM4BkJ9rzgLKQZo
  DRAFT_ISSUE   PVTI_lAHOAY1ahM4BkJ9rzg75lAw  DraftIssue       DI_lAHOAY1ahM4BkJ9rzgLKQZ0
  ISSUE         PVTI_lAHOAY1ahM4BkJ9rzg75lGI  Issue        #4  I_kwDOUjWAl88AAAABST4X6Q  SingularityKChen/e1-sandbox
```

该快照读取于本批次的分支 `test/e1-content-identities`（`gh api graphql` 按 node id 取数，不按当前目录解析仓库，工作目录不影响结果）；它锚定的是**读取时刻**（2026-09-21 07:18:02Z）——沙箱在仓库之外，这里没有可引用的仓库 head。本节不把快照写成当前事实，也不作为重建判据（重建判据见 (b)）。快照里七个条目包含两个 **draft 夹具**（draft-beta 与 draft-convert），它们当时都是 `DRAFT_ISSUE`；E1-2 转换 draft-convert 之后，同一条命令看到的 `type` 分布会与快照不同——这正是判据不能引用 id、也不能引用当时分布的原因。draft 夹具的条目**没有** `number` 也没有 `repository`（§2.3 的表里它们那两列是空的，这不是省略）。

Project B 的同一次回读（`$E1_PROJECT_B_ID` 同样是 §2.1 里赋值的那个 node id）：

```bash
gh api graphql -f query='
query($project: ID!) {
  node(id: $project) { ... on ProjectV2 { number items(first: 10) { totalCount nodes { id type content { ... on Issue { id number } } } } } }
}' -f project="$E1_PROJECT_B_ID"
```

#### (b) 重建等价判据（只写形状）

重建出来的沙箱有不同的编号与 node id（§3 末段），因此判据只写形状、**不含任何 node id 字面量**，也不依赖 E1-2 转换之后的状态：`draft-convert` 在重建后是 `DRAFT_ISSUE`，转换后是 `ISSUE`，两种状态都必须满足下面的期望输出。

Project A：条目数 `7`，且三种 `type`（`ISSUE` / `PULL_REQUEST` / `DRAFT_ISSUE`）齐全。把 `$E1_PROJECT_A` 换成重建出来的 project number（`gh project create --format json` 返回的 `number`）后运行：

```bash
gh api graphql -f query='
query($owner: String!, $number: Int!) {
  user(login: $owner) { projectV2(number: $number) {
    items(first: 20) { totalCount nodes { type } } } }
}' -f owner="$E1_OWNER" -F number="$E1_PROJECT_A" \
  --jq '{totalCount: .data.user.projectV2.items.totalCount,
         types: ([.data.user.projectV2.items.nodes[].type] | unique)}'
```

期望输出（`types` 是去重后的集合，不含条目顺序与 id）：

```text
{"totalCount":7,"types":["DRAFT_ISSUE","ISSUE","PULL_REQUEST"]}
```

Project B：条目数 `1`，且那一个条目的 `type` 是 `ISSUE`：

```bash
gh api graphql -f query='
query($owner: String!, $number: Int!) {
  user(login: $owner) { projectV2(number: $number) {
    items(first: 10) { totalCount nodes { type } } } }
}' -f owner="$E1_OWNER" -F number="$E1_PROJECT_B" \
  --jq '{totalCount: .data.user.projectV2.items.totalCount,
         types: ([.data.user.projectV2.items.nodes[].type] | unique)}'
```

期望输出：

```text
{"totalCount":1,"types":["ISSUE"]}
```

条目数比期望少时先重查一次再判断：条目连接有读后写延迟（§4.2 实测）。

### 4.2 可执行步骤的实测探针（2026-09-21）

创建步骤里唯一没有历史证据的部分（字段创建、条目创建、条目读取、项目删除）用一个**一次性探针项目**实测过，跑完立即删除。探针实测到的原文：

```text
gh project create --owner "$E1_OWNER" --title "E1 Sandbox Rebuild Probe" --format json
{"closed":false,"fields":{"totalCount":13},"id":"PVT_kwHOAY1ahM4BkKDd","items":{"totalCount":0},
 "number":13,"owner":{"login":"SingularityKChen","type":"User"},"public":false,
 "title":"E1 Sandbox Rebuild Probe","url":"https://github.com/users/SingularityKChen/projects/13"}

gh project field-create 13 --owner "$E1_OWNER" --name "E1 Text" --data-type TEXT --format json
{"id":"PVTF_lAHOAY1ahM4BkKDdzhi7o54","name":"E1 Text","type":"ProjectV2Field"}
gh project field-create 13 --owner "$E1_OWNER" --name "E1 Date" --data-type DATE --format json
{"id":"PVTF_lAHOAY1ahM4BkKDdzhi7o58","name":"E1 Date","type":"ProjectV2Field"}
gh api graphql -f query='mutation($project: ID!) { createProjectV2Field(input: {projectId: $project, dataType: ITERATION, name: "E1 Iteration", iterationConfiguration: {startDate: "2026-09-21", duration: 7, iterations: [{title: "E1 Sprint 1", startDate: "2026-09-21", duration: 7}]}}) { projectV2Field { ... on ProjectV2IterationField { id name configuration { duration startDay iterations { id title startDate duration } } } } } }' -f project=PVT_kwHOAY1ahM4BkKDd
{"data":{"createProjectV2Field":{"projectV2Field":{"id":"PVTIF_lAHOAY1ahM4BkKDdzhi7o6A","name":"E1 Iteration",
 "configuration":{"duration":7,"startDay":1,"iterations":[{"id":"63438f2f","title":"E1 Sprint 1","startDate":"2026-09-21","duration":7}]}}}}}

gh project item-create 13 --owner "$E1_OWNER" --title "probe draft (rebuild step)" --body "rebuild probe" --format json
{"body":"rebuild probe","id":"PVTI_lAHOAY1ahM4BkKDdzg75sIw","title":"probe draft (rebuild step)","type":"DraftIssue"}
gh project item-add 13 --owner "$E1_OWNER" --url "https://github.com/$E1_OWNER/$E1_REPO/issues/1" --format json
{"body":"Gate E1 fixture. Read-only observation target.","id":"PVTI_lAHOAY1ahM4BkKDdzg75sKE",
 "title":"fixture alpha (issue-backed membership)","type":"Issue",
 "url":"https://github.com/SingularityKChen/e1-sandbox/issues/1"}

# 删除（无输出，exit 0）；删除后项目列表里不再有 number 13
gh project delete 13 --owner "$E1_OWNER"
```

探针顺带实测到一条与同步正确性有关的形态，**必须知道**：`gh project item-add` 返回成功后，**紧随其后**的 `items` 查询只看到 `totalCount: 1`（只有 draft 那一条），约 3 秒后重查才看到 `totalCount: 2`。也就是说 project 条目连接存在读后写延迟；"写入返回成功"不等于"下一次读能看到"。判定重建是否完成时，如果条目数比期望少，先重查一次再判断，不要据此认定命令失败。

## 5. 拆除步骤

拆除单位是"仓库 + 两个 project"，两者互相独立：删 project 不影响仓库，删仓库不影响 project。

```bash
# 1) 删两个 project（各自无输出，exit 0；删除不可恢复）
gh project delete "$E1_PROJECT_A" --owner "$E1_OWNER"
gh project delete "$E1_PROJECT_B" --owner "$E1_OWNER"

# 2) 删仓库：需要 delete_repo scope，且必须显式写出 OWNER/REPO 才能用 --yes 免交互
gh auth refresh -s delete_repo
gh auth status              # 期望：刷新授权后的输出里含 delete_repo
gh repo delete "$E1_OWNER/$E1_REPO" --yes

# 3) 回读：项目列表里不再有 11 / 12；仓库返回 404
gh project list --owner "$E1_OWNER" --limit 30 --format json
gh api "repos/$E1_OWNER/$E1_REPO" ; echo "exit=$?"   # 期望：404，exit 1
```

已实测的部分：`gh project delete` 单次调用 exit 0 且无输出，删除后 `gh project list` 里不再出现该编号（§4.2）。**未实测**的部分：`gh repo delete`——仓库删除需要 `delete_repo` scope，因此必须先按上面第一步刷新授权（`gh repo delete --help` 明写这是先决条件）；回读用 `gh auth status`，期望刷新授权后的输出里含 `delete_repo`。仓库删除由人类伙伴决定何时执行。

## 6. 九字段记录模板

每条实验记录按下列九个字段填写，**顺序固定**，E1-1 / E1-2 / E1-3 / E1-4 逐字复用同一模板。缺字段的记录不算证据（判定"证据是否齐全"看的是这九项，不是"跑过了"）。

| # | 字段 | 内容要求 |
|---|---|---|
| 1 | 实验编号与目的 | 一句话说明这条实验判定哪条行为 |
| 2 | 夹具 | 用到的外部对象及其 id；引用 §2.1 的变量名 |
| 3 | 请求 | 可直接复制的命令；参数用 `$E1_*` 变量占位，不写死 token |
| 4 | 观测 | 外部 id、时间戳、字段值；**只写实际返回的内容**，缺失字段本身就是观测结果 |
| 5 | 本地应有行 | 表名 + 键 + 计数；说明为什么是这些行（「规划字段值」行的计数口径见下方定义） |
| 6 | 意外行为 | 与预期不符之处；没有就写"无" |
| 7 | 决策影响 | 它改变或不改变哪条设计决定 |
| 8 | 判定 | pass / fail / inconclusive + 依据 |
| 9 | 复现 | 从本文件出发重跑本实验的命令序列 |

「本地应有行」的**「行数」列只有一个计数口径**：「规划字段值」这一行**只计用户可写的规划字段值**；内容派生的系统字段值（`ProjectV2ItemFieldRepositoryValue`，字段名 `Repository`）与内容字段（`Title`）不计入。其它行按各自表的主键计数。这条定义只写在这里，实验记录引用它、不复述。

**这一行的名字是固定的，不能改名、也不能拆成多条物理表名行。** 跨记录可比性是这一行存在的唯一目的，而 E1-4（#25）的裁决要横向读三份记录——行名一改，逐行校验就空转。记录自己的落点结构（领域表名、投影表等）可以另起若干行写在它旁边，但「规划字段值」这一行必须在，计数按上面的口径；`tests/contract/e1-evidence-consistency.test.js` 的 (b0) 断言会在记录缺这一行时响亮失败（唯一的例外是 `PLANNING_ROW_EXEMPT` 里带日期与理由的显式豁免）。

三条填写纪律：

- **不补全**：平台没返回的字段不许用"应该会返回 X"补齐。字段不存在（例如 draft 没有 `repository`）要如实写成"不存在"，并给出证明它的那次调用原文。
- **不合并**：一条实验一条记录，观测值按实验分组；把三条混成一段叙述会让"这条记录被谁改过"无法定位。
- **行数按定义计**：「规划字段值」行的行数按上一段的定义计，不能把原始 `fieldValues` 数直接填进这一列；原始 `fieldValues` 数属于第 4 项「观测」的内容。

## 7. 发布面处理规则

本仓库是公开的，记录文件、分支名和提交信息都是发布面（`AGENTS.md` §7、`docs/development/publication.md`）。沙箱记录按下列规则处理：

| 类目 | 规则 |
|---|---|
| 账号 | 沙箱 owner 与本仓库 owner 是**同一个公开账号**，仓库 URL 已经公开了它，因此记录里直接写账号名不新增暴露面；`$E1_OWNER` 的赋值只出现在 §2.1 |
| 仓库名 | `e1-sandbox` 是私有仓库的名字，可以写；它的**内容**（夹具正文）都是一句话夹具说明，不含真实数据 |
| 本机路径 | 一律不出现。命令里需要临时目录时写 `<sandbox-clone>` 这类占位符 |
| 本机用户名 / hostname | 一律不出现；需要指代运行环境时写 `<runner-name>` 或 `<host>` |
| token / 凭据 | 一律不出现。命令只用 `$E1_*` 变量与 `gh` 的既有认证，不写 `GH_TOKEN=...` 这类赋值 |
| 内部系统 | 不出现内部系统名、内部链接或拓扑描述 |

机械扫描与人工核对是两道独立门（`docs/development/publication.md`）：

```bash
node scripts/rule-checks.mjs disclosure origin/main   # 期望：exit 0
```

`disclosure` 当前机械扫描的模式（`scripts/rule-checks.mjs` 的 `DISCLOSURE_PATTERNS`）里，与本机路径和身份有关的有**两类**：**家目录路径**（以 `/Users` 或 `/home` 开头、后接用户名的那类绝对路径；首段为 `node` 或 `dashboard` 时豁免）与**内网主机名**（TLD 为 `.local` / `.internal` / `.lan` / `.corp` / `.home` / `.intranet`，且 TLD 前的标签含数字或连字符）；另有一类 **RFC1918 私网地址**，其余四类是凭据模式（GitHub 令牌、GitHub 细粒度 PAT、AWS Access Key、私钥 PEM 头）。

因此上表「本机路径」这一行**不能**只靠机械扫描判定：`/tmp/...`、`/var/...` 这类非家目录的绝对路径，以及不带上述内网后缀的 hostname，都不在扫描范围内，只能人工核对。机械扫描不覆盖任意口令、业务秘密、标题和分支名，因此提交前仍需人工过一遍上表五类。

## 8. 已知边界

- **条目读后写延迟**（§4.2 实测）：`item-add` 成功后立刻读可能少一条。任何"重建后条目数不对"的判断都要先重查。
- **`REDACTED` 条目类型未观测**：`ProjectV2ItemType` 枚举实测有四个取值 `ISSUE` / `PULL_REQUEST` / `DRAFT_ISSUE` / `REDACTED`，但本批次没有任何夹具被删除，因此 `REDACTED` 何时出现、出现后 `content` 是什么形状，**没有观测**。不要把它当成已知形态写进模型。
- **仓库删除未执行**（§5）：仓库删除需要 `delete_repo` scope，执行前先按 §5 刷新授权并回读 `gh auth status`。
- **编号不是契约**：重建出的沙箱会有不同的 project 编号与 node id，等价性以 §4.1(b) 的判据为准。
