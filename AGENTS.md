# AGENTS.md —— harness-projects 仓库工作约定

> 本文件是本仓库的**唯一权威约定**。
> `CLAUDE.md` 是指向本文件的相对软链接（`CLAUDE.md -> AGENTS.md`），任何修改只改本文件。
> ExecPlan 的格式权威是 `PLANS.md`。本文件出现的所有路径都是仓库内相对路径。

---

## 0. 快速开始

| 我要做的事 | 去哪里做 |
|---|---|
| 澄清一个需求、写设计 | 新建 `docs/exec-plan/active/YYYY-MM-DD-<slug>.md`，先写 Design / Spec 章节 |
| 把设计变成可执行计划 | 同一个文件的 Plan of Work 章节（**不新建 plan 文件**） |
| 开始动手实现 | 按批次执行该 ExecPlan（§6） |
| 写长期架构说明 | `docs/architecture/` |
| 记录一个不可回退的技术决策 | `docs/adr/` |
| 写产品范围、术语、目标形态 | `docs/product/` |
| 需要隔离工作区 | `.worktrees/<task-slug>/`（§7） |
| 提交代码 | 分支 + PR，禁止直接推 `main`，禁止自行合并（§8） |

---

## 1. 这个仓库是什么

### 1.1 一句话

一个**项目交付工作台**：让项目规划事实源（GitHub Projects / 本地）与工程执行事实（本地 Git、GitHub、CI、Agent 执行）在同一个工作空间里被显式关联，而不是靠人去记忆和脑补。

### 1.2 五个能力域

| 能力域 | 回答的问题 | 首个版本的 Provider |
|---|---|---|
| Planning | 要做什么、现在什么状态 | `planning-github-projects`、`planning-local` |
| Development | 代码在哪里、怎么改 | `development-local-git`、`development-github` |
| Delivery | 改完怎么验证、怎么上线 | `delivery-github-actions` |
| Execution | 谁来执行、执行到哪一步 | `execution-harness`、`execution-human` |
| Storage | 本地权威状态存在哪里 | `storage-sqlite` |

### 1.3 七条不变量（不可回退）

任何实现、重构或依赖调整都不得破坏以下不变量；破坏其中任何一条，必须回到 `docs/adr/` 重新评审：

1. 一个工作空间同一时刻只有一个 Planning 事实源。
2. 一个工作空间可以连接多个研发与交付提供方。
3. 项目规划状态与工程执行状态正交（CI 失败、Agent 完成、PR 合并都不得默认覆盖规划状态）。
4. 工程执行采用"阶段 + 并行门禁"模型。
5. 关键关联显式优先，LLM 不进入项目管理控制路径。
6. 工程产物关系沿谱系传播，不反复重新识别。
7. 核心无界面：Host 拥有权威状态，前端只是消费者。

补充两条实现级硬约束：

- 外部写入未确认前，本地不得把 attempted value 标记为权威成功（`Saving…` 可以立刻显示，`Saved` 必须等 Provider ack / reconcile）。
- 凭据不进 Project 数据库：只保存指向 secret 服务的句柄。

### 1.4 当前阶段

- 产品与工程设计已冻结到可实施程度。
- **实现前必须通过 Gate E1**（跨 Provider 对象身份与同步幂等性验证），结论会决定 Schema v1 是否冻结。
- 在此之前，优先交付"不依赖真实 GitHub 也能验收"的纵向切片。

### 1.5 上游输入（只读）

`deepseek-harness-project-delivery-engineering-pack-v0.1/` 是**冻结的上游输入**，包含 PRD、UI Spec、Engineering Design、SQLite Schema、API/Provider Contract、Identity Spike 计划、Test & Release Plan 与 ADR 初稿。

规则：

- 不修改、不重命名、不搬迁其中任何文件；它是带 `MANIFEST.md` 哈希与 `VERIFICATION.md` 结论的输入物。
- 其中的概念需要长期维护时，在本仓库 `docs/` 下**重新表述**，而不是就地编辑上游文件。
- 上游文档与仓库内文档冲突时，以仓库内文档为准，并在 ExecPlan 的 Decision Log 中记录原因。

