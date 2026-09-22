# Merge Gate 车道 ExecPlan

> 状态：Active
> 创建：2026-09-21
> 范围：把 integration、包边界、MVP-0 与 E2E 四层测试放上一条独立的 `Merge Gate` 车道，空层必须失败、失败必须点名被保护的不变量；`PR Fast Gate` 保持分支保护唯一必需检查。
> 上游输入：issue #10、`AGENTS.md` §9、`docs/architecture/release-gates.md` §2 第 5 条与 §2.2、`docs/development/ci.md`（"合并后的演进"）、`tests/README.md` §1、`docs/product/vertical-path.md` §3

## Purpose / Big Picture

完成后，`main` 上的四层测试不再只靠"有人记得本地跑一遍"：

| 层 | 保护的不变量 | 今天在 CI 里跑吗 |
|---|---|---|
| `tests/integration` | 迁移可从空库重复执行、失败不留版本记录 | 是（经 `pnpm test`），但没有任何"非空"判定 |
| `tests/contract/package-boundaries.test.js` | 依赖方向不反向、不跨层 | 是（经 `pnpm test`） |
| `tests/mvp0` | 纵向链路每个节点都有断言、未实现节点必须失败并点名 | **否**（`ci.yml` 只跑 `pnpm test`，不含 `test:mvp0`） |
| `tests/e2e` | 端到端链路与故障降级 | 是（经 `pnpm test`） |

判断成功的最小证据：

```bash
node scripts/run-test-layer.mjs tests/mvp0 "MVP-0 纵向链路每节点有断言"
# 期望：退出码 0，且输出层名、用例数与它所保护的不变量
mkdir -p /tmp/empty-layer && node scripts/run-test-layer.mjs /tmp/empty-layer "空层必须失败"
# 期望：exit 1，::error:: 指明"该层没有任何用例文件，空层不算通过"
```

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 车道（lane） | 一个独立的 GitHub Actions workflow，发布自己的 check 名 |
| 聚合 job | 不 checkout 代码、不读 secrets，只汇总同 workflow 内其它 job 结果的 job（`ci.yml` 的 `fast-gate` 是既有形态） |
| 空层假绿 | 目录存在但没有用例文件时 `node --test` 仍退出 0（Node 26 实测摘要行 `ℹ tests 0`） |
| 必需检查 | 分支保护里配置为 required 的 check；本仓库当前只有 `PR Fast Gate` |

### 当前事实

- `package.json`：`test` = `node --test tests/contract tests/integration tests/e2e`；`verify` = `typecheck` + `test` + `test:mvp0`。
- `.github/workflows/ci.yml` 的 `verify` job 跑 `pnpm typecheck` 与 `pnpm test`，**不含 `test:mvp0`**；`PR Fast Gate` 是它的聚合 job。
- `docs/development/ci.md`「合并后的演进」写明：Merge queue / merge_group、integration、E2E 只有在仓库出现**对应真实测试、耗时基线和稳定入口**后才新增，且新增 lane 必须先写 ExecPlan。
- 三个条件现在都成立：`tests/integration` 有 1 个用例文件（迁移运行器），`tests/e2e` 有 8 个，`tests/mvp0` 有 1 个；`pnpm verify` 是本仓库既有的稳定入口。
- `docs/architecture/release-gates.md` §2.2 的"当前结论"仍写着"`tests/integration` / `tests/e2e` 下没有 `.test.js`"与"`Merge Gate` 还不是一个 lane"——**这段已经过期**，本批次必须订正。
- `scripts/workflow-check.mjs` 用 `readdirSync` 发现 `.github/workflows/*.yml`，新 workflow 自动进入 W1–W7 判定；没有任何硬编码的 workflow 名单或数量断言。本 head 上该目录有 7 个文件（`node scripts/workflow-check.mjs` 实测 `no findings（已检查 7 个文件）`），加入 `merge-gate.yml` 后为 8 个——编排者给的"5 个"是过期快照，见 `Surprises & Discoveries`。
- `.github/workflows/ci.yml` 的 `on.pull_request` 仍带 `branches: [main]`。GitHub 原生堆叠 PR 的运行时 `base_ref` 是**栈的根分支**（issue #99 实测），所以栈内 PR 目前能拿到 `ci.yml`；这条性质由 PR #100 修复体量基线时一并记录，本批次不改它。

### 上游依据

- issue #10 的五条验收条件（本计划 `Validation and Acceptance` 逐条对应）。
- `docs/architecture/release-gates.md` §2 第 5 条：`Merge Gate` 稳定，且 `tests/integration` 与 `tests/e2e` **各自至少有一条用例且全绿**——"空层的 exit 0 不是证据"。
- `docs/product/vertical-path.md` §3：`node --test tests/mvp0` 的通过条件包含"摘要行 `ℹ tests` 计数非零"。
- `AGENTS.md` §9：`PR Fast Gate` 是分支保护唯一必需检查；新增 workflow 必须同步规则、契约测试和文档。

## Design / Spec

### D1 新增车道，不改 `PR Fast Gate`

`PR Fast Gate` 的职责是"快速失败"，它由不 checkout 代码的聚合 job 发布，这个形状必须保持不变（issue #10 Scope 明确"Making the pull-request gate slower"不在范围内）。因此 `Merge Gate` 是一条**独立 workflow**，有自己的 check 名，自己的聚合 job。它是否成为必需检查是分支保护设置，属于人类伙伴的动作，记入 `Interfaces and Dependencies` 的人工项。

### D2 空层必须在脚本层失败，而不是靠 YAML 里数文件

