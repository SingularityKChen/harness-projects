# Host 目录收录 GitHub 研发与 Actions provider ExecPlan

> 状态：Completed（实现及 MMP 初审完成；六条 P2/P3 修订与复评证据见 `docs/review/pr-388-mmp-review.md`）
> 创建：2026-10-21
> 范围：完成 issue #355：Host 编译期目录（`apps/harness-plugin/src/host-providers.ts`）加入 `development.github` 与 `github-actions` 两个条目、Actions 需要的宿主 REST 出口，以及由 Host 推导并传入的 Actions 权限；不含绑定命令与界面（#373、#356）、Host 重组（#354）、快照刷新（#335）与执行实现（#140）。
> 上游输入：`AGENTS.md`、`PLANS.md`、issue #355（正文与验收项）、`docs/adr/ADR-0014-host-composes-providers-by-implementation-key.md`（Proposed）、`docs/exec-plan/tech-debt-tracker.md` 的 TD-054、TD-056、TD-062、TD-064、TD-067，`docs/exec-plan/completed/2026-10-07-github-actions-read.md`、`docs/exec-plan/completed/2026-10-15-github-development-read.md`、`docs/exec-plan/completed/2026-10-15-host-provider-composition.md`；三份独立设计（最小闭环 / 凭据与失败路径 / 系统组合）经独立评审合成本计划。
> 执行上下文：分支 `feature/host-github-delivery-catalog`，工作树 `.worktrees/host-github-delivery-catalog`；base 为 `origin/main`（含已合并的 #370），以 `git rev-parse origin/main` 回读。

## Purpose / Big Picture

完成后，库里已存的 `development.github` 挂载与 `github-actions` 挂载在 Host 启动时被组合成真实 provider：研发 provider 经宿主 GraphQL 出口读仓库与变更请求，Actions provider 经新的宿主 REST 出口读 workflow runs 与 check runs。Actions 的两个读 key 由 Host 按账号事实推导权限后传入：有 github.com 凭据句柄时为 `degraded`（未验证，照常读，逐次调用结果为准），没有可用凭据时显式 `unavailable`。凭据值只在单次请求的 `authorization` 头里出现，不进库、日志与 wire。#356 的绑定界面与 #354 的重组因此可以直接用这两个目录条目，demo 的交付视图才有 PR 与 CI 可读。

最小成功证据：新测试文件 `tests/integration/harness-plugin-host-github-catalog.test.js` 的 C1–C12（编号沿用设计稿，没有 C3，见 S7；C7、C8 为独立验收补充）在录制夹具上离线全绿；变异表全部 KILLED；`pnpm run boundaries` 通过；`pack:plugin` 能出安装件且两个新 provider 只进宿主半边。

## Context and Orientation

| 术语 | 含义 |
|---|---|
| 挂载 | `provider_binding`（带 `implementation_key`）加 `workspace_binding`（domain、enabled、is_default、configuration_json）；配置按目录条目声明的 schema 闭集校验，写入与开库都校验（ADR-0014 第 3 条） |
| 目录 | `PROVIDER_CATALOG`：实现键 → 定义 + 配置 schema + `create`；`restoreProviders` 按挂载构造，失败只禁用该挂载（`disabled`），不写库 |
| 句柄 | `connector_account.secret_handle`，只允许宿主常量 `HOST_SECRET_HANDLES`；值经 `credential()` 在每次请求内解析 |
| baseline / wire | Host 的 `baseline` 结果经 `HOST_REMOTE.invocations[0].result.encode` 编码；能力条目只有 `{ key, access, reason }` |
| 四态 | `available` / `read_only` / `degraded` / `unavailable`；有效级别 = capability ∩ permission ∩ policy（`packages/capabilities/src/capability-keys.ts` 的 `effectiveCapabilities`） |

当前事实（独立评审在本分支工作树根目录读码核实，2026-10-21）：

- F1 目录只有两项：`apps/harness-plugin/src/host-providers.ts` 的 `catalogOf([GITHUB_PROJECTS_ENTRY, LOCAL_GIT_ENTRY])`；存储拒绝未声明实现键的配置（`packages/capabilities/src/connector-account.ts` 的 `parseBindingConfiguration` 抛 `RangeError`），所以今天这两种挂载连库都进不去。
- F2 实现键：`development.github`（`packages/providers/development-github/src/provider.ts` 的 `GITHUB_DEVELOPMENT_DEFINITION`）与 `github-actions`（`packages/providers/delivery-github-actions/src/provider.ts` 的 `GITHUB_ACTIONS_DEFINITION`，契约测试 `tests/contract/delivery-github-actions-contract.test.js` 钉住）。TD-054 正文写的 `delivery.github-actions` 是笔误。
- F3 Actions 工厂必需 `transport`（只发 GET、只带 accept 与 `x-github-api-version` 两个静态头、不带 Authorization）、`observedAt`（带时区 ISO）与 `permission`；缺的 key 报 `unavailable`；owner/name 须匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`，否则构造抛 `TypeError`；`describeCapabilities` 静态、不触网；翻页只用 Link 里的页码，Host 不请求响应给出的 URL。
- F4 研发 provider 的 `GraphqlTransport` 与规划 provider 结构逐字同形；`describeCapabilities` 每次探测一次仓库（ok → available，任何失败 → degraded，不抛错），即 TD-056 预言的第二个组合期触网点；Core 的 `collectBindings` 串行观察快照（`packages/core/src/registry.ts`）。
- F5 读门：`unavailable` 直接记缺口、不调 provider；`degraded` 放行读（`packages/core/src/capabilities.ts` 的 `gateOn`、`packages/core/src/chain-facts.ts` 的 `gated`）。wire 上「有挂载但不可用」的 `reason` 为空，「没有挂载」带 `没有挂载提供能力 <key>`（`packages/core/src/queries.ts`），两者可区分。
- F6 delivery 只有一个槽位，第二个启用挂载走 `Conflict` 分支；`workspace_binding_default` 唯一索引只约束 is_default=1，两个启用的 delivery 挂载能入库，X2 分支随本 PR 第一次可达。
- F7 录制夹具：`tests/contract/fixtures/github-development/sandbox.json`（与 `tests/contract/fixtures/github-projects/replay.js` 的 `createReplay` 同形，可与规划夹具合并成一张回放表）；`tests/fixtures/github-actions.mjs` 的 `recordedPages(kind)`（脱敏真实形状两页，`OWNER`、`REPO_NAME`、`REPOSITORY_EXTERNAL_ID`、`COMMIT` 已导出）。`recordedPages` 对任何路径都应答，路径白名单必须由 Host 级路由自己守。
- F8 下游契约：#373 计划写明两条目的配置字段为 `repositoryExternalId`、`repositoryOwner`、`repositoryName`；它的测试用自带 schema（`[^\s]+`）覆盖策略、写入值 `octo` / `repo-alpha` 也满足本计划更严的 pattern；它的 `bindRepository` 拒绝第二个交付来源。
- F9 账号 `connectionState` 唯一的生产写者是 #371 的 `workspace-setup`，只写 `connected`；规划条目从不读它。
- F10 #297 未合并：同一工作区同时挂 Local Git 与 GitHub 研发时，按 key 解析得不到唯一挂载，谱系读取记缺口（fail closed，不会读错挂载，`packages/capabilities/src/registry.ts` 的 `bindingForCapability`）。

## Design / Spec

只改一个实现文件 `apps/harness-plugin/src/host-providers.ts`；`ProviderBuildInput`、`CatalogEntry`、`restoreProviders` 与 `createHostComposition` 的签名都不变。

```ts
const GITHUB_API = 'https://api.github.com'; const GITHUB_ORIGIN = 'https://github.com'   // 端点做成 Config 属 TD-067
/** 唯一的 GitHub 出口：入口建立 AbortSignal.timeout(30_000)，凭据解析、fetch 与 body 共用同一截止并 race；凭据晚到不再 fetch；redirect:'error'；
 *  provider 头在前，宿主的 authorization（bearer）与 user-agent 最后写入、不可被覆盖；body 不能解析时为 undefined。 */
async function githubRequest(fetch: HostFetch, credential: () => Promise<string | undefined>, url: URL,
  init: { readonly method: 'GET' | 'POST'; readonly headers: Readonly<Record<string, string>>; readonly body?: string }): Promise<GithubResponse>
function githubGraphqlTransport(fetch, credential): GraphqlTransport            // 改为委托 githubRequest(new URL('/graphql', GITHUB_API), POST)，行为不变
export function githubRestTransport(fetch, credential): GithubActionsTransport // url = new URL(GITHUB_API); url.pathname = path; query 逐项 searchParams.set(k, String(v)); 方法固定 GET
const GITHUB_REPOSITORY: BindingConfigurationSchema = {                          // 两个条目共用
  repositoryExternalId: { kind: 'string', required: true, pattern: '[^\\s]+', maxLength: 200 },
  repositoryOwner: { kind: 'string', required: true, pattern: '[A-Za-z0-9][A-Za-z0-9._-]*', maxLength: 100 }, repositoryName: 同 repositoryOwner }
function requireGithubCredential(account, role): void  // 非 github.com 或无句柄 → BindingRefused(NotSupported)；规划与研发条目共用，规划文案不变
GITHUB_DEVELOPMENT_ENTRY.create → requireGithubCredential(account, '研发')；createGithubDevelopmentProvider({ bindingId, repository: githubRepository(cfg), transport: githubGraphqlTransport(fetch, credential) })
GITHUB_ACTIONS_ENTRY.create → account 存在且 platformOrigin ≠ github.com → BindingRefused(NotSupported)
  access = account?.secretHandle === undefined ? Unavailable : Degraded
  createGithubActionsDeliveryProvider({ bindingId, repository, transport: githubRestTransport(fetch, credential), observedAt: new Date().toISOString(),
    permission: { [DeliveryPipelineRead]: access, [DeliveryCheckRead]: access } })
PROVIDER_CATALOG = catalogOf([GITHUB_PROJECTS_ENTRY, LOCAL_GIT_ENTRY, GITHUB_DEVELOPMENT_ENTRY, GITHUB_ACTIONS_ENTRY])
```

`url.pathname = path` 在结构上保持 origin（`.evil.example/x`、`//evil.example/x`、`@evil.example/x` 都仍落在 `api.github.com`，评审用 `node -e` 实测），字符串拼接则会把 `.evil.example/x` 拼成别的主机；因此不另写测不到的 origin 守卫分支，由 C6 直接判别拼接变异。

账号与权限真值表（权限只在内存推导，不入库，生命周期等于一次组合）：

| 关联账号 | `development.github` | `github-actions` |
|---|---|---|
| 无关联账号 | 禁用 `not_supported` | 组合；两读 key `unavailable` |
| github.com，无句柄 | 禁用 `not_supported` | 组合；两读 key `unavailable` |
| github.com，带句柄 | 组合；provider 自探测（ok → available，失败 → degraded） | 组合；两读 key `degraded` |
| 非 github.com（含 GHES） | 禁用 `not_supported` | 禁用 `not_supported`（令牌只发往 api.github.com） |

