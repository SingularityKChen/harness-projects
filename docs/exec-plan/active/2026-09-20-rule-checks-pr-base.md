# PR 体量检查的基线解耦 ExecPlan

> 状态：Active
> 创建：2026-09-20
> 范围：`.github/workflows/rule-checks.yml` 的 `pull_request` 触发器与 `scripts/rule-checks.mjs` 的基线报告；不改 `ci.yml`，不改 `AGENTS.md` §8 的预算数字
> 上游输入：issue #96、`AGENTS.md` §8/§9、`docs/project-management/merge-queue.md` §6.1、`docs/development/repository-rules.md` §2/§4、`docs/development/ci.md`

## Purpose / Big Picture

完成后：栈上任何一个 PR 的 `PR size` 结果量的是**本 PR 相对它声明的 base** 的差异，而不是整个栈相对 `main` 的累计；判定输出里写明这次用的基线是哪一条、哪个提交，读者不需要反推；栈累计仍然可见，但只作为记录，不参与判定、不设预算。

判断成功的最小证据：在 PR #95 的 head `9f89375` 上，`node scripts/rule-checks.mjs size origin/feat/core-delivery-lineage` 给出 `代码：900 / 1000 行` 且 exit 0，输出首行标明基线是 `origin/feat/core-delivery-lineage`；而同样这个 head 在修复前被 `PR size` 报成 `代码改动 7837 行，超过 AGENTS.md §8 的 1000 行上限`。

## Context and Orientation

**术语**

- **栈（stack）**：一条线性依赖的 PR 链，每个 PR 的 base 是它下面那一层。当前仓库有一个 12 个 PR 的栈（#81–#88、#92–#95），逐个 base 指向栈内上一层；栈底是 #80（base `main`）。
- **准入谓词 / 度量基线**：本计划的核心区分。`on.pull_request.branches` 决定"哪些 PR 会触发这个 workflow"（准入）；`github.base_ref` 决定"用哪条基线做差异比较"（度量）。两者是独立的概念。
- **三点差异**：`git diff A...B` ≡ `git diff $(git merge-base A B) B`，即"B 一侧自共同祖先以来的改动"。本仓库用它度量 PR 的审阅面。

**相关文件与当前状态**

| 文件 | 当前状态 | 本计划是否修改 |
|---|---|---|
| `.github/workflows/rule-checks.yml` | `on.pull_request.branches: [main]`（第 21 行）；`disclosure` 与 `size` 两个 job 都把 `github.base_ref` 传给脚本 | 是（触发器） |
| `scripts/rule-checks.mjs` | `size()` 第 452–482 行、`disclosure()` 第 397–445 行均以 `${base}...HEAD` 为范围；输出不打印基线；CLI 默认 `origin/main`（第 499 行） | 是（报告层） |
| `tests/contract/rule-checks.test.js` | 42 条离线契约测试；`noGit` 空数据源在第 74–80 行；`CI 接线` 测试在第 372–380 行 | 是（新增 4 条） |
| `.github/workflows/ci.yml` | `on.pull_request.branches: [main]`（第 5 行） | **否**（明确遗留，见 `Outcomes & Retrospective`） |
| `docs/development/ci.md` | 只描述五类 workflow 的触发与职责，未记录本次的触发决策 | 是 |
| `docs/development/repository-rules.md` §4 | 写着"用 `node scripts/rule-checks.mjs size <base-ref>` 判定"，未说明栈上该传哪个 base | 是 |
| `docs/README.md` §2 Active 表 | 只列了 `2026-09-18` 的两份计划 | 是（加入本计划） |

行号取自 `origin/main` @ `f09730b`。

**当前状态的实测（issue #96 的完整证据）**

`rule-checks.yml` 用 `branches: [main]` 约束 `pull_request`。这个过滤器不只是准入：它同时把 `github.base_ref` 钉成 `main`——**只要能跑，基线就必然是 `main`**。于是 `${base}...HEAD` 的含义退化为"这个 head 分支里还没有进 `main` 的全部内容"，在栈上就是下面每一层的并集。

