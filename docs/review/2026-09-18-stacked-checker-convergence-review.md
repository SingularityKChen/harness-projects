# 规则语义收敛栈的交付评审（7 个 PR）ExecPlan

> 评审对象：#56 #57 #58 #59 #60 #61 #63。
> 结论：**本轮一个都不合并**——1 条 P0、7 条 P1，且队列第 1 位的 PR 自身带 3 条 P1，事实上堵住整条队列。

## Purpose / Big Picture

这一轮七个 PR 共同做一件事：把「规则文本说的」与「检查器实际判定的」收敛到一起。它们是上一轮 MVP 交付评审（`2026-09-18-mvp-delivery-review.md`）开出的跟踪 issue 的交付物。

本评审要回答的唯一问题：**这七个 PR 现在合并，仓库的门禁会比合并前更可信吗？**

判定口径（与上一轮一致，但把「阻塞」的定义写死，因为本轮结论依赖它）：

| 级别 | 定义 |
|---|---|
| **P0** | 合并通道被堵死、门禁静默变绿、不变量被实质破坏、凭据进发布面 |
| **P1** | 产生错误裁决的正确性缺陷；或 PR 声称达到而实测未达到的验收项；或把不成立的保证写进权威规则文本 |
| **P2** | 误报、测试无牙、规则文本与实现不一致但方向安全、文档事实错误 |
| **P3** | 措辞、冗余、命名 |

「P1 是否阻塞」不按级别机械判定，按后果判定。本轮七条 P1 全部落在两类上：**把不成立的保证写进 `AGENTS.md`**，以及**PR 描述声称的验收项实测未达成**。两类都是「合并即让仓库的自我描述变得不可信」，因此判阻塞。

## Context and Orientation

### 评审时（2026-09-18）的仓库事实

```text
main                                  8149095
#56 docs/board-planning-semantics     5d2cd79   830+/6-
#57 docs/process-records              fa12e88   481+/0-
#58 fix/workflow-check-false-greens   698300c   932+/75-
#59 fix/policy-check-hardening        6c4dd93   590+/23-
#60 fix/rule-checks-hardening         50f5998  1059+/83-
#61 chore/board-invariants            896e45c   330+/0-
#63 fix/link-context-stripping        61225e2   179+/1-   base = #59（stacked）
```

七个工作区的 HEAD 与各 PR 的 `headRefOid` 逐一比对一致，因此本评审的所有本地实测都对应 PR 当前状态。

CI 现状（评审开始时）：

- `Disclosure scan` 在 #56 #57 #58 #59 #63 上**红**，在 #60 #61 上绿。
- `Create review session` 在 #56–#60 上**红**（#61 #63 未触发该事件）。
- `PR Fast Gate`、`Verify`、`PR size`、`Issue policy` 七个 PR 全绿。

### 术语

- **并集风险**：单个 PR 全绿、但两个或多个 PR 合并后才出现的缺陷。上一轮的教训是 P0 常常只存在于并集里，因此本轮把并集作为独立的评审维度，而不是各 PR 评审的副产品。
- **静默假绿**：检查退出 0 且打印通过横幅，但实际没有检查任何东西。本轮出现两次。

### 评审依据

`AGENTS.md`（§1.3 七条不变量、§2.2 依赖方向、§8.3 PR 规则、§8.6 发布面自查、§8.7 issue 与标签、§9.2 门禁级别判定、§9.4 完成前自查、§9.5 workflow 不变量、§10 安全与信任边界）、`docs/review/README.md`、`PLANS.md`。

## Design / Spec

### 方法：先建满矩阵，再一次性提交

上一轮记下的教训是「已找到 P1 就提前收工」会漏掉只存在于并集里的 P0。本轮把提交动作推迟到矩阵建满之后：五路并行子评审 + 协调者独立做并集实测，全部回收后才写第一条行级意见。

事后看，这个顺序是对的：本轮唯一的 P0 **不在任何单个 PR 里**，而 PR 描述里那句「五步全部 CLEAN」的合并实测**恰好排除了产生 P0 的那两个 PR**。

