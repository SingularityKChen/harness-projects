# 宿主会话接口观测：插件能否启动、读取与取消一次运行

> 状态：已按观测定稿（Batch 4）。§2、§3、§5 来自窗口 S-D（2026-10-15T05:37:25Z 至 2026-10-15T05:39:20Z）里的真实宿主观测；§6 由 `tests/contract/harness-session-api-record.test.js` 复算；对抗验证（Batch 5）与独立验收（Batch 6）已完成，两轮发现都已按计划回填；PR 评审（2026-10-15）的意见也已回填（ExecPlan D45）。
> 范围：issue #280。在 DeepSeek Harness 宿主 `0.2.0-rc.2` 上，观测仓库外插件能调用哪些会话操作（启动、读状态、取消），录一份脱敏夹具，并按预注册规则机械给出对 #140 的结论。不实现 provider（#140），不设计提示词。
> 规则来源：ExecPlan `2026-10-15-harness-session-api-probe` 的 `session-rule` 预注册块（T0 前推送，T0 之后不改）；本记录的结论块由契约测试复算。

## 1. 范围与口径

问题：第三方插件的宿主半边能否注入宿主的 `sessionController`，并把一次会话 turn 驱动到可读的终态；创建、投递、读状态、取消各自的确切输入、输出与失败形态是什么。这决定 #140 能否把 `ExecutionProvider` 的 `startRun`、`getRun`、可选 `cancelRun` 落在宿主会话上。

**证据强度**。只有 S3 参与结论；M 行（§4）是 S1，只作机制说明。

| 级 | 定义 |
|---|---|
| S0 | 未尝试，或在子预算内没有得到结果 |
| S1 | 静态读到服务键、符号或文件角色 |
| S2 | 在普通 Node 进程或假 `ctx` 里实测 |
| S3 | 在经 `dsh plugin --profile web add` 装入一次性 `DSH_HOME` 的探针里实测，宿主由发行版 `0.2.0-rc.2` 的 `dsh web` 启动（首选 Desktop 安装的 `dsh`；回退用同一发行版的 npx 运行时，须记入 §5 捷径台账） |

**观测级**。R1 不发 prompt；R2 不提供任何密钥，模型端点指向回环 sink，turn 在进程内失败；R3 用本次生成的假密钥，模型端点指向回环 stub。R4（真实模型）与 `desktop` profile 不在本记录，见 §9。

**观测集与结论**。观测项 O-ID 分三组，由预注册固定：

- `CORE`：O0.1、O0.2、O1.1、O1.2、O2.1、O2.2；
- `IMPLEMENT`：O3.1、O3.2；
- `NON_DECISIVE`：O4.1、O4.2、O4.3、O4.4（幂等、失败形态、空闲取消、重启冷读，是 #140 的设计输入，不决定结论）。

一行「计入」当且仅当结果为「已观测到」、强度为 S3，且 §5 捷径台账里没有「影响判定 = 是」的行列出它。`CORE` 有任一行不计入，结论是 `move-after-demo`；否则 `IMPLEMENT` 全部计入是 `implement`，其余是 `narrow`，并在「缺项」里列出不计入的行。「插件可达」当且仅当 O0.1 与 O0.2 都计入。结论只写进本记录与 PR；改 #140 的验收范围、解除 blocked-by、改看板 `Status` 由人类伙伴决定。

**术语**。`$HOST_RUNTIME` 是本机 npx 缓存里同一发行版的 `@deepseek-ai/*` 安装根，只用于静态取证（Desktop 应用包内的 `.d.ts` 被剥掉）；`<scratch>` 是观测用的一次性根目录。两者的真实路径都不入库。

## 2. 观测环境

- 预注册：`8909c5ed84f1437d1edbd2978ff64457aede3a37` @ 2026-10-15T02:46:26Z
- T0：2026-10-15T05:37:25Z

预注册提交的 `%aI` 是 2026-10-15T10:46:26+08:00，draft PR #343 的 `createdAt` 是 2026-10-15T02:47:37Z，都早于 T0；`session-rule` 块自预注册提交起逐字节未改。T0 取窗口 S-D 开始时 `touch` 的 `marker` 时刻（`t0.txt`）；窗口在 2026-10-15T05:39:20Z 收尾核对完成时结束，共 1 分 55 秒，预注册的总预算是 8 个工作小时，没有耗尽任何子预算，也没有申请延期。R3 在观测前经人类伙伴批准（见 ExecPlan 的 `Progress`）。

| 项 | 值 |
|---|---|
| 宿主版本 | `0.2.0-rc.2` |
| 来源一 | `dsh --version` 经守卫脚本（2026-10-15T05:37:38Z）：`0.2.0-rc.2` |
| 来源二 | `npm view @deepseek-ai/dsh dist-tags --json`（2026-10-15T05:37:39Z）：`latest`、`next` 为 `0.2.0-rc.2`，`alpha` 为 `0.2.1-alpha.3` |
| 来源三 | `PlistBuddy -c 'Print :CFBundleShortVersionString'` 读 Desktop 应用包的 `Info.plist`（2026-10-15T05:37:40Z）：`0.2.0-rc.2` |
| 启动器 | Desktop 应用包内的 `runtime/cli/bin/dsh`（`PATH` 上的 `dsh` 是指向它的符号链接）；`plugin add` 用 Desktop 自带的 pnpm 11.7.0 |

### 2.1 启动方式、守卫与环境白名单

- 所有宿主命令只经守卫脚本 `dsh_s.sh`：要求 `SCRATCH` 等于其 realpath、且不是家目录或真实数据根；`env -i` 清空环境后只放 `PATH=/usr/bin:/bin`、`HOME`、`TMPDIR=<scratch>/tmp`、`DSH_HOME=<scratch>/home`、`DSH_TELEMETRY_DISABLED=1`、`HP_PROBE_SCRATCH=<scratch>`，再加按模式给的额外环境；工作目录恒为 `<scratch>`（不是仓库根），不会读到任何 `.env`。
- 额外环境：`core` 与 `restart` 为 `HP_PROBE_MODE` 与指向回环 sink 的 `DEEPSEEK_BASE_URL`，不提供任何密钥；`stub` 为 `HP_PROBE_MODE`、指向回环 stub 的 `DEEPSEEK_BASE_URL`，以及 `DEEPSEEK_API_KEY`（本次生成的假密钥，只在该进程环境里，不写文件、不入库，观测后 `unset`）。
- 命令：安装 `dsh_s.sh -- plugin --profile web add <scratch>/hp-session-probe-0.0.0.tgz`；启动 `dsh_s.sh HP_PROBE_MODE=<模式> DEEPSEEK_BASE_URL=<回环端点> -- web --no-open --port 0`。只用 `web` profile，不打开浏览器；没有使用 `allow-version`、`--accept-risk`、npx 运行时与 `PATH` 垫片。
- 守卫（预注册 §2.5 第 3 条）：

| 守卫 | 读数 |
|---|---|
| R2 前 `credentials.describe('DEEPSEEK_API_KEY')` 报 `configured: true` | 未触发：`core` 与 `restart` 的就绪行都是 `{ configured: false }` |
| R2 的 sink 收到任何请求 | 未触发：`sink.log` 0 行（§5 H3） |
| R3 的 stub 记录的 `keySha8` 与事先写下的不一致 | 未触发：4 条请求记录全部一致（§5 H4） |
| prompt 步骤期间宿主进程出现新的非回环 TCP 连接 | 未触发（§5 H5；采样只有秒级精度，排除外联主要靠 H1、H3、H4） |
| 真实数据根或 `<Documents>/deepseek-harness` 下出现比 marker 新的条目 | 未触发（§5 H6、H7） |

