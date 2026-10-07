# GitHub Project 字段读取与列表展示 ExecPlan

> 状态：Active；2026-10-07 重切为三层 stacked PR。
> 创建：2026-10-05 CST；刷新：2026-10-07 CST。
> 范围：完成 issue #133 的只读字段事实、Host 映射与列表展示，不包含字段写入 #71。
> 上游输入：`docs/architecture/gate-e1-ruling.md`、`docs/exec-plan/completed/2026-09-29-github-projects-read.md`、`docs/development/workflow.md`。

## Purpose / Big Picture

用户在工作项列表看到所属 GitHub Project 的原生状态、迭代与目标日期。只有工作区显式映射的状态选项才显示规范状态；未映射选项只显示原生名，同一内容出现在两个 Project 时字段值不会因 option id 重复而串写。

最小成功证据是录制的沙箱响应在不联网条件下经过 GitHub Provider、core、Memory/SQLite、controller、client、ui-model，最终由真实 `WorkItemListPage` 渲染迭代和日期。只交付 Provider port 不关闭 #133；顶层列表 PR 才使用 `Closes #133`。

## Context and Orientation

Issue #133 要求四项行为：两个 Project 即使复用 option id 也各自按 project field id 保存；未映射状态不得猜测规范值；迭代和目标日期到达列表；录制夹具可离线通过 Planning contract suite。#70 已交付内容读取和 GraphQL transport，本任务复用其成员关系分页与 replay 机制。Gate E1 的 R2 把字段值键固定为 `(workspaceId, itemExternalId, projectFieldId)`；R3 禁止为 GitHub 字段伪造 revision、ETag 或 CAS。

原 PR #268 把 Provider、Host 持久化与 UI 闭环放进一个变更单元。2026-10-07 读取到的远端对象为 `main@d911cc9` → `feature/project-field-read@8115211`，代码/测试 1826 行、文档 330 行；`PR size` 失败，review decision 为 `CHANGES_REQUESTED`。重算命令如下：

    gh pr view 268 -R SingularityKChen/harness-projects --json baseRefOid,headRefOid,isDraft,reviewDecision,statusCheckRollup
    node scripts/rule-checks.mjs size origin/main

原计划在 2026-10-06 接受了单 PR 例外。**Superseded by `Decision Log` 的 2026-10-07 stack 决策**：例外能解释 advisory 红灯，却不能恢复独立审阅、独立回滚与原始 800 行停止门，因此不再作为交付路径。

## Design / Spec

### 权威链与职责边界

1. GitHub Provider 只报告原生字段定义和值。`NativePlanningFieldValue` 以 project field id 为键；Provider 不按字段名猜 Status、Iteration 或 Target Date，也不产生 `NormalizedStatus`。
2. core 是字段角色与规范状态映射的 owner。`WorkspacePlanningFieldMapping` 同时绑定 Planning binding 和 project；映射只有在字段定义校验、字段值替换、展示投影与同步 revision 的同一 Storage transaction 成功后才成为已确认值。
3. `planning_field_value` 保存 R2/R3 要求的原生事实，`WorkspaceProjection.planningFields` 保存可重算的消费投影。两者语义不同，不互相冒充：原生行用于保留平台事实，投影用于稳定读取与离线展示。
4. controller/client 只传输已确认投影；ui-model 和 ui 不解析 GraphQL、不调用 Provider、不按名称重新识别字段。
5. redacted 内容不携带字段值。Provider 声明字段读取面时应返回空对象；core 仍把 redacted 强制视为完整空组，不能依赖 Provider 恰好遵守该约定。

### 三层 stacked delivery

| 层 | 分支与 base | 可独立验收的能力闭环 | Issue 语义 | 代码/测试预算 |
|---|---|---|---|---|
| A · Provider facts | `feature/project-field-read`，base `main`，保留 PR #268 | GraphQL 字段定义、原生值、迭代、分页与离线 replay；对 malformed/scope/duplicate id fail closed | `Refs #133` | ≤800 |
| B · Host projection | `feature/project-field-projection`，base A | 显式映射、R2 原生值整组替换、Memory/SQLite 同事务确认与重启恢复 | `Refs #133` | ≤800 |
| C · List presentation | `feature/project-field-list`，base B | 已确认字段经 core query、wire、ui-model 到真实列表；redacted 双层剥离 | `Closes #133` | ≤800 |

