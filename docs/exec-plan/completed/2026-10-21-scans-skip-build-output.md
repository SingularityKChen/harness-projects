# 源码扫描不计被忽略的构建产物 ExecPlan

> 状态：Completed
> 创建：2026-10-21
> 范围：`tests/` 下遍历 `packages/`、`apps/` 的源码扫描改为按根 `.gitignore` 剪枝，并补一条构建后的回归测试；不改插件构建，也不改任何生产代码（issue #350）
> 上游输入：issue #350（它阻塞 #230）；`docs/review/pr-301-mmp-review.md` 第三轮 P2（同类缺陷的先例）；协调者转交的两份独立设计（未入库），取舍收敛在本文 Design / Spec 与 Decision Log

## Purpose / Big Picture

完成后，本机跑过 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`，被忽略的 `apps/harness-plugin/dist/` 留在原地时，`pnpm verify` 仍然通过。扫描看到的源码集合与 CI 干净检出一致；被跟踪的源码里真出现第二个写调用点，扫描照样失败。

最小成功证据有三条：`dist/` 在位时 `pnpm verify` 退出码 0；集成测试 I1 在临时目录真实构建，并带阳性、阴性两个对照；真实树变异 R1 变红，且只多报植入的那一处。

## Context and Orientation

病根在 `tests/e2e/delivery-lineage.test.js` 第 369–370 行。模块级的 `sources` / `callers` 递归 `packages/`、`apps/`，只排除了 `node_modules`。打包产物 `dist/package/lib/index.js` 里打进了 Core，五个调用点模式全部命中，于是「唯一写者」多出 `harness-plugin/dist/package/lib/index.js`。`tests/contract/run-test-layer.test.js` 的「真实层 tests/e2e」会真跑 e2e 层，跟着一起红。

评审者的复现：2026-10-21，在 `test/scans-skip-build-output@5a92c40a` 的本地克隆里先跑 `pack:plugin`。之后 typecheck 退出码 0；三层测试 `ℹ fail 2`，红的只有上面两条；`test:mvp0` 7 / 7。

扫描点盘点（`tests/`、`scripts/` 下全部 `readdir*` 调用逐个读过）：

| 扫描点 | 现状 | 会被 `dist/` 污染 | 处置 |
|---|---|---|---|
| `delivery-lineage` 的 `sources` | 递归，只跳 `node_modules` | **是** | Batch 1 迁到共享 helper |
| `host-node-types` 的 `packageDirectoriesOnDisk` | 递归、找到包根就停，手写 `NOT_PACKAGES` | 否（#301 已修） | Batch 2 改读共享名单 |
| `package-boundaries` 的 `findPackageDirs` | 两层、找到包根就停；只跳 `node_modules`，第二层什么都不跳 | 否（`apps/harness-plugin` 自带清单，就此停下） | 延后到 TD-087（D5：避开 PR #388 正在修改的同一文件；#355 是 issue） |
| `package-boundaries` 的 `sourceFiles` | 只扫 `<pkg>/src`，手写跳过 `node_modules`、`dist` | 否 | 延后到 TD-087（同上；承接 issue #396） |
| 其余扫描（见下） | 只扫 `src`、单层目录、`docs/`、workflows、`tests/<layer>` 或 mkdtemp | 否 | 不动 |

「其余扫描」包括：`package-boundaries` 第 344 行、`development-local-git-source`、`ui-model-presentation`、`board-status-semantics`、`plan-facts-consistency`、`e1-evidence-consistency`、`merge-gate-workflow`、`scripts/{policy-check,workflow-check,run-test-layer}.mjs`，以及 `harness-plugin-artifact`、`harness-plugin-host-providers`、`storage-*` 这几个集成测试。

相关事实：
- 仓库只有根目录一份 `.gitignore`，裸目录规则有 `node_modules/`、`dist/`、`build/`、`coverage/` 等；`tsconfig.json` 已排除 `**/dist`；`tests/fixtures/` 是三层测试共用的中立目录。
- `apps/harness-plugin/scripts/build.mjs` 导出 `build({ outDir })`，缺省写到 `apps/harness-plugin/dist`；构建到临时目录约 50 ms。

## Design / Spec

新增 `tests/fixtures/source-tree.mjs`：同步实现，只用 `node:fs` 和 `node:path`，不调用 git，每个函数都接受根目录参数。

- `ignoredDirectoryNames(root): Set<string>`：读取 `<root>/.gitignore`，每行 trim 后只收 `/^([\w.-]+)\/$/` 形式的裸目录规则。按 gitignore 语义，这类规则匹配任意深度的同名目录。锚定、通配、取反、注释和带路径的规则都不收，对应目录照常扫描：宁可多扫，不可少扫。文件缺失时抛错。Superseded by Surprises & Discoveries 的「F3」条目（2026-10-21）：逐行解析改成 git 的做法，不再 `trim()`——只去一个行尾 CR 和行尾空格，行首空白保留（`  dist/` 不是规则），开头的 BOM 忽略；末段名字被任一 `!` 规则点到的目录名整个不收。Superseded by Surprises & Discoveries 的「取反末段带通配」条目（2026-10-21）：取反规则只看末段，其中的 `*`、`?`、`[…]` 都当任意字符做宽松匹配，末段匹配到的目录名整个不收；普通字符按字面比较。 Superseded in part by D15（2026-10-21）：取反含闭合方括号时不再近似匹配，直接停止全部剪枝。
- `listSourceFiles(root, scopes): { scope, file }[]`：逐层 `readdirSync(dir, { withFileTypes: true })`，遇到被忽略的目录名就整棵剪掉。只收扩展名匹配 `/\.[cm]?[jt]sx?$/` 的普通文件，覆盖既有 package-boundaries / local-git 扫描集合。符号链接不下钻；C4 在 Git 检出中显式拒绝扫描范围内被跟踪的 symlink，避免扫描面悄悄比旧递归遍历窄；scope 缺失时抛错。`file` 是相对 scope 的 posix 路径。
- `callSites(root, scopes, pattern): string[]`：返回内容命中 `pattern` 的 `file`，已排序，形如 `core/src/delivery-facts.ts`，与旧的 `callers` 一致。
- **状态拥有者**：已提交的根 `.gitignore` 是「什么算构建产物」的唯一来源。helper 没有模块级状态。
- **少扫方向的兜底**：C4 在 Git 检出中用 `git ls-files -z -co --exclude-standard` 作为 oracle，核对 Git 不忽略且磁盘上存在的源码 ⊆ 遍历结果，因此覆盖 tracked 与 untracked、根与子目录 `.gitignore`、`core.ignorecase` 规则；C5 覆盖未暂存删除/改名、skip-worktree 与 force-add。大小写不敏感文件系统按 `realpathSync.native` 规范磁盘实际路径后比较。C4 另用 index mode 检出 scopes 内 tracked symlink 并断言集合为空；helper 不跟随 symlink，以避免 escape / cycle。
- **被放弃的方案**：
  - 设计 1 的 `git ls-files -co --exclude-standard` 加非 git 回退：见 D1。
  - 引入 `ignore` 包：要改锁文件，而这里只需要目录名这一个维度。
  - 只给 `delivery-lineage` 补一个 `dist`：名单会继续在多处各自漂移。
  - 新增 CI lane 先打包再测：牵动 W1–W7，而 I1 已能复现同一状态。
  - 合并两份包根发现（设计 1 的 `packageDirsOf`）：见 D3。

## Global Constraints

- **改动文件集合**（唯一声明处）：
  - 新增：`tests/fixtures/source-tree.mjs`、`tests/contract/source-tree.test.js`、`tests/integration/source-scan-build-output.test.js`，以及本 ExecPlan。
  - 修改：
    - `tests/e2e/delivery-lineage.test.js`：只动第 7 行导入和第 369–370 行。
    - `tests/contract/host-node-types.test.js`。
    - `tests/README.md` §3、`docs/development/workflow.md` §4。
    - `docs/exec-plan/tech-debt-tracker.md`：维护 TD-086–087；归档时更新自身来源（D14），Batch 7 按协调者委派扩充 TD-086 的 helper 语义限制，并更新 TD-087 的承接 issue 为 #396。
    - `docs/review/pr-390-mmp-review.md`：精炼记录初始矩阵、九条意见、修复、验证和边界。
    - `docs/README.md`：只添加本计划的 Completed 索引（D14）。
  - **不改**：
  - `docs/README.md`（协调者统一加索引）。Superseded by D14（2026-10-21）：此次独立验收委派明确授权归档本计划、维护其索引与技术债来源链接。
  - tracker 的任何既有行，尤其是 TD-054。
  - `apps/`、`packages/` 下任何文件，含 `apps/harness-plugin/scripts/build.mjs`。
  - 在途 PR 的文件：
    - #371：`packages/controller/src/commands.ts`、`packages/core/src/{index,workspace-setup}.ts`、`docs/product/vertical-path.md`。
    - #372：`apps/harness-plugin/src/*`、`apps/web/src/index.ts`、`packages/{client,ui,ui-model}/src/*`、`tests/integration/harness-plugin-artifact.test.js`、ADR-0009/0010。
    - #373：`packages/{core,client}/src/*`、`packages/controller/src/wire.ts`、ADR-0015。
  - 其余：`docs/adr/`、`.gitignore`、`package.json`、`pnpm-lock.yaml`、`.github/workflows/`、`scripts/`。
- **其他约束**：
  - 不新增依赖，不写兼容层。
  - git 只在 C4 中以 argv 形式调用，不写 `git config`。Superseded by D7（2026-10-21）：C5、C5b 也以 argv 调用 git，但只在各自 mkdtemp 的新仓库里执行 `init`、`add`、`update-index`，环境同样去掉 `GIT_*`，不写任何 `git config`。
  - 正文用中文，不写本机绝对路径。

## Plan of Work

实现用 Sonnet，最终对抗验收与重构用 Opus。除非另有说明，命令都在检出 `test/scans-skip-build-output` 的工作树（`.worktrees/scans-skip-build-output`）根目录运行。提交序列：`docs(exec-plan)` 规划 → `test(tests)` Batch 1 → `refactor(tests)` Batch 2 → `docs(tests)` Batch 3 与回填；提交正文写 `Refs #350`，PR 描述写 `Closes #350`。

### Batch 0 · 对齐与红基线

- [x] 跑 `git fetch origin && git merge --ff-only origin/main`。分支还没有自己的提交。
- [x] 跑 `pnpm install --frozen-lockfile --offline`。`node_modules/@harness-projects/core` 应指向 `../../packages/core`。
- [x] 跑 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin && node --test tests/e2e/delivery-lineage.test.js`。期望 `ℹ fail 1`，「唯一写者」的 actual 多出 `harness-plugin/dist/package/lib/index.js`。把读数记入 Progress。

### Batch 1 · 共享 helper 与 delivery-lineage 迁移（闭环，关闭 #350）

- **最小闭环**：`dist/` 在位时，扫描只报被跟踪的写者；构建后的回归测试进入 `pnpm test`。
- **涉及文件**：`tests/fixtures/source-tree.mjs`、两个新测试文件、`tests/e2e/delivery-lineage.test.js`。
- [x] 先写 helper 骨架，让 `ignoredDirectoryNames` 固定返回 `new Set(['node_modules'])`，复现旧行为，用来先红。
- [x] 写 `tests/contract/source-tree.test.js`。每个用例的 mkdtemp 夹具都自带 `.gitignore`：
  - **C1**「不计 .gitignore 忽略目录里的调用点（深度不限）；被跟踪与新建源码里的第二个调用点仍被找到」。夹具：`packages/core/src/{writer,other}.ts`、`apps/a/src/caller.ts`、`apps/x/dist/package/lib/index.js`、`packages/core/node_modules/dep/index.js`、`packages/core/build/gen.ts`、`packages/core/README.md`，都含 pattern；scopes 取 `['packages', 'apps']`（与 `delivery-lineage` 同序，排序缺失才可见）。期望恰为 `['a/src/caller.ts', 'core/src/other.ts', 'core/src/writer.ts']`。
  - **C2**「只认裸目录规则」：`/out/`、`tmp*/`、`!keep/`、`*.local`、`# gone/`、`src/gen/` 都不剪枝，集合恰好等于期望。
  - **C3**「缺 `.gitignore` 或缺 scope 时抛错」。
  - **C4**「真实检出里 git 跟踪的 `packages/`、`apps/` 源码全部出现在遍历结果里，且跟踪集合非空」。用 `git ls-files -z`，环境变量去掉 `GIT_*`；`git rev-parse --show-toplevel` 的 realpath 不是仓库根时 `t.skip`。