---

## 2. 目录结构与所有权

### 2.1 目录表

```text
apps/
  harness-plugin/        Harness 客户端模块注册、Slot 接入、主题/布局桥接
  web/                   独立 Web 外壳：路由、连接、布局（复用 packages/ui）
packages/
  domain/                领域实体、枚举、稳定标识、关系语义（纯数据，零依赖）
  capabilities/          能力定义与注册契约（不自带任何 Provider 实现）
  core/                  工作空间生命周期、Provider 组合、状态策略、关系图、投影
  controller/            对外类型化 API、命令与增量流、权限边界
  client/                React-free 客户端模型：稳定身份、快照、增量、重连
  ui-model/              领域对象 → 展示结构（看板列、Sprint 摘要、交付行）
  ui/                    共享 React 页面与组件（不调用任何外部平台 API）
  providers/             能力域实现，只依赖 capabilities
    planning-local/
    planning-github-projects/
    development-local-git/
    development-github/
    delivery-github-actions/
    execution-harness/
    execution-human/
  storage/
    sqlite/              本仓库首个 Storage 实现
tests/
  contract/              能力契约、包边界、错误模型、幂等语义
  integration/           跨包集成（SQLite、Local Git、控制器往返）
  e2e/                   端到端用户链路
docs/                    见 §3
```

### 2.2 依赖方向（硬规则）

```text
providers/*  ─┐
              ├─→ capabilities ─→ core ─→ controller ─→ client ─→ ui-model ─→ ui ─→ apps/*
storage/*   ─┘
```

- `domain` 是叶子：不依赖任何其他包，尤其不依赖 Provider、SQLite、React、Harness UI。
- `capabilities` 只定义契约，不 import 任何 `providers/*`。
- `core` 只依赖 `domain`、`capabilities`（以及经能力定义抽象的存储契约），不 import 具体 Provider。
- `client` 与 `ui-model` 不依赖 React；`ui` 才依赖 React。
- Provider 之间不得互相直接调用（`planning-*` 不得 import `development-*`）。
- `apps/*` 是壳：只做注册、路由、Slot、主题，不承载业务规则。
- 反向依赖与跨层跳跃（如 `ui` 直接 import `providers/*`）一律禁止。

这些规则**由测试保证**，不是靠自觉：`tests/contract/package-boundaries.test.js` 维护允许的依赖边矩阵，`pnpm run boundaries` 可单独运行。

### 2.3 违反示例

| 违规写法 | 为什么错 |
|---|---|
| `core` import `provider-planning-github-projects` | 使 Planning Provider 不可替换 |
| `ui` 里出现 `fetch('https://api.github.com')` | 事实源被前端的临时实现篡位 |
| `client` import `react` | 破坏"模型可被 Harness 与独立 Web 共享" |
| `planning-*` import `development-*` | 跨能力域耦合，Provider 无法独立替换 |
| `domain` import `storage-sqlite` | 存储实现泄漏进领域模型 |

---

## 3. 文档规范

### 3.1 落点规则

持久文档一律落在 `docs/<rest>`。上游工作流默认的 `docs/superpowers/<rest>`（以及历史版本中的单数 `docs/superpower/<rest>`）在本仓库统一改写：

| 上游约定 | 本仓库约定 |
|---|---|
| `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` | `docs/exec-plan/active/YYYY-MM-DD-<slug>.md` 的 Design / Spec 章节 |
| `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` | 同一个 `docs/exec-plan/active/YYYY-MM-DD-<slug>.md` 的 Plan of Work 章节 |
| `docs/superpowers/<rest>` | `docs/<rest>` |
| `docs/superpower/<rest>`（单数） | `docs/<rest>` |
| `.superpowers/brainstorm/`、`.superpowers/sdd/` | **保持不变**：技能定义的 git-ignored 运行态，见 §3.4 |
| `~/.config/superpowers/worktrees/`、`.worktrees/<branch>/` | `.worktrees/<task-slug>/`（§7） |

