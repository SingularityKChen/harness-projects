# 交付规划与工作看板重整 ExecPlan

> 状态：Active
> 创建：2026-09-18
> 范围：把上游设计输入中仍然有效的交付结论，转成本仓库可查询的工作单元——里程碑、迭代、依赖、批次粒度与看板自动化；并重述"原始交付 MVP 是什么"。不写任何 `packages/` 下的实现代码。
> 上游输入：`AGENTS.md`、`PLANS.md`、本机只读的上游设计输入（§1.5，不可分发）

## Purpose / Big Picture

完成后，一个对本项目一无所知的人打开 GitHub Project 10，不读任何文档就能回答三个问题：

1. **现在该做什么** —— 当前迭代里 `优先级 = P0` 的条目；
2. **什么被挡住了** —— `blocked-by` 边上还有未关闭的 issue 的条目；
3. **这一批会有多大** —— `规模` 字段，在动手之前就声明预计 diff 量级。

同时，"MVP 是什么"从一张二十行的范围表，回到**一条可被证伪的链路**。

最小成功证据：

```bash
# 每个看板条目的 Status / 优先级 / 规模 都非空
gh project item-list 10 --owner SingularityKChen --format json --limit 80 \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for i in d['items'] if i.get('status')), '/', len(d['items']))"
# 期望：23 / 23

# "现在真正可以动手的集合"可以直接查出来，不靠人脑记忆
gh issue list --state open --search "-is:blocked" --json number,title --jq 'length'
# 期望：> 0，且返回的每一条都确实没有未关闭的前置条件
```

## Context and Orientation

### 术语

| 词 | 在本仓库里的意思 |
|---|---|
| **能力域** | Planning / Development / Delivery / Execution / Storage 五类可独立替换的边界（`AGENTS.md` §1.2） |
| **Gate E1** | 冻结本地数据模型 v1 之前必须通过的跨 Provider 身份与同步幂等性验证（`AGENTS.md` §1.4） |
| **Gate R1** | MVP 发布门禁 |
| **纵向切片** | 一条从入口到可观察结果的完整链路，而不是一层技术栈（`AGENTS.md` §5.2） |
| **里程碑（Milestone）** | 回答"这是哪个能力闭环"——范围盒 |
| **迭代（Iteration）** | 回答"什么时候承诺"——时间盒 |
| **Status** | 回答"开发做完没" |

三者正交：一个条目可以属于 M2、排在迭代 3、状态还是 Todo。

### 盘点时（2026-09-18）的仓库事实

- `main` 有 5 个提交；`packages/*/src` 全部是空骨架；唯一的测试是 `tests/contract/package-boundaries.test.js`。
- CI 只有一个工作流 `.github/workflows/ci.yml`，一个 job `PR Fast Gate` = install + typecheck + test。
- `docs/adr/`、`docs/architecture/`、`docs/product/` 只有目录说明，没有内容。
- **6 个 PR 全部 open、全部 mergeable、检查全绿，自引导以来一个都没有合并**：#3、#11、#12、#13、#19、#21。
- 13 个 issue 全部 open，0 个 milestone，看板 12 个条目、无迭代字段、无优先级字段。
- 看板六个内置工作流里只有 `Auto-add sub-issues to project` 是开启的。

### 上游设计输入与本仓库的关系

上游输入按 `AGENTS.md` §1.5 只在本机只读保留、不随仓库分发。本计划**重新表述**其中仍然有效的交付结论，不引用其内部编号与目录结构。冲突时以仓库内文档为准（本计划的 Decision Log 记录了两处偏离）。

## Design / Spec

### D1. 原始交付 MVP 到底是什么

上游输入用三样东西描述 MVP：一张约二十行的能力范围表、一条十三步的纵向链路、一个十二条的发布门禁。**这三样不是同一个东西，混用它们是当前最大的规划风险。**

范围表回答的是"首发版本里包含哪些能力"。把它当成 MVP，就会同时铺开工作项列表、Backlog/Sprint、看板、Kanban WIP、Roadmap、Milestone、关系管理、同步诊断、Activity/Provenance、能力降级——十几个能力横向并行，**每一个单独都无法验收**，风险全部堆到最后一次集成。这正是 `AGENTS.md` §5.2 明令禁止的横向切分。

