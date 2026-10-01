# 2026-10-01-board-auto-add-ruling —— 裁决 `Auto-add to project` 并让看板工作流检查恢复

> 状态：Completed（Batch 1–2 已完成；定时运行转绿待合并后回读）
> 创建：2026-10-01
> 范围：把看板新出现的第十条内置工作流 `Auto-add to project` 按 `docs/product/board-semantics.md` §4 求值，并把结论同步写进 §5 裁决表、`scripts/board-workflow-check.mjs` 的 `EXPECTED` 与两组契约测试；不改 workflow、不改看板开关、不改 `Status`。
> 上游输入：issue #248、`docs/product/board-semantics.md` §2 / §4 / §5、`Board invariants` 自 2026-09-26 起的定时运行
> 载体 issue：<https://github.com/SingularityKChen/harness-projects/issues/248>
> 本计划同时是 spec 与 plan；正文中文，代码标识符、路径与命令英文。

## Purpose / Big Picture

`Board invariants` 的 `Board workflow invariants` job 从 2026-09-26 起每天失败，原因只有一条：看板上多了一条 `Auto-add to project`，而裁决表里没有它，检查器按设计把它报成 `unknown`。完成后：

1. §5 裁决表、`EXPECTED` 与契约测试三处一致地登记第十行，结论为「开启」，并写明开启的前提（过滤条件只含 issue、不含 PR）以及该前提只能人工核对；
2. 对真实看板运行 `node scripts/check-board-workflows-live.mjs` 的结果为 exit 0；
3. 下一次定时运行的 `Board workflow invariants` 转绿。

最小成功证据（在检出 `fix/board-auto-add-ruling` 的工作树根目录运行）：

```bash
node --test tests/contract/board-workflow.test.js tests/contract/check-board-workflows-live.test.js   # 期望 fail 0
PROJECTS_TOKEN=<有 project 读权限的令牌> PROJECT_OWNER=SingularityKChen PROJECT_NUMBER=10 node scripts/check-board-workflows-live.mjs   # 期望「已检查 10 条…全部符合裁决表」，exit 0
```

## Context and Orientation

- **裁决规则**：`docs/product/board-semantics.md` §4 的四步规则。一条内置工作流可以开启，当且仅当它写的字段属于它的触发事件所在的那条轴；不写字段的工作流只需确认没有跨轴写入的副作用（第 1 步）。
- **可执行形式**：`scripts/board-workflow-check.mjs` 的 `EXPECTED` 是 §5 表的可执行形式。`tests/contract/board-workflow.test.js` 把条数、名字、期望状态钉死；`tests/contract/check-board-workflows-live.test.js` 用一份合规快照测运行时 adapter，快照必须与 `EXPECTED` 等长，否则会报 `missing`。
- **当前状态**（2026-10-01 回读）：`projectV2.workflows` 共 10 条。新增的是 `Auto-add to project`，number 10，`createdAt 2026-09-26T02:36:27Z`，`enabled: true`。定时运行 36224839724（09-26）到 36685030848（09-30）的 `Board workflow invariants` 均只报这一条 `unknown`，09-25 的运行 36104558572 中该 job 通过。
- **平台行为**（GitHub 文档 *Adding items automatically*）：auto-add 在条目新建或更新且匹配过滤条件时把它加入项目，不追溯已有条目；过滤条件支持 `is:issue` / `is:pr` / `label` 等；文档没有说明从项目移除的条目在更新后是否会被再次加入。`projectV2.workflows` 只返回 `name` 与 `enabled`，不返回过滤条件。 **Superseded by「评审 F6」（2026-10-01）**：第 29 行引用的 `number`、`createdAt` 也来自这个类型，所以「只返回」不成立。schema 自省显示 `ProjectV2Workflow` 没有过滤条件字段；成立的结论只是「不返回过滤条件」。
- **规划所有者的输入**：2026-10-01 在会话中确认当前过滤条件只加 issue、不含 PR。

## Design / Spec

**裁决：开启，前提是过滤条件只含 issue、不含 PR。**

按 §4 第 1 步：它自己不写任何项目字段，只建立项目成员关系。连带的副作用是新上板条目触发 `Item added to project`，后者把 `Status` 写成 `Todo`。这与已开启的 `Auto-add sub-issues to project` 是同一种副作用：只给新上板条目一个初始值，不覆盖任何已有的规划值。

§2 允许 `Item added to project` 的理由是「上板是人的规划动作」。自动上板不改变这一点：过滤条件是规划所有者设定的常设规划决定，issue 本身就是人声明工作项的载体。

