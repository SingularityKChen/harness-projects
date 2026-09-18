# MVP 交付评审（9 个开放 PR）ExecPlan

> 状态：Completed
> 创建：2026-09-18
> 范围：对 `main` 上全部 9 个开放 PR（#3 #11 #12 #13 #19 #21 #33 #35 #37）做一次 MVP 交付评审，建立分级风险矩阵，产出行级评审意见、跟踪 issue 与合并裁决。不改 `packages/` 下任何文件。
> 评审者：agent（受人类伙伴指派）

## Purpose / Big Picture

完成后，一个对本轮队列一无所知的人只读这一份文件就能回答三个问题：

1. **哪些 PR 可以合并、哪些不能，理由是什么**——不是印象，而是可复现的命令与输出；
2. **这九个 PR 合到一起之后 `main` 还能不能工作**——这是任何单个 PR 的 CI 都回答不了的问题；
3. **当前真正的瓶颈是什么**——以及最小的决定性下一步是哪一个。

最小成功证据：

```bash
# 全部 9 个 PR 都收到了带行级意见的评审
for n in 3 11 12 13 19 21 33 35 37; do
  echo "#$n inline=$(gh api repos/SingularityKChen/harness-projects/pulls/$n/comments --jq 'length')"
done
# 期望：每个 PR 的 inline 数 ≥ 本次新增数，且 #37 ≥ 6

# 合并队列的可判定结论：前 8 个绿、加上 #37 变红
# （复现方法见 Validation and Acceptance 第 1 项）
```

## Context and Orientation

### 评审时（2026-09-18）的仓库事实

| 事实 | 取值 | 取得方式 |
|---|---|---|
| 开放 PR | 9 个，全部同仓分支，全部 `PR Fast Gate` 绿 | `gh pr list --state open` |
| 已合并 PR | 2 个（均为 2026-09-17 的引导） | `gh pr list --state merged` |
| 已关闭 issue | **0** | `gh issue list --state closed` |
| `packages/` + `apps/` 源码 | 17 个文件 / **136 行**，全是 `export const packageId` 骨架 | `find … -name '*.ts' -exec cat {} + \| wc -l` |
| 这 9 个 PR 新增 | 代码约 1737 行 + 文档约 2075 行 | `git diff --numstat main...<branch>` 逐分支累加 |
| 新增测试 | 46 条，**全部是过程工具测试** | 各分支 `pnpm verify` 输出差值 |
| `tests/README.md` 声明的 8 类优先级中，第 1–4 类现有测试数 | **0** | `ls tests/contract/` 只有 `package-boundaries.test.js` |
| 仓库可见性 / 协作者 | public / 1 人（owner，admin） | `gh api repos/… --jq .visibility`、`…/collaborators` |
| 分支保护 | 必需检查 `PR Fast Gate`；需 1 个批准；线性历史；`enforce_admins=false` | `gh api …/branches/main/protection` |

### 术语

| 词 | 在本文件里的意思 |
|---|---|
| **阻塞** | 一个有证据的问题，使得「合并这个 PR」会让 `main` 变坏；不是「这个问题很重要」 |
| **超出 MVP 范围** | 问题成立，但修它属于加固而不是交付；按人类伙伴的指示开 issue、不阻塞合并 |
| **跨 PR 交互缺陷** | 违规只存在于两个或更多分支的**并集**中，因此任何单个 PR 的 CI 都不会评估它 |

### 评审依据

- `AGENTS.md`：§1.3 七条不变量 + 两条实现级硬约束、§2.2 依赖方向、§5 拆分判据、§8 分支/提交/PR 规则、§9 门禁、§10 安全边界。
- `PLANS.md` §3：ExecPlan 的 13 个强制章节。
- `docs/review/README.md`（由 #12 引入）：本仓库自己的评审标准——先核实事实、按改动面选最小证据、阻塞级 6 条必查项、意见落在行级、「评审者不 approve 自己参与的 PR」。本次评审按这份标准执行。

## Design / Spec

### 方法：先建矩阵，再一次性提交

人类伙伴的要求是「先建立所有 P0/P1 等各级别风险矩阵，再一次性提交，不因已找到 P1 就提前收工」。因此本次评审刻意分成两段：

1. **只读取证阶段**：五个并行子评审 + 评审者自己的独立核验，全部不提交任何意见；
2. **一次性提交阶段**：38 条行级意见 + 9 条 PR 级结论 + 12 个 issue 同时发出。

这样做的理由不是流程洁癖：**本轮唯一的 P0 只有在把九个 PR 合到一起之后才会出现**。如果在找到第一个 P1（#12 的 W4 绕过）时就收工，那个 P0 不会被发现，而它会让 `main` 的必需检查变红。

### 分工与模型选择

