# 合并队列

本文档回答一个问题：评审队列里这些还没合并的 PR，应该按什么顺序合并，遇到冲突时怎么处理。**验收标准**：一个没有上下文的人只读这份文件，不打开任何一个 PR 描述，就能把队列合并完。

## 1. 为什么需要这份文件

2026-09-18 完成的一轮评审留下 9 个开放 PR，那一轮的合并顺序**没有任何长期载体**——只活在 PR 描述里，而 PR 描述不是仓库内容：它不受 `AGENTS.md` 的文档规范约束，也不会随 `git checkout` 出现在工作区里，下一个接手的人只能一个个点开 PR 去拼凑。实测发现当时同时存在三份互不一致的说法：

- PR #12 的 ExecPlan 冻结了 `#12 → #19 → #21 → #35` 四个 PR 的顺序；按这个顺序 #35 排在 #33 之前，但那时 #35 的 ExecPlan 链接指向一份还没合并的文件，是悬空的。
- PR #33 的 `Interfaces and Dependencies` 只给出了第 1–6 位，没提后面的 PR。
- PR #35 的描述说自己排第 9 位；PR #37 没有说明自己的位置。

更严重的是，「无冲突」的声明本身有一处是错的：PR #33 说已经用 `git merge-tree` 预演过并确认无冲突，但那次预演只针对 #3（#3 改的是 `docs/README.md` 的 Completed 表）。而 #12 同样改 `docs/README.md`，且它替换的是 Active 表里与 #33 相同的那一行占位；#33 要求排在 #12 之后，也就是说被预演的根本不是它实际会先遇到的那个 PR。实测证实了这处冲突（完整记录见第 5 节）。

这三个事实指向同一个结构性问题：**合并顺序与冲突预演结论是易失状态**，只存在于个别 PR 作者的记忆或某一次会话里，下一个接手的人（人或 agent）无法从仓库内容把它重建出来。这份文件把它变成持久状态：谁排第几、依赖谁、已知会在哪里冲突、冲突怎么解，都在第 4 节的表里，随每一次合并更新。

## 2. 怎么用这份文件

### 2.1 顺序怎么定

一个 PR 的位置由它的「依赖」决定，不是由 PR 编号或提出时间决定：

- 如果 PR X 声明依赖 PR Y——无论理由是 X 的 ExecPlan 链接在 Y 合并前是悬空的，还是两者改了同一处内容——X 必须排在 Y 之后。
- 互相没有声明依赖的 PR，彼此顺序不限；但一旦为实际合并选定了一个顺序，必须把它写回第 4 节的表格，不能只停留在执行者的记忆或某一次会话里——那正是第 1 节要修的问题的最小复现。
- 新 PR 加入队列时，在第 4 节插入新的一行，并重新核实排在它之后的每个 PR 的「依赖」列是否需要跟着变化。

### 2.2 怎么验证一条「无冲突」声明

2026-09-18 那次失败的根因不是没做预演，而是**预演的对象选错了**：#33 声明自己排在 #12 之后，却只对 #3 做了预演。由此得到的规则是——

> 一个 PR 的「无冲突」声明，必须对**它在这张表里声明的合并位置之前的每一个 PR**做预演；不能只挑其中一个看起来相关的对象。

预演不是对某一个分支跑一次 `git merge-tree` 就结束，而是在一次性的 clone 里，按第 4 节当前的顺序从位置 1 开始依次把排在前面的分支变基上去，模拟出"这些 PR 都已经合并"之后的状态，最后再看自己的分支能否干净地接上去：

```bash
# 在会话的临时目录里建一次性 clone；不要在真实 worktree 或 .worktrees/ 下做
git clone https://github.com/SingularityKChen/harness-projects.git <临时目录> && cd <临时目录>
git checkout -B queue-tip origin/main   # 代表"排在自己前面的 PR 都已合并"的假想 main

# 对第 4 节里排在自己前面的每一个 PR，按位置从 1 开始依次执行：
git checkout origin/<该位置的分支>
git rebase queue-tip                    # 冲突会在这一步出现，而不是留到最后一步才发现
git branch -f queue-tip HEAD && git checkout queue-tip

# 排在前面的 PR 都"合并"完之后，最后变基自己的分支，这一步的结果才是真正要看的
git checkout origin/<自己的分支>
git rebase queue-tip
```

预期输出：没有冲突时 `git rebase` 静默成功，工作区回到 `queue-tip` 之上；有冲突时会打印 `CONFLICT (content): Merge conflict in <file>` 并把 rebase 停在中间状态，此时正确的做法是记录下冲突文件与冲突原因，写回第 4 节的「已知冲突点与解法」列，而不是就地强行解决后当作没发生过。

这个循环比对单个分支跑 `git merge-tree` 更贵，但它验证的是规则要求的那个命题；用 `git merge-tree <merge-base> A B` 做的是另一个更便宜、但严格弱于它的命题——"A 和 B 两者本身干净"，不代表"A 排在 B 声明的位置上能干净合并"，2026-09-18 的失败正是把弱命题当成了强命题的证明。

### 2.3 GitHub 的 rebase merge 拒绝时怎么办

本仓库的分支保护只允许 rebase merge（`AGENTS.md` §8.3 第 4 条）。GitHub 的 "Rebase and merge" 按钮只在**变基本身能自动完成**时可用——它不会替你解决冲突，冲突时按钮不可用或直接报错拒绝。这时必须本地变基、手动解决、再强推：

```bash
git fetch origin
git checkout <自己的分支>
git rebase origin/main
# 出现冲突：按第 4 节该行「已知冲突点与解法」列处理；
# 目前观察到的形态全部是"两边都保留"——两处改动都留下，按小节手动拼合
git add <冲突文件>
git rebase --continue
pnpm verify                              # 变基会改变文件内容，必须重新验证；期望：typecheck 与全部测试通过
node scripts/workflow-check.mjs          # 期望：no findings，exit 0
node scripts/rule-checks.mjs disclosure  # 期望：机械扫描通过，exit 0
node scripts/rule-checks.mjs size        # 期望：文档/代码行数都在 AGENTS.md §8.3 的上限内，exit 0
git push --force-with-lease origin <自己的分支>
```

用 `--force-with-lease` 而不是 `--force`：如果远端分支在此期间被别人或另一个 agent 会话推过新提交，`--force-with-lease` 会拒绝覆盖，`--force` 不会。推送后 PR 页面的 "Rebase and merge" 按钮应变为可用；谁有权限执行合并见 `AGENTS.md` §8.3 第 3 条——禁止自行合并，是否合并由人类伙伴决定。

合并完成后：把第 4 节对应行标记为已合并（注明日期与最终落在 `main` 上的 commit SHA），并对**下一个**还未合并的 PR 重新核实一次「无冲突」声明——它现在要对的是真实的 `origin/main`，不是预演时的假设状态。

### 2.4 PR 前与最终 push 前的提交整理

开 PR 前、以及最终 push 前，执行一次提交整理：删除临时调试和 fixup，把同一批次收敛成可独立审阅的提交序列；整理后重新运行本批验证、敏感信息检查和体量检查。分支已推送时先创建恢复锚点：

    git fetch origin
    git ls-remote origin refs/heads/<自己的分支>
    git branch backup/<自己的分支>-before-reorg <当前本地 head>
    git range-diff origin/main...<旧 head> origin/main...<整理后 head>
    git push --force-with-lease=refs/heads/<自己的分支>:<旧远端 head> origin <整理后 head>:refs/heads/<自己的分支>

push 后必须回读当前 PR head/base、CI、issue 关联和 review threads。draft PR 只有在最终 head 的 checks 通过后才执行：

    gh pr ready <n>
    gh pr view <n> --json isDraft,baseRefName,headRefOid,mergeable,mergeStateStatus
    gh pr checks <n>

如果 PR 已经是 ready，仍然要回读；不要把旧 head 的 ready 状态当作新 head 的验收证据。

## 3. 队列表的列

| 列 | 含义 |
|---|---|
| 位置 | 合并顺序；同一数字范围内的多个 PR 表示互不依赖、可任意排列（见 2.1）。非数字取值只允许「本轮不合并」，用于范围已确定但当前不参与排队的 PR，理由写在「已知冲突点与解法」列；不允许「待定」——它不落在这两类里的任何一类，会让按位置顺序读表的人卡住 |
| PR | PR 编号与它在 ExecPlan 里的批次代号 |
| 分支 | head 分支名 |
| 交付 | 这个 PR 独立构成的能力闭环，以及它关联（`Closes`）的 issue |
| 依赖 | 必须排在它之前合并的 PR，及依赖的理由 |
| 已知冲突点与解法 | 预演或实测发现的冲突文件/小节，以及采用的解法（目前观察到的都是"两边都保留"） |

## 4. 当前队列

五个 PR 属于同一份 ExecPlan（`docs/exec-plan/active/2026-09-18-rule-semantics-and-checker-convergence.md`）的五个批次，另有两个来自**其它会话**的 PR 与它们交织。

顺序在 2026-09-18 的验收阶段按实测修订过一次，修订理由见位置 1 那一行——它是本文件第 6 节那条新增教训的来源。

