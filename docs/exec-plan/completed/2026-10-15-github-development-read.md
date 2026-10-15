# GitHub Development 只读 Provider ExecPlan

> 状态：Completed（2026-10-15：第一轮 MMP 评审 APPROVE，评审修复与两轮独立复评后由评审会话整合发布；整合、推送与合并以 PR #342 最终 head 的回读为准）
> 创建：2026-10-15
> 范围：完成 issue #231：把占位包 `packages/providers/development-github` 做成只读的 GitHub Development provider——仓库、分支、提交、按 head 分支列出变更请求（PR）与单个 PR 读取、PR 观察流；在 E1 沙箱录制夹具上通过共享 Development 契约套件。不做任何写入、不接宿主工厂、不改 core 的谱系同步。
> 上游输入：`AGENTS.md`、`PLANS.md`、issue #231（及其承接 #233、#235、#297、#127、#143）、`packages/capabilities/src/development-provider.ts`、`packages/capabilities/src/observation.ts`、`tests/contract/suites/development.js`、`packages/providers/planning-github-projects/`、`packages/providers/delivery-github-actions/`、`docs/architecture/gate-e1-sandbox.md`、`docs/architecture/gate-e1-content-identities.md`、`docs/exec-plan/completed/2026-09-29-github-projects-read.md`。
> 格式：本文件按根目录 `PLANS.md` 的强制章节书写；另带 `Concrete Steps` 与 `Artifacts and Notes` 两节以满足 ExecPlan 技能的结构检查。

## Purpose / Big Picture

完成后，`@harness-projects/provider-development-github` 导出一个只读的 `DevelopmentProvider`：

- 给定 Start Work 建的分支名（`work/<slug>`），`listChangeRequests({ repository, headBranch })` 只返回**本仓库**里 head 分支与它**字节精确相等**的 PR；每一项带 `headBranch`、`reviewState`（平台 `reviewDecision` 的保守投影）与 `sourceVersion = headRefOid`。标题等于分支名的 PR、fork 上同名分支的 PR、平台放宽过滤后多带出来的 PR 一律不返回。core 现有的 `readChangeRequest`（`packages/core/src/chain-facts.ts`）因此可以按「分支 + 头部提交相等」把 PR 挂到执行上下文的分支上，不重新识别对象。
- 共享 Development 契约套件 `developmentContractSuite` 在 E1 沙箱的录制夹具上不联网通过；回放未命中即 reject，未命中账本为空。
- 凭据失去读权限时：五个读方法返回结构化 `permission_denied` / `not_found`（固定文案、不回显平台正文），`describeCapabilities()` 把两个读 key 的 permission 报为 `degraded`；权限恢复后同一实例再次描述即回到 `available`。任何路径都不抛错（宿主注入的时钟违约除外，D25）。
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
- 本轮并行 PR：A（#132，宿主组合）**不**在本轮注册 `development.github` 目录条目（A 在 #344 登记的目录条目债务：#231 合并后由 #233 或后合并者加）；B（#276）、D（#280）与本 PR 没有共享代码文件。本 PR 不入栈、从 `main` 分支；共享文件协议见 `Global Constraints`，合并次序与宿主会话窗口见 `Interfaces and Dependencies`。

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

构造期校验（宿主编程错误，抛 `TypeError`）：`repository.externalId`、`owner`、`name` 是非空字符串，`transport` 是函数。除此之外任何路径都不抛错；唯一的例外是宿主注入的 `now` 返回非有限值（宿主契约，选项注释写明，D25）。

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

`first = Math.min(limit, 100)`（平台上限 100，`first: 101` 实测报 `EXCESSIVE_PAGINATION`）。变更请求列表在同一次调用里续取时，`first` 是这一页还差的条数（D28）。

### 读方法的行为（输入闸门全部在发请求之前，闸门拒绝时 transport 调用次数为 0）

| 方法 | 闸门（按顺序） | 请求与解码 |
|---|---|---|
| `getRepository(ref)` | `ref.bindingId === bindingId && ref.objectKind === 'repository' && ref.externalId === repository.externalId`，否则 `not_found` | `DevelopmentRepository`；`repository: null` → `not_found`；返回 `{ ref: { bindingId, objectKind: 'repository', externalId: repository.externalId, url: undefined }, name, defaultBranch: defaultBranchRef?.name ?? undefined, sourceUpdatedAt: updatedAt }` |
| `listBranches({ repository, cursor, limit })` | 仓库闸门同上 → `not_found`；`limit` 不是正整数 → `invalid_input`；`cursor` 不是 `undefined` 也不是非空字符串 → `invalid_input` | `DevelopmentBranches`；每项 `{ ref: { bindingId, objectKind: 'branch', externalId: name, url: undefined }, name, headCommit: target.oid }`，`target.oid` 必须是 40 位小写十六进制 |
| `getCommit(ref)` | `bindingId` 或 `objectKind !== 'commit'` 不符 → `not_found`；`externalId` 不匹配 `/^[0-9a-f]{40}$/` → `invalid_input` | `DevelopmentCommit`；`object` 为 `null` 或 `__typename !== 'Commit'` → `not_found`；返回 `{ ref: { bindingId, objectKind: 'commit', externalId: oid, url: undefined }, sha: oid, message: messageHeadline === '' ? undefined : messageHeadline }` |
| `getChangeRequest(ref)` | `bindingId` 或 `objectKind !== 'change_request'` 不符 → `not_found`；`externalId` 不是非空字符串 → `invalid_input` | `DevelopmentChangeRequest`；`node` 为 `null`、`__typename !== 'PullRequest'`、或 `node.repository.id !== data.repository.id`（成员关系：别的仓库的 PR）→ `not_found` |
| `listChangeRequests({ repository, cursor, limit, headBranch })` | 仓库闸门 → `not_found`；`limit`、`cursor` 同 `listBranches`；`headBranch` 不是 `undefined` 也不是非空字符串（含 `''`）→ `invalid_input` | `DevelopmentChangeRequests`，`headRefName: headBranch ?? null`；解码后**后过滤** `headBranch === undefined || item.headBranch === headBranch`；不足一页时在本次调用内续取平台页（D28，见下方「分页」） |

**变更请求投影**（list 与 get 共用一个解码函数，所以两面逐字段相同）：

    ref = { bindingId, objectKind: 'change_request', externalId: node.id, url: node.url }
    number = node.number                         // 正整数，否则形状错误
    title = node.title; body = node.body         // 字符串，否则形状错误
    state = node.state.toLowerCase()             // open | closed | merged
    sourceVersion = node.headRefOid              // 40 位小写十六进制，否则形状错误
    headBranch = node.isCrossRepository === false ? node.headRefName : undefined
    reviewState = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested', REVIEW_REQUIRED: 'review_required' }[node.reviewDecision] ?? 'unknown'

`isCrossRepository` 必须是布尔值（形状错误则整页失败）。fork 上同名分支的 PR 因此 `headBranch === undefined`，永远不会命中分支过滤；但它仍是本仓库的 PR，不带过滤的列表与 `getChangeRequest` 照常返回它。后过滤只用这一条谓词，不看标题、不看编号、不做前缀匹配。`reviewDecision` 用 `Object.hasOwn` 查表，`null`、`DISMISSED` 这类 union 之外的值都落到 `unknown`。

**分页**：`nextCursor = pageInfo.hasNextPage ? endCursor : undefined`；`hasNextPage` 不是布尔值，或为真但 `endCursor` 不是非空字符串、或等于传入的 `cursor`（游标停滞）→ 整页 `unavailable` + `rawClass: 'malformed_response'`。游标原样透传平台的 `endCursor`，不编码 scope（端口把「换 scope 从头读」定为调用方义务）。后过滤可能让一页少于 `limit` 项甚至为空而 `nextCursor` 仍有值；端口允许，读者逐页读完即可。（Superseded by D28（2026-10-15 评审 F1）：端口写的是先过滤再分页，不允许这种短页；provider 改为在本次调用内补满一页，见下段。）

**按 `headBranch` 的列表先过滤再分页**（D28）：一次调用里先取 `first = min(limit, 100)` 条平台页，后过滤之后不足 `size = min(limit, 100)` 个命中、平台又还有下一页时，从该页的 `endCursor` 接着取，`first` 只取还差的条数，直到凑满 `size` 或平台读完；交出的 `nextCursor` 是最后一个被完整消费的平台页的 `endCursor`（读完则为 `undefined`）。于是每页条目不超过 `limit`；平台没读完时每页至少一条命中；不跳过、不重复，游标单调前进。查询文本与变量形状都不变，录制夹具里没有 fork 同名 PR，回放不多发请求。边界：(1) 不预读就无法知道剩下的是否命中：预读能消除空末页，代价是每个满页多发请求，本 PR 选择不预读；所以最后一个命中之后若还有 fork 同名 PR，会多出一页空的末页（`nextCursor` 为 `undefined`），末尾有 fork 时这偏离共享套件「每一页都必须有命中项」的判据（只读形态走不到那条断言）；(2) 一次调用至多 `MAX_SCAN_PAGES = 100` 个平台请求，到上界仍未凑满时交出已得命中与游标（可能为空页；core 的 `limit 50` 下，阈值约 100 ×（50 − 已得命中）个 fork 同名 PR），core 读首页时把「未读完且未找到」记成缺口；(3) 平台页的行数多于所请求的 `first`、或游标回到本次调用已发送过的值，整次 `unavailable` + `malformed_response`；任一请求失败整次失败，不交出部分命中。不带 `headBranch` 时走同一路径，后过滤恒真，一次请求即凑满或读完。

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
- `retryAfterMs` 只交有限值：几百位的 `retry-after` 会换算成 `Infinity`（JSON 里是 `null`），按没有给出处理（D25；planning 的同一判定仍会得到 `Infinity`，TD-061）。
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
| 本 PR 写 core 级谱系集成测试 | 那是 #233 验收 1（录制夹具上的完整谱系）的范围；需要伪造执行上下文，成本约 80 行（D12）。部分 Superseded by D28（2026-10-15 评审 F2）：脚本化平台上的紧凑 core 端到端用例已补进本 PR，录制夹具上的完整谱系仍属 #233 |
| 在沙箱新建 `work/<slug>` 分支与 PR | 外部写入需要人类批准；provider 对分支名是不透明字节，Start Work 命名差异没有可观察效果（D11） |

## Global Constraints

- 只依赖 `@harness-projects/domain` 与 `@harness-projects/capabilities`；不 import 任何其它 provider（`tests/contract/package-boundaries.test.js`）。provider 源码不得出现 `fetch(`、`process.env`、`node:child_process`、`node:http`、`node:https`、`node:net`。
- 不改端口（`packages/capabilities/**`）、core、controller、apps、storage、任何 `package.json` 或 `pnpm-lock.yaml`。
- 凭据不进夹具、日志、文档或错误文案；夹具不录响应头。测试里的 token canary 不得匹配 `scripts/rule-checks.mjs` 的 GitHub 令牌正则（用 `canary-not-a-token-231` 这类带连字符的串）。
- 录制只读：录制程序拒绝 `mutation`；本 PR 不对沙箱或任何仓库做外部写入。
- 文档正文中文，标识符英文；不写本机绝对路径、不写账号以外的身份信息（`docs/development/publication.md`）。仓库 owner 与 `e1-sandbox` 已是 `docs/architecture/gate-e1-sandbox.md` 里公开登记的值。
- 本计划与提交正文不写关闭关键字加 issue 号的组合；提交一律 `Refs #231`，只有 PR 正文用关闭关键字，以 `closingIssuesReferences` 回读为准。
- 技术债编号只用预分配的 TD-061..064（全轮号段按 PR 预分配，其余号段由 #344、#345、#343 各自登记），手工插入（跟踪脚本与表格式不兼容），位置按下方「跨 PR 共享文件协议」。
- 规模预算（`node scripts/rule-checks.mjs size origin/main`）：代码桶（实现 + 测试 + 夹具 JSON）≤ 800 行规划、1000 行硬上限；文档桶 ≤ 1300 行规划、1500 行硬上限。
- **本 PR 的完整文件集合**（一个事实只写一处，其它章节引用本节）：

| 文件 | 动作 | 批次 |
|---|---|---|
| `docs/exec-plan/active/2026-10-15-github-development-read.md` | 新增 | 0，此后各批回填 |
| `packages/providers/development-github/src/queries.ts` | 新增 | 1 |
| `packages/providers/development-github/src/transport.ts` | 新增 | 1 |
| `packages/providers/development-github/src/index.ts` | 修改 | 1、2 |
| `tests/contract/fixtures/github-development/sandbox.json` | 新增（录制） | 1 |
| `tests/contract/development-github-contract.test.js` | 新增 | 1–4、评审修复（D28） |
| `packages/providers/development-github/src/classify.ts` | 新增 | 2 |
| `packages/providers/development-github/src/decode.ts` | 新增 | 2、4 |
| `packages/providers/development-github/src/provider.ts` | 新增 | 2–4、评审修复（D28） |
| `tests/contract/suites/development.js` | 修改（`declares` 一行与文件头一句） | 3 |
| `tests/integration/github-development-lineage.test.js` | 新增（core 端到端接缝） | 评审修复（D28） |
| `docs/exec-plan/tech-debt-tracker.md` | 按编号插入 TD-061..064（位置见下方协议） | 6 |
| `docs/README.md` | Active 表加一行（位置见下方协议） | 0 |
| `docs/product/vertical-path.md` | 第 9 行「承接」格就地加 Superseded 注 | 6 |

不改：`docs/architecture/gate-e1-sandbox.md`（夹具只含已登记的 node id）、`packages/core/**`、`apps/**`。

**跨 PR 共享文件协议**（2026-10-15 协调者整合裁定，本节只摘与本 PR 相关的部分；取舍见 `Decision Log` D16）：

- 一个单元一个 owner；任何 PR 不删除、不改名别人的成员或行。
- 本 PR 独占上表的代码与夹具文件，以及 `tests/contract/suites/development.js`（只改 `declares()` 与文件头一句）、`docs/product/vertical-path.md` §2.1 第 9 行；A、B、D 都不写它们。本 PR 也不写 A 的单元（`apps/harness-plugin/src/host.ts`、`host-composition.ts` 的结构、`index.ts`、`apps/harness-plugin/package.json`、`pnpm-lock.yaml`、`packages/core/src/context.ts`、两个存储适配器、`tests/contract/suites/storage-connector-account.js`、`tests/contract/package-boundaries.test.js`、`docs/adr/*`）、B 的单元（`remote.ts`、`client.ts`、`host-surface.ts`、`workspace-watch.ts`、`packages/client/**`、`packages/controller/src/watch.ts`）与 D 的单元（D 将新建的会话 API 架构记录与 `docs/architecture/README.md` 里它的行、`tests/contract/fixtures/harness-session/**`、`tests/contract/harness-session-api-record.test.js`）。
- `docs/README.md` §2 Active 表：每个 PR 把自己的行插在表头分隔行 `|---|---|---|` 的**正下方**；rebase 冲突时后合并者保留全部行，2026-10-15 的各行按计划文件名排序（`…-github-development-read` < `…-harness-session-api-probe` < `…-host-provider-composition` < `…-host-watch-stream`，所以本行排在四行之首）。
- `docs/exec-plan/tech-debt-tracker.md` Open 表：各 PR 的行按 TD 编号插在数值位置，与合并次序无关。本 PR 的 TD-061..064 插在 Open 表里编号小于 061 的最后一行之后（base 21cb29eb 上是 TD-052；#344、#345 先合并时是它们登记的最后一行）、编号大于 064 的第一行（#343 登记的行，若已合并）之前。只有 A 改既有 TD-030 / TD-031 的格；本 PR 不改任何既有行。

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

**真实宿主（S3）**：本 PR **没有** S3 批次，也不进入本轮协调者的任何宿主会话窗口（S-D、S-AB）。provider 本轮不进入宿主目录（A 把 `development.github` 条目留作跟进层，见 #344 的目录条目债务），Desktop 宿主里没有可观察的入口；伪造宿主观察违反证据规则。S3 落点：注册 `development.github` 目录条目的那一层（#233 或后合并者）与 #143 的 demo 走查（真实 Start Work → PR → 谱系）。Batch 6 的「重录可复现性」是对真实 GitHub 的只读观察，不是 Desktop 宿主观察，不冒充 S3；它与 Batch 1 的录制只受一条宿主窗口约束：不得与 S-AB Phase 2 的人类沙箱编辑重叠（`Interfaces and Dependencies`「宿主会话窗口」，D18）。

## Concrete Steps

所有命令都在检出 `feature/github-development-read` 的工作树根目录（仓库内路径 `.worktrees/github-development-read`）运行；`gh pr`、`gh issue` 这类按当前目录解析仓库的命令一律带 `-R SingularityKChen/harness-projects`（`gh api graphql` 的录制命令显式写 owner 与 name，不依赖当前目录）。每批结束先本地 WIP 提交（会话可能被中断，scratchpad 会清空），最终在 Batch 6 整合。

### Batch 0 · 计划、draft PR 与关联（协调者）

**最小闭环**：本计划进入分支，draft PR 关联 #231 并带齐标签与里程碑。
**涉及文件**：本计划、`docs/README.md`。

