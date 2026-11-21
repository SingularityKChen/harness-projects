# 共享源码树包根发现 ExecPlan（shared-source-walker）

> 状态：Active
> 创建：2026-11-21
> 范围：issue #396 —— 把 `tests/contract/package-boundaries.test.js` 的两处手写扫描迁到共享源码树 helper，删除本地跳过名单，并补齐判别夹具；单 PR 闭环。
> 上游输入：issue #396 正文与验收标准（本计划自带全部执行所需上下文，不依赖外部讨论记录）。

## Purpose / Big Picture

完成后，仓库里「什么算被忽略的构建/依赖目录」「什么算源码扩展名」「什么算 workspace 包根」三件事只有一个实现：`tests/fixtures/source-tree.mjs`。`package-boundaries` 不再自己写目录遍历和跳过名单，因此本机跑过打包、根 `.gitignore` 增加构建目录名、或包布局变化时，包边界判定不会与 CI 干净检出漂移。

成功的最小证据（缺一不可）：`pnpm run boundaries` 仍 `ℹ tests 10 / ℹ pass 10 / ℹ fail 0`；`pnpm test:file tests/contract/source-tree.test.js` 由 12 条升到 14 条全绿且新增夹具能被 8 个定向变异逐个杀红；`package-boundaries` 文件里不再出现 `findPackageDirs` / `sourceFiles` 或 `node_modules` / `dist` 字面量；当前树上的包集合与源码文件集合与迁移前逐项相同。

## Context and Orientation

仓库是 pnpm workspace（`pnpm-workspace.yaml` 声明 `apps/*`、`packages/domain` 等单包与 `packages/{providers,storage}/*`），依赖方向 `providers/storage → capabilities → core → controller → client → ui-model → ui → apps` 由契约测试 `tests/contract/package-boundaries.test.js` 保护（`AGENTS.md` §2）。该测试原本维护两份独立扫描：

- `findPackageDirs`（`tests/contract/package-boundaries.test.js:137-160`，函数体 138–160）：组层只跳 `node_modules`，嵌套层不跳任何名字，块注释却说跳过 `dist`（注释与代码不符）；`packages/` 或 `apps/` 缺失时返回空集。
- `sourceFiles`（同文件 `:162-180`）：递归 `<pkg>/src`，手写跳过 `node_modules` / `dist`，扩展名仅 `ts|tsx|mts|cts`，`readdir` 失败时静默返回空集。

共享 helper `tests/fixtures/source-tree.mjs`（issue #350 引入）已有：`SOURCE_FILE = /\.[cm]?[jt]sx?$/`（:20，覆盖 `.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs`）、`ignoredDirectoryNames(root)`（:38，只读 `<root>/.gitignore` 的裸目录规则，缺失抛 ENOENT）、`listSourceFiles(root, scopes)`（:57，按忽略名剪枝、scope 缺失抛 ENOENT、返回 `{scope,file}` 相对 posix）、`callSites`（:75）。消费者：`scripts/resolution-check.mjs:23`、`tests/contract/host-node-types.test.js:40`、`tests/contract/source-tree.test.js`、`tests/integration/source-scan-build-output.test.js:19`、`tests/e2e/delivery-lineage.test.js:23`。

关键术语：**裸目录规则**指 `.gitignore` 里形如 `name/`（不含斜杠、通配、锚定）的行，按 git 语义匹配任意深度同名目录；**两层发现**指只认 `group/<a>` 与 `group/<a>/<b>`（group ∈ `packages`、`apps`），某层出现 `package.json` 即认定为包根并停止下钻。

已核实事实（基线 `f74a3b8b`，主检出实跑）：包根 18 个，与 `EXPECTED` 键集合差为 `[]`；18 个 `<pkg>/src` 源文件 206 个，与候选实现差为 `[]`，且 206 个全是 `.ts`；根 `.gitignore` 的忽略名 15 个，是旧本地 `{node_modules,dist}` 的超集；本机存在 `apps/harness-plugin/dist/package/package.json`（被 `dist/` 忽略，旧实现靠「`apps/harness-plugin` 自带 manifest 即停」碰巧避开，属潜在漂移）；`pnpm run boundaries` 在该残留在位时仍 10/10。技术债：`docs/exec-plan/tech-debt-tracker.md` 的 TD-087（本 issue 承接项）与 TD-086（「扫描必须经 helper」的机械守卫，明确排在本 issue 之后）。

## Design / Spec

**方案（唯一）**：在 `tests/fixtures/source-tree.mjs` 新增一个导出 `listPackageDirectories(root, groups)`；`package-boundaries` 的包发现调用它，源码枚举直接调用既有 `listSourceFiles`；删除两份本地实现与过期注释。

