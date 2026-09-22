# Gate E1 · 多项目成员关系与 Draft 转换 ExecPlan

> 状态：Completed
> 创建：2026-09-21
> 范围：在 E1-1 建立的沙箱上，观测两个"对象没变而外部身份变了"的身份场景——同一个 issue 同时出现在两个 project、以及 draft 被转换成真实 issue——并记录平台实际返回的 id 变化。
> 上游输入：issue #23（本批次）、issue #4（父门禁，六条行为中的第 1、3 条）、issue #22（沙箱与记录模板的来源）、`docs/architecture/README.md`（外部身份注册表与工作区级投影）、`AGENTS.md` §1.1 第 6 条

## Purpose / Big Picture

完成后，下面这句话有真实平台观测支撑：

> 一个底层对象改变成员关系（进入第二个 project）时，**内容身份不变**，新增的只是一条成员关系；改变自身形态（draft → issue）时，**成员关系身份不变**（id 与 `createdAt` 逐字节相同），变的是外部内容 id（`DI_*` → `I_*`），旧的外部身份被降级为历史别名而不是被删除重建。两种场景下内部 `Entity`（工作项）都不变——它是唯一跨场景恒定的那一层。

判断成功的最小证据：

1. `docs/architecture/gate-e1-membership-and-draft.md` 的两条实验按 E1-1 固定的九字段模板填写完整；
2. 实验 1 给出同一个内容 id 对应**两个** `ProjectV2Item.id`，且两个工作区可以各自持有不同的规划字段值而互不覆盖；
3. 实验 2 给出 draft 转换前后的 `ProjectV2Item.id` 与内容 id 的**实际值**（相等或不等都记录），并据此判定"内部工作项 id 不变"是否成立；
4. 转换前的 draft 身份被记录为历史别名，转换后的身份为主。

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 多项目成员关系 | 同一个底层 issue 被加进两个 project，于是平台上有两条 `ProjectV2Item` |
| 工作区级投影 | 本地模型刻意**不**做跨工作区的工作项聚合；每个工作区各看各的投影（issue #23 Scope 明确保留这一选择） |
| Draft 转换 | 把 project 里的 draft issue 提升为真实 issue（GraphQL `convertProjectV2DraftIssueItemToIssue`） |
| 历史别名 | 外部身份注册表里被标记为"曾经是"的 id；它不再产生新的内容身份，但保留可追溯性 |

### 当前事实

- 沙箱定义与九字段记录模板由本栈底层交付：`docs/architecture/gate-e1-sandbox.md`；三类内容夹具的观测记录在 `docs/architecture/gate-e1-content-identities.md`。
- 本批次的夹具**另建**，不与 E1-1 的三个内容夹具重叠：一个共享 issue（加入两个 project）与一个待转换 draft（在 Project A 中创建）。Superseded by `Surprises & Discoveries` 第 1 条与 `Plan of Work` 的夹具条（2026-09-21）：两个夹具已由 E1-1 随沙箱一并创建，本批次只做只读确认，未新建对象。
- 本仓库**没有**任何代码实现工作区级投影或外部身份注册表；本批次的产出是"本地应有行"的映射记录，不是实现。

### 栈内位置

本批次是四层栈的第二层，base 是 `test/e1-content-identities`。E1-1 交付沙箱与模板，本批次复用它们；E1-3 复用同一沙箱但使用它自己的可写夹具；E1-4 读全部记录并裁决。

### 上游依据

- issue #23 的六条验收条件（本计划 `Validation and Acceptance` 逐条对应）。
- issue #4 的第 1 条（同一外部对象在两个工作区 → 一条外部身份、两条成员关系、每个工作区一条投影）与第 3 条（draft 转换后内部工作项身份不变，旧外部身份降级为历史别名）。
- issue #23 Scope 的 out-of-scope：不做跨工作区全局工作项聚合；本批次验证的是"工作区级投影"这个选择本身。

## Design / Spec

### D1 两个工作区用两个 project 表达，不用两个账号

