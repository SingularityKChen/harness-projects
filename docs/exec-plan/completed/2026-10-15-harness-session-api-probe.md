# Harness Session API Probe ExecPlan

> 状态：Completed（2026-10-15 14:42 +08 独立验收通过并归档；15:53 +08 协调者完成整合、推送、并集验证与 ready；PR 评审 APPROVE 后的修复轮见 D45，整合 fixup 与合并由评审会话与人类伙伴继续）
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
- [ ] 整合提交（先建 `backup/pr<n>-before-final-integration-<日期>`）：①预注册提交保持原内容；②`test(architecture): 记录宿主会话接口观测、夹具与一致性契约`（记录、夹具、测试）；③`docs(exec-plan): 归档会话接口观测计划并回填索引与债务`。正文写原因与 `Refs #280`，结尾带 Co-Authored-By 行。整合后用 `comm` 比对新旧 head 的文件集合，`grep '^#'` 检查提交正文没有被编辑器吃掉的行。预注册提交 `8909c5ed` 的正文有一行以 `#140` 开头（D38）：任何走编辑器的 rebase / reword 重放都会把它当注释静默删掉，所以整合不用交互式 rebase，而是 `git reset --soft 8909c5ed` 后只重提交其后的内容，每个提交用 `git commit -F <消息文件>`（或 `-c core.commentChar=';'`）；整合后运行 `git log --format=%B origin/main..HEAD | grep -c '^#'`，数目必须等于整合前的数目（预注册正文那一行），并核对 `git log -1 --format=%B 8909c5ed` 逐字未变、`git rev-parse 8909c5ed` 仍是原 SHA。
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
- [x] 2026-10-15 10:47 +08 Batch 0：预注册提交 `8909c5ed84f1437d1edbd2978ff64457aede3a37`（`%aI` 2026-10-15T10:46:26+08:00）已推送；draft PR #343 `createdAt` 2026-10-15T02:47:37Z（10:47:37 +08），早于 T0；`closingIssuesReferences` 回读含 #280。
- [x] 2026-10-15 11:06 +08 Batch 1：契约测试（合成 18 条全绿，三条真实文件用例红，原因分别是观测表缺 O0.1、`docs/architecture/README.md` 未登记、观测表缺 O0.1）与记录骨架（§1、§4 的 M1–M16、§7、§8、§9 已写，§2、§3、§5、§6 只放表头与说明）。M 行由实施者逐条复核（`date -u` 为 2026-10-15T03:01:23Z，脚本把每条断言写成 grep 并全部通过）；全量 `node --test tests/contract` 956 条里只有这三条红，`harness-host-reprobe-record.test.js` 25 条全过；另在临时填满的记录、夹具与两处索引上空跑一次，三条真实用例转绿，随后按字节还原（sha256 与骨架一致）。
- [x] 2026-10-15 11:17 +08 Batch 2：仓库外探针、stub、守卫、生成器与自检全部就绪（`.superpowers/session-probe/{probe,tools}/`，git 忽略，不提交）。先写自检并看它因 `stub.mjs` 缺失而红，再实现；`node .superpowers/session-probe/tools/selfcheck.mjs` 退出码 0（S2，只防探针缺陷，不进记录观测表）；每个 `.mjs` / `.js` 过 `node --check`，`dsh_s.sh` 过 `bash -n`，`npm pack --dry-run` 只打 `package.json`、`cordis.patch.yml`、`lib/index.js` 三个文件；`git status --short` 无 `.superpowers/` 条目。自检的变异抽查：探针 4 处（白名单事件、scratch 替换、只留自己的会话行、凭据守卫）与工具 7 处（stub 控制面不记账、`keySha8` 位数、`dsh_s.sh` 的覆盖护栏与 `env -i`、生成器的卫生闸与 `--exclude`、asar 基址）各自变异后自检都变红，原文逐字节还原。规模（`node scripts/rule-checks.mjs size origin/main`）：代码 424（测试，夹具与探针工具未计入），文档 669（计划 521 + 记录 148）；都低于 800 / 1300 的计划上限，也远低于 760 的预警线。
- [x] 2026-10-15 13:39 +08 Batch 3：真实宿主 S3 观测（协调者）。窗口 S-D 开始 13:37:25 +08（marker / T0 = 2026-10-15T05:37:25Z），结束 13:39:20 +08（第 9 步完成）。三处版本一致为 `0.2.0-rc.2`；安装 exit=0；core 18 行、restart 5 行、stub 16 行探针输出全部在 stdout，`done` 都出现；sink.log 0 行；stub.log 4 行全部 `POST /v1/messages` 且 keySha8 等于 fake.sha8；三个 net 记录都没有非回环连接；收尾：`~/.dsh` 新条目 0、Documents 新条目 0、监听端口不变、用户级 pnpm v11 库新文件 7（全部归因于探针 tarball）。逐步读数在 git 忽略的 `.superpowers/session-probe/evidence.md`，过滤后的探针行在 `.superpowers/session-probe/obs/`（Batch 4 的输入）。人类伙伴已于 2026-10-15 10:56 +08 前批准 R3（「同意 R3 (Recommended)」）。
- [x] 2026-10-15 13:55 +08 Batch 4：记录定稿、夹具生成、契约测试转绿（实施者）。`docs/architecture/harness-session-api.md` 的 §2、§3、§5、§6 按窗口 S-D 的过滤探针行填写：十二个预注册 O-ID 都是「已观测到 / S3」，时间取探针 `at` 截到整秒（O0.1 取 `install.log` 的 `date -u`），§5 只列四条实际采用的捷径（全部判定「否」）与 H1–H10；§6 用测试自身的 `deriveConsequence` 算出 `implement`、插件可达「是」、缺项「无」，再写入。夹具由 `make-fixture.mjs` 生成（24 个 exchange、6 个状态事件，不手改，未用 `--exclude`）；`docs/architecture/README.md` 与 `docs/README.md`（Active 表分隔行正下方）各加一行。§7 措辞：`git ls-tree origin/main apps/harness-plugin/src/host-providers.ts` 在 base `21cb29eb` 上无输出，沿用「open PR」条件措辞并点名 PR #344（#132）与 PR #342（#231）。验证：`node --test tests/contract/harness-session-api-record.test.js` 21 条全过；`pnpm run test:contract` 956 条全过；`pnpm verify` 退出码 0（1599 条单元加 MVP-0 7 条）；`pnpm run boundaries` 9 条全过；`node scripts/workflow-check.mjs` 无发现；`git diff --check` 无输出。`session-rule` 块与预注册提交逐字节相同（`Validation and Acceptance` 第 4 行的 `diff` 无输出）。记录、夹具与两处索引已提交为 `aef19d25`，之后 `node scripts/rule-checks.mjs disclosure origin/main` 通过，`size` 为代码 459、文档 810（均含尚未回填本条的计划）；canary 扫描对已提交范围、暂存区和逐个改动文件都是 0 命中；人工五类目检查未发现凭据、本机路径与身份、账号与个人信息、内部系统或保密字样。另做了一次 17 条变异的预演（`scripts/review-mutate.mjs`，临时 spec 在会话 scratchpad、不是 Batch 5 的 `mutants.json`），M1 到 M17 全部 KILLED，被测文件逐字节还原；正式整表仍由 Batch 5、6 在最终树上跑。
- [x] 2026-10-15 14:16 +08 Batch 5：对抗验证（独立验证者，Sonnet，非 Batch 1/4 的实施者），审计对象 head `1ed80a95`（工作树干净，领先远端 5 个提交，未推送）。变异：`node scripts/review-mutate.mjs .superpowers/review/D/mutants.json --root .` 退出码 0，M1–M17 共 17 个全部 KILLED（`killedBy` 归因全对，无 `NOT_APPLIED`、`KILLED_OTHER`、`SURVIVED`），被测五个文件前后 sha256 逐字节相同，spec 全文见 `Artifacts and Notes`。另做 29 条扩展变异（E01–E29，spec 在会话 scratchpad，不入库）：19 条 KILLED、10 条存活：E10（`findPlan` 恰好一份）、E12（`isoMs` 的日期回绕：`Date.parse('2026-02-31T00:00:00Z')` 回绕成 3 月 3 日，只有 `startsWith` 一行挡住）、E13 与 E14（`reason.reason`、`reason.error` 的嵌套键白名单）、E15（失败 `error` 的键白名单）、E16（状态事件的 `event` 取值）、E19（`outcome.ok` 的布尔类型）、E29（O1.1 的 `session-` 前缀与 O1.2 的 `accepted: true` 只断言了「成功」、没有断言值）、E27（§7 映射表语义行对调不会被发现）、E23（预注册 SHA 离线不可校验，按设计不可杀）。补用例提案已在 scratch 副本里验证：对应的 10 条变异全部变红、真实树 21/21 通过，补丁存在 `.superpowers/review/D/hardening-proposal.patch`（git 忽略，净增约 16 行测试），采纳与否由 Batch 6 决定，采纳后须整表重跑。独立复核：夹具 24 个 exchange 与 6 个状态事件由验证者自写脚本从过滤探针行重新推出，与已提交夹具逐行相等；§3 十二行的结果、强度与时间逐条对上探针 `at`（取同一 O-ID 的最后一行）与 `install.log`；过滤探针行与探针在 scratch 里的本地副本逐字节相同；`stub.log` 4 行 `keySha8` 全等于事先写下的摘要，监听端口前后的（命令，地址）集合相同，`net-stub` 的六条 `ESTABLISHED` 都以 stub 端口为端点；#140 结论按冻结块手算为 `implement`、插件可达「是」、缺项「无」，与记录一致，`deriveConsequence` 与计划片段逐字相同；`session-rule` 块在五个本地提交里相对预注册提交都是 0 行差异，预注册 SHA 与 `%aI` 对得上，draft PR #343 的 `createdAt` 早于 T0；#280 三条验收都满足；M2 的五个包哈希在 Desktop 包（asar 读取器）与 npx 运行时两侧都复算一致。门禁读数：契约测试 21/21，`pnpm run test:contract` 956/956，`pnpm verify` 退出码 0（1599 + 7），`pnpm run boundaries` 9/9，`workflow-check` 无发现，`disclosure` 通过，`size` 代码 459、文档 820（本条回填前），`lint_execplan.py` 输出 OK，canary 对提交范围、工作树、暂存区、逐个改动文件、提交正文与 ref 名都是 0 命中。发现（记录与夹具没有改，逐条证据与修法在验证报告里交 Batch 6）：F1（P2）记录 §2.4 与本计划 `Surprises & Discoveries` 写「stderr 三次运行都是 0 行」不对，三份 `.err` 各 2 行（Node 的 `DEP0180` 弃用警告），只是没有探针行与 `dsh web: ` 行；F2 §3 判据列是冻结判据的改写而非逐字（O3.2 少了「`api-session/status` 为 `true`」，O2.2 少了「同一窗口内」）；F3 H5 采样太稀（秒级，core 的 prompt 窗口内没有采样点，stub 没有每个 prompt 步骤前后各一次）；F4 §9 的 peer 警告成因能静态回答（profile 的 `autoInstallPeers: false` 且没装宿主包，是普通缺 peer 警告，不带版本信号）；F5「不是承诺稳定的插件 API」是推断，README 只是没写；F6 §7.3 的「重启后 `not-found`」缺「该会话重启前已结束」的限定，§7.1 缺「有 `turn/start`、无 `turn/end`、`running: false`」一行；F7 §7.5 的重复键举例漏了 `list({})`；F8 H4 可补 stub 请求字节数两两成对；F9 上述存活变异；F10 预注册提交正文首行以 `#140` 开头，整合时不得经编辑器重放。R4（真实模型）与 `desktop` profile 在记录里都保持「未观测到」（§1、§5、§6 适用范围、§9），重启语义按观测写成「会话已结束后的重启」，运行中途重启在 §9。
- [x] 2026-10-15 14:32 +08 Batch 5 发现处理（修复轮，Sonnet；起点 head `4aa34113`，工作树干净、领先远端 6 个提交、未推送；决定见 D29–D39）：F1–F10 与 info 逐条复现后处理，全部属实，无拒绝项，只有 F9 里的 E23 按设计不修（D37）。**测试先行**：先写 F2 的判据比对用例并看到真实记录用例红（`O0.1 的判据与预注册块不一致`），再把记录 §3 的 12 个判据格改成预注册块原文；F9 先用 `review-mutate.mjs` 在补丁前的树上复现十个存活变异（E10、E12–E16、E19、E23、E27、E29 全部 SURVIVED），再应用 `hardening-proposal.patch`（一次干净应用，21/21 仍绿）并补 `findPlan(exists)` 注入与「计划定位」用例。记录改动：§2.1 守卫表、§2.4 stderr（F1）、§3 前置与判据列（F2）、§3.1 O0.1 与 O3.2（F4、F8）、§5.1 H4 与 H5（F3、F8）、§6 三行间加空 `>` 行、§7.1 加 `unknown` 一行、§7.3 两处限定（F6）、§7.5 重复键（F7）、§9 三行（F4、F5、F8）；本计划改 Surprises（stderr、peer 警告、stub 字节数）、Batch 6 整合步骤（F10）、TD-065 候选文本（F5）、Decision Log D29–D39、`Artifacts and Notes`（M9 锚点与补充变异表）；`session-rule` 块逐字未动。读数：契约测试 24/24（21 + 判据比对 2 + 计划定位 1）；`pnpm run test:contract` 959/959；`pnpm verify` 退出码 0（1602 + 7）；`pnpm run boundaries` 9/9；`workflow-check` 无发现；`git diff --check` 无输出；`grep -nE 'HostProviderFactory|ADR-0013 的注入'` 无输出；主变异表 M1–M17 共 17 个 KILLED、退出码 0（M9 的锚点按新的 O1.1 整行重取）；补充变异表 H10、H12–H16、H19、H27a–c、H29a–b、H31a–d 共 16 个 KILLED、退出码 0；两张表运行前后五个被测文件的 sha256 逐字节相同；canary 对 `origin/main` 的范围、工作树新增行都是 0 命中。刻意没有做：不重跑宿主、不补 H5 的采样（窗口已关）、不碰 `~/.dsh`、不推送。
- [x] 2026-10-15 14:42 +08 Batch 6 验收部分（独立验收者 Opus，未参与 Batch 1–5 与修复轮；起点 head `ef30d82a`，工作树干净，领先远端 8 个提交，未推送）。**独立复推**：自写脚本从 `.superpowers/session-probe/obs/` 的过滤探针行重建夹具，24 个 exchange 与 6 个状态事件与已提交夹具逐项相等，`recordedAt` 等于末行 `at` 截到整秒。十二个 O-ID 的判据逐条对上探针行，O0.1 对上 `install.log` 的 `exit=0` 与时间，日志里 `allow-version`、`accept-risk` 0 处。按冻结块手算得 `implement`、插件可达「是」、缺项「无」，与 §6 一致。`session-rule` 块相对 `8909c5ed` 0 行差异；`%aI` 10:46:26 +08 与 PR #343 的 `createdAt` 02:47:37Z 都早于 T0。`net-stub` 六条 `ESTABLISHED` 两端都是回环。静态抽查 M2（五个包哈希前缀）、M5、M6、M8、M10、M11、M17，在 `$HOST_RUNTIME` 上复现。#280 三条验收逐条满足。**发现与处理**见 Surprises 的 Batch 6 条目与 D40–D44：§7.3 的端口义务改写为推论（D42）；补 5 条判别断言并抽出 `observedIds`（D41）；归档（D40）；TD-065、TD-066 追加在 TD-052 之后（D44）。**变异**：在最终树上跑（计划已在 `completed/`）。主表 M1–M17 共 17 个 KILLED，补充表 H 共 16 个 KILLED，Batch 6 表 N 共 6 个 KILLED；三次退出码都是 0，没有 `NOT_APPLIED`、`KILLED_OTHER`、`SURVIVED`；五个被测文件前后 sha256 相同。**门禁**：`node --test tests/contract/harness-session-api-record.test.js` 24/24（加固只加断言，没有新增用例）；`harness-host-reprobe-record.test.js` 25/25（spike 未动）；`pnpm run test:contract` 959/959；`pnpm verify` 退出码 0（1602 条单元加 MVP-0 7 条）；`pnpm run boundaries` 9/9；`node scripts/workflow-check.mjs` 无发现；`git diff --check` 无输出；对记录的 `HostProviderFactory` 与「ADR-0013 的注入」检索无输出；`lint_execplan.py` 输出 OK；`node scripts/rule-checks.mjs size origin/main` 为代码 518、文档 926（含本条），在 800 / 1300 之内；`disclosure` 通过；canary 对 `origin/main` 起的提交范围、暂存区与提交正文都是 0 命中；人工五类目检查（凭据、本机路径与身份、账号与个人信息、内部系统、保密字样）无命中。
- [x] 2026-10-15 15:53 +08 Batch 6 协调者部分（协调者）：按 D38 整合为三个提交，预注册提交 `8909c5ed` 原 SHA 未变，其后是 `24eca6b2` 与 `818ee4ad`（提交时刻 2026-10-15T07:29:01Z），推送后 PR head 为 `818ee4ad`。并集验证（D17）用最终 head（#342 `79aef826`、#344 `697b283c`、#345 `6fc33768`、本 PR `818ee4ad`），两种合并顺序得到逐字节相同的树：`pnpm verify` 1661 + 7、0 失败，`pnpm run boundaries` 9/9，`harness-session-api-record` 等关键用例通过（读数见 PR 正文）。PR 在 2026-10-15T07:53:17Z（15:53 +08）置 ready 并请求人类评审（GitHub `ReadyForReviewEvent`，2026-10-15 16:52 +08 回读）。评审在本地并集上复跑，同样是 1661 + 7、0 失败（`docs/review/pr-343-mmp-review.md`）。原定「合并前按当时 main 复核 §7.2、§7.4 的条件措辞」一步由 D45 取消：两处已改成与合并顺序无关的写法。
- [x] 2026-10-15 17:05 +08 评审修复轮（评审会话派出的实施者；起点 head `818ee4ad`，工作树干净）：按 D45 处置评审（review id 5530338559，APPROVE）的 3 条 P2 与 5 条 P3，以 `fixup!` 提交交评审会话整合，预注册提交不动、不作 fixup 目标；外部写入（#143、#140 评论与 PR 正文改写）只起草，不写 GitHub。读数（修复后的工作树）：
  - 测试：`node --test tests/contract/harness-session-api-record.test.js` 31/31（24 条加 7 条新用例）；`harness-host-reprobe-record.test.js` 25/25。
  - 门禁：`pnpm verify` 退出码 0（1609 条单元加 MVP-0 7 条）；`pnpm run boundaries` 9/9；`node scripts/workflow-check.mjs` 无发现；`git diff --check` 无输出；对记录检索 `HostProviderFactory` 与「ADR-0013 的注入」无输出；`lint_execplan.py` 输出 OK。
  - 变异：主表 M 17/17、补充表 H 16/16、Batch 6 表 N 6/6、修复轮自检表 X 38/38 全部 KILLED；评审表 R 19/22，存活的 R12、R19、R22 见 `Artifacts and Notes`。

