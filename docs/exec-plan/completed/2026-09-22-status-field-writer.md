# 2026-09-22-status-field-writer —— 给 `Status` 一个定义、一个写入口、一个防漂移的检查

> 载体 issue：<https://github.com/SingularityKChen/harness-projects/issues/112>
> 本计划同时是 spec 与 plan；正文中文，代码标识符、路径与命令英文。

## Purpose / Big Picture

`Status` 是看板的规划轴字段。仓库已经裁决过**谁拥有它**（规划所有者），却从来没有写下**谁写它**、**什么时候写**。结果是两套定义同时活着，而交付工作流里一个字都没提这个字段。

完成后：

1. `Status` 的语义在仓库里只有一个事实源，`docs/project-management/README.md` 只登记字段、不复述定义；
2. 四个取值在规划轴下各自的含义被写下来（此前只有工程轴的定义）；
3. `docs/development/workflow.md` 写明合并之后谁推进 `Status`、按什么条件推进；
4. 一条契约测试在有人把工程轴读法写回来时变红，且它不是字面量 grep。

判断成功的最小证据：

```bash
node --test tests/contract/board-status-semantics.test.js
# 期望：ℹ fail 0

grep -rn "与 PR 生命周期对齐" docs/
# 期望：只命中把它记为"已被推翻"的历史文件与计划，不再命中任何活定义
```

## Context and Orientation

### 术语

- **规划轴 / `Status`**：回答「规划所有者是否**接受**这个工作项完成」，由人拥有。定义在 `docs/product/board-semantics.md` §2。
- **工程轴 / `Engineering`**：回答「代码 / PR / CI 走到哪一步」，由自动化拥有。同上一节。
- **代理写入**：agent 代替人执行机械的看板写入。`AGENTS.md` §7 与 `docs/development/repository-rules.md` §3 规定 `Status` 的代理写入必须先有一条**点名目标**的人类批准，并记入所属 ExecPlan 的 `Decision Log`；没有这条批准的写入「视为无效，应回滚或补批准」。

### 两份互不相容的活定义

| 出处 | 定义 | 轴 |
|---|---|---|
| `docs/product/board-semantics.md` §1/§2 | 「规划所有者是否**接受**这个工作项完成」；`Status` 只由人写 | 规划 |
| `docs/project-management/README.md` §1 | 「与 PR 生命周期对齐：`In Review` = PR 已提交待评审；`Done` = 已合并或已验收」 | 工程 |
| `docs/project-management/README.md` §2 | `Todo ──开始实现──▶ In Progress ──提交 PR──▶ In Review ──合并/验收──▶ Done` | 工程 |

第一份自我声明为该字段的权威定义（issue #55 的验收产物），并且 `docs/exec-plan/active/2026-09-18-rule-semantics-and-checker-convergence.md` D1 记录了 2026-09-18 的人类伙伴裁决支持它。第二份是它推翻的那个读法，**至今没有被改**。

D1 的「要改三处」表只列了 `docs/exec-plan/active/2026-09-18-delivery-planning-and-board.md` 的术语表、D2 表与 D4 表三处，`docs/project-management/README.md` 不在其中。issue #55 的验收标准是 `grep -rn '开发做完没' docs/` 输出为空——它通过了，因为活下来的那份定义用的是「与 PR 生命周期对齐」这组**不同的词**。这正是本仓库反复警惕的那类假绿：检查看得见的字面量，看不见同一个断言的另一种写法。

### 这个字段今天没有写入口

- `Board invariants` 在 2026-09-20T07:13:47Z 与 2026-09-21T07:23:13Z 两次核对「9 条内置看板工作流全部符合裁决表」——即六条会写 `Status` 且由工程事件触发的内置工作流都关着（`Item added to project` 按 §2 是唯一机械例外、保持开启；标「关闭」的第七条 `Auto-close issue` 写的是 issue 状态，不是 `Status`）。**内置 workflow 这一支被明确排除**（`docs/product/board-semantics.md` §5，不变量 3 的直接要求）。
- `scripts/sync-engineering-state.mjs` 是唯一写看板字段的脚本，它只写 `Engineering`，每次运行都打印 `Status 未被改动`。
- `docs/development/workflow.md` 全文**没有提过看板的 `Status` 字段**（唯一的 `Status` 命中是 `mergeStateStatus`）。
- 历史上也没有被删掉的写 `Status` 脚本（`git log --all --diff-filter=D -- scripts/` 为空）。
- 唯一写下来的入口是 `docs/project-management/README.md` §3 的一条手敲 `gh project item-edit`。

### 实测：字段确实在被推进，只是没有任何记录

在内置工作流被两次核对为全部合规之后关闭的 17 个条目里，**16 个是 `Done`**（#7 #26 #29 #30 #31 #36 #42 #44 #49 #65 #66 #76 #77 #78 #79 #99），**只有 #10 是 `Todo`**。

人类伙伴于 2026-09-22 确认：这 16 次是**规划所有者本人在看板上手动设置的**，是有效的规划轴写入，不是无批准的代理写入。因此它们不在 `repository-rules.md` §3 的回滚/补批准范围内。