从第一性原理重新推导：MVP 是**能最早证伪核心信念的最小交付物**。本项目的核心信念只有一条：

> 项目规划事实源与工程执行事实可以被显式关联，而任何一方都不篡位为另一方的事实源。

它的可证伪形式是：

> 一条链路——一个项目条目 → 一个工作项 → 开始工作 → 执行上下文 → 分支 / 变更请求 / CI ——走完之后，规划状态仍然由规划提供方拥有，且没有任何未被提供方确认的值被标记为"已保存"。

于是本仓库把 MVP 拆成三个不同的东西，各自有各自的判定方式：

| 名称 | 是什么 | 判定方式 | 对应 |
|---|---|---|---|
| **MVP-0** | 上面那条链路，全部用 fake provider | `pnpm test` 内一条端到端用例通过，无凭据、无网络 | issue #7 / 里程碑 M3 |
| **MVP-1** | 同一条链路，provider 换成真实 GitHub Projects / Git / GitHub / Actions，链路语义不变 | 在一个 sandbox Project 上人工走通前 12 步 | 里程碑 M4 |
| **首发范围** | 上游那张能力表 | Gate R1 的十二条 | 里程碑 Gate R1 |

**MVP-0 才是"原始交付 MVP"在本仓库的正确形态。** 理由有三条：

1. 它不需要任何外部系统、凭据或网络，因此是能最早跑起来的东西；
2. 它把"身份模型、事实所有权、显式谱系、能力降级"四件必须从第一版就对的事情全部纳入同一个可执行断言；
3. 它一旦跑通，把 provider 从 fake 换成真实平台是**替换**而不是**重写**——如果不是，说明能力契约本身就错了，而这恰恰是 fake 版本要暴露的。

上游的里程碑清单里，第一个里程碑被描述为"建立最小 domain / core / storage 骨架"。那是**分层**表述。`AGENTS.md` §1.4 的"优先交付不依赖真实 GitHub 也能验收的纵向切片"是更强的约束，本仓库的 issue #7 已经是正确的纵向表述。两者冲突时按 §1.5 以仓库内文档为准。

### D2. 里程碑与迭代的职责分离

不把时间写进里程碑，也不把范围写进迭代：

| 载体 | 回答 | 变更代价 |
|---|---|---|
| Milestone | 这属于哪个能力闭环 | 高——改动意味着重新定义"做完是什么" |
| 迭代（Iteration 字段） | 什么时候承诺做 | 低——可以按实际速度滑动 |
| Status | 开发做完没 | 由执行过程驱动 |

六个里程碑：

| 里程碑 | 闭环 | 到期 |
|---|---|---|
| M0 · 仓库与协作就绪 | 评审队列清空，协作约定全部落到 `main` | 2026-09-27 |
| M1 · Gate E1 身份与同步验证 | 用可复现证据回答身份与幂等性问题 | 2026-10-14 |
| M2 · 契约与存储骨架 | 能力契约与本地存储可在无凭据条件下被测试 | 2026-10-21 |
| M3 · MVP-0 纵向切片（Fake Provider） | 完整链路在 CI 内跑通 | 未排期 |
| M4 · MVP-1 真实 GitHub 纵向切片 | 同一链路换成真实 provider | 未排期 |
| Gate R1 · MVP 发布门禁 | 具备发布资格 | 未排期 |

M3 之后**故意不填到期日**：Gate E1 的裁决可以重塑 #7 的拆分方式，现在写死日期是虚假精度。

### D3. PR 粒度控制：两个机制，一条规则

`AGENTS.md` §8.3 规定代码 PR ≤ 1000 行、文档 ≤ 1500 行。问题在于这个约束现在只在**评审时**才被发现——那时拆分成本最高。两个机制把它前移到**规划时**：

**机制一：`规模` 字段**（看板单选字段），在动手之前声明预计 diff 量级：

| 取值 | 含义 |
|---|---|
| `XS` | ≤ 100 行 |
| `S` | ≤ 300 行 |
| `M` | ≤ 600 行 |
| `L` | ≤ 1000 行——已接近上限，评审前先自查能否再拆 |
| `拆分` | **本条目永远不会自己变成一个 PR**，必须先拆成子条目 |