```js
import { existsSync, readFileSync, readdirSync } from 'node:fs'

/** 包根：group/<pkg> 或 group/<pkg>/<sub> 下带 package.json 的目录，相对 root 的 posix 路径，已排序。
 *  某层找到 manifest 即停，不再下钻；组层与嵌套层都按根 .gitignore 的裸目录规则剪枝；缺 group 抛 ENOENT。 */
export function listPackageDirectories(root, groups) {
  const ignored = ignoredDirectoryNames(root)
  const found = []
  const hasManifest = (relative) => existsSync(path.join(root, relative, 'package.json'))
  for (const group of groups) {
    for (const entry of readdirSync(path.join(root, group), { withFileTypes: true })) {
      if (!entry.isDirectory() || ignored.has(entry.name)) continue
      const direct = path.posix.join(group, entry.name)
      if (hasManifest(direct)) { found.push(direct); continue }
      for (const nested of readdirSync(path.join(root, direct), { withFileTypes: true })) {
        if (!nested.isDirectory() || ignored.has(nested.name)) continue
        const child = path.posix.join(direct, nested.name)
        if (hasManifest(child)) found.push(child)
      }
    }
  }
  return found.sort()
}
```

契约：`groups` 必填（布局策略归调用方）；返回相对 `root` 的 posix 字符串数组、已排序，可直接与 `EXPECTED` 键比较；manifest 存在性用 `existsSync`（与旧 `stat` 同语义：任何类型存在即算）；不跟随符号链接（`entry.isDirectory()` 为 lstat 语义）；缺 `group` 直接抛原生 ENOENT，不用 `exists` 守卫。文件头注释第 4 行同步从「找源码的测试」扩到「找源码或包根的测试」。

迁移映射（`package-boundaries.test.js`）：`:233` 改 `listPackageDirectories(repoRoot, ['packages','apps'])`（同步，去 `await`）；`:250` 与 `:285` 改 ``for (const { scope, file } of listSourceFiles(repoRoot, [`${dir}/src`]))``，以 ``const relative = `${scope}/${file}` `` 作为仓库相对 posix 路径、以 `path.join(repoRoot, scope, file)` 读文件；`:263` 的相对逃逸判定改为 `path.resolve(path.dirname(path.join(repoRoot, scope, file)), specifier)`；`:358` 注释里的 `sourceFiles` 改为 `listSourceFiles`。`stat/readdir/readFile` 仍被 `exists()`、壳扫描与构建脚本扫描使用，不产生死 import；`../fixtures/resolution-preflight.mjs` 仍是第一条 import。

**被放弃的方案及原因**：
1. 只迁 `sourceFiles`、包发现仅把 `node_modules` 换成 `ignoredDirectoryNames`：不满足验收「两条路径共享同一实现」，两层/manifest 策略仍散在测试里。
2. 通用 `walk(root, { scopes, groups, maxDepth, stopAtManifest })` 并合并 `host-node-types` 的递归发现：把深度/停止策略变成调用方旋钮（第二份策略），改变 Merge Gate · Boundaries 与锁文件 importers 比对语义，需 ADR 且跨 issue。
3. 以 `pnpm-workspace.yaml` 或 `pnpm-lock.yaml` importers 作权威：要 YAML 解析（依赖或手写），失败模式变成锁文件陈旧，临时夹具根没有锁文件（fixture 无法自包含），并违反「保留发现深度」。
4. `git ls-files` 作权威（#350 的 D1 已否）：需环境清洗、子目录守卫与非 git 回退，回退本身又是一份名单。
5. 保留旧函数做兼容层：仓库未正式发布、调用点只有本文件，兼容即死代码。
6. 先把 helper 移到 `scripts/lib/`：纯路径搬家，不改行为与失败模式；`scripts/resolution-check.mjs` 现有 import 是既有决策，改动须 ADR。
7. 用运行时测试证明「`package-boundaries` 没有第二份扫描」：副本与 helper 行为相同，只能写成空转测试。证据改为删除 diff + `grep` + 变异表；机械守卫属 TD-086，不在本 issue。
8. 顺手迁移 `development-local-git-source.test.js` 的本地 `sourceFiles`：验收未要求，它没有跳过名单，迁移只会把扩展名面从 `ts,mts,cts,js,mjs,cjs` 扩到含 `tsx,jsx`，零行为收益。
9. 夹具只在被忽略目录的子目录里放 manifest（如 `group/dist/pkg/package.json`）：两层定长发现下，嵌套剪枝缺失不会误报，变异存活（见 Surprises F1）。

