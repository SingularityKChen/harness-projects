# Gate E1 · 写确认与事件可靠性 ExecPlan

> 状态：Active
> 创建：2026-09-21
> 范围：在 E1-1 建立的沙箱上，观测规划字段写入路径的**确认语义**（写回什么、能否支撑 `Saving… → Saved`、平台有没有可比对的版本字段），以及事件投递不可靠时同步仍然收敛所需的兜底；并记录一次"创建结果不确定"的恢复路径。
> 上游输入：issue #24（本批次）、issue #4（父门禁，六条行为中的第 4、5、6 条）、issue #22（沙箱与记录模板）、`AGENTS.md` §1.1 末段（外部写入得到 ack / reconcile 前不得显示权威 `Saved`）、`docs/architecture/README.md`（外部写入模型）

## Purpose / Big Picture

完成后，下面三句话有真实平台观测支撑，或者被明确记为"平台不支持，因此需要一条产品可见的降级路径"：

1. 写路径的确认可以从平台响应推导出来，且**不依赖平台并不存在的 compare-and-set 字段**；
2. 事件投递不是正确性机制：关掉事件后周期性对账仍能收敛，重复投递不改变实体与关系计数，旧观察不覆盖新观察；
3. 结果不确定的外部创建**先对账再重试**，且存在一条"没有可靠自然键"时如实上报的路径。

判断成功的最小证据：`docs/architecture/gate-e1-write-and-events.md` 的三条实验按 E1-1 的九字段模板填写完整，其中实验 3 给出"重复创建同一个内容会产生几条成员关系"的**实测计数**——这个计数决定了"结果不确定"是不是必须成为产品可见状态。

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 写确认 | 平台对一次字段写入的响应，以及写后读回的值；它是本地从 `Saving…` 走到 `Saved` 的唯一依据 |
| compare-and-set（CAS） | 平台提供的版本号或 ETag，使"只有在我看到的版本上才允许写"成为可能 |
| 对账（reconcile） | 不看事件，直接读平台当前集合与本地投影比对并收敛 |
| 结果不确定 | 创建请求已发出、响应丢失；调用方既不知道成功也不知道失败 |
| 自然键 | 能在不依赖响应的情况下重新找到"我刚才创建的那个东西"的键 |

### 当前事实

- `packages/capabilities` 已冻结 `PlanningProvider` 契约与结构化错误模型（PR #84），其中写入路径的确认语义是契约的一部分；本批次提供的是**契约所依赖的平台事实**。
- `AGENTS.md` §1.1 的实现级硬约束要求"外部写入得到 Provider ack / reconcile 前，本地不得显示权威 `Saved`"。本批次判定这条在真实平台上是否可实现。
- 仓库内没有任何对真实平台写入语义的观测记录。
- 本批次复用沙箱中既有的 `issue-writable` 成员关系作为可写夹具；未新建内容夹具，也未改动 E1-1 / E1-2 的夹具值。

### 栈内位置

本批次是四层栈的第三层，base 是 `test/e1-membership-and-draft`。它复用 E1-1 的沙箱与模板，使用自己的夹具；E1-4 读它的记录裁决 #4 的第 4、5、6 条行为。

### 上游依据

- issue #24 的七条验收条件（本计划 `Validation and Acceptance` 逐条对应）。
- issue #24 Notes："Event delivery is an accelerator here, never the correctness mechanism." 这条决定了实验 2 的判定方向——事件不可用时结论不是"无法同步"，而是"必须由对账兜底"。
- `AGENTS.md` §1.1 第 3 条与末段硬约束。

## Design / Spec

### D1 事件不可订阅本身就是一条结论

平台是否为 user-owned project 提供项目条目事件，必须**实测**而不是查文档推断：实验 2 先尝试订阅，把"能不能订到、订到的事件名是什么、需要什么主体"如实记录。订不到时，结论不是"本批次失败"，而是"正确性只能由对账提供"——这正是 issue #24 的 Notes 预先接受的方向。

### D2 确认语义按"三个可观察量"判定

`Saving… → Saved` 能否实现，取决于三个量是否存在且可用：

1. 写请求的响应里是否回显写入后的值；
2. 写后立刻读回是否已经可见（read-after-write 的一致性）；
3. 是否存在版本类字段（`updatedAt` / ETag / revision）足以支撑冲突检测。

三个量逐项记录实际值。若第 3 项不存在，契约**不得**依赖 CAS；这条要写进记录，成为 E1-4 的输入。

### D3 重复投递与乱序用"观察"表达，不用"事件"表达

在拿不到真实事件投递的情况下，验收条件里的"重复投递"与"旧观察覆盖新观察"仍可判定：把**同一次读取**得到的两份观察按不同顺序交给本地模型，看实体与关系计数是否变化、旧观察是否被拒绝。本批次记录的是"平台为这两种情况提供了什么可判别的输入"（例如观察自带的时间戳、版本号），因为本地模型必须靠这些输入做判定。

### D4 结果不确定的恢复路径必须给出可执行的判据

实验 3 实测两件事：

1. 对同一个内容重复执行"加入 project"是否产生第二条成员关系；
2. 若产生，是否存在不依赖响应的自然键可以重新找到已创建的那一条。

实测计数决定结论：计数为 2 且无自然键，则"结果不确定"必须成为**产品可见状态**，不允许静默重试；计数为 1（平台幂等），则记录幂等键是什么。

**观测结果（2026-09-21）**：计数为 1，平台幂等，幂等键是 `(project, contentId)`。因此本条预设的
"计数为 2"分支没有出现，"结果不确定"的产品可见范围被收窄到"创建 `contentId` 本身"那一步。
详见 `Outcomes & Retrospective` 与记录文件的实验 3。

### D5 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 用文档断言平台有 CAS | 契约一旦依赖不存在的字段，所有写入路径的冲突处理都建在空气上 |
| 把"事件订不到"记为实验失败 | 事件不是正确性机制（issue #24 Notes）；订不到是必须被记录的平台事实，不是缺陷 |
| 用模拟投递替代真实事件 | 模拟能验证我们的处理逻辑，不能回答"平台给不给得出可判别的输入" |
| 在真实项目上做写入实验 | 字段写入会改变真实工作项的规划值 |

### D6 第二轮评审暴露的是"跨记录契约没有强制点"（2026-09-23）

第二轮评审 7 条，逐条核对**全部属实**。按"症状 → 直接原因 → 根机制"归并成四个，主要矛盾是前两个——它们其实是同一个：

