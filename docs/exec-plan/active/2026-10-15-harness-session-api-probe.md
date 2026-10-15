# Harness Session API Probe ExecPlan

> 状态：Active（设计完成，待 Batch 0 预注册）
> 创建：2026-10-15
> 范围：完成 issue #280：在当前宿主发行版上观测仓库外插件能调用哪些会话操作（启动、读状态、取消），录一份脱敏夹具，并按预注册规则机械给出对 #140 的结论（`implement` / `narrow` / `move-after-demo`）。不实现 provider（#140），不设计提示词。
> 上游输入：`AGENTS.md`、`PLANS.md`、issue #280、#140、`docs/architecture/harness-host-spike.md` §11（尤其 §11.4 M 行、§11.5 捷径台账与附带写入、§11.9 第 7 行）、`docs/exec-plan/completed/2026-09-29-harness-plugin-reprobe.md`（预注册与裁决推导的先例）、`docs/adr/ADR-0008-run-identity-is-the-core-run-record.md`、`docs/adr/ADR-0013-harness-host-composition.md`、`packages/capabilities/src/execution-provider.ts`、`packages/core/src/start-work.ts`、`tests/contract/suites/execution.js`；本轮并行 PR A（#132）、B（#276）、C（#231）的 ExecPlan 与协调者定稿的跨 PR 协议（共享文件、合并顺序、宿主窗口，见 `Decision Log` D13–D18）。

## Purpose / Big Picture

完成后，`docs/architecture/harness-session-api.md` 是一份自包含的观测记录：在 DeepSeek Harness 宿主 `0.2.0-rc.2` 上，一个经 `dsh plugin --profile web add` 装入一次性 profile 的仓库外插件，在宿主进程内注入 `ctx.sessionController`，执行了哪些会话操作、确切输入输出与失败形态、宿主版本与 UTC 时间；`tests/contract/fixtures/harness-session/session-api.json` 是一次启动与一次状态读取（以及可能的成功与取消）的脱敏夹具，供 #140 的执行契约套件回放；记录 §6 的结论块由观测表按预注册规则机械推出。

最小成功证据：`node --test tests/contract/harness-session-api-record.test.js` 全绿，其中「真实记录」「真实夹具」用例读的是真实文件；本计划 `session-rule` 块在 T0 之后与预注册提交逐字节相同；变异表全部 KILLED。观测本身（Batch 3）由协调者（主会话）在真实宿主二进制上完成，任何本地测试都不能替代它。

## Context and Orientation

### 术语

- **宿主**：DeepSeek Harness，发行版 `0.2.0-rc.2`。Desktop 应用自带一个 `dsh` CLI（`PATH` 上的 `dsh` 是指向应用包内 `runtime/cli/bin/dsh` 的符号链接，它以 `ELECTRON_RUN_AS_NODE=1` 运行 Desktop 内嵌的 Node 24.18.1，并调用普通 `@deepseek-ai/dsh` 的 `runCli`，安装插件用 Desktop 自带的 pnpm 11.7.0）。
- **`$HOST_RUNTIME`**：本机 npx 缓存里同一发行版的 `@deepseek-ai/*` 安装根，只用于静态取证（Desktop 包内剥掉了 `.d.ts`）。真实路径不入库。
- **`$SCRATCH`**：Batch 3 用 `mktemp -d` 建的一次性根目录；其下 `home/` 是 `DSH_HOME`，`work/` 是会话 cwd，`obs/` 存观测日志。真实值不入库，记录与夹具里写作 `<scratch>`。
- **探针**：手写 JS 插件包 `hp-session-probe@0.0.0`，只有宿主半边，不入库（源文件在 git 忽略的 `.superpowers/session-probe/`）。
- **R1 / R2 / R3**：观测级。R1 不发 prompt；R2 不提供任何密钥，模型端点指向回环 sink，turn 在进程内失败；R3 用本次生成的假密钥（形如 `hp-probe-fake-<32 hex>`，不是任何账号的凭据），模型端点指向回环 stub。R4（真实模型）不在本 PR。
- **强度 S0–S3**：见 Design / Spec §2.1。只有 S3 参与结论。
- **协调者**：主会话。它独占 Batch 0、Batch 3 与外部写入；实施者（Sonnet）与验收者（Opus）是它派发的子 agent。

### 当前事实（S1，2026-10-15 设计时复核）

1. 版本：`npm view @deepseek-ai/dsh dist-tags --json` 为 `latest`、`next` = `0.2.0-rc.2`，`alpha` = `0.2.1-alpha.3`；Desktop 应用的 `CFBundleShortVersionString` 与包内 `dsh/desktop-runtime.json` 的 `release.version` 都是 `0.2.0-rc.2`（`hostProtocolVersion: 4`）。
2. Desktop 包与 `$HOST_RUNTIME` 同码：`dsh-api-session-controller`、`dsh-session`、`dsh-agent`、`dsh-llm-deepseek-api-key`、`dsh-credentials-local` 五个包的 `lib/index.js` 的 sha256 前 16 位两边相同（Desktop 侧用 asar 头读取器取文件，见 Batch 2）。
3. 服务键：`dsh-api-session-controller/lib/index.js` 约 :2847 `super(ctx, "sessionController", { namespace: "session" })`，经 `TypertRemoteService` 注册为 Cordis 服务键 `sessionController`；类型在 `lib/types/index.d.ts:15-20` 以模块增补声明。`dsh-web-app/cordis.patch.yml:121-122` 在根级 `insert` 里装它；`desktop` profile 经同一个 Web 应用启动（Desktop 包内 `dsh-desktop-host/lib/index.js` 的 `main()` 注释与 `runProfile({ profile: "desktop" … })`）。官方插件文档说明插件经 `inject` 声明宿主服务、在 `ctx` 上使用。
4. 方法（`lib/types/index.d.ts` 行号）：`resolveAgent`:66、`inspect`:73、`list`:80、`create`:93、`prompt`:163、`cancel`:181、`page`:188、`follow`:196、`projections`:203。`inspect` 不激活 Agent，已附着时读内存、否则冷读持久化日志，返回 `{ meta, inheritedEventCount, events }`；找不到时抛 `SessionQueryError`（code `SESSION_QUERY_SESSION_NOT_FOUND`），不是 `RemoteError`。
5. `create`（`lib/index.js` 约 :686）：`workspaceId` 与 `cwd` 同时给抛 `RemoteError('gateway/bad-request')`；未给 `sessionId` 时生成 `session-<uuid>`；两者都不给时用宿主进程的 `process.cwd()`。
6. `prompt`（约 :850）：空内容抛 `gateway/bad-request`；同一 `requestId` 已在 inbox 或日志里时直接返回 `{ accepted: true }`、不插入第二条消息；返回值注释是「prompt 进入 Agent inbox 后的回执」（`types.d.ts:328-331`），不是执行完成。README 写明 prompt 接纳不检查模型目录，缺凭据由执行阶段报告。
7. `cancel`（约 :994）：同步；Agent 未附着时抛 `session/not-found`；否则 `agent.cancel({ kind: 'user' }, { keepInbox: true })` 并返回 `{ accepted: true }`。`dsh-agent` 的类型注释写明无活动时取消是 no-op、不预约后续工作。取消是会话粒度，不指定某一次运行。
8. 状态：`SessionSummary` 有 `running`、`agentAvailable`、`blank`（`types.d.ts:159-170`）；宿主在 `agent/status` 变化时发 `api-session/status(sessionId, running)`（约 :2885）。`turn/end.reason.kind` 在 `dsh-session/lib/types/types.d.ts:163-207` 有 `completed`、`aborted`（带 `reason`）、`blocked`、`error`（带 `error.code`）、`max-tokens`、`interrupted`、`forked`，注释写明可合并扩展。事件信封是 `{ type, seq, time, data }`。
9. 凭据与端点：`dsh-llm-deepseek-api-key` 在 `resolveAuth` 里经 `ctx.credentials.resolve('DEEPSEEK_API_KEY')` 取值，取不到抛 `LlmError(…, 'MISSING_CREDENTIAL')`，此时尚未发请求；`MISSING_CREDENTIAL` 不在 `dsh-llm` 的默认可重试码（`EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`）里。凭据查找顺序是启动环境 > 存储文件 > 调用者 cwd 的 `.env` > `$DSH_HOME/.env`。端点取显式 `baseURL`，否则 `$DEEPSEEK_BASE_URL`，否则官方根；所有内置 profile 补丁都没有给 `baseURL`。流协议是 Messages SSE（`message_start` … `message_stop`），空闲超时 300 s。
10. 附带模型调用：`dsh-base` 装了 `session-title-llm`（`dsh-session-title-first-prompt-llm`），首个 prompt 可能另发一次模型请求。
11. 遥测：`DSH_TELEMETRY_DISABLED` 非空即关闭会话 OTel；产品埋点两行只在 profile 名为 `desktop` 时启用（`dsh-web-app/cordis.patch.yml:44-61`）。
12. Documents 副作用：首用默认工作区目录只由宿主 UI 调 `workspace/initializeDefault` 触发（spike §11.5）；`create({ cwd })` 不走这条路径。
13. 仓库侧（**观察于 base `21cb29eb`，2026-10-15T02:30:34Z 复核**；PR A 合并后 Host 入口的半句不再成立，凡引用都带 base）：`ExecutionProvider` 只有 `startRun`、`getRun`、可选 `cancelRun`，没有 reconcile；`ExecutionRunStatus` 八个取值（`packages/domain/src/enums.ts:52-55`）；core 无主执行 provider 时走 `manualFallback`，结果不确定记 `unknown`（`packages/core/src/start-work.ts:272-326`）；契约套件期望 `seededRunExternalId`、`runningRunExternalId`；`packages/providers/execution-harness` 只有包骨架，依赖只有 domain 与 capabilities；`ProviderChangeRequest.headBranch` 在无法精确解析为本仓库分支时为 `undefined`（`packages/capabilities/src/development-provider.ts:56`）；Host 入口 `inject = ['typert', 'harnessProjectsProviders', 'credentials']`（`apps/harness-plugin/src/host.ts:9`）与 `HostProviderFactory`（同文件 :13-15），PR A 的计划删除后者、把 inject 改为 `['typert', 'credentials']`；产品安装件的 `dsh-*` peer 统一为 `~0.2.0-rc.2`（`apps/harness-plugin/scripts/build.mjs` 的 `HOST_DSH_PEER_RANGE`），没有 `dsh-*` peer 时兼容闸门直接放行。
14. 现有夹具惯例（观察于 base `21cb29eb`）：`tests/contract/fixtures/github-projects/` 是 `{ provenance, exchanges }`，保留 provider 原始 id，回放键是 `[operationName, 按键排序的 variables]`，回放 helper 与其消费者同 PR 落地。
15. Cordis（`$HOST_RUNTIME` 的 `@deepseek-ai/cordis@4.0.4`，2026-10-15T02:30:34Z 复核）：`Inject` 只有数组与对象两种形式，全是必需依赖，没有可选依赖（`src/registry.ts:71-87`）；插件在全部所需服务出现前停在 `PENDING`（`src/fiber.ts:142`）。`ctx.inject(deps, cb)` 是 `ctx.plugin({ inject, apply: cb })` 的简写，回调在所需服务出现后运行、服务变化时卸载重跑（`src/registry.ts:166-176`、`:300-301`）。所以把 `sessionController` 加进 Host 顶层 `inject` 会让插件在没有该服务的宿主上整体不加载；嵌套的 `ctx.inject(['sessionController'], cb)` 只让那一段等待。

### 主不确定性与最小判别验证

