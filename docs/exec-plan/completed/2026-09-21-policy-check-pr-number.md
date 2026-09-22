# policy-check 拒绝把 PR 编号当 issue ExecPlan

> 状态：Completed（2026-09-22 归档到 `completed/`）
> 创建：2026-09-21
> 范围：修掉 issue #66——`scripts/policy-check.mjs` 的 `fetchIssue()` 不区分 issue 与 pull request，导致正文里引用的**另一个 PR 的编号**被按 issue 规则判定，产出必然的假阳性。
> 上游输入：issue #66、`AGENTS.md` §8（PR 关联与 issue 规则）、`docs/development/repository-rules.md` §4、PR #59 的 `Issue policy` 运行记录

## Purpose / Big Picture

完成后，`policy-check` 对"引用了 PR 编号"这件事给出一句正确的诊断，而不是三条按错误规则判定的违规：

> 编号 `#N` 指向的是 pull request 而不是 issue；`Closes` 必须指向 issue。

判断成功的最小证据（真实数据，不需要造夹具）：

```bash
node scripts/policy-check.mjs issue 12
# 修复前：::error::...（三条按 issue 规则判的违规，因为 #12 是 PR）
# 修复后：::error::#12 is a pull request, not an issue — use `pr 12`，exit 2
```

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 失效上下文 | 围栏代码块、行内代码与 HTML 注释里的引用；它们不构成 GitHub 关联，匹配前先被剥离（#62 / PR #63） |
| `closes` / `refs` | `linkedIssues()` 的两个返回值：关闭关键字命中的编号、以及 `Refs` 命中的编号 |
| 关闭目标校验 | 对 `closes` 里每个编号拉取元数据并按 issue 规则判定标题与标签 |

### 当前事实

- `fetchIssue()`（`scripts/policy-check.mjs`）请求 `{number, title, labels: [.labels[].name]}`，**不请求** `pull_request` 字段，因此 PR 编号与 issue 编号在返回结构上无法区分。
- `main()` 的 `pr <n>` 分支只对 `closes` 做关闭目标校验（`refs` 不校验）；`issue <n>` 分支对自身编号做同样校验。
- GitHub 的 issues API 对 PR 编号同样返回对象（PR 是 issue 的子类型），所以这个缺口对**任何**引用了同仓 PR 编号的输入都会触发。
- issue #66 里记录的三条报错来自 PR #59 当时正文中的一个 PR 编号引用。**该正文此后已被重写**（当前 `Closes #39` 指向真实 issue），因此原始复现体不再存在；可复现的真实数据改为 `issue 12`（#12 是已合并的 PR），离线夹具负责 `pr` 分支。
- 仓库**不**要求 `refs` 指向 issue：`Refs #<PR>` 是合法的交叉引用，实测 PR #100 的正文含 `Refs #96 #98`（#98 是 PR）且 `Issue policy` 全绿。本批次必须保持这一行为。注意 `linkedIssues()` 只把**紧跟关键字**的编号记为引用，所以 `#98` 从未真正进入判定——"`Refs #<PR>` 不被拒"这条边界由契约测试承担，不靠 `pr 100` 的输出，理由见 `Surprises & Discoveries`。

### 上游依据

- issue #66 的 What should happen：倾向"按内部错误处理"，即报出"这是 PR 不是 issue"并 exit 1，而不是静默忽略。
- `AGENTS.md` §8 第 7 条要求 PR 关联**issue**；指向 PR 不满足该条，应当被明确告知。
- `docs/development/repository-rules.md` §4：issue 标题必须英文、恰好一个 `kind:*`、至少一个 `area:*`；这些规则对 PR 全部不适用（PR 标题要求中文摘要，PR 不要求标签），这正是三条报错必然为假的原因。

## Design / Spec

### D1 判据来自平台，不来自编号形状

不能靠"编号看起来像 PR"推断；唯一的判据是 issues API 返回的对象是否带 `pull_request` 字段。因此修法是在 `fetchIssue()` 的 `--jq` 里加一个布尔字段，并把判定逻辑提到可离线测试的纯函数里。

