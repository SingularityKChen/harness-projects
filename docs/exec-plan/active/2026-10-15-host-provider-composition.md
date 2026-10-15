# Host Provider Composition ExecPlan

> 状态：Active
> 创建：2026-10-15
> 范围：完成 issue #132：Harness 插件 Host 自己成为组合根——打开或创建 SQLite 并迁移，按已存挂载的实现键从编译期目录构造 provider，经宿主 `credentials` 按操作解析句柄，组合 Core 与 Controller 并接入脱敏诊断出口；含 2026-10-14 从 #228 原文转入的验收 8、9（S3 记录观测）。不含 watch（#276）、定时刷新（#335）、挂载写者（#127、#131）、数据根与 actor 加固（#338）。
> 上游输入：`AGENTS.md`、`PLANS.md`、issue #132（正文与两条评论）、`docs/adr/ADR-0013-harness-host-composition.md`、`docs/exec-plan/completed/2026-10-13-harness-host-composition.md`、`docs/exec-plan/completed/2026-10-13-worktree-root-outside-checkout.md`、`docs/exec-plan/completed/2026-10-05-connector-account-storage.md`、`docs/exec-plan/completed/2026-09-29-harness-plugin-package.md`（Desktop 事实 F27–F33）、`docs/exec-plan/tech-debt-tracker.md`（TD-030、TD-031）。
> 执行上下文：分支 `feature/host-provider-composition`，工作树 `.worktrees/host-provider-composition`；base `origin/main`（设计时观察到 `21cb29eb`，以 `git rev-parse origin/main` 回读为准）。除特别注明外，命令都在该工作树根目录运行；`gh` 一律带 `-R "$REPO"`，`REPO` 取 `gh repo view --json nameWithOwner -q .nameWithOwner` 的输出。

## Purpose / Big Picture

完成后，Desktop 加载插件不再等待不存在的 `harnessProjectsProviders` 服务：Host 的 `inject` 只要 `typert` 与 `credentials`。Host 在数据根下打开或创建 `harness-projects/workspace.sqlite` 并迁移，读出已存的工作区、挂载、连接账号与配置，按每个挂载的 `implementationKey` 从 `apps/harness-plugin/src/host-providers.ts` 的封闭目录（catalog）构造 provider——本 PR 收 `planning.github-projects`（附宿主 GraphQL transport）与 `development.local-git`（附宿主注入的检出外允许根）——再组合 Core 与 Controller、注册 typed remote。

可观察结果：空数据根迁移 1–7、零工作区、命令返回结构化 `not_supported`；同一文件重启（同进程或新进程）后工作区、挂载、身份、执行上下文与谱系关系逐字节不变；未知实现键、缺配置或账号不合格的挂载只禁用它自己，其余照常；凭据只以句柄存在、每次 provider 操作才解析，不进库、日志与 wire；同步异常经允许名单结构化后写进宿主自有的诊断日志，命令的非结构化拒绝在 wire 上只剩固定文案。

最小成功证据：`tests/integration/harness-plugin-host-providers.test.js` 覆盖验收 1–7 全绿；`pnpm run boundaries` 与 `pnpm verify` 全绿；安装件测试在干净数据根上得到迁移 1–7、零工作区；Batch 7 在真实 Desktop 上记录验收 8、9，附宿主版本与 tarball sha256。

## Context and Orientation

| 术语 | 含义 |
|---|---|
| Host 入口 | `tests/contract/package-boundaries.test.js` 的 `HOST_ENTRY.files`：只有它们可依赖 core、controller、storage（ADR-0013 的受控例外），且从 client 入口经相对 import 不可达 |
| 目录（catalog） | `ReadonlyMap<implementationKey, CatalogEntry>`：实现键 → 配置 schema + 构造函数；编译期封闭，不接受运行期注册 |
| 连接锚点 / 挂载 | `provider_binding`（跨工作区连接，带 `implementation_key`）/ `workspace_binding`（工作区挂载，带 domain、enabled、is_default、configuration_json），见 ADR-0006 |
| 句柄 | `connector_account.secret_handle`：POSIX 名称且在受信 allowlist 内；宿主 `credentials.resolve(句柄)` 返回 `{ value, source }` |
| S1 / S2 / S3 | 文档或源码静态依据 / 本地可重复的自动化测试 / 真实宿主内的记录观测 |

当前事实（设计时在 base `21cb29eb` 上读码核实，行号以该提交为准）：

- F1：`apps/harness-plugin/src/host.ts:9` 的 `inject` 含 `harnessProjectsProviders`，`:30-48` 的 `providerTableOf` 缺服务即抛错，`:17` 固定 `WORKSPACE_ID`，`:73` 再导出 `createHostComposition` 而仓库内无消费者。Cordis 在被 inject 的服务出现前不加载插件函数体；Desktop 0.2.0-rc.2 不提供该服务，所以 #329 的 S3 得到 404（`docs/exec-plan/completed/2026-10-13-harness-host-composition.md` Progress 2026-10-14 两条）。
- F2：`apps/harness-plugin/src/host-composition.ts:46` 以空策略打开 SQLite，`:47` 把调用方传入的 `workspace` 与 `providers` 原样交给 `composeCore`。
- F3：`packages/core/src/context.ts:134` 起的 `createContext` 每次组合都在一个事务里 `putWorkspace` 与 `putProviderBinding`；`:156` 无 storage 时返回 `unavailableCore('没有可用的 storage 绑定')`；`:189` 的 `unavailableCore` 未导出。空数据根若照旧带 storage 调 `composeCore` 会写出一个工作区，与验收 1 冲突。
- F4：`packages/core/src/registry.ts:84` 让 development 只在恰好一个挂载时 `isDefault=true`；`:146` 一律写 `enabled: true`。
- F5：`packages/storage/sqlite/src/storage-sync.ts:153-158` 的 `#assertStoredMetadata` 打开时用当前策略重放全部已存配置，`packages/capabilities/src/connector-account.ts:150` 对未声明实现键抛 `RangeError`；`packages/providers/fake/src/storage.ts:95-99` 的导入路径同形。
- F6：`packages/providers/planning-github-projects/src/provider.ts:48` 的工厂要求宿主注入 `GraphqlTransport`，`:96-97` 的 `describeCapabilities` 调 `getProject`，组合期即触网；仓库内没有生产 transport。
- F7：`packages/providers/development-local-git/src/provider.ts:100` 缺省时随机生成 binding id；`:68-89` 的默认根对嵌套、bare、缺席仓库 fail closed 并点名「宿主注入入口见 #132」。#214 的 Decision Log（2026-10-14「嵌套判定按 Git 口径收紧」）裁定产品路径是宿主注入显式 `allowedRoot`，默认推导只是无宿主时的后备。
- F8：`tests/contract/package-boundaries.test.js:105-110` 的 `HOST_ENTRY` 只放行 `host.ts`、`host-composition.ts` 依赖 core、controller、storage/sqlite。`docs/review/README.md` §6 要求改依赖边矩阵的 PR 单独提交；#329 就同一文件取得过人类批准的例外。
- F9：`apps/harness-plugin/src/client.ts:15-21` 只调用 `baseline`，生产 client 不发任何命令。
- F10：Desktop 只转出宿主子进程的 stdout，stderr 只在内存保留最后 64 KiB（`docs/exec-plan/completed/2026-09-29-harness-plugin-package.md` F29）：插件宿主半边的 `console.error` 在 Desktop 里不可见，stdout 只在 `open -a … --stdout <文件>` 启动时落文件。
- F11：TD-030、TD-031 写给 #132 两件事：把 `CoreDeps.diagnostics.syncRoundFailed` 接到宿主诊断日志并承担脱敏；把命令的非结构化拒绝映射成固定文案并补一条经 `createController` 的用例。
- F12：`tests/contract/fixtures/github-projects/replay.js` 可离线回放沙箱 Project A（node id 即沙箱定义 `docs/architecture/gate-e1-sandbox.md` §2.1 的 `E1_PROJECT_A_ID`；本计划只写变量名、不写字面值，见 `Surprises & Discoveries`）。
- F13：`tests/integration/local-git-fixture.js` 提供 `makeFixture`（临时真实仓库）与 `registerWorkItem`（登记可开始的工作项）；没有执行挂载时 Start Work 仍产出 Ready 上下文（`tests/integration/local-git-start-work-resume.test.js` R1）。
- F14：既有 Host 测试对描述符的唯一下标假设是 `tests/integration/harness-plugin-host-runtime-adapter.test.js:56` 的 `HOST_REMOTE.invocations[0]`（即 `baseline`）；描述符个数与方法名单只在 `tests/contract/harness-host-remote-adapter.test.js` 断言，该文件不在本 PR 文件集合内。
- F15：`apps/harness-plugin/src/host.ts:63-65` 的卸载 effect 为 `try { await installedRemote.dispose() } finally { composition.dispose() }`；runtime-adapter 第一条用例的「在途调用结束前不得关闭 SQLite」断言钉住它。
- F16：provider-fake 导出 `FAKE_PROVIDER_DEFINITION`（实现键 `harness.fake`，四个域）与 `createFakePlanningProvider({ bindingId })`（`packages/providers/fake/src/definition.ts`、`planning.ts:160`）；`tests/integration/fixtures/` 目录在 base 上不存在。

设计期原型都不提交，放在被忽略的 `.superpowers/design/A/` 下，结论见 `Surprises & Discoveries`。

## Design / Spec

**文件与职责**

- 新增 `apps/harness-plugin/src/host-providers.ts`（Host 入口，唯一 import provider 包的文件）：条目类型、宿主句柄 allowlist 常量 `HOST_SECRET_HANDLES = ['HARNESS_PROJECTS_GITHUB_TOKEN']`、两个生产条目与 `PROVIDER_CATALOG = catalogOf([GITHUB_PROJECTS_ENTRY, LOCAL_GIT_ENTRY])`、GitHub GraphQL transport、`hostStoragePolicy(catalog)`、`restoreProviders(...)`。
- 新增 `apps/harness-plugin/src/host-diagnostics.ts`（只依赖 Node 内置模块，不是 Host 入口）：`describeError(error)` 允许名单投影；`createDiagnosticLog(file)` 向文件追加 JSON 行，写失败吞掉。
- 改 `apps/harness-plugin/src/host-composition.ts`：选项改为 `dataPath`、`workspaceId`、`catalog`、`resolveCredential`、`migrationsDir?`、`fetch?`；以 `hostStoragePolicy(catalog)` 打开存储；读不到工作区用 `unavailableCore('工作区尚未创建')`，读到则 `restoreProviders` 后把已存工作区记录原样交给 `composeCore` 并带 `diagnostics.syncRoundFailed`；Controller 拒绝只经组合内的命名闭包 `guarded(run)` 映射为模块常量 `OPERATION_FAILED` 的固定文案，不内联进 `call`（D6）；`HostComposition` 保留 `controller`、`call`、`dispose`，只新增只读 `disabled`。
- 改 `apps/harness-plugin/src/host.ts`：`inject = ['typert', 'credentials']`；删除 `HostProviderFactory`、`providerTableOf` 与无消费者的再导出；凭据适配器在创建存储前 fail closed；把 `PROVIDER_CATALOG` 与固定 `WORKSPACE_ID` 交给组合。
- 新增 `tests/integration/fixtures/host-seed.js`（非测试模块，`node --test` 不执行）：`seed`、`dump`、`fakePlanningEntry` 三个测试辅助，本 PR 的测试 import，栈上层只读 import（D20）。
- 其余：`packages/core/src/context.ts:189` 改为 `export function unavailableCore`（一行）；SQLite 与 Fake 两个存储适配器的打开期校验各一行；ADR-0014（Proposed）与 ADR-0013 第 5 条、Consequences 首条的 Superseded in part 标注（D22）；边界测试与 manifest 放行新依赖。

**接口**（实现须与此一致。Batch 4 提交后 `HostCompositionOptions`、`HostComposition` 的成员与 `guarded` 的名字和语义冻结，因为 #276 的栈上层从该提交起 rebase 到本分支；Batch 8a 的重构不得改它们，其余名字可统一改，改了同步本节）

- `ProviderBuildInput`：`binding: ProviderBindingRecord`；`configuration: Readonly<Record<string, string | boolean>>`（未存配置时为 `{}`）；`account: ConnectorAccountRecord | undefined`；`credential: () => Promise<string | undefined>`（只绑定该账号的句柄，无账号或无句柄时 resolve `undefined`，每次调用都重新解析、不缓存）；`worktreesDir: string`；`fetch: (url: string, init: RequestInit) => Promise<Response>`。
- `CatalogEntry { definition: ProviderDefinition; configuration: BindingConfigurationSchema; create(input: ProviderBuildInput): Promise<object> }`；`type ProviderCatalog = ReadonlyMap<string, CatalogEntry>`，由 `catalogOf(entries)` 以 `entry.definition.implementationKey` 为键构造，键与定义因此不可能不一致。
- `class BindingRefused extends Error { code: ProjectErrorCode }`：条目拒绝构造时抛它；`DisabledBinding { bindingId; domain; implementationKey; error: ProjectError }`。
- `hostStoragePolicy(catalog): StorageValidationPolicy`：句柄取 `HOST_SECRET_HANDLES`（与目录无关，不随目录收缩），配置取目录各条目的 schema。
- `restoreProviders(storage, workspaceId, catalog, env: { resolveCredential, worktreesDir, fetch }): Promise<{ table: CoreProviderTable; disabled: readonly DisabledBinding[] }>`。
- `HostCompositionOptions { dataPath; workspaceId; catalog; resolveCredential: (handle: string) => Promise<string | undefined>; migrationsDir?; fetch? }`，`fetch` 缺省为调用时才读取的 `globalThis.fetch`（测试可替换）；`HostComposition { controller; disabled; call(name, input); dispose() }`。
- `const OPERATION_FAILED = 'harness-projects：操作失败，原因已写入宿主诊断日志'`（`host-composition.ts` 模块常量）；`guarded<T>(run: () => Promise<T>): Promise<T>` 是 `createHostComposition` 内的命名闭包：`run()` 的任何拒绝先 `log.write('operationFailed', describeError(e))`，再抛 `new Error(OPERATION_FAILED)`。它是 Controller 失败上 wire 的唯一出口（D6）。
- `describeError(error) → { name, code?, errcode?, frames }`；`createDiagnosticLog(file) → { write(event: string, fields: Record<string, unknown>): void }`。
- `tests/integration/fixtures/host-seed.js`：`seed(dataPath, catalog, build)` 以 `createSqliteStorage(dataPath, hostStoragePolicy(catalog))` 打开、`await build(storage)` 后关闭；`dump(dataPath)` 只读打开，按 `sqlite_master` 遍历全部表、每表 `JSON.stringify(SELECT *)`；`fakePlanningEntry(onCreate)` 返回 `harness.fake` 目录条目（`definition` 为 provider-fake 导出的 `FAKE_PROVIDER_DEFINITION`，`configuration` 为 `{}`），`create` 构造 `createFakePlanningProvider({ bindingId: binding.id })` 交给 `onCreate`，回调返回值不是 `undefined` 时替换交给 Core 的实例。

