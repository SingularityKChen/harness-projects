# GitHub Projects 读取投影 ExecPlan

> 状态：Completed（2026-10-01 人类伙伴授权修订、按交付物整理并 rebase merge PR #241；P3非整数状态码已先红后绿修复，当前合并状态以GitHub回读为准）
> 创建：2026-09-29
> 范围：issue #70。本 PR 实现 `packages/providers/planning-github-projects` 的只读 Planning provider，具体包括：
> - 注入 GraphQL transport，分页读 Project 与 ProjectV2Item。
> - 把内容联合（issue / draft / pull request / redacted）映射成规划条目、成员关系观察与内容观察。
> - 故障一律报告为结构化失败。core 已有的路径负责标 degraded，并保留最后已知值。
> - 端口给规划条目加上成员关系分量；core 不再把非内容种类的 ref 折叠成 issue 身份。
>
> 本 PR 的 base 是 `main`。它原是 2 层堆叠 PR 的上层；栈底 PR #240（issue #203，分支 `fix/source-version-order`）已 rebase merge 到 `main`，回读 `gh pr view 240 -R SingularityKChen/harness-projects --json state,mergedAt`。字段定义、状态选项与迭代（#133）、调度与刷新（#134）、写入（#71）都不在范围内。
> 上游输入：
> - issue：#70，以及它的父 epic #124。
> - Gate E1 记录：`docs/architecture/gate-e1-content-identities.md`、`docs/architecture/gate-e1-membership-and-draft.md`、`docs/architecture/gate-e1-ruling.md` §4 的 R1 / R4 / R5 / R7、`docs/architecture/gate-e1-sandbox.md` §2 / §7 / §8。
> - 其他仓库文档：`docs/adr/ADR-0002-membership-identity-separate-from-content.md`、`docs/product/vertical-path.md` §2 第 3 步、`docs/project-management/merge-queue.md` §4。
> - 上游计划（#240 / issue #203，已完成归档）：`docs/exec-plan/completed/2026-09-29-source-version-order.md`；本层依赖的接口摘录在本文件 `Interfaces and Dependencies`。

## Purpose / Big Picture

完成后：

- **provider 可用**：给定一个 ProjectV2 node id 和一个注入的 transport，`createGithubProjectsPlanningProvider` 返回一个 `PlanningProvider`。它能分页读条目，区分 issue / draft / change_request / redacted，并由 `reconcile` 产出成员关系观察与内容观察。provider 的查询参数只有 project node id 与分页游标，从不拿内容 id 去问平台（R7）。
- **经 core 引导沙箱 Project A**：
  - 9 个条目得到 8 个工作项和 1 个变更请求。
  - 外部身份表里只有内容 node id，没有成员关系 id。
  - 本地实体 id 与任何 node id 都不相等。
  - 引导两次，实体、身份、投影与观察的行数都不变。
- **故障不伪造成功**：transport 离线、限流、权限不足、GraphQL 部分成功、响应形状不对，provider 都返回结构化失败。core 把同步游标标成 degraded，投影保持最后已知值。项目不可见时绝不被读成「空项目」：空条目集会让 core 清掉全部投影，见 `Context and Orientation`。
- **无网络验收**：planning 契约套件在录制夹具上通过。契约层与集成层都不触网，也不需要凭据。

判断成功的最小证据：

1. 在检出本分支的工作树根目录运行下面五个测试文件，全绿：`node --test tests/contract/planning-contract.test.js tests/contract/planning-github-projects-contract.test.js tests/contract/planning-github-projects-mapping.test.js tests/integration/github-projects-bootstrap.test.js tests/e2e/chain-bootstrap.test.js`。
2. base-src 回放：把端口、替身、core 与 provider 包的产品文件恢复成 `origin/main` 版本（栈底已并入），再跑上面五个文件，失败集合恰好是 `Validation and Acceptance` #6 列出的那一组。
3. 变异表 M1–M43（含 M14b、M19b）与验收者补的 A1–A6、N1–N4、N7a、N7c 每条都满足：先证明变异已生效，预期用例变红，还原后变绿。

## Context and Orientation

### 术语

- **成员关系**（membership）：GitHub `ProjectV2Item`，id 形如 `PVTI_*`，带自己的 `createdAt` / `updatedAt`。裁决 R1 规定它是工作区作用域的挂载点，**不是**外部身份种类（`docs/architecture/gate-e1-ruling.md` §4 R1；`packages/domain/src/identity.ts:16-20`）。
- **内容**（content）：成员关系指向的 Issue（`I_*`）、PullRequest（`PR_*`）或 DraftIssue（`DI_*`）节点。内容 node id 登记进外部身份表。
- **规划条目**：端口类型 `ProviderPlanningItem`，定义在 `packages/capabilities/src/planning-provider.ts:32-35`。
- **规范载体**：观察 `sourceVersion` 唯一合法的形态，是 30 字节定宽的 UTC 纳秒时间戳 `YYYY-MM-DDTHH:MM:SS.fffffffffZ`。它由栈底 #203 引入，归一函数是 `sourceVersionFromTimestamp`，见 `Interfaces and Dependencies`。
- **回放 transport / 录制夹具**：把对私有沙箱 `e1-sandbox` 的只读 GraphQL 请求和响应原样存成夹具。测试用一个按请求键查表的 transport 回放它们，不触网。

### 当前状态

以下都是 fact。观察时刻 2026-09-29 @ `f6a33d2`，`main`、`feature/github-projects-read`、`fix/source-version-order` 三者指向同一提交。

- **provider 包是占位**：只导出 `packageId`（`packages/providers/planning-github-projects/src/index.ts:1-8`），依赖只有 domain 与 capabilities（同目录 `package.json`）。
- **端口没有成员关系**：`ProviderPlanningItem` 只有一个 `ref`。内容三态里，work_item 与 change_request 各带 `externalId`，redacted 只带 `reason`（`planning-provider.ts:13-20`、`:32-35`）。`reconcile` 是可选的 `AsyncIterable`，没有失败通道（`:76`）。
- **core 把 `item.ref` 当内容身份登记**：`packages/core/src/bootstrap.ts:133-140`。
  - 未知的 `objectKind` 一律被当作 issue（`packages/core/src/identity.ts:29-32`）。
  - 所以 provider 只要交出一个成员关系 ref，`PVTI_*` 就会被登记成 issue 身份，违反 R1。
  - `asExternalKind` 在仓库里只有 `bootstrap.ts` 一个调用者（`grep -rn asExternalKind packages`）。
- **core 可以显式注入项目范围**：`CoreWorkspaceInput.project`（`packages/core/src/context.ts:39-40`）经 `:105` 成为 `context.projectRef`。不注入时，bootstrap 从观察主体反查项目（`bootstrap.ts:59-78`）。
- **core 引导的故障路径**：
  - 任一页失败时整次不提交，只把同步游标标成 degraded（`bootstrap.ts:51-56`、`:181-195`）。查询侧据此给每条投影打 `freshness.degraded`（`packages/core/src/queries.ts:70-79`）。
  - **空条目集会经 `replacePlanningProjections` 清掉该作用域的全部投影**，有用例钉住（`tests/e2e/chain-bootstrap.test.js:88-96`）。
  - `composeCore` 吞掉 bootstrap 抛出的裸异常，吞掉之后不会写 degraded（`context.ts:113-117`）。因此 provider 的任何路径都不得抛错，`reconcile` 也不例外。
- **能力快照只取一次**：registerBindings 在 `composeCore` 时调用一次 `describeCapabilities`，之后不刷新（`packages/core/src/registry.ts:57`）。缺 permission 视为 unavailable（`packages/capabilities/src/capability-keys.ts:85`）。
- **planning 契约套件把 ref 当内容身份**（`tests/contract/suites/planning.js:41`）：work_item 内容的 `externalId` 必须等于条目 ref 的 `externalId`。重复投递场景要求相邻两条观察的键相同（`:79-95`）。
- **离线替身**：
  - 条目 ref 就是内容 id（`packages/providers/fake/src/fixtures.ts:34-51`）。
  - `promoteDraft` 用 `...record` 展开旧记录，只换 ref 与内容（`packages/providers/fake/src/planning.ts:149-151`）。
  - 条目的 `sourceVersion` 是 `v1`、`v2` 这样的计数（`packages/providers/fake/src/state.ts:64-67`）。
- **本地模型里成员关系的形状已有**：`MembershipRecord` 在 `packages/capabilities/src/storage.ts:94-102`，建表在 `packages/storage/sqlite/migrations/002_identity_membership.sql:65-79`。其中 `content_external_id` 为 `NOT NULL`（`:72`），没有内容 id 的成员关系无处存放。core 目前不写成员关系表（`grep -rn putMembership packages/core` 无输出）。
- **规模计法**：`scripts/rule-checks.mjs:345-347` 只把 `docs/` 下与 `.md` 文件算作文档，所以录制夹具 JSON 计入代码行。
- **E1 证据计划的发现规则**：`tests/contract/e1-evidence-consistency.test.js:206-227` 按内容发现承载 E1 证据的计划，判据是出现已登记的 E1 id 字面量，或出现以 `NAME=` 开头、NAME 是沙箱变量名的行。被发现的计划必须登记在 `DECLARED_E1_PLANS` 里。本计划两者都不写，只写 `$E1_*` 变量名。
- **基线**：在同一检出上，`node --test tests/contract/planning-contract.test.js` 为 `ℹ tests 8`、`ℹ fail 0`；`node --test tests/e2e/chain-bootstrap.test.js` 为 `ℹ tests 8`、`ℹ fail 0`。这是观察时刻快照，执行时在栈底 head 上用同一命令回读。
- **工作树还没装依赖**：`.worktrees/github-projects-read` 里没有 `node_modules`。`tests/README.md` 开头警告：不装依赖时，裸包名会解析到主检出的源码，拿到的「先红」是无效证据。

### 平台事实

来源是 2026-09-29 的只读探针，外加 Gate E1 的记录。

- **沙箱 Project A 当前有 9 个条目**：`ISSUE` 5 个、`DRAFT_ISSUE` 3 个、`PULL_REQUEST` 1 个，全部未归档。
  - `gate-e1-sandbox.md` §2.2 写的是 7 个；§2.3 的 uncertain-create 行记录了 #119 之后变为 9 个。
  - 9 个成员关系与 9 个内容的 node id 都已登记在 `docs/architecture/gate-e1-sandbox.md`：§2.1、§2.3、§2.5，以及 §4.1(a) 的快照。
  - 回读命令如下（先按 `gate-e1-sandbox.md` §2.1 在 shell 里设置 `$E1_PROJECT_A_ID`）：

    ```bash
    gh api graphql -f query='query($p: ID!){ node(id:$p){ ... on ProjectV2 { items(first:20){ totalCount nodes{ type isArchived } } } } }' -f p="$E1_PROJECT_A_ID" --jq '{total: .data.node.items.totalCount, types: ([.data.node.items.nodes[].type] | group_by(.) | map({(.[0]): length}) | add), archived: ([.data.node.items.nodes[].isArchived] | any)}'
    ```

    2026-09-29 的实际输出：`{"archived":false,"total":9,"types":{"DRAFT_ISSUE":3,"ISSUE":5,"PULL_REQUEST":1}}`。
- **两套时间戳**：成员关系与内容的 `updatedAt` 都是秒级、以 `Z` 结尾。9 个条目上两者**全部不相等**，例如 issue-alpha 的成员关系是 `06:59:09Z`，内容是 `06:57:27Z`。E1-1 实验 1 另有「两套时间戳不能互相代替」的结论。
- **`ProjectV2.items` 的参数**（schema 内省）：`orderBy` 只有 `POSITION`；`archivedStates` 默认 `[NOT_ARCHIVED]`；分页游标是不透明的 base64url 串。
- **REDACTED 从未观测**：`ProjectV2ItemType` 枚举有 `REDACTED`（描述为 `Redacted Item`），但出现时 `content` 是什么形状没有观测（`gate-e1-sandbox.md` §8）。
- **旧 id 立即失效**：draft 转成 issue 后，旧 `DI_*` id 立即 `NOT_FOUND`。响应形态是 HTTP 200，`data` 对应节点为 null，`errors[].type` 为 `NOT_FOUND`（`docs/architecture/gate-e1-membership-and-draft.md:333`）。
- **draft 没有这两个字段**：draft 的 `number` 与 `repository` 在类型上不存在，是 `undefinedField`，不是 null（`gate-e1-ruling.md` §5 第 8 条）。
- **夹具内容可以公开**：9 个条目的标题与正文都是 `fixture …` / `Gate E1 fixture…` 这样的夹具说明句；URL 里只有公开账号名与仓库名 `e1-sandbox`，按 `gate-e1-sandbox.md` §7 可以出现在发布面。

### 栈的位置

- 2026-09-30 起本 PR 的 base 是 `main`：栈底 #240 已 rebase merge，本层不再是堆叠 PR 的上层。定稿时的 base 是 `fix/source-version-order`；下文以它为 base 的命令与证据都是观察时刻快照，当前命令以 `origin/main` 为 base。
- 栈底合并时为真的事实：capabilities 导出 `sourceVersionFromTimestamp` / `assertComparableSourceVersion`，`makeObservation` 与两个 Storage 入口只接受规范载体。
- 本层**不改**栈底的任何文件；本层只写本层合并时为真的事实。
- 栈底的接口是否足以支撑本层，核对结论见 `Design / Spec` 的「对栈底接口的核对」。

## Design / Spec

### 决策摘要

- **D1 端口语义**：`ProviderPlanningItem.ref` 表示**内容身份**，`objectKind` 取 `issue` / `draft` / `change_request`。
  - 新增必填字段 `membership: ProviderPlanningMembership { externalId, createdAt, updatedAt }`，用来承载 `PVTI_*` 和它自己的两个时间戳。
  - 平台扣下内容身份时（`type = REDACTED`，或 `content = null`），ref 退回成员关系：`objectKind = PLANNING_MEMBERSHIP_OBJECT_KIND`（取值 `project_item`），`externalId` 等于 `membership.externalId`，content 是 `redacted`。调用方不得把它登记成外部身份。
  - draft 转成 issue 时，ref 从 `DI_*` 变为 `I_*`，`membership.externalId` 不变（E1-2 实验 2）。
- **D2 core 守卫**：
  - 删掉 `asExternalKind`，换成 `planningContentKind(objectKind): MembershipContentKind | undefined`，它只认三种内容种类。
  - 不认识的 ref 不登记身份、不建实体、不进投影，只计入 `BootstrapResult.unanchored`。其余条目照常提交。
- **D3 观察**：provider 实现 `reconcile`，按「全有或全无」工作。
  - 读完全部页（每页 100 条），全部成功后再逐条产出；任何失败都一条不产出，并且不抛错。
  - 每个条目先产出内容观察（没有内容身份时省略），再产出成员关系观察。
  - 两类观察各用自己的 `updatedAt`，经 `sourceVersionFromTimestamp` 归一后作为 `sourceVersion`。
- **D4 `getPlanningItem` 用扫描实现**：按 `first = 100` 逐页读列表，匹配 ref。不引入按内容或按成员关系反查的查询。平台上的查询参数因此只有 project node id 与游标，R7 在结构上成立。
- **D5 失败分类**：见下方分类表。
  - 只要 `errors` 非空，整次调用就失败，即使 `data` 里有部分条目（不做部分成功）。
  - 项目节点为 null、或不是 `ProjectV2` 时，报 `not_found`，绝不返回空页。
  - 响应形状不对时报 `unavailable`，`rawClass` 为 `malformed_response`。
  - 错误消息是固定文案，不拼接任何响应内容、请求头或 transport 的异常文本。
- **D6 条目版本**：
  - `item.sourceVersion = sourceVersionFromTimestamp(membership.updatedAt)`。字段挂在成员关系上（R2），这个值只做相等比较（栈底契约 O5）。
  - `item.sourceUpdatedAt` 取平台原值。
  - 任何时间戳无法归一，整页都按形状错误处理。
- **D7 能力自述**：`describeCapabilities` 只声明 `planning.item.read`。它用一次 `getProject` 探针决定 permission：
  - 成功时为 `available`；
  - `permission_denied` 或 `not_found` 时为 `unavailable`；
  - 其余失败为 `degraded`。
- **D8 夹具**：一个 JSON 文件，一行一条 exchange。录制是一段写在本计划里的只读录制程序（见 Batch 3），不提交录制脚本。三道守卫防止夹具失真：
  - 夹具里的 id 必须已登记（provenance）；
  - 记录的查询哈希必须等于当前查询文本（漂移）；
  - 回放未命中必须为空（misses 账本）。

### 端口改动（`packages/capabilities/src/planning-provider.ts`）

```ts
/** 成员关系（裁决 R1）：条目挂在 project 上的那一行；id 与两个时间戳都独立于内容（E1-1 实验 1）。它不是外部身份种类。 */
export interface ProviderPlanningMembership {
  readonly externalId: string; readonly createdAt: string | undefined; readonly updatedAt: string | undefined
}
/** 平台扣下内容身份时，条目 ref 退回成员关系，objectKind 取这个值；调用方不得把它登记为外部身份。 */
export const PLANNING_MEMBERSHIP_OBJECT_KIND = 'project_item'
export interface ProviderPlanningItem {
  readonly ref: ExternalObjectRef; readonly project: ExternalObjectRef; readonly membership: ProviderPlanningMembership
  readonly content: ProviderPlanningContent; readonly fields: ProviderPlanningFields
  readonly sourceVersion: string | undefined; readonly sourceUpdatedAt: string | undefined
}
```

`ProviderPlanningItem` 上方的注释要写明四件事：
- ref 是内容身份；
- 没有内容身份时有上面的例外；
- `sourceVersion` 是成员关系版本，只做相等比较；
- `reconcile` 失败时一条不产出。

替身同步修改如下，`promoteDraft` 已经用 `...record` 展开旧记录，所以不用改就会保留成员关系：
- `FakePlanningItemRecord` 加 `membership` 字段，`toPlanningItem` 输出它。
- 种子条目的成员关系 id 取 `m-<内容 id>`，两个时间戳取 `2026-09-20T00:00:00Z`。
- `addItem` 生成 `m-<新内容 id>`。

### core 守卫（`packages/core/src/identity.ts`、`bootstrap.ts`、`context.ts`）

```ts
const PLANNING_CONTENT_KINDS: readonly string[] = Object.values(MembershipContentKind)
/** 规划条目 ref 的内容种类：只认 issue / draft / change_request；其余（含成员关系 ref）返回 undefined，调用方不得登记身份（裁决 R1）。 */
export function planningContentKind(objectKind: string): MembershipContentKind | undefined
```

- `upsertItems` 的改动：`planningContentKind` 返回 undefined 时，`counts.unanchored += 1` 并 `continue`；否则按原逻辑调用 `ensureEntity`。Superseded by `评审响应 · R1` 的 R1-a（2026-09-30）：没有内容身份的条目先按成员关系映射找回已登记实体、出 redacted 占位，找不到才计入 `unanchored`，并把整次读取标为 degraded。
- `BootstrapResult` 新增 `readonly unanchored: number`，含义是「没有内容身份、本地无法锚定的条目数」。
- `fail()` 与 `unavailableCore` 的返回值都补上 `unanchored: 0`。
- `KNOWN_EXTERNAL_KINDS` 与 `asExternalKind` 一并删除。

### provider 结构（`packages/providers/planning-github-projects/src/`）

| 文件 | 职责 |
|---|---|
| `transport.ts` | 定义 `GraphqlRequest { operationName, query, variables }`、`GraphqlResponse { status, headers（键一律小写）, body（已解析的 JSON，不能解析时为 undefined） }` 与 `GraphqlTransport = (request) => Promise<GraphqlResponse>`。网络失败用 reject 表达。鉴权、超时与重试都属于实现方（宿主），provider 拿不到凭据 |
| `queries.ts` | 两段查询文本与 `PLANNING_QUERIES = { PlanningProject, PlanningItems }`（夹具漂移检查用） |
| `classify.ts` | 纯函数 `classifyResponse(response, now): ProviderError \| undefined`，按分类表判定；`failure(code, requestId, rawClass?, retryAfterMs?)` 是平台类错误的唯一构造处 |
| `decode.ts` | 纯函数：`data` 解码成 `ProviderProject`，或解码成一页条目行 `{ item, content: { version, fields } \| undefined }` 加 `nextCursor`。只对叶子值做类型守卫，任何抛错都由 provider 判为形状错误 |
| `provider.ts` | 工厂 `createGithubProjectsPlanningProvider({ bindingId, projectNodeId, transport, now? })`，闭包实现，不导出类；`now` 返回毫秒，缺省 `Date.now`。条目行转观察的 `rowObservations` 也在这里，一律经 `makeObservation` 构造；`MAX_PAGE_SIZE = 100` |
| `index.ts` | 保留 `packageId` 与 Responsibility / Allowed imports 注释，导出工厂与其选项类型、transport 类型与 `PLANNING_QUERIES` |

两段查询的文本是本 PR 的契约，改动它就要重录夹具。第一页也总是带上 `after: null`：

```graphql
query PlanningProject($project: ID!) {
  node(id: $project) { __typename ... on ProjectV2 { id title url updatedAt } }
}
```

```graphql
query PlanningItems($project: ID!, $first: Int!, $after: String) {
  node(id: $project) {
    __typename
    ... on ProjectV2 {
      items(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id type createdAt updatedAt
          content {
            __typename
            ... on Issue { id number title body url updatedAt }
            ... on PullRequest { id number title body url updatedAt }
            ... on DraftIssue { id title body updatedAt }
          }
        }
      }
    }
  }
}
```

查询里不取 creator、assignees、login 一类个人字段。`archivedStates` 用平台默认值，所以归档条目既不出现在列表里，也查不到。

### 方法语义

- **`getProject(ref)`**：
  - ref 与绑定的项目不同时，返回 `invalid_input`（比较 bindingId、`objectKind = 'project'` 与 `externalId`；以下同），不发请求。
  - 否则发 `PlanningProject`，经分类与解码后，返回 `{ ref（带 url）, title, sourceUpdatedAt }`。
- **`listPlanningItems({ project, cursor, limit })`**：
  - project 不是绑定的那个时，返回 `invalid_input`，不发请求。
  - `limit` 不是 ≥ 1 的整数时，返回 `invalid_input`，不发请求。
  - `first = min(limit, 100)`，变量为 `{ project, first, after: cursor ?? null }`。
  - `hasNextPage` 为真时，`nextCursor = endCursor`；否则 `nextCursor` 为 undefined。
  - `hasNextPage` 为真，但 `endCursor` 缺失、为空串或等于传入游标时，报形状错误，防止调用方死循环。