"两个工作区"在本门禁里落地为同一个账号下的两个 Project v2。理由是 issue #23 要求"通过一个 connector account 同步两者"——两个账号会把变量从"工作区边界"变成"账号边界"，从而测不到想测的东西。

### D2 规划字段的隔离必须被观测，不能被推断

验收条件要求"两个工作区可以持有不同的规划字段值而不互相覆盖"。这条不能靠"project 是独立的所以肯定不覆盖"来推断：字段值挂在 `ProjectV2Item` 上而不是内容上，正是本批次要证实的命题。实验里对同一个 issue 的两条成员关系写入**不同的** Status 值，再把两个 project 各自读回。

### D3 转换前后的 id 变化必须逐项记录，包括"没变"

Draft 转换可能改变成员关系 id、内容 id，或两者都不变。三种结果都合法，但必须区分：如果成员关系 id 变了而内容 id 没变，模型只需更新成员关系身份；如果内容 id 也变了，就必须靠历史别名把它接回同一个工作项。**先记录，再判定**，不允许先写结论再找证据。

### D4 判定"内部工作项 id 不变"的操作定义

内部工作项 id 由本地模型生成，与外部 id 无关。因此验收条件"转换后内部工作项 id 逐字节相同"的可判定形式是：

> 转换前后两条观测解析到**同一个 Entity**（内部工作项），因此解析出的内部工作项 id 相同；判定证据是"转换后的新内容身份与转换前的历史身份共同指向同一个 Entity，而不是新建一个 Entity"。

这条定义写进记录，使 E1-4 可以逐字引用它做裁决。

### D5 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 用两个账号模拟两个工作区 | 把"工作区边界"换成"账号边界"，测不到连接器账号内的工作区隔离 |
| 只读回一个 project 的字段值 | 无法区分"字段值挂在成员关系上"与"字段值挂在内容上"这两种模型 |
| 断言转换后 id 一定不变 | 结论先于观测；平台的真实行为必须决定结论 |
| 把 draft 转换做成对真实项目的操作 | 转换是不可逆的形态变更，只能发生在一次性沙箱里 |

## Global Constraints

- 本批次只改文档，改动集合共四个文件加一次归档改名，此处是唯一声明处：`docs/exec-plan/active/2026-09-21-gate-e1-membership-and-draft.md` → `docs/exec-plan/completed/2026-09-21-gate-e1-membership-and-draft.md`（归档改名）、`docs/architecture/gate-e1-membership-and-draft.md`、`docs/architecture/README.md` 与 `docs/README.md`（两个索引各加一行登记；归档时把本计划在 `docs/README.md` 的行移到 Completed 组）。实际集合以 `git diff --name-only test/e1-content-identities...HEAD` 回读为准（执行上下文见 Batch 1 的「验证」）。原计划「后两个索引文件按人类伙伴指令**延后到栈级联步骤统一更新**，本批次不修改」Superseded by 本节的文件集合声明（2026-09-21）：两个索引已在本批次内各加一行登记（回读 `git diff --name-only test/e1-content-identities...HEAD` 可见），"本批次不修改这两个文件"不成立。
- 不新增 `packages/` 或 `tests/` 下的代码；不改 E1-1 交付的 `gate-e1-sandbox.md` 与 `gate-e1-content-identities.md`（本批次只读它们）。
- 夹具只建在 E1-1 定义的沙箱里；不得在 `SingularityKChen/harness-projects` 或其 Projects 看板上创建夹具。
- 记录中不得出现凭据、token、本机绝对路径、本机用户名或 hostname。
- 文档改动 ≤ 1500 行（按 `node scripts/rule-checks.mjs size <base>` 度量，base 为 `test/e1-content-identities`）。
- 只允许 rebase merge；不自行合并 PR。

## Plan of Work

### Batch 1 · 多项目成员关系与 Draft 转换（本批次，issue #23）

**最小闭环**：两条身份场景各有观测记录与判定，且判定覆盖 issue #23 的六条验收条件。
**涉及文件**：`docs/architecture/gate-e1-membership-and-draft.md`（观测记录，主文件）、`docs/exec-plan/completed/2026-09-21-gate-e1-membership-and-draft.md`（本计划，完成后归档）。本批次改动集合见 `Global Constraints`。