**启动数据流（`createHostComposition`）**

1. `mkdir` 数据目录；`dataDir = dirname(dataPath)`，`worktreesDir = join(realpath(dataDir), 'worktrees')`，诊断日志为 `join(dataDir, 'diagnostics.log')`。
2. `createSqliteStorage(dataPath, hostStoragePolicy(catalog), { migrationsDir })`，迁移在此执行。
3. `getWorkspace(workspaceId)` 为 `undefined` 时 `core = unavailableCore('工作区尚未创建')`，不向 Core 传 storage、不写任何行，`disabled = []`；否则 `restoreProviders`，每个禁用项写一行 `bindingDisabled`，再 `composeCore({ workspace: { id, name, statusPolicy }（取自已存记录）, providers: table, storage, diagnostics: { syncRoundFailed: (e) => log.write('syncRoundFailed', describeError(e)) } })`。
4. `createController(core, { workspaceRevision: () => storage.currentRevision(workspaceId) })`；工作区不存在时读回 0。
5. `call` 先查 `closed`（`host 已关闭`），处理器再做输入校验（既有固定中文文案，原样抛出），最后经 `guarded(() => controller…)` 调用 Controller；`closed` 与输入校验留在漏斗之外。
6. 任一步失败都关闭存储一次后重抛，不发布任何东西（与 #329 同语义）。

**`restoreProviders` 规则**（逐条处理 `storage.listProviderBindings(workspaceId)`）：`enabled === false` 跳过（用户意图，不计入 `disabled`）；目录无该实现键记 `not_supported`；条目 `definition.domains` 不含该挂载的域记 `invalid_input`；读配置（`getBindingConfiguration`，缺省 `{}`）与账号（`getProviderBindingAccount` → `getConnectorAccount`），`await entry.create(...)`，抛 `BindingRefused` 时取其 code 与文案，抛其它异常记 `unavailable`、固定文案「实现构造失败」不带原文；槽位规则为 `development` 追加进数组、`execution` 且 `isDefault === false` 进 `executionFallback`、其余进同名槽位，槽位已占记 `conflict`。永远把存储里的 `binding.id` 交给 provider，启动时不生成任何 id。被禁用的挂载不写库，只出现在 `disabled` 与诊断日志里，实现回来后以原身份复活。

**两个生产条目**

- `planning.github-projects`：schema `projectNodeId`（string、必填、pattern `PVT_[A-Za-z0-9_-]+`、maxLength 100）；账号必须 `platformOrigin === 'https://github.com'` 且 `secretHandle !== undefined`，否则 `BindingRefused(not_supported, '规划挂载需要 github.com 上带凭据句柄的连接账号')`；构造 `createGithubProjectsPlanningProvider({ bindingId: binding.id, projectNodeId, transport: githubGraphqlTransport(fetch, credential) })`。transport 每次请求先 `await credential()`（空值即 reject，provider 自行归类为 `unavailable`、不带原文），再 `fetch('https://api.github.com/graphql', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { authorization: 'bearer <值>', 'content-type': 'application/json', 'user-agent': 'harness-projects' }, body: JSON.stringify({ operationName, query, variables }) })`，返回 `{ status, headers: Object.fromEntries(response.headers), body }`（JSON 解析失败时 `body` 为 `undefined`）。
- `development.local-git`：schema `repositoryPath`（string、必填、pattern `/[^\n\r]*`、maxLength 1024）与 `repositoryExternalId`（string、必填、pattern `[^\s]+`、maxLength 200），两字段经同一小函数 `text(configuration, name)` 读取，不是非空字符串即 `BindingRefused(invalid_input, '挂载配置缺少 <name>')`；`allowedRoot = join(worktreesDir, sha256(binding.id) 前 16 个十六进制字符)`；`realpath(repositoryPath)` 失败时退回 `path.resolve`，`allowedRoot` 落在其内（相对路径为空、或不以 `..` 分量开头且不是绝对路径）时 `BindingRefused(invalid_input, '工作树允许根落在仓库检出之内')`；构造 `createLocalGitDevelopmentProvider({ bindingId: binding.id, repository: { externalId, path: repositoryPath }, allowedRoot })`。

**诊断记录（允许名单）**：每行一个 JSON `{ at, event, ... }`，`at` 为 ISO 时间。`syncRoundFailed`、`operationFailed` 附 `describeError` 结果；`bindingDisabled` 附 `bindingId`、`domain`、`implementationKey`、`code`。`describeError` 只输出：`name`（Error 实例的 `name` 须匹配 `^[A-Za-z][A-Za-z0-9]{0,40}$`，否则 `Error`；非 Error 值为 `NonError`）、`code`（须匹配 `^[A-Za-z][A-Za-z0-9_]{0,63}$`，否则省略）、`errcode`（安全整数，否则省略）、`frames`（`stack` 里 `    at ` 开头的前 5 行，改写成 `函数@文件名:行`：函数名须匹配 `^[\w$.<>\[\] ]{1,80}$` 否则 `?`；文件名取 `path.basename` 并去掉 `file://`，须匹配 `^[\w.-]{1,80}$` 否则 `?`）。永远不写 `message`、`stack` 首行、`path`、`cause` 与其它属性。日志写宿主自有文件、不走 `console.error`，因为 Desktop 吞掉宿主 stderr（F10）。

**存储打开期校验的收窄**：SQLite 的 `#assertStoredMetadata` 与 Fake 的导入循环只重放策略已声明实现键的配置，未声明键的行跳过；读口 `getBindingConfiguration` 与写口仍按真实锚点的实现键校验，未声明键照旧 `RangeError`；已声明键的坏配置与不在 allowlist 的句柄仍在打开时整库拒绝。效果：没有未校验的值能离开存储，带配置的未知实现键也不再让整个 Host 起不来（验收 3）。

**不变量**

- I1 身份只来自存储：provider 的 binding id 与 Core 的工作区记录都取自库，重启不生成新 id。
- I2 运行期失效不写库：被禁用的挂载行逐字节不变（development 派生默认角色的例外见 TD-053）。
- I3 宿主级失败（迁移、句柄 allowlist、已声明键的坏配置、`composeCore` 抛错、remote 注册失败）整体关闭；挂载级失败局部隔离。
- I4 凭据值只存在于一次 provider 操作内：不进库、日志、wire，诊断记录里也没有能携带它的字段。
- I5 工作树允许根是数据根与 binding id 的纯函数，永远在 `repositoryPath` 之外。
- I6 Host 是唯一状态拥有者（不变量 7）：SQLite 是事实源，内存只有 provider 实例与 `disabled`，挂载的写者是 #127。
- I7 卸载顺序：`apply` 用 `ctx.effect` 登记的卸载先 `await remote.dispose()`（撤回 typed remote 并等在途调用排空），再 `composition.dispose()`（关闭 SQLite）；两者不得交换（F15、M18）。ADR-0013 Consequences 留给 #276 的跨代 watch drain 建立在这个顺序上。

**设计取舍汇总**（理由与来源见 `Decision Log`）：以设计者 A1（最小纵向切片）为骨架；从 A2 吸收「存储打开期跳过未声明键、读口仍拒绝」「句柄 allowlist 是不随目录收缩的宿主常量」「导出 `unavailableCore` 给准确原因」「子进程重启夹具」「变异先证明已施加」；从 A3 吸收「允许名单诊断、不记 message」「`credential` 只绑定该账号句柄」「transport `redirect: 'error'`」「保持 `HostComposition` 现有字段」。否决 A3 的 `listWorkspaces`、多工作区 `route()`、core `inertProvider`，A2 的独立 `host-restore.ts` 与五类 fault 分型，A1 的模式擦除式脱敏与 console 输出。

**范围外**：目录里的 `delivery.github-actions`、`development.github`、执行条目（TD-054）；绑定变更后重组、工作区列表与创建（#127、#131，TD-055）；定时刷新（#335）；watch（#276）；失败三分（#278）；数据根按 profile 区分与 actor 推导（#338）；生产 client 发命令（#229 的页面范围）。

## Global Constraints

- 文件集合只在此声明（其它章节写「见 `Global Constraints`」）。新增：`apps/harness-plugin/src/host-providers.ts`、`apps/harness-plugin/src/host-diagnostics.ts`、`tests/integration/harness-plugin-host-providers.test.js`、`tests/integration/fixtures/host-seed.js`、`tests/integration/fixtures/host-restart-child.mjs`、`docs/adr/ADR-0014-host-composes-providers-by-implementation-key.md`、本计划。修改：`apps/harness-plugin/src/host.ts`、`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/index.ts`（只改文件头 Allowed imports 说明）、`apps/harness-plugin/package.json`、`pnpm-lock.yaml`、`packages/core/src/context.ts`（一行）、`packages/storage/sqlite/src/storage-sync.ts`、`packages/providers/fake/src/storage.ts`、`tests/contract/suites/storage-connector-account.js`、`tests/contract/package-boundaries.test.js`、`tests/integration/harness-plugin-host-runtime-adapter.test.js`、`tests/integration/harness-plugin-host-roundtrip.test.js`、`tests/integration/harness-plugin-artifact.test.js`、`tests/integration/README.md`、`docs/adr/ADR-0013-harness-host-composition.md`（只追加标注）、`docs/adr/README.md`、`docs/README.md`、`docs/exec-plan/tech-debt-tracker.md`。不得改：`apps/harness-plugin/src/remote.ts`、`client.ts`、`host-surface.ts`、`packages/client/**`、`packages/controller/**`（#276 的单元；S3 探针对 `client.ts` 的一行改动永不提交，见 Batch 7）；`packages/providers/development-github/**`、`tests/contract/suites/development.js`、`tests/contract/fixtures/github-development/**`、`docs/product/vertical-path.md`（#231 的单元）；#280 的会话观测记录、夹具与契约测试（该 PR 将新建）。
- 栈：本 PR 是栈底，#276（B）以原生 stacked PR 叠在本分支上，栈深 2（H2 被否决时 A0 → 本 PR → #276，栈深 3，见 D11）。本计划与本 PR 写入的仓库文档只陈述本 PR 自己的事实，不把 #276 的文件、成员或验收当作已存在来引用。本 PR 每次改写历史的推送（整合、合并前 rebase）之后，由协调者先给 #276 建 backup ref 再 restack，`git diff <B 旧 head> <B 新 head> -- <B 的路径>` 须为空。
- 共享文件协议（一个单元一个 owner；双方都不删、不改名对方的成员；全文见 D19）：本 PR 独占 `host.ts`、`host-composition.ts` 的结构（选项、组合主体、`call`、`disabled`、`guarded`）、`packages/core/src/context.ts`、两个存储适配器、`tests/contract/suites/storage-connector-account.js`、`tests/contract/package-boundaries.test.js`、`apps/harness-plugin/package.json`、`pnpm-lock.yaml`、`apps/harness-plugin/src/index.ts`、`docs/adr/*`、债务表 TD-030 与 TD-031 两行的单元格、runtime-adapter 与 roundtrip 两个 Host 测试，以及安装件测试的 a–d 与 f 节（e 节归 #276）。改写后的 Host 测试不断言描述符个数或服务键集合，唯一允许的下标假设是 `HOST_REMOTE.invocations[0]` 为 `baseline`（F14）。
- 共享文档：`docs/README.md` 的 Active 行插在表头分隔行 `|---|---|---|` 正下方，不追加到表尾；冲突时后合并者保留全部行，2026-10-15 的几行按计划文件名排序。债务表 TD-053..056 手工插在编号位置（不跑跟踪脚本）。`tests/integration/README.md` 的「Host 组合（#132）」小节放在 `## 约定` 之前。
- 体量（`node scripts/rule-checks.mjs size origin/main`，增删之和）：代码 ≤ 800、文档 ≤ 1300（CI 硬上限 1000 / 1500）。2026-10-15 10:40 +08 的设计估算（不是回读值，跨 PR 集成评审后重估）：实现约 290（`host-providers.ts` 约 140：类型、目录、transport、两个条目、带槽位规则的恢复；`host-composition.ts` 增删约 55；`host.ts` 增删约 45，其中删除工厂与 `providerTableOf` 约 25 行；其余约 50：`host-diagnostics.ts` 约 30、边界、manifest、index 头注释、core 与两个存储适配器各一行）；测试约 410（新测试文件约 215、`host-seed.js` 约 30、子进程夹具约 18、三个既有 Host 测试改写约 95、契约约 5、Batch 6 补强约 45）；代码合计约 700；文档约 670（本计划约 435、ADR-0014 约 45、ADR-0013 两处标注与 ADR 索引约 6、`docs/README.md` 1、债务表约 8、集成 README 约 20、Batch 8b 回填约 155）。单层、不切层；实测代码超过 760 时先砍两刀：(i) `describeError` 只输出 `name`、`code`、`errcode`，不输出 `frames`（验收 7 的 frames 断言与 M15 随之删除）；(ii) 删去 runtime-adapter 中已被 AC2 AC4 蕴含的断言（库里工作区与实体行、数据目录 canary 扫描、`encode` 不含 canary），保留只在入口才能判别的按操作换 canary（M17）、卸载先排空再关闭（M18）、关闭一次、服务撤回与保留调用拒绝。然后复核死代码，仍超过 800 再按 D11 的切分点拆层。
- 边界：只有 `HOST_ENTRY.files` 的三个 Host 入口文件可依赖 core、controller、storage/sqlite、capabilities、`provider-planning-github-projects`、`provider-development-local-git`；`provider-fake` 不得进入 `apps/harness-plugin` 的 manifest 或源码；client 入口经相对 import 不得到达 Host 入口文件。
- 凭据与发布面：只存句柄；凭据值、带令牌的 URL、本机绝对路径与账号名不进库、日志、夹具与任何文档。agent 不读本机凭据存储、令牌文件或 Desktop 打到 stdout 的带令牌 URL。
- MMP 前不做兼容与迁移：不改迁移文件，不写兼容层或开关；存储打开期的收窄不保护任何真实数据。
- 人类专属：ADR-0014 只写 Proposed；不写 Project `Status`、`blocked-by` / `blocking`；不改 issue 验收范围；不合并；`docs/review/README.md` §6 的例外需人类批准（人类门 H2）。
- 工程纪律：每批先写会失败的判别性测试再实现；不 `git config`，身份用 `git -c user.name=… -c user.email=…` 单次传入；新工作树先 `pnpm install --frozen-lockfile --offline`，改 manifest 后用 `pnpm install --offline` 更新锁文件；pnpm 用仓库 pin 的 10.28.2；Node 26 直接加载 `.ts`；`node --test <目录>` 只执行 `*.test.js`，`tests/integration/fixtures/*.mjs` 不会被当作用例（2026-10-15 在 Node v26.11.1 上实测）。
- PR 字段：标题 `feat(apps): compose the host from stored provider bindings`；标签 `kind:feat`、`area:apps`（标题 area）、`area:core` 与 `area:controller`（与 issue 一致）、`area:storage`；里程碑 `M4 · MVP Demo：Harness 内打通 GitHub 链路`（与 issue 相同）；PR 正文用关闭关键字关联 #132 并以 `closingIssuesReferences` 回读，另 `Refs #28`（满足其验收 1）、`Refs #228`、`Refs #214`、`Refs #126`，并写明本 PR 是栈底、下一层是 #276 的 PR；提交只写 `Refs #132`，不写关闭关键字；Project 字段 `ExecPlan` 填本计划路径、`Batch` 填当前批次短名、`Kind` 与 `Area` 随标签。