- [x] 写 `tests/integration/source-scan-build-output.test.js` 的 **I1**：
  - 准备：在 mkdtemp 根下复制真实 `.gitignore`，写入含 `.putDeliveryFacts(` 的 `packages/core/src/delivery-facts.ts`，再执行 `build({ outDir: <tmp>/apps/harness-plugin/dist })`。
  - 阳性对照：产物 `lib/index.js` 含 `.putDeliveryFacts(`。
  - 主断言：`callSites` 只返回 `['core/src/delivery-facts.ts']`。
  - 阴性对照：`.gitignore` 改成只有 `node_modules/` 后，产物成为第二个调用点。
- [x] 跑 `node --test tests/contract/source-tree.test.js tests/integration/source-scan-build-output.test.js`，期望 C1、C2、C3、I1 红（C4 在骨架下也绿，属预期）。实现解析后再跑同一命令，期望 `ℹ fail 0`。
- [x] 改 `delivery-lineage`：删掉 `readdirSync`、`readFileSync` 导入；第 369–370 行换成 `callers = (pattern) => callSites(repoRoot, ['packages', 'apps'], pattern)`，其中 `repoRoot = fileURLToPath(new URL('../../', import.meta.url))`。
- **验证**（`dist/` 在位）：`node --test tests/e2e/delivery-lineage.test.js` 期望 `ℹ fail 0`；`node scripts/run-test-layer.mjs tests/e2e "e2e 链路"` 期望退出码 0。
- **回滚**：`git revert` 本批提交。本批只动测试。

### Batch 2 · 手写名单改读共享来源（可整批裁掉，#350 仍然闭环）

- **涉及文件**：`tests/contract/host-node-types.test.js`（`tests/contract/package-boundaries.test.js` 不改，见 D5）。
- [x] `host-node-types`：
  - 先红：夹具写入 `.gitignore`（`node_modules/`、`dist/`、`build/`），再加一个 `apps/a/build/package/package.json`。旧名单不含 `build`，用例变红。Superseded by Surprises & Discoveries 的 Batch 2 夹具条目（2026-10-21）：`apps/a` 是包根，walk 不会下钻，这条夹具在旧名单下仍是绿的；实际用的是分组层的 `packages/build/stray/package.json`。
  - 转绿：删掉 `NOT_PACKAGES`，改用 `ignoredDirectoryNames(root)`。
  - 同步改写文件头里对 `package-boundaries` 的描述。
- **验证**：`node --test tests/contract/host-node-types.test.js` 与 `pnpm run boundaries` 都期望 `ℹ fail 0`。
- **回滚**：本批单独一个提交，可以单独 revert。

### Batch 3 · 文档、整树验收与收尾

- **涉及文件**：`tests/README.md`、`docs/development/workflow.md`、tracker、本计划。
- [x] `tests/README.md` §3 加一条规则：遍历 `packages/`、`apps/` 的扫描一律经 `tests/fixtures/source-tree.mjs`。
- [x] `workflow.md` §4 加一句：`pack:plugin` 之后可以直接 `pnpm verify`。
- [x] 在最终树上整表重跑验收与变异（2026-10-21 16:30 +0800，Batch 4）。
- [x] 追加 TD-086、TD-087，回填 Progress 和 Outcomes（2026-10-21 16:30 +0800，Batch 4）。
- **验证**：`dist/` 在位时 `pnpm verify` 退出码 0；`node scripts/rule-checks.mjs size origin/main` 与 `node scripts/rule-checks.mjs disclosure origin/main` 通过；`git diff --check origin/main...HEAD` 无输出。
- **回滚**：revert 文档提交。

### Batch 4 · 独立验证发现 F1–F4 的处置（闭环：验证者复现的本地误红与少扫都被判别用例钉住）

- **涉及文件**：`tests/contract/source-tree.test.js`、`tests/fixtures/source-tree.mjs`、`tests/contract/host-node-types.test.js`、tracker、本计划（文件集合见 `Global Constraints`，未越界）。
- [x] F1：C4 抽成接受根目录的 `trackedSourcesMissedByWalk(root, scopes)`，只数磁盘上确有的普通文件；新增 **C5**（未暂存的删除、改名、skip-worktree 不报，force-add 进被忽略目录的文件仍报）与 **C5b**（被跟踪的符号链接不报）。
- [x] F3：`ignoredDirectoryNames` 按 git 的行语义解析；新增 **C2b**（行首空白、行尾制表符、整体与按路径取反、CRLF 与行尾空格、BOM）。
- [x] F4：C1 夹具加 `apps/dist/top.js`（scope 顶层的被忽略目录）；新增 **C6**（符号链接目录与文件都不计）；C2b 含 CRLF。
- [x] F2：登记 TD-086、TD-087，回填 Progress 与 Outcomes。
- [x] 整表变异在最终树上重跑（`scripts/review-mutate.mjs`，spec 在运行态目录，不入库）：35 个变异全部 APPLIED 且 KILLED，归因正确，跑完工作树干净。整表含 H1–H7、验证者增补的 N1–N12、新增的解析面 P1–P7 与比较面 F1a–F1d、B1、B2；N12 在首次整表里存活，见 Surprises。
- **验证**：`node --test tests/contract/source-tree.test.js tests/integration/source-scan-build-output.test.js tests/contract/host-node-types.test.js` 期望 `ℹ fail 0`；`pnpm verify`（`dist/` 在位，以及把 `packages/core/src/bootstrap.ts` 改名而不暂存的状态）期望退出码 0。
- **回滚**：本批代码与文档各一个提交，可以分别 revert。

### Batch 5 · 最终验收与重构（闭环：既往发现按原条件复跑，修复本身独立复评，最终树整表验收）

- **涉及文件**：`tests/fixtures/source-tree.mjs`、`tests/contract/source-tree.test.js`、本计划（文件集合见 `Global Constraints`，未越界）。
- [x] F1–F4 按验证者的原始条件在当前 head 复跑（F1 用 IDE 式改名加 `pnpm verify`，不只跑修复者的反例）。
- [x] 修复本身独立复评：用 `git check-ignore` 做差分对照，发现取反末段带通配仍少扫；先在 C2b 加用例跑红，再改 helper 转绿（见 Surprises、D11）。
- [x] C4 的扩展名正则注明有意独立（D12）；helper 头注释与实现对齐。
- [x] 最终树整表变异：fixer 表 35 个（P6、P7 锚点随代码更新）、验证者 N13（锚点随代码更新）、新增 W1–W7，共 43 个。
- [x] R1–R3 在临时克隆里重跑；base 对照；与当前 `origin/main` 的并集验证。
- **验证**：`node --test tests/contract/source-tree.test.js tests/integration/source-scan-build-output.test.js tests/contract/host-node-types.test.js tests/e2e/delivery-lineage.test.js` 期望 `ℹ fail 0`；`node scripts/review-mutate.mjs <spec> --root .` 期望退出码 0（spec 在运行态目录，不入库）；`pack:plugin` 后 `pnpm verify` 与删掉 `dist/` 后的 `pnpm verify` 都期望退出码 0。
- **回滚**：本批代码与文档各一个提交，可以分别 revert；代码提交只动 helper 的取反解析与 C2b 的用例，revert 后回到 Batch 4 的行为。

### Batch 6 · 新一轮独立对抗验收与归档

