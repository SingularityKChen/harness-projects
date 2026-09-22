# 2026-09-22-engineering-merged-state —— 让合并事件真正写进 `Engineering`，并让漂移可见

> 载体 issue：<https://github.com/SingularityKChen/harness-projects/issues/110>
> 本计划同时是 spec 与 plan；正文中文，代码标识符、路径与命令英文。

## Purpose / Big Picture

一个带 `Closes #N` 的 PR 合并后，看板上该条目的 `Engineering` 必须变成 `Merged`。今天它不会——`Engineering state` 工作流在**每一次合并事件**上都失败，因此 `Merged` 这个取值在当前代码下**不可达**。

完成后：

1. 合并事件不再失败，`Engineering` 被写成 `Merged`；
2. 契约测试断言的是 GitHub 真实返回的枚举，而不是一个从不出现的形态；
3. 看板上的 `Engineering` 与 PR 真值的偏离由一条按日运行的检查报出来，不再依赖"有人刚好去看一眼"；
4. 已经漂移的 25 个条目被回填到真值。

判断成功的最小证据：

```bash
node --input-type=module -e "import { stateForSnapshot } from './scripts/sync-engineering-state.mjs'; console.log(JSON.stringify(stateForSnapshot({ state: 'MERGED', merged: true, isDraft: false, reviewDecision: null })))"
# 期望：{"kind":"set","value":"Merged"}

node scripts/check-engineering-drift-live.mjs
# 期望：exit 0，且报告 0 条漂移
```

## Context and Orientation

### 术语

- **规划轴 / `Status`**：看板上由**人**拥有的字段（`Todo` / `In Progress` / `In Review` / `Done`），回答"规划所有者是否接受这个工作项完成"。定义在 `docs/product/board-semantics.md` §2。
- **工程轴 / `Engineering`**：看板上由**自动化**拥有的字段（`PR open` / `Changes requested` / `Approved` / `Merged`），回答"代码 / PR / CI 走到哪一步"。同上一节。
- **reconcile**：由事件唤醒、但每次都重新读取 PR 当前快照再投影 `Engineering` 的一次写入。事件只是唤醒信号，不是真值来源（`docs/exec-plan/active/2026-09-18-delivery-planning-and-board.md` D5）。
- **投影**：把 PR 快照 `(state, merged, isDraft, reviewDecision)` 映射成 `Engineering` 取值的纯函数，唯一实现在 `scripts/sync-engineering-state.mjs` 的 `stateForSnapshot`。

### 相关文件与当前状态

| 路径 | 当前状态 |
|---|---|
| `scripts/sync-engineering-state.mjs` | 投影函数 `stateForSnapshot` 在 `tests/contract/engineering-state.test.js` 与 reconcile CLI 之间共享；第 22 行的接受集合是 `['OPEN', 'CLOSED']`，第 32 行用 `state === 'CLOSED'` 判定合并 |
| `tests/contract/engineering-state.test.js` | 343 行；第 40 行断言真实合并负载必须抛错 |
| `.github/workflows/engineering-state.yml` | `pull_request_target` 的 `closed` 类型触发；checkout 默认分支；用 `PROJECTS_TOKEN` 与 `vars.PROJECTS_ENGINEERING_FIELD_ID` |
| `.github/workflows/board-invariants.yml` | 每日 schedule，单个 job `board-workflows`，读九条内置 workflow 的启停并与裁决表比较 |
| `scripts/board-workflow-check.mjs` | 纯函数，导出 `EXPECTED`；不发起网络请求，进 `pnpm verify` |
| `scripts/check-board-workflows-live.mjs` | 取数与 CLI 接线，只在 `board-invariants.yml` 里跑 |
| `docs/development/ci.md` | 八行 workflow 表；`Board invariants` 一行写的是"读取 Project 工作流启停并与裁决表比较" |
| `docs/product/board-semantics.md` | §2 定义两条轴；§5 是九行裁决表 |

### 缺陷的完整形状

`stateForSnapshot` 用 **REST 的语义**校验 **GraphQL 的枚举**。

GitHub GraphQL 的 `PullRequestState` 是 `OPEN | CLOSED | MERGED`：一个已合并的 PR 返回 `state: "MERGED"` 且 `merged: true`。`state: "closed"` 配 `merged: true` 是 **REST** 的形态（`GET /repos/{owner}/{repo}/pulls/{n}` 返回 `"state": "closed", "merged": true`），而本脚本用的是 GraphQL。于是：

- 第 22 行把 `MERGED` 当成未知枚举 fail closed 抛错；
- 第 32 行 `if (snapshot.state === 'CLOSED') return snapshot.merged ? setEngineeringState('Merged') : CLEAR` 里那个能产出 `Merged` 的分支**永远不可达**。

实测的 GraphQL 响应（PR #104）：

```json
{"state":"MERGED","merged":true,"isDraft":false,"reviewDecision":null}
```

失败的运行，全部发生在合并事件上，错误完全相同：

| run | 合并的 PR | 错误 |
|---|---|---|
| 35594655457 | #100 | `未知 PR state：MERGED` |
| 35684591935 | #104 | `未知 PR state：MERGED` |
| 35685342825 | #103 | `未知 PR state：MERGED` |

另有一次失败形状不同：run 35566786287（PR #37，引入本自动化的那个 PR）报 `未配置 ENGINEERING_FIELD_ID`——仓库变量 `PROJECTS_ENGINEERING_FIELD_ID` 在该次合并之后 14 分钟才创建（`gh variable list` 显示 2026-09-21T06:16:39Z，合并发生在 06:02:47Z）。

2026-09-22 的看板审计：44 个条目中 25 个与 PR 真值不符。`Engineering` 取值分布为 `{缺失: 29, 'PR open': 14, Merged: 1}`。唯一的 `Merged`（issue #99）不可能来自本自动化，因为产出它的分支不可达——它只能是人手动设的。

### 为什么四层都没有拦住