## Surprises & Discoveries

- 2026-10-15：`PATH` 上已有 `dsh`（Desktop 应用 2026-10-01 安装的符号链接），与 spike M1「`dsh` 不在 `PATH` 上」不同；它跑的是普通 `@deepseek-ai/dsh` 的 `runCli`，安装用 Desktop 自带 pnpm，因此 spike M13 的 PATH 垫片在这条路线上不需要。证据：`ls -l "$(command -v dsh)"`；Desktop 包内 `dsh-desktop-host/lib/cli.js` 第 3 行 `import { runCli } from "@deepseek-ai/dsh/lib/bin.js"`。
- 2026-10-15：首个 prompt 可能触发 `session-title-llm` 的一次附带模型请求（`dsh-base/cordis.patch.yml` 的 `session-title-llm` 行），所以 R3 不能断言 stub「恰好 1 次请求」；守卫改为每个请求的 `keySha8` 一致。
- 2026-10-15：凭据存储的 `.env` 回退读的是**宿主进程的调用者 cwd**（`dsh-credentials-local/lib/index.js` 头注释 `<invocation cwd>/.env`），不是会话 cwd；所以守卫脚本必须 `cd "$SCRATCH"` 再启动宿主。
- 2026-10-15（Batch 1）宿主 `list` 返回 `{ items }` 而不是数组（`types.d.ts:266-268`），Design / Spec §4 没有写死夹具里 `list` 的 `value` 形状；按宿主形状取 `{ items }`，见 D20。
- 2026-10-15（Batch 1）事实 13 引用的 `development-provider.ts:56` 在 base `21cb29eb` 上是 `headBranch` 的文档注释行，声明在第 57 行；记录 §4 的 M14 写 `:56-57`。
- 2026-10-15（Batch 1）契约测试 424 行，高于设计估算的 350–390（测试 300–350），主要是每条 `killedBy` 对应的合成用例要把「变异后必须变红」的分支各写一遍；夹具与探针工具不入库，当前总代码行数仍远低于 760 的预警线。若 Batch 4–6 后逼近 760，先删合成用例里与 M1–M17 无关的重复断言（例如 `解析` 用例中的标题缺失 / 重复两条），不动 `deriveConsequence` 与锚点行。
- 2026-10-15（非决定性，给 A 的 Desktop 窗口 Phase 1；窗口 S-D 内回填读数）：Desktop 自带 CLI 的 `plugin add` 走自带 pnpm（静态读到 11.7.0），同名同版本 tarball 重装可能被跳过、须先 `remove` 再 `add`（spike M14 只在 npx 路线见过，第 8b 步在 Desktop 路线复核）；`dsh web` 的 `dsh web: ` 就绪行与插件宿主半边的输出各走 stdout 还是 stderr，由第 5、6、8 步分流落文件、第 10 步的 `streams.txt` 只记计数。读数见下一条。

