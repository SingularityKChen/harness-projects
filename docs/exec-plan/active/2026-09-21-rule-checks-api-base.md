# Rule checks 判定基线改用 PR API ExecPlan

> 状态：Active
> 创建：2026-09-21
> 范围：`Rule checks` 的 `size` 与 `disclosure` 的**判定输入**（从 PR REST API 取 `base.sha`、从事件取 `head.sha`，判定固定在这一对不可变提交上）与相应契约测试、文档；不改 `ci.yml`、分支保护、预算数值、`PR Fast Gate` 名称
> 上游输入：issue #99、issue #96、PR #98、run `35511506461`、`docs/exec-plan/completed/2026-09-20-rule-checks-pr-base.md`（被本计划订正；它在 61d6833 归档到 `completed/`）

## Purpose / Big Picture

完成后：`Rule checks` 的两个检查（同一个 matrix job 的两格）都判定**一对不可变提交** `(base_sha, head_sha)`——`base_sha` 来自 PR 对象自己声明的 base（权威来源，不是运行时的 `github.base_ref`），`head_sha` 来自事件负载；两个顶层 job（`checks` 经 matrix 展开为两格，运行时共三个执行实例）的 checkout 都钉在事件 head 上并校验对象身份，判定与"运行期间分支是否前进或被改写"无关；输入无法确定时 job 失败并且**不回退到 `main`**；日志能区分"诊断字段"与"判定对象"，复核者不必再反推。

最小成功证据：对 PR #94 的 head `8c660b06050e`，job 日志同时出现上下文 `main`（诊断）与 API base `feat/core-start-work`（判定），脚本最终范围是 `origin/feat/core-start-work...HEAD`，体量结论是 `代码：892 / 1000 行`（通过），而不是 `origin/main...HEAD` 的 `4796` 行（失败）。

## Context and Orientation

**术语**

- **声明 base**：PR 对象自己声明的目标分支，`GET /repos/{owner}/{repo}/pulls/{number}` 的 `base.ref`；页面上显示的就是它。
- **运行时 base**：Actions 表达式 `github.base_ref`。它是事件上下文里的值，**不保证**等于声明 base。
- **栈（stack）**：GitHub 原生 stacked PR 链；成员 PR 的声明 base 是栈内上一层，而运行时 base 是栈的 base 分支。
- **三点差异**：`git diff A...HEAD` ≡ `git diff $(git merge-base A HEAD) HEAD`，只算 HEAD 一侧自共同祖先以来的改动。

**相关文件与当前状态**（行号取自本分支的 base `origin/main` @ `722b349`（重建提交时 main 已前进；这 10 个文件在新 main 上都没有被改过））

| 文件 | 当前状态 | 本计划是否修改 |
|---|---|---|
| `.github/workflows/rule-checks.yml` | `on.pull_request` 已无 `branches` 过滤器（PR #98）；两个 job 把 `github.base_ref` 放进 `BASE_REF` | 是 |
| `scripts/rule-checks.mjs` | `size()` / `disclosure()` 接受一个 git ref，按 `${base}...HEAD` 判定；输出首行打印基线 ref 与提交 | 否（CLI 契约不变） |
| `scripts/resolve-pr-base.mjs` | 不存在 | 是（新增） |
| `tests/contract/rule-checks.test.js` | 51 条离线契约测试 | 否 |
| `tests/contract/resolve-pr-base.test.js` | 不存在 | 是（新增） |
| `tests/contract/rule-checks.test.js` | 含既有的「CI 接线」断言 | 是（新增判定对象来源、顺序与"没有移动 ref"的断言） |
| `docs/development/ci.md` | 记录 PR #98 的触发器决策；措辞曾把过滤器说成"同时钉住判定基线" | 是（订正措辞 + 记录"判定固定到对象对"的新语义） |
| `docs/development/repository-rules.md` §4 | 写着 `size <base-ref>` 的 base 是 PR 自己声明的 base | 是（补上"栈上取 API"的说明） |
| `docs/exec-plan/completed/2026-09-20-rule-checks-pr-base.md` | 已归档；Design 断言"去掉过滤器后 `github.base_ref` 恢复成 PR 自己声明的 base" | 是（就地订正，见 Batch 4） |

**已验证事实**（每条都可复核）

1. PR #94 的 API：`base.ref=feat/core-start-work`、`base.sha=86d78121193ae3a65b5ba452ccfe6d6bf5404a23`、`head.sha=8c660b06050e7ef78a78aae08198fce5303fcf7b`。
2. run `35511506461`（`pull_request`，head 分支 `feat/core-delivery-lineage`）的 `head_sha` 正是 `8c660b06050e…`；其 `PR size` job `106080093985` 的日志回显 `BASE_REF: main`，并打印 `基线：origin/main @ 528ff4e002a2（判定范围 origin/main...HEAD）`、`代码：4796 / 1000 行`。
3. 该 run 用的是 **PR #98 合并之后**的 workflow 与脚本：栈内 11 个分支的 `rule-checks.yml` 都不含 `branches: [main]`，抽查的 `refs/pull/N/merge` 都含 #98 的提交，且 `基线：` 这一行只有 #98 之后的脚本才会打印。**所以"移除过滤器"没有改变栈成员的运行时 base。**
4. 同一 head 相对声明 base 的正确测量是 `892/45`（通过），相对 `origin/main` 是 `4796/510`（失败）。
5. `git rev-list --count 86d7812..8c660b0605` = 8，`528ff4e..8c660b0605` = 23——两条比较范围的提交数差一个量级。
6. 当前 7 个开放栈内 PR 全部因为同一原因红：按声明 base 依次是 `553/0`、`149/73`、`541/0`、`837/21`、`909/182`、`892/45`、`900/29`（全部在预算内），按 `origin/main` 则是 `2063/203`、`2212/276`、`1514/203`、`3049/287`、`3954/467`、`4796/510`、`5696/535`。
7. 反方向的旁证：#85 在它下面几层合并后被自动 retarget 到 `main`，运行时 base 与声明 base 重合，`PR size` 未经任何代码改动就转绿。

**被推翻的旧假设**

`docs/exec-plan/completed/2026-09-20-rule-checks-pr-base.md` 的 Design 写的是"去掉 `branches: [main]` 之后 `github.base_ref` 恢复成 PR 自己声明的 base"。事实 1–3 直接否证了它：过滤器只负责准入，它不改变 `github.base_ref` 的取值；栈成员的运行时 base 本来就是 `main`。该文件随后由 61d6833 归档到 `completed/`；归档不改变"它的 Design 假设已被反证"这件事，因此仍然就地订正而不是当作历史记录放着（`AGENTS.md` §5：发现事实推翻假设时更新计划，不保护旧结论）。

## Design / Spec

**三个边界，各自单一职责**

| 边界 | 职责 | 不做什么 |
|---|---|---|
| `scripts/resolve-pr-base.mjs`（新增） | 从 stdin 读 PR JSON，校验并输出**判定输入本身**：`base_sha` / `head_sha` 两行（`GITHUB_OUTPUT` 格式） | 不联网、不调用 `gh`、不读事件负载文件——因此可以离线单元测试；不处理 `base.ref`（判定用不到它） |
| `.github/workflows/rule-checks.yml` | **取数与解析分两步**（`gh api` 写 `$RUNNER_TEMP`，解析器从文件读），再把**同一对** SHA 交给一个 matrix job 里的两个检查；取数步骤顺带回显 `base.ref` 这一来源说明，诊断与可达性校验合成一步 | 不做 JSON 解析与校验，不把自由文本拼进 shell；token 不与执行 PR 代码的步骤同环境 |
| `scripts/rule-checks.mjs` | 接受一个 git ref，按 `${base}...HEAD` 判定 | 是（增加可选的显式 head，判定成为两个提交的函数） |

**权威来源**：`GET repos/{owner}/{repo}/pulls/{number}` 的 `base.ref`。它就是 PR 页面与 `baseRefName` 显示的分支；`base.sha` 同时取出，仅作诊断与一致性说明。

**判定输入是一对不可变提交**：`(base_sha, head_sha)`，其中 `base_sha` 取自 API 快照、`head_sha` 取自事件负载。两个顶层 job 的 checkout 都钉在事件 head 上（`resolve-base` 用事件表达式，`checks` 用解析输出），检查 job 在判定前校验 `HEAD == head_sha` 且 `base_sha` 在本地可达，脚本按 `<base_sha>...<head_sha>` 计算三点差异。**两个检查在同一个 matrix job 里**，判定对象校验只写一处——它们不可能各用一份基线或各自漂移。

**订正（2026-09-21，PR #100 评审 P1）**：本节原先写的是「用 `origin/<base.ref>...HEAD`，不固定到 `base.sha`，因为三点差异对 base 前进天然稳健」。那个理由把**性质的范围说宽了**：三点差异只相对于给定的对象对成立，它不保证一个**会移动的** base ref 在时间上代表同一个 PR 状态。base 正常前进（fast-forward）时共同祖先仍在分叉点，结果确实不变——但 base 被 force-push 到无关历史时共同祖先会后退，base 分支自己的提交会被算进这个 PR。回归用例在 `tests/contract/rule-checks.test.js`：同一个 head，固定对象对得到 5 行（正确），移动的 branch tip 得到 1205 行（假红）。因此「判定用 ref tip」这个选择被反转，改为固定到对象；`base.sha` 从诊断字段升为判定输入。

**失败策略**（回答规格里的三个 review 问题）