**机制二：sub-issue**。一个 sub-issue = 一个批次 = 一个 PR。父条目只做协调，不占 PR。

**规则**：标 `拆分` 的条目只有在**至少一个子条目进入迭代**时才跟着进入迭代，并在最后一个子条目关闭时关闭。因此 #7 标 `拆分` 且未排期——它还没有被拆，现在排期就是空头承诺。

本次按这条规则新建了十个子条目：

| 父 | 子条目 | 各自决定了什么 |
|---|---|---|
| #4 Gate E1 | #22 三类内容身份 | 成员关系与内容身份是否真的可分离 |
| | #23 多 membership 与 Draft 转换 | 内部工作项身份是否在两种最危险的情形下保持 |
| | #24 写确认与事件可靠性 | `Saving → Saved` 能否诚实实现；无事件时能否收敛 |
| | #25 裁决与冻结建议 | 冻结还是修改，二选一 |
| #5 SQLite 骨架 | #26 迁移运行器 | 从空库可重复迁移（**不依赖 E1 裁决，可并行**） |
| | #27 身份与成员表 | 受 E1 裁决约束 |
| | #28 执行 / 关系 / 写入表 | 重启后本地控制事实是否完整恢复 |
| #6 能力契约 | #29 能力定义与错误模型 | 稳定 capability key 与结构化错误（**不依赖 E1 裁决，可并行**） |
| | #30 Planning 契约套件与 fake | 契约是否真的能被证伪 |
| | #31 Dev/Delivery/Exec 套件与 fake | 其余三个域，使 #7 可在无凭据下测试 |

**#7 故意不拆。** 它的批次划分依赖 #25 的裁决结果；现在拆出来的子条目有很大概率在裁决后作废。这符合 `AGENTS.md` §5.1 判据 4："不为减少 issue 数量而合并批次，也不把同一风险摊成多个文件级提交"——反过来同样成立：不为了看起来有计划而提前拆一个还不知道形状的东西。

### D4. 看板自动化（auto-flow）的取舍

盘点发现六个内置工作流里只有 `Auto-add sub-issues to project` 开着。本次逐条判断后的结论：

| 工作流 | 决定 | 理由 |
|---|---|---|
| Auto-add sub-issues to project | **保持开启** | 本次新建十个子条目全部自动上板，已验证有效 |
| Item added to project → Status = Todo | **建议开启** | 消除"上了板但没有状态"的空洞条目 |
| Item closed → Status = Done | **建议开启** | 关闭 issue 是人做出的**规划动作**，不是工程事实 |
| Pull request merged → Status = Done | **不开启** | 见下 |
| Auto-close issue（Status = Done 时关闭） | **不开启** | 与"Item closed"构成回环，且把状态写回权交给自动化 |
| Pull request linked to issue | **不开启** | 当前无对应的字段语义 |

`Pull request merged → Status = Done` 值得单独说明。合并是**工程执行事实**；`Done` 是**规划状态**。让前者自动改写后者，正是本项目七条不变量第 3 条（"项目规划状态与工程执行状态正交：CI 失败、Agent 完成、PR 合并都不得默认覆盖规划状态"）明确禁止的行为。在自己的看板上打开这个开关，等于在自己要交付的产品不变量上开一个例外。不开。

**一个无法用 API 解决的约束**：GitHub GraphQL 只提供 `deleteProjectV2Workflow`，没有创建或启用内置工作流的 mutation。

```bash
gh api graphql -f query='query { __schema { mutationType { fields { name } } } }' \
  --jq '.data.__schema.mutationType.fields[].name' | grep -i workflow
# 实测输出只有：deleteProjectV2Workflow
```

因此上表中"建议开启"的两条**必须在网页界面手工开启**，路径见 `Validation and Acceptance`。

**已知缺口**：不是 sub-issue 的新 issue 不会自动上板——issue #20 就是这样漏掉的，本次手工补入。补这个缺口需要一个带 `project` scope 的 token 存成仓库 secret，再加一个 Actions 工作流。本次**不做**：评审队列还没清空时再往里加一个 PR，只会加重当前真正的瓶颈。已记入 `Interfaces and Dependencies` 待办。

