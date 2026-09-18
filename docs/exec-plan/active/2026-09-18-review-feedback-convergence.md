# 评审反馈根因收敛 ExecPlan

> 状态：Active
> 创建：2026-09-18
> 范围：把 PR #12 / #19 / #21 的 7 条行级评审意见与 2 条 PR 级意见收敛为 4 条根机制的修复；让 PR #35 对齐新引入的 workflow 不变量
> 上游输入：GitHub 上 PR #12 / #19 / #21 的 review thread；`AGENTS.md`；`PLANS.md`

---

## Purpose / Big Picture

完成后，本仓库的"约定 → 检查"闭环补齐第三块，并且三份在审 PR 的评审意见以**根因**而不是**逐行补丁**的方式落地。

具体地，世界变成这样：

1. **workflow 的加固性质有成文的不变量与离线检查。** 新增第 5 个 workflow 时，"每个 job 有超时上界、checkout 不落凭据、`uses` 引用不可变、顶层权限最小、push `main` 的验证记录不可被取消"不再依赖作者记忆，而是一条会变红的检查，随 `pnpm verify` 进入 `PR Fast Gate`。
2. **自托管 runner 与托管 runner 的威胁模型差异成文。** 密钥不再经过进程命令行；runner 上不再写可预测的共享路径；不调用任何 GitHub API 的 job 拿 `permissions: {}`。
3. **area 词表在仓库内只有一个权威源**，它与仓库真实位置之间的覆盖关系由契约测试守住；`AGENTS.md` 不再逐项复制词表。
4. **共享文档的编号冲突被消除。** `AGENTS.md` §8.6 归"发布面敏感信息自查"（#12 引入，且 #35 已按此编号引用），#19 的 issue 约定改为 §8.7。合并顺序固定为 **#12 → #19 → #21 → #35**。

判断成功的最小证据（在任一受影响分支的 worktree 中执行）：

```bash
pnpm verify                                          # 期望：typecheck 通过；测试全绿
node scripts/workflow-check.mjs                      # 期望：无输出，exit 0
node --test tests/contract/workflow-check.test.js    # 期望：6 条不变量各有一条"注入缺陷→变红"的用例通过
```

---

## Context and Orientation

### 本任务处理的四个分支

| PR | 分支 | worktree | 本任务前 HEAD | 改了哪些文件 |
|---|---|---|---|---|
| #12 | `chore/pr-review-setup` | `.worktrees/pr-review-setup` | `b699b80` | `AGENTS.md`、`.github/pull_request_template.md`、`.github/workflows/ci.yml`、`docs/review/README.md` |
| #19 | `chore/issue-convention` | `.worktrees/issue-convention` | `b15234d` | `AGENTS.md`、`.github/ISSUE_TEMPLATE/*`、`.github/workflows/issue-policy.yml`、`package.json`、`scripts/policy-check.mjs`、`tests/contract/issue-policy.test.js`、`docs/exec-plan/completed/2026-09-17-issue-convention.md` |
| #21 | `chore/github-review-runner` | `.worktrees/github-review-runner` | `df1c501` | `.github/workflows/github-review.yml`、`docs/review/github-runner.md` |
| #35 | `chore/executable-rule-checks` | `.worktrees/executable-rule-checks` | `d1bf3f6` | `.github/dependabot.yml`、`.github/workflows/rule-checks.yml`、`scripts/rule-checks.mjs`、`tests/contract/rule-checks.test.js` |

四条分支都基于 `main`，彼此没有共同提交。`main` 上目前只有 `.github/workflows/ci.yml` 一个 workflow。

### 术语

- **托管 runner**：GitHub 提供的一次性虚拟机（`runs-on: ubuntu-latest`）。
- **自托管 runner**：本机常驻服务，与登录用户的其它进程共享同一台机器（`runs-on: [self-hosted, macos]`，由 #21 引入）。
- **argv**：进程的命令行参数。在共享机器上，同机进程可读取进程表里的命令行；GitHub Actions 的 secret 掩码只作用于日志，**不作用于进程表**。
- **必需检查 vs advisory 检查**：必需检查被分支保护引用（本仓库只有 `PR Fast Gate`，见 `AGENTS.md` §8.3）；advisory 检查只报告不阻塞（`Issue policy`、`Rule checks` 都是刻意做成 advisory）。
- **rebase-merge**：本仓库在 GitHub 上禁用了 merge commit 与 squash，PR 只能 rebase 合并。因此两条分支改到同一插入点时，后合并的一条**必须**先本地 rebase 解冲突。

### 当前 workflow 的加固现状（本任务要消除的漂移）

| 文件 | 引入者 | job 超时 | checkout 落凭据 | `uses` 引用 | 顶层 permissions | `cancel-in-progress` |
|---|---|---|---|---|---|---|
| `ci.yml` | #12 | ❌ 2 个 job 都没有 | ❌ 未写 | ❌ 3 个都是可移动 tag | `contents: read` | ❌ `true`，但该 workflow 会在 `push: main` 上运行 → 连续两次合并会取消前一次的验证记录 |
| `issue-policy.yml` | #19 | ❌ | ✅ | ❌ `actions/checkout@v4` | `contents/issues/pull-requests: read` | ✅ `true` |
| `github-review.yml` | #21 | ✅ 5 | 无 checkout | 无 `uses` | ⚠️ `contents: read`（该 job 从不调用 GitHub API） | ✅ `false` |
| `rule-checks.yml` | #35 | ✅ 5 | ✅ | ❌ 4 个都是可移动 tag | `contents: read` | ✅ `true`（触发器仅 `pull_request`） |

同一组性质在四个文件里被各自重新决定一次，结果就是四份不同的答案。这就是本任务要消除的东西。

### area 词表的副本现状（本任务要收敛的漂移）

评审意见说有 3 份副本。**实际是 5 份**：

1. `scripts/policy-check.mjs` 的 `AREAS`（21 项）
2. `AGENTS.md` §8.6（#19 版本）的逐项枚举（21 项）
3. `docs/project-management/README.md` 的 Area 选项 ID 表（#11 分支，21 项）
4. GitHub 标签 `area:*`（21 个）
5. GitHub Project #10 的 `Area` 单选字段选项（21 个）

今天五者取值一致。其中第 3、4、5 份是"投影"（需要网络才能核对），第 1、2 份在仓库内、可离线判定。

---

## Design / Spec

### 1. 评审意见逐条核实

