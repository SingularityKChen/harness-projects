# GitHub Actions 精确提交只读事实 ExecPlan

> 状态：Active；设计与计划已收敛，产品批次未实施。
> 创建：2026-10-07（Asia/Shanghai）
> 关联：同仓 issue #232；规范：`PLANS.md`。
> 执行上下文：检出 `feature/github-actions-read` 的工作树根目录；隔离目录 `.worktrees/github-actions-read-plan`。

## Purpose / Big Picture

调用方可以对明确仓库与不可变提交读取 GitHub Actions workflow runs 和 Checks；workflow 可再按 branch 筛选。每条运行保留原生状态，只有明确完成的成功才形成 CiPassed；读取不完整、未知、失败或限流不能冒充成功，CI 事实不改变规划状态。

最小成功证据是只读真实 adapter + 合成录制 transport 通过同一 Delivery suite；第二页失败检查经真实 core 查询产生 CiFailed/ci_failing，三种 StatusPolicy 下规划存储逐字不变。当前闭环是离线库级交付，不宣称真实凭据、Host 默认挂载或发布门已完成。

## Context and Orientation

调查快照为 2026-10-07 23:05 +08:00、`main@6417d45978ec22778b914a9d7dea91d71fb6bb6e`。执行前 `git rev-parse origin/main HEAD` 回读；官方文档在同日核对。

`packages/providers/delivery-github-actions/src/index.ts` 当前只有 packageId。`packages/capabilities/src/delivery-provider.ts` 的 pipeline 输入有 commit、无 branch；checks 只有 changeRequest 输入。`ProviderCheckRun` 也没有 commit，无法证明检查属于调用方已观察到的 head。

`packages/core/src/chain-facts.ts::readPipelines/readChecks` 目前只读第一页；`factFor` 只看 conclusion，因此 in_progress + success 会误成 CiPassed。现 checks 只有 CR observed 才读取的门必须保留。

core 已掌握 repository/head；Delivery 自己 GET 当前 PR 再读 head 会引入另一个权威读取时刻。pre-MMP 无真实用户/数据，直接升级端口及全部已知调用点，不做兼容回退。

`tests/contract/suites/delivery.js` 的 optional deployment/environment 用例按方法 presence 判断，且 disabled 时强求至少一个方法存在；诚实省略这组能力会假红。应在此 adapter 闭环内局部修正，不扩展 #205 到全域 suite。

现 CI 只有逐条 EngineeringFactKind 与派生提示，没有 required-check aggregate gate。workflow 同 SHA 可以有多个历史 run/attempt，旧失败与新成功均是单条事实；本项不按名字去重、不用 max id 伪造最新状态，也不把这些事实宣称为整个 PR 当前 gate。

事实是端口、分页和状态三个缺口相互影响；硬约束是精确 SHA、全页或无结果、规划/工程正交与 800 行预算。决策是注入 GET-only transport + core 唯一映射。最高不确定性是实际增删规模，A1 后必须重新估算，不以遗漏分页闭环换体量。

## Design / Spec

### 输入、事实与状态归属

直接将 checks 输入改为 required repository + commit；workflow 添加可选 branch。字段形状为：

```ts
// ProviderListChecksInput：移除 changeRequest
readonly repository: ExternalObjectRef
readonly commit: string
readonly cursor: string | undefined
readonly limit: number
// ProviderListPipelineRunsInput 新增：
readonly branch?: string
// ProviderCheckRun 新增：
readonly commit: string
// ProviderPipelineRun 新增：
readonly branch: string | undefined
```

checks 使用真实完整 SHA，不接受 branch/tag/短 SHA 替代不可变锚点。workflow commit undefined 仍允许直接列仓库，core 保持只在已观察 commit 后按 commit 读取；branch 是直接消费者可选过滤，不强制改变 core 现有 SHA 谱系范围。

Adapter 保留 native status/conclusion 与原生 run/check id；null conclusion 转 undefined。未知但合法字符串不猜结论；形状错误整页 unavailable。新增 gateState 会形成第二个 CI 判定 owner，故不采用。

core `factFor(status, conclusion)` 的唯一映射：completed + success → CiPassed；completed + failure/timed_out/action_required → CiFailed；其它状态/结论没有成功事实。cancelled、neutral、skipped、stale、null/unknown 保守无事实；非终态无论携何 conclusion 都不成功/失败。空集合不触发 every() 式聚合 pass。