在 PR #95 的 head `9f89375` 上实测：

```
$ node scripts/rule-checks.mjs size origin/feat/core-delivery-lineage   # PR 声明的 base
代码：900 / 1000 行（增删之和）
$ echo $?
0

$ node scripts/rule-checks.mjs size origin/main                          # CI 实际用的基线
代码：7837 / 1000 行（增删之和）
::error::代码改动 7837 行，超过 AGENTS.md §8 的 1000 行上限
$ echo $?
1
```

7837 与 run `35497827896` 的 job `106044050398` 报出的数字逐字一致。对 10 个有体量结论的栈内 PR 逐一比对：报告值与"相对 `origin/main` 的三点差异"精确吻合 7/7（base tip 稳定的那些），与"相对声明 base 的三点差异"吻合 0/7；报告值随栈深单调递增（1111 → 2111 → 3106 → 4339 → 5176 → 6002 → 6937 → 7837），而这些 PR 逐个都在预算内（1111 对应 983、2111 对应 1000、3106 对应 995、4339 对应 149、5176 对应 986、6002 对应 830、6937 对应 945、7837 对应 900）。

同一个谓词还有反向后果：base 是栈内分支时 workflow **完全不触发**。该 workflow 的 73 次运行里没有 PR #83 的 head `c55080ed5b` 与 PR #88 的 head `39285d938c`——这两个 head 既没有体量结论，也没有发布面扫描。

**上游依据**

- `AGENTS.md` §8 第 83 行：判据是**单个 PR**的闭环规模——"每个 PR 必须关联同仓 issue，且是一个可独立验收、合并、回滚的能力闭环；代码变更 ≤1000 行、文档变更 ≤1500 行"。它约束的是这个 PR 引入的改动，不是"这个分支相对 main 的全部内容"。
- `docs/project-management/merge-queue.md` §6.1 第 177 行："一个 PR 若修的是**影响队列中其它 PR 检查结果**的误报，应当提前到它们之前。判据不是「谁更重要」，而是「谁的红叉是别人造成的」。" 当前 8 个栈内 PR 的红叉正是别人造成的，因此本修复优先于该栈的合并。
- 栈的形态可由命令复核：`gh pr list --state open --json number,baseRefName --jq '.[] | select(.baseRefName != "main")'` 期望列出 12 行。

## Design / Spec

**关键不变量**

| # | 不变量 | 由什么保证 |
|---|---|---|
| I1 | 体量与披露的判定基线是 **PR 声明的 base**，不得由触发器的准入谓词决定 | 去掉 `on.pull_request.branches` 过滤器 + 新增契约测试 |
| I2 | 门禁不得因为 base 不是 `main` 而消失 | 同上（无过滤器 ⇒ 任何 base 的 PR 都触发） |
| I3 | 判定自描述：输出必须写明这次用的基线 ref 与提交 | `describeBaseline()` + 契约测试 |
| I4 | 栈累计只记录，不判定、不设预算 | 累计行不参与 exit code；无阈值比较 |
| I5 | 基线无法解析时 fail closed（exit 3），不得回退到 `main` | 保持现有 `baseRefExists()`；不新增任何兜底 |

**选定方案 A：解耦准入与基线**

1. `.github/workflows/rule-checks.yml` 的 `on.pull_request` 去掉 `branches: [main]`，保留 `types: [opened, synchronize, reopened, edited]`。触发器不再约束 base，`github.base_ref` 恢复成"PR 自己声明的 base"，`${base}...HEAD` 恢复成"本 PR 的差异"。
2. `edited` 已经在 `types` 里（原本是为 `disclosure` 读 PR 描述而加）。它顺带成为**改 base 时重算**的机制：栈向上 retarget（子 PR 的 base 从栈内上一层改成 `main`）会触发一次重算，判定自愈，不需要额外机制。
3. `size()` 与 `disclosure()` 在输出首行打印 `基线：<ref> @ <sha>`。
4. `size()` 在 base 不是 `main` 时额外打印一行栈累计，措辞显式排除判定：`栈累计（相对 origin/main，仅记录，不计入判定）：…`。