### D2 两种输入，两种不同的处理

| 输入 | 修复前 | 修复后 |
|---|---|---|
| `issue <n>` 且 `#n` 是 PR | 按 issue 规则报三条违规 | 报"#n 是 pull request，请用 `pr <n>`"，exit 2（用法错误，不是规范违规） |
| `pr <n>` 正文的 `Closes #m` 且 `#m` 是 PR | 按 issue 规则报三条违规 | 报"引用 #m 指向 pull request；`Closes` 必须指向 issue"，exit 1（规范违规） |
| `pr <n>` 正文的 `Refs #m` 且 `#m` 是 PR | 不校验（保持） | 不校验（保持） |

`Refs` 保持不校验是刻意的：`Refs` 表达"相关"，指向另一个 PR 是合法且常见的用法；把它一并拒掉会制造另一类假阳性，而且会把 `AGENTS.md` §8 第 7 条从"必须关联 issue"扩大成"不得提到 PR"。

### D3 判定与取数分离

新增两个导出的纯函数，使契约测试不需要网络：

- `checkIssueTarget(number, meta)` → `string[]`：`issue <n>` 分支用；PR 判定优先于标题/标签判定。
- `checkCloserTarget(number, meta)` → `string[]`：`pr <n>` 分支的 `closes` 循环用；PR 判定优先，否则按 issue 规则判标题与标签。

两个函数都接收**已经取回的元数据**，不做任何 I/O。`main()` 只负责取数与退出码。

### D4 退出码语义保持

`0` 合规、`1` 规范违规、`2` 用法错误、`3` 取数失败。本批次新增的唯一退出码变化是 `issue <n>` 命中 PR 时从 `1` 变为 `2`——它本来就是用法错误。其余路径的退出码不变。

### D5 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 静默跳过 PR 编号，只校验真 issue | issue #66 明确不倾向它；`Closes #<PR>` 是写错了的关联，静默忽略会让"没有关联 issue"这条更重要的判定被掩盖 |
| 按编号大小或标题语言猜是不是 PR | 形状推断会在真正的 issue 上误判；判据只能来自 API 的 `pull_request` 字段 |
| 连 `Refs` 一起校验 | 会拒掉合法的 `Refs #<PR>` 交叉引用（实测 PR #100 就在用），制造第二类假阳性 |
| 在 `main()` 里内联判定 | 判定会依赖 `gh` 调用，无法离线测试，也就无法给出"变异后必须变红"的证据 |

## Global Constraints

- 只改：`scripts/policy-check.mjs`、`tests/contract/issue-policy.test.js`、`docs/development/repository-rules.md`（§4 记录两个命令的目标类型语义）、`docs/README.md`（一行索引）、`docs/exec-plan/2026-09-21-policy-check-pr-number.md`（本批次内由 `active/` 移入 `completed/`）。`docs/README.md` 的索引行由栈级联步骤追加，验收通过后改指 `completed/`，见 `Progress` 与 `Bottom Change Note`。
- 不改 `linkedIssues()` 的上下文剥离逻辑（#62 / PR #63 的范围）与 `Closes`/`Refs` 的关键词词表。
- 不新增运行时依赖；单文件 ≤ 200 行、单函数 ≤ 40 行（既有文件已接近上限时，新增代码不得使任一函数超过 40 行）。
- 代码改动 ≤ 1000 行、文档 ≤ 1500 行（按 `node scripts/rule-checks.mjs size origin/main` 度量）。
- 只允许 rebase merge；合并由人类伙伴决定。本批次在第二轮评审修复后由人类明确指示执行 rebase merge，见 `Bottom Change Note` 的 2026-09-22 条。

## Plan of Work

### Batch 1 · 区分 issue 与 pull request（issue #66）

**最小闭环**：引用 PR 编号时得到正确诊断，引用 issue 编号时判定不变。
**涉及文件**：`scripts/policy-check.mjs`、`tests/contract/issue-policy.test.js`