数据流与状态拥有者：SQLite 的挂载、配置与账号句柄是唯一事实源 → `restoreProviders` 调条目 `create`（闭包持有注入的 `fetch` 与 `credential`）→ `composeCore` 观察快照（研发发唯一一次 GraphQL 探针，Actions 静态）→ 注册表求交 → baseline wire。读路径：Core 先过读门，`unavailable` 记缺口、零请求；放行后 provider → 宿主出口 → 每次请求解析一次凭据 → fetch。令牌值归宿主凭据服务，不缓存；权限快照归本次组合；运行期真相是每次调用的 `ProviderResult`。

失败路径：配置不合 schema → 写库 `RangeError`；读库时缺配置 → `invalid_input`，只禁用该挂载；第二个启用 delivery 挂载 → `conflict`；凭据解析不到 → transport reject、零 fetch，provider 报 `unavailable`（`transport_error`）；超时、网络错误、3xx（改名或转移的仓库）→ `unavailable`；401 / 非限流 403 → `permission_denied`；REST 404 → `not_found`（GitHub 对无权访问的私有资源也回 404；研发 GraphQL 的 HTTP 404 按既有分类器为 `unavailable`，C7 分别钉住，不在本 PR 统一分类）；限流 → `rate_limited`；错误文案固定，不回显响应正文。

被放弃的方案：
- 有句柄即 `available`（设计 1、3）：见 Decision Log D1。
- 组合期探测权限（三份设计都否决）：判断冻结到下次组合；Desktop 上 Host 可能先于凭据服务激活（ADR-0014 记录的 S3 竞态），探测必然失败；checks 探测需要提交 sha，组合期没有；多出第三个触网点（TD-056）。
- 把权限存进挂载配置：用户声明不是凭据证据，换令牌即过期，形成第二个事实源，并改变 #373 / #356 的写入契约。
- 没有凭据时禁用 Actions 挂载：验收要求 provider 显式报 `unavailable`；禁用后 wire 上与「没有挂载」无法区分（F5）。研发挂载仍禁用：它的探针必然失败，会被误报成 degraded。
- 读 `connectionState`（设计 1、2）：见 D5。
- REST 出口加 `/repos/` 前缀或 origin 断言分支（设计 1、3）：pathname 赋值已在结构上保 origin；owner/name 由 schema 与 provider 两处校验，方法在类型与实现里都固定为 GET，前缀守卫只保护已校验的输入。
- 改名实现键为 `delivery.github-actions`、跟随重定向、引入 Octokit 或新建共享 GitHub 包：见 D6、D7、D8。
- 在 Host 拦截 #297 合并前 Local Git 与 GitHub 研发同挂：后果是 fail closed 的缺口（F10），拦截反而挡住 demo 的目标配置；跨挂载判定以后还得删。
- 改 `tests/integration/harness-plugin-artifact.test.js` 或 `tests/integration/README.md`（设计 3）：两者属 #372，改用构建 metafile 一行命令取证（Batch 3）。Superseded by D17（2026-10-21）：#372 合并后，安装件测试的两条前缀由本 PR 作为后合并者补上。

关键不变量：身份只来自存储（C1 的已默认挂载在首次组合后四张身份表不变；不泛化为任意绑定写者的整表不变，单一研发挂载的默认标志归一见 S13）；运行期失效不写库；凭据值只存在于一次请求内；权限快照不入库；apps 只经 `HOST_ENTRY` 例外 import provider；provider 之间不互调。

## Global Constraints

- 本 PR 改动的文件集合（唯一一处声明）：`apps/harness-plugin/src/host-providers.ts`；`apps/harness-plugin/package.json`（加两项 workspace 依赖）；`pnpm-lock.yaml`（随之更新，不计规模）；`tests/contract/package-boundaries.test.js`（只改 `HOST_ENTRY.allow` 与其注释）；`tests/integration/fixtures/host-seed.js`（加 `githubFetch` 与种子 helper，迁入 `occurrences`）；`tests/integration/harness-plugin-host-providers.test.js`（只把 `occurrences` 改为从 host-seed 导入）；新建 `tests/integration/harness-plugin-host-github-catalog.test.js`；`tests/integration/harness-plugin-artifact.test.js`（只在宿主输入的前缀断言里加两项，#372 合并后加入本集合，D17）；本计划文件（验收完成后移入 `completed/`）；`docs/README.md`（只加本计划的 Completed 索引）；`docs/exec-plan/tech-debt-tracker.md`（Batch 4 只追加 TD-079 至 TD-081，TD-082 预留不用；2026-10-22 评审修订含 TD-076/079/081）；`docs/review/pr-388-mmp-review.md`（精炼评审与修复证据）。
- 不改：`packages/**`（含两个 provider 包、core、controller、capabilities、client、ui-model、ui、storage）；`apps/harness-plugin/src/` 的 `host.ts`、`host-composition.ts`、`host-operations.ts`、`host-surface.ts`、`remote.ts`、`client.ts`、`workspace-watch.ts`；`apps/web/**`；`docs/README.md`（Superseded by D19：协调者授权独立验收者只加本计划的 Completed 索引）；`docs/adr/**`（ADR-0014 保持 Proposed）；`docs/product/vertical-path.md`；`tests/integration/harness-plugin-artifact.test.js`（Superseded by D17：前缀断言一行例外）、`tests/integration/README.md`、`tests/integration/harness-plugin-host-watch.test.js`、`tests/integration/workspace-setup-commands.test.js`；tracker 既有行（尤其 TD-054，#373 在改；Superseded by D17：#373 合并后由协调者在 TD-054 行尾追加收窄说明，原文不动；Superseded by D21，2026-10-22：本次只修 TD-076、TD-079、TD-081 的承接和已解决范围）。
- 规模：代码 + 测试 ≤ 800 行（CI 硬上限 1000），文档 ≤ 1300 行（硬上限 1500），以 `node scripts/rule-checks.mjs size origin/main` 回读。
- 运行时：Host 半边以 Node 24.18.1 为上限（`URL`、`AbortSignal.timeout` 可用）；仓库 pnpm 固定 10.28.2；不加任何外部依赖。
- 测试不触网：GitHub 流量全部走录制回放，C1 另把 `globalThis.fetch` 换成抛错桩。
- 凭据只以宿主句柄存在；测试与文档不写真实令牌形状的字面值。
- 不写 `git config`；提交身份以开发账号单次传入（`git -c user.name=… -c user.email=…`）。agent 不写看板 Status、blocked-by / blocking，不改 ADR 状态。
- 首发前不写兼容层：两个 schema 首次声明，库里不可能已有这两种实现键的配置行（F1），无需迁移。

## Plan of Work

实现者模型：Batch 1–2 用 Sonnet（高推理）按 TDD 实现；Batch 3–4 由 Opus 独立对抗验收、重构与回填。所有命令都在检出 `feature/host-github-delivery-catalog` 的工作树根目录运行。

### Batch 0 · 对齐 base 与规划提交
**最小闭环**：分支对齐含 #370 的 `origin/main`，只提交本计划。
- [x] `git fetch origin && git merge --ff-only origin/main`（分支此前没有自有提交）；`pnpm install --frozen-lockfile --offline`。
- [x] 提交本计划；draft PR、issue 关联与字段由协调者执行。
**验证**：`git rev-list --count HEAD..origin/main` → `0`；`node scripts/rule-checks.mjs disclosure origin/main` → exit 0；`git diff --check origin/main...HEAD` → 无输出。
**回滚**：丢弃该提交；没有代码改动。

### Batch 1 · 研发条目与共享出口
**最小闭环**：已存 `development.github` 挂载在 Host 启动时组合，并经宿主 GraphQL 出口读通变更请求。
**涉及文件**：`apps/harness-plugin/src/host-providers.ts`、`tests/integration/fixtures/host-seed.js`、新测试文件。
- [x] 先写测试：host-seed 加 `githubFetch()`（GraphQL 回放合并规划两份夹具与 `github-development/sandbox.json`，账本记 origin、path、method、operationName、全部请求头、redirect、signal；未命中进 `misses`）与写挂载、账号关联、配置的 helper，迁入 `occurrences`；新文件写 C1 的研发部分（规划 + 研发挂载，owner/name 从 sandbox 夹具的 `DevelopmentRepository` 交换读出，不写字面值）、C2 的研发行、C5 的研发键。
- [x] 跑 `node --test tests/integration/harness-plugin-host-github-catalog.test.js`，期望红在播种：`RangeError: binding configuration is not declared for this implementation key`。
- [x] 实现 `githubRequest`、GraphQL 出口改委托、`GITHUB_REPOSITORY`、`requireGithubCredential`、研发条目与目录；manifest 加 `@harness-projects/provider-development-github`，`pnpm install --offline` 更新锁文件；`HOST_ENTRY.allow` 加 `packages/providers/development-github`。
**验证**：`node --test tests/integration/harness-plugin-host-github-catalog.test.js tests/integration/harness-plugin-host-providers.test.js` → `ℹ fail 0`，原有 Host 用例数不变；`pnpm run boundaries` → `ℹ fail 0`；`pnpm run typecheck` → exit 0。
**回滚**：撤回本批提交（已推送用 `git revert`）；没有库迁移。

### Batch 2 · Actions 条目、REST 出口与权限
**最小闭环**：已存 `github-actions` 挂载按账号事实组合，Host 传入的权限出现在 wire 上，端口经宿主 REST 出口读通 runs 与 checks。
**涉及文件**：同 Batch 1 的三个主文件。
- [x] 先写测试：`githubFetch()` 加 REST 路由，只认 `runsPath()`、`checksPath(COMMIT)`、`suitesPath(COMMIT)` 三条路径（其余进 `misses` 并 reject），查询串里纯数字值还原为数字后交给 `recordedPages`；C1 加 Actions 挂载与交付断言，C2 加 Actions 行，写 C4、C5 的 `github-actions` 键；跑出红：播种 `RangeError`。再写 C6，跑出红：`githubRestTransport` 未导出。
- [x] 实现 `githubRestTransport`、Actions 条目与目录；manifest 加 `@harness-projects/provider-delivery-github-actions`，更新锁文件；`HOST_ENTRY.allow` 加 `packages/providers/delivery-github-actions`。
**验证**：Batch 1 的命令全部 `ℹ fail 0`，另跑 `node --test tests/contract/delivery-github-actions-contract.test.js tests/contract/development-github-contract.test.js tests/integration/harness-plugin-host-watch.test.js` → `ℹ fail 0`。
**回滚**：撤回本批提交，回到 Batch 1。

