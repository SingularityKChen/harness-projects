# Harness 插件打包（issue #227）ExecPlan

> 状态：Completed（2026-09-30 人类伙伴授权修订、整理并 rebase merge PR #245；计划归档，PR 状态以实时回读为准。原阶段快照：Batch 0–3 已完成：依赖、壳层源码、构建脚本、产物契约测试、壳断言与 ADR-0009 已整合进 `feature/harness-plugin-package`，全仓库验证与变异表在最终树上通过；Batch 4：人类伙伴已选 H 路线并确认 D28（D31、D32），K0、Kp、K1 已完成（K0、K1 已观测到）；Batch 5：K3–K6 已观测到（K6 有两处如实记录的偏离），K7 已执行、H5 按 D33 把 `desktop` profile 恢复到 Kp 快照；Batch 6 已回填并快进推送，PR 已 ready，人类伙伴已授权修订后整合。2026-09-30 按人类伙伴的四项决定改为以 `0.2.0-rc.2` 为目标宿主线、以本机 Desktop 为验收宿主，见 D20–D26）
> 创建：2026-09-29
> 范围：让 `apps/harness-plugin` 只凭本仓库构建出一个可安装的宿主插件包（宿主入口 + client bundle + 安装件 manifest + patch），目标宿主线 `0.2.0-rc.2`；在人类伙伴本机已安装的 DeepSeek Harness Desktop `0.2.0-rc.2` 的 `desktop` profile 里经 `dsh plugin --profile desktop add` 装入并加载，侧栏出现一个入口、点开渲染占位面板，验收后卸载并核对 profile 与快照一致。不含 controller transport（#228）、业务页面（#229）、发布与安装指南（#230）。
> 上游输入：issue #227（验收标准）、#226（父 epic）、`docs/architecture/harness-host-spike.md` §11（尤其 §11.2 探针构建版本表、§11.4 的 M 行、§11.5 捷径台账、§11.7 的 #227 行、§11.9 第 4 条、§11.10 宿主 `0.2.0-rc.2` 的静态差异与复测清单）、`docs/exec-plan/active/2026-09-29-harness-plugin-reprobe.md` 的技术债务 TD1 / TD5、`AGENTS.md` §2 / §6 / §7 / §9、`PLANS.md`、`tests/README.md`、官方插件文档 <https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish>
> 栈：head `feature/harness-plugin-package`（工作树 `.worktrees/harness-plugin-package`），base `test/harness-plugin-reprobe`（#225 的 draft PR #238；回读：`gh pr list -R SingularityKChen/harness-projects --head test/harness-plugin-reprobe --state all --json number,isDraft,baseRefName`）。栈深 2。~~2026-09-29T16:08Z 回读时本地 `test/harness-plugin-reprobe` 在 `d10d0ad`，Batch 0 快进过去~~ Superseded（2026-09-30）：**#225 已改写历史**，2026-09-30 回读本地 `test/harness-plugin-reprobe` 为 `6de03f1`（已变基到 `main` 的 `699d715`，新增 §11.10），本分支的起点 `6052f62` 不再是它的祖先，快进不可行，由主会话变基（Batch 0）。回读：`git rev-parse --short test/harness-plugin-reprobe`；`git merge-base --is-ancestor 6052f62 test/harness-plugin-reprobe; echo $?`（变基前期望 `1`）。本计划的事实取自 `6de03f1` 的 §11（含 §11.10）。
> 宿主版本：目标线 `0.2.0-rc.2`（D20）；验收宿主是人类伙伴本机的 Desktop `0.2.0-rc.2`（Electron 44.0.0，宿主进程跑在 Electron 的 Node 24.18.1 上，自带 pnpm 11.7.0；D22、F27）。`$HOST_RUNTIME/…:行号` 这种写法取自 `0.1.7-rc.2` 的 npx 安装根，`$HOST_RUNTIME/…/` 指 `$HOST_RUNTIME/node_modules/@deepseek-ai/`；在 `0.2.0-rc.2` 上对应 `$ASAR:dsh/node_modules/@deepseek-ai/`（`$ASAR` 是 Desktop 应用包里的 `Contents/Resources/app.asar`，只读解析方法见 `Interfaces and Dependencies`）。F5–F18 引用的行号 2026-09-30 在 `$ASAR` 里抽查 9 处一致（插件路径上的包除 `package.json` 外逐字节相同，§11.10）；升级后行号失效。
> 关闭引用：PR 描述写 `Closes #227` 与 `Refs #225 #226 #228 #229 #230`；任何 commit message 正文只写 `Refs #227`，不写关闭关键字。

## Purpose / Big Picture

#225 的复探裁决是 `embed`（`docs/architecture/harness-host-spike.md` §11.6）：宿主能装入仓库外插件包、加载宿主半边、在浏览器里执行 client bundle 并把面板挂进 `main` 插槽。但那次用的是**手写 JS 探针**（§11.5 捷径台账第 1、2 行），「由构建产出的宿主入口与 client bundle」一次也没被宿主观测过（§11.9 第 4 条）。#227 把这一半补上，并把 `apps/harness-plugin` 从占位变成一个只做壳的插件包。

完成后的世界：

1. `pnpm --filter @harness-projects/app-harness-plugin run pack:plugin` 在本仓库的干净检出上产出 `apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.0.0.tgz`。包内只有 `package/package.json`、`package/cordis.patch.yml`、`package/lib/index.js`、`package/lib/client.js`，以及 pnpm 从仓库根复制进来的 `package/LICENSE`（F26）；安装件 manifest 没有任何 `dependencies`，全文没有 `workspace:`。
2. ~~这个 tarball 经 `dsh plugin --profile web add` 装进一次性 profile 后，scratch 宿主启动时打出本插件的就绪行……~~ Superseded by D22（2026-09-30）：这个 tarball 经 `dsh plugin --profile desktop add` 装进人类伙伴本机 Desktop `0.2.0-rc.2` 的 `desktop` profile 后，Desktop 启动时本插件的宿主半边在 Electron 的 Node 24.18.1 上打出就绪行，Plugins 页没有本插件的加载错误；侧栏出现「Harness Projects」入口，点开后 `main` 插槽渲染占位面板；验收结束后插件被卸载，profile 的 `package.json` 与安装前的快照相同。
3. CI（`PR Fast Gate` 的 verify lane 与 Merge Gate · Integration）每次都在干净检出上真跑构建，并断言产物形状、require 集合、patch 行与注册行为。
4. `pnpm run boundaries` 通过，并新增一条机械断言：`apps/harness-plugin/src` 不直接 import `react` / `react-dom`、没有 `.tsx`。组件只来自 `@harness-projects/ui`。

**最小成功证据**：

- `node --test tests/integration/harness-plugin-artifact.test.js` 在 head 上通过；在 base（只加了该测试的提交）上失败，失败原因是 `apps/harness-plugin/scripts/build.mjs` 不存在。
- ~~`Validation and Acceptance` 表的 K1、K3 在 scratch 宿主上「已观测到」，K3c 的阴性对照证明 K3 的判据能失败。~~ ~~K4–K6 在人类伙伴对本 PR 另行确认之后，由主会话在内置 Browser 窗格里「已观测到」。~~ Superseded by D22–D24（2026-09-30）。
- `Validation and Acceptance` 表的 K1、K3 在 Desktop 上「已观测到」：K1 与 K3 的日志部分由 agent 取证，K3 的 Plugins 页部分与 K4–K6 由人类伙伴在 Desktop 窗口里执行并截图（`Design / Spec` §7.3 的 H 步清单），agent 读图转录。没有截图与确认之前，验收 2 记为未完成，PR 保持 draft。

**首要防御对象**：CI 全绿但真实宿主不接受构建产物。离线测试只能证明形状，不能证明宿主的 module loader 会接受它（§11.9 第 4 条），所以 K 行是本计划的判定依据，CI 只挡已知的一类缺陷。

## Context and Orientation

### 术语

| 词 | 含义 |
|---|---|
| 宿主 | 本产品要嵌入的已安装运行时，CLI 名 `dsh`，公开包 `@deepseek-ai/*`。可写的公开标识符口径见 `Decision Log` D3 |
| `$HOST_RUNTIME` | 宿主运行时 `0.1.7-rc.2` 的安装根（npx 缓存里的安装目录）。绝对路径不入库。F 行的出处沿用这种写法，`0.2.0-rc.2` 上的对应位置见文首「宿主版本」 |
| `$DESKTOP_APP` | 人类伙伴本机的 Desktop 应用包根目录（macOS 默认安装位置 `/Applications/DeepSeek Harness.app`） |
| `$ASAR` | `$DESKTOP_APP/Contents/Resources/app.asar`；`$ASAR:<路径>` 指包内文件，只读解析，不解包、不修改应用 |
| `$DESKTOP_PROFILE` | `~/.dsh/profiles/desktop`，人类伙伴**真实的** Desktop profile（D22） |
| `$SCRATCH` | 本计划观测用的一次性目录，`mktemp -d` 在系统临时目录下创建；放干净检出、Desktop 的 stdout 文件、profile 快照与截图。~~`DSH_HOME="$SCRATCH/home"`~~ Superseded by D22（2026-09-30）：不再用作 `DSH_HOME` |
| H 步 / A 步 | H 步由人类伙伴亲手执行（`Design / Spec` §7.3），A 步由 agent 执行 |
| 宿主半边 | 安装件的 `exports['.']`（`lib/index.js`），Node ESM，由宿主 Loader 按 patch 行加载 |
| 客户端半边 | 安装件的 `exports['./client']`（`lib/client.js`），形状是 `window.__ModuleLoader__.load({ id, factory })` |
| 源 manifest | 工作区里的 `apps/harness-plugin/package.json`，服从 `tests/contract/package-boundaries.test.js` |
| 安装件 manifest | 构建生成的 `apps/harness-plugin/dist/package/package.json`，是装进 profile 的那一份 |
| 基线模块表 | 浏览器模块系统预置的 9 个模块名；client bundle 只能 `require` 它们与 `dsh.client.external` 声明的名字 |
| K 行 | 本计划预注册的宿主侧与浏览器侧观测行（`Design / Spec` §7），结果只写「已观测到 / 未观测到」 |

### 当前事实（fact，2026-09-29 由独立评审复核；F27–F35 与各行的 `0.2.0-rc.2` 注记由独立定稿者 2026-09-30 只读复核 `$ASAR` 与应用包后补写）

| # | 事实 | 证据 |
|---|---|---|
| F1 | `apps/harness-plugin` 只有占位：`exports['.']` 指向 `./src/index.ts`，`dependencies` 是 domain / client / ui-model / ui 四个 `workspace:*`；仓库没有任何打包器，也没有 react | `apps/harness-plugin/package.json`；`apps/harness-plugin/src/index.ts:1-8`；`grep -cE '@deepseek-ai\|esbuild\|react' pnpm-lock.yaml` 输出 0 |
| F2 | boundaries 要求每个包 `private: true`、`type: module`、`exports['.'] === './src/index.ts'`；`apps/harness-plugin` 只能依赖 domain / client / ui-model / ui；`react` / `react-dom` 只允许出现在 `packages/ui` 与 `apps/*`；`devDependencies`、`peerDependencies` 都算声明；源码扫描只看 `src/`，跳过 `dist` | `tests/contract/package-boundaries.test.js:86-104,146-164,185-201,245-309` |
| F3 | 仓库锁文件设置 `autoInstallPeers: true`：写在任何工作区 manifest 里的非 optional peer 都会被装进仓库 | `pnpm-lock.yaml:4` |
| F4 | 装进 profile 的宿主半边必须是 JS：Node v26.10.0 拒绝对 `node_modules` 下的 `.ts` 做类型擦除 | spike M12；§11.7 #227 第 1 条 |
| F5 | client bundle 形状：`window.__ModuleLoader__.load({ id: <包名>, factory: (require) => { var module = { exports: {} }; var exports = module.exports; …; return module.exports; } })`，导出 `apply` 与 `inject` | `$HOST_RUNTIME/…/dsh-client-ui-brand-official/lib/client.js:1-46`；spike M10 |
| F6 | 基线模块表（0.1.7-rc.2）：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`；宿主 React 是 18.3.1。**0.2.0-rc.2**：键完全相同，函数名变为 `rM()`，React 仍是 18.3.1（2026-09-30） | `grep -o 'function WS(){return{[^}]*}' "$HOST_RUNTIME"/…/dsh-web-frontend/dist/assets/index-*.js`；同文件 `version:"18.3.1"`；spike M23（`require` 只能取基线表与 `dsh.client.external` 的精确请求）。0.2.0-rc.2 用不依赖函数名的写法：对 `$ASAR:dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js` 执行 `grep -oE 'function [A-Za-z_$]{1,4}\(\)\{return\{react:[^}]*\}'` |
| F7 | 浏览器 `require` 只认基线表、已物化模块或已注册的包 factory，否则抛 `require("…") missed the module table` | `$HOST_RUNTIME/…/dsh-client-modules/lib/client.js:697-706` |
| F8 | Loader 取插件导出：先取 `default`，没有 `__esModule` 就用对象本身，有 `__esModule` 再退一层取 `default`，都没有就用对象本身。所以 esbuild 的 `__toCommonJS` 输出（`__esModule: true`、无 `default`）被当作插件对象本身 | `$HOST_RUNTIME/…/cordis-plugin-loader/lib/index.js:663-668` |
| F9 | 宿主定位插件包的 manifest：优先经 Loader 内部解析找最近的 `package.json`；没有内部解析时退回 `createRequire(base).resolve('<包名>/package.json')`，所以安装件 `exports` 必须含 `./package.json` | `$HOST_RUNTIME/…/dsh-client-modules/lib/index.js:742-790` |
| F10 | `dsh.client` 解析只校验 `platform` 是字符串、`inject` / `external` 是字符串数组、`immediately` 是布尔；`platform !== 'web'` 的包被忽略；声明了 `dsh.client` 却没有 `exports['./client']` 时抛错；bundle 文件缺失时激活聚合抛错（`client packages failed to compose`） | `$HOST_RUNTIME/…/dsh-client-modules/lib/index.js:61-75,125-167,712-719` |
| F11 | source map 可选：`client.js.map` 不存在时按 ENOENT 返回 undefined；bundle 末尾的 `//# sourceMappingURL=` 会被剥掉 | `$HOST_RUNTIME/…/dsh-client-modules/lib/index.js:163,254-276` |
| F12 | 兼容闸门只看 `peerDependencies` 里名为 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` 的项，拿运行时版本去匹配（含预发布号）；没有这类 peer 就放行。0.2.0-rc.2 同一函数、同一行号，范围语义与安装时判定见 F31 | `$HOST_RUNTIME/…/dsh-app-boot/lib/index.js:286-316`；spike M2 |
| F13 | **不兼容或读不到的 bundle 不会让启动失败**：`loadProfileDirectory` 捕获闸门抛出的错误，把包放进 `skippedBundles`，启动时往 stderr 打一行 `dsh: skipping profile bundle "<包名>": <原因>`，宿主照常启动。Desktop 下这一行与 F14 的审计都落在宿主子进程的 stderr 上，Desktop 不转出（F29） | `$HOST_RUNTIME/…/dsh-app-boot/lib/index.js:511-516,919-943` |
| F14 | 启动审计只报告已创建却没激活的 Loader 条目：`<bin>: warning: N entr(y\|ies) did not activate`，逐行 `<id> (<name>): <detail>`；必需条目失败是 `startup failed` | `$HOST_RUNTIME/…/dsh-app-boot/lib/index.js:3950-3970` |
| F15 | patch 格式：`- insert:` 下列 `{ id, name }` 行，`name` 按包名引用；安装件先例把 `./cordis.patch.yml` 放进 `exports` 与 `files` | `$HOST_RUNTIME/…/dsh-experimental-voice-input-bundle/package.json` 与其 `cordis.patch.yml` |
| F16 | 插槽挂法：`ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key }, C))` 与 `ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id, order, label }, Icon))`；`id` 必须等于 `main` 的 `key`，`label` 就是入口的可访问名称 | `$HOST_RUNTIME/…/dsh-client-ui-schedule/lib/client.js:6793-6810`；`$HOST_RUNTIME/…/dsh-client-ui-sidebar/README.md` 的 Global panel entries 段；spike O4.1 |
| F17 | 只读 `slots` 的纯客户端插件在根 Context 上注册，模块级导出 `inject = ['slots']`；命名空间服务 `remote.<ns>` 只能在 `ctx.inject` 回调的 Context 上读 | `$HOST_RUNTIME/…/dsh-client-ui-brand-official/lib/client.js:28-40`；spike M17 |
| F18 | 纯客户端插件的宿主半边可以只是一个空 `apply`（给 Loader 一行 host-side row） | `$HOST_RUNTIME/…/dsh-client-ui-brand-official/lib/index.js:1-9` |
| F19 | `packages/domain` 的入口 `export * from './ids.ts'`，而 `ids.ts` 值导入 `node:crypto`；任何把 domain（以及经它的 ui-model、client）打进浏览器 bundle 的尝试都会在解析阶段失败 | `packages/domain/src/ids.ts:2`；`packages/domain/src/index.ts:6` |
| F20 | CI 的 verify lane 在 `actions/checkout` 之后执行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`；`pnpm test` 覆盖 `tests/integration`；Node 版本取 `.nvmrc`（26），pnpm 取 `packageManager`（10.28.2） | `.github/workflows/ci.yml:20-41`；`package.json` |
| F21 | `dist/` 被 `.gitignore` 忽略；size 规则排除 `dist/` 与锁文件，其余非 `docs/`、非 `.md` 文件都算代码 | `.gitignore`「构建产物」段；`scripts/rule-checks.mjs:284,344-357` |
| F22 | 官方 publish 文档只在「从 git 安装时的 `prepare` 构建」一段提到 tsdown 配置；分发构建产物的两种形式是发布到 npm，或 `pnpm pack` 后 `dsh plugin add ./x.tgz` | <https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish> |
| F23 | npm 元数据：`esbuild` 当前 0.28.2，`engines.node >=18`，有 `postinstall: node install.js`；`tsdown` 当前 0.23.0，`engines.node ^22.18.0 \|\| ^24.11.0 \|\| >=26.0.0`，14 个直接依赖（含 `rolldown ~1.2.7`） | `npm view esbuild version scripts engines --json`；`npm view tsdown version engines dependencies --json` |
| F24 | `dsh plugin` 在本机依赖一个可以直接 spawn 的 pnpm，需要只对守卫函数生效的 PATH 垫片（人类伙伴已判定不影响结论）；同名同版本 tarball 必须先 `remove` 再 `add`；web 应用把带令牌的 URL 打到 stdout；profile 关闭 `autoInstallPeers`。**Desktop 路线**（2026-09-30）：PATH 垫片不需要——`dsh plugin` 用 Desktop 自带的 pnpm 11.7.0，经 Electron 的 `execPath` 运行（F30），M13 只对 npm 发行的 CLI 成立；M14 按原规则沿用；M5 在 Desktop 下落到 Electron 主进程的 stdout（F28、F29）；M21 在真实 `$DESKTOP_PROFILE/pnpm-workspace.yaml` 里核对为 `autoInstallPeers: false` | spike M13、M14、M5、M21；§11.5 PATH 垫片行；§11.10 `dsh plugin` 一行 |
| F25 | **`DSH_HOME` 隔离不覆盖首次使用的默认工作区目录**：浏览器第一次进入宿主时，UI 自发调用 `workspace/initializeDefault`，宿主在**真实账户**的 `<Documents>/deepseek-harness/default-workspace` 下建目录（#225 实测已建出两个空目录，是否删除由人类伙伴决定）。macOS 上这个位置经 `osascript` 取得，不看 `HOME`；唯一的覆盖手段是 `workspace-controller` 行的 `documentsDirectory` 配置 | spike §11.5「附带写入」与「收尾核对」（#225 本地 head `d10d0ad` 的订正）；`$HOST_RUNTIME/…/dsh-api-workspace-controller/README.md` 的 First-use Workspace 段（配置表）；同包 `lib/index.js:609-640`；`$HOST_RUNTIME/…/dsh-web-app/cordis.patch.yml:141-142`（行 `id: workspace-controller`）；`$HOST_RUNTIME/…/cordis-plugin-include/README.md`（patch 可以按 `id` 覆写字段）。**对本计划的验收 Superseded by D24（2026-09-30）**：验收用人类伙伴真实的 `desktop` profile，其默认工作区早已存在，H 路线不引入新的首次使用写入，也不覆写 `documentsDirectory`；机制在 0.2.0-rc.2 不变（`$ASAR:dsh/node_modules/@deepseek-ai/dsh-api-workspace-controller/lib/index.js:586,609-640`），事实对 #229 / #230 的 npm 路线仍成立（TD-I） |
| F26 | pnpm 10.28.2 在工作区根目录之下、但不是工作区成员的目录里打包 private 包：退出 0，遵守 `files`，但**额外放进仓库根的 `LICENSE`**（tarball 里的 `package/LICENSE` 与仓库根 `LICENSE` 的 sha256 相同） | 2026-09-29T16:07Z 独立评审在本工作树被忽略的 `apps/harness-plugin/dist/package` 里放一个最小 manifest 与两个 JS 文件（`files` 只列一个），执行 `pnpm --dir apps/harness-plugin/dist/package pack --pack-destination ..`；`tar -tzf` 列出 `package/lib/index.js`、`package/package.json`、`package/LICENSE`；随后删除这次探测建出的 `dist/` |
| F27 | **Desktop 版本与运行时**：应用包版本 `0.2.0-rc.2`；Electron Framework `44.0.0`；`runtime/versions.json` 写 node `24.18.1`、pnpm `11.7.0`；宿主子进程由 Electron 主进程以 Node 模式 spawn，所以插件宿主半边跑在 Node 24.18.1 上（`runtime/primary-runtime` 里另有 Node 24.21.0，供工具使用）；兼容闸门取的运行时版本是 `dsh-app-boot` 的 `0.2.0-rc.2`；`app-update.yml` 的更新通道是 `nightly` | `defaults read "$DESKTOP_APP/Contents/Info.plist" CFBundleShortVersionString`；`/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$DESKTOP_APP/Contents/Frameworks/Electron Framework.framework/Resources/Info.plist"`；`cat "$DESKTOP_APP/Contents/Resources/runtime/versions.json"`；`$ASAR:lib/main.js:3671-3697`（`DesktopHostProcess.start`）；`$ASAR:dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:271-275` |
| F28 | **Desktop 如何起宿主**：`dsh-desktop-host` 以 `runProfile` 启动 `desktop` profile，参数固定为 `--no-open --port 19387`（产品常量，§11.10），启动前调用 `reportSkippedBundles`；就绪后把 `authenticatedUrl` 经 IPC 的 `ready` 消息交给 Electron；web 应用行 `printUrl: true`，所以宿主同时往自己的 stdout 打一行 `dsh web: <带令牌的 URL>` | `$ASAR:dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js:215-235,337-343`（`:222` 是 `reportSkippedBundles`）；`$ASAR:dsh/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml:194`；同包 `lib/index.js:203` |
| F29 | **Desktop 转出宿主 stdout、吞掉宿主 stderr**：Electron 主进程对宿主子进程 `stdout.pipe(process.stdout)`，stderr 只保留最后 64 KiB 在内存里、宿主退出时拼进错误信息。所以 F13 的跳过行、F14 的审计在 Desktop 运行期间不可见；插件宿主半边的 `console.info` 走 stdout，Desktop 用 `open --stdout <文件>` 启动时可以落到文件。崩溃报告写在 `app.getPath('logs')`（macOS 上是 `~/Library/Logs/DeepSeek Harness`） | `$ASAR:lib/main.js:3691-3697`；`:10989-10990`；`@deepseek-ai/*` 各包 `lib/index.js` 都不改写 `console`（2026-09-30 全量 grep 无命中） |
| F30 | **`desktop` profile 的 CLI 面**：CLI 对 `desktop` profile 只允许 `plugin` 子命令，其余（含 `--dump-config`）一律报 `profile "desktop" is managed exclusively by the Electron application`；`dsh plugin --profile desktop` 要求 profile 已由 Desktop 初始化，在 profile 写锁下直接跑 pnpm，并提示先完全退出 Desktop。应用包自带启动器 `runtime/cli/bin/dsh`，它以 Electron 的 Node 模式运行 CLI 并用自带 pnpm 11.7.0；菜单「Manage dsh command」只是把 `/usr/local/bin/dsh` 做成指向这个启动器的符号链接，所以按绝对路径调用启动器等价，不改系统路径 | `$ASAR:dsh/node_modules/@deepseek-ai/dsh/lib/bin.js:35-37,112,119`；`$ASAR:dsh/node_modules/@deepseek-ai/dsh/lib/plugin-BGnVfe_D.js:10-12,64-69,89-93`；`$ASAR:dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js:91-105`；`$DESKTOP_APP/Contents/Resources/runtime/cli/bin/dsh`；同目录 `command-manager.js:504-506`；`which dsh` 无输出 |
| F31 | **范围 peer 在 0.2.0-rc.2 上的语义**：闸门用 `semver.satisfies(runtime, range, { includePrerelease: true })`，Desktop 自带 semver `7.8.5`。`~0.2.0-rc.2` 接受 `0.2.0-rc.2`、`0.2.0-rc.3`、`0.2.0`、`0.2.1-rc.1`、`0.2.1`、`0.2.9`，拒绝 `0.2.0-rc.1`、`0.3.0-rc.1`、`0.3.0`；精确 `0.2.0-rc.2` 只接受它自己；`@deepseek-ai/cordis` 不是 `dsh-*`，闸门不看，`~4.0.4` 与运行时的 cordis `4.0.4` 相符。安装时也判定：tarball spec 在 pnpm 装完之后判定，不兼容就恢复 `package.json` 与锁文件、以 1 退出并打 `installation rejected` | 定稿者 2026-09-30 从 `$ASAR:dsh/node_modules/semver/` 只读取出到一次性目录，逐个跑 `satisfies`；`$ASAR:dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:286-316`；`$ASAR:dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/types/operations.js:246-525` |
| F32 | **Desktop 产品埋点**：`product-analytics` 与导出行 `desktop-product-telemetry` 只在 profile 名为 `desktop` 时启用，`enabled` 默认 `true`，没有界面开关；事件含 Plugins 页的 `plugin_install_click`、`plugin_toggle`（路径类输入被替换成 `[path-or-other]`）；普通 Web 客户端从不提交这些事件；`DSH_TELEMETRY_DISABLED` 只管 `dsh-base` 的 `session-telemetry-otel` 行 | `$ASAR:dsh/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml:45-62`；`$ASAR:dsh/node_modules/@deepseek-ai/dsh-client-product-analytics/README.md:12,34`；`$ASAR:dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml:191-204` |
| F33 | **启动令牌与 cookie**：`authenticatedUrl` 把按进程生成的启动令牌放进查询串，进程存活期间可重复使用；带令牌的根路径 GET 换来一个绑定 `host:port`、`HttpOnly; SameSite=Strict`、默认 30 天有效的 cookie，用 `DSH_HOME` 凭据里的持久浏览器会话密钥签名，跨宿主重启仍有效。Electron 窗口自己的源是 `dsh-app://app`，由主进程持 cookie 转发到宿主 | `$ASAR:dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js:296-297,344-420,802`；`$ASAR:lib/main.js:7422-7464` |
| F34 | Desktop 主窗口开启了开发者工具：`webPreferences.devTools: true`，隐藏菜单项 `toggleDevTools` 绑定 F12 | `$ASAR:lib/main.js:11099-11106,11921-11932` |
| F35 | Desktop 按 `DSH_HOME` 定位数据根与 `desktop` profile（`resolveDshHome` 的优先级：显式配置 > `$DSH_HOME` > `~/.dsh`）。本计划按人类伙伴的决定不用它（D22），未实测 | `$ASAR:lib/main.js:56-72,11186` |