- **涉及文件**：helper、`source-tree` 契约、本计划及归档索引和 TD-086–087 的来源链接（集合见 `Global Constraints`）。
- [x] 官方 Git 文档核对字符转义与 fnmatch 字符类；C2c 以真实 `git check-ignore -q` 的退出码 1 为独立判据，先红后修。
- [x] 未支持的取反语法（反斜杠、嵌套字符类）停止全部剪枝，不继续补齐解析器；保留 C2b 的普通文件取反精度。
- [x] `pack:plugin` 后连续两次全量验收；共享变异工具重跑 U1、U2、R1（带 `killedBy`）；512 条规则与 Git 差分对照。
- [x] 归档本计划，更新索引与自身技术债来源；提交后由协调者统一 rebase、整合和远端回读。
- **验证**：在 `test/scans-skip-build-output` 根目录运行 `node --test tests/contract/source-tree.test.js tests/integration/source-scan-build-output.test.js tests/contract/host-node-types.test.js tests/e2e/delivery-lineage.test.js`，期望 51 条全绿；`node scripts/review-mutate.mjs .superpowers/pr390-final-mutations.json --root .` 期望 3 / 3 KILLED（运行态 spec 不入库）。
- **回滚**：本批修复独立 revert；只影响测试扫描，生产代码不变。

### Batch 7 · 交叉评审修复本身：字符类首位右括号

- **涉及文件**：helper、`source-tree` 契约、本计划和自身 TD-086；其余文件不动。
- [x] 交叉评审在 Batch 6 修复中再发现同根少扫：C2c 增三条字面右括号的 Git 判据，旧 helper 下先红；随后补五条取反 / 范围组合。
- [x] 取反含任意先左后右的闭合方括号时，停止全部剪枝；移除字符类近似转换，不实现 fnmatch。未闭合左括号仍按字面比较；普通文件取反 `!*.local` 不扩大扫描。
- [x] 四文件窄回归、恢复旧近似的变异、`pack:plugin` 后一次 `pnpm verify` 均重新运行；不沿用 Batch 6 的旧计数，不重跑旧随机矩阵。
- **验证**：`node --test tests/contract/source-tree.test.js tests/integration/source-scan-build-output.test.js tests/contract/host-node-types.test.js tests/e2e/delivery-lineage.test.js` 期望 51 / 51；`node scripts/review-mutate.mjs .superpowers/pr390-closed-class-mutation.json --root .` 期望 1 / 1 KILLED；pack 后 verify 期望退出码 0。
- **回滚**：本批独立提交可 revert；不会改变生产代码。

### Batch 8 · PR #390 修复复评

