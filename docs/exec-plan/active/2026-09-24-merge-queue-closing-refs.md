# 2026-09-24-merge-queue-closing-refs —— 订正关闭引用的普适断言，并回读本批次合并结果

> 载体 issue：<https://github.com/SingularityKChen/harness-projects/issues/180>
> 本计划同时是 spec 与 plan；正文中文，代码标识符、路径与命令英文。

## Purpose / Big Picture

`docs/project-management/merge-queue.md` §7 把**一次观测**写成了一条普适规则：「关闭引用一旦登记，就不会随正文编辑撤回」。这条规则决定了别人怎么计划合并后的补救动作——按它，改正文是没用的，必须合并后 `gh issue reopen`。2026-09-23 在 PR #161 上测到了相反的结果。

完成后：

1. §7 同时保留两次相反的实测，删掉那句普适结论，换成两个方向都能成立的操作规则；
2. §4.7 记录本批次已经发生的合并（#159 → #115、#158 → #128）与仍在修复的两层；
3. `feat/` 前缀这处已存在的偏差被登记下来，并写明后续新分支一律用白名单前缀。

判断成功的最小证据：

```bash
grep -c '^\*\*关闭引用一旦登记' docs/project-management/merge-queue.md   # 期望 0（那句标题已不再是断言）
grep -c "两个方向都不成立" docs/project-management/merge-queue.md    # 期望 1
node scripts/rule-checks.mjs size origin/main                        # 期望 exit 0
```

## Context and Orientation

**这一节要修的那句话。** §7 原文：

> **关闭引用一旦登记，就不会随正文编辑撤回（2026-09-21 实测）**

它的证据是 #108：正文里的 `Closes #4` 被删掉后等 3.5 分钟回读，`closingIssuesReferences` 仍是 `[4, 25]`。

**推翻它的第二次观测（PR #161，2026-09-23）。** 正文里的 `Closes #139` 改成 `Refs #139`，同样等 3.5 分钟后回读：

```bash
gh pr view 161 --json closingIssuesReferences             # 改前 [139] → 改后 []
gh issue view 139 --json closedByPullRequestsReferences   # 改前 [161] → 改后 []
```

**为什么这两次可以同时为真。** 本文件不给出机制——§4.4 已经记录过同一个字段的另一种反复（「从空变非空」），并明确写过「判定关闭关联永远读这两个字段本身，不要从正文推断」。这次是同一类事实的第三例。

**术语。**

- `closingIssuesReferences`：PR 侧登记的被关闭 issue 列表，`gh pr view <n> --json closingIssuesReferences`。
- `closedByPullRequestsReferences`：issue 侧的对应列表，`gh issue view <i> --json closedByPullRequestsReferences`。
- 两个字段都可能与正文**不一致**，所以它们才是判定对象。

**相关文件。**

- `docs/project-management/merge-queue.md` —— 本次唯一改动的文件（§7 与 §4.7）。
- `docs/review/responding.md` —— 回复评审与回读的既有流程。
- **证伪的原始观测**记在 PR #161 那一层的 ExecPlan（`Surprises & Discoveries` S8）里。该文件当前**只存在于未合并的 `feat/human-execution-provider` 分支**上，`main` 上没有它；回读命令是 `git show origin/feat/human-execution-provider:docs/exec-plan/active/2026-09-24-human-execution-provider.md | grep -n -A 8 '^### S8'`。因为本计划必须在 `main` 上自足（`PLANS.md` §4），**观测本身写在下面**，不把可解析性押在那条路径上：

  > S8（2026-09-23）：正文里的 `Closes #139` 改成 `Refs #139`，等 3.5 分钟后回读，`gh pr view 161 --json closingIssuesReferences` 从 `[139]` 变成 `[]`，`gh issue view 139 --json closedByPullRequestsReferences` 从 `[161]` 变成 `[]`，#139 仍 `OPEN`。
- `AGENTS.md` §6、`docs/development/repository-rules.md` §4 —— 分支前缀白名单。

**当前状态。** `#159`（`2026-09-23T14:00:26Z`）与 `#158`（`2026-09-23T14:07:31Z`）已合入 `main`，`#115` 与 `#128` 随之 `CLOSED`；`#160` 与 `#161` 仍 OPEN，正在按第二轮评审修复。

