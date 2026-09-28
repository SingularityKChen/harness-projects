# 2026-09-24-merge-queue-closing-refs —— 订正关闭引用的普适断言，并回读本批次合并结果

> 状态：Completed（Batch 3 回读 PR #161 的合并并归档）
> 创建：2026-09-24
> 范围：订正 `docs/project-management/merge-queue.md` 里关闭引用的普适断言、回读 MVP-1 批次的合并结果、登记 `feat/` 分支前缀这处偏差；不改代码、不改 workflow。
> 上游输入：issue #180、PR #161 的第二轮评审记录、`docs/review/responding.md`
> 载体 issue：<https://github.com/SingularityKChen/harness-projects/issues/180>
> 本计划同时是 spec 与 plan；正文中文，代码标识符、路径与命令英文。

## Purpose / Big Picture

`docs/project-management/merge-queue.md` §7 把**一次观测**写成了一条普适规则：「关闭引用一旦登记，就不会随正文编辑撤回」。这条规则决定了别人怎么计划合并后的补救动作——按它，改正文是没用的，必须合并后 `gh issue reopen`。2026-09-23 在 PR #161 上测到了相反的结果。

完成后：

1. §7 同时保留两次相反的实测，删掉那句普适结论，换成两个方向都能成立的操作规则；
2. §4.7 记录本批次已经发生的合并（#159 → #115、#158 → #128、#160 → #137）与仍未合并的 #161（它随 #160 合入已不再是任何栈的一层）；
3. `feat/` 前缀这处已存在的偏差被登记下来，并写明后续新分支一律用白名单前缀。

判断成功的最小证据（在检出本计划所属分支 `docs/merge-queue-closing-refs` 的工作树根目录运行；`origin/main` 当时是 `547b2de`）：

```bash
grep -c '^\*\*关闭引用一旦登记' docs/project-management/merge-queue.md   # 期望 0（那句标题已不再是断言）
grep -c "两个方向都不成立" docs/project-management/merge-queue.md    # 期望 1
node scripts/rule-checks.mjs size origin/main                        # 期望 exit 0
```

## Context and Orientation

**这一节要修的那句话。** §7 原文：

> **关闭引用一旦登记，就不会随正文编辑撤回（2026-09-21 实测）**

它的证据是 #108：正文里的 `Closes #4` 被删掉后等 3.5 分钟回读，`closingIssuesReferences` 仍是 `[4, 25]`（**该读值此后又变过**：2026-09-28 复读为 `[25]`、issue 侧 `[]`，见 `docs/project-management/merge-queue.md` §7 的「后续复读」）。

**推翻它的第二次观测（PR #161，2026-09-23）。** 正文里的 `Closes #139` 改成 `Refs #139`，同样等 3.5 分钟后回读：

```bash
gh pr view 161 -R SingularityKChen/harness-projects --json closingIssuesReferences             # 改前 [139] → 改后 []
gh issue view 139 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences   # 改前 [161] → 改后 []
```

**为什么这两次可以同时为真。** 本文件不给出机制——§4.4 已经记录过同一个字段的另一种反复（「从空变非空」；该节自己的措辞是「判定关闭关联必须读 `closingIssuesReferences` / `closedByPullRequestsReferences` 本身」），§7 的结论用同一条纪律表述为「判定关闭关联永远读这两个字段本身，不要从正文推断」。这次是同一类事实的第三例。

**术语。**

- `closingIssuesReferences`：PR 侧登记的被关闭 issue 列表，`gh pr view <n> -R SingularityKChen/harness-projects --json closingIssuesReferences`。
- `closedByPullRequestsReferences`：issue 侧的对应列表，`gh issue view <i> -R SingularityKChen/harness-projects --json closedByPullRequestsReferences`。
- 两个字段都可能与正文**不一致**，所以它们才是判定对象。

**相关文件。**