| 子评审 | 关注面 | 模型 | 理由 |
|---|---|---|---|
| 安全 | `pull_request_target`、自托管 runner、HMAC、PAT scope、注入面 | opus | 需要构造可利用路径，不是模式匹配 |
| 脚本正确性 A | `workflow-check.mjs`、`policy-check.mjs` + 测试 | opus | 需要枚举 YAML 形态并做变异测试 |
| 脚本正确性 B | `rule-checks.mjs`、`sync-engineering-state.mjs` + 测试 | opus | 同上，且涉及外部写入语义 |
| 架构与不变量 | 七条不变量、§2.2、§5 判据、MVP 结构、可逆性 | opus | 需要同时持系统工程与第一性原理两个镜头 |
| 文档与产品一致性 | 悬空引用、ExecPlan 合规、品牌中性、命令可复现、产品规格 | sonnet | 判定标准明确，可核对性强，不需要构造 |

评审者自己承担的部分（不外包）：合并顺序实测、完整合并后的门禁实跑、体量规则核算、产品规格标准的应用、以及所有阻塞级裁决。

### 判定口径

按 `docs/review/README.md` §3 的阻塞级 6 条必查项分级，并额外区分「阻塞」与「重要但不阻塞」：

- **P0**：合并即让 `main` 变坏（必需检查变红、或违反 §1.3 的硬约束）→ 不能合并。
- **P1**：严重，但不使 `main` 变坏 → 除 #37 外一律开 issue、不阻塞。
- **P2/P3**：小问题 → 「三思而后行」：只在**改动机械、且留着会长期误导**时就地修；否则开 issue。

## Global Constraints

- 只读评审阶段不修改任何被审分支；所有 fixture 落在会话 scratchpad，不进仓库。
- 行级意见必须锚定在 diff 的新增行上（用一个 diff 解析脚本逐条核验 `path:line` 是否为 `ADDED`），否则 GitHub 会拒绝或错位。
- 不重复已有评审轮次已提出并已解决的问题（#12 / #19 / #21 上已有 16 条行级意见，逐条读过）。
- 就地修复前必须先推 `backup/pre-rebase-pr<N>` 到 origin。
- 不改写 `main`；不在真实仓库或 worktree 里做合并模拟。

## Plan of Work

### Batch 1 · 取证与基线
**最小闭环**：把 PR 描述里的声称变成可核对的事实。
- [x] 9 个 PR 的元数据、描述、diff、CI 状态、已有评审意见
- [x] 为 9 个 PR 各建 worktree，读真实文件而不只是 diff
- [x] 独立复跑 5 个带代码 PR 的 `pnpm verify`
- [x] 按 §8.3 核算 9 个 PR 的体量
**验证**：见 `Validation and Acceptance` 第 2、3 项。

### Batch 2 · 合并顺序与完整合并后的门禁
**最小闭环**：回答「这九个合到一起之后 `main` 还能不能工作」。
- [x] scratch clone 内按声明顺序逐个 rebase + ff-only 合并
- [x] 在「8 个已合并」与「9 个已合并」两个状态上分别实跑 `pnpm verify` 与检查器
- [x] 定位 P0 的违规行与根因
**验证**：见 `Validation and Acceptance` 第 1 项。

### Batch 3 · 五路并行子评审
**最小闭环**：每个关注面都有带证据的发现清单。
- [x] 安全、脚本 A、脚本 B、架构、文档五路并行
- [x] 对每一条阻塞级结论做评审者自己的独立复现（不采信单一来源）
**验证**：下节 Surprises 里记录了两条被独立核验**推翻**的子评审结论。

### Batch 4 · 一次性提交
**最小闭环**：意见到位、可行动、不重复。
- [x] 38 条行级意见 + 9 条 PR 级结论同时提交
- [x] 12 个跟踪 issue（#38–#49），按 §8.7 的标题与标签格式
**验证**：见 `Validation and Acceptance` 第 4、5 项。

### Batch 5 · P2 就地修复
**最小闭环**：三处「留着会长期误导」的问题在合并前消失。
- [x] #11：四处 `§8.6` → `§8.7`，`kind/*` → `kind:*`（`cea2171`）
- [x] #33：11 处品牌名 → `agent`，Batch 6 的四处自相矛盾（`aacf379`）
- [x] #19：`2358e70` 的纯英文提交标题改为中文（`2db7e9f`，force-push）
**验证**：见 `Validation and Acceptance` 第 6、7 项。

