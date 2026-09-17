# 仓库引导 ExecPlan：治理约定 + 工作区骨架 + 远端保护

> 状态：Active  
> 创建：2026-09-17  
> 范围：本仓库（`harness-projects`）的初始化，不包含任何产品功能实现  
> 上游输入：`deepseek-harness-project-delivery-engineering-pack-v0.1/`（冻结参考）
> 执行方式：本仓库自定义 exec-plan 流程（见 `AGENTS.md` §6、`PLANS.md`）

---

## Purpose / Big Picture

本计划要交付的不是代码功能，而是一个**可持续协作的工程底座**：一个能把"需求 → 可独立验收的批次 → 受保护的合并"固定下来的仓库。

完成后应达到的状态：

1. 任何一个无上下文的实现者（人或 agent）clone 本仓库后，只读 `AGENTS.md` + `PLANS.md` 就能知道：文档写到哪里、计划怎么写、隔离工作区在哪里、分支与 PR 如何命名、提交前必须跑什么。
2. 目标目录结构（`apps/`、`packages/`、`tests/`、`docs/`）真实存在，并且**架构依赖方向由测试而不是由口头约定保证**。
3. `main` 分支在 GitHub 上受保护：必须走 PR、必须有通过的检查、只允许 rebase 合并、禁止强推与删除。
4. 本仓库的第一份 ExecPlan 就是本文件，它演示了后续所有复杂需求应当遵循的推进方式。

判断成功的最小证据：`pnpm verify` 通过；`git check-ignore .worktrees` 命中；`readlink CLAUDE.md` 输出 `AGENTS.md`；`gh api repos/.../branches/main/protection` 回读到受保护配置。

---

## Context and Orientation

本仓库承载的产品来自工程包（Engineering Pack v0.1）：一个**项目交付工作台**，把项目规划（GitHub Projects / Local）与工程执行（Local Git / GitHub / Actions / Harness）分成五个能力域，用可替换 Provider 组合起来。产品与工程设计已经冻结到可以开始实现的程度，唯一未冻结的是跨平台对象身份模型（Gate E1）。

因此本仓库的引导阶段刻意**不写业务代码**，只冻结三件事：文档落点、包边界、合并门禁。理由是这三个东西一旦在实现中途更改，代价会以"重写历史/重写文档/重写依赖"的形式扩散；而它们现在更改的成本接近零。

关键术语（后续批次会反复出现）：

- **PlanningItem / WorkItem / ChangeRequest**：项目成员关系、内容对象、变更请求，三者身份必须分离。
- **Provider / Capability**：能力定义与具体实现分离，`core` 不依赖任何具体 Provider。
- **ExecPlan**：一份自带上下文、可被无上下文实现者执行的活文档（格式见 `PLANS.md`）。
- **Batch（批次）**：本仓库对"工作切分"的最小单位，等于一个可独立验证、可独立评审、可回滚的最小闭环。

---

## Design / Spec

> 本节对应上游流程中"设计/spec 阶段"的产物；本仓库把 spec 与 plan 收敛到同一份 exec-plan 文档，不再分别落到 `docs/specs/` 与 `docs/plans/`。

### D1 文档落点：单一路径体系

上游技能默认把持久文档写到 `docs/superpowers/<rest>`（历史版本也出现过单数 `docs/superpower/<rest>`）。品牌目录进入正式文档树会带来两个问题：文档路径会随工具链演进而失效；读者会把工具名当成项目结构的一部分。因此本仓库统一改写：

| 上游约定 | 本仓库约定 |
|---|---|
| `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` | `docs/exec-plan/active/YYYY-MM-DD-<slug>.md`（同一文档的 Design 章节） |
| `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` | `docs/exec-plan/active/YYYY-MM-DD-<slug>.md`（同一文档的 Plan of Work 章节） |
| `docs/superpowers/<rest>` | `docs/<rest>` |
| `docs/superpower/<rest>`（单数） | `docs/<rest>` |
| `.superpowers/brainstorm/`、`.superpowers/sdd/` | 保持原义：技能定义的 git-ignored 运行态，不进 `docs/` |
| `~/.config/superpowers/worktrees/`、`.worktrees/<branch>/` | `.worktrees/<task-slug>/` |