- **`getPlanningItem(ref)`**：
  - `bindingId` 不符，或 `objectKind` 不属于 `issue` / `draft` / `change_request` / `project_item` 时，返回 `invalid_input`。
  - 否则读完全部页再匹配，不做命中即停：`project_item` 按 `membership.externalId` 匹配，其余按 `(item.ref.objectKind, item.ref.externalId)` 匹配。
  - 没找到返回 `not_found`；扫描途中任一页失败，就原样返回那一页的失败；游标回到已发送过的值（成环）判形状错误。
- **`listFieldDefinitions` / `listIterations`**：返回 `not_supported`（#133）。不实现任何写方法（#71）。
- **`reconcile(scope)`**：忽略 `scope.cursor`，因为 R5 要求全量比对。每一遍取一次 `receivedTime = new Date(now()).toISOString()`；一次成功的遍历必须完整产出全部观察。
- **错误处理的形状**：请求路径只有一处 `try/catch`，包在 transport 调用、分类与解码外面。进入时 `rawClass` 记为 `transport_error`，transport 返回后改为 `malformed_response`：
  - transport 抛错或 reject，映射成 `unavailable`，`rawClass` 为 `transport_error`；
  - 其后任何抛错（形状不符、时间戳无法归一），映射成 `unavailable`，`rawClass` 为 `malformed_response`。
  - `reconcile` 另有一处 `try/catch`，包住扫描之后的时钟与观察构造。

### 失败分类表（`classify.ts`，自上而下，命中即止）

| # | 条件 | provider 码 | 附加 |
|---|---|---|---|
| 1 | HTTP 429 | `rate_limited` | 见下方 `retryAfterMs` 规则 |
| 2 | HTTP 403，且带 `retry-after` 或 `x-ratelimit-remaining: 0`，或正文 `message` 含 `secondary rate limit`（二级限流可能不带任何限流头，见 Surprises） | `rate_limited` | 同上 |
| 3 | HTTP 401 或其余 403 | `permission_denied` | — |
| 4 | 其余非 2xx，包括状态码不是数字 | `unavailable` | `rawClass = http_<status>`；状态码不是整数时为 `malformed_response` |
| 5 | 2xx 但 body 不是普通对象（null、数组或非对象） | `unavailable` | `rawClass = malformed_response` |
| 6 | 2xx 且 `errors` 非空，任一条 `type = RATE_LIMITED`，或带 `x-ratelimit-remaining: 0` | `rate_limited` | 同 1 |
| 7 | 同 6，任一条 `type` 为 `FORBIDDEN` 或 `INSUFFICIENT_SCOPES` | `permission_denied` | — |
| 8 | 同 6，任一条 `type = NOT_FOUND` | `not_found` | — |
| 9 | 同 6，其余情况 | `unavailable` | `rawClass = graphql_<TYPE>`，只有 `TYPE` 匹配 `^[A-Z_]{1,40}$` 时才拼接，否则为 `graphql_error` |
| 10 | 2xx 且没有 `errors` | 不是失败，交给解码 | — |

- **`retryAfterMs`**：
  - `retry-after` 是十进制整数时，取它乘以 1000；
  - 否则，`x-ratelimit-remaining` 为 `0` 且 `x-ratelimit-reset` 是十进制整数时，取 `max(0, reset × 1000 − now())`；
  - 其余情况为 undefined，退避策略归 #134。
- **`requestId`**：一律取 `x-github-request-id`。
- **成功响应**：带 `x-ratelimit-remaining: 0` 的成功响应（消耗了最后一点额度的那次请求）**不是**失败，第 6 行只在 `errors` 非空时才看这个头。

### 解码规则（`decode.ts`）

- **项目节点**：`node` 为 null，或 `__typename` 不是 `ProjectV2`，一律 `not_found`，绝不返回空页（`chain-bootstrap.test.js:88-96`）。`getProject` 返回的节点 `id` 必须等于绑定的项目，否则判形状错误；不这样做的话，core 会把别的 ref 写进 `context.projectRef`，之后每次引导都在入口得到 `invalid_input`。
- **条目的种类判定**：
  - `type` 必须是种类表的自有键（`Object.hasOwn`，原型链属性名不算），或者是 `REDACTED`。
  - `type = REDACTED` 或 `content = null` 时，产出 redacted 条目，不读 `content` 的任何字段：
    - `ref = { objectKind: 'project_item', externalId: 成员关系 id, url: undefined }`；
    - `content = { kind: 'redacted', reason: 'unavailable' }`；
    - 条目行不带内容观察输入（`content = undefined`）。
  - 其余情况 `content.__typename` 必须与 `type` 对应：`ISSUE` 对 `Issue`，`PULL_REQUEST` 对 `PullRequest`，`DRAFT_ISSUE` 对 `DraftIssue`。
- **三类内容的映射**：

  | 平台内容 | ref.objectKind | ref.url | content |
  |---|---|---|---|
  | Issue | `issue` | content.url | `work_item { externalId, title, body }` |
  | DraftIssue | `draft` | undefined | `work_item`，同上 |
  | PullRequest | `change_request` | content.url | `change_request { externalId, number, title, body }` |

  内容 `id` 必须是非空串，`title` / `body` 必须是串；Issue 与 PullRequest 的 `number` 必须是正整数。必填性以 schema 为准（见 Surprises 的内省结果）：成员关系的 `createdAt` 也必填，`body` 为 null 即形状错误。
- **不解析 id 前缀**：种类只由 `__typename` 决定。
- **版本**：成员关系的 `updatedAt` 与内容的 `updatedAt` 都在这里调用 `sourceVersionFromTimestamp`。抛 `RangeError` 即形状错误，因此列表与 `reconcile` 对同一个坏时间戳给出同一个失败。
- **字段**：`fields` 一律为空，`statusKey` 等为 undefined，`customFields` 为 `{}`。规划值由 #133 读取，本 PR 不猜。
- **分页信息**：解码时核对游标停滞规则（见 `listPlanningItems`）。

### 观察（`provider.ts` 的 `rowObservations`）

| 观察 | subject | type | eventTime 与 sourceVersion | stablePayloadFields（payload 与之相同） |
|---|---|---|---|---|
| 内容观察（只在有内容身份时产出） | 条目 ref | `planning.content.observed` | 内容的 `updatedAt` 归一值 | `{ kind: ref.objectKind, number（draft 为 null）, title, body }` |
| 成员关系观察 | `{ bindingId, objectKind: 'project_item', externalId: 成员关系 id, url: undefined }` | `planning.membership.observed` | `item.sourceVersion` | `{ project: 项目 node id, contentKind（无内容身份时为 null）, contentExternalId（同上）, createdAt（缺省为 null） }` |

几点约束与由此得到的性质：
- **payload 的内容**：payload 里没有请求头、游标、`receivedTime` 或 `requestId`。
- **重复读取幂等**：同一平台状态读两次，去重键逐条相同。
- **每个主体的版本来源单一**：成员关系主体只用成员关系版本，内容主体只用内容版本（栈底契约 O3）。

录制的 Project A 上共有 18 条观察：9 条内容观察加 9 条成员关系观察。

### 夹具、回放与录制

- **夹具文件**：`tests/contract/fixtures/github-projects/project-a.json`。
  - 第一行是 `{"provenance":{ source, project: "$E1_PROJECT_A_ID", recordedAt, queryHashes }`。`project` 字段写的是变量名字面量，不是 id。
  - 之后一行一条 exchange：`{ operationName, variables, status: 200, body }`。不录响应头，所以没有 request id，也没有额度信息。
  - 共 6 条 exchange：`PlanningProject` 1 条；`PlanningItems` 的 `first = 100`（`reconcile`、扫描与套件共用）、`first = 50`（core 的 `PAGE_LIMIT`）、`first = 4` 的 3 页。
- **回放**：`tests/contract/fixtures/github-projects/replay.js` 导出 `loadFixture()` 与 `createReplay(fixture) → { transport, calls, misses }`。
  - 回放键是 `JSON.stringify([operationName, 按键排序的 variables])`。
  - 命中时，把请求记进 `calls`，返回 body 的 `structuredClone`，headers 为 `{}`。
  - 未命中时，把键记进 `misses`，然后 reject。每个使用回放的测试文件，最后一条用例都断言 `misses` 为空。这样未命中不会被伪装成「离线」，故障用例也不会因此空转通过。
- **录制**：用 Batch 3 里的只读程序完成。它驱动 provider 本身，所以夹具里的请求与 provider 真实发出的请求逐字相同。它拒绝任何以 `mutation` 开头的查询；`gh` 非零退出时立即中止。
- **合成输入**：故障与边界输入（401、限流、部分成功、REDACTED、坏时间戳等）写在 mapping 测试里，用例名标注「合成」，不混进录制夹具。

### 对栈底接口的核对

栈底的最终接口足以支撑本层，不需要改动。逐条核对如下：

- **O1 取值**：GitHub 的 `updatedAt` 是秒级、以 `Z` 结尾，`sourceVersionFromTimestamp` 会把它归一成 `…:SS.000000000Z`。
- **O2 归一失败**：归一抛错时，本层报结构化失败，不改填 undefined。
- **O3 版本来源**：见上方「每个主体的版本来源单一」。
- **O4 `receivedTime`**：用 `toISOString()`。
- **O5 条目版本**：`item.sourceVersion` 只做相等比较；本层给它的也是规范值，所以不需要例外。
- **G1–G3**：本层的观察只经 `makeObservation` 构造，两个 Storage 入口不会遇到非规范载体。

剩余风险：`reconcile` 里的 `makeObservation` 仍可能抛错，但它包在「全有或全无」的 `try` 里，而同一个坏时间戳也会让列表失败，所以最终仍以 degraded 呈现。

### 被放弃的方案

- **端口 ref 表示成员关系（设计 2 的 D2）**：语义上更贴近 R1 / R2，也更贴近 #71 写入时要用的 `PVTI_*`。但它要同时改 capabilities、替身、core 身份来源、套件的 `:41` 与 e2e 身份断言（`chain-bootstrap.test.js:134-139`），core 还要改为按成员关系去重。设计 2 自估约 760 行，它自己也写了「超过就拆成第 3 层」的触发条件。本 PR 选增量的 D1；#71 需要 `PVTI_*` 时从 `item.membership` 取即可。
- **不实现 `reconcile`，把观察映射放进 capabilities（设计 2）或只放在条目里（设计 3）**：#70 的 Scope 明写「映射为成员关系与内容观察」，验收 3 要求「重复观察幂等」。不产出观察，这两条都会变成空转。capabilities 里的通用函数在 #134 之前也没有生产调用者。
- **按内容 id 或成员关系 id 反查单条（设计 1、2）**：要多一段查询和一组录制，还会让内容 id 成为平台查询参数。扫描更小，R7 在结构上成立。代价登记为技术债 TD5。
- **`sourceVersion = max(成员关系, 内容)`（设计 3）**：两套时间戳各自推进，E1-1 实验 1 的结论是不能互相代替；取 max 之后，哪一侧变了就丢了。
- **设计 1 / 2 / 3 各自的时间戳规则**：分别是「只接受秒级 Z 并原样用」、`toISOString()` 毫秒、`slice(0,19)+'Z'` 秒级。三者都不是栈底的规范载体，都会在 `makeObservation` 处被拒。设计 3 的 `new Date(x)` 还会把无偏移输入按本地时区解析。本层一律调用栈底的归一函数。
- **把游标封装成 `[project, endCursor]`（设计 2）**：provider 只绑定一个项目，并且在入口校验 `input.project`，封装是多余的代码。
- **把形状错误映射成 `invalid_input`（设计 1）**：`invalid_input` 的恢复动作是「输入不合法」，会把平台或响应的问题归咎给调用方。本层改用 `unavailable` 加 `rawClass`，重试次数由 #134 的有界调度限制。
- **transport 返回 `{ kind: 'network' }` 变体（设计 1、3）**：provider 本来就必须捕获 reject 与抛错，两条路径只留一条。
- **提交录制脚本（设计 1）**：约 40 行代码，而且不在 CI 中运行。改为写在本计划里的只读程序，重跑后与已提交夹具比较 diff 作为可复现证据（Batch 4）。
- **修改 `docs/exec-plan/tech-debt-tracker.md`（设计 1、3）**：该文件在 `main` 上不存在（`ls docs/exec-plan/`）。技术债写在本计划的 `Outcomes & Retrospective`。
- **REDACTED 的整页失败方案**：一个被扣下的条目会让整个绑定永久 degraded。本层按 D1 / D2 产出 redacted 条目、不登记身份，并计入 `unanchored`。

### 定稿来源

- **主体取自设计 1（契约驱动）**：
  - D1 端口语义与 `membership` 字段；
  - core 守卫 `planningContentKind`；
  - 套件的两条通用断言；
  - 「全有或全无」的 `reconcile`；
  - misses 账本、provenance 与查询哈希漂移检查；
  - 「评审者会怎么打破它」的大部分条目。
- **嫁接自设计 2（E1 身份与幂等）**：
  - 「项目不可见必须是 `not_found`，空页会清空本地投影」；
  - R7 的结构性保证：只用 project node id 查询，并断言回放日志；
  - REDACTED 一律不读 content；
  - `type` 与 `__typename` 的显式对照表；
  - 限流只在 403 / 429 或带 errors 时判定。
- **嫁接自设计 3（失败与传输）**：
  - `getPlanningItem` 用扫描实现；
  - 网络失败只有 reject 一条路径；
  - 分类表的优先级与 `rawClass` 形态；
  - stale 不在 provider 里建模，复用 core 已有路径；
  - `unanchored` 计数；
  - 错误不泄露传输材料的用例；
  - 录制过程写进计划，不提交脚本。
- **定稿者据栈底最终接口所做的订正**：`sourceVersion` 一律经 `sourceVersionFromTimestamp` 归一；条目版本也用规范值；套件**不**断言 `item.sourceVersion` 可比较，因为栈底契约 O5 允许条目版本是平台原值，替身用的正是 `vN`。

### 关键不变量

1. **成员关系不是外部身份种类**：外部身份表里永远不会出现成员关系 id（R1）。
2. **PR 成员关系不产生工作项**：内容为 PullRequest 的条目，映射成 `change_request` 内容与 `change_request` 身份。
3. **查询参数有界**：provider 只拿 project node id 与游标作为平台查询参数（R7）。
4. **失败都是结构化的**：provider 不抛错；列表、单条读取与 `reconcile` 都不返回部分成功；项目不可见绝不是空页。
5. **观察可重放**：两类观察的 `sourceVersion` 都是规范载体，每个主体只有一个版本来源；同一平台状态的去重键稳定。
6. **不越层**：依赖方向不变（provider → capabilities → domain），provider 不读环境变量，不直接触网，不持有凭据。规划状态、看板 `Status` 与 LLM 都不在本路径上。

### 评审者会怎么打破它（预判与防线）

| # | 攻击 | 防线（用例或变异） |
|---|---|---|
| 1 | 回放未命中被伪装成离线，故障用例空转通过 | misses 账本，每个文件最后一条用例断言为空 |
| 2 | 回放忽略 `after`，第 2 页读到的是第 1 页 | 套件「分页遍历不重不漏」；变异 M15 |
| 3 | 手工篡改夹具，或查询变了却没重录 | provenance 用例（M17）、查询哈希用例（M16）、Batch 4 重录后比较 diff |
| 4 | `data` 与 `errors` 同时出现、或 `errors` 不是数组时被当成功 | mapping「部分成功判失败」「errors 不是数组」、集成部分成功场景；变异 M3、M24 |
| 5 | `reconcile` 边读边产出，失败时交出半截 | mapping「全有或全无」；变异 M4 |
| 6 | transport 抛错穿透到 core，被 `composeCore` 吞掉，游标不变 degraded | 套件离线用例、mapping 抛错行；变异 M5 |
| 7 | `PVTI_*` 被登记成 issue 身份 | chain-bootstrap 守卫用例（base 上红）、集成身份集合断言；变异 M2、M10 |
| 8 | 项目不可见被读成空页，清掉本地投影 | mapping「不可见是 `not_found`」；变异 M12 |
| 9 | 游标不推进或成环导致死循环 | mapping 游标用例：停滞（M7）；成环时 transport 按游标应答，第 5 次调用起 reject（M21）。core 逐页读取遇到长度 ≥ 2 的环见 TD12 |
| 10 | `type` 与 `__typename` 不一致时仍照单映射 | mapping 种类不一致用例；变异 M6 |
| 11 | 消耗最后一点额度的成功响应被判成限流；403 二级限流不带限流头时被判成权限不足；状态码不是数字时被当成 2xx | 分类表「成功响应不因剩余额度为 0 失败」「403 二级限流」「状态码不是整数」行；变异 M14、M14b、M27、M26 |
| 12 | 请求头、token、响应体或平台原文泄露进错误 | mapping 分类表每行的应答都带哨兵串，断言它不出现在 `util.inspect(result, { depth: null, showHidden: true })` 中（`JSON.stringify` 看不见 Error 对象里的文本）；变异 M19、M19b |
| 13 | 观察的版本没有归一 | `makeObservation` 拒绝后，`reconcile` 一条不产出，契约「18 条观察」用例变红；变异 M9 |
| 14 | 两套时间戳用反 | 契约「两类观察各用自己的版本」，9 个条目上两者都不同；变异 M8 |
| 15 | 条目里混入时钟，两遍读取不相等 | 套件「同一状态读两次逐字相同」，适配器注入递增时钟；变异 M18 |
| 16 | `limit` 大于 100 原样发给平台 | mapping `limit` 边界用例；变异 M13 |
| 17 | 历史 `DI_*` 被当作查询参数发给平台 | 契约 R7 用例：返回 `not_found`，回放日志里没有这个 id |
| 18 | 替身在 draft 提升时重新生成成员关系 | planning-contract 提升用例的成员关系断言；变异 M11 |
| 19 | 本计划写进 E1 id，逃出 E1 证据核对 | 计划只写变量名；Batch 0 与 Batch 5 跑 `e1-evidence-consistency` |
| 20 | 本层改了栈底文件，或写进栈底的事实 | `Validation and Acceptance` #10 的文件集合检查 |
| 21 | 变异没有真正生效 | 生效判据见变异表前言；还原一律用 `git checkout HEAD -- <file>` |
| 22 | 原型链属性名（如 `constructor`）被当作合法 `type` | mapping 未知 type 行；变异 M20 |
| 23 | `reconcile` 在扫描之后抛错，被 `composeCore` 吞掉 | mapping 的 `NaN` 时钟断言；变异 M22 |
| 24 | `hasNextPage` 缺失被当作最后一页，截断成成功；平台返回别的项目 id | 分类表「hasNextPage 缺失」「项目 node 是别的项目」行；变异 M23、M25 |

## Global Constraints

本计划改动的文件集合只在这里声明一次，按任务所有者分组；同一文件只有一个所有者。

**T1 · 端口、替身、core 守卫与套件**（Sonnet，工作树 `.worktrees/github-projects-read-port`，约 100 行）

- `packages/capabilities/src/planning-provider.ts`
- `packages/core/src/identity.ts`
- `packages/core/src/bootstrap.ts`
- `packages/core/src/context.ts`：只改 `unavailableCore` 里 bootstrap 的返回值。
- `packages/providers/fake/src/state.ts`
- `packages/providers/fake/src/fixtures.ts`
- `packages/providers/fake/src/planning.ts`：只改 `addItem`。
- `tests/contract/suites/planning.js`
- `tests/contract/planning-contract.test.js`：只在提升用例里加成员关系断言。
- `tests/e2e/chain-bootstrap.test.js`：只新增一条守卫用例。

**T2 · provider 纯逻辑**（Sonnet，工作树 `.worktrees/github-projects-read-provider`，约 420 行）

- `packages/providers/planning-github-projects/src/`：`index.ts`、`transport.ts`、`queries.ts`、`classify.ts`、`decode.ts`、`provider.ts`（T5 验收重构时把原计划的 `observations.ts` 并入 `provider.ts`，见 D12）。
- `tests/contract/planning-github-projects-mapping.test.js`：全部用合成输入。

**T3 · 夹具、回放与验收**（Sonnet，工作树 `.worktrees/github-projects-read-fixture`，约 210 行代码、约 10 行文档）

- `tests/contract/fixtures/github-projects/replay.js`
- `tests/contract/fixtures/github-projects/project-a.json`
- `tests/contract/planning-github-projects-contract.test.js`
- `tests/integration/github-projects-bootstrap.test.js`
- `tests/integration/README.md`：新增一节，登记新集成用例及其保护的不变量。

**T4 · 对抗验证**（Sonnet，分离工作树 `.worktrees/github-projects-read-verify`）：不持久写入任何文件。变异只在自己的工作树里临时应用并还原，结果交给 T5。

**T5 · 验收重构、证据与 PR**（Opus，工作树 `.worktrees/github-projects-read`）

- `docs/exec-plan/completed/2026-09-29-github-projects-read.md`（本计划）
- `docs/README.md`：Active 索引加一行，定稿时已写入。
- 验收重构如果需要改 T1–T3 的文件，这些文件的所有权在集成后转给 T5，并写进 `Progress`。

**R1 · 评审响应**（评审 5362364398；单一 owner，工作树 `.worktrees/github-projects-read`）

- `packages/core/src/bootstrap.ts`、`packages/core/src/queries.ts`；`packages/core/src/context.ts` 只加 `unavailableCore` 的 `getPlanningSync`。
- `packages/controller/src/queries.ts`、`packages/controller/src/wire.ts`。
- `packages/providers/planning-github-projects/src/provider.ts`：只加扫描页数上界。
- `tests/integration/github-projects-bootstrap.test.js`、`tests/integration/README.md`、`tests/e2e/chain-bootstrap.test.js`。
- 本计划；`docs/README.md` 的 Active 行（去掉「叠在 #203 之上」，更新状态列）。
- 工作树里未跟踪的 `docs/review/2026-09-30-pr-241-mmp-review.md` 是人类伙伴的评审记录：不改、不提交、不删除。

**R2 · 评审后决策**（单一 owner，同一工作树）：`packages/core/src/{projection,queries,context,bootstrap}.ts`、`packages/controller/src/wire.ts`、`packages/ui-model/src/{derive,types}.ts`、`packages/providers/planning-github-projects/src/classify.ts`，以及对应的四个测试文件（集成 `github-projects-bootstrap`、e2e `chain-bootstrap`、契约 `planning-github-projects-mapping` 与 `ui-model-presentation`）、`tests/integration/README.md`、`docs/README.md` 的 Active 行与本计划。不加迁移、不改 DDL、依赖方向不变。

**R3 · 授权整合**（2026-10-01，单一owner）：分类器及mapping测试修复非整数状态码；本计划移入completed，`docs/README.md`移到Completed索引，`docs/project-management/merge-queue.md`登记第4项授权收尾；按D29的交付物粒度整理历史。

