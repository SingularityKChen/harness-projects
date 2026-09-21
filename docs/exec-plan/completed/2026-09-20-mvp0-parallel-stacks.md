# MVP-0 并行堆叠 PR 交付 ExecPlan（控制计划）

> 状态：Active
> 创建：2026-09-20
> 范围：把 MVP-0（fake provider 纵向切片）拆成多条并行的堆叠 PR，逐条给出闭环、验收、回滚与文件所有权；包含本次交付的拓扑决策、模型路由与合并顺序。本文件是本次交付的**控制计划**，各栈的细节计划见 `Interfaces and Dependencies` 列出的四份栈计划。
> 上游输入：`AGENTS.md`、`PLANS.md`、`docs/development/workflow.md`、`docs/exec-plan/active/2026-09-18-delivery-planning-and-board.md`、本机只读的上游设计输入（不随仓库分发）

## Purpose / Big Picture

完成后，一个对本项目一无所知的人打开 GitHub，能看到一条**从上到下可合并、从下到上可独立验收**的 PR 栈：底座把工作区依赖图声明清楚；契约栈把五个能力域的接口、错误模型与离线 provider 固定下来；持久化栈给出可重复的迁移运行器；切片栈在无凭据、无网络的条件下让 `workspace → planning item → work item → start work → execution context → 分支/变更请求/CI` 这条链路跑通；文档栈把纵向链路与 R1 门禁逐条写进仓库。

最小成功证据：

```bash
# 1. 全部 11 个 PR 存在，且各自 base 指向它下面那一层，不是 main
gh pr list --state open --json number,baseRefName,headRefName,isDraft \
  --jq '.[] | "\(.number)\t\(.baseRefName)\t\(.headRefName)\t\(.isDraft)"'
# 期望：11 行，除两条栈底外 baseRefName 都不是 main

# 2. 每个 PR 都关联了 issue（draft 状态也必须有 closingIssuesReferences 或 Refs）
gh pr view <n> --json closingIssuesReferences,body --jq '.closingIssuesReferences[].number'
# 期望：契约/切片/持久化/文档栈的每条 PR 至少返回一个编号

# 3. MVP-0 链路在切片栈顶端变绿
node --test tests/mvp0        # 在 C1 的 head 上：期望失败，且失败信息指向未实现的节点
node --test tests/mvp0        # 在 C5 的 head 上：期望全部通过
```

## Context and Orientation

### 术语

| 词 | 在本仓库里的意思 |
|---|---|
| **MVP-0** | 全部用 fake/离线 provider 跑通的那条纵向链路；判定方式是 `pnpm test` 内一条端到端用例通过，无凭据、无网络（issue #7、#42） |
| **能力域** | Planning / Development / Delivery / Execution / Storage 五类可替换边界（`AGENTS.md` §1.1） |
| **Gate E1** | 冻结本地数据模型 v1 之前必须通过的跨 Provider 身份与同步幂等性验证；本次交付**不触碰**它 |
| **栈（stack）** | 一条线性依赖的 PR 链，每个 PR 的 base 是它下面那一层 |
| **批次（batch）** | 一个 PR = 一个批次 = 一个可独立验收、合并、回滚的能力闭环 |
| **组合根** | 把 core 与各 provider 装配起来的唯一位置。包边界矩阵不允许任何生产包同时 import `core` 与 `providers/*`，因此 MVP-0 的组合根落在测试层 |

### 本次交付开始时的仓库事实

- `packages/**/src/index.ts` 全部是 `export const packageId = … as const` 骨架；没有任何包声明过依赖，因此**任何跨包 import 在今天都无法解析**。
- 唯一的测试是过程机械测试（workflow / issue / 看板 / 规则检查）加一个 `package-boundaries.test.js`；产品侧不变量测试数为 0（issue #42 的观察）。
- `package.json` 的 `test` 脚本是 `node --test tests/contract tests/integration tests/e2e`；Node 版本由 `.nvmrc` 固定为 26，因此**可以直接 import `.ts` 源码**（原生类型剥离），不需要构建步骤。
- `pnpm-lock.yaml` 与本机 `node_modules` 同步；CI 使用 `pnpm install --frozen-lockfile`，所以任何 manifest 依赖声明都必须同时更新锁文件，否则 `PR Fast Gate` 直接失败。
- 分支保护：只允许 rebase merge、要求线性历史、要求 `PR Fast Gate` 绿、要求 1 个批准。`gh stack` 扩展（v0.1.0）已安装。