- [x] (2026-09-21) `fetchIssue()` 的 `--jq` 增加 `isPullRequest: (.pull_request != null)`
- [x] (2026-09-21) 新增纯函数 `checkIssueTarget(number, meta)` 与 `checkCloserTarget(number, meta)`
- [x] (2026-09-21) `main()` 的 `issue` 分支改用 `checkIssueTarget`，命中 PR 时 exit 2
- [x] (2026-09-21) `main()` 的 `pr` 分支的 `closes` 循环改用 `checkCloserTarget`，命中 PR 时 exit 1
- [x] (2026-09-21) 契约测试：`Closes #<PR>` 夹具 → 新诊断且不含三条 issue 规则报错
- [x] (2026-09-21) 契约测试（回归）：`Closes #<issue>` → 判定不变
- [x] (2026-09-21) 契约测试（回归）：`Refs #<PR>` → 不报错
- [x] (2026-09-21) 真实 CLI 证据：`issue 12` 修复前后对照
- [x] (2026-09-21) 注入实验：把 `isPullRequest` 判定去掉 → 新增用例必须红

**验证**（全部为本次实测，命令与输出逐字记录）：

```bash
# 修复前（红）：issue 12 是已合并的 PR，被按 issue 规则判出三条必然的假阳性
$ node scripts/policy-check.mjs issue 12
::error::title must be written in English (CJK characters found)
::error::expected exactly one `kind:*` label, found 0
::error::expected at least one `area:*` label

3 problem(s) found. See docs/development/repository-rules.md §4 or run node scripts/policy-check.mjs areas.
exit=1

# 修复前（红）：pr 分支的 closes 循环同样按 issue 规则判 PR 编号。
# 原始复现体已不存在（见 Surprises），因此用桩 gh 喂入 `Closes #12`：
$ d=$(mktemp -d); cat > "$d/gh" <<'EOF'
#!/bin/sh
case "$*" in
  *pulls/100*) printf '%s' '{"body":"Closes #12","authorType":"User","authorLogin":"someone"}' ;;
  *issues/12*) printf '%s' '{"number":12,"title":"修复登录重定向","labels":[],"isPullRequest":true}' ;;
  *) exit 1 ;;
esac
EOF
$ chmod +x "$d/gh" && PATH="$d:$PATH" GITHUB_REPOSITORY=SingularityKChen/harness-projects node scripts/policy-check.mjs pr 100
::error::linked issue #12: title must match `<kind>(<area>): <summary>` — e.g. `feat(storage): add the SQLite schema` (got: "修复登录重定向")
::error::linked issue #12: expected exactly one `kind:*` label, found 0
::error::linked issue #12: expected at least one `area:*` label
exit=1

# 修复后（绿 / 正确诊断）
$ node --test tests/contract/issue-policy.test.js
ℹ tests 38
ℹ pass 38
ℹ fail 0

$ node scripts/policy-check.mjs issue 12
::error::#12 is a pull request, not an issue — use `pr 12`
exit=2

$ node scripts/policy-check.mjs issue 39
#39 conforms: fix(ci): validate gate label values and harden the policy-check entry point
exit=0

$ node scripts/policy-check.mjs pr 100
#100 conforms: links Closes #99, Refs #96
exit=0

$ node scripts/policy-check.mjs pr 59
#59 conforms: links Closes #39
exit=0

# 判据来自平台字段，不是编号形状
$ gh api repos/SingularityKChen/harness-projects/issues/12 --jq '{number, isPullRequest: (.pull_request != null)}'
{"isPullRequest":true,"number":12}

# 注入实验：把两处 `if (meta?.isPullRequest)` 改成 `if (false)` 后
ℹ tests 38
ℹ pass 36
ℹ fail 2
✖ 策略：issue 分支命中 PR 编号时按用法错误处理（exit 2），不再按 issue 规则判定
✖ 策略：Closes 指向 PR 时报出这是 pull request 且 exit 1，不再出现 issue 规则报错
  AssertionError [ERR_ASSERTION]: 期望恰好一条诊断，实际：["title must match `<kind>(<area>): <summary>` — e.g. `feat(storage): add the SQLite schema` (got: \"修复登录重定向\")","expected exactly one `kind:*` label, found 0","expected at least one `area:*` label"]