**不变量**：I1 判定不变（包集合 18、源文件 206、`boundaries` 10/10）；I2 发现深度仍为两层且找到 manifest 即停；I3 扫描面只增不减（helper 扩展名 ⊇ 旧集合；忽略名由根 `.gitignore` 决定，⊇ 旧 `{node_modules,dist}`）；I4 唯一权威（忽略名只来自调用方 root 的 `.gitignore`，扩展名只来自 `SOURCE_FILE`，两条路径不再出现跳过名/扩展名字面量）；I5 失败闭合（缺 `.gitignore` / group / scope、目录不可读 → 抛 ENOENT/EACCES，不返回空集）；I6 无新状态无新依赖（同步、只用 `node:fs` / `node:path`、无模块级状态、每函数收 root、不跟随 symlink）；I7 生产面零改动。

## Global Constraints

- 文件集合（本 PR 只允许出现这些路径，按 PLANS.md §4 只在此处声明一次）：`tests/fixtures/source-tree.mjs`、`tests/contract/source-tree.test.js`、`tests/contract/package-boundaries.test.js`、`tests/contract/host-node-types.test.js`（仅注释第 71–72 行）、`docs/exec-plan/active/2026-11-21-shared-source-walker.md`、`tests/README.md`、`docs/exec-plan/tech-debt-tracker.md`、`docs/README.md`。
- 禁止改动：`packages/`、`apps/`、`scripts/`、`.github/`、根 `package.json`、`pnpm-lock.yaml`；不新增依赖、不新增其它文件、不写兼容层、不改 import 解析语义（模板字面量解析属 #339）、不改 C4 的 Git oracle 与独立扩展名副本（#350 的 D12）、不实现 TD-086 机械守卫。
- 体量：技术 ≤800 行、文档 ≤1300 行（仓库硬门 1000/1500）。本计划预估技术 ~105–125 行、文档 ~220–260 行；实现中若技术超过 200 行或文档超过 400 行，停止并重新裁定，不靠拆 PR 规避。
- 语言：正文中文，代码标识符、路径、命令英文；提交信息 `<type>(<scope>): <中文摘要>`，正文写为什么，含 `Closes #396`。
- 分支与工作树：`.worktrees/shared-source-walker`，分支 `chore/shared-source-walker`，base `main`（写作时 `f74a3b8b`，以 `git merge-base` 实际值为准）。一个 PR 独立验收、合并、回滚。
- TDD：先有能红的断言，再实现；不削弱既有断言；只新增判别性用例，不为凑行数补测试。

## Plan of Work

### Batch 0 · 对齐与基线（0 tracked 行）

**最小闭环**：在隔离工作树里跑通基线，记录后续对照用的读数。
**涉及文件**：无（工作树与依赖安装）。
步骤：`git fetch origin`；`git worktree add .worktrees/shared-source-walker -b chore/shared-source-walker origin/main`；在该工作树根目录 `pnpm install --frozen-lockfile`（新建工作树没有 `node_modules`，不装会让裸包名解析到主检出、红基线无效）。依次执行 V1、V2、V3、V4、V7、V8，把 V7 的 `ℹ tests` 数值与耗时记入 Progress，作为 B3 之后「只多 2 条」的对照。写作时本机首次整跑 V8 在 `tests/contract/ui-safe-markdown.test.js` 出现一次与本改动无关的 `spawnSync ... ETIMEDOUT`（该文件单独复跑 18/18 通过，`pnpm run typecheck` 通过）；V8 基线以单独复跑后的结论为准，并把这次观察记入 Surprises。
**验证**：V1、V2、V3、V4、V7、V8（命令与期望见 Validation and Acceptance）。
**回滚**：无改动；如需重来，`git worktree remove .worktrees/shared-source-walker --force` 后重建。

### Batch 1 · 计划落档（文档）

**最小闭环**：实现开始前仓库里已有可审阅的 ExecPlan 与索引。
**涉及文件**：本计划、`docs/README.md`（Active 表一行）。
步骤：把本文件落到 `docs/exec-plan/active/2026-11-21-shared-source-walker.md`；在 `docs/README.md` §2 的 Active 表加一行指向它，用途写「包边界两处扫描改走共享源码树 helper、删除本地跳过名单（#396）」。
**验证**：V13（此时 diff 只含这两个文档文件）。
**回滚**：`git revert` 本批提交（纯文档，无代码牵连）。

### Batch 2 · helper 新增导出 + 判别夹具（红 → 绿）