"目录存在即绿"是本仓库已经吃过一次的假绿（`release-gates.md` §2.2 与 `vertical-path.md` §3 各记录过一次）。YAML 里写 `find | wc -l` 只能判"有文件"，判不了"用例数非零"（文件里可以全是 `skip`）。因此新增 `scripts/run-test-layer.mjs <layer> <invariant>`：

1. 数该层的 `*.test.js` 文件，为 0 时 `::error::` + exit 1；
2. 运行 `node --test <layer>` 并把输出透传；
3. 解析摘要行 `ℹ tests <n>`，`n` 为 0 或解析不到时 `::error::` + exit 1（解析不到即 fail closed，与 `workflow-check.mjs` 的未知情况处理一致）；当前实现用**实际执行的用例数 = `tests` − `skipped` − `todo` ≥ 1**作为零用例判据——Node 26 实测 `skip` 与 `todo` 都计入 `tests`（见 `Surprises & Discoveries`），只判 `tests 0` 会把"整层被 skip 掉"读成绿的，与本条要防的假绿是同一类；这里的 `tests` 是 Node runner 执行到的测试用例数，不是断言数。
4. 退出码取 `node --test` 的结果；
5. 失败时输出 `<invariant>`，使 CI 上第一眼看到的是"哪条不变量被破坏"而不是"哪个文件失败"。

脚本纯 Node、无网络、无凭据，因此可离线契约测试。

### D3 四条 job + 一个聚合 job

| job | check 名 | 保护的不变量 |
|---|---|---|
| `integration` | `Merge Gate · Integration` | 迁移可从空库重复执行、失败不留版本记录 |
| `boundaries` | `Merge Gate · Boundaries` | 依赖方向不反向、不跨层 |
| `mvp0` | `Merge Gate · MVP-0` | 纵向链路每节点有断言，未实现节点必须失败并点名 |
| `e2e` | `Merge Gate · E2E` | 端到端链路与故障降级 |
| `merge-gate` | `Merge Gate` | 聚合：任一 lane 未成功即失败 |

聚合 job 与 `fast-gate` 同形：不 checkout、不读 secrets、只汇总 `needs.*.result`。

### D4 触发面与 `ci.yml` 保持可区分

`Merge Gate` 触发于 `pull_request`（**不声明 `branches`**，使声明的 base 不是 `main` 的 PR 也能拿到结论）与 `push: main`。不声明 `branches` 的理由与 `rule-checks.yml` 相同，但**不是**"过滤器会改写 `base_ref`"——那个说法已被 `main` 撤回（`docs/development/ci.md` 现写「过滤器只负责准入，它**不会改写** `base_ref`」，判定基线来自 PR API）。正确理由是：`branches` 是**准入**谓词，声明成 `[main]` 会让声明的 base 不是 `main` 的 PR 一条结论都拿不到，而那正是本车道要服务的那批 PR；基线由 PR API 解析，准入与基线互不影响。

`push: main` 的 `concurrency` 必须显式声明 `cancel-in-progress: false`（W5/W6）：合并到 `main` 的验证记录不得被后续合并取消。

触发器另有 `workflow_dispatch`（第二轮评审补入）：`release-gates.md` §2.2 要求加入分支保护前在目标 head 上观察到连续两次绿，人工入口是取得第二次运行的可执行路径。它对 `cancel-in-progress` 无影响——该表达式只在事件为 `pull_request` 时求真。

### D5 与 `ci.yml` 的重复是可接受的，但要说清楚

`pnpm test` 已经跑了 integration / boundaries / e2e。`Merge Gate` 重复跑它们的理由不是"覆盖率"，而是**判定对象不同**：`ci.yml` 判定"PR 代码是否可用"，`Merge Gate` 判定"这条不变量在候选 head 上是否被断言且非空"。`docs/development/ci.md` 明确禁止"把同一组契约测试复制到多个 workflow 来制造覆盖率"，因此本车道**不**重复 `tests/contract` 的其余部分，只取 `package-boundaries.test.js` 这一个文件，并把重复的理由写进文档。

### D6 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 把四层塞进 `ci.yml` 的 `verify` job | 会让 `PR Fast Gate` 变慢，违反 issue #10 Scope；且一个 job 里四层失败无法分别定位 |
| 用 `merge_group` 触发 | 分支保护只允许 rebase merge，仓库没有 merge queue；`merge_group` 永不触发，是一条永远绿的假车道 |
| 只在 YAML 里 `find \| wc -l` | 判不了"用例数非零"；`release-gates.md` §2.2 已经记录过这类假绿 |
| 把 `Merge Gate` 直接设为必需检查 | 分支保护是仓库设置，不是仓库内容；agent 不得改，且改之前需要一段稳定性观察（R1 §2.5 的"稳定"定义要求连续两次绿） |
| 复制全部 `tests/contract` 到新车道 | `ci.md` 明确禁止；边界测试是唯一一个"结构类不变量"，其余契约测试没有新的判定对象 |

## Global Constraints