- [x] (2026-09-21) 夹具：本批次的两个夹具由 E1-1 随沙箱一并建立（沙箱定义 §2.3 已把它们的所有权标为 E1-2），本批次只读确认三条成员关系，未新建对象
- [x] (2026-09-21) 实验 1：同一个内容 id 对应两条 `ProjectV2Item.id`；两个 project 的字段值分别读回
- [x] (2026-09-21) 实验 1 写入：对两条成员关系写入**不同**的 Status 值，再分别读回，断言互不覆盖
- [x] (2026-09-21) 实验 2：记录转换前 draft 的 `ProjectV2Item.id` 与内容 id
- [x] (2026-09-21) 实验 2：执行转换，记录转换后的 `ProjectV2Item.id` 与内容 id，逐项标出"变了/没变"
- [x] (2026-09-21) 实验 2：按 D4 的操作定义给出"内部工作项 id 不变"的判定与历史别名登记方式
- [x] (2026-09-21) 两条实验按九字段模板填写，含"复现"字段
- [x] (2026-09-21) 索引更新：`docs/architecture/README.md` 主题索引与 `docs/README.md` ExecPlan 索引各加一行登记。原计划「**延后到栈级联步骤统一更新**，本批次不修改这两个文件」Superseded by `Global Constraints`（2026-09-21）：登记已在本批次内完成。

**验证**（在检出本批次分支 `test/e1-membership-and-draft` 的工作区根目录运行。这些命令依赖该工作区下的 `scripts/` 与本地分支引用，换目录会得到不同结果）：

```bash
grep -c '^### 实验 ' docs/architecture/gate-e1-membership-and-draft.md   # 期望：2
grep -n '历史别名' docs/architecture/gate-e1-membership-and-draft.md     # 期望：≥ 1 行，且给出登记方式（不固定行号）
node scripts/rule-checks.mjs disclosure origin/main                       # 期望：exit 0
node scripts/rule-checks.mjs size test/e1-content-identities              # 期望：文档 ≤ 1500，exit 0；行数以该命令的输出为准
git diff --check test/e1-content-identities...HEAD                        # 期望：无输出
git diff --name-only test/e1-content-identities...HEAD                    # 期望：恰好 Global Constraints 声明的四个文件
```

本批次的 head、base 与 `size` 行数都是易失状态，不写成正文值，按下面的回读命令取（`-R` 指向公开仓库）：

```bash
gh pr view 106 --json baseRefName,headRefOid,state -R SingularityKChen/harness-projects   # 期望：baseRefName = test/e1-content-identities，headRefOid 为本分支最新提交
```

**验证实测输出**（**历史快照，不是当前值**；观测时刻 2026-09-21，当时 head 为 `2ec8a354`、base 为 `test/e1-content-identities` @ `e1733ddbd21f`。块内每个 SHA、行号与计数都只对该时刻成立，不得当作当前值引用；复现这些命令的 cwd 与重算命令相同——都在检出本批次分支的工作区根目录，重算命令见上一节）：