### 与上游设计输入的关系

上游包只在本机只读保留，不随仓库分发（`AGENTS.md` §1.3）。本计划用它回答"契约应该长什么样"，但所有结论都重新表述为仓库内可核对的表述：接口清单进 `packages/capabilities`，实体与不变量进 `packages/domain`，验收命令进本文件与各栈计划。冲突时以仓库内文档为准。

## Design / Spec

### D1. 目标不是"把代码写出来"，而是让 MVP-0 可判定

issue #7 已经给出七个节点与五条可判定断言，issue #42 给出最小决定性下一步：**先有一个会失败的断言，再让失败数单调下降**。因此本次交付的排序原则是：

> 每一层都必须让下面那层的失败变得可观察，并且不引入任何只能靠"看代码"才能验证的结论。

### D2. 为什么是四条并行栈，而不是一条长链

从依赖关系推导，而不是从包目录推导：

| 工作 | 依赖什么 | 能在无凭据环境下完成吗 |
|---|---|---|
| 依赖图声明与强制 | 无 | 能 |
| 领域模型 | 依赖图声明 | 能 |
| 能力契约、契约套件、离线 provider | 领域模型 | 能 |
| 迁移运行器 | 依赖图声明 | 能 |
| core 纵向切片 | 能力契约 + 离线 provider | 能 |
| 纵向链路与 R1 门禁的仓库内重述 | 无 | 能 |
| Gate E1 真实平台实验（#22–#25） | 真实 GitHub sandbox、凭据、人工判断 | **不能** |
| 身份/成员表与执行/关系表（#27、#28） | Gate E1 裁决 | **不能**（写入前会污染身份键） |

于是形成四组**真实**互相独立的工作：契约栈（领域 → 契约 → 套件）、持久化栈（迁移运行器）、切片栈（core → controller/client）、文档栈（纵向链路与门禁重述）。切片栈在契约栈之上，持久化栈与文档栈与两者并行。

**被放弃的方案**：

| 方案 | 为什么放弃 |
|---|---|
| 一条 11 层的长链 | 合并吞吐是当前瓶颈（`2026-09-18-delivery-planning-and-board.md` 的 Surprises），长链把每个 PR 的变基成本乘 11；且持久化与文档本来就不依赖契约栈 |
| 每个包一个 PR（按目录切） | 违反 `AGENTS.md` §5.1：横向分层切分产生的是"每一层都无法单独验收"的批次 |
| 先把 11 个 PR 一次性开好再实现 | 上层分支的 base 会停在没有代码的计划提交上，CI 无法给出真实信号；本计划改为**每层实现完再开它上面那层** |
| 让 core 直接依赖具体的 fake provider | 包边界矩阵禁止生产包同时 import `core` 与 `providers/*`；组合根只能落在测试层，这是设计而不是将就 |

### D3. 本次故意不做的事

| 不做 | 理由 |
|---|---|
| Gate E1 实验（#22–#25） | 需要真实平台 sandbox 与人工裁决，属于 M1；本次交付的可判定部分不依赖它的结论 |
| 身份/成员表、执行/关系表（#27、#28） | issue 正文明确要求等 #25 的裁决；提前写会把错误的键固化进 schema |
| M0.1 的流程控制项（#36/#49/#65–#67） | 它们是交付控制平面的工作，不属于产品链路；混在一起会让"MVP-0 是否跑通"这个信号失真 |
| 真实 GitHub / Git / Harness provider | 属于 MVP-1；MVP-0 的意义正是让 provider 替换是替换而不是重写 |
| 给 MVP-0 引入 SQLite 持久化 | 持久化的契约会牵动身份键，属于 Gate E1 之后；本次用离线 Storage 替身验证"重启后执行上下文可恢复"这条**契约**，并把 SQLite 落地留给 #27/#28 |