- 新增/改动文件限定为：`.github/workflows/merge-gate.yml`（新建）、`scripts/run-test-layer.mjs`（新建）、`tests/contract/merge-gate-workflow.test.js`（新建）、`tests/contract/run-test-layer.test.js`（新建）、`docs/development/ci.md`、`docs/architecture/release-gates.md`、`docs/product/vertical-path.md`（第二轮评审加入：该文件仍写 `tests/mvp0/` 尚不存在，与本车道自相矛盾）、`tests/README.md`、`tests/mvp0/README.md`（评审回复轮加入：它当时与新建的车道自相矛盾）、`docs/exec-plan/active/2026-09-21-merge-gate-layers.md`、`docs/README.md`。
- 不改 `.github/workflows/ci.yml`、`package.json` 的既有脚本语义、分支保护设置、体量预算与 `rule-checks` 的任何判定。
- workflow 必须满足 W1–W7：job 级 `timeout-minutes` 为 1–15 的整数、checkout 固定到 40 位提交且 `persist-credentials: false`、外部 action 固定到 40 位提交、顶层 `permissions` 最小、声明 `concurrency` 时必须显式给出取消策略。
- 不新增运行时依赖；单文件 ≤ 200 行、单函数 ≤ 40 行。
- 代码改动 ≤ 1000 行、文档 ≤ 1500 行（按 `node scripts/rule-checks.mjs size origin/main` 度量）。
- 只允许 rebase merge；不自行合并 PR。

## Plan of Work

### Batch 1 · 层运行器与契约测试（issue #10）

**最小闭环**：空层与零用例层都会失败并点名不变量；有牙的用例覆盖这两种情形。
**涉及文件**：`scripts/run-test-layer.mjs`、`tests/contract/run-test-layer.test.js`

- [x] `run-test-layer.mjs`：数文件、跑层、解析摘要、失败点名不变量
- [x] 零用例文件 → exit 1 且 `::error::` 含层名
- [x] 摘要行 `tests 0` → exit 1（构造一个只有 `describe`、没有用例的层；只有 `skip` 的层实测是 `ℹ tests 1` / `ℹ skipped 1`，由"真正执行的用例数 ≥ 1"这条判据拦住）
- [x] 摘要行解析不到 → exit 1（fail closed）
- [x] 正常层 → 透传输出并返回 `node --test` 的退出码
- [x] 注入实验：去掉"零用例文件"判定 → 相应用例必须红（实测 2 条变红，见 `Outcomes & Retrospective`）

**验证**：

```bash
node --test tests/contract/run-test-layer.test.js          # 期望：pass，fail 0
node scripts/run-test-layer.mjs tests/mvp0 "MVP-0 每节点有断言"; echo "exit=$?"   # 期望：exit=0
```

### Batch 2 · Merge Gate workflow（issue #10）

**最小闭环**：四条 lane 加一个聚合 job 在 PR 上发布 `Merge Gate`；`workflow-check` 无 findings。
**涉及文件**：`.github/workflows/merge-gate.yml`、`tests/contract/merge-gate-workflow.test.js`

- [x] 四个 lane job，各自 `timeout-minutes`、固定 checkout、`permissions: contents: read`
- [x] 聚合 job `merge-gate`，名称为 `Merge Gate`，不 checkout、不读 secrets
- [x] `on.pull_request` 不声明 `branches`；`on.push` 限 `main`
- [x] `concurrency` 显式声明 `cancel-in-progress`，且 `push` 到 `main` 时不为真
- [x] 契约测试钉住：lane 集合、聚合 job 形状、无 `branches` 过滤器、权限与超时
- [x] 注入实验：给 `pull_request` 加回 `branches: [main]`、把聚合 job 改成会 checkout、删掉一个 lane 的 `timeout-minutes` → 对应断言各自变红（实测各 1 条变红，见 `Outcomes & Retrospective`）

**验证**：

```bash
node scripts/workflow-check.mjs                            # 期望：no findings（已检查 8 个文件）
node --test tests/contract/merge-gate-workflow.test.js     # 期望：pass，fail 0
pnpm verify                                                # 期望：通过
```

### Batch 3 · 文档订正与索引（issue #10）

**最小闭环**：CI 文档、发布门禁的过期结论与测试分层表都描述同一条车道。
**涉及文件**：`docs/development/ci.md`、`docs/architecture/release-gates.md`、`tests/README.md`、`docs/README.md`

- [x] `ci.md` 增加 `Merge Gate` 行与"为什么与 `ci.yml` 有重复"的理由
- [x] `release-gates.md` §2.2 的"当前结论"按实测重写（两个层现在都有用例文件）
- [x] `tests/README.md` §1 的"归入门禁"列与实际一致
- [x] `docs/README.md` 的 ExecPlan 索引登记本计划 → **延后到栈级联步骤统一更新**：本批次不改 `docs/README.md` 与 `docs/architecture/README.md`

**验证**：

```bash
grep -n "Merge Gate" docs/development/ci.md docs/architecture/release-gates.md tests/README.md  # 期望：三处都有
node scripts/rule-checks.mjs disclosure origin/main        # 期望：exit 0
node scripts/rule-checks.mjs size origin/main              # 期望：代码 ≤ 1000、文档 ≤ 1500，exit 0
git diff --check origin/main...HEAD                        # 期望：无输出
```

