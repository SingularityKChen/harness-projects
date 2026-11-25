# PR #687 MMP 独立验收：Node 运行时契约

评审日期：2026-11-24（Asia/Singapore）。角色：独立对抗验收（不是实现者、未参与本分支实现）。对象：PR #687 `chore(repo): align the Node support contract with execution modes`，分支 `chore/node-runtime-contract-20261124` → `main`，关联 issue #313。执行上下文：仓库内 `.worktrees/iteration12-node-runtime-contract`（检出 PR 分支），Node v26.13.1（`process.features.typescript === 'strip'`）、pnpm 10.28.2、TypeScript 5.9.3。

**结论：APPROVE WITH NOTES。** 无 P0/P1；1 条 P2、3 条 P3，均不阻塞交付。这不是人类评审、R1/UAT 或合并批准；#313 由 PR body 的 `Closes #313` 在合并时关闭，合并由人类伙伴决定。

## 1. 锁定事实

- PR 面：`isDraft=true`、`baseRefName=main`、`headRefOid=c03d7dec307defe9867bfdfbe011dfa8ce68d65e`、`mergeable=MERGEABLE`、`mergeStateStatus=BLOCKED`（draft 且无批准）、`closingIssuesReferences=[#313]`；reviews / inline comments / conversation comments 均为 0。
- head 一致性：`git ls-remote origin refs/heads/chore/node-runtime-contract-20261124` → `c03d7dec307d…`；工作树 `git rev-parse HEAD` 同值；本地 `main` = `eadf490183c3…` 就是 PR base，且是 head 的祖先。
- diff 一致性：`gh pr diff 687` 与 `git diff eadf4901...HEAD` 均为 793 行，去掉 `index` 行后逐行相同（`diff` 退出 0）。本记录对该 diff 独立通读 14 个文件，不采信实现者摘要。
- 文件集合：14 个路径，与 ExecPlan `Global Constraints` 逐项相同——`package.json`、`tsconfig.base.json`、`apps/harness-plugin/scripts/build.mjs`、`tests/contract/runtime-support.test.js`、负控夹具 2 个、`docs/development/runtime-support.md`、`docs/development/README.md`、`docs/architecture/release-gates.md`、`docs/product/vertical-path.md`、ADR-0009、`docs/exec-plan/active/2026-09-29-…`、新 ExecPlan、`docs/README.md`。无 `.github/workflows/**`、无锁文件、无产品源码改动（`build.mjs` 只改注释，常量未动）。
- 提交：6 个（`6f89804f`→`c03d7dec`），标题均为 Conventional Commits，正文以 `Refs #313` 结尾，无 debug/fixup/临时提交。
- checks（head `c03d7dec`）：`Verify（typecheck + 契约测试）`、`Browser`、`Windows Native`、`PR Fast Gate`、CodeQL、Rule checks、Disclosure scan、PR size 均 pass。
- 精确规模：`node scripts/rule-checks.mjs size eadf4901` → 代码 278/1000、文档 386/1500；`disclosure` 通过；`git diff --check eadf4901...HEAD` 无输出。

## 2. P0–P3 风险矩阵

| 等级 | 代码 / 正确性 | 产品 / 架构 | 测试 / 判别力 | 工作项 / 发布面 | 本轮结果 |
|---|---|---|---|---|---|
| P0 | 合并即破坏 main、破坏硬约束 | 篡位规划/权威状态、破坏 Host ABI | 损坏真实产物 | 越权写入、无关文件 | 无；无产品行为、schema、数据、Host 常量变更 |
| P1 | 声明与实跑矛盾、守卫无效 | source / compiled Host 两种模式被混写 | 测试空转或只跑通无断言 | 与 #313 验收不符 | 无；独立复核见 §3 |
| P2 | 判别力缺口（文档绑定） | 文档可静默漂移 | 测试 7 的 `.nvmrc` 值绑定可被同一行使假（P2-1） | — | 1 条，非阻塞 |
| P3 | 维护性 | 历史事实注记、措辞 | 新 workflow 覆盖面 | 计划证据、文档措辞 | 3 条，非阻塞 |