### 硬约束（constraint）

- 代码变更 ≤ 800 行（规划弹性上限；CI 硬上限 1000），文档变更 ≤ 1300 行，按 `node scripts/rule-checks.mjs size test/harness-plugin-reprobe` 计。
- 依赖方向不变：`apps/*` 只依赖 ui / ui-model / client / domain；apps 只做壳。本 PR 不改 `EXPECTED` 与 `EXTERNAL_ALLOW`。
- MMP 前不做兼容层（不为旧宿主版本、旧 manifest 形状写分支）。
- `docs/` 自包含：不写本机绝对路径、令牌、端口、用户名、主机名；宿主公开标识符按 D3 可写（Desktop 的固定端口 `19387` 是产品常量，§11.10 已写，可以写；macOS 默认安装位置 `/Applications/DeepSeek Harness.app` 不含账户信息，可以写）。
- ~~观测只用一次性 `DSH_HOME` 与 `--port 0`；严禁写入真实 `~/.dsh`。~~ Superseded by D22（2026-09-30）：验收在人类伙伴真实的 `desktop` profile 上进行；允许写入的只有 `Design / Spec` §7 列出的那些（`dsh plugin --profile desktop add` / `remove` 及其 pnpm 在 `$DESKTOP_PROFILE` 下的产物），真实 `~/.dsh` 的其余文件一概不改。

### 假设（assumption）与未知（unknown）

| # | 内容 | 由谁、在哪一批验证 |
|---|---|---|
| A1 | pnpm 10.28.2 默认不运行 esbuild 的 `postinstall`，esbuild 仍能经可选平台包工作；`pnpm install --frozen-lockfile` 退出 0 | T0（Batch 1）在本机实测；CI 首次运行复核 |
| A2 | ~~在工作区根目录之下、但不是工作区成员的 `dist/package` 里执行 `pnpm pack`，pnpm 10.28.2 照常打包 private 包~~ | **已成立，转为 F26**（附带发现 `LICENSE` 会被放进包里）；T2 在真实产物上复核一次 |
| A3 | `private: true` 不影响 `dsh plugin add <tgz>`（Desktop 路线下由 pnpm 11.7.0 执行，F30） | K1 实测。**已成立**（2026-09-30，K1） |
| A4 | 在 `lib: ES2023`、无 DOM 库、`skipLibCheck: true` 下，`@types/react` 18.3 能让 `createElement('section', …)` 与 `createElement('svg', …)` 通过 `pnpm typecheck` | T1 实测；不行时只在 `packages/ui/src/placeholder.ts` 内收窄写法，不改 `tsconfig.base.json` 的 `lib` |
| A5 | 在 scratch profile 的用户 patch（`$DSH_HOME/profiles/web/cordis.patch.yml`）里按 `id: workspace-controller` 覆写 `config.documentsDirectory`，能把首次使用的默认工作区目录改到 `$SCRATCH/documents` 下（F25） | K2 的 `--dump-config` 先看到覆写值；K7 核对真实 `<Documents>/deepseek-harness` 前后不变、`$SCRATCH/documents/deepseek-harness/default-workspace` 被建出。不成立时停在 Batch 5 之前，把情况报给人类伙伴，由其决定是否仍做浏览器观测。**Superseded by D24（2026-09-30）**：验收不再用 scratch profile，不覆写 `documentsDirectory`，A5 不再验证 |
| A6 | Desktop 以 `open -a "$DESKTOP_APP" --stdout <文件>` 启动时，宿主子进程的 stdout 经 Electron 主进程落进该文件（静态依据 F29） | K3（1）里 `dsh web:` 行的计数。为 0 时请人类伙伴改从终端直接启动 `"$DESKTOP_APP/Contents/MacOS/DeepSeek Harness" > "$SCRATCH/desktop.out" 2> "$SCRATCH/desktop.err" &` 再测一次；仍为 0 就把 K3（1）记为「未观测到」并停下报给人类伙伴，不用别的证据代替。**已成立**（2026-09-30，K3（1）：`dsh web:` 行计数为 1） |
| A7 | Plugins 页会显示「已选中但加载失败」的 bundle 的错误（`$ASAR:dsh/node_modules/@deepseek-ai/dsh-plugin-manager/README.md:42`） | 静态依据；K3（4）只能观测到「没有显示错误」，不能证明页面有能力显示。D24 接受这一强度（`Design / Spec` §10 R5） |
| U1 | esbuild 的 CJS 输出（导出是 getter、带 `__esModule`、`require("react")` 结果按属性访问）在真实宿主里能否物化并调到 `apply` | **已成立**（2026-09-30，K4、K5：Desktop 0.2.0-rc.2 上入口出现、面板渲染）。K4、K5；静态依据是 F8、F7；输出形状已用 esbuild 0.28.1 在一次性目录里核对（`module.exports = __toCommonJS(...)` 在 banner 定义的 `module` 上赋值，导出是惰性 getter，没有 `"use strict"` 前缀）。2026-09-30 订正：锁定的 0.28.2 在 banner 之后输出一行 `"use strict";`，见 Surprises |

**主不确定性**是 U1 加上「构建产物整体被真实宿主接受」这一件事。它只能由 K1、K3、K4、K5 判定。

### 三份独立设计与本计划的取舍

三位设计者分别从「构建与打包」「宿主契约与最小面」「验证与交付」三个视角给出设计。独立评审按 P0–P3 列出的问题与最终取舍如下（完整依据见 `Decision Log` D4 与 `Surprises & Discoveries`）：

| 来源 | 采纳 | 不采纳及原因 |
|---|---|---|
| 设计 1（tsdown） | 占位组件放 `packages/ui`；apps 只注册；client 外置表精确等于基线 ∪ `dsh.client.external`；boundaries 壳断言；安装件 manifest 由构建生成 | **P2** tsdown：0.x 的 `deps.*` 在 pnpm 软链下的语义是它自认的未知项，依赖面 14 个包，engines 比仓库窄（F23）。**P3** 以「官方文档点名 tsdown」为依据，但文档只在 git 安装的 `prepare` 一段提到它（F22）；集成测试往工作树 `dist/` 写产物（改为临时目录）；source map 只断言「无绝对路径」，挡不住经家目录的相对路径（改为不出 source map）；S2 实测用的是 pnpm 12.5.1，结论「tarball 只含 `files` 与 `package.json`」在仓库锁定的 10.28.2 上不成立（F26） |
| 设计 2（esbuild + publishConfig） | 不变量「`dsh.client.inject` ⊆ peers」「所有 dsh-* peer 同一精确版本」（2026-09-30 改为「同一个范围」，D20）；esbuild | **P1**：误称不兼容 peer 会让启动失败（引 `app-boot:929-930` 的 throw），实际这个 throw 在 `:939-943` 被捕获，包被跳过、宿主照常启动（F13）；它的宿主半边是空 `apply`，验收 1 的判据（P2）只数点名本条目的激活诊断，跳过会被判成通过（它的 P3 取 boot 行能兜住，但不属于验收 1 的判据），而它以「启动直接失败」论证 peer 策略是 fail closed。**P2**：`publishConfig` + devDependencies 让「无 workspace 依赖」依赖 pnpm pack 的改写行为，测试读不到真正的安装件；「打包策略」用浏览器配置打 `@harness-projects/domain` 会因 `node:crypto` 失败（F19）；client 外置 `@deepseek-ai/*` 通配 |
| 设计 3（esbuild + 生成 manifest + K 行） | 两份 manifest 的职责划分；metafile 来源审计；Proxy ctx 复刻 M17；预注册 K 行、sha256 防 M14、K3c 阴性对照、证据绑定树哈希；构建写临时目录 | **P1**：把 `@deepseek-ai/*` peer 写进源 manifest，在 `autoInstallPeers: true`（F3）下会把宿主 rc 包装进仓库锁文件与 CI，与它自己的「锁文件无 @deepseek-ai」矛盾。**P3**：误称基线表读不到（F6） |

三份设计共有的缺口（评审复核后补进本计划）：

- **P2** 都没有把 `skipping profile bundle` 列为失败判据（F13）。本计划的 K3 同时要求正面证据（就绪行、`--dump-config` 行）与负面判据。
- **P2** 负面判据只按「诊断行计数」写，没有对照：宿主自带条目在 scratch 环境里本来就可能报诊断（计数为 0 会误判失败），而本插件拖垮 `client-modules` 的聚合激活时，诊断点名的是 `client-modules` 那一行而不是本插件（只按本插件名过滤会漏判）。本计划加一次未装本插件的基线启动 Kb，K3 要求「诊断行集合 ⊆ 基线集合，且没有一行点名本插件」。**Superseded by D24（2026-09-30）**：Desktop 不转出宿主 stderr（F29），诊断行比较不可观测；K3 改为就绪行（正面）加 Plugins 页无错误、无新崩溃报告（负面）。
- **P2** 都没有处理 F25：浏览器步骤会让宿主在真实账户的 `<Documents>` 下建目录，`DSH_HOME` 挡不住。本计划在 K4 之前用 `documentsDirectory` 覆写把它引到 `$SCRATCH`（A5），K7 核对真实目录前后不变，并在请人类伙伴确认浏览器观测时写明这一点（D18）。**Superseded by D24（2026-09-30）**：验收用真实 `desktop` profile，默认工作区早已存在，不再覆写。
- **P3** 都把 tarball 清单写成「恰好 4 个条目」；pnpm 会放进仓库根的 `LICENSE`（F26），按原判据 K0 必然失败。本计划的清单是 5 个条目。
- **P3** 都没有把 K 行对到 §11.9 第 4 条的复核方法：那一条要求构建产物「重跑 O0.1–O0.3 与 O3.x」。本计划的对应是 K1 ↔ O0.1、K3 ↔ O0.2、K4 ↔ O0.3 与 O4.1、K5 ↔ O4.2 的挂载部分、K6 ↔ O4.3；O3.x 是 transport，#227 没有 remote，随 #228 重跑。§11.10 的 0.2.0-rc.2 复测清单沿用同一映射，其中 O3.1–O3.4 移交 #228（D25）。

## Design / Spec

### 1. 交付物

- 构建：`apps/harness-plugin/scripts/build.mjs`（esbuild，D5）。一次调用产出 `<outDir>/package/` 下的四个文件，并在产物不合契约时以非零码退出。
- 壳层源码：`apps/harness-plugin/src/host.ts`（宿主半边）、`src/client.ts`（客户端半边）、`src/host-surface.ts`（宿主 API 的最小结构类型）、`src/index.ts`（只保留包头与 `packageId`）。
- patch：`apps/harness-plugin/cordis.patch.yml`，内容固定为：

  ```yaml
  - insert:
      - id: harness-projects
        name: '@harness-projects/app-harness-plugin'
  ```

- 占位组件：`packages/ui/src/placeholder.ts`，导出 `HARNESS_PANEL_TITLE`、`PlaceholderPanel`、`PlaceholderIcon`。
- 测试：`tests/integration/harness-plugin-artifact.test.js`（产物契约），`tests/contract/package-boundaries.test.js` 新增一条壳断言。
- 文档：本计划、`docs/adr/ADR-0009-harness-plugin-installable-artifact.md`（Proposed）及索引。

### 2. 两份 manifest

**源 manifest**（`apps/harness-plugin/package.json`）继续服从 F2：`name`、`private`、`type`、`exports['.'] = './src/index.ts'`、四个 `workspace:*` 依赖都不变。只新增：

```json
"scripts": {
  "build": "node scripts/build.mjs",
  "pack:plugin": "node scripts/build.mjs && pnpm --dir dist/package pack --pack-destination .."
},
"devDependencies": { "esbuild": "0.28.2" }
```

源 manifest **不写** `peerDependencies` 与 `dsh`：F3 下写 peer 会把宿主包装进仓库；`dsh` 块写在构建脚本里，与 peer 放在同一处。

**安装件 manifest**（构建生成 `dist/package/package.json`）按白名单构造，字段与取值：

| 字段 | 值 | 依据 |
|---|---|---|
| `name` / `version` / `description` | 取自源 manifest | 包名即 client 模块 id 与 patch 行 `name` |
| `license` | 取自仓库根 `package.json`（`Apache-2.0`） | 与 pnpm 放进包里的 `LICENSE` 一致（F26、D19） |
| `private` | `true` | D12 |
| `type` | `"module"` | 宿主半边是 ESM |
| `main` | `"./lib/index.js"` | F18 先例 |
| `exports` | `{ ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json", "./cordis.patch.yml": "./cordis.patch.yml" }` | F9、F10、F15 |
| `files` | `["lib/index.js", "lib/client.js", "cordis.patch.yml"]` | 只装这三个文件加 `package.json`；pnpm 另外放进仓库根的 `LICENSE`（F26，接受，D19） |
| `peerDependencies` | `{ "@deepseek-ai/cordis": "~4.0.4", "@deepseek-ai/dsh-client-ui-slots": "~0.2.0-rc.2", "@deepseek-ai/dsh-client-ui-layout": "~0.2.0-rc.2", "@deepseek-ai/dsh-client-ui-sidebar": "~0.2.0-rc.2" }`。两个取值只在 `build.mjs` 的常量 `HOST_DSH_PEER_RANGE`（`~0.2.0-rc.2`）与 `CORDIS_PEER_RANGE`（`~4.0.4`）里各写一次；至少一个 `dsh-*` peer（没有这类 peer 时闸门直接放行，F12）。原先三个 `dsh-*` 精确写 `0.1.7-rc.2`，Superseded by D20（2026-09-30） | D20；F12、F31 |
| `dsh` | `{ "manifestVersion": 1, "bundle": { "patch": "./cordis.patch.yml" }, "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-layout", "@deepseek-ai/dsh-client-ui-sidebar"] } }` | §11.7 #227 第 3 条；F10；`manifestVersion` 照 #225 探针（不被强制，M2） |
| `dependencies` / `devDependencies` / `scripts` | 不输出 | 安装件没有运行时依赖；`@harness-projects/*` 全部打进产物 |

`dsh.client.inject` 是包级的**到达顺序边**，指向声明 `main`（ui-layout）与 `sidebar.panellist`（ui-sidebar）的包；它与 client bundle 模块级导出的 Cordis 服务注入 `inject = ['slots']` 是两回事。

### 3. 构建（`apps/harness-plugin/scripts/build.mjs`）

对外契约见 `Interfaces and Dependencies`。行为：

1. 清空并重建 `<outDir>/package/lib`。esbuild 的 `absWorkingDir` 固定为仓库根（由脚本位置推出），所以产物里的路径注释与 metafile 输入都是相对仓库根的路径，与 `outDir` 在哪里无关。
2. **宿主半边**：入口 `apps/harness-plugin/src/host.ts` → `lib/index.js`；`format: 'esm'`、`platform: 'node'`、`target: HOST_NODE_TARGET`（`'node22'`，不高于 Desktop 的 Node 24.18.1、仓库 `engines.node >=22.0.0` 与 CI / 本机的 Node 26，D26）、`bundle: true`、`external: ['@deepseek-ai/*']`（Node 内置模块由 `platform: 'node'` 自动外置）；其余全部打入。覆盖证据：集成测试 c 在 Node 26 上加载宿主半边，K3 在 Electron 的 Node 24.18.1 上加载。
3. **客户端半边**：入口 `apps/harness-plugin/src/client.ts` → `lib/client.js`；`format: 'cjs'`、`platform: 'browser'`、`target: 'es2022'`、`bundle: true`、`external` **恰好等于** `CLIENT_BASELINE ∪ CLIENT_EXTERNAL`（不用通配符）、`define: { 'process.env.NODE_ENV': '"production"' }`；
   - `banner.js` = `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`
   - `footer.js` = `return module.exports; } });`
   - 基线之外的任何导入都会被尝试打入：非基线的 `@deepseek-ai/*` 在仓库里不存在，解析失败；`node:*` 在浏览器平台解析失败（F19）。两者都让构建失败，这就是 fail closed。
4. 两个半边都 `packages: 'bundle'`（显式写出；esbuild 0.28.1 在 `platform: 'node'` 下的缺省已是打入，独立评审在一次性目录里核对过，显式写出是为了不依赖缺省值）、`sourcemap: false`、`minify: false`、`metafile: true`（D11）。
5. **构建闸门**（任一不满足就抛错、不写安装件 manifest）：
   - client metafile 输出里 `external: true` 的导入 ⊆ `CLIENT_BASELINE ∪ CLIENT_EXTERNAL`；
   - host metafile 输出里 `external: true` 的导入，要么以 `@deepseek-ai/` 开头，要么是 Node 内置模块；
   - 两个产物里都不出现 `@harness-projects/` 形式的模块说明符。
6. 复制 `apps/harness-plugin/cordis.patch.yml`，按 §2 写安装件 manifest。
7. 返回 `{ packageDir, manifest, metafiles: { host, client } }`；作为命令运行时解析 `--out <dir>`，缺省为 `apps/harness-plugin/dist`。

### 4. 壳层源码（`apps/harness-plugin/src`）

- `host.ts`：`export function apply(): void { console.info('[harness-projects] host ready') }`。只导出 `apply`，形状与 F18 先例相同；就绪行是 K3 的正面证据（D10）。#228 在 ADR 之后改写它（#225 计划的 TD5）。
- `client.ts`：只导出两个名字：

  ```ts
  export const inject = ['slots']
  export function apply(ctx: ClientContext): void {
    ctx.slots.inject('main', () =>
      ctx.slots.register({ name: 'main', key: PANEL_ID }, PlaceholderPanel))
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 90, label: HARNESS_PANEL_TITLE }, PlaceholderIcon))
  }
  ```

  其中 `PANEL_ID = 'harness-projects'` 是模块内常量，组件与标题取自 `@harness-projects/ui`。只在根 Context 上读 `slots`（F17，D16）；不读 `remote`。
