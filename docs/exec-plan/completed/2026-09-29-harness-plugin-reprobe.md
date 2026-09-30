# 宿主嵌入复探（issue #225）ExecPlan

> 状态：Completed（2026-09-30 人类伙伴授权修订、整理提交并 rebase merge PR #238；Batch 0–6 与评审修订完成，PR 合并状态以实时回读为准）
> 创建：2026-09-29
> 范围：时限 ≤2 个工作日的 spike。把一个**仓库外**的插件包用官方工具链（`dsh plugin add`）装进**一次性** profile，重跑 #125 的问题 2–4；交付物是 `docs/architecture/harness-host-spike.md` 新增的 §11、一个离线契约测试、恰好一个 `embed` / `fallback-web` 裁决（`embed` 时点名 transport），以及 #226 上的一条评论。探针代码不合并。
> 上游输入：issue #225（验收标准）、#226（父 epic）、#227 / #228 / #229 / #230 / #140、`docs/architecture/harness-host-spike.md` §2 / §7 / §9、`docs/exec-plan/completed/2026-09-24-harness-host-spike.md`、`AGENTS.md` §1.1 / §2 / §7、`PLANS.md`、`docs/development/workflow.md`、`docs/development/publication.md`、官方插件文档 <https://deepseek-harness.github.io/deepseek-harness/develop/basic/> 及其 reference 部分
> base（历史观察快照；当前 base/head 用 `gh pr view 238 -R SingularityKChen/harness-projects --json baseRefOid,headRefOid` 回读）：预注册时 `origin/main` = `f6a33d2`；Batch 6 变基到 `699d715`（2026-09-30 观察时刻，回读 `git merge-base origin/main HEAD`）；分支 `test/harness-plugin-reprobe`；工作树 `.worktrees/harness-plugin-reprobe`
> 宿主运行时版本：`0.1.7-rc.2`。本文所有 `$HOST_RUNTIME/...:行号` 都针对这个版本，升级后行号失效，需要重新定位。**Superseded by** 记录 §11.10（2026-09-30）：本机的 `$HOST_RUNTIME` 已在 2026-09-30T00:57Z 被替换成 `0.2.0-rc.2`，全部观测仍在 `0.1.7-rc.2` 上完成；变了的行号与复测清单见 §11.10（D26）。

## Purpose / Big Picture

2026-09-29，人类伙伴选定 Harness 插件壳作为 demo 与首发的外壳（#226 Context），推翻了 #125 在观测不全时给出的 `fallback-web` 默认。这让 #225 成为 demo 关键路径上的第一道门：#227（打包）、#228（controller transport）、#140 都被它阻塞。

#125 当时卡住的缺口有两类。一类在仓库侧（SQLite `Storage`、真实 provider），现在已经补上。另一类始终停在"机制存在"：页面挂进插槽、客户端半边调用 controller、watch 增量。原因是 #125 没有启动宿主，也没有装插件（旧计划 D3）。本次复探要把这三件事放进**真实宿主进程 + 真实浏览器**里观测。

完成后的世界：

1. `docs/architecture/harness-host-spike.md` 多出 §11。§1–§10 逐字节不变。§11 对问题 2–4 逐条写"已观测到 / 未观测到"，每条带确切命令或代码路径和 UTC 时间，并给出恰好一个裁决。
2. 裁决是 `embed` 时，点名 transport，取值只能是 typed remote 或 host web route，理由见 `Design / Spec` §2.4。裁决是 `fallback-web` 时，**不换壳**，带着点名的缺口回到人类伙伴（#225 Notes）。
3. #226 上有一条评论：点名 transport，写明本次发现对 #227–#230 与 #140 的影响。它必须早于这些子 issue 中任何一个开工。
4. `tests/contract/harness-host-reprobe-record.test.js` 从 §11 的观测表机械推导裁决，推导结果必须等于记录里写的裁决；它同时锁住 §1–§10 的字节，并补 `disclosure` 扫描不到的盲区。

**最小成功证据**：

- `node --test tests/contract/harness-host-reprobe-record.test.js` 在 head 上通过；把记录换回 base 版本后失败，失败原因点名"§11 缺失"。
- `node scripts/rule-checks.mjs disclosure origin/main` 退出码 0。
- #226 评论的 `created_at` 早于 #227–#230 任一关联 PR 的 `createdAt`。

**首要防御对象**有两个。一是把"读了类型声明"写成"宿主能承载"，这是 #125 的教训。二是看过观测之后再改规则，让裁决迎合"希望走插件壳"。人类伙伴已经选了插件壳，所以这个诱因是真实的。

## Context and Orientation

### 术语

| 词 | 含义 |
|---|---|
| 宿主（host） | 本产品要嵌入的已安装运行时（公开 MIT 包，CLI 名 `dsh`）。命名口径见 `Decision Log` D10 |
| `$HOST_RUNTIME` | 宿主运行时的安装根：`~/.dsh/profiles/node_modules/@deepseek-ai/*` 这些符号链接所指向的目录再往上三层。它的绝对路径不入库 |
| `$SCRATCH` | 本次探针的一次性目录：`mktemp -d` 在系统临时目录下创建。`DSH_HOME=$SCRATCH/home` |
| scratch 宿主 | 以 `DSH_HOME=$SCRATCH/home` 启动的第二个宿主 Web 实例，与本机真实实例互不相干 |
| 探针包 | `$SCRATCH/probe` 下手写的纯 JS 插件包 `hp-reprobe@0.0.0`。不运行任何打包器，不入库 |
| S0–S3 | 观测强度，定义在 `Design / Spec` §2.1。裁决只跟 S3 |
| O-ID | 观测编号，定义在 `Design / Spec` §2.2，§11 的观测表逐行对应 |
| T0 | 探针第一条命令由 `date -u +%FT%TZ` 打出的时间；两个工作日的时限从它起算 |

### 当前事实（fact，均已在本会话复核）

以下 `$HOST_RUNTIME/...` 路径都省略公共前缀 `node_modules/@deepseek-ai/`。