## Plan of Work

| 批次 | 最小闭环 | 承担者 | 关闭的验收 |
|---|---|---|---|
| Batch 0 · 计划落库与草稿 PR | 计划与索引入库，draft PR 关联 #132 并回读 | 协调者 | — |
| Batch 1 · ADR-0014 与 Host 入口边界 | 决策写成 Proposed，边界与 manifest 放行新依赖 | 实现者（Sonnet） | E1 |
| Batch 2 · 存储打开期只校验已声明实现键 | 两个适配器同形，契约断言先红后绿 | 实现者（Sonnet） | 验收 3 的前置 |
| Batch 3 · 按实现键恢复并切换 Host 入口 | 目录、恢复、组合、入口切换，既有 Host 测试改写 | 实现者（Sonnet） | 1、2、3、4，9 的 S2 |
| Batch 4 · 诊断出口与命令拒绝映射 | 允许名单诊断日志与固定文案 | 实现者（Sonnet） | 7 |
| Batch 5 · 新进程重启与检出外允许根 | 子进程重启与 Local Git 注入根 | 实现者（Sonnet） | 5、6 |
| Batch 6 · 对抗验证 | 变异整表全部 KILLED | 实现者（Sonnet）+ 独立复核 | E3 |
| Batch 8a · 独立验收、重构与树冻结 | 对抗验收、重构、变异整表重跑、五方并集验证，以树冻结与 lib 两个 sha256 结束 | 验收者（Opus） | E2、E3 复核 |
| Batch 7 · 真实 Desktop 观测（S3） | 在冻结树的构建上，作为协调者合并宿主窗口 S-AB 的 Phase 1 与 1b 执行 | 协调者（主会话）+ 人类伙伴 | 8、9 的 S3 |
| Batch 8b · 回填、整合与 ready | 文档与债务回填、整合提交、推送、ready、合并前核对 | 验收者（Opus）+ 协调者 | E4、E5 |

执行顺序为表中自上而下：Batch 7 夹在 8a 与 8b 之间，使 S3 观测的就是最终树（D18）。

## Concrete Steps

### Batch 0 · 计划落库与草稿 PR

**最小闭环**：本计划与 `docs/README.md` Active 索引行入库，draft PR 与 #132 双向关联。**涉及文件**：本计划、`docs/README.md`。

- [ ] `docs/README.md` 的 Active 计划表在表头分隔行 `|---|---|---|` 正下方插入一行（共享文档协议，不追加到表尾）：链接 `exec-plan/active/2026-10-15-host-provider-composition.md`，说明「#132：Host 按实现键从已存挂载组合 provider，含 #228 转入的 S3 验收」，状态 Active。
- [ ] 提交 `docs(exec-plan): 编写宿主按实现键组合计划`（正文以 `Refs #132` 结尾）并推送；开 draft PR，标题、标签、里程碑见 `Global Constraints`，正文写闭环、ExecPlan 路径 + 当前 Batch、关联、栈位置（本 PR 是栈底，下一层是 #276 的 PR）、验证证据（随批次回填）、风险与回滚、人类门 H1–H6。
- [ ] 回读 `gh pr view <n> -R "$REPO" --json isDraft,baseRefName,labels,milestone,closingIssuesReferences`（期望 draft、base `main`、含 #132）与 `gh issue view 132 -R "$REPO" --json closedByPullRequestsReferences`（期望含本 PR；刚开时可能为空，改正文后再回读）。

**验证**：`node scripts/rule-checks.mjs disclosure origin/main`（期望机械扫描无命中）；`node --test tests/contract/e1-evidence-consistency.test.js tests/contract/plan-facts-consistency.test.js`（期望全部通过：计划里不得出现沙箱登记的 id 字面量）；`git diff --check origin/main...HEAD`（期望无输出）。**回滚**：关闭 draft PR，`git revert` 该提交。

### Batch 1 · ADR-0014 与 Host 入口边界

**最小闭环**：边界规则变更单独成提交，H2 被否决时可机械拆成栈底 PR。**涉及文件**：`docs/adr/ADR-0014-host-composes-providers-by-implementation-key.md`、`docs/adr/ADR-0013-harness-host-composition.md`、`docs/adr/README.md`、`tests/contract/package-boundaries.test.js`、`apps/harness-plugin/package.json`、`pnpm-lock.yaml`、`apps/harness-plugin/src/index.ts`。

- [ ] 写 ADR-0014（状态 Proposed、日期 2026-10-15、来源本计划）。Decision：(1) `host.ts`、`host-composition.ts`、`host-providers.ts` 是插件 Host 唯一组合根，provider 由编译期封闭目录按 `implementationKey` 构造，`inject` 只要 `typert` 与 `credentials`；(2) 事实源是 SQLite 的工作区、挂载、连接账号与配置，Host 不生成 binding id，凭据值每次 provider 操作才经宿主 `credentials` 解析；(3) 挂载级失败只禁用该挂载且不写库，宿主级失败整体 fail closed；(4) `HOST_ENTRY` 增加 `host-providers.ts`，放行 capabilities 与目录收录的 provider 包，fake 不放行；(5) 只取代 ADR-0013 中要求注入 `harnessProjectsProviders` 工厂的表述（第 5 条一句、Consequences 首条一句），ADR-0013 其余内容不变（D22）。Why：Desktop 不提供该服务，Cordis inject 永不满足，且同装插件能 `provide` 同名服务冒充 provider；组合根应贴近入口。Rejected：运行期注入服务、新建 `packages/host`、在 core 定义目录契约、惰性挂载。Consequences：新增实现须同时加目录条目、`HOST_ENTRY.allow` 与 manifest 依赖；第二个壳（apps/web，#135）出现时再抽公共包；采纳权在人类伙伴。
- [ ] ADR-0013 两处行尾追加标注、原文保留（D22）。第 5 条：「**Superseded in part by ADR-0014（2026-10-15）**：只有『Host 入口要求注入 `harnessProjectsProviders` 工厂』这一句不再成立；`credentials` 仍必需、缺失仍 fail closed；本条其余内容，包括 watch / reconnect 由 #276 承担，仍然有效。」Consequences 首条：「**Superseded in part by ADR-0014（2026-10-15）**：只有『测试通过注入 fake factory 验证 … 缺失工厂时 Host fail closed』这一句不再成立；Host 安装件不携带 fake provider 仍成立；下文『`dispose` 先撤回 remote contribution，再关闭 composition』与『跨代 watch drain 留给 #276』仍然有效。」；`docs/adr/README.md` 索引加 ADR-0014 一行（Proposed），「上表十三条」改为「十四条」并补 ADR-0014 来源一句。
- [ ] 先红：新建只含 import 的 `apps/harness-plugin/src/host-providers.ts` 骨架（import `@harness-projects/capabilities`、`@harness-projects/provider-planning-github-projects`、`@harness-projects/provider-development-local-git`），`pnpm run boundaries` 期望失败且信息含「依赖了 packages/capabilities」或 provider 包。
- [ ] 再绿：`HOST_ENTRY.files` 追加 `apps/harness-plugin/src/host-providers.ts`，`HOST_ENTRY.allow` 追加 `packages/capabilities`、`packages/providers/planning-github-projects`、`packages/providers/development-local-git`，同步文件头注释；`apps/harness-plugin/package.json` 的 `dependencies` 加三个包（`workspace:*`）并 `pnpm install --offline` 更新锁文件；`apps/harness-plugin/src/index.ts` 的 Allowed imports 补新文件与 ADR-0014。
- [ ] 提交两个：`docs(adr): 提出 Host 按实现键组合 provider 的决策`（三个 ADR 文件）与 `test(contract): 放行 Host 入口依赖目录收录的 provider 包`（其余文件）。

**验证**：`pnpm install --frozen-lockfile --offline && pnpm run boundaries && pnpm run typecheck`（期望三者 exit 0）。**回滚**：反向两个提交，锁文件随之恢复。

### Batch 2 · 存储打开期只校验已声明实现键

**最小闭环**：带配置的未声明实现键不再让库打不开；读口照旧拒绝；已声明键的坏配置仍在打开时拒绝。**涉及文件**：`tests/contract/suites/storage-connector-account.js`、`packages/storage/sqlite/src/storage-sync.ts`、`packages/providers/fake/src/storage.ts`。

- [ ] 先红：在共享用例 `configuration-is-workspace-scoped` 末尾、`tamper(storage)` 那条断言之后追加三条断言（不新增用例，套件条数守卫保持 6）：`assert.throws(() => restart(storage, policy()), RangeError, '已声明实现键的坏配置：重开仍整库拒绝')`；`const narrowed = restart(storage, { allowedSecretHandles: new Set(), configurations: new Map() })`；`await assert.rejects(async () => narrowed.getBindingConfiguration(a), RangeError, '未声明实现键的配置：重开不阻断，读口仍拒绝')`。期望第二条在两个适配器上都以 `RangeError: binding configuration is not declared for this implementation key` 失败。
- [ ] 再绿：SQLite `#assertStoredMetadata` 的配置循环先判 `this.policy.configurations.has(row.implementation_key)`，不含即 `continue`（注释「未声明实现键：打开时隔离，读写口仍拒绝（#132）」）；Fake 导入循环在引用完整性检查之后同样先判再解析。提交在 Batch 8b 整合时并入功能提交。

**验证**：`node --test tests/contract/storage-connector-account.test.js tests/integration/storage-connector-account.test.js`（期望全部通过，守卫仍为 6 条共享用例）。**回滚**：反向两处一行改动与三条断言。

### Batch 3 · 按实现键恢复并切换 Host 入口

**最小闭环**：生产 Host 从存储恢复 provider 并完成组合；空数据根零工作区；重启身份不变；未知键只禁用该挂载；凭据按操作解析且只以句柄落库。**涉及文件**：`apps/harness-plugin/src/host-providers.ts`、`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/host.ts`、`packages/core/src/context.ts`、`tests/integration/harness-plugin-host-providers.test.js`、`tests/integration/harness-plugin-host-roundtrip.test.js`、`tests/integration/harness-plugin-host-runtime-adapter.test.js`、`tests/integration/harness-plugin-artifact.test.js`。