spec 阶段与 plan 阶段**流程保留**（先澄清与方案取舍，再落到 bite-sized 任务），但两者写进同一个文件，避免同一件事在两份文档里漂移。

### D2 执行阶段自研，不套用上游执行技能

上游的执行技能（subagent-driven-development / executing-plans）把"每个 task 一个子代理 + 两段 review"作为默认形态。本仓库改为**批次制 exec-plan 执行**：一批 = 一个最小闭环 = 一次可判定的反馈，批内不并行改同一文件区域，批末更新 ExecPlan 的 Progress 并提交。这样切分的理由见下节。

### D3 拆分原则（第一性原理）

一批工作存在的唯一理由是：**它能把一个此前无法判定的问题变成可判定的反馈。**

- **判据 1 · 可判定**：本批结束后，有确切命令从"未知/失败"变成"通过"。
- **判据 2 · 可回滚**：撤销范围等于本批 diff，不牵连其他批次已交付的能力。
- **判据 3 · 最小闭环**：批内不再包含两个可以分别验收的风险（例如"结构"与"外部副作用"风险不同，必须分开）。
- **判据 4 · 不聚合**：不为了减少 issue 数量而合并批次；也不把同一风险摊成多个文件级提交——文件级提交不会缩短反馈，只会让 review 失去判断点。

据此把"初始化仓库"这个大目标压成 6 个纵向批次（见 Plan of Work）：工程底座 → 文档治理 → 结构与架构契约 → CI 门禁 → 远端发布与保护 → 重构与提交整理。

### D4 中立命名

正式工作流命名不引入工具品牌：分支使用 `feature/`、`fix/`、`docs/`、`chore/`、`project-management/`；文档使用能力域与领域词（`architecture`、`adr`、`product`、`exec-plan`）。工具名只允许出现在"约定来源"这类说明性文字里，不允许出现在路径、分支名与文档标题中。

### D5 包边界由测试保证

`project-core` 不依赖任何具体 Provider、`project-client` 不依赖 React、Provider 之间不互相调用——这些是产品不变量。口头约定会腐化，因此本批就用一个契约测试（`tests/contract/package-boundaries.test.js`）把允许的依赖边写成矩阵，并在测试里包含一次**变异验证**（临时插入违规依赖，确认测试会失败），证明它不是在空转。

---

## Global Constraints

- 只使用本仓库内可复现的工具链：Node ≥ 22、pnpm 10、`node --test`（不引入测试框架直到出现真实需要）。
- 文档语言为中文，代码标识符、路径、命令为英文。
- 不修改 `deepseek-harness-project-delivery-engineering-pack-v0.1/` 下的任何文件：它是冻结的上游输入。
- 不提交 secret、token、SQLite 数据库文件与任何运行态目录（`.superpowers/`、`.worktrees/`）。
- 单个 PR 的代码改动 ≤ 1000 行、文档改动 ≤ 1500 行；PR 提交后**不得自行合并**。

---

## Plan of Work

每一批都给出：最小闭环、涉及文件、步骤、验证命令与期望输出、回滚点。

### Batch 1 · 工程底座

