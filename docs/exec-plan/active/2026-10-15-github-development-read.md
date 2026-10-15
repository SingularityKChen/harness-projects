# GitHub Development 只读 Provider ExecPlan

> 状态：Active
> 创建：2026-10-15
> 范围：完成 issue #231：把占位包 `packages/providers/development-github` 做成只读的 GitHub Development provider——仓库、分支、提交、按 head 分支列出变更请求（PR）与单个 PR 读取、PR 观察流；在 E1 沙箱录制夹具上通过共享 Development 契约套件。不做任何写入、不接宿主工厂、不改 core 的谱系同步。
> 上游输入：`AGENTS.md`、`PLANS.md`、issue #231（及其承接 #233、#235、#297、#127、#143）、`packages/capabilities/src/development-provider.ts`、`packages/capabilities/src/observation.ts`、`tests/contract/suites/development.js`、`packages/providers/planning-github-projects/`、`packages/providers/delivery-github-actions/`、`docs/architecture/gate-e1-sandbox.md`、`docs/architecture/gate-e1-content-identities.md`、`docs/exec-plan/completed/2026-09-29-github-projects-read.md`。
> 格式：本文件按根目录 `PLANS.md` 的强制章节书写；另带 `Concrete Steps` 与 `Artifacts and Notes` 两节以满足 ExecPlan 技能的结构检查。

## Purpose / Big Picture

完成后，`@harness-projects/provider-development-github` 导出一个只读的 `DevelopmentProvider`：

- 给定 Start Work 建的分支名（`work/<slug>`），`listChangeRequests({ repository, headBranch })` 只返回**本仓库**里 head 分支与它**字节精确相等**的 PR；每一项带 `headBranch`、`reviewState`（平台 `reviewDecision` 的保守投影）与 `sourceVersion = headRefOid`。标题等于分支名的 PR、fork 上同名分支的 PR、平台放宽过滤后多带出来的 PR 一律不返回。core 现有的 `readChangeRequest`（`packages/core/src/chain-facts.ts`）因此可以按「分支 + 头部提交相等」把 PR 挂到执行上下文的分支上，不重新识别对象。
- 共享 Development 契约套件 `developmentContractSuite` 在 E1 沙箱的录制夹具上不联网通过；回放未命中即 reject，未命中账本为空。
- 凭据失去读权限时：五个读方法返回结构化 `permission_denied` / `not_found`（固定文案、不回显平台正文），`describeCapabilities()` 把两个读 key 的 permission 报为 `degraded`；权限恢复后同一实例再次描述即回到 `available`。任何路径都不抛错。
- provider 的 node id 只出现在 `ref.externalId`（`change_request` 用 PR node id，与规划 provider 对同一 PR 给出的内容 id 逐字相同）；仓库引用的 `externalId` 是宿主配置的本地仓库键（core 把它当仓库主键），仓库 node id 不出现在任何输出里。
- `reconcile` 产出 `development.change_request.observed` 观察，`sourceVersion` 是 `observation.ts` R4 的定宽 30 字节规范载体（由 PR 的 `updatedAt` 归一），绝不是 sha。

最小成功证据：在检出 `feature/github-development-read` 的工作树根目录运行 `node --test tests/contract/development-github-contract.test.js`，`ℹ fail 0`，且其中的套件用例、`start-work-branch-lineage`、`permission-loss-degrades`、`identity-shape`、`change-request-observations` 与末条 `replay-ledger` 全部通过；`node --test tests/contract/development-contract.test.js tests/integration/development-local-git.test.js` 仍 `ℹ fail 0`。

## Context and Orientation

### 术语

- **Development port**：`packages/capabilities/src/development-provider.ts`。五个必需读方法 `getRepository`、`listBranches`、`getCommit`、`getChangeRequest`、`listChangeRequests`；写方法、工作树方法与 `reconcile` 都可选。可选方法不实现时，快照不得把对应 key 声明为 `available`（义务 3）。列表从 `cursor: undefined` 逐页读到 `nextCursor === undefined` 必须恰好枚举每个对象一次（义务 4）。
- **`ProviderChangeRequest`**（同文件 51–59 行）：`sourceVersion` 是头部提交 sha，只做相等比较；`headBranch` 是真实头部分支身份，无法精确解析为本仓库分支时为 `undefined`；`reviewState` 只有 `approved` / `changes_requested` / `review_required` / `unknown` 四值，来源未给结论或给出 union 之外的枚举一律 `unknown`（49 行）。
- **`headBranch` 过滤**（同文件 77–87 行）：字节精确（不 trim、不 case-fold），空串是 `invalid_input`，先过滤再分页，游标只在同一 `(repository, headBranch, limit)` scope 内重用。
- **观察定序 R4**（`packages/capabilities/src/observation.ts` 60–88 行）：观察的 `sourceVersion` 只取 `sourceVersionFromTimestamp(平台时间戳)` 的定宽规范载体或 `undefined`；变更请求的头部 sha 不得填进去（port 109 行）。
- **能力快照**：`ProviderCapabilitySnapshot` 的 `capability` 是理论能力，`permission` 是当前凭据权限；`effectiveCapabilities` 取交集（`packages/capabilities/src/capability-keys.ts` 66–106 行）。core 在组合时对每个 port 只调用一次 `describeCapabilities()`（`packages/core/src/registry.ts` 116–150 行）；有效级别 `unavailable` 会让 core 的读门直接拒绝（`NotSupported`），`degraded` 仍放行读（`packages/core/src/capabilities.ts` 39–48 行）。
- **E1 沙箱**：私有仓库 `$E1_OWNER/$E1_REPO`，变量在 `docs/architecture/gate-e1-sandbox.md` §2.1 赋值。仓库 GraphQL node id 与 pr-gamma（`#5`，head 分支 `fixture/gamma`，node id）都已登记在该文件 §2.2、§2.3；本计划不抄录 node id 字面量，夹具与测试按该文件取值（`tests/contract/e1-evidence-consistency.test.js` 按内容把出现已登记 id 的计划认定为 E1 证据计划）。

### 当前状态（base `origin/main` 21cb29eb，观察时刻 2026-10-15 10:00 +08）

- `packages/providers/development-github/src/index.ts` 只导出 `packageId`。包的 `package.json` 依赖 domain 与 capabilities，根 `package.json` 已链接它，`tests/contract/package-boundaries.test.js` 63–66 行已登记它只许依赖 domain 与 capabilities，`tsconfig.json` 已有路径映射：**不需要改任何 `package.json` 或锁文件**。
- 兄弟实现：`packages/providers/planning-github-projects/`（GraphQL transport、分类器 `classify.ts`、组合期探针快照、R5 全量 `reconcile`、录制夹具 + 回放）；`packages/providers/delivery-github-actions/`（REST、宿主注入 permission、`REQUEST_ID` 形状校验）。provider 之间不得互相 import。
- 回放：`tests/contract/fixtures/github-projects/replay.js` 导出 `createReplay(...fixtures)`，以 `[operationName, 按键排序的 variables]` 为键，未命中记入 `misses` 并 reject；可直接复用，不必新写。
- 共享套件 `tests/contract/suites/development.js` 的 `declares()`（90–92 行）用 `effectiveCapabilities`（capability ∩ permission）判定「方法是否声明」。文件头 18 行却写明「本套件只建模能力声明，不建模 permission 与 degraded」。快照把 permission 报为 `degraded` 的只读 provider 在 `faults.offline` 场景下会被判成「未声明」，于是 663–670 行要求 `listChangeRequests` 答 `not_supported`——这对一个声明了能力、只是暂时离线的 provider 是错误要求（见 `Surprises & Discoveries` 第 1 条的原型证据）。
- 套件对只读形态的装配要求：必须提供 `preparedChangeRequest`（407–417 行），且即使没有工作树能力，也要求 `worktreePath`、`worktreeBranch`、`worktreeRef`、`worktreeDupBranch`（232–234、293、311、617 行）。
- core 的消费方式：`readHeadCommit` 以 `listBranches({ limit: 50 })` 读首页找分支头；`readChangeRequest` 以 `listChangeRequests({ headBranch: branch, limit: 50 })` 读首页，取第一个 `sourceVersion === head` 的项（`chain-facts.ts` 152–172 行）；CR 节点的实体 id 是 `chainEntityId(workspace, change_request, "<binding>|<externalId>")` 的哈希（245–249 行、`relations.ts` 35–38 行），交付写者以该哈希 `putEntity`（`delivery-facts.ts` 102 行）。仓库则不同：`start-work.ts` 的 `registerParents` 把 `request.repositoryId` 原样写成 `RepositoryRecord.id`（本地主键），并要求 `getRepository` 的 ack 回显同一个 `externalId`（`start-work.ts` 120–131、141–149 行）。**因此仓库引用的 `externalId` 若取 GitHub node id，就直接违反验收 4**。
- 目前没有任何 core 路径消费 Development 的 `reconcile`（只有 `bootstrap.ts` 171–173 行消费 Planning 的）；#233 的验收 4「重复与乱序观察收敛到一条谱系」是它的下一个消费者。
- 本轮并行 PR：A（#132，宿主组合）**不**在本轮注册 `development.github` 目录条目（A 的 TD-054：#231 合并后由 #233 或后合并者加）；B（#276）、D（#280）与本 PR 没有共享代码文件。本 PR 不入栈、从 `main` 分支；共享文件协议见 `Global Constraints`，合并次序与宿主会话窗口见 `Interfaces and Dependencies`。

### 沙箱清单（只读实测，观察时刻 2026-10-15 10:00 +08；回读命令见 `Concrete Steps` Batch 1）

- 分支两条：`fixture/gamma`（头部 `f6c8908f63d2b37b8a4638536078808bb91cfd77`）、`main`；默认分支 `main`。
- PR 一条：`#5`，OPEN，head `fixture/gamma`，`headRefOid` 等于该分支头，`isCrossRepository: false`，`reviewDecision: null`。

## Design / Spec

### 公共接口（`packages/providers/development-github/src/index.ts` 导出）

    export { createGithubDevelopmentProvider, GITHUB_DEVELOPMENT_DEFINITION, type GithubDevelopmentProviderOptions } from './provider.ts'
    export type { GraphqlRequest, GraphqlResponse, GraphqlTransport } from './transport.ts'
    export { DEVELOPMENT_QUERIES } from './queries.ts'

    // transport.ts：与 planning-github-projects 的 transport.ts 结构逐字同形，宿主可以用同一个 POST /graphql 实现服务两个 provider
    export interface GraphqlRequest { readonly operationName: string; readonly query: string; readonly variables: Readonly<Record<string, unknown>> }
    export interface GraphqlResponse { readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: unknown }
    export type GraphqlTransport = (request: GraphqlRequest) => Promise<GraphqlResponse>

    // provider.ts
    export interface GithubDevelopmentProviderOptions {
      readonly bindingId: ProviderBindingId
      /** externalId：宿主选定的工作区仓库键（core 把它写成仓库主键，绝不能是 GitHub node id）；owner / name 只用于平台寻址。 */
      readonly repository: { readonly externalId: string; readonly owner: string; readonly name: string }
      readonly transport: GraphqlTransport
      /** 毫秒时钟，缺省 Date.now；只用于快照的 observedAt 与观察的 receivedTime。 */
      readonly now?: () => number
    }
    export const GITHUB_DEVELOPMENT_DEFINITION: ProviderDefinition // Object.freeze({ implementationKey: 'development.github', domains: Object.freeze(['development'] as const) })
    export function createGithubDevelopmentProvider(options: GithubDevelopmentProviderOptions): DevelopmentProvider

构造期校验（宿主编程错误，抛 `TypeError`）：`repository.externalId`、`owner`、`name` 是非空字符串，`transport` 是函数。除此之外任何路径都不抛错。

返回对象只有 `definition`、`describeCapabilities` 与五个读方法，外加 `reconcile`；`createBranch`、`preflightWorktree`、`createWorktree`、`getWorktree`、`createChangeRequest`、`removeWorktree` **省略**（不是返回 `not_supported` 的桩）。

### 查询文本（`queries.ts`，是契约：改动即重录夹具）