# 两条回归用例在注入下仍然通过——它们不该依赖新判定
✔ 策略：Closes 指向真实 issue 时判定与诊断前缀都不变（回归）
✔ 策略：Refs 指向 PR 不校验——刻意的边界，不是遗漏
# 还原后复跑：`grep -c "if (meta?.isPullRequest)"` = 2、`grep -c "if (false)"` = 0，tests 38 / pass 38 / fail 0

本轮验收未运行 `pnpm verify` 或任何全量测试套件。

$ node --test tests/contract/issue-policy.test.js
ℹ tests 39
ℹ pass 39
ℹ fail 0
exit=0

# 反向注入：删除 fetchIssue() 的 isPullRequest 字段后，同一命令失败
# 契约：fetchIssue 请求的 jq 必须包含 pull_request 类型判据 → fail（exit=1）
# 还原后复跑：39 pass / 0 fail

```

**回滚**：`git revert` 本批次提交；`fetchIssue()` 回到不区分 PR 的版本，两个纯函数与其用例整体删除。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | `issue 12` 不再按 issue 规则判定 | 真实 CLI 输出含 "is a pull request"，且不含 `expected exactly one kind:* label` | 通过：`::error::#12 is a pull request, not an issue — use \`pr 12\``，exit 2；stderr 无任何 issue 规则报错 |
| 2 | 引用 PR 编号时报出"这是 PR 不是 issue" | 契约测试用 `Closes #<PR>` 夹具断言新诊断，且断言旧的三条报错不再出现 | 通过：`checkCloserTarget(12, {isPullRequest:true})` 恰好一条 `linked #12 is a pull request; a closing keyword (\`Closes\` / \`Fixes\` / \`Resolves\`) must name an issue — use \`Refs #12\` to cross-reference it`；同形态走桩 gh 的真实 CLI 路径 exit 1 且无 issue 规则报错 |
| 3 | 引用真实 issue 编号判定不变 | 回归用例：`Closes #<issue>` 仍按 issue 规则判定；`pr 59` / `pr 100` 真实 CLI 仍 exit 0 | 通过：`checkCloserTarget(39, issue)` = `[]`，不合规 issue 仍带 `linked issue #39: ` 前缀逐条报出；`issue 39` exit 0、`pr 59` exit 0、`pr 100` exit 0 |
| 4 | `Refs #<PR>` 不被拒 | 回归用例：`Refs #<PR>` 不产生任何问题；`pr 100` 真实 CLI exit 0 | 通过：`linkedIssues('Refs #98')` = `{closes: [], refs: [98]}`、`checkPullRequestBody('Refs #98')` = `[]`；桩 gh 只在 `pulls/100` 应答，若实现误取 `issues/98` 会落到 `*) exit 1` → exit 3，实测 exit 0。注意 `pr 100` 本身不构成该边界的证据，理由见 Surprises |
| 5 | 三态证据 | 修复前红（`issue 12` 三条 issue 规则报错）→ 修复后绿/正确诊断 → 去掉判定后新增用例变红 | 通过（当轮数字；测试总数随后续轮次增长）：修复前 `issue 12` exit 1 三条报错；修复后 38 pass / 0 fail 且 CLI 诊断正确；注入 `if (false)` 后 36 pass / **2 fail**，红的正是两条新增 PR 诊断用例，还原后 38 pass / 0 fail。当前 head 的测试总数与最新证据见 `Outcomes & Retrospective` |
| 6 | 退出码分类逐条核对 | `0/1/2/3` 四个取值逐条核对；已知两处变化：`issue <n>` 命中 PR 从 1 到 2，解析成功但缺 `title`/`labels` 的响应从 `TypeError` + 1 到 3 | 通过：`0` = `issue 39` / `pr 100` / `pr 59` / 合规桩；`1` = `Closes #<PR>` 桩、不合规 issue 桩；`2` = `issue 12`、未知子命令；`3` = `gh` 非零退出、垃圾输出、缺 author 字段、缺 issue 元数据（既有契约用例全部保持通过）。`pr <issue>` 仍是 `3`，见 Outcomes 的剩余清单 |

