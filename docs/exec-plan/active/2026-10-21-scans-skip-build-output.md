# 源码扫描不计被忽略的构建产物 ExecPlan

> 状态：Active
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
| `package-boundaries` 的 `findPackageDirs` | 两层、找到包根就停；只跳 `node_modules`，第二层什么都不跳 | 否（`apps/harness-plugin` 自带清单，就此停下） | 延后到 TD-087（D5：避开并行 PR #355 改的同一文件） |
| `package-boundaries` 的 `sourceFiles` | 只扫 `<pkg>/src`，手写跳过 `node_modules`、`dist` | 否 | 延后到 TD-087（同上） |
| 其余扫描（见下） | 只扫 `src`、单层目录、`docs/`、workflows、`tests/<layer>` 或 mkdtemp | 否 | 不动 |

「其余扫描」包括：`package-boundaries` 第 344 行、`development-local-git-source`、`ui-model-presentation`、`board-status-semantics`、`plan-facts-consistency`、`e1-evidence-consistency`、`merge-gate-workflow`、`scripts/{policy-check,workflow-check,run-test-layer}.mjs`，以及 `harness-plugin-artifact`、`harness-plugin-host-providers`、`storage-*` 这几个集成测试。

相关事实：
- 仓库只有根目录一份 `.gitignore`，裸目录规则有 `node_modules/`、`dist/`、`build/`、`coverage/` 等；`tsconfig.json` 已排除 `**/dist`；`tests/fixtures/` 是三层测试共用的中立目录。
- `apps/harness-plugin/scripts/build.mjs` 导出 `build({ outDir })`，缺省写到 `apps/harness-plugin/dist`；构建到临时目录约 50 ms。

## Design / Spec

新增 `tests/fixtures/source-tree.mjs`：同步实现，只用 `node:fs` 和 `node:path`，不调用 git，每个函数都接受根目录参数。

- `ignoredDirectoryNames(root): Set<string>`：读取 `<root>/.gitignore`，每行 trim 后只收 `/^([\w.-]+)\/$/` 形式的裸目录规则。按 gitignore 语义，这类规则匹配任意深度的同名目录。锚定、通配、取反、注释和带路径的规则都不收，对应目录照常扫描：宁可多扫，不可少扫。文件缺失时抛错。
- `listSourceFiles(root, scopes): { scope, file }[]`：逐层 `readdirSync(dir, { withFileTypes: true })`，遇到被忽略的目录名就整棵剪掉。只收扩展名匹配 `/\.(ts|tsx|js|mjs)$/` 的普通文件，与旧扫描面一致。符号链接不下钻，scope 缺失时抛错。`file` 是相对 scope 的 posix 路径。
- `callSites(root, scopes, pattern): string[]`：返回内容命中 `pattern` 的 `file`，已排序，形如 `core/src/delivery-facts.ts`，与旧的 `callers` 一致。
- **状态拥有者**：已提交的根 `.gitignore` 是「什么算构建产物」的唯一来源。helper 没有模块级状态。
- **少扫方向的兜底**：被跟踪文件落在同名的被忽略目录里（比如 `git add -f`）时，遍历会漏掉它。C4 在 git 检出里断言「git 跟踪的源码 ⊆ 遍历结果」，CI 总是 git 检出，所以 PR 阶段就会暴露。
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
    - `docs/exec-plan/tech-debt-tracker.md`：只追加 TD-086–087 号段内的新行。
- **不改**：
  - `docs/README.md`（协调者统一加索引）。
  - tracker 的任何既有行，尤其是 TD-054。
  - `apps/`、`packages/` 下任何文件，含 `apps/harness-plugin/scripts/build.mjs`。
  - 在途 PR 的文件：
    - #371：`packages/controller/src/commands.ts`、`packages/core/src/{index,workspace-setup}.ts`、`docs/product/vertical-path.md`。
    - #372：`apps/harness-plugin/src/*`、`apps/web/src/index.ts`、`packages/{client,ui,ui-model}/src/*`、`tests/integration/harness-plugin-artifact.test.js`、ADR-0009/0010。
    - #373：`packages/{core,client}/src/*`、`packages/controller/src/wire.ts`、ADR-0015。
  - 其余：`docs/adr/`、`.gitignore`、`package.json`、`pnpm-lock.yaml`、`.github/workflows/`、`scripts/`。
