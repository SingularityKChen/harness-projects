# 宿主承载能力探针：四个问题的观测与裁决

> 状态：证据与裁决（可复核；是否采纳由人类伙伴确认）
> 日期：2026-09-24（观测时间戳取自运行机器的时钟，均为 UTC）
> 批次：MVP-1 D3-L1（issue #125）；本 PR 的 base 是 `origin/main` = `4d46559`
> 判定对象：issue #125 的四个承载问题，以及由它们汇成的单一裁决 `embed` / `fallback-web`
> 上游：issue #125、epic #124；计划见 `docs/exec-plan/completed/2026-09-24-harness-host-spike.md`
> 本文件自包含：所有引用都是仓库内相对路径、宿主运行时的服务键（`ctx.*`）或 API 符号，不含宿主产品名与本机绝对路径（`AGENTS.md` §7）。

## 1. 这份记录是什么、不是什么

**是什么**：四个承载问题逐条的观测结果——每条分"机制存在"与"承载能力已实测"两半——以及一个取值恰好为 `embed` 或 `fallback-web` 的裁决，并点名决定它的那一个答案。

**不是什么**：

1. 不是"宿主能/不能"的完整证明。四个问题里只有一个半达到了"承载能力已实测"；其余的是"机制存在、能力未观测到"。裁决按预先写死的规则（计划 `Design / Spec` §4）由**观测强度**决定，不由"希望 MVP-1 长什么样"决定。
2. 不是对 `packages/**` 的任何修改建议。记录只描述观测到的现状。
3. 不是探针代码的归档。issue #125 的 Out of scope 规定"spike code that is not kept is not merged"；探针是一次性的，已删除，本记录给出它的命令、它调用的服务键与完整观测输出。
4. 不是"宿主不适合承载"的结论。见 §9：四个问题里三个的缺口在**本仓库侧**（SQLite 的 `Storage` 实现、provider 占位、插件包缺客户端 bundle），不在宿主侧。裁决是"当前无法证明能承载"，不是"证明不能承载"。

## 2. 观测方法与判据

### 2.1 两半判据

| 半 | 定义 | 证据形态 |
|---|---|---|
| **机制存在** | 宿主运行时里确有这条代码路径：服务键、导出符号、文件角色 | 读代码 / 读包内类型与实现得到的路径与符号 |
| **承载能力已实测** | 在**真实的宿主插件运行时**里跑通，而不是"类型上可行" | 命令 + 退出码 + 输出片段 + 观测时间 |

裁决只跟随"承载能力已实测"。把两半混写，正是本层要防的失败模式。

### 2.2 观测环境

| 项 | 值 |
|---|---|
| 检出 | `.worktrees/w13-d3a`，分支 `test/harness-host-spike`，head 见 PR #162 |
| 仓库基线 | `origin/main` = `4d46559` |
| Node | v26.9.0（可直接执行 `.ts` 源码） |
| 宿主运行时根 | 记为 `$HOST_RUNTIME`：本机已安装宿主运行时的 `node_modules` 的父目录。按 `AGENTS.md` §7 不写入仓库，命令里用环境变量传入 |
| 宿主用户数据根 | 探针把它指向系统临时目录下的一次性目录（`DSH_HOME`），**没有写本机真实用户数据根** |
| 凭据 | 探针自造假值 `probe-secret-value`，不是任何真实凭据 |
| 观测窗口 | 2026-09-23T07:34:30Z – 2026-09-23T07:35:40Z |

### 2.3 一次性探针与其去向

两个脚本，位于 `apps/harness-plugin/.spike/`（未跟踪目录）：

```bash
# 在检出 test/harness-host-spike 的工作树根目录运行
HOST_RUNTIME=<宿主运行时根> node apps/harness-plugin/.spike/probe-a.ts   # P1 / P2 / P3 宿主半边 / P3 客户端加载尝试
HOST_RUNTIME=<宿主运行时根> node apps/harness-plugin/.spike/probe-b.ts   # P3 类型化 Remote 可达性 / P4 客户端面可达性
```

两个脚本退出码都是 0（逐条观测写进 stdout 的 JSON 行，单条观测失败不终止进程）。观测结束后整个 `.spike/` 目录已删除，`git status --short` 只余 `docs/` 下的改动。脚本通过"角色 → 宿主包目录"的映射表从 `$HOST_RUNTIME/node_modules` 解析宿主包；映射表含宿主包名，随脚本一起删除，不入库（issue #125 规定探针不合并）。因此本记录把"确切的代码路径"给到**服务键与 API 符号**这一级。