1. **失败发生在 `closed` 之后**——合并已经完成，这次运行没有任何阻断能力。
2. **分支保护只要求 `PR Fast Gate`**（`gh api .../branches/main/protection` 实测 `required_status_checks.contexts = ['PR Fast Gate']`），`Engineering state` 不是必需检查。
3. **`board-invariants.yml` 只观察内置 workflow 的启停**，不核对任何字段取值，所以"字段停在旧值"这一类漂移没有观察者。
4. **契约测试断言的是错的行为**：`tests/contract/engineering-state.test.js` 第 40 行明确要求 `state: 'MERGED'` 抛 `/未知 PR state/`。`pnpm verify` 因此全绿，而生产路径是断的——这正是本仓库反复警惕的"假绿"。

### 范围边界（刻意不做的事）

- **不改 `Status`。** issue #10 的 `Status` 停在 `Todo` 是**设计如此**，不是缺陷：`docs/product/board-semantics.md` §5 把 `Item closed → Status = Done` 裁决为必须关闭（写规划轴字段、触发事件属工程轴），实测该工作流当前 `enabled: false`。issue 自身的 open/closed 也确实变了（#10 已是 `CLOSED`）。本计划只修工程轴。
- **不把 `Engineering state` 加入分支保护。** 它在合并**之后**才运行，加入分支保护不会产生任何阻断力。是否把 `Merge Gate` 加入分支保护是另一件事，见 `docs/architecture/release-gates.md` §2.2。
- **不引入 merge queue、weekly regression 或新的测试层。** 见 `docs/development/ci.md` 末节。
- **不重构 reconcile 的三段信任边界**（无权 signal → 默认分支 reconcile → ack 后确认）。它工作正常，本次故障与它无关。

## Design / Spec

### D1：接受集合改成 GraphQL 的 `PullRequestState`，并且让不一致成为错误

```js
export const PR_STATES = Object.freeze(['OPEN', 'CLOSED', 'MERGED'])

if (!snapshot || !PR_STATES.includes(snapshot.state)) {
  throw new Error(`未知 PR state：${String(snapshot?.state)}`)
}
// ...
if (snapshot.state === 'MERGED') {
  if (snapshot.merged !== true) throw new Error('PR state 为 MERGED 但 merged 不是 true')
  return setEngineeringState('Merged')
}
if (snapshot.state === 'CLOSED') {
  if (snapshot.merged === true) throw new Error('PR state 为 CLOSED 但 merged 为 true：GraphQL 枚举语义漂移')
  return CLEAR
}
if (snapshot.merged) throw new Error('OPEN PR 不得同时标记为 merged')
// ... 其余 OPEN 分支不变
```

**为什么把 `CLOSED` + `merged: true` 从"产出 `Merged`"改成报错**：那个组合在 GraphQL 下不该出现。继续容忍它，就等于保留一条"REST 形态也能蒙对"的暗路——将来真出现枚举漂移时它会静默按 REST 语义走，而这正是本次故障的成因。让它响亮失败，与 `docs/exec-plan/active/2026-09-18-delivery-planning-and-board.md` D5 已写下的"未知枚举一律失败，不猜测"一致。

**为什么新增 `PR_STATES` 常量而不是内联数组**：它是"这个函数认识哪些 state"的唯一声明，契约测试要断言"接受集合的每个取值都有决策"，内联数组拿不到。

**放弃的方案**：把判定改成 `if (snapshot.merged) return Merged`（只看 `merged` 布尔值，不看 `state`）。更短，但它丢掉了"`state` 与 `merged` 互相印证"这一层——一个 `OPEN` + `merged: true` 的畸形快照会被读成合并。现有代码第 33 行已经显式拒绝该组合，保留它。

**放弃的方案**：改成查 REST API。那会换掉整个取数路径（`closingIssuesReferences` 与 `projectItems` 都是 GraphQL 才有的字段），代价远大于收益，且 GraphQL 的 `MERGED` 是**更**精确的表示。

### D2：契约测试必须断言 GitHub 真实返回的形态

改三处：

1. **反转**第 40 行：`{state:'MERGED', merged:true, isDraft:false, reviewDecision:null}` → `{kind:'set', value:'Merged'}`。这一条来自实测响应，不是构造出来的。
2. **新增穷举断言**：`PR_STATES` 的每个取值都必须有一个代表性快照，且 `stateForSnapshot` 对它返回 `set` 或 `clear`（不抛错）。同时断言代表性快照的键集合与 `PR_STATES` 精确相等。这条的性质是"不存在被接受但未处理的 state"。
3. **新增枚举域断言**：把 `PR_STATES` 钉死为字面量 `['OPEN','CLOSED','MERGED']`，并在注释里写明它是 GitHub GraphQL `PullRequestState` 的完整枚举。这不是机械可推导的（离线无法查询 schema），但它把"改接受集合"从一次静默编辑变成一次必须解释的改动——这正是本次缺失的那道闸。

**为什么第 2 条不能单独防住本次故障**：故障时 `PR_STATES` 是 `['OPEN','CLOSED']`，代表性快照也恰好是这两个键，穷举断言会通过。真正缺的是"接受集合与平台枚举一致"这一条，所以第 3 条才是针对根因的断言。

### D3：漂移监测挂在 `Board invariants` 上，不新增 workflow

新增 `scripts/engineering-drift.mjs`（纯函数）与 `scripts/check-engineering-drift-live.mjs`（运行时 adapter + CLI），并在 `.github/workflows/board-invariants.yml` 里新增第二个 job `engineering-field`。

**为什么不新增一条 workflow**：`docs/development/ci.md` 写着"新增 lane 先写 ExecPlan，证明它提供新的系统反馈"。这里的触发（每日 schedule）、凭据（`PROJECTS_TOKEN`）、门禁姿态（advisory，需要凭据所以不能进必需检查）与 `Board invariants` 完全相同，新增 workflow 只会复制这三样，不提供新的系统反馈。判定对象不同（工作流启停 vs 字段取值）不足以构成新 workflow——两者都是"看板配置 / 数据与仓库内裁决表的偏离"。

**为什么这个 workflow 的 `on` 仍然只有 `schedule`**：`workflow_dispatch` 带一个 ref 选择器，而被选中的 ref 同时决定 workflow 定义与 checkout 出来的脚本。这两个 job 都持有长效 `PROJECTS_TOKEN`，于是手选一个 PR 分支就能拿 token 执行任意代码——那是一条真实的提权路径。`merge-gate.yml` 可以用 `workflow_dispatch`，是因为它不读任何 secret。`tests/contract/check-board-workflows-live.test.js` 已有一条断言把 `on` 钉在 `['schedule']` 上；本计划最初写的"加 `workflow_dispatch` 作为人工复跑入口"是错的，已撤回（见 Surprises & Discoveries）。人工复跑改在本地执行同一个脚本。