```text
$ grep -c '^### 实验 ' docs/architecture/gate-e1-membership-and-draft.md
2

$ grep -n '历史别名' docs/architecture/gate-e1-membership-and-draft.md
11:> …旧的外部身份被降级为历史别名而不是被删除重建。
250:**1 · 实验编号与目的**：实验 2。…并据此给出"内部工作项 id 不变"的可判定形式与历史别名的登记方式…
370:| `ExternalIdentity`（外部身份注册表） | `(bindingId, draft, DI_lAHOAY1ahM4BkJ9rzgLKQZ0)` | … | 旧 draft 身份降级为历史别名 |
379:**"内部工作项 id 不变"的判定**（按 ExecPlan 的 D4 操作定义）：…判定证据是"转换后新内容 id 被登记为历史别名的后继，而不是新建一条内容身份"。…
388:**历史别名的登记方式**：…本实验给出的登记方式：
398:| **平台可达性** | **旧 `DI_*` id 在平台上已不可解析**（`NOT_FOUND`）。别名因此只是**本地**的追溯记录：…
（共 12 行命中；第 388 行起给出登记方式表：登记对象 / entityId / ExternalIdentityId / role / 与主身份的关系 / 幂等性 / 平台可达性）

$ node scripts/rule-checks.mjs disclosure origin/main
基线：origin/main @ eba9c7412e8f（扫描范围 origin/main...HEAD）
机械扫描通过，覆盖范围：对 base 的新增行、范围内每个提交单独引入的新增行、
每个提交信息、PR 描述（经 PR_BODY 传入时）——以上均未命中任何已知模式。
exit=0

$ node scripts/rule-checks.mjs size test/e1-content-identities
基线：test/e1-content-identities @ e1733ddbd21f（判定范围 test/e1-content-identities...HEAD）
代码：0 / 1000 行（增删之和）
文档：731 / 1500 行（增删之和）；最多的两个文件：gate-e1-membership-and-draft.md 471 行、本计划 260 行
栈累计（相对 origin/main，仅记录，不计入本 PR 判定）：代码 0 行、文档 1780 行
exit=0

$ git diff --check test/e1-content-identities...HEAD
（无输出，exit 0）
```

上块是执行期间的原始输出，按 `PLANS.md` §4 的"易失状态"规则保留为快照：其中的 base SHA、head、行数与命中条数都已过期（base 已前进、记录文件在本批次后续提交中被改写，`size` 与 `disclosure` 的输出格式也已变化），不得当作当前值引用；块内 `栈累计` 一行由本批次后续提交改写为 `1780`，与其余行不同源。判定本批次是否合规只看上一节的命令与期望。

人工五类目核对（`docs/development/publication.md`）：凭据、本机路径与身份、账号与个人信息、内部系统、保密字样——记录与提交信息只出现沙箱对象 id、公开账号名 `SingularityKChen` 与 `e1-sandbox`（沙箱定义 §7 明确这两者可以写），无命中。

**回滚**：`git revert` 本批次提交；栈回到"只有三类内容身份证据"的上一版。沙箱里的转换不可逆，但沙箱是一次性的。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 一条外部身份、两条成员关系、每个工作区一条投影 | 实验 1：同一内容 id 对应两条 `ProjectV2Item.id`，记录里给出"本地应有行"的计数 | 通过：内容身份 1 条、成员关系 2 条、`IdentityProjection` 2 条、`WorkspaceProjection` 2 条、工作项 1 个；内容侧 `projectItems.totalCount = 2` |
| 2 | 两个工作区可以持有不同的规划字段值 | 实验 1 的写入与读回：两个 project 的 Status 值不同且各自读回正确 | 通过：A 写 In Progress（`47fc9ee4`）、B 写 Done（`98236657`），按 item id 与按 project 两条读回路径都返回各自的值；另有一次未复现的读回不一致，按残余风险登记 |
| 3 | 转换后内部工作项 id 不变 | 实验 2 按 D4 的操作定义给出判定，并给出历史别名登记方式 | 通过（按 D4 操作定义）：转换前后解析到同一条内容身份 `E_convert`，新内容 id 登记为 primary、旧 draft 身份降为 historical。**字面形式（byte-identical）因本仓库无实现不可测**，列进记录文件 §5 的开放项 |
| 4 | 旧 draft 身份登记为历史别名、新身份为主 | 实验 2 的"本地应有行"明确两条外部身份记录及其主/别名状态 | 通过：`(bindingId, draft, DI_lAHOAY1ahM4BkJ9rzgLKQZ0)` 为 `historical` 且保留原 id，`(bindingId, issue, I_kwDOUjWAl88AAAABSUC8og)` 为 `primary` |
| 5 | 成员关系 id 变化只更新成员关系身份 | 实验 2 逐项列出转换前后的 id 变化；若成员关系 id 变化，记录"工作项未被删除重建"的依据 | **未触发（前件为假）→ 空真，未被验证**：成员关系 id 与 `createdAt` **没变**（`PVTI_lAHOAY1ahM4BkJ9rzg75lAw` / 2026-09-21T06:59:28Z），内容 id 与 `type` 变了，因此"成员关系 id 变化时只更新成员关系身份"这一行为没有平台证据；列进记录文件 §5 的开放项 |
| 6 | 九字段模板逐字复用 | 两条实验记录的字段名与 E1-1 模板一致 | 通过：两条实验各九个字段，字段名取自 `docs/architecture/gate-e1-sandbox.md` §6，顺序与编号一致 |
| 7 | 记录不含凭据与本机信息 | `disclosure` exit 0，且人工五类目核对无命中 | 通过：`disclosure origin/main` exit 0；人工五类目核对无命中 |