**明确不改**：
- 栈底的全部文件：`packages/capabilities/src/observation.ts`、`packages/capabilities/src/storage.ts`、`packages/providers/fake/src/storage.ts`、`packages/storage/sqlite/**`、`tests/contract/suites/storage*.js`、`tests/contract/storage-contract.test.js`、`tests/contract/capabilities-observation.test.js`、栈底计划。
- `packages/controller/**`、`packages/client/**`：`BootstrapResult` 的新字段原样透传，不需要改。Superseded by R1（2026-09-30）：controller 的两个文件改为由工作区级同步摘要决定整表新鲜度；client 仍不改。
- `packages/providers/planning-github-projects/package.json`：依赖不变。
- 任何迁移与 DDL。
- `docs/architecture/gate-e1-*.md`：夹具里的 id 已全部登记。

**其他硬约束**：

- **规模**：代码 ≤ 800 行、文档 ≤ 1300 行，按增删之和计，排除锁文件与生成目录，以栈底 head 为 base 计量。R1 起以 `origin/main` 为 base；R1 后代码预计约 915 行，超过 800 的理由与数字见 D20。R2 验收后（2026-09-30）代码 993、文档见 `Outcomes & Retrospective` 的「R2 验收复评」：代码超过 800 已由人类伙伴接受（H13、D26），文档超过 1300 的规划弹性上限交人类伙伴知情（D27），CI 硬上限 1000 / 1500 守住。
  - 目标约为代码 730 行、文档 1080 行：本计划定稿时约 1000 行，执行期回填证据约 60 行，`tests/integration/README.md` 约 10 行，`docs/README.md` 1 行。回填证据时只写命令、结论与观察时刻，不复述已有章节。
  - 夹具 JSON 计入代码。
  - T2 集成后先量一次；超过 740 行时按以下顺序收缩：(1) 集成测试去掉 SQLite 那一轮；(2) 泄露用例并入分类表的循环；(3) 合并 `decode.ts` 里重复的类型守卫。T5 执行了 (2) 与 (3)，另做了 D12 的其余削减；(1) 没有执行，SQLite 那一轮保留。
  - 不许删验收用例，不许拆 issue。
- **依赖方向**：不新增依赖。provider 只依赖 capabilities 与 domain；测试只用 `node:test`、`node:assert/strict` 与 Node 内建。
- **禁止触网与凭据**：provider 源码不得出现 `fetch(`、`process.env`、`node:child_process`、`node:http`、`node:https`、`node:net`（Batch 5 用 grep 验证）。测试不触网。只有 Batch 3 与 Batch 4 的录制程序经 `gh` 做只读查询，并且零写入。
- **MMP 前不做兼容层与迁移**：端口字段直接改成必填。
- **不写看板**：不写看板 `Status`，也不改 `blocked-by` / `blocking` 关系。LLM 不进入规划状态、关系语义或门禁控制路径。
- **先红后绿**：行为变更先有在 base（栈底 head）上失败、在 head 上通过的判别性测试；变异必须先证明已生效。
- **提交格式**：`<type>(<scope>): <中文摘要>`，正文说明为什么，末尾 `Refs #70`。关闭关键字只写在 PR 描述里，因为提交正文里的关闭关键字在进入 `main` 时同样会关闭 issue。
- **文档语言与发布面**：文档正文中文，标识符、路径、命令英文。不写本机绝对路径、凭据、内部系统。本计划不写任何 E1 id 字面量，也不写以 `NAME=` 开头的沙箱变量绑定行。
- **每个提交单独为绿**：最终的提交序列里，每个提交都要能单独通过。

## Plan of Work

> Batch 0–5 是 2026-09-29 / 30 的历史批次：其中以 `fix/source-version-order` 为 base 的命令、期望与提交号是当时的栈信息，不是当前栈。该远端分支已随 #240 合并删除；现在一律以 `origin/main` 为 base，见「栈的位置」与「评审响应 · R1」。

### Batch 0 · 计划提交、栈对齐与 draft PR（T5）

> 观察时刻快照（2026-09-29，栈底 `fix/source-version-order`）：本批的命令、期望与 base 都是当时的栈信息；该分支已随 #240 合并删除，现在的 base 是 `origin/main`，对应命令把 `fix/source-version-order` 换成 `origin/main` 即可，见「评审响应 · R1」的验证表。

**最小闭环**：本计划进入叠在栈底之上的分支，draft PR 关联 issue。
**涉及文件**：本计划、`docs/README.md`。

- [ ] **前置**：栈底的 Batch 0 已完成，也就是 `fix/source-version-order` 已推送且含计划提交。
  - 在仓库根目录运行 `git ls-remote --heads origin fix/source-version-order`，期望一行输出。
  - 运行 `git log --oneline main..fix/source-version-order`，期望非空。
- [ ] 在检出 `feature/github-projects-read` 的工作树根目录（`.worktrees/github-projects-read`）运行 `git rev-parse --git-dir --git-common-dir`、`git status --short --branch`、`git worktree list --porcelain`、`git check-ignore -v .worktrees/`。期望只有本计划与 `docs/README.md` 两处改动。
- [ ] 安装依赖并核对解析路径：
  - `pnpm install --frozen-lockfile`
  - `ls -l node_modules/@harness-projects/core`，期望指向本工作树的 `../../packages/core`。
- [ ] 提交 `docs(exec-plan): 定稿 GitHub Projects 读取投影计划`，正文说明栈的位置与三份设计的取舍，末尾 `Refs #70`。
- [ ] rebase 到栈底：
  - 先建恢复锚点 `git branch backup/github-projects-read-plan HEAD`，再 `git rebase fix/source-version-order`。
  - `docs/README.md` 的 Active 表会冲突，因为两层都在同一行后追加。按「栈底行在前、本层行在后」两行都保留，然后 `git rebase --continue`。
- [ ] 回读基线（此时代码与栈底 head 相同）：`node --test tests/contract/planning-contract.test.js tests/e2e/chain-bootstrap.test.js`，把 `ℹ tests` 与 `ℹ fail` 连同检出的分支和 head 写进 `Progress`。Batch 1 的「多 3 条」以这个值为准。
- [ ] 推送 `git push -u origin feature/github-projects-read`，开 draft PR。
  - base `fix/source-version-order`。
  - 标题 `feat(providers): 读取 GitHub Projects 条目并映射为成员关系与内容观察`。
  - 标签 `kind:feat`、`area:providers`、`area:capabilities`、`area:core`。
  - 描述按 `.github/pull_request_template.md` 写，用关闭关键字关联 #70，并写 `Refs #203 #124 #133 #134 #71 #27`。

**验证**（在检出 `feature/github-projects-read` 的工作树根目录运行）：

| 命令 | 期望 |
|---|---|
| `git log --oneline fix/source-version-order..HEAD` | 恰好 1 个提交 |
| `git diff --check fix/source-version-order...HEAD` | 无输出 |
| `node scripts/rule-checks.mjs disclosure fix/source-version-order` | 无命中 |
| `grep -nE '/Us[e]rs/\|/pr[i]vate/\|T[B]D\|T[O]DO\|稍后补[充]\|^[A-Z][A-Z0-9_]*=' docs/exec-plan/completed/2026-09-29-github-projects-read.md` | 无输出。字符类让这一行不匹配它自己 |
| `node --test tests/contract/e1-evidence-consistency.test.js tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js` | `ℹ fail 0` |
| `gh pr view <n> -R SingularityKChen/harness-projects --json baseRefName,isDraft,closingIssuesReferences,labels` | `baseRefName` 为 `fix/source-version-order`，`isDraft` 为 true，标签为上面四个。`closingIssuesReferences` 只记录、不据以判定：栈内 PR 的关闭引用登记机制未确定（`docs/project-management/merge-queue.md` §4），ready 前与栈底合并后各回读一次 |

**回滚**：合并前回到 `backup/github-projects-read-plan`；draft PR 是否关闭由人类伙伴决定。

### Batch 1 · 端口、替身、core 守卫与套件（T1，先红后绿）

**最小闭环**：端口带成员关系，替身满足新断言，core 不登记非内容身份，三者在同一批里自洽。
**涉及文件**：见 `Global Constraints` 的 T1。

- [ ] 从 Batch 0 的 head 建工作树并装依赖：`git worktree add .worktrees/github-projects-read-port -b feature/github-projects-read-port feature/github-projects-read`，然后 `pnpm install --frozen-lockfile`。
- [ ] **先写测试**：
  - `tests/contract/suites/planning.js` 新增用例「成员关系身份与内容身份分离，PR 成员关系不产生工作项（裁决 R1；E1-1 实验 3）」，用 `limit: 100` 读全量后断言：
    - 每个条目都带非空的 `membership.externalId`，并且在条目之间唯一；
    - `ref.objectKind` 属于三种内容种类时，`ref.externalId` 不等于 `membership.externalId`；
    - 否则必须同时满足 `content.kind === 'redacted'`、`ref.objectKind === 'project_item'`、`ref.externalId === membership.externalId`；
    - `ref.objectKind === 'change_request'` 时，`content.kind` 不是 `work_item`；
    - `content.kind === 'work_item'` 时，`ref.objectKind` 属于 `issue` / `draft`。
  - 同一文件新增用例「同一状态读两次逐字相同（分页与重复读取幂等）」：按 `expect.pageSize` 把全部页连续读两遍，结果 `deepEqual`。
  - 重复投递用例的循环里，给每条观察加一条断言：`sourceVersion === undefined || isComparableSourceVersion(sourceVersion)`。
  - 更新文件头注释，写明新增的两条不变量。
  - `tests/contract/planning-contract.test.js` 的提升用例：提升前先 `getPlanningItem(draftRef)`，提升后断言 `promoted.value.membership.externalId` 与提升前相同。
  - `tests/e2e/chain-bootstrap.test.js` 新增用例「身份：没有内容身份的条目不登记外部身份（裁决 R1）」：
    - 往 `threeItemComposition()` 的 `planning.state.items` 追加一条记录：ref 为 `{ objectKind: 'project_item', externalId: 'm-orphan' }`，content 为 `{ kind: 'redacted', reason: 'unavailable' }`，`membership.externalId` 为 `'m-orphan'`。
    - `compose` 之后调用 `commands.bootstrapWorkspace()`，断言 `ok === true`、`unanchored === 1`、`entities === 3`。
    - 断言 `exportFakeStorageState(storage).identities` 里没有任何一条的 `externalId` 是 `'m-orphan'`。
    - 断言 `listPlanningItems()` 仍是 3 条。
- [ ] 在产品代码仍为 base 时运行下面的命令，记录失败的用例名。期望恰好 3 条失败：套件新增的「成员关系身份与内容身份分离…」（替身标签）、「Planning 替身：draft→issue 提升…」、守卫用例。「同一状态读两次…」在 base 上本来就绿，属于钉住型，如实记录。

  ```bash
  node --test tests/contract/planning-contract.test.js tests/e2e/chain-bootstrap.test.js
  ```
- [ ] **实现**：按 `Design / Spec` 的「端口改动」与「core 守卫」修改。替身的 `promoteDraft` 不改。
- [ ] 本地提交 `feat(capabilities): 规划条目携带成员关系并让 core 不登记非内容身份`，末尾 `Refs #70`。WIP 也要提交，防止会话中断丢失工作。

**验证**（在检出 `feature/github-projects-read-port` 的工作树根目录运行）：

| 命令 | 期望 |
|---|---|
| `node --test tests/contract/planning-contract.test.js tests/e2e/chain-bootstrap.test.js` | `ℹ fail 0`，`ℹ tests` 比 Batch 0 回读的基线多 3 |
| `node --test tests/e2e tests/mvp0` | `ℹ fail 0` |
| `pnpm run typecheck` | exit 0 |
| `pnpm run boundaries` | `ℹ fail 0` |
| `grep -rn "asExternalKind" packages tests` | 无输出 |

**回滚**：丢弃任务分支 `feature/github-projects-read-port`。

### Batch 2 · provider 纯逻辑（T2，先红后绿）

**最小闭环**：provider 在合成输入上满足分类表、解码规则与观察规则。
**涉及文件**：见 `Global Constraints` 的 T2。

- [ ] **开工闸门**：
  - `git grep -n "export function sourceVersionFromTimestamp" fix/source-version-order -- packages/capabilities/src/observation.ts` 恰好一行。
  - T1 的提交已存在：`git log --oneline feature/github-projects-read-port`。
  - 闸门未开时，只写 `transport.ts`、`queries.ts`、`classify.ts` 与分类表用例。
- [ ] 建工作树：`git worktree add .worktrees/github-projects-read-provider -b feature/github-projects-read-provider feature/github-projects-read`。如果栈底有了新提交，先 rebase 到栈底。然后 `git cherry-pick <T1 提交>`，再 `pnpm install --frozen-lockfile`。
- [ ] **先写 `tests/contract/planning-github-projects-mapping.test.js`**。全部是合成输入，用例名带「合成」；合成 id 用 `item-1`、`issue-1` 这类明显的占位串。
  1. **分类表**（表驱动），每行断言 `code`、`retryable`、`retryAfterMs`、`rawClass`：
     - transport reject；
     - 401；
     - 403 无头；
     - 403 加 `retry-after: 7`，得到 7000；
     - 403 加 `x-ratelimit-remaining: 0` 与 `reset = now + 30s`，注入时钟下得到 30000；
     - 429；
     - 502；
     - 404，得到 `http_404`；
     - 200 但 body 为 undefined；
     - 200 且 errors 为 `NOT_FOUND`、`FORBIDDEN`、`INSUFFICIENT_SCOPES`、`RATE_LIMITED`；
     - `RATE_LIMITED` 与 `FORBIDDEN` 同时出现，得到 `rate_limited`；
     - 未知 type 得到 `graphql_<TYPE>`；
     - 非法 type 串得到 `graphql_error`；
     - **200 成功且带 `x-ratelimit-remaining: 0` 得到 ok**。
  2. **部分成功**：`data` 带 2 个条目，同时有 `errors: [{ type: 'FORBIDDEN' }]`。结果是 `ok === false`、`permission_denied`，并且没有 `value`。
  3. **项目不可见**：
     - `node` 为 null 且没有 errors，得到 `not_found`，不是空页；
     - `node.__typename === 'Issue'` 同样是 `not_found`；
     - `getProject` 与 `listPlanningItems` 都覆盖。
  4. **解码**：
     - `type` 与 `__typename` 不一致、未知 `type`、PullRequest 的 `number` 为 0、`updatedAt` 为 `2026-09-21 07:11:54`（空格分隔、无偏移），四种情况都是 `unavailable` 加 `malformed_response`；
     - `REDACTED` 与「`ISSUE` 但 `content` 为 null」都产出 redacted 条目：`ref.objectKind === 'project_item'`，`ref.externalId === membership.externalId`，`reason === 'unavailable'`；
     - PullRequest 映射成 `change_request` 内容。
  5. **分页信息**：`hasNextPage` 为真时，`endCursor` 为 null，或等于传入游标，都判形状错误。
  6. **入口守卫**：
     - `limit` 为 0 或 1.5 时返回 `invalid_input`，transport 调用次数为 0；
     - `limit` 为 500 时发出的变量是 `first: 100`；
     - 传入别的项目时返回 `invalid_input`，调用次数为 0；
     - `getPlanningItem` 收到 `objectKind: 'branch'` 时返回 `invalid_input`。
  7. **泄露**：哨兵串 `SENTINEL-TOKEN-7f3a` 分别放进 transport 抛出的异常文本、401 响应的一个响应头（如 `www-authenticate`），以及 body 的 `message` 里。三种情况下，`JSON.stringify(result)` 都不含哨兵串。
  8. **`reconcile` 全有或全无**：第 1 页成功且 `hasNextPage`，第 2 页返回 503。`reconcile` 产出 0 条观察，也不抛错。
  9. **`describeCapabilities`**：
     - 探针成功时 permission 为 `available`；
     - 401 时为 `unavailable`；
     - reject 时为 `degraded`；
     - `capability` 只有 `planning.item.read` 一个键。
- [ ] 在 base 上运行，文件因缺导出而加载失败，记录这一点。然后按 `Design / Spec` 实现各文件。
- T5 验收重构后，上面 9 组用例改为两张表（分类表、形状错误表）加 6 条用例，文件头注释逐条对应不变量与变异编号。第 4 组的「三类内容映射」移到契约文件的「条目映射」，在真实夹具上逐字段断言（D12）。
- [ ] 本地提交 `feat(providers): 以注入 transport 读取 GitHub Projects 条目并映射内容三态与观察`，末尾 `Refs #70`。

**验证**（在检出 `feature/github-projects-read-provider` 的工作树根目录运行）：

| 命令 | 期望 |
|---|---|
| `node --test tests/contract/planning-github-projects-mapping.test.js` | `ℹ fail 0` |
| `pnpm run typecheck` | exit 0 |
| `pnpm run boundaries` | `ℹ fail 0` |
| `grep -rnE "fetch\(\|process\.env\|node:child_process\|node:https?\|node:net" packages/providers/planning-github-projects/src` | 无输出 |
| `node scripts/rule-checks.mjs size fix/source-version-order` | 这是中途量规模：T1 加 T2 的代码 ≤ 540 行；超出按 `Global Constraints` 的收缩顺序处理 |

**回滚**：丢弃任务分支 `feature/github-projects-read-provider`。

### Batch 3 · 夹具录制、回放与验收（T3）

**最小闭环**：planning 契约套件在录制夹具上通过，core 引导沙箱 Project A 满足 #70 的五条验收。
**涉及文件**：见 `Global Constraints` 的 T3。

- [ ] 建工作树：`git worktree add .worktrees/github-projects-read-fixture -b feature/github-projects-read-fixture feature/github-projects-read`，然后依次 cherry-pick T1 与 T2 的提交，再 `pnpm install --frozen-lockfile`。
  - 在 T2 提交之前，可以先写 `replay.js` 与两个测试文件的骨架；它们会因为缺 provider 而红。
- [ ] **只读录制**：先按 `docs/architecture/gate-e1-sandbox.md` §2.1 在 shell 里设置 `$E1_PROJECT_A_ID`，并确认 `gh auth status` 已登录开发账号。然后在工作树根目录运行下面这段程序。它拒绝 `mutation`；`gh` 非零退出时立即中止。代码块顶格书写，因为 heredoc 的结束符 `EOF` 必须在行首：

```bash
node --input-type=module - "$E1_PROJECT_A_ID" > tests/contract/fixtures/github-projects/project-a.json <<'EOF'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { PLANNING_QUERIES, createGithubProjectsPlanningProvider } from '@harness-projects/provider-planning-github-projects'
const projectNodeId = process.argv[2]
const exchanges = []
const transport = async (request) => {
  if (/^\s*mutation\b/.test(request.query)) throw new Error('录制只允许只读查询')
  const body = JSON.parse(execFileSync('gh', ['api', 'graphql', '--input', '-'], { input: JSON.stringify(request), encoding: 'utf8' }))
  exchanges.push({ operationName: request.operationName, variables: request.variables, status: 200, body })
  return { status: 200, headers: {}, body }
}
const bindingId = 'binding-github-planning'
const project = { bindingId, objectKind: 'project', externalId: projectNodeId, url: undefined }
const provider = createGithubProjectsPlanningProvider({ bindingId, projectNodeId, transport })
const must = (result) => { if (!result.ok) throw new Error(result.error.code); return result.value }
must(await provider.getProject(project))
for (const limit of [100, 50]) must(await provider.listPlanningItems({ project, cursor: undefined, limit }))
let cursor
do cursor = must(await provider.listPlanningItems({ project, cursor, limit: 4 })).nextCursor; while (cursor !== undefined)
const hash = (text) => createHash('sha256').update(text).digest('hex')
const queryHashes = Object.fromEntries(Object.entries(PLANNING_QUERIES).map(([name, text]) => [name, hash(text)]))
const provenance = { source: 'e1-sandbox 只读查询', project: '$E1_PROJECT_A_ID', recordedAt: new Date().toISOString(), queryHashes }
process.stdout.write(`{"provenance":${JSON.stringify(provenance)},\n"exchanges":[\n${exchanges.map((e) => JSON.stringify(e)).join(',\n')}\n]}\n`)
EOF
```

  期望：exit 0；夹具共 6 条 exchange；`node -e "console.log(JSON.parse(require('fs').readFileSync('tests/contract/fixtures/github-projects/project-a.json','utf8')).exchanges.length)"` 输出 `6`。
- [ ] **发布面人工检查**：对夹具逐一核对 `docs/development/publication.md` 的五个类目，即凭据、本机路径与身份、账号个人信息、内部系统、保密字样。期望：只有已登记的沙箱 node id、公开账号名、`e1-sandbox` 仓库名与夹具说明句。
- [ ] **写 `replay.js`**，按 `Design / Spec` 的「夹具、回放与录制」实现。
- [ ] **写 `tests/contract/planning-github-projects-contract.test.js`**：
  - **套件适配器**，按 scenario 翻译：
    - `{}` 用回放；
    - `faults.offline` 用一个总是 reject 的 transport；
    - `faults.permissionDenied` 用一个返回 `{ status: 401, headers: {}, body: { message: 'Bad credentials' } }` 的 transport；
    - `faults.duplicateEvent` 在回放 provider 实例上覆盖 `reconcile`：独立跑两遍原方法，条数不同就抛错，然后按对交错产出；
    - `capabilities.*` 忽略。
    - `now` 注入一个每次调用递增 1000 的时钟。
    - `expect`：`project` 为绑定的 ref，`pageSize: 4`，`items` 手写 9 行（内容 node id、objectKind、contentKind；5 行 issue / work_item、3 行 draft / work_item、1 行 change_request / change_request），`redactedReason: 'unavailable'`。
  - **provenance**：用 `/[A-Za-z0-9_-]+/g` 切出夹具文本里的 token。凡以 `PVTI_`、`PVT_`、`I_kw`、`PR_kw`、`DI_` 开头且长度 ≥ 10 的，都必须出现在 `docs/architecture/gate-e1-sandbox.md` 里。
  - **查询漂移**：`provenance.queryHashes` 必须 `deepEqual` 按 `PLANNING_QUERIES` 现算的 sha256。
  - **录制事实**：
    - 9 个条目的种类分布是 issue 5、draft 3、change_request 1；
    - 成员关系 id 集合与内容 id 集合不相交；
    - PR 条目的 `changeRequest.number > 0`。
    - T5 验收重构后，这三点由套件按期望条目逐条核对：分页、R1 与内容三态三条套件用例。契约文件改为断言 issue-alpha 的条目逐字段映射，也就是「条目映射」用例（D12）。
  - **R7**：`getPlanningItem({ objectKind: 'draft', externalId: <draft-convert 转换前的内容 id，登记在 gate-e1-sandbox.md §2.3> })` 返回 `not_found`，且 `retryable === false`。回放 `calls` 里每个请求的变量键都属于 `project`、`first`、`after`，并且没有一个取值等于该 id。
  - **观察**：
    - 一遍 `reconcile` 产出 18 条：9 条 `planning.content.observed`、9 条 `planning.membership.observed`。
    - 全部满足 `isComparableSourceVersion`。
    - 对 issue-alpha，内容观察的 `sourceVersion` 等于 `sourceVersionFromTimestamp(内容 updatedAt)`，成员关系观察的等于 `sourceVersionFromTimestamp(成员关系 updatedAt)`，两者不同。
    - 两遍 `reconcile` 的 `dedupeKey` 序列相等，`receivedTime` 不同。
  - **最后一条**：`misses` 为空。