每层只按自己的 base 计量。A 合入后系统新增只读 Provider 能力但不改变列表；B 合入后 Host 能同步并持久确认字段但不改变 UI；C 合入后用户可见闭环完成。三层都可按相反顺序逐层回滚，不需要在一个 revert 中同时撤销 Provider、schema 和 UI。

原提交把 `WorkspacePlanningFieldMapping`、`PlanningFieldsSnapshot`、`WorkspaceProjection.planningFields` 以及 Memory Storage 的整组替换实现放进 Provider 提交。它们属于 Host/Storage，不属于 Provider。重构时将这些 hunk 归到 B；A 只保留 `NativePlanningFieldValue`。这既修复责任归属，也让 A/B 各自回到 800 行内，不靠删判别性测试压缩。

### 被放弃的方案

- **继续单 PR 并保留规模例外**：拒绝。1826 行跨七层，评审与回滚粒度不符合仓库“独立闭环”目标；例外不等于最佳实践。
- **删除 fixture、分页或事务测试以满足数字**：拒绝。测试占比高是跨层风险的证据，不是可删除噪声。
- **按目录机械拆分但不定义每层验收**：拒绝。stack 必须让每层有稳定接口、判别性测试和自己的回滚点。
- **删除 `planning_field_value` 写入，只保留 JSON 投影**：拒绝。该改动会偏离 issue #133 的“field values attached to memberships”范围和 Gate E1 R2/R3；是否在字段写入 #71 之前增加生产读方是后续能力问题，不用本次规模重构改变数据模型。
- **给 GitHub 字段增加本地 CAS/revision**：拒绝。平台没有相应权威值，R3 明确禁止伪造并发控制。

## Global Constraints

- 保持 `AGENTS.md` §1.1 七条不变量；`Status` 不因字段读取、CI 或工程事实改变。
- 三层每层代码/测试改动 ≤800 行，文档改动 ≤1300 行；同时必须通过仓库 `size` 检查的 ≤1000/≤1500 上限。
- 不为满足 LOC 删除判别性测试，也不把连续算法机械拆成互相不可验收的碎片。
- pre-MMP 没有真实用户数据：允许直接调整实验 schema 和类型，不增加旧数据 migration、dual read/write 或兼容层；运行时事务性、ack、幂等与恢复不放宽。
- 不新增 GitHub mutation、凭据字段或外部写入；CI 只使用录制 replay。
- PR #268 的共享历史只有在 recovery ref、逐层验证、range-diff 与 publication scan 完成后，才用精确旧 SHA 的 `--force-with-lease` 更新。
- 不改 Project `Status`、`blocked-by` 或 `blocking`；人类决定 merge。

文件集合只在本表声明；后续章节只列每批主文件：

| 层 | 文件集合 |
|---|---|
| 共享计划 | `docs/README.md`；`docs/exec-plan/active/2026-10-05-project-field-read.md`（顶层完成后移动到 `docs/exec-plan/completed/`） |
| A | `docs/architecture/gate-e1-sandbox.md`；`packages/domain/src/index.ts`；`packages/domain/src/planning-fields.ts`（仅原生值）；`packages/capabilities/src/planning-provider.ts`；`packages/providers/fake/src/fixtures.ts`；`packages/providers/fake/src/planning.ts`；`packages/providers/fake/src/state.ts`；`packages/providers/planning-github-projects/src/decode.ts`；`fields.ts`；`index.ts`；`provider.ts`；`queries.ts`；`tests/contract/fixtures/github-projects/project-a.json`；`project-fields.json`；`replay.js`；`tests/contract/planning-github-projects-contract.test.js`；`planning-github-projects-mapping.test.js` |
| B | `packages/domain/src/planning-fields.ts`（映射与投影）；`packages/domain/src/entities.ts`；`packages/capabilities/src/registry.ts`；`storage.ts`；`packages/providers/fake/src/storage.ts`；`packages/core/src/bootstrap.ts`；`context.ts`；`planning-fields.ts`；`packages/storage/sqlite/migrations/002_identity_membership.sql`；`packages/storage/sqlite/src/migrations.ts`；`storage-rows.ts`；`storage-sync.ts`；`storage.ts`；`tests/contract/planning-fields.test.js`；`storage-contract.test.js`；`tests/contract/suites/storage-sync.js`；`storage.js`；`tests/integration/execution-relation-write-schema.test.js`；`github-projects-bootstrap.test.js`；`identity-membership-enums.test.js`；`identity-membership-schema.test.js` |
| C | `packages/core/src/projection.ts`；`packages/controller/src/wire.ts`；`packages/ui-model/src/derive.ts`；`types.ts`；`work-item-list-view.ts`；`packages/ui/src/work-item-list.ts`；`tests/contract/ui-model-presentation.test.js`；`ui-work-item-list-view.test.js`；`ui-work-item-list.test.js` |

