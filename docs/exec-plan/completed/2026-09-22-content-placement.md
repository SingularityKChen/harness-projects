# 2026-09-22-content-placement —— 流程知识住在哪里：四个桶与一条判定规则

> 载体 issue：<https://github.com/SingularityKChen/harness-projects/issues/114>
> 本计划同时是 spec 与 plan（`PLANS.md` §2）；正文中文，代码标识符、路径与命令英文。
> 状态：Completed（2026-09-22 归档到 `docs/exec-plan/completed/`，文件名不变）。

## Purpose / Big Picture

仓库里每一段流程知识现在都住在 `docs/`，但它们的**性质**并不相同：有的换一个仓库仍然成立（怎么执行一场对抗式评审），有的只在这个仓库成立（`Status` 字段的四个取值），有的是机械可判定的（PR 体量上限），有的只是某一次事故的记录。四类东西混在一处，于是：

- 本该是脚本的散文没人执行（`AGENTS.md` §9 要求「链接检查」，而仓库里没有这个命令）；
- 本该是技法的散文被当成项目约定，agent 每次都要现场读长文档；
- 项目约定被复述到第二处，两套定义同时活着（issue #112）。

完成后：

1. 任何一段流程知识都有一个**可机械求值**的归属判定，规则只有四个桶；
2. `AGENTS.md` §0 路由表的每个入口都能在分类表里找到自己的桶；
3. 一条检查盯住**引用完整性**与**覆盖**——它顺带把 §9 那条写在纸上从未实现的链接检查补上；
4. 后续两个 skill 与三项脚本缺口各自有明确依据，不再靠感觉决定。

判断成功的最小证据：

```bash
node --test tests/contract/content-placement.test.js
# 期望：ℹ fail 0

node scripts/rule-checks.mjs size origin/main
# 期望：exit 0
```

## Context and Orientation

### 术语

- **技法**：回答「怎么做」的程序性知识，换一个仓库仍然成立。例：锁住不可变 head 再评审、按根因修复而不是逐条打补丁。
- **项目约定**：只在这个仓库成立的事实。例：`Status` 的四个取值、issue 标题格式、字段 ID、七条不变量。
- **机械约束**：能用正则或校验判定真假的规则。例：PR 体量上限、workflow 的 W1–W7、发布面扫描。
- **一次性**：某一次发生过的事情的记录。例：某轮评审的风险矩阵。
- **skill root**：技能发现器扫描的目录。本仓库相关的两个是 `<projectRoot>/.agents/skills`（项目级）与 `<user home>/.agents/skills`（用户级）。

### 相关文件与当前状态

| 路径 | 当前状态 |
|---|---|
| `AGENTS.md` §0 | 9 行路由表（任务 → 入口），实际上已经是一张 skill 目录 |
| `AGENTS.md` §3 | 「正式文档全部在 `docs/`；运行态**内容**（`.superpowers/` 与 `.worktrees/`）不进文档」；`docs/` 必须自包含 |
| `AGENTS.md` §9 | 要求「文档只执行文档命令和**链接检查**」——**仓库里没有这个命令** |
| `docs/review/mvp-review.md` | 39 行；§1–§3 是技法（锁事实 → P0–P3 矩阵 → 一次性 inline），§2 的七条不变量与两轴是约定，§4 归档路径是约定 |
| `docs/review/responding.md` | 23 行；§1–§4 主体是技法，末尾「rebase merge 只有人类明确要求时执行」是约定 |
| `docs/development/workflow.md` | 49 行；项目约定（批次、ownership、模型路由） |
| `docs/project-management/merge-queue.md` | 275 行；项目约定（栈拓扑、合并顺序、冲突裁决） |
| `PLANS.md` | 134 行；项目约定（ExecPlan 格式契约） |
| `docs/product/board-semantics.md` | 117 行；项目约定（字段语义、九行裁决表） |
| `docs/development/publication.md` | 18 行；约定 + 机械（`rule-checks disclosure` 已实现机械部分） |
| `docs/development/ci.md` | 97 行；约定 + 机械（`workflow-check.mjs` 已实现 W1–W7） |
| `.agents/` | **不存在**；也**不在 `.gitignore` 里**，可直接提交 |
| `package.json` 的 `verify` | `typecheck && test && test:mvp0`——没有任何链接检查 |

### 三条外部依据（本计划的规则不是自创的）

1. **`writing-skills` 的边界**（Superpowers 技能库的同名技能；引用原文，规则以引用为准，不依赖其在本机的安装位置）：

   > **Don't create for:** … **Project-specific conventions (put in your instructions file)** … **Mechanical constraints (if it's enforceable with regex/validation, automate it—save documentation for judgment calls)**
   >
   > Skills **are**: Reusable techniques, patterns, tools, reference guides
   > Skills are **NOT**: Narratives about how you solved a problem once