- [ ] **写 `tests/integration/github-projects-bootstrap.test.js`**，对 `createFakeStorage()` 与 `createSqliteStorage(':memory:')` 各跑一轮：
  - **装配**：provider 的 transport 是一个可切换的包装。先指向回放。`composeCore({ workspace: { id: newWorkspaceId(), name, project }, providers: { planning, storage } })`，其中 bindingId 取 `newProviderBindingId()`。
  - **第二次引导**：`commands.bootstrapWorkspace()` 得到 `ok: true`，`entities: 9`、`workItems: 8`、`changeRequests: 1`、`unanchored: 0`。
  - **身份与主键**：
    - `listPlanningItems()` 共 9 条，按 `kind` 分是 8 个工作项、1 个变更请求；
    - 每条 `content.identity.externalId` 的集合等于 9 个内容 node id，与成员关系 id 集合不相交；
    - 每条 `entityId` 都不在夹具的 node id 集合里。
  - **行数不变**（只对替身，用 `exportFakeStorageState` 读）：composeCore 之后与第二次引导之后，实体 9、身份 9、观察 18 三个数都相同。
    - T5 验收重构后，这一项并入引导用例。两种 Storage 都以两次引导前后实体 id 集合不变判定幂等，行数只在替身上读取（D12、D13）。
  - **故障**：依次把 transport 切到「总是 reject」和「200 带 data 与 `errors: [{ type: 'FORBIDDEN' }]`」，再引导。
    - 结果是 `ok: false`、`degraded: true`，`error.code` 依次为 `unavailable`、`permission_denied`。
    - `listPlanningItems()` 的 `planningStatus` 与 content 和故障前 `deepEqual`。
    - 每条 `freshness.degraded === true`。
  - **最后一条**：`misses` 为空。
- [ ] `tests/integration/README.md` 新增「GitHub Projects 读取（#70）」一节，用表格登记上面的用例与它们保护的不变量。
- [ ] 本地提交 `test(providers): 以录制夹具验收 GitHub Projects 读取投影`，末尾 `Refs #70`。

**验证**（在检出 `feature/github-projects-read-fixture` 的工作树根目录运行）：

| 命令 | 期望 |
|---|---|
| `node --test tests/contract/planning-github-projects-contract.test.js tests/integration/github-projects-bootstrap.test.js` | `ℹ fail 0` |
| `env -u GH_TOKEN -u GITHUB_TOKEN node --test tests/contract/planning-github-projects-contract.test.js tests/contract/planning-github-projects-mapping.test.js tests/integration/github-projects-bootstrap.test.js` | `ℹ fail 0`，说明测试不依赖凭据 |
| `grep -nE "fetch\(\|node:child_process\|node:https?\|node:net\|process\.env" tests/contract/fixtures/github-projects/replay.js tests/contract/planning-github-projects-*.test.js tests/integration/github-projects-bootstrap.test.js` | 无输出 |
| `node scripts/rule-checks.mjs disclosure fix/source-version-order` | 无命中 |

**回滚**：丢弃任务分支 `feature/github-projects-read-fixture`。夹具只是测试数据，删除它不影响沙箱。

### Batch 4 · 对抗验证（T4）

**最小闭环**：在集成后的树上证明每条新断言都有判别力，没有「因错误原因通过」。
**涉及文件**：无持久写入。

- [ ] 在 T5 把 T1–T3 的提交依次取入 `feature/github-projects-read` 之后，建分离工作树：`git worktree add --detach .worktrees/github-projects-read-verify feature/github-projects-read`，然后 `pnpm install --frozen-lockfile`。
- [ ] **base-src 回放**：
  - 把下列产品文件恢复成栈底版本：`git restore --source=fix/source-version-order -- packages/capabilities/src/planning-provider.ts packages/core/src/identity.ts packages/core/src/bootstrap.ts packages/core/src/context.ts packages/providers/fake/src packages/providers/planning-github-projects/src`。`git restore` 默认是 no-overlay 模式，provider 包里栈底不存在的新文件会被一并移除；用 `ls packages/providers/planning-github-projects/src` 确认只剩 `index.ts`。
  - 运行「最小成功证据」第 1 条的五个文件。期望的失败集合见 `Validation and Acceptance` #6。
  - 最后 `git checkout HEAD -- packages`，并用 `git status --short` 确认工作区干净。
- [ ] **变异表**：
  - 每条变异单独应用。替换目标在文件中必须恰好出现 1 次；M17 例外，成员关系 id 在夹具中出现 3 次，只替换第一处。
  - 生效判据有两条：磁盘内容等于「首处精确替换」的结果；`git diff` 只有 1 个文件、1 个 hunk（`git diff -U0` 里的 `@@` 计数）。
  - 然后跑下表的最窄命令，核对变红的恰好是预期用例。
  - 最后 `git checkout HEAD -- <file>`，再 `git diff --quiet` 并重跑到绿。
  - 不用 `git checkout -- <file>`（它恢复到索引，不是 HEAD），也不用 `cp`（本机的 `cp` 会卡在覆盖确认上）。

| # | 变异（文件） | 预期变红 |
|---|---|---|
| M1 | PullRequest 映射成 work_item（`decode.ts`） | 套件「成员关系身份与内容身份分离…」与「内容三态判别…」的 GitHub 标签、集成引导用例（两种 Storage） |
| M2 | 内容条目的 ref 取成员关系 id（`decode.ts`） | 套件同一用例的 GitHub 标签、契约「条目映射」、集成引导用例 |
| M3 | body 带 `data` 时忽略 `errors`（`classify.ts`） | mapping 分类表「部分成功」行、集成故障用例 |
| M4 | 扫描遇到失败页当作读完（`provider.ts`，即「边读边算」的部分成功） | mapping「reconcile 全有或全无」 |
| M5 | transport 的抛错不被捕获（`provider.ts` 的 catch 在 `rawClass` 仍为 `transport_error` 时重抛） | 套件离线用例的 GitHub 标签、mapping 分类表 reject 行、集成故障用例 |
| M6 | 去掉 `type` 与 `__typename` 的一致性校验（`decode.ts`） | mapping 形状错误表「不一致」行 |
| M7 | 去掉游标停滞校验（`decode.ts`） | mapping 游标用例 |
| M8 | 内容观察取成员关系版本（`provider.ts`） | 契约观察用例 |
| M9 | 内容版本取平台原值（`decode.ts`） | 契约观察用例（`makeObservation` 拒绝后一条不产出）、套件重复投递用例 |
| M10 | 恢复「未知种类按 issue 处理」（`identity.ts`） | chain-bootstrap 守卫用例 |
| M11 | `promoteDraft` 重新生成成员关系（`fake/src/planning.ts`） | planning-contract 提升用例 |
| M12 | 项目节点为 null 时当作空项目（`decode.ts`） | mapping 分类表「node 为 null」行 |
| M13 | 去掉 `limit` 钳位（`provider.ts`） | mapping 入口守卫用例 |
| M14 | `errors` 为空时也按 `x-ratelimit-remaining: 0` 判限流（`classify.ts`） | mapping「成功响应带 remaining 0 与空 errors」 |
| M14b | 空的 `errors` 数组不算成功（`classify.ts`） | 同上 |
| M15 | 回放键忽略 `after`（`replay.js`） | 套件「分页遍历不重不漏」的 GitHub 标签 |
| M16 | `PlanningItems` 查询多选一个字段且不重录（`queries.ts`） | 契约「查询漂移」 |
| M17 | 夹具里一个成员关系 id 的第一处出现改动末位（`project-a.json`） | 契约「provenance」 |
| M18 | 列表条目的 `sourceUpdatedAt` 取 `now()`（`provider.ts`） | 套件「同一状态读两次逐字相同」的 GitHub 标签、契约「条目映射」 |
| M19 | `rawClass` 拼接不合 `^[A-Z_]{1,40}$` 的平台 type（`classify.ts`） | mapping 分类表「type 不匹配」行（哨兵串进入结果） |
| M19b | catch 把 transport 的异常作为 `cause` 挂进错误（`provider.ts`） | mapping 分类表 reject 行 |
| M20 | `Object.hasOwn(KINDS, type)` 改回 `type in KINDS`（`decode.ts`） | mapping 形状错误表「未知 type（constructor）」行 |
| M21 | 去掉扫描的成环守卫（`provider.ts`） | mapping 游标用例 |
| M22 | 去掉 `reconcile` 包住时钟与观察构造的 try/catch（`provider.ts`） | mapping「reconcile 全有或全无…」的 `NaN` 时钟断言 |
| M23 | 去掉 `hasNextPage` 必须是布尔值的检查（`decode.ts`） | mapping 分类表「hasNextPage 缺失」行 |
| M24 | `errors` 不是数组时当作没有错误（`classify.ts`） | mapping 分类表「errors 不是数组」行 |
| M25 | 不核对项目节点 id（`decode.ts`） | mapping 分类表「项目 node 是别的项目」行 |
| M26 | 状态码判定改回 `status < 200 \|\| status > 299`（`classify.ts`） | mapping 分类表「状态码不是整数」行 |
| M27 | 去掉 403 正文的二级限流判定（`classify.ts`） | mapping 分类表「403 二级限流」行 |

- [ ] **可复现性**（只读，需要 `gh` 登录）：在分离工作树里重跑 Batch 3 的录制程序，输出到临时位置，再与已提交夹具比较。期望只有 `recordedAt` 不同。如果网络或凭据不可用，记为「跳过」并写明原因，不算通过。
- [ ] 把回放结果、变异表（变异 → 红用例名 → 还原后绿）与可复现性结果交给 T5，写进 `Progress`。

**验证**：同上各条的期望。任一变异未按预期变红，就回到对应任务补用例，并记入 `Surprises & Discoveries`。

**回滚**：删除分离工作树，清理走 `git-expert-operations` 流程。

### Batch 5 · 验收重构、证据与 PR 定稿（T5）

**最小闭环**：一个可独立验收、合并、回滚的提交序列，PR 从 draft 转为 ready，然后请人类评审。
**涉及文件**：见 `Global Constraints` 的 T5。

- [ ] 在 `.worktrees/github-projects-read` 上依次取入 T1、T2、T3 的提交。先建 `backup/github-projects-read-<日期>`，如果栈底有新提交，先 rebase 到栈底。
- [ ] **独立审读**：不变量、接口、错误路径、注释与实现是否一致、测试判别力。重构不得改变验收结果，重构后重跑 Batch 1–3 的验证。
- [ ] 更新本计划的 `Progress`、`Surprises & Discoveries`、`Outcomes & Retrospective`、`Bottom Change Note`，然后提交 `docs(exec-plan): 记录 GitHub Projects 读取投影的判别与变异证据`，末尾 `Refs #70`。
- [ ] **整理提交序列**：目标是 5 个提交，依次为计划、T1、T2、T3、证据。
  - 用 `comm` 比对整理前后两个 head 的文件集合：`git diff --name-only fix/source-version-order...<head>` 取两份，排序后比较，不得丢文件。
  - 逐个提交检出后跑 `pnpm run typecheck && node --test tests/contract/planning-contract.test.js tests/e2e/chain-bootstrap.test.js`；T2 及之后的提交再加上对应的新测试文件。每个提交都必须为绿。
- [ ] **推送**：已推送的分支用精确的旧 head 做 `--force-with-lease`。然后回读 PR 的 head、base、checks、关闭引用与评审线程。验证全部通过后运行 `gh pr ready <n> -R SingularityKChen/harness-projects`，再请人类评审。是否合并由人类伙伴决定；合并顺序是栈底先合并。

**验证**（在检出 `feature/github-projects-read` 的工作树根目录运行）：

| 命令 | 期望 |
|---|---|
| `pnpm verify` | exit 0 |
| `pnpm run boundaries` | `ℹ fail 0` |
| `node scripts/workflow-check.mjs` | exit 0 |
| `node scripts/rule-checks.mjs size fix/source-version-order` | 代码 ≤ 800、文档 ≤ 1300 |
| `node scripts/rule-checks.mjs disclosure fix/source-version-order` | 无命中；另按 `docs/development/publication.md` 人工过五个类目 |
| `git diff --check fix/source-version-order...HEAD` | 无输出 |
| `git diff --name-only fix/source-version-order...HEAD` | 只含 `Global Constraints` 列出的文件 |
| `node --test tests/contract/e1-evidence-consistency.test.js` | `ℹ fail 0` |
| `git log --format='%s%n%b' fix/source-version-order..HEAD` | 格式合规；正文不含关闭关键字；各自以 `Refs #70` 结尾 |
| `gh pr view <n> -R SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,labels,isDraft` | `headRefOid` 等于本地 `git rev-parse HEAD`；`baseRefName` 为 `fix/source-version-order`，栈底合并后回读应为 `main` |
| `gh pr checks <n> -R SingularityKChen/harness-projects` | `PR Fast Gate` 为 pass |

**回滚**：合并前回到 backup ref；合并后见 `Idempotence and Recovery`。

### 评审响应 · R1（评审 5362364398）

**来源**：人类伙伴（评审账号）对 `7c5443d`（base `main@2f9e0ee`）的评审 5362364398，CHANGES_REQUESTED。
- inline 4141515880（P1，`packages/core/src/bootstrap.ts:139`）：含无法锚定成员的读取被提交为健康完整快照。要求至少把这种遍历标成不完整或退化，并让查询能表达权限缺口；有成员映射时产出剥离正文的 redacted 占位；加「可见 → 部分 / 全部 redacted → 恢复」的组合回归；不为显示旧缓存而泄露不可见内容。
- inline 4141515886（P2，`packages/providers/planning-github-projects/src/provider.ts:102`）：core 的 `readAllItems` 逐页读取没有跨页成环终止。要求在消费分页的 core 层记录已发游标或设有界终止，返回结构化 degraded，并在真实 bootstrap 路径上加环形分页用例。
- inline 4141515895（P2，本计划第 16 行）：上游计划入口改指 completed，同步 `Interfaces and Dependencies` 与 PR 正文里的旧父分支、旧 head。
- 总述：修复或变基后重新取 refs、checks、threads，证明反例已修复后再取得新 head 的批准。

**判断与复现**（`docs/review/responding.md` §1；定稿者，2026-09-30，在检出 `feature/github-projects-read@2ed8c4a` 的工作树根目录用 `node --input-type=module` 运行只 import workspace 包的脚本，不改仓库文件）。三条都属实，前两条是事实缺陷：
- P1：回放夹具经 `composeCore` 引导得 9 条后，把 PlanningItems 应答里每 3 条中的 1 条、再到全部改成 `type: REDACTED, content: null`（成员关系 id 不变）再引导。替身与 SQLite 结果一致：部分扣下为 `{ok:true, entities:6, unanchored:3, degraded:false}`，全部扣下为 `{ok:true, entities:0, unanchored:9, degraded:false}`；游标都是 healthy，controller `snapshot().source.freshness` 都是 `fresh`。恢复可见后 9 条、实体 id 不变。
- P2：PlanningItems 按 `after` 应答 null → A → B → A，nodes 为空，`hasNextPage` 恒真，transport 第 CAP+1 次调用起 reject。CAP 取 200 与 2000 时，组装的请求数都恰为 CAP+1：前 3 次是 reconcile 的扫描，它识别成环后停下；其后全部来自 `readAllItems`。`composeCore` 只是靠看门狗才返回。
- 分级：P1 是本层回归，因为 `main` 的 core 把未知种类折成 issue，没有 unanchored 分支。P2 是 `main` 既有缺陷，由本层的真实 provider 首次变得可达（见 Surprises），仍在本 PR 收口。

**Design / Spec 增补**（D16、D17 为决策记录）：
- **R1-a 按成员关系锚定的占位**（`bootstrap.ts` 新增 `anchorOf`，`upsertItems` 改为调用它）。
  - 有内容身份的条目：在引导事务里先 `tx.putMembership`（工作区、项目、成员关系 id、内容种类与 id、两个成员关系时间戳）记下映射，再 `ensureEntity`。端口与表来自 ADR-0002 与迁移 002，两种 Storage 都已实现并有契约。
  - 没有内容身份的条目（ref 为 `project_item`）：只读地 `getMembership(工作区, 成员关系 id)`，再 `findExternalIdentity(条目 binding, 映射的内容种类, 映射的内容 id)`，命中就用该实体出投影。这条路径不调用 `ensureEntity` / `putEntity` / `putExternalIdentity`，成员关系 id 永不进身份表（R1）。投影内容只取本次读到的 `redacted`，没有 title、body、number；状态取本次读到的字段；不读旧投影。实体种类由映射的内容种类决定，被扣下的 PR 仍是 change_request。找不到映射（首次读取就不可见、升级前的库没有映射行、成员关系 id 变了）时计入 `unanchored`，不建投影；`replacePlanningProjections` 照常移除它的旧投影，不为显示缓存而泄露内容。
  - 提交语义：可锚定的部分照常提交。`unanchored > 0` 时，游标写 `degraded` 与 `lastErrorCode: permission_denied`，结果为 `ok: true, degraded: true, error: permission_denied`（恢复动作 `fix_permission`）。`unanchored = 0` 时写 `healthy`，包括全部条目都是占位与合法的空项目。`ok: false` 仍只表示「本次什么都没提交」（`fail()`）。Superseded by D23（2026-09-30）：`unanchored > 0` 时游标改写 `healthy` 加 `lastErrorCode: permission_denied`，`degraded` / `failed` 只留给什么都没提交的读取；`BootstrapResult` 与查询信号不变。
- **R1-b 工作区级信号**：`CoreQueries.getPlanningSync(): Promise<SyncSummary>` 直接返回既有的 `syncSummary`，0 条时也能读；`unavailableCore` 返回 `{ degraded: true, reason }`。controller 的 `snapshot()` 把它传给 `toWireSnapshot(views, authority, revision, sync)`，`source.freshness` 与 `reason` 只由它决定，修掉「0 实体恒为 fresh」。client 与 ui-model 不改，见 TD14。Superseded by D23 / D24（2026-09-30）：`SyncSummary` 另有 `stale`，`unavailableCore` 返回 `{ degraded: true, stale: true, reason }`；行的新鲜度取 `stale`，`snapshot.source` 取 `degraded`；ui-model 对 redacted 不给主身份。
- **R1-c 分页有界终止**：core 的 `readAllItems` 记录已发送的游标，`nextCursor` 回到集合内即停；另用独立的页计数器，上限 `MAX_PAGES = 1000`（每页 50 条，共 5 万条）。两者任一命中，都返回 `providerErr(unavailable, '规划条目分页成环或超过页数上界，本次读取不完整')`，经既有的 `fail()` 写 degraded、投影保持最后已知值，不提交部分结果。
  - provider 的 `scan` 加 `MAX_SCAN_PAGES = 500`（每页 100 条）：组装时 reconcile 的扫描先于 `readAllItems` 运行，扫描无界时 core 的上界在真实路径上不可达。解码器在单页上的「游标等于传入值」检查保留。
- **R1-d 文档入口**：本计划的头部、「栈的位置」与 `Interfaces and Dependencies` 已随 R1 计划提交改为 base `main`，上游计划入口指向 completed。PR 正文在推送时同步。

**涉及文件**：见 `Global Constraints` 的「R1 · 评审响应」。

**步骤**（在检出 `feature/github-projects-read` 的工作树根目录 `.worktrees/github-projects-read`）：
- [x] 核对恢复锚点 `backup/github-projects-read-7c5443d` 与 `backup/github-projects-read-pre-r1-2ed8c4a` 存在：`git rev-parse backup/github-projects-read-7c5443d backup/github-projects-read-pre-r1-2ed8c4a | cut -c1-7`，期望依次为 `7c5443d`、`2ed8c4a`。
- [x] **先红**：只加 `getPlanningSync`（纯读取，行为不变）与下表用例，其余产品代码保持 `2ed8c4a` 的样子运行。失败必须是表中列出的断言差异，不能是 `TypeError`。然后实现 R1-a 到 R1-c，直到变绿。
- [x] **变异**：按 Batch 4 的生效判据逐条执行下方的 M28–M36，每条都用 `git checkout HEAD -- <file>` 还原。
- [x] **提交**：每个提交单独为绿，身份用 `git -c user.name=… -c user.email=…` 单次传入，正文以 `Refs #70` 结尾。依次为 `fix(core): 无法锚定的规划条目标为不完整并按成员关系出 redacted 占位`（R1-a、R1-b 及其用例）、`fix(core): 规划条目分页成环或超过页数上界时有界终止`（R1-c 及其用例）、`docs(exec-plan): 记录评审响应 R1 的判别与变异证据`。
- [ ] **推送与回读**（`docs/review/responding.md` §3，按 `git-expert-operations` 流程）：用 `--force-with-lease=feature/github-projects-read:7c5443d` 推送；回读 head、base、mergeStateStatus、checks 与 threads；改写 PR 正文里的栈信息、提交表与证据，加标签 `area:controller`；三条 thread 逐条回复根因、命令与结果后 resolve；请人类伙伴在新 head 上复评。本步在包含本计划的最终提交之后执行（计划记录不了包含自身的 head），结果写在 PR 描述与三条 thread 的回复里，下次改动本计划时补记。

**判别性用例**（第三列是定稿者原型在 `2ed8c4a` 上只补 `getPlanningSync` 时实测到的失败）：