### 2.4 静态证据的取法

需要读宿主运行时的包内文件时，命令一律写成不含宿主包名的 glob：

```bash
export HOST_RUNTIME=<宿主运行时根>
grep -rn "<符号>" "$HOST_RUNTIME"/node_modules/*/*/lib/client.js          # 客户端 bundle
grep -rn "<符号>" "$HOST_RUNTIME"/node_modules/*/*/lib/types/client/*.d.ts # 客户端类型面
```

**这条约束没有机械兜底（对抗验证实测）**：`node scripts/rule-checks.mjs disclosure <base>` 的七类模式是 GitHub 令牌 / GitHub 细粒度 PAT / AWS Access Key / 私钥 PEM 头 / 本机家目录路径 / 内网主机名 / RFC1918 地址——**不含宿主标识符**。验证者用"把宿主产品名注入新增行"的方式证伪了扫描覆盖：机械扫描仍然通过。因此"不写宿主产品名与包名"只能靠人工五类目检查与本节的写法纪律，不能靠 `disclosure` 的退出码。

## 3. 问题一：宿主侧模块能否用 `packages/storage/sqlite` 在宿主拥有的目录里建库并构造 controller

**答案：未观测到**（三半里前两半观测到，第三半——两者组合——实测失败；失败原因在仓库侧）

### 3.1 机制存在

- 宿主侧插件是导出 `apply(ctx)` / `inject` 的 ESM 模块，由宿主插件运行时（`Context` / `Service`）挂载；`new Context()` + `await ctx.plugin(plugin)` 可以在一个普通 Node 进程里立起来。观测命令见 §2.3，输出见 3.3 的 `host.plugin-runtime-loaded`。
- 宿主为它自己的用户数据解析出一个根目录，并派生其下的子路径：运行时导出 `resolveDshHome()` / `dshHomePath(child)`，且 `resolveDshHome()` 服从 `DSH_HOME`。观测到 `homeIsTemp: true`、`homeEnvKey: "DSH_HOME"`，即探针解析出的根就是它自己设的临时目录——**没有碰本机真实用户数据根**。

### 3.2 承载能力已实测

| 子观测 | 命令 | 结果 | 时间（UTC） |
|---|---|---|---|
| 宿主插件运行时能立起来 | `HOST_RUNTIME=<宿主运行时根> node apps/harness-plugin/.spike/probe-a.ts` | `contextCtor: "function"`、`homeResolver: "function"` | 2026-09-23T07:35:39Z |
| 在宿主拥有的目录里建库 + 迁移 | 同上（同一进程内，宿主插件体里） | 库文件存在、8192 字节、`migrate` 返回 `{"applied":[1],"version":1}`、`schema_migrations` 1 行、表清单 `["schema_migrations"]` | 2026-09-23T07:35:39Z |
| 在宿主插件体里构造 core + controller | 同上 | `revision: 1`、`entities: 5`、`authority: "host"`、`freshness: "fresh"`、`watch.poll()` 首次返回 `undefined` | 2026-09-23T07:35:39Z |
| **把 sqlite 库当作 storage 交给 `composeCore`** | 同上 | **失败**：`storage.putWorkspace is not a function` | 2026-09-23T07:35:39Z |

第三条用的是 `packages/providers/fake` 的内存 `Storage`（仓库当前唯一的 `Storage` 实现）——它证明 **controller 能在宿主插件体里跑**，但不证明它能跑在 sqlite 上。

### 3.3 为什么第三半失败：仓库侧事实

```bash
# 在检出 test/harness-host-spike 的工作树根目录运行
git grep -n "implements .*Storage" -- '*.ts'
# → packages/providers/fake/src/storage.ts:32:export class MemoryStorage implements cap.Storage
cat packages/storage/sqlite/src/index.ts     # 只导出 db.ts / migrations.ts / migrate.ts
cat packages/storage/sqlite/migrations/001_init.sql
# → CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
#   注释原文：业务表留给后续批次（#27/#28）
```

**取法纪律**：一律用 `git grep`（只扫受跟踪内容），不要用 `grep -rn … .`。`.worktrees/` 被 `.gitignore` 忽略，但裸 `grep` 仍会走进去——在仓库根目录实测会得到 16 行，其中包含其它分支上已提交的 `SqliteStorage` 实现（只交付地基面、其余方法抛 `not implemented`）。那会让"仓库有没有 SQLite `Storage` 实现"这个判断直接**读反**。