- [ ] 测试辅助：新建共享夹具 `tests/integration/fixtures/host-seed.js`（签名见 `Design / Spec` 接口，D20），其中 `seed` 的 `build` 回调按工作区 → 挂载 → 账号 → 关联 → 配置的顺序写入；测试文件内只留 `replayFetch()`：用 `createReplay(loadFixture(), loadFieldFixture())`，把 fetch 的 JSON body 交给回放，记录每次请求的 `authorization`、`redirect`、`signal`，返回 `new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })`；固定 `WORKSPACE = '00000000-0000-4000-8000-000000000228'`。
- [ ] 先红，四条用例（红的原因须是新选项或 `host-providers.ts` 导出缺失，而不是夹具解析失败）：
  - 「AC1 空数据根：建库迁移 1–7，零工作区，重启仍为零」：`schema_migrations` 为 `[1..7]`；`workspace`、`provider_binding` 均 0 行；`call('baseline', {})` 的 `workspace` 为 `undefined`、`entities` 为 `[]`；`call('bootstrapWorkspace', …)` 的 `writeState` 为 `failed`、`error.code` 为 `not_supported`；`disabled` 为 `[]`；关闭后再组合一次，`workspace` 仍 0 行。
  - 「AC2 AC4 同文件重启：身份不变，凭据按操作解析且只以句柄落库」：种子为工作区、`planning.github-projects` 挂载 P（github.com 账号、句柄 `HARNESS_PROJECTS_GITHUB_TOKEN`、`projectNodeId` 取 `E1_PROJECT_A_ID` 的值（字面值只写在测试里，与回放夹具一致））与 `development.local-git` 挂载 L（`repositoryPath` 指向测试临时目录下的路径，不必存在）。canary v1 组合一次得 `dump` A，关闭，canary v2 再组合得 B。断言：A 与 B 的变化表集合恰好是 `planning_sync_round`、`reconcile_cursor`（原型实测，见 `Surprises & Discoveries`）；`workspace_revision` 不变；两次 `baseline().entities.length` 相等且大于 0；每次 fetch 都带 `authorization: bearer <当时的 canary>`，两种值依次出现，`resolveCredential` 调用次数等于 fetch 次数，每次 fetch 都有 `redirect === 'error'` 与 AbortSignal；数据目录下所有文件（含 `-wal`、`-shm`、`diagnostics.log`）的 canary 原文与 base64 计数为 0（阳性对照：同一扫描函数对写入 canary 的临时文件计数为 1），`workspace.sqlite` 里句柄名计数 ≥ 1；`HOST_REMOTE.invocations[0].result.encode(baseline)` 不含 canary；回放 `misses` 为空。
  - 「AC3 未知实现键只禁用该挂载，其余挂载照常」：种子为 P、挂载 U（键 `vendor.retired`、domain development、enabled、带配置与账号关联；写 U 的配置时策略额外声明 `vendor.retired`）与挂载 X（键 `development.local-git`、`enabled: false`、带配置）。组合成功；`disabled` 恰好一项（U、`not_supported`），X 不在其中；`baseline().entities.length > 0`；`provider_binding` 与 `workspace_binding` 中 U、X 的行前后逐字节相同；`diagnostics.log` 有一行 `bindingDisabled`、`code` 为 `not_supported`。
  - 「AC3 账号来源不是 github.com 的规划挂载被禁用」：账号 origin 为 `https://github.example.com`；`disabled` 为一项 `not_supported`；`entities` 为 `[]`；fetch 调用 0 次。
- [ ] 再绿：按 `Design / Spec` 实现 `host-providers.ts`（本批 local-git 条目不传 `allowedRoot`，由 Batch 5 加）与 `host-composition.ts`；`context.ts:189` 加 `export`。
- [ ] 切换入口与既有测试：`host.ts` 按 `Design / Spec` 改写（`credentials` 缺失或无 `resolve` 时在创建存储前抛 `Harness credential resolver unavailable`；句柄先过 `/^[A-Za-z_][A-Za-z0-9_]*$/`，取 `resolve` 结果的 `value`；保留 `[harness-projects] host ready` 的 `console.info`）。`harness-plugin-host-roundtrip.test.js` 改用 `{ dataPath, workspaceId, catalog: new Map(), resolveCredential: async () => undefined }`，原输入校验断言不变。`harness-plugin-host-runtime-adapter.test.js`：宿主 Context 替身只回答 `credentials`；第一条用例先在 `DSH_HOME` 下 `seed` P 挂载与账号，再 `t.mock.method(globalThis, 'fetch', …)` 回放并在回放里 `await hold`，原有断言全部保留（按操作换 canary、卸载先排空再关闭（I7）、关闭一次、服务撤回、保留调用拒绝、库里有工作区与实体行、数据目录无 canary），工作区名改为种子名；描述符只用 `HOST_REMOTE.invocations[0]`，不断言描述符个数或服务键集合（F14）；第二条用例的两种故障改为「组合时 `createContext` 的事务被拒」（`t.mock.method(SqliteStorage.prototype, 'transaction', …)`，期望 apply 拒绝、关闭一次、不发布）与「`register` 抛错」（不变）。`harness-plugin-artifact.test.js` c 节删除 `createFakeProviders` 与工厂注入，改在干净 `DSH_HOME` 上 `apply`：`baseline` 的 `workspace` 为 `undefined`、`bootstrapWorkspace` 的 `writeState` 为 `failed`、库里 `schema_migrations` 为 1–7 且 `workspace` 0 行；新增 `hostModule.inject` 深等于 `['typert', 'credentials']`，`result.metafiles.host.inputs` 含 `packages/providers/planning-github-projects/` 与 `packages/providers/development-local-git/` 前缀的输入且仍不含 fake；用例名改为它覆盖的内容。

**验证**：`pnpm run typecheck && node --test --test-timeout=120000 tests/integration/harness-plugin-host-providers.test.js tests/integration/harness-plugin-host-roundtrip.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-migrations.test.js && pnpm run boundaries`（期望全部 exit 0）。**回滚**：反向本批提交，Host 回到注入工厂形态；库文件不删。

### Batch 4 · 诊断出口与命令拒绝映射

**最小闭环**：同步异常与命令拒绝只以允许名单字段进入 `<数据目录>/diagnostics.log`，wire 上只有固定文案。**涉及文件**：`apps/harness-plugin/src/host-diagnostics.ts`、`apps/harness-plugin/src/host-composition.ts`、`tests/integration/harness-plugin-host-providers.test.js`。

- [ ] 先红「AC7 同步异常经脱敏写入宿主诊断日志，不上 wire」：测试目录 = `PROVIDER_CATALOG` 加 `fakePlanningEntry((provider) => new Proxy(provider, …))`（`host-seed.js`），Proxy 的 `listPlanningItems` 抛一个 Error：message 由 canary、数据目录绝对路径、带引号的「Secret Project Title」与 `https://example.invalid/x` 拼成，并带 `code: 'ERR_TEST_FAULT'`、`errcode: 13`、`path: <数据目录>`）。组合后 `diagnostics.log` 有一行 `syncRoundFailed`，`name` 为 `Error`、`code` 为 `ERR_TEST_FAULT`、`errcode` 为 13；`frames` 至多 5 项且每项匹配 `^[^/\\\s]+@[^/\\\s]+:\d+$`；整行不含 canary、数据目录路径、`Secret Project Title`、`example.invalid`；`encode(baseline)` 与 `bootstrapWorkspace` 的结果都不含它们。
- [ ] 先红「AC7 命令拒绝映射为固定文案」：组合后用 `t.mock.method(SqliteStorage.prototype, 'transaction', …)` 让事务以含数据目录路径的 Error 拒绝（双重故障）；`call('bootstrapWorkspace', …)` 恰好以 `harness-projects：操作失败，原因已写入宿主诊断日志` 拒绝；`diagnostics.log` 多一行 `operationFailed` 且不含数据目录路径。
- [ ] 再绿：实现 `host-diagnostics.ts`；`host-composition.ts` 接入 `syncRoundFailed`、`bindingDisabled` 与命名闭包 `guarded`（固定文案取模块常量 `OPERATION_FAILED`，不内联进 `call`）；`closed` 检查与输入校验留在 `guarded` 之外，`harness-plugin-host-roundtrip.test.js` 的原文案断言不变。
- [ ] 冻结点：本批提交后，`HostCompositionOptions`、`HostComposition` 成员与 `guarded` 的名字和语义冻结（`Design / Spec` 接口）；在 `Progress` 记下该提交并通知协调者，#276 的分支从这里 rebase 到本分支。之后要改它们须先经协调者通知 #276 的 owner。

**验证**：`node --test --test-timeout=120000 tests/integration/harness-plugin-host-providers.test.js tests/integration/harness-plugin-host-roundtrip.test.js`（期望全部通过）。**回滚**：反向本批提交，诊断回到 no-op。

### Batch 5 · 新进程重启与检出外允许根

**最小闭环**：新进程在同一文件上恢复执行上下文与谱系关系、逐字节相同（兼满足 #28 验收 1）；Host 注入的允许根在检出之外；允许根落进检出时只禁用该挂载。**涉及文件**：`tests/integration/fixtures/host-restart-child.mjs`、`tests/integration/harness-plugin-host-providers.test.js`、`apps/harness-plugin/src/host-providers.ts`。

- [ ] 子进程夹具：读 argv `<dataPath> <workspaceId> <workItemId> <repositoryId>`，import `apps/harness-plugin/src/host-composition.ts` 与 `host-providers.ts`，用 `PROVIDER_CATALOG` 组合（`resolveCredential` 返回 `undefined`），把 `controller.queries.getExecutionContext({ workItemId, repositoryId })` 的 JSON 写到 stdout，`dispose` 后退出；不注册用例。
- [ ] 先红「AC5 AC6 新进程重启恢复执行上下文与谱系，工作树在检出之外」：`makeFixture` 建临时仓库，数据目录取另一个临时目录；种子为工作区与 L 挂载（`repositoryPath` 为夹具仓库、`repositoryExternalId: 'repo-alpha'`），`registerWorkItem(storage, WORKSPACE, 'wi-1')` 登记工作项。组合后 `controller.commands.startWork({ workItemId: 'wi-1', repositoryId: 'repo-alpha', actorRef: { kind: 'agent' }, idempotencyKey: 'k-1' })`，读回上下文 `status` 为 `ready`；工作树路径的 realpath 以 `realpath(<数据目录>)/worktrees/` 开头、相对仓库以 `..` 分量开头，仓库内 `git status --porcelain` 为空。`dump` 的 `entity`、`external_identity`、`repository`、`execution_context`、`relation` 记为 A，`getExecutionContext` 视图记为 V1，`dispose`；`spawnSync(process.execPath, [夹具, …])` 退出码 0、stdout 解析为 V2，子进程退出后再 `dump` 得 B。期望 V1 深等于 V2、A 深等于 B。
- [ ] 先红「AC6 允许根落进仓库检出时禁用该挂载」：数据目录放在 `makeFixture` 仓库内部（`<仓库>/host-data/workspace.sqlite`）；L 进入 `disabled` 且 code 为 `invalid_input`；`startWork` 不返回 ready（没有开发挂载可路由）。
- [ ] 再绿：local-git 条目加入 `allowedRoot` 计算与检出内守卫。

**验证**：`node --test --test-timeout=120000 tests/integration/harness-plugin-host-providers.test.js`（期望全部通过）；`node --test --test-timeout=120000 tests/integration/local-git-start-work-resume.test.js tests/integration/development-local-git.test.js`（期望既有 provider 行为不变）。**回滚**：反向本批提交，local-git 回到 provider 默认根。

### Batch 6 · 对抗验证

**最小闭环**：每条关键断言都有一个必须让它变红的变异（M1–M18），整表在本批末的树上 KILLED；Batch 8a 重构后再整表重跑一次。**涉及文件**：只新增被忽略的 `.superpowers/review-fix/pr-a-mutants.json` 与 `pr-a-artifact-mutants.json`；存活项按根因补测试或修实现（范围见 `Global Constraints`）。

- [ ] 用仓库自带 `scripts/review-mutate.mjs`：锚点不是恰好出现一次即报 NOT_APPLIED（不计为存活）；施加前把原文按字节读进内存，跑完写回并逐字节比对，不用 `git checkout`；`killedBy` 归因到具体用例名。
- [ ] 主 spec `command`：`["node", "--test", "--test-timeout=120000", "tests/integration/harness-plugin-host-providers.test.js", "tests/integration/harness-plugin-host-runtime-adapter.test.js", "tests/integration/harness-plugin-host-roundtrip.test.js", "tests/contract/storage-connector-account.test.js"]`；产物 spec `command`：`["node", "--test", "--test-timeout=180000", "tests/integration/harness-plugin-artifact.test.js"]`。锚点在当前树上取（8a 重构改了锚点时同步 spec），变异语义按 `Artifacts and Notes` 的变异表。
- [ ] 基线不绿时 harness 退出码为 2、结论作废；存活项先判断是否等价变异并写明理由，否则补判别用例后整表重跑；E3 的最终读数取 Batch 8a 那一次整表。

**验证**：`node scripts/review-mutate.mjs .superpowers/review-fix/pr-a-mutants.json --root .` 与 `node scripts/review-mutate.mjs .superpowers/review-fix/pr-a-artifact-mutants.json --root .`（期望 exit 0：全部 KILLED、NOT_APPLIED 为 0；有等价变异时 exit 1 并逐项写明理由）；随后 `git status --short`（期望无变异残留）。**回滚**：spec 不入库；harness 按字节还原，中断时由信号处理还原。

### Batch 8a · 独立验收、重构与树冻结

**最小闭环**：独立验收者（Opus）在本 PR 的最终代码树上完成对抗验收与重构，变异整表重跑全部 KILLED，五方并集全绿，以树冻结和两个 lib sha256 结束；此后到合并只改文档（D18）。**涉及文件**：见 `Global Constraints`，重点是三个 Host 文件与新测试。