### D5. 被放弃的方案

| 放弃的方案 | 为什么 |
|---|---|
| 用 `priority:*` 标签表达优先级 | issue #18 已经明确拒绝标签优先级。但它拒绝的理由是"不要建一套和看板字段重复的标签体系"，而不是"不需要优先级"。因此优先级作为**看板字段**存在，不作为标签 |
| 把 PR 的合并顺序编码成 `blocked-by` | `blocked-by` 应当表示"做不了"，而不是"最好晚点做"。合并顺序是变基顺序，写进文档 |
| 现在就拆 #7 | 它的形状依赖 Gate E1 裁决，见 D3 |
| 现在就建 Actions 自动上板工作流 | 见 D4，会加重当前瓶颈 |
| 把六个 PR 合并成一个大 PR 以减少排队 | 违反 `AGENTS.md` §5.1 判据 2：合并后无法单独回滚 |

## Global Constraints

- 本计划**不修改** `packages/` 下任何文件，不新增依赖，不改 CI 工作流。
- 所有对 GitHub 的改动通过 `gh` 完成，命令必须可复制重放（见 `Idempotence and Recovery`）。
- 本仓库是 public：分支一经推送、PR 描述一经提交即等同公开发布。因此进入发布面的内容（issue 正文、里程碑描述、PR 描述、本文件）不得含本机绝对路径、本机用户名 / 主机名、凭据或内部系统信息。
- 不修改 `main` 分支保护配置，不改 `PR Fast Gate` 检查名。
- 不代替人类合并任何 PR（`AGENTS.md` §8.3 第 3 条）。

## Plan of Work

### Batch 1 · 盘点与 MVP 重述
**最小闭环**：把"原始交付 MVP 是什么"从三种互相冲突的表述收敛成一个可判定的定义。
**涉及文件**：`docs/exec-plan/active/2026-09-18-delivery-planning-and-board.md`（本文件的 Design / Spec 章节）
- [x] 读完上游设计输入的全部文件，抽出交付相关结论
- [x] 盘点 GitHub 侧现状（issue / PR / 看板 / 里程碑 / 工作流 / 分支保护）
- [x] 写出 D1 的三层区分与理由
**验证**：D1 中 MVP-0 / MVP-1 / 首发范围三者各有一条可执行的判定方式，且互不相同。
**回滚**：删除本文件。

### Batch 2 · 看板字段与里程碑
**最小闭环**：迭代排期与 PR 粒度有了承载字段；能力闭环有了范围盒。
- [x] 新建 `迭代` 字段（ITERATION，四个具名迭代）
- [x] 新建 `优先级` 字段（P0 / P1 / P2）
- [x] 新建 `规模` 字段（XS / S / M / L / 拆分）
- [x] 新建六个里程碑并写入验收口径
**验证**：
```bash
gh project field-list 10 --owner SingularityKChen --format json --limit 30 \
  --jq '[.fields[].name] | map(select(. == "迭代" or . == "优先级" or . == "规模")) | length'
# 期望：3
gh api repos/SingularityKChen/harness-projects/milestones --jq 'length'
# 期望：6
```
**回滚**：`gh api -X DELETE repos/SingularityKChen/harness-projects/milestones/<n>`；字段用 `deleteProjectV2Field`。

### Batch 3 · 子条目与依赖图
**最小闭环**："什么被挡住了"可以用一条查询回答，而不是靠读计划。
- [x] 新建十个子条目（#22–#31），各自带 Context / Scope / Acceptance criteria / References / Notes
- [x] 用 `addSubIssue` 挂到 #4 / #5 / #6
- [x] 用 `addBlockedBy` 建立 18 条依赖边
**验证**：
```bash
gh issue list --state open --search "is:blocked" --json number --jq 'length'
# 期望：11（#7 #10 #15 #16 #17 #20 #23 #24 #25 #27 #28 #30 #31 中已建边的部分）
gh issue view 4 --json title --jq .title   # 父条目存在
```
**回滚**：`removeSubIssue` / `removeBlockedBy`；子条目可关闭。