- `docs/project-management/merge-queue.md` —— 本次主要改动的文件（§7 与 §4.7；完整文件集见 `Global Constraints`）。
- `docs/review/responding.md` —— 回复评审与回读的既有流程。
- **证伪的原始观测**最初记在 PR #161 那一层 ExecPlan 的旧版 `Surprises & Discoveries` S8。Batch 2 回读时，旧路径 `docs/exec-plan/active/2026-09-24-human-execution-provider.md` 已从该分支的树里移除；当时的失败判据如下，不能用它判断后续归档版是否存在：

  ```bash
  git cat-file -e origin/feat/human-execution-provider:docs/exec-plan/active/2026-09-24-human-execution-provider.md
  # 期望：失败（该路径不在该分支的树里，2026-09-28 实测）
  ```

  **Superseded by 2026-09-28 的合并回读**：PR #161 已合入 `main`，重建后的计划现存于 `docs/exec-plan/completed/2026-09-24-human-execution-provider.md`。该版本没有 S8 的原始记载；本计划按 `PLANS.md` §4 把观测内联在下面，避免把证据押在已消失的旧版文件上。

  > S8（观测于 2026-09-23 的评审轮，登记提交在 2026-09-24）：正文里的 `Closes #139` 改成 `Refs #139`，等 3.5 分钟后回读，`gh pr view 161 -R SingularityKChen/harness-projects --json closingIssuesReferences` 从 `[139]` 变成 `[]`，`gh issue view 139 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences` 从 `[161]` 变成 `[]`，#139 仍 `OPEN`。

  > 补充（2026-09-28，Batch 2 当时）：登记 S8 的旧版文件与提交 `029d5cf` 不在远端 ref 上。后来 #161 合入的是重建、归档后的计划；它没有恢复 S8，这段内联引文仍是该次观测在本 PR 内的证据副本。
- `AGENTS.md` §6、`docs/development/repository-rules.md` §4 —— 分支前缀白名单。

**合并回读（2026-09-28）。** `#159`（`2026-09-23T14:00:26Z`）与 `#158`（`2026-09-23T14:07:31Z`）已合入 `main`，`#115` 与 `#128` 随之 `CLOSED`；`#160` 于 `2026-09-28T03:07:39Z` 合入 `main`（rebase merge 落在 `de3c42b`），`#137` 随之 `CLOSED`。Batch 2 当时 #161 仍 `OPEN`、base 已自动改回 `main`；**Superseded by Batch 3 回读**：#161 于 `2026-09-28T10:55:01Z` 合入 `main`（`4ff0172`），其 `closingIssuesReferences = []`，#139 仍 `OPEN`。易失状态以命令现读为准：`gh pr view <n> -R SingularityKChen/harness-projects --json state,mergedAt,baseRefName,closingIssuesReferences` 与 `gh issue view 139 -R SingularityKChen/harness-projects --json state,closedByPullRequestsReferences`。

## Design / Spec

**决策 1：保留两次观测，删掉结论。** 只留下能同时支撑两次观测的表述。理由：`PLANS.md` §4 要求活文档在被推翻时就地标注而不是静默重写，而这里两次观测都是真的、都有回读命令，删掉任何一次都会让下一个人重犯同一个错。**放弃的方案**：只保留第二次观测（会丢掉「不撤回」这个真实反例，而那正是 #108 遗留后果的依据）。

**决策 2：不给出机制。** 本文件在 §4.4 已经因为「把相关性写成机制」返工过一次（同一批次里，栈内 PR 的 CI 结论那条断言被实测证伪）。所以这次只写观测与回读命令，机制留给受控实验。

**决策 3：`feat/` 前缀按已登记偏差处理，不改名。** 改一个 PR 的 head 分支在 GitHub 上不可行——只能关掉再重开，那会连同全部 review thread 一起丢失，代价远大于前缀不一致。所以：登记偏差、写明后续新分支用白名单前缀、是否把 `feat/` 收进白名单留给维护者。本 PR **只登记、不改规则**，所以不需要额外批准——改白名单是改 `AGENTS.md` 与 `docs/development/repository-rules.md` 的另一个闭环。**放弃的方案**：改 `AGENTS.md` 的白名单来迁就现状——那是「让规则追上实践」；而 2026-09-24 那天按远端 heads 的权威口径，白名单前缀并不少于 `feat/`（同样的 `git ls-remote --heads origin | sed 's#.*refs/heads/##' | grep -oE '^(feat|feature)/' | sort | uniq -c` 读数为 `feat/` 2、`feature/` 5），所以规则并没有被实践统一否定。该读数是**带日期的抽样**：2026-09-28 复读为 `feat/` 1、`feature/` 0（白名单前缀的分支都随合并被删除了），今天的读数对这个判断既不给支持也不给反证。读数与结论的单一出处是 `docs/project-management/merge-queue.md` §4.7。