### Batch 6 · 合并
**最小闭环**：8 个通过评审的 PR 进入 `main`，对应 issue 关闭，且 `main` 仍然绿。
- [x] 按 `#12 → #19 → #21 → #3 → #11 → #13 → #33 → #35` 依次 rebase merge（5 步需本地解冲突）
- [x] 8 个对应 issue 全部自动关闭（#16 #18 #20 #14 #15 #17 #32 #34）
- [x] 合并后在真实 `main` 上实跑门禁：`tests 42 / pass 42 / fail 0`，`workflow-check: no findings`
- [x] #37 保持 open，等两条 P0 修复后复审
**验证**：见 `Validation and Acceptance` 第 8 项。
**回滚**：`main` 是线性历史，逐个 `git revert` 对应提交；外部状态（已关闭的 issue、被改写的看板 `Status`）不会随之回退。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 完整合并后 `main` 的门禁状态可判定 | scratch clone 顺序 rebase + ff-only：合并到 #35 为止（8 个）→ `pnpm verify` `tests 42 / pass 42 / fail 0`、`workflow-check: no findings` exit 0；再合并 #37 → `pass 33 / fail 1`、检查器 exit 1 输出两条 `::error::` W3 | 通过（2026-09-18） |
| 2 | 5 个带代码 PR 的测试数声称为真 | 逐 worktree `pnpm verify`：#12 = 23/23、#19 = 13/13、#21 = 5/5、#35 = 16/16、#37 = 14/14，全部 exit 0 | 通过 |
| 3 | 9 个 PR 全部符合 §8.3 体量上限 | 逐分支 `git diff --numstat main...<b>`，按 `.md` / 非 `.md` 分桶、排除 `pnpm-lock.yaml`：最大为 #12（code 427 / docs 710），无一超限 | 通过 |
| 4 | 9 个 PR 全部收到带行级意见的评审 | `pulls/<n>/comments` 计数：#3 = 0(+0)、#11 = 1(+1)、#12 = 12(+6)、#13 = 0(+0)、#19 = 12(+6)、#21 = 5(+1)、#33 = 9(+9)、#35 = 9(+9)、#37 = 6(+6)；新增合计 38 | 通过 |
| 5 | 跟踪 issue 符合 §8.7 格式 | #38–#49 共 12 个，标题 `<kind>(<area>): <英文祈使句>`，标签 `kind:*` 恰好 1 + `area:*` ≥ 1 | 通过 |
| 6 | 就地修复不改变内容语义 | #19 重写后 `git diff 2836c39 HEAD` **输出为空**（仅提交标题变化），`pnpm verify` 仍 13/13 | 通过 |
| 7 | 就地修复的事实依据经外部状态核实 | `Item added to project` / `Item closed` 均 `enabled = true`；四条写 `Status` 的内置工作流均 `enabled = false`；`gh secret list` 确认 `PROJECTS_TOKEN` **不存在**（因此 Batch 9 那条「待人类执行」未改） | 通过 |
| 8 | 8 个 PR 合并、对应 issue 关闭、且合并后 `main` 仍然绿 | 8 个 PR 全部 `state=MERGED`；issue #14 #15 #16 #17 #18 #20 #32 #34 全部 `state=CLOSED`；`main` 上 `CI=true pnpm verify` → `tests 42 / pass 42 / fail 0`，`node scripts/workflow-check.mjs` → `no findings` exit 0；`.github/workflows/` 四个文件全部合规 | 通过（2026-09-18） |
| 9 | P0 的预测与合并后的实际一致 | 合并前预测「8 个 → 42/42 绿」，合并后实测 `tests 42 / pass 42 / fail 0`——逐字一致；#37 的不合规 workflow 未进入 `main` | 通过（2026-09-18） |

## Progress

- [x] (2026-09-18) Batch 1 取证与基线
- [x] (2026-09-18) Batch 2 合并顺序与完整合并后的门禁 —— 定位本轮唯一 P0
- [x] (2026-09-18) Batch 3 五路并行子评审 + 独立复核
- [x] (2026-09-18) Batch 4 一次性提交：38 条行级意见、9 条 PR 级结论、12 个 issue
- [x] (2026-09-18) Batch 5 三处 P2 就地修复并推送
- [x] (2026-09-18) Batch 6 合并：8 个 PR 全部进入 `main`，对应 issue 全部关闭，合并后 `main` 门禁 42/42 绿

## 风险矩阵

### P0 —— 阻塞合并（2 条，均在 #37）

| # | PR | 位置 | 问题 | 证据 |
|---|---|---|---|---|
| P0-1 | #37 | `.github/workflows/engineering-state.yml:40,44` | `actions/checkout@v4` / `actions/setup-node@v4` 未 pin，违反 #12 引入的 W3。**合并后 `main` 的必需检查 `PR Fast Gate` 变红**，后续每个 PR 都被挡住 | 完整合并模拟：8 个 → 42/42 绿；加 #37 → `pass 33 / fail 1`，检查器 exit 1 |
| P0-2 | #37 | `scripts/sync-engineering-state.mjs:69` | `gql` 只看 `body.errors`、不看 HTTP 状态。GitHub 在 401/403/502 上返回 `{message, documentation_url, status}` 而**没有 `errors` 键**，于是失败的写入被打印成 `Engineering = Approved` 并 `return 0`。违反 §1.3 硬约束「外部写入未确认前不得标记为权威成功」 | 对真实 API 验证响应形状（哑元 token）：`status: 401`、`res.ok: false`、`body.errors: undefined` |