## 3. 契约正确性独立复核（不采信摘要）

**事实分工。** `engines.node`（source 下界）、`.nvmrc`（执行行）、`build.mjs` 的 `HOST_NODE_TARGET`/`HOST_NODE_VERSION`（Host 目标与宿主版本）、根 `@types/node`（类型上限）、`.github/workflows/*.yml`（接线）各自仍是唯一机械源；新文档只解释这些值，由测试逐值绑定，未新增运行时就绪表或第二份常量。此点成立。

**逐条独立复核（在工作树根目录实跑）：**

1. **engines/.nvmrc**：`engines.node=">=26.0.0"`、`.nvmrc="26"`，major 相同；测试 1 还会比对 18 个磁盘包名与根 `devDependencies` 的 `@harness-projects/*` 集合。M1/M2 证明有判别力。
2. **CI setup-node 全量解析**：不靠白名单。测试 2 `readdirSync` 全部 7 个 workflow 后用 `yaml.parse` 递归找 `actions/setup-node@`，共 8 个 step，全部 `node-version-file: .nvmrc`、无内联 `node-version`；新增一个带内联版本的全新 workflow 后只打红测试 2（M3）。实测 `issue-policy.yml`/`github-review.yml` 无 setup-node，文档 §7 把它们登记为契约外未验证项，与事实相符。
3. **声明行下界**：测试 3 按逐段 `>=` 比较 `process.versions.node` 与 `>=26.0.0`，并断言 `process.features.typescript === 'strip'`。用 `npx -y node@24.18.1` 跑同一契约 → 6 pass / 1 fail，唯一红项是测试 3，消息打印真实 `Node 24.18.1`（M8），说明下界按运行时生效。
4. **编译期守卫**：测试 4 用 TypeScript API 解析根 `tsconfig.json`（走 `extends`），断言 `parsed.options.erasableSyntaxOnly === true`；`pnpm typecheck` 实际退出 0。删掉该 flag 后测试 4、5 同时红（M2）；在 `packages/domain/src/index.ts` 加 `export enum RuleProbe` 后 `tsc --noEmit` 报 `packages/domain/src/index.ts(16,13): error TS1294`、退出非 0（M5）。
5. **负控只接受 TS1294**：直接跑夹具 tsconfig → 退出 2、stdout 恰好 3 条 `probe.ts(4,13)/(8,18)/(13,15): error TS1294`、stderr 空、无其他错误码。把夹具 `extends` 改成缺失文件后，测试 5 红且消息给出 `actual: ['5083']`（M6），证明“其他错误码会失败、配置错误不能假绿”有牙。
6. **真实 import 全部 exports 子路径**：独立计数 18 个 workspace 包共 **24** 个 exports 子路径（`.` 之外 6 个：capabilities/keys、client/keys、client/delivery、controller/keys、controller/values、domain/values），测试逐个 `await import()` 且拒绝非 `./src/*.ts(x)` 目标；把 `packages/domain` 的 `./values` 目标改成缺失文件后测试红（M-export）。不是按包名白名单。
7. **文档表**：`tableRows` 解析确实非空转——把 source 行 engines 值改成 `>=25.0.0` 后测试 7 单独红（M4）。但 `.nvmrc` 单元格是子串匹配，见 P2-1。

**Host 面保持。** `build.mjs` 只改 D26 注释，`HOST_NODE_TARGET='node22'`、`HOST_NODE_VERSION='24.18.1'`、`@types/node ~24.13.5` 与 `tests/contract/host-node-types.test.js` 均未改；文档 host 行引用的 artifact 用例标题 `c. 宿主半边是 Node 可直接加载的 JS` 实际存在（`tests/integration/harness-plugin-artifact.test.js:259`）。