### Batch 4 · 迭代排期与字段回填
**最小闭环**：看板上没有空字段，"现在做什么"可以直接看出来。
- [x] 为 23 个条目写入 Status / Kind / Area / Gate / 优先级 / 规模 / 迭代 / ExecPlan / Batch
- [x] 把漏掉的 #20 补进看板
**验证**：见 `Validation and Acceptance` 表第 4 行。
**回滚**：字段值可逐条清空；不影响 issue 本身。

### Batch 5 · 文档落地
**最小闭环**：本次所有约定在仓库内自包含可读，不依赖本对话。
**涉及文件**：`docs/exec-plan/active/2026-09-18-delivery-planning-and-board.md`、`docs/README.md`
- [x] 写完本 ExecPlan 全部强制章节
- [x] 在 `docs/README.md` 的 Active 索引中登记本计划
**验证**：
```bash
grep -c '^## ' docs/exec-plan/active/2026-09-18-delivery-planning-and-board.md
# 期望：13（PLANS.md §3 的十三个强制章节）
grep -n '2026-09-18-delivery-planning-and-board' docs/README.md
# 期望：至少一行
```
**回滚**：`git revert` 本批提交。

### Batch 6 · 人工开启看板工作流（待人类执行）
**最小闭环**：新上板条目不再出现空状态。
**为什么不能自动化**：见 D4——GitHub 未提供启用内置工作流的 mutation。
- [ ] 在网页界面开启 `Item added to project` → Status = Todo
- [ ] 在网页界面开启 `Item closed` → Status = Done
- [ ] 确认 `Pull request merged` 保持关闭
**验证**：见 `Validation and Acceptance` 表第 6 行。
**回滚**：同一界面关闭开关。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 三个新字段存在 | `gh project field-list 10 --owner SingularityKChen` 含 `迭代 / 优先级 / 规模` | 通过（2026-09-18） |
| 2 | 六个里程碑存在且各带验收口径 | `gh api repos/SingularityKChen/harness-projects/milestones --jq 'length'` = 6 | 通过（2026-09-18） |
| 3 | 每个 issue 都有里程碑 | `gh issue list --state open --limit 50 --json number,milestone --jq '[.[]\|select(.milestone==null)]\|length'` = 0 | 通过（2026-09-18） |
| 4 | 看板 23 条目字段无空洞 | 字段回填脚本输出 `wrote=164 failed=0`；GraphQL 读回每条的 Status / 优先级 / 规模 均非空 | 通过（2026-09-18） |
| 5 | 依赖图可查询 | `gh issue list --state open --search "-is:blocked"` 返回的集合与"当前真正可动手"一致 | 通过（2026-09-18） |
| 6 | 两个看板工作流已开启 | 新建一个测试 issue 并加入看板后 Status 自动为 `Todo`；关闭它后 Status 自动为 `Done`；随后删除该测试 issue | **待人类执行**（Batch 6） |
| 7 | `Pull request merged` 保持关闭 | `gh api graphql` 读 `workflows` 节点，该项 `enabled = false` | 通过（2026-09-18） |
| 8 | 发布面自查 | 见 `Idempotence and Recovery` 的自查方法；本次机械扫描与五个类目的人工逐条核对均通过 | 通过（2026-09-18） |

## Progress

- [x] (2026-09-18) Batch 1 盘点与 MVP 重述
- [x] (2026-09-18) Batch 2 看板字段与里程碑
- [x] (2026-09-18) Batch 3 子条目与依赖图（10 个子条目、18 条依赖边）
- [x] (2026-09-18) Batch 4 迭代排期与字段回填（164 次字段写入，0 失败）
- [x] (2026-09-18) Batch 5 文档落地
- [ ] Batch 6 人工开启两个看板工作流 —— **阻塞：GitHub 未提供对应 mutation，只能在网页界面操作**

## Surprises & Discoveries