**不变量。** 本次只改文档，不改代码、workflow 或 capability。

## Global Constraints

- 只改 `docs/project-management/merge-queue.md`、`docs/README.md`（计划索引）、本次新增并归档的 ExecPlan，以及 `docs/exec-plan/completed/2026-09-24-engineering-writer-terminal.md` 里被本次改动推翻的描述（就地加 `Superseded by` 标注，理由见 D6）；不碰 `AGENTS.md`、`scripts/`、`packages/`。
- 文档正文中文；命令与路径英文；**不写本机绝对路径**。
- 在案的实测数字必须钉住跑它时的对象（PR 号、时间戳、命令），易失值写成「回读命令 + 期望」而不是快照。
- 文档变更 ≤1500 行。

## Plan of Work

**Batch 1：订正 §7 并回读本批次合并结果。**

1. §7：标题从「关闭引用一旦登记，就不会随正文编辑撤回」改成两次观测的并列；保留 #108 的原文与命令；补 #161 的观测与命令；结论改成「两个方向都不成立」+ 两条操作规则（改完必须回读、未撤回时按 #108 那节处理）。
2. §4.7：新增「合并结果回读」一段（当时写的是 #159/#158 已合并与时间、#160/#161 仍 OPEN 及原因；**该状态已在 Batch 2 按 2026-09-28 回读订正**）；新增「分支前缀的一处已登记偏差」一段。
3. 新增本 ExecPlan，并在 `docs/README.md` 的 Active 计划索引表插入一行。

**Batch 2：按 2026-09-28 的复读订正易失状态与悬空的证据路径。**

1. §4.7：把「#160 与 #161 仍 OPEN」改成带日期的回读（#160 于 `2026-09-28T03:07:39Z` 合入、#161 的 base 已被自动改回 `main`），原文就地加 `Superseded by` 标注；订正 #161 那一行的 base 列与依赖列。
2. §7：给观测一补「后续复读」边界（同两条命令在 2026-09-28 读到 `[25]` 与 `[]`），写明区块里的输出不是现值；把两条回读命令写成字段名 + `-R` 形式；修掉「#108 的具体后果」里那句被本节结论禁止的预测。
3. 本计划：删掉已经不成立的 `feat/human-execution-provider` 分支路径回读命令（该文件在 `main` 与 PR #161 当前 head 上都不存在），改成可复现的失败判据；回填验收项 7 的实测证据；订正文件集、回滚说明与「15 : 11」这处自相矛盾。
4. `docs/exec-plan/completed/2026-09-24-engineering-writer-terminal.md`：给描述旧 §7 的那一行加 `Superseded by` 标注（D6）。

**Batch 3：按 PR #161 合并后的新基线复读并归档。**

1. 将 PR #181 变基到包含 #161 的 `main`；核对补丁、恢复锚点与当前 base/head。
2. §4.7 给 #161 的旧队列位置与 `OPEN` 快照加后续合并回读；确认 #139 的两侧关闭引用仍为空。
3. 本计划说明 #161 的重建计划已在 `completed/`，但不含旧版 S8；验收后移入 `completed/` 并更新 `docs/README.md`。

验证命令与期望输出：

```bash
export npm_config_manage_package_manager_versions=false
grep -c '^\*\*关闭引用一旦登记' docs/project-management/merge-queue.md   # 期望 0
grep -n "两个方向都不成立" docs/project-management/merge-queue.md   # 期望 1 行
node scripts/rule-checks.mjs size origin/main                       # 期望 exit 0，文档在 1500 行内
node scripts/rule-checks.mjs disclosure origin/main                 # 期望 exit 0
git diff --check origin/main...HEAD                                 # 期望无输出
```