| # | 事实 | 证据 |
|---|---|---|
| F1 | `dsh` 不在 PATH 上。入口是 `$HOST_RUNTIME/.../dsh/lib/bin.js`。`dsh plugin --profile <p> <pnpm-args>` 把参数原样转给 PATH 上的 pnpm，找不到 pnpm 时退出码为 127。本机 PATH 上的 pnpm 是 10.28.2。**Superseded by** `Surprises & Discoveries` 第 7、8 条（2026-09-30）：`PATH` 上的全局 pnpm 是 12.5.1，10.28.2 只在仓库目录里因 `packageManager` 字段出现；本机 `dsh plugin` 的实际失败模式是 `spawn ENOEXEC`（§11 M13），不是 127 | `dsh/lib/plugin-DkYIj96-.js:58-80`；`which dsh`（无输出）；`pnpm --version` |
| F2 | 兼容闸门**只**看 `peerDependencies` 里的 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`，预发布号参与匹配；`engines.dsh` 与 `dsh.manifestVersion` 不被强制。路径 spec 在安装前读盘预检；tarball spec 在安装后判定 | `dsh-app-boot/lib/index.js:286-316`；`dsh-package-manifest/README.md` Known Limitations；`dsh-plugin-manager/lib/types/operations.js:113-145,293-313` |
| F3 | 用户数据根由 `DSH_HOME` 决定，profile 在 `$DSH_HOME/profiles/<name>`。`dsh plugin` 首次使用会初始化 profile。web 应用接受 `--port 0` 与 `--no-open`，默认端口 3080。本机已有一个真实宿主实例在默认端口上监听 | `dsh-home-paths/lib/index.js:71-74`；`dsh/lib/plugin-DkYIj96-.js:37`；`dsh-web-app/lib/startup.js:22`；`dsh-web-app/cordis.patch.yml:168`；`lsof -nP -iTCP -sTCP:LISTEN`（2026-09-29 观察，只记"存在端口冲突风险"） |
| F4 | `dsh-base` 会装载会话遥测导出行；`DSH_TELEMETRY_DISABLED` 非空即可退出 | `dsh-base/cordis.patch.yml:189-209`；`dsh-app-boot/lib/index.js:997-1030` |
| F5 | web 应用启动时，会把**带认证令牌的 URL** 打到 stdout | `dsh-web-app/lib/index.js:198-203` |
| F6 | 类型化 Remote 的描述符与 codec 是 protocol 包的**公开类型**：`InvocationDescriptor`、`TypertCodec`、`TypertSchema { parse }`，包描述为 "Compiler-independent Remote metadata"。注册表只做结构校验；网关对 strict codec 只调用 `codec.create().parse(value)`；客户端 `$mount` 只要求输入侧 codec 为 strict。本机运行时里没有生成器包 | `dsh-typert-protocol/lib/types/types.d.ts:189-294`；`dsh-typert-registry/lib/index.js:522-566`；`dsh-api-gateway/lib/index.js:1501-1516`；`dsh-api-gateway/lib/types/client/index.js:136-157,587-602`；`ls "$HOST_RUNTIME"/node_modules/@deepseek-ai \| grep typert` → loader / protocol / registry |
| F7 | 网关在 `/api` 共享通道上占用了**唯一**的拦截器，第二个 `intercept('/api')` 会抛错。#125 §5.2 的 `intercept` 观测是在没有网关的裸 Context 里做的，**不能搬进 web profile**。插件可用的宿主 web 路由面有两个：`rpc.handle('/<channel>')`（channel 不能是 `/api`）和 `fetch.register({ path: '/api/<path>' })`。两者都先经过 `connection.admit` | `dsh-api-gateway/lib/index.js:624`；`dsh-client-connection/lib/index.js:665,756,759,829-842`；`dsh-client-connection/lib/types/rpc.d.ts:106-160` |
| F8 | web profile 开了 gzip，只豁免 `text/event-stream`。客户端断开后，HTTP 桥会中止 `request.signal`，但仍会把响应体读空 | `dsh-web-app/cordis.patch.yml:169-171`；`dsh-host-webserver/lib/index.js:106-117`；`dsh-client-connection/lib/index.js:34-38,94-95` |
| F9 | client resources 的宿主半边是空函数。provider 在浏览器里注册，帧语义是"ok 帧替换值"。**它不是一条线** | `dsh-client-resources/lib/index.js`（全文）；`dsh-client-resources/lib/types/client/contract.d.ts:62-72` |
| F10 | 页面挂法的先例：`ctx.slots.inject('main', …register({ name: 'main', key }))` 加一个 `sidebar.panellist` 入口。客户端 bundle 的形状是 `window.__ModuleLoader__.load({ id, factory })`。插件自己 `$mount` 自己的贡献也有先例 | `dsh-client-ui-schedule/lib/client.js:6793-6810`；最小样例 `dsh-client-ui-brand-official/lib/client.js`；`dsh-experimental-client-ui-voice-input/lib/client.js:5817-5845` |
| F11 | unary 结果经 `Response.json` 编码，流项经 `JSON.stringify` 编码，所以值为 `undefined` 的属性过线后变成**缺失键**，而不是被拒绝。`packages/controller/src/wire.ts` 里就有这类字段 | `dsh-client-connection/lib/index.js:723-737`；`dsh-api-gateway/lib/index.js:385-390`；`packages/controller/src/wire.ts:35,41,42` |
| F12 | Node v26.10.0 拒绝对 `node_modules` 下的 `.ts` 做类型擦除，所以装进 profile 的插件宿主半边必须是 JS | 本会话 2026-09-29T06:20:55Z 在临时目录复现：`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` |
| F13 | 在普通 Node 进程里（强度 S2），`f6a33d2` 上的 `composeCore` + `createSqliteStorage` + fake providers + `createController(HarnessManaged)` 能跑通：基线 revision 1、5 个实体。`applyPlanningStatus` 返回 `local_only`，watch 给出 1→2 的 delta。**#197 不挡这条组合** | 本会话 2026-09-29T06:16:47Z / 06:17:00Z；一次性脚本在仓库外，不保留 |
| F14 | `apps/harness-plugin` 仍是占位：只导出 `./src/index.ts`，没有 `dsh` 字段。boundaries 只许它依赖 domain / client / ui-model / ui。客户端 transport 是"基线 + poll"形状。watch 的保留窗口默认为 1 | `apps/harness-plugin/package.json`；`tests/contract/package-boundaries.test.js:86-91`；`packages/client/src/transport.ts:10-25`；`packages/controller/src/watch.ts:69` |
| F15 | 真实的凭据消费者是 execution-human：`issuerKey` 在构造时注入（至少 32 字节），缓存在实例里，并要求重启前后不变。宿主凭据的语义却是"按操作解析、不跨操作缓存"。两者在**轮换**这件事上冲突 | `packages/providers/execution-human/src/index.ts:9-12,45-46,128-137`；`$HOST_RUNTIME/.../dsh-credentials/README.md` Design philosophy 段 |
| F16 | `disclosure` 的家目录模式只认 `/Users/` 与 `/home/`，不覆盖系统临时目录、启动令牌和端口；宿主标识符也不在扫描范围内 | `scripts/rule-checks.mjs:50-68`；原记录 §2.4 |
| F17 | #225 是 #226 的子 issue，阻塞 #226 / #227 / #140。#226 目前 0 条评论；2026-09-29 时 #227–#230 都还没有关联 PR | `gh api repos/SingularityKChen/harness-projects/issues/225/dependencies/blocking`；`gh issue view 226 -R SingularityKChen/harness-projects --json comments` |
| F18 | "不写宿主产品名"出自 #125 计划自己的 Global Constraints。原记录第 8 行把它归到 `AGENTS.md` §7，但 §7 只列五类目。main 上和公开 issue #225–#230 里都已经写有宿主的公开标识符 | `docs/exec-plan/completed/2026-09-24-harness-host-spike.md:123`；`AGENTS.md` §7；`docs/development/content-placement.md:81`；#225 / #227 正文 |

### 硬约束（hard constraint）

`AGENTS.md` §1.1 不变量 3 / 7；§2 依赖方向；§7 发布面；人类伙伴本轮指令：代码 ≤800 行、文档 ≤1300 行；MMP 前不做兼容层；不写看板 `Status`；行为变更要有判别性测试，变异要先证明已生效；探针代码不合并（沿用 #125 D1）；不写真实用户数据根 `~/.dsh`。

### 假设（assumption，由 Batch 2 验证）

- A1：装一个零依赖的本地 tarball 时，pnpm 不需要联网。
- A2：web 模板 profile 在没有模型凭据的情况下，也能启动到可以渲染插件面板的程度。
- A3：宿主进程装了模块解析钩子，但对 `$HOST_RUNTIME` 与 profile 之外的目录走原生查找，所以探针宿主半边能用 file URL 导入工作树的 `.ts` 源码（依据：`dsh-app-boot/README.md` Design notes "Removing linked interception" 一条）。
- A4：Browser 窗格能访问 scratch 宿主在 127.0.0.1 上的临时端口，并读取 DOM、console 与网络请求。

### 未知（unknown）与主不确定性

**主不确定性是 O0 这条前置链**：在一次性 DSH_HOME 里，`dsh plugin add` 装入仓库外 tarball，scratch 宿主加载它的宿主半边，浏览器加载它手写的 client bundle。这条链卡住全部三个决定性问题，所以 O0 单独给 3 小时预算，并排在最前。

其余未知：U2，宿主进程内能否导入工作树 `.ts`（A3）；U3，手写贡献的 `$mount` 与 `/api/remote.mux` 流能否在浏览器里端到端跑通；U4，gzip 与 SSE 是否会互相干扰（只在走到 host web route 时才相关）。

### 三份独立设计与本计划的取舍

三份设计的视角分别是：①类型化 Remote 优先；②回退传输对比；③裁决判据、发布面卫生与探针去向。本计划的骨架取自③：预注册块、强度分级、捷径台账、canary 扫描、契约测试。transport 的机制取自①：手写 strict 描述符，`ctx.typert.register` 加 `$mount`，由 stream Remote 承载 watch。宿主 web 路由面的具体做法与失败路径取自②：`rpc.handle` 加 `fetch.register` 的 SSE、禁用 `intercept('/api')`、绑定 `request.signal`、准入负例。逐条评审结论与拒绝理由见 `Decision Log` D2–D8；三份设计各自的错误列在 `Surprises & Discoveries` 第 1–4 条。

## Design / Spec

### 1. 交付物与形状

- 本 PR 的交付物：记录 §11、契约测试、本计划、两处索引行。文件清单只在 `Global Constraints` 写一次。
- 外部写入：#226 上一条评论，以及 draft PR 本身。
- 探针只在 `$SCRATCH` 里，永不入库。理由同 #125 D1：记录与实现两份事实会互相污染。另一个理由是 #227 的验收要求"从干净检出构建、不含业务组件"，而探针形态恰好相反：手写 bundle，宿主半边用 file URL 导入仓库源码。

### 2. 预注册块

下面标记之间的内容，在 T0 之前随 Batch 0 的提交与 draft PR 一起推送（D3）。T0 之后如需修改，只能由人类伙伴在 `Decision Log` 里点名批准，并且 §11 必须显式写出"规则在观测后被修改"。复核命令见 `Validation and Acceptance` 第 7 行。

<!-- verdict-rule:begin -->

#### 2.1 强度分级

| 级 | 定义 |
|---|---|
| S0 | 未尝试，或尝试在子预算内没有得到结果 |
| S1 | 机制存在：静态读到了服务键、符号或文件角色 |
| S2 | 在普通 Node 进程里实测（相当于 #125 §5.2 的水平） |
| S3 | 在"经 `dsh plugin add` 装入 scratch profile、由 scratch 宿主 boot 加载"的插件里实测。客户端项另有一条要求：页面必须由该 scratch 宿主服务，并在真实浏览器（Browser 窗格）里打开。jsdom 与假 DOM 一律不算 |

裁决只跟 S3。S1 与 S2 只能写进记录，不参与判定。

#### 2.2 最小观测集（O-ID 固定，§11 观测表逐行对应）

**O0 前置：安装与加载（按 Q4 计）**

| O-ID | 判据（全部要求 S3） |
|---|---|
| O0.1 | 在 `DSH_HOME=$SCRATCH/home` 下执行 `dsh plugin --profile web add <探针 tarball>`，退出码为 0；全程没有使用 `allow-version`，也没有使用 `--accept-risk` |
| O0.2 | 同一个 scratch 宿主启动后，探针宿主半边在 host.log 里打出就绪行，并且启动审计里没有以探针条目为源的失败 fiber |
| O0.3 | 浏览器里探针 client bundle 的 factory 执行，console 出现以模块 id `hp-reprobe` 为源的就绪行 |

**Q2 凭据引用按操作解析**

"操作"指探针宿主半边的一次方法调用。优先经已命名的 transport 从页面触发；如果 Q3 未观测到，允许宿主半边在 apply 之后用定时器触发两次，强度栏照实写。

| O-ID | 判据 |
|---|---|
| O2.1 | 宿主半边在**操作内**调用 `ctx.credentials.resolve(credentialRef('HP_REPROBE_ISSUER_KEY'))` 拿到值，而不是在 apply 时预取。日志只打印 `source` 和 sha256 的前 8 位 |
| O2.2 | 两次操作之间，把凭据值从 v1 改成 v2：优先直接改 scratch 凭据存储文件（mode 600），不行再改用 `ctx.credentials.set`，并记录用了哪种。不重启宿主，也不重载插件。第二次操作得到的摘要等于 sha256(v2) 的前 8 位 |
| O2.3 | 同一次操作里，经 controller 执行一条会写库的命令，写入宿主拥有目录下的 SQLite 项目库（`$DSH_HOME/hp-reprobe/workspace.sqlite`）。操作后库文件的 mtime 前进。库文件及其 `-wal`、`-shm` 按字节扫描，不含 v1、v2 的原文，也不含它们的 base64 形式 |

**Q3 插件客户端到达 controller 的查询、命令与 watch 流**

| O-ID | 判据 |
|---|---|
| O3.1 | 浏览器里，插件客户端发起一次查询：页面显示的 revision 与实体数，等于同一次运行里 host.log 打出的值 |
| O3.2 | 浏览器里，插件客户端发起一次命令：对一个未完成的工作项执行 `applyPlanningStatus`，返回 `local_only`。之后的查询显示 revision 加 1 |
| O3.3 | 在同一个流句柄（或同一个 SSE 响应）上，先收到 baseline（revision R）；订阅之后由 O3.2 触发变更，再收到一条 delta，`previousRevision = R`、`revision = R + 1`。期间页面不刷新 |
| O3.4 | 用 `read_network_requests` 判定线缆：typed remote 表现为 `/api` 上的 POST 加上 `/api/remote.mux` 的 WebSocket；host web route 表现为 `/hp-reprobe/<endpoint>` 的 POST 加上 `/api/hp-reprobe/watch` 的 GET 流。据此给 transport 归类 |
| O3.5 | 所命名 transport 的每个入口，不带认证 cookie 时返回 401，伪造 `Host` 头时返回 403（用 `curl -s -o /dev/null -w '%{http_code}'`；WebSocket 入口加 `Upgrade: websocket` 头）。入口清单：typed remote 是 `/api` 上探针端点的 POST 与 `/api/remote.mux` 的 upgrade；host web route 是 `/hp-reprobe/<endpoint>` 与 `/api/hp-reprobe/watch`。带认证时入口可达，这一点由 O3.1–O3.3 证明。对照组只对 `/api` 之外的入口有意义：在没装探针的 scratch 宿主上，同一路径返回 404，说明 401 来自探针路由自身的准入，而不是因为路径不存在。这条同时证明探针没有用裸 `webServer.register` 绕开准入 |

**Q4 一个只读页面挂进插槽**

| O-ID | 判据 |
|---|---|
| O4.1 | client bundle 用 `ctx.slots.inject('main', …)` 注册键控面板 `hp-reprobe`，并用 `sidebar.panellist` 注册入口；入口出现在可访问性树里 |
| O4.2 | 选中入口后，`main` 插槽里出现只读列表，行数等于 O3.1 的实体数；O3.3 的 delta 到达后，被改的那一行在不刷新页面的情况下更新。这一条把 Q3 与 Q4 绑在同一个页面上，防止出现"页面是静态假数据" |
| O4.3 | console 里没有以 `hp-reprobe` 为源的错误 |

**非决定项**（只写给 #228 / #229，不参与裁决，各自不超过 1 小时，按剩余预算依次做）

| O-ID | 内容 |
|---|---|
| O2.4 | 用 v1 在操作内构造 `HumanExecutionProvider` 并 `startRun` 得到 ref1；轮换到 v2 之后，用 v2 构造的实例执行 `getRun(ref1)`，记录它被拒绝的确切错误。这条给 #228 的轮换策略提供证据 |
| O3.6 | 停掉 scratch 宿主再重启，页面进入"重连中"并重拉 baseline |
| O3.7 | 发一个非法参数，得到 `gateway/input-invalid`。变异对照：把宿主侧的 parse 换成恒等函数后重装，host.log 必须先出现变异标记 `hp-reprobe-mutation=identity-parse`，再看结果翻转，然后恢复 |
| O3.8 | 客户端释放流句柄后，host.log 出现 `watch closed`，并且 poll 计数停止增长 |
| O3.9 | 仓库外能否获得并运行一个契约生成器（官方文档留下的开放点）。只记"是否找到、从哪里来"，不影响 transport 资格 |

#### 2.3 裁决规则

1. **`embed` 当且仅当**同时满足：
   - O0.1–O0.3、O2.1–O2.3、O3.1–O3.5、O4.1–O4.3 全部是"已观测到"，强度全部为 S3；
   - 捷径台账里没有任何一行"影响判定 = 是"指向上述 O-ID。
2. **其余情况一律 `fallback-web`**。不存在"附条件 embed""部分观测到"这类中间态。
3. **决定它的答案**：按 Q4 → Q3 → Q2 的顺序，取第一个存在失败项的问题；O0 失败算作 Q4。`embed` 时没有失败项，写 Q4，因为它最直接决定"页面能不能出现在宿主里"。其余失败项另列。
4. **`fallback-web` 时**：不换壳，不改任何子 issue 的范围，也不写 `Status` 或 blocked-by 关系。只在 #226 上点名缺口，交回人类伙伴。

#### 2.4 transport 的命名与资格（只在 `embed` 时写）

1. **可以被点名的只有两条线**，按下面的顺序取第一条在同一次运行里满足 O3.1–O3.5 的：
   - **typed remote**：宿主半边用 `ctx.typert.register` 注册手写的 strict 描述符，并用 `TypertRemoteService` 或 `bindTypertRemote` 绑定服务；客户端用 `ctx.remote.$mount` 挂载同一份描述符。unary 走网关的 `/api`，watch 用 stream Remote，经 `/api/remote.mux`。
   - **host web route**：unary 用 `ctx.connection.rpc.handle('/hp-reprobe', …)` 加客户端的 `rpc.call`；watch 用 `ctx.connection.fetch.register({ path: '/api/hp-reprobe/watch', methods: ['GET'], requestBody: 'buffered', fetch })` 返回 `text/event-stream`，客户端用 fetch 加 reader 读取，不用 EventSource；服务端流必须绑定 `request.signal`。禁止使用 `intercept('/api')`（F7），也禁止使用裸 `webServer.register`。
2. **client resource stream 不能单独被点名**：它是浏览器侧的寻址与缓存层（F9），只能叠在上面两条线之一上。记录里写成"消费层"。
3. **手写 strict 描述符算 typed remote，不算捷径**。依据：描述符、codec 与 schema 都是公开类型，运行时只做结构校验（F6）。记录里单列"契约来源 = 手写，类型取自 `InvocationDescriptor`"，并写明它与 rc 版描述符格式的耦合。
4. **host web route 只在以下条件下尝试**：typed remote 在子预算内没有满足 O3.1–O3.5，并且剩余预算不少于 2 小时。
5. **排序理由**：typed remote 由宿主托管重连代际，`$stream` 在每一代都会重新接受开场值，这正是 #226 验收项 4"重连后重拉基线"需要的语义；它在 WebSocket upgrade 时经 Peer 准入；在 worker-preview 载体上它会改走 `connection.rpc.open`（`dsh-api-gateway/lib/types/client/index.js:92-100`）。host web route 要自己定帧格式、自己处理中止与重连，而插件自己发的 fetch 不经过 worker 隧道。

#### 2.5 捷径台账

§11 用固定表格记录捷径，列为：捷径 | 影响的 O-ID | 影响判定（是 / 否）| 理由。以下几行预先定性，执行时不得改判：

| 捷径 | 影响判定 | 理由 |
|---|---|---|
| 手写 `lib/client.js`，不用打包器 | 否 | 用的正是宿主消费的格式（F10）；由构建产出是 #227 的事 |
| 宿主半边用 file URL 导入工作树的 `.ts` 源码 | 否 | 不改变宿主承载什么。作为硬事实交给 #227：安装件必须是构建后的 JS（F12） |
| fake providers 加种子数据 | 否 | #225 只问承载能力，不问数据源 |
| 手写 strict 描述符 | 否 | 见 §2.4 第 3 条 |
| 使用 `allow-version --accept-risk` | 是（O0.1） | 绕过兼容闸门 |
| 用 jsdom 或假 DOM 代替浏览器 | 是（所有客户端项） | 不是宿主的真实载体 |

执行中新出现的捷径必须追加进台账，影响判定按"是否改变该 O-ID 所问的承载事实"来判。

#### 2.6 时限与停止规则

1. 总预算：从 T0 起 2 个工作日，按 16 个工作小时计。
2. 子预算与顺序：

   | 段 | 子预算 |
   |---|---|
   | 静态机制证据 | 1h |
   | O0 | 3h |
   | Q4 | 2h |
   | Q3（typed remote） | 3h |
   | Q3（host web route，仅在 §2.4 第 4 条成立时） | 2h |
   | Q2 | 2h |
   | 记录与验证 | 3h |
   | 非决定项 | 只用剩余预算 |

3. 某条决定性观测耗尽子预算，就记为"未观测到"，写清尝试过什么、卡在哪里，然后继续下一段。不借用后面各段的预算。
4. O0 失败时立即停止全部浏览器项，按 §2.3 判为 `fallback-web`（Q4）。
5. 延期只能由人类伙伴在 `Decision Log` 里批准。
6. 每完成一条观测，立即把脱敏摘录写进 §11 草稿，并做一次本地 WIP 提交。原始 jsonl 只放在 `$SCRATCH`。

<!-- verdict-rule:end -->

### 3. 探针设计（仓库外、一次性、不合并）

**环境**（命令在 `$SCRATCH` 下运行，不在仓库根运行，以免读到任何 `.env`）：

```bash
export HOST_RUNTIME=<宿主运行时根>                  # 不入库；见 Context 的术语表
export SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/hp-reprobe.XXXXXX")"
export DSH_HOME="$SCRATCH/home" DSH_TELEMETRY_DISABLED=1
export HARNESS_PROJECTS_ROOT=<检出 test/harness-plugin-reprobe 的工作树根>
dsh_s() { case "$DSH_HOME" in "$SCRATCH/home") node "$HOST_RUNTIME/node_modules/@deepseek-ai/dsh/lib/bin.js" "$@" ;; *) echo "refuse: DSH_HOME is not scratch" >&2; return 2 ;; esac; }
touch "$SCRATCH/marker"; date -u +%FT%TZ          # 这一行打出的时间就是 T0
```

**探针包 `$SCRATCH/probe`**，全部手写 JS：

- `package.json`：
  - `name: hp-reprobe`，`version: 0.0.0`，`type: module`；
  - `dsh.manifestVersion: 1`；`dsh.bundle.patch: ./cordis.patch.yml`；
  - `dsh.client: { platform: 'web', inject: [网关、connection、layout、sidebar 四个包名] }`，作为排序边；
  - `exports` 含 `.`、`./client`、`./cordis.patch.yml`、`./package.json`；
  - `peerDependencies` 只有 `@deepseek-ai/cordis: ~4.0.4`，以及用到的 `@deepseek-ai/dsh-*` 包，版本精确写 `0.1.7-rc.2`，这样能通过 F2 的闸门而无需豁免；
  - 没有 `dependencies`。
- `cordis.patch.yml`：`- insert: [{ id: hp-reprobe, name: hp-reprobe }]`。
- `lib/index.js`（宿主半边）：
  - 用 `pathToFileURL(HARNESS_PROJECTS_ROOT + '/packages/<包>/src/index.ts')` 导入 core、controller、fake、storage-sqlite、domain、execution-human；
  - 在 `$DSH_HOME/hp-reprobe/workspace.sqlite` 上组合 core 与 controller（`HarnessManaged`）。组合失败时退回 MemoryStorage，照实记录，此时 O2.3 记为"未观测到"；
  - 注册服务 `hpReprobe`，方法有 `snapshot()`、`applyPlanningStatus(entityId, status)`、stream 方法 `watch(signal)`、`credentialProbe()`，以及可选的 `issuerProbe(ref)`。`watch` 先产出 `{ kind: 'baseline', snapshot }`，之后每 250ms `poll` 一次，产出 delta，遇到 gap 就结束；
  - 调用 `ctx.typert.register({ package: 'hp-reprobe', face: 'host', schemas: [], model: { services: [], events: [], objects: [] }, invocations })`。**不导出 `./typert`**，避免 typert-loader 自动发现后重复注册；
  - 每条观测写一行 JSON 到 stdout，格式 `{"probe":"hp-reprobe","at":<ISO>,…}`；
  - 在 effect 的 disposer 里关闭存储，并打一行 `storage closed`。
- `lib/client.js`：
  - 形状是 `window.__ModuleLoader__.load({ id: 'hp-reprobe', factory })`，只 `require('react')`；
  - apply 里先 `await ctx.remote.$mount(同一份描述符)`，再 `ctx.inject(['remote.hpReprobe', 'slots'], …)` 注册 `main` 面板和 `sidebar.panellist` 入口；
  - 面板用 `React.createElement` 渲染列表，外加一个"触发命令"按钮；
  - 每条观测以一行 JSON 写到 console。
- 描述符：用 `{ mode: 'strict', typeSymbol: 'hp-reprobe#<名字>', create: () => ({ parse }) }`。`parse` 手写，只校验 `entityId` 是非空字符串、`status` 属于规划状态枚举，不引入 zod。
- host web route 变体：只在 §2.4 第 4 条成立时，才往同一个包里追加。

**浏览器驱动**：

- 用 Browser 窗格打开 host.log 里打印的认证 URL。令牌与端口不入记录，统一写作 `<scratch-url>`。
- 用 `read_page` 取可访问性树，用 `read_console_messages` 取 JSON 行，用 `read_network_requests` 判定线缆。
- **前置条件是 Decision Log D15 的人类确认**。

### 4. §11 的格式契约（契约测试据此解析）

```text
## 11. 复探（issue #225）：仓库外插件包装进一次性 profile 之后
### 11.1 范围与口径        ← 第 8 行的"不写宿主产品名"只覆盖 §1–§10，并说明它误引了 AGENTS.md §7（F18）
### 11.2 观测环境          ← 其中两行固定为：`- 预注册：`<sha>` @ <ISO UTC>` 与 `- T0：<ISO UTC>`
### 11.3 观测表            ← 列：| ID | 问题 | 判据 | 命令或动作 | 结果 | 强度 | 时间（UTC） |
                              结果只能是 已观测到 / 未观测到；强度只能是 S0–S3；命令单元格含反引号
                              结果栏只留这两个词，读数放在表后的「观测摘录」里，按 ID 对应（D21）