主不确定性：第三方插件的宿主半边能否注入 `sessionController`，并把一次 turn 驱动到可读的终态。S1 推断在注入环节失手过（spike M17）。最小判别验证是 Batch 3 的 `core` 模式一次运行（R2，约 1 小时）：就绪行 → create → prompt → `api-session/status` true→false → `inspect` 读到 `turn/end`。

### 两份独立设计与本计划的取舍

设计 d1（静态机制）提供了方法清单、行号、Desktop 与 npx 同码、预注册推导、重启冷读与「插件可达」判定；设计 d2（安全观测）提供了 R1–R3 观测级、`env -i` 守卫、凭据金丝雀、web profile 避开埋点、捷径台账与缺项语义。本计划合并两者，并删去：d1 的「prompt 后立刻 cancel」作为档位判据（无活动时取消是 no-op，结果取决于竞态）、d2 的 `replay.js`（本 PR 没有消费者，#140 自带回放 port）、d2 的 `<session-N>` 占位（与仓库保留 provider 原始 id 的惯例相反）、d2 的 `documentsDirectory` 补丁（不开浏览器就不会触发，改为收尾核对）、d2 的「stub 恰好收到 1 次请求」（标题 LLM 会多发）。逐条理由见 `Decision Log`。

## Design / Spec

### 1. 交付物

记录、夹具、一致性契约测试、本计划与三处索引行；文件集合只在 `Global Constraints` 声明。探针、stub、夹具生成器、守卫脚本都在仓库外（`.superpowers/session-probe/` 或 `$SCRATCH`），永不提交：记录与实现两份事实会互相污染（#125 D1），探针形态也不是 #227 的构建产物。

### 2. 预注册块

下面两行标记之间的内容随 Batch 0 的提交与 draft PR 一起推送，推送时刻早于 T0。T0 之后修改只能由人类伙伴在 `Decision Log` 点名批准，并在记录 §2 写明「规则在观测后被修改」。复核命令见 `Validation and Acceptance` 第 4 行。

<!-- session-rule:begin -->

#### 2.1 强度

| 级 | 定义 |
|---|---|
| S0 | 未尝试，或在子预算内没有得到结果 |
| S1 | 静态读到服务键、符号或文件角色 |
| S2 | 在普通 Node 进程或假 `ctx` 里实测 |
| S3 | 在经 `dsh plugin --profile web add` 装入一次性 `DSH_HOME` 的探针里实测，宿主由发行版 `0.2.0-rc.2` 的 `dsh web` 启动（首选 Desktop 安装的 `dsh`；回退用同一发行版的 npx 运行时，须记入捷径台账） |

#### 2.2 观测集

- `CORE`：O0.1、O0.2、O1.1、O1.2、O2.1、O2.2
- `IMPLEMENT`：O3.1、O3.2
- `NON_DECISIVE`：O4.1、O4.2、O4.3、O4.4

| O-ID | 级 | 判据 |
|---|---|---|
| O0.1 | — | `dsh plugin --profile web add <scratch>/hp-session-probe-0.0.0.tgz` 退出码 0（数字退出码写进归档日志），未使用 `allow-version` 或 `--accept-risk` |
| O0.2 | R1 | 宿主启动后探针打出就绪行，其中 `create`、`prompt`、`cancel`、`list`、`inspect` 五个成员的 `typeof` 都是 `function` |
| O1.1 | R2 | `create({ cwd: '<scratch>/work' })` 返回以 `session-` 开头的 `sessionId` |
| O1.2 | R2 | 随后 `prompt({ requestId, sessionId, mode: 'queue', content: [一段文本] })` 返回 `{ accepted: true }` |
| O2.1 | R2 | 60 s 内该会话的 `api-session/status` 先报 `true` 后报 `false`，之后 `list({})` 里该行 `running: false` |
| O2.2 | R2 | 同一窗口内 `inspect(sessionId)` 的事件含 `turn/start` 与一条带 `reason.kind` 的 `turn/end` |
| O3.1 | R3 | stub 为 `reply` 时，新会话 create + prompt 后 60 s 内 `inspect` 读到 `turn/end` 且 `reason.kind = completed`，`list` 该行 `running: false` |
| O3.2 | R3 | stub 为 `hold` 时，新会话 create + prompt，观测到该会话 `api-session/status` 为 `true` 且 stub 正持有请求后 `cancel({ sessionId })` 返回 `{ accepted: true }`；30 s 内 `inspect` 读到 `turn/end` 且 `reason.kind = aborted`、`reason.reason.kind = user`，`running` 回到 `false` |
| O4.1 | R2 | 同一 `requestId` 再发一次 prompt 返回 `{ accepted: true }`，`inspect` 里带该 `rpcId` 的用户消息恰好 1 条 |
| O4.2 | R1 | 记录五种失败的确切形态：`create` 同时给 `workspaceId` 与 `cwd`；空白内容 prompt；对未知会话 prompt；对未知会话 `inspect`；对未知会话 `cancel` |
| O4.3 | R2 | 对已结束、仍附着的会话 `cancel`：记录返回值与之后事件数是否变化 |
| O4.4 | R2 | 宿主重启后，对 O1.1 的会话 `inspect` 冷读仍返回原来的 `turn/end`，`cancel` 抛 `session/not-found` |

每个 O-ID 在记录观测表里恰好一行；没有尝试的写「未观测到 / S0」，不得省略。

#### 2.3 结论推导

1. 一行「计入」当且仅当：结果为「已观测到」，强度为 S3，且捷径台账里没有「影响判定 = 是」的行列出它。
2. `插件可达` = O0.1 与 O0.2 都计入时为「是」，否则为「否」（此时记录写明会话接口从插件不可达）。
3. `CORE` 有任一行不计入 → `move-after-demo`，`缺项` 列出不计入的 `CORE` 行。#140 移到 demo 之后，demo 继续走 core 已有的人工降级。
4. 否则 `IMPLEMENT` 全部计入 → `implement`，`缺项` 为「无」：#140 实现 `startRun`、`getRun`、`cancelRun`。
5. 否则 → `narrow`，`缺项` 列出不计入的 `IMPLEMENT` 行：缺 O3.2 表示 #140 不声明取消能力；缺 O3.1 表示 `completed` 的映射只有 S1、夹具里没有成功运行。
6. 结论块固定三行，写在记录 §6：`> 对 #140 的结论：`<结论>``、`> 插件可达：是|否`、`> 缺项：无|O-ID 以「、」连接`。
7. 结论只写进记录与 PR；改 #140 的验收范围、解除 blocked-by、改看板 `Status` 由人类伙伴决定。

#### 2.4 捷径预定性

台账（记录 §5）只列实际采用的捷径；下面未被采用的行不进台账（#225 D21 的教训：照抄未采用的「是」会让机械推导误判）。执行中新出现的捷径追加，按「是否改变该 O-ID 所问的会话接口事实」判定；影响的 O-ID 逐个列出，不写范围或通配。

| 捷径 | 影响判定 | 理由 |
|---|---|---|
| 手写 JS 探针，只有宿主半边 | 否 | 问的是会话接口能否被插件调用，不是构建产物 |
| R2 端点指向回环 sink、不给密钥 | 否 | 会话生命周期由宿主驱动，模型调用在进程内失败 |
| R3 回环 stub 加本次生成的假密钥 | 否 | 同上；真实模型成功路径另记 TD-066 |
| 用 `web` profile 而不是 `desktop` profile | 否 | 会话控制器同一份代码；`desktop` profile 经同一个 Web 应用启动 |
| Desktop CLI 失败时改用同发行版 npx 运行时（连同 `PATH` 上转调全局 pnpm 的垫片） | 否 | 相关包逐字节相同（事实 2）；垫片只修补本机 pnpm 入口（spike M13、§11.5） |
| 使用 `allow-version` 或 `--accept-risk` | 是（O0.1） | 绕过兼容闸门 |
| 在普通 Node 进程或假 `ctx` 里驱动 | 是（受影响的每一行） | 不是宿主载体 |

#### 2.5 时限与停止规则

1. Batch 3 总预算：从 T0 起 1 个工作日（8 个工作小时）。子预算：安装与 O0 1.5 h；`core` 1.5 h；重启 0.5 h；R3 2 h；收尾核对 0.5 h。
2. 某条决定性观测耗尽子预算，就记「未观测到」并写清尝试与卡点，继续下一段，不借后段预算；O0.1 或 O0.2 失败时停止全部宿主步骤。
3. 守卫触发即停止全部 prompt 步骤、交人类伙伴：R2 前 `credentials.describe('DEEPSEEK_API_KEY')` 报 `configured: true`；R2 的 sink 收到任何请求；R3 的 stub 记录的 `keySha8` 与事先写下的不一致；prompt 步骤期间宿主进程出现新的非回环 TCP 连接；真实数据根或 `<Documents>/deepseek-harness` 下出现比 marker 新的条目。
4. 观测行取最后一次尝试，旧尝试保留在记录的尝试记录里。延期只能由人类伙伴在 `Decision Log` 批准。

<!-- session-rule:end -->

### 3. 记录格式契约（测试据此解析）

`docs/architecture/harness-session-api.md`，标题 `# 宿主会话接口观测：插件能否启动、读取与取消一次运行`，九个二级标题按序为 `## 1. 范围与口径`、`## 2. 观测环境`、`## 3. 观测表`、`## 4. 静态机制证据`、`## 5. 捷径台账`、`## 6. 对 #140 的结论`、`## 7. 交给 #140 的事实`、`## 8. 夹具与投影规则`、`## 9. 未观测到清单与复核方法`。

- §2 必含三行：`- 预注册：`<40 位 SHA>` @ <YYYY-MM-DDTHH:MM:SSZ>`、`- T0：<YYYY-MM-DDTHH:MM:SSZ>`，以及表格行 `| 宿主版本 | `0.2.0-rc.2` |`；另写启动方式、守卫与环境白名单、探针 manifest（`peerDependencies` 只有 `@deepseek-ai/dsh-api-session-controller: ~0.2.0-rc.2`，`inject: ['sessionController', 'credentials']`）、各模式的步骤表（逐步写出确切请求对象）与时间来源。
- §3 表头逐字为 `| ID | 问题 | 判据 | 命令或动作 | 结果 | 强度 | 时间（UTC） |`；结果只取「已观测到 / 未观测到」，强度只取 S0–S3，时间格式 `YYYY-MM-DDTHH:MM:SSZ`（取自 `date -u` 或探针的 `new Date().toISOString()`，不手打），命令单元格含反引号。读数写在表后的观测摘录，按 ID 对应。
- §4 表头 `| # | 事实 | 命令或代码路径 | 结果 | 时间（UTC） |`，行号 M1…，不带 O-ID、不参与推导；宿主路径写 `$HOST_RUNTIME/…/`；仓库侧事实（事实 13、14）在「事实」列写「观察于 base `21cb29eb`」，命令写 `git show 21cb29eb:<路径>`，时间为复核时的 `date -u`，免得 PR A 合并后读成当前事实。
- §5 表头逐字为 `| 捷径 | 影响的 O-ID | 影响判定 | 理由 |`；其后是附带写入与收尾核对（H 行：sink 计数、stub `keySha8`、新非回环连接、真实数据根新条目、Documents 新条目、用户级 pnpm 内容寻址库新增数）。
- §6 是 §2.3 第 6 条的三行引用块；结论为 `move-after-demo` 时另有 `### 6.1 为何录不到`。
- §7 含状态映射提案表，表头逐字为 `| 宿主状态 | ExecutionRunStatus | 来源 |`，来源写 O-ID 或 `S1`；另列：调用面与 Host 接缝（措辞见下）、启动 = create + prompt、读 = `inspect` + `list`、取消的会话粒度与重启后 `not-found`、`requestId` 幂等、缺凭据是「启动成功、随后运行失败」、prompt 内容会写进宿主会话日志（port 义务 3：`environment` 不得拼进 prompt）、会话推送远端（见下）、夹具回放键建议。
  - Host 接缝（D13）：写成「将来的 `execution.harness` 目录条目」，位于 `apps/harness-plugin/src/host-providers.ts` 的封闭目录，经 `create(input)` 收到一个窄的会话 port（只含 #140 用到的方法）；port 来自嵌套的 `ctx.inject(['sessionController'], cb)`，不进 Host 顶层 `inject`（事实 15：Cordis 没有可选注入，顶层加入会让插件在没有该服务的宿主上整体不加载）；任何取舍都写成对 ADR-0014 的 Proposed 修订。措辞以 D 合并时的 main 为准：#132 已合并时直接引用该文件与 ADR-0014；未合并时写「由 #132 的 open PR 提议的 `host-providers.ts` 目录与 ADR-0014（Proposed）」。不出现 `HostProviderFactory` 及其输入，也不写「修订 ADR-0013 的注入清单」（ADR-0014 部分取代 ADR-0013 第 5 条）。
  - 会话推送远端：Harness 会话把分支推到哪个远端未观测（本 PR 不让会话执行工具）。端口约定 `ProviderChangeRequest.headBranch` 只对本仓库分支有值（事实 13，观察于 base），#231 的 GitHub 研发 provider 对 `isCrossRepository: true` 的 PR 给 `undefined`（#231 未合并时写「#231 的 open PR 设计为」）；所以 #140 必须把分支推到绑定仓库，推到 fork 的分支挂不上变更请求。