**回滚**：`git revert` 本批次提交；workflow、脚本与契约测试整体删除，文档回到只有 `PR Fast Gate` 的表述。因为不涉及分支保护设置，回滚是完整的。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 新车道是独立 check，不替换 `PR Fast Gate` | `merge-gate.yml` 存在且 `ci.yml` 逐字节未改；聚合 job 名为 `Merge Gate` | 满足：`git diff --name-only origin/main...HEAD` 不含 `.github/workflows/ci.yml`；`merge-gate-workflow.test.js` 的"新车道不替换 PR Fast Gate"用例断言 `ci.yml` 仍在且 `fast-gate.name` 仍是 `PR Fast Gate` |
| 2 | 跑 integration、包边界与 MVP-0 端到端链路 | 契约测试断言四条 lane 与各自的命令；本地逐条运行 | 满足：`merge-gate-workflow.test.js` 逐条断言 `node scripts/run-test-layer.mjs <layer> "<invariant>"`；`run-test-layer.test.js` 对四个真实层各跑一次，`ℹ tests` 分别为 5 / 7 / 7 / 38，`fail 0` |
| 3 | 契约与集成套件在无网络无凭据下通过 | 四个层各自 `node --test` 本地全绿，且脚本不读任何 secret | 满足：`npm_config_manage_package_manager_versions=false pnpm verify` exit 0（356 + 7 条全绿）；`run-test-layer.mjs` 只 import `node:fs`、`node:path`、`node:process`、`node:child_process`、`node:url` |
| 4 | 失败点名被保护的不变量 | `run-test-layer.mjs` 的失败输出含传入的不变量字符串；契约测试断言之 | 满足：`assertLoudFailure` 对 5 类失败 fixture 都断言输出含不变量；CI 注解形如 `::error::<layer>：…。该层保护的不变量：<invariant>` |
| 5 | 空层响亮失败 | 零文件层与零用例层各有一条用例断言 exit 1 与 `::error::` | 满足：空目录、路径不存在、只有 `describe`、全 `skip`、全 `todo` 五种 fixture 都 exit 1 且带 `::error::` |
| 6 | workflow 满足 W1–W7 | `node scripts/workflow-check.mjs` → no findings，文件数从 5 变 6 | 满足（数字按实测订正）：`workflow-check: no findings（已检查 8 个文件）`，本 head 原为 7 个文件 |
| 7 | 文档与实现一致 | `ci.md`、`release-gates.md`、`tests/README.md` 三处都描述同一条车道与同一组 lane | 满足：三处都写出四条 lane 与 check 名；`release-gates.md` §2.2 的过期结论按实测重写 |

第二轮评审（2026-09-22）对第 3、5 条各加强了判定：第 3 条原先只断言失败注解里含不变量字符串，现另有一条用例遍历 256 种 needs 结果组合，断言聚合 job 的判定行为；第 5 条原先只覆盖"零用例文件"与"零执行用例"，现把 `countTestFiles` 的窄口径（只认 `*.test.js`）也钉成一条用例，避免把它误当成与 `node --test` 等价的完整发现规则。

## Progress

- [x] (2026-09-21) 独立验收复核：确认 lane 层运行步骤未设置 `if` 或 `continue-on-error: true`；对 integration lane 注入 `continue-on-error: true` 时契约测试按预期 13 pass / 1 fail，还原后复跑全绿；最终 head `5a15ab3` 的 `gh pr checks 104` 返回 11 项全部 `pass`
- [x] (2026-09-21) 取证：确认 `ci.yml` 不跑 `test:mvp0`；确认三层测试文件数
- [x] (2026-09-21) Batch 1 · 层运行器与契约测试
- [x] (2026-09-21) Batch 2 · Merge Gate workflow
- [x] (2026-09-21) Batch 3 · 文档订正
- [x] (2026-09-21) 注入实验与三态证据（4 项全部变红，还原后复跑确认全绿）
- [x] (2026-09-21) 索引更新延后到栈级联：本批次不改 `docs/README.md` 与 `docs/architecture/README.md`，由栈级联步骤统一登记
- [x] (2026-09-22) 第二轮评审修复：聚合 job 失败路径的行为用例、`workflow_dispatch`、`countTestFiles` 口径注释与用例、MVP-0 断言体检查、两处过期文档；注入实验 4/4 变红并还原复跑全绿

## Surprises & Discoveries

- **workflow 文件数不是 5 而是 7。** 编排者给的事实与计划里"已检查 6 个文件"都基于过期快照。本 head 上 `.github/workflows/` 有 `board-invariants.yml`、`ci.yml`、`engineering-state-signal.yml`、`engineering-state.yml`、`github-review.yml`、`issue-policy.yml`、`rule-checks.yml` 七个文件，`node scripts/workflow-check.mjs` 实测输出 `no findings（已检查 7 个文件）`；加入 `merge-gate.yml` 后是 `no findings（已检查 8 个文件）`。判定本身不受影响（没有硬编码名单或数量断言），但计划与验收表里的数字按实测改写。

- **Node 26 里 `skip` 与 `todo` 计入 `ℹ tests`。** D2 原文用"文件里可以全是 `skip`"解释为什么不能只数文件，并假设 skip-only 层会出现 `ℹ tests 0`。实测（`node --test <layer>`，Node v26.9.0）：

  | fixture | exit | 摘要行 |
  |---|---|---|
  | 空目录（没有任何 `*.test.js`） | 0 | `ℹ tests 0` |
  | 只有 `describe`、没有用例的文件 | 0 | `ℹ tests 0` |
  | 只有 `test(name, { skip: true })` | 0 | `ℹ tests 1` / `ℹ skipped 1` |
  | 只有 `test.todo(...)` | 0 | `ℹ tests 1` / `ℹ todo 1` |
  | 用例断言失败 | 1 | `ℹ tests 1` / `ℹ fail 1` |
  | 语法错误 / `process.kill(process.pid,'SIGKILL')` / `process.abort()` | 1 | `ℹ tests 1` / `ℹ fail 1` |
  | 层路径不存在 | 1 | 没有 `ℹ tests` 行 |

  所以"只判 `tests 0`"会把整层被 `skip` 掉读成绿的。实现按 D2 的意图把判据改成"真正执行的用例数 = `tests` − `skipped` − `todo` ≥ 1"（D2 第 3 条已同步），零用例 fixture 改用"只有 `describe`"。