一句话概括：**工具品牌不出现在正式路径与命名中；spec 与 plan 不再分家。**

### 3.2 spec 与 plan 都保留，但只维护一份文档

流程没有被简化掉，只是收敛了产物：

- **spec 阶段**：澄清意图、给出 2–3 个方案与取舍、得到确认。产物写进 ExecPlan 的 `Design / Spec` 章节。
- **plan 阶段**：把设计拆成带确切路径、命令与期望输出的批次。产物写进同一份 ExecPlan 的 `Plan of Work` 章节。

不允许出现"设计在一个文件、计划在另一个文件"的情况；两者漂移的代价远大于合写带来的篇幅。

### 3.3 语言、命名与格式

- 文档正文用中文；代码标识符、路径、命令、类型名用英文。
- 章节标题保持与 `PLANS.md` 的章节名一致（英文名），便于检索与脚本处理。
- 分支与文档命名保持中立（§8.1）；不要在路径、分支名、标题里写工具品牌。
- 文档中的命令必须是**可复制执行**的，并写明期望输出。

### 3.4 运行态不写入 docs

`.superpowers/brainstorm/`、`.superpowers/sdd/` 以及工具产生的其他临时工作区属于**运行态**：它们由技能定义、被 `.gitignore` 忽略、可以随时丢弃，**不是** `docs/superpowers/*`，因此不参与 §3.1 的改写，也不需要长期维护。

判定标准：如果一份内容删掉之后，下一个接手的人会缺失决策依据，那它是持久文档（进 `docs/`）；否则是运行态（进 `.superpowers/`）。

---

## 4. 计划驱动：ExecPlan

### 4.1 谁需要 ExecPlan

- 任何跨越"设计 + 实现 + 验证"的任务，都需要一份 ExecPlan。
- 单行修复、文案调整、依赖小版本升级不需要；但如果是它促成了一个决策，把决策记到 `docs/adr/`。

### 4.2 生命周期

```text
新建 → docs/exec-plan/active/YYYY-MM-DD-<slug>.md
  ↓ 执行中持续更新 Progress / Decision Log / Surprises
全部验收通过 → 移到 docs/exec-plan/completed/（同一文件名）
```

- `<slug>` 用小写英文连字符，描述任务而不是工具（`repo-bootstrap`、`planning-identity-model`）。
- 移动文件时同步更新 `docs/README.md` 的索引。
- 一个任务一份 ExecPlan；不要把多个不相关的目标塞进同一份文档。

### 4.3 强制章节

格式权威是 `PLANS.md`，`docs/exec-plan/active/2026-09-17-repo-bootstrap.md` 是一个完整样例。最低要求：

`Purpose / Big Picture`、`Context and Orientation`、`Design / Spec`、`Global Constraints`、`Plan of Work`、`Validation and Acceptance`、`Progress`、`Surprises & Discoveries`、`Decision Log`、`Idempotence and Recovery`、`Interfaces and Dependencies`、`Outcomes & Retrospective`、`Bottom Change Note`。

### 4.4 更新义务

- 每完成一个批次：更新 `Progress`（勾选 + 日期）。
- 每遇到与预期不符的事实：写进 `Surprises & Discoveries`，附证据（命令输出、文件路径、上游文档）。
- 每做一个不可轻易反悔的选择：写进 `Decision Log`，含 Rationale 与日期。
- 计划变更：直接改文件，并在 `Bottom Change Note` 追加一条"何时、为何改"。

ExecPlan 的价值在于**让无上下文的实现者（人或 agent）只读这一份文件就能继续**。因此禁止占位符：不写"TBD"、"稍后补充"、"参考上文"；写不出具体内容，说明还没想清楚。

---

## 5. 拆分原则与批次

### 5.1 四个判据（第一性原理）