### D4. 文件所有权矩阵（并行的前提）

并行只允许发生在互不共享写入区域的工作之间。本次交付的所有权划分：

| 栈 | 独占写入区域 | 禁止触碰 |
|---|---|---|
| F1 底座 | `package.json`、`pnpm-lock.yaml`、`tsconfig.json`、`tests/contract/package-boundaries.test.js`、`docs/project-management/merge-queue.md`、本文件 | `packages/**/src` |
| A 契约栈 | `packages/domain/src/**`、`packages/capabilities/src/**`、`packages/providers/fake/**`、`tests/contract/**`（除 `package-boundaries.test.js`） | `packages/core/**`、`packages/storage/**` |
| B 持久化栈 | `packages/storage/sqlite/src/**`、`tests/integration/**` | 其余全部 |
| C 切片栈 | `packages/core/src/**`、`packages/controller/src/**`、`packages/client/src/**`、`tests/e2e/**`、`tests/mvp0/**`、根 `package.json` 的 `test:mvp0` 脚本 | `packages/domain/**`、`packages/capabilities/**`、`packages/providers/**` |
| D 文档栈 | `docs/product/**`、`docs/architecture/**`、`docs/README.md` | 代码与 CI |

同一时刻一个文件只有一个 owner。跨栈需要改对方文件的诉求，一律回到控制计划改接口，不允许"顺手改一下"。

### D5. 单一函数与单文件体量

| 约束 | 值 | 强制方式 |
|---|---|---|
| 单文件 | ≤ 200 行 | 每个批次的验收项；超限即拆文件 |
| 单函数 | ≤ 40 行 | 同上；纯数据表驱动的函数（如枚举表）例外 |
| 单 PR 代码变更 | ≤ 1000 行 | `node scripts/rule-checks.mjs size` |
| 单 PR 文档变更 | ≤ 1500 行 | 同上 |

拆分的判据是**职责**，不是行数：一个文件只承担一个可命名的职责（如"把外部身份解析为内部实体"），行数上限只是它的机械代理。

### D6. 模型路由与角色

| 阶段 | 模型 | 角色与边界 |
|---|---|---|
| 设计、接口冻结、文件所有权 | 本会话（控制平面） | 只做决策与验收编排，不写实现代码 |
| 并行实现 | `deepseek-v4.1-flash`（`newapi-agic` 路由） | 每个批次一个 agent，独占自己的 worktree，只写自己拥有的文件；按批次验收项自测并回报证据 |
| 对抗验证 | `deepseek-v4.1-flash`，**独立 agent，无实现上下文** | 只做证伪：读 diff 与验收项，跑验证命令，注入缺陷看测试是否有牙，报告"哪条验收项不成立" |
| 验收与重构 | `gpt-5.6-sol`（`newapi-agic` 路由） | 审不变量、接口、状态拥有、错误路径、体量与公开面；允许重构，但不得改变验收结果 |
| 人类评审与合并 | 仓库 owner | agent 不合并任何 PR |

模型是能力路由，不是硬依赖：若某个路由不可用，记录在 `Surprises & Discoveries` 并降级到默认模型，不为迁就模型而降低验证强度。

### D7. 每个 PR 的闭环判定

一个批次只有在下列四条同时成立时才算闭环：

1. **可独立验收**：该批次的验收项能在自己的 head 上全部跑通，不依赖上层批次；
2. **可独立合并**：它的 base 是下面那一层，rebase 到 base 后无需修改即可合并；
3. **可独立回滚**：`git revert` 该批次的提交后，下层仍然自洽；
4. **不聚合也不摊薄**：一个 PR 内的文件共同服务于一个可命名的能力，且不把同一个风险拆成多个只有文件名不同的提交。

## Global Constraints