**门禁实跑。** `pnpm typecheck` 退出 0；`node --test tests/contract/runtime-support.test.js` → 7 pass / 0 fail；`pnpm test:contract` → 1632/1632、0 fail；`pnpm run boundaries` → 10/10；`node scripts/workflow-check.mjs` → `no findings（已检查 7 个文件）`；`pnpm verify` 退出 0（e2e 226/226；PR 面 Verify lane 亦 pass）。

## 4. 判别力变异表（独立执行，逐条还原）

| ID | 独立变异 | 观察结果 | 还原 |
|---|---|---|---|
| M1 | `package.json` engines 改回 `>=22.0.0` | 测试 1 + 测试 7 红（测试 7 的连带是设计内的配置↔文档耦合） | 5 pass / 2 fail；`git checkout --` 后 7/7、`git status` 干净 |
| M2 | 删 `tsconfig.base.json` 的 `erasableSyntaxOnly` | 测试 4、5 红，其余绿 | 同上 |
| M3 | 新增 `.github/workflows/zz-probe.yml`，其 setup-node 写内联 `node-version: 24` | **只**测试 2 红（证明解析全部 workflow，不是白名单） | 同上 |
| M4 | 文档 source 行 `engines.node` 值改 `>=25.0.0` | **只**测试 7 红 | 同上 |
| M5 | `packages/domain/src/index.ts` 追加 `export enum RuleProbe { A }` | `tsc --noEmit` 报 TS1294、退出非 0 | 同上 |
| M6 | 负控夹具 `extends` 改为缺失文件 | 测试 5 红，错误码 `['5083']`（非 TS1294） | 同上 |
| M7 | 文档 source 行 `.nvmrc` 值 `26`→`24`（再试 `27`） | **7/7 全绿**：该单元格未被绑定（P2-1） | 恢复后 7/7 |
| M8 | `npx -y node@24.18.1 --test tests/contract/runtime-support.test.js` | 6 pass / 1 fail，唯一红项测试 3，打印真实运行时版本 | 无文件改动 |

每条变异都先确认 `git diff` 非空、还原后 `git status --porcelain` 为空；全部还原完成后工作树干净（本记录提交前复核）。

## 5. 发现（1 × P2 + 3 × P3，均非阻塞）

### P2-1 · 文档模式表的 `.nvmrc` 值绑定可被同一行文本满足

