# 2026-09-24-engineering-writer-terminal —— 让 `Engineering` 写入口与观察者共用一份终态选择策略

> 状态：Completed（第二轮 MMP 评审无 P0 / P1，随 PR #159 以 rebase merge 合入并归档；合并后的真实事件回读见 Progress 最后一条）
> 创建：2026-09-24
> 范围：`scripts/` 的两个工程轴脚本、两个契约测试与三份文档；不改 `Status`、不改产品代码
> 上游输入：`docs/exec-plan/active/2026-09-22-engineering-merged-state.md`（其「遗留问题」第 1 条把本层登记为 follow-up，评审 [1] 的处置就是本计划）、`docs/product/board-semantics.md` §2.1、`docs/development/ci.md`、`docs/project-management/merge-queue.md` §4.4 与 §7
> 载体 issue：<https://github.com/SingularityKChen/harness-projects/issues/115>

## Purpose / Big Picture

`Engineering` 字段有**两个**消费同一份 PR 真值的地方：写入口（`scripts/sync-engineering-state.mjs`，由 PR 生命周期事件唤醒）和观察者（`scripts/engineering-drift.mjs`，由每日 `Board invariants` 运行）。今天它们对「同一 issue 被多个 PR 引用时，哪个 PR 说了算」给出不同答案：

- 观察者：**任一 MERGED 优先**（终态且单调），否则创建时间最新的 OPEN，否则最新的 CLOSED；
- 写入口：只投影**触发事件的那一个 PR**，没有任何跨 PR 聚合。

于是一个已经被合并 PR #A 交付的 issue，只要再开一个非 draft 的 PR #B 并写 `Closes #N`，#B 的 `synchronize` / `ready_for_review` / review 事件就会把字段写回 `PR open`；观察者按自己的规则期望 `Merged`，**红且没有任何事件能清掉它**——#A 已是终态，不会再发事件；除非有人手改字段或 #B 关闭。`docs/project-management/merge-queue.md` 把堆叠 PR 变成正式流程之后，这个前提是常规操作而不是罕见情形。

完成后：

1. 选择策略**只有一份实现**，住在投影权威 `scripts/sync-engineering-state.mjs` 里（`stateForSnapshot` 旁边），观察者 import 它；
2. 写入口改为**聚合**：触发 PR → 它的 `closingIssuesReferences` → 每个 issue 的**全部**关闭引用 PR → 共享策略 → 再写；
3. 引用读取不完整时 **fail closed**（分页截断、字段缺失、state / reviewDecision 未知、空集合、触发 PR 不在引用集合里），绝不退回「只按触发 PR 写」；
4. `Status`（规划轴）与 `stateForSnapshot` 对单个快照的语义**逐条不变**；
5. `docs/development/ci.md` 里「投影共享，选择策略是观察者独有的」这类表述按新事实订正，旧表述就地标注而不是删除。

判断成功的最小证据（单元级复现 issue 正文的四步，merged #A + 后开的非 draft #B 同时关闭同一 issue）：

```bash
node --test tests/contract/engineering-state.test.js
# 期望：ℹ fail 0；其中「写入口在 merged A + 后开 open B 上必须写 Merged」一条通过
```

## Context and Orientation

### 术语

- **规划轴 / `Status`**：看板上由**人**拥有的字段，回答「规划所有者是否接受这个工作项完成」（`docs/product/board-semantics.md` §1–§2）。本计划一行都不写它。
- **工程轴 / `Engineering`**：看板上由**自动化**拥有的字段（`PR open` / `Changes requested` / `Approved` / `Merged`）。
- **投影（projection）**：把**单个** PR 快照 `(state, merged, isDraft, reviewDecision)` 映射成 `set <取值>` / `clear` 的纯函数，唯一实现是 `stateForSnapshot`。
- **选择策略（selection policy）**：给定「引用同一个 issue 的**全部** PR」，决定哪一个 PR 的快照参与投影，以及该 issue 应有的取值。今天它是观察者独有的，本计划把它搬进投影权威。
- **写入口 / 观察者**：`scripts/sync-engineering-state.mjs`（写）与 `scripts/engineering-drift.mjs` + `scripts/check-engineering-drift-live.mjs`（读）。
- **reconcile**：由事件唤醒、每次都重新读取真值再投影写入的一次运行。事件只是唤醒信号，不是真值来源。

### 相关文件与当前状态

| 路径 | 当前状态（`origin/main` = `4d46559`） |
|---|---|
| `scripts/sync-engineering-state.mjs` | 275 行。`stateForSnapshot` 是投影唯一实现；`loadPullRequestSnapshot` 只查 `pullRequest(number:$pr)`；`main` 用**触发 PR 一个快照**的投影写所有关联 item |
| `scripts/engineering-drift.mjs` | 192 行。自己实现 `projectExpected({ references })`（任一 MERGED 优先 → 最新 OPEN → 最新 CLOSED）与 `newestFirst`，并 import `stateForSnapshot` 做投影 |
| `scripts/check-engineering-drift-live.mjs` | 254 行。只负责取数与 CLI 接线；`paginate` 在超过 `MAX_PAGES` 时 fail closed |
| `tests/contract/engineering-state.test.js` | 388 行。覆盖投影、字段契约、mutation ack、signal 与两个 workflow 的结构 |
| `tests/contract/engineering-drift.test.js` | 382 行。覆盖三条选择规则、未被引用条目跳过、分页截断、传输与结构故障表 |
| `docs/development/ci.md` | 第 30 行写着「**投影是共享的，选择策略不是**……选择策略是观察者独有的」，并点名 issue #115 |
| `docs/product/board-semantics.md` | §2.1 是 `Engineering` 投影与 fail-closed 约束的权威表述；只描述了单快照投影，没有写「谁决定取值」 |
| `docs/project-management/merge-queue.md` | §4.4 记录关闭引用在栈上的两次相反实测；§7 记录「关闭引用一旦登记，就不会随正文编辑撤回」 |

### 缺陷的完整形状

写入口与观察者的分歧**只在「同一 issue 有多个引用 PR」时出现**，且方向是写入口把已交付的工作读回未合并：

1. issue #N 的 `Engineering = Merged`，由已合并的 PR #A 关闭；
2. 新开一个非 draft 的 PR #B，正文写 `Closes #N`；
3. 观察者：`expectedFor({ references: [A, B] })` → `Merged`；
4. 写入口：#B 的任意生命周期事件 → `stateForSnapshot(snapshotOf(B))` → `PR open`，写进看板。

第 4 步写下去之后，第 3 步的期望就与看板不符，而 #A 是终态、不会再发事件，所以这条红**没有事件能清掉**。issue #115 的「How to reproduce」就是这四步；2026-09-22 实测当时还没有 issue 同时被两个 PR 引用，所以它是潜在缺陷而非正在发生的故障。

### 上游依据与批次上下文

`docs/exec-plan/active/2026-09-22-engineering-merged-state.md` 的「遗留问题与技术债务」第 1 条与「评审响应」表第 1 行把本层登记为 follow-up（issue #115）：观察者报得对、写入口写得错，所以不能反过来把观察者改窄。本计划是那次登记的执行层。

本次交付属于 **MVP-1 三交付批次**（2026-09-24 起，五个 PR / 三个交付），批次队列写在 `docs/project-management/merge-queue.md` §4.7，本层是位置 1：它的红是「别人造成的红」那一类——先合并它，后续各层的 advisory 红才不会被误读。批次内另有两条在飞栈（#121 → #122 → #157，另一条独立栈），与本层在 `docs/README.md` 的 Active ExecPlan 索引表上必然冲突。

### 已实测的平台事实（2026-09-24，只读 GraphQL，`gh` 凭据）

- `Issue.closedByPullRequestsReferences` 的 schema 自述是 **"List of open pull requests referenced from this issue"**，参数 `includeClosedPrs` 默认值是 **`false`**，描述是 "Include closed PRs in results"。
- 但同一字段在 issue #110 上**不带**该参数时也返回了已合并的 PR #111（`state=MERGED, merged=true, isDraft=false, createdAt=2026-09-22T06:33:41Z`）。schema 描述与实测行为不一致。
- 结论：**必须显式传 `includeClosedPrs: true`**，不依赖默认值——依赖它意味着「已合并的 PR 被静默过滤掉」，那正好是本 issue 的故障形态。该参数由契约测试钉在查询文本上。
- 登记完整性：在飞 PR 的 issue 侧登记齐全——#121 → issue #119、#122 → issue #27、#157 → issue #28、#111 → issue #110，四个都读到了对应引用。