### Batch 3 · 对抗验收、产物与并集（Opus）
**最小闭环**：变异表全部被具名用例杀死，安装件可构建，三个在途分支的并集仍绿。
- [x] 变异 spec 放 `.superpowers/pr355/`（Superseded by 实际目录 `.superpowers/iter7-batch-20261021/pr355/`（2026-10-21）：最终验收用 `mutants-accept-host.json`、`mutants-accept-legacy.json`、`mutants-accept-boundary.json`，结果见 Progress）（运行态，不入库）：`mutants-host.json` 的 command 为新测试文件，`mutants-boundary.json` 的 command 为 `node --test tests/contract/package-boundaries.test.js`；每条带 `killedBy`。跑 `node scripts/review-mutate.mjs .superpowers/pr355/mutants-host.json` 与 boundary 那份 → exit 0，逐条 `APPLIED` 且 `KILLED`，没有 `NOT_APPLIED` / `KILLED_OTHER`。
- [x] 独立审读与重构：死代码、重复、注释与本计划一致；改动后重跑变异表整表。
- [x] 产物：`pnpm --filter @harness-projects/app-harness-plugin pack:plugin` → exit 0 且 `apps/harness-plugin/dist/` 下有 `.tgz`；随后 `rm -rf apps/harness-plugin/dist`（#350：dist 会让源扫描多算）。bundle 归属：`OUT=$(mktemp -d) && node --input-type=module -e "import { build } from './apps/harness-plugin/scripts/build.mjs'; const { metafiles } = await build({ outDir: process.argv[1] }); const pick = (m) => Object.fromEntries(['development-github', 'delivery-github-actions'].map((p) => [p, Object.keys(m.inputs).some((i) => i.startsWith('packages/providers/' + p + '/'))])); console.log(JSON.stringify({ host: pick(metafiles.host), client: pick(metafiles.client) }))" "$OUT"` → `{"host":{"development-github":true,"delivery-github-actions":true},"client":{"development-github":false,"delivery-github-actions":false}}`；`node --test tests/integration/harness-plugin-artifact.test.js` → `ℹ fail 0`。
- [x] 并集（`feature/plugin-work-item-pages` 已随 #372 合并进 `main` 并从远端删除，这一格 Superseded by 「最新 `main`」，见 S11、D15（2026-10-21））：对 B ∈ {`feature/workspace-binding-commands`, `feature/plugin-work-item-pages`, `feature/repository-binding`} 执行 `T=$(git merge-tree --write-tree HEAD origin/$B) && U=$(mktemp -d) && git archive "$T" | tar -x -C "$U" && (cd "$U" && pnpm install --frozen-lockfile --offline && node --test tests/integration/harness-plugin-host-github-catalog.test.js tests/integration/harness-plugin-host-providers.test.js tests/integration/workspace-setup-commands.test.js tests/integration/harness-plugin-artifact.test.js)`（`merge-tree` 冲突时 exit 1，记入 Surprises）→ `ℹ fail 0`。
**验证**：`pnpm verify` → exit 0（先确认 `apps/harness-plugin/dist` 不存在）；`node scripts/rule-checks.mjs size origin/main` → 代码 ≤ 800、文档 ≤ 1300；`node scripts/rule-checks.mjs disclosure origin/main` → exit 0；`node scripts/workflow-check.mjs` → 无发现；`git diff --check origin/main...HEAD` → 无输出。
**回滚**：重构单独提交，可单独撤回；变异脚本按字节还原，失败时以 `git diff --stat` 为空确认。

### Batch 4 · 回填、登记与整合
**最小闭环**：计划与 tracker 反映真实结果，提交整合成三个可独立审阅的交付物。
- [x] 回填 Progress、Surprises、Decision Log、Outcomes；tracker 追加 TD-079 至 TD-081（内容见 Decision Log D1、D7、D9）。
- [x] 先建 backup ref，再整合为（协调者执行；目标序列见 Outcomes & Retrospective）：`docs(exec-plan): 规划 Host 目录收录 GitHub 研发与 Actions provider`、`feat(apps): Host 目录组合 GitHub 研发与 Actions provider`、`docs(exec-plan): 回填 #355 实施、验收与技术债`；正文说明为什么，末尾 `Refs #355`，不写关闭关键字。
**验证**：`comm -3 <(git diff --name-only origin/main...<backup-ref> | sort) <(git diff --name-only origin/main...HEAD | sort)` → 无输出；`git diff --name-only origin/main...HEAD` 与 `Global Constraints` 的集合一致；`git log --format=%B origin/main..HEAD | grep -n '^#'` → 无输出；重跑 Batch 3 的验证命令。
**回滚**：`git reset --keep <backup-ref>`。

### MMP 六条意见修订 · 2026-10-22

执行上下文为 `feature/host-github-delivery-catalog`，协调者已把分支变基到 `main@0d8d6094c138b66fc50c3598d7e485528fc74168`，本轮父提交 `c0a036d734dcb1ad9027637a68610307f214583c`；源改动未提交前不称为新 immutable head。
先为 C9（只 Development 挂载、凭据永不 settle）与 C10（凭据/fetch/body 同预算）看到旧实现失败，再在 `githubRequest` 入口建立唯一 30 s signal，与整次异步工作竞速；凭据晚到先检查 abort，绝不晚发 fetch，迟到拒绝由 race 消费。无需改变 Provider 或公共配置 schema。
C11 经真实绑定写者与 Host 恢复验证 `repositoryId` 和配置键不一致的读是 `not_found/foreign_ref`、零 REST；跨引用 owner/name 的同一现实仓库由 #356 表单拥有，不把两个独立录制夹具说成同一 GitHub 仓库。
C12 验证收缩目录后 Host 正常启动、Planning 可用、两挂载只在内存禁用且库行不变；重新收录后原身份恢复。四条 P3 文档与债务承接同步更正。
验证入口：`node --test tests/integration/harness-plugin-host-github-catalog.test.js`、`pnpm verify`、`pnpm run boundaries`、安装件契约与 `node scripts/review-mutate.mjs <spec.json>`；实际结果及逐条 commentID 回指在本 PR 精炼评审记录，避免另一份重复证据。
回滚：撤销本轮 transport/测试更改即可恢复旧行为；库行不删除，外部 issue/PR 文本由协调者独立处理。

## Validation and Acceptance

| # | 验收项（issue #355） | 判定证据 |
|---|---|---|
| AC1 | 已存的研发与 Actions 挂载在 Host 启动时组合成可用 provider，Host 级测试用录制夹具、不触网 | C1：`host.disabled` 为 `[]`；wire 上研发两 key `available`；组合期 REST 请求 0 个、`DevelopmentRepository` 恰 1 个；四张身份表与种子逐字节相同；同库 `restoreProviders` 的端口 `listChangeRequests(headBranch 取自夹具)`、`listPipelineRuns` 两页、`listChecks` 都 `ok`；`misses` 为 `[]`；`globalThis.fetch` 抛错桩未被调用。C4：第二个启用 delivery 挂载 `conflict`、第一个照常。变异（最终树整表，见 Progress）：C1 杀死 M1、M2、M9、M10、M11a/b、M12、M14、M15、M20a/b、M21a/b、M25、N6、N7、N12、N15、N16；C4 杀死 M18 |
| AC2 | Actions provider 报告 Host 传入的权限；无权限挂载显式 `unavailable` | C1：交付两 key `degraded`。C2（`t.test` 子用例，每行一格）：无账号、账号无句柄 → Actions 不在 `disabled`，wire 两 key `unavailable` 且 `reason` 为空（区别于「没有挂载」），恢复端口的 `describeCapabilities().permission` 同为 `unavailable`，REST 请求 0；非 github.com 账号（`github.example.com` 与以 github.com 为前缀的 `github.com.example` 各一行，后者判别「相等」与「前缀匹配」，D13；`github.example.com` 另有不带句柄一行，判别「只在带句柄时才查来源」，D14）→ 研发与 Actions 都 `not_supported`、零请求；研发挂载无账号或无句柄 → `not_supported`。变异：C1 杀死 M3、N5；C2「无关联账号」杀死 M4、N3，「github.com 账号不带句柄」杀死 M6、N1、N4，「非 github.com 账号（带句柄）」杀死 M5、N2，「非 github.com 账号（不带句柄）」杀死 M27，「来源以 github.com 为前缀」杀死 M22 |
| AC3 | 凭据只以 Host 句柄存在，令牌不进项目库与客户端（断言库行与 wire） | C1：数据目录（含 `-wal`、`-shm`、诊断日志）里 canary 与其 base64 出现 0 次（Superseded by D12（2026-10-21）：这三类文件从不在场，覆盖为空），句柄名阳性对照 ≥ 1；C1 先断言扫描时数据目录恰为 `workspace.sqlite`，再断言其中 canary 与其 base64 出现 0 次；两挂载的配置行恰为三个字段；wire 与 `disabled` 不含 canary；每个请求的 `authorization` 为 `bearer <canary>`、URL 与其它头不含它；凭据解析次数等于请求次数。C5：配置带 `token` 字段即写库 `RangeError`。C6：凭据 `undefined` 或空串 → reject 且 fetch 0 次。变异：C1 杀死 M16a/b、N11、M24；C5 杀死 M17a/b、M23a/b/c；C6 杀死 M7、M7b（「凭据 undefined」「凭据空串」）与 M8、M13、M13b、M26、N18（「路径与头」）；规划条目共用 `requireGithubCredential` 的回归由 `tests/integration/harness-plugin-host-providers.test.js` 的「规划挂载被禁用」杀死 N17、N17b |
| AC4 | `pnpm run boundaries` 通过，插件产物仍能构建 | Batch 3 的 boundaries、`pack:plugin`、bundle 归属一行命令与安装件测试（读数见 Progress）。变异：`tests/contract/package-boundaries.test.js` 杀死 M19a/b（manifest 删一项）与 B1、B2（`HOST_ENTRY.allow` 删一项） |

C1 的请求账本另断言：origin 都是 `https://api.github.com`；`/graphql` 只用 POST 且带 `content-type`；`/repos/` 只用 GET 且带 accept 与 `x-github-api-version: 2022-11-28`；每个请求 `user-agent` 为 `harness-projects`、`redirect` 为 `error`、`signal` 是 `AbortSignal`（2026-10-21 收紧为「恰是 `AbortSignal.timeout(30_000)` 的返回值」，见 D13；再收紧为各请求的 signal 互不相同，见 D14）；runs 请求的查询串含 `head_sha`。C5 的拒绝行（两个实现键各一遍）：owner `a/b`、name `..`、name `.github`、缺 `repositoryName`（2026-10-21 扩为三个字段各缺一行，见 D13）、多 `token`。C6 另含：路径 `.evil.example/x` 与 `//evil.example/x`（后者 2026-10-21 加入，判别相对解析，见 D14）发出的 URL origin 仍是 api.github.com；provider 头里塞 `authorization` 时发出的仍是宿主 bearer。

独立验收风险矩阵（2026-10-21，`b8a02cee` 加 C7/C8 测试的工作树；实现未修改）：

| 等级 / 层 | 风险与证据 | 判定 |
|---|---|---|
| P0 / 信任边界 | C1、C6 验证固定 HTTPS origin、不可覆盖的宿主头与不跟随重定向；C7 验证凭据服务 / 网络 / abort 的异常原文、HTTP 错误正文与伪 request id 不进入结果、库或诊断日志 | 无新增 P0；凭据只按请求解析 |
| P1 / 产品与事实所有权 | C8 使用生产 `hostStoragePolicy(PROVIDER_CATALOG)` 调真实 `bindRepository`，关库后组合 Host，再由恢复端口读通 GraphQL 与 REST；账号、配置、实体与外部身份未重建；C7 故障后同一端口恢复 | 无新增 P1；C1 的直接播种不再是唯一接线证据 |
| P1 / 架构与状态 | 仅给已有 Host 入口例外增加两个被收录 provider，client 不可达与安装件归属仍受契约约束；C8 显式区分 Core 既有默认标志归一与身份/配置写者 | 未新增层级跳跃、Provider 互调、Planning 状态写入或权威 Saved |
| P2 / 已知边界 | TD-079 的未验证权限、TD-080 的重定向/仓库名限制、TD-081 的组合期串行探针及凭据解析无截止时间 | 已有技术债，保持显式；不将离线验收宣称为真实 GitHub 权限或 Desktop 安装验收 |
| P3 / 证据与范围 | C7 补 10 类失败与恢复，C8 补真实绑定写者链路；7 条定向变异均被它们杀死；原有 53 条变异在当前树重跑均 KILLED | 测试证据缺口已补，无生产行为修改 |

