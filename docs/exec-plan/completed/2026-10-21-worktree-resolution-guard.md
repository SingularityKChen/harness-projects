# 裸包名解析不逃出当前检出的守卫 ExecPlan

> 状态：Completed（pnpm 测试入口交付；#186 的原生 Node 绕过路径仍开放）
> 创建：2026-10-21
> 范围：交付 issue #186 的 pnpm 测试入口守卫：裸包名 `@harness-projects/*` 解析到当前检出根目录之外时，测试入口机械失败；`tests/README.md` 的手工两步改为机械检查。只动测试基础设施（`scripts/`、`tests/`、根 `package.json` 的 `scripts` 块），不动产品包。
> 上游输入：issue #186、`AGENTS.md` §6 / §9、`tests/README.md`、`docs/development/content-placement.md` §2 第 1 桶、`tests/contract/package-boundaries.test.js`、`scripts/run-test-layer.mjs`。
> 执行上下文：分支 `test/worktree-resolution-guard`，工作树 `.worktrees/worktree-resolution-guard`，base `origin/main`（设计时观察到 `3391c01d`，2026-10-21 15:05 +08；回读 `git rev-parse --short origin/main`）。

## Purpose / Big Picture

完成后，一个没装依赖、嵌在主检出 `.worktrees/` 下的新检出里，`pnpm test`、`pnpm test:contract`、`pnpm test:mvp0`、`pnpm run boundaries` 与新增的单文件入口 `pnpm test:file <path>` 都在跑任何用例之前退出 1，逐包列出 `name -> 实际落点` 并给出 `pnpm install --frozen-lockfile`；直接 `node --test tests/contract` 时由契约用例在进程内判红。已安装的检出与 CI 单检出静默通过，无任何环境分支。

最小成功证据：scratch 嵌套复制树里 `pnpm run test:file tests/contract/domain-enums.test.js` 退出 1 且输出没有 `ℹ tests`；同一命令在已安装检出里 `ℹ pass 6`；变异表 M1–M19 全部 KILLED 且归因到指定用例（M19 由 2026-10-21 验收轮追加，见 D11）。

## Context and Orientation