- 只允许 rebase merge；不得创建 squash 或 merge commit；不得自行合并任何 PR。
- 公开仓库：分支名、提交信息、PR 描述、issue 正文、文档都在发布面内。不得出现本机绝对路径、用户名/主机名、凭据、内网域名、内部系统名。
- 不修改 `main` 的分支保护、不修改 `PR Fast Gate` 的检查名、不新增需要 secrets 的必需检查。
- 不引入任何运行时依赖：离线链路只用 Node 内建模块（`node:sqlite`、`node:test`、`node:crypto`）。
- 不修改 `docs/product/board-semantics.md` 的 `Status` 语义；本次交付不对看板 `Status` 做任何写入（唯一例外是 `Item added to project` 自动写 `Todo`，见该文档 §2）。
- 每个批次都在自己的 worktree 内工作，不共享未声明的临时状态；`.worktrees/` 与 `.superpowers/` 不进版本库。

## Plan of Work

批次按"实现顺序"排列；每个批次一行，字段含义：批次 = PR、闭环 = 它独立交付什么、验证 = 在他自己的 head 上可复制的命令、回滚 = 撤销方式。

### Batch F1 · 依赖图底座（base `main`，Closes #74）

- **最小闭环**：工作区的依赖边从"设计里写着"变成"manifest 里声明着、契约测试会拦着"；测试层能按包名 import 任何工作区包；本次交付的控制计划随代码一起进仓库。
- **涉及文件**：`package.json`、`packages/*/package.json`、`packages/providers/*/package.json`、`packages/storage/sqlite/package.json`、`apps/*/package.json`、`pnpm-lock.yaml`、`tests/contract/package-boundaries.test.js`、`docs/exec-plan/active/2026-09-20-mvp0-parallel-stacks.md`
- **验证**：
  ```bash
  pnpm install --frozen-lockfile
  node --test tests/contract/package-boundaries.test.js
  pnpm verify
  ```
  期望：三条全部通过；向任一 manifest 注入一个越界依赖后第二条失败，撤回注入后恢复。
- **回滚**：`git revert` 本批提交；锁文件与 manifest 回到无依赖声明状态，`packages/**/src` 不受影响。

### Batch A1 · 领域模型（base `chore/workspace-dependency-graph`，Closes #75）

- **最小闭环**：稳定标识、实体类型、外部身份角色、关系语义与状态归一化成为可被测试的纯领域模型，capabilities 与 core 有共同词汇。
- **涉及文件**：`packages/domain/src/**`、`tests/contract/domain-*.test.js`
- **验证**：
  ```bash
  node --test tests/contract
  node_modules/.bin/tsc --noEmit
  ```
  期望：领域测试通过；把 Draft→Issue 提升函数改成"新建实体"后，身份不变性测试失败。
- **回滚**：`git revert`；`packages/capabilities` 尚未依赖这些符号。
- **细节计划**：`docs/exec-plan/active/2026-09-20-contract-plane.md`

### Batch A2 · 能力契约与 Planning 套件（base A1，Closes #29 #30）

- **最小闭环**：五个能力域的接口、稳定 capability key、四态访问级别与结构化错误模型被冻结；Planning 契约套件连同它的离线 provider 一起存在，且"删掉一个能力会让对应用例失败"。
- **涉及文件**：`packages/capabilities/src/**`、`packages/providers/fake/src/**`、`tests/contract/capabilities-*.test.js`
- **验证**：
  ```bash
  node --test tests/contract
  pnpm run boundaries
  ```
  期望：全部通过；从 fake planning provider 移除一个可选能力后，对应的 "not supported" 用例失败。
- **回滚**：`git revert`；A1 与 F1 不受影响。
- **细节计划**：`docs/exec-plan/active/2026-09-20-contract-plane.md`

### Batch A3 · 其余三个域的套件与替身（base A2，Closes #31）