### 分工与模型选择

| 子评审 | 范围 | 模型 |
|---|---|---|
| A | #58 `workflow-check.mjs` 对抗性绕过 | Opus |
| B | #60 `rule-checks.mjs` 漏扫与误报 | Opus |
| C | #59 + #63 `policy-check.mjs`（stacked pair） | Opus |
| D | #56 + #61 同路径冲突与看板语义 | Opus |
| E | 文档、流程、`AGENTS.md` 并集 | Opus |
| 协调者 | 并集变基实测、CI 取证、复核各子评审的关键断言 | Opus |

五路全部给 Opus：本轮每一路都要求构造注入用例 + 变异测试并区分「变异未生效」与「测试无牙」，这是本仓库已经踩过一次的坑（见 `2026-09-18-mvp-delivery-review.md`）。

### 判定口径：不采信报告，复核关键断言

子评审的每一条 P0/P1 断言，协调者都独立复现一次再采纳。本轮因此**推翻了一条**（见 Surprises 第 2 条），并**下调了三条**（见 Decision Log D2）。

## Global Constraints

- 只读评审：七个被评审的工作区全程不修改，实验一律在 scratchpad 的一次性 clone 与副本里做。
- 只报实际复现过的问题；推断但未跑通的单列「未验证的怀疑」。
- 不提已被绿色门禁覆盖的问题（`docs/review/README.md` §3）。
- 本文件自身受 §8.6 约束：所有路径、主机名一律占位符。

## Plan of Work

### Batch 1 · 取证与基线
读七个 PR 的 diff 与描述；比对工作区 HEAD 与 PR head；取 CI 实际失败日志（不采信描述里的结论）。

### Batch 2 · 并集实测
在一次性 clone 内按队列顺序依次变基合并七个分支，记录每一步的冲突文件与 hunk；对合并后的末态跑全部门禁命令。

### Batch 3 · 五路并行子评审
见 Design / Spec 的分工表。

### Batch 4 · 复核与建矩阵
对每条 P0/P1 独立复现；按后果而非级别判定阻塞性；建满 P0–P3 矩阵。

### Batch 5 · 一次性提交
行级意见落在最小相关行；跨文件与整体结论落 PR 级评论。

### Batch 6 · 结论与记录
写本文件；给出修复顺序。

## Validation and Acceptance

| # | 验收项 | 结果 |
|---|---|---|
| 1 | 七个 PR 都收到带行级意见的评审 | 通过：16 条行级 + 7 条 PR 级 |
| 2 | 每条 P0/P1 都有可复现命令与实测输出 | 通过 |
| 3 | 并集风险被独立实测，而不是采信 PR 描述 | 通过：发现 PR 描述的实测范围排除了产生 P0 的两个 PR |
| 4 | 每条 P0/P1 都经协调者独立复现 | 通过：推翻 1 条、下调 3 条 |
| 5 | 本文件不含本机路径、用户名、主机名 | 通过（见 Idempotence and Recovery 的复验命令） |

## Progress

- [x] (2026-09-18) Batch 1 取证与基线
- [x] (2026-09-18) Batch 2 并集实测
- [x] (2026-09-18) Batch 3 五路并行子评审
- [x] (2026-09-18) Batch 4 复核与建矩阵
- [x] (2026-09-18) Batch 5 一次性提交（16 行级 + 7 PR 级）
- [x] (2026-09-18) Batch 6 本文件

## 风险矩阵

### P0 —— 阻塞合并（1 条，只存在于 #56 与 #61 的并集）

**P0-1 · #56 + #61 · `scripts/board-workflow-check.mjs` 同路径 add/add 冲突，且最自然的解法造出一条静默假绿的门禁**

两个 PR 各自新建同一路径的文件，`EXPECTED` 的 `(name, enabled)` 九条逐字相同，冲突只在 API 命名与文件所有权：