| 根机制 | 命中 | 直接原因 |
|---|---|---|
| **A 模板是形状契约，但没有强制点** | 第 5 项「本地应有行」把模板行改名成四条物理表名行 | `gate-e1-sandbox.md` §6 固定了九字段模板与「行数」口径，但**没有任何检查**；E1-1 / E1-2 恰好照做，E1-3 换了形状，没人拦 |
| **B 不变量只对第一份记录生效** | 4 个 id 字面量不在沙箱对象清单里 | `tests/contract/e1-evidence-consistency.test.js` 的 `RECORD_DOC` **硬编码为 E1-1**，于是 (i) 的不变量对 E1-2 / E1-3 只是**声明**。实测缺失数 E1-1 = 0、E1-2 = 2、E1-3 = 4 |
| **C 在结构中间插入散文** | 07:13Z 的注记插在 §4.4 表格两行之间 | 加注时只考虑"紧邻原处"，没考虑承载它的 markdown 结构：空行终止表格，最后一行渲染成字面文本 |
| **D 易失/本机信息仍被写成值** | 6 处字面 `/tmp/...`；「少 19–22 行」；两组过期行号 | `PLANS.md` §4 规则 3 立了，但只对**新增内容**生效，存量没回扫；本机路径这一类 `content-placement.md` §5 已记为"只有人工评审" |

**A 与 B 是同一个根**：§6 模板和 (i) 不变量都只是"写在一份文档里的规则"，而检查只覆盖第一份记录。**这不是美观问题**：E1-4（#25）的裁决要读三份记录，跨记录可比性直接是**判定输入的正确性**。这正是 PR #105 那一轮的 R1（"规则没有强制点"）在**记录集合**上的重演；D 则是同一轮 R2（"存量没回扫"）的重演。

**id 不变量要能表达三类合法来源**，否则把不变量扩到全部记录只会得到一堆假阳性：沙箱对象（现有）、**观测期间创建并已删除的临时对象**（E1-3 的两个 draft 探测夹具）、**构造的输入**（为取得 `NOT_FOUND` 原文而故意写错的 `I_kw…XXXX`）。沙箱定义因此新增两节把后两类显式登记，不变量按并集判定。

**评审的一条支撑前提不成立，结论方向反而更强（2026-09-23 实测）**：T3 说「E1-1 与 E1-2 的记录都照此执行（行名写作「规划字段值」）」。实测只有 E1-1 是：

| 记录 | 「本地应有行」表头 | 「规划字段值」行数 | 引用 §6 |
|---|---|---|---|
| `gate-e1-content-identities.md`（E1-1） | `\| 表 \| 键 \| 行数 \| 内容 \|` | 3 | 7 处 |
| `gate-e1-membership-and-draft.md`（E1-2） | `\| 结构（同义说法） \| 键 \| 行数 \| 内容 \|` | **0** | 1 处 |
| `gate-e1-write-and-events.md`（E1-3） | `\| 表（预期） \| 键 \| 计数 \| 为什么是这些行 \|` | 1（本轮恢复） | 1 处 |

三份记录的第 5 项有三种表头，模板行只在其中一份出现——所以「模板没有强制点」比评审说的更严重：不是 E1-3 一份偏离，是三份里只有一份照做。评审指的那一行（`gate-e1-membership-and-draft.md:190`）实测是讲 `updatedAt` 的正文，不是「规划字段值」行。

**E1-2 的记录不在本批次修，理由与出路**：它把规划状态落在 `WorkspaceProjection` 上（E1-2 的模型选择），补「规划字段值」行要先判定「该实验有几个用户可写的规划字段值」——那是模型决策，属 E1-4（#25）的裁决范围，不在 #107 里替它决定。检查侧因此写成**带日期与理由的显式豁免**（`PLANNING_ROW_EXEMPT`），删掉豁免项就会重新变红；把「靠改名绕过」变成「必须写进豁免表」。

**已知缺口，如实记录**：§2.1 声明"本文件是这些变量的唯一赋值处"，而 E1-2 与 E1-3 的记录里各自写了 `E1_*=...` 赋值。本轮**不为它加检查**——那会让已合并的 E1-2 记录失败，而修它要动本批次声明为只读的文件；改为把 §2.1 的措辞限定为它真正约束的东西，并把该缺口留在剩余清单里。

## Global Constraints

- 本批次只改文档。**本清单是本批次文件集合的唯一权威**（`PLANS.md` §4「一个事实只写一处」）；`Plan of Work`、`Progress`、`Decision Log`、`Bottom Change Note` 要提它时写"见 `Global Constraints`"，不复述、也不另立一份：
  - `docs/exec-plan/active/2026-09-21-gate-e1-write-and-events.md`（本计划）
  - `docs/architecture/gate-e1-write-and-events.md`（本批次主文件：平台观测记录）
  - `docs/architecture/README.md`、`docs/README.md`（各一行索引）
  - `docs/architecture/gate-e1-sandbox.md`（**第二轮评审新增**：id 注册表补三类来源——E1-2 与 E1-3 观测期间创建的对象、已删除的临时对象、构造的输入；§2.1 与 §7 的措辞按 D6 校准）
  - `tests/contract/e1-evidence-consistency.test.js`（**第二轮评审新增**：把 (i) 不变量的覆盖从硬编码的 E1-1 扩到记录集合，并让 id 不变量按 D6 的三类来源判定。**为什么在本批次**：D6 的 A/B 说明 §6 模板与 (i) 不变量都只是声明——强制点必须在检查里，而检查现在只覆盖一份记录）
- 文件集合按回读判定，不按上面的枚举判定。从仓库根运行：`cd .worktrees/w5-e1-3 && git diff --name-only origin/main...HEAD`（期望：只输出上面 6 个路径，无其它文件）。base 必须写 `origin/main`（本 PR 已 retarget 到 main）——换目录或换 base 都会得到不同结果。
- ~~不改 E1-1 与 E1-2 交付的记录文件（本批次只读它们）~~（2026-09-23 修正）：**E1-1 / E1-2 的「记录文件」仍只读**（`gate-e1-content-identities.md`、`gate-e1-membership-and-draft.md` 一个字节都不动）；但 `gate-e1-sandbox.md` 与 `e1-evidence-consistency.test.js` 是**共享的注册表与检查**，D6 的根机制要求它们跟着更新——这是"修在产生它的那一层"，不是扩大范围。
- 夹具使用 E1-1 定义的沙箱中既有的 `issue-writable` 成员关系；不得新建内容夹具，也不得改动 E1-1 / E1-2 的夹具值。
- 记录中不得出现凭据、token、本机绝对路径、本机用户名或 hostname；webhook secret（若创建）只以"已创建并在拆除时删除"表述，不写值。
- 文档改动 ≤ 1500 行。从仓库根运行：`cd .worktrees/w5-e1-3 && node scripts/rule-checks.mjs size test/e1-membership-and-draft`（期望：代码 0 / 1000、文档 ≤ 1500，exit 0）。体量属易失状态，本文件不写死行数。
- 只允许 rebase merge；不自行合并 PR。