- **最小闭环**：development / delivery / execution 三个域也有契约套件与离线替身，外加一个满足 Storage 契约的内存替身；MVP-0 链路所需的一切都能在无凭据条件下构造。
- **涉及文件**：`packages/providers/fake/src/**`、`tests/contract/{development,delivery,execution,storage}-*.test.js`
- **验证**：
  ```bash
  node --test tests/contract
  pnpm run boundaries
  ```
  期望：全部通过；把 delivery 替身的写操作改成静默成功，`not supported` 用例失败。
- **回滚**：`git revert`；A2 的 planning 套件仍自洽。
- **细节计划**：`docs/exec-plan/active/2026-09-20-contract-plane.md`

### Batch B1 · 迁移运行器（base `chore/workspace-dependency-graph`，Closes #26）

- **最小闭环**：从空目录出发可重复执行的迁移运行器；第二次执行不改动任何东西；失败的迁移不留版本记录。
- **涉及文件**：`packages/storage/sqlite/src/**`、`packages/storage/sqlite/migrations/**`、`tests/integration/migration-*.test.js`
- **验证**：
  ```bash
  node --test tests/integration
  pnpm run boundaries
  ```
  期望：每个用例使用自己的临时数据库；注入一个抛错的迁移后版本号不变。
- **回滚**：`git revert`；不影响任何其它栈。
- **细节计划**：`docs/exec-plan/active/2026-09-20-persistence-plane.md`

### Batch C1 · MVP-0 进度断言（base A3，Closes #42）

- **最小闭环**：#7 的链路变成一条**会失败的**断言，失败信息指向尚未实现的节点；它被放在独立的进度轨道上，不污染必需门禁。
- **涉及文件**：`tests/mvp0/**`、`package.json`（只加 `test:mvp0` 脚本）、`tests/README.md`
- **验证**：
  ```bash
  node --test tests/mvp0   # 期望：失败，且每条失败信息点名未实现的节点
  pnpm verify              # 期望：仍然全绿（进度轨道不进必需门禁）
  ```
- **回滚**：`git revert`；删除进度轨道不影响其它任何东西。
- **细节计划**：`docs/exec-plan/active/2026-09-20-mvp0-slice.md`

### Batch C2 · core 引导与投影（base C1，Closes #76）

- **最小闭环**：从 provider 观察到本地稳定事实——创建 Workspace、解析外部身份、引导条目、回答投影查询；重复观察不产生重复实体；provider 离线时降级而不是失败。
- **涉及文件**：`packages/core/src/**`、`tests/e2e/chain-*.test.js`
- **验证**：
  ```bash
  node --test tests/e2e
  node --test tests/mvp0    # 期望：失败断言数比 C1 减少
  ```
- **回滚**：`git revert`；A 栈与 F1 不受影响。
- **细节计划**：`docs/exec-plan/active/2026-09-20-mvp0-slice.md`

### Batch C3 · Start Work 与执行上下文（base C2，Closes #77）

- **最小闭环**：规划到工程的显式桥——持久化执行上下文、创建工作树与分支、启动执行；同一工作项重复开始不产生第二份；git 失败不启动执行；执行失败保留工作树并降级为人工。
- **涉及文件**：`packages/core/src/**`、`tests/e2e/start-work-*.test.js`
- **验证**：
  ```bash
  node --test tests/e2e
  node --test tests/mvp0
  ```
- **回滚**：`git revert`；core 的引导批次仍自洽。
- **细节计划**：`docs/exec-plan/active/2026-09-20-mvp0-slice.md`

### Batch C4 · 交付谱系与状态策略（base C3，Closes #78）

- **最小闭环**：工作项 → 执行上下文 → 分支 → 提交 → 变更请求 → CI 的谱系成为可查询投影；确定性发现的关系先进入候选；CI 失败与合并都不改写规划状态；缺能力报"不可用"而不是报错。
- **涉及文件**：`packages/core/src/**`、`tests/e2e/delivery-*.test.js`
- **验证**：
  ```bash
  node --test tests/e2e
  node --test tests/mvp0
  ```
- **回滚**：`git revert`。
- **细节计划**：`docs/exec-plan/active/2026-09-20-mvp0-slice.md`

### Batch C5 · Controller、Client 与门禁提升（base C4，Closes #79 #7）