| 情形 | 行为 |
|---|---|
| `gh api` 非零退出、JSON 不可解析 | 取数步骤 `set -euo pipefail` 直接失败；解析器对空输入也 fail closed，两层都不产出残缺的判定对象 |
| `base.ref` / `base.sha` 缺失、为空、非字符串 | 解析器非零退出，job 失败 |
| `base.ref` 含换行、空格、`..`、前导 `-`、shell 元字符，或不是合法分支名 | 解析器非零退出，job 失败 |
| `base.sha` 不是 40 位十六进制 | 解析器非零退出，job 失败 |
| `base_sha` 或 `head_sha` 在本地不可达 | `resolve-base` 的可达性步骤与检查 job 的身份校验都 `exit 1`；脚本侧另有 exit 3。**不回退 main、`github.base_ref` 或当前的 `origin/<base.ref>`** |
| API 的 `head.sha` 与事件 head 不一致（PR head 在解析期间前移） | 打印 `::warning::`，**不失败**：判定对象是事件 head，这对 `(base_sha, head_sha)` 没有变；硬失败会制造 flaky 红叉 |
| base 分支在运行期间前进或被 force-push | 与本次判定无关：判定用的是快照 `base_sha`，不是当前的 `origin/<base.ref>`。下一次 synchronize / edited 事件用新快照重跑 |

**诊断字段**（都不参与判定）：`github.base_ref`、`github.event.pull_request.base.ref`、API 的 `base.ref` 与 `base.sha`、脚本最终使用的范围。日志必须把它们标成"诊断"，避免复核者再次把 `BASE_REF` 当成权威值。

**被放弃的方案**

| 方案 | 结论 | 原因 |
|---|---|---|
| 继续用 `github.base_ref` | 放弃 | run `35511506461` 直接反证：栈成员的运行时 base 是 `main` |
| 只移除 `branches` 过滤器 | 已做，且**必要但不充分** | 它让 base 非 `main` 的普通 PR（#82/#83）第一次被检查，但改变不了栈成员的运行时 base。订正：规格原文写作"已实测无效"，过于笼统 |
| 用 `HEAD^1` | 放弃 | 依赖 GitHub 生成的测试合并提交结构（实测 #84 的 `HEAD^1` 是 #81 的 merge commit），冲突 PR 可能没有 merge commit，不能稳定代表声明 base |
| 用事件 payload 的 `base.ref` | 仅作诊断 | 对栈成员的取值未实测；不能先假定它与 API base 相同 |
| 把范围固定到 API `base.sha` | **2026-09-21 由评审 P1 反转：改为采用** | 原先担心「force-push 后旧 SHA 不可达会把常规操作变成 job 失败」。这个担心方向错了：`base.sha` 就是解析时刻的分支 tip，正常情况下必然可达；真不可达时说明快照已失效，那时 fail closed 并请人重新触发事件才是正确行为，而「改用当前的 ref tip」恰恰会给出错误的判定。见 Decision Log |
| 单独维护一份 `docs/ci/…-spec.md` | 放弃 | `PLANS.md` §1 与 `AGENTS.md` §3 要求 spec 与 plan 合在同一份 ExecPlan；拆开正是"计划变了、设计说明还在描述旧世界"的成因。规格内容已并入本文件 |

**不变量**

1. 判定输入等于 `(API 的 base.sha, 事件负载的 head.sha)` 这一对不可变提交；任何路径都不得回退到 `main`、`github.base_ref` 或会移动的 `origin/<base.ref>`。
2. API 失败、判定输入（两个 SHA）缺失或形状不对、`base.ref` 含控制字符（会破坏 `$GITHUB_OUTPUT` 的单行）时 job 失败并给出可行动的错误；`base.ref` 形状不常见只提示——它是来源说明，不是判定输入。
3. `size` 与 `disclosure` 使用同一个已解析基线，不各自选择来源（两者在同一个 matrix job 里，校验只写一处）。
4. PR base 非 `main` 时 workflow 仍然运行（`branches` 过滤器保持移除状态）。
5. 判定范围是 `<base_sha>...<head_sha>`（两个不可变提交）；不得改成 `HEAD^1`、两点差异、`origin/main...HEAD`，也不得改成任何会移动的 ref（含当前的 `origin/<base.ref>`）。
6. 诊断输出不泄露 token、完整事件负载或本机路径。
7. `ci.yml` 的触发器与本计划解耦，本次不修改。

## Global Constraints

- 只修改：`.github/workflows/rule-checks.yml`、`scripts/resolve-pr-base.mjs`、`tests/contract/resolve-pr-base.test.js`、`tests/contract/rule-checks.test.js`、`docs/development/ci.md`、`docs/development/repository-rules.md`、`docs/exec-plan/completed/2026-09-20-rule-checks-pr-base.md`、本计划、`docs/README.md`。
- 不新增运行时第三方依赖；只用 Node 内建能力与 runner 自带的 `gh`。workflow 显式声明 `pull-requests: read`（W4 只禁 write）。
- 不把 token、事件全文、本机绝对路径写进日志、提交、PR 或文档；隔离工作区必须在 `.worktrees/<task-slug>/`。
- 不使用 `HEAD^1` 作为判定来源；不修改 `ci.yml`、分支保护、预算数字或 `PR Fast Gate` 名称。
- 解析器的失败分支必须能在离线单元测试里覆盖；真实 API/Actions 证据只作集成门禁。
- W1–W7 与 `node scripts/workflow-check.mjs` 必须继续通过。
- 规模：代码 ≤1000 行、文档 ≤1500 行（`node scripts/rule-checks.mjs size origin/main`）。

## Plan of Work

### Batch 1 · 控制文档（本批）

**最小闭环**：把已发生的反例、被推翻的旧假设、方案取舍与失败策略写成一份自包含的 ExecPlan，让没参与讨论的人能直接实现。
**涉及文件**：本计划、`docs/README.md`
**验证**

    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

期望：机械扫描 exit 0；文档桶在 1500 行内；无 whitespace error。
**回滚**：删除本计划并撤回索引行，不触碰既有实现。

### Batch 2 · API 解析器与离线契约测试

**最小闭环**：一份 PR JSON 进、两行已校验的 `base_sha` / `head_sha` 出；任何异常输入都非零退出。
**涉及文件**：`scripts/resolve-pr-base.mjs`、`tests/contract/resolve-pr-base.test.js`
**验证**

    node --test tests/contract/resolve-pr-base.test.js

期望：正常对象、缺字段、空值、非法 ref（换行/空格/`..`/前导 `-`/元字符）、非 40 位 SHA、非 JSON、空 stdin 各有判别性结果；全部通过。
**回滚**：删除这两个文件。

### Batch 3 · Workflow 接线与双 job 一致性

**最小闭环**：两个检查从同一次解析取值（同一个 matrix job），诊断字段与判定对象在日志里分得开；取数与解析分两步，token 不与执行 PR 代码的步骤同环境。
**涉及文件**：`.github/workflows/rule-checks.yml`、`tests/contract/rule-checks.test.js`
**验证**

    node --test tests/contract/rule-checks.test.js tests/contract/resolve-pr-base.test.js
    node scripts/workflow-check.mjs

期望：契约测试断言 `pull-requests: read`、取数步骤有 `set -euo pipefail` 且持有 token、解析步骤不持有 token、两个顶层 job 的 checkout 都钉在事件 head 上、判定步骤只用两个 SHA、以及 `github.base_ref` 只出现在诊断变量里；`workflow-check` no findings。
**回滚**：还原 workflow 接线与该批测试。

### Batch 4 · 规则文档与旧计划订正

**最小闭环**：文档层面不再有人相信"过滤器决定 `base_ref`"或"栈成员的运行时 base 是父分支"。
**涉及文件**：`docs/development/ci.md`、`docs/development/repository-rules.md`、`docs/exec-plan/completed/2026-09-20-rule-checks-pr-base.md`
**验证**

    git grep -n "钉住\|钉成\|决定 github.base_ref\|恢复成 PR 自己声明的 base" -- docs/
    node scripts/workflow-check.mjs

期望：上一行不再命中旧措辞；订正后的旧计划在 Design / Decision Log / Outcomes 里写明"过滤器只负责准入，栈成员的运行时 base 是 main"，并把验收项 9 的结论记为"已由 run `35511506461` 反证"。
**回滚**：单独 revert 本批文档提交。

### Batch 5 · 真实事件验证与发布前审计

**最小闭环**：用真实运行确认 `Resolve PR base` 与检查 job 打印同一对对象；发布面与规模审计通过。
**验证**

    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    node scripts/workflow-check.mjs
    node --test tests/contract tests/integration tests/e2e
    git diff --check origin/main...HEAD

真实门禁：读某次真实运行的 `Resolve PR base`、`PR size` 与 `Disclosure scan` job 日志，确认三处打印的 `(base_sha, head_sha)` 逐字相同（head `f3c0653` 的 run `35593993975` 已满足；栈成员上的分歧见验收项 5）。**不得**用 `runs` API 的 `pull_requests[].base.ref` 替代运行时日志——那是实时快照，不是运行时的值。
**回滚**：还原 workflow 与脚本改动；文档单独 revert。

### Batch 6 · 评审 P1：把判定固定到不可变对象对

**最小闭环**：判定输入从「一条 base ref + 隐式 HEAD」收敛为 `(base_sha, head_sha)`；两个顶层 job 的 checkout 都钉在事件 head 上，检查 job 在判定前校验对象身份；解析器输出 `head_sha`；脚本接受显式 head；新增「base 被改写到无关历史」的回归用例。
**涉及文件**：`scripts/resolve-pr-base.mjs`、`scripts/rule-checks.mjs`、`.github/workflows/rule-checks.yml`、`tests/contract/resolve-pr-base.test.js`、`tests/contract/rule-checks.test.js`、`docs/development/ci.md`、本计划
**验证**

    node --test tests/contract/resolve-pr-base.test.js tests/contract/rule-checks.test.js
    node scripts/workflow-check.mjs
    node --test tests/contract tests/integration tests/e2e

期望：解析器、rule-checks 与全套测试全绿（命令与实测值见 Outcomes 的证据块）；注入「判定步骤改回 `origin/<base.ref>`」「去掉 checkout 的 `ref: head_sha`」「给解析步骤加 `GH_TOKEN`」「去掉 `resolve-base` 的 checkout ref」四种，每一种都会让「CI 接线」断言变红。
**回滚**：revert 本批提交；判定回到 ref tip——不推荐，那正是 P1 本身。