## Plan of Work

### Batch 1 · 写确认、事件可用性与不确定创建（本批次，issue #24）

**最小闭环**：三条实验各有观测记录与判定，且第 3 条给出"结果不确定"是否必须产品可见的实测依据。
**涉及文件**：`docs/architecture/gate-e1-write-and-events.md`（本批次主文件）；完整文件集合见 `Global Constraints`。

- [x] 建夹具：本批次专属的可写条目加入 Project A，记录其 `ProjectV2Item.id`
- [x] 实验 1：对 Status / Iteration / Target date / 条目顺序各写一次，记录请求、响应回显、写后读回值、版本类字段
- [x] 实验 1：按 D2 的三个可观察量逐项判定，并给出"契约是否可依赖 CAS"的结论
- [x] 实验 2：尝试为沙箱仓库订阅项目条目事件与变更请求事件，记录可订到的**事件名**与所需主体；订不到就如实记录失败形态
- [x] 实验 2：按 D3 给出"重复观察"与"乱序观察"在平台侧的可判别输入（时间戳/版本），并说明对账兜底的判据
- [x] 实验 3：对同一内容重复执行加入 project，记录成员关系**实测计数**
- [x] 实验 3：给出不依赖响应的自然键是否存在，以及"结果不确定"的恢复路径
- [x] 三条实验按九字段模板填写，含"复现"字段
- [x] 更新两个索引文件（各一行；集合见 `Global Constraints`）—— 已随本批次回填提交登记
- [ ] ~~更新 `docs/architecture/README.md` 与 `docs/README.md` 索引 —— **延后到栈级联**：索引由栈级联步骤统一更新，本批次不修改这两个文件~~ **Superseded by `Global Constraints` 与 `Progress`（2026-09-22）：该步骤没有延后，两个索引文件已随本批次回填提交各加一行。**

**验证**（实际输出，2026-09-21）：下面这一块是**当时的快照**——`origin/main` 与 base 的 SHA、每个文件的体量行数都是易失状态，此后已经变化，不要当作当前值。快照的 head **未核实**：块内给本计划记的行数是 `347` / `350`，~~比它最终落地的版本少 19–22 行~~，说明这组输出不是在最终 head 上重跑的。~~要当前值就按 `Global Constraints` 里的两条回读命令重算。~~

**Superseded（2026-09-23）：`19–22` 的参照版本错了。** 它是相对**上一版**（快照产出时的那个版本）算出来的差值，不是相对本版；而写下这句话的提交自己就把本计划改长，所以在同一个提交内自相矛盾。这条差值也不该作为正文事实保留——行数属易失状态（`PLANS.md` §4 规则 3），本文件不写死。留下来的判据只有方向：块内行数明显小于本版实际行数，因此这组输出不是在最终 head 上重跑的。要当前值就在检出本批次分支 `test/e1-write-and-events` 的工作树根目录运行 `wc -l docs/exec-plan/active/2026-09-21-gate-e1-write-and-events.md`（期望：明显大于块内记录的 `347` / `350`，差 40 行以上）；体量与 base 的回读命令见 `Global Constraints`。
执行上下文：以下命令都在**检出本批次分支 `test/e1-write-and-events` 的工作树根目录**运行（从仓库根 `cd .worktrees/w5-e1-3` 进入；其它小节里内联的 `cd .worktrees/w5-e1-3` 同理）。相对路径与 `test/e1-membership-and-draft...HEAD` 都相对该目录解析——换一个目录跑同一条命令会得到不同结果。

```bash
$ grep -c '^### 实验 ' docs/architecture/gate-e1-write-and-events.md
3

$ grep -c 'CAS\|compare-and-set' docs/architecture/gate-e1-write-and-events.md
8
# 其中给出结论的行（按原句引用，不写行号）：
# **结论（CAS）**：平台在 `ProjectV2Item` 字段写入上**不存在 compare-and-set**。可用的版本类输入只有
# **契约不得依赖 compare-and-set**：冲突处理只能是"读回 → 比较 → 显式决定"，由本地策略承担覆盖语义，
# | 2 | 平台有没有 compare-and-set | **没有**。只有秒级 `updatedAt`，无 ETag / revision，mutation 无前置条件参数。**契约不得依赖 CAS** |

$ grep -c '结果不确定' docs/architecture/gate-e1-write-and-events.md
11
# 其中给出恢复路径的行（按原句引用，不写行号）：
# - **"结果不确定"仍是必须产品可见的状态，但触发条件更窄**：它只在
#   3. 找到 → 直接采纳，不发第二次写入，不进入"结果不确定"状态；
#   5. 若丢失的是**创建内容**的响应（没有 `contentId`）→ 进入**产品可见的"结果不确定"**，
# | 7 | 结果不确定是否先对账再重试 | **是，且可行**：`(project, contentId)` 幂等，实测重复加入计数为 1 |

$ node scripts/rule-checks.mjs disclosure origin/main
基线：origin/main @ eba9c7412e8f（扫描范围 origin/main...HEAD）
机械扫描通过，覆盖范围：对 base 的新增行、范围内每个提交单独引入的新增行、
每个提交信息、PR 描述（经 PR_BODY 传入时）——以上均未命中任何已知模式。
exit=0

$ node scripts/rule-checks.mjs size test/e1-membership-and-draft
基线：test/e1-membership-and-draft @ 2ec8a354f4405a25410d1c89911cff2b52df6e8（判定范围 test/e1-membership-and-draft...HEAD）
代码：0 / 1000 行（增删之和）
文档：1004 / 1500 行（增删之和）
栈累计（相对 origin/main，仅记录，不计入判定）：代码 0 行、文档 2784 行

本 PR 贡献最多的文件：
     654  docs/architecture/gate-e1-write-and-events.md
     347  docs/exec-plan/active/2026-09-21-gate-e1-write-and-events.md
exit=0

$ git diff --check test/e1-membership-and-draft...HEAD
(无输出)
exit=0
```