- §9 每行写未观测到的东西、卡在哪、复核方法；含 R4 与 `desktop` profile（TD-066）和版本漂移（TD-065）。

### 4. 夹具与投影

文件 `tests/contract/fixtures/harness-session/session-api.json`，对象每个数组元素占一行：

    {"provenance":{"record":"docs/architecture/harness-session-api.md","host":"@deepseek-ai/dsh","hostVersion":"0.2.0-rc.2","launcher":"<Desktop dsh CLI 或 npx 运行时>，web profile，一次性 DSH_HOME","surface":"ctx.sessionController","probe":"hp-session-probe@0.0.0","recordedAt":"<UTC ISO>","projection":"session-probe-v1","placeholders":{"<scratch>":"一次性根目录"}},
     "exchanges":[
     {"observation":"O1.1","operation":"create","request":{"cwd":"<scratch>/work"},"outcome":{"ok":true,"value":{"sessionId":"session-…"}}},
     …],
     "events":[
     {"observation":"O2.1","event":"api-session/status","sessionId":"session-…","running":true},
     …]}

投影在探针写日志之前完成（宿主日志里就没有提示词正文之外的会话内容），生成器只做挑选与排序：

- `operation` 只取 `create`、`prompt`、`cancel`、`list`、`inspect`；失败写 `{"ok":false,"error":{"code","message","details","remote"}}`，`remote` 为 `error.isDSHRemoteError === true`。
- `inspect` 的 `value` 只保留 `events`，且只保留 `turn/start`、`turn/end`、`step/start`、`step/end`，以及 `source.kind = user` 的 `user/message`；每个事件只留 `seq`、`type`、`turn`、`reason`（`turn/end`：`{ kind, reason?: { kind }, error?: { code } }`）、`rpcId`（用户消息的 `source.rpcId`）。
- `list` 的 `value` 只保留探针自己的会话行，每行只留 `sessionId`、`running`、`agentAvailable`、`blank`。
- 会话 id 保留原值（随机 UUID，不是凭据或身份，保留才能与 `list` / `inspect` 交叉对应）；`$SCRATCH` 的真实值换成 `<scratch>`；时间戳、端口、令牌、主机名、假密钥及其摘要一律不进夹具。
- prompt 的文本是探针自己写的固定串 `hp-session-probe: reply with OK only. Do not call tools.`，原样保留。

### 5. 契约测试 `tests/contract/harness-session-api-record.test.js`

离线：只读仓库文件，不跑 git、不联网。真实文件缺失时相关用例响亮失败，不跳过。

- 常量：`OK = '已观测到'`；`CORE`、`IMPLEMENT`、`NON_DECISIVE` 三个数组；`OBS_HEADER`、`SHORTCUT_HEADER`、`MAPPING_HEADER`；`HYGIENE` 正则覆盖 `/var/folders`、`/private/(var|tmp)`、`/tmp/`、`token=`、`localhost:\d`、`127\.0\.0\.1:\d`、家目录前缀、`hp-probe-fake-`、`x-api-key`。家目录片段在源码里拼接书写（如 `'/Us' + 'ers/'`），免得测试文件自己命中 `disclosure`。
- 预注册常量用例：在 `docs/exec-plan/active/` 与 `docs/exec-plan/completed/` 里找到恰好一份本计划，取 `session-rule` 块（行首锚点），解析三行 `` - `CORE`：…`` 等，与三个数组逐项相等。
- `parseRecord(text)`：按 `## N.` 切九节（缺节或重复即失败）；解析 §2 三行、§3 观测表（每个预注册 ID 恰好一行，未预注册 ID 失败，取值与反引号校验）、§5 捷径（影响判定只取是 / 否，O-ID 不得写范围或 `O3.x`）、§6 三行、§7 映射表。

`deriveConsequence(rows, shortcuts)` 逐字使用下面的实现（变异表依赖这些锚点行）：

    function deriveConsequence(rows, shortcuts) {
      const blocked = new Set(shortcuts.filter((s) => s.affects === '是').flatMap((s) => s.ids))
      const counted = (id) => {
        const hits = rows.filter((r) => r.id === id)
        assert.equal(hits.length, 1, `${id} 必须恰好出现一次，实际 ${hits.length} 次`)
        return hits[0].result === OK && hits[0].strength === 'S3' && !blocked.has(id)
      }
      const reachable = counted('O0.1') && counted('O0.2') ? '是' : '否'
      const coreMissing = CORE.filter((id) => !counted(id))
      if (coreMissing.length > 0) return { consequence: 'move-after-demo', reachable, missing: coreMissing }
      const implementMissing = IMPLEMENT.filter((id) => !counted(id))
      return { consequence: implementMissing.length ? 'narrow' : 'implement', reachable, missing: implementMissing }
    }

其余检查函数：

- `checkTimes(rec)`：全部时间合法；预注册早于 T0；每行不早于预注册；`CORE` 与 `IMPLEMENT` 中「已观测到」的行满足锚点行 `t >= rec.t0Ms`。不设上限窗口（理由见 `Decision Log` D7）。
- `checkFixture(rec, fixture)`：含锚点行 `if (consequence !== 'move-after-demo') assert.ok(fixture !== undefined, '结论不是 move-after-demo 时必须有夹具')`；`provenance.hostVersion` 等于记录 §2 的宿主版本；每个 `observation` 指向「已观测到」的行；有 O1.1 的 `create` 成功、O1.2 的 `prompt` 成功、以 O2.1 或 O2.2 为观测的 `list` 或 `inspect` 成功；每个计入的 `IMPLEMENT` 行有对应 `inspect`，事件里 `turn/end` 的 `reason.kind` 分别为 `completed`（O3.1）与 `aborted`（O3.2）；事件与 `list` 行的键在 §4 白名单内；全文不匹配 `HYGIENE`。结论为 `move-after-demo` 时记录须含 `### 6.1 为何录不到`，夹具可缺。
- `checkMapping(rec)`：§7 映射表每行的 `ExecutionRunStatus` 取自 `@harness-projects/domain` 的 `ExecutionRunStatus` 值；来源里出现的每个 O-ID 都是「已观测到」的行。
- 索引用例：`docs/architecture/README.md` 含 `[harness-session-api.md](harness-session-api.md)`；`docs/README.md` 含指向本计划的链接，且链接目录（`exec-plan/active/` 或 `exec-plan/completed/`）等于预注册常量用例找到计划的目录（防合并冲突丢行与归档后链接失效，D17）。
- 合成用例（用例名里的中文片段是变异表的 `killedBy`）：`推导：全部计入 → implement，插件可达 是，缺项为空`；`推导：缺 O3.2 → narrow，缺项 O3.2`；`推导：任一 CORE 未观测、强度 S2 或被捷径影响 → move-after-demo`；`推导：O0.2 未计入 → 插件可达 否`；`推导：非决定项不影响结论`；`推导：预注册 ID 缺失或重复 → 抛错`；`解析：表头、取值、未预注册 ID、反引号、捷径 O-ID 逐个列出`；`夹具：结论不是 move-after-demo 时夹具缺失 → 失败`；`夹具：start 或 status read 缺失 → 失败`；`夹具：observation 指向未观测行 → 失败`；`夹具：inspect 事件出现白名单外的键 → 失败`；`卫生：临时路径、令牌、回环端口、家目录、假密钥前缀 → 失败`；`时间：格式、预注册先于 T0、决定性行不早于 T0`；`版本：记录与夹具的宿主版本不一致 → 失败`；`映射：来源引用未观测的 O-ID 或状态不在 ExecutionRunStatus → 失败`。
- 真实文件用例：`真实记录：结论块等于推导`；`真实记录：时间、卫生、映射与索引登记`；`真实夹具：与记录一致、版本、白名单与卫生`。

### 6. 状态映射提案（写进记录 §7，观测后按来源定稿）

两条轴：生命周期（`running`）与结果（`turn/end.reason.kind`）。`prompt` 的回执只表示入 inbox，所以「已接纳、尚无 `turn/start`」是 `starting`；`running: true` 是 `running`；`completed` → `succeeded`；`error` → `failed`；`aborted` → `canceled`（ACP 把取消定义为一种结束原因而不是错误）；`blocked`、`max-tokens`、`interrupted`、`forked` 与未知 kind → `unknown`（可合并扩展，未观测前不猜）。映射是给 #140 的提案，#140 的契约套件拥有最终断言。

### 7. 被放弃的方案

- **浏览器侧 `ctx.remote.session`**：执行 provider 在宿主进程里；走浏览器会让 Client 成为执行事实的中转，违反不变量 7 与 ADR-0013；还会触发 API key 对话框与 Documents 副作用。只记 S1。
- **SDK / headless / ACP 进程外入口**：多一个运行时进程与状态拥有者；SDK 的 JSON-RPC 没有取消；同一 `DSH_HOME` 下有写锁冲突。
- **底层 `ctx.agents`**：会绕开会话控制器的「预设感知恢复策略与子 agent 归属栅栏」（README 原文 preset-aware resume policy and subagent ownership fence）。
- **只做静态记录**：不满足验收 1 的「观测」，且 S1 在注入环节失手过。
- **直接在真实 Desktop profile 上用用户凭据跑成功路径（R4）**：要改真实 profile、花额度、Agent 可能在 cwd 执行工具，需人类批准，转 TD-066。
- **在 spike 文档追加 §12**：spike 的 §1–§10 被 sha256 锁定、§11 只能有一个（`tests/contract/harness-host-reprobe-record.test.js`），问题与结论也不同。

## Global Constraints