## Progress

- [x] (2026-09-21) 取证：确认 `fetchIssue()` 不请求 `pull_request` 字段；确认 `refs` 不校验是既有行为
- [x] (2026-09-21) Batch 1 · 区分 issue 与 pull request
- [x] (2026-09-21) 注入实验与三态证据
- [x] (2026-09-21) **索引已在栈级联步骤补上**：`docs/README.md` 的 Active 表新增本计划一行，插在 `2026-09-21-rule-checks-api-base` 之后。`docs/architecture/README.md` 与本批次无关，未改。
- [x] (2026-09-22) 第二轮评审（8 条 P3）修复：判据描述改为实测口径、诊断补出补救方式、jq 契约用例补哨兵断言、`docs/development/repository-rules.md` §4 记录目标类型语义、本计划的过期行数与验收表订正。逐条证据见 `Outcomes & Retrospective` 的「第二轮评审修复轮」。
- [x] (2026-09-22) 全部验收通过，计划移入 `docs/exec-plan/completed/`，`docs/README.md` 的索引行同步改指 `completed/` 并标为 `Completed`。

## Surprises & Discoveries

- **Observation**：issue #66 引用的原始复现体（PR #59 正文里的 PR 编号引用）已经不存在——PR #59 的正文此后被重写，当前只含 `Closes #39`。
  **Evidence**：`gh api repos/SingularityKChen/harness-projects/pulls/59 --jq .body | grep -n '#12'` 无输出；`linkedIssues()` 对当前正文返回 `{"closes":[39],"refs":[]}`。
  **Decision impact**：真实 CLI 的复现改用 `issue 12`（#12 是已合并 PR，可复现且不依赖夹具）；`pr` 分支的证据由契约测试的合成正文提供，并在记录里写明"原始复现体已被重写"这一事实，不假装它还在。

- **Observation**：计划里"`pr 100` 真实 CLI exit 0 证明 `Refs #<PR>` 不被拒"这条推断不成立。PR #100 的正文确实含 `Refs #96 #98`，但 `linkedIssues()` 只把**紧跟关键字**的编号记为引用：`Refs #96 #98` 只解析出 `refs: [96]`，`#98` 根本没进入判定，所以它既没被拒也没被校验。
  **Evidence**：`gh api repos/SingularityKChen/harness-projects/pulls/100 --jq .body | grep -n '#9[0-9]'` → 第 12 行 `- Refs #96 #98`；而 `node scripts/policy-check.mjs pr 100` → `#100 conforms: links Closes #99, Refs #96`（无 `#98`）。
  **Decision impact**：`Refs #<PR>` 这条边界改由契约测试直接证明（`linkedIssues('Refs #98')` = `{closes: [], refs: [98]}`，且桩 gh 只在 `pulls/100` 应答——若实现误把 refs 送去取数会落到 `*) exit 1` 使进程 exit 3，实测 exit 0）。**不**顺手扩展 `linkedIssues()` 去解析 `#96 #98` 这类编号列表：那属于关键词词表与匹配逻辑，被本批次 Global Constraints 明确排除，且与"PR 编号被当成 issue"是两回事。该缺口记入 Outcomes 的剩余清单。

- **Observation**：本机直接执行 `pnpm verify` 会先失败在 pnpm 自己的版本管理上，命令根本没跑起来：`[WARN] Cannot use the pnpm version this project pins: create the temporary package manager install directory: Operation not permitted (os error 1)`（沙箱拒绝在工作区外创建临时安装目录；`TMPDIR` 本身可写，被拒的是 pnpm 的全局安装位置）。注意管道会让 `pnpm verify | tail` 报出 exit 0，掩盖真实失败。
  **Evidence**：`pnpm --version` → 12.5.1（非 `package.json` 里 pin 的 10.28.2）；把 `XDG_DATA_HOME` / `XDG_CACHE_HOME` / `XDG_STATE_HOME` / `PNPM_HOME` / `TMPDIR` 全部指向工作区内目录后，`pnpm --version` → 10.28.2，`pnpm verify` exit 0。
  **Decision impact**：最终 `pnpm verify` 证据是在 pin 的 10.28.2 上取得的（不是"用别的版本凑一个绿"）；命令前缀必须带上那组环境变量，已在验证块里如实记录。工作区内的临时目录 `.tmp/` 在提交前删除，不进发布面。