以上输出在记录文件与 ExecPlan 回填提交后实测。~~`size` 的 1004 行是记录文件（654）与 ExecPlan（350）
的合计。本 PR 的 base 是 `test/e1-membership-and-draft @ 2ec8a354f4405a25410d1c89911cff2b52df6e8c`；
`git diff --name-only` 只列出本批次的两个文档文件：`docs/architecture/gate-e1-write-and-events.md` 与
`docs/exec-plan/active/2026-09-21-gate-e1-write-and-events.md`。~~

**Superseded by `Global Constraints` 与本段订正（2026-09-22）：上面这一段被本分支自己的 diff 推翻，原文保留。** 订正三点：

1. **文件集合写错了。** `cd .worktrees/w5-e1-3 && git diff --name-only test/e1-membership-and-draft...HEAD` 实测输出 **4 个**路径，不是两个：上面漏掉了两个索引文件（各一行索引）。完整集合见 `Global Constraints`，不在此复述。
2. **base SHA 已不是 base。** `2ec8a354…` 是当时的 base head。回读：`cd .worktrees/w5-e1-3 && git rev-parse test/e1-membership-and-draft origin/test/e1-membership-and-draft`（本地与远端引用可能不同步，PR 的 base 取远端那个；2026-09-22T04:03Z 实测本地 `ccd44a25992d`、远端 `6597d824`）。确认旧值已不在该分支历史上：`cd .worktrees/w5-e1-3 && git merge-base --is-ancestor 2ec8a354f4405a25410d1c89911cff2b52df6e8 test/e1-membership-and-draft`（期望 exit≠0；2026-09-22T04:03Z 实测确实如此）。因此这一块快照无法用当前引用复现，只能按当前 base 重跑。
3. **行数对不上，且与同一段里的另一个数字自相矛盾。** 同块列出 `654` 与 `347`，加上两个索引文件各 1 行应为 `1003`；本段又写 ExecPlan 是 `350`，按它算应为 `1006`。`1004` 与两者都不符，因此当时真实的逐文件行数**未核实**——不在这里编一个数。行数属易失状态，本文件不写死：按 `Global Constraints` 的回读命令重算。

**回滚**：从仓库根运行 `cd .worktrees/w5-e1-3 && git revert <本批次提交的 SHA>`；栈回到"只有内容身份与成员关系证据"的上一版。沙箱上的字段写入不随仓库回滚，按沙箱定义重建即可；重复创建实测幂等，不会留下多余成员关系（探测 `contentId` 范围时创建的临时 draft 已在观测期间删除）。

### Batch 2 · 第二轮评审：记录形状、可追溯性与易失引用（2026-09-23）

**最小闭环**：7 条意见逐条落地，且 D6 的 A/B（跨记录契约没有强制点）有一个覆盖**记录集合**的能失败的检查把它关住，而不是只把这一份记录改对。

**涉及文件**：见 `Global Constraints`（本批次新增 `docs/architecture/gate-e1-sandbox.md` 与 `tests/contract/e1-evidence-consistency.test.js`）。

- [x] **A · 记录形状**（1 条）
  - `docs/architecture/gate-e1-write-and-events.md` 的第 5 项恢复模板行名「规划字段值」并在内容列引用 `gate-e1-sandbox.md` §6；四个字段的明细移到「观测」项或作为该行附注，不改模板行名
- [x] **B · 可追溯性**（1 条）
  - `docs/architecture/gate-e1-sandbox.md` 新增两节：**观测期间创建并已删除的临时对象**（E1-3 的两个 draft 探测夹具、E1-2 的转换后 issue 与 Project B 的 Status 字段）、**构造的输入（不是平台对象）**（`I_kw…XXXX` 这类为取 `NOT_FOUND` 原文而故意写错的 id）
  - `tests/contract/e1-evidence-consistency.test.js`：把记录文件的发现从硬编码改为**按记录集合发现**，(i) 不变量对 E1-1 / E1-2 / E1-3 全部生效；三类来源按并集判定
  - 同处把 §2.1 的「唯一赋值处」措辞限定为它真正约束的东西（D6 的已知缺口）
- [x] **C · 结构**（1 条）
  - `docs/architecture/gate-e1-write-and-events.md` §4.4：把 07:13Z 的注记移到表格最后一行之后，恢复表头、分隔行与五行数据的连续性
- [x] **D · 易失引用**（3 条）
  - 6 处字面 `/tmp/...` 改为 `$E1_CLONE/...`（沙箱 §2.1 已定义该变量）；Validation 第 9 项的人工核对口径写明是「家目录前缀 + hostname」，不要读起来像覆盖了 §7 的全部本机路径规则
  - [x] ExecPlan 的「少 19–22 行」改为相对当前版本的正确差值（44–47），或写明"比上一版"
  - [x] ExecPlan 里两组过期行号改为**引用原句**而不是行号（行号属易失状态，`PLANS.md` §4 规则 3）

**验证**：

```bash
# 在检出本批次分支 test/e1-write-and-events 的工作树根目录运行
node --test tests/contract/e1-evidence-consistency.test.js   # 期望：全绿，且覆盖 3 份记录
node --test tests/contract                                   # 期望：全绿
node scripts/rule-checks.mjs disclosure origin/main          # 期望：exit 0
node scripts/rule-checks.mjs size origin/main                # 期望：文档 ≤ 1500，exit 0
git diff --check origin/main...HEAD                          # 期望：无输出
grep -c '/tmp/' docs/architecture/gate-e1-write-and-events.md  # 期望：0
```

**判别性验证**：把沙箱定义里新登记的一个临时对象 id 删掉，断言 (i) 必须变红；还原后复跑全绿。