| 用例（文件） | 断言 | `2ed8c4a` 上的失败 |
|---|---|---|
| 集成「未见过 → 可见 → 部分 / 全部 REDACTED → 映射失效 → 恢复…」（`tests/integration/github-projects-bootstrap.test.js`，两种 Storage） | ① 冷启动时全部 REDACTED：视图为 `[]`，`getPlanningSync()` 为 `{degraded:true, reason:'permission_denied'}`，`snapshot().source.freshness` 为 `degraded`。② 可见之后扣下 3 条、再扣下全部：结果 `[ok, degraded, unanchored, error]` 为 `[true, false, 0, undefined]`；视图恒为 9 条，实体 id 集合不变；redacted 行依次为 3 条、9 条，都没有标题；被扣下条目的夹具标题与正文不出现在 `listPlanningItems` 与 `getItemDetail` 的 JSON 里；同步摘要不降级。③ 全部扣下且成员关系 id 变了：结果为 `[true, true, 9, 'permission_denied']`，视图 0 条，摘要降级。④ 恢复：实体 id 集合与 ② 相同，摘要 healthy，`snapshot` 为 `fresh` | ① 得到 `[[], {degraded:false}, 'fresh']`；去掉 ① 后，② 得到 `unanchored 3` |
| 集成「故障（离线、部分成功、分页成环或永不收敛）…」（同一文件，由原「故障不伪造成功」扩写而来） | 首轮组装遇到 A → B → A：PlanningItems 恰好 6 次（扫描 3 次、逐页读取 3 次），视图为 `[]`，摘要原因为 `unavailable`。可见之后依次切到离线、部分成功、A → B → A、永不重复的游标：`[ok, degraded, code]` 都是 `[false, true, …]`；成环时再多 6 次，永不重复时恰好 1500 次（扫描 500 次、逐页读取 1000 次），错误文案含「成环或超过页数上界」；投影与故障前逐字相同，每条带 `freshness.degraded` | 首轮得到 `48`：transport 第 50 次调用起 reject 才返回 |
| e2e「身份：没有内容身份的条目不登记外部身份」（`tests/e2e/chain-bootstrap.test.js`） | 追加 `[ok, degraded, error.code]` 为 `[true, true, 'permission_denied']`，3 条视图的 `freshness.reason` 都是 `permission_denied`（Superseded by D23：R2 起 3 条视图的 `[degraded, reason]` 都是 `[false, undefined]`，摘要为 `{degraded: true, stale: false}`） | 得到 `[true, false, undefined]` |
| e2e「全量收敛：provider 返回空集合…」（同一文件，钉住型） | 追加 `getPlanningSync().degraded === false`：合法的空项目不是不完整读取 | 为绿，只用来钉住 M36 |

**变异表**（定稿者在原型上逐条跑过：已生效 → 预期用例变红 → 还原 → 变绿）：

| # | 变异（文件） | 预期变红 |
|---|---|---|
| M28 | 跳过 `putMembership`（`bootstrap.ts`） | 集成占位用例（两种 Storage） |
| M29 | `unanchored > 0` 时仍写 healthy（`bootstrap.ts`） | 集成占位用例、e2e 身份用例 |
| M30 | 占位改用旧投影的内容（`bootstrap.ts`） | 集成占位用例 |
| M31 | 去掉 core 的成环判定（`bootstrap.ts`） | 集成故障用例 |
| M32 | 去掉 core 的页数上界（`bootstrap.ts`） | 集成故障用例 |
| M33 | 去掉扫描的页数上界（`provider.ts`） | 集成故障用例 |
| M34 | `toWireSnapshot` 忽略同步摘要，改回按实体推导（`wire.ts`） | 集成占位用例 |
| M35 | 占位路径新建实体，而不是按映射找回（`bootstrap.ts`） | 集成占位用例 |
| M36 | 实体为 0 时也写 degraded（`bootstrap.ts`） | e2e 全量收敛用例 |

看门狗 reject 与守卫终止都得到 `unavailable`，所以 M31–M33 的判据是请求计数与错误文案，不只是错误码。

**验证**（同一检出）：

| 命令 | 期望 |
|---|---|
| `node --test tests/integration/github-projects-bootstrap.test.js tests/e2e/chain-bootstrap.test.js tests/e2e/controller-roundtrip.test.js tests/e2e/client-sync.test.js` | `ℹ fail 0` |
| `pnpm verify`；`pnpm run boundaries`；`node scripts/workflow-check.mjs` | 退出码 0；`ℹ fail 0`；退出码 0 |
| `node scripts/rule-checks.mjs size origin/main` | 代码 ≤ 1000（预计约 915，见 D20），文档 ≤ 1300 |
| `node scripts/rule-checks.mjs disclosure origin/main`；`git diff --check origin/main...HEAD` | 无命中；无输出 |
| `git diff --name-only origin/main...HEAD` | 只含 `Global Constraints` 列出的文件，不含 `docs/review/` 下的任何文件 |
| `gh pr view 241 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,mergeStateStatus,closingIssuesReferences,labels` | `headRefOid` 等于本地 `git rev-parse HEAD`，base 为 `main`，关闭引用含 #70 |

**回滚**：合并前回到 `backup/github-projects-read-pre-r1-2ed8c4a`。合并后 revert 两个修复提交，就回到评审前的「跳过并计数、游标 healthy」与无界分页，两者都是已登记的缺陷。R1 不涉及迁移、DDL 与外部写入；已写的映射行留在 `project_item_membership` 里无害，只被本路径读取。

### R2 · 评审后决策（人类伙伴授权主会话调研后抉择）

**来源**：人类伙伴 2026-09-30 的指示：「规模，接受；其余你先调研，按照最佳实践和第一性原理进行抉择」。主会话据一手调研作出下列决定，本批次落实。依据来源都是公开文档或开源实现，逐条写入 D22–D26。

- **H10（保持）**：已有成员映射的 REDACTED 条目出剥离正文的占位行时，同步整体保持 healthy。条目受限是条目状态，不是读取失败。
- **H11（改）**：存在连映射都没有的不可见条目时，整次读取仍记 degraded（原因 `permission_denied`，消息含数量），但本次读取刚确认的可见行保持 fresh。`stale` 只表示「旧于最近一次成功读取」。读取彻底失败（`ok: false`）时保留的旧投影仍按现状标 degraded / stale。
  - 落点：`SyncSummary` 加 `stale`（行是否旧于最近一次成功读取），`degraded` 仍是读取层结论，`snapshot.source` 只看 `degraded`。游标不加状态、不改 DDL：本次提交成功但有缺口时写 `healthy` 加 `lastErrorCode: permission_denied`；`degraded` / `failed` 只留给「什么都没提交」。`syncSummary` 据此得到 `{degraded: true, stale: false}`。
  - `BootstrapResult` 不变：`ok: true, degraded: true, error: permission_denied`。
- **H12（保留在内部）**：占位行内部保留内容外部 id 与种类，仅作去重与恢复的键，不得出现在面向界面的 wire 对象。
  - **核查结论（h12_finding）**：`WireContentRef` 对所有内容（含 redacted）都带 `externalKind` 与 `externalId`，ui-model 的 `source.primary` / `identities` 原样透出，所以被扣下条目的内容 node id 与种类目前会到达界面。标题、正文、编号与 url 没有带出（wire 里本来没有编号与 url，redacted 的标题与正文为 undefined）。
  - 修法：redacted 时 wire 的 `externalKind` / `externalId` 为 undefined（保留 `bindingId`，它是来源而不是内容）；ui-model 的 `sourceOf` 对应返回 `primary: undefined`、`identities: []`。core 的 `PlanningItemView` 是宿主内部面，不改。
- **分类表第 2 行（接受并补缺口）**：二级限流的判定改为 `/\bsecondary rate\b/i`，与 octokit plugin-throttling 一致；HTTP 200 加 `errors[]`、任一条 `message` 命中时同样判 `rate_limited`，`retryAfterMs` 沿用现有规则（`retry-after` 头，其次 `reset`，否则 undefined，等待下限与重试归调度层 #134）。其他 403 仍判 `permission_denied`。
- **TD14**：client / ui-model 尚未消费 `snapshot.source`，归 #178，在该 issue 上留言登记（验收者执行）。
- **H1–H9**：按原推荐执行；H6 按 AGENTS.md §7 需人类点名批准，不改关系。

**判别性用例**：

| 用例（文件） | 断言 | 变更前 |
|---|---|---|
| 集成占位用例加一步「3 条不可见且映射失效」（`tests/integration/github-projects-bootstrap.test.js`，两种 Storage） | 6 行可见且 `freshness.degraded` 为 false；结果 `[true, true, 3, permission_denied]`；`getPlanningSync()` 为 `{degraded:true, stale:false, reason:'permission_denied'}`；`snapshot().source` 为 `degraded` 加同原因，实体的 `source.freshness` 都是 `fresh` | 6 行都带 `degraded` |
| 集成故障用例（同文件，钉住型） | 读取失败后 `getPlanningSync().stale` 为 true，行仍 degraded | 为绿，只用来钉住 M39 |
| 集成占位用例加断言（同文件） | 冷启动与 wire：redacted 实体的 `content.externalKind` / `externalId` 为 undefined，整个快照 JSON 不含任何内容 node id；同一快照里可见实体仍带身份 | 带出内容 node id |
| 契约的 ui-model 用例（`tests/contract/ui-model-presentation.test.js`，钉住型） | fixture 里 redacted 条目带着内容外部 id（上游误带），行与详情的 `source.primary` 仍为 undefined、`identities` 为空 | 为绿，只用来钉住 M42 |
| 分类表（`tests/contract/planning-github-projects-mapping.test.js`） | 200 加 `errors[{message: 含 secondary rate limit}]` 为 `rate_limited`，带 `retry-after` 取其值；200 加不含它的 message 仍是 `unavailable` | 得到 `unavailable` |

**变异**：

| # | 变异 | 预期变红 |
|---|---|---|
| M37 | `syncSummary` 让 `stale` 恒等于 `degraded`（`queries.ts`） | 集成占位用例 |
| M38 | 有缺口的提交写 `degraded` 而不是 `healthy`（`bootstrap.ts`） | 集成占位用例 |
| M39 | `syncSummary` 对 `degraded` / `failed` 游标也返回 `stale: false`（`queries.ts`） | 集成故障用例 |
| M40 | wire 对 redacted 也带内容身份（`wire.ts`） | 集成占位用例 |
| M41 | 分类不看 200 加 errors 的 message（`classify.ts`） | 分类表 |
| M42 | ui-model 只按 id 缺失判断、不看 redacted（`derive.ts`） | ui-model 不变量用例 |
| M43 | 行的 `reason` 不随 `stale` 清空（`projection.ts`） | e2e 身份用例 |
| N1–N3 | 二级限流正则去掉单词边界 / 去掉 403 分支的 `isRecord` 保护 / 只看 `errors[0]`（`classify.ts`；验收补） | 分类表「403 无限流头」「403 body 为 null」「200 + errors 第二条」行 |
| N4 | redacted 只剥 `externalId`、仍带 `externalKind`（`wire.ts`；验收补） | 集成占位用例（两种 Storage） |
| N7a / N7c | 能力门不可用、没有 storage 时 `stale: false`（`queries.ts`、`context.ts`；验收补） | e2e 降级用例 |

**回滚**：合并前回到 `b341764`。R2 不涉及迁移、DDL 与外部写入；游标的写法变化只影响新写入的行，旧行读回为 `degraded`，按读取失败处理。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | #70 验收 1：沙箱 Project 可读，provider node id 不作本地主键 | 集成用例在替身与 SQLite 上各一轮：引导成功；身份 `externalId` 集合恰好是 9 个内容 node id，因而不含成员关系 id；`entityId` 不在任何 node id 中 |
| 2 | #70 验收 2：三类成员关系映射到正确的内容种类，PR 成员关系不产生工作项 | 套件按期望条目核对 5 / 3 / 1；套件「成员关系身份与内容身份分离，PR 成员关系不产生工作项」在替身与 GitHub 两个标签下都通过；契约「条目映射」；集成计数 8 / 1；变异 M1 |
| 3 | #70 验收 3：分页与重复观察幂等，读同一页两次不改变计数 | 套件「分页遍历不重不漏」与「同一状态读两次逐字相同」（GitHub 标签）；契约观察用例的两遍去重键相同；集成第二次引导后实体 id 集合不变（两种 Storage），替身上实体 9 / 身份 9 / 观察 18；变异 M15、M18 |
| 4 | #70 验收 4：故障报告为 degraded / stale，不伪造成功 | mapping 分类表、部分成功、项目不可见、`reconcile` 全有或全无；集成 reject 与 `FORBIDDEN` 两种故障下 `degraded: true`、投影不变、`freshness.degraded`；变异 M3、M4、M5、M12 |
| 5 | #70 验收 5：planning 契约套件在录制夹具上无网络通过 | 契约文件在 `env -u GH_TOKEN -u GITHUB_TOKEN` 下全绿；`misses` 为空；provenance 与查询漂移用例通过；provider 与测试源码的禁用 API grep 无输出 |
| 6 | 新断言对 base 有判别力 | base-src 回放的失败集合恰好是：planning-contract 的「离线 Planning 替身（issue-backed）：成员关系身份与内容身份分离…」与「Planning 替身：draft→issue 提升…」；chain-bootstrap 的守卫用例；以及三个 GitHub 测试文件各自的加载失败。「同一状态读两次…」（替身标签）为绿，属于钉住型。R1 后（2026-09-30）恢复清单另加 `packages/core/src/queries.ts` 与 `packages/controller/src`，失败集合另含 e2e「全量收敛…」（base 没有 `getPlanningSync`） |
| 7 | 每条断言都承重 | 变异表 M1–M27（含 M14b、M19b）逐条满足「已生效 → 预期用例红 → 还原 → 绿」 |
| 8 | R1：成员关系不登记为身份 | chain-bootstrap 守卫用例（base 上红）；集成身份集合用例；变异 M2、M10 |
| 9 | R7：历史 id 不作为平台查询参数 | 契约 R7 用例 |
| 10 | 不越层，也不改栈底 | `git diff --name-only origin/main...HEAD` 只含 `Global Constraints` 列出的文件；`pnpm run boundaries` 通过 |
| 11 | 规模与发布面 | size 在 CI 硬上限 1000 / 1500 之内（规划弹性上限 800 / 1300 的超出见 D20、D26、D27）；disclosure 无命中；夹具通过人工五类目检查；`e1-evidence-consistency` 通过 |
| 12 | 全量回归 | `pnpm verify` 通过 |
| 13 | 评审 P1：无法锚定的读取不再是健康完整快照；有映射时出剥离正文的占位；不泄露；恢复后 healthy 且实体不重复 | R1 集成占位用例（两种 Storage）与 e2e 身份用例在 `2ed8c4a` 上红、在 R1 head 上绿；M28–M30、M34–M36 |
| 14 | 评审 P2：真实组装路径上分页成环或永不收敛时有界终止并返回结构化 degraded | R1 集成故障用例在 `2ed8c4a` 上红、在 R1 head 上绿；M31–M33 |
| 15 | 评审 P2（文档）：上游计划入口指向 completed | `test -f docs/exec-plan/completed/2026-09-29-source-version-order.md` 退出码 0；`grep -c 'completed/2026-09-29-source-version-order' docs/exec-plan/completed/2026-09-29-github-projects-read.md` ≥ 2 |
| 16 | R2：部分无映射时可见行 fresh、读取层 degraded；被扣下条目的内容 id 与种类不出 wire；200 加 errors 的二级限流判 `rate_limited` | R2 判别用例在 `53684f9` 的产品代码上红、在 R2 head 上绿；M37–M43、N1–N4、N7a、N7c |

## Progress

- [x] (2026-09-29) 三份独立设计完成，分别是契约驱动、E1 身份与幂等、失败与传输。
- [x] (2026-09-29) 独立评审定稿。评审结论见 `Decision Log` D9。
  - 逐条复核关键事实，包括对沙箱做只读探针，结果见 `Context and Orientation` 的平台事实。
  - 在 `f6a33d2` 上回读基线。
  - 核对栈底接口。
  - 写入本计划与 `docs/README.md` 索引行，未提交。
- [x] (2026-09-29) Batch 0：计划提交 `b03cbd0` 叠在栈底 `63c7bc3` 之上，推送后开 draft PR #241（base `fix/source-version-order`，标签四个，`closingIssuesReferences` 回读为 #70）。基线在检出 `fix/source-version-order`（`63c7bc3`）的工作树根目录回读：`node --test tests/contract/planning-contract.test.js tests/e2e/chain-bootstrap.test.js` 为 `ℹ tests 16`、`ℹ fail 0`。
- [x] (2026-09-29) Batch 1（T1）：`12e80c5`，已随 PR 推送。先红的证据由 T5 的 base-src 回放统一复核（见下方 Batch 5）。
- [x] (2026-09-29) Batch 2（T2）与 Batch 3（T3）：各自在 `.worktrees/github-projects-read-provider`、`-fixture` 完成，本地提交 `3eea91a`、`2864193`，未推送。夹具由 T3 按 Batch 3 的录制程序对沙箱 Project A 做 6 次只读查询得到。
- [x] (2026-09-29) Batch 4（T4）：对抗验证结论交给 T5，包括 P2 规模超限与七条 P3，处置见 `Decision Log` D13。
- [x] (2026-09-29) Batch 5（T5）：在 `.worktrees/github-projects-read` 上先建恢复锚点，再 cherry-pick T2、T3。锚点有两个：`backup/github-projects-read-2026-09-29-t5` 指向推送时的 head `12e80c5`，`backup/github-projects-read-t5-wip` 指向重构后、拆分提交前的快照。
  - 集成后 `node scripts/rule-checks.mjs size fix/source-version-order` 为代码 1265 行。T2、T3 的文件所有权从此转给 T5。
  - 削减到 793 行，清单见 D12。独立复评（只读子 agent）没有发现 P0 / P1；按 D15 处置它报告的 P3 后，代码为 799 行。
  - `comm` 比对 cherry-pick 后与整理后两个 head 的 `git diff --name-only fix/source-version-order...<head>`：只少了 `observations.ts`（并入 `provider.ts`，D12），其余一致，且与 `Global Constraints` 的所有权表一致。
  - 变异表、base-src 回放与逐提交验证都在分离工作树 `.worktrees/github-projects-read-verify` 里完成，结果见 `Outcomes & Retrospective`。
  - 本批只做本地提交，不推送（2026-09-30 协调者指示）。原因有两个：栈底 #240 收到人类评审的 P1，要追加修复提交；`origin/main` 已前进到 `699d715`。`gh pr ready` 与合并留给人类伙伴。
- [x] (2026-09-30) 栈底 R1 修复落地：`origin/fix/source-version-order` 为 `a9a14ad`，在 `main@699d715` 之上，新增迁移 005 与迁移前预检。
  - 按协调者指示，把本层用 `git rebase --onto origin/fix/source-version-order 63c7bc3` 变基上去；变基前先建锚点 `backup/github-projects-read-pre-restack-ec01c76`。
  - `docs/README.md` 与 `tests/integration/README.md` 没有冲突。`git range-diff` 显示 5 个提交全部相同（`=`），`comm` 比对变基前后本层的文件集合也一致。
  - 在新 head 上复跑了全表，结果见 `Outcomes & Retrospective`。
  - 本层不加迁移，也不改 DDL；SQLite 集成用例建的是 `:memory:` 新库，走 005 的空库路径，两边互不冲突。
  - 用精确旧 head `12e80c5` 做 `--force-with-lease` 推送。
- [x] (2026-09-30) 收到评审 5362364398（CHANGES_REQUESTED，对象 `7c5443d`、base `main@2f9e0ee`，三条 inline）。主会话已把本分支本地变基到 `origin/main@a656489`（#238、#244、#245 已合并），未推送，head `2ed8c4a`；在该检出上 `pnpm verify` 为 `ℹ tests 898`、`ℹ fail 0`，mvp0 为 7 / 0，size 为代码 799、文档 1132（观察时刻读数，重算命令见 R1 验证表）。
- [x] (2026-09-30) R1 定稿：亲自复现两个反例；三份独立设计的评审见 D19；在仓库外的隔离副本里实装定稿方案，全量测试除一条依赖 `origin` 远端的 CLI 用例外全绿，M28–M36 全部按预期变红。计划提交在本分支，未推送。
- [x] (2026-09-30) R1 执行：先红 → 实现 → 变异 → 证据 → 提交完成，证据见 `Outcomes & Retrospective` 的「评审响应 R1 的执行证据」。
- [x] (2026-09-30) R1 验收复评（Opus）：独立复评修复本身，按三条意见的原条件复跑，整表变异加 R1 与验收者的独立变异，两处测试与文案整理并入对应提交（D21），逐提交验证；证据见 `Outcomes & Retrospective` 的「R1 验收复评」。
- [x] (2026-09-30) R1 推送与逐条回复：`--force-with-lease` 推送后远端 head 为 `b341764`（base `main`，mergeStateStatus CLEAN）；三条 thread 的回复 4142829085、4142829394、4142829627 写明根因、命令与结果后 resolve；PR 正文已改写，reviewDecision 仍为 CHANGES_REQUESTED，等人类伙伴复评。
- [x] (2026-09-30) R2 执行：决策先于实现提交（`53684f9`），H11、H12、二级限流各先红后绿、各一个提交（验收整理后为 `c538a3d`、`70e3a77`、`f211c15`），证据见 `Outcomes & Retrospective` 的「R2 执行证据」。
- [x] (2026-09-30) R2 验收（Opus）：独立复评修复本身，补 N1–N4、N7a、N7c 的判别断言与两处过期注释，并入对应修复提交（D27）；整表变异 57 条、逐提交为绿，复跑评审三条意见的原条件；证据见 `Outcomes & Retrospective` 的「R2 验收复评」。
- [ ] R2 推送与登记：在 `b341764` 之上快进推送，回读 head / base / checks / threads，改写 PR 正文，在 #178 登记 TD14。本步在最终提交之后执行，结果见 PR 描述与 #178 的评论。

- [x] (2026-10-01) R3：200.5回归在旧分类器上以`ok:true !== false`失败，整数检查前置后provider契约/mapping/引导65/65通过；计划归档与最终推送回读按本次授权执行。

## Surprises & Discoveries

- **沙箱 Project A 有 9 个条目，不是 7 个**：`gate-e1-sandbox.md` §2.2 仍写 7 个，§2.3 记录了 #119 之后变为 9 个。2026-09-29 的探针确认是 9 个。因此测试的期望写成录制时的事实，重录时由 provenance 与套件的期望条目提醒核对。
- **core 本来就能注入项目范围**：设计 1 说「CoreDeps 没有 projectRef，不实现 `reconcile` 时引导必然失败」，与 `context.ts:39-40`、`:105` 不符。集成测试走显式注入，这也是 #124 连接步骤将来的装配方式。
- **成功响应也可能带 `x-ratelimit-remaining: 0`**：消耗最后一点额度的那次请求就是如此。设计 3 的分类顺序会把它判成限流。本计划只在 403 / 429 或 `errors` 非空时看这个头。
- **`docs/exec-plan/tech-debt-tracker.md` 在 `main` 上不存在**：设计 1、3 都计划修改它。本计划把技术债写在自己的 `Outcomes & Retrospective`。
- **三份设计的时间戳规则都不是栈底的规范载体**：设计都早于栈底定稿（30 字节纳秒）。原样采用的话，`makeObservation` 会在第一条观察处抛错。
- **空条目集会清空投影**（`chain-bootstrap.test.js:88-96`）：「项目不可见」一旦被读成空页，就是伪造成功，还会抹掉本地数据。
- **#27 仍是 OPEN**，而 #70 的正文写着被它阻塞。本 PR 依赖的成员关系记录形状（`MembershipRecord`、002）已经在 `main` 上，本 PR 也不写成员关系表（Superseded by D16（2026-09-30）：R1 起引导在可见读取时写成员关系映射）。看板上的阻塞关系要由人类批准才能改（`AGENTS.md` §7），本计划不动它，见开放问题 H6。
- **栈内 PR 的关闭引用**：登记机制未确定（`docs/project-management/merge-queue.md` §4）。不按 base 预测，改为在多个时点回读。
- **集成后代码 1265 行**，超过 CI 硬上限 1000 与本计划的 800。主要来自 mapping 测试（440 行、75 条用例）和逐字段防御式解码。削减见 D12。
- **schema 的非空性**（2026-09-29 只读内省，命令 `gh api graphql -f query='{ __type(name:"DraftIssue"){ fields { name type { kind } } } }'`，对 `Issue`、`PullRequest`、`ProjectV2Item` 各跑一次）：
  - 三类内容的 `id`、`title`、`body`、`updatedAt` 都是 `NON_NULL`，Issue 与 PullRequest 的 `number`、`url` 也是；
  - `ProjectV2Item` 的 `id`、`type`、`createdAt`、`updatedAt` 是 `NON_NULL`，`content` 是可空联合。
  - 因此 T4 报告的「Draft body 为 null 时整页判形状错误」是按 schema 的正确判定，不登记技术债。成员关系的 `createdAt` 也按必填解码。
