# 看板语义：Status、规划轴与工程轴

> 本文档是 `Status` 字段与九条内置看板工作流开关状态的仓库内权威定义（issue #55 的验收产物）。`docs/exec-plan/active/2026-09-18-delivery-planning-and-board.md` 早于本文档的三处相关表述已改写为与本文档一致（术语表、D2 表、D4 表；见该文件的 Decision Log）。两者若仍有出入，以本文档为准。
> 依据 `AGENTS.md` §3（文档与事实源）：本文档自包含，结论不依赖任何不随仓库分发的外部输入；引用的证据均可在本仓库或 GitHub 上复核。

## 1. 结论

`Status` 是**规划轴**字段，由**人**拥有。它回答的问题是：

> 规划所有者是否**接受**这个工作项已经完成？

不是「代码写完了没有」。这解决了此前仓库里三处互相矛盾的表述——同一份 ExecPlan 的术语表曾把 `Status` 定义成工程口径（代码是否已经写完，由执行过程驱动），D2 表重复同一个口径，D4 表却又把关闭 issue 当成「人做出的规划动作」（规划口径）；`Status` 在同一份文件里被定义了两次，两次互不相容。矛盾的根源不是措辞疏忽，而是看板上曾经只有一个状态字段，规划决策与工程事件被迫共用它。

## 2. 两条轴：定义、字段、谁写

| | 规划轴 | 工程轴 |
|---|---|---|
| 回答的问题 | 规划所有者是否**接受**这个工作项完成 | 代码 / PR / CI 走到哪一步 |
| 看板字段 | `Status`（`Todo` / `In Progress` / `In Review` / `Done`） | `Engineering`（`PR open` / `Changes requested` / `Approved` / `Merged`，见 `docs/exec-plan/active/2026-09-18-delivery-planning-and-board.md` Batch 9） |
| 谁写 | 人（协作者在看板上手动设置） | 自动化：响应 PR / issue 生命周期事件的同步机制（同上 Batch 9），无人参与 |
| 唯一的机械例外 | `Item added to project` 把 `Status` 写成 `Todo` —— 见 §4 | 无 |

`Status` 只有一个例外允许自动化写入：`Item added to project`（人把条目加入看板时，自动给一个 `Todo` 默认值）。这不算引入工程信号，因为触发它的事件本身就是人的规划动作——「把条目上板」——工作流只是机械地把这个已经发生的人类决定转成字段默认值，没有从任何工程事件（PR、CI、review）推断规划状态。除此之外，`Status` 的每一次变化都应当来自人。

### 2.1 `Engineering` 的投影：当前 PR 快照，不是事件历史

`Engineering` 由自动化拥有，但它的取值**不是**事件累积出来的。PR / review 事件只回答「现在值得重算一次」，不回答「当前状态是什么」：一条 `approved` 可能已被新提交作废，一条 `commented` 也不能证明批准消失。因此每一次 reconcile 都重新读取 PR 的**当前快照** `(state, merged, isDraft, reviewDecision)`，再由唯一受控构造器投影出字段值。

投影表（`scripts/sync-engineering-state.mjs` 的 `stateForSnapshot` 是唯一实现）：

| PR 快照 | `Engineering` |
|---|---|
| `state = MERGED`（且 `merged = true`） | `Merged` |
| `state = OPEN`，`reviewDecision = CHANGES_REQUESTED` | `Changes requested` |
| `state = OPEN`，`reviewDecision = APPROVED` | `Approved` |
| `state = OPEN`，其余已知情形（含 `REVIEW_REQUIRED` 与 `null`） | `PR open` |
| `state = OPEN` 且 `isDraft = true` | 清空 |
| `state = CLOSED`（且 `merged = false`） | 清空 |

三条 fail-closed 约束：

- **接受集合是 GitHub GraphQL `PullRequestState` 的完整枚举** `OPEN | CLOSED | MERGED`。未知取值一律失败，不猜测。
- **`state` 与 `merged` 必须互相印证**：`MERGED` 而 `merged ≠ true`、或 `CLOSED` 而 `merged = true`，都是枚举语义漂移，响亮失败。
- **`OPEN` 不得配 `merged = true`**：两者矛盾时同样失败，不挑一个信。

