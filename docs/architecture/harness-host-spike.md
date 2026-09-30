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

## 11. 复探（issue #225）：仓库外插件包装进一次性 profile 之后

> 状态：证据与裁决（Batch 5 定稿，Batch 6 验收时做了保守方向的订正，订正清单见计划的 `Surprises & Discoveries`；观测之后补记 §11.10（宿主 `0.2.0-rc.2` 的静态差异）与 O3.9 的订正，都不改变 §11.3 的判定与 §11.6 的裁决；§11.8 里 #226 评论的链接与时间在发出评论之后回填）。
> 日期：2026-09-29（观测时间戳取自运行机器的时钟，均为 UTC）。
> 本节只追加，不改 §1–§10 的任何字节。§7 记录的 `fallback-web` 是 #125 当时按观测强度得出的裁决，原文保留；**本节的裁决是当前有效裁决**。

### 11.1 范围与口径

1. **范围**：重跑 §1 的问题 2、3、4（凭据按操作解析、插件客户端到达 controller、页面挂进插槽）。#125 当时没有启动宿主，也没有装插件，所以三个问题停在"机制存在"。本节把插件装进**一次性**宿主 profile，在真实宿主进程与真实浏览器里观测。
2. **§1–§10 不改**。第 8 行写"不含宿主产品名"，它出自 #125 计划自己的 Global Constraints，并不来自 `AGENTS.md` §7（§7 只列五类目）；main 上和公开 issue #225–#230 里已经写有宿主的公开标识符。本节沿用放开后的口径：可以写 `dsh` CLI、`dsh.*` manifest 键、`@deepseek-ai/*` 公开包名、官方文档 URL 与公开版本号；`$HOST_RUNTIME`、`$SCRATCH`、`$DSH_HOME` 的真实值、端口、令牌、本机用户名与主机名一律不写。
3. **§5.2 的适用范围收窄**：§5.2 的 `intercept` 观测是在没有网关的裸 Context 里做的。web profile 的网关已占用 `/api` 共享通道上唯一的拦截器（M7），所以 §5.2 的结论**不能**搬进 web profile。
4. **裁决只跟 S3**：S1 静态读到、S2 普通 Node 进程里实测，都只写进记录，不参与判定。判定规则、强度定义与捷径规则见 `docs/exec-plan/completed/2026-09-29-harness-plugin-reprobe.md` 的预注册块（`verdict-rule`）。

### 11.2 观测环境

- 预注册：`02fc3879e2a18e607197272427c8996403d3fee2` @ 2026-09-29T06:36:56Z
- T0：2026-09-29T06:45:46Z
- 上面的 SHA 是 T0 之前推送的原始预注册提交，时间锚是 draft PR #238 的 `createdAt`（2026-09-29T06:38:59Z）。Batch 6 把分支变基到新的 `origin/main` 之后，同一内容的提交 SHA 改变（内容与 author time 不变，`git range-diff` 逐个为 `=`），rebase merge 进 main 时还会再变一次；按内容复核预注册块用计划 `Validation and Acceptance` 第 7 行的命令

| 项 | 值 |
|---|---|
| 宿主运行时 | `@deepseek-ai/dsh` `0.1.7-rc.2`；`$HOST_RUNTIME` 是 npx 缓存里的安装根，路径不入库 |
| Node / pnpm | Node v26.10.0；`PATH` 上的 pnpm 12.5.1（M1 说明它与"10.28.2"的关系） |
| 宿主用户数据根 | 系统临时目录下的一次性目录（`DSH_HOME=$SCRATCH/home`），所有宿主命令只经守卫函数 `dsh_s` 执行；`DSH_TELEMETRY_DISABLED=1` |
| 宿主实例 | scratch 宿主以 `dsh web --no-open --port 0` 启动，只监听回环地址上的一个临时端口；启动前后各做一次 `lsof -nP -iTCP -sTCP:LISTEN`，本机真实宿主实例占用的两个端口未被触碰 |
| 探针包 | 手写纯 JS 插件包 `hp-reprobe@0.0.0`（无打包器、无 `dependencies`），`pnpm pack` 得到 tarball，经 `dsh plugin --profile web add` 装入；探针只在 `$SCRATCH`，不入库 |
| 探针 peer | `@deepseek-ai/cordis ~4.0.4`；`@deepseek-ai/dsh-{api-gateway,credentials,home-paths,typert-protocol,typert-registry}` 精确写 `0.1.7-rc.2`；没有使用 `allow-version`，也没有使用 `--accept-risk` |
| 契约来源 | **手写** strict 描述符，形状取自公开类型 `InvocationDescriptor`（M6）；宿主与浏览器两侧共用同一段文本 |
| 时间来源 | 所有时间取自 jsonl / host.log 里由 `date -u` 或 `new Date().toISOString()` 生成的值，不手打 |

**探针构建版本**（探针源码不入库；下面列出每一版与上一版的差别，以及哪些观测行来自哪一版）：

| 版本 | 安装 / 启动（UTC） | 与上一版的差别 | 用于 |
|---|---|---|---|
| 常量版 | 06:56:06Z / 06:56:36Z | 宿主方法只返回常量，不装配 controller | 链路预演，不计入判定 |
| A（完整版） | 11:14:51Z / 11:15:14Z | 装配 controller（SQLite、fake providers、固定 binding id）；客户端在 `inject` 回调里取 `remote.hpReprobe`（M17） | O0.1、O0.2、O0.3、O3.1–O3.5、O3.8、O4.1–O4.3 |
| B | 11:27:50Z / 11:28:00Z | 在 A 上加「Credential probe」「Issuer probe」两个按钮、`credentialProbe()` / `issuerProbe()` 的实现，以及流载体失败时的 `stream-carrier-failed` 日志 | O2.1–O2.4、O3.6 |
| C（变异） | 11:35:43Z / 11:35:47Z | 在 B 上把宿主侧各参数的 `parse` 换成恒等函数，并在 host.log 打变异标记 | O3.7 的变异对照 |
| D（恢复） | 11:36:24Z / 11:36:28Z | 在 B 上加一个默认关闭的变异开关（关闭时行为与 B 相同） | O3.7 的恢复对照，之后的收尾核对 |

O0.1、O0.2 取自 A。B、C、D 是在 A 的决定性观测（O0.3、O3.1–O3.5、O4.1–O4.3）完成之后才安装的；B 只追加了按钮与日志，没有改动那些观测用到的调用路径，C、D 只在变异开关上不同于 B。决定性行 O2.1–O2.3 取自 B：B 同样先 `remove` 再 `add` 装入同一个 scratch profile，没有使用 `allow-version` 或 `--accept-risk`；它的数字退出码与 O0.1 一样没有归档，归档日志以 `Done … using pnpm v12.5.1` 结束、没有 `plugin command failed`，随后启动的宿主打出 `ready`，并执行了只有 B 才有的 `credentialProbe()`（O2.1 的 `credential` 行）。

**链路预演（不计入判定）**：探针先以"宿主方法只返回常量"的版本走通链路：2026-09-29T06:55:13Z 第一次安装失败（M13），补上 PATH 垫片后 06:56:06Z 安装成功，06:56:36Z 宿主打出就绪行，06:57:25Z 经网关的一元调用 `hpReprobe/snapshot` 取回常量。随后停掉宿主，换成装配 controller 的完整版，删除并重装。

**计时口径的事实**：预演在 T0 之后 12 分钟内通过。会话在 2026-09-29T06:58Z 至 11:02Z 之间因额度耗尽中断，其间没有任何探针操作。O0 的三条判定行都取自恢复之后：O0.1、O0.2 取自重装的完整版（首次 11:03Z，取最后一次尝试的是 11:14Z 至 11:15Z 探针修复后的重装），O0.3 取自浏览器尝试 2（11:17Z；常量版预演没有打开浏览器，不覆盖 O0.3）。所以三条的日历时间都晚于 O0 子预算（T0 + 3h）的字面截止。**人类伙伴 2026-09-29 裁定**：中断区间没有任何探针操作，不计入 O0 的 3 小时子预算，两个工作日的总时限同样扣除这段时间；本节按口径 B 计时，裁定登记在计划的 `Decision Log` D17。

**这项裁定是在观测之后作出的**：§11 草稿的本地 WIP 历史里，11:08:49Z 的版本仍写"是否把中断时间计入子预算，由人类伙伴……裁定；本节不自行改判"，11:13:11Z 的版本已写入裁定。所以裁定落在这两个时刻之间，晚于恢复后的 O0.1、O0.2（11:03Z）；它与浏览器尝试 1 的 O0.3（11:10Z）孰先孰后，WIP 历史分辨不出。预注册块的文字没有改动，但这项裁定改变了 §2.6 子预算的计时方式，所以按预注册块 §2 的要求在这里显式写明：**规则在观测后被修改**（计时口径，由人类伙伴批准）。按口径 A，O0.3 在子预算内没有得到结果（O0.1、O0.2 即使计入常量版预演也一样），按 §2.6 第 3、4 条记为"未观测到"，裁决会是 `fallback-web`（Q4）。中断区间与两种口径的时间都如实保留如下（都取自 host.log / 命令输出里的时间戳）：

| 口径 | O0 子预算截止（T0 + 3h） | O0.1 / O0.2 / O0.3 判定行（11:14:51Z / 11:15:15Z / 11:17:35Z）距 T0 |
|---|---|---|
| A：日历时间，中断计入 | 2026-09-29T09:45:46Z | 4h29m05s / 4h29m29s / 4h31m49s，都晚于截止 |
| B（**采用**）：只计工作时间，中断（最后一次操作 06:57:52Z 到恢复后第一次操作 11:02:45Z，共 4h04m53s）不计入 | 折算后的截止为 2026-09-29T13:50:39Z | 折算后 24m12s / 24m36s / 26m56s，都早于截止 |

常量版预演的 O0 链路（06:55:13Z 首次安装失败，06:56:06Z 安装成功，06:56:36Z 就绪行）在两种口径下都早于截止。

**宿主侧预演（不是 O 行，不参与判定）**：在交给浏览器之前，用 curl 与一个 Node WebSocket 客户端在宿主侧走过同一条 typed remote：`POST /api/hpReprobe/snapshot` 取回基线（revision 1、5 个实体）；经 `/api/remote.mux` 打开 `hpReprobe/watch`，先收到 baseline，再在 `applyPlanningStatus` 之后收到 `previousRevision = 1`、`revision = 2` 的 delta；取消后 host.log 出现 `watch closed`（2026-09-29T11:07:15Z 起）。它只用来避免把浏览器步骤浪费在宿主半边的缺陷上；预演使项目库的 revision 从 1 前进到 2。客户端半边（`$mount`、`$stream`、插槽挂载）在浏览器里之前没有任何观测。

### 11.3 观测表

结果只写"已观测到 / 未观测到"；强度定义见预注册块。判据栏是预注册的判据，命令栏是实际执行的命令或动作（路径、令牌、端口以占位符表示）。