### 11.4 静态机制证据      ← 行号 M1…；不带 O-ID，不参与推导
### 11.5 捷径台账          ← 列：| 捷径 | 影响的 O-ID | 影响判定 | 理由 |
                              只列实际采用的捷径（D21）；影响的 O-ID 逐个列出，不写 O3.x 或范围（D23）
### 11.6 裁决              ← 三行引用：`> 裁决：`embed`|`fallback-web``、`> 决定它的答案：Q<n>（…）`、
                              `> transport：typed remote|host web route（…）`（只在 embed 时出现）
### 11.7 交给子 issue 的事实
### 11.8 #226 评论         ← 链接、created_at、发出前的核对时间
### 11.9 未观测到清单与复核方法
```

### 5. 契约测试 `tests/contract/harness-host-reprobe-record.test.js`

测试离线运行：只读文档，不跑 git，不联网。按 `tests/contract/e1-evidence-consistency.test.js` 的先例，响亮失败，不静默跳过。

- **(a) 原记录不动**：从文件开头到 `## 11.` 行之前的内容，去掉尾部空白再补一个 `\n`，其 sha256 必须等于常量。常量由 `f6a33d2` 的文件按同样规则算出，计算命令写在测试头注释里。§11 缺失，或出现第二个 `## 11.`，都要失败。
- **(b) 裁决由观测表机械推导**：`deriveVerdict(rows, shortcuts)` 一比一实现 §2.3，推导出的 `{ verdict, deciding }` 必须等于 §11.6 的声明。每个决定性 O-ID 恰好出现一次。
- **(c) transport 与 verdict 的共存关系**：`embed` 时恰好一行 transport，取值属于 {typed remote, host web route}；`fallback-web` 时不能有 transport 行。
- **(d) 时间**：每一行的时间都是 `YYYY-MM-DDTHH:MM:SSZ` 格式，不早于声明的预注册时间；决定性行还要满足 T0 ≤ t ≤ T0 + 4 天（用日历时间近似"16 个工作小时"的上限）。
- **(e) 卫生**：§11 不得匹配 `/\/var\/folders|\/private\/(var|tmp)|\/tmp\/|token=|localhost:\d|127\.0\.0\.1:\d|\/Users\/|\/home\//`。
- **fixture 用例**：在测试文件里内联几张合成观测表，覆盖以下情形：全过 → embed；某一行 Q3 失败 → fallback-web(Q3)；Q4 与 Q2 同时失败 → Q4；某条捷径"影响判定 = 是" → fallback；某一行强度为 S2 → fallback。

### 6. 发布面卫生

1. **命名口径**（D10）。§11 与本计划可以写宿主的公开标识符：`dsh` CLI、`dsh.*` manifest 键、`@deepseek-ai/*` 公开包名、官方文档 URL、公开版本号。以下内容一律不写：`$HOST_RUNTIME`、`$SCRATCH`、`$DSH_HOME` 的真实值，端口，令牌，本机用户名与主机名。
2. **canary 扫描**。探针运行时把以下实际值收进 `$SCRATCH/canaries.txt`：认证 URL 与其中的令牌、`$SCRATCH` 的 realpath、`$TMPDIR` 的 realpath、`$HOST_RUNTIME` 的 realpath 及其 npx 缓存哈希段、`id -un`、`hostname -s`、scratch 端口。每次提交前、开 PR 前、发 #226 评论前，都对 diff、提交信息、PR 正文草稿和评论草稿执行 `grep -F -f "$SCRATCH/canaries.txt"`，结果必须为空。`canaries.txt` 放进工作树本身就是泄露，所以它永不进入工作树。
3. **真实数据根不动**。所有宿主命令只经 `dsh_s` 执行。收尾时执行 `find ~/.dsh/profiles -newer "$SCRATCH/marker" -not -path '*/node_modules/*'`，逐条核对命中项；本机真实实例的并发写入要按 mtime 与探针窗口排除。再执行 `grep -rlF "$SCRATCH" ~/.dsh/profiles --include='*.yml' --include='*.json'`，应为空。记录里只写计数，不写路径。
4. **假凭据**用至少 32 字节的可读低熵串（O2.4 要满足 `MIN_ISSUER_KEY_BYTES`），例如 `hp-reprobe-issuer-key-v1-0000000000`。不做成令牌形状。日志和记录里只出现 sha256 前 8 位。

### 7. #226 评论（英文，公开 issue 语言规则）