**放弃的方案**

| 方案 | 内容 | 放弃理由 |
|---|---|---|
| B | 保留过滤器，脚本从本地 refs 推断"最近的祖先分支"当基线 | 把"声明的 base"换成"推断的 base"，违反 `AGENTS.md` §1.1 不变量 5（关键关联显式优先）；`pull_request` 事件下 HEAD 是 `refs/pull/N/merge` 合并提交，其父提交之一就是 head 分支自身，"最近祖先"会命中 head 分支，需要额外排除规则；且直接对栈内上一层开的 PR 仍然完全不触发，#83/#88 那类门禁缺失照旧 |
| C | 保留过滤器，只加可观测性（打印 base/range/累计），判定仍按 `main` | "能跑的时候基线永远是 `main`"这一点没有改变，红叉照旧且永久；只是把误报解释得更清楚，不满足 I1/I2 |
| D | 用 `github.event.pull_request.base.sha`（事件负载里的 base 提交）作为范围起点 | 栈上 `gh stack rebase` 会 force-push 父分支（`docs/project-management/merge-queue.md` §2.3/§2.4 记录的常规操作），事件时刻的 base sha 可能变得不可达，脚本会 exit 3——把常规操作变成门禁中断。而"当前 base 分支 tip 的三点差异"在三种情形下都仍然只算子分支的提交：base 前进、子分支尚未 rebase、父分支被改写 |

**被考虑后否决的小改动**

把 workflow 里的 `BASE_REF: ${{ github.base_ref }}` 改成 `github.event.pull_request.base.ref`：两者在 `pull_request` 事件下取值相同，**不改变任何行为**。承重的修复是去掉过滤器；防复发靠契约测试而不是换个写法，因此不做这次纯外观改动。

**术语与边界决策**

- 不新增子命令、不新增 CLI 参数、不新增运行时依赖。
- `disclosure` 一并受益（I1 对它同样成立），但本次不改它的判定逻辑与四个扫描来源。
- 栈累计的**预算**明确不做（用户决定，见 `Decision Log`）：§8 的预算管单个 PR 的闭环规模，栈累计是另一个量，先只让它可见。
- 本计划只引用 `origin/main` 上已存在的文件。栈的控制计划（`docs/exec-plan/active/2026-09-20-mvp0-parallel-stacks.md`）由 PR #80 引入、尚未合并，因此不作为引用来源，也不在本分支修改——对它的措辞修正列为遗留项。

## Global Constraints

- 只修改这 6 个文件：`.github/workflows/rule-checks.yml`、`scripts/rule-checks.mjs`、`tests/contract/rule-checks.test.js`、`docs/development/ci.md`、`docs/development/repository-rules.md`、`docs/README.md`，外加本计划。
- **不修改** `.github/workflows/ci.yml`：栈内 PR 拿不到 `Verify` / `PR Fast Gate` 的缺口本次不补，作为明确遗留记录。
- 不新增运行时依赖：只用 Node 内建模块与 `git`。
- 不修改 `AGENTS.md` §8 的预算数字，不新增 `gate:*` 标签，不修改分支保护与 `PR Fast Gate` 的检查名。
- W1–W7（`docs/development/repository-rules.md` §2）与 `tests/contract/workflow-check.test.js` 必须继续通过；本次不新增、不放宽任何 W 规则。
- 现有 42 条 `tests/contract/rule-checks.test.js` 必须继续通过，离线性质不变（纯函数测试不得因为新增报告而调用真实 `git`）。
- 发布面：分支名、提交信息、PR 描述、issue 正文都在发布面内；不写本机绝对路径、凭据、内网主机名、账号个人信息。
- 规模：代码 ≤1000 行、文档 ≤1500 行（`node scripts/rule-checks.mjs size origin/main` 判定）。
- 一个 PR 承载全部批次（用户决定），但批次边界仍按可独立验证划分。