C7 的 abort 用真实的已中止 `AbortSignal` 注入，判别失败映射；实际 30 秒参数及每请求独立 signal 由 C1 验证，不声称完成 30 秒实钟或真实网络超时测试。302 为注入的响应，原生 fetch 的 redirect 策略由 C1 参数断言约束。C7 的 credential 行实际生成诊断日志并扫描它，补足 C1 没有失败路径日志的边界。C8 的回放数据仍为两个 provider 各自既有录制夹具，不声称核验两个外部仓库在平台上的现实对应关系。

变异表（Batch 3 跑，最终树整表重测）：

| 变异 | 应被杀于 |
|---|---|
| M1 目录漏研发条目 / M2 目录漏 Actions 条目 | C1 |
| M3 Actions 有句柄时传 `available` | C1 |
| M4 Actions 忽略句柄恒传 `degraded` | C2 无账号、无句柄行 |
| M5 Actions 不拒非 github.com 账号 | C2 非 github.com 行 |
| M6 研发条目去掉 `requireGithubCredential` | C2 研发行 |
| M7 REST 出口跳过空凭据检查 | C6 |
| M8 REST URL 改为 `GITHUB_API + path` 拼接 | C6 origin 行 |
| M9 去掉 `redirect: 'error'` / M10 去掉超时 signal | C1 账本 |
| M11 REST 改 POST 或 GraphQL 改 GET（关闭 TD-054 的 X24） | C1 账本 |
| M12 丢掉 provider 静态头 / M13 宿主头先写、provider 头可覆盖 / M13b 去掉头名小写归一（D11） | C1 账本 / C6 / C6 |
| M14 query 不转发 | C1（`head_sha` 断言与读结果） |
| M15 `githubRepository` 对调 owner 与 name | C1（`misses` 非空） |
| M16 凭据在 `create` 期解析一次并缓存 | C1 解析次数 |
| M17 owner/name pattern 放宽为 `[^\s]+` | C5 |
| M18 删除槽位冲突分支（X2） | C4 |
| M19 manifest 删一项 provider 依赖 | `pnpm run boundaries` |
| M20 条目改用 `globalThis.fetch` | C1 抛错桩 |
| M21 超时换成永不触发的 signal / 超时改为 `2_147_483_647`（独立验证 N8、N9） | C1 账本（`AbortSignal.timeout` 的参数与返回值） |
| M22 Actions 来源检查从相等弱化为 `startsWith`（N10） | C2 前缀行 |
| M23 `repositoryExternalId` / `repositoryOwner` / `repositoryName` 任一 `required` 放宽（N13、N14） | C5 缺字段行 |
| M24 C1 期间数据目录多出文件（以多写一行诊断日志模拟） | C1 扫描范围断言 |
| M25 超时 signal 跨请求共用一个（最终验收） | C1「超时按请求计」 |
| M26 REST URL 改为 `new URL(path, GITHUB_API)` 相对解析（最终验收） | C6 `//evil.example/x` |
| M27 Actions 只在账号带句柄时才查来源（最终验收） | C2「非 github.com 账号（不带句柄）」 |

最终树整表结果与 spec 位置见 Progress（最终验收一项）；spec 另含独立验证的 N1–N7、N11、N12、N15–N18 与边界测试的 B1、B2（`HOST_ENTRY.allow` 删一项）。

回归：`tests/integration/harness-plugin-host-providers.test.js`、`harness-plugin-host-watch.test.js`、`harness-plugin-artifact.test.js` 与两个 provider 契约测试不改断言、照常全绿。

## Progress

- [x] (2026-10-22 SGT) 六条评审意见逐条核实；C9/C10 先红后绿、C11/C12 负例完成，文档和债务更新；完整验证与独立复评结果以本 PR 评审记录为准。