| 位置 | PR | 分支 | 交付 | 依赖 | 已知冲突点与解法 |
|---|---|---|---|---|---|
| 1 | #60（Batch E） | `fix/rule-checks-hardening` | Closes #40 #41——发布面扫描补凭据与逐提交扫描，体量分桶修正 | 无 | 改 `AGENTS.md` §8.3/§8.6 |
| 2 | #56（Batch A） | `docs/board-planning-semantics` | Closes #55——`Status` 的规划轴/工程轴定义与九条内置工作流的推导规则 | 无硬依赖 | 不改 `AGENTS.md`；与 **#61 在 `scripts/board-workflow-check.mjs` 上曾硬冲突**，已按裁决把 #61 的模型吸收进本 PR |
| 3 | #57（Batch B，本 PR） | `docs/process-records` | Closes #46 #47——本文件与 `AGENTS.md` §10 的 agent 写入边界 | 无硬依赖 | 改 `AGENTS.md` §10，与 PR-C 的 §9.5 相邻，预期「两边都保留」 |
| 4 | #58（Batch C） | `fix/workflow-check-false-greens` | Closes #38——六类假绿收敛，新增 W7 | 无硬依赖 | 改 `AGENTS.md` §9.5，同上 |
| 5 | #59（Batch D） | `fix/policy-check-hardening` | Closes #39——入口守卫与取值加固 | 无硬依赖 | 改 `AGENTS.md` §8.7，与 §8.6 相邻 |
| 6 | #63（另一会话） | `fix/link-context-stripping` | Closes #62——剥离不生效上下文 | **5**（分支直接叠在 #59 之上） | 叠加分支，#59 之前不可合并；按当前顺序实测变基到此位置时，`docs/exec-plan/active/2026-09-18-rule-semantics-and-checker-convergence.md` 冲突（两处 hunk：`Progress`/执行期间的偏差起、`Bottom Change Note` 起）——原因是 #56 相对共享种子已经改了同一份文件（87 行新增、16 行删除，非纯追加，详见下文关于种子提交的说明），先于 #63 进入 queue-tip；#63 自己也在同一带追加了内容（41 行）。**解法**：两边都保留；`Progress` 的勾选与「执行期间的偏差」条目以**已经记录完成的一侧**为准，不得被对方带来的旧版本静默覆盖回未完成 |
| 本轮不合并 | #61（另一会话） | `chore/board-invariants` | #45 的运行时半边 | **2**（判定逻辑已并入 #56） | 与 #56 在 `scripts/board-workflow-check.mjs` 上曾是 add/add 冲突（同一 issue #45 的两种切法，见 §6.2 第 1 条），#56 已吸收 #61 的判定逻辑；按此前裁决，#61 需缩成只剩运行时取数与接线两部分并 rebase 到 #56 之后，缩减完成前不进入本轮排队。所需 `PROJECTS_TOKEN` 已存在（`gh secret list -R SingularityKChen/harness-projects` → 创建于 2026-09-18T06:13:44Z；以该命令的实时结果为准，不要假设这个日期不变），不再是阻塞项 |

**为什么位置 1 是 E 而不是 A。** 原计划把 E 排最后。实测发现：五个分支都带着那份 ExecPlan，而未加固的扫描器把计划里**列举误报字面量的那一行**判成真实泄漏——于是在 E 合并之前，另外四个完全合规的 PR 都挂着一个红的 `Disclosure scan`。E 与其余四个没有内容依赖，提前零成本。

本计划文件的**种子提交**在相关分支上逐字节相同——用 `git rev-parse <分支>:docs/exec-plan/active/2026-09-18-rule-semantics-and-checker-convergence.md` 逐分支比对可重新核实这一点（期望：共享种子提交的分支返回同一个 blob hash），下文只是某一时刻的快照，结论应以重新执行该命令为准，不要假设它长期成立。种子相同是每个 PR 单独看时 ExecPlan 链接都不悬空的原因——这与第 1 节描述的「悬空链接」问题不同；rebase 时 git 按 patch-id 把这个共同的种子提交识别为已应用并跳过。但**不是所有分支都停在种子提交上**：#56（位置 2）相对种子有 87 行新增、16 行删除（净增 71 行，307→378 行，非纯追加）；#63（位置 6）相对它所叠的 #59（同为 307 行的种子）有 41 行纯新增、零删除（307→348 行）——`git diff --stat <分支A> <分支B> -- <上面那条路径>` 可重验这组数字，同样应以重新执行为准。这部分改动都落在这份 ExecPlan 本身，不参与 patch-id 去重。实测结果是 #56 在自己的位置干净变基，真正的冲突出现在更晚的 #63——它的纯追加落进了 #56 已经动过的同一片区域（`Progress`/`Bottom Change Note`），具体冲突点与解法见位置 6 那一行。

这张表由每个批次自己维护：谁最终改了 `AGENTS.md` 的哪个小节，只有该批次的执行者知道确切结果；合并前请按 2.2 的步骤把「预期」验证成「实测」，并按 2.3 的模板记录实际解法与合并后的 commit SHA。

### 4.1 当前远端队列快照（2026-09-20）

上面的历史队列记录了 2026-09-18 的规则语义栈；当前远端开放 PR 只有 #69 和 #37，不能把历史位置直接套用：

| 位置 | PR | head | base | 状态 | 依赖与动作 |
|---|---|---|---|---|---|
| 1 | #69 | docs/repository-guidance @（以刷新命令返回的当前 head 为准） | main | ready，mergeable=true；最新 Rule checks / Issue policy / PR Fast Gate 均成功 | 本 PR 只改根指令和 docs，关联 #68；最终 push 后按 §2.4 回读，等待人类评审，不自行合并 |
| 本轮不合并 | #37 | chore/engineering-state @ b46c095 | main | 远端快照显示 BEHIND，需先 rebase 到当前 main 并重新验证 | 工程状态写入是独立高风险变更；#69 不改它，待其 owner 按当前 head 重新整理和验收 |

刷新此表必须执行：

    git fetch origin
    gh api 'repos/SingularityKChen/harness-projects/pulls?state=open&per_page=100' --jq '.[] | {number,title,draft,base:.base.ref,head:.head.ref,sha:.head.sha}'
    git ls-remote origin refs/heads/main refs/heads/docs/repository-guidance refs/heads/chore/engineering-state

### 4.2 MVP-0 并行堆叠 PR 队列（2026-09-20 起）

这一轮不是"一串待合并的 PR"，而是**三条栈**（详见 `docs/exec-plan/active/2026-09-20-mvp0-parallel-stacks.md`）。栈内必须自下而上合并；栈之间除了共享栈底 `chore/workspace-dependency-graph` 之外互不依赖。

| 栈 | 顺序 | PR | 分支 | base | Closes | 备注 |
|---|---|---|---|---|---|---|
| 底座 | 0 | #80 | `chore/workspace-dependency-graph` | main | #74 | 所有栈的栈底；必须先合并，否则其它 PR 的 base 不存在 |
| A 契约 | 1 | #81 | `feat/domain-identity-model` | `chore/workspace-dependency-graph` | #75 | 领域模型 |
| A 契约 | 2 | #84 | `feat/capability-contracts` | `feat/domain-identity-model` | #29 | 五域 port 与错误模型 |
| A 契约 | 3 | #85 | `feat/planning-contract-suite` | `feat/capability-contracts` | #30 | Planning/Storage 套件与替身；**新增包 `packages/providers/fake` 与本条一起落地** |
| A 契约 | 4 | #88 | `feat/development-contract-suite` | `feat/planning-contract-suite` | Refs #31 | development 域（由 1098 行超限拆出） |
| A 契约 | 5 | #86 | `feat/domain-contract-suites` | `feat/development-contract-suite` | #31 | delivery 与 execution 域 + 五域组合根 |
| B 持久化 | 1 | #82 | `feat/storage-migration-runner` | `chore/workspace-dependency-graph` | #26 | 与 A 栈并行 |
| D 文档 | 1 | #83 | `docs/vertical-path-and-gates` | `chore/workspace-dependency-graph` | #44 | 与 A/B 栈并行；本文件所在的 PR |
| C 切片 | 1 | #87 | `test/mvp0-chain-assertion` | `feat/domain-contract-suites` | #42 | 进度轨道；创建时故意是**红的**（7 条断言点名未实现节点），到 C 栈最后一批变绿才提升进 `pnpm verify` |
| C 切片 | 2 | #92 | `feat/core-bootstrap` | `test/mvp0-chain-assertion` | #76 | core 引导与投影；失败断言 7 → 4 |
| C 切片 | 3 | #93 | `feat/core-start-work` | `feat/core-bootstrap` | #77 | 写路径状态机与 Start Work 补偿序列；失败断言 4 → 2 |
| C 切片 | 4 | #94 | `feat/core-delivery-lineage` | `feat/core-start-work` | #78 | 交付谱系与状态策略；失败断言 2 → 0 |
| C 切片 | 5 | #95 | `feat/controller-client-slice` | `feat/core-delivery-lineage` | #79 #7 | controller 与 React-free client；把 `test:mvp0` 提升进 `verify` |

