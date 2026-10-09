# PR #301 MMP 评审记录

## 锁定事实

- PR #301「chore(repo): 将 @types/node 对齐到 Node 26 运行时」，Closes #299；base `main@78c3eb5b`，单提交 `58909701`，只改 `package.json` 与 `pnpm-lock.yaml`（代码 2 / 1000）。
- 第一轮评审 head `58909701`，draft；评审前 12 项 checks 全绿，没有 review 与线程。
- 评审账号：Singularity-AI-Bot（review 5464965237，REQUEST_CHANGES，1 × P1）。
- 本 PR 与 #299 的前提是「代码却在 Node 26 上运行」。这对 CI 与本机开发成立，对唯一的交付面不成立：插件宿主半边由 Desktop `0.2.0-rc.2` 的 Electron 44 以 Node 模式加载，运行时是 Node 24.18.1。依据：Desktop 应用包内 `Contents/Resources/runtime/versions.json` 的 `node` 为 `24.18.1`；归档计划 `docs/exec-plan/completed/2026-09-29-harness-plugin-package.md` 的 D26（来源是人类伙伴的要求，宿主半边构建目标覆盖 Node 24）；`apps/harness-plugin/scripts/build.mjs` 的 `HOST_NODE_TARGET = 'node22'`；ADR-0009 Decision 5。

- 作者补查「Desktop 会不会改用系统 Node」（本机 `PATH` 上有 Node 26，人类伙伴提出这个问题）：不会。Desktop `0.2.0-rc.2` 的 `app.asar` 里 `lib/main.js` 的 `runtimeResources()` 在打包版返回 `node: process.execPath`，即 Electron 自己的可执行文件；`DesktopHostProcess.start` 用它以 `ELECTRON_RUN_AS_NODE=1` spawn 宿主子进程。可由环境变量覆盖的只有 `!app.isPackaged` 的开发分支。`runtime/bin/node` 垫片同样 `exec` 回 Electron（`ELECTRON_RUN_AS_NODE=1`），`dsh` 启动器也是。Electron 44.0.0 内嵌 Node 24.18.1，作者在本机以 `ELECTRON_RUN_AS_NODE=1` 回读 `process.version` 得 `v24.18.1`。
- 另一条分发路径：npm 上的 `@deepseek-ai/dsh`（`latest` 与 `next` 都是 `0.2.0-rc.2`）没有声明 `engines`，那条路径跑在用户自己的系统 Node 上，下限不明；仓库的 `engines.node >=22.0.0` 与 D26「覆盖 Node 24 与系统 Node」对应的是这两条路径的并集。所以类型包应跟随的是**最低的交付运行时**，不是 CI 的 Node。

## P0–P3 风险矩阵

| 层 | 结论 |
|---|---|
| 代码 / 构建 | 无缺陷。锁文件只动 `@types/node` 与 `undici-types`；两个 integrity 与 registry 一致；`pnpm install --lockfile-only` 重新解析后逐字节相同；TS 5.9.3 与 `@types/node` 26 兼容 |
| 产品闭环 | **P1**：类型面（26）越过了唯一交付面（插件宿主半边，Node 24.18.1）的运行时。合并后 Node 25 / 26 才有的 API 能通过全部门禁，在验收宿主里抛 `TypeError` |
| 架构 | 依赖边不变（boundaries 8 / 8）。合并后 `@types/node` 26 与 ADR-0009 Decision 5 / D26「不高于验收宿主的 Node 24」成为同一事实的两种说法 |
| 测试 | 没有任何检查能判别宿主运行时兼容性：CI 只跑 `.nvmrc` 的 26，esbuild 的 `target: node22` 只降级语法、不检查 API |
| 工作项 | #299 五条验收在 head 上成立；标题、标签、规模、关闭关键字、发布面合规。验收项缺「类型包不高于最低交付运行时」这一条 |

## P1：类型面越过交付宿主的运行时

**错在哪里。** 原来的错配是安全方向：类型 24.13 ⊂ 宿主 24.18 ⊂ CI 26，`tsc` 守住宿主的 API 面。本 PR 把它翻成不安全方向：类型 26 ⊃ 宿主 24.18。作者在 #299 与本 PR 描述里写「本 PR 不改变缺口的性质」，事实相反：用 24 的类型时 `tsc` 会拒绝 Node 25+ 的 API，`engines.node >=22` 的缺口只有 23–24；升到 26 之后缺口扩大到 23–26。