- **文件集合**（本 PR 唯一声明处）：新增 `docs/architecture/harness-session-api.md`、`tests/contract/fixtures/harness-session/session-api.json`、`tests/contract/harness-session-api-record.test.js` 与本计划；各追加一行 `docs/architecture/README.md`、`docs/README.md`；追加 TD-065、TD-066 两行到 `docs/exec-plan/tech-debt-tracker.md`（手工追加，不用 tracker 脚本）。不改 `docs/architecture/harness-host-spike.md`、`apps/**`、`packages/**`，不写 ADR。
- **跨 PR 写入边界与共享文件协议**（D16）：D 独有的是上一条的三个新文件与 `docs/architecture/README.md` 里的那一行；`apps/**`、`packages/**` 属 A（#132：`host.ts`、`host-composition.ts` 的结构、`host-providers.ts`）、B（#276：`remote.ts`、`client.ts`、`packages/client/**`）、C（#231：`packages/providers/development-github/**`），本 PR 一律不写，只在记录 §7 陈述接缝；ADR-0014 属 A，ADR-0015 预留给 B。共享文档：`docs/README.md` 的 Active 表把本计划行插在表头分隔行 `|---|---|---|` 正下方，冲突时后合并者保留全部行，并把 2026-10-15 的行按计划文件名排序；TD-065、TD-066 放在 Open Items 的数字位置（A 053–056、B 057–060、C 061–064 之后），与合并顺序无关；只有 A 改既有 TD-030 / TD-031 单元格。
- **规模**：`node scripts/rule-checks.mjs size origin/main` 代码 ≤ 800、文档 ≤ 1300（CI 上限 1000 / 1500）。估算（2026-10-15 10:40 +08 修订，设计估算不是回读值）：代码约 350–390（测试约 300–350，先例 `tests/contract/harness-host-reprobe-record.test.js` 269 行、检查更少；夹具约 40）；文档约 900–950（记录约 350、本计划回填后约 560 含变异 spec、索引与债务约 10）。都在预算内，不需要栈。
- **合并顺序**（D18）：D 不入栈，从 main 分出，与 A / B / C 互不依赖，自身门禁通过即可合并；推荐顺序 C → D → A → B，D 在窗口 S-D 与本 PR Batch 6 之后合并，可与 A / B 任意交错。
- **宿主安全**：所有宿主命令只经 Batch 3 的 `dsh_s.sh`；`DSH_HOME` 只指向 `$SCRATCH/home`；只用 `web` profile、`--port 0 --no-open`；不打开浏览器；不碰真实 `~/.dsh`、真实 `desktop` profile 与本机运行中的宿主实例；不读本机凭据存储、API key 文件或令牌文件；假密钥只在 R3 的进程环境里，不写文件、不入库；宿主输出里带令牌的 URL 不读、不打印，只用 `grep -c` 计数，交给实施者的只有过滤后的探针行（第 10、11 步）。
- **发布面**：记录、夹具、计划、提交信息与 PR 正文不写本机绝对路径、端口、令牌、本机用户名与主机名、假密钥及其摘要；提交前做 `docs/development/publication.md` 的机械扫描与人工五类目，另做 canary 扫描（Batch 3 第 11 步）。
- **人类专属**：ADR 只写 Proposed（本 PR 不新增 ADR）；不写看板 `Status`、`blocked-by` / `blocking`；不改 #140 的验收范围；不对 #140 发评论（可选，需人类批准）；合并由人类伙伴决定，只用 rebase merge。
- **Git**：分支 `test/harness-session-api-probe`；不在 worktree 内写 `git config`，身份用 `git -c user.name=… -c user.email=…` 单次传入；预注册提交独立且内容在整合后不变；提交正文写 `Refs #280`，关闭关键字只出现在 PR 正文。
- 运行时：Node 26（仓库），pnpm 10.28.2（`packageManager`）；Desktop 内嵌 Node 24.18.1 只用于宿主进程。

## Plan of Work

### Batch 0 · 预注册与 draft PR（协调者）

**最小闭环**：本计划（含 `session-rule` 块）作为独立提交推送，draft PR 建立并关联 issue，时间锚早于 T0。
**涉及文件**：本计划。
- [ ] 在检出 `test/harness-session-api-probe` 的工作树根目录提交本计划：`docs(exec-plan): 预注册宿主会话接口观测计划`，正文 `Refs #280`。
- [ ] `git push -u origin test/harness-session-api-probe`；`gh pr create -R SingularityKChen/harness-projects --draft --base main --head test/harness-session-api-probe --title "test(apps): observe the session API a Harness plugin can call to start and read runs" --label kind:test --label area:apps --label area:architecture --milestone "M4 · MVP Demo：Harness 内打通 GitHub 链路"`，正文按 `.github/pull_request_template.md`：闭环、ExecPlan 路径与 Batch 名、关闭关键字指向 #280、`Refs #140`、`Refs #136`、风险与回滚。
- [ ] Project 字段只做机械回填：issue #280 条目的文本字段 `ExecPlan` 写本计划路径、`Batch` 写当前批次名（字段 ID 与命令见 `docs/project-management/README.md` §3），`Kind` / `Area` 与标签一致；不写 `Status`、不写 blocked-by。
- [ ] 回读并把预注册提交的完整 SHA、`%aI` 与 PR `createdAt` 记进 `Progress`。
**验证**：`gh pr view <n> -R SingularityKChen/harness-projects --json isDraft,baseRefName,headRefName,labels,milestone,closingIssuesReferences,createdAt`（期望：draft、base `main`、三个标签、M4、`closingIssuesReferences` 含 280）；`gh issue view 280 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences`（期望含本 PR；刚开时若为空，改正文后再回读）。
**回滚**：关闭 draft PR、删除远端分支；计划回到未推送状态。

### Batch 1 · 记录一致性契约测试（红）（实施者，Sonnet）

**最小闭环**：契约测试按 Design / Spec §5 写完，合成用例全绿，真实文件用例因记录与夹具未定稿而红；记录的静态骨架（§1、§4、§7 的 S1 部分、§8、§9）写好。
**涉及文件**：`tests/contract/harness-session-api-record.test.js`、`docs/architecture/harness-session-api.md`（骨架）。
- [ ] 先写合成用例与解析器、推导、检查函数；`deriveConsequence` 与两条锚点行逐字照抄。
- [ ] 记录骨架：§4 的 M 行由实施者亲自复核 `Context and Orientation` 事实 1–12（命令写 `$HOST_RUNTIME/…/` 形式，时间取复核时 `date -u`）；§3、§5、§6 只放表头与说明，不填观测；§7 映射表来源暂写 `S1`。
**验证**：`node --test tests/contract/harness-session-api-record.test.js`（期望：合成用例全过；三条真实文件用例失败，失败原因是观测表缺预注册 ID、夹具缺失或索引未登记，而不是解析器异常）；`node --test tests/contract/harness-host-reprobe-record.test.js`（期望全过，spike 未动）。
**回滚**：删除新测试与记录骨架。

### Batch 2 · 仓库外探针工具（实施者，Sonnet；只写 `.superpowers/session-probe/`）

**最小闭环**：探针、stub、守卫脚本、夹具生成器与 asar 读取器就绪，并在假 `ctx` 下自检（S2，仅防探针缺陷，不是证据）。
**涉及文件**：`.superpowers/session-probe/probe/{package.json,cordis.patch.yml,lib/index.js}`、`.superpowers/session-probe/tools/{stub.mjs,dsh_s.sh,make-fixture.mjs,asar-cat.mjs,selfcheck.mjs}`（git 忽略，不提交）。
- [ ] `package.json`：`name: hp-session-probe`、`version: 0.0.0`、`type: module`、`main: ./lib/index.js`、`exports` 含 `.`、`./cordis.patch.yml`、`./package.json`、`dsh.manifestVersion: 1`、`dsh.bundle.patch: ./cordis.patch.yml`、`peerDependencies: { "@deepseek-ai/dsh-api-session-controller": "~0.2.0-rc.2" }`，无 `dependencies`、无 client 半边。`cordis.patch.yml`：`- insert: [{ id: hp-session-probe, name: hp-session-probe }]`。
- [ ] `lib/index.js`：`export const name = 'hp-session-probe'`、`export const inject = ['sessionController', 'credentials']`、`export function apply(ctx)`；不 import 任何包。apply 里订阅 `api-session/status`，用 `ctx.effect` 启动按 `process.env.HP_PROBE_MODE`（`core` / `restart` / `stub`）选择的步骤序列（见 `Concrete Steps` 的步骤表），dispose 时 abort。每步写一行 JSON 到 stdout：`{"probe":"hp-session-probe","at":<ISO>,"mode","oid","op","request","outcome"}`；写之前按 Design / Spec §4 投影，并把 `HP_PROBE_SCRATCH` 的值替换成 `<scratch>`。每个等待都有上限（60 s / 30 s），超时写 `{"outcome":{"ok":false,"error":{"code":"probe/timeout"}}}` 后继续。结束写 `{"event":"done"}`。
- [ ] `stub.mjs <sink|stub>`：只监听 `127.0.0.1:0`，把端口写进 `$SCRATCH/obs/<名>.port`；每个请求追加一行 `{at,method,path,keySha8,bytes}` 到 stdout（`keySha8` 为 `x-api-key` 的 sha256 前 8 位或 `null`，不记请求头与正文）。`sink` 对任何请求回 503。`stub` 有 `GET /__hp/mode?m=reply|hold` 与 `GET /__hp/state`（返回 `{ mode, held }`）；`reply` 回 200 `text/event-stream`，依次是 `message_start`（`message` 含 `id`、`type: message`、`role: assistant`、`model: deepseek-flash`、`content: []`、`usage: { input_tokens: 1, output_tokens: 0 }`）、`content_block_start`（`index 0`、`text` 块）、`content_block_delta`（`text_delta` `OK`）、`content_block_stop`、`message_delta`（`stop_reason: end_turn`、`usage.output_tokens: 1`）、`message_stop`；`hold` 只发 `message_start` 后保持连接，直到客户端断开，并维护 `held` 计数。
- [ ] `dsh_s.sh`（bash 3.2 兼容）：要求 `SCRATCH`、`DSH_BIN` 已导出且 `SCRATCH` 等于其 realpath；把 `--` 之前的参数当额外环境；`cd "$SCRATCH"` 后 `exec env -i PATH=/usr/bin:/bin HOME="$HOME" TMPDIR="$SCRATCH/tmp" DSH_HOME="$SCRATCH/home" DSH_TELEMETRY_DISABLED=1 HP_PROBE_SCRATCH="$SCRATCH" ${extra[@]+"${extra[@]}"} "$DSH_BIN" "$@"`。
- [ ] `make-fixture.mjs <obs-dir>`：读 `probe-*.jsonl`（第 10 步从宿主 stdout / stderr 过滤出的探针行）里带 `oid` 或 `event: api-session/status` 的行，按 Design / Spec §4 输出夹具到 stdout；不做任何投影之外的改写。
- [ ] `asar-cat.mjs <app.asar> <内部路径>`：读 16 字节头，`uint32LE@12` 是 JSON 头长度，JSON 头从偏移 16 开始，数据基址 `8 + uint32LE@4`，文件偏移相对基址；目录打印条目名，文件原样输出。
- [ ] `selfcheck.mjs`：用假 `ctx`（按事实 4–8 的形状返回）跑三种模式，断言日志行的 `oid` 序列与步骤表一致、所有行不含假 `HP_PROBE_SCRATCH` 原值；再把产出喂给 `make-fixture.mjs`，用 Batch 1 的测试函数校验结构（夹具写到 `.superpowers/` 下的临时文件，不写进 `tests/`）。
**验证**：`node --check` 每个 `.mjs` / `.js`；`node .superpowers/session-probe/tools/selfcheck.mjs`（期望退出码 0）；`git status --short`（期望不出现 `.superpowers/` 的条目）。
**回滚**：删除 `.superpowers/session-probe/`。

### Batch 3 · 真实宿主 S3 观测（协调者独占，不得由本地测试替代）