`packages/core/src/context.ts` 的 `composeCore` 取 `deps.storage ?? deps.providers.storage`；`packages/storage/sqlite` 目前只提供"打开数据库 + 跑迁移"，**没有实现 `Storage` 能力契约**（`packages/capabilities/src/storage.ts` 的 `Storage` 接口有 30 个方法）。所以"用 `packages/storage/sqlite` 构造 controller"这件事在当前仓库状态下**不可能发生**，与宿主无关。

### 3.4 结论

- 宿主侧：一个宿主插件**能**在宿主拥有的目录里建库、跑迁移，也**能**在插件体里构造 core + controller（用内存 storage）。
- 缺的那一半是**仓库侧**的 SQLite `Storage` 实现（`packages/capabilities/src/storage.ts` 的 `Storage`，业务表在 #27/#28）。
- 因此问题一的答案是**未观测到**：不是宿主承载不了，而是本仓库还没有可被承载的 SQLite 存储实现。

## 4. 问题二：provider 能否通过宿主 secret 服务解析的句柄拿到凭据，且密钥不进入 project 数据库

**答案：未观测到**（句柄解析与"密钥不入库"两半观测到；"provider 拿到凭据"这一半没有可观测对象）

### 4.1 机制存在

- 宿主凭据缝是一个独立服务键 `ctx.credentials`，语义是"配置里放**引用**（POSIX 环境变量名形状），值由 provider 自己拥有"：`credentialRef(name)` 产出句柄，`resolve(ref)` 返回值，`describe(ref)` 只返回 `{ configured, source, writable }`。
- `describe()` 的返回类型里**没有**可以承载值的槽位——这是"配置界面能显示一个引用是否已设置、却永远看不到值"的结构性保证，不是约定。
- 解析优先级固定：启动环境 → 存储文件 → 项目 `.env` → 用户数据根 `.env`。存储文件是版本化 YAML，只有 `refs` 与 `records` 两个键空间；文件权限必须 owner-only（探针第一次跑就被它拒绝了：`is readable beyond its owner (mode 644)`，`chmod 600` 后通过）。

### 4.2 承载能力已实测

| 子观测 | 命令 | 结果 | 时间（UTC） |
|---|---|---|---|
| 句柄能被解析出值 | `HOST_RUNTIME=<宿主运行时根> node apps/harness-plugin/.spike/probe-a.ts` | `resolveHit: {"value":"probe-secret-value","source":"file"}` | 2026-09-23T07:35:39Z |
| `describe` 不含值 | 同上 | `describeHasValueSlot: false`；`describe: {"configured":true,"source":"file","writable":true}` | 2026-09-23T07:35:39Z |
| 未设置的引用是"未设置"而不是错误 | 同上 | `resolveMissing: "undefined"` | 2026-09-23T07:35:39Z |
| 密钥不进入 project 数据库 | 同上：解析出的值只传给内存里的替身，随后按字节读回 §3.2 建的库文件 | `secretInProjectDb: false` | 2026-09-23T07:35:39Z |

第四条的强度要说清楚：它证明的是"**这条路径**不会把密钥写进 project 数据库"，不是"任何实现都不可能写进去"。真正把这条不变量钉死的是 #132 的验收项"a test asserts the stored handle is the only reference"。

```bash
# 能力与领域契约里没有凭据字段（在检出 test/harness-host-spike 的工作树根目录运行）
grep -rn -i "credential\|secret\|handle" packages/capabilities/src packages/domain/src --include=*.ts
# → 无输出
```

### 4.3 缺的那一半：没有可观测的 provider

`packages/providers/*/src/index.ts` 里除 fake 外全部只有 `packageId` 占位（`ls packages/providers` 共 8 个包，其中 7 个非 fake：`planning-github-projects`、`planning-local`、`development-github`、`development-local-git`、`execution-harness`、`execution-human`、`delivery-github-actions`）。**当前没有任何 provider 消费凭据**，所以"provider 通过句柄拿到凭据"这条端到端路径没有可观测对象：句柄→provider 的接线还不存在。

### 4.4 结论

- 宿主侧：句柄解析可用、`describe` 结构上不承载值、owner-only 文件权限被强制执行。
- 仓库侧：没有 provider 消费凭据，"句柄进入 provider"这一半**未观测到**。
- 因此问题二的答案是**未观测到**，缺口同样主要在仓库侧。