第二条不是形式主义。2026-09-22 实测到一次：接受集合当时写成 `['OPEN','CLOSED']`——**REST** 的形态，REST 的已合并 PR 返回 `state: "closed"` 配 `merged: true`——而本仓库用的是 GraphQL，它对已合并 PR 返回 `state: "MERGED"`。于是产出 `Merged` 的分支永远不可达，**每一次合并事件上的 reconcile 都失败**，看板停在 `PR open`；44 个条目里 25 个与真值不符，唯一的 `Merged` 是人手动设的（issue #110）。当时若容忍 `CLOSED` + `merged: true` 按 REST 语义「蒙对」，这条暗路会让下一次真正的枚举漂移继续静默通过——所以它必须是错误，而不是兼容分支。

**漂移由观察覆盖，不由约定覆盖。** 上面那次故障里，失败发生在合并**之后**（拦不住合并）、不是必需检查、`Board workflow invariants` 只看工作流启停，而契约测试断言的又是错的行为——四层防线全漏。现在补上的那一层是 `Board invariants` 的 `engineering-field` job：按日把每个条目的 `Engineering` 与「引用它的 PR」的真值比较。判定规则见 `docs/development/ci.md`；判定与投影的纯函数实现在 `scripts/engineering-drift.mjs`，可离线核对。

**这条轴与 `Status` 无关。** 合并 PR 只写 `Engineering`，不写 `Status`——`Item closed → Status = Done` 因此被裁决为关闭（见 §5）。一个已合并的工作项停在 `Status = Todo` 是**正常**的：它表示规划所有者还没有接受这项工作完成。

## 3. 不变量 3 在看板上如何被满足

`AGENTS.md` §1.3 第 3 条：

> 项目规划状态与工程执行状态正交（CI 失败、Agent 完成、PR 合并都不得默认覆盖规划状态）。

在只有一个状态字段的年代，这条不变量没有落脚点：工程事件想要被记录，就只能写 `Status`，而这正是 `Item closed`、`Pull request merged` 这类内置工作流当初被打开的理由。有了 `Status` / `Engineering` 的字段分离之后，不变量 3 被翻译成一条可以逐条核对的规则：

> **工程事件只允许写 `Engineering`；`Status` 只由人写（§2 的唯一例外除外）。**

这不再是一句需要人记住的散文，而是可以对着每一条内置工作流机械求值的判定——§4 给出求值规则，§5 是求值结果，`scripts/board-workflow-check.mjs` 是它的可执行形式。

## 4. 内置工作流的推导规则

**一条内置工作流可以开启，当且仅当它写的字段属于它的触发事件所在的那条轴。**

把这条规则展开成可以对任意一条工作流（包括未来新增的第十条）重复执行的步骤：

1. **它写不写看板字段？** 如果它完全不写任何字段（例如只建立条目之间的关系），规则的「两轴是否匹配」无从谈起，只需确认它没有跨轴写入的副作用——允许开启。
2. **如果写字段，那个字段属于哪条轴？** 本仓库当前只有两个候选：`Status` 属于规划轴，`Engineering` 属于工程轴。issue 原生的 open/closed 状态不是 Project 字段，但它同样是「这项工作是否完成」的一个可观察事实，且与 `Status` 之间可能形成写入回路，因此同样需要归轴——按它反映的是「代码是否已交付」这一工程事实，归入工程轴。
3. **触发这条工作流的事件本身，属于哪条轴？** 人在看板上做的动作（把条目上板、手动改字段）属于规划轴；PR/issue 的生命周期事件（关闭、重开、链接、评审、合并）属于工程轴。
4. **第 2 步与第 3 步的轴一致 → 开启；不一致 → 关闭。**

## 5. 九行裁决表