## Design / Spec

### D1：选择策略搬进投影权威，只有一份实现

在 `scripts/sync-engineering-state.mjs` 的 `stateForSnapshot` 旁边新增导出：

```js
export function expectedFor({ references })
// → { value: 'Merged' | 'PR open' | 'Changes requested' | 'Approved' | null, prNumber, rule }
```

语义与现观察者**逐条一致**：

1. 任一 `state === 'MERGED'` → 取其中创建时间最新的那个的投影（取值必然是 `Merged`；选谁只影响回显的 PR 编号）；
2. 否则任一 `state === 'OPEN'` → 取创建时间最新的那个 open PR 的投影；
3. 否则 → 取创建时间最新的那个的投影（全部 CLOSED 且未合并，即清空）；
4. 创建时间相同时按 PR 编号降序兜底，保证排序确定、不依赖输入顺序；
5. **空集合是错误**，不是「清空」。

与现观察者的一处**有意增强**：`expectedFor` 对**每一个**引用 PR 校验快照（`state` 必须落在 `PR_STATES`、`reviewDecision` 必须在已知集合内、`merged` / `isDraft` 必须是布尔值、`number` 是正整数、`createdAt` 可解析）。原实现只投影被选中的那一个，于是「某个未被选中的引用带着未知 state」会掉进 `closed` 桶被当成未合并——那是一扇假绿的门。校验全部引用之后，「否则」这一桶与 CLOSED 精确重合。

`scripts/engineering-drift.mjs` 删掉自己的 `projectExpected`、`newestFirst` 与 `projectionFor`，改为 import `expectedFor`；`MAX_PAGES` / `PAGE_SIZE` 也搬进 `sync-engineering-state.mjs`（写入口现在也要分页读引用），`check-engineering-drift-live.mjs` 从那里 import。观察者从此没有自己的选择策略。

**放弃的方案：issue 的 option 2（写入口只做终态感知，不聚合）。** 它更小，但保留两份「哪个 PR 说了算」的实现，正是本 issue 要消灭的形态；而且它只能表达「不要覆盖 Merged」，表达不了「多个 open PR 时取最新」这类已经写在观察者里的语义。issue 正文也把 option 1 列为首选。

**放弃的方案：把观察者改窄成「只按触发 PR」。** 观察者报得对，写入口写得错；把观察者改窄会让漂移不可见（`2026-09-22-engineering-merged-state.md` 评审响应 [1] 已裁决）。

### D2：写路径改为聚合，读 issue 侧的全部关闭引用

写路径的新数据流：

```
触发 PR #B
  → PR.closingIssuesReferences（项目内 item）      ← 已有查询，保留
  → 对每个 issue：Issue.closedByPullRequestsReferences(first:100, includeClosedPrs:true, after:$cursor)
  → expectedFor({ references })                   ← 共享策略
  → setEngineeringState(value) / CLEAR
  → writeEngineeringState（mutation ack 边界不变）
```

每个 issue 的引用列表**逐页读完**，`hasNextPage` 为真时继续，超过 `MAX_PAGES`（5 页 × 100 条）就抛错。

**触发 PR 自己的快照不再单独读取。** 原 `loadPullRequestSnapshot` 同时返回 `snapshot` 与 `items`；新写路径的判定输入只有「该 issue 的完整引用集合」，触发 PR 的快照在 issue 侧读里同样被读到并被 `expectedFor` 校验，所以函数改名为 `loadTriggerPullRequest`，只返回 `{ items }`。理由：留一个**读取但从不参与判定**的第二份快照，会让人误以为它仍然决定取值——那正是本 issue 的成因（「哪个 PR 说了算」有两处答案）。

**触发 PR 必须出现在该 issue 的引用集合里。** 写之前显式断言，不满足就抛错。它挡住的是「引用登记尚未完成 / 读取到的集合不完整」这一整类输入：集合里缺了触发 PR 时，剩下的引用可能给出一个**看起来合法**的取值（例如清空），而那正是「退回只按触发 PR 写」的镜像错误。代价是登记滞后会把一次 advisory 运行变红；下一次 PR 事件会重试，而错误的写入没有重试。

> **Superseded by**（2026-09-23，第二轮 MMP 评审）：「下一次 PR 事件会重试」已被实测证伪——`concurrency: group: engineering-state-reconcile` 会丢弃同组排队中的事件（见 `Surprises & Discoveries` 最后一条；2026-09-23 当天 165 次运行中 45 次 `cancelled`）。断言本身保留，理由改为：抛错时旧值留在原处、本次运行立刻变红，照写则错值进库、要等次日观察者才报出；补救靠观察者 + 补救入口，而不是下一次事件。

### D3：fail closed 清单（一条都不许退回「只按触发 PR 写」）

| 输入 | 处置 |
|---|---|
| `repository` / `issue` 为 null | 抛错 |
| `closedByPullRequestsReferences` 不是对象、`nodes` 不是数组、`totalCount` 不是非负整数 | 抛错 |
| `nodes.length !== totalCount` 且 `hasNextPage` 为假 | 抛错（截断） |
| `hasNextPage` 为真但 `endCursor` 不是非空字符串 | 抛错 |
| 超过 `MAX_PAGES` 页 | 抛错（拒绝在截断输入上判定） |
| 引用节点缺 `number` / `createdAt`，或 `createdAt` 不可解析 | 抛错 |
| 引用的 `state` / `reviewDecision` 未知、`merged` / `isDraft` 不是布尔 | 抛错（`expectedFor` 内逐条校验） |
| 引用集合为空 | 抛错（空集合不是「清空」） |
| 引用集合里没有触发 PR | 抛错（引用读取可能不完整） |
| 查询文本缺 `includeClosedPrs: true` | 契约测试钉住（见 D4） |

### D4：判别性证据

1. **单元级复现 issue 的四步**：`main` 在 merged #A + 后开的非 draft #B 上必须写 `Merged`（mutation 的 `optionId` 是 `Merged` 那一项），不是 `PR open`。实现前先看到它红。
2. **反向变异**：把共享策略改成「取创建时间最新的 PR，不看 merged」后，上面那条用例必须变红；记录红 / 绿两次实测输出，然后还原。
3. **观察者与写入口一致**：同一组引用输入上，写入口写下的取值等于观察者的期望（观察者对「写入口刚写下的值」报 0 条 finding）。
4. **查询形状**：issue 侧查询必须带 `includeClosedPrs: true`，且**不请求 `body`**——关闭引用是登记事实，不是正文的函数（`merge-queue.md` §7 实测：登记后改正文不会撤回）。

### 不变量（本计划必须保持）

- `Status` 不被本计划的任何一步写入。
- `Engineering` 取值只经 `setEngineeringState` 构造，写入前经 `constructedSets` 校验（`clear` 用模块私有的 `CLEAR` 单例）。
- 单快照投影只有一个实现：`stateForSnapshot`，语义逐条不变。
- 选择策略只有一个实现：`expectedFor`，在 `sync-engineering-state.mjs` 里。
- 未知枚举 fail closed，不猜测；离线检查（`pnpm verify`）不新增网络或凭据依赖。
- mutation ack 边界不变：`clientMutationId` 仍是 `<RECONCILE_ID>:<itemId>`。

## Global Constraints