### 2.2 探针

手写 JS 插件包 `hp-session-probe@0.0.0`，只有宿主半边，源文件不入库。manifest：`type: module`；`peerDependencies` 只有 `@deepseek-ai/dsh-api-session-controller: ~0.2.0-rc.2`，无 `dependencies`；`dsh.manifestVersion: 1`，`dsh.bundle.patch: ./cordis.patch.yml`，补丁只有一条 `insert`（`id` 与 `name` 都是 `hp-session-probe`）；`lib/index.js` 导出 `inject: ['sessionController', 'credentials']` 与 `apply(ctx)`，不 import 任何包；打包只含 `package.json`、`cordis.patch.yml`、`lib/index.js`。探针按 `HP_PROBE_MODE`（`core`、`restart`、`stub`）执行下面的步骤，订阅 `api-session/status`，每步写一行 JSON，写之前按 §8 的规则投影。

### 2.3 各模式的步骤

`<sid>` 是 O1.1 返回的 `sessionId`，`<unknown>` 是 `session-00000000-0000-4000-8000-000000000000`；prompt 文本都是 `hp-session-probe: reply with OK only. Do not call tools.`，下表写作 `<文本>`。每个等待都有上限（60 s 或 30 s），超时写 `probe/timeout` 行后继续；本次三次运行都没有超时。

`core`（R2，sink）：

| 序 | O-ID | 调用 |
|---|---|---|
| 1 | O0.2 | 就绪行：五个方法的 `typeof`，`ctx.credentials.describe('DEEPSEEK_API_KEY')` 的 `{ configured, source }` |
| 2 | O1.1 | `create({ cwd: '<scratch>/work' })` |
| 3 | O1.2 | `prompt({ requestId: 'hp-req-core-1', sessionId: <sid>, mode: 'queue', content: [{ type: 'text', text: <文本> }] }, signal)` |
| 4 | O4.1 | 与第 3 序完全相同的请求再发一次 |
| 5 | O2.1、O2.2 | 每 250 ms `inspect(<sid>, signal)` 直到出现 `turn/end` 或 60 s；`api-session/status` 回到 `false` 后读一次 `list({}, signal)`，再读一次 `inspect(<sid>, signal)`，这两次是记入观测表的读数 |
| 6 | O4.3 | `cancel({ sessionId: <sid> })`，2 s 后 `inspect(<sid>, signal)`，并记取消前后未投影的事件总数 |
| 7 | O4.2 | `create({ cwd: '<scratch>/work', workspaceId: 'hp-none' })`；`prompt({ requestId: 'hp-req-blank', sessionId: <sid>, mode: 'queue', content: [{ type: 'text', text: '   ' }] }, signal)`；对 `<unknown>` 的 `prompt`（`requestId: 'hp-req-unknown'`）、`inspect`、`cancel` |
| 8 | — | `<sid>` 写入 `<scratch>/obs/core-session.txt`，打 `done` |

`restart`（R2，sink；同一 `DSH_HOME`，上一个宿主进程已 `kill -TERM` 退出）：就绪行（O0.2）；`inspect(<sid>, signal)`、`cancel({ sessionId: <sid> })`、`list({}, signal)`（O4.4，`<sid>` 读自 `core-session.txt`）；`done`。

`stub`（R3，stub）：就绪行（O0.2，`credential` 为 `{ configured: true, source: 'env' }`）；`GET /__hp/mode?m=reply`；O3.1 `create({ cwd: '<scratch>/work' })`、`prompt({ requestId: 'hp-req-reply-1', … })`，轮询 `inspect` 到 `turn/end` 或 60 s，再各读一次 `list({}, signal)` 与 `inspect`；`GET /__hp/mode?m=hold`；O3.2 `create`、`prompt({ requestId: 'hp-req-hold-1', … })`，等到该会话 `api-session/status` 为 `true` 且 `GET /__hp/state` 的 `held` 不小于 1（上限 30 s），`cancel({ sessionId })`，轮询 `inspect` 到 `turn/end` 或 30 s，再各读一次 `list` 与 `inspect`；`done`。

### 2.4 时间来源与证据处理

- 探针每步写一行 JSON，`at` 取自 `new Date().toISOString()`；§3 的时间取这些行的 `at` 截到整秒。安装与版本读数取 `date -u +%FT%TZ`。
- 宿主流里 `dsh web: ` 行带访问令牌，原文不读、不打印、不入库。协调者只把 `grep -F '"probe":"hp-session-probe"'` 过滤出的探针行（`core` 18 行、`restart` 5 行、`stub` 16 行）交给本记录的撰写者，路径已换成占位。探针行与 `dsh web: ` 行都走 stdout；stderr 里没有探针行与 `dsh web: ` 行，三次运行各只有 2 行 Node 弃用警告（DEP0180，按行数与模式计数核对，没有令牌或地址）。
- 尝试记录：三个模式各运行一次，没有重试，所以观测行没有被替换掉的旧尝试。

## 3. 观测表

十二个预注册 O-ID 各恰好一行；「判据」列是预注册块里该 O-ID 的判据原文（含其中的命令写法，只折叠空白），由契约测试逐行比对，不是改写；时间取自日志（探针的 `at` 截到整秒，或 `date -u`），不手打；读数写在表后的观测摘录，按 ID 对应。步骤与确切请求对象见 §2.3。