P0-1 的根因是**跨 PR 交互**：#37 分支上没有检查器（它由 #12 引入），#12 分支上没有该 workflow，违规只存在于并集，而没有任何一次 CI 运行会评估这个并集。#12 的 `checkWorkflows(rootDir)` 正是为此设计的，只是没有被指向 #37。

P0-2 值得单独强调：本项目要交付的产品，核心承诺就是「不让本地把未确认的写入当成事实」。第一个自举实现踩的正是这一条，而且踩在最容易发生的路径上（PAT 过期、`synchronize` 连续推送触发 secondary rate limit）。

### P1 —— 严重，但不阻塞 MVP 交付（已开 issue）

| # | PR | 问题 | 归口 |
|---|---|---|---|
| P1-1 | #37 | `pull_request_review` 的守卫只检查 head repo、不检查**谁提交了评审**；public 仓库上任何 GitHub 用户都能驱动这个持有 PAT 的 job 并写看板，且不留 actor 痕迹 | 行级意见（随 P0 一起修） |
| P1-2 | #37 | 不变量 3 只是**偶然**成立：它依赖一个无法自动化的人工步骤（关掉四条内置工作流），而没有任何东西观察它。「启用」不可自动化，但「观察」可以——`enabled` 是可读的，#33 的验收表已经用过这个查询，只用在四条里的一条 | #45 |
| P1-3 | #12 | W4（唯一保护自托管机器的规则）有三种绕过形态，其中 `runs-on: [macos, arm64, dsh]` 正是本仓库 runner 的标签集 | #38 |
| P1-4 | #12 | W3 漏掉整个 `jobs.<id>.uses` 语法类别；W1 又在该 job 形态上要求一个 GitHub 禁止的键 | #38 |
| P1-5 | #12 | W5/W6 只看顶层 `concurrency`，`jobs.*.concurrency` 从不检查——W5 要防的那件事原样通过 | #38 |
| P1-6 | #12 | 目录不存在 → `[]` 当成「合规」；仓库自查用例的根目录取自 `process.cwd()`，从子目录运行即退化成空断言 | #38 |
| P1-7 | #19 | `gate:*` 只查数量、不查取值；`gate:E9`、`gate:`（空值）都通过 | #39 |
| P1-8 | #35 | 名为「Disclosure scan」的检查里**完全没有凭据模式**——而这是 §10 唯一的硬不变量类目，也是最容易机械判定的一类 | #40 |
| P1-9 | #33 | 三个 MVP 定义里只有一个在仓库内自洽：`git grep 十三步` 全仓库仅 1 处命中且从未枚举，MVP-1 与首发范围的验收口径无法被只读本仓库的人判定（违反 §1.5） | #44 |
| P1-10 | #33 | `#7 blocked-by #4` 与 D1 自己「MVP-0 该最先做，因为它不需要外部系统」的论证方向相反；MVP-0 被挡在唯一需要真实 GitHub 的那一项之后 | #43 |
| P1-11 | #33 | 计划写下的 stop-rule（「不要现在加 project-scope token + workflow + PR，会加重瓶颈」）被它自己的 Batch 8/9（= #35、#37）推翻，Decision Log 无反转记录 | 见下节 |
| P1-12 | 跨 PR | 9 个 PR 的合并顺序没有长期载体，三份说法互不一致且全在 PR 描述里；4 步需人工解冲突；#33 的「无冲突」预演做的是错的那一对 | #46 |
| P1-13 | 跨 PR | 主要矛盾（见下节） | #42 |

### P2 —— 小问题（3 处就地修，其余开 issue）

**就地修复的三处**（判据：改动机械，且留着会在 `main` 上长期误导）

| PR | 问题 | 处理 |
|---|---|---|
| #11 | 四处 `AGENTS.md §8.6` 指代 label 词表，而合并后 §8.6 是「敏感信息自查」、词表是 §8.7——从「悬空」变成「**静默指错**」。悬空看得见，指错看不见 | `cea2171`：改指 §8.7；第 91 行 `kind/*` → `kind:*` |
| #33 | `Date/Author` 是 `PLANS.md` §3 强制字段而非散文，11 处写了工具品牌名（§8.1 的禁止例子正是它）；同批 #3 / #19 在同一字段都写 `agent` | `aacf379`：统一改 `agent` |
| #33 | 同一份文件对 Batch 6 给出两个相反结论（清单未勾选 / 验收表「待人类执行」/ Outcomes「待人工执行」 vs Progress「已实测」）。外部状态回读判定 Progress 是对的 | `aacf379`：改正另外三处，并补上「四条内置工作流已关闭」 |
| #19 | `2358e70` 的提交标题是纯英文，违反 §8.2；它也是 9 个分支里唯一一个，并把 PR 标题也带成英文 | `2db7e9f`：改为中文（内容 diff 为空） |