- 改动文件集合（只此一次声明）：`scripts/sync-engineering-state.mjs`、`scripts/engineering-drift.mjs`、`scripts/check-engineering-drift-live.mjs`、`tests/contract/engineering-state.test.js`、`tests/contract/engineering-drift.test.js`、`docs/exec-plan/completed/2026-09-24-engineering-writer-terminal.md`（本文件；归档前位于 `docs/exec-plan/active/`）、`docs/README.md`、`docs/development/ci.md`、`docs/product/board-semantics.md`、`docs/project-management/merge-queue.md`。
- 代码变更 ≤ 1000 行、文档变更 ≤ 1500 行（按 `origin/main` 度量，`node scripts/rule-checks.mjs size origin/main`）。
- 不新增第三方依赖；不改 `pnpm-lock.yaml`；不改 `packages/capabilities`；不改 `tests/contract/suites/*`；不 push `main`；不自行合并；不把 PR 转 ready。
- 沙箱下所有 pnpm 命令带前缀 `npm_config_manage_package_manager_versions=false`；不改 `.npmrc` / `package.json` 去绕它。
- 文档正文中文；代码标识符、路径、命令英文；**不写本机绝对路径**，也不写隔离工作区的路径。
- 提交格式 `<type>(<scope>): <中文摘要>`，正文说明为什么，末尾 `Closes #115`；公开面执行 `docs/development/publication.md` 的机械扫描与五类目人工检查。

## Plan of Work

### Batch 1 · 把选择策略搬进投影权威

**最小闭环**：`expectedFor` 在 `sync-engineering-state.mjs` 里可用且语义与旧观察者逐条一致，`engineering-drift.mjs` 不再有自己的实现，两个契约测试全绿。

**涉及文件**：`scripts/sync-engineering-state.mjs`、`scripts/engineering-drift.mjs`、`scripts/check-engineering-drift-live.mjs`、`tests/contract/engineering-drift.test.js`

**步骤**

1. 在 `stateForSnapshot` 之后新增 `MAX_PAGES` / `PAGE_SIZE`、`newestFirst`、`projectionFor`、`expectedFor`（含逐引用快照校验）。
2. `engineering-drift.mjs` 删掉 `projectExpected` / `newestFirst` / `projectionFor` / 两个分页常量，改为 import `expectedFor`、`MAX_PAGES`、`PAGE_SIZE`；`engineeringDriftFindings` 改调 `expectedFor`。
3. `check-engineering-drift-live.mjs` 从 `sync-engineering-state.mjs` import 两个分页常量。
4. 契约测试把 `projectExpected` 的调用点换成从 `sync-engineering-state.mjs` import 的 `expectedFor`，并把「监测复用唯一投影」的源码断言改成新 import 行 + 不含自有策略。

**验证**

```bash
node --test tests/contract/engineering-state.test.js tests/contract/engineering-drift.test.js
# 期望：fail 0
```

**回滚点**：`git revert` 本批提交；两个脚本与测试同时回退，无外部写入。

### Batch 2 · 写路径改为聚合 + fail closed

**最小闭环**：`main` 在「merged #A + 后开的 open #B」上写 `Merged`；引用读取的任何不完整都抛错。

**涉及文件**：`scripts/sync-engineering-state.mjs`、`tests/contract/engineering-state.test.js`

**步骤**

1. `loadPullRequestSnapshot` → `loadTriggerPullRequest`（只返回 `{ items }`，fail-closed 校验不变）。
2. 新增 `loadClosingPullRequests({ gql, owner, repo, issueNumber })`：分页读 `closedByPullRequestsReferences`，`includeClosedPrs: true`，逐条规范化 `{ number, state, merged, isDraft, reviewDecision, createdAt }`。
3. `main` 改为：取 items → 对每个 issue 读全部关闭引用 → 断言触发 PR 在集合里 → `expectedFor` → `setEngineeringState` / `CLEAR` → 写入；notice 行带上依据的 PR 编号与规则。
4. 契约测试覆盖 D3 的每一条 fail-closed 输入、查询形状（`includeClosedPrs: true`、无 `body`）、每 issue 独立取值。

**验证**

```bash
node --test tests/contract/engineering-state.test.js
# 期望：fail 0，且含「写入口在 merged A + 后开 open B 上必须写 Merged」
```

**回滚点**：`git revert` 本批提交。写路径回退到「只按触发 PR 写」，看板取值可能再次漂移，但那由观察者报出；本批不执行任何真实外部写入。

### Batch 3 · 判别性证据：反向变异与一致性断言

**最小闭环**：把共享策略改坏成「取最新 PR」时对应用例变红；观察者与写入口对同一输入结论一致。

**涉及文件**：`tests/contract/engineering-drift.test.js`、本计划（记录两次实测）

**步骤**

1. 在 `engineering-drift.test.js` 新增一致性用例：写入口写下的取值 = 观察者期望，且观察者对写下值报 0 条 finding。
2. 执行反向变异：把 `expectedFor` 改成「不看 merged、直接取最新」→ 跑测试 → 记录红；还原 → 再跑 → 记录绿。
3. 把两次实测输出写进本计划的 `Surprises & Discoveries` 与 `Progress`。

**验证**

```bash
node --test tests/contract/engineering-state.test.js tests/contract/engineering-drift.test.js
# 变异前：fail 0；变异后：至少「终态」「写入口必须写 Merged」「一致性」三条变红
```

**回滚点**：变异只存在于工作区，还原后 `git diff` 为空即回到绿。

### Batch 4 · 文档订正与批次队列

**最小闭环**：仓库文档不再声称「选择策略是观察者独有的」，且批次队列表落进 `merge-queue.md`。

**涉及文件**：`docs/development/ci.md`、`docs/product/board-semantics.md`、`docs/project-management/merge-queue.md`、`docs/README.md`、本计划

**步骤**

1. `ci.md` §「Board invariants 的第二个 job」：判定规则的落点改成投影权威；旧表述**就地标注**为已被本层取代，保留它作为缺口的证据。
2. `board-semantics.md` §2.1：补「谁决定取值」——写入口与观察者共用 `expectedFor`，写入口聚合 issue 侧全部关闭引用并 fail closed。
3. `merge-queue.md` 追加 `### 4.7 MVP-1 三交付批次队列（2026-09-24 起）`：五个 PR 的位置 / 分支 / 交付 / 依赖 / 已知冲突点，含在飞栈 #121 / #122 / #157 与索引表冲突的解法。
4. `docs/README.md` Active 索引表插入本计划一行。

**验证**

```bash
node scripts/rule-checks.mjs disclosure origin/main   # 期望 exit 0
node scripts/rule-checks.mjs size origin/main         # 期望 文档 ≤1500、代码 ≤1000，exit 0
git diff --check origin/main...HEAD                   # 期望无输出
```

**回滚点**：`git revert` 文档提交；文档改动不影响运行时行为。

### Batch 5 · 提交整理、验证与 PR 回读

**最小闭环**：最终 head 上全部验证通过，PR 描述含真实输出，远端回读的 head / base / checks / closing 与描述一致。

**涉及文件**：无新增（提交整理与 PR 描述）

**步骤**

1. 收敛提交序列（计划 / 实现 / 文档 / 记录），不留 debug 与 fixup。
2. 跑 `pnpm verify`、两个契约测试、`rule-checks size` / `disclosure`、`git diff --check`，把**真实输出**写进 PR 描述。
3. push 后回读 `gh pr view <n> --json number,url,baseRefName,headRefOid,isDraft,labels,milestone,closingIssuesReferences` 与 `gh issue view 115 --json closedByPullRequestsReferences`。

**验证**

```bash
export npm_config_manage_package_manager_versions=false
pnpm verify
node --test tests/contract/engineering-state.test.js tests/contract/engineering-drift.test.js
node scripts/rule-checks.mjs size origin/main
node scripts/rule-checks.mjs disclosure origin/main
git diff --check origin/main...HEAD
```

