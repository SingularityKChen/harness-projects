# GitHub 原生变更请求创建 ExecPlan

> 状态：Completed；adapter 实现、独立验收与 Ready 交付完成，等待本会话授权的评审收尾及合并；真实平台、Core/UI 与人类发布验收保持独立。
> 创建：2026-10-30（Asia/Singapore）。
> 范围：issue #436，GitHub Development adapter 的原生创建、保守权限与可对账读面。
> 依据：`AGENTS.md`、`PLANS.md`、`docs/development/workflow.md`、现有 Development port 与生产 provider；本计划是唯一实施规格。

## Purpose / Big Picture

完成后，显式调用 GitHub Development provider 的 `createChangeRequest` 能为同仓库两个合法分支创建原生 PR，并返回核对身份后的平台对象。
若 mutation 已发送但回执丢失，结果必须是不可盲重发的 `ambiguous_result`；body 中的操作标记仍可通过现有 get/list/reconcile 读回。
最小证据是生产构造函数在严格合成 GraphQL transport 上的创建、读回、丢回执及错误矩阵，加原录制读回归、共享契约与谱系回归。
这证明 adapter 闭环，不证明已安装 Host、真实 GitHub 写入、Core 耐久恢复、UI 操作闭环或 #235/#437 产品验收。

## Context and Orientation

本计划在 2026-10-30 对 `main@7907efbbdc5e35cc8ea4769c7067e885cec844e1` 审读；实现前在检出 `feature/github-pr-creation` 的工作树根目录重读 `git status --short --branch` 与 `git rev-parse HEAD`。
隔离目录是 `.worktrees/github-pr-creation/`。用户已授权动态 subagent 开发；实施协调者可以分派互不共享写入区，批次间无需再次设计审批。

`packages/capabilities/src/development-provider.ts` 已定义 create 输入的 repository/head/base/title/body，返回对象有 body/headBranch/sourceVersion/nativeIdentity，没有 base 字段。
`packages/providers/development-github/src/provider.ts` 目前省略 create；两个 read capability 共用最近仓库读取权限，不能把新写 key 接入该共享权限表。
该 provider 已执行先按 head 字节精确过滤再分页；fork 同名 PR 的 headBranch 为 undefined；全量 reconcile 只有全部读取成功才产出。
`decode.ts` 已复用 PR 解码，`classify.ts` 给读失败返回结构化码；当前 `call()` catch 会产生可重试 unavailable，不能直接承担写回执未知。
`queries.ts` 的五段只读文本与 `tests/contract/fixtures/github-development/sandbox.json` 的哈希逐键对应，录制与 provenance 必须保留。

Host 的 `apps/harness-plugin/src/host-providers.ts` 已提供单次 POST GraphQL、凭据句柄解析和超时，无自动重发；不新增 REST 或 Host 接口。
Core 的 `packages/core/src/capabilities.ts::gateOn` 放行 Degraded 并标记 degraded，对 ReadOnly 写拒绝。
`packages/core/src/registry.ts::collectBindings` 只在组合时采集快照；provider 内存变化不会自动改写旧 registry。
Host 重组可复用 `apps/harness-plugin/src/host-composition.ts` 的 developmentCache，因此不能声称普通刷新配置一定重置写拒绝。

共享 `tests/contract/suites/development.js` 当前成功创建用 head==base，分页用同 head/base 连建两个 OPEN PR。
它们不是 GitHub 的合法成功前提，必须改正测试装配；不能让合成平台制造不可能成功或用 proxy 藏起生产 create capability。

公开 API 一手依据（2026-10-30 调查；执行者可再次核对）：

- 官方 schema：`https://raw.githubusercontent.com/octokit/graphql-schema/main/schema.graphql`，核对 CreatePullRequestInput、CreatePullRequestPayload、Repository.viewerPermission 与 Ref。
- 官方 REST 创建说明：`https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request`，写操作要求独立 Pull requests 写权限；仅用来核对权限边界，不引入 REST 实现。
- 官方 GraphQL 分页说明：`https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api`，每页 1–100，读到 hasNextPage=false 才终止。

## Design / Spec

### 选择与责任界面