**作者的漏查。** 作者只对照了 `.nvmrc`、本机 Node 与 `engines.node`，没有回读 ADR-0009 与 D26 对交付运行时的约束，也没有检查 `apps/harness-plugin` 的宿主目标。「CI 与本机跑 Node 26」被当成了「代码在 Node 26 上运行」。

**复现（作者独立复跑，两半）。** 探针只调用 `new AsyncLocalStorage<string>().withScope('host')`（`@since v25.9.0`），放在仓库外的临时目录，`tsconfig` 与仓库同样的 `strict` / `NodeNext` / `types: ["node"]`：

| 条件 | 结果 |
|---|---|
| 类型 `@types/node` 24.13.5，`tsc --noEmit` | `TS2339: Property 'withScope' does not exist on type 'AsyncLocalStorage<string>'`，退出码 2 |
| 类型 `@types/node` 26.6.4（`--typeRoots`，`--listFiles` 确认加载的是 26 版） | 退出码 0 |
| 本机 Node v26.10.0，`typeof AsyncLocalStorage.prototype.withScope` | `function` |
| Desktop 自带运行时（`ELECTRON_RUN_AS_NODE=1`）Node v24.18.1，同一表达式 | `undefined` |

评审会话另有端到端复现：在 `apps/harness-plugin/src/host.ts` 里调用该 API，base 上 `tsc` 报错、head 上通过；集成测试 `tests/integration/harness-plugin-artifact.test.js` 在 base 与 head 都是 20 / 20（CI 只跑 Node 26，抓不到）；构建产物在 Node 26.10.0 上 `apply()` 正常、在 Node 24.18.1 上抛 `TypeError: scope.withScope is not a function`。这一段由评审会话报告，作者没有重跑。结论：在 base 上 `tsc` 是唯一拦住它的门，到了 head 这道门没有了。

**影响为什么是 P1 而不是 P0。** 今天的 `host.ts` 只打一行就绪行，合并不会让 main 变红。#228 的范围是让宿主半边持有组合好的 core、controller 与 SQLite storage，这些包随后都在 Node 24.18.1 上运行，`packages/storage/sqlite/src/storage-sync.ts` 已经在用 `AsyncLocalStorage`。

## 并集预演（评审会话报告，作者未重跑）

main + #300 + #301 两种顺序的树对象相同；`pnpm verify` 1463 / 1463、mvp0 7 / 7；`tsc --listFiles` 只有 26.6.4。并集本身没有冲突，阻塞项只在本 PR 的前提上。

## 整体结论

REQUEST_CHANGES，1 × P1。不合并。

修复方向需要人类先定前提，因为它涉及已采纳的 ADR-0009 与来源是人类要求的 D26：

1. **保持 24 的类型，补闸门（评审推荐）。** `@types/node` 跟随最低的交付运行时（`~24.13`），测试继续跑 `.nvmrc`。在与 `HOST_NODE_TARGET` 同一处只声明一次宿主 Node major，加一条契约测试断言根 `@types/node` 的 major 不高于它。Desktop 换到 Node 26 时两处一起改。#299 按这个前提改写或关闭。
2. **升到 26，带等价闸门。** 用 npm alias 引入 `@types/node@~24.13`，给宿主半边闭包单独跑一份 tsconfig 的 `tsc --noEmit` 并接进 `pnpm verify`；在 ADR-0009 / D26 旁记录这个决定。

两种做法都要订正提交信息与 PR 描述里「代码在 Node 26 上运行」的前提，提交信息会随合并进入 main 的发布面。

## 修复轮

### 第一轮修复（head `355c4f11`）

修复在恢复锚点之后改写：旧 head `58909701`（把 `@types/node` 升到 26）保存在本地备份 ref `backup/pr301-pre-r1fix-*`，新历史是代码、评审记录两个提交，再以精确的 force-with-lease 推送。

**前提。** 人类伙伴裁决「按方案一执行（推荐）」：类型跟随验收宿主，补闸门，不升级；#299 与 #301 的范围随之改写；ADR-0009 与 D26 不动。人类伙伴同时提出「本机有 Node 26」这个问题，作者回读后确认 Desktop 不会改用系统 Node（见锁定事实），不改变结论。