**其余 P2**（已归入 #38–#41、#45–#49）：#35 的先加后删通过、提交信息与 PR 描述不扫、`+++` 行被丢弃、exit code 契约零覆盖、CJK 路径分桶、生成物未排除；#12 的 W2 大小写与无牙、引号 `'true'`、`jobs:` 列表、符号链接；#19 的 `requiredAreas` 死锁、CLI 守卫、空 API 响应、三条无牙规则；#37 的字段身份守卫、checkout PR 代码带 PAT、枚举式契约测试、null 塌缩；#21 的会话队列无上界；#33 的 `Size` 是标签而非控制、里程碑到期日与 D2 冲突、「六个内置工作流」实为九个、M2 横向分层、验收项全在测规划产物、一份 ExecPlan 装三件事、agent 写规划状态与关系语义。

### P3 —— nit

#13 的 `/opt/homebrew/bin/engram` 硬编码路径与分支名品牌（不建议改名）；#33 的批次顺序 1,2,3,4,5,9,7,8,6；#35 的自我豁免与误报；#37 的分页未检查、`review.dismissed` 未处理、PAT 过期的诊断信息；`AGENTS.md` §9.3 说「十类不变量」而 `tests/README.md` 列 8 类（`main` 上已有，非本轮引入）。

## Surprises & Discoveries

1. **本轮唯一的 P0 只存在于并集里，任何单个 PR 的 CI 都看不到它。**
   **Evidence**：8 个 PR 合并 → `pnpm verify` 42/42 + `workflow-check: no findings`；加 #37 → `pass 33 / fail 1` + 两条 `::error::`。#37 分支无检查器、#12 分支无该 workflow。
   **Decision impact**：这证明「每个 PR 的 CI 都绿」不等于「合并后 `main` 绿」。#12 的 `checkWorkflows(rootDir)` 接口已经具备跨分支判定能力，缺的是把它接进流程。建议把「对队列中每个待合并分支跑一次检查器」写进合并前检查单。

2. **`git grep 十三步` 在整个仓库（9 个分支 + main）只有 1 处命中。**
   **Evidence**：命中处就是 #33 计划第 64 行那句话本身；从未被枚举。
   **Decision impact**：MVP-1 与首发范围的验收口径依赖仓库外的不可分发输入，违反 §1.5。而 MVP-0 不受影响——issue #7 的正文已经完整枚举了 7 个节点与 5 条断言。归口 #44。

3. **`Item closed → Status = Done` 是被 #33 显式裁决并开启的，理由是「关闭 issue 是人做出的规划动作，不是工程事实」——而这个前提在本仓库不成立。**
   **Evidence**：§8.2 要求提交信息写 `Closes #N`，这 9 个 PR 全部使用；rebase merge 之后 issue 由 GitHub **自动**关闭，那是工程事实。
   **Decision impact**：本次未就此提阻塞意见——它是一个有记录的裁决，且 `Item closed` 写的是人拥有的 `Status`，方向上与 D4 的理由一致。但这条与 #37 要修的那类违规是同一个形状，只是从另一扇门进来。合并第一个带 `Closes #N` 的 PR 时值得观察一次：issue 自动关闭后该条目的 `Status` 是否被改写。记入 #45 的观察项。

4. **两条子评审结论被独立复核推翻，已撤回。**
   **Evidence**：(a) 一路子评审把 #19 的三个 area（`review` / `development` / `project-management`）无对应目录判为阻塞问题；核对 #19 的 PR 描述后发现作者**已显式说明**这三个目录由并行 PR 引入、因此刻意取单向覆盖而非相等判定，并在完整合并树上验证为真（`policy-check areas` 21 行、`issue-policy.test.js` 8/8 通过、三个目录都存在）。(b) 同一路把「#37 checkout PR 代码导致 token 外泄」判为 P1 阻塞；`gh api …/collaborators` 回读只有 owner 一人（admin），token 外泄那一支需要 push 权限，当下不可利用，降为 P2。
   **Decision impact**：子评审结论一律需要评审者独立复现才能进入阻塞级裁决。这两条如果直接采信，会各产生一次错误的阻塞。

5. **#33 的「已用 `git merge-tree` 预演确认无冲突」做的是错的那一对。**
   **Evidence**：#33 只对 #3 做过预演（#3 改 Completed 表）。而 #12 也改 `docs/README.md`，且与 #33 替换的是 Active 表里**同一行**占位 `| — | 当前没有进行中的计划 | — |`；#33 要求排在 #12 之后。实测冲突。
   **Decision impact**：一个 PR 的「无冲突」声明必须对**它声明的合并位置之前的所有 PR**做预演，不是对任意一个。记入 #46。