## Plan of Work

### Batch 1 · 触发器与基线的解耦

**最小闭环**：`Rule checks` 在栈内 PR 上量的是本 PR 的差异；输出写明基线。
**涉及文件**：`.github/workflows/rule-checks.yml`、`scripts/rule-checks.mjs`
- [ ] 去掉 `on.pull_request.branches: [main]`，改写解释性注释：记录这个过滤器同时是准入谓词与基线来源，以及去掉它的理由（引用 issue #96 的两种失效形态）
- [ ] `scripts/rule-checks.mjs`：新增 `DEFAULT_BASE`、`normalizeBaseRef()`、`describeBaseline()`；`size()` 打印基线、在 base 不是 `main` 时打印栈累计；`disclosure()` 打印基线
- [ ] 保持 exit code 契约不变（`disclosure` 命中 1/干净 0；`size` 超预算 1/未超 0；base 不可解析 3）；累计计算失败只降级为一行说明，不影响判定

**验证**

```bash
node scripts/rule-checks.mjs size origin/main
```
期望：首行是 `基线：origin/main @ <sha>`，且**不出现** `栈累计` 一行；两个桶的行数与修复前一致。

```bash
node scripts/rule-checks.mjs disclosure origin/main
```
期望：首行是 `基线：origin/main @ <sha>`，后续输出与修复前一致；exit 0。

**回滚**：`git revert` 本批提交；workflow 回到带过滤器的形态，脚本回到不打印基线的形态。

### Batch 2 · 契约测试固化不变量

**最小闭环**：I1–I4 各有一条会失败的判别性测试；修复被回退时这些测试变红。
**涉及文件**：`tests/contract/rule-checks.test.js`
- [ ] `CI 接线`：断言 `rule-checks.yml` 的 `on.pull_request` **没有** `branches` / `branches-ignore`，断言消息写明它会把 `github.base_ref` 钉成被过滤的那一条、从而改变度量基线
- [ ] `体量`：base 不是 `main` 时输出同时含本 PR 两行与 `栈累计` 一行，且**累计注入一个远超预算的值时 exit code 仍为 0**
- [ ] `体量`：base 是 `main`（含 `origin/main` 与 `main` 两种写法）时不打印 `栈累计` 行
- [ ] `披露`：输出含 `基线：` 且带注入的提交；`noGit` 增加 `resolveRef` 桩，保持离线

**验证**

```bash
node --test tests/contract/rule-checks.test.js
```
期望：全部通过；把 Batch 1 的 workflow 改动反向注入后，"CI 接线"那条必须失败。

**回滚**：`git revert` 本批提交。

### Batch 3 · 文档与规则表述同步

**最小闭环**：读者从规则文档就能知道栈上该传哪个 base，以及为什么不能在这里加分支过滤器。
**涉及文件**：`docs/development/repository-rules.md` §4、`docs/development/ci.md`、`docs/README.md`
- [ ] `repository-rules.md` §4：`size <base-ref>` 后补一句——栈上 base 是下面那一层，传 `main` 会量成整个栈（issue #96）
- [ ] `ci.md`：记录"Rule checks 不对 `pull_request` 声明分支过滤器"这条决策与两种失效形态；登记 `ci.yml` 仍未放开触发器的遗留
- [ ] `docs/README.md`：Active 表加入本计划

**验证**

```bash
node scripts/workflow-check.mjs
```
期望：`workflow-check: no findings（已检查 5 个文件）`，exit 0。

```bash
node scripts/rule-checks.mjs size origin/main
```
期望：两个桶都在预算内，exit 0。