- **其他约束**：
  - 不新增依赖，不写兼容层。
  - git 只在 C4 中以 argv 形式调用，不写 `git config`。
  - 正文用中文，不写本机绝对路径。

## Plan of Work

实现用 Sonnet，最终对抗验收与重构用 Opus。除非另有说明，命令都在检出 `test/scans-skip-build-output` 的工作树（`.worktrees/scans-skip-build-output`）根目录运行。提交序列：`docs(exec-plan)` 规划 → `test(tests)` Batch 1 → `refactor(tests)` Batch 2 → `docs(tests)` Batch 3 与回填；提交正文写 `Refs #350`，PR 描述写 `Closes #350`。

### Batch 0 · 对齐与红基线

- [ ] 跑 `git fetch origin && git merge --ff-only origin/main`。分支还没有自己的提交。
- [ ] 跑 `pnpm install --frozen-lockfile --offline`。`node_modules/@harness-projects/core` 应指向 `../../packages/core`。
- [ ] 跑 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin && node --test tests/e2e/delivery-lineage.test.js`。期望 `ℹ fail 1`，「唯一写者」的 actual 多出 `harness-plugin/dist/package/lib/index.js`。把读数记入 Progress。

### Batch 1 · 共享 helper 与 delivery-lineage 迁移（闭环，关闭 #350）

- **最小闭环**：`dist/` 在位时，扫描只报被跟踪的写者；构建后的回归测试进入 `pnpm test`。
- **涉及文件**：`tests/fixtures/source-tree.mjs`、两个新测试文件、`tests/e2e/delivery-lineage.test.js`。
- [ ] 先写 helper 骨架，让 `ignoredDirectoryNames` 固定返回 `new Set(['node_modules'])`，复现旧行为，用来先红。
- [ ] 写 `tests/contract/source-tree.test.js`。每个用例的 mkdtemp 夹具都自带 `.gitignore`：
  - **C1**「不计 .gitignore 忽略目录里的调用点（深度不限）；被跟踪与新建源码里的第二个调用点仍被找到」。夹具：`packages/core/src/{writer,other}.ts`、`apps/a/src/caller.ts`、`apps/x/dist/package/lib/index.js`、`packages/core/node_modules/dep/index.js`、`packages/core/build/gen.ts`、`packages/core/README.md`，都含 pattern；scopes 取 `['packages', 'apps']`（与 `delivery-lineage` 同序，排序缺失才可见）。期望恰为 `['a/src/caller.ts', 'core/src/other.ts', 'core/src/writer.ts']`。
  - **C2**「只认裸目录规则」：`/out/`、`tmp*/`、`!keep/`、`*.local`、`# gone/`、`src/gen/` 都不剪枝，集合恰好等于期望。
  - **C3**「缺 `.gitignore` 或缺 scope 时抛错」。
  - **C4**「真实检出里 git 跟踪的 `packages/`、`apps/` 源码全部出现在遍历结果里，且跟踪集合非空」。用 `git ls-files -z`，环境变量去掉 `GIT_*`；`git rev-parse --show-toplevel` 的 realpath 不是仓库根时 `t.skip`。
- [ ] 写 `tests/integration/source-scan-build-output.test.js` 的 **I1**：
  - 准备：在 mkdtemp 根下复制真实 `.gitignore`，写入含 `.putDeliveryFacts(` 的 `packages/core/src/delivery-facts.ts`，再执行 `build({ outDir: <tmp>/apps/harness-plugin/dist })`。
  - 阳性对照：产物 `lib/index.js` 含 `.putDeliveryFacts(`。
  - 主断言：`callSites` 只返回 `['core/src/delivery-facts.ts']`。
  - 阴性对照：`.gitignore` 改成只有 `node_modules/` 后，产物成为第二个调用点。
- [ ] 跑 `node --test tests/contract/source-tree.test.js tests/integration/source-scan-build-output.test.js`，期望 C1、C2、C3、I1 红（C4 在骨架下也绿，属预期）。实现解析后再跑同一命令，期望 `ℹ fail 0`。
- [ ] 改 `delivery-lineage`：删掉 `readdirSync`、`readFileSync` 导入；第 369–370 行换成 `callers = (pattern) => callSites(repoRoot, ['packages', 'apps'], pattern)`，其中 `repoRoot = fileURLToPath(new URL('../../', import.meta.url))`。
- **验证**（`dist/` 在位）：`node --test tests/e2e/delivery-lineage.test.js` 期望 `ℹ fail 0`；`node scripts/run-test-layer.mjs tests/e2e "e2e 链路"` 期望退出码 0。
- **回滚**：`git revert` 本批提交。本批只动测试。