6. **批准门禁无法由本次评审满足，合并最终以管理员权限执行。**
   **Evidence**：`gh pr merge 12 --rebase` → `the base branch policy prohibits the merge`（需 1 个批准）。原因是两条约束叠加：(a) 分支保护要求 1 个批准，(b) GitHub 不允许 approve 自己的 PR，而全部 9 个 PR 的作者与本次使用的凭据是同一个账号。
   **Decision impact**：人类伙伴显式授权后，8 个 PR 以 `--admin` 合并（`enforce_admins=false`）。**检查门禁全程是真的绿的**——每个 PR 合并前都实跑过 `pnpm verify` 与 `workflow-check`，被绕过的只有批准门禁。需要如实记下的是：本仓库自己的评审标准（`docs/review/README.md` §6）写着「评审者不 approve 自己参与的 PR；批准门禁与检查门禁是两道独立的门」——所以这里缺的本来就是第二个人。单人仓库里这条约束只能靠管理员绕过，那么它作为门禁的意义应当被重新评估（要么接受它是形式性的，要么引入第二位评审者）。

7. **不变量 3 的违反在合并过程中被实测到 8 次，而不是 0 次。**
   **Evidence**：`AGENTS.md` §8.2 要求提交信息写 `Closes #N`，8 个 PR 全部使用；rebase merge 后 GitHub 自动关闭 issue，而 `Item closed` 内置工作流开着，于是把 `Status` 写成 `Done`：
   ```
   05:03:57  PR #12 rebase merge（含 Closes #16）
   05:03:58  issue #16 由 GitHub 自动关闭
   随后      看板 #16 Status = Done（Engineering 仍是陈旧的 PR open——同步工作流缺 PROJECTS_TOKEN 跑不起来）
   合并完成后：#14 #15 #16 #17 #18 #20 #32 #34 全部 Status = Done
   ```
   **Decision impact**：#33 的 D4 开启 `Item closed → Status = Done`，理由是「关闭 issue 是人做出的规划动作，不是工程事实」。这个前提在本仓库不成立——issue 不是人关的，是 PR 合并关的。所以实际发生的是「工程事实默认覆盖规划状态」，正是不变量 3 点名禁止的那一条（原文就包含「PR 合并」）。这 8 次的取值恰好是对的，所以没有造成损害；但机制是被禁止的那个，没有人参与、没有 actor 痕迹。如果其中任何一个 issue 被刻意停在 `In Review` 等人签字，那个意图会被静默抹掉——而这正是 #33 自己在 03:17 抓到的那次事故的形状。证据与建议已补进 #45：把检查范围从四条扩大到五条（纳入 `Item closed`），或者在文档里明确记一条例外并论证它站得住。我的判断是后者站不住，因为触发链就是 PR 合并。

8. **`Issue policy` 检查在合并过程中抓到一个真实的存量违规。**
   **Evidence**：#33 合并前该检查变红——`linked issue #32: summary is 86 characters; keep it under 80`。扫全部 issue 后发现两个越界（#32 = 86、#36 = 81）。
   **Decision impact**：这是检查器按设计工作的一个正面证据——它抓到的不是本轮新引入的问题，而是存量。两个标题已缩短并用 `policy-check issue` 复核通过（exit 0）。顺带暴露一个覆盖缺口：该检查只核对**被 PR link 的**那个 issue，因此没有被任何 PR link 的 issue 可以长期不合规而不被报告。

7. **`pnpm install --frozen-lockfile` 在无 TTY 环境下会中止而不是失败。**
   **Evidence**：`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`，需 `CI=true`。
   **Decision impact**：合并模拟脚本必须显式设 `CI=true`，否则「install 失败」会被误读成依赖问题。这也解释了一次中途的假失败（`workflow-check.mjs` 报 `ERR_MODULE_NOT_FOUND: yaml`——那是环境缺依赖，不是不变量违规，已在定位 P0 前排除）。

## Decision Log

- **Decision**：#37 不合并；其余 8 个 PR 评审结论为可合并。
  **Rationale**：P0-1 使 `main` 的必需检查变红（有完整合并实测），P0-2 违反 §1.3 的实现级硬约束（有真实 API 响应形状为证）。两条都不属于「超出 MVP 交付阶段的加固」，而是「合并即让 `main` 变坏」。其余 8 个 PR 在完整合并后门禁全绿（42/42）。
  **Date/Author**：2026-09-18 / agent

- **Decision**：#37 的 P1-1（reviewer 授权缺口）随 P0 一起修，不单独开 issue。
  **Rationale**：public 仓库上任何互联网用户都能驱动持有 PAT 的 job 写看板，且不留 actor 痕迹；而 #37 存在的理由正是「工程事实覆盖规划状态且不留痕迹」。修法是 `if:` 上加一个 `author_association` 判定，与两条 P0 的修复在同一个文件、同一次推送内完成，分开跟踪只会增加往返。
  **Date/Author**：2026-09-18 / agent