**最小闭环**：按 `Concrete Steps` 第 1–11 步在一次性 profile 里完成 R1、R2、重启与 R3，产出 `$SCRATCH/obs/*`，守卫与收尾核对全部有记录。
**涉及文件**：无仓库文件（观测日志在 `$SCRATCH/obs/`，过滤后的副本在 git 忽略的 `.superpowers/session-probe/obs/`，防会话中断丢失）。
**前置（宿主窗口 S-D，D15；放在 `session-rule` 块外，在 Batch 0 推送前定稿）**：
- 窗口 S-D 先于 A / B 的窗口 S-AB，必须走完第 9 步收尾核对才结束；协调者把窗口开始（第 1 步 `marker` 时刻）与结束（第 9 步完成）以 +08 时刻记进 `Progress`。
- 窗口内任何人不向真实 profile 安装插件、不写 `~/.dsh`：第 9 步的守卫数 `~/.dsh` 下的新条目与用户级 pnpm 内容寻址库的新文件，而 A / B 的 Desktop 安装用自带 pnpm 并创建 `~/.dsh/harness-projects`，重叠会让守卫误触发。
- Batch 0 已推送（预注册提交与 draft PR 早于 T0）；Batch 1、2 全绿，含探针自检。
- 第 2 步复核 `npm view @deepseek-ai/dsh dist-tags --json` 与 Desktop 的 `CFBundleShortVersionString` 都是 `0.2.0-rc.2`，否则停下问人类伙伴。
- [ ] 开始前在会话里告知人类伙伴：将用 Desktop 自带 `dsh` 在一次性 `DSH_HOME` 下启动 `web` 宿主，R3 会把本次生成的假密钥放进该进程环境、模型端点指向本机回环 stub；人类反对时跳过 R3（O3.x 记「未观测到 / S0」，结论按规则落到 `narrow`）。
- [ ] 每完成一步，把 UTC 时间与读数追加到 `.superpowers/session-probe/evidence.md`（工作树内、git 忽略，会话恢复后仍在；不放会话 scratchpad）。
- [ ] 窗口结束时把启动器、`plugin add` 与 stdout / stderr 的读数（第 8b、10 步）交给 A 的 Desktop 窗口说明，并写进本计划 `Surprises & Discoveries` 的对应条目。
**验证**：`grep -c` 在 `$SCRATCH/obs/host-core.*`、`host-restart.*`、`host-stub.*`（`.log` 为 stdout、`.err` 为 stderr）里数到 `ready` 与 `done` 行（或写明在哪一步停下）；`$SCRATCH/obs/install.log` 末行 `exit=0`；`$SCRATCH/obs/sink.log` 行数为 0；收尾核对 H 行全部有命令输出。
**回滚**：停掉 scratch 宿主与 stub；`$SCRATCH` 留到 PR 合并后由人类决定是否删除（不做破坏性删除）；真实数据根与 Documents 若出现新条目，停下交人类。

### Batch 4 · 记录定稿与夹具（转绿）（实施者，Sonnet，读协调者给的 obs 目录）

**最小闭环**：记录 §2、§3、§5、§6、§7 来源列按证据填写，夹具由生成器产出，契约测试全绿。
**涉及文件**：`docs/architecture/harness-session-api.md`、`tests/contract/fixtures/harness-session/session-api.json`、`docs/architecture/README.md`（主题索引加一行）、`docs/README.md`（Active 表分隔行正下方加本计划一行，链接 `exec-plan/active/`，D16）。
- [ ] §2 写预注册 SHA 与时刻、T0、版本三处来源、启动方式（若用了 npx 回退，§5 加一行）、步骤表；§3 每个预注册 ID 一行，时间取日志；观测摘录与尝试记录；§5 只列采用的捷径与 H 行；§6 按 §2.3 推导填写（先用测试函数算出，再写入，不手工挑选）。
- [ ] 在工作树根目录运行 `node .superpowers/session-probe/tools/make-fixture.mjs <协调者给出的 obs 目录> > tests/contract/fixtures/harness-session/session-api.json`，不手改。
- [ ] §7 的映射表来源按实际观测改写（例如 O3.1 未计入时 `completed` 行来源保持 `S1`）；Host 接缝与会话推送远端两段按 Design / Spec §3 的条件措辞，以当时 `origin/main` 是否含 #132、#231 为准（`git ls-tree origin/main apps/harness-plugin/src/host-providers.ts`），Batch 6 的合并前 rebase 再核一次。
**验证**：`node --test tests/contract/harness-session-api-record.test.js`（期望全过）；`pnpm run test:contract`（期望全过）；`grep -F -f "$SCRATCH/canaries.txt" docs/architecture/harness-session-api.md tests/contract/fixtures/harness-session/session-api.json`（期望无输出，由协调者执行）。
**回滚**：`git restore` 记录与夹具到 Batch 1 骨架，撤掉两处索引行。

### Batch 5 · 对抗验证（独立验证者，Sonnet，非 Batch 1/4 的实施者）

**最小闭环**：下表每个关键断言都有一个能让它变红的变异，用 `scripts/review-mutate.mjs` 在最终树上整表运行，全部 KILLED；spec 全文附进本计划 `Artifacts and Notes`。
**涉及文件**：`.superpowers/review/D/mutants.json`（git 忽略）；本计划。
- [ ] 按下表写 spec：`command` 为 `["node","--test","tests/contract/harness-session-api-record.test.js"]`；锚点必须在文件里恰好出现一次（工具会对非唯一锚点报 `NOT_APPLIED` 而不计存活），还原由工具从内存原文按字节写回并逐字节比对，不用 `git checkout`。记录与夹具类变异的锚点取最终树上的整行。

| M | 文件 | 锚点 → 替换 | 被它变红的断言（`killedBy`） |
|---|---|---|---|
| M1 | 测试 | `hits[0].strength === 'S3'` → `true` | S2 不计入（`强度 S2`） |
| M2 | 测试 | `&& !blocked.has(id)` → 空串 | 捷径影响（`捷径`） |
| M3 | 测试 | `counted('O0.1') && counted('O0.2') ?` → `counted('O0.1') ?` | 可达判定（`插件可达`） |
| M4 | 测试 | `implementMissing.length ? 'narrow' : 'implement'` → `'implement'` | 缺取消降档（`narrow`） |
| M5 | 测试 | `coreMissing.length > 0` → `coreMissing.length > 1` | 单个核心缺失（`move-after-demo`） |
| M6 | 测试 | `if (consequence !== 'move-after-demo') assert.ok(` → `if (false) assert.ok(` | 夹具必须存在（`夹具缺失`） |
| M7 | 测试 | `HYGIENE` 里的 `127\.0\.0\.1:\d` 分支删除 | 回环端口卫生（`卫生`） |
| M8 | 测试 | `t >= rec.t0Ms` → `t >= rec.preregMs` | 决定性行不早于 T0（`T0`） |
| M9 | 记录 | O1.1 那一整行的 `S3` 改 `S2` | 结论等于推导（`真实记录`） |
| M10 | 记录 | §6 第一行的结论值换成另一取值 | 结论等于推导（`真实记录`） |
| M11 | 记录 | §2 宿主版本行改成 `0.2.1-alpha.3` | 版本一致（`真实夹具`） |
| M12 | 夹具 | `"provenance":{` → `"provenance":{"leak":"/var/folders/x",` | 夹具卫生（`真实夹具`） |
| M13 | 夹具 | 删除 O1.2 那一整行 | start 必须在夹具里（`真实夹具`） |
| M14 | 夹具 | 以 O2.2 的 `inspect` 整行为锚点，替换为同一行但第一个事件对象多一个 `"time":1` 键 | 事件白名单（`真实夹具`） |
| M15 | 本计划 | 以 `session-rule` 块里 `CORE` 那一整行为锚点，替换为删去 `、O2.2` 的同一行 | 预注册常量（`预注册常量`） |
| M16 | 记录 | §7 映射表 `succeeded` 行的来源改成一个「未观测到」的 O-ID（无则改成 `O9.9`） | 映射来源（`真实记录`） |
| M17 | `docs/README.md` | 本计划行的链接目录换成计划不在的那个（`exec-plan/active/` ↔ `exec-plan/completed/`） | 索引链接与计划位置一致（`真实记录`） |

- [ ] 发现存活变异：先判断是否等价变异（写明理由），否则补判别用例后整表重跑；变异表只在最终树上重测（Batch 6 归档与重构后再整表跑一次，D19）。
**验证**：`node scripts/review-mutate.mjs .superpowers/review/D/mutants.json --root .`（期望退出码 0，17 个 KILLED，没有 `NOT_APPLIED`、`KILLED_OTHER`）；之后 `git status --short`（期望只有 Batch 5 自己写进本计划的改动）。
**回滚**：工具自动还原；若被中断（退出码 130）先用 `git diff` 确认被测文件与运行前一致。

### Batch 6 · 独立验收、重构与文档回填（验收者，Opus）

**最小闭环**：对照 issue #280 三条验收与本计划逐条复核，重构测试（不改变验收结果），回填索引、债务与计划，整合提交，PR 置 ready 并请求人类评审。
**涉及文件**：见 `Global Constraints` 的文件集合。
- [ ] 复核：每条 O 行的命令可重放、时间取自日志；结论块与测试推导一致；§7 接缝不越权（不写 #132 / #276 的文件，不替 #140 做决定），措辞符合 Design / Spec §3 的条件；§4 的仓库侧事实带 base；夹具投影符合 §4；R4 与 `desktop` profile 写进 §9；把发现写进 `Surprises & Discoveries`。
- [ ] 回填：核对 Batch 4 加的两处索引行；`docs/exec-plan/tech-debt-tracker.md` 的 Open Items 在数字位置手工加 TD-065、TD-066（字段顺序同表头，不跑 tracker 脚本）；本计划 `Outcomes & Retrospective`。
- [ ] 归档：全部验收通过后把本计划移到 `docs/exec-plan/completed/`（文件名不变），`docs/README.md` 本计划行的链接改到 `completed/`、状态改 Completed；`session-rule` 块内容不动。归档与重构后在最终树上按新路径重取锚点，整表重跑变异 spec，读数与 head 附进 `Artifacts and Notes`（D19）。
- [ ] 整合提交（先建 `backup/pr<n>-before-final-integration-<日期>`）：①预注册提交保持原内容；②`test(architecture): 记录宿主会话接口观测、夹具与一致性契约`（记录、夹具、测试）；③`docs(exec-plan): 归档会话接口观测计划并回填索引与债务`。正文写原因与 `Refs #280`，结尾带 Co-Authored-By 行。整合后用 `comm` 比对新旧 head 的文件集合，`grep '^#'` 检查提交正文没有被编辑器吃掉的行。
- [ ] `git push --force-with-lease=test/harness-session-api-probe:<旧 head>`；回读 head、base、checks、`closingIssuesReferences`、review threads。
- [ ] 并集验证（协调者，D17）：一次性工作树 `.worktrees/round6-union`（分支 `test/round6-union`，永不推送）合并 main 与 B（含 A）、C、D 的当前 head，运行 `pnpm install --frozen-lockfile --offline && pnpm verify && pnpm run boundaries`；`pnpm verify` 经 `tests/contract` 已含本 PR 的记录测试，另单跑 `node --test tests/contract/harness-session-api-record.test.js` 留一条清楚读数。通过后才 `gh pr ready <n> -R SingularityKChen/harness-projects`，并在会话里请求人类伙伴评审。
- [ ] 合并前（合并由人类伙伴决定，D18）：rebase 到当前 main（严格保护下每次合并后其余 PR 变 BEHIND）；`docs/README.md` 与 tracker 冲突按共享文件协议解决；按当时 main 复核记录 §7 的条件措辞；在 main 加仍未合并的 head 上重跑并集 `pnpm verify`；回读 `closingIssuesReferences`。合并后回读 #280 的状态。
**验证**：`pnpm run test:contract`；`pnpm run boundaries`；`node scripts/workflow-check.mjs`；`node scripts/rule-checks.mjs disclosure origin/main`；`node scripts/rule-checks.mjs size origin/main`；`git diff --check origin/main...HEAD`；`grep -nE 'HostProviderFactory|ADR-0013 的注入' docs/architecture/harness-session-api.md`（期望无输出）；`python3 <exec-plan skill>/scripts/lint_execplan.py <本计划>`（期望：全部通过，规模在预算内，lint 输出 `OK`）；`gh pr checks <n> -R SingularityKChen/harness-projects`（期望全部 pass）。
**回滚**：`git reset --hard backup/pr<n>-before-final-integration-<日期>` 后重新整合；已推送时用精确 lease 推回备份。