**回滚点**：分支已推送时先建 backup ref，再用精确 old-head lease 的 force-with-lease；不 `--force`。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 选择策略只有一份实现 | `grep -rn "projectExpected" scripts/ tests/` 只在观察者的**反向断言**里命中；`grep -rn "export function expectedFor" scripts/` 只有 `sync-engineering-state.mjs` 一处 | 通过 |
| 2 | 写入口在 merged #A + 后开 open #B 上写 `Merged` | `node --test tests/contract/engineering-state.test.js` 中该用例通过（写下的 `optionId` 是 `Merged`） | 通过 |
| 3 | 反向变异让该用例变红 | 变异后 9 条 fail（含该用例，`actual 'PR open' / expected 'Merged'`）；还原后 94 pass / 0 fail | 通过 |
| 4 | 观察者与写入口对同一输入一致 | 一致性用例：写入口写下的值交给观察者，`checked=1`、`findings=[]` | 通过 |
| 5 | 引用读取不完整 fail closed | `关闭引用读取的任何不完整都 fail closed` 11 条子用例 + 超上限用例，全部 `assert.rejects` | 通过 |
| 6 | 空集合是错误而不是清空 | 空集合用例抛 `/至少一个引用 PR/`，且 `mutations` 为空 | 通过 |
| 7 | `includeClosedPrs: true` 被钉住 | 查询文本断言；去掉该参数后该用例变红（1 条 fail） | 通过 |
| 8 | `stateForSnapshot` 语义不变 | 投影用例逐条未改，全部通过 | 通过 |
| 9 | `Status` 未被改动 | 两个脚本里 `Status` 只出现在结尾那行日志；diff 不含任何 `Status` 写入路径 | 通过 |
| 10 | 离线检查无网络 / 无凭据 | `pnpm verify` exit 0 且 `ℹ fail 0`（contract + integration + e2e 与 mvp0 两段；条数随 head 变化，以复跑为准——第二轮评审时的 head `300e2a3` 上是 472 / 472 与 7 / 7） | 通过 |
| 11 | 体量与发布面合规 | `node scripts/rule-checks.mjs size origin/main` exit 0（代码 ≤ 1000、文档 ≤ 1500）；`disclosure origin/main` exit 0；`git diff --check origin/main...HEAD` 无输出。**本行不写行数**：数字写进被度量的文件会在每次回填时自我过期（第一轮 P3-1 与第二轮 P3-5 是同一缺陷的两次复发），最终 head 的实测数字只写在 PR 描述「验证证据」里 | 通过 |
| 12 | issue 关联 | PR 侧 `closingIssuesReferences = [115]`，issue 侧 `closedByPullRequestsReferences = [159]` | 通过 |

## Progress

- [x] (2026-09-24) 建隔离工作区与分支 `fix/engineering-merged-terminal`（base `origin/main` = `4d46559`）
- [x] (2026-09-24) 只读核实平台事实：`Issue.closedByPullRequestsReferences` 的 schema 自述与实测行为不一致（见 Surprises）；在飞 PR 的 issue 侧登记齐全（#121 → #119、#122 → #27、#157 → #28、#111 → #110）
- [x] (2026-09-24) Batch 1 · 选择策略搬进投影权威（`expectedFor` 落在 `stateForSnapshot` 旁；观察者删除自有实现改为 import）
- [x] (2026-09-24) Batch 2 · 写路径改为聚合 + fail closed（`loadTriggerPullRequest` + `loadClosingPullRequests` + 逐 issue 取值）
- [x] (2026-09-24) Batch 3 · 反向变异与一致性断言：先红（写入口写 `PR open`、观察者期望 `Merged`，2 条 fail）→ 绿（94 pass / 0 fail）→ 变异（策略改成「最新 PR」）9 条变红 → 还原后 94 pass / 0 fail
- [x] (2026-09-24) Batch 4 · 文档订正与批次队列（`ci.md` 旧表述就地标注 Superseded、`board-semantics.md` §2.1 补选择策略、`merge-queue.md` §4.7、`docs/README.md` 索引行）
- [x] (2026-09-24) Batch 5 · 验证与提交整理（`pnpm verify` exit 0、`ℹ fail 0`；`rule-checks size` exit 0；`disclosure` exit 0；`git diff --check` 无输出；PR #159 回读 closing 非空）
- [x] (2026-09-24) 评审响应 · 对抗验证的 3 条 P3（体量数字钉 head、board-semantics 旧表述就地标注、数组守卫补判别性用例）
- [x] (2026-09-23) 评审响应 · 第一轮人工评审 4 条（根因组 A–C，见 Outcomes）
- [x] (2026-09-23) 评审响应 · 第二轮 MMP 评审（无 P0 / P1；机械可修的 P2 / P3 就地修复，其余登记 #176 / #177），本计划归档
- [ ] 合并后回读真实 `pull_request_target` 运行（见 Outcomes「合并后的回读对象是具体的」）——只能在合并之后完成，归档文件无法再携带它；结果以合并后发在 PR #159 上的回读评论为准

## Surprises & Discoveries

- **(2026-09-24) `Issue.closedByPullRequestsReferences` 的 schema 描述与实测行为不一致。** schema introspection（`__type(name:"Issue")` 的字段自述与参数默认值）给出：字段描述是 **"List of open pull requests referenced from this issue"**，`includeClosedPrs` 的 `defaultValue` 是 **`"false"`**、描述是 "Include closed PRs in results"；但 issue #110 上**不带**该参数时也返回了已合并的 PR #111（`state=MERGED, merged=true, isDraft=false, createdAt=2026-09-22T06:33:41Z`）。结论不是「默认值可用」，而是**不能依赖默认值**：一旦平台侧按描述收敛，写入口就会漏掉已合并 PR 并算错取值，而那正是本 issue 的故障形态。因此显式传 `includeClosedPrs: true`，并由契约测试钉住查询文本。
- **(2026-09-24) 反向变异同时打红两侧，这本身就是「只有一份实现」的证据。** 把 `expectedFor` 改成「不看 merged、直接取创建时间最新的 PR」之后，两个契约测试文件共 **9 条**变红：观察者侧的「已合并 PR 的 issue 期望 Merged」「已合并是终态且单调」「多条已合并 PR」「最新 open」「全部 closed」5 条，写入口侧的「merged #A + 后开 #B 必须写 Merged」「每个条目按自己的集合取值」「全部关闭写 clear」「三条规则与编号兜底」4 条。变异前两份文件是 94 pass / 0 fail，还原后仍是 94 pass / 0 fail。若策略还是两份实现，这个变异只会打红其中一侧。
- **(2026-09-24) 有一条守卫没有可失败的断言——是评审的变异实验发现的。** `loadClosingPullRequests` 的 `Array.isArray(connection)` 守卫在我自己的 D3 表里被列为必须抛错的输入，但用例只覆盖了「字段为 null」与「nodes 不是数组」；把守卫删掉后整套用例仍然全绿。补了「字段是数组 → 必须抛 `缺少 closedByPullRequestsReferences`」之后，删守卫会让它变红（错误文案落到下一条守卫的 `nodes 必须是数组`）。**教训：守卫与用例要按「删掉它会不会有断言变红」逐条对齐，而不是按输入类别对齐。**
- **(2026-09-24) 额外发现分页布尔字段的假绿。** `pageInfo.hasNextPage` 只用 `!== true` 判断，字符串 `"false"` 会被当成正常结束并返回部分引用；用最小注入实测 `loadClosingPullRequests` 错误地输出 `BUG returned 1`。补充布尔类型守卫和契约用例后，相关测试为 **95 pass / 0 fail**，字符串形态现在 fail closed。
- **(2026-09-24) 「先算策略还是先断言触发 PR 在集合里」会改变空集合的错误文案。** `main` 里先断言会让空集合报「关闭引用里没有触发 PR #200」，先算策略才报「空集合不是清空」。选了后者：每条错误对应它自己的原因，策略域的错误由策略报，读取完整性的错误由断言报；两条路径都不写任何东西（用例同时断言 `mutations` 为空）。
- **(2026-09-24) 触发 PR 的查询里不再需要它自己的快照字段。** 计划阶段先写用例、后改实现时发现：`loadPullRequestSnapshot` 返回的 `snapshot` 在新写路径里没有任何消费者。删掉它同时删掉了查询里的 `state merged isDraft reviewDecision`，触发 PR 只用来解析 `closingIssuesReferences`——判定输入因此只剩「该 issue 的完整引用集合」这一处。
- **(2026-09-23，评审带来) 「下一次 PR 事件会重试」是错的：事件本身会被并发组丢掉。** `engineering-state.yml` 的 `concurrency: group: engineering-state-reconcile`（`cancel-in-progress: false`）只保留同组最新的一次待运行。实测：2026-09-23 三个 `ready_for_review` 在 8 秒内到达（09:24:25/27/30Z），对应的 run `35842748362` / `35842751381` / `35842756820` **全部 `cancelled`**，于是 #125 / #137 / #139 的字段停在它们还是 draft 时写下的 `cleared`（`rule=open` 三条漂移）。**系统级结论**：本仓库任何「失败会被下一次事件重试」的风险论据都不成立，除非先证明事件不会被丢弃；写路径的失败面必须按「可能无限期停在错误取值上」评估，并配一个可执行的补救入口（本计划的补救入口见上面「评审响应（2026-09-23，根因修复）」根因组 B）。现场已由主控用该入口修回真值，2026-09-23T10:12Z 复跑观察者为 `findings:[]`。
  > **Superseded by**（2026-09-23，第二轮 MMP 评审）：「由主控用该入口修回」与 CI 日志矛盾。三条漂移在第一轮评审意见发出（09:43:18Z）**之前**就被 `workflow_run`（review 事件）触发的 reconcile 修正：run `35844174428`（09:38:57Z，`confirmed #139: Engineering=PR open`）、`35844271716`（09:39:59Z，`#137`）、`35844405970`（09:41:19Z，`#125`）。10:12Z 的 `findings:[]` 属实，但修正它的是一次碰巧到来的 review 事件，不是补救入口——补救入口**未经实地验证**。