- **T4 发现的判别缺口**：
  - **游标成环守卫没有被判别**：原用例的第 4 次请求重复第 3 页，由「游标等于传入值」的停滞检查拦下，不是成环守卫拦下的。
  - **`reconcile` 包住观察构造的 try/catch 没有用例覆盖**：解码已经归一了全部版本，`makeObservation` 在正常输入上不会抛错；能到达这个 catch 的输入是注入的时钟返回 `NaN`，此时 `toISOString()` 抛 `RangeError`。
  - **`type in KIND_BY_TYPE` 接受原型链属性名**：例如 `constructor`，配合没有 `__typename` 的 content 会被解码成 `objectKind` 为 undefined 的工作项。
  - **M14 按字面实现后存活**：字面实现是「空的 `errors` 数组不算成功」，而原用例没有 `errors: []` 这种输入。
  - **M17 的「替换次数为 1」无法满足**：同一个成员关系 id 在夹具里出现 3 次（`first = 100`、`first = 50` 与某一页 `first = 4`）。
  - **T3 提交正文写的是「替身与 SQLite 上重复引导行数不变」**，实际只有替身读了行数。
- **GraphQL 二级限流可能不带任何限流头**：平台文档（GraphQL 的 rate limits and query limits 页，2026-09-30 读取）写明，二级限流以 200 或 403 返回，正文的错误消息会指明是 secondary rate limit；`retry-after` 与 `x-ratelimit-remaining` 只是「可能」出现，两者都没有时至少等一分钟。原分类表会把这种 403 判成 `permission_denied`（不可重试），而能力探针一旦在组装时遇到它，结论会按 TD7 冻结。分类表第 2 行已补上正文判定。
- **成环守卫只保护扫描路径**：core 的 `readAllItems` 逐页调用 `listPlanningItems`，provider 在单页上只能识别「游标等于传入值」。长度 ≥ 2 的环会让 core 的循环不停，见 TD12（Superseded by D17（2026-09-30））。
- **成员关系端口一直没有生产写者**（R1）：#27 的 `putMembership` / `getMembership` 在两种 Storage 上都有契约，core 从未调用（`grep -rn putMembership packages/core` 在 `2ed8c4a` 上无输出）。评审要的「成员映射」只差写入，不需要新表、迁移或端口。
- **P2 是 `main` 既有缺陷**：`git show origin/main:packages/core/src/bootstrap.ts` 的 `readAllItems` 与 `2ed8c4a` 逐字相同；reconcile 的扫描识别成环后吞掉错误、一条不产出，紧随其后的 `readAllItems` 在同一个环上无界翻页。本层的真实 provider 让它首次可达。
- **只给 core 加页数上界不够**：永不重复的游标流会先挂在组装时 reconcile 的扫描里。页数上界若用 `sent.size` 计，去掉成环判定后环内 size 恒定、上界永不触发，变异会挂住而不是变红，所以 core 用独立的页计数器。
- **`toWireSnapshot` 只从实体推导整表新鲜度**：0 个实体时恒为 `fresh`，与 core 游标给出相反结论（`main` 既有）。
- **占位的计数没有被钉住**（验收者独立变异 A6）：占位路径把 `anchor.kind` 写死成工作项时全部用例仍绿，因为实体行的种类在占位路径上不变，受影响的只有 `BootstrapResult` 的计数。集成占位用例已加 `changeRequests` 断言。
- **夹具里 draft 的正文互为前缀**：`Gate E1 fixture draft.` 是另外两个 draft 正文的前缀。按子串判泄露时，扣下集合若只含它，会被仍可见的 draft 命中成假阳性；集成用例扣下的是全部 draft 或全部条目，不受影响。
- **wire 把被扣下条目的内容 id 带给界面**（R2 核查）：`WireContentRef` 对 redacted 也带内容种类与 id，ui-model 原样透出。R1 的 H12 推荐把它当作可接受的身份元数据；按 D24 剥掉后，界面只知道「受限」。
- **R2 新守卫的判别缺口**（验收前的对抗验证）：单词边界、403 的非对象正文、`errors` 非首条命中、redacted 只剥 id 不剥种类、能力门不可用与没有 storage 时的 `stale`，8 条单点变异存活。验收补断言后全部变红（N1–N4、N7a、N7c）。「没有默认 Planning 绑定」分支不可达：能力门放行即意味着存在带读取能力的 Planning 绑定，不补用例。
- **平台条目上限**：GitHub 文档 Adding items to your project 页（2026-09-30 读取）写明一个 project 至多 5 万条，含归档页；查询只读未归档条目，core 的 1000 × 50 与扫描的 500 × 100 都恰好容纳上限。

- 2026-10-01复评：原P1/P2已收口；新P3为非整数2xx状态落入成功区间。已在分类前拒绝，并补number小数的回归，未扩展到重试策略或数据模型。

## Decision Log

- **D0 · 流程**：多个独立子 agent 分别设计 → 独立评审定稿写 ExecPlan → draft PR 关联 issue → Sonnet 在各自的 worktree 里并行 TDD 与对抗验证 → Opus 验收重构 → 请人类评审 PR。
  Rationale：设计阶段的独立性用来暴露单一视角的盲区；开发阶段按写入区域互不重叠的任务并行；验收与合并的决定留给人。
  Date/Author：2026-09-29 / 人类伙伴指定。来源是本轮编排任务转述的人类伙伴指令，待人类在 PR 上确认。
- **D1 · 与本 PR 相关的人类决定**：
  - #70 作为 2 层栈的上层，叠在 #203 之上；
  - 代码 ≤ 800 行、文档 ≤ 1300 行，超出时先删死代码或简化，不拆 issue 凑数；
  - MMP 前不做兼容层与迁移；
  - 录制夹具只能来自私有沙箱 `e1-sandbox` 的只读查询或 Gate E1 已有记录；
  - 设计阶段不做任何网络写入。

  Date/Author：2026-09-29 / 人类伙伴决定。来源同 D0。
- **D2 · 端口语义取 D1**：ref 是内容身份，另加必填的 `membership`；没有内容身份时 ref 退回 `project_item`。
  Rationale：
  - 与 core、替身、套件 `:41`、e2e 的现有用法一致，改动是增量的；
  - 成员关系第一次可以在套件里被断言；
  - #71 需要 `PVTI_*` 时从 `item.membership` 取。

  备选的「ref 表示成员关系」见 `Design / Spec` 的被放弃方案。
  Date/Author：2026-09-29 / 独立评审定稿者；待人类确认（开放问题 H1）。
- **D3 · core 守卫放在本 PR 里**：约 20 行，含 `unanchored` 计数。
  Rationale：本 provider 是第一个会交出非内容 ref 的 provider；没有守卫，R1 在合并当天就会被破坏。
  Date/Author：2026-09-29 / 独立评审定稿者；待人类确认（H2）。
- **D4 · 实现 `reconcile`，按「全有或全无」**：失败时一条不产出，不抛错。
  Rationale：
  - Scope 与验收 3 都要求有观察；
  - 端口没有失败通道，抛错又会被 `composeCore` 吞掉；
  - 在引导路径上，紧随其后的 `getProject` / `listPlanningItems` 会对同一故障给出结构化失败，所以「零条观察」不会被读成成功。

  给端口加失败通道归 #134。
  Date/Author：2026-09-29 / 独立评审定稿者；待人类确认（H5）。
- **D5 · `getPlanningItem` 用扫描实现，不加反查查询**。Rationale：见被放弃的方案；R7 在结构上成立。
  Date/Author：2026-09-29 / 独立评审定稿者。
- **D6 · 失败分类**：
  - 任何 `errors` 都判整次失败，不做部分成功；
  - 项目不可见报 `not_found`；
  - 形状错误报 `unavailable` 加 `rawClass`；
  - 不给 `retryAfterMs` 编默认值。

  Rationale：见分类表与被放弃的方案。代价是一个无权访问的条目会让整个绑定 degraded，见 H4 与 TD2。
  Date/Author：2026-09-29 / 独立评审定稿者；待人类确认（H4）。
- **D7 · 版本**：观察与条目的版本都经 `sourceVersionFromTimestamp` 归一；条目版本取成员关系的 `updatedAt`；两套时间戳不混用。
  Date/Author：2026-09-29 / 独立评审定稿者。
- **D8 · 夹具与录制**：
  - 夹具是一行一条 exchange 的 JSON，只含已登记的沙箱 id；
  - 录制程序写在本计划里，不提交脚本；
  - 三道守卫是 provenance、查询漂移与 misses 账本。

  Date/Author：2026-09-29 / 独立评审定稿者；录制授权见 H7。
- **D9 · 对三份设计的评审结论（P0–P3）**：
  - **P0**：设计 1 的观察直接用平台秒级原值作 `sourceVersion`。栈底定稿后，`makeObservation` 会对每条观察抛 `RangeError`。异常经 `reconcile` 穿透 `collectObservations`（`bootstrap.ts:96-103`），被 `composeCore` 吞掉（`context.ts:113-117`），不写 degraded：原样采用的话，正常路径就会静默失败。
  - **P1**：
    - 设计 2 的 `planningItemObservations` 用 `toISOString()` 毫秒形态，同样会在 `makeObservation` 处被拒。
    - 设计 1 的套件断言「每个条目的 `sourceVersion` 可比较」与栈底契约 O5 冲突，并且会让替身（`state.ts:64-67` 的 `vN`）失败。
    - 设计 3 不实现 `reconcile`，只把「观察」交付为条目，#70 Scope 第 2 条与验收 3 的「重复观察」因此落空。
  - **P2**：
    - 设计 1 关于「CoreDeps 没有 projectRef」的事实错误（`context.ts:39-40`）。
    - 设计 3 的限流判定把成功的最后一次请求判成失败。
    - 设计 3 的 `max(两个 updatedAt)` 违反 E1-1「两套时间戳不能互相代替」，并且 `new Date(x)` 会按本地时区解析无偏移输入。
    - 设计 2 的端口改法（ref 表示成员关系）波及套件、e2e 与 core 去重，设计 2 自估已接近上限，并自带「超出就拆第 3 层」的触发器。
    - 设计 2 把观察映射放进 capabilities，而 #134 之前它没有生产调用者。
  - **P3**：
    - 设计 1 与 3 计划改一个不存在的 `tech-debt-tracker.md`。
    - 设计 1 对 `limit > 100` 一处写 `invalid_input`、一处写钳位，前后矛盾。
    - 设计 1 把形状错误映射成 `invalid_input`，把问题归咎给调用方。
    - 设计 2 的游标封装是多余代码。
    - 设计 2 把「由 E1-2 记录构造的转换前页」混进录制夹具，会模糊出处。
    - 设计 2、3 用 `globalThis.fetch` 桩证明不触网，只覆盖 fetch；本计划改用源码 grep 加无凭据运行。

  Date/Author：2026-09-29 / 独立评审定稿者。
- **D10 · 提交与关闭**：
  - 最终 5 个提交：计划、T1、T2、T3、证据，每个都单独为绿；
  - 提交正文只写 `Refs #70`，关闭关键字只写在 PR 描述里；
  - 关闭引用在 draft 时、ready 前、栈底合并后各回读一次；
  - 本层合并后回读 #70 的 state。

  Date/Author：2026-09-29 / 独立评审定稿者。
- **D11 · 不写 ADR**：端口字段与 core 守卫都是 MMP 前可逆的契约细节。成员关系与内容分离这一长期决定已经由 ADR-0002 承载。
  Date/Author：2026-09-29 / 独立评审定稿者；待人类确认（H8）。
- **D12 · 规模削减（1265 → 793 行；按 D15 补强后为 799 行）**：没有删验收证据，也没有拆 issue。每删一条用例，都确认它覆盖的不变量或变异仍有别的用例判别（见变异表）。逐项如下：
  - **mapping 测试 440 → 151 行（75 → 35 条；D15 补强后为 156 行、39 条）**：
    - 分类表与泄露用例合并成一张表，每行对 `getProject` 与 `listPlanningItems` 各跑一次，应答处处带哨兵串，这是本计划收缩顺序的第 (2) 步。「项目不可见」「部分成功」「data 缺失」也并入这张表。
    - 下列用例删除，原因是它们与别处重复：
      - 「三类内容映射」由契约文件「条目映射」在真实夹具上逐字段覆盖；
      - 「请求变量」「分页 nextCursor」由回放键与套件分页用例覆盖；
      - `reconcile` 的「重复读取去重键」「reject / 坏时间戳零条」分别与契约观察用例、全有或全无用例同路径。
    - 同一守卫的重复行删除：`limit` 为 -1 与 NaN、Issue 的 number 为 1.5、endCursor 为空串或缺失、describeCapabilities 的 503。
    - 下列用例删除，原因是它们钉住的是被删掉的防御代码或优化：「transport 返回 undefined / 缺 headers」「命中即停」「不实现写方法」。
  - **契约测试 144 → 114 行**：「录制事实」的 5 / 3 / 1 计数改由套件按期望条目逐条核对种类，契约文件另断言 issue-alpha 的条目逐字段映射与两类观察的 payload。两条观察用例合并为一条。
  - **集成测试 96 → 76 行**：「重复引导」并入引导用例。两种 Storage 都以实体 id 集合不变判定幂等，行数只在替身上读取。回放账本改为登记引用。SQLite 那一轮保留。
  - **provider 源码 409 → 285 行（D15 后为 286 行）**：
    - `observations.ts` 并入 `provider.ts`，provider 从类改为工厂闭包，不再导出类；
    - `decode.ts` 改为「任何抛错都是形状错误」，只对叶子值做类型守卫，删掉 `DecodeError` 与逐层的对象守卫；
    - `isRecord` 在 classify 与 decode 之间共用；错误统一由 `failure()` 构造；
    - 删掉的防御代码与优化：响应头键小写化（transport 契约已规定键为小写）、`getPlanningItem` 的命中即停（扫描本来就是 O(页数)，见 TD5）。非整数状态码分支曾一并删除，复评证明删除后会把这类状态码读成成功，D15 以不增行的写法恢复为形状错误。
  - **不改的部分**：T1 的端口、core 守卫与套件（已推送并验收）、查询文本（它是夹具契约，改动要重录）、夹具本身。

  Date/Author：2026-09-29 / T5 验收者，依据 D1 的规模指令。
- **D13 · T4 的 P3 处置**：
  - **原型链键**：解码改用 `Object.hasOwn`，mapping 加 `constructor` 行（M20）。
  - **成环守卫**：扫描改为记录已发送的游标集合；成环用例的 transport 按游标应答，第 5 次调用起 reject。去掉守卫后得到 `transport_error`，不再依赖停滞检查（M21）。
  - **`reconcile` 的 try/catch**：保留，加 `NaN` 时钟用例（M22）。保留的理由是端口没有失败通道，而 `composeCore` 会静默吞掉 `reconcile` 的抛错。`describeCapabilities` 在 `composeCore` 里抛错会让组装失败，这是响亮的失败，所以不加 try。
  - **Draft body 为 null**：按 schema 是正确判定，不放宽，见 Surprises。
  - **M14**：订正为「errors 为空时也看剩余额度」，另加 M14b「空的 errors 数组不算成功」。成功用例同时带 `errors: []` 与 `remaining: 0`，两种变异都能判别。
  - **M17**：生效判据改为「只替换第一处出现」，见变异表的前言。
  - **SQLite 表述**：整理提交时订正 T3 的提交正文，行数只在替身上读，SQLite 以实体 id 集合判定。

  Date/Author：2026-09-29 / T5 验收者。
- **D14 · 提交序列**：本层不改写已推送的 `b03cbd0`（计划）与 `12e80c5`（T1），在其上新建 T2、T3 与证据三个提交。每个提交单独跑 `pnpm verify` 都为绿。栈底追加 R1 修复后，本层按协调者指示变基到新栈底。变基只改了父提交，补丁不变（range-diff 全为 `=`），随后用精确旧 head 做 `--force-with-lease` 推送，并在新 head 上重跑了验证表。
  Date/Author：2026-09-29 / T5 验收者；2026-09-30 按协调者指示变基。
- **D15 · 独立复评的处置**：复评由只读子 agent 在 `7c1acab` 之前的树（`5b33829`）上完成，没有 P0 / P1。本 PR 修掉下列 P3，每一项都有新变异判别：
  - 泄露断言改用 `util.inspect(..., { showHidden: true })`：`JSON.stringify` 看不见挂在错误上的 Error 对象（M19b）。
  - 分类表加四行：`hasNextPage` 缺失（M23）、`errors` 不是数组（M24，与「remaining 为 0」合为一行）、状态码不是整数（M26）、403 二级限流（M27）。
  - 项目节点 id 必须等于绑定的项目（M25），否则会让 core 粘在 `invalid_input` 上。
  - `now` 选项的注释写明必须返回有限的毫秒数（TD13）。
  - 下列不在本 PR 修，只登记：
    - 扫描没有页数上限，一页超大或是稀疏数组时会 reject：都属于 transport 违约，见 TD12；
    - 全部条目变成 REDACTED 时本地投影清空而游标仍是 healthy：见 TD1，归 H2；
    - 探针失败后恢复动作丢成 `not_supported`：见 TD7；
    - core 遇到游标环时 `composeCore` 永不返回：见 TD12。
  Date/Author：2026-09-30 / T5 验收者。
- **D16 · P1 收口（R1-a、R1-b）**：「这次读取是否完整」由同步游标 `planning.project` 拥有（state 加 lastErrorCode），「成员关系 → 内容身份」的锚点由既有的 `project_item_membership` 拥有，两者都只由 `bootstrapWorkspace` 的提交事务写入。`BootstrapResult` 只是回执。能力快照不承担这个事实：标成 unavailable 会经 `gateCommand` 挡住引导，从而无法恢复。
  Rationale：评审原文要求两层，「至少」标不完整，「若有成员映射可用」出占位，而映射端口已经在 `main` 上、只差写入；占位让已映射的条目保持 healthy 的 redacted 状态，避免私有条目让绑定永久 degraded（已否决的「整页失败」路线的变体）；锚定只读，不从缓存映射造实体；`ok: false` 仍表示什么都没提交。
  Date/Author：2026-09-30 / R1 定稿者；待人类伙伴在新 head 上确认（H10–H12）。
- **D17 · P2 收口（R1-c）**：终止责任放在消费分页的一方。core 的 `readAllItems` 用成环判定加独立的页计数器，对所有 Planning provider 都成立。provider 的扫描只负责自己的循环，另加页数上界。失败复用 `fail()` 与 `unavailable`，不新增错误码。
  Rationale：评审点名要 core 层；只加 core 上界时，永不重复的游标仍会挂在扫描里（Surprises）。
  Date/Author：2026-09-30 / R1 定稿者。
- **D18 · 文档入口**：头部、「栈的位置」与 `Interfaces and Dependencies` 改为 base `main`，上游计划指向 completed。以旧 base 为前提的历史证据保留原文，并标注为观察时刻快照；被推翻的约束就地标 Superseded。
  Date/Author：2026-09-30 / R1 定稿者。
- **D19 · 三份 R1 设计的评审（P0–P3）与定稿来源**：三份设计分别是设计 1「最小收口」、设计 2「占位」、设计 3「系统视角」。定稿者先在 `2ed8c4a` 上亲自复现两个反例，再在仓库外的隔离副本里实装定稿方案，跑通全量测试与 M28–M36。
  - **P0**：无。
  - **P1**：设计 1 不出占位。它的理由是「core 从不写成员关系，所以映射不可用」，但那是本层自己的遗漏，端口与表已经在 `main` 上。照它实现，评审的原反例仍然从 9 条掉到 0 条，只剩工作区级的 degraded。
  - **P2**：
    - 设计 1 为计数新增端口字段与迁移 006（约 +40 行，改动上游的 storage 与 SQLite），而 degraded 加原因已经是持久化的查询信号。它的规模会到约 950 / 1000。
    - 设计 2 让已提交的部分快照返回 `ok: false`，破坏「`ok: false` ⇒ 什么都没提交」，并会被 controller 记为 Failed。
    - 设计 2 不给扫描加页数上界却宣称 TD12 收口；它自己的「永不重复游标」用例会先挂在 reconcile 的扫描里。
    - 设计 2 把 controller 的整表新鲜度列为可选。这样 0 个实体时 wire 仍是 fresh，而 wire 正是评审所说「健康空项目」的消费面。
  - **P3**：
    - 设计 1 的页数上界用 `sent.size` 计数，与成环判定耦合：去掉成环判定的变异会挂住，而不是变红。
    - 设计 2 的同实体去重集合与项目 id 比对是多余的：同一内容在一个项目里只有一个条目，成员关系 id 是全局唯一的 node id。
    - 设计 3 的占位路径经 `ensureEntity` 锚定：映射命中而身份缺失时（例如换了绑定），会按缓存映射新建实体与身份。定稿改用设计 2 的只读查找。
    - 设计 3 要删除 TD1、TD12、H2，但它们各有残余（无映射的条目、超大页）。定稿改为就地标 Superseded，并改写残余。
    - 设计 3 的请求总数 1502 把 `PlanningProject` 也算进去，与 TD6 耦合。定稿只数 PlanningItems，期望 1500。
  - **定稿**：以设计 3 为主体，取它的状态拥有者、`ok` 语义、controller 改动、独立页计数器、扫描上界与变异清单。嫁接设计 2 的只读锚定，以及「不改端口、不加迁移」。嫁接设计 1 对 P2 的定性（`main` 既有、本层首次可达），以及「合法空项目保持 healthy」的钉住断言。
  Date/Author：2026-09-30 / R1 定稿者。
