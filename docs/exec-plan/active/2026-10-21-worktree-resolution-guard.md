# 裸包名解析不逃出当前检出的守卫 ExecPlan

> 状态：Active
> 创建：2026-10-21
> 范围：完成 issue #186：裸包名 `@harness-projects/*` 解析到当前检出根目录之外时，测试入口机械失败；`tests/README.md` 的手工两步改为机械检查。只动测试基础设施（`scripts/`、`tests/`、根 `package.json` 的 `scripts` 块），不动产品包。
> 上游输入：issue #186、`AGENTS.md` §6 / §9、`tests/README.md`、`docs/development/content-placement.md` §2 第 1 桶、`tests/contract/package-boundaries.test.js`、`scripts/run-test-layer.mjs`。
> 执行上下文：分支 `test/worktree-resolution-guard`，工作树 `.worktrees/worktree-resolution-guard`，base `origin/main`（设计时观察到 `3391c01d`，2026-10-21 15:05 +08；回读 `git rev-parse --short origin/main`）。

## Purpose / Big Picture

完成后，一个没装依赖、嵌在主检出 `.worktrees/` 下的新检出里，`pnpm test`、`pnpm test:contract`、`pnpm test:mvp0`、`pnpm run boundaries` 与新增的单文件入口 `pnpm test:file <path>` 都在跑任何用例之前退出 1，逐包列出 `name -> 实际落点` 并给出 `pnpm install --frozen-lockfile`；直接 `node --test tests/contract` 时由契约用例在进程内判红。已安装的检出与 CI 单检出静默通过，无任何环境分支。

最小成功证据：scratch 嵌套复制树里 `pnpm run test:file tests/contract/domain-enums.test.js` 退出 1 且输出没有 `ℹ tests`；同一命令在已安装检出里 `ℹ pass 6`；变异表 M1–M13 全部 KILLED 且归因到指定用例。

## Context and Orientation