2. **DSH 的技能发现器**（`@deepseek-ai/dsh-skill-filesystem` 的 `roots()`）实测扫描五个 root，其中项目级 `<projectRoot>/.agents/skills` 的 rank 是 200、用户级 `<user home>/.agents/skills` 是 500。`projectRoot` 由 cwd 向上找第一个含 `.git` 的目录决定；**数字小 = 优先级高**。因此仓库根 `.agents/skills/` 是一等发现路径，且**会遮蔽同名的用户级技能**。

   root 与 rank 的完整表**只由** `docs/development/content-placement.md` §6 持有。本计划原先在这里复述了整张表，已与文档漂移（`user-agents` 一格的写法两边不同），按本计划 D2 第二条「同一条断言不得同时存在于两个桶」删除复述，只留上面这个结论。

3. **全局技能库的现有形状**（`<user home>/.agents/skills/`）：`requesting-code-review`（怎么**请**评审）、`receiving-code-review`（收到反馈的社交纪律，到「实现」为止）、`gh-address-comments`（取评论的 gh 管道）。**没有任何一个讲「怎么执行一场对抗式评审」，也没有一个讲「实现之后怎么按证据闭环」**——仓库的两份评审文档填的是真缺口，不是重复。

### 为什么现在做

同一个形状的故障在这个仓库出现过三次：

| 事故 | 形状 |
|---|---|
| issue #110 | 自动化被移除，替代品只写在散文里，`Engineering` 冻结两天 |
| issue #112 | 同一条断言写在两处，两套 `Status` 定义同时活着 |
| issue #55 | 验收用字面量 grep，同一个断言换一组词就绕过 |

三次都是**归属不清**：知识住在哪里没有规则，于是同一段知识要么被复制、要么没人执行、要么被写成无法执行的散文。

### 范围边界（刻意不做的事）

- **不把八份流程文档都做成 skill。** 按第 1 条依据，其中六份是项目约定，本来就不该进 skill。
- **不写 ADR。** `docs/adr/README.md` 的门槛是「推翻后会导致已经写好的代码或已经发布的接口需要重做」；本决定推翻后只是把文本搬回去，够不上。
- **不在本计划里建 skill。** 两个候选 skill 各自需要一轮 TDD 循环（baseline → 最小 skill → 复跑 → 补漏洞），是独立批次。
- **不在本计划里补那三项脚本缺口**（链接检查已由本计划的检查覆盖一部分；`edited` 触发与 sweep 自修复不在内）。
- **不改任何看板状态**，不碰 `Status` / `Engineering` 的值。

## Design / Spec

### D1：四个桶，按顺序求值

对任何一段流程知识，按顺序问四个问题，**第一个命中即归属**：

| # | 问题 | 命中 → |
|---|---|---|
| 1 | 它能不能被正则 / 校验**机械判定**？ | **脚本**（检查器 + 契约测试） |
| 2 | 它是「怎么做」的**技法**，换一个仓库仍然成立？ | **skill**（`.agents/skills/<name>/SKILL.md`） |
| 3 | 它只在这个仓库成立（路径、字段 ID、不变量、门禁、词汇表）？ | **`docs/` 或 `AGENTS.md`** |
| 4 | 它记录的是**某一次**发生过的事？ | **不建**，写进对应 ExecPlan（完成后进 `completed/`） |

顺序是有意的，两条优先级各自防一类错误：

- **1 先于 2**：机械可判定的不该写成散文，哪怕是技法。仓库已经吃过这个亏——§9 要求链接检查，实际没有实现。
- **2 先于 3**：可复用技法不该因为出现在本仓库就降级成约定。评审技法就是被这条误判过。

**放弃的方案**：按「是否可执行」切。它跨了桶 1 与桶 3（可执行的约定不是技法），会把 `merge-queue.md` 这种纯约定误判成 skill 候选。
**放弃的方案**：按「是否高频」切。频率只是「可复用」的代理指标，而且它会随时间漂移——一个判据不该依赖观察窗口。

### D2：两条补充规则

- **同一份文档混了两类内容 → 拆，不整份搬。** 先例：`docs/review/responding.md` 保留仓库特有部分，技法部分只写「使用 Superpowers 的接收评审流程」。
- **同一条断言不得同时存在于两个桶。** 一个桶持有它，另一个桶只能引用。这是 issue #110 与 #112 共同买来的教训。

### D3：文档布局

| 放哪 | 放什么 | 为什么 |
|---|---|---|
| `AGENTS.md` §3 | **一行规则 + 链接** | 约定属于指令文件（依据 1）；根文件刻意精简（§0 开头写明「只保留跨任务都必须知道的导航、边界和门禁」） |
| `docs/development/content-placement.md` | 判定规则、四桶定义、现有内容分类表、反例 | 详细流程按任务读取——与仓库既有的 §9 / `ci.md` 分工同构 |
| `.agents/skills/` | 技法（后续批次） | 依据 2 实测的一等发现路径 |

`AGENTS.md` §3 现有那句「正式文档全部在 `docs/`」放宽为三类，与既有的「运行态**内容**不进文档、路径引用是例外」保持同一句式：

> - 正式文档全部在 `docs/`；可复用**技法**在 `.agents/skills/`（见 `docs/development/content-placement.md`）；运行态**内容**（`.superpowers/` 与 `.worktrees/` 下的状态、日志、清单）不进文档。

### D4：现有内容的分类

归属表在 `docs/development/content-placement.md` §4，**本计划不复述它**——复述它正是本计划要消灭的「同一断言写在两处」。这里只记设计决定：