- 现象（issue #186）：Node 的裸包名查找从调用方目录逐级向上找 `node_modules`（https://nodejs.org/api/modules.html#loading-from-node_modules-folders）。检出位于 `<主检出>/.worktrees/<slug>/`，自身没有 `node_modules` 时命中主检出的 `node_modules`，测试跑的是主检出的代码。
- 复现（独立评审者，2026-10-21 15:05 +08，`origin/main` = `3391c01d` 的 `git archive` 复制树：外层装好依赖，内层 `<外层>/.worktrees/bare` 未装）：内层 `createRequire(...).resolve('@harness-projects/core')` 与 `import.meta.resolve` 都返回外层 `packages/core/src/index.ts`；`node --test tests/contract/domain-enums.test.js` 得 `ℹ pass 6`，是对外层代码的假绿。
- 现状：`tests/README.md`「运行方式」下写着手工两步（`pnpm install --frozen-lockfile`、`ls -l node_modules/@harness-projects/core`）和「这条没有机械守卫」。根 `package.json` 的 `test`、`test:contract`、`test:mvp0`、`boundaries` 直接 `node --test`；`verify` = `typecheck && test && test:mvp0`。`.github/workflows/ci.yml` 跑 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`；Merge Gate 四条 lane 经 `scripts/run-test-layer.mjs` 直接跑，都是单检出。
- 名单：根 `package.json` 的 `devDependencies` 声明 18 个 `@harness-projects/*`（`workspace:*`）；`package-boundaries.test.js`「根 manifest 声明全部工作区包」保证 `EXPECTED` 的每个包都在其中（单向包含，不是相等）。所有包的 `exports["."]` 是无条件字符串（`./src/index.ts`）。`tests/` 下没有 `node_modules`，所以从根解析与从任一测试文件解析结果相同。
- 原结论“只需查根，根装好则全在检出内” Superseded by D13（2026-10-21）。守卫只证明从根 manifest 发起的解析；普通完整安装且无子目录 shadow 时，各包回退到该根。包自身或测试子目录中的 `node_modules` 若残留指向另一检出的同名包，实际测试/包内解析可能越界，根级检查仍通过。此缺口同直接 Node 绕过一起由开放的 #186 / TD-088 跟踪。

## Design / Spec

**方案**：一个零依赖脚本 `scripts/resolution-check.mjs`，既导出纯函数又是 CLI；pnpm 测试脚本以 `node scripts/resolution-check.mjs && ` 前置它（快速失败）；契约测试在进程内再查一次真实检出（覆盖直接 `node --test` 目录的运行）并用夹具钉住语义与接线。

- `findStrayResolutions(root)`：`realRoot = realpathSync(root)`；读 `<realRoot>/package.json` 的 `devDependencies` 里以 `@harness-projects/` 开头的名字，空集抛错（fail closed）；对每个名字 `createRequire(<realRoot>/package.json).resolve(name)` 后再 `realpathSync`，不以 `realRoot + path.sep` 开头记 `{ name, resolved, reason: 'outside-root' }`；解析抛错记 `{ name, resolved: null, reason: error.code }`，不外抛，一次列全。返回数组，空即通过。
- CLI：根取自脚本自身位置（`realpath(scripts/..)`），与 cwd 无关；有越界时 stderr 打一行结论（含根目录、「这次运行的红/绿都不是本检出的证据」）、逐包 `  <name> -> <落点或错误码>`、一行修复命令 `pnpm install --frozen-lockfile`，`exit 1`；否则静默 `exit 0`。只 import `node:` 内建模块，依赖缺失时自己不会先崩。入口判定沿用 `scripts/run-test-layer.mjs` 的 `invokedDirectly()`（realpath 比较）。
- 接线：`test`、`test:contract`、`test:mvp0`、`boundaries` 前置守卫；新增 `test:file` = `node scripts/resolution-check.mjs && node --test --test-timeout=120000`。pnpm 把参数追加到脚本串末尾，`&&` 之后的 `node --test` 收到路径（pnpm 10.28.2 实测）。`verify` 不改：完全未装时它先在 `typecheck` 处失败（`sh: tsc: command not found`），部分安装时由 `test` 的前置拦住。
- 关键不变量：检查只读、无状态；判据只有「realpath 后的落点在 realpath 后的根内」，与逃逸机制（祖先 `node_modules`、`NODE_PATH`、`$HOME/.node_modules`、软链）无关。
- 已知边界：只查 `@harness-projects/*`（issue 范围），第三方依赖在「根已装但锁文件已变」时仍可能向上解析，修复命令相同；`node-linker=hoisted` 或注入式工作区包会把包拷进检出，前缀判定看不出，本仓库未启用。直接 `node --test` 单个文件、以及 `tests/mvp0`、`tests/integration`、`tests/e2e` 目录无守卫（见 TD-088、TD-089；2026-10-21 验证修复轮由「单个文件」扩到目录，见 D9）；把测试文件当脚本运行（`node <file>`，`docs/architecture/release-gates.md` 的用例回读就是这种写法）同样无守卫（2026-10-21 验收轮补入，见 D11）。

**评审取舍**（对两份独立设计；详细依据见 Decision Log）：

| 来源 | 采纳 | 否决 |
|---|---|---|
| 设计 1（契约测试） | 进程内真实检出断言；名单取根 manifest；夹具用不存在的包名 `@harness-projects/foo`；不并入 `package-boundaries.test.js` | 只靠契约测试（`test:mvp0` 单跑与单文件运行不受保护，失败夹在其他红里）；接受 M3 存活；README 换成另一条手工前置命令 |
| 设计 2（前置守卫） | 脚本前置快速失败；单文件入口；`NODE_PRESERVE_SYMLINKS=1` 杀死「去掉结果 realpath」；兄弟目录前缀、根别名、空集抛错、cwd 无关 | `--import` 预加载与嵌套 `node --test` 用例（`&&` 已够）；库与入口拆两个文件；`check:worktree` 别名与改 `verify`；钉 README 文本；读 `dependencies`（根没有） |

## Global Constraints

- 本 PR 改动的文件集合（唯一声明处）：新增 `scripts/resolution-check.mjs`、`tests/contract/resolution-check.test.js`、本计划（归档时移到 `docs/exec-plan/completed/`）；改 `package.json`（仅 `scripts` 块）、`tests/README.md`（运行方式与守卫边界）、`tests/mvp0/README.md`（纠正守卫与直接 Node 的区别）、`docs/review/pr-391-mmp-review.md`；在 `docs/exec-plan/tech-debt-tracker.md` 的 Open Items 追加 TD-088、TD-089 两行（2026-10-21 验证修复轮提前登记，见 D10）。
- 归档时由协调者维护 `docs/README.md` 的索引行。不改：tracker 的任何既有行（尤其 TD-054）；`AGENTS.md`；`.github/workflows/**`；`scripts/run-test-layer.mjs`；`tests/contract/package-boundaries.test.js`；`packages/**`、`apps/**`、`docs/adr/**`、`docs/product/vertical-path.md`、`tests/integration/harness-plugin-artifact.test.js`（历史并行占用已解除；本轮仍保持产品代码与构建门禁不变）。
- 技术债号段只用 TD-088–TD-089，两号均已使用（见 D10）。
- 体量：预计实现约 60 行、测试约 110 行、`package.json` +5/−4，文档约 240 行（本计划约 220 + README ±15 + tracker 1）；上限代码 800、文档 1300（CI 硬上限 1000 / 1500）。
- 守卫与测试不 import 工作区包和第三方包；不读 pnpm 状态文件（`node_modules/.modules.yaml`、`.pnpm`）；无环境变量分支。Node `>=22`（`engines`），实测 26.11.1（`.nvmrc`）。
- 先写会失败的用例再实现；变异用 `scripts/review-mutate.mjs`（锚点恰好一次、按字节还原、`killedBy` 归因）。不写 git config；身份用 `git -c` 单次传入。提交正文只写 `Refs #186`，关闭关系只由 PR 正文承载并回读 `closingIssuesReferences`。看板 Status 与 blocked-by 由人类决定，agent 不写。

## Plan of Work

所有命令在检出 `test/worktree-resolution-guard` 的工作树根目录运行，`gh` 一律带 `-R SingularityKChen/harness-projects`。scratch 树指：`git archive HEAD` 解到 `<scratch>/outer` 后 `pnpm install --frozen-lockfile --offline`（失败去掉 `--offline`），再 `git archive HEAD` 解到 `<scratch>/outer/.worktrees/bare` 且不安装；`<scratch>` 是实施者自己的唯一临时目录，不写进仓库文件。

### Batch 1 · 对齐与计划入库

**最小闭环**：分支对齐 `origin/main`，本计划入库，draft PR 关联 #186。**涉及文件**：本计划。
- [ ] `git merge --ff-only origin/main`（分支无自有提交），回读 `git rev-list --count HEAD..origin/main`（期望 `0`）。
- [ ] 提交 `docs(exec-plan): 规划裸包名解析不逃出检出的守卫`；push；开 draft PR，标题 `test(tests): guard against bare package names resolving outside the worktree`，正文以关闭关键字关联 #186（此关闭要求 Superseded by D12，2026-10-21：最终只 `Refs #186`）；标签 `kind:test`、`area:tests`、`area:development`；milestone 与 #186 相同（`gh issue view 186 -R SingularityKChen/harness-projects --json milestone`）；assignee `SingularityKChen`。
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
- [x] 验证修复轮追加（2026-10-21，见 Progress 与 D9）：用例 9 `CLI 失败闭合：根 manifest 没有 @harness-projects/* 或读不到时退出 1，stderr 只有带前缀的一行、不打栈`（把脚本拷进夹具 `wt/scripts/`，根 manifest 只声明 `yaml`，再删掉 manifest 各跑一次）；用例 2、7 的夹具改为同时声明 foo 与 bar 两个包，断言函数返回两项、CLI 的 stderr 逐包各一行。用例标题 1–8 不变。
- [x] 验收轮追加（2026-10-21，见 D11）：用例 7 在「全部越界」与「补齐安装」之间加一步部分安装（只软链 foo），断言只有 bar 越界时 CLI 仍退出 1、stderr 列出 bar 且不列 foo；用于杀死 M19（CLI 只有一个越界时静默）。用例标题不变。
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
- [x] 变异 spec 写在 `.superpowers/review/pr186-mutants.json`（不入库），命令 `["node","--test","tests/contract/resolution-check.test.js"]`，逐条见 Validation 表；`node scripts/review-mutate.mjs .superpowers/review/pr186-mutants.json`，期望退出 0、18 个 KILLED（M1–M13 加验证修复轮追加的 M14–M18）、无 KILLED_OTHER / NOT_APPLIED。Superseded by Progress「验收轮」（2026-10-21）：表扩到 M1–M19，验收者的 spec 实际放在运行态目录 `.superpowers/iter7-batch-20261021/pr186/accept-mutants.json`（主检出下，不入库）。
- [x] `pnpm verify`、`pnpm run boundaries`（期望全绿，主套件用例数 = base + 9（当前基线推进后以最新命令输出为准））；`node scripts/rule-checks.mjs size origin/main` 与 `disclosure origin/main`（期望通过）；`git diff --check origin/main...HEAD`（期望无输出）。
- [x] 回读 tracker 的 TD-088、TD-089（验证修复轮已按归档后路径写入，不重复追加）；回填本计划，移到 `docs/exec-plan/completed/`。（验收轮已回读并就地补全两行措辞、回填本计划；归档由协调者在合并前决定。）
- [ ] 整合为三个提交：`docs(exec-plan)` 计划、`test(tests)` 交付物（脚本 + 测试 + `package.json` + README）、`docs(exec-plan)` 回填归档与 TD-088、TD-089；改写前建 backup ref，改写后 `comm` 比对新旧 head 的文件集合，`git log origin/main..HEAD --format=%B | grep '^#'` 为空。
- [ ] 精确 force-with-lease 推送后回读 `gh pr checks <n> -R SingularityKChen/harness-projects`（期望全部 pass，其中 `ci.yml` 的 Verify 在单检出里跑过前置守卫）、head、base、关联；`gh pr ready <n>`，请求人类评审。
**回滚**：backup ref 恢复；已合并则 `git revert` 交付提交。

## Validation and Acceptance

| # | 验收项（issue #186） | 判定证据 |
|---|---|---|
| 1 | 裸 `@harness-projects/*` 解析到检出根之外必须失败 | 用例 2、4、7；scratch 内层树里用例 1 红、`pnpm run test:file …` 与 `pnpm run test:mvp0` 退出 1；变异 M1（去 `path.sep`→用例 4）、M2（去结果 realpath→用例 7）、M5（根取 cwd→7）、M6（不 exit 1→7）、M13（越界判定恒假→2、4、7）、M19（只有一个越界时静默→7）。范围：pnpm 的五个测试入口与含用例 1 的 `node --test` 运行；不经 pnpm 直接用 `node` 跑其他文件或目录不在内（TD-088），PR #391 仅 `Refs #186`，不请求关闭 issue；D12 保留更广问题开放 |
| 2 | CI 单检出无需特判即通过 | 脚本无环境分支（`grep -n "process.env" scripts/resolution-check.mjs` 无输出）；用例 1、3 在已安装检出绿；PR 的 `ci.yml` Verify 经 `pnpm test` 跑前置守卫且 pass（推送后由协调者回读 `gh pr checks <n> -R SingularityKChen/harness-projects`）；变异 M3（根不 realpath→用例 3，另使用例 1 变红） |
| 3 | 不依赖 pnpm 内部 | `grep -n "^import" scripts/resolution-check.mjs` 只有 `node:` 模块；不读 `.modules.yaml` / `.pnpm` |
| 4 | README 手工两步变机械检查 | README 不再含 `ls -l node_modules`；用例 8；变异 M9（`test:mvp0` 去前置→8）、M10（删 `test:file`→8） |
| 5 | 失败闭合与信息可用 | 用例 5、6、7、9；变异 M4（吞解析失败→5）、M7（前缀写错→1–7、9）、M8（去空集抛错→6、9）、M11（去修复命令→7）、M12（去落点→7）、M14（CLI 吞错但不置退出码→9）、M15（去 `resolution-check:` 前缀→9）、M16（CLI 只列第一个包→7）、M17（首个越界即停→2、7）、M18（catch 后不 return→9） |
| 6 | 独立验证者的追加变异仍全杀（验收轮） | 同一命令下 N1–N6、N8–N13（N7 即 M19）与验收者追加的 A1（CLI 失败时打栈→9）、A2（`reason` 写错→2、4）、A3（`test:file` 去前置→8）全部 KILLED，归因同上；回读：`node scripts/review-mutate.mjs <spec>` 退出 0 |

## Progress

- [x] 2026-10-21 15:05 +08 独立评审两份设计；在 scratch 嵌套复制树复现假绿；原型（脚本 45 行、测试 94 行）在已装树 8/8 绿、在内层树用例 1 红，`review-mutate` 13/13 KILLED 且归因正确；定稿本计划。
- [x] 2026-10-21 18:01 +08 Batch 1：已核实 draft PR #391 与原计划提交；当前分支 rebase 到 `origin/main`，期间的 tracker 冲突保留 main 全部既有行与 TD-088/089。旧提交由 `backup/pr391-before-continuation-20261021` 和远端旧 head 的 backup ref 保留；产品与测试文件逐字节一致。
- [x] 2026-10-21 15:54 +0800 Batch 2 判定函数、CLI 与语义用例（分支 `test/worktree-resolution-guard`）
  - 先红：脚本为只返回 `[]` 的桩时，`node --test tests/contract/resolution-check.test.js` 得 `ℹ tests 7`、`ℹ pass 2`、`ℹ fail 5`；红的是用例 2、4、5、6、7，失败类型全是 `ERR_ASSERTION`（deepEqual 不等、`Missing expected exception`、`期望退出 1，实际 0`），不是 import 错误；用例 1、3 空真通过，与计划预期一致。
  - 转绿：实现后同命令 `ℹ tests 7`、`ℹ pass 7`、`ℹ fail 0`；`node scripts/resolution-check.mjs; echo $?` 无输出、`0`；`pnpm run boundaries` 得 `ℹ tests 9`、`ℹ pass 9`、`ℹ fail 0`。
  - 内层未装树（scratch：`git archive` 复制树，外层已装、`.worktrees/bare` 未装，复制入本批脚本与用例）：`node --test tests/contract/resolution-check.test.js` 得 `ℹ tests 7`、`ℹ pass 6`、`ℹ fail 1`，红的是用例 1；`node scripts/resolution-check.mjs` 退出 1，stderr 首行 `resolution-check: 18 个 @harness-projects/* 包没有解析到检出 … 之内`，逐包列出外层 `packages/<x>/src/index.ts` 落点与修复命令。
  - 验收 grep：`grep -n "process.env" scripts/resolution-check.mjs` 无输出；`grep -n "^import" scripts/resolution-check.mjs` 只有 `node:` 模块。
- [x] 2026-10-21 15:57 +0800 Batch 3 接线、单文件入口与 README（分支 `test/worktree-resolution-guard`）
  - 先红：加用例 8 后 `node --test tests/contract/resolution-check.test.js` 得 `ℹ tests 8`、`ℹ pass 7`、`ℹ fail 1`，失败信息 `package.json 缺少脚本 test:file`（`ERR_ASSERTION`）。
  - 转绿：改 `package.json` 的 `scripts` 块（+5/−4）后同命令 `ℹ tests 8`、`ℹ pass 8`、`ℹ fail 0`；已安装检出里 `pnpm run test:file tests/contract/domain-enums.test.js` 得 `ℹ tests 6`、`ℹ pass 6`、`ℹ fail 0`（pnpm 把路径追加到最后一条 `node --test` 之后，与 D2 一致）；`pnpm run test:contract` 得 `ℹ tests 1010`、`ℹ pass 1010`、`ℹ fail 0`。
  - 内层未装树（scratch：外层已装、`.worktrees/bare` 未装，复制入本批 `package.json` 与用例）：`pnpm run test:file tests/contract/domain-enums.test.js`、`pnpm run test:mvp0`、`pnpm run test:contract`、`pnpm run boundaries`、`pnpm test` 五个入口都退出 1，输出含 `resolution-check:` 且没有 `ℹ tests`；外层已装树同一 `test:file` 命令 `ℹ pass 6`。
  - README：命令块加 `pnpm test:file <path>`；「必须先安装依赖」段改为守卫说明、哪些入口先跑它、失败时 `pnpm install --frozen-lockfile`、单独检查 `node scripts/resolution-check.mjs`、直接 `node --test <file>` 不受保护（TD-088）；`grep -n "ls -l node_modules" tests/README.md` 无输出；§3 写法要求未动。
  - 变异表（`scripts/review-mutate.mjs`，spec 在运行态目录不入库，命令 `node --test tests/contract/resolution-check.test.js`）：M1–M13 全部 KILLED，退出码 0，无 NOT_APPLIED / KILLED_OTHER，归因与 Validation and Acceptance 表一致（M1→用例 4；M2、M5、M6、M11、M12→用例 7；M3→用例 3，另使用例 1 变红；M4→用例 5；M7→全部夹具用例；M8→用例 6；M9、M10→用例 8；M13→用例 2、4、7）；跑完 `git diff --stat` 与跑前一致（按字节还原）。整表复核由 Batch 4 的验收者做。
- [x] 2026-10-21 16:29 +0800 验证修复轮 F1–F4（分支 `test/worktree-resolution-guard`，起点 697e6db0；scratch 复制树取自该提交的 `git archive`：外层已装、未装内层 `.worktrees/bare`、已装内层 `.worktrees/inst`）
  - F1（P2）属实，口径部分。复跑：bare 里 `node --test tests/contract/domain-enums.test.js` 得 `ℹ pass 6`、`node --test tests/mvp0` 得 7/7，退出 0（假绿）；`.worktrees/node_modules` 放哨兵包后同一命令 `ℹ fail 1`，外层与 inst 仍 `ℹ pass 6`。「没有无标志办法」被推翻，但拦截需要检出之外的被忽略状态，取舍归人类：不实现哨兵；订正 README、D7、Surprises、Design 的措辞，TD-088 记各办法与代价，D9 写「待人类决定」（是否把 #186 验收收窄为 pnpm 入口加 `node --test tests/contract`）。
  - F2（P2）属实。先红：原用例集上 M14（去 `process.exitCode = 1`）、M15（去 `resolution-check:` 前缀）为 `GREEN exit=0`，即存活。新增用例 9（脚本拷进 `wt/scripts/`，根 manifest 只声明 `yaml`；再删掉 manifest），对正确实现 `ℹ tests 9`、`ℹ pass 9`；变异下转红：M14、M15 都只让用例 9 失败。另补 M18（catch 后不 return，会在退出 1 之后打 TypeError 栈）也只由用例 9 杀死。
  - F3（P3）属实，一处夹具改动即修。用例 2、7 的夹具改为 foo 与 bar 两个包（`writeRoot` 加 `names` 参数、`installScript`/`runCli` 两个小辅助）：M16（`slice(0, 1)`）存活→只由用例 7 杀死，M17（首个越界即 `break`）存活→用例 2、7 杀死。
  - F4（P3）属实。bare 里 `node --test tests/mvp0` 7/7、`node --test tests/e2e` 175/175、`node --test tests/integration/delivery-pages-complete.test.js` 7/7 全是假绿。README 改写为「只有运行集合含 `tests/contract/resolution-check.test.js` 才判红，单个文件与 mvp0/integration/e2e 目录不受保护」并把命令块改为「文件或目录」；不动 `tests/mvp0/README.md`（Global Constraints），其第 10–11 行矛盾与 `docs/product/vertical-path.md`、`docs/architecture/release-gates.md` 的同类命令登记为 TD-089；TD-088、TD-089 已追加到 tracker（D10）。
  - 读数（均在 `test/worktree-resolution-guard` 工作树根）：变异表 M1–M18（`scripts/review-mutate.mjs`，spec 在运行态目录不入库）整表在最终树重跑，退出 0，18 个 KILLED，无 SURVIVED / KILLED_OTHER / NOT_APPLIED，归因同 Validation 表，跑完工作树仅含预期改动；`pnpm run boundaries` 得 `ℹ tests 9`、`ℹ pass 9`；`pnpm run typecheck` 通过；`pnpm verify` 退出 0，主套件 `ℹ tests 1709`、`ℹ pass 1709`、`ℹ fail 0`，mvp0 `ℹ tests 7`、`ℹ pass 7`（跑前 `apps/harness-plugin/dist` 不存在）。scratch 未装内层 bare（复制入本轮用例）：`node --test tests/contract/resolution-check.test.js` 得 `ℹ tests 9`、`ℹ pass 8`、`ℹ fail 1`，红的是用例 1；`pnpm run test:file tests/mvp0`、`test:file tests/e2e`、`test:file tests/contract/domain-enums.test.js`、`test:mvp0`、`test:contract`、`boundaries`、`test` 七条都退出 1、输出含 `resolution-check:` 且没有 `ℹ tests`；外层已装树 `pnpm run test:file tests/mvp0` 得 7/7（`test:file` 接受目录）。
- [x] 2026-10-21 18:03 +08 Batch 4 本地验收、全量验证、计划归档与三个交付提交的整合已完成；发布操作与 ready 状态另按 Batch 4 的 `gh` 命令回读，不把本地结果当成远端状态。原“整合与归档未做”的描述 Superseded by 本条。
- [x] 2026-10-21 16:50 +0800 验收轮（验收者（Claude Opus 5.5），分支 `test/worktree-resolution-guard`，起点 3ffce801；scratch 复制树取自 3ffce801 的 `git archive`：外层已装、未装内层 `.worktrees/bare`、已装内层 `.worktrees/inst`）
  - 既往发现按原始条件复跑：F1 未修（按设计，口径已订正）——bare 里 `node --test tests/contract/domain-enums.test.js` 仍 `ℹ pass 6`、退出 0；在 `<外层>/.worktrees/node_modules/@harness-projects/<每个包>/` 放哨兵包后同一命令 `ℹ fail 1`（`does not provide an export named 'AccessLevel'`），inst 与外层仍 `ℹ pass 6`，与 README、D7、D9、Surprises 的现行措辞一致。F2 已修——N1、N2 在原命令下都只由用例 9 杀死。F3 已修——N3 由用例 7、N4 由用例 2 与 7 杀死。F4 已修文档口径——bare 里 `node --test tests/mvp0` 仍 7/7（按设计），README 与 TD-088 已写全目录范围、TD-089 已登记三份文档。
  - 修复本身复评：N7 在 3ffce801 上存活（见 Surprises「修复本身让一个原先被杀的变异复活」）。先红：原用例集上 N7 `GREEN exit=0`；用例 7 加部分安装一步后，同一变异（记 M19）`RED`，失败用例只有用例 7；对正确实现 `ℹ tests 9`、`ℹ pass 9`。
  - 变异整表（`scripts/review-mutate.mjs`，命令 `node --test tests/contract/resolution-check.test.js`，spec 在运行态目录 `.superpowers/iter7-batch-20261021/pr186/accept-mutants.json`，不入库）：34 个变异退出 0、全部 APPLIED 且 KILLED，无 SURVIVED / KILLED_OTHER / NOT_APPLIED；跑完三个被变异文件的 shasum 与跑前一致。M1–M19 的归因同 Validation 表；N1–N4 同 M14–M17；N5（接受父目录下任何路径）→用例 4，N6（`invokedDirectly` 恒假）→用例 7、9，N8（`createRequire` 改用 `import.meta.url`）→用例 2、3、4，N9（`test` 的 `&&` 改 `;`）→用例 8，N10（错误码固定为 `UNRESOLVED`）→用例 5，N11（名单改读 `dependencies`）→用例 1–5、7，N12（`boundaries` 去前置）→用例 8，N13（越界报告改到 stdout）→用例 7；A1（CLI 失败时附打栈）→用例 9，A2（`reason` 写错）→用例 2、4，A3（`test:file` 去前置）→用例 8。
  - 重构与文档：守卫脚本文件头的用法说明与 D8 对齐（退出 1 时首行带前缀，读不到 manifest 时只有这一行）；测试文件头注释补 `bar`；README 合并两段重复的「直接 `node --test tests/contract` 会判红」并补脚本方式运行；TD-088、TD-089 就地补「把测试文件当脚本运行」与 `pnpm run test:file --test-reporter=spec --test-name-pattern=…` 的替代写法（这两行由本 PR 新增，不是 tracker 的既有行）。
  - 全量验证（工作树根，`apps/harness-plugin/dist` 不存在）：`pnpm run typecheck` 退出 0；`pnpm verify` 退出 0，主套件 `ℹ tests 1709`、`ℹ pass 1709`、`ℹ fail 0`，mvp0 `ℹ tests 7`、`ℹ pass 7`，两处都先跑了守卫；基线：分叉点 `3391c01d` 的 `git archive` 复制树装依赖后同一主套件命令得 `ℹ tests 1700`，即本分支 = base + 9（复制树没有 `.git`，`tests/contract/issue-policy.test.js` 有一条与本 PR 无关的环境性失败）；`pnpm run boundaries` 得 `ℹ tests 9`、`ℹ pass 9`；`node scripts/workflow-check.mjs` 为 `no findings（已检查 8 个文件）`；`rule-checks size`、`disclosure`、`git diff --check` 与 scratch 端到端读数见 Outcomes 与本条下一项。
  - 与前进后的 `origin/main` 的并集（观察时刻 2026-10-21 16:50 +0800，`origin/main` = 66870dfd，比分叉点 3391c01d 多 8 个提交；回读 `git rev-list --count HEAD..origin/main`）：在本仓库的本地 `git clone` 里检出 66870dfd，套上本分支相对 3391c01d 的 `package.json`、守卫脚本、契约测试与 `tests/README.md` 改动，装依赖后 `pnpm verify` 退出 0，主套件 `ℹ tests 1734`、`ℹ pass 1734`（= 66870dfd 的 1725 + 9），mvp0 7/7。`git merge-tree --write-tree HEAD origin/main` 只报 `docs/exec-plan/tech-debt-tracker.md` 一处内容冲突：主线在 Open Items 表尾追加了 TD-070–TD-073，与本分支的 TD-088、TD-089 落在同一位置，变基时两组都保留、按编号排列即可。
  - scratch 端到端（重建的复制树：3ffce801 的 `git archive` 再覆盖本轮改动的文件）：外层已装、`.worktrees/bare` 未装、`.worktrees/inst` 已装，三处的守卫脚本、契约测试与 `package.json` 与本轮提交逐字节相同。bare 里 `pnpm run test:file tests/contract/domain-enums.test.js`、`pnpm run test:file tests/mvp0`、`pnpm run test:mvp0`、`pnpm run test:contract`、`pnpm run boundaries`、`pnpm test` 六条与 `node scripts/resolution-check.mjs` 都退出 1、输出含 `resolution-check:`、没有 `ℹ tests`，守卫逐包列出 18 行外层落点；bare 里 `node --test tests/contract/resolution-check.test.js` 得 `ℹ tests 9`、`ℹ pass 8`、`ℹ fail 1`，红的只有用例 1。inst 与外层：`node scripts/resolution-check.mjs` 静默退出 0，`pnpm run test:file tests/contract/domain-enums.test.js` 得 `ℹ pass 6`，`node --test tests/contract/resolution-check.test.js` 得 `ℹ pass 9`。

- [x] 2026-10-21 18:03 +08 协调者独立复跑：在本分支工作树根目录 `pnpm verify` 主套件 1770/1770、MVP-0 7/7，退出 0；`node scripts/review-mutate.mjs <accept-spec> --root <本工作树>` 34/34 KILLED，退出 0，还原后脚本与测试字节相同。

## Surprises & Discoveries

- 完全未装的检出里 `pnpm verify` 并不静默通过：`pnpm run typecheck` 输出 `sh: tsc: command not found` 与 pnpm 的 `node_modules missing` 警告后失败；issue 所说「verify 静默跑错代码」对应的是部分安装。`pnpm test` / `test:contract` / `test:mvp0` 则确实静默假绿。（scratch 内层树，2026-10-21 15:05 +08）
- Node 26.11.1 不自动加载 `node.config.json`，需 `--experimental-default-config-file`；仓库内没有无标志手段守住直接 `node --test <file>`。（`node --help | grep config-file` 与 scratch 实测）前半句（`node.config.json` 需实验标志）仍成立；后半句 Superseded by 下面的「无标志拦截点存在」（2026-10-21）。
- `NODE_PRESERVE_SYMLINKS=1` 下 `require.resolve` 返回软链路径：`wt/node_modules` 软链到外层时，去掉结果 realpath 的变异退出 0，原实现退出 1；默认标志下两者都退出 1。
- 设计输入的事实偏差：`package-boundaries.test.js` 对根 manifest 是单向包含而非相等；pnpm 当前文档写 `verifyDepsBeforeRun` 默认 `install`（https://pnpm.io/settings/build），钉定的 10.28.2 上 `pnpm config get verify-deps-before-run` 为 `undefined` 且未装时照常运行脚本。

- 无标志拦截点存在（推翻上面「仓库内没有无标志手段」；2026-10-21 验证修复轮，检出 `test/worktree-resolution-guard` @ 697e6db0 的 `git archive` 复制树）：外层 `pnpm install --frozen-lockfile --offline`，未装内层 `<外层>/.worktrees/bare`，已装内层 `<外层>/.worktrees/inst`。未放哨兵时 bare 里 `node --test tests/contract/domain-enums.test.js` 得 `ℹ pass 6`、退出 0，`node --test tests/mvp0` 得 7/7，都是对着外层代码的假绿。在 `<外层>/.worktrees/node_modules/@harness-projects/<每个包>/` 放哨兵包（`package.json` 加一个空导出的 `index.js`，不加任何 Node 标志）后，bare 里同一条 domain-enums 命令得 `ℹ fail 1`、退出非 0，报 `The requested module '@harness-projects/domain' does not provide an export named 'AccessLevel'`；外层与 inst 仍 `ℹ pass 6`。Node 的祖先 `node_modules` 查找先命中 `.worktrees/node_modules`，所以拦截点存在。代价：依赖检出之外被 Git 忽略的状态、只覆盖 `.worktrees/` 布局、报错不是修复指引；逐文件 import 守卫也是无标志办法，代价是近百个测试文件（97 个）与在途 PR 冲突。结论由「没有」改为「没有低代价的」，见 D9。
- 直接 `node --test` 不受保护的范围比 README 原写法大（同一复制树的 bare）：`node --test tests/mvp0` 7/7、`node --test tests/e2e` 175/175、`node --test tests/integration/delivery-pages-complete.test.js` 7/7，全是假绿（integration 与 e2e 目录里没有进程内的守卫用例）。`tests/mvp0/README.md` 第 10–11 行把 `pnpm test:mvp0  # 等价于 node --test tests/mvp0` 与 `node --test tests/mvp0  # 直接跑` 并列：前一句在本 PR 之后不再等价，后一句正是不受保护的路径；`docs/product/vertical-path.md`、`docs/architecture/release-gates.md` 也把直接 `node --test <目录>` 写成回读命令。这些文件在 Global Constraints 的「不改」范围内或属别的闭环，登记为 TD-089。
- 原变异表 M1–M13 没有覆盖 CLI 的 catch 分支与「一次列全」（验证修复轮，分支 `test/worktree-resolution-guard` @ 697e6db0，`scripts/review-mutate.mjs`）：去掉 `process.exitCode = 1`、去掉 `resolution-check:` 前缀、`...stray.slice(0, 1).map(`、首个越界即 `break` 四个变异都是 `GREEN exit=0`（SURVIVED）。夹具只声明一个包，分辨不出「只报第一个」；没有任何用例以 CLI 方式跑空名单或不可读的 manifest。
- 修复本身让一个原先被杀的变异复活（验收轮，分支 `test/worktree-resolution-guard` @ 3ffce801，`scripts/review-mutate.mjs`，命令同上）：独立验证者的 N7（`if (stray.length === 0) return;` 改成 `<= 1`，即只有一个越界时 CLI 静默）在 697e6db0 上由用例 7 杀死，在 3ffce801 上 `GREEN exit=0`。原因是 F3 的修复把用例 7 的夹具改成 foo、bar 两个包都越界，CLI 层再没有「恰好一个越界」的场景；而这正是最常见的部分安装（装完依赖后根 manifest 又加了一个包，只有新包向上解析）。用例 7 加部分安装一步后，该变异（记为 M19）只由用例 7 杀死。
- 把测试文件当脚本运行同样不受保护（验收轮，同一提交的 `git archive` 复制树，外层已装、内层 `.worktrees/bare` 未装）：bare 里 `node tests/contract/domain-enums.test.js` 得 `ℹ pass 6`、退出 0，是假绿。`docs/architecture/release-gates.md` 与 `docs/product/vertical-path.md` 的用例回读正是 `node --test-reporter=spec --test-name-pattern=… <文件>` 这种不带 `--test` 的写法。已安装检出里 `pnpm run test:file --test-reporter=spec --test-name-pattern='CLI 失败闭合' tests/contract/resolution-check.test.js` 得 `ℹ tests 1`、`ℹ fail 0`，pnpm 10.28.2 把这些参数原样追加在最后一条 `node --test` 之后，可作替代写法。已并入 TD-088、TD-089 与 `tests/README.md`。

## Decision Log

- D14（2026-10-22 / 修复协调者）：按人类本次“继续走修复流程PR#388-#391”接手该四分支，沿用本会话的修复、独立复评、归档、提交整理、issue核对和rebase合并流程，不写Project Status或blocked-by。#391只以Refs关联#186，保持未覆盖验收开放，不代替人类收窄范围。
- D15（2026-10-22 / 修复协调者）：更正D9的哨兵代价；可由外层根安装在其自己的被忽略`.worktrees/node_modules`物化，exports目标名可带修复指引，与前置守卫互补。当前只保留该候选到#186，未授权或实现跨文件哨兵机制。
- D16（2026-10-22 / 修复协调者）：保留当前require.resolve定位实现并以运行时契约钉住本仓库无条件根导出前提；未来改导出条件须同步调整守卫。增加CLI只有MODULE_NOT_FOUND仍失败的反例，并用回退变异证明，不为低风险文档编写镜像测试。


以下均为协调者授权的独立评审者按调研决定，人类可推翻。日期 2026-10-21，作者：独立评审者（Claude Opus）。

| 决策 | Rationale |
|---|---|
| D1 守卫放在 pnpm 测试脚本的 `&&` 前置步骤，契约测试另在进程内兜底 | 同类机制都选「运行前」作检查点：pnpm `verifyDepsBeforeRun` 在 `pnpm run` 前检查依赖状态，但它读 pnpm 自己的安装记录、默认值随版本变（违反 issue 约束）；`--test-global-setup` 自 v24.0.0、Stability 1.0（https://nodejs.org/api/test.html），低于 `engines >=22`；`pretest` 钩子受 `enablePrePostScripts` 配置左右（https://pnpm.io/settings/other）且每个 `test:*` 要各写一个；`node.config.json` 需实验标志；pnpm 官方 worktree 指南只要求每个 worktree 各自安装、无守卫（https://pnpm.io/git-worktrees）。内联 `&&` 与包管理器无关、显式、可被契约测试钉住 |
| D2 单文件入口用 `test:file` = 守卫 `&&` `node --test`，不用 `--import` 预加载 | pnpm 把参数追加到脚本串末尾（10.28.2 实测 `pnpm run t a/b.test.js` 只交给最后一条命令）；`--import` 会在每个测试子进程各跑一次且需嵌套 `node --test` 用例验证，收益为零 |
| D3 不改 `verify`、不加 `check:*` 别名 | 未装时 `verify` 已在 `typecheck` 失败，部分安装时 `test` 前置拦住；单独检查直接写 `node scripts/resolution-check.mjs`，少一个同义名字 |
| D4 名单取根 `package.json` 的 `devDependencies` 前缀匹配，空集抛错；只解析 `.` 入口 | 与 `package-boundaries` 已核对的清单同源，不维护第二份；空集抛错防空真；子路径导出经同一软链目录，解析 `.` 已足够 |
| D5 `createRequire(<root>/package.json).resolve` + 两端 realpath + `realRoot + path.sep` 前缀 | `import.meta.resolve` 的 parent 参数需实验标志，无法以任意根为出发点做夹具；所有包是无条件 `exports`，CJS 与 ESM 解析一致；按路径段比较防 `repo`/`repo-old`；Node 模块文档列出的逃逸途径（祖先目录、`NODE_PATH`、`$HOME/.node_modules`）都被「realpath 落点在根内」一条判据覆盖（https://nodejs.org/api/modules.html） |
| D6 一个脚本文件（导出纯函数 + CLI），独立契约测试文件 | 只有一个调用方，拆库与入口无收益；不并入 366 行的 `package-boundaries.test.js`，其 Merge Gate lane 的不变量是「依赖方向」 |
| D7 直接 `node --test <file>` 的缺口登记 TD-088，不改约 90 个测试文件 | 无无标志机制（见 Surprises）；逐文件 import 守卫会与在途 PR 的测试文件冲突且新文件易漏；README 指向 `pnpm test:file`。**前提「无无标志机制」Superseded by Surprises「无标志拦截点存在」与 D9（2026-10-21）**：结论「登记 TD-088、不逐文件改」仍成立，措辞改为「没有低代价的无标志办法」 |

实施期追加（2026-10-21，作者：实现者（Claude Sonnet 5.5）；人类可推翻）：

| 决策 | Rationale |
|---|---|
| D8 CLI 把 `findStrayResolutions` 抛出的错误（根 manifest 不可读、没有 `@harness-projects/*`）也收成一行 `resolution-check: <信息>` 并置 `process.exitCode = 1`，不让未捕获异常打栈 | Interfaces 约定退出 1 时 stderr 首行以 `resolution-check:` 开头；空集抛错是 fail closed 的一半，另一半是调用方读到的仍是同一种可 grep 的前缀。成功时不调用 `process.exit`，用 `exitCode` 让 stderr 先刷出 |

验证修复轮追加（2026-10-21，作者：修复者（Claude Sonnet 5.5）；人类可推翻）：

| 决策 | Rationale |
|---|---|
| D9（关闭关系 Superseded by D12，2026-10-21）直接 `node --test` 缺口的口径改为实测事实，不实现哨兵；**待人类决定**：是否把 #186 的验收范围收窄为「pnpm 入口加 `node --test tests/contract`」 | 实测推翻了「无无标志机制」（见 Surprises）。issue #186 的约束原文是裸包名解析到检出根之外时必须失败，复现命令正是直接 `node --test`；本 PR 守住了 pnpm 入口和 `node --test tests/contract`，没有守住直接单跑文件或其他目录。不实现 `.worktrees/node_modules` 哨兵：它要在检出之外（主检出的被忽略目录）放状态，若由根 postinstall 物化就是一个 worktree 的安装写另一个检出的目录，与检出之间互不写入的隔离前提（`AGENTS.md` §6）相冲突，且只覆盖 `.worktrees/` 布局、报错不是修复指引； **Superseded by D15（2026-10-22）：外层在自己被忽略的目录物化不跨检出写入，`.worktrees/` 正是仓库规定布局，exports 目标名可以携带修复指引；原否决依据不成立。真实代价是维护包名单、依赖外层安装状态、清理规则和仍不覆盖包内 shadow；** 这是需要人类拍板的取舍，不在 agent 权限内裁决。本轮只做不依赖裁决的事：README、D7、Surprises、Design 的措辞改成实测事实并把范围写全（文件与三个目录），TD-088 记录各办法与代价，TD-089 记录无法在本 PR 修的文档矛盾。人类二选一：接受收窄则 #186 可由本 PR 关闭；要求继续则另开 issue 评估哨兵或逐文件守卫，本 PR 的关闭关系随之调整。 |
| D10 TD-088、TD-089 提前到本轮登记，Batch 4 只回读 | README 与 Design 已引用 TD-088，且本轮要修正其范围、新增文档矛盾一项；让 tracker 持有债务正文，计划只引用，避免计划里留一份、收尾再抄一份。号段在 Global Constraints 之内，行内 ExecPlan 路径按归档后位置（`docs/exec-plan/completed/…`）写，本 PR 合并时该文件已存在。 |

验收轮追加（2026-10-21，作者：验收者（Claude Opus 5.5）；人类可推翻）：

| 决策 | Rationale |
|---|---|
| D11 单个越界的 CLI 行为钉在用例 7 的部分安装一步里，不新开用例；TD-088、TD-089 与 README 的不受保护范围补上「把测试文件当脚本运行」；不实现哨兵，D9 维持待人类决定；`invokedDirectly()` 保留与 `scripts/run-test-layer.mjs` 相同的写法 | 部分安装与「全部越界」「补齐安装」共用同一夹具和同一条 CLI 命令，放在同一用例里只多 7 行，标题 1–9 与 Validation 表的用例编号都不变；它杀死 M19，且对正确实现 9/9 绿。脚本方式运行是 `release-gates.md` 现行的回读写法，不写进去，TD-088 的范围就比事实小，读者会以为只有 `--test` 有缺口。哨兵与收窄 #186 的取舍不因本轮新事实改变，仍是 D9 的人类决定。`invokedDirectly()` 的 `catch` 分支在测试里到不了（`argv[1]` 总是真实存在的文件），但去掉它会让从 `node -e` 带参数导入时直接崩溃，且两份脚本写法分叉，收益不抵 |

协调收尾追加（2026-10-21 18:01 +08，Codex）：

| 决策 | Rationale |
|---|---|
| D12 PR #391 使用 `Refs #186`，保持 #186 开放；以现有 pnpm 入口能力交付供人类评审 | 官方 Node 模块查找文档与 pnpm worktree 指南均要求每个检出独立解析和安装；本轮实读 https://nodejs.org/api/modules.html#loading-from-node_modules-folders 与 https://pnpm.io/git-worktrees。`&&` 前置是现有 `engines >=22` 下显式、无额外外部状态的运行入口。保留 D9 对直接 Node 绕过路径的事实和 TD-088，不代替人类接受验收收窄，也不以已知缺口关闭原 issue。当前只对本 PR 的 pnpm 能力闭环归档，后续直接 Node 的完整保护仍由 #186 跟踪。 |
| D13 根级解析不等于所有包内解析：限定证据并保留 #186 | 独立验收者以根 foo/bar 都指向本地、`packages/foo/node_modules/@harness-projects/bar` 指向兄弟检出的夹具复现：`findStrayResolutions(root)` 返回空，foo 内加载 bar 却得到兄弟标记。根的解析起点不能证明子包起点；同样适用于测试子目录 shadow。保留当前无第三方依赖的根解析前置闭环，将这条盲区写进 README、TD-088 和 PR 风险，不以 pnpm 已覆盖所有上下文为完成声明，也不关闭 #186。进一步覆盖应按实际导入上下文设计与验收，不能靠再加一个根前缀断言。 |

## Idempotence and Recovery

- 守卫只读、无副作用，任意次重跑结果只取决于当前 `node_modules`；scratch 树可随时删掉重建（`/bin/rm -rf <scratch>/outer` 后按 Plan of Work 开头重做）。
- 变异由 `scripts/review-mutate.mjs` 按字节还原；退出码 2 或 130 时结论作废，先 `git status --short` 确认工作树干净再重跑。
- 检出依赖坏了：`pnpm install --frozen-lockfile --offline`，失败去掉 `--offline`；再跑 `node scripts/resolution-check.mjs`（期望静默 `0`）。
- 改写历史前 `git branch backup/worktree-resolution-guard-<时间> HEAD`；出错 `git reset --hard <backup>`。

## Interfaces and Dependencies

- `findStrayResolutions(root: string): Array<{ name: string; resolved: string | null; reason: 'outside-root' | string }>`；根 manifest 不可读或无 `@harness-projects/*` 时抛错。
- CLI `node scripts/resolution-check.mjs`：退出 0 静默；退出 1 时 stderr 首行以 `resolution-check:` 开头，含 `<name> -> <落点或错误码>` 与 `pnpm install --frozen-lockfile`。
- 依赖：Node `>=22`、pnpm 10.28.2（`packageManager`）的参数追加行为、`gh` CLI（`-R SingularityKChen/harness-projects`）、`scripts/review-mutate.mjs`。无凭据、无网络。
- 技术债：`docs/exec-plan/tech-debt-tracker.md` 的 TD-088（直接 `node --test` 单个文件或 `tests/mvp0`、`tests/integration`、`tests/e2e` 目录不经守卫，及各无标志办法的代价与下一步）、TD-089（仍需迁移两份架构/产品文档的取证命令；MVP-0 README 已在本轮纠正）。正文只写在 tracker，这里不复述。

## Outcomes & Retrospective

实施尚未开始（2026-10-21 15:05 +08）。Batch 4 回填实际规模（`node scripts/rule-checks.mjs size origin/main`）、变异结果、与本计划的偏差和遗留问题。Superseded by 下面的验收轮回填（2026-10-21）。

验收轮回填（2026-10-21，验收者（Claude Opus 5.5），检出 `test/worktree-resolution-guard`，起点 3ffce801 加本轮提交）：

- 实际结果：`scripts/resolution-check.mjs`（导出 `findStrayResolutions` 加 CLI）与 `tests/contract/resolution-check.test.js` 的 9 条用例；根 `package.json` 的 `test`、`test:contract`、`test:mvp0`、`boundaries` 前置守卫，新增 `test:file`；`tests/README.md` 的手工两步换成守卫说明。未装依赖的嵌套检出里 pnpm 的五个测试入口都在跑用例前退出 1 并逐包列出落点，已安装检出与单检出静默通过；变异表 M1–M19 与独立验证者、验收者的追加变异全部 KILLED（见 Validation 表第 6 行与 Progress「验收轮」）。
- 规模（观察时刻 2026-10-21 16:50 +0800，回读 `node scripts/rule-checks.mjs size origin/main`）：代码 324 / 1000，文档 228 / 1500（head 为本轮回填提交）；守卫脚本 88 行、测试 227 行，都比计划估算（约 60、约 110）多，原因是 D8 的错误收口、用例 9 与两包夹具、部分安装一步。
- 与计划的偏差：D8（CLI 收口函数抛错）是实施期追加；F2、F3 让用例从 8 条变 9 条、夹具从单包变两包；F3 的修复又让 N7 复活，验收轮补部分安装一步（M19）；TD-088、TD-089 提前到验证修复轮登记（D10），验收轮补全措辞；Batch 1（推送、开 draft PR）至当时验收轮结束仍未执行；Superseded by Progress 的 2026-10-21 18:01 +08 回读；四个实现与修复提交的 `Co-Authored-By` 写的是实际作者模型 Claude Sonnet 5.5。
- 当时验收轮遗留问题（关闭关系 Superseded by D12，2026-10-21）：(1) D9 待人类决定是否把 #186 的验收收窄到「pnpm 入口加含用例 1 的 `node --test` 运行」，这决定 PR 正文用关闭关键字还是 `Refs`；(2) TD-088、TD-089；(3) 归档到 `docs/exec-plan/completed/`、`docs/README.md` 索引行、提交整合、推送与 PR 回读由协调者做。

协调收尾结果：在 `test/worktree-resolution-guard` 的 worktree 根目录重新执行 `pnpm install --frozen-lockfile` 和 `pnpm verify` 均退出 0；rebase 的实现文件与备份逐字节相同。原生 Node 绕过仍按 TD-088/089 公开，不声称 #186 全范围完成。提交整合、机械扫描和最终 PR head 的回读规则仍按 Batch 4 执行。

## Bottom Change Note

- 2026-10-21 15:05 +08 独立评审者：嫁接两份独立设计并按复现与原型定稿首版。
- 2026-10-21 15:54 +0800 实现者：Batch 2 完成，Progress 记录先红后绿读数；Decision Log 追加 D8（CLI 的错误收口）。
- 2026-10-21 15:57 +0800 实现者：Batch 3 完成，Progress 记录接线先红后绿、内层树五个入口的读数与 M1–M13 初跑结果。
- 2026-10-21 16:21 +0800 修复者：验证修复轮 F1–F4。新增用例 9、用例 2/7 夹具改两个包，变异表扩到 M1–M18；口径订正（D7 前提、Surprises 一条、Design 已知边界、README）并写入 D9、D10；Batch 4 的用例数、变异数、tracker 步骤随之改；TD-088、TD-089 提前登记。
- 2026-10-21 16:50 +0800 验收者（Claude Opus 5.5）：独立验收。按原始条件复跑 F1–F4；发现 F3 的修复让 N7 复活，用例 7 加部分安装一步并把它记为 M19；不受保护范围补「把测试文件当脚本运行」（Design 已知边界、README、TD-088、TD-089）；Validation 表写入判定证据并加第 6 行；回填 Progress「验收轮」、Surprises 两条、D11、Outcomes；Batch 4 的变异步骤与旧 Outcomes 就地标注 Superseded。

- 2026-10-21 18:01 +08 Codex：回读 draft 与 live issue；备份后 rebase 到当前 main，保留 tracker 两侧事实并比对实现文件；复跑安装和完整验证；D12 将关闭关系改为 Refs，保留 #186，归档 pnpm 入口交付而不替人类收窄原 issue。

- 2026-10-21 18:12 +08 Codex：采纳交叉验收发现的包级 shadow 反例，原处推翻“只需查根”的全称结论；D13、TD-088、测试说明与 PR 风险明确根解析前置的证据边界，#186 保持开放。

2026-10-22 修复记录：七条P2/P3全部核实，D9事实纠正、D13与tracker表格修复、require.resolve前提和solo未安装CLI反例、layer-runner绕过范围、MVP-0文档区别均已落实。目标11/11、含文档契约20/20、完整verify1819+7全绿；三个归因变异全KILLED，前后基线与原文字节恢复确认。独立复评APPROVE，20/20及三个临时副本变异全KILLED，GFM和前缀零匹配反例复核成立；新head远端门禁在发布后重锁，#186保持OPEN。

2026-10-22修复并集证据：在独立检出`test/repair-queue-pr388@7e5ab3d6a8093a3521a8d759c5b8a7a9507c2b52`先执行真实pack:plugin，随后CI=true pnpm verify为1886+7、fail0。四PR产品输入及清单指纹见各自评审记录；该记录不继承到之后变基的新head，最终发布仍回读CI、threads与原生issue关联。