- **Observation**：六个 open PR 全部 mergeable、检查全绿，但自引导以来一个都没有合并。当前系统瓶颈不是"工作不够"，而是**合并吞吐**。
  **Evidence**：`gh pr list --state all` 显示 #1 #2 已合并（2026-09-17），此后 #3 #11 #12 #13 #19 #21 全部 open；`gh pr checks` 对六个 PR 均返回 pass。
  **Decision impact**：迭代 1 只放"清空队列"，不放任何新开发。在队列不排空的情况下继续新建 PR 只会加长队列。

- **Observation**：四个 PR（#11 #12 #13 #19）都改 `AGENTS.md`，且 `main` 开启了 `required_status_checks.strict = true` 与 `required_linear_history = true`。
  **Evidence**：`gh pr view <n> --json files`；`gh api repos/SingularityKChen/harness-projects/branches/main/protection`。
  **Decision impact**：每合并一个，剩余的都必须变基后才能合并，且只能用变基（仓库已禁用 merge commit 与 squash）。合并顺序写进 `Interfaces and Dependencies`。

- **Observation**：PR #11 / #12 / #13 / #21 的描述都引用 `docs/exec-plan/completed/2026-09-17-repo-collaboration-setup.md`，而这个文件只存在于 PR #3。
  **Evidence**：`gh pr view 11 --json body` 第 17 行等；`gh pr view 3 --json files` 含该文件。
  **Decision impact**：这是内容依赖而非顺序偏好，因此编码成 `blocked-by`：#15 #16 #17 #20 均 blocked-by #14。#3 必须第一个合并。

- **Observation**：GitHub GraphQL 只有 `deleteProjectV2Workflow`，没有创建或启用内置看板工作流的 mutation。
  **Evidence**：`gh api graphql -f query='query { __schema { mutationType { fields { name } } } }' --jq '.data.__schema.mutationType.fields[].name' | grep -i workflow` 仅输出 `deleteProjectV2Workflow`。
  **Decision impact**：Batch 6 只能人工执行；不要在文档里写一条跑不通的命令冒充自动化。

- **Observation**：`gh project field-create` 不支持 `ITERATION` 类型（只支持 TEXT / SINGLE_SELECT / DATE / NUMBER），但 GraphQL `createProjectV2Field` 支持，且 `iterationConfiguration.iterations` 是**必填**的，因此迭代可以自带名字而不是被自动命名为 "Iteration 1"。
  **Evidence**：`gh project field-create --help`；首次省略 `iterations` 时 GraphQL 返回 `missingRequiredInputObjectAttribute`。
  **Decision impact**：迭代用具名形式（`迭代 2 · Gate E1 身份实验`），看板上直接能看出这一周要打什么。

- **Observation**：issue #20 不在看板上，而本次新建的十个子条目全部自动上板。
  **Evidence**：回填前 `gh project item-list` 的条目号集合缺 20；建完子条目后 22–31 全部出现。
  **Decision impact**：`Auto-add sub-issues to project` 确实生效；缺口只在"非子条目的新 issue"。记为待办而非现在就修（见 D4）。

- **Observation**：会话开始时 `AGENTS.md` 处于 modified 状态，其工作区内容包含一节"提交与 PR 前的敏感信息自查"（发布面定义、五类不得进入发布面的内容、两条扫描命令）以及 §9.4 的第 6 条自查项；本次工作过程中该修改从工作区消失，`AGENTS.md` 回到与 HEAD 一致的状态，而 HEAD 的 §8 只到 8.5、§9.4 只有 5 条。
  **Evidence**：会话起始 `git status` 显示 `M AGENTS.md`；随后 `git status --short AGENTS.md` 无输出；`grep -nE '^#{2,3} 8' AGENTS.md` 最后一项是 `### 8.5`；`git stash list` 为空；遍历所有远端分支的 `AGENTS.md` 均无该节。
  **Decision impact**：本计划与新建 issue 中原本指向该节的引用已全部改写为**就地陈述规则本身**，避免在仓库里留下指向不存在章节的悬空引用。规则本身仍然执行——本次提交前的机械扫描与五类人工核对都已完成。该节是否恢复、以及如何与四个同样改动 `AGENTS.md` 的在审 PR 协调，需要人类决定。