| 发现 | 处置 | 证据 |
|---|---|---|
| P1 类型面越过交付宿主的运行时 | 采用方案一。`@types/node` 从 `^24.10.1` 收紧为 `~24.13.5`，解析版本仍是 24.13.5，`pnpm-lock.yaml` 只改 specifier 一行。宿主 Node 版本只在 `apps/harness-plugin/scripts/build.mjs` 声明一次，紧挨 `HOST_NODE_TARGET`（第一轮是 `HOST_NODE_API_MAJOR = 24`，第二轮改为完整版本，见下）。新增契约测试 `tests/contract/host-node-types.test.js`，提交信息与 PR 描述按事实重写，不再说「代码在 Node 26 上运行」 | 见下 |
| 缺口 测试层没有任何检查能判别宿主运行时兼容性 | 同上：契约测试是新的闸门；验收项补上「类型包不高于最低交付运行时」。宿主版本只在一处声明，测试 import 它，不抄字面量 | 见下 |

**判别证据（作者，第一轮）。**

- 先红：测试在旧 head 的状态（清单 `^26.6.4`、锁文件 26.6.4）上，清单与锁文件两条检查都失败，消息逐字指向 ADR-0009 Decision 5 / D26；第一次运行还没有常量时因「缺少导出」失败，原因正确。再绿：钉回 `~24.13.5` 后全绿。
- 注意 `pnpm add -D -w @types/node@~24.13.5` 会把它保存成 `^24.13.6`（按默认前缀保存解析结果，并把版本抬到 24.13.6），所以改为手写 specifier 再 `pnpm install`，锁文件沿用已满足范围的 24.13.5。
- 探针回到仓库内：让 `apps/harness-plugin/src/host.ts` 临时调用 `new AsyncLocalStorage<string>().withScope('host')`，仓库的 `tsc --noEmit` 报 `TS2339`（退出码 2）；还原后退出码 0。
- 第一轮的变异表（9 个，全部确认已应用、全部变红、全部还原），第一轮的 `pnpm verify` 主套件 1461 / 1461、mvp0 7 / 7。第二轮的闸门比第一轮严格，这两项在下面的最终树上整表重测。

### 第二轮修订（复评的 P2 与 P3）

复评 APPROVE（5465594948），无 P0 / P1，两条非阻塞意见在合并前收尾。修订在恢复锚点之后改写：第一轮的 head `355c4f11` 保存在本地备份 ref `backup/pr301-pre-r2fix-*`，仍是代码、评审记录两个提交，再以钉在 `355c4f11` 上的 force-with-lease 推送。

**作者独立核对 P2 的事实。**

- `@types/node` 24.x 已发布的 minor：24.0 到 24.13，之后直接是 24.19.0、24.19.1，没有 24.14 到 24.18。
- 类型包内的 `@since` 标注：24.13.6 里最高是 `v24.13`；24.19.1 里有 `v24.14` 到 `v24.19` 的 API，其中 `Blob#textStream()` 标 `@since v24.19.0`，24.13.6 里没有它。所以 `@types/node` 的 major.minor 标示它描述到哪个 Node 小版本；虽然发布时跳过了一些 minor，「major.minor 不高于宿主」仍是可靠的阈值。patch 不比较，类型包的 patch 是它自己的修订号。
- 运行时：Desktop 的 Node 24.18.1 上 `typeof Blob.prototype.textStream` 为 `undefined`，本机 Node 26.11.0 上为 `function`。