- **Decision**：就地修 #11 / #33 / #19 三处 P2，其余 P2/P3 一律开 issue。
  **Rationale**：人类伙伴要求 P2/P3「三思而后行」。判据取「改动是否机械」与「留着是否会在 `main` 上长期误导」两条同时成立：#11 的四处引用会从悬空变成**静默指错**（悬空看得见，指错看不见）；#33 的品牌名在一个 `PLANS.md` 强制字段里，而本仓库为发布面已改写过一次历史；#33 的 Batch 6 矛盾让 ExecPlan 在「只读这一份文件就能继续」这条上失效；#19 的英文提交标题会经 rebase merge 原样落到 `main`。检查器类的 P1/P2 改动需要新增测试、属于「改一个会变红的检查」，按 §6.4 应单独成 PR，因此不就地修。
  **Date/Author**：2026-09-18 / agent

- **Decision**：不采信单一子评审来源的阻塞级结论。
  **Rationale**：五路子评审中有两条阻塞级结论被独立复核推翻（见 Surprises 第 4 条），其中一条的反驳证据就写在被审 PR 自己的描述里。阻塞一个 PR 的代价远大于多花一次复现。
  **Date/Author**：2026-09-18 / agent

- **Decision**：把「主要矛盾」写成一个可执行的 issue（#42），而不是只写成评审结论。
  **Rationale**：「过程工作挤掉交付」如果只是一段判断，下一轮会原样重现。#42 要求的是一个**当前必然失败**的 e2e 用例骨架——它把 MVP-0 从散文变成「用例存在且因正确的原因失败」，并且让「还差几个节点」成为一个可读的数字。这是本次评审认定的最小决定性下一步。
  **Date/Author**：2026-09-18 / agent

## 主要矛盾

**这个仓库为一个尚未产出任何可度量之物的过程，造了一台越来越精密的度量仪器。**

九个 PR 加起来约 3812 行过程、CI、脚本与文档，`packages/` 与 `apps/` 加起来 **0 行**改动；`main` 上的产品总量是 136 行骨架。新增 46 条测试全部是过程工具测试，而 `tests/README.md` 自己声明的 8 类优先级中第 1–4 类（身份不变量、事实所有权、外部写入安全、同步幂等）现有测试数是 **0**。合并过 2 个 PR（都是引导），关闭过 0 个 issue。

但这里的问题不是抽象的「过程 vs 产品」——过程工作的质量是高的，其中几件会长期付息（见下节）。真正的问题是**系统自己的诊断是对的，然后被系统自己的惯性推翻了**：#33 把瓶颈准确地判定为合并吞吐，写下 stop-rule「迭代 1 只做清空评审队列，不排任何新开发」，并以此为理由**明确拒绝**了「加一个 project-scope token 存成 secret + 加一个 Actions 工作流 + 再开一个 PR」；然后把这件事作为自己的 Batch 9 交付了（就是 #37），Batch 8 又是一个（#35），队列从 6 个变成 9 个，而 Decision Log 里没有任何反转记录。

更深一层的形态是：**过程机械是目前唯一在接收反馈的子系统，因此也是唯一在改进的子系统**；而每一次改进都往队列里加一个 PR，队列深度正是被抱怨的那个东西。同时，唯一能证伪核心信念的那个产物——MVP-0，它的验收标准已经写好、可判定、无凭据、而且写得很好（issue #7）——被一条与该计划自己论证方向相反的依赖边挡在 15 个 issue 之后。

最小决定性下一步不是再写一个检查器，而是让 MVP-0 变成一个会失败的断言（#42），并把它从 Gate E1 后面放出来（#43）。

## Idempotence and Recovery

- **行级意见与 PR 级结论**：已提交，不可撤销地公开。重复运行提交脚本会产生重复评论——脚本只应跑一次；如需修订，在同一 thread 内回复，不开新 thread（`docs/review/README.md` §4）。
- **12 个 issue（#38–#49）**：外部状态。撤销方式是逐个 `gh issue close --reason "not planned"`；issue 编号被永久消耗，不可回收。
- **三处就地修复**：仓库状态，`git revert` 即可。历史重写前已推 `backup/pre-rebase-pr{3,11,13,19,33}` 到 origin；#19 的重写可用 `git reset --hard backup/pre-rebase-pr19` 完整恢复（内容 diff 已验证为空）。
- **合并模拟**：全部在会话 scratchpad 的 clone 内进行，真实仓库与 worktree 的 `git status --porcelain` 在评审期间保持为空。
- **未产生的外部状态**：未合并任何 PR、未关闭任何 issue、未改动分支保护、未创建任何 secret、未改动看板字段与内置工作流。