- [ ] 独立审读不变量 I1–I7、接口、状态拥有者、错误路径与测试判别力；可证伪的复现在 base、本 PR head 与协调者的一次性并集工作树上各跑一次，区分本层回归与既有缺陷。重构不得改变验收结果，也不得改 Batch 4 冻结的选项、成员与 `guarded`。
- [ ] 重构后重跑 Batch 3–5 的验证与 Batch 6 两份变异 spec 的整表（含 M18），E3 的读数只取这一次。
- [ ] 并集验证：协调者的一次性并集工作树 `.worktrees/round6-union`（分支 `test/round6-union`，不推送）合并 main、#276 的 head（栈上层，已含本 PR）、#231 的 head 与 #280 的 head，运行 `pnpm install --frozen-lockfile --offline && pnpm verify && pnpm run boundaries`；某个 head 尚不可读时用它最新推送的 head，并记录实际用了哪些 head。失败先归因为本层回归、他层回归或既有缺陷再修。
- [ ] 树冻结：`git status --short` 为空时记 `git rev-parse HEAD`，执行 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`，把 `shasum -a 256 apps/harness-plugin/dist/package/lib/index.js apps/harness-plugin/dist/package/lib/client.js` 的两个值与 head 写进 `Progress`。此后代码树不再变；任何使这两个值之一变化的改动都按 Batch 7 的新鲜度规则处理。

**验证**：`pnpm install --frozen-lockfile --offline && pnpm verify && pnpm run boundaries`（期望 exit 0）；`node scripts/review-mutate.mjs .superpowers/review-fix/pr-a-mutants.json --root .` 与 `node scripts/review-mutate.mjs .superpowers/review-fix/pr-a-artifact-mutants.json --root .`（期望 exit 0）；并集工作树里的同一组安装与验证命令（期望 exit 0）；`git status --short`（期望为空）。**回滚**：重构前建 `backup/pr-a-before-8a-20261015`，重构让验收或变异读数变差时回到它。

### Batch 7 · 真实 Desktop 观测（S3）

**最小闭环**：在 Batch 8a 冻结树的构建上，于真实 Desktop 内记录验收 9（干净数据根建库迁移）与验收 8（client 半边一次 query + 一次 command 往返），附宿主版本、head 与 sha256。本批就是协调者合并宿主窗口 S-AB 中属于本 PR 的部分：Phase 0 的两个构建、Phase 1、Phase 1b 与最后的 Phase 3 恢复；同一窗口在 Phase 1b 之后执行 #276 的观测，不属本计划。**承担者**：协调者（主会话），H 步由人类伙伴亲手执行；不由实现者执行，也不得用本地测试替代。

**前置**：(1) #280 的宿主窗口 S-D 已结束，含其第 9 步收尾核对（真实数据根新条目、Documents、pnpm 内容寻址库、监听端口），它交来的启动器与 stdout / stderr 事实写进本批笔记；(2) Batch 8a 完成：树冻结、变异整表全绿、两个 lib sha256 已记录；(3) 人类门 H3、H4 已回答；H5（人类伙伴在 Desktop 凭据存储配置 `HARNESS_PROJECTS_GITHUB_TOKEN`）是 S-AB 窗口的前置，本计划只用它决定验收 8 的期望值；(4) 窗口内不往真实 profile 装其它插件，也不写 `~/.dsh` 的其它位置。#276 迟迟不能树冻结时，是否先单独为 Phase 1 与 1b 开窗由协调者决定并记入 `Decision Log`。

约定：`$DESKTOP_APP` 为 Desktop 应用包根目录（macOS 默认安装位置），`$DSH_CLI` 为 `"$DESKTOP_APP/Contents/Resources/runtime/cli/bin/dsh"`，`$SCRATCH` 由 `mktemp -d` 在系统临时目录下创建。agent 从不读取或打印带令牌的 URL 与凭据值；`desktop.out` 只用 `grep -c` / `grep -cF` 读取，不 `cat`、不另存。读数一律带 +08 时间。

1. 版本：`npm view @deepseek-ai/dsh dist-tags --json` 与 `defaults read "$DESKTOP_APP/Contents/Info.plist" CFBundleShortVersionString` 都须读到 0.2.0-rc.2（设计时 latest、next 为 0.2.0-rc.2，alpha 为 0.2.1-alpha.3）；不是则停下问人类伙伴。
2. Phase 0 构建 A-prod：在检出本 PR 冻结 head、`git status --short` 为空的工作树根目录记 `git rev-parse HEAD`，执行 `pack:plugin`，`shasum -a 256 apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.0.0.tgz apps/harness-plugin/dist/package/lib/index.js apps/harness-plugin/dist/package/lib/client.js` 记三个值；两个 lib 值须等于 Batch 8a 的记录，不等即停（构建不可复现或树已变）；tgz 复制为 `$SCRATCH/A-prod.tgz`。
3. Phase 0 构建 A-probe（H4 批准后）：同一工作树里，在 `apps/harness-plugin/src/client.ts` 的 baseline 调用之后临时加一行 `void child.remote.harnessProjects.bootstrapWorkspace({ kind: 'agent', id: 's3-probe' }, 's3-probe-1').then((result) => console.info('[harness-projects] command received', result.ok ? result.value : result.error))`；`git diff > "$SCRATCH/probe.diff"`，`pack:plugin` 后复制为 `$SCRATCH/A-probe.tgz` 并记三个 sha256；`git restore apps/harness-plugin/src/client.ts`，确认 `git status --short` 为空，重新 `pack:plugin`，三个值须与第 2 步相同。探针行永不提交。
4. 干净数据根：人类伙伴完全退出 Desktop；`test -e "$HOME/.dsh/harness-projects" && echo present || echo absent`，结果为 present 时停下，请人类伙伴自行挪开（agent 不删除）。
5. Phase 1 安装：`"$DSH_CLI" plugin --profile desktop remove @harness-projects/app-harness-plugin`（未安装时报错可忽略；同名同版本须先 remove 再 add），然后 `"$DSH_CLI" plugin --profile desktop add "$SCRATCH/A-prod.tgz"`，期望退出码 0。
6. Phase 1 启动与验收 9：agent 先 `: > "$SCRATCH/desktop.out"`；人类伙伴在自己的终端运行 `open -a "$DESKTOP_APP" --stdout "$SCRATCH/desktop.out" --stderr "$SCRATCH/desktop.err"`（不从 Dock 启动）。agent 只读 `grep -cF '[harness-projects] host ready' "$SCRATCH/desktop.out"`（期望 ≥ 1）与 `grep -c '^dsh web: ' "$SCRATCH/desktop.out"`（期望 ≥ 1，只证明 stdout 已落文件），再只读核对 `node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1],{readOnly:true});console.log(JSON.stringify({versions:db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((r)=>r.version),workspaces:db.prepare('SELECT count(*) AS n FROM workspace').get().n}))" "$HOME/.dsh/harness-projects/workspace.sqlite"`（期望 versions 为 1–7、workspaces 为 0）。记为验收 9 的 S3。
7. Phase 1b 种子（一步写完）：人类伙伴完全退出 Desktop；agent 在 `$SCRATCH/repo` 执行 `git init -b main` 并以 `-c commit.gpgsign=false` 做一次空提交；工作树里被忽略的 `.superpowers/s3/seed.mjs`（不提交）用 `hostStoragePolicy(PROVIDER_CATALOG)` 打开该库，写入工作区 `00000000-0000-4000-8000-000000000228`（名「Harness Projects S3」）与 `development.local-git` 挂载（`repositoryPath` = `$SCRATCH/repo`、`repositoryExternalId` = `s3-repo`）；H5 已满足时同一步再写 github.com 连接账号（句柄 `HARNESS_PROJECTS_GITHUB_TOKEN`，不接触值）、`planning.github-projects` 挂载、账号关联与配置 `projectNodeId` = `E1_PROJECT_A_ID`（沙箱 Project A，已登记于 `docs/architecture/gate-e1-sandbox.md` §2.1 与 F12，不向人类索取；字面值只写进被忽略的种子脚本）。运行 `node .superpowers/s3/seed.mjs "$HOME/.dsh/harness-projects/workspace.sqlite" "$SCRATCH/repo" <with-planning|local-only>`。
8. Phase 1b 安装 A-probe：先 remove 再 add `"$SCRATCH/A-probe.tgz"`。
9. Phase 1b 观测与验收 8：人类伙伴按第 6 步启动，打开 Harness Projects 面板与开发者工具，console 截图须含 `[harness-projects] baseline received`（带工作区名与 revision）与 `[harness-projects] command received`（带 `writeState`）两行。Desktop 无开发者工具时走 B 路线：人类伙伴亲手把带令牌 URL 粘进主会话 Browser 窗格，agent 用 `read_console_messages` 读这两行，不读取、不输入令牌。B 路线也被拒时，只有人类伙伴明确接受（H6）才走 C 路线：用 `$DSH_CLI` 在一次性 `DSH_HOME`（`$SCRATCH/dsh-home`）下以 `web` profile 启动同一发行版，插件用 `"$DSH_CLI" plugin --profile web add` 装进该 home，第 7 步的种子改写到 `$SCRATCH/dsh-home/harness-projects/workspace.sqlite`；启动时不加 `--no-open`，由 `dsh web` 自己打开系统浏览器，其 stdout 同样落文件、只用 `grep -c` 读；人类伙伴在该浏览器的开发者工具里读这两行。C 路线的证据类别是 web profile 而不是 desktop，须如实记录；该 profile 能否解析 Desktop 凭据存储里的句柄未核实，解析不到时按 H5 未满足分支判定。期望：H5 满足时 `writeState` 为 `local_only`、`baseline` 实体数大于 0；H5 未满足时为结构化 `failed` / `not_supported`，往返照样完成。agent 再读 `desktop.out` 的 host ready 计数与 `diagnostics.log` 是否存在及行数。记为验收 8 的 S3。
10. 交接：窗口随后执行 #276 的观测；本计划不记它的读数。
11. Phase 3 恢复：先 remove 再 add `"$SCRATCH/A-prod.tgz"`（或人类伙伴指定的构建），人类伙伴重启 Desktop 并确认 host ready；`~/.dsh/harness-projects/` 原样保留，是否清理由人类伙伴决定。
12. 记录：写入 `Progress` 与 `Outcomes & Retrospective`——Desktop 版本、dist-tags、head、各构建的三个 sha256、探针 diff 行数、console 行与时刻、截图文件名（截图不入库）、走的路线（desktop、B 或 C）；不写令牌 URL、本机用户名与绝对路径。

**新鲜度规则**：证据绑定 `lib/index.js` 与 `lib/client.js` 的 sha256，不绑定 commit SHA。合并前任何使其中之一变化的改动（评审修订、rebase 带进的上游变化），都要在新构建上重做第 2–9 步，或请人类伙伴就该差异明确裁决，不沿用旧构建的观测（#329 的教训）。树不变的整合、#276 的 restack，以及不改这两个值的 rebase 都不触发重做；每次合并前在 rebase 后的 head 上重算并比对。**回滚**：先 remove 再 add 原 tarball；数据目录不删。

### Batch 8b · 回填、整合与 ready

**最小闭环**：在冻结树上只改文档：回填、登记技术债、整合提交、推送、置 ready 并请求人类评审；合并前后的核对见 D17。**涉及文件**：`tests/integration/README.md`、`docs/exec-plan/tech-debt-tracker.md`、本计划。

- [ ] `tests/integration/README.md` 在 `## 约定` 之前增加「Host 组合（#132）」小节，列新测试文件的用例与保护的不变量；`docs/exec-plan/tech-debt-tracker.md` 手工把 TD-053..056 四行插在 Open Items 的编号位置（内容见 `Artifacts and Notes`；不用脚本，脚本会抹掉既有条目），并在 TD-030、TD-031 两行的「下一步」列追加「#132 部分已由 PR #<n> 完成」及剩余项（这两格只由本 PR 改）。
- [ ] 回填 `Progress`、`Surprises & Discoveries`、`Decision Log`（如有新决策）、`Outcomes & Retrospective`、`Bottom Change Note`；按 Batch 7 的新鲜度规则复核 S3（重算两个 lib sha256 并与 Batch 8a 的记录比对）。
- [ ] 整合提交（Conventional Commits，正文说明为什么，以 `Refs #132` 结尾，不写关闭关键字），顺序：`docs(exec-plan): 编写宿主按实现键组合计划`；`docs(adr): 提出 Host 按实现键组合 provider 的决策`；`test(contract): 放行 Host 入口依赖目录收录的 provider 包`；`feat(apps): 按实现键从存储恢复并组合 Harness 宿主`（含存储收窄、core 导出、共享夹具与全部测试）；`docs(exec-plan): 回填宿主组合验收、S3 证据与技术债`。
- [ ] 整合前建 backup ref；整合后用 `comm` 比对新旧 head 的文件集合，`git diff <旧 head> <新 head>` 须为空（整合不改树）；`git log --format=%B origin/main..HEAD | grep '^#'` 期望为空；推送用精确的 `--force-with-lease=<分支>:<旧 head>`；推送后通知协调者 restack #276（先 backup ref，再核对 B 路径树差为空，见 `Global Constraints`）。
- [ ] 置 ready 前在协调者并集工作树重跑 `pnpm install --frozen-lockfile --offline && pnpm verify && pnpm run boundaries`；回读 PR head、base、checks、`closingIssuesReferences` 与 review threads，全部通过后 `gh pr ready <n> -R "$REPO"`，再请求人类评审。
- [ ] 合并前（是否合并由人类伙伴决定）按 D17：rebase 到当前 main 并让协调者 restack #276、按共享文档协议解决冲突、在 main 加全部仍打开 head 的并集上重跑 `pnpm verify`、回读 `closingIssuesReferences`、重算两个 lib sha256；合并后回读 #132 的 `state`。

**验证**：`pnpm install --frozen-lockfile --offline && pnpm verify && pnpm run boundaries && node scripts/workflow-check.mjs && node scripts/rule-checks.mjs disclosure origin/main && node scripts/rule-checks.mjs size origin/main && git diff --check origin/main...HEAD && python3 ~/.agents/skills/exec-plan/scripts/lint_execplan.py docs/exec-plan/active/2026-10-15-host-provider-composition.md`（期望全部 exit 0，size 在预算内，lint 输出 `OK`）；随后 `gh pr checks <n> -R "$REPO"`（期望全部 pass）。**回滚**：整合前的 backup ref；PR 未合并时反向提交。

