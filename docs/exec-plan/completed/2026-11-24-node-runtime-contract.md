# Node 运行时契约 ExecPlan

> 状态：Completed（2026-11-24 归档；rev-687 复评 PASS）
> 创建：2026-11-24
> 范围：把根 `engines.node` 收窄到 CI 实跑的 source workspace 行，补齐可擦除语法编译期守卫、真实入口 smoke、负控与唯一运行模式文档；compiled Host 模式不动。
> 上游输入：issue #313（`replan-20261124:current`）、issue #678、2026-11-24 独立设计评审与 Lead 裁决（结论见 Decision Log）。
> 落点：本 PR 内是 `docs/exec-plan/active/2026-11-24-node-runtime-contract.md`，独立对抗验收通过后移 `docs/exec-plan/completed/`（文件名不变）；`docs/README.md` 的 Active/Completed 索引行由本 PR 自行维护（D11）。

## Purpose / Big Picture

完成后，仓库只声明一个 source workspace 运行时：根 `engines.node = ">=26.0.0"` 与 `.nvmrc = 26` 同一行；`pnpm typecheck` 在运行前拒绝非可擦除语法；`tests/contract/runtime-support.test.js` 把 engines、`.nvmrc`、CI 的 setup-node 来源、`build.mjs` 的 Host 常量、`@types/node` 上界与文档表钉在一起，并在声明行 Node 上真实 import 18 个包的全部 24 个 exports 入口；`docs/development/runtime-support.md` 成为 source 与 compiled Host 两种模式的唯一散文权威。compiled Host 的 `HOST_NODE_TARGET=node22`、`HOST_NODE_VERSION=24.18.1`、`@types/node ~24.13.5` 与既有 `host-node-types.test.js` 保持不变。

判断成功的最小证据：① `node --test tests/contract/runtime-support.test.js` 输出 `ℹ fail 0`；② `pnpm typecheck` 退出 0；③ `node scripts/rule-checks.mjs size eadf4901` 技术 ≤300、文档 ≤1300；④ PR 的 `Verify` lane 在 `.nvmrc` 的 Node 上跑完 `pnpm verify` 且 `PR Fast Gate` 绿。

## Context and Orientation

**两种运行模式。** source workspace 模式指开发与测试命令直接运行 `.ts` 源码，靠 Node 原生类型剥离（当前 `process.features.typescript === 'strip'`），CI 的 `verify`/`browser`/`windows-native` lane 都在 `.nvmrc` 的 Node 上执行。compiled Host 模式指 `apps/harness-plugin` 用 esbuild 打出安装件，宿主半边 `lib/index.js` 在 Desktop 0.2.0-rc.2 的 Electron 44 / Node 24.18.1 进程内运行；它的语法目标是 `node22`，API 上限由 `@types/node` 的 major.minor 表达。两者本就不是同一个运行时，只是被旧 `engines >=22.0.0` 并成一句话。

**当前事实（观察基线 `main@eadf4901`，2026-11-24，检出根目录）。**
- `package.json:9-11` 声明 `"node": ">=22.0.0"`；`package.json:45` 是 `@types/node ~24.13.5`；`package.json:22-44` 的根 devDependencies 列出 18 个 `@harness-projects/*` workspace 包。
- `.nvmrc:1` 是 `26`，只有 major。
- `tsconfig.base.json` 有 `target: ES2022`、`allowImportingTsExtensions: true`、`isolatedModules: true`、`noEmit: true`，没有 `erasableSyntaxOnly`；`tsconfig.json:25` 的 include 只覆盖 `packages/**/src` 与 `apps/**/src`，不含 `tests/`。
- 8 个 `actions/setup-node` 步骤全部写 `node-version-file: .nvmrc`，无内联 `node-version:`：`ci.yml:33/55/97`、`rule-checks.yml:94/160`、`board-invariants.yml:58/81`、`engineering-state.yml:46`。
- 契约外的 Node 执行：`issue-policy.yml:37/43` 在 ubuntu-latest 镜像自带 Node 上跑只依赖内建模块的 `scripts/policy-check.mjs`（advisory）；`github-review.yml:71` 在 self-hosted macOS 系统 Node 上跑一行 `node -e` HMAC。两者都不加载工作区 TS。
- `apps/harness-plugin/scripts/build.mjs:44-55` 声明 `HOST_NODE_TARGET='node22'`、`HOST_NODE_VERSION='24.18.1'`，:44 注释把 Host 目标解释成「不高于 Desktop 的 Node 24.18.1 与仓库 engines.node >=22」；`createManifest`（:131-161）生成的安装件 manifest 不含 `engines`。
- `tests/contract/host-node-types.test.js:39` 直接 import 两个 Host 常量（单一声明）；:119-130 断言目标 major ≤ 宿主 major；:186-202 断言每个清单的 `@types/node` 是 minor 有界写法且 major.minor ≤ 24.18；:204-216 断言锁文件解析值同样不越界。
- `tests/integration/harness-plugin-artifact.test.js` 的「c. 宿主半边是 Node 可直接加载的 JS」在临时 node_modules 里真实 import 打包产物并 `apply()`，是 packed Host 的既有深度证据。
- 工作区 18 个包共声明 24 个 exports 子路径（`.` 之外另有 capabilities/client/controller/domain 的 6 个）；以根 `node_modules` 的裸包名逐个 import，Node v26.13.1 上 24/24 成功，耗时约 230ms。
- 本机没有 `.npmrc`（无 `engine-strict`），所以根 `engines` 当前只是 pnpm 的警告级元数据，不阻断安装，也不进锁文件。
- 基线上 `./node_modules/.bin/tsc --noEmit -p tsconfig.json` 与追加 `--erasableSyntaxOnly` 均退出 0、零输出（TS 5.9.3），即现有源码全部可擦除，AC3 只需把 flag 落进配置。

**上游依据与写边界。** 2026-11-24 独立设计评审与 Lead 裁决（结论见 Decision Log）规定三个 PR 各自基于 `main@eadf4901`、不同 worktree、文件集互不重叠；`ci.yml` 与 `docs/development/ci.md` 归 #679 owner，`docs/adr/` 归 #666 owner（其设计输入只动 ADR-0002/0015/0016 与 `docs/adr/README.md`）。本计划据此把 #313 的写入面限定在下面的 `Global Constraints`，并保证除 `docs/README.md` 的自身索引行外不与另外两个 PR 同文件。

**两份独立设计的差异。** 设计 A 用一个测试文件承载 7 条契约（含文档表绑定）；设计 B 用两个测试文件（T1–T5 + S1–S2）并额外扫描「没有 setup-node 却执行 node 的 workflow」。两者对「source 行 = 26、Host 行不动、erasableSyntaxOnly 进门禁、负控夹具」一致；分歧与取舍见 `Design / Spec` 的 3.7。

## Design / Spec

**3.1 事实分工（一个事实只写一处）。** 机械事实源保持现状：根 `package.json:engines.node` 拥有 source 下界，`.nvmrc` 拥有执行行，`build.mjs` 的两个常量拥有 Host 目标与宿主版本，根 `package.json` 的 `@types/node` 拥有类型上限，`.github/workflows/*.yml` 拥有 CI 接线。新增的唯一散文权威 `docs/development/runtime-support.md` 只解释这些值，不复制成第二事实源；新契约测试只**绑定关系**并把文档值钉到上述来源，不新增任何运行时台账。