- `host-surface.ts`：本壳用到的宿主 API 的最小结构类型（`SlotsService.inject` / `register`、两类 register 选项、`ClientContext`），组件类型写成 `(...args: never[]) => unknown`，**不** import `react` 或任何 `@deepseek-ai/*` 类型包（D16、TD-D）。
- `index.ts`：保留 `Responsibility:` / `Allowed imports:` 头（F2），把 Responsibility 改为说明宿主半边与客户端半边分别由 `host.ts` 与 `client.ts` 构建；仍只导出 `packageId`，不 re-export `host.ts` / `client.ts`，避免 Node 侧按包名 import 时把 react 拉进来。

### 5. 占位组件（`packages/ui/src/placeholder.ts`）

- `HARNESS_PANEL_TITLE = 'Harness Projects'`：入口 `label`、面板 `aria-label` 与标题共用这一处。
- `PlaceholderPanel()`：`createElement('section', { 'aria-label': HARNESS_PANEL_TITLE, 'data-harness-placeholder': '' }, createElement('h2', null, HARNESS_PANEL_TITLE), createElement('p', null, <一句固定占位说明>))`。不读任何数据、不接受 props、不调用任何平台 API。
- `PlaceholderIcon()`：一个 `aria-hidden` 的内联 svg。
- 用 `createElement`，不用 JSX：仓库测试靠 Node 类型剥离运行，本 PR 不改 tsconfig 的 `jsx` 设置（TSX 留给 #229）。
- `packages/ui/package.json` 新增 `peerDependencies.react: "^18.3.1"` 与 `devDependencies`（`react ^18.3.1`、`@types/react ~18.3`），对齐宿主 React 18.3.1（F6）。F2 已允许 `react` 出现在 `packages/ui`。

### 6. 测试

**`tests/integration/harness-plugin-artifact.test.js`**（CI 的干净检出上运行，不需要宿主，不触网）。`before` 里 `mkdtemp` 一个目录，`await build({ outDir })`。断言：

| # | 断言 | 判别性 |
|---|---|---|
| a | 安装件 manifest：`name` 等于源 manifest；`exports` 四个键逐字等于 §2；`files` 覆盖全部产出且每个都存在；没有 `dependencies` / `devDependencies`；JSON 全文不含 `workspace:`；`dsh.client.platform === 'web'`；`dsh.bundle.patch` 指向的文件存在；`dsh.client.inject` 非空且每项都是 `peerDependencies` 的键；至少有一个 `@deepseek-ai/dsh-*` peer；所有 `@deepseek-ai/dsh` / `dsh-*` peer 都等于测试自带的字面量 `~0.2.0-rc.2`，`@deepseek-ai/cordis` 等于 `~4.0.4`（独立预期，不 import 构建常量；取值依据 D20）。原判据「同一个精确 semver（不含 `^ ~ * x`……）」Superseded by D20（2026-09-30） | 变异 M-g、M-j、M-l、M-m |
| b | 用 `yaml` 解析 `cordis.patch.yml`：恰好一个 `insert` 行，`id === 'harness-projects'`，`name` 等于包名 | 变异 M-d |
| c | 把 `package/` 拷进 `<tmp>/node_modules/@harness-projects/app-harness-plugin`，用 `createRequire` 解析包名、`/package.json`、`/client` 三个说明符都成功（复刻 F4、F9）；`import()` 包名得到的 `apply` 是函数，用桩 `console.info` 调用后记录到 `[harness-projects] host ready`；`lib/index.js` 文本不含 `@harness-projects/`、以 `.ts` 结尾的说明符与 `file:` | 变异 M-h、M-j |
| d | 在 `node:vm` 里执行 `lib/client.js`，桩 `window.__ModuleLoader__.load` 恰好被调用一次，`id` 等于包名；用只回答基线键的 `require` 调 `factory`（`react` 返回记录型 `createElement`，其余基线键返回空对象，非基线一律抛错）；按 F8 的规则解包（测试内逐字复刻那四行并注明出处）得到的对象上 `apply` 是函数、`inject` 含 `'slots'`；文本里所有 `require("…")` 的参数 ⊆ 测试自带的基线字面量表（注明取自 0.2.0-rc.2 的基线表函数 `rM()`，键与 0.1.7-rc.2 的 `WS()` 相同，F6） | 变异 M-a、M-b、M-c |
| e | 用 Proxy ctx 调 `apply`：根 Context 只暴露 `slots`，读任何别的属性就抛 `cannot get property "<p>" without inject`（复刻 M17）；`slots.inject` 记录名字并立即调用回调，`slots.register` 记录选项与组件。期望 `inject` 名字恰好是 `main` 与 `sidebar.panellist`；`main` 选项是 `{ name: 'main', key: 'harness-projects' }`；`sidebar.panellist` 选项含 `id: 'harness-projects'`、`label: 'Harness Projects'`；用记录型 `createElement` 调 `main` 的组件，根节点是 `section`，`aria-label` 为 `Harness Projects` | 变异 M-e、M-f |
| f | 两份 metafile 的每个 input 路径都是相对路径且不以 `..` 开头（构建只读本仓库）；产物文本与安装件 manifest 不含仓库根的绝对路径与 `os.homedir()` | 变异 M-k |

**`tests/contract/package-boundaries.test.js`** 新增一条：`apps/harness-plugin/src` 下没有 `.tsx`；所有源文件的 import 说明符都不匹配 `/^react(-dom)?(\/|$)/`（沿用该文件的 `sourceFiles` 与 `importSpecifiers`）。变异 M-i 证明判别性。

**变异表**（只在最终树上整表执行一次；每条先用 `git diff --stat` 加 grep 变异标记证明变异已生效，再跑测试记录变红的断言，然后 `git checkout -- <被变异的文件>` 还原并确认转绿；不入库）：

| 变异 | 期望变红 |
|---|---|
| M-a 去掉 banner / footer | d |
| M-b 在 `client.ts` 里值导入 `node:crypto` 并使用 | 构建抛错（`before` 失败） |
| M-c 在 `client.ts` 里值导入 `@deepseek-ai/dsh-api-gateway` | 构建抛错 |
| M-d patch 行 `name` 拼错一个字符 | b |
| M-e `main` 注册时去掉 `key` | e |
| M-f 面板组件改为读根 Context 的 `ctx.remote` | e |
| M-g 安装件 manifest 复制源 manifest 的 `dependencies` | a |
| M-h 宿主半边 import `@harness-projects/domain`，同时把 `@harness-projects/*` 加进宿主 `external` | 构建闸门抛错；去掉闸门再跑则 c 变红 |
| M-i `apps/harness-plugin/src/client.ts` 加 `import { createElement } from 'react'` | `pnpm run boundaries` |
| M-j 安装件 `exports` 去掉 `./package.json` | a、c |
| M-k 把 `absWorkingDir` 改为 `outDir` | f |
| M-l 安装件去掉全部 `dsh-*` peer（此时兼容闸门对它直接放行，F12） | a |
| M-m `HOST_DSH_PEER_RANGE` 改成精确 `0.2.0-rc.2` | a |

### 7. 宿主观测协议（K 行，预注册；执行前随计划提交，执行后不改判据）

> 2026-09-30 改写为 Desktop 版本（D22–D24）。与 2026-09-29 草案（scratch `DSH_HOME` + npm `dsh web` + Browser 窗格）的差别：Kb、K2、K3c 不再执行（D24）；K3 的负面判据由「诊断行 ⊆ 基线」改为 Plugins 页无错误、无新崩溃报告；K4–K6 默认由人类伙伴执行（D23）；不再覆写 `documentsDirectory`（F25 的注记）。草案从未提交、没有预注册效力，本节不保留它的原文，差别以本段为准。

#### 7.1 环境（A 步）

在检出 `feature/harness-plugin-package` 的工作树根目录运行；`<…>` 是不入库的本机值。

```bash
umask 077
export DESKTOP_APP="/Applications/DeepSeek Harness.app"   # macOS 默认安装位置；装在别处时只改这一处
export DSH_DESKTOP_CLI="$DESKTOP_APP/Contents/Resources/runtime/cli/bin/dsh"   # 应用包自带的启动器（F30），不装 /usr/local/bin/dsh
export DESKTOP_PROFILE="$HOME/.dsh/profiles/desktop"
export SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/hp227.XXXXXX")"
export TGZ="$SCRATCH/clean/apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.0.0.tgz"
mkdir -p "$SCRATCH/clean" "$SCRATCH/evidence"
desktop_down() { ! pgrep -f "$DESKTOP_APP/Contents/" >/dev/null && ! lsof -nP -iTCP:19387 -sTCP:LISTEN >/dev/null; }
# 只转发 plugin 子命令、只对 desktop profile；DSH_HOME 必须未设置（否则落到别的数据根，F35），Desktop 必须已完全退出（F30）
dsh_d() { [ -z "${DSH_HOME:-}" ] || { echo "refuse: DSH_HOME is set" >&2; return 2; }; desktop_down || { echo "refuse: Desktop is running" >&2; return 2; }; "$DSH_DESKTOP_CLI" plugin --profile desktop "$@"; }
# 只读取出 $ASAR 里的一个文件（asar 头：16 字节前缀后是 JSON 目录，文件体从 8 + 头长处按 offset 读；标 unpacked 的在 app.asar.unpacked 下）
asar_cat() { node -e 'const fs=require("fs"),[a,p]=process.argv.slice(1),fd=fs.openSync(a,"r"),b=Buffer.alloc(16);fs.readSync(fd,b,0,16,0);const h=Buffer.alloc(b.readUInt32LE(12));fs.readSync(fd,h,0,h.length,16);let n=JSON.parse(h);for(const x of p.split("/"))n=n.files[x];if(n.unpacked)process.stdout.write(fs.readFileSync(a+".unpacked/"+p));else{const o=Buffer.alloc(n.size);fs.readSync(fd,o,0,n.size,8+b.readUInt32LE(4)+Number(n.offset));process.stdout.write(o)}' "$DESKTOP_APP/Contents/Resources/app.asar" "$1"; }
touch "$SCRATCH/marker"; date -u +%FT%TZ
lsof -nP -iTCP -sTCP:LISTEN > "$SCRATCH/lsof.before"
```

每一行记录：命令、退出码、脱敏摘录、UTC 时间（取自 `date -u`、文件 mtime 或日志）、`git rev-parse HEAD`、`git rev-parse HEAD:apps/harness-plugin`，以及当次启动的 Desktop 版本（`defaults read "$DESKTOP_APP/Contents/Info.plist" CFBundleShortVersionString`）。证据属于哪一版产物，以安装件四个文件（`package.json`、`cordis.patch.yml`、`lib/index.js`、`lib/client.js`）的 sha256 为准：client bundle 还打进了 `packages/ui` 的代码，只看 `apps/harness-plugin` 的树哈希不够。四个 sha256 任何一个变化，K0–K6 全部重跑（每轮都要走一遍 H1–H4）；同一行多次尝试时取最后一次，旧尝试保留在 Progress。

K 行与 §11.9 第 4 条、§11.10 复测清单的对应：K1 ↔ O0.1，K3 ↔ O0.2，K4 ↔ O0.3（入口出现即证明 factory 已执行、`apply` 已运行）与 O4.1，K5 ↔ O4.2 的挂载部分，K6 ↔ O4.3；O3.1–O3.4 与 O4.2 的数据部分移交 #228（D25）。

#### 7.2 K 行

| ID | 判据 | 谁 | 命令或动作 | 决定项 |
|---|---|---|---|---|
| K0 | 干净检出上构建成功；`$SCRATCH` 里除本协议建立的目录外没有别的检出；tarball 清单恰好是 `package/package.json`、`package/cordis.patch.yml`、`package/lib/index.js`、`package/lib/client.js`、`package/LICENSE`（F26）；安装件 manifest 的 `workspace:` 计数为 0；锁文件的 `@deepseek-ai` 计数为 0 | A | `git archive --format=tar HEAD \| tar -x -C "$SCRATCH/clean"`；在 `$SCRATCH/clean` 里 `pnpm install --frozen-lockfile --offline` 与 `pnpm --filter @harness-projects/app-harness-plugin run pack:plugin`；`tar -tzf "$TGZ"`；`tar -xzOf "$TGZ" package/package.json \| grep -c 'workspace:'`；`grep -c '@deepseek-ai' pnpm-lock.yaml`；`shasum -a 256 "$TGZ"` | 是（验收 3） |
| Kp | 前置快照（K7 的对照）：`desktop_down` 退出 0；Desktop 版本与闸门运行时版本（`dsh-app-boot` 的 `version`）都是 `0.2.0-rc.2`；`$DESKTOP_PROFILE/package.json` 存在（F30）；四个配置文件的 sha256 与顶层条目清单立即写进 Progress | A（H1 之后） | `defaults read "$DESKTOP_APP/Contents/Info.plist" CFBundleShortVersionString`；`asar_cat dsh/node_modules/@deepseek-ai/dsh-app-boot/package.json \| grep '"version"'`；`tar -C "$HOME/.dsh/profiles" -cf "$SCRATCH/desktop-profile.before.tar" desktop`；`(cd "$DESKTOP_PROFILE" && shasum -a 256 package.json pnpm-workspace.yaml cordis.yml cordis.patch.yml)`；`ls -A "$DESKTOP_PROFILE"` | 否 |
| K1 | `dsh_d add "$TGZ"` 退出 0；输出里没有 `installation rejected`，没有使用 `allow-version` / `--accept-risk`；`$DESKTOP_PROFILE/package.json` 的 `dependencies` 与 `dsh.profile.bundles` 都含包名（原 K2 的内容并入这里，D24）；`$DESKTOP_PROFILE/node_modules/@harness-projects/app-harness-plugin/lib/` 下两个文件的 sha256 等于 `$SCRATCH/clean/apps/harness-plugin/dist/package/lib/` 下的同名文件 | A | `dsh_d add "$TGZ"; echo "exit=$?"`（以后每次重装都先 `dsh_d remove @harness-projects/app-harness-plugin` 再 `add`，M14）；`node -e 'const j=require(process.argv[1]),n="@harness-projects/app-harness-plugin";console.log(n in j.dependencies, j.dsh.profile.bundles.includes(n))' "$DESKTOP_PROFILE/package.json"`（期望 `true true`）；两侧 `shasum -a 256` | 是（验收 1） |
| K3 | 同时满足：（1）`grep -cF '[harness-projects] host ready' "$SCRATCH/desktop.out"` ≥ 1，且 `grep -c '^dsh web: ' "$SCRATCH/desktop.out"` ≥ 1（后者只证明 stdout 已落进文件，A6）；（2）启动 30 秒后 Desktop 进程仍在、`19387` 上恰有一个监听；（3）`$HOME/Library/Logs/DeepSeek Harness` 下没有比 marker 新的文件（F29）；（4）Plugins 页里本 bundle 没有错误提示，`harness-projects` 行显示为启用、没有失败标记（`K3.png`；F13 的跳过与 F14 的失败在 Desktop 下只能从这里看到，A7） | A（1–3）+ H（4，H3c） | H2 启动；对 `desktop.out` 只用 `grep -c` 或 `grep -F '[harness-projects]'`，**不** `cat`、不打印任何别的行（其中有带令牌的 URL，F33）；`pgrep -f "$DESKTOP_APP/Contents/MacOS/"`；`lsof -nP -iTCP:19387 -sTCP:LISTEN \| grep -c LISTEN`；`find "$HOME/Library/Logs/DeepSeek Harness" -newer "$SCRATCH/marker" -type f \| wc -l`（期望 0）；读 `K3.png` | 是（验收 1） |
| K4 | 侧栏里出现名为「Harness Projects」的入口 | H（H3a）；A 读图 | `K4.png` 与人类伙伴的文字确认 | 是（验收 2） |
| K5 | 点击入口后主区域出现标题「Harness Projects」与占位说明 | H（H3b）；A 读图 | `K5.png` 与文字确认 | 是（验收 2） |
| K6 | 开发者工具 Console 只看 Errors、过滤 `harness` 时没有条目 | H（H3d）；A 读图 | `K6.png` 与文字确认 | 是（验收 2） |
| K7 | 收尾：`dsh_d remove @harness-projects/app-harness-plugin` 退出 0；`package.json` 与 Kp 快照逐字节相同；另三个配置文件只记「相同 / 不同」，不同时逐项归因（人类伙伴在窗口里的操作或 Desktop 自身），不自动写回；`node_modules/@harness-projects` 不存在；profile 下含 `$SCRATCH` 的 json / yaml 文件（不含 `node_modules`、`.plugin-manager`）数为 0；新增顶层条目列成残留清单交 H5；`~/.dsh` 下比 marker 新的条目与 pnpm 用户级内容寻址库的新增只记计数并归因；启动前后 `lsof` 对照，除 `19387` 外没有新的长驻监听 | A（H4 之后）；H5 | 见下方代码块 | 否 |

K7 的命令（H4 之后执行）：

```bash
desktop_down && dsh_d remove @harness-projects/app-harness-plugin; echo "exit=$?"
mkdir -p "$SCRATCH/profile.before" && tar -C "$SCRATCH/profile.before" -xf "$SCRATCH/desktop-profile.before.tar"
for f in package.json pnpm-workspace.yaml cordis.yml cordis.patch.yml; do cmp -s "$SCRATCH/profile.before/desktop/$f" "$DESKTOP_PROFILE/$f" && echo "$f same" || echo "$f DIFFERENT"; done
test ! -e "$DESKTOP_PROFILE/node_modules/@harness-projects" && echo "plugin files gone"
comm -13 <(ls -A "$SCRATCH/profile.before/desktop" | sort) <(ls -A "$DESKTOP_PROFILE" | sort)   # 残留清单
grep -rlF "$SCRATCH" "$DESKTOP_PROFILE" --include='*.json' --include='*.yaml' --include='*.yml' --exclude-dir=node_modules --exclude-dir=.plugin-manager | wc -l
find "$HOME/.dsh" -newer "$SCRATCH/marker" -not -path '*/node_modules/*' | wc -l
lsof -nP -iTCP -sTCP:LISTEN > "$SCRATCH/lsof.after"
```

`package.json` 为 `DIFFERENT` 时，把 `diff` 给人类伙伴看，经同意后只把这一个文件从快照写回（`tar -C "$HOME/.dsh/profiles" -xf "$SCRATCH/desktop-profile.before.tar" desktop/package.json`）；写回是恢复，不是删除。K3（1–3）没有满足之前不进入 H3；不得用 jsdom、CI 结果、curl 或推测代替 K4–K6；K7 发现未能归因的变化时如实记录、不做破坏性删除，报给人类伙伴。

#### 7.3 人类伙伴亲手执行的步骤（前置清单）

agent 在会话里逐步给出带具体 `$SCRATCH` 值的命令与路径，每步等人类伙伴回复再继续。任何一行 K 行重跑，都要重走 H1–H4。

| 步 | 何时 | 人类伙伴做什么 | 回复 |
|---|---|---|---|
| H0 | Batch 4 之前，一次 | 在会话里选界面观测路线：默认 H 路线（本表）；B 路线（§7.4）的代价在那一节。不需要从菜单装「dsh command」：agent 直接调用应用包里的启动器（F30） | 「H 路线」或「B 路线」 |
| H1 | Kp、K1 之前 | 选一个 Desktop 没有进行中任务、近期也没有计划任务的时间（退出会中断它们）；用菜单「DeepSeek Harness → Quit」或 Command+Q **完全退出**（只关窗口不算，应用可能留在后台）；出现「有任务在运行」的确认框时按自己的判断处理 | 「已退出」（agent 用 `desktop_down` 核对） |
| H2 | K1 通过之后 | 在自己的终端里运行 agent 给出的启动命令 `open -a "$DESKTOP_APP" --stdout "$SCRATCH/desktop.out" --stderr "$SCRATCH/desktop.err"`（agent 事先用 `: > "$SCRATCH/desktop.out"` 清空这个文件）；**不要**从 Dock、Finder 或 Spotlight 启动（那样 stdout 不落文件，K3（1）无从观测）；Desktop 提示有更新时先不安装，在会话里说明 | 窗口出现后回复「已启动」 |
| H3 | K3（1–3）通过之后 | 在 Desktop 窗口里依次：a. 侧栏收起时先展开（macOS 上侧栏收起时整列隐藏），截图含「Harness Projects」入口的侧栏 → `K4.png`；b. 点击「Harness Projects」，截图主区域 → `K5.png`；c. 打开侧栏的 Plugins 页，**只看**，不点安装、不切换任何开关，截图 `@harness-projects/app-harness-plugin` 所在的一栏 → `K3.png`；d. 按 F12（或 Option+Command+I）打开开发者工具 → Console，级别只勾 Errors，过滤框输入 `harness`，截图 → `K6.png`。截图存进 agent 给出的 `$SCRATCH/evidence/`；截图可能含真实会话与工作区名称，只存本机、不上传 | 「已截图」，并用一句话说明 a–d 各自看到了什么 |
| H4 | 截图之后 | 同 H1，完全退出 Desktop | 「已退出」 |
| H5 | K7 之后 | 看 agent 列出的残留清单（预期是 `pnpm-lock.yaml`、`node_modules/`、`.plugin-manager/`，以及 pnpm 用户级内容寻址库的新增条目），决定是否删除（agent 不删）；`package.json` 需要写回时给出同意与否；可选：正常启动 Desktop，确认侧栏里已没有「Harness Projects」 | 对每一项的决定 |

agent 读截图时只转录与判据相关的元素（入口名称、面板标题与说明、Plugins 页里本 bundle 一栏的状态、Console 的过滤结果），不转录会话标题等其他内容；截图时间取 `TZ=UTC stat -f '%Sm' -t '%FT%TZ' <文件>`，必须晚于 H2 的启动时刻。

#### 7.4 B 路线（只在人类伙伴于 H0 选择时执行）

技术上可行：Desktop 的宿主在 `127.0.0.1:19387` 上是普通的 dsh web 服务，带令牌的 URL 由宿主打到 stdout（F28），H2 的启动方式会把它落进 `desktop.out`，令牌在进程存活期间可重复使用（F33）。但这个 URL 是人类伙伴**真实实例**的认证凭据，不是本会话生成的测试值，所以：

- H2 之后，由人类伙伴本人在自己的终端里 `grep -F 'dsh web:' "$SCRATCH/desktop.out"` 取出 URL，亲手粘进主会话 Browser 窗格的地址栏；agent 不读取、不转述、不输入这个 URL。
- 之后 agent 用同样的判据执行 K3（4）与 K4–K6：`read_page`（Plugins 页、侧栏入口、`main` 插槽）、`read_console_messages`（`onlyErrors`）、`read_network_requests`（pattern `plugins`，合并脚本为 200）；视口 1280×900（M22）；页面作为普通 Web 客户端可能弹出 Preview Notice，只点 Continue，不输入任何东西。
- 代价（人类伙伴选 B 即表示接受）：Browser 窗格得到一个 30 天有效、绑定 `127.0.0.1:19387`、由真实 `~/.dsh` 浏览器会话密钥签名的 HttpOnly cookie，跨 Desktop 重启仍有效（F33），能以人类伙伴的身份使用真实实例（含真实会话、已配置的模型密钥与能执行命令的工具）；本计划没有核实 Browser 窗格能否清除它；页面可能自发调用 `session/create` 在真实数据里留下一个空会话（§11.5 附带写入的同类行为）；agent 的可访问性树读取会看到真实会话标题。