### Batch 7 · 第二轮评审：证据完整性与 P3 修正

**最小闭环**：head 里每一条被引用为证据的日志都能从该 head 复现；接口契约、测试计数、README 索引与实现一致；累计门控的回归被修掉；token 不与执行 PR 代码的步骤同环境。
**涉及文件**：`docs/exec-plan/active/2026-09-21-rule-checks-api-base.md`、`docs/README.md`、`scripts/rule-checks.mjs`、`tests/contract/rule-checks.test.js`、`tests/contract/resolve-pr-base.test.js`、`.github/workflows/rule-checks.yml`
**验证**

    node --test tests/contract/resolve-pr-base.test.js tests/contract/rule-checks.test.js
    node scripts/workflow-check.mjs
    node --test tests/contract tests/integration tests/e2e
    node scripts/rule-checks.mjs size "$(git rev-parse origin/main)" HEAD | grep -c 栈累计   # 期望 0

**回滚**：按项 revert（P3-1 的修复、凭据分步、checkout 固定各自独立）。

### Batch 8 · 第三轮评审：校验边界、信任前提与文档对齐

**最小闭环**：校验只覆盖判定与输出完整性需要的东西（两个 SHA 硬、`base.ref` 只受单行 output 约束）；文档里的命令、状态与判据都能复现；信任边界写成前提而不是补丁；本轮还补回上一轮被整段丢掉的遗留清单。
**涉及文件**：`scripts/resolve-pr-base.mjs`、`scripts/rule-checks.mjs`、`tests/contract/resolve-pr-base.test.js`、`docs/development/ci.md`、`docs/exec-plan/completed/2026-09-20-rule-checks-pr-base.md`、本计划
**验证**

    node --test tests/contract/resolve-pr-base.test.js tests/contract/rule-checks.test.js
    node scripts/workflow-check.mjs
    node --test tests/contract tests/integration tests/e2e
    git diff --stat f3c0653 HEAD -- .github/workflows/rule-checks.yml scripts/rule-checks.mjs scripts/resolve-pr-base.mjs tests/contract/rule-checks.test.js tests/contract/resolve-pr-base.test.js

期望：测试全绿；`workflow-check` no findings；最后一条输出为空（证据判据限定到本 PR 的文件）。注入「把字符集重新变成硬失败」或「放过控制字符」都会让解析器测试变红。
**回滚**：按项 revert（校验边界、文档对齐各自独立）。

### Batch 9 · 第一性原理重构：解析器的契约只留判定输入

**对齐**：第三轮评审 P3-5 的根因不是"校验太严"，而是**解析器在处理一个判定用不到的值**（`base.ref`）。放宽它的校验只是症状处理；把该值移出契约才是根因。同一个视角下还有两处冗余：`describeBaseline` 与 `size()` 各自持有"解析提交"的默认实现；`readCommit` 与 `resolveRef` 是同一个事实的两个依赖名。
**最小闭环**：解析器的 stdout 只有判定输入（两行 SHA）；`base.ref` 由持有 JSON 的取数步骤回显；"解析提交"的默认实现只定义一次；测试合并掉重复的用例壳。
**涉及文件**：`scripts/resolve-pr-base.mjs`、`scripts/rule-checks.mjs`、`.github/workflows/rule-checks.yml`、`tests/contract/resolve-pr-base.test.js`、`tests/contract/rule-checks.test.js`、`docs/development/ci.md`、本计划
**验证**

    node --test tests/contract/resolve-pr-base.test.js tests/contract/rule-checks.test.js
    node --test tests/contract tests/integration tests/e2e
    node scripts/workflow-check.mjs && ./node_modules/.bin/tsc --noEmit
    node scripts/rule-checks.mjs size origin/main     # 期望：代码 ≤1000、exit 0

**回滚**：整批 revert 即回到 Batch 8 的状态（解析器恢复 `base_ref` 输出、测试恢复逐条用例）。

### Batch 10 · 第四轮评审：步骤顺序、独立锚点与证据刷新

**对齐**：F1 指出新设计引入了一个**旧设计没有的失败模式**——判定对象的来源（API 快照）与本地 clone 的时点错位。根因是**顺序**，不是缺一次重试：`actions/checkout` 的 `fetch-depth: 0` 取的是它执行那一刻的所有分支头（实测 refspec `+refs/heads/*:refs/remotes/origin/*`），而 `base.sha` 是取数那一刻的 tip；两步之间 base 前进（本地变基后强推是常规操作）就会让可达性校验失败、两个 advisory 检查没有结论。
**最小闭环**：取数先于 checkout（此后那次全量 fetch 必然包含刚读到的 tip，且持 token 的步骤执行时工作区是空的）；checks 的身份校验加一个独立于解析器输出的锚点；PR 描述只进入用它的那一格；顺序、锚点与作用域各有断言。
**涉及文件**：`.github/workflows/rule-checks.yml`、`tests/contract/rule-checks.test.js`、本计划
**验证**

    node --test tests/contract/rule-checks.test.js
    node --test tests/contract tests/integration tests/e2e
    node scripts/workflow-check.mjs && node scripts/rule-checks.mjs size origin/main

期望：全绿；三种注入（把取数挪到 checkout 之后、去掉事件锚点、把 PR 描述给两格）各自让接线断言变红。
**回滚**：整批 revert 即回到 Batch 9 的状态。

### Batch 11 · 合并前的第一性原理对抗自查

**方法**：两个**无上下文**的对抗验证者（一个查"判定是否真的量到了它声称量的东西"，一个查"改动对系统其它部分的影响与可提升性"）+ 我自己的一遍第一性原理核查（判定范围、输出标签、触发覆盖、集成面）。三个验证者里有两个因为只读沙箱不能建临时仓库而没能返回结果，需要跑真实 git 的那部分由我自己完成。

**结论**：**没有发现需要改代码的缺陷**；两处文档缺口已补；一处**既存**的文档不一致被记录并交回它自己的 issue。

- 补：`docs/development/ci.md` 原先没有记录"取数先于 checkout"这条承重性质——它是 F1 修复的全部内容，只写在 workflow 注释里。现在机制文档里也写了，并指向钉住它的断言。
- 补：遗留 1 按**结构 / 配置 / 真实运行验证**三类展开（原先只有一句"判定不能由 PR 代码产生"）。
- 记录（不改）：`docs/product/board-semantics.md` 声称 `rule-checks size` 已随 `PR Fast Gate` 成为必需检查，与实际不符（`pnpm verify` 只跑 typecheck + test + test:mvp0；分支保护只要求 `PR Fast Gate`）。那是 issue #48 的论证前提，属于另一件事。
- **被自查杀掉的两个假说**（见 Surprises 22）：`栈累计` 那一行的标签是否名不副实；`disclosure` 的提交列表用两点、树扫描用三点是否不一致。
- 验证为可靠的：没有任何其它自动化依赖被改动的表面（check 名、job id、output 名、旧结构短语）；解析器对空输入 fail closed；当前文档没有残留旧结构描述。

**涉及文件**：`docs/development/ci.md`、本计划

### Batch 12 · 第五轮评审：补全锚点、收准 fork 与顺序的说法

**对齐**：head 锚点有牙，但 **base 锚点缺失**——而 `base_sha` 决定两个检查量的范围。把解析器改成 `base_sha = head_sha`，体量就是 0、披露扫描（diff 与逐提交）就是空，而 `HEAD == HEAD_SHA == EVENT_HEAD_SHA` 与 `cat-file` 两道守卫**都会通过**。根因不是"少一个 if"，而是**判定输入里有一个值只有 PR 代码能提供**。取数步骤本来就握着同一份 JSON、本来就在用 `jq` 读 `.base.ref`，所以补这个锚点几乎零成本。
**最小闭环**：`base_sha` 与 `head_sha` 各有独立于解析器输出的锚点（前者来自不执行 PR 代码的取数步骤，后者来自事件负载）；两个 checkout 取 **base 仓 + `refs/pull/<n>/head`**（同仓与 fork 都成立）；顺序保证的范围写准（本 job 的 clone 是快照的超集，检查 job 十几秒后自己再 fetch 一次）。
**涉及文件**：`.github/workflows/rule-checks.yml`、`tests/contract/rule-checks.test.js`、`scripts/rule-checks.mjs`（JSDoc 归位与函数名订正）、`docs/development/ci.md`、本计划
**验证**

    node --test tests/contract/rule-checks.test.js
    node --test tests/contract tests/integration tests/e2e
    node scripts/workflow-check.mjs && node scripts/rule-checks.mjs size origin/main