- [x] 核对隔离：`git rev-parse --git-dir --git-common-dir`、`git status --short --branch`（期望：`## feature/github-development-read...origin/main`，只有本计划未跟踪）、`git worktree list --porcelain`、`git check-ignore -v .worktrees/`。 实施记录：当时的读数未留存；2026-10-15 评审修复时回读，`--git-dir` 是 worktree 私有目录、`--git-common-dir` 是主仓库的 `.git`，分支 `feature/github-development-read`，`.worktrees/` 被 `.gitignore` 忽略。
- [x] 在 `docs/README.md` §2 Active 表按 `Global Constraints` 的「跨 PR 共享文件协议」插入（表头分隔行 `|---|---|---|` 正下方）：`| [2026-10-15-github-development-read](exec-plan/active/2026-10-15-github-development-read.md) | #231：GitHub Development 只读 provider（仓库 / 分支 / 提交 / 按 head 分支读 PR / 观察流），录制夹具上通过共享契约套件 | Active |`。 实施记录：该行在提交 `897d5135` 里。
- [x] 提交 `docs(exec-plan): 编写 GitHub Development 只读 provider 计划`，正文说明为什么（#231 的四条验收与设计取舍），末尾 `Refs #231` 与 `Co-Authored-By` 行；身份用 `git -c user.name=… -c user.email=…` 单次传入，不写 git config。 实施记录：整合后即 `897d5135`。
- [x] 推送并开 draft PR：标题 `feat(providers): read pull requests and branch lineage through the GitHub development provider`，base `main`，标签 `kind:feat`、`area:providers`，里程碑 `M4 · MVP Demo：Harness 内打通 GitHub 链路`。正文含：闭环、本计划路径与 Batch 名、关闭关键字（`Closes` + `#231`）、验证证据（随批回填）、风险与回滚、「不入栈，base `main`」、人类门段落（HC1：共享套件 `declares()` 改动请评审者确认，否决时验收 3 的解释交人类裁定；见 `Validation and Acceptance` 末段）。 实施记录：PR #342 于 2026-10-15 10:47 +08 开出；评审修复时只读回读 `gh pr view 342 --json labels,milestone,baseRefName,closingIssuesReferences`：标签 `kind:feat`、`area:providers`，里程碑 M4，base `main`，`closingIssuesReferences` 为 [#231]。
- [x] 按 `docs/project-management/README.md` 只回填机械字段；不写 Project `Status`，不写 blocked-by / blocking。 实施记录：评审修复时未核对 Project 字段，留给评审会话整合时回读。 评审会话 2026-10-15 回读：#231 的 Project 条目机械字段（Kind、Area、Priority、Size、Batch、Iteration）齐全；`ExecPlan` 字段仍指向 active 路径，归档后的机械回填由评审会话执行，以看板回读为准；`Status` 不由 agent 写。

**验证**：
`gh pr view <n> -R SingularityKChen/harness-projects --json isDraft,baseRefName,headRefName,labels,milestone,closingIssuesReferences`（期望：draft、base `main`、两个标签、里程碑 M4、`closingIssuesReferences` 含 231；刚开时可能为空，改一次正文后再回读）；`gh issue view 231 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences`（期望：含本 PR）。
**回滚**：关闭 draft PR，删除远端分支；本地分支保留。

### Batch 1 · 查询文本与只读录制（夹具先行，结束时为红）

**最小闭环**：查询文本定稿并进入包导出；按它录下沙箱的真实回答；契约测试骨架因 provider 未实现而红。
**涉及文件**：`queries.ts`、`transport.ts`、`index.ts`、`sandbox.json`、`development-github-contract.test.js`（骨架）。

- [x] 写 `transport.ts`（`Design / Spec` 的三个类型，文件头说明鉴权、超时、重试属于宿主）与 `queries.ts`（`Design / Spec` 的五段文本与片段，导出 `DEVELOPMENT_QUERIES: Readonly<Record<'DevelopmentRepository' | 'DevelopmentBranches' | 'DevelopmentCommit' | 'DevelopmentChangeRequests' | 'DevelopmentChangeRequest', string>>`，`Object.freeze`）。`index.ts` 先导出 `DEVELOPMENT_QUERIES` 与 transport 类型。
- [x] 录制前置：`gh auth status`（期望：开发账号是 Active account；否则停下报协调者，不改用合成数据）；按 `docs/architecture/gate-e1-sandbox.md` §2.1 在 shell 设置 `E1_OWNER` 与 `E1_REPO`。
- [x] 录制时间窗（D18）：开始前向协调者确认 S-AB Phase 2 的人类沙箱编辑不在进行中（从人类编辑 `issue-writable` 起，到人类还原并再引导一次止）；录制起止时刻（+08）写进 `Progress`。重叠时停下等窗口结束，不录。 实施记录：本批由协调者派发即视为窗口确认，没有单独收到 S-AB Phase 2 的状态；录制起止 2026-10-15 10:51:35–10:51:57 +08；夹具里 `repository.updatedAt` 仍是沙箱建立时的 2026-09-21T06:56:56Z，没有因窗口重叠而变化的迹象。
- [x] 只读回读沙箱清单（命令见下方第一个代码块）。期望：分支恰为 `fixture/gamma`、`main`，`totalCount` 为 1。不一致时先把实际清单记入 `Surprises & Discoveries`，再按实际清单调整录制清单与测试常量；新出现的 node id 要先登记到 `docs/architecture/gate-e1-sandbox.md`（这会把该文件加入文件集合，按 `PLANS.md` 改本计划并追加 Change Note）；不得为对齐计划而写沙箱。 实施记录：2026-10-15 10:51 +08 回读，分支恰为 `fixture/gamma`（头部 `f6c8908f`）与 `main`，`totalCount` 为 1，与计划一致。
- [x] 把下方第二个代码块保存为 `.superpowers/recording/record-development.mjs`（git 忽略，不提交），在工作树根目录运行 `node .superpowers/recording/record-development.mjs "$E1_OWNER" "$E1_REPO" > tests/contract/fixtures/github-development/sandbox.json`。期望：exit 0；`node -e "console.log(JSON.parse(require('fs').readFileSync('tests/contract/fixtures/github-development/sandbox.json','utf8')).exchanges.length)"` 输出 `19`（仓库 2、分支 4、提交 2、单个 PR 2、PR 列表 9）。`first: 1` 的分支遍历条数随分支数变化，清单变了就按实际数核对。 实施记录：exit 0，`exchanges.length` 为 19，`sandbox.json` 22 行 / 8221 字节。

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

- [x] 发布面人工检查夹具（凭据、本机路径与身份、账号个人信息、内部系统、保密字样）：期望只有已登记的 node id（仓库 id 与 pr-gamma 的 PR node id）、公开账号名、`e1-sandbox`、提交 sha、夹具说明句与 GitHub 游标。 实施记录：夹具只含公开账号名、`e1-sandbox`、两个已登记 node id、两个提交 sha、PR 文案与 GitHub 游标；对本机路径、邮箱、令牌形态的 grep 无命中。
- [x] 写测试骨架 `tests/contract/development-github-contract.test.js`：文件头写明它保护的不变量；常量全部从夹具读取（`OWNER` / `NAME` 取第一条 `DevelopmentRepository` 交换的 `variables`，`ABSENT_NAME` 取 `name` 以 `-absent` 结尾的那一条；`GAMMA_HEAD` 取 `DevelopmentBranches first:100` 的 `fixture/gamma` 节点，`PR_NODE` 取 `DevelopmentChangeRequests` 不过滤页的节点，`REPOSITORY_NODE_ID` 取 `DevelopmentChangeRequest` 交换里的 `data.repository.id`）；`LOCAL_REPOSITORY_KEY = 'repo-e1-sandbox'`；`bindingId = 'binding-github-development'`。辅助函数：
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

- [x] 先写用例（全部红）： 实施记录：骨架已因 provider 未导出而红；另加一条 `constructor` 用例钉住构造期校验（计划正文已规定、未列用例）。
  - **套件装配**：`developmentContractSuite({ label: 'GitHub Development provider（录制夹具）', makeProvider, expect })`。`makeProvider(scenario)`：`faults.offline` → `scripted` 永远 reject；`faults.permissionDenied` → `scripted` 永远返回 `{ status: 401, headers: {}, body: { message: 'Bad credentials' } }`；其余（含 `capabilities.*`）→ `replayProvider()`。`expect`：`repository = { bindingId, objectKind: 'repository', externalId: LOCAL_REPOSITORY_KEY, url: undefined }`、`baseBranch: 'main'`、`headCommit: GAMMA_HEAD`、`pageSize: 1`、`worktreeBranch: 'fixture/gamma'`、`worktreeDupBranch: 'main'`、`worktreePath: 'unused-worktree-path'`、`worktreeRef: { bindingId, objectKind: 'worktree', externalId: 'unused-worktree', url: undefined }`（三个工作树字段只是套件装配所需的占位，本 provider 省略工作树方法，注释写明）、`preparedChangeRequest: { ref: PR 的 ref（含 url）, headBranch: 'fixture/gamma', reviewState: 'unknown' }`、`objects: (provider) => 该 provider 账本里 operationName 不在 DEVELOPMENT_QUERIES 键里、或查询以 mutation 开头的请求`（正常恒为 `[]`；不能用全量账本，`declares()` 每次触发探针请求会让 `assertObjectsUnchanged` 误红）。
  - 「start-work-branch-lineage（录制）：按 head 分支读回 PR，头部提交与分支头相等」：照 core 的 `readHeadCommit` / `readChangeRequest` 的调用形状，`listBranches({ limit: 50 })` 找到 `fixture/gamma` 的头 X；`listChangeRequests({ headBranch: 'fixture/gamma', limit: 50 })` 的外部 id 恰为 `[PR_NODE.id]`，该项 `headBranch === 'fixture/gamma'`、`sourceVersion === X`；`getCommit(X).value.sha === X`。
  - 「start-work-branch-lineage（合成）：Start Work 分支名、标题诱饵、fork 同名分支与放宽的过滤都不混入」：`branch = branchNameFor('e1-fixture-delta')`（从 `@harness-projects/core` 导入，即 Start Work 的命名权威）。合成节点以录制的 PR 节点为模板，只改字段：目标（`headRefName: branch`、`isCrossRepository: false`、标题无关、`headRefOid: X`）、fork 诱饵（同名分支、`isCrossRepository: true`）、标题诱饵（`title: branch`、`headRefName: 'feature/other'`）、大小写诱饵（`headRefName: branch.toUpperCase()`）。两种平台模式各跑一次：「精确」只返回 `headRefName` 恰等于变量的节点（含 fork 诱饵，与公开仓库实测一致）；「忽略」返回全部节点。两种模式下结果都恰为 `[目标]`、`headBranch === branch`、`sourceVersion === X`；账本里的 `DevelopmentChangeRequests` 请求 `variables.headRefName === branch`。另断言不带过滤的列表仍返回 fork 诱饵且其 `headBranch === undefined`。
  - 「identity-shape：仓库引用用宿主配置的本地键，PR 用 node id 且与规划夹具同值，仓库 node id 不出现在任何输出」：在回放 provider 上收集 `getRepository`、`listBranches({ limit: 100 })`、`getCommit(GAMMA_HEAD)`、`getChangeRequest(PR ref)`、不带过滤的 `listChangeRequests({ limit: 100 })` 的全部返回值，`JSON.stringify` 后不含 `REPOSITORY_NODE_ID`；仓库 `ref` 深等于 `expect.repository`（这正是 `start-work.ts` 的 ack 比对与 `putRepository` 主键）；分支 `externalId === name`；提交 `externalId === sha`；PR 的 `externalId` 等于 `tests/contract/fixtures/github-projects/project-a.json` 里 `__typename === 'PullRequest'` 的内容 id（用同目录 `replay.js` 的 `loadFixture()` 读）。
  - 「review-state-projection（合成）：三种平台结论原样投影，null 与未知枚举为 unknown」：一页五个节点，`reviewDecision` 依次 `APPROVED`、`CHANGES_REQUESTED`、`REVIEW_REQUIRED`、`null`、`DISMISSED_IN_FUTURE` → `approved`、`changes_requested`、`review_required`、`unknown`、`unknown`；`getChangeRequest` 对 `APPROVED` 节点给出同一投影。
  - 「change-request-membership（合成）：别的仓库的 PR、不是 PR 的 node 与 null node 都是 not_found」：`node.repository.id` 不等于 `data.repository.id` → `not_found`；`node.__typename === 'Issue'` → `not_found`；`node` 为 `null` → `not_found`。回放的 `cr-absent` 由共享套件的变更请求用例读取并断言 `not_found`，本用例不再重复（D24 的规模收缩，原为「合成 + 录制」）。
  - 「input-gates-zero-requests：坏输入在 transport 之前结构化拒绝」：外来 binding、错 `objectKind`、同 binding 另一个仓库 `externalId` → `not_found`；`limit` 为 `0`、`-1`、`1.5`、`'10'`，`cursor` 为 `''` 或 `42`，`headBranch` 为 `''` 或 `7`，`getCommit` 的 `'abc123'` 与大写 40 位十六进制，`getChangeRequest` 的空 `externalId` → `invalid_input`；全部 `retryable === false`，账本长度 0。
  - 「cursor-stall（合成）：hasNextPage 为真而游标缺失或不前进时整页 unavailable」：分支与 PR 列表各两种（`endCursor: null`；`endCursor` 等于传入游标）→ `unavailable`、`rawClass === 'malformed_response'`。
- [x] 实现 `classify.ts`、`decode.ts`、`provider.ts`（`describeCapabilities` 本批先返回两个 key 的 capability 与 permission 都 `available` 的静态快照，Batch 3 换成探针），`index.ts` 补导出。唯一的 try/catch 在 `call` 包装里（同 planning 的 `call`）。 实施记录：`provider.ts` 114 行、`decode.ts` 87 行、`classify.ts` 55 行。
- [x] 静态检查：`grep -rnE "fetch\(|process\.env|node:child_process|node:https?|node:net" packages/providers/development-github/src`（期望无输出）。 实施记录：无输出。

**验证**：
`node --test tests/contract/development-github-contract.test.js`（期望 `ℹ fail 0`）；
`pnpm run typecheck`（期望 exit 0）；
`pnpm run boundaries`（期望 `ℹ fail 0`）；
`node --test tests/contract/development-contract.test.js`（期望 `ℹ fail 0`，套件未改，作回归）。
**回滚**：反向本批提交；Batch 1 的夹具与查询保留。

### Batch 3 · 权限丢失降级与共享套件判定修正（验收 3）

**最小闭环**：失去读权限时快照降级、五个读方法给结构化错误；共享套件不再把「声明了但降级」误判为「未声明」。
**涉及文件**：`provider.ts`、`tests/contract/suites/development.js`、契约测试。

- [x] 先写用例「permission-loss-degrades（录制 + 合成）：失去读权限时快照降级、五个读方法结构化失败、恢复后回到可用」（红：静态快照恒 `available`）： 实施记录：红，失败是快照 permission 恒 `available`；用例另覆盖限流 / 传输抛错控制组与 `requestId` 形状守卫。
  - 录制部分：以 `repository.name = ABSENT_NAME` 构造回放 provider，`getRepository` → `not_found`、`retryable === false`；`describeCapabilities()` 的两个读 key permission 为 `degraded`，`effectiveCapabilities(snapshot)` 两项 access 都是 `degraded`。
  - 合成部分：同一个 provider 实例、可切换的 transport。先接回放 → 快照 `available`。再依次切到 401（正文 message 含 canary）、无限流证据的 403、200 + `errors: [{ type: 'FORBIDDEN', message: canary }]`、200 + `INSUFFICIENT_SCOPES`、200 + `data: { repository: null }` + `NOT_FOUND`：五个读方法（输入都合法）分别返回 `permission_denied`（前四种）或 `not_found`（最后一种），`retryable === false`，`message` 等于固定文案，`JSON.stringify(results)` 不含 canary，没有任何调用抛错；每种之后快照两个 key 都是 `degraded`。最后切回回放 → 快照回到 `available`（不缓存）。
  - 控制组：403 + `x-ratelimit-remaining: '0'` → `rate_limited`、`retryable === true`（限流不被误读成权限）；transport 同步抛错 → `unavailable`、`retryable === true`。
  - canary 用 `canary-not-a-token-231`。
- [x] 实现探针快照（`Design / Spec`「能力快照」）。此时运行契约测试，期望套件的「权限被拒与离线都是结构化失败」用例变红，失败信息含 `listChangeRequests（development.change_request.read） 未声明能力时必须报 not_supported`——这是共享套件 `declares()` 把 `degraded` 当成未声明的那条缺陷（`Surprises & Discoveries` 第 1 条）。 实施记录：红，失败信息恰为 `listChangeRequests（development.change_request.read） 未声明能力时必须报 not_supported`，与 Surprises 第 1 条的原型一致。
- [x] 修正共享套件：`tests/contract/suites/development.js` 的 `declares()` 改为只看能力声明：`return (await provider.describeCapabilities()).capability[METHOD_KEY[method]] === 'available'`；在 87–89 行注释末尾补一句：「声明只看 `capability`：`permission` 降级（如凭据暂时失效、离线探针失败）的 provider 仍声明该能力，调用应得到真实结果或结构化失败，而不是 `not_supported`」。`accessOf` 的其余三处用法不改。 实施记录：已单独成 `test(contract)` 提交（`16023000`）；除 `declares()` 与其注释外，文件头那句补了「`declares()` 只读快照的 `capability`」。

**验证**：
`node --test tests/contract/development-github-contract.test.js`（期望 `ℹ fail 0`）；
`node --test tests/contract/development-contract.test.js tests/integration/development-local-git.test.js`（期望 `ℹ fail 0`：替身六个适配器、坏适配器子进程矩阵与 Local Git 都不受影响；2026-10-15 原型在 base 上实测替身文件 88/88）。
**回滚**：反向本批两个提交（套件修正与探针快照可分别反向；只反向套件修正会让 GitHub 适配器的离线用例变红，所以套件修正的提交排在 provider 提交之前）。

### Batch 4 · 观察流（issue 范围条目：定宽可定序的 sourceVersion）

**最小闭环**：`reconcile` 产出带规范载体版本的 PR 观察，全有或全无、不抛错。
**涉及文件**：`decode.ts`（页解码同时交出 `updatedAt`）、`provider.ts`、契约测试。