| # | 出处 | 意见 | 核实结论 | 判定 |
|---|---|---|---|---|
| 1 | #12 · `ci.yml:20` | `verify` job 缺 `timeout-minutes` | 属实：两个 job 都没有 | **属实** |
| 2 | #12 · `ci.yml:22` | checkout 加 `persist-credentials: false`；第三方 action pin 到 SHA；连带加 `dependabot.yml` | 三件事分开看：<br>· `persist-credentials` 属实，但在 public 仓库 + `contents: read` 下残余风险约为零——它是**姿态一致性**，不是缺陷；<br>· pin 属实，且被 4/4 个文件忽略；<br>· `dependabot.yml` 与 #35 重复（#35 已创建同名文件并给出理由） | **属实**（`persist-credentials` 降级为姿态，`dependabot` 归属 #35） |
| 3 | #12 · `ci.yml:45` | 聚合 job 缺 `timeout-minutes` | 属实 | **属实** |
| 4 | #12 · PR 级 | `cancel-in-progress: true` 对 `push: main` 是错的 | 属实，且是本批唯一的**正确性**缺陷：连续两次合并会让 `main` 上留下一个没有成功 CI 记录的提交 | **属实** |
| 5 | #12 · PR 级 | 建议加 `workflow_dispatch` | 便利而非不变量（UI 上已有的 "Re-run all jobs" 覆盖了常见场景）。一行成本、无副作用 | **属实但低价值，采纳** |
| 6 | #19 · `issue-policy.yml:10` | `labeled`/`unlabeled` 让每次标签变动触发完整检查；建议去掉这两个 type，或把 `cancel-in-progress` 设为 `true` | **前提有误**：`cancel-in-progress: true` 在本 PR 的首个提交 `9129307a` 就已存在，评审时点 `b15234d8` 仍在（`git diff 9129307a b15234d8 -- .github/workflows/issue-policy.yml` 输出为空）。其"第二个方向"已经实现。剩下可执行的只有"去掉两个 type"，而 issue 的标签合法性正是该检查的判定对象之一，去掉后标签变更将不再被检查 | **不属实；建议动作会降低覆盖 → 驳回** |
| 7 | #19 · `issue-policy.yml:26` | 缺 `timeout-minutes` | 属实 | **属实** |
| 8 | #19 · `policy-check.mjs:23` | 同一份 area 词表有三个副本，无一致性保证；建议让契约测试断言 `AREAS` 与 `packages/*`、`packages/providers/*`、`packages/storage/*`、`apps/*`、`docs/*` 的目录名一致 | **诊断属实（副本是 5 份不是 3 份），提议的推导方式有误**：按它派生会多出 `planning-local`、`sqlite`、`web`、`harness-plugin`、`planning-github-projects` 等**不在词表里**的名字，并漏掉 `providers`、`storage`、`apps`、`tests`、`docs`、`project-management`、`review`、`development` 共 8 个真实 area。本仓库词表的聚合层级是"包的顶层目录名"，不是"每个 provider 包" | **属实但方案需重做** |
| 9 | #21 · `github-review.yml:50` | `openssl dgst -hmac "$SECRET"` 把密钥放进 argv | 属实，且是本批唯一**无歧义的安全缺陷**：该 job 跑在自托管 runner 上，密钥在 openssl 存活期间出现在同机进程表里 | **属实** |
| 10 | #21 · `github-review.yml:23` | `permissions` 可以收到 `{}` | 属实：该 job 不 checkout、不调用任何 GitHub API | **属实** |

### 2. 评审没有提到、但属于同一根机制的问题

| # | 事实 | 证据 |
|---|---|---|
| 11 | `github-review.yml` 把响应体写到 `/tmp/dsh-review-response.txt`——自托管机器上可预测的共享路径 | `git show chore/github-review-runner:.github/workflows/github-review.yml` |
| 12 | #12 与 #19 **都新增了 `### 8.6`**，插入点相同 → rebase-merge 必然冲突。#12 的 PR 描述里"唯一可能的交集是 `AGENTS.md` 的索引表（两行级解冲突）"这一断言被证伪 | `git diff main...chore/pr-review-setup -- AGENTS.md` 与 `git diff main...chore/issue-convention -- AGENTS.md` 都以 `### 8.5` 之后为锚点插入 |
| 13 | #19 的 issue 表单把 area 词表指向 `docs/project-management/README.md`，而该文件只存在于 #11 的分支上 → 在 `main`（以及 #19 自己的分支）上是悬空链接 | `git show chore/issue-convention:.github/ISSUE_TEMPLATE/task.yml` 对比 `git ls-tree chore/issue-convention:docs` |
| 14 | #11 的 `docs/project-management/README.md` 有 4 处 `AGENTS.md §8.6`，指的是 issue 约定；#11 分支上 `AGENTS.md` 并没有 §8.6 → 悬空引用 | `git grep -n "§8\.6" project-management/github-projects-board` |
| 15 | `scripts/policy-check.mjs` 的文件头与错误信息也把权威指向 `docs/project-management/README.md`，与 `AGENTS.md` §1"本文件是唯一权威约定"冲突 | `git show chore/issue-convention:scripts/policy-check.mjs` |

### 3. 根机制

- **RM1｜workflow 加固性质没有规范载体，也没有检查。** 症状是 6 条分散的加固缺失（评审意见 1、2、3、5、7、10），直接原因是四个文件各自手写，根机制是"性质从未被写成不变量、也没有任何东西执行它"，使能条件是"本仓库已有两处把约定变成离线检查的先例（`package-boundaries`、`issue-policy`），唯独 workflow 没有"。
- **RM2｜自托管 runner 的威胁模型没有成文。** 症状是密钥进 argv（意见 9）与可预测共享路径（发现 11），根机制是"自托管机器的共享属性没有被表述，workflow 沿用了托管 runner 的习惯"，使能条件是 `AGENTS.md` §10 只写了"密钥永不入库"，没有写"密钥不得进 argv / 不得落可预测的共享路径"。
- **RM3｜同一份事实多副本、无权威源、无一致性检查。** 症状是 area 词表 5 份（意见 8、发现 3、13、15），根机制是"词表的身份被理解为'一份清单'而不是'一条从仓库结构派生出来的规则'"，于是每次扩展都要在三到五处重复决定。
- **RM4｜并行 PR 对共享文档没有任何编排。** 症状是发现 12、13、14，根机制是"`AGENTS.md` 的章节编号与交叉引用被当作各 PR 的私有资源"，使能条件是"没有合并顺序的声明，也没有任何东西核对引用是否指向存在的章节"。