五个操作的 `DEVELOPMENT_QUERIES` 键与文本如下。两个变更请求操作在文本末尾拼接同一个片段 `DevelopmentChangeRequestFields`（GraphQL 要求片段定义与操作在同一文档）。查询不取 `author`、`login`、`email`、`creator`、`assignees` 等个人字段；仓库查询不取 `id`（仓库 node id 只在成员关系核对时出现）。

    fragment DevelopmentChangeRequestFields on PullRequest {
      id number title body state url updatedAt headRefName headRefOid isCrossRepository reviewDecision
    }

    query DevelopmentRepository($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) { name updatedAt defaultBranchRef { name } }
    }

    query DevelopmentBranches($owner: String!, $name: String!, $first: Int!, $after: String) {
      repository(owner: $owner, name: $name) {
        refs(refPrefix: "refs/heads/", first: $first, after: $after, orderBy: { field: ALPHABETICAL, direction: ASC }) {
          pageInfo { hasNextPage endCursor }
          nodes { name target { oid } }
        }
      }
    }

    query DevelopmentCommit($owner: String!, $name: String!, $oid: GitObjectID!) {
      repository(owner: $owner, name: $name) { object(oid: $oid) { __typename ... on Commit { oid messageHeadline } } }
    }

    query DevelopmentChangeRequests($owner: String!, $name: String!, $headRefName: String, $first: Int!, $after: String) {
      repository(owner: $owner, name: $name) {
        pullRequests(headRefName: $headRefName, first: $first, after: $after, states: [OPEN, CLOSED, MERGED], orderBy: { field: CREATED_AT, direction: DESC }) {
          pageInfo { hasNextPage endCursor }
          nodes { ...DevelopmentChangeRequestFields }
        }
      }
    }

    query DevelopmentChangeRequest($owner: String!, $name: String!, $id: ID!) {
      repository(owner: $owner, name: $name) { id }
      node(id: $id) { __typename ... on PullRequest { ...DevelopmentChangeRequestFields repository { id } } }
    }

五段文本已于 2026-10-15 用只读 `gh api graphql` 对沙箱逐条执行过，全部通过 schema 校验并返回预期形状（`Surprises & Discoveries` 第 3 条）。

**变量规范化**（回放键依赖它，录制程序与实现必须逐字一致）：

| 操作 | variables 恰好是 |
|---|---|
| `DevelopmentRepository` | `{ owner, name }` |
| `DevelopmentBranches` | `{ owner, name, first, after }`；`after` 在首页为 `null` |
| `DevelopmentCommit` | `{ owner, name, oid }` |
| `DevelopmentChangeRequests` | `{ owner, name, headRefName, first, after }`；不过滤时 `headRefName: null`，首页 `after: null` |
| `DevelopmentChangeRequest` | `{ owner, name, id }` |

`first = Math.min(limit, 100)`（平台上限 100，`first: 101` 实测报 `EXCESSIVE_PAGINATION`）。

### 读方法的行为（输入闸门全部在发请求之前，闸门拒绝时 transport 调用次数为 0）

| 方法 | 闸门（按顺序） | 请求与解码 |
|---|---|---|
| `getRepository(ref)` | `ref.bindingId === bindingId && ref.objectKind === 'repository' && ref.externalId === repository.externalId`，否则 `not_found` | `DevelopmentRepository`；`repository: null` → `not_found`；返回 `{ ref: { bindingId, objectKind: 'repository', externalId: repository.externalId, url: undefined }, name, defaultBranch: defaultBranchRef?.name ?? undefined, sourceUpdatedAt: updatedAt }` |
| `listBranches({ repository, cursor, limit })` | 仓库闸门同上 → `not_found`；`limit` 不是正整数 → `invalid_input`；`cursor` 不是 `undefined` 也不是非空字符串 → `invalid_input` | `DevelopmentBranches`；每项 `{ ref: { bindingId, objectKind: 'branch', externalId: name, url: undefined }, name, headCommit: target.oid }`，`target.oid` 必须是 40 位小写十六进制 |
| `getCommit(ref)` | `bindingId` 或 `objectKind !== 'commit'` 不符 → `not_found`；`externalId` 不匹配 `/^[0-9a-f]{40}$/` → `invalid_input` | `DevelopmentCommit`；`object` 为 `null` 或 `__typename !== 'Commit'` → `not_found`；返回 `{ ref: { bindingId, objectKind: 'commit', externalId: oid, url: undefined }, sha: oid, message: messageHeadline === '' ? undefined : messageHeadline }` |
| `getChangeRequest(ref)` | `bindingId` 或 `objectKind !== 'change_request'` 不符 → `not_found`；`externalId` 不是非空字符串 → `invalid_input` | `DevelopmentChangeRequest`；`node` 为 `null`、`__typename !== 'PullRequest'`、或 `node.repository.id !== data.repository.id`（成员关系：别的仓库的 PR）→ `not_found` |
| `listChangeRequests({ repository, cursor, limit, headBranch })` | 仓库闸门 → `not_found`；`limit`、`cursor` 同 `listBranches`；`headBranch` 不是 `undefined` 也不是非空字符串（含 `''`）→ `invalid_input` | `DevelopmentChangeRequests`，`headRefName: headBranch ?? null`；解码后**后过滤** `headBranch === undefined || item.headBranch === headBranch` |

**变更请求投影**（list 与 get 共用一个解码函数，所以两面逐字段相同）：

    ref = { bindingId, objectKind: 'change_request', externalId: node.id, url: node.url }
    number = node.number                         // 正整数，否则形状错误
    title = node.title; body = node.body         // 字符串，否则形状错误
    state = node.state.toLowerCase()             // open | closed | merged
    sourceVersion = node.headRefOid              // 40 位小写十六进制，否则形状错误
    headBranch = node.isCrossRepository === false ? node.headRefName : undefined
    reviewState = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested', REVIEW_REQUIRED: 'review_required' }[node.reviewDecision] ?? 'unknown'

`isCrossRepository` 必须是布尔值（形状错误则整页失败）。fork 上同名分支的 PR 因此 `headBranch === undefined`，永远不会命中分支过滤；但它仍是本仓库的 PR，不带过滤的列表与 `getChangeRequest` 照常返回它。后过滤只用这一条谓词，不看标题、不看编号、不做前缀匹配。`reviewDecision` 用 `Object.hasOwn` 查表，`null`、`DISMISSED` 这类 union 之外的值都落到 `unknown`。

**分页**：`nextCursor = pageInfo.hasNextPage ? endCursor : undefined`；`hasNextPage` 不是布尔值，或为真但 `endCursor` 不是非空字符串、或等于传入的 `cursor`（游标停滞）→ 整页 `unavailable` + `rawClass: 'malformed_response'`。游标原样透传平台的 `endCursor`，不编码 scope（端口把「换 scope 从头读」定为调用方义务）。后过滤可能让一页少于 `limit` 项甚至为空而 `nextCursor` 仍有值；端口允许，读者逐页读完即可。

**任何形状不符整次失败**：解码函数遇到不符抛 `TypeError`，由唯一的 `call` 包装捕获为 `unavailable` + `malformed_response`；不做「过滤坏行后成功」。

### 失败分类（`classify.ts`，自上而下，命中即止）

复制 `packages/providers/planning-github-projects/src/classify.ts` 的判定顺序与固定文案（provider 之间不得 import，见 `Decision Log` D14），再加 `requestId` 形状校验。

| 条件 | 结果 | `retryable` |
|---|---|---|
| transport 同步抛错或 reject | `unavailable`，`rawClass: 'transport_error'` | true |
| `status` 不是整数 | `unavailable`，`malformed_response` | true |
| 429；或 403 且带限流证据（`x-ratelimit-remaining === '0'`、存在 `retry-after`、或 message 含 `secondary rate`） | `rate_limited`（`retryAfterMs` 按 planning 的规则换算） | true |
| 401；或其余 403 | `permission_denied` | false |
| 其余非 2xx | `unavailable`，`http_<status>` | true |
| body 不是对象 | `unavailable`，`malformed_response` | true |
| `errors` 非空且含限流证据（`x-ratelimit-remaining === '0'`、`RATE_LIMITED`、或某条 message 含 `secondary rate`） | `rate_limited` | true |
| `errors` 含 `FORBIDDEN` 或 `INSUFFICIENT_SCOPES` | `permission_denied` | false |
| `errors` 含 `NOT_FOUND` | `not_found` | false |
| 其余 `errors` | `unavailable`，`graphql_<TYPE>`（TYPE 只接受 `^[A-Z_]{1,40}$`，否则 `graphql_error`） | true |
| 解码抛错 | `unavailable`，`malformed_response` | true |

- `errors` 非空时不做部分成功，`data` 里有内容也整次失败。
- `message` 只取固定文案：`permission_denied` → `GitHub 拒绝了当前凭据的访问`；`not_found` → `GitHub 上找不到目标，或对当前凭据不可见`；`rate_limited` → `GitHub 触发限流`；`unavailable` → `GitHub 暂时不可用，或响应形状不符合预期`。不拼接响应正文、请求头或异常文本。
- `requestId` 取 `headers['x-github-request-id']`，只在匹配 `/^[0-9A-F]{1,8}(?::[0-9A-F]{1,16}){3,5}$/i`（与 `delivery-github-actions` 的 `REQUEST_ID` 相同）时保留，否则 `undefined`。

### 能力快照（`describeCapabilities`）

- `capability`：恰好 `development.repository.read` 与 `development.change_request.read` 两个 key，值 `available`。不声明 `development.review.read`（评审状态是 CR 读快照的字段，不是独立能力）。
- `permission`：**每次调用**用 `getRepository` 的同一路径探测一次，不缓存。成功 → 两个 key 都 `available`；任何结构化失败（`permission_denied`、`not_found`、`rate_limited`、`unavailable`）→ 两个 key 都 `degraded`。
- `observedAt`：`new Date(now()).toISOString()`；`bindingId` 原样。

理由与被放弃的方案见 `Decision Log` D2、D3。

### 观察流（`reconcile`）

R5 全量比对，忽略 `scope.cursor`，全有或全无（与 `planning-github-projects` 的 `reconcile` 同形）：

1. 以 `DevelopmentChangeRequests`（`headRefName: null`、`first: 100`）从 `after: null` 读到 `hasNextPage === false`；最多 `MAX_SCAN_PAGES = 100` 页（1 万个 PR），超限、游标停滞或任一页失败都一条不产出。
2. 全部页成功后，对每个 PR 构造一条观察：`subject` 为该 PR 的 `ref`；`type: 'development.change_request.observed'`；`eventTime = sourceVersion = sourceVersionFromTimestamp(node.updatedAt)`；`receivedTime = new Date(now()).toISOString()`；`stablePayloadFields = payload = { number, state, title, body, headBranch: item.headBranch ?? null, headCommit: item.sourceVersion ?? null, reviewState }`（`headCommit` 是 PR 投影里的头部 sha，只作 payload 字段，不是观察版本）。payload 不含请求头、游标、`requestId` 或凭据材料。
3. 构造全部成功后才逐条 `yield`；任何异常（含 `RangeError`、时钟非有限值）一条不产出，也不抛错。

### 数据流与状态归属

宿主组合时 `collectBindings` 调一次 `describeCapabilities`（一次仓库探针）→ core 读交付谱系时按执行上下文的仓库与分支调用 `listBranches`、`listChangeRequests({ headBranch })`、`getCommit` → core 用 `chainEntityId` 派生实体 id 并按 `sourceVersion === head` 挂谱系（#233 扩展）。provider 无状态：不缓存、不重试、不退避、不持有凭据；鉴权、超时与重试属于宿主注入的 transport（ADR-0013 第 3 条：凭据按操作解析）。

### 被放弃的方案

| 方案 | 放弃原因 |
|---|---|
| REST `GET /repos/{o}/{r}/pulls?head=…` | `head` 必须写成 `user:ref`，`state` 默认只取 `open`，返回对象没有评审结论——只能从评审列表反推，端口禁止（D1） |
| search API 的 `head:` 限定符 | 前缀匹配、单独限额、索引最终一致；共享套件明确拒绝前缀匹配（D1） |
| 快照静态 `available`，permission 由宿主注入（delivery 先例） | 失去「降级能力」这一验收 3 的直接信号；宿主要另做一次探针才能知道权限（D2） |
| 权限失败在快照里报 `unavailable`（planning 先例） | core 读门会把它翻成 `NotSupported` 直接拒绝，ui-model 挡住谱系入口，补授权后要重新组合才能恢复（D2） |
| 不改共享套件、靠适配器让离线场景快照保持 `available` | 等于为通过测试伪造探针结果（D3） |
| 游标编码 scope（delivery 先例） | 多约 15 行；端口已把换 scope 规定为调用方义务（D5） |
| 仓库按 node id 寻址（`node(id:)`） | 需要宿主额外配置仓库 node id（#127 的职责），本 PR 记为 TD-064（D8） |
| 本 PR 写 core 级谱系集成测试 | 那是 #233 验收 1（录制夹具上的完整谱系）的范围；需要伪造执行上下文，成本约 80 行（D12） |
| 在沙箱新建 `work/<slug>` 分支与 PR | 外部写入需要人类批准；provider 对分支名是不透明字节，Start Work 命名差异没有可观察效果（D11） |

## Global Constraints