这条确认同时定下了写入口的形态：**常规写入是人手动做的，不需要新建自动化；缺的是把它写下来。** `#10` 正是从这条没有写下来的路径上漏掉的那一个。

### 范围边界（刻意不做的事）

- **不重新打开任何会写 `Status` 的内置工作流。** `board-semantics.md` §5 已经裁决，不变量 3 也禁止。
- **不为 `Status` 新建自动化脚本。** 已确认常规写入由人手动完成；agent 代理是例外路径，规则已存在。
- **不改 `Engineering` 轴**，也不动 PR #111 加的漂移观察者。
- **不写任何 `Status` 值**，包括 `#10`——那需要一条点名 `#10` 的人类批准。

## Design / Spec

### D1：以规划轴为准，`README` 只登记字段、不复述定义

`docs/project-management/README.md` §1 的 `Status` 行不再写语义，改成指向 `docs/product/board-semantics.md`。理由不是省字，而是**消灭第二份会漂移的副本**——本仓库在 `scripts/board-workflow-check.mjs` 里已经明确拒绝过"手写第二份清单"的形态，这里是同一个形态。

`README` 仍是看板字段清单与维护命令的载体（§3 的 `gh project item-edit` 保留），它只是不再**定义** `Status` 是什么。

### D2：四个取值在规划轴下的含义（本计划首次写下）

`docs/product/board-semantics.md` §2 只定义了轴，没有定义四个取值各自的含义；仓库里唯一的取值定义就是那份要被推翻的工程轴版本。因此本计划必须补上，且必须有仓库内依据，不能自己发明：

| 取值 | 规划轴含义 | 依据 |
|---|---|---|
| `Todo` | 规划上尚未启动 | `Item added to project` 的机械默认值（`board-semantics.md` §2 的唯一例外） |
| `In Progress` | 规划上已启动；阻塞时留在这里 | `docs/project-management/README.md` §2 现有规则「阻塞时保留在 `In Progress`」，该条与轴无关，保留 |
| `In Review` | 工程侧已交付，**等规划所有者验收** | `docs/review/2026-09-18-mvp-delivery-review.md:248`：「如果其中任何一个 issue 被刻意停在 `In Review` 等人签字，那个意图会被静默抹掉」——「等人签字」正是这个取值存在的理由 |
| `Done` | 规划所有者**已接受**完成 | `docs/product/board-semantics.md` §1 |

**关键差别**：四个取值仍然构成一条链，但推进它的是**规划决定**，不是工程事件。`In Review` 不再等于「PR 已提交待评审」，而是「工程已经交付，验收与否还没定」；PR 提交、评审通过、合并、CI 变绿都不改变 `Status`。

**放弃的方案**：把 `In Review` 直接删掉，只留 `Todo` / `In Progress` / `Done`。更干净，但 `Status` 是 GitHub Projects 的内置字段，删选项会改动既有 26 个 `Done` 条目的字段定义，且「等签字」这个状态确实需要一个落脚点。保留四个取值，只改含义。

### D3：写入口写成规则，而不是写成脚本

`docs/development/workflow.md` 新增一节，写明：

1. `Status` 是规划轴字段，工程事件不推进它；
2. 合并之后由**规划所有者**决定是否接受完成——接受置 `Done`，不接受留在 `In Review` 并写明还差什么；
3. 写入由规划所有者本人执行（看板界面，或 `docs/project-management/README.md` §3 的命令）；
4. 例外：agent 可以代写，前置是一条点名目标的人类批准并记入所属 ExecPlan 的 `Decision Log`。

**为什么不做成脚本**：人类伙伴 2026-09-22 确认常规写入是人工完成的。为一个由人决定、频率低、每次目标都不同的动作建自动化，会把「谁批准」这条唯一的把关点变成一个可以绕过的默认路径——那正是 `board-semantics.md` §6 反对 `Item closed` 的同一个理由。

### D4：防漂移检查不能是字面量 grep

新增 `tests/contract/board-status-semantics.test.js`，断言四件事：

1. **单一事实源**：`README` 的 `Status` 行必须指向 `board-semantics.md`；
2. **旧读法不再作为活定义存在**：`docs/` 全树下 `与 PR 生命周期对齐` 与 `In Review` = `PR 已提交待评审` 只允许出现在**显式白名单**里（记录"改前/改后"的历史文件与本计划）；
3. **白名单不腐烂**：白名单里每个路径都必须存在，且必须真的命中至少一处——否则删掉它；
4. **交付流程提到了它**：`docs/development/workflow.md` 必须写明合并后 `Status` 由谁推进。

第 2 条的形态是**棘轮**：白名单只收历史文件，新文件命中即红。它比 issue #55 用的字面量 grep 强在两点——覆盖了同一断言的不同措辞，且新增命中不会被静默放过。