- 位置：`tests/contract/runtime-support.test.js:233-235`（`row.includes(value)`）对应 `docs/development/runtime-support.md:12` 的 source 行。
- 缺陷：测试标题声称“模式表逐值等于代码来源”，但绑定是**整行子串**判断。source 行同时含 `>=26.0.0`，因此把 `.nvmrc` 单元格改成 `24` 或 `27` 后，`row.includes('26')` 仍由 engines 值满足，测试 7 保持绿（M7 实测 7/7）。
- 影响：AC4 要求的“CI/文档精确说明实际验证的版本”在文档侧少了一处机械守卫：source 行的执行值可以静默漂移而不触发红；测试的“逐值等于”声明对 `.nvmrc` 不成立（engines、HOST_*、@types 三项仍有效，M1/M4 已证明）。
- 证据：在 `chore/node-runtime-contract-20261124` @ `c03d7dec` 的执行上下文内改 `docs/development/runtime-support.md` 后跑 `node --test tests/contract/runtime-support.test.js` → 7 pass / 0 fail；恢复后同样 7/7。
- 修复方向：改成“标签=值”成对/单元格精确断言，例如解析 `` `.nvmrc` = `([^`]+)` `` 后 `assert.equal`，或断言完整片段 `` `.nvmrc` = `26` ``；同时可把 host 行三个值按同样方式收紧，避免未来值互相包含时再出现同类假绿。

### P3-1 · ExecPlan 的规模证据与最终 head 不一致

- 位置：`docs/exec-plan/active/2026-11-24-node-runtime-contract.md:262` 记“文档 370”，但当前 head `c03d7dec` 实测 `文档：386 / 1500`（差异来自最后一条收口提交自身增行）；PR body 已正确写 386。
- 影响：读者只读计划会看到与当前树不一致的易失证据；不改变阈值结论（386 < 1500）。
- 修复方向：把 370 改为 386，或按 `PLANS.md` §4 给该值补观察时点与重算命令。

### P3-2 · 文档把 CI verify lane 写成直接跑 `pnpm verify`

- 位置：`docs/development/runtime-support.md:12` 与 `:70`。
- 事实：`.github/workflows/ci.yml` 的 verify job 分两步执行 `pnpm typecheck` 与 `pnpm test`，并未调用 `pnpm verify` script；二者命令集合等价（`verify = typecheck && test`）。
- 影响：措辞与真实 CI 命令不完全一致，读者按字面回读会找不到 `pnpm verify` 这一步；不影响证据成立。
- 修复方向：写成“依次执行 `pnpm typecheck` 与 `pnpm test`（等价于 `pnpm verify`）”。

### P3-3 · 契约只固定“出现 setup-node 的步骤”，不覆盖“跑 node 但不接 setup-node”的新 workflow

- 位置：测试 2 的扫描范围（只匹配 `uses: actions/setup-node@…`）。现有 `issue-policy.yml`、`github-review.yml` 已在文档 §7 登记为契约外系统 Node，属诚实披露；但新增同类 workflow 不会被机械挡住。
- 影响：AC4 的“实际验证面”可能随新 workflow 静默扩大；不改变当前已声明的验证结论。ExecPlan 3.6 已解释不做登记表（避免第二份事实源），故按维护风险记录，不在本 PR 要求扩范围。
- 修复方向（后续，可选）：在 `scripts/workflow-check.mjs` 或契约层对“run 步骤含 `node` 且无 setup-node”的 workflow 要求显式声明/注释标记，或 fail closed。

## 6. 工作项、范围与风险

- 范围：diff 严格等于 ExecPlan `Global Constraints` 的 14 个文件；无未声明改动、无 lockfile/workflow/product 代码变更；ADR 原文保留、只追加带日期注记，状态仍 Accepted；三处现时句均为最小追加/改写且未删除历史理由（release-gates、vertical-path、2026-09-29 计划）；`docs/README.md` 只加本计划索引行。
- issue #313 四条验收：AC1 由测试 1/3/6 + CI 实跑覆盖；AC2 由 Host 常量/@types/既有 host-node-types 与 artifact 用例未改覆盖；AC3 由测试 4/5 + `pnpm typecheck` 覆盖；AC4 由文档模式表 + 测试 2/7 + 本记录的 P2-1 缺口共同界定（当前文档值本身正确）。
- 已知风险（与 PR body 一致，已核实）：Node <26 的本地开发只会收到 pnpm engines 警告——工作树无 `.npmrc`、`pnpm-workspace.yaml` 无 `engineStrict`、`pnpm config get engine-strict` 为 `undefined`，不阻断安装；Node 22/24 source 模式、Node 26 逐 patch、Desktop Node 24.18.1 真机执行均为未验证面；文档与配置双向耦合，改一处需同 PR 同步。
- 残余风险：P2-1 的文档漂移面；P3-3 的新 workflow 覆盖面。两者都不是当前交付阻塞。

## 7. 验收边界

本记录只覆盖 #687/#313 的工程交付面：契约测试、配置、文档与门禁证据。不代替人类评审、安装态验收、R1 或合并授权；PR 仍为 draft，`#313` 保持 OPEN，等待人类伙伴按仓库流程决定 ready/合并。本记录提交只新增本文件，不改实现提交。

**Superseded（2026-11-25）**：上述 draft/等待合并决定是当时状态；PR 已 ready，本轮当前 head 复审见 §9。用户已直接授权本评审会话对 PR #687–#689 条件 rebase merge 和范围内清理，原话与约束记在本 PR ExecPlan D16–D17；该授权不改变 R1 和 Planning Status 边界。