RM1 与 RM3 是同一个更抽象原则的两个实例：**同一份事实/同一条性质在多处各自声明，且没有机械检查**。本仓库已经把这条原则应用了两次（`tests/contract/package-boundaries.test.js`、`tests/contract/issue-policy.test.js`）。本任务把它应用第三次，并把"什么时候该做成必需门禁、什么时候只做 advisory"写成判定准则。

### 4. 方案与被放弃的方案

**采纳：不变量成文 + 离线检查 + 各自 PR 内对齐自己的 workflow 文件。**

- 不变量写成 `AGENTS.md` §9.5，检查落在 `scripts/workflow-check.mjs` + `tests/contract/workflow-check.test.js`，随 `pnpm verify` 进 `PR Fast Gate`。
- 每个 PR 只改自己引入的 workflow 文件，因此四条分支的文件集互不相交，任意顺序都能 rebase。

**被放弃：逐条打补丁（7 处）。** 反例已经在证据里：同一作者在同一轮里写了四个 workflow，`timeout-minutes` 只写对 1/4，`persist-credentials` 只写对 1/3。手工补第 5 个 workflow 时还是会漏。

**被放弃：把检查放进 #35。** #35 的自我定位就是"把成文规则变成可执行检查"，看起来是天然归宿。但它排在队列最后，而 #12/#19/#21 的合规在那之前无法判定——违反 `AGENTS.md` §5.1 判据 1（可判定）。

**被放弃：按评审建议从 `packages/providers/*`、`packages/storage/*` 派生词表。** 与本仓库实际的聚合层级不符（见意见 8 的核实）。按它实现会立刻产生一批假阴性（真实 area 被判违规）。

**被放弃：让 `AGENTS.md` 继续逐项枚举词表 + 用契约测试断言文档与代码一致。** 需要在文档里塞机器可读标记，且仍留两份副本。改为"文档写派生规则 + 打印命令，代码持值"。

**采纳：`yaml` 作为 devDependency。** 该检查的全部价值在于可信度；`AGENTS.md` 自己在 #12 的描述里已记录过一次同类事故——"语法无效的 workflow 不会报检查失败，只是完全不创建检查"。手写 YAML 子集解析器的失败模式正是**假绿**，与那次事故同类。备选方案（手写 fail-closed 子集解析器）保留在 Decision Log 里。

**采纳：编号切分与合并顺序。** #12 保留 §8.6（#35 已按"§8.6 = 发布面自查"写了 5 处引用），#19 改到 §8.7。合并顺序 **#12 → #19 → #21 → #35**。

### 5. 冻结接口（四个实现者共同遵守）

#### 5.1 workflow 不变量 W1–W6

| id | 不变量 | 判定 |
|---|---|---|
| **W1** | 每个 job 声明 `timeout-minutes`，整数且 `1 ≤ n ≤ 15` | 缺失或越界即违规 |
| **W2** | 每个 `actions/checkout` step 声明 `with.persist-credentials: false` | 缺失即违规 |
| **W3** | 每个 step 的 `uses` 若不是本地引用（不以 `./` 开头），必须写成 `<owner>/<repo>[/<path>]@<40 位十六进制>` | 不是 40 位 hex 即违规 |
| **W4** | 每个 workflow 顶层声明 `permissions`；任何键的取值不得是 `write`（即值不以 `write` 开头）。此外，若任一 job 的 `runs-on` 含 `self-hosted`，顶层 `permissions` 必须是空映射 `{}` | 缺失、含 write、或自托管但非 `{}` 即违规 |
| **W5** | 若 workflow 的 `on.push` 会覆盖默认分支（`push` 存在且未限定 `branches`，或 `branches` 含 `main`），则 `concurrency.cancel-in-progress` 不得是字面量 `true` | 是字面量 `true` 即违规 |
| **W6** | 若声明了 `concurrency`，必须显式声明 `cancel-in-progress` | 缺失即违规 |

**W1 的上界取 15 的理由**：本仓库当前最长的 lane 实测 18 秒（#12 的 PR 描述），15 分钟是 50 倍余量，同时把"卡住的 job 占满 runner 默认 360 分钟"这类浪费挡在门外。将来出现合法需要更长时间的真实 lane 时，改这个上界是一次有意识的决策（改检查 + 改本节），而不是在单个 workflow 里悄悄放宽。

**W3 不设官方/第三方豁免的理由**：`actions/*` 的 tag 同样可移动。用"厂商身份"做豁免等于在检查器里引入一份需要人工维护的分类表——那正是 RM3 本身。pin 之后的升级由 `.github/dependabot.yml`（`github-actions` ecosystem，由 #35 引入）承担。

**W6 是最弱的一条**：它不修复任何已发生的漂移。保留它的理由是"隐式的默认值会让评审读错"——本轮评审意见 6 正是一次对并发语义的误读。它把并发意图变成文件里看得见的一行。

#### 5.2 检查器接口

```text
scripts/workflow-check.mjs
  export const RULES                                  // [{ id: 'W1', title: '<中文一句话>' }, ...]
  export function checkWorkflows(rootDir)             // -> Finding[]
  // Finding = { rule: 'W1', file: '.github/workflows/ci.yml', job: 'verify' | null, message: string }
  // file 是相对 rootDir 的路径，用 '/' 分隔
  // CLI: node scripts/workflow-check.mjs [rootDir]
  //   有 finding：每行 `::error::<file> [<rule>] <message>`，exit 1
  //   无 finding：打印一行汇总，exit 0
  // rootDir 默认取 process.cwd()；无 .github/workflows 目录时视为无 finding
```

`checkWorkflows` 接受 rootDir 参数是刻意的：它让"用 A 分支的检查器核对 B 分支的 workflow"成为一条命令，因此 #19/#21 的合规在 #12 合并之前也可判定。

#### 5.3 契约测试接口

```text
tests/contract/workflow-check.test.js
  1. 「仓库当前的所有 workflow 满足全部不变量」：checkWorkflows(<repo root>) 必须 deepEqual []
  2. 「每条不变量都有牙」：对 W1..W6 各写一条用例——先写一份合规的最小 workflow，
     再注入该条缺陷，断言恰好该 rule 出现且其它 rule 不出现
```

#### 5.4 area 词表接口

```text
scripts/policy-check.mjs
  export const AREAS                                  // 取值与今天完全一致（21 项），仓库内唯一权威
  export const PROCESS_AREAS = ['ci', 'repo']         // 不对应任何目录的过程域
  export function requiredAreas(rootDir)              // -> string[]，必须在词表里出现的项：
                                                      //    packages/* 深度 1 的目录名
                                                      //    + 'apps'、'tests'、'docs'
                                                      //    + docs/* 深度 1 的目录名
                                                      //    + PROCESS_AREAS（过程域不对应目录，但同样必须在词表里）
  export function missingAreas(rootDir)               // requiredAreas 中不在 AREAS 里的项
  // CLI 新增：node scripts/policy-check.mjs areas     // 按字母序打印 AREAS 的 21 个取值，一行一个
```