期望：全绿；三种注入（删掉 base 锚点、把 `PR_BODY` 的操作数顺序调换、删掉一个 checkout 的 `repository`）各自让接线断言变红。
**回滚**：整批 revert 即回到 Batch 11 的状态。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 解析器对异常输入 fail closed | `node --test tests/contract/resolve-pr-base.test.js` 全绿（见 Outcomes 证据块），覆盖响应不是 PR 对象、两个 SHA 缺失或形状不对、非 JSON、空 stdin、不回显值 | 通过 |
| 2 | 两个检查共享同一基线 | `tests/contract/rule-checks.test.js` 断言：解析 job 的两个判定输入 + 取数步骤的来源说明、matrix 里恰好两个检查、判定步骤只用两个 SHA、`github.base_ref` 只能出现在诊断变量里；四种注入各自让断言变红 | 通过 |
| 3 | 不回退 main | 解析器无 `main` 默认值；把 fail-closed 注入成"回退 main"后 3 条测试变红 | 通过 |
| 4 | 范围是三点差异且相对 API base | 本地对照（PR #94 的历史 head `8c660b06`，当前脚本）：按 API 的 `base.sha`（`86d7812…`）→ `代码：892 / 1000 行`、exit 0；按 `origin/main` → `代码：4796 / 1000 行`、exit 1 | 通过 |
| 5 | 栈成员上的分歧被真实验证 | 前提：先让栈的 base 分支带上本修复（栈成员跑的是自己 merge ref 里的 workflow，base 不含修复时仍跑旧逻辑——#98 那次就是这样，直到 09:28 整体 rebase 才生效）。判据：某次栈成员运行的 `Resolve PR base` 打印的 API base ≠ 诊断里的 `github.base_ref`，且体量等于相对声明 base 的值 | **未兑现**：原定的 7 个 PR 已全部合并，观测对象消失；替代方案见遗留 2 |
| 6 | 既有边界不回归 | `node scripts/workflow-check.mjs` → no findings；`tsc --noEmit` exit 0；全套测试全绿（命令与实测值见 Outcomes 的证据块，本表不再复制数字） | 通过 |
| 7 | 发布面干净 | `disclosure origin/main` exit 0；`git diff --check origin/main...HEAD` 干净；五类目人工核对无命中。**规模**：`size origin/main` → **代码 990 / 1000、命令 exit 0**，不需要豁免 | 通过 |
| 8 | 旧计划的错误假设被就地订正 | `2026-09-20-rule-checks-pr-base.md` 的 Design 第 1 条、不变量 I1 说明、Surprises 1、Decision Log 与验收项 9 均含订正与 run `35511506461` 的反证 | 通过 |
| 9 | 判定输入是不可变对象对 | 接线断言：两个顶层 job 的 checkout 都钉在事件 head 上；判定步骤的 `BASE_SHA` / `HEAD_SHA` 同源于 `resolve-base`；判定步骤里不出现 `origin/`、`HEAD^1`、`github.base_ref` | 通过 |
| 10 | base 被改写到无关历史时结论仍只算本 PR | 真实 git 回归用例：同一个 head，固定对象对 `代码：5 / 1000`（exit 0），移动的 branch tip `代码：1205 / 1000`（exit 1） | 通过 |
| 11 | 判定对象不可达时 fail closed | `resolve-base` 的可达性步骤 + 检查 job 的身份校验 + CLI 用例（base 或 head 不可解析 → exit 3），无 `main` 兜底 | 通过 |
| 12 | 评审 P1 的两个线程都有对应改动 | 代码/测试改动见 Batch 6，选择反转见 Decision Log | 通过 |
| 13 | 第二轮评审的 P2/P3 都有对应改动 | P2-1/P2-2/P3-2/P3-3/P3-6 见 Batch 7 与本次 Outcomes 重写；P3-1 有 before/after 两条真实日志；P3-4/P3-5 有四种注入中的两种对应断言 | 通过 |

## Progress

- [x] (2026-09-21) 复核输入规格的事实主张：PR #94 的 API base/sha、run `35511506461`、job `106080093985`、日志行、compare 提交数（8 / 23）全部属实
- [x] (2026-09-21) 对抗审查输入文档，发现并记录 3 个 P1（本机绝对路径 ×3、spec 与 plan 拆分违反 `PLANS.md` §1、worktree 位于仓库外且 HEAD 非 main 祖先）与若干 P2/P3
- [x] (2026-09-21) 开 issue #99
- [x] (2026-09-21) Batch 1 · 控制文档（`docs/README.md` 索引同步）
- [x] (2026-09-21) Batch 2 · API 解析器与离线契约测试（22 条）
- [x] (2026-09-21) Batch 3 · Workflow 接线与双 job 一致性（新增 3 条接线断言，回退旧接线红 2 条）
- [x] (2026-09-21) Batch 4 · 规则文档与旧计划订正
- [x] (2026-09-21) Batch 5 · 发布前审计（`disclosure` exit 0、`size` 570/280、`diff --check` 干净、五类目无命中）
- [x] (2026-09-21) Batch 6 · 评审 P1：判定固定到不可变对象对（在 head `1940185` 上实测：解析器 22 条、rule-checks 56 条、全套 337 条全绿；四种注入各自让接线断言变红）
- [x] (2026-09-21) Batch 7 · 第二轮评审：证据完整性（P2-1/P2-2）、接口契约与计数（P3-2/P3-3）、README 索引（P3-6）、累计门控回归（P3-1）、凭据与 PR 代码分步（P3-5）、三个 checkout 都钉在事件 head（P3-4）
- [x] (2026-09-21) Batch 8 · 第三轮评审：校验边界收窄（`base.ref` 只受单行 output 约束，形状异常只提示）、`size()` JSDoc 与实现对齐、ci.md 的命令片段改成两步接线、归档计划的状态行与路径声明订正、证据判据限定到本 PR 的文件、信任前提与豁免状态写进 Decision Log、补回被丢掉的遗留清单
- [x] (2026-09-21) Batch 9 · 第一性原理重构：解析器契约只留判定输入（`base.ref` 移出、由取数步骤回显）、"解析提交"的默认实现单源化、`readCommit` 与 `resolveRef` 合并、测试合并同类用例壳（解析器 21→11 条、rule-checks 56→51 条、全套 354→339 条；代码 1114 → 925 → 962 → 994 → 990（压缩与去重），**不需要规模豁免**）
- [x] (2026-09-21) Batch 10 · 第四轮评审：取数步骤前移到 checkout 之前（消除"快照读得比 clone 新"的窗口）、checks 的身份校验加事件锚点、PR 描述只进入 disclosure 那一格、计划里的过期引用与数字副本收敛到证据块，并补三条对应断言
- [x] (2026-09-21) Batch 11 · 合并前对抗自查：两个无上下文验证者 + 我自己一遍第一性原理核查；无代码缺陷，补 `ci.md` 的顺序性质与遗留 1 的结构/配置分类，记录一处既存文档不一致，并杀掉两个自己的假说
- [x] (2026-09-21) Batch 12 · 第五轮评审：补 `base_sha` 的独立锚点（取数步骤用 jq 读 `.base.sha`，判定步骤比对）、两个 checkout 取 base 仓 + `refs/pull/<n>/head`、恢复 fast-forward 情形的断言、`PR_BODY` 断言改成断言完整表达式、顺序保证的范围写准、JSDoc 归位并订正函数名
- [ ] 验收项 5：等出现一个跑本修复的栈成员运行（或按遗留 2 造一个临时 stack）后回读日志，然后归档本计划

## Surprises & Discoveries

1. **过滤器与运行时 base 是两件事，这一点在上一轮被搞错了。** 上一轮的 issue #96 与旧 ExecPlan 都写"`branches: [main]` 同时决定 `github.base_ref` 的取值"，措辞把准入谓词说成了改写者。正确的说法是：过滤器只让 base 为 `main` 的 PR 触发；而**栈成员的运行时 base 本来就是 `main`**。证据：PR #98 合并后，栈内 11 个分支都已无过滤器、`refs/pull/N/merge` 都含 #98 的提交，run `35511506461` 仍打印 `BASE_REF: main`。

2. **同一份 PR 对象上，声明 base 与运行时 base 是两个不同的值。** PR #94 的 API `base.ref=feat/core-start-work`，而同一次运行的 `github.base_ref=main`。判别依据是 `stackEntry`：#80–#81、#84–#88、#92–#95 在 GitHub 原生栈内（position 1–11），#82/#83 不在栈内——不在栈内的两个 PR 的运行时 base 就是它们的声明 base（`chore/workspace-dependency-graph`），且它们正是 #98 之后才第一次被检查的。

3. **`runs` API 的 `pull_requests[].base.ref` / `.head.sha` 是实时快照。** 复核历史运行时基线只能从 `.head_sha` 加 job 日志回显读，否则会得到相反印象。这条已在上一轮的 `docs/development/ci.md` 里记录。

4. **输入的规格文档无法通过仓库自己的披露扫描。** 它的 ExecPlan 含 3 处本机绝对路径（仓库根、隔离 worktree ×2），`scanText` 全部命中"本机家目录路径"。这条在实现前必须修掉——否则本任务的 PR 会在 `Disclosure scan` 上自己红。

5. **输入文档的时间戳比文件系统时间早 5 小时。** 文档自称创建于 `2026-09-21 15:20 CST`，而文件 mtime 是 10:02、当前是 10:06。Progress 与 Decision Log 的时间戳因此不能当证据用；本计划一律以实际执行时间为准。

6. **输入的 spec worktree 的 HEAD 不是 `main` 的祖先。** 它在 `7fdf7af`（PR #80 分支被 rebase merge 前的提交）上 detached，`docs/README.md` 也带着未提交改动。因此那两份文档是在一棵与 `main` 已经分叉的树上写的，不能直接搬运——本计划在从 `origin/main` 新建的 `.worktrees/rule-checks-api-base/` 里重写。

7. **`.worktrees/` 下的工作区缺 `node_modules` 时，手搓的视图会把 workspace 包解析到别的检出。** 用指向主检出 `node_modules/*` 的符号链接凑出一个视图时，`@harness-projects/*` 那些条目是主检出里的 pnpm workspace 链接，会指向**主检出工作区**的包源码：全套测试因此出现 7 条 `does not provide an export named …` 的假红（domain / capabilities / migration-runner）。把 `node_modules/@harness-projects/*` 重新指向本工作区的 `packages/*` 之后全绿（当时 243/243）。教训：在隔离工作区里判断"是不是我改坏了"，先确认 workspace 链接指向的是这个工作区。

8. **`set -euo pipefail` 在这个 workflow 里是承重的，不是风格。** `gh api … | node scripts/resolve-pr-base.mjs >> "$GITHUB_OUTPUT"` 是管道；GitHub 默认的 `bash -e` 不带 `pipefail`，退出码取自右边的解析器，`gh` 的失败会被掩盖成"空输入"。解析器本身也对空输入 fail closed，两层都留着是有意的。