## Progress

- [x] (2026-09-21) 建立本批次夹具（共享 issue、待转换 draft）——实测两个夹具已由 E1-1 随沙箱建立（沙箱定义 §2.3 把所有权标为 E1-2，创建时间落在沙箱建立窗口内），本批次只读确认，未新建对象
- [x] (2026-09-21) 实验 1 · 多项目成员关系与字段隔离（判定 pass）
- [x] (2026-09-21) 实验 2 · Draft 转换前后的身份变化（判定 pass；转换已执行且不可逆）
- [x] (2026-09-21) 发布面自查：`disclosure origin/main` exit 0，人工五类目核对无命中
- [x] (2026-09-21) 索引登记完成：两个索引各加一行。原计划「延后到栈级联步骤统一更新，本批次不修改这两个文件」Superseded by `Global Constraints`（2026-09-21）；改动集合见 `Global Constraints`
- [x] (2026-09-21) 验证命令全部通过（实测输出见 Batch 1 的"验证实测输出"，该块是历史快照，重算命令见 Batch 1 的"验证"）
- [x] (2026-09-22) 按 PR #106 的 inline 评审修正：判定句按场景拆分（P2）、AC3/AC5 的验收状态改为"按 D4 定义通过 / 空真未触发"（P2）、证据提交引用改为可回读的形式（P2）、验证命令去掉本机 worktree 路径（P3）
- [x] (2026-09-22) 归档：本计划由 `docs/exec-plan/active/` 移到 `docs/exec-plan/completed/`，`docs/README.md` 的对应行移入 Completed 组并标为 `Completed`；`docs/architecture/README.md` 的主题索引指向记录文件，无需改动

## Surprises & Discoveries

1. **夹具不需要建，已经在了。** Plan of Work 的第一条写的是"建夹具"，实测两个夹具（`issue-shared` 与 `draft-convert`）已由 E1-1 随沙箱一并创建：沙箱定义 §2.3 的夹具表把它们的所有权标为 E1-2，成员关系 `createdAt` 分别是 2026-09-21T06:59:14Z / 06:59:18Z / 06:59:28Z，落在沙箱建立窗口 06:57Z–06:59Z 内。本批次因此只做只读确认，没有执行任何创建命令——这条偏差是"少做了计划里的一步"，不是"跳过了验证"。

2. **实验 1 首轮出现一次读回不一致，后续 8 轮没能复现。** 时间戳与原文见记录文件实验 1 第 6 项：07:10:37Z 写 A = In Progress、07:10:42Z 写 B = Done、07:10:44Z 读回时 A 却是 Done，且 A 的 `updatedAt` 被推到读回时刻（与 B 相同）。后续 8 轮包含 8 次先置回 Todo 的重置写入，以及 15 次改变值的写入；合计 23 次字段写入，读回全部显示严格互不覆盖。同沙箱的沙箱定义 §4.2 已经实测过 project 条目连接的读后写延迟（`item-add` 成功后紧随的 `items` 查询少一条，约 3 秒后补齐），首轮不一致发生在写入后 2 秒，属于同一类读路径延迟的候选解释；但本批次没有复现，因此记录只登记事实与时间戳，不写机制，并按"未复现的单次观测"处理。

3. **成员关系 id 在 draft 转换中保持不变。** `ProjectV2Item.id`（`PVTI_lAHOAY1ahM4BkJ9rzg75lAw`）与成员关系 `createdAt`（2026-09-21T06:59:28Z）转换前后逐字节相同，只有 `updatedAt` 与 `type` 变（`DRAFT_ISSUE` → `ISSUE`）。计划里"成员关系 id 变了"与"没变"两条分支，实测落在后者。