**已知冲突点与解法**（按 §2.2 的预演规则维护）

| 冲突点 | 涉及 | 解法 |
|---|---|---|
| `docs/exec-plan/active/2026-09-20-mvp0-parallel-stacks.md` 的 Progress 与决策小节 | A 栈各批次、C 栈 | 两边都保留；批次事实以 A 栈内追加的"订正"为准（控制计划里对 A3/A4 划分的初版描述已被契约栈计划订正两次） |
| `docs/README.md` §2 与 §4 | #80（§2 登记五份计划）与 #83（§4 登记产品主题文档） | 两处不同表格，两边都保留 |
| `pnpm-lock.yaml` | 只有 #85（新增 `packages/providers/fake`）动过 | 其余分支不得改锁文件；#85 之后的所有分支都已包含该条目 |
| `tests/contract/package-boundaries.test.js` | 只有 #80（新增两条检查）与 #85（登记新包）动过 | 两边都保留；`EXPECTED` 只允许 #85 追加一行 |

**堆叠 PR 与 CI 的实测行为**：`.github/workflows/ci.yml` 的触发条件是 `pull_request: branches: [main]`，因此**只有 base 指向 `main` 的 PR 会跑 `PR Fast Gate`**。本轮实测：#80 跑了 Disclosure scan / Issue policy / PR Fast Gate 且全绿，其余八个 PR 只跑了 advisory 的 `Issue policy`。也就是说栈内 PR 的"检查全绿"**不是 CI 证据**，而是本地等价命令的证据。接手的人要按下面的表逐分支复跑，或者先把 CI 的触发分支扩展（那是另一个批次，需要同步 `docs/development/ci.md` 与 `scripts/workflow-check.mjs`）。

栈内每个 head 上的本地等价门禁（`tsc --noEmit` + `node --test tests/contract tests/integration tests/e2e`，2026-09-20 实测）：

| 分支 | tsc | 测试 |
|---|---|---|
| `chore/workspace-dependency-graph` | OK | 183 pass / 0 fail |
| `feat/domain-identity-model` | OK | 198 pass / 0 fail |
| `feat/capability-contracts` | OK | 213 pass / 0 fail |
| `feat/planning-contract-suite` | OK | 233 pass / 0 fail |
| `feat/development-contract-suite` | OK | 246 pass / 0 fail |
| `feat/domain-contract-suites` | OK | 263 pass / 0 fail |
| `feat/storage-migration-runner` | OK | 188 pass / 0 fail |
| `docs/vertical-path-and-gates` | OK | 183 pass / 0 fail |
| `test/mvp0-chain-assertion` | OK | 263 pass / 0 fail（另有 `node --test tests/mvp0` 的 7 条**故意失败**） |
| `feat/core-bootstrap` | OK | 270 pass / 0 fail（mvp0：4 条失败） |
| `feat/core-start-work` | OK | 278 pass / 0 fail（mvp0：2 条失败） |
| `feat/core-delivery-lineage` | OK | 285 pass / 0 fail（mvp0 全绿） |
| `feat/controller-client-slice` | OK | 294 pass / 0 fail（mvp0 全绿，并已提进 `verify`） |

上表在 2026-09-21 的级联变基之后重测：栈底先 rebase 到当时的 `main`（该轮 main 前进 10 个提交，含 #97 与 #98），其余 12 条分支按 `--onto <新父> <旧父>` 逐层重放。**预演过的冲突如实发生**：`docs/README.md` 的 Active 计划索引表两边各插了行，按"两边都保留"解决；C 栈各批次的 `docs/exec-plan/active/2026-09-20-mvp0-slice.md` 也逐层冲突（Progress 取较新一侧、Surprises 两边都保留）。级联中曾因用错 `--onto` 基准丢掉过 C2/C4 的测试文件，已按祖先关系逐层复核修复——**这说明"变基成功"不等于"内容正确"，每层都要核对累积文件集**。

**堆叠 PR 与 `closingIssuesReferences` 的实测行为与配方**：本轮 9 个 PR 的描述里都写了 `Closes #N`，但首次回读时只有 base 是 `main` 的 PR 出现在 `closingIssuesReferences` 里。原因是 GitHub 只在 PR 指向默认分支时登记 closing 关联；而**一旦 PR 被 GitHub 归入某个 stack，base 就改不动了**（`gh pr edit <n> --base main` 返回 `Cannot change the base branch because the pull request is part of a stack.`）。

实测可行、并且已经对全部 PR 执行过的配方是——**先让 closing 关联登记，再把 base 放回栈内**：

```bash
# 1. 该 PR 所在栈如果不止它一个，先解散分组（只解除分组，PR 与分支不动）
gh stack unstack <stack-number>            # 例：gh stack unstack 90

# 2. 把 PR 的 base 临时指向默认分支：closing 关联在这一步登记
gh pr edit <pr> --base main
gh issue view <issue> --json closedByPullRequestsReferences   # 期望：[<pr>]

# 3. 重新链接栈：gh stack link 会把 base 改回上一层分支，而 closing 关联**保留**
gh stack link <pr-1> <pr-2> ... <pr-n>     # 自下而上，例：80 81 84 85 88 86 87
gh pr view <pr> --json baseRefName,closingIssuesReferences
# 期望：base 回到上一层分支，且 closing 仍是 [<issue>]
```

对本轮 9 个 PR 执行后的回读结果：`#74←80`、`#75←81`、`#29←84`、`#30←85`、`#31←86`、`#42←87`、`#26←82`、`#44←83`；栈重新建立为 stack #91（7 个 PR，base 链与执行前一致）。**不在任何栈里的 PR（#82、#83）更简单**：直接 `--base main` 登记，再改回原 base，关联同样保留。

新增批次按同一配方处理：先 `gh pr create --draft --base main`（登记关联），再 `gh stack link <stack-number> <new-pr>` 把它追加到栈顶——追加会设置 base 且不丢关联。**不要**在创建时直接用 `--base <栈内分支>`，那样 issue 侧永远看不到这个 PR。

**这一轮不合并**：#36 / #37（工程状态字段）、#49 / #65 / #66 / #67（M0.1 交付控制后续）——它们是交付控制面的工作，与 MVP-0 链路不是同一个闭环，混在一起会让"MVP-0 是否跑通"这个信号失真。

**合并前**：C 栈已补齐（#87 → #92 → #93 → #94 → #95），`node --test tests/mvp0` 从 7 条失败单调降到 0，并在 #95 中提升进 `pnpm verify`。**合并顺序仍然必须自下而上**：单独合并 #87 会让 `main` 上出现一条红色的进度轨道（那是它的初始状态，不是缺陷），只有整条 C 栈合并完才变绿。

**C 栈的一次假绿与修复（必须知道）**：C 栈顶端交付前，独立验证者证明 `tests/mvp0` 的节点 6/7 在**没有任何真实观察**时也能通过——`getDeliveryLineage` 会返回 `observed:false / chain_skeleton / candidate` 的骨架跳，而断言只查关系类型。同一批注入还显示节点 3（身份幂等）与节点 5（Start Work 幂等）同样没被钉住。修复落在 #95 的最后三个提交：`getDeliveryLineage` 只返回 `observed=true` 的跳，断言改为走真实链路并断言观察事实；五条注入（去重守卫、复用守卫、change_request 建工作项、CI 写规划状态、交付读数为空）在修复后都能让对应断言变红。**评审 #95 时应优先复核这五条注入**，因为把一条假绿的断言提进必需门禁，比没有门禁更危险。

### 4.3 本轮队列（2026-09-21）

本轮远端开放 7 个 PR：两条独立的单 PR 分支（#103、#104）加一条**四层 E1 栈**（#105 → #106 → #107 → #108）。刷新命令返回的 #100（`fix/rule-checks-api-base`，另一会话，base `main`）不属于本轮排位，位置未在本批次确定，因此不占表格行——按 §3 的列约定，位置列不允许"待定"。