9. **评审 P1：上一版的"三点差异足够稳健"是错的，而且错在把性质的范围说宽了。** 上一版把 `origin/<base.ref>...HEAD` 当判定范围，理由是"三点差异对 base 前进/未 rebase/被 force-push 改写都只算子分支提交"。真实性质更窄：`git diff B...H` 的正确性只相对于**给定的两个对象**成立。base 正常前进时共同祖先仍在分叉点，结论确实不变；但 base 被 force-push 到**无关历史**时共同祖先后退，base 分支自己的提交会被算进这个 PR。实测回归用例（真实 git，`tests/contract/rule-checks.test.js`）：同一个 head，固定对象对得到 `代码：5 / 1000`（exit 0），移动的 branch tip 得到 `代码：1205 / 1000`（exit 1）。修复不是打补丁而是改判定输入：`(base_sha, head_sha)` 两个不可变提交，各 job 显式 checkout 事件 head 并在判定前校验身份。

10. **评审的另一半（"任何 SHA 不一致即 fail closed"）我们只采纳了一半，理由要写清楚。** 那条要求针对的是"用 ref tip 判定"的路径——在那种设计下，tip 与快照不一致意味着判定对象已经变了。既然判定已固定到对象，API head 与事件 head 不一致就不再影响判定：判定对象是事件 head（check run 挂在它上面），PR head 在解析期间前移不改变 `(base_sha, head_sha)`。因此这一条实现为 `::warning::`，硬失败留给"判定对象无法确定"（API 失败、字段缺失或不安全、`base_sha` 不可达）。这是有意的取舍：advisory 检查的误报会让"提升为必需检查"的前置条件永远不成立（§9.2）。

11. **评审提到的 P2（`scripts/rule-checks.mjs` 里过时的基线来源说明）与"路径含空格的既有测试失败"都被正确归位。** 前者已在 `b12cd8c` 修掉并折进本分支的提交序列；后者在本仓库的隔离工作区里必然失败（测试用 `path.resolve('node_modules')` 造符号链接，而 `.worktrees/` 下没有这个目录），评审也把它记为 pre-existing、没有算在本 PR 头上——这与本计划 Surprises 7 的记录一致。

12. **计数会漂移，所以必须与 head 一起记录。** 本计划在三个时刻写过三套测试计数（22 / 29 / 58 / 254 / 243），而实测随合并与去重一直在变（head `1940185` 上是 22 / 56 / 337）。规则：计数必须与"在**哪份代码**上跑"绑定。裸 head SHA 会因为 rebase 或后续文档提交而失配（本轮就撞上两次：引用的 run head 在 rebase 后不是当前 head 的祖先；文档行数在回填后从 355 变成 400），因此锚点用**代码文件逐字节相同**（`git diff <run head> HEAD -- .github scripts tests` 为空）并给出命令；也不再写"新增 N 条"这类会过期的相对量。

13. **被引用为证据的日志必须能从该 head 复现。** 第一轮的 Outcomes 引了一段 `判定来源：PR API base.ref=…`——那是 P1 修复前版本的输出，head 上的 workflow 已经不打印它；引用的 `528ff4e` 也不是当时的 base。这类"历史快照冒充当前证据"正是 `docs/review/mvp-review.md` §1 禁止的。规则：日志引用必须带 run/job id 与 head，并给出复核命令；跨 head 的历史日志要标明它属于哪个 head。

14. **门控写成"比较 ref 名字"会在 CI 里恒真。** CI 传进来的是 40 位 SHA，而 `normalizeBaseRef` 只剥 `origin/`、`refs/heads/` 这类前缀，SHA 永远不等于 `'main'`——于是"栈累计"这一行在每次运行都打印，它本该表达的"这是栈成员"信号随之消失（head `5aa70aa` 的真实日志里能看到；head `1940185` 上出现 0 次）。判据必须是**解析后的提交**，不是字符串。

15. **校验要贴着"这个值被用在哪"，而不是贴着"它看起来像什么"。** 第一版把 `base.ref` 按 git refname 规则严格校验（字符集、`..`、`//`、前导 `-`…），但判定输入其实是两个 SHA，`base.ref` 只进日志与一行 output：那些规则既没有正确性作用，又会让合法的 CJK/`@`/`+` 分支名把 advisory 检查判红（§9.2 说的误报）。收窄后只剩"非空、≤255、无控制字符"（最后一条是 output 完整性：换行会往 `$GITHUB_OUTPUT` 注入额外行），形状异常降级为 `::warning::`。第三轮评审 P3-5。

16. **证据判据必须限定到"你声称的那个东西"。** 本计划与 PR 描述都写过 `git diff <run head> HEAD -- .github scripts tests` 为空——目录级写法会把 main 在两次提交之间新增的文件算进来（实测 5 文件 +787），裸 head SHA 又会因为 rebase 重写而失配。正确判据是列出本 PR 自己的 5 个代码文件。与 Surprises 13 同类：**能被复现的判据必须只包含你真正主张的范围**。第三轮评审 P3-4。

17. **本计划在上一轮被自己削掉过一整节。** 重写 Outcomes 时把「已知需要如实记录的遗留」的 5 条一起替换掉了，只留下标题，而 Batch 7 还引用着"遗留 2"。这说明"用一段新文本覆盖一大段旧文本"这种编辑方式本身就是漂移源；本轮补回清单，并在 Batch 8 的验证里加了"遗留清单非空"的目视检查。

18. **"放宽校验"与"把值移出契约"是两件事，后者才是根因。** 第三轮 P3-5 指出 `base.ref` 被过度限制。第一反应是放宽它的校验（上一轮就是这么做的），但更根本的问题是：解析器在**处理一个判定用不到的值**——它因此需要字符集规则、refname 形状规则、控制字符规则，以及一整套只服务于它的测试。把该值移出契约（由持有 JSON 的取数步骤回显，那一步本来就在读这份 JSON）之后，那些规则全部消失，而且来源说明变成了由**不执行 PR 代码**的步骤打印。同一个动作还顺手回答了 P3-6 的一半：来源说明的可信度不再取决于 PR 代码。

19. **默认值写两遍，等于有一个是假的。** 把 `readCommit` 与 `resolveRef` 合并时，`size()` 的 destructuring 里漏了默认值，`resolveRef(base)` 抛出的 TypeError 被"解析不出来就按不是 main 处理"的 catch 吞掉——栈累计行于是**在每次运行都打印**，正好是上一轮刚修掉的 P3-1 回归换个原因复发。手工跑 `size origin/main | grep -c 栈累计` 才暴露出来（测试全都注入了 `resolveRef`，因此覆盖不到）。修法是默认实现只定义一次（`resolveCommitRef`），并补一条**不注入任何依赖、走真实 git** 的断言。

20. **"快照读"和"clone"有不同的时间点，顺序决定判定对象在不在本地。** 旧设计用 `origin/<base.ref>`，本地解析不出来最多是"量了旧值"；新设计用 API 快照，于是出现一个新的失败模式：clone 建好之后 base 才前进，快照就不在本地了。窗口实测约 7 秒，但触发它的是**常规操作**（本地变基后强推，merge-queue §2.3），后果是 advisory 检查没有结论——正是 §9.2 在意的误报。把取数移到 clone **之前**之后，clone 变成快照的超集，"在不在本地"从时序运气变成结构保证；真正不可达只剩"快照被 force-push 到无关历史"，那时 fail closed 仍然是对的。第四轮评审 F1。

21. **同一个数字写三遍，就有两遍会过期。** 本计划里的测试计数与规模数字在四处出现（Design 表、Batch 期望、验收表、Outcomes），每轮修正都只更新其中一两处——第四轮评审 F2 一次性列出五个不再复现的值（`workflow-check.test.js` 的三处引用、`5 文件`、`pass 337`、`907`、PR 描述里的 `21/56`）。处理不是逐个改数字，而是把**副本收敛到一处**：验收表与 Batch 期望改为指向 Outcomes 的证据块，只在那里写命令与实测值。

22. **对抗自查有一半价值在于杀掉自己的假说。** 我怀疑输出里的 `栈累计（相对 origin/main…）` 名不副实——以为它把 main 自身前进的部分也算进去了。实测：它算的是 `${mainRef}...${head}`，即**三点差异的 head 一侧**，main 自己的新提交不在里面；对"会打印它的情形"（base 不是 main 的 tip）这个标签是准确的。另一条同类的怀疑是 `disclosure` 的提交列表用两点、树扫描用三点会不会不一致——两点给出"head 有而 base 没有的提交"，三点给出"自共同祖先以来 head 的改动"，对冻结对象对两者是同一批改动。两条都**不成立**，如果直接"顺手修掉"，就会把正确的行为改坏。规则：自查发现的可疑点先证伪，再决定改不改。

23. **"提升为必需检查"不是加一行配置。** 系统面自查给出三类前提：结构（结论不能由 PR 代码产生；解析失败必须传播到受保护门禁，而不是止步于 skipped）、配置（required context；启用 merge queue 时还要为 `merge_group` 提供同名状态）、验证（fork / 普通堆叠 / retarget / 快照失效各需一次真实运行）。这条直接决定了本计划归档前该说什么、不该说什么。

24. **只锚住一半输入，等于没锚。** 第四轮按评审建议给 head 加了独立锚点，但 `base_sha` 仍然只有 PR 代码能提供——而它决定两个检查量的范围。把解析器改成 `base_sha = head_sha`，`size()` 量的是 `<head>...<head>`（0 行），`disclosure()` 的 diff 与逐提交扫描都是空的，两道守卫却全部通过。补法是取数步骤（不执行 PR 代码）顺手用 `jq` 读出 `.base.sha`，判定步骤比对两者。没有反过来让取数步骤的值直接当判定输入：比对给出的是同一条保证（不一致就失败），而解析器仍是唯一的判定输入来源，文档与测试契约都不用改写。

25. **子串匹配的断言会给语义错误的接线发通行证。** `PR_BODY` 的断言原先只匹配 `/matrix\.command == 'disclosure'/`。把表达式调换成 `matrix.command == 'disclosure' && '' || github.event.pull_request.body` 之后它**照样通过**——而 GitHub 的 `a && b || c` 在 `b` 为空串时会落到 `c`，于是两格都拿到 PR 描述，F3 那个缺陷原样回来。改成断言完整表达式（它同时钉住操作数顺序），并把这个变体加进注入清单。

