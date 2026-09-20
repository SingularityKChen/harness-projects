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