- **最小闭环**：core 的能力通过类型化 API 与 React-free 客户端模型可达；增量订阅能发现缺口并重新拉基线；MVP-0 断言转为绿色并被提升进 `pnpm verify`。
- **涉及文件**：`packages/controller/src/**`、`packages/client/src/**`、`tests/e2e/client-*.test.js`、根 `package.json` 的 `verify` 脚本
- **验证**：
  ```bash
  pnpm verify            # 期望：全绿，且其中包含 tests/mvp0
  node --test tests/mvp0 # 期望：全部通过
  ```
- **回滚**：`git revert`；把 `test:mvp0` 从 `verify` 中移除即可回到 C4 的状态。
- **细节计划**：`docs/exec-plan/active/2026-09-20-mvp0-slice.md`

### Batch D1 · 纵向链路与 R1 门禁的仓库内重述（base `main`，Closes #44）

- **最小闭环**：只读本仓库的人可以判定 MVP-0、MVP-1 与首发范围各自做完了没有；`AGENTS.md` §9 里"门禁清单的可分发表述在 §9 与 `docs/architecture/`"这句话第一次为真。
- **涉及文件**：`docs/product/vertical-path.md`、`docs/architecture/release-gates.md`、`docs/product/README.md`、`docs/architecture/README.md`、`docs/README.md`
- **验证**：
  ```bash
  git grep -n "十三步\|前 12 步\|十二条" -- '*.md'   # 期望：每个计数词都能在同仓找到枚举
  node scripts/rule-checks.mjs size origin/main
  ```
- **回滚**：`git revert`；纯文档。
- **细节计划**：`docs/exec-plan/active/2026-09-20-vertical-path-and-gates.md`

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 11 个 PR 全部存在且为 draft，base 链正确 | `gh pr list --state open --json number,baseRefName,isDraft` 回读 | 待验证 |
| 2 | 每个 PR 关联 issue（`Closes`/`Refs`）且带 kind/area 标签 | `gh pr view <n> --json closingIssuesReferences,labels` | 待验证 |
| 3 | 每个 PR 的 `PR Fast Gate` 在自己的 head 上为绿 | `gh pr checks <n>` | 待验证 |
| 4 | 进度轨道在 C1 上因正确原因失败、在 C5 上全绿 | `node --test tests/mvp0` 在两个 head 上的输出 | 待验证 |
| 5 | 依赖图声明与包边界一致 | `node --test tests/contract/package-boundaries.test.js` 与注入缺陷实验 | 待验证 |
| 6 | 每个批次都经过一个无实现上下文的对抗验证 agent | 验证报告写入各 PR 描述与本文件 `Progress` | 待验证 |
| 7 | 验收与重构由 `gpt-5.6-sol` 完成且重构后复跑验证 | 重构提交 + 复跑输出 | 待验证 |
| 8 | 发布面自查通过 | 机械扫描 + 五类目人工核对 | 待验证 |

## Progress

- [x] (2026-09-20) 控制计划与四条栈的拓扑决策（D2/D3/D4）
- [x] (2026-09-20) 新建 6 个 issue：#74（依赖图）、#75（领域模型）、#76–#79（#7 的四个子批次）
- [ ] Batch F1 · 依赖图底座（#74）
- [ ] Batch A1 · 领域模型（#75）
- [ ] Batch A2 · 能力契约与 Planning 套件（#29 #30）
- [ ] Batch A3 · 其余三域套件与替身（#31）
- [ ] Batch B1 · 迁移运行器（#26）
- [ ] Batch C1 · MVP-0 进度断言（#42）
- [ ] Batch C2 · core 引导与投影（#76）
- [ ] Batch C3 · Start Work 与执行上下文（#77）
- [ ] Batch C4 · 交付谱系与状态策略（#78）
- [ ] Batch C5 · Controller/Client 与门禁提升（#79 #7）
- [ ] Batch D1 · 纵向链路与 R1 门禁重述（#44）

## Surprises & Discoveries