- 2026-10-15（窗口 S-D 读数，给 A 的 Desktop 窗口 Phase 1）：(1) Desktop 自带 CLI 的 `plugin add` 用自带 pnpm v11.7.0，内容寻址库落在用户级 `Library/pnpm/store/v11`，每次装新 tarball 都会在那里新增文件（本窗口 7 个，均属探针）；(2) 同路径同名同版本重新 `add` 退出码 0 但实际被跳过，`remove` 后再 `add` 才生效（M14 在 Desktop CLI 路线同样成立）；(3) `dsh web` 的 `dsh web: ` 行与插件宿主半边的 `process.stdout.write` 都走 stdout；stderr 里没有探针行与 `dsh web: ` 行，三次运行各只有 2 行 Node 弃用警告（DEP0180）（2026-10-15 14:27 +08 经 Batch 5 的 F1 订正，原写「0 行」不对，见 D29）；(4) 一次性 `DSH_HOME` 下 `--no-open --port 0` 运行时，7 次秒级 `lsof` 采样只见回环连接（`core`、`restart` 0 行 `ESTABLISHED`，`stub` 6 行两端都是回环），模型请求全部落到 sink / stub（H3、H4）；`plugin add` 步骤与 `core` 的 prompt 窗口没有采样（H5）；真实 `~/.dsh` 与 Documents 无新条目（2026-10-15 评审 F6 订正，原写「运行全程没有非回环连接」，强于证据，见 D45）。

- 2026-10-15（Batch 4，S3 与 S1 的差异）O4.2 的 `inspect` 对未知会话得到的不是事实 4 写的 `SessionQueryError`，而是没有 `code` 的普通 `Error`（探针投影得 `code: 'Error'`、`remote: false`）；控制器把内层 `SessionQueryError` 改抛 `ApiSessionNotFound extends Error {}`（`$HOST_RUNTIME/dsh-api-session-controller/lib/index.js:85`、`:173`）。记录 §4 补了 M17，§7.3 写明 #140 的错误归类不能只看 `code`。
- 2026-10-15（Batch 4）三个会话的日志顺序都是 `create` 返回、`api-session/status` 报 `true`、`prompt` 返回：`running: true` 的事件在 `prompt` 调用返回之前到达（O2.1）。§7.3 据此写「`getRun` 以 `inspect` + `list` 为准，不依赖事件与调用返回的先后」。
- 2026-10-15（Batch 4）O0.1 的安装日志含一行 peer 依赖警告而退出码为 0；Batch 4 当时没有展开警告对象。Batch 5 后订正（D30）：成因可由一次性 profile 的锁文件静态回答，`autoInstallPeers: false`、profile 唯一依赖是探针 tarball、锁里记着探针的 peer `@deepseek-ai/dsh-api-session-controller: ~0.2.0-rc.2`、宿主包不在 profile 里，所以是普通缺 peer 警告，不带版本信号；O0.1 字面成立的只是「未用 `allow-version` 或 `--accept-risk` 即装入」，闸门是否比对了 peer 范围仍未知，需要不匹配 peer 的对照，留在记录 §9。
- 2026-10-15（Batch 4）`HYGIENE` 的家目录模式（斜杠、`home`、斜杠）会命中一次性根目录下名为 `home` 的子目录里的路径（`DSH_HOME` 就指向它），所以记录里不能把 `DSH_HOME` 下的路径原样写出；过滤后的 `install.log` 首行就带这样一条路径，记录只转述为「在一次性 `DSH_HOME` 下被初始化」。`net-stub.txt` 含回环 `ESTABLISHED` 地址与端口（命中 `127.0.0.1:\d`），同样只转述为「宿主进程到回环 stub 的连接」。
- 2026-10-15（Batch 4）stub 收到 4 个请求而只有 2 个 prompt，O3.2 持有时 `held` 为 2，与事实 10（首个 prompt 可能另发标题请求）一致，但 stub 不记正文，两类请求没有被区分，写进记录 §9。Batch 5 后补（D36）：stub 记了每个请求的字节数，两两成对，回复会话 170738 与 110969，持有会话 170736 与 110967，每个会话一个约 17 万字节、一个约 11 万字节的请求，与「主请求加附带请求」相符；这是推断，请求类型仍未确认。

- 2026-10-15（Batch 6）独立扩展变异 N01–N23（spec 在会话 scratchpad，不入库），在加固前、计划仍在 `active/` 的树上运行。14 条 KILLED，N23 是本人写错的语法错误变异，不计。8 条存活：
  - N01、N02：`cells` 对反引号内竖线与 `\|` 转义的处理没有用例。
  - N03：捷径列出未预注册的 O-ID，没有用例。
  - N08：夹具缺 `events` 数组时的形状断言没有用例。后面的代码也会抛 `TypeError`，只是信息不对。
  - N17：§3 的行多出一格，没有用例。
  - N06：`findPlan().dir` 写死为 `active` 时，计划未归档就存活，归档后被索引用例杀死。这正是 D19 要求在最终树上重跑的原因。
  - N05、N14：等价变异，见 D41。
- 2026-10-15（Batch 6）§3 的 O0.2 时间取的是 `core` 就绪行（05:38:11Z），不是同一 O-ID 的最后一行（`stub` 的 05:38:54Z）。所以 Batch 5 报告的「取同一 O-ID 的最后一行」对 O0.2 不精确。D26 已写明理由：预注册步骤表把 O0.2 放在 `core` 第 1 序；另两次是不同模式里的同一读数，不是重试。两种取法都晚于 T0，结论不变，记录不改（D43）。
- 2026-10-15（Batch 6）`origin/main` 仍是 `21cb29eb`，`git ls-tree origin/main apps/harness-plugin/src/host-providers.ts` 无输出。PR #344（A）已推送的 head `5c31daf6` 里只有计划，还没有 `host-providers.ts` 与 ADR-0014。所以记录 §7.2「由 #132 的 open PR（PR #344）提议」的措辞仍然成立。PR #342（C）分支上的 `decode.ts` 对 `isCrossRepository: true` 给 `headBranch: undefined`，与 §7.4 一致。合并前按 Batch 6 末条再核一次。
- 2026-10-15（评审修复轮）base `21cb29eb` 上的 `packages/providers/development-github` 已有 `package.json` 与 `src/index.ts` 的包骨架。`decode.ts` 等读取实现只在 PR #342 的 head `79aef826` 上；`host-providers.ts` 与 ADR-0014 只在 PR #344 的 head `697b283c` 上。所以 §7.4 不能写「该包在 base 上不存在」，只能写「base 上只有包骨架」。证据：对这三个 ref 运行 `git ls-tree -r --name-only`。
- 2026-10-15（评审修复轮）改造合成夹具时，三个 `inspect` 共用了同一个 `reason` 对象。白名单用例会原地改它，于是之后的用例全部误红。现在改成每次调用都新建对象（`missing()`）。今后加合成数据时，凡是会被用例原地改写的对象，都不要在调用之间共享。

## Decision Log

以下决策均为：协调者按人类授权调研后决定，人类可推翻。D20 起由实施者（Sonnet）在 Batch 1–2、4 执行中记录，属于计划未规定处的最小补全，协调者与人类可推翻。

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

- D20（2026-10-15 11:06 +08，实施者）夹具里 `list` 的 `value` 保持宿主的 `{ items: [行…] }` 形状，只保留探针自己的行；`create` 的 `value` 只留 `sessionId`（丢掉 `agentPreset`）；`prompt` 与 `cancel` 的 `value` 是宿主原样的 `{ accepted }`。Rationale：Design / Spec §4 只说「list 的 value 只保留探针自己的会话行」，没有定形；宿主 `SessionListValue` 是 `{ items }`（`dsh-api-session-controller/lib/types/types.d.ts:266-268`），沿用宿主形状让 #140 的回放 port 不需要再造一层；`agentPreset` 不是 #140 用到的字段，丢弃比放行更符合「只留所需」。已写进记录 §8，测试的白名单按此实现（`checkFixture` 对 `list` 取 `value.items`）。
- D21（2026-10-15 11:06 +08，实施者）契约测试里 `parseRecord` 先解析 §3 观测表并逐个断言预注册 ID「恰好一行」，再解析 §5、§6、§2、§7；真实文件用例 2 把两处索引检查放在记录解析之前；`rec.preregMs`、`rec.t0Ms` 在解析时算好（M8 的锚点 `t >= rec.t0Ms` 因此唯一）。Rationale：骨架阶段三条真实用例要因「观测表缺预注册 ID / 索引未登记」这类判别性原因变红，而不是因为解析器在 §2 或 §6 缺行时先抛异常；Batch 5 的 M1–M8 锚点已在测试文件里逐条核对为各出现一次。