**为什么是单向覆盖（`AREAS ⊇ requiredAreas`）而不是相等**：仓库当前有 `review`、`development`、`project-management` 三个 area，它们的目录分别由 #12、#13、#11 引入；在这三份 PR 合并前的任意一条分支上，相等判定都会误报，而覆盖判定在任何合并顺序下都可判定，并且**恰好**杀掉了评审指出的那个失败模式——新增一个包或 `docs/` 子目录时，测试立刻变红，提醒同步词表的另外几份投影。

**残余（如实记录）**：反向（`AREAS` 里的陈旧项）与三份投影（标签、Project 字段、#11 的 ID 表）无法离线判定。前者记为已知缺口；后者由 `node scripts/policy-check.mjs areas` 提供可复制的同步输入。

#### 5.5 编号契约

| 章节 | 归属 | 内容 |
|---|---|---|
| §8.6 | #12 | 提交与 PR 前的敏感信息自查（公开仓库）——**不变**，#35 已按此引用 |
| §8.7 | #19 | Issue 与标签约定——原 §8.6 全部改号，含 `AGENTS.md` §0 表、§3.3、§8.3、§9.1、§11、issue 表单、`scripts/policy-check.mjs` 的注释与错误信息、契约测试的文件头、以及 #19 自带的已完成计划 |
| §9.2 | #12 | 增补"门禁级别的判定准则" |
| §9.5 | #12 | 新增 workflow 不变量 W1–W6 |
| §10 | #12 / #21 | #12 改第一条（发布面自查）；#21 在列表**末尾**追加自托管 runner 威胁模型一条，两点之间隔 4 行以免 rebase 冲突 |

#### 5.6 门禁级别的判定准则（写入 §9.2）

> 一条规则做成必需检查还是 advisory，判据不是"重要性"，而是**可判定性与误报代价**：
> 机械可判定、且没有需要人来判断的误报类别 → 进 `pnpm verify`（随 `PR Fast Gate` 成为必需）；
> 判定里含人的解释（措辞、体量、披露类目）→ 做成可见但不阻塞的 advisory 检查，并写明提升为必需检查的前置条件。
> 已有三例：`package-boundaries`（必需）、`Issue policy`（advisory）、`Rule checks`（advisory）。

### 6. 各分支的最终内容

**#12**
- `AGENTS.md`：§9.2 追加门禁级别判定准则；新增 §9.5（W1–W6 + 检查命令 + "pin 的升级由 `.github/dependabot.yml` 承担"）。
- `.github/workflows/ci.yml`：两个 job 各加 `timeout-minutes`（`verify` 10、`fast-gate` 5）；`checkout` 加 `persist-credentials: false`；三个 `uses` 全部 pin；顶层 `concurrency.cancel-in-progress` 改为 `${{ github.event_name == 'pull_request' }}`；`on:` 增加 `workflow_dispatch`。
- `scripts/workflow-check.mjs`（新）、`tests/contract/workflow-check.test.js`（新）。
- `package.json` + `pnpm-lock.yaml`：加 `yaml` devDependency。**不新增 npm script**（避免与 #19 在同一区块插入）。
- 本文件（ExecPlan）。

**#19**
- `AGENTS.md`：§8.6 → §8.7（含全部交叉引用）；§8.7 的逐项枚举替换为派生规则 + `node scripts/policy-check.mjs areas` + "另两份投影"的说明；`docs/project-management/README.md` 只作为 Project 字段选项 ID 表的落点被引用。
- `scripts/policy-check.mjs`：`AREAS` 保留为唯一权威；新增 `PROCESS_AREAS`、`requiredAreas`、`missingAreas` 与 `areas` 子命令；文件头与错误信息改指 §8.7。
- `tests/contract/issue-policy.test.js`：新增覆盖用例（`missingAreas` 必须为空）；文件头改指 §8.7。
- `.github/ISSUE_TEMPLATE/{task,bug}.yml`：area 词表的链接改指 `AGENTS.md` §8.7（去掉对未合并文件的依赖）；`config.yml` 同理。
- `.github/workflows/issue-policy.yml`：加 `timeout-minutes: 5`；`actions/checkout` pin。
- `docs/exec-plan/completed/2026-09-17-issue-convention.md`：§ 引用改号。

**#21**
- `.github/workflows/github-review.yml`：顶层 `permissions: {}`；签名改用 node 的 `crypto`（密钥只经环境变量，不进 argv、不落盘）；响应体改写到 `$RUNNER_TEMP`。
- `AGENTS.md` §10：末尾追加自托管 runner 威胁模型一条。
- `docs/review/github-runner.md`：同步威胁模型说明与新的验签命令。

**#35**
- `.github/workflows/rule-checks.yml`：四个 `uses` 全部 pin（其余不变量已满足）。
- 不改其它文件；`dependabot.yml` 留在 #35（它是 #35 的"闭环"的一部分）。

---

## Global Constraints

- 文档正文用中文；代码标识符、路径、命令、类型名用英文（`AGENTS.md` §3.3）。
- 提交信息 `<type>(<scope>): 中文摘要`，正文写**为什么**，结尾 `Closes #N` / `Refs #N`（§8.2）。
- 不写占位符（`TBD`、`稍后补充`）、不写"应该可以"（`PLANS.md` §4）。
- 不直接推 `main`；不修改分支保护；不合并任何 PR（§8.3）。
- 不改 #11（用户决定，见 Decision Log）；只改 #35 的 action pin。
- 所有 pin 一律附带 `# vX.Y.Z` 注释，取值必须是**当前 `@vN` 实际指向的提交**（不顺手升级）。
- 每条分支在推送前必须 `pnpm verify` 全绿，并完成 `AGENTS.md` §8.6 的敏感信息自查。
- 历史改写（fold 评审修复）后推送使用 `git push --force-with-lease`，并在 PR 描述里记录（#21 已有先例）。

---

## Plan of Work

### Batch A · #12：workflow 不变量成文 + 可执行检查 + `ci.yml` 对齐

**最小闭环**：`pnpm verify` 里出现一条会因 workflow 加固缺失而变红的检查，且 `ci.yml` 自身满足全部 6 条不变量。
**涉及文件**：`AGENTS.md`、`.github/workflows/ci.yml`、`scripts/workflow-check.mjs`（新）、`tests/contract/workflow-check.test.js`（新）、`package.json`、`pnpm-lock.yaml`、`docs/exec-plan/active/2026-09-18-review-feedback-convergence.md`（本文件）