**回滚**：`git revert` 本批次提交；记录回到第二轮评审前的版本，注册表与检查回到只覆盖 E1-1 的状态（D6 的 A/B 恢复为"无强制点"，这是已知的、被记录的残余状态）。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 写路径端到端被记录 | 实验 1：请求、响应回显、写后读回值、版本类字段逐项有值 | **pass** — 四次写入各有请求、回显、读回值；`updatedAt` 逐次记录 |
| 2 | 契约不依赖平台没有的 CAS 字段 | 实验 1 的结论行明确写"存在/不存在"，并说明契约因此可以/不可以依赖它 | **pass** — 结论为"不存在 CAS"，契约不得依赖 compare-and-set |
| 3 | `Saving… → Saved` 可实现，或记录不能实现的原因 | 实验 1 按 D2 三个可观察量给出结论 | **pass** — 可实现，但 `Saved` 必须由独立读回支撑 |
| 4 | 事件关闭时对账仍收敛 | 实验 2 给出订阅实测结果与对账兜底判据；订不到时结论为"正确性由对账提供" | **pass** — `projects_v2_item` 被 `422` 拒绝，结论为"正确性由对账提供" |
| 5 | 重复投递不改变实体与关系计数 | 实验 2 给出可判别输入（时间戳/版本）与计数不变的判定方式 | **pass** — 稳定 `ProjectV2Item.id` 幂等 upsert；计数不变不依赖时间戳 |
| 6 | 旧观察不覆盖新观察 | 实验 2 给出乱序判据 | **pass** — `updatedAt` 秒级且同秒碰撞，需叠加本地接收时刻；`==` 时整快照替换 |
| 7 | 结果不确定先对账再重试 | 实验 3 给出重复创建的实测计数与恢复路径 | **pass** — 实测计数为 1，`(project, contentId)` 幂等，恢复路径五步可执行 |
| 8 | 无自然键时记为产品可见的"结果不确定" | 实验 3 明确自然键是否存在；不存在时给出产品可见状态的表述 | **pass（范围收窄）** — 自然键 `contentId` 存在；"结果不确定"只在"创建内容"那一步成立，且该分支未实测 |
| 9 | 记录不含凭据与本机信息 | `disclosure` exit 0，且人工五类目核对无命中 | **pass** — `disclosure` exit 0；人工五类目核对无命中；其中本机路径类的机械覆盖范围与人工口径见下 |

人工五类目核对（`docs/development/publication.md`）：凭据无（命令不含 token，`gh` 不打印）；
本机路径与身份：`disclosure` 的机械扫描只覆盖**家目录前缀（首段为 `Users` 或 `home`）与 hostname
（内网后缀）两类模式**，`/tmp/...` 这类字面绝对路径不在其中——所以机械扫描通过**不等于**
沙箱 §7「本机路径一律不出现」（`docs/architecture/gate-e1-sandbox.md`）整条规则通过，其余本机路径形态
只能人工逐条核对。本轮人工核对据此把记录文件里全部字面 `/tmp/...` 路径改成 `$E1_CLONE/...` 占位符
（该变量的赋值处见 `docs/architecture/gate-e1-sandbox.md`）；回读：在检出本批次分支
`test/e1-write-and-events` 的工作树根目录运行
`grep -c '/tmp/' docs/architecture/gate-e1-write-and-events.md`（期望 `0`）。
账号与个人信息仅公开账号名，且以 `$E1_OWNER` 变量引用；内部系统无；保密字样无。
webhook URL 用保留域名 `example.invalid`。

## Progress

- [x] (2026-09-21) 建立本批次可写夹具 —— 复用沙箱既有的 `issue-writable` 成员关系
      `PVTI_lAHOAY1ahM4BkJ9rzg75k-I`，未新建内容夹具
- [x] (2026-09-21) 实验 1 · 写确认与版本字段 —— 四次字段写入 + 位置写入，D2 三项判定，CAS 结论
- [x] (2026-09-21) 实验 2 · 事件可用性与对账兜底 —— 订阅实测（4 个 webhook 已创建并删除）+ 乱序判据
- [x] (2026-09-21) 实验 3 · 重复创建与"结果不确定" —— 实测计数 1，自然键 `contentId`，恢复路径
- [x] (2026-09-21) 索引更新与发布面自查 —— 发布面自查完成（`disclosure` exit 0 + 人工五类目）
- [x] **索引更新已随本批次提交**：两个索引文件各加一行（集合见 `Global Constraints`）
- [ ] ~~索引更新（`docs/architecture/README.md`、`docs/README.md`）—— **延后到栈级联**：
      索引由栈级联步骤统一更新，本批次按硬约束不修改这两个文件~~
      **Superseded by `Global Constraints` 与本节上一条（2026-09-22）：该步骤没有延后，两个索引文件已随本批次回填提交登记。**
- [x] (2026-09-21) 沙箱还原：四个字段写回/保持在观测终值，条目顺序还原为变更前，
      临时 draft 探测夹具已删除，Project A 回到 7 条，webhook 列表回到 0
- [x] (2026-09-23) 第二轮评审 D 组的易失引用订正（只改本计划）——「少 19–22 行」就地标
      `Superseded`，改成方向 + `wc -l` 回读（差值随本版增长而变，不写死）；两组过期行号删掉行号、
      改为按原句引用（`grep -c` 的期望计数保留）；Validation 第 9 项把本机路径类的口径写准
      （机械扫描只覆盖家目录前缀与 hostname 两类，字面 `/tmp/...` 类只能人工核对，本轮已改成
      `$E1_CLONE/...` 占位符）
- [x] (2026-09-23) **第二轮评审 7 条逐条核对全部属实**，按 D6 的四个根机制落地：记录形状恢复模板行、id 注册表补三类来源、表格结构修复、易失引用（/tmp 路径、错差值、过期行号）全部改为占位符或原句引用。强制点：`e1-evidence-consistency.test.js` 的记录发现从硬编码改为集合发现（(i) 对三份记录全部生效），并新增 (b0) 断言——记录缺「规划字段值」行时响亮失败（E1-2 是带日期与理由的显式豁免）。

## Surprises & Discoveries

1. **mutation 响应回显不完整。** 同一条 `updateProjectV2ItemFieldValue` 调用，`projectV2Item.fieldValues`
   在一个观测里对 `Status`、`E1 Date`、`E1 Iteration` 三个节点只返回 `__typename`、不返回值字段，
   而同一秒的另一次调用三个值都在。证据：`docs/architecture/gate-e1-write-and-events.md` 实验 1 §4.2。
   **影响**：D2 第 1 项从"可用"降级为"部分可用"；写入确认不能只解析回显里的 `fieldValues` 数组，
   必须定向读 `fieldValueByName` 或做独立读回。

2. **`ProjectV2Item.updatedAt` 不是修订计数器。** 对同一个值连写三次，`updatedAt` 停在 `07:11:00Z`
   不动；把 `Status` 从 `In Progress` 改成 `Todo` 才推进到 `07:11:54Z`。证据：实验 1 §4.3。
   **影响**：不能用"写后 `updatedAt` 变了没有"判断写入是否被接受。