| | #56 | #61 |
|---|---|---|
| 导出 | `EXPECTED` / `MUST_BE_DISABLED` / `boardWorkflowFindings` | `OWNER` / `PROJECT_NUMBER` / `EXPECTED` / `checkBoardWorkflows` |
| 输入 | 纯函数，无 CLI、无网络 | `fetch` GraphQL + `main()` + 入口守卫 |
| 输入校验 | `assertWorkflowList` / `assertRuleList`（fail-closed） | 无 |

实测（一次性 clone，main 已含 #60/#56/#57/#58/#59）：

```text
rebase #61 → CONFLICT (add/add): scripts/board-workflow-check.mjs
```

两份测试文件名不同（`board-workflow.test.js` / `board-workflow-check.test.js`），git 视为两个独立新增、**不冲突**，合并后并存、各自 import 同一个脚本，于是必有一份红：

```text
留 #56 脚本 → SyntaxError: does not provide an export named 'checkBoardWorkflows'   fail 1
留 #61 脚本 → SyntaxError: does not provide an export named 'MUST_BE_DISABLED'      fail 1
```

**更糟的是最自然的那个解法。** 保留 #56 的脚本（正是 #56 Decision Log 写的「A 判定、#61 取数与接线」）+ #61 的 workflow，再删掉报错的测试让 `verify` 变绿，末态实测：

```text
pnpm verify                            → tests 124 / pass 124 / fail 0
node scripts/workflow-check.mjs        → no findings（已检查 5 个文件）
node scripts/board-workflow-check.mjs  → exit=0，零输出
```

一条名为 `Board workflow invariants` 的检查**全绿且什么都没检查**——因为 #56 的版本没有 CLI 入口。这与 §9.5 fail-closed 那段要堵的「检查了 0 个 = 合规」是同一类假绿，而它守的是不变量 3。

处置建议见 Decision Log D1。

### P1 —— 阻塞（7 条）

| # | PR | 位置 | 缺陷 | 判阻塞的理由 |
|---|---|---|---|---|
| P1-1 | #60 | `rule-checks.mjs:177` | `maskExcerpt` 只遮本模式自己的匹配段，同行其它凭据原样进公开 Actions 日志 | 本 PR 在 `AGENTS.md:418` 新增了一句相反的承诺 |
| P1-2 | #60 | `rule-checks.yml:53` | `on: pull_request` 缺 `types: [edited]`，新增的 PR 描述扫描在 CI 里永远看不到被编辑的描述 | 本 PR 的招牌能力之一在 CI 里结构性失效；本 PR 自己就是实例 |
| P1-3 | #60 | `rule-checks.mjs:358` | pathspec `'.'` 是 cwd 相对，子目录里运行 → exit 0 + 完整覆盖横幅 | 安全检查静默变绿并主动声称覆盖 |
| P1-4 | #61 | `board-invariants.yml:55` | `pull_request` + checkout PR 代码 + `PROJECTS_TOKEN` 在 env → classic PAT 暴露给 PR 分支代码 | 与仓库自己写下的两处相反先例冲突 |
| P1-5 | #59 | `policy-check.mjs` | `gh` 进程失败 → exit 1 + 裸栈，与「规则违规」撞码 | 正是本 PR 闭环第 4 条声明要修的那类 |
| P1-6 | #57 | `AGENTS.md:550` | 「判定规则可机械执行」零实现；`#7 blocked-by #4` 得不出唯一结论 | 把不存在的能力写进权威规则文本，且被 PR 描述当作验收依据 |
| P1-7 | #57 | `merge-queue.md:106` | 「逐字节相同」不成立，且正因这个错误前提漏报了 #63 的冲突 | 验收标准「无上下文的人只读它能把队列合完」实测未达成 |

P1-1 的实测（一行同时含本机路径、内网主机名、GitHub 令牌；此处一律占位符）：