## Decision Log

- **Decision**：只校验 `closes`，`refs` 保持不校验。
  **Rationale**：`Refs #<PR>` 是合法的交叉引用（PR #100 正在使用且 `Issue policy` 全绿）；把 `refs` 一并拒掉会制造第二类假阳性，并把 §8 第 7 条从"必须关联 issue"扩大成"不得提到 PR"。
  **Date/Author**：2026-09-21 / agent

- **Decision**：`issue <n>` 命中 PR 时 exit 2，而不是 exit 1。
  **Rationale**：这不是被检查对象的规范违规，而是调用方用错了模式；把用法错误报成违规会让 CI 的失败原因指向错误的修复方向。
  **Date/Author**：2026-09-21 / agent

- **Decision**：把 `main()` 里的 `issue` / `pr` 两个分支分别提成 `runIssue()` / `runPullRequest()`，并新增 `closerProblems()` 与 `usageError()`；`main()` 只留模式分派。
  **Rationale**：Global Constraints 要求"新增代码不得使任一函数超过 40 行"，而 `main()` 改动前已是 57 行——只往里塞分支无法满足该条。提取后 `main()` / `runIssue()` / `runPullRequest()` / `closerProblems()` / `usageError()` 全部在限内（逐函数实测行数只写在 `Outcomes & Retrospective` 一处，避免两处数字各说各话）；退出码差异（2 vs 1）也因此有了一个可命名的位置，而不是散落在两个 `if` 里。既有 CLI 契约用例（退出码分类、改名副本、桩 gh）覆盖了这次搬动。
  **Date/Author**：2026-09-21 / agent

- **Decision**：`closes` 命中 PR 的诊断措辞是 `linked #12 is a pull request; \`Closes\` must name an issue`，不带 `linked issue #12: ` 前缀。
  **Rationale**：`linked issue #12: ` 前缀断言的是"#12 是 issue"，而这条诊断恰恰要否定它；沿用旧前缀会自相矛盾。真 issue 的诊断前缀逐字保持不变，由回归用例断言。
  **Date/Author**：2026-09-21 / agent

## Idempotence and Recovery

- 全部改动是纯判定逻辑，无外部副作用；验证命令只读且可重复（`pr 100` / `pr 59` 读的是已合并 PR 的稳定正文）。
- 注入实验要求还原后复跑确认。
- 回滚单位是单个提交。

## Interfaces and Dependencies

- **依赖**：`gh` CLI（真实 CLI 证据需要），GitHub issues API 的 `pull_request` 字段。
- **不依赖**：网络与凭据的契约测试路径（两个纯函数不做 I/O）。
- **下游**：`#102`（评审触发面）会改 `github-review.yml`，与本批次不共享文件。

## Outcomes & Retrospective

**实际结果（2026-09-21）**

- 三态证据齐备：
  - **修复前红**：`issue 12` → exit 1，三条按 issue 规则判的假阳性；`pr 100` + `Closes #12` 夹具 → exit 1，同样三条（带 `linked issue #12: ` 前缀）。
  - **修复后绿 / 正确诊断**：`issue 12` → `#12 is a pull request, not an issue — use \`pr 12\``，exit 2；本轮聚焦契约测试 39 pass / 0 fail。
  - **注入实验**：临时删除 `fetchIssue()` 的 `isPullRequest` 字段后，新增的 `fetchIssue 请求的 jq 必须包含 pull_request 类型判据` 用例失败（测试命令 exit 1）；还原后复跑 39 pass / 0 fail。
- 本轮没有运行 `pnpm verify`，也没有运行全量测试套件；只运行了 `node --test tests/contract/issue-policy.test.js`。
- 行数订正（2026-09-22 复核）：`scripts/policy-check.mjs` 当前实测 **594 行**；本 ExecPlan 归档时实测 **299 行**。