**为什么白名单不是"第二份会漂移的清单"**：`board-workflow-check.mjs` 拒绝的是**同一事实的第二份权威副本**（裁决表的复制品）。这里是**豁免清单**，它不表达任何语义，只表达"这些文件是在记录历史"。第 3 条断言防止它腐烂。

### 不变量（本计划必须保持）

- `Status` 的语义只有 `docs/product/board-semantics.md` 一个事实源。
- 工程事件不写 `Status`。
- 本计划不写任何 `Status` 值。
- 离线检查不新增网络或凭据依赖。

## Global Constraints

- Node 版本以 `.nvmrc` 为准（当前 `26`）。
- 新增依赖：**无**。
- 代码变更 ≤ 1000 行、文档变更 ≤ 1500 行。
- 提交格式 `<type>(<scope>): <中文摘要>`，末尾 `Closes #112`。
- 公开面执行 `docs/development/publication.md` 的机械扫描与五类目人工检查。
- 只允许 rebase merge；是否合并由人类伙伴决定。

## Plan of Work

### Batch 1 · 文档对齐（最小闭环）

**最小闭环**：`Status` 在仓库里只有一个定义，且交付流程写明了谁推进它。

**涉及文件**：`docs/project-management/README.md`、`docs/development/workflow.md`

**步骤**

1. 改写 `docs/project-management/README.md` §1 的 `Status` 行：去掉工程轴定义，改为指向 `board-semantics.md`；§2 的状态图与规则改为规划决定驱动，保留「阻塞时留在 `In Progress`」。
2. 在 `docs/development/workflow.md` 新增 §3.2，按 D3 写明写入口与例外。
3. ~~在 `docs/product/board-semantics.md` §2 补一句交叉引用，指向 `AGENTS.md` §7 的代理写入规则。~~ **已撤回**（2026-09-22）：人类伙伴确认常规写入本来就是人手动完成的，该文件 §2 的「谁写」一格原本就准确；而 PR #111 正在改同一个文件，再改一次会制造不必要的冲突。代理写入的说明改放在 `docs/development/workflow.md` §3.2 与 `docs/project-management/README.md` §2。理由见 `Decision Log`。

**验证命令与期望输出**

```bash
grep -n "Status" docs/project-management/README.md | head
# 期望：Status 行含 board-semantics.md 链接，不含 "与 PR 生命周期对齐"

grep -n "Status" docs/development/workflow.md
# 期望：至少一处命中看板 Status 字段（此前唯一命中是 mergeStateStatus）
```

**回滚点**：`git revert` 单个提交；纯文档，无外部写入。

### Batch 2 · 防漂移契约测试

**最小闭环**：把工程轴读法写回 `README` 会让测试变红。

**涉及文件**：`tests/contract/board-status-semantics.test.js`（新增）、`docs/README.md`（ExecPlan 索引）

**步骤**

1. 按 D4 写四条断言。
2. 注入验证：把 `README` 的 `Status` 行改回工程轴读法 → 变红；删掉白名单里的文件 → 变红；把 `workflow.md` 的新节删掉 → 变红。

**验证命令与期望输出**

```bash
node --test tests/contract/board-status-semantics.test.js
# 期望：ℹ fail 0
```

**回滚点**：`git revert` 单个提交。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | `Status` 只有一个活定义 | `README` §1 的 `Status` 行指向 `board-semantics.md` | 通过 |
| 2 | 工程轴读法不再作为活定义存在 | `docs/` 下命中只落在白名单内 | 通过 |
| 3 | 四个取值有规划轴含义 | `README` §2 给出四个取值的规划轴含义，与 `board-semantics.md` §1 一致 | 通过 |
| 4 | 交付流程写明写入口 | `workflow.md` §3.2 含「规划轴」「规划所有者」「Decision Log」「repository-rules.md」 | 通过 |
| 5 | 防漂移检查有判别力 | 五组注入各自变红后还原复跑全绿 | 通过 |
| 6 | 白名单不腐烂 | 注入不存在的路径、注入存在但不再命中的路径，两个方向都变红 | 通过 |
| 7 | 离线检查无网络 / 无凭据 | `pnpm verify`（= `typecheck` + `pnpm test` + `pnpm test:mvp0`）exit 0 | 通过：`tsc --noEmit` exit 0；contract+integration+e2e **440 / 440**；mvp0 **7 / 7** |
| 8 | 体量与发布面合规 | `rule-checks size` / `disclosure` / `git diff --check` 全部 exit 0 | 通过 |
| 9 | 真实 CI 全绿 | `gh pr checks <n> -R <owner>/<repo>`（期望：全部 pass） | 通过，重算命令见「真实 CI 与远端回读」 |
| 10 | 未写任何 `Status` 值 | 本计划不含任何看板写入调用，也没有执行过写入 | 通过（结构性） |
| 11 | 关闭声明与 §5 / `EXPECTED` 一致 | `workflow.md` §3.2 与 `README` §2 的关闭声明点名 `Item added to project`；两条 `closure` 断言把它钉住 | 通过 |
| 12 | 棘轮不再误报正确的新措辞 | 16 组探针双向求值：8 组旧读法全 HIT（含上一版漏掉的 5 组），8 组新语义 / 历史叙述全 MISS | 通过 |
| 13 | 写入口只有一处规则正文 | `README` §2 只留指针，规则正文在 `workflow.md` §3.2 | 通过 |
| 14 | 归档后棘轮不失效 | 本文件移到 `completed/` 后 6 条用例仍全绿（basename 白名单按 P2-2 的设计生效） | 通过 |