| 位置 | PR | 分支 | base | 交付 | 依赖 | 已知冲突点与解法 |
|---|---|---|---|---|---|---|
| 1 | #103 | `fix/policy-check-pr-number` | `main` | Closes #66——`policy-check` 在 `Closes #N` 指向 PR 时按 issue 规则误判，改为区分 issue 与 pull request 编号 | 无 | 实现在 `scripts/policy-check.mjs` 与其测试；**与 #104 在 `docs/README.md` 的 ExecPlan 索引表上必然冲突**（两者都在同一个锚点行之后插入自己的一行，谁先合谁就占了锚点），解法见下方「位置 1 与 2 的索引冲突」 |
| 2 | #104 | `chore/merge-gate-layers` | `main` | Closes #10——为集成、边界与 MVP-0 层建立 Merge Gate 车道 | 无 | 实现在 `.github/workflows/merge-gate.yml`、`scripts/run-test-layer.mjs` 与它们的契约测试；冲突点同位置 1 |
| 3 | #105（E1-1，本 PR） | `test/e1-content-identities` | `main` | Closes #22——Gate E1 的沙箱定义、九字段记录模板与三类内容身份观测 | 无（E1 栈的栈底） | 新增 `docs/architecture/gate-e1-sandbox.md`、`docs/architecture/gate-e1-content-identities.md` 与 `tests/contract/e1-evidence-consistency.test.js`；改 `docs/architecture/README.md`、`docs/README.md`（+1/−1）、本文件 §4.3 / §4.4，以及三个**共享规则文件**——`AGENTS.md`（§6 分支前缀补 `test/`、§3 worktree 路径边界）、`PLANS.md`（§4 增补四条活文档一致性规则）、`docs/development/repository-rules.md`（分支前缀）。第三轮评审补齐本行原先漏列的后五个文件；预演时优先看这三个共享文件，它们最可能与别的 PR 重叠 |
| 4 | #106（E1-2） | `test/e1-membership-and-draft` | `test/e1-content-identities` | Closes #23——多项目成员关系与 draft 转换下的工作项身份 | **3**（栈序：base 是 #105 的 head） | 复用 #105 的沙箱与模板；本层只新增自己的 ExecPlan |
| 5 | #107（E1-3） | `test/e1-write-and-events` | `test/e1-membership-and-draft` | Closes #24——写确认与事件可靠性语义 | **4**（栈序） | 同上 |
| 6 | #108（E1-4） | `test/e1-ruling` | `test/e1-write-and-events` | Closes #25，并 Refs #4（父门禁）——读三份记录并裁决 Gate E1 | **5**（栈序） | 同上；它是唯一读全栈记录的一层，必须最后合并 |

读表要点：

- **位置 1–3 互不依赖**（base 都是 `main`），彼此顺序不限；但三者都必须先于位置 4——#106 的 base 是 #105 的 head。
- **E1 栈内必须自下而上合并**，与 §4.2 的 C 栈同理：单看栈内某一层，它的检查结果不是 CI 证据（`.github/workflows/ci.yml` 的触发分支是 `main`）。
- **冲突预演状态（2026-09-21 实测）**：`gh api repos/SingularityKChen/harness-projects/pulls/<n>/files` 的状态计数为：#103=`{"added":1,"modified":2}`、#104=`{"added":5,"modified":3}`、#105=`{"added":3,"modified":1}`、#106=`{"added":2}`、#107=`{"added":2}`、#108=`{"added":6,"modified":1}`。这些是当时各 PR 相对其 base 的文件状态快照，不能据此推断文件重叠或可干净变基。**这不构成"无冲突"声明**：按 §2.2 的规则，每个 PR 在自己的位置之前必须对排在它前面的每一个 PR 重新预演一次，不能用这张快照代替。快照随时会过期——本轮在它之后又追加了独立验收提交与索引提交，重新计数必然不同。

**位置 1 与 2 的索引冲突（已知点，未预演）**：

`docs/README.md` §2 的 ExecPlan 索引表是**按行插入**维护的，而 #103 与 #104 的 base 都是 `main`、都把新增行插在 `最后一行 Active 计划之后`。因此无论谁先合并，另一个在自己的位置上变基时都会在同一个插入点冲突。

**解法**：两边都保留，两行都在（它们是两份不同的计划，没有覆盖关系）；顺序按编号升序（#103 的行在前、#104 的行在后），因为本轮队列里 #103 是位置 1。这与 §2.3 里"两边都保留、按小节手动拼合"的既有形态同类。

**为什么这条不在 #103 / #104 里预先解决**：两份索引行的插入都发生在栈级联步骤，而栈级联在各 PR 自己的分支上完成；把两行同时写进任一个分支都会让另一个分支的索引行指向一个尚未存在于 `main` 的计划文件（悬空索引）。让它们各自携带自己的一行、在合并位置解决，是唯一不制造悬空引用的做法。

刷新这张表的命令（2026-09-21 实测输出即上表）：

```bash
git fetch origin
gh api 'repos/SingularityKChen/harness-projects/pulls?state=open&per_page=100' \
  --jq '.[] | {number,title,draft,base:.base.ref,head:.head.ref,sha:.head.sha}'
```

**本轮各 PR 的最终 head 不在本文里快照**：它是易失状态，写进来就会在下一次 push 后变成错的（这正是 §1 记录的那类失败）。判定对象与证据在各 PR 描述末尾的「最终 head 回读」一节，实时值以上面的刷新命令为准。

### 4.4 栈内 PR 的关闭引用：两次相反的实测与一条操作结论

§4.2 记录过上一轮堆叠 PR 的 `closingIssuesReferences` 现象与配方。本轮在四层 E1 栈上复测，先得到"栈内 PR 没有关闭引用"，随后同一批对象上又读到"关闭引用齐全、`willCloseTarget: true`"——**两次结论相反，本节以第二次为准并保留第一次作为反例**，因为它决定"合并前该看什么、合并后该补什么"。

**实测（2026-09-21，同一会话内两次回读，结论相反）**：

| PR | base | PR 侧 `closingIssuesReferences` | issue 侧 `closedByPullRequestsReferences` | 时间线 `willCloseTarget` |
|---|---|---|---|---|
| #103 | `main` | `[66]` | #66 → `[103]` | `true` |
| #104 | `main` | `[10]` | #10 → `[104]` | `true` |
| #105 | `main` | `[22]` | #22 → `[105]` | `true` |
| #106 | `test/e1-content-identities` | 先 `[]`，后 `[23]` | #23 → 先 `[]`，后 `[106]` | 先 `false`，后 `true` |
| #107 | `test/e1-membership-and-draft` | 先 `[]`，后 `[24]` | #24 → 先 `[]`，后 `[107]` | 先 `false`，后 `true` |
| #108 | `test/e1-write-and-events` | 先 `[]`，后 `[4, 25]` | #25 → 后 `[108]`；#4 → 后 `[108]` | 先 `false`，后 `true` |

**"先"与"后"是同一批对象上的两次观测，不是两次实验**：`CROSS_REFERENCED_EVENT` 的 `createdAt` 一直是 PR 创建时刻（#106 `06:52:26Z`、#107 `06:52:43Z`、#108 `06:53:12Z`），变的是这些事件上的 `willCloseTarget` 字段与两侧的关闭引用。两次观测之间 #106 / #107 / #108 的 base 与正文都没有改动；窗口内唯一的外部写入是对另外三个 PR（#103–#105）设置 milestone，与被观测对象无关，因此**不能把 milestone 编辑当作解释**。

**机制：未确定。** 本文件早先的版本写着「GitHub 只在 PR 的 base 是默认分支时才登记关闭引用」，并据此预测栈内 PR 在合并前不会有关闭引用——**该预测已被上表推翻**。现在能确证的只有：同一字段在同一批对象上出现过两种取值，最终稳定为「非空 / `true`」。仓库内没有做过受控实验来定位触发条件（那需要一个 base 非默认分支的对照 PR），因此本文件不再给出机制，只记录两次快照与回读命令。

**两条仍然成立的操作结论**：

1. **"issue 时间线上看得到这个 PR"与"这个 PR 会关闭这个 issue"是两件事**，前者不能当后者的证据；判定关闭关联必须读 `closingIssuesReferences` / `closedByPullRequestsReferences` 本身。
2. **不要根据 PR 的 base 预测关闭行为。** 既然 base 非默认分支的 PR 也会拿到 `willCloseTarget: true`，那么把 #106 / #107 / #108 合并进各自的父分支**可能**提前关闭 #23 / #24 / #25 / #4——而那时只有栈底那部分改动进了 `main`。**这条后果未实测**（本批次不合并任何 PR），但代价是"父门禁被一个尚未被采纳的裁决关掉"，所以每一层合并后都必须回读 issue 状态；若发现提前关闭，按 `gh issue reopen <n>` 重开并在本文件记一条。

**关闭引用生效的两条路径**（在本文件写下时被当作"唯一路径"，现已不成立，保留作为历史与备选动作）：

1. **自动 retarget**：下层 PR 合并后，如果它的 head 分支被删除，GitHub 会把以它为 base 的 PR 的 base 改成默认分支。**未实测**。**实测（2026-09-23）**：路径 1 成立——PR #108 合并（`03:37:49Z`）且 `test/e1-ruling` 被删除后，#121 的时间线出现 `automatic_base_change_succeeded`（`03:37:50Z`），`baseRefName` 由 `test/e1-ruling` 变为 `main`；"未实测"只适用于本节写下时。
2. **人工 retarget**：`gh pr edit <n> --base main`。**本地 `gh stack` 扩展的登记与 GitHub 服务端的行为是两件事，不要互相推断。** 本地侧的实测（2026-09-22；`gh stack view` 不接受分支参数，只读当前 checkout，所以命令必须带执行目录）：

   ```bash
   $ (cd .worktrees/w4-e1-2 && gh stack view)     # 该 worktree 检出 test/e1-membership-and-draft
   ✗ current branch "test/e1-membership-and-draft" is not part of a stack
   $ (cd .worktrees/w5-e1-3 && gh stack view)     # 检出 test/e1-write-and-events
   ✗ current branch "test/e1-write-and-events" is not part of a stack
   $ (cd .worktrees/w6-e1-4 && gh stack view)     # 检出 test/e1-ruling
   ✗ current branch "test/e1-ruling" is not part of a stack
   $ gh stack view definitely-not-a-real-branch-xyz   # 从仓库根跑；参数被静默忽略
   ✗ current branch "main" is not part of a stack
   ```

   这**只**说明 `gh stack` 扩展自己的登记里没有这条栈，**不能**用来推断 GitHub 服务端有没有把它当成栈——服务端的症状（下一段）显示它当成了。改 base 之前先读下一段。