## 8. 修复复评（2026-11-24，新 head `25e42051`）

首版结论**保持 APPROVE WITH NOTES 不变**；本节只复核实现方对 P2-1/P3-1/P3-2/P3-3 的修复本身，不重开其余已关闭结论。

- **锁定新 head**：`25e420519676fd8dcacf6a3aa53e733c510a5bd2`；在首版记录提交 `52d810c9` 之上追加 `feae82a3`（文档表精确解析）与 `25e42051`（Verify lane 命令表述）两个新提交，普通 push、未改写历史（`52d810c9` 仍是祖先）；远端与工作树 head 一致；base 仍 `eadf490183c3…`；PR 仍 draft、`closingIssuesReferences=[#313]`；`gh pr diff 687` 与 `git diff eadf4901...HEAD` 均为 905 行且逐行一致，共 15 个文件（14 实现文件 + 本记录）。
- **修复范围**：`feae82a3` 只改 `tests/contract/runtime-support.test.js`、`docs/development/runtime-support.md`、`docs/exec-plan/active/2026-11-24-node-runtime-contract.md`；`25e42051` 只改 `docs/development/runtime-support.md`。无产品代码、workflow、锁文件或新依赖改动；未越界。
- **① P2-1 关闭（原 M7 复现）**：测试 7 已改为解析「版本事实」单元格（`cells[2]`）的 `标签` = `值` 并逐项 `assert.equal`（`tests/contract/runtime-support.test.js:235-246`），不再对整行做包含判断。独立复跑原 M7：把文档 source 行 `.nvmrc` 值 `26` 分别改为 `24`、`27` → 两次都只有测试 7 红，消息精确为「source 行「版本事实」单元格里 .nvmrc 的值必须是 26，实际是 24/27」；把 engines 值改为 `>=25.0.0` 同样只测试 7 红；每次 `git checkout --` 还原后 7/7、工作树干净。该绑定已不会被同行其他值蒙混。
- **② P3-1 / P3-2 关闭**：在修复 head 实测 `node scripts/rule-checks.mjs size eadf4901` → 代码 284/1000、文档 486/1500，与计划新增读数一致（计划保留 Batch 4 原值 386 并说明与最终值的差异，符合“易失证据带上下文”的要求）；`runtime-support.md` §1 表与 §7 都已改为 `pnpm typecheck` + `pnpm test` 两步，lane 名 `Verify`/`Browser`/`Windows Native` 与 `ci.yml` 的 job 名一致，实测 `ci.yml` verify job 确为 install → `pnpm typecheck` → `pnpm test`，表述与事实一致。
- **③ P3-3 登记（不扩测试）**：`runtime-support.md` §7 未验证节新增“契约只固定 `actions/setup-node` 步骤、不扫描没有 setup-node 却执行 node 的新 workflow；有意保留的残余风险（评审 P3-③ 记录不修）”一条；计划 Outcomes 与 Bottom Change Note 同步登记同一残余风险；没有扩大测试范围或新增 workflow 扫描，符合原处置建议。
- **④ 修复无新 P0–P2**：在修复 head 实跑 `pnpm typecheck` 退出 0、`pnpm test:contract` 1632/1632、`node --test tests/contract/runtime-support.test.js` 7/7；`Verify` lane 在 `25e42051` 上 pass。复评时该 head 的 `Browser` 与 `Windows Native` 仍是 pending（本记录提交会再次触发同一组 lane），最终 head 的完整门禁应由 Lead 在最后一次 push 后回读，不把待跑写成已通过。
- **残余观察（不新开缺陷）**：本次追加复评会让文档桶在 486 的基础上继续增加（本记录自身行数），计划里的“最终 486”应按合并前 `size` 命令回读、不能当常量；这是 P3-1 所述易失证据的同一性质，不改变阈值结论（< 1500）。
- **复评结论**：P2-1 已按原修复方向关闭，P3-1/P3-2 已订正，P3-3 已按“记录不修”登记残余风险；修复本身未引入新 P0–P2、未越界。**保持 APPROVE WITH NOTES、无阻塞**；可进入归档/ready 准备，ready 与合并仍由人类伙伴按仓库流程决定，#313 由 PR body 的 `Closes #313` 关闭。