## Validation and Acceptance

| # | 验收项（#132） | 判定证据 | 强度 | 批次 |
|---|---|---|---|---|
| 1 | 空目录建库、迁移、零工作区 | 新测试「AC1 空数据根」；安装件测试 c 节在干净 `DSH_HOME` 上同形 | S2 | 3 |
| 2 | 同一文件重启，工作区、挂载、身份不变 | 「AC2 AC4 同文件重启」：变化表集合恰为 `planning_sync_round`、`reconcile_cursor`，修订号不变 | S2 | 3 |
| 3 | 未知实现键只禁用该挂载，带结构化错误，其余继续 | 「AC3 未知实现键」与「AC3 账号来源」；契约用例 `configuration-is-workspace-scoped` 的三条新断言在两个适配器上成立 | S2 | 2、3 |
| 4 | 秘密值不进库与日志，存储的句柄是唯一引用 | 「AC2 AC4」的 canary 扫描（原文与 base64、阳性对照）、句柄计数、按操作解析；runtime-adapter 经入口同形 | S2 | 3 |
| 5 | 新进程重启恢复执行上下文与谱系关系（兼满足 #28 验收 1） | 「AC5 AC6 新进程重启」：子进程视图深等，五张表逐字节相同 | S2 | 5 |
| 6 | Local Git 允许根在检出之外（与 #214 一致） | 「AC5 AC6」的路径与 `git status` 断言；「AC6 允许根落进检出时禁用」 | S2 | 5 |
| 7 | `syncRoundFailed` sink、脱敏写入宿主诊断日志、不上 wire 或 UI | 「AC7 同步异常」与「AC7 命令拒绝映射」 | S2 | 4 |
| 8 | client 半边一次 query + 一次 command 往返（记录观测） | Batch 7 第 7–9 步（Phase 1b）的截图或 console 读数，附 Desktop 版本、head 与 sha256；命令一半依赖 H4；`writeState` 期望 H5 满足时为 `local_only`，未满足时为结构化 `failed` / `not_supported` | S3 | 7 |
| 9 | `pack:plugin` 安装件在干净 profile 上建库迁移（记录观测，带宿主版本） | Batch 7 第 2–6 步（Phase 0 与 Phase 1）；S2 前置为安装件测试 c 节 | S2 + S3 | 3、7 |
| E1 | 边界与依赖 | `pnpm run boundaries`：`HOST_ENTRY` 只放行三个文件、client 入口不可达、fake 不在 manifest | S2 | 1 |
| E2 | 回归 | `pnpm verify` 在本 PR 与五方并集（main + #276 + #231 + #280）上全绿 | S2 | 8a、8b |
| E3 | 判别力 | 两份 spec 全部 KILLED，读数取 Batch 8a 重构后的整表（含 M18） | S2 | 6、8a |
| E4 | 发布面与体量 | disclosure、size、`git diff --check`、workflow-check 通过 | S2 | 8b |
| E5 | 关联 | `closingIssuesReferences` 含 #132，#132 的 `closedByPullRequestsReferences` 含本 PR，标签、里程碑、Project 字段回读一致 | 回读 | 0、8b |

验收 8 能否在本 PR 内闭合取决于 H4：人类伙伴若不接受探针 client 的观测，生产 client 发命令属于 #229 或 #276 的范围，本 PR 无法闭合验收 8，届时须由人类批准范围调整（例如把命令一半移到 #229），本计划不得静默放弃。

## Progress

- [x] 2026-10-15 09:55 +08 设计完成：三份独立设计（A1 最小纵向切片、A2 不变量与失效模式、A3 架构边界与下游适配）经独立终审收敛为本计划；读码核实 F1–F13；重跑 A3 原型，确认存储打开期拒绝带配置的未声明键、跳过方案会改写对等 development 挂载的默认角色；新增最终原型确认重启时的变化表集合。决策见 `Decision Log` D1–D16。尚未写任何仓库代码。
- [x] 2026-10-15 10:40 +08 跨 PR 集成评审修订：对照 #276、#231、#280 三份计划与 base 代码逐条核实后采纳——批次改为 0–6、8a、7、8b（S3 在冻结树上观测，新鲜度只认两个 lib sha256）；#276 原生叠在本分支、合并次序与五方并集；`guarded` 具名漏斗与常量；共享夹具 `host-seed.js`；不变量 I7 与 M18；Host 测试不断言描述符个数；ADR-0013 两处精确标注；S3 用仓库登记的 Project A node id、一步种子、C 路线（H6）与 S-D 前置；体量重估为代码约 700；TD-054、TD-055 重写。部分否决一处（TD-055 不写上层的 TD-058 编号）、细化一处（第一刀之二保留 M17、M18 的入口断言），见 D17–D24。仍未写任何仓库代码。
- [ ] Batch 0 · 计划落库与草稿 PR
- [ ] Batch 1 · ADR-0014 与 Host 入口边界
- [ ] Batch 2 · 存储打开期只校验已声明实现键
- [ ] Batch 3 · 按实现键恢复并切换 Host 入口
- [ ] Batch 4 · 诊断出口与命令拒绝映射
- [ ] Batch 5 · 新进程重启与检出外允许根
- [ ] Batch 6 · 对抗验证
- [ ] Batch 8a · 独立验收、重构与树冻结（记录冻结 head 与两个 lib sha256）
- [ ] Batch 7 · 真实 Desktop 观测（S3）——在 S-AB 窗口执行；阻塞于 S-D 结束、人类门 H3（真实 profile 写入）与 H4（探针证据），H5 决定验收 8 的期望值，H6 只在 C 路线需要
- [ ] Batch 8b · 回填、整合与 ready——H2 的结论决定提交序列是否拆出 A0

## Surprises & Discoveries

- 2026-10-15（设计期，在 base `21cb29eb` 上重跑原型 `.superpowers/design/A/proto-a3/inert-mount.mjs`）：库里有一条带配置、实现键未在策略中声明的挂载时，`createSqliteStorage` 抛 `RangeError: binding configuration is not declared for this implementation key`，整个 Host 起不来；不改存储打开期校验，验收 3 在带配置的真实形态下不成立。
- 2026-10-15（同一原型）：两个对等 development 挂载跳过一个后，`createContext` 把剩下那个的 `is_default` 从 0 改写成 1。该角色由 core 每次组合按挂载数推导（F4），是派生值；本计划接受并登记为 TD-053，取舍见 D3。
- 2026-10-15（最终评审原型 `.superpowers/design/A/proto-final/restart-tables.mjs`）：真实 GitHub Projects provider 加录制回放在同一库上组合两次，两次都是 9 个条目、修订号 1，只有 `planning_sync_round` 与 `reconcile_cursor` 变化，工作区记录与连接锚点不变，回放未命中 0 次；验收 2 的「变化表集合恰好是这两张」由此成立且可判别。
- 2026-10-15（读码）：Desktop 吞掉宿主 stderr（F10），诊断走 `console.error` 在 Desktop 里不可见，因此改写宿主数据目录下的自有文件（D5）。
- 2026-10-15（Node v26.11.1 实测）：`node --test <目录>` 只执行 `*.test.js`，`fixtures/*.mjs` 与非 test 的 `.js` 都不执行；`tests/integration/local-git-fixture.js` 文件头「会加载目录下的文件」的说法已不成立，本计划不改它。
- 2026-10-15 10:45 +08（跑文档契约 `node --test tests/contract/e1-evidence-consistency.test.js`）：计划里只要出现沙箱登记的 id 字面量，该检查就按内容把它当作 E1 证据计划，与声明表 `DECLARED_E1_PLANS` 不符而失败；设计稿的 F12 与 AC2 两处写了 Project A 的 node id 字面值，Batch 0 一提交 `pnpm verify` 就会红。改为只写沙箱定义的变量名 `E1_PROJECT_A_ID`，字面值只出现在测试与被忽略的种子脚本里（`tests/` 与 `.superpowers/` 不在发现范围内）；Batch 0 的验证加跑这条与 `plan-facts-consistency`。

## Decision Log

以下决策均为「协调者按人类授权调研后决定，人类可推翻」，日期 2026-10-15，作者为 #132 的独立终审（协调者授权）。

- **D1 组合根位置**：provider 实现由 Host 入口新文件 `host-providers.ts` 的编译期封闭目录选择。不采用运行期注入服务（Desktop 不提供；Cordis 在服务出现前不加载插件，F1；同装插件能 `provide` 同名服务冒充 provider），不新建 `packages/host`（只有一个壳），不在 core 定义目录契约（core 会背上 IO 生命周期，边界照样要放行 apps → providers）。依据：Seemann「组合根应尽量靠近入口，只有组合根引用全部实现」；ADR-0013 第 5 条把实现键选择交给 #132。
- **D2 空数据根**：导出 `unavailableCore`（core 一行），Host 以「工作区尚未创建」组合，不写任何行。不自动建工作区（违反验收 1）；不新增 `listWorkspaces` 或多工作区路由（wire 上没有工作区 id，创建与选择属于 #127、#131）；保留固定 `WORKSPACE_ID`（TD-055）。
- **D3 未知实现键与挂载级失败**：只在内存隔离（`disabled` + `bindingDisabled` 诊断行），不写 `enabled=false`，挂载行不变，实现回来后以原身份复活。不用 A3 的惰性 provider：core 要增约 30 行并处理多域实现键的域集合一致，而它保护的 development 默认角色本是 core 每次组合推导的派生值，代价登记为 TD-053；不整体 fail closed（违反验收 3）。同类系统：Home Assistant 对每个 config entry 分别调用 `async_setup_entry`，失败条目单独处于 setup error 或 setup retry；Backstage 1.36 起可按插件配置 `onPluginBootFailure: continue` 并给出逐插件启动结果。
- **D4 存储打开期校验收窄**：只重放已声明实现键的配置，读写口仍按真实锚点的实现键拒绝，句柄 allowlist 与已声明键的坏配置仍在打开时整库拒绝。理由：没有未校验的值能离开存储，带配置的未知键不再拖垮 Host。#126 的五条验收都不涉及打开期判据；这是对 `docs/exec-plan/completed/2026-10-05-connector-account-storage.md` 实现决策的收窄，须在 PR 正文显式说明。不由 Host 先预读库（那会多出第二个读者）。
- **D5 诊断**：允许名单结构化记录（`name`、`code`、`errcode`、≤ 5 帧 `函数@文件名:行`），不记 message、首行、`path` 与 `cause`；写入宿主数据目录下的 `diagnostics.log`（JSON 行、追加、写失败吞掉）。不用 A1、A2 的模式擦除：那是拒绝列表，无法识别不加引号的提供方原文（A2 自己登记为债），而验收 7 要求去掉的正是凭据、本机路径与提供方原文。不用 `console.error`：Desktop 吞掉宿主 stderr（F10）。依据：OWASP Logging Cheat Sheet 把访问令牌列为应排除的数据、文件路径列为记录前需特殊处理的数据；Node.js 文档写明 `error.code` 是识别错误最稳定的方式、`error.message` 在任何版本都可能变，且文件系统错误带 `path` 属性。不轮转：定时失败要到 #335 才出现（TD-056）。
- **D6 命令拒绝映射与 wire 漏斗**：Controller 的任何拒绝只经 `createHostComposition` 内的命名闭包 `guarded(run)`：先写 `operationFailed`，再改抛模块常量 `OPERATION_FAILED` 的固定文案；不内联进 `call`，落实 TD-031 写给 #132 的下一步。`HostComposition` 上每个面向 wire 的成员都经这一个漏斗：本 PR 是 `call`；#276 的 `watch` 落地时同样经 `guarded`（例如让流迭代器的每次 `next()` 经它），中止是正常结束，否则流会成为一条原样带错误上 wire 的路径，使验收 7 失效。`host 已关闭` 与输入校验的固定中文文案留在漏斗之外。做成具名闭包而不是 `call` 里的 try/catch，是为了让第二个成员复用同一出口、让 M13 有唯一锚点。
- **D7 工作树允许根**：`<数据目录>/worktrees/<sha256(bindingId) 前 16 位>`，落在 `realpath(repositoryPath)` 之内时禁用该挂载。依据 #214 的 Decision Log 裁定产品路径是宿主注入显式 `allowedRoot`（F7）；摘要让目录名与 binding id 的字符集无关。不采用不注入（默认推导对本仓库这类 `.worktrees/` 布局与 dotfiles `$HOME` 会 fail closed）、检出旁兄弟目录（嵌套检出时落进外层检出）或配置字段指定根（没有写者，#127 需要时再加）。同类：Codex 应用把托管工作树放在 `$CODEX_HOME/worktrees`（二手资料与用户报告），Cursor 用固定的 `~/.cursor/worktrees`（社区论坛回答），都在应用自有根目录下而不在仓库旁。代价：#338 改数据根后已存句柄落到新根之外、读回 `invalid_input`，与 #341 同类，记为风险。
- **D8 目录收录**：`planning.github-projects`（含宿主 GraphQL transport）与 `development.local-git`。理由：验收 4 需要一个真正消费凭据的生产实现，验收 5、6 需要 development，M4 demo 需要规划链路，体量可容；其余实现键入 TD-054 并点名承接方。
- **D9 句柄名**：宿主常量 `HARNESS_PROJECTS_GITHUB_TOKEN`，不随目录收缩。dsh-credentials 0.2.0-rc.2 README：启动环境里的同名变量优先于存储，引用名即环境变量名；带命名空间可避免误用用户环境里通用的 `GITHUB_TOKEN`。多账号与名字的写者属于 #127（TD-054）。
- **D10 GraphQL transport**：只接受 `https://github.com` 账号，端点 `https://api.github.com/graphql`；每次请求先解析凭据，`authorization: bearer`、`user-agent`、`redirect: 'error'`（Fetch 规范：redirect 模式 error 遇重定向即返回网络错误，凭据不会跟着跳转）、`AbortSignal.timeout(30_000)`；GHES 不支持（TD-054）。依据：GitHub「Forming calls with GraphQL」——端点固定、POST + JSON body、示例为 `Authorization: bearer TOKEN`。
- **D11 本 PR 单层，#276 原生叠在其上**：本 PR 估算代码约 700、文档约 670，都在预算内，自身不切层。#276 以原生 stacked PR 叠在本分支上（栈深 2），理由均已读码或读计划核实：它的 S3 需要本 PR 的目录（现 `host.ts` 缺 `harnessProjectsProviders` 时 Desktop 不加载插件，F1，观测不到任何流帧）；它的集成测试调用 `createHostComposition`，本 PR 把选项从 `{ workspace, providers }` 改成 `{ workspaceId, catalog, resolveCredential }`，JS 测试不做类型检查，旧调用只在运行时失败；栈上 CI 每次推送都跑两者的并集，它的 S3 也在含本 PR 的 head 上取证。开发仍并行：它不触及本 PR 单元的部分从 main 起步，等本 PR 提交 Batch 4（选项与漏斗定型）后再 rebase 到本分支。依赖边矩阵改动按 #329 先例申请 `docs/review/README.md` §6 的例外（H2），ADR 与边界放宽已整理成实现之前的独立提交（Batch 8b 的第 2、3 个）；H2 被否决时把这两个提交拆成栈底 A0（`Refs #132`），A0 → 本 PR → #276，栈深 3（上限）。实测代码超过 800 时切分点为 L1 = Batch 1–3（组合、空库、重启、未知键、凭据），L2 = Batch 4–5（诊断、新进程、允许根）+ S3；若 H2 也被否决，A0 先合并，再开 L1 → L2 → #276，任何时刻打开的栈不超过 3 层。#276 单独超过 800 时，它的库层可先落 main、壳层再叠在本 PR 上，由 #276 的计划决定。
- **D12 保持 `HostComposition` 形状**：保留 `controller` 字段、只新增 `disabled`，不引入 A3 的 `route()`，避免 B 的 watch 返工。
- **D13 ADR 处置**：新写 ADR-0014（Proposed），在 ADR-0013 第 5 条追加「Superseded in part」并保留原文（`docs/adr/README.md` 规则）；采纳权在人类（H1）。
- **D14 测试网络**：`createHostComposition` 接受 `fetch` 选项，缺省为调用时才读取的 `globalThis.fetch`；入口级测试用 `t.mock.method(globalThis, 'fetch')` 回放 `tests/contract/fixtures/github-projects/replay.js` 并断言 `misses` 为空；不触网、不需要真实凭据。
- **D15 子进程重启**：父进程完成 Start Work 并转储，子进程只组合与查询，父进程在子进程退出后再转储比较。子进程即新进程，满足验收 5 的「new process」，也比两个子进程少一份夹具。
- **D16 验收 8 的取证**：query 一半用生产 client 的 `baseline received`；command 一半用只多一行的探针 client（同 head，不提交，记录 diff 与两份 sha256），先例是宿主复探 O3.2 的探针按钮；是否接受这种证据由人类决定（H4）。 2026-10-15 集成评审后：H5 满足时种子同一步写入规划挂载，验收 8 的期望 `writeState` 为 `local_only`；H5 未满足时保持结构化 `failed` / `not_supported` 分支（D23）。