| ID | 问题 | 判据 | 命令或动作 | 结果 | 强度 | 时间（UTC） |
|---|---|---|---|---|---|---|
| O0.1 | Q4（前置） | 在一次性 `DSH_HOME` 下 `dsh plugin --profile web add <tarball>` 退出码为 0，且没有使用 `allow-version` / `--accept-risk` | `dsh_s plugin --profile web add <scratch>/hp-reprobe-0.0.0.tgz`（先 `remove` 再 `add`，因为在同一路径下换成同名同版本的新包时，pnpm 判为"锁文件已是最新"而跳过安装，M14） | 已观测到 | S3 | 2026-09-29T11:14:51Z |
| O0.2 | Q4（前置） | scratch 宿主启动后，探针宿主半边在 host.log 打出就绪行，且启动审计里没有以探针条目为源的失败 fiber | `dsh_s web --no-open --port 0`（后台，输出到 host.log） | 已观测到 | S3 | 2026-09-29T11:15:15Z |
| O0.3 | Q4（前置） | 浏览器里探针 client bundle 的 factory 执行，console 出现以模块 id `hp-reprobe` 为源的就绪行 | 用 Browser 窗格打开 `<scratch-url>`（宿主再次弹出 API key 对话框，只点 Configure later，没有输入任何密钥）；`read_console_messages`，pattern `hp-reprobe`。**取最后一次尝试（尝试 2）** | 已观测到 | S3 | 2026-09-29T11:17:35Z |
| O2.1 | Q2 | 宿主半边在**操作内**调用 `ctx.credentials.resolve(credentialRef('HP_REPROBE_ISSUER_KEY'))` 拿到值，而不是在 apply 时预取；日志只打印 `source` 和 sha256 的前 8 位 | 凭据存储文件里放测试值 v1（本会话生成的一次性值，35 字节，mode 600；sha8 `500adc6c` 在页面操作之前就写下）；在页面上点「Credential probe」一次（op1），它走 typed remote 调用探针宿主半边的 `credentialProbe()`。静态上，`resolve` 只出现在 `credentialProbe()` 与 `issuerProbe()` 两个方法体里，构造函数与 apply 路径里没有 | 已观测到 | S3 | 2026-09-29T11:30:22Z |
| O2.2 | Q2 | 两次操作之间，把凭据值从 v1 改成 v2，不重启宿主，也不重载插件；第二次操作得到的摘要等于 sha256(v2) 的前 8 位 | **直接改 scratch 凭据存储文件**（`$DSH_HOME/.credentials.yaml`，原地改写，inode 与 mode 600 不变），没有使用 `ctx.credentials.set`；然后点「Credential probe」第二次（op2）。宿主进程在两次操作之间一直是同一个 PID，host.log 里两次操作之间没有 `disposed` 或新的 `ready` | 已观测到 | S3 | 2026-09-29T11:30:41Z |
| O2.3 | Q2 | 同一次操作里经 controller 执行一条会写库的命令，写入宿主拥有目录下的 SQLite 项目库；操作后库文件的 mtime 前进；库文件及其 `-wal`、`-shm` 按字节扫描，不含 v1、v2 的原文，也不含它们的 base64 形式 | `credentialProbe()` 在 `resolve` 之后经 `controller.commands.applyPlanningStatus` 写库，并把库文件三个路径的 mtime 打进 host.log；`scan-db.sh` 三次按字节扫描（操作前、op1 之后轮换之前、op2 之后），每次先做阳性对照（植入 v1 原文与 v2 base64，必须计数为 1） | 已观测到 | S3 | 2026-09-29T11:30:55Z |
| O2.4 | Q2（非决定项） | 用 v1 在操作内构造 `HumanExecutionProvider` 并 `startRun` 得到 ref1；轮换到 v2 之后，用 v2 构造的实例执行 `getRun(ref1)`，记录它被拒绝的确切错误 | 页面上点「Issuer probe」：探针宿主半边在方法内 `resolve` 当前凭据，经 `createHumanExecutionProvider({ bindingId, issuerKey })`（`file:` URL 导入工作树的 `.ts` 源码）构造 provider，`startRun` 发引用，并对上一次发出的引用 `getRun`；同一次操作里再用同一个 provider 读回刚发出的引用作对照。两次点击之间做 O2.2 的轮换 | 已观测到 | S3 | 2026-09-29T11:30:43Z |
| O3.1 | Q3 | 浏览器里，插件客户端发起一次查询：页面显示的 revision 与实体数，等于同一次运行里 host.log 打出的值 | 页面挂载时自动查询；`read_page`、`read_console_messages`；对照 host.log。**尝试 2** | 已观测到 | S3 | 2026-09-29T11:17:44Z |
| O3.2 | Q3 | 浏览器里，插件客户端发起一次命令：对一个未完成的工作项执行 `applyPlanningStatus`，返回 `local_only`；之后的查询显示 revision 加 1 | 点按钮 `Trigger command`，再点 `Query snapshot`；读 host.log 与 console。**尝试 2** | 已观测到 | S3 | 2026-09-29T11:18:04Z |
| O3.3 | Q3 | 同一个流句柄上，先收到 baseline（revision R）；订阅之后由 O3.2 触发变更，再收到一条 delta，`previousRevision = R`、`revision = R + 1`；期间页面不刷新 | console 的 `stream-baseline` 与 `stream-delta`；对照 host.log 的 `watch open` 与 `watch event`。**尝试 2** | 已观测到 | S3 | 2026-09-29T11:18:03Z |
| O3.4 | Q3 | 用 `read_network_requests` 判定线缆：typed remote 表现为 `/api` 上的 POST 加上 `/api/remote.mux` 的 WebSocket；host web route 表现为 `/hp-reprobe/<endpoint>` 的 POST 加上 `/api/hp-reprobe/watch` 的 GET 流 | `read_network_requests`（pattern `hpReprobe`）取 POST 一半；`read_network_requests` 不列 WebSocket，所以另在页面里用 `javascript_tool` 包装 `WebSocket.prototype.send`（只读记录、原样转发），切到别的面板再切回，读 `window.__hpWs`。**尝试 2** | 已观测到 | S3 | 2026-09-29T11:23:21Z |
| O3.5 | Q3 | 所命名 transport 的每个入口，不带认证 cookie 返回 401，伪造 `Host` 头返回 403；带认证时可达 | `curl -s -o /dev/null -w '%{http_code}'` 对 `POST /api/hpReprobe/snapshot` 与 `GET /api/remote.mux`（加 `Connection: Upgrade`、`Upgrade: websocket` 头）；分别不带 cookie、伪造 `Host: evil.example`（带与不带 cookie 各一次）、带 cookie。对照：带 cookie 的 `POST /api/hpReprobe/nosuch` | 已观测到 | S3 | 2026-09-29T11:16:34Z |
| O3.6 | Q3（非决定项） | 停掉 scratch 宿主再重启，页面进入「重连中」并重拉 baseline | 页面保持打开、不刷新。停宿主（SIGTERM，优雅停机）后读页面与 console；随后用**同一个回环临时端口**重启（`--port <上一次的端口> --no-open`，`DSH_HOME` 仍是 scratch；重启前 `lsof` 确认端口空闲、只监听回环——主会话决定的一次性偏离，计划 `Decision Log` D18，见 §11.5），再读 console 与页面；用 Q2 实例的旧 cookie 对新实例做 `curl` | 已观测到 | S3 | 2026-09-29T11:33:24Z |
| O3.7 | Q3（非决定项） | 发一个非法参数，得到 `gateway/input-invalid`；变异对照：把宿主侧的 parse 换成恒等函数后重装，host.log 必须先出现变异标记 `hp-reprobe-mutation=identity-parse`，再看结果翻转，然后恢复 | 用带认证 cookie 的 `curl` 对 `POST /api/hpReprobe/applyPlanningStatus` 发 `entityId` 为空串（另测 `status: bogus` 与缺字段）。变异构建只把描述符里各参数的 `parse` 换成恒等函数，构建时在宿主半边打一行标记；重装（`remove` 后 `add`）、重启；变异构建只发 `entityId` 为空串的那一个请求（另两个会让非法值进入 controller）；最后恢复并重装重测 | 已观测到 | S3 | 2026-09-29T11:36:35Z |
| O3.8 | Q3（非决定项） | 客户端释放流句柄后，host.log 出现 `watch closed`，并且 poll 计数停止增长 | 点侧栏 `Plugins` 离开面板（面板卸载），再点回 `HP Reprobe`；对照 console 与 host.log。**尝试 2** | 已观测到 | S3 | 2026-09-29T11:23:13Z |
| O3.9 | Q3（非决定项） | 仓库外能否获得并运行一个契约生成器（官方文档留下的开放点）；只记是否找到、从哪里来，不影响 transport 资格 | 先查本机宿主运行时与用户级缓存里有没有生成器；再对公开 npm registry 只做元数据查询（`npm view @deepseek-ai/dsh-typert-generator name version --json`），不下载、不安装、不运行 | 未观测到 | S1 | 2026-09-29T11:37:04Z |
| O4.1 | Q4 | client bundle 用 `ctx.slots.inject('main', …)` 注册键控面板 `hp-reprobe`，并用 `sidebar.panellist` 注册入口；入口出现在可访问性树里 | `read_page` 取可访问性树。**取最后一次尝试（尝试 2）** | 已观测到 | S3 | 2026-09-29T11:17:39Z |
| O4.2 | Q4 | 选中入口后，`main` 插槽里出现只读列表，行数等于 O3.1 的实体数；O3.3 的 delta 到达后，被改的那一行在不刷新页面的情况下更新 | 点击「HP Reprobe」，`read_page`；点「Trigger command」后再读。**取最后一次尝试（尝试 2）** | 已观测到 | S3 | 2026-09-29T11:18:03Z |
| O4.3 | Q4 | console 里没有以 `hp-reprobe` 为源的错误 | `read_console_messages`，`onlyErrors`。**取最后一次尝试（尝试 2）**；主会话没有单列这次读取的时刻，时间取同一批读取的 O3.4 时刻 | 已观测到 | S3 | 2026-09-29T11:18:26Z |

**观测摘录**（表格的「结果」栏只写「已观测到 / 未观测到」，具体读数在这里，按 ID 对应；括号里是强度与时间）：