```text
[GitHub 令牌]     -> runner at <workspace>/actions-runner on <host> key ████████████
[本机家目录路径]  -> runner at ██████████/actions-runner on <host> key ghp_aaaa…aaaa
[内网主机名]      -> runner at <workspace>/actions-runner on ████████████ key ghp_aaaa…aaaa
```

完整令牌被原样打印两次；逐提交扫描会再各打一份。

P1-2 的实测：本 PR 正文最后更新时间比最后一次 `Rule checks` 运行晚 **19 分钟**，那段正文从未被扫过。同仓 `issue-policy.yml` 已有 `types: [opened, edited, synchronize, reopened]` 的既定写法。

P1-3 的实测：同一个泄露，仓库根 exit 1、子目录 exit 0 且打印「机械扫描通过，覆盖范围：…以上均未命中任何已知模式」。

P1-6 的实测：`grep -rlE 'Decision Log|批准|approval' scripts/` 无输出；`scripts/` 下只有三个脚本。

P1-7 的实测：

```text
#56 的副本        blob 6c35331798fd   378 行
其余四个分支      blob 723394605ebf   307 行
按 merge-queue.md §2.2 从位置 1 依次变基：位置 6（#63）CONFLICT，两处 hunk
```

### P2 —— 严重但不阻塞（已在 PR 上提出，建议开 issue 跟踪）

| PR | 缺陷 |
|---|---|
| #56 | 九行裁决表里 `Auto-close issue` 那一行用自己的列值推不出裁决（第 4 列的轴填错），而「一条规则的九次求值」是本 PR 的核心主张 |
| #56 | `board-semantics.md:98` 称 `PROJECTS_TOKEN`「至今不存在」，实测已存在（2026-09-18T06:13:44Z） |
| #56 | `board-semantics.md:68` 声称测试防止文档漂移；实测只在代码→测试方向成立，改文档表格测试全绿 |
| #56 | ExecPlan 副本把五个批次全勾成 `[x]`，其中四批由尚未合并的 PR 交付 |
| #57 | `AGENTS.md:546`（未改）与 `:547`（新增）对「本 agent 能不能写 `Status`」给出相反读法 |
| #57 | `merge-queue.md` 给 #61 的「位置」写「待定」，而 §3 对该列的定义没有这个取值 |
| #58 | `:69` fail-closed 默认值与 `:155` 的 `write-all` 守卫两条判据变异后测试全绿（46 pass / 0 fail），未达本批声明的验证标准 |
| #58 | `:15` 的 W7 标题说「非空映射」，实现允许空映射，`AGENTS.md` 只说「映射」——三处口径不一致 |
| #58 | `${{ true }}` 绕过 W5；`{group}` 加一个托管标签就翻转成托管；`assertNoFinding` + `.replace()` 锚点失配会空过 |
| #58 | 误报：`read-all` 被拦、`branches: ['**', '!main']`、只订阅 tag 的 push、`concurrency: <字符串>` 简写无法满足 W6 |
| #59 | 冒号形式 `Closes: #12`（GitHub 官方文档明确支持）被判未关联；`owner/repo#N` 与完整 URL 形式内部不一致 |
| #59 | 围栏剥离只认闭合的三反引号围栏：`~~~`、未闭合围栏、4 空格缩进块、4 反引号包 3 反引号，四种仍算关联 |
| #59 | `issue-policy.test.js` 那条「改名后仍 exit 2」的用例只在 git 检出里通过，断言的是环境而非守卫 |
| #59 #63 | 实现里有 7 条链接判定规则在 `AGENTS.md` §8.7 里找不到（`HTML 注释`/`行内代码`/`引用块` 各 0 命中） |
| #60 | `home` / `intranet` TLD 把 `styles.home`、`routes.home` 这类写法判成内网主机名 |
| #60 | 5 处变异存活（预算边界 `>` vs `>=`、RFC1918 八位组范围、第二种家目录前缀的正例、先加后删的真实数据源、`size` 的三点 vs 两点） |
| #60 | §8.6 五类里「账号与个人信息」「保密字样」零机械覆盖，而规则文本未声明这一点 |
| #60 | `AGENTS.md` 里发布的 grep 被**加宽**（加 `home\|intranet`）而实现被收窄，照字面执行会把五个 PR 全判成阻塞 |
| #61 | 判定函数无 fail-closed 输入校验，10 条测试没喂过畸形输入 |
| #61 | PR 描述里的 ExecPlan 路径不存在（写 `completed/`，实际在 `active/`）；文档改动 0 行 |
| #63 | 注释剥离只认闭合注释，未闭合的 `<!--` 仍算关联 |
| #63 | rebase 到 main 时 ExecPlan 两处冲突；取错边会静默把 Batch A–E 的勾选回退 |
| 并集 | 新的 active ExecPlan 未进 `docs/README.md` 的 Active 索引表 |