- **时机**：裁决写定之后立刻发，并且早于 #227–#230 的第一个 draft PR。发之前先核对，并把核对时间写进 §11.8。核对命令见 Batch 6。
- **内容**：
  1. 裁决、决定它的答案、transport（`embed` 时），以及契约来源。
  2. client resource stream 是消费层，不是一条线（F9）。
  3. 对各子 issue 的影响：
     - #227：宿主入口必须是构建后的 JS，打包时要把 `@harness-projects/*` 一并打进去，产物不能有 `workspace:*` 依赖；client bundle 的形状，以及 external 的来源；兼容闸门只看 `@deepseek-ai/dsh-*` 的 peer（F2、F12）。
     - #228：transport 与契约的写法（`satisfies` 绑定 `InvocationDescriptor`）；宿主入口依赖 controller / core / storage 需要一份 ADR，并同步修改 boundaries；issuerKey 的轮换冲突（F15、O2.4）；值为 `undefined` 的字段过线后变成缺失键（F11）；`intercept('/api')` 不可用（F7）。
     - #229：`main` 键控插槽加 `sidebar.panellist` 入口；重连语义（O3.6，如果观测到的话）。
     - #230：用 `dsh plugin add <tgz>` 安装；`engines.dsh` 不被强制。
     - #140：#225 没有观测宿主会话接口；blocked-by 关系是否解除由人类伙伴决定。
- **`fallback-web` 时**：只点名缺口与决定它的答案，请人类伙伴决定，不改任何子 issue。
- **发出之后**：如果记录在评审中改动，一律追加可见的订正回复，不编辑原评论（沿用 #125 D8）。

### 8. 被放弃的方案

- **把 host web route 定为首选**（设计②的 D6）：放弃。它自己的事实就说明插件发的 fetch 不经过 worker 隧道；它还要自己实现重连代际，而这正是 #226 验收项 4 要的语义。它的真实优点是版本耦合更低，这一点作为风险写进 #226 评论，由 #228 决定是否改选。
- **手写描述符不计入观测**（设计②的 D7、设计③的 T1 资格规则）：放弃，理由见 §2.4 第 3 条。这条规则会让 transport 系统性地偏向没有宿主托管重连的那一条。
- **把"一元 RPC 加 poll、底层是 `intercept('/api')`"排为第二档**（设计③的 T2）：放弃。`/api` 的拦截器已被网关占用（F7）；而且它把消费层当成了线缆。
- **在 web profile 里用 `intercept('/api')` 作次选 unary**（设计①）：放弃，原因同上。
- **用 `engines.dsh` 声明兼容版本**（设计③）：放弃。它不被强制；真正的闸门是 `@deepseek-ai/dsh-*` 的 peer（F2）。
- **先把探针提交进仓库再删掉，或推到一个不合并的公开分支**：放弃。rebase merge 会把它留在 main 的历史里；分支本身就是发布面。
- **本 PR 就把 `apps/harness-plugin` 做成可合并的实现**：放弃。那是 #227 的交付物，还牵涉打包器与 lockfile 的决策。

### 9. 评审者会怎么打破它（设计时预列）

| # | 打破方式 | 挡法 |
|---|---|---|
| 1 | 看过观测之后改规则 | 预注册块加 draft PR 的 `createdAt`；Validation 第 7 行的 diff |
| 2 | 把 S2 当成 S3 | 强度列加 `deriveVerdict` |
| 3 | 页面挂上了，但显示的是静态数据 | O4.2 绑定 O3.1 与 O3.3 |
| 4 | delta 其实是订阅之前的变更，或者其实是重拉基线 | O3.3 要求同一句柄、先 baseline、订阅之后再触发，并且 `previousRevision = R` |
| 5 | 探针用裸 `webServer.register` 绕开准入 | O3.5 的 401 / 403 与对照组 404 |
| 6 | 把 #125 §5.2 的 `intercept` 结论搬进 web profile | F7；§2.4 禁用 |
| 7 | 泄露走 `disclosure` 的盲区：临时路径、令牌、端口 | canary 扫描；契约测试 (e) |
| 8 | 真实 `~/.dsh` 被写 | `dsh_s` 守卫；marker 加 grep 核对 |
| 9 | 凭据其实被缓存了 | O2.2 不重启、不重载，摘要必须改变 |
| 10 | 测试常量与 `deriveVerdict` 被同时改掉 | 验收时把测试与预注册块并排核对；变异表只在最终树上重测（记忆规则：修复本身也要复评） |
| 11 | 整理提交时丢了文件，或改掉了预注册提交 | 预注册提交保持独立；改写后用 `comm` 比对新旧 head 的文件集合 |
| 12 | #226 评论晚于子 issue 开工，重演 #125 的 8 分 53 秒 | 裁决一定就发，发之前回读并记录核对时间 |
| 13 | 时间戳是手打的 | 时间只取 jsonl 里由 `date -u` 或 `new Date().toISOString()` 生成的值 |

## Global Constraints

- **本任务改动的文件集合**（只此一份；`Plan of Work`、`Progress` 与 `Decision Log` 不复述）：

  | 文件 | 改动 | owner |
  |---|---|---|
  | `docs/architecture/harness-host-spike.md` | 只在文件末尾追加 §11，§1–§10 逐字节不动 | 任务 B |
  | `tests/contract/harness-host-reprobe-record.test.js` | 新增 | 任务 A |
  | `docs/exec-plan/completed/2026-09-29-harness-plugin-reprobe.md` | 本文件；2026-09-30 授权收尾归档 | 主会话 |
  | `docs/README.md` | Active 表加一行，归档时移入 Completed | 主会话 |
  | `docs/architecture/README.md` | `harness-host-spike.md` 的索引描述补一句 §11 | 主会话 |
  | `docs/project-management/merge-queue.md` | §4.8 记录人类授权的 #238 → #244 → #245 整合顺序与回读规则 | 主会话 |

- **禁止改动**：`apps/**`、`packages/**`、`scripts/**`、其他 `tests/**`、`.github/**`、`package.json`、`pnpm-lock.yaml`。探针只在 `$SCRATCH`。
- **规模**：代码 ≤800 行（预计约 130 行，即契约测试）；文档 ≤1300 行（预计约 880 行：本计划约 620 行，§11 约 250 行，两处索引各 1 行）。度量命令是 `node scripts/rule-checks.mjs size origin/main`。超出时先压缩本计划的 Context 与 §11 的静态证据表，不拆 PR。
- **不新增依赖**。沙箱下所有 pnpm 命令都加前缀 `npm_config_manage_package_manager_versions=false`。
- **语言**：文档正文用中文；代码标识符、路径和命令用英文；#226 评论与 PR 的 issue 引用用英文。
- **宿主命令**：只经 `dsh_s` 执行，只在 `DSH_HOME=$SCRATCH/home` 下执行，只用 `--port 0 --no-open` 启动，并设置 `DSH_TELEMETRY_DISABLED=1`。
- **Git 与 GitHub**：不写看板 `Status` 或 blocked-by 关系；不 push `main`；不自行合并。提交正文只写 `Refs #225`，不写任何关闭关键字；`Closes #225` 只出现在 PR 正文里。
- **账号**：开发、提交、评论、PR 用开发账号；评审用评审账号（记忆规则"评审与开发分账号"）。

## Plan of Work

### Batch 0 · 预注册与 draft PR（主会话）

**最小闭环**：本计划与索引行提交并推送；draft PR 建立，关联 #225；预注册 sha 与 PR `createdAt` 写进 `Progress`。

**涉及文件**：本计划、`docs/README.md`。

- [ ] 执行 `AGENTS.md` §6 的四项工作区检查。
- [ ] 提交 `docs(exec-plan): 为宿主嵌入复探写计划并预注册裁决规则`，正文写 `Refs #225`。执行 `git push -u origin test/harness-plugin-reprobe`。
- [ ] `gh pr create -R SingularityKChen/harness-projects --draft --base main --title 'test(apps): 用仓库外插件包复探宿主嵌入并给出裁决' --label kind:test --label area:apps --label area:architecture --label area:tests --milestone 'M4 · MVP Demo：Harness 内打通 GitHub 链路' --body-file <草稿>`。PR 正文含 `Closes #225` 与 `Refs #226 #227 #228 #140`。
- [ ] 回读 PR 状态与 issue 关联，把预注册 sha（`git log -1 --format='%H %aI'`）与 PR 的 `createdAt` 写进 `Progress`，再做一次提交。
- [x] (2026-09-29) 人类伙伴在会话中确认 D15（主会话用内置浏览器打开）与 D10（放开公开标识符）；D5、D6、D7 按默认值执行，人类伙伴未推翻。

**验证**：

- `gh pr view <n> -R SingularityKChen/harness-projects --json isDraft,baseRefName,closingIssuesReferences --jq '[.isDraft,.baseRefName,(.closingIssuesReferences|map(.number))]'`，期望 `[true,"main",[225]]`；
- `node scripts/rule-checks.mjs disclosure origin/main` 退出码 0；
- `git diff --check origin/main...HEAD` 无输出。

**回滚**：`gh pr close <n>`；`git reset --hard origin/main`，再删除远端分支。这一批只动文档。

### Batch 1 · 记录一致性契约测试（任务 A，与 Batch 2–4 并行）

**最小闭环**：契约测试里的 fixture 用例全部通过；针对真实记录的用例在 §11 缺失时响亮失败。

**涉及文件**：`tests/contract/harness-host-reprobe-record.test.js`。

- [ ] 在独立工作树 `.worktrees/harness-plugin-reprobe-record-test`（分支 `test/harness-plugin-reprobe-record-test`，基于预注册提交）里，按 `Design / Spec` §5 写测试。先写 fixture 用例，看它们失败，再实现 `deriveVerdict` 与解析器。
- [ ] 用 `git show f6a33d2:docs/architecture/harness-host-spike.md` 按 §5(a) 的规则算出常量；计算命令写进测试头注释。
- [ ] 变异自检：把 `deriveVerdict` 的点名顺序改成 Q2 → Q3 → Q4，先用 `git diff --stat` 证明变异已经应用，再看 fixture 变红；恢复后再看它变绿。

**验证**：`node --test tests/contract/harness-host-reprobe-record.test.js`。期望 fixture 用例全部通过；真实记录用例失败，消息含"§11"。行数用 `wc -l tests/contract/harness-host-reprobe-record.test.js` 查看，期望 ≤160。

**回滚**：删除该分支与工作树；主分支不受影响。

### Batch 2 · 静态机制证据与 O0（任务 B）

**最小闭环**：§11.4 的 M 行写完；O0.1–O0.3 各自落到"已观测到"或"未观测到"加原因。

**涉及文件**：`docs/architecture/harness-host-spike.md`（§11 草稿）；`$SCRATCH/**`（仓库外）。

- [ ] 在工作树里执行 `npm_config_manage_package_manager_versions=false pnpm install --frozen-lockfile`，只写被忽略的 `node_modules`。
- [ ] 按 `Design / Spec` §3 建立环境，打出 T0；收集 canary；对 F1–F11 逐条重跑取证命令，结果写进 M 行，每行带 UTC 时间。
- [ ] 手写探针包。第一版的宿主方法只返回常量，与装配 controller 分开，先验证链路本身（U2 的隔离步骤）。
- [ ] 依次执行 `(cd "$SCRATCH/probe" && pnpm pack --pack-destination "$SCRATCH")` 与 `(cd "$SCRATCH" && dsh_s plugin --profile web add "$SCRATCH/hp-reprobe-0.0.0.tgz")`，记录退出码与脱敏输出（O0.1）。
- [ ] `(cd "$SCRATCH" && dsh_s web --no-open --port 0 > "$SCRATCH/host.log" 2>&1 &)`。启动前后各跑一次 `lsof -nP -iTCP -sTCP:LISTEN`，确认没有和真实实例争用端口。读 host.log 判定 O0.2。
- [ ] 每条观测写完，立刻做一次本地 WIP 提交。

**验证**：

- host.log 里有探针就绪行，没有以探针条目为源的失败 fiber；
- `git diff origin/main...HEAD | grep -F -f "$SCRATCH/canaries.txt"` 无输出；
- `git status --short` 只有 `docs/` 下的改动。

**回滚**：停掉 scratch 宿主进程。`$SCRATCH` 留给系统回收，不做破坏性删除。§11 草稿按 WIP 提交回退。

### Batch 3 · Q4 与 Q3 在浏览器里（任务 B；浏览器步骤由持有 Browser 窗格的会话执行）

**最小闭环**：O0.3、O4.1–O4.3、O3.1–O3.5 各自落到"已观测到"或"未观测到"。

**涉及文件**：`docs/architecture/harness-host-spike.md`（§11 草稿）。

- [ ] 前置：D15 已确认。打开 `<scratch-url>`，读 console 判定 O0.3。
- [ ] 选中 `sidebar.panellist` 里的入口，用 `read_page` 判定 O4.1 与 O4.2 的行数，用 `read_console_messages` 判定 O4.3。
- [ ] 判定 O3.1；点击"触发命令"判定 O3.2 与 O3.3；用 `read_network_requests` 判定 O3.4；用 curl 做 O3.5 的准入负例，以及未装探针时的对照组。
- [ ] typed remote 在子预算内没有满足条件、并且剩余预算不少于 2 小时时，按 `Design / Spec` §2.4 追加 host web route 变体，重装后重跑 O3.x。
- [ ] 执行 `Design / Spec` §2.6 的停止规则。