26. **"结构保证"要连范围一起说。** 顺序修复的保证是"**resolve-base 这个 job 的** clone 是快照的超集"。检查 job 会在十几秒后自己再 fetch 一次，那个窗口里 base 分支若被删除（本仓库开了 `delete_branch_on_merge`），对象仍可能不可达——同样 fail closed，并由 retarget 触发的下一次事件自愈。原来那句话读起来像全局保证，现在写准了范围。

27. **"把 `repository:` 指向 fork"是把风险换了个位置，不是去掉它。** 第五轮评审指出钉 `ref: <head sha>` 之后 fork 的 head 提交取不到；我的修法是把 `repository:` 指向 fork——结果 fork 的 `main` 往往是旧的，**base 对象**反而不可达，两个检查会永远没有结论。正确取法是 base 仓 + `refs/pull/<n>/head`：这个 ref 在 base 仓里一定存在，head 与 base 对象于是都能取到。教训：换一个取值来源时，要同时检查**它带来的所有对象**是否仍然可得，而不是只看被点名的那一个。

## Decision Log

| 决策 | Rationale | 日期 / 来源 |
|---|---|---|
| 判定基线改用 PR REST API 的 `base.ref` | run `35511506461` 证明运行时 base 与声明 base 不同；API 是权威来源，且能同时取到 `base.sha`（评审 P1 后它从诊断升为判定输入） | 2026-09-21 / issue #99 |
| ~~范围用 `origin/<base.ref>...HEAD`，不固定到 `base.sha`~~ **已反转** | 原理由（三点差异对 base 前进天然稳健）把性质的范围说宽了：三点差异只相对于给定对象对成立，移动 ref 在 force-push 后不代表同一 PR 状态 | 2026-09-21 / 本计划 → **2026-09-21 评审 P1 反转** |
| 判定输入固定为 `(base_sha, head_sha)`，两个检查 job 显式 checkout 到 `head_sha` | 判定是这两个提交的函数；固定后与「运行期间分支是否前进或被改写」无关，结论可复现。回归用例同时跑固定对象对与移动 tip 两种情形 | 2026-09-21 / 评审 P1 |
| API 的 `head.sha` 与事件 head 不一致只 warning，不 fail closed | 判定对象是事件 head（check run 挂在它上面）；PR head 在解析期间前移并不改变 `(base_sha, head_sha)` 这对输入，硬失败只会制造 flaky 红叉。评审给的另一个选项（任何 SHA 不一致即 fail closed）针对的是「用 ref tip 判定」那条路；既然已固定到对象，不一致就不再影响判定 | 2026-09-21 / 本计划（对评审建议的部分采纳） |
| `base_sha` 在本地不可达时 fail closed，不改用当前的 ref tip | 快照失效时没有可信的判定输入；换 ref tip 会重演 P1 的假红。代价是需要重新触发一次事件 | 2026-09-21 / 评审 P1 |
| 解析器独立成 `scripts/resolve-pr-base.mjs`，但**不联网** | JSON 解析与校验用 Node 写可以在单元测试里覆盖失败分支，避免多行 shell 与 quoting 漏洞；把 `gh` 留在 workflow 里，脚本保持离线可测 | 2026-09-21 / 本计划 |
| spec 内容并入本 ExecPlan，不新建 `docs/ci/` | `PLANS.md` §1 与 `AGENTS.md` §3 要求 spec 与 plan 合一；拆开会让设计说明与计划漂移，且 `docs/ci/` 是 `main` 上不存在、索引里也没有的新目录 | 2026-09-21 / 本计划 |
| 累计行的门控改成比较**解析后的提交** | ref 名字比较在 CI 里恒真（传进来的是 SHA），会让这一行在每次运行都出现、丢掉"栈成员"信号；改成提交比较后，`base` 恰是 main tip 时不打印（issue #99 第二轮评审 P3-1） | 2026-09-21 / 评审 P3 |
| 取数与解析拆成两步，token 只留在取数那一步 | 原实现把 `GH_TOKEN` 与执行 PR 代码的解析器放在同一个步骤的环境里。评审建议的"从 base revision 运行解析器"在本 PR 上不可行（脚本正是本 PR 新增的，base 里没有它，自举会失败），拆步骤达到同样效果且保住离线可测的校验器 | 2026-09-21 / 评审 P3-5 + 本计划 |
| 两个检查合并成一个 matrix job | 它们是同一个判定的两种输出，拆成两个 job 会让判定对象校验写两遍、有机会漂移；合并后校验只有一处，检查名仍是 `PR size` / `Disclosure scan` | 2026-09-21 / 本计划 |
| **规模豁免（提议，待人类在合并时接受）**：代码超出 §8 的 1000 行上限（第二轮实测 1068，第三轮修正后 1114；数字随每轮修正增长，以合并时实测为准） | 超出部分全部来自三轮评审驱动的修正与它们的判别性测试（P1 的冻结对象对与回归用例、P3-1 的门控修复与用例、P3-4/P3-5 的接线修正、P3-2 的 JSDoc 对齐、P3-5 的校验边界收窄与两个方向的注入用例）。已做两轮真实去重（身份校验并入判定步骤、两个检查合并为 matrix、CLI 用例表驱动、重复理由压成指向 `ci.md` 的指针），仍有约一成超出。两条替代路径都被否决：拆成 follow-up PR 会把本 PR 自己引入的 P3-1 回归留在已合并代码里；继续删测试或注释会削掉判别力与"为什么"。`Rule checks` 自己的说明写着 §8.3 的上限"是工程判断而不是物理约束……让它可见、需要解释" | 2026-09-21 / 评审第二轮 + 本计划 |
| `base.ref` 的校验收窄到"能否安全写成一行 output" | 判定输入是两个 SHA；ref 只进日志与 `base_ref=` 一行，既不到 shell 也不到 git。按 refname 规则严格校验会让合法分支名把 advisory 检查判红（第三轮评审 P3-5）。硬约束保留三条：非空、≤255、无控制字符；形状异常只 `::warning::` | 2026-09-21 / 评审 P3-5 |
| 信任边界写成**前提**，不写成补丁 | 两个检查都执行 PR 代码，因此结论是"来源"而不是"信任"：改写解析器或检查器的 PR 能让自己变绿。评审建议"合并后把解析器钉到 base revision"只堵住一半（检查器 `rule-checks.mjs` 仍是 PR 代码），所以不采用该补丁，改为记录**提升为必需检查的前置条件**：判定结论不能由 PR 代码产生（仓库对必需检查的既有答案是 `ci.yml` 的 `fast-gate`） | 2026-09-21 / 评审 P3-6 + 本计划 |
| 给 `base_sha` 补独立锚点 | head 有锚点而 base 没有，等于只守了一半：base 决定两个检查量的范围，把它改成 head 就能让两个检查在零内容上变绿（第五轮评审）。取数步骤本来就用 jq 读同一份 JSON，补 `.base.sha` 几乎零成本；判定步骤比对两者，解析器仍是唯一的判定输入来源 | 2026-09-21 / 评审第五轮 |
| ~~两个 checkout 显式取 fork 的仓库~~ **已撤回，改为 base 仓 + `refs/pull/<n>/head`** | 上一版以为把 `repository:` 指向 fork 就"把风险去掉了"，方向反了：fork 的 `main` 往往是旧的，于是不可达的是 **base 对象**，两个检查会**永远**没有结论——比它想替换掉的那条"未验证的 fail closed"更糟。`refs/pull/<n>/head` 在 base 仓里一定存在（fork 来源的 PR 也有）：head 由它带来，base 由 base 仓的分支头带来；也不依赖"base 仓能否按裸 SHA 提供 fork 的 head 提交"这个未证实的前提。代价是 checkout 拿到的是**当前** head，前移时由身份校验 fail closed、并由下一次事件（同一 concurrency group）取代 | 2026-09-21 / 用户指正 + 本计划 |
| 恢复 fast-forward 情形的断言 | 合并用例壳时把"base 前进"那条真实 git 用例删掉了，而 `ci.md` 仍声称它存在——正是 F2 那一类。没有恢复 40 行的独立用例，而是在既有的真实 git 用例里加 8 行断言（冻结快照在 base 前进后仍是分叉点） | 2026-09-21 / 评审第五轮 |
| 取数步骤前移到 `actions/checkout` 之前 | 顺序是这条性质的载体：checkout 取的是它执行那一刻的分支头，而 `base.sha` 是取数那一刻的 tip，反过来写会让常规的 base 前进变成"判定对象不在本地"（F1）。没有采用"失败后 `git fetch` 重试"：顺序正确之后剩下的不可达只可能是快照真的失效，那时 fail closed 才是对的；顺带持 token 的步骤执行时工作区是空的 | 2026-09-21 / 评审 F1 |
| checks 的身份校验加事件锚点 | 原来只比 `HEAD == HEAD_SHA`，而 `HEAD_SHA` 来自解析器输出，对解析器自身是恒真的。加 `EVENT_HEAD_SHA`（事件负载）之后，"解析器诚实地搞错了 head"也会暴露；恶意 PR 自证仍属遗留 1 的前提 | 2026-09-21 / 评审 F4 + 可选加固 |
| 计划里的数字副本收敛到证据块 | 同一个数字写三遍就有两遍会过期（F2 一次列出五个）。验收表与 Batch 期望不再复制计数，只指向 Outcomes 的证据块 | 2026-09-21 / 评审 F2 |
| 解析器的契约只留判定输入（`base.ref` 移出） | P3-5 的根因是"处理了判定用不到的值"，不是"校验太严"。移出后字符集/refname/控制字符三套规则与其测试整体消失，来源说明改由不执行 PR 代码的取数步骤回显 | 2026-09-21 / 评审 P3-5 + 本计划 |
| ~~规模豁免（提议，待人类在合并时接受）~~ **已撤回** | 第一性原理重构后代码降到 1000 行以内（Batch 9 的 925，Batch 10 后 962）、`size` exit 0，豁免不再需要。保留此条以记录它曾被提出过、以及它是怎么被消掉的（不是靠删测试，而是靠移出一个不该在契约里的值 + 合并同类用例壳） | 2026-09-21 / Batch 9 |
| 规模豁免的状态是**待人类在合并时显式接受** | 评审指出 §8 是仓库规则，超限必须由人在合并时确认，而不是继承一个红叉。本计划与 PR 描述都写成"已记豁免"，因此补明：豁免是**提议**，接受动作发生在合并评论里 | 2026-09-21 / 评审 P2-1 |
| 就地订正 `2026-09-20-rule-checks-pr-base.md` | 它的 Design 假设已被反证（`AGENTS.md` §5 要求更新计划而不是保留旧结论）；文件随后被 61d6833 归档到 `completed/`，订正随之落在新路径上 | 2026-09-21 / 本计划 |
| 本次不修改 `ci.yml` | 与上一轮一致：触发器放开会同时改变运行次数与门禁覆盖面，属于独立决策 | 2026-09-21 / 用户此前决定 |