- D22（2026-10-15 11:17 +08，实施者）探针除了每步向 stdout 写一行，还把同一行（投影与 scratch 替换之后）追加到 `$HP_PROBE_SCRATCH/obs/probe-<mode>.local.jsonl`；`core` 模式里 O2.x 的轮询只读 `inspect`，`list` 在 turn 结束且 `running` 回到 false 之后读一次再记最后一次；探针另写三类非夹具行：`op: note`（O4.1 的用户消息条数、O4.3 取消前后的事件总数、O3.2 持有时 stub 的 `held`）、`op: wait`（超时）、`event: guard-tripped` / `probe-failed`。Rationale：宿主是否把插件的 stdout 原样放出未知（第 5、6、8 步分流落文件正是为了回答这个问题），本地副本只写 scratch、内容与 stdout 逐行相同，宿主吞掉输出时协调者仍有可读的观测，不改变任何判据；O2.1 的判据是「之后 `list` 里该行 `running: false`」，终态后读一次更接近判据；O4.1 与 O4.3 要的是「恰好 1 条」「事件数是否变化」，投影后的 `inspect` 丢了无关事件，数字只能在探针里算。note / wait 行的 `op` 不在五个会话方法内，`make-fixture.mjs` 不会把它们放进夹具。
- D23（2026-10-15 11:17 +08，实施者）`stub.mjs` 不为 `/__hp/` 下的控制面请求记账；`make-fixture.mjs` 增加 `--launcher`、`--host-version`、`--exclude <O-ID,…>` 三个选项，按 `at` 升序排序，输出命中卫生模式就非零退出；`dsh_s.sh` 拒绝额外环境覆盖 `HOME`、`TMPDIR`、`DSH_HOME`、`DSH_TELEMETRY_DISABLED`、`HP_PROBE_SCRATCH`，并拒绝 `SCRATCH` 是家目录、真实数据根或其内部。Rationale：第 8 步要求核对「`stub.log` 每行 `keySha8` 等于 `fake.sha8`」，探针的控制请求没有 key，记账会让核对必然失败；启动器版本与「未观测到」的 O-ID 在生成夹具时才知道（Batch 4 不手改夹具，只能靠生成器参数），`--exclude` 让夹具与记录的观测表一致；环境白名单的价值在于不能被一条额外参数悄悄绕开。
- D24（2026-10-15 11:17 +08，实施者）自检用 `// ---- 合成用例 ----` 这条分隔行把 Batch 1 契约测试切成「常量 + 解析 + 检查 + 合成记录构造」与「用例」两半，前半原样写进 `.superpowers/session-probe/tmp/check-lib.mjs` 再 `import`，用同一份 `checkFixture` / `parseRecord` / `render` 校验 `make-fixture.mjs` 的产出。Rationale：计划要求自检「用 Batch 1 的测试函数校验结构」，而测试文件不导出函数，另写一份会让两处检查漂移。后果：Batch 4–6 重构测试时必须保留这条分隔行，否则只有自检会坏；自检只在 Batch 3 之前有用，之后可以不再维护。
- D25（2026-10-15 13:50 +08，实施者）§5 捷径台账对「否」行也逐个列出涉及的 O-ID，不写「—」。Rationale：解析器只读「是」行的 O-ID（`deriveConsequence` 的 `blocked` 集合），「否」行的 O-ID 列不参与推导，但列出能让读者看到每条捷径涉及哪些观测；前置说明写明「推导只读判定为『是』的行」，避免把列出误读成受影响。
- D26（2026-10-15 13:50 +08，实施者）O0.2 一行取 `core` 模式的就绪行，`restart` 与 `stub` 里重复的就绪行写在观测摘录里；O0.1 的时间取 `install.log` 末行的 `date -u`，其余行取探针 `at` 截到整秒。Rationale：预注册步骤表把 O0.2 放在 `core` 第 1 序，三次读数一致、没有「最后一次尝试」的取舍问题；测试要求的时间格式不含毫秒，截断不改变秒级先后，毫秒写在摘录里供回放核对。
- D27（2026-10-15 13:50 +08，实施者）记录 §4 追加 M17（`inspect` 未知会话的对外错误形态，`date -u` 为 2026-10-15T05:45:07Z），M4 只在结果里加一句指向 M17，不改它的 S1 读数和时间。Rationale：M 行是 Batch 1 的 S1 复核记录，改写它的结果会让 03:01:23Z 的时间戳对应一个更晚才有的读数；新增一行时间晚于 T0 且在 §4 开头注明「只解释观测、不参与推导」，观测与 S1 的差异因此可追溯。
- D28（2026-10-15 13:50 +08，实施者）§7.2 与 §7.4 的条件措辞按 `git ls-tree origin/main apps/harness-plugin/src/host-providers.ts`（base `21cb29eb` 上无输出）选「open PR」版，并按协调者给的编号点名 PR #344（#132）与 PR #342（#231）。Rationale：Design / Spec §3 规定以当时 `origin/main` 是否含 #132、#231 为准；Batch 6 合并前 rebase 时再核一次，若 main 已含则改为直接引用文件与 ADR-0014。

- D29（2026-10-15 14:28 +08，Batch 5 发现 F1，修复轮 Sonnet）采纳：记录 §2.4、本计划 Surprises、`evidence.md` 的「stderr 三次运行都是 0 行」改为「stderr 里没有探针行与 `dsh web: ` 行，各只有 2 行 Node 弃用警告（DEP0180）」。复现：三份 `host-*.err` 各 2 行、166 字节，只按模式计数核对（`DeprecationWarning` 1、`trace-deprecation` 1、探针行 0、`dsh web: ` 行 0、`http` 0、`token` 0），没有打印原文；stdout 账平（19 = 18 探针 + 1 `dsh web: `，6 = 5 + 1，17 = 16 + 1）。`streams.txt` 对 `.err` 记的 `dshweb=0 probe=0` 本来就对，只是被读成了「0 行」。
- D30（同上，F4）采纳：peer 警告成因由锁文件静态回答，替换「警告对象未知」，保留「闸门是否比对了版本未知，需要不匹配 peer 的对照」。复现：一次性 profile 的 `pnpm-lock.yaml` 为 `lockfileVersion: '9.0'`、`autoInstallPeers: false`；profile 的 `package.json` 只有 `hp-session-probe` 一个依赖；锁里记着探针的 peer `@deepseek-ai/dsh-api-session-controller: ~0.2.0-rc.2`；`node_modules` 下只有探针；`install.log` 第 3 行是 `Issues with peer dependencies found`。没有运行 `pnpm peers check`（不需要，也不再碰宿主）。
- D31（同上，F2）采纳较强的一支：记录 §3 的判据列改为预注册块判据的整格原文（含其中的命令写法），并新增契约测试「真实记录：§3 判据逐字取自预注册块」逐行比对（只折叠空白），先看它红再改记录。不走「加一句『压缩改写』说明」那支。Rationale：预注册记录的判据应是块自己的话；整格复制使比较不需要剥离命令前缀的规则；代价是判据格与「命令或动作」列有少量重复，§3 前置说明已写明。同一条里把 §6 三行之间加空 `>` 行（渲染成三段；解析正则 `^>\s*…` 不受影响，`git diff --check` 无报），不用行尾双空格。
- D32（同上，F3）采纳：H5 改写为 7 次秒级采样（`core` :09、:14，`restart` :33、:36，`stub` :52、:54、:56），写明 `core` 的 prompt 窗口（05:38:11.45 至 11.85）内没有采样点、`stub` 没有每个 prompt 步骤前后各一对、计划第 8 步的要求没有做到，排除外联靠 H1、H3、H4，`lsof` 只是旁证；§2.1 守卫表同步。复现：`net-*.txt` 的采样时刻与 `ESTABLISHED` 行数（`core`、`restart` 0 行，`stub` 6 行且全部含 stub 端口，只输出布尔与计数，地址与端口不打印）。窗口已关，不重跑宿主，所以不补采样。
- D33（同上，F5）采纳：「不是承诺稳定的插件 API」改为「未见文档承诺它是稳定的插件 API」，记录 §9 与 TD-065 候选文本都改。复现：对 `dsh-api-session-controller` 的 README 搜 `stab|experimental|unstable|public api|semver`，无稳定性表态（`internal` 的命中全是错误码 `gateway/internal`）；包版本 `0.2.0-rc.2`。
- D34（同上，F6）采纳：§7.1 加一行「有 `turn/start`、无 `turn/end`，且 `running: false`」→ `unknown`、来源 S1（宿主运行中途崩溃后会留下的状态，未观测），导语同步；§7.3 的「Agent 未附着」与「重启后冷读」两处都加「O4.4 的会话在重启前已结束」限定，运行中途重启仍在 §9。
- D35（同上，F7）采纳：§7.5 列出夹具里的重复键。复现（对 `session-api.json` 按 `[operation, 排序后的 request]` 分组）：`list({})` 4 次（O2.1、O4.4、O3.1、O3.2，横跨 `core`、`restart`、`stub` 三个宿主进程）、4 个完整结果各不相同；`create({ cwd })` 3 次（O1.1、O3.1、O3.2）、3 个 `sessionId`；`prompt` 的 `hp-req-core-1` 2 次、结果相同；对核心会话的 `inspect` 3 次（O2.2、O4.3、O4.4）、结果相同；对核心会话的 `cancel` 2 次（O4.3、O4.4）、请求相同而结果不同（`{ accepted: true }` 对 `session/not-found`）。最后一项是验证者没列的，一并写入。
- D36（同上，F8）采纳：H4、§3.1 O3.2 摘录、§9 对应行写入四个字节数。复现：只读 `stub.log` 的 `at`、`method`、`path`、`bytes` 四个字段（不读 `keySha8`）：回复会话 170738、110969，持有会话 170736、110967。写明是推断，请求类型未确认。
- D37（同上，F9）采纳 `.superpowers/review/D/hardening-proposal.patch`（`patch -p0`，一次干净应用，21/21 仍绿），再补两处补丁没覆盖的：E10 用 `findPlan(exists = existsSync)` 注入判定函数，用例「计划定位」断言 0 份与 2 份都失败；F2 的判据比对（D31）。复现：先在补丁前的树上用 `review-mutate.mjs` 跑 E10、E12、E13、E14、E15、E16、E19、E23、E27、E29，十个全部 SURVIVED，补丁与补充用例后除 E23 外都变红。**拒绝 E23**（预注册 SHA 写错检不出）：离线契约不跑 git、不联网（Design / Spec §5 首句），SHA 与 `%aI` 由 Batch 5、6 手工复核（`Validation and Acceptance` 第 4 行），做进测试要么破坏离线要么只是把同一个字符串抄两遍。
- D38（同上，F10）采纳：预注册提交 `8909c5ed` 的正文有一行以 `#` 开头（复现：`git log -1 --format=%B 8909c5ed | grep -c '^#'` 为 1，其余六个本地提交为 0）。Batch 6 的整合步骤改为 `git reset --soft 8909c5ed` 后用 `git commit -F` 重提交其后的内容，整合后核对 `^#` 行数与预注册提交未变；已写进 Batch 6 的「整合提交」条。
- D39（同上，验证者 info）复核：`origin/main` 仍是 `21cb29eb`，`git ls-tree origin/main apps/harness-plugin/src/host-providers.ts` 无输出，tracker 里 TD-065、TD-066 都是 0 条（Batch 6 追加，号码由 D16 预留），记录共引用 TD-065 一次、TD-066 五次；PR #342（C）、#344（A）、#345（B）都是 open draft，所以 §7.2、§7.4 的「open PR」条件措辞仍对。合并前 rebase 时再核（Batch 6 末条）。

- D40（2026-10-15 14:42 +08，Batch 6 独立验收者 Opus）按 Batch 6 与 D19，验收通过后即归档。计划 `git mv` 到 `completed/`，`docs/README.md` 本行的链接改到 `completed/`，状态改 Completed。行的位置不动，仍在分隔行正下方（D16）。范围补上结论 `implement`，以及「已在真实宿主观测并经对抗验证与独立验收（PR #343）」。Rationale：M15、M17 与 N06 要在计划目录确定后才能在最终树上重跑。整合、推送、并集验证、ready 与人类评审仍由协调者做，`Progress` 末条保持未勾。若人类评审要求返工，可以把计划 `git mv` 回 `active/` 并同步 `docs/README.md`；索引用例会强制两者一致。
- D41（同上）重构并加固测试。抽出 `observedIds(rec)`，因为 `checkMapping` 与 `checkFixture` 各有一份相同的集合构造。补 5 条判别断言，分别杀死 N01、N02、N03、N08、N17（见 Surprises）。没有改任何锚点行与 `deriveConsequence`，D24 的分隔行保留。两条存活判为等价：N05（`preregistered` 的 `.trim()`）只在行尾有空白时有差别，而 `session-rule` 块已冻结，且 `git diff --check` 禁止行尾空白；N14（`readReal` 的存在断言）删去后，`readFileSync` 仍以 `ENOENT` 响亮失败，只是信息不同。Rationale：测试先行，8 条存活先在加固前的树上复现。加固只加断言，不改变任何真实文件用例的判定。
- D42（同上）把记录 §7.3 的「端口义务 3：`environment` 不得拼进 prompt」改写为推论。复现：`git show 21cb29eb:packages/capabilities/src/execution-provider.ts` 第 15–16 行，义务 3 的原文是 `command` / `environment` 不得编进返回的引用或标记，理由是 `environment` 可能携带凭据材料；原文没有提到 prompt。Rationale：记录把推论写成了义务原文，读者会以为端口已有这条约束。是否把它写成义务由 #140 决定。Design / Spec §3 的同一措辞不改：它是设计时的写作提示，定稿以记录为准。
- D43（同上）O0.2 的时间不改（见 Surprises）。Rationale：D26 的取法有预注册步骤表依据，改取 `stub` 那一行只会让表与步骤表不一致，结论不变。
- D44（同上）TD-065、TD-066 按 D16 手工追加在 Open Items 的 TD-052 之后；A、B、C 的 053–064 合并后会落在两者之间。字段顺序同表头，ExecPlan 列写归档后的 `completed/` 路径。TD-066 的简述与下一步补上记录 §9 的「标题请求与主请求未区分」，其余照抄本计划的候选文本。没有跑 tracker 脚本。