- **D20 · 规模**：按 `rule-checks` 的口径对 `origin/main` 重算定稿原型，代码为 913 行；R1 之前是 799 行，其中产品代码约 +60 行、测试约 +54 行。文档在 R1 计划提交后为 1262 行（本计划 1251 行），执行期回填证据的预算约 35 行，保持 ≤ 1300。代码超过 800 的规划弹性上限约 115 行，低于 1000 的 CI 硬上限。
  已做的削减：原「故障不伪造成功」并入分页用例；锚定时不比对项目 id；`toWireSnapshot` 不保留按实体推导的旧分支。不再削减的理由：剩下的每一行都对应评审的一条要求或一个已复现的缺陷，M28–M36 各有判别；再删只能删验收用例，或把 P2 拆出同一闭环，而拆 PR 会让 #70 的验收悬在两个 PR 之间。交人类伙伴知情，见 H13。
  Date/Author：2026-09-30 / R1 定稿者，依据 D1 的规模指令。
- **D21 · R1 验收**：独立复评没有发现 P0 / P1 / P2。三处不改产品行为的整理并入对应修复提交：集成测试的 `assemble` 改为由本回放派生初始 transport，占位用例用到的回放因此也进未命中账本；占位用例加 `changeRequests` 断言（A6）；`unanchored` 的错误文案改为「按成员关系也找不回本地实体」，覆盖有映射但身份已不在（例如换绑定）的情形。页数上界已按平台上限核实（Surprises）。H10–H13 仍待人类伙伴在新 head 上裁决。
  Date/Author：2026-09-30 / R1 验收者。
- **D22 · H10 保持：占位不降级同步**：已有成员映射的 REDACTED 条目出占位行，游标保持 healthy。
  Rationale：GitHub 文档把 REDACTED 定义为项目可能含用户无权查看的条目、此时条目类型返回 REDACTED（「Using the API to manage Projects」），界面对该行显示锁图标占位「You can't see this item」；Airbyte GitHub 连接器对确定的、按范围的 403 / 404 跳过而同步仍算成功。条目受限是条目状态，不是读取失败。
  来源（2026-09-30 读取）：https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects ；https://docs.airbyte.com/integrations/sources/github 。
  Date/Author：2026-09-30 / 主会话据人类伙伴「其余你先调研，按照最佳实践和第一性原理进行抉择」的授权决定；来源为上述文档，尚待人类在 PR 上确认。
- **D23 · H11 改：缺口降读取层，不降已确认的行**：存在无映射的不可见条目时，`snapshot.source` 与 `getPlanningSync().degraded` 仍为 degraded（`permission_denied`）；本次读取刚确认的可见行保持 fresh，`stale` 只表示旧于最近一次成功读取。读取彻底失败时保留的旧投影仍是 degraded / stale。取代 D16 里「所有行按同一摘要标 stale」的做法与 H11 的原推荐。
  实现取舍：不加 `SyncState`（`sync_cursor.state` 有 CHECK 约束，加值要改 DDL，MMP 前虽可重写迁移，但本 PR 不触迁移）；「提交成功但有缺口」写 `healthy` 加 `lastErrorCode`，「什么都没提交」写 `degraded` / `failed`。`SyncSummary` 因此有两个正交的量：`degraded`（读取层是否完整）与 `stale`（行是否旧于最近一次成功读取）。
  Rationale：Kubernetes client-go 的 reflector 把完整性放在读取层（整页拼齐后一次 Replace），Terraform provider 的 Read 读不了不等于资源被删除；这些都不改条目本身。把已确认的行一并标 stale，会让界面对同一次成功读取给出「旧」的错误结论。
  来源（2026-09-30 读取）：https://github.com/kubernetes/client-go/blob/master/tools/cache/reflector.go（`list` 经 pager 拼齐全部页后 `syncWith` 一次 `Replace`）；https://developer.hashicorp.com/terraform/plugin/framework/resources/read（资源不存在才 `RemoveResource`，其余错误进 Diagnostics 并保留原状态）。
  Date/Author：2026-09-30 / 主会话，依据同 D22。
- **D24 · H12 保留在内部**：占位行的内容外部 id 与种类只作去重与恢复的键，不出现在 wire 与 ui-model。核查发现原实现会带出（见 R2 小节），因此 redacted 的 wire 内容引用不带 `externalKind` / `externalId`，保留 `bindingId`。
  Rationale：外部 id 是「你无权看到的对象」的标识；把它交给界面等于向无权者确认该对象存在，并可拼出 URL。可见条目的身份仍要给界面用来回指来源，所以只对 redacted 剥。
  Date/Author：2026-09-30 / 主会话，依据同 D22。
- **D25 · 二级限流：正文判定与 200 加 errors**：分类表第 2 行接受；正则改为 `/\bsecondary rate\b/i`，并覆盖 HTTP 200 加 `errors[].message` 的形态（GraphQL 文档写明二级限流可能以 200 加错误返回）。`retryAfterMs` 取 `retry-after` 头，其次 `reset`，否则 undefined，等待下限（无头时至少 60 秒）与重试由调度层 #134 处理，provider 自己不重试。其余 403 仍判 `permission_denied`（Airbyte 2.1.19 修过把权限 403 误判为可重试）。
  来源（2026-09-30 读取）：https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api（二级限流以 200 或 403 返回，`retry-after` 与 `x-ratelimit-remaining` 只是可能出现，两者都没有时至少等一分钟）；https://github.com/octokit/plugin-throttling.js/blob/main/src/index.ts（`/\bsecondary rate\b/i`，无头时 `fallbackSecondaryRateRetryAfter: 60`）；Airbyte 同 D22 页的 changelog 2.1.19。
  与指示的差异：指示写「60 秒下限的现有语义」，但仓库里没有 60 秒下限，现有语义是 undefined；provider 不该替调度层决定等待时长，故保持现有语义并在此登记。
  Date/Author：2026-09-30 / 主会话与 R2 开发者。
- **D26 · TD14 归 #178，H6 不改**：client / ui-model 消费 `snapshot.source` 归 issue #178，验收者在该 issue 留言登记；H6（#70 与 #27 的阻塞关系）按 AGENTS.md §7 需人类点名批准，不改关系。规模：人类伙伴 2026-09-30 已接受超过 800 的规划弹性上限（H13），CI 硬上限 1000 必须守住。
  H1–H9 按原推荐执行：H1 端口语义取 D1；H2 由 D16 取代；H3 REDACTED 原因写 `unavailable`；H4 任何 GraphQL `errors` 整次失败（TD2）；H5 `reconcile` 失败通道归 #134；H7 只读录制不逐次授权；H8 不写 ADR；H9 生产装配归 #124。
  Date/Author：2026-09-30 / 人类伙伴（规模）与主会话。
- **D27 · R2 验收**：独立复评没有发现 P0 / P1 / P2。对抗验证留下的 P3 按下列方式处置，不改产品行为：
  - 8 条存活变异补断言（N1–N4、N7a、N7c），并入对应修复提交；`bootstrap.ts` 的 `unanchored` 注释与 ui-model `identities` 注释随 D23 / D24 订正。
  - 本计划里被 D23 取代的 R1-a、R1-b 与 e2e 判别行就地标 Superseded；V&A #10 改用 `origin/main`；变异编号订正为 M37–M43。
  - 规模：代码 993 / 1000（余 7 行）。文档超过 1300 的规划弹性上限，在 1500 硬上限内；人类伙伴的「规模，接受」是针对 H13（代码）作出的，文档的超出交人类伙伴知情，不再为压行删证据。
  - 在 #178 合入前，部分无映射时行 fresh、缺口只在 `snapshot.source` 与同步摘要上，界面尚不消费（TD14），PR 描述写明这一临时状态。
  Date/Author：2026-09-30 / R2 验收者。
- **开放问题**（待人类伙伴裁决；裁决前按推荐执行，裁决结果写回本节；2026-09-30 的裁决见 D22–D26）：
  - **H1 端口语义**：推荐 D1，即 ref 为内容身份、另加 `membership`。备选的「ref 表示成员关系」要在栈中间再加一层。
  - **H2 没有内容身份的条目**：推荐由 core 跳过并计入 `unanchored`，不显示占位，按成员关系锚定的占位另开 issue（#134 / #27）。备选是整页失败，或在本 PR 扩展本地模型（超出预算）。Superseded by D16（2026-09-30）：评审 inline 4141515880 要求有映射时出占位，R1 按成员关系锚定占位、无映射时整次 degraded。
  - **H3 REDACTED 的原因**：推荐 `unavailable`，这是最少断言的写法，因为平台形状未观测。是否愿意提供一个「能读 Project、不能读 `e1-sandbox` 仓库」的受限凭据，做一次只读录制，把真实形状补成证据？
  - **H4 整体失败的代价**：任何 GraphQL `errors` 都让整次失败，意味着「一个无权访问的条目让整个项目 degraded」。在录到条目级错误形状之前，是否接受这个可用性代价？
  - **H5 `reconcile` 的失败通道**：失败时一条不产出，端口的失败通道归 #134。是否接受？
  - **H6 #27 的阻塞关系**：#27 仍 OPEN，但成员关系形状已经在 `main` 上。本 PR 不写成员关系表（Superseded by D16：R1 起写映射，但不承担 #27 的其余范围），照常推进；#70 与 #27 的阻塞关系是否调整，由人类在看板上决定。
  - **H7 只读录制**：Batch 3 与 Batch 4 用开发账号的 `gh` 认证，对 `e1-sandbox` 的 Project A 做只读录制，约 6 次 GraphQL 查询，零写入。编排约束已限定录制来源；如需逐次授权，请在 PR 上说明。
  - **H8 是否需要 ADR**：推荐不需要。
  - **H9 生产装配归属**：生产用的 fetch transport 与凭据句柄的装配，归 #124 的「连接规划平台项目」子任务；本 PR 只交付 transport 接口。
  - **主会话处置（2026-09-29）**：H3 不另要受限凭据，按推荐写 `unavailable`，真实形状留作后续证据；H7 属只读的常规操作，不逐次授权，夹具提交前做发布面五类目人工检查，只含沙箱测试对象（Gate E1 记录已公开同一沙箱的对象 id，有先例）；其余各项按推荐执行，在 PR 评审时交人类伙伴裁决。
  - **R1 新增（2026-09-30，待人类伙伴在新 head 上裁决；裁决前按推荐执行）**：
    - **H10 占位时的健康语义**：推荐「有映射时只在条目上表达 redacted，游标保持 healthy；只有找不到映射时整次 degraded」。评审原文的「至少标不完整」与「有映射时出占位」两种读法都说得通。备选是「出现任何 redacted 就降级」：改一行即可，代价是私有条目会让绑定永久 degraded，所有可见行都被标成 stale。（已裁决 2026-09-30，见 D22：保持推荐）
    - **H11 部分不可见时的行级新鲜度**：推荐沿用单一的同步摘要，存在无映射条目时所有行都带 `permission_denied`。备选是把工作区级与行级拆成两层，需要新增同步状态，属于 #134 或 capabilities 的变更。（已裁决 2026-09-30，见 D23：改为读取层 degraded、可见行 fresh，不采用原推荐）
    - **H12 占位上的身份元数据**：占位仍经 wire 带出已不可见内容的外部 id 与种类（issue / PR / draft），不带标题、正文、编号与 url。推荐接受，因为这是本地既有的身份行，不是内容。不接受时，要让 redacted 行的 `ContentReference.identity` 可空，改动 core、controller 与 ui-model 的类型。（已裁决 2026-09-30，见 D24：保留在内部，wire 剥掉）
    - **H13 规模**：R1 后代码约 915 / 1000，超过 800 的规划弹性上限，理由见 D20。推荐接受，不拆 PR。（已裁决 2026-09-30：人类伙伴接受，见 D26）

- **D28 · P3与授权范围**（2026-10-01）：用户明确要求按修订流程整理并rebase merge当前PR；延续已复评R2的H10/H11/H12及TD14交接，知悉弹性规模。`Number.isInteger(status)`在所有HTTP区间判定前执行，200.5归为unavailable/malformed_response；同一分类用例检查getProject与listPlanningItems。Rationale：异常transport值不得伪装成功；保持既有正常分类与固定错误文案。Actor：执行者，依据本次人类授权。
- **D29 · 提交粒度**（2026-10-01）：保留三个交付物提交：①只读provider及Host同步闭环（端口、映射、完整性、分页、分类与对应测试）；②wire/ui-model受限外部身份隐藏及对应断言；③计划、验收证据与索引归档。第二组的privacy断言随第二组代码回滚，不按文件类型散拆，也不将全部能力强制squash。Rationale：源码与其判别测试成组，各提交构建和测试可独立审阅；文档归档可独立恢复，后续#178/#134范围保留。整理前保存全量修订树并比较最终树，精确lease后取得新head批准。Actor：执行者，依据用户对提交粒度的明确更正与本次整合授权。

## Idempotence and Recovery

- **测试可重复**：全部测试都可重复执行。回放 transport 无状态，每个文件自己建回放实例；SQLite 用 `:memory:`；不触网、不需要凭据。
- **录制可重复**：录制程序只读。重跑会覆盖夹具，所以先 `git diff` 再决定是否提交；重录后 provenance 用例会提醒登记新 id。
- **变异与 base-src 回放可重复**：每次都用 `git checkout HEAD -- <file>` 还原，并用 `git diff --quiet` 确认。它们只在 T4 的分离工作树里做，不影响其他工作区。
- **会话中断**：各任务在自己的工作树里随时做本地 WIP 提交，不把工作放在 scratchpad。恢复时先读本计划的 `Progress`，再用 `git log --oneline origin/main..<分支>` 回读进度（栈底合并前用的是 `fix/source-version-order`，该分支已删除）。
- **已知良好状态**：
  - `origin/main`（栈底 #240 已并入；合并前用 `git rev-parse fix/source-version-order` 回读栈底 head，该分支已删除）；
  - 本分支的计划提交；
  - 整理提交前建的恢复锚点：`backup/github-projects-read-2026-09-29-t5`（推送时的 head `12e80c5`）与 `backup/github-projects-read-t5-wip`（重构后、拆分提交前的快照）。
  - R1：`backup/github-projects-read-7c5443d`（评审对象、远端旧 head）与 `backup/github-projects-read-pre-r1-2ed8c4a`（变基到 `origin/main@a656489` 后、R1 计划提交前）；验收整理前另有 `backup/github-projects-read-pre-acc-982df76`。
- **栈底变化**（Superseded by R1（2026-09-30）：栈底已合并，base 为 `main`；`main` 前进时先建 backup ref 再 `git rebase origin/main`，冲突只可能出现在 `docs/README.md` 的 Active 表）：
  - 栈底增加提交或经评审修改后，先建 backup ref，再 `git rebase fix/source-version-order`。
  - 冲突只可能出现在 `docs/README.md` 的 Active 表，两行都保留。
  - 栈底如果改了 `sourceVersionFromTimestamp` 的名字或语义，只需要改 `decode.ts` 的一处调用，然后重跑契约与 mapping 两个文件。
  - 栈底合并后，GitHub 会把本 PR 的 base 自动改为 `main`（`docs/project-management/merge-queue.md` §4.4 的实测）。合并前核对树与 range-diff。
- **合并后回滚**：由人类伙伴发起 PR，`git revert` 本层的全部提交（R1 后为 5 个原提交加 R1 的计划、两个修复与证据提交；只撤 R1 的两个修复提交会回到评审前的两个已知缺陷）。provider 包回到占位；端口的 `membership`、替身的成员关系、core 守卫与 `unanchored` 一并撤回，core 回到「未知种类按 issue 处理」这个已知旧缺陷。没有迁移，没有 DDL，没有外部写入，库与沙箱都不需要处理。core 守卫不能单独撤回，因为 GitHub provider 依赖它防止 `PVTI_*` 被登记。回滚后回读 `pnpm verify`，并回读 #70 的 state：被 PR 关闭的话需要手动重开。
- **临时分支**：工作树与临时分支（`feature/github-projects-read-port`、`-provider`、`-fixture` 与分离工作树 `-verify`）只在本地，不推送。清理交给 `git-expert-operations` 流程：路径先规范化为 realpath，并核对允许的根目录（`AGENTS.md` §7）。

## Interfaces and Dependencies

### 依赖的上游接口（#240 / issue #203，已 rebase merge 到 `main`）

计划见 `docs/exec-plan/completed/2026-09-29-source-version-order.md`。接口来自 #240，位于 `packages/capabilities/src/observation.ts`，经 `index.ts` 再导出：

```ts
export function sourceVersionFromTimestamp(timestamp: string): string          // RFC 3339 → 规范载体；不可无损归一时抛 RangeError；与时区无关
export function isComparableSourceVersion(value: string): boolean              // ⇔ 规范载体
export function assertComparableSourceVersion(value: string | undefined): void // undefined 放行，其余非规范抛 RangeError
export function compareSourceVersion(left: string | undefined, right: string | undefined): number // 码点序，不变
export function makeObservation(input: ProviderObservationInput): ProviderObservation             // 对 sourceVersion 调用断言
```

本层遵守栈底契约 O1–O5：观察版本只经归一函数产生；归一失败报结构化失败；同一主体不混用有版本与无版本；`receivedTime` 用 `toISOString()`；条目版本只做相等比较。

### 本层对上下游暴露的接口

1. **capabilities**（`planning-provider.ts`）：
   - `ProviderPlanningMembership { externalId; createdAt; updatedAt }`；
   - `ProviderPlanningItem.membership`，必填；
   - `PLANNING_MEMBERSHIP_OBJECT_KIND = 'project_item'`；
   - `ref` 的语义与例外如 D1 所述。
2. **core**：
   - `planningContentKind(objectKind): MembershipContentKind | undefined`，替代被删除的 `asExternalKind`；
   - `BootstrapResult.unanchored: number`；
   - 非内容种类的条目不登记身份、不建实体、不投影。
   - R1 起：可见条目在引导事务里写成员关系映射；没有内容身份的条目按映射找回实体出 redacted 占位，找不到才计入 `unanchored`，此时结果为 `ok: true, degraded: true, error: permission_denied` 且游标 degraded；`CoreQueries.getPlanningSync(): Promise<SyncSummary>`。
   - R1 起 controller：`toWireSnapshot(views, authority, workspaceRevision, sync)`，`snapshot().source` 只由工作区级同步摘要决定。
3. **provider 包**：
   - `createGithubProjectsPlanningProvider({ bindingId, projectNodeId, transport, now? }): PlanningProvider`；
   - 类型 `GraphqlRequest` / `GraphqlResponse` / `GraphqlTransport`；
   - `PLANNING_QUERIES`；
   - `packageId`。

   各方法的语义见 `Design / Spec` 的方法语义、分类表、解码规则与观察。
4. **观察**：
   - 类型 `planning.content.observed` 与 `planning.membership.observed`；
   - 成员关系观察的主体 `objectKind` 为 `project_item`；
   - 版本是规范载体。
5. **测试接口**：`tests/contract/fixtures/github-projects/replay.js` 的 `loadFixture` / `createReplay`，加上夹具格式。#133 往查询里加字段时，查询漂移用例会强制重录。

### 对后续 issue 的交接

- **#133**：复用 transport、查询与回放；在 `PlanningItems` 里加上字段值后重录；填充 `fields`。
- **#134**：
  - 用 `reconcile` 的观察与 `item.membership` 做成员关系的移除与回收（R1 起引导已在可见读取时写入映射，不回收）；
  - 用 `membership.externalId` 在转换前后不变这一点识别 draft 提升，并调用 `promoteEntityIdentity`；
  - 决定 `reconcile` 的失败通道、退避策略、能力快照刷新、跨页重复去重（见 TD3），以及「单次遍历不删除成员关系」。
- **#71**：
  - 写入时以 `item.membership.externalId` 定位条目；
  - `expectedSourceVersion` 与 `item.sourceVersion` 做相等比较；
  - R3 要求的独立读回需要按 node 点查（TD5）。
- **#124 连接子任务**：提供 `projectNodeId`，以及持有凭据句柄的生产 transport。

### 工具、仓库与命名

- **运行环境**：Node 的 `engines` 为 `>=22.0.0`，定稿时实测版本是 v26.10.0；pnpm 10.28.2。
- **GitHub**：仓库 `SingularityKChen/harness-projects`，`gh` 命令一律带 `-R`。录制用 `gh api graphql --input -`（2026-09-29 实测可以接受带 `operationName` 的请求体），凭据只由 `gh` 自己持有。
- **标签**：`kind:feat`、`area:providers`、`area:capabilities`、`area:core`。
- **分支**：工作分支 `feature/github-projects-read`；PR 的 base 定稿时是 `fix/source-version-order`，2026-09-30 起是 `main`。
- **关联**：PR 描述以关闭关键字关联 #70，用 `gh pr view <n> -R SingularityKChen/harness-projects --json closingIssuesReferences` 回读；另写 `Refs #203 #240 #124 #133 #134 #71 #27`。R1 起 PR 另加标签 `area:controller`。

## Outcomes & Retrospective

### R3授权整合（2026-10-01）

P3旧红新绿已验证；归档使用相同文件名，索引显式移入Completed。代码与对应测试按D29三组整理，每个提交在其检出上执行`pnpm verify`，最终要求全部通过；体量、发布面、远端refs/CI/issue/线程与新head批准在最终推送后回读，并回填PR描述和跨PR评审归档。原R1/R2数据反例在最终树上仍须成立；不据本层关闭#124/#4/#178或调整blocking关系。


### R2 验收复评（2026-09-30）

在检出 `feature/github-projects-read` 的工作树根目录与分离工作树 `.worktrees/github-projects-read-verify` 上运行，base 为 `origin/main@a656489`；代码树为 `f211c15`，其后只改文档。
- **复评修复本身**：H11 的两个量在四条路径上各自成立：部分无映射时行 fresh、摘要 `{degraded: true, stale: false}`；读取失败、能力门不可用、没有 storage 时 `stale: true`。H12：被扣下条目的内容种类与 id 不出 controller 快照，ui-model 对上游误带也不透出；`packages/client`、`packages/ui` 与 `apps` 没有读取 `content.externalId` 或 `source.primary` 的代码（`grep`）。分类只在 403 与 2xx 带 errors 时看 message。
- **评审三条的原条件**（SQLite 文件库，只 import workspace 包的脚本经 `node --input-type=module` 运行，不改仓库文件）：
  - P1：可见 9 条 → 全部 REDACTED 且映射仍在，`[ok, degraded, unanchored]` 为 `[true, false, 0]`、9 行占位、快照 `fresh`、夹具标题与正文零命中 → 3 条换掉成员关系 id（原反例），`[true, true, 3, permission_denied]`，6 行 fresh，摘要 `{degraded: true, stale: false}`，快照 `degraded` / `permission_denied`，关闭重开再引导后不变 → 离线，6 行 stale、原因 `unavailable` → 全部换掉，0 行、快照 `degraded` → 恢复，9 行、实体 id 与第一次相同、快照 `fresh`。
  - P2：A → B → A、x ↔ y、A → B → C → B、永不重复时，请求数（PlanningProject 加 PlanningItems）依次为 7、7、9、1501，结果都是 `[false, true, unavailable]`，前三种的文案含「成环或超过页数上界」，投影保持 9 行。P2（文档）：`test -f docs/exec-plan/completed/2026-09-29-source-version-order.md` 退出码 0。