- [ ] 步骤 1：先写 `tests/contract/workflow-check.test.js`（合规基线 + W1..W6 各一条注入用例），运行 `node --test tests/contract/workflow-check.test.js`，确认因 `scripts/workflow-check.mjs` 不存在而失败。
- [ ] 步骤 2：实现 `scripts/workflow-check.mjs`，运行同一条命令至全绿。
- [ ] 步骤 3：`pnpm add -D yaml`，确认 `pnpm-lock.yaml` 只多了 `yaml` 相关条目。
- [ ] 步骤 4：按 §5.2 的接口跑 `node scripts/workflow-check.mjs`，此时应报出 `ci.yml` 的违规（W1 ×2、W2、W3 ×3、W5）。
- [ ] 步骤 5：改 `ci.yml` 至 `node scripts/workflow-check.mjs` 无输出、exit 0。
- [ ] 步骤 6：写 `AGENTS.md` §9.2 判定准则与 §9.5。

**验证**：`pnpm verify`（typecheck + 全部测试）全绿；`node scripts/workflow-check.mjs; echo $?` → `0`；把 `ci.yml` 的 `timeout-minutes` 临时删掉后 `pnpm verify` 变红，恢复后回绿。
**回滚**：`git revert` 本批提交即可——检查与合规同批引入，撤销后 `ci.yml` 回到未加固但可合并的版本。

### Batch B · #19：area 词表单源化 + 编号改 §8.7 + `issue-policy.yml` 对齐

**最小闭环**：仓库内只剩一份 area 词表，且它与仓库真实结构的覆盖关系被契约测试守住；`AGENTS.md` 里没有 §8.6 指 issue 约定。
**涉及文件**：`AGENTS.md`、`.github/ISSUE_TEMPLATE/{task,bug,config}.yml`、`.github/workflows/issue-policy.yml`、`scripts/policy-check.mjs`、`tests/contract/issue-policy.test.js`、`docs/exec-plan/completed/2026-09-17-issue-convention.md`

- [ ] 步骤 1：在 `tests/contract/issue-policy.test.js` 增加覆盖用例（`missingAreas(<repo root>)` 必须 `[]`），运行至失败。
- [ ] 步骤 2：在 `scripts/policy-check.mjs` 实现 `PROCESS_AREAS`、`requiredAreas`、`missingAreas` 与 `areas` 子命令，运行至全绿。
- [ ] 步骤 3：`AGENTS.md` 全文把"issue 约定"的 §8.6 改为 §8.7，并把 §8.7 里的 21 项枚举替换为派生规则 + 打印命令 + 两份投影的说明。
- [ ] 步骤 4：issue 表单与 `config.yml` 的链接改指 `AGENTS.md` §8.7。
- [ ] 步骤 5：`issue-policy.yml` 加 `timeout-minutes: 5`、pin `actions/checkout`。
- [ ] 步骤 6：`node scripts/policy-check.mjs areas` 打印 21 项；对 #4、#10 与在审 PR 重跑 `issue`/`pr` 子命令。

**验证**：`pnpm verify` 全绿；`node scripts/policy-check.mjs areas | wc -l` → `21`；`node scripts/policy-check.mjs issue 4` 与 `pr 12` 通过；`git grep -n "§8\.6"` 在 #19 分支上只应剩下 #12 范畴以外的零结果。
**回滚**：`git revert` 本批提交；词表取值未变，标签与 Project 字段不需要动。

### Batch C · #21：自托管威胁模型成文 + 密钥出 argv + 最小权限

**最小闭环**：`github-review.yml` 里没有任何密钥经过 argv、没有可预测的共享路径，且该 job 的 `permissions` 为 `{}`。
**涉及文件**：`.github/workflows/github-review.yml`、`AGENTS.md`、`docs/review/github-runner.md`

- [ ] 步骤 1：把签名换成 `node` 的 `crypto`（从 `process.env` 读密钥、从 `$EVENT_PATH` 读字节、输出 hex digest），**先在 shell 里单独验证新写法与旧写法对同一文件产生同一个签名**。
- [ ] 步骤 2：`permissions: {}`；响应体改写到 `$RUNNER_TEMP`。
- [ ] 步骤 3：`AGENTS.md` §10 末尾追加自托管 runner 威胁模型一条。
- [ ] 步骤 4：同步 `docs/review/github-runner.md`。

**验证**：新旧签名对同一事件文件输出相同（记录两条命令与输出）；`pnpm verify` 全绿；`node scripts/workflow-check.mjs <本 worktree>` 无输出（用 #12 worktree 的检查器跨分支核对）；workflow YAML 可解析。
**回滚**：`git revert` 本批提交，回到 openssl 版本（功能可用，仅保留 argv 暴露）。

### Batch D · #35：action pin 对齐

**最小闭环**：`rule-checks.yml` 满足 W1–W6，从而在 Batch A 的检查进 `main` 后不变红。
**涉及文件**：`.github/workflows/rule-checks.yml`

- [ ] 步骤 1：四个 `uses` 全部 pin，取当前 `@v4` 实际指向的提交 SHA。
- [ ] 步骤 2：用 #12 worktree 的检查器跨分支核对。

**验证**：`node scripts/workflow-check.mjs .worktrees/executable-rule-checks`（从 #12 worktree 运行）无输出；`pnpm verify` 全绿。
**回滚**：`git revert` 本批提交。

### Batch E · 独立验证、历史整理与推送

**最小闭环**：四条分支的历史与批次一一对应、全部验证重新跑绿、远端与本地一致。
**涉及文件**：无（只动 git 历史与 PR 描述）

- [ ] 步骤 1：在每条 worktree 重新跑 `pnpm verify` 与 `node scripts/workflow-check.mjs`（不看实现者的自述）。
- [ ] 步骤 2：把评审修复折进它所属的批次提交（`git commit --fixup` + `rebase --autosquash`）。
- [ ] 步骤 3：用临时分支模拟 #12 → #19 → #21 → #35 的 rebase 顺序，确认无冲突。
- [ ] 步骤 4：`git push --force-with-lease` 四条分支。
- [ ] 步骤 5：更新四条 PR 的描述（交付内容、验证证据、合并顺序）。

**验证**：四条分支 `pnpm verify` 全绿；模拟 rebase 无冲突；`git log --oneline` 每条分支的提交与本文档批次对应。
**回滚**：改写前在每条分支建 `backup/pre-rebase-<slug>` 标签；远端用 `git push --force-with-lease`。