**回滚**：`git revert` 本批提交；纯文档。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 栈上 PR 的体量判定按自己的 base | 在 `9f89375` 上 `size origin/feat/core-delivery-lineage` → `代码：900 / 1000 行`、exit 0 | 通过 |
| 2 | 报告写明基线，读者不需要反推 | 首行为 `基线：origin/feat/core-delivery-lineage @ 592b6208721a（判定范围 origin/feat/core-delivery-lineage...HEAD）` | 通过 |
| 3 | 栈累计可见但不参与判定 | 同一命令出现 `栈累计（相对 origin/main，仅记录，不计入判定）：代码 7837 行、文档 1359 行` 且 exit 0；契约测试把累计注入 8000 行时 exit 仍为 0 | 通过 |
| 4 | 触发器不再约束 base（I1/I2） | `node --test tests/contract/rule-checks.test.js` → pass 49 / fail 0；把 `branches: [main]` 反向注入后该条失败并给出 issue #96 的理由 | 通过 |
| 5 | `main` 基线的日常输出不被污染 | `size origin/main` 输出中 `栈累计` 出现 0 次 | 通过 |
| 6 | W1–W7 与 workflow 契约未破坏 | `node scripts/workflow-check.mjs` → `no findings（已检查 5 个文件）`、exit 0 | 通过 |
| 7 | 门禁与配置变更的完整回归 | `tsc --noEmit` exit 0；`node --test tests/contract tests/integration tests/e2e` → pass 175 / fail 0 | 通过（`verify` 的两个组成命令逐条执行，见遗留 6） |
| 8 | 体量与发布面合规 | `size origin/main` 两个桶都在预算内；`disclosure origin/main` 机械扫描 exit 0；五类目人工核对无命中 | 通过 |
| 9 | 触发器语义在真实事件上得到证实 | 合并后栈内某个 PR 收到一次 push，`gh run list` 出现 base 为该 PR 声明 base 的新 run | **本次无法验证**（需要合并后的真实事件，见遗留 2） |

## Progress

- [x] (2026-09-20) 取证：复现 PR #95 的 `7837` 与真实值 `900`，逐一比对 10 个栈内 PR，确认报告值等于相对 `origin/main` 的三点差异（7/7），并发现 #83/#88 的 head 从未触发
- [x] (2026-09-20) 开 issue #96，`node scripts/policy-check.mjs issue 96` 通过
- [x] (2026-09-20) 建隔离工作区 `.worktrees/rule-checks-stacked-base/`，分支 `fix/rule-checks-stacked-base`（base `origin/main` @ `f09730b`）
- [x] (2026-09-20) Batch 1 · 触发器与基线的解耦
- [x] (2026-09-20) Batch 2 · 契约测试固化不变量（新增 7 条，42 → 49）
- [x] (2026-09-20) Batch 3 · 文档与规则表述同步

## Surprises & Discoveries

1. **同一个配置值承担了两个职责。** `on.pull_request.branches: [main]` 既是准入谓词，又通过 `github.base_ref` 决定度量基线。此前 `rule-checks.yml` 的注释把它当作纯准入（"即使 base_ref 被 `branches: [main]` 约束成只可能是 main，也不在 shell 里展开"）——那句话描述的就是这条耦合，只是当时把它读成了安全性质而不是缺陷。证据：10 个栈内 PR 的报告值 = 相对 `origin/main` 的三点差异。

2. **反向失效同样存在，而且此前没有被记录。** 栈内 PR 在 base 不是 `main` 时 workflow 完全不触发：PR #83 的 head `c55080ed5b`、PR #88 的 head `39285d938c` 在该 workflow 的 73 次运行里一次都没出现。也就是说 `PR size` 与 `Disclosure scan` 对这两个 head 都是空白——不是绿，是没有结论。

3. **误报随栈深单调增长。** 报告值 1111 → 7837，恰好等于栈内各层之和。栈越深，越上面那一层越必然红——而这个栈正是当前交付方式。按 `merge-queue.md` §6.1 的判据，这属于"红叉是别人造成的"，应当先于该栈合并修复。