- **"摘要行解析不到"这条 fail-closed 分支无法用真实层做黑盒 fixture。** 上表显示：Node 的 runner 一旦启动成功，即使用例文件语法错误或被信号杀死也会打印汇总行。能让它不打印的只有"node 根本没起来"，而 `NODE_OPTIONS='--not-a-real-flag'` 会先把运行器脚本自己杀掉（exit 9，脚本无任何输出），构不成 fixture。因此这条分支由 `parseSummary` 的单元断言（无 `ℹ tests` 行时返回 `null`）加"空层 / 路径不存在"两条 CLI 用例共同钉住，`run-test-layer.test.js` 头部写明原因。

- **独立验收补充了 lane 静音反向注入。** 临时给 `integration` 的层运行步骤增加 `continue-on-error: true` 后，`node --test tests/contract/merge-gate-workflow.test.js` 变为 `ℹ tests 14`、`pass 13`、`fail 1`，失败明确指出该 lane 不得吞掉失败；还原后同一测试恢复 `14/14` 全绿。`if: false` 与 `continue-on-error: true` 均由同一契约断言拒绝。

- **嵌套 `node --test` 会被 Node 的递归保护拦住。** 契约测试在 `node --test` 里再起 `node --test` 时，子进程继承 `NODE_TEST_CONTEXT=child-v8` 与 `NODE_TEST_WORKER_ID=1`，Node 打印 `node:test run() is being called recursively within a test file. skipping running files.` 且不打印任何摘要行——脚本于是 fail closed。契约测试因此显式清掉这两个变量，让嵌套运行等价于 CI lane 里的顶层运行；脚本本身不碰环境变量，生产路径上的递归保护保持不变。

- **`pnpm verify` 无法用仓库固定版本运行。** `package.json` 固定 `pnpm@10.28.2`，本机只有 pnpm 12.5.1，固定版本需要下载到包管理器的用户级缓存目录（工作区外）——沙箱拒绝写该目录，报 `create the temporary package manager install directory: Operation not permitted (os error 1)`，`TMPDIR=/tmp` 无效。验证改用 `npm_config_manage_package_manager_versions=false pnpm verify`（pnpm 12.5.1 + 同一个 Node 26.9.0）执行并实测通过；固定版本下的行为差异未验证，记入遗留。

- **`--test-shard` 不属于本批次能力。** 本次只验证 `node --test` 的层级入口与摘要判定，没有实现或声称支持分片参数；若后续引入分片，需要另行定义空分片与总计数判据。

- **`tests/mvp0/README.md` 与实际状态矛盾——本轮已修。** 该文件 §1 曾写"当前必须失败"、§4–§5 描述提升前的状态，而 `tests/mvp0` 现在 7 条断言全绿并进入 `Merge Gate · MVP-0`，等于仓库里同时存在"必须失败"与"必须绿"两种说法。评审指出后按实际状态改写：§1 说明 7 条断言当前全绿、失败形态仍然有效；§4 说明 `pnpm verify` **包含**它而 `PR Fast Gate` **不包含**；§5 给出进入必需检查的两条路（把 `Merge Gate` 加进分支保护，或让 `ci.yml` 改调 `pnpm verify`）。该文件因此加入本批次的文件清单。

- **`docs/development/ci.md` 的 workflow 表少了两行——本轮已补齐。** 原文写"远端 main 当前有五类 workflow"，而 `engineering-state.yml` / `engineering-state-signal.yml` 从未进表。本次既加 `Merge Gate` 行又补上这两行，表里现在是八个 workflow，且不再有"表列不全"的隐含声明。

- **第二轮评审发现"聚合 job 的失败路径从未被执行过"——本轮已修。** 原契约测试只断言 `failStep.if` 含 `'failure'`/`'cancelled'`/`'skipped'` 三个字面量、`run` 含 `exit 1`，即只钉住**静态形状**。把 `'failure'` 从析取里删掉时，除了那条字符串匹配之外没有任何用例会因为**行为**变红。本轮补一条按 needs 结果求值的用例：4 条 lane × 4 种结果（`success` / `failure` / `cancelled` / `skipped`）= 256 种组合，逐一断言"至少一条非 success ⇒ 失败步骤执行，全 success ⇒ 不执行"，并额外断言 `if` 含 `cancelled()`、失败步骤是倒数第二步。注入验证见 `Outcomes & Retrospective`。

- **`countTestFiles` 的注释与实现不一致——本轮已订正。** 注释写"与 `node --test <dir>` 的口径一致"，但计数只认 `*.test.js`，而 Node 还会执行 `*-test.js`、`*_test.js`、`test-*.js` 以及 `test/` 目录下的 `*.js`。方向是安全的（只含这些命名的层被报成"空层"并 exit 1，是假红不是假绿），但"空层"这个诊断会掩盖"命名不匹配"。本轮把注释改成如实说明窄口径，并补一条用例把这个口径钉住，免得日后被当成与 `node --test` 的完整发现规则等价。

- **`workflow_dispatch` 的缺失让 §2.2 的前置条件难以取证——本轮已补。** `release-gates.md` §2.2 要求加入分支保护前"目标 head 上连续两次运行均为绿"，而本 workflow 原先只有 `pull_request` 与 `push`，第二次运行只能靠重跑同一个 job。补 `workflow_dispatch:` 后可以由人在选定 head 上主动取一次；契约测试同步加一条断言。