---

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | workflow 不变量成文 | `AGENTS.md` §9.5 存在且列出 W1–W6 |
| 2 | 检查离线可判定 | `node scripts/workflow-check.mjs` 在四条分支上都 exit 0 |
| 3 | 检查有牙 | `node --test tests/contract/workflow-check.test.js` 全绿，含 W1–W6 各一条注入用例 |
| 4 | 评审意见 4（`main` 记录被取消）已修 | `ci.yml` 的 `cancel-in-progress` 是 `${{ github.event_name == 'pull_request' }}` |
| 5 | 评审意见 9（密钥进 argv）已修 | `github-review.yml` 中 `git grep -n "hmac\|DSH_GITHUB_WEBHOOK_SECRET"` 只出现在 node 脚本与 env 声明里 |
| 6 | 评审意见 6 被驳回且有证据 | 本文件 §1 第 6 行；`issue-policy.yml` 保留 `labeled`/`unlabeled` |
| 7 | 评审意见 8 被部分驳回且有证据 | 本文件 §1 第 8 行的逐项反例 |
| 8 | area 词表单源 | `AGENTS.md` §8.7 不再逐项枚举；`node scripts/policy-check.mjs areas` 输出 21 行 |
| 9 | 词表覆盖被守住 | `tests/contract/issue-policy.test.js` 的覆盖用例存在且通过 |
| 10 | 编号冲突消除 | #19 分支上不存在指 issue 约定的 `§8.6`；模拟 rebase 无冲突 |
| 11 | 四处 PR 的检查全绿 | `pnpm verify` 与 `node scripts/workflow-check.mjs` 在四条分支上的实际输出 |
| 12 | 发布面自查 | `AGENTS.md` §8.6 的机械扫描命令输出为空 |

---

## Progress

- [x] (2026-09-18) Batch A · #12：workflow 不变量成文 + `scripts/workflow-check.mjs` + 契约测试 + `ci.yml` 对齐
- [x] (2026-09-18) Batch B · #19：area 词表单源化 + 编号改 §8.7 + `issue-policy.yml` 对齐 + 补 `docs/README.md` 索引
- [x] (2026-09-18) Batch C · #21：自托管威胁模型成文 + 密钥出 argv + `permissions: {}` + `$RUNNER_TEMP`
- [x] (2026-09-18) Batch D · #35：action pin 对齐（由并行会话连带提交，见 `Surprises`）
- [x] (2026-09-18) Batch E · 独立验证、历史整理与推送 —— 四条分支的改动已全部验证：`pnpm verify` 在 #12/#19/#21/#35 上分别为 23/13/5/16 全绿，检查器无 finding，合并顺序实测 42/42；评审修复已折进对应批次提交；三条分支以 `--force-with-lease` 推送（#35 无需推送）；#12/#19/#21 的 8 条行内 thread 已逐条回复并 resolve，另在 #12 顶层回复了两条无 thread 的评审意见

---

## Surprises & Discoveries

- (2026-09-18) **评审意见 6 的前提是错的。** 意见说"现在这个 workflow 的 concurrency 已经有 group，只需让后来者取消先到者"，但 `cancel-in-progress: true` 在本 PR 的**首个提交**里就已经存在。证据：`git diff 9129307a b15234d8 -- .github/workflows/issue-policy.yml` 输出为空，且 `git show b15234d8:.github/workflows/issue-policy.yml`（评审时点的提交）第 17 行就是 `cancel-in-progress: true`。剩下的可执行建议（去掉 `labeled`/`unlabeled`）会降低覆盖，因此驳回。
- (2026-09-18) **评审意见 8 的副本数是 3，实际是 5。** 漏掉的两份在仓库内：`AGENTS.md` §8.6（#19 版本）与 `docs/project-management/README.md` 的 Area 选项 ID 表（#11 分支）。后者还是 issue 表单当前指向的"权威"。
- (2026-09-18) **评审意见 8 提议的派生方式与本仓库的聚合层级不符。** 按 `packages/providers/*`、`packages/storage/*` 派生会得到 `planning-local`、`sqlite` 等不在词表里的名字，并漏掉 8 个真实 area。
- (2026-09-18) **#12 与 #19 都新增了 `### 8.6`，插入点相同。** #12 的 PR 描述里"唯一可能的交集是 `AGENTS.md` 的索引表"这一断言被证伪；这条冲突两份 PR 的评审都没有发现。
- (2026-09-18) **`docs/project-management/README.md` 在 `main` 上不存在**，而 #19 的 issue 表单把它当作 area 词表的权威链接（#11 才创建它）。这是跨 PR 悬空引用，不是本分支自身的问题。
- (2026-09-18) **#11 的 4 处 `AGENTS.md §8.6` 在它自己的分支上就是悬空的**（该分支不新增 §8.6）。本任务按用户决定不修 #11，记入 `Outcomes & Retrospective`。
- (2026-09-18) **对抗性验证在检查器里找出 4 个缺陷，其中 3 个是假绿。** 检查器第一次落盘、`pnpm verify` 全绿、6 条"注入缺陷"用例全过之后，用 `/tmp` 下的对抗性 fixture 才发现：
  - **D1（假绿，最严重）**：`on: push` 写成字符串、或 `on: [push, pull_request]` 写成数组时，W5 静默放过。而这两种写法都覆盖全部分支——**这正是评审意见 4 要拦的那个缺陷本身**。证据：`node scripts/workflow-check.mjs /tmp/wc-attack` 只报出 `d3.yml`，`d1a.yml`/`d1b.yml` 无输出。
  - **D2（假绿）**：job 级 `permissions:` 会覆盖顶层，检查器只看顶层。`jobs.build.permissions: { contents: write }` 一路通过。
  - **D3（误报）**：`push.branches-ignore: [main]` 时 push 并不覆盖默认分支，却被判违规。误报会把人推向"绕过这条检查"。
  - **D4（静默失效）**：CLI 入口判定写成 `import.meta.url === \`file://${process.argv[1]}\``。`import.meta.url` 会对路径里的空格做百分号编码，两者不相等时 `main()` 被静默跳过——**同一个违规目录，路径无空格时 exit 1，路径含空格时 exit 0 且无输出**。检查器变成永远通过。
  四条已修复，并各补了一条"注入缺陷"用例（其中 D4 的用例把脚本复制到含空格的临时目录里真实执行）。测试数从 14 增至 23。这条经历本身就是"注入用例写得再好，也只覆盖作者想到的形态"的证据。