- [x] 先写用例「change-request-observations：reconcile 产出定宽规范 sourceVersion，不是 sha；全有或全无」（红：`reconcile` 未实现）： 实施记录：红，失败是 `reconcile` 不是函数；用例另加两页成功的对照（防止「全有或全无」被读成「永远为空」）与「游标永远前进也只读 100 页」的有界扫描断言。
  - 回放 provider 上 `reconcile({ scopeKey: 'development', cursor: undefined })` 收齐：条数等于不过滤页的 PR 数；每条 `type === 'development.change_request.observed'`，`subject` 深等于列表项的 `ref`，`sourceVersion === sourceVersionFromTimestamp(node.updatedAt)`、`isComparableSourceVersion(sourceVersion)`、长度 30、不等于 `headRefOid`，`eventTime === sourceVersion`，payload 的键集合恰为 `body, headBranch, headCommit, number, reviewState, state, title`。
  - 同一 provider 读两遍：`dedupeKey` 逐条相同，`receivedTime` 不同（时钟递增）。
  - 全有或全无：离线 provider；「`updatedAt: '2026-13-01T00:00:00Z'`」的合成页；两页合成扫描（第一页正常且 `hasNextPage: true`、`endCursor: 'C1'`，第二页返回 500）——三种情况收集结果都是 `[]`，迭代不抛错。第三种是变异 M20 的判别点：只有一页的录制数据分不出「失败时产出已读页」。
- [x] 实现 `reconcile`（`Design / Spec`「观察流」），`MAX_SCAN_PAGES = 100`。

**验证**：`node --test tests/contract/development-github-contract.test.js tests/contract/capabilities-observation.test.js`（期望 `ℹ fail 0`）；`pnpm run typecheck`（exit 0）。
**回滚**：反向本批提交；读路径不受影响。

### Batch 5 · 对抗验证（独立的 Sonnet 验证者）

**最小闭环**：每条关键断言都有一个能把它变红的变异，且变异确实施加、文件按原字节还原。
**涉及文件**：只写本计划的 `Progress`、`Surprises & Discoveries` 与 `Artifacts and Notes`；spec 放 `.superpowers/review/C/mutations.json`（git 忽略）。

- [x] 验证者不是 Batch 1–4 的实施者。先读本计划与 diff，按下表写 spec（`command` 为 `["node", "--test", "--test-timeout=120000", "tests/contract/development-github-contract.test.js", "tests/contract/development-contract.test.js"]`），每个变异给出 `anchor`（施加前确认在目标文件里恰好出现一次）、`replacement` 与 `killedBy`。 实施记录：验证者独立重写，锚点与替换全部与实施者自检不同；spec 另含 M23（套件 `declares()` 改成恒真）。
- [x] 运行 `node scripts/review-mutate.mjs .superpowers/review/C/mutations.json --root .`。该脚本在施加前把原文按字节读进内存，锚点不是恰好一次就报 `NOT_APPLIED` 而不计存活，跑完写回并逐字节比对还原；不要用 `cp` 或 `git checkout --` 自己还原（`cp` 在本机可能停在覆盖确认上，`git checkout` 会抹掉未提交的修复）。 实施记录：2026-10-15 11:38 +08 起后台运行，基线与还原后基线均绿，23 个锚点都恰好施加一次，前后 `git status --short` 为空。
- [x] 期望：全部 `KILLED` 且归因到 `killedBy`；`SURVIVED` 先补判别用例再重跑，确属等价变异的逐条写明理由；`NOT_APPLIED` 修锚点重跑。 实施记录：M1–M23 全部 `KILLED` 且归因与 `killedBy` 一致，无 `SURVIVED` / `KILLED_OTHER` / `NOT_APPLIED`。另跑 64 个越表变异（只跑 GitHub 契约文件），33 个存活，处置见 `Surprises & Discoveries` 第 11 条。 补洞记录（修复者，D24）：补洞用例并入契约测试后重跑同一份 64 个越表变异，63 个 `KILLED`，只有 X24 存活（等价，理由见第 11 条）。
- [x] 另做三条手工反例（不进 spec，结论写进 `Surprises & Discoveries`）：把录制的 PR 节点改成 fork（`isCrossRepository: true`）后按分支过滤读不到；把 401 正文换成含 canary 的长文本后错误对象不含它；对 `getChangeRequest` 传一个 Issue 的 node id 得到 `not_found`。 实施记录：三条都成立（`Surprises & Discoveries` 第 12 条）。

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

- [x] 验收者先锁定 head 与 base，逐条对照 `Validation and Acceptance` 复跑证据；读 diff 找 dead code 与可简化处（例如与套件重复的断言、只被一处使用的辅助函数）；任何行为改动都要先有能失败的用例。重构后在**最终树**上整表重跑 Batch 5 的 spec（修复本身也要独立复评）。 实施记录：base `21cb29eb`、验收起点 head `bb5a4bfb`；对抗验收含 core 端到端三组探针（`Surprises & Discoveries` 第 18 条）与自拟越表变异 Z1–Z10（第 17 条）；重构 `050a6c58`、补洞 `ee2db4e5`（D26）；最终代码树 `ee2db4e5` 上的整表读数见 `Progress` 与 `Artifacts and Notes`。
- [x] 重录可复现性（只读，需要 `gh` 登录开发账号）：时间窗规则同 Batch 1（不得与 S-AB Phase 2 重叠，起止时刻写进 `Progress`）。把录制程序输出到 `.superpowers/recording/sandbox.rerecord.json`，与已提交夹具比较，期望只有 `recordedAt` 不同。还有别的差异时，先对照协调者的 S3 记录（含 Phase 2 对 `issue-writable` 的编辑与还原时刻），确认差异与它无关之后才定性为沙箱漂移并记入 `Surprises & Discoveries`；最可能独立变动的是 `repository.updatedAt`，pr-gamma 的字段按 Phase 2 的设计不应变化。网络或凭据不可用就记为「跳过」并写明原因，不算通过。 实施记录：2026-10-15 12:19:37–12:19:51 +08，开发账号为 active；窗口核对见 `Progress`；19 条交换，去掉 `provenance.recordedAt` 后与已提交夹具逐字相同（第 20 条）。
- [x] 手工把 TD-061..064 插入 `docs/exec-plan/tech-debt-tracker.md` 的 Open 表，位置按 `Global Constraints` 的「跨 PR 共享文件协议」（内容见 `Outcomes & Retrospective` 的技术债候选；列为 ID、日期、状态、ExecPlan、子系统、分支、记录者、简述、延期理由、遗留影响、下一步）。 实施记录：手工插在 base 上 Open 表的 TD-052 之后、`## Resolved Items` 之前；候选 E 未入表，等协调者分配编号。
- [x] `docs/product/vertical-path.md` §2.1 第 9 行「承接」格 `#235（被 #231 #204 阻塞）` 之后就地追加 `（Superseded by <本批执行当天的本地日期，YYYY-MM-DD 形式>（#231）：GitHub Development 只读 provider 已交付，#235 仍被 #204 阻塞）`，尖括号部分写成实际日期。 实施记录：日期写 2026-10-15。
- [x] 全量门禁（见 `Validation and Acceptance` 末表）。 实施记录：末表除两条并集命令（属协调者的并集验证步骤）外全部在最终树上复跑，读数见 `Progress`。
- [x] 协调者整合提交（先 `git branch backup/github-development-read-<YYYYMMDD-HHMM>` 建恢复锚点）： 实施记录：2026-10-15 13:41–13:42 +08 整合为 `897d5135`、`b9db9db5`、`831a98e7`、`79aef826` 四个提交（第 4 个的标题是 `docs(exec-plan): 回填 GitHub Development 只读计划的实施、验收与技术债`）。
  1. `docs(exec-plan): 编写 GitHub Development 只读 provider 计划`（本计划与 `docs/README.md` 一行）；
  2. `test(contract): 共享 Development 套件按能力声明判定可选方法`（只有 `tests/contract/suites/development.js`；必须排在提交 3 之前，它是人类门 HC1 的评审对象，可单独反向）；
  3. `feat(providers): 经 GitHub Development provider 读取 PR 与分支谱系`（`packages/providers/development-github/src/**`、夹具、契约测试）；
  4. `docs: 回填 GitHub Development 只读计划的验收证据与技术债`（本计划回填、tracker、vertical-path）。
  每个提交正文说明为什么，末尾 `Refs #231` 与 `Co-Authored-By` 行。整合后用 `comm` 比对整合前后 head 的文件集合（期望相同），`git diff <backup> HEAD` 期望为空；`git log --format=%B origin/main..HEAD | grep -nE '^#'` 期望为空（重放会吃掉 `#` 开头的行）。
- [x] 并集验证（协调者，置 ready 前；D17）： 实施记录见 `Progress` 的协调者余项一条（分支名实为 `test/round6-union` 与 `test/round6-union-b`）。在一次性并集工作树 `.worktrees/round6-union`（分支 `test/round6-union`，永不推送）合并 `main` + B（含 A）+ 本 PR + D 的当前 head，运行 `Validation and Acceptance` 末表的两条「并集」命令；各 head sha、观察时刻与读数写进 `Progress`。任一失败先定位归属，属兄弟 PR 的报给其 owner，不在本分支替别人修。
- [x] 推送用精确的 `git push --force-with-lease=feature/github-development-read:<旧远端 sha>`；回读 head、base、checks、`closingIssuesReferences` 与 review threads；`gh pr checks <n> -R SingularityKChen/harness-projects`（期望 `PR Fast Gate` pass）后 `gh pr ready <n> -R SingularityKChen/harness-projects`，再在对话里请人类伙伴评审（PR 由开发账号开出，GitHub 不能向作者本人发评审请求）。合并由人类决定（rebase merge）。 实施记录：远端 head `79aef826`；2026-10-15 15:31 +08 置 ready；16:38 +08 评审账号 APPROVE（review id 5530341948）。

**验证**：见 `Validation and Acceptance`。
**回滚**：`git reset --hard backup/github-development-read-<YYYYMMDD-HHMM>`（仅在本地分支、推送前）；已推送后用新提交修正，不改写已被评审引用的历史。

## Validation and Acceptance

| # | 验收项（issue #231） | 判定证据 | 强度 |
|---|---|---|---|
| 1 | Start Work 分支上开的 PR 按 head 分支找到并挂到该分支，从不按标题 | 「start-work-branch-lineage（录制）」：真实平台对 `headRefName: 'fixture/gamma'` 的回答经 core 同形调用得到唯一 PR，`sourceVersion` 等于分支头、`getCommit` 读回同一提交。「start-work-branch-lineage（合成）」：分支名由 core 的 `branchNameFor` 派生，标题诱饵、fork 同名分支、大小写诱饵在「精确」「忽略过滤」两种平台模式下都不混入，请求只带 `headRefName` 过滤。变异 M1–M3 | S2（录制回放 + 合成叠加）。core 端到端挂谱系由 #233 验收 1 的录制夹具用例承接；分支数或同名 fork PR 超过 core 首页读取上限（50）时谱系读为缺口（fail-closed），口径见 D23 与 HC2。（Superseded by D28（2026-10-15 评审）：脚本化平台上的 core 端到端已由 `tests/integration/github-development-lineage.test.js` 固化，变异 E1–E4；fork 同名 PR 不再以短页挤占首页；残余是分支数或目标之前的同仓库同名 PR 超过 50，或者 fork 同名 PR 多到一次调用的 100 个平台请求内读不到目标，阈值约 100 ×（50 − 目标之前的同仓库同名 PR 数）；这种情况记为 gap，不会挂错链（复评 N1，D29），见 TD-068） |
| 2 | 契约套件在录制夹具上不联网通过 | 套件装配用回放 transport，未命中即 reject；「replay-ledger」断言未命中为空；「provenance」「query-drift」防夹具失真；provider 源码无网络 API（grep 无输出） | S2 |
| 3 | 失去读权限得到降级能力，而不是裸平台错误 | 「permission-loss-degrades」：录制的仓库不可见回答 + 合成的 401 / 403 / `FORBIDDEN` / `INSUFFICIENT_SCOPES` / `NOT_FOUND`，五个读方法结构化失败、固定文案、无 canary、不抛错；快照两个读 key 为 `degraded`、`effectiveCapabilities` 为 `degraded`，恢复后回到 `available`。变异 M7–M12、M21 | S2（NOT_FOUND 形状为录制，其余合成）。宿主内真实吊销属 #143 的 S3 |
| 4 | provider node id 不成为本地主键 | 「identity-shape」：仓库 ref 用宿主配置的本地键（`start-work.ts` 把它写成主键并比对 ack），仓库 node id 不出现在任何输出；PR 的 `externalId` 是 node id 且与规划夹具同值，core 只把它放进哈希槽位（`chain-facts.ts` 245–249 行、`delivery-facts.ts` 102 行）。变异 M13、M14 | provider 层 S2；core 主键派生是既有代码（S1 引用）；端到端存储扫描建议随 #233 验收 1。（D28：脚本化平台加替身存储上的主键扫描已在 `github-development-lineage`；录制夹具与 SQLite 上的整库扫描仍随 #233 验收 1，评审会话已于 2026-10-15 登记：https://github.com/SingularityKChen/harness-projects/issues/233#issuecomment-6189020205） |
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
- HC2：验收 1 的口径收窄（D23；第 14、18 条）：真实仓库的分支多于 core 首页读取上限（50），或目标 PR 之前有 50 个以上 fork 同名 PR 时（fork 一半由 D28 收窄：provider 补满一页后，只有 fork 同名 PR 多到一次调用的 100 个平台请求内读不到目标时仍是缺口，阈值见 TD-068），谱系读是缺口（fail-closed，不挂错链），根因是 core 两处查找只读首页（技术债候选 E，#233）。是否接受验收 1 带这条已知限制合并，还是要求 #233 的 core 有界翻页先行，由人类伙伴裁定；agent 不替他选，PR 正文风险段点名。
- 常设：不写 Project `Status`、blocked-by / blocking；是否合并、何时合并由人类伙伴决定（rebase merge）。

## Progress