**3.2 契约测试（`tests/contract/runtime-support.test.js`，7 条，中文标题）。** 首行 `import '../fixtures/resolution-preflight.mjs'`；根目录用 `fileURLToPath(new URL('../..', import.meta.url))`；复用 `tests/fixtures/source-tree.mjs` 的 `listPackageDirectories` 与 `tests/contract/content-placement.test.js` 的 tableRows 解析技法（局部实现，约 13 行）。
1. `source：engines.node 与 .nvmrc 是同一行`——engines 必须匹配 `^>=(\d+)\.0\.0$`，`.nvmrc` 匹配 `^\d+(\.\d+){0,2}$` 且 major 相等；失败消息同时打印两个值与两个文件路径，并写明「改 .nvmrc 的同一 PR 改 engines」。另断言 `listPackageDirectories(repoRoot, ['apps','packages'])` 的包名集合与根 devDependencies 的 `@harness-projects/*` 集合相等（保证裸包名可解析、新增包不能逃过 smoke）。
2. `CI：所有 actions/setup-node 步骤只从 .nvmrc 取 Node`——解析 `.github/workflows` 下全部 `*.yml/*.yaml`（`yaml.parse`，解析失败即抛错 fail closed）；对每个 `uses` 以 `actions/setup-node@` 开头的 step，断言 `with['node-version-file'] === '.nvmrc'` 且 `with['node-version'] === undefined`；断言解析到的文件数 ≥1 且 setup-node step 数 ≥1（防空转）。
3. `运行时：当前进程满足声明下界且处于原生 strip 模式`——解析 `process.versions.node` 三段与 engines 下界逐段比较（Node 27 也通过，符合 `>=26.0.0` 语义）；断言 `process.features.typescript === 'strip'`；失败消息写明这是声明支持面断言，在 Node 24 上失败是预期，修复方向是改用 `.nvmrc` 的 Node 或另开扩宽 issue。
4. `编译期：解析后的 tsconfig.json 启用 erasableSyntaxOnly`——用 `typescript` API 的 `getParsedCommandLineOfConfigFile(repoRoot/tsconfig.json, {}, {...ts.sys, onUnRecoverableConfigFileDiagnostic: 抛错})`，断言 `parsed.options.erasableSyntaxOnly === true`；不用正则读 JSON，以便走 `extends` 链并防止未来在 `tsconfig.json` 里覆盖成 false。
5. `编译期：负控夹具只被 TS1294 拒绝`——`createRequire(import.meta.url).resolve('typescript/bin/tsc')` 得到 tsc，`spawnSync(process.execPath, [tscBin, '--noEmit', '-p', fixtureTsconfig], {encoding:'utf8'})`；断言退出码非 0；合并 stdout+stderr 后正则匹配 `probe\.ts\(\d+,\d+\): error TS1294`；断言出现 ≥3 条 TS1294；断言输出里**所有** `error TS\d+` 的错误码都等于 1294（排除配置错误造成的假绿，如 TS5083/TS2688/TS1287）。tsc 缺失时直接失败，不 skip。
6. `运行时：18 个包的 24 个 exports 入口在声明行 Node 上裸加载`——对每个 workspace 清单枚举 `exports` 的字符串键，断言目标匹配 `^\.\/src\/.+\.(ts|tsx)$`（禁止 `dist/`、`lib/`）且至少有一个 `.`；把 `name` 或 `name + key.slice(1)` 作为真实说明符逐个 `await import()`，断言命名空间非 null、成功数等于枚举数且 ≥ 包数；失败消息带说明符与错误码。它证明「声明的 source 运行时能加载实际入口且不用未记录 flag」，并逐子路径覆盖 exports map。
7. `文档：runtime-support.md 存在、被索引，且表格值与代码一致`——`docs/development/runtime-support.md` 存在；`docs/development/README.md` 含 `runtime-support.md`；用 tableRows 找表头以 `| 模式 ` 开头的表，取首列为 `source`/`host` 的两行：source 行必须包含根 `engines.node` 值与 `.nvmrc` 值，host 行必须包含 `HOST_NODE_TARGET`、`HOST_NODE_VERSION` 与根 `@types/node` 的值；断言 `@types/node` 的 major.minor ≤ `HOST_NODE_VERSION` 的 major.minor；断言文档点名的三条证据路径存在（本测试文件、`tests/contract/host-node-types.test.js`、`tests/integration/harness-plugin-artifact.test.js`）。不要求 `docs/README.md` 链接：索引行是计划维护动作，不是运行时契约事实。

**3.3 文档 `docs/development/runtime-support.md`（约 110 行，中文正文）。** 章节：① 地位与权威声明（本文件是 Node 支持面的唯一散文源，机械源是 package.json/.nvmrc/build.mjs/@types，本文由测试绑定；历史计划/评审/审计里的 `>=22` 是当时事实，不回改）；② 两种模式表（测试解析的那张，见下）；③ 为什么 source 行是 26（`.nvmrc` 是 CI 唯一 Node 来源，26 是唯一实跑行；22.x/24.x source 没有消费者也没有 CI 证据，因此删除而不是保留矩阵；契约单位是 major，不声称逐 patch 验证）；④ 为什么 Host 行不是 26（node22 语法目标 + Node 24.18.1 API 上限，源码收紧不影响产物；ADR-0009 决策不变）；⑤ engines 的语义（开发者约束，不是安装件契约：无 `engine-strict`，pnpm 只告警；安装件 manifest 不写 engines，Host 准入读 `dsh-*` peer）；⑥ 可擦除语法守卫（Node 只剥离类型；enum/带运行时代码的 namespace/参数属性/`import =`/`export =` 在 tsc 期报 TS1294；运行时兜底是 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX；新代码用 `as const` 对象，参见 `packages/domain/src/enums.ts`）；⑦ 类型面 ≠ 运行时（`@types/node ~24.13.5` 是 Host 24.18.1 天花板，源码在 26 上跑但类型面停在 24.13，是故意保守，不得依赖 25/26 新增 API）；⑧ CI 实际验证/未验证（已验证：Linux `verify` 在 `.nvmrc` 26.x 上跑 typecheck+test、`browser` 与 `windows-native` 同 Node，但 `windows-native` 不跑 `tests/contract/`；未验证：Node 22/24 source 模式、Node 26 逐 patch、Desktop Node 24.18.1 真机执行、两个契约外 workflow 的镜像/系统 Node）；⑨ 命令（`pnpm install --frozen-lockfile && pnpm verify`、`node --test tests/contract/runtime-support.test.js`，附期望 `ℹ fail 0`）；⑩ 升级流程（source 行升级 = 同 PR 改 `.nvmrc`、engines、本文表，测试强制；Host 升级 = `build.mjs` 两常量 + `@types/node` + 既有 Host 测试 + 本文表；新增第三种运行时 = 契约变更，必须先有 CI lane 并改 `ci.yml`/`ci.md`，归 CI owner）。

表（测试逐字绑定，列固定）：