**回滚点**：对本 PR 的提交按逆序 `git revert`；没有本 PR 造成的外部状态写入。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 普适断言不再作为断言出现，两次观测都在 | `grep -c '^\*\*关闭引用一旦登记'` = 0（该短语只作为被删规则的原话出现在引号内）；`grep -c "观测一"` 与 `grep -c "观测二"` 各 ≥1 |
| 2 | 结论与两次观测都相容 | §7 的结论句是「两个方向都不成立」，且给出两条回读命令 |
| 3 | 本批次合并结果已回读（Batch 1–3） | §4.7 有 `#159`/`#158`/`#160`/`#161` 的合并时间；旧 `OPEN` 快照在原处标 `Superseded by`，并给出回读命令 |
| 4 | 分支前缀偏差已登记 | §4.7 有「已登记偏差」一段，含白名单原文、带日期的读数与不改名的理由 |
| 5 | 体量与发布面 | `rule-checks size`/`disclosure` exit 0；`git diff --check` 无输出 |
| 6 | issue 关联 | PR 侧 `closingIssuesReferences = [180]`，issue 侧 `closedByPullRequestsReferences` 含本 PR |
| 7 | 本计划引用的每个仓库路径都能解析，或按登记的历史路径解释 | 命令与逐条实测输出见下方「验收项 7 的实测证据」（2026-09-28 实跑；Batch 3 重算） |

**验收项 7 的实测证据（2026-09-28，在检出 `docs/merge-queue-closing-refs` 的工作树根目录运行）**：

```bash
for p in $(grep -oE '`[A-Za-z0-9_./-]+\.(md|mjs|json|js|ts|yml)`' \
             docs/exec-plan/completed/2026-09-24-merge-queue-closing-refs.md | tr -d '`' | sort -u); do
  git cat-file -e "HEAD:$p" 2>/dev/null && echo "OK     $p" || echo "ABSENT $p"
done
# 实测输出：
#   OK      AGENTS.md
#   OK      docs/development/content-placement.md
#   OK      docs/development/repository-rules.md
#   ABSENT  docs/exec-plan/active/2026-09-24-human-execution-provider.md
#   OK      docs/exec-plan/completed/2026-09-24-engineering-writer-terminal.md
#   OK      docs/project-management/merge-queue.md
#   OK      docs/README.md
#   OK      docs/review/responding.md
#   OK      PLANS.md
#   OK      tests/contract/content-placement.test.js
```

以上输出是 Batch 2 的历史快照。Batch 3 于 2026-09-28 在归档后的工作树重新运行同一循环：10 条 `OK`，2 条 `ABSENT`（`active/2026-09-24-human-execution-provider.md` 与带 `docs/exec-plan/` 前缀的同一路径）；两条都只指向已消失的原版 S8，本计划已将观测内联。新归档版 `docs/exec-plan/completed/2026-09-24-human-execution-provider.md` 为 `OK`；本计划的归档路径由 `git cat-file -e HEAD:docs/exec-plan/completed/2026-09-24-merge-queue-closing-refs.md` 另行验证成功。提取器会分别匹配完整路径与文内的短路径，故两个 `ABSENT` 指向同一历史文件。复算前先 `git merge-base origin/main HEAD` 锁定实际基线。

## Progress

- [x] 2026-09-24 Batch 1：§7 订正、§4.7 回读与偏差登记、ExecPlan 与索引。
- [x] 2026-09-28 Batch 2：按复读订正 §4.7 的易失状态（#160 已合入、#161 的 base 改回 `main`）、给观测一补复读边界、修掉悬空的证据路径与验收证据、就地标注被推翻的旧 §7 描述。
- [x] 2026-09-28 Batch 3：按包含 #161 的新 `main` 变基、回读 #161 与 #139、更新历史出处并归档本计划。

## Surprises & Discoveries

- **§7 的普适结论被同一批次的另一次观测推翻。** 这不是本次任务要找的东西——它是在回复 PR #161 的第二轮评审、把 `Closes #139` 改成 `Refs #139` 之后回读时发现的。它说明本文件里凡是「一次观测 → 一句规则」的写法都需要复核；本次只订正了已经拿到反证的那一条，其余各条维持原状并在 §4.4 的既有纪律下运行。
- **`feat/` 与 `feature/` 在仓库里同时存在（2026-09-24）**，而白名单只写了 `feature/`。规则与实践已经分叉了一段时间，只是没有人在评审里点名。**该条最初记的计数 `15 : 11` 是错的**（口径与订正后的读数见 D3 与 `docs/project-management/merge-queue.md` §4.7，本处不复述数字）。

