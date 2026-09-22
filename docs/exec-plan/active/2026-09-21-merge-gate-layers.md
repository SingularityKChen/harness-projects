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
- `scripts/workflow-check.mjs` 用 `readdirSync` 发现 `.github/workflows/*.yml`，新 workflow 自动进入 W1–W7 判定；没有任何硬编码的 workflow 名单或数量断言。
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
3. 解析摘要行 `ℹ tests <n>`，`n` 为 0 或解析不到时 `::error::` + exit 1（解析不到即 fail closed，与 `workflow-check.mjs` 的未知情况处理一致）；
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

`Merge Gate` 触发于 `pull_request`（**不声明 `branches`**，使基线不是 `main` 的 PR 也能拿到结论）与 `push: main`。不声明 `branches` 的理由与 `rule-checks.yml` 相同：那个过滤器同时决定 `base_ref` 的取值，而本车道不依赖 `base_ref`，只依赖事件本身。

`push: main` 的 `concurrency` 必须显式声明 `cancel-in-progress: false`（W5/W6）：合并到 `main` 的验证记录不得被后续合并取消。

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

- 新增/改动文件限定为：`.github/workflows/merge-gate.yml`（新建）、`scripts/run-test-layer.mjs`（新建）、`tests/contract/merge-gate-workflow.test.js`（新建）、`tests/contract/run-test-layer.test.js`（新建）、`docs/development/ci.md`、`docs/architecture/release-gates.md`、`tests/README.md`、`docs/exec-plan/active/2026-09-21-merge-gate-layers.md`、`docs/README.md`。
- 不改 `.github/workflows/ci.yml`、`package.json` 的既有脚本语义、分支保护设置、体量预算与 `rule-checks` 的任何判定。
- workflow 必须满足 W1–W7：job 级 `timeout-minutes` 为 1–15 的整数、checkout 固定到 40 位提交且 `persist-credentials: false`、外部 action 固定到 40 位提交、顶层 `permissions` 最小、声明 `concurrency` 时必须显式给出取消策略。
- 不新增运行时依赖；单文件 ≤ 200 行、单函数 ≤ 40 行。
- 代码改动 ≤ 1000 行、文档 ≤ 1500 行（按 `node scripts/rule-checks.mjs size origin/main` 度量）。
- 只允许 rebase merge；不自行合并 PR。

## Plan of Work

### Batch 1 · 层运行器与契约测试（issue #10）

**最小闭环**：空层与零用例层都会失败并点名不变量；有牙的用例覆盖这两种情形。
**涉及文件**：`scripts/run-test-layer.mjs`、`tests/contract/run-test-layer.test.js`

- [ ] `run-test-layer.mjs`：数文件、跑层、解析摘要、失败点名不变量
- [ ] 零用例文件 → exit 1 且 `::error::` 含层名
- [ ] 摘要行 `tests 0` → exit 1（构造一个只有 `skip` 的层）
- [ ] 摘要行解析不到 → exit 1（fail closed）
- [ ] 正常层 → 透传输出并返回 `node --test` 的退出码
- [ ] 注入实验：去掉"零用例文件"判定 → 相应用例必须红

**验证**：

```bash
node --test tests/contract/run-test-layer.test.js          # 期望：pass，fail 0
node scripts/run-test-layer.mjs tests/mvp0 "MVP-0 每节点有断言"; echo "exit=$?"   # 期望：exit=0
```

### Batch 2 · Merge Gate workflow（issue #10）

**最小闭环**：四条 lane 加一个聚合 job 在 PR 上发布 `Merge Gate`；`workflow-check` 无 findings。
**涉及文件**：`.github/workflows/merge-gate.yml`、`tests/contract/merge-gate-workflow.test.js`

- [ ] 四个 lane job，各自 `timeout-minutes`、固定 checkout、`permissions: contents: read`
- [ ] 聚合 job `merge-gate`，名称为 `Merge Gate`，不 checkout、不读 secrets
- [ ] `on.pull_request` 不声明 `branches`；`on.push` 限 `main`
- [ ] `concurrency` 显式声明 `cancel-in-progress`，且 `push` 到 `main` 时不为真
- [ ] 契约测试钉住：lane 集合、聚合 job 形状、无 `branches` 过滤器、权限与超时
- [ ] 注入实验：给 `pull_request` 加回 `branches: [main]`、把聚合 job 改成会 checkout、删掉一个 lane 的 `timeout-minutes` → 对应断言各自变红

**验证**：

```bash
node scripts/workflow-check.mjs                            # 期望：no findings（已检查 6 个文件）
node --test tests/contract/merge-gate-workflow.test.js     # 期望：pass，fail 0
pnpm verify                                                # 期望：通过
```

### Batch 3 · 文档订正与索引（issue #10）

**最小闭环**：CI 文档、发布门禁的过期结论与测试分层表都描述同一条车道。
**涉及文件**：`docs/development/ci.md`、`docs/architecture/release-gates.md`、`tests/README.md`、`docs/README.md`