**同一时刻一起变化的第三件事：`ci.yml` 开始在栈内 PR 上运行，`PR size` 随之变红**

上表的关闭引用不是单独变的。同一时间窗内还有两个变化，三个症状同时出现，指向同一个原因——**GitHub 在服务端把这条链当成了 native stack**：

| 症状 | 之前 | 之后 | 与 native stack 的关系 |
|---|---|---|---|
| 关闭引用 / `willCloseTarget` | `[]` / `false` | `[n]` / `true` | 栈成员对 issue 的关闭语义 |
| `ci.yml` 的 `Verify` / `PR Fast Gate` | 栈内 PR 上不出现 | 出现且成功 | `branches: [main]` 过滤器看到的是**栈的根分支** |
| `rule-checks.yml` 的 `PR size` | 按声明的父分支度量，通过 | 按 `main` 度量，**红** | 同一个 `github.base_ref` 取值变化 |

第三行就是 issue #99 记录的缺陷本身：栈成员的 `github.base_ref` 是栈的根分支（`main`），于是体量检查量的是**整条栈相对 `main` 的累计**。

**下面这张表是 2026-09-21 的快照，不要当成当前值**（`PLANS.md` §4「易失状态写成回读命令 + 期望」）。要当前值就重算，两个口径各跑一次（在对应的 worktree 里跑；w4=#106、w5=#107、w6=#108）：

```bash
$ (cd .worktrees/w4-e1-2 && node scripts/rule-checks.mjs size test/e1-content-identities)   # 按自己声明的 base
$ (cd .worktrees/w4-e1-2 && node scripts/rule-checks.mjs size origin/main)                  # 按 main（当时 CI 用的口径）
```

| PR | 按自己声明的 base（快照） | 按 `origin/main`（快照） |
|---|---|---|
| #106 | 文档 733 / 1500（通过） | 文档 1803 / 1500（超限） |
| #107 | 文档 1032 / 1500（通过） | 文档 2835 / 1500（超限） |
| #108 | 文档 663 / 1500（通过） | 文档 3498 / 1500（超限） |

这张表的**用途不是给数字，而是给方向**：同一个 head 在两个基线口径下结论相反。评审在 2026-09-22 重算时累计列已漂移 54–56 行（"按自己声明的 base"一列仍逐字准确）——所以判定超限时必须先问基线是什么。

**所以 #106 / #107 / #108 上的红 `PR size` 不是这三个 PR 的体量问题，是别人造成的红**（§6.1 的那一类）：修复在 PR #100（`fix/rule-checks-api-base`）。

**该红已经消失（2026-09-21，PR #100 合并进 `main` 为 `dbd9c5d` 之后）**：`rule-checks` 的判定基线改为来自 PR API 的对象对，不再取 `github.base_ref`；四个 E1 分支 rebase 到新 `main` 之后，`PR size` 与 `Resolve PR base` 都是绿的，栈内 PR 也拿到了 `Verify` / `PR Fast Gate`。**上表的对照仍然保留**，因为它记录了"同一个 head 在不同基线口径下结论相反"这件事本身——判定超限时仍然要问清楚基线是什么，本地复核命令是 `node scripts/rule-checks.mjs size <该 PR 声明的 base>`。

**如果将来又出现栈内 PR 的 `PR size` 变红**：先读 `Resolve PR base` job 打印的判定对象对，再看这个红是不是别人造成的，不要直接按超限处理。

`PR size` 是 advisory，不在分支保护里，因此即使变红也不阻塞合并；但它会被读成"这些 PR 有问题"，所以必须写在这里。

**本文件不再断言"栈内 PR 拿不到 `Verify`"**：那句话在本轮同一批对象上先成立、后不成立。判定某个栈内 PR 有没有 CI 结论，读它当前的 checks，不要读 base 的名字。

回读命令（栈内每一层合并后重跑第 1、2 条；第 1 条的期望**不再**是「栈内 PR 为 `[]`」）：

```bash
# 1) PR 侧的关闭引用：现在六个 PR 都应非空
for n in 103 104 105 106 107 108; do
  gh pr view "$n" --repo SingularityKChen/harness-projects \
    --json number,baseRefName,closingIssuesReferences \
    --jq '{number,base:.baseRefName,closing:[.closingIssuesReferences[].number]}'
done

# 2) issue 侧的关闭引用与状态（每层合并后重点看 state 有没有被提前改成 CLOSED）
for i in 66 10 22 23 24 25 4; do
  gh issue view "$i" --repo SingularityKChen/harness-projects \
    --json number,state,closedByPullRequestsReferences \
    --jq '{number,state,closedBy:[.closedByPullRequestsReferences[].number]}'
done

# 3) 交叉引用是否仍在，以及 willCloseTarget 是 true 还是 false
gh api graphql -f query='
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      timelineItems(last: 10, itemTypes: [CROSS_REFERENCED_EVENT]) {
        totalCount
        nodes { ... on CrossReferencedEvent { createdAt willCloseTarget
          source { __typename ... on PullRequest { number baseRefName } } } } } } }
}' -f owner=SingularityKChen -f name=harness-projects -F number=23
```

回读判据：`[]` 不变时不要当成"已关联"——按路径 1 或 2 处理，然后重跑第 1、2 条命令，看到 `closing` 从 `[]` 变成 `[<issue>]` 才算登记成功。

### 4.5 往一个已存在的栈上追加层（2026-09-23 实测）

上一轮的 E1 四层栈（#105 / #106 / #107 / #108）在 #105–#107 合并、分支删除之后**在服务端仍然登记为一个栈**。这决定了追加新层的命令形态：

```bash
# 从检出待追加分支的工作树根目录运行；`gh stack link` 的第一个参数是栈号时，其余参数追加到栈顶
$ gh stack link 108 121
✗ Cannot update stack: this would remove #105, #106, #107 from the stack
Current stack: #105, #106, #107, #108
Include all existing PRs in the command to update the stack

$ gh stack link 105 106 107 108 121
⚠ failed to update base branch for PR #106 to test/e1-content-identities: HTTP 422: Validation Failed
PullRequest.base is invalid
⚠ failed to update base branch for PR #107 to test/e1-membership-and-draft: HTTP 422: Validation Failed
PullRequest.base is invalid
⚠ failed to update base branch for PR #108 to test/e1-write-and-events: HTTP 422: Validation Failed
PullRequest.base is invalid
✓ Updated base branch for PR #121 to test/e1-ruling
✓ Updated stack to 5 PRs (stack #109)
```

三条**已合并**成员的 base 更新失败是预期的：它们指向的父分支已被删除，GitHub 对已合并 PR 的 base 改写返回 422。失败只影响那三条已合并成员（它们的 base 保持 `main`），**不影响**追加结果：#108 的 base 仍是 `main`，#121 的 base 变成 `test/e1-ruling`。 **Superseded by L1 级联（2026-09-23）**：`#121 的 base 变成 test/e1-ruling` 是**追加那一刻的观测**（时间线 `base_ref_changed`，`03:14:49Z`，由 `gh stack link` 触发），不是当前值——PR #108 于 `03:37:49Z` 合并、`test/e1-ruling` 被删除后，GitHub **自动**把 #121 的 base 改回默认分支（时间线 `automatic_base_change_succeeded`，`03:37:50Z`），`gh pr view 121 --json baseRefName` 现在返回 `main`。机制与路径见 §4.4 的路径 1，原文保留。

追加后按 §4.4 的第 1、2 条命令回读，`closingIssuesReferences` 与 `closedByPullRequestsReferences` 在 base 改写后**保留**（#121 → `closing: [119]`；#119 → `closedBy: [121]`）。

**操作结论**：追加第 2 层时要把栈内全部成员列出来（或直接读错误信息里那份清单）；**追加第 3 层及以后**用 `gh stack link <栈号> <新 PR 号>`，不要再列全部成员——栈号就是上面输出里的 `stack #109` 那个数字。栈号与 PR 号不会冲突：数字首参只在命中已存在的栈时才按栈解释。**合并栈成员**（第三轮评审观测）：`gh pr merge` 对栈成员返回 “This pull request is part of a stack and must be merged using the asynchronous merge REST API”，改用 `gh api -X PUT repos/SingularityKChen/harness-projects/pulls/<n>/merge-async -f merge_method=rebase`；每合并一层（`delete_branch_on_merge=true`，上层自动 retarget 到 `main`），上层都要 `git rebase --onto origin/main <下层合并前的 head> <上层分支>` 后按 §2.4 强推，再重跑验证。