| ID | 问题 | 判据 | 命令或动作 | 结果 | 强度 | 时间（UTC） |
|---|---|---|---|---|---|---|
| O0.1 | 第三方插件能否装入一次性 profile 而不绕开兼容闸门 | `dsh plugin --profile web add <scratch>/hp-session-probe-0.0.0.tgz` 退出码 0（数字退出码写进归档日志），未使用 `allow-version` 或 `--accept-risk` | `dsh_s.sh -- plugin --profile web add <scratch>/hp-session-probe-0.0.0.tgz`；退出码与 `date -u` 写入 `install.log` | 已观测到 | S3 | 2026-10-15T05:37:53Z |
| O0.2 | 宿主启动后，插件的宿主半边能否拿到会话控制器的五个方法 | 宿主启动后探针打出就绪行，其中 `create`、`prompt`、`cancel`、`list`、`inspect` 五个成员的 `typeof` 都是 `function` | `dsh_s.sh HP_PROBE_MODE=core DEEPSEEK_BASE_URL=<sink> -- web --no-open --port 0`；探针就绪行 | 已观测到 | S3 | 2026-10-15T05:38:11Z |
| O1.1 | 能否在指定 cwd 创建会话 | `create({ cwd: '<scratch>/work' })` 返回以 `session-` 开头的 `sessionId` | `ctx.sessionController.create({ cwd: '<scratch>/work' })` | 已观测到 | S3 | 2026-10-15T05:38:11Z |
| O1.2 | 能否向该会话投递一个 prompt | 随后 `prompt({ requestId, sessionId, mode: 'queue', content: [一段文本] })` 返回 `{ accepted: true }` | `ctx.sessionController.prompt({ requestId: 'hp-req-core-1', sessionId, mode: 'queue', content: [文本] }, signal)` | 已观测到 | S3 | 2026-10-15T05:38:11Z |
| O2.1 | 运行状态能否读到 | 60 s 内该会话的 `api-session/status` 先报 `true` 后报 `false`，之后 `list({})` 里该行 `running: false` | 订阅 `api-session/status`；`ctx.sessionController.list({}, signal)` | 已观测到 | S3 | 2026-10-15T05:38:11Z |
| O2.2 | 终态能否读到 | 同一窗口内 `inspect(sessionId)` 的事件含 `turn/start` 与一条带 `reason.kind` 的 `turn/end` | `ctx.sessionController.inspect(sessionId, signal)` | 已观测到 | S3 | 2026-10-15T05:38:11Z |
| O3.1 | 成功运行（`completed`）能否读到 | stub 为 `reply` 时，新会话 create + prompt 后 60 s 内 `inspect` 读到 `turn/end` 且 `reason.kind = completed`，`list` 该行 `running: false` | `GET /__hp/mode?m=reply`；`create` + `prompt({ requestId: 'hp-req-reply-1', … })`；轮询 `inspect`，再读 `list` | 已观测到 | S3 | 2026-10-15T05:38:54Z |
| O3.2 | 运行中取消能否生效并读到 | stub 为 `hold` 时，新会话 create + prompt，观测到该会话 `api-session/status` 为 `true` 且 stub 正持有请求后 `cancel({ sessionId })` 返回 `{ accepted: true }`；30 s 内 `inspect` 读到 `turn/end` 且 `reason.kind = aborted`、`reason.reason.kind = user`，`running` 回到 `false` | `GET /__hp/mode?m=hold`；`create` + `prompt({ requestId: 'hp-req-hold-1', … })`；status 为 `true` 且 `held` 不小于 1 后 `cancel({ sessionId })` | 已观测到 | S3 | 2026-10-15T05:38:55Z |
| O4.1 | `requestId` 是否幂等 | 同一 `requestId` 再发一次 prompt 返回 `{ accepted: true }`，`inspect` 里带该 `rpcId` 的用户消息恰好 1 条 | 与 O1.2 完全相同的 `prompt` 再发一次；探针对未投影事件计数 | 已观测到 | S3 | 2026-10-15T05:38:11Z |
| O4.2 | 五种失败的确切形态 | 记录五种失败的确切形态：`create` 同时给 `workspaceId` 与 `cwd`；空白内容 prompt；对未知会话 prompt；对未知会话 `inspect`；对未知会话 `cancel` | `create({ cwd, workspaceId: 'hp-none' })`；`prompt` 内容 `'   '`；对 `session-00000000-0000-4000-8000-000000000000` 的 `prompt`、`inspect`、`cancel` | 已观测到 | S3 | 2026-10-15T05:38:13Z |
| O4.3 | 对已结束、仍附着的会话 `cancel` 会怎样 | 对已结束、仍附着的会话 `cancel`：记录返回值与之后事件数是否变化 | `cancel({ sessionId })`，2 s 后 `inspect`，比较未投影的事件总数 | 已观测到 | S3 | 2026-10-15T05:38:13Z |
| O4.4 | 宿主重启后冷读与取消会怎样 | 宿主重启后，对 O1.1 的会话 `inspect` 冷读仍返回原来的 `turn/end`，`cancel` 抛 `session/not-found` | `dsh_s.sh HP_PROBE_MODE=restart DEEPSEEK_BASE_URL=<sink> -- web --no-open --port 0`；`inspect`、`cancel`、`list` | 已观测到 | S3 | 2026-10-15T05:38:34Z |

### 3.1 观测摘录

下面的读数都出自过滤后的探针行与 `install.log`。写作 `.nnn` 的是探针 `at` 的毫秒部分，秒数以各条写明的时刻为准；事件序号 `seq` 是宿主的，投影只保留了部分事件，所以序号不连续（O4.3 记的未投影事件总数是 19）。会话缩写：核心会话 `session-fe511a9a-…`（`core`、`restart`）、回复会话 `session-d8f2d1b5-…`、持有会话 `session-b8c33df0-…`，完整 id 在夹具里。

- **O0.1**：`install.log` 末两行是 `exit=0` 与 `2026-10-15T05:37:53Z`；pnpm 11.7.0 输出 `Packages: +1`；首行记录 `web` profile 在一次性 `DSH_HOME` 下被初始化。日志里另有一行 peer 依赖警告（`Issues with peer dependencies found`），退出码仍是 0。成因可由一次性 profile 的锁文件静态回答：`autoInstallPeers` 为 `false`，profile 唯一的依赖是探针 tarball，锁里记着探针声明的 peer `@deepseek-ai/dsh-api-session-controller: ~0.2.0-rc.2`，而 profile 里没有安装任何宿主包（宿主包来自宿主运行时），所以这是普通的缺 peer 警告，不带版本信号。因此 O0.1 字面成立的只是「未用 `allow-version` 或 `--accept-risk` 即装入」，不证明兼容闸门比对过 peer 范围，见 §9。
- **O0.2**：三次运行的就绪行里五个方法的 `typeof` 都是 `function`（`core` 05:38:11Z、`restart` 05:38:34Z、`stub` 05:38:54Z）；表里取 `core` 一次。`credential`：`core` 与 `restart` 是 `{ configured: false }`（没有 `source` 字段），`stub` 是 `{ configured: true, source: 'env' }`。
- **O1.1**：`create({ cwd: '<scratch>/work' })` 返回 `{ sessionId: 'session-fe511a9a-…' }`（05:38:11.444）。三个会话的 id 都以 `session-` 开头，后接 UUID。
- **O1.2**：`prompt` 返回 `{ accepted: true }`（05:38:11.452），比 `create` 返回晚 8 ms。
- **O2.1**：核心会话的顺序是 `create` 返回（.444）、`api-session/status` 报 `true`（.447）、`prompt` 返回（.452）、status 报 `false`（.848）；之后 `list({})` 的行是 `{ running: false, agentAvailable: true, blank: false }`（.967）。三个会话（核心、回复、持有）都是 `create` 返回、status `true`、`prompt` 返回这个日志顺序，即 `running: true` 的事件在 `prompt` 调用返回之前到达。`list` 里 `running: true` 没有被单独读到（`list` 只在 turn 结束后读）。
- **O2.2**：核心会话的 `inspect`（.967）依次是 `turn/start`（seq 4）、`step/start`（7）、`user/message`（9，`rpcId` 为 `hp-req-core-1`）、`step/end`（17）、`turn/end`（18），其 `reason` 是 `{ kind: 'error', error: { code: 'MISSING_CREDENTIAL' } }`：R2 不给密钥，turn 在进程内失败，sink 没有收到请求。
- **O3.1**：回复会话（05:38:54）：create .201，status `true` .204，prompt 返回 .210，status `false` .484，`list` .738（`running: false`），`inspect` .739：`turn/start`（4）、`step/start`（6）、`user/message`（8，`rpcId` 为 `hp-req-reply-1`）、`step/end`（17）、`turn/end`（18，`reason: { kind: 'completed' }`）。
- **O3.2**：持有会话：05:38:54 的 create .745，status `true` .746，prompt 返回 .748；05:38:55 的 stub `held` 为 2（探针记的 `note`，.007）；`cancel` 返回 `{ accepted: true }`（.008）；status `false` 在 .010；`list` 与 `inspect` 在 .265：两个会话行都是 `running: false`，`inspect` 的 `step/end` 是 seq 18、`turn/end` 是 seq 19，`reason` 为 `{ kind: 'aborted', reason: { kind: 'user' } }`。`held: 2` 是 stub 同时持有的请求数，首个 prompt 可能另发标题请求（M10）；stub 只记字节数，两个字节数量级与「主请求加附带请求」相符（H4），但请求类型没有被区分。
- **O4.1**：第二次相同请求在 05:38:11.453 返回 `{ accepted: true }`；探针对未投影事件里 `source.rpcId` 为 `hp-req-core-1` 的用户消息计数，结果 `userMessages: 1`。
- **O4.2**（05:38:13.969 到 .972；`details` 为 `{}` 等宿主原值，`remote` 表示 `isDSHRemoteError`）：