- **`vertical-path.md` 与 `release-gates.md` 各有一处过期结论——本轮已订正。** 前者仍写 `tests/mvp0/` **尚不存在**、MVP-0 **没有可运行的判定**（该目录现有 7 条全绿断言），与 `ci.md` 新增的"`tests/mvp0` 第一次进入门禁"直接矛盾；后者写 `tests/contract/` 有 21 个用例文件，该 head 上实为 22 个。两处都是既有欠账、非本批次引入，但留着会让同一份仓库文档自相矛盾。

## Decision Log

- **Decision**：`Merge Gate` 是独立 workflow，不改 `ci.yml` 的 `verify` job。
  **Rationale**：issue #10 Scope 明确"不让 PR 门禁变慢"；把四层塞进同一个 job 还会让失败无法分别定位。
  **Date/Author**：2026-09-21 / agent

- **Decision**：空层判定放在 `scripts/run-test-layer.mjs`，不在 YAML 里数文件。
  **Rationale**：`release-gates.md` §2.2 与 `vertical-path.md` §3 各记录过一次"目录存在即绿"的假绿；只有解析摘要行才能判"用例数非零"。
  **Date/Author**：2026-09-21 / agent

- **Decision**：`on.pull_request` 不声明 `branches`。
  **Rationale**：`branches` 是准入谓词，声明成 `[main]` 会让声明的 base 不是 `main` 的 PR 一条结论都拿不到；本车道不依赖 `base_ref`（它只依赖事件本身），准入与基线互不影响。**订正**：本条原先写的理由是"该过滤器同时决定 `base_ref` 的取值"，那个说法已被 `main` 撤回（`ci.md` 现写「过滤器只负责准入，它**不会改写** `base_ref`」）；决策不变，理由换成上面这条。
  **Date/Author**：2026-09-21 / agent（2026-09-21 按 PR 评审订正理由）

- **Decision**：**不**把 `pnpm test:mvp0` 加进 `ci.yml` 的 verify lane（评审提出的那条"一行修复"）。
  **Rationale**：它确实能立刻把 MVP-0 放进已必需的 `PR Fast Gate`，但 issue #10 的 Scope 明确把"Making the pull-request gate slower: the fast gate stays fast"列为**范围外**，而本 PR 的闭环是"四层测试各自成为一条**有结论**的检查、空层不再假绿"，不是"四层测试成为必需门禁"。把两者混在一个 PR 里会让"Merge Gate 车道"这个可独立回滚的闭环变成两件事。代价如实记录：**本 PR 合并后，MVP-0 仍然不在任何必需检查里**，破坏它的 PR 依旧能绿着合并——除非人类伙伴二选一：(a) 把 `Merge Gate` 加进分支保护，或 (b) 走评审指出的那条路，把 `test:mvp0` 并进 `pnpm verify`（`tests/mvp0/README.md` §5 本来就把它写成晋升机制）。两条都记在 `Interfaces and Dependencies` 的人工项里。
  **Date/Author**：2026-09-21 / agent（按 PR 评审 P1 记录取舍）

- **Decision**：不把 `Merge Gate` 设为必需检查。
  **Rationale**：分支保护是仓库设置不是仓库内容，且 R1 §2.5 的"稳定"要求连续两次绿；设置动作留给人类伙伴，记入人工项。
  **Date/Author**：2026-09-21 / agent

- **Decision**：零用例判据取"实际执行的测试用例数 = `tests` − `skipped` − `todo` ≥ 1"，而不是只判 `tests 0`；这里统计的是 Node runner 执行到的用例数，不是断言数。
  **Rationale**：D2 要防的是"这一层没有产生任何证据"。Node 26 实测 `skip` 与 `todo` 都计入 `tests`，只判 `tests 0` 会让整层被 skip / todo 消音时读成绿的——这正是 D2 自己举的"文件里可以全是 `skip`"那个场景。四条真实 lane 现在 `skipped` / `todo` 都是 0，不产生误报。
  **Date/Author**：2026-09-21 / agent

- **Decision**：契约测试显式清掉 `NODE_TEST_CONTEXT` / `NODE_TEST_WORKER_ID` 后再起层运行器，而不是让脚本去删这两个变量。
  **Rationale**：Node 的递归保护是生产路径上的安全网，不该被被测脚本绕过；契约测试要观察的是真实运行，环境差异由测试侧显式声明。
  **Date/Author**：2026-09-21 / agent

- **Decision**：`run-test-layer.test.js` 对真实层用中性探针不变量，lane 文案只在 `merge-gate-workflow.test.js` 里钉一次。
  **Rationale**：Global Constraints 不允许新增共享 helper 文件，两份测试各写一份 lane 文案会引入静默漂移；让"YAML 形状与文案"与"这些层确实非空且全绿"各由一个文件负责，职责不重叠。
  **Date/Author**：2026-09-21 / agent

- **Decision**：补 `workflow_dispatch` 触发器，而不是把"连续两次绿"留给 job 重跑。
  **Rationale**：`release-gates.md` §2.2 把"目标 head 上连续两次运行均为绿"写成加入分支保护的前置条件。只有 `pull_request` 与 `push` 时，第二次运行只能靠重跑同一个 job——那不是"又一次运行"，取证口径也不清楚。补一个人工入口成本极低（不引入 secrets、不改变权限，`cancel-in-progress` 表达式对非 PR 事件求值为 false，符合 W5）。
  **Date/Author**：2026-09-22 / agent（第二轮评审 P3）