| 发现 | 处置 | 证据 |
|---|---|---|
| P2 闸门只比主版本，24.19.x 已发布并描述了宿主没有的 API | 采纳评审的方案 1。单一事实源改为完整版本 `HOST_NODE_VERSION = '24.18.1'`（`build.mjs`，紧挨 `HOST_NODE_TARGET`），不再导出派生的主版本，测试自己解析。清单只接受上界落在同一个 minor 内的写法（`~M.m.p`、`~M.m`、`M.m.p`、`M.m`），major 级的 x 区间（`24.x`、`24`、`~24`）以及 `^`、`>=`、`*`、`latest` 因上界越过宿主直接拒绝；清单声明与锁文件解析出的每个版本，`major.minor` 都不得高于宿主的 `major.minor` | 旧闸门放行 N1 到 N6；新闸门逐个变红，见下 |
| P3 清单扫描自己展开 workspace 通配，遇到不认识的写法静默跳过 | 采纳「不要重新实现 pnpm 的 glob」：包集合取自锁文件 `importers`，清单缺失直接抛错，不再跳过。再加一条与磁盘核对：根目录加 `apps/`、`packages/` 下的包根（带 `package.json` 的目录），必须与 `importers` 的键一一相等，任何一边多出来或少了都报错。这比评审给的「最低限度」方案（遇到不认识的写法抛错）更严，因为它同时覆盖陈旧的锁文件。`peerDependencies` 不在 `importers` 里，所以按 `importers` 的键定位清单，四个依赖字段都从清单读 | 旧闸门放行 N8；新闸门变红，见下 |

**判别证据（作者，第二轮，最终代码树 `dc548f22` 之后的重测）。**

- 旧闸门放行（修复前的红）：在 `355c4f11` 上，N1 锁文件解析版本改成 24.19.1、N2 清单 `^24.13.5`、N3 清单 `^24.10.1`（main 的写法）、N4 `^24`、N5 `~24.19.0`、N6 精确 `24.19.1`、N8 `packages/extra/**` 下的新包声明 `>=24`，测试全部 `pass 3 / fail 0`，即评审说的 fail open 属实。N9（磁盘上多一个新包、锁文件没更新）在旧闸门上本来就红，因为旧实现自己展开通配、读得到那个目录；N7 是边界，新旧闸门都放行。
- 新闸门，18 个变异，每个先确认已应用、再看变红的检查、最后还原并确认树干净：
  - N1：只有锁文件那条红；N2 到 N6：只有清单那条红；N8：清单那条红（现在看得见新包）；N9：「importers 与磁盘一一对应」那条红。
  - H1 宿主版本改成 24.12.0（清单、锁文件红），H2 改成 21.0.0（构建目标、清单、锁文件红），H3 写成 `24.18`（缺 patch，三条红）。
  - W1 `apps/harness-plugin` 的 devDependencies、W2 `packages/providers/fake` 的 dependencies（精确 26.0.0）、W3 `packages/domain` 的 peerDependencies（`^24.13.5`），都只有清单那条红；W4 锁文件多出第二个 `@types/node@26.6.4`（换名 alias 或传递依赖的形态），只有锁文件那条红；W5 把某个 importer 的 `package.json` 改名，「importers 与磁盘一一对应」与清单两条红，清单读不到是报错而不是跳过。
  - 边界不误拦：N7 清单 `~24.18.0`（minor 等于宿主）与 H4 宿主版本 24.13.5（等于解析版本），4 条全绿。
- 全量：`pnpm install --frozen-lockfile` 成功；`pnpm verify` 退出码 0，主套件 1462 / 1462（main 的 1458 加上新闸门的 4 条），mvp0 7 / 7。
- 锁文件相对 main 仍只差 `importers` 里 `@types/node` 的 specifier 一行。

**未采纳 / 未覆盖。** 闸门比较 `major.minor`，不比较 patch：类型包的 patch 是它自己的修订号，Desktop 的 patch 变化不影响类型面。`engines.node >=22.0.0` 仍宽于类型包，本 PR 不改变它。TypeScript 7 与 React 19 不在本 PR；TypeScript 7 在试跑里 `tsc --noEmit` 零报错，但 `pnpm verify` 与插件构建没有在它上面跑过，仍需单独验证。

### 第三轮修订（复评的 P2 与 P3）

第二轮修订的复评 APPROVE（5465716054），无 P0 / P1，又留下两条非阻塞意见，仍在合并前收尾。修订在恢复锚点之后改写：第二轮的 head `bdc7788e` 保存在本地备份 ref `backup/pr301-pre-r3fix-*`，仍是代码、评审记录两个提交，再以钉在 `bdc7788e` 上的 force-with-lease 推送。