```markdown
| 模式 | 谁在运行 | 版本事实 | 自动证据 |
|---|---|---|---|
| source | 开发与测试命令 `pnpm install`/`pnpm typecheck`/`pnpm test`；CI `verify`、`browser`、`windows-native` lane | `engines.node` = `>=26.0.0`；`.nvmrc` = `26` | CI `verify` 每 PR 的 `pnpm verify`；`tests/contract/runtime-support.test.js` |
| host | `apps/harness-plugin` 安装件的宿主半边 `lib/index.js`，在 Desktop 宿主进程内 | `HOST_NODE_TARGET` = `node22`；`HOST_NODE_VERSION` = `24.18.1`；`@types/node` = `~24.13.5` | `tests/contract/host-node-types.test.js`；`tests/integration/harness-plugin-artifact.test.js` 的「c. 宿主半边是 Node 可直接加载的 JS」 |
```

**3.4 就地订正的三处现时句与 ADR 注记（保留历史理由，不删原文）。**
- `docs/architecture/release-gates.md:96`：在「（`package.json` 声明 Node ≥ 22，而据 Node 官方 CLI 文档…）」这一括号内插入「engines.node 自 2026-11-24 起为 >=26.0.0，见 docs/development/runtime-support.md；以下关于 Node 22 的讨论保留为当时的理由」，后半句不动。
- `docs/product/vertical-path.md:118`：把「`package.json` 声明 Node ≥ 22，所以这条命令只用…」改为「命令只用…（写于 engines 为 ≥22 时；当前支持面见 docs/development/runtime-support.md）」，关于 Node 22 未实跑的局限保留。
- `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md:533`（事实核对新增的第三处现时句，Lead 裁决确认纳入本 PR，见 D14）：「开发入口为仓库根目录的 Node ≥ 22（本轮观察 v26.10.0）」后加「（2026-11-24 #313 后 engines.node 为 >=26.0.0；本条保留当时观察，见 docs/development/runtime-support.md）」。
- `docs/adr/ADR-0009-harness-plugin-installable-artifact.md:22`：在 Decision 5 的括号后加一行「**Superseded（2026-11-24，#313）**：仓库 engines.node 现为 >=26.0.0；本决策的 node22 构建目标与 Host 24.18.1 类型上限不变，见 docs/development/runtime-support.md」。ADR 状态仍为 Accepted，与 #666 的文件集（ADR-0002/0015/0016 与 docs/adr/README.md）不重叠。

**3.5 不变量。** I1 source 声明行 == `.nvmrc` 行 == CI 经 setup-node 执行的 major（测试 1/2 + 每 PR CI）。I2 仓库只有一处 source 运行时声明（根 engines）与一处 Host 运行时声明（build.mjs 两常量）。I3 产品源码全部在根 tsconfig include 内且编译期拒绝非可擦除语法。I4 所有 workspace 包声明的每个 exports 子路径在没有未记录 flag 的声明行 Node 上可加载。I5 Host 两常量、`@types/node` 上界与文档表一致；目标 major ≤ 宿主 major（后者继续由 host-node-types 拥有）。I6 本 PR 无产品行为、schema、权限、原子性、ack/reconcile 改动。

**3.6 被放弃的方案与理由。**
- **CI 版本矩阵 lane（22.18/24.18.1 实跑）**：唯一能扩大支持面的方案，但越界（`ci.yml` 归 #679）、违反「无当前消费者不加宽矩阵」，且牵连 Fast Gate needs、W1–W7、`ci.md`，成本远超预算。放弃；若将来人类确认需要 24.x source，另开 issue 串行实施。
- **保留 `>=22.0.0` 只写文档**：正是 issue 要消灭的假声明；`engines` 的语义是「受支持」，且 22.0–22.17 无默认类型剥离、无 `node:sqlite`，技术上也不成立。放弃。
- **声明 `>=24.18.1`**：把 Host 版本混成 source 版本故事，且 24 未被 CI 执行。放弃。
- **在 `/tmp` 用 mkdtemp 生成负控探针**：本机实测两个坑——没有 `package.json {"type":"module"}` 时报 TS1287，`typeRoots` 解析不到 `@types/node` 时报 TS2688；契约定型为仓内夹具（`tests/fixtures/node-runtime/negative-erasable/`）后由根 `package.json` 的 `type: module` 与根 `node_modules/@types` 自然解决，且没有临时目录清理面。放弃临时目录形态。
- **两个测试文件 + T2 例外登记表**：设计 B 的「没有 setup-node 却执行 node 的 workflow 必须登记」是第二份硬编码事实源（issue-policy/github-review 两条），超出 Lead 裁决的测试 ①，且新 workflow 需要同时改测试与文档；改为在 `runtime-support.md` 的未验证节用散文登记两个契约外执行，测试只绑定 setup-node 的 `node-version-file`。放弃登记表。
- **断言 workspace 子包不得写 engines、给 `packages/domain/src/enums.ts` 追加注释**：前者会禁止未来合法的包级声明且与 AC 无关；后者是产品源码 churn。都放弃。
- **让测试检查 `docs/README.md` 链接**：该文件同时是 #679 的计划索引编辑点；本 PR 只维护自己的一行索引（D11），测试不绑定它。放弃。

**3.7 设计间冲突与取舍（证据）。**
- 设计 B 的 S1 断言 `importers.length - 1 === 入口数` 并假设每包只有 `exports["."]`；实测 18 包共 24 个 exports 子路径（capabilities/client/controller/domain 各有额外子路径），按 B 字面实现会漏测 6 个真实入口或计数失败。选定按 exports 枚举全部 24 个说明符（已实测 24/24 可加载）。
- 设计 A 的运行时断言比较「进程 major == 声明 major」；`>=26.0.0` 语义下 Node 27 应通过，等值断言会把合法运行时判红。选定逐段 `>=` 比较。
- 设计 A 有文档表绑定、B 没有；AC4 要求文档精确，保留 A 的文档绑定。设计 B 有仓内负控夹具与 TS API 解析，采用 B 这两点。最终合为一个测试文件 + 一个夹具目录。
- 设计 A 计划改 `docs/README.md:20` 与 enums.ts；按最小化与 D11 移除（见 3.6）。
- Lead 裁决要求给 ADR-0009 加注，而 issues 轮次决策写「#666 owner 只改 docs/adr/ 下文件」；两者不构成文件冲突（#666 只动 ADR-0002/0015/0016 与 README），目录归属已由 Lead 裁决确认（D13）。

## Global Constraints

**写入边界（本 PR 修改的文件集合，只在这里声明一次）。**

| 文件 | 变更 |
|---|---|
| `package.json` | `engines.node` 由 `">=22.0.0"` 改为 `">=26.0.0"`（1 行） |
| `tsconfig.base.json` | 在 `isolatedModules` 后新增 `"erasableSyntaxOnly": true` 及一行说明注释 |
| `apps/harness-plugin/scripts/build.mjs` | 只改 :44 注释：Host 目标只受验收宿主 Node 24.18.1 约束，源码工作区 engines 是另一种模式（常量值不动） |
| `tests/contract/runtime-support.test.js` | 新增 7 条契约（约 190–210 行） |
| `tests/fixtures/node-runtime/negative-erasable/probe.ts` | 新增负控夹具（enum、带值的 namespace、构造器参数属性） |
| `tests/fixtures/node-runtime/negative-erasable/tsconfig.json` | 新增，`extends ../../../../tsconfig.base.json`，include 仅 probe.ts |
| `docs/development/runtime-support.md` | 新增唯一运行模式文档（约 110 行） |
| `docs/development/README.md` | 入口表加一行 runtime-support.md 索引 |
| `docs/architecture/release-gates.md` | :96 就地订正（+1 行内文本） |
| `docs/product/vertical-path.md` | :118 就地订正（+1 行内文本） |
| `docs/adr/ADR-0009-harness-plugin-installable-artifact.md` | Decision 5 后加 1 行带日期 superseded 注记 |
| `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` | :533 加 1 行带日期现时注记 |
| `docs/exec-plan/active/2026-11-24-node-runtime-contract.md` | 本计划（批准时以计划提交写入；验收后移 `docs/exec-plan/completed/`） |
| `docs/README.md` | Active 表加本计划一行；归档批次改为 Completed 表对应行（D11） |