一批工作存在的唯一理由是：**它能把一个此前无法判定的问题变成可判定的反馈。**

1. **可判定**：本批结束后，有确切命令或检查从"未知/失败"变成"通过"。
2. **可回滚**：撤销范围等于本批 diff，不牵连其他批次已交付的能力。
3. **最小闭环**：批内不包含两个可以分别验收的风险。
4. **不聚合、不摊薄**：不为减少 issue 数量而合并批次；也不把同一风险摊成多个文件级提交。

第 4 条要展开说：**敏捷不是把同一个风险拆成更多文件提交**。把一次改动切成十个只改一个文件的提交，不会缩短反馈，只会让 review 失去判断点——因为没有任何一个提交能被单独验收。真正要缩短的是"从动手到能判定对错"的距离。

### 5.2 纵向优先

优先按**纵向最小闭环**切分（一条链路从入口到可观察结果），而不是按技术层次切分（先写完所有类型定义，再写所有实现，最后写所有测试）。横向切分的问题是：每一层单独都无法验收，风险全部堆积到最后一次集成。

### 5.3 反模式

| 反模式 | 症状 | 修正 |
|---|---|---|
| 按文件拆批 | 提交历史很"干净"，但没有一批能独立验收 | 按"能跑通什么检查"重新划分 |
| 按 issue 凑数 | 为了少开 PR 把不相关改动塞在一起 | 回到判据 1 与 2：合并后还能独立回滚吗 |
| 无限细化 | 一个批次要跑十次全量测试 | 增大粒度到"一次反馈能判定" |
| 批次内并行改同一文件区域 | review 时无法判断哪个改动导致回归 | 批次边界落在文件/模块所有权上 |

---

## 6. 执行阶段：exec-plan 批次流程

本仓库的执行阶段使用**自定义 exec-plan 流程**（不套用上游的子代理任务制执行技能）。

### 6.1 每批的固定动作

1. **对齐**：读该批在 ExecPlan 中的最小闭环、涉及文件、验证命令。
2. **隔离**：确认工作在 `.worktrees/<task-slug>/` 或明确的工作分支上（§7）。
3. **实现**：只改本批涉及的文件；不顺手重构批次外的代码。
4. **验证**：执行本批声明的验证命令，把结果（成功或失败）如实记录。
5. **记录**：更新 ExecPlan 的 `Progress`，必要时补 `Surprises & Discoveries` 与 `Decision Log`。
6. **提交**：按 §8.2 提交本批（一个批次一个提交，或在同一批次内保持可读的少量提交）。
7. **汇报**：向人类伙伴报告"本批闭环 + 验证证据 + 下一批"。

批次之间不要停下来征求"是否继续"的许可——计划已经批准，继续执行；只有真正阻塞（缺凭据、需求歧义、外部系统不可用）才停下。

### 6.2 验证要求

- 涉及行为的改动：先写会失败的测试，再让它通过（TDD），并在批次记录里留下"失败 → 通过"的证据。
- 涉及结构的改动：用契约测试或边界测试证明结构约束。
- 无法自动验证的验收项：写成可复制的人工步骤，并实际执行一次。
- 禁止用"应该可以"、"看起来没问题"作为验收结论。

### 6.3 阻塞处理

阻塞时更新 ExecPlan 的 `Surprises & Discoveries`（发生了什么、证据是什么），并把 `Progress` 中该项标记为阻塞；然后向人类伙伴提出**一个**具体问题，而不是一串猜测。

### 6.4 全部批次完成之后：重构与提交整理

ExecPlan 的所有批次完成后，**必须再做一轮**：

1. **代码重构**：消除重复、统一命名、把批次间临时形成的结构收敛到 §2 的所有权划分；重构**不得改变验收结果**，重构后所有验证命令必须重新全绿。
2. **提交重新组织**：把中间态提交（fixup、typo、临时调试）合并进对应批次提交，让 `git log --oneline` 与 ExecPlan 的批次一一对应；历史改写前先建 `backup/pre-rebase` 分支。
3. **回填**：更新 ExecPlan 的 `Outcomes & Retrospective`，然后把文件移到 `docs/exec-plan/completed/`。