**判定规则**（对每个**在看板上**且**被至少一个 PR 通过 closing keyword 引用**的 issue）：

1. 只要有任一引用它的 PR 已合并 → 期望值是该 PR 快照的投影（即 `Merged`）。**已合并是终态且单调**，所以这一条没有歧义，也是本次故障的那一条。
2. 否则，若有任一引用它的 PR 处于 open → 取**创建时间最新**的那个 open PR，期望值是它的投影。多个 open PR 引用同一 issue 本身可疑，但选"最新"是可机械判定且确定的。
3. 否则（全部是 closed 且未合并）→ 期望值是清空（无值）。

没有被任何 PR 引用的条目**跳过**：`Engineering` 为空是合法状态，不是漂移。

**为什么不重新实现投影**：监测必须 import `stateForSnapshot`，否则就会出现第二份投影实现——两份会漂移的副本正是本仓库在 `board-workflow-check.mjs` 里明确拒绝过的形态（"手写第二份清单就是再造一处会漂移的副本"）。

**取数完整性 fail closed**：PR 列表分页读取，超过 500 条上限时显式失败并打印 `::error::`，不把截断的输入当完整输入——这与 `run-test-layer.mjs` 的"空层必须响亮失败"同一条原则。

### D4：回填走生产代码路径，不写一次性脚本

25 个漂移条目里，12 个停在 `PR open`、13 个为空。两者都满足"存在已合并的引用 PR"，因此都可以由 `node scripts/sync-engineering-state.mjs <pr-number>` 修复——那就是**生产路径本身**，且是幂等的（同一个 `updateProjectV2ItemValue` 重放只是把值写成同一个值）。

**为什么不用一次性回填脚本**：一次性脚本是第二份写路径，它不会随投影函数演进而更新；用它回填等于让本次修复的核心逻辑在验收时不被执行。用生产路径回填，同时就是一次端到端验收。

**`Status` 一律不碰**：`AGENTS.md` §7 允许 agent 做机械推导的看板字段回填，`Status` 明确需要人类批准。本批次只写 `Engineering`。

### 不变量（本计划必须保持）

- `Status` 不被本计划的任何一步写入。
- `Engineering` 的取值只经 `setEngineeringState` 构造，写入前经 `constructedSets` 校验。
- 投影只有一个实现：`stateForSnapshot`。
- 未知枚举 fail closed，不猜测。
- 离线检查（`pnpm verify`）不新增网络或凭据依赖。

## Global Constraints

- Node 版本以 `.nvmrc` 为准（当前 `26`）。
- 新增依赖：**无**。监测脚本只用 `node:` 内置模块与仓库已有的 `yaml`（后者仅测试用）。
- 代码变更 ≤ 1000 行、文档变更 ≤ 1500 行（`AGENTS.md` §6，`node scripts/rule-checks.mjs size` 判定）。
- 提交格式 `<type>(<scope>): <中文摘要>`，正文说明为什么，末尾 `Closes #110`。
- 公开面（commit message、PR 描述、文档）执行 `docs/development/publication.md` 的机械扫描与五类目人工检查。
- 只允许 rebase merge；是否合并由人类伙伴决定。
- 新增 / 修改 workflow 必须同时更新 `scripts/workflow-check.mjs` 覆盖的规则面、契约测试与 `docs/development/ci.md`（本次不新增 workflow，但改了 `board-invariants.yml`，W1–W7 仍必须通过）。

## Plan of Work

### Batch 1 · 让合并事件写进 `Merged`（最小闭环）

**最小闭环**：一个已合并 PR 的快照经过 `stateForSnapshot` 得到 `{kind:'set', value:'Merged'}`，且契约测试断言的就是这个。

**涉及文件**：`scripts/sync-engineering-state.mjs`、`tests/contract/engineering-state.test.js`

**步骤**

1. 在 `sync-engineering-state.mjs` 新增 `export const PR_STATES`，把第 22 行的接受集合换成它。
2. 按 D1 重写 state 分支：`MERGED` → `Merged`（断言 `merged === true`）；`CLOSED` + `merged: true` → 报错；`CLOSED` → `CLEAR`；`OPEN` 分支保持原样。
3. 在 `tests/contract/engineering-state.test.js` 反转第 40 行，新增 D2 的第 2、3 条断言。

**验证命令与期望输出**

```bash
cd .worktrees/w7-engineering-merged
node --input-type=module -e "import { stateForSnapshot } from './scripts/sync-engineering-state.mjs'; console.log(JSON.stringify(stateForSnapshot({ state: 'MERGED', merged: true, isDraft: false, reviewDecision: null })))"
# 期望：{"kind":"set","value":"Merged"}（不抛错）

node --test tests/contract/engineering-state.test.js
# 期望：ℹ fail 0

node --test tests/contract/engineering-state.test.js 2>&1 | grep -c "未知 PR state"
# 期望：0（没有任何用例还在断言 MERGED 是未知枚举）
```

**注入验证**（做完后还原并复跑全绿）

| 注入 | 期望变红的用例 |
|---|---|
| 把 `PR_STATES` 改回 `['OPEN','CLOSED']` | 枚举域断言（1 条） |
| 删掉 `MERGED` 分支 | 穷举断言 + 真实负载断言（2 条） |
| 把 `CLOSED` + `merged:true` 改回返回 `Merged` | 语义漂移断言（1 条） |

**回滚点**：`git revert` 单个提交；本批次不触碰任何外部系统。

### Batch 2 · 让漂移可见

**最小闭环**：一条按日运行的检查能在给定输入下报出 `Engineering` 与 PR 真值的偏离，且它对当前真实看板报出 Batch 3 之前的 25 条漂移。

**涉及文件**：`scripts/engineering-drift.mjs`（新增，纯函数）、`scripts/check-engineering-drift-live.mjs`（新增，运行时 adapter + CLI）、`tests/contract/engineering-drift.test.js`（新增）、`.github/workflows/board-invariants.yml`、`docs/development/ci.md`、`docs/product/board-semantics.md`