## Progress

- [x] (2026-09-22) 根因定位：两套定义并存 + 无写入口 + 16/17 实测
- [x] (2026-09-22) 人类伙伴裁决：语义归规划轴；16 次写入是人工，不需回滚（记入 issue #112）
- [x] (2026-09-22) 建隔离工作区 `.worktrees/w8-status-semantics`
- [x] (2026-09-22) Batch 1 · 文档对齐（`README` §1/§2 改写、`workflow.md` §3.2 新增）
- [x] (2026-09-22) Batch 2 · 防漂移契约测试（6 条用例全绿；五组注入各自按预期变红后还原复跑）
- [x] (2026-09-22) 第二轮独立评审：7 条 GitHub inline（P2×4、P3×3），逐条核实后全部属实
- [x] (2026-09-22) 按根因修复计数错误、棘轮误报与漏报、写入口重复；16 组探针双向复验
- [x] (2026-09-22) 归档本计划到 `docs/exec-plan/completed/` 并更新 `docs/README.md` 索引

## Surprises & Discoveries

- **(2026-09-22) 我先把「`Status` 停在 `Todo`」读成了设计，那是错的。** 我只核对了「内置 workflow 该不该写 `Status`」（该关，也确实关着），没有核对「关掉之后谁来写」。把**一个从未被写下来的机制**读成了**一个被满足的设计**。同一个形状在这个仓库里出现了两次：`Engineering` 是自动化被删、替代品没建（issue #110），`Status` 是写入口只存在于散文里（issue #112）。
- **(2026-09-22) issue #55 的验收是一条能被绕过的 grep。** 验收标准是 `grep -rn '开发做完没' docs/` 输出为空。它通过了，而 `docs/project-management/README.md` §1 至今写着同一个断言的另一种措辞（「与 PR 生命周期对齐」）。D1 的"要改三处"表也只覆盖了 `delivery-planning-and-board.md` 一处文件——**清单是按文件列的，不是按断言列的**，所以漏掉一个文件就漏掉一整套定义。
- **(2026-09-22) 字段确实在被推进，只是没人记录。** 内置工作流在 2026-09-20T07:13 与 2026-09-21T07:23 两次被核对为全部合规，之后关闭的 17 个条目里 16 个是 `Done`。人类伙伴确认是本人手动设置的——也就是说**机制一直在工作，只是从没被写下来**，所以它不可核对、也不可交接。
- **(2026-09-22) `board-semantics.md` §2 的「谁写」一格本来就是对的，不需要改。** 计划原本要把它从「人（协作者在看板上手动设置）」改成带命令入口的措辞，但人类伙伴确认 16 次写入确实是手动完成的——原措辞准确。改它只会与 PR #111（同样改这个文件）制造一处不必要的冲突。已撤回该步骤，见 Decision Log。
- **(2026-09-22) 本 PR 与 PR #111 在 `docs/README.md` 的索引表上重叠。** 两个计划都要往同一张 Active 表里加一行。这是加法冲突，第二个合并的需要一次 rebase；已记入风险。
- **(2026-09-22) 新写的正文里又出现了一次「六条 / 七条」混淆。** `workflow.md` §3.2 与 `README` §2 都写「七条会写 `Status` 的内置工作流已全部关闭」。按 §5 与 `EXPECTED` 求值：会写 `Status` 的 7 条里 `Item added to project` 是**开启**的（§2 的唯一机械例外），而标「关闭」的 7 条里 `Auto-close issue` 写的是 issue 状态、不是 `Status`。`board-semantics.md` §5 专门用一段纠正过这个混淆，本 PR 又把它的镜像写法引入两处——**同一条断言、两处副本、两处都不对**，而测试只断言关键词出现，所以它全绿。
- **(2026-09-22) 棘轮的第二版同时误报和漏报，而且误报的修法会拆掉棘轮。** pattern 2 只要求 `PR` 落在窗口里、不要求它是**被定义项**，于是 `` `In Review` 表示工程侧已交付，等规划所有者验收；PR 已合并不等于接受 `` 这句在**陈述新语义**的话会命中；失败文案又让作者把该文件加进白名单——白名单是按整文件豁免的，等于让一份写对的文档退出棘轮。漏报侧同样实在：`代表` 类算子、工程事实在前的语序、`保持同步` 这类同义替换全不命中，而本 PR 自己的新状态机正是「换一组词表达同一个断言」的现成例子。
- **(2026-09-22) 修棘轮时踩到了自己的粗粒度：否定护栏按「子句」生效，而子句只按句读切，`：` 与列表不构成边界。** 于是历史文件里「项目（v2）不是另一个待办清单……」那一句的 `不是`，把它后面整段（含第 51 行的旧定义）一起挡掉了，白名单防腐断言因此变红。修法是把**换行**也作为子句边界。教训是判定粒度必须与文档的结构单位对齐，否则护栏会误伤它本该保护的对象。
- **(2026-09-22) 计划里的测试计数也会过期。** 上一轮记的 `pnpm verify` → 385 是 rebase 到当前 base 之前的数；同一个命令现在实测 440 / 440。这正是 P3-5 那条意见的一般形式——**任何写死的观察值都会在分支前进后失效**，包括测试条数。