Checks 显式 `filter=latest` 沿 GitHub 原生语义；workflow 保留返回的每个 run/attempt，不自创 required-check/name 去重。mixed history 可同时有 CiPassed/CiFailed，现 ci_failing 代表集合含失败事实，不是“最新 required gate 失败”的声明。

### 只读 transport 与能力

新增工厂 `createGithubActionsDeliveryProvider(options): DeliveryProvider`，稳定 definition 为 `{ implementationKey: 'github-actions', domains: ['delivery'] }`。仅依赖 capabilities/domain，不导入 core、Planning 或 Development provider。

```ts
type GithubActionsTransport = (request: {
  readonly method: 'GET'; readonly path: string
  readonly query: Readonly<Record<string, string | number>>
  readonly headers: Readonly<Record<string, string>>
}) => Promise<{ readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: unknown }>
interface GithubActionsProviderOptions {
  readonly bindingId: ProviderBindingId
  readonly repository: { readonly externalId: string; readonly owner: string; readonly name: string }
  readonly transport: GithubActionsTransport; readonly observedAt: string
  readonly permission: Partial<Record<CapabilityKey, AccessLevel>>
  readonly clock?: () => number
}
```

request 仅含静态 Accept 与 `X-GitHub-Api-Version: 2022-11-28`，无 Authorization；auth/timeout/JSON 解析由宿主 transport 拥有。此版本与仓库既有 REST 协议一致，不因文档样例升级其它 Provider。fixture 显式将两 key 的 permission 设为 available；未提供权限证据的 key 在 permission 快照不可用，不能从空数据猜权限。

options 的 observedAt、permission、bindingId、repository、transport 都必需，不自动填“已验证权限”或观察时刻；permission 中缺失的读 key 按 unavailable。observedAt 必须是可解析的带时区 ISO 时间文本，非法构造参数抛具名 TypeError；clock 缺省为 Date.now，只用于 retryAfter/reset 换算，不制造观察版本或权限事实。

只声明 DeliveryPipelineRead/DeliveryCheckRead；Actions 与 Checks 的 permission 各自独立。部署/环境不声明且省略方法。rerunPipeline/cancelPipeline 显式存在，任意引用/故障下无条件 not_supported、retryable false、零 transport。

绑定只认配置仓库：owner/repo 为合法单路径分量、拒绝分隔符/控制字符；repository ref 的 bindingId/objectKind/externalId 必须一致，foreign 返回 not_found，坏类型/空 SHA/非法 limit/cursor 返回 invalid_input，均在 transport 前。

### 请求、分页与完整性

workflow GET `/repos/{owner}/{repo}/actions/runs`，query 的 head_sha、branch 精确来自输入，branches 含 `/` 由 query 参数编码；checks GET `/repos/{owner}/{repo}/commits/{commit}/check-runs`，query 显式 filter latest。每条 head_sha 与请求 commit 复验，workflow 指定 branch 时 head_branch 也必须一致；错误定位整页失败，不能过滤坏行后成功。

每次返回一页，per_page = min(limit,100)，limit 必须正整数。cursor 为本 provider 生成的 endpoint/repository/commit/branch/page/pageSize scope，携首个 totalCount 与累计 readCount；改变 scope 或 limit 重用拒绝，不接受 URL cursor。游标 page 必须严格前进、有界。后续页 total_count 必须等于首值；累计不能超过它，没有 next 时累计必须恰好等于它，防止缺 Link 被误认完整。

Link 只解析 rel=next 页号；校验 api.github.com、固定 endpoint、当前 filters/pageSize，拒绝多 next、变 host/path/scope、回退或不可解析。后续请求从配置和当前 scope 重建，绝不向 Link URL 携凭据请求。total_count/数组/id/name/status 必须合法；同 scan count 变化、缺页、重复 id 或不结束均不能报完整。

workflow 筛选搜索上限 1000，total_count >=1000 保守 unavailable，不尝试日期切分抓无限历史。Checks 上限是最近 1000 suites，check-runs.total_count 是 runs 数，不能代替 suites 计数：每次 checks 页读取前额外 GET `/repos/{owner}/{repo}/commits/{commit}/check-suites`，per_page 1/page 1，确认合法 total_count <1000；达到边界/探针失败则该页 unavailable。checks cursor 另外携首个 expectedSuiteCount，后续探针 count 与之不等即整页 unavailable；无状态Provider从游标恢复此约束。这里只数 suites，不穷举旧历史。