- D45（2026-10-15 17:05 +08，评审修复轮）处置 PR 评审意见。评审者 Singularity-AI-Bot，review id 5530338559，2026-10-15，head `818ee4ad`，结论 APPROVE；P0 0、P1 0、P2 3、P3 5。实施者是评审会话派出的子 agent，以 `fixup!` 提交交评审会话整合。8 条意见复核后都属实，逐条处置如下（变异读数见 `Artifacts and Notes`）：
  - **F1（P2）夹具证据没有和 §3 的「已观测到」绑定**。复现：在 `818ee4ad` 上跑评审变异 R01–R08，全部 SURVIVED。
    - 处置：`checkFixture` 加 `FIXTURE_EVIDENCE`。§3 中每个「已观测到 / S3」的行，都要在夹具里找到判据可投影的部分。只绑 S3 行，因为夹具只录 S3 载体。
    - 另加两项核对。`checkLineage`：成功请求的 `sessionId` 来自此前某次 `create`；`create` 不重复返回；`list` 行与状态事件的会话都来自 `create`。`checkMappingEvidence`：§7.1 映射的来源 O-ID 在夹具里有对应结束原因的 `turn/end`，或有 `running: true` 事件；写了 O-ID 却两者都对不上的行一律失败（fail closed）。§2 的三行版本来源也逐行比对（R14）。
    - O0.1、O0.2 选「声明」一支，不改投影：改投影要改仓库外的生成器并重录夹具，而夹具只能生成、不能手改，观测窗口也已关闭。记录 §8 加一行「只由本记录证明的 O-ID」，测试要求它与常量 `RECORD_ONLY` 逐项相等，并且 `RECORD_ONLY` 加上 `FIXTURE_EVIDENCE` 的键恰好是十二个 O-ID。
    - 证据：测试先行，新用例在旧记录上红（`§8 须写明只由本记录证明…`），补上记录后 31/31。R01–R08、R14、R17 都被杀死，失败信息逐条指向对应 O-ID。
  - **F2（P2）§5 的影响判定没有绑定冻结的 §2.4**。复现：R18 SURVIVED。
    - 处置：解析块 §2.4 的「捷径 | 影响判定 | 理由」表。§5 中同名行的判定必须与块相同；块的判定格点名的 O-ID，§5 必须列出；块外新增的行，理由列须注明「块外新增」。R18 被杀死，R11 也多了这一道拦截。
    - R19、R22 不做成测试。§2.3 是散文，由 `deriveConsequence` 逐条手抄；块是否被改，靠 Validation 第 4 行对预注册提交做逐字节 diff 来判定（评审复跑过 sha256，与 `8909c5ed` 相同）。这条边界写进了测试文件头注释。
    - `24eca6b2` 的正文写「核对…预注册规则块未被改动」，超出了测试的实际覆盖。新正文已交评审会话，整合时替换。
  - **F3（P2）TD-066 指向的 #143 没有登记**。处置：起草给 #143 的验收补充评论（英文），内容包括 R4、`desktop` profile 复观测，以及 #143 验收 3 落在未观测路径上。TD-066 的「下一步」改为指向这次登记。承接登记已由评审会话发出：https://github.com/SingularityKChen/harness-projects/issues/143#issuecomment-6188911212（人类批准见 D46）。
  - **F4（P3）#140 没有指向记录**。处置：起草给 #140 的评论，内容包括记录与夹具路径、§7.3 的三条「不能依赖」，以及 #140 验收 1 与缺凭据语义之间的张力。按 D12 经人类伙伴批准后，由评审会话发出：https://github.com/SingularityKChen/harness-projects/issues/140#issuecomment-6188911985（D46）。
  - **F5（P3）§7.2、§7.4 的「open PR」措辞会随合并顺序过期**。处置：改成按 issue、ADR 与文件指代，并带 base `21cb29eb`，不再断言 PR 开着或已合并。这取代了 D13、D28 与 Design / Spec §3 的条件措辞规则；后两处是设计时的写作提示，原文不改，以记录定稿为准（同 D42）。Batch 6 末条中「按当时 main 复核 §7 措辞」一步随之取消。
  - **F6（P3）「运行全程没有非回环连接」强于证据**。处置：Surprises 中窗口 S-D 读数的第 (4) 点、Outcomes 中守卫那一句，都改成与 H5 等强。PR 正文中对应句子的英文改写已交评审会话。
  - **F7（P3）§7.1 映射没有行间优先级**。处置：在 §7.1 表前写明四级次序（有 `turn/end` → 结果轴；`running: true` → `running`；有 `turn/start`、无 `turn/end` 且 `running: false` → `unknown`；已接纳 → `starting`），并注明按单 turn 写，仍是提案。
  - **F8（P3）`Progress` 末条没勾**。处置：勾上，并回填整合、推送、并集验证与 ready 的读数和时刻。
  - **PR 级说明**：预注册提交正文中以 `#140` 开头的那一行不改，与评审建议一致。合并次序方面，评审建议本 PR 先合，以取代 D18 推荐的顺序；最终次序由人类伙伴决定。

### 调研依据

- Agent Client Protocol，Prompt Turn（stop reason 与取消）：<https://agentclientprotocol.com/protocol/prompt-turn>
- GitHub REST，Workflow runs（`status` 与 `conclusion` 分离）：<https://docs.github.com/en/rest/actions/workflow-runs>
- Anthropic，Streaming Messages（SSE 事件顺序，stub 的格式依据）：<https://platform.claude.com/docs/en/build-with-claude/streaming>
- VCR.py，Advanced Features（录制前过滤）：<https://vcrpy.readthedocs.io/en/latest/advanced.html>
- Polly.js，Events & Middleware（`beforePersist`：落盘前改写录制）：<https://github.com/Netflix/pollyjs/blob/master/docs/server/events-and-middleware.md>
- Pact，How Pact works（交互与 provider state）：<https://docs.pact.io/getting_started/how_pact_works>
- D46（2026-10-15 17:28 +08，评审会话）D12 的公开写入由人类伙伴裁定。评审会话直接问仓库所有者，问：「PR #343 的计划 D12 把对 #140 发公开评论留给你决定，#143 的登记也是同类公开写入。评审建议两条都发：#143 登记 TD-066（demo 门禁前需要真实模型成功路径 R4 与 desktop profile 复观测，并写明第三条验收强制的是哪种失败）；#140 留一条评论，指向观测记录、夹具和三条「不能依赖」，并点出验收 1 与观测到的缺凭据语义之间的张力。两条都只是评论里的「拟加验收 / 说明」，不改 issue 正文、范围或 blocked-by。发哪些？」答：「两条都发 (Recommended)」。评审会话随后以开发账号发出 #143（https://github.com/SingularityKChen/harness-projects/issues/143#issuecomment-6188911212）与 #140（https://github.com/SingularityKChen/harness-projects/issues/140#issuecomment-6188911985）两条评论。D12 中「是否改 #140 范围与 blocked-by 由人类决定」不变。Rationale：D12 把这两项公开写入保留给人类；答复是本会话的直接答复。
- DeepSeek Harness 官方插件文档（`inject` 与 `ctx` 服务）：<https://deepseek-harness.github.io/deepseek-harness/develop/basic/>
- 宿主一手资料：`dsh-api-session-controller`、`dsh-credentials-local`、`dsh-llm-deepseek` 的 README 与 `lib/` 源码（发行版 `0.2.0-rc.2`，行号见 `Context and Orientation`）。

## Idempotence and Recovery

- Batch 1、2、4、5 只改工作树文件，可重复执行；变异工具从内存原文还原并逐字节比对，被中断时退出码 130，先 `git diff` 确认。
- Batch 3 每次都新建 `$SCRATCH`，可整体重跑；同一路径下同名同版本的 tarball 重装会被 pnpm 跳过（spike M14），改探针后先 `plugin --profile web remove hp-session-probe` 再 `add`。重跑的观测按「取最后一次尝试」更新，旧尝试保留在记录的尝试记录里。
- 会话中断：观测日志在 `$SCRATCH/obs/` 与 `.superpowers/session-probe/obs/` 各一份，读数在 `.superpowers/session-probe/evidence.md`；Batch 1、4 的仓库文件在中断前做本地 WIP 提交（Batch 6 整合）；恢复时先读 `Progress` 与 `evidence.md`。
- 已知良好状态：`origin/main`（`21cb29eb`，观察时刻 2026-10-15）加预注册提交。整合前建 `backup/` 分支，推送用精确 lease。
- 本 PR 不写数据库、不迁移，回滚 PR 只删除新增文件与索引行。

## Artifacts and Notes