## Decision Log

| # | 决策 | Rationale | 日期/作者 |
|---|---|---|---|
| D1 | 保留两次观测、删掉普适结论 | 两次都是真的且都可复现；删掉任何一次都会让下一个人重犯同一个错 | 2026-09-24 / 批次执行者 |
| D2 | 不给机制 | 本文件 §4.4 已因「把相关性写成机制」返工过一次（栈内 PR 的 CI 结论那条被实测证伪） | 2026-09-24 / 批次执行者 |
| D3 | `feat/` 前缀不改名，按已登记偏差处理 | 改名必须关掉再重开 PR，会连同 review thread 一起丢失；代价远大于前缀不一致 | 2026-09-24 / 批次执行者 |
| D4 | 链接守卫不在本 PR 做，另开 #182 | 朴素扩展实测 448 条引用 291 条误报，对象是把 `tests/contract/content-placement.test.js` 的提取器套到 `docs/exec-plan/active/**` 上、在 2026-09-24 的工作树上跑（未固化命令，只作量级判据）；`docs/development/content-placement.md` §5 把链接检查记为「从未实现」的缺口，并声明该表是观察记录、不是路由分类 | 2026-09-24 / 批次执行者 |
| D5 | 按 2026-09-28 复读订正 §4.7 的易失状态与观测一的边界 | `PLANS.md` §4 要求易失状态写成「回读命令 + 期望」、被推翻的结论就地标注；`#160` 在本 PR 的提交写出前 24 分钟已合入，原文在合并当天就会变成假的；观测一原记的输出也不再可复现 | 2026-09-28 / 批次执行者 |
| D6 | 就地标注 `docs/exec-plan/completed/2026-09-24-engineering-writer-terminal.md` 里对旧 §7 的描述 | 那是 `main` 上最后一处仍把被推翻的断言写成 §7 现状的地方（全仓 grep）；`PLANS.md` §4 要求在**原处**标注，`AGENTS.md` §12 的目的是避免引用静默失效。只加一行 `Superseded by`，不改该计划的任何结论 | 2026-09-28 / 批次执行者 |
| D7 | PR #161 合入后补读数并归档本计划 | `main@4ff0172` 已含重建的 #161 计划，原「没有远端文件」与 #161 `OPEN` 的说法不能继续表示现状；验收已完成，按 `PLANS.md` §2 移入 `completed/` | 2026-09-28 / 批次执行者 |

## Idempotence and Recovery

- 本次只有文档改动，重复执行无副作用。
- 失败恢复：对已有文件可从基线检出；整体回退按逆序 `git revert` 本 PR 的提交。
- 没有外部状态写入：不改看板、不改分支保护、不改任何 workflow。

## Interfaces and Dependencies

- `gh` CLI（回读 PR/issue 的关闭关联与合并状态），已认证。
- 无新增依赖；无凭据需求；无仓库设置变更。

## Outcomes & Retrospective

本计划只改文档，实现与验证都已落地。

**Batch 1（2026-09-24）**

- **§7 的普适断言已删除**，两次相反的观测都在，结论换成两条操作规则；标题只描述「读到了什么」，不写因果（D2）。
- **§4.7 补了两段**：合并结果回读、分支前缀的已登记偏差。第一段当时写的「#160 与 #161 仍 OPEN」已在 Batch 2 按复读订正。
- **一处 P1 由独立评审发现并已修**：本计划原来引用 `docs/exec-plan/active/2026-09-24-human-execution-provider.md` 作为「证伪的原始观测」的出处；观测本身已内联进本计划。
- **一处 P2 已修**：`feat/` : `feature/` 的计数原来是 `git for-each-ref` 的口径（含本地陈旧分支与 remote-tracking ref），15 : 11 是错的；已换成「带日期的抽样 + 以命令的当前输出为准」，读数与结论写在 `docs/project-management/merge-queue.md` §4.7 一处。