以下 D17–D24 记 2026-10-15 10:40 +08 跨 PR 集成评审（协调者授权的独立评审者，对照本计划、#276、#231、#280 三份计划与 base 代码逐条核实）后的修订；同样是协调者按人类授权调研后决定，人类可推翻。

- **D17 合并次序与合并前后的核对**：#231 与 #280 既不依赖本 PR，也互不依赖，各自门禁通过即可合并；本 PR 必须先于 #276（原生栈下层）。推荐次序 #231 → #280 → 本 PR → #276，前两者可插在任意位置。每次合并前：rebase 到当前 main（严格分支保护下每合并一个，其余 PR 就变 BEHIND）；本 PR 的 rebase 改写 head 后由协调者 restack #276（先 backup ref，再核对 B 路径树差为空）；按共享文档协议解决 `docs/README.md` 与债务表冲突；在 main 加全部仍打开 head 的并集上重跑 `pnpm verify`；回读 `closingIssuesReferences`；重算两个 lib sha256（Batch 7 新鲜度规则）。合并后回读 #132 的 `state`。并集核对统一在协调者的一次性工作树 `.worktrees/round6-union`（分支 `test/round6-union`，不推送）里跑 main + #276（已含本 PR）+ #231 + #280，取代旧稿的「A、B、C 并集」；在每个 PR 置 ready 前与每次合并前各跑一次。本 PR rebase merge 后 GitHub 会把 #276 改基到 main 并自动变基，此后的树比对、`range-diff`、批准 `submitted_at` 与 head 提交时间的比对、`gh pr merge` 被拒时改走 merge-async REST，都是 #276 合并前的步骤，不属本计划。
- **D18 S3 在冻结树上观测**：原稿 Batch 7 在 Batch 8 之前，Batch 8 的任何重构都会让 S3 证据失效、要求重做（#329 的教训）。改为 Batch 8 拆成 8a（独立验收、重构、变异整表重跑，以树冻结与两个 lib sha256 结束）与 8b（回填、债务、整合、推送、ready），Batch 7 夹在中间，作为协调者合并宿主窗口 S-AB 的 Phase 0、1、1b 与 3 执行。新鲜度只认 `lib/index.js` 与 `lib/client.js` 的 sha256、不认 commit SHA：整合不改树、#276 的 restack 不改本 PR 的树，二者都不该让证据失效；评审修订或 rebase 带进的上游变化若改动这两个文件，sha256 会变，规则照样拦下。
- **D19 共享文件协议（本 PR 视角）**：一个单元一个 owner，双方都不删、不改名对方的成员。`host-composition.ts` 的结构（选项、组合主体、`call`、`disabled`、`guarded`）归本 PR，`controller`、`call`、`dispose` 契约保持稳定；#276 在其上的增量限于一处 import、一个可选选项 `watchIntervalMs?`、紧挨 `call` 的一个成员 `watch(signal)`（查 `closed`、经 `guarded`）。`call` 与将来的流成员都隐式绑定固定 `WORKSPACE_ID`、一个组合一个 Controller，引入工作区选择时经 TD-055 协调。`host.ts` 只归本 PR：I7、最终 `inject` 为 `['typert', 'credentials']`、删除 `createHostComposition` 再导出（测试从 `host-composition.ts` import，roundtrip 测试已是如此）。#276 不加依赖（`@harness-projects/client` 已在 manifest）。ADR-0014 归本 PR，ADR-0015 预留给 #276（仅当人类要求写协议 ADR），#280 不写 ADR。本 PR 独占的其余单元见 `Global Constraints`。只有在人类改判、让 #276 先于本 PR 合并时，本 PR 才获得一次显式的跨 owner 授权：重构时保留 `watch` 与 `watchIntervalMs`，只改写 #276 的 Host watch 集成测试里唯一的组合装置；届时在两边的 Decision Log 各记一条。
- **D20 共享夹具 `tests/integration/fixtures/host-seed.js`**：`seed`、`dump`、`fakePlanningEntry` 从测试文件移出成非测试模块，本 PR 的测试 import，栈上层只读 import。对本 PR 净增约 0 行，栈上层省约 25 行；`node --test <目录>` 只执行 `*.test.js`（`Surprises & Discoveries` 第 5 条实测），夹具不会被当成用例。`fakePlanningEntry` 就是验收 7 用例原本要写的 `harness.fake` 目录条目（F16）；回调可返回替换实例，验收 7 用它包 Proxy。provider-fake 只进测试，不进 `apps/harness-plugin` 的 manifest 与源码（E1 不变）。
- **D21 卸载顺序成为不变量 I7**：`host.ts` 卸载 effect 先 `await remote.dispose()` 再 `composition.dispose()`（F15），ADR-0013 Consequences 留给 #276 的跨代 drain（先中止、再排空、后关闭）建立在它上面。保留 runtime-adapter 的「卸载先排空再关闭」断言，变异表加 M18（交换两次调用），由同一条用例杀死。改写后的 Host 测试不断言描述符个数与服务键集合（F14），因为栈上层会追加第三个描述符与一个服务成员；唯一允许的下标假设是 `invocations[0]` 为 `baseline`。
- **D22 ADR-0013 标注只点名注入工厂那一句**：第 5 条与 Consequences 首条各标一处 Superseded in part，各自只点名要求注入 `harnessProjectsProviders` 工厂的那一句，并明写第 5 条「watch / reconnect 由 #276 承担」与 Consequences「`dispose` 先撤回再关闭、跨代 watch drain 留给 #276」仍然有效。理由：#276 的计划引用这两处作为它的范围依据，笼统的「第 5 条被部分取代」会让读者无法判断哪一半还在。
- **D23 S3 的四处修订**：(a) 种子脚本直接用仓库已登记的 Project A node id（沙箱定义 `docs/architecture/gate-e1-sandbox.md` §2.1 的 `E1_PROJECT_A_ID`，§2.2 有同值，F12），不再向人类索取；(b) H5 满足时，github.com 账号、`planning.github-projects` 挂载与 `development.local-git` 挂载在第 7 步一次写完（原第 9 步并入），#276 的观测需要规划挂载，验收 8 的期望 `writeState` 随之为 `local_only`，H5 未满足仍走 `failed` / `not_supported` 分支；(c) Desktop 渲染层没有开发者工具且 B 路线被拒时，增设 C 路线：用 Desktop 自带的 `dsh web` 在一次性 `DSH_HOME` 下启动同一发行版并让它自己打开系统浏览器，agent 不经手带令牌的 URL；它把证据类别从 desktop profile 换成 web profile，所以只有人类明确接受（H6）才可用；(d) 新增前置：#280 的宿主窗口 S-D 已结束并完成其第 9 步收尾核对。两个窗口串行，避免两次宿主操作互相污染 `~/.dsh`、Documents 与监听端口的读数。
- **D24 对集成评审的一处部分否决与一处细化**：(1) 评审要求 TD-055 交叉引用 #276 的 TD-058。采纳实质、不写编号：本 PR 是栈底，单独合并时 main 上没有 TD-058，写进去就让 main 指向一个不存在的条目，与同一份评审「A 的文档只陈述 A 的事实」相冲突，也正是 `tests/contract/plan-facts-consistency.test.js` 规则 (iii) 所防的「栈底文档引用只在上一层存在的东西」。TD-055 改写为「任何经 `HostComposition` 上 wire 的成员都隐式绑定该工作区，重组会结束已开流的当前代」并点名 #276；交叉引用由上层的 TD-058 指回 TD-055，协调者转告 #276 的 owner。(2) 第一刀之二「删去 runtime-adapter 中已被 AC2 AC4 蕴含的断言」细化为只删库行、canary 扫描与 `encode` 三类：AC2 AC4 直接调用 `createHostComposition`，绕过 `host.ts` 的凭据适配器，按操作换 canary 只有入口级断言能判别（M17），卸载顺序同理（M18），二者必须保留。

### 调研依据

- Composition Root（Mark Seemann）：https://blog.ploeh.dk/2011/07/28/CompositionRoot/
- Koishi / Cordis 服务与 inject 语义（服务可用前插件函数体不加载）：https://koishi.chat/en-US/guide/plugin/service.html
- Home Assistant config entries（逐条目 setup、setup error 与 setup retry 状态）：https://developers.home-assistant.io/docs/config_entries_index/
- Home Assistant 集成 setup 失败处理：https://developers.home-assistant.io/docs/integration_setup_failures/
- Backstage v1.36.0 changelog（`onPluginBootFailure`）：https://backstage.io/docs/releases/v1.36.0-changelog
- Backstage 插件启动结果 API：https://backstage.io/docs/reference/backend-app-api.pluginstartupresult.failure
- OWASP Logging Cheat Sheet：https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- Node.js Errors（`error.code`、系统错误的 `path`）：https://nodejs.org/api/errors.html
- GitHub Forming calls with GraphQL：https://docs.github.com/en/graphql/guides/forming-calls-with-graphql
- WHATWG Fetch Standard（redirect mode "error"）：https://fetch.spec.whatwg.org/
- dsh-credentials 0.2.0-rc.2 README（解析顺序与引用名）：https://unpkg.com/@deepseek-ai/dsh-credentials@0.2.0-rc.2/README.md
- Codex 应用工作树位置（用户报告，权威性较低）：https://github.com/openai/codex/issues/10599
- Cursor 工作树位置（社区论坛，权威性较低）：https://forum.cursor.com/t/configure-worktree-location/149222

## Idempotence and Recovery

- 可重复：组合本身（同一文件重复启动不改变身份，只有轮次与对账时刻前进）；迁移可从空库重放；`pack:plugin` 先清空产物目录再写；测试与变异全部用 `mkdtemp` 临时目录，`review-mutate.mjs` 按字节还原。
- 失败恢复：某批验证失败就停在该批，按根因修复，不跳批；整合或改写历史前建 `backup/pr-a-before-<步骤>-20261015` 本地 ref；rebase 冲突 `git rebase --abort` 回到 backup；推送只用精确的 force-with-lease；`git reset --hard <backup ref>` 只在本地未推送时使用，已推送时用 revert。
- 宿主侧：插件回滚为 `dsh plugin --profile desktop remove` 后 add 旧 tarball；不删除 `~/.dsh/harness-projects/`；MMP 前库不迁移，需要干净数据根时由人类伙伴挪开目录。
- 并行 PR 冲突：#276 叠在本分支上，`host-composition.ts` 不会与它文本冲突；本 PR 每次改写历史后由协调者 restack #276（先 backup ref，B 路径树差须为空）。与 #231、#280 可能冲突的只有 `docs/README.md` 与债务表：前者保留全部行、2026-10-15 的几行按计划文件名排序，后者各行按编号位置放；`pnpm-lock.yaml` 与 `docs/adr/*` 只由本 PR 改，不会冲突。每次合并前在协调者并集工作树上重跑 `pnpm verify`（D17）。
- 窗口中断：S-AB 在 Phase 1 或 1b 中断时，先按 Phase 3 恢复生产构建，读数作废的步骤从该 Phase 的第一步重做；冻结树的两个 lib sha256 不变时，Phase 0 的构建可复用。