**步骤**

1. 写 `scripts/engineering-drift.mjs`：导出纯函数 `projectExpected({ references })` 与 `engineeringDriftFindings({ pullRequests, items })`，返回 `{ findings, skipped, checked }`；不发起网络请求、不 import `child_process`、不提供 CLI 入口，因此可以进 `pnpm verify`。命名沿用既有的一对（`board-workflow-check.mjs` 纯函数 / `check-board-workflows-live.mjs` 运行时）。
2. 写 `scripts/check-engineering-drift-live.mjs`：GraphQL 取数（PR 列表与看板条目各自分页）与 CLI 接线，漂移时打印 `::error::` 并 exit 1。
3. 写 `tests/contract/engineering-drift.test.js`：覆盖 D3 的三条规则、未被引用的条目被跳过、取数截断时 fail closed、投影与 `stateForSnapshot` 一致（同输入同输出，防第二份实现）、运行时 adapter 的错误路径，以及 `board-invariants.yml` 的 job 形状与「`on` 只有 `schedule`」。
4. 在 `board-invariants.yml` 新增 job `engineering-field`（`timeout-minutes: 5`、`permissions: contents: read`、`persist-credentials: false`、action pin 到 40 位 commit）。
5. 更新 `docs/development/ci.md` 的 `Board invariants` 行与说明段。
6. 在 `docs/product/board-semantics.md` 增 §2.1，记录 `Engineering` 的投影表、两条 fail-closed 约束与漂移观察的归属。

**验证命令与期望输出**

```bash
node --test tests/contract/engineering-drift.test.js
# 期望：ℹ fail 0

node scripts/workflow-check.mjs
# 期望：no findings（已检查 8 个文件）

PROJECTS_TOKEN="$(gh auth token)" PROJECT_OWNER=SingularityKChen PROJECT_NUMBER=10 \
  GITHUB_REPOSITORY=SingularityKChen/harness-projects node scripts/check-engineering-drift-live.mjs
# 期望（Batch 3 之前）：exit 1，列出 25 条漂移
```

**注入验证**

| 注入 | 期望变红的用例 |
|---|---|
| 把规则 1 从"任一已合并"改成"只看最新 PR" | 「已合并是终态且单调」（1 条） |
| 让未被引用的条目也参与比较 | 「没有被任何 PR 引用的条目跳过」（1 条） |
| 分页超上限时不报错而是截断 | 「分页超过上限时 fail closed」（1 条） |
| 给 `board-invariants.yml` 加回 `workflow_dispatch` | 「漂移 job 挂在 Board invariants 上，且不引入手选 ref 的入口」（1 条） |

**回滚点**：`git revert` 单个提交；新增的 workflow job 是 advisory，回滚后看板不受影响。

### Batch 3 · 回填 25 条并回读

**最小闭环**：真实看板上 0 条漂移，且回填经生产 reconcile 路径完成。

**涉及文件**：无（外部写入）

**步骤**

1. 用 `scripts/check-engineering-drift-live.mjs` 取回填前的 25 条漂移清单并记录（`--json` 输出里含每条 `(itemId, issue, 旧值)`，作为回滚依据）。
2. 对每个漂移条目所属的已合并 PR 执行 `PROJECTS_TOKEN="$(gh auth token)" ENGINEERING_FIELD_ID=<字段 ID> GITHUB_REPOSITORY=SingularityKChen/harness-projects RECONCILE_ID=<唯一值> node scripts/sync-engineering-state.mjs <pr-number>`。
3. 重跑监测，期望 0 条。
4. 回读 `Status`，确认与回填前逐条相同。

**验证命令与期望输出**

```bash
PROJECTS_TOKEN="$(gh auth token)" PROJECT_OWNER=SingularityKChen PROJECT_NUMBER=10 \
  GITHUB_REPOSITORY=SingularityKChen/harness-projects node scripts/check-engineering-drift-live.mjs
# 期望：exit 0，0 条漂移

PROJECTS_TOKEN="$(gh auth token)" PROJECT_OWNER=SingularityKChen PROJECT_NUMBER=10 \
  GITHUB_REPOSITORY=SingularityKChen/harness-projects node scripts/check-engineering-drift-live.mjs --json
# 期望：exit 0，{"findings":[], ...}
```

**回滚点**：回填本身是可逆的——把 `Engineering` 写回旧值即可，旧值在步骤 1 的清单里逐条记录。写的是工程轴字段，`Status` 不受影响。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 合并快照投影为 `Merged` | `stateForSnapshot({state:'MERGED',merged:true,...})` 返回 `{"kind":"set","value":"Merged"}` | 通过 |
| 2 | `CLOSED` + `merged:true` 不再静默按 REST 语义走 | 该输入抛 `/GraphQL 枚举语义漂移/` | 通过 |
| 3 | 契约测试不再把真实负载钉成错误 | `tests/contract/engineering-state.test.js` 里 `/未知 PR state/` 只匹配真正未知的 `DRAFT` | 通过 |
| 4 | 接受集合与平台枚举一致，且每个取值都有决策 | `PR_STATES` 字面量断言 + 穷举断言通过 | 通过 |
| 5 | 漂移监测能报出真实漂移 | 回填前实测 `25 / 31 个条目与 PR 真值不符`，exit 1 | 通过 |
| 6 | 漂移监测复用唯一投影实现 | 契约测试断言同输入同输出 | 通过 |
| 7 | 取数截断时 fail closed | 超上限用例 exit 1 且含 `::error::` | 通过 |
| 8 | 离线检查仍无网络 / 无凭据 | `pnpm verify` → 402 pass / 0 fail，`tests/mvp0` 7 pass | 通过 |
| 9 | workflow 规则不被破坏 | `node scripts/workflow-check.mjs` → `no findings（已检查 8 个文件）` | 通过 |
| 10 | 体量与发布面合规 | 代码 960 / 1000、文档 415 / 1500；`disclosure origin/main`、`git diff --check` exit 0 | 通过（代码余量仅 40 行，见技术债务） |
| 11 | 看板归零 | 回填后监测 `已比较 31 个看板条目，全部等于 PR 真值`，exit 0 | 通过 |
| 12 | `Status` 未被本计划改动 | 44 个条目逐条比对：`Status` 变化 0 条、`itemId` 变化 0 条 | 通过 |
| 13 | 真实 CI 全绿 | 最终 head 上 `gh pr checks <n>` 全部 pass | 通过：rebase 前 head `be45d91` 上 12 项全 pass；rebase 后重新回读，见 Outcomes 的「rebase 到新的 main」一节 |
| 14 | issue 关联 | `closingIssuesReferences = [110]`，issue 侧 `closedByPullRequestsReferences` 含本 PR | 通过：PR 侧 `closingIssuesReferences = [110]` |