- **Observation**：`pnpm install` 在本机沙箱内直接失败：pnpm 12 会按 `package.json` 的 `packageManager` 字段去安装被 pin 的 10.28.2，而这一步需要写工作区之外的临时目录。
  **Evidence**：`Error: create the temporary package manager install directory / Operation not permitted (os error 1)`；加 `npm_config_manage_package_manager_versions=false` 后安装成功。
  **Decision impact**：本机验证统一用 `npm_config_manage_package_manager_versions=false pnpm …`，或把 10.28.2 装进工作区内的临时前缀再调用。这条不写进仓库（它只影响本机），但每个批次的验证命令都必须说明这一点，否则执行者会误判"依赖装不上"。

- **Observation**：工作区已经有 `node_modules`，但 `node_modules/@harness-projects/*` 不存在——因为没有任何 manifest 声明过工作区依赖。
  **Evidence**：`ls node_modules/@harness-projects` → `No such file or directory`。
  **Decision impact**：F1 是**所有**其它栈的硬前置：没有它，任何跨包 import 在运行时都无法解析，测试层也无法按包名 import。

## Decision Log

- **Decision**：把本次交付切成四条栈（契约 / 持久化 / 切片 / 文档），切片栈叠在契约栈之上，持久化与文档栈与它们并行。
  **Rationale**：依赖关系上真正独立的工作才有资格并行；把 Gate E1 依赖项（#22–#25、#27、#28）与 M0.1 流程项排除出去，才能让"MVP-0 是否跑通"成为一个不失真的信号。
  **Date/Author**：2026-09-20 / agent

- **Decision**：A2 一个 PR 同时关闭 #29 与 #30。
  **Rationale**：五个能力域的接口定义与"Planning 契约套件 + 离线 provider"共同构成一个闭环——没有套件，接口只是类型声明；没有接口，套件无从写起。分开会让 #30 的 PR 无法独立验收。
  **Date/Author**：2026-09-20 / agent

- **Decision**：MVP-0 的进度断言放在独立的 `tests/mvp0/` 轨道，由 `test:mvp0` 运行，暂不进 `pnpm verify`，到 C5 变绿时再提升。
  **Rationale**：issue #42 要求断言存在且"因正确的原因失败"（明确禁止 skip），而分支保护要求 `PR Fast Gate` 绿。两者同时成立的唯一解法是把"故意失败的进度轨道"与"必需门禁"分开，并在它变绿的那一刻提升为必需——这样进度指标既真实存在，又不会把红叉常态化。
  **Date/Author**：2026-09-20 / agent

- **Decision**：MVP-0 的组合根放在测试层，而不是新增一个组合包。
  **Rationale**：`tests/contract/package-boundaries.test.js` 的边界矩阵不允许任何生产包同时 import `core` 与 `providers/*`。新增一个新包需要同时改边界矩阵与 `tsconfig`，而那会把"谁装配谁"这个问题从测试层挪进产品层——MVP-0 需要的是一次显式装配，不是一个新的生产包。
  **Date/Author**：2026-09-20 / agent

- **Decision**：MVP-0 不引入 SQLite 持久化，用满足 Storage 契约的离线替身验证"重启后执行上下文可恢复"。
  **Rationale**：#27/#28 明确等 Gate E1 裁决；本次要验证的是 **core 是否把控制事实持久化到契约边界**，而不是 SQLite 表长什么样。替身让这条契约可以在无凭据条件下被证伪，SQLite 落地仍然属于 #27/#28。
  **Date/Author**：2026-09-20 / agent

- **Decision**：订正本文件 2026-09-20 的「A2 一个 PR 同时关闭 #29 与 #30」：改为 #29 单独一个 PR（Batch A2，只交付契约层），#30 与 #31 合并为下一个 PR（Batch A3，交付离线替身与四个域的套件）。
  **Supersedes**：「A2 一个 PR 同时关闭 #29 与 #30」（2026-09-20 / agent）。
  **Rationale**：实测把五个能力域的接口定义、离线替身与 Planning 契约套件放进同一个 PR，代码变更会超过 `AGENTS.md` §8 的 1000 行上限；拆成两批后，契约层与"替身 + 套件"层各自仍能独立验收、合并与回滚。Batch A3 的闭环因此从"其余三域套件与替身（#31）"扩展为"离线替身与四个域的套件（#30 #31）"。
  **Date/Author**：2026-09-20 / agent