### Batch 2 · 手写名单改读共享来源（可整批裁掉，#350 仍然闭环）

- **涉及文件**：`tests/contract/host-node-types.test.js`（`tests/contract/package-boundaries.test.js` 不改，见 D5）。
- [ ] `host-node-types`：
  - 先红：夹具写入 `.gitignore`（`node_modules/`、`dist/`、`build/`），再加一个 `apps/a/build/package/package.json`。旧名单不含 `build`，用例变红。
  - 转绿：删掉 `NOT_PACKAGES`，改用 `ignoredDirectoryNames(root)`。
  - 同步改写文件头里对 `package-boundaries` 的描述。
- **验证**：`node --test tests/contract/host-node-types.test.js` 与 `pnpm run boundaries` 都期望 `ℹ fail 0`。
- **回滚**：本批单独一个提交，可以单独 revert。

### Batch 3 · 文档、整树验收与收尾

- **涉及文件**：`tests/README.md`、`docs/development/workflow.md`、tracker、本计划。
- [ ] `tests/README.md` §3 加一条规则：遍历 `packages/`、`apps/` 的扫描一律经 `tests/fixtures/source-tree.mjs`。
- [ ] `workflow.md` §4 加一句：`pack:plugin` 之后可以直接 `pnpm verify`。
- [ ] 在最终树上整表重跑验收与变异。
- [ ] 追加 TD-086、TD-087，回填 Progress 和 Outcomes。
- **验证**：`dist/` 在位时 `pnpm verify` 退出码 0；`node scripts/rule-checks.mjs size origin/main` 与 `node scripts/rule-checks.mjs disclosure origin/main` 通过；`git diff --check origin/main...HEAD` 无输出。
- **回滚**：revert 文档提交。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| A1 | `pack:plugin` 产出 `dist/` 后 `pnpm verify` 通过 | I1 在 CI 上每个 PR 都跑；工作树里 `pack:plugin && pnpm verify` 退出码 0（修复前同一状态是 Batch 0 的 `fail 1`） |
| A2 | 被跟踪源码里真有第二个写调用点时仍失败（变异证据） | C1，加下表的 R1–R3 |
| A3 | 遍历扫描已盘点；会被 `dist/` 污染的一处与 `host-node-types` 统一到同一来源，`package-boundaries` 两处登记 TD-087 | Context 的盘点表；Batch 2 的先红用例；tracker 的 TD-087 行 |
| A4 | 规模与发布面 | `rule-checks` 的 size 与 disclosure 通过 |

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

## Progress

- [x] 2026-10-21 15:05 +08：独立评审两份设计，核实事实，复现缺陷，跑通原型变异 R1–R3，定稿本计划。
- [ ] Batch 0 · 对齐与红基线
- [ ] Batch 1 · 共享 helper 与 delivery-lineage 迁移
- [ ] Batch 2 · 手写名单改读共享来源
- [ ] Batch 3 · 文档、整树验收与收尾

## Surprises & Discoveries

- 在带 `.git` 的克隆里，`dist/` 在位时只红 2 条。设计 1 报的第三条红是 `issue-policy.test.js` 的 CLI 用例，只在没有 `.git` 的 `git archive` 解压目录里出现，与 #350 无关，不在本 PR 处理。
- `findPackageDirs` 的注释说跳过 `dist`，代码并没有跳。
- 设计 2 说全局忽略规则会让 git 清单不可复现。这只对未跟踪文件成立：gitignore 文档写明「Files already tracked by Git are not affected」。

## Decision Log

