# Host 目录收录 GitHub 研发与 Actions provider ExecPlan

> 状态：Active
> 创建：2026-10-21
> 范围：完成 issue #355：Host 编译期目录（`apps/harness-plugin/src/host-providers.ts`）加入 `development.github` 与 `github-actions` 两个条目、Actions 需要的宿主 REST 出口，以及由 Host 推导并传入的 Actions 权限；不含绑定命令与界面（#373、#356）、Host 重组（#354）、快照刷新（#335）与执行实现（#140）。
> 上游输入：`AGENTS.md`、`PLANS.md`、issue #355（正文与验收项）、`docs/adr/ADR-0014-host-composes-providers-by-implementation-key.md`（Proposed）、`docs/exec-plan/tech-debt-tracker.md` 的 TD-054、TD-056、TD-062、TD-064、TD-067，`docs/exec-plan/completed/2026-10-07-github-actions-read.md`、`docs/exec-plan/completed/2026-10-15-github-development-read.md`、`docs/exec-plan/completed/2026-10-15-host-provider-composition.md`；三份独立设计（最小闭环 / 凭据与失败路径 / 系统组合）经独立评审合成本计划。
> 执行上下文：分支 `feature/host-github-delivery-catalog`，工作树 `.worktrees/host-github-delivery-catalog`；base 为 `origin/main`（含已合并的 #370），以 `git rev-parse origin/main` 回读。

## Purpose / Big Picture

完成后，库里已存的 `development.github` 挂载与 `github-actions` 挂载在 Host 启动时被组合成真实 provider：研发 provider 经宿主 GraphQL 出口读仓库与变更请求，Actions provider 经新的宿主 REST 出口读 workflow runs 与 check runs。Actions 的两个读 key 由 Host 按账号事实推导权限后传入：有 github.com 凭据句柄时为 `degraded`（未验证，照常读，逐次调用结果为准），没有可用凭据时显式 `unavailable`。凭据值只在单次请求的 `authorization` 头里出现，不进库、日志与 wire。#356 的绑定界面与 #354 的重组因此可以直接用这两个目录条目，demo 的交付视图才有 PR 与 CI 可读。