这一轮不是可选项：它是把"实现过程"变成"可被人读懂的历史"的唯一机会。

---

## 7. 隔离工作区（worktree）

### 7.1 路径规则

- 所有隔离工作区位于 **`.worktrees/<task-slug>/`**，`<task-slug>` 与分支名的 slug 一致。
- 该规则**覆盖**任何工具或技能的默认值，包括全局工作区目录（如 `~/.config/.../worktrees/`）与 `.worktrees/<branch-name>/` 这类按分支名命名的形态。
- `.worktrees/` 已被 `.gitignore` 忽略；如果发现未被忽略，先补忽略规则再创建。

### 7.2 创建前检查

```bash
# 1) 是否已经在隔离工作区里（避免嵌套创建）
git rev-parse --git-dir --git-common-dir
# 2) 目录是否被忽略
git check-ignore -v .worktrees/
# 3) 创建
git worktree add .worktrees/<task-slug> -b <type>/<task-slug>
```

### 7.3 收尾

- 分支合并后，显式 `git worktree remove .worktrees/<task-slug>`；不要自动清理有未提交修改的工作区。
- 工作区只放该任务的工作；不要把它当成共享暂存区。
- 沙箱或权限导致无法创建时，在原工作区开工，并在 ExecPlan 中记录这一偏差。

---

## 8. 分支、提交与 PR

### 8.1 分支命名

`main` 是唯一长期分支。工作分支：

| 前缀 | 用途 |
|---|---|
| `feature/<task-slug>` | 新能力、新纵向切片 |
| `fix/<task-slug>` | 缺陷修复 |
| `docs/<task-slug>` | 文档、规范、示例 |
| `chore/<task-slug>` | 工具链、依赖、工程配置 |
| `project-management/<task-slug>` | 项目管理本身（issue 结构、项目字段、流程配置） |

`<task-slug>` 使用小写英文连字符。分支名中不出现工具品牌名（例如不要写 `claude/...`、`cursor/...`）。

### 8.2 提交信息

采用 Conventional Commits：`<type>(<scope>): <中文摘要>`。

- `type`：`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `ci` / `perf`。
- `scope`：包名或区域（`domain`、`core`、`providers`、`docs`、`repo`）。
- 正文写**为什么**，不重复 diff；结尾用 `Closes #N` / `Refs #N` 关联 issue。
- 一个提交对应一个批次（或批次内一个可独立理解的步骤），禁止把无关改动混在同一提交里。

### 8.3 PR 规则

1. **一个 PR 可以关闭多个 issue**，但必须共同构成一个**可独立验收、合并、回滚的能力闭环**；不会单纯为了减少 issue 数量而聚合。
2. **改动规模**：代码 ≤ 1000 行，文档 ≤ 1500 行（`git diff --shortstat` 的增删之和；排除 `pnpm-lock.yaml` 与生成物）。超出即拆分。
3. **禁止自行合并**：提交 PR 后不得 merge，即使 CI 全绿、即使无人 review。是否合并由人类伙伴决定。
4. **合并方式**：被要求合并时使用 **rebase merge**。仓库设置已禁用 merge commit 与 squash，因此"只允许 rebase"是环境保证而非口头约定。
5. **评审方式**：被要求评审时，使用 **GitHub inline review comment**（针对具体行的评论），而不是只在 PR 顶层留一条总结评论。
6. 每个 PR 必须关联 ExecPlan：PR 描述里给出 ExecPlan 路径与批次名。
7. `main` 受分支保护：必须通过 PR、必须通过 `PR Fast Gate`、必须有批准、线性历史、禁止强推与删除。

### 8.4 PR 描述模板