4. **退化的触发路径有两条，结果相同。** PR #95 的 run 创建于 `created_at + 3s`，而它的 `base_ref_changed` 发生在 run 之后 37 秒——触发瞬间 base 还是 `main`，随后 retarget 到栈内上一层，红叉被永久冻结（过滤器不再允许重跑）。PR #81 的两次 `base_ref_changed`（07:05:39 / 07:05:58）之间夹着 07:05:41 的 run——形态是"为了让门禁跑一次而临时把 base 指回 `main`"。两条路径都源自同一个过滤器。

5. **栈的控制计划还不在 `main` 上。** `docs/exec-plan/active/2026-09-20-mvp0-parallel-stacks.md` 由 PR #80 引入、尚未合并（`git cat-file -e origin/main:…` → 不存在）。因此本计划改为只引用 `main` 上已有的规范来源（`AGENTS.md` §8 的"每个 PR … ≤1000 行"与 `merge-queue.md` §6.1），并把对那份计划 D5 的措辞修正列为遗留项——否则本 PR 会亲手制造 `merge-queue.md` §1 记录过的"链接指向还没合并的文件"。

6. **`git rev-parse` 的结尾换行会把基线行拆成两行。** `describeBaseline()` 的第一版把 `execFileSync` 的返回值直接拼进模板串，于是 `基线：… @ f09730b678c9` 与后面的括号各占一行（`wc -l` 比预期多 1，`sed -n 1p` 只有 36 字节）。改为 `String(resolveRef(base)).trim()`，并补了一条注入 `'abc123\n'` 的契约测试防复发。这是本 PR 自己引入又自己修掉的一个缺陷，留在计划里因为它是"报告层也要有判别性测试"的具体理由。

7. **`.worktrees/` 下的工作区没有 `node_modules`，会让一条既有测试假红。** `tests/contract/workflow-check.test.js` 的「CLI：脚本路径含空格时仍然真的执行检查」用 `path.resolve('node_modules')` 造符号链接；工作区里没有这个目录时链接目标不存在，被测脚本 import `yaml` 失败 → exit 1 但 stdout 为空，正则断言失败。同一命令在主检出里通过（`✔`），说明是环境差异而非回归。另外 `node_modules/` 这条 ignore 规则**不匹配符号链接**，所以把 `node_modules` 直接做成符号链接会以未跟踪文件的形式出现在 `git status` 里（差点被 `git add -A` 带进提交）；改用真实目录 + 指向主检出各包的符号链接，它才被正确忽略。

## Decision Log

| 决策 | Rationale | 日期 / 来源 |
|---|---|---|
| 栈累计**不设预算**，只在输出里记录 | §8 的预算度量单个 PR 的闭环规模；栈累计是另一个量（`main` 在一个窗口内移动多少）。先让它可见，是否需要预算另议 | 2026-09-20 / 用户决定 |
| 全部批次由 **1 个 PR** 承载 | 改动集中在同一根因、同一组文件，拆开会让"advisory 误报修复"与"文档同步"互相等待 | 2026-09-20 / 用户决定 |
| **暂不放开 `ci.yml` 的触发器** | 保持本次改动面在 advisory 的 `Rule checks` 内；栈内 PR 拿不到 `PR Fast Gate` 的缺口另立工作项 | 2026-09-20 / 用户决定 |
| 采用方案 A（去掉分支过滤器），否决 B/C/D | 见 `Design / Spec` 的放弃理由：B 用推断替代声明并遗漏"完全不触发"那一半；C 不改变基线因而不满足 I1/I2；D 会把 `gh stack rebase` 之后的常规状态变成 exit 3 | 2026-09-20 / 本计划 |
| 不把 `github.base_ref` 改写成 `github.event.pull_request.base.ref` | 两者在 `pull_request` 下取值相同，不改变行为；防复发由契约测试承担，不做纯外观改动 | 2026-09-20 / 本计划 |
| 分支基于 `origin/main`，不基于 PR #80 | 修复必须能先于栈合并（`merge-queue.md` §6.1）；基于 #80 会把本修复的落地耦合成"#80 先合并"，而 #80 之上还有 11 个 PR 在等 | 2026-09-20 / 本计划 |
| 只引用 `origin/main` 上已存在的文件 | `AGENTS.md` §3 要求 `docs/` 自包含；引用未合并的计划文件就是悬空链接 | 2026-09-20 / 本计划 |