- (2026-09-18) **模型可用性：`gpt-5.6-sol` 在本环境里跑不完长会话。** 第一轮把 Batch A/B/C 都交给它，三个 agent 全部中途失败（Batch A 只写完测试文件就断了；B/C 无产物）。同一提示下 `deepseek-v4.1-flash` 与 `gpt-5.6-luna` 完成。第二轮的 `B2`（luna）也在**改完全部文件之后**才失败，报告为 `null`，但工作区改动完整——**"agent 报告失败"与"agent 没做成事"是两件事，必须以工作区与验证输出为准**（`verification-before-completion`：Trusting agent success reports 的反面同样成立：不要相信失败报告，要自己看）。
- (2026-09-18) **有另一条并行会话在同一工作区提交代码。** Batch D 的改动被那条会话在 `11:37:40` 连同它自己的看板字段改名一起提交并推送（`901ae6b`，提交信息是"同步看板字段改名（规模 → Size）"，与 pin 无关）。因此 #35 的 pin 已进远端，但埋在一个主题不同的提交里。本任务不改写它的历史（改写会覆盖另一个 actor 的工作），改为在报告里指出。
- (2026-09-18) **改号并不能消除 #12 与 #19 的合并冲突。** 在临时分支上按冻结顺序逐条 cherry-pick 的实测结果：#12 单独干净；#19 在 `AGENTS.md` 上**三处冲突**——§0 快速开始表（两行同锚点）、§8.5 之后的 `### 8.6` / `### 8.7` 插入点、§11 参考表（两行同锚点）；#21 与 #35 干净应用。三处都是"两边都保留"，其中 §0 的 `提交代码` 行两侧各自改写过，需要合并成一行。全部解完后的状态：`pnpm verify` **42/42 通过**、`node scripts/workflow-check.mjs` 无 finding、四个 workflow 同时存在。
  结论：**两份 PR 都往同一章节的同一锚点追加内容，冲突与编号无关**。改号解决的是"两个 §8.6 同时存在"的语义错误，不是 git 冲突。PR 描述里必须写明合并顺序与这三处解冲突点，否则人类伙伴会在 merge 按钮变灰时才发现。
- (2026-09-18) **#19 单独存在时 §8 会出现编号断层**（8.1–8.5 之后直接是 8.7）。这是让位给 #12 的必然代价，合并 #12 之后即消失；已写进 #19 的 PR 描述。

---

## Decision Log

- Decision: 把"workflow 加固性质"做成成文不变量 + 离线检查，而不是逐条补 7 处补丁。
  Rationale: 证据显示同一组性质在四个文件里已漂移（`timeout-minutes` 1/4、`persist-credentials` 1/3、pin 0/4）；手工补第 5 个 workflow 会继续漏。
  Date/Author: 2026-09-18 / DSH agent

- Decision: 检查放在 #12，而不是 #35。
  Rationale: #35 排在队列最后（其 PR 描述自述第 9 位），放在那里会让 #12/#19/#21 的合规在此之前无法判定，违反"可判定"判据。
  Date/Author: 2026-09-18 / DSH agent

- Decision: 新增 `yaml` devDependency，而不是手写 fail-closed 的 YAML 子集解析器。
  Rationale: 检查的价值全在可信度；手写解析器的失败模式是假绿，与本仓库已记录的"语法无效的 workflow 只是不创建检查"属同类事故。备选方案的成本是约 120 行需要跟随 Actions 语法演进的代码。
  Date/Author: 2026-09-18 / DSH agent

- Decision: `#12` 保留 §8.6，`#19` 的 issue 约定改为 §8.7；合并顺序 #12 → #19 → #21 → #35。
  Rationale: #35 已按"§8.6 = 发布面自查"写了 5 处引用，改动它代价更大；#12 是声明中的第一条。编号冲突必须由后合并的一条让位，这里把让位方固定下来，避免每次合并都要重新判断。
  Date/Author: 2026-09-18 / DSH agent

- Decision: area 词表用"单向覆盖"（`AREAS ⊇ requiredAreas`）而不是"相等"。
  Rationale: `review`、`development`、`project-management` 三个 area 的目录由其它在审 PR 引入，相等判定在任何单条分支上都会误报；覆盖判定在任何合并顺序下都可判定，且恰好覆盖评审指出的失败模式。
  Date/Author: 2026-09-18 / DSH agent

- Decision: 不设官方 action 的 pin 豁免。
  Rationale: tag 对 `actions/*` 同样可移动；用厂商身份做豁免等于在检查器里引入一份需人工维护的分类表，即 RM3 本身。
  Date/Author: 2026-09-18 / DSH agent

- Decision: 驳回评审意见 6（去掉 `labeled`/`unlabeled`）。
  Rationale: 其立论前提（并发未取消）不成立；去掉两个触发器会让标签变更后的不合规状态不再被检查，即用覆盖换取一个已被消除的成本。
  Date/Author: 2026-09-18 / DSH agent

- Decision: 不改 #11（用户明确选择"只做 #12/#19/#21，把 #11 写进报告"）。
  Rationale: 越出用户给定的评审回复范围；#11 的 4 处悬空引用记入遗留。
  Date/Author: 2026-09-18 / DSH agent

- Decision: 改 #35，范围仅限 action pin（用户选择"一并修 #35"）。
  Rationale: Batch A 的检查会让 `rule-checks.yml` 在 #12 合并后立即变红；pin 是 4 行机械改动，无行为变化。`dependabot.yml` 留在 #35，因为它是 #35"pin 之后升级不腐化"这条闭环的一半。
  Date/Author: 2026-09-18 / DSH agent

- Decision: 在对抗性验证发现假绿之后，把 W4 扩展到 job 级 `permissions`，把 W5 扩展到 `on` 的字符串/数组写法与 `branches-ignore`（即修订本文档 §5.1 的冻结表述）。
  Rationale: 冻结接口的目的是让四个实现者产出可组合的结果，不是给已发现的假绿发豁免。W4 原本只查顶层，而 job 级 `permissions` 会覆盖顶层——那等于给最小权限留后门；W5 原本只认 `on` 的映射写法，而 `on: push` 与 `on: [push, …]` 恰恰是最常见的两种写法，且正是这条规则要拦的缺陷。同时修掉 `branches-ignore: [main]` 的误报：必需门禁里不能有机械可判定的误报类别（§9.2 的判定准则）。
  Date/Author: 2026-09-18 / DSH agent

- Decision: 不改写 #35 的历史。
  Rationale: 那条分支的提交由另一条并行会话创建并已推送，其中同时含它自己的看板字段改名改动；改写会覆盖另一个 actor 的工作。历史主题不纯的问题在报告里指出，由人类伙伴处置。
  Date/Author: 2026-09-18 / DSH agent