## 9. 当前版本独立 MMP 复审（2026-11-25）

本轮只采信当前源码和实际输出；上文旧评审及变异不构成本轮证明。执行上下文为 `.worktrees/iteration12-node-runtime-contract`，Node v26.13.1。

### 9.1 锁定事实与初始风险矩阵

- 当前 head `eac0cdfbe15f14f2de4b9c816a1f54ea14a0c27d`、base `main@eadf490183c35d34697053c980d06c78c80638ba`，本地与远端 PR 相同；15 个文件、779 增行/5 删行；评审开始时工作树干净。
- PR OPEN、ready、MERGEABLE，`mergeStateStatus=UNSTABLE`；reviews、inline comments、conversation comments、review threads 均为 0，GraphQL 分页均无下一页。`closingIssuesReferences=[#313]`，issue 保持 OPEN、四条验收框未勾选。
- 当前 head 的 Verify、Browser、Windows Native、PR Fast Gate、CodeQL、Issue policy、Rule checks、Disclosure scan、PR size 全部 SUCCESS；Create review session FAILURE 为可选评审转发，不属分支保护门禁。

| 等级 | 代码 / 失败路径 | 产品 / 架构 | 测试 / 反例 | 工作项 / 发布面 | 初始待判事项 |
|---|---|---|---|---|---|
| P0 | 配置破坏 main 基线 | Host ABI、权限、持久化不变量 | 基线门禁失效 | 越权外部写入或泄露 | 核实只收窄 source 声明，Host 常量不动 |
| P1 | 可擦除守卫失效、实际入口不可加载 | source 与 compiled Host 混写 | 错误码负控空转、最低运行时未成立 | #313 闭环错判 | 检查真实入口、类型上限及声明下界 |
| P2 | 解析或断言遗漏 | 版本文档与配置漂移 | 文档精确值绑定、覆盖缺口 | 验收和计划不一致 | 逐条 AC 映射、实际下界 smoke |
| P3 | 可维护性、无效复杂度 | 重复事实源、历史措辞 | 范围过宽或过窄 | 提交整理、易失规模证据 | 审核 scope、回滚和残余风险 |

### 9.2 全矩阵复核与实际验证

- **代码与架构（P0/P1）**：行为差异只在根 engines 与编译配置；`build.mjs` 只改注释，Host 常量、peer、打包机制和类型依赖保持原值。没有产品状态、schema、授权、并发、外部写入或依赖边改动。source 下界、执行 major、Host 目标、Host 版本与类型上限各有既有 owning source；新测试绑定关系，没有第二个运行时注册表。
- **测试与反例（P1/P2）**：当前测试逐一加载磁盘发现的 18 包/24 exports，以裸包名加载且先做 worktree 解析 preflight；配置解析走 `extends`，负控夹具实跑 tsc 并只接受至少三处 TS1294，根配置覆盖关闭也会被独立断言拒绝。文档值已按「标签=值」读取精确值，旧整行包含缺陷未残留。本轮没有施加源码变异，也不把旧 M1–M8 作为新证据。
- **产品与工作项**：#313 AC1 由当前 Node 26 行的入口 smoke 与完整基线支撑；AC2 由既有 Host 类型契约和重新构建/加载安装件支撑，真实 Desktop 验收独立；AC3 由根 typecheck 和负控夹具支撑；AC4 的表格、CI 命令和未验证节与实际 workflow 一致。#299 已关闭且仍拥有 Host 类型上限问题；#642/#647 的 Windows 安装资格与人验是不同交付面，没有发现需新建重复 issue 的缺陷。
- **范围与维护（P2/P3）**：当前技术 284/1000、文档 500/1500（均为已提交 head 的读数，不含本节），无新增依赖、workflow 或产品重构；守卫/入口/负控三种判别性证据与目标对应。计划已归档并被 `docs/README.md` 索引，开发入口索引存在。11 个历史提交包含计划/状态/修复/评审批次，最终 push 前仍应按 AGENTS §6 整理成可独立审阅的交付提交；这属于既定收尾步骤。