**验证**：每一行 O 记录都有命令或浏览器动作、脱敏摘录、强度和 UTC 时间；canary 扫描为空。

**回滚**：同 Batch 2。

### Batch 4 · Q2 与非决定项（任务 B）

**最小闭环**：O2.1–O2.3 各自落到"已观测到"或"未观测到"；非决定项按剩余预算执行。

**涉及文件**：`docs/architecture/harness-host-spike.md`（§11 草稿）。

- [ ] 把 v1 写进 scratch 凭据存储（mode 600），触发操作 1。把 v1 改成 v2，不重启，触发操作 2。对库文件及其 `-wal`、`-shm` 按字节执行 `grep -c -F`，对 v1、v2 的原文和 base64 形式各扫一遍。
- [ ] 按剩余预算依次做 O2.4、O3.6、O3.7、O3.8、O3.9。O3.7 的变异必须先在 host.log 里看到标记行，才能判定结果。

**验证**：O2.x 各行完整；`find ~/.dsh/profiles -newer "$SCRATCH/marker" -not -path '*/node_modules/*'` 的命中项已逐条核对；canary 扫描为空。

**回滚**：同 Batch 2。

### Batch 5 · §11 定稿与对抗验证（任务 B 写，任务 C 验）

**最小闭环**：§11 按 `Design / Spec` §4 的格式写定；对抗验证者对每一条"已观测到"都尝试证伪，没有未处理的 P0 / P1。

**涉及文件**：`docs/architecture/harness-host-spike.md`。

- [ ] 任务 B 写定 §11.1–§11.9（§11.8 在 Batch 6 回填）。
- [ ] 任务 C 在只读检出里做以下几件事，写入区为空，结论写在回复里，不写报告文件：
  - 重跑全部 M 行的命令；
  - 对照 host.log 与 jsonl 核对每一条"已观测到"；
  - 检查强度分级；
  - 跑 canary 扫描与卫生正则。
- [ ] 任务 B 按根因处理任务 C 的意见，处理结果写进 `Surprises & Discoveries`。

**验证**：`node scripts/rule-checks.mjs disclosure origin/main` 退出码 0；`git diff origin/main...HEAD -- docs/architecture/harness-host-spike.md | grep -c '^-[^-]'` 输出 0。

**回滚**：`git checkout origin/main -- docs/architecture/harness-host-spike.md`。

### Batch 6 · 验收重构、#226 评论与交付（主会话，Opus）

**最小闭环**：集成任务 A 与任务 B；契约测试在真实 §11 上通过，并跑完变异表；#226 评论已发出；PR 回读通过后请人类评审。

**涉及文件**：本计划、`docs/README.md`、`docs/architecture/README.md`；任务 A 的测试以 cherry-pick 并入。

- [x] (2026-09-30) cherry-pick 任务 A 的提交，在真实 §11 上跑测试。执行 `Validation and Acceptance` 的变异表：每一项先用 `git diff --stat` 证明变异已经应用，再看它变红；全部恢复后重跑。
- [x] (2026-09-30) base 对照：先 `git checkout origin/main -- docs/architecture/harness-host-spike.md`，跑测试，期望失败并点名 §11；再 `git checkout HEAD -- docs/architecture/harness-host-spike.md`。
- [ ] 发评论前核对子 issue 是否已开工：
  - `for n in 227 228 229 230; do gh issue view $n -R SingularityKChen/harness-projects --json closedByPullRequestsReferences --jq '.closedByPullRequestsReferences|length'; done`，期望全部为 0；
  - `gh pr list -R SingularityKChen/harness-projects --state all --search '"#227" OR "#228" OR "#229" OR "#230" in:body' --json number,createdAt,body`，检查结果中没有正文真正引用这四个编号的 PR。
- [x] (2026-09-30) 对评论草稿做 canary 扫描与人工五类目检查，然后用开发账号发出。把链接与 `created_at` 回填 §11.8。（D24：文案先由人类伙伴确认；按 2026-09-30 的调整由 Batch 6 验收者发出）
- [x] (2026-09-30) 更新两个索引；填写 `Outcomes & Retrospective`。
- [ ] 人类伙伴验收后，把本计划移到 `completed/`，同时改 `docs/README.md` 的链接与状态、§11.1 第 4 条里的计划路径（TD11）。
- [x] (2026-09-30) 整理提交，目标序列：
  1. 预注册（保持独立，author time 不变）；
  2. `docs(architecture): 追加仓库外插件包复探的观测与裁决`；
  3. `test(contract): 从复探观测表推导裁决并锁定原记录`；
  4. `docs(exec-plan): 记录复探结果并更新索引`。

  整理前后都要用 `comm` 比对新旧 head 的文件集合；推送前先建 backup ref，再用精确的 force-with-lease。 **Superseded by D28（2026-09-30）**：当前交付物收敛为一个完整提交，T0 前原始预注册 SHA 和冻结内容仍保留为证据锚点。
- [ ] 回读远端 head、base、checks、issue 关联与 review threads（推送之后才有结果，只写进 PR #238 正文的「验证证据」，不写进本文件）；`gh pr ready` 推迟到 #226 评论发出之后（D24），然后请人类评审。

**验证**：`Validation and Acceptance` 全表。

**回滚**：`gh pr close <n>`。#226 评论不删除，改为追加一条可见的撤回说明。

## Validation and Acceptance

所有命令都在检出 `test/harness-plugin-reprobe` 的工作树根目录运行，`gh` 命令一律带 `-R SingularityKChen/harness-projects`。

| # | 验收项 | 判定证据（命令 → 期望） |
|---|---|---|
| 1 | #225 AC1：三个问题各自答"已观测到 / 未观测到"，每条带确切命令或代码路径与时间 | `node --test tests/contract/harness-host-reprobe-record.test.js` → 通过（(b) 要求每个决定性 O-ID 恰好一行，(d) 要求时间格式正确且落在窗口内） |
| 2 | #225 AC2：裁决恰为 `embed` 或 `fallback-web` 之一，并点名决定它的答案 | 同上，(b) 与 (c) 通过；再人工核对 §11.6 与 §11.3 |
| 3 | #225 AC3：#226 上的评论点名 transport 与子 issue 的变化，并早于子 issue 开工 | `gh api repos/SingularityKChen/harness-projects/issues/comments/<id> --jq .created_at` 早于 Batch 6 核对命令里任何一个关联 PR 的 `createdAt`；核对时间写在 §11.8 |
| 4 | #225 AC4：`disclosure` 无命中 | `node scripts/rule-checks.mjs disclosure origin/main` → 退出码 0、无输出；PR 正文走同一扫描（`PR_BODY`） |
| 5 | 原记录不动 | 契约测试 (a) 通过；`git diff origin/main...HEAD -- docs/architecture/harness-host-spike.md \| grep -c '^-[^-]'` → `0` |
| 6 | 判别性：测试在 base 上失败 | Batch 6 的 base 对照 → 失败，消息含"§11" |
| 7 | 预注册块在 T0 之后未被改动 | `diff <(git show 02fc3879e2a18e607197272427c8996403d3fee2:docs/exec-plan/active/2026-09-29-harness-plugin-reprobe.md \| sed -n '/^<!-- verdict-rule:begin -->$/,/^<!-- verdict-rule:end -->$/p') <(sed -n '/^<!-- verdict-rule:begin -->$/,/^<!-- verdict-rule:end -->$/p' docs/exec-plan/*/2026-09-29-harness-plugin-reprobe.md)` → 无输出。`02fc387` 是 T0 之前推送的预注册提交（D22）；本机没有这个对象时，用 `gh api 'repos/SingularityKChen/harness-projects/contents/docs/exec-plan/active/2026-09-29-harness-plugin-reprobe.md?ref=02fc3879e2a18e607197272427c8996403d3fee2' --jq .content \| base64 -d` 取出当时的文件代替 `git show`。行首锚点不能省：本行自己就含两个标记，不带锚点时区间会在这里重新打开、一直打印到文件末尾，产生假差异（Surprises 第 17 条）。另查：预注册提交的 `%aI` 与 PR `createdAt` 都早于 §11.2 的 T0 |
| 8 | 变异表（只在最终树上测） | 六项变异，每项都先用 `git diff --stat` 证明已应用，再看测试变红，之后恢复：①一个决定性行改成"未观测到"；②裁决改成另一个取值；③某条捷径改成"影响判定 = 是"；④删掉一个时间；⑤在 §11 注入 `/var/folders/x`，此时 `disclosure` 仍然通过；⑥改 §1–§10 的一个字 |
| 9 | 范围边界 | `git diff --stat origin/main...HEAD -- apps packages scripts .github package.json pnpm-lock.yaml` → 无输出；`git status --short` → 无输出 |
| 10 | 规模 | `node scripts/rule-checks.mjs size origin/main` → 代码 ≤800、文档 ≤1300 |
| 11 | 发布面盲区 | 对 `git diff origin/main...HEAD`、`git log --format=%B origin/main..HEAD`、PR 正文与评论草稿分别执行 `grep -F -f "$SCRATCH/canaries.txt"` → 全部无输出；人工五类目检查通过 |
| 12 | 真实数据根不动 | `find ~/.dsh/profiles -newer "$SCRATCH/marker" -not -path '*/node_modules/*'` 的命中项已逐条归因于真实实例；`grep -rlF "$SCRATCH" ~/.dsh/profiles --include='*.yml' --include='*.json'` → 无输出；`find ~/Documents/deepseek-harness -newer "$SCRATCH/marker"` → 只命中 §11.5 登记的两个空目录（`deepseek-harness` 与其下的 `default-workspace`），`DSH_HOME` 隔离不覆盖它们，是否删除由人类伙伴决定（Surprises 第 14 条、TD8）。记录只写计数 |
| 13 | 全仓门禁 | `npm_config_manage_package_manager_versions=false pnpm verify` → 退出码 0；`pnpm run boundaries` → 通过；`git diff --check origin/main...HEAD` → 无输出 |
| 14 | PR 回读 | `gh pr view <n> --json headRefOid,closingIssuesReferences,isDraft` 的 head 等于本地 `git rev-parse HEAD`；`gh issue view 225 --json closedByPullRequestsReferences` 非空；`gh pr checks <n>` → `PR Fast Gate` 通过 |

## Progress