## 5. 问题三：插件客户端能否经宿主 transport 调用 controller 的查询与命令并收到 watch 增量

**答案：未观测到**（宿主半边观测到；客户端半边与 watch 增量未观测到）

### 5.1 机制存在

- 宿主 transport 是一个**通用**的 RPC 注册面，不是为某个业务包定制的：
  - 宿主侧 `ctx.connection.rpc.handle(channel, handler)`（注册一条绝对逻辑通道）与 `ctx.connection.rpc.intercept('/api', matches, handler)`（在共享 `/api` 通道上按前缀认领端点）。
  - 客户端侧 `ctx.connection.rpc.call(channel, endpoint, payload, signal)`。
  - 信封是 `{ type: 'client-request', rpcId, method, payload }` → `{ type: 'server-response', rpcId, result }`，`result` 是 `{ ok: true, value }` / `{ ok: false, error }`。
- 增量（watch）在宿主侧的对应物是**流式 Remote**：`@Remote({ mode: 'stream' })` 的方法返回 `Iterable` / `AsyncIterable`，客户端用 `ctx.remote.$stream()` 取，`RemoteSnapshotStream` 的语义正是"一个开场快照 + 随后的增量"——与本仓库 `controller.baseline()` + `controller.watch()` 的形状一一对应。
- 但流式 Remote 走的是 `ctx.typertGateway` + 生成物描述符：客户端侧 `ctx.remote.$mount()` 要求"generated Host-for-Client contribution"，"descriptors without strict generated codecs fail before methods become callable"。生成物由构建期生成器产出。

### 5.2 承载能力已实测：宿主半边

探针在一个真实宿主 `Context` 里挂了连接服务，用 `intercept('/api', …)` 把 controller 的**查询**与**命令**认领到前缀 `harness-projects/` 下，再用 `createSharedFetchHandler('/api')` 手工构造 RPC 信封并派发：

| 子观测 | 命令 | 结果 | 时间（UTC） |
|---|---|---|---|
| 查询穿过 transport | `HOST_RUNTIME=<宿主运行时根> node apps/harness-plugin/.spike/probe-a.ts` | HTTP 200，`{"type":"server-response","rpcId":"probe-harness-projects/snapshot","result":{"ok":true,"value":{"revision":1,"entities":5}}}` | 2026-09-23T07:35:39Z |
| 命令穿过 transport | 同上 | HTTP 200，`{"result":{"ok":true,"value":{"decision":"ok"}}}` | 2026-09-23T07:35:39Z |
| 未认领的端点 | 同上 | HTTP 404，`not found` | 2026-09-23T07:35:39Z |
| 注销后同一端点 | 同上 | HTTP 404，`not found` | 2026-09-23T07:35:39Z |

这一条证明：**宿主 transport 能承载 controller 的查询与命令**（宿主半边），且认领/注销的生命周期正确。它不涉及 HTTP 服务器——`intercept` 只登记拦截器，所以这个观测在一个普通 Node 进程里可复现。

### 5.3 承载能力未观测到：客户端半边与 watch 增量

| 尝试 | 命令 | 结果 | 时间（UTC） |
|---|---|---|---|
| 在 Node 里加载宿主外壳的已构建 SPA | `HOST_RUNTIME=<宿主运行时根> node apps/harness-plugin/.spike/probe-a.ts` | `ReferenceError: document is not defined` | 2026-09-23T07:35:39Z |
| 在 Node 里加载一个已安装的客户端插件 bundle | 同上 | `ReferenceError: window is not defined` | 2026-09-23T07:35:39Z |
| 在 Node 里加载类型化 Remote 的客户端入口 | `HOST_RUNTIME=<宿主运行时根> node apps/harness-plugin/.spike/probe-b.ts` | `ReferenceError: window is not defined` | 2026-09-23T07:35:39Z |
| 在 Node 里加载连接面的客户端入口 | 同上 | `ReferenceError: window is not defined` | 2026-09-23T07:35:39Z |
| 宿主侧类型化网关与注册表 | 同上 | 立起来了：`ctx.typert`、`ctx.typertGateway` 均为 object | 2026-09-23T07:35:39Z |