```markdown
## 闭环
<这个 PR 独立解决了什么，验收标准是什么，怎么回滚>

## 关联
- ExecPlan: docs/exec-plan/active/YYYY-MM-DD-<slug>.md（Batch N）
- Closes #N
- Refs #M

## 验证证据
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm verify`
- [ ] <本批特有的验证命令与结果>

## 风险与回滚
<最坏情况是什么；如何回滚>
```

### 8.5 评审规范（inline）

行级评论用 GitHub review comment API，例如：

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments \
  -f body='这里允许 ui 直接依赖 providers 实现，会破坏能力可替换性（AGENTS.md §2.2）。' \
  -f path='packages/ui/src/index.ts' \
  -F line=12 \
  -f side=RIGHT \
  -f commit_id="$(gh api repos/{owner}/{repo}/pulls/{number} --jq .head.sha)"
```

评审输出要可执行：指出具体行、对应哪条约定、建议怎么改。不要输出"整体看起来不错"这类无法行动的结论。

---

## 9. 验证与门禁

### 9.1 本地命令

```bash
pnpm install                 # 建立工作区
pnpm verify                  # typecheck + 全部测试（提交前必须全绿）
pnpm typecheck               # tsc --noEmit
pnpm test                    # node --test tests/{contract,integration,e2e}
pnpm run boundaries          # 只跑包边界契约测试
```

### 9.2 CI 门禁

- **PR Fast Gate**（`.github/workflows/ci.yml`，job 名称即检查名）：`pnpm install --frozen-lockfile` + `pnpm verify`。该检查名被分支保护引用，改名必须同步修改保护配置与本文档。
- **Merge Gate**（后续按需扩展）：契约测试全量、集成测试、端到端、迁移测试、包边界测试。
- **Scheduled Regression**（后续）：大数据量 fixture、重复/乱序事件压测、重连循环、性能趋势。

### 9.3 验收对标

- 实现级验收对标上游 Test & Release Plan 的 10 条不变量（身份、幂等、恢复、能力边界）。
- 阶段门禁：**Gate E1**（身份与同步 spike）通过前不冻结 Schema v1；**Gate R1** 是 MVP 发布门禁。
- 门禁清单存放在上游工程包与 `docs/architecture/`，本仓库不重复维护两份。

### 9.4 完成前自查

在宣布"完成"之前逐条回答：

1. 验证命令是否实际执行过，输出是什么？
2. 是否有任何一个验收项只有推断、没有证据？
3. 是否引入了新的路径/分支/文档命名，且它不含工具品牌？
4. 是否更新了 ExecPlan 的 `Progress`、`Decision Log`、`Surprises & Discoveries`？
5. 若把本批改动整体回退，仓库是否仍处于可工作状态？

---

## 10. 安全与信任边界

- 密钥、token、私钥永不入库；Project 数据库只保存指向 secret 服务的句柄（`secret_ref`）。
- 本地 Git 操作使用 argv / library API，不拼接 shell 字符串；worktree 路径必须规范化并位于允许的根目录内。
- 外部写操作必须可追踪：记录 actor、目标 ProviderBinding、本地幂等键与结果状态。
- LLM（包括本 agent）不参与规划状态、关系语义或发布门禁的控制路径；只做确定性规则明确允许的辅助。
- 破坏性操作（删除分支、清理工作区、删除远端仓库）默认不做；必须由人类显式要求。

---

## 11. 参考

| 文档 | 内容 |
|---|---|
| `PLANS.md` | ExecPlan 格式与生命周期 |
| `docs/README.md` | 文档地图 |
| `docs/exec-plan/active/2026-09-17-repo-bootstrap.md` | ExecPlan 样例（本次仓库引导） |
| `deepseek-harness-project-delivery-engineering-pack-v0.1/README.md` | 上游工程包入口与 Engineering Gate |
| `deepseek-harness-project-delivery-engineering-pack-v0.1/engineering-design-v0.1.md` | 工程设计与依赖方向 |
| `deepseek-harness-project-delivery-engineering-pack-v0.1/test-release-plan-v0.1.md` | 测试分层与发布门禁 |