## Plan of Work

### Batch A · Provider 原生字段事实

**最小闭环**：调用方能从 GitHub Project 获得有 scope 的字段定义、原生字段值和迭代，并用录制夹具离线复现。

**涉及文件**：`packages/capabilities/src/planning-provider.ts`、`packages/domain/src/planning-fields.ts`、`packages/providers/planning-github-projects/src/fields.ts`、`tests/contract/planning-github-projects-contract.test.js`。

- [x] 将 PR #268 的 bottom tree 重建为共享计划 + Provider facts，Host-only 类型与 Storage hunk 留给 B。
- [x] 保留字段定义/值分页、重复 id、跨 project/membership、非法日期和停滞游标的 fail-closed 测试。
- [x] 证明 replay 请求全部命中且不联网。

**验证**（在检出 `feature/project-field-read` 或等价 bottom commit 的工作树根目录运行）：

    ./node_modules/.bin/tsc --noEmit
    node --test tests/contract/planning-github-projects-contract.test.js tests/contract/planning-github-projects-mapping.test.js
    node scripts/rule-checks.mjs size origin/main
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/workflow-check.mjs
    git diff --check origin/main...HEAD

期望：测试 0 fail；replay `misses` 为空；代码/测试 ≤800，文档 ≤1300；其余命令 exit 0。

**回滚**：在 B 未合入时 revert A 的 Provider 与计划提交；无 schema 或 UI 状态需要恢复。

### Batch B · Host 映射与同事务确认

**最小闭环**：Host 能按 binding + project 显式映射原生字段，Memory/SQLite 用同一事务确认原生行、投影、mapping 与 revision，失败保留最后已确认快照。

**涉及文件**：`packages/core/src/planning-fields.ts`、`packages/core/src/bootstrap.ts`、`packages/capabilities/src/storage.ts`、`packages/providers/fake/src/storage.ts`、`packages/storage/sqlite/src/storage-sync.ts`、`tests/contract/planning-fields.test.js`。

- [ ] 从 A 继承原生类型，在 B 新增 Host mapping/snapshot 类型和 `WorkspaceProjection.planningFields`。
- [ ] 将 mapping 的三态输入、重登记保护、定义校验、redacted 清空与 bootstrap 串行化放在 core。
- [ ] 两种 Storage 实现相同的整组替换、原子失败与重启读回契约。

**验证**（在检出 `feature/project-field-projection` 的工作树根目录运行）：

    ./node_modules/.bin/tsc --noEmit
    node --test --test-timeout=120000 tests/contract/planning-fields.test.js tests/contract/storage-contract.test.js tests/integration/github-projects-bootstrap.test.js tests/integration/identity-membership-schema.test.js tests/integration/identity-membership-enums.test.js
    node scripts/rule-checks.mjs size feature/project-field-read
    node scripts/rule-checks.mjs disclosure feature/project-field-read
    node --test tests/contract/package-boundaries.test.js
    git diff --check feature/project-field-read...HEAD

期望：Memory/SQLite 两套契约 0 fail；非法 mapping 和事务中途失败不前进 revision；代码/测试 ≤800，文档 ≤1300。

**回滚**：先回滚依赖 B 的 C，再 revert B；A 的 Provider 读取仍可独立存在。

### Batch C · Typed read surface 与真实列表

**最小闭环**：已确认字段投影到达真实列表 HTML，unmapped、unset 与 redacted 的显示语义稳定，完成 issue #133。

**涉及文件**：`packages/core/src/projection.ts`、`packages/controller/src/wire.ts`、`packages/ui-model/src/work-item-list-view.ts`、`packages/ui/src/work-item-list.ts`、`tests/contract/ui-work-item-list.test.js`。

- [ ] wire 和 client store 只传已确认投影；redacted 在 wire 与 ui-model 两层剥离。
- [ ] 列表显示原生未映射状态、迭代 title 与 date-only 目标日期，不做时区转换。
- [ ] 真实 `WorkItemListPage` 和两种 Storage 的录制集成证据通过后归档本计划。