4. **内容 id 变了，而且旧 id 立即失效。** 转换后 `DI_lAHOAY1ahM4BkJ9rzgLKQZ0` 立刻返回 `NOT_FOUND`，平台上没有"旧 id 仍可解析"的过渡窗口。这条直接决定历史别名只能在转换被观测到的同一轮 reconcile 里写入。

5. **两个 project 的 Status 字段 id 不同，可选值 id 却相同。** A 的字段是 `PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY`、B 的是 `PVTSSF_lAHOAY1ahM4BkJ9szhi7jXQ`，但两边都有 `f75ad846` / `47fc9ee4` / `98236657`。字段值的定位键因此必须带 project 作用域的字段 id，`(optionId)` 单独不够。是否为 GitHub 内置默认选项的固定 id 未做对照实验，不作断言。

6. **写请求的响应不回显字段值。** `updateProjectV2ItemFieldValue` 的 payload 只回 `id` 与 `updatedAt`，所以"写入成功"不等于"值已生效"，必须显式读回。这是 `AGENTS.md` 实现级硬约束"外部写入得到 Provider ack / reconcile 前本地不得显示权威 `Saved`"的一个平台实例。

7. **冻结的领域模型里没有成员关系的位置。** `packages/domain/src/identity.ts` 的 `ExternalIdentityKind` 只有 `draft` / `issue` / `change_request` / `branch` / `worktree`，`ProjectV2Item` 的 id 无法登记成 `ExternalIdentity`。本批次把"两条成员关系"记为独立于内容身份的成员关系定位行，并把落点问题交给 E1-4。

8. **转换让沙箱定义 §4.1 的一行判据过期。** 该判据把 `draft-convert` 写成 `DRAFT_ISSUE … DraftIssue DI_…`；转换后它是 `ISSUE`、内容 id 是 `I_kwDOUjWAl88AAAABSUC8og`。条目数仍是 7、三种 `type` 仍齐全（`DRAFT_ISSUE` 由 draft-beta 提供），但那一行的期望值不再成立。Global Constraints 禁止修改 `docs/architecture/gate-e1-sandbox.md`，因此只记录、不改动。

9. **新 issue 的编号是 6 而不是 5。** 沙箱里 change request `PR_kwDOUjWAl88AAAABEYNntg` 已占用编号 5，issue 与 change request 共用同一套编号（转换前 `issues.totalCount = 4`，转换后 5）。本地模型若按"issue 编号 = 下一个整数"推导会错。

10. **级联步骤重写了下层提交，但没有改变本批次补丁。** 开工时 `test/e1-content-identities` 在 `94e6428`，执行期间 E1-1 级联到 `e1733dd`；随后本分支也被级联步骤重写。head 与 base 是易失状态，本文不写具体 SHA，按回读命令取（见 Batch 1 的「验证」）。补丁是否被重写按规则判定，不按提交条数：在 PR 分支的工作区根目录运行 `git log --cherry-pick --right-only test/e1-content-identities...HEAD`（期望：非空，且只出现本批次的提交标题，不出现 base 分支的提交），说明 patch-id 未变。最终验证统一以当前 base 与 head 重跑，不沿用级联前的数字。

## Decision Log

- **Decision**：用同一个账号下的两个 Project v2 表达两个工作区。
  **Rationale**：issue #23 要求两者经同一个 connector account 同步；换账号会把被测变量从工作区边界换成账号边界。
  **Date/Author**：2026-09-21 / agent

- **Decision**："内部工作项 id 不变"按 D4 的操作定义判定，而不是按外部 id 相等判定。
  **Rationale**：内部 id 由本地模型生成，与外部 id 没有数值关系；可判定的形式是"转换前后的观测解析到同一个 Entity"。不给出操作定义，这条验收条件只能靠解释通过。
  **Date/Author**：2026-09-21 / agent