- [x] 2026-10-15 10:30 +08 设计完成：三份独立设计（契约夹具优先、GitHub API、身份与最小化）经独立评审收敛为本计划；关键事实已用只读 GraphQL 与原型核实（`Surprises & Discoveries` 第 1–5 条），决策见 `Decision Log` D1–D14。
- [x] 2026-10-15 10:45 +08 跨 PR 整合评审修订：宿主目录条目交接与 A 的 local-git 条目对齐（D15）、共享文件协议（D16）、不入栈与合并次序（D17）、沙箱录制时间窗（D18）、规模重估约 690（D19）、人类门 HC1（D20）；未改任何已跟踪文件。
- [x] 2026-10-15 10:47 +08 Batch 0 · 计划、draft PR 与关联：draft PR #342 开出，base `main`、标签 `kind:feat` / `area:providers`、里程碑 M4，`closingIssuesReferences` 回读含 #231（2026-10-15 评审修复时补勾，依据下方 13:36 条与 `gh pr view` 只读回读）。
- [x] 2026-10-15 10:55 +08 Batch 1 · 查询文本与只读录制（夹具先行）：`transport.ts`、`queries.ts` 与 `index.ts` 的两个导出就位；录制 10:51:35–10:51:57 +08，19 条交换，沙箱清单与计划一致；测试骨架三条用例（provenance、query-drift、replay-ledger）因 `createGithubDevelopmentProvider` 未导出而红（`SyntaxError: … does not provide an export named …`），符合预期。
- [x] 2026-10-15 10:58 +08 Batch 2 · 读路径：分支谱系与身份：契约测试 `ℹ pass 24 / fail 0`（套件 13 条、分支谱系录制与合成、identity-shape、review-state-projection、change-request-membership、input-gates-zero-requests、cursor-stall、constructor、provenance、query-drift、replay-ledger）；`pnpm run typecheck` exit 0；`pnpm run boundaries` `ℹ fail 0`（9 条）；`tests/contract/development-contract.test.js` `ℹ pass 88 / fail 0`；静态网络 API grep 无输出。
- [x] 2026-10-15 11:03 +08 Batch 3 · 权限丢失降级与共享套件判定修正：契约测试 `ℹ pass 25 / fail 0`；`tests/contract/development-contract.test.js` 与 `tests/integration/development-local-git.test.js` 合计 `ℹ pass 161 / fail 0`；套件修正提交（`16023000`，仅 `tests/contract/suites/development.js`）排在探针快照提交之前。
- [x] 2026-10-15 11:10 +08 Batch 4 · 观察流：`node --test tests/contract/development-github-contract.test.js tests/contract/capabilities-observation.test.js` `ℹ pass 36 / fail 0`；`pnpm run typecheck` exit 0。
- [x] 2026-10-15 11:23 +08 实施者自检（不是 Batch 5，不替代独立验证者）：本地 WIP 提交后在干净树上跑 30 个变异（S1–S22 与 Batch 5 表 M1–M22 一一对应，S23–S30 另覆盖限流证据、`requestId` 形状、扫描上界、payload 的 `headCommit`、`hasNextPage` 类型、`isCrossRepository` 与 sha 形状守卫、列表游标透传），`node scripts/review-mutate.mjs .superpowers/review/C-self/mutations.json --root .` 全部 KILLED 且归因与 `killedBy` 一致，用时 15 分 08 秒，之后 `git status --short` 为空。同一树上 `pnpm verify` exit 0（contract / integration / e2e 层 1606 条、MVP-0 7 条，`fail 0`）；`pnpm run boundaries` 9 条 `fail 0`；`node scripts/workflow-check.mjs` 无 findings；`node scripts/rule-checks.mjs disclosure origin/main` 无命中；`git diff --check origin/main...HEAD` 无输出；`content-placement` 与 `plan-facts-consistency` 9 条 `fail 0`；ExecPlan 技能的 lint 输出 `OK`。
- [x] 2026-10-15 11:46 +08 Batch 5 · 对抗验证（变异表）：独立验证者（Sonnet）在 head `253496644e3a`、干净树上跑完 M1–M23，`node scripts/review-mutate.mjs .superpowers/review/C/mutations.json --root .` 23 / 23 `KILLED` 且归因一致，用时约 10 分钟，之后 `git status --short` 为空。越表 64 个变异存活 33 个，已证明 32 个可由补洞用例杀死、1 个等价；另有一条真实仓库分支数超过一页时谱系读为缺口的发现（P2）。同一树上 `pnpm verify` exit 0（1606 + 7 条 `fail 0`）、`pnpm run boundaries` 9 条 `fail 0`、`workflow-check` 无 findings、`disclosure` 无命中、`git diff --check` 无输出、代码 713 / 文档 623（核对时）。未改任何生产代码；补洞建议见 `Surprises & Discoveries` 第 11–14 条，交 Batch 6 处置。
- [x] 2026-10-15 12:06 +08 Batch 5 余项处置（Sonnet 修复者；对八条验证者发现逐条复现并处置）：(1) P2 分支多于一页：复现成立（61 个分支得 `commit.observed === false`、缺口「分页未读完」），根因在 core 只读首页，换排序的方案经只读实测无效，本 PR 不修，见第 16 条、D23 与技术债候选，人类门 HC2 待问；(2)–(6) 补洞用例并入契约测试（D24）：三个新用例加六处既有用例的扩充，越表 64 个变异重跑 63 `KILLED`，X24 等价；(7) 超长 `retry-after` 先红后绿修为只交有限值，时钟契约写进 `now` 选项（D25）；(8) HC1 仍开，不由 agent 处置。最终树：`node scripts/review-mutate.mjs .superpowers/review/C/mutations.json --root .` M1–M23 23 / 23 `KILLED` 且归因一致（约 8 分钟），修复专项变异 Y1（去掉有限性校验）与 Y2（去掉 `Math.max(0, …)`）`KILLED` 于 `classification-table`，越表 64 个变异 63 `KILLED`，之后 `git status --short` 为空；`pnpm verify` exit 0（contract / integration / e2e 层 1609 条、MVP-0 7 条，`fail 0`，较 Batch 5 多 3 条新用例）；`pnpm run boundaries` 9 条 `fail 0`；`development-github-contract` 与 `capabilities-observation` 合计 41 条、`development-contract` 与 `development-local-git` 合计 161 条 `fail 0`；静态网络 API grep 无输出；`workflow-check` 无 findings；`git diff --check origin/main...HEAD` 无输出；代码 772 / 800、文档 638 / 1300（核对时）。
- [x] 2026-10-15 12:38 +08 Batch 6 · 独立验收、重构与文档回填（Opus 验收者，未参与 Batch 1–5）：base `21cb29eb`，验收起点 head `bb5a4bfb`，最终代码树 `ee2db4e5`。(1) 重录可复现性 12:19:37–12:19:51 +08：窗口按记录核对——A 的 Batch 7、B 的 Batch S3（S-AB Phase 2）与 D 的 Batch 3（S-D）在三份计划的 Progress 里都未开始，Phase 2 以 S-D 结束为前置，所以不重叠；19 条交换去掉 `recordedAt` 后与夹具逐字相同（第 20 条）。(2) 对抗验收：core 端到端三组探针成立（第 18 条），自拟越表变异 Z1–Z10 存活 9 个、其中 7 个非等价（第 17 条）。(3) 重构 `050a6c58`（第 19 条的头注释、冗余判断）与补洞 `ee2db4e5`（D26）。(4) 最终树读数：M1–M23 23 / 23 `KILLED` 且归因一致（12:26:03–12:34:39），Y1、Y2、Z1–Z5、Z7、Z9、Z11、Z12 11 / 11 `KILLED`，X01–X64 63 `KILLED` 加等价的 X24，之后 `git status --short` 为空；`pnpm install --frozen-lockfile --offline` exit 0；`pnpm verify` exit 0（contract / integration / e2e 层 1609 条、MVP-0 7 条，`fail 0`）；`pnpm run boundaries` 9 条 `fail 0`；`development-github-contract` 与 `capabilities-observation` 合计 41 条、`development-contract` 与 `development-local-git` 合计 161 条 `fail 0`；静态网络 API grep 无输出；`workflow-check` 无 findings；`git diff --check origin/main` 无输出；`content-placement` 与 `plan-facts-consistency` 9 条 `fail 0`；ExecPlan lint `OK`；`disclosure origin/main` 在含本回填的提交上无命中；规模见 `Outcomes & Retrospective`。(5) TD-061..064 已入 tracker，`vertical-path.md` 第 9 步已加 Superseded 注。
- [x] 2026-10-15 13:36 +08 人类门 HC1 批准、HC2 接受（D27）；技术债候选 E 分配为 TD-068 并插入 tracker。Batch 0 的 draft PR #342 已于 2026-10-15 10:47 +08 开出并回读 `closingIssuesReferences` 含 #231。
- [x] 2026-10-15 13:41–16:38 +08 Batch 6 协调者余项（评审修复时补勾）：整合为四个提交（13:41–13:42）。并集 14:07–14:21：`origin/main` @ `21cb29eb` + #345 @ `210626de`（含 #344）+ 本 PR @ `79aef826` + #343 @ `1ed80a95`；正序分支 `test/round6-union`（头 `738af9d7`）与反序分支 `test/round6-union-b`（合并提交 `4a797b28`）的树同为 `f0ed9798`；两个顺序 `pnpm verify` 都是 1658 + 7 条通过，`boundaries` 9 条、`typecheck` 通过，点名的 `development-local-git` 73/73、`development-contract` 88/88、`harness-plugin-host-providers` 11/11。正序第一次全量有 1 条 `review-mutation-harness` 的 pid 竞态失败（main 上同样存在，重跑通过）。之后推送，15:31 置 ready，16:38 评审账号 APPROVE（review id 5530341948，只剩 P2 / P3）。
- [x] 评审之后：处置评审意见（已完成，见下一条与 D28）→ 修复的独立复评 → 归档本计划到 `docs/exec-plan/completed/` 并更新 `docs/README.md` → 整合提交 → 勾选 #231 验收；合并由人类伙伴决定。（评审会话 2026-10-15 执行：修复与两轮独立复评、归档、整合；勾选 #231 验收与合并以 PR #342 与 #231 的回读为准）
- [x] 2026-10-15 17:15 +08 评审修复（review id 5530341948 的 F1–F4 与 PR 级说明，D28；评审会话派出的修复实施者，只在本 worktree 改动、不推送、不写 GitHub）：fixup 提交 `9f608ec8`（F1：provider 补页与契约测试）、`dad1ed1c`（F2：core 端到端用例），以及本计划与 tracker 的一个 fixup（目标 `79aef826`），主控以 autosquash 整合进 `831a98e7`（代码与测试）与 `79aef826`（计划与 tracker）。读数（代码树 `dad1ed1c`，base `21cb29eb`）：修复前的 provider 上新用例 `filter-before-pagination（合成）` 红，`limit 1` 逐页实得 `[[],[],["PR_hit_1"],[],["PR_hit_2"],["PR_hit_3"]]`；修复专项变异 F1a–F1f、E1–E4 10 / 10 `KILLED` 且归因一致；计划表与验收专项整表 34 / 34 `KILLED`（`Artifacts and Notes`）；`development-contract`、`development-github-contract`、`development-local-git-source`、`development-local-git`、`github-development-lineage` 五个文件合计 194 / 194；`pnpm verify` exit 0（contract / integration / e2e 层 1610 条、MVP-0 7 条，`fail 0`，比评审时多 1 条新用例）；`pnpm run boundaries` 9 条 `fail 0`；`typecheck` 通过；`workflow-check` 无 findings；代码 881 / 1000、文档 758 / 1500；ExecPlan lint `OK`；`content-placement`、`plan-facts-consistency` 与 `e1-evidence-consistency` 18 条 `fail 0`；`disclosure 21cb29eb` 在含本条的 fixup 提交上无命中，`git diff --check 21cb29eb...HEAD` 无输出。
- [x] 2026-10-15 17:40 +08 复评 P3 处置（D29）：fixup 提交 `c936af3f`（N2：集成用例前置 60 个 fork、偏移游标）、`fd378261`（N3：R3 / R4 断言），以及本计划与 tracker 的 fixup（目标 `79aef826`）。读数：集成用例在 `79aef826` 的 provider 上红、当前 head 上绿；F1a 只跑集成文件时 `KILLED`；R3、R4 在上一版契约测试上 `SURVIVED`、新版上 `KILLED`；修复专项加 R3、R4 共 12 / 12 `KILLED`；五个开发相关文件合计 194 / 194；`pnpm verify` exit 0（1610 + 7 条，`fail 0`）；`boundaries` 9 条 `fail 0`；`workflow-check` 无 findings；ExecPlan lint `OK`；`content-placement`、`plan-facts-consistency`、`e1-evidence-consistency` 18 条 `fail 0`；代码 889 / 1000、文档 768 / 1500；`disclosure 21cb29eb` 在含本条的 fixup 提交上无命中，`git diff --check 21cb29eb...HEAD` 无输出。

## Surprises & Discoveries