**最小闭环**：新增 API 被隔离夹具钉住，且 8 个定向变异全部可杀。
**涉及文件**：`tests/fixtures/source-tree.mjs`、`tests/contract/source-tree.test.js`。
步骤：
1. 先改 `tests/contract/source-tree.test.js`：import 增加 `listPackageDirectories`；新增 C7、C8；C3 标题改为「缺 .gitignore、缺 scope 或缺 group 时抛错，不悄悄返回空集」并追加 2 条 `assert.throws(..., { code: 'ENOENT' })`（原 3 条断言保留）。C7 夹具 `.gitignore = 'node_modules/\ndist/\nbuild/\n'`，文件：`apps/app-a/package.json`、`packages/build/package.json`、`packages/direct/package.json`、`packages/direct/inner/package.json`、`packages/group/build/package.json`、`packages/group/deep/mid/package.json`、`packages/group/node_modules/dep/package.json`、`packages/group/pkg/package.json`，断言恰为 `['apps/app-a','packages/direct','packages/group/pkg']`。C8 夹具 `.gitignore = 'artifacts/\n'`，文件 `packages/p/dist/package.json`、`packages/q/artifacts/package.json`，断言恰为 `['packages/p/dist']`。
2. 跑 V4 记录红：模块加载失败 `SyntaxError: The requested module '../fixtures/source-tree.mjs' does not provide an export named 'listPackageDirectories'`。再加一个空桩 `export function listPackageDirectories() { return [] }`，再跑 V4 应得 `ℹ tests 14 / ℹ pass 11 / ℹ fail 3`（C3、C7、C8 红），把两段输出记入 Progress。
3. 按 Design / Spec 实现（含 `existsSync` import 与文件头注释），跑 V4 期望 14/14 绿。
4. 变异验证（每次改一处、跑 V4、随后 `git checkout -- tests/fixtures/source-tree.mjs` 逐字节还原，结果写进 Surprises & Discoveries 的变异表）：K1 去掉两层剪枝、K2 只在组层剪枝、K3 只在嵌套层剪枝、K4 换硬编码 `{node_modules,dist}`、K5 只发现一层、K6 找到 manifest 仍下钻、K7 用主检出 `.gitignore` 而非传入 root、K8 把 `SOURCE_FILE` 换回旧本地集合 `/\.(ts|tsx|mts|cts)$/`。前 7 个期望 C7 或 C8 红（K4/K7 红 C8，其余红 C7），K8 期望既有用例「共享源码集合覆盖 package-boundaries 与 local-git 扫描的扩展名」红（期望 4 个文件只得 `cts/mts` 2 个）。
**验证**：V4；K1–K8 的失败必须点名具体用例（红在 C7/C8/既有扩展名用例，不得红在无关用例）。
**回滚**：`git revert` 本批提交。该批无消费者，helper 与夹具可独立存在。

### Batch 3 · 迁移两处扫描（闭环 #396 的核心）

**最小闭环**：`package-boundaries` 只剩 helper 调用，判定与迁移前一致。
**涉及文件**：`tests/contract/package-boundaries.test.js`、`tests/contract/host-node-types.test.js`（仅注释）。
步骤：
1. 删除 `findPackageDirs`（137–160，含注释）与 `sourceFiles`（162–180）；按 Design / Spec 的迁移映射改 `:233`、`:250`、`:263`、`:285` 与 `:358` 注释；新增 `import { listPackageDirectories, listSourceFiles } from '../fixtures/source-tree.mjs'`，位置在 `resolution-preflight.mjs` 与 node 内建 import 之后。
2. 改 `tests/contract/host-node-types.test.js:71-72` 注释：删除对 `findPackageDirs` 与「D5 留给后续 PR」的引用，保留「本文件递归、含根 `.`，与两层语义不同」的事实；不动任何代码。
3. 检查扫描路径无本地名单：`grep -nE "node_modules|dist" tests/contract/package-boundaries.test.js` 期望无输出（grep 无命中时 exit 1，属期望）；`grep -nE "findPackageDirs|function sourceFiles|await sourceFiles\(" tests/contract/package-boundaries.test.js` 期望无输出。
4. 跑 V3、V4、V5、V6、V7；V3 必须在 `apps/harness-plugin/dist/` 在位时也 10/10（这是「忽略残留不算脏」的观察，不作为结构证据）。把当前树的包集合与源文件集合对照（18 个包根、206 个文件、差集为空）用一次性 `node --input-type=module -e` 探针复跑并记入 Progress，探针不落盘、不提交。
**验证**：V3、V4、V5、V6、V7；上述两条 `grep` 无命中；V13 只出现本批两个文件。
**回滚**：`git revert` 本批提交即恢复两处手写扫描；B2 的 helper 可独立保留（无消费者）。若先回滚 B2 而不回滚 B3，`package-boundaries` 会 import 缺失导出——撤销顺序必须 B3 先于 B2。

### Batch 4 · 文档收尾与最终门禁