前提必须排除 PR。PR 是工程产物，被自动加进规划看板，就是工程事件跨轴写入规划成员关系，第 1 步「没有跨轴写入的副作用」不再成立。

**Superseded by Decision Log「规划所有者（会话中，评审 N1 之后）」（2026-10-01）**：上面把整条工作流都按第 1 步推导，漏了它在 issue「被更新」时也会加入。现在的依据是：新建路径按第 1 步成立；不在看板上的 issue 被工程事件（关闭、重开；过滤条件不含 `is:open`）更新后加入、并写成 `Todo` 的那条路径，第 1 步不成立。规划所有者以本人身份接受它为残余，§5 第十行据此登记。

**被放弃的方案：**

- **关闭，保持人工上板。** 与 §2 原文最贴合，但规划所有者有意开启了这条工作流（只含 issue），而它与已开启的 `Auto-add sub-issues to project` 同类。关闭它等于用文档推翻规划所有者对规划流程的设定，没有不变量层面的理由。
- **在检查器里核对过滤条件。** API 不返回过滤条件，做不到。退而求其次是把前提写进 `why`、§5 正文与契约测试，让「开着不等于合规」随检查输出一起出现。 **Superseded by Decision Log「评审 F2」（2026-10-01）**：前提只出现在 `why` 里时，检查通过的输出并不带它。现在单列为 `precondition`，检查通过时由 live 脚本输出 `::notice::[人工核对]`。
- **把 `unknown` 降级为 warning。** 这会把每一条未来新增工作流的裁决永久搁置，正是 §5 明确反对的做法。

**不变量**：§2「`Status` 只由人写，唯一机械例外是 `Item added to project`」不变——第十行不写 `Status`。`MUST_BE_DISABLED` 仍由 `EXPECTED` 推导，仍为 7 条。

## Global Constraints

- 不改 `.github/workflows/`、不改看板开关、不写任何条目的 `Status` 或关系；GitHub GraphQL 也没有启停内置工作流的 mutation。
- §5 表、`EXPECTED` 与契约测试在同一个提交里一起改（`scripts/board-workflow-check.mjs` 头部注释的要求）。
- 令牌只经环境变量进入一次性进程，不写入文件、记录或 PR。
- 历史文档（`docs/exec-plan/`、`docs/review/`、`docs/project-management/merge-queue.md`）里的「九条」是当时的事实，不改。现行文档（`docs/README.md`、`docs/development/workflow.md`、`docs/project-management/README.md`、§4 与 §5 的说明）里的条数表述，改为「十条」或不带数字（评审 F4 指出初稿漏了 5 处）。

## Plan of Work

### Batch 1 · 裁决与三处同步

- 最小闭环：契约测试先红，再补 `EXPECTED` 第十行，再改 §5 文档。
- 文件：`tests/contract/board-workflow.test.js`、`tests/contract/check-board-workflows-live.test.js`、`scripts/board-workflow-check.mjs`、`scripts/check-board-workflows-live.mjs`（注释）、`docs/product/board-semantics.md`。
- 验证：`node --test tests/contract/board-workflow.test.js tests/contract/check-board-workflows-live.test.js` 先 3 fail，改后 0 fail。两条变异各自变红：把第十行改成 `enabled: false`，以及删掉 `why` 里的「不含 PR」。最后对真实看板跑 live 检查，期望 exit 0。
- 回滚点：revert 本批提交，检查回到「1 条 `unknown`」的已知状态。

### Batch 2 · 回归与归档

- `pnpm verify`、`pnpm run boundaries`、`node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`。
- 本计划移入 `docs/exec-plan/completed/`，在 `docs/README.md` 的 Completed 索引登记。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 三处一致登记第十行 | `board-workflow.test.js` 的十行钉死测试通过；§5 表含第十行 |
| 前提随数据走 | 新测试断言 `why` 含「不含 PR」与「人工核对」；删掉前者即变红 |
| 开关方向被钉住 | 第十行改成 `enabled: false` 时契约测试变红 |
| §5 文档表被钉住 | 契约测试解析 §5 并与 `EXPECTED` 比对；删掉或翻转第十行即变红 |
| 通过时提醒人工前提 | live 检查通过时输出 `::notice::[人工核对] Auto-add to project：…`；去掉该输出即变红 |
| 真实看板合规 | live 检查输出「已检查 10 条看板内置工作流，全部符合裁决表。」，exit 0 |
| 无回归 | `pnpm verify` fail 0；`boundaries` fail 0；`workflow-check` 无发现 |
| 定时运行转绿 | 合并后下一次 `Board invariants` 定时运行的 `Board workflow invariants` job 为 success（合并后回读） |