- [x] 2026-09-29：三份独立设计完成；独立评审复核关键事实并定稿本计划（评审结论见 `Surprises & Discoveries` 第 1–4 条与 `Decision Log`）。
- [x] 2026-09-29：`docs/README.md` 的 Active 表已加入本计划一行（未提交）。
- [x] Batch 0 · 预注册提交、draft PR（2026-09-29）：预注册提交 `02fc3879e2a18e607197272427c8996403d3fee2`（author time `2026-09-29T14:36:56+08:00`），已推送到 `test/harness-plugin-reprobe`；draft PR #238 的 `createdAt` 为 `2026-09-29T06:38:59Z`，是 T0 必须晚于的外部时间锚。回读 `[isDraft, baseRefName, closingIssuesReferences]` = `[true,"main",[225]]`。D15 已于 2026-09-29 确认，Batch 3 不再被它阻塞。
- [x] Batch 1 · 契约测试（任务 A，2026-09-29）：在 `.worktrees/harness-plugin-reprobe-record-test`（分支 `test/harness-plugin-reprobe-record-test`）提交 `bc8819a`、`3130f3e`。后者补上与实现常量分开书写的预注册字面量，修掉"从 `DECISIVE` 删掉 O0.3、O2.3、O4.3 仍然全绿"的幸存变异。Batch 6 cherry-pick 后整理成一个提交。
- [x] Batch 2 · 静态证据与 O0（任务 B，2026-09-29）：T0 = 2026-09-29T06:45:46Z；M1–M15 取证；常量版链路预演 06:55Z–06:57Z（首次安装 `spawn ENOEXEC`，§11 M13，加 PATH 垫片后通过，D19）；06:58Z–11:02Z 额度中断（D17）；恢复后，完整版的 O0.1、O0.2 在 11:03Z 观测到，取最后一次尝试的是 11:14Z–11:15Z 探针修复后的重装。
- [x] Batch 3 · Q4 / Q3（任务 B 与主会话，2026-09-29）：浏览器步骤按 D20 执行。尝试 1 暴露探针缺陷（§11 M17）；尝试 2 的决定项全部观测到；O3.4 的 WebSocket 一半在 11:23Z 补取证。
- [x] Batch 4 · Q2 与非决定项（任务 B，2026-09-29）：Q2 在 11:29Z–11:31Z；O2.4、O3.6（D18）、O3.7、O3.8 观测到，O3.9 未观测到（S1）。
- [x] Batch 5 · §11 定稿与对抗验证（任务 B、任务 C，2026-09-29 至 2026-09-30）：任务 C 独立复现了裁决；它的意见由任务 B 在整理前的最后一个本地提交里全部处理（Surprises 第 15 条）。
- [x] Batch 6 · 验收、#226 评论与交付（2026-09-30；命令都在检出 `test/harness-plugin-reprobe` 的工作树根目录运行）：
  - [x] 变基到 `origin/main`（`699d715`，D22），`git range-diff f6a33d2..<整理前 head> origin/main..HEAD` 的 15 个提交逐个为 `=`；cherry-pick 任务 A 的两个提交。
  - [x] 契约测试在真实 §11 上 25 / 25 通过（其中一条 fixture 是 D23 新加的）。base 对照：`git checkout origin/main -- docs/architecture/harness-host-spike.md` 之后，5 条真实记录用例失败，消息都是"§11 缺失：找到 0 个 "## 11." 标题"，fixture 用例仍全部通过；还原后重新全绿。
  - [x] 独立审读 §11 与本计划，做保守方向的订正（Surprises 第 16 条）；回填本节、Surprises、Decision Log D17–D24 与 Outcomes；更新两处索引。
  - [x] 整理提交为 Batch 6 的目标序列：预注册的两个提交内容与 author time 不变；§11；契约测试；本计划与索引。整理前后用 `comm` 比对文件集合，一致；每个提交单独跑契约测试。
  - [x] 变异表①–⑥在整理后的最终树上逐项执行，每项先用 `git diff --stat` 证明变异已应用，再看测试变红，然后 `git checkout HEAD -- docs/architecture/harness-host-spike.md` 还原：①把 O3.3 的结果改成「未观测到」→ 1 条失败（§11.6 的声明与观测表推导不一致）；②裁决改成 `fallback-web` → 2 条失败（推导不一致；fallback-web 时不能有 transport 行）；③PATH 垫片一行改成「是」→ 1 条失败（推导不一致）；④删掉 O4.1 的时间 → 1 条失败（不是 YYYY-MM-DDTHH:MM:SSZ）；⑤在 §11 末尾注入 `/var/folders/x` 并做一个临时提交 → 1 条失败（§11 含临时路径、令牌、端口或本机路径），而同一个临时提交上 `node scripts/rule-checks.mjs disclosure origin/main` 退出码 0，说明这个盲区确实存在，随后丢弃临时提交；⑥把 §1 标题里的「宿主」改成「宿住」→ 1 条失败（§1–§10 的字节与基线不一致）。另加一项：把 §11.5「手写 strict 描述符」一行的影响 O-ID 改回 `O3.x` → 4 条真实记录用例失败，消息点名"必须逐个列出"（D23 的守卫生效）。全部还原后 25 / 25 通过。
  - [x] 全量验证：在 base `origin/main` = `699d715`、整理后的 head 上：`npm_config_manage_package_manager_versions=false pnpm install --frozen-lockfile` 退出码 0；`pnpm verify` 退出码 0（typecheck 通过；`tests/contract`、`tests/integration`、`tests/e2e` 共 795 / 795，`tests/mvp0` 7 / 7）；`pnpm run boundaries` 7 / 7；`node scripts/rule-checks.mjs disclosure origin/main` 退出码 0；`node scripts/rule-checks.mjs size origin/main` 代码 269 / 1000、文档 915 / 1500（观察时刻快照，写入本行之前；本行的回填会让文档行数略增，回读用同一命令）；`git diff --check origin/main...HEAD` 无输出；`node scripts/workflow-check.mjs` 退出码 0；`Validation and Acceptance` 第 5 行输出 0，第 7、9 行无输出；canary 扫描（`grep -F -f "$SCRATCH/canaries.txt"`）对 diff 与提交信息都是 0 行；人工五类目检查通过。唯一需要判断的是 §11.5 引用的宿主 UI 对话框标题「Internal Testing Notice」：它是公开包的界面文字，不是本仓库内容的保密标记，保留。每个提交单独跑 `node --test tests/contract`：前三个提交 612 / 612，加入契约测试之后的两个提交 637 / 637。
  - [ ] 推送后回读 head、base、checks、issue 关联，并更新 PR #238 正文的「验证证据」与「风险与回滚」。回读命令见 `Validation and Acceptance` 第 14 行；结果只写进 PR 正文（本文件随推送提交，写不进推送之后的结果）。
  - [x] 观测之后补记（2026-09-30）：记录 §11.10（宿主 `0.2.0-rc.2` 的静态差异）与 O3.9 的就地订正；D21 的人类确认、D25、D26 入 `Decision Log`。契约测试仍 25 / 25，§1–§10 与 §11.3 的判定不变（`Validation and Acceptance` 第 5 行输出 0）。
  - [x] #226 评论（D24）：发出前 2026-09-30T01:24:24Z 核对 #227–#230 均未开工，canary 扫描 0 行，五类目检查通过；评论 created_at 为 2026-09-30T01:24:40Z，链接与核对结果回填在记录 §11.8。`Validation and Acceptance` 第 3 行：#227–#230 都还没有关联 PR，评论早于任何子 issue 的开工。
  - [x] (2026-09-30) PR 已 ready，人类伙伴本次授权修订后整合；计划按 TD11 归档。旧推送后的回读任务已在本轮锁定 b727014/main@2f9e0ee 时完成；最终改写后的回读仍按 Validation 第14行执行。

- [x] (2026-09-30) 评审修订收口：§11.10 交接范围与 #245 D25 一致；归档入口和索引同步；新 head、CI、线程与 issue 验收由最终 push 后回读。#226 订正回执见记录 §11.8；外部 actor、目标、幂等键与结果已记录。修订命令在 `.worktrees/harness-plugin-reprobe` 根目录运行。

观测台账（Batch 2–4 执行时在这里逐项标 todo / done / failed）：O0.1 done · O0.2 done · O0.3 done · O4.1 done · O4.2 done · O4.3 done · O3.1 done · O3.2 done · O3.3 done · O3.4 done · O3.5 done · O2.1 done · O2.2 done · O2.3 done。非决定项：O2.4 done · O3.6 done · O3.7 done · O3.8 done · O3.9 failed（未观测到，S1）。

## Surprises & Discoveries

1. **三份设计里有两份把 `intercept('/api')` 当成可用面**：设计①把它作次选 unary，设计③的 T2 以它为底。实际上网关已占用 `/api` 的唯一拦截器（F7）。#125 §5.2 在裸 Context 里观测到的结论，不能迁移到 web profile。这条同时收窄了原记录 §5.2 的适用范围，§11 会以追加方式写明，不改原文。
2. **"手写描述符不算 typed remote"没有依据**（设计②、设计③）：描述符与 codec 是公开类型，运行时只做结构校验（F6）。如果沿用这条规则，就会只剩一条没有宿主托管重连的线可以点名。
3. **设计③的两处事实错误**：
   - 兼容声明写 `engines.dsh`，实际不被强制，真正的闸门是 `@deepseek-ai/dsh-*` 的 peer（F2）；
   - pnpm 版本写成 12.5.1，本机 PATH 上是 10.28.2。`dsh plugin` 用的是 PATH 上的 pnpm（F1）。**Superseded by** 第 7 条（2026-09-30）：错的是这条评审结论，设计③写的 12.5.1 是对的。
4. **三份设计都遗漏了遥测**：scratch 宿主默认会装载遥测导出行，应当用 `DSH_TELEMETRY_DISABLED` 退出（F4）。设计①的另一处错误：它说值为 `undefined` 的属性会被 JSON 安全检查拒绝，实际下行会静默丢键（F11）。
5. **#197 不挡 controller 跑在 SQLite 上**（F13）：设计①预留的"退回 MemoryStorage"不再是预期路径，只作为失败兜底保留。
6. **原记录第 8 行的归因不准**（F18）。原文不改，在 §11.1 追加范围说明（`PLANS.md` §4：原文保留，就地标注）。
7. **pnpm 版本：错的是评审结论，不是设计③**：`PATH` 上的全局 pnpm 是 12.5.1；在仓库目录里显示 10.28.2，是仓库 `package.json` 的 `packageManager` 字段切换所致。`dsh plugin` 在 `$SCRATCH` 里运行，用的是 12.5.1。证据：§11 M1；安装日志末行 `Done … using pnpm v12.5.1`。
8. **`dsh plugin` 的失败模式是 `spawn ENOEXEC`，不是 127**：本机全局 pnpm 的入口是没有 shebang 的 sh 占位脚本，macOS 上 Node 直接 spawn 它得到 `ENOEXEC`。绕过办法是在 `PATH` 前面放一个 `#!/bin/sh` 垫片转调同一个 pnpm，影响判定为「否」（D19）；「`dsh plugin` 依赖可被直接 spawn 的 pnpm」交给 #227 / #230。证据：§11 M13。
9. **同一路径下换包不会重装**：同名同版本、内容不同的本地 tarball 放在同一路径再次 `add`，pnpm 判为锁文件已是最新而跳过；需要先 `remove` 再 `add`。只观测了同一路径，换路径是否重装没有观测。证据：§11 M14。
10. **额度中断**：2026-09-29T06:58Z–11:02Z 没有任何探针操作（最后一次操作 06:57:52Z，恢复后第一次 11:02:45Z）。按日历时间，O0 子预算在 O0.3 之前就会耗尽（D17 的口径 A 反事实）。另外，§11 草稿的第一个本地 WIP 提交在恢复之后（11:06Z）：`Design / Spec` §2.6 第 6 条"每条观测立即 WIP 提交"在中断前没有来得及执行，中断前的 M 行与常量版预演的时间取自命令输出，不取自提交时间。
11. **两处探针缺陷，不是宿主结论**：尝试 1 的客户端在注入作用域外读取 `remote.hpReprobe`（§11 M17）；宿主半边在同一个库上重启时撞唯一约束，需要固定 binding id（§11 M18）。两处失败都按原样保留，修复后重测，捷径台账里各有一行「否」。
12. **Browser 窗格的 `read_network_requests` 不列 WebSocket**：O3.4 的 WebSocket 一半改用页面里只读包装 `WebSocket.prototype.send` 取证，只能看到包装之后发出的帧（§11 M19）。
13. **`$stream` 的 `generation` 是打开尝试的序号**，失败的尝试也算，不等于重连次数（§11 M20）。
14. **`DSH_HOME` 隔离不覆盖默认工作区目录**：浏览器首次进入 scratch 宿主时，宿主 UI 自发的 `workspace/initializeDefault` 在真实账户的 `<Documents>/deepseek-harness/default-workspace` 下建了两个空目录（2026-09-29T11:10:24Z）。记录一度写成"没有创建"，原因是查错了目录名；任务 C 发现后已订正（§11.5）。两个目录仍在，是否删除由人类伙伴决定（TD8）。2026-09-30 复跑 Validation 第 12 行（观察时刻快照，不可复跑成同一计数）：`find ~/Documents/deepseek-harness -newer marker` 命中这 2 项；`~/.dsh` 下比 marker 新的条目增至 28 个，新增的都在 2026-09-29T13:24Z 之后，落在真实 `desktop` profile 的配置、凭据文件与会话文件上。这些文件里没有 `hp-reprobe` / `HP_REPROBE` 字样，含一次性数据根路径的 yml / json / jsonl 文件数为 0。那段时间 scratch 宿主在空转（它的 host.log 只有 11:58:59Z 的一次 `snapshot` 与 16:07:54Z 的停机），来源不做归因。（2026-09-30 补：这些写入与 Desktop 应用升级到 `0.2.0-rc.2` 之后的运行吻合，属于推断，见第 19 条。）
15. **任务 C 的对抗验证意见，在 Batch 6 之前已由任务 B 全部处理**：默认工作区目录的订正（第 14 条）；O2.4 里"已落库的 `providerRef` 同样读不回"标成 S1 推断、未观测；若干措辞改保守；补 M23（客户端 bundle 的 `require` 边界）。
16. **Batch 6 验收订正**（保守方向，裁决不变）：
    - §11.2：O0.3 同样晚于日历口径的截止（常量版预演没有打开浏览器）；写出口径 A 的反事实（`fallback-web`，Q4）；D17 是在观测之后作出的，按预注册块 §2 显式写"规则在观测后被修改"；写明 B 版构建承载 O2.1–O2.3 时的安装证据；说明预注册 SHA 在变基后改变（D22）。
    - §11.3：O0.1 命令栏引用 M14 时限定"同一路径"；O3.6 偏离的来源由"人类伙伴经主会话批准"改成"主会话决定"（D18）；O2.3 摘录补全被省略的时刻 `11:28:03.547Z`（与 host.log 核对过）；O3.5 摘录写明 POST 入口只对 `snapshot` 做了负例，§11.9 加第 10 行。
    - §11.5：影响的 O-ID 逐个列出（D23）：`O3.x` 展开为 O3.1–O3.8（O3.9 是 registry 元数据查询，不经过探针）；`客户端项` 改成预注册原文的「所有客户端项」；范围改成逐个列出。PATH 垫片、O3.6 两行分别引用 D19、D18；前言引用 D21。
    - §11.6：逐条写出裁决依赖的三项（D17、D19、D21）及各自的反事实。
    - §11.7：#228 第 12 条补上 O3.5 的范围。