### P3 —— nit

`workflows(first:50)` 不分页；`uses: ./../..` 穿越进豁免；40 位大写 hex 被当合法 pin；`docker://…@sha256:` 被拦；命中被重复打印；`#00012` / 超大编号的数值处理；#56/#57 的 PR 描述首行仍写「Draft」；#56 ExecPlan 插入了非 `PLANS.md` 标准的中文 H2；`merge-queue.md` 第 1 位的「已知冲突点与解法」列只写了位置没写解法。

## Surprises & Discoveries

1. **PR 描述里那句「五步全部 CLEAN」属实，但它实测的范围恰好排除了产生 P0 的两个 PR。** 五个 PR 的子集（#60→#56→#57→#58→#59）我独立复现确认全 CLEAN，末态 `pnpm verify` 124/124、`workflow-check` no findings、`disclosure` exit 0、`policy-check areas` 21 行。被排除在外的正是 #61（add/add 冲突）与 #63（ExecPlan 冲突）。**证据**：本文件 P0-1 与 P1-7 的实测块。这条不是指控，是方法论教训——「实测过」这句话的**范围**和结论一样重要，PR 描述应当写明它覆盖了哪几个分支。

2. **一条 P0 怀疑被证伪，没有写进意见。** 子评审 C 曾怀疑机器 PR 豁免读错字段（§8.7 说 `user.type == 'Bot'`，而 `gh pr view --json author` 返回 `is_bot`）。复核发现实现走的是 REST（`.user.type`），确实返回 `"Bot"`；真实数据验证：Dependabot 的 PR #52 → `skipped: author dependabot[bot] is a bot`，exit 0。**豁免规则是对的。** 记在这里是因为它证明了「复核每条 P0 再采纳」这一步有实际产出。

3. **我自己的第一次变异测试没有生效，差点写成一条错误结论。** 用 `perl -0pi` 删 `findings.push(...)` 时正则没匹配上，`grep -c` 仍是 2、fixture 仍然报错，而测试套件「46 pass / 0 fail」——这个输出与「测试没有牙」**完全一样**。改用带行号的 `sed` 并先 `sed -n '155p'` 打印确认后重跑，结论才成立。这与上一轮记录的同源教训一致（`2026-09-18-mvp-delivery-review.md`）：**变异测试必须先证明变异生效**。

4. **`Create review session` 在 #56–#60 上全红，根因与本轮七个 PR 无关。** `github-review.yml` 的 `EVENT_PATH: ${{ github.event_path }}` 在日志里解析为空 → `ENOENT: open ''`。已由 issue #65 跟踪。#61 与 #63 上没有这条检查，因为它只在 draft → ready 时触发一次。记在这里是因为：**一条长期红着的检查会把人训练成忽略所有红检查**，这正是 §9.2 与 §8.3 第 7 条警告的形态，而本轮有五个 PR 处在这个状态。

5. **#63 的修复对它自己这个 PR 有效，是最好的实证。** main 版检查器对 PR #63 报 `exit=1`，误把描述里的 `<!-- Closes #12 -->` 当真实关联，再把 PR #12 当 issue 判，报出 3 条对一个 PR 而言全是正确写法的「违规」；#63 版检查器 `exit=0 → conforms`。