- **Observation**：`addBlockedBy` 的入参字段名是 `blockingIssueId`，不是 `blockedByIssueId`。
  **Evidence**：`gh api graphql -f query='query { __type(name:"AddBlockedByInput") { inputFields { name } } }'`。
  **Decision impact**：仅为脚本记录，避免下次重复试错。

- **Observation**：`gh api graphql -F v='{"text":"..."}'` 无法传递嵌套 JSON 对象给 `ProjectV2FieldValue!` 变量，会报 `was provided invalid value`。
  **Evidence**：首轮 164 次写入全部失败，改为把值字面量内联进 mutation 字符串后 164 次全部成功。
  **Decision impact**：`Idempotence and Recovery` 里的重放脚本采用内联写法。

## Decision Log

- **Decision**：把 MVP 重述为 MVP-0（fake provider 链路）/ MVP-1（真实 provider 链路）/ 首发范围三层，并把 MVP-0 认定为"原始交付 MVP"在本仓库的正确形态。
  **Rationale**：上游的能力范围表是发布范围，不是第一个交付物；把它当 MVP 会导致十几个能力横向并行、每个都无法单独验收。MVP-0 不需要凭据与网络，能最早证伪核心信念，且从 fake 换真实 provider 应当是替换而非重写——如果不是，说明能力契约本身错了，而这正是 fake 版本要暴露的。
  **Date/Author**：2026-09-18 / Claude Opus 5

- **Decision**：迭代 1 只做"清空评审队列"，不排任何新开发。
  **Rationale**：六个 PR 全绿且零合并，瓶颈在合并吞吐而非工作量。继续新建 PR 会加长队列并推高每个 PR 的变基成本。
  **Date/Author**：2026-09-18 / Claude Opus 5

- **Decision**：不开启 `Pull request merged → Status = Done` 看板工作流。
  **Rationale**：合并是工程执行事实，`Done` 是规划状态。让前者自动改写后者正是本项目不变量第 3 条禁止的行为。在自己的看板上开这个例外，会让不变量在自己的实践里先失效。
  **Date/Author**：2026-09-18 / Claude Opus 5

- **Decision**：优先级用看板字段而不是标签。
  **Rationale**：issue #18 拒绝的是"和看板字段重复的标签体系"，不是"不需要优先级"。字段形式既满足迭代规划，又不与 #18 的结论冲突。
  **Date/Author**：2026-09-18 / Claude Opus 5

- **Decision**：#7 暂不拆子条目，且不排期。
  **Rationale**：它的批次划分依赖 Gate E1 裁决（#25）。现在拆出的子条目有很大概率作废；排期则是空头承诺。
  **Date/Author**：2026-09-18 / Claude Opus 5

- **Decision**：M3 / M4 / Gate R1 不设到期日。
  **Rationale**：Gate E1 的裁决可以重塑 #7 的形状，五周之后的精确日期是虚假精度。
  **Date/Author**：2026-09-18 / Claude Opus 5

- **Decision**：合并顺序写进文档，不编码成 `blocked-by`；只有真实内容依赖才建依赖边。
  **Rationale**：`blocked-by` 应当表示"做不了"。把变基顺序写成依赖会让"什么被挡住了"这条查询失去意义。
  **Date/Author**：2026-09-18 / Claude Opus 5

## Idempotence and Recovery

**可重复执行的部分**：所有字段回填都是幂等的——同一个 `updateProjectV2ItemFieldValue` 重放只是把值写成同一个值。重放脚本形态（值字面量内联，不用变量）：

```bash
gh api graphql -f query='mutation{updateProjectV2ItemFieldValue(input:{
  projectId:"<PROJECT_ID>", itemId:"<ITEM_ID>", fieldId:"<FIELD_ID>",
  value:{singleSelectOptionId:"<OPTION_ID>"}}){projectV2Item{id}}}'
```

字段 ID 与选项 ID 用以下命令随时重新取得，不要硬编码在别处：

```bash
gh project field-list 10 --owner SingularityKChen --format json --limit 30
```

**不可重复的部分**：`gh issue create` 会产生新编号。若需重来，先关闭错误的条目再新建，不要试图复用编号。

**失败后如何回到已知良好状态**：