## Decision Log

- **Decision**：取 issue #115 的 **option 1**——把选择策略搬进投影权威（`sync-engineering-state.mjs` 的 `expectedFor`），写入口聚合 issue 侧的全部关闭引用。
  **Rationale**：option 2（写入口只做终态感知）更小，但保留两份「哪个 PR 说了算」的实现，正是本 issue 要消灭的形态；option 1 让两侧**由构造一致**，并让 `ci.md` 的「投影共享」这句话对新事实也成立。
  **Date/Author**：2026-09-24 / agent
- **Decision**：`expectedFor` 校验**每一个**引用 PR 的快照，而不是只校验被选中的那一个。
  **Rationale**：原实现里「未被选中的引用带未知 state」会掉进 `closed` 桶被当成未合并，是一扇假绿的门；校验全部引用后，「否则」这一桶与 CLOSED 精确重合。
  **Date/Author**：2026-09-24 / agent
- **Decision**：写入口不再单独读取触发 PR 的快照，`loadPullRequestSnapshot` 改名 `loadTriggerPullRequest` 且只返回 `{ items }`。
  **Rationale**：判定输入只有「该 issue 的完整引用集合」；留一个读取但不参与判定的第二份快照，会让人以为它仍决定取值。触发 PR 的快照在 issue 侧读里同样被读到并被 `expectedFor` 校验，没有丢失 fail-closed 覆盖。
  **Date/Author**：2026-09-24 / agent
- **Decision**：显式传 `includeClosedPrs: true`，并用契约测试钉住。
  **Rationale**：见 Surprises；依赖默认值等于把「已合并 PR 被静默过滤」这一故障形态留在代码里。
  **Date/Author**：2026-09-24 / agent
- **Decision**：断言触发 PR 出现在该 issue 的引用集合里，否则抛错。
  **Rationale**：缺了触发 PR 的集合可能给出一个看起来合法的取值（例如清空），那是「退回只按触发 PR 写」的镜像错误。代价是登记滞后会把一次 advisory 运行变红，下一次 PR 事件会重试；错误的写入没有重试。这是**超出 issue 正文的一处加强**，见 Outcomes 的「与 issue 的偏差」。
  **Date/Author**：2026-09-24 / agent
  > **Superseded by**（2026-09-23，第二轮 MMP 评审）：Rationale 里「下一次 PR 事件会重试」不成立，见 D2 下方同日标注；决定本身不变。
- **Decision**：不把触发 PR 与 issue 侧引用集合做并集，空集合一律抛错。
  **Rationale**：issue #115 明确要求「不得退回只按触发 PR 写」；并集在空集合时恰好退化成那条被禁止的路径。
  **Date/Author**：2026-09-24 / agent
- **Decision**：`main` 里的顺序是「先 `expectedFor`，再断言触发 PR 在场」。
  **Rationale**：让空集合的错误由策略报（「空集合不是清空」），读取完整性的错误由断言报；两条路径都在任何 mutation 之前。
  **Date/Author**：2026-09-24 / agent
- **Decision**：批次队列表写进 `docs/project-management/merge-queue.md` **§4.7**，分支用实际名 `fix/engineering-merged-terminal`。
  **Rationale**：§4.5 / §4.6 已被另一条在飞栈占用（#157 所在分支），两边合并时按编号各自保留；批次控制输入的表里写的分支名是 `fix/engineering-merged-state`，实际建出的分支是 `fix/engineering-merged-terminal`，以实际分支为准并在此记录。
  **Date/Author**：2026-09-24 / agent

## Idempotence and Recovery

- 代码与测试改动可任意重跑：`node --test` 无副作用；`expectedFor` 是纯函数。
- 写路径的幂等性不变：`clientMutationId = <RECONCILE_ID>:<itemId>`，重放把同一个值写成同一个值。
- 反向变异只存在于工作区，还原后 `git diff -- scripts/sync-engineering-state.mjs` 为空即回到绿。
- 失败后回到已知良好状态：`git revert` 本 PR 的提交即可回到「写入口只按触发 PR 写」的旧状态；本计划不执行任何真实看板写入，因此没有需要复原的外部状态。
- 不 `push --force`（除非评审要求且已建 backup ref）；不删除 worktree；不改分支保护。

## Interfaces and Dependencies

- **GitHub GraphQL**：`PullRequest.closingIssuesReferences`、`ProjectV2Item.project`、`Issue.closedByPullRequestsReferences(includeClosedPrs:)`、`PullRequestState` / `PullRequestReviewDecision`、`PullRequest.merged` / `isDraft` / `createdAt`。
- **凭据**：写入口沿用既有 `secrets.PROJECTS_TOKEN` 与 `vars.PROJECTS_ENGINEERING_FIELD_ID`，不新增凭据；本地只读核实用 `gh` 现有凭据。
- **命名契约**：`Engineering` 字段名与四个取值由 `resolveProjectField` 运行时校验，不可改；`expectedFor` 是选择策略的唯一入口名。
- **不新增**：workflow、依赖、secret、分支保护设置、`Status` 写入路径。

## Outcomes & Retrospective

### 实际结果