- **以 `AGENTS.md` §0 的任务名为行键**（9 行），不以文件名为键。按文件列清单正是 issue #55 漏掉整套定义的成因。
- 每行给出该任务涉及的内容、涉及的全部桶、处置。**恰好一个任务名、一个处置，但可以有多个桶**——「拆」正是 D2 第一条规则的应用结果；检查断言的是**任务名唯一**，不是「桶唯一」。
- 另有一张**缺口表**记录「本该是脚本却还只是散文」的项。它是观察记录、不是路由分类，因此**不参与**检查。

**评审 P2-2 指出本计划原先在这里复述了整张表，而且已经与 §4 漂移**：`提交 PR / 处理评审` 行少了 `docs/review/mvp-review.md`、`日常开发和验证` 行留着裸 `workflow-check.mjs`、`发布面与敏感信息` 行的路径写法不同、缺口表 3 项对 5 项。复述已删除；`PLANS.md` §4「一个事实只写一处」在这里同样适用。

### D5：验证手段

新增 `tests/contract/content-placement.test.js`。解析对象只有两个：`AGENTS.md` §0 的路由表，与 `docs/development/content-placement.md` 的**归属表**（缺口表不参与）。

**断言清单以测试文件里的用例名为准，本计划不复述条数**——条数会随评审增补而变化（本批次就从五条增到六条），写在这里就是又一处会漂移的副本。设计上要覆盖的类别是：覆盖（两个集合精确相等）、唯一归属（两张表各自不得有重复任务名）、桶名合法、**§0 入口与归属表「涉及内容」的一致性**、引用完整性、规则落地。

**为什么这是桶 1 而不是散文**：每一条都能用正则与文件存在性判定。引用完整性那一条正是 §9 那条从未实现的「链接检查」在本仓库第一次落地——**不是为 skill 加的仪式，是为一条已存在的规则补实现**。

**这个检查不覆盖什么（如实记录）**：「同一条断言写在两处」**无法**机械地一般性检查。仓库的先例（PR #113 的棘轮）是可推广的形态——每抓到一次真实重复，就为那条断言加一条针对性断言——而不是造一个通用检查器去猜。

### D6：命名约束（后续批次必须遵守）

仓库内技能**不得与全局技能同名**：项目级 root 的 rank 是 200、用户级是 500，数字小者优先，所以同名会在项目内**静默遮蔽**全局技能。两个候选名已按此避开：

- `reviewing-a-delivery-pr`（执行评审）
- `closing-review-feedback`（闭环回复；文首写 `REQUIRED BACKGROUND: receiving-code-review`，把它定位成全局技能的下半场而不是竞争者）

### 不变量（本计划必须保持）

- 判定规则只有一份，在 `docs/development/content-placement.md`；`AGENTS.md` §3 只引用不复述。
- 本计划不写任何看板字段。
- 离线检查不新增网络或凭据依赖。
- 不新增 workflow、依赖、secret。

## Global Constraints

- Node 版本以 `.nvmrc` 为准（当前 `26`）。
- 新增依赖：**无**。
- 代码变更 ≤ 1000 行、文档变更 ≤ 1500 行。
- 提交格式 `<type>(<scope>): <中文摘要>`，末尾 `Closes #114`。
- 公开面执行 `docs/development/publication.md` 的机械扫描与五类目人工检查。
- 只允许 rebase merge；是否合并由人类伙伴决定。

## Plan of Work

### Batch 1 · 边界文档与规则落地（最小闭环）

**最小闭环**：`AGENTS.md` §0 的每个入口都能在一份文档里查到自己的桶。

**涉及文件**：`docs/development/content-placement.md`（新增）、`AGENTS.md`、`docs/README.md`、`docs/development/README.md`

**步骤**

1. 写 `docs/development/content-placement.md`：四桶定义（D1）、两条补充规则（D2）、文档布局（D3）、分类表与缺口表（D4）、命名约束（D6）、检查覆盖与不覆盖的边界（D5）。
2. `AGENTS.md` §3 按 D3 放宽为三类并加链接。
3. `docs/README.md` 与 `docs/development/README.md` 的入口表加一行。

**验证命令与期望输出**

```bash
ls docs/development/content-placement.md
# 期望：文件存在

grep -n "content-placement.md" AGENTS.md docs/README.md docs/development/README.md
# 期望：三处各至少一行

grep -n "AGENTS.md" docs/development/content-placement.md
# 期望：分类表与规则落地都指向它，且本文档不自称权威
```

**回滚点**：`git revert` 单个提交；纯文档，无外部写入。

### Batch 2 · 引用完整性与覆盖检查

**最小闭环**：把分类表里的一行删掉，或把 §0 指向一个不存在的路径，测试变红。

**涉及文件**：`tests/contract/content-placement.test.js`（新增）

**步骤**

1. 按 D5 写断言。任务名从 `AGENTS.md` §0 的表格里解析，分类表从 `docs/development/content-placement.md` 的表格里解析；缺口表按表头排除。
2. 注入验证：删掉分类表一行 → 覆盖断言变红；把 §0 的某个路径改成不存在的 → 引用完整性变红；让同一任务名出现两行 → 唯一归属变红；把一个桶名改成表外词 → 桶名合法变红；删掉 §3 的链接 → 规则落地变红。