- 现象（issue #186）：Node 的裸包名查找从调用方目录逐级向上找 `node_modules`（https://nodejs.org/api/modules.html#loading-from-node_modules-folders）。检出位于 `<主检出>/.worktrees/<slug>/`，自身没有 `node_modules` 时命中主检出的 `node_modules`，测试跑的是主检出的代码。
- 复现（独立评审者，2026-10-21 15:05 +08，`origin/main` = `3391c01d` 的 `git archive` 复制树：外层装好依赖，内层 `<外层>/.worktrees/bare` 未装）：内层 `createRequire(...).resolve('@harness-projects/core')` 与 `import.meta.resolve` 都返回外层 `packages/core/src/index.ts`；`node --test tests/contract/domain-enums.test.js` 得 `ℹ pass 6`，是对外层代码的假绿。
- 现状：`tests/README.md`「运行方式」下写着手工两步（`pnpm install --frozen-lockfile`、`ls -l node_modules/@harness-projects/core`）和「这条没有机械守卫」。根 `package.json` 的 `test`、`test:contract`、`test:mvp0`、`boundaries` 直接 `node --test`；`verify` = `typecheck && test && test:mvp0`。`.github/workflows/ci.yml` 跑 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`；Merge Gate 四条 lane 经 `scripts/run-test-layer.mjs` 直接跑，都是单检出。
- 名单：根 `package.json` 的 `devDependencies` 声明 18 个 `@harness-projects/*`（`workspace:*`）；`package-boundaries.test.js`「根 manifest 声明全部工作区包」保证 `EXPECTED` 的每个包都在其中（单向包含，不是相等）。所有包的 `exports["."]` 是无条件字符串（`./src/index.ts`）。`tests/` 下没有 `node_modules`，所以从根解析与从任一测试文件解析结果相同。
- 只需查根：包间依赖从 `packages/<x>/node_modules` 找不到时也先落到根 `node_modules`；根装好则全在检出内，根缺失则根级检查已报出。

## Design / Spec

**方案**：一个零依赖脚本 `scripts/resolution-check.mjs`，既导出纯函数又是 CLI；pnpm 测试脚本以 `node scripts/resolution-check.mjs && ` 前置它（快速失败）；契约测试在进程内再查一次真实检出（覆盖直接 `node --test` 目录的运行）并用夹具钉住语义与接线。

- `findStrayResolutions(root)`：`realRoot = realpathSync(root)`；读 `<realRoot>/package.json` 的 `devDependencies` 里以 `@harness-projects/` 开头的名字，空集抛错（fail closed）；对每个名字 `createRequire(<realRoot>/package.json).resolve(name)` 后再 `realpathSync`，不以 `realRoot + path.sep` 开头记 `{ name, resolved, reason: 'outside-root' }`；解析抛错记 `{ name, resolved: null, reason: error.code }`，不外抛，一次列全。返回数组，空即通过。
- CLI：根取自脚本自身位置（`realpath(scripts/..)`），与 cwd 无关；有越界时 stderr 打一行结论（含根目录、「这次运行的红/绿都不是本检出的证据」）、逐包 `  <name> -> <落点或错误码>`、一行修复命令 `pnpm install --frozen-lockfile`，`exit 1`；否则静默 `exit 0`。只 import `node:` 内建模块，依赖缺失时自己不会先崩。入口判定沿用 `scripts/run-test-layer.mjs` 的 `invokedDirectly()`（realpath 比较）。
- 接线：`test`、`test:contract`、`test:mvp0`、`boundaries` 前置守卫；新增 `test:file` = `node scripts/resolution-check.mjs && node --test --test-timeout=120000`。pnpm 把参数追加到脚本串末尾，`&&` 之后的 `node --test` 收到路径（pnpm 10.28.2 实测）。`verify` 不改：完全未装时它先在 `typecheck` 处失败（`sh: tsc: command not found`），部分安装时由 `test` 的前置拦住。
- 关键不变量：检查只读、无状态；判据只有「realpath 后的落点在 realpath 后的根内」，与逃逸机制（祖先 `node_modules`、`NODE_PATH`、`$HOME/.node_modules`、软链）无关。
- 已知边界：只查 `@harness-projects/*`（issue 范围），第三方依赖在「根已装但锁文件已变」时仍可能向上解析，修复命令相同；`node-linker=hoisted` 或注入式工作区包会把包拷进检出，前缀判定看不出，本仓库未启用。直接 `node --test <file>` 无守卫（见 TD-088）。

**评审取舍**（对两份独立设计；详细依据见 Decision Log）：

| 来源 | 采纳 | 否决 |
|---|---|---|
| 设计 1（契约测试） | 进程内真实检出断言；名单取根 manifest；夹具用不存在的包名 `@harness-projects/foo`；不并入 `package-boundaries.test.js` | 只靠契约测试（`test:mvp0` 单跑与单文件运行不受保护，失败夹在其他红里）；接受 M3 存活；README 换成另一条手工前置命令 |
| 设计 2（前置守卫） | 脚本前置快速失败；单文件入口；`NODE_PRESERVE_SYMLINKS=1` 杀死「去掉结果 realpath」；兄弟目录前缀、根别名、空集抛错、cwd 无关 | `--import` 预加载与嵌套 `node --test` 用例（`&&` 已够）；库与入口拆两个文件；`check:worktree` 别名与改 `verify`；钉 README 文本；读 `dependencies`（根没有） |

## Global Constraints

- 本 PR 改动的文件集合（唯一声明处）：新增 `scripts/resolution-check.mjs`、`tests/contract/resolution-check.test.js`、本计划（归档时移到 `docs/exec-plan/completed/`）；改 `package.json`（仅 `scripts` 块）、`tests/README.md`（「运行方式」命令块与「必须先安装依赖」段）；收尾在 `docs/exec-plan/tech-debt-tracker.md` 末尾追加 TD-088 一行。
- 不改：`docs/README.md`（索引行由协调者统一加）；tracker 的任何既有行（尤其 TD-054）；`AGENTS.md`；`.github/workflows/**`；`scripts/run-test-layer.mjs`；`tests/contract/package-boundaries.test.js`；`tests/mvp0/README.md`；`packages/**`、`apps/**`、`docs/adr/**`、`docs/product/vertical-path.md`、`tests/integration/harness-plugin-artifact.test.js`（在途 #371、#372、#373 与已合并 #370 的文件都在这几处之内）。
- 技术债号段只用 TD-088–TD-089；TD-089 预留未用。
- 体量：预计实现约 60 行、测试约 110 行、`package.json` +5/−4，文档约 240 行（本计划约 220 + README ±15 + tracker 1）；上限代码 800、文档 1300（CI 硬上限 1000 / 1500）。
- 守卫与测试不 import 工作区包和第三方包；不读 pnpm 状态文件（`node_modules/.modules.yaml`、`.pnpm`）；无环境变量分支。Node `>=22`（`engines`），实测 26.11.1（`.nvmrc`）。
- 先写会失败的用例再实现；变异用 `scripts/review-mutate.mjs`（锚点恰好一次、按字节还原、`killedBy` 归因）。不写 git config；身份用 `git -c` 单次传入。提交正文只写 `Refs #186`，关闭关系只由 PR 正文承载并回读 `closingIssuesReferences`。看板 Status 与 blocked-by 由人类决定，agent 不写。

## Plan of Work

所有命令在检出 `test/worktree-resolution-guard` 的工作树根目录运行，`gh` 一律带 `-R SingularityKChen/harness-projects`。scratch 树指：`git archive HEAD` 解到 `<scratch>/outer` 后 `pnpm install --frozen-lockfile --offline`（失败去掉 `--offline`），再 `git archive HEAD` 解到 `<scratch>/outer/.worktrees/bare` 且不安装；`<scratch>` 是实施者自己的唯一临时目录，不写进仓库文件。

### Batch 1 · 对齐与计划入库

**最小闭环**：分支对齐 `origin/main`，本计划入库，draft PR 关联 #186。**涉及文件**：本计划。
- [ ] `git merge --ff-only origin/main`（分支无自有提交），回读 `git rev-list --count HEAD..origin/main`（期望 `0`）。
- [ ] 提交 `docs(exec-plan): 规划裸包名解析不逃出检出的守卫`；push；开 draft PR，标题 `test(tests): guard against bare package names resolving outside the worktree`，正文以关闭关键字关联 #186；标签 `kind:test`、`area:tests`、`area:development`；milestone 与 #186 相同（`gh issue view 186 -R SingularityKChen/harness-projects --json milestone`）；assignee `SingularityKChen`。
**验证**：`node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js`（期望 `ℹ fail 0`）；`node scripts/rule-checks.mjs disclosure origin/main`（期望通过）；`gh pr view <n> -R SingularityKChen/harness-projects --json closingIssuesReferences`（期望含 186；刚开时可能为空，改一次正文后再读）与 `gh issue view 186 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences`（期望含 `<n>`）。
**回滚**：关闭 draft PR，`git reset --hard origin/main`（仅本地未推送时）。

### Batch 2 · 判定函数、CLI 与语义用例

**最小闭环**：守卫能判定并报告越界；契约测试在进程内判红未装的检出。**涉及文件**：`scripts/resolution-check.mjs`、`tests/contract/resolution-check.test.js`。
- [ ] 先写 7 条用例（名字逐字如下，每条用新的 `mkdtemp` 根，避免 `require.resolve` 的进程内缓存），并把脚本写成只有 `export function findStrayResolutions() { return []; }` 的桩：
  1. `解析：本检出的 @harness-projects/* 全部解析在本检出之内（AGENTS.md §6 隔离工作区的证据前提）`
  2. `越界：嵌在已安装检出下、自身未安装时，裸包名落到外层并被报出`（期望落点 = 外层 realpath 的 `packages/foo/index.js`）
  3. `不误报：已安装的检出无越界，经符号链接别名传入根目录也一样`
  4. `越界：落点在同名前缀的兄弟目录（repo 与 repo-old）也算根外`
  5. `失败闭合：哪里都解析不到时记下错误码，不抛、不当作通过`（期望 `reason: 'MODULE_NOT_FOUND'`）
  6. `失败闭合：根 manifest 没有任何 @harness-projects/* 时抛错，不空转通过`
  7. `CLI：根取自脚本位置而非 cwd；越界时退出 1 并给出落点与修复命令，即使 --preserve-symlinks`（把脚本拷进夹具 `wt/scripts/`，`wt/node_modules` 软链到外层，cwd = 外层，`NODE_PRESERVE_SYMLINKS=1`；再换成真实安装，期望 `status 0` 且 stderr 为空）
- [ ] 跑 `node --test tests/contract/resolution-check.test.js`，期望 `ℹ tests 7`、`ℹ fail 5`（2、4、5、6、7 为断言失败而非 import 错误；1、3 空真通过）。
- [ ] 实现函数与 CLI，期望 `ℹ tests 7`、`ℹ pass 7`；`node scripts/resolution-check.mjs; echo $?` 无输出且 `0`。
- [ ] 在 scratch 内层树：`node --test tests/contract/resolution-check.test.js` 期望 `ℹ fail 1`（用例 1，列 18 个包）；`node scripts/resolution-check.mjs` 退出 1。
**验证**：上两条，加 `pnpm run boundaries`（期望 `ℹ fail 0`）。**回滚**：`git revert` 本批提交（只删两个新文件）。

### Batch 3 · 接线、单文件入口与 README

**最小闭环**：所有 pnpm 测试入口在跑用例前失败；README 的手工两步换成机械检查。**涉及文件**：`package.json`、`tests/README.md`、测试文件。
- [ ] 加用例 8 `接线：每个跑 node --test 的 pnpm 脚本都先跑守卫，且有单文件入口 test:file`（遍历 `scripts` 中含 `node --test` 的项，断言以 `node scripts/resolution-check.mjs && ` 开头），期望先红：`ℹ fail 1`，信息含 `test:file`。
- [ ] 改 `package.json` 的 `scripts`（见 Design 接线），期望 `ℹ tests 8`、`ℹ pass 8`。
- [ ] 改 `tests/README.md`：命令块加 `pnpm test:file <path>   # 单文件，先查解析落点`；把「必须先安装依赖」段与两步命令块、「这条没有机械守卫」改为：守卫做什么、哪些入口自动先跑它、失败时执行 `pnpm install --frozen-lockfile`、单独检查用 `node scripts/resolution-check.mjs`、直接 `node --test <file>` 不受保护（TD-088）所以取红基线用 `pnpm test:file`。
**验证**：已安装检出 `pnpm run test:file tests/contract/domain-enums.test.js` 期望 `ℹ pass 6`；scratch 内层树（复制本批 `package.json` 与脚本后）`pnpm run test:file tests/contract/domain-enums.test.js` 与 `pnpm run test:mvp0` 都退出 1、输出含 `resolution-check:` 且没有 `ℹ tests`。**回滚**：`git revert` 本批提交，守卫文件保留无害。

### Batch 4 · 独立对抗验收、全量验证与收尾

**最小闭环**：变异全杀、全量绿、提交整合、计划归档、PR ready。**涉及文件**：本计划、`docs/exec-plan/tech-debt-tracker.md`。
- [ ] 变异 spec 写在 `.superpowers/review/pr186-mutants.json`（不入库），命令 `["node","--test","tests/contract/resolution-check.test.js"]`，逐条见 Validation 表；`node scripts/review-mutate.mjs .superpowers/review/pr186-mutants.json`，期望退出 0、13 个 KILLED、无 KILLED_OTHER / NOT_APPLIED。
- [ ] `pnpm verify`、`pnpm run boundaries`（期望全绿，主套件用例数 = base + 8）；`node scripts/rule-checks.mjs size origin/main` 与 `disclosure origin/main`（期望通过）；`git diff --check origin/main...HEAD`（期望无输出）。
- [ ] tracker 末尾追加 TD-088；回填本计划，移到 `docs/exec-plan/completed/`。
- [ ] 整合为三个提交：`docs(exec-plan)` 计划、`test(tests)` 交付物（脚本 + 测试 + `package.json` + README）、`docs(exec-plan)` 回填归档与 TD-088；改写前建 backup ref，改写后 `comm` 比对新旧 head 的文件集合，`git log origin/main..HEAD --format=%B | grep '^#'` 为空。
- [ ] 精确 force-with-lease 推送后回读 `gh pr checks <n> -R SingularityKChen/harness-projects`（期望全部 pass，其中 `ci.yml` 的 Verify 在单检出里跑过前置守卫）、head、base、关联；`gh pr ready <n>`，请求人类评审。
**回滚**：backup ref 恢复；已合并则 `git revert` 交付提交。

## Validation and Acceptance

| # | 验收项（issue #186） | 判定证据 |
|---|---|---|
| 1 | 裸 `@harness-projects/*` 解析到检出根之外必须失败 | 用例 2、4、7；scratch 内层树里用例 1 红、`pnpm run test:file …` 与 `pnpm run test:mvp0` 退出 1；变异 M1（去 `path.sep`→用例 4）、M2（去结果 realpath→用例 7）、M5（根取 cwd→7）、M6（不 exit 1→7）、M13（越界判定恒假→2、4、7） |
| 2 | CI 单检出无需特判即通过 | 脚本无环境分支（`grep -n "process.env" scripts/resolution-check.mjs` 无输出）；用例 1、3 在已安装检出绿；PR 的 `ci.yml` Verify 经 `pnpm test` 跑前置守卫且 pass；变异 M3（根不 realpath→用例 3） |
| 3 | 不依赖 pnpm 内部 | `grep -n "^import" scripts/resolution-check.mjs` 只有 `node:` 模块；不读 `.modules.yaml` / `.pnpm` |
| 4 | README 手工两步变机械检查 | README 不再含 `ls -l node_modules`；用例 8；变异 M9（`test:mvp0` 去前置→8）、M10（删 `test:file`→8） |
| 5 | 失败闭合与信息可用 | 用例 5、6、7；变异 M4（吞解析失败→5）、M7（前缀写错→2 等）、M8（去空集抛错→6）、M11（去修复命令→7）、M12（去落点→7） |

## Progress

- [x] 2026-10-21 15:05 +08 独立评审两份设计；在 scratch 嵌套复制树复现假绿；原型（脚本 45 行、测试 94 行）在已装树 8/8 绿、在内层树用例 1 红，`review-mutate` 13/13 KILLED 且归因正确；定稿本计划。
- [ ] Batch 1 对齐与计划入库
- [ ] Batch 2 判定函数、CLI 与语义用例
- [ ] Batch 3 接线、单文件入口与 README
- [ ] Batch 4 独立对抗验收、全量验证与收尾

## Surprises & Discoveries

- 完全未装的检出里 `pnpm verify` 并不静默通过：`pnpm run typecheck` 输出 `sh: tsc: command not found` 与 pnpm 的 `node_modules missing` 警告后失败；issue 所说「verify 静默跑错代码」对应的是部分安装。`pnpm test` / `test:contract` / `test:mvp0` 则确实静默假绿。（scratch 内层树，2026-10-21 15:05 +08）
- Node 26.11.1 不自动加载 `node.config.json`，需 `--experimental-default-config-file`；仓库内没有无标志手段守住直接 `node --test <file>`。（`node --help | grep config-file` 与 scratch 实测）
- `NODE_PRESERVE_SYMLINKS=1` 下 `require.resolve` 返回软链路径：`wt/node_modules` 软链到外层时，去掉结果 realpath 的变异退出 0，原实现退出 1；默认标志下两者都退出 1。
- 设计输入的事实偏差：`package-boundaries.test.js` 对根 manifest 是单向包含而非相等；pnpm 当前文档写 `verifyDepsBeforeRun` 默认 `install`（https://pnpm.io/settings/build），钉定的 10.28.2 上 `pnpm config get verify-deps-before-run` 为 `undefined` 且未装时照常运行脚本。

## Decision Log

以下均为协调者授权的独立评审者按调研决定，人类可推翻。日期 2026-10-21，作者：独立评审者（Claude Opus）。

| 决策 | Rationale |
|---|---|
| D1 守卫放在 pnpm 测试脚本的 `&&` 前置步骤，契约测试另在进程内兜底 | 同类机制都选「运行前」作检查点：pnpm `verifyDepsBeforeRun` 在 `pnpm run` 前检查依赖状态，但它读 pnpm 自己的安装记录、默认值随版本变（违反 issue 约束）；`--test-global-setup` 自 v24.0.0、Stability 1.0（https://nodejs.org/api/test.html），低于 `engines >=22`；`pretest` 钩子受 `enablePrePostScripts` 配置左右（https://pnpm.io/settings/other）且每个 `test:*` 要各写一个；`node.config.json` 需实验标志；pnpm 官方 worktree 指南只要求每个 worktree 各自安装、无守卫（https://pnpm.io/git-worktrees）。内联 `&&` 与包管理器无关、显式、可被契约测试钉住 |
| D2 单文件入口用 `test:file` = 守卫 `&&` `node --test`，不用 `--import` 预加载 | pnpm 把参数追加到脚本串末尾（10.28.2 实测 `pnpm run t a/b.test.js` 只交给最后一条命令）；`--import` 会在每个测试子进程各跑一次且需嵌套 `node --test` 用例验证，收益为零 |
| D3 不改 `verify`、不加 `check:*` 别名 | 未装时 `verify` 已在 `typecheck` 失败，部分安装时 `test` 前置拦住；单独检查直接写 `node scripts/resolution-check.mjs`，少一个同义名字 |
| D4 名单取根 `package.json` 的 `devDependencies` 前缀匹配，空集抛错；只解析 `.` 入口 | 与 `package-boundaries` 已核对的清单同源，不维护第二份；空集抛错防空真；子路径导出经同一软链目录，解析 `.` 已足够 |
| D5 `createRequire(<root>/package.json).resolve` + 两端 realpath + `realRoot + path.sep` 前缀 | `import.meta.resolve` 的 parent 参数需实验标志，无法以任意根为出发点做夹具；所有包是无条件 `exports`，CJS 与 ESM 解析一致；按路径段比较防 `repo`/`repo-old`；Node 模块文档列出的逃逸途径（祖先目录、`NODE_PATH`、`$HOME/.node_modules`）都被「realpath 落点在根内」一条判据覆盖（https://nodejs.org/api/modules.html） |
| D6 一个脚本文件（导出纯函数 + CLI），独立契约测试文件 | 只有一个调用方，拆库与入口无收益；不并入 366 行的 `package-boundaries.test.js`，其 Merge Gate lane 的不变量是「依赖方向」 |
| D7 直接 `node --test <file>` 的缺口登记 TD-088，不改约 90 个测试文件 | 无无标志机制（见 Surprises）；逐文件 import 守卫会与在途 PR 的测试文件冲突且新文件易漏；README 指向 `pnpm test:file` |

## Idempotence and Recovery

- 守卫只读、无副作用，任意次重跑结果只取决于当前 `node_modules`；scratch 树可随时删掉重建（`/bin/rm -rf <scratch>/outer` 后按 Plan of Work 开头重做）。
- 变异由 `scripts/review-mutate.mjs` 按字节还原；退出码 2 或 130 时结论作废，先 `git status --short` 确认工作树干净再重跑。
- 检出依赖坏了：`pnpm install --frozen-lockfile --offline`，失败去掉 `--offline`；再跑 `node scripts/resolution-check.mjs`（期望静默 `0`）。
- 改写历史前 `git branch backup/worktree-resolution-guard-<时间> HEAD`；出错 `git reset --hard <backup>`。

## Interfaces and Dependencies

- `findStrayResolutions(root: string): Array<{ name: string; resolved: string | null; reason: 'outside-root' | string }>`；根 manifest 不可读或无 `@harness-projects/*` 时抛错。
- CLI `node scripts/resolution-check.mjs`：退出 0 静默；退出 1 时 stderr 首行以 `resolution-check:` 开头，含 `<name> -> <落点或错误码>` 与 `pnpm install --frozen-lockfile`。
- 依赖：Node `>=22`、pnpm 10.28.2（`packageManager`）的参数追加行为、`gh` CLI（`-R SingularityKChen/harness-projects`）、`scripts/review-mutate.mjs`。无凭据、无网络。
- 技术债（收尾时追加，现不改 tracker）：TD-088 —— 直接 `node --test <file>` 不经守卫，仍可能对着主检出代码取红/绿；下一步：若 Node 让默认配置文件脱离实验标志，或仓库抬高 `engines` 到可用 `--test-global-setup` 的版本，再评估把守卫挂到无标志入口。

## Outcomes & Retrospective

实施尚未开始（2026-10-21 15:05 +08）。Batch 4 回填实际规模（`node scripts/rule-checks.mjs size origin/main`）、变异结果、与本计划的偏差和遗留问题。

## Bottom Change Note

- 2026-10-21 15:05 +08 独立评审者：嫁接两份独立设计并按复现与原型定稿首版。