3. **`updatedAt` 是秒级且同秒碰撞可复现。** 连续四次真实值改变中，第 3、4 次都落在
   `2026-09-21T07:13:34Z`。证据：实验 1 §4.4。
   **影响**：这是"平台给不出全序"的直接证据，D3 的乱序判据必须叠加本地接收时刻。

4. **`updateProjectV2ItemPosition` 不给 `first`/`last` 时 payload 整体为 null，但写入已经生效。**
   证据：实验 1 §4.6。**影响**：这是本批次观察到的第二次"写成功但响应不可用"，进一步支持
   "确认必须靠读回"。

5. **`projects_v2_item` 在仓库 webhook 上被显式拒绝**（`422`，
   `These events are not allowed for this hook: projects_v2_item`），而同一次会话里
   `pull_request` / `issues` 订阅成功（`201`）。证据：实验 2 §4.1、§4.2。
   **影响**：这不是权限问题，是事件白名单限制，D1 的"订不到"结论成立。

6. **user-owned Project v2 没有任何可用的 webhook 作用域。** org 端点 `404`（owner 是 user 不是
   organization），用户级与 project 级端点都不存在。证据：实验 2 §4.3。
   **影响**：项目条目事件在本沙箱形态下**完全不可得**，对账是唯一正确性路径。

7. **legacy `project` / `project_card` / `project_column` 事件名会被接受。** 证据：实验 2 §4.4。
   **影响**：容易误判为"能订到项目事件"；记录里明确它们属于 classic Projects，本批次没有观察到
   它们因 Project v2 写入而投递。

8. **`addProjectV2ItemById` 拒绝 draft。** `contentID must refer to an Issue or a Pull Request.`
   证据：实验 3 §4.3。**影响**：加入 draft 只能走 `addProjectV2DraftIssue`，它在 project 里创建新内容，
   语义与"挂接既有内容"不同。

9. **`deleteProjectV2Item` 的 `projectId` 是必填**，且删除后 `items.totalCount` 一度仍返回 9，
   而同一 connection 的 `nodes` 已经是 7 条。证据：实验 3 §4.2、§6.3。
   **影响**：对账不能只信 `totalCount`，必须读 `nodes`。

10. **`gh api graphql -f value.text=...` 无法传 GraphQL 输入对象。** 平台返回
    `Variable $value of type ProjectV2FieldValue! was provided invalid value`，与"平台拒绝写入"的
    错误形态相同。证据：记录文件"命令约定"。**影响**：复现者会误判；记录里固定用
    `gh api graphql --input <json>`。

11. **未实测的分支（如实记录）。** "创建内容那一步（`createIssue` / `addProjectV2DraftIssue`）的
    响应丢失"没有实测：本批次只观测了"加入既有内容"这一步的幂等性。实验 3 §7 第 5 条恢复路径
    基于"标题不是可靠自然键"（实测 `fixture` 命中 5 条）推导，不是直接观测到的平台行为。
    **没有做的原因**：本批次夹具只包含既有 issue / PR，若要实测该分支需要额外创建 issue 内容；
    ExecPlan 的 Global Constraints 只允许在沙箱内建**本批次专属的可写条目**，而创建 issue 会改变
    沙箱的内容集合，影响 E1-1 / E1-2 记录的复核基线。因此本批次选择如实记录这一未覆盖分支，
    把它作为 E1-4 的输入而不是用推断补齐。

12. **历史观测值与当前实测值必须分开写（独立验收发现）。** 本批次的三条实验在 07:10–07:13Z 完成，
    而 E1-2 在 07:18:02Z 把 `draft-convert` 夹具转成了 issue #6。因此记录里有两处**当时为真、今天
    重跑会不同**的值：`PVTI_lAHOAY1ahM4BkJ9rzg75lAw` 的 `type`（当时 `DRAFT_ISSUE`，现在是
    `ISSUE`），以及 `GET /search/issues?q=…fixture` 的 `total_count`（当时 5，现在 6）。
    **处理方式**：历史观测原文一字不改，在紧邻处加注说明"该夹具后来被 E1-2 转换"并给出当前值。
    第一版修复曾直接把 `"type":"DRAFT_ISSUE"` 改写成 `"type":"ISSUE"`，那会伪造观测原文，已改回。
    **影响**：本仓库的 E1 记录是**带时刻的证据**，不是"当前状态快照"；任何引用它的下游批次（含
    E1-4 的裁决）都必须按记录声明的时刻读，不能把记录当成今天的实测。

13. **PR 描述的 check 列表必须按当前 head 回读（独立验收发现，P1）。** 回填时把
    `Reconcile engineering state` 写成了本 PR 上 pass，但该 workflow 在交付 head 上的 run 是
    `completed/cancelled`，pass 的那两次属于已被 rebase 取代、不是 HEAD 祖先的 head。
    **影响**：这是 `AGENTS.md` §6「不把旧状态当作当前状态」的实例；栈内 PR 的 base 不是默认分支，
    工程状态 workflow 的 run 会被后续 run 取代而取消，这一点必须在 PR 描述里如实写明而不是省略。

## Decision Log

- **Decision**：事件订不到时不把本批次判为失败，而是把结论写成"正确性由对账提供"。
  **Rationale**：issue #24 Notes 预先声明事件是加速器而不是正确性机制；把平台不提供事件记成缺陷，会把一条设计选择误判成实现障碍。实测进一步证实：`projects_v2_item` 在仓库 webhook 上被 `422` 拒绝，user-owned project 又没有其他 webhook 作用域，因此"订不到"是平台事实而非配置错误。
  **Date/Author**：2026-09-21 / agent

- **Decision**：本批次复用沙箱既有 `issue-writable` 成员关系，不另建内容夹具。
  **Rationale**：实际观测使用的是既有可写成员关系；夹具来源与计划初稿不一致，按事实收敛，避免把“允许改动文件”误写成“硬约束要求不修改”。
  **Date/Author**：2026-09-21 / agent

- **Decision**："重复投递 / 乱序"按可判别输入判定，而不是要求真实事件投递。
  **Rationale**：本地模型做去重与乱序判定，靠的是观察自带的时间戳或版本，不是投递次数；记录这个输入比记录投递次数更接近根因。实测把这条推进了一步：`updatedAt` 秒级且同秒碰撞，所以"可判别输入"里必须包含本地接收时刻，`updatedAt` 单独不足以定序。
  **Date/Author**：2026-09-21 / agent