## Idempotence and Recovery

- 文档批次可重复执行；`disclosure` / `size` / `workflow-check` / `git diff --check` 都是只读，可任意次重跑。
- 解析器与契约测试是纯函数加离线数据源，不写外部状态。
- 唯一的远端副作用是 push 分支与开 PR；撤回方式是关闭 PR 并删除远端分支（破坏性操作，交给 `git-expert-operations` 流程并由人类确认）。
- 失败模式与动作：若 Batch 3 之后 `workflow-check` 报 W4，说明 `pull-requests: read` 被写成了 write 或漏了顶层 `permissions`；若 Batch 5 的真实运行仍显示 `origin/main`，先核对 job 日志里的 API base 与 `steps.*.outputs`，再回退 Batch 3 的接线，不要改判定范围。
- 回到已知良好状态：`git switch main` 即回到 `528ff4e`；本分支按批次分提交，可单独 revert。

## Interfaces and Dependencies

- **依赖**：GitHub Actions `pull_request` 事件、`github.event.pull_request.number`、runner 自带的 `gh`（配 `GH_TOKEN: ${{ github.token }}`）、`pull-requests: read` 权限、`actions/checkout` 的完整历史（`fetch-depth: 0`，已具备）、现有 `scripts/rule-checks.mjs` CLI。
- **workflow ↔ 解析器契约**：PR JSON 经 stdin 进入；stdout 输出 `base_sha=<sha>` / `head_sha=<sha>` 两行（`GITHUB_OUTPUT` 格式）；非零退出表示解析失败。取数步骤写 `$RUNNER_TEMP/pr.json` 并回显 `api_base_ref`（去掉控制字符后写一行 output），解析步骤从该文件读——token 不进入执行 PR 代码的步骤。
- **workflow ↔ 脚本契约**：`BASE_SHA` 与 `HEAD_SHA` 两个环境变量传判定对象对，脚本按 `<BASE_SHA>...<HEAD_SHA>` 判定；脚本不读事件负载文件，也不知道来源。`BASE_REF` 只作为诊断标签出现在 `resolve-base` 的日志步骤里。
- **命名契约**：`resolve-base` 的输出是 `base_sha` / `head_sha` / `api_base_ref`（前两个是判定输入，第三个是来源说明）；判定步骤的环境变量是 `COMMAND` / `BASE_SHA` / `HEAD_SHA`；诊断变量名 `EVENT_BASE_REF` / `EVENT_PAYLOAD_BASE_REF`，避免与判定来源混淆。
- **工具**：`gh` CLI 只用于交付步骤与 workflow 内的 API 读取，不进入 `scripts/rule-checks.mjs`。

## Outcomes & Retrospective

实现完成，验收项 1–4 与 6–13 通过；**第 5 项（栈成员上的分歧被真实验证）未兑现**，原因与出路见遗留 2。提交序列是：控制文档 → 解析器与契约测试 → workflow 接线与接线断言 → 脚本接受显式 head → 文档与旧计划订正 → 各轮评审的修正回填。这里刻意不写提交总数：它随每轮修正变化（与 Surprises 12 同一条纪律）。

**真实 CI 证据（run `35593993975`，其 head 为 `f3c0653`）**。该 head 与本计划所述实现的**代码文件逐字节相同**，判据必须**限定到本 PR 自己的文件**：

    git diff --stat f3c0653 HEAD -- .github/workflows/rule-checks.yml scripts/rule-checks.mjs scripts/resolve-pr-base.mjs tests/contract/rule-checks.test.js tests/contract/resolve-pr-base.test.js   # 期望：空

目录级写法（`-- .github scripts tests`）会把别人新增的文件算进来，裸 head SHA 又会因为 rebase 重写而失配——本计划与 PR 描述初稿两处都写错过（第三轮评审 P3-4）。判定对象对也不随文档提交改变：判定是两个不可变提交的函数。复核命令：`gh api --allow-escape-sequences repos/SingularityKChen/harness-projects/actions/jobs/<job>/logs`。

```
Resolve PR base（job 106314520939）
  诊断（不参与判定）：github.base_ref=main
  诊断（不参与判定）：github.event.pull_request.base.ref=main
  诊断（不参与判定）：API base.ref=main
  判定对象：base eba9c7412e8f9d450f36b6c598adb2be2f0985df ... head f3c0653953b27a0885eb3a382d9d4fd1d45a70e2（两个都是不可变提交）

PR size（job 106314582842）
  判定对象：eba9c7412e8f9d450f36b6c598adb2be2f0985df @ eba9c7412e8f · head f3c0653953b27a0885eb3a382d9d4fd1d45a70e2 @ f3c0653953b2
  代码：990 / 1000 行（增删之和）
  文档：551 / 1500 行（增删之和）

Disclosure scan（job 106314582838）
  判定对象：eba9c7412e8f9d450f36b6c598adb2be2f0985df @ eba9c7412e8f · head f3c0653953b27a0885eb3a382d9d4fd1d45a70e2 @ f3c0653953b2
  机械扫描通过，覆盖范围：对 base 的新增行、范围内每个提交单独引入的新增行、
```

三处打印的是**同一对** SHA。这次运行本身也证明了取法可用：checkout 用 `refs/pull/100/head` 成功（同仓 PR 与 fork PR 都会走同一条 ref）。同一 job 的日志分组顺序还能证明 Batch 10 的顺序修复：`##[group]Run set -euo pipefail`（取数）出现在 `##[group]Run actions/checkout@…` **之前**；`PR size` 的日志里没有 PR 描述，`Disclosure scan` 里有——`PR_BODY` 只给了用它的那一格。本 PR 不是栈成员，所以三个诊断值一致——这正是预期；栈成员的分歧只能在栈成员运行上观察（验收项 5）。**规模**：代码 **990 / 1000**（该 head 的 `PR size` 是绿的），第二轮提出的规模豁免**已撤回**（见 Decision Log）。消掉它的方式不是删测试，而是把判定用不到的值（`base.ref`）移出解析器契约、合并同类用例壳。文档桶的数值见上面的证据块，不在这里重复。

**P3-1 的 before/after（同一检查的两条真实日志）**

```
head 5aa70aa（job 106206687961）——修复前，累计行与判定值逐字重复
  代码：996 / 1000 行（增删之和）
  栈累计（相对 origin/main，仅记录，不计入判定）：代码 996 行、文档 355 行

head 1940185（job 106228667863）——修复后，该行出现 0 次
  代码：1068 / 1000 行（增删之和）
  文档：355 / 1500 行（增删之和）
```

**核心对照（本地，当前脚本，PR #94 的历史 head `8c660b06`）**——历史对象只用于展示"相对声明 base"与"相对 main"的差别，不是 CI 日志：

```
$ node scripts/rule-checks.mjs size 86d78121193ae3a65b5ba452ccfe6d6bf5404a23 8c660b06050e...
判定对象：86d78121193ae3a65b5ba452ccfe6d6bf5404a23 @ 86d78121193a · head 8c660b06050e... @ 8c660b06050e
代码：892 / 1000 行（增删之和）
文档：45 / 1500 行（增删之和）
栈累计（相对 origin/main，仅记录，不计入判定）：代码 4796 行、文档 510 行
$ echo $?
0

$ node scripts/rule-checks.mjs size origin/main 8c660b06050e...
判定对象：origin/main @ 61d68330611f · head 8c660b06050e... @ 8c660b06050e
代码：4796 / 1000 行（增删之和）
::error::代码改动 4796 行，超过 AGENTS.md §8 的 1000 行上限
```

与输入规格的偏差（都记在 Decision Log）：spec 并入本计划而不新建 `docs/ci/`；判定输入固定为 `(base_sha, head_sha)`；接线断言放在 `tests/contract/rule-checks.test.js`（与既有的「CI 接线」测试同处）而不是 `workflow-check.test.js`；两个检查合并为一个 matrix job；输入文档的 3 处本机绝对路径与未来时间戳在并入时删除。

已知需要如实记录的遗留：

1. **提升为必需检查的前置条件**（第四轮评审与本次对抗自查的共同结论，按结构/配置分开）：
   - **结构**：判定结论由 PR 代码产生（解析器与检查器都来自 PR checkout），因此它是**来源**而非信任边界——要提升，先让判定结论不经过 PR 代码（`ci.yml` 的 `fast-gate` 就是这种形状）。第三轮评审 P3-6。
   - **结构**：`resolve-base` 失败时两个检查是**被跳过**而不是变红，而唯一必需检查 `PR Fast Gate` 只 `needs: [verify]`，因此存在"必需门禁绿、Rule checks 没有结论"的路径。要提升，失败必须通过受保护的聚合门禁传播成 failure，而不是止步于 skipped。第四轮评审（系统面）。
   - **配置**：分支保护增加稳定的 required context；若将来启用 merge queue，还要为 `merge_group` 事件提供同名状态（本 workflow 目前不声明该触发器）。
   - **真实运行验证**：fork 来源、普通堆叠、retarget、API 快照失效各需要一次真实运行——本计划只覆盖了本仓库当前的形状。
   - **相邻的既存不一致（不在本 PR 范围）**：`docs/product/board-semantics.md` 声称 `rule-checks size` "进 `pnpm verify`，随 `PR Fast Gate` 成为必需检查"，与实际不符（`pnpm verify` 只跑 typecheck + test + test:mvp0，分支保护只要求 `PR Fast Gate`）。那是 issue #48 论证的前提，需要单独处理；本 PR 不改它。