## Concrete Steps

Batch 3 的确切步骤。所有命令在协调者的 shell 里运行，工作目录是 `$SCRATCH`（不是仓库根，避免任何 `.env`）；`<worktree>` 指检出 `test/harness-session-api-probe` 的工作树根目录。stub 从环境变量 `SCRATCH` 取根目录，探针从 `HP_PROBE_SCRATCH` 取根目录、从 `DEEPSEEK_BASE_URL` 取 stub 控制地址。

**第 1 步 · 环境与 T0**

    export SCRATCH="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/hp-session.XXXXXX")" && pwd -P)"
    mkdir -p "$SCRATCH/home" "$SCRATCH/work" "$SCRATCH/obs" "$SCRATCH/tmp"
    export DSH_BIN="$(command -v dsh)"; ls -l "$DSH_BIN" > "$SCRATCH/obs/launcher.txt"
    /bin/cp -R <worktree>/.superpowers/session-probe/probe "$SCRATCH/probe"
    /bin/cp -R <worktree>/.superpowers/session-probe/tools "$SCRATCH/tools"
    lsof -nP -iTCP -sTCP:LISTEN > "$SCRATCH/obs/listen-before.txt"
    ls -a "$SCRATCH" "$SCRATCH/home" > "$SCRATCH/obs/no-dotenv.txt"
    touch "$SCRATCH/marker"; date -u +%FT%TZ | tee "$SCRATCH/obs/t0.txt"

`marker` 时刻即窗口 S-D 开始，协调者以 +08 记进 `Progress`。

**第 2 步 · 版本三处来源**：`"$SCRATCH/tools/dsh_s.sh" -- --version`、`npm view @deepseek-ai/dsh dist-tags --json`、`/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "<Desktop 应用包>/Contents/Info.plist"`，各带 `date -u` 写进 `obs/versions.txt`。期望都是 `0.2.0-rc.2`；不一致就停下问人类伙伴，再更新本计划。

**第 3 步 · 打包与安装（O0.1）**

    (cd "$SCRATCH/probe" && npm pack --pack-destination "$SCRATCH")
    "$SCRATCH/tools/dsh_s.sh" -- plugin --profile web add "$SCRATCH/hp-session-probe-0.0.0.tgz" > "$SCRATCH/obs/install.log" 2>&1
    echo "exit=$?" >> "$SCRATCH/obs/install.log"; date -u +%FT%TZ >> "$SCRATCH/obs/install.log"
    "$SCRATCH/tools/dsh_s.sh" -- --profile web --dump-config | grep -n baseURL

最后一条期望无输出（记 H 行：组合后的 profile 没有显式 `baseURL`，端点只由 `DEEPSEEK_BASE_URL` 决定）。Desktop CLI 安装失败时，按捷径表改走 npx 运行时并记入台账：`DSH_BIN` 换成 `$SCRATCH/tools/dsh-npx.sh`（两行 sh：`exec <node 的绝对路径> "$HOST_RUNTIME/node_modules/@deepseek-ai/dsh/lib/bin.js" "$@"`，因为 `env -i` 后的 `PATH` 里没有 `node`）；这条路线的 `dsh plugin` 需要可被直接 spawn 的 pnpm（spike M13），所以额外环境里再传 `PATH=$SCRATCH/shim:/usr/bin:/bin`，`shim/pnpm` 是转调全局 pnpm 的 `#!/bin/sh` 垫片（spike §11.5 同一捷径，判定「否」）。

**第 4 步 · 起 sink（R2）**：`node "$SCRATCH/tools/stub.mjs" sink > "$SCRATCH/obs/sink.log" &`，`echo $! > "$SCRATCH/obs/sink.pid"`；端口读 `obs/sink.port`。

**第 5 步 · `core` 模式（O0.2、O1.1、O1.2、O2.1、O2.2、O4.1、O4.2、O4.3）**

    "$SCRATCH/tools/dsh_s.sh" HP_PROBE_MODE=core DEEPSEEK_BASE_URL="http://127.0.0.1:$(cat "$SCRATCH/obs/sink.port")" -- web --no-open --port 0 > "$SCRATCH/obs/host-core.log" 2> "$SCRATCH/obs/host-core.err" &
    echo $! > "$SCRATCH/obs/host.pid"

stdout 与 stderr 分开落文件，以便记录 `dsh web` 与探针输出各走哪条流（给 A 的 Desktop 窗口）。用 Monitor 等到任一流出现 `"event":"done"`（上限 5 min），期间每 5 s 把 `lsof -nP -a -p "$(cat "$SCRATCH/obs/host.pid")" -iTCP -sTCP:ESTABLISHED` 追加到 `obs/net-core.txt`。确认就绪行里 `credential.configured` 为 `false`、`sink.log` 为空，否则按 §2.5 第 3 条停下。`kill -TERM` 宿主并等它退出。探针在 `core` 模式按下表执行（`<sid>` 为 O1.1 返回值，`<unknown>` 为 `session-00000000-0000-4000-8000-000000000000`）：

| 序 | O-ID | 调用 |
|---|---|---|
| 1 | O0.2 | 就绪行：五个方法的 `typeof`，`ctx.credentials.describe('DEEPSEEK_API_KEY')` 的 `{ configured, source }` |
| 2 | O1.1 | `create({ cwd: HP_PROBE_SCRATCH + '/work' })` |
| 3 | O1.2 | `prompt({ requestId: 'hp-req-core-1', sessionId: <sid>, mode: 'queue', content: [{ type: 'text', text: 'hp-session-probe: reply with OK only. Do not call tools.' }] }, signal)` |
| 4 | O4.1 | 与第 3 序完全相同的请求再发一次 |
| 5 | O2.1、O2.2 | 每 250 ms `list({}, signal)` 与 `inspect(<sid>, signal)`，直到出现 `turn/end` 或 60 s；记最后一次 `list` 与 `inspect` |
| 6 | O4.3 | `cancel({ sessionId: <sid> })`，2 s 后再 `inspect`，记事件数前后 |
| 7 | O4.2 | `create({ cwd: HP_PROBE_SCRATCH + '/work', workspaceId: 'hp-none' })`；`prompt` 内容为 `'   '`（`requestId: 'hp-req-blank'`）；对 `<unknown>` 的 `prompt`（`requestId: 'hp-req-unknown'`）、`inspect`、`cancel` |
| 8 | — | 把 `<sid>` 写入 `HP_PROBE_SCRATCH + '/obs/core-session.txt'`，打 `done` |

**第 6 步 · 重启（O4.4）**：同第 5 步的命令但 `HP_PROBE_MODE=restart`，输出到 `obs/host-restart.log` 与 `obs/host-restart.err`。探针读 `core-session.txt`：`inspect(<sid>)` 冷读、`cancel({ sessionId: <sid> })`、`list({})`，打 `done`；停宿主与 sink。

**第 7 步 · R3 前置**：确认第 3 步 `baseURL` 核对无输出、第 5 步守卫未触发；然后生成假密钥并先写下摘要，再起 stub。

    FAKE_KEY="hp-probe-fake-$(node -e "process.stdout.write(require('crypto').randomBytes(16).toString('hex'))")"
    printf %s "$FAKE_KEY" | shasum -a 256 | cut -c1-8 > "$SCRATCH/obs/fake.sha8"
    node "$SCRATCH/tools/stub.mjs" stub > "$SCRATCH/obs/stub.log" &

**第 8 步 · `stub` 模式（O3.1、O3.2）**

    "$SCRATCH/tools/dsh_s.sh" HP_PROBE_MODE=stub DEEPSEEK_BASE_URL="http://127.0.0.1:$(cat "$SCRATCH/obs/stub.port")" DEEPSEEK_API_KEY="$FAKE_KEY" -- web --no-open --port 0 > "$SCRATCH/obs/host-stub.log" 2> "$SCRATCH/obs/host-stub.err" &
    echo $! > "$SCRATCH/obs/host.pid"

探针：O3.1 先请求 `/__hp/mode?m=reply`，create + prompt（`requestId: 'hp-req-reply-1'`），轮询到 `turn/end` 或 60 s；O3.2 请求 `/__hp/mode?m=hold`，create + prompt（`requestId: 'hp-req-hold-1'`），等到该会话 `api-session/status` 为 `true` 且 `/__hp/state` 的 `held ≥ 1`（上限 30 s），`cancel({ sessionId })`，轮询到 `turn/end` 或 30 s；打 `done`。每个 prompt 步骤前后各取一次第 5 步的 `lsof`，新出现非回环远端即按 §2.5 第 3 条停下。核对 `stub.log` 每行 `keySha8` 等于 `fake.sha8`（请求数可能多于 prompt 数：首个 prompt 可能另有一次标题请求）。停宿主与 stub，`unset FAKE_KEY`。

**第 8b 步 · 重装行为（非决定性，给 A 的 Desktop 窗口；不占决定性子预算，超过 20 分钟就记「未观测」）**：在 `$SCRATCH/probe` 写入只含 `date -u` 的 `build-id` 文件，以同名同版本在同一路径重新 `npm pack`，再 `plugin --profile web add` 同一路径一次，退出码与 `find "$SCRATCH/home" -path '*hp-session-probe*' -name build-id | wc -l` 写进 `obs/reinstall.log`（0 表示同名同版本重装被跳过）；然后 `plugin --profile web remove hp-session-probe` 再 `add`，再数一次。全部经 `dsh_s.sh`，只动一次性 `DSH_HOME`。

**第 9 步 · 收尾核对（H 行，只记计数不记路径）**：`find "$HOME/.dsh" -newer "$SCRATCH/marker" -not -path '*/node_modules/*' | wc -l`（逐条核对命中是否属于本机真实实例）；`find "$HOME/Documents/deepseek-harness" -newer "$SCRATCH/marker" 2>/dev/null | wc -l`（期望 0）；用户级 pnpm 内容寻址库里比 marker 新的文件数；`lsof -nP -iTCP -sTCP:LISTEN > "$SCRATCH/obs/listen-after.txt"` 与 before 对比，本机真实实例的监听未被占用或改变。本步完成即窗口 S-D 结束，协调者以 +08 记进 `Progress`。

**第 10 步 · 复制证据（只交过滤后的探针行）**：宿主流里有带令牌的 URL，原文不复制、不打印。

    O=<worktree>/.superpowers/session-probe/obs; mkdir -p "$O"
    for m in core restart stub; do cat "$SCRATCH/obs/host-$m.log" "$SCRATCH/obs/host-$m.err" | grep -F '"probe":"hp-session-probe"' > "$O/probe-$m.jsonl"; done
    for f in "$SCRATCH"/obs/host-*.log "$SCRATCH"/obs/host-*.err; do echo "$(basename "$f") dshweb=$(grep -c '^dsh web: ' "$f") probe=$(grep -cF '"probe":"hp-session-probe"' "$f")"; done > "$O/streams.txt"
    /bin/cp "$SCRATCH"/obs/{t0.txt,versions.txt,install.log,reinstall.log} "$SCRATCH"/obs/net-*.txt "$O/"

守卫与 H 行的读数（sink 计数、`keySha8` 是否一致、收尾计数）由协调者写进 `evidence.md`，`stub.log` 与 `fake.sha8` 不交出。`$SCRATCH` 的路径只在会话里交给 Batch 4 的实施者。