6. **`Disclosure scan` 的红是误报，且误报的内容正是「列举误报字面量」的那一行。** 实测：main 原样 + #58 分支 → exit 1，命中行是 ExecPlan 里 `- [ ] disclosure：收窄误报（…）` 那一条；#60 合入后重跑，#56/#57/#58/#59 全部 exit 0。这坐实了 #60 必须排第 1 位，但也说明**这条检查目前在自己的规则文本上会自我命中**。

## Decision Log

**D1 · #56 与 #61 的冲突，建议以 #56 为存活模块，#61 改成只加接线**

- **Decision**：#56 先合；#61 删掉自己的脚本与测试，改为引用 #56 的 `EXPECTED` / `boardWorkflowFindings`，保留 workflow（去掉 `pull_request` 触发），新增一个独立的 CLI 文件承载 `fetch` 与凭据执行面。
- **Rationale**：四条，按重要性排序。(a) #56 的判定逻辑是 #61 的严格超集——九条 `(name, enabled)` 逐条相同，另有 fail-closed 输入校验与 3 条对应测试。(b) §9.2 的门禁级别判定要求这样分文件：#56 的文件离线、无凭据，合法地进 `pnpm verify`（必需）；#61 把 `fetch` 与 CLI 塞进同一个被必需门禁 import 的模块，等于让必需门禁与凭据执行面共用一个文件。(c) #56 带权威文档，#61 的裁决表只活在代码注释里。(d) #56 自己已声明吸收了 #61 的模型，方向事实上已定。
- **代价**：#61 的运行时那一半是本轮唯一真正在观察不变量 3 的东西（实测读到真实看板 9 条、7 关 2 开），必须保住而不是丢掉。
- **Date/Author**：2026-09-18 / 评审

**D2 · 三条子评审判 P0 的发现被下调**

- **Decision**：#58 的本地复合 action 缺口、#60 的 `maskExcerpt` 回显、#58 的 `jobs: {}` 放行，均不按 P0 计。
- **Rationale**：对每一条做了「main 基线对照」。复合 action 缺口与 `jobs: {}` 在 main 上行为**完全相同**（实测两个版本对同一 fixture 都是 `no findings`），因此不是回归——在一个「加固检查器」的 PR 里，同等存在于 main 的缺口不构成合并阻塞。`maskExcerpt` 同理：main 把整行原样回显且根本不识别令牌模式，#60 严格更好。`maskExcerpt` 仍判 P1 的唯一理由是**它同时新增了一句相反的规则文本**，问题在文本与实现的分歧，不在实现比 main 差。
- **Date/Author**：2026-09-18 / 评审

**D3 · 本轮不就地修 P2，也不合并任何 PR**

- **Decision**：不执行「修掉 P2 后 rebase merge」。
- **Rationale**：队列第 1 位的 #60 带 3 条 P1，而合并顺序有硬约束（#60 不先合，其余四个的 `Disclosure scan` 一直红）。在 P1 未修的前提下就地修 P2 并推送，会让 P1 的修复基线失效、制造二次冲突；而 P2 集中在 #56/#58/#63 三个 PR 上，它们又都排在 #60 之后。**先修 P1、再统一处理 P2** 的返工量更小。这是对「三思而后行」的应用：能改不等于此刻该改。
- **Date/Author**：2026-09-18 / 评审

**D4 · P1 的阻塞性按后果判定，不按级别机械判定**

- **Decision**：七条 P1 全部判阻塞。
- **Rationale**：上一轮的惯例是「P1 严重但不阻塞 MVP 交付，开 issue 跟踪」。本轮七条 P1 与上一轮的 P1 性质不同：它们不是「某个功能有缺陷」，而是**两类自我描述失真**——把不成立的保证写进 `AGENTS.md`（P1-1、P1-6），以及 PR 描述声称的验收项实测未达成（P1-2、P1-5、P1-7）。合并这类缺陷会让仓库的权威规则文本变得不可信，而这七个 PR 存在的**唯一目的**就是消灭规则文本与实现的分歧。带着同类缺陷合并，是自相矛盾的。
- **Date/Author**：2026-09-18 / 评审