- **涉及文件**：`tests/fixtures/source-tree.mjs`、`tests/contract/source-tree.test.js`、`tests/integration/source-scan-build-output.test.js`、`docs/exec-plan/tech-debt-tracker.md`、本计划、`docs/README.md`、`docs/review/pr-390-mmp-review.md`。
- [x] 扩大 C4 Git oracle 至 tracked + untracked 且非 ignored 的源码；加入大小写不敏感重命名、nested `.gitignore` 取反、`core.ignorecase`、tracked symlink 与扩展名夹具。
- [x] I1 从 `apps/harness-plugin/package.json` 的 `pack:plugin` 实际 `--dir …/package` 参数推导输出目录，并断言该目录名被根 `.gitignore` 覆盖；不修改 `apps/` 构建脚本。
- [x] 修正 TD-086/087 表格、#355 issue 与 PR #388 的区分，TD-087 承接 issue #396；修正 U+2028/U+2029 的 Progress、Surprises、D15 supersession 与 C2c 判据数。
- [x] 回填初始 P0–P3 矩阵及九条评论映射、TDD RED/GREEN、修复变异与边界。
- **验证**：在 `test/scans-skip-build-output` 根目录运行 `node --test tests/contract/source-tree.test.js tests/integration/source-scan-build-output.test.js`，期望 13/13；`node scripts/review-mutate.mjs <review-spec.json>`，期望 5/5 KILLED 且还原后基线通过；然后运行 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`、`pnpm verify` 与对应边界/文档/披露/规模/diff 检查。
- **回滚**：仅撤销 Batch 8 的测试与文档变更；不改生产行为、依赖或 schema。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| A1 | `pack:plugin` 产出 `dist/` 后 `pnpm verify` 通过 | 具名测试：`tests/integration/source-scan-build-output.test.js` 的「I1 pack:plugin 的 dist/ 在位时……」（CI 上每个 PR 都跑，带阳性、阴性对照）与 `tests/e2e/delivery-lineage.test.js` 的「唯一写者」。变异：H1-I1 被 I1 杀死。命令：`pnpm --filter @harness-projects/app-harness-plugin pack:plugin && pnpm verify`，期望退出码 0；同一 `dist/` 下把 `delivery-lineage` 换回 `origin/main` 的版本，期望「唯一写者」红并多报 `harness-plugin/dist/package/lib/index.js`（Batch 0、Batch 5 都复现过） |
| A2 | 被跟踪源码里真有第二个写调用点时仍失败（变异证据） | 具名测试：C1、「唯一写者」、C4。变异：R1、R2 被「唯一写者」杀死且只多报植入的那一处；R3 被 C4 杀死；H1–H7、N5、N10、N11 被 C1 等杀死；H4-C4、N8 被 C4 杀死 |
| A3 | 遍历扫描已盘点；会被 `dist/` 污染的一处与 `host-node-types` 统一到同一来源，`package-boundaries` 两处登记 TD-087 | Context 的盘点表；具名测试 `host-node-types` 的「磁盘扫描只数包根……」，变异 B1、B2、N12 都被它杀死；`grep -c '^| TD-08[67] ' docs/exec-plan/tech-debt-tracker.md` 期望 `2` |
| A4 | 规模与发布面 | `node scripts/rule-checks.mjs size origin/main` 与 `node scripts/rule-checks.mjs disclosure origin/main` 期望退出码 0；`git diff --check origin/main...HEAD` 期望无输出 |
| A5 | 本机索引与工作树暂时不一致时不误红（验证 F1） | 具名测试：C5、C5b、C4。变异：F1a–F1d、N13。原条件复跑：未暂存的 IDE 式改名后 `pnpm verify` 期望退出码 0 |
| A6 | `.gitignore` 解析不比 git 少扫（验证 F3、F4 与 Batch 5） | 具名测试：C2、C2b、C6、C1。变异：N1–N4、N9、P1–P7、W1–W7。差分对照：随机取反规则与 `git check-ignore` 比较，期望少扫 0 条；C2c 覆盖字符转义与嵌套字符类，U1 / U2 证明 fallback 有判别力；Batch 7 的 C2c 与 F6 覆盖首位字面右括号 |
| A7 | C4 以 Git 可见源码为少扫 oracle，symlink 边界显式而不跟随 | C4 使用 `ls-files -co --exclude-standard`；C5 覆盖未跟踪改名；C5c 在不区分大小写卷验证 `realpathSync.native`；C5d 由 `git check-ignore` 核对 nested `.gitignore` 与 `core.ignorecase`，再断言 Git oracle 暴露 helper 漏项；C5b 验证 tracked mode `120000` 可见且真实树 C4 拒绝此扫描面；扩展名夹具覆盖 `.mts/.cts/.cjs/.jsx` |
| A8 | I1 绑定真实 `pack:plugin` 输出配置 | 从 `apps/harness-plugin/package.json` 解析 `--dir <output>/package`，断言 `<output>` 属于 `ignoredDirectoryNames(repoRoot)`；变异 M5 改成未忽略 `out` 后由 I1 杀死；不改 `build.mjs` |

变异规程：
- 每个变异先用 `git diff --stat` 或 `git status --short` 证明已经应用，再跑测试，最后还原并确认工作树干净。
- R1–R3 在同一 head 的临时克隆里做：`git clone --branch test/scans-skip-build-output <主检出> <临时目录>`，然后 `pnpm install --frozen-lockfile --offline` 和 `pack:plugin`。
- 删除用 `/bin/rm -f`，因为本机 `rm` 有交互别名。

| 变异 | 期望 |
|---|---|
| helper 变异 H1 清空剪枝集合；H2 接受通配或锚定；H3 缺 `.gitignore` 时返回空集；H4 额外剪 `src`；H5 去排序；H6 去扩展名过滤 | 依次被 C1+I1、C2、C3、C1+C4、C1、C1 杀死 |
| R1 被跟踪的 `packages/core/src/relations.ts` 追加 `.putDeliveryFacts(` | 「唯一写者」红，只多报 `core/src/relations.ts`（评审者原型已复现） |
| R2 新建未跟踪的 `packages/core/src/zz-second.ts`，内容含同一调用 | 红，多报该文件（原型已复现） |
| R3 `git add -f packages/core/dist/x.ts` | 「唯一写者」不变；C4 红并列出该文件（原型已复现） |
| B1 `host-node-types` 换回旧名单 | Batch 2 夹具用例红 |
| N1 去掉行尾归一、N9 下钻符号链接目录、N10 scope 顶层不剪枝（验证者增补，F4） | 依次被 C2b、C6（含 C5b）、C1 杀死 |
| P1–P7 解析面：保留 CR、保留行尾空格、`trim()` 两端、行尾任意空白、保留 BOM、忽略取反、只按完整名字取反 | 都被 C2b 杀死 |
| F1a–F1d 比较面：去掉「磁盘上确有」过滤、把符号链接当文件、排除 `dist/`、跟踪集合恒空 | 依次被 C5（含 C5b）、C5b、C5、C4（含 C5）杀死 |
| N12 `host-node-types` 的夹具读真实仓库根的 `.gitignore` | 夹具里只写进 root 的 `.gitignore` 的目录名没被剪，用例红 |
| N13 C4 的 `ls-files` 排除 `dist/` 下的路径（验证者增补，原判等价） | C5 的 force-add 夹具让它不再等价：被 C5 杀死 |
| W1–W7 取反末段：只认普通名字、`*` 不转换、`?` 不转换、字符类不转换、带通配的取反一律清空剪枝集合、普通字符不转义、未闭合的 `[` 不转义（Batch 5） | 都被 C2b 杀死 |

## Progress

- [x] 2026-10-21 15:05 +08：独立评审两份设计，核实事实，复现缺陷，跑通原型变异 R1–R3，定稿本计划。
- [x] 2026-10-21 15:55 +08：Batch 0 · 对齐与红基线。分支 `test/scans-skip-build-output` 已含 origin/main（`git merge-base --is-ancestor origin/main HEAD` 成立，协调者已快进）；`node_modules/@harness-projects/core` 指向 `../../packages/core`。在该分支（`02c9a35b`）上先 `pack:plugin`，再跑 `node --test tests/e2e/delivery-lineage.test.js`：`ℹ tests 36`、`ℹ pass 35`、`ℹ fail 1`，红的是「唯一写者」，actual 为 `['core/src/delivery-facts.ts', 'harness-plugin/dist/package/lib/index.js']`，多出的正是 `dist/` 产物。
- [x] 2026-10-21 15:55 +08：Batch 1 · 共享 helper 与 delivery-lineage 迁移。
  - 先红（`ignoredDirectoryNames` 固定返回 `new Set(['node_modules'])` 的骨架，在该分支上跑 `node --test tests/contract/source-tree.test.js tests/integration/source-scan-build-output.test.js`）：`ℹ tests 5`、`ℹ pass 1`、`ℹ fail 4`。C1 的 actual 多出 `core/build/gen.ts` 与 `x/dist/package/lib/index.js`；C2 的集合是 `['node_modules']` 而非 `['dist']`；C3 报 `Missing expected exception`；I1 的主断言多出 `harness-plugin/dist/package/lib/index.js`；C4 绿，符合计划。
  - 转绿（实现 `ignoredDirectoryNames` 后同一命令）：`ℹ tests 5`、`ℹ pass 5`、`ℹ fail 0`。
  - 迁移 `delivery-lineage` 后，`dist/` 在位：`node --test tests/e2e/delivery-lineage.test.js` 为 `ℹ tests 36`、`ℹ pass 36`、`ℹ fail 0`；`node scripts/run-test-layer.mjs tests/e2e "e2e 链路"` 退出码 0（175 条）；`pnpm run typecheck` 退出码 0。
  - 变异（`scripts/review-mutate.mjs`，helper 变异 H1–H7，每个都带 `killedBy`）：全部 KILLED 且归因正确，跑完工作树与跑前逐文件一致。H1 被 C1、C2、C3、I1 杀死；H2 只被 C2 杀死；H3 只被 C3 杀死；H4 被 C1、C2、C4、I1 杀死；H5、H6 只被 C1 杀死；H7（只在 scope 顶层剪枝）被 C1、C2、I1 杀死。
- [x] 2026-10-21 15:57 +08：Batch 2 · 手写名单改读共享来源（只迁移 `host-node-types`，D5）。
  - 先红（在该分支上跑 `node --test tests/contract/host-node-types.test.js`）：夹具写入 `.gitignore`（`node_modules/`、`dist/`、`build/`）并加 `packages/build/stray/package.json`，旧名单下 `ℹ tests 5`、`ℹ pass 4`、`ℹ fail 1`，红的是「磁盘扫描只数包根」，actual 多出 `packages/build/stray`。计划原写的 `apps/a/build/package/package.json` 在旧名单下是绿的，见 Surprises。
  - 转绿：删掉 `NOT_PACKAGES`，改用 `ignoredDirectoryNames(root)`，并改写文件头与函数注释对 `findPackageDirs` 的描述；同一命令 `ℹ pass 5`、`ℹ fail 0`；`pnpm run boundaries` `ℹ tests 9`、`ℹ pass 9`、`ℹ fail 0`（`dist/` 在位）。
  - 变异（B1 换回旧名单、B2 只跳 `node_modules`，`killedBy` 为「磁盘扫描只数包根」）：两个都 KILLED 且归因正确，工作树还原。B1 只被夹具用例杀死、真实树用例仍绿，因为旧名单恰好覆盖今天的真实 `.gitignore`；这说明夹具里的 `build/` 才是这批的判别力来源。
- [x] Batch 3 · 文档、整树验收与收尾（文档两处 2026-10-21 16:00 +08；整树验收、TD 登记与 Outcomes 在 Batch 4 完成，2026-10-21 16:30 +0800）
  - [x] 2026-10-21 16:00 +08：文档两处（`tests/README.md` §3、`docs/development/workflow.md` §4）。在检出 `test/scans-skip-build-output` 上，`dist/` 在位：`pnpm verify` 退出码 0（契约 + 集成 + e2e `ℹ tests 1705`、`ℹ pass 1705`、`ℹ fail 0`，`test:mvp0` 7 / 7，`skipped 0`）；`node scripts/rule-checks.mjs disclosure origin/main` 无命中；`git diff --check origin/main...HEAD` 无输出。
  - [x] 2026-10-21 16:30 +0800：整树变异复核（R1–R3、H1–H6、B1 在最终树上整表重跑）、TD-086 / TD-087 登记、Outcomes 回填：原写「留给验收者」，由 Batch 4 的修复者完成，结果见下条。
- [x] 2026-10-21 16:30 +0800：Batch 4 · 独立验证发现 F1–F4 的处置。除注明外，证据都在检出 `test/scans-skip-build-output` 上，代码提交 `daf54257`（基线 `e707d2f8`），`dist/` 在位。
  - **F1 属实**（C4 把未暂存的删除或改名报成漏扫）。在 `e707d2f8` 的检出里把 `packages/core/src/bootstrap.ts` 移走而不暂存，`node --test tests/contract/source-tree.test.js` 的 C4 红：actual `['packages/core/src/bootstrap.ts']`。先把 C4 抽成函数并补判别用例，在旧比较逻辑上跑：`ℹ tests 8`、`ℹ pass 5`、`ℹ fail 3`（C2b、C5、C5b）；C5 的 `missed` 多出 `gone.ts`、`renamed-from.ts`、`sparse.ts`，C5b 的 `missed` 为 `['packages/core/src/alias.ts']`。（第一次跑 C5 / C5b 红在夹具缺 `apps/`，那是 C3 的「缺 scope 抛错」，修夹具的 scope 之后才是这里的读数。）加上「磁盘上确有的普通文件」过滤后 C5、C5b 绿。验证者的改名复现在本分支上重放（改名 `bootstrap.ts` 并改四处导入，不暂存）：`pnpm verify` 退出码 0，`ℹ tests 1709`、`ℹ pass 1709`、`ℹ fail 0`，`test:mvp0` 7 / 7；还原后工作树只剩本批改动。sparse-checkout 的 skip-worktree 在 C5 里用 `git update-index --skip-worktree` 实测，不再是推断。
  - **F2 属实**（已知待办，不是实现缺陷）：追加 TD-086、TD-087（号段内手工追加，未运行 `update_tech_debt_tracker.py`），回填本节与 Outcomes。
  - **F3 属实**。临时仓库里逐项对照 helper 与 `git check-ignore`：修复前「行首空格」「行首制表符」「`dist/` 后 `!dist/`」「`dist/` 后 `!packages/p/dist/`」四行与验证者一致（git 不忽略、helper 剪掉），另测到第五种「`dist/` 加行尾制表符」同样少扫；CRLF、行尾空格、BOM、无结尾换行一致。修复后少扫方向的差异为 0，只剩 helper 多扫的两行（`**/dist/`，以及 `!dist/` 之后再 `dist/`），方向安全。C2b 修复前红（actual `['dist']`、expected `[]`），修复后绿。Superseded by Batch 5 的 Progress 条目（2026-10-21）：「差异为 0」只对上面这些写法成立，取反末段带通配（`!*/`、`!dis*/`、`![d]ist/`、`!d?st/`）在 `daf54257` 上仍少扫。
  - **F4 属实**（三个存活变异）。补 C1 的 `apps/dist/top.js`、C6、C2b 的 CRLF 之后，N1、N9、N10 都 KILLED，归因分别是 C2b、C6（另有 C5b）、C1。
  - **整表变异**（`scripts/review-mutate.mjs`）：第一次整表（N12 修之前）35 个里 34 个 KILLED，N12 SURVIVED；修后在 `daf54257` 上整表重跑 35 / 35 KILLED，归因正确，跑完 `git status --short` 为空。R1–R3 在 `test/scans-skip-build-output@daf54257` 的临时克隆里重跑（先 `pnpm install --frozen-lockfile --offline` 与 `pack:plugin`，基线 `delivery-lineage` 36 / 36）：R1 追加调用点后「唯一写者」红，actual 为 `['core/src/delivery-facts.ts', 'core/src/relations.ts']`；R2 新建 `zz-second.ts` 后红，actual 为 `['core/src/delivery-facts.ts', 'core/src/zz-second.ts']`；R3 `git add -f packages/core/dist/x.ts` 后 `delivery-lineage` 仍 36 / 36，C4 红，actual `['packages/core/dist/x.ts']`；三处都已还原。
  - **整树验证**：在该克隆里删掉 `dist/`（等价于 CI 的干净检出）跑 `pnpm verify` 退出码 0，`ℹ tests 1709`、`ℹ pass 1709`、`ℹ fail 0`，`test:mvp0` 7 / 7。工作树里 `dist/` 在位：`pnpm run typecheck` 退出码 0，`pnpm run boundaries` 9 / 9，`pnpm verify` 退出码 0（同一读数）。
- [x] 2026-10-21 16:46 +0800：Batch 5 · 最终验收与重构（验收者（Opus））。除注明外，证据都在检出 `test/scans-skip-build-output` 上；本批代码提交 `019aa371`，基线 `ac9299e8`。
  - **既往发现按原条件复跑**（在 `ac9299e8` 的临时克隆里，先 `pnpm install --frozen-lockfile --offline`，无 `dist/`）：
    - F1 已修。IDE 式改名：把 `packages/core/src/bootstrap.ts` 改成 `workspace-bootstrap.ts`，改四处导入，不暂存。之后 `pnpm verify` 退出码 0，`ℹ tests 1709`、`ℹ pass 1709`，`test:mvp0` 7 / 7。另外三种状态下 `node --test tests/contract/source-tree.test.js` 都是 `ℹ pass 8`、`ℹ fail 0`：删除被跟踪的 `packages/core/src/relations.ts` 而不暂存（最短复现）、被跟踪的符号链接、`git update-index --skip-worktree` 之后删除。
    - F2 已修。tracker 有 TD-086、TD-087 两行，各 11 列，追加在 Open Items 末尾。
    - F3 按原条件已修。验证者的四种写法与 `git check-ignore` 一致：行首空格、行首制表符、整体取反、按路径取反。
    - F4 已修。N1（锚点随代码改为 `const line = raw`）、N9、N10 都 KILLED，归因依次是 C2b、C6、C1。
  - **修复本身复评**：把 22 种 `.gitignore` 写法逐条与 `git check-ignore` 对照，`ac9299e8` 仍有 4 种少扫：`dist/` 之后跟 `!dis*/`、`!*/`、`![d]ist/` 或 `!d?st/`。1500 条随机取反规则的差分对照里，有 19 条少扫。
    - 先红：C2b 加通配取反与字面比较两组用例后，`node --test --test-name-pattern=C2b tests/contract/source-tree.test.js` 为 `ℹ fail 1`。首个失败是 `!*/`：actual `['dist']`，expected `[]`。逐条读数：`!dis*/` 得 `['build','dist']`（期望 `['build']`）；`![d]ist/` 加 `!b?ild/` 得 `['build','dist']`（期望 `[]`）；`!*.local` 得 `['dist']`，与期望一致，这一条钉的是精度。
    - 转绿：取反末段改为宽松匹配后，同一命令 `ℹ fail 0`。22 种写法里少扫 0 种，只剩两种多扫：`**/dist/`，以及 `!dist/` 之后再写 `dist/`。1500 条随机取反规则少扫 0 条，抛错 0 条。真实根 `.gitignore` 的剪枝集合与 `ac9299e8` 相同，共 13 个名字。
  - **整表变异**：工具是 `scripts/review-mutate.mjs`，`dist/` 在位，命令跑 `source-tree`、`source-scan-build-output`、`host-node-types` 三个文件。43 个变异全部 APPLIED 且 KILLED，`killedBy` 归因正确，退出码 0。跑完后 `git status --short` 只剩本批未提交的两处改动。
  - **R1–R3**（在 `019aa371` 的临时克隆里，`pack:plugin` 之后；基线 `delivery-lineage` 36 / 36）：
    - R1 actual `['core/src/delivery-facts.ts', 'core/src/relations.ts']`。
    - R2 actual `['core/src/delivery-facts.ts', 'core/src/zz-second.ts']`。
    - R3 之后，`delivery-lineage` 与 `source-tree` 合计 `ℹ tests 44`、`ℹ fail 1`，只有 C4 红，actual `['packages/core/dist/x.ts']`。
    - 三处都已还原。
    - base 对照：同一 `dist/` 下把 `delivery-lineage` 换回 `3391c01d` 的版本，`ℹ fail 1`，多报 `harness-plugin/dist/package/lib/index.js`。
  - **并集**：在临时克隆里把 `origin/main` 合进 `019aa371`，跑了两次，因为验收期间 `origin/main` 又前进了。每次都只有 tracker 冲突：两边都在 TD-068 之后追加，保留两边，先 main 的行，再 TD-086–087。每次都是先 `pack:plugin` 跑 `pnpm verify`，再删掉 `dist/` 跑一次。
    - 2026-10-21 16:45 +0800 观察，`origin/main` 为 `66870dfd`，比合并基 `3391c01d` 多 8 个提交：两次都退出码 0，`ℹ tests 1734`、`ℹ pass 1734`，`test:mvp0` 7 / 7。
    - 2026-10-21 16:52 +0800 观察，`origin/main` 为 `d7e7bca6`，多 11 个提交，main 一侧追加到 TD-078：两次都退出码 0，`ℹ tests 1770`、`ℹ pass 1770`，`test:mvp0` 7 / 7。重算：`git fetch origin && git merge-tree --write-tree --name-only origin/main HEAD`，期望退出码 1，冲突文件只列出 `docs/exec-plan/tech-debt-tracker.md`。
  - **最终树全量验证**（工作树，代码 `019aa371` 加本批文档改动）：
    - `pnpm run typecheck` 退出码 0。
    - 先删掉旧的 `dist/` 再跑 `pack:plugin` 重建，`dist/` 在位时 `pnpm verify` 退出码 0：`ℹ tests 1709`、`ℹ pass 1709`、`ℹ fail 0`、`ℹ skipped 0`，`test:mvp0` 7 / 7。
    - 删掉 `dist/` 再跑 `pnpm verify`，退出码 0，读数相同。
    - `pnpm run boundaries` 9 / 9；`node scripts/workflow-check.mjs` 无 findings（检查了 8 个文件）。
    - 在 `019aa371` 上，`node scripts/rule-checks.mjs size origin/main` 退出码 0，代码 340 / 1000，在本计划 800 行的弹性上限内。文档行数随本批文档提交变化，期望不超过 1300，用同一命令回读。
    - `node scripts/rule-checks.mjs disclosure origin/main` 未命中；`git diff --check origin/main...HEAD` 无输出。

- [x] 2026-10-21 18:04 +0800：Batch 6 · 新一轮独立验收。基线为 `test/scans-skip-build-output@92504ade`，以下在该检出加本批修复的工作树运行，不沿用远端仅计划 head 的 checks。
  - C2c 先红：`node --test --test-name-pattern=C2c tests/contract/source-tree.test.js` 退出码 1，只红 C2c；`!d\ist/` 下 actual `[]`，expected `['p/dist/x.ts']`。Git 对 `!d\ist/`、`!dis\t/`、`![[:alpha:]]ist/`、`!d[[:alpha:]]st/` 都不忽略该源码（退出码 1），旧 helper 却剪掉 `dist`。最小 fallback 后，四个相关文件 51 / 51 通过，0 skip。
  - 原始 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin` 调用被环境的自动 reinstall 拦在 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`，未进入构建。使用命令级环境 `npm_config_manage_package_manager_versions=false pnpm_config_verify_deps_before_run=false` 后，`pnpm --filter @harness-projects/app-harness-plugin pack:plugin` 退出码 0，随后两次 `pnpm verify` 均退出码 0：主测试 1710 / 1710，MVP 7 / 7，0 fail / skip。没有更改依赖清单、锁文件或用户配置。
  - 与真实 Git 差分：512 条规则（含固定反例和固定种子的 500 条组合），逐一比较 `dist`、`build`、`node_modules`，共 1536 次，少扫 0、解析抛错 0；这是本次样本结果，不是完整 gitignore 兼容性证明。
  - `node scripts/review-mutate.mjs .superpowers/pr390-final-mutations.json --root .` 退出码 0：U1 去掉转义 fallback、U2 去掉嵌套字符类 fallback 都只被 C2c 杀死；R1 在已跟踪的 `packages/core/src/relations.ts` 增加真实 `tx.putDeliveryFacts(facts)` 函数调用，只被「唯一写者」杀死，actual 恰多 `core/src/relations.ts`。三项全部 APPLIED / KILLED，原文按字节还原，前后基线 51 / 51 全绿。历史 43 项整表的读数仍只属于 Batch 5，本次不把它当新 head 证据。
  - 归档后文档窄验证：`node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js` 为 9 / 9；必需章节、归档索引和两条技术债来源链接均存在，`git diff --check` 无输出；`node scripts/workflow-check.mjs` 为 no findings（8 个文件）。发布面与规模命令在提交后以新 HEAD 再回读。

- [x] 2026-10-21：Batch 7 · 在 `test/scans-skip-build-output@cd22bce1`（已重放到 `origin/main@d7e7bca6`）上复评修复本身，以下为本批实际输出。
  - 先红：C2c 加 `![]d]ist/`、`!d[]i]st/`、`![]a-d]ist/` 后，只红 C2c；三条分别核对 Git 的 `check-ignore -q` 都退出 1，而旧 helper 的 `files` 都是 `[]`。根因是合法字符类首位的 `]` 表示字面字符，近似正则却把它当成类结束。
  - 新 C2c 共十二条真实 Git 判据（原四条加本轮八条），补充 `![!]]ist/`、`![^]]ist/`、`!d[!]]st/`、`!d[^]]st/`、`![][d]ist/`；全部保留 `p/dist/x.ts`。原 C2b 的 `!*.local` 与未闭合 `[` 用例仍通过。四个相关文件 51 / 51，0 fail / skip。
  - 变异：`node scripts/review-mutate.mjs .superpowers/pr390-closed-class-mutation.json --root .` 退出 0；F6 恢复旧字符类近似与仅嵌套类 fallback，APPLIED / KILLED，失败名只含 C2c，前后基线全绿、按字节还原。运行态 spec 不入库。
  - 命令级环境 `npm_config_manage_package_manager_versions=false pnpm_config_verify_deps_before_run=false` 下，`pnpm --filter @harness-projects/app-harness-plugin pack:plugin` 后一次 `pnpm verify`：两者退出 0，主测试 1771 / 1771、MVP 7 / 7，0 fail / skip。这是重放后的本批结果；Batch 6 的 1710 与 512 条差分样本不作为当前证据。
- [x] 2026-10-22：Batch 8 · PR #390 九条评审意见修复。
  - TDD RED：只加 C4 tracked + untracked oracle、扩展名、symlink、大小写重命名与 Gitignore 反例后，旧 helper 的 `node --test tests/contract/source-tree.test.js tests/integration/source-scan-build-output.test.js` 为 6 fail；其中扩展名、真实树 Git-visible 少扫、未暂存改名、symlink 与 case-only rename 均被明确点名。I1 配置绑定测试先于实现即通过，确认当前真实脚本配置合法。
  - GREEN：helper 扩展为 `/\.[cm]?[jt]sx?$/` 后同命令 13/13 通过；C5d 的真实 Git fixture 经 `git check-ignore -q` 两项都为 exit 1，证明 nested `.gitignore` 与 `core.ignorecase=true` 都让 Git 保留文件，而旧 helper 曾剪掉它们。当前卷为大小写不敏感，C5c 实际执行并通过。
  - 变异：`node scripts/review-mutate.mjs <review-spec.json>`，M1–M5 全部 APPLIED / KILLED；归因依次为扩展名夹具、C5/C5d、C5c、C5b、I1。runner 前后基线都绿且按字节恢复。
  - Git oracle 细节：C4 用 `ls-files -co --exclude-standard`；路径以 `realpathSync.native` 对 root 与实际路径一并规范化；所有扫描范围内 tracked mode `120000` 会触发明确失败。helper 不跟随 symlink，因此不引入 link 逃逸或循环路径解析。
  - 已完成文档映射：TD-087 新承接 issue #396（2026-10-22，由协调者创建并回读为 OPEN）；项目 Status / blocked-by 未写。本轮目标13项已通过；pack后整合验证与新head发布门由协调者在实际执行后记录，不沿用其他PR测试计数。

## Surprises & Discoveries

- 在带 `.git` 的克隆里，`dist/` 在位时只红 2 条。设计 1 报的第三条红是 `issue-policy.test.js` 的 CLI 用例，只在没有 `.git` 的 `git archive` 解压目录里出现，与 #350 无关，不在本 PR 处理。
- `findPackageDirs` 的注释说跳过 `dist`，代码并没有跳。
- 设计 2 说全局忽略规则会让 git 清单不可复现。这只对未跟踪文件成立：gitignore 文档写明「Files already tracked by Git are not affected」。
- Batch 2 的先红夹具不能用计划原写的 `apps/a/build/package/package.json`：`packageDirectoriesOnDisk` 遇到带 `package.json` 的目录就停，`apps/a` 已经是包根，不会下钻到它的 `build/`，所以旧名单下这条夹具也是绿的（在 `test/scans-skip-build-output` 上实测：只加这一条，`host-node-types.test.js` 仍是 `ℹ fail 0`）。现有的 `apps/a/dist/package/package.json` 同理，并不判别。能判别的是分组层的目录，也就是 `packages/dist/stray` 的同类，所以改用 `packages/build/stray/package.json`。
- **F1 · C4 把索引与工作树的暂时不一致报成「落在被忽略目录里」**（2026-10-21）：C4 用 `git ls-files` 取索引里的路径，其中包括工作树里已删除或改名而未暂存的条目，也包括 skip-worktree 的条目和被跟踪的符号链接，再与磁盘遍历比较。本机用 IDE 改名后 `pnpm verify` 只红 C4，提示语还把原因指向 `.gitignore`。`origin/main` 的 `tests/`、`scripts/` 里没有任何 `ls-files` 调用，这类「索引对磁盘」的失败是 C4 新引入的。证据见 Progress 的 Batch 4 条目。
- **F3 · 「少扫的唯一缺口由 C4 兜住」不成立**（2026-10-21）：`line.trim()` 连行首空白一起去掉，而 git 只去行尾；取反规则被整体丢弃，但它取反的那个裸目录名仍留在剪枝集合里；行尾制表符是规则本身而不是空白。这些写法下 git 不忽略的目录会被 helper 剪掉，未跟踪的源码被少扫，C4 只覆盖被跟踪的文件。当前根 `.gitignore` 只有 `!.env.example`、`!.vscode/extensions.json` 两条取反，今天不触发。修复后少扫的缺口只剩两处：被跟踪文件落进被忽略目录（C4 兜住）与子目录 `.gitignore` 的取反（helper 不读；仓库只有根 `.gitignore`，已写进 helper 头注释，不单独登记技术债）。Superseded 了 D1 里「唯一的少扫缺口由 C4 兜住」的说法，见 D1 的就地标注。Superseded by 本节「取反末段带通配」条目（2026-10-21）：在 `daf54257` 上，「只剩两处」不成立，取反末段带通配时仍会少扫，已在 `019aa371` 修复；修复后上面这两处才是仅剩的缺口。
- **整表变异暴露了 `host-node-types` 夹具的一个盲区**（2026-10-21）：验证者增补的 N12（把 `ignoredDirectoryNames(root)` 换成 `ignoredDirectoryNames(repoRoot)`）在整表里 SURVIVED。夹具 `.gitignore` 里的 `node_modules/`、`dist/`、`build/` 真实仓库根也有，所以读错根不改变结果。夹具加了一条真实根不认识的 `fixture-only-out/` 和对应的 `packages/fixture-only-out/stray/package.json` 之后，N12、B1、B2 都 KILLED。
- **取反末段带通配仍会少扫**（2026-10-21，验收者）：Batch 4 只认末段为 `[\w.-]+` 的取反，`!*/`、`!dis*/`、`![d]ist/`、`!d?st/` 这类规则被整条丢弃，而 git 会因为它们不忽略 `dist`。证据见 Progress 的 Batch 5 条目：22 种写法里有 4 种少扫；1500 条随机取反规则里有 19 条少扫。今天根 `.gitignore` 只有 `!.env.example`、`!.vscode/extensions.json` 两条取反，不会触发。被跟踪文件的少扫仍由 C4 兜住，受影响的只有本机未跟踪的新文件，也就是 TDD 的先红那一步。修法见 D11。
- **`origin/main` 在本 PR 期间前进了，tracker 有文本冲突**（2026-10-21 16:52 +0800 观察，`origin/main` 比合并基多 11 个提交）：`docs/exec-plan/tech-debt-tracker.md` 两边都在 TD-068 之后追加，main 一侧当时是 TD-070–078。rebase 时保留两边，先 main 的行，再 TD-086、TD-087。其余文件无冲突。并集 `pnpm verify` 在 `dist/` 在位与删掉 `dist/` 两种状态下都通过，见 Progress 的 Batch 5 条目。main 可能继续前进，回读命令写在同一条目里。
- **块注释里不能写 `*/`**（2026-10-21，验收者）：helper 头注释举 `!*/` 为例时，`*/` 提前结束了注释，模块加载报 `SyntaxError`。改写措辞后用 `node --check tests/fixtures/source-tree.mjs` 确认。

- **F5 · 宽松取反的兼容性声明过强**（2026-10-21，Batch 6）：Git 官方 [gitignore 文档](https://git-scm.com/docs/gitignore) 明确允许反斜杠转义任意字符，字符类采用 fnmatch 语义。旧宽松正则把反斜杠当字面字符、把 POSIX 嵌套类截断，仍会少扫新建源码。修复是停止剪枝，不扩展解析器；代价是此类取反出现后可能多扫依赖或构建产物并使门禁变红。今天根 `.gitignore` 无此写法。

- **F6 · Batch 6 修复本身仍漏首位字面右括号字符类**（2026-10-21，交叉评审）：`[]d]`、`[]i]`、`[]a-d]` 及取反组合是 Git 可接受的类，旧近似在首个右括号就结束，留下字面尾部而少扫。它与 F5 同根，说明继续补字符类边角无法建立可靠边界；本批删除字符类近似路径，闭合方括号取反一律停止剪枝（D15），限制记入 TD-086。
- **F7 · U+2028/U+2029 使字符类闭合判断少扫**（2026-10-21 末轮复评，2026-10-22 补记录）：真实行分隔字符不是正则 `.` 匹配的普通字符；原 `.*` 判断未识别一条含 `[` 与 `]` 的取反，仍把 `dist` 剪掉。末轮修复改为字面包含判断，故逆序括号也保守停止剪枝（D16）。C2c 从 12 条扩到 14 条真实 Git 判据；这项修复过去只在 Bottom Change Note 留痕，当前已回填 Progress / Decision Log。
- **PR #390 修复复评确认的边界**（2026-10-22）：C4 的 Git oracle 可以发现未跟踪且未忽略的源码被 helper 剪掉，包括子目录 `.gitignore` 取反和 `core.ignorecase=true`；helper 不负责实现完整 Gitignore 语义。C4 显式禁止扫描范围内被跟踪的 symlink，保持现有 helper 不跟随策略，不把 escape/cycle 逻辑引入本 PR。

## Decision Log

- **D1**（2026-10-21，协调者授权的独立评审者按调研决定，人类可推翻）：采用按根 `.gitignore` 裸目录规则剪枝的遍历（设计 2），不用 `git ls-files`（设计 1）。
  - Rationale：业界有两类做法。一类按 git 索引：`git grep` 缺省只搜已跟踪文件（https://git-scm.com/docs/git-grep）；Turborepo 的 `inputs` 缺省是「checked into source control」的文件（https://turborepo.dev/docs/reference/configuration）。另一类遍历时遵循 `.gitignore`，例如 ripgrep（https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md）。
  - 本仓库的扫描要同时满足四点：与 CI 干净检出一致；本机新建、尚未 add 的文件也能让 TDD 先红；在 `git archive` 导出目录里能跑（#301 先例）；不受泄漏的 `GIT_DIR` / `GIT_INDEX_FILE` 影响（`rebase --exec` 和 hook 场景）。
  - 剪枝方案用一条代码路径就满足这四点。不含中间斜杠的 `name/` 匹配任意深度的同名目录（https://raw.githubusercontent.com/git/git/master/Documentation/gitignore.adoc），所以按名剪枝与 git 语义一致；唯一的少扫缺口由 C4 兜住。Superseded by Surprises & Discoveries 的「F3」条目（2026-10-21）：行首空白、取反和行尾制表符也会少扫，已修；剩下的缺口是被跟踪文件落进被忽略目录（C4）与子目录 `.gitignore` 的取反（不读，仓库没有）。
  - 设计 1 要多出环境清洗、子目录守卫、非 git 回退三套机制，而它的回退本身仍是一份名单。
- **D2**（2026-10-21，同上）：保留 I1，在临时目录里真实构建，而不是像设计 1 那样只做 `check-ignore` 断言加文档。
  - Rationale：issue 的范围要求一条「构建后运行扫描的回归检查」，而 CI 从不在真实树上构建。构建约 50 ms，两个对照证明这条测试有判别力；它写在 mkdtemp 里，不碰开发者自己的 `dist/`。
- **D3**（2026-10-21，同上）：Batch 2 只替换手写名单，不合并两份包根发现；`scripts/run-test-layer.mjs` 不动。
  - Rationale：合并包根发现会改变 Merge Gate · Boundaries 的语义，超出 #350 的范围。`scripts/` 不应反向 import `tests/fixtures/`，而 `tests/` 不产出构建物。
- **D4**（2026-10-21，同上）：解析器只认裸目录规则，扩展名集合固定，不加参数，不引入依赖。
  - Rationale：目前只需要目录名这一个维度；扫描面与旧实现一致，`delivery-lineage` 的判定不变。Superseded in part by Batch 8 / review comment 4344350211（2026-10-22）：共享固定集合还需覆盖 package-boundaries 与 local-git 已使用的 `.mts`、`.cts`、`.cjs`、`.jsx`。
- **D5**（2026-10-21 15:50 +08，协调者决定，人类可推翻）：Batch 2 只迁移 `host-node-types`；`package-boundaries` 的 `findPackageDirs`（注释说跳过 `dist`、代码第二层不跳）与 `sourceFiles` 的手写名单不在本 PR 改，登记 TD-087。
  - Rationale：同批 PR #388 要改 `tests/contract/package-boundaries.test.js` 的 `HOST_ENTRY.allow`；两个并行 PR 改同一文件违反 `AGENTS.md` §6「任务文件集互不重叠」。这两处今天都不会被 `dist/` 污染（见 Context 盘点表），#350 的验收不依赖它们。#355 是 issue，不是 PR；后续迁移由 issue #396 承接，待 PR #388 合并后实施。

- **D6**（2026-10-21 15:55 +08，实现者（Sonnet），人类可推翻）：`tests/e2e/delivery-lineage.test.js` 除第 7 行导入和原第 369–370 行外，还新增一行 `import { callSites } from '../fixtures/source-tree.mjs'`（紧跟包导入之后）。
  - Rationale：迁到共享 helper 必须导入它；Global Constraints 的「只动第 7 行导入」指的是删掉不再使用的 `readdirSync`、`readFileSync`，新增的 helper 导入是同一处迁移的另一半，不触及用例本体。

- **D7**（2026-10-21 16:30 +0800，修复者（Sonnet 5.5），人类可推翻）：F1 的修法是让 C4 只数磁盘上确有的普通文件（`lstat` 为普通文件），比较抽成接受根目录的函数留在 `tests/contract/source-tree.test.js`，不放进 helper。
  - Rationale：helper 的契约是「同步、不调 git、无模块级状态」（Design / Spec），git 比较只属于 C4；抽成接受根目录的函数才能在 mkdtemp 的真实 git 仓库里造「未暂存的删除、改名、skip-worktree、force-add、符号链接」这些状态做判别用例（C5、C5b）。备选「`git ls-files --deleted` 排除」只覆盖删除，不覆盖 skip-worktree 与符号链接；备选「符号链接单独断言」增加一套不属于 #350 的断言。符号链接不是遍历面是 helper 既有的设计（只收普通文件、不下钻），C4 与它对齐。
- **D8**（2026-10-21 16:30 +0800，同上）：F3 的修法是让逐行解析与 git 一致，并把被任一取反规则点到末段名字的目录名整个排除出剪枝集合；不引入 `ignore` 包，也不在 helper 里调 `git check-ignore`。
  - Rationale：只去一个行尾 CR 和行尾空格、行首空白保留、BOM 忽略，是 git 读 `.gitignore` 的规则（临时仓库里用 `git check-ignore` 逐项核对过，见 Progress）。取反不做路径级建模：保守地让该名字不剪，只会多扫，符合「宁可多扫，不可少扫」，也避免把 helper 变成第二个 gitignore 引擎（D4）。子目录 `.gitignore` 不读，是已写明的边界，仓库现在没有。Superseded by D11（2026-10-21）：「末段名字」只认 `[\w.-]+`，带通配的末段（`!*/`、`!dis*/`）被整条丢弃，仍会少扫；改为对末段做宽松匹配。
- **D9**（2026-10-21 16:30 +0800，同上）：F4 的三项边界补进 C1、C2b、C6，不新增 CI lane；`host-node-types` 的夹具多一条真实根不认识的规则（N12）。
  - Rationale：三项都是 Design / Spec 已经声明的行为（扫描面、符号链接不下钻、顶层剪枝），缺的是钉住它们的用例；N12 是整表变异发现的同类盲区，改动是夹具里两行，仍在 `Global Constraints` 的文件集合内。
- **D10**（2026-10-21 16:30 +0800，同上）：TD-086、TD-087 按号段手工追加到 tracker 的 Open Items 末尾，11 列；本计划留在 `active/`，不移到 `completed/`。Superseded by D14（2026-10-21）：本轮委派已包含归档。
  - Rationale：F2 要求 A3 的判定证据「tracker 的 TD-087 行」在位；`docs/README.md` 的索引由协调者统一处理（`Global Constraints` 禁止本 PR 改它），所以归档动作不在本批做。
- **D11**（2026-10-21 16:46 +0800，验收者（Opus），人类可推翻）：取反规则取末段（任意非斜杠字符），把其中的 `*`、`?`、`[…]` 都当任意字符做宽松匹配，凡被匹配到的裸目录名一律不剪；普通字符按字面比较，未闭合的 `[` 按字面处理。
  - Rationale：helper 的契约是「宁可多扫，不可少扫」，宽松匹配只会比 git 多认，不会漏认（1500 条随机取反规则差分对照，少扫 0 条，见 Progress 的 Batch 5 条目），而且不做路径级建模，仍守 D4、D8「不做第二个 gitignore 引擎」。
  - 备选「末段带任何通配就清空剪枝集合」被放弃：`!*.local` 这类文件通配的取反也会让 `dist/` 不剪。本机 `pack:plugin` 之后 #350 会悄悄复发，而 CI 照样是绿的。C2b 的「文件通配的取反不碰目录剪枝」把这一点钉住（变异 W5）。
  - 「宽松匹配不会漏认」的结论 Superseded by D13（2026-10-21）：转义与嵌套字符类存在反例，完整复现见 Batch 6。
  - 备选「完整实现 fnmatch」被放弃：要处理转义、`**` 与字符类取反，而剪枝只需要「这个名字可能被重新包含」这一个判断。
  - 代价：末段是 `**` 时匹配一切，每个目录名都不剪。`dist/`、`build/` 之后写 `!packages/**`，git 也确实不再忽略 `packages/` 下的 `dist`、`build`，这正是需要的。但写的是 `!dist/**` 时，git 仍忽略两者，因为父目录被排除后子路径无法重新包含，helper 却都不剪，属于多扫，方向安全。两种情况都在临时仓库里用 `git check-ignore` 核对过。
- **D12**（2026-10-21 16:46 +0800，同上）：C4 判据里的扩展名正则 `SOURCE_EXTENSION` 不从 helper 导入，与 helper 的 `SOURCE_FILE` 各写一份，并注明这是有意为之。
  - Rationale：C4 是 helper 的独立判据。共用一份时，helper 收窄扩展名（漏掉 `.tsx`、`.mjs`）会让两边一起收窄，变异 N8 就不再被杀死。

- **D13**（2026-10-21，独立验收者；协调者复核方向）：根 `.gitignore` 的取反含反斜杠或嵌套字符类（`[[`）时返回空剪枝集合，未知或失效写法也按此保守处理；其余简单通配保持 D11。Superseded in part by D15（2026-10-21）：所有闭合方括号取反均停止剪枝，不再近似字符类。
  - Rationale：Git 官方文档与 C2c 的真实 Git 对照推翻了 D11 的覆盖假设。继续补转义、POSIX 类、非法类等规则会扩大成第二个解析器；停止剪枝只会多扫，真实源码不漏。整份 `.gitignore` 的后续规则也不重新启用剪枝，避免规则顺序产生另一套不完整解释。
  - 取舍：复杂取反可能令 `pack:plugin` 后的扫描误红，甚至多遍历依赖；这比隐藏真实第二写点可定位。若仓库实际需要复杂规则，再改用成熟匹配器，而不是继续加解析分支。
- **D14**（2026-10-21，协调者本次委派）：独立验收者负责本计划归档、添加其 Completed 索引、更新 TD-086–087 来源路径；不扩大到其他计划或债务。
  - Rationale：此前 D10 把归档留给协调者，此次委派明确纳入收尾，按 PLANS 结束本地实现生命周期；rebase、整合提交和当前远端门禁仍由协调者执行。

- **D15**（2026-10-21，交叉评审发现、协调者委派）：取反中有反斜杠，或存在左方括号之后的右方括号时，返回空剪枝集合；不分析字符类是否合法、不再尝试类匹配。未闭合左括号按字面处理，`*` / `?` 的简单末段匹配保留。
  - Rationale：复评修复本身又找到合法首位右括号反例。扩大保守范围比解释字符类的闭合、取反、范围、POSIX 规则更小且可靠，始终把未知含义处理为多扫。`!*.local` 不含方括号，仍不会让 `dist` 多扫。
  - 技术债：按协调者要求扩充自身 TD-086 的适用范围，不新占编号；今后根规则确需字符类或转义且多扫不可接受时，采用成熟匹配器并重验源码与构建产物，不在此 helper 继续实现 fnmatch。
  - Superseded in part by D16（2026-10-22）：实现对任一行中同时含 `[` 与 `]` 的取反保守停止剪枝，不要求左右括号先后顺序；真实 U+2028/U+2029 用例证明 `.` 不能覆盖所有行分隔字符。
- **D16**（2026-10-22，末轮复评）：取反同时含字面 `[` 和 `]` 时停止全部剪枝，不解析括号顺序或字符类；C2c 当前覆盖 14 条 Git 判据。
  - Rationale：真实 U+2028 / U+2029 行分隔字符使基于 `.*` 的字符类识别少扫；字面包含检查更简单且只会保守多扫，避免再扩展不完整的 gitignore 解析。
- **D17**（2026-10-22，人类授权）：人类直接要求“继续走修复流程 PR#388-#391”，本计划承接 #390 修复、独立复评与整合；本授权不包含修改 Project `Status` 或 `blocked-by` / `blocking`。
  - Rationale：明确授权只覆盖本次点名的 PR 批次和修复/复评职责；跨 PR 排序、远端发布与 Project 事实仍由协调者或人类门禁负责。

## Idempotence and Recovery

- 可重复：`pack:plugin` 构建前先清空输出目录，删掉 `apps/harness-plugin/dist` 即回到无产物状态；新测试只写 mkdtemp，并在 `finally` / `t.after` 清理；真实树变异只在临时克隆里做。
- 恢复：中断前先做本地 WIP 提交；某一批失败就 `git revert` 该批，回到上一批的绿状态。

## Interfaces and Dependencies

- 运行环境：Node 版本取 `.nvmrc`；pnpm 用 `packageManager` 声明的 10.28.2；`git` CLI 只有 C4 用到；构建用 `apps/harness-plugin/scripts/build.mjs` 的 `build({ outDir })`。helper 契约见 Design / Spec。
- 技术债：预计登记 **TD-086**。内容是「遍历 `packages/`、`apps/` 必须经共享 helper」没有机械守卫，只靠 `tests/README.md` §3 的约定；触发条件是新测试又手写递归遍历。另登记 **TD-087**：`package-boundaries` 的 `findPackageDirs` 注释与代码不符、`sourceFiles` 仍手写跳过名单（D5）。本阶段不改 tracker。Superseded by Batch 4（2026-10-21）：TD-086、TD-087 已登记在 `docs/exec-plan/tech-debt-tracker.md` 的 Open Items 末尾，号段内再无其他条目。
- 人类专属：看板 Status，以及 #230 与 #350 之间的 blocked-by 关系，都由人类维护，本 PR 不写。

## Outcomes & Retrospective

以下读数都在检出 `test/scans-skip-build-output` 的最终树上（Batch 5，代码提交 `019aa371`）；重算命令见 Validation and Acceptance。

A1 达成：本机 `pack:plugin` 产出的被忽略 `apps/harness-plugin/dist/` 在位时，`pnpm verify` 退出码 0（`ℹ tests 1709`、`ℹ pass 1709`、`ℹ fail 0`，`test:mvp0` 7 / 7）。删掉 `dist/` 后同样退出码 0，读数相同。修复前同一状态是 Batch 0 的 `fail 1`，Batch 5 的 base 对照复现过一次。I1 在每个 PR 的 CI 上真实构建，并带阳性、阴性对照。

A2 达成：R1（被跟踪文件追加第二个调用点）与 R2（新建未跟踪的第二个调用点）让「唯一写者」红，且只多报植入的那一处。R3（`git add -f` 进被忽略目录）让 C4 红并列出该文件。最终树整表变异 43 / 43 KILLED，归因正确。

A3 达成：Context 的盘点表；`host-node-types` 的夹具用例，B1、B2、N12 都被它杀死；tracker 的 TD-086、TD-087 两行。

A4 达成：`rule-checks` 的 size 与 disclosure 都通过，`git diff --check` 无输出。读数见 Progress 的 Batch 5 条目。

A5、A6 达成：本机索引与工作树暂时不一致时不再误红，按验证者的原条件复跑过。`.gitignore` 解析与 git 差分对照，少扫 0 条。

A7、A8 达成：PR #390 修复复评新增 Git 可见源码 oracle、tracked symlink 显式拒绝、case-only rename、扩展名和真实 pack 输出配置绑定。局部 RED/GREEN 为 source-tree + I1 13/13；M1–M5 全部 KILLED 且 runner 确认还原。当前只证明上述目标修复与反例；完整pack后验证和当前head发布回读以本轮协调者的实际执行结果为准。

与计划的偏差：
- Batch 2 的先红夹具由 `apps/a/build/...` 改为分组层的 `packages/build/stray/...`（Surprises）。
- `delivery-lineage` 多了一行 helper 导入（D6）。
- 独立验证后追加了 Batch 4。F1（C4 误报未暂存的删除与改名）与 F3（解析比 git 宽，会少扫）都是真缺陷，已按根因修，并由 C2b、C5、C5b 钉住。F4 的三项边界由 C1、C2b、C6 钉住。整表变异另发现 `host-node-types` 夹具的盲区（N12），已修。
- 最终验收追加了 Batch 5。复评 F3 的修复时发现取反末段带通配仍会少扫，已修，并由 C2b 与 W1–W7 钉住（D11）。
- 计划只在 Batch 1 写了 C1–C4 和 I1，最终多出 C2b、C5、C5b、C6 四条用例。增加的都在 `Global Constraints` 的文件集合内。

遗留：
- TD-086：没有机械守卫保证新测试遍历 `packages/`、`apps/` 时经共享 helper。
- TD-087：`package-boundaries` 的 `findPackageDirs` 与 `sourceFiles` 仍各自手写跳过名单，由 issue #396 承接，触发条件为 PR #388 合并。
- helper 不读取子目录 `.gitignore`；若它重新包含源码，Git 可见源码 C4 会在真实检出里让门禁失败。helper 仍只近似根 `.gitignore` 的安全剪枝子集，不承诺完整 gitignore 兼容。
- 取反末段是 `**` 时 helper 一个目录都不剪（D11 的代价，属于多扫），今天根 `.gitignore` 没有这种写法。
- 合并前 rebase 到最新 `origin/main` 时，`docs/exec-plan/tech-debt-tracker.md` 有文本冲突，保留两边即可（Surprises）。
- 归档：此前留给协调者的动作由此次委派接手（D14）；已移到 `completed/` 并更新自身索引、TD-086–087 的来源链接。
- Batch 7 最终边界：F5/F6/F7 表明继续手写 fnmatch 近似会反复少扫；任何含 `[` 与 `]` 的取反停止剪枝。C2c 为 14 条真实 Git 判据；复杂语法可能多扫并使构建态门禁误红，已由 TD-086 记录。
- Batch 6 的 1710 + 7 和 Batch 7 的 1771 + 7 是各自 head 的历史验证值，不能替代后续候选验证或当前 PR checks。
- 人类专属：看板 Status 与 #230、#350 之间的 blocked-by 关系，本 PR 不写。

历史协调快照（2026-10-21）：本 PR 曾重放到 `origin/main@d7e7bca6`，当时只需合并 tracker 的文本冲突。该 SHA 与后续 main 不同，不作为本次修复树、远端状态或验证结论。

Batch 8 完成本地复评：所有九条意见已逐条映射至 C4/C5/C5b/C5c/C5d、I1、ExecPlan、tracker 和索引；测试 oracle 对 Git 不忽略的未跟踪文件、大小写配置与 symlink 前提有可归因判据。独立复评、pack 后 verify 与最终门禁的确切结果在本节继续追加。

## Bottom Change Note

- 2026-10-21 15:05 +08：评审者综合两份独立设计后，创建本计划。
- 2026-10-21 15:50 +08：协调者把 `package-boundaries` 两处移出 Batch 2、登记为 TD-087（D5），避免与并行 PR #388 改同一文件；#355 是 issue。
- 2026-10-21 15:55 +08：Batch 0–1 实施完成；新增 D6（`delivery-lineage` 多一行 helper 导入），回填 Progress。
- 2026-10-21 15:57 +08：Batch 2 实施完成；先红夹具由 `apps/a/build/...` 改为分组层的 `packages/build/stray/...`（见 Surprises），回填 Progress。
- 2026-10-21 16:00 +08：Batch 3 的文档两处完成，Plan of Work 对应步骤打勾；整树变异、TD 登记与 Outcomes 留给验收者。
- 2026-10-21 16:30 +0800：独立验证给出 F1–F4，修复者逐条复跑后新增 Batch 4（F1、F3 属实，F2 是已知待办，F4 的三项边界补用例），新增 D7–D10，Design / Spec 与 D1 就地标注被推翻的结论，补验收表的变异行，回填 Progress、Surprises、Outcomes，Batch 3 收尾步骤打勾。
- 2026-10-21 16:46 +0800：验收者（Opus）新增 Batch 5。F1–F4 按原条件复跑都已修。复评修复本身时发现取反末段带通配仍少扫，已修。新增 D11、D12 和验收项 A5、A6，变异表加 N13 与 W1–W7。Design / Spec、F3 条目、D8、Batch 4 的 F3 读数四处就地标注 Superseded。回填 Progress、Surprises、Outcomes。另外删掉上一条末尾多出的「+08」。

- 2026-10-21 18:04 +0800：Batch 6 独立验收发现 F5，补 Git 判据 C2c 并采用停止剪枝的最小 fallback；记录新全量、差分与三项变异证据，D11 的过强结论就地标注，按 D14 归档并维护自身索引与债务来源。

- 2026-10-21：Batch 7 记录交叉评审修复本身再次抓到的 F6，C2c 补八条首位右括号相关 Git 判据，停止所有闭合方括号取反剪枝并删去字符类近似；D13 就地标注取代，新增 D15，扩充 TD-086 的同一 helper 边界并回填重放后的真实验证。

- 2026-10-21 18:19 +08 Codex：完成当前 main 的 rebase 与文件等价核对；按独立能力边界整理提交，保留 host-node-types 的单独来源同步单位。

- 2026-10-21：末轮 P3 复评发现字符类中的真实 U+2028 / U+2029 不被 dot 匹配；C2c 两条 Git 判据先红后绿，改用左右括号字面存在性检测（保守范围包括逆序括号，不再依赖正则字符解析）；在 `test/scans-skip-build-output@87243f72` 加本补丁运行四文件窄验证，51 / 51、0 fail / skip。C2c 现为十四条 Git 判据；全量与并集门禁由协调者随后执行，本批不重复。

2026-10-22修复独立复评APPROVE：C4五组Git oracle反例与13项目标通过；I1阴性expected曾漏用动态输出目录，合法build/package配置暴露误红，修复后独立正向1/1通过。完整修复并集将由协调者先打包再verify，当前不借原head的全量绿灯。授权合并顺序记录在`docs/project-management/merge-queue.md`§4.10。

2026-10-22修复并集证据：在独立检出`test/repair-queue-pr388@7e5ab3d6a8093a3521a8d759c5b8a7a9507c2b52`先执行真实pack:plugin，随后CI=true pnpm verify为1886+7、fail0。四PR产品输入及清单指纹见各自评审记录；该记录不继承到之后变基的新head，最终发布仍回读CI、threads与原生issue关联。