- [x] （2026-10-21 15:05 +08）独立评审三份设计：逐条核实引用事实，合成本计划；只写了本文件，未提交。
- [x] （2026-10-21 15:45 +08）Batch 0 对齐 base 与规划提交（协调者）：分支快进到 `origin/main`（`3391c01d`）后提交本计划 `17701520` 并推送；回读 `git log -1 --format=%ci 17701520`。
- [x] （2026-10-21 15:59 +08）Batch 1 研发条目与共享出口（实现者，在检出 `feature/host-github-delivery-catalog` 的工作树根目录运行，base `3391c01d`）。先红：`node --test tests/integration/harness-plugin-host-github-catalog.test.js` → `ℹ tests 7`、`ℹ pass 0`、`ℹ fail 7`，C1、C2 三行、C5 研发行这 5 个叶子用例都在播种处 `RangeError: binding configuration is not declared for this implementation key`（预期原因）；迁入 `occurrences` 后原文件照常 `ℹ tests 14`、`ℹ fail 0`。转绿：两文件 `ℹ tests 21`、`ℹ pass 21`、`ℹ fail 0`（原有 14 条不变）；`pnpm run boundaries` → `ℹ tests 9`、`ℹ fail 0`；`pnpm run typecheck` → exit 0；`git diff origin/main -- pnpm-lock.yaml` 只多出 `@harness-projects/provider-development-github` 一项。实现者自检变异（不是 Batch 3 的整表）：M1、M6、M9、M10、M11（GraphQL 改 GET）、M15、M16、M17（owner、name 各一）、M20 共 10 条全部 `KILLED`，归因到 `killedBy` 所指用例；spec 是运行态文件，不入库。
- [x] （2026-10-21 16:05 +08）Batch 2 Actions 条目、REST 出口与权限（实现者，在检出 `feature/host-github-delivery-catalog` 的工作树根目录运行，Batch 1 提交 `3551b5c8` 之上）。先红一：C1 加 Actions 挂载、C2 每行加 Actions 挂载、新写 C4、C5 加 `github-actions` 键后，`node --test tests/integration/harness-plugin-host-github-catalog.test.js` → `ℹ tests 9`、`ℹ pass 1`、`ℹ fail 8`，失败的 6 个叶子用例（C1、C2 三行、C4、C5 的 `github-actions`）都在播种处 `RangeError: binding configuration is not declared for this implementation key`，C5 研发行保持绿。先红二：再写 C6 → `SyntaxError: The requested module '../../apps/harness-plugin/src/host-providers.ts' does not provide an export named 'githubRestTransport'`（整文件 `ℹ fail 1`）。转绿：两文件 `ℹ tests 27`、`ℹ pass 27`、`ℹ fail 0`（原有 14 条不变）；`pnpm run boundaries` → `ℹ tests 9`、`ℹ fail 0`；`pnpm run typecheck` → exit 0；`node --test tests/contract/delivery-github-actions-contract.test.js tests/contract/development-github-contract.test.js tests/integration/harness-plugin-host-watch.test.js` → `ℹ tests 51`、`ℹ fail 0`；`git diff origin/main -- pnpm-lock.yaml` 只多出两项 workspace 依赖；确认 `apps/harness-plugin/dist` 不存在后 `pnpm verify` → exit 0（`ℹ tests 1713`、`ℹ fail 0` 与 `ℹ tests 7`、`ℹ fail 0`）。C2 的非 github.com 行另断言交付两 key 的 `reason` 为「没有挂载提供能力 …」，与无账号、无句柄两行的无 reason 形成对照（F5）。实现者自检变异（不是 Batch 3 的整表）：host spec 25 条（变异表 M1–M18、M20，外加 M7b 空串、M11b REST 改 POST、M13b 去掉头名小写归一、M16 与 M20 各按研发与 Actions 两条）与 boundary spec 的 M19 两条全部 `KILLED`、归因到 `killedBy` 所指用例，两次 exit 0。
- [x] （2026-10-21 16:25 +08）处置独立验证的 VF-1 至 VF-4（四条 P3，均属实、均只改测试；修复者，在检出 `feature/host-github-delivery-catalog` 的工作树根目录运行，`3e6e6b15` 之上未提交的工作树）。复跑条件：`3e6e6b15` 上 N8、N9、N10、N13、N14 全部 `GREEN`/`SURVIVED`；在 `git archive 3e6e6b15` 的导出副本里，`compose` 内 `dispose` 之前与 C1 扫描之前列数据目录都是 `['workspace.sqlite']`（S9）。改动：C1 记录 `AbortSignal.timeout` 并逐请求断言交给 fetch 的 signal 恰是 `timeout(30_000)` 的返回值（VF-1）；C2 加 `https://github.com.example` 行（VF-2）；C5 三个配置字段各缺一行（VF-3）；C1 先断言扫描时数据目录恰为 `workspace.sqlite`，断言文案收窄为「库文件」，`occurrences` 注释同步（VF-4，D12）。红（新测试 + 变异，读数来自导出副本）：N8 → C1 `POST /graphql：…` actual `undefined` expected `30000`；N9 → actual `2147483647` expected `30000`；N10 → 前缀行 `disabled` 缺 `[…c2, 'not_supported']`；N13 / N14 → C5 两键 `Missing expected rejection: 缺 repositoryExternalId` / `缺 repositoryOwner`；M24（`host-composition.ts` 多写一行诊断日志）→ C1 扫描范围 actual `['diagnostics.log', 'workspace.sqlite']`。同一份 spec 在 `3e6e6b15` 的旧测试上 N8、N9、N10、N13、N14、M24 都是 `SURVIVED`，M10 与 name 版 N13 为 `KILLED`。绿：新测试 + 原实现 `ℹ tests 14`、`ℹ fail 0`；targeted spec 8 条（M10、N8、N9、N10、N13、N14、name 版 N13、M24）`KILLED`、exit 0；独立验证的 host spec 整表 41 条在最终树上全部 `KILLED`、exit 0，`git status --short` 只剩两份测试文件；`node --test tests/integration/harness-plugin-host-github-catalog.test.js tests/integration/harness-plugin-host-providers.test.js tests/integration/harness-plugin-host-watch.test.js` → `ℹ tests 34`、`ℹ fail 0`；`pnpm run typecheck` → exit 0；`pnpm run boundaries` → `ℹ tests 9`、`ℹ fail 0`；确认 `apps/harness-plugin/dist` 不存在后 `pnpm verify` → exit 0（`ℹ tests 1714`、`ℹ fail 0` 与 `ℹ tests 7`、`ℹ fail 0`，比 Batch 2 多出的 1 条是 C2 前缀行）。没有新技术债。
- [x] （2026-10-21 16:47 +08）Batch 3 对抗验收、产物与并集（最终验收者，Claude Opus 5.5；都在检出 `feature/host-github-delivery-catalog` 的工作树根目录运行，标「导出副本」的在 `git archive` 出来的目录里先跑 `CI=true pnpm install --frozen-lockfile --offline`；merge-base 始终是 `3391c01d`，`origin/main` 在验收期间前进了三次，见 S11）。
  - 既往发现按原条件复跑（`b22a19e5`）：独立验证的三份 spec 原样重跑，`mutants-verify-host.json` 41 条、`mutants-verify-legacy.json` 2 条、`mutants-verify-boundary.json` 4 条全部 `KILLED`，三次 exit 0；N8、N9 归因 C1，N10 归因「来源以 github.com 为前缀」，N13、N14 归因 C5 两键。VF-4 的原条件（C1 扫描前列数据目录）在 HEAD 的导出副本里得 `["workspace.sqlite"]`，`compose` 的 `dispose` 之前也一样，与 C1 新断言和收窄后的文案一致（S9）。VF-1 至 VF-4 均判已修。
  - 修复本身的复评：对评审修订后的测试另设计变异，M25、M26、M27 在 `b22a19e5` 上 `SURVIVED`（S12）。按 D14 补测试后，在导出副本里逐条施加看红：M25 → C1「超时按请求计」`1 !== 14`；M26 → C6「路径与头」actual 含 `'https://evil.example'`；M27 → C2「非 github.com 账号（不带句柄）」的 `disabled` 缺 `[…c2, 'not_supported']`。未变异时新文件 `ℹ tests 15`、`ℹ pass 15`、`ℹ fail 0`。提交为 `081dfba7`（测试）与 `38feac4b`（只改注释的重构）。
  - 最终树整表变异：spec 在 `.superpowers/iter7-batch-20261021/pr355/` 的 `mutants-accept-host.json`（47 条：变异表 M1–M27 除 M19 外的全部拆分条目，加 N1–N7、N11、N12、N15、N16、N18）、`mutants-accept-legacy.json`（N17、N17b）与 `mutants-accept-boundary.json`（M19a/b、B1、B2）；`node scripts/review-mutate.mjs <spec>` → 53 条全部 `APPLIED` 且 `KILLED`，失败用例都含 `killedBy` 片段，三次 exit 0，之后 `git status --short` 只有本批待提交的文件。
  - 全量（代码树 `38feac4b`）：确认 `apps/harness-plugin/dist` 不存在后 `pnpm verify` → exit 0（`ℹ tests 1715`、`ℹ fail 0` 与 `ℹ tests 7`、`ℹ fail 0`；比修复后多出的 1 条是 C2 新行；verify 含 typecheck）；`pnpm run boundaries` → `ℹ tests 9`、`ℹ fail 0`。
  - 产物（`38feac4b` 的导出副本）：`pnpm --filter @harness-projects/app-harness-plugin pack:plugin` → exit 0，生成 `apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.0.0.tgz`；Batch 3 的 metafile 一行命令 → `{"host":{"development-github":true,"delivery-github-actions":true},"client":{"development-github":false,"delivery-github-actions":false}}`；删 dist 后 `node --test tests/integration/harness-plugin-artifact.test.js` → `ℹ tests 23`、`ℹ fail 0`。
  - 并集（D15；`git merge-tree --write-tree HEAD <ref>` 的树导出后跑；目标测试为 host-github-catalog、host-providers、artifact、host-watch、package-boundaries，存在时加 workspace-setup-commands，#373 另加 `tests/e2e/repository-routing.test.js`）：最新 `main` `d7e7bca6`（已含 #372、#371、#373，16:53 补跑）merge-tree exit 1，冲突只在 `docs/exec-plan/tech-debt-tracker.md`，在副本里按 S11 的解法把 TD-079 至 TD-081 接在 TD-078 之后，目标测试 7 个文件 `ℹ tests 117`、`ℹ fail 0`，`pnpm verify` `ℹ tests 1776`、`ℹ fail 1`（下述环境失败）；`main` `66870dfd`（含 #372、#371；本批 docs 提交之前的树）merge-tree exit 0，目标测试 `ℹ tests 82`、`ℹ fail 0`；`main` `f4e130cd`（只含 #372）exit 0，`ℹ tests 68`、`ℹ fail 0`；`feature/workspace-binding-commands`（观察时本地 ref `8a1a8650`，随后随 #371 合进 `main`）exit 0，`ℹ tests 82`、`ℹ fail 0`；`feature/repository-binding`（`f3c6f59a`）exit 1，冲突只在 `docs/exec-plan/tech-debt-tracker.md`（#373 自身落后 `main`），冲突树上 `ℹ tests 110`、`ℹ fail 0`。四个并集上 `pnpm verify` 都只有 1 条失败：`tests/contract/issue-policy.test.js` 的「CLI：脚本被改名成不带扩展名的副本后…」，输出 `fatal: not a git repository`，是导出副本不是 git 检出所致；对照：同一文件在 `38feac4b` 的导出副本里同样失败 1 条，在工作树里 `ℹ tests 40`、`ℹ fail 0`。
  - 规则检查以回读命令为准（期望写在 Batch 3 的验证行）：`node scripts/rule-checks.mjs size origin/main`（代码 + 测试 ≤ 800，文档 ≤ 1300；`38feac4b` 观察值代码 399、文档 251，docs 回填提交只加文档行）、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/workflow-check.mjs`、`git diff --check origin/main...HEAD`。
- [x] Batch 4 回填、登记与整合（整合于 2026-10-21 16:58 +08，协调者，见 D17）。回填与登记已完成（2026-10-21 16:49 +08，最终验收者；16:53 补记 `main` 的第三次前进与对应并集）：本计划的 Progress、S11、S12、D14–D16、Validation and Acceptance 的变异证据、Outcomes 与 Bottom Change Note；tracker 追加 TD-079、TD-080、TD-081，TD-082 不用。整合提交、backup ref 与推送待协调者（序列见 Outcomes & Retrospective）——已完成：变基到含 #371、#372、#373 的 `main` 并整合为三个提交，回读 `git log --oneline origin/main..HEAD`（在检出 `feature/host-github-delivery-catalog` 上，期望恰三行：规划、`feat(apps)` 交付物、回填）；恢复锚点 `refs/backup/host-github-delivery-catalog-20261021`（本机）。

本节各项写的提交 SHA 都是整合前的观察值；Batch 4 整合后以 `git log --oneline origin/main..HEAD`（在检出 `feature/host-github-delivery-catalog` 上）回读。

阻塞：无。#356（10-29 砍线）等待本 PR。

- [x] （2026-10-21，独立验收者 GPT-6.1）在 `b8a02cee` 加 C7/C8 的最终代码树上复核 issue #355 live AC1–AC4、完整 diff、PR head/base/checks/review 与评论（远端仍为旧规划 head，不把旧绿迁移到本地实现）。新增 C7 10 类失败/恢复与 C8 真实绑定写者链路；没有修改生产实现。命令均在检出 `feature/host-github-delivery-catalog` 的工作树根目录运行：
  - `node --test tests/integration/harness-plugin-host-github-catalog.test.js tests/integration/harness-plugin-host-providers.test.js tests/integration/workspace-setup-commands.test.js tests/e2e/repository-routing.test.js` → 90 tests，90 pass，0 fail。
  - `pnpm install --frozen-lockfile --offline` → exit 0；首次通过 Python 子进程调用 `pnpm verify` 遇到 pnpm 非 TTY 自动安装确认错误（没有进入测试），随后 `CI=true pnpm verify` → exit 0，typecheck 通过，主测试 1788 pass / 0 fail，MVP-0 7 pass / 0 fail；不是沿用历史通过结论。
  - 变异运行态 spec 位于 `.superpowers/pr388-independent/`：`node scripts/review-mutate.mjs .superpowers/pr388-independent/mutants.json` 的 A1–A7 全部 KILLED，分别判别错误状态码被吞、两个 provider 泄漏异常原文、凭据日志泄漏、绑定配置改写、绑定丢账号与坏 body 伪成功；相同目录的 `mutants-accept-host.json`（47）、`mutants-accept-legacy.json`（2）、`mutants-accept-boundary.json`（4）逐一运行均 exit 0、全部 KILLED、无 NOT_APPLIED / KILLED_OTHER。变异后生产文件与原 HEAD 的 diff 为空；合计 60 条。
  - `pnpm --filter @harness-projects/app-harness-plugin pack:plugin` → exit 0，生成 `harness-projects-app-harness-plugin-0.0.0.tgz`；生成的 dist 已移到忽略的运行态证据目录，源码目录不存在 dist。`node --test tests/integration/harness-plugin-artifact.test.js` → 23 pass / 0 fail，含 host/client 归属与真实安装件内容约束。
  - 归档后 `pnpm run boundaries` → 9 pass / 0 fail；`node --test tests/contract/plan-facts-consistency.test.js` → 3 pass / 0 fail；`node scripts/workflow-check.mjs` → no findings（8 workflows）；13 个固定 ExecPlan 章节各出现一次，README 新增链接与 tracker 三条来源均指向已归档文件。发布面与规模检查在提交后针对当前 HEAD 再运行，最终 push 后不要复用旧远端 checks。

## Surprises & Discoveries

- S14（2026-10-22）：#335 只保护 Planning 读，不能保护仅 Development 的组合探针；`githubRequest` 先等凭据再建 signal 是无界等待的根因。入口绝对预算测试使旧实现 `0 !== 1` 失败，修复后只 Development 组合按预算返回 degraded、零 fetch。初始已 abort 现在也在 fetch 前拒绝，因此 C7 对该行的计数改为零，原安全分类不变。

- S1 TD-054 写的实现键 `delivery.github-actions` 与代码不符，真实键是 `github-actions`。证据：`grep -n implementationKey packages/providers/delivery-github-actions/src/provider.ts`。按 D6 不改名，也不改 TD-054 这一行。
- S2 本分支建立时落后于 `origin/main`：#370 已合并，带来 `host-operations.ts` 与 `remote.ts` 的改动，但不动 `host-providers.ts`。回读：`gh pr view 370 -R SingularityKChen/harness-projects --json state -q .state`（期望 `MERGED`），`git diff --stat HEAD origin/main -- apps/harness-plugin/src/host-providers.ts`（期望无输出）。Batch 0 先快进。
- S3 GitHub 的 fine-grained PAT 权限表没有 Checks 一节，check-runs 文档只写 classic 令牌读私有仓库要 `repo` scope；令牌持有哪些权限没有离线可查的来源（`X-Accepted-GitHub-Permissions` 只说明端点需要什么）。来源见 D1。
- S4 `recordedPages` 对任意路径都应答，owner/name 对调的变异会在 REST 侧存活；Host 级路由必须自带三条路径的白名单（Batch 2 第一步）。
- S5 安装件测试按「存在」断言收录 provider 的前缀，文件属 #372；本 PR 用 metafile 一行命令取证，#372 合并后由后合并者补两条前缀。已在整合时补上（D17）。
- S6 `connectionState` 只有 `connected` 一个生产写者（F9），`reauth_required` 与 `disconnected` 今天不可达。
- S7 本计划写「C1–C6」，但没有定义 C3（验收表与变异表都只引用 C1、C2、C4、C5、C6）。实现保持编号、不补一个 C3，以免与变异表的归因错位。证据：`grep -nw 'C3' docs/exec-plan/active/2026-10-21-host-github-delivery-catalog.md` 只命中本条。
- S8 只挂研发条目时，「解析次数等于请求次数」杀不死 M16（凭据在 `create` 期解析一次并缓存）：组合与同库恢复各构造一次端口、各只发一个请求，两边恰好相等。C1 因此在恢复的研发端口上再读一次 `getRepository`，M16 随之被 C1 杀死（Batch 1 实现者自检变异）。Batch 2 的 Actions 端口每次构造发多个请求，不依赖这一条。
- S9 存储从不开 WAL：`packages/storage/sqlite/src/db.ts` 只设 `foreign_keys` 与 `busy_timeout`，`grep -rniI 'journal_mode' packages apps tests scripts` 无命中，SQLite 用默认回滚日志。Host 打开期间数据目录也只有 `workspace.sqlite`（导出副本里在 `compose` 的 `dispose` 之前 `readdir` 得 `['workspace.sqlite']`），所以 C1 的扫描对 `-wal`、`-shm` 从来是空覆盖；C1 也没有失败路径，`diagnostics.log`（`apps/harness-plugin/src/host-composition.ts` 只在禁用挂载、凭据解析失败、同步轮次失败与操作拒绝时写）不会出现。独立验证 VF-4 把原因归为「关闭时检查点删掉了 -wal」，现象属实、机理不对；按它的第一种建议「Host 打开时扫并断言 -wal 在场」做不到。处置见 D12。
- S10 计划原有的 C1 账本（`signal instanceof AbortSignal`）、C2 非 github.com 行（`github.example.com`）与 C5 缺字段行（只缺 `repositoryName`）分别判别不了「超时存在且为 30 s」「来源严格相等」「另外两个字段必填」：独立验证的 N8、N9、N10、N13、N14 在 `3e6e6b15` 上存活。GraphQL 出口的同一缺口沿用自 `tests/integration/harness-plugin-host-providers.test.js` 的 `instanceof` 断言。处置见 D13。
- S11 `origin/main` 在最终验收期间前进了三次：先到 `f4e130cd`（#372 合并，远端删掉 `feature/plugin-work-item-pages`），再到 `66870dfd`（#371 合并，远端删掉 `feature/workspace-binding-commands`），最后到 `d7e7bca6`（#373 合并，远端删掉 `feature/repository-binding`）。回读：`git ls-remote origin main feature/plugin-work-item-pages feature/workspace-binding-commands feature/repository-binding`（2026-10-21 16:52 +08 观察：只剩 `main`）。由此带来三件事：Batch 3 的并集对象有一格已不存在（处置见 D15）；`main` 的 tracker 在 Open 表尾追加了 TD-070 至 TD-078，本分支的 TD-079 至 TD-081 追加在旧表尾 TD-068 之后，变基到 `main` 时 `docs/exec-plan/tech-debt-tracker.md` 必然冲突，两边都保留、本 PR 的三行接在 TD-078 之后即可；S5 的「#372 合并后由后合并者补两条前缀」现在落到本 PR（`tests/integration/harness-plugin-artifact.test.js` 里 `for (const prefix of ['packages/providers/planning-github-projects/', 'packages/providers/development-local-git/'])` 这一行在 `main` 上仍在）。另：`git archive` 的导出副本不是 git 检出，`tests/contract/issue-policy.test.js` 的一条 CLI 用例在任何导出副本里都会失败，并集副本上的 `pnpm verify` 因此各有 1 条与本 PR 无关的失败（对照见 Progress）。
- S12 修复本身复评时，对评审修订后的测试（`b22a19e5`）另设计的三条变异都存活：M25 超时 signal 跨请求共用一个（C1 只查「这个 signal 来自 `timeout(30_000)`」，共用的那一个也满足；后果是第一个请求 30 s 后所有 GitHub 读立即中止）；M26 REST URL 改为 `new URL(path, GITHUB_API)`（C6 只有 `.evil.example/x` 一条路径，相对解析下它仍落在 api.github.com，而 `//evil.example/x` 会把带 bearer 的请求发往另一台主机；这正是 GraphQL 出口构造 URL 的写法，最容易被顺手统一）；M27 Actions 只在账号带句柄时才查来源（C2 的非 github.com 行都带句柄）。证据：`.superpowers/iter7-batch-20261021/pr355/mutants-accept-probe.json` 在 `b22a19e5` 上三条 `GREEN`/`SURVIVED`。处置见 D14。