2. **验收项 5 未兑现**：原定的 7 个栈内 PR 已全部合并，观测对象消失。可行性补充：非分歧情形（运行时 base 等于声明 base）可以由 #106/#107/#108 这类 base 为 `test/e1-*` 的普通堆叠 PR 在合并后验证——它们会走到新路径（旧路径对它们本来也对，所以这是"不得回归"的那一半）；**分歧情形**仍需要一个 `stackEntry` 成员。本 PR 自己不是栈成员，其运行的三个诊断值一致，证明不了分歧。两条出路：(a) 等下一个真实栈成员运行（其 base 分支需已带上本修复）；(b) 造一个临时的两级 stack（分支带上本修复）跑一次真实栈成员运行再删除——它满足"至少一个真实栈成员运行"，但会在公开仓库留下已关闭的 PR 记录，需要人类伙伴点头。在那之前不声称"栈上的体量检查已经修好"。
3. ~~规模豁免待人类接受~~ **已撤回**：Batch 9 重构后代码已回到 1000 行以内（后续批次 962 → 994 → 990）、`size` exit 0，不需要豁免。若后续评审再引入代码，先按同一视角找"不该在契约里的东西"，而不是先申请豁免。
4. `ci.yml` 仍以 `branches: [main]` 约束 `pull_request`；非栈、base 非 `main` 的 PR 拿不到 `Verify` / `PR Fast Gate`（栈成员因为运行时 base 是 `main` 反而有）。是否放开是独立决策。
5. `pull_request` workflow 不会因为 base 分支自身前进而重跑；API 快照只在该 run 内有效，结论陈旧时以最新 run 为准。
6. `resolve-base` 失败表现为"它红 + 检查被跳过"，而不是检查各自红。"跳过"在这里等于"没有结论"，不是"通过"。
7. fork 来源的 PR：**base 仓 + `refs/pull/<n>/head`** 是唯一对同仓与 fork 都成立的取法。上一版把 `repository:` 指向 fork，方向反了——fork 的 `main` 往往是旧的，于是**base 对象**不可达，检查会**永远**没有结论（不是偶发 fail closed，是持续无结论）。`refs/pull/<n>/head` 在 base 仓里一定存在（fork PR 也有）。代价是 checkout 拿到的是**当前** head：若它在事件与 checkout 之间前移，身份校验会 fail closed，并由下一次事件（同一 concurrency group）取代。本仓库目前没有 fork PR，这条路径仍未有真实运行验证。

## Bottom Change Note

- 2026-09-21：创建。合并输入规格的 Design 与 Plan（`PLANS.md` §1），修掉输入文档的 3 处本机绝对路径与未来时间戳，订正"只移除过滤器"的结论为"必要但不充分"，回答规格里的三个 review 问题（范围用 ref tip、`base.sha` 只做诊断、解析器独立且离线），并新增 Batch 4 就地订正旧计划。
- 2026-09-21：**按 PR #100 评审 P1 做根因修复**。判定输入从「base ref + 隐式 HEAD」改为不可变对象对 `(base_sha, head_sha)`：解析器多输出 `head_sha` 并把事件 head 当硬输入、API head 降为交叉核对；两个检查 job 显式 `ref: head_sha` 并校验 `HEAD == head_sha` 与 `base_sha` 可达；`rule-checks.mjs` 接受显式 head；新增"base 被改写到无关历史"的真实 git 回归用例；`docs/development/ci.md` 订正"三点差异足够稳健"的过宽论断；Design、放弃方案表与 Decision Log 记下这次选择反转。验收表补第 9–12 项，验收项 5 当时按评审要求记为证据门禁（该措辞在第三轮被订正：它是**合并后的验收步骤**，见 P2-2 与遗留 2）。
- 2026-09-21：**按 PR #100 第二轮评审做修正**（Batch 7）。证据完整性：Outcomes 重写为可复现的当前 head 日志（带 run/job id 与复核命令），验收项 5 从自相矛盾的"合并前证据门禁"改成"未兑现 + 两条出路 + 回滚触发条件"；接口契约改成三个 output；所有计数改成"head + 命令 + 实测值"；README 把已归档的那行移到 Completed 表。代码：累计门控改成比较解析后的提交（P3-1 回归，附 before/after 两条真实日志）、取数与解析分步使 token 不进入执行 PR 代码的步骤（P3-5）、三个 checkout 都钉在事件 head（P3-4）、两个检查合并为一个 matrix job；规模超限按 Decision Log 的豁免条记录。
- 2026-09-21：**按 PR #100 第三轮评审修正**（Batch 8）。校验边界收窄：`base.ref` 只受"能否安全写成一行 output"的硬约束（非空、≤255、无控制字符），字符集与 refname 形状异常降级为 `::warning::`——判定输入是两个 SHA，按 refname 严格校验只会让合法分支名把 advisory 检查判红（P3-5）。文档对齐：ci.md 的命令片段改成两步接线并补上 `EVENT_HEAD_SHA`（P3-1）、`size()` 的 JSDoc 与实现一致（P3-2）、归档计划的状态行与"仍留在 `active/`"的假声明订正（P3-3）、证据判据限定到本 PR 自己的 5 个代码文件（P3-4）。信任边界写成**前提**（提升为必需检查要求判定结论不经过 PR 代码，P3-6）；规模豁免标记为**待人类在合并时显式接受**（P2-1）；补回上一轮被整段丢掉的遗留清单（Surprises 17）。
- 2026-09-21：**第一性原理重构**（Batch 9）。第三轮 P3-5 的根因不是"校验太严"而是"解析器在处理判定用不到的值"，因此把 `base.ref` 移出解析器契约（改由持有 JSON 的取数步骤回显，且那一步不执行 PR 代码）：`refProblems` / `refWarnings` / 字符集与 refname 规则及其测试整体消失。同时把"解析提交"的默认实现单源化（`resolveCommitRef`）并合并 `readCommit` / `resolveRef`——合并时曾漏掉 `size()` 的默认值，导致栈累计行换个原因复发，已由一条**不注入依赖、走真实 git** 的断言钉住。测试按"同一条性质只留一个用例壳"合并：解析器 21→11 条、rule-checks 56→51 条、全套 354→339 条。代码 1114 → **925 / 1000**，规模豁免撤回。
- 2026-09-21：**按 PR #100 第四轮评审修正**（Batch 10）。F1：取数步骤前移到 `actions/checkout` 之前——checkout 的 `fetch-depth: 0` 取的是执行那一刻的分支头，而 `base.sha` 是取数那一刻的 tip，顺序反过来时常规的 base 前进会让判定对象不在本地、两个 advisory 检查没有结论（旧设计没有这个失败模式）。F3：`PR_BODY` 只给 disclosure 那一格，避免整段 PR 描述被 GitHub 打进 `PR size` 的公开日志。F4：补三条断言（取数早于 checkout、持 token 的步骤不执行 PR 代码、工作树与事件 head 比对）。另按评审的可选加固，把 checks 的身份校验锚到 `github.event.pull_request.head.sha`；按 F2 修掉计划里五处不再复现的值，并把数字副本收敛到 Outcomes 的证据块（Surprises 21）。
- 2026-09-21：**合并前第一性原理对抗自查**（Batch 11）。两个无上下文验证者（判定语义 / 系统集成与可提升性）+ 我自己一遍核查。结论：无代码缺陷；补 `ci.md` 的"取数先于 checkout"性质（原先只在 workflow 注释里）、把遗留 1 按结构/配置/验证展开；记录 `docs/product/board-semantics.md` 关于 `rule-checks size` 是必需检查的**既存**错误声明（不属于本 PR，交回它自己的 issue）。另杀掉两个我自己的假说（`栈累计` 标签、两点与三点混用），见 Surprises 22。
- 2026-09-21：**按 PR #100 第五轮评审修正**（Batch 12）。补 `base_sha` 的独立锚点（head 有锚点而 base 没有，等于只守一半：base 决定两个检查量的范围）；两个 checkout 取 base 仓 + `refs/pull/<n>/head`；恢复"base 前进"情形的断言（合并用例壳时误删，而 ci.md 仍声称存在）；`PR_BODY` 的断言从子串匹配改成完整表达式（子串版会给操作数调换的错误接线发通行证）；顺序保证的范围写准；`describeBaseline` 的 JSDoc 归位并订正函数名；删掉没人消费的 `api_base_ref` job output。代码 994 / 1000。
- 2026-09-21：**订正 Batch 12 的 fork 取法**（用户指正）。上一版把两个 checkout 的 `repository:` 指向 fork，方向反了：fork 的 `main` 往往是旧的，不可达的是 **base 对象**，两个检查会永远没有结论。改为 **base 仓 + `refs/pull/<n>/head`**（该 ref 在 base 仓里一定存在，fork PR 也有），并撤回"加 `repository:` 就把风险去掉了"的结论；测试里那条把旧接线钉死的断言同时改成钉新接线（两种旧接线注入都会变红）。
- 2026-09-21：实现完成并回填。验收 1–4、6–8 通过（当时实测：解析器 22 条、接线断言 3 条、全套 243/243、`workflow-check` no findings、`disclosure` exit 0、`size` 570/280），验收项 5 待合并后的真实运行；新增 Surprises 7–8（工作区 workspace 链接指向别的检出会造成假红；`pipefail` 在这个 workflow 里是承重的）与 Outcomes（含同 head 的 892 与 4796 对照、5 条遗留）。