**作者独立复现 P2。** 按归档计划验收步骤 1 的命令 `pnpm --filter @harness-projects/app-harness-plugin run pack:plugin` 之后，`apps/harness-plugin/dist/package/package.json` 存在（`dist/` 被 `.gitignore` 忽略，不是 workspace 成员），新测试 3 过 1 红，`missingFromLock` 指向 `apps/harness-plugin/dist/package`，提示语还把人引向「锁文件陈旧」「补 `PACKAGE_ROOTS`」。第二轮的磁盘扫描除 `node_modules` 外对每个子目录都下钻，找到包根也不停，这是本 PR 引入的回归：base 上同一状态是绿的，干净检出的 CI 看不到。

| 发现 | 处置 | 证据 |
|---|---|---|
| P2 磁盘扫描下钻进被忽略的构建产物，按文档打包后本机门禁变红 | 磁盘扫描改为找到包根就停，并按名字跳过 `node_modules` 与 `dist`；与 `package-boundaries.test.js` 的 `findPackageDirs` 只在「找到包根就停」上一致（它只看两层、只跳过 `node_modules`、不按名字跳过 `dist`，这里逐层递归），不引入对 git 命令和 `.git` 目录的依赖（评审给的另一条路 `git ls-files -co --exclude-standard` 同样可行，没有选它的原因是测试在没有 `.git` 的导出目录里也应当能跑）。扫描函数改为接受根目录参数，集合比较抽成 `diffPackageSets`，新增一条自包含的夹具测试：在临时目录里造出 `dist/package`、包内嵌套的清单、`node_modules` 里的清单、分组层的 `dist`，断言它们都不算包，而缺在锁文件里的新包仍被指出 | 先红：夹具测试多算了 `apps/a/dist/package`、`apps/a/test/fixtures/x`、`packages/dist/stray`，真实树上 `pack:plugin` 之后 3 过 1 红；再绿：5 / 5 |
| P3 可接受写法的文字与正则不一致 | 正则本来就接受 `~M.m.p`、`~M.m`、`M.m.p`、`M.m` 四种，它们的上界都落在同一个 minor 内，安全；改的是文字，不动正则：文件头注释、断言消息、提交信息、#299 与 PR 描述统一成「上界落在同一个 minor 内的写法」，被拒绝的是 major 级的 x 区间（`24.x`、`24`、`~24`）以及 `^`、`>=`、`*`、`latest` | 评审实测 `~24.13`、`24.13` 为绿，`24.x`、`24`、`~24` 为红，作者的 N2 到 N6 同样复现 |

**判别证据（作者，第三轮，最终代码树 `38fc4be5` 之后的重测，`apps/harness-plugin/dist/package` 一直存在）。**

- 基线：`dist/package` 存在、无其他变异时 5 / 5 全绿。
- 新增的 4 个变异，每个先确认文件已存在，再看测试，最后删除并确认已删除：N12 包内嵌套的 `{"type":"commonjs"}` 清单、N13 包内测试夹具带清单、N14 分组层的 `dist`，都保持全绿；N15 `dist/` 存在加上一个真正缺在锁文件里的新包，只有「importers 与磁盘上的包根一一对应」那条红。这一对就是评审要求的判别：`dist/` 存在时仍绿、新包缺在锁文件里仍红。
- 之前的 18 个变异（N1 到 N9、H1 到 H4、W1 到 W5）在这棵树上整表重测，`dist/package` 存在，结果与第二轮一致：单点失败的变异各自只红 1 条，H1 红 2 条，H2、H3 红 3 条，W5 红 2 条，边界 N7、H4 为 5 / 5 全绿，没有未应用或还原失败。
- 全量：`pnpm install --frozen-lockfile` 成功；`pnpm verify` 在最终 head、`dist/package` 存在时退出码 0，主套件 1463 / 1463（main 的 1458 加上新闸门的 5 条），mvp0 7 / 7。
- 锁文件相对 main 仍只差 `importers` 里 `@types/node` 的 specifier 一行。

**未覆盖。** 扫描找到包根就停，所以嵌套在另一个包里面的 workspace 成员扫不到：它会出现在 `importers` 里，让「一一对应」那条红并提示原因，而不是被静默漏掉。

### 第四轮修订（复评的两条 P3）