**验证命令与期望输出**

```bash
node --test tests/contract/content-placement.test.js
# 期望：ℹ fail 0
```

**回滚点**：`git revert` 单个提交。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 判定规则可机械求值 | `docs/development/content-placement.md` §2 的四问表存在且有序 | 通过 |
| 2 | §0 每个入口都有归属 | 覆盖断言通过，且两个集合精确相等 | 通过 |
| 3 | 每个入口恰好一行，桶名合法 | 唯一归属与桶名合法两条断言通过 | 通过 |
| 4 | 引用完整 | 引用完整性断言通过（§0 路由表与归属表） | 通过 |
| 5 | 规则已落到指令文件 | `AGENTS.md` §3 含链接，断言通过 | 通过 |
| 6 | 检查有判别力 | 十一组注入覆盖全部六条断言后还原复跑全绿 | 通过 |
| 7 | 离线检查无网络 / 无凭据 | `pnpm verify`（期望：0 fail；`tests/mvp0` 全 pass）。不写死 pass 条数——它随仓库增长漂移；实测观察记录见「第三轮评审响应」 | 通过 |
| 8 | 体量与发布面合规 | `rule-checks size` / `disclosure` / `git diff --check` 全部 exit 0 | 通过 |
| 9 | 真实 CI 全绿 | `gh pr checks <n> -R <owner>/<repo>`（期望：全部 pass） | 通过，重算命令见「真实 CI 与远端回读」 |
| 10 | 未写任何看板字段 | 本计划不含任何看板写入调用 | 通过（结构性） |

## Progress

- [x] (2026-09-22) 三轮 brainstorming 收敛：痛点 A/B/C 均有、切分规则、skill 位阶、边界文档优先
- [x] (2026-09-22) 核实三条外部依据：`writing-skills` 的边界、DSH 发现器的 root 与 rank、全局技能库的缺口形状
- [x] (2026-09-22) 创建 issue #114
- [x] (2026-09-22) 建隔离工作区 `.worktrees/w9-content-placement`
- [x] (2026-09-22) Batch 1 · 边界文档与规则落地（`content-placement.md`、`AGENTS.md` §3、两处索引）
- [x] (2026-09-22) Batch 2 · 引用完整性与覆盖检查（6 条断言全绿；九组注入覆盖全部六条断言后还原复跑）
- [x] (2026-09-22) 第三轮评审订正（P2×2、P3×1 全部属实）：证据写法、运行态覆盖盲区、rank 表复述；注入扩到十一组
- [x] (2026-09-22) 归档：文件移入 `docs/exec-plan/completed/`，`docs/README.md` §2 索引同步

## Surprises & Discoveries

- **(2026-09-22) 我两次把「能不能做成 skill」判得太快。** 第一次说 `responding.md`「已在委托全局 `receiving-code-review`——保持」，依据只是它 §2 的一句「使用 Superpowers 的接收评审流程」——把**一句委托**当成了**整份委托**。逐条比对后：14 条主题里只有 4–5 条重叠，全局技能停在「实现」，而该文档的重心在**实现之后**（根因修复、判别性测试、推送后回读、重查矩阵）。**一份文档里的一句委托，不能推出整份文档已被覆盖。**
- **(2026-09-22) 仓库根的 `.agents/skills` 是一等发现路径，不是自创约定。** 读 `@deepseek-ai/dsh-skill-filesystem` 的 `roots()` 确认：`project-agents` root、rank 200，而用户级 `<user home>/.agents/skills` 是 rank 500——数字小者优先，所以**项目级会静默遮蔽同名用户级技能**。这条推出了 D6 的命名约束，是讨论开始时没人知道的。
- **(2026-09-22) `AGENTS.md` §0 的九行路由表本身就是一张 skill 目录。** 这让「要不要再做一份 skill 目录」这个问题变了一个形状：不是新增一层，而是把已有的一张表变成可机械求值的分类表。
- **(2026-09-22) 我上一轮把「需不需要 ADR」判高了。** 按 `docs/adr/README.md` 自己写的门槛（推翻后要重做代码或已发布接口），本决定够不上；`AGENTS.md` §2 的另一条触发条件（「同一事实的**第二个**权威源」）也不成立——这个提案是**减少**一个源。已撤回。
- **(2026-09-22) 新检查第一次运行就抓到我自己写的一个歧义。** 归属表的处置列里写了反引号包起来的裸 `` `ci.md` ``，被引用完整性断言判为「引用了不存在的路径」。检查是对的——裸文件名在仓库根不存在，写法本身就有歧义。已改成「其 W1–W7」。这条同时说明断言 4 不是空转。
- **(2026-09-22) 引用完整性的扫描范围必须限制在 §0，不能扫整个 `AGENTS.md`。** 第一版扫全文，立刻被 §2 的 `packages/providers/*` 这类通配模式判红。修法是两条：范围收到 §0 路由表，且把 `*` 与 `<` 一样当作通配符截断到目录部分。**范围定得太宽会让检查变成噪声，然后被关掉。**

## Decision Log