## Design / Spec

**决策 1：保留两次观测，删掉结论。** 只留下能同时支撑两次观测的表述。理由：`PLANS.md` §4 要求活文档在被推翻时就地标注而不是静默重写，而这里两次观测都是真的、都有回读命令，删掉任何一次都会让下一个人重犯同一个错。**放弃的方案**：只保留第二次观测（会丢掉「不撤回」这个真实反例，而那正是 #108 遗留后果的依据）。

**决策 2：不给出机制。** 本文件在 §4.4 已经因为「把相关性写成机制」返工过一次（同一批次里，栈内 PR 的 CI 结论那条断言被实测证伪）。所以这次只写观测与回读命令，机制留给受控实验。

**决策 3：`feat/` 前缀按已登记偏差处理，不改名。** 改一个 PR 的 head 分支在 GitHub 上不可行——只能关掉再重开，那会连同全部 review thread 一起丢失，代价远大于前缀不一致。所以：登记偏差、写明后续新分支用白名单前缀、是否把 `feat/` 收进白名单留给维护者。**放弃的方案**：改 `AGENTS.md` 的白名单来迁就现状——那是「让规则追上实践」，而远端上 `feature/` 反而比 `feat/` 多（2026-09-24 实测 `feat/` 2 条、`feature/` 5 条），规则并没有被实践统一否定。

**不变量。** 本次不改任何代码、不改任何 workflow、不改任何 capability；只改一份文档。

## Global Constraints

- 只改 `docs/project-management/merge-queue.md` 与本次新增的 ExecPlan；不碰 `AGENTS.md`、`scripts/`、`packages/`。
- 文档正文中文；命令与路径英文；**不写本机绝对路径**。
- 在案的实测数字必须钉住跑它时的对象（PR 号、时间戳、命令），易失值写成「回读命令 + 期望」而不是快照。
- 文档变更 ≤1500 行。

## Plan of Work

**Batch 1（唯一批次）：订正 §7 并回读本批次合并结果。**

1. §7：标题从「关闭引用一旦登记，就不会随正文编辑撤回」改成两次观测的并列；保留 #108 的原文与命令；补 #161 的观测与命令；结论改成「两个方向都不成立」+ 两条操作规则（改完必须回读、未撤回时按 #108 那节处理）。
2. §4.7：新增「合并结果回读」一段（#159/#158 已合并与时间、#160/#161 仍 OPEN 及原因）；新增「分支前缀的一处已登记偏差」一段。
3. 新增本 ExecPlan，并在 `docs/README.md` 的 Active 计划索引表插入一行。

验证命令与期望输出：

```bash
export npm_config_manage_package_manager_versions=false
grep -c '^\*\*关闭引用一旦登记' docs/project-management/merge-queue.md   # 期望 0
grep -n "两个方向都不成立" docs/project-management/merge-queue.md   # 期望 1 行
node scripts/rule-checks.mjs size origin/main                       # 期望 exit 0，文档在 1500 行内
node scripts/rule-checks.mjs disclosure origin/main                 # 期望 exit 0
git diff --check origin/main...HEAD                                 # 期望无输出
```

**回滚点**：本批次只有一个提交，`git revert` 即可；没有外部状态写入。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 普适断言不再作为断言出现，两次观测都在 | `grep -c '^\*\*关闭引用一旦登记'` = 0（该短语只作为被删规则的原话出现在引号内）；`grep -c "观测一"` 与 `grep -c "观测二"` 各 ≥1 |
| 2 | 结论与两次观测都相容 | §7 的结论句是「两个方向都不成立」，且给出两条回读命令 |
| 3 | 本批次合并结果已回读 | §4.7 有 `#159`/`#158` 的合并时间与 `#160`/`#161` 的当前状态 |
| 4 | 分支前缀偏差已登记 | §4.7 有「已登记偏差」一段，含白名单原文与不改名的理由 |
| 5 | 体量与发布面 | `rule-checks size`/`disclosure` exit 0；`git diff --check` 无输出 |
| 6 | issue 关联 | PR 侧 `closingIssuesReferences = [180]`，issue 侧 `closedByPullRequestsReferences` 含本 PR |
| 7 | 本计划引用的每个仓库路径都能解析 | 逐条 `test -e <path>`；**只列本计划引用的、位于本仓库内的路径**，不列命令、不列分支上才有的路径。实测命令：见下 |