#### 7.5 写入与埋点的披露

- **写入**：`dsh_d add` / `remove` 改写 `$DESKTOP_PROFILE/package.json`，并在该目录留下 `pnpm-lock.yaml`、`node_modules/`、`.plugin-manager/logs/`（pnpm 日志里有 `$SCRATCH` 下的 tarball 路径）；pnpm 用户级内容寻址库新增本包条目（`dsh plugin` 调 pnpm 时的环境同 §11.5 附带写入）；Desktop 运行期间照常写它自己的会话与存储。本计划只写回 `package.json`（经人类伙伴同意），其余残留由 H5 决定。
- **埋点**：Desktop 对 `desktop` profile 默认开启产品埋点，没有界面开关，`DSH_TELEMETRY_DISABLED` 管不到（F32）。本流程会触发的事件类别是 Desktop 启动与页面浏览（H2、H3）。安装与卸载走 CLI，H3 不在 Plugins 页点安装或开关，所以按静态读码不产生 `plugin_install_click`、`plugin_toggle`。人类伙伴 2026-09-30 已知情并接受（D22），本计划不做额外抑制；PR 描述写一句这项披露。

### 8. 被放弃的方案

- **tsdown**：与宿主自身构建同源，但 `__ModuleLoader__` 包装的共享 preset 没有随运行时发布，仓库外同样要自己写包装；0.23 的 `deps.*` 在 pnpm 工作区软链下的语义是未知项；14 个直接依赖；engines 比仓库 `>=22.0.0` 窄（F23）。它是 D5 的备选，替换成本只在 `build.mjs` 与一个 devDependency。人类伙伴 2026-09-30 确认仍用 esbuild（D21）。
- **`publishConfig` 改写源 manifest**：安装件的真实形状取决于 pnpm pack 的改写行为，测试读不到它；`workspace:*` 依赖会被改写成 `0.0.0` 留在安装件里。
- **peer 写进源 manifest（含 optional 写法）**：F3 下非 optional 会把宿主 rc 包装进仓库；optional 写法可行但把宿主契约放进了工作区 manifest，需要额外的契约测试去守。生成 manifest 在构造上就没有这个问题。
- **精确钉 `0.2.0-rc.2`**：能在宿主换 rc 时让插件被跳过，挡住 rc 之间的格式漂移；代价是每个 rc 都要重发。人类伙伴选了范围（D20）。
- **client 外置 `@deepseek-ai/*` 通配**：非基线的宿主包 require 能通过构建，只在浏览器里失败（F7）。
- **在 `ctx.inject(['slots'], cb)` 回调里注册**：#227 只读 `slots`，根 Context 加模块级 `inject` 是宿主自带插件的做法（F17）；回调写法留给 #228 引入 `remote.<ns>` 时。
- **占位组件写在 apps**：apps 会持有 React 组件，且 `@harness-projects/*` 打入 client bundle 这条路径在 #227 里得不到实测（§11.7 #227 第 1 条）。
- **随包发 source map**：构建目录在仓库外时，map 的相对 `sources` 会经过家目录；#227 不需要，留给 #230（TD-E）。
- **把宿主观测自动化进 CI**：CI 不能运行宿主（issue 验收 3 也要求构建不依赖宿主检出）。
- **另下载 npm 运行时、或以 `DSH_HOME` 指向一次性目录启动 Desktop**：隔离更好，但人类伙伴决定用已安装的 Desktop 与真实 profile（D22）；F35 只记录 Desktop 读 `DSH_HOME` 这一事实。
- **经应用内 Plugins 页用 tarball 安装**：可行（§11.10），但会产生 `plugin_install_click` 埋点（F32），安装输出不落到 agent 能读的地方，人类伙伴也要多点几步；本计划用 CLI（D24）。
- **`dsh --profile desktop --dump-config`**：CLI 拒绝（F30），原 K2 并入 K1。
- **B 路线作为默认**：见 §7.4 与 D23。

### 9. 评审者会怎么打破它（设计时预列）

1. 「CI 绿就算装得上」——K1、K3、K5 才是判据；§11.9 第 4 条说明构建产物从未被宿主观测过。
2. 「没有 did not activate 就是没有失败 fiber」——F13：不兼容的包被跳过时审计同样安静；K3 要求就绪行，并把 `skipping profile bundle` 计入负面判据。Desktop 下这两类诊断都在不转出的 stderr 上（F29），所以 K3 以就绪行为正面证据，以 Plugins 页的错误提示与崩溃报告为负面判据（D24）。
3. 「重装后看到的是新产物」——M14：一律先 `remove` 再 `add`，并用 sha256 核对已装内容。
4. 「测试用了和构建一样的常量」——测试自带基线字面量表、peer 范围字面量与 F8 的解包逻辑，不 import `build.mjs` 的常量做预期值。
5. 「红基线是在主检出上取得的」——每个工作树先 `pnpm install --frozen-lockfile` 并核对 `node_modules/@harness-projects/core` 的链接目标（`tests/README.md`）。
6. 「变异没生效却记成仍然绿」——每条变异先证明已生效。
7. 「截图拍的是旧状态」——每次 H2 之前 agent 先清空 `desktop.out`，截图 mtime 必须晚于该次启动；K3（1）的就绪行与截图属于同一次启动。

### 10. 风险（2026-09-30）

| # | 风险 | 缓解 / 去向 |
|---|---|---|
| R1 | `~0.2.0-rc.2` 放行 `0.2.x` 内任何 rc 与补丁：宿主在 rc 之间改变插件 API 或描述符格式时，插件不会被跳过，而是在运行时失败（人类伙伴接受的代价，D20） | #227 没有 typed remote，眼下暴露面只有插槽注册；#228 引入描述符时决定是否收紧（TD-B） |
| R2 | 验收写真实 `desktop` profile，留下残留（§7.5） | Kp 快照、K7 核对、H5 由人类伙伴决定；`Idempotence and Recovery` 的恢复路径 |
| R3 | Desktop 产品埋点会上报启动与页面浏览（F32） | 人类伙伴已知情并接受（D22）；CLI 安装、Plugins 页只看不点；PR 描述披露 |
| R4 | 更新通道是 `nightly`（F27），H1 与 H2 之间或验收期间 Desktop 可能升级 | 每次启动记录版本；H2 遇到更新提示先不装；版本变了就在 Surprises 记录，仍在 `0.2.x` 内则判据不变，超出范围则插件被跳过、K3 失败，如实报告 |
| R5 | K3（4）与 K4–K6 以人类伙伴截图为证，弱于机器读取的可访问性树；A7 只能证明「没有显示错误」 | K3（1）的就绪行由 agent 从日志取证；人类伙伴可在 H0 选 B 路线换取机器可读证据（代价见 §7.4） |
| R6 | 退出 Desktop 会中断人类伙伴进行中或计划中的任务 | H1 由人类伙伴选时间 |
| R7 | 插件可能拖垮 Desktop 启动 | 本插件的行不是必需条目；最坏情况下人类伙伴退出，agent `dsh_d remove`，再不行按快照恢复（`Idempotence and Recovery`） |
| R8 | 截图与 `desktop.out` 含私人信息与带令牌的 URL | 只存 `$SCRATCH`（`umask 077`），不上传、不入记录；令牌随 Desktop 退出失效（F33） |

## Global Constraints

- 目标宿主线 `0.2.0-rc.2`，安装件 peer 取值见 `Design / Spec` §2（D20）；验收宿主是人类伙伴本机的 Desktop `0.2.0-rc.2`（D22）；构建与 CI 用 Node 26（`.nvmrc`）；pnpm 10.28.2（`packageManager`）；esbuild 精确 `0.28.2`（D5，人类伙伴 2026-09-30 确认，D21）。原「宿主运行时版本 `0.1.7-rc.2`」Superseded by D20（2026-09-30）。
- 本 PR 的全部文件集合与所有权（**唯一一处声明**；各批次只列主文件，`Progress` 等处写「见 `Global Constraints`」）：

| 任务 | 所有者 | 可写文件 |
|---|---|---|
| T0 依赖与锁文件 | 实现者（Sonnet） | `apps/harness-plugin/package.json`、`packages/ui/package.json`、`pnpm-lock.yaml`、`tsconfig.base.json`（只改第 20 行注释）、`pnpm-workspace.yaml`（仅当 A1 不成立） |
| T1 占位组件与壳层源码 | 实现者（Sonnet） | `packages/ui/src/placeholder.ts`、`packages/ui/src/index.ts`、`apps/harness-plugin/src/index.ts`、`apps/harness-plugin/src/host.ts`、`apps/harness-plugin/src/client.ts`、`apps/harness-plugin/src/host-surface.ts`、`apps/harness-plugin/cordis.patch.yml` |
| T2 构建脚本 | 实现者（Sonnet） | `apps/harness-plugin/scripts/build.mjs` |
| T3 产物集成测试 | 测试作者（Sonnet，与 T2 不同的 agent） | `tests/integration/harness-plugin-artifact.test.js` |
| T4 壳边界断言 | 实现者（Sonnet） | `tests/contract/package-boundaries.test.js` |
| T5 ADR 与索引 | 文档作者（Sonnet） | `docs/adr/ADR-0009-harness-plugin-installable-artifact.md`、`docs/adr/README.md`、`tests/integration/README.md`、`tests/README.md`（§1 分层表 integration 行的「验证对象」补「插件安装件构建」） |
| T6 验收、观测与交付 | 验收者（Opus） | 本计划、`docs/README.md`；可对 T0–T5 的文件做验收重构，但不与仍在进行的任务并发写同一文件 |

- 本计划只由 T6 修改；T0–T5 的结果与证据写在各自的回复里，由 T6 转录。
- 禁止：改 `EXPECTED` / `EXTERNAL_ALLOW`；给 `apps/harness-plugin` 引入 controller / core / storage（#228，TD5）；改 `docs/architecture/harness-host-spike.md`（#225 的事实）；新增或修改 workflow；写入真实 `~/.dsh` 中 `Design / Spec` §7 允许之外的任何文件（允许的只有 `dsh_d add` / `remove` 及其 pnpm 在 `$DESKTOP_PROFILE` 下的产物，以及经人类伙伴同意后从快照写回 `package.json`；D22）；改 `$DESKTOP_PROFILE` 的 `cordis.patch.yml` / `cordis.yml`；删除 `~/.dsh` 或真实 `<Documents>/deepseek-harness` 下的任何东西（残留由人类伙伴决定，H5）；安装 `/usr/local/bin/dsh`；agent 读取、打印、转述或输入 Desktop 的带令牌 URL（F33）；agent 在 Desktop 窗口里做任何操作（那是 H 步）；在任何文件或记录里写本机绝对路径、临时端口、令牌。原「写入真实 `~/.dsh`」「没有 `documentsDirectory` 覆写时让浏览器进入 scratch 宿主」两条 Superseded by D22、D24（2026-09-30）。
- 所有 `git` 命令用 argv 形式；破坏性删除默认不做（`$SCRATCH` 保留）。

## Plan of Work

### Batch 0 · 对齐、计划与 draft PR（主会话）

**最小闭环**：计划与 Active 索引入库，draft PR 以 #225 的分支为 base 并关联 #227。
**涉及文件**：本计划、`docs/README.md`。

- [x] 在 `.worktrees/harness-plugin-package` 执行 `AGENTS.md` §6 的四条检查（2026-09-29：分支 `feature/harness-plugin-package`，起点 `6052f62` 与当时的 `test/harness-plugin-reprobe` 同一提交，工作区干净）。
- [x] 三份独立设计的评审与定稿写入本计划（D4）；2026-09-29T16:08Z 恢复会话后按 #225 的新 head `d10d0ad` 重新核对 §11，补 F25、F26、A5 与 D17–D19。
- [x] 2026-09-30：按人类伙伴的四项决定修订计划（独立定稿者；D20–D26）。
- [x] ~~快进到 #225 的本地 head：`git -C .worktrees/harness-plugin-package merge --ff-only test/harness-plugin-reprobe`~~ Superseded（2026-09-30）：#225 已改写历史，`6052f62` 不再是 `test/harness-plugin-reprobe` 的祖先，快进不可行。改为由主会话按 `git-expert-operations` 流程先建 backup ref，再把本分支变基到 `test/harness-plugin-reprobe`（本分支在 `6052f62` 之上没有提交，变基只移动起点；未跟踪的本计划与 `docs/README.md` 的改动不受影响，`docs/README.md` 的 #225 行若在新 base 上变了，以新 base 为准、只保留本计划这一行）。验证：`git merge-base --is-ancestor test/harness-plugin-reprobe HEAD; echo $?`（期望 `0`）。**完成（2026-09-30，主会话）**：先提交计划（`589d8e9`），建 backup ref `backup/harness-plugin-package-pre-restack`，`git rebase --onto origin/test/harness-plugin-reprobe 6052f62 feature/harness-plugin-package`；`docs/README.md` 冲突按上面的规则解决（#225 行取新 base，只保留本计划一行），新提交 `42e0cd6`，本层文件只有本计划与 `docs/README.md`。
- [x] 前置（2026-09-30：#225 的 head `6de03f1` 已推送并与本地一致）：#225 的本地 head 已推送，`git ls-remote origin test/harness-plugin-reprobe` 等于 `git rev-parse test/harness-plugin-reprobe`。没有推送时先不开 PR，否则 PR 的 diff 会混入 #225 未推送的提交。
- [x] **完成（2026-09-30，主会话）**：计划以 `42e0cd6` 提交（`Refs #227`）并推送；按 `docs/project-management/merge-queue.md` 的堆叠 PR 配方，先以 `--base main` 开 draft PR #245 登记关闭关联（#227 的 `closedByPullRequestsReferences` = [245]），再 `gh stack link 238 245` 建栈（stack #246），base 回到 `test/harness-plugin-reprobe`、`closingIssuesReferences` 仍为 [227]。原计划文字：提交 `docs(exec-plan): 为 #227 写插件打包计划`（正文 `Refs #227`）；推送；开 draft PR：`gh pr create -R SingularityKChen/harness-projects --draft --base test/harness-plugin-reprobe --head feature/harness-plugin-package`，描述含闭环、本计划与 Batch、`Closes #227`、`Refs #225 #226 #228 #229 #230`、风险与回滚。

**验证**：`node scripts/rule-checks.mjs disclosure test/harness-plugin-reprobe`（期望退出 0）；`git diff --check test/harness-plugin-reprobe...HEAD`（期望无输出）；`gh pr view <n> -R SingularityKChen/harness-projects --json baseRefName,isDraft,closingIssuesReferences`（期望 base `test/harness-plugin-reprobe`、draft、关闭引用含 227）。
**回滚**：关闭 draft PR；`git revert` 计划提交。

### Batch 1 · 依赖与锁文件（T0，串行先行）

**最小闭环**：esbuild 与 react 类型依赖入锁，仓库仍然全绿，锁文件里没有宿主包。
**涉及文件**：`apps/harness-plugin/package.json`、`packages/ui/package.json`、`pnpm-lock.yaml`。

- [x] 按 `Design / Spec` §2、§5 改两个 manifest；`pnpm install` 更新锁文件；记录 pnpm 关于 esbuild 构建脚本的原始输出（A1）。退出 0 时**不改** `pnpm-workspace.yaml`；退出非 0 时按 pnpm 输出点名的键把 esbuild 列为「忽略构建」（不允许运行），并记入 Surprises。（退出 0，未改；见 Progress）
- [x] `tsconfig.base.json` 第 20 行注释补一句：除 `apps/harness-plugin` 的安装件构建（ADR-0009）外没有构建步骤。
- [x] 提交 `chore(apps): 为插件构建引入 esbuild 与 react 类型依赖`（`b0fb240`）。

**验证**（在检出本批提交的工作树根目录运行）：
- `pnpm install --frozen-lockfile`（期望退出 0）
- `ls -l node_modules/@harness-projects/core`（期望 `-> ../../packages/core`）
- `grep -c '@deepseek-ai' pnpm-lock.yaml`（期望 `0`）
- `pnpm --filter @harness-projects/app-harness-plugin exec node -e "import('esbuild').then(e => console.log(e.version))"`（期望 `0.28.2`）
- `pnpm typecheck && pnpm run boundaries`（期望全绿）

**回滚**：`git revert` 本批提交，锁文件随之还原。

### Batch 2 · 并行实现（T1–T5，各自的工作树）

**最小闭环**：T1–T5 各自在 `.worktrees/harness-plugin-package-t<n>`（分支 `feature/harness-plugin-package-t<n>`，从 Batch 1 的提交切出）完成、自验、提交一个提交；文件集合互不重叠（见 `Global Constraints`）。
**涉及文件**：见 `Global Constraints` 的 T1–T5 行。

- [x] T3 先写测试并在 Batch 1 的提交上跑出红：`node --test tests/integration/harness-plugin-artifact.test.js`，期望失败原因是 `ERR_MODULE_NOT_FOUND` 指向 `apps/harness-plugin/scripts/build.mjs`；原样摘录。
- [x] T4 加壳断言；在 Batch 1 的提交上 `pnpm run boundaries` 绿；做变异 M-i 证明它会红，然后还原。
- [x] T1 写占位组件与壳层源码；`pnpm typecheck`、`pnpm run boundaries` 绿；`grep -rnE "from ['\"]react" apps/harness-plugin/src` 无输出。
- [x] T2 在合入 T1 之后写构建脚本（可先行编码，自验在 T1 之后）；`node apps/harness-plugin/scripts/build.mjs --out "$(mktemp -d)"` 退出 0；`pnpm --filter @harness-projects/app-harness-plugin run pack:plugin` 后 `tar -tzf apps/harness-plugin/dist/*.tgz` 恰好五个条目（四个产物加 `package/LICENSE`，F26）。
- [x] T5 写 ADR-0009（Proposed，Decision / Why / Rejected / Consequences 取自本计划 D5–D13、D20、D21、D26；D8 已被 D20 取代，按 D20 写 peer 范围）与两处索引。

每个任务的验证命令与依赖见本计划 `Interfaces and Dependencies` 与 T6 的汇总回复；每个任务的回复必须附命令原始输出摘录。
**回滚**：丢弃对应任务分支；各任务互不依赖对方的未合入文件（T2 依赖 T1 已合入）。

### Batch 3 · 集成与变异表（T6，Opus）

**最小闭环**：五个任务按 T4 → T1 → T2 → T3 → T5 的顺序 rebase 到 `feature/harness-plugin-package`，全仓库验证通过，变异表在最终树上整表通过。
**涉及文件**：无新增（验收重构只动 T0–T5 已有文件）。

- [x] 合入后执行下面的验证；整合前后用 `comm` 比对 `git ls-tree -r --name-only` 的文件集合，确认没有丢文件。
- [x] 按 `Design / Spec` §6 的变异表逐条执行并把「变异 → 生效证据 → 变红的断言 → 还原 → 转绿」写进 Progress。

**验证**：
- `pnpm install --frozen-lockfile && pnpm verify`（期望全绿）
- `pnpm run boundaries`（期望全绿）
- `node scripts/workflow-check.mjs`（期望原样通过，本 PR 不改 workflow）
- `node scripts/rule-checks.mjs size test/harness-plugin-reprobe`（期望代码 ≤ 800、文档 ≤ 1300）
- `node scripts/rule-checks.mjs disclosure test/harness-plugin-reprobe`（期望退出 0）
- `git diff --check test/harness-plugin-reprobe...HEAD`（期望无输出）

**回滚**：`git reset --hard <整合前的 backup ref>`（整合前先 `git branch backup/harness-plugin-package-<UTC> HEAD`）。

### Batch 4 · 构建与安装 K0、Kp、K1（T6；前置 H0、H1）

> 原「Batch 4 · 宿主侧观测 K0–K3c」与「Batch 5 · 浏览器观测 K4–K6（前置：人类伙伴对本 PR 另行确认；主会话执行）」Superseded by D22–D24（2026-09-30），改为下面两批。

**最小闭环**：在当前 head 上，干净检出构建的 tarball 装进 Desktop 的 `desktop` profile，安装前快照与安装证据都有记录。
**涉及文件**：本计划（Progress、Validation）。

- [x] 先把当前工作提交为本地 WIP（防会话中断丢失，`Idempotence and Recovery`）。（2026-09-30：进入本批时工作树干净，没有待提交的工作；本批的记录随各阶段的 `docs(exec-plan)` 提交入库）
- [x] 前置：（2026-09-30：CI 全绿、H0、H1 均已满足）Batch 3 的最终树已推送且 CI 全绿（树哈希变了 K 行要整组重跑，每一轮都要人类伙伴退出并重启自己的 Desktop）；人类伙伴完成 H0、H1（`Design / Spec` §7.3）。
- [x] 按 `Design / Spec` §7.1 建环境，依次执行 K0、Kp、K1；Kp 的 sha256 与顶层条目清单立即写进 Progress；证据里的真实路径与令牌替换成占位符。

**验证**：K0、K1 的判据逐条满足；`node scripts/rule-checks.mjs disclosure test/harness-plugin-reprobe` 退出 0。
**回滚**：`dsh_d remove @harness-projects/app-harness-plugin`，再按 K7 核对；`$SCRATCH` 保留不删。

### Batch 5 · Desktop 观测 K3–K6 与收尾 K7（H2–H5 与 T6）

**最小闭环**：人类伙伴启动 Desktop 并完成界面观测，agent 读日志与截图判定 K3–K6，随后卸载并核对 profile（K7）。
**涉及文件**：本计划（Decision Log、Progress、Validation）。

- [x] 清空 `$SCRATCH/desktop.out`，在会话里把 H2 的启动命令（带 `$SCRATCH` 的具体值）交给人类伙伴；收到「已启动」后执行 K3（1–3）。
- [x] K3（1–3）满足后请人类伙伴执行 H3；收到截图后读图，按 K3（4）与 K4–K6 的判据逐条记录。人类伙伴在 H0 选了 B 路线时改按 `Design / Spec` §7.4 执行。
- [x] 请人类伙伴执行 H4；执行 K7；把残留清单交给人类伙伴（H5），其决定写入 Decision Log。（2026-09-30：人类伙伴在 H4 的回复里授权 agent 直接执行后续步骤，H5 按 D33 执行）