- S13 C8 第一次把「真实绑定写者 → Host 组合」连起来时，整表不变的断言失败：绑定写者写单一 development 为 `is_default=0`，`packages/core/src/registry.ts` 的 `mountsOf` 按唯一研发挂载推导为 true，`packages/core/src/context.ts` 的 `createContext` 事务重写该标志；这是 base 已存在的组合语义。测试明确断言此归一，同时单独比较账号、配置、身份与仓库行，避免把 C1 的特定默认种子外推为任意整表不变。不是本 PR 的实现回归，不扩大到 Core 重构。

## Decision Log

- D20（2026-10-22，修复 owner）：D1 是对“未知权限默认 unavailable”的**有意只读降级**，不是该原则的推论。仅 github.com 账号带 Host 句柄时，Actions/Checks 两读 key 保持既有 `degraded`，Core 允许尝试读，但未知绝不等于 `available`，调用失败仍成为结构化缺口；无账号/句柄仍 unavailable，无写 key 被放行。直接取 unavailable 会阻断当前 demo 的 CI 读取，但没有权限证据就不能升级 available。本轮不新增权限政策或宣称人类已批准 D1； 本决策起草时的待确认状态 Superseded by D24（2026-10-22 13:34 SGT）：人类随后直接确认保持现有degraded只读尝试；#355 AC2“without permission”的宽口径歧义以来源决策说明保留，不悄然改写为“仅缺凭据”。TD-079 交 #278 的显式验证，各自取得 Actions 与 Checks 证据后再决定 available/unavailable；人类可推翻此降级选择，届时同步该常量、读门验收及 C1/C2。
- D21（2026-10-22，修复 owner）：TD-081 共同截止部分在本 PR 解决，signal 从 credential 前开始，独立 Promise.race 也约束不合作 fetch/body；只保留“每个研发挂载仍在组合关键路径串行探测”的 Open 残余，承接 #354。TD-076 的配置键不一致负例由 C11 完成，表单从同次仓库选择生成同键及 Development/Actions owner/name 由 #356 承接；TD-079 改交 #278。根协调者外部登记前，这些新验收只标准备，不宣称 issue 已更新。**Superseded by 2026-10-22 登记回读：#356 的同次选择/跨引用一致性与 #354 的关键路径残余验收已由开发账号更新；#278独立验证验收和#355来源说明均已登记；人类后续直接确认保持degraded，见D24与comment `6333568345`。**
- D22（2026-10-22，修复 owner）：撤销新增目录条目只造成挂载级 not_supported，不要求删除数据库行；C12 经缩目录/复目录验证与 ADR-0014 第3条一致。计划头与 Completed 索引用结果性措辞；D17 trailer 旧事实就地 superseded，不补虚构署名。
- D23（2026-10-22，根协调会话转录人类原话，覆盖 PR #388–#391）：『继续走修复流程PR#388-#391』。该请求承接根会话既有“修复→独立复评→归档→整理提交→核对 issue→rebase 合并”流程；本 owner 仅准备本地修复与精确外部文本，提交/rebase/push/作者回复/resolve/merge 由收到直接授权的根会话执行。该授权不覆盖 Planning Status 或 blocked-by/blocking 变更，本轮不写这些字段。