**最小闭环**：文档事实与代码一致，仓库级门禁全绿，PR 可独立验收。
**涉及文件**：`tests/README.md`、`docs/exec-plan/tech-debt-tracker.md`、`docs/README.md`（归档前仍为 Active 行）、本计划（回填 Progress/Surprises/Decision Log/Outcomes）。
步骤：
1. `tests/README.md` §3 那条规则从「遍历 packages/、apps/ 找源码的扫描」扩到「找源码或包根的扫描」，并在括号清单里加入 `listPackageDirectories`。
2. tracker：把 TD-087 行从 Open Items 移到 Resolved Items，状态改 `Resolved`，简述/下一步写明已迁移内容 + 本 PR 号 + 复核命令；TD-086 保持 `Open`，其「下一步」补一句「#396 已迁完两处手写遍历，机械守卫仍归后续 issue」。
3. 回填本计划：Progress 勾选并写日期与读数；Surprises 补实现期新发现；Decision Log 追加实现期决策；Outcomes 写实际结果与偏差。
4. 依次跑最终门禁并记录输出。
**验证**：V8、V9、V10、V11、V12、V13（命令与期望见 Validation and Acceptance）。
**回滚**：`git revert` 文档提交；代码批次保留。TD-087 若已移到 Resolved 而代码被回滚，必须同时把该行移回 Open（文档与代码同一 PR 合并，正常不会出现）。

## Validation and Acceptance

以下命令都在检出 `chore/shared-source-walker`（工作树 `.worktrees/shared-source-walker`）的工作树根目录执行；写作时 base 为 `f74a3b8b`，base 前进后以实际 `git merge-base origin/main HEAD` 复核行号。命令只在此处定义，批次按编号引用。

| ID | 命令 | 期望输出 |
|---|---|---|
| V1 | `git rev-parse HEAD` | 与 `git rev-parse origin/main` 相同（写作时观察值 `f74a3b8b`；易失值以实际为准） |
| V2 | `pnpm install --frozen-lockfile` | exit 0；工作树内解析到本检出的 workspace 包 |
| V3 | `pnpm run boundaries` | `ℹ tests 10`、`ℹ pass 10`、`ℹ fail 0`，exit 0 |
| V4 | `pnpm test:file tests/contract/source-tree.test.js` | `ℹ tests 14`、`ℹ pass 14`、`ℹ fail 0` |
| V5 | `pnpm test:file tests/contract/package-boundaries.test.js` | `ℹ tests 10`、`ℹ pass 10`、`ℹ fail 0` |
| V6 | `pnpm test:file tests/contract/host-node-types.test.js` | `ℹ tests 5`、`ℹ pass 5`、`ℹ fail 0` |
| V7 | `pnpm test:contract` | exit 0；`ℹ fail 0`；`ℹ tests` 比 Batch 0 基线恰多 2 |
| V8 | `pnpm verify` | exit 0（typecheck 加契约/集成/端到端三层全绿）；失败时先判断是否与本改动相关，无关的环境性超时按 Idempotence and Recovery 处理 |
| V9 | `node scripts/policy-check.mjs` | exit 0，无输出 |
| V10 | `node scripts/rule-checks.mjs size origin/main` | exit 0；技术 ≤800、文档 ≤1300（脚本报告的两列均在限内） |
| V11 | `node scripts/rule-checks.mjs disclosure origin/main` | exit 0，无命中 |
| V12 | `git diff --check origin/main...HEAD` | 无输出 |
| V13 | `git diff --stat origin/main...HEAD` | 只出现 Global Constraints 的文件集合；无 packages/、apps/、scripts/、.github/、package.json、pnpm-lock.yaml |

验收标准到证据的对应（不重复命令）：AC「两条路径共享同一实现、无本地跳过名单」→ B3 的两条 `grep` 无命中 + V13 的删除 diff；AC「现有判定不变」→ V3、V5 与 B3 步骤 4 的 18/206 探针读数；AC「夹具能在忽略来源、扩展名、嵌套发现被改坏时失败」→ V4 加 B2 步骤 4 的 K1–K8 变异表；AC「记录确切命令与结果、不新增生产代码或依赖」→ V8–V13 与 V13 的文件集合核对。全部通过后由人类评审决定合并（仓库规则：agent 不自行合并）。

## Progress

- [x] Batch 0 对齐与基线（2026-11-21，工作树 `.worktrees/shared-source-walker`）：`pnpm install --frozen-lockfile` exit 0；V3 `ℹ tests 10 / pass 10 / fail 0`；V4 `ℹ tests 12 / pass 12 / fail 0`；V7 基线 `ℹ tests 1620 / pass 1613 / fail 7`（7 条全是高负载下的子进程期限断言，见 F10）；V8 基线未整跑（同机四路实现并行，见 F10），终局按 V8 整跑一次
- [x] Batch 1 计划落档（2026-11-21，commit d899e16f：本计划 + `docs/README.md` Active 行）
- [x] Batch 2 helper 与夹具（2026-11-21）：V4 先 `SyntaxError: ... does not provide an export named 'listPackageDirectories'`，再空桩 `ℹ tests 14 / pass 11 / fail 3`（C3/C7/C8 红），实现后 `ℹ tests 14 / pass 14 / fail 0`；K1–K8 全部被杀死，见 F9
- [ ] Batch 3 迁移两处扫描（未开始；需记录 grep 与 18/206 对照）
- [ ] Batch 4 文档与最终门禁（未开始；需记录 V8–V13 输出）
- [ ] PR 创建与回读（未开始；draft PR 关联 #396，最终 push 后回读 head/base/checks/issue 关联）