| 调用 | `code` | `message` | `details` | `remote` |
|---|---|---|---|---|
| `create`，同给 `workspaceId` 与 `cwd` | `gateway/bad-request` | `session.create accepts workspaceId or cwd, not both` | `{}` | `true` |
| `prompt`，内容 `'   '` | `gateway/bad-request` | `prompt content must include non-whitespace text or an attachment` | `{}` | `true` |
| `prompt`，未知会话 | `session/not-found` | `session "<unknown>" not found` | `{ sessionId }` | `true` |
| `inspect`，未知会话 | `Error`（宿主的错误没有字符串 `code`，探针取了 `name`） | `session "<unknown>" not found` | 无（探针记 `null`） | `false` |
| `cancel`，未知会话 | `session/not-found` | `session "<unknown>" not found (not attached)` | `{ sessionId }` | `true` |

- **O4.3**：核心会话已出 `turn/end` 且仍附着（`agentAvailable: true`）时，`cancel` 返回 `{ accepted: true }`（05:38:11.968）；2 s 后 `inspect` 的事件与取消前逐项相同，未投影事件总数 19 前后不变。
- **O4.4**：宿主重启后（`restart` 模式，05:38:34）核心会话的 `inspect` 冷读返回与重启前相同的五个事件，含 `turn/end`（seq 18，`error` / `MISSING_CREDENTIAL`）；`cancel` 抛 `session/not-found`，消息 `session "<sid>" not found (not attached)`，`remote` 为 `true`；`list` 里该行是 `{ running: false, agentAvailable: false, blank: false }`。

### 3.2 尝试记录

三个模式各运行一次，没有重试、超时或中断；观测表的每一行就是唯一一次尝试。`core` 的 O0.2 就绪行在 `restart` 与 `stub` 里重复出现（读数一致），表里取 `core` 的那一行，因为预注册的步骤表把 O0.2 放在 `core` 第 1 序。

## 4. 静态机制证据

均为 S1，不带 O-ID，不参与推导；M17 是 O4.2 之后补查的，时间晚于 T0，只解释观测。宿主路径写 `$HOST_RUNTIME/…`；仓库侧事实（M13–M15）带 base `21cb29eb`，免得 #132 合并后读成当前事实。