| 出错的东西 | 撤销方式 |
|---|---|
| 里程碑 | `gh api -X DELETE repos/SingularityKChen/harness-projects/milestones/<n>` |
| 看板字段 | `gh api graphql -f query='mutation{deleteProjectV2Field(input:{fieldId:"<id>"}){clientMutationId}}'` |
| 子条目挂载 | `removeSubIssue` mutation |
| 依赖边 | `removeBlockedBy` mutation |
| 本仓库文件改动 | `git revert` 本批提交 |

**提交前的发布面自查**分两步，缺一不可：

1. **机械扫描**：对本次改动的新增行（而不是全树）扫描家目录前缀与内网域名后缀两类可机械判定的模式，期望输出为空。
2. **人工逐条**：机械扫描只覆盖一类。还必须人工过一遍五个类目——凭据、本机路径与身份、账号与个人信息、内部系统、保密字样——通过后才勾选进 PR 描述的验证证据。

这里**故意不把扫描正则写成可复制的命令**：正则里含有家目录前缀的字面量，任何复制了它的文件都会让后续每一次自查命中自己。这条规则的权威表述属于 `AGENTS.md`；见 `Surprises & Discoveries` 中关于该章节当前未提交的记录。

## Interfaces and Dependencies

**依赖的外部工具与凭据**

- `gh` CLI，已认证账户至少需要 `repo` 与 `project` 两项 scope；本计划不需要超出这两项的权限。
- 无需任何新增仓库 secret。Batch 6 需要的是网页界面操作权限，不是凭据。

**PR 合并顺序**（不是依赖边，是变基顺序；`main` 开启 strict checks 与线性历史，每合并一个，后续都要变基）

| 顺序 | PR | 关闭 | 为什么在这个位置 |
|---:|---|---|---|
| 1 | #3 | #14 | 它落地的 ExecPlan 被 #11 / #12 / #13 / #21 的描述引用 |
| 2 | #11 | #15 | 改 `AGENTS.md` 的四个 PR 里最小，先合并降低后续变基量 |
| 3 | #12 | #16 | 改 `AGENTS.md`；同时落地 `docs/review/README.md`，#21 引用它 |
| 4 | #13 | #17 | 改 `AGENTS.md` |
| 5 | #19 | #18 | 改 `AGENTS.md`，且是最大的一个，放最后减少它被变基的次数 |
| 6 | #21 | #20 | 依赖 #12 落地的 `docs/review/README.md` |

变基命令（仓库禁用 merge commit，必须带 `--rebase`）：

```bash
gh pr merge <n> --rebase          # 由人类决定是否执行（AGENTS.md §8.3 第 3 条）
gh pr update-branch <next> --rebase
```

**已知缺口（未纳入本计划，需另开工作项）**

1. 非 sub-issue 的新 issue 不会自动上板。补法需要一个带 `project` scope 的 token 存成仓库 secret，加一个 Actions 工作流。评审队列清空后再做。
2. 本次确立的 `迭代 / 优先级 / 规模` 语义应当并入 `docs/project-management/README.md`——该文件目前只存在于 PR #11，合并后再补。

## Outcomes & Retrospective

本计划的 Batch 1–5 已完成，Batch 6 因平台限制待人工执行。完成后回填本节。

当前可以记录的实际结果：

- 看板从 12 个条目、6 个字段、无里程碑、无排期，变为 23 个条目、9 个用于规划的字段、6 个里程碑、4 个具名迭代、18 条依赖边。
- 四个原本无法单独评审的大条目（#4 #5 #6 各自跨多个风险，#7 跨四个包）中的三个已拆成十个可独立验收的子条目；#7 按 D3 的规则留待 Gate E1 裁决后再拆。
- 最大的一处认知修正是 D1：原始交付 MVP 被当成了一张能力范围表，重述为一条可证伪的链路之后，第一个交付物从"十几个能力横向铺开"变成"一条 fake provider 链路在 CI 内跑通"。

## Bottom Change Note

- 2026-09-18：首次创建。原因：13 个 issue、6 个 open PR 与一个只有 12 条目的看板之间已经无法用人脑对齐；同时"MVP 是什么"在上游输入里有三种互相冲突的表述，需要在开始实现前收敛成一个可判定的定义。