## Surprises & Discoveries

- F1（夹具判别力缺口，2026-11-21 独立复核，已在 `main@f74a3b8b` 用一次性探针实测）：两份设计稿的候选夹具都只在被忽略目录的**子目录**里放 manifest（如 `group/dist/pkg/package.json`）。两层定长发现下「删掉嵌套层剪枝」的变异会存活（探针结果为 SURVIVED），因为实现只检查被忽略目录本身是否有 manifest，不会继续下钻。修法：夹具把 `package.json` 直接放在被忽略目录里（`packages/build/package.json`、`packages/group/build/package.json`），这也是 C7 采用加强夹具的原因。
- F2（陈旧引用，源码核对）：迁移会删除 `findPackageDirs`，但 `tests/contract/host-node-types.test.js:71-72` 的注释仍拿它做对照并写「D5 把它们留给后续 PR」。不一起改会留下指向已删除标识符的注释；本计划按注释级改动纳入 B3。
- F3（陈旧引用，源码核对）：`tests/contract/package-boundaries.test.js:358` 的注释写「不用 sourceFiles」，删函数后必须改为 `listSourceFiles`，否则同文件内自相矛盾。
- F4（行号微差）：`findPackageDirs` 的函数体是 138–160，137 是块注释；两份设计稿分别写 137–160 / 138–160，都对但指代不同。本计划按「137–160 含注释」删除。
- F5（忽略残留本机可见）：写作时主检出存在 `apps/harness-plugin/dist/package/package.json`，`git check-ignore` 命中 `.gitignore` 第 12 行 `dist/`，而 V3 基线仍 10/10——说明「有残留仍绿」只能证明未误报，不能证明「只剩一份实现」。
- F6（范围外第二实现）：`tests/contract/development-local-git-source.test.js:20-28` 仍有自己的 `sourceFiles`（无跳过名单，扩展名集合是 helper 真子集），`host-node-types.test.js:74-91` 有递归版包发现。两者本 PR 不改，理由见 Design / Spec 被放弃方案 8 与 Decision Log D6。
- F7（设计稿偏差）：设计稿 a 的安装命令用 `--offline`，不是本仓 workflow 的写法；设计稿 b 主张「缺 group 时跳过」，与 helper 既有失败闭合契约不一致。均按 Decision Log D3/D4 处理。
- F9（B2 变异表，2026-11-21 在 `.worktrees/shared-source-walker` 实跑）：每次只改 `tests/fixtures/source-tree.mjs` 一处、跑 V4、用 `/tmp` 下的 green 副本逐字节还原并核对 `RESTORED_IDENTICAL=true`；还原后复跑 V4 回到 14/14。实际结果（比计划预期更严）：
  | 变异 | 内容 | V4 结果 | 被杀的用例 |
  |---|---|---|---|
  | K1 | 去掉组层与嵌套层剪枝 | 14 / pass 12 / fail 2 | C7、C8 |
  | K2 | 只在组层剪枝（嵌套层不剪） | 14 / pass 12 / fail 2 | C7、C8 |
  | K3 | 只在嵌套层剪枝（组层不剪） | 14 / pass 13 / fail 1 | C7 |
  | K4 | 换硬编码 `{node_modules,dist}` | 14 / pass 11 / fail 3 | C3、C7、C8 |
  | K5 | 只发现一层（删嵌套循环） | 14 / pass 12 / fail 2 | C7、C8 |
  | K6 | 找到 manifest 仍下钻 | 14 / pass 13 / fail 1 | C7 |
  | K7 | 用主检出 `.gitignore` 而非调用方 root | 14 / pass 12 / fail 2 | C3、C8 |
  | K8 | 扩展名换回旧本地集合 `/\\.(ts\|tsx\|mts\|cts)$/` | 14 / pass 12 / fail 2 | 「共享源码集合覆盖…扩展名」、C4 |
  说明：计划预期「K4/K7 红 C8、其余红 C7」；实际 K4 额外红 C3（硬编码不再读 `.gitignore`，缺文件时不抛 ENOENT）、K7 额外红 C3（换成存在的主检出 root 后夹具缺 `.gitignore` 也不再抛 ENOENT）、K8 额外红 C4（Git 可见的 `.js/.mjs` 源码漏项）。更强不改变结论：8 个变异无一存活。