结论：**客户端的调用方只随浏览器 bundle 分发**，在没有浏览器内核的进程里不可加载；因此"插件客户端调用 controller 并收到 watch 增量"这一端到端能力**未观测到**。另有两个结构性缺口：

1. **生成物缺失**：流式/类型化 Remote 需要构建期生成物描述符；本机宿主运行时里没有**生成物生成器包**（角色：从类型面产出 `./typert` / `./remote` 两个面；对 `$HOST_RUNTIME/node_modules` 按该角色搜索无输出）。通用 `ctx.connection.rpc` 面不需要生成物，但它只给到"调用/应答"，流式增量仍要 `ctx.remote.$stream()`。
2. **插件包产不出客户端 bundle**：见 §6.3。

### 5.4 结论

问题三的答案是**未观测到**。宿主半边（查询、命令、认领生命周期）已实测；客户端半边与 watch 增量停在"机制存在"，缺的是浏览器载体与生成物，而这两样在本层的时间盒与"不新增依赖"约束下都补不上。

## 6. 问题四：插件能否在一个 slot 里挂载一个页面

**答案：未观测到**

### 6.1 机制存在

- 客户端插槽注册面：`ctx.slots.inject(slotName, () => ctx.slots.register(descriptor, Component))`。宿主运行时里 36 个已安装客户端 bundle 命中 `ctx.slots.inject`：
  ```bash
  grep -rl "ctx.slots.inject" "$HOST_RUNTIME"/node_modules/*/*/lib/client.js | wc -l   # → 36
  ```
- **页面**（而不是一个小动作按钮）的挂法是根作用域的 `main` 键控插槽。已安装插件里有一个真实样例：`slots.inject("main", function* () { yield slots.register({ name: "main", key: "<panel-id>", children: {…} }, Panel) })`，配合 `ctx.layout.selectPanel(id)` 切换；布局服务面是 `selectPanel(id)` / `beginNavigation()` / `toggleSidebar()` / `openRightbar()` / `closeRightbar()`。
- 宿主在**客户端 bundle 面**未观测到 URL 路由（这条是机制存在的反面证据，用于 §8 的 #130 判断）：
  ```bash
  grep -rln "history.pushState\|location.pathname\|createBrowserRouter\|useNavigate" "$HOST_RUNTIME"/node_modules/*/*/lib/client.js | wc -l   # → 0
  ```
  导航模型观测到的是"面板选择"，不是"URL 路由"。**这条负向结论的范围要说清**：它只覆盖 `lib/client.js` 这一面；§6.2 找插槽注册表时用的是 `dist/assets/index-*.js`（宿主外壳的已构建 SPA 资产），说明客户端代码还有第二个分发面，本命令没有覆盖它。因此 §8 对 #130 的处理是"登记待复核"，不是"宿主没有路由面"。

### 6.2 承载能力未观测到

| 尝试 | 命令 | 结果 | 时间（UTC） |
|---|---|---|---|
| 在 Node 里加载插槽注册表所在的客户端模块 | `HOST_RUNTIME=<宿主运行时根> node apps/harness-plugin/.spike/probe-b.ts` | 模块不存在（`Cannot find module '<宿主运行时>/node_modules/<作用域>/<插槽注册表包>/lib/client.js>'`）——**它不是运行时依赖** | 2026-09-23T07:35:39Z |
| 在 Node 里加载布局插件客户端面 | 同上 | `ReferenceError: window is not defined` | 2026-09-23T07:35:39Z |
| 在 Node 里加载渲染面插件客户端面 | 同上 | `ReferenceError: window is not defined` | 2026-09-23T07:35:39Z |
| 插槽注册表在哪 | `grep -l "slots" "$HOST_RUNTIME"/node_modules/*/*/dist/assets/index-*.js` | 命中宿主外壳的已构建 SPA 资产 | 2026-09-23T07:35:40Z |

即：**插槽注册表只随宿主外壳的已构建 SPA 分发**，它既不是可 import 的运行时包，也不在 `node_modules` 里；要观测"我们的页面挂进插槽"，必须在浏览器里跑起外壳 + 我们的客户端 bundle。

### 6.3 为什么本层补不上这一半

| 缺口 | 证据 |
|---|---|
| 客户端 bundle 必须由构建步骤产出 | 一个已安装客户端插件的清单：`{hasDshClient: true, platform: "web", hasClientExport: true, buildScript: "tsdown"}` |
| 本仓库的插件包两样都没有 | `apps/harness-plugin/package.json`：`{hasDshClient: false, hasClientExport: false, hasBuildScript: false, scripts: null}` |
| 渲染需要 React 与浏览器 DOM | 客户端 bundle 是 `window.__ModuleLoader__.load({ id, factory })` 形状，共享模块表（React 等）由外壳注入 |