## Progress

- [x] (2026-09-22) 完成根因定位与看板审计：25/44 条目漂移，3 次合并事件失败，契约测试钉死错误行为
- [x] (2026-09-22) 建立隔离工作区 `.worktrees/w7-engineering-merged`（分支 `fix/engineering-merged-state`）
- [x] (2026-09-22) 创建 issue #110
- [x] (2026-09-22) Batch 1 · 让合并事件写进 `Merged`（21 条契约用例全绿；三组注入各自按预期变红后还原复跑）
- [x] (2026-09-22) Batch 2 · 让漂移可见（20 条契约用例全绿；对真实看板报出 25 / 31 条漂移，exit 1；`workflow-check` no findings）
- [x] (2026-09-22) Batch 3 · 回填 25 条并回读（23 个已合并 PR 各跑一次生产 reconcile，0 失败；监测归零；`Status` 与 `itemId` 逐条未变）

## Surprises & Discoveries

- **(2026-09-22) 引入本自动化的 PR 自己就没跑成。** run 35566786287（PR #37 的合并事件）失败于 `未配置 ENGINEERING_FIELD_ID`，因为仓库变量 `PROJECTS_ENGINEERING_FIELD_ID` 在合并后 14 分钟才创建（`gh variable list` → 2026-09-21T06:16:39Z；PR #37 合并于 06:02:47Z）。也就是说这条 lane 从诞生起就没有一次成功的合并事件记录。
- **(2026-09-22) 唯一的 `Merged` 是人写的，不是自动化写的。** 看板上 issue #99 的 `Engineering = Merged`，但产出该值的代码分支不可达。这说明有人（或某次手工操作）补过值——一个"看起来在工作"的假象，恰好掩盖了自动化从未成功过。
- **(2026-09-22) 契约测试的断言方向反了，反而成了缺陷的保护伞。** `tests/contract/engineering-state.test.js` 第 40 行把 GitHub 真实返回的合并负载列为"未知枚举必须拒绝"的用例。`pnpm verify` 因此一直是绿的。这不是测试写得少，是测试断言了一个错的命题——比没有测试更难发现。
- **(2026-09-22) 主工作区落后远端 15 个提交。** 仓库主工作区的 HEAD 停在 `eba9c74`，`docs/development/ci.md` 因此读到的是只有五行的旧表。本次所有读取都以隔离工作区 `.worktrees/w7-engineering-merged`（`origin/main` = `c13b01d`）为准。
- **(2026-09-22) 本计划提出的 `workflow_dispatch` 被既有契约测试正确地挡下。** 计划原本要给 `board-invariants.yml` 加一个人工复跑入口，理由抄的是 `merge-gate.yml`。`tests/contract/check-board-workflows-live.test.js` 的 `assert.deepEqual(Object.keys(workflow.on), ['schedule'])` 直接变红——这条断言是对的：`workflow_dispatch` 的 ref 选择器会让被选中的 ref 同时决定 workflow 定义与 checkout 的脚本，而这两个 job 持有长效 PAT，手选一个 PR 分支就能拿 token 执行任意代码。`merge-gate.yml` 能用它，是因为那条 workflow 不读 secret。已撤回该步骤，并把「`on` 只有 `schedule`」补进 `engineering-drift.test.js` 与 `ci.md`。
- **(2026-09-22) 把「已合并」写成「任一已合并」而不是「最新 PR」，差别是实质的。** 若按"最新创建的那个 PR"取真值，一个在合并之后新开的 open PR 会把已交付的工作读回未合并。已合并是终态且单调，所以规则 1 必须先看它。这条在 `engineering-drift.test.js` 里有一条专门的用例。

## Decision Log

- **Decision**：把接受集合扩到 GraphQL 的 `PullRequestState`（`OPEN | CLOSED | MERGED`），并让 `CLOSED` + `merged: true` 成为显式错误。
  **Rationale**：根因是用 REST 语义校验 GraphQL 枚举。容忍那个组合会保留一条静默的 REST 语义暗路，正是本次故障的成因。
  **Date/Author**：2026-09-22 / agent
- **Decision**：漂移监测挂在 `Board invariants` 上作为第二个 job，不新增 workflow。
  **Rationale**：触发、凭据、门禁姿态与既有 job 完全相同；新增 workflow 只复制这三样，不提供新的系统反馈（`docs/development/ci.md` 的准入要求）。
  **Date/Author**：2026-09-22 / agent
- **Decision**：回填走 `scripts/sync-engineering-state.mjs` 生产路径，不写一次性回填脚本。
  **Rationale**：一次性脚本是第二份写路径，且会让本次修复的核心逻辑在验收时不被执行。
  **Date/Author**：2026-09-22 / agent
- **Decision**：`Status` 不在本计划范围内，且回填前后逐条比对确认未被改动。
  **Rationale**：`Status` 是规划轴、由人拥有；`AGENTS.md` §7 要求 `Status` 的写入必须有人类批准。issue #10 的 `Status = Todo` 是设计如此。
  **Date/Author**：2026-09-22 / agent
- **Decision**：不把 `Engineering state` 加入分支保护。
  **Rationale**：它在合并之后才运行，加入分支保护不产生阻断力；它要防的是投影错误，而投影错误由 Batch 1 的契约测试和 Batch 2 的漂移监测覆盖。
  **Date/Author**：2026-09-22 / agent