- 变异 spec 全文（Batch 5，2026-10-15 14:16 +08，head `1ed80a95`，读数 17 个 KILLED、退出码 0）：下面每个 `anchor` 在被测文件里恰好出现一次，记录、夹具、本计划与 `docs/README.md` 的锚点取当时的整行；`file` 为仓库相对路径。M15 的锚点两端带换行：本节嵌入的 spec 自己含有 `CORE` 那一行，不带换行会出现两次而报 `NOT_APPLIED`。这份嵌入的 spec 已从本计划原文抠出来重跑过一次，17 个 KILLED、退出码 0、五个文件逐字节还原。下面是 Batch 6 在最终树上重取锚点后的版本（D19）：M15 的文件换成 `completed/` 下的本计划，M17 的锚点换成归档后的 `docs/README.md` 行（链接 `completed/`、状态 Completed），替换为链接改回 `active/`；其余 15 条与 Batch 5 逐字相同。Batch 6 读数（2026-10-15 14:42 +08，归档与测试加固之后、Batch 6 提交之前的工作树，内容与该提交相同）：17 个 KILLED、退出码 0，`killedBy` 归因全对，五个被测文件逐字节还原。

    {"command":["node","--test","tests/contract/harness-session-api-record.test.js"],"mutants":[
      {"id":"M1","file":"tests/contract/harness-session-api-record.test.js","anchor":"hits[0].strength === 'S3'","replacement":"true","killedBy":"强度 S2"},
      {"id":"M2","file":"tests/contract/harness-session-api-record.test.js","anchor":" && !blocked.has(id)","replacement":"","killedBy":"捷径"},
      {"id":"M3","file":"tests/contract/harness-session-api-record.test.js","anchor":"counted('O0.1') && counted('O0.2') ?","replacement":"counted('O0.1') ?","killedBy":"插件可达"},
      {"id":"M4","file":"tests/contract/harness-session-api-record.test.js","anchor":"implementMissing.length ? 'narrow' : 'implement'","replacement":"'implement'","killedBy":"narrow"},
      {"id":"M5","file":"tests/contract/harness-session-api-record.test.js","anchor":"coreMissing.length > 0","replacement":"coreMissing.length > 1","killedBy":"move-after-demo"},
      {"id":"M6","file":"tests/contract/harness-session-api-record.test.js","anchor":"if (consequence !== 'move-after-demo') assert.ok(","replacement":"if (false) assert.ok(","killedBy":"夹具缺失"},
      {"id":"M7","file":"tests/contract/harness-session-api-record.test.js","anchor":"|127\\.0\\.0\\.1:\\d","replacement":"","killedBy":"卫生"},
      {"id":"M8","file":"tests/contract/harness-session-api-record.test.js","anchor":"t >= rec.t0Ms","replacement":"t >= rec.preregMs","killedBy":"T0"},
      {"id":"M9","file":"docs/architecture/harness-session-api.md","anchor":"| O1.1 | 能否在指定 cwd 创建会话 | `create({ cwd: '<scratch>/work' })` 返回以 `session-` 开头的 `sessionId` | `ctx.sessionController.create({ cwd: '<scratch>/work' })` | 已观测到 | S3 | 2026-10-15T05:38:11Z |","replacement":"| O1.1 | 能否在指定 cwd 创建会话 | `create({ cwd: '<scratch>/work' })` 返回以 `session-` 开头的 `sessionId` | `ctx.sessionController.create({ cwd: '<scratch>/work' })` | 已观测到 | S2 | 2026-10-15T05:38:11Z |","killedBy":"真实记录"},
      {"id":"M10","file":"docs/architecture/harness-session-api.md","anchor":"> 对 #140 的结论：`implement`","replacement":"> 对 #140 的结论：`narrow`","killedBy":"真实记录"},
      {"id":"M11","file":"docs/architecture/harness-session-api.md","anchor":"| 宿主版本 | `0.2.0-rc.2` |","replacement":"| 宿主版本 | `0.2.1-alpha.3` |","killedBy":"真实夹具"},
      {"id":"M12","file":"tests/contract/fixtures/harness-session/session-api.json","anchor":"\"provenance\":{","replacement":"\"provenance\":{\"leak\":\"/var/folders/x\",","killedBy":"真实夹具"},
      {"id":"M13","file":"tests/contract/fixtures/harness-session/session-api.json","anchor":"{\"observation\":\"O1.2\",\"operation\":\"prompt\",\"request\":{\"requestId\":\"hp-req-core-1\",\"sessionId\":\"session-fe511a9a-0b8d-4b11-80ee-97d7374e566e\",\"mode\":\"queue\",\"content\":[{\"type\":\"text\",\"text\":\"hp-session-probe: reply with OK only. Do not call tools.\"}]},\"outcome\":{\"ok\":true,\"value\":{\"accepted\":true}}},\n","replacement":"","killedBy":"真实夹具"},
      {"id":"M14","file":"tests/contract/fixtures/harness-session/session-api.json","anchor":"{\"observation\":\"O2.2\",\"operation\":\"inspect\",\"request\":{\"sessionId\":\"session-fe511a9a-0b8d-4b11-80ee-97d7374e566e\"},\"outcome\":{\"ok\":true,\"value\":{\"events\":[{\"seq\":4,\"type\":\"turn/start\",\"turn\":1},{\"seq\":7,\"type\":\"step/start\",\"turn\":1},{\"seq\":9,\"type\":\"user/message\",\"rpcId\":\"hp-req-core-1\"},{\"seq\":17,\"type\":\"step/end\",\"turn\":1},{\"seq\":18,\"type\":\"turn/end\",\"turn\":1,\"reason\":{\"kind\":\"error\",\"error\":{\"code\":\"MISSING_CREDENTIAL\"}}}]}}},","replacement":"{\"observation\":\"O2.2\",\"operation\":\"inspect\",\"request\":{\"sessionId\":\"session-fe511a9a-0b8d-4b11-80ee-97d7374e566e\"},\"outcome\":{\"ok\":true,\"value\":{\"events\":[{\"seq\":4,\"type\":\"turn/start\",\"turn\":1,\"time\":1},{\"seq\":7,\"type\":\"step/start\",\"turn\":1},{\"seq\":9,\"type\":\"user/message\",\"rpcId\":\"hp-req-core-1\"},{\"seq\":17,\"type\":\"step/end\",\"turn\":1},{\"seq\":18,\"type\":\"turn/end\",\"turn\":1,\"reason\":{\"kind\":\"error\",\"error\":{\"code\":\"MISSING_CREDENTIAL\"}}}]}}},","killedBy":"真实夹具"},
      {"id":"M15","file":"docs/exec-plan/completed/2026-10-15-harness-session-api-probe.md","anchor":"\n- `CORE`：O0.1、O0.2、O1.1、O1.2、O2.1、O2.2\n","replacement":"\n- `CORE`：O0.1、O0.2、O1.1、O1.2、O2.1\n","killedBy":"预注册常量"},
      {"id":"M16","file":"docs/architecture/harness-session-api.md","anchor":"| `turn/end`，`reason.kind` 为 `completed` | `succeeded` | O3.1 |","replacement":"| `turn/end`，`reason.kind` 为 `completed` | `succeeded` | O9.9 |","killedBy":"真实记录"},
      {"id":"M17","file":"docs/README.md","anchor":"| [2026-10-15-harness-session-api-probe](exec-plan/completed/2026-10-15-harness-session-api-probe.md) | #280：在宿主 `0.2.0-rc.2` 上观测仓库外插件能调用哪些会话操作（启动、读状态、取消），录脱敏夹具，并按预注册规则机械给出对 #140 的结论（`implement`）；记录见 `docs/architecture/harness-session-api.md`；已在真实宿主观测并经对抗验证与独立验收（PR #343） | Completed |","replacement":"| [2026-10-15-harness-session-api-probe](exec-plan/active/2026-10-15-harness-session-api-probe.md) | #280：在宿主 `0.2.0-rc.2` 上观测仓库外插件能调用哪些会话操作（启动、读状态、取消），录脱敏夹具，并按预注册规则机械给出对 #140 的结论（`implement`）；记录见 `docs/architecture/harness-session-api.md`；已在真实宿主观测并经对抗验证与独立验收（PR #343） | Completed |","killedBy":"真实记录"}
    ]}
- 补充变异表（修复轮，2026-10-15 14:30 +08，D37、D31）：覆盖 Batch 5 的存活变异与新增的判据比对，不属于上面 17 行验收表，验收仍以 M1–M17 为准；`command` 同上，`killedBy` 是失败用例名的片段。锚点在最终树上各恰好出现一次（H27c 与 H31c 取记录里的整行，换行分隔）。读数：主表 17 个 KILLED、退出码 0；补充表 16 个 KILLED、退出码 0，无 `NOT_APPLIED`、`KILLED_OTHER`、`SURVIVED`；两次运行前后 `tests/contract/harness-session-api-record.test.js`、记录、夹具、本计划、`docs/README.md` 的 sha256 逐字节相同。E23（预注册 SHA 写错）按设计不杀（D37）。

    {"command":["node","--test","tests/contract/harness-session-api-record.test.js"],"mutants":[
      {"id":"H10","file":"tests/contract/harness-session-api-record.test.js","anchor":"assert.equal(hits.length, 1, `docs/exec-plan","replacement":"assert.ok(hits.length >= 1, `docs/exec-plan","killedBy":"计划定位"},
      {"id":"H12","file":"tests/contract/harness-session-api-record.test.js","anchor":".startsWith(s.slice(0, 19))","replacement":".startsWith('')","killedBy":"时间"},
      {"id":"H13","file":"tests/contract/harness-session-api-record.test.js","anchor":"if (ev.reason.reason) only(ev.reason.reason, ['kind'], 'reason.reason')","replacement":"","killedBy":"白名单"},
      {"id":"H14","file":"tests/contract/harness-session-api-record.test.js","anchor":"if (ev.reason.error) only(ev.reason.error, ['code'], 'reason.error')","replacement":"","killedBy":"白名单"},
      {"id":"H15","file":"tests/contract/harness-session-api-record.test.js","anchor":"if (!e.outcome.ok) { only(e.outcome.error, ['code', 'message', 'details', 'remote'], '失败的 error'); continue }","replacement":"if (!e.outcome.ok) { continue }","killedBy":"白名单"},
      {"id":"H16","file":"tests/contract/harness-session-api-record.test.js","anchor":"assert.equal(s.event, 'api-session/status', '状态事件的 event 只能取 api-session/status')","replacement":"","killedBy":"白名单"},
      {"id":"H19","file":"tests/contract/harness-session-api-record.test.js","anchor":"assert.equal(typeof e.outcome?.ok, 'boolean',","replacement":"assert.ok(true,","killedBy":"白名单"},
      {"id":"H27a","file":"tests/contract/harness-session-api-record.test.js","anchor":"['`completed`', 'succeeded']","replacement":"['`completed`', 'failed']","killedBy":"映射"},
      {"id":"H27b","file":"tests/contract/harness-session-api-record.test.js","anchor":"if (m.host.includes(kind)) assert.equal(m.status, status,","replacement":"if (false) assert.equal(m.status, status,","killedBy":"映射"},
      {"id":"H27c","file":"docs/architecture/harness-session-api.md","anchor":"| `turn/end`，`reason.kind` 为 `completed` | `succeeded` | O3.1 |\n| `turn/end`，`reason.kind` 为 `error` | `failed` | O2.2 |","replacement":"| `turn/end`，`reason.kind` 为 `completed` | `failed` | O3.1 |\n| `turn/end`，`reason.kind` 为 `error` | `succeeded` | O2.2 |","killedBy":"真实记录"},
      {"id":"H29a","file":"tests/contract/harness-session-api-record.test.js","anchor":"v?.accepted === true","replacement":"true","killedBy":"夹具"},
      {"id":"H29b","file":"tests/contract/harness-session-api-record.test.js","anchor":"/^session-/.test(v?.sessionId ?? '')","replacement":"true","killedBy":"夹具"},
      {"id":"H31a","file":"tests/contract/harness-session-api-record.test.js","anchor":"assert.equal(norm(r.criterion), norm(criteria[r.id]),","replacement":"assert.ok(true,","killedBy":"判据"},
      {"id":"H31b","file":"tests/contract/harness-session-api-record.test.js","anchor":"assert.ok(criteria[r.id] !== undefined,","replacement":"assert.ok(true,","killedBy":"判据"},
      {"id":"H31c","file":"docs/architecture/harness-session-api.md","anchor":"| O3.2 | 运行中取消能否生效并读到 | stub 为 `hold` 时，新会话 create + prompt，观测到该会话 `api-session/status` 为 `true` 且 stub 正持有请求后 `cancel({ sessionId })` 返回 `{ accepted: true }`；30 s 内 `inspect` 读到 `turn/end` 且 `reason.kind = aborted`、`reason.reason.kind = user`，`running` 回到 `false` | `GET /__hp/mode?m=hold`；`create` + `prompt({ requestId: 'hp-req-hold-1', … })`；status 为 `true` 且 `held` 不小于 1 后 `cancel({ sessionId })` | 已观测到 | S3 | 2026-10-15T05:38:55Z |","replacement":"| O3.2 | 运行中取消能否生效并读到 | stub 为 `hold` 时，新会话 create + prompt，`cancel({ sessionId })` 返回 `{ accepted: true }`；30 s 内 `inspect` 读到 `turn/end` 且 `reason.kind = aborted`、`reason.reason.kind = user`，`running` 回到 `false` | `GET /__hp/mode?m=hold`；`create` + `prompt({ requestId: 'hp-req-hold-1', … })`；status 为 `true` 且 `held` 不小于 1 后 `cancel({ sessionId })` | 已观测到 | S3 | 2026-10-15T05:38:55Z |","killedBy":"真实记录"},
      {"id":"H31d","file":"tests/contract/harness-session-api-record.test.js","anchor":"const norm = (s) => s.replace(/\\s+/g, ' ').trim()","replacement":"const norm = (s) => s.trim().slice(0, 12)","killedBy":"判据"}
    ]}