- D1 Actions 的权限证据只取 Host 确知的事实：github.com 账号带宿主句柄 → 两读 key `degraded`；无账号或无句柄 → `unavailable`；不在组合期探测。Rationale：仓库已有两条成文原则——「缺 permission 视为 unavailable（权限未知不得当成可用）」（`packages/capabilities/src/capability-keys.ts`）与「不能从空数据猜权限、不用 Actions 权限替 Checks 背书」（`docs/exec-plan/completed/2026-10-07-github-actions-read.md`）；GitHub 文档显示 fine-grained PAT 的权限表没有 Checks 一节、令牌权限无离线证据（https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens 、https://docs.github.com/en/rest/checks/runs 、https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api ）；同类系统在用户显式连接或保存时测试凭据、此后按单次调用报错（Grafana 数据源的 Save & test：https://grafana.com/developers/plugin-tools/tutorials/build-a-data-source-backend-plugin ；Argo CD 添加仓库时测试连接：https://argo-cd.readthedocs.io/en/stable/user-guide/private-repositories/ ），本 PR 没有这样的时刻。`degraded` 在 Core 读门放行，demo 照常读；它与研发 provider「探针未确认即 degraded」同义，S3 竞态下两域显示一致。代价：交付读能力在快照里长期是 degraded，令牌缺权限要到单次调用才出现——登记 TD-079，下一步由 #356 绑定时或 #335 定时刷新做一次只读探测把它升级，并与 TD-062 统一两域映射。改成 `available` 只需改一个常量与 C1 的期望。日期/作者：2026-10-21 / 协调者授权的独立评审者（Claude Opus）按调研决定，人类可推翻。 **Superseded by D20（2026-10-22）：旧 rationale 不能证明未知权限可用；当前只读有意降级及权限证据边界以 D20 为准。**
- D2 Actions 挂载无可用凭据时照常组合、显式 `unavailable`；研发挂载无凭据时禁用。Rationale：AC2 要求 provider 显式报告；禁用后 wire 上与「没有挂载」不可区分（F5）；研发的探针在无凭据时必然失败，组合只会得到误导性的 degraded。日期/作者：2026-10-21 / 独立评审者。
- D3 两条目共用一份配置 schema，owner/name 采用 provider 的 PATH_SEGMENT 规则。Rationale：坏值在写库时被拒，而不是到启动才禁用；首次声明无旧行（F1）；ADR-0014 下已声明 schema 再收紧会让整库打不开（TD-055），所以首版就取最严且与 provider 一致的规则；#373 写入的值满足它（F8）。已知限制：以 `.` 开头的仓库名（如 `.github`）不支持，并入 TD-080。日期/作者：同上。
- D4 两种出口共用 `githubRequest`，URL 用 pathname 赋值构造，方法按出口固定，宿主头最后写入。Rationale：issue 要求 REST 出口沿用现有出口的超时与脱敏规则，共用比复制两份更不会漂移；pathname 赋值使 origin 结构上不可变，免去测不到的守卫分支。日期/作者：同上。
- D5 不读 `connectionState`。Rationale：唯一生产写者只写 `connected`（F9），规划条目也不读它；加条件只多一个今天不可达的分支并让条目之间不一致。出现 `reauth_required` 的写者时，三个 GitHub 条目统一处理。日期/作者：同上。
- D6 保留实现键 `github-actions`。Rationale：实现键对系统不透明；#232 的契约测试与 #373 的写入都已用它；改名没有用户价值。只在 S1 订正 TD-054 的笔误。日期/作者：同上。
- D7 保持 `redirect: 'error'`。Rationale：GitHub 建议跟随重定向（https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api ），但注入的 fetch 不一定在跨源重定向时剥掉 Authorization；与现有 GraphQL 出口一致。代价：改名或转移的仓库得 `unavailable`，登记 TD-080（与 TD-064 同根，下一步按仓库数字 id 寻址）。日期/作者：2026-10-21 / 协调者授权的独立评审者按调研决定，人类可推翻。
- D8 不引入 Octokit，不新建共享 GitHub 包。Rationale：一个 GET 包装不值得新依赖；共享包要写 ADR 并改依赖边界（TD-061、ADR-0014 Rejected）。日期/作者：2026-10-21 / 独立评审者。
- D9 接受研发 provider 的组合期探针。Rationale：探针不抛错、无凭据时零 fetch；在 Host 包一层 `describeCapabilities` 会改写 provider 语义，改 Core 并行收集越界。代价登记 TD-081：每个研发挂载组合期最坏多 30 s；`githubRequest` 的超时只覆盖 fetch，凭据服务 `resolve` 挂起时组合随之挂起；下一步在 #335 / #354 引入快照刷新时把探针移出组合关键路径，并让截止时间覆盖「解析 + fetch」。日期/作者：同上。 **Superseded by D21（2026-10-22）：凭据/fetch/body 的共同预算已修，组合关键路径探针只保留准确残余并移交 #354。**
- D10 测试 helper 放 `tests/integration/fixtures/host-seed.js`（它的文件头声明承载 Host 测试的 GitHub 回放），不改 #372 的文件；TD-054 行的收窄、安装件测试的前缀与 `docs/README.md` 索引由协调者在相关 PR 合并后统一处理。日期/作者：同上。（前两项已由 D17 完成；`docs/README.md` 索引行与归档在人类评审通过、合并前做（Superseded by D19：协调者授权独立验收完成后归档，2026-10-21）。）
- D11 `githubRequest` 在写入宿主头之前把 provider 头名归一为小写。Rationale：设计要求宿主的 authorization 与 user-agent「不可被覆盖」；只按小写键展开时，provider 头若写成 `Authorization`，plain object 里两个键并存，`fetch` 按 `Headers` 规则合并成 `<provider 值>, bearer <令牌>` 发出。归一只多一行，C6 加大写变体判别（Batch 2）。测试账本相应地以 `new Headers(init.headers)` 记录请求头，即 fetch 实际会发的头。日期/作者：2026-10-21 / 实现者（Claude Opus 5.5）。
- D12 VF-4 的处置：收窄说法并钉住扫描范围，不改成「Host 打开时扫」。C1 在扫描前断言 `readdir(dataDir, { recursive: true })` 恰为 `['workspace.sqlite']`，扫描断言文案改为「库文件不含凭据值」，`tests/integration/fixtures/host-seed.js` 的 `occurrences` 注释不再声称含 `-wal`、`-shm`；AC3 原文就地标注 Superseded。Rationale：存储不开 WAL（S9），打开期扫描与关闭后扫描看到的是同一个文件，`-wal` 在场的断言不可能成立；issue 的 AC3 要求的是库行与 wire，库文件扫描加 wire 断言已覆盖。钉住文件集合让说法成为证据：日后存储开 WAL 或 C1 出现诊断日志，这条断言先变红，迫使重新确定扫描对象（M24 以多写一行诊断日志验证它会红）。日期/作者：2026-10-21 / 修复者（Claude Opus 5.5）。
- D13 VF-1 至 VF-3 只补测试，不改实现。VF-1：C1 用 `t.mock.method(AbortSignal, 'timeout')`（不替换实现，只记录参数与返回值），逐请求断言交给 fetch 的 signal 就是 `timeout(30_000)` 返回的那个；放在 C1 而不放 C6，因为 C1 的账本同时覆盖 GraphQL 与 REST 两个出口的真实请求，两者共用 `githubRequest` 的同一行，一处断言同时钉住两边；`tests/integration/harness-plugin-host-providers.test.js` 按 Global Constraints 只改 import，它的 `instanceof` 断言保持不动。VF-2：C2 加 `https://github.com.example` 一行（`canonicalOrigin` 接受它），研发与 Actions 都要 `not_supported`、零请求；原 `github.example.com` 行保留。VF-3：C5 的缺字段行按 `Object.keys(valid)` 展开为三行，D3「坏值在写库时被拒」对三个字段都成立。四条都是 P3、各自一两行，修复比登记技术债更便宜，因此不占用 TD 号段。日期/作者：2026-10-21 / 修复者（Claude Opus 5.5）。
- D14 S12 的三处缺口只补测试，不改实现：C1 断言各请求的 signal 互不相同（`new Set(signals).size === requests.length`）；C6 的路径加 `//evil.example/x`；C2 加「非 github.com 账号（不带句柄）」一行，期望研发与 Actions 都 `not_supported`。仍不加 origin 守卫分支（D4 不变）：pathname 赋值已在结构上保 origin，C6 现在对拼接与相对解析两种最可能的改写都有判别，守卫分支只会多一个测不到的分支。M27 的后果本身无害（没有句柄就没有令牌可发），补它是因为真值表第四行写的是「非 github.com 一律禁用」，C2 按格判别，缺这一格时该行的说法没有证据。Rationale：三处都是一行断言，比登记技术债便宜，且 M25 的后果（30 s 后所有 GitHub 读失败）是真实的故障模式。日期/作者：2026-10-21 / 最终验收者（Claude Opus 5.5）。
- D15 并集对象换成最新 `main`：`feature/plugin-work-item-pages` 与 `feature/workspace-binding-commands` 都已合并进 `main` 并从远端删除（S11），与已删分支求并没有意义，与 `main` 求并才是变基后真正要过的树；`feature/repository-binding` 先照原计划核对，它随后也合并（`d7e7bca6`），最终以与 `d7e7bca6` 的并集为准，早先几次并集留作过程证据。导出副本里 `issue-policy` 的一条 CLI 失败按对照判为环境所致，不阻塞。S5 的安装件测试前缀与 tracker 变基冲突仍按 D10 与 Global Constraints 交给协调者，本 PR 不越出文件集合：前缀那一行属已合并的 #372 的文件，冲突只能在变基时解决。日期/作者：2026-10-21 / 最终验收者（Claude Opus 5.5）。
- D16 保留 C 编号、不补也不重排 C3（S7），只在 Purpose 注明。Rationale：Validation and Acceptance、变异表与三轮变异 spec 的 `killedBy` 都按 C4、C5、C6 归因，重排会让既有证据与新编号错位，而缺一个编号不影响任何判定。日期/作者：2026-10-21 / 最终验收者（Claude Opus 5.5）。

- D17 协调者整合与后合并者义务（2026-10-21 16:58 +08，协调者 / Claude Opus 5.5）：① 不做逐提交变基，按路径在 `origin/main`（`d7e7bca6`，含 #371、#372、#373）上重建三个提交；与整合前 head 相比，除 tracker 合入 `main` 的行与下述两处外，Global Constraints 里每个路径逐字节相同（`git diff refs/backup/host-github-delivery-catalog-20261021 HEAD -- <路径>` 为空）。② #372 合并后本 PR 是安装件测试的后合并者：`tests/integration/harness-plugin-artifact.test.js` 的宿主输入前缀断言加 `packages/providers/development-github/` 与 `packages/providers/delivery-github-actions/`。这条断言钉的是打包归属（provider 包进了宿主半边、不是裸说明符），不是目录成员关系：从目录删掉条目（变异 K1、K2）后 provider 仍随 `host-providers.ts` 的 import 进 bundle，K1、K2 存活符合预期，目录成员由 C1 的 M1、M2 判别；spec 在 `.superpowers/iter7-batch-20261021/pr355/mutants-coordinator-artifact.json`（运行态）。③ TD-054 行尾追加收窄说明（原文不动）：两个条目已收入、X2 与 X24 已有判别；执行条目、GHES / 多账号、句柄名写者与 X16 仍开放。④ 三个提交的 `Co-Authored-By` 统一写 Claude Opus 5.5（实现与验收的实际模型都是 Opus；本仓库的提交署名按协调会话的归属规则）。**Superseded by D19（2026-10-22 核实）：重新整理后的三个提交没有 trailer；署名以最终 `git log --format='%(trailers)' origin/main..HEAD` 回读为准，不据本条虚构 trailer。**Rationale：tracker 是唯一与 `main` 冲突的文件，按路径重建比逐提交解冲突少出错；②③ 是 D10 交给协调者的义务，前提（#372、#373 合并）已成立。

- D18 仅补独立验收证据、保持现行行为（2026-10-21 / GPT-6.1）。C7/C8 使用生产目录与真实写者，保留两域既有失败分类及 S13 默认归一，不借验收修改公共接口或 Core。`HOST_ENTRY.allow` 的两项增量是 ADR-0013 / ADR-0014 既有受控 Host 组合例外的目录成员同步；不新增 Host 入口、不放宽通用架构矩阵，也不允许 client 依赖 provider。独立拆出 allow 两项会产生「有接线但契约拒绝」或「没接线但先放宽」的半成品，因此与目录、manifest 和安装件契约作为同一闭环审阅及回滚。依据：上述 ADR、`tests/contract/package-boundaries.test.js` 的精确入口白名单，以及独立回读的 esbuild 官方 external 文档（https://esbuild.github.io/api/#external ，2026-10-21 HTTP 200；external 会排除 bundle 内容，所以必须同时保留安装件的 host/client 归属检查）。这不是对未来规则变更混入功能 PR 的普遍豁免。
- D19 协调者授权验收后归档（2026-10-21 / GPT-6.1）。实现及 issue #355 的离线 AC 均已完成；本计划移入 `completed/`，README 加索引，TD-079 至 TD-081 的来源引用同步。历史 D10/D17/Outcomes 中「人类评审通过后归档」的时间安排由此取代；人类对 PR 的评审与合并权限保持不变。最终历史整理、push、远端回读与 ready 由协调者执行，不是本子任务的外部写入。

- D24（2026-10-22 13:34 SGT / 本会话人类直接答复，协调者逐字转录）：对“有Host句柄但Actions/Checks权限未验证”的选择，原话为“保留 degraded，只读尝试（推荐）”。保留现有两个读key的degraded试读，缺可用github.com账号/句柄仍unavailable，失败保持结构化，不得无证据升available或新增写权限。#355 AC2正文以该明确区分澄清，来源comment `6333568345`；#278独立权限证据验收已按该决定回读。此授权只覆盖PR #388的权限门，不写Project Status或blocked-by。

## Idempotence and Recovery

- 测试每次在 `mkdtemp` 新建数据根，可任意重跑；`pnpm install --offline` 与 `pack:plugin` 可重复执行，`pack:plugin` 后必须 `rm -rf apps/harness-plugin/dist`。
- 变异脚本施加前按字节读入原文、跑完写回并逐字节比对；被中断时以 `git diff --stat` 为空确认工作树已还原。
- 并集核对只在 `mktemp -d` 的导出副本里跑，`git merge-tree --write-tree` 不改工作树与分支。
- 回到已知良好状态：未推送时 `git reset --keep <上一批提交>`；已推送时 `git revert`；Batch 4 改写前的 backup ref 是整合失败时的恢复锚点，force 推送按 `git-expert-operations` 流程用精确的 `--force-with-lease`。
- 本 PR 不迁移、不改库结构。合并前回滚无副作用；若 #373 / #356 已在用户库写入这两种实现键的配置行后再回滚，开库会因 schema 未声明整体 fail closed（ADR-0014 第 3 条、TD-055），处置是连同回滚删除这些挂载行后重新绑定（首发前不写兼容层）。 **Superseded by D22（2026-10-22）：未声明实现键在开库时隔离，Host 照常启动，仅在内存将这两个挂载标 `not_supported`；库行与身份保留，目录恢复后原身份复活。不得据本条要求删除挂载行；只有已声明 schema 的坏配置才会整库 fail closed。**