## Decision Log

- **Decision**：以 `docs/product/board-semantics.md` §2 为准（规划轴），改写 `docs/project-management/README.md` §1/§2。
  **Rationale**：2026-09-18 的人类伙伴裁决（D1）与 issue #55 的推导都支持规划轴读法；工程轴读法正是被推翻的那一个。
  **批准**：2026-09-22 由人类伙伴在本任务的选项中显式选择。
  **Date/Author**：2026-09-22 / agent
- **Decision**：16 次无记录的 `Done` 写入是规划所有者手动设置的，按有效规划轴写入处理，不回滚、不补批准。
  **Rationale**：人类伙伴 2026-09-22 确认。这同时定下了写入口的形态——常规写入是人手动做的。
  **Date/Author**：2026-09-22 / agent
- **Decision**：四个取值在规划轴下的含义由本计划首次写下（D2 表），依据是 `docs/review/2026-09-18-mvp-delivery-review.md:248` 的「刻意停在 `In Review` 等人签字」。
  **Rationale**：`board-semantics.md` 只定义轴、未定义取值；不补上就无法改写 `README`，而补的时候必须有仓库内依据。这是本计划唯一超出权威文档字面范围的地方，已单独标出供评审。
  **Date/Author**：2026-09-22 / agent
- **Decision**：不为 `Status` 新建自动化脚本。
  **Rationale**：常规写入由人完成；为一个人决定、低频、每次目标不同的动作建自动化，会把「谁批准」这条唯一把关点变成可绕过的默认路径——与 `board-semantics.md` §6 反对 `Item closed` 的理由相同。
  **Date/Author**：2026-09-22 / agent
- **Decision**：不修改 `docs/product/board-semantics.md`。
  **Rationale**：计划原本要改它的 §2「谁写」一格并加一段代理写入的交叉引用。但人类伙伴确认常规写入本来就是人手动完成的，原措辞「人（协作者在看板上手动设置）」准确；而 PR #111 已经在改同一个文件（新增 §2.1），再改一次会制造一处不必要的冲突。代理写入的说明改放在 `docs/development/workflow.md` §3.2 与 `docs/project-management/README.md` §2——那两处正是「谁写、什么时候写」的载体。
  **Date/Author**：2026-09-22 / agent
- **Decision**：**（待人类批准）** 把 `#10` 的 `Status` 置为 `Done`。
  **Rationale**：`#10` 是唯一漏掉的条目，但 `AGENTS.md` §7 要求批准点名目标。本计划不自行写入。
  **Date/Author**：2026-09-22 / agent
- **Decision**：关闭声明不再写条数，改为「会写 `Status` 且由工程事件触发的内置工作流已全部关闭」并**点名 `Item added to project` 例外**。
  **Rationale**：条数是第二份会漂移的副本，而且六 / 七两个数字各自对应不同的集合（会写 `Status` 的 7 条 / 被关闭的 7 条）。去掉数字、保留结构，`EXPECTED` 仍是唯一可执行来源；点名例外则让「全部关闭」这种读法无法再悄悄回来。
  **Date/Author**：2026-09-22 / agent
- **Decision**：棘轮改成按「行 + 子句」求值，并加**否定**与**历史标记**两类跳过条件。
  **Rationale**：误报会让写对的文档被加进白名单，等于削弱棘轮；`曾经` / `此前` 这类历史标记则让活文档能解释自己改过什么（`README` §2 的「为什么只给链接」一段正需要它），而不必为了过检查删掉改前状态。
  **Date/Author**：2026-09-22 / agent
- **Decision**：写入口规则只保留 `docs/development/workflow.md` §3.2 一处正文，`README` §2 只留指针。
  **Rationale**：D1 的理由是「同一个断言写在两处就会漂移」，而 D3 把写入口的完整规则写进了两处正文——与自己的理由矛盾。规则正文归交付流程文档，字段表只指向它。
  **Date/Author**：2026-09-22 / agent
- **Decision**：`README` §2 状态机的中间转移标签从「工程侧已交付，等验收」改为「规划所有者确认工程已交付」。
  **Rationale**：前者读起来仍是工程事件驱动转移，是棘轮「按断言设防」声明的现成反例；后者与同节的「推进它的是规划决定」一致，且不改变 `In Review` 的定义（工程已交付仍是进入该取值的事实前提）。
  **Date/Author**：2026-09-22 / agent