### 4.6 声明的 base 被强推之后，`size` 的判定基线会退到 merge-base（2026-09-23 实测）

`node scripts/rule-checks.mjs size <base-ref>` 用三点 diff（`git diff <base-ref>...HEAD`）度量，即 **merge-base 到 head**。当 `<base-ref>` 指向的分支被强推成一条**不包含本分支提交**的历史时，merge-base 会退到两条线的共同祖先（通常就是 `main`），于是这条命令量的是**整条栈相对 main 的累计**，而不是本层。

实测（本层 = 栈内 L1 `test/e1-uncertain-create`；**每个数字只对跑它时的那个 head 成立**，行数是本分支自己的函数。**下表里的 `18315f2` / `a951105` / `f13a444` / `a48ccae` 是观察时刻快照，且都已不可解析**——它们只挂在已删除的远端 `backup/*` 上，在全新 clone 里 `git cat-file -t <sha>` 报 `fatal: Not a valid object name`。这张表因此**不可复核**，保留它只为记录机制；要复跑请在当前 head 上按下面两条操作结论自测）：

| 跑它时的 head | `a48ccae` 是本分支祖先？ | `size a48ccae`（L0 重写前版本的父提交） | `size origin/main`（本层声明的 base） |
|---|---|---|---|
| `18315f2`（级联前，父提交就是 `a48ccae`） | 是 | 文档 **548 / 1500**，exit 0（本层自己的体量） | 文档 **1255 / 1500**，**exit 0**：merge-base 退到旧 `main` 尖端，把 L0 重写前版本算了进来——量到的是**整条栈的累计**而不是本层，只是当时仍未超限（**2026-09-24 评审订正**：原写 exit 1，与脚本逻辑矛盾——`failed` 只在 `used > budget` 时置真，1255 ≤ 1500 必然 exit 0） |
| `a951105`（级联到 `origin/main` 之后） | 否 | 文档 **2078 / 1500**，exit 1 | 文档 **1385 / 1500**，exit 0（本层自己的体量） |
| `f13a444`（本节订正时的 head） | 否 | 文档 **2158 / 1500**，exit 1 | 文档 **1483 / 1500**，exit 0 |

**同一命令在不同 head 上结论相反，判据只有一条：这个 head 还以该 base 为祖先吗。** 级联前父提交是 `a48ccae`，所以 `size a48ccae` 量的是本层、`size origin/main` 退到 merge-base；级联到 `origin/main` 之后两者互换——`size origin/main` 量的是本层，`size a48ccae` 退到旧 `main` 尖端。

**`size` 在 base 不是 `main` 尖端时会额外打印一行「栈累计（相对 origin/main，仅记录，不计入判定）」，它不是判定值。** 本节早先的版本正是把这一行读成了 `a48ccae` 的判定：在 head `a951105` 上跑 `size a48ccae`，判定值是「文档 2078 / 1500」（exit 1），同一输出末尾的旁注才是「文档 1385」——旁注与判定被互换，于是表里两行的结论整体写反。`size origin/test/e1-ruling` 另报 exit 3（`base "origin/test/e1-ruling" 无法解析成提交`）：该分支随 PR #108 合并被删除，这是响亮失败，可以信任。

1. **判超限前先问基线是什么**（与 §4.4 的"同一个 head 在两个基线口径下结论相反"同类）。本地复核用**真实父提交**（上一层的 head SHA），不要用可能已被重写的分支名。
2. **exit 0 / exit 1 的数字必须先确认基线**，否则会把整条栈的累计读成单层体量；只有 base 分支被删除时的 exit 3 可以不看基线直接信任。
3. **栈级联之后重量一次**：级联把本层重放到新的父提交上，三点 diff 的 merge-base 随之变成真实父提交，量到的才是本层。**真正的假超限是另一格**：级联后拿一个已不是该 head 祖先的旧父提交去跑（`size a48ccae`），三点 diff 退到旧 `main` 尖端，报出 2078 / exit 1。**订正 2026-09-24**：本行原写「`18315f2` 上的 `size origin/main` 是 1255，级联后同一口径是 1385；差的就是 L0 重写前版本那一块」——1385 − 1255 = **+130**，方向与「扣掉 L0」相反，而且 1255 量的是（L0 + 当时的 L1）、1385 量的是级联后已经变大的 L1 本身，两者之差不是任何单一的一块。原文的算术与归因都不成立，结论（"级联后必须重量"）不变。
### 4.7 MVP-1 三交付批次队列（2026-09-24 起）

这一轮是**三个交付、五个 PR**：每个 PR 关闭恰好一个 issue，各自构成可独立验收、合并、回滚的能力闭环。它与 §4.2 的 MVP-0 轮同形——既有独立 PR，也有栈：**D2 与 D3 各自是一条两层的栈，栈内必须自下而上合并**；D1 与其余四层没有依赖关系，因此**不叠进任何栈**（把它塞进栈里会强制一条没有依据的合并顺序，违反 §2.1）。

| 位置 | PR | 分支 | base | 交付 | 依赖 | 已知冲突点与解法 |
|---|---|---|---|---|---|---|
| 1 | #159（D1） | `fix/engineering-merged-terminal` | `main` | Closes #115——`Engineering` 写入口与观察者共用一份终态选择策略，Merged 终态且单调 | 无 | 改 `docs/README.md` 的 Active 索引表、`docs/development/ci.md`、`docs/product/board-semantics.md` 与本文件 §4.7；**与在飞栈及本批次其余四层在索引表上必然冲突**，解法见下 |
| 本轮不合并 | #160（D2-L1） | `feat/local-git-worktree` | `main` | Closes #137——本机真的出现 worktree 与 branch，路径安全在 Git 命令之前生效 | 无 | **第二轮 MMP 评审（2026-09-23）2 × P1，本轮不合并**：`createWorktree` 对不可复用的状态报 `conflict`，core 据此报假 `Ready` / `confirmed`；#137 验收 3 在 core 层不成立。证据与反例见 `docs/review/2026-09-23-mvp1-batch-review.md`；修复后重新排队，仍排在 #161 之前。改 `tests/contract/suites/development.js`——**本批次只有它改这个文件**，其余四层不得改 |
| 本轮不合并 | #161（D2-L2） | `feat/human-execution-provider` | `feat/local-git-worktree` | 声明 Closes #139——一个**可绑定**的人工执行 provider（`running` 的人工运行，不写 Storage），工作树与分支仍在；core 的降级触发点不改（#171），运行的外部身份不落库（#172）。原写「会话启动失败降级为**一等人工执行状态**」，与 #161 收窄后的交付不符，2026-09-23 第二轮评审订正 | **#160**（栈序：base 是 #160 的 head） | **第二轮 MMP 评审 1 × P1，本轮不合并**：`Closes #139` 与验收 2 不符，需人类裁决改 `Refs #139` 或改写验收；且依赖的 #160 有 P1。改 `tests/contract/execution-contract.test.js`（人工 provider 的适配器块与判别性用例），`tests/contract/suites/execution.js` **不改**（原写「改 `tests/contract/suites/execution.js`——只有它改」，与 diff 不符，2026-09-23 订正）；`tests/integration/README.md` 与位置 2、以及在飞 PR #122 都可能重叠，**两边都保留、按小节拼合**；`packages/providers/fake/**` 不改实现，需要时只改 `tests/contract/*.test.js` |
| 4 | #162（D3-L1） | `test/harness-host-spike` | `main` | Closes #125——宿主能否承载 controller + 一个页面，有**观测结论**与裁决（交付物是记录，不是代码） | 无 | 改 `docs/architecture/` 与 `docs/README.md`；探针代码不合并。**已合并（2026-09-23T09:54:15Z，rebase merge 落在 `main` 的 `c841227`、`940046e`）；head 分支已删除** |
| 5 | #158（D3-L2） | `feat/ui-model-presentation` | `main`（原为 `test/harness-host-spike`） | Closes #128——客户端模型派生出项目首页 / 工作项列表 / 统一详情的展示结构 | 无（栈序依赖已随位置 4 合并消失） | 改 `packages/ui-model/**` 与 `docs/README.md`。**位置 4 合并后 head 分支被删除，GitHub 把本行的 base 自动改成 `main`**——它已不是栈的一层，而是一条独立 PR；用 `git rebase --onto origin/main <旧 base> HEAD` 把已被合并进 `main` 的探针提交丢掉即可（`git rebase origin/main` 的 patch-id 去重**不成立**：`main` 上是两个提交、分支上带的是四个，内容被压过）。该步已执行，回读判据：`git merge-base origin/main origin/feat/ui-model-presentation` 是 `main` 上的提交，且 `git diff --name-only origin/main...origin/feat/ui-model-presentation` 只含本层文件。与位置 1 在 `docs/README.md` 索引表上冲突，两边都保留 |

读表要点：