| # | 事实 | 命令或代码路径 | 结果 | 时间（UTC） |
|---|---|---|---|---|
| M1 | 发行版与三处版本来源 | `npm view @deepseek-ai/dsh dist-tags --json`；`PlistBuddy -c 'Print :CFBundleShortVersionString'` 读 Desktop 应用包的 `Info.plist`；asar 头读取器取包内 `dsh/desktop-runtime.json` | `latest`、`next` 为 `0.2.0-rc.2`，`alpha` 为 `0.2.1-alpha.3`；应用与包内 `release.version` 都是 `0.2.0-rc.2`，`hostProtocolVersion` 为 4，内嵌 Node 24.18.1、pnpm 11.7.0 | 2026-10-15T03:01:23Z |
| M2 | Desktop 包与 `$HOST_RUNTIME` 同码 | 五个包 `lib/index.js` 的 sha256 前 16 位：Desktop 侧用 asar 头读取器取 `dsh/node_modules/@deepseek-ai/<包>/lib/index.js`，另一侧 `shasum -a 256` | 逐包相同：`dsh-api-session-controller` `fb0f7b96130f595d`、`dsh-session` `87ea85e2fb5318bf`、`dsh-agent` `7b9aa39474de8311`、`dsh-llm-deepseek-api-key` `71688fb743a3187e`、`dsh-credentials-local` `1688f17801d5809a` | 2026-10-15T03:01:23Z |
| M3 | 会话控制器是一个 Cordis 服务键，由 Web 应用在根级装入 | `sed -n 2847p $HOST_RUNTIME/dsh-api-session-controller/lib/index.js`；`sed -n 15,20p $HOST_RUNTIME/dsh-api-session-controller/lib/types/index.d.ts`；`sed -n 121,122p $HOST_RUNTIME/dsh-web-app/cordis.patch.yml`；Desktop 包 `dsh-desktop-host/lib/index.js` 的 `runProfile` | `super(ctx, "sessionController", { namespace: "session" })` 注册服务键 `sessionController`，类型以模块增补声明；`dsh-web-app` 的根级 `insert` 装 `session-controller`；`desktop` profile 经同一个 Web 应用启动（`main()` 调 `runProfile` 且 `profile: "desktop"`）。第三方插件能否注入它，只有 O0.2 回答 | 2026-10-15T03:01:23Z |
| M4 | 方法与签名 | `grep -n` 方法名于 `$HOST_RUNTIME/dsh-api-session-controller/lib/types/index.d.ts`；`sed -n 2939,2946p` 于 `…/lib/index.js`；`sed -n 311p $HOST_RUNTIME/dsh-session-query/lib/index.js` | `resolveAgent`:66、`inspect`:73、`list`:80、`create`:93、`prompt`:163、`cancel`:181、`page`:188、`follow`:196、`projections`:203。`list(request, signal)` 与 `prompt(request, signal)` 要 `signal`，`cancel(request)` 同步，`list` 返回 `{ items }`。`inspect` 不激活 Agent：已附着时读内存，否则冷读持久化日志，返回 `{ meta, inheritedEventCount, events }`；找不到时，内层查询抛 `SessionQueryError`（code `SESSION_QUERY_SESSION_NOT_FOUND`），不是 `RemoteError`；控制器对外抛出的最终形态见 M17 | 2026-10-15T03:01:23Z |
| M5 | `create` 的入参与默认值 | `sed -n 687,694p $HOST_RUNTIME/dsh-api-session-controller/lib/index.js`；`sed -n 2850p` 于同文件 | `workspaceId` 与 `cwd` 同时给抛 `RemoteError('gateway/bad-request')`；未给 `sessionId` 时生成 `session-<uuid>`；两者都不给时用宿主进程的 `process.cwd()`；返回 `{ sessionId }`，配置了 Agent 预设时另带 `agentPreset` | 2026-10-15T03:01:23Z |
| M6 | `prompt` 的回执只是入 inbox，不是执行完成；幂等；不检查模型 | `sed -n 850,855p $HOST_RUNTIME/dsh-api-session-controller/lib/index.js`；`sed -n 328,331p …/lib/types/types.d.ts`；`grep -n 'catalog availability gate' $HOST_RUNTIME/dsh-api-session-controller/README.md` | 空内容抛 `gateway/bad-request`；同一 `requestId` 已在 inbox 或日志里时直接返回 `{ accepted: true }`，不插入第二条消息；返回值注释是「prompt 进入 Agent inbox 后的回执」；README 写明 prompt 接纳不检查模型目录，缺凭据由执行阶段报告 | 2026-10-15T03:01:23Z |
| M7 | `cancel` 是同步的会话粒度操作 | `sed -n 994,1000p $HOST_RUNTIME/dsh-api-session-controller/lib/index.js`；`sed -n 153p $HOST_RUNTIME/dsh-agent/lib/types/runtime-types.d.ts` | Agent 未附着时抛 `session/not-found`；否则 `agent.cancel({ kind: "user" }, { keepInbox: true })` 并返回 `{ accepted: true }`。`dsh-agent` 的类型注释写明无活动时取消是 no-op、不预约后续工作。取消不指定某一次运行 | 2026-10-15T03:01:23Z |
| M8 | 状态与终态的形状 | `sed -n 159,170p $HOST_RUNTIME/dsh-api-session-controller/lib/types/types.d.ts`；`sed -n 2885p` 于 `…/lib/index.js`；`sed -n 163,207p $HOST_RUNTIME/dsh-session/lib/types/types.d.ts` | `SessionSummary` 有 `running`、`agentAvailable`、`blank`；Agent 状态变化时宿主发 `api-session/status(sessionId, running)`。`turn/end.reason.kind` 有 `completed`、`aborted`（带 `reason`）、`blocked`、`error`（带 `error.code`）、`max-tokens`、`interrupted`、`forked`，注释写明可合并扩展；事件信封是 `{ type, seq, time, data }` | 2026-10-15T03:01:23Z |
| M9 | 缺凭据在执行阶段失败；端点只由 `DEEPSEEK_BASE_URL` 决定 | `sed -n 44,50p $HOST_RUNTIME/dsh-llm-deepseek-api-key/lib/index.js`；`sed -n 251,257p $HOST_RUNTIME/dsh-llm/lib/index.js`；`sed -n 15,20p $HOST_RUNTIME/dsh-credentials-local/lib/index.js`；`sed -n 56p` 与 `sed -n 62p` 于 `$HOST_RUNTIME/dsh-llm-deepseek/README.md` | `resolveAuth` 经 `credentials.resolve` 取密钥，取不到抛 `LlmError(…, 'MISSING_CREDENTIAL')`，此时尚未发请求；该码不在默认可重试码（`EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`）里。凭据查找顺序：启动环境、存储文件、调用者 cwd 的 `.env`、`$DSH_HOME/.env`。`baseURL` 取显式配置，否则 `$DEEPSEEK_BASE_URL`，否则官方根；`dsh-base` 与 `dsh-web-app` 的 profile 补丁都没有给 `baseURL`。流空闲超时 300000 ms | 2026-10-15T03:01:23Z |
| M10 | 首个 prompt 可能附带一次模型请求 | `sed -n 62,63p $HOST_RUNTIME/dsh-base/cordis.patch.yml` | `dsh-base` 装了 `session-title-llm`（`dsh-session-title-first-prompt-llm`），所以回环 stub 收到的请求数可能多于 prompt 数 | 2026-10-15T03:01:23Z |
| M11 | 遥测的关闭方式 | `sed -n 194,195p $HOST_RUNTIME/dsh-base/cordis.patch.yml`；`sed -n 44,61p $HOST_RUNTIME/dsh-web-app/cordis.patch.yml` | `DSH_TELEMETRY_DISABLED` 非空即关闭会话 OTel；产品埋点两行只在 profile 名为 `desktop` 时启用，所以观测用 `web` profile | 2026-10-15T03:01:23Z |
| M12 | 默认工作区目录只由宿主 UI 触发 | `grep -n 'Remote("initializeDefault")' $HOST_RUNTIME/dsh-api-workspace-controller/lib/index.js`；`grep -c '"initializeDefault"' $HOST_RUNTIME/dsh-api-session-controller/lib/index.js` | `initializeDefault` 是工作区控制器的 Remote 方法，会话控制器不调用它；`create({ cwd })` 不走这条路径 | 2026-10-15T03:01:23Z |
| M13 | 观察于 base `21cb29eb`：执行域 port 与 core 降级 | `git show 21cb29eb:packages/capabilities/src/execution-provider.ts`；`git show 21cb29eb:packages/domain/src/enums.ts`；`git show 21cb29eb:packages/core/src/start-work.ts`；`git show 21cb29eb:tests/contract/suites/execution.js` | `ExecutionProvider` 只有 `startRun`、`getRun`、可选 `cancelRun`，没有 reconcile；`ExecutionRunStatus` 八个取值（`enums.ts:52-55`）；没有主执行 provider 时走 `manualFallback`，结果不确定记 `unknown`（`start-work.ts:272-326`）；契约套件期望 `seededRunExternalId`、`runningRunExternalId`；`packages/providers/execution-harness` 只有包骨架，依赖只有 domain 与 capabilities | 2026-10-15T03:01:23Z |
| M14 | 观察于 base `21cb29eb`：Host 入口、安装件 peer 与分支引用 | `git show 21cb29eb:apps/harness-plugin/src/host.ts`；`git show 21cb29eb:apps/harness-plugin/scripts/build.mjs`；`git show 21cb29eb:packages/capabilities/src/development-provider.ts` | Host 入口的顶层 `inject` 在 `host.ts:9`，工厂接口在 `host.ts:13-15`；产品安装件的 `dsh-*` peer 统一为 `~0.2.0-rc.2`（`build.mjs` 的 `HOST_DSH_PEER_RANGE`），没有 `dsh-*` peer 时兼容闸门直接放行；`ProviderChangeRequest.headBranch` 在无法精确解析为本仓库分支时为 `undefined`（`development-provider.ts:56-57`） | 2026-10-15T03:01:23Z |
| M15 | 观察于 base `21cb29eb`：夹具惯例 | `git show 21cb29eb:tests/contract/fixtures/github-projects/replay.js` | 夹具是 `{ provenance, exchanges }`，保留 provider 原始 id，回放键是 `[operationName, 按键排序的 variables]`，回放 helper 与其消费者同 PR 落地 | 2026-10-15T03:01:23Z |
| M16 | Cordis 没有可选注入 | `sed -n 71,87p`、`sed -n 138,146p` 于 `$HOST_RUNTIME/cordis/src/registry.ts` 与 `…/src/fiber.ts`；`sed -n 166,172p`、`sed -n 300,301p` 于 `$HOST_RUNTIME/cordis/src/registry.ts` | `Inject` 只有数组与对象两种形式，全是必需依赖；插件在全部所需服务出现前停在 `PENDING`；`ctx.inject(deps, cb)` 是 `ctx.plugin({ inject, apply: cb })` 的简写，回调在所需服务出现后运行、服务变化时卸载重跑。所以把 `sessionController` 加进顶层 `inject` 会让插件在没有该服务的宿主上整体不加载，嵌套的 `ctx.inject(['sessionController'], cb)` 只让那一段等待 | 2026-10-15T03:01:23Z |
| M17 | `inspect` 未知会话的对外错误形态（在 O4.2 观测之后补查，用来解释观测与 M4 的差异） | `grep -n 'ApiSessionNotFound' $HOST_RUNTIME/dsh-api-session-controller/lib/index.js`（定义在 `:85`，内层转换在 `:173`） | 控制器把内层的 `SessionQueryError`（code 为 `SESSION_QUERY_SESSION_NOT_FOUND`）改抛 `ApiSessionNotFound`，它是 `class extends Error {}`，没有 `code`，也不是 `RemoteError`；另外的调用路径把找不到改写成 `RemoteError('session/not-found')`（`:235`、`:793`）。这与 O4.2 的 S3 读数一致：`inspect` 未知会话的 `code` 缺失（探针取 `name` 得 `Error`）、`remote` 为 `false`，另外四种失败都是 `RemoteError` | 2026-10-15T05:45:07Z |

## 5. 捷径台账

只列实际采用的捷径；预注册里未被采用的行（`allow-version` 或 `--accept-risk`、npx 回退、假 `ctx`）不进台账。执行中没有出现需要追加的新捷径。「影响的 O-ID」逐个列出该捷径涉及的观测；是否改变其所问的会话接口事实以「影响判定」为准，推导只读判定为「是」的行，本次没有。