| 工作流 | 它写的字段 | 字段所属轴 | 触发事件所属轴 | 两轴一致？ | 裁决 |
|---|---|---|---|---|---|
| `Item added to project` → `Status = Todo` | `Status` | 规划轴 | 规划轴（人把条目上板） | 一致 | **开启** |
| `Item closed` → `Status = Done` | `Status` | 规划轴 | 工程轴（issue 关闭，常由 `Closes #N` 自动触发） | 不一致 | **关闭** |
| `Item reopened` → `Status` | `Status` | 规划轴 | 工程轴（issue 重开同样可由工程事件触发） | 不一致 | **关闭** |
| `Pull request linked to issue` | `Status` | 规划轴 | 工程轴 | 不一致 | **关闭** |
| `Code review approved` | `Status` | 规划轴 | 工程轴 | 不一致 | **关闭** |
| `Code changes requested` | `Status` | 规划轴 | 工程轴 | 不一致 | **关闭** |
| `Pull request merged` | `Status` | 规划轴 | 工程轴 | 不一致 | **关闭** |
| `Auto-close issue`（`Status = Done` 时关闭 issue） | issue 的 open/closed 状态（不是 `Status`，见 §4 第 2 步） | 工程轴 | 规划轴（触发条件是 `Status` 被改成 `Done`，而按本表其余八行，`Status` 的唯一合法写入点是人） | 不一致 | **关闭** |
| `Auto-add sub-issues to project` | 不写 `Status`（只挂载父子关系） | —— | —— | 规则不适用（§4 第 1 步） | **开启** |

**从表里数「关闭」得到 7 条，不是 6 条。**

控制本文档所属批次的 ExecPlan（`docs/exec-plan/active/2026-09-18-rule-semantics-and-checker-convergence.md`，`Surprises & Discoveries`）在总结句里写的是「六条」——那个数字只统计了写 `Status` 的六个，没有把 `Auto-close issue` 计入，尽管同一条记录紧接着承认它「同样关闭（第七条）」。本文档的九行表是该清单的唯一权威来源，计数为 7。

**九行全部只用 §4 的四步规则求值，没有例外行。** 最容易看成例外的是 `Auto-close issue`：它写的不是 `Status`，而是 issue 自己的 open/closed 状态。但 §4 第 2 步已经把该状态归入工程轴，第 3 步把「人在看板上手动改字段」归入规划轴——而这条工作流的触发条件恰恰是 `Status` 被改成 `Done`，按本表其余八行，`Status` 的唯一合法写入点是人。于是它和其余六条一样，是一次两轴不一致的跨轴写入，只是方向相反（规划 → 工程，并与 `Item closed` 首尾相接构成回环）。方向不影响判定：§4 问的是两轴是否一致，不是谁写谁。

2026-09-18 对真实看板的核对（`gh api graphql` 读 `projectV2.workflows`）显示：上表标「关闭」的全部 7 条当前均为 `enabled: false`，标「开启」的 2 条均为 `enabled: true`，与本表的推导结果完全一致。

`scripts/board-workflow-check.mjs` 导出的 `EXPECTED` 常量就是这张表的可执行形式——九条各自的名字、期望状态与理由；`MUST_BE_DISABLED` 由它**推导**（`filter(r => !r.enabled)`）而不是另行维护，因为手写第二份清单就是再造一处会漂移的副本。两者与本文档必须保持一致，改动其中一边必须同时改另一边（`tests/contract/board-workflow.test.js` 有一条测试把条数、名字与期望状态三样都钉死，防止漂移）。

判定是**双向**的，而且有第四类输出，这两点值得说明，因为它们不是从「必须关闭」这个说法里自然得出的：

- **双向**：只查「该关的有没有开」会漏掉另一个方向。`Item added to project` 被误关之后，新上板的条目会停在空状态，而没有任何东西报出来。因此 `EXPECTED` 声明的是九条各自的**期望状态**，不是一份「必须关闭」的名单。
- **`unknown`：裁决表里没有的工作流一律变红。** GitHub 新增内置工作流时不会通知任何人，而新增的工作流默认没有被裁决过。本仓库实测过 GitHub 在两次读取之间新增三条内置工作流，当时没有任何东西发现。一份只查已知七条的清单会对第十条视而不见——所以未裁决的工作流必须逼一次显式判断（套 §4 的四步规则），而不是默认放行。