| 方案 | 边界与代价 | 裁决 |
|---|---|---|
| 现 GraphQL transport + 只读预检 + 单次 createPullRequest | 复用原生身份和 PR 解码；只为写结果增加保守分类 | 采用 |
| 新 REST 写通道 + 原 GraphQL 读 | 需扩 Host transport、response decode 和身份映射，扩大测试与预算 | 放弃 |
| 权限 oracle、静态允许写开关、provider 创建账本 | 无现成权威证据，或复制 Core 操作所有权 | 放弃 |

provider 只拥有协议、输入身份、平台结果分类和易失权限证据。Host 拥有凭据及传输生命周期；Core 拥有 actor、ProviderBinding、幂等键、耐久意图和 Saved 判决。
本轮不生成/解析 marker，不建分支、不 push、不 merge、不改规划 Status 或阻塞关系。未来 #437 拥有完整创建命令与恢复；#436 不依赖其实现才能离线验收。

### 输入、预检与 ack

保持现 port。任何 await 前一次性读取 repository 身份和 head/base/title/body，组成 provider 自有的冻结 primitive 快照；getter 抛错是 invalid_input、零 transport。预检、mutation 与 ack 均使用该快照，transport request 不与 ack oracle 共用可变对象。先验证 repository 引用的 bindingId/objectKind/externalId，外来引用 not_found 且零 transport。
head/base/title 必须为非空字符串，body 必须是字符串；拒绝 head==base、裸 40 位十六进制 SHA、包含冒号的 fork 写法，invalid_input 且零 transport。
head/base 是原始本仓库分支名，不能 trim 或 case-fold。完整 Git ref 合法性由精确 `refs/heads/` 查询和 GitHub 拒绝补充，不在 provider 复制 Git parser。

新增 `DEVELOPMENT_CREATE_OPERATIONS`，只在 `queries.ts` 内导出给 provider，包含两个操作；旧 DEVELOPMENT_QUERIES 的键与五段文本逐字不动。
`DevelopmentCreatePreflight(owner,name,headRef,baseRef)` 在配置仓库根查询 id/nameWithOwner，head/base 两个 `ref(qualifiedName:...)` 的 name/prefix/repository.id/target.__typename/Commit.oid。
headRef/baseRef 由 `refs/heads/` 加原输入形成，不跟随响应 URL。核对本仓 node id、owner/name（仅配置仓库标识可忽略大小写）、分支名、prefix 和 Commit 形状。
null 仓库或 ref 是 not_found；畸形响应 unavailable；仓库/分支身份不一致 conflict；任一失败零 mutation。预检不证明 PR 写权限。

`DevelopmentCreateChangeRequest` 调用 createPullRequest(input:$input)，repositoryId/headRepositoryId 使用同一预检 id，headRefName/baseRefName/title/body 使用原输入。
不添加 clientMutationId：官方只保证它是客户端标识，没有幂等承诺。不指定 draft/maintainerCanModify，采用平台默认行为。
mutation 返回原 PR fragment，另取 repository.id/headRepository.id/baseRefName。核对同仓、非 fork、精确 head/base/title/body，然后复用 PR decoder。
只有完整 ack 才 providerOk；返回 sourceVersion 必须是 ack 的真实 headRefOid。预检与创建之间分支可能移动，API 无 expectedHeadOid，不能伪造提交锁定。
错误仓库/head/base/body/title、null/缺字段/非法 number 或 SHA 均是 ambiguous_result，不显示 Saved。

### 权限与安全恢复

三个已实现 key 的 capability 均 Available；read 的 permission 沿原真实仓库读取维护。单独保存 createPermission，初始 Degraded，不能从 viewerPermission 或 read 成功推导写 Available。
Degraded 是未知证据，按现 Core gate 允许用户显式单次尝试；没有静态开关绕过 GitHub 授权。可信 create ack 才将 createPermission 置 Available。
明确无 payload 的写拒绝置 ReadOnly；限流/未知写结果置 Degraded。写结果不改 read 权限，read 成功/失败也不清除写拒绝或确认。
ReadOnly 在 provider create 入口结构化 permission_denied、零 transport；预检 await 后、发送 mutation 前再次复验。它在同实例内黏住：已经发送的迟到 ack 仍如实返回平台对象，但 ack、ambiguous 或限流都不能把 ReadOnly 改回 Available/Degraded，以防旧 registry 快照重新启用写入。
同一 provider 实例的 eager/lazy describe 和 getRepository 均不能解除 ReadOnly；lazy describe 仍零请求，并保留最近实际探测时间。