**验证**（在检出 `feature/project-field-list` 的工作树根目录运行）：

    ./node_modules/.bin/tsc --noEmit
    node --test --test-timeout=120000 tests/contract/ui-model-presentation.test.js tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list.test.js tests/integration/github-projects-bootstrap.test.js
    node --test --test-timeout=120000 tests/contract tests/integration tests/e2e
    node --test --test-timeout=120000 tests/mvp0
    node scripts/rule-checks.mjs size feature/project-field-projection
    node scripts/rule-checks.mjs disclosure feature/project-field-projection
    node scripts/workflow-check.mjs
    node --test tests/contract/package-boundaries.test.js
    git diff --check feature/project-field-projection...HEAD

期望：全量测试与 MVP-0 0 fail；真实列表 HTML 含迭代和目标日期，redacted canary 不出现；代码/测试 ≤800，文档 ≤1300。

**回滚**：revert C 后系统仍保留已确认字段数据与 typed Host 能力，只撤销列表呈现。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 相同 option id 在两个 Project 不串值 | provider fixture + Host mapping 测试按不同 project field id 得到独立值 |
| 2 | 未映射状态不被猜测 | `native_only` 含原生名且没有 normalized；列表显示“未映射”语义 |
| 3 | 迭代与目标日期出现在列表 | 两种 Storage 的录制 bootstrap → wire → `WorkItemListPage` HTML 集成测试 |
| 4 | Planning contract suite 离线通过 | replay ledger `misses` 为空，测试过程不调用网络 transport |
| 5 | 每层可独立审阅、合并和回滚 | 三层各自 `size` ≤800，base/head 正确，focused tests 与 `diff --check` 通过 |
| 6 | 不变量保持 | planning `Status` 未被工程事实改写；redacted 无字段泄漏；事务失败不发布 Saved 或推进 revision |

## Progress

- [x] (2026-10-05 CST) 完成两轮独立设计与原始 ExecPlan。
- [x] (2026-10-06 CST) 实现完整纵向闭环并发现单 PR 为 1826 行；原 800 行停止门未执行。
- [x] (2026-10-07 CST) 锁定 PR #268 当前 base/head、checks、review、issue #133 验收与双向链接。
- [x] (2026-10-07 CST) 建立 `backup/pr268-before-stack-20261007`，在 `.worktrees/pr268-stack` 从 `origin/main` 建立隔离重构工作树；main baseline 为 1149 contract/integration/e2e + 7 MVP-0，0 fail。
- [x] (2026-10-07 CST) Batch A：Provider bottom layer 为 746 行 code/test、222 行 docs；1156 contract/integration/e2e + 7 MVP-0、8 boundaries 全部通过，typecheck、workflow、disclosure 与 diff check 通过。
- [ ] Batch B：重建并验证 Host projection middle layer。
- [ ] Batch C：重建并验证 List presentation top layer。
- [ ] 比较旧/新最终 product tree、执行 publication scan，并以精确 lease 更新远端 stack。
- [ ] 回读三个 PR 的 head/base/checks、issue links、review threads 与 draft/ready 状态；不合并。

## Surprises & Discoveries

- 2026-10-06：原计划虽然写了 800 行停止门，Batch 1 后仍继续在同一 PR 实现 B/C；最终 1826 行。证据：`node scripts/rule-checks.mjs size origin/main`。
- 2026-10-06：测试与 fixture 约占原 PR 代码/测试改动的 47%；删除它们会移除分页、scope、事务和 redaction 的判别力，不能作为减量方案。
- 2026-10-07：原四提交已提供天然责任边界，但 Provider 提交夹带 Host projection 类型与 Memory Storage 整组替换；把 hunk 归回 B 后，预计 A/B/C 都能满足原 800 行预算，必须以逐层 `size` 实测确认。
- 2026-10-07：`pnpm verify` 在无 TTY 的受限环境会触发依赖目录重建；本任务先完成一次 `pnpm install --frozen-lockfile`，之后直接运行 `tsc` 与 `node --test`，避免验证命令把网络可用性误当产品失败。

## Decision Log