- **Decision**：`board-invariants.yml` 的 `on` 保持只有 `schedule`，**不**加 `workflow_dispatch`。
  **Rationale**：`workflow_dispatch` 的 ref 选择器让手选的 ref 同时决定 workflow 定义与 checkout 的脚本，而该 workflow 持有长效 PAT——这是一条真实的提权路径。既有契约测试已经把它钉住，本计划最初的提案是错的。
  **Date/Author**：2026-09-22 / agent
- **Decision**：漂移监测的判定规则用「任一已合并 PR」优先，而不是「最新创建的 PR」。
  **Rationale**：已合并是终态且单调；按"最新"取真值会让一个后开的 open PR 把已交付的工作读回未合并。
  **Date/Author**：2026-09-22 / agent
- **Decision**：对 25 个漂移条目执行 `Engineering` 字段回填。
  **Rationale**：`Engineering` 是机械推导的工程轴字段，`AGENTS.md` §7 允许 agent 回填；此处仍记录人类批准是因为它是对公开看板的批量外部写入。
  **批准**：2026-09-22 由人类伙伴在本任务的选项中显式选择"全部修复：代码 + 测试 + 漂移监测 + 回填 25 条"，批准指向 issue #110 关联的 PR 与本节的回填清单。执行记录见 Outcomes。
  **Date/Author**：2026-09-22 / agent

## Idempotence and Recovery

- **Batch 1 / 2 的代码改动**：纯函数与离线测试，可任意重跑；`node --test` 无副作用。
- **回填**：`updateProjectV2ItemFieldValue` 是幂等的——重放把同一个值写成同一个值。`clientMutationId` 用 `<run>-<itemId>` 形状，重复执行不会产生第二个效果。
- **监测**：只读，无写入面。可任意重跑。
- **失败后如何回到已知良好状态**：`git revert` 本 PR 的提交即可回到"合并事件失败但看板不变"的旧状态；回填的旧值逐条记录在 Batch 3 步骤 1 的清单里，需要时按清单写回。
- **恢复锚点**：Batch 3 之前先把回填前的 25 条 `(itemId, issue, 旧值)` 清单落进本文件的 `Outcomes & Retrospective`，作为回滚依据。
- **不会做的事**：不 `push --force`（除非评审要求且已建 backup ref）；不删除 worktree；不改分支保护。

## Interfaces and Dependencies

- **GitHub GraphQL**：`PullRequestState` 枚举（`OPEN` / `CLOSED` / `MERGED`）、`PullRequest.merged`、`PullRequest.isDraft`、`PullRequest.reviewDecision`、`PullRequest.closingIssuesReferences`、`ProjectV2Item.project`。
- **凭据**：`secrets.PROJECTS_TOKEN`（带 `project` scope 的 PAT，仓库内已存在，创建于 2026-09-18T06:13:44Z）；`vars.PROJECTS_ENGINEERING_FIELD_ID`（已存在，值 `PVTSSF_lAHOAY1ahM4BjzAQzhiqjsA`）。两者都是 `Engineering state` 与 `Board invariants` 已有的依赖，本计划不新增凭据。
- **本地回填前提**：执行者的 `gh` 凭据需带 `project` scope（本机实测具备）。
- **命名契约**：`Engineering` 字段名与四个取值 `PR open` / `Changes requested` / `Approved` / `Merged` 由 `resolveProjectField` 在运行时校验，不可改。
- **不新增**：workflow、依赖、secret、分支保护设置、`Status` 写入路径。

## Outcomes & Retrospective

### 实际结果

三个批次全部完成，代码与看板两侧都达到验收。

**代码侧**

- `pnpm verify` → **402 pass / 0 fail**，`tests/mvp0` **7 pass / 0 fail**。
- `node scripts/workflow-check.mjs` → `no findings（已检查 8 个文件）`。
- `node scripts/rule-checks.mjs size origin/main` → 代码 **960 / 1000**、文档 **415 / 1500**，exit 0。
- `node scripts/rule-checks.mjs disclosure origin/main` → exit 0；`git diff --check origin/main...HEAD` → 无输出。
- 三组注入各自按预期变红后还原复跑全绿：

  | 注入 | 变红的用例 |
  |---|---|
  | `PR_STATES` 改回 `['OPEN','CLOSED']` | 4 条（枚举域钉死、穷举、真实负载、语义漂移） |
  | 删掉 `MERGED` 分支 | 3 条（真实负载、穷举、语义漂移） |
  | `CLOSED` + `merged:true` 改回返回 `Merged` | 1 条（语义漂移） |

**看板侧**

回填前（`check-engineering-drift-live.mjs` 实测）：

```text
::error::[Engineering 漂移] issue #10（item PVTI_…aMEI，依据 PR #104）：Engineering 实际为「PR open」，期望「Merged」
…（共 25 条）
看板 Engineering 漂移检查失败：25 / 31 个条目与 PR 真值不符。
exit=1
```

回填执行：23 个已合并 PR 各跑一次 `node scripts/sync-engineering-state.mjs <pr>`，**23 成功 / 0 失败**，共写 25 个条目（PR #95 与 #97 各覆盖两个 issue）。每条都打印了 `::notice::confirmed`，并以 `Status 未被改动——规划状态与工程执行状态保持正交。` 收尾。

回填后：

```text
已比较 31 个看板条目，全部等于 PR 真值（13 个条目没有被任何 PR 引用，跳过）。
exit=0
```

| 指标 | 回填前 | 回填后 |
|---|---|---|
| `Engineering` 分布 | `{空: 29, 'PR open': 14, Merged: 1}` | `{空: 16, Merged: 26, 'PR open': 2}` |
| `Status` 分布 | `{Todo: 12, 'In Progress': 6, Done: 26}` | `{Todo: 12, 'In Progress': 6, Done: 26}`（未变） |
| 漂移条目 | 25 / 31 | 0 / 31 |

`Status` 与 `itemId` 对 44 个条目**逐条比对，0 条变化**。issue #10 现在是 `Engineering = Merged`、`Status = Todo`、issue `CLOSED`——三者同时成立正是设计意图：工程事实已交付，规划接受与否仍归人。

### 与计划的偏差