**明确不写。** `.github/workflows/ci.yml` 与其他所有 workflow；`docs/development/ci.md`；`pnpm-lock.yaml`；`@types/node` 范围；`HOST_NODE_TARGET`/`HOST_NODE_VERSION`；除 build.mjs 注释外的全部产品代码（含 `packages/domain/src/enums.ts`）；`docs/README.md` 中除本计划自身索引行以外的内容；`docs/adr/` 下除 ADR-0009 注记外的文件；`docs/review/`；issue 正文、Project `Status`、blocked-by/blocking；任何新依赖、脚本、workflow、CI lane 或生成物。

**规模预算。** 技术增删 ≤300（预估 `~220–240`：配置 5、测试 200、夹具 18），含全部文档 ≤1300（`runtime-support.md` 110 + 就地订正/ADR/索引约 8 + 本 ExecPlan 约 250）。以 `node scripts/rule-checks.mjs size eadf4901` 的输出判定；`docs/` 与 `*.md` 计入文档桶。技术预估低于 Lead 给的 235–295 目标下沿是刻意的：不加入非判别性的行，见 D12（Lead 已接受）。

**硬约束。** 不引入旧数据/旧 API/旧行为兼容层、版本矩阵、实验运行时或第二份 runtime 事实；不改写历史记录（ADR/评审/审计/历史计划的原文），只就地追加带日期注记；文档正文中文、代码标识符/路径/命令英文；提交信息 Conventional Commits 并以 `Closes #313` 结尾；不写 Project Status，不合并 PR；不使用本机绝对路径、账号信息或凭据；证据记录必须带检出上下文（`chore/node-runtime-contract-20261124` 或 head SHA，仓库内相对路径）。

**Superseded（2026-11-25，见 D16–D17）**：上段「不合并 PR」对当前用户明确授权的 PR #687–#689 收尾不再适用；允许在恢复点保护下整理已推分支历史并按精确 lease 发布。文档历史只追加注记、不改 Planning Status 等其余约束保持。

**证据边界。** 本机 macOS 可证明：契约解析、tsc 守卫与负控、24 入口在 Node 26.13.1 上的加载、文档一致性、size/disclosure/workflow-check/link 检查。只有 PR CI 可证明：hosted runner 上 `.nvmrc` 解析到 26.x、`pnpm verify` 与 `PR Fast Gate` 绿、Windows lane 同 Node 但**不跑** `tests/contract/`。两者都不能证明：Node 22/24 的 source 模式、Node 26 的逐 patch、Desktop Node 24.18.1 的真机执行（人工安装验收/R1 独立）、两个契约外 workflow 的镜像/系统 Node 版本。

**工具与版本。** 本机 Node v26.13.1（`features.typescript === 'strip'`）、pnpm 10.28.2、TypeScript 5.9.3、`yaml`（已在根 devDependencies）；命令都在检出 `chore/node-runtime-contract-20261124`（base `main@eadf4901`）的工作树根目录运行；`gh` 命令带 `-R SingularityKChen/harness-projects`。

## Plan of Work

### Batch 0 · 基线与隔离（无写入）
**最小闭环**：确认工作树、基线与工具链状态，记录后续对照的起点。
**涉及文件**：无。
**步骤**：`git rev-parse --short=8 HEAD`、`git status --short --branch`、`git worktree list --porcelain`、`git check-ignore -v .worktrees/`；再跑 `node -e "console.log(process.version, process.features.typescript)"` 与 `./node_modules/.bin/tsc --noEmit -p tsconfig.json --erasableSyntaxOnly`。
**验证**：`git rev-parse --short=8 eadf4901` 解析成功（base 未漂移）；HEAD 只比 base 多计划提交；工作树干净；输出 `v26.13.1 strip`；tsc 退出 0。
**回滚**：无改动可回滚；若发现工作树不干净或联动检出，先停实现并报告 Lead。

### Batch 1 · 契约测试与负控夹具（判别性 RED）
**最小闭环**：先落地 7 条契约与负控夹具，证明它们在当前树上按预期红，而不是把测试写成事后自述。
**涉及文件**：`tests/contract/runtime-support.test.js`（新）、`tests/fixtures/node-runtime/negative-erasable/probe.ts`（新）、`tests/fixtures/node-runtime/negative-erasable/tsconfig.json`（新）。
**步骤**：写测试（3.2 的 7 条）与夹具；probe.ts 用 `export enum`、带值的 `export namespace`、构造器参数属性三种语法，并在文件头注释说明「负控专用、只能被 TS1294 拒绝、不在任何 tsconfig 的 include 里」；夹具 tsconfig 只 extends 根 base 并 include probe.ts。
**验证**：`node --test tests/contract/runtime-support.test.js` → `ℹ tests 7 / ℹ pass 3 / ℹ fail 4`，失败项恰为 1（engines 22≠26）、4（解析出的 erasableSyntaxOnly 为 undefined）、5（无 flag 时夹具编译通过、tsc 退出 0）、7（文档不存在）；2、3、6 应绿。若红在别的原因（例如 import 路径写错），先修测试。
**回滚**：删除三个新文件；`git status --short` 回到 Batch 0 状态。

### Batch 2 · 声明与编译期守卫（6/7 GREEN）
**最小闭环**：把 source 声明收窄到 26 并启用可擦除语法守卫，证明现有源码零改动即可通过。
**涉及文件**：`package.json`、`tsconfig.base.json`、`apps/harness-plugin/scripts/build.mjs`（仅注释）。
**步骤**：改 engines 一行；在 tsconfig.base 的 `isolatedModules` 后加注释与 `"erasableSyntaxOnly": true`；改 build.mjs:44 注释为「构建目标只受验收宿主 Node 24.18.1 约束；源码工作区 engines 下界是另一种模式，见 docs/development/runtime-support.md」；常量值不动。
**验证**：`node --test tests/contract/runtime-support.test.js` → `ℹ tests 7 / ℹ pass 6 / ℹ fail 1`（只剩文档项）；`pnpm typecheck` → 退出 0、零输出。
**回滚**：`git checkout -- package.json tsconfig.base.json apps/harness-plugin/scripts/build.mjs`；重跑 Batch 1 命令回到 fail 4。