## Artifacts and Notes

**变异表**（Batch 6；锚点在最终树上取，harness 保证施加与还原）

| ID | 文件 | 变异 | 期望杀死它的用例（killedBy 片段） |
|---|---|---|---|
| M1 | `packages/storage/sqlite/src/storage-sync.ts` | 删掉打开期「未声明键跳过」 | `configuration-is-workspace-scoped`；AC3 |
| M2 | `packages/providers/fake/src/storage.ts` | 删掉导入期「未声明键跳过」 | `configuration-is-workspace-scoped` |
| M3 | `host-providers.ts` | 传给 provider 的 binding id 改为 `${binding.id}-x` | AC2 |
| M4 | `host-providers.ts` | 删掉 `enabled === false` 跳过 | AC3 |
| M5 | `host-providers.ts` | 未知实现键改为抛错 | AC3 |
| M6 | `host-providers.ts` | 删掉 github.com 来源检查 | `AC3 账号来源` |
| M7 | `host-providers.ts` | transport 在构造时解析一次凭据并缓存 | AC2 AC4 |
| M8 | `host-providers.ts` | 删掉 `redirect: 'error'` | AC2 AC4 |
| M9 | `host-providers.ts` | local-git 不传 `allowedRoot` | AC5 AC6 |
| M10 | `host-providers.ts` | 删掉检出内守卫 | `AC6 允许根落进` |
| M11 | `host-composition.ts` | 空工作区分支改为带 storage 调 `composeCore` | AC1 |
| M12 | `host-composition.ts` | 不传 `diagnostics` | `AC7 同步异常` |
| M13 | `host-composition.ts` | `guarded` 原样重抛 | `AC7 命令拒绝` |
| M14 | `host-diagnostics.ts` | 记录里加入 `message` | `AC7 同步异常` |
| M15 | `host-diagnostics.ts` | frames 保留完整路径 | `AC7 同步异常` |
| M16 | `host.ts` | `inject` 恢复 `harnessProjectsProviders` | 安装件 c 节（产物 spec） |
| M17 | `host.ts` | 凭据适配器缓存首次解析值 | runtime-adapter「resolves credentials per provider operation」 |
| M18 | `host.ts` | 卸载 effect 交换为先 `composition.dispose()` 后 `await remote.dispose()` | runtime-adapter「在途调用结束前不得关闭 SQLite」（I7） |

**人类门**（协调者用一句可批准陈述直接问人类伙伴；批准时刻、问题原文与答案写进 Decision Log；他会话转述不算）

- H1：是否采纳 ADR-0014（含对 ADR-0013 第 5 条的部分取代）；此前保持 Proposed。
- H2：是否批准 `docs/review/README.md` §6 的例外，让依赖边矩阵改动留在本 PR。推荐批准（#329 先例，边界放宽已是独立提交）；否决时按 D11 拆成栈底 PR。
- H3：是否批准 Batch 7 在真实 `desktop` profile 安装插件，并在 `~/.dsh/harness-projects/` 建库、种入测试工作区（H5 满足时还含一个只存句柄的 github.com 连接账号与沙箱 Project A 的规划挂载；不删除任何东西）。
- H4：验收 8 的命令一半是否接受探针 client 的宿主内观测；否决时验收 8 需要人类批准的范围调整（D16、`Validation and Acceptance` 末段）。
- H5：人类伙伴自行在 Desktop 凭据存储配置 `HARNESS_PROJECTS_GITHUB_TOKEN`（S-AB 窗口的前置，#276 的观测需要它）；对本计划可选，满足时验收 8 的期望 `writeState` 为 `local_only`，否则为 `failed` / `not_supported`；agent 不经手令牌。
- H6（仅在需要时问）：Desktop 无开发者工具且 B 路线被拒时，是否接受 C 路线——Desktop 自带 `dsh web` 在一次性 `DSH_HOME` 的 web profile 下取证，证据类别不再是 desktop profile（D23）。
- 常设：不写 `Status`、`blocked-by` / `blocking`；是否合并由人类伙伴决定。

**跨 PR 接缝**（本轮并行：B #276、C #231、D #280）

- B（#276）：以原生 stacked PR 叠在本分支上（D11），共享文件协议见 `Global Constraints` 与 D19。本 PR 对它的承诺：Batch 4 提交后选项、`HostComposition` 成员与 `guarded` 冻结；卸载顺序 I7 不变；`host-seed.js` 的三个导出保持签名；改写后的 Host 测试不断言描述符个数与服务键集合；S3 的探针行只在 Phase 0 临时加在 `client.ts`、永不提交。它对本 PR 的承诺（写在它自己的计划里，本 PR 不依赖其文件存在）：流成员经 `guarded`，`remote.ts` 新描述符追加在末尾、`invocations[0]` 仍是 `baseline`，`client.ts` 保留 unary `baseline()` 调用与 `baseline received` 日志（验收 8 的 query 一半用它）。
- C（#231）：独立于本 PR，从 main 起步、不叠栈。`development.github` 条目在本 PR 与 #231 都合并后由 #233 或后合并者加（一个目录条目、`HOST_ENTRY.allow` 一行、manifest 一行，期望配置见 TD-054）；请 C 保持 `bindingId` 必填（不默认随机）并导出 `*_DEFINITION`。
- D（#280）：独立于本 PR，从 main 起步、不叠栈。它的宿主窗口 S-D 先于 S-AB 串行执行，并以其第 9 步收尾核对结束（D23）；它交来的启动器与 stdout / stderr 事实写进 Batch 7 笔记，与 F10 不同时回填本计划；将来的 `execution.harness` 走同一条目接口。
- A 认领的无主单元：`packages/core/src/context.ts`（一行）、`packages/storage/sqlite/src/storage-sync.ts`、`packages/providers/fake/src/storage.ts`、`tests/contract/suites/storage-connector-account.js`、`tests/contract/package-boundaries.test.js`、`docs/adr/` 与编号 ADR-0014（ADR-0015 预留给 #276）；协调者已在共享文件协议里确认 B、C、D 不改它们。
- 共享索引：放置规则见 `Global Constraints`「共享文档」；债务号段 A 为 TD-053..056、B 为 057..060、C 为 061..064、D 为 065..066，无论合并次序都插在编号位置。

**技术债候选**（Batch 8b 手工插入 `docs/exec-plan/tech-debt-tracker.md` 的编号位置）

- TD-053（core 注册，`packages/core/src/registry.ts`）：运行期禁用一个对等 development 挂载后，幸存挂载的派生 `isDefault` 被 `createContext` 写进 `workspace_binding`（实测 0→1），被禁用的挂载回来后再写回 0。不修理由：惰性挂载约 30 行 core 改动加多域一致性处理。影响：列表显示的角色随运行期缺口变化，路由由内存注册表决定、不受影响。下一步：#127 定义挂载角色的写者时，让 `createContext` 不重写已存角色或由 Host 传入已存角色。
- TD-054（Host 目录，`apps/harness-plugin/src/host-providers.ts`）：目录只收 `planning.github-projects` 与 `development.local-git`；`delivery.github-actions`（#127 绑定交付源时，需权限快照）、`development.github`、执行实现（#140、#280）未收；GHES 账号被禁用；句柄只有一个宿主常量名，多账号与名字的写者属于 #127。`development.github` 条目（#231 合并后由 #233 或后合并者加）的期望配置：`repositoryExternalId`（工作区的 `repositoryId` 本地键，永远不是 node id）、`repositoryOwner`、`repositoryName`；复用 `githubGraphqlTransport` 与 `HOST_SECRET_HANDLES`；它的 `describeCapabilities` 在组合期再做一次仓库探针，是第二个组合期触网点（见 TD-056）；#297 合并前不得与 `development.local-git` 挂在同一个工作区（两个 Development 挂载时按键解析 fail closed）。
- TD-055（Host 组合，`apps/harness-plugin/src/host-composition.ts`）：只在 apply 时组合一次固定 `WORKSPACE_ID` 的工作区，#127、#131 改变挂载或创建工作区后需要重组（reload）与工作区列表；任何经 `HostComposition` 上 wire 的成员都隐式绑定这一个工作区（今天是 `call`，#276 计划中的流成员同样如此），#127/#131 之后的重组会结束已开流的当前代，客户端是否能自动重开取决于 #276 的实现，届时与 #276 的债务条目交叉引用（D24）；`disabled` 只在内存与诊断日志、不上 wire（#127 的 effective access 承接）；句柄 allowlist 缩小或已声明实现键的配置 schema 收紧会让整库在打开时被拒，MMP 前不做兼容，改动它们的 PR 须同时给出库的处置。
- TD-056（Host 诊断与启动）：诊断日志无轮转（#335 接入定时刷新时补）；apply 期间的失败（迁移、存储打开）原样拒绝给宿主，未经本 PR 的允许名单（#338）；首轮水合在 typed remote 注册前触网，受 30 s 请求超时约束（#335）；`describeCapabilities` 违约抛错会让整个 Host 起不来而不是只禁用该挂载。

**S3 产物**：截图、`desktop.out` 计数、探针 diff 与 sha256 只在 `$SCRATCH` 留存原件，读数写进 `Progress`，原件不入库。

## Interfaces and Dependencies

- 内部依赖：core 的 `composeCore`、`unavailableCore`（新导出）、`CoreProviderTable`、`CoreDiagnostics`；controller 的 `createController`、`Controller`；storage/sqlite 的 `createSqliteStorage`、`SqliteStorage`；capabilities 与 domain 的 `StorageValidationPolicy`、`BindingConfigurationSchema`、`ProviderBindingRecord`、`ConnectorAccountRecord`、`ProviderDefinition`、`projectError`、`ProjectErrorCode`；provider 的 `createGithubProjectsPlanningProvider`、`GITHUB_PROJECTS_PROVIDER_DEFINITION`、`GraphqlTransport`、`createLocalGitDevelopmentProvider`、`LOCAL_GIT_PROVIDER_DEFINITION`。
- 宿主接口：Cordis `inject`（`typert`、`credentials`）；`credentials.resolve(句柄)` → `{ value, source } | undefined`，每次调用读当前值，引用名即环境变量名；typed remote（不变，见 ADR-0013）；Desktop 插件安装用应用包内启动器 `runtime/cli/bin/dsh plugin --profile desktop add|remove`；Desktop stdout 落文件用 `open -a … --stdout`；C 路线（H6）用同一启动器的 `plugin --profile web add` 与 `web`，`DSH_HOME` 指向一次性目录。
- 数据根：`DSH_HOME` 或 `~/.dsh`，其下 `harness-projects/workspace.sqlite`、`harness-projects/diagnostics.log`、`harness-projects/worktrees/<16 位摘要>/`。
- 命名契约：实现键 `planning.github-projects`、`development.local-git`；配置字段 `projectNodeId`、`repositoryPath`、`repositoryExternalId`；句柄 `HARNESS_PROJECTS_GITHUB_TOKEN`；诊断事件 `syncRoundFailed`、`operationFailed`、`bindingDisabled`；固定文案常量 `OPERATION_FAILED` = `harness-projects：操作失败，原因已写入宿主诊断日志`，唯一出口 `guarded`；测试共享夹具 `tests/integration/fixtures/host-seed.js` 的 `seed`、`dump`、`fakePlanningEntry`；工作区 id `00000000-0000-4000-8000-000000000228`。
- 外部工具：Node 26（`node:sqlite`、`node:test`、type stripping）、pnpm 10.28.2、git、`gh`、Desktop 0.2.0-rc.2（Batch 7 前按第 1 步复核）。凭据：本 PR 的测试不用真实凭据；S3 的可选 GitHub 凭据由人类伙伴配置。

## Outcomes & Retrospective

执行前本节只有这条说明：Batch 8b 在此回填实际结果、与计划的偏差（体量实测、批次调整、被推翻的决策）、S3 读数、遗留问题与承接 issue。

## Bottom Change Note

- Change Note (2026-10-15 09:55 +08)：创建本计划。三份独立设计经独立终审收敛：以最小纵向切片为骨架，吸收「存储打开期隔离未声明键」「允许名单诊断」「句柄常量不随目录收缩」「子进程重启」，否决多工作区路由、`listWorkspaces`、core 惰性挂载与模式擦除式脱敏；新增诊断写宿主自有文件（Desktop 吞 stderr）与重启变化表集合的判别断言；估算单 PR，代码约 635、文档约 650。
- Change Note (2026-10-15 10:40 +08)：按跨 PR 集成评审修订（D17–D24）。为什么：本 PR 成为 #276 原生栈的下层，S3 改在 Batch 8a 冻结树上、作为协调者合并宿主窗口 S-AB 的 Phase 0/1/1b/3 执行，避免重构让证据失效；`guarded` 成为所有上 wire 成员的唯一漏斗；新增共享夹具 `host-seed.js`、不变量 I7 与 M18；ADR-0013 标注收窄到注入工厂那一句；S3 用仓库登记的 Project A node id、一步种子、C 路线（H6）并以 S-D 结束为前置；共享文件与共享文档协议、合并次序与五方并集写入 `Global Constraints` 与 Decision Log。体量重估为实现约 290、测试约 410、代码约 700、文档约 670，760 触发两刀预案。部分否决 TD-055 引用上层 TD-058 编号（栈底只写自己的事实）。