1. **脚本命名**：计划写的 `scripts/check-engineering-drift.mjs` 拆成了两个文件——`scripts/engineering-drift.mjs`（纯函数，进 `pnpm verify`）与 `scripts/check-engineering-drift-live.mjs`（运行时 adapter + CLI）。理由是与既有的 `board-workflow-check.mjs` / `check-board-workflows-live.mjs` 这一对保持同构，让"离线判定"与"需要凭据的取数"有同一条边界。
2. **撤回 `workflow_dispatch`**：计划原本要给它加人工复跑入口，被既有契约测试挡下，理由见 Surprises & Discoveries。人工复跑改为本地执行同一个脚本。
3. **`docs/product/board-semantics.md` 新增 §2.1 而不是新开一节**：避免给该文档后续章节重新编号，那会打断仓库里已有的 `§4` / `§5` / `§8` / `§9.2` 交叉引用。

### 回填清单与回滚依据

回填写的是**正确**的工程事实，所以回退代码不会让看板变成错的——恢复看板不是回滚的必要步骤。若要精确复原回填前的取值，25 条的旧值只有两种：

```text
旧值 PR open（12 条）：#10 #14 #15 #16 #17 #18 #20 #32 #34 #36 #45 #66
旧值空（13 条）：      #7 #26 #29 #30 #31 #42 #44 #49 #65 #76 #77 #78 #79
```

对应的 `itemId` 不写进本文件——它是每次运行都可重新推导的取数结果，而 `Engineering state` 与 `Board invariants` 的运行日志里都有：

```bash
PROJECTS_TOKEN="$(gh auth token)" PROJECT_OWNER=SingularityKChen PROJECT_NUMBER=10 \
  GITHUB_REPOSITORY=SingularityKChen/harness-projects node scripts/check-engineering-drift-live.mjs --json
# findings[].itemId 就是需要复原的条目；回填运行输出的 ::notice:: 行里也有同一组值。
```

回填的外部写入记录：actor = 本会话使用的 `gh` 凭据（`project` scope）；目标 = `SingularityKChen` 的 project #10 的 `Engineering` 字段（`PVTSSF_lAHOAY1ahM4BjzAQzhiqjsA`）；幂等键 = `clientMutationId = backfill-20260922-<pr>:<itemId>`；结果 = 23 次 reconcile 全部成功并逐条 ack。

### 真实 CI 与远端回读（rebase 前）