- **Decision**：契约不得依赖 compare-and-set；写路径的 `Saved` 只能由独立读回支撑。
  **Rationale**：`ProjectV2Item` 没有 ETag / revision 字段，`updateProjectV2ItemFieldValue` 没有任何前置条件参数，唯一的时间类字段 `updatedAt` 是秒级、只在真实变更时推进、同秒可碰撞。把 CAS 写进契约等于把冲突处理建在空气上。同时 mutation 响应回显会丢值，因此 `Saved` 也不能由响应单独支撑。
  **Date/Author**：2026-09-21 / agent

- **Decision**：把"结果不确定"的产品可见范围**收窄**到"创建内容"那一步，而不是"任何外部写入"。
  **Rationale**：实测 `(project, contentId)` 在平台侧唯一（重复加入的计数为 1），而 `contentId` 是发起方本来就持有的输入，所以"加入既有内容"这一步有可靠自然键，响应丢失后可以先对账再重试，不需要产品可见状态。只有"创建 `contentId` 本身"那一步没有不依赖响应的自然键（标题可变且实测 `fixture` 命中 5 条），才必须让用户看到"结果不确定"。
  **Date/Author**：2026-09-21 / agent

- **Decision**：~~`docs/architecture/README.md` 与 `docs/README.md` 的索引更新延后到栈级联步骤。~~
  ~~**Rationale**：这两个文件属于本批次允许改动的文档范围，但索引由栈级联统一更新；本批次主动不修改它们，避免四层栈的每个 PR 在同一处产生冲突。~~
  **Superseded by `Progress` 与 `Global Constraints`（2026-09-22）**：该决策没有执行——两个索引文件已随本批次回填提交各加一行；本批次实际改动的文件集合见 `Global Constraints`，不在此复述。
  **Date/Author**：2026-09-21 / agent（2026-09-22 标注 Superseded）

## Idempotence and Recovery

- 实验 1 的字段写入可重复（覆盖同一个值）；**注意同值写入不推进 `updatedAt`**，因此重跑实验 1
  的 §4.3 时要先改一个不同的值再改回来，否则观察不到推进。
- 实验 1 的条目顺序写入可用 `afterId=issue-shared`（`PVTI_lAHOAY1ahM4BkJ9rzg75k64`）还原到变更前；
  本批次已还原。
- 实验 3 的重复创建**实测是幂等的**（计数为 1），因此重跑不会在沙箱里留下多余成员关系；
  但探测 `contentId` 接受范围时创建的临时 draft 夹具必须删除（本批次已删除，`deletedItemId` 有回显）。
- 若创建了 webhook，拆除步骤必须包含删除它；本批次创建 4 个并全部删除。回读命令：
  `gh api /repos/$E1_OWNER/$E1_REPO/hooks --jq 'length'`（期望 `0`）。`gh api` 没有 `-R` / `--repo` 参数，
  端点里的 `{owner}` / `{repo}` 占位符又是由当前目录推断的，所以仓库必须像上面这样写成字面路径才与工作目录
  无关；`$E1_OWNER` / `$E1_REPO` 的赋值处是 `docs/architecture/gate-e1-sandbox.md` §2（记录文件的"命令约定"
  只引用、不重新赋值）。
- 验证命令只读且可重复；回滚单位是单个提交。

## Interfaces and Dependencies

- **上游**：`docs/architecture/gate-e1-sandbox.md`、`docs/architecture/gate-e1-content-identities.md`、`docs/architecture/gate-e1-membership-and-draft.md`。
- **外部工具**：`gh`、GitHub GraphQL API、仓库 webhook API。
- **后续工作项**：E1-4（#25）读取本记录裁决 #4 的第 4、5、6 条行为；`packages/capabilities` 的写入确认契约若与本记录冲突，按记录修契约而不是反过来。

## Outcomes & Retrospective

**三条实验的实际判定**（详细证据见 `docs/architecture/gate-e1-write-and-events.md`）：

| # | 问题 | 实测判定 |
|---|---|---|
| 1 | 写路径的确认能否从平台响应推导 | **能，但响应回显不完整**：值会回显，但 `fieldValues` connection 会丢值；可靠做法是定向读 `fieldValueByName` 或独立读回 |
| 2 | 平台有没有 compare-and-set | **没有**：只有秒级 `updatedAt`，无 ETag / revision，mutation 无前置条件参数 |
| 3 | `Saving… → Saved` 能否实现 | **能**，但 `Saved` 必须由独立读回支撑 |
| 4 | 事件关闭时对账是否仍收敛 | **是，且是唯一路径**：`projects_v2_item` 被 `422` 拒绝，user-owned project 无其他 webhook 作用域 |
| 5 | 重复投递是否改变实体与关系计数 | **不改变**：`ProjectV2Item.id` 是稳定自然键，幂等 upsert 即可 |
| 6 | 旧观察是否覆盖新观察 | **有保护的判据**：`updatedAt` 秒级且同秒碰撞，需叠加本地接收时刻，`==` 时整快照替换 |
| 7 | 结果不确定是否先对账再重试 | **是，且可行**：`(project, contentId)` 幂等 |
| 8 | 无自然键时是否记为产品可见状态 | **是，但范围收窄到"创建内容"那一步** |

**CAS 是否存在的结论**：不存在。`ProjectV2Item` 的字段集合里没有版本类字段，
`updateProjectV2ItemFieldValue` 的输入项里没有前置条件参数，唯一的 `updatedAt` 是秒级、
只在真实变更时推进、同秒可碰撞的墙钟标记。因此写路径契约**不得**依赖 compare-and-set。

**重复创建的实测计数**：**1**。两次参数完全相同的 `addProjectV2ItemById` 返回同一个 item id
（`PVTI_lAHOAY1ahM4BkJ9rzg75lGI`）、同一个 `createdAt`（`06:59:38Z`）、同一个 `updatedAt`
（`06:59:40Z`）；清理临时夹具后 Project A 为 7 条，issue #4 只有一条成员关系。

**与计划的偏差**：

1. 计划里写"实验 3 的重复创建**故意不可幂等**，会在沙箱里留下多余成员关系"。实测相反：平台幂等，
   计数为 1，沙箱没有留下多余成员关系。这条偏差已改写到 `Idempotence and Recovery`。