## Idempotence and Recovery

- Batch 1 / 2 都是纯文档与离线测试，可任意重跑，无副作用。
- 失败后回到已知良好状态：`git revert` 本 PR 的提交。
- 本计划**不写任何外部状态**，因此没有需要回滚的外部写入。
- 不会做的事：不 push --force（除非评审要求且已建 backup ref）；不删除 worktree；不改分支保护。

## Interfaces and Dependencies

- **不新增**：workflow、依赖、secret、分支保护设置、`Status` 写入路径。
- **依赖的既有规则**：`AGENTS.md` §7、`docs/development/repository-rules.md` §3（代理写入需点名批准 + Decision Log 留痕）。
- **依赖的既有事实**：`docs/product/board-semantics.md` §2/§5、`docs/exec-plan/active/2026-09-18-rule-semantics-and-checker-convergence.md` D1。
- **命名契约**：四个取值名 `Todo` / `In Progress` / `In Review` / `Done` 与字段 ID `PVTSSF_lAHOAY1ahM4BjzAQzhimAjM` 不变（GitHub 内置字段）。

## Outcomes & Retrospective

### 实际结果

两个批次完成。

**验证证据（本分支工作区实测，Node v26）**

```text
tsc --noEmit                                              # exit 0
node --test tests/contract tests/integration tests/e2e    # ℹ tests 440 / pass 440 / fail 0
node --test tests/mvp0                                    # ℹ tests 7 / pass 7 / fail 0
node --test tests/contract/board-status-semantics.test.js # ℹ tests 6 / pass 6 / fail 0
node scripts/workflow-check.mjs                           # no findings（已检查 8 个文件）
node scripts/rule-checks.mjs disclosure <base-sha>        # exit 0，0 条命中
git diff --check <base-sha>...HEAD                        # 无输出
```

前四条就是 `pnpm verify` 展开后的命令：本地沙箱不允许 `pnpm` 创建它自己的临时安装目录，
所以直接跑底层命令；CI 跑的是真正的 `pnpm typecheck` + `pnpm test`（见「真实 CI 与远端回读」）。

体量按 `PLANS.md` §4 只记命令与期望，不写死数字——归档会把本文件的 326 行从 `active/` 移到
`completed/`，文档桶随之上升：

```bash
node scripts/rule-checks.mjs size <base-sha>
# 期望：代码与文档两桶都在上限内，exit 0（归档前观察：代码 159 / 1000、文档 364 / 1500）
```

**注入验证**（每次做完已还原并复跑全绿）

| 注入 | 变红的用例 |
|---|---|
| `README` 的 `Status` 行改回工程轴读法 | 2 条（字段表只登记不复述、旧读法只作为历史存在） |
| 把旧读法写进白名单外的新文件 | 1 条（旧读法只作为历史存在） |
| 删掉 `workflow.md` 的 §3.2 | 1 条（交付流程写明写入口） |
| 白名单加一条不存在的路径 | 1 条（白名单不腐烂） |
| 白名单加一条存在但不再命中的路径 | 1 条（白名单不腐烂） |

**改了哪些断言**

- `docs/project-management/README.md` §1 的 `Status` 行不再定义语义，改为指向 `board-semantics.md`；§2 的状态图与规则改为规划决定驱动，四个取值各自有了规划轴含义。
- `docs/development/workflow.md` 新增 §3.2，写明合并之后由规划所有者推进 `Status`、写入由本人执行、agent 代写需要点名批准并记入 `Decision Log`。
- 新增 `tests/contract/board-status-semantics.test.js`：按**断言**而非按文件清单设防，并把「历史记录」与「活定义」用显式白名单分开，白名单自身有两个方向的防腐断言。
- （第二轮）关闭声明去掉条数、点名 `Item added to project` 例外，并由两条 `closure` 断言钉住；棘轮改为按「行 + 子句」求值并加否定 / 历史标记跳过条件；`README` §2 的写入口规则收敛成指向 `workflow.md` §3.2 的指针。

### 与计划的偏差

1. **撤回对 `docs/product/board-semantics.md` 的修改**（原计划 Batch 1 步骤 3）。人类伙伴确认常规写入本来就是人手动完成的，该文件 §2 的「谁写」一格原本就准确；而 PR #111 正在改同一个文件。理由见 Decision Log。
2. **注入验证从三组扩到五组**：原计划只列了三组，实施时补了白名单两个方向的腐烂注入——那是白名单机制唯一的失败模式，不测等于没有。

### 真实 CI 与远端回读