- **O0.1**（已观测到，S3，2026-09-29T11:14:51Z）：退出码 0；`package.json` 的 `dsh.profile.bundles` 被自动追加 `hp-reprobe`；已装入的 `lib/index.js` 与 `lib/client.js` 是修复后的完整版。**取最后一次尝试**：探针修复后的重装（`remove` 与 `add` 都退出 0）；11:03:04Z 的首次完整版安装结果相同，保留。**归档的限制**：11:14:51Z 这次安装的数字退出码 0 是当场终端输出读到的，没有写进归档日志（`install.full3.log`）；间接证据是归档日志里没有 `plugin command failed`，随后的启动加载了探针（O0.2 的就绪行）。11:03:04Z 那次安装的 `exit=0` 已归档
- **O0.2**（已观测到，S3，2026-09-29T11:15:15Z）：host.log 首行是就绪行 `{"probe":"hp-reprobe",…,"event":"ready","mode":"full"}`，随后是 `composed`（`storage: sqlite`，即宿主进程内经 file URL 导入工作树 `.ts` 源码组装 controller 成功；最后一次启动在已有的库上重启，revision 2、5 个实体，M18）；host.log 全文无 error / fail / reject 字样，进程持续存活，探针服务经网关可调用 **取最后一次尝试**：11:15:14Z 的启动；11:03:16Z 的首次启动结果相同（revision 1），保留
- **O0.3**（已观测到，S3，2026-09-29T11:17:35Z）：依次是 `factory`（`mode: full`）11:17:35.613Z、`apply-start`、`remote-mounted`、`slots-registered` 11:17:35.648Z 四行 JSON；尝试 1（11:10:23Z）结果相同，保留
- **O2.1**（已观测到，S3，2026-09-29T11:30:22Z）：host.log `credential`（`source: file`、`sha8: 500adc6c`，11:30:22.914Z）；页面 `credential: source=file sha8=500adc6c write=local_only revision=5`；console `credential` 事件同值（11:30:22.924Z）。host.log 与 console 里都没有值的原文（对 host.log 按字节扫 v1、v2 原文，计数 0）
- **O2.2**（已观测到，S3，2026-09-29T11:30:41Z）：rotate 脚本 11:30:34Z 输出 `rotated in place, mode 0o600, new sha8 c455db23`；op2 的 host.log `credential` 是 `source: file`、`sha8: c455db23`（11:30:41.191Z），页面 `credential: source=file sha8=c455db23 write=local_only revision=6`。`c455db23` 与预先写下的 sha256(v2) 前 8 位一致。宿主没有缓存 v1，文件里的改动在下一次操作里生效
- **O2.3**（已观测到，S3，2026-09-29T11:30:55Z）：mtime 前进：op1 前 `11:28:03.547Z`（B 启动时的组合）→ op1 之后 `11:30:22.920Z`（host.log `credential-write` 的 before / after），op2 之后 `11:30:41.194Z`；库文件大小始终 233472。三次扫描里库文件的 v1 / v2 原文与 base64 计数全为 0，三次阳性对照都通过；`-wal`、`-shm` 不存在（这个库是默认的回滚日志模式，没有 WAL）；宿主拥有目录里只有 `workspace.sqlite`。附带：整个一次性数据根里，含 v1 或 v2（原文或 base64）的文件只有凭据存储文件本身
- **O2.4**（已观测到，S3，2026-09-29T11:30:43Z）：v1 下（11:30:24.984Z）`previous: null`、`started: true`、读回 `ok`；轮换后 v2 下（11:30:43.206Z）读 v1 发出的 ref1：`ok: false`、`code: not_found`、`message: 运行不存在，或该引用不是本签发者发出的`，同一次操作里新发出的引用读回 `ok`。观测到的范围：探针内存里持有的、**没有落库**的 ref1，在轮换后的新 key 下读回 `not_found`，错误码与「运行真的不存在」无法区分。**（S1，按源码推断，未观测）** 已落库的 `providerRef` 同样读不回：`ownRun` 验签失败就返回 `notFound`（`packages/providers/execution-human/src/index.ts:206`、`:217`、`:232`），文件头也写明签发者身份变了，落库的引用路由不回来（第 12 行，ADR-0008）。#228 需要为 issuerKey 的轮换定策略（key 带版本号，或把轮换定义为一次运维事件）
- **O3.1**（已观测到，S3，2026-09-29T11:17:44Z）：页面 `query: revision=2 entities=5`，等于 console 的 `{"event":"query","ok":true,"revision":2,"entities":5}`（11:17:44.910Z），也等于 host.log 的 `{"event":"snapshot","revision":2,"entities":5}`（11:17:44.908Z）
- **O3.2**（已观测到，S3，2026-09-29T11:18:04Z）：页面 `command: local_only (blocked)`；console `command`（`writeState: local_only`，11:18:02.839Z）；host.log `apply`（`writeState: local_only`、`authoritative: false`、revision 3，11:18:02.837Z）；随后页面 `query: revision=3 entities=5`，console 与 host.log 的 revision 也是 3（11:18:04.884Z / 11:18:04.841Z）。**时间取满足判据的最后一条证据**：命令返回 `local_only` 在 11:18:02Z，之后的查询显示 revision 加 1（console 11:18:04.884Z），取后者
- **O3.3**（已观测到，S3，2026-09-29T11:18:03Z）：`stream-baseline`（handle 1、generation 1、revision 2，11:17:44.906Z，host.log 同刻 `watch open` revision 2）→ `stream-delta`（同一个 handle 1、generation 1、`previousRevision` 2、`revision` 3、upserts 1、removed 0，11:18:03.057Z，host.log `watch event delta` 2→3 于 11:18:03.056Z）；页面 `stream revision: 3`；全程只有一条 `factory` 行，页面没有刷新
- **O3.4**（已观测到，S3，2026-09-29T11:23:21Z）：POST 一半（11:18:26Z）：`POST /api/hpReprobe/snapshot` 200、`POST /api/hpReprobe/applyPlanningStatus` 200、第二次 `POST /api/hpReprobe/snapshot` 200，没有任何 `/hp-reprobe/` 或 `/api/hp-reprobe/watch` 请求。WebSocket 一半（补取证）：包装之后收到两帧，套接字路径都是 `/api/remote.mux`：`{"type":"cancel","streamId":"<uuid>"}`（11:23:13.036Z，对应释放旧流）与 `{"type":"open","streamId":"<uuid>","endpoint":"hpReprobe/watch","payload":{"args":{}}}`（11:23:21.659Z，对应新流）。归类：typed remote（unary 走 `/api` 的 POST，流走 `/api/remote.mux` 的 WebSocket）。取证方法的限制：包装是在页面已加载之后才装的，所以第一次 `open` 帧（handle 1，11:17:44Z）没有被它记录；handle 2 的 `open` 帧与 host.log 的 `watch open`（11:23:21.665Z）相差 6ms
- **O3.5**（已观测到，S3，2026-09-29T11:16:34Z）：typed remote 的两个入口：POST 无 cookie 401，伪造 Host 403（带与不带 cookie 都是 403），带 cookie 时 HTTP 200，含义是路由认领了这个端点并把请求交给网关（RPC 结果另看信封）；upgrade 无 cookie 401，伪造 Host 403，带 cookie 101。对照 `nosuch` 为 404，说明路由按端点区分。判据的入口清单按路由列了两个入口；POST 这个入口只用 `snapshot` 一个端点做了负例，同一路由上的其余一元方法（`applyPlanningStatus`，以及 B 里的 `credentialProbe`、`issuerProbe`）没有逐个做负例（§11.9 第 10 行）。「带认证时入口可达」的证据不在这一行，而在 host.log 的 `snapshot` 行与 O3.1–O3.3。`/api` 之外没有探针注册的入口，所以没有裸 `webServer.register` 的路径可以绕开准入 **取最后一次尝试**：探针修复后的宿主上重测，结果相同；11:03:53Z 的首次结果保留
- **O3.6**（已观测到，S3，2026-09-29T11:33:24Z）：停机 11:32:24Z 之后，页面 `stream: reconnecting`；console `stream-carrier-failed`（handle 1）两条：`Remote stream WebSocket closed`（11:32:24.392Z）与 `Remote stream WebSocket failed to open`（11:32:24.848Z）；停机期间浏览器层反复报 `ERR_CONNECTION_REFUSED`（不以 `hp-reprobe` 为源）。重启后（启动 11:33:12Z、就绪 11:33:17Z，host.log `composed` 的 revision 是 7）host.log `watch open`（revision 7）11:33:24.463Z，页面的 console `stream-baseline`（**handle 1 不变、generation 3、revision 7**、5 个实体）11:33:24.465Z，相差 2ms；页面 `stream: open`、`stream revision: 7`；页面全程没有刷新（console 只有 11:29:59.090Z 那一条 `factory`）。`query:` 行仍是停机前手动查询的旧值（revision 4），因为重连后没有再点查询，不是不一致。认证跨重启保留：旧 cookie 对新实例 `POST /api/hpReprobe/snapshot` 返回 200，`/api/remote.mux` upgrade 返回 101。**`generation` 的规则**：它是每一次打开尝试的序号，失败的尝试也算（M20），所以停机后的两次载体失败使它从 1 推进到 3，而不是「重连一次 = 2」
- **O3.7**（已观测到，S3，2026-09-29T11:36:35Z）：**基线**（11:35:17Z）：`entityId` 为空串 → `gateway/input-invalid`（`details.field: entityId`）；`status: bogus` → `gateway/input-invalid`（`details.field: status`）；缺 `status` → `gateway/arguments-invalid`；host.log 没有 `apply` 行，非法值没有到达 controller；错误消息不带 parse 抛出的原因。**变异**：安装的构建里含变异构建的标记；host.log 第 1 行是 `{"event":"mutation","marker":"hp-reprobe-mutation=identity-parse"}`（11:35:47.479Z），排在 `ready` 之前，也早于请求；同一个请求（11:36:06Z）翻转成 `ok: true`、`writeState: failed`，host.log 出现 `apply`（revision 不变，没有写库）——非法值越过了网关。**恢复**：重装后 host.log 没有变异标记，同一个请求与 `status: bogus` 又都是 `gateway/input-invalid`（11:36:35Z）。这说明拦住非法参数的是探针手写的 strict `parse`，网关只负责调用它：契约里 `parse` 写多严，边界就有多严（M6）
- **O3.8**（已观测到，S3，2026-09-29T11:23:13Z）：console `stream-dispose`（handle 1）11:23:13.034Z，包装记录到 `cancel` 帧 11:23:13.036Z，host.log `watch closed`（`polls: 1300`）11:23:13.042Z；此前 host.log 每 5 秒一行 `watch poll`（n=1280、1300），关闭后到新 `watch open`（11:23:21.665Z）之间没有任何 poll 行；新流的 poll 计数从 1300 接着往上（1320 出现在 11:23:26.439Z，即新流 20 个 tick 之后）。页面回来后 `stream-baseline`（handle 2、generation 1、revision 3、5 个实体）11:23:21.712Z
- **O3.9**（未观测到，S1，2026-09-29T11:37:04Z）：获得并运行这一步没有做到：本机运行时里只有 loader / protocol / registry 三个 typert 包，没有生成器，用户级缓存里也没有；公开 npm registry 上**有** `@deepseek-ai/dsh-typert-generator`，最新版是 `0.0.1-rc.1`，与运行时的 `0.1.7-rc.2` 不是同一个版本线，兼容性未知。没有下载或运行它：下载需要另行授权，且它不影响 transport 资格。结论：来源已找到（公开 registry），能否用它为 `apps/harness-plugin` 生成描述符要在 #228 里另行验证。**Superseded by 下面的订正句（2026-09-30，与宿主升级无关）**：上面「最新版是 `0.0.1-rc.1`、与运行时不是同一个版本线」不准确。当时的查询只读了 `latest` 标签对应的 `version`；`latest` 停在陈旧的 `0.0.1-rc.1`，而同一版本线的 `0.1.7-rc.2`（2026-09-24T14:19:35Z 发布，早于复探）与 `0.2.0-rc.2`（`next` 标签）都存在，导出 `.` 与 `./tsdown`（`npm view @deepseek-ai/dsh-typert-generator dist-tags time exports --json`，只查元数据，2026-09-30T01:19Z）。仓库外能否获得并运行它仍未验证，O3.9 的结果与强度不变
- **O4.1**（已观测到，S3，2026-09-29T11:17:39Z）：侧栏里有 button「HP Reprobe」；尝试 1（11:10:45Z）结果相同，保留
- **O4.2**（已观测到，S3，2026-09-29T11:18:03Z）：region「hp-reprobe panel」里 list「entities」有 5 个 listitem（`redacted \| unknown \| (untitled)`、`work_item \| in_progress \| 规划项 issue-1`、`change_request \| in_progress \| 变更 pr-7`、`work_item \| done \| 规划项 issue-4`、`work_item \| todo \| 规划项 issue-2`），行数 5 等于 `query` 显示的 entities=5；触发命令后 `work_item \| blocked \| 规划项 issue-1` 在原位更新，页面没有刷新（console 只有一条 `factory`）。尝试 1（11:11:07Z）里同一步失败，见「尝试记录」。**时间取满足判据的最后一条证据**：行数 5 在 11:17:48Z 读到；delta 到达（console 11:18:03.057Z）之后被改的一行原位更新，这次读取没有单独的时间戳，取 delta 的时刻
- **O4.3**（已观测到，S3，2026-09-29T11:18:26Z）：只读 error 级消息为空，没有 `stream-error`、`apply-error`；尝试 1（11:11:05Z）里有错误，见「尝试记录」