- 只依赖 `@harness-projects/domain` 与 `@harness-projects/capabilities`；不 import 任何其它 provider（`tests/contract/package-boundaries.test.js`）。provider 源码不得出现 `fetch(`、`process.env`、`node:child_process`、`node:http`、`node:https`、`node:net`。
- 不改端口（`packages/capabilities/**`）、core、controller、apps、storage、任何 `package.json` 或 `pnpm-lock.yaml`。
- 凭据不进夹具、日志、文档或错误文案；夹具不录响应头。测试里的 token canary 不得匹配 `scripts/rule-checks.mjs` 的 GitHub 令牌正则（用 `canary-not-a-token-231` 这类带连字符的串）。
- 录制只读：录制程序拒绝 `mutation`；本 PR 不对沙箱或任何仓库做外部写入。
- 文档正文中文，标识符英文；不写本机绝对路径、不写账号以外的身份信息（`docs/development/publication.md`）。仓库 owner 与 `e1-sandbox` 已是 `docs/architecture/gate-e1-sandbox.md` 里公开登记的值。
- 本计划与提交正文不写关闭关键字加 issue 号的组合；提交一律 `Refs #231`，只有 PR 正文用关闭关键字，以 `closingIssuesReferences` 回读为准。
- 技术债编号只用预分配的 TD-061..064（全轮号段：A 053–056、B 057–060、C 061–064、D 065–066），手工插入（跟踪脚本与表格式不兼容），位置按下方「跨 PR 共享文件协议」。
- 规模预算（`node scripts/rule-checks.mjs size origin/main`）：代码桶（实现 + 测试 + 夹具 JSON）≤ 800 行规划、1000 行硬上限；文档桶 ≤ 1300 行规划、1500 行硬上限。
- **本 PR 的完整文件集合**（一个事实只写一处，其它章节引用本节）：

| 文件 | 动作 | 批次 |
|---|---|---|
| `docs/exec-plan/active/2026-10-15-github-development-read.md` | 新增 | 0，此后各批回填 |
| `packages/providers/development-github/src/queries.ts` | 新增 | 1 |
| `packages/providers/development-github/src/transport.ts` | 新增 | 1 |
| `packages/providers/development-github/src/index.ts` | 修改 | 1、2 |
| `tests/contract/fixtures/github-development/sandbox.json` | 新增（录制） | 1 |
| `tests/contract/development-github-contract.test.js` | 新增 | 1–4 |
| `packages/providers/development-github/src/classify.ts` | 新增 | 2 |
| `packages/providers/development-github/src/decode.ts` | 新增 | 2、4 |
| `packages/providers/development-github/src/provider.ts` | 新增 | 2–4 |
| `tests/contract/suites/development.js` | 修改（`declares` 一行与文件头一句） | 3 |
| `docs/exec-plan/tech-debt-tracker.md` | 按编号插入 TD-061..064（位置见下方协议） | 6 |
| `docs/README.md` | Active 表加一行（位置见下方协议） | 0 |
| `docs/product/vertical-path.md` | 第 9 行「承接」格就地加 Superseded 注 | 6 |

不改：`docs/architecture/gate-e1-sandbox.md`（夹具只含已登记的 node id）、`packages/core/**`、`apps/**`。

**跨 PR 共享文件协议**（2026-10-15 协调者整合裁定，本节只摘与本 PR 相关的部分；取舍见 `Decision Log` D16）：

- 一个单元一个 owner；任何 PR 不删除、不改名别人的成员或行。
- 本 PR 独占上表的代码与夹具文件，以及 `tests/contract/suites/development.js`（只改 `declares()` 与文件头一句）、`docs/product/vertical-path.md` §2.1 第 9 行；A、B、D 都不写它们。本 PR 也不写 A 的单元（`apps/harness-plugin/src/host.ts`、`host-composition.ts` 的结构、`index.ts`、`apps/harness-plugin/package.json`、`pnpm-lock.yaml`、`packages/core/src/context.ts`、两个存储适配器、`tests/contract/suites/storage-connector-account.js`、`tests/contract/package-boundaries.test.js`、`docs/adr/*`）、B 的单元（`remote.ts`、`client.ts`、`host-surface.ts`、`workspace-watch.ts`、`packages/client/**`、`packages/controller/src/watch.ts`）与 D 的单元（D 将新建的会话 API 架构记录与 `docs/architecture/README.md` 里它的行、`tests/contract/fixtures/harness-session/**`、`tests/contract/harness-session-api-record.test.js`）。
- `docs/README.md` §2 Active 表：每个 PR 把自己的行插在表头分隔行 `|---|---|---|` 的**正下方**；rebase 冲突时后合并者保留全部行，2026-10-15 的各行按计划文件名排序（`…-github-development-read` < `…-harness-session-api-probe` < `…-host-provider-composition` < `…-host-watch-stream`，所以本行排在四行之首）。
- `docs/exec-plan/tech-debt-tracker.md` Open 表：各 PR 的行按 TD 编号插在数值位置，与合并次序无关。本 PR 的 TD-061..064 插在 Open 表里编号小于 061 的最后一行之后（base 21cb29eb 上是 TD-052；A、B 先合并时是 TD-056 或 TD-060）、编号大于 064 的第一行（D 的 TD-065，若已合并）之前。只有 A 改既有 TD-030 / TD-031 的格；本 PR 不改任何既有行。

## Plan of Work

| 批次 | 名称 | owner | 关闭的验收 | 估计（实现 / 测试 / 文档 行） |
|---|---|---|---|---|
| Batch 0 | 计划、draft PR 与关联 | 协调者（主会话） | — | 0 / 0 / 约 650 |
| Batch 1 | 查询文本与只读录制（夹具先行） | Sonnet 实施者 | 验收 2 的前提 | 约 50 / 约 70 / 0 |
| Batch 2 | 读路径：分支谱系与身份 | Sonnet 实施者 | 验收 1、2、4 | 约 260 / 约 135 / 0 |
| Batch 3 | 权限丢失降级与共享套件判定修正 | Sonnet 实施者 | 验收 3 | 约 15 / 约 64 / 0 |
| Batch 4 | 观察流（定宽可定序 sourceVersion） | Sonnet 实施者 | issue 范围条目「Observations with an orderable `sourceVersion`」 | 约 35 / 约 58 / 0 |
| Batch 5 | 对抗验证（变异表） | 独立的 Sonnet 验证者 | 四条验收的判别力 | 0 / 0 / 回填 |
| Batch 6 | 独立验收、重构与文档回填 | Opus 验收者；提交整合与 ready 由协调者 | 全部 | 回填约 40 |

规模估计（诚实口径，2026-10-15 跨 PR 评审后重估，见 `Decision Log` D19）：实现约 360 行（provider 约 165，对照 planning 的 `provider.ts` 153 行；decode 约 90；classify 约 48 加 `requestId` 守卫约 4；queries 约 40；transport 7；index 6），测试约 330 行（契约测试约 300、夹具 JSON 约 23、套件改动约 4），**代码合计约 690 / 800**；文档约 700 / 1300（本计划约 650 加 Batch 6 回填约 40、tracker 4 行、README 1 行、vertical-path 1 行）。不需要堆叠 PR：单 PR 即一个可独立验收、合并、回滚的能力闭环。若 Batch 4 结束时 `size` 读数超过 760，按序收缩：先删契约测试里与套件重复的断言（套件已覆盖的空串、外来 binding、cr-absent），再把 `classify.ts` 中与 planning 逐字相同的注释压成一行引用；不删任何验收用例。

**真实宿主（S3）**：本 PR **没有** S3 批次，也不进入本轮协调者的任何宿主会话窗口（S-D、S-AB）。provider 本轮不进入宿主目录（A 把 `development.github` 条目留作跟进层，TD-054），Desktop 宿主里没有可观察的入口；伪造宿主观察违反证据规则。S3 落点：注册 `development.github` 目录条目的那一层（#233 或后合并者）与 #143 的 demo 走查（真实 Start Work → PR → 谱系）。Batch 6 的「重录可复现性」是对真实 GitHub 的只读观察，不是 Desktop 宿主观察，不冒充 S3；它与 Batch 1 的录制只受一条宿主窗口约束：不得与 S-AB Phase 2 的人类沙箱编辑重叠（`Interfaces and Dependencies`「宿主会话窗口」，D18）。

## Concrete Steps

所有命令都在检出 `feature/github-development-read` 的工作树根目录（仓库内路径 `.worktrees/github-development-read`）运行；`gh pr`、`gh issue` 这类按当前目录解析仓库的命令一律带 `-R SingularityKChen/harness-projects`（`gh api graphql` 的录制命令显式写 owner 与 name，不依赖当前目录）。每批结束先本地 WIP 提交（会话可能被中断，scratchpad 会清空），最终在 Batch 6 整合。

### Batch 0 · 计划、draft PR 与关联（协调者）

**最小闭环**：本计划进入分支，draft PR 关联 #231 并带齐标签与里程碑。
**涉及文件**：本计划、`docs/README.md`。

- [ ] 核对隔离：`git rev-parse --git-dir --git-common-dir`、`git status --short --branch`（期望：`## feature/github-development-read...origin/main`，只有本计划未跟踪）、`git worktree list --porcelain`、`git check-ignore -v .worktrees/`。
- [ ] 在 `docs/README.md` §2 Active 表按 `Global Constraints` 的「跨 PR 共享文件协议」插入（表头分隔行 `|---|---|---|` 正下方）：`| [2026-10-15-github-development-read](exec-plan/active/2026-10-15-github-development-read.md) | #231：GitHub Development 只读 provider（仓库 / 分支 / 提交 / 按 head 分支读 PR / 观察流），录制夹具上通过共享契约套件 | Active |`。
- [ ] 提交 `docs(exec-plan): 编写 GitHub Development 只读 provider 计划`，正文说明为什么（#231 的四条验收与设计取舍），末尾 `Refs #231` 与 `Co-Authored-By` 行；身份用 `git -c user.name=… -c user.email=…` 单次传入，不写 git config。
- [ ] 推送并开 draft PR：标题 `feat(providers): read pull requests and branch lineage through the GitHub development provider`，base `main`，标签 `kind:feat`、`area:providers`，里程碑 `M4 · MVP Demo：Harness 内打通 GitHub 链路`。正文含：闭环、本计划路径与 Batch 名、关闭关键字（`Closes` + `#231`）、验证证据（随批回填）、风险与回滚、「不入栈，base `main`」、人类门段落（HC1：共享套件 `declares()` 改动请评审者确认，否决时验收 3 的解释交人类裁定；见 `Validation and Acceptance` 末段）。
- [ ] 按 `docs/project-management/README.md` 只回填机械字段；不写 Project `Status`，不写 blocked-by / blocking。

**验证**：
`gh pr view <n> -R SingularityKChen/harness-projects --json isDraft,baseRefName,headRefName,labels,milestone,closingIssuesReferences`（期望：draft、base `main`、两个标签、里程碑 M4、`closingIssuesReferences` 含 231；刚开时可能为空，改一次正文后再回读）；`gh issue view 231 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences`（期望：含本 PR）。
**回滚**：关闭 draft PR，删除远端分支；本地分支保留。

### Batch 1 · 查询文本与只读录制（夹具先行，结束时为红）

**最小闭环**：查询文本定稿并进入包导出；按它录下沙箱的真实回答；契约测试骨架因 provider 未实现而红。
**涉及文件**：`queries.ts`、`transport.ts`、`index.ts`、`sandbox.json`、`development-github-contract.test.js`（骨架）。

- [ ] 写 `transport.ts`（`Design / Spec` 的三个类型，文件头说明鉴权、超时、重试属于宿主）与 `queries.ts`（`Design / Spec` 的五段文本与片段，导出 `DEVELOPMENT_QUERIES: Readonly<Record<'DevelopmentRepository' | 'DevelopmentBranches' | 'DevelopmentCommit' | 'DevelopmentChangeRequests' | 'DevelopmentChangeRequest', string>>`，`Object.freeze`）。`index.ts` 先导出 `DEVELOPMENT_QUERIES` 与 transport 类型。
- [ ] 录制前置：`gh auth status`（期望：开发账号是 Active account；否则停下报协调者，不改用合成数据）；按 `docs/architecture/gate-e1-sandbox.md` §2.1 在 shell 设置 `E1_OWNER` 与 `E1_REPO`。
- [ ] 录制时间窗（D18）：开始前向协调者确认 S-AB Phase 2 的人类沙箱编辑不在进行中（从人类编辑 `issue-writable` 起，到人类还原并再引导一次止）；录制起止时刻（+08）写进 `Progress`。重叠时停下等窗口结束，不录。
- [ ] 只读回读沙箱清单（命令见下方第一个代码块）。期望：分支恰为 `fixture/gamma`、`main`，`totalCount` 为 1。不一致时先把实际清单记入 `Surprises & Discoveries`，再按实际清单调整录制清单与测试常量；新出现的 node id 要先登记到 `docs/architecture/gate-e1-sandbox.md`（这会把该文件加入文件集合，按 `PLANS.md` 改本计划并追加 Change Note）；不得为对齐计划而写沙箱。
- [ ] 把下方第二个代码块保存为 `.superpowers/recording/record-development.mjs`（git 忽略，不提交），在工作树根目录运行 `node .superpowers/recording/record-development.mjs "$E1_OWNER" "$E1_REPO" > tests/contract/fixtures/github-development/sandbox.json`。期望：exit 0；`node -e "console.log(JSON.parse(require('fs').readFileSync('tests/contract/fixtures/github-development/sandbox.json','utf8')).exchanges.length)"` 输出 `19`（仓库 2、分支 4、提交 2、单个 PR 2、PR 列表 9）。`first: 1` 的分支遍历条数随分支数变化，清单变了就按实际数核对。