四类偏离按严重度排序输出，破坏不变量 3 的 `should-be-disabled` 排最前：`should-be-disabled`（该关的开着）、`unknown`（未被裁决）、`should-be-enabled`（该开的关着）、`missing`（裁决表里有、看板上已不存在，可能是 GitHub 改了名字）。

## 6. 对「`Closes #N` 是人写的，所以关闭也算规划动作」的回应

这是反对「关掉 `Item closed`」最强的一种说法：既然 `Closes #N` 是人在 PR 描述里写下的，那么 issue 因此被关闭，难道不也是人做出的决定吗？

回应是：人写 `Closes #N` 时声明的是**一个关于代码的工程陈述**——「这个 PR 完成了 issue N 描述的工作」。规划状态 `Done` 断言的是**另一件事**——「规划所有者接受这个工作项为完成」。两者大多数时候取值相同，这正是把它们混为一谈显得合理的原因，也正是这类产品存在的理由：如果两者永远一致，就不需要一个显式区分它们的系统。

区分在少数情况下会分道扬镳，而那正是需要保留人工把关的时刻：

- `Closes #N` 由 **PR 作者**写。在多人协作的仓库里，PR 作者未必是这个工作项的规划所有者——链路把一个工程作者的单方面陈述，直接路由进了规划所有者的字段，中间没有确认步骤。
- 代码合入不等于「可以停止跟踪」。工作项可能需要人工验收、灰度观察或外部确认之后才算规划意义上的完成；如果 `Status` 被 PR 合并自动改写，这类「先别关」的意图会被静默抹掉，且不留任何痕迹——`AGENTS.md` §1.3 的补充约束「外部写入未确认前，本地不得把 attempted value 标记为权威成功」在此同样适用：合并只是一次 attempted 的工程完成，不构成规划所有者的 ack。

`Closes #N` 因此仍然是对的、仍然必须写（`AGENTS.md` §8.2 强制要求）——它准确描述了工程事实。错的是让 GitHub 把它触发的 issue 关闭动作，自动透传成看板上的规划状态。2026-09-18 合并 8 个 PR 时，`Item closed` 当时是打开的，实测到 8 次这样的自动写入：`#14 #15 #16 #17 #18 #20 #32 #34` 全部被自动写成 `Done`，过程无人参与、不留 actor 痕迹（完整时间线与查询命令见 issue #45）。这 8 次的取值恰好是对的（工作确实做完了），所以没有造成可见损害——但机制是不变量 3 明确禁止的那一种：工程事实（PR 合并 → issue 关闭）默认覆盖了规划状态，取值凑巧正确不代表机制正确。

## 7. `Size`：人的信号，不是控制

`Size` 字段（单选：`XS` / `S` / `M` / `L` / `拆分`）是人在**规划时**给出的信号：在动手写代码之前，申报这个工作项大致会产生多大的 diff，帮助判断「要不要先拆」。它是一种声明，不是一种**控制**——没有任何机制强制「申报 `XS` 的条目交付时真的只有 100 行」。

`rule-checks size`（`scripts/rule-checks.mjs` 的 `size` 子命令）是另一件事：在**评审时**对实际 diff 做机械度量，核对是否超过 `AGENTS.md` §8.3 的两个上限（代码 ≤ 1000 行、文档 ≤ 1500 行）。

这两者被**有意不连通**——`rule-checks size` 从不读看板的 `Size` 字段，也不产出「实际 vs 申报」的偏差报告。这不是遗漏（issue #48 明确指出过这一点，并给出两个选项：要么让 `rule-checks size` 去读看板做「实际 vs 申报」对比，要么如实承认 `Size` 只是信号），而是权衡之后的结论：