- **变异整表**：M1–M43（含 M14b、M19b）、A1–A6、N1–N4、N7a、N7c 共 57 条。每条 1 个文件、1 个 hunk，替换目标恰好出现 1 次（M17 取首处）；预期用例全部在红集合里；`git checkout HEAD --` 还原后 `git diff --quiet` 通过，整表后重跑为绿。M29、M36 的原目标行已被 D23 改写，改用等价变体（去掉 `lastErrorCode`；实体为 0 也记缺口），M30 重写为「占位取旧投影内容」，M35 为「按映射找回恒为空」。
- **逐提交为绿**：在分离工作树里逐个检出 `53684f9`、`c538a3d`、`70e3a77`、`f211c15` 与证据提交，去掉 `GH_TOKEN` / `GITHUB_TOKEN` 跑 `pnpm verify`，都是 `ℹ fail 0`，测试数依次为 900、900、900、904、904，mvp0 都是 `7 / 0`。
- **全表**：`pnpm verify` 退出码 0（`ℹ tests 904`、`ℹ fail 0`，mvp0 `7 / 0`）；`pnpm run boundaries` `ℹ fail 0`；`workflow-check` 无发现；`env -u GH_TOKEN -u GITHUB_TOKEN` 下三个 GitHub 测试文件 `ℹ tests 64`、`ℹ fail 0`；`e1-evidence-consistency`、`content-placement`、`plan-facts-consistency` `ℹ tests 18`、`ℹ fail 0`；`rule-checks size origin/main` 代码 993 / 1000、文档 1402 / 1500；`disclosure` 无命中；`git diff --check origin/main...HEAD` 无输出；差异文件集合不含 `docs/review/`。
- **提交整理**：三个 fixup 并入对应修复提交；`comm` 比对整理前 `c9f6cec`（锚点 `backup/github-projects-read-pre-r2acc-c9f6cec`）与整理后 head 的 `git diff --name-only origin/main...<head>`，文件集合相同；已推送的 `b341764` 不改写。

### R1 验收复评（2026-09-30）

在检出 `feature/github-projects-read` 的工作树根目录与分离工作树 `.worktrees/github-projects-read-verify`（detached 在同一代码树）上运行，base 为 `origin/main@a656489`；代码树为 `0667767`，其后只改文档。
- **P1 原条件**（只 import workspace 包的脚本，经 `node --input-type=module` 运行，不改仓库文件）：可见 9 条之后让 9 条保持原成员关系 id、改为 REDACTED 且 content 为 null。SQLite 文件库关闭重开后与替身一致：`{ok:true, entities:9, unanchored:0, degraded:false}`，9 行都是 redacted 占位，实体 id 不变，计数仍为 8 个工作项、1 个变更请求，夹具标题与正文在列表、详情与 controller 快照里零命中。扣下 3 条得 9 行、3 行占位；换掉 1 条的成员关系 id 得 `degraded`、`unanchored 1`、`permission_denied`，快照 `degraded`；全部换掉得 0 行，摘要与快照都是 `degraded`；恢复后实体 id 与种类不变、快照 `fresh`；冷启动全部不可见时 0 行、快照 `degraded`。同一脚本在 `2ed8c4a` 的产品代码上复现评审原反例 `[true, 0, 9, false]`。
- **P2 原条件**：真实 `composeCore` 组装加一次引导，游标 A → A、A → B → A（空 nodes 与带 9 条）、x ↔ y、A → B → C → B、永不重复，两种 Storage 上 PlanningItems 请求数依次为 4、6、6、6、8、1500，都没有触发 5000 次的看门狗，结果都是 `ok:false, degraded:true, unavailable`，后五种的文案含「分页成环或超过页数上界」。同一脚本在 `2ed8c4a` 上除 A → A 外全部跑到看门狗（5001 次）。
- **P2（文档）**：`test -f docs/exec-plan/completed/2026-09-29-source-version-order.md` 退出码 0，active 下同名文件不存在；`git ls-remote --heads origin fix/source-version-order` 无输出，所以 Batch 0–5 标为历史批次，恢复路径改用 `origin/main`。
- **新断言对 R1 前有判别力**：分离工作树里把 `bootstrap.ts`、`provider.ts`、`wire.ts` 与 controller 的 `queries.ts` 恢复成 `2ed8c4a` 版本，四个文件 `ℹ tests 26`、`ℹ fail 5`，失败恰为两种 Storage 的占位与故障用例和 e2e 身份用例，都是断言差异；还原后工作区干净。
- **变异整表**：M1–M27（含 M14b、M19b）、M28–M36，加验收者的 A1–A6（占位跳过 `getMembership`、结果不报 degraded、`getPlanningSync` 恒 healthy、扫描与 core 页数上界各差一、占位计数写死工作项），共 44 条，每条 1 个文件、1 个 hunk，预期用例变红，`git checkout HEAD --` 还原后重跑为绿。A6 起初存活，补断言后变红（D21）；M3、M5 的预期项按改名后的故障用例订正。
- **全表**：`pnpm verify` 退出码 0（`ℹ tests 900`、`ℹ fail 0`，mvp0 `7 / 0`）；`pnpm run boundaries` `ℹ fail 0`；`workflow-check` 无发现；`env -u GH_TOKEN -u GITHUB_TOKEN` 下三个 GitHub 测试文件 `ℹ tests 60`、`ℹ fail 0`；`rule-checks size origin/main` 代码 915 / 1000、文档 1296 / 1500；`disclosure` 无命中；`git diff --check origin/main...HEAD` 无输出。
- **逐提交为绿**：在分离工作树里逐个检出 `5ad9b87`、`2accb9a`、`f319fb4`、`73e7653`、`2ed8c4a`、`fb744aa`、`ec61d1d`、`0667767` 与证据提交跑 `pnpm verify`，九次都是 `ℹ fail 0`，测试数依次为 837、840、879、898、898、898、900、900、900，mvp0 都是 `7 / 0`。base-src 回放（恢复自 `origin/main`，含 core `queries.ts` 与 `packages/controller/src`）为 `ℹ tests 22`、`ℹ fail 7`，失败集合与 V&A #6 的 R1 注相同，还原后工作区干净。
- **提交整理**：`comm` 比对整理前 `982df76` 与整理后 head 的 `git diff --name-only origin/main...<head>`，文件集合相同；`git diff 982df76 HEAD` 只含 D21 的三处与本次文档回填。

### 评审响应 R1 的执行证据（2026-09-30）

代码树是 `feature/github-projects-read` 的 `8c3a97e`（`a865dd0` 锚定与同步摘要，`8c3a97e` 分页有界终止）；其后只改文档。验收整理后两个修复提交是 `ec61d1d`、`0667767`，差异只有 D21 所列三处。命令在检出该分支的工作树根目录运行，base 取 `origin/main@a656489`。

- **先红**（在 `fb744aa` 的产品代码上只补 `getPlanningSync` 与新用例，失败都是行为断言）：e2e 身份用例得 `[true, false, undefined]`；集成占位用例（两种 Storage）冷启动得 `[[], {degraded:false}, 'fresh']`；集成故障用例（两种 Storage）首轮组装得 `48`，期望 `6`。第二个提交单独先红时，只有故障用例两个失败。
- **绿**：`pnpm verify` 退出码 0，`ℹ tests 900`、`ℹ fail 0`，mvp0 为 `7 / 0`（两个代码提交各自跑过）；`pnpm run boundaries` 退出码 0；`node scripts/workflow-check.mjs` 无发现；`env -u GH_TOKEN -u GITHUB_TOKEN` 下集成用例与两个 GitHub 契约文件 `ℹ tests 60`、`ℹ fail 0`。
- **变异 M28–M36**：每条都是 1 个文件、替换目标恰好出现 1 次，红的用例与预期一致，`git checkout HEAD --` 还原后 `git diff --quiet` 通过。
  - M28、M30、M34、M35：集成占位用例（两种 Storage）；M29：集成占位用例与 e2e 身份用例；M31、M32、M33：集成故障用例（两种 Storage）；M36：e2e「全量收敛」。
- **base-src 回放**（恢复清单含 `queries.ts` 与 `packages/controller/src`，恢复自 `origin/main`）：失败 7 个，恰好是 planning-contract 的两条、chain-bootstrap 的「身份」与「全量收敛」、三个 GitHub 测试文件的加载失败；还原后工作区干净。
- **规模与发布面**：`rule-checks size origin/main` 代码 915 / 1000（超过 800 的理由见 D20）、文档 1275 / 1500（≤ 1300 的规划弹性上限内）；`disclosure` 无命中；`git diff --check origin/main...HEAD` 无输出。

### R2 执行证据（2026-09-30）

代码树是 `feature/github-projects-read` 的 `39e5fff`（验收整理后为 `f211c15`，只多 D27 的断言与注释）；命令在检出该分支的工作树根目录运行，base 取 `origin/main@a656489`。

- **H12 核查结论**：会带出。`WireContentRef` 对 redacted 也带 `externalKind` 与 `externalId`，ui-model 的 `source.primary` / `identities` 原样透出；夹具上被扣下的 3 个 draft 的内容 node id 在 wire 快照里逐字出现。标题、正文、编号与 url 没有带出。已剥掉，见 D24。
- **先红**（在 `53684f9` 的产品代码上，只补 `SyncSummary.stale` 的接线，行为不变）：
  - e2e「身份：没有内容身份的条目不登记外部身份」得 `[[true,'permission_denied'] ×3]`，期望 `[[false, undefined] ×3]`（可见行被整体标 stale）；集成占位用例（两种 Storage）冷启动得 `stale: true`，期望 `false`。
  - H12：在临时副本里把冷启动一步的期望改成当前实现的 `stale: true`，让它走到后面之后（副本随即删除），集成占位用例在「部分 REDACTED 且映射仍在」一步得 `['DI_…KQZo', 'DI_…LTqU', 'DI_…LTsE']`，期望 `[]`。
  - 分类表两条 200 加 errors 的用例得 `unavailable`，期望 `rate_limited`；第三条（`secondary index`）为绿，钉住不误判。
- **变异 M37–M43**（`git diff` 为 1 个文件、1 个 hunk；替换目标恰好出现 1 次；还原后 `git diff --quiet` 通过、重跑全绿）：M37、M38 与 M43 各红 e2e 身份用例（M37、M38 另红集成占位用例两种 Storage）；M39 红集成故障用例两种 Storage 与 e2e 降级用例；M40 红集成占位用例两种 Storage；M41 红分类表两条；M42 红 ui-model 不变量用例。
- **绿**：`pnpm verify` 退出码 0，`ℹ tests 903`、`ℹ fail 0`，mvp0 `7 / 0`；`pnpm run boundaries` `ℹ fail 0`；`node scripts/workflow-check.mjs` 无发现；`env -u GH_TOKEN -u GITHUB_TOKEN` 下三个 GitHub 测试文件 `ℹ tests 63`、`ℹ fail 0`。
- **规模**：`rule-checks size origin/main` 代码 985 / 1000（人类伙伴已接受超过 800，硬上限 1000 守住）；文档读数见 PR 描述。

### 实际结果（2026-09-30，变基到栈底 `a9a14ad` 之后）

> 观察时刻快照，非当前栈：本节以 `fix/source-version-order` 为 base 的证据保留原样；当前 base 为 `main`，R1 的证据写在 `评审响应 · R1` 与 `Progress`。

下列证据的代码树都是 `feature/github-projects-read` 的 `1f86801`；其后的证据提交只改文档。命令都在检出该分支的工作树根目录运行，base 取本地的 `fix/source-version-order`，也就是 `a9a14ad`。

- **全表验证**（在检出该提交的工作树根目录运行）：
  - `pnpm verify` 退出码 0，其中 `ℹ tests 847`、`ℹ fail 0`，mvp0 为 `ℹ tests 7`、`ℹ fail 0`；`pnpm run boundaries` 为 `ℹ fail 0`；`node scripts/workflow-check.mjs` 退出码 0。
  - `node scripts/rule-checks.mjs disclosure fix/source-version-order` 机械扫描通过；`git diff --check fix/source-version-order...HEAD` 无输出。
  - `node scripts/rule-checks.mjs size fix/source-version-order`：代码 799 / 1000，文档 1126 / 1500（证据提交修订前的读数，修订后的读数见 PR 描述）。
  - 禁用 API 的两条 grep 无输出；`env -u GH_TOKEN -u GITHUB_TOKEN` 下三个 GitHub 测试文件为 `ℹ tests 58`、`ℹ fail 0`；`grep -rn asExternalKind packages tests` 无输出。
- **每个提交单独为绿**：在分离工作树里逐个检出 `e3170e8`（计划）、`fc75428`（T1）、`16faa74`（T2）、`1f86801`（T3）跑 `pnpm verify`，四次都是 `ℹ fail 0`，测试数依次为 786、789、828、847。变基前在旧栈底上也逐个跑过，依次为 764、767、806、825。
- **base-src 回放**：按 Batch 4 从新栈底恢复产品文件后，`ls` 只剩 `index.ts`。五个文件的结果是 `ℹ tests 22`、`ℹ fail 6`，失败集合与 `Validation and Acceptance` #6 逐项相同：
  - 替身标签下的「成员关系身份与内容身份分离…」；
  - 「Planning 替身：draft→issue 提升…」；
  - 守卫用例「身份：没有内容身份的条目不登记外部身份」；
  - 三个 GitHub 文件因缺导出而加载失败。

  之后 `git checkout HEAD -- packages`，工作区干净。
- **变异表**：在 `1f86801` 上，M1–M27 加 M14b、M19b 共 29 条整表重测（变基前在 `7c1acab` 上也全部通过），全部满足「已生效 → 预期用例红 → `git checkout HEAD` 还原 → 重跑为绿」。
  - 生效判据是：磁盘内容等于首处精确替换的结果，`git diff` 只有 1 个文件、1 个 hunk。
  - 每条的红用例集合都包含变异表的预期项。
- **可复现性**：在 `5b33829` 上把 Batch 3 的录制程序（驱动的是重构后的 provider）重跑到临时位置，与已提交夹具比较，只有 `recordedAt` 不同。这同时说明重构前后 provider 发出的 6 个请求逐字相同。D15 只改了分类与解码，没有改请求。
- **发布面人工五类目**：
  - 夹具只含已登记的沙箱 node id、公开账号名、`e1-sandbox` 仓库名、Project A 的公开 URL 与夹具说明句；
  - 没有凭据、本机路径或本机身份、个人信息、内部系统或保密字样；
  - 大小写不敏感扫描唯一命中的 `/users/` 来自 GitHub 的项目 URL，不是本机路径。

### 与计划的偏差

- **结构**：provider 由 7 个文件变为 6 个，`observations.ts` 并入 `provider.ts`；provider 是工厂闭包，不导出类；解码对非叶子值不做逐层守卫，任何抛错都判形状错误；`getPlanningItem` 读完全部页再匹配，不再命中即停。以上见 D12。
- **测试**：契约文件的「录制事实」改为「条目映射」，5 / 3 / 1 由套件按期望条目核对。集成的重复引导并入引导用例，SQLite 以实体 id 集合判定幂等。
- **变异表**：M14、M17 订正，新增 M14b、M19b、M20–M27，见 D13、D15 与变异表。
- **提交**：本层补丁没有改写；推送前随整条栈变基到新栈底，见 D14。

### 技术债务（开工前登记，执行中追加）

- **TD1**：没有内容身份的成员关系（REDACTED 或 `content` 为 null）在本地没有锚点，只计入 `unanchored`，不显示占位。一个原本可见的条目被扣下后，会从列表里消失，而不是变成占位。最坏情形由复评复现：全部条目都被扣下时，引导返回 `ok: true`，本地投影清空，同步游标仍是 healthy，唯一的信号 `unanchored` 不落库。归 #134 / #27，见 H2。Superseded by D16（2026-09-30）：有成员关系映射的条目出 redacted 占位，无映射时整次 degraded 且 `getPlanningSync` 可查询。残余：从未可见过的条目、升级前没有映射行的库、成员关系 id 变了的条目仍没有占位，其间工作区保持 degraded，所有行按同一摘要标 stale（H11）。 R2 更正：无映射条目存在时，可见行不再标 stale，只有 `snapshot.source` 与同步摘要 degraded（D23）。
- **TD2**：任何 GraphQL `errors` 都让整次失败。条目级错误要等录到它的形状（`path` 指向 `items.nodes[i].content`）后，再局部化为 redacted，见 H4。
- **TD3**：游标按 `POSITION` 分页，遍历途中有人重排条目，可能导致跨页重复或漏读。重复只会虚增 `BootstrapResult` 的计数，upsert 本身幂等；漏读要等下一次全量读取才能修复。#134 不得依据单次遍历删除成员关系。
- **TD4**：`reconcile` 没有失败通道，失败时一条不产出（D4）。
- **TD5**：`getPlanningItem` 每次读完全部页再匹配，代价 O(页数)，不做命中即停。#71 的 R3 读回需要按 node 点查。
- **TD6**：每次引导读两遍条目，一遍是 `reconcile`，一遍是列表。
- **TD7**：`describeCapabilities` 的探针结论在 `composeCore` 时固定，之后不刷新（#134）。组装时探针遇到 401，之后 transport 恢复健康，引导仍一直报 `not_supported`，恢复动作从「重新授权」丢成了「不支持」。替身的同一场景表现相同，这是 core 既有语义。
- **TD8**：REDACTED 的形状未观测，只有合成用例，见 H3。
- **TD9**：平台不给退避提示时，`retryAfterMs` 为 undefined，退避策略归 #134。
- **TD10**：录制程序写在本计划里，没有进入 CI。可复现性靠 Batch 4 重录比较 diff。
- **TD11**：每次引导都推进一次修订号，即使什么都没变，归 #134（它的验收要求「每次应用的变更推进一次」）。
- **TD12**：provider 在单页上只能识别游标停滞，也就是「游标等于传入值」。长度 ≥ 2 的游标环只在 provider 自己的扫描里被识别，扫描服务于 `reconcile` 与 `getPlanningItem`。core 的 `readAllItems` 遇到这种环会一直循环，而组装时的首轮引导在 `composeCore` 里被 await，所以宿主启动会挂住，条目数组也会无界增长，要由 core 或 #134 的有界调度来截断。扫描本身也没有页数上限：永不重复的游标流只能靠 transport 超时截断；一页超大或是稀疏数组时，`getPlanningItem` 会 reject。这两种都属于 transport 违约，平台每页至多 100 条。Superseded by D17（2026-09-30）：core 的成环与页数上界、扫描的页数上界已收口；残余只有「一页超大或是稀疏数组」。
- **TD14**（R1）：client / ui-model 不消费 `snapshot.source`，`WorkspaceRead.reason` 由宿主注入；冷启动全部不可见时，宿主壳要把 `snapshot.source` 接进 `WorkspaceRead.reason` 才能在界面上表达缺口，归 apps 壳的接线任务。 R2：仍归 #178（`feat(client): assemble the ui-model workspace read from sync state and capabilities`），验收者在该 issue 登记这项义务（评论链接见 PR 描述）；本 PR 只保证 wire 上的 `snapshot.source` 正确。
- **TD15**（R1）：观察账本保留条目可见时的内容观察（含标题与正文）。它不在任何查询路径上，扣下后不清除；清理策略归 #134。
- **TD16**（R1）：成员关系映射行在条目移出项目后不回收（成员关系 id 不复用，不影响锚定）；占位期间 draft 转成 issue 时，占位仍挂在原 draft 实体上，恢复可见后按 issue 新建实体（引导本来不做提升），归 #134。
- **TD17**（R2）：`sync_cursor.state` 的 `healthy` 在 D23 后只表示「本次提交成功」，缺口由 `lastErrorCode` 表达。#134 的调度层若直接读游标，必须按 `SyncSummary` 的 `degraded` 与 `stale` 两个量判断，不能只看 state。
- **TD18**（R2）：分类只在 403 的顶层 `message` 与 2xx 的 `errors[].message` 里找二级限流；403 正文带 `errors[]` 的形态平台没有记录，未覆盖，录到后再补。
- **TD13**：`describeCapabilities` 没有 try：注入的时钟返回 `NaN` 时，它会在 `composeCore` 里抛错，组装随之失败。这是响亮的失败，不会静默；时钟由宿主注入。

## Bottom Change Note

- 2026-09-29：创建。由独立评审定稿者在三份独立设计的基础上写成；定稿来源、嫁接点与被拒方案见 `Design / Spec`，评审结论见 `Decision Log` D9。
- 2026-09-29：T5 回填执行证据。按验收重构后的实现订正了 `Design / Spec` 的结构表、方法语义与解码规则，以及变异表、`Validation and Acceptance`；新增 D12–D14、TD12、TD13。原因：集成后规模超限，T4 报告了 P3。
- 2026-09-30：追加「评审响应 · R1」（评审 5362364398）。原因：人类评审确认两处事实缺陷（无法锚定的读取被报成健康完整快照；core 逐页读取不识别跨页环）与一处过期入口。改动：新增 R1 批次、Global Constraints 的 R1 文件集、Validation #13–#15、D16–D20、H10–H13、TD14–TD16；就地标注被推翻的 D2 守卫描述、H2、H6、TD1、TD12 与栈底相关约束；头部、「栈的位置」与 `Interfaces and Dependencies` 改为 base `main`，上游计划入口改指 completed。
- 2026-09-30：R1 验收回填。原因：验收复评、整表变异与提交整理。改动：D21、三条 Surprises、Progress、`Outcomes & Retrospective` 的「R1 验收复评」、恢复路径改用 `origin/main`、Batch 0–5 标为历史批次。
- 2026-09-30：追加「R2 · 评审后决策」。原因：人类伙伴接受规模，其余交主会话调研后抉择。改动：R2 小节、D22–D26、H10–H13 的裁决标注、TD1 与 TD14 的更正，Batch 0 标为观察时刻快照，M37–M43。
- 2026-09-30：R2 验收回填。原因：验收复评、对抗验证的 P3 与整表变异。改动：D27、D22 / D23 / D25 的来源 URL、H1–H9 的执行记录、两条 Surprises、TD17、TD18、V&A #10 / #11 / #16、Progress、「R2 验收复评」，R1-a、R1-b 与 e2e 判别行就地标 Superseded。

- 2026-10-01：按用户授权收尾；P3状态整数校验与回归、D28/D29交付物整理、计划归档和Completed入口同步。原R1/R2观察按日期保留，整合后验收/回滚按D29执行；最终合并以GitHub回读为准。