- **Decision**：实验 1 的判定取可复现证据（后续 8 轮、23 次字段写入—读回 + 两条独立读回路径），首轮那次读回不一致按"未复现的单次观测"登记，不写机制、也不据此判 fail。
  **Rationale**：把一次无法复现的观测当成结论会污染 E1-4 的裁决；把它当不存在则丢掉了唯一一次异常信号。同沙箱已有读后写延迟的实测记录，因此它更可能是读路径现象而不是写入隔离失效——但这是候选解释，不是结论。
  **Date/Author**：2026-09-21 / agent

- **Decision**：沙箱对象的引用方式沿用沙箱定义 §2.1 的 `$E1_*` 变量；本批次夹具（`issue-shared` / `draft-convert`）与 Project B 的 Status 字段在记录文件里各定义一次变量，因为沙箱定义没有为它们定义。
  **Rationale**：沙箱定义 §2.1 声明自己是所列变量的唯一赋值处，记录文件"只引用"。不重复写值能让 id 字面量只出现在观测原文与变量赋值两处，避免同一 id 在文档里漂移；而沙箱定义没有覆盖 E1-2 的夹具，本批次只能在记录文件里补上，并把这件事写清楚。
  **Date/Author**：2026-09-21 / agent

- **Decision**：不修改 `docs/architecture/gate-e1-sandbox.md` 与 `docs/architecture/gate-e1-content-identities.md`，即使 draft 转换让前者的 §4.1 判据过期。
  **Rationale**：Global Constraints 明确禁止改 E1-1 交付的两个文件（本批次只读它们）。跨批次影响写进记录文件与本文的 Surprises，由 E1-4 或栈级联步骤决定如何更新。
  **Date/Author**：2026-09-21 / agent

- **Decision**：如实记录级联步骤对历史的重写，不把它表述为“本批次没有 rebase”。
  **Rationale**：开工时 `test/e1-content-identities` 在 `94e6428`，执行期间级联到 `e1733dd`；本分支随后被级联步骤重写。head 与 base 是易失状态，这里不写具体 SHA，按回读命令取（见 Batch 1 的「验证」）。补丁是否被重写按规则判定，不按提交条数：在 PR 分支的工作区根目录运行 `git log --cherry-pick --right-only test/e1-content-identities...HEAD`（期望：非空，且只出现本批次的提交标题，不出现 base 分支的提交），说明 patch-id 未变。最终证据必须以当前 base 与 head 实测，不能沿用级联前数字。
  **Date/Author**：2026-09-21 / agent

- **Decision**：索引更新延后到栈级联步骤。
  **Rationale**：`docs/architecture/README.md` 的主题索引与 `docs/README.md` 的 ExecPlan 索引由栈级联统一维护；本批次逐层改索引会在每次级联时反复冲突。本批次因此在 Progress 里留一条未勾选项记录这次延后，而不是静默跳过。
  **Superseded by `Global Constraints`（2026-09-21）**：本批次最终在后续提交内完成了两个索引的登记，延后决定未被执行；改动集合见 `Global Constraints`。
  **Date/Author**：2026-09-21 / agent（人类伙伴指令）

## Idempotence and Recovery

- 实验 1 的读与写可重复；重复写入会覆盖同一个字段值，不产生新对象。
- 实验 2 的转换**不可逆**：重跑需要按沙箱定义重建沙箱并重建夹具。记录里写明这一点。
- 验证命令只读且可重复；回滚单位是单个提交。

## Interfaces and Dependencies

- **上游**：`docs/architecture/gate-e1-sandbox.md`（沙箱定义与九字段模板，E1-1 交付）、`docs/architecture/gate-e1-content-identities.md`（三类内容身份证据）。
- **外部工具**：`gh` 与 GitHub GraphQL API。
- **后续工作项**：E1-4（#25）读取本记录裁决 #4 的第 1、3 条行为。

## Outcomes & Retrospective

**两条实验的实际判定**：实验 1 = pass，实验 2 = pass；`Validation and Acceptance` 七条中六条通过，第 5 条为**空真**（前件"成员关系 id 变化"为假，该行为未被触发，见该表）。最终 head 复核时，实验 1 的可复现计数统一为后续 8 轮 23 次字段写入—读回。