- **Decision**：采用 D1 的四桶规则，按「机械 → 技法 → 约定 → 一次性」顺序求值。
  **Rationale**：`writing-skills` 的三条边界给出了判据；顺序的两条优先级各自对应一类已经发生过的错误。
  **批准**：2026-09-22 由人类伙伴在三轮 brainstorming 中逐节确认。
  **Date/Author**：2026-09-22 / agent
- **Decision**：规则落 `AGENTS.md` §3 一行 + `docs/development/content-placement.md` 详述。
  **Rationale**：依据 1 说约定属于指令文件；根文件又要求精简。一行规则 + 链接同时满足两条。
  **Date/Author**：2026-09-22 / agent
- **Decision**：分类表以 `AGENTS.md` §0 的**任务名**为行键，不以文件名为键。
  **Rationale**：§0 是路由的权威；按文件列清单正是 issue #55 漏掉整套定义的成因（D1 的「要改三处」表按文件列，于是漏了 `project-management/README.md`）。
  **Date/Author**：2026-09-22 / agent
- **Decision**：不写 ADR。
  **Rationale**：够不上 `docs/adr/README.md` 的门槛；`AGENTS.md` §2 的「第二个权威源」也不成立——本决定减少一个源。理由记在本计划与本文件的 Bottom Change Note。
  **Date/Author**：2026-09-22 / agent
- **Decision**：两个候选 skill 命名为 `reviewing-a-delivery-pr` 与 `closing-review-feedback`，避开全局同名。
  **Rationale**：项目级 rank 200 会遮蔽用户级 rank 500，同名即静默顶掉全局技能。
  **Date/Author**：2026-09-22 / agent
- **Decision**：两个 skill 与三项脚本缺口不在本计划内，各自另开批次。
  **Rationale**：skill 需要 TDD 循环（baseline → 最小 skill → 复跑），不是文档搬家；把它们塞进同一份计划会让批次既不可独立验收也不可独立回滚。
  **Date/Author**：2026-09-22 / agent

## Idempotence and Recovery

- Batch 1 / 2 都是纯文档与离线测试，可任意重跑，无副作用。
- 失败后回到已知良好状态：`git revert` 本 PR 的提交。
- 本计划**不写任何外部状态**，因此没有需要回滚的外部写入。
- 不会做的事：不 push --force（除非评审要求且已建 backup ref）；不删除 worktree；不改分支保护。

## Interfaces and Dependencies

- **不新增**：workflow、依赖、secret、分支保护设置、看板写入路径。
- **依赖的既有规则**：`AGENTS.md` §3（文档与事实源）、§9（验证入口）、`PLANS.md` §2（spec 与 plan 合一）。
- **依赖的外部事实**：`writing-skills` 的三条边界；`@deepseek-ai/dsh-skill-filesystem` 的 root 与 rank（本计划记录实测值，若上游改变需同步 D6）。
- **命名契约**：四个桶名固定为 `技法` / `约定` / `机械` / `一次性`，检查按这四个字符串解析分类表。

## Outcomes & Retrospective

### 实际结果

两个批次完成，按 TDD 走：先写检查看它失败（文档不存在，RED），再写文档让它通过（GREEN），最后用注入验证它真的有判别力。

**验证证据**——在检出 `docs/content-placement` 的工作树根目录运行，Node v26：

```bash
node --test tests/contract/content-placement.test.js   # 期望：6 pass / 0 fail
pnpm verify                                            # 期望：0 fail；tests/mvp0 全 pass
node scripts/workflow-check.mjs                        # 期望：no findings
```

**十一组注入**——覆盖全部六条断言，没有一条是冗余的，也没有一条是空转的：

| 注入 | 变红的断言 |
|---|---|
| I1 删掉归属表一行（`隔离工作区`） | 覆盖（两个集合精确相等） |
| I2 `AGENTS.md` §0 的 `docs/adr/` 改成 `docs/adrs/` | 引用完整性 **+** §0 入口与归属表的一致性（两处独立命中） |
| I3 归属表里同一任务名出现两行 | 唯一归属 |
| I4 把一个桶名 `约定` 改成 `惯例` | 桶名合法 |
| I5 桶列留空 | 桶名合法 |
| I6 一行被截断成三列 | 桶名合法 |
| I7 删掉 §3 的 `content-placement.md` 链接 | 规则落地 |
| I8 §0 的入口换成另一个**同样存在**的路径 | §0 入口与归属表的一致性 |
| I9 §0 路由表里同一任务名出现两行 | 唯一归属 |
| I10 归属表 `隔离工作区` 行的「涉及内容」换成另一个存在的路径（`` `docs/adr/` ``） | §0 入口与归属表的一致性 |
| I11 §0 `隔离工作区` 的入口换成另一个**运行态**路径（`` `.superpowers/<other-slug>/` ``） | §0 入口与归属表的一致性 |

I4 / I5 / I6 同源（都指向桶名合法）但各自独立判别：换词、留空、行截断是三种不同的写法错误。I8 是评审给的探针——第一版的归一化把每条路径都归约成目录，文件级替换因此完全看不见；归约现在只对真的含占位符的路径成立。