交付 PR：[#113](https://github.com/SingularityKChen/harness-projects/pull/113)，base `main`。

`PLANS.md` §4 要求易失状态写成「回读命令 + 期望」而不是写成值，所以这里记命令与期望，不记 check 条数与 head SHA：

```bash
# 在检出 docs/status-field-semantics 的工作树根目录运行
gh pr checks 113 -R SingularityKChen/harness-projects
# 期望：全部 pass

gh pr view 113 -R SingularityKChen/harness-projects \
  --json headRefOid,baseRefName,mergeable,mergeStateStatus,closingIssuesReferences
# 期望：baseRefName=main；mergeable=MERGEABLE；closingIssuesReferences 含 112
```

**观察记录（2026-09-22T11:37Z @ `9de24ee`）**：当时 12 项检查全部 pass。此前记的是 `2ec0884`——那是回填本节的那次提交**自己推进之前**的 head，所以任何写死 head 的记录都会立刻过期。后续 head 的结论请用上面的命令重算。

本节与评审响应里引用的 head SHA（`2ec0884`、`9de24ee`、`e0d7085` 等）是**观察当时的**历史标记，不是当前历史里的对象——本分支随后经过 rebase 与提交折叠，它们只在 GitHub 的 PR 时间线与评审意见里可追溯。这与「不把易失值写成正文事实」是同一条规则的两面：记录观察时刻是允许的，把它当成现状是不允许的。

### 评审响应（2026-09-22）

独立评审以 5 条 GitHub inline 意见提交（P2×3、P3×2，review `PRR_kwDOUekeas8AAAABOm5zHg`）。逐条核实后**全部属实**，无一条被反驳。

| # | 意见 | 核实 | 处置 |
|---|---|---|---|
| P2-1 | 棘轮漏掉被删句子的另一半 | 属实。对三条 pattern 直接求值：`` `Done` = 已合并或已验收 ``、`` \| `Done` \| 已合并或已验收 \| ``、`` `In Review` = 已提交 PR，待评审 `` 与 `──合并──▶` 全部 **MISSED** | 把 pattern 从「三个字面短语」改成「**取值名 + 定义算子 + 短窗口内的工程词**」这个结构，并补上 `Done` 一条。四条 pattern 覆盖了**上一轮**评审的全部探针串（当时记为「全部探针串」，第二轮评审指出那是高估，见下） |
| P2-2 | 白名单会在本计划归档时必然变红 | 属实。`LEGACY_ALLOWED` 写死 `active/` 路径，而断言要求路径存在；归档移到 `completed/` 后必然变红，且失败文案（「应删除」）指向错误的修法 | 白名单改为**按 basename 匹配**，归档移动目录不再让它失效；失败文案改为提示改名而非删除 |
| P2-3 | 声明「不复述定义」的行自己复述了定义 | 属实。该行同时写着 §1 定义的改写与「本表不复述定义」，而断言只要求出现链接 | 该行删到「字段 + 指针」；断言补一条：出现 §1 的判别性措辞即视为复述 |
| P3-4 | Plan of Work 未回填已撤回的步骤 | 属实。第 139 行与第 145 行仍要求在 `board-semantics.md` 加交叉引用，与第 225 行的 Decision Log 直接冲突 | 第 139 行移除该文件，第 145 行按 `PLANS.md` §4「被推翻的结论就地标注」标为已撤回并给出理由 |
| P3-5 | 验收证据绑定在已被取代的 head 上 | 属实。回填证据的那次提交自己把 head 推进了，证据没有跟着重取；实测 `size` 的文档计数与记录的也不一致 | 改为「回读命令 + 期望」，另记观察时刻与当时的 head 并注明已被取代 |

**P2-1 的根因值得单独记**：第一版把 pattern 写成三个字面短语，正是 issue #55 的失败形态下移一层——**按措辞枚举**而不是**按断言枚举**，于是被删掉的那句话里没有被枚举到的子句就成了缺口。计划自己的 `Surprises & Discoveries` 已经写过「清单是按文件列的，不是按断言列的」，而棘轮犯了同一个错的措辞版本。

### 评审响应（2026-09-22 第二轮）

第二轮独立评审以 7 条 GitHub inline 意见提交（P2×4、P3×3，review `5278452167`）。逐条核实后**全部属实**，无一条被反驳。

| # | 意见 | 核实 | 处置 |
|---|---|---|---|
| P2-1 | 「七条会写 `Status` 的内置工作流已全部关闭」与 §5 / `EXPECTED` 不符 | 属实。会写 `Status` 的 7 条里 `Item added to project` 是 `enabled: true`；标「关闭」的 7 条里 `Auto-close issue` 不写 `Status` | 三处（`workflow.md` §3.2、`README` §2、本计划）改为不含计数、点名例外的表述；测试补两条 `closure` 断言 |
| P2-2 | 棘轮误报正确的新措辞，且失败文案指向会削弱棘轮的修法 | 属实。`` `In Review` 表示工程侧已交付，等规划所有者验收；PR 已合并不等于接受 `` 会命中 | 改为按「行 + 子句」求值，加否定护栏，并把句读排除出定义窗口 |
| P2-3 | 同一错误断言的第二份副本 | 属实。与 P2-1 同源：`workflow.md` §3.2 与 `README` §2 各写一份，两处措辞已不同 | 与 P2-1 一并修正；`README` §2 的写入口规则同时收敛成指针（见 P3-3） |
| P2-4 | 计划正文沿用同一计数 | 属实。第 49 行把「9 条全部符合裁决表」读成「七条会写 `Status` 的都关着」 | 改为「六条会写 `Status` 且由工程事件触发的都关着」，并点出第七条写的是 issue 状态 |
| P3-1 | 残余漏报：声明「按断言而不按措辞」比实现强 | 属实。语序反转、`代表` 类算子、`保持同步` 同义替换全不命中；本 PR 自己的新状态机就是反例 | 新增「工程事实在前」的推进句式规则；`In Review` 的事实集补上「已提交 … 评审」；新状态机标签改为「规划所有者确认工程已交付」 |
| P3-2 | 评审响应表声称「覆盖评审的全部探针串」 | 属实。只覆盖了上一轮的探针 | 本节如实分列两轮，并把已知边界写进遗留问题 |
| P3-3 | 写入口规则在两个活文档里各写一份 | 属实。与 D1 的理由自相矛盾 | `README` §2 只留指针，规则正文归 `workflow.md` §3.2 |

**判别力复验（16 组探针，双向求值）**

```text
HIT   被删掉的原句 / 表格写法 / 旧状态机
HIT   语序反转（上一版漏）/ 同义替换「保持同步」（上一版漏）
HIT   算子「代表」两例（上一版漏）/ 不写 PR 字面（上一版漏）
MISS  两组「新语义 + 否定」（上一版误报）
MISS  新语义 Done + 否定 / 新语义取值表 / 新写的规则句 / 新状态机
MISS  产品的 PR 生命周期（非看板字段）/ README 的历史叙述
```

**这一轮的根因与上一轮同形**：上一轮是「按措辞枚举」漏掉子句；这一轮是「按共现枚举」既漏语序、又误伤正确措辞；而计数错误则是 D1 要消灭的「同一断言两处副本」在本次改动里复发。两次都指向同一件事——**棘轮与正文必须共用同一个可执行事实源**（这里是 §5 与 `EXPECTED`），否则新写的正文自己就会成为下一个漂移点。

### 遗留问题与技术债务

1. **`#10` 的 `Status` 仍未置 `Done`，需要一条点名 `#10` 的人类批准。** `AGENTS.md` §7 要求批准具体指向目标并记入 `Decision Log`；本计划刻意不自行写入。这是 issue #112 唯一未闭环的验收项。
2. **（已解决）本 PR 与 PR #111 在 `docs/README.md` 的 Active 索引表上重叠。** PR #111 已合并（其分支已从远端删除），本分支 rebase 到 `main@2bdf6f2e` 后两行并存，原先预测的加法冲突已不存在。
3. **白名单是人工维护的豁免清单。** 它按 basename 匹配（归档移动目录不失效），并有两个方向的防腐断言（必须有对应文件、必须真的命中旧读法）；但新增历史文件时仍需要人把它加进去，否则会误报。这是棘轮机制的固有代价，比"新文件静默通过"要好。
4. **`docs/exec-plan/completed/2026-09-17-repo-collaboration-setup.md` 仍带着工程轴读法。** 它是历史记录，按本计划的判定被白名单豁免；但读者若只读那一份会得到错误结论。是否给它加一条"已被 issue #55 推翻"的页内注记，留给该文件自己的批次。
5. **棘轮有明确不覆盖的边界（第二轮评审后记入）。** 判定是「取值名 + 定义算子 + 短窗口内的工程事实」，加否定与历史标记两类跳过条件。因此以下三类**不会**命中，属刻意取舍而非疏漏：(a) 不用 `PR` 字面、也不含「待评审」的旧读法（例如只写「等代码评审」）；(b) 语义等价但完全换用另一组词的表述；(c) 与否定词同处一行、从而被整行跳过的旧读法。棘轮的作用是抬高回归成本，不是证明语义等价——后者不可判定。真要让「旧读法不能活回来」更强，方向是让 §5 的裁决表本身可执行（`EXPECTED` 已是），而不是继续加 pattern。

## Bottom Change Note

- (2026-09-22) 创建本计划。依据：issue #112 的根因定位、两套活定义的对照、内置工作流两次合规核对与 16/17 实测、人类伙伴对语义与写入口的两项裁决。
- (2026-09-22) Batch 1 / 2 完成后回填 Progress、Surprises（`board-semantics.md` 不需要改、与 PR #111 的索引重叠）与 Decision Log。
- (2026-09-22) 回填 Outcomes：验证证据、五组注入、两处与计划的偏差与四条遗留问题。
- (2026-09-22) 第二轮评审后按根因修复：计数错误（三处）、棘轮误报与漏报（改为按行 + 子句求值）、写入口重复（收敛为单一正文）；补 16 组双向探针与两条 `closure` 断言，回填 Surprises / Decision Log / 遗留问题。
- (2026-09-22) 归档本计划到 `docs/exec-plan/completed/`，并在 `docs/README.md` 的索引表里从 Active 移到 Completed。归档本身是对 P2-2（白名单按 basename 匹配）那次修复的第一次实战验证。