## Idempotence and Recovery

- 本评审只读，不改任何被评审分支；行级意见与 PR 级评论可重复提交（会产生重复 thread，重跑前先核对已有评论）。
- 本文件的敏感信息复验：跑 `AGENTS.md` §8.6「开 PR 前」那条 grep（期望输出为空），以及权威机械实现：

```bash
node scripts/rule-checks.mjs disclosure origin/main
```

  本文件**刻意不内联那条正则**——它自身含有要匹配的模式，内联会让这份评审记录自我命中，
  正是 §8.6 把 `AGENTS.md` 放进 `SCAN_EXCLUDES` 所处理的同一类自指。

- 并集实测可重跑：在一次性 clone 内按 `#60 → #56 → #57 → #58 → #59 → #61 → #63` 依次 `git rebase main && git merge --ff-only`，第 6、7 步应分别在 `scripts/board-workflow-check.mjs`（add/add）与 ExecPlan（content）上冲突。

## Interfaces and Dependencies

**合并顺序的硬约束（实测，非推断）**

1. **#60 必须第 1 位**：不先合它，#56/#57/#58/#59 的 `Disclosure scan` 因同一处误报一直红。
2. **#63 必须在 #59 之后**：base 是未合并分支。若 #59 接受任何对 `linkedIssues()` 开头几行的修改（我给 #59 的两条 P2 正好落在那几行），#63 rebase 时会在**同一个 hunk 的相邻行**冲突，「取一边」会静默回退另一边——解法是两边都保留。
3. **#61 必须在 #56 之后，且必须先重写**：见 P0-1 与 D1。

**建议的修复顺序**

```text
#60 修 3 条 P1  →  合并（位置 1）
#56 修 2 条 P2  →  合并（位置 2）
#57 修 2 条 P1  →  合并（位置 3）
#58 补 4 条用例 →  合并（位置 4）
#59 修 1 条 P1  →  合并（位置 5）
#63 rebase + 解两处冲突 → 合并（位置 6）
#61 按 D1 重写为「只加接线」→ 单独评审后合并
```

**受影响的 issue**：#55 #48 #45（#56）、#46 #47（#57）、#38（#58）、#39（#59）、#40 #41（#60）、#45 #36（#61）、#62 #39（#63）。本轮无 issue 被关闭。已存在的相关 issue：#65（review session 崩溃）、#66（PR 编号被当 issue）。

## Outcomes & Retrospective

**产出**：16 条行级意见 + 7 条 PR 级结论；1 条 P0、7 条 P1、23 条 P2、9 条 P3；1 条被证伪的怀疑；3 条从 P0 下调为 P1/P2。

**做对的**：把并集实测放在各 PR 评审之前而不是之后。本轮唯一的 P0 不在任何单个 PR 里，任何只看单 PR 的评审都会放它过去——七个 PR 的 `PR Fast Gate` 全绿。

**做对的第二件**：对每条 P0/P1 做「main 基线对照」。三条原本判 P0 的发现因此下调——在加固类 PR 上，同等存在于 main 的缺口不是回归，把它算成阻塞既不公平也会让评审失去可信度。

**踩到的**：第一次变异测试没生效却产出了与「测试无牙」一模一样的输出。这是同一个坑第二次踩（上一轮已记录）。教训是：**变异测试的第一步永远是打印出变异后的那一行**，而不是直接跑测试。

**下一轮要带走的**：PR 描述里写「实测过」时，必须同时写明实测覆盖了哪些分支。本轮 P0 能藏住，靠的不是描述造假，而是描述省略了范围。

## Bottom Change Note

- 2026-09-18：创建本文件，记录 #56 #57 #58 #59 #60 #61 #63 七个 PR 的交付评审。结论为本轮不合并任何 PR，修复顺序见 Interfaces and Dependencies。