- **Decision**：聚合 job 的失败判定用"求值 needs 结果组合"的行为用例来钉，而不是继续加字符串断言。
  **Rationale**：字符串断言只能证明"表达式文本里有这三个字面量"，证明不了"某条 lane 失败时 `Merge Gate` 真的变红"。新增的用例实现了本 workflow 真正用到的那一小撮表达式语义（`contains` / `join` / `!cancelled()` / `||`），遍历 4×4×4×4 = 256 种结果组合，把判定行为钉死；代价是测试里多了一个约 20 行的窄求值器，它只服务这一条不变量。
  **Date/Author**：2026-09-22 / agent（第二轮评审 P2）

## Idempotence and Recovery

- `run-test-layer.mjs` 与四个层都是只读且可重复的；契约测试用临时目录构造空层与零用例层，不污染仓库。
- 注入实验要求还原后复跑确认。本批次的还原方式：注入前把待改文件复制到工作区外的临时目录，注入、跑目标测试、复制回来，再跑一次确认全绿；`git status --short` 只应剩下本批次计划内的 7 个文件（4 新增 + 3 修改，加上本 ExecPlan 为 8 个）。
- 验证命令中 `pnpm verify` 在本机需要 `npm_config_manage_package_manager_versions=false` 前缀（固定版本 pnpm 10.28.2 无法下载，见 `Surprises & Discoveries`）；不加前缀会以 `Operation not permitted` 失败，这不是代码问题。
- 回滚单位是单个提交；因为不改分支保护，回滚后不存在残留设置。

## Interfaces and Dependencies

- **依赖**：`node --test`（Node 版本由 `.nvmrc` 固定）、`pnpm`（`packageManager` 字段）。
- **人工项（交还人类伙伴）**：
  1. 决定是否把 `Merge Gate` 加入分支保护；加入前需按 `release-gates.md` §2.2 在该 head 上观察到连续两次绿。
  2. 若加入，`AGENTS.md` §9 的"`PR Fast Gate` 是分支保护唯一必需检查"一句需要同步修订——本批次**不改**该句，因为设置尚未发生。
  3. **让 MVP-0 真正进门禁**（本批次只把它变成"有结论的 advisory 检查"）。二选一：(a) 走上一条，把 `Merge Gate` 设为必需；(b) 让 `ci.yml` 的 verify lane 改调 `pnpm verify` 或补一条 `pnpm test:mvp0`，立刻进入已必需的 `PR Fast Gate`，代价是 PR 门禁变慢（issue #10 的 Scope 把它列为范围外，所以本批次没有顺手做）。两条都需要人类决定。
- **下游**：`#73`（R1 发布门禁）的第 5 条判定证据由本车道提供；`docs/architecture/release-gates.md` §2.2 的过期结论在本批次订正。

## Outcomes & Retrospective

**四个层的实测（Node v26.9.0，`node --test <layer>`）**

| 层 | 用例数 | `fail` | 退出码 | 本机耗时 |
|---|---|---|---|---|
| `tests/integration` | 5 | 0 | 0 | ~88 ms |
| `tests/contract/package-boundaries.test.js` | 7 | 0 | 0 | ~75 ms |
| `tests/mvp0` | 7 | 0 | 0 | ~117 ms |
| `tests/e2e` | 38 | 0 | 0 | ~2.3 s |

**新增契约测试**：`run-test-layer.test.js` 17 条、`merge-gate-workflow.test.js` 17 条，全绿（第二轮评审修复后：`run-test-layer` 16→17，`merge-gate-workflow` 13→17）。`npm_config_manage_package_manager_versions=false pnpm verify` exit 0（356 + 7 条全绿）；`node scripts/workflow-check.mjs` → `no findings（已检查 8 个文件）`。

**注入实验（4/4 按预期变红，还原后复跑全绿）**

| 注入 | 变红的用例 |
|---|---|
| `on.pull_request` 加回 `branches: [main]` | `merge-gate-workflow.test.js`：`on.pull_request 不声明 branches 过滤器…`（1 条） |
| 聚合 job 增加 `actions/checkout` 步骤 | `merge-gate-workflow.test.js`：`聚合 job 不 checkout、不读 secrets…`（1 条） |
| 删掉 `boundaries` lane 的 `timeout-minutes` | `merge-gate-workflow.test.js`：`每个 job 都声明 1–15 分钟的整数 timeout-minutes`（1 条）；同时 `workflow-check` 报 `[W1]`、exit 1 |
| 去掉 `run-test-layer.mjs` 的"零用例文件"判定 | `run-test-layer.test.js`：`空层必须响亮失败…` 与 `层路径不存在时同样 exit 1…`（2 条） |

**第二轮注入实验（本轮，4/4 按预期变红，还原后复跑 34/34 全绿）**

| 注入 | 变红的用例 |
|---|---|
| 从聚合失败条件删掉 `contains(needs.*.result, 'failure')` 析取项 | `聚合 job 叫 Merge Gate…` 与 `聚合 job 的失败条件被真正执行…`（2 条） |
| 把聚合 job 的 `if: ${{ !cancelled() }}` 改成 `if: true` | 同上 2 条 |
| 把节点 7 的用例体改成空实现 | `MVP-0 lane 声明的不变量被钉住…`（1 条） |
| 删掉 `workflow_dispatch` 触发器 | `声明 workflow_dispatch…`（1 条） |

**与计划的偏差**：D2 第 3 条的判据被加强（见 `Decision Log`），零用例 fixture 由 skip-only 改为 describe-only；验收表第 6 条的文件数按实测从 5→6 改成 7→8；Batch 3 的 `docs/README.md` 索引登记按批次要求延后到栈级联。

**剩余清单（还有哪些门禁只在文档或人工动作里成立）**