## Interfaces and Dependencies

- provider 包导出：`@harness-projects/provider-development-github` 的 `GITHUB_DEVELOPMENT_DEFINITION`、`createGithubDevelopmentProvider`；`@harness-projects/provider-delivery-github-actions` 的 `GITHUB_ACTIONS_DEFINITION`、`createGithubActionsDeliveryProvider`、`GithubActionsTransport`；`@harness-projects/capabilities` 的 `AccessLevel`、`CapabilityKey`。根 `tsconfig.json` 的 paths 与根 devDependencies 已含两包。
- 命名契约（下游 #373、#356 依赖）：实现键 `development.github`（域 development）与 `github-actions`（域 delivery）；配置恰为 `repositoryExternalId`（工作区 `repositoryId` 的本地键，不是 node id）、`repositoryOwner`、`repositoryName`；两条引用关联同一 github.com 账号；句柄 `HARNESS_PROJECTS_GITHUB_TOKEN`。
- 新导出：`githubRestTransport`（供 C6 直接判别出口规则；生产只经目录条目使用）。
- GitHub：`POST https://api.github.com/graphql`；`GET /repos/{owner}/{repo}/actions/runs`、`/commits/{sha}/check-runs`、`/commits/{sha}/check-suites`，API 版本头 `2022-11-28`。
- 工具：Node（`.nvmrc`）、pnpm 10.28.2、`gh` 命令一律带 `-R SingularityKChen/harness-projects`；变异脚本 `scripts/review-mutate.mjs`。
- 协调事项：#297 合并前同一工作区同挂 Local Git 与 GitHub 研发只得到缺口（F10），影响 #356 的 demo 路径排期而不影响本 PR；`docs/README.md` 的索引行与 TD-054 行由协调者处理。

## Outcomes & Retrospective

截至 2026-10-21 15:05 +08 只完成规划，没有实施结果。规模估算（评审合成值，Batch 3 以 `size` 命令回读实测）：实现约 +60 / −15 行（`host-providers.ts`）加 manifest 2 行；测试约 250 行（新测试文件约 190、`host-seed.js` 约 +40、边界测试 3、`harness-plugin-host-providers.test.js` 约 10）；代码合计约 325 行，低于 800。文档：本计划约 260 行，回填后预计不超过 400 行，tracker 追加 3 行；低于 1300。（以上为规划时的估算，实际结果见下文，2026-10-21。）

实际结果（2026-10-21 16:49 +08，最终验收者；16:53 补记 #373 合并后的并集）：

- 交付：`apps/harness-plugin/src/host-providers.ts` 收录 `development.github` 与 `github-actions` 两个条目，两种 GitHub 出口共用 `githubRequest`，新增 `githubRestTransport`，Actions 权限按真值表在内存推导；`ProviderBuildInput`、`CatalogEntry`、`restoreProviders` 与 `createHostComposition` 的签名都没变。issue #355 的 AC1–AC4 都有具名测试与变异证据（Validation and Acceptance 表）；最终树整表 53 条变异全部 `KILLED`，产物与 bundle 归属、与最新 `main`（已含 #371、#372、#373）的并集都通过（Progress 的 Batch 3 一项）。
- 规模：以 `node scripts/rule-checks.mjs size origin/main` 回读（期望代码 + 测试 ≤ 800、文档 ≤ 1300）；`38feac4b` 观察值代码 399 行，比估算的 325 行多出的主要是三轮评审补的判别断言与 `githubFetch` 的请求账本。
- 与计划的偏差：provider 头名先归一为小写（D11）；C1 在恢复的研发端口上多读一次以杀死 M16（S8）；没有 C3（S7、D16）；C1 的凭据扫描从「数据目录含 -wal、-shm、诊断日志」收窄为「扫描时恰为库文件」（D12，AC3 原文已标 Superseded）；独立验证与最终验收各找到一批测试判别缺口，共补 8 条变异的断言（D13、D14），实现没有因此改动；并集对象换成最新 `main`（D15）；Batch 1–2 实际由 Claude Opus 5.5 实现，不是计划写的 Sonnet。
- 遗留：TD-079（Actions 权限只到 `degraded`）、TD-080（不跟随重定向与 `.` 开头的仓库名）、TD-081（研发探针在组合关键路径上、超时不覆盖凭据解析）；TD-082 不用。#297 合并前 Local Git 与 GitHub 研发同挂一个工作区只得到缺口（F10），影响 #356 的 demo 路径。没有待人类决定的事项：D1 与 D7 写明人类可推翻，推翻时按 TD-079 / TD-080 的下一步改。 Superseded by D20、D24（2026-10-22）：本轮明确提出AC2权限语义选择，人类已直接选择保留degraded只读尝试；超时不覆盖凭据的旧说法由D21预算修复取代。
- 交给协调者：① 整合为三个提交——`docs(exec-plan): 规划 Host 目录收录 GitHub 研发与 Actions provider`（只含本计划的初版）、`feat(apps): Host 目录组合 GitHub 研发与 Actions provider`（Global Constraints 里除本计划与 tracker 之外的全部路径，实现、测试与三轮评审修订必须一起回滚）、`docs(exec-plan): 回填 #355 实施、验收与技术债`（本计划的回填与 tracker 的三行）；② 变基到最新 `main` 时解决 tracker 冲突（S11）；③ 按 D10 补安装件测试的两条前缀、收窄 TD-054、加 `docs/README.md` 索引行并归档本计划。（①②③ 的前两项已由 D17 完成；索引行与归档在人类评审通过、合并前做（Superseded by D19：协调者授权独立验收完成后归档，2026-10-21）。）
- 教训：两轮复评都发现「修好了」的断言比它的文案窄——VF-1 的修复写着「逐请求」，判别的却只是参数，共用一个 signal 照样全绿（S12）。断言文案里的每个量词都要有一条变异去试。

独立复核补充（2026-10-21 / GPT-6.1）：C7/C8 只增加测试，没有发现需要修改本 PR 实现的 P0/P1。实际通过 1788 + 7 全量测试、23 安装件测试与 60 条变异；闭环证据及限度见 Validation and Acceptance 的风险矩阵。新增两用例应与功能提交一起验收和回滚，不作为独立产品能力；归档与索引回填可并入最终文档提交。协调者整理提交后重锁当前 head，并在最终 push 后重新获取真实 CI / review / issue 关联，再执行 ready；本验收不批准合并。

## Bottom Change Note

- 2026-10-21 15:05 +08：创建。由协调者授权的独立评审者核实三份独立设计后合成：采纳设计 2 的 `degraded` 权限语义、URL 构造与失败路径表，设计 1 的变异清单与夹具路由，设计 3 的组合期请求计数与并集取证思路；否决 `connectionState` 推导、REST 路径守卫分支、改 #372 的文件与改名实现键。
- 2026-10-21 15:59 +08：实现者回填 Batch 0（协调者已完成）与 Batch 1 的 Progress，追加 S7、S8 与 D11。
- 2026-10-21 16:05 +08：实现者回填 Batch 2 的 Progress。
- 2026-10-21 16:25 +08：修复者处置独立验证的 VF-1 至 VF-4：AC2、AC3 与 C1 账本、C5 拒绝行的说明随测试收紧（AC3 原文就地标注 Superseded），变异表追加 M21–M24，追加 Progress 一项、S9、S10、D12、D13。
- 2026-10-21 16:49 +08：最终验收者回填 Batch 3 与 Batch 4 的回填部分：Batch 3 的 spec 路径与并集对象就地标注 Superseded；Validation and Acceptance 每项补上变异证据，C1 账本、C2、C6 的说明随 D14 收紧；变异表追加 M13b、M25–M27；Purpose 注明没有 C3；追加 S11、S12、D14–D16 与实际的 Outcomes；tracker 追加 TD-079 至 TD-081。
- 2026-10-21 16:53 +08：最终验收者补记 `main` 的第三次前进（#373 合并，`d7e7bca6`）与对应并集，修正上一条回填里写早了的时刻。
- 2026-10-21 16:58 +08：协调者整合提交并变基到含 #371、#372、#373 的 `main`，补安装件测试前缀与 TD-054 收窄（D17），Global Constraints 与 S5、D10、Batch 4 就地标注。

- 2026-10-21：独立验收者补 C7/C8、60 条变异与 1788 + 7 全量测试证据；细化 P0–P3 风险矩阵、默认标志归一与 HTTP 分类的证据边界，记录既有 Host 依赖例外为何与目录接线同闭环；按协调者授权归档并加 Completed 索引（D18、D19）。

2026-10-22 SGT：按六条 MMP P2/P3 完成入口共同预算、只研发挂起反例、迟到结果消费、配置错键零REST与回滚保留身份验证；D1/TD承接/trailer/索引就地更正，新增授权转录，外部 issue/PR 文本由根协调者审查登记。

2026-10-22 SGT 本轮实测：C9/C10在旧实现因入口尚无deadline而RED，修复后Host35/35；完整pnpm verify为1843+7、exit0；七项修复变异全KILLED、字节恢复。根会话已就#355 AC2的未知权限策略向人类提问，答复前保持现策略且不关闭#355；不把D20解释为新政策授权。修复独立复评与最终新head门禁由根协调者执行。

2026-10-22 SGT 外部承接回读：根协调者以开发账号、幂等键 pr388-20261022-TD-handoff-356/354，在匹配基正文hash后登记并回读 #356（2026-10-22T05:07:29Z）与 #354（05:07:35Z）；本owner核对新增验收原文，TD076/081行已改为准确已承接。TD079/#278验证验收、#355来源comment6333489669与人类确认comment `6333568345`均已回读；不新增规划字段或关系写入。

2026-10-22技术独立复评APPROVE：35项Host目录、三个原生超时探针、四项临时副本变异均通过，完整verify1843+7经日志复核。实际源测试冻结哈希保持。#355 AC2权限语义后由人类明确确认，comment `6333568345`；该选择与预算/回滚技术修复分别有证据。

2026-10-22修复并集证据：在独立检出`test/repair-queue-pr388@7e5ab3d6a8093a3521a8d759c5b8a7a9507c2b52`先执行真实pack:plugin，随后CI=true pnpm verify为1886+7、fail0。四PR产品输入及清单指纹见各自评审记录；该记录不继承到之后变基的新head，最终发布仍回读CI、threads与原生issue关联。

2026-10-22 13:34 SGT：人类明确选择保留degraded只读尝试，D24逐字记录并在#355回读comment `6333568345`，#278/#354/#356残余验收均已真实登记。权限政策确认不再阻塞本PR授权收尾，当前head仍须重锁验证与批准。

2026-10-22最终变基：真实main为`09dd18f0c50abd851b42d0eb3db062154b980866`，产品blob清单与1886+7的修复并集一致；仅索引/债务事实冲突，保留双方。D24人类直接决定、外部issue承接和独立技术复评齐备，新head发布门/批准不沿用旧结果。