**尝试记录**（观测行按「取最后一次尝试」的规则更新；旧尝试保留在这里，不删除）：

- **尝试 1**（浏览器由主会话的内置 Browser 窗格执行，视口 1280×900，时间取主会话 `date -u`）：O0.3 与 O4.1 通过；面板挂进了 `main` 插槽，但 O4.2、O4.3 失败，O3.1–O3.4 没有到达。
  - 现象：console 里 `{"event":"stream-error","handle":1,…}` 出现在 11:11:05.583Z，消息是 `RemoteError: cannot get property "remote.hpReprobe" without inject`；同时有一条 `Uncaught (in promise) Error`，同一消息，堆栈落在合并脚本里读 `remote.hpReprobe` 的函数，再上溯到 React 渲染栈。`read_network_requests` 的 `/api` 里没有任何 `/api/hpReprobe/*` 请求，`remote.mux` 上也没有 `hpReprobe` 调用。
  - 根因（**探针缺陷，不是宿主能力结论**）：面板组件通过 `apply(ctx)` 收到的根 Context 读取 `ctx.remote.hpReprobe`，而这个 Context 只声明了 `slots`、`remote`，没有声明 `remote.hpReprobe`。Cordis 对未声明注入的服务属性直接抛错。命名空间服务 `remote.<namespace>` 只在 `ctx.inject(['remote.hpReprobe', …], cb)` 的回调 Context 里可读（M17）。
  - 处置：见 M17 与尝试 2。
- **探针修复**（2026-09-29T11:13Z–11:15Z，宿主已用修复后的探针重装并重启，不改任何判据）：
  - 客户端：`build(uiCtx)` 移进 `ctx.inject(['remote.hpReprobe', 'slots'], cb)` 的回调（M17）。
  - 宿主半边：固定 fake providers 的四个 `bindingId`，并在组合失败时把原因写进 host.log（M18）。尝试 1 里失败的 O4.2、O4.3 需要在同一页面上用修复后的探针重做。
  - 影响判定：探针缺陷，不改变宿主承载什么，见 §11.5 新增两行。尝试 1 的失败保留在本节，不删除。
- **尝试 2**（修复后的探针；主会话内置 Browser 窗格，视口 1280×900；页面全程没有刷新）：O0.3、O3.1、O3.2、O3.3、O4.1、O4.2、O4.3 全部通过（见观测表）；O3.4 的 POST 一半通过，WebSocket 一半因为 `read_network_requests` 不列 WebSocket 而未被捕获。进入页面后宿主再次弹出 API key 对话框，只点了 Configure later。
  - O3.4 的补取证方案（不刷新页面）：在页面里包装 `WebSocket.prototype.send` 只读记录发出的帧，然后切换到别的面板再切回 HP Reprobe，让流的 `open` 帧重新经过这个包装；帧里应有 `"endpoint":"hpReprobe/watch"`，套接字 URL 的路径应是 `/api/remote.mux`。这只是读取，不改变任何宿主行为，会登记进捷径台账。同一步也满足 O3.8（客户端释放流句柄后 host.log 出现 `watch closed`，poll 计数停止增长）。
  - **补取证结果**（同一页面，未刷新；时间取主会话 `javascript_tool` 的 `new Date().toISOString()` 与 console 自带时间）：11:23:08.208Z 装包装；11:23:13Z 点「Plugins」离开面板；11:23:24.664Z 点回来（主会话记的回来时刻，晚于 console 里 11:23:21.712Z 的新 baseline，因为主会话的时刻是点击之后手工记的，以 console 时间为准）。结果见 O3.4 与 O3.8。

### 11.4 静态机制证据

这一节的行只说明"机制存在"（S1），不带 O-ID，不参与推导。路径里的 `$HOST_RUNTIME/…/` 指 `$HOST_RUNTIME/node_modules/@deepseek-ai/`；行号针对 `0.1.7-rc.2`，升级后失效。每行的时间是重新取证的时间。本机宿主已升级到 `0.2.0-rc.2`，变了的行号见 §11.10。