**转换前后 id 变化的实际形态**（这是本批次最想要的那句话）：

- 没变：成员关系 id（`PVTI_lAHOAY1ahM4BkJ9rzg75lAw`）、成员关系 `createdAt`、内容 title、所属 project、Status 字段值与字段 id。
- 变了：内容 id（`DI_lAHOAY1ahM4BkJ9rzgLKQZ0` → `I_kwDOUjWAl88AAAABSUC8og`）、内容 `__typename`（`DraftIssue` → `Issue`）、成员关系 `type`（`DRAFT_ISSUE` → `ISSUE`）、成员关系 `updatedAt`、内容 `createdAt`，以及旧 `DI_*` id 的可解析性（可解析 → `NOT_FOUND`）。
- 新增：内容 `number` = 6。

也就是说：**平台把 draft 提升建模成"同一条成员关系换了内容"，不是"删一条建一条"**；内容身份确实变了，所以"内部工作项 id 不变"只能靠历史别名接续，不能靠外部 id 相等。这正是 issue #4 第 3 条要的行为，D4 的操作定义在本批次被实际使用并给出与"外部 id 相等"相反的结论。

**"工作区级投影"这一选择是否需要修订**：不需要。两个工作区各自读回自己写入的 Status 值（两条独立读回路径），字段值挂在成员关系上而不是内容上，因此"不做跨工作区聚合、每个工作区各看各的投影"成立。但需要补两条：一是成员关系本身在冻结的领域模型里没有落点（`ExternalIdentityKind` 不含 `ProjectV2Item`），二是写入后必须显式读回再提交投影。

**与计划的偏差**：

1. 夹具不需要建（已在沙箱里），Plan of Work 第一条因此只做了只读确认。
2. 计划假设 E1-1 的沙箱定义"级联后会出现"；实际它在执行期间出现在本地 base 分支上，本批次据此把字段名与 `$E1_*` 变量纪律对齐到真实模板，而不是按 ExecPlan 里的转述填写。
3. 索引更新一度按人类伙伴指令延后到栈级联，Progress 里留了未勾选项；该决定后来被推翻（Superseded by `Global Constraints`（2026-09-21）），两个索引已在本批次内登记。

**遗留问题**（全部转交 E1-4）：成员关系的落点、写后读回的权威性、历史别名不可回查、沙箱定义 §4.1 判据的更新、**issue #23 验收条件 3 的字面形式（byte-identical）无实现可测**、**验收条件 5 因前件为假而未被触发**。另外本次未覆盖成员关系被移除/归档与 `REDACTED` 条目类型。

## Bottom Change Note

- 2026-09-21：首次创建。原因：issue #23 要求复用 #22 的沙箱与模板，先写 ExecPlan 再开始观测。
- 2026-09-21：回填观测结果。原因：两条实验完成，`Progress`、`Validation and Acceptance`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` 按实测填写；同时按人类伙伴指令把索引更新标为"延后到栈级联"，并把夹具已存在、base 分支前进、沙箱定义 §4.1 判据过期三条偏差如实记录，而不是让计划停留在旧世界。该条中"把索引更新标为延后到栈级联"Superseded by `Global Constraints`（2026-09-21）：两个索引已在本批次内登记。
- 2026-09-21：按 `PLANS.md` §4 的活文档一致性规则修正本文。原因：改动集合曾在多处出现副本且互相矛盾（多处声明"本批次不修改两个索引"，而本批次后续提交改了它们）；夹具"另建"的结论被推翻却未就地标注；验证块把过期 head 与行数写成当前事实；命令缺执行上下文。
- 2026-09-22：按 PR #106 的 inline 评审（review 5274596238，评审对象 head `0507393`）修正，并把本计划归档到 `docs/exec-plan/completed/`。原因：判定句与实验 2 证据相反（P2）、AC3/AC5 被标成"通过"而字面形式不可测或前件为假（P2）、原先引用的证据提交在级联重写后已不可达（P2）、验证命令依赖本机 worktree 路径（P3）。