**验证**：K3–K6 各有证据摘录与 UTC 时间；K7 的 `package.json` 为「相同」或差异已按人类伙伴的决定处理；残留清单与人类伙伴的决定已记录。
**回滚**：人类伙伴退出 Desktop 后 `dsh_d remove`；失败时按 `Idempotence and Recovery` 的 profile 恢复。人类伙伴暂时不能执行 H 步时：PR 保持 draft，验收 1 的 K3（4）与验收 2 标为未完成并写明原因，不用其他证据代替。

### Batch 6 · 定稿、整理提交与请人类评审（T6）

**最小闭环**：计划的 Progress / Outcomes 回填，提交序列整理成可独立审阅的几个提交，推送后回读远端，请人类伙伴评审。
**涉及文件**：本计划、`docs/README.md`。

- [x] 回填 Progress、Surprises、Outcomes、技术债务；`docs/README.md` 的状态列更新。
- [x] 整理提交（2026-09-30：代码提交已在 Batch 3 整理；本批只把本地的 Batch 4–5 提交合并为一个 `docs(exec-plan)` 提交，已推送的不改写）：`chore(apps)` 依赖、`feat(apps)` 壳与构建、`feat(ui)` 占位组件、`test(apps)` 产物契约与壳断言、`docs(adr)`、`docs(exec-plan)`；正文只写 `Refs #227`。整理前建 backup ref，整理后用 `comm` 比对文件集合；已推送的分支用精确的 `--force-with-lease=feature/harness-plugin-package:<旧 head>` 推送。
- [x] 发布面扫描（`docs/development/publication.md` 的机械扫描与五类目人工检查）。
- [x] PR 描述写明（2026-09-30：在本批推送之后更新）：验收在人类伙伴真实的 Desktop `desktop` profile 上进行、`Design / Spec` §7.5 的写入与埋点披露、H5 的残留处理结果、O3.1–O3.4 移交 #228（D25）。
- [x] 推送后回读 head、base、checks、`closingIssuesReferences` 与 review threads；验收 1–4 全部「已观测到」之前不执行 `gh pr ready`。

**验证**：`gh pr checks <n> -R SingularityKChen/harness-projects`（期望全部 pass）；`gh pr view <n> -R SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences`（期望 head 等于本地 `git rev-parse HEAD`、base `test/harness-plugin-reprobe`、关闭引用含 227）；在远端 head 的干净检出上重建，安装件四个文件的 sha256 与 K1 记录的相同，否则 K 行作废重跑（`Design / Spec` §7.1；原「证据里的 HEAD 等于远端 head」Superseded（2026-09-30）：整理提交必然改变 HEAD，而 Desktop 上每重跑一轮都要人类伙伴退出并重启应用）。
**回滚**：`git reset --hard <backup ref>` 后按上面的 force-with-lease 推回。

## Validation and Acceptance

| # | 验收项（issue #227） | 判定证据 |
|---|---|---|
| 1 | `dsh plugin add` 构建产物进 profile，加载无失败 fiber（记录命令与输出） | K1 与 K3 均「已观测到」（K3（4）以人类伙伴截图为证）。原「装进 scratch profile；K3c 翻转被观测到」Superseded by D22、D24（2026-09-30） |
| 2 | 导航入口出现并渲染占位面板（记录观测） | K4、K5、K6 均「已观测到」（H 路线：人类伙伴截图与文字确认、agent 转录；B 路线见 `Design / Spec` §7.4）；K7 的 `package.json` 为「相同」或差异已按人类伙伴的决定处理。原「前置 D15、D18；`<Documents>` 核对」Superseded by D22–D24（2026-09-30） |
| 3 | 从本仓库干净检出构建，旁边不需要宿主检出 | CI verify lane 与 Merge Gate · Integration 上 `tests/integration/harness-plugin-artifact.test.js` 通过（回读 `gh pr checks <n> -R SingularityKChen/harness-projects`）；K0「已观测到」；`grep -c '@deepseek-ai' pnpm-lock.yaml` 为 0 |
| 4 | `pnpm run boundaries` 通过且 `apps/harness-plugin` 不含业务组件 | `pnpm run boundaries` 全绿；新增壳断言在变异 M-i 下变红；`grep -rnE "from ['\"]react" apps/harness-plugin/src` 无输出 |
| 5 | 规模与发布面 | `node scripts/rule-checks.mjs size test/harness-plugin-reprobe`：代码 ≤ 800、文档 ≤ 1300；`disclosure` 退出 0；`git diff --check` 无输出 |
| 6 | 产物契约的判别性 | 变异表 M-a 至 M-m 在最终树上逐条变红并还原转绿 |
| 7 | §11.10 的 0.2.0-rc.2 复测清单 | O0.1 ↔ K1、O0.2 ↔ K3、O0.3 与 O4.1 ↔ K4、O4.2 的挂载部分 ↔ K5、O4.3 ↔ K6 均「已观测到」；O3.1–O3.4 与 O4.2 的数据部分移交 #228（D25），PR 描述写明 |

## Progress

- [x] 2026-09-29 Batch 0：对齐检查；三份独立设计评审与定稿；本计划写入工作树（未提交）。
- [x] 2026-09-29T16:08Z Batch 0：会话因额度中断后恢复；按 #225 的新 head `d10d0ad` 重新核对 §11，实测 F26（pnpm pack 会放进 `LICENSE`）；补 F25、A5、Kb、D17–D19；`docs/README.md` 的 Active 行写入工作树（未提交）。
- [x] 2026-09-30 Batch 0：人类伙伴在会话中作出四项决定（目标宿主线与 peer 范围、esbuild、以本机 Desktop 为验收宿主、浏览器观测的调研）；独立定稿者只读复核 `$ASAR`、应用包与 #225 的 §11.10 之后修订本计划（F27–F35、A6、A7、D20–D26、`Design / Spec` §7 与 §10）；未提交。
- [x] Batch 0：~~快进到 #225 的本地 head~~ 由主会话变基到 #225 的新 head（#225 已改写历史）；等 #225 推送；提交、推送、draft PR。完成记录见 `Plan of Work` Batch 0（计划 `42e0cd6`、回填 `0d1cfe3`、draft PR #245、stack #246）。
- [x] 2026-09-30 Batch 1（T0，`b0fb240`）：两个 manifest 按 §2、§5 修改，`tsconfig.base.json` 第 20 行注释补写。首次 `pnpm install`（pnpm 10.28.2）新增 8 个包、退出 0，并打印 `Ignored build scripts: esbuild@0.28.2. Run "pnpm approve-builds" …`：A1 在本机成立，`pnpm-workspace.yaml` 未改。`pnpm install --frozen-lockfile` 退出 0；`node_modules/@harness-projects/core -> ../../packages/core`；`grep -c '@deepseek-ai' pnpm-lock.yaml` 为 0；`import('esbuild')` 得到 `0.28.2`，不跑 postinstall 时本机平台包可用（`esbuild.transform` 转译一行 TS 成功）；`pnpm typecheck` 与 `pnpm run boundaries`（7/7）绿。新入锁：`esbuild@0.28.2`、`@esbuild/*@0.28.2`（锁文件列出全部平台，安装时只取本机平台）、`@types/react@18.3.31`、`@types/prop-types@15.7.15`、`csstype@3.2.3`、`react@18.3.1`、`loose-envify@1.4.0`、`js-tokens@4.0.0`；最后三个不在人类伙伴点名的下载清单里（D27、D28；D28 已由人类伙伴确认，D31）。A1 的 CI 复核见 PR 描述的 checks 回读。
- [x] 2026-09-30 Batch 2（T1–T5，各在 `.worktrees/harness-plugin-package-t<n>`，从 `b0fb240` 切出，先 `pnpm install --frozen-lockfile` 并核对 core 链接）：
  - T3（`617c9e1`）红基线：在 `b0fb240` 上 `node --test tests/integration/harness-plugin-artifact.test.js` 退出非 0，`Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<worktree>/apps/harness-plugin/scripts/build.mjs'`，`ℹ tests 1 / pass 0 / fail 1`。
  - T4（`6e8cff5`）：在 `b0fb240` 上 boundaries 8/8；M-i、新增 `.tsx`、`require('react-dom/client')` 三种变异各让它 `fail 1`，还原后 8/8。
  - T1（`bd2965b`）：`pnpm typecheck` 绿（A4 成立，未改 `lib`）；boundaries 7/7；`grep -rnE "from ['\"]react" apps/harness-plugin/src` 无输出。
  - T2（`16cb16e`，自验时在 T1 的临时 cherry-pick 上）：`build.mjs --out <tmp>` 退出 0；`pack:plugin` 的 tarball 恰好 5 个条目，`package/LICENSE` 与仓库根 `LICENSE` 的 sha256 相同（A2 / F26 在真实产物上复核）；Node 26 上 import 宿主半边得到 `['apply']` 并打出就绪行。
  - T5（`8fa1aae`）：ADR-0009（Proposed）与三处索引；`content-placement`、`plan-facts-consistency`、`rule-checks`、`e1-evidence-consistency`、`package-boundaries` 五个契约测试 72/72。
  - 对抗验证（独立 agent，在 T4 → T1 → T2 → T3 → T5 的组合上重跑）：`pnpm verify` 绿、集成测试 20/20、`git archive` 干净检出 `--offline` 安装后打包 5 个条目、tarball 装进空 `node_modules` 后按包名 import 成功，全部变异复现；判定 pass，意见 5 条均为 P3（处理见 Batch 3）。
- [x] 2026-09-30 Batch 3（T6）：
  - **整合**：backup ref `backup/harness-plugin-package-20260930T020636Z`（`b0fb240`）；按 T4 → T1 → T2（只取 `16cb16e`，不取它下面的 T1 临时提交）→ T3 → T5 cherry-pick，无冲突。`comm` 比对 `git ls-tree -r --name-only`：整合前 335 个文件、没有一个消失，新增恰好 8 个（`cordis.patch.yml`、`scripts/build.mjs`、`src/client.ts`、`src/host-surface.ts`、`src/host.ts`、ADR-0009、`placeholder.ts`、集成测试）；每个任务自有的文件与其任务分支逐字相同（`git diff --stat feature/harness-plugin-package-t<n> HEAD -- <自有路径>` 均为空）。
  - **对抗验证意见的处理**：P3「壳断言不覆盖 `.jsx`」复核后更重：`sourceFiles` 只收 TS 扩展名，而 esbuild 会打入 `.jsx` / `.js`。先取红——在整合树上新增 `src/panel.jsx`（import react 的组件）并从 `client.ts` 引用，构建退出 0、产物含该组件，boundaries 仍 8/8；改为 `.ts` 白名单后，空 `.jsx`、含 react 的 `.js`、`.tsx`、子目录里的 `.jsx`、M-i、`require('react-dom/client')` 六种探测各 `fail 1`，还原后 8/8（D29）。P3「代码 867 > 800」：见 D29 的精简，现为 799。P3「测试注释的宿主版本出处」：只读 `$ASAR` 核对，Desktop 0.2.0-rc.2 自带的 `cordis-plugin-loader`（1.0.5）`lib/index.js:663-668` 与 F8 逐行相同，注释改为写明两个版本。P3「M-l 由构建期不变量先挡住」：变异表分别记录原样与去掉不变量两种结果。P3「react 入锁」：登记 D28，待人类伙伴确认。
  - **最终树验证**（代码最终树 `cedb61d`，即提交 `ffd0230` 的树；本计划的回填提交只改文档）：`pnpm install --frozen-lockfile` 退出 0；`pnpm verify` 退出 0（816/816，mvp0 7/7，typecheck 无输出）；`pnpm run boundaries` 8/8；`node scripts/workflow-check.mjs` 为 `no findings（已检查 8 个文件）`；`node scripts/rule-checks.mjs disclosure test/harness-plugin-reprobe` 退出 0；`git diff --check test/harness-plugin-reprobe...HEAD` 无输出；`node scripts/rule-checks.mjs size test/harness-plugin-reprobe`：代码 799 / 1000、文档 805 / 1500（含本次回填；计划上限代码 800、文档 1300）。
  - **干净检出预演**（不是 K0，K0 在 Batch 4 按 §7.1 执行）：`git archive` 到一次性目录，`pnpm install --frozen-lockfile --offline` 退出 0，`pack:plugin` 输出 `built dist/package`；`tar -tzf` 恰好 `package/lib/client.js`、`package/lib/index.js`、`package/package.json`、`package/cordis.patch.yml`、`package/LICENSE`；安装件 `workspace:` 计数 0；锁文件 `@deepseek-ai` 计数 0；`package/LICENSE` 与仓库根 `LICENSE` 的 sha256 都以 `cfc7749b96f63bd3` 开头。安装件四个文件的 sha256：`package.json` `9605008332b7bf33f987f1a86805ea3b22394428cb31dadc635efe3ef718def9`、`cordis.patch.yml` `6eb0d833f578b1d3cc4a2758e53a556758d66dc36d624e9085ab3b0aae906657`、`lib/index.js` `c0c82fb2945536bc4e56837ab280e04ebd4f74ed49fd5d2dd8dbe6fae32b1598`、`lib/client.js` `938a8addb124df87c41cd6fc533b6f23907e2b0de95f6516c140b6e28a7c4976`（K0 在 Batch 4 重算；与这里不同就先查代码树是否变了）。
  - **变异表**（在树 `cedb61d` 上逐条执行：先用 `git diff --stat` 与标记 `hp227-mutation=<id>` 的计数证明已生效，跑测试，`git checkout -- <文件>` 还原后 `git status --short` 为空再跑一次；集成测试共 20 条，boundaries 共 8 条。`before` 抛错时 node:test 把套件内的用例记为 cancelled，进程退出 1）：

    | 变异 | 生效证据 | 变红 | 还原后 |
    |---|---|---|---|
    | M-a 去掉 banner / footer | `build.mjs` 1+ 6−，标记 1 | d、e：执行 bundle 抛 `ReferenceError: module is not defined`，7 条 cancelled、13 pass，退出 1 | 20/20 |
    | M-b `client.ts` 值导入并使用 `node:crypto` | `client.ts` 2+，标记 1 | 构建抛错 `Could not resolve "node:crypto"`，20 条 cancelled | 20/20 |
    | M-c `client.ts` 值导入 `@deepseek-ai/dsh-api-gateway` | `client.ts` 3+，标记 1 | 构建抛错 `Could not resolve "@deepseek-ai/dsh-api-gateway"`，20 条 cancelled | 20/20 |
    | M-c2（附加）导入基线之外的外置子路径 `react/jsx-dev-runtime` | `client.ts` 3+，标记 1 | 构建闸门 1 抛 `client bundle 引用了基线之外的外置模块：react/jsx-dev-runtime`，20 条 cancelled | 20/20 |
    | M-d patch 行 `name` 拼错一个字符 | `cordis.patch.yml` 1+ 1−，标记 1 | b（1 fail） | 20/20 |
    | M-e `main` 注册去掉 `key` | `client.ts` 1+ 1−，标记 1 | e「main 注册的选项」（1 fail） | 20/20 |
    | M-f `main` 面板组件读根 Context 的 `ctx.remote` | `client.ts` 1+ 1−，标记 1 | e「面板组件渲染 section」：`cannot get property "remote" without inject`（1 fail） | 20/20 |
    | M-g 安装件复制源 manifest 的 `dependencies` | `build.mjs` 1+，标记 1 | a「没有 dependencies」（1 fail） | 20/20 |
    | M-h 宿主半边 import `@harness-projects/domain`，宿主 `external` 加 `@harness-projects/*` | `build.mjs` 1+ 1−、`host.ts` 2+ 1−，标记各 1 | 构建闸门 2 抛 `宿主半边引用了既非 @deepseek-ai/* 也非 Node 内置的外置模块：@harness-projects/domain`，20 条 cancelled | 20/20 |
    | M-h2 = M-h 再关掉闸门 2、3 | `build.mjs` 3+ 3−（M-h2 标记 2）、`host.ts` 同上 | c 两条：`ERR_MODULE_NOT_FOUND`（找不到 `@harness-projects/domain`）与宿主文本含 `@harness-projects/`（2 fail） | 20/20 |
    | M-i `client.ts` 加 `import { createElement } from 'react'` | `client.ts` 1+，标记 1 | boundaries 壳断言：`apps/harness-plugin/src/client.ts 直接 import 了 react`（1 fail） | 8/8 |
    | M-i2（附加）新增 import react 的 `src/panel.jsx` | `git status` 为 `?? …/panel.jsx`，标记 1 | boundaries 壳断言：`插件壳只允许 .ts 文件…`（1 fail）；整合前的断言对它是绿的 | 删除后 8/8 |
    | M-j 安装件 `exports` 去掉 `./package.json` | `build.mjs` 1+ 1−，标记 1 | a「exports 恰好四个键」与 c「三个说明符都能解析」（2 fail） | 20/20 |
    | M-k `absWorkingDir` 改为 `outDir`（并预建 `outDir`，见 Surprises） | `build.mjs` 2+ 1−，标记 2 | f 两条：`host input 走出了仓库：../…` 与产物含本机路径（2 fail） | 20/20 |
    | M-l 去掉全部 `dsh-*` peer | `build.mjs` 1+ 3−，标记 1 | 构建期不变量抛 `安装件没有任何 @deepseek-ai/dsh-* peer…`，20 条 cancelled | 20/20 |
    | M-l2 = M-l 再关掉构建期不变量 | `build.mjs` 2+ 4−，标记 1 | a 两条：`inject 项 … 不是 peerDependencies 的键` 与 peer 集合（2 fail） | 20/20 |
    | M-m `HOST_DSH_PEER_RANGE` 改为精确 `0.2.0-rc.2` | `build.mjs` 1+ 1−，标记 1 | a：`@deepseek-ai/dsh-client-ui-slots 的范围不是 ~0.2.0-rc.2`（1 fail） | 20/20 |

  - **提交整理**：修正按根因并入所属提交（壳断言 → T4，参数解析 → T2，测试精简与注释 → T3），以开发账号重建为 `b0fb240` 之上的 `aaa64aa`（T4）→ `09555e8`（T1）→ `dcd6898`（T2）→ `23249d7`（T3）→ `ffd0230`（T5）→ 本计划的回填提交；整理前 backup ref `backup/harness-plugin-package-20260930T0230Z-wip`，整理后与它的树相同（`git diff` 为空）。每个提交单独检出后 `pnpm install --frozen-lockfile`、`pnpm verify`、`pnpm run boundaries` 都退出 0（`pnpm test` 的用例数依次为 795、796、796、796、816、816，boundaries 由 7 条变为 8 条）。T3 提交正文原写「本提交在 base 上按预期失败」，排在 T2 之后不再成立，改写为红基线的出处。