## Idempotence and Recovery

- 所有实现步骤都是可重复执行的文本修改；`pnpm verify`、`node scripts/workflow-check.mjs`、`node --test tests/contract/rule-checks.test.js` 都不写外部状态，可任意次重跑。
- 唯一的远端副作用是 push 分支与开 PR；撤回方式是关闭 PR 并删除远端分支（属于破坏性操作，交给 `git-expert-operations` 流程并由人类确认）。
- 回到已知良好状态：`git switch main` 后工作区即回到 `f09730b`；本分支的全部改动都在 4 个提交里（计划、Batch 1、Batch 2、Batch 3），`git revert` 任一提交即可单独回退某一批。
- 本计划不改动任何远端配置（分支保护、workflow 开关、看板字段），因此不存在 revert 无法回退的外部状态。
- 失败模式与对应动作：Batch 1 后若 `size origin/main` 的输出与修复前不一致，说明报告层改动影响了原有路径——先回退 Batch 1，再单独复现；Batch 2 的"不得声明分支过滤器"测试若在修复前就是绿的，说明断言写错了对象（应断言 `on.pull_request.branches` 为 `undefined`）。
- `docs/README.md` 的 Active 表与 PR #80 会在同一区域各加若干行，rebase 时按 `merge-queue.md` §2.3 的"两边都保留"处理，不删对方行。

## Interfaces and Dependencies

- **依赖**：`git`（`diff --numstat`、`rev-parse`，均为只读）、Node 内建模块。无新增依赖、无网络、无凭据。
- **workflow ↔ 脚本契约**：`rule-checks.yml` 通过环境变量 `BASE_REF`（值 `origin/${{ github.base_ref }}`）与 `PR_BODY` 向脚本传参；脚本不读事件负载文件。
- **命名契约**：`describeBaseline()`、`normalizeBaseRef()`、`DEFAULT_BASE` 三个导出名；累计行的固定措辞 `不计入判定` 是 Batch 2 断言的锚点，改名即改测试。
- **GitHub 侧语义依赖**：`on.pull_request.branches` 按 base 分支过滤；`pull_request` 的 `edited` 动作包含改 base。两者都由契约测试或真实事件回读覆盖，不写进脚本假设。
- **工具**：`gh` CLI 只用于交付步骤（issue、PR、回读），不进入脚本与 CI。

## Outcomes & Retrospective

三个批次全部完成，验收项 1–8 通过，第 9 项需要合并后的真实事件。改动落在 4 个提交上：计划、Batch 1（workflow + 脚本）、Batch 2（契约测试新增 7 条）、Batch 3（文档与计划回填）。

核心证据是同一条 head（`9f89375`）上的对照：修复前 `size origin/main` 给 `代码：7837 / 1000 行`、exit 1，而那正是 job `106044050398` 的结论；修复后 `size origin/feat/core-delivery-lineage` 给 `代码：900 / 1000 行`、exit 0，首行写明 `基线：origin/feat/core-delivery-lineage @ 592b6208721a`，栈累计 7837 行单列一行并标注不计入判定。

与计划的偏差：Batch 3 原计划还要修改 `docs/exec-plan/active/2026-09-20-mvp0-parallel-stacks.md` 的 D5 表格，因该文件不在 `main` 上而改为遗留项（遗留 3）；`pnpm verify` 没能以包装命令的形式执行（遗留 6）。计划没有预见到 `describeBaseline()` 的换行缺陷（Surprises 6），它在实现过程中被发现并当场修掉，并补了防复发断言。