补权后的安全恢复是显式重建 provider，然后用新实例重新 collectBindings；新实例只回到未知 Degraded，下一次真实 ack 才可确认 Available。
已安装 Host 的最小操作是补权后重启整个 Host composition，清空易失 provider/cache；普通 read、配置刷新或同实例重组不保证恢复。
本轮用重建工厂和新快照验证这个边界，不新增 resetPermission API，不声称已安装 Host 恢复通过。Core/Host 自动刷新留给独立后续。

### 写结果分类与一次发送

| 证据 | ProviderResult / permission | 恢复 |
|---|---|---|
| 本地输入或预检失败 | 既有 invalid_input/not_found/conflict/读分类；不建立写事实 | 改输入或重做预检 |
| 无非空 mutation payload 的 401/403/FORBIDDEN/INSUFFICIENT_SCOPES | permission_denied；ReadOnly | 补权并显式重建 |
| 无非空 mutation payload 的明确 429/限流拒绝 | rate_limited；Degraded；保留净化 retryAfterMs/requestId | 调用方决定后续，provider 不重试 |
| send 后 reject/timeout/5xx、未知 GraphQL error、data+errors、null/坏 ack | ambiguous_result、retryable=false；Degraded | 完整读回对账 |
| 完整身份一致 ack | providerOk；Available | 使用原 PR，不再 create |

部分 payload 与任何错误同时出现时优先 ambiguous，不能让 FORBIDDEN/限流覆盖“可能已生效”。未知 validation 错误不凭平台文案猜测未执行。
最小实现是局部 mutation wrapper，复用 classifyResponse/requestIdOf；读 call 和读分类行为不变。所有错误固定安全文案，不回显 body/header/token/异常。
provider 每次允许的显式调用至多一次 mutation，不 retry/backoff；Host transport 的注释同步明确 mutation 不允许自动重发。

### marker 与对账读面

body 是现 port 的标记载体，逐字发送和读回；测试使用固定完整 canary 行，不把本轮测试格式升级为全系统 marker 协议。
Core 后续恢复必须在同 repository/head/limit scope 从 cursor undefined 读完，再按完整 marker 精确匹配，区分零/一/多候选。
第二页失败、游标循环或扫描预算终止都不能证明唯一或不存在；reconcile 静默失败零观察不能作为否定证据。
本轮验证现 list/get/observation 保留 marker、分页暴露全部候选与结构化故障；不在 provider 写“取第一条即确认”或完整 Core 对账器。

### 共享契约的合法输入

采用双 base，而非新增历史种子接口。为声明 create 的装配要求 `expect.changeRequest={head,alternateBase,decoyHead}`，base 沿用 baseBranch。
具名校验缺字段；head/decoyHead/baseBranch/alternateBase 的组合必须合法，head 不等于任一 base、decoyHead 不等于 baseBranch。
成功/投影/ambiguous 用例都用明确 head；lineage 继续用已预置的 worktreeBranch。未声明方法仍测 not_supported 和无副作用，不要求新装配字段。
分页过滤建立同 head 的两个 PR，分别以 baseBranch 和 alternateBase 为 base；decoy 使用不同 head。两 base 与 head 均预置，且 head 相对各 base 有差异提交。
保留每页恰一命中、完整集合、不重不漏、字节精确、fresh objects、全部现 liar 的判别断言；不加 provider 名称分支或 skip。
fake 装配复用预置分支；只读/local-git 装配不新增无用字段。增加缺 create 装配字段的负控并保留原 liar 清单。

将共享 suite 的 GitHub 注册从只读录制文件迁到新合成创建文件，使用同一生产构造函数及真实 create capability。
新 transport 严格匹配 operation/variables，并维护平台对象，拒绝 head==base、重复 OPEN pair 与 fork 创建；每个 makeProvider 新实例隔离用例。
fixture 支持所有既有读操作、平台先分页且可带 fork 诱饵，objects 返回平台对象的新鲜 clone，不能用请求计数代替对象状态。
shared ambiguous 场景可模拟未写入的未知失败；专项 dropped-ack 场景必须先创建后 reject，证明 mutation=1 且 marker 可读。
原录制读查询、sandbox.json、provenance 和 queryHashes 原样保留；只更新 capability/permission 断言为“两 read + 独立 create”。合成写 fixture 不冒充真实平台录制。