- **位置 1 先合并**，判据是 §6.1 的那一条——不是「谁更重要」，而是「谁的红叉是别人造成的」。#115 修的是「一个 issue 被多个 PR 引用时写入口与观察者不一致」，而观察者的红**没有事件能清掉**；本批次把堆叠 PR 变成常规操作，先合并它，后续四层的 advisory 红才不会被误读成「这些 PR 有问题」。
- **位置 2 与位置 4 曾经互不依赖**（base 都是 `main`），彼此顺序不限；位置 4 已于 2026-09-23 合并，因此现在只剩位置 2 → 3 这一条栈：位置 3 的 base 是位置 2 的 head，**位置 2 合并前位置 3 不可合并**。位置 5 已随位置 4 的合并脱离栈（见上表第 5 行）。
- **栈内 PR 有没有 `CI` 结论，取决于它有没有登记进 GitHub stack；判定永远读它当前的 checks，不要从 base 的名字推断**（与 §4.4 同口径）。本批次实测（2026-09-23，只读）：
  - **登记进 stack 之后，base 不是 `main` 也拿得到 `Verify` 与 `PR Fast Gate`。** PR #161（base `feat/local-git-worktree`，07:47:48Z retarget、此后未变）的 head `2b900b36` 上有 success 的 `Verify（typecheck + 契约测试）`（09:33:49Z）与 `PR Fast Gate`（09:34:18Z），来自 CI run `35843669687`，该 run 的 `pull_requests[].base.ref` 就是 `feat/local-git-worktree`。PR #158（base `test/harness-host-spike`）的 head `f42cab08` 同样有 CI run `35843700676`（09:34:06Z，success）。
  - **登记之前测到的是中间态。** 同一个 head 在栈登记之前没有这两条结论，登记之后有；两次 CI 都紧跟 `added_to_stack` 约 2 秒启动（#161：09:33:45Z → 09:33:47Z；#158：09:34:04Z → 09:34:06Z）。
  - **机制未确证。** 本文件只记录上面两次快照与它们的回读命令，**不**断言 GitHub 为什么这么触发。复核方式：`gh pr checks <n>` 读当前结论，`gh api repos/SingularityKChen/harness-projects/actions/runs/<run-id> --jq '.pull_requests[].base.ref'` 读该 run 认定的 base。
  - **仍然成立的推论**：`main` 的分支保护只作用于以 `main` 为 base 的 PR，因此栈内层的 `mergeStateStatus` 可以是 `CLEAN` 而没有待满足的必需检查——**看起来绿不等于 fast gate 跑过**，栈内某一层的绿也不能替代整栈合并后的复跑。
- **本节的编号取 §4.7 而不是 §4.5**：另一条在飞栈（#157 所在的分支）已经写了 `### 4.5` 与 `### 4.6` 两个小节。两边合并时按编号各自保留，不重排、不覆盖。实测（2026-09-23，第二轮评审的并集预演）：把 #121 变基到本批次四个 PR 的并集之上，冲突正落在本文件 `### 4.7` 与 `### 4.5` / `### 4.6` 的同一插入点；解法即本条——三节都保留，按 4.5、4.6、4.7 排列。

**与在飞栈的关系**：本批次之外还有一条独立栈在飞——**#121**（base `main`，head `test/e1-uncertain-create`）、**#122**（base `test/e1-uncertain-create`）、**#157**（base `feature/storage-identity-membership-tables`）及其后续层。成员以回读为准：`gh api 'repos/SingularityKChen/harness-projects/pulls?state=open&per_page=100' --jq '.[] | select(.head.ref | startswith("feature/storage") or . == "test/e1-uncertain-create") | {number, base: .base.ref, head: .head.ref}'`（2026-09-23 第二轮评审时是 #121 → #122 → #157 → #167 → #170 → #175）。它们是 Gate E1 / SQLite v1 数据模型那条线的产物，**不属于本批次排位**，与本批次五个 PR 之间没有依赖；两者唯一的必然交织是 `docs/README.md` 的 Active ExecPlan 索引表。

**`docs/README.md` Active 索引表的冲突（已知点，未预演）**：这张表按行插入维护，本批次五层各插自己一行，在飞栈也改同一个文件。无论谁先合并，后合并的一方在自己的位置上变基时都会在同一个插入点冲突。**解法**：两边都保留、按合并位置排序（位置靠前的行在前），每层只插自己那一行、不为别人预留空行；这与 §4.3「位置 1 与 2 的索引冲突」的既有形态同类。

**合并顺序（一句话版）**：`4 → 5` 已解耦（位置 4 已合并，位置 5 现在是一条独立 PR）；剩下 `1` 与 `2 → 3`，`1` 先合并，`2 → 3` 自下而上。

> **Superseded by** 下文「第二轮 MMP 评审结论」（2026-09-23）：本轮只合并 `1 → 5`（#159 → #158）；#160 → #161 本轮不合并，修复后重新排队时仍自下而上。

**本轮交付状态（2026-09-23，评审响应后）**：**位置 4（#162）已合并**，其余四个 PR 都已 ready 并完成一轮人工评审响应，等待人类评审；**尚未合并其余任何一个**。

> **Superseded by** 下一段「第二轮 MMP 评审结论」（2026-09-23）：上一句是第一轮评审响应后的快照。

**第二轮 MMP 评审结论（2026-09-23）**：锁定 #158 `8ed0d65`、#159 `300e2a3`、#160 `1830136`、#161 `c013dc9`，按本表顺序（#159 → #160 → #161 → #158）在一次性 clone 里做并集预演：冲突只在 `docs/README.md` 的 Active 索引表（两边都保留），并集树上 `pnpm verify` 532 / 532 + 7 / 7、`pnpm run boundaries` 7 / 7、`node scripts/workflow-check.mjs` 无发现——并集层无 P0。逐 PR：**#159 与 #158 无 P0 / P1**，机械可修的 P2 / P3 就地修复后按位置 1 → 5 以 rebase merge 合入；**#160（2 × P1）与 #161（1 × P1，且依赖 #160）本轮不合并**。34 条 inline 意见、风险矩阵与证据见 `docs/review/2026-09-23-mvp1-batch-review.md`。合并与否以回读为准：`gh pr view <n> -R SingularityKChen/harness-projects --json state,mergedAt,mergeCommit`。

第一轮评审共提出 30 条 inline 意见（#158 十条、#159 四条、#160 九条、#161 七条），逐条核实后**绝大多数属实**，其中四条是真缺陷而不是风格意见：`#160` 的 `conflict` 把「可复用」与「不可复用」折成同一个码、core 据此报**假 `Ready`**；`#161` 的人工运行引用从不落库、「重启后读回不变」只对运行记录成立；`#159` 的「失败会被下一次事件重试」风险论据被 `concurrency` 组取消事件这一实测证伪；`#158` 的 `execution_context` 谱系入口挂在一个 core 读该事实时**从不经过**的 capability key 上。修复按**根因分组**做（不是逐条打补丁），每组都配了先红后绿的判别性证据与变异实验；30 条 thread 已逐条回复并 resolve。

三处**有意留在本批次之外**的缺陷已各自登记，不要在本批次里顺手修：

- **#165**——core 的 `recordStartFacts` 让同一份工作树在恢复路径上得到第二个实体 id 与第二条 confirmed `has_worktree` 关系（不变量 6）。根因在 `packages/core`，不在 #137 的 provider；#160 里那两条表征断言明确点名它并给出收口条件。
- **#171** / **#172**——#161 暴露的两条 core/Storage 缺口：Start Work 的降级触发点从不咨询人工 provider；执行运行的外部身份没有成为 core 的 run 事实（`ExecutionRunRecord` 无 `externalId`，`getRun`/`cancelRun` 在生产代码里零调用点）。后者是跨层 Storage 契约 + SQLite 迁移，与在飞的 SQLite v1 栈同片文件，因此必须独立成 PR。
- **#173** / **#174**——`Engineering` 的「更新的 draft PR 会清空字段」语义（预先存在，与 base 逐字一致）；本地 Git provider 因体量上限而未补的两条边界/错误注入用例。

**#166** 曾按「栈内 PR 拿不到 `CI` 车道结论」登记，**该前提已被本节上方的实测证伪**（登记进 stack 之后拿得到）。issue 已改写：残留的真问题收窄为**分支保护只作用于 `main`，所以合进父分支这一步没有必需检查**——「跑过」与「被要求跑」是两件事。

另有一条**只能在合并后回读**的未闭环项：#115 的真实事件路径（`Engineering state` 是 `pull_request_target`，workflow 定义取自默认分支）。合并 #159 之后回读 `gh run list --workflow=engineering-state.yml`，期望出现 `::notice::confirmed #115: Engineering=…`。

> **Superseded by**（2026-09-23，第二轮 MMP 评审）：`gh run view --log` 把 `::notice::` 渲染成 `##[notice]`，照字面 grep 会漏；命令须带 `-R`。改为 `gh run list -R SingularityKChen/harness-projects --workflow=engineering-state.yml --event pull_request_target --limit 5` 找到合并后那次运行，再 `gh run view <id> -R SingularityKChen/harness-projects --log | grep -E 'PR_NUMBER|##\[notice\]confirmed'`，期望 `PR_NUMBER: 159` 与 `##[notice]confirmed #115: Engineering=Merged; 依据 PR #159（规则 merged）`。