1. 2026-10-15：**共享套件把「声明了但降级」判成「未声明」**。`tests/contract/suites/development.js` 的 `declares()` 用 `effectiveCapabilities`（capability ∩ permission）。原型：一个只读、探针失败即 `degraded` 的最小 provider 跑未修改的套件，13 条用例 1 红，红在「权限被拒与离线」，信息为 `listChangeRequests（development.change_request.read） 未声明能力时必须报 not_supported`；`declares()` 改为只看 `capability` 后 13/13 通过，且同一改动下 `tests/contract/development-contract.test.js` 仍 88/88（base 21cb29eb）。复现：把套件、`development-contract.test.js` 与 `tests/fixtures/development-suite-adapters.mjs` 复制到 `.superpowers/` 下的同构目录，只改 `declares()` 一行后运行。处置见 D3。
2. 2026-10-15：**`gh api graphql` 在响应带 `errors` 时退出 1，但 stdout 仍是完整正文**（`node(id: "cr-absent")` 实测：`{"data":{"repository":{…},"node":null},"errors":[{"type":"NOT_FOUND",…}]}`，exit 1）；`object(oid: 全零)` 返回 `null`、不带 errors、exit 0。照搬 planning 录制程序的 `execFileSync` 会在第一条 NOT_FOUND 处中止。录制程序因此用 `spawnSync`，只录「非零退出但正文带非空 errors」的回答。
3. 2026-10-15：五段查询文本对沙箱只读执行全部通过 schema 校验：仓库 `defaultBranchRef.name = main`；`refs first:1` 首页 `hasNextPage: true`、游标 `MQ`；`fixture/gamma` 头部提交的 `messageHeadline` 为 `fixture gamma`；`headRefName: 'fixture/gamm'`（去尾）返回空页且 `endCursor: null`；`DevelopmentChangeRequest` 返回仓库 id 与 PR 节点；`<repo>-absent` 返回 `repository: null` + `NOT_FOUND`，message 带 owner/name（所以错误文案必须固定，不能透传）。
4. 2026-10-15：**`pullRequests(headRefName:)` 是精确过滤，但会带出 fork 上同名分支的 PR**。公开仓库 cli/cli 实测：`headRefName: "trunk"` 共 183 条，前 20 条里 18 条 `isCrossRepository: true`；`"TRUNK"`、`"tru"`、`" trunk"` 都是 0 条。GitHub 官方 CLI 的 `PullRequestForBranch` 也是先按 `headRefName` 取再在客户端按 head 仓库筛。所以后过滤必需，且后过滤会让分页出现短页甚至空页（端口允许；对 core 首页读取的影响交 #233，见 `Interfaces and Dependencies`）。（Superseded by D28（2026-10-15 评审 F1）：端口不允许短页，provider 在本次调用内补满一页。）
5. 2026-10-15：GraphQL schema 自省：`PullRequest.headRefName` / `headRefOid` 的描述都是「even if the ref has been deleted」（合并后删分支，谱系仍可按分支名找回）；`PullRequestReviewDecision` 只有 `APPROVED`、`CHANGES_REQUESTED`、`REVIEW_REQUIRED` 三值；`Repository.pullRequests` 的 `headRefName` 参数描述为「The head ref name to filter the pull requests by」；`first: 101` 报 `EXCESSIVE_PAGINATION`。
6. 2026-10-15：沙箱 pr-gamma 的 `reviewDecision` 为 `null`（沙箱没有必需评审的分支保护），录制数据只能证明 `unknown` 这一档；三个非 `unknown` 值只能由合成用例覆盖。
7. 2026-10-15：并行 PR A 的三份设计都把 `development.github` 工厂条目留作跟进层，本轮宿主里没有本 provider 的入口，所以本 PR 没有可做的 Desktop 宿主观察。
8. 2026-10-15（实施）：**计划的用例表没有钉住三条正文已规定的行为**——构造期校验（`TypeError`）、「任何形状不符整次失败」、列表游标与页大小原样透传。实现完成后的自检变异 S28（删去 `isCrossRepository` 布尔校验）、S29（sha 形状守卫）、S30（列表请求把 `after` 写死 `null`）在计划的九组用例下会存活或只被观察流间接抓到，于是补了三条用例（D21）。
9. 2026-10-15（实施）：**变异整表很慢**。每个变异要跑 `development-github-contract.test.js` 与 `development-contract.test.js` 两个文件（后者含坏适配器子进程矩阵），单个约 20 秒；30 个变异加基线与还原后基线共 15 分 08 秒，超过前台命令 10 分钟上限，需要后台运行并等待。Batch 5 的 22 个变异预计约 11 分钟，验证者应以后台任务运行。
10. 2026-10-15（实施）：Batch 3 的两处预测都兑现：静态快照下 `permission-loss-degrades` 红在「permission 恒 available」；换成探针后共享套件红在 `listChangeRequests（development.change_request.read） 未声明能力时必须报 not_supported`，`declares()` 只看 `capability` 之后全绿，`development-contract.test.js` 与 `development-local-git.test.js` 合计 161 条 `fail 0`。
11. 2026-10-15（Batch 5）：**越表变异暴露测试盲区**（64 个变异，只跑 `development-github-contract.test.js`，33 个存活）。分组：(a) 后过滤只钉住了大小写、标题与 fork 诱饵，前缀 / 后缀 / 包含 / 首尾空白改写全部存活（X33–X35、X38），录制夹具里的前缀与空白变体只经平台端精确过滤回放，不经后过滤；(b) 失败分类表里只有「403 + `x-ratelimit-remaining: 0`」、401 / 403、`FORBIDDEN`、`INSUFFICIENT_SCOPES`、`NOT_FOUND` 有用例，429、`retry-after`、403 正文的 `secondary rate`、`errors` 里的 `RATE_LIMITED` 与 `secondary rate`、`retryAfterMs` 的换算、非 2xx 的 `http_<status>`、非整数状态、`errors[].type` 的 `^[A-Z_]{1,40}$` 净化、「`errors` 非空不做部分成功」（有效 `data` 加其他类型 errors 应整次失败）都无判别用例（X14–X23、X25）；(c) `reconcile` 超限「一条不产出」不可判别（测试页是空页，变异 X58 仍得 `[]`），游标成环的 `sent` 守卫没有用例（X59；`decode.ts` 的停滞守卫只拦「等于传入游标」，A→B→A 只靠它）；(d) 导出定义与快照形状无人钉住：`implementationKey` / `domains`（X28、X29，delivery 的契约测试钉了自己的定义，A 的目录条目将依赖这个键）、快照 `bindingId` 与 `observedAt`（X26、X27）；(e) 投影细节：空仓库 `defaultBranchRef: null`、空提交说明、变更请求 `ref.url`、仓库 `sourceUpdatedAt`、`body: null`、录制的全零提交 `not_found`（该交换整条未被任何用例使用）、`node: null`、提交 `__typename` 校验、sha 正则锚点、fork PR 观察 payload 的 `headBranch: null`、`getCommit` 的 `objectKind` 闸门（X01、X08–X11、X13、X40–X42、X44、X54）。验证者写了一份补洞用例草稿（`.superpowers/review/C/gap-tests.test.js`，五条，在干净树上全绿，约 110 行，不进仓库），把 33 个存活变异中的 32 个杀死；唯一存活的 X24（`body` 不是对象时不单独判 `malformed_response`）与原行为同结果（下游解码抛错，同为 `unavailable` + `malformed_response`），是等价变异。 处置（修复者，D24）：草稿并入契约测试后重跑 64 个越表变异，63 个 `KILLED`，X24 仍存活并确认等价：去掉 `!isRecord(body)` 判定后，非对象正文在 `const { errors } = body` 或下游解码处必然抛出，同样落到 `unavailable` + `malformed_response`，`requestId` 与 `rawClass` 也相同。
12. 2026-10-15（Batch 5）：三条手工反例都成立。(1) 把录制的 PR 全部改成 `isCrossRepository: true`：按 `fixture/gamma` 过滤得 `[]`，不带过滤仍返回它且 `headBranch` 为 `undefined`，回放未命中为空。(2) 401、403、404、429、500、502 与 200 加 `errors` 的多种形态里，正文 message、`documentation_url`、`extensions`、`path`、`errors[].type`（含 canary）、`x-github-request-id` / `retry-after` / `location` / `authorization` 头里放 canary，五个读方法、快照与 `reconcile` 的全部返回值序列化后不含 canary。(3) Issue 的 node（`__typename: 'Issue'`）、无 `__typename` 的空 node 得 `not_found`，缺 `node` 键得 `unavailable` + `malformed_response`。
13. 2026-10-15（Batch 5，越表端到端）：用 core 的真实写者验证了 provider 之外的接缝。**验收 1 / 4**：Start Work 用替身建出上下文，把分支改成沙箱里有 PR 的 `fixture/gamma`，以本 provider（录制回放）作为 Development 重新组合同一份 SQLite 文件库，`refreshDeliveryFacts` 得到 `commit`（`derived_from`）与 `change_request`（`produced_by`，标签为 PR 编号加标题）两跳，回放未命中为空，请求依次是仓库探针、分支首页、按分支过滤的 PR 列表；整库扫描 PR node id 只出现在 `delivery_fact.sets_json` 的 `externalId` 属性里，所有实体 id 是哈希（`change_request-<32 位十六进制>`），仓库行主键是宿主配置的本地键，仓库 node id 不在库里任何位置。**验收 3**：组合时探针 401 → 两个读 key 的有效级别 `degraded`，core 读门放行（`allowed`、`access: degraded`），谱系读得到缺口 `GitHub 拒绝了当前凭据的访问`，无 canary；运行期撤权不重新组合时同一固定文案以缺口出现。
14. 2026-10-15（Batch 5）：**真实仓库的分支多于一页时，谱系读永远是缺口（P2，未修）**。`packages/core/src/chain-facts.ts` 的 `readHeadCommit` 只读 `listBranches` 首页（`PAGE_LIMIT = 50`），找不到且 `nextCursor` 仍在时报 `分页未读完`；本 provider 的分支按 `ALPHABETICAL ASC` 排序，Start Work 的 `work/<id>` 排在多数前缀之后。越表实验：61 个分支（60 个 `feature/*` 加一个 `work/<uuid>`），`readChainFacts` 得 `commit.observed === false`、变更请求也读不到、缺口 `development.repository.read: 分页未读完`。沙箱只有两个分支，录制夹具看不到这个问题。同时 `Interfaces and Dependencies` 里「变更请求查找像分支查找一样有界翻页直到找到」与代码不符：`chain-facts.ts` 的两处查找都只读首页，只有 `git-provisioning.ts` 的探针翻页。已把该句改成与代码一致的建议；排序方案（例如 `TAG_COMMIT_DATE DESC` 是否对 `refs/heads/` 生效需另做只读实测）或让 core 翻页，交 Batch 6 与 #233 裁定，列为 TD 候选。 处置（修复者，D23）：复现成立；换排序的方案 (b) 经只读实测无效（第 16 条），根因修复在 core，本 PR 不修，记为技术债候选，AC1 的口径随之收窄（人类门 HC2）。
15. 2026-10-15（Batch 5）：两处与「任何路径都不抛错」不一致的小事（P3）：(1) `describeCapabilities` 在注入的 `now` 返回非有限值时抛 `RangeError`（`reconcile` 对同一情形不抛）；planning 在选项注释里写明「返回有限的毫秒数」，本包的选项注释没有；(2) `retry-after` 为四百位数字时 `retryAfterMs` 是 `Infinity`（planning 的同一份判定同样如此）。传入 `undefined` / `null` 的引用或输入对象会抛 `TypeError`，与端口类型相符，不算缺陷。 处置（修复者，D25）：(2) 先红后绿修为只交有限值；(1) 把「必须返回有限毫秒数」写进 `now` 选项注释，与 planning 兄弟包一致，不吞掉。
16. 2026-10-15（修复者，只读实测）：**`TAG_COMMIT_DATE` 排序对 `refs/heads/` 不生效**。公开仓库 cli/cli（274 个分支）上同一请求里并排取 `ALPHABETICAL DESC` 与 `TAG_COMMIT_DATE DESC` 的前三项，名字与顺序相同（`workflows`、`workflow-view`、`workflow-test-spike`），提交日期却不递减；`TAG_COMMIT_DATE` 按标签的提交日期排序，对分支等于没有排序。即使它生效，Start Work 新分支的头部提交日期是起点提交的日期而不是创建时刻，也不保证落在首页。所以第 14 条的方案 (b) 不成立，只剩 core 翻页一条根因路径。
17. 2026-10-15（Batch 6）：**自拟的越表变异在 Batch 5 最终树上又存活 9 个**（Z1–Z10，只跑 GitHub 契约文件，spec 全文见 `Artifacts and Notes`）。非等价的三类：(a) 外层 `ProviderResult.requestId`：成功或失败结果丢掉它（Z1、Z4、Z5），外层改用未经形状守卫的原始头值（Z2），`REQUEST_ID` 去掉两端锚点后夹带合法 id 的 token 形态头值整串透出（Z3）——原用例只看 `error.requestId`；(b) 变更请求 `state` 恒为 `open`（Z7），录制与合成节点都是 `OPEN`；(c) 空串 `endCursor` 被当成下一页游标（Z9）。补洞用例见 D26，补后全部 `KILLED`。不补的两个：Z6（`DECIMAL` 去锚点，`retry-after: 1.5` 得 1500 而不是不给）判为无关紧要——RFC 9110 的 `Retry-After` 只有整数秒与 HTTP 日期两种合法形式，越规值两种读法都说得通，planning 用同一正则；Z8（`ask` 里 `owner` / `name` 与变量的展开次序）是等价变异，内部调用从不传这两个键。
18. 2026-10-15（Batch 6，core 端到端）：`.superpowers/review/C-accept/probe-core.mjs`（git 忽略）用 Start Work 替身建出执行上下文，再以本 provider 加脚本化平台（`headRefName` 精确过滤但带出 fork、`CREATED_AT DESC`、偏移游标）重新组合，跑 core 的真实写者。S1：四个 PR——标题等于分支名且头部提交相同的诱饵、目标、后创建的 fork 同名同提交 PR、大写诱饵——在平台精确过滤与忽略过滤两种模式下，`refreshDeliveryFacts` 都只挂上目标；刷新前后 `listPlanningItems()` 逐字相同；SQLite 里没有 node id 作主键，三个诱饵的 id 不在库里任何位置。S2：目标之后又有 50 个 fork 同名 PR 时，后过滤让首页为空而 `nextCursor` 仍在，core 只读首页，得缺口 `development.change_request.read: 分页未读完`（fail-closed，不挂错链）。S3：组合时仓库不可见（`NOT_FOUND`）或 401，两个读 key 的有效级别都是 `degraded`，谱系缺口是固定文案，序列化结果不含 canary。S2 与第 14 条同根（core 只读首页），并入技术债候选 E。另记：端口对 `headBranch` 写「先过滤再分页」，共享套件只对能建 PR 的 provider 断言「每一页都必须有命中项」，只读形态走不到；本 provider 的短页只在 fork 上有同名分支时出现，Start Work 的 `work/<id>` 名实际碰不到，`Design / Spec`「分页」里的「端口允许」是对端口的一种解释，评审时请一并确认。（Superseded by D28（2026-10-15 评审 F1）：评审认定这是偏离端口，provider 改为补满一页；S2 的首页空页随之消失，复现见第 21 条。）
19. 2026-10-15（Batch 6）：provider 头注释照搬 planning 的「`composeCore` 会吞掉裸异常」，对 Development 不成立：组合期只调 `describeCapabilities`，读方法抛出的裸异常落在 `refreshDeliveryFacts` 的 catch 里，折成整次失败，逐跳缺口原因随之丢失（`packages/core/src/delivery-facts.ts` 的 K2 分支）。已改注释（`050a6c58`），行为不变。
20. 2026-10-15（Batch 6）：重录可复现：19 条交换去掉 `provenance.recordedAt` 后与已提交夹具逐字相同，`repository.updatedAt` 仍是 2026-09-21T06:56:56Z，沙箱自 Batch 1 起没有漂移。
21. 2026-10-15（评审修复，D28）：**第 18 条 S2 在补页之后挂上目标**。`.superpowers/fix-342/probe-core-s2.mjs`（git 忽略）沿用 `github-development-lineage` 的装配：目标之前有 60 个 fork 同名 PR，平台精确过滤但带出 fork、偏移游标、严格遵守 `first`，core 只读首页（`limit 50`）。修复前的 provider：变更请求只发 1 个平台请求（`first 50`、`after null`），首页 50 个全是 fork，后过滤后为空页而游标仍在，core 得 `development.change_request.read` 缺口，变更请求跳缺口原因是 `unconfirmed`。修复后：同一次调用发 2 个平台请求（`first 50` 从 `after null` 起，再从 `C50` 起），首页即含目标，变更请求跳挂上 `PR_target`，刷新没有缺口；剩下的缺口只有替身 Delivery 没有这个提交的流水线与检查（`not_observed`）。（Superseded by D29（复评 N2）：同一场景已并入 `tests/integration/github-development-lineage.test.js`，即目标之前 60 个 fork 同名 PR、偏移游标、core 只读首页；它在 `79aef826` 的 provider 上红（`actual: ['精确', undefined, undefined]`），在修复后绿，变异 F1a 被它杀死。证据以该用例为准，探针只作当时的记录。）

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
- **D12 不在本 PR 写 core 级谱系集成测试**。录制夹具上的 `WorkItem → … → PR → CI` 正是 #233 验收 1；在这里做要伪造执行上下文（约 80 行），且与 #233 重叠。验收 1、4 的 provider 部分在本 PR 完整关闭，core 部分写成对 #233 的交接。（部分 Superseded by D28（2026-10-15 评审 F2）：补了约 55 行的紧凑 core 端到端用例 `tests/integration/github-development-lineage.test.js`，用替身 Start Work 与脚本化平台，不伪造执行上下文；录制夹具上的完整谱系仍属 #233 验收 1。）
- **D13 提交消息取 `messageHeadline`**。与 Local Git 的 `git log -1 --format=%s` 同义；端口字段 `message` 只服务展示。
- **D14 分类器复制一份，`requestId` 加形状校验**。provider 之间不得 import，抽共享包需要 ADR 与边界改动；`requestId` 校验采用 delivery 的 `REQUEST_ID`，防止 token 形态的头值进入结果（TD-061 记录两份分类器的分歧）。
- **D15 宿主目录条目交接与 A 的 local-git 条目对齐**。配置字段名取 `repositoryExternalId`（与 A 的 `development.local-git` 条目同名同约束，值是工作区 `repositoryId` 本地键）、`repositoryOwner`、`repositoryName`；transport 直接用 A 的 `githubGraphqlTransport(fetch, credential)`；句柄用 A 的宿主常量 `HARNESS_PROJECTS_GITHUB_TOKEN`。核实：A 计划的 `development.local-git` 条目确用 `repositoryExternalId`，planning 条目以 `githubGraphqlTransport(fetch, credential)` 构造；planning 的 `transport.ts` 三个类型与本包设计逐字同形，结构类型下无需适配层；`bindingId` 必填与导出 `GITHUB_DEVELOPMENT_DEFINITION` 已满足 A 的请求（命名与 delivery 的 `GITHUB_ACTIONS_DEFINITION` 同式）。组合期探针：core 的 `collectBindings` 逐个 `await` 快照（`packages/core/src/registry.ts` 123–126 行），所以本 provider 的仓库探针串行加在首轮触网上，计入 #344 登记的「首轮水合在 typed remote 注册前触网」债务。本 PR 不写 `apps/**`，交接全文在 `Interfaces and Dependencies`。
- **D16 共享文件协议**。采纳协调者的整合裁定（`Global Constraints`）。替换原先的「Active 表首行」与「Open 表末尾」：原写法只给位置、不给冲突解法，四个 PR 写同一位置必然冲突，「各留各行」之后的次序取决于合并次序（例如 #343 先合并时本 PR 的 TD-061..064 会落在它登记的行之后）。协议保留「分隔行正下方」，再规定 2026-10-15 各行按计划文件名排序、TD 行按编号就位，冲突解法因此与合并次序无关、可机械核对。
- **D17 不入栈；C、D 与 A/B 互不依赖，推荐合并次序 C → D → A → B**。核实：本 PR 与 A、B、D 没有共享代码文件（共享的只有两个索引文档），B 堆叠在 A 上的三条理由（B 的 S3 需要 A 的目录、B 的集成测试调用 A 改签名的 `createHostComposition`、B 的 S3 证据要在含 A 的 head 上取）都与本 PR 无关；本 PR 没有 S3，最可能先 ready。合并前四步与合并后回读写在 `Interfaces and Dependencies`。部分理由修正：评审要求在并集上点名复跑 A 的 `tests/integration/harness-plugin-host-providers.test.js`，理由是「`declares()` 改动对每个 Development 适配器生效」——该文件不导入共享套件，`declares()` 不能直接影响它；接受这条复跑，价值改记为「确认本 PR 与 A 的目录、local-git 条目在并集上共存」（它本就在 `pnpm verify` 的 integration 层内，点名是为了按文件留读数）。另两条（`development-local-git.test.js`、`development-contract.test.js`）确实导入共享套件，理由成立。
- **D18 沙箱录制时间窗**。Batch 1 录制与 Batch 6 重录都不得与 S-AB Phase 2 的人类沙箱编辑重叠。核实：Phase 2 改的是 `issue-writable`（#3，`docs/architecture/gate-e1-sandbox.md` 登记为 E1-3 的字段写入夹具）的 Project A 字段，本包五段查询不读 Project 条目与 issue，按设计不受影响；但录制含 `repository.updatedAt`，平台对它的推进规则未实测，重叠时差异来源不可判别。规则成本只是一次与协调者的时间确认，所以采纳；重录出现 `recordedAt` 以外的差异时先对照协调者的 S3 记录再定性。
- **D19 规模重估约 690**。原估 610 把 provider 估为 145、decode 80、契约测试 265，偏乐观：planning 的 `provider.ts` 实为 153 行而本包多一个读方法、探针快照与 `reconcile`；decode 要同时服务 list / get 两面与观察流的 `updatedAt`；契约测试有九组用例加套件装配。重估后实现约 360、测试约 330。仍低于 760 的收缩触发线与 800 的规划上限，单 PR 不变；收缩顺序不变（`Plan of Work`）。
- **D20 共享套件改动设人类门 HC1**。`declares()` 改动对全部 Development 适配器生效，属契约语义，评审者确认是合并前置；保持它单独成一个 `test(contract)` 提交且排在 provider 提交之前，让评审者能单独审这一处契约改动，也让「只反向 provider、保留套件修正」成立。只反向套件修正会让本 provider 的离线用例变红（Batch 3 回滚注），所以否决不能靠单独反向解决：否决时验收 3 的解释交人类伙伴，agent 不自行在「改快照语义」与「改套件」之间二选一（见 `Validation and Acceptance` 末段）。
- **D21 补三条计划未列的用例**（实施期，约 +36 行测试，代码读数 713 / 800，仍低于 760 的收缩触发线）：`constructor`（构造期 `TypeError`）、`malformed-shapes`（合成响应下变更请求、分支与单对象三个读面的形状不符整次 `unavailable`，不做过滤坏行后成功）、`cursor-passthrough`（后过滤让首页变空而 `nextCursor` 仍在，`first` 与 `after` 原样发往平台）。（Superseded by D28：该用例把空页钉成期望，已改写为 `filter-before-pagination（合成）`，`first` 与 `after` 的透传由它的请求账本逐条断言。）理由是它们都是计划正文已规定的行为，缺用例就等于没有判别力；判别点是自检变异 S28、S29、S30。不改计划的验收口径，也不改文件集合。
- **D22 Batch 5 的越表发现不由验证者改生产代码，也不在本批补用例**（验证者规则：只写 spec 与计划回填）。处置交 Batch 6：必修的是 `Surprises & Discoveries` 第 11 条里的补洞用例（约 110 行测试，会让代码读数 713 → 约 820，超过 800 规划上限，需按 `Plan of Work` 的收缩顺序先删与套件重复的断言，或把「分类表」合并成一条表驱动用例），第 14 条的分支翻页缺口按人类可见的取舍写 TD 或改排序，第 15 条的两处小事择一补选项注释。第 14 条是否改查询（改查询要重录夹具）属于范围取舍，agent 不自行裁定。 修复者已按此处置，见 D23–D25。
- **D23 分支多于一页时谱系读为缺口：本 PR 不修，AC1 口径收窄，交人类确认（HC2）**。复现：`.superpowers/review/C/exp-core-more.mjs` 第 A 部分在当前树上重跑，61 个分支（`work/<uuid>` 在字母序末尾）得 `commit.observed === false`、`changeRequest.observed === false`、缺口 `development.repository.read: 分页未读完`。根因在 core：`chain-facts.ts` 的 `readHeadCommit` 与 `readChangeRequest` 只读首页（`PAGE_LIMIT = 50`），页没读完又找不到时按 #221 的 fail-closed 规则报缺口；端口的 `listBranches` 没有按名过滤，provider 唯一能动的是排序。备选 (b) 换排序：`TAG_COMMIT_DATE` 无效（第 16 条），`ALPHABETICAL DESC` 只是把 `work/` 前缀赶到前面、把正确性押在命名上，且要改查询文本、重录夹具并先与协调者确认 D18 的时间窗。备选 (a) core 有界翻页才是根因修复，但属 #233，且在 `Global Constraints` 的禁改清单里。所以不改查询、不改 core：失败是 fail-closed 的缺口，不会挂错链；`Interfaces and Dependencies` 的 #233 建议保留；记为技术债候选。AC1 的实际口径是「分支数不超过 core 首页读取上限时成立，沙箱录制只覆盖 2 个分支」，PR 正文的风险段点名。是否接受 AC1 带这条已知限制合并，还是要求 #233 先行，属验收口径，由人类伙伴裁定（HC2），agent 不替他选。
- **D24 把验证者的补洞用例并入契约测试**（修复期，对应第 11 条）。三个新用例 `classification-table`（失败分类表逐行，含 429、`retry-after`、`secondary rate` 文案、`errors` 里的限流证据、reset 换算、非整数状态、非 2xx、部分成功、`rawClass` 净化与超长 `retry-after`）、`definition-and-snapshot`（导出定义、快照 `bindingId` 与 `observedAt` 的精确值）、`projection-pins`（录制的全零提交、空仓库、空提交说明、非 Commit 对象）；扩充六个既有用例：近似分支名诱饵（前缀、后缀、包含、首尾空白、缺末字符、多一层目录，在「精确」「忽略」两种平台模式下都不混入）、`change-request-observations`（非空的超限页、游标成环 C1→C2→C1 恰好三次请求并带传输侧安全上限、fork PR 的 payload `headBranch` 为 `null`）、`input-gates-zero-requests`（`getCommit` 的 `objectKind` 闸门与 sha 两端锚点）、`identity-shape`（PR 的 `ref.url`、仓库 `sourceUpdatedAt`）、`change-request-membership`（`node: null`）、`malformed-shapes`（`body: null`）。规模：代码 713 → 772，高于 760 的触发线，低于 800 的规划上限；按 `Plan of Work` 的收缩顺序先删与共享套件重复的断言（membership 用例里回放的 `cr-absent`；分类表里与 `permission-loss-degrades` 重复的 401 与 `NOT_FOUND` 行），再压缩 `classify.ts` 的头注释；余下断言各对应一个原本存活的变异，不再删。
- **D25 宿主时钟违约与超长 `retry-after`**（修复期，对应第 15 条）。`now` 返回非有限值是宿主编程错误：`describeCapabilities` 仍抛 `RangeError`（吞掉就得伪造一个 `observedAt`），选项注释与 provider 头注释写明「必须返回有限毫秒数」，口径与 planning 兄弟包一致；Purpose 与 Design 里「任何路径都不抛错」相应加了这一条例外。`retry-after` 是平台输入，不是宿主违约：几百位的值得到 `Infinity`，修为只交有限值（先在 `classification-table` 加行得红 `Infinity`，再加有限性校验得绿）；`classify.ts` 因此比 planning 多一处分歧，记入 TD-061，不改兄弟包。
- **D26 Batch 6 的重构与补洞**（独立验收者，未参与 Batch 1–5；人类可推翻）。重构只做两处清晰度改动（`050a6c58`）：订正 provider 头注释（第 19 条）；去掉限流等待前冗余的 `wait !== undefined &&`（`Number.isFinite(undefined)` 本就为假），修复专项变异 Y1 的锚点随之改成 `Number.isFinite(wait) ? wait : undefined`。考虑过但不做：把 `const provider` 改成直接 `return {…}` 省 2 行，但 M8 的替换文本引用 `provider`，改了会让 M8 换一种死法；`failure()` 改用 `providerError` 的选项参数，但它与 planning 的同名函数逐字相同，留着更利于 TD-061 去重。补洞（`ee2db4e5`，测试净增 5 行，代码 772 → 777）：`identity-shape` 改用带合法 `x-github-request-id` 头的回放并断言五个读方法的外层 `requestId`；`permission-loss-degrades` 断言外层与错误对象两层，加入夹带合法 id 的 canary；`review-state-projection` 让节点轮换 `OPEN` / `CLOSED` / `MERGED`；`cursor-stall` 加空串 `endCursor`；三处手写的回放装配收敛成 `replayTransport()`。fork PR 造成的短页（第 18 条 S2）不改成「provider 内连续翻页补满一页」：那要在一次调用里发多条请求并另设上界，是行为与端口语义的改动，根因修复在 core 有界翻页（候选 E，#233）；它与 HC2 同根，问 HC2 时一并点名。（Superseded by D28（2026-10-15 评审 F1）：短页是偏离端口，provider 已在本次调用内补满一页，上界 100 个平台请求，不改查询、不重录夹具。）