交付 PR：[#159](https://github.com/SingularityKChen/harness-projects/pull/159)（base `main`，`Closes #115`）。第二轮 MMP 评审后，提交按可独立回滚的交付物收敛为四个：写入口与观察者共用选择策略（代码、测试与描述它的 `ci.md` / `board-semantics.md`）→ 批次队列 §4.7 → 本计划（归档）→ 跨 PR 评审记录。收敛前的 13 个提交保存在恢复锚点 `backup/w10-d1-pre-review3`（`300e2a3`）。

**判别性证据：先红后绿（在检出 `fix/engineering-merged-terminal` 的工作树根目录运行）**

红（实现之前，只加了用例）：

```text
$ node --test tests/contract/engineering-state.test.js
ℹ tests 23 / ℹ pass 21 / ℹ fail 2
✖ 写入口在 merged #A + 后开的非 draft #B 上必须写 Merged，而不是 PR open
    AssertionError: Expected values to be strictly equal:
    + actual - expected
    + 'PR open'
    - 'Merged'
✖ 观察者与写入口对同一输入给出一致结论
    actual: [ { issue: 34, itemId: 'item-34', expected: 'Merged', actual: 'PR open', prNumber: 150, rule: 'merged' } ]
    expected: []
```

绿（实现之后）：

```text
$ node --test tests/contract/engineering-state.test.js tests/contract/engineering-drift.test.js
ℹ tests 93 / ℹ pass 93 / ℹ fail 0
```

**反向变异（把共享策略改坏成「取最新 PR」）**

```text
$ # 变异：expectedFor 不再看 merged / open，直接 pick 创建时间最新的那个
$ node --test tests/contract/engineering-state.test.js tests/contract/engineering-drift.test.js
ℹ pass 84 / ℹ fail 9
✖ 已合并 PR 的 issue 期望 Merged —— 2026-09-22 故障的形状
✖ 已合并是终态且单调：有已合并 PR 时不看 open PR
✖ 多条已合并 PR 引用同一 issue 时取创建时间最新的，取值恒为 Merged
✖ 没有已合并 PR 时取创建时间最新的 open PR，投影交给 stateForSnapshot
✖ 全部 closed 且未合并时期望为空；草稿 open PR 同样期望为空
✖ 写入口在 merged #A + 后开的非 draft #B 上必须写 Merged，而不是 PR open（actual 'PR open' / expected 'Merged'）
✖ 一次 reconcile 里每个条目按自己的关闭引用集合取值
✖ 全部关闭且未合并的引用集合写 clear，不是写 PR open
✖ expectedFor 的三条规则与编号兜底
$ # 还原后
$ node --test tests/contract/engineering-state.test.js tests/contract/engineering-drift.test.js
ℹ pass 93 / ℹ fail 0
```

**另一处变异（去掉 `includeClosedPrs: true`）**：`关闭引用逐页读完，查询显式要求 includeClosedPrs 且不读正文` 1 条变红，其余 42 条仍绿；还原后 43 / 0。

**全量验证（head `c62213c`，即评审修复提交之后、本文件回填之前）**

```text
$ export npm_config_manage_package_manager_versions=false && pnpm verify
ℹ tests 470 / ℹ pass 470 / ℹ fail 0        # contract + integration + e2e
ℹ tests 7 / ℹ pass 7 / ℹ fail 0            # tests/mvp0
exit=0

$ node scripts/rule-checks.mjs size origin/main
代码：712 / 1000 行（增删之和）
文档：512 / 1500 行（增删之和）
exit=0

$ node scripts/rule-checks.mjs disclosure origin/main
机械扫描通过（对 base 的新增行、每个提交的新增行、提交信息）— 未命中任何已知模式
exit=0

$ git diff --check origin/main...HEAD     # 无输出
$ node scripts/workflow-check.mjs          # no findings（已检查 8 个文件）
```

（`pnpm verify` 的 446 → 470 是本层新增的 24 条用例；上面的数字钉在 head `c62213c` 上，重算命令就是这一段。本文件的回填只增加文档行数，因此**验收表第 11 行**给的是「包含本行的 head」上的数字，两者的关系是：文档数 = 512 + 本次回填新增的行数。）

**真实看板上的只读读数（head `3ec3e27`，2026-09-24）**

```text
$ PROJECTS_TOKEN="$(gh auth token)" PROJECT_OWNER=SingularityKChen PROJECT_NUMBER=10 \
    GITHUB_REPOSITORY=SingularityKChen/harness-projects node scripts/check-engineering-drift-live.mjs --json
{"findings":[],"skipped":42,"checked":38,"pullRequests":57,"items":80}
exit=0
```

观察者用**新的共享策略**在真实数据上跑通：80 个看板条目、57 个 PR、38 个条目参与比较、0 条漂移。这条同时说明「选择策略搬家」没有改变观察者在真实输入上的结论。

**合并后的回读对象是具体的**：issue #115 已在看板上（project 10 的 item `PVTI_lAHOAY1ahM4BjzAQzg8Q4sk`），而它当前的关闭引用就是本 PR（#159，draft）。合并之后，默认分支上的新代码会对 #115 走一次完整的新路径——`#159` 的 `closingIssuesReferences` → `#115` 的全部关闭引用 → `expectedFor`（draft → 清空）→ 写入；回读方式是 `gh run list --workflow=engineering-state.yml` 加该次运行的 `::notice::confirmed #115` 行。

> **Superseded by**（2026-09-23，第二轮 MMP 评审）：上一段的期望写错了三处——合并后 #159 是 `MERGED`，`expectedFor` 应给出 `Merged`（规则 `merged`），不是"draft → 清空"；`gh run view --log` 把 `::notice::` 渲染成 `##[notice]`，照字面 grep 会漏；命令缺 `-R`。改为：
>
> ```bash
> gh run list -R SingularityKChen/harness-projects --workflow=engineering-state.yml --event pull_request_target --limit 5 --json databaseId,conclusion,createdAt,headBranch
> gh run view <id> -R SingularityKChen/harness-projects --log | grep -E 'PR_NUMBER|##\[notice\]confirmed|Status 未被改动'
> ```
>
> 期望：`PR_NUMBER: 159`；`##[notice]confirmed #115: Engineering=Merged; 依据 PR #159（规则 merged）`（"依据 PR"片段只有新代码会打印，是"跑的是新代码"的判别证据）；`Status 未被改动——规划状态与工程执行状态保持正交。`。若该次运行 `cancelled`，#115 会停在旧值，走补救入口并按 `AGENTS.md` §7 记录 actor / 目标 / 幂等键 / 结果。

**PR 与 issue 关联回读**

```text
$ gh pr view 159 --json number,url,baseRefName,headRefOid,isDraft,labels,milestone,closingIssuesReferences
{"base":"main","closing":[115],"draft":true,"head":"4073e44…","labels":["kind:fix","area:development","area:ci"],
 "milestone":"M0.1 · Delivery control follow-up","number":159,"url":"https://github.com/SingularityKChen/harness-projects/pull/159"}
$ gh issue view 115 --json number,state,closedByPullRequestsReferences
{"closedBy":[159],"number":115,"state":"OPEN"}
```

### 评审响应（2026-09-24 对抗验证：3 × P3）

独立对抗验证（fresh agent）对 PR #159 的裁决是 `partially_falsified`——实质性声明全部经受住攻击（13 个 fail-closed 守卫逐个变异有 12 个断言变红、写入口确实调用共享策略、旧观察者策略与新共享策略 20000 组随机输入零差异、真实看板 38 个 issue 上两侧引用集合逐条相等），无 P0/P1/P2，三条 P3 逐条处置：

| # | 问题 | 处置 |
|---|---|---|
| 1 | 验收表第 11 行的体量数字取自中间 head `fd4d50b`，在受检 head 上不可复现 | 修。数字改为「包含本行的 head 上实测」，并在 Outcomes 里钉住跑它时的 head；凡是记录在案的实测数字都带 head |
| 2 | `board-semantics.md` §2.1 仍写着「判定与投影的纯函数实现在 `scripts/engineering-drift.mjs`」 | 修。按 `PLANS.md` §4 就地标注：原文保留，下面加 `Superseded by` 说明投影与选择策略的权威都在 `scripts/sync-engineering-state.mjs` |
| 3 | `Array.isArray(connection)` 守卫没有可失败的断言 | 修。补判别性用例并记录红 / 绿两次实测（删守卫 → 该用例变红；还原 → 44 pass / 0 fail） |

### 评审响应（2026-09-23，根因修复）

评审在 PR #159 上留了 4 条 inline 意见。逐条核实后的结论：**3 条属实**（其中 1 条是主控自己写错的机制断言）、**1 条的前提部分不成立但指向的缺口是真的**。按根因分三组修，另一条按评审自己的意见不在本 PR 修。

#### 根因组 A · 断言了未经确证的机制（P1，主控的错误）

- **评审意见**：`docs/project-management/merge-queue.md` §4.7 的「base 被 retarget 到栈内分支之后，该 PR 上不再出现 `Verify` 与 `PR Fast Gate`」与本文件既有的 L330 / L336 直接矛盾，并被仓库当前状态证伪。
- **是否属实**：**属实**。这是主控在窗口期测了一次就写死的结论——测到的是**栈登记进 GitHub stack 之前**的中间态。实测反例：PR #161（base `feat/local-git-worktree`，07:47:48Z retarget 后未变）的 head `2b900b36` 上有 success 的 `Verify（typecheck + 契约测试）`（09:33:49Z）与 `PR Fast Gate`（09:34:18Z），来自 CI run `35843669687`，该 run 的 `pull_requests[].base.ref` 就是 `feat/local-git-worktree`；PR #158 同样有 CI run `35843700676`（09:34:06Z，success）。两次 CI 都紧跟 `added_to_stack` 约 2 秒启动。
- **改法**：把该条改成实测能支撑、且与 L336 一致的口径——「栈内 PR 有没有 `CI` 结论取决于它有没有登记进 GitHub stack；判定永远读它当前的 checks，不要从 base 的名字推断」，附两个 run 号与 `pull_requests[].base.ref` 作为可复核证据，**不写机制**（「GitHub 按栈根求值 `branches:[main]`」这个因果未确证，写它就是重犯同一个错误）。同节 `- **#166**——…` 那一条的前提已被证伪，改为「issue 的重新界定由维护者处理，不要按原前提行动」。
- **实测证据**：`gh pr checks 161` 在 head `2b900b36` 上列出 `Verify` 与 `PR Fast Gate` 均为 pass；`gh api repos/SingularityKChen/harness-projects/actions/runs/35843669687 --jq '.pull_requests[].base.ref'` → `feat/local-git-worktree`。

#### 根因组 B · 风险论据被证伪（P2）

- **评审意见**：那条「触发 PR 必须在引用集合里」的硬断言，其风险论据「失败的 advisory 有下一次事件」被实测证伪；三个 `ready_for_review` 在 8 秒内到达、被 `concurrency` 组取消，字段停在 draft 时写下的 `cleared`。
- **是否属实**：**属实**。`.github/workflows/engineering-state.yml` 的 `concurrency: group: engineering-state-reconcile`（`cancel-in-progress: false`）只保留同组最新的一次待运行；2026-09-23 三个 `ready_for_review`（09:24:25/27/30Z）对应的 run `35842748362` / `35842751381` / `35842756820` 全部 `cancelled`。
- **改法**：**保留断言**（它是对的——缺了触发 PR 的集合可能给出一个看起来合法的取值），把风险表述改成实测事实：`scripts/sync-engineering-state.mjs` 的注释、上面「与 issue 的偏差」第 1 条、`Surprises & Discoveries` 与 PR 描述同步改写。
- **补救入口（生产路径本身，幂等）**：对漂移条目所属的 PR 跑一次
  `PROJECTS_TOKEN="$(gh auth token)" ENGINEERING_FIELD_ID=<字段 ID> GITHUB_REPOSITORY=SingularityKChen/harness-projects RECONCILE_ID=<唯一值> node scripts/sync-engineering-state.mjs <pr-number>`
  **回读期望**：该命令打印 `::notice::confirmed #<issue>: Engineering=<值>; 依据 PR #<n>（规则 <rule>）; item=<itemId>; mutation=<id>`，并以 `Status 未被改动——规划状态与工程执行状态保持正交。` 收尾；再跑
  `PROJECTS_TOKEN="$(gh auth token)" PROJECT_OWNER=SingularityKChen PROJECT_NUMBER=10 GITHUB_REPOSITORY=SingularityKChen/harness-projects node scripts/check-engineering-drift-live.mjs --json`
  期望该 issue 不再出现在 `findings` 里。这条路径与 `2026-09-22-engineering-merged-state.md` D4 的既有决定一致（回填走生产代码路径，不写一次性脚本）。
- **实测证据（现场状态）**：评审时受检 head 上有 3 条漂移（#125 / #137 / #139，`rule=open`）；**2026-09-23T10:12Z 复跑观察者，现场已被主控修回真值**：`{"findings":[],"skipped":43,"checked":39,"pullRequests":58,"items":82}`，exit 0。也就是说这条意见指出的失败面真实发生过、也真实被这次补救入口修掉了。
  > **Superseded by**（2026-09-23，第二轮 MMP 评审）：后半句不成立。CI 日志显示三条漂移在 09:38:57Z–09:41:19Z 已被 `workflow_run` 事件的 reconcile 修正（run `35844174428` / `35844271716` / `35844405970`），早于第一轮评审意见（09:43:18Z）；补救入口**未经实地验证**。首次实际使用时按 `AGENTS.md` §7 记录 actor、目标 item、`RECONCILE_ID`（幂等键）与输出；`ENGINEERING_FIELD_ID` 取自 `gh variable get PROJECTS_ENGINEERING_FIELD_ID -R SingularityKChen/harness-projects`。

#### 根因组 C · 守卫不再覆盖它声称的性质（P3）

- **评审意见**：`tests/contract/engineering-drift.test.js` 的 `fetch(` 源码扫描只扫观察者自身，而它现在 import 了写入口模块；**并称后者含有 `fetch(`（`createGraphQLClient` 的默认参数）**。
- **是否属实**：**指向的缺口属实，举的例子不成立**。实测 `grep -nE "fetch[[:space:]]*\\(" scripts/sync-engineering-state.mjs` → 无命中：`createGraphQLClient({ token, fetchImpl = fetch, api = API })` 是**引用**不是调用，调用点是 `fetchImpl(api, …)`，`/\bfetch\s*\(/` 不匹配。所以即便把扫描扩到该文件，今天也是绿的——**但这不改变评审的结论**：守卫的粒度确实只有观察者自己的文本，往 import 闭包里的任何模块加一个 `fetch(` 或 `child_process` 它都看不见。
- **改法**：把断言改成对 **import 闭包**生效——从 `scripts/engineering-drift.mjs` 出发递归跟随 `from './…'`，对闭包内每个模块断言「不 import 网络或子进程模块」且「不出现 `fetch(...)` 调用」；并断言闭包恰好是两个模块且含投影权威，防止它退化成「只有一个文件」的弱断言。
- **实测证据（判别性变异）**：往 `scripts/sync-engineering-state.mjs` 顶层注入 `const __probe = false && fetch("https://example.invalid/probe")`（短路，不触网、不破坏模块加载）后，用同一份变异源码分别求值两条守卫：**旧守卫（只扫观察者）= GREEN 漏过，新守卫（import 闭包）= RED 抓住**；`node --test tests/contract/engineering-drift.test.js` → `tests 51 / pass 50 / fail 1`，失败信息为 `…/sync-engineering-state.mjs 不得出现 fetch(...) 调用`。还原后 `diff` 与备份逐字节一致，`51 pass / 0 fail`。

#### 不在本 PR 修（评审自己也建议另开 issue）

- **`scripts/sync-engineering-state.mjs` 规则 2：一个「更新的 draft PR」会清空字段。** `open` 桶按 `state === OPEN` 过滤，而 draft 的 state 也是 `OPEN`；若最新的是 draft，`projectionFor` 返回 `clear`，更早的 ready PR 本可写出的 `PR open` 被清空。**与 base 上的 `projectExpected` 逐字一致，不是本 PR 引入的**；本轮 #125 / #137 / #139 三条实红正是这个形状。**登记为技术债，另开 issue 由主控处理**，不在本 PR 改（改了属于范围扩张，且会与「选择策略逐条保持现观察者语义」这条验收冲突）。

### 评审响应（2026-09-23，第二轮 MMP 评审）

第二轮评审锁定 head `300e2a3`，结论**无 P0 / P1**；跨 PR 的矩阵、并集实测与证据见 `docs/review/2026-09-23-mvp1-batch-review.md`。按"机械 **且** 留着会在 `main` 上长期误导"就地修，其余登记 follow-up：

| # | 级别 | 意见 | 处置 |
|---|---|---|---|
| P2-1 | P2 | `expectedFor` 的 Merged 终态不区分合并进 `main` 与合并进栈内父分支 | 不在本 PR 改语义，登记 #176 |
| P2-2 | P2 | 本文件把现场修复归功于补救入口，与 CI 日志矛盾 | 就地标注 `Superseded by`，写入三次 `workflow_run` 的 run 号；补救入口标为未经实地验证 |
| P2-3 | P2 | D2 与 Decision Log 的被证伪论据没有就地标注 | 两处各加 `Superseded by` |
| P2-4 | P2 | `merge-queue.md` §4.7 的 #161 行交付描述与冲突文件不实 | 就地订正 |
| P3-1 | P3 | §4.7 把易失状态写成事实 | 改成本轮评审结论 + 回读命令 |
| P3-2 / P3-3 | P3 | 逐 issue 边读边写的部分写入；外仓 issue 按编号在本仓库查导致串号 | 登记 #177 |
| P3-4 | P3 | import 闭包守卫只认单引号 `from '…'` | 就地修：守卫改为不区分引号，并覆盖副作用导入与动态 `import(`；判别性变异见下 |
| P3-5 | P3 | 合并后回读的期望写错；验收表与 Progress 的数字再次过期 | 就地标注并给出正确命令；验收表第 10、11 行不再写会自我过期的数字 |
| P3-6 | P3 | 正文把实测日期写成 2026-09-24 | 不逐处改写（40 处，与批次计划日、文件名同源），见下方"日期说明" |
| P3-7 | P3 | `ci.md` 并未像描述所说"保留原文" | 就地恢复原段落并加 `Superseded by` |

**import 闭包守卫的判别性变异**（在检出本分支的 `.worktrees/w10-d1` 里，每次先打印变异行、再用 `git checkout --` 还原）：往 `scripts/sync-engineering-state.mjs` 的 shebang 之后分别加入双引号的 `import { execFile } from "node:child_process"`、副作用导入 `import 'node:https'`、动态 `await import('node:child_process')`，对新旧两版守卫各跑一次 `node --test --test-name-pattern='import 闭包'`：旧守卫三次都 `pass 1 / fail 0`（漏报），新守卫三次都 `pass 0 / fail 1`；还原后两个契约文件 96 / 96。实测输出见 `docs/review/2026-09-23-mvp1-batch-review.md` 的「判别性证据」一节。

**日期说明**：本文件正文里标注为 2026-09-24 的条目，是按批次计划日（与文件名同源）记的；对应的提交与平台事件实际发生在 2026-09-23（+08:00），与标注为 2026-09-23 的条目同一天。复核事件时间以 run / 提交自带的时间戳为准。

### 与计划的偏差

1. **分支名**：批次控制输入的表里写的是 `fix/engineering-merged-state`，实际建出的分支是 `fix/engineering-merged-terminal`；本计划与 `merge-queue.md` §4.7 都以实际分支为准。
2. **批次队列小节编号**：批次控制输入要求写 §4.5，但那两个编号已被另一条在飞栈占用，改写 **§4.7**（该输入后来也同步更正）。
3. **`loadPullRequestSnapshot` 改名**：计划里已定「不再返回 snapshot」，实现时同时把查询里的 `state merged isDraft reviewDecision` 删掉——计划只说了返回值，没说查询；删字段的理由与返回值相同（没有消费者），记在 Surprises。

### 与 issue 的偏差

1. **「触发 PR 必须出现在该 issue 的引用集合里」是超出 issue 正文的一处加强。** issue 只要求「不得退回只按触发 PR 写」，没有要求这条断言。加它的理由是：缺了触发 PR 的集合可能给出一个**看起来合法**的取值（例如清空），而那是被禁止路径的镜像。代价是 issue 侧登记滞后时一次 advisory 运行会变红。**这条代价的原表述「下一次 PR 事件会重试」已被实测证伪**（见下面「评审响应（2026-09-23，根因修复）」根因组 B）：事件本身会被 `concurrency` 组丢掉，一次失败可能无限期停在错误取值上。评审若认为这条太严，删掉它不会影响 issue 的核心验收（终态、单调、共用策略）。

### 遗留问题与技术债务

1. **真实事件路径尚未验证。** `Engineering state` 是 `pull_request_target`，workflow 定义与 checkout 的脚本都取自默认分支，所以本次修复在合并进 `main` **之前**无法用真实合并事件验证——与 `2026-09-22-engineering-merged-state.md` 遗留问题第 2 条同形。合并后必须回读一次真实运行（`gh run list --workflow=engineering-state.yml`），把「本地通过」当成「线上已修好」是不允许的；回读对象与判据见 Outcomes 的「合并后的回读对象是具体的」一段。
2. **每个条目多一次 GraphQL 往返。** 写路径现在按 issue 逐个读关闭引用（每次 reconcile 的 issue 数通常为 1–2，`Board invariants` 的每日全量读不受影响）。issue #115 的 option 2 就是为「查询成本不可接受」准备的退路；当前没有观测到成本问题，因此没有为它预先优化（批量 alias 查询会让 fail-closed 的边界变复杂）。
3. **`docs/development/ci.md` 的 `Engineering state` 那一行仍写着 `closed` 触发会写 `Engineering`**（上游计划遗留问题第 5 条）。本层没有改它：那一行描述的是触发与职责，不是选择策略；是否补「已验证」标记仍取决于第一次真实合并事件回读。
4. **（2026-09-23 评审带来，不在本 PR 修）选择策略的 `open` 桶把 draft 与 ready 同等对待，一个「更新的 draft PR」会清空字段。** `state === OPEN` 对 draft 也成立，若最新的是 draft，`projectionFor` 返回 `clear`，更早的 ready PR 本可写出的 `PR open` 被清空。**与 base 上的 `projectExpected` 逐字一致，不是本 PR 引入**，评审也明确建议另开 issue。**收口条件**：先定「draft 与 open 同等对待、还是单独成桶」这条语义，再改选择策略并同步 `docs/development/ci.md` 与两侧契约用例；**由主控另开 issue 处理**。之所以登记：本轮 #125 / #137 / #139 三条实红正是这个形状（draft 时写入 `cleared`，转 ready 后需要一次 reconcile 才能纠正，而那次 run 被并发组取消）。已开为 #173。
5. **（第二轮 MMP 评审带来）Merged 的 base 语义。** `expectedFor` 只看 `state === 'MERGED'`，合并进栈内父分支的 PR 也会让 issue 单调、不可逆地停在 `Merged`；本 PR 让写入口与观察者在这种输入上"一致地错"，观察者因此不会报出。可能性中低（栈按 `merge-queue.md` §4.7 自下而上并入 `main`）。**收口条件**见 #176：只把合并进默认分支视为终态，或在 `board-semantics.md` §2.1 明文禁止栈内层并入父分支。
6. **（第二轮 MMP 评审带来）写入口的部分写入与外仓串号。** 逐 issue 边读边写，一个 issue 失败会挡住其后所有 issue，而事件可能被并发组取消；关闭节点不带 `repository`，外仓条目按编号在本仓库查。当前 82 个条目都在本仓库，属潜在问题。**收口条件**见 #177。

## Bottom Change Note

- (2026-09-24) 创建本计划。依据：issue #115 的正文与 option 1、`2026-09-22-engineering-merged-state.md` 的遗留问题第 1 条、`ci.md` 第 30 行的缺口表述、2026-09-24 的只读 GraphQL 实测（`includeClosedPrs` 默认值与实测行为不一致、四个在飞 PR 的登记齐全）。
- (2026-09-24) 评审响应（对抗验证 3 × P3）：体量数字改为按 head 钉住、`board-semantics.md` 旧表述就地标注、数组守卫补判别性用例；同批新增本节的评审响应小节与一条 Surprises。
- (2026-09-24) 执行完成后回填 `Progress`、`Surprises & Discoveries`（schema 与实测不一致、反向变异同时打红两侧、检查顺序、触发 PR 查询删字段）、`Decision Log`（§4.7 与分支名两处偏差）与 `Outcomes & Retrospective`（先红后绿与反向变异的真实输出、全量验证、两处与 issue 的偏差、三条遗留）。
- (2026-09-23) 评审响应（4 条 inline 意见，根因三组）：订正 `merge-queue.md` §4.7 被证伪的 CI 机制断言与 #166 的前提；把「下一次事件会重试」的风险论据改成实测事实并给出补救入口；把 `fetch(`/子进程守卫从「只扫观察者」扩到 **import 闭包**并附判别性变异；draft 清空语义按评审建议登记为技术债不修。同批修正「与 issue 的偏差」第 1 条里同一句被证伪的风险论据，并新增一条 Surprises（事件被并发组丢弃）与一条遗留（draft 桶语义）。
- (2026-09-23) 第二轮 MMP 评审：D2 / Decision Log / Surprises / 根因组 B / 合并后回读期望五处就地标注 `Superseded by`；验收表第 10、11 行改为不写会自我过期的数字；新增「评审响应（第二轮 MMP 评审）」与「日期说明」；遗留问题登记 #173 / #176 / #177；状态改为 Completed 并移入 `completed/`。