- Decision: Provider 只报告原生事实，字段角色和规范状态映射属于 Host。Rationale: 字段名可变且不同 Project 可复用 option id；只有工作区配置知道角色。Date/Author: 2026-10-05 / human + planning reviewers。
- Decision: 原生字段行与展示投影在同一事务确认。Rationale: 它们是不同层次的事实，但不能让 UI 看见新投影而 raw facts/mapping 仍是旧值。Date/Author: 2026-10-05 / human + planning reviewers。
- Decision: 2026-10-06 的单 PR 规模例外不再作为交付路径。Rationale: 用户在 2026-10-07 要求深入重构 PR #268，且现有 `CHANGES_REQUESTED` 正是独立交付边界失守；三层 stack 可保留全部证据并恢复原始预算。Date/Author: 2026-10-07 / human request + Codex。
- Decision: 使用 A → B → C 的 stacked PR，而不是缩减 issue 验收。Rationale: 三层分别拥有 Provider、Host、Presentation 单一职责，顶层才完成用户可见闭环。Date/Author: 2026-10-07 / Codex。
- Decision: 不在本次删除 `planning_field_value` 写链。Rationale: 它承载 Gate E1 R2/R3 与 issue #133 的 membership 字段事实；规模问题由交付边界解决，不用改变数据模型掩盖。Date/Author: 2026-10-07 / Codex。

## Idempotence and Recovery

重放 fixture、重复 bootstrap 与整组字段替换必须幂等；失败后可重试同一 pending mapping。SQLite delete+insert 只能发生在一个顶层 transaction，失败保持最后已确认 mapping、投影、raw rows 与 revision。

历史重构的恢复锚点是 `backup/pr268-before-stack-20261007` → `8115211`。准备分支为 `feature/project-field-read-stack-prep`，当前远端 PR 分支在本地验证完成前不动。发布前记录远端旧 SHA，并使用：

    locked_old_sha=$(gh pr view 268 -R SingularityKChen/harness-projects --json headRefOid --jq .headRefOid)
    git push origin HEAD:feature/project-field-read --force-with-lease=feature/project-field-read:"$locked_old_sha"

若 lease 失败，停止并重新读取远端；不得改成裸 `--force`。新 stack 发布失败时不删除 recovery ref；分支可从已验证的 A/B/C commit 重新推送。任何 cherry-pick/rebase 冲突先 `git status` 和 `git diff --check`，无法证明语义等价时 `git cherry-pick --abort` 或回到 recovery ref。

## Interfaces and Dependencies

运行环境为 Node ≥22、pnpm lock 对应版本；一次成功 `pnpm install --frozen-lockfile` 后用 `./node_modules/.bin/tsc` 和 `node --test` 验证。GitHub Provider 依赖现有 `GraphqlTransport`，CI 只读仓库内 replay fixture。真实 provider schema 以 GitHub Projects GraphQL schema 为形状依据，但验收以仓库录制响应为离线证据。

PR 发布使用普通 `gh` 的 `SingularityKChen` 身份；Reviewer review 使用 `$HOME/.local/bin/gh-review` 的 `Singularity-AI-Bot` 身份。PR #268 保留编号但改为 stack bottom、`Refs #133`；B 同样 `Refs #133`；C 使用 `Closes #133`。三层最终 push 后按分支定位并回读：

    gh pr view 268 -R SingularityKChen/harness-projects --json baseRefName,baseRefOid,headRefName,headRefOid,isDraft,closingIssuesReferences,statusCheckRollup,reviewDecision
    gh pr list -R SingularityKChen/harness-projects --head feature/project-field-projection --state open --json number,baseRefName,headRefName,statusCheckRollup
    gh pr list -R SingularityKChen/harness-projects --head feature/project-field-list --state open --json number,baseRefName,headRefName,statusCheckRollup


## Outcomes & Retrospective

截至 2026-10-07，产品实现已在旧 PR head 通过完整测试，但交付形态不是最佳实践：单 PR 超过原预算两倍以上并收到 size blocking review。当前重构目标是不改变已验证的产品树，只改变职责归属、提交/PR 拓扑与计划事实；若重构需要改变行为，必须新增判别性测试并在本节记录偏差。

完成后记录三层实际行数、测试数、range-diff/product-tree 对照、远端回读与仍未解决的产品风险。人类决定是否和何时合并。

## Bottom Change Note

2026-10-05 CST：创建计划，收敛原生字段、Host 映射、同事务确认与列表展示方案。

2026-10-06 CST：记录完整实现、评审修复、规模超限与单 PR 例外。**Superseded by 2026-10-07 本条**。

2026-10-07 CST：按用户要求重新审视原始 issue/spec/plan；撤销“超限例外是交付路径”的结论，重切 A Provider → B Host projection → C List presentation 三层 stack，并建立逐层 800 行停止门、恢复锚点与精确 force-with-lease 发布流程。