沙箱清单回读命令：

    gh api graphql -f query='query { repository(owner:"'"$E1_OWNER"'", name:"'"$E1_REPO"'") { refs(refPrefix:"refs/heads/", first:100) { nodes { name } } pullRequests(first:100) { totalCount } } }'

录制程序（`.superpowers/recording/record-development.mjs`）：

    // 只读录制：直接发送 DEVELOPMENT_QUERIES 里的查询文本（不经 provider），录下平台真实回答。
    import { spawnSync } from 'node:child_process'
    import { createHash } from 'node:crypto'
    import { DEVELOPMENT_QUERIES } from '@harness-projects/provider-development-github'

    const [owner, name] = process.argv.slice(2)
    if (!owner || !name) throw new Error('用法：record-development.mjs <owner> <repo>')
    const exchanges = []
    function ask(operationName, variables) {
      const query = DEVELOPMENT_QUERIES[operationName]
      if (typeof query !== 'string' || /^\s*mutation\b/.test(query)) throw new Error(`拒绝录制：${operationName}`)
      const run = spawnSync('gh', ['api', 'graphql', '--input', '-'], { input: JSON.stringify({ query, variables, operationName }), encoding: 'utf8' })
      let body
      try { body = JSON.parse(run.stdout) } catch { throw new Error(`${operationName}：gh 没有输出 JSON（exit ${run.status}）`) }
      // GraphQL 带 errors 时 gh 退出 1，但 stdout 仍是完整响应正文：只有带非空 errors 的正文才录，其余非零退出一律中止。
      if (run.status !== 0 && !(Array.isArray(body.errors) && body.errors.length > 0)) throw new Error(`${operationName}：gh exit ${run.status}`)
      exchanges.push({ operationName, variables, status: 200, body })
      return body
    }
    const repo = { owner, name }
    const GAMMA = 'fixture/gamma'
    ask('DevelopmentRepository', repo)
    ask('DevelopmentRepository', { owner, name: `${name}-absent` })
    const branches = ask('DevelopmentBranches', { ...repo, first: 100, after: null }).data.repository.refs.nodes
    ask('DevelopmentBranches', { ...repo, first: 50, after: null })
    for (let after = null; ;) {
      const info = ask('DevelopmentBranches', { ...repo, first: 1, after }).data.repository.refs.pageInfo
      if (!info.hasNextPage) break
      after = info.endCursor
    }
    const gammaHead = branches.find((branch) => branch.name === GAMMA).target.oid
    ask('DevelopmentCommit', { ...repo, oid: gammaHead })
    ask('DevelopmentCommit', { ...repo, oid: '0'.repeat(40) })
    const listed = ask('DevelopmentChangeRequests', { ...repo, headRefName: null, first: 100, after: null }).data.repository.pullRequests
    if (listed.pageInfo.hasNextPage) throw new Error('沙箱 PR 超过 100 条：录制清单需要改')
    ask('DevelopmentChangeRequest', { ...repo, id: listed.nodes.find((pr) => pr.headRefName === GAMMA).id })
    ask('DevelopmentChangeRequest', { ...repo, id: 'cr-absent' })
    for (const headRefName of [GAMMA, 'feature/absent', GAMMA.toUpperCase(), ` ${GAMMA}`, `${GAMMA} `, GAMMA.slice(0, -1), GAMMA.slice(1)]) {
      ask('DevelopmentChangeRequests', { ...repo, headRefName, first: 100, after: null })
    }
    ask('DevelopmentChangeRequests', { ...repo, headRefName: GAMMA, first: 50, after: null })
    const hash = (text) => createHash('sha256').update(text).digest('hex')
    const queryHashes = Object.fromEntries(Object.entries(DEVELOPMENT_QUERIES).map(([operation, text]) => [operation, hash(text)]))
    const provenance = { source: 'e1-sandbox 只读查询', repository: '$E1_OWNER/$E1_REPO', recordedAt: new Date().toISOString(), queryHashes }
    process.stdout.write(`{"provenance":${JSON.stringify(provenance)},\n"exchanges":[\n${exchanges.map((entry) => JSON.stringify(entry)).join(',\n')}\n]}\n`)

录制之后：

- [ ] 发布面人工检查夹具（凭据、本机路径与身份、账号个人信息、内部系统、保密字样）：期望只有已登记的 node id（仓库 id 与 pr-gamma 的 PR node id）、公开账号名、`e1-sandbox`、提交 sha、夹具说明句与 GitHub 游标。
- [ ] 写测试骨架 `tests/contract/development-github-contract.test.js`：文件头写明它保护的不变量；常量全部从夹具读取（`OWNER` / `NAME` 取第一条 `DevelopmentRepository` 交换的 `variables`，`ABSENT_NAME` 取 `name` 以 `-absent` 结尾的那一条；`GAMMA_HEAD` 取 `DevelopmentBranches first:100` 的 `fixture/gamma` 节点，`PR_NODE` 取 `DevelopmentChangeRequests` 不过滤页的节点，`REPOSITORY_NODE_ID` 取 `DevelopmentChangeRequest` 交换里的 `data.repository.id`）；`LOCAL_REPOSITORY_KEY = 'repo-e1-sandbox'`；`bindingId = 'binding-github-development'`。辅助函数：
  - `replayProvider()`：`createReplay(fixture)`（从 `./fixtures/github-projects/replay.js` 导入），外包一层**请求账本**（未命中也记），`replays.push(replay)`，用每次调用加 1000 毫秒的时钟构造 provider，并 `ledgers.set(provider, ledger)`（`WeakMap`）。
  - `scripted(handler)`：合成 transport，记账本后返回 `handler(request)`；用它构造的 provider 同样登记进 `ledgers`，套件的 `objects` 钩子对任何 provider 都能取到账本。
  - 用例「provenance：夹具里的平台 node id 都已在沙箱定义登记」：切出夹具文本里以 `R_kg`、`PR_kw`、`I_kw`、`PVT`、`DI_` 开头且长度 ≥ 10 的 token，全部出现在 `docs/architecture/gate-e1-sandbox.md`；`provenance.repository === '$E1_OWNER/$E1_REPO'`。
  - 用例「query-drift：夹具记录的查询哈希等于当前查询文本，查询不取个人字段」：`provenance.queryHashes` 深等于按 `DEVELOPMENT_QUERIES` 现算的 sha256；全部查询文本不匹配 `/creator|assignees|login|author|email/i`，不含 `search(` 与 `mutation`。
  - 套件装配（`Batch 2` 才能变绿）与末条用例「replay-ledger：本文件所有回放都没有未命中的请求」：`replays.length > 0` 且 `replays.flatMap((r) => r.misses)` 深等于 `[]`。

**验证**：`node --test tests/contract/development-github-contract.test.js`。期望：红，失败原因是 `createGithubDevelopmentProvider` 未导出（`SyntaxError: The requested module … does not provide an export named …`），而不是夹具解析或回放未命中。
**回滚**：删除本批新增文件，`index.ts` 还原为只导出 `packageId`。

### Batch 2 · 读路径：分支谱系与身份（验收 1、2、4）

**最小闭环**：五个读方法在录制夹具上过共享套件；Start Work 分支谱系与身份用例变绿。
**涉及文件**：`classify.ts`、`decode.ts`、`provider.ts`、`index.ts`、契约测试。

- [ ] 先写用例（全部红）：
  - **套件装配**：`developmentContractSuite({ label: 'GitHub Development provider（录制夹具）', makeProvider, expect })`。`makeProvider(scenario)`：`faults.offline` → `scripted` 永远 reject；`faults.permissionDenied` → `scripted` 永远返回 `{ status: 401, headers: {}, body: { message: 'Bad credentials' } }`；其余（含 `capabilities.*`）→ `replayProvider()`。`expect`：`repository = { bindingId, objectKind: 'repository', externalId: LOCAL_REPOSITORY_KEY, url: undefined }`、`baseBranch: 'main'`、`headCommit: GAMMA_HEAD`、`pageSize: 1`、`worktreeBranch: 'fixture/gamma'`、`worktreeDupBranch: 'main'`、`worktreePath: 'unused-worktree-path'`、`worktreeRef: { bindingId, objectKind: 'worktree', externalId: 'unused-worktree', url: undefined }`（三个工作树字段只是套件装配所需的占位，本 provider 省略工作树方法，注释写明）、`preparedChangeRequest: { ref: PR 的 ref（含 url）, headBranch: 'fixture/gamma', reviewState: 'unknown' }`、`objects: (provider) => 该 provider 账本里 operationName 不在 DEVELOPMENT_QUERIES 键里、或查询以 mutation 开头的请求`（正常恒为 `[]`；不能用全量账本，`declares()` 每次触发探针请求会让 `assertObjectsUnchanged` 误红）。
  - 「start-work-branch-lineage（录制）：按 head 分支读回 PR，头部提交与分支头相等」：照 core 的 `readHeadCommit` / `readChangeRequest` 的调用形状，`listBranches({ limit: 50 })` 找到 `fixture/gamma` 的头 X；`listChangeRequests({ headBranch: 'fixture/gamma', limit: 50 })` 的外部 id 恰为 `[PR_NODE.id]`，该项 `headBranch === 'fixture/gamma'`、`sourceVersion === X`；`getCommit(X).value.sha === X`。
  - 「start-work-branch-lineage（合成）：Start Work 分支名、标题诱饵、fork 同名分支与放宽的过滤都不混入」：`branch = branchNameFor('e1-fixture-delta')`（从 `@harness-projects/core` 导入，即 Start Work 的命名权威）。合成节点以录制的 PR 节点为模板，只改字段：目标（`headRefName: branch`、`isCrossRepository: false`、标题无关、`headRefOid: X`）、fork 诱饵（同名分支、`isCrossRepository: true`）、标题诱饵（`title: branch`、`headRefName: 'feature/other'`）、大小写诱饵（`headRefName: branch.toUpperCase()`）。两种平台模式各跑一次：「精确」只返回 `headRefName` 恰等于变量的节点（含 fork 诱饵，与公开仓库实测一致）；「忽略」返回全部节点。两种模式下结果都恰为 `[目标]`、`headBranch === branch`、`sourceVersion === X`；账本里的 `DevelopmentChangeRequests` 请求 `variables.headRefName === branch`。另断言不带过滤的列表仍返回 fork 诱饵且其 `headBranch === undefined`。
  - 「identity-shape：仓库引用用宿主配置的本地键，PR 用 node id 且与规划夹具同值，仓库 node id 不出现在任何输出」：在回放 provider 上收集 `getRepository`、`listBranches({ limit: 100 })`、`getCommit(GAMMA_HEAD)`、`getChangeRequest(PR ref)`、不带过滤的 `listChangeRequests({ limit: 100 })` 的全部返回值，`JSON.stringify` 后不含 `REPOSITORY_NODE_ID`；仓库 `ref` 深等于 `expect.repository`（这正是 `start-work.ts` 的 ack 比对与 `putRepository` 主键）；分支 `externalId === name`；提交 `externalId === sha`；PR 的 `externalId` 等于 `tests/contract/fixtures/github-projects/project-a.json` 里 `__typename === 'PullRequest'` 的内容 id（用同目录 `replay.js` 的 `loadFixture()` 读）。
  - 「review-state-projection（合成）：三种平台结论原样投影，null 与未知枚举为 unknown」：一页五个节点，`reviewDecision` 依次 `APPROVED`、`CHANGES_REQUESTED`、`REVIEW_REQUIRED`、`null`、`DISMISSED_IN_FUTURE` → `approved`、`changes_requested`、`review_required`、`unknown`、`unknown`；`getChangeRequest` 对 `APPROVED` 节点给出同一投影。
  - 「change-request-membership（合成 + 录制）：别的仓库的 PR、不是 PR 的 node 与不存在的 id 都是 not_found」：`node.repository.id` 不等于 `data.repository.id` → `not_found`；`node.__typename === 'Issue'` → `not_found`；回放的 `cr-absent` → `not_found`。
  - 「input-gates-zero-requests：坏输入在 transport 之前结构化拒绝」：外来 binding、错 `objectKind`、同 binding 另一个仓库 `externalId` → `not_found`；`limit` 为 `0`、`-1`、`1.5`、`'10'`，`cursor` 为 `''` 或 `42`，`headBranch` 为 `''` 或 `7`，`getCommit` 的 `'abc123'` 与大写 40 位十六进制，`getChangeRequest` 的空 `externalId` → `invalid_input`；全部 `retryable === false`，账本长度 0。
  - 「cursor-stall（合成）：hasNextPage 为真而游标缺失或不前进时整页 unavailable」：分支与 PR 列表各两种（`endCursor: null`；`endCursor` 等于传入游标）→ `unavailable`、`rawClass === 'malformed_response'`。