**最小闭环**：在一个空目录里，`pnpm install` 能建立工作区并生成锁文件；运行态目录已被忽略。  
**涉及文件**：`.gitignore`、`.editorconfig`、`package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`tsconfig.json`。

- [ ] 步骤 1：写 `.gitignore`，包含 `node_modules/`、`dist/`、`.superpowers/`、`.worktrees/`、`*.sqlite*`。
- [ ] 步骤 2：写工作区配置与 TS 基线（`strict`、`noEmit`、`paths` 映射到各包 `src/index.ts`）。
- [ ] 步骤 3：运行 `pnpm install`，期望生成 `pnpm-lock.yaml`，无 `ERR_` 输出。
- [ ] 步骤 4：运行 `git check-ignore -v .worktrees .superpowers`，期望两行命中（即使目录尚不存在也要命中规则）。

**验证**：`pnpm install` 成功 + `git check-ignore` 命中。  
**回滚**：删除配置文件即可，无外部副作用。

### Batch 2 · 文档治理层

**最小闭环**：无上下文读者只读两个文件即可按规则工作，且 `CLAUDE.md` 通过相对软链接指向同一内容。

**涉及文件**：`AGENTS.md`、`PLANS.md`、`CLAUDE.md`（软链接）、`docs/README.md`。

- [ ] 步骤 1：写 `AGENTS.md`：产品上下文、目录所有权、文档规范（含 D1 映射表）、exec-plan 流程、隔离工作区、分支/提交/PR 规则、验证门禁、批次后重构与提交整理。
- [ ] 步骤 2：写 `PLANS.md`：ExecPlan 的必需章节、生命周期（active → completed）、进度与决策记录义务。
- [ ] 步骤 3：`ln -s AGENTS.md CLAUDE.md` 创建**相对**软链接。
- [ ] 步骤 4：写 `docs/README.md`：文档地图与"什么内容放哪里"。

**验证**：
```bash
readlink CLAUDE.md            # 期望输出：AGENTS.md
test -L CLAUDE.md && echo link-ok
grep -n "docs/superpowers" AGENTS.md   # 只允许出现在映射表的"上游约定"列
```
**回滚**：删除三个文件；无外部副作用。

### Batch 3 · 结构与架构契约

**最小闭环**：目标目录结构真实存在，且依赖方向违规会导致测试失败。

**涉及文件**：`apps/*`、`packages/**`（17 个包）、`tests/contract/package-boundaries.test.js`、`tests/README.md`。

- [ ] 步骤 1：按目标结构生成包骨架：每个包一个 `package.json`（私有、`type: module`、`exports` 指向 `src/index.ts`）与一个 `src/index.ts`（顶部注释声明责任与允许的依赖方向）。
- [ ] 步骤 2：写契约测试，断言：包的路径/名称一致；每个包有 `src/index.ts` 且声明了 `Responsibility:`；所有源码中的 import 只使用允许的依赖边。
- [ ] 步骤 3：运行 `pnpm verify`，期望 typecheck 通过、契约测试通过。
- [ ] 步骤 4（变异验证）：在 `packages/domain/package.json` 临时加入 `"react"` 依赖或让 `domain` import `provider-*`，运行 `pnpm run boundaries`，**期望失败**；随后还原。

**验证**：`pnpm verify` 全绿 + 变异验证失败（证明测试有效）。  
**回滚**：删除包目录与测试文件；对应 commit 单独回退即可恢复空结构。

### Batch 4 · CI 快车道

**最小闭环**：`main` 上的检查名称固定且可被分支保护引用。

**涉及文件**：`.github/workflows/ci.yml`。

- [ ] 步骤 1：写 workflow，job 名称固定为 `PR Fast Gate`，包含 `pnpm install --frozen-lockfile` 与 `pnpm verify`。
- [ ] 步骤 2：本地执行与 workflow 完全相同的命令序列。
- [ ] 步骤 3：推送后回读 `gh workflow list`，确认 workflow 已注册。

**验证**：本地等价命令通过 + `gh workflow list` 中出现该 workflow。  
**回滚**：删除 workflow 文件；远端检查随即消失。

### Batch 5 · 远端发布与保护

**最小闭环**：仓库公开可见、`main` 受保护、只能通过 PR + rebase 合并。

- [ ] 步骤 1：`gh repo create SingularityKChen/harness-projects --public --source=. --remote=origin`（若已存在则改用 `git remote add`）。
- [ ] 步骤 2：`git push -u origin main`。
- [ ] 步骤 3：配置分支保护：必须 PR、1 个批准、要求 `PR Fast Gate` 检查、线性历史、禁止强推与删除、要求解决会话。
- [ ] 步骤 4：仓库设置：只允许 rebase 合并，合并后删除分支。
- [ ] 步骤 5：回读 `gh api repos/.../branches/main/protection` 与 `gh api repos/...` 的 `visibility`、`allow_squash_merge`、`allow_rebase_merge` 核验。

**验证**：回读结果与预期一致（见 Validation and Acceptance §4）。  
**回滚**：`gh api -X DELETE .../branches/main/protection` 关闭保护；仓库删除为显式人工操作，本计划不自动执行。

### Batch 6 · 重构与提交整理

**最小闭环**：在能力不变的前提下，让 diff 与提交历史都能被人一眼读懂。

- [ ] 步骤 1：一致性重构：文件名/路径/术语与 `AGENTS.md` 对齐；删除本批次产生的冗余（重复说明、临时脚本、空目录占位）。
- [ ] 步骤 2：`pnpm verify` 重新全绿（重构不得改变验收结果）。
- [ ] 步骤 3：提交整理：把中间态 fixup 提交合并进对应批次提交，使 `git log --oneline` 与 Plan of Work 的 6 个批次一一对应。
- [ ] 步骤 4：逐条核对 Validation and Acceptance 清单，把证据写入本文件的 Progress 与 Outcomes。

**验证**：`git log --oneline` 与批次一一对应；`pnpm verify` 通过；验收清单全部勾选。  
**回滚**：整理发生在合并前，且每次改写都有备份分支（`git branch backup/pre-rebase`）。

---

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | `AGENTS.md` 覆盖全部约定 | 逐条核对：文档改写、spec/plan 合一、执行阶段自研、运行态例外、worktree 路径、中立命名、PR 规则、批次拆分原则 |
| 2 | `CLAUDE.md` 是相对软链接 | `readlink CLAUDE.md` = `AGENTS.md` |
| 3 | 目标目录结构存在 | `apps/{harness-plugin,web}`、`packages/{domain,core,controller,client,ui-model,ui,capabilities,providers/*,storage/sqlite}`、`tests/{contract,integration,e2e}`、`docs/{architecture,exec-plan,adr,product}` |
| 4 | 工程可复现 | `pnpm install` 与 `pnpm verify` 通过 |
| 5 | 架构边界可执行 | 契约测试通过 + 变异验证失败 |
| 6 | 运行态不入库 | `git check-ignore .worktrees .superpowers` 命中；`git status --porcelain` 干净 |
| 7 | 远端为 public 且 `main` 受保护 | `gh api repos/...` 的 `visibility=public`；protection 返回必须 PR、必须有检查、线性历史、禁强推 |
| 8 | 只能 rebase 合并 | `allow_merge_commit=false`、`allow_squash_merge=false`、`allow_rebase_merge=true` |
| 9 | 不自行合并 | 本计划不执行任何 `gh pr merge`；如需合并，仅报告待人工操作 |

---

## Progress

- [ ] Batch 1：工程底座（`.gitignore`、`.editorconfig`、`package.json`、`pnpm-workspace.yaml`、`tsconfig*.json`）。
- [ ] Batch 2：文档治理层（`AGENTS.md`、`PLANS.md`、`CLAUDE.md` 软链接、`docs/README.md`）。
- [ ] Batch 3：结构与架构契约（17 个包骨架 + 依赖边界契约测试 + 变异验证）。
- [ ] Batch 4：CI 快车道（`PR Fast Gate`）。
- [ ] Batch 5：远端发布与保护（public 仓库、`main` 保护、rebase-only）。
- [ ] Batch 6：重构与提交整理。

---

## Surprises & Discoveries

- Observation：`docs/superpowers/` 这类品牌化路径在真实工具链中会随版本漂移（历史版本出现过单数 `docs/superpower/`），说明把工具名写进持久路径本身就是不稳定的依赖。
  Evidence：上游技能文档与历史发布说明中同时存在 `docs/superpowers/specs/`、`docs/superpowers/plans/` 与 `docs/superpower/`。
- Observation：工程包中的实施计划已经是 ExecPlan 形态（Purpose / Progress / Decision Log / Outcomes），将其固定为仓库级格式可以和上游文档无缝衔接，不需要另造模板。
  Evidence：`mvp-delivery-plan-v0.1.md` 的章节结构与 ExecPlan 规范一致。
- Observation：Node 26 在 glob 匹配到空目录时 `node --test` 仍然退出码 0，因此 `tests/integration`、`tests/e2e` 暂时为空不会让门禁误报失败。
  Evidence：Batch 3 的 `pnpm test` 实际执行结果。

---

## Decision Log

- Decision：spec 与 plan 合并为同一份 exec-plan 文档，而不是分别落到 `docs/specs/` 与 `docs/plans/`。
  Rationale：同一需求的"为什么这样设计"与"具体怎么做"分居两处时，plan 修订会与 spec 漂移；合一份后，读者只需维护一个事实来源。
  Date/Author：2026-09-17 / agent

- Decision：执行阶段不套用上游执行技能，改为批次制 exec-plan。
  Rationale：上游形态以"任务"为切分单位，而本仓库需要的是"可独立验收与回滚的最小闭环"；批次制把验证命令与回滚点直接写进计划。
  Date/Author：2026-09-17 / agent

- Decision：包边界用契约测试 + 变异验证保证，而不是写在文档里。
  Rationale：依赖方向是产品不变量；没有失败用例的规则无法证明自己被遵守。
  Date/Author：2026-09-17 / agent

- Decision：引导期只引入 `typescript` 与 `@types/node`，测试使用 `node --test`。
  Rationale：当前唯一需要的验证是结构与边界；引入测试框架属于"没有对应 required property"的复杂度，等出现真实需要再引入。
  Date/Author：2026-09-17 / agent

- Decision：上游工程包保持在仓库根目录原位，不改写、不搬迁。
  Rationale：它是冻结输入（自带 MANIFEST 哈希与 VERIFICATION 结论），搬迁会引入无收益的 diff；是否归档进 `docs/product`、`docs/architecture`、`docs/adr` 留作后续独立批次决策。
  Date/Author：2026-09-17 / agent

- Decision：分支保护要求 1 个批准，但 `enforce_admins=false`。
  Rationale：需要人工 review 门禁来落实"提交 PR 后禁止自行合并"；同时保留所有者处理引导期异常的能力。
  Date/Author：2026-09-17 / agent

---

## Idempotence and Recovery

- 所有步骤可重复执行：`pnpm install`、`pnpm verify`、`git check-ignore`、`gh api` 回读均幂等。
- 分支保护使用 `PUT`（覆盖式）配置，重复执行结果相同。
- 提交整理前创建 `backup/pre-rebase` 分支；任何历史改写都可回退。
- 若 GitHub 侧操作失败：本地提交与工作区不受影响，可在恢复网络后重新执行 Batch 5，不需要重做 Batch 1–4。
- 若契约测试在变异验证后忘记还原：`git checkout -- packages/domain/package.json`。

---

## Interfaces and Dependencies

- 工具链：`git`、`gh`（已登录 `SingularityKChen`，具备 `repo` scope）、`pnpm 10`、`node ≥ 22`。
- 仓库设置：`SingularityKChen/harness-projects`，public，默认分支 `main`。
- 检查名称契约：workflow job 名称 `PR Fast Gate` 被分支保护引用，改名即改变保护语义，必须同步修改。

---

## Outcomes & Retrospective

（完成后回填。）

---

## Bottom Change Note

- 2026-09-17：首次创建。原因：仓库引导阶段需要一份自带上下文、可被无上下文实现者执行的计划，并把"批次 = 可独立验收的最小闭环"固化为后续工作的默认方式。