## 5. 历史：2026-09-18 那一轮的实测结果

以下是 2026-09-18 完成的上一轮评审（9 个开放 PR：#12 #19 #21 #3 #11 #13 #33 #35 #37）的**实测记录**，不是当前队列的一部分，也不是可以直接套用的模板——它作为一个已经发生过的具体案例，说明第 2 节的流程为什么长这个样子。来源：`docs/review/2026-09-18-mvp-delivery-review.md`。

九步里有五步在本地 rebase 时报冲突，GitHub 的 rebase merge 对这五步全部无法自动完成：

| 步骤 | PR | rebase 结果 | 冲突点与解法 |
|---|---|---|---|
| 1 | #12 | clean | —— |
| 2 | #19 | 冲突 | `AGENTS.md` 三处，均"两边都保留"；作者已在 PR 描述里正确预测 |
| 3 | #21 | clean | —— |
| 4 | #3 | 冲突 | `docs/README.md` 的 Completed 表，两边各加一行 |
| 5 | #11 | 冲突 | `AGENTS.md` 索引表，两行级 |
| 6 | #13 | 冲突 | `AGENTS.md` 索引表，两行级 |
| 7 | #33 | 冲突 | `docs/README.md` 的 Active 表，与 #12 替换的是同一行占位——**这一处冲突未被 #33 的描述声明过**（结构性教训见第 6 节） |
| 8 | #35 | clean | 描述里正确要求排在 #12 之后（引用其 §8.6 变更）与 #33 之后（ExecPlan 链接） |
| 9 | #37 | clean | 该 PR 因另外两个 P0 级问题暂缓合并，与冲突无关 |

最终 8 个 PR（除 #37）全部合并，`main` 上 `pnpm verify` 与 `workflow-check` 的结果与合并前的预测逐字一致。

## 6. 结构性教训

第 5 节第 7 步（#33）不是"忘了预演"，而是**预演了错误的对象**：#33 用 `git merge-tree` 对 #3 做过预演并在描述里写"已确认无冲突"，但 #33 自己要求排在 #12 之后，而与 #12 冲突的正是同一份 `docs/README.md`、同一行占位符。对 #3 的预演结论本身是对的，但它回答的不是这次合并会遇到的问题。

由此得到一条可以直接执行的规则，写在这里供以后每一次排队引用：

> 一个 PR 的"无冲突"声明，必须对**它声明的合并位置之前的所有 PR**做预演，不能只对着其中任意一个看起来相关的对象。

第 2.2 节的预演步骤——从位置 1 依次变基到自己前一位，而不是挑一个分支单独比较——就是这条规则的操作化。

### 6.1 修误报的 PR 应当提前

2026-09-18 的第二轮又得到一条，来源不同：五个 PR 都带着同一份 ExecPlan，而当时未加固的发布面扫描器把那份计划里**列举误报字面量的那一行**判成真实泄漏——于是四个完全合规的 PR 都挂着红的 `Disclosure scan`，而修这个误报的正是队列里的第五个 PR。

> 一个 PR 若修的是**影响队列中其它 PR 检查结果**的误报，应当提前到它们之前。判据不是「谁更重要」，而是「谁的红叉是别人造成的」。

这与第 6 节那条规则的共同点值得点出：两者都是「排队顺序本身携带信息」——顺序不只是变基顺序，它决定了每个 PR 在评审时**看起来**合不合规。一个长期挂红的 advisory 检查会把人训练成忽略它，而那正是 `AGENTS.md` §9.2 警告的「绿了就等于查过了」的镜像形态。

### 6.2 并行会话会产出互相冲突的产物，而排队表看不见

同一轮里三个会话并行工作，产出了两处排队表无法预先发现的交织：

- **同名文件、不同 API**：#61 与 #56 都创建了 `scripts/board-workflow-check.mjs`，实测 rebase 硬冲突。两者是同一个 issue（#45）的两种切法。
- **叠在 draft 之上的分支**：#63 直接基于 #59 的分支开出，因此 #59 之前不可合并——而 #59 当时还是 draft。

排队表只记录「已知的 PR 之间怎么排」，它不会告诉你「另一个会话此刻正在改同一个文件」。目前没有机制能自动发现这件事；可行的最小对策是**开工前先看一眼 `gh pr list --state open` 与 `git ls-remote --heads origin`**，把「这个文件有没有别人在动」变成排队前的一次显式检查，而不是合并时才发现。



## 7. 一个悬而未决的问题：批准门禁

如实记录，不作为可以照搬的先例：2026-09-18 那一轮合并时，分支保护要求至少 1 个批准，而全部 9 个 PR 的作者与执行合并所用的凭据是同一个账号——GitHub 不允许账号批准自己提交的 PR。人类伙伴显式授权后，8 个 PR 改用管理员权限（`--admin`，仓库的 `enforce_admins=false`）合并，绕过的只是批准门禁：**检查门禁全程是真绿的**，每个 PR 合并前都实跑过 `pnpm verify` 与 `node scripts/workflow-check.mjs` 并得到通过结果。

这不是这份文件可以替你决定的问题：单账号仓库里"必须有 1 个批准"这条约束目前只能靠管理员权限绕过，它作为门禁的实际效力应当被重新评估——要么显式接受它当前是形式性的并写清楚，要么引入第二个账号或评审者让批准门禁真正生效。在这个决定做出之前，任何一次用管理员权限绕过批准合并的操作，都应当像 2026-09-18 这次一样，在合并记录里如实写明"绕过的是批准门禁，检查门禁保持真绿"，不要笼统写成"已合并"。

**关闭引用一旦登记，就不会随正文编辑撤回（2026-09-21 实测）**

这条比上面两条都重要，因为它的后果落在**合并那一刻**，而不是记录里。

实测（#108）：它的正文原本同时写着 `Closes #25` 与 `Closes #4`，于是 PR 侧 `closingIssuesReferences = [4, 25]`、issue #4 侧 `closedByPullRequestsReferences = [108]`。随后把正文里那一行改成 `Refs #4`，又进一步删掉了正文中**所有**字面 `Closes #4`（包括行内代码里的），等 3.5 分钟后回读：

```bash
gh pr view 108 --json closingIssuesReferences,updatedAt \
  --jq '"closing=[\([.closingIssuesReferences[].number]|join(","))] bodyUpdatedAt=\(.updatedAt)"'
# 实测输出：closing=[4,25] bodyUpdatedAt=2026-09-22T03:20:12Z（正文确实已被编辑）
grep -c -i 'closes #4' <<<"$(gh pr view 108 --json body --jq .body)"   # 实测：0
```

**结论：`closingIssuesReferences` 不是正文的实时函数。** 它登记之后，改正文不会把它撤下来——至少在这次观测的窗口内没有。所以：

- **写 `Closes #N` 之前先想清楚**：它不是一个可以事后收回的标记。写错了要改，代价是"合并时仍会关闭 #N"，只能靠合并后 `gh issue reopen <n>` 补救。
- 本仓库自己的 `linkedIssues()`（`scripts/policy-check.mjs`）会把行内代码里的引用剥离，因此它算出的 `closes` 可能**少于** GitHub 实际登记的——`policy-check` 说"只关联了 #25"不代表 GitHub 不会关闭 #4。两套口径不要互相替代。
- 本文件 §4.4 开头那条"机制未确定"因此再添一例：同一个字段既出现过"从空变非空"，也出现过"清空正文后不变"。**判定关闭关联永远读这两个字段本身，不要从正文推断。**

**#108 的具体后果（需要在合并时处理）**：它现在仍会把 #4 关掉，而 #4 的验收条件是六条行为、其中行为 6 判 `inconclusive`（`release-gates.md` §1：无法判定等同于不满足）。所以合并 #108 之后**必须**回读并重开：

```bash
gh issue view 4 --json state          # 期望 OPEN；若为 CLOSED 则：
gh issue reopen 4 -c "被 #108 的关闭引用自动关闭；revise 清单（R1–R8）未落地，见 docs/architecture/gate-e1-ruling.md §4（#108 交付）。行为 6 已由 L1（#119）补测，L1 提议改判 pass（待人类伙伴采纳），不再是重开的理由。"
```

**Superseded by L1（#119，2026-09-23）**：上面这段的前提"行为 6 判 `inconclusive`"已不成立——L1 补测后**提议**行为 6 改判 `pass`（裁决 §2.6；**采纳权在人类伙伴**，采纳前不得作为事实写入 #4），因此"无法判定等同于不满足"这条理由不再适用于行为 6；#4 保持打开的理由改为 **`revise` 的 R1–R8 尚未落地**（其中行为 1 的成员关系落点仍缺模型落点）。`gh issue reopen` 的命令文案已按此订正，避免往 #4 写入"行为 6 仍为 inconclusive"这条与裁决相反的话。**回读（2026-09-23）**：`gh issue view 4 --repo SingularityKChen/harness-projects --json state,comments` → `state = OPEN`、无评论，即 #108 的关闭引用没有实际关闭 #4，这段补救文案没有被执行过。