第三轮修订的复评 APPROVE（5465848362），无 P0 / P1 / P2，留下两条机械的 P3，在合并前顺手收尾；评审说此后只做增量核对。修订在恢复锚点之后改写：第三轮的 head `37cd7ae0` 保存在本地备份 ref `backup/pr301-pre-r4fix-*`，仍是代码、评审记录两个提交，再以钉在 `37cd7ae0` 上的 force-with-lease 推送。

| 发现 | 处置 | 证据 |
|---|---|---|
| P3-a 夹具只钉住了 `diffPackageSets` 的一个方向；另一个方向的变异存活，#299 的验收「importers 里有、磁盘上没有包根……变红」没有被套件保护 | 作者先复现：把 `missingOnDisk` 改成恒为空，套件 5 / 5 仍全绿。夹具的 `imported` 加上磁盘上不存在的 `tools/x`，期望 `missingOnDisk: ['tools/x']`。顺带：夹具里那条 `node_modules` 清单原本在包 `b` 里面，被「找到包根就停」先挡住，不测任何东西；挪到分组层 `packages/node_modules/dep`，跳过才真被测到 | 先红：`missingOnDisk` 恒空与去掉 `node_modules` 跳过两个变异存活（5 / 5 全绿）；后绿：修复后这两个变异、再加 `missingFromLock` 恒空、去掉 `dist` 跳过、不再找到包根就停，共 5 个扫描变异全部只让夹具那一条红 |
| P3-b 注释说「做法与 `findPackageDirs` 一致」不准确 | 属实：`findPackageDirs` 只看两层、只跳过 `node_modules`、不按名字跳过 `dist`，两者只在「找到包根就停」上一致。这句错来自第三轮意见里的「并跳过 `dist`」，评审已自认；作者没有对照源码就照抄进了注释。改成准确的说法：注释、本记录第三轮修订表、线程回复同一句一起改；作者记忆里的同一句也改了 | 对照 `package-boundaries.test.js` 的 `findPackageDirs` 源码 |

**判别证据（作者，第四轮，最终代码树 `55113977` 之后的重测，`apps/harness-plugin/dist/package` 由 `pack:plugin` 重新生成并一直存在）。**

- 5 个扫描变异（`missingOnDisk` 恒空、`missingFromLock` 恒空、去掉 `node_modules` 跳过、去掉 `dist` 跳过、不再找到包根就停），每个先确认已应用，再看哪条测试变红，最后还原：全部只让「磁盘扫描只数包根」那条红，其余 4 条保持绿。
- 之前的 22 个变异（N1 到 N9、H1 到 H4、W1 到 W5、N12 到 N15）加 `dist` 存在的基线，在这棵树上整表重测，`dist/package` 存在，结果与第三轮一致：单点失败的变异各自只红 1 条，H1 红 2 条，H2、H3 红 3 条，W5 红 2 条，边界 N7、H4 与 `dist` 存在的基线、N12 到 N14 为 5 / 5 全绿，没有未应用或还原失败。
- 全量：`pnpm install --frozen-lockfile` 成功；`pnpm verify` 在 `dist/package` 存在时退出码 0，主套件 1463 / 1463（测试条数不变，只改了夹具里的断言），mvp0 7 / 7。锁文件相对 main 仍只差 `importers` 里 `@types/node` 的 specifier 一行。

## 复评

复评在新 head `355c4f11` 上独立重跑（base `main@78c3eb5b`，评审用 scratch clone）。按第一轮 P1 的原始条件（比宿主主版本新的 Node API 必须被门禁拦下），修复成立：`host.ts` 的 `withScope` 探针报 `TS2339`；另一个 workspace 包声明 26、`overrides`、换名 alias、传递依赖引入 26，以及旧 head 的清单与锁文件，都让契约测试变红。锁文件相对 main 只差 specifier 一行，`pnpm verify` 1461 / 1461、mvp0 7 / 7。作者的变异全部复现，每个都确认已应用并逐字节还原。新增两条非阻塞意见：P2 闸门只比主版本，而 `@types/node` 24.19.x 已发布、声明了 Desktop Node 24.18.1 没有的 API（宿主上 `typeof Blob.prototype.textStream` 为 `undefined`）；P3 清单扫描遇到不认识的 workspace 通配写法会静默跳过。结论：无 P0 / P1，APPROVE（5465594948），P2 与 P3 在合并前收尾。