- Batch 6 表（D41，2026-10-15 14:42 +08）：加固的判别断言各对应一条变异，外加 N06（计划目录写死为 `active`，归档后才可杀）。加固前的树上这 6 条都存活（N06 当时计划在 `active/`）；最终树上 6 个 KILLED、退出码 0，无 `NOT_APPLIED`、`KILLED_OTHER`、`SURVIVED`。同一轮的补充表 H 也在最终树上重跑，16 个 KILLED、退出码 0；锚点未变，spec 同上。

    {"command":["node","--test","tests/contract/harness-session-api-record.test.js"],"mutants":[
      {"id":"N01","file":"tests/contract/harness-session-api-record.test.js","anchor":"if (line[i] === '`') tick = !tick","replacement":"","killedBy":"解析"},
      {"id":"N02","file":"tests/contract/harness-session-api-record.test.js","anchor":"if (line[i] === '\\\\' && line[i + 1] === '|') { cur += '|'; i++; continue }","replacement":"","killedBy":"解析"},
      {"id":"N03","file":"tests/contract/harness-session-api-record.test.js","anchor":"assert.ok(ids.every((id) => ALL.includes(id)), ","replacement":"assert.ok(true, ","killedBy":"解析"},
      {"id":"N06","file":"tests/contract/harness-session-api-record.test.js","anchor":"dir: path.basename(path.dirname(hits[0]))","replacement":"dir: 'active'","killedBy":"真实记录"},
      {"id":"N08","file":"tests/contract/harness-session-api-record.test.js","anchor":"assert.ok(Array.isArray(exchanges) && Array.isArray(events), ","replacement":"assert.ok(true, ","killedBy":"白名单"},
      {"id":"N17","file":"tests/contract/harness-session-api-record.test.js","anchor":"assert.equal(c.length, OBS_HEADER.length, ","replacement":"assert.ok(true, ","killedBy":"解析"}
    ]}
- 评审变异表 R（D45；评审者定义，22 条的改动与评审读数见 `docs/review/pr-343-mmp-review.md`，spec 在 git 忽略的 `.superpowers/fix-343/rv-R.json`，锚点含本计划的冻结块行，嵌进本节会让锚点不唯一，所以不嵌入）。修复轮读数（2026-10-15，`node scripts/review-mutate.mjs .superpowers/fix-343/rv-R.json --root .`，退出码 1：下表 R19、R22 按设计存活，R12 未纳入本轮）：

| R | 改动 | 修复前（head `818ee4ad`） | 修复后 | 杀死它的用例 |
|---|---|---|---|---|
| R01–R08 | 夹具否定 O2.2、O2.1（两处）、O1.1 的会话一致性、O3.1、O3.2、O4.1、O4.4 的判据 | SURVIVED | KILLED | 真实夹具（失败信息逐条是对应 O-ID 的「夹具却不支持」，R04 落在 O1.2） |
| R09、R10、R13、R15、R16、R20、R21 | §6、§3、T0、块常量与判据 | KILLED | KILLED | 同评审读数 |
| R11 | 记录 §5 `web` profile 否改是 | KILLED | KILLED | 结论块等于推导；另加 §5 与块 §2.4 一致 |
| R12 | §6 推导散文里复述的结论改 `narrow` | SURVIVED | SURVIVED | 未纳入本轮：散文复述不参与推导，结论块由测试复算 |
| R14 | §2 来源三改 `0.2.1-alpha.3` | SURVIVED | KILLED | 真实记录：§2 三处版本来源都读到宿主版本 |
| R17 | 映射 `aborted` 行来源改 O4.3 | SURVIVED | KILLED | 真实夹具（映射来源在夹具里没有 `aborted` 的 `turn/end`） |
| R18 | 块 §2.4 `web` profile 否改是 | SURVIVED | KILLED | 真实记录：§5 捷径的影响判定与预注册 §2.4 一致 |
| R19、R22 | 块 §2.3 规则散文、计入条件放宽 | SURVIVED | SURVIVED | 设计边界：块完整性靠 Validation 第 4 行的逐字节 diff（D45） |

- 修复轮自检表 X（D45）：修复轮新增的每条检查各对应一条变异，用来证明合成用例能单独发现检查被删弱，而不只是靠真实文件。最终树上 38 个 KILLED、退出码 0，没有 `NOT_APPLIED`、`KILLED_OTHER` 或 `SURVIVED`。首跑时 X13（O4.1 的「此前有同一 `requestId` 的 prompt」）与 X20（O4.4 的 `session/not-found` 码）存活，补了两条合成反例后才被杀死。同一棵树上，主表 M 17/17、补充表 H 16/16、Batch 6 表 N 6/6 仍全部 KILLED，三次退出码都是 0。

    {"command":["node","--test","tests/contract/harness-session-api-record.test.js"],"mutants":[
      {"id":"X01","file":"tests/contract/harness-session-api-record.test.js","anchor":"return typeof e?.request.cwd === 'string' && ","replacement":"return ","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X02","file":"tests/contract/harness-session-api-record.test.js","anchor":"(fx) => accepted(fx, 'O1.2', createdBy(fx, 'O1.1'))","replacement":"() => true","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X03","file":"tests/contract/harness-session-api-record.test.js","anchor":"return trueThenFalse(fx, 'O2.1', s) && ","replacement":"return ","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X04","file":"tests/contract/harness-session-api-record.test.js","anchor":"rowsOf(fx, 'O2.1', s).some((i) => i.running === false)","replacement":"true","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X05","file":"tests/contract/harness-session-api-record.test.js","anchor":"evs.some((ev) => ev.type === 'turn/start') && ","replacement":"","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X06","file":"tests/contract/harness-session-api-record.test.js","anchor":"evs.some((ev) => ev.type === 'turn/end' && typeof ev.reason?.kind === 'string')","replacement":"true","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X07","file":"tests/contract/harness-session-api-record.test.js","anchor":"return accepted(fx, 'O3.1', s) && ","replacement":"return ","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X08","file":"tests/contract/harness-session-api-record.test.js","anchor":"endsOf(okOn(fx, 'O3.1', 'inspect', s)).some((ev) => ev.reason?.kind === 'completed')","replacement":"true","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X09","file":"tests/contract/harness-session-api-record.test.js","anchor":"rowsOf(fx, 'O3.1', s).some((i) => i.running === false)","replacement":"true","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X10","file":"tests/contract/harness-session-api-record.test.js","anchor":"trueThenFalse(fx, 'O3.2', s) && ","replacement":"","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X11","file":"tests/contract/harness-session-api-record.test.js","anchor":"okOn(fx, 'O3.2', 'cancel', s).some((e) => e.outcome.value?.accepted === true)","replacement":"true","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X12","file":"tests/contract/harness-session-api-record.test.js","anchor":"ev.reason.reason?.kind === 'user'","replacement":"true","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X13","file":"tests/contract/harness-session-api-record.test.js","anchor":"fx.exchanges.slice(0, i).some((e) => e.operation === 'prompt' && e.request?.requestId === requestId && sid(e) === sessionId)","replacement":"true","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X14","file":"tests/contract/harness-session-api-record.test.js","anchor":"later.every((e) => e.outcome.value.events.filter((ev) => ev.type === 'user/message' && ev.rpcId === requestId).length === 1)","replacement":"true","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X15","file":"tests/contract/harness-session-api-record.test.js","anchor":" && failed('inspect', unknown)","replacement":"","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X16","file":"tests/contract/harness-session-api-record.test.js","anchor":"failed('prompt', (r) => created.has(r.sessionId) && Array.isArray(r.content) && r.content.every((c) => c.type === 'text' && c.text.trim() === ''))","replacement":"true","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X17","file":"tests/contract/harness-session-api-record.test.js","anchor":"endsOf(reread(fx, i, sid(e))).length > 0 && attached && ","replacement":"endsOf(reread(fx, i, sid(e))).length > 0 && ","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X18","file":"tests/contract/harness-session-api-record.test.js","anchor":" && fx.exchanges.slice(i + 1).some((a) => a.observation === 'O4.3'","replacement":" && true || fx.exchanges.slice(i + 1).some((a) => a.observation === 'O4.3'","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X19","file":"tests/contract/harness-session-api-record.test.js","anchor":" && isDeepStrictEqual(cold, endsOf(reread(fx, i, s).slice(-1)))","replacement":"","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X20","file":"tests/contract/harness-session-api-record.test.js","anchor":"e.outcome.error?.code === 'session/not-found'","replacement":"true","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X21","file":"tests/contract/harness-session-api-record.test.js","anchor":"r.strength !== 'S3' || ","replacement":"","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X22","file":"tests/contract/harness-session-api-record.test.js","anchor":"assert.deepEqual(rec.recordOnly, RECORD_ONLY,","replacement":"assert.ok(true,","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X23","file":"tests/contract/harness-session-api-record.test.js","anchor":"  checkEvidence(rec, fixture)\n","replacement":"","killedBy":"§3 写「已观测到 / S3」"},
      {"id":"X24","file":"tests/contract/harness-session-api-record.test.js","anchor":"if (sid(e) !== undefined && isOk(e)) assert.ok(created.has(sid(e)),","replacement":"if (false) assert.ok(created.has(sid(e)),","killedBy":"指向不是此前 create"},
      {"id":"X25","file":"tests/contract/harness-session-api-record.test.js","anchor":"for (const it of e.outcome.value.items) assert.ok(created.has(it.sessionId),","replacement":"for (const it of []) assert.ok(created.has(it.sessionId),","killedBy":"指向不是此前 create"},
      {"id":"X26","file":"tests/contract/harness-session-api-record.test.js","anchor":"assert.ok(!created.has(e.outcome.value.sessionId),","replacement":"assert.ok(true,","killedBy":"指向不是此前 create"},
      {"id":"X27","file":"tests/contract/harness-session-api-record.test.js","anchor":"for (const s of fx.events) assert.ok(created.has(s.sessionId),","replacement":"for (const s of []) assert.ok(created.has(s.sessionId),","killedBy":"指向不是此前 create"},
      {"id":"X28","file":"tests/contract/harness-session-api-record.test.js","anchor":"  checkLineage(fixture)\n","replacement":"","killedBy":"指向不是此前 create"},
      {"id":"X29","file":"tests/contract/harness-session-api-record.test.js","anchor":"kinds.includes(ev.reason?.kind)","replacement":"true","killedBy":"映射：来源 O-ID 在夹具里"},
      {"id":"X30","file":"tests/contract/harness-session-api-record.test.js","anchor":"fx.events.some((s) => s.observation === id && s.running === true)","replacement":"true","killedBy":"映射：来源 O-ID 在夹具里"},
      {"id":"X31","file":"tests/contract/harness-session-api-record.test.js","anchor":"else assert.fail(","replacement":"else if (false) assert.fail(","killedBy":"映射：来源 O-ID 在夹具里"},
      {"id":"X32","file":"tests/contract/harness-session-api-record.test.js","anchor":"  checkMappingEvidence(rec, fixture)\n","replacement":"","killedBy":"映射：来源 O-ID 在夹具里"},
      {"id":"X33","file":"tests/contract/harness-session-api-record.test.js","anchor":"assert.equal(s.affects, f.affects,","replacement":"assert.ok(true,","killedBy":"捷径：§5"},
      {"id":"X34","file":"tests/contract/harness-session-api-record.test.js","anchor":"for (const id of f.ids) assert.ok(s.ids.includes(id),","replacement":"for (const id of []) assert.ok(s.ids.includes(id),","killedBy":"捷径：§5"},
      {"id":"X35","file":"tests/contract/harness-session-api-record.test.js","anchor":"assert.match(s.reason, /块外新增/,","replacement":"assert.ok(true,","killedBy":"捷径：§5"},
      {"id":"X36","file":"tests/contract/harness-session-api-record.test.js","anchor":"assert.ok(['是', '否'].includes(verdict[0]),","replacement":"assert.ok(true,","killedBy":"捷径：§5"},
      {"id":"X37","file":"tests/contract/harness-session-api-record.test.js","anchor":"rec.sources.length >= 3","replacement":"rec.sources.length >= 0","killedBy":"版本：§2"},
      {"id":"X38","file":"tests/contract/harness-session-api-record.test.js","anchor":"s.includes(`\\`${rec.version}\\``)","replacement":"true","killedBy":"版本：§2"}
    ]}
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