| 捷径 | 影响的 O-ID | 影响判定 | 理由 |
|---|---|---|---|
| 手写 JS 探针，只有宿主半边 | O0.1、O0.2、O1.1、O1.2、O2.1、O2.2、O3.1、O3.2、O4.1、O4.2、O4.3、O4.4 | 否 | 问的是会话接口能否被插件调用，不是构建产物 |
| R2 端点指向回环 sink、不给密钥 | O0.2、O1.1、O1.2、O2.1、O2.2、O4.1、O4.2、O4.3、O4.4 | 否 | 会话生命周期由宿主驱动，模型调用在进程内失败（O2.2 的 `MISSING_CREDENTIAL`） |
| R3 回环 stub 加本次生成的假密钥 | O3.1、O3.2 | 否 | 同上；真实模型成功路径另记 TD-066 |
| 用 `web` profile 而不是 `desktop` profile | O0.1、O0.2、O1.1、O1.2、O2.1、O2.2、O3.1、O3.2、O4.1、O4.2、O4.3、O4.4 | 否 | 会话控制器同一份代码；`desktop` profile 经同一个 Web 应用启动（M3） |

### 5.1 附带写入与收尾核对（H 行）

只记计数与结论，不记路径；`marker` 是 T0 的 `touch`。

| H | 核对 | 命令或来源 | 读数 | 时间（UTC） |
|---|---|---|---|---|
| H1 | 组合后的 profile 没有显式 `baseURL` | `dsh_s.sh -- --profile web --dump-config \| grep baseURL` | 无输出：端点只由 `DEEPSEEK_BASE_URL` 决定（M9） | 2026-10-15T05:37:53Z（第 3 步） |
| H2 | 凭据守卫 | 探针就绪行的 `ctx.credentials.describe('DEEPSEEK_API_KEY')` | `core`、`restart`：`{ configured: false }`；`stub`：`{ configured: true, source: 'env' }`（预期，假密钥在进程环境里） | 2026-10-15T05:38:11Z、05:38:34Z、05:38:54Z |
| H3 | sink 计数 | `sink.log` 行数 | 0（`core` 与 `restart` 结束后各核对一次） | 2026-10-15T05:38:15Z、05:38:36Z |
| H4 | stub 的 `keySha8` | `stub.log` 每行 `keySha8` 与事先写下的假密钥摘要比较 | 4 行，全部 `POST /v1/messages`，`keySha8` 全部一致（摘要不入库）；持有会话占其中 2 个（O3.2 的 `held: 2`）。每行的 `bytes` 两两成对：回复会话 170738 与 110969（05:38:54.474、.486），持有会话 170736 与 110967（05:38:54.875、.876），即每个会话一个约 17 万字节、一个约 11 万字节的请求；这与「主请求加一个附带请求（M10 的标题请求）」相符，是推断，请求类型没有被确认 | 2026-10-15T05:38:56Z |
| H5 | 新的非回环 TCP 连接（旁证，弱于行名） | 每次运行期间 `lsof -nP -a -p <宿主 pid> -iTCP -sTCP:ESTABLISHED`，共 7 次秒级采样：`core` 05:38:09Z、05:38:14Z，`restart` 05:38:33Z、05:38:36Z，`stub` 05:38:52Z、05:38:54Z、05:38:56Z | `core`、`restart` 没有 `ESTABLISHED` 行；`stub` 的 6 行 `ESTABLISHED`（05:38:54Z 两行、05:38:56Z 四行）全部以回环 stub 为端点（地址不入库）。采样太稀：`core` 的 prompt 窗口（05:38:11.45 至 05:38:11.85）内没有采样点，`stub` 也没有每个 prompt 步骤前后各一对（计划的第 8 步要求，本次没有做到）。排除外联靠 H1（无显式 `baseURL`）、H3（sink 收到 0 个请求）、H4（stub 的 4 个请求 `keySha8` 全部一致），`lsof` 只是旁证 | 2026-10-15T05:38:09Z 至 05:38:56Z |
| H6 | 真实数据根的新条目 | `find "$HOME/.dsh" -newer "$SCRATCH/marker" -not -path '*/node_modules/*' \| wc -l` | 0 | 2026-10-15T05:39:20Z |
| H7 | Documents 的新条目 | `find "$HOME/Documents/deepseek-harness" -newer "$SCRATCH/marker" \| wc -l` | 0 | 2026-10-15T05:39:20Z |
| H8 | 用户级 pnpm 内容寻址库的新增数 | 比 `marker` 新的文件数（`v11` 与 `v10`） | `v11` 新增 7 个，全部可归因于探针 tarball（`tarball-integrity`、内容文件、`index.db`）；`v10` 0 个 | 2026-10-15T05:39:20Z |
| H9 | 本机监听端口 | `lsof -nP -iTCP -sTCP:LISTEN` 前后对比 | 前后都是 31 行，（命令，地址）集合无差异：本机真实实例的监听未被占用或改变 | 2026-10-15T05:39:20Z |
| H10 | 重装行为（非决定性） | 同路径同名同版本重新 `plugin --profile web add`，再 `remove` 后 `add`；数一次性 `DSH_HOME` 下的 `build-id` 文件 | 重新 `add` 退出码 0 但计数 0（被跳过）；`remove` 与再 `add` 退出码 0，计数 1：同名同版本须先 `remove` 再 `add` 才生效（`harness-host-spike.md` 记录的同名同版本重装被跳过，在 Desktop CLI 路线同样成立） | 2026-10-15T05:39:08Z |

## 6. 对 #140 的结论

下面三行由契约测试的 `deriveConsequence` 对 §3 与 §5 复算（用例「真实记录：结论块等于推导」），不手工挑选。

> 对 #140 的结论：`implement`
>
> 插件可达：是
>
> 缺项：无

推导过程，逐条对应预注册的 §2.3：

1. 十二个 O-ID 都是「已观测到」且强度 S3，§5 没有「影响判定」为「是」的行，所以十二行全部计入（第 1 条）。
2. O0.1 与 O0.2 都计入，插件可达为「是」（第 2 条）。
3. `CORE`（O0.1、O0.2、O1.1、O1.2、O2.1、O2.2）全部计入，不触发 `move-after-demo`（第 3 条）。
4. `IMPLEMENT`（O3.1、O3.2）全部计入，结论是 `implement`，缺项为「无」（第 4 条）。
5. 含义：按预注册，#140 实现 `startRun`、`getRun`、`cancelRun`。改 #140 的验收范围、解除 blocked-by、改看板 `Status` 由人类伙伴决定（第 7 条），本记录不做。

结论的适用范围：宿主 `0.2.0-rc.2`、`web` profile、回环 sink 与 stub（§5）；`completed` 与 `aborted` 来自回环 stub，不是真实模型（TD-066）。

## 7. 交给 #140 的事实

每条事实的强度以其依据为准：M 行是 S1，O 行以 §3 的强度为准（本次都是 S3）。映射表的来源列逐行写 O-ID 或 `S1`。

### 7.1 状态映射提案

两条轴：生命周期（`running`）与结果（`turn/end.reason.kind`）。`prompt` 的回执只表示入 inbox，所以「已接纳、尚无 `turn/start`」是 `starting`；取消在 ACP 里是一种结束原因而不是错误，所以 `aborted` 映射为 `canceled`；`turn/end.reason.kind` 可合并扩展，未观测到的取值和未知取值一律 `unknown`，不猜。`queued` 与 `timed_out` 没有宿主侧事实可对应，映射不产出。运行中途宿主崩溃会留下「有 `turn/start`、无 `turn/end`、`running: false`」的状态，它没有被观测（§9），也映射为 `unknown`，不能读成 `starting` 或 `running`。已观测到的结束原因只有三个：`completed`（O3.1）、`error`（O2.2，`error.code` 为 `MISSING_CREDENTIAL`）、`aborted`（O3.2，`reason.reason.kind` 为 `user`）。这是给 #140 的提案，#140 的契约套件拥有最终断言。