**第 11 步 · canary**：把 `$SCRATCH` 的 realpath、`$TMPDIR` 的 realpath、`id -un`、`hostname -s`、各宿主流里 `dsh web: ` 行的端口与令牌（用不回显的管道直接追加，会话里只看 `wc -l`）、`fake.sha8` 与假密钥前缀写进 `$SCRATCH/canaries.txt`（永不进工作树）；每次提交前、开 PR 与改 PR 正文前执行 `git -C <worktree> diff origin/main... | grep -F -f "$SCRATCH/canaries.txt"`（期望无输出）。

## Validation and Acceptance

#280 的三条验收都能在本 PR 关闭，不需要范围变更：验收 1、2 本身带「不可达 / 录不到」的替代分支，验收 3 在任何观测结果下都由推导给出一个取值。下表第 1–3 行对应它们，其余是本计划自己的门。

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | #280 验收 1：记录列出观测到的操作、确切命令、宿主版本与墙钟时间，或写明接口从插件不可达 | 记录 §2 三处版本来源与 §3 每行的命令与 UTC 时间；`node --test tests/contract/harness-session-api-record.test.js` 的「真实记录」用例通过；`插件可达` 行由推导给出 |
| 2 | #280 验收 2：一次启动与一次状态读取的脱敏夹具，或说明为何录不到 | `tests/contract/fixtures/harness-session/session-api.json` 含 O1.1 `create`、O1.2 `prompt` 与 O2.x 的 `list` / `inspect`；或结论为 `move-after-demo` 且记录有 `### 6.1 为何录不到`；「真实夹具」用例通过 |
| 3 | #280 验收 3：写明对 #140 的后果 | 记录 §6 三行等于 `deriveConsequence` 的推导；合成用例证明翻转任一决定性行会改变结论 |
| 4 | 预注册块在 T0 之后未改 | 在工作树根目录运行 `diff <(git show <预注册 SHA>:docs/exec-plan/active/2026-10-15-harness-session-api-probe.md \| sed -n '/^<!-- session-rule:begin -->$/,/^<!-- session-rule:end -->$/p') <(sed -n '/^<!-- session-rule:begin -->$/,/^<!-- session-rule:end -->$/p' docs/exec-plan/*/2026-10-15-harness-session-api-probe.md)`，期望无输出（行首锚点不可省：本行自己含两个标记）；预注册提交的 `%aI` 与 PR `createdAt` 早于记录 §2 的 T0 |
| 5 | 观测由真实宿主完成，未被本地测试替代 | 记录 §3 的 S3 行都能在过滤后的 `obs/probe-*.jsonl` 找到对应 `oid` 行与时间；Batch 2 的自检只标 S2、不进记录观测表 |
| 6 | 发布面与卫生 | canary 扫描无输出；`node scripts/rule-checks.mjs disclosure origin/main` 通过；契约测试卫生用例通过；人工五类目检查记入 PR 正文 |
| 7 | 宿主隔离 | 记录 §5 的 H 行：sink 计数 0、`keySha8` 一致、无新非回环连接、真实数据根无归因于探针的新条目、Documents 无新条目 |
| 8 | 变异表 | `node scripts/review-mutate.mjs .superpowers/review/D/mutants.json --root .` 在最终树上退出码 0，17 个 KILLED；spec 全文与读数在 `Artifacts and Notes` |
| 9 | 仓库门禁与规模 | `pnpm run test:contract`、`pnpm run boundaries`、`node scripts/workflow-check.mjs`、`git diff --check origin/main...HEAD` 通过；`node scripts/rule-checks.mjs size origin/main` 代码 ≤ 800、文档 ≤ 1300 |
| 10 | 关联与字段 | `gh pr view <n> -R SingularityKChen/harness-projects --json closingIssuesReferences,labels,milestone,isDraft`：关闭引用含 280，标签 `kind:test`、`area:apps`、`area:architecture`，里程碑 M4；`gh issue view 280 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences` 含本 PR |
| 11 | 跨 PR 并集 | ready 前与每次合并前，`.worktrees/round6-union` 上 main 加 B（含 A）、C、D 的 `pnpm install --frozen-lockfile --offline && pnpm verify && pnpm run boundaries` 通过，其中含 `tests/contract/harness-session-api-record.test.js`（D17） |

## Progress

- [x] 2026-10-15 09:58 +08 设计完成：两份独立设计（d1 静态机制、d2 安全观测）经总审阅合并为本计划；在本机静态复核了事实 1–14（Desktop 与 npx 运行时五个包同码、`sessionController` 服务键与方法行号、取消与 prompt 语义、凭据与端点优先级、标题 LLM 的附带请求、遥测门控）；规模估算代码约 240、文档约 820，不需要栈。
- [x] 2026-10-15 10:40 +08 跨 PR 集成评审修订（D13–D19）：§7 Host 接缝改为条件措辞的 `execution.harness` 目录条目与嵌套 `ctx.inject`；仓库侧事实标 base `21cb29eb`；窗口 S-D 前置移到块外；补会话推送远端一行、`docs/README.md` 索引用例与 M17、并集验证与合并前步骤、最终树重跑变异；规模改为代码约 350–390、文档约 900–950。`session-rule` 块未改。
- [ ] Batch 0：预注册提交与 draft PR；回填预注册 SHA、`%aI` 与 PR `createdAt`。
- [ ] Batch 1：契约测试（合成全绿、真实文件用例红）与记录骨架。
- [ ] Batch 2：仓库外探针、stub、守卫、生成器与自检。
- [ ] Batch 3：真实宿主 S3 观测（协调者）。窗口 S-D 开始：（待填 +08 时刻）；结束（第 9 步完成）：（待填）。
- [ ] Batch 4：记录定稿、夹具生成、契约测试转绿。
- [ ] Batch 5：变异表整表 KILLED，spec 附入本计划。
- [ ] Batch 6：独立验收、重构、索引与债务回填、归档、整合提交、PR ready 并请求人类评审。

## Surprises & Discoveries

- 2026-10-15：`PATH` 上已有 `dsh`（Desktop 应用 2026-10-01 安装的符号链接），与 spike M1「`dsh` 不在 `PATH` 上」不同；它跑的是普通 `@deepseek-ai/dsh` 的 `runCli`，安装用 Desktop 自带 pnpm，因此 spike M13 的 PATH 垫片在这条路线上不需要。证据：`ls -l "$(command -v dsh)"`；Desktop 包内 `dsh-desktop-host/lib/cli.js` 第 3 行 `import { runCli } from "@deepseek-ai/dsh/lib/bin.js"`。
- 2026-10-15：首个 prompt 可能触发 `session-title-llm` 的一次附带模型请求（`dsh-base/cordis.patch.yml` 的 `session-title-llm` 行），所以 R3 不能断言 stub「恰好 1 次请求」；守卫改为每个请求的 `keySha8` 一致。
- 2026-10-15：凭据存储的 `.env` 回退读的是**宿主进程的调用者 cwd**（`dsh-credentials-local/lib/index.js` 头注释 `<invocation cwd>/.env`），不是会话 cwd；所以守卫脚本必须 `cd "$SCRATCH"` 再启动宿主。
- 2026-10-15（非决定性，给 A 的 Desktop 窗口 Phase 1；窗口 S-D 内回填读数）：Desktop 自带 CLI 的 `plugin add` 走自带 pnpm（静态读到 11.7.0），同名同版本 tarball 重装可能被跳过、须先 `remove` 再 `add`（spike M14 只在 npx 路线见过，第 8b 步在 Desktop 路线复核）；`dsh web` 的 `dsh web: ` 就绪行与插件宿主半边的输出各走 stdout 还是 stderr，由第 5、6、8 步分流落文件、第 10 步的 `streams.txt` 只记计数。读数：（待填）。

## Decision Log

以下决策均为：协调者按人类授权调研后决定，人类可推翻。