## Global Constraints

唯一允许文件集与设计阶段的 A+D 预测如下（各文件允许按真实缺陷调整，最终总量以 Outcomes 计数）；A+D 同时计算新增和删除，包含测试/fixture/config，排除 docs 后严格小于 800。

| 文件 | 预算 |
|---|---:|
| `packages/providers/development-github/src/provider.ts` | 150 |
| `packages/providers/development-github/src/queries.ts` | 30 |
| `packages/providers/development-github/src/decode.ts` | 60 |
| `packages/providers/development-github/src/transport.ts` | 6 |
| `packages/providers/development-github/src/index.ts` | 6 |
| `tests/contract/development-github-create.test.js`（新） | 185 |
| `tests/fixtures/github-development-create.mjs`（新） | 145 |
| `tests/contract/development-github-contract.test.js` | 80 |
| `tests/contract/suites/development.js` | 65 |
| `tests/fixtures/development-suite-adapters.mjs` | 20 |
| `tests/contract/development-contract.test.js` | 15 |
| `tests/integration/harness-plugin-host-github-catalog.test.js`（必要快照断言同步） | 4 |
| `tests/e2e/repository-routing.test.js`（真实 capability 子集装配同步） | 10 |
| 合计 / 严格上限前余量 | 776 / 23 |

文档只改本 ExecPlan 与 `docs/README.md` 索引；本轮目标约 300 行，最终 docs A+D 严格小于 1300。完成后按 PLANS 将计划移 completed；移动用 rename 检测计算。
不改公共 capability/domain/Core/controller/client/UI/Host/storage/工作流/package/lock；无新依赖、迁移、权限配置项或持久账本。
若出现确实需要改 allowlist 外文件的证据，先写入本计划并重估全部 A+D；不由实现者默默扩界。
严格预算是交付门禁，仓库较宽的 size 检查不能替代。任一批预计总量达到 800，立即停写并重划最小闭环；不得缩行、隐藏生成物或删失败矩阵凑数。
先消除测试装配重复、复用 decoder，再重估；若仍超限，协调者裁决拆分，#436 不带未完成声明交付。

## Plan of Work

### Concrete Steps

以下命令均在检出 `feature/github-pr-creation` 的隔离工作树根目录运行。开始先按 AGENTS 检查 worktree realpath、Git 状态与允许根目录；保留既有他人改动。
协调者是唯一集成 owner；provider/query/decode 属同一架构单元，由一名实现者修改。共享 suite/fixture 可由另一名 agent 独立修改，专项测试与两者约定操作名后集成。
独立验收者不与实现者共写文件，负责矩阵、预算与事实边界；所有批次完成后由人类决定是否合并。

### Batch 1 · 合法共享输入与失败契约

最小闭环：把共享套件改为平台合法输入，保留坏实现判别，并使专项 create 测试在生产缺实现处 RED。
主文件：共享 suite、通用 adapter fixture、development-contract 测试及新 create test/transport fixture。
先算共享修正实际 A+D，再补缺字段负控；实现严格双 base 平台，注册同一生产 provider，不触外部 GitHub。
用参数表先写下一章节所有 mutation/permission/identity 红例；红必须定位缺 create 或错误行为，不能只红在测试装配/模块解析。

    pnpm run test:file tests/contract/development-contract.test.js
    pnpm run test:file tests/contract/development-github-create.test.js

期望第一条零失败，全部既有 liar 子进程仍被具名断言拒绝；第二条在未实现生产 create 时可归因失败，记录 RED 输出与 head。
回滚：仅撤销本批自己的测试差异；不触已有录制文件，不清理用户数据。

### Batch 2 · 生产预检、mutation 与权限闭环