- **D27 人类门 HC1、HC2 的裁定（2026-10-15 13:36 +08，人类伙伴在主会话直接回答 AskUserQuestion；协调者记录原文）**。
  - HC1 问：「PR C (#342) 改了共享的 Development 契约套件：declares() 只看 capability，不再把 degraded 当作「未声明」。这样失去读权限时 provider 报 degraded，读请求仍由 core 放行。该改动对所有 Development 适配器生效，单独成一个 test(contract) 提交，既有替身套件 88/88 仍绿。批准吗？」答：「批准 (Recommended)」。据此保留 `16023000` 的套件修正，验收 3 按「失去读权限报 degraded」关闭。
  - HC2 问：「PR C 的验收 1（按 head 分支找到 PR）有一个已知限制，根因在 core：chain-facts 的分支和 PR 查找只读第一页，每页 50 项。仓库分支超过 50 个，或目标前有 50 个以上 fork 同名 PR 时，谱系读取变成 fail-closed 缺口：不会挂错链，只是读不到。沙箱只有 2 个分支，demo 路径不受影响。是否接受带着这个限制关闭 #231？」答：「接受，限制交 #233 (Recommended)」。据此技术债候选 E 登记为 TD-068（协调者分配，在各 PR 预分配号段之外），PR 正文风险段点名，#231 带此已知限制关闭。

- **D28 评审 2026-10-15（Singularity-AI-Bot review id 5530341948，APPROVE，head `79aef826`）意见处置**（评审会话派出的修复实施者执行，只在本 worktree 改动，不推送、不写 GitHub；完整评审记录在本 PR worktree 的 `docs/review/pr-342-mmp-review.md`，由评审会话整合时随 PR 合入）。逐条：意见 → 是否属实 → 处置 → 证据。
  - **F1 [P2] 按 `headBranch` 的列表先分页再过滤**（旧 `provider.ts` 127 行）。属实：端口 `ProviderListChangeRequestsInput` 写的是「先过滤再分页」，本计划「分页」一段的「端口允许」是单方面解释（第 18 条请评审确认，评审没有接受）。处置：不改端口，改 provider。`listChangeRequests` 在一次调用内补满一页（`Design / Spec`「分页」的新段），只改变量 `first`（取还差的条数）与 `after`，不改查询文本；录制夹具原样回放、未命中为空（沙箱没有 fork 同名 PR，所以不多发请求），没有重录、没有触网。上界：一次调用至多 100 个平台请求，到上界交出已得命中与游标；平台多给行、游标成环都按形状错误处理。`cursor-passthrough（合成）` 把空页钉成了期望，改写为 `filter-before-pagination（合成）`：脚本化平台在命中之前与之间夹着 fork 同名 PR（偏移游标、严格遵守 `first`），`limit 1` 与 `limit 2` 逐页读到的页都非空且不超过 `limit`，拼接恰为全部命中；请求账本逐条钉住 `first` 与 `after`；另断言上界、成环与多给行。证据：新用例在修复前的 provider（`git show 831a98e7:packages/providers/development-github/src/provider.ts`）上红，`limit 1` 逐页实得 `[[],[],["PR_hit_1"],[],["PR_hit_2"],["PR_hit_3"]]`，与评审探针同形；变异 F1a（恢复「取一页即返回」）、F1b（每次取满一页）、F1c（上界差一）、F1d（成环不报错）、F1e（多给行照收）、F1f（游标退回调用方给的值）6 / 6 `KILLED` 于该用例。第 18 条 S2 的 core 场景复跑见第 21 条。被推翻的结论已就地标注：`Design / Spec`「分页」、第 4 条、第 18 条、D21、D26、`Validation and Acceptance` 验收 1 与 HC2 的 fork 一半、`Interfaces and Dependencies` 的 #233 条。TD-068 的变更请求一半随之收窄，首页读的限制仍在 core，交 #233。
  - **F2 [P2] 转交 #233 的内容未登记；验收 1 的 core 端到端证据只在被忽略目录**。属实：评审回读到 #233 正文最后更新于 2026-10-08，也没有评论。处置分两部分。(a) 承接登记由评审会话执行，证据在 PR。修复实施者起草了给 #233 的英文评论，写成三条可直接加入的验收条目：变更请求按 head 分支查找时 core 只读首页（TD-068）；存储主键扫描（实体、关系端点与仓库行的主键都不等于任何 provider node id）；TD-063 的观察流水位线协议（含 `reconcile` 产出前在内存里留至多 1 万个 PR 的 body）。本计划不把这项登记写成已完成。（Superseded by D29：评审会话已登记，#233 https://github.com/SingularityKChen/harness-projects/issues/233#issuecomment-6189020205，#231 https://github.com/SingularityKChen/harness-projects/issues/231#issuecomment-6189020709。）(b) 新增 `tests/integration/github-development-lineage.test.js`（58 行）。它放在集成层，因为它跨包、不触网，同层先例是 `github-actions-ci-facts.test.js`。用例先用离线替身跑 Start Work，建出执行上下文；再在同一份 Storage 上换成本 provider 加脚本化平台，重新组合，跑 core 的 `refreshDeliveryFacts`。结论：平台「精确」「忽略」两种过滤模式下都只挂上目标 PR。三个诱饵与目标的头部提交相同、排在目标之前，分别是标题、fork 与大小写诱饵，它们的 node id 都不在存储里任何位置。`produced_by` 的变更请求端是 `change_request-<32 位十六进制>`。实体、关系端点与仓库行的主键没有一个等于 provider node id，目标的 node id 只作属性入库。判别力：变异 E1（删后过滤）、E2（fork 也有分支身份）、E3（后过滤做大小写折叠）、E4（core 的变更请求实体 id 改用 node id）4 / 4 `KILLED` 于该用例，其中 E4 只有它能杀死。该用例在修复前的 provider 上同样通过：它固化的是既有行为，不是 F1 的回归用例。（Superseded by D29（复评 N2）：前置 60 个 fork 同名 PR、平台改成偏移游标之后，它在修复前的 provider 上红，变异 F1a 被它杀死，也是 F1 的 core 级回归用例。）D12「不在本 PR 写 core 级谱系集成测试」随之部分 Superseded，录制夹具上的完整谱系仍属 #233 验收 1。
  - **F3 [P3] Outcomes / Progress 停在 HC 裁定之前**。属实。处置：`Outcomes & Retrospective` 的 HC2、HC1 与「遗留」三处就地标 Superseded，指向 D27 或 `Progress`。`Progress` 勾选 Batch 0 与协调者余项，补上时刻与并集读数（带各 head sha 与观察时刻）。`Concrete Steps` 的 Batch 0 与 Batch 6 协调者步骤同步勾选并带实施记录，只有 Project 机械字段一步没有核对，留着不勾。追加 Bottom Change Note。
  - **F4 [P3] 计划引用了只在其它 PR 里登记的 TD 编号**。属实。处置：评审点名的 41、248、264、664、669 行，以及同类的 `Global Constraints` 号段说明、D15、D16 与 10:45 的 Change Note，都改成带 PR 号的写法（「#344 的目录条目债务」「#344 登记的首轮水合触网债务」「#345 / #343 登记的行」）。全文的 TD 编号只剩 base 上已有的 TD-030、TD-031、TD-052，和本 PR 的 TD-061..064、TD-068。
  - **PR 级说明（不重议，记录在案）**。(1) HC1 的代价：评审变异 H2（fake 的 permission 报不可用，方法却能用）在 head 上存活、在 base 上被杀。旧判据要求 `not_supported`，本身与端口义务 2 矛盾；HC1 已由人类批准（D27），不重议。local-git 与 fake 的既有检查没有削弱（H1 在 head 与 base 上都被杀）。(2) TD-062（快照只在组合时探测）已在 tracker。(3) `reconcile` 在产出前把至多 1 万个 PR（含 body）留在内存，已并入 TD-063 的影响一栏，随 #233 的水位线协议一并处理。(4) 夹具回放键不含查询文本：`replay.js` 以 `[operationName, variables]` 为键，改了查询并手工重算 provenance 哈希却不重录，回放仍会命中旧回答，planning 的夹具也是同一做法。不登记技术债，理由：`query-drift` 已强制「当前查询文本的哈希等于夹具记录的哈希」，剩下的缺口是手工伪造 provenance；任何离线检查都只能抬高伪造成本，不能证明回答来自平台，真正的守卫是重录可复现（Batch 6，第 20 条）。以后要收紧时，改两个 GitHub provider 共用的 `replay.js`：每条交换录下查询哈希，并纳入回放键。
  - 规模：代码 777 → 881 / 1000（provider 与契约测试约 +50，core 端到端用例约 +58），超过 800 的规划线，低于 1000 的硬上限；文档 758 / 1500。不拆 PR：两处都是评审要求在本 PR 内闭环的修复。
- **D29 复评 2026-10-15（评审会话对 D28 修复的独立复评：没有新的 P0 / P1 / P2，另有四条 P3）意见处置**（修复实施者执行，约束同 D28）。复评的性质检验：补页算法 3350 例，0 违例；修复前 22035 例违例。E4 只被新集成用例杀死。
  - **N1 [P3] TD-068 与验收 1 的残余限制说得过满**。属实。复评反例在 core 同形调用 `limit 50` 下成立：40 个同仓库旧 PR 加 1000 个 fork 再加目标，交出 40 项、游标 C1040，用满 100 个请求，core 判 gap；0 个同仓库 PR 加 4999 个 fork 能挂上，加 5000 个 fork 是 gap。处置：tracker 的 TD-068、本计划的验收 1、HC2、两处 Outcomes 与技术债段都补上同一句：「或者 fork 同名 PR 多到一次调用的 100 个平台请求内读不到目标，阈值约 100 ×（50 − 目标之前的同仓库同名 PR 数）；这种情况记为 gap，不会挂错链」。「分页」边界 (2) 也写进了阈值。#233 的评论已按这个口径写。
  - **N2 [P3] 新集成用例不是 F1 的 core 级回归，第 21 条的证据只在被忽略目录**。属实：用例的平台恒回 `hasNextPage: false` 并忽略 `after`。处置：在目标与诱饵之前前置 60 个 fork 同名 PR（`PR_far_*`），平台改为偏移游标、严格遵守 `first`；诱饵断言改成「除目标外全部节点都不入库」。证据：用例在 `79aef826` 的 provider 上红，`actual: ['精确', undefined, undefined]`，在当前 head 上绿；变异 F1a（恢复「取一页即返回」）只跑这一个集成文件时 `KILLED`，归因 `core 端到端`。第 21 条与 D28 的「不是 F1 的回归用例」一句就地标 Superseded。
  - **N3 [P3] 补页守卫有两处判别力缺口**。属实。处置：(R4) 新增「续取页多给行」：`limit 2`，首页 `[hit, fork]` 且 `hasNextPage`，续取页对 `first 1` 回 2 行，期望 `malformed_response`、请求数 2。(R3) 新增钳位断言：平台无穷命中、`limit 101` 时只发 `[[100, null]]` 一个请求，交出 100 项与 `C100`。证据：R3（`const size = limit`）与 R4（多给行只和 `size` 比）在上一版契约测试上都 `SURVIVED`，在新版上都 `KILLED`，归因 `filter-before-pagination（合成）`。R5（多请求时 `requestId` 取首个还是最后一个）规格未定义，按复评意见不处理。
  - **N4 [P3] 「分页」边界 (1) 的措辞**。属实。处置：改为「不预读就无法知道剩下的是否命中」，并写明预读能消除空末页、代价是每个满页多发请求、本 PR 选择不预读；补一句：末尾有 fork 时，这偏离共享套件「每一页都必须有命中项」的判据（只读形态走不到那条断言）。
  - **外部登记已完成**（评审会话 2026-10-15 发出）：#233 的三项转交验收 https://github.com/SingularityKChen/harness-projects/issues/233#issuecomment-6189020205；#231 的决策记录 https://github.com/SingularityKChen/harness-projects/issues/231#issuecomment-6189020709。验收 1 / 4 的强度格、`Interfaces and Dependencies` 的 #233 条、Outcomes 与 tracker 的 TD-063、TD-068 都改成已登记的事实，并附链接；D28 的「不写成已完成」一句就地标 Superseded。
  - 规模：代码 881 → 889 / 1000，文档 768 / 1500。

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
- 实施者自检 spec 在 `.superpowers/review/C-self/mutations.json`（git 忽略，30 条；S1–S22 与上表 M1–M22 一一对应）。它不是 Batch 5 的证据：验证者须独立重写 `.superpowers/review/C/mutations.json`，可以参考但不可直接沿用。
- 本地 WIP 提交序列（Batch 6 整合前；`test(contract)` 套件修正只改 `tests/contract/suites/development.js`，与其余提交文件集合不相交，整合时按 Batch 6 的次序移到 provider 提交之前）：`0ccb2450` 查询文本与只读录制、`fba26b1b` 读路径、`16023000` 共享套件 `declares()`、`785ea285` 探针快照、`0265d492` 观察流、`b9cfcf7c` 形状不符整次失败、`d1c6ddff` 游标透传；之后一个文档提交回填本计划。Batch 5 起又有 `864b0df6`（验证者回填）、`e44f6a17`（补洞用例）、`bb5a4bfb`（修复者回填）；Batch 6 是 `050a6c58`（`refactor(providers)`，只改 `provider.ts` 头注释与 `classify.ts` 一行）、`ee2db4e5`（`test(contract)`，只改契约测试）与随后的一个文档提交（本计划、tracker、vertical-path）。整合时代码与测试类并入提交 3，文档类并入提交 4。
- 设计期原型与三份设计稿在 `.superpowers/design/C/`（git 忽略，不是证据来源；证据以本计划的命令与读数为准）。
- 最终树整表重跑（Batch 6，独立验收者；代码树 `ee2db4e5`，观察时刻 2026-10-15 12:26–12:35 +08，之后 `git status --short` 为空）：
  - 计划的变异表 M1–M23，即 Batch 5 验证者的 spec（`.superpowers/review/C/mutations.json`，下面第一个代码块是全文）：`node scripts/review-mutate.mjs .superpowers/review/C/mutations.json --root .` exit 0，23 / 23 `KILLED` 且归因一致，用时 8 分 36 秒。
  - 修复与验收的专项变异 Y1、Y2、Z1–Z5、Z7、Z9、Z11、Z12（`.superpowers/review/C-accept/accept-extra.json`，下面第二个代码块是全文；Y1 的锚点随 `050a6c58` 改写）：exit 0，11 / 11 `KILLED` 且归因一致。
  - Batch 5 的越表变异 X01–X64（`.superpowers/review/C/extras.json`，目标与分组见 `Surprises & Discoveries` 第 11 条）：63 `KILLED`，X24 存活，等价（第 11 条）。
  - Z6、Z8 不进 spec（第 17 条：前者无关紧要，后者等价）。

Batch 5 验证者的 spec（M1–M23）：

    {"command": ["node","--test","--test-timeout=120000","tests/contract/development-github-contract.test.js","tests/contract/development-contract.test.js"], "mutants": [
      {"id":"M1","file":"packages/providers/development-github/src/provider.ts","anchor":".filter((item) => headBranch === undefined || item.headBranch === headBranch)","replacement":"","killedBy":"start-work-branch-lineage（合成）"},
      {"id":"M2","file":"packages/providers/development-github/src/decode.ts","anchor":"headBranch: node.isCrossRepository ? undefined : headRefName","replacement":"headBranch: headRefName","killedBy":"start-work-branch-lineage（合成）"},
      {"id":"M3","file":"packages/providers/development-github/src/provider.ts","anchor":"changeRequestsPage(cursor, limit, headBranch ?? null)","replacement":"changeRequestsPage(cursor, limit, null)","killedBy":"start-work-branch-lineage（合成）"},
      {"id":"M4","file":"packages/providers/development-github/src/decode.ts","anchor":"Object.hasOwn(REVIEW, decision) ? REVIEW[decision] ?? 'unknown' : 'unknown')","replacement":"Object.hasOwn(REVIEW, decision) ? REVIEW[decision] ?? 'unknown' : 'approved')","killedBy":"review-state-projection"},
      {"id":"M5","file":"packages/providers/development-github/src/decode.ts","anchor":"(typeof decision === 'string' && Object.hasOwn(REVIEW, decision) ? REVIEW[decision] ?? 'unknown' : 'unknown')","replacement":"(typeof decision === 'string' ? ((REVIEW[decision] ?? decision.toLowerCase()) as ProviderReviewState) : 'unknown')","killedBy":"review-state-projection"},
      {"id":"M6","file":"packages/providers/development-github/src/decode.ts","anchor":"return id(obj(obj(node).repository).id) === id(repository.id) ? decodeChangeRequestNode(node, bindingId) : undefined","replacement":"return decodeChangeRequestNode(node, bindingId)","killedBy":"change-request-membership"},
      {"id":"M7","file":"packages/providers/development-github/src/provider.ts","anchor":"permission: level(probe.ok ? AccessLevel.Available : AccessLevel.Degraded)","replacement":"permission: level(AccessLevel.Available)","killedBy":"permission-loss-degrades"},
      {"id":"M8","file":"packages/providers/development-github/src/provider.ts","anchor":"const probe = await getRepository(repositoryRef)","replacement":"const probe = await ((provider as any).cached ??= getRepository(repositoryRef))","killedBy":"permission-loss-degrades"},
      {"id":"M9","file":"packages/providers/development-github/src/classify.ts","anchor":"if (status === 401 || status === 403) return failure(PermissionDenied, requestId)","replacement":"if (status === 401) return failure(PermissionDenied, requestId)","killedBy":"permission-loss-degrades"},
      {"id":"M10","file":"packages/providers/development-github/src/classify.ts","anchor":"if (types.includes('FORBIDDEN') || types.includes('INSUFFICIENT_SCOPES')) return failure(PermissionDenied, requestId)","replacement":"","killedBy":"permission-loss-degrades"},
      {"id":"M11","file":"packages/providers/development-github/src/provider.ts","anchor":"if (error !== undefined) return providerErr(error, requestId)","replacement":"if (error !== undefined) return providerErr({ ...error, message: `${error.message} ${JSON.stringify((response.body as any)?.message ?? '')}` }, requestId)","killedBy":"permission-loss-degrades"},
      {"id":"M12","file":"packages/providers/development-github/src/provider.ts","anchor":"return providerErr(failure(ProviderErrorCode.Unavailable, requestId, rawClass), requestId)","replacement":"throw new Error('rethrown')","killedBy":"权限被拒与离线"},
      {"id":"M13","file":"packages/providers/development-github/src/provider.ts","anchor":"const repositoryRef: ExternalObjectRef = { bindingId, objectKind: 'repository', externalId: repositoryKey, url: undefined }","replacement":"const repositoryRef: ExternalObjectRef = { bindingId, objectKind: 'repository', externalId: `${owner}/${name}`, url: undefined }","killedBy":"identity-shape"},
      {"id":"M14","file":"packages/providers/development-github/src/decode.ts","anchor":"ref: { bindingId, objectKind: 'change_request', externalId, url: str(node.url) }","replacement":"ref: { bindingId, objectKind: 'change_request', externalId: String(number), url: str(node.url) }","killedBy":"identity-shape"},
      {"id":"M15","file":"packages/providers/development-github/src/decode.ts","anchor":"return nextCursor === after ? fail() : { rows, nextCursor }","replacement":"return { rows, nextCursor }","killedBy":"cursor-stall"},
      {"id":"M16","file":"packages/providers/development-github/src/provider.ts","anchor":"ask('DevelopmentBranches', { first: Math.min(limit, MAX_PAGE_SIZE), after: cursor ?? null })","replacement":"ask('DevelopmentBranches', { first: limit, after: cursor ?? null })","killedBy":"分支列表逐页读完"},
      {"id":"M17","file":"packages/providers/development-github/src/provider.ts","anchor":"!Number.isInteger(limit) || limit < 1 ? invalid('limit 必须是不小于 1 的整数')","replacement":"false ? invalid('limit 必须是不小于 1 的整数')","killedBy":"input-gates-zero-requests"},
      {"id":"M18","file":"packages/providers/development-github/src/provider.ts","anchor":"if (headBranch !== undefined && !nonEmpty(headBranch)) return invalid('headBranch 必须是非空字符串或 undefined')","replacement":"if (headBranch === '') headBranch = undefined","killedBy":"change-request-filter-before-pagination"},
      {"id":"M19","file":"packages/providers/development-github/src/provider.ts","anchor":"eventTime: version, receivedTime, sourceVersion: version,","replacement":"eventTime: version, receivedTime, sourceVersion: item.sourceVersion,","killedBy":"change-request-observations"},
      {"id":"M20","file":"packages/providers/development-github/src/provider.ts","anchor":"if (!result.ok) return result\n","replacement":"if (!result.ok) return providerOk(rows)\n","killedBy":"change-request-observations"},
      {"id":"M21","file":"tests/contract/suites/development.js","anchor":"return (await provider.describeCapabilities()).capability[METHOD_KEY[method]] === 'available'","replacement":"return accessOf(await provider.describeCapabilities(), METHOD_KEY[method]) === 'available'","killedBy":"权限被拒与离线"},
      {"id":"M22","file":"packages/providers/development-github/src/provider.ts","anchor":"if (typeof ref.externalId !== 'string' || !SHA.test(ref.externalId)) return invalid('提交引用必须是 40 位小写十六进制 sha')","replacement":"if (typeof ref.externalId !== 'string') return invalid('提交引用必须是 40 位小写十六进制 sha')","killedBy":"input-gates-zero-requests"},
      {"id":"M23","file":"tests/contract/suites/development.js","anchor":"return (await provider.describeCapabilities()).capability[METHOD_KEY[method]] === 'available'","replacement":"return true"}
    ]}

验收者的专项 spec（Y1、Y2、Z1–Z5、Z7、Z9、Z11、Z12）：

    {"command": ["node","--test","--test-timeout=120000","tests/contract/development-github-contract.test.js"], "mutants": [
      {"id":"Y1","file":"packages/providers/development-github/src/classify.ts","anchor":"Number.isFinite(wait) ? wait : undefined","replacement":"wait","killedBy":"classification-table"},
      {"id":"Y2","file":"packages/providers/development-github/src/classify.ts","anchor":"Math.max(0, Number(reset) * 1000 - nowMs)","replacement":"Number(reset) * 1000 - nowMs","killedBy":"classification-table"},
      {"id":"Z1","file":"packages/providers/development-github/src/provider.ts","anchor":"providerOk(found, requestId)","replacement":"providerOk(found)","killedBy":"identity-shape"},
      {"id":"Z2","file":"packages/providers/development-github/src/provider.ts","anchor":"requestId = requestIdOf(response.headers)","replacement":"requestId = response.headers['x-github-request-id']","killedBy":"permission-loss-degrades"},
      {"id":"Z3","file":"packages/providers/development-github/src/classify.ts","anchor":"const REQUEST_ID = /^[0-9A-F]{1,8}(?::[0-9A-F]{1,16}){3,5}$/i","replacement":"const REQUEST_ID = /[0-9A-F]{1,8}(?::[0-9A-F]{1,16}){3,5}/i","killedBy":"permission-loss-degrades"},
      {"id":"Z4","file":"packages/providers/development-github/src/provider.ts","anchor":"return result.ok ? providerOk({ items: result.value.rows, nextCursor: result.value.nextCursor }, result.requestId) : result","replacement":"return result.ok ? providerOk({ items: result.value.rows, nextCursor: result.value.nextCursor }) : result","killedBy":"identity-shape"},
      {"id":"Z5","file":"packages/providers/development-github/src/provider.ts","anchor":"if (error !== undefined) return providerErr(error, requestId)","replacement":"if (error !== undefined) return providerErr(error)","killedBy":"permission-loss-degrades"},
      {"id":"Z7","file":"packages/providers/development-github/src/decode.ts","anchor":"state: str(node.state).toLowerCase(),","replacement":"state: 'open',","killedBy":"review-state-projection"},
      {"id":"Z9","file":"packages/providers/development-github/src/decode.ts","anchor":"const id = (value: unknown): string => (str(value) === '' ? fail() : str(value))","replacement":"const id = (value: unknown): string => str(value)","killedBy":"cursor-stall"},
      {"id":"Z11","file":"packages/providers/development-github/src/provider.ts","anchor":"return result.ok ? providerOk(result.value.item, result.requestId) : result","replacement":"return result.ok ? providerOk(result.value.item) : result","killedBy":"identity-shape"},
      {"id":"Z12","file":"packages/providers/development-github/src/provider.ts","anchor":"nextCursor: result.value.nextCursor,\n      }, result.requestId) : result","replacement":"nextCursor: result.value.nextCursor,\n      }) : result","killedBy":"identity-shape"}
    ]}

- 评审修复（D28）的两份 spec（`.superpowers/fix-342/`，git 忽略；修复专项的全文是下方代码块，整表重跑的 spec 由上面两个代码块合成）：
  - `fix-mutations.json`：修复专项 F1a–F1f、E1–E4，命令只跑 `development-github-contract` 与 `github-development-lineage` 两个文件。`node scripts/review-mutate.mjs .superpowers/fix-342/fix-mutations.json --root .` exit 0，10 / 10 `KILLED`，归因与 `killedBy` 一致。
  - `author-final.json`：上面两个代码块合成一份，命令沿用 M1–M23 的两个文件。因为 `filteredPage` 改写了锚点，只换三处：M3 锚到 `changeRequestsPage(after, size - items.length, headBranch ?? null)`；M20 锚到 `scan()` 里的 `if (!result.ok) return result\n      rows.push(...result.value.rows)`（原锚点现在出现两次，会被判 `NOT_APPLIED`）；Z12 锚到 `providerOk({ items, nextCursor: after }, requestId)`。读数：34 / 34 `KILLED` 且归因一致（M1–M23、Y1、Y2、Z1–Z5、Z7、Z9、Z11、Z12），2026-10-15 16:51:51–17:09:13 +08，代码树 `dad1ed1c`，之后 `git status --short` 只剩未跟踪的评审记录。
- 复评（D29）的变异：`.superpowers/fix-342/f1a-integration.json` 只跑 `github-development-lineage`，F1a `KILLED`，归因 `core 端到端`。`.superpowers/fix-342/rereview-mutations.json` 是上方修复专项 spec 加 R3（锚点 `const size = Math.min(limit, MAX_PAGE_SIZE)`，改为 `const size = limit`）与 R4（锚点 `if (result.value.rows.length > size - items.length) return malformed(result.requestId)`，改为只和 `size` 比），12 / 12 `KILLED`，归因一致。R3、R4 在上一版契约测试上 `SURVIVED`。

修复专项 spec（F1a–F1f、E1–E4）：

    {"command": ["node", "--test", "--test-timeout=120000", "tests/contract/development-github-contract.test.js", "tests/integration/github-development-lineage.test.js"], "mutants": [
      {"id": "F1a", "file": "packages/providers/development-github/src/provider.ts", "anchor": "} while (after !== undefined && items.length < size && !sent.has(after) && sent.size < MAX_SCAN_PAGES)", "replacement": "} while (false)", "killedBy": "filter-before-pagination（合成）"},
      {"id": "F1b", "file": "packages/providers/development-github/src/provider.ts", "anchor": "changeRequestsPage(after, size - items.length, headBranch ?? null)", "replacement": "changeRequestsPage(after, size, headBranch ?? null)", "killedBy": "filter-before-pagination（合成）"},
      {"id": "F1c", "file": "packages/providers/development-github/src/provider.ts", "anchor": "!sent.has(after) && sent.size < MAX_SCAN_PAGES)", "replacement": "!sent.has(after) && sent.size <= MAX_SCAN_PAGES)", "killedBy": "filter-before-pagination（合成）"},
      {"id": "F1d", "file": "packages/providers/development-github/src/provider.ts", "anchor": "return after !== undefined && sent.has(after) ? malformed(requestId) : providerOk(", "replacement": "return providerOk(", "killedBy": "filter-before-pagination（合成）"},
      {"id": "F1e", "file": "packages/providers/development-github/src/provider.ts", "anchor": "      if (result.value.rows.length > size - items.length) return malformed(result.requestId)\n", "replacement": "", "killedBy": "filter-before-pagination（合成）"},
      {"id": "F1f", "file": "packages/providers/development-github/src/provider.ts", "anchor": "providerOk({ items, nextCursor: after }, requestId)", "replacement": "providerOk({ items, nextCursor: cursor }, requestId)", "killedBy": "filter-before-pagination（合成）"},
      {"id": "E1", "file": "packages/providers/development-github/src/provider.ts", "anchor": ".filter((item) => headBranch === undefined || item.headBranch === headBranch)", "replacement": "", "killedBy": "core 端到端"},
      {"id": "E2", "file": "packages/providers/development-github/src/decode.ts", "anchor": "headBranch: node.isCrossRepository ? undefined : headRefName", "replacement": "headBranch: headRefName", "killedBy": "core 端到端"},
      {"id": "E3", "file": "packages/providers/development-github/src/provider.ts", "anchor": "|| item.headBranch === headBranch)", "replacement": "|| item.headBranch?.toLowerCase() === headBranch.toLowerCase())", "killedBy": "core 端到端"},
      {"id": "E4", "file": "packages/core/src/chain-facts.ts", "anchor": "return chainNode(chainEntityId(context.workspaceId, EntityKind.ChangeRequest, slot), EntityKind.ChangeRequest,", "replacement": "return chainNode(asEntityId(fact?.ref.externalId ?? slot), EntityKind.ChangeRequest,", "killedBy": "core 端到端"}
    ]}

## Interfaces and Dependencies

- **外部工具与凭据**：录制与重录需要 `gh` 已登录开发账号并能读私有沙箱；不读任何凭据文件。测试与 CI 不需要凭据、不触网。Node 26（`package.json` 要求 ≥ 22）、pnpm 10.28.2（`packageManager` 钉定）。
- **宿主目录条目交接（D15；承接层：#233 或后合并者，见 #344 的目录条目债务；本 PR 不写 `apps/**`）**：与 A 的 `development.local-git` 条目同形，写在 A 的 `apps/harness-plugin/src/host-providers.ts` 里。
  - 实现键 `development.github`；条目的 `definition` 取本包导出的 `GITHUB_DEVELOPMENT_DEFINITION`（`domains: ['development']`）。
  - 配置 schema 三个字段，经 A 的 `text(configuration, name)` 读取：`repositoryExternalId`（与 local-git 条目同名同约束：string、必填、pattern `[^\s]+`、maxLength 200；值是工作区的 `repositoryId` 本地键，core 把它写成仓库主键并比对 ack，**绝不是** GitHub node id，D8）；`repositoryOwner`、`repositoryName`（只用于平台寻址；pattern 与长度由承接层按 GitHub 命名规则定）。
  - 账号规则同 A 的 planning 条目：`platformOrigin === 'https://github.com'` 且带 `secretHandle`，否则 `BindingRefused(not_supported, …)`；句柄是宿主常量 `HARNESS_PROJECTS_GITHUB_TOKEN`（A 的 D9，不另起名字）。
  - 构造：`createGithubDevelopmentProvider({ bindingId: binding.id, repository: { externalId: repositoryExternalId, owner: repositoryOwner, name: repositoryName }, transport: githubGraphqlTransport(fetch, credential) })`。`bindingId` 保持必填、不默认随机；transport 直接复用 A 的 `githubGraphqlTransport(fetch, credential)`：本包的 `GraphqlRequest` / `GraphqlResponse` / `GraphqlTransport` 与 planning 的 `transport.ts` 结构逐字同形，同一个函数可同时赋给两边。鉴权、`redirect: 'error'` 与 30 s 超时都在那个 transport 里，本 provider 不加。
  - 组合期探针：core 的 `collectBindings` 逐个 `await` 每个挂载的 `describeCapabilities()`，本 provider 每次快照发一条 `DevelopmentRepository` 请求。它不抛错（失败报 `degraded`），但在 typed remote 注册前触网、串行累加，最坏每个挂载把 host ready 推迟约 30 s。这是 #344 登记的「首轮水合在 typed remote 注册前触网」债务的增量，由承接层在那一行补记（本 PR 不改 #344 的行）。
  - 在 #297 合并前不要把本 provider 与 Local Git 同时挂到一个工作区：两个 Development 挂载时 key 级解析 fail closed，谱系的提交与 PR 两跳会退化成缺口。
- **#233（谱系同步）**：消费 `listChangeRequests({ headBranch })`、`listBranches`、`getCommit` 与 `reconcile`。建议：分支与变更请求的查找都要有界翻页直到找到（今天 `chain-facts.ts` 的两处查找都只读首页 50 项，分支多于一页时是缺口，见 `Surprises & Discoveries` 第 14 条；后过滤也可能产生短页，见第 4 条（Superseded by D28：provider 已补满一页））；在录制夹具谱系用例里加一条「实体、关系端点与仓库行的主键都不等于任何 provider node id」的存储扫描；用 PR node id 与规划的 PR 内容 id 归一（本 PR 的 identity-shape 已证明二者逐字相同）。评审 F2（D28）要求把三项写进 #233 正文的验收：变更请求按 head 分支查找时 core 只读首页（TD-068）；录制夹具谱系用例的存储主键扫描；TD-063 的观察流水位线协议（含 `reconcile` 产出前在内存里留至多 1 万个 PR 的 body）。评审会话已于 2026-10-15 登记：https://github.com/SingularityKChen/harness-projects/issues/233#issuecomment-6189020205（三项转交验收）；#231 的决策记录：https://github.com/SingularityKChen/harness-projects/issues/231#issuecomment-6189020709。
- **D（#280，Harness 会话观察）**：会话若把分支推到 fork 再开 PR，本 provider 会给出 `headBranch: undefined`，谱系找不到它；D 的记录宜写明会话推送到哪个远端。
- **#127 / #297**：仓库 node id 固定（TD-064）与按仓库路由。
- **共享文档**：`docs/README.md` 的 Active 表与 `docs/exec-plan/tech-debt-tracker.md` 的 Open 表，本轮 A、B、D 也会写；插入位置与冲突解法见 `Global Constraints` 的「跨 PR 共享文件协议」。
- **合并次序与栈（D17）**：
  - 本 PR 与 D 都不入栈，各自从 `main` 分支。B 原生堆叠在 A 上（深度 2；A 的 H2 被否决时是 A0 → A → B，深度 3），与本 PR 无关。C、D 与 A/B 互不依赖，各自门禁满足即可合并，可以插在 A/B 之间任意位置；推荐次序 C → D → A → B。
  - 每次合并前（协调者准备；是否合并由人类伙伴决定）：① 把本 PR rebase 到当前 `main`（strict 保护下每次合并都会让其余 PR 变 BEHIND）；② 按共享文件协议解决 `docs/README.md` 与 tracker 的冲突；③ 在并集工作树对 `main` 加全部仍开着的 head 重跑 `pnpm verify`（`Validation and Acceptance` 末表的并集行）；④ 回读 `closingIssuesReferences`（期望含 231）。rebase 改变了 head 时重新回读 checks。
  - 合并后回读被关闭 issue 的 state：`gh issue view 231 -R SingularityKChen/harness-projects --json state,closedByPullRequestsReferences`（期望 `CLOSED` 且含本 PR）。
- **宿主会话窗口（协调者主会话，串行两个）**：S-D（D 的 Batch 3，先跑）与 S-AB（A 的 AC8 / AC9、B 的 AC1）。本 PR 不在任何窗口里，只受一条约束（D18）：Batch 1 录制与 Batch 6 重录都不得与 S-AB Phase 2 的人类沙箱编辑重叠——人类改 `issue-writable`（#3）的 Project A `Status` 或 `E1 Text`，经引导观察 watch delta，再由人类还原并引导一次；Phase 2 的目标按设计从不碰 pr-gamma、issue-alpha、draft-beta。S-AB 前置 H5 由人类在 Desktop 凭据存储配置 `HARNESS_PROJECTS_GITHUB_TOKEN`，那正是本 provider 承接条目将来使用的句柄；该令牌对沙箱仓库内容与 PR 的读权限不在本轮验证，属承接层 S3（#233、#143）。agent 不读、不打印令牌值或带令牌的 URL。

## Outcomes & Retrospective

截至 2026-10-15 12:40 +08（独立验收者回填；代码树 `ee2db4e5`，base `21cb29eb`；整合、并集、推送与 ready 仍属协调者，见 `Progress`）：

- 验收 1（按 head 分支挂 PR，从不按标题）：provider 层成立（录制 + 合成，M1–M3、X33–X38），经 core 真实写者端到端成立（第 13、18 条：标题诱饵、fork 同名同提交 PR、大写诱饵都不挂、不入库）。口径收窄：分支数或目标之前的 fork 同名 PR 超过 core 首页读取上限（50）时谱系读为缺口（fail-closed），人类门 HC2 待问。（Superseded by D27：HC2 已接受，限制交 #233；fork 一半再由 D28 收窄，残余见 TD-068。）
- 验收 2（录制夹具上不联网通过契约套件）：成立；回放未命中为空，重录可复现（第 20 条）。
- 验收 3（失去读权限得到降级能力）：provider 与 core 两层都成立（第 13、18 条）；共享套件 `declares()` 的改动待人类门 HC1。（Superseded by D27：HC1 已批准。）
- 验收 4（node id 不成本地主键）：成立（identity-shape；第 13、18 条的整库扫描）。
- 范围条目（定宽可定序观察）：成立，目前没有消费者（TD-063）。
- 规模（`node scripts/rule-checks.mjs size origin/main`，观察时刻快照）：代码 777 / 800，文档 712 / 1300。
- 变异：最终树上 M1–M23 23 / 23、专项 11 / 11 全部 `KILLED`，越表 X01–X64 63 `KILLED` 加等价的 X24（`Artifacts and Notes`）。
- 与计划的偏差：补了计划用例表之外的用例（D21、D24、D26）；`retryAfterMs` 只交有限值（D25）；验收 1 的口径收窄（D23）；Batch 6 只做两处清晰度重构（D26）。
- 遗留：TD-061..064 与 TD-068（原候选 E）已入 tracker；HC1 批准、HC2 接受（D27）；Batch 0 的 draft PR 与关联、整合、并集、推送与 ready 待协调者。（Superseded by `Progress`：均已完成，ready 于 2026-10-15 15:31 +08。）
- 回顾：计划的变异表只覆盖验收级性质，规格级性质（分类表逐行、`requestId` 两层、投影细节、空游标）是两轮越表变异才补齐的（第 11、17 条：Batch 5 补 32 个、Batch 6 补 7 个非等价存活）。下次在设计期就为 `Design / Spec` 的每张表与每条守卫各列一行变异。

评审修复后（2026-10-15 17:15 +08，修复实施者；代码树 `dad1ed1c`，base `21cb29eb`；D28）：

- 验收 1：fork 同名 PR 不再造成短页（F1）。core 端到端证据已固化进仓库，即 `tests/integration/github-development-lineage.test.js`（F2）；复评 N2 之后它也是 F1 的 core 级回归用例（第 21 条，D29）。残余：分支数或目标之前的同仓库同名 PR 超过 50，或者 fork 同名 PR 多到一次调用的 100 个平台请求内读不到目标，阈值约 100 ×（50 − 目标之前的同仓库同名 PR 数）；这种情况记为 gap，不会挂错链（复评 N1）。首页读的残余限制按 HC2 交 #233，口径是 TD-068 收窄后的那一句。
- 验收 4：脚本化平台加替身存储上的 core 端到端主键扫描成立，并已固化。录制夹具与 SQLite 上的整库扫描随 #233 验收 1，评审会话已于 2026-10-15 登记：https://github.com/SingularityKChen/harness-projects/issues/233#issuecomment-6189020205。
- 规模（`node scripts/rule-checks.mjs size 21cb29eb`，修复提交之后）：代码 881 / 1000，文档 758 / 1500。
- 变异：修复专项 F1a–F1f、E1–E4 10 / 10 `KILLED`；计划表与验收专项在最终代码树上整表重跑 34 / 34 `KILLED` 且归因一致（M1–M23、Y1、Y2、Z1–Z5、Z7、Z9、Z11、Z12）（`Artifacts and Notes`）。

技术债（TD-061..064 已于 Batch 6 手工插入 `docs/exec-plan/tech-debt-tracker.md` 的 Open 表，位置见 `Global Constraints` 的共享文件协议，TD-068（原候选 E）由协调者分配并插入；子系统均为 `packages/providers/development-github`，分支 `feature/github-development-read`）：

- **TD-061**：GraphQL 失败分类在 `planning-github-projects/src/classify.ts` 与本包 `classify.ts` 各一份，且本包多了 `requestId` 形状校验与 `retryAfterMs` 有限性校验（planning 的同一判定对几百位的 `retry-after` 仍得 `Infinity`）。延期理由：provider 之间不得 import，抽共享包需要 ADR 与边界改动。影响：一处修正分类（例如新的限流形态）时另一处可能漏改。下一步：出现第三个 GitHub GraphQL provider 或分类需要改动时，写 ADR 决定共享包或接受重复，并让 planning 也校验 `requestId`。
- **TD-062**：能力快照语义两处不一致且只在组合时采一次：本包把任何探针失败报 `degraded`，planning 把 `permission_denied` / `not_found` 报 `unavailable`；探针只读仓库，只缺 PR 权限的凭据要到单次调用才暴露。延期理由：快照刷新由宿主生命周期负责（#132 / #335），统一 planning 的映射会改变它的既有行为。影响：同一个失效凭据在规划与研发两域显示不同的能力状态；运行期失去权限只体现在调用结果与缺口上。下一步：宿主提供快照刷新时统一两域映射，并按需要把探针扩展到 PR 读。
- **TD-063**：观察流是有界全量扫描（≤ 100 页），忽略 `scope.cursor`，超限一条不产出；`updatedAt` 是秒级，评审结论变化是否推进 `updatedAt` 未实测，相同版本按 R4 走整快照替换。延期理由：目前没有消费者，增量协议应由第一个消费者（#233）定义。影响：超大仓库没有观察；同秒变化依赖去重键而非版本区分；`reconcile` 在产出前把至多 1 万个 PR（含 body）留在内存（2026-10-15 评审说明并入，D28）。下一步：#233 消费观察时定义水位线协议，并做一次评审结论变化与 `updatedAt` 的只读实测（已登记为 #233 验收：https://github.com/SingularityKChen/harness-projects/issues/233#issuecomment-6189020205）。
- **TD-064**：仓库按 owner/name 寻址，没有固定仓库 node id；改名、转移或删除后同名重建时，provider 会读到另一个仓库或报 `not_found`。延期理由：固定 node id 需要宿主在绑定仓库时取得并保存它，属 #127。影响：同名重建的仓库可能被当作同一个仓库读取（分支名与 sha 相等的巧合下才会误挂谱系）。下一步：#127 绑定仓库时保存仓库 node id，provider 增加可选的 `repository.nodeId` 核对（不一致即 `not_found`）。
- **TD-068（原候选 E，协调者于 2026-10-15 13:36 +08 分配，见 D27）**：core 的分支与变更请求查找只读首页（50 项），本 provider 的分支按字母序，分支多于一页且 `work/<id>` 排在首页之后时谱系读为缺口（fail-closed，不会挂错链）；分支一半与 TD-040 同根。（2026-10-15 评审 F1 后收窄，D28：fork 同名 PR 不再造成短页；变更请求一侧剩下的是目标之前有 50 个以上同仓库、同 head 分支的 PR，或者 fork 同名 PR 多到一次调用的 100 个平台请求内读不到目标，阈值约 100 ×（50 − 目标之前的同仓库同名 PR 数）；这种情况记为 gap，不会挂错链（复评 N1，D29）。已登记为 #233 验收：https://github.com/SingularityKChen/harness-projects/issues/233#issuecomment-6189020205。）延期理由：根因在 core（#233 的范围），本 PR 禁改 core；换排序无效（第 16 条）。影响：分支数超过 50 的真实仓库里，Start Work 分支的谱系读不到提交与 PR。下一步：#233 让两处查找有界翻页直到找到，并补一条多页分支的合成用例。

## Bottom Change Note

- Change Note (2026-10-15)：创建本计划。三份设计（契约夹具优先、GitHub API、身份与最小化）经独立评审收敛：采纳 GraphQL、夹具先行录制、探针快照报 `degraded`、修正共享套件 `declares()`、实现 `reconcile`、不写沙箱、不做 core 级集成测试；规模估计代码约 610、文档约 650，单 PR 不分栈。
- Change Note (2026-10-15 10:45 +08)：跨 PR 整合评审修订，逐条对照代码与 A、B、D 计划核实后全部采纳，只修正一条理由（D17：点名复跑 A 的 `harness-plugin-host-providers.test.js` 的价值是并集共存，不是 `declares()` 的影响面）。改动：`Interfaces and Dependencies` 写明 `development.github` 目录条目交接（`repositoryExternalId` / `repositoryOwner` / `repositoryName`、A 的 `githubGraphqlTransport`、句柄 `HARNESS_PROJECTS_GITHUB_TOKEN`、组合期探针计入 #344 登记的首轮水合触网债务；D15）；`Global Constraints` 新增跨 PR 共享文件协议，Active 行插在分隔行正下方、冲突时按计划文件名排序，TD-061..064 按编号就位（D16）；新增不入栈与合并次序 C → D → A → B、合并前四步与合并后回读、宿主会话窗口（D17）；Batch 1 录制与 Batch 6 重录不得与 S-AB Phase 2 重叠（D18）；Batch 6 加并集验证，`Validation and Acceptance` 加两条并集命令与人类门 HC1（D20）；规模重估为代码约 690、文档约 700，760 收缩触发线与收缩顺序不变（D19）。
- Change Note (2026-10-15 11:50 +08)：Batch 5 对抗验证回填。M1–M23 全部 KILLED；越表变异、手工反例与 core 端到端接缝实验的结论写入 `Surprises & Discoveries` 第 11–15 条，处置边界写入 D22。唯一改动的既有正文是 `Interfaces and Dependencies` 里 #233 的建议句：原句称 core 的分支查找会翻页，与 `chain-facts.ts` 不符（两处查找都只读首页），改为与代码一致的建议。文件集合、验收口径与规模预算不变；补洞用例会使代码读数逼近上限，Batch 6 需按收缩顺序取舍。
- Change Note (2026-10-15 12:06 +08)：Batch 5 余项处置（修复者）。正文改动：`Purpose` 与 `Design / Spec` 的「不抛错」加宿主时钟例外；分类表后加 `retryAfterMs` 有限性；Batch 2 的 membership 用例由「合成 + 录制」改为「合成」（回放的 `cr-absent` 由共享套件覆盖）；Batch 5 期望条补补洞记录。新增 `Surprises & Discoveries` 第 16 条与 `Decision Log` D23–D25，技术债候选加 E 并补 TD-061 的分歧。文件集合不变；规模见 D24。
- Change Note (2026-10-15 12:40 +08)：Batch 6 独立验收回填（Opus 验收者）。正文改动：Batch 6 前五个步骤勾选并带实施记录；`Validation and Acceptance` 验收 1 的强度格补口径、人类门加 HC2（D23 原本只在 Decision Log 里）；新增 `Surprises & Discoveries` 第 17–20 条、`Decision Log` D26；`Progress` 把 Batch 6 拆成验收者已完成与协调者余项两行；`Outcomes & Retrospective` 写入现状、偏差与回顾，技术债段改为已入表；`Artifacts and Notes` 写入最终树整表的 spec 全文与读数。文件集合不变；代码改动只有 `050a6c58` 与 `ee2db4e5`。
- Change Note (2026-10-15 17:15 +08)：评审修复（review id 5530341948 的 F1–F4 与 PR 级说明，D28）。正文改动有以下几处。`Design / Spec`「分页」原句标 Superseded，并新增「按 `headBranch` 的列表先过滤再分页」一段；读方法表与 `first` 的说明补了续取。文件集合加 `tests/integration/github-development-lineage.test.js`，provider 与契约测试两行的批次加「评审修复」。被放弃方案表与 D12 标部分 Superseded。`Validation and Acceptance` 验收 1、4 与 HC2 加注。第 4、18 条，以及 D21、D26 标 Superseded。新增第 21 条与 D28。F4 的 TD 编号改写见 D28。Outcomes 的三处就地标注，并新增「评审修复后」一段。Progress 勾选 Batch 0 与协调者余项，并新增评审修复一条。`Concrete Steps` 的 Batch 0 与 Batch 6 协调者步骤勾选并补实施记录。`Interfaces and Dependencies` 的 #233 条补了三项承接。`Artifacts and Notes` 写入修复专项 spec 与整表重跑读数。TD-063、TD-068 的 tracker 行与本计划的技术债段同步加注。
- Change Note (2026-10-15 17:40 +08)：复评 P3 处置（D29）。正文改动：「分页」边界 (1) 改措辞并补上与共享套件判据的偏离，边界 (2) 补阈值；验收 1、HC2、两处 Outcomes、技术债段与 tracker 的 TD-068 补上 fork 阈值一句；验收 4、`Interfaces and Dependencies` 的 #233 条、Outcomes、tracker 的 TD-063 与 TD-068 改成已登记并附链接；第 21 条与 D28 的两句就地标 Superseded；新增 D29、一条 Progress 与 `Artifacts and Notes` 的复评变异读数。文件集合不变。