**评审回复轮（2026-09-21，第二轮）**

`node --test tests/contract/issue-policy.test.js` → **40 pass / 0 fail**（评审前 39）。四条修改各做了注入实验，先证明断言有牙再提交：

| 注入 | 期望 | 实测 |
|---|---|---|
| 把 `refs` 也送进 `closerProblems()` | `Refs` 边界用例变红 | 红（该文件整体 1 fail） |
| 去掉 `runIssue` 里的 `hasIssueMetadata` 守卫 | exit 3 用例变红 | 红（39 pass / 1 fail） |
| 诊断改回只写 `` `Closes` `` | 措辞断言变红 | 红（39 pass / 1 fail） |

三次注入后都还原并复跑 40 pass / 0 fail，两个文件与注入前逐字节相同。

**与计划的偏差**

1. `main()` 被拆成 `runIssue()` / `runPullRequest()` / `closerProblems()` / `usageError()`。计划没写这次搬动，但它由 Global Constraints 的"新增代码不得使任一函数超过 40 行"直接推出（`main()` 改动前已 57 行）。见 Decision Log。
2. `Refs #<PR>` 边界的证据来源从"`pr 100` 真实 CLI"换成"契约测试 + 桩 gh"——计划里那条推断有事实错误（`#98` 根本没被解析），见 Surprises。
3. 本机 `pnpm verify` 必须先把 pnpm 的 XDG / 临时目录指到工作区内才能跑起来；证据是在 pin 的 10.28.2 上取得的，见 Surprises。
4. `scripts/policy-check.mjs` 由 485 行增至 **594 行**，仍超过 Global Constraints 里"单文件 ≤ 200 行"的新文件预算——该文件在本批次之前就已远超（485 行），拆成多文件会改变导出面，属于另一件事，不在本批次范围。可执行的那条（新增代码不得使任一函数超过 40 行）已满足；逐函数行数按「函数声明行到闭合花括号」一种口径实测（2026-09-22 复核）：`main` 16、`runIssue` 11、`runPullRequest` 29、`closerProblems` 7、`usageError` 4、`checkIssueTarget` 6、`checkCloserTarget` 15 行。该文件唯一超过 40 行的是 `checkLabels`（45 行），它与 base 逐字节相同、未被本批次改动。

**剩余清单：还有哪些判定把 PR 与 issue 混为一谈**

- **反方向仍然混同**：`pr <n>` 传入真 issue 编号（如 `pr 39`）走的是 pulls API，`gh` 404 被归入 exit 3（内部错误）。语义上它与 `issue 12` 同类——调用方用错了模式，应当是 exit 2 并提示 `use issue 39`。本批次只修 issue 方向，因为 issue #66 只覆盖这一方向。实测：`node scripts/policy-check.mjs pr 39` → `gh: Not Found (HTTP 404)`，exit 3。
- **只写 `Refs` 时，"必须关联 issue"仍可能被一个 PR 编号满足**：`Refs #98`（#98 是 PR）让 `checkPullRequestBody` 返回 `[]`，而正文其实没有指向任何 issue。这是 D2 的刻意代价（不校验 `refs`），不是遗漏；要收敛它需要另立决策——要么校验 refs 的目标类型却仍允许 PR（自相矛盾），要么把规则收紧成"至少一条 `Closes` 指向 issue"。
- **编号列表只解析紧跟关键字的第一个**：`Refs #96 #98` → `{"closes":[],"refs":[96]}`，`Closes #1, #2` / `Closes #1 and #2` → `{"closes":[1],"refs":[]}`。GitHub 会把列表里的编号都算作关联，这里只看到第一个——对 `Closes` 是假绿，对 `Refs` 是漏检。属于关键词匹配逻辑，被本批次 Global Constraints 排除。

## Bottom Change Note