core 新增一个共用 `collectDeliveryPages<T extends { ref: ExternalObjectRef }>(readPage: (cursor: string | undefined) => Promise<ProviderResult<ProviderPage<T>>>): Promise<ProviderResult<readonly T[]>>`，在 gated 内固定同一 delivery binding/scope 逐页读。记录已请求 cursor 和 `(binding,kind,id)`，页数最多 1000；任何失败、循环、重复、页数超限则返回结构化 unavailable 并放弃本次整个集合，gated 生成对应 gap。完成后才构造所有 ChainNode，第二页失败不能留下第一页 CiPassed。

collector 只接 Delivery 两类读取；不顺手修 Development 分支/CR 分页。readChecks 改为 `(context, repositoryId, commit, gaps)`，传 delivery binding 的 repository ref 与已经观察的 head；readChainFacts 保持 crFact observed 门。没有 commit 不读 pipelines，没有 CR 不读 checks，骨架不落 CI 关系。

### 错误与恢复

401/非限流403 → permission_denied；404 → not_found（不可见不等于空）；429/有明确 exhausted、Retry-After 或 secondary-rate 证据的403 → rate_limited；5xx/network reject/timeout/坏 body/分页完整性错误 → unavailable。限流分类先于普通403；retryable 复用既有八码模型。

message 固定安全文案，rawClass 是固定分类标签；只透出严格校验的 requestId。retryAfterMs 只从合法数值 Retry-After/reset 得出，范围限定 0..86400000。原始异常、stack、响应正文、请求头或 token 不进入 ProviderResult/observation/日志。

无缓存、自动重试、reconcile 或凭据存储；失败由 core gap/degraded 表达本次未知。持久 last-known/stale、Query 纯读分别归 #221/#222，本项不声称这些产品能力完成。

### 备选与依据

拒绝 CR-only + GET 当前 PR head：两次读取存在 head 竞争、多权限与失败面。拒绝 Provider 自维护 PR→SHA 缓存与 gateState：制造第二锚点/判定源。拒绝只读第一页或空集 pass：无法闭合未知/失败隔离。采用原生 facts + 精确定位 + core 全页。