最小成功证据：新测试文件 `tests/integration/harness-plugin-host-github-catalog.test.js` 的 C1–C6 在录制夹具上离线全绿；变异表全部 KILLED；`pnpm run boundaries` 通过；`pack:plugin` 能出安装件且两个新 provider 只进宿主半边。

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
/** 唯一的 GitHub 出口：先解析凭据（undefined 或空串即 reject，零 fetch）；redirect:'error'；AbortSignal.timeout(30_000)；
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

失败路径：配置不合 schema → 写库 `RangeError`；读库时缺配置 → `invalid_input`，只禁用该挂载；第二个启用 delivery 挂载 → `conflict`；凭据解析不到 → transport reject、零 fetch，provider 报 `unavailable`（`transport_error`）；超时、网络错误、3xx（改名或转移的仓库）→ `unavailable`；401 / 非限流 403 → `permission_denied`；404 → `not_found`（GitHub 对无权访问的私有资源也回 404）；限流 → `rate_limited`；错误文案固定，不回显响应正文。

被放弃的方案：
- 有句柄即 `available`（设计 1、3）：见 Decision Log D1。
- 组合期探测权限（三份设计都否决）：判断冻结到下次组合；Desktop 上 Host 可能先于凭据服务激活（ADR-0014 记录的 S3 竞态），探测必然失败；checks 探测需要提交 sha，组合期没有；多出第三个触网点（TD-056）。
- 把权限存进挂载配置：用户声明不是凭据证据，换令牌即过期，形成第二个事实源，并改变 #373 / #356 的写入契约。
- 没有凭据时禁用 Actions 挂载：验收要求 provider 显式报 `unavailable`；禁用后 wire 上与「没有挂载」无法区分（F5）。研发挂载仍禁用：它的探针必然失败，会被误报成 degraded。
- 读 `connectionState`（设计 1、2）：见 D5。
- REST 出口加 `/repos/` 前缀或 origin 断言分支（设计 1、3）：pathname 赋值已在结构上保 origin；owner/name 由 schema 与 provider 两处校验，方法在类型与实现里都固定为 GET，前缀守卫只保护已校验的输入。
- 改名实现键为 `delivery.github-actions`、跟随重定向、引入 Octokit 或新建共享 GitHub 包：见 D6、D7、D8。
- 在 Host 拦截 #297 合并前 Local Git 与 GitHub 研发同挂：后果是 fail closed 的缺口（F10），拦截反而挡住 demo 的目标配置；跨挂载判定以后还得删。
- 改 `tests/integration/harness-plugin-artifact.test.js` 或 `tests/integration/README.md`（设计 3）：两者属 #372，改用构建 metafile 一行命令取证（Batch 3）。

关键不变量：身份只来自存储（首次组合不改写四张身份表）；运行期失效不写库；凭据值只存在于一次请求内；权限快照不入库；apps 只经 `HOST_ENTRY` 例外 import provider；provider 之间不互调。

## Global Constraints

- 本 PR 改动的文件集合（唯一一处声明）：`apps/harness-plugin/src/host-providers.ts`；`apps/harness-plugin/package.json`（加两项 workspace 依赖）；`pnpm-lock.yaml`（随之更新，不计规模）；`tests/contract/package-boundaries.test.js`（只改 `HOST_ENTRY.allow` 与其注释）；`tests/integration/fixtures/host-seed.js`（加 `githubFetch` 与种子 helper，迁入 `occurrences`）；`tests/integration/harness-plugin-host-providers.test.js`（只把 `occurrences` 改为从 host-seed 导入）；新建 `tests/integration/harness-plugin-host-github-catalog.test.js`；本计划文件；`docs/exec-plan/tech-debt-tracker.md`（Batch 4 只追加 TD-079 至 TD-081，TD-082 预留不用）。
- 不改：`packages/**`（含两个 provider 包、core、controller、capabilities、client、ui-model、ui、storage）；`apps/harness-plugin/src/` 的 `host.ts`、`host-composition.ts`、`host-operations.ts`、`host-surface.ts`、`remote.ts`、`client.ts`、`workspace-watch.ts`；`apps/web/**`；`docs/README.md`（索引行由协调者统一加）；`docs/adr/**`（ADR-0014 保持 Proposed）；`docs/product/vertical-path.md`；`tests/integration/harness-plugin-artifact.test.js`、`tests/integration/README.md`、`tests/integration/harness-plugin-host-watch.test.js`、`tests/integration/workspace-setup-commands.test.js`；tracker 既有行（尤其 TD-054，#373 在改）。
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
- [ ] `git fetch origin && git merge --ff-only origin/main`（分支此前没有自有提交）；`pnpm install --frozen-lockfile --offline`。
- [ ] 提交本计划；draft PR、issue 关联与字段由协调者执行。
**验证**：`git rev-list --count HEAD..origin/main` → `0`；`node scripts/rule-checks.mjs disclosure origin/main` → exit 0；`git diff --check origin/main...HEAD` → 无输出。
**回滚**：丢弃该提交；没有代码改动。

### Batch 1 · 研发条目与共享出口
**最小闭环**：已存 `development.github` 挂载在 Host 启动时组合，并经宿主 GraphQL 出口读通变更请求。
**涉及文件**：`apps/harness-plugin/src/host-providers.ts`、`tests/integration/fixtures/host-seed.js`、新测试文件。
- [ ] 先写测试：host-seed 加 `githubFetch()`（GraphQL 回放合并规划两份夹具与 `github-development/sandbox.json`，账本记 origin、path、method、operationName、全部请求头、redirect、signal；未命中进 `misses`）与写挂载、账号关联、配置的 helper，迁入 `occurrences`；新文件写 C1 的研发部分（规划 + 研发挂载，owner/name 从 sandbox 夹具的 `DevelopmentRepository` 交换读出，不写字面值）、C2 的研发行、C5 的研发键。
- [ ] 跑 `node --test tests/integration/harness-plugin-host-github-catalog.test.js`，期望红在播种：`RangeError: binding configuration is not declared for this implementation key`。
- [ ] 实现 `githubRequest`、GraphQL 出口改委托、`GITHUB_REPOSITORY`、`requireGithubCredential`、研发条目与目录；manifest 加 `@harness-projects/provider-development-github`，`pnpm install --offline` 更新锁文件；`HOST_ENTRY.allow` 加 `packages/providers/development-github`。
**验证**：`node --test tests/integration/harness-plugin-host-github-catalog.test.js tests/integration/harness-plugin-host-providers.test.js` → `ℹ fail 0`，原有 Host 用例数不变；`pnpm run boundaries` → `ℹ fail 0`；`pnpm run typecheck` → exit 0。
**回滚**：撤回本批提交（已推送用 `git revert`）；没有库迁移。

### Batch 2 · Actions 条目、REST 出口与权限
**最小闭环**：已存 `github-actions` 挂载按账号事实组合，Host 传入的权限出现在 wire 上，端口经宿主 REST 出口读通 runs 与 checks。
**涉及文件**：同 Batch 1 的三个主文件。
- [ ] 先写测试：`githubFetch()` 加 REST 路由，只认 `runsPath()`、`checksPath(COMMIT)`、`suitesPath(COMMIT)` 三条路径（其余进 `misses` 并 reject），查询串里纯数字值还原为数字后交给 `recordedPages`；C1 加 Actions 挂载与交付断言，C2 加 Actions 行，写 C4、C5 的 `github-actions` 键；跑出红：播种 `RangeError`。再写 C6，跑出红：`githubRestTransport` 未导出。
- [ ] 实现 `githubRestTransport`、Actions 条目与目录；manifest 加 `@harness-projects/provider-delivery-github-actions`，更新锁文件；`HOST_ENTRY.allow` 加 `packages/providers/delivery-github-actions`。
**验证**：Batch 1 的命令全部 `ℹ fail 0`，另跑 `node --test tests/contract/delivery-github-actions-contract.test.js tests/contract/development-github-contract.test.js tests/integration/harness-plugin-host-watch.test.js` → `ℹ fail 0`。
**回滚**：撤回本批提交，回到 Batch 1。

### Batch 3 · 对抗验收、产物与并集（Opus）
**最小闭环**：变异表全部被具名用例杀死，安装件可构建，三个在途分支的并集仍绿。
- [ ] 变异 spec 放 `.superpowers/pr355/`（运行态，不入库）：`mutants-host.json` 的 command 为新测试文件，`mutants-boundary.json` 的 command 为 `node --test tests/contract/package-boundaries.test.js`；每条带 `killedBy`。跑 `node scripts/review-mutate.mjs .superpowers/pr355/mutants-host.json` 与 boundary 那份 → exit 0，逐条 `APPLIED` 且 `KILLED`，没有 `NOT_APPLIED` / `KILLED_OTHER`。
- [ ] 独立审读与重构：死代码、重复、注释与本计划一致；改动后重跑变异表整表。
- [ ] 产物：`pnpm --filter @harness-projects/app-harness-plugin pack:plugin` → exit 0 且 `apps/harness-plugin/dist/` 下有 `.tgz`；随后 `rm -rf apps/harness-plugin/dist`（#350：dist 会让源扫描多算）。bundle 归属：`OUT=$(mktemp -d) && node --input-type=module -e "import { build } from './apps/harness-plugin/scripts/build.mjs'; const { metafiles } = await build({ outDir: process.argv[1] }); const pick = (m) => Object.fromEntries(['development-github', 'delivery-github-actions'].map((p) => [p, Object.keys(m.inputs).some((i) => i.startsWith('packages/providers/' + p + '/'))])); console.log(JSON.stringify({ host: pick(metafiles.host), client: pick(metafiles.client) }))" "$OUT"` → `{"host":{"development-github":true,"delivery-github-actions":true},"client":{"development-github":false,"delivery-github-actions":false}}`；`node --test tests/integration/harness-plugin-artifact.test.js` → `ℹ fail 0`。
- [ ] 并集：对 B ∈ {`feature/workspace-binding-commands`, `feature/plugin-work-item-pages`, `feature/repository-binding`} 执行 `T=$(git merge-tree --write-tree HEAD origin/$B) && U=$(mktemp -d) && git archive "$T" | tar -x -C "$U" && (cd "$U" && pnpm install --frozen-lockfile --offline && node --test tests/integration/harness-plugin-host-github-catalog.test.js tests/integration/harness-plugin-host-providers.test.js tests/integration/workspace-setup-commands.test.js tests/integration/harness-plugin-artifact.test.js)`（`merge-tree` 冲突时 exit 1，记入 Surprises）→ `ℹ fail 0`。
**验证**：`pnpm verify` → exit 0（先确认 `apps/harness-plugin/dist` 不存在）；`node scripts/rule-checks.mjs size origin/main` → 代码 ≤ 800、文档 ≤ 1300；`node scripts/rule-checks.mjs disclosure origin/main` → exit 0；`node scripts/workflow-check.mjs` → 无发现；`git diff --check origin/main...HEAD` → 无输出。
**回滚**：重构单独提交，可单独撤回；变异脚本按字节还原，失败时以 `git diff --stat` 为空确认。

### Batch 4 · 回填、登记与整合
**最小闭环**：计划与 tracker 反映真实结果，提交整合成三个可独立审阅的交付物。
- [ ] 回填 Progress、Surprises、Decision Log、Outcomes；tracker 追加 TD-079 至 TD-081（内容见 Decision Log D1、D7、D9）。
- [ ] 先建 backup ref，再整合为：`docs(exec-plan): 规划 Host 目录收录 GitHub 研发与 Actions provider`、`feat(apps): Host 目录组合 GitHub 研发与 Actions provider`、`docs(exec-plan): 回填 #355 实施、验收与技术债`；正文说明为什么，末尾 `Refs #355`，不写关闭关键字。
**验证**：`comm -3 <(git diff --name-only origin/main...<backup-ref> | sort) <(git diff --name-only origin/main...HEAD | sort)` → 无输出；`git diff --name-only origin/main...HEAD` 与 `Global Constraints` 的集合一致；`git log --format=%B origin/main..HEAD | grep -n '^#'` → 无输出；重跑 Batch 3 的验证命令。
**回滚**：`git reset --keep <backup-ref>`。

## Validation and Acceptance

| # | 验收项（issue #355） | 判定证据 |
|---|---|---|
| AC1 | 已存的研发与 Actions 挂载在 Host 启动时组合成可用 provider，Host 级测试用录制夹具、不触网 | C1：`host.disabled` 为 `[]`；wire 上研发两 key `available`；组合期 REST 请求 0 个、`DevelopmentRepository` 恰 1 个；四张身份表与种子逐字节相同；同库 `restoreProviders` 的端口 `listChangeRequests(headBranch 取自夹具)`、`listPipelineRuns` 两页、`listChecks` 都 `ok`；`misses` 为 `[]`；`globalThis.fetch` 抛错桩未被调用。C4：第二个启用 delivery 挂载 `conflict`、第一个照常 |
| AC2 | Actions provider 报告 Host 传入的权限；无权限挂载显式 `unavailable` | C1：交付两 key `degraded`。C2（`t.test` 子用例，每行一格）：无账号、账号无句柄 → Actions 不在 `disabled`，wire 两 key `unavailable` 且 `reason` 为空（区别于「没有挂载」），恢复端口的 `describeCapabilities().permission` 同为 `unavailable`，REST 请求 0；非 github.com 账号 → 研发与 Actions 都 `not_supported`、零请求；研发挂载无账号或无句柄 → `not_supported` |
| AC3 | 凭据只以 Host 句柄存在，令牌不进项目库与客户端（断言库行与 wire） | C1：数据目录（含 `-wal`、`-shm`、诊断日志）里 canary 与其 base64 出现 0 次，句柄名阳性对照 ≥ 1；两挂载的配置行恰为三个字段；wire 与 `disabled` 不含 canary；每个请求的 `authorization` 为 `bearer <canary>`、URL 与其它头不含它；凭据解析次数等于请求次数。C5：配置带 `token` 字段即写库 `RangeError`。C6：凭据 `undefined` 或空串 → reject 且 fetch 0 次 |
| AC4 | `pnpm run boundaries` 通过，插件产物仍能构建 | Batch 3 的 boundaries、`pack:plugin`、bundle 归属一行命令与安装件测试 |

C1 的请求账本另断言：origin 都是 `https://api.github.com`；`/graphql` 只用 POST 且带 `content-type`；`/repos/` 只用 GET 且带 accept 与 `x-github-api-version: 2022-11-28`；每个请求 `user-agent` 为 `harness-projects`、`redirect` 为 `error`、`signal` 是 `AbortSignal`；runs 请求的查询串含 `head_sha`。C5 的拒绝行（两个实现键各一遍）：owner `a/b`、name `..`、name `.github`、缺 `repositoryName`、多 `token`。C6 另含：路径 `.evil.example/x` 发出的 URL origin 仍是 api.github.com；provider 头里塞 `authorization` 时发出的仍是宿主 bearer。

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
| M12 丢掉 provider 静态头 / M13 宿主头先写、provider 头可覆盖 | C1 账本 / C6 |
| M14 query 不转发 | C1（`head_sha` 断言与读结果） |
| M15 `githubRepository` 对调 owner 与 name | C1（`misses` 非空） |
| M16 凭据在 `create` 期解析一次并缓存 | C1 解析次数 |
| M17 owner/name pattern 放宽为 `[^\s]+` | C5 |
| M18 删除槽位冲突分支（X2） | C4 |
| M19 manifest 删一项 provider 依赖 | `pnpm run boundaries` |
| M20 条目改用 `globalThis.fetch` | C1 抛错桩 |

回归：`tests/integration/harness-plugin-host-providers.test.js`、`harness-plugin-host-watch.test.js`、`harness-plugin-artifact.test.js` 与两个 provider 契约测试不改断言、照常全绿。

## Progress

- [x] （2026-10-21 15:05 +08）独立评审三份设计：逐条核实引用事实，合成本计划；只写了本文件，未提交。
- [ ] Batch 0 对齐 base 与规划提交。
- [ ] Batch 1 研发条目与共享出口。
- [ ] Batch 2 Actions 条目、REST 出口与权限。
- [ ] Batch 3 对抗验收、产物与并集。
- [ ] Batch 4 回填、登记与整合。

阻塞：无。#356（10-29 砍线）等待本 PR。

## Surprises & Discoveries

- S1 TD-054 写的实现键 `delivery.github-actions` 与代码不符，真实键是 `github-actions`。证据：`grep -n implementationKey packages/providers/delivery-github-actions/src/provider.ts`。按 D6 不改名，也不改 TD-054 这一行。
- S2 本分支建立时落后于 `origin/main`：#370 已合并，带来 `host-operations.ts` 与 `remote.ts` 的改动，但不动 `host-providers.ts`。回读：`gh pr view 370 -R SingularityKChen/harness-projects --json state -q .state`（期望 `MERGED`），`git diff --stat HEAD origin/main -- apps/harness-plugin/src/host-providers.ts`（期望无输出）。Batch 0 先快进。
- S3 GitHub 的 fine-grained PAT 权限表没有 Checks 一节，check-runs 文档只写 classic 令牌读私有仓库要 `repo` scope；令牌持有哪些权限没有离线可查的来源（`X-Accepted-GitHub-Permissions` 只说明端点需要什么）。来源见 D1。
- S4 `recordedPages` 对任意路径都应答，owner/name 对调的变异会在 REST 侧存活；Host 级路由必须自带三条路径的白名单（Batch 2 第一步）。
- S5 安装件测试按「存在」断言收录 provider 的前缀，文件属 #372；本 PR 用 metafile 一行命令取证，#372 合并后由后合并者补两条前缀。
- S6 `connectionState` 只有 `connected` 一个生产写者（F9），`reauth_required` 与 `disconnected` 今天不可达。

## Decision Log

- D1 Actions 的权限证据只取 Host 确知的事实：github.com 账号带宿主句柄 → 两读 key `degraded`；无账号或无句柄 → `unavailable`；不在组合期探测。Rationale：仓库已有两条成文原则——「缺 permission 视为 unavailable（权限未知不得当成可用）」（`packages/capabilities/src/capability-keys.ts`）与「不能从空数据猜权限、不用 Actions 权限替 Checks 背书」（`docs/exec-plan/completed/2026-10-07-github-actions-read.md`）；GitHub 文档显示 fine-grained PAT 的权限表没有 Checks 一节、令牌权限无离线证据（https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens 、https://docs.github.com/en/rest/checks/runs 、https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api ）；同类系统在用户显式连接或保存时测试凭据、此后按单次调用报错（Grafana 数据源的 Save & test：https://grafana.com/developers/plugin-tools/tutorials/build-a-data-source-backend-plugin ；Argo CD 添加仓库时测试连接：https://argo-cd.readthedocs.io/en/stable/user-guide/private-repositories/ ），本 PR 没有这样的时刻。`degraded` 在 Core 读门放行，demo 照常读；它与研发 provider「探针未确认即 degraded」同义，S3 竞态下两域显示一致。代价：交付读能力在快照里长期是 degraded，令牌缺权限要到单次调用才出现——登记 TD-079，下一步由 #356 绑定时或 #335 定时刷新做一次只读探测把它升级，并与 TD-062 统一两域映射。改成 `available` 只需改一个常量与 C1 的期望。日期/作者：2026-10-21 / 协调者授权的独立评审者（Claude Opus）按调研决定，人类可推翻。
- D2 Actions 挂载无可用凭据时照常组合、显式 `unavailable`；研发挂载无凭据时禁用。Rationale：AC2 要求 provider 显式报告；禁用后 wire 上与「没有挂载」不可区分（F5）；研发的探针在无凭据时必然失败，组合只会得到误导性的 degraded。日期/作者：2026-10-21 / 独立评审者。
- D3 两条目共用一份配置 schema，owner/name 采用 provider 的 PATH_SEGMENT 规则。Rationale：坏值在写库时被拒，而不是到启动才禁用；首次声明无旧行（F1）；ADR-0014 下已声明 schema 再收紧会让整库打不开（TD-055），所以首版就取最严且与 provider 一致的规则；#373 写入的值满足它（F8）。已知限制：以 `.` 开头的仓库名（如 `.github`）不支持，并入 TD-080。日期/作者：同上。
- D4 两种出口共用 `githubRequest`，URL 用 pathname 赋值构造，方法按出口固定，宿主头最后写入。Rationale：issue 要求 REST 出口沿用现有出口的超时与脱敏规则，共用比复制两份更不会漂移；pathname 赋值使 origin 结构上不可变，免去测不到的守卫分支。日期/作者：同上。
- D5 不读 `connectionState`。Rationale：唯一生产写者只写 `connected`（F9），规划条目也不读它；加条件只多一个今天不可达的分支并让条目之间不一致。出现 `reauth_required` 的写者时，三个 GitHub 条目统一处理。日期/作者：同上。
- D6 保留实现键 `github-actions`。Rationale：实现键对系统不透明；#232 的契约测试与 #373 的写入都已用它；改名没有用户价值。只在 S1 订正 TD-054 的笔误。日期/作者：同上。
- D7 保持 `redirect: 'error'`。Rationale：GitHub 建议跟随重定向（https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api ），但注入的 fetch 不一定在跨源重定向时剥掉 Authorization；与现有 GraphQL 出口一致。代价：改名或转移的仓库得 `unavailable`，登记 TD-080（与 TD-064 同根，下一步按仓库数字 id 寻址）。日期/作者：2026-10-21 / 协调者授权的独立评审者按调研决定，人类可推翻。
- D8 不引入 Octokit，不新建共享 GitHub 包。Rationale：一个 GET 包装不值得新依赖；共享包要写 ADR 并改依赖边界（TD-061、ADR-0014 Rejected）。日期/作者：2026-10-21 / 独立评审者。
- D9 接受研发 provider 的组合期探针。Rationale：探针不抛错、无凭据时零 fetch；在 Host 包一层 `describeCapabilities` 会改写 provider 语义，改 Core 并行收集越界。代价登记 TD-081：每个研发挂载组合期最坏多 30 s；`githubRequest` 的超时只覆盖 fetch，凭据服务 `resolve` 挂起时组合随之挂起；下一步在 #335 / #354 引入快照刷新时把探针移出组合关键路径，并让截止时间覆盖「解析 + fetch」。日期/作者：同上。
- D10 测试 helper 放 `tests/integration/fixtures/host-seed.js`（它的文件头声明承载 Host 测试的 GitHub 回放），不改 #372 的文件；TD-054 行的收窄、安装件测试的前缀与 `docs/README.md` 索引由协调者在相关 PR 合并后统一处理。日期/作者：同上。

## Idempotence and Recovery

- 测试每次在 `mkdtemp` 新建数据根，可任意重跑；`pnpm install --offline` 与 `pack:plugin` 可重复执行，`pack:plugin` 后必须 `rm -rf apps/harness-plugin/dist`。
- 变异脚本施加前按字节读入原文、跑完写回并逐字节比对；被中断时以 `git diff --stat` 为空确认工作树已还原。
- 并集核对只在 `mktemp -d` 的导出副本里跑，`git merge-tree --write-tree` 不改工作树与分支。
- 回到已知良好状态：未推送时 `git reset --keep <上一批提交>`；已推送时 `git revert`；Batch 4 改写前的 backup ref 是整合失败时的恢复锚点，force 推送按 `git-expert-operations` 流程用精确的 `--force-with-lease`。
- 本 PR 不迁移、不改库结构。合并前回滚无副作用；若 #373 / #356 已在用户库写入这两种实现键的配置行后再回滚，开库会因 schema 未声明整体 fail closed（ADR-0014 第 3 条、TD-055），处置是连同回滚删除这些挂载行后重新绑定（首发前不写兼容层）。

## Interfaces and Dependencies

- provider 包导出：`@harness-projects/provider-development-github` 的 `GITHUB_DEVELOPMENT_DEFINITION`、`createGithubDevelopmentProvider`；`@harness-projects/provider-delivery-github-actions` 的 `GITHUB_ACTIONS_DEFINITION`、`createGithubActionsDeliveryProvider`、`GithubActionsTransport`；`@harness-projects/capabilities` 的 `AccessLevel`、`CapabilityKey`。根 `tsconfig.json` 的 paths 与根 devDependencies 已含两包。
- 命名契约（下游 #373、#356 依赖）：实现键 `development.github`（域 development）与 `github-actions`（域 delivery）；配置恰为 `repositoryExternalId`（工作区 `repositoryId` 的本地键，不是 node id）、`repositoryOwner`、`repositoryName`；两条引用关联同一 github.com 账号；句柄 `HARNESS_PROJECTS_GITHUB_TOKEN`。
- 新导出：`githubRestTransport`（供 C6 直接判别出口规则；生产只经目录条目使用）。
- GitHub：`POST https://api.github.com/graphql`；`GET /repos/{owner}/{repo}/actions/runs`、`/commits/{sha}/check-runs`、`/commits/{sha}/check-suites`，API 版本头 `2022-11-28`。
- 工具：Node（`.nvmrc`）、pnpm 10.28.2、`gh` 命令一律带 `-R SingularityKChen/harness-projects`；变异脚本 `scripts/review-mutate.mjs`。
- 协调事项：#297 合并前同一工作区同挂 Local Git 与 GitHub 研发只得到缺口（F10），影响 #356 的 demo 路径排期而不影响本 PR；`docs/README.md` 的索引行与 TD-054 行由协调者处理。

## Outcomes & Retrospective

截至 2026-10-21 15:05 +08 只完成规划，没有实施结果。规模估算（评审合成值，Batch 3 以 `size` 命令回读实测）：实现约 +60 / −15 行（`host-providers.ts`）加 manifest 2 行；测试约 250 行（新测试文件约 190、`host-seed.js` 约 +40、边界测试 3、`harness-plugin-host-providers.test.js` 约 10）；代码合计约 325 行，低于 800。文档：本计划约 260 行，回填后预计不超过 400 行，tracker 追加 3 行；低于 1300。

## Bottom Change Note

- 2026-10-21 15:05 +08：创建。由协调者授权的独立评审者核实三份独立设计后合成：采纳设计 2 的 `degraded` 权限语义、URL 构造与失败路径表，设计 1 的变异清单与夹具路由，设计 3 的组合期请求计数与并集取证思路；否决 `connectionState` 推导、REST 路径守卫分支、改 #372 的文件与改名实现键。