- [x] 2026-09-30 Batch 4（T6；K0、Kp、K1，在 `.worktrees/harness-plugin-package` 执行）：
  - [x] 前置：Batch 3 的最终树已推送；PR #245 的 head `55f770f` 上 12 项 checks 全部 pass（`gh pr checks 245 -R SingularityKChen/harness-projects`，含 `PR Fast Gate`、`Verify（typecheck + 契约测试）` 与 `Merge Gate · Integration`）。
  - [x] H0：人类伙伴 2026-09-30 在会话中选 H 路线，选项原文「H 路线：你截图」（D32）；§7.4 的 B 路线不执行。
  - [x] D28：人类伙伴 2026-09-30 在会话中确认，选项原文「接受」（D31）；TD-O 关闭。
  - [x] 环境（§7.1，2026-09-30T02:39:27Z）：`mktemp -d` 建 `$SCRATCH`，写下 `marker` 与 `lsof.before`（33 行）。§7.1 的变量与三个函数逐行取自本计划写进 `$SCRATCH/env.sh`（`SCRATCH` 固定为本次的值），后续每个阶段都 `source` 它，不再调用 `mktemp`。此时 `desktop_down` 已退出 0（Desktop 没有在运行），Kp、K1 仍按协议等人类伙伴回复 H1。
  - [x] **K0 已观测到**（2026-09-30T02:39:33Z–02:39:55Z；HEAD `55f770fc88137baac548cc1546b9613572fd5fa6`，`HEAD:apps/harness-plugin` `3cc6a13db4dd19c15baed533f38be2196f21beb6`；Desktop `0.2.0-rc.2`）：`git archive --format=tar HEAD | tar -x -C "$SCRATCH/clean"` 两段都退出 0；在 `$SCRATCH/clean` 里 `pnpm install --frozen-lockfile --offline`（pnpm 10.28.2）退出 0（`Ignored build scripts: esbuild@0.28.2`，`Done in 228ms`）；`pnpm --filter @harness-projects/app-harness-plugin run pack:plugin` 退出 0（`built dist/package`）；`tar -tzf "$TGZ"` 恰好 5 条：`package/lib/client.js`、`package/lib/index.js`、`package/package.json`、`package/cordis.patch.yml`、`package/LICENSE`；安装件 `workspace:` 计数 0；锁文件 `@deepseek-ai` 计数 0；`$SCRATCH` 顶层只有 `clean/`、`evidence/`、`marker`、`lsof.before` 与 `env.sh`，没有别的检出（`find "$SCRATCH" -maxdepth 4 -name .git` 为 0）。`shasum -a 256 "$TGZ"` = `386b30f6dae2b1cf3e472267a8ac22b3e0f8db844a5b5f9565e37a0ae047d170`。安装件四个文件（`dist/package/` 下）的 sha256 与 Batch 3 预演逐字相同：`package.json` `9605008332b7bf33f987f1a86805ea3b22394428cb31dadc635efe3ef718def9`、`cordis.patch.yml` `6eb0d833f578b1d3cc4a2758e53a556758d66dc36d624e9085ab3b0aae906657`、`lib/index.js` `c0c82fb2945536bc4e56837ab280e04ebd4f74ed49fd5d2dd8dbe6fae32b1598`、`lib/client.js` `938a8addb124df87c41cd6fc533b6f23907e2b0de95f6516c140b6e28a7c4976`；tarball 里的 `package/LICENSE` 与仓库根 `LICENSE` 同为 `cfc7749b96f63bd3…`。tarball 里的 `package/package.json` 是 `aaa30c9b8a75d88e…`，与 `dist/package/package.json` 只差末尾换行（见 Surprises）。
  - [x] H1：人类伙伴 2026-09-30 在会话中回复「已退出」（经主会话转达）；agent 于 2026-09-30T02:49:43Z `source "$SCRATCH/env.sh"` 后核对：`desktop_down` 退出 0（`pgrep -f "$DESKTOP_APP/Contents/"` 0 个进程，`19387` 上 0 个监听），`DSH_HOME` 未设置。
  - [x] **Kp**（2026-09-30T02:49:51Z）：`desktop_down` 退出 0；`CFBundleShortVersionString` 为 `0.2.0-rc.2`；`asar_cat …/dsh-app-boot/package.json` 的 `"version": "0.2.0-rc.2"`；`$DESKTOP_PROFILE/package.json` 存在。`tar -C "$HOME/.dsh/profiles" -cf "$SCRATCH/desktop-profile.before.tar" desktop` 退出 0，包内 `desktop/` 与四个文件，tar 本身的 sha256 `af73ca99d869b705ccbae3334b70848fe06bb1f595a07c0c47144d35c8cc1f37`。四个配置文件的 sha256：`package.json` `59785917053aaa9bea2f925ad60875846c31bb2a827141d6ed632f3b543136a0`、`pnpm-workspace.yaml` `ae7c5b68e2f157528e62885804e69e88583897b775e03c86fcbe52feaf498aba`、`cordis.yml` `c300dcf2ebc5f02062d6591268d29d3db6fe45e0cb138f5467276fe2ba06076e`、`cordis.patch.yml` `4d74ab785b0e37fcc9dec2515e6108b5667a1aa4bf47b26830402f383e6d095d`。`ls -A "$DESKTOP_PROFILE"`：`cordis.patch.yml`、`cordis.yml`、`package.json`、`pnpm-workspace.yaml`（与 2026-09-30 定稿时的只读观察一致，没有 `pnpm-lock.yaml`、`node_modules/`、`.plugin-manager/`）。手工恢复依据（`Idempotence and Recovery`）：`dependencies` 为 `{}`；`dsh.profile.bundles` 依次为 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-experimental-agent-team-profile`、`@deepseek-ai/dsh-experimental-auto-review`、`@deepseek-ai/dsh-experimental-schedule-bundle`。
  - [x] **K1 已观测到**（2026-09-30T02:49:56Z–02:50:13Z）：`dsh_d add "$TGZ" > "$SCRATCH/k1.add.log" 2>&1; echo "exit=$?"` 输出 `exit=0`，没有使用 `allow-version` / `--accept-risk`。输出摘录（路径换成占位符）：`[WARN] Issues with peer dependencies found. Run "pnpm peers check" to list them.`、`+ @harness-projects/app-harness-plugin file:$SCRATCH/clean/apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.0.0.tgz`、`Packages: +1`、`Done in 253ms using pnpm v11.7.0`；`installation rejected` 计数 0。`node -e …` 输出 `true true`：`dependencies` 只有本包（`file:<tgz>`），`dsh.profile.bundles` 在 Kp 的五项之后追加了本包。已装入的 `lib/index.js` `c0c82fb2…1598`、`lib/client.js` `938a8add…4976`，与 `$SCRATCH/clean/apps/harness-plugin/dist/package/lib/` 下的同名文件逐一相同。A3 成立：`private: true` 不影响 `dsh plugin add <tgz>`（pnpm 11.7.0）。peer 警告是预期的：profile 的 `autoInstallPeers: false`（F24），宿主包由 Desktop 自带、不在 profile 的 `dependencies` 里。附带观察（不是 K7）：`pnpm-workspace.yaml`、`cordis.yml`、`cordis.patch.yml` 与快照相同，`package.json` 不同（上面的两处追加）；profile 顶层新增 `.plugin-manager/`、`node_modules/`、`pnpm-lock.yaml`，与 §7.5 的预期一致。为做这次比较，快照另解到了 `$SCRATCH/profile.kp`。
  - [x] H2 之前：2026-09-30T02:50:28Z `: > "$SCRATCH/desktop.out"`（0 字节），`desktop_down` 仍退出 0；H2 的启动命令已经交给主会话转达。
- [x] 2026-09-30 Batch 5（T6 与人类伙伴；K3–K6、K7）：
  - [x] H2：人类伙伴 2026-09-30 在会话中回复「已启动」（经主会话转达），按 agent 给出的 `open -a "$DESKTOP_APP" --stdout "$SCRATCH/desktop.out" --stderr "$SCRATCH/desktop.err"` 在自己的终端里启动。启动时刻取 `ps -o lstart=`：Desktop 主进程与宿主子进程都在 2026-09-30T02:54:47Z 启动（`desktop.err` 的创建时间同一秒）；版本仍是 `0.2.0-rc.2`，没有更新提示的报告。
  - [x] **K3（1–3）已观测到**（2026-09-30T02:55:51Z，启动后 64 秒；`source "$SCRATCH/env.sh"` 后执行，`desktop.out` 只计数，没有打印或另存任何含令牌的行）：（1）`grep -cF '[harness-projects] host ready' "$SCRATCH/desktop.out"` 为 1，`grep -F '[harness-projects]'` 取到的唯一一行是 `[harness-projects] host ready`；`grep -c '^dsh web: '` 为 1，即 stdout 确实落进了文件（A6 成立）。（2）`pgrep -f "$DESKTOP_APP/Contents/MacOS/"` 为 2 个进程；`19387` 上恰有 1 个 `LISTEN`，监听者是宿主子进程（其父进程是 Desktop 主进程）。（3）`find "$HOME/Library/Logs/DeepSeek Harness" -newer "$SCRATCH/marker" -type f | wc -l` 为 0。附带计数（不是判据）：`desktop.out` 25 行，其中含 `skipping profile bundle`、`did not activate`、`error` / `fail`、`warn` 的都是 0 行；`desktop.err` 0 字节。
  - [x] H3 的截图清单与保存目录（`$SCRATCH/evidence/`）已交给主会话转达。
  - [x] H3（部分）：人类伙伴 2026-09-30 的回复是在会话中直接发来两张截图（经主会话转达；没有按清单的文件名保存，K4 与 K5 合在一张，也没有逐项的文字说明）。主会话把它们复制进 `$SCRATCH/evidence/`（mode 600，只在本机）：`K4-K5.webp`（sha256 `f4abcc7d058af098f3266b184fee90049eb58e7938266ead085e26850350456c`，2000×1281）与 `K3.png`（`44f04e2c390d738e3235b79234ea7ab1c12f17cca8582f725c607b106d0aebdd`，1998×1640）。**图中含真实的工作区名、会话标题与账号标识；agent 读图后只转录与判据相关的元素，证据只留本机、不上传、不入库。** 时间归属：两个文件的 mtime 都是 2026-09-30T03:03:56Z，这是复制进目录的时刻，不是截图时刻；文件里没有时间元数据（PNG 只有 `IHDR` / `pHYs` / `IEND`，WebP 只有 `VP8X` / `ICCP` / `VP8 `）。改用内容归属：图中的入口与插件行只能在 K1（02:49:57Z）之后出现（Kp 时 profile 里没有本包）；K1 之后 02:50:28Z `desktop_down` 仍为真；读图时正在运行的 Desktop 进程启动于 02:54:47Z（H2）。所以截图来自 K1 之后的一次启动，而已知的启动只有 H2 这一次（见 Surprises）。
  - [x] **K4 已观测到**（agent 读 `K4-K5.webp`）：侧栏有一个带图标的入口「Harness Projects」，处于选中状态，位于「插件」「自动化任务」之下、工作区列表之上。
  - [x] **K5 已观测到**（同一张图）：主区域标题是「Harness Projects」，正文是「项目交付工作台的占位面板，业务页面在后续版本接入。」，与 D30 的占位说明逐字相同。
  - [x] **K3（4）已观测到**（agent 读 `K3.png`）：Plugins 页（「插件」）「已安装 1」下只有一行 `@harness-projects/app-harness-plugin`，描述「Harness 外壳适配」（等于安装件 manifest 的 `description`），开关处于启用状态（样式与其他已启用的行相同），页面上没有错误提示或失败标记。H3c 要求「只看不点」，这一点从图上无法核对，留给 K7 的 `package.json` 与配置比对。连同 K3（1–3），**K3 已观测到**。
  - [x] H3（补拍 K6）：人类伙伴 2026-09-30 在会话中发来 Console 截图，附言原文「无 error」（经主会话转达）。主会话把它复制为 `$SCRATCH/evidence/K6.webp`（mode 600，只在本机；sha256 `97783e7181b16ccc9d764313b8119f0aa6aafbc1ef466f62a8a81a19b458d830`，2000×1148；mtime 03:07:19Z 是复制时刻，文件里只有 `VP8X` / `ICCP` / `VP8 `，没有时间元数据）。时间归属同上：图左侧仍是本插件的占位面板，只可能出现在 K1 之后。
  - [x] **K6 已观测到**（agent 独立读 `K6.webp`，只转录判据相关元素）：开发者工具在 Console 标签，上下文 `top`，过滤框是 `harness`，日志级别下拉框显示「Default levels」；消息列表里没有任何条目（只有输入提示符），列表上方显示「3 hidden」，右侧「No issues」；开发者工具顶部的错误徽标是 3。图左侧是占位面板，标题与说明同 K5，侧栏入口处于选中状态。两处偏离如实记录：
    - **级别与约定不同，但更严**：约定是只勾 Errors；实际是「Default levels」，Chromium 的缺省级别是 Errors、Warnings、Info（不含 Verbose），包含 Errors。所以缺省级别下过滤 `harness` 为空，意味着只看 Errors 时也为空；判据按原文仍然成立。
    - **全局 3 条错误没有逐条归因**：它们的内容没有查看，不匹配 `harness`。「它们不以本插件为源」只是**推断，不是观测**。推断依据：按静态读码，客户端 bundle 经 `/plugins/??<id>/client.js…&rev=…` 形式的 combo 路由下发（`$ASAR:dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:201-209,394-403`），本包的 id 是包名（F5），所以本插件抛出的错误，来源地址会含 `harness-projects`。推断成立还要求开发者工具的文本过滤也匹配消息的来源位置，这一点本次没有核实。如果本插件的错误信息与来源位置都不含 `harness`，它会落在「3 hidden」里而无法区分。
  - [x] **K3–K6 汇总**（同一次启动，2026-09-30T02:54:47Z 起）：K3 已观测到（（1–3）来自 `desktop.out` 的计数、进程、端口与崩溃报告目录，（4）来自 `K3.png`）；K4、K5 已观测到（`K4-K5.webp`）；K6 已观测到（`K6.webp`，带上面两处偏离）。验收 1 的 K3 与验收 2 的 K4–K6 满足；验收 2 还要等 K7 的 `package.json` 结论。
  - [x] H4：人类伙伴 2026-09-30 在会话中回复「已退出，后续这些操作你可以直接做」（经主会话转达；授权见 D33）。agent 于 2026-09-30T03:09:45Z `source "$SCRATCH/env.sh"` 后核对：`desktop_down` 退出 0（0 个进程，`19387` 上 0 个监听），`DSH_HOME` 未设置。
  - [x] **K7**（2026-09-30T03:10:09Z–03:10:19Z；按 §7.2 的 K7 代码块逐条执行，两处按字面未满足，均已归因，写在最后两点）：
    - `desktop_down && dsh_d remove @harness-projects/app-harness-plugin` 退出 0；输出摘录：`- @harness-projects/app-harness-plugin file:$SCRATCH/clean/…/harness-projects-app-harness-plugin-0.0.0.tgz`、`Done in 173ms using pnpm v11.7.0`。
    - 与 Kp 快照比对：`pnpm-workspace.yaml`、`cordis.yml`、`cordis.patch.yml` 为 `same`；`cordis.yml` 的 mtime 是 02:54:48Z（H2 启动时 Desktop 重写了它），内容逐字节不变。profile 的 json / yaml 里含 `$SCRATCH` 的文件（不含 `node_modules`、`.plugin-manager`）为 0 个。新增顶层条目恰好是 `.plugin-manager/`、`node_modules/`、`pnpm-lock.yaml`，与 §7.5 的预期一致，交 H5；没有缺失的顶层条目。
    - `~/.dsh` 下比 marker 新的条目（不含 `node_modules`）共 16 个：11 个在 `desktop` profile 内（本流程的 add / remove，加上 H2 启动时对 profile 目录与 `cordis.yml` 的改写）；5 个在 profile 外，时刻都是 02:54:48Z–02:54:49Z（H2 启动那一秒），分别是 `~/.dsh` 目录本身的 mtime、`sessions/` 下一个 2026-09-29 已有会话的两个文件、`storages/session_projcache/sessions/` 目录及其中一个新缓存文件。归因：Desktop 启动时恢复已有会话，不是本插件（宿主半边只打一行日志）。
    - pnpm 用户级内容寻址库：Desktop 自带的 pnpm 11.7.0 用 `~/Library/pnpm/store/v11`（取自已装 profile 的 `node_modules/.modules.yaml` 的 `storeDir`）。比 marker 新的文件 7 个：`index.db` 被改写；5 个内容文件与 1 个按 tarball 建的索引项创建于 K1 的 02:49:57Z，那个索引项的目录名里嵌着 tarball 的本机临时路径。K0 用的 pnpm 10 库 `v10` 新增 0 个（`--offline`）。
    - `lsof` 对照：`19387` 上已无监听；新增的监听只有两个，都属于与 Desktop 无关的其他应用，其中一个是人类伙伴执行 H2 用的终端（启动于 02:54:38Z）；没有消失的监听。
    - `<Documents>/deepseek-harness`：Kp 没有记录它的清单（协议未要求），改用 marker 对照。深度 2 以内没有比 marker 新、也没有在 marker 之后创建的条目；目录 mtime 停在 2026-09-29。
    - **按字面未满足之一：`package.json` 为 `DIFFERENT`**。`diff` 只有一行：快照里的 `"dependencies": {}` 被删掉了。`dsh.profile.bundles` 已回到 Kp 的 5 项。归因：pnpm 11.7.0 移除最后一个依赖时删掉整个空的 `dependencies` 键。已按 D33 在 H5 写回。
    - **按字面未满足之二：`node_modules/@harness-projects` 仍然存在**，是一个空的 scope 目录。本包目录 `node_modules/@harness-projects/app-harness-plugin` 已不存在，`node_modules` 里只剩 `.modules.yaml`、`.pnpm-workspace-state-v1.json`、空的 `.pnpm/` 与这个空目录。归因：pnpm 11.7.0（`nodeLinker: hoisted`）移除包时不回收空的 scope 目录；它不会被加载，因为 `bundles` 已不含本包。已在 H5 随 `node_modules/` 一起移入废纸篓。
  - [x] **H5**（2026-09-30T03:12:13Z–03:12:27Z；按 D33 由 agent 执行，**没有永久删除任何文件**）：
    - `desktop_down` 再次退出 0。
    - 先 `command cp -p` 把当前 `package.json`（`40d94e53…0da76`）留底到 `$SCRATCH/h5-before/package.json`，再从 `$SCRATCH/profile.kp/desktop/package.json`（即 Kp 快照解出的同名文件，`59785917…36a0`）写回；写回后 sha256 为 `59785917053aaa9bea2f925ad60875846c31bb2a827141d6ed632f3b543136a0`，等于 Kp。
    - Kp 时不存在的 `.plugin-manager/`、`node_modules/`、`pnpm-lock.yaml` 用 `command mv` 移入 macOS 废纸篓：`~/.Trash/hp227-desktop-profile-{plugin-manager,node_modules,pnpm-lock.yaml}-20260930T031220Z`，三次都退出 0，按确切路径 `stat` 都存在，可以恢复。本机 `~/.Trash` 的目录列表对 agent 不可读，但按确切路径可以访问。
    - 内容寻址库里的 7 个条目没有动，只列在这里。
    - 复核：`ls -A "$DESKTOP_PROFILE"` 与 Kp 的顶层清单逐项相同（`cordis.patch.yml`、`cordis.yml`、`package.json`、`pnpm-workspace.yaml`）；四个配置文件的 sha256 与 Kp 记录逐一相同，与快照的 `cmp` 都是 `same`；`node_modules/@harness-projects` 不存在；`desktop_down` 为真，`19387` 上没有监听。
    - `$SCRATCH` 保留不删。里面有截图（含真实工作区名与会话标题）、`desktop.out`（含那次进程的启动令牌 URL，F33：令牌随进程失效）与 profile 快照，是否删除由人类伙伴决定。
  - [x] **§11.10 复测映射在 `0.2.0-rc.2` 上的结果**（`Validation and Acceptance` 第 7 行）：O0.1 ↔ K1 已观测到；O0.2 ↔ K3 已观测到；O0.3 与 O4.1 ↔ K4 已观测到（入口出现，说明 client factory 已执行、`apply` 已运行，U1 在真实宿主上成立）；O4.2 的挂载部分 ↔ K5 已观测到；O4.3 ↔ K6 已观测到（带两处偏离）。O3.1–O3.4 与 O4.2 的数据部分移交 #228（D25，TD-L）。
- [x] 2026-09-30 Batch 6（T6，定稿；不执行 `gh pr ready`，不合并）：回填 Progress、Surprises、Decision Log、Outcomes 与技术债务，`docs/README.md` 状态更新；已推送的提交不改写，本地 Batch 4–5 的 WIP 提交合并为一个 `docs(exec-plan)` 提交后快进推送；PR 描述的验证证据按最终 head 更新。整理、推送与回读的结果见 PR 描述与主会话交接。

- [x] (2026-09-30) 授权整合收尾：原ready/draft文字已按当前ready事实订正；计划归档，ADR-0009按D34采纳；先合并#238与#244，再restack并验证全部当前head门禁。当前插件运行时代码不因归档改变，K证据绑定仍以四个产物和tgz哈希核对。

## Surprises & Discoveries

以下是 2026-09-29 独立评审复核宿主包时得到的、与三份设计的预期不符的事实：

- **不兼容的 bundle 被跳过，而不是让启动失败**（F13）：`dsh-app-boot/lib/index.js:930` 的抛错在 `:939-943` 被捕获，包进入 `skippedBundles`，`:516` 往 stderr 打 `skipping profile bundle`。含义：精确 peer 在宿主升级后表现为「插件静默缺席加一行 stderr」，只查激活诊断的判据会把它判成通过。K3 因此要求正面证据，并把这一行计入负面判据。
- **基线模块表可以读到**（F6）：`dsh-web-frontend` 打包产物里的 `WS()` 列出 9 个键。
- **esbuild 的 `__esModule` 形状被 Loader 接受**（F8）：`unwrapExports` 在没有 `default` 时返回对象本身。
- **安装件 `exports` 需要 `./package.json`**（F9）：宿主在没有 Loader 内部解析时用 `<包名>/package.json` 定位 manifest。
- **仓库 `autoInstallPeers: true`**（F3）：宿主 peer 只能写进生成的安装件 manifest。
- **domain 经 `node:crypto` 挡住浏览器打包**（F19）：#227 的 client 不导入 domain / ui-model / client；#229 需要处理（TD-C）。
- **source map 可选**（F11）：#227 不发 map，不影响宿主。
- **pnpm pack 会放进仓库根的 `LICENSE`**（F26，2026-09-29T16:07Z 实测，pnpm 10.28.2）：三份设计的 tarball 清单都写成 4 个条目，照原判据 K0 必然失败。本计划接受这个文件（D19），清单改为 5 个条目。同一次实测也确认了 A2：非成员目录里的 private 包照常打包，`files` 被遵守。
- **#225 在评审期间改了 §11**（本地 head 从 `6052f62` 前进到 `d10d0ad`）：新增 M23（`require` 限制的出处），并订正「默认工作区目录没有在 `<Documents>` 下创建」为「被创建了」（F25）。含义：`DSH_HOME` 隔离挡不住浏览器步骤对真实账户的写入。本计划在 K4 之前用 `documentsDirectory` 覆写把它引到 `$SCRATCH`（D18），并在 K7 核对。**Superseded by D24（2026-09-30）**：验收改用真实 `desktop` profile，不再覆写。
- **只按计数写的负面判据会误判**：宿主自带条目在 scratch 环境里本来就可能报「did not activate」；本插件拖垮 `client-modules` 的聚合激活时，诊断点名的是 `client-modules`（F10）。本计划改为与基线启动 Kb 逐行比较（D17）。**Superseded by D24（2026-09-30）**：Desktop 不转出宿主 stderr，诊断行不可观测，Kb 不再执行。
- **esbuild 的缺省与输出形状**（esbuild 0.28.1，一次性目录）：`platform: 'node'` 缺省把 `node_modules` 里的包打进产物；metafile 的 `outputs[*].imports` 带 `external: true`；CJS 输出在 banner 定义的 `module` 上赋 `module.exports = __toCommonJS(...)`，导出是惰性 getter，没有 `"use strict"` 前缀。构建闸门与 U1 的静态判断据此成立。

以下是 2026-09-30 独立定稿者只读复核 Desktop 应用包、`$ASAR` 与 #225 新 head 时得到的、与 2026-09-29 版本计划的预期不符的事实：

- **#225 改写了历史**：本地 `test/harness-plugin-reprobe` 变基到 `main` 之后为 `6de03f1`，`6052f62` 不再是它的祖先，Batch 0 的 `merge --ff-only` 不可行（改由主会话变基）。新增的 §11.10 把 0.2.0-rc.2 的复测清单并入本 PR。
- **Desktop 看不到宿主 stderr**（F29）：原 K3 的负面判据（跳过行、审计诊断与基线比较）在 Desktop 下不可观测；插件宿主半边的 `console.info` 走 stdout，只有用 `open --stdout` 启动时才能读到。K3 据此改写（D24）。
- **CLI 对 `desktop` profile 只放行 `plugin`**（F30）：`--dump-config` 被拒，原 K2 并入 K1。
- **不必装 `/usr/local/bin/dsh`**（F30）：菜单项只是做一个指向应用包内启动器的符号链接，按绝对路径调用启动器等价，不改系统路径，也不需要人类伙伴先执行菜单操作。
- **普通浏览器可以认证进 Desktop 的宿主，但代价是 30 天 cookie**（F33）：启动令牌由宿主打到 stdout、进程存活期间可复用；换来的 cookie 用真实 `~/.dsh` 的浏览器会话密钥签名，跨重启有效。这决定了 B 路线只能由人类伙伴亲手粘贴 URL、且不作默认（D23）。
- **`dsh plugin` 装 tarball 时已经在安装阶段判定兼容性**（F31）：不兼容会被拒绝并恢复 manifest 与锁文件，不会等到启动才跳过。
- **基线模块表的函数名随版本变**（F6）：`WS()` 变为 `rM()`，键不变；取表命令改为不依赖函数名。
- **Desktop 的更新通道是 `nightly`**（F27）：验收窗口内版本可能变化（`Design / Spec` §10 R4）。
- **Desktop 读取 `DSH_HOME`**（F35）：隔离的 Desktop 验收在技术上可行，但人类伙伴选择真实 profile（D22），本计划没有实测。
- **真实 `desktop` profile 的起点**（2026-09-30 只读）：`dependencies` 为空，没有 `pnpm-lock.yaml`、`node_modules/` 与 `.plugin-manager/`；所以 K7 之后出现的这三项都来自本流程。
- **原「证据绑定 `apps/harness-plugin` 树哈希」不够**：client bundle 还打进了 `packages/ui` 的占位组件，改 `packages/ui` 不改那棵树却改变产物。改为以安装件四个文件的 sha256 绑定证据（`Design / Spec` §7.1）。

以下是 2026-09-30 Batch 1–3 实现与整合时得到的、与计划预期不符的事实：

- **esbuild 0.28.2 在 banner 之后输出 `"use strict";`**（U1 按 0.28.1 写的是「没有前缀」）：这一行落在 factory 函数体内且不是第一条语句，不构成指令，只是无效果的表达式；集成测试 d、e 在 `node:vm` 里执行通过。U1 仍由 K4、K5 判定。
- **`react@18.3.1` 随 §5 进入锁文件**：`packages/ui` 的 react devDependency 本身就会入锁，peer 在 `autoInstallPeers: true`（F3）下也会；T0 试过把 peer 标 optional，锁文件里仍有它（D28）。
- **壳断言的扫描面小于构建的输入面**：`sourceFiles` 只收 `.ts/.tsx/.mts/.cts`，esbuild 却会打入 `.jsx` / `.js`；import react 的 `panel.jsx` 能在 boundaries 全绿时进入 client bundle。改为 `.ts` 白名单（D29）。
- **M-l 先被构建期不变量挡住**：T2 在 `build()` 里加了「至少一个 dsh-* peer、`inject` ⊆ peers」的断言，原样变异时构建先抛错，测试 a 没有机会判别；去掉不变量（M-l2）后 a 变红。两道防线都在。
- **M-k 按字面执行不可判别**：`absWorkingDir` 指向尚不存在的 `outDir` 时 esbuild 直接报错；预建 `outDir` 后 f 的两条变红。
- **`before` 抛错时用例记为 cancelled**：node:test 的汇总里 `fail` 为 0、`cancelled` 为 20，但进程退出 1，`pnpm test` 与 CI 同样失败。变异表按退出码与 cancelled 计数判定。

以下是 2026-09-30 Batch 4 执行时得到的、与计划预期不符的事实：

- **`pnpm pack` 去掉了 `package.json` 的末尾换行**（K0）：tarball 里的 `package/package.json` 与构建写出的 `dist/package/package.json` sha256 不同，`diff` 只有 `\ No newline at end of file` 一处，两者 `isDeepStrictEqual` 为真，键序相同。含义：§7.1「安装件四个文件的 sha256」指构建输出 `dist/package/` 下的文件（Batch 3 预演与 K0 都按它记录）；K1 的逐字节比对只取 `lib/` 下两个文件，不受影响；装进 profile 的 `package.json` 不拿来比对。
- **H3 的截图是在会话里直接发来的，不是按清单存盘**（Batch 5）：K4 与 K5 合在一张 `K4-K5.webp` 里，文件名与 `Interfaces and Dependencies` 的命名契约（`K4.png`、`K5.png`）不同；文件由主会话复制进 `$SCRATCH/evidence/`，mtime 是复制时刻，文件里也没有时间元数据，§7.3「截图时间取 `stat`、必须晚于 H2」这一条按字面满足但不再有证明力。判据本身不变：时间归属改由内容证明（入口与插件行只可能出现在 K1 之后，K1 之后的启动只有 H2），见 Progress。
- **Desktop 的 Console 里本来就有错误，而截图用了缺省级别**（K6）：人类伙伴截图时级别是「Default levels」而不是只勾 Errors（更严，判据仍成立）；开发者工具顶部显示全局 3 条错误，都不匹配 `harness`，内容没有查看。Desktop 自身的错误会让「Console 没有错误」这种不加过滤的判据失效；本计划的 K6 预注册了按 `harness` 过滤，所以仍可判定，但「3 条都不来自本插件」只能推断（依据与缺口见 Progress）。#229 起面板有真实逻辑之后，建议用来源位置过滤（`url:` 加 combo 路由）并逐条看这些错误。
- **`dsh plugin remove` 不能把 `package.json` 还原到逐字节相同**（K7）：pnpm 11.7.0 移除最后一个依赖时，删掉了整个空的 `dependencies` 键，而 Kp 快照里有 `"dependencies": {}`。只靠卸载，K7 的「与快照逐字节相同」无法满足，必须从快照写回（D33、H5）。`bundles` 能正确回退。#230 的卸载说明应写明这一点。
- **卸载留下一个空的 scope 目录**（K7）：`node_modules/@harness-projects/` 在 remove 之后仍在，里面为空。K7 的字面判据「`node_modules/@harness-projects` 不存在」因此不满足；本包目录已经不在，也不会被加载。
- **pnpm 用户级内容寻址库的索引项目录名里嵌着 tarball 的本机路径**（K7）：`~/Library/pnpm/store/v11` 下按 tarball 建的索引项，目录名是 tarball 的绝对路径转写。它只留在本机，但意味着从临时目录安装会把临时路径写进用户级库。#230 的安装指南应让用户从稳定路径安装（TD-K）。
- **Kp 没有记录 `<Documents>/deepseek-harness` 的清单**：协议只要求 `~/.dsh` 的 marker 对照，K7 改用 marker 对照这个目录（结果为 0）。今后的 Kp 应把它与内容寻址库的计数一并记下。

- 2026-09-30整合：docs索引冲突揭示归档行误插到目录职责表。本轮按显式`### Completed`章节锚点把本层与#238归档入口移入正确的Completed索引，目录职责表恢复原结构；其余历史索引不清理。