- [ ] 实现 `classify.ts`、`decode.ts`、`provider.ts`（`describeCapabilities` 本批先返回两个 key 的 capability 与 permission 都 `available` 的静态快照，Batch 3 换成探针），`index.ts` 补导出。唯一的 try/catch 在 `call` 包装里（同 planning 的 `call`）。
- [ ] 静态检查：`grep -rnE "fetch\(|process\.env|node:child_process|node:https?|node:net" packages/providers/development-github/src`（期望无输出）。

**验证**：
`node --test tests/contract/development-github-contract.test.js`（期望 `ℹ fail 0`）；
`pnpm run typecheck`（期望 exit 0）；
`pnpm run boundaries`（期望 `ℹ fail 0`）；
`node --test tests/contract/development-contract.test.js`（期望 `ℹ fail 0`，套件未改，作回归）。
**回滚**：反向本批提交；Batch 1 的夹具与查询保留。

### Batch 3 · 权限丢失降级与共享套件判定修正（验收 3）

**最小闭环**：失去读权限时快照降级、五个读方法给结构化错误；共享套件不再把「声明了但降级」误判为「未声明」。
**涉及文件**：`provider.ts`、`tests/contract/suites/development.js`、契约测试。

- [ ] 先写用例「permission-loss-degrades（录制 + 合成）：失去读权限时快照降级、五个读方法结构化失败、恢复后回到可用」（红：静态快照恒 `available`）：
  - 录制部分：以 `repository.name = ABSENT_NAME` 构造回放 provider，`getRepository` → `not_found`、`retryable === false`；`describeCapabilities()` 的两个读 key permission 为 `degraded`，`effectiveCapabilities(snapshot)` 两项 access 都是 `degraded`。
  - 合成部分：同一个 provider 实例、可切换的 transport。先接回放 → 快照 `available`。再依次切到 401（正文 message 含 canary）、无限流证据的 403、200 + `errors: [{ type: 'FORBIDDEN', message: canary }]`、200 + `INSUFFICIENT_SCOPES`、200 + `data: { repository: null }` + `NOT_FOUND`：五个读方法（输入都合法）分别返回 `permission_denied`（前四种）或 `not_found`（最后一种），`retryable === false`，`message` 等于固定文案，`JSON.stringify(results)` 不含 canary，没有任何调用抛错；每种之后快照两个 key 都是 `degraded`。最后切回回放 → 快照回到 `available`（不缓存）。
  - 控制组：403 + `x-ratelimit-remaining: '0'` → `rate_limited`、`retryable === true`（限流不被误读成权限）；transport 同步抛错 → `unavailable`、`retryable === true`。
  - canary 用 `canary-not-a-token-231`。
- [ ] 实现探针快照（`Design / Spec`「能力快照」）。此时运行契约测试，期望套件的「权限被拒与离线都是结构化失败」用例变红，失败信息含 `listChangeRequests（development.change_request.read） 未声明能力时必须报 not_supported`——这是共享套件 `declares()` 把 `degraded` 当成未声明的那条缺陷（`Surprises & Discoveries` 第 1 条）。
- [ ] 修正共享套件：`tests/contract/suites/development.js` 的 `declares()` 改为只看能力声明：`return (await provider.describeCapabilities()).capability[METHOD_KEY[method]] === 'available'`；在 87–89 行注释末尾补一句：「声明只看 `capability`：`permission` 降级（如凭据暂时失效、离线探针失败）的 provider 仍声明该能力，调用应得到真实结果或结构化失败，而不是 `not_supported`」。`accessOf` 的其余三处用法不改。

**验证**：
`node --test tests/contract/development-github-contract.test.js`（期望 `ℹ fail 0`）；
`node --test tests/contract/development-contract.test.js tests/integration/development-local-git.test.js`（期望 `ℹ fail 0`：替身六个适配器、坏适配器子进程矩阵与 Local Git 都不受影响；2026-10-15 原型在 base 上实测替身文件 88/88）。
**回滚**：反向本批两个提交（套件修正与探针快照可分别反向；只反向套件修正会让 GitHub 适配器的离线用例变红，所以套件修正的提交排在 provider 提交之前）。

### Batch 4 · 观察流（issue 范围条目：定宽可定序的 sourceVersion）

**最小闭环**：`reconcile` 产出带规范载体版本的 PR 观察，全有或全无、不抛错。
**涉及文件**：`decode.ts`（页解码同时交出 `updatedAt`）、`provider.ts`、契约测试。

- [ ] 先写用例「change-request-observations：reconcile 产出定宽规范 sourceVersion，不是 sha；全有或全无」（红：`reconcile` 未实现）：
  - 回放 provider 上 `reconcile({ scopeKey: 'development', cursor: undefined })` 收齐：条数等于不过滤页的 PR 数；每条 `type === 'development.change_request.observed'`，`subject` 深等于列表项的 `ref`，`sourceVersion === sourceVersionFromTimestamp(node.updatedAt)`、`isComparableSourceVersion(sourceVersion)`、长度 30、不等于 `headRefOid`，`eventTime === sourceVersion`，payload 的键集合恰为 `body, headBranch, headCommit, number, reviewState, state, title`。
  - 同一 provider 读两遍：`dedupeKey` 逐条相同，`receivedTime` 不同（时钟递增）。
  - 全有或全无：离线 provider；「`updatedAt: '2026-13-01T00:00:00Z'`」的合成页；两页合成扫描（第一页正常且 `hasNextPage: true`、`endCursor: 'C1'`，第二页返回 500）——三种情况收集结果都是 `[]`，迭代不抛错。第三种是变异 M20 的判别点：只有一页的录制数据分不出「失败时产出已读页」。
- [ ] 实现 `reconcile`（`Design / Spec`「观察流」），`MAX_SCAN_PAGES = 100`。

**验证**：`node --test tests/contract/development-github-contract.test.js tests/contract/capabilities-observation.test.js`（期望 `ℹ fail 0`）；`pnpm run typecheck`（exit 0）。
**回滚**：反向本批提交；读路径不受影响。

### Batch 5 · 对抗验证（独立的 Sonnet 验证者）

**最小闭环**：每条关键断言都有一个能把它变红的变异，且变异确实施加、文件按原字节还原。
**涉及文件**：只写本计划的 `Progress`、`Surprises & Discoveries` 与 `Artifacts and Notes`；spec 放 `.superpowers/review/C/mutations.json`（git 忽略）。

- [ ] 验证者不是 Batch 1–4 的实施者。先读本计划与 diff，按下表写 spec（`command` 为 `["node", "--test", "--test-timeout=120000", "tests/contract/development-github-contract.test.js", "tests/contract/development-contract.test.js"]`），每个变异给出 `anchor`（施加前确认在目标文件里恰好出现一次）、`replacement` 与 `killedBy`。
- [ ] 运行 `node scripts/review-mutate.mjs .superpowers/review/C/mutations.json --root .`。该脚本在施加前把原文按字节读进内存，锚点不是恰好一次就报 `NOT_APPLIED` 而不计存活，跑完写回并逐字节比对还原；不要用 `cp` 或 `git checkout --` 自己还原（`cp` 在本机可能停在覆盖确认上，`git checkout` 会抹掉未提交的修复）。
- [ ] 期望：全部 `KILLED` 且归因到 `killedBy`；`SURVIVED` 先补判别用例再重跑，确属等价变异的逐条写明理由；`NOT_APPLIED` 修锚点重跑。
- [ ] 另做三条手工反例（不进 spec，结论写进 `Surprises & Discoveries`）：把录制的 PR 节点改成 fork（`isCrossRepository: true`）后按分支过滤读不到；把 401 正文换成含 canary 的长文本后错误对象不含它；对 `getChangeRequest` 传一个 Issue 的 node id 得到 `not_found`。

| 变异 | 目标文件 | 改动 | killedBy（用例名片段） |
|---|---|---|---|
| M1 | `provider.ts` | 删去 `listChangeRequests` 的 `headBranch` 后过滤 | `start-work-branch-lineage（合成）` |
| M2 | `decode.ts` | `headBranch` 不看 `isCrossRepository`，恒取 `headRefName` | `start-work-branch-lineage（合成）` |
| M3 | `provider.ts` | 请求恒发 `headRefName: null`（去掉服务端过滤） | `start-work-branch-lineage（合成）` |
| M4 | `decode.ts` | 评审映射的兜底由 `unknown` 改成 `approved` | `review-state-projection` |
| M5 | `decode.ts` | 未知枚举原样小写透传 | `review-state-projection` |
| M6 | `provider.ts` 或 `decode.ts` | 删去 `node.repository.id === data.repository.id` 核对 | `change-request-membership` |
| M7 | `provider.ts` | 探针失败仍报 `available` | `permission-loss-degrades` |
| M8 | `provider.ts` | 快照缓存首次探针结果 | `permission-loss-degrades` |
| M9 | `classify.ts` | 非限流 403 判成 `unavailable` | `permission-loss-degrades` |
| M10 | `classify.ts` | 不认 `FORBIDDEN` / `INSUFFICIENT_SCOPES` | `permission-loss-degrades` |
| M11 | `classify.ts` | 错误 `message` 拼接响应正文的 message | `permission-loss-degrades` |
| M12 | `provider.ts` | `call` 包装把 transport 异常重新抛出 | `权限被拒与离线` |
| M13 | `provider.ts` | 仓库 ref 的 `externalId` 改成 `${owner}/${name}` | `identity-shape` |
| M14 | `decode.ts` | PR ref 的 `externalId` 改成 `String(number)` | `identity-shape` |
| M15 | `decode.ts` | 删去游标停滞守卫 | `cursor-stall` |
| M16 | `provider.ts` | `first` 不钳到 100 | `分支列表逐页读完` |
| M17 | `provider.ts` | 删去 `limit` 正整数闸门 | `input-gates-zero-requests` |
| M18 | `provider.ts` | 空串 `headBranch` 当作不过滤 | `change-request-filter-before-pagination` |
| M19 | `provider.ts` | 观察的 `sourceVersion` 填 `headRefOid` | `change-request-observations` |
| M20 | `provider.ts` | `reconcile` 在单页失败时仍产出已读页 | `change-request-observations` |
| M21 | `tests/contract/suites/development.js` | `declares()` 还原成 `accessOf(...) === 'available'` | `权限被拒与离线` |
| M22 | `provider.ts` | `getCommit` 不校验完整 sha | `input-gates-zero-requests` |

**验证**：`node scripts/review-mutate.mjs .superpowers/review/C/mutations.json --root .`（期望 exit 0，即全部 KILLED；有等价变异时 exit 1，逐条在 `Artifacts and Notes` 说明）；之后 `git status --short` 只显示本计划的改动（证明全部还原）。
**回滚**：不改代码；spec 在 `.superpowers/`，删掉即可。

### Batch 6 · 独立验收、重构与文档回填（Opus 验收者；提交整合与 ready 由协调者）

**最小闭环**：独立验收四条验收与范围条目，按需重构，回填文档，整合提交，PR 置 ready 并请人类伙伴评审。
**涉及文件**：本计划、`docs/exec-plan/tech-debt-tracker.md`、`docs/product/vertical-path.md`，以及验收中发现需要重构的实现文件（重构后重跑 Batch 5 整表）。