I10 / I11 是第三轮评审给的探针，补的是同一类盲区的另一半：第一版的 `referencedPaths()` 把运行态 token **整体丢弃**，于是 `隔离工作区` 那一行在覆盖断言下完全不设防（两个探针当时都全绿）。修法是把「运行态」变成一个标记，只由存在性断言消费；覆盖断言照常比对。详见「第三轮评审响应」。

每次注入后都还原并复跑全绿。

### 与计划的偏差

1. **引用完整性的扫描范围从「`AGENTS.md` 全文」收到「§0 路由表」**，并把 `*` 与 `<` 同等当作通配符截断到目录部分。第一版扫全文，被 §2 的 `packages/providers/*` 判红——范围太宽会让检查变成噪声，然后被人关掉。见 Surprises。
2. **归属表的「桶」列改名为「涉及的全部桶」**。原稿的列名让「提交 PR / 处理评审」那行语义不清（它同时含技法与约定）。检查断言的是**任务名唯一**，不是桶唯一——这一点在计划的自审阶段已改正，实现时沿用。

### 真实 CI 与远端回读

交付 PR：[#116](https://github.com/SingularityKChen/harness-projects/pull/116)。base 与 head 都是易失值，按下面的命令回读，不写在这里——本节原先钉的 `main@124f0e4` 在本分支 rebase 之后已经不成立（第三轮评审顺带发现，与 P2-1 同根因）。

`PLANS.md` §4 要求易失状态写成「回读命令 + 期望」而不是写成值，所以这里记命令与期望，不记 check 条数与 head SHA：

```bash
# 在检出 docs/content-placement 的工作树根目录运行
gh pr checks 116 -R SingularityKChen/harness-projects
# 期望：全部 pass

gh pr view 116 -R SingularityKChen/harness-projects \
  --json headRefOid,baseRefName,mergeable,mergeStateStatus,closingIssuesReferences
# 期望：baseRefName=main；mergeable=MERGEABLE；closingIssuesReferences 含 114
```

**观察记录（2026-09-22T09:42Z @ `7319bf5`）**：当时 12 项检查全部 pass，`mergeable = MERGEABLE` / `mergeStateStatus = CLEAN`。该 head 在写入本节之后即被本节所在的提交取代——**这正是「不把易失值写成正文事实」的理由**：任何记录 head SHA 的提交都会立刻让自己的记录过期。后续 head 的结论请用上面的命令重算。

本节与评审响应里引用的 head SHA（`7319bf5`、`4598591` 等）是**观察当时的**历史标记，不是当前历史里的对象——本分支随后经过 rebase 与提交折叠，它们只在 GitHub 的 PR 时间线与评审意见里可追溯。这与「不把易失值写成正文事实」是同一条规则的两面：记录观察时刻是允许的，把它当成现状是不允许的。

### 评审响应（2026-09-22）

一次独立评审给出 6 条意见（P2×2、P3×4）。逐条核实后**全部属实**，无一条被反驳；核实方式与处置如下。

| # | 意见 | 核实 | 处置 |
|---|---|---|---|
| F1 | 记录的 CI 证据钉在非 head 的 SHA 上，违反 `PLANS.md` §4 | 属实。交付 head 是 `c49e500`，而记录写 `7319bf5`——**写这条记录的提交本身就是 `c49e500`**，所以该记录永远无法满足自己的断言 | 「真实 CI 与远端回读」改为「回读命令 + 期望」，另记观察时刻与当时的 head 并注明它已被取代；验收表第 9 项同样改为命令形式 |
| F2 | 提交 `4598591` 的信息被工具产物污染 | 属实，且比意见描述的更严重：多出 18 行，含下一个提交的**逐字节相同**的完整正文与两处裸 `MSG2`。已推送 | 重写该条提交信息（备份锚点 + 精确 lease 强推） |
| F3 | `gh` 证据命令缺 `-R` / `--repo` 与执行上下文 | 属实，`PLANS.md` §4「证据带执行上下文」明文要求 | 补齐 `-R` 与「在检出 `<branch>` 的工作树根目录运行」 |
| F4 | 把本机路径当作规则的权威 | 属实。`AGENTS.md` §3 要求 `docs/` 自包含 | 去掉 `~/.agents/skills/writing-skills/SKILL.md` 这一引用，保留逐字原文；规则改以引用为准 |
| F5 | 测试文件头声称覆盖 `docs/` 引用，实际只覆盖 §0 与归属表 | 属实，且正是本 PR 要消灭的那类「同一事实两处相反」 | 文件头改为与实现一致的措辞 |
| F6 | 桶名断言接受空格子；畸形短行会抛 `TypeError` 而不是报出违规 | 属实 | 断言列数为 4、桶列非空，两类违规都给出可读诊断 |

**两处没有照单全收的地方**，理由如下：

- **F4 的范围**：意见同时指出 `~/` 路径在 `docs/` 已有先例（实测约 10 处，来源是运行器注册、agent preset 与沙箱限制记录）。本次只改「本机路径**作为仓库契约的权威**」这一类——那是性质不同的用法，读者无法从仓库内验证。其余先例不属本批次，改记入 `docs/development/content-placement.md` §5 的缺口表（`docs/` 里的本机路径没有任何检查，而 `disclosure` 的机械扫描按设计不覆盖这一类）。
- **§6 的 rank 表**保留 `~/.agents/skills`：那里它不是引用来源，而是**发现根的名字**——跨运行时的约定目录名，没有仓库内相对写法。已在文档里把它与「规则的权威」区分开。

  > **本条已被第二轮的 P3-1 取代。** `docs/development/content-placement.md` §6 现在写 `<user home>/.agents/skills`，与同表兄弟行的 `<projectRoot>` / `$DSH_HOME` 占位风格一致。上面这行原文保留以存评审轨迹，**结论以 §6 为准**。

**新增的两条缺口记录**（都因本次评审才发现，见 `docs/development/content-placement.md` §5）：提交信息形状没有检查（F2 因此静默通过了 `Disclosure scan` 与 `Issue policy`）；`docs/` 里的本机路径没有检查。

**未采纳但记录在案**：评审认为新计划未登记进 `docs/README.md` §2 的 Active 表「不是缺陷，至多是可选的可发现性打磨」，理由是 `docs/exec-plan/active/README.md` 只在**归档**时要求更新索引。本批次仍然登记了一行——该表名为「ExecPlan 索引」且已有 Active 段，本仓库另一份在途计划（#113）同样登记；归档时的更新是强制项，不是排他项。

### 第二轮评审响应（2026-09-22）

第二轮独立评审给出 1 条 P1、2 条 P2、3 条 P3。逐条核实后**全部属实**，无一条被反驳。

| # | 意见 | 核实 | 处置 |
|---|---|---|---|
| P1 | PR 无法合并：base 漂移且 `docs/README.md` 冲突 | 属实，`mergeable=CONFLICTING`；两边都在 `2026-09-21-merge-gate-layers` 行之后插入一行，是 add/add | 已 rebase 到最新 `main`，索引表保留两行 |
| P2-1 | PR 描述夸大注入证据，且与仓库内 ExecPlan 矛盾 | 属实。原文写「七组注入每组命中不同断言」，而当时只有五条断言——**七组不可能各命中不同的一条**；ExecPlan 三处仍写「五组」且完全没提新增的两组 | 补足断言并重跑，注入表改为按实测覆盖关系表述（九组覆盖全部六条）；三处计数同步；本节的 `Bottom Change Note` 记下订正 |
| P2-2 | ExecPlan 复述了规范性归属表，且已经漂移 | 属实，且漂移有四处：`提交 PR / 处理评审` 行少了 `docs/review/mvp-review.md`、`日常开发和验证` 行留着裸 `workflow-check.mjs`、`发布面与敏感信息` 行路径写法不同、缺口表 3 项对 5 项 | 复述整段删除，改为只记设计决定并指向 §4。**这直接违反本计划自己的 D2 第二条**（同一断言不得同时存在于两处） |
| P3-1 | 新文档违反 §3 自包含，且新检查看不见这一类 | 属实。rank 表里 `~/.agents/skills` 与同表兄弟行的 `<projectRoot>` / `$DSH_HOME` 占位风格不一致；而 `referencedPaths()` 跳过所有 `~` 开头的 token | 改为 `<user home>/.agents/skills` |
| P3-2 | §0 路由表自身重复一行检测不到 | 属实。唯一性断言只扫归属表，覆盖断言用 `Array.includes`，所以 §0 重复既不报 missing 也不报 extra | 唯一性断言同时扫两张表 |
| P3-3 | §0 的入口可以被静默换成另一个存在的路径 | 属实，且**第一版修复没有真正关掉它**：归一化把每条路径都归约成目录，文件级替换完全看不见 | 归一化只对真的含占位符的路径成立；新增「§0 入口必须被同一任务的「涉及内容」覆盖」断言，评审给的探针现在变红 |
| P3-4 | 若干精度限制 | 部分采纳 | 「规则落地」从裸子串改为「同一条目里既有链接又有规则落点」；通配截断与 `..` 两条按原样保留（前者是刻意的、已在正文写明；后者只用于存在性探测且输入是受信仓库文本） |

**P2-2 是这一轮最值得记的一条**：本计划的 D2 第二条写着「同一条断言不得同时存在于两处」，而计划自己在 D4 里复述了整张规范性表格——并且已经漂移。规则写给别人的时候最容易忘记它同样管自己。

### 第三轮评审响应（2026-09-22）

第三轮独立评审给出 2 条 P2、1 条 P3，共 5 条 inline 意见（锚定 head `5951f1a`）。逐条核实后**全部属实**，无一条被反驳。

| # | 意见 | 核实 | 处置 |
|---|---|---|---|
| P2-1 | 记录的验证证据钉在已被取代的 head `45c32dc` 上，四条数值在 `5951f1a` 全部不可复现 | 属实。`5 pass` 实测为 6；`387 pass` 实测为 440（该 head 自己的 CI job `106740909667`：`ℹ tests 440 / pass 440 / fail 0`）；代码 133→193、文档 486→514（`size()` 以本 PR 声明的 base `2bdf6f2` 判定） | 验收表第 7 项与证据段改为「命令 + 期望」，不再写死易失的 pass 条数；实测值只作为带时刻的观察记录 |
| P2-2 | `referencedPaths()` 把运行态 token 整体丢弃，覆盖断言对 `隔离工作区` 行空转；文件头却声称相反 | 属实。两个探针在修复前**全绿**：归属表该行「涉及内容」换成 `` `docs/adr/` ``、§0 该行入口换成 `` `.superpowers/<other-slug>/` `` | 运行态改为 token 上的一个标记，只由存在性断言消费；覆盖断言照常比对。两个探针现在变红（记为 I10 / I11） |
| P3-1 | 复述的 rank 表已与文档漂移；第一轮处置与第二轮处置自相矛盾且未标注取代 | 属实。本文件 `~/.agents/skills` 与 `docs/development/content-placement.md` §6 的 `<user home>/.agents/skills` 是同格两写法；第一轮「保留」与 P3-1 处置「改为」直接相反 | rank 表复述整段删除，改为指向 §6（唯一持有者）；第一轮那行加「已被 P3-1 取代」标注；其余 `~/.agents/skills` 改为 `<user home>/.agents/skills` |

**为什么第 7 项不再写死 pass 条数**：这是 P2-1 的根因，不是它的症状。`PLANS.md` §4 要求易失状态写成「命令 + 期望」，而「本次跑了多少条测试」正是最易失的一类值——`45c32dc` 的 387 之所以变成错误陈述，就是因为它被写成了正文事实。同一形状在本计划里已经出现三次（F1 → P2-1 → 本轮），所以这次改的是写法，不是数字。

**观察记录（2026-09-22）**：本轮订正后在工作树根目录复跑——`node --test tests/contract/content-placement.test.js` → 6 pass / 0 fail；`pnpm test` → 0 fail；`tests/mvp0` → 0 fail；`rule-checks size` / `disclosure` → exit 0；`workflow-check.mjs` → no findings。条数与体量是易失值，只记命令与期望；要当前数字请按上面的命令重算。

**一处如实说明**：本文件第一、二轮响应里仍含 `~/.agents/skills` 字样，那是**评审轨迹里的逐字引用**（记录当时表里写的是什么），不是规范性陈述——规范陈述一律用 `<user home>` 占位。保留它们是为了让「改了什么」可复核。

### 遗留问题与技术债务

1. **引用完整性只覆盖 §0 路由表与归属表，不覆盖 `docs/` 全树。** `AGENTS.md` §9 要求的「链接检查」因此只落地了一部分。覆盖全树需要处理 `AGENTS.md` §2 那类通配模式与 `docs/` 里的相对链接，是独立批次（已记入 `docs/development/content-placement.md` §5 的缺口表）。
2. **两个 skill 候选尚未开工。** `reviewing-a-delivery-pr` 与 `closing-review-feedback` 各需一轮 TDD 循环（baseline → 最小 skill → 复跑 → 补漏洞）。REST 阶段的素材现成：本会话里 agent 两次把 `Status` 的轴归属读错，以及 2026-09-18 交付评审里记录的「首个 P1 就收工」。
3. **两项脚本缺口未补**：工程轴的 `edited` 触发、每日 sweep 只报不修。
4. **D6 依赖的上游 rank 值是实测快照。** `@deepseek-ai/dsh-skill-filesystem` 的 `PROJECT_AGENTS_RANK = 200` / `USER_AGENTS_RANK = 500` 若变化，D6 的遮蔽结论需要重核。root 与 rank 的完整表现在**只由** `docs/development/content-placement.md` §6 持有（第三轮 P3-1 删掉了本文件里的复述），上游变化时改那一处即可。
5. **判定规则里「技法还是约定」仍需人读一遍。** 规则让那次判断有据可依、结论可复核，但它不取消判断——`docs/development/content-placement.md` §7 已如实写明。

## Bottom Change Note

- (2026-09-22) 创建本计划。依据：三轮 brainstorming 的收敛结论、`writing-skills` 的三条边界、DSH 技能发现器的实测 root 与 rank、全局技能库的缺口形状。
- (2026-09-22) 自审后修正三处：桶列改名消歧、补一条桶名断言、缺口表明确排除在解析之外。
- (2026-09-22) 评审 P2-1 订正：原文写「七组注入每组命中不同断言」，而当时只有五条断言——**七组不可能各命中不同的一条**。已补足断言并重跑，改为按实测的覆盖关系表述。
- (2026-09-22) Batch 1 / 2 完成后回填 Progress、Surprises（检查第一次运行就抓到我自己写的裸 `ci.md`；引用扫描范围必须收到 §0）与 Outcomes。
- (2026-09-22) 第三轮评审订正三处：验证证据改为「命令 + 期望」（P2-1，去掉写死的 pass 条数与过期 base）、运行态 token 只对存在性豁免（P2-2，补 I10 / I11 两个探针）、rank 表复述删除并指向 §6（P3-1，同时标注第一轮处置已被取代）。顺带修正本节原先钉死的 base `main@124f0e4`。
- (2026-09-22) 全部验收通过，按 `PLANS.md` §2 / `docs/exec-plan/active/README.md` 归档：文件移入 `docs/exec-plan/completed/`，并更新 `docs/README.md` §2 索引。