本层禁止新增依赖（批次硬约束），所以既不能引入打包器产出 `lib/client.js`，也不能把 React 拉进来。**结论：问题四在当前仓库状态下无法观测，且它的两个前置条件（客户端 bundle 构建步骤、宿主外壳运行实例）都不是本层能补的。**

### 6.4 结论

问题四的答案是**未观测到**。"挂一个页面进插槽"这条能力完全落在浏览器侧：注册面存在、真实样例存在，但承载它的载体（宿主外壳 + 我们的客户端 bundle）在本层无法立起来。

## 7. 裁决

> ## `fallback-web`
>
> **决定它的答案：问题四**（插件能否在一个 slot 里挂载一个页面）——**未观测到**。问题三的客户端半边与 watch 增量同样未观测到，是第二个独立支撑。

**按预先写死的规则**（计划 `Design / Spec` §4）：四个问题里任何一个缺"承载能力已实测"，裁决就是 `fallback-web`。当前状态是：

| 问题 | 机制存在 | 承载能力已实测 | 答案 |
|---|---|---|---|
| 1 · 宿主侧模块用 `packages/storage/sqlite` 建库并构造 controller | 是 | 否（组合那一步实测失败，缺口在仓库侧的 SQLite `Storage` 实现） | 未观测到 |
| 2 · provider 经宿主句柄拿凭据，密钥不入库 | 是 | 否（句柄解析与"不入库"已实测；没有消费凭据的 provider） | 未观测到 |
| 3 · 插件客户端经宿主 transport 调用查询/命令并收 watch 增量 | 是 | **一半**：宿主半边已实测；客户端半边与 watch 增量否 | 未观测到 |
| 4 · 插件在一个 slot 里挂载一个页面 | 是 | 否（需要宿主外壳实例 + 客户端 bundle 构建步骤） | 未观测到 |

**为什么点名问题四**：MVP-1 的用户可见定义就是"真实用户在一个页面里看见真实项目"。问题四是这四个问题里**唯一直接决定"页面能不能出现在宿主里"**的那一条；问题三决定页面里的数据能不能动，问题一、二决定数据从哪来。前三个即使全部观测到，问题四不成立时 MVP-1 仍然只能跑在独立 Web 壳里。所以裁决由问题四决定，问题三独立地给出同一结论。

**这个裁决不主张什么**（重要）：

- 它**不**主张宿主承载不了。四个问题里三个的缺口在**本仓库侧**：SQLite 的 `Storage` 实现不存在（§3.3）、provider 全是占位（§4.3）、插件包没有客户端 bundle 与构建步骤（§6.3）。
- 它**不**主张宿主 transport 不行。宿主半边的查询与命令都实测通过了（§5.2）。
- 它主张的是：**在 2026-09-23 的观测窗口内，没有任何一条"页面出现在宿主里"的路径被跑通**，因此 MVP-1 不能按 `embed` 排期。按 issue #125 的规则，"观测不到承载能力时，裁决是 `fallback-web`"。

**要让裁决翻成 `embed`，需要补上什么**（供后续复核）：

1. `packages/storage/sqlite` 实现 `Storage` 能力契约（#132 的前置，业务表见 #27/#28）。
2. 至少一个真实 provider 消费宿主句柄（#133 / #70）。
3. `apps/harness-plugin` 有一个可被宿主加载的客户端 bundle（构建步骤或手写 bundle），并把它装进一个真实宿主外壳实例。
4. 在浏览器里观测到：一个页面出现在 `main` 键控插槽里，且它经宿主 transport 读到了 controller 的查询结果、收到了至少一条 watch 增量。

## 8. 对 epic #124 的影响

按 issue #125 的验收标准，裁决为 `fallback-web` 时必须在 #124 上留一条评论，点名**所有**范围会变的子 issue，且必须在任何子 issue 开工之前发出。**这条时限要求没有被满足**（见下方订正），但"点名所有范围会变的子 issue"这条已满足，且评论的内容不因时序而改变。