- [ ] 验收者先锁定 head 与 base，逐条对照 `Validation and Acceptance` 复跑证据；读 diff 找 dead code 与可简化处（例如与套件重复的断言、只被一处使用的辅助函数）；任何行为改动都要先有能失败的用例。重构后在**最终树**上整表重跑 Batch 5 的 spec（修复本身也要独立复评）。
- [ ] 重录可复现性（只读，需要 `gh` 登录开发账号）：时间窗规则同 Batch 1（不得与 S-AB Phase 2 重叠，起止时刻写进 `Progress`）。把录制程序输出到 `.superpowers/recording/sandbox.rerecord.json`，与已提交夹具比较，期望只有 `recordedAt` 不同。还有别的差异时，先对照协调者的 S3 记录（含 Phase 2 对 `issue-writable` 的编辑与还原时刻），确认差异与它无关之后才定性为沙箱漂移并记入 `Surprises & Discoveries`；最可能独立变动的是 `repository.updatedAt`，pr-gamma 的字段按 Phase 2 的设计不应变化。网络或凭据不可用就记为「跳过」并写明原因，不算通过。
- [ ] 手工把 TD-061..064 插入 `docs/exec-plan/tech-debt-tracker.md` 的 Open 表，位置按 `Global Constraints` 的「跨 PR 共享文件协议」（内容见 `Outcomes & Retrospective` 的技术债候选；列为 ID、日期、状态、ExecPlan、子系统、分支、记录者、简述、延期理由、遗留影响、下一步）。
- [ ] `docs/product/vertical-path.md` §2.1 第 9 行「承接」格 `#235（被 #231 #204 阻塞）` 之后就地追加 `（Superseded by <本批执行当天的本地日期，YYYY-MM-DD 形式>（#231）：GitHub Development 只读 provider 已交付，#235 仍被 #204 阻塞）`，尖括号部分写成实际日期。
- [ ] 全量门禁（见 `Validation and Acceptance` 末表）。
- [ ] 协调者整合提交（先 `git branch backup/github-development-read-<YYYYMMDD-HHMM>` 建恢复锚点）：
  1. `docs(exec-plan): 编写 GitHub Development 只读 provider 计划`（本计划与 `docs/README.md` 一行）；
  2. `test(contract): 共享 Development 套件按能力声明判定可选方法`（只有 `tests/contract/suites/development.js`；必须排在提交 3 之前，它是人类门 HC1 的评审对象，可单独反向）；
  3. `feat(providers): 经 GitHub Development provider 读取 PR 与分支谱系`（`packages/providers/development-github/src/**`、夹具、契约测试）；
  4. `docs: 回填 GitHub Development 只读计划的验收证据与技术债`（本计划回填、tracker、vertical-path）。
  每个提交正文说明为什么，末尾 `Refs #231` 与 `Co-Authored-By` 行。整合后用 `comm` 比对整合前后 head 的文件集合（期望相同），`git diff <backup> HEAD` 期望为空；`git log --format=%B origin/main..HEAD | grep -nE '^#'` 期望为空（重放会吃掉 `#` 开头的行）。
- [ ] 并集验证（协调者，置 ready 前；D17）：在一次性并集工作树 `.worktrees/round6-union`（分支 `test/round6-union`，永不推送）合并 `main` + B（含 A）+ 本 PR + D 的当前 head，运行 `Validation and Acceptance` 末表的两条「并集」命令；各 head sha、观察时刻与读数写进 `Progress`。任一失败先定位归属，属兄弟 PR 的报给其 owner，不在本分支替别人修。
- [ ] 推送用精确的 `git push --force-with-lease=feature/github-development-read:<旧远端 sha>`；回读 head、base、checks、`closingIssuesReferences` 与 review threads；`gh pr checks <n> -R SingularityKChen/harness-projects`（期望 `PR Fast Gate` pass）后 `gh pr ready <n> -R SingularityKChen/harness-projects`，再在对话里请人类伙伴评审（PR 由开发账号开出，GitHub 不能向作者本人发评审请求）。合并由人类决定（rebase merge）。

**验证**：见 `Validation and Acceptance`。
**回滚**：`git reset --hard backup/github-development-read-<YYYYMMDD-HHMM>`（仅在本地分支、推送前）；已推送后用新提交修正，不改写已被评审引用的历史。

## Validation and Acceptance

| # | 验收项（issue #231） | 判定证据 | 强度 |
|---|---|---|---|
| 1 | Start Work 分支上开的 PR 按 head 分支找到并挂到该分支，从不按标题 | 「start-work-branch-lineage（录制）」：真实平台对 `headRefName: 'fixture/gamma'` 的回答经 core 同形调用得到唯一 PR，`sourceVersion` 等于分支头、`getCommit` 读回同一提交。「start-work-branch-lineage（合成）」：分支名由 core 的 `branchNameFor` 派生，标题诱饵、fork 同名分支、大小写诱饵在「精确」「忽略过滤」两种平台模式下都不混入，请求只带 `headRefName` 过滤。变异 M1–M3 | S2（录制回放 + 合成叠加）。core 端到端挂谱系由 #233 验收 1 的录制夹具用例承接 |
| 2 | 契约套件在录制夹具上不联网通过 | 套件装配用回放 transport，未命中即 reject；「replay-ledger」断言未命中为空；「provenance」「query-drift」防夹具失真；provider 源码无网络 API（grep 无输出） | S2 |
| 3 | 失去读权限得到降级能力，而不是裸平台错误 | 「permission-loss-degrades」：录制的仓库不可见回答 + 合成的 401 / 403 / `FORBIDDEN` / `INSUFFICIENT_SCOPES` / `NOT_FOUND`，五个读方法结构化失败、固定文案、无 canary、不抛错；快照两个读 key 为 `degraded`、`effectiveCapabilities` 为 `degraded`，恢复后回到 `available`。变异 M7–M12、M21 | S2（NOT_FOUND 形状为录制，其余合成）。宿主内真实吊销属 #143 的 S3 |
| 4 | provider node id 不成为本地主键 | 「identity-shape」：仓库 ref 用宿主配置的本地键（`start-work.ts` 把它写成主键并比对 ack），仓库 node id 不出现在任何输出；PR 的 `externalId` 是 node id 且与规划夹具同值，core 只把它放进哈希槽位（`chain-facts.ts` 245–249 行、`delivery-facts.ts` 102 行）。变异 M13、M14 | provider 层 S2；core 主键派生是既有代码（S1 引用）；端到端存储扫描建议随 #233 验收 1 |
| 范围 | 定宽可定序 sourceVersion 的观察 | 「change-request-observations」：30 字节规范载体、不是 sha、去重键稳定、全有或全无。变异 M19、M20 | S2 |

全量门禁（Batch 6，在检出 `feature/github-development-read` 的工作树根目录）：

| 命令 | 期望 |
|---|---|
| `pnpm install --frozen-lockfile --offline` | exit 0，锁文件无变化 |
| `pnpm verify` | typecheck 通过；contract / integration / e2e 与 MVP-0 全部 `fail 0` |
| `pnpm run boundaries` | `ℹ fail 0` |
| `node scripts/workflow-check.mjs` | 无 findings |
| `node scripts/rule-checks.mjs disclosure origin/main` | 无命中 |
| `node scripts/rule-checks.mjs size origin/main` | 代码 ≤ 800、文档 ≤ 1300（读数写进 `Outcomes & Retrospective` 时标观察时刻与 head） |
| `git diff --check origin/main...HEAD` | 无输出 |
| `node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js` | `ℹ fail 0` |
| ExecPlan 技能自带的 `scripts/lint_execplan.py docs/exec-plan/active/2026-10-15-github-development-read.md` | `OK` |
| `node scripts/review-mutate.mjs .superpowers/review/C/mutations.json --root .` | 最终树上全部 KILLED（或等价变异逐条说明） |
| 并集（协调者，在 `.worktrees/round6-union` 根目录；置 ready 前一次，每次合并前对 `main` 加全部仍开着的 head 再一次）：`pnpm install --frozen-lockfile --offline && pnpm verify && pnpm run boundaries` | 全部 exit 0 |
| 并集上点名复跑：`node --test --test-timeout=120000 tests/integration/development-local-git.test.js tests/contract/development-contract.test.js tests/integration/harness-plugin-host-providers.test.js`（最后一个文件随 A 进入并集；A 已合并后它在 `main` 上） | `ℹ fail 0`，三个文件名与读数分别写进 `Progress` |

**人类门**（协调者用一句可批准陈述直接问人类伙伴；问题原文、时刻与答案写进 `Decision Log`；他会话转述不算）

- HC1：共享 Development 套件的 `declares()` 改为只看 `capability`（D3；`test(contract)` 单独提交，排在 provider 提交之前）。这是对所有 Development 适配器生效的契约改动，PR 正文的人类门段落点名请评审者确认。否决时 agent 不自行改道：验收 3「degraded capability」的解释（保持 `degraded` 并换一种套件适配，还是改报 `unavailable` 让 core 读门直接拒绝）交人类伙伴裁定，按裁定改本计划后再继续。
- 常设：不写 Project `Status`、blocked-by / blocking；是否合并、何时合并由人类伙伴决定（rebase merge）。

## Progress

- [x] 2026-10-15 10:30 +08 设计完成：三份独立设计（契约夹具优先、GitHub API、身份与最小化）经独立评审收敛为本计划；关键事实已用只读 GraphQL 与原型核实（`Surprises & Discoveries` 第 1–5 条），决策见 `Decision Log` D1–D14。
- [x] 2026-10-15 10:45 +08 跨 PR 整合评审修订：宿主目录条目交接与 A 的 local-git 条目对齐（D15）、共享文件协议（D16）、不入栈与合并次序（D17）、沙箱录制时间窗（D18）、规模重估约 690（D19）、人类门 HC1（D20）；未改任何已跟踪文件。
- [ ] Batch 0 · 计划、draft PR 与关联
- [ ] Batch 1 · 查询文本与只读录制（夹具先行）
- [ ] Batch 2 · 读路径：分支谱系与身份
- [ ] Batch 3 · 权限丢失降级与共享套件判定修正
- [ ] Batch 4 · 观察流
- [ ] Batch 5 · 对抗验证（变异表）
- [ ] Batch 6 · 独立验收、重构与文档回填；整合提交、ready、请求人类评审
- [ ] 评审之后（不在本轮）：处置评审意见 → 修复的独立复评 → 归档本计划到 `docs/exec-plan/completed/` 并更新 `docs/README.md` → 整合提交 → 勾选 #231 验收；合并由人类伙伴决定。

## Surprises & Discoveries

1. 2026-10-15：**共享套件把「声明了但降级」判成「未声明」**。`tests/contract/suites/development.js` 的 `declares()` 用 `effectiveCapabilities`（capability ∩ permission）。原型：一个只读、探针失败即 `degraded` 的最小 provider 跑未修改的套件，13 条用例 1 红，红在「权限被拒与离线」，信息为 `listChangeRequests（development.change_request.read） 未声明能力时必须报 not_supported`；`declares()` 改为只看 `capability` 后 13/13 通过，且同一改动下 `tests/contract/development-contract.test.js` 仍 88/88（base 21cb29eb）。复现：把套件、`development-contract.test.js` 与 `tests/fixtures/development-suite-adapters.mjs` 复制到 `.superpowers/` 下的同构目录，只改 `declares()` 一行后运行。处置见 D3。
2. 2026-10-15：**`gh api graphql` 在响应带 `errors` 时退出 1，但 stdout 仍是完整正文**（`node(id: "cr-absent")` 实测：`{"data":{"repository":{…},"node":null},"errors":[{"type":"NOT_FOUND",…}]}`，exit 1）；`object(oid: 全零)` 返回 `null`、不带 errors、exit 0。照搬 planning 录制程序的 `execFileSync` 会在第一条 NOT_FOUND 处中止。录制程序因此用 `spawnSync`，只录「非零退出但正文带非空 errors」的回答。
3. 2026-10-15：五段查询文本对沙箱只读执行全部通过 schema 校验：仓库 `defaultBranchRef.name = main`；`refs first:1` 首页 `hasNextPage: true`、游标 `MQ`；`fixture/gamma` 头部提交的 `messageHeadline` 为 `fixture gamma`；`headRefName: 'fixture/gamm'`（去尾）返回空页且 `endCursor: null`；`DevelopmentChangeRequest` 返回仓库 id 与 PR 节点；`<repo>-absent` 返回 `repository: null` + `NOT_FOUND`，message 带 owner/name（所以错误文案必须固定，不能透传）。
4. 2026-10-15：**`pullRequests(headRefName:)` 是精确过滤，但会带出 fork 上同名分支的 PR**。公开仓库 cli/cli 实测：`headRefName: "trunk"` 共 183 条，前 20 条里 18 条 `isCrossRepository: true`；`"TRUNK"`、`"tru"`、`" trunk"` 都是 0 条。GitHub 官方 CLI 的 `PullRequestForBranch` 也是先按 `headRefName` 取再在客户端按 head 仓库筛。所以后过滤必需，且后过滤会让分页出现短页甚至空页（端口允许；对 core 首页读取的影响交 #233，见 `Interfaces and Dependencies`）。
5. 2026-10-15：GraphQL schema 自省：`PullRequest.headRefName` / `headRefOid` 的描述都是「even if the ref has been deleted」（合并后删分支，谱系仍可按分支名找回）；`PullRequestReviewDecision` 只有 `APPROVED`、`CHANGES_REQUESTED`、`REVIEW_REQUIRED` 三值；`Repository.pullRequests` 的 `headRefName` 参数描述为「The head ref name to filter the pull requests by」；`first: 101` 报 `EXCESSIVE_PAGINATION`。
6. 2026-10-15：沙箱 pr-gamma 的 `reviewDecision` 为 `null`（沙箱没有必需评审的分支保护），录制数据只能证明 `unknown` 这一档；三个非 `unknown` 值只能由合成用例覆盖。
7. 2026-10-15：并行 PR A 的三份设计都把 `development.github` 工厂条目留作跟进层，本轮宿主里没有本 provider 的入口，所以本 PR 没有可做的 Desktop 宿主观察。