**行间优先级**。表里的条件分属两条轴，可能同时成立：O2.1 里 `running: true` 在 `prompt` 返回之前到达，所以「已接纳、尚无 `turn/start`」与「`running: true`」可以同时为真。为让每个宿主状态恰好映射到一个取值（#140 验收 4），按下面的次序取第一条成立的：

1. 有 `turn/end`：按它的 `reason.kind` 取结果轴的行，即使 `running` 仍为 `true`。
2. 否则 `running: true`：`running`。
3. 否则有 `turn/start`、无 `turn/end`、`running: false`：`unknown`。
4. 否则 `prompt` 已接纳：`starting`。

这个次序按每个会话只跑一个 turn 来写（多 turn 未观测，§9）；它和映射表一样是提案。

| 宿主状态 | ExecutionRunStatus | 来源 |
|---|---|---|
| `prompt` 已接纳、尚无 `turn/start` | `starting` | S1 |
| `running: true`（`api-session/status`；`list` 里的 `running: true` 未单独读到） | `running` | O2.1、O3.2 |
| 有 `turn/start`、无 `turn/end`，且 `running: false`（宿主在运行中途崩溃后会留下的状态；未观测） | `unknown` | S1 |
| `turn/end`，`reason.kind` 为 `completed` | `succeeded` | O3.1 |
| `turn/end`，`reason.kind` 为 `error` | `failed` | O2.2 |
| `turn/end`，`reason.kind` 为 `aborted` | `canceled` | O3.2 |
| `turn/end`，`reason.kind` 为 `blocked`、`max-tokens`、`interrupted`、`forked` 或未知取值 | `unknown` | S1 |

### 7.2 调用面与 Host 接缝

调用面是宿主进程里 `ctx.sessionController` 的 `create`、`prompt`、`cancel`、`list`、`inspect` 五个方法：仓库外插件的宿主半边声明 `inject: ['sessionController', 'credentials']`，经 `dsh plugin --profile web add` 装入后，五个方法都是 `function`（O0.1、O0.2，S3）。执行 provider 在宿主进程里，走浏览器侧 `ctx.remote.session` 会让 Client 成为执行事实的中转，违反「Host 拥有权威状态」，所以只作 S1；底层 `ctx.agents` 会绕开会话控制器的预设感知恢复策略与子 agent 归属栅栏。

接缝：将来的 `execution.harness` 目录条目，位于 `apps/harness-plugin/src/host-providers.ts` 的封闭目录（该目录与 ADR-0014 由 #132（PR #344）提出；本记录观察于 base `21cb29eb`，当时两者都还不在 main 上），经 `create(input)` 收到一个窄的会话 port，只含 #140 用到的方法。port 来自嵌套的 `ctx.inject(['sessionController'], cb)`，不进 Host 顶层 `inject`：Cordis 没有可选注入（M16），顶层加入会让插件在没有该服务的宿主上整体不加载。`packages/providers/execution-harness` 只依赖 domain 与 capabilities（M13），会话控制器只能由 Host 传入。任何取舍都写成对 ADR-0014 的 Proposed 修订；是否给 `create(input)` 的输入加会话 port 由 #140 决定，本记录不替它定。

### 7.3 启动、读取与取消

- 启动 = `create` + `prompt`：`create({ cwd })` 返回 `{ sessionId }`（`session-` 加 UUID），`prompt({ requestId, sessionId, mode: 'queue', content })` 返回 `{ accepted: true }`；回执只表示入 inbox，不是执行完成（O1.1、O1.2；M5、M6）。
- 读 = `inspect` + `list`：`inspect` 的 `turn/end` 给出结果，`list` 与 `api-session/status` 给出生命周期（O2.1、O2.2、O3.1、O3.2）。`inspect` 不激活 Agent，宿主重启后仍能冷读到原来的 `turn/end`（O4.4，该会话在重启前已结束）；重启后 `list` 行的 `agentAvailable` 为 `false`。`api-session/status` 的 `running: true` 在 `prompt` 调用返回之前到达（O2.1，三个会话都是如此），所以 `getRun` 不应依赖事件与调用返回的先后，以 `inspect` + `list` 的读数为准。
- 取消是会话粒度，不指定某一次运行；运行中取消（持有中的流）返回 `{ accepted: true }`，之后读到 `turn/end` 的 `aborted`、`reason.reason.kind` 为 `user`，`running` 回到 `false`（O3.2）。对已结束但仍附着的会话取消同样返回 `{ accepted: true }`、不新增事件（O4.3），所以返回值只表示请求已送达，不能当作「已取消」；`cancelRun` 要靠之后的 `inspect` 判结果。Agent 未附着（含宿主重启后；O4.4 的会话在重启前已结束，运行中途重启没有观测，见 §9）抛 `session/not-found`（O4.2、O4.4）。
- `requestId` 幂等：同一 `requestId` 再发一次返回 `{ accepted: true }`，用户消息仍恰好 1 条（O4.1）。
- 缺凭据是「启动成功、随后运行失败」：`prompt` 接纳不检查模型，`MISSING_CREDENTIAL` 在执行阶段以 `turn/end` 的 `error` 出现，sink 没有收到请求（O1.2、O2.2；M6、M9）。#140 若要在启动前快速失败，需自己先查凭据（O0.2 的 `credential.configured` 说明 `ctx.credentials.describe` 可用）。
- 失败形态不统一（O4.2）：`create` 同给 `workspaceId` 与 `cwd`、空白 prompt 是 `gateway/bad-request`；对未知会话的 `prompt`、`cancel` 是 `session/not-found`，且都是 `RemoteError`；对未知会话的 `inspect` 是没有 `code` 的普通 `Error`（`remote: false`，M17）。#140 的错误归类不能只看 `code`。
- prompt 内容会写进宿主会话日志（S1，M8 的事件信封；探针投影丢弃了事件的 `data`，内容是否落盘没有用 S3 验证）。`execution-provider.ts` 的实现义务 3（观察于 base `21cb29eb`，M13 同一文件）只规定 `command` / `environment` 是一次性输入、不得编进返回的引用或标记，理由是 `environment` 可能携带凭据材料；宿主会话日志同样是持久化，所以按同一理由 `environment` 也不得拼进 prompt。这是推论，不是该义务的原文，是否写成义务由 #140 决定。

### 7.4 会话推送远端

Harness 会话把分支推到哪个远端，本记录未观测（本 PR 不让会话执行工具）。端口约定 `ProviderChangeRequest.headBranch` 只对本仓库分支有值（M14，观察于 base `21cb29eb`）；#231 为 GitHub 研发 provider（`packages/providers/development-github`，base `21cb29eb` 上只有包骨架）设计的读取实现对 `isCrossRepository: true` 的 PR 给 `undefined`。所以 #140 必须把分支推到绑定仓库，推到 fork 的分支挂不上变更请求。

### 7.5 夹具回放键建议