**人类伙伴的处置**（2026-09-24）：@SingularityKChen 显式决定保留 `Closes #125`、勾选全部 4 条 AC，并**豁免** AC #4 的时序子句——该子句按原文永久不可达（评论不可能早于已经发生的 #158 创建）。豁免人、日期与范围记在计划 `Decision Log` D10。豁免**不免除事实陈述**：本节保留"时限要求没有被满足"的原记录，因此"AC #4 已勾选"应读作"内容要求已满足 + 时序子句经人类伙伴豁免"，而不是"时序要求已达成"。

**已发出**：<https://github.com/SingularityKChen/harness-projects/issues/124#issuecomment-5790974840>，`created_at = 2026-09-23T07:39:04Z`（复核命令见下）。

**排序声明及其订正**（这一条被对抗验证证伪；原评论原文保留在 #124 上，订正以可见的追加回复发出）：

原评论声明了"posted before any sub-issue of this epic starts"。按 `docs/development/workflow.md` §1 对批次起点的定义（创建 draft PR），**这条声明在墙钟意义上不成立**：

```bash
gh api repos/SingularityKChen/harness-projects/issues/comments/5790974840 --jq '.created_at'
# → 2026-09-23T07:39:04Z
gh pr view 158 --json createdAt,baseRefName -q '.createdAt, .baseRefName'
# → 2026-09-23T07:30:11Z（创建时 base 见下一行证据；现为 test/harness-host-spike）
gh api repos/SingularityKChen/harness-projects/issues/158/events --jq '.[] | "\(.created_at) \(.event)"'
# → 2026-09-23T07:30:12Z milestoned / labeled …
#   2026-09-23T07:52:32Z head_ref_force_pushed
#   2026-09-23T07:55:57Z base_ref_changed
```

- #158（子 issue #128 的 PR）创建于 **2026-09-23T07:30:11Z**，比本评论早 **8 分 53 秒**。
- 创建时它**还没有**以本分支为 base：`base_ref_changed` 在 **07:55:57Z**；而本分支的第一次提交是 07:32:30Z（f40370d）、PR #162 创建于 07:32:55Z——07:30:11Z 时 `test/harness-host-spike` 在远端还不存在。
- #158 的 head 在 **07:52:32Z** 被 force-push，它当前三个提交的 committer 时间是 07:49:14Z / 07:49:14Z / 07:51:42Z——都在本评论之后。
- **能**成立的表述：本评论早于该 epic 各子 issue **今天存在的全部实现提交**，也早于 #128 被叠到本分支之上。**不能**成立的表述："在任何子 issue 开工之前"。
- 订正回复：<https://github.com/SingularityKChen/harness-projects/issues/124#issuecomment-5791408921>，`created_at = 2026-09-23T08:14:42Z`。
- 裁决本身与本节的范围判断不受影响：它们来自 §3–§6 的观测，不来自排序。

**判据**：一个子 issue 的**交付物、验收标准或所属外壳**三者之一发生变化，才算范围变化；仅仅"由谁接线"变化的另列。