**Batch 2（2026-09-28，第九轮评审的对抗审计）**

- **一处 P1 是上一轮修复留下的**：上一轮把观测内联了，但**出处路径本身站不住**——`docs/exec-plan/active/2026-09-24-human-execution-provider.md` 在 `main` 上没有，在 PR #161 的当前 head 上也没有（`git cat-file -e` 失败，2026-09-28 实测），所以当时给出的 `git show origin/feat/…` 回读命令必然报错。本批次改成「不在任何可回读位置」+ 可复现的失败判据。
- **一处 P1 是本 PR 自己写出来的**：§4.7 的「`#160` 与 `#161` 仍 OPEN」在本 PR 的提交写出前 24 分钟已被 #160 的合并推翻。按 `PLANS.md` §4 就地标 `Superseded by`，补一条带日期与命令的回读；#161 那一行的 base 列与依赖列同时订正。
- **观测一的读值不再可复现**（同两条命令 2026-09-28 读到 `[25]` 与 `[]`）：补「后续复读」边界，写明区块里的输出不是现值。这不推翻本节结论，反而是它的又一例。
- **形式与证据的收敛**：文件集、回滚说明、`-R` 与检出上下文、验收项 7 的实测输出、`15 : 11` 的自相矛盾、`docs/development/content-placement.md` §5 的引文口径都在本批次订正；`docs/exec-plan/completed/2026-09-24-engineering-writer-terminal.md` 里描述旧 §7 的那一行就地加标注（D6）。
- **没有做、已登记的事**：`docs/` 的引用/链接检查（`AGENTS.md` §9 要求、`docs/development/content-placement.md` §5 记为「从未实现」）仍然没有机械守卫。本计划的探针显示朴素的扩展不可行（对象、日期与误报量级见 D4，本处不复述数字）。这需要自己的设计批次，已另开 **#182**（含那组误报测量）。

**Batch 3（2026-09-28，PR #161 合并后）**

- `main@4ff0172` 已含 #161 的重建归档计划；它没有旧版 S8，因此本计划保留的内联观测仍是必要的。#161 的 `closingIssuesReferences` 与 #139 的 `closedByPullRequestsReferences` 均为空，#139 仍 `OPEN`。
- §4.7 的 #161 `OPEN` 快照已在原处标出后续合并回读。本计划按 `PLANS.md` §2 归档，索引迁到 `docs/README.md` 的 Completed 表。

## Bottom Change Note

- (2026-09-24) 创建：§7 订正、§4.7 合并结果回读与分支前缀偏差登记。
- (2026-09-24) 评审响应：修 P1 悬空路径（把观测内联）、修 P2 因果标题与失真的前缀计数、补 P3 的 §4.7 一致性、回填 Outcomes、登记链接守卫为独立批次。
- (2026-09-28) 维护：先 rebase 到 `main@547b2de`，解决 `docs/README.md` 索引冲突（两边都保留）；当时核对补丁与提交信息。**Superseded by Batch 3 的提交整理**：这些中间提交不再是最终发布的提交序列，不能用旧 SHA 回读本 PR。
- (2026-09-28) Batch 2：按复读订正 §4.7 的易失状态、补观测一的复读边界、修掉悬空的证据路径与验收证据、就地标注被推翻的旧 §7 描述（D5/D6）。
- (2026-09-28) Batch 3：变基到含 #161 的 `main@4ff0172`，补 #161 合并回读与归档版计划出处；归档本计划并更新索引（D7）。
- (2026-09-28) 提交整理：把四个同一闭环的中间提交收敛为一个提交；补丁内容以当前 PR 的 base/head 为准，旧 head 由本地恢复引用保存。