- D1（2026-10-15 09:58 +08）记录放新文件 `docs/architecture/harness-session-api.md`，不在 spike 文档追加。Rationale：spike §1–§10 被 sha256 锁定、§11 只能有一个；问题与结论不同。
- D2（2026-10-15 09:58 +08）调用面是宿主半边注入的 `ctx.sessionController`。Rationale：执行 provider 在宿主进程里（ADR-0013、不变量 7）；官方插件文档的 `inject` 用法；会话控制器带恢复策略与子 agent 栅栏，`ctx.agents` 会绕开它们；浏览器侧、SDK、headless、ACP 见 Design / Spec §7。
- D3（2026-10-15 09:58 +08）宿主用 Desktop 安装的 `dsh` CLI 在 `web` profile 与一次性 `DSH_HOME` 下启动，npx 运行时只作回退并记台账。Rationale：它就是 demo 所用发行版的二进制，自带 pnpm，免去 PATH 垫片这条捷径；相关包与 npx 运行时逐字节相同；`web` profile 避开 `desktop` profile 的产品埋点。
- D4（2026-10-15 09:58 +08）观测分 R1 / R2 / R3，R3 用本次生成的假密钥与回环 stub，R4 不做。Rationale：只有持有中的流才能确定性地观测「运行中取消」，d1 的「prompt 后立刻 cancel」取决于竞态（无活动时取消是 no-op）；假密钥不是任何账号的凭据，只在 scratch 进程环境里；端点覆盖由事实 9 支持，并有 `baseURL` 核对与连接守卫；R3 失败只会让结论按规则降到 `narrow`，不会误报。R4 消耗额度且要改真实环境，转 TD-066 与人类门。
- D5（2026-10-15 09:58 +08）结论由预注册规则机械推出，结论块固定三行（结论、插件可达、缺项）。Rationale：#225 D17 / D21 显示观测后改规则必须显式披露；「插件可达」一行直接回答验收 1 的「或写明不可达」分支，「缺项」把 `narrow` 的含义写成可判定事实。
- D6（2026-10-15 09:58 +08）实现集只放 O3.1 与 O3.2，`requestId` 幂等（O4.1）与重启行为（O4.4）为非决定项。Rationale：两者决定 #140 能否声明取消、夹具能否给出成功运行；幂等与重启是 #140 的设计输入，不改变 port 的形状，core 已能处理 `ambiguous_result`。
- D7（2026-10-15 09:58 +08）测试只校验「决定性行不早于 T0」，不设上限窗口；时限是 §2.5 的过程规则。Rationale：#225 的硬窗口在会话中断后迫使人类观测后改判（D17）；时限防的是反复重试，已由「取最后一次尝试 + 保留尝试记录」覆盖。
- D8（2026-10-15 09:58 +08）夹具形状 `{ provenance, exchanges, events }`，保留会话 id 原值，投影在探针写日志前完成；本 PR 不写回放 helper。Rationale：仓库夹具保留 provider 原始 id；VCR.py 与 Polly.js 都在落盘前脱敏；`github-projects/replay.js` 与其消费者同 PR 落地，本 PR 没有消费者，#140 按自己的 port 写回放。
- D9（2026-10-15 09:58 +08）状态映射取「生命周期 × 结果」两轴，`aborted` → `canceled`，未知 kind → `unknown`，映射只是给 #140 的提案。Rationale：ACP 把取消定义为结束原因而非错误；GitHub Actions 把 `status` 与 `conclusion` 分开；`TurnEndReasonMap` 可合并扩展。
- D10（2026-10-15 09:58 +08）探针 peer 只写 `@deepseek-ai/dsh-api-session-controller: ~0.2.0-rc.2`。Rationale：与产品安装件的 `HOST_DSH_PEER_RANGE` 一致；没有 `dsh-*` peer 时闸门直接放行，O0.1 就证明不了版本匹配。
- D11（2026-10-15 09:58 +08）状态读取用 `inspect` + `list` + `api-session/status`，不用 `follow` / `page`。Rationale：宿主侧读取不需要流载体；`inspect` 不激活 Agent 且能在重启后冷读，正好对应 ADR-0008 重启后按 `providerRef` 路由的 `getRun`。
- D12（2026-10-15 09:58 +08）不对 #140 发评论，PR 正文 `Refs #140`；是否发评论、是否改 #140 范围与 blocked-by 由人类决定。Rationale：公开写入需人类批准；记录合并后即是事实源。
- D13（2026-10-15 10:40 +08，跨 PR 集成评审）记录 §7 的 Host 接缝写成「将来的 `execution.harness` 目录条目经 `create(input)` 收到窄会话 port，port 来自嵌套 `ctx.inject(['sessionController'], cb)`」，取舍写成对 ADR-0014 的 Proposed 修订，措辞按 D 合并时 main 是否含 #132 二选一。Rationale：PR A 删除 `HostProviderFactory` 及其输入、以 ADR-0014 部分取代 ADR-0013 第 5 条（A 计划 Design / Spec 与 Batch 1），旧措辞在 A 合并后即失效；A 的 `CatalogEntry.create(input: ProviderBuildInput)` 是唯一构造入口；`execution-harness` 包只依赖 domain 与 capabilities（事实 13），会话控制器只能由 Host 传入；Cordis 没有可选注入（事实 15），顶层加入会让插件在缺该服务的宿主上整体不加载；栈底只写自己的事实，D 可能先于 A 合并。是否给 `ProviderBuildInput` 加会话 port 由 #140 决定，本 PR 不替它定。
- D14（2026-10-15 10:40 +08）事实 13、14 与记录 §4 的仓库侧事实标「观察于 base `21cb29eb`」与复核 UTC 时刻（2026-10-15T02:30:34Z）。Rationale：`host.ts:9` 的 inject 与 `HostProviderFactory` 会被 A 改掉；记录是历史观测，不带 base 会在 A 合并后读成当前事实。
- D15（2026-10-15 10:40 +08）Batch 3 的前置（窗口 S-D）放在 `session-rule` 块外、Batch 0 推送前定稿；S-D 先于 S-AB 并走完第 9 步才结束，窗口内不向真实 profile 装插件、不写 `~/.dsh`，起止时刻记进 `Progress`；宿主流原文不交出，只交过滤后的探针行与计数。Rationale：块在 T0 冻结，排期类内容不应占用规则修改的披露通道；第 9 步守卫数 `~/.dsh` 新条目与用户级 pnpm 内容寻址库新文件，A / B 的 Desktop 安装用自带 pnpm 并创建 `~/.dsh/harness-projects`（A 计划 Interfaces and Dependencies），重叠会误触发；宿主窗口约定 agent 不读、不打印带令牌的 URL。
- D16（2026-10-15 10:40 +08）采用协调者定稿的共享文件协议：D 独有三个新文件与 `docs/architecture/README.md` 的一行；`docs/README.md` 行插在 Active 表分隔行正下方，冲突时后合并者保留全部行、2026-10-15 的行按文件名排序；TD-065 / TD-066 放在数字位置、手工加。Rationale：四个 PR 的文本冲突只可能落在这两份索引上，固定插入点与排序让冲突解决机械化；tracker 脚本会抹掉既有条目。
- D17（2026-10-15 10:40 +08）ready 前与每次合并前跑并集验证，并给记录测试加 `docs/README.md` 链接检查与变异 M17。评审意见的前提「该测试读两份 README」在设计时只对一半：测试读 `docs/architecture/README.md`、在 `active/` 或 `completed/` 定位计划，不读 `docs/README.md`。采纳意见并补上这一检查（约 5 行测试、1 行变异），而不是只订正前提。Rationale：`docs/README.md` 是四个 PR 最容易冲突的文件，补检查后，并集上 `pnpm verify`（经 `tests/contract` 已含本测试）能发现冲突解决时丢掉的 D 行或归档后仍指向 `active/` 的链接。
- D18（2026-10-15 10:40 +08）D 不入栈、从 main 分出，与 A / B / C 互不依赖，自身门禁通过即可合并；推荐顺序 C → D → A → B，D 在 S-D 与 Batch 6 之后，可与 A / B 任意交错。合并前：rebase 到当前 main、按协议解决索引冲突、按当时 main 复核 §7 措辞、在 main 加仍未合并的 head 上重跑并集 `pnpm verify`、回读 `closingIssuesReferences`；合并后回读 #280 状态。Rationale：D 不写 `apps/**`、`packages/**`，与 A / B 无代码依赖；严格分支保护下每次合并都让其余 PR 变 BEHIND；各自全绿不等于并集全绿；合并由人类决定。
- D19（2026-10-15 10:40 +08，本计划自查，不来自评审意见）Batch 6 归档与重构后在最终树上重取锚点、整表重跑变异 spec。Rationale：Batch 6 会移动本计划（M15 的文件路径变化）、改 `docs/README.md` 链接（M17）并重构测试，只在 Batch 5 跑的读数不是最终树的读数。

### 调研依据

- Agent Client Protocol，Prompt Turn（stop reason 与取消）：<https://agentclientprotocol.com/protocol/prompt-turn>
- GitHub REST，Workflow runs（`status` 与 `conclusion` 分离）：<https://docs.github.com/en/rest/actions/workflow-runs>
- Anthropic，Streaming Messages（SSE 事件顺序，stub 的格式依据）：<https://platform.claude.com/docs/en/build-with-claude/streaming>
- VCR.py，Advanced Features（录制前过滤）：<https://vcrpy.readthedocs.io/en/latest/advanced.html>
- Polly.js，Events & Middleware（`beforePersist`：落盘前改写录制）：<https://github.com/Netflix/pollyjs/blob/master/docs/server/events-and-middleware.md>
- Pact，How Pact works（交互与 provider state）：<https://docs.pact.io/getting_started/how_pact_works>
- DeepSeek Harness 官方插件文档（`inject` 与 `ctx` 服务）：<https://deepseek-harness.github.io/deepseek-harness/develop/basic/>
- 宿主一手资料：`dsh-api-session-controller`、`dsh-credentials-local`、`dsh-llm-deepseek` 的 README 与 `lib/` 源码（发行版 `0.2.0-rc.2`，行号见 `Context and Orientation`）。

## Idempotence and Recovery

- Batch 1、2、4、5 只改工作树文件，可重复执行；变异工具从内存原文还原并逐字节比对，被中断时退出码 130，先 `git diff` 确认。
- Batch 3 每次都新建 `$SCRATCH`，可整体重跑；同一路径下同名同版本的 tarball 重装会被 pnpm 跳过（spike M14），改探针后先 `plugin --profile web remove hp-session-probe` 再 `add`。重跑的观测按「取最后一次尝试」更新，旧尝试保留在记录的尝试记录里。
- 会话中断：观测日志在 `$SCRATCH/obs/` 与 `.superpowers/session-probe/obs/` 各一份，读数在 `.superpowers/session-probe/evidence.md`；Batch 1、4 的仓库文件在中断前做本地 WIP 提交（Batch 6 整合）；恢复时先读 `Progress` 与 `evidence.md`。
- 已知良好状态：`origin/main`（`21cb29eb`，观察时刻 2026-10-15）加预注册提交。整合前建 `backup/` 分支，推送用精确 lease。
- 本 PR 不写数据库、不迁移，回滚 PR 只删除新增文件与索引行。

## Artifacts and Notes

- 变异 spec 全文：Batch 5 完成后附在这里（缩进代码块），使变异表可重放。
- 观测日志与探针源码只在 `$SCRATCH` 与 git 忽略的 `.superpowers/session-probe/`，不入库；记录 §2 的步骤表与本计划 `Concrete Steps` 足以重建探针。
- 设计稿：`.superpowers/design/D/d1-static-mechanism.md`、`.superpowers/design/D/d2-safe-observation.md`（运行态，不入库）。

## Interfaces and Dependencies

- 宿主：DeepSeek Harness Desktop `0.2.0-rc.2` 与其 `dsh` CLI；只读静态取证用 `$HOST_RUNTIME`。不需要任何真实凭据；R3 的假密钥由本次生成。
- 宿主服务：`ctx.sessionController`（`create`、`prompt`、`cancel`、`list`、`inspect`）、`ctx.credentials.describe`、事件 `api-session/status`。
- 仓库：`@harness-projects/domain` 的 `ExecutionRunStatus`（测试导入）；`scripts/review-mutate.mjs`；`scripts/rule-checks.mjs`；`scripts/workflow-check.mjs`；`tests/contract/package-boundaries.test.js`（`pnpm run boundaries`）。
- 工具：Node 26、pnpm 10.28.2、npm（打包探针与查询 dist-tags，只读元数据）、`gh`（`-R SingularityKChen/harness-projects`）、`lsof`、`shasum`、`PlistBuddy`。
- 跨 PR 接缝：#132（PR A）拥有 Host 入口、`host-providers.ts` 目录与 ADR-0014；#140 需要会话 port 时经将来的 `execution.harness` 目录条目与嵌套 `ctx.inject(['sessionController'], cb)` 接线，取舍写成对 ADR-0014 的 Proposed 修订（D13）。#276 的 watch 与本 PR 无写入交集；#231 只在「会话推送远端」一行被引用；共享索引按 D16 的协议。
- 下游：#140 消费记录 §7 与夹具；#143 demo 门禁前偿还 TD-066。

## Outcomes & Retrospective

尚未执行。完成后写：实际结论与缺项、与计划的偏差、R3 是否成功、守卫是否触发、遗留的技术债务与转交事项。

### 技术债务候选（Batch 6 手工追加到 `docs/exec-plan/tech-debt-tracker.md` 的 Open Items）

- **TD-065**（子系统：Harness 宿主会话接口；分支 `test/harness-session-api-probe`）：会话接口只在宿主 `0.2.0-rc.2` 上观测；`sessionController` 是 rc 宿主的服务键，不是承诺稳定的插件 API，`alpha` 线已到 `0.2.1-alpha.3`。延期理由：本 PR 只回答当前发行版。遗留影响：宿主升级可能改变方法签名、错误码或事件形状，夹具随之失真。下一步：`latest` 越过 `0.2.0-rc.2` 或 #227 改 peer 范围时，按记录 §9 重跑 `CORE` 与 `IMPLEMENT` 并重录夹具；#140 的 peer 精确钉住观测过的版本。
- **TD-066**（同上）：真实模型的成功路径与 `desktop` profile 都未观测；R3 的 `completed` 与 `aborted` 来自回环 stub。延期理由：R4 消耗额度、要改真实环境，需要人类批准。遗留影响：真实 provider 下的错误码、重试与标题请求行为可能不同；demo 门禁不能只靠本夹具。下一步：#143 demo 门禁演练前经人类批准做 R4，并在 `desktop` profile 重跑 O1.x–O3.x。

## Bottom Change Note

- Change Note (2026-10-15 09:58 +08)：创建本计划。合并 d1 与 d2 两份设计，补齐事实复核、预注册块、记录与夹具格式契约、协调者独占的 S3 步骤、变异表与验收批次。
- Change Note (2026-10-15 10:40 +08)：按跨 PR 集成评审修订（D13–D19）。§7 Host 接缝改为条件措辞的 `execution.harness` 目录条目与嵌套 `ctx.inject`，不再提 `HostProviderFactory` 与 ADR-0013 注入清单；新增事实 15（Cordis 无可选注入）；仓库侧事实标 base `21cb29eb`；窗口 S-D 前置移到块外，宿主流分 stdout / stderr、只交过滤后的探针行；新增第 8b 步重装行为与给 A 的非决定性 Surprises；补会话推送远端一行；记录测试加 `docs/README.md` 链接检查与 M17；Batch 6 加并集验证、合并前步骤与最终树重跑变异；规模估算改为代码约 350–390、文档约 900–950。`session-rule` 块逐字未改。