| 子 issue | 判断 | 理由 |
|---|---|---|
| **#135** `feat(apps): mount the project pages and the connect flow in the Harness plugin` | **范围变化** | 所属外壳从宿主插件变成独立 Web 壳：In scope 的"Plugin registration and the navigation entry / Slot mounting / The client transport chosen by #125"整体改写；Out of scope 的"The standalone web shell"反转成交付物；验收项"Inside the host, steps 1–5 …"在宿主里不成立。另外 `apps/web` 目前只是 `packageId` 占位，独立壳还要自带"跑起权威侧 + 服务 SPA"这一层，是净增范围 |
| #132 `feat(controller): compose the host from provider bindings and the SQLite store` | 不变（对措辞有一处说明） | 交付物是权威侧组合根（按 implementation key 选实现、启动跑迁移、经注入的服务解析句柄、启停生命周期、同库重启读回）。这些与外壳无关。只有 Out of scope 里"transport to the plugin client"的**消费者**从插件客户端变成 Web 壳客户端——接线变化，不是范围变化。**措辞说明**：它的 In scope 首条写 "a **host** composition root"、另一条写 "resolved through an injected **host** service"。在本仓库的词汇里 "host" 指**权威状态侧**（`AGENTS.md` §1.1 不变量 7 的 "Host 拥有权威状态"），不是"插件宿主"；`fallback-web` 下这个组合根仍然存在、仍然在权威侧，只是它服务的客户端从插件客户端变成独立 Web 壳的客户端。因此按本节判据它落在"范围不变"一侧；若人类伙伴认为"组合根的落点会移到 `apps/web`"应当算范围变化，这一条需要改判 |
| #128 `feat(ui-model): derive the projects home, work item list and detail from the client model` | 不变 | React-free 的展示结构层，不 import React、不 import provider、不接触 transport；`embed` 与 `fallback-web` 都不改它的交付物 |
| #129 `feat(ui): render the work item list with loading, stale and permission states` | 不变 | `packages/ui` 的组件与页面，外壳无关 |
| #130 `feat(ui): render the unified work item detail drawer read-only` | 不变（有一处待复核） | 交付物与验收不变。但它的 In scope 含"a deep-link route `/projects/:projectId/items/:itemId`"，而观测到宿主导航是面板选择，且 `lib/client.js` 面未命中 URL 路由符号（§6.1；该负向结论**未**覆盖 §6.2 用到的已构建 SPA 资产面，所以"宿主没有路由面"不成立）。`apps/web` 自带路由，这条在 fallback 下更自然；若日后裁决翻成 `embed`，必须先确认宿主侧的路由面 |
| #131 `feat(ui): create a workspace and connect a GitHub Project from the projects home` | 不变 | 交付物是 projects home 与两个流程及其结构化错误渲染，外壳无关 |
| #126 `feat(storage): add connector accounts and binding configuration to the v1 model` | 不变 | 数据模型层 |
| #127 `feat(core): connect a GitHub account and bind a planning project to a workspace` | 不变 | core 命令层 |
| #133 `feat(providers): read GitHub Project field definitions, status options and iterations` | 不变 | provider 层 |
| #134 `feat(core): reconcile a planning binding on a schedule and on explicit refresh` | 不变 | core 层 |
| #70 `feat(providers): add the GitHub Projects read projection` | 不变 | provider 层 |
| #125（本 issue） | 不变 | 它产出这条裁决本身 |

**结论：#135 是唯一范围会变的子 issue。**

## 9. 未观测到清单与复核方法

| # | 未观测到的东西 | 卡在哪 | 复核方法 |
|---|---|---|---|
| 1 | controller 跑在 `packages/storage/sqlite` 上 | 仓库没有 SQLite 的 `Storage` 实现 | `git grep -n "implements .*Storage" -- '*.ts'`（只扫受跟踪内容；裸 `grep … .` 会走进 `.worktrees/` 误报，见 §3.3 的取法纪律）。**触发条件**：`main` 上出现一个**完整**的 `Storage` 实现后，把它传给 `composeCore({ storage })` 重跑 §3.2。只交付地基面、其余方法抛 `not implemented` 的实现**不算触发**——重跑会因未实现方法失败，原因与 §3.2 记录的组合失败无关 |
| 2 | provider 通过句柄拿到凭据 | 没有消费凭据的 provider | 任一 provider 实现落地后，把 §4.2 的解析值注入它并断言句柄是库里唯一引用 |
| 3 | 插件客户端调用 controller 的查询与命令 | 客户端调用方只随浏览器 bundle 分发 | 在真实宿主外壳实例里加载插件客户端 bundle，断言 §5.2 的两条调用在浏览器里得到同样的 `result` |
| 4 | 客户端收到 watch 增量 | 需要流式 Remote 的生成物描述符 + 浏览器载体 | 生成物产出后，用 `ctx.remote.$stream()` 订阅，断言"开场快照 + 至少一条增量" |
| 5 | 插件把页面挂进 `main` 插槽 | 需要客户端 bundle 构建步骤 + 宿主外壳实例 | 装上 `apps/harness-plugin` 的客户端 bundle，在浏览器里断言页面渲染且 `ctx.layout.selectPanel(id)` 能选中它 |

## 10. 参考

- `docs/exec-plan/completed/2026-09-24-harness-host-spike.md` —— 本层的 spec + plan，含两半判据与先写死的裁决规则（验收后归档）
- issue #125（本层验收标准）、epic #124（上游范围与"裁决先于其它子 issue"的约束）
- `AGENTS.md` §1.1 不变量 7（权威状态在宿主侧）、§2（依赖方向）、§7（发布面）
- `packages/controller/src/index.ts`、`packages/client/src/transport.ts`、`packages/core/src/context.ts`、`packages/storage/sqlite/src/index.ts`、`packages/capabilities/src/storage.ts`
- `apps/harness-plugin/package.json`、`apps/web/package.json`