交付 PR：[#111](https://github.com/SingularityKChen/harness-projects/pull/111)（head `be45d91`，base `main@c13b01d`，changed files 10，+1439 / −16）。

```text
$ gh pr checks 111
Disclosure scan                pass
Issue policy                   pass
Merge Gate                     pass
Merge Gate · Boundaries        pass
Merge Gate · E2E               pass
Merge Gate · Integration       pass
Merge Gate · MVP-0             pass
PR Fast Gate                   pass
PR size                        pass
Reconcile engineering state    pass
Resolve PR base                pass
Verify（typecheck + 契约测试）  pass
```

`Reconcile engineering state` 这次运行本身也回读了一条有用的证据：日志是 `PR #111 没有通过 closing keyword 关联到目标 project item，无事可做。`——因为 issue #110 还没有被加入看板。它**正确地**没有失败，也没有凭空写值。

### rebase 到新的 main（2026-09-22）

评审期间 `main` 从 `c13b01d` 前进到 `124f0e4`（其他会话合入 Gate E1 的实验）。本分支已 rebase 到 `124f0e4`，恢复锚点 `backup/p111-pre-rebase`（rebase 前 head `817ae42`）。

唯一冲突是 `docs/README.md` 的 ExecPlan 索引表：`main` 把 `2026-09-21-policy-check-pr-number` 从 Active 移到 Completed，而本分支在 Active 表加了一行，正好落在被重排的区域。解决方式是**保留本分支的新行、去掉已被 `main` 移走的那行**。本分支其余 9 个文件与 rebase 前逐字节相同（`git diff backup/p111-pre-rebase HEAD -- <本分支文件集>` 只输出索引表那一处）。

上面「真实 CI 与远端回读（rebase 前）」一节的 head 与 base 描述的是 rebase **之前**的观察；那两个 SHA 由 `backup/p111-pre-rebase` 保留，仍可按 ref 取到。rebase 后的 head、base 与 checks 重新回读如下——rebase 使旧行号与旧证据失效，这是 `docs/development/workflow.md` §3.1 的既有要求，不沿用旧结论。

rebase 后本地复跑（head `ec68fb0`）：

```text
pnpm verify                                        # ℹ tests 405 / pass 405 / fail 0；tests/mvp0 7 / 7
node scripts/workflow-check.mjs                    # no findings（已检查 8 个文件）
node scripts/rule-checks.mjs size origin/main      # 代码 960 / 1000、文档 526 / 1500，exit 0
node scripts/rule-checks.mjs disclosure origin/main # exit 0
git diff --check origin/main...HEAD                # 无输出
```

（`tests` 从 402 升到 405，是 `main` 新合入的 Gate E1 证据一致性用例，不是本分支新增。）

rebase 后远端回读（在 `ec68fb0` 与 `c6c2a2a` 两个 head 上各做过一次，结果相同）：

```text
head = c6c2a2a   base = main   mergeable = MERGEABLE   closes = [110]

Disclosure scan                pass
Issue policy                   pass
Merge Gate                     pass
Merge Gate · Boundaries        pass
Merge Gate · E2E               pass
Merge Gate · Integration       pass
Merge Gate · MVP-0             pass
PR Fast Gate                   pass
PR size                        pass
Reconcile engineering state    pass
Resolve PR base                pass
Verify（typecheck + 契约测试）  pass
```

**关于「最终 head」的递归**：本节自身也是文档，写进去就会产生新 head。因此约定——**此后只追加文档的提交不再改变上面的结论**；上面两个 head 各回读过一次且结果相同，`c6c2a2a` 之后的 head 与本节的差异只在文字，检查集合与判定不变。若后续出现**非文档**改动，则本节作废，必须重新回读。

`mergeStateStatus` 是 `BLOCKED`，原因是分支保护要求 1 个批准而本 PR 尚无评审——与 #104 合并时的情形相同，不是检查失败。

体量在 `ec68fb0` 是代码 960 / 1000、文档 526 / 1500；`c6c2a2a` 是文档 559 / 1500（本节自身增长），均 exit 0。

### 评审响应（2026-09-22，7 条：3×P2 / 4×P3）

评审落在 rebase 前的 head `817ae42`。7 条逐条核实，**没有一条误报**。处置按 `docs/review/responding.md` 的判据——P2/P3 只在改动机械、范围清楚且不削弱验证时才顺手修，否则留 follow-up：

| # | 级别 | 处置 |
|---|---|---|
| 1 | P2 | **留 follow-up（issue #115）**。它要让写入者与观察者共用同一条选择策略，得改写入者的查询与语义——不是机械改动 |
| 2 | P2 | 修。items 查询加 `repository { nameWithOwner }` 并按来源仓库过滤；该过滤同时排除了非 issue 条目，于是删掉了原来单独的 `content.number` 判断（净减一个分支） |
| 3 | P2 | 修。传输与结构故障改写为**表驱动**，对标 `check-board-workflows-live.test.js` 的既有形态：用例 20 → 49，结构故障从「2 条有用例」到 24 条全覆盖；另补分页成功路径 |
| 4 | P3 | 修。删掉两条源码正则，换成按 `PR_STATES` 派生的行为断言 |
| 5 | P3 | 已修——rebase 时独立发现（见上一节） |
| 6 | P3 | 修。`ci.md` 收紧为「投影共享，选择策略是观察者独有的」并指向 #115 |
| 7 | P3 | 修。`board-semantics.md` §2.1 补第三条 fail-closed 约束 |

**评审 [1] 为什么留 follow-up 而不是现在修**：它的根因是写入者只投影触发事件的那一个 PR，而观察者按「任一已合并优先」聚合。修法要么把选择策略搬进投影权威并让写入者多取一层数据，要么让写入者变成终态感知——两者都改语义与查询，属 `responding.md` 所说的「不机械」那一类。观察者报得对、写入者写得错，所以不能反过来把观察者改窄（那会让漂移不可见）。

**[3] 与体量的关系**：评审要求补覆盖时，本 PR 代码预算只剩 40 行。两处优化腾出了空间——测试改写为表驱动（用例 20 → 49，覆盖 2 → 24 条错误分支）、GraphQL 查询按仓库既有风格压紧。最终 **969 / 1000**，余 31 行。

**顺带修的一处**：`.tmp-pnpm/` 加进 `.gitignore`。它是 pnpm 的本地 XDG 重定向目录（项目 pin 了 pnpm 版本，受限沙箱不允许它在 workspace 之外建临时目录），此前未被忽略，本次实测被一次 `git add -A` 误收 **515 个文件**并进了本地提交；已撤销该提交、加忽略规则后重提。这正是技术债务第 4 条预言的形态。

### 遗留问题与技术债务

1. **代码体量只剩 40 行余量。** `rule-checks size` 实测 960 / 1000。评审若要增加实现或测试，必须先削减而不是追加。可削减处：`scripts/check-engineering-drift-live.mjs` 的取数校验与 `check-board-workflows-live.mjs` 有明显重复（`requiredString` / `requiredObject` / `errorMessage` 三件套），可抽成一个共享模块；那是跨文件的机械重构，本批次刻意没做。
2. **`MERGED` 的端到端路径尚未在真实 CI 上验证。** `Engineering state` 是 `pull_request_target`，workflow 定义取自默认分支，所以本次修复在合并进 `main` **之前**无法用真实合并事件验证——合并前的证据是本地复现 + 契约测试。合并后必须回读一次真实运行，把"本地通过"当成"线上已修好"是不允许的（`docs/development/ci.md` 对 `pull_request_target` 的既有要求）。这是本计划唯一未闭环项。
3. **`board-invariants.yml` 的漂移检查要等下一个 02:00 UTC 才有第一次真实运行。** 在那之前它只有本地实测证据。
4. **本地 `pnpm` 需要 XDG 目录重定向。** 项目 pin 了 `pnpm@10.28.2`，而当前沙箱不允许 pnpm 在 workspace 之外创建临时安装目录；绕法是 `XDG_CACHE_HOME` / `XDG_DATA_HOME` / `XDG_STATE_HOME` / `TMPDIR` 指向 workspace 内的 `.tmp-pnpm/`。**已在本 PR 加进 `.gitignore`**——见「评审响应」一节末尾：不写这一条时 `git add -A` 实测误收 515 个文件。
5. **`docs/development/ci.md` 里 `Engineering state` 那一行仍写着 `closed` 触发会写 `Engineering`。** 修复后这句话才成立；修复前它描述的是期望而非事实。本批次未给该表加"已验证"标记——第一次真实合并事件回读之后再补。
6. **`docs/project-management/README.md` 的字段表缺 `Engineering` 一行**（字段 ID `PVTSSF_lAHOAY1ahM4BjzAQzhiqjsA` 与四个选项）。`docs/product/board-semantics.md` §8 已把这张表登记为字段与选项 ID 的权威表述，也承认它尚未同步 Batch 2 / Batch 9 新增的字段。本计划按"哪里是权威就写哪里"的原则没有把该 ID 复制进 ExecPlan 之外的地方，缺口留给该文档自己的批次。
7. **issue #110 不在看板上，需要人类伙伴决定是否上板。** `docs/project-management/README.md` §3 的维护命令把"新建工作项"与"加入项目"写成一步，但按 `docs/product/board-semantics.md` §2 与 §4，「把条目上板」本身是**规划轴**动作，`Item added to project` 自动写 `Status = Todo` 之所以被允许，前提正是那个触发事件由人做出。因此 agent 不代劳这一步；在人类伙伴上板之前，`Engineering state` 对 PR #111 只会打印"没有关联到目标 project item，无事可做"。这不影响本计划的验收——合并投影的端到端证据来自 Batch 3 对 23 个已合并 PR 的回填。

## Bottom Change Note

- (2026-09-22) 创建本计划。依据：issue #110 的根因定位、2026-09-22 的看板审计（25/44 漂移）、4 次失败的 `Engineering state` 运行日志。
- (2026-09-22) Batch 1 / 2 完成后回填 Progress、Surprises（`workflow_dispatch` 被既有测试挡下）与 Decision Log；按实测把脚本命名从 1 个文件改成 2 个。
- (2026-09-22) Batch 3 完成后回填 Outcomes：验证证据、回填清单、回滚依据与 5 条遗留问题。