回放键用 `[operation, 按键排序的 request]`，与 `github-projects` 夹具同构（M15）。请求里的 `requestId` 是探针写死的固定串（`hp-req-core-1`、`hp-req-reply-1`、`hp-req-hold-1` 等），`cwd` 用 `<scratch>` 占位，所以键稳定；`sessionId` 是录制时的原值，回放 port 要把 `create` 的返回值当作后续请求的句柄，不能把它写死在键里。同一个键可以出现多次，回放按出现顺序消费（夹具按录制时间升序），不能假设键唯一，也不能假设同键同结果。夹具里的重复键：`list({})` 出现 4 次（O2.1 在 `core`、O4.4 在 `restart`、O3.1 与 O3.2 在 `stub`，横跨 3 个宿主进程），4 次的结果各不相同（`agentAvailable` 与行数都不同，O3.2 的结果含两个会话行）；`create({ cwd })` 出现 3 次（O1.1、O3.1、O3.2），返回 3 个不同的 `sessionId`；`prompt` 的 `hp-req-core-1` 请求出现 2 次（O1.2 与 O4.1，逐字相同，结果相同）；对核心会话的 `inspect(<sid>)` 出现 3 次（O2.2、O4.3、O4.4，请求逐字相同，结果相同）；对核心会话的 `cancel({ sessionId })` 出现 2 次（O4.3 与 O4.4），请求逐字相同，结果却一个是 `{ accepted: true }`、一个是 `session/not-found`。

## 8. 夹具与投影规则

文件 `tests/contract/fixtures/harness-session/session-api.json`，对象，每个数组元素占一行：

- `provenance`：`record`、`host`、`hostVersion`、`launcher`、`surface`、`probe`、`recordedAt`、`projection`（`session-probe-v1`）、`placeholders`（`<scratch>` 是一次性根目录）。
- `exchanges`：`{ observation, operation, request, outcome }`。`operation` 只取 `create`、`prompt`、`cancel`、`list`、`inspect`；`outcome` 是 `{ ok: true, value }` 或 `{ ok: false, error: { code, message, details, remote } }`，`remote` 表示 `error.isDSHRemoteError === true`。
- `events`：`{ observation, event: 'api-session/status', sessionId, running }`。

投影在探针写日志之前完成，生成器只做挑选与排序、不手改：

- `inspect` 的 `value` 只保留 `events`，且只保留 `turn/start`、`turn/end`、`step/start`、`step/end`，以及 `source.kind` 为 `user` 的 `user/message`；每个事件只留 `seq`、`type`、`turn`、`reason`（`turn/end`：`{ kind, reason?: { kind }, error?: { code } }`）、`rpcId`（用户消息的 `source.rpcId`）。
- `list` 的 `value` 保持宿主的 `{ items }` 形状，只保留探针自己的会话行，每行只留 `sessionId`、`running`、`agentAvailable`、`blank`。
- `create` 的 `value` 只留 `sessionId`；`prompt` 与 `cancel` 的 `value` 是宿主原样返回的 `{ accepted }`。
- 会话 id 保留原值（随机 UUID，不是凭据或身份，保留才能与 `list`、`inspect` 交叉对应）；一次性根目录的真实值换成 `<scratch>`；时间戳（除 `provenance.recordedAt`）、端口、令牌、主机名、假密钥及其摘要一律不进夹具。
- prompt 的文本是探针自己写的固定串 `hp-session-probe: reply with OK only. Do not call tools.`，原样保留。

夹具由仓库外的生成器 `make-fixture.mjs` 读过滤后的探针行产出，不手改：带 `op` 为五个会话方法之一的行进 `exchanges`，`event` 为 `api-session/status` 的行进 `events`，按探针 `at` 升序排列；`ready`、`note`、`done` 行不进夹具；十二个 O-ID 都是「已观测到」，所以没有用 `--exclude`。本次夹具有 24 个 exchange 与 6 个状态事件，`provenance.recordedAt` 为 2026-10-15T05:38:55Z。生成器和探针一样不入库；重录夹具要重做 §2.3 的三次运行。

**夹具与 §3 的绑定**。契约测试对 §3 每个「已观测到 / S3」的行，在夹具里核对该 O-ID 判据中能投影进夹具的部分：例如 O2.1 的状态事件先 `true` 后 `false`、之后 `list` 里该行 `running: false`，O3.2 的 `cancel` 返回 `accepted: true`，O4.4 的 `cancel` 报 `session/not-found`。它还核对每个成功请求的 `sessionId` 都来自此前某次 `create` 的返回，并核对 §7.1 映射行的来源 O-ID 在夹具里有对应的结束原因或状态事件。O0.1 的证据是安装退出码，O0.2 的证据是 `ready` 行，按上面的规则都不进夹具，读数见 §3.1：

- 只由本记录证明的 O-ID：O0.1、O0.2

## 9. 未观测到清单与复核方法

| 未观测到 | 卡在哪 | 复核方法 |
|---|---|---|
| 真实模型下的成功路径与错误码（R4） | 消耗额度，要改真实环境，需要人类批准；`completed` 与 `aborted` 只来自回环 stub（TD-066） | #143 demo 门禁演练前经人类批准做 R4，并重跑 `IMPLEMENT` |
| `desktop` profile | 观测只用 `web` profile，避开产品埋点；两者经同一个 Web 应用启动，但没有在 `desktop` profile 上实测（TD-066） | 经人类批准在真实 Desktop 上重跑 O1.x 到 O3.x |
| 宿主版本漂移 | 只在 `0.2.0-rc.2` 上观测；`sessionController` 是 rc 宿主的服务键，未见文档承诺它是稳定的插件 API（`dsh-api-session-controller` 的 README 对稳定性没有表态），`alpha` 线已到 `0.2.1-alpha.3`（TD-065） | `latest` 越过 `0.2.0-rc.2` 或 #227 改 peer 范围时，重跑 `CORE` 与 `IMPLEMENT` 并重录夹具；#140 的 peer 精确钉住观测过的版本 |
| 浏览器侧 `ctx.remote.session` | 执行 provider 在宿主进程里，本记录不让 Client 成为中转，只有 S1（M3） | 不复核；若设计改为客户端调用，另开观测 |
| `follow`、`page`、`projections` | 宿主侧读取不需要流载体，`inspect` 与 `list` 已够；未观测 | #140 若需要增量读取，另做观测 |
| 运行中途宿主重启（turn 未结束）后的 `inspect` 与 `list` | O4.4 的重启发生在 turn 结束之后；运行中被杀的会话重启后是否留下 `turn/end`、`running` 是什么，没有观测 | #140 需要处理宿主崩溃时，另做一次「持有中杀宿主再重启」的观测 |
| 运行中的 `list`（`running: true`） | `list` 只在 turn 结束后读；`running: true` 只经 `api-session/status` 事件观测到 | #140 的 `getRun` 若依赖运行中的 `list`，在回放 port 之外补一次轮询观测 |
| `prompt` 的其他 `mode`、附件、同一会话的第二个 turn | 探针只用 `mode: 'queue'` 与一段文本，每个会话只跑一个 turn | #140 需要追加指令或多轮时另做观测 |
| 兼容闸门是否比对了探针 peer 的版本范围 | O0.1 只证明「未用 `allow-version` 或 `--accept-risk` 即装入」。安装日志里那行 peer 警告的成因已静态回答（§3.1 O0.1）：profile 的锁文件是 `autoInstallPeers: false`，唯一依赖是探针 tarball，宿主包不在 profile 里，所以是普通缺 peer 警告，不带版本信号；没有用不匹配的 peer 范围对照 | #227 改 peer 范围时，用不匹配的 peer 范围对照安装结果 |
| stub 收到的请求内容（标题请求与主请求的区分） | stub 只记方法、路径、`keySha8` 与字节数，不记正文；4 个请求与 2 个会话、`held: 2` 一致；字节数两两成对（每个会话一个约 17 万字节、一个约 11 万字节，H4），与「主请求加附带请求」相符，但请求类型未确认 | 真实模型的 R4 观测（TD-066）时一并区分 |
| 多会话并发、会话执行工具、推送到远端 | 本 PR 不让会话执行工具，也不并发起多个会话 | #140 的集成演练里观测 |