交付载体是 PR #98（`fix/rule-checks-stacked-base`，base `main`）。除验收表里的本地证据外，修复后的报告已在真实 CI 事件上跑过：run `35499369649` 的 `size` job 日志里出现 `基线：origin/main @ f09730b678c9（判定范围 origin/main...HEAD）` 与 `代码：214 / 1000 行`（无 `栈累计` 行，因为该 PR 的 base 就是 main），同一 run 的 `disclosure` job 日志里出现 `基线：origin/main @ f09730b678c9（扫描范围 origin/main...HEAD）` 后接 `机械扫描通过`。这确认了报告层在真实环境的行为；它**不**替代验收项 9——那条要验的是 base 不是 `main` 时的触发行为。

已知需要如实记录的遗留：

1. `ci.yml` 仍以 `branches: [main]` 约束 `pull_request`，栈内 PR 拿不到 `Verify` / `PR Fast Gate`；栈的验收要求"每个 PR 的 `PR Fast Gate` 在自己的 head 上为绿"在放开该触发器之前不可满足。
2. 验收项 9（真实事件确认触发器语义）在本次无法完成：它需要合并之后栈内 PR 的一次 push。命令与期望输出已写在 `Validation and Acceptance` 里。
3. `docs/exec-plan/active/2026-09-20-mvp0-parallel-stacks.md` 的 D5 表格（"单 PR 代码变更 ≤ 1000 行"的强制方式）应补上"栈上必须传 `origin/<该 PR 的 baseRefName>`，不是 `origin/main`"。该文件由 PR #80 引入，本分支无法修改；#80 合并后追加一句即可。
4. `pull_request` 的 workflow 不会因为 base 分支自身前进而重跑；栈内 PR 的体量结论因此可能相对一个已经前进的 base 变旧。本次通过打印基线提交让这种陈旧可见，但不引入自动重算。
5. `disclosure` 的判定范围同样被修正，但它对"栈内 PR 的发布面"是否应逐 PR 独立扫描（而不是只在合并前的整体扫描）未做进一步论证。
6. `pnpm verify` 在本会话的沙箱内无法运行：pnpm 读到 `package.json` 的 `packageManager` 字段后要自举对应版本，需要写工作区外的临时目录（`Operation not permitted`）。改为逐条执行它的两个组成命令——`tsc --noEmit`（exit 0）与 `node --test tests/contract tests/integration tests/e2e`（pass 175 / fail 0）。CI 侧仍以 `pnpm install --frozen-lockfile` / `pnpm typecheck` / `pnpm test` 的真实执行作为该路径的证据。

## Bottom Change Note

- 2026-09-20：创建。记录 issue #96 的取证结果、方案 A/B/C/D 的取舍、三项用户决定（栈累计不设预算、1 个 PR、暂不放开 `ci.yml` 触发器）与三个批次。
- 2026-09-20：修正引用来源。发现栈的控制计划由 PR #80 引入、尚未在 `main` 上，故改为只引用 `main` 已存在的 `AGENTS.md` §8 与 `merge-queue.md` §6.1；Batch 3 去掉对那份计划的修改，改列遗留项；补记"分支基于 `origin/main`"的决策与 `docs/README.md` 的冲突处理方式。
- 2026-09-20：三个批次完成，回填 Progress、验收结果（1–8 通过、9 待合并后真实事件）、Surprises 6–7（`describeBaseline()` 换行缺陷、工作区缺 `node_modules` 造成的假红）与 Outcomes，新增遗留 6（`pnpm verify` 的沙箱限制与等价证据）。
- 2026-09-20：登记交付载体 PR #98 与真实 CI 事件的报告证据（run `35499369649` 的 `size` / `disclosure` 两个 job 日志都打印了基线），并写明它不替代验收项 9。