2. 计划里 D2 第 1 项预设"响应回显"是完整可用的。实测回显会丢值，判定降级为"部分可用"。
3. 计划里把"结果不确定"的范围默认成"任何外部创建"。实测把它收窄到"创建内容"那一步。
4. 计划里"实验 1：对 Status / Iteration / Target date / 条目顺序各写一次"。实际按 D2 的字段类型
   覆盖写了 `E1 Text` / `E1 Date` / `E1 Iteration` / `Status` 四条，再加一次位置写入；这比原计划
   多覆盖了一个文本字段，少写了一个重复的 Status 变体，覆盖更完整而不是更少。
5. **夹具来源与计划表述不一致。** 计划初稿写成“另建、不复用 E1-1/E1-2 夹具”，实际执行复用了沙箱中既有的 `issue-writable` 成员关系，未新建内容夹具；已按事实收敛并在 Progress 中明确。

**还有哪些写入语义只在文档里成立（剩余清单）**：

1. **"创建内容那一步响应丢失"没有实测**。本批次只观测了"加入既有内容"的幂等性；创建 issue /
   draft 的响应丢失后能否用某个自然键恢复，仍是推断。
2. **`addProjectV2DraftIssue` 的幂等性没有实测**。它是唯一能往 project 里加 draft 的路径，
   且它在 project 里创建内容，语义与 `addProjectV2ItemById` 不同；重复调用是否产生两条 draft
   没有观测。
3. **并发写入的冲突语义没有实测**。本批次全部是串行写入；两个并发写入谁赢、`updatedAt` 如何表现
   没有观测。
4. **legacy `project*` 事件是否会因 Project v2 写入而投递没有实测**。本批次只观测到事件名被接受，
   没有观测投递（URL 是保留域名，不会真的投递）。
5. **`clearProjectV2ItemFieldValue` 与 `archiveProjectV2Item` 的确认语义没有实测**。
6. **organization-owned Project v2 是否能订到 `projects_v2_item` 没有实测**。本沙箱是 user-owned，
   org 端点 `404` 只证明"这个 owner 不是 organization"，不证明 org 场景下的行为。

**复盘**：最窄的判别性观测（四次字段写入 + 两次订阅尝试 + 两次相同创建）就推翻了计划里的三条预设，
说明"写路径确认语义"这类命题不能靠读文档收敛。本批次没有新增任何代码，产出全部是仓库内证据；
规模不在这里写死，按 `Global Constraints` 的回读命令判定。

## Bottom Change Note

- 2026-09-21：首次创建。原因：issue #24 要求复用 #22 的沙箱与模板，先写 ExecPlan 再开始观测。
- 2026-09-21：观测完成并回填。原因：三条实验各有实测记录与判定；把 Progress 勾选、Surprises &
  Discoveries（11 条，含 1 条未实测分支的如实说明）、Decision Log（新增 3 条）、
  Validation and Acceptance（9 项全部有结论）、Outcomes & Retrospective 与验证命令实测输出写入本文件。
  同时把索引更新一条标记为"延后到栈级联"。计划里"实验 3 故意不可幂等"的预设被实测推翻，已在
  `Idempotence and Recovery` 与 `Outcomes & Retrospective` 中改写。
- 2026-09-22：按 `PLANS.md` §4 的四条活文档一致性规则修正本计划。原因：机械调查与回读发现本计划自己
  否证自己——`Global Constraints` 把索引文件列进范围，而 `Plan of Work`、`Progress`、`Decision Log`
  三处却声明本批次不修改它们，与实测 diff 矛盾；验证块还断言 `git diff --name-only` 只列出两个文件，
  并把 base SHA 与行数写成正文事实（两者此后都已变化，且行数自身对不上）。处理：文件集合收归
  `Global Constraints` 一处并给出回读命令（规则 1、3、4）；被推翻的三处结论就地加 `Superseded by`
  并保留原文（规则 2）；`size` 与 base SHA 改为回读命令 + 期望（规则 3）；验证块补执行上下文（规则 4）。
  本文件实际改动的文件集合见 `Global Constraints`。
- 2026-09-23：第二轮评审 D 组的三条意见落地（只改本计划；D6 与 Batch 2 由编排者写入，未改动）。原因：
  这三条都是本文件把易失状态写成了正文事实。(1)「少 19–22 行」的参照版本错了——`19–22` 是相对
  **上一版**（块内记 `350` 的那一版）算的，不是相对本版，而写下这句话的提交自己就把本计划改长，
  于是在同一个提交内自相矛盾；处理是就地标 `Superseded` 并保留原文（规则 2），新表述只留方向与判据，
  当前值改由 `wc -l` 回读——差值随本版增长而变，写死任何一个数都会再次过期（规则 3）。
  (2) 两组行号（CAS 结论与「结果不确定」恢复路径各一组）已经漂移，且记录文件在本轮还会继续被改动，
  写进正文必然再次漂移；处理是删掉行号、改为按原句引用，`grep -c` 的期望计数保留——计数是判据，行号不是。
  (3) Validation 第 9 项把「按家目录前缀与 hostname 两类模式扫描」写得像覆盖了沙箱 §7 的全部本机路径
  规则；处理是写明机械扫描实际覆盖的两类模式、它覆盖不到的 `/tmp/...` 字面路径只能人工核对，并给出
  `grep -c '/tmp/'` 的期望 `0` 作为本轮修掉那一类的判据。- 2026-09-23：按第二轮评审的 7 条意见修改（逐条核对全部属实，但 T3 的一条支撑前提不成立——它说 E1-2 也照 §6 执行，实测 E1-2 记录里「规划字段值」行数为 0、`:190` 是讲 `updatedAt` 的正文；三份记录的第 5 项有三种表头，所以「模板没有强制点」比评审说的更严重）。**没有逐条打补丁**：D6 把它们归并成四个根机制（A 模板是形状契约但没有强制点、B 不变量只对第一份记录生效、C 在结构中间插入散文、D 易失/本机信息仍被写成值），主要矛盾是 A+B——它们是同一个根，正是 #105 那轮 R1「规则没有强制点」在记录集合上的重演。改动：(1) 记录集合按前缀发现、不再硬编码，新增 (b0) 缺行断言（E1-2 显式豁免，理由与出路写进 D6）；(2) 沙箱 §2 新增两节登记三类合法 id 来源，§2.1 与 §7 的措辞按实际覆盖校准，§6 写明模板行名固定；(3) §4.4 的注记移到表后恢复表格连续；(4) 6 处字面 /tmp 改成 $E1_CLONE 占位符、错差值改为方向+回读命令、两组过期行号改为原句引用。