最小闭环：生产方法按规格真实组装请求、核对 ack、区分明确拒绝与未知结果，并可通过原读面读回同一对象。
主文件：provider、queries、decode、transport/index 注释，以及旧 GitHub contract 注册/快照断言。
实现纯预检/ack 解码，再接 mutation wrapper 和独立 createPermission/ReadOnly 入口门；每完成一组矩阵由 RED 转 GREEN。
注册迁移只改 suite 装配，不删除旧录制读/lineage/query drift/provenance/canary 测试。

    pnpm run test:file tests/contract/development-github-create.test.js tests/contract/development-github-contract.test.js tests/contract/development-contract.test.js
    pnpm run test:file tests/integration/development-local-git.test.js tests/integration/github-development-lineage.test.js tests/integration/harness-plugin-host-github-catalog.test.js
    pnpm run typecheck
    pnpm run boundaries

期望 fail 0；read replay misses=[]；合法创建 mutation=1；坏输入/预检/ReadOnly mutation=0；dropped ack mutation=1 后仍能读 marker。
回滚：撤回完整 adapter 闭环，恢复只读 capability；任何真实远端 PR 不删除，未知写结果必须先对账。

### Batch 3 · 独立验收、交付与计划收尾

最小闭环：独立审读确认源代码、测试矩阵、规模与发布面一致，交给人类可审阅的 PR。
主文件：本 ExecPlan 和 docs 索引；不以新增产品代码扩大本批范围。

    pnpm verify
    node scripts/rule-checks.mjs size origin/main
    node scripts/rule-checks.mjs disclosure origin/main
    git diff --check origin/main...HEAD
    git diff --numstat --find-renames origin/main

期望本地验证零失败、机械扫描零命中，并人工累加 numstat 中代码/测试/config <800、docs <1300；复核暂存/未暂存和新文件均计入。
新文件尚未被 Git 跟踪时不能只看 diff；用 `wc -l` 逐项补入后再对最终提交重算。整理临时/fixup commits 后重新检查敏感五类目。
交付 owner 依根流程关联 `Refs #436` 或 `Closes #436`，最终 push 后回读当前 head/base/issue/checks 和全部 review threads，再决定 ready；不自动 merge。

    gh pr view --repo SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup,reviewDecision
    gh pr checks --repo SingularityKChen/harness-projects

命令按当前分支解析 PR；期望 base=main、issue #436 关联且最终 head 的必需 PR Fast Gate 通过。全部线程通过 docs/review/responding.md 的 GraphQL 查询分页读完。
远端读回不是本地测试证据；未运行真实 sandbox mutation 必须明写。验收全过才移动 completed 并更新索引；发现延期风险时按 tracker 记债。
回滚：保留当前审阅分支/计划，撤回本 PR 实现；不推 main、不合并、不删除任何远端对象。

## Validation and Acceptance

| # | TDD 矩阵 / 验收项 | 判定证据 |
|---|---|---|
| 1 | capability 与方法一致 | 三 key Available；create 存在；review/worktree/其他写面未扩散 |
| 2 | read 不证明 write | read 成功后 read Available/create Degraded；viewerPermission 不参与写授权 |
| 3 | 权限拒绝与恢复 | 403 后 create ReadOnly；同实例 read/describe/再调用不解除且零 mutation；新实例+新 registry 只回 Degraded，真实 ack 后 Available |
| 4 | 本地输入闸门 | foreign binding/kind/key、空 head/base/title、非字符串 body、相同分支、SHA/fork notation；零 transport |
| 5 | 预检身份 | null/ref不存在、错误仓库名/id、ref name/prefix/repository、非 Commit/坏 SHA；零 mutation且结构化失败 |
| 6 | 精确 mutation | 原操作名/输入、两个 repo id 同值、body marker 原文、原生 PR node identity/number/真实 sha |
| 7 | ack 不可假确认 | null、畸形、错仓/fork/head/base/title/body、非法 number/SHA，全部 ambiguous且不可重试 |
| 8 | 写失败分类 | 401/403/FORBIDDEN/SCOPES、429/secondary rate、5xx/reject/timeout、未知 errors；partial payload优先ambiguous；canary不泄漏 |
| 9 | dropped ack | 平台先建后reject；mutation=1，get/list/reconcile读同对象/marker；没有自动retry |
| 10 | 完整读面 | 同 marker两个候选跨页可读；fork同名不入本仓head候选；第二页失败/循环/预算上限不产出伪完整性 |
| 11 | 共享 suite 诚实 | 双base成功；fixture拒绝非法/重复open pair；所有原liar仍被拒；缺新装配字段具名失败 |
| 12 | 录制与谱系 | 五段文本/queryHashes/provenance原样、replay misses=[]；原读/Host目录/lineage/local-git回归通过 |
| 13 | 严格规模与边界 | 最终全部A+D代码<800/docs<1300，typecheck/boundaries/verify通过，发布面五类目复核 |