## Progress

- [x] 2026-10-01：回读 9 次定时运行的失败原因，并在真实看板上复现那条 `unknown`；规划所有者确认过滤条件只含 issue；开 issue #248。 **Superseded by「评审 F6」（2026-10-01）**：「9 次」是 09-22～09-30 的全部定时运行，不是失败次数。`gh run list --workflow board-invariants.yml` 显示失败的是 09-24～09-30 的 7 次，其中 09-26～09-30 的 5 次是本问题，09-24、09-25 来自 `Engineering field drift` 的 #180。
- [x] 2026-10-01 Batch 1：契约测试先红（3 fail：十行钉死、前提断言、live 合规快照），补 `EXPECTED` 第十行与 §5 后 37/37 通过。变异 A 把第十行改为 `enabled: false`，4 fail；变异 B 删掉 `why` 的「不含 PR」，1 fail。两条都经 `git diff --numstat` 确认恰好改了 1 行，并用 `git checkout HEAD --` 还原。对真实看板运行 live 检查，输出「已检查 10 条看板内置工作流，全部符合裁决表。」，exit 0。
- [x] 2026-10-01 Batch 2：`pnpm verify` exit 0（906 pass / 0 fail，MVP-0 7/7）；`pnpm run boundaries` 8/8；`node scripts/workflow-check.mjs` 无发现；disclosure 机械扫描通过；size 为代码 47/1000、文档 143/1500（归档前；归档并补旁证后为文档 152/1500）；`git diff --check origin/main...HEAD` 无输出。本计划归档。
- [x] 2026-10-01 旁证：新建的 issue #248、#249 被自动加入看板，`Status = Todo`；同期开的 PR #247、#250 的 `projectItems.totalCount` 为 0。这与「只含 issue、不含 PR」一致，但只是一次抽样，不能替代在看板设置里人工核对过滤条件。
- [x] 2026-10-01 评审修订（review 5374248180：3 条 P2、3 条 P3，均属实）：
  - F2：`EXPECTED` 加可选 `precondition`，新增 `manualPreconditions()`；live 脚本在检查通过时逐条输出 `::notice::[人工核对]`。
  - F5：契约测试直接解析 §5 表，与 `EXPECTED` 的 `[name, enabled]` 比对。
  - F1、F3：§5 第十行补「更新即加入」残余风险，以及「已在看板上的条目」的回读证据。
  - F4：5 处现行文档的旧条数措辞已改。
  - F6：本计划的计数与措辞已按回读更正。
  - 先红：新测试在实现前 2 fail。补实现后 3 组契约 46/46。
  - 变异（每条先确认 `git diff --numstat`，再 `git checkout HEAD --` 还原）：D 删除 §5 第十行，1 fail；E 把第十行改为 **关闭**，1 fail；F 去掉 notice 输出，1 fail；G 去掉 `precondition`，3 fail；H 关掉 `precondition` 校验，1 fail。
  - 对真实看板运行 live 检查：exit 0，并输出 `::notice::[人工核对] Auto-add to project：…`。
  - F3 的回读：按页读取 `user(login:"SingularityKChen").projectV2(number:10).items(first:100, after:$c)`，取 `createdAt`、`content{... on Issue{number updatedAt}}`、`fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name updatedAt}}`。不要用 `gh api graphql --paginate`：它在这条嵌套路径上会反复取同一页，要手动用 `endCursor` 翻页。 **Superseded by「评审 M1」（2026-10-01）**：反复取同一页的原因是变量名写成了 `$c`。`gh api --help` 写明 `--paginate` 要求查询声明 `$endCursor: String`；改用这个变量名后，同一条嵌套路径可以正常翻页（2 页，145 条，ID 无重复）。可直接复制的命令与分组过滤式见下一条。以启用时刻 `2026-09-26T02:36:27Z` 分组：条目 `createdAt` 早于它且 issue `updatedAt` 晚于它的有 25 个；其中 Status `updatedAt` 晚于它的 12 个是 #119 #70 #180 #120 #164 #28 #124 #137 #171 #183 #172 #139，值为 `Done` ×10、`In Progress` ×2；其余 13 个是 #5 #8 #9 #71 #72 #135 #138 #141 #143 #144 #150 #178 #174。启用后被写成 `Todo` 的为 0。
  - F3 回读的可执行命令（2026-10-01 复跑，输出 `items 145, s 25, changed 12 {Done 10, In Progress 2}, before 13 {Todo 12, In Progress 1}, todoAfter []`）：

    ```bash
    gh api graphql --paginate --slurp -f query='query($endCursor:String){ user(login:"SingularityKChen"){ projectV2(number:10){ items(first:100, after:$endCursor){ pageInfo{ hasNextPage endCursor } nodes{ id createdAt content{ __typename ... on Issue{ number updatedAt } } fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue{ name updatedAt } } } } } } }' \
      | jq --arg E 2026-09-26T02:36:27Z '[.[].data.user.projectV2.items.nodes[] | select(.content.__typename=="Issue") | {n:.content.number, created:.createdAt, updated:.content.updatedAt, status:.fieldValueByName.name, statusAt:.fieldValueByName.updatedAt}] as $all | ($all | map(select(.created < $E and .updated > $E))) as $s | {items: ($all|length), s: ($s|length), changed: [$s[] | select(.statusAt > $E) | {n, status}], before: [$s[] | select(.statusAt <= $E) | {n, status}], todoAfter: [$s[] | select(.statusAt > $E and .status=="Todo") | .n]}'
    ```