2026-10-15 14:42 +08，Batch 6 验收部分完成时写。

- **结论**：对 #140 的结论是 `implement`，插件可达「是」，缺项「无」。十二个预注册 O-ID 都在真实宿主上以 S3 观测到（Desktop 自带的 `dsh`、`web` profile、一次性 `DSH_HOME`），没有判定为「是」的捷径。#140 可以把三个操作落在宿主的 `ctx.sessionController` 上：`startRun` 是 `create` + `prompt`，`getRun` 是 `inspect` + `list`，`cancelRun` 是 `cancel` 后再 `inspect`。记录 §7 给出状态映射提案、Host 接缝、失败形态与回放键建议；最终断言归 #140 的契约套件。改 #140 的范围、blocked-by 与看板 `Status` 仍由人类决定（D12）。
- **R3 与守卫**：R3 成功（人类在 T0 前批准），读到了 `completed`，也读到了原因为 `user` 的 `aborted`。五条守卫都没有触发：sink 收到 0 个请求，`keySha8` 4/4 一致，7 次秒级 `lsof` 采样只见回环连接（`plugin add` 与 `core` 的 prompt 窗口没有采样，排除外联主要靠 H1、H3、H4），`~/.dsh` 与 Documents 没有新条目。窗口 S-D 只用了 1 分 55 秒。
- **与计划的偏差**：
  1. H5 的 `lsof` 采样没有做到「每个 prompt 步骤前后各一次」（D32），排除外联改靠 H1、H3、H4。
  2. 记录有五处表述比证据强或比冻结判据弱：stderr 写成 0 行、判据被压缩改写、稳定性推断写成事实、重启语义缺限定、端口义务的推论写成原文。前四处由 Batch 5（D29–D36）订正，最后一处由 Batch 6（D42）订正；数据本身没有错。
  3. 测试从设计估算的 300–350 行涨到约 485 行，多出的是逐条 `killedBy` 的合成用例与两轮加固；评审修复轮又把夹具、§5 与版本来源绑定到判据，涨到约 705 行（D45）。
  4. S3 与 S1 有一处差异：`inspect` 未知会话抛的是没有 `code` 的普通 `Error`（M17）。
- **变异**：最终树上，主表 17/17、补充表 16/16、Batch 6 表 6/6 都是 KILLED。E23（预注册 SHA 写错检不出）按离线设计不可杀（D37）。评审修复轮（D45）之后这三张表仍然全杀；评审表 R 的 22 条里有 19 条被杀，R12 未纳入本轮，R19、R22 属于离线设计边界；修复轮自检表 X 38/38 KILLED。
- **遗留**：
  - TD-065：只在 `0.2.0-rc.2` 上观测，版本漂移后要重跑。
  - TD-066：R4 与 `desktop` profile 未观测，#143 前经人类批准补做。#143 的承接登记已由评审会话发出（D46）：https://github.com/SingularityKChen/harness-projects/issues/143#issuecomment-6188911212。
  - 记录 §9 的其余未观测项，由 #140 按需另做观测：运行中途重启、运行中的 `list`、其他 `mode`、并发与工具执行、闸门是否比对 peer 范围。
- **转交协调者**：整合、推送、并集验证、ready 与人类评审请求已于 15:53 +08 完成（`Progress`）。
- **转交评审会话**（D45 之后）：
  - 用 autosquash 整合修复轮的 `fixup!` 提交，`8909c5ed` 不动、也不作 fixup 目标；整合后按 D38 核对 `^#` 行数与预注册提交的 SHA，`24eca6b2` 换用新正文。
  - PR 正文中网络守卫那一句换成与 H5 等强的英文改写（F6）。
  - 经人类伙伴批准后，发出给 #143 与 #140 的评论（F3、F4）。
  - 合并由人类伙伴决定，只用 rebase merge；评审建议本 PR 先合。
- **复盘**：预注册加机械推导让结论没有争议空间。两轮独立核查找到的都是「措辞强于证据」，不是数据错误，所以这类记录的主要风险在措辞。变异表也只在最终树上才有意义：N06 在归档前存活，归档后被杀死。

### 技术债务候选（Batch 6 手工追加到 `docs/exec-plan/tech-debt-tracker.md` 的 Open Items）

已于 2026-10-15 14:42 +08 按下面的文本追加（D44；TD-066 补了标题请求与主请求未区分一项）。评审修复轮（D45）改写了 TD-066 的下一步，让它指向 #143 的承接登记。

- **TD-065**（子系统：Harness 宿主会话接口；分支 `test/harness-session-api-probe`）：会话接口只在宿主 `0.2.0-rc.2` 上观测；`sessionController` 是 rc 宿主的服务键，未见文档承诺它是稳定的插件 API（`dsh-api-session-controller` 的 README 对稳定性没有表态），`alpha` 线已到 `0.2.1-alpha.3`。延期理由：本 PR 只回答当前发行版。遗留影响：宿主升级可能改变方法签名、错误码或事件形状，夹具随之失真。下一步：`latest` 越过 `0.2.0-rc.2` 或 #227 改 peer 范围时，按记录 §9 重跑 `CORE` 与 `IMPLEMENT` 并重录夹具；#140 的 peer 精确钉住观测过的版本。
- **TD-066**（同上）：真实模型的成功路径与 `desktop` profile 都未观测；R3 的 `completed` 与 `aborted` 来自回环 stub。延期理由：R4 消耗额度、要改真实环境，需要人类批准。遗留影响：真实 provider 下的错误码、重试与标题请求行为可能不同；demo 门禁不能只靠本夹具。下一步：#143 demo 门禁演练前经人类批准做 R4，并在 `desktop` profile 重跑 O1.x–O3.x；承接登记见 #143 评论 https://github.com/SingularityKChen/harness-projects/issues/143#issuecomment-6188911212（D46）。

## Bottom Change Note

- Change Note (2026-10-15 09:58 +08)：创建本计划。合并 d1 与 d2 两份设计，补齐事实复核、预注册块、记录与夹具格式契约、协调者独占的 S3 步骤、变异表与验收批次。
- Change Note (2026-10-15 10:40 +08)：按跨 PR 集成评审修订（D13–D19）。§7 Host 接缝改为条件措辞的 `execution.harness` 目录条目与嵌套 `ctx.inject`，不再提 `HostProviderFactory` 与 ADR-0013 注入清单；新增事实 15（Cordis 无可选注入）；仓库侧事实标 base `21cb29eb`；窗口 S-D 前置移到块外，宿主流分 stdout / stderr、只交过滤后的探针行；新增第 8b 步重装行为与给 A 的非决定性 Surprises；补会话推送远端一行；记录测试加 `docs/README.md` 链接检查与 M17；Batch 6 加并集验证、合并前步骤与最终树重跑变异；规模估算改为代码约 350–390、文档约 900–950。`session-rule` 块逐字未改。
- Change Note (2026-10-15 14:42 +08)：Batch 6 验收部分。本计划归档到 `completed/`（D40）；状态行与 `Progress` 拆出协调者未完成的部分；`Artifacts and Notes` 的主表 spec 换成最终树的 M15 路径与 M17 锚点，新增 Batch 6 表；补 Surprises、D40–D44、`Outcomes & Retrospective`。`session-rule` 块逐字未改。
- Change Note (2026-10-15 17:05 +08)：评审修复轮（D45）。改动如下：
  - 契约测试：把 §3 的「已观测到 / S3」绑定到夹具证据（含会话谱系与映射来源），把 §5 绑定到块 §2.4，并比对 §2 的版本来源。
  - 记录：§8 声明 O0.1、O0.2 只由记录证明；§7.1 补行间优先级；§7.2、§7.4 改成与合并顺序无关的写法。
  - 本计划：订正两处网络守卫措辞，勾选 Batch 6 协调者条，补 Surprises、D45 与变异读数；TD-066 指向 #143 的承接登记。
  - `session-rule` 块逐字未改。