- Decision: 保留 `docs/review/github-runner.md` 的整体中文化（超出三处技术同步的部分）。
  Rationale: 该文档由 #21 以英文引入，而 `AGENTS.md` §3.3 规定文档正文用中文，同目录的 `docs/review/README.md`（#12 引入）也是中文——它是该目录里的孤例。这不是风格偏好，是已成立的约定。代价是 #21 的 diff 变大、评审需要重读该文档；若人类伙伴认为应拆成独立提交，可以单独 revert 这一个文件。
  Date/Author: 2026-09-18 / DSH agent

- Decision: 历史改写只在 #12/#19/#21 三条分支上做，并用 `git push --force-with-lease=<ref>:<期望 SHA>` 推送。
  Rationale: 同一工作区里存在并行 actor，`--force-with-lease` 让"远端已被别人推进"变成一次被拒绝的推送，而不是一次静默覆盖。
  Date/Author: 2026-09-18 / DSH agent

---

## Idempotence and Recovery

- Batch A–D 的每一步都可以重复执行：`pnpm add -D yaml` 幂等；workflow 改写是整文件替换；契约测试可反复运行。
- 历史改写前在每条分支建 `backup/pre-rebase-<slug>` 标签。远端已存在的分支用 `--force-with-lease` 推送，失败即说明远端有新提交，先 `git fetch` 再判断。
- `#21` 的分支此前已被 force push 过一次（`54b5ef2` → `df1c501`，见其 PR 描述），其 PR ref 历史已被重写，本地不要基于旧副本继续提交。
- 任何一条分支验证失败时的恢复点：`git reset --hard backup/pre-rebase-<slug>`。
- `pnpm-lock.yaml` 若被 `pnpm add` 意外改动到无关条目，用 `git checkout -- pnpm-lock.yaml` 后重跑 `pnpm install --lockfile-only`。

---

## Interfaces and Dependencies

- **外部工具**：`node` ≥ 22（`.nvmrc`）、`pnpm` 10.28.2（`package.json` 的 `packageManager`）、`gh`（只在人工核对时用）、`git`。
- **新增依赖**：`yaml`（devDependency，零传递依赖）。
- **不新增**：npm script（避免与 #19 在 `package.json` 的同一区块插入）。
- **命名契约**：`scripts/workflow-check.mjs`、`tests/contract/workflow-check.test.js`、`AGENTS.md` §9.5、`AGENTS.md` §8.7、检查器输出的 `::error::<file> [<rule>] <message>`。
- **仓库设置**：不改分支保护；`PR Fast Gate` 仍是唯一必需检查名。
- **跨分支契约**：`checkWorkflows(rootDir)` 接受根目录参数，用于跨 worktree 核对。

---

## Outcomes & Retrospective

**实际结果（2026-09-18）**

四条分支的改动全部落地并验证：

| 分支 | 提交 | 验证 |
|---|---|---|
| `chore/pr-review-setup` (#12) | 5 个提交，评审修复已折进对应批次 | `pnpm verify` 23/23；`node scripts/workflow-check.mjs` 无 finding |
| `chore/issue-convention` (#19) | 3 个提交 | `pnpm verify` 13/13；`policy-check areas` 输出 21 行 |
| `chore/github-review-runner` (#21) | 4 个提交 | `pnpm verify` 5/5；新旧 HMAC 对同一输入输出相同 |
| `chore/executable-rule-checks` (#35) | 无需新提交（pin 已由并行会话连同提交推送） | `pnpm verify` 16/16 |
| 冻结顺序的合并结果（临时分支实测） | #19 三处机械冲突，其余干净 | `pnpm verify` 42/42；检查器无 finding |

**与计划的偏差**

1. 计划 §5.1 的 W4/W5 在实现后被对抗性验证推翻一次（D1–D3），已修订并补测试；检查器代码不是第一版。
2. 计划把 Batch D 交给一个 agent 独立完成；实际由并行会话代为提交，本任务只做验证。
3. 计划假定"改号即可消除 #12/#19 的冲突"；实测证伪（见 `Surprises`）。合并顺序与解冲突点写进了 PR 描述。
4. `docs/review/github-runner.md` 的整体中文化超出计划的"同步三处技术内容"，理由见 Decision Log。

**遗留（本任务不做，交给人类伙伴）**

- **#11 的 4 处 `AGENTS.md §8.6` 引用指错**（应指 §8.7）：`docs/project-management/README.md` 第 17、18、78、91 行；且这些引用在 #11 自己的分支上本来就是悬空的。用户选择本轮不修。
- **#35 的 pin 埋在一个主题无关的提交里**（`901ae6b`，信息写的是看板字段改名）。改写它需要动另一个 actor 的提交，本任务不做。
- **#12 与 #19 的 §8.x 冲突需要人工解一次**（三处，见 `Surprises`）。
- 反向的 area 陈旧项检查（`AREAS` 里有、仓库里已不存在的名字）与两份 GitHub 侧投影的自动核对仍未做：`areas` 子命令只做离线打印，Project 字段与标签的比对需要网络。
- 本计划仍在 `active/`：四条 PR 未经人类伙伴合并，按 `AGENTS.md` §4.2 不能移到 `completed/`。

---

## Bottom Change Note

- (2026-09-18) 创建本计划：汇总 #12 / #19 / #21 的 9 条评审意见与 5 条评审未发现的同类问题，定义为 RM1–RM4 四条根机制，冻结 W1–W6 不变量、检查器接口、area 词表接口与编号契约。
- (2026-09-18) 修订 §5.1／§5.4、补 `Surprises`、`Decision Log`、`Progress` 与 `Outcomes`：对抗性验证发现检查器 4 个缺陷（3 个假绿、1 个静默失效）后收紧了 W4（job 级 permissions）与 W5（`on` 的字符串/数组写法、`branches-ignore` 误报）；`requiredAreas` 明确包含 `PROCESS_AREAS`；记录模型可用性、并行会话提交与合并顺序实测三处与预期不符的事实。
- (2026-09-18) 收尾：`Progress` 的 Batch E 勾上并写明验证口径与推送方式；`Outcomes & Retrospective` 记录四条分支的实际结果、四处与计划的偏差、以及五项遗留（#11 引用、#35 提交主题、#12↔#19 冲突、词表远端投影、计划仍在 active）。计划**不移到 `completed/`**：四条 PR 由人类伙伴合并，按 §4.2 在合并前不算完成。