矩阵 10 只验证 provider 读证据与已有分页约束；完整 marker 唯一判决、耐久账本和 Saved 状态机属于 #437，不能在本 PR 测试标题中冒充已完成。

## Progress

- [x] (2026-10-30 10:00 SGT) 独立审查两个方案、PLANS/AGENTS、生产 provider/Host/Core gate 与共享 suite，定稿最小方案。
- [x] (2026-10-30 SGT) Batch 1：`feature/github-pr-creation@4375505` 上先写测试；双 base 与新增缺装配字段负控后 `pnpm run test:file tests/contract/development-contract.test.js` 本地 95/95 pass。新创建专项在缺少生产 create 方法处出现预期 RED（7 个专项失败）；运行日志留在工作树外临时目录。
- [x] (2026-10-30 SGT) Batch 2：生产预检、单次 mutation、严格 ack 与独立权限已实现。原创建专项 21/21 GREEN，首轮扩展后的 24 项专项、录制/Local Git/谱系/Host 回归均已纳入最终完整验证；原始五段 query/hash/provenance 文件无改动，replay misses 自检通过。
- [x] (2026-10-30 SGT) Batch 3 本地部分：固定 pnpm 10.28.2，`pnpm verify` 首次实现为 typecheck 成功、2563/2563 产品测试和 7/7 MVP pass；`pnpm run boundaries` 9/9 pass，`node scripts/workflow-check.mjs` 无发现，`git diff --check` 成功。人工五类目复核未发现凭据、本机身份/路径、个人信息、内部系统或保密内容。
- [x] (2026-10-30 SGT) 独立审查修复：原 `0c8ba52` 在输入别名与并发拒绝上有两项 P1。新增 9 项有判别力回归先得到 8 fail / 1 pass（原 transport 篡改负控保持通过）；primitive 快照与 ReadOnly latch 最小修复后，完整 create 专项 33/33 pass。修复后 `pnpm verify` 为 typecheck 成功、2572/2572 产品测试和 7/7 MVP pass，`workflow-check` 无发现、`git diff --check` 成功；独立限定复评 52/52 与两组修正 probes 通过，两P1均确认 addressed。
- [x] (2026-10-30 SGT) Batch 3 独立验收与源码交付：协调者复核完整审查和限定复评，在当前 main 基线上重新运行 2586+7；源码 head cf7873f 的 hosted checks 全成功、closing #436/base main/CLEAN/空 review threads 已回读。文档归档后的最终 head 仍执行同一远端检查规则，满足后才设置 ready；合并留给人类。

## Surprises & Discoveries

共享 suite 的 head==base 与重复 OPEN pair 会逼真实 adapter fixture 造假；双 base 保留现分页逻辑，成本低于新增历史对象装配协议。
Core Degraded 允许显式尝试，不能把未知写权限误读为一律拒绝；同时 cached registry 不随写 403 自动刷新，provider 必须有本地 ReadOnly 拒绝门。
Host 重组可能复用 developmentCache，因此“读成功即解除写拒绝”与“普通重组一定恢复”都不成立；本轮采用显式新实例/完整 composition 重启边界。
原录制查询不可加入未录制 mutation 哈希；新增操作独立分组保存原读证据，无需伪重录。
扩大回归出现唯一旧断言失败：Host 目录缓存测试精确期待只有两个 read permission key；新增 create capability 后必须把 create 的独立 Degraded 写入期望。该断言同步不涉及 Host 实现，已在允许文件表加入；首次扩大回归为 169/170 pass。
首次完整 `pnpm verify` 的产品测试为 2562/2563 pass，唯一失败是 `repository-routing.test.js` 的 GitHub 型替身仍禁用 create，声明集合与生产不一致；因此只扩充该 e2e 装配，创建权限仍未知。自审还发现合成平台各分支同 SHA，补充零差异 pair 拒绝测试先 RED（Missing expected rejection），再为两个 base 配不同提交并拒绝零差异。
最后的混合坏形状测试先 RED：ref 名称不匹配时，短路判断漏过缺失的 ref.repository，把畸形响应报成 conflict。改为先完整读取形状再比较身份后，最终 `pnpm verify` 全绿；这只纠正预检错误分类，所有失败仍零 mutation。