- [ ] `ci.md` 增加 `Merge Gate` 行与"为什么与 `ci.yml` 有重复"的理由
- [ ] `release-gates.md` §2.2 的"当前结论"按实测重写（两个层现在都有用例文件）
- [ ] `tests/README.md` §1 的"归入门禁"列与实际一致
- [ ] `docs/README.md` 的 ExecPlan 索引登记本计划

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
| 1 | 新车道是独立 check，不替换 `PR Fast Gate` | `merge-gate.yml` 存在且 `ci.yml` 逐字节未改；聚合 job 名为 `Merge Gate` | 待验证 |
| 2 | 跑 integration、包边界与 MVP-0 端到端链路 | 契约测试断言四条 lane 与各自的命令；本地逐条运行 | 待验证 |
| 3 | 契约与集成套件在无网络无凭据下通过 | 四个层各自 `node --test` 本地全绿，且脚本不读任何 secret | 待验证 |
| 4 | 失败点名被保护的不变量 | `run-test-layer.mjs` 的失败输出含传入的不变量字符串；契约测试断言之 | 待验证 |
| 5 | 空层响亮失败 | 零文件层与零用例层各有一条用例断言 exit 1 与 `::error::` | 待验证 |
| 6 | workflow 满足 W1–W7 | `node scripts/workflow-check.mjs` → no findings，文件数从 5 变 6 | 待验证 |
| 7 | 文档与实现一致 | `ci.md`、`release-gates.md`、`tests/README.md` 三处都描述同一条车道与同一组 lane | 待验证 |

## Progress

- [ ] (2026-09-21) 取证：确认 `ci.yml` 不跑 `test:mvp0`；确认三层测试文件数
- [ ] Batch 1 · 层运行器与契约测试
- [ ] Batch 2 · Merge Gate workflow
- [ ] Batch 3 · 文档订正与索引
- [ ] 注入实验与三态证据

## Surprises & Discoveries

（执行期间如实记录。）

## Decision Log

- **Decision**：`Merge Gate` 是独立 workflow，不改 `ci.yml` 的 `verify` job。
  **Rationale**：issue #10 Scope 明确"不让 PR 门禁变慢"；把四层塞进同一个 job 还会让失败无法分别定位。
  **Date/Author**：2026-09-21 / agent

- **Decision**：空层判定放在 `scripts/run-test-layer.mjs`，不在 YAML 里数文件。
  **Rationale**：`release-gates.md` §2.2 与 `vertical-path.md` §3 各记录过一次"目录存在即绿"的假绿；只有解析摘要行才能判"用例数非零"。
  **Date/Author**：2026-09-21 / agent

- **Decision**：`on.pull_request` 不声明 `branches`。
  **Rationale**：该过滤器同时决定 `base_ref` 的取值（`ci.md`「Rule checks 的判定基线不由触发器决定」记录了这次教训）；本车道不依赖 `base_ref`，声明过滤器只会让部分 PR 拿不到结论。
  **Date/Author**：2026-09-21 / agent

- **Decision**：不把 `Merge Gate` 设为必需检查。
  **Rationale**：分支保护是仓库设置不是仓库内容，且 R1 §2.5 的"稳定"要求连续两次绿；设置动作留给人类伙伴，记入人工项。
  **Date/Author**：2026-09-21 / agent

## Idempotence and Recovery

- `run-test-layer.mjs` 与四个层都是只读且可重复的；契约测试用临时目录构造空层与零用例层，不污染仓库。
- 注入实验要求还原后复跑确认。
- 回滚单位是单个提交；因为不改分支保护，回滚后不存在残留设置。

## Interfaces and Dependencies

- **依赖**：`node --test`（Node 版本由 `.nvmrc` 固定）、`pnpm`（`packageManager` 字段）。
- **人工项（交还人类伙伴）**：
  1. 决定是否把 `Merge Gate` 加入分支保护；加入前需按 `release-gates.md` §2.2 在该 head 上观察到连续两次绿。
  2. 若加入，`AGENTS.md` §9 的"`PR Fast Gate` 是分支保护唯一必需检查"一句需要同步修订——本批次**不改**该句，因为设置尚未发生。
- **下游**：`#73`（R1 发布门禁）的第 5 条判定证据由本车道提供；`docs/architecture/release-gates.md` §2.2 的过期结论在本批次订正。

## Outcomes & Retrospective

完成后填写：四个层的实测用例数与耗时、注入实验的实测结果、以及"还有哪些门禁只在文档里成立"的剩余清单。

## Bottom Change Note

- 2026-09-21：首次创建。原因：issue #10 是 M3（MVP-0）最后一个开放条目，且 R1 §2 第 5 条要求 `Merge Gate` 稳定、integration 与 e2e 非空；`ci.md` 的前置条件（真实测试、稳定入口）现已成立。