### Batch 3 · 运行时支持文档与就地订正（7/7 GREEN）
**最小闭环**：写唯一运行模式文档并完成三处现时句与 ADR 注记，使文档与代码互相钉住。
**涉及文件**：`docs/development/runtime-support.md`（新）、`docs/development/README.md`、`docs/architecture/release-gates.md`、`docs/product/vertical-path.md`、`docs/adr/ADR-0009-harness-plugin-installable-artifact.md`、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`。
**步骤**：按 3.3 写文档（表逐字使用 3.3 给出的两行）；README 入口表加 `| runtime-support.md | Node 支持契约：源码工作区 / 编译 Host 的验证边界 |`；按 3.4 做四处就地注记（保留原文，只追加带日期的现时结论）。
**验证**：`node --test tests/contract/runtime-support.test.js` → `ℹ tests 7 / ℹ pass 7 / ℹ fail 0`；链接检查命令（见 `Validation and Acceptance`）输出 `links ok`；反向指针 grep 在五个文件上读回 5 行。
**回滚**：删除新文档并 `git checkout --` 五个被改文件；测试回到 fail 1。

### Batch 4 · 全量验证与判别力变异
**最小闭环**：用仓库门禁命令与变异矩阵证明新测试不是空转，且没有越界改动。
**涉及文件**：无新增；只在工作树内做临时变异并还原（见下表）。
**步骤**：先跑全量命令（`Validation and Acceptance` 的 1–9），全部通过后逐条执行变异；每条变异先确认 `git diff` 非空（已应用），再确认指定断言红，再 `git checkout -- <file>` 还原并复跑绿，最后 `git status --short` 干净。变异矩阵：
| # | 变异 | 期望 |
|---|---|---|
| M1 | `package.json` 的 engines 改回 `>=22.0.0` | 测试 1 红 |
| M2 | `.nvmrc` 改为 `24` | 测试 1 红 |
| M3 | 删掉 `tsconfig.base.json` 的 `erasableSyntaxOnly` | 测试 4、5 红 |
| M4 | 在 `packages/domain/src/index.ts` 加 `export enum RuleProbe { A }` | `pnpm typecheck` 红且报 TS1294；smoke 亦红（ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX） |
| M5 | 给 `.github/workflows/board-invariants.yml` 的 setup-node step 加 `node-version: 24` | 测试 2 红 |
| M6 | 把文档表 source 行的 `>=26.0.0` 改成 `>=25.0.0` | 测试 7 红 |
| M7 | 把夹具 tsconfig 的 extends 改为 `./missing-base.json` | 测试 5 红，消息指出非 TS1294 错误码 |
| M8 | 用 `npx -y node@24.18.1 --test tests/contract/runtime-support.test.js` 跑一次（可选表征，需要 npx 网络/缓存） | 测试 3 红；不可用时记录未执行，不影响验收 |
**验证**：全量命令输出如 `Validation and Acceptance` 所列；M1–M7 全部红在指定断言上；还原后测试 7/7、`pnpm typecheck` 0、`git status --short` 干净。
**回滚**：每条变异用 `git checkout --` 还原；若还原遗漏，`git diff eadf4901 -- <file>` 必须为空。

### Batch 5 · 整理提交并交接 Lead
**最小闭环**：把实现、测试与文档收敛成可独立审阅的提交序列，交给 Lead 做 PR 与最终 ready。
**涉及文件**：本计划对应的 `docs/exec-plan/active/2026-11-24-node-runtime-contract.md`（收尾提交写入）。
**步骤**：更新本计划的 `Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` 与 `Bottom Change Note`；整理为 2–3 个 Conventional Commits（计划/实现+文档/验证证据），删除临时调试与 fixup；不 push、不开 PR、不写 GitHub（由 Lead 执行）。

**Superseded（2026-11-25，见 D16–D17）**：本次由评审收尾会话接管 PR #687–#689；每 PR 收敛为一个可独立理解、验收、审阅和回滚的能力提交，包含其计划与评审证据。当前两文件文档 owner 不提交或 push，后续由收尾会话串行执行外部写入与合并。
**验证**：`git log --oneline eadf4901..HEAD` 只含计划内提交；`git diff --stat eadf4901...HEAD` 的文件清单与 `Global Constraints` 一致（不含 ci.yml、workflow、lockfile，docs/README.md 只含本计划索引行）；`git diff --check eadf4901...HEAD` 无输出。
**回滚**：本地未推送时 `git reset --keep eadf4901`；已推送时由 Lead 按 backup ref + `git revert` 处理，本 PR 无外部状态，整体 revert 即完全回滚。

## Validation and Acceptance

1. `pnpm install --frozen-lockfile` → 退出 0；`git diff --name-only eadf4901...HEAD` 不含 `pnpm-lock.yaml`。
2. `pnpm typecheck` → 退出 0、零输出（现有源码全部可擦除）。
3. `node --test tests/contract/runtime-support.test.js` → `ℹ tests 7 / ℹ pass 7 / ℹ fail 0`。
4. `pnpm test:contract` → 退出 0（现有 87 个契约文件 + 本文件），`ℹ fail 0`。
5. `pnpm run boundaries` → 退出 0（依赖边未变）。
6. `pnpm verify` → 退出 0（最宽一层，准备 ready 前跑一次）。
7. `node scripts/workflow-check.mjs` → `workflow-check: no findings（已检查 7 个文件）`。
8. `node scripts/rule-checks.mjs size eadf4901` → 代码 ≤300 行、文档 ≤1300 行（期望技术约 220–240、文档约 360–400）。
9. `node scripts/rule-checks.mjs disclosure eadf4901` → 无发布面命中；`git diff --check eadf4901...HEAD` 无输出。
10. 链接检查：`node -e '…' docs/development/runtime-support.md`（逐条解析相对链接并检查存在性）→ 输出 `links ok`，退出 0；`grep -n "runtime-support.md" docs/development/README.md docs/architecture/release-gates.md docs/product/vertical-path.md docs/adr/ADR-0009-harness-plugin-installable-artifact.md docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` → 5 行。
11. 单一 source 声明：`git grep -n '">=' -- '*.json'` → 只命中 `package.json:10`。
12. PR CI（Lead 执行并回读）：`gh pr checks <n> -R SingularityKChen/harness-projects` → 全部 pass（`PR Fast Gate` 必需）；`gh pr view <n> -R … --json headRefOid,baseRefName,closingIssuesReferences` → base 为 `main`，closing 含 313。

**AC 映射。** AC1（声明的 source 运行时能加载真实入口并跑基线命令、无未记录 flag）= 测试 1/3/6 + CI `verify` 的 `pnpm verify`；AC2（compiled plugin 兼容文档化 Host、类型天花板保持）= 不改 `HOST_*`/`@types/node` + 既有 `host-node-types.test.js` 与 artifact 测试 + 文档 host 行；AC3（非可擦除语法在运行前被抓）= 测试 4/5 + `pnpm typecheck` + M4 的运行时兜底证据；AC4（CI/文档精确说明实际验证的模式/版本）= `runtime-support.md` 模式表与未验证节 + 测试 2/7 + PR CI 回读。

**验收判定。** 只有 1–11 全部实际跑过且输出符合、12 在 PR 当前 head 上回读通过，才把本计划移入 `docs/exec-plan/completed/`；`docs/README.md` 的索引行由本 PR 自己维护（D11）。未跑或失败的项如实写进 `Progress` 与 PR 描述，不用「应该」补空。

## Progress

- [x] Batch 0 · 基线与隔离（2026-11-24）
- [x] Batch 1 · 契约测试与负控夹具（2026-11-24）
- [x] Batch 2 · 声明与编译期守卫（2026-11-24）
- [x] Batch 3 · 运行时支持文档与就地订正（2026-11-24）
- [x] Batch 4 · 全量验证与判别力变异（2026-11-24）
- [x] Batch 5 · 整理提交并交接 Lead（2026-11-24；rev-687 复评 PASS，归档完成）
- [x] 独立对抗验收（rev-687 首审 APPROVE WITH NOTES；修复后复评 PASS，2026-11-24）
- [x] 归档（2026-11-24：移入 `docs/exec-plan/completed/`，`docs/README.md` 换成 Completed 行，见 D15）
- [ ] PR CI 最终 head 回读与 ready（由 Lead 执行）
- [x] 2026-11-25 当前 head 独立 MMP 复审与工程门验证；评审账号 APPROVED（review `6050221555`），详见 `docs/review/pr-687-mmp-review.md` §9–§10。
- [x] 2026-11-25 用户指定本评审会话负责 #687–#689 后续；授权、单能力提交和恢复/发布顺序录入 D16–D17，计划保持 Completed。
- [ ] D17 收尾：建立恢复点、整合/逐真实 main 更新、当前门禁与远端回读、核对 #313 验收、条件 rebase merge、授权范围内清理。

每完成一批，在该行未完成标记后追加该批完成日期（例如 `（2026-11-24）`）。

## Surprises & Discoveries

- **S1 实际是 24 个 exports 入口，不是 18。** 18 个包共 24 个 exports 子路径；裸包名 import 实测 24/24 成功、约 230ms（Node v26.13.1，`main@eadf4901` 检出）。设计 B 的 S1 按「一包一入口」写，按原文实现会漏测 6 个子路径。
- **S2 `>=26.0.0` 允许 Node 27。** 设计 A 的「进程 major == 声明 major」会把 Node 27 判红；改用逐段 `>=`。
- **S3 负控夹具必须在仓内。** `/tmp` 下探针因缺 `type: module` 报 TS1287、因 typeRoots 解析不到报 TS2688；仓内 `tests/fixtures/…` 继承根 `type: module` 后可稳定得到 3 条 TS1294（本机以等价布局实测：无 flag 退出 0，加 flag 退出 2、3 条 TS1294）。
- **S4 tsc 的错误输出在 stdout。** 测试必须合并 stdout/stderr 再扫描错误码，否则“所有错误码都是 1294”的断言会空转。
- **S5 本机安装的 Desktop 是 0.2.2-rc.5 / Node 24.21.0**（`Contents/Resources/runtime/versions.json` 实测），不是声明的验收宿主 0.2.0-rc.2 / 24.18.1。本 PR 不据此升级 Host 声明，也不把它写成文档事实；真机执行仍属人工验收。
- **S6 第三处现时句在活跃 ExecPlan 里。** `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md:533` 仍写「开发入口为仓库根目录的 Node ≥ 22（本轮观察 v26.10.0）」，两份设计均未列出；按 PLANS.md §4「被推翻的结论就地标注」处理。
- **S7 仓库无 `.npmrc`。** 收紧 engines 只产生 pnpm 警告，不阻断安装；锁文件不记录根 engines，因此本 PR 不应出现 lockfile diff。
- **S8 两个契约外 Node 执行确实存在。** `issue-policy.yml` 与 `github-review.yml` 不读 `.nvmrc`，只跑内建模块脚本；文档登记为未验证，测试不把它们当成工作区运行时证据。
- **S9 `docs/README.md` 是并行冲突点。** #679 的计划归档也要改该文件的 Completed 表；Lead 裁决 D11 把本 PR 的索引维护限定为只加本计划自己的一行，以缩小同文件冲突面。
- **S10 契约测试落到 250 行，高于预估 190–210。** 7 条测试加上共享 helper 与逐值失败消息后收敛到 250 行；不拆文件，因为同一份运行时契约的分裂会重演设计 B 的重复事实源；技术总量（测试 250 + 夹具 22 + 配置约 5）仍低于 300 上限。
- **S12 文档表与配置的耦合是双向的。** 变异 M1（engines 回 `>=22.0.0`）与 M2（`.nvmrc` 改 24）除测试 1 红外还连带文档测试 7 红，说明只改声明不改文档会被抓住；代价是配置与文档必须同批才绿，这正是设计要的绑定。
- **S14 文档绑定的整行包含判断会被同行其他值蒙混（评审 rev-687 P2-1）。** 原实现用 `row.includes(value)`：把文档 source 行的 `.nvmrc` 从 26 改成 24/27 时仍全绿，因为同行的 `engines.node` 值 `>=26.0.0` 已经包含 "26"；已改为解析「版本事实」单元格的 `标签` = `值` 并逐项等值断言，评审 M7 的两个变体现在都会红。
- **S13 `npx -y node@24.18.1` 可以直接跑本契约。** M8 表征在 Node 24.18.1 上恰好 6 pass / 1 fail，唯一红项是测试 3（低于声明下界），失败消息打印真实进程版本，证明下界判定按运行时生效而不是只比字面量。
- **S11 负控夹具恰好只产生 3 条 TS1294、零其他错误码。** tsc 5.9.3 下 `node_modules/typescript/bin/tsc --noEmit -p tests/fixtures/node-runtime/negative-erasable/tsconfig.json --erasableSyntaxOnly` 输出 3 条 `probe.ts(4,13)/(8,18)/(13,15): error TS1294`、退出 2；不加 flag 同一夹具退出 0。仓内夹具避开 `/tmp` 的 TS1287/TS2688 假失败。

## Decision Log

- **2026-11-24 / Lead+rx · D1 source 声明收窄为 `>=26.0.0`。** Rationale：`.nvmrc` 26 是唯一 CI 实跑行；22/24 source 无消费者、无 CI 证据；扩宽必须先有 CI lane。这是 Lead 裁决，本计划不改 Host 常量、`@types/node` 与既有 Host 契约。
- **2026-11-24 / Lead+rx · D2 `erasableSyntaxOnly: true` 作为 AC3 守卫。** Rationale：现有 206 个源文件已通过该 flag（本机复核退出 0），零产品代码改动；编译期先于运行时拦截。
- **2026-11-24 / Lead+rx · D3 契约测试合并为一个文件、7 条。** Rationale：一个文件减少重复的 preflight/root/helper；三条 Lead 指定的测试族（绑定、smoke、负控）各有可失败断言，保留 A 的文档绑定与 B 的 TS API/仓内夹具。
- **2026-11-24 / Lead+rx · D4 smoke 覆盖全部 24 个 exports 子路径（真实裸包名 import）。** Rationale：AC1 说「actual package entrypoints」，exports map 的全部子路径都是实际入口；实测 24/24 可加载，且比文件 URL 更接近调用方。
- **2026-11-24 / Lead+rx · D5 负控用仓内夹具并由行为测试证明有牙。** Rationale：避免临时目录的 TS1287/TS2688 假失败；断言所有错误码都是 1294，封堵配置错误造成的假绿。
- **2026-11-24 / Lead+rx · D6 不新增 CI lane、不改任何 workflow。** Rationale：`ci.yml` 归 #679；新契约测试自动进入既有 contract 层（`run-test-layer.mjs` 按 `*.test.js` 发现），无需接线。
- **2026-11-24 / Lead+rx · D7 不写 `docs/README.md`，索引行交 Lead 串行维护。** Rationale：与 #679 同文件；PLANS.md §2 的索引义务由 Lead 在验收时补一行，写入本计划与 PR 描述。**Superseded（2026-11-24，Lead 裁决，见 D11）**：索引行改由本 PR 自己维护。
- **2026-11-24 / Lead+rx · D8 ADR-0009 加 1 行带日期注记，不改状态、不改历史理由。** Rationale：Lead 裁决；#666 的文件集不含 ADR-0009，文件级不冲突。文件仍在 `docs/adr/`；目录归属已由 Lead 裁决确认（D13）。
- **2026-11-24 / Lead+rx · D9 第三处现时句就地标注。** Rationale：PLANS.md §4 要求推翻的结论在原处标注；该句在活跃计划中仍以现在时陈述旧下界。Lead 裁决确认纳入本 PR（D14）。
- **2026-11-24 / Lead+rx · D10 技术规模预估约 220–240，低于 235 目标下沿。** Rationale：不为凑预算加入非判别性断言；若要更强的 AC4 机械性，可选设计 B 的 workflow 例外登记（+约 25 行），但会新增第二份事实源（D12）。
- **2026-11-24 / Lead · D11 `docs/README.md` 由本 PR 维护自己的索引行。** Rationale：草稿原「不写该文件、索引行交 Lead 串行维护」作废（D7 已就地标注 superseded）；本 PR 只加本计划自己的 Active 行，归档批次换成自己的 Completed 行，不改其他行，以最小化与 #679 的同文件冲突。
- **2026-11-24 / Lead · D12 接受技术约 220–240，低于 235 下沿，不凑数。** Rationale：不为达标加入非判别性断言或第二份事实源；size 以 `node scripts/rule-checks.mjs size eadf4901` 的实际输出为准，硬上限 300。
- **2026-11-24 / Lead · D13 ADR-0009 加 1 行带日期 superseded 注记。** Rationale：不改 ADR 状态与历史理由；`docs/adr/` 目录名义归 #666，但文件级不重叠，已在批准时确认。
- **2026-11-24 / Lead · D14 第三处「Node ≥22」现时句纳入本 PR。** Rationale：活跃计划里的现时句与 PLANS.md §4「被推翻的结论就地标注」冲突；就地追加带日期注记，不删除原文。
- **2026-11-24 / Lead+impl · D15 归档：计划移入 `docs/exec-plan/completed/`，索引换 Completed 行。** Rationale：rev-687 首审 APPROVE WITH NOTES、修复后复评 PASS，无阻塞；按 PLANS.md §2 与 D11 执行归档，文件名不变，`docs/README.md` 只动本计划两行（移除 Active 行、Completed 表加一行）。ready 与合并仍由人类伙伴/Lead 执行，本 PR 不置 ready、不改 PR/issue/Project。
  **Superseded（2026-11-25，见 D16）**：只对 PR #687–#689，本评审会话获得后续 issue 验收核对、条件合并及清理授权；Planning Status 和 R1 人类接受不在授权扩展内。
- **2026-11-25 / 用户直接授权 · D16 本评审会话负责 PR #687–#689 后续。** 用户原话：「你负责后续：三思后修复，但禁止 adhoc 式修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并」「清理本地和远端相关 branch、worktree 和评审过程中产生的测试文件和中间结果」。据此，本会话接管三条 PR 的收尾；只在无 P0/P1、必要修复已独立复评且当前门禁通过时串行 rebase merge；不改 Planning Status，不扩大产品范围，不以工程批准代替 R1。#687 当前复审无新发现，详细证据引用评审记录 §9，保持既有归档状态。
- **2026-11-25 / 收尾决策 · D17 单能力提交、恢复点与当前版本门。** 三条 PR 各整合为一个 Conventional Commit；#687 保留一个运行时契约能力闭环及 `Closes #313`。任何历史整理/发布前，先建立并核对 `refs/backup/pr687-before-mmp-review-20261125`（原已推 head `eac0cdfb`）和 `refs/backup/pr687-final-tree-20261125`（含本轮文档的最终树恢复点），记录 object ID；恢复点未读回则不改写。使用 argv 执行 Git，仅对该远端分支使用携带刚回读旧 head 的精确 `--force-with-lease=<ref>:<oid>`；lease 不符先重查，不覆盖新远端工作。按每条 PR 实际轮到的真实 `main` 更新并检查内容/冲突，重跑受影响验证，最终 push 后回读远端 head/base/checks、issue 关联和全部 review threads，再确认 APPROVE 与 ready；前一 PR 合并不替后一 PR 的当前 base 证明。合并仅用 rebase，随后回读 merge commit、main 和 #313 关闭结果。清理只覆盖 D16 授权的相关分支/worktree/测试中间结果，先核对真实路径与恢复点；这些步骤当前仍待收尾会话执行，不写成已完成。