1. `Merge Gate` 是否加入分支保护——仓库设置，人类伙伴决定；加入前要在目标 head 上连续两次绿。
2. `release-gates.md` §2.2 第 5 条的"连续两次运行均为绿"只能在该 head 的真实 CI 运行记录上回读；本批次提供的是"两层非空且全绿"与"lane 存在"两部分证据。第二轮补了 `workflow_dispatch`，第二次运行现在可以由人主动取，但**两次运行本身仍未发生**，这条仍然只能靠回读该 head 的运行记录来判定。
3. ~~`tests/mvp0/README.md` §4–§5 仍描述提升前的状态~~——评审回复轮已按实际状态改写（见 Surprises）。
4. ~~`docs/development/ci.md` 的 workflow 表仍缺 `engineering-state.yml` / `engineering-state-signal.yml` 两行~~——评审回复轮已补齐（见 Surprises）。
5. `pnpm verify` 未在固定版本 `pnpm@10.28.2` 下验证（沙箱不能写工作区外路径）。
6. `AGENTS.md` §9 的"`PR Fast Gate` 是分支保护唯一必需检查"在本批次仍然成立，未改。
7. **MVP-0 仍然不在任何必需检查里**——本批次把它变成"有结论的 advisory 检查"，没有变成必需。两条出路见 Decision Log 与 `tests/mvp0/README.md` §5，都需要人类伙伴决定。

## Bottom Change Note

- 2026-09-21：首次创建。原因：issue #10 是 M3（MVP-0）最后一个开放条目，且 R1 §2 第 5 条要求 `Merge Gate` 稳定、integration 与 e2e 非空；`ci.md` 的前置条件（真实测试、稳定入口）现已成立。
- 2026-09-21：执行后回填。改动原因与内容：(1) 三个批次与注入实验全部完成，`Progress`、`Validation and Acceptance`、`Outcomes & Retrospective` 按实测回填；(2) D2 第 3 条的判据加强为"真正执行的用例数 ≥ 1"，因为实测发现 `skip` / `todo` 计入 `ℹ tests`，原判据会漏掉整层被消音的情形；(3) `Context and Orientation` 与验收表第 6 条的 workflow 文件数按实测从 5→6 订正为 7→8；(4) Batch 3 的 `docs/README.md` 索引登记延后到栈级联步骤，本批次不改 `docs/README.md` 与 `docs/architecture/README.md`；(5) 新增 6 条 `Surprises & Discoveries` 与 3 条 `Decision Log`。
- 2026-09-21：按 PR 评审回复（P1/P2/P2/P3×4）修改。原因与改动：(1) 评审指出本 PR 的"闭环"措辞（"四层测试只有一半在门禁里有结论"）并没有被这次改动关闭——`Merge Gate` 是 advisory，MVP-0 仍不在任何必需检查里；补一条 Decision Log 记录取舍（issue #10 Scope 把"让 PR 门禁变慢"列为范围外）与两条出路，并加进人工项。(2) `merge-gate.yml` 的触发器注释、ExecPlan 的 D4 与 Decision Log 都写着"该过滤器同时决定 `base_ref` 的取值"，而 `main` 已撤回该论断（`ci.md` 现写「过滤器只负责准入，它**不会改写** `base_ref`」）；决策不变，理由换成"准入谓词"并订正悬空的章节引用。(3) 新增契约测试把 `Merge Gate · MVP-0` 声明的不变量钉住：`tests/mvp0` 必须仍然断言 7 个连续编号的链路节点，否则把 7 条削成 1 条平凡用例也能让 lane 全绿。(4) `tests/mvp0/README.md` §1/§4/§5 与新建车道自相矛盾（"当前必须失败"vs"必须绿"），按实际状态改写，该文件加入 Global Constraints。(5) `ci.md` 的 workflow 表补上 `engineering-state.yml` / `engineering-state-signal.yml` 两行。(6) `countTestFiles` 排除 `node_modules`，与 `node --test <dir>` 的口径一致。
- 2026-09-22：按第二轮 PR 评审（P2×2、P3×4）修改。原因与改动：(1) 本文件 Batch 2 的验证命令仍写"已检查 6 个文件"，与本 head 实测的 8 个不符——那条命令照抄执行会得到与文档不同的结论，订正为 8。(2) 聚合 job 的失败路径此前只有静态形状断言，没有任何用例真正执行过"某条 lane 失败 ⇒ `Merge Gate` 变红"这一判定；新增一条按 needs 结果求值的用例（4 条 lane × 4 种结果 = 256 种组合），并断言 `if` 必须让聚合 job 在上游失败时仍然运行、失败步骤必须是倒数第二步。(3) 新增 `workflow_dispatch` 与对应契约用例：`release-gates.md` §2.2 把"连续两次绿"写成加入分支保护的前置条件，没有人工入口时第二次运行只能靠重跑同一个 job。(4) `countTestFiles` 的注释把它说成与 `node --test` 口径一致，实际只认 `*.test.js`（Node 还会跑 `*-test.js` / `*_test.js` / `test-*.js` / `test/**`）；注释改为如实说明"窄口径、方向是假红不是假绿"，并补一条用例把这个口径钉住。(5) `Merge Gate · MVP-0` 的不变量是"每节点有**断言**"，但契约测试只钉标题；补上"每条用例体必须至少调用一次断言辅助函数（`assert` / `requireNode` / `needMethod`）"。(6) 订正两处过期文档：`vertical-path.md` 仍写 `tests/mvp0/` 尚不存在、MVP-0 没有可运行的判定；`release-gates.md` §2.2 写 `tests/contract/` 有 21 个用例文件（实为 22）。注入验证见 `Outcomes & Retrospective`。