## Interfaces and Dependencies

**本文件依赖的仓库内文件**：`AGENTS.md`、`PLANS.md`、`docs/README.md`、`tests/README.md`，以及 `docs/review/README.md`（由 #12 引入——本文件所在目录也由 #12 建立，因此本评审文档应在 #12 之后落地）。

**交还给人类伙伴的待办**：

1. **合并 8 个 PR**（需要一个第二方批准，或由人类伙伴自己执行 rebase merge）。顺序与 4 个已知解冲突点见下。
2. **#37**：修两条 P0 + 一条 P1 后请求复审。
3. **#42 / #43**：本次评审认定的最小决定性下一步。

**合并顺序（实测，非推演）**：

| 步骤 | PR | rebase | 解冲突点 |
|---|---|---|---|
| 1 | #12 | clean | —— |
| 2 | #19 | 冲突 | `AGENTS.md` 三处，均「两边都保留」；§8.6 归 #12、§8.7 归 #19（作者已正确预测） |
| 3 | #21 | clean | —— |
| 4 | #3 | 冲突 | `docs/README.md` Completed 表，两边各加一行 |
| 5 | #11 | 冲突 | `AGENTS.md` 索引表，两行级 |
| 6 | #13 | 冲突 | `AGENTS.md` 索引表，两行级 |
| 7 | #33 | 冲突 | `docs/README.md` Active 表——与 #12 替换同一行占位（**未被声明**，见 Surprises 第 5 条） |
| 8 | #35 | clean | 必须在 #12 之后（6 处 `§8.6` 引用）与 #33 之后（ExecPlan 链接） |
| 9 | #37 | clean | **暂缓**——两条 P0 |

GitHub 的 rebase merge 无法解冲突，因此第 2、4、5、6、7 步必须先本地 rebase 再 force-push。

## Outcomes & Retrospective

**交付了什么**：9 个 PR 的分级风险矩阵（2 条 P0、13 条 P1、约 30 条 P2、若干 P3）、38 条锚定到新增行的行级意见、9 条 PR 级结论、12 个可执行 issue、3 处就地修复，以及一个任何单个 PR 的 CI 都无法给出的结论——**这九个 PR 里有 8 个合起来是绿的，第 9 个会让 `main` 变红**。

**「先建矩阵、再一次性提交」这条要求是有回报的，而且回报是可量化的**：本轮唯一的 P0 出现在取证的第二个批次，排在四条 P1 之后。如果在找到第一个 P1（#12 的 W4 绕过）时收工，`main` 会在合并 #37 时变红，而那时归因成本远高于现在——因为届时需要同时排查两个已合并 PR 的交互。

**做得不够的地方**：五路并行子评审中有两条阻塞级结论需要撤回，其中一条的反驳证据就写在被审 PR 自己的描述里。这说明给子评审的指令里应当强制一步「先读 PR 描述里作者对这一点的已有解释」，而不是只读代码与规则。已在本文件的 Decision Log 里记下这条方法论修正。

**合并已完成**：8 个 PR 全部进入 `main`（5 步需本地解冲突），8 个 issue 全部关闭，合并后 `main` 上实跑 `tests 42 / pass 42 / fail 0` 与 `workflow-check: no findings`——**与合并前的预测逐字一致**。#37 保持 open。

**合并过程本身又产出两条发现**（Surprises 第 7、8 条）：不变量 3 的违反被实测到 8 次（不是 0 次），以及 `Issue policy` 抓到一个真实的存量违规。这说明「把规则变成会变红的检查」这条路线是对的——本轮九个 PR 里价值最高的那部分正是它；而它同时也证明了检查的覆盖边界需要被单独审视（`Item closed` 不在检查范围内、未被 link 的 issue 不被核对）。

**批准门禁的问题需要单独决定**：单人仓库里「必须有 1 个批准」只能由管理员绕过，因此它当前是形式性的。要么接受这一点并在文档里写明，要么引入第二位评审者——本仓库自己的评审标准已经假设了后者。

## Bottom Change Note

- 2026-09-18：新建本文件。记录对 9 个开放 PR 的 MVP 交付评审：风险矩阵、行级意见、跟踪 issue、三处就地修复与合并裁决。
- 2026-09-18（同日追加）：Batch 6 完成——8 个 PR 已合并、8 个 issue 已关闭、`main` 门禁 42/42 绿。改动原因：合并在人类伙伴显式授权后执行，因此 Batch 6 从「阻塞」变为「已完成」，`Validation and Acceptance` 增加第 9 项（预测与实测一致性），`Surprises & Discoveries` 增加第 7、8 条（合并过程中实测到 8 次不变量 3 违反；`Issue policy` 抓到存量违规）。合并顺序表保留原样——它记录的是实测结果，不随合并完成而失效。