## Idempotence and Recovery

- Batch 0 与全部验证命令只读，可重复执行；测试与 tsc 不写仓库、不联网、不读凭据。
- Batch 1–3 的写入可用 `git checkout -- <file>` 与删除新文件复原；回滚必须与测试同批（例如只回滚 engines 而留下测试 1 会让契约红），不能只回退配置。
- Batch 4 的每条变异前后都要求 `git diff` 非空/为空与 `git status --short` 干净；任何一条在还原后仍红，先修测试或配置，不带病进入下一批。
- 本地未推送时整体恢复锚点：`git reset --keep eadf4901`（先确认工作树无未跟踪文件）。已推送时由 Lead 建 backup ref 后用精确 force-with-lease 或 revert；本 PR 无 schema、无数据、无外部写入，整体 revert 即完全回滚。
- 2026-11-25 收尾恢复：D17 的 before ref 保留已推历史，final-tree ref 保留整理前完整交付树；每次整合/更新真实 main 后先比较目标树与恢复点的本 PR 内容。未合并时可从恢复点重建分支；合并后的能力回滚使用整条能力提交的 revert，不改写 main。清理前再次核对恢复点可达，保留恢复依据。
- 若 PR CI 在 hosted runner 上解析到非 26.x 或失败，先回读当前 head 的 job 日志与 `node --version` 行；本契约只固定 major，不因 patch 差异改声明。