## Decision Log

| # | 决策 | Rationale | 日期 / 作者 |
|---|---|---|---|
| D1 | 本 issue 的流程：多个独立子 agent 设计 → 独立评审定稿并写 ExecPlan → draft PR 关联 issue → Sonnet 在各自 worktree 并行 TDD 与对抗验证 → Opus 验收重构 → 请人类伙伴评审 PR | 人类伙伴指定 | 2026-09-29 / 人类伙伴 |
| D2 | #227 叠在 #225 之上（base `test/harness-plugin-reprobe`），仅在 #225 裁决为 `embed` 时开工；#225 的裁决是 `embed`（`docs/architecture/harness-host-spike.md` §11.6），所以开工 | 人类伙伴批准 | 2026-09-29 / 人类伙伴 |
| D3 | 可以写宿主公开标识符：`dsh` CLI、`dsh.*` manifest 键、`@deepseek-ai/*` 包名、官方文档 URL、版本号；`$HOST_RUNTIME`、`$SCRATCH`、`$DSH_HOME` 的真实值、端口、令牌、本机用户名与主机名一律不写 | 人类伙伴批准；与 spike §11.1 第 2 条同一口径 | 2026-09-29 / 人类伙伴 |
| D4 | 定稿方案综合三份设计：设计 3 的两份 manifest、K 行协议与临时目录构建；设计 1 的占位组件位置、精确外置表与构建闸门；设计 2 的 peer 与 inject 不变量。各设计的问题见 `Context and Orientation` 的取舍表 | 见该表与 Surprises | 2026-09-29 / 独立评审 |
| D5 | 打包器用 esbuild，精确 `0.28.2`，只作 `apps/harness-plugin` 的 devDependency。**待人类伙伴在 draft PR 评审时确认**（#225 计划 TD1 规定打包器由人类决定）；确认前按此实现，因为替换只涉及 `build.mjs` 与一个 devDependency **已确认（2026-09-30，D21）**：人类伙伴对打包器选项的回答是「esbuild 仍需要」。 | 单一依赖加平台二进制；JS API 稳定（`external`、`banner`/`footer`、`metafile`、`absWorkingDir`）；engines `>=18` 覆盖仓库 `>=22.0.0`；输出形状被 Loader 接受（F8）；备选 tsdown 见 `Design / Spec` §8 | 2026-09-29 / 独立评审（推荐） |
| D6 | 源 manifest 保持工作区语义；安装件 manifest 由构建按白名单生成，宿主 peer 与 `dsh` 块只在生成的那一份里 | F2、F3；「无 workspace 依赖」在构造上成立，测试直接读文件 | 2026-09-29 / 独立评审 |
| D7 | client 外置恰好等于基线 ∪ `dsh.client.external`（#227 为空）；宿主半边外置 `@deepseek-ai/*` 与 Node 内置；其余一律打入；构建闸门 fail closed | F6、F7；§11.7 #227 第 1、2 条 | 2026-09-29 / 独立评审 |
| D8 | peer：`@deepseek-ai/cordis ~4.0.4`，`dsh-client-ui-slots` / `-layout` / `-sidebar` 精确 `0.1.7-rc.2`；`dsh.client.inject` ⊆ peers；所有 dsh-* peer 同一精确版本。宿主升级后本插件被跳过并在 stderr 留一行（F13），这是有意的 fail closed。**请人类伙伴在 PR 评审时确认这一取舍** **Superseded by D20（2026-09-30）**：peer 改为范围 `~0.2.0-rc.2`，「同一精确版本」改为「同一个范围」。 | §11.7 #227 第 4 条；探针以同样写法无豁免通过闸门 | 2026-09-29 / 独立评审 |
| D9 | 占位组件放 `packages/ui`；apps 只注册；boundaries 新增壳断言 | `AGENTS.md` §2「apps 只做壳」；让 `@harness-projects/*` 打入 client bundle 在 #227 就被实测 | 2026-09-29 / 独立评审 |
| D10 | 宿主半边只打一行 `[harness-projects] host ready` | K3 需要正面证据（F13、F14 只报失败） | 2026-09-29 / 独立评审 |
| D11 | 不发 source map、不压缩；`absWorkingDir` 固定为仓库根 | 防止路径经家目录进入安装件；F11 说明宿主不需要 map | 2026-09-29 / 独立评审 |
| D12 | 安装件 manifest 保留 `private: true`，是否取消由 #230 决定 | 防误发布；A3 由 K1 验证 | 2026-09-29 / 独立评审 |
| D13 | 写 ADR-0009（Proposed）：`apps/harness-plugin` 是唯一有构建步骤的包、安装件 manifest 由构建生成、外置边界等于宿主基线表 | `tsconfig.base.json:20` 写明仓库没有构建步骤；#228–#230 都要遵守这些形状，推翻它们需要重做代码（`docs/adr/README.md` 的判断标准） | 2026-09-29 / 独立评审 |
| D14 | K0 的依赖安装用 `--offline`，只从已填充的用户级 pnpm 内容寻址库取包 | 不触网；同时证明锁文件完整 | 2026-09-29 / 独立评审 |
| D15 | 浏览器观测（K4–K6）**需要人类伙伴对本 PR 另行确认**，列为 Batch 5 的前置；#225 的确认不沿用；确认请求写明 F25 的风险与 D18 的缓解 **Superseded by D22、D23（2026-09-30）**：验收改在人类伙伴的 Desktop 上进行，界面观测默认由人类伙伴执行。 | 许可按动作、按会话生效；首次进入会写真实账户目录（F25），确认必须知情 | 2026-09-29 / 独立评审 |
| D16 | 客户端在根 Context 上注册、模块级 `inject = ['slots']`；宿主 API 用本地最小结构类型，不引入 `@deepseek-ai/*` 类型包 | F17；让锁文件与构建完全不需要宿主包；#228 引入 `remote.<ns>` 时改到 `ctx.inject` 回调，并决定是否引入类型包 | 2026-09-29 / 独立评审 |
| D17 | K3 的负面判据改为与基线启动 Kb 比较：诊断行（归一后）⊆ 基线，且没有一行点名本插件；阳性对照 K3c 不变 **Superseded by D24（2026-09-30）**：Desktop 不转出宿主 stderr（F29），Kb、K3c 不再执行。 | 只按计数会被宿主自带条目的诊断误判为失败，只按本插件名过滤会漏掉点名 `client-modules` 的聚合失败（F10、F14） | 2026-09-29 / 独立评审 |
| D18 | 浏览器观测之前，在 scratch profile 的用户 patch 里按 `id: workspace-controller` 覆写 `documentsDirectory` 为 `$SCRATCH/documents`；Kb 与 K3 都带这份 patch，两次启动的配置相同；K2 没看到覆写值就不进入 K4；K7 核对真实 `<Documents>/deepseek-harness` 前后不变。这是相对 #225 环境的一处偏离，只改工作区目录的位置，不改插件的安装、加载与挂载路径，不影响 K 行判定 **Superseded by D24（2026-09-30）**：验收用真实 `desktop` profile，不再覆写 `documentsDirectory`。 | F25：`DSH_HOME` 不覆盖默认工作区目录，macOS 上按 `osascript` 取 Documents，改 `HOME` 无效；`documentsDirectory` 是宿主公开的覆写配置 | 2026-09-29 / 独立评审（在 D15 的确认请求里一并请人类伙伴确认） |
| D19 | 接受 pnpm 放进包里的仓库根 `LICENSE`；安装件 manifest 的 `license` 取根 manifest 的值 | F26；许可证随包分发是正确的，去掉它反而要绕开 pnpm 的行为 | 2026-09-29 / 独立评审 |
| D20 | 目标宿主线 `0.2.0-rc.2`。安装件的 `@deepseek-ai/dsh-*` peer 用范围 `~0.2.0-rc.2`（不是精确钉），`@deepseek-ai/cordis` 用 `~4.0.4`；至少声明一个 `dsh-*` peer（没有这类 peer 时兼容闸门直接放行，形同虚设，F12）；两个取值只写在 `build.mjs` 的常量 `HOST_DSH_PEER_RANGE`、`CORDIS_PEER_RANGE` 里，集成测试另持一份字面量作独立预期。Desktop 自带的 semver 7.8.5 以 `includePrerelease` 判定：接受 `0.2.0-rc.3`、`0.2.0`、`0.2.1-rc.1`，拒绝 `0.2.0-rc.1`、`0.3.0-rc.1`（F31，定稿者独立复跑与会话中给出的结果一致）。代价：失去对 rc 之间描述符格式漂移的防护（`Design / Spec` §10 R1、TD-B）。取代 D8 | 来源：人类伙伴在会话中的选择题回答 | 2026-09-30 / 人类伙伴 |
| D21 | 打包器仍用 esbuild，精确 `0.28.2`，只作 `apps/harness-plugin` 的 devDependency。确认 D5 | 来源：人类伙伴在会话中的选择题回答（选项题干「esbuild 仍需要」）。理由（定稿者整理）：`0.2.0` 没有发布官方插件打包工具，官方 tsdown 预设是宿主仓库的内部文件，仓库外同样要自己写 `__ModuleLoader__` 包装；esbuild 是单一依赖外加平台二进制，`engines.node >=18` 覆盖仓库 `>=22.0.0` 与 Desktop 的 Node 24.18.1；JS API 足够（`external`、`banner` / `footer`、`metafile`、`absWorkingDir`），输出形状被 Loader 接受（F8）；只在构建时用，所以是 devDependency，安装件不带任何依赖（`Design / Spec` §2）；`0.28.2` 是 2026-09-30 `npm view esbuild version` 的当前版本 | 2026-09-30 / 人类伙伴 |
| D22 | 验收宿主是人类伙伴已安装的 Desktop `0.2.0-rc.2`，不另下载 npm 运行时；插件装进真实的 `~/.dsh/profiles/desktop`。人类伙伴知情：用真实 profile、固定端口 19387、Desktop 默认开启产品埋点并上报插件安装 / 开关一类事件，`DSH_TELEMETRY_DISABLED` 管不到（F32）。本计划的写入与埋点边界见 `Design / Spec` §7.5。取代 D15 的前提与「严禁写入真实 `~/.dsh`」一条 | 来源：人类伙伴在会话中的选择题回答 | 2026-09-30 / 人类伙伴 |
| D23 | 界面观测（K3（4）、K4–K6）默认走 H 路线：人类伙伴在 Desktop 窗口里执行并截图，agent 读日志、文件与截图（`Design / Spec` §7.3）。B 路线（主会话 Browser 窗格打开 `127.0.0.1:19387`）技术上可行，但要用 Desktop 打到 stdout 的带令牌 URL——它是人类伙伴真实实例的认证凭据，不是本会话生成的测试值，agent 不读取、不输入；认证后 Browser 窗格留下 30 天有效的 cookie（F33）。只有人类伙伴在 H0 明确选 B 并亲手粘贴 URL 时才执行 §7.4 | 人类伙伴已同意由主会话用内置浏览器打开本地实例（针对上一轮设想的 scratch npm `dsh web`），并要求调研桌面端能否沿用；调研结论见 F28、F29、F33 | 2026-09-30 / 独立定稿者（推荐；~~路线待人类伙伴在 H0 选择~~ **H0 已选 H 路线，D32**） |
| D24 | Desktop 下的 K 行改写：原 K2 并入 K1（CLI 对 `desktop` profile 拒绝 `--dump-config`，F30）；Kb 与「诊断行 ⊆ 基线」不可观测（F29），K3 改为就绪行（正面）+ Plugins 页无错误 + 无新崩溃报告 + 进程与端口存活；K3c 不执行——它要验证的正是那条不可观测的负面判据，剩下的判据是正面标记串，失败的加载产生不出来，而每多一轮都要人类伙伴完整退出并重启自己的 Desktop；新增 Kp 前置快照；安装与卸载由 agent 按绝对路径调用应用包里的 dsh 启动器（F30），不装 `/usr/local/bin/dsh`，不经应用内 Plugins 页安装（避免 `plugin_install_click` 埋点、让安装输出可读）；不覆写 `documentsDirectory`。取代 D17、D18 | F29、F30、F32；D22 | 2026-09-30 / 独立定稿者 |
| D25 | §11.10 复测清单里的 O3.1–O3.4 属于 transport；#227 不含 controller transport，这四行在本 PR 无从观测，移交 #228 在 Desktop `0.2.0-rc.2` 上复测。O4.2 里「行数等于 O3.1 的实体数、delta 到达后原位更新」同样属于 transport 数据，随 #228 / #229。本 PR 复测 O0.1–O0.3、O4.1–O4.3（映射见 `Validation and Acceptance` 第 7 行） | 来源：人类伙伴在会话中的委托（「O3.x 若本 PR 不含 transport 则移到 #228，按原计划的映射说明」）；映射由定稿者写 | 2026-09-30 / 人类伙伴 |
| D26 | 宿主半边构建目标 `node22`（常量 `HOST_NODE_TARGET`）：不高于 Desktop 的 Node 24.18.1、仓库 `engines.node >=22.0.0` 与 CI / 本机的 Node 26。覆盖证据：集成测试 c 在 Node 26 上加载宿主半边，K3 在 Electron 的 Node 24.18.1 上加载。客户端 `es2022` 不变 | 来源：人类伙伴在会话中的要求「宿主半边构建目标覆盖 Node 24（Desktop 用 Electron 44 / Node 24.18.1）与系统 Node」；取值由定稿者定；F27 | 2026-09-30 / 人类伙伴（要求）+ 独立定稿者（取值） |
| D27 | 从 npm 下载引入 `esbuild` `0.28.2`（含本机平台包 `@esbuild/darwin-arm64`，约 10.6 MB）与 `@types/react` 18.3（及其类型依赖 `@types/prop-types`、`csstype`） | 来源：人类伙伴 2026-09-30 在会话中的批准 | 2026-09-30 / 人类伙伴 |
| D28 | `react@18.3.1`（连同 `loose-envify`、`js-tokens`）按 `Design / Spec` §5 进入锁文件与 `node_modules`，不在 D27 点名的下载清单里，~~**待人类伙伴确认**~~ **已确认（2026-09-30，D31）**。不接受时的替代：删去 `packages/ui` 的 react peer 与 devDependency——`placeholder.ts` 的 `import { createElement } from 'react'` 仍由 `@types/react` 通过类型检查，client bundle 里 react 本就外置、由宿主提供，仓库里也没有在 Node 侧运行时 import `@harness-projects/ui` 的代码；改动只涉及 `packages/ui/package.json` 与锁文件 | §5 要求 peer 对齐宿主 React 18.3.1（F6）；pnpm 的入锁行为见 Surprises | 2026-09-30 / T6（待人类伙伴确认） |
| D29 | T6 验收重构：（1）壳断言改为「`apps/harness-plugin/src` 只有 `.ts` 文件」，扫描面不小于构建的输入面（原「没有 `.tsx`」被它涵盖）；（2）为守住代码 ≤ 800 的规划上限，删去集成测试里 9 组纯分隔注释、改用 `readdir({ recursive })` 与内联桩、去掉一条与 `deepEqual` 重复的键断言，构建脚本的手写参数解析改用 `node:util` 的 `parseArgs`（未知选项、位置参数与缺值的 `--out` 仍以非零退出，已逐一复跑）；（3）测试注释里 `unwrapExports` 的出处写明 0.1.7-rc.2 与 Desktop 0.2.0-rc.2 同一行号。判别性由同一棵树上的整表变异证明 | 对抗验证的 P3；`AGENTS.md` §5（不为行数机械拆分，删去的是冗余而不是断言） | 2026-09-30 / T6 |
| D30 | 接受 T1、T2 对计划字面的补充：`build()` 先清空整个 `<outDir>/package`，以 `write: false` 在闸门通过之后才写盘；构建期不变量（至少一个 `dsh-*` peer、`inject` ⊆ peers）；闸门 3 按模块说明符的写法匹配而不是子串（client banner 里的模块 id 本身含 `@harness-projects/`）；`dsh.client.external` 只在非空时输出；占位说明固定为「项目交付工作台的占位面板，业务页面在后续版本接入。」，K5 以它为准 | 前四项都比计划字面更 fail closed，或是字面无法成立处的最小修正；占位说明计划只要求「一句固定说明」 | 2026-09-30 / T6 |
| D31 | 确认 D28：接受 `react@18.3.1`（连带 `loose-envify`、`js-tokens`）进入锁文件与 `node_modules`；D28 的替代不执行，TD-O 关闭 | 来源：人类伙伴 2026-09-30 在会话中的选择题回答，选项原文「接受」 | 2026-09-30 / 人类伙伴 |
| D32 | H0：界面观测走 H 路线（`Design / Spec` §7.3）——人类伙伴在 Desktop 窗口里按清单截四张图（`K3.png`–`K6.png`），agent 读日志、文件与截图；B 路线（§7.4）不执行，agent 不读取、不输入带令牌的 URL。确认 D23 的默认 | 来源：人类伙伴 2026-09-30 在会话中的选择题回答，选项原文「H 路线：你截图」 | 2026-09-30 / 人类伙伴 |
| D33 | H4 与 H5：人类伙伴在 H4 的回复里授权 agent 直接执行后续步骤（K7、残留处理、回填、整理、推送、更新 PR 描述）。主会话转达时给出 H5 的边界：不得永久删除任何文件；四个配置文件与快照不同时，先把当前文件留底到 `$SCRATCH/h5-before/`，再从快照写回，写回后 sha256 必须等于 Kp；Kp 时不存在、卸载后仍在 profile 顶层的 `.plugin-manager/`、`node_modules/`、`pnpm-lock.yaml` 移入 macOS 废纸篓（带唯一后缀，可恢复），不用 `rm`；内容寻址库的新增条目不动，只列清单。这一授权取代 §7.3 H5 的「agent 不删、由人类伙伴逐项决定」，以及 K7 的「把 diff 给人类伙伴看，经同意后写回」：`package.json` 的 diff 在写回之后随交接报给人类伙伴。执行结果见 Progress 的 H5 | 来源：人类伙伴 2026-09-30 在会话中的回复原文「已退出，后续这些操作你可以直接做」（经主会话转达）；H5 的边界由主会话在转达时给出 | 2026-09-30 / 人类伙伴（授权）+ 主会话（边界） |