| 实际命令（工作树根） | 当前结果 |
|---|---|
| `node --test tests/contract/runtime-support.test.js tests/contract/host-node-types.test.js` | 12/12，0 fail、0 skip |
| `pnpm typecheck` | 退出 0 |
| `node --test tests/integration/harness-plugin-artifact.test.js` | 29/29，0 fail、0 skip；真实构建、安装包解析与 Host apply |
| `pnpm verify`（通过环境命令包装启动，实际 Node v26.13.1） | 退出 0；contract 1632 pass/0 skip；integration 2366 pass/28 skip；e2e 226 pass/0 skip；合计 4224 pass、28 skip、0 fail/0 todo |
| `node scripts/workflow-check.mjs` | 退出 0，7 个 workflow 无发现 |
| `node scripts/rule-checks.mjs size eadf4901` / `disclosure eadf4901` | 退出 0；284/500 两桶低于上限；机械扫描通过 |
| `git diff --check eadf4901...HEAD` 与 `git diff --check` | 均退出 0，无输出 |

28 个跳过项均为 Windows 原生集成项；本机 macOS 的跳过不代替该平台证据，远端当前 head 的 Windows Native lane 为 SUCCESS。可选 Create review session 的失败日志已读取：评审转发端点返回 HTTP 404，不能归因为本 PR 的配置/测试回归。

### 9.3 结论、限制与交接

**本轮无新增 P0/P1/P2/P3 actionable findings，建议 APPROVE。** 七条系统不变量、真实入口和 Host 类型上限保持；四条 issue 验收有对应工程证据。未发布 review、未提交、未 push、未修改实现；唯一脏文件是本评审记录。

精确最低 patch `26.0.0`、更高 major、Desktop Node 24.18.1 真机、本轮本机的 Windows 原生执行均未实跑。尝试的 `npx node@26.0.0` 经 `process.version`/`process.execPath` 回读发现仍启动环境 Node v26.13.1，已排除其最低版本证明；不把“26 major 行通过”扩大为逐 patch/未来 major 保证。没有 setup-node 的新增 workflow 仍属已登记维护风险。完整日志在本地评审证据目录保留；公共记录不写本机路径。合并前提交整理、当前 head 门禁回读、issue 勾选及人类/R1 接受由收尾会话继续处理。

## 10. 授权与收尾准备（2026-11-25）

- 回读 GitHub review `6050221555`：`Singularity-AI-Bot`、`APPROVED`、reviewed commit `eac0cdfbe15f14f2de4b9c816a1f54ea14a0c27d`，无 inline 意见；该批准不自动覆盖后续改写 head。
- 本会话负责 PR #687–#689 后续，直接用户授权原话及条件见 `docs/exec-plan/completed/2026-11-24-node-runtime-contract.md` D16–D17。#687 当前没有需修的发现；后续如出现修复，先独立复评再继续。计划保持 Completed，每 PR 整合为一个可独立理解、回滚和审阅的 Conventional Commit。
- 整合前须建立 `refs/backup/pr687-before-mmp-review-20261125` 与 `refs/backup/pr687-final-tree-20261125` 并读回，随后精确 lease 发布、逐真实 main 更新、最终远端 head/base/checks/issue/threads 回读；无 P0/P1且修复复评及当前门禁通过时才用 rebase merge。Planning Status 不变，issue #313 只按当前证据核对验收并处理闭环；合并/清理结果仍待执行后补记。
- 本次文档 owner 只编辑该 ExecPlan 与本记录；未建立 ref、修改实现、提交、push、合并或清理。现交接收尾会话继续执行。