17. **Validation 第 7 行原来的 `sed` 区间会产生假差异**：写这条命令的那一行自己就含 `verdict-rule:begin` 与 `verdict-rule:end`。不带行首锚点时，区间在这一行重新打开，一直打印到文件末尾；预注册提交与当前文件在这之后的内容不同，于是出现差异。改用行首锚点后差异为空（2026-09-30 用 `git show` 与 `gh api` 两种取法都跑过）。
18. **契约测试 269 行，超过 Batch 1 预计的 ≤160 行**：`3130f3e` 为每个决定性 ID 钉住三种失败方式，D23 又加了一条解析守卫和 fixture。仍在代码 ≤800 行的预算内。
19. **npx 缓存被真实实例的升级替换**：本机 Desktop 应用在 2026-09-29T09:55Z 前后更新到 `0.2.0-rc.2`（额度中断期间），真实 web 实例也已升级；`$HOST_RUNTIME` 所在的 npx 缓存在 2026-09-30T00:57Z 被替换成 `0.2.0-rc.2`。全部观测都早于这次替换，并且 O0.2 能加载精确 peer 为 `0.1.7-rc.2` 的探针，本身就说明当时的运行时是 `0.1.7-rc.2`。后果：§11.4 的原行号在本机已无对应文件，复核要重新取得 `0.1.7-rc.2`；第 14 条里 2026-09-29T13:24Z 之后真实 `desktop` profile 的写入，与 Desktop 升级后的运行吻合（推断，未证实）。证据与复测清单见记录 §11.10（D26）。
20. **O3.9 的查询只读了 `latest` 标签**：`npm view … name version` 返回的是 `latest` 对应的 `0.0.1-rc.1`，同一版本线的 `0.1.7-rc.2` 当时已经存在。订正见 D25。

## Decision Log

| # | 决策 | Rationale | 日期 / 作者 |
|---|---|---|---|
| D1 | **流程**：多个独立子 agent 设计 → 独立评审定稿并写 ExecPlan → draft PR 关联 issue → Sonnet 在各自的 worktree 里并行做 TDD 与对抗验证 → Opus 验收与重构 → 请人类评审 PR | 人类伙伴指定 | 2026-09-29 / 人类伙伴指定，评审者记录 |
| D2 | 交付物是 §11、契约测试、本计划与索引；探针不合并，只在 `$SCRATCH` | 沿用 #125 D1；#227 的验收与探针形态相反 | 2026-09-29 / 评审者 |
| D3 | 预注册：`Design / Spec` §2 的规则块随 Batch 0 提交并推送，draft PR 的 `createdAt` 作为外部时间锚；T0 必须晚于它 | 设计③只用 `%aI`，那是作者可控的时间；PR 的 `createdAt` 由平台记录 | 2026-09-29 / 评审者 |
| D4 | 强度分为 S0–S3，裁决只跟 S3 | 把 #125 的"两半"判据细化，把普通 Node 进程里的实测单列为 S2 | 2026-09-29 / 评审者 |
| D5 | Q2 / Q3 / Q4 全部是决定项，点名顺序为 Q4 → Q3 → Q2 | #225 要求重跑这三问；与 #125 同样保守 | 2026-09-29 / 评审者（默认，人类伙伴可在 T0 前推翻） |
| D6 | 手写 strict 描述符算 typed remote，契约来源单列；生成器可用性（O3.9）是非决定项 | F6；Surprises 第 2 条 | 2026-09-29 / 评审者（默认，人类伙伴可在 T0 前推翻） |
| D7 | transport 的排序是 typed remote 先于 host web route；client resource stream 不能单独被点名 | `Design / Spec` §2.4 第 5 条；F9 | 2026-09-29 / 评审者（默认，人类伙伴可在 T0 前推翻） |
| D8 | host web route 的具体面是 `rpc.handle` 加 `fetch.register` 的 SSE；禁用 `intercept('/api')` 与裸 `webServer.register` | F7、F8；取自设计②，已修正它的首选排序 | 2026-09-29 / 评审者 |
| D9 | scratch 宿主：一次性 DSH_HOME，`--port 0 --no-open`，`DSH_TELEMETRY_DISABLED=1`，所有命令经 `dsh_s` 守卫 | F3、F4；本机已有真实实例在跑 | 2026-09-29 / 评审者 |
| D10 | 命名口径：放开宿主的公开标识符；原记录第 8 行不改，在 §11.1 追加范围说明 | F18；#227 必然要提交 `dsh` 键 | 2026-09-29 / 评审者提议；**人类伙伴 2026-09-29 在会话中批准「放开」**，适用于 §11、本计划与后续 #227 代码；凭据、本机路径、令牌、端口仍一律不写 |
| D11 | 用 canary 扫描加契约测试 (e) 补 `disclosure` 的盲区 | F5、F16 | 2026-09-29 / 评审者 |
| D12 | 探针的 peer：`@deepseek-ai/cordis ~4.0.4`，以及用到的 `@deepseek-ai/dsh-*` 精确写 `0.1.7-rc.2`；不使用豁免 | F2；这也给 #227 / #230 的 peer 策略提供观测 | 2026-09-29 / 评审者 |
| D13 | #226 评论在裁决写定后立即发出；#140 只在评论里点名，不单独评论，也不改关系 | 关系变更需要人类批准（`AGENTS.md` §7） | 2026-09-29 / 评审者 |
| D14 | PR 正文写 `Closes #225`，写 `Refs #226 #227 #228 #140`；提交正文只写 `Refs #225` | 沿用 #125 D10；记忆规则"提交正文别写关闭关键字" | 2026-09-29 / 评审者 |
| D15 | **已批准**：由主会话用内置 Browser 窗格打开 scratch 宿主打印的本地认证 URL；只访问 127.0.0.1 上的一次性实例，令牌由本次启动生成、用完即弃，不写入任何文件、记录或 PR | 这是一个本地令牌，需要在会话里显式确认；#125 D3 当时连宿主都没有启动 | 2026-09-29 / 人类伙伴在会话中批准，评审者记录 |
| D16 | 看板 `Status`：#225 由 `Todo` 改为 `In Progress`，由 agent 在开 draft PR 时写入并回读 | `AGENTS.md` §7 要求点名目标的人类批准并记入 Decision Log；工程事件本身不推进 `Status` | 2026-09-29 / 人类伙伴在会话中批准（目标：#225），评审者记录 |
| D17 | **计时口径 B**：额度中断 2026-09-29T06:58Z–11:02Z（最后一次探针操作 06:57:52Z，恢复后第一次 11:02:45Z，共 4h04m53s）没有任何探针操作，不计入 O0 的 3 小时子预算，两个工作日的总时限同样扣除 | 中断期间没有任何探针操作；`Design / Spec` §2.6 第 1 条本来就按工作小时计总预算。这是 §2.6 第 5 条的延期，**在观测之后作出**（落在 11:08:49Z 与 11:13:11Z 之间，晚于恢复后的 O0.1 / O0.2），所以 §11.2 按预注册块 §2 显式写"规则在观测后被修改"。反事实：按口径 A，O0.3 超出子预算，裁决是 `fallback-web`（Q4） | 2026-09-29 / 人类伙伴在会话中裁定，主会话转述，Batch 6 验收者登记 |
| D18 | O3.6 一次性复用上一次的回环临时端口重启 scratch 宿主，以观测同一页面的重连；前提是 `lsof` 确认端口空闲、只监听 127.0.0.1、`DSH_HOME` 仍是 scratch | 页面要重连同一个源，只能复用端口。`Global Constraints` 的"只用 `--port 0` 启动"为此一次性偏离；这条约束防的是与真实实例争端口、监听到回环之外，前提检查仍然覆盖这两点。O3.6 是非决定项，不影响裁决 | 2026-09-29 / 主会话决定，Batch 6 验收者登记 |
| D19 | PATH 垫片（本机全局 pnpm 入口没有 shebang，`dsh plugin` 的 spawn 得到 `ENOEXEC`）的影响判定为「否」；「`dsh plugin` 依赖一个可以被直接 spawn 的 pnpm」写进给 #227 / #230 的事实（§11.7） | 垫片执行的仍是同一个 pnpm，只修补本机 pnpm 安装，不改变兼容闸门、安装路径或宿主加载路径；这是 §2.5 末句"新出现的捷径按是否改变该 O-ID 所问的承载事实来判"的适用。反事实：判「是」则 O0.1 受影响，裁决是 `fallback-web`（Q4） | 2026-09-29 / 人类伙伴在会话中确认，Batch 6 验收者登记 |
| D20 | 浏览器步骤由主会话按 D15 用内置 Browser 窗格执行：尝试 1（11:10Z–11:11Z，面板挂上了，但探针客户端在注入作用域外读取服务，是探针缺陷，§11 M17）；尝试 2（11:17Z–11:18Z，决定项全部观测到）；补取证 11:23Z（`/api/remote.mux` 的 `cancel` / `open` 帧）；Q2 11:29Z–11:31Z；O3.6 11:32Z–11:34Z。宿主 UI 的两个对话框只点了 Continue 与 Configure later，没有输入任何密钥 | 持有 Browser 窗格的是主会话；每次尝试都保留在 §11.3 的"尝试记录"里，观测行取最后一次尝试 | 2026-09-29 / 主会话执行，Batch 6 验收者登记 |
| D21 | §11.5 只列实际采用的捷径：预注册 §2.5 里没有采用的两行（`allow-version --accept-risk`、jsdom / 假 DOM）不进表，改在台账前言说明；`Design / Spec` §4 的格式说明补上"读数放观测摘录，结果栏只留两个词"与"只列实际采用的捷径" | 预注册 §2.3 问的是"台账里有没有影响判定为「是」且指向决定性 O-ID 的行"。把没有采用的「是」照抄进表，机械推导会把它当成已采用，得出与事实无关的 `fallback-web`（Q4）。这是**观测之后**写下的解读，预注册块的文字没有改动；两行确实没有采用，由 §11.3 的命令栏佐证 | 2026-09-29 / 任务 B 在观测之后提出，主会话在 Batch 6 指示登记。**2026-09-30 人类伙伴在会话中确认**：「台账只列实际采用的捷径；两条标「是」的预注册捷径未采用，不计入裁决」（来源：主会话选择题，人类伙伴选「确认」） |
| D22 | Batch 6 把分支变基到 `origin/main`（`699d715`）。预注册的两个提交随之换了 SHA（内容、提交信息与 author time 不变，`git range-diff` 逐个为 `=`）；§11.2 与本计划继续引用 T0 之前推送的原始 SHA `02fc387` | 本 PR 需要跟上 main；rebase merge 进 main 时 SHA 还会再变一次，所以证据锚点只能是 T0 之前推送的原始提交与 draft PR #238 的 `createdAt`。按内容复核用 Validation 第 7 行 | 2026-09-30 / 主会话指示，Batch 6 验收者执行 |
| D23 | §11.5 的"影响的 O-ID"逐个列出，不写 `O3.x` 通配或 `O3.1–O3.4` 范围；契约测试的解析器遇到通配或范围时响亮失败，并加一条 fixture | 原解析器只认逐个的 `O<n>.<m>`：`O3.x` 解析为空，范围只取两个端点。所有行都是「否」时不影响裁决；但一旦某一行改判为「是」，推导会漏项，"决定它的答案"可能从 Q3 错成 Q2。只改解析，不改 `deriveVerdict` 与预注册常量 | 2026-09-30 / Batch 6 验收者 |
| D24 | #226 评论由 Batch 6 验收者起草，人类伙伴确认文案后由主会话发出；`gh pr ready` 推迟到评论发出之后。**2026-09-30 调整**：人类伙伴批准修订稿后，主会话指示 Batch 6 验收者用开发账号发出，只允许把稿中的 head SHA 与 permalink 换成当时推送的 head，其余一字不改；发出前跑子 issue 未开工核对、canary 扫描与五类目检查；`gh pr ready` 由主会话执行 | 评论是不可撤回的公开写入，而且必须早于 #227–#230 开工；本计划原先写的是由验收者直接发出 | 2026-09-30 / 主会话指示，Batch 6 验收者登记 |
| D25 | **O3.9 订正**（与宿主升级无关）：记录原先写的「生成器最新版是 `0.0.1-rc.1`、与运行时不是同一个版本线」不准确。`latest` 标签停在陈旧的 `0.0.1-rc.1`，同一版本线的 `0.1.7-rc.2`（2026-09-24T14:19:35Z，早于复探）与 `0.2.0-rc.2`（`next`）都存在，导出 `.` 与 `./tsdown`。记录在 O3.9 摘录、§11.6 契约来源、§11.7 #228 第 13 条、§11.9 第 1 行就地订正，旧说法保留并标 Superseded；O3.9 的结果（未观测到）与强度（S1）不变 | 原查询 `npm view … name version` 只读了 `latest` 标签对应的版本。仓库外能否获得并运行生成器仍未验证，这条订正只影响给 #228 的事实，不影响 transport 资格与裁决 | 2026-09-30 / 主会话的只读核对提出，Batch 6 验收者用 `npm view @deepseek-ai/dsh-typert-generator dist-tags time exports --json` 复核（2026-09-30T01:19Z）并登记 |
| D26 | **宿主版本事实**：`0.2.0-rc.2` 于 2026-09-29T09:56:27Z 发布（`latest` / `next`）；本机 Desktop 应用与真实 web 实例都已是 `0.2.0-rc.2`，npx 缓存里的 `0.1.7-rc.2` 已被替换。记录新增 §11.10「宿主 0.2.0-rc.2 的静态差异（观测之后补记）」：插件路径上的包除 `package.json` 外逐字节相同，唯一的不兼容是精确 peer；需在 `0.2.0-rc.2` 上复测的最小清单 O0.1–O0.3、O4.1–O4.3、O3.1–O3.4 并入 #227 的验收，用构建产物复测 | §11.10 是静态、只读的对照（从本地 npm 缓存解出两版 tarball 比较，未下载、未启动宿主），不改 §11.3 的判定与 §11.6 的裁决；契约测试允许 §11.10 这个新小节，仍 25 / 25 通过 | 2026-09-30 / 人类伙伴告知本机版本，主会话安排静态对照，Batch 6 验收者抽查（§11.10「本节复核」一栏）并登记 |