- 读看板的 `Size` 字段**需要凭据**：看板是 user-level project，Actions 默认提供的 `GITHUB_TOKEN` 读不了，必须一枚带 `project` scope 的 PAT。这一条与「那枚 secret 此刻存不存在」无关——存在与否只影响该检查能否跑起来，不影响它必须**依赖凭据**这个性质，而下面两条的论证只用到后者。
- `rule-checks size` 现在是**离线、无凭据**的检查，进 `pnpm verify`，随 `PR Fast Gate` 成为**必需**检查。`AGENTS.md` §9.2 的判定准则是：机械可判定、没有需要人解释的误报类别 → 进必需检查；判定里含人的解释，或者需要凭据 → 只能做 advisory。
- 一旦 `rule-checks size` 需要读看板，它就需要凭据；按同一条判定准则，它必须从「必需」降级为「advisory」。为了多做一个「实际 vs 申报」的比较，把一条**已经生效**的必需检查降级成**需要凭据才能跑**的建议性检查，不划算——这是拿一个更强的保证换一个更弱的观察。

结论：`Size` 是规划时的人工信号，`rule-checks size` 是评审时的机械度量，两者故意不连通。将来要连通的前提**不是**「有了凭据」，而是**重新过一遍 §9.2 的判定准则**并接受由此产生的门禁降级——凭据只是实现前提，判定准则才是决策依据。不能只加对比逻辑而跳过这一步。

> 本节此前把「该 secret 尚不存在」写成了论证的第一条。那是一个**时点事实**：它在写下时为真，随后即变。删掉它之后本节结论不受影响——这正说明它当初就不是承重的论据。凭据的当前状态请用 `gh secret list -R SingularityKChen/harness-projects` 现查，不要依赖本文档的转述。

## 8. Non-goals：本文档不回答什么

本文档只定义「`Status` / `Engineering` / `Size` 在看板上分别是什么、谁写、九条内置工作流该开该关」。以下问题不在本文档范围内，各自有独立的归属：

- **Agent 可以写哪些规划状态、一条 `blocked-by` 边算不算有效**——属于 issue #47，交付载体是 `AGENTS.md` §10 的增补，不是本文档。
- **合并队列的顺序与解冲突记录**——属于 issue #46，交付载体是 `docs/project-management/merge-queue.md`，不是本文档。
- **运行时可观测性检查**（读真实看板、需要 `PROJECTS_TOKEN`，发现偏离即报警）——属于 issue #45 的运行时半边，交付载体是 PR #61 的 advisory workflow：它负责取数与接线，判定逻辑复用本文档 §5 的可执行形式。本文档与 `scripts/board-workflow-check.mjs` 只提供离线判定的纯函数，不发起任何网络请求、不提供 CLI，因此可以留在 `pnpm verify` 这条离线必需检查里。`Engineering` 字段漂移的观察者是同一个 workflow 的第二个 job（`engineering-field`），判定纯函数在 `scripts/engineering-drift.mjs`，规则见 §2.1 与 `docs/development/ci.md`。
- **`Milestone` 与 `Iteration` 两条轴是否正交、`M2`/`M3` 两个里程碑的排序是否需要对调**——这是 issue #48 提出的另外两项连带诉求，与「`Status` 是什么」不是同一条根因链，本文档不处理，留待该 issue 自己的批次。
- **`Kind` / `Area` / `Gate` / `Priority` / `Iteration` 等其余看板字段的完整清单与字段 / 选项 ID**——权威表述在 `docs/project-management/README.md`。该文件尚未同步 `delivery-planning-and-board.md` Batch 2 / Batch 9 新增的字段，这是一个已知缺口，不在本文档的修复范围内。
- **实际去网页界面切换任何工作流开关**——GitHub GraphQL 没有启停内置工作流的 mutation（只有 `deleteProjectV2Workflow`），只能人工操作。本文档不代替那个操作，只定义「开关应该处在什么状态」，供 `scripts/board-workflow-check.mjs` 核对实际状态是否漂移。