## Progress

- [x] 2026-09-24 Batch 1：§7 订正、§4.7 回读与偏差登记、ExecPlan 与索引。

## Surprises & Discoveries

- **§7 的普适结论被同一批次的另一次观测推翻。** 这不是本次任务要找的东西——它是在回复 PR #161 的第二轮评审、把 `Closes #139` 改成 `Refs #139` 之后回读时发现的。它说明本文件里凡是「一次观测 → 一句规则」的写法都需要复核；本次只订正了已经拿到反证的那一条，其余各条维持原状并在 §4.4 的既有纪律下运行。
- **`feat/` 与 `feature/` 在仓库里同时存在**（15 : 11），而白名单只写了 `feature/`。规则与实践已经分叉了一段时间，只是没有人在评审里点名。

## Decision Log

| # | 决策 | Rationale | 日期/作者 |
|---|---|---|---|
| D1 | 保留两次观测、删掉普适结论 | 两次都是真的且都可复现；删掉任何一次都会让下一个人重犯同一个错 | 2026-09-24 / 批次执行者 |
| D2 | 不给机制 | 本文件 §4.4 已因「把相关性写成机制」返工过一次（栈内 PR 的 CI 结论那条被实测证伪） | 2026-09-24 / 批次执行者 |
| D3 | `feat/` 前缀不改名，按已登记偏差处理 | 改名必须关掉再重开 PR，会连同 review thread 一起丢失；代价远大于前缀不一致 | 2026-09-24 / 批次执行者 |
| D4 | 链接守卫不在本 PR 做，另开 #182 | 朴素扩展实测 448 条引用 291 条误报（fenced code / 命令行 / 相对文件名 / `<placeholder>`），不是二十行扩展；`content-placement.md` §5 已把这类检查记为需要自己的设计批次 | 2026-09-24 / 批次执行者 |

## Idempotence and Recovery

- 本次只有文档改动，重复执行无副作用。
- 失败恢复：`git checkout origin/main -- docs/project-management/merge-queue.md` 回到基线；本批次只有一个提交，`git revert <sha>` 即可整体回退。
- 没有外部状态写入：不改看板、不改分支保护、不改任何 workflow。

## Interfaces and Dependencies

- `gh` CLI（回读 PR/issue 的关闭关联与合并状态），已认证。
- 无新增依赖；无凭据需求；无仓库设置变更。

## Outcomes & Retrospective

本批次只改文档，实现与验证都已落地：

- **§7 的普适断言已删除**，两次相反的观测都在，结论换成两条操作规则；标题只描述「读到了什么」，不写因果（D2）。
- **§4.7 补了两段**：合并结果回读（#159/#158 已合并、#160/#161 仍 OPEN）、分支前缀的已登记偏差。
- **一处 P1 由独立评审发现并已修**：本计划原来引用 `docs/exec-plan/active/2026-09-24-human-execution-provider.md`，而该路径只存在于未合并的 #161 分支上——`main` 上悬空。已把观测本身写进本计划，并把那条路径标注为「只在该分支上」+ 回读命令。
- **一处 P2 已修**：`feat/` : `feature/` 的计数原来是 `git for-each-ref` 的口径（含本地陈旧分支与 remote-tracking ref），15 : 11 是错的；远端权威口径是 2 : 5。
- **没有做、已登记的事**：`docs/` 的引用/链接检查（`AGENTS.md` §9 要求、`docs/development/content-placement.md` §5 记为「从未实现」）仍然没有机械守卫。本计划的探针显示朴素的扩展不可行——把 `tests/contract/content-placement.test.js` 的提取器直接套到 `docs/exec-plan/active/**` 上，448 条引用里 **291 条误报**（fenced code、命令行、相对文件名、`<placeholder>` 都被当成仓库路径）。这需要自己的设计批次，已另开 **#182**（含上面那组误报测量）。

## Bottom Change Note

- (2026-09-24) 创建：§7 订正、§4.7 合并结果回读与分支前缀偏差登记。
- (2026-09-24) 评审响应：修 P1 悬空路径（把观测内联）、修 P2 因果标题与失真的前缀计数、补 P3 的 §4.7 一致性、回填 Outcomes、登记链接守卫为独立批次。