## Interfaces and Dependencies

- **工具链**：Node v26.13.1（本地）、pnpm 10.28.2、TypeScript 5.9.3、`yaml`、`node:test`；不新增依赖，不联网。
- **CI**：GitHub Actions，`.nvmrc` = 26；`Verify`/`Browser`/`Windows Native` 三条 lane 与 `PR Fast Gate` 聚合；本 PR 不改 workflow，新测试随既有 contract 层进入 `Verify`；Windows lane 不跑 `tests/contract/`。
- **文件 owner**：`ci.yml`、`docs/development/ci.md` 归 #679 owner；`docs/adr/` 归 #666 owner（文件级不重叠）；`docs/README.md` 只由本 PR 维护本计划自己的索引行（D11）；本计划涉及的其他文件归 #313。
- **命名契约**：`engines.node` 唯一合法形状 `>=M.0.0`，`M` 等于 `.nvmrc` 的 major；`.nvmrc` 允许 major 或 major.minor[.patch]；workspace 包入口必须是 `exports -> ./src/*.ts(x)`。
- **产出路径**：实现 PR 内计划 `docs/exec-plan/active/2026-11-24-node-runtime-contract.md`（验收后移 `completed/`）；PR 描述含 `Closes #313`、Batch 摘要、验证证据、风险与回滚；评审记录由独立评审者写 `docs/review/pr-<n>-mmp-review.md`，不在本实现写入边界内。
- **分支/工作树**：`chore/node-runtime-contract-20261124` @ `.worktrees/iteration12-node-runtime-contract`，base `main@eadf4901`；提交格式 `<type>(<scope>): <中文摘要>` + 正文 + `Closes #313`。