独立审查在 `0c8ba52` 复现两个此前 GREEN 未覆盖的 P1：ack 再读 caller input，可能确认未发送 marker；并发 preflight 或迟到 mutation 结果可能解除明确写拒绝。复现回归先 RED 后 GREEN；修复只固化一次意图快照和同实例拒绝 latch，不加锁、第二账本或 Core 状态。

## Decision Log

- 2026-10-30：本轮人类直接授权“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → `merge_method=rebase` 合并”。本 PR 首轮仅 R464-D1/P3；由本评审会话修正归档状态、保留验收边界，并在当前 head 复评和门禁通过后 rebase 合并。


- Decision：采用 GraphQL 两阶段，复用 port 与 Host。Rationale：最小跨层面，原生身份统一。Date/Author：2026-10-30 SGT / 独立计划审稿者。
- Decision：createPermission 独立、Degraded 可单次尝试、明确拒绝 ReadOnly、新实例恢复未知。Rationale：read 不证明 write，且兼容现 Core gate/registry。Date/Author：2026-10-30 SGT / 独立计划审稿者。
- Decision：选择合法双 base 共享套件，保留全部 liar。Rationale：既保留两候选判别力，又少于新增种子协议的改动。Date/Author：2026-10-30 SGT / 独立计划审稿者。
- Decision：body 原样承载 marker，send 后未知统一 ambiguous。Rationale：无服务端幂等承诺，确认与耐久恢复归 Core。Date/Author：2026-10-30 SGT / 独立计划审稿者。
- Decision：按 Global Constraints 严格计数停线。Rationale：<800/<1300 是本次交付要求，不用弱化测试换取规模。Date/Author：2026-10-30 SGT / 独立计划审稿者。

- Decision：允许同步 Host 目录缓存测试的权限快照断言，create 独立期待 Degraded。Rationale：首次扩大回归揭示旧断言忽略新增 key，不能靠隐藏真实 capability 修复；协调者明确同意，只扩测试不改 Host。Date/Author：2026-10-30 SGT / 实施者与协调者。

- Decision：同步 repository-routing 的 GitHub 型替身为两读加 create，permission 的 create 仍 Degraded；为合成 main/release 预置不同 base 提交。Rationale：完整回归与自审暴露测试前提漂移，协调者同意必要装配修复；无产品扩界。Date/Author：2026-10-30 SGT / 实施者与协调者。

- Decision：使用冻结的 primitive 意图快照作为唯一 ack oracle，并使 ReadOnly 仅由新实例恢复未知。Rationale：独立反例证明 mutable caller 与迟到结果能推翻发送意图/明确拒绝；保留已发送成功的真实对象，同时隔离权限状态，零新增框架。Date/Author：2026-10-30 SGT / 实施者，协调者授权修复。

## Idempotence and Recovery

读查询、预检、文档和测试可重复。mutation 无去重承诺，ambiguous 之后先完整读回；零/多候选或读不完整时保留未知，不原样重发。
权限补齐不解除旧 ReadOnly；显式重建 provider/registry 后只允许下一次人工明确操作尝试。Host cache 依赖完整 composition 生命周期，不能宣称瞬时热恢复。
批次撤回只还原自己改动；已发送平台写入不能靠 git revert 撤销，不删除 PR/branch/用户数据。必要重划范围就在原结论处标注 Superseded 并记录下一道门。

## Interfaces and Dependencies

保持 DevelopmentProvider 和 GraphqlTransport 类型不变。外部新增行为仅 createPullRequest；凭据只由 Host 句柄取得，provider 不持久化或输出仓库 node id、token、响应正文。
Core 后续调用者提供 actor/ProviderBinding/幂等键和 marker，拥有 pending 与 ack/reconcile 后确认；本轮不实现 #204/#437 的存储/命令部分。
依赖现 Node>=22、pnpm 锁定版本和仓库测试入口；离线合成测试无需凭据/联网。真实平台 sandbox 创建需独立明确授权，此计划不把它作为已执行事实。

## Outcomes & Retrospective