| # | 事实 | 命令或代码路径 | 结果 | 时间（UTC） |
|---|---|---|---|---|
| M1 | `dsh` 不在 `PATH` 上；`dsh plugin` 把参数原样转给 `PATH` 上的 pnpm | `which dsh`；`pnpm --version`；`$HOST_RUNTIME/…/dsh/lib/plugin-DkYIj96-.js:58-80` | `which dsh` 无输出。**订正**：`PATH` 上的全局 pnpm 是 12.5.1；在本仓库目录里显示 10.28.2，是因为仓库 `packageManager` 字段把它切到了 10.28.2。`dsh plugin` 在 `$SCRATCH` 里运行，用的是 12.5.1 | 2026-09-29T06:46:11Z |
| M2 | 兼容闸门只看 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 的 `peerDependencies`，预发布号参与匹配；`engines.dsh` 与 `dsh.manifestVersion` 不被强制；路径 spec 安装前预检，tarball spec 安装后判定 | `$HOST_RUNTIME/…/dsh-app-boot/lib/index.js:286-316`；`$HOST_RUNTIME/…/dsh-package-manifest/README.md` Known Limitations；`$HOST_RUNTIME/…/dsh-plugin-manager/lib/types/operations.js:113-145,293-313` | 与预期一致 | 2026-09-29T06:46:28Z |
| M3 | 用户数据根由 `DSH_HOME` 决定，profile 在 `$DSH_HOME/profiles/<name>`；`dsh plugin` 首次使用会初始化 profile；web 应用接受 `--port 0` 与 `--no-open`，默认端口 3080 | `$HOST_RUNTIME/…/dsh-home-paths/lib/index.js:71-74`；`$HOST_RUNTIME/…/dsh/lib/plugin-DkYIj96-.js:37`；`$HOST_RUNTIME/…/dsh-web-app/lib/startup.js:22`；`$HOST_RUNTIME/…/dsh-web-app/cordis.patch.yml:168`；`lsof -nP -iTCP -sTCP:LISTEN` | 与预期一致；实测 `--port 0` 可用。本机默认端口上已有一个真实宿主实例在监听，所以只用 `--port 0` | 2026-09-29T06:46:36Z |
| M4 | 会话遥测导出行默认装载，`DSH_TELEMETRY_DISABLED` 非空即可退出 | `$HOST_RUNTIME/…/dsh-base/cordis.patch.yml:189-209`；`$HOST_RUNTIME/…/dsh-app-boot/lib/index.js:997-1030` | 与预期一致；全部宿主命令都设置了该变量 | 2026-09-29T06:46:36Z |
| M5 | web 应用启动时会把**带认证令牌的 URL** 打到 stdout | `$HOST_RUNTIME/…/dsh-web-app/lib/index.js:198-203` | 与预期一致；实测 host.log 里出现该行，令牌与端口不入记录 | 2026-09-29T06:46:44Z |
| M6 | 类型化 Remote 的描述符与 codec 是 protocol 包的公开类型；注册表只做结构校验；网关对 strict codec 只调用 `codec.create().parse(value)`；客户端 `$mount` 只要求输入侧 codec 为 strict；本机运行时里没有生成器包 | `$HOST_RUNTIME/…/dsh-typert-protocol/lib/types/types.d.ts:189-294`；`$HOST_RUNTIME/…/dsh-typert-registry/lib/index.js:522-566`；`$HOST_RUNTIME/…/dsh-api-gateway/lib/index.js:1501-1516`；`$HOST_RUNTIME/…/dsh-api-gateway/lib/types/client/index.js:136-157,587-602`；`ls "$HOST_RUNTIME"/node_modules/@deepseek-ai \| grep typert` | 与预期一致：只有 loader / protocol / registry 三个包，没有生成器 | 2026-09-29T06:46:44Z |
| M7 | 网关在 `/api` 共享通道上占用**唯一**的拦截器，第二个 `intercept('/api')` 会抛错；插件可用的宿主 web 路由面是 `rpc.handle('/<channel>')`（channel 不能是 `/api`）与 `fetch.register({ path: '/api/<path>' })`，两者都先经过 `connection.admit` | `$HOST_RUNTIME/…/dsh-api-gateway/lib/index.js:624`；`$HOST_RUNTIME/…/dsh-client-connection/lib/index.js:665,756,759,829-842`；`$HOST_RUNTIME/…/dsh-client-connection/lib/types/rpc.d.ts:106-160` | 与预期一致 | 2026-09-29T06:46:53Z |
| M8 | web profile 开了 gzip，只豁免 `text/event-stream`；客户端断开后，HTTP 桥会中止 `request.signal`，但仍会把响应体读空 | `$HOST_RUNTIME/…/dsh-web-app/cordis.patch.yml:169-171`；`$HOST_RUNTIME/…/dsh-host-webserver/lib/index.js:106-117`；`$HOST_RUNTIME/…/dsh-client-connection/lib/index.js:34-38,94-95` | 与预期一致 | 2026-09-29T06:47:00Z |
| M9 | client resources 的宿主半边是空函数；provider 在浏览器里注册，帧语义是"ok 帧替换值"。**它不是一条线**，只是浏览器侧的寻址与缓存层 | `$HOST_RUNTIME/…/dsh-client-resources/lib/index.js`（全文 6 行）；`$HOST_RUNTIME/…/dsh-client-resources/lib/types/client/contract.d.ts:62-72` | 与预期一致 | 2026-09-29T06:47:00Z |
| M10 | 页面挂法的先例：`ctx.slots.inject('main', …register({ name: 'main', key }))` 加一个 `sidebar.panellist` 入口；客户端 bundle 的形状是 `window.__ModuleLoader__.load({ id, factory })`，导出 `apply` 与 `inject`；插件自己 `$mount` 自己的贡献也有先例 | `$HOST_RUNTIME/…/dsh-client-ui-schedule/lib/client.js:6793-6810`；`$HOST_RUNTIME/…/dsh-client-ui-brand-official/lib/client.js`；`$HOST_RUNTIME/…/dsh-experimental-client-ui-voice-input/lib/client.js:5817-5845` | 与预期一致 | 2026-09-29T06:47:03Z |
| M11 | unary 结果经 `Response.json` 编码，流项经 `JSON.stringify` 编码，所以值为 `undefined` 的属性过线后变成**缺失键**，不是被拒绝。`packages/controller/src/wire.ts` 里就有这类字段 | `$HOST_RUNTIME/…/dsh-client-connection/lib/index.js:723-737`；`$HOST_RUNTIME/…/dsh-api-gateway/lib/index.js:385-390`；`packages/controller/src/wire.ts:35,41,42` | 与预期一致。**实测（S3，经网关的 curl）**：探针的 `snapshot` 直接返回 controller 的 `WireSnapshot`，响应里 `source` 对象没有 `reason` 键（宿主侧值为 `undefined`）| 2026-09-29T11:03:36Z |
| M12 | Node v26.10.0 拒绝对 `node_modules` 下的 `.ts` 做类型擦除，所以装进 profile 的插件宿主半边必须是 JS；`node_modules` 之外的 `.ts` 可以 | 在临时目录里 `import('./node_modules/x/a.ts')` 与 `import('./b.ts')` | 前者 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`，后者成功 | 2026-09-29T11:04:45Z |
| M13 | **新事实**：`dsh plugin` 在本机上直接失败：`spawn ENOEXEC`。全局 pnpm 的入口文件是没有 shebang 的 sh 占位脚本（pnpm 的原生二进制没有被安装脚本替换），脚本自己注明"Apple's libc does not [retry under a shell], so on macOS a program that spawns this path itself gets ENOEXEC" | `dsh_s plugin --profile web add <scratch>/hp-reprobe-0.0.0.const.tgz`；`node -e "require('child_process').execFileSync('pnpm',['--version'])"` | 退出码 1，日志 `Command failed with ENOEXEC: pnpm add …`；`execFileSync('pnpm')` 同样 `ENOEXEC`；在 shell 里 `pnpm --version` 正常。这与预期的"找不到 pnpm 时退出码 127"是**不同**的失败模式。绕过办法见 §11.5 的 PATH 垫片。`0.2.0-rc.2` 的 Desktop 路线自带 pnpm，这一条只对 npm 发行的 `dsh` CLI 路线成立（§11.10） | 2026-09-29T06:55:13Z |
| M14 | pnpm 对**同一路径下**、同名同版本、内容不同的本地 tarball 再次 `add` 时判为"Lockfile is up to date, resolution step is skipped"，不重装；需要先 `remove` 再 `add` | `dsh_s plugin --profile web add <同一路径的新 tarball>` 与随后的 `remove hp-reprobe` + `add` | 第一次 `add` 退出码 0 但已装内容仍是旧版；`remove` 后 `add` 装入新版 | 2026-09-29T06:57:52Z |
| M15 | **S2 对照（不参与判定）**：普通 Node 进程里，`composeCore` + `createSqliteStorage` + fake providers + `createController(HarnessManaged)` 能跑通 | 一次性脚本（仓库外，不保留）：基线、`applyPlanningStatus`、`watch.poll` | 基线 revision 1、5 个实体；`applyPlanningStatus` 返回 `local_only`；watch 给出 1→2 的 delta。#197 不挡这条组合 | 2026-09-29T06:52:32Z |
| M16 | 宿主把探针的 client bundle 放进了启动索引页的 boot graph，并在 `/plugins` 下提供服务；`dsh.client.inject` 原样出现在 boot graph 行里 | 带认证 cookie 的 `curl` 取索引页，再取索引页里 `plugins/??hp-reprobe/client.js…` 的合并脚本；`node --check` | 索引页含 `"id":"hp-reprobe"` 的 boot 行；合并脚本 HTTP 200、语法通过、含 `id: 'hp-reprobe'` 的 `__ModuleLoader__.load`。这只证明宿主提供了 bundle（S1），页面里 factory 是否执行见 O0.3 | 2026-09-29T11:07:56Z |
| M17 | 命名空间服务 `remote.<namespace>` 只在 `ctx.inject` 声明了它的 Context 里可读；根 Context 上读它会抛 `cannot get property "…" without inject`。宿主自带插件的做法是：先 `await ctx.remote.$mount(…)`，再 `ctx.inject(['remote.<ns>', 'slots', …], cb)`，在 `cb` 收到的 Context 上取服务、构造组件并注册插槽 | `$HOST_RUNTIME/…/cordis/lib/index.js:676`（报错文案）；`$HOST_RUNTIME/…/dsh-experimental-client-ui-voice-input/lib/client.js:5817-5826`（`mountVoiceInput`）、`:5762`（`observeReadiness(ctx)` 用回调里的 `ctx`）、`:5400`（`ctx.remote.speech.follow`）；`$HOST_RUNTIME/…/dsh-api-gateway/README.md` 的 Client service 段（"each namespace is a traced `remote.<namespace>` child Service"） | 与尝试 1 的失败完全吻合：探针把根 Context 闭包进了面板组件。修复只改探针：`build(uiCtx)` 移进 `inject` 回调，组件里的 `remote()`、`$stream` 都取自 `uiCtx`。这是探针缺陷，不是宿主能力结论 | 2026-09-29T11:15:49Z |
| M18 | 探针宿主半边在**同一个库**上重启：`composeCore` 每次都 `putProviderBinding`，fake providers 默认每次随机分配 binding id，所以第二次组合撞唯一约束；固定四个域的 `bindingId` 之后重启成功，但工作区 revision 在每次重启组合后前进 1 | 尝试 1 的宿主重装后第一次启动：host.log 无 `composed` 行，经网关调用 `hpReprobe/snapshot` 返回 `hp-reprobe compose failed: … UNIQUE constraint failed: workspace_binding.workspace_id`；修复后（固定 `bindingId`、旧库移出宿主目录）连续启动两次，第二次 `composed` 的 revision 由 1 变 2、实体数仍是 5 | 这是探针组合根的问题（#132 / #228 的组合根需要稳定的 binding 身份才能重启），不是宿主能力结论；它使 O3.6 的重启用例成为可能。每次重启后页面看到的基线 revision 会比上一次大 1 | 2026-09-29T11:15:15Z |
| M19 | Browser 窗格的 `read_network_requests` 不列 WebSocket，所以线缆的 WebSocket 一半要另取证据。页面里可以包装 `WebSocket.prototype.send`（原型上的方法查找是动态的，对已经建立的套接字也生效）只读记录发出的帧 | `javascript_tool` 在页面里执行包装；随后触发一次流的释放与重开；读 `window.__hpWs` | 记录到 `path` 为 `/api/remote.mux` 的 `cancel` 与 `open` 帧（O3.4）。局限：包装之后发出的帧才被记录，包装之前的 `open` 帧（handle 1）没有被记录；`onmessage` 方向没有被包装 | 2026-09-29T11:23:08Z |
| M20 | 客户端 `$stream` 的 `generation` 是每一次打开尝试的序号：循环里每进入一轮就 `++generation`，打开失败（载体错误）后带退避重试的下一轮也算一代，所以它不等于「成功重连的次数」；载体错误由 `carrierFailed` 回调通知，正常结束由 `ended` 归类 | `$HOST_RUNTIME/…/dsh-api-gateway/lib/types/client/remote-stream.js:70`（`let generation = 0`）、`:82`（`const generationId = ++generation`）、`:106`（`throw this.options.ended(accepted)`）、`:115`（`carrierFailed?.(error)`）、`:118`（`attempt++`）；`remote-stream.d.ts:6` 的注释「Monotone physical generation number within this logical stream」 | 与 O3.6 的观测吻合：停机后两条载体失败（closed、failed to open），重启后第三次尝试成功，`generation` 为 3。#229 若要显示「重连了几次」不能直接用它 | 2026-09-29T11:34:23Z |
| M21 | 宿主 profile 的 `pnpm-workspace.yaml` 模板是 `nodeLinker: hoisted` 加 `autoInstallPeers: false`，所以插件的 peer 不会被自动安装，运行时由宿主提供；安装时 pnpm 只报一条 peer 警告 | `$HOST_RUNTIME/…/dsh-app-boot/lib/index.js:562-567`；`dsh plugin --profile web add` 的输出 | 与预期一致：安装输出里有 `Issues with peer dependencies found` 警告，探针的 peer 没有被安装，宿主加载探针时仍能解析 `@deepseek-ai/*` | 2026-09-29T06:56:06Z |
| M22 | 视口小于 1024px 时宿主侧栏自动折叠；全局面板占用根作用域的 `main` 键控插槽，`ctx.layout.selectPanel(id)` 选中它 | `$HOST_RUNTIME/…/dsh-client-ui-layout/README.md` 布局一节；`$HOST_RUNTIME/…/dsh-client-ui-sidebar/README.md` 的 Global panel entries 段 | 与预期一致；本次观测的视口是 1280×900，侧栏没有折叠 | 2026-09-29T11:43:22Z |
| M23 | 客户端 bundle 的 `require` 只能取宿主壳预置的基线模块表（React、Cordis 与静态 UI 库），以及 `dsh.client.external` 声明的精确请求；后者必须由它点名的动态包行或静态表里的精确键回答；类型引用被擦除，不产生请求；`dsh.client` 要求 `platform: 'web'` 并导出 `./client` | `$HOST_RUNTIME/…/dsh-client-modules/README.md` 的 Declaring a client plugin 与 Sharing modules 两节（第 34、46 行） | 与预期一致。探针只 `require('react')`，没有声明 `dsh.client.external`，所以没有验证「非基线请求由动态包行回答」这一半 | 2026-09-29T16:05:33Z |

### 11.5 捷径台账

**本节对预注册文字的解读（观测之后写下）**：台账只列实际采用的捷径，预注册的判定不得改动，执行中新出现的捷径追加在后面。预注册里另外两条捷径没有采用，所以不进表：`allow-version --accept-risk`（预注册判定：影响 O0.1，是）和「用 jsdom 或假 DOM 代替浏览器」（预注册判定：影响所有客户端项，是）。理由：预注册块 §2.3 的规则问的是「台账里有没有影响判定为是、且指向决定性 O-ID 的行」，§2.5 的六行是预先定性，没有写明未采用的行要不要出现在表里；这里把「是」读作「已采用且有影响」。把未采用的两行留在表里，只读表格的人（或机械推导）会把「是」读成已经采用，结论就会错成 `fallback-web`。这是观测之后做的解读，不是预注册原文（计划 `Decision Log` D21）；人类伙伴 2026-09-30 在会话中确认了这一解读。它们没有被采用这一事实，由 §11.3 的命令栏佐证：O0.1 的安装没有出现 `allow-version`，客户端项只用 Browser 窗格。

| 捷径 | 影响的 O-ID | 影响判定 | 理由 |
|---|---|---|---|
| 手写 `lib/client.js`，不用打包器 | 所有客户端项 | 否 | 用的正是宿主消费的格式（M10）；由构建产出是 #227 的事 |
| 宿主半边用 file URL 导入工作树的 `.ts` 源码 | O2.3、O3.1、O3.2、O3.3、O3.4、O3.5、O3.6、O3.7、O3.8 | 否 | 不改变宿主承载什么。作为硬事实交给 #227：安装件必须是构建后的 JS（M12） |
| fake providers 加种子数据 | O3.1、O3.2、O3.3、O3.4、O3.5、O3.6、O3.7、O3.8、O4.2 | 否 | #225 只问承载能力，不问数据源 |
| 手写 strict 描述符 | O3.1、O3.2、O3.3、O3.4、O3.5、O3.6、O3.7、O3.8 | 否 | 描述符、codec 与 schema 都是公开类型，运行时只做结构校验（M6）；见 §11.2 的契约来源 |
| PATH 前置一个 `pnpm` 垫片（`#!/bin/sh` 脚本，转调同一个全局 pnpm），只对 `dsh_s` 生效 | O0.1 | 否 | 只修复本机全局 pnpm 入口的 `ENOEXEC`（M13），执行的仍是同一个 pnpm；不改变兼容闸门、安装路径或宿主加载路径。**人类伙伴 2026-09-29 在会话中确认这一判定（来源：会话中的回答；计划 `Decision Log` D19）**：它只修补本机 pnpm 安装的缺陷，不改变兼容闸门、安装路径或宿主加载路径；「`dsh plugin` 依赖一个可以被直接 spawn 的 pnpm」作为前提写进 §11.7 给 #227 / #230 的事实 |
| 探针 client 半边在尝试 1 里读了未声明注入的服务（`remote.hpReprobe`），修复后重装重测 | O4.2、O4.3、O3.1、O3.2、O3.3、O3.4 | 否 | 探针自己的 Context 用法错误（M17），不改变宿主承载什么；尝试 1 的失败按原样保留，观测行取最后一次尝试。修复依据是宿主自带插件的用法，不是为了迁就结果放宽任何判据 |
| 固定 fake providers 的 `bindingId`，并把因重启撞唯一约束而残留的旧库移出宿主目录 | O2.3、O3.6 | 否 | 探针组合根的问题（M18），不改变 O2.3 所问的库写入与凭据字节扫描；旧库（含尝试 1 期间的数据）留在 `$SCRATCH` 里，收尾扫描时一并检查 |
| 在页面里包装 `WebSocket.prototype.send`，只读记录发出的帧再原样转发（因为 `read_network_requests` 不列 WebSocket） | O3.4、O3.8 | 否 | 只记录、不改变帧内容与时序，不改变宿主承载什么；局限是它只能记录包装之后发出的帧（M19） |
| O3.6 重启时用上一次的回环临时端口，而不是 `--port 0`（Global Constraints 规定宿主只用 `--port 0` 启动） | O3.6 | 否 | 页面要重连同一个源必须复用端口；目的（不与本机真实实例争用、只在回环）不受影响：重启前 `lsof` 确认端口空闲、只监听回环，`DSH_HOME` 仍是 scratch。**主会话决定的一次性偏离**（计划 `Decision Log` D18）；O3.6 是非决定项，不参与裁决 |

**附带写入（宿主 UI 自发，只落在 scratch 数据根）**：浏览器首次打开 scratch 宿主时，宿主 UI 先后弹出「Internal Testing Notice」与「Add an API key to get started」，分别点了 Continue 与 Configure later（没有输入任何密钥，也没有使用任何真实凭据）；随后 UI 自发发出 `POST /api/session/create`、`POST /api/workspace/initializeDefault`、`POST /api/settings/mutate`，都返回 200，在 `$DSH_HOME` 下多出会话文件、工作区索引与一个 `.credentials.yaml`（里面只有宿主自己的浏览器会话授权记录，没有 `refs` 条目）。**这次写入不只落在 scratch**：`workspace/initializeDefault` 让宿主在**真实账户**的 `<Documents>/deepseek-harness/default-workspace` 下建了默认工作区目录（连同上一层 `<Documents>/deepseek-harness`），两个都是空目录，创建时间是 2026-09-29T11:10:24Z，正是浏览器第一次进入宿主的那一刻；scratch 数据根的 `workspace.json` 指向它，真实 `~/.dsh` 的 `workspace.json` 没有它。运行时文档写明由宿主把这个目录放在账户的 `<Documents>/deepseek-harness` 下，`default-workspace` 是固定目录名（`$HOST_RUNTIME/…/dsh-api-workspace-controller/README.md` 的 First-use Workspace 一节）。所以 **`DSH_HOME` 隔离不覆盖默认工作区目录**。这两个空目录目前还在；是否删除由人类伙伴决定，本记录不做破坏性删除。**订正**：此前这里（以及下面的收尾核对）写的「默认工作区目录没有在 `~/Documents` 下创建」是错的，原因是当时查的目录名不对（把会话目录名里的连字符编码当成了目录名，查成了 `deepseek-harness-default-workspace`），已按事实改正。

**收尾核对（2026-09-29T11:38Z）**：`find ~/.dsh -newer <marker> -not -path '*/node_modules/*'` 命中 8 项，全部是本机真实宿主实例自己的会话文件与工作区索引（持有其中会话锁的是真实实例进程，它在整个探针窗口内一直运行）；含一次性数据根路径的真实 profile 配置文件（yml / json）数为 0；但**默认工作区目录被创建在真实 `<Documents>` 下**（见上一段，此前这里写的「没有创建」是错的，已订正）。所有宿主命令只经守卫函数执行，但守卫只约束 `DSH_HOME`，不约束这个目录。`~/Downloads` 目录自身的 mtime 也比 marker 新，里面没有比 marker 更新的条目；探针的输出都在 `$SCRATCH`，我没有找到它与探针有关的证据，也不能排除是其它应用在增删临时文件。

**附带写入**：`dsh plugin` 调用 pnpm 时不传递调用方环境（`extendEnv: false`），所以 pnpm 的内容寻址库落在用户级默认位置，多了探针包的条目；这不在 `~/.dsh` 之内；核对时用户级 pnpm 内容寻址库里比 marker 更新的文件有 15 个，都来自这几次探针包的安装。

### 11.6 裁决

按预注册块 §2.3 由 §11.3 与 §11.5 机械得出，没有手工挑选：

- 决定性行共 14 个：O0.1–O0.3、O2.1–O2.3、O3.1–O3.5、O4.1–O4.3，每个恰好一行，结果都是「已观测到」，强度都是 S3。
- §11.5 里实际采用的捷径没有「影响判定 = 是」的行（PATH 垫片一行经人类伙伴在会话中确认为「否」，D19）。
- 没有失败项，所以「决定它的答案」按 §2.3 第 3 条写 Q4（它最直接决定「页面能不能出现在宿主里」）。
- transport 按 §2.4 第 1 条的顺序取第一条在同一次运行里满足 O3.1–O3.5 的线：typed remote 满足，所以 host web route 没有尝试（§2.4 第 4 条的条件不成立）。

> 裁决：`embed`
> 决定它的答案：Q4（无失败项；装入、加载、把面板挂进 `main` 插槽与侧栏入口，都在真实宿主与真实浏览器里观测到，O0.1–O0.3 与 O4.1–O4.3 均为 S3）
> transport：typed remote（手写 strict 描述符经 `TypertRemoteService` 绑定服务 `hpReprobe`；unary 走 `/api` 的 POST，watch 用 stream Remote，走 `/api/remote.mux` 的 WebSocket）

**这个 `embed` 依赖三项观测之后的裁定或解读**（三项都已由人类伙伴在会话中裁定或确认），其中任何一项反过来，裁决都会是 `fallback-web`（Q4）：

1. 计时口径 B（计划 `Decision Log` D17，观测之后作出，见 §11.2）。按口径 A，O0.3 超出 O0 子预算。
2. PATH 垫片判「否」（D19）。判「是」则 O0.1 被捷径影响。
3. §11.5 只列实际采用的捷径（D21，理由见 §11.5 前言；人类伙伴 2026-09-30 确认）。把预注册 §2.5 里未采用的两行照抄进台账，机械推导会把它们当成已采用。

另外，O3.6 用同一个回环临时端口重启是主会话决定的一次性偏离（D18）；它是非决定项，不影响裁决。

三个问题的对应关系：

| 问题 | 决定性行 | 观测到的东西 |
|---|---|---|
| Q4 页面挂进插槽 | O0.1–O0.3、O4.1–O4.3 | 仓库外 tarball 经 `dsh plugin add` 装入；宿主半边在 host.log 打出就绪行；浏览器里 bundle 的 factory 执行；`sidebar.panellist` 入口出现在可访问性树里；点击后 `main` 插槽里的列表行数等于查询到的实体数，delta 到达后被改的行原位更新；没有以插件为源的 console 错误 |
| Q3 客户端到达 controller | O3.1–O3.5 | 页面查询的 revision 与实体数等于 host.log；命令返回 `local_only` 且 revision 加 1；同一个流句柄上先 baseline、订阅之后再 delta（`previousRevision` = R、`revision` = R + 1），页面没有刷新；线缆是 `/api` 上的 POST 加 `/api/remote.mux` 的 WebSocket；入口无 cookie 401、伪造 `Host` 403 |
| Q2 凭据按操作解析 | O2.1–O2.3 | `ctx.credentials.resolve` 在操作内调用；两次操作之间直接改凭据文件，不重启、不重载，第二次得到新摘要；同一次操作里经 controller 写库，库文件 mtime 前进，库文件里没有凭据原文或 base64 |

**契约来源 = 手写**：描述符是手写的 strict 描述符，形状取自宿主运行时的公开类型 `InvocationDescriptor`，运行时只做结构校验，网关对 strict codec 只调用 `codec.create().parse(value)`（M6）。本机运行时里没有生成器，公开 registry 上有一个但版本线不同，没有下载或运行（O3.9）。**订正（2026-09-30）**：registry 上有与运行时同一版本线的生成器（`0.1.7-rc.2`，以及 `next` 标签的 `0.2.0-rc.2`），「版本线不同」是只读了 `latest` 标签造成的误判，见 O3.9 摘录的订正句。这份契约与 rc 版描述符格式耦合：宿主升级可能改变格式，#228 需要用 `satisfies InvocationDescriptor` 把它绑到 controller 接口，并用精确的 peer 版本闸门防止漂移（计划的 TD2）。

**client resource stream 是消费层，不是一条线**：它的宿主半边是空函数，只是浏览器侧的寻址与缓存层（M9），只能叠在 typed remote 之上，不能单独被点名。

**这个裁决回答什么、不回答什么**：它回答「宿主能不能承载这三件事」，答案是**在探针形态下能**，探针形态指：手写 JS 宿主半边、用 `file:` URL 导入工作树的 `.ts` 源码、fake providers、手写描述符、一次性 profile。它不回答：契约生成器能否用于 `apps/harness-plugin`（O3.9）；host web route 的实际表现（没有尝试，只有 M7、M8 的静态证据）；worker-preview 载体（没有观测）；真实 GitHub provider；由构建产出的宿主入口（探针的宿主半边是手写 JS，并用 `file:` URL 导入工作树的 `.ts` 源码，M12）；多客户端并发 watch 的开销；宿主会话接口（#140）。§8 里「#135 是唯一范围会变的子 issue」是 `fallback-web` 下的判断，在 `embed` 下不再适用；各子 issue 受到的影响见 §11.7。

### 11.7 交给子 issue 的事实

括号里的编号指向 §11.3 的 O 行与 §11.4 的 M 行。

| 子 issue | 需要知道的事实 |
|---|---|
| **#227**（打包） | 1. 宿主入口必须是构建后的 JS：Node v26.10.0 拒绝对 `node_modules` 下的 `.ts` 做类型擦除（M12）；打包时要把 `@harness-projects/*` 一并打进去，产物不能有 `workspace:*` 依赖。探针没有验证这一点，它是手写 JS 并用 `file:` URL 导入工作树的 `.ts` 源码。2. 客户端 bundle 的形状是 `window.__ModuleLoader__.load({ id, factory })`，`id` 是包名，`factory(require)` 里只能 `require` 基线模块（React、Cordis 等）与 `dsh.client.external` 声明的精确请求；导出 `apply` 与 `inject`（M10）；`require` 的限制出自宿主 client-modules 文档（M23）。3. manifest：`dsh.client.platform` 为 `web`、`exports` 含 `./client`、`dsh.bundle.patch` 指向一个插入行的 `cordis.patch.yml`（O0.1、O0.3、M16）。4. 兼容闸门只看 `peerDependencies` 里的 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`，预发布号参与匹配；`engines.dsh` 与 `dsh.manifestVersion` 不被强制（M2）。探针把用到的 `dsh-*` 精确写成 `0.1.7-rc.2`，没有使用任何豁免就通过了闸门；同样的精确写法会被 `0.2.0-rc.2` 宿主拒绝，#227 要按目标宿主版本写 peer（§11.10）。5. 宿主 profile 的 pnpm 配置关闭了 `autoInstallPeers`，peer 不会被自动安装，运行时由宿主提供（M21） |
| **#228**（controller transport） | 1. transport 是 typed remote：宿主半边用 `ctx.typert.register` 注册手写 strict 描述符，服务继承 `TypertRemoteService`；客户端先 `ctx.remote.$mount` 同一份描述符，再在 `ctx.inject(['remote.<ns>', 'slots'], cb)` 的回调里取服务，根 Context 上读会抛错（M17）。2. watch 是 stream Remote，探针的写法如下：宿主 `async *watch(signal)` 先产出 baseline，再按 `poll` 产出 delta，遇到 gap 就结束；客户端 `ctx.remote.$stream({ open, ended, carrierFailed })`，收到 `gap` 时调用 `stream.restart()`。观测到的是 baseline 与 delta（O3.3）以及每一代重新拿基线（O3.6）；**gap 分支探针里写了，但从未被触发，没有观测**。3. `generation` 是打开尝试的序号，失败的尝试也算，不等于重连次数（M20）。4. 值为 `undefined` 的字段过线后变成缺失键，不是被拒绝，`wire.ts` 里就有这类字段（M11）。5. `intercept('/api')` 不可用：网关已占用唯一的拦截器（M7）。6. 边界严格程度取决于契约里 `parse` 写多严：把它换成恒等函数后，非法参数会越过网关（O3.7）。7. 宿主入口依赖 controller / core / storage，现在的 boundaries 不允许，需要一份 ADR 并同步修改 `tests/contract/package-boundaries.test.js`（计划的 TD5）。8. `composeCore` 每次启动都会 `putProviderBinding` 并让工作区 revision 加 1；fake providers 默认随机分配 binding id，重启同一个库会撞唯一约束，需要稳定的 binding id（M18）。9. 凭据：`ctx.credentials.resolve` 按操作调用，文件里的改动在下一次操作里生效，不需要重启或重载（O2.1、O2.2）；库文件里没有凭据原文或 base64（O2.3）。10. **issuerKey 轮换与 `HumanExecutionProvider` 冲突**：观测到的是，轮换之后探针内存里持有的（未落库的）旧引用在新 key 下读回 `not_found`，与「运行不存在」无法区分（O2.4）；按源码推断（S1，未观测），已落库的 `providerRef` 同样读不回；策略需要人类决定：key 带版本号，或把轮换定义为一次运维事件（计划的 TD4）。11. watch 是轮询式，每个 tick 完整重读一次基线，开销为 O(实体数 × 客户端数)（计划的 TD3）。12. 准入：入口无 cookie 返回 401，伪造 `Host` 返回 403（O3.5）；`/api` 上的一元方法只对 `snapshot` 做了负例（§11.9 第 10 行）。13. 契约生成器在公开 registry 上有，版本线与运行时不同，未验证（O3.9）。**Superseded（2026-09-30 订正）**：同一版本线的 `0.1.7-rc.2` 与 `0.2.0-rc.2`（`next`）都存在，接入点是 `@deepseek-ai/dsh-typert-generator/tsdown`；仍未验证（O3.9 摘录的订正句） |
| **#229**（页面与插槽） | 1. 页面挂法：`ctx.slots.inject('main', …register({ name: 'main', key }, Component))` 加 `ctx.slots.inject('sidebar.panellist', …register({ name: 'sidebar.panellist', id, label }, Icon))`；入口的可访问名称就是 `label`（O4.1、O4.2）。2. 重连语义：宿主停机后 `$stream` 的载体错误通过 `carrierFailed` 通知（消息 `Remote stream WebSocket closed` 与 `… failed to open`），同一个流句柄在宿主回来之后重新拿 baseline；页面没有刷新（O3.6）。3. 面板卸载会释放流，宿主侧出现 `watch closed`，poll 计数停止（O3.8）。4. 宿主停机期间浏览器层会反复报 `ERR_CONNECTION_REFUSED`，不以插件为源，不要把它当成插件的错误（O3.6）。5. 认证跨宿主重启保留，令牌每次启动都会变（O3.6）。6. 宿主 UI 首次进入会弹「测试须知」与「添加 API key」两个对话框；演示环境需要预先处理，否则会遮住插件页面（§11.5 附带写入）。`0.2.0-rc.2` 起须知改名为「Preview Notice」，宿主版本提升后会对已确认过的用户再弹一次（§11.10）。7. 视口小于 1024px 时侧栏自动折叠，入口只剩图标与提示（M22）。8. 浏览器 Browser 窗格的 `read_network_requests` 不列 WebSocket，验收脚本要另想办法取证（M19）。9. **`DSH_HOME` 隔离不覆盖默认工作区目录**：首次进入宿主 UI 时，UI 自发的 `workspace/initializeDefault` 会在真实账户的 `<Documents>/deepseek-harness/default-workspace` 下建目录（§11.5 附带写入）；演示与验收环境要预先处理，或清理时把它算进去 |
| **#230**（安装） | 1. 安装用 `dsh plugin --profile <p> add <tgz>`；成功后 `package.json` 的 `dsh.profile.bundles` 自动追加包名（O0.1）。2. **`dsh plugin` 依赖一个可以被直接 spawn 的 pnpm**：本机全局 pnpm 的入口是没有 shebang 的 sh 占位脚本（原生二进制没有被安装脚本替换），macOS 上 Node 直接 spawn 它得到 `ENOEXEC`，`dsh plugin` 随之失败，与「找不到 pnpm 时退出码 127」不同。绕过办法是在 `PATH` 前面放一个 `#!/bin/sh` 垫片转调同一个 pnpm；人类伙伴 2026-09-29 在会话中确认这只是修补本机 pnpm 安装、不影响判定（M13、§11.5）。这一条只对 npm 发行的 `dsh` CLI 路线成立；`0.2.0-rc.2` 的 Desktop 路线自带 pnpm `11.7.0`，经 Electron 的 `execPath` 运行（§11.10）。3. 同一路径下、同名同版本、内容不同的本地 tarball 再次 `add` 会被 pnpm 判为「锁文件已是最新」而不重装，需要先 `remove` 再 `add`（M14；换路径是否会重装没有观测）。4. `dsh plugin` 调用 pnpm 时不传递调用方环境，pnpm 的内容寻址库落在用户级默认位置（§11.5 附带写入）。5. web 应用启动时把带认证令牌的 URL 打到 stdout，自托管日志与安装指南里要脱敏（M5）。6. `engines.dsh` 不被强制，兼容性只由 `dsh-*` 的 peer 决定（M2）。7. **`DSH_HOME` 隔离不覆盖默认工作区目录**：一次性 profile 的首次浏览器访问会在真实账户的 `<Documents>/deepseek-harness/default-workspace` 下建目录；安装指南里的「一次性环境」不要承诺零副作用（§11.5 附带写入） |
| **#140** | #225 没有观测宿主会话接口；它与 #225 的 blocked-by 关系是否解除由人类伙伴决定，本记录不改任何关系 |

### 11.8 #226 评论

裁决写定之后立刻发出，并且早于 #227–#230 的第一个 draft PR。下面三项在评论发出之后回填，回填时也不改动 §11.3 以前的任何内容：

- 链接：<https://github.com/SingularityKChen/harness-projects/issues/226#issuecomment-5902225112>。用开发账号发出；文案是人类伙伴批准的修订稿，只把其中的 head SHA 与 permalink 换成发出时 PR #238 的 head `74afc1a`
- created_at：2026-09-30T01:24:40Z（回读评论的 `created_at`）
- 发出前的核对时间与结果：2026-09-30T01:24:24Z，命令见计划 Batch 6。#227–#230 的 `closedByPullRequestsReferences` 都是 0，四个 issue 都是 OPEN；正文引用这四个编号的 PR 里，只有本 PR #238 创建于子 issue 之后，其余命中（#105、#121、#122、#175、#208）都早于 #227 的创建时间（2026-09-29T02:22:06Z），是搜索误报；#226 此前没有评论。发出前对评论全文做了 canary 扫描（0 行）、`disclosure`（作为 `PR_BODY` 传入，退出码 0）与人工五类目检查
- 评论写了裁决、transport、契约来源、裁决依赖的 D17 / D19 / D21、§11.10 的宿主版本事实与复测清单，以及 §11.7 给各子 issue 的事实。记录在评审中如有改动，追加可见的订正回复，不编辑原评论

- 评审订正回执（2026-09-30）：<https://github.com/SingularityKChen/harness-projects/issues/226#issuecomment-5906072447>，`created_at = 2026-09-30T07:09:44Z`，actor 为开发账号 `SingularityKChen`；目标为本仓库 #226，幂等键为 `pr238-0.2.0-retest-handoff-correction-20260930`。订正说明新版安装/加载/占位挂载归 #227，transport 与数据部分仍待 #228；原评论未编辑，原时间保留。发出后回读内容与预期一致。

### 11.9 未观测到清单与复核方法

| # | 未观测到的东西 | 卡在哪 | 复核方法 |
|---|---|---|---|
| 1 | 契约生成器能否用于 `apps/harness-plugin`（O3.9） | 本机运行时里没有；公开 registry 上的最新版 `0.0.1-rc.1` 与运行时 `0.1.7-rc.2` 不是同一版本线；下载需要另行授权。**Superseded（2026-09-30 订正）**：`latest` 标签停在陈旧的 `0.0.1-rc.1`，同一版本线的 `0.1.7-rc.2` 与 `0.2.0-rc.2`（`next`）都存在（O3.9 摘录的订正句）；下载仍需另行授权 | 授权之后在一次性目录里安装它，对一个最小 `@Remote` 服务生成描述符，与本记录手写的描述符逐字段对照，再用它生成的描述符重跑 O3.1–O3.3 |
| 2 | host web route 的实际表现（`rpc.handle` 加 `fetch.register` 的 SSE） | 没有尝试：typed remote 已满足 O3.1–O3.5，§2.4 第 4 条的条件不成立 | 只有 M7、M8 的静态证据。#228 若要评估版本耦合更低的备选，按预注册块 §2.4 第 1 条追加该变体，重跑 O3.1–O3.5 |
| 3 | worker-preview 载体 | 没有观测；那条载体上 Remote 会改走 `connection.rpc.open` | 需要时另立 issue，在那条载体上重跑 O3.x |
| 4 | 构建后的宿主入口与 client bundle | 探针是手写 JS，宿主半边用 `file:` URL 导入工作树的 `.ts` 源码 | #227 交付的构建产物装入一次性 profile，重跑 O0.1–O0.3 与 O3.x |
| 5 | `ctx.credentials.set` 这条写路径；以及 `source` 不是 `file` 的凭据来源 | O2.2 用了预注册里优先的做法：直接改凭据文件；O2.x 只观测了 `source = file`，启动环境这个来源在运行时是只读的，它的变更在一个运行中的宿主里不可观测 | 在探针宿主半边用 `ctx.credentials.set` 改值，重跑 O2.2；环境来源需要重启宿主才能改变，属于另一种观测 |
| 6 | 多客户端并发 watch 的开销与正确性 | 只有一个浏览器页面 | 同时打开两个页面，触发命令，核对两个页面都收到 delta，并读 host.log 的 poll 计数 |
| 7 | 宿主会话接口（#140） | 不在 #225 的问题里 | 由 #140 自己的验收覆盖 |
| 8 | 页面加载之前的第一次 `open` 帧（O3.4 的取证局限） | 包装是页面已加载之后才装的（M19） | 在页面加载之前注入包装，或用能列出 WebSocket 的浏览器工具，重读 `open` 帧 |
| 9 | 每一步在真实 GitHub provider 上的表现 | #225 只问承载能力，不问数据源（捷径台账里的 fake providers） | 由 #227–#230 各自的验收覆盖 |
| 10 | `/api` 上除 `snapshot` 以外的探针一元方法各自的准入负例（O3.5 的范围） | O3.5 按判据的入口清单逐路由取证，POST 入口只测了 `snapshot` | 对每个一元方法重跑 O3.5 的三种 `curl`（无 cookie、伪造 `Host`、带 cookie），期望 401 / 403 / 200 |

复核一条已观测到的结论时，重跑 §11.3 命令栏里的命令即可；每一行的强度与时间取自 host.log、console 或命令输出里的时间戳。探针源码不入库，构建版本差别见 §11.2；探针的宿主半边与客户端半边的形状见 §11.4 的 M10、M17。

### 11.10 宿主 0.2.0-rc.2 的静态差异（观测之后补记）

> 2026-09-30 补记。本节是**静态、只读**的对照：从本机 npm 缓存里解出两个版本的 tarball 逐文件比较，没有下载新包，没有启动宿主，也没有重跑任何 O 行。§11.3 与 §11.4 的观测都在 `0.1.7-rc.2` 上做，本节不改变它们的结果、强度与时间，也不改变 §11.6 的裁决。"本节复核"一栏标出 Batch 6 验收者在 2026-09-30T01:19Z 前后亲自复核过的项；其余是那份静态对照的结论。

**版本事实**：

| 事实 | 证据 | 本节复核 |
|---|---|---|
| `@deepseek-ai/dsh` `0.2.0-rc.2` 于 2026-09-29T09:56:27Z 发布，`latest` 与 `next` 都指向它；这落在额度中断区间（06:58Z–11:02Z）里 | `npm view @deepseek-ai/dsh dist-tags time --json`（只查元数据） | 是 |
| 本机 Desktop 应用在 2026-09-29T09:55Z 前后更新到 `0.2.0-rc.2`；本机真实 web 实例也已是 `0.2.0-rc.2` | 应用包的 `CFBundleShortVersionString` 与 mtime；web 实例的版本由人类伙伴告知 | 前半是 |
| `$HOST_RUNTIME`（npx 缓存里的安装根）在 2026-09-30T00:57Z 被替换成 `0.2.0-rc.2`，晚于全部观测；本机已经没有 `0.1.7-rc.2` 的运行时，按 §11.4 的原行号复核需要重新取得它（下载需另行授权） | 安装根里 `dsh/package.json` 的版本与 mtime | 是 |
| 复探期间 scratch 宿主用的是 `0.1.7-rc.2`：探针把 `dsh-*` peer 精确写成 `0.1.7-rc.2`，`0.2.0-rc.2` 的兼容闸门会拒绝它（见下表），所以 O0.2 能加载探针，本身就说明当时的运行时是 `0.1.7-rc.2` | O0.2；下表"兼容闸门"一行 | 是（推理） |

**插件路径上的差异**：

| 项 | `0.1.7-rc.2` → `0.2.0-rc.2` | 影响 | 本节复核 |
|---|---|---|---|
| 插件路径上的包 | `dsh-plugin-manager`、`dsh-package-manifest`、`dsh-home-paths`、typert 三包（loader / protocol / registry）、`dsh-client-connection`、`dsh-client-modules`、`dsh-client-resources`、`dsh-client-ui-slots`、`dsh-client-store`、`dsh-client-ui-cordis`、`dsh-credentials`、`dsh-credentials-local`、`dsh-host-webserver`、`dsh-authorization`、`dsh-workspace`、`dsh-settings` 等，除 `package.json` 外逐字节相同；`@deepseek-ai/cordis` 两版都是 `4.0.4`；官方插件 API 文档不变 | 裁决与 transport 的依据沿用 | cordis 版本是 |
| 兼容闸门 | 仍是 `semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })`（`dsh-app-boot/lib/index.js` 约 :300）；精确写 `0.1.7-rc.2` 的 peer 会被 `0.2.0-rc.2` 宿主拒绝。这是插件路径上唯一的不兼容 | #227 要按目标宿主版本写 peer（§11.7 #227 第 4 条） | 是 |
| 首次进入的须知 | 改名为「Preview Notice」；宿主版本提升后，对已确认过的用户会再弹一次 | §11.7 #229 第 6 条 | 改名是 |
| `dsh plugin` | 新增只作用于 `desktop` profile 的分支；Desktop 自带 pnpm `11.7.0`，经 Electron 的 `execPath` 运行，所以 M13 的"需要可被直接 spawn 的 pnpm"只对 npm 发行的 `dsh` CLI 路线成立 | §11.7 #230 第 2 条 | 分支与 pnpm 版本是 |
| Desktop 的端口与埋点 | Desktop 使用固定端口 `19387`（产品常量）；默认开启产品埋点并上报插件安装事件，`DSH_TELEMETRY_DISABLED` 管不到它（M4 只对 CLI 与 web 路线成立） | 演示与安装环境（#229、#230） | 端口常量是，埋点否 |

**§11.4 在 `0.2.0-rc.2` 上变了的行号**（只列静态对照报告变化的行；其余 M 行没有报告变化，本节没有逐行复核）：

| M | `0.1.7-rc.2` | `0.2.0-rc.2` | 本节复核 |
|---|---|---|---|
| M1 | `dsh/lib/plugin-DkYIj96-.js:58-80` | `dsh/lib/plugin-BGnVfe_D.js:63-99`（多了 `desktop` 分支） | 是 |
| M3 | `plugin-DkYIj96-.js:37`；`dsh-web-app/cordis.patch.yml:168` | `plugin-BGnVfe_D.js:41`；`dsh-web-app/cordis.patch.yml:174` | 是 |
| M4 | `dsh-base/cordis.patch.yml:189-209`；`dsh-app-boot/lib/index.js:997-1030` | 顺移约 3 行（没有逐行定位） | 否 |
| M6 | `dsh-api-gateway/lib/index.js:1501-1516` | strict codec 的 `parse` 调用在 `:1513` | 是 |
| M8 | `dsh-web-app/cordis.patch.yml:169-171` | `:175-177` | 是 |
| M21 | `dsh-app-boot/lib/index.js:562-567` | `:566-567` | 是 |

**需要在 `0.2.0-rc.2` 上复测的最小清单**（并入 #227 的验收，用构建产物，不用探针）：O0.1、O0.2、O0.3、O4.1–O4.3、O3.1–O3.4。O2.x 经过的凭据与存储代码两版相同，可以不复测。复测结果写进 #227 的记录，不回写本节的观测表。 **Superseded by PR #245 计划 D25 与本计划 D27（2026-09-30）**：人类伙伴明确委托，#227 的构建产物只复测安装、加载与占位挂载（O0.1–O0.3、O4.1、O4.2 的挂载部分、O4.3）；O3.1–O3.4 及 O4.2 的实体行数、delta 更新部分由 #228 在 Desktop `0.2.0-rc.2` 接入 controller transport 后复测。#227 的 K 行不能作为这些数据部分已观测的证据；原 `0.1.7-rc.2` 探针观测仍保留。