## Idempotence and Recovery

**可重复执行的部分**

- 所有验证命令都是只读的：`node --test …`、`node_modules/.bin/tsc --noEmit`、`node scripts/rule-checks.mjs …`。
- `gh stack sync` / `gh stack rebase` 可以重复执行：它们只把分支对齐到当前 base，不改写已合并历史。
- 每个批次的 worktree 可以用 `git worktree remove --force .worktrees/<slug>` 重建；worktree 内没有需要保留的状态。

**不可重复的部分**

- 分支一旦推送并被别人 fetch，改写需要 `--force-with-lease` 与恢复锚点：
  ```bash
  git branch backup/<branch>-before-reorg <当前 head>
  git push --force-with-lease=refs/heads/<branch>:<远端旧 head> origin <新 head>:refs/heads/<branch>
  ```
- 合并顺序一旦被人类执行，后续 PR 的 base 需要由 GitHub 自动重定向或手工改 base。

**失败后如何回到已知良好状态**

| 出错的东西 | 撤销方式 |
|---|---|
| 某个批次的代码 | `git revert <batch commits>`；下层不受影响 |
| 栈的分支拓扑 | `gh stack unstack --local` 后重建；远端栈对象用 `gh stack unstack <n>` |
| 看板字段回填 | 逐条清空；不触碰 `Status` |
| 进度轨道误入必需门禁 | 从 `package.json` 的 `verify` 里移除 `test:mvp0`（C5 才把它加进去） |

## Interfaces and Dependencies

**外部工具**

- `gh` CLI（已认证，scope 含 `repo`、`project`）与扩展 `gh stack` v0.1.0。所有 `gh stack` 命令必须非交互：`submit --auto`、`view --json`、显式分支名。
- `pnpm` 10.28.2（由 `packageManager` 固定）。本机沙箱内需 `npm_config_manage_package_manager_versions=false`。
- GitHub stacked pull requests 需要在仓库上可用；`gh stack submit/link` 返回 exit code 9 表示不可用，此时降级为手工设置 base 的普通 PR（栈结构不变，只是 GitHub 不显示 stack 分组）。

**仓库设置**

- 分支保护：rebase merge only、线性历史、必需检查 `PR Fast Gate`、1 个批准。
- 看板 Project 10。本次只做机械字段回填（Kind / Area / Size / Iteration / ExecPlan / Batch / Priority），不写 `Status`、不建立或修改 `blocked-by`。

**各栈细节计划**

| 栈 | 文件 |
|---|---|
| A 契约栈 | `docs/exec-plan/active/2026-09-20-contract-plane.md` |
| B 持久化栈 | `docs/exec-plan/active/2026-09-20-persistence-plane.md` |
| C 切片栈 | `docs/exec-plan/active/2026-09-20-mvp0-slice.md` |
| D 文档栈 | `docs/exec-plan/active/2026-09-20-vertical-path-and-gates.md` |

**合并顺序**（变基顺序，不是依赖边；在全部 PR 开出后写入 `docs/project-management/merge-queue.md`，由 D1 分支承载，避免在栈底制造一个写不进真实编号的占位表）

```text
F1 → A1 → A2 → A3 → C1 → C2 → C3 → C4 → C5
F1 → B1
main → D1
```

## Outcomes & Retrospective

本次交付尚未完成。完成后在本节记录：实际落地的 PR 数、与计划的偏差、被推翻的假设、以及"下一层要接手什么"。

## Bottom Change Note

- 2026-09-20：首次创建。原因：MVP-0 需要一个可判定而不是可演示的交付路径，而当前仓库没有任何跨包依赖声明、没有产品侧不变量测试；本计划把工作切成四条栈并冻结文件所有权、模型路由与合并顺序。