2026-10-30 10:57 SGT / 协调者：独立审查原 head 发现两项 P1（可变输入 ack oracle、并发解除 ReadOnly），均以有效 RED/GREEN 修复，限定复评 52/52 与独立 probes 通过。更新到 `main@b19b4eac4f12aa40c05d75b492f3335299874641` 后，在 `feature/github-pr-creation` 的源码 head `cf7873f9e331225dd11755b52b3d52ed012bb6db` 重新执行 `pnpm verify`，2586+7 全通过。GitHub PR #464 当前源码 head 的全部 checks 成功，包含 PR Fast Gate、Merge Gate、CodeQL 与规则检查；线程分页回读为空，base=main、mergeState=CLEAN，仍由人类评审决定合并。

实际代码/测试/config 增删 590；最终文档用 `node scripts/rule-checks.mjs size origin/main` 重算，须 <1300。本次归档与索引只改文档，最终 push 后仍重新核对相同门禁；不沿用旧 head。PR/issue 双向 closing、assignee、标签、milestone 和 Project 字段已按实际结果维护，规划 Status 和原生依赖未写。外部 actor=SingularityKChen，目标 GitHub repository/project10，幂等键 `2026-10-30:436:delivery`，结果为同一 PR 更新。

本轮已实现 GitHub adapter 的原生创建闭环：严格预检、一次 mutation、完整回执核对、保守未知结果、独立写权限与 body 标记读回；合成平台和全部本地回归通过。没有发出真实平台 mutation，没有证明真实 GitHub 写入、已安装 Host、#235/#437 端到端闭环或 hosted CI。
执行上下文为 `.worktrees/github-pr-creation`、`feature/github-pr-creation`；起始 head `4375505`、实际 base `2c599d6`。首轮源代码/测试/config A+D 为 484；两项 P1 修复后为 590，包含全部新文件和两处经确认的必要旧装配更新，低于严格 800 门禁；文档 294，低于 1300。工作区外日志只作运行态证据。
协调者报告基线 `pnpm verify` 为本地 2551+7 pass；此为转交证据，不是本审稿者运行、当前实现验证或 hosted CI，实施者必须按批次补真实命令结果。
剩余边界：分支预检无 CAS、marker 可被平台用户编辑、registry 权限快照不自动刷新；不偷偷补第二状态机。若实施出现非范围内可靠性折衷，先写 `docs/exec-plan/tech-debt-tracker.md` 再接受延期。

### Artifacts and Notes

本计划已记录各批命令、起始 head、实际 base、RED/GREEN、完整验证和 A+D；原始日志留在临时运行态目录，不进入正式 docs。未新增已批准技术债；独立验收及远端证据由交付协调者补齐。

## Bottom Change Note

Change Note (2026-10-30 SGT)：独立综合两份方案并核对当前源代码，选定 GraphQL、双 base 测试与显式实例重建权限恢复；限定 adapter 证据，写入严格预算和可执行 TDD/交付门禁。计划仍 Active，全部产品实现待执行。

Change Note (2026-10-30 SGT)：记录 Batch 1 真实 RED/GREEN，以及首次扩大回归暴露的 Host 目录旧快照断言；扩展允许测试写集并重估预算，产品边界不变。

Change Note (2026-10-30 SGT)：记录首次完整验证唯一旧装配失败及同 SHA 合成前提修复的 RED；扩充必要 e2e 测试允许写集。

Change Note (2026-10-30 SGT)：记录生产实现、自审两条真实 RED/GREEN、最终完整本地验证与 484 行代码规模；保留独立验收、远端回读及真实平台证据的未完成边界。

Change Note (2026-10-30 SGT)：独立审查发现两项 P1 后补真实 RED，固化 provider 自有意图与同实例 ReadOnly 黏性；记录专项 33/33 GREEN，等待全量重验和 scoped recheck。

Change Note (2026-10-30 SGT)：两项 P1 修复后完整本地验证 2572+7 全通过；当前代码 A+D 590，保持 scoped recheck 与远端交付未完成边界。

Change Note (2026-10-30 10:57 SGT)：记录独立两P1修复、最新 main 本地回归及源码 head hosted checks，归档计划并保留实际平台/产品验收边界。

2026-10-30：MMP 首轮评审仅发现归档页首状态残留 P3，更新当前阶段并记录本会话条件合并授权；不扩大 adapter 验收。