- F10（基线门禁在共享机器高负载下的观察，2026-11-21）：Batch 0 时同机有四个实现者并行跑测试，`load averages` 约 280/310/300（10 核）。V7 基线 `pnpm test:contract` 得 `ℹ tests 1620 / pass 1613 / fail 7`，7 条全是子进程期限类断言（`W3：step 的畸形长引用有界拒绝` 的 5 s `spawnSync` 超时、`spec 不合法…` 31.6 s、浏览器用例 2.6–5.0 s）；`pnpm test:file tests/contract/workflow-check.test.js` 单独复跑 55/55 绿。结论同 F8：属环境性超时，不是基线回归。V8 基线因同机四路整测并发被主动中止，终局只整跑一次 V8（失败时按 Idempotence and Recovery 先复跑命中文件再判断）。
- F8（基线门禁的环境敏感性，2026-11-21 实测）：在主检出跑 V8 时，`tests/contract/ui-safe-markdown.test.js` 的一次 `spawnSync` 子进程触发 `ETIMEDOUT`（`execFileSync` 传入 200000 字符输入），同文件单独复跑 `ℹ tests 18 / ℹ pass 18 / ℹ fail 0`，`pnpm run typecheck` 也通过。结论：该失败与本改动无关，属高负载下的既有超时；Batch 0 的 V8 基线按「单独复跑该文件」的结论记录，最终门禁遇到同类现象时先复跑再判断，不把它当作 #396 的回归。

## Decision Log

- D1（2026-11-21，spec-396 独立评审）：新增导出命名 `listPackageDirectories(root, groups)`，`groups` 必填、无默认值、无选项袋。Rationale：与既有 `ignoredDirectoryNames` / `listSourceFiles` 的全词命名一致；布局策略属于调用方，helper 不内置 `['packages','apps']`。
- D2（2026-11-21，spec-396）：返回相对 root 的 posix 字符串数组并排序。Rationale：`EXPECTED` 键与 `HOST_ENTRY.files` 都是 posix 仓库相对路径；`path.relative` 在 Windows 产反斜杠，posix 拼接与既有数据形态一致。
- D3（2026-11-21，spec-396）：manifest 存在性用 `existsSync`。Rationale：与旧实现 `stat` 语义逐字一致（目录名为 `package.json` 也算存在），避免用 `entry.isFile()` 引入未被要求的行为变化。
- D4（2026-11-21，spec-396，人类可推翻）：缺 group 目录时**抛原生 ENOENT**，不加 `existsSync` 守卫、不返回空集。Rationale：与 C3 / `listSourceFiles` 的失败闭合契约同构，少 2 行守卫，坏树给出具体路径；旧实现在该场景同样红（`found.length` 断言），因此可观察判定不变。该差异是本次唯一真实行为变化，需人类在验收时确认。
- D5（2026-11-21，spec-396）：包发现与源码枚举都按根 `.gitignore` 剪枝，**组层与嵌套层都剪**。Rationale：这是 issue 说的「漂移」根因；只剪一层会让「被忽略目录里恰好有 manifest」再次冒充包根。今天验证无判定变化（18 个包根差集为空）。
- D6（2026-11-21，spec-396）：`host-node-types` 的递归包发现、`development-local-git-source` 的本地扫描不迁移；TD-086 机械守卫不实现。Rationale：验收只点名 `package-boundaries` 两条路径；合并/新增守卫都需先决定语义（递归 vs 两层、守卫判定标准），属独立 issue，混入会超出预算并降低可回滚性。
- D7（2026-11-21，spec-396）：不新增运行时测试来证明「没有第二份实现」。Rationale：helper 与副本行为相同，任何断言都只能空转；证据用删除 diff、`grep` 与变异表，机械守卫由 TD-086 承接。
- D8（2026-11-21，spec-396）：`tests/contract/host-node-types.test.js` 只改注释 2 行。Rationale：避免仓库内出现指向已删除标识符的引用；不改变任何断言与扫描行为，属同一迁移的必要收尾。
- D9（2026-11-21，spec-396）：TD-087 在本 PR 内移入 Resolved；TD-086 保持 Open 并更新下一步。Rationale：tracker 允许随 PR 关闭，但要求当前 head 的验证证据；TD-086 的触发条件刚满足，其判定标准尚未裁决。
- D10（2026-11-21，Lead 裁决 Q1，直接采用不再讨论）：**接受缺 group 目录抛原生 ENOENT（fail-closed）**。这是 D4 的最终确认：不加 `existsSync` 守卫、不返回空集；C3 用两条 `assert.throws(..., { code: 'ENOENT' })` 钉住，K4/K7 证明守卫消失时它会红。
- D11（2026-11-21，Lead 裁决 Q2）：**不得用「本机有 `dist` 残留仍绿」冒充结构证据**。`pnpm run boundaries` 10/10 只作「未误报」观察；「两条路径只剩一份实现」的判别力来自 C7/C8 夹具（K1–K8 变异表，F9）与删除 diff + 两条 `grep` 无命中，不来自任何运行期测试。
- D12（2026-11-21，Lead 裁决 Q3）：TD-087 在本 PR 标记 `Resolved`，但**不**把 `host-node-types` 的递归包发现与 `development-local-git-source` 的本地扫描并入，也不为本项新建 issue；理由与残余统一写进本计划的 Outcomes 与 tracker 说明（复用 D6 的边界）。
- D13（2026-11-21，实现期）：B2 的变异还原用 `/tmp` 下的 green 副本 `cp` 回写，而不是 `git checkout -- tests/fixtures/source-tree.mjs`——变异阶段实现尚未提交，`git checkout` 会连实现一起丢弃。每次还原后核对 `RESTORED_IDENTICAL=true` 并复跑 V4 回到 14/14。