## Outcomes & Retrospective

执行结果（2026-11-24，检出 `chore/node-runtime-contract-20261124`，base `main@eadf4901`；命令均在工作树根目录实际运行）：

- Batch 0：HEAD 只比 base 多计划提交；`node -e` 输出 `v26.13.1 strip`；`tsc --noEmit -p tsconfig.json --erasableSyntaxOnly` 退出 0。
- Batch 1（RED）：`node --test tests/contract/runtime-support.test.js` → `ℹ tests 7 / ℹ pass 3 / ℹ fail 4`，红项恰为 1（engines 22≠26）、4（erasableSyntaxOnly 为 undefined）、5（夹具无 flag 编译通过）、7（文档不存在），与计划逐项一致。
- Batch 2：同一命令 → 6 pass / 1 fail（仅剩文档项）；`pnpm typecheck` 退出 0。
- Batch 3：同一命令 → `ℹ tests 7 / ℹ fail 0`；五个文件指针回读 5 行；新文档两条相对链接均存在。
- Batch 4：`pnpm install --frozen-lockfile` 退出 0；`pnpm typecheck` 退出 0；`pnpm test:contract` 1632/1632；`pnpm run boundaries` 10/10；`node scripts/workflow-check.mjs` 输出 `no findings（已检查 7 个文件）`；`pnpm verify` 退出 0（contract 1632、integration 2394 条中 2366 执行、28 skipped、e2e 226/226）；`node scripts/rule-checks.mjs size eadf4901` → 代码 278、文档 386（Batch 4 当时值；评审记录与评审修复后（`25e42051`）为代码 284、文档 486，其中 `docs/review/pr-687-mmp-review.md` 属评审记录）；disclosure 通过；`git diff --check eadf4901...HEAD` 无输出；`git grep -n '">=' -- '*.json'` 只命中 `package.json:10`。
- 归档终值（2026-11-24，归档提交后实测）：代码 284、文档 500；文档桶含 rev-687 首审记录与修复复评追加（`docs/review/pr-687-mmp-review.md`）。size 是易失值：合并前以 `node scripts/rule-checks.mjs size eadf4901` 回读为准——复评追加已使文档桶从 486 增至 499，本归档提交后继续增加；阈值结论（< 1500）不受影响。
- 变异矩阵（每条先确认 `git diff` 非空，红在指定断言，`git checkout --` 还原后复跑 7/7）：M1 engines 改回 `>=22.0.0` → 测试 1 红（并连带测试 7）；M2 `.nvmrc` 改 24 → 测试 1 红（并连带测试 7）；M3 删 `erasableSyntaxOnly` → 测试 4、5 红；M4 `packages/domain/src/index.ts` 加 `export enum` → `pnpm typecheck` 报 TS1294、smoke 报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`；M5 workflow setup-node 加内联 `node-version: 24` → 测试 2 红；M6 文档 source 行改 `>=25.0.0` → 测试 7 红；M7 夹具 `extends` 改缺失文件 → 测试 5 红且错误码不是 TS1294；M8 `npx -y node@24.18.1 --test tests/contract/runtime-support.test.js` → 6 pass / 1 fail，唯一红项是测试 3，失败消息打印 `Node 24.18.1 低于声明下界 >=26.0.0`。

与计划的偏差：契约测试实际 250 行（预估 190–210），技术总量 284（本实现 278 + 评审修复 6；预估 220–240，Lead D12 已接受低于 235 下沿、不凑数）；其余文件集合、批次顺序与验证命令与计划一致，未新增 workflow、依赖或锁文件 diff。S10–S13 记录了两处与预期不同的事实。

遗留项与承接：Node 22/24 的 source 模式仍不受支持（无 CI lane，M8 只作表征）；Desktop Node 24.18.1 的真机执行与 R1 属人工验收；PR CI（`Verify`/`Browser`/`Windows Native`/`PR Fast Gate`）与 ready/合并由 Lead 在最终 push 后统一执行；本计划已按 D15 归档到 `docs/exec-plan/completed/`，`docs/README.md` 的 Active→Completed 索引行同批完成（D11）。契约只绑定 `actions/setup-node` 步骤、不扫描「没有 setup-node 却执行 node」的新 workflow（评审 P3-③ 记录不修，残余风险与理由见 `docs/development/runtime-support.md` §7）。

2026-11-25 收尾准备：当前 `eac0cdfb` 的独立 MMP 复审无新增 P0–P3，评审账号 APPROVED；完整 `pnpm verify` 为 4224 pass、28 个 Windows 原生项 skip、0 fail，边界与限制见 `docs/review/pr-687-mmp-review.md` §9。D16–D17 记录用户授权和每 PR 一个能力提交的处理顺序；本轮只补计划/评审文档，尚未建立恢复点、整合、push、勾选 issue、合并或清理，最终结果须据实际回读补记。

## Bottom Change Note

- 2026-11-24：创建 Draft。依据 Lead 裁决、issue #313/#678 与两份独立设计（`node-runtime-contract-a.md`/`b.md`）收敛；记录设计冲突、事实核对（24 exports、第三处现时句、本机 Desktop 版本）与待 Lead 确认项。
- 2026-11-24（Phase 1，Lead 批准执行）：状态改为 Active；删除仅评审用的附录章节；Lead 四项裁决（D11–D14）落进 Decision Log 并就地标注 D7 superseded；原文中的运行态设计输入路径引用改为「2026-11-24 独立设计评审与 Lead 裁决」；`docs/README.md` 索引行改由本 PR 维护。
- 2026-11-24（Batch 1–5 执行）：按批次完成契约测试与夹具（RED 3/4 → 6/1 → 7/0）、声明收窄与可擦除语法守卫、运行支持文档与四处就地注记、全量门禁与 M1–M8 变异矩阵；Progress 与 Outcomes 记录实际输出，S10–S13 记录与预估的偏差。
- 2026-11-24（评审修复 rev-687）：P2-1 把文档表绑定从整行包含改为「标签=值」精确解析并逐项等值断言（文档 `.nvmrc` 26→24/27 变异现在都会红）；P3-① 文档行数按实测订正；P3-② `Verify` lane 订正为 `pnpm typecheck` + `pnpm test` 两步；P3-③ 残余风险记录在 `runtime-support.md` §7 与 Outcomes，不扩大测试。
- 2026-11-24（Batch 5 归档）：状态改 Completed（rev-687 复评 PASS）；计划移入 `docs/exec-plan/completed/`，`docs/README.md` Active 行换成 Completed 行；Progress 清理前几批编辑叠加造成的重复未勾选行，并记录复评与归档结论；Outcomes 回填归档时 size 终值与「以合并前回读为准」的易失值判据；Decision Log 加 D15。
- 2026-11-25（本轮授权与收尾准备）：保持 Completed；追加 D16 用户对 #687–#689 的原话授权与 D17 单能力提交/恢复点/精确 lease/逐真实 main/最终回读策略，旧不合并和仅交接条款就地标为 Superseded；Progress/Outcomes 引用当前独立复审，执行结果仍待收尾会话回填。