## Decision Log

以下 D1–D14 都是 2026-10-15「协调者按人类授权调研后决定，人类可推翻」；D15–D20 是同日跨 PR 整合评审提出、本计划维护者逐条对照代码与 A、B、D 三份计划核实后采纳（部分理由修正写在条目内），同样人类可推翻。

- **D1 只用 GraphQL**。REST 列表的 `head` 必须是 `user:ref`、`state` 默认 `open`、没有评审结论，只能从评审列表反推（端口 44–49 行禁止）；search 的 `head:` 是前缀匹配。GraphQL 的 `reviewDecision` 与端口三值一一对应，`headRefName` 精确过滤，一次请求拿到 `isCrossRepository`、`headRefOid` 与 node id，transport 与 planning 同形。代价：分类器与 planning 重复（TD-061）。
- **D2 快照用探针，任何失败都报 `degraded`**。三种候选：静态 `available` + 宿主注入（delivery）、权限失败报 `unavailable`（planning）、失败报 `degraded`。选第三种：验收 3 的原文就是「degraded capability」；快照只在组合时采一次，`degraded` 让 core 仍放行读，provider 的结构化 `permission_denied` 成为缺口原因，补授权后无需重新组合就恢复；`unavailable` 会被 core 翻成 `NotSupported`，ui-model 的变更请求谱系入口也只在 `unavailable` 时阻断（`packages/ui-model/src/capability-access.ts` 的 `LINEAGE_KEYS` 与 `decide`：读用途下 `degraded` 仍可用并带原因）。GitHub 对无权访问的私有资源回答 404/NOT_FOUND，撤权与删库无法区分，所以 `not_found` 同样降级。离线探针失败也报 `degraded`（权限无法确认时不声称可用）。代价：与 planning 的映射不一致、快照不随运行期变化（TD-062）。
- **D3 修正共享套件的 `declares()`，只看 `capability`**。套件文件头已声明「只建模能力声明，不建模 permission 与 degraded」，代码却用了交集；原型证明修正后既有六个替身适配器与坏适配器矩阵不变（`Surprises & Discoveries` 第 1 条）。放弃「让适配器在离线场景伪造探针成功」。这是对所有 Development 适配器生效的契约改动，PR 正文点名请评审确认；改动单独成一个 `test(contract)` 提交，排在 provider 提交之前。
- **D4 夹具先行、直接录查询文本**。录制程序发送 `DEVELOPMENT_QUERIES` 原文而不经 provider，录下的是平台的回答而不是实现的回声；实现之后在严格回放上开发到零未命中（VCR `:none` 模式对新请求报错的做法）。故障与叠加属合成，用例名标「合成」，不混进录制夹具。放弃录制本公开仓库（不是沙箱，失去与规划夹具共享的 PR 身份）。
- **D5 游标原样透传，加停滞守卫**。planning 先例；端口把换 scope 规定为调用方义务；delivery 的 scope 编码多约 15 行，没有对应风险。
- **D6 分支归属只认「同仓库 + 字节相等」**。`headBranch = isCrossRepository === false ? headRefName : undefined`，过滤后只保留 `item.headBranch === 过滤值`。fork PR 在不带过滤的列表里照常出现（它确实是本仓库的 PR），只是没有分支身份。不对「平台返回了不等的同仓库分支」整页报错：单一谓词更简单，结果同样正确。
- **D7 PR 列表按 `CREATED_AT DESC`**。与 GitHub 官方 CLI 一致；core 只读首页取第一个匹配，倒序让最新 PR 落在首页。创建时间不可变，游标遍历仍恰好枚举一次。
- **D8 仓库按 owner/name 寻址，`ref.externalId` 用宿主配置的本地键**。`start-work.ts` 把 `repositoryId` 写成仓库主键并比对 ack，所以它不能是 node id。按 node id 寻址能抵抗改名或同名重建，但需要宿主额外配置仓库 node id，属 #127（绑定仓库）的职责；记 TD-064。不用前缀嗅探在构造期拒绝「看起来像 node id」的键（「不解析 id 前缀」是 planning 已确立的原则）。
- **D9 PR 身份用 GraphQL node id**。Gate E1 的外部身份是「平台 + 种类 + node id」（`docs/architecture/gate-e1-content-identities.md`），它与规划 provider 对同一 PR 给出的内容 id 相同，#233 才能把「按分支找到的 PR」与「PR 型项目条目」归一。
- **D10 实现 `reconcile`，不收窄 issue 范围**。issue 的 In-scope 明列「Observations with an orderable `sourceVersion` in fixed-width form」；#233 验收 4（重复与乱序观察收敛到一条谱系）是具名的下一个消费者，若本 PR 不做，#233 只能跨所有权改 provider 包。成本约 30 行实现 + 35 行测试，不需要新录制。形态沿用 planning 的 R5 全量、全有或全无。增量游标与扫描上限的取舍交 #233（TD-063）。另两份设计主张推迟并请人类批准收窄范围；本决定使本 PR 不需要任何范围变更批准。
- **D11 不写沙箱**。外部写入需要点名批准；provider 对分支名是不透明字节，`work/<slug>` 与 `fixture/gamma` 在 provider 上没有可观察差异。Start Work 命名由合成用例经 core 的 `branchNameFor` 派生；真实 Start Work → PR 的链路属于 #143 的 S3 走查。
- **D12 不在本 PR 写 core 级谱系集成测试**。录制夹具上的 `WorkItem → … → PR → CI` 正是 #233 验收 1；在这里做要伪造执行上下文（约 80 行），且与 #233 重叠。验收 1、4 的 provider 部分在本 PR 完整关闭，core 部分写成对 #233 的交接。
- **D13 提交消息取 `messageHeadline`**。与 Local Git 的 `git log -1 --format=%s` 同义；端口字段 `message` 只服务展示。
- **D14 分类器复制一份，`requestId` 加形状校验**。provider 之间不得 import，抽共享包需要 ADR 与边界改动；`requestId` 校验采用 delivery 的 `REQUEST_ID`，防止 token 形态的头值进入结果（TD-061 记录两份分类器的分歧）。
- **D15 宿主目录条目交接与 A 的 local-git 条目对齐**。配置字段名取 `repositoryExternalId`（与 A 的 `development.local-git` 条目同名同约束，值是工作区 `repositoryId` 本地键）、`repositoryOwner`、`repositoryName`；transport 直接用 A 的 `githubGraphqlTransport(fetch, credential)`；句柄用 A 的宿主常量 `HARNESS_PROJECTS_GITHUB_TOKEN`。核实：A 计划的 `development.local-git` 条目确用 `repositoryExternalId`，planning 条目以 `githubGraphqlTransport(fetch, credential)` 构造；planning 的 `transport.ts` 三个类型与本包设计逐字同形，结构类型下无需适配层；`bindingId` 必填与导出 `GITHUB_DEVELOPMENT_DEFINITION` 已满足 A 的请求（命名与 delivery 的 `GITHUB_ACTIONS_DEFINITION` 同式）。组合期探针：core 的 `collectBindings` 逐个 `await` 快照（`packages/core/src/registry.ts` 123–126 行），所以本 provider 的仓库探针串行加在首轮触网上，计入 A 的 TD-056。本 PR 不写 `apps/**`，交接全文在 `Interfaces and Dependencies`。
- **D16 共享文件协议**。采纳协调者的整合裁定（`Global Constraints`）。替换原先的「Active 表首行」与「Open 表末尾」：原写法只给位置、不给冲突解法，四个 PR 写同一位置必然冲突，「各留各行」之后的次序取决于合并次序（例如 D 先合并时本 PR 的 TD-061..064 会落在 TD-065 之后）。协议保留「分隔行正下方」，再规定 2026-10-15 各行按计划文件名排序、TD 行按编号就位，冲突解法因此与合并次序无关、可机械核对。
- **D17 不入栈；C、D 与 A/B 互不依赖，推荐合并次序 C → D → A → B**。核实：本 PR 与 A、B、D 没有共享代码文件（共享的只有两个索引文档），B 堆叠在 A 上的三条理由（B 的 S3 需要 A 的目录、B 的集成测试调用 A 改签名的 `createHostComposition`、B 的 S3 证据要在含 A 的 head 上取）都与本 PR 无关；本 PR 没有 S3，最可能先 ready。合并前四步与合并后回读写在 `Interfaces and Dependencies`。部分理由修正：评审要求在并集上点名复跑 A 的 `tests/integration/harness-plugin-host-providers.test.js`，理由是「`declares()` 改动对每个 Development 适配器生效」——该文件不导入共享套件，`declares()` 不能直接影响它；接受这条复跑，价值改记为「确认本 PR 与 A 的目录、local-git 条目在并集上共存」（它本就在 `pnpm verify` 的 integration 层内，点名是为了按文件留读数）。另两条（`development-local-git.test.js`、`development-contract.test.js`）确实导入共享套件，理由成立。
- **D18 沙箱录制时间窗**。Batch 1 录制与 Batch 6 重录都不得与 S-AB Phase 2 的人类沙箱编辑重叠。核实：Phase 2 改的是 `issue-writable`（#3，`docs/architecture/gate-e1-sandbox.md` 登记为 E1-3 的字段写入夹具）的 Project A 字段，本包五段查询不读 Project 条目与 issue，按设计不受影响；但录制含 `repository.updatedAt`，平台对它的推进规则未实测，重叠时差异来源不可判别。规则成本只是一次与协调者的时间确认，所以采纳；重录出现 `recordedAt` 以外的差异时先对照协调者的 S3 记录再定性。
- **D19 规模重估约 690**。原估 610 把 provider 估为 145、decode 80、契约测试 265，偏乐观：planning 的 `provider.ts` 实为 153 行而本包多一个读方法、探针快照与 `reconcile`；decode 要同时服务 list / get 两面与观察流的 `updatedAt`；契约测试有九组用例加套件装配。重估后实现约 360、测试约 330。仍低于 760 的收缩触发线与 800 的规划上限，单 PR 不变；收缩顺序不变（`Plan of Work`）。
- **D20 共享套件改动设人类门 HC1**。`declares()` 改动对全部 Development 适配器生效，属契约语义，评审者确认是合并前置；保持它单独成一个 `test(contract)` 提交且排在 provider 提交之前，让评审者能单独审这一处契约改动，也让「只反向 provider、保留套件修正」成立。只反向套件修正会让本 provider 的离线用例变红（Batch 3 回滚注），所以否决不能靠单独反向解决：否决时验收 3 的解释交人类伙伴，agent 不自行在「改快照语义」与「改套件」之间二选一（见 `Validation and Acceptance` 末段）。

### 调研依据

- REST「List pull requests」：`head` 的格式为 `user:ref-name` 或 `organization:ref-name`，`state` 默认 `open`，响应没有评审结论字段。https://docs.github.com/en/rest/pulls/pulls#list-pull-requests
- GitHub GraphQL schema 自省（2026-10-15，`gh api graphql` 查询 `__type(name: "PullRequest")`、`__type(name: "Repository")`、`__type(name: "PullRequestReviewDecision")`）：见 `Surprises & Discoveries` 第 5 条。参考页 https://docs.github.com/en/graphql/reference/pulls
- GitHub 官方 CLI 的分支到 PR 解析：`pullRequests(headRefName:, states:, first: 30, orderBy: { field: CREATED_AT, direction: DESC })`，再在客户端按 head 标签匹配。https://github.com/cli/cli/blob/trunk/pkg/cmd/pr/shared/finder.go
- GitHub 对未授权访问私有资源返回 404 而非 403，以免确认资源存在。https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api
- VCR `:none` 录制模式：任何新请求都报错。https://raw.githubusercontent.com/vcr/vcr/master/features/record_modes/none.feature
- OpenShift ClusterOperator 条件：`Degraded` 表示服务质量降低且组件可以同时 `Available`；`Available=False` 表示部分不可用、需要立即人工介入。https://raw.githubusercontent.com/openshift/api/master/config/v1/types_cluster_operator.go
- 只读实测（2026-10-15）：公开仓库 cli/cli 的 `headRefName` 过滤行为与 `first: 101` 的 `EXCESSIVE_PAGINATION`；E1 沙箱的清单与五段查询的回答；`gh` 在 GraphQL errors 时的退出码。见 `Surprises & Discoveries` 第 2–5 条。