## Idempotence and Recovery

- 所有扫描是纯静态、无持久化、无外部写入、无凭据；重复执行命令结果相同，适合反复跑。
- V8 是本仓唯一对子进程负载敏感的门禁：`tests/contract/ui-safe-markdown.test.js` 会 `spawnSync` 一个处理 200000 字符输入的子 Node 进程，在机器高负载时可能 `ETIMEDOUT`。处理规则：先单独跑 `pnpm test:file tests/contract/ui-safe-markdown.test.js`，若 18/18 通过则记录「负载超时、非本改动回归」并继续；若复跑仍红，按真实失败处理。
- 每个夹具都用 `mkdtempSync` 建临时根并在 `t.after` 里 `rmSync`；测试中断只留下系统临时目录下的残留，不影响检出。
- 变异验证必须「一处改动 → 跑 V4 → `git checkout -- tests/fixtures/source-tree.mjs` 还原」，还原后复跑 V4 必须回到 14/14；若还原后 `git diff -- tests/fixtures/source-tree.mjs` 非空，说明还原失败，先处理再继续。
- 批次失败恢复：`git status --short` 确认改动面；`git checkout -- <path>` 丢弃单文件试改；`git reset --hard <上一批提交>` 回到已知良好状态（只在本分支、未推送时使用）。
- 撤销顺序：B4 → B3 → B2 → B1。B3 依赖 B2 的新导出，先撤 B2 会让 `package-boundaries` 加载失败；B2 独立于 B3，可单独保留。
- 合并后清理：`git worktree remove .worktrees/shared-source-walker`（仅在分支已合并、无未提交改动时），并按 `AGENTS.md` §6 由人类决定是否清理分支。
- 回滚整 PR：`git revert` 合并提交即可恢复两处手写扫描；无数据迁移、无外部状态、无 CI 配置变化，回滚是纯代码回退。

## Interfaces and Dependencies

- 运行时：Node ≥ 22（`node:test`、`mkdtempSync`、`readdirSync` 的 `withFileTypes`）；pnpm 10.28.2（`packageManager` 字段）；不需要网络、凭据或外部服务。
- helper 依赖：仅 `node:fs`、`node:path`；新增 import 只有 `existsSync`；无模块级状态；不调用 git。
- 新接口契约：`listPackageDirectories(root: string, groups: string[]) => string[]`，返回相对 `root` 的 posix 路径、升序、只含带 `package.json` 的包根；缺 `group` 或根 `.gitignore` 缺失时抛 `ENOENT`；不跟随 symlink。
- 调用方：`tests/contract/package-boundaries.test.js`（唯一新调用方）；`tests/contract/source-tree.test.js`（夹具契约）。既有 `listSourceFiles` / `ignoredDirectoryNames` / `callSites` 契约不变，故 `scripts/resolution-check.mjs`、`tests/contract/host-node-types.test.js`、`tests/integration/source-scan-build-output.test.js`、`tests/e2e/delivery-lineage.test.js` 无需改行为。
- 测试入口约定：每个受管 `tests/**/*.test.js` 的第一条 import 必须是 `../fixtures/resolution-preflight.mjs`；本 PR 新增的 import 放在其后。
- CI：必需检查只有 `PR Fast Gate`（聚合 job）；本 PR 不新增/修改 workflow，不改变检查名与分支保护。

## Outcomes & Retrospective

状态：计划创建（2026-11-21），尚未开始实现。完成后在此写实际结果、与计划的偏差（体量、变异存活项、失败路径变化是否被人类接受）与遗留问题（TD-086 机械守卫、`development-local-git-source` 与 `host-node-types` 的两处未统一实现），以及验收时人类对 Decision Log D4 的确认结论。判定完成的标准是 Validation and Acceptance 的 V1–V13 全部通过且人类评审结束。

## Bottom Change Note

- 2026-11-21：创建本计划（spec-396 独立评审）。依据 issue #396 与两份独立设计稿复核源码后收敛：确定单函数 API、迁移映射、加强后的 C7/C8 夹具（修正两稿的嵌套剪枝判别力缺口）、失败闭合语义、4 个批次与 V1–V13 验证命令；记录 7 条 Surprises 与 9 条 Decision。