- **D1**（2026-10-21，协调者授权的独立评审者按调研决定，人类可推翻）：采用按根 `.gitignore` 裸目录规则剪枝的遍历（设计 2），不用 `git ls-files`（设计 1）。
  - Rationale：业界有两类做法。一类按 git 索引：`git grep` 缺省只搜已跟踪文件（https://git-scm.com/docs/git-grep）；Turborepo 的 `inputs` 缺省是「checked into source control」的文件（https://turborepo.dev/docs/reference/configuration）。另一类遍历时遵循 `.gitignore`，例如 ripgrep（https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md）。
  - 本仓库的扫描要同时满足四点：与 CI 干净检出一致；本机新建、尚未 add 的文件也能让 TDD 先红；在 `git archive` 导出目录里能跑（#301 先例）；不受泄漏的 `GIT_DIR` / `GIT_INDEX_FILE` 影响（`rebase --exec` 和 hook 场景）。
  - 剪枝方案用一条代码路径就满足这四点。不含中间斜杠的 `name/` 匹配任意深度的同名目录（https://raw.githubusercontent.com/git/git/master/Documentation/gitignore.adoc），所以按名剪枝与 git 语义一致；唯一的少扫缺口由 C4 兜住。
  - 设计 1 要多出环境清洗、子目录守卫、非 git 回退三套机制，而它的回退本身仍是一份名单。
- **D2**（2026-10-21，同上）：保留 I1，在临时目录里真实构建，而不是像设计 1 那样只做 `check-ignore` 断言加文档。
  - Rationale：issue 的范围要求一条「构建后运行扫描的回归检查」，而 CI 从不在真实树上构建。构建约 50 ms，两个对照证明这条测试有判别力；它写在 mkdtemp 里，不碰开发者自己的 `dist/`。
- **D3**（2026-10-21，同上）：Batch 2 只替换手写名单，不合并两份包根发现；`scripts/run-test-layer.mjs` 不动。
  - Rationale：合并包根发现会改变 Merge Gate · Boundaries 的语义，超出 #350 的范围。`scripts/` 不应反向 import `tests/fixtures/`，而 `tests/` 不产出构建物。
- **D4**（2026-10-21，同上）：解析器只认裸目录规则，扩展名集合固定，不加参数，不引入依赖。
  - Rationale：目前只需要目录名这一个维度；扫描面与旧实现一致，`delivery-lineage` 的判定不变。
- **D5**（2026-10-21 15:50 +08，协调者决定，人类可推翻）：Batch 2 只迁移 `host-node-types`；`package-boundaries` 的 `findPackageDirs`（注释说跳过 `dist`、代码第二层不跳）与 `sourceFiles` 的手写名单不在本 PR 改，登记 TD-087。
  - Rationale：同批并行的 #355 要改 `tests/contract/package-boundaries.test.js` 的 `HOST_ENTRY.allow`；两个并行 PR 改同一文件违反 `AGENTS.md` §6「任务文件集互不重叠」。这两处今天都不会被 `dist/` 污染（见 Context 盘点表），#350 的验收不依赖它们。下一步：#355 合并后，由后续小 PR 把两处改读 `tests/fixtures/source-tree.mjs`，并照实修正注释。

## Idempotence and Recovery

- 可重复：`pack:plugin` 构建前先清空输出目录，删掉 `apps/harness-plugin/dist` 即回到无产物状态；新测试只写 mkdtemp，并在 `finally` / `t.after` 清理；真实树变异只在临时克隆里做。
- 恢复：中断前先做本地 WIP 提交；某一批失败就 `git revert` 该批，回到上一批的绿状态。

## Interfaces and Dependencies

- 运行环境：Node 版本取 `.nvmrc`；pnpm 用 `packageManager` 声明的 10.28.2；`git` CLI 只有 C4 用到；构建用 `apps/harness-plugin/scripts/build.mjs` 的 `build({ outDir })`。helper 契约见 Design / Spec。
- 技术债：预计登记 **TD-086**。内容是「遍历 `packages/`、`apps/` 必须经共享 helper」没有机械守卫，只靠 `tests/README.md` §3 的约定；触发条件是新测试又手写递归遍历。另登记 **TD-087**：`package-boundaries` 的 `findPackageDirs` 注释与代码不符、`sourceFiles` 仍手写跳过名单（D5）。本阶段不改 tracker。
- 人类专属：看板 Status，以及 #230 与 #350 之间的 blocked-by 关系，都由人类维护，本 PR 不写。

## Outcomes & Retrospective

本计划处于 Active，还没有实施结果。Batch 3 完成时写入实际结果、与计划的偏差和遗留问题。

## Bottom Change Note

- 2026-10-21 15:05 +08：评审者综合两份独立设计后，创建本计划。
- 2026-10-21 15:50 +08：协调者把 `package-boundaries` 两处移出 Batch 2、登记为 TD-087（D5），避免与并行的 #355 改同一文件。