- [x] 2026-10-01 评审第二轮（review 5374369539：1 条 P2、3 条 P3，均属实）：
  - N1：规划所有者以本人身份接受残余路径，并确认过滤条件不含 `is:open`（见 Decision Log）；§5 第十行的裁决依据与「没有例外行」随之改写。
  - N2：改正例子归组与「人写的」表述，回读命令写入上一条。
  - N3：Rationale 移回原条目；Progress 与 Surprises 中被改写的两处恢复原文并追加 Superseded；Interfaces 补全 `precondition?`、`manualPreconditions()` 与 notice。
  - N4：§5 解析改为按位置识别表格，任何一行读不出名字都直接失败；同时补测「失败路径不输出 notice」。
  - 变异：G1 在第十行前插入一行无反引号的裁决，1 fail；N 让失败路径也输出 notice，1 fail；都在确认 numstat 后还原。
- [ ] 合并后回读下一次定时运行。

## Surprises & Discoveries

- 同一个定时 workflow 的另一个 job `Engineering field drift` 也报过两类红：09-24～09-27 是 #180，09-30 是 #70。#70 那次的根因是 `engineering-state.yml` 的全局并发组会取消排队中的运行，丢掉了 #241 的 `CHANGES_REQUESTED` 投影（run 36679161542 cancelled）。它与本计划无关，已单独登记为 issue #249。当前 live 漂移检查为 47 个条目全部相等。 **Superseded by「评审 F6」（2026-10-01）**：这是易失值。观察时刻约为 2026-10-01 01:4x UTC，命令是 `node scripts/check-engineering-drift-live.mjs`；评审复跑时为 48。
- 漂移观察者跳过所有未被 PR 引用的条目，所以没被引用、却带着陈旧 `Engineering = PR open` 的条目（#4、#5、#27、#28、#139、#205）不会被报出来。这不属于本计划范围，记在这里，留给 #249 一并判断。

## Decision Log

- 2026-10-01 / 规划所有者（会话中）：`Auto-add to project` 的过滤条件只加 issue、不含 PR，并选择按「开启」裁决。
- 2026-10-01 / 实现者：前提写进 `why` 与 §5，并用契约测试钉住。Rationale：API 读不到过滤条件，前提只能由人核对；它必须出现在检查器输出和权威文档里，否则「开着」会被误读成「合规」。 **Superseded by「评审 F2」（2026-10-01）**：Rationale 说前提会出现在检查器输出里，但初稿只在偏离时输出 `why`，通过时不带前提。
- 2026-10-01 / 实现者：移除条目后是否会被再次加入，登记为残余风险，不推断。Rationale：GitHub 文档未说明，本仓库也没有实测。 **Superseded by「评审 F1」（2026-10-01）**：残余风险扩大为「更新即加入」，见下条。
- 2026-10-01 / 评审 F1（采纳）：文档写明 auto-add 在条目「新建或被更新」时加入，所以不在看板上的 issue 被工程事件更新后会进入规划并写成 `Todo`。不改裁决（开启是规划所有者的决定），但在 §5 第十行把它登记为残余风险。它只给不在看板上的条目一个初始值，不改已有规划值；过滤条件若含 `is:open`，关闭路径不成立。
- 2026-10-01 / 规划所有者（会话中，评审 N1 之后）：接受「更新即加入」残余路径，即不在看板上的 issue 被工程事件更新后加入看板并写成 `Todo`；确认当前过滤条件不含 `is:open`，所以关闭与重开两条路径都成立。裁决仍为开启。§5 第十行据此改写为「新建路径按第 1 步成立，更新路径是被接受的残余」，「没有例外行」改为排除这一行。
- 2026-10-01 / 评审 F2（采纳）：前提单列为 `precondition`，由 `manualPreconditions()` 推导，live 脚本在检查通过时输出 `::notice::`。Rationale：前提恰恰要在「全部符合」时提醒，`why` 只在偏离时出现。规则仍只在 `board-workflow-check.mjs`。
- 2026-10-01 / 评审 F5（采纳）：§5 表由契约测试解析并与 `EXPECTED` 比对。Rationale：§5 被注释写为唯一权威来源，此前却没有任何测试读它，删掉或翻转一行仍全绿。