第二轮修订（P2 与 P3）的复评在 head `bdc7788e` 上独立重跑（base `main@78c3eb5b`，评审用 scratch clone）。三条按原始条件逐一复核，都成立。第一轮 P1：`host.ts` 探针调用 `withScope` 与 `textStream`，都报 `TS2339`。第二轮 P2：锁文件解析 24.19.1、清单 `^24.13.5`、`^24.10.1`、`^24`、`~24.19.0`、精确 `24.19.1`、`24.x`、alias、第二个解析版本，都让契约测试变红。第二轮 P3：真实安装下的 `packages/extra/**`、`PACKAGE_ROOTS` 之外的 `tools/**`、陈旧锁文件，以及只在 `peerDependencies` / `optionalDependencies` 里的声明，都变红。作者的 18 个变异全部复现（每个确认已应用、逐字节还原），边界与宿主升到 26 都不误拦。`pnpm verify` 1462 / 1462、mvp0 7 / 7。锁文件相对 main 只差 specifier 一行，`--lockfile-only --offline` 重新解析后逐字节相同。新增两条非阻塞意见。P2：磁盘扫描会下钻进 `dist/`，按文档跑 `pack:plugin` 之后本机门禁变红（base 上同一状态是绿的）。P3：可接受写法的文字描述与正则不一致。结论：无 P0 / P1，APPROVE（5465716054），P2 与 P3 在合并前收尾。

第三轮修订（P2 与 P3）的复评在 head `37cd7ae0` 上独立重跑（base `main@78c3eb5b`，评审用 scratch clone，`apps/harness-plugin/dist/package` 由真实 `pack:plugin` 生成并一直存在）。第三轮 P2 按原始条件复核成立：新闸门 5 / 5、`tests/contract` 900 / 900，同一状态下 `bdc7788e` 的旧扫描仍红。包内测试夹具清单、包内 `{"type":"commonjs"}`、包内的 `.turbo` / `build` / `coverage` 都不误报。同一状态下 `packages/providers/x` 缺在锁文件里，仍让「一一对应」那条红。importers 里有、磁盘扫描不到的 `tools/x`、嵌套在包里的 workspace 成员、名为 `dist` 的真实 workspace 成员都变红，而不是被跳过；清单检查按 importers 遍历，照样覆盖它们。第三轮 P3 成立：文件头、断言消息、#299、PR 描述与本记录都与正则一致。回归：`host.ts` 的 `withScope` 探针报 `TS2339`；锁文件 24.19.1、清单 `^24.13.5`、`~24.19.0`、`24.19.1`、`24.x`、`~24`、`24`，以及真实安装下 `packages/extra/**` 的 `>=24` 都红；`~24.18.0`、`24.18.1`、`~24.18`、`24.18`、锁文件 24.18.1 都绿。夹具测试连跑 10 次结果一致，成功与失败路径都清理临时目录。扫描的 8 个变异抓住 6 个，存活的是 `diffPackageSets` 的 `missingOnDisk` 恒为空，以及去掉 `node_modules` 跳过（找到包根就停之后等价）。`pnpm verify` 1463 / 1463、mvp0 7 / 7。锁文件相对 main 只差 specifier 一行；range-diff 只动了测试、评审记录与两条提交信息。新增两条非阻塞 P3：夹具没有钉住 `missingOnDisk` 方向；「与 `findPackageDirs` 一致」的说法不准确（源自第三轮评审意见）。结论：无 P0 / P1，APPROVE（5465848362），两条 P3 在合并前收尾。

第四轮修订（两条 P3）的增量核对在 head `d8f72e28` 上进行（评审 5465899370，APPROVE）。`range-diff` 相对 `37cd7ae0` 只动了契约测试的夹具与一处注释、本记录，以及记录那条提交的信息；`package.json`、锁文件与 `build.mjs` 不变。用 #300 引入的 `scripts/review-mutate.mjs` 在评审 clone 上跑三个扫描变异——`missingOnDisk` 恒为空、不再跳过 `node_modules`、不再跳过 `dist`——三个都被「磁盘扫描只数包根」这条用例杀死，按 `killedBy` 归因，文件逐字节还原。注释与 `findPackageDirs` 的源码一致。`tests/contract` 900 / 900，13 项 checks 全部通过。无新意见。