官方依据（2026-10-07 核对）：[workflow runs](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository) 的 branch/head_sha、100页大小与1000搜索上限；[check runs](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference) 的 SHA/latest、1000 suites 上限；[check suites](https://docs.github.com/en/rest/checks/suites#list-check-suites-for-a-git-reference) 的 total_count；[pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api) 的 Link。参考 [GitHub CLI checks](https://github.com/cli/cli/blob/trunk/pkg/cmd/pr/checks/checks.go) 的完整读取和空结果处理，保留本产品事实/状态模型，不复制它的聚合门。

## Global Constraints

唯一允许改动集如下；当前发布只有计划与索引，其余是未来 A1–A2。

| 类型 | 路径 | 职责 |
|---|---|---|
| 当前文档 | `docs/exec-plan/active/2026-10-07-github-actions-read.md`、`docs/README.md` | spec + plan 与索引 |
| 产品 | `packages/capabilities/src/delivery-provider.ts` | 精确提交/branch 输入与事实 |
| 产品 | `packages/providers/fake/src/delivery.ts` | 同端口的仓库/SHA/branch 种子与过滤 |
| 产品 | `packages/core/src/chain-facts.ts` | Delivery 完整分页、锚点与唯一 CI 映射 |
| 产品 | `packages/providers/delivery-github-actions/src/index.ts` | 导出工厂，保留 packageId |
| 将新建产品 | `packages/providers/delivery-github-actions/src/provider.ts` | 注入协议、definition、能力、身份、GET 调用与错误 |
| 将新建产品 | `packages/providers/delivery-github-actions/src/decode.ts` | 原生页形状、cursor/Link 与饱和保护 |
| 测试 | `tests/contract/suites/delivery.js`、`tests/contract/delivery-contract.test.js` | 新定位与 optional subset 的共享证明 |
| 将新建测试 | `tests/contract/delivery-github-actions-contract.test.js` | adapter 共享 suite 与对抗矩阵 |
| 将新建夹具 | `tests/fixtures/github-actions.mjs` | 合成公开协议 envelope、严格 replay 与请求清单 |
| 将新建集成 | `tests/integration/github-actions-ci-facts.test.js` | 真 adapter → core 查询 → 规划/派生证据 |

Node `>=22`、pnpm `10.28.2`，无新依赖、SDK、真实凭据、HTTP 客户端或 Host 默认装配；不改 schema、StatusPolicy、credential 服务、Development GitHub、UI 或其它 plans。

代码/测试/夹具新增+删除合计 ≤800，文档 ≤1300。预算：adapter/decode/协议 280–320；port/fake/suite 90–110；core collector/status 70–90；合成 fixture + contract/integration 220–240；合计 660–760，留 40 行最低余量。各矩阵用表驱动和共享最小 envelope，保留每个行为的具名断言，不机械压缩算法或排除 fixture。

A1 后按实际增删与剩余断言重估，预测超过 760 即停止扩展并重审分解；实际超过800不得发布完整产品闭环，也不能宣称关闭全部 AC。范围修订必须仍有可独立验收/回滚结果，不能删完整分页、状态护栏或测试凑数。本轮计划预算是估计，不是已实现规模证据。

保持四个独立 PR，不依赖 #279/#231/#233；不写 `Status`、`blocked-by` / `blocking`，不吞并 cache/部署/发布门闭环。本轮止于计划 draft，无产品实施、ready 或 merge。

## Plan of Work

### Batch P0 · 设计、计划与 draft 发布

最小闭环：定位、分页、原生事实、CI owner、安全失败与预算明确。涉及主文件为本计划与 `docs/README.md` 单行索引。独立审评三份候选后先运行文档验证，再由发布 owner 整理文档提交和关联 #232 的 draft、回读双向关闭引用、机械填 ExecPlan/Batch。

在头部检出根目录执行：

```sh
node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js tests/contract/board-status-semantics.test.js
git diff --check
```

期望全 pass、无空白错误；另检查 13 章节顺序、索引与未来路径标记。P0 不证明 adapter 已存在或线上完成。回滚为未公开的文档差异；发布失败先查询同分支 draft。

### Batch A1 · 精确提交端口与只读 Provider 验收

最小闭环：按仓库/SHA/branch 读原生页，真实 adapter 和 fake 同过 Delivery suite，错误/未知/变更尝试 fail closed。涉及主文件为 delivery-provider.ts、fake delivery.ts、chain-facts.ts 的定位调用、GitHub Actions provider/decode 与 Delivery suite，确切集合见 `Global Constraints`。

1. `pnpm install --frozen-lockfile` 期望 exit 0。新增严格 replay：要求 method/path/query/静态 headers 完全一致，未知请求即失败，源 envelope 可 clone，记录全部请求；SHA 使用完整 40位小写十六进制，合成 owner/repo 无真实个人数据。
2. 写 `actions-exact-commit-and-branch`、`checks-use-observed-sha`、`readonly-actions-mutations-make-no-request`：同SHA不同branch、同branch旧SHA/新SHA、foreign binding、wrong response SHA、branch带斜线、坏limit/cursor；请求定位精确，坏引用/写尝试零GET。旧代码应 RED 于缺工厂/旧输入或对应断言，不接受模块缺依赖假红。
3. 直接升级端口与 fake：checks 记录 repository+commit；pipeline 记录 branch，过滤先于分页。同时改core readChecks参数与readChainFacts调用，传已观察repository/head并保留CR门，保证A1 typecheck能独立通过。suite checks 输入同仓+commit；optional deployment/environment 按实际 snapshot：unavailable+absent 合法，present 必须NS；保留 fake 声明可用环境的内容正控。不增 port 方法，因此 keyof 锁保持。
4. 实现工厂/definition 与 injected transport；输入身份→suite计数保护→GET→整页decode→ProviderPage，固定API版本。未知枚举保留原生文本，错误用既有结构化结果；rerun/cancel 永远NS，fixture前后无变且请求清单不增加。
5. 写表驱动 `actions-page-completeness-and-safe-errors`：正常多页/空页、next循环/跨scope/重复、第二页429、计数变化、workflow1000、suite999/1000、wrong shape、401/403/404/429/5xx/network。错误body/throw含token canary，输出无canary。同时验证 full fake 和只支持runs/checks adapter 同过共享suite。
6. 跑下面契约命令 GREEN；核对两种读 key 与权限证据，不用Actions权限替Checks背书。按增删重估完整A1–A2预算；保留所有具名矩阵，超过门限按 Global Constraints 停止修订。A1为内部提交，不开空类型PR、不宣称完成整个#232。

```sh
node --test tests/contract/delivery-contract.test.js tests/contract/delivery-github-actions-contract.test.js
pnpm run typecheck
pnpm run boundaries
```

以上在检出 `feature/github-actions-read` 的工作树根目录执行，期望全 pass / exit 0；请求 inventory 只有三个已定义GET endpoint，无部署或写请求。回滚整A1的core定位调用、端口/fake/provider/suite/fixture，同时恢复原checks输入与caller签名；A2尚未实施时不保留新旧双读。

### Batch A2 · 完整 CI 摄入与规划正交验收

最小闭环：完整Delivery页才成为本次观察节点，native状态经唯一core映射，三策略规划不变。涉及主文件为 chain-facts.ts 与将新建 integration；完整集合见 `Global Constraints`。

1. 写 `ci-pages-complete-before-publishing-facts`：首成功/第二页失败、第二页429、循环cursor、重复id、超过1000页，分别调用真实 getDeliveryProjection；失败必须degraded/gap且本次无该类观察事实，不能遗留第一页CiPassed。正常两页第二页failure必须被看见。
2. 写 `ci-native-status-never-guesses-passed` 表：completed success/failure/timed_out/action_required；queued/pending/in_progress携success；unknown/null/neutral/skipped/cancelled/stale；空集合。success正控产CiPassed，显式失败产CiFailed，其余均无pass；故障后不会使用fixture旧success缓存。
3. 写 `ci-facts-preserve-planning-in-all-policies`：三种StatusPolicy，各自fakePlanning/Development/Storage + 真Actions adapter；把fake commit种子换成fixture同一完整SHA，走startWork与createCR观察锚点，再query真实projection。失败检查进入CiFailed、withDeliveryLineage派生ci_failing；前后getPlanningProjection、planningStatus/content严格相等。mixed workflow旧失败+新成功保留两个id/事实，不宣称aggregatepassed。
4. 写 `ci-unobserved-anchor-makes-no-request`：未观察commit时所有Delivery GET为0；有commit无CR时check-suites/check-runs为0但pipeline正控可读。不直接调用policy helper代替生产查询。
5. 运行集成命令确认A1后的core在分页/status护栏处RED；实现共用collector并在gated中完整收集，改factFor，保持A1已升级的精确定位和原observed门。重跑GREEN，执行现lineage/statusPolicy与typecheck/boundaries。
6. 对移除completed guard、忽略head_sha/branch、只取第一页、rerun返回ok四种最小临时变异重跑对应具名用例，必须RED并撤销变异。只在隔离检出保留正常最终实现，重算最终实际预算与diff，再整理A1/A2各实现+判别提交。

```sh
node --test tests/integration/github-actions-ci-facts.test.js tests/e2e/delivery-lineage.test.js tests/e2e/status-policy.test.js
node --test tests/contract/delivery-contract.test.js tests/contract/delivery-github-actions-contract.test.js
pnpm run typecheck
pnpm run boundaries
```

在同一 `feature/github-actions-read` 检出根目录运行，期望全部pass / exit0；每个临时变异只在自己的具名assertion RED。回滚完整A1+A2的消费者、端口、adapter与配对测试；不能只回退提供者留下新调用签名。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| commit/branch定位真实 | 精确request与wrongSHA/wrongbranch负控；同SHA不同branch |
| checks不重读可变PR | requiredrepo+SHA、request inventory无pull endpoint |
| 每页安全且可完整遍历 | scope cursor/Link、无重复/不漏、total_count与suite上界 |
| 第二页故障不保留成功 | 真projection的gap/degraded与本次该类fact空集合 |
| 只有completed+success通过 | 状态表、unknown/非终态携success反例、completed正控 |
| 显式失败被观察 | 第二页failure与timed_out/action_required事实 |
| 原生历史不伪装聚合gate | mixedhistory双id双事实、latestChecks参数，不自建gateState |
| 空/限流/不可用非pass | 真实core查询无CiPassed，不缓存旧值 |
| 只读与敏感材料不披露 | NS/nonretryable/零mutationGET、token canary对照 |
| 规划轴正交 | 三策略实际存储planningStatus/content前后deepStrictEqual、ci_failing存在 |
| 真实能力子集诚实 | 共用Deliverysuite与fake环境positivecontrol |
| 体量与发布可复核 | 实测增删≤800/1300、披露和双向issue回读 |

提交前在该检出运行 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main` 与 `git diff --check origin/main...HEAD`，期望exit0；新增内容先人工核对再按真实commitrange重跑。按publication五类目扫描，不排除fixtures规避预算。

## Progress

- [x] (2026-10-07 23:05 +08:00) 当前端口、首分页与conclusion-only问题及官方API核对完成。
- [x] (2026-10-07 23:05 +08:00) 三方设计独立审评完成；精确SHA、原生事实/core映射、完整分页与suite计数保护已收敛。
- [ ] (2026-10-07) P0文档验证、draft发布与两侧issue/Project机械回读。
- [ ] (2026-10-07) A1 RED→GREEN、adapter/共享suite与实际预算门。
- [ ] (2026-10-07) A2完整摄入、三策略系统证据、变异与最终预算。
- [ ] (2026-10-07) 产品独立审评与完成归档。

## Surprises & Discoveries

core读取第一页和只看conclusion属于本切片必须修的事实摄入根因，不能用adapter纯页测试遮蔽。证据为chain-facts.ts的cursor undefined与factFor。

GitHub的两种1000上界不同：workflow是搜索结果；Checks是suites。runs.total_count不能证明suite全集，故新增同SHA只读suite计数探针。原生平台无跨请求原子快照承诺；count变化/重复时failclosed，验收分页契约假设源无并发写入，不承诺消除所有远端竞争。

Deliverysuite的部署presence假设阻碍诚实只读实例，应局部修正但保留fake环境正控。Checks无branch参数；不能从pull_requests数组猜branch，fork时它可为空。

混合workflow历史并非当前requiredgate。旧失败产生现派生提示是已有逐条事实语义，本项如实保留，避免宣称整个CI已pass或最新gate结论。

## Decision Log

决策：requiredrepository+commit直接替换CR-onlychecks，core保留observedCR门，pipeline保持现commit读取并提供可选branch直接能力。Rationale：消除重读PRhead竞争，避免扩大现谱系scope。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者。

决策：native状态/conclusion由core唯一映射，完整pages后才发布facts。Rationale：未知/非终态与后续页故障不能冒充成功；拒绝第二gateState权威。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者。

决策：suite计数饱和探针、workflow上界failclosed，不穷举历史。Rationale：完整性证据需区分run数与suite数，仍保持只读有限闭环。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者。

决策：当前只完成spec+plan与draft；实际产品预算必须在A1后重新过门。Rationale：人类阶段授权，估计不是实现证据，不为800限制弱化验收。日期/作者：2026-10-07 23:05 +08:00 / 当前任务授权与独立审评者。

## Idempotence and Recovery

fixture每例独立，recordedtransport是合成公开规范形状，重复运行零远端请求；source envelope前后比较。临时变异逐一撤销并确认最终diff只有允许文件；失败停在本批，不把半页/旧success作为权威回填。

真实产品adapter不缓存，不重试或写平台；错误恢复由调用方按八码模型进行。A1/A2回滚应作为一个完整PR恢复caller/port/fake/provider/test；没有schema或凭据迁移。保留用户无关修改与工作树；共享历史操作先恢复锚点再走Git专家流程。

draft发布重试先查询同分支PR；最终push回读head/base/checks/threads/两侧issue关联。当前保持draft，不ready、merge或写人类规划字段。预算失败停在独立闭环重审，不能改计数口径。

## Interfaces and Dependencies

依赖Node/pnpm/Git、现有ProviderResult/ProviderPage/effectiveCapabilities和fake组合根。新增definition只属delivery；工厂从现包barrel导出，无package.json或lockfile新依赖。transport仅注入GET结构化响应，不接收token参数或自动fetch。

Host负责真实凭据、网络timeout与权限证据，当前fixture显式注入；Actions/Checks权限独立。没有完整commit或CR观察时维持骨架与零请求门。requiredchecks聚合、真实网络接线、stale缓存/部署能力各属后续自身闭环。

## Outcomes & Retrospective

2026-10-07 23:05 +08:00的实际结果为已审评spec+plan；adapter、core修复、未来命令与真实GitHub权限未实施/验收。P0最终文档证据与draftURL由发布owner实际回读后补录。

本次无实施技术债，未改tracker。#221/#222、真实Host挂载与发布门是明确范围边界；若实现出现真实延期或预算导致范围修订，必须更新本计划并按事实登记 `docs/exec-plan/tech-debt-tracker.md`，不能虚构完成或吞并别issue。

## Bottom Change Note

2026-10-07 23:05 +08:00：三方独立设计收敛为精确SHA只读闭环；补core全页/status根因、原生历史语义、Checks套件计数保护与实际预算门，拒绝GET当前PR回退/双CI权威/空集pass。

2026-10-07 23:18 +08:00：落盘自审补齐cursor累计/count/suites复验、工厂精确options与clock默认；将新checks调用签名同步移入A1，保证批次typecheck可执行，A2专注完整摄入与状态判定。