## Idempotence and Recovery

全部步骤只改仓库文件，可重复执行。live 检查只读看板。失败时 revert 本 PR 的合并提交，检查回到「1 条 `unknown`」的已知状态，不涉及外部写入。若规划所有者之后把过滤条件改成包含 PR，应把第十行改成「关闭」，或要求恢复过滤条件，并更新 §5。

## Interfaces and Dependencies

- `projectV2.workflows { nodes { name enabled } totalCount }`，经 `PROJECTS_TOKEN` 读取（`.github/workflows/board-invariants.yml`）。
- 契约：`EXPECTED` 的元素形状为 `{ name, enabled, why, precondition? }`，其中 `precondition` 是可选的非空字符串。新增导出的纯函数 `manualPreconditions()`，返回 `{ name, precondition }[]`。`boardWorkflowFindings` 的四类输出不变。
- 输出：`scripts/check-board-workflows-live.mjs` 在检查通过时，于「全部符合裁决表」之后逐条输出 `::notice::[人工核对] <name>：<precondition>`；失败与异常路径不输出这一行。

## Outcomes & Retrospective

裁决按计划落地，三处同步为十条，`MUST_BE_DISABLED` 仍为 7 条。没有偏离计划的实现。 **Superseded by 下列两轮评审偏差（2026-10-01）**

与初稿的偏差，来自评审 5374248180：

- 初稿声称前提会出现在检查输出里，实际并不出现。现在改为单列 `precondition`，检查通过时输出 notice。
- 初稿的「三处一致」只钉住了代码侧。现在契约测试也读 §5 表。
- 残余风险从「移除后是否再加入」扩大为「更新即加入」。

来自评审 5374369539 与第三轮复评：

- 裁决依据从「整条按 §4 第 1 步」改为「新建路径按第 1 步成立，更新路径是规划所有者接受的残余」。规划所有者确认过滤条件不含 `is:open`，见 Decision Log。
- §5 解析改为按位置识别表格，读不出名字的行直接失败；并补测「失败路径不输出 notice」。
- F3 的回读写成可直接复制的命令，并更正对 `--paginate` 的错误归因（M1）。

遗留：

- 过滤条件「不含 PR」只能人工核对。检查通过时会提醒，但不会验证；规划所有者改动过滤条件时须同步复核 §5 第十行。
- 「更新即加入」：不在看板上的 issue 被工程事件更新后会进入规划，并写成 `Todo`。规划所有者已于 2026-10-01 接受；过滤条件不含 `is:open`，关闭与重开两条路径都成立。被移出看板的条目是否例外，仍按未知登记。
- `Engineering` 同步的丢更新问题见 issue #249。

## Bottom Change Note

- 2026-10-01：创建计划，记录裁决依据、被放弃的方案与两项旁见。
- 2026-10-01：回填 Batch 1–2 证据并归档到 completed；定时运行转绿留待合并后回读。
- 2026-10-01：按 review 5374248180 的 6 条意见修订：F1、F2、F5 改代码、测试与 §5，F3、F4、F6 修正证据与措辞。原结论就地标 Superseded。
- 2026-10-01：按 review 5374369539 的 4 条意见修订，记录规划所有者对「更新即加入」的接受与过滤条件不含 `is:open`。
- 2026-10-01：按第三轮复评的 M1、M2 修订：F3 回读改为可执行命令，更正 `--paginate` 的归因；Design、Outcomes 与第 30 行的被推翻结论恢复原文并标 Superseded。