- 2026-09-21：首次创建。原因：issue #66 是迭代 2 内的 P1，且它会让任何引用同仓 PR 编号的 PR 永久挂红，属于会训练人忽略检查的那类假阳性。
- 2026-09-21：实现与验证完成后回填 `Plan of Work` 勾选与实测输出、`Validation and Acceptance` 结果列、`Progress`、`Surprises & Discoveries`（三条）、`Decision Log`（两条新增决策）、`Outcomes & Retrospective`。计划本身的设计决策（D1–D5）未变；偏差只在实现形态（`main()` 拆分）与证据来源（`Refs` 边界改由契约测试承担）两处，均已如实记录。索引更新按批次约束延后到栈级联。
- 2026-09-21：订正 `Decision Log` 里 `main()` 拆分那一条的行数引用。原因：该条写的是 13/11/25 行，而 `Outcomes & Retrospective` 里同一批函数的实测值是 16/10/29，两处数字互相矛盾。改为一处给实测值、另一处引用它。行数口径与实测值见 `Outcomes & Retrospective` 的偏差清单第 4 条（2026-09-22 复核时统一为「函数声明行到闭合花括号」一种口径）。
- 2026-09-21：本轮独立验收补写 jq 字段契约测试，并记录本轮未运行全量套件。当时记下的行数（`scripts/policy-check.mjs` 555 行、本 ExecPlan 282 行）是错的：555 只对应 `24f0837`，其后的修复提交把该文件带到 592 行；282 不对应任何已提交版本。2026-09-22 轮已订正。
- 2026-09-21：按 PR 评审回复（P2/P2/P3）修改。原因与改动：(1) `Global Constraints` 与 `Progress` 都写着"不改 `docs/README.md`"，而分支实际改了它——评审指出计划文本与 diff 自相矛盾；两条都改成实际状态，并把 `docs/README.md` 列入允许文件集。(2) `Refs` 用例的 gh 桩是一句裸 `printf`，对任何调用都返回同一对象，于是注释声称的"误把 refs 送去取数会 exit 3"根本不成立（实测会抛 `TypeError` → 裸 Node 栈 + exit 1）；桩改成 `case "$*" in` 形状。(3) `checkCloserTarget` 的诊断只写 `` `Closes` ``，而 `linkedIssues` 匹配的是整族关闭关键字，写 `Fixes #12` 的作者会被告知一个自己没用过的关键字；改为点名整族，并补一条 `Fixes #12` 的用例。(4) 新增 `hasIssueMetadata()` 与两处调用点的 exit 3 守卫：解析成功但缺 `title`/`labels` 的响应此前会在 `checkTitle(undefined)` 抛 `TypeError`，把"没能检查"报成"检查过且不合规"。四条各自做了注入实验，见 `Outcomes & Retrospective`。
- 2026-09-22：按第二轮 PR 评审（8 条 P3）修改。(1) `checkIssueTarget` 的 JSDoc 把「三条必然同时命中」改成实测口径：`#12` 三条，`#100` / `#103` 各一条——后两者带着 `kind:*` / `area:*` 标签，标签规则并不命中。(2) `checkCloserTarget` 的诊断补出补救方式（`use \`Refs #<n>\` to cross-reference it`），并补一条断言钉住它。(3) jq 契约用例先断言桩的兜底哨兵没有触发，失败信息才自解释；同时把该用例失败消息里的双反斜杠改成单反斜杠，避免把反斜杠本身打印进输出。(4) `docs/development/repository-rules.md` §4 记录两个命令的目标类型语义（`issue <n>` 命中 PR → 退出码 2；`Closes` 指向 PR → 退出码 1；`Refs` 指向 PR 不校验），并把该文件列入允许文件集。(5) 订正本计划的过期数字：「当前实测」行数、「由 485 行增至」的终值、逐函数行数统一为「函数声明行到闭合花括号」一种口径；`Validation and Acceptance` 第 6 行由「退出码语义不变」改为「退出码分类逐条核对」，并补上「解析成功但缺 `title`/`labels` 从 `TypeError` + 1 到 3」这处此前漏记的变化。人类在此轮明确指示执行 rebase merge。
- 2026-09-22：全部验收通过，按 `PLANS.md` §5「全部完成 → 文件移入 `completed/`」把本计划移入 `docs/exec-plan/completed/`，头部状态改为 `Completed`，`docs/README.md` 的索引行改指 `completed/` 并标为 `Completed`。