| D27 | 修复 PR #238 的 P2：保留 §11.10 原复测承诺，在原处标 Superseded；按 #245 计划 D25 的人类委托，把 O3.1–O3.4 与 O4.2 数据部分交 #228，#227 只覆盖安装、加载与占位挂载。对 #226 原评论追加可见订正，不编辑其正文或原 created_at | 原记录与上层授权范围发生文字漂移；先前评论确实早于首个子 PR，订正不伪造历史时序 | 2026-09-30 / 人类伙伴授权修订并合并，执行者核对 |
| D28 | 按可独立回滚交付物把本 PR 收敛为一个提交：§11 证据裁决、对应契约测试与归档计划。原 T0 前预注册 SHA `02fc387` 和 draft PR createdAt 仍是证据锚点，冻结块逐字保持；不再保留当前分支的分文件提交粒度 | 用户明确要求整理 commit；历史预注册证明依靠不可变锚点和内容，当前交付物可整组验收、回滚 | 2026-09-30 / 人类伙伴授权，执行者 |

## Idempotence and Recovery

- **可重复**：`$SCRATCH` 可以整个重建；探针每次运行只往 jsonl 追加新时间戳的行。重跑决定性项时，新行追加在后面，旧行保留，§11 取最后一次尝试并说明取法。验证命令都是只读的。
- **已知良好状态**：`origin/main` = `f6a33d2`；本分支的预注册提交。任何一步失败，都可以 `git reset --hard <预注册提交>` 回到"只有计划"的状态。Batch 6 之后 base 是 `699d715`（D22）。整理提交前的本地历史留在本机恢复锚点（只在本机，不推送）：`refs/backup/reprobe-batch6-start` 是整理前的 head，`refs/backup/reprobe-record-test-start` 是任务 A 的 head，`refs/backup/reprobe-remote-before-push` 是强推前的远端 head `ee46873`。
- **会话中断**：scratchpad 可能在恢复会话时被清空（记忆规则）。所以 `$SCRATCH` 放在系统临时目录，而不是 agent 的 scratchpad；每条观测都做本地 WIP 提交。`$SCRATCH` 丢失时，从 `Progress` 观测台账里下一个 todo 继续，已经记录的观测不重跑。
- **不可逆动作**：#226 评论与 draft PR。评论刻意放在裁决写定、对抗验证完成之后，发错只能追加订正。
- **scratch 宿主**：停止进程即可；不删除 `$SCRATCH`（默认不做破坏性删除）。真实 `~/.dsh` 从不写入，所以无需恢复。

## Interfaces and Dependencies

- **工具**：
  - `git`；
  - `gh`，一律带 `-R SingularityKChen/harness-projects`；
  - `node`，≥22，本机是 v26.10.0；
  - PATH 上的 `pnpm`，10.28.2（`dsh plugin` 用的是它）。**Superseded by** `Surprises & Discoveries` 第 7 条（2026-09-30）：是 12.5.1，并且要能被 Node 直接 spawn（第 8 条）；
  - `curl`；
  - Browser 窗格（Batch 3）。
- **宿主运行时**：版本 `0.1.7-rc.2`，由 `$HOST_RUNTIME` 指向。只读；只经 `dsh_s` 在 scratch 下写入。
- **凭据**：不需要任何真实凭据。假值见 `Design / Spec` §6 第 4 条。GitHub 写入（PR、评论）用开发账号。
- **命名契约**：

  | 项 | 值 |
  |---|---|
  | 探针包 | `hp-reprobe@0.0.0` |
  | Remote namespace 与服务键 | `hpReprobe` |
  | host web route 的 channel | `/hp-reprobe` |
  | host web route 的 Fetch 路径 | `/api/hp-reprobe/watch` |
  | 凭据引用 | `HP_REPROBE_ISSUER_KEY` |
  | 面板 key 与入口 id | `hp-reprobe` |
  | 项目库路径 | `$DSH_HOME/hp-reprobe/workspace.sqlite` |
  | 记录文件 | `docs/architecture/harness-host-spike.md`，§11 的格式见 `Design / Spec` §4 |
  | 测试文件 | `tests/contract/harness-host-reprobe-record.test.js` |

- **上游 issue**：`Closes #225`；`Refs #226 #227 #228 #140`。

## Outcomes & Retrospective

**评审修订结果（2026-09-30）**：计划归档、D27交接订正与D28提交整理已完成。核对当前分支运行 `node --test tests/contract/harness-host-reprobe-record.test.js tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js`，要求全部通过；冻结预注册块与原始锚点比较要求逐字相同。外部订正、最终push及merge的回执只在PR正文和跨PR评审归档回填。

**结果**（2026-09-30，Batch 6 验收，历史观察快照）：

- 裁决 `embed`；决定它的答案 Q4（没有失败项）；transport 是 typed remote（unary 走 `/api` 的 POST，watch 用 stream Remote 走 `/api/remote.mux` 的 WebSocket）；契约来源是手写 strict 描述符。14 个决定性行全部是 S3 的「已观测到」，契约测试从 §11.3 与 §11.5 机械推导出同一结论。
- 裁决依赖三项观测之后的裁定或解读，任何一项反过来都是 `fallback-web`（Q4）：D17（计时口径）、D19（PATH 垫片判「否」）、D21（台账只列实际采用的捷径）。三项都已由人类伙伴在会话中裁定或确认（D21 于 2026-09-30 确认）。
- 宿主已发布 `0.2.0-rc.2`：插件路径上的包除 `package.json` 外逐字节相同，裁决与 transport 的依据沿用；精确 peer 需要按目标宿主版本改写（记录 §11.10，D26）。
- 非决定项：O2.4（轮换后，旧引用读回 `not_found`）、O3.6（宿主重启后，同一个流句柄重拉 baseline）、O3.7（非法参数被手写 `parse` 挡住，换成恒等 `parse` 后越过网关）、O3.8（释放流句柄后出现 `watch closed`，poll 停止）都观测到了；O3.9（契约生成器）未观测到。
- 与计划的偏差：额度中断与计时口径（D17）；PATH 垫片（D19）；O3.6 复用端口（D18）；探针的两处缺陷与重测（§11 M17、M18）；宿主 UI 在真实 `<Documents>` 下建了两个空目录（TD8）；契约测试 269 行（Surprises 第 18 条）；#226 评论与 `gh pr ready` 推迟（D24）；预注册提交因变基换了 SHA（D22）。

**经验**：

1. 预注册块要把计时口径一起写死：按日历时间还是工作时间，中断怎么算。这次靠观测之后的人类裁定补上，裁决因此依赖它。
2. 预注册的台账要写明"只列实际采用的捷径"，并要求"影响的 O-ID"逐个列出；否则机械推导要靠观测之后的解读。
3. 复核命令里的 `sed` / `grep` 区间要锚定行首：计划里引用这些标记的那一行，会把区间重新打开。
4. `DSH_HOME` 隔离不等于零副作用：宿主 UI 会写账户级目录。一次性环境要事先列出宿主会写的全部根目录。
5. 浏览器工具的网络面板不列 WebSocket；取证手段要在预注册时想好，不能在现场补。
6. "每条观测一个本地 WIP 提交"在额度中断前没有执行到；长时间运行的探针要把第一次 WIP 提交放在 T0 之后的第一条命令之后。

### 技术债务（已知，随本计划登记）

| # | 债务 | 由谁偿还 |
|---|---|---|
| TD1 | 探针不合并，#227 要从零构建宿主入口与 client bundle，并引入打包器；这需要人类决定用哪个打包器 | #227 |
| TD2 | typed remote 的手写描述符与 rc 版描述符格式耦合。#228 要用 `satisfies InvocationDescriptor` 把它绑到 controller 接口，并用精确的 peer 版本闸门防止漂移 | #228 |
| TD3 | watch 是轮询式：每个 tick 都完整重读一次基线，开销为 O(实体数 × 客户端数)。演示阶段只有单用户，可以接受 | #228 之后改用 core 的变更通知 |
| TD4 | issuerKey 的轮换与"按操作解析"冲突（F15）；策略由人类决定：key 带版本号，或者把轮换定义为一次运维事件 | #228 |
| TD5 | `apps/harness-plugin` 的宿主入口要依赖 controller / core / storage，现在的 boundaries 禁止这样做，需要一份 ADR 并拆分子入口 | #228 |
| TD6 | worker-preview 载体没有观测 | 需要时再立 issue |
| TD7 | 契约测试把 §1–§10 的哈希写死了。今后任何经批准的勘误都要显式更新常量，并写进 `Decision Log` | 随勘误 PR |
| TD8 | 宿主 UI 在真实账户的 `<Documents>/deepseek-harness/default-workspace` 下建的两个空目录还在（Surprises 第 14 条） | 人类伙伴决定是否删除；演示与验收环境的预处理见 §11.7 给 #229 / #230 的事实 |
| TD9 | `dsh plugin` 依赖一个能被 Node 直接 spawn 的 pnpm；安装指南要写明这个前提，或者给出检测方法（Surprises 第 8 条） | #230 |
| TD10 | O3.5 只对 `/api` 上的 `snapshot` 做了准入负例，其余一元方法没有逐个做（§11.9 第 10 行） | #228 的验收 |
| TD11 | 已完成（2026-09-30）：本计划移到 `completed/`，索引和 §11.1 入口同步；原归档待办已收口 | 本次人类授权收尾 |
| TD12 | 在 `0.2.0-rc.2` 上用构建产物复测 O0.1–O0.3、O4.1–O4.3、O3.1–O3.4（记录 §11.10）。**Superseded by D27（2026-09-30）**：#227 已有安装/加载/占位挂载记录；O3.1–O3.4 和 O4.2 数据部分仍由 #228 复测 | #227 / #228，按 D27 分工 |

## Bottom Change Note

- 2026-09-29：创建。由三份独立设计经独立评审定稿：骨架取自设计③，机制取自设计①，宿主 web 路由面取自设计②；拒绝理由见 `Design / Spec` §8 与 `Decision Log` D3–D8。
- 2026-09-30：Batch 6 验收。回填 `Progress`、`Surprises & Discoveries` 第 7–18 条、`Decision Log` D17–D24、`Outcomes & Retrospective` 与 TD8–TD11；F1、`Surprises & Discoveries` 第 3 条、`Interfaces and Dependencies` 里的 pnpm 版本就地标注 Superseded；`Validation and Acceptance` 第 7 行改用行首锚点，第 12 行加上默认工作区目录的核对；`Design / Spec` §4 补两条格式说明（D21、D23）；Batch 6 的步骤按 D24 调整。预注册块没有改动（`Validation and Acceptance` 第 7 行的 diff 为空）。
- 2026-09-30：观测之后补记。记录 §11.10（宿主 `0.2.0-rc.2` 的静态差异）与 O3.9 订正；`Decision Log` 加 D21 的人类确认、D24 的调整、D25、D26；`Surprises & Discoveries` 加第 19、20 条；TD12；抬头的宿主版本就地标注 Superseded。

- 2026-09-30：按人类授权完成评审后收尾：交接范围按D27在原处订正，D28规定一个可独立回滚交付物，计划归档并更新两处入口、队列表；冻结预注册块不变，真实观测不重跑，剩余transport证据归#228。