| D34 | 人类伙伴授权按修订流程整理并 rebase merge #238、#244、#245；本层K验收与构建契约已有证据，归档计划并采纳ADR-0009。当前提交按一个可独立回滚的“可安装占位插件”交付物收敛，源码、构建、依赖、产物测试与对应文档整组提交 | 单独回滚依赖、构建、壳或对应契约会使本能力不闭合；用户本次要求按交付物整理。保留完整恢复锚点、改写前后树比对及精确lease | 2026-09-30 / 人类伙伴授权，执行者 |

## Idempotence and Recovery

- **可重复执行**：`build.mjs` 每次先清空 `<outDir>/package` 再写；集成测试每次用新的 `mkdtemp`；`pnpm install --frozen-lockfile` 幂等；K 行可重复，重装一律先 `dsh_d remove` 再 `add`（M14），但每一轮都要人类伙伴走一遍 H1–H4，所以 Batch 4–5 只在 Batch 3 的最终树与 CI 全绿之后执行。
- **会话中断**：scratchpad 会在恢复会话时被清空。每批结束前先做本地 WIP 提交（`git commit -m "wip(apps): <批次>"`，正文 `Refs #227`），Batch 6 整理时并掉。K 行证据在写进本计划之前不算记录。`$SCRATCH` 在系统临时目录里，不受 scratchpad 清空影响，但重启机器可能被清掉：Kp 的 sha256 与顶层条目清单要在 Kp 当时写进 Progress，快照文件丢失时用它核对 K7。
- **变异还原**：只用 `git checkout -- <被变异的文件>` 还原被变异的那一个文件；不用 `cp` 覆盖（本机 `cp` 会停在覆盖确认上）。还原后 `git status --short` 必须为空。
- **整合或整理出错**：整合与整理之前建 `backup/harness-plugin-package-<UTC>`；出错时 `git reset --hard <backup>`；改写后用 `comm <(git ls-tree -r --name-only <旧 head> | sort) <(git ls-tree -r --name-only HEAD | sort)` 核对文件集合。
- **#225 返工**：#225 的分支被改写时，按 `docs/project-management/merge-queue.md` 在其上变基；变基前建 backup ref，变基后 `git range-diff` 核对；安装件四个文件的 sha256 若变化，K0–K6 重跑（`Design / Spec` §7.1）。
- **ADR 编号冲突**：合并时若 `ADR-0009` 已被别的 PR 占用，改为下一个空号并同步两处索引与本计划 D13。
- **宿主观测失败**：保留全部尝试，不放宽判据；按根因改构建或壳层后重跑整组 K 行。已知良好状态是 #225 的探针观测（§11.3），它证明宿主本身能承载。
- **`desktop` profile 恢复**（前提：人类伙伴已完全退出 Desktop，`desktop_down` 退出 0）：首选 `dsh_d remove @harness-projects/app-harness-plugin`，然后按 K7 核对。`remove` 失败、或装上插件后 Desktop 起不来时：人类伙伴退出（必要时强制退出）Desktop；经人类伙伴同意，从快照写回 `package.json`：`tar -C "$HOME/.dsh/profiles" -xf "$SCRATCH/desktop-profile.before.tar" desktop/package.json`。写回后 `dsh.profile.bundles` 不再选中本包，Desktop 不会加载它；`node_modules/` 里的残留不会被加载，是否删除由人类伙伴决定（H5）。`cordis.patch.yml` / `cordis.yml` 只在人类伙伴确认其中没有自己的新改动时才写回。快照丢失时，用 Progress 里 Kp 的 sha256 与顶层清单核对，`package.json` 按 Kp 记录的 `dsh.profile.bundles` 手工恢复（仍需人类伙伴同意）。
- **Desktop 半途升级**（R4）：记录新版本；仍在 `0.2.x` 内则判据不变，继续；超出则插件会被跳过，K3 失败，如实报告，不放宽判据。
- **回到已知良好状态**：关闭 draft PR 或逐个 `git revert` 本 PR 的提交；`apps/harness-plugin` 回到占位，boundaries 不受影响；`dist/` 被忽略，无需清理；`desktop` profile 按上一条恢复，`$SCRATCH` 保留。

## Interfaces and Dependencies

**构建脚本契约**（T2 实现、T3 依此写测试，二者不得互相读对方的未合入代码）：

```js
// apps/harness-plugin/scripts/build.mjs
export const CLIENT_BASELINE      // 冻结数组：F6 的 9 个模块名（注明取自 0.2.0-rc.2 的 rM()，与 0.1.7-rc.2 相同）
export const CLIENT_EXTERNAL      // 冻结数组：等于安装件 dsh.client.external；#227 为空
export const HOST_DSH_PEER_RANGE  // '~0.2.0-rc.2'：所有 @deepseek-ai/dsh-* peer 的唯一取值（D20）
export const CORDIS_PEER_RANGE    // '~4.0.4'（D20）
export const HOST_NODE_TARGET     // 'node22'（D26）
export const HOST_PEERS           // 冻结对象：由上面两个范围构造，键见 Design / Spec §2
export async function build({ outDir } = {})
// → Promise<{ packageDir: string, manifest: object, metafiles: { host: object, client: object } }>
// 产出：<outDir>/package/{package.json, cordis.patch.yml, lib/index.js, lib/client.js}
// 命令行：node apps/harness-plugin/scripts/build.mjs [--out <dir>]，缺省 outDir = apps/harness-plugin/dist
// 违反 Design / Spec §3 第 5 条的闸门时抛错，命令行以非零码退出
```

**占位组件契约**（T1 实现；壳与测试依赖）：`@harness-projects/ui` 导出 `HARNESS_PANEL_TITLE: 'Harness Projects'`、`PlaceholderPanel(): ReactElement`、`PlaceholderIcon(): ReactElement`。

**客户端导出契约**：`lib/client.js` 的 factory 导出恰好 `apply` 与 `inject`；`PANEL_ID = 'harness-projects'`，入口 `label` 与面板 `aria-label` 都是 `Harness Projects`（#229 的验收可以依赖这三个值）。

**打包**：`pnpm --filter @harness-projects/app-harness-plugin run pack:plugin` → `apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.0.0.tgz`。A2 已由 F26 证实；若真实产物上复核失败，依次尝试 `pnpm --dir dist/package --ignore-workspace pack --pack-destination ..`，再不行改为 `tar -czf <tgz> -C dist package`（此时包里没有 `LICENSE`，K0 清单相应改为 4 个条目并记入 Surprises）。

**外部工具与前提**：Node 26、pnpm 10.28.2（仓库内，构建与打包）；验收宿主是人类伙伴本机的 DeepSeek Harness Desktop `0.2.0-rc.2`（`$DESKTOP_APP`）；安装与卸载用应用包里的 dsh 启动器 `$DESKTOP_APP/Contents/Resources/runtime/cli/bin/dsh`（以 Electron 的 Node 模式运行 CLI，用 Desktop 自带的 pnpm 11.7.0，F30），不需要全局 pnpm、PATH 垫片或 `/usr/local/bin/dsh`；macOS 的 `open`（`--stdout` / `--stderr`）；只读解析 `$ASAR` 用 `Design / Spec` §7.1 的 `asar_cat`（不解包、不下载工具）；界面观测需要人类伙伴（H 路线），或 Browser 窗格加人类伙伴亲手粘贴 URL（B 路线）；GitHub 操作用开发账号（`gh` 带 `-R SingularityKChen/harness-projects`）。不需要任何凭据，agent 不输入任何密钥或令牌。原「全局 pnpm、宿主运行时 `0.1.7-rc.2`、PATH 垫片、Browser 窗格」Superseded by D22–D24（2026-09-30）。

**命名契约**：包名 `@harness-projects/app-harness-plugin`（= client 模块 id = patch 行 `name`）；Loader 行 `id: harness-projects`；面板 `key` / 入口 `id` 都是 `harness-projects`；就绪行 `[harness-projects] host ready`；~~K3c 变异标记 `hp227-mutation=host-throw`~~（K3c 不执行，D24）；截图文件名 `K3.png`、`K4.png`、`K5.png`、`K6.png`；Desktop 的 stdout 文件 `$SCRATCH/desktop.out`。

## Outcomes & Retrospective

**授权整合收尾（2026-09-30）**：原“保持draft”等待已被人类伙伴本次明确授权修订并合并取代（D34）。构建与真实Desktop K观测已完成，计划归档；transport数据复测仍由#228承接。restack后重跑 `pnpm verify`、产物契约、boundaries与归档链接检查，四文件及tgz哈希须与K记录一致才可沿用该宿主观测。新head/CI/issue/线程及合并回执在PR正文和跨PR评审归档回填。

（2026-09-30 回填；PR #245 保持 draft，等人类伙伴评审，不执行 `gh pr ready`。）

**实际结果**（验收宿主：人类伙伴本机的 Desktop `0.2.0-rc.2`，真实 `desktop` profile）：

| # | 验收项 | 结果 |
|---|---|---|
| 1 | 构建产物进 profile，加载无失败 | 满足：K1、K3 已观测到。宿主半边在 Desktop 的 Node 上打出就绪行；Plugins 页里本包启用，没有错误；没有新崩溃报告 |
| 2 | 导航入口与占位面板 | 满足：K4、K5、K6 已观测到（H 路线，人类伙伴截图，agent 读图）；K7 的 `package.json` 差异按 D33 从快照写回 |
| 3 | 干净检出构建，不需要宿主检出 | 满足：K0 已观测到；CI 的 verify lane 与 Merge Gate · Integration 在每个推送的 head 上 pass；锁文件 `@deepseek-ai` 计数 0 |
| 4 | boundaries 与壳只含 `.ts` | 满足：Batch 3 的 boundaries 8/8，变异 M-i / M-i2 变红 |
| 5 | 规模与发布面 | 满足：最终 head 上 `size` 为代码 799 / 1000、文档 891 / 1500（计划上限 800 / 1300）；`disclosure` 退出 0；`git diff --check` 无输出；人工五类目检查通过 |
| 6 | 产物契约的判别性 | 满足：Batch 3 的变异表 M-a–M-m 与附加变异 |
| 7 | §11.10 复测映射 | O0.1、O0.2、O0.3、O4.1、O4.2（挂载部分）、O4.3 在 `0.2.0-rc.2` 上已观测到；O3.1–O3.4 与 O4.2 的数据部分移交 #228 |

证据绑定：安装件四个文件（`dist/package/` 下）的 sha256 在 Batch 3 预演、K0 与 Batch 6 的最终重建里逐字相同（`package.json` `96050083…`、`cordis.patch.yml` `6eb0d833…`、`lib/index.js` `c0c82fb2…`、`lib/client.js` `938a8add…`），tgz 也同为 `386b30f6…`；K1 装进 profile 的两个 `lib/` 文件与之逐字节相同。最终重建：在本批的最终 head 上 `git archive` 到 `$SCRATCH/final`，`pnpm install --frozen-lockfile --offline` 与 `pack:plugin` 都退出 0，tarball 5 个条目；代码树与 `55f770f` 相同（`git diff 55f770f HEAD -- . ':!docs'` 为空）。所以 K 行不需要重跑（`Design / Spec` §7.1）。最终 head 的全仓库验证在本工作树执行（`pnpm install --frozen-lockfile` 之后 core 链接指向 `../../packages/core`）：`pnpm verify` 退出 0（833 / 833，mvp0 7 / 7），`pnpm run boundaries` 8 / 8，`node scripts/workflow-check.mjs` 为 no findings。同一 head 的 `git archive` 检出上，`pnpm verify` 有 1 条失败：`tests/contract/issue-policy.test.js:187` 的 CLI 用例要求所在目录是 git 仓库，归档检出没有 `.git`（`not a git repository`）。这是环境原因，与本 PR 无关。

**与计划的偏差**：

- H3 的截图是在会话里直接发来的，没有按清单文件名存盘（K4 与 K5 合成一张），时间归属改由内容证明（Surprises）。
- K6 截图用的是「Default levels」，比约定更严；Console 里 3 条全局错误没有归因，「不以本插件为源」只是推断（TD-P）。
- K7 有两处按字面没有满足（`package.json` 缺了空的 `dependencies` 键；残留一个空的 scope 目录），都已归因并在 H5 处理。
- H5 由 agent 按人类伙伴的授权执行（D33），不是由人类伙伴逐项决定；没有永久删除任何文件。
- Kp 缺 `<Documents>/deepseek-harness` 的清单，K7 改用 marker 对照。
- 已推送的提交不改写：本批的计划回填是 `d77c376` 加上一个整理后的 `docs(exec-plan)` 提交。

**遗留问题**：TD-K 的剩余部分（废纸篓里的三项、内容寻址库的新增条目、`$SCRATCH`）等人类伙伴决定；TD-P 交 #229；TD-L 交 #228；其余技术债务见下表。

**回顾**：预注册判据起了作用。K3 以正面的就绪行加计数取证，没有读含令牌的行。K7 的逐字节比对抓到了两件事：「remove 退出 0」掩盖了 `dependencies` 键被删，以及 pnpm 留下空 scope 目录。下次改进三点：Kp 同时记下 `<Documents>/deepseek-harness` 与内容寻址库的计数；H3 给人类伙伴一条直接存成目标文件名的命令，并请其按清单回复；K6 改用来源位置过滤。

### 技术债务（已知，随本计划登记）

| # | 内容 | 去向 |
|---|---|---|
| TD-A | 基线模块表与 0.2.0-rc.2 绑定（键与 0.1.7-rc.2 相同，取表的函数名每版都可能变，F6），`build.mjs` 与集成测试各有一份字面量（测试的一份是独立预期）；宿主升级时两处一起重取 | 宿主升级时；#230 写进升级流程 |
| TD-B | ~~精确 rc peer：每次宿主升级都要改版本号，漏改时插件被跳过（F13）~~ Superseded by D20（2026-09-30）。现状：peer 是 `~0.2.0-rc.2`，放行 `0.2.x` 内的任何 rc 与补丁；宿主在 rc 之间改变插件 API 或描述符格式时插件不会被跳过，而是在运行时失败（`Design / Spec` §10 R1）；升到 `0.3.0-rc.*` 时插件被跳过（F13），要同时改 `HOST_DSH_PEER_RANGE` 与测试字面量 | #228（引入 typed remote 描述符时决定是否收紧）、#230（升级流程） |
| TD-C | `packages/domain` 的 `ids.ts` 值导入 `node:crypto`，client bundle 无法导入 domain / ui-model / client 的运行时值；候选修法是改用 `globalThis.crypto.randomUUID()` 或拆出浏览器安全入口 | #229 |
| TD-D | 宿主 API 用本地最小结构类型（`host-surface.ts`），与宿主真实类型之间没有编译期绑定 | #228（与 typert-protocol 一起决定是否引入类型包并用 `satisfies` 收紧） |
| TD-E | 安装件不带 source map | #230（按仓库相对路径生成 `sources`） |
| TD-F | 安装件 `private: true` | #230 |
| TD-G | 宿主半边只有就绪行；宿主入口依赖 controller / core / storage 需要 ADR 并修改 boundaries（#225 计划 TD5） | #228 |
| TD-H | 占位面板的文案未本地化 | #229 |
| TD-I | 默认工作区目录的隔离依赖 scratch 用户 patch 里的 `documentsDirectory` 覆写（D18）；演示环境与安装指南需要写明这一点，否则首次进入会在账户的 `<Documents>` 下建目录（F25）。**对 #227 的验收 Superseded by D24（2026-09-30）**，事实仍交 #229 / #230 的 npm 路线 | #229（演示环境）、#230（安装指南） |
| TD-J | Desktop 不转出宿主 stderr（F29）：兼容闸门的跳过行与启动审计诊断在 Desktop 下只能从 Plugins 页与崩溃报告间接看到；安装指南与排障要写明「从终端 `open --stdout` 启动」这一观测手段 | #230 |
| TD-K | 验收在真实 `desktop` profile 与 pnpm 用户级内容寻址库留下的残留（`Design / Spec` §7.5）。**2026-09-30 已处理（D33、H5）**：profile 回到 Kp 快照（四个配置文件的 sha256 与顶层清单一致）；`.plugin-manager/`、`node_modules/`、`pnpm-lock.yaml` 在 macOS 废纸篓里，可以恢复；`~/Library/pnpm/store/v11` 里本次新增的条目没有动（5 个内容文件、1 个目录名嵌有临时路径的索引项、`index.db` 被改写）；`$SCRATCH` 保留（含截图与带过期令牌的 `desktop.out`）。后三项是否清理由人类伙伴决定 | 人类伙伴 |
| TD-L | O3.1–O3.4 与 O4.2 的数据部分在 `0.2.0-rc.2` 上的复测（D25） | #228 |
| TD-M | ADR-0009 的「来源」与 `docs/adr/README.md` 的证据说明引用本计划的 `active/` 路径 | 本计划归档到 `completed/` 时一并改 |
| TD-N | 壳断言是 `.ts` 白名单：#229 若要在壳里放非 TS 资源，需同时改断言与 ADR-0009 第 6 条 | #229 |
| TD-O | ~~D28：react 是否入锁待人类伙伴确认；不接受时按 D28 的替代修改~~ 已关闭（2026-09-30）：人类伙伴接受（D31） | — |
| TD-P | K6 时 Desktop 的 Console 有 3 条全局错误，不匹配 `harness`，没有逐条归因；「不以本插件为源」是推断（Progress 的 K6）。#229 起面板有真实逻辑之后，K6 应改用来源位置过滤（`url:` 加 combo 路由），并逐条看全局错误 | #229 |

## Bottom Change Note

- 2026-09-29：创建。独立评审复核 `docs/architecture/harness-host-spike.md` §11、宿主运行时 0.1.7-rc.2 的相关包、仓库 boundaries 契约与 CI 之后，综合三份独立设计定稿（D4）；登记人类伙伴的三项决定（D1–D3）与待确认项（D5、D8、D15）。
- 2026-09-29T16:08Z：会话因额度中断后恢复。#225 的本地 head 已前进到 `d10d0ad`，按它重新核对 §11：新增 F25（默认工作区目录不受 `DSH_HOME` 隔离）、F26（pnpm pack 放进 `LICENSE`，A2 转为事实）、A5；K 行加基线启动 Kb 并改写 K0、K2、K3、K7 的判据（D17–D19）；Batch 0 加快进与「#225 已推送」前置；T5 所有权加 `tests/README.md`；登记 TD-I。
- 2026-09-30：按人类伙伴 2026-09-30 在会话中的四项决定修订（来源：会话中的选择题回答与委托）：目标宿主线 `0.2.0-rc.2` 与 peer 范围（D20）、esbuild（D21，确认 D5）、以本机 Desktop `0.2.0-rc.2` 与真实 `desktop` profile 为验收宿主（D22）、浏览器观测的调研结论（D23）。独立定稿者只读复核 Desktop 应用包、`$ASAR` 与 #225 新 head 的 §11.10 之后：新增 F27–F35、A6、A7、D23–D26、`Design / Spec` §7（Desktop 版 K 行、H 步清单、B 路线、写入与埋点披露）与 §10 风险；测试 a 的 peer 断言随 D20 改写，变异表加 M-l、M-m；证据绑定由「`apps/harness-plugin` 树哈希」改为安装件四个文件的 sha256；D8、D15、D17、D18、A5、F25（对本计划）、TD-B、TD-I 与 Global Constraints 的两条禁止标 Superseded；K2、Kb、K3c 不再执行；Batch 0 的快进改为由主会话变基（#225 已改写历史）；Batch 4–5 重写；登记 TD-J、TD-K、TD-L。
- 2026-09-30 Batch 1–3：T0–T5 按 D1 的流程完成，T6 整合、处理对抗验证的意见并在最终树上跑完全仓库验证与变异表（Progress）；新增 Surprises 六条、D27–D30、TD-M–TD-O；U1 订正 `"use strict"` 一句。
- 2026-09-30 Batch 4（第一阶段）：登记人类伙伴在会话中的两项决定——D31（确认 D28，react 入锁，TD-O 关闭）与 D32（H0 选 H 路线）；按 §7.1 建环境并执行 K0（已观测到）；新增 Surprises 一条（`pnpm pack` 去掉 `package.json` 末尾换行）。Kp、K1 等人类伙伴的 H1。
- 2026-09-30 Batch 4（第二阶段）：人类伙伴回复 H1「已退出」，`desktop_down` 核对为真；执行 Kp（版本、快照、四个 sha256、顶层清单、`dsh.profile.bundles` 都记入 Progress）与 K1（已观测到，A3 成立）；清空 `desktop.out`，交接 H2。
- 2026-09-30 Batch 5（第一阶段）：人类伙伴回复 H2「已启动」；K3（1–3）已观测到（就绪行、`dsh web:` 行、进程与端口、崩溃报告目录）；交接 H3 的截图清单。
- 2026-09-30 Batch 5（第二阶段，WIP）：人类伙伴在会话中直接发来两张截图（K4 与 K5 合一张、K3 一张），agent 读图判定 K3（4）、K4、K5 已观测到，只转录判据相关元素；截图的时间归属改由内容证明（Surprises）；K6 等补拍。
- 2026-09-30 Batch 5（第三阶段，WIP）：人类伙伴补拍 K6 并附言「无 error」；agent 独立读图判定 K6 已观测到，记录级别选择与约定不同（更严）、全局 3 条错误未归因（「不以本插件为源」写成推断）两处偏离；K3–K6 汇总写入 Progress；交接 H4。
- 2026-09-30 Batch 5–6（收尾）：人类伙伴回复 H4「已退出，后续这些操作你可以直接做」（D33）；K7 已执行，两处字面判据未满足并已归因；H5 按 D33 把 profile 恢复到 Kp 快照，残留移入废纸篓，没有永久删除；回填 Progress、Surprises（四条）、D33、Outcomes、TD-K、TD-P 与 §11.10 复测映射；本地 WIP 提交合并为一个 `docs(exec-plan)` 提交后快进推送。

- 2026-09-30：按人类伙伴授权完成归档与ADR采纳准备，提交以可安装占位插件为一个交付物，#238/#244合并后restack并重锁当前head。归档保持运行时代码与K证据哈希契约，后续transport范围仍按D25。

- 2026-09-30：在#238/#244的实际合并main上完成restack，唯一冲突为docs索引，保留双方并改到Completed章节。产品、构建、依赖和本层产物测试与restack前逐字相同；新增基线的#244守卫一并纳入最终verify。