## Idempotence and Recovery

- **录制可重复**：录制程序只读，重跑覆盖夹具；先 `git diff tests/contract/fixtures/github-development/sandbox.json` 再决定是否提交。重录后 provenance 用例会提醒登记新 id，查询文本变了 drift 用例会提醒重录。沙箱清单被别的批次改动时，按 Batch 1 的回读命令先确认再录。录制与重录都先向协调者确认不与 S-AB Phase 2 的人类沙箱编辑重叠（D18）。
- **测试无副作用**：契约测试只用回放与合成 transport，不触网、不写文件，可任意重复。
- **变异**：`scripts/review-mutate.mjs` 以内存原文按字节还原，被信号中断也同步还原；结束后 `git status --short` 核对。夹具自身报错（exit 2）时结论不可用，修 spec 后重跑。
- **会话中断**：每批结束先本地 WIP 提交；`.superpowers/` 下的录制程序与 spec 会随会话清空，本计划里有它们的全文或生成规则，可重建。
- **回到已知良好状态**：本地分支在推送前可 `git reset --hard <批次提交>`；整合提交前先建 `backup/github-development-read-<YYYYMMDD-HHMM>`，整合出错时 `git reset --hard` 回到它。已推送分支只用精确的 `--force-with-lease` 覆盖，覆盖前回读远端 sha。
- 本 PR 没有迁移、没有数据库写入、没有外部写入；整体回滚即反向合并提交（rebase merge 后逐个反向四个提交，或只反向 `feat(providers)` 提交——套件修正对既有适配器无行为变化，可以留下）。

## Artifacts and Notes

- 录制程序全文：`Concrete Steps` Batch 1（不提交脚本，计划即其持久副本）。
- 变异 spec：执行期在 `.superpowers/review/C/mutations.json`；Batch 6 把最终树上整表重跑的 spec 全文（JSON，缩进代码块）与读数追加到本节，使其可重放。
- 设计期原型与三份设计稿在 `.superpowers/design/C/`（git 忽略，不是证据来源；证据以本计划的命令与读数为准）。

## Interfaces and Dependencies

- **外部工具与凭据**：录制与重录需要 `gh` 已登录开发账号并能读私有沙箱；不读任何凭据文件。测试与 CI 不需要凭据、不触网。Node 26（`package.json` 要求 ≥ 22）、pnpm 10.28.2（`packageManager` 钉定）。
- **宿主目录条目交接（D15；承接层：#233 或后合并者，A 的 TD-054；本 PR 不写 `apps/**`）**：与 A 的 `development.local-git` 条目同形，写在 A 的 `apps/harness-plugin/src/host-providers.ts` 里。
  - 实现键 `development.github`；条目的 `definition` 取本包导出的 `GITHUB_DEVELOPMENT_DEFINITION`（`domains: ['development']`）。
  - 配置 schema 三个字段，经 A 的 `text(configuration, name)` 读取：`repositoryExternalId`（与 local-git 条目同名同约束：string、必填、pattern `[^\s]+`、maxLength 200；值是工作区的 `repositoryId` 本地键，core 把它写成仓库主键并比对 ack，**绝不是** GitHub node id，D8）；`repositoryOwner`、`repositoryName`（只用于平台寻址；pattern 与长度由承接层按 GitHub 命名规则定）。
  - 账号规则同 A 的 planning 条目：`platformOrigin === 'https://github.com'` 且带 `secretHandle`，否则 `BindingRefused(not_supported, …)`；句柄是宿主常量 `HARNESS_PROJECTS_GITHUB_TOKEN`（A 的 D9，不另起名字）。
  - 构造：`createGithubDevelopmentProvider({ bindingId: binding.id, repository: { externalId: repositoryExternalId, owner: repositoryOwner, name: repositoryName }, transport: githubGraphqlTransport(fetch, credential) })`。`bindingId` 保持必填、不默认随机；transport 直接复用 A 的 `githubGraphqlTransport(fetch, credential)`：本包的 `GraphqlRequest` / `GraphqlResponse` / `GraphqlTransport` 与 planning 的 `transport.ts` 结构逐字同形，同一个函数可同时赋给两边。鉴权、`redirect: 'error'` 与 30 s 超时都在那个 transport 里，本 provider 不加。
  - 组合期探针：core 的 `collectBindings` 逐个 `await` 每个挂载的 `describeCapabilities()`，本 provider 每次快照发一条 `DevelopmentRepository` 请求。它不抛错（失败报 `degraded`），但在 typed remote 注册前触网、串行累加，最坏每个挂载把 host ready 推迟约 30 s。这是 A 的 TD-056「首轮水合在 typed remote 注册前触网」的增量，由承接层在 TD-056 那一行补记（本 PR 不改 A 的行）。
  - 在 #297 合并前不要把本 provider 与 Local Git 同时挂到一个工作区：两个 Development 挂载时 key 级解析 fail closed，谱系的提交与 PR 两跳会退化成缺口。
- **#233（谱系同步）**：消费 `listChangeRequests({ headBranch })`、`listBranches`、`getCommit` 与 `reconcile`。建议：变更请求查找像分支查找一样有界翻页直到找到（后过滤可能产生短页，见 `Surprises & Discoveries` 第 4 条）；在录制夹具谱系用例里加一条「实体、关系端点与仓库行的主键都不等于任何 provider node id」的存储扫描；用 PR node id 与规划的 PR 内容 id 归一（本 PR 的 identity-shape 已证明二者逐字相同）。
- **D（#280，Harness 会话观察）**：会话若把分支推到 fork 再开 PR，本 provider 会给出 `headBranch: undefined`，谱系找不到它；D 的记录宜写明会话推送到哪个远端。
- **#127 / #297**：仓库 node id 固定（TD-064）与按仓库路由。
- **共享文档**：`docs/README.md` 的 Active 表与 `docs/exec-plan/tech-debt-tracker.md` 的 Open 表，本轮 A、B、D 也会写；插入位置与冲突解法见 `Global Constraints` 的「跨 PR 共享文件协议」。
- **合并次序与栈（D17）**：
  - 本 PR 与 D 都不入栈，各自从 `main` 分支。B 原生堆叠在 A 上（深度 2；A 的 H2 被否决时是 A0 → A → B，深度 3），与本 PR 无关。C、D 与 A/B 互不依赖，各自门禁满足即可合并，可以插在 A/B 之间任意位置；推荐次序 C → D → A → B。
  - 每次合并前（协调者准备；是否合并由人类伙伴决定）：① 把本 PR rebase 到当前 `main`（strict 保护下每次合并都会让其余 PR 变 BEHIND）；② 按共享文件协议解决 `docs/README.md` 与 tracker 的冲突；③ 在并集工作树对 `main` 加全部仍开着的 head 重跑 `pnpm verify`（`Validation and Acceptance` 末表的并集行）；④ 回读 `closingIssuesReferences`（期望含 231）。rebase 改变了 head 时重新回读 checks。
  - 合并后回读被关闭 issue 的 state：`gh issue view 231 -R SingularityKChen/harness-projects --json state,closedByPullRequestsReferences`（期望 `CLOSED` 且含本 PR）。
- **宿主会话窗口（协调者主会话，串行两个）**：S-D（D 的 Batch 3，先跑）与 S-AB（A 的 AC8 / AC9、B 的 AC1）。本 PR 不在任何窗口里，只受一条约束（D18）：Batch 1 录制与 Batch 6 重录都不得与 S-AB Phase 2 的人类沙箱编辑重叠——人类改 `issue-writable`（#3）的 Project A `Status` 或 `E1 Text`，经引导观察 watch delta，再由人类还原并引导一次；Phase 2 的目标按设计从不碰 pr-gamma、issue-alpha、draft-beta。S-AB 前置 H5 由人类在 Desktop 凭据存储配置 `HARNESS_PROJECTS_GITHUB_TOKEN`，那正是本 provider 承接条目将来使用的句柄；该令牌对沙箱仓库内容与 PR 的读权限不在本轮验证，属承接层 S3（#233、#143）。agent 不读、不打印令牌值或带令牌的 URL。

## Outcomes & Retrospective

（实施后回填：实际规模读数与观察时刻、与计划的偏差、变异整表结果、遗留问题。）

技术债候选（Batch 6 手工插入 `docs/exec-plan/tech-debt-tracker.md`，位置见 `Global Constraints` 的共享文件协议；子系统均为 `packages/providers/development-github`，分支 `feature/github-development-read`）：

- **TD-061**：GraphQL 失败分类在 `planning-github-projects/src/classify.ts` 与本包 `classify.ts` 各一份，且本包多了 `requestId` 形状校验。延期理由：provider 之间不得 import，抽共享包需要 ADR 与边界改动。影响：一处修正分类（例如新的限流形态）时另一处可能漏改。下一步：出现第三个 GitHub GraphQL provider 或分类需要改动时，写 ADR 决定共享包或接受重复，并让 planning 也校验 `requestId`。
- **TD-062**：能力快照语义两处不一致且只在组合时采一次：本包把任何探针失败报 `degraded`，planning 把 `permission_denied` / `not_found` 报 `unavailable`；探针只读仓库，只缺 PR 权限的凭据要到单次调用才暴露。延期理由：快照刷新由宿主生命周期负责（#132 / #335），统一 planning 的映射会改变它的既有行为。影响：同一个失效凭据在规划与研发两域显示不同的能力状态；运行期失去权限只体现在调用结果与缺口上。下一步：宿主提供快照刷新时统一两域映射，并按需要把探针扩展到 PR 读。
- **TD-063**：观察流是有界全量扫描（≤ 100 页），忽略 `scope.cursor`，超限一条不产出；`updatedAt` 是秒级，评审结论变化是否推进 `updatedAt` 未实测，相同版本按 R4 走整快照替换。延期理由：目前没有消费者，增量协议应由第一个消费者（#233）定义。影响：超大仓库没有观察；同秒变化依赖去重键而非版本区分。下一步：#233 消费观察时定义水位线协议，并做一次评审结论变化与 `updatedAt` 的只读实测。
- **TD-064**：仓库按 owner/name 寻址，没有固定仓库 node id；改名、转移或删除后同名重建时，provider 会读到另一个仓库或报 `not_found`。延期理由：固定 node id 需要宿主在绑定仓库时取得并保存它，属 #127。影响：同名重建的仓库可能被当作同一个仓库读取（分支名与 sha 相等的巧合下才会误挂谱系）。下一步：#127 绑定仓库时保存仓库 node id，provider 增加可选的 `repository.nodeId` 核对（不一致即 `not_found`）。

## Bottom Change Note

- Change Note (2026-10-15)：创建本计划。三份设计（契约夹具优先、GitHub API、身份与最小化）经独立评审收敛：采纳 GraphQL、夹具先行录制、探针快照报 `degraded`、修正共享套件 `declares()`、实现 `reconcile`、不写沙箱、不做 core 级集成测试；规模估计代码约 610、文档约 650，单 PR 不分栈。
- Change Note (2026-10-15 10:45 +08)：跨 PR 整合评审修订，逐条对照代码与 A、B、D 计划核实后全部采纳，只修正一条理由（D17：点名复跑 A 的 `harness-plugin-host-providers.test.js` 的价值是并集共存，不是 `declares()` 的影响面）。改动：`Interfaces and Dependencies` 写明 `development.github` 目录条目交接（`repositoryExternalId` / `repositoryOwner` / `repositoryName`、A 的 `githubGraphqlTransport`、句柄 `HARNESS_PROJECTS_GITHUB_TOKEN`、组合期探针计入 A 的 TD-056；D15）；`Global Constraints` 新增跨 PR 共享文件协议，Active 行插在分隔行正下方、冲突时按计划文件名排序，TD-061..064 按编号就位（D16）；新增不入栈与合并次序 C → D → A → B、合并前四步与合并后回读、宿主会话窗口（D17）；Batch 1 录制与 Batch 6 重录不得与 S-AB Phase 2 重叠（D18）；Batch 6 加并集验证，`Validation and Acceptance` 加两条并集命令与人类门 HC1（D20）；规模重估为代码约 690、文档约 700，760 收缩触发线与收缩顺序不变（D19）。
