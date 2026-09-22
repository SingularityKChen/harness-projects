# policy-check 拒绝把 PR 编号当 issue ExecPlan

> 状态：Active
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
- 仓库**不**要求 `refs` 指向 issue：`Refs #98`（#98 是 PR）是合法的交叉引用，实测 PR #100 的正文含 `Refs #96 #98` 且 `Issue policy` 全绿。本批次必须保持这一行为。

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

- 只改：`scripts/policy-check.mjs`、`tests/contract/issue-policy.test.js`、`docs/exec-plan/active/2026-09-21-policy-check-pr-number.md`。
- 不改 `linkedIssues()` 的上下文剥离逻辑（#62 / PR #63 的范围）与 `Closes`/`Refs` 的关键词词表。
- 不新增运行时依赖；单文件 ≤ 200 行、单函数 ≤ 40 行（既有文件已接近上限时，新增代码不得使任一函数超过 40 行）。
- 代码改动 ≤ 1000 行、文档 ≤ 1500 行（按 `node scripts/rule-checks.mjs size origin/main` 度量）。
- 只允许 rebase merge；不自行合并 PR。

## Plan of Work

### Batch 1 · 区分 issue 与 pull request（issue #66）

**最小闭环**：引用 PR 编号时得到正确诊断，引用 issue 编号时判定不变。
**涉及文件**：`scripts/policy-check.mjs`、`tests/contract/issue-policy.test.js`

- [ ] `fetchIssue()` 的 `--jq` 增加 `isPullRequest: (.pull_request != null)`
- [ ] 新增纯函数 `checkIssueTarget(number, meta)` 与 `checkCloserTarget(number, meta)`
- [ ] `main()` 的 `issue` 分支改用 `checkIssueTarget`，命中 PR 时 exit 2
- [ ] `main()` 的 `pr` 分支的 `closes` 循环改用 `checkCloserTarget`，命中 PR 时 exit 1
- [ ] 契约测试：`Closes #<PR>` 夹具 → 新诊断且不含三条 issue 规则报错
- [ ] 契约测试（回归）：`Closes #<issue>` → 判定不变
- [ ] 契约测试（回归）：`Refs #<PR>` → 不报错
- [ ] 真实 CLI 证据：`issue 12` 修复前后对照
- [ ] 注入实验：把 `isPullRequest` 判定去掉 → 新增用例必须红

**验证**：

```bash
node --test tests/contract/issue-policy.test.js          # 期望：pass，fail 0
node scripts/policy-check.mjs issue 12; echo "exit=$?"   # 期望：is a pull request，exit=2
node scripts/policy-check.mjs issue 39; echo "exit=$?"   # 期望：conforms，exit=0
node scripts/policy-check.mjs pr 100; echo "exit=$?"     # 期望：conforms（Refs #98 不校验），exit=0
node scripts/policy-check.mjs pr 59; echo "exit=$?"      # 期望：conforms（Closes #39 是 issue），exit=0
pnpm verify                                              # 期望：typecheck 与全部测试通过
node scripts/rule-checks.mjs disclosure origin/main       # 期望：exit 0
node scripts/rule-checks.mjs size origin/main             # 期望：代码 ≤ 1000，exit 0
```

**回滚**：`git revert` 本批次提交；`fetchIssue()` 回到不区分 PR 的版本，两个纯函数与其用例整体删除。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | `issue 12` 不再按 issue 规则判定 | 真实 CLI 输出含 "is a pull request"，且不含 `expected exactly one kind:* label` | 待验证 |
| 2 | 引用 PR 编号时报出"这是 PR 不是 issue" | 契约测试用 `Closes #<PR>` 夹具断言新诊断，且断言旧的三条报错不再出现 | 待验证 |
| 3 | 引用真实 issue 编号判定不变 | 回归用例：`Closes #<issue>` 仍按 issue 规则判定；`pr 59` / `pr 100` 真实 CLI 仍 exit 0 | 待验证 |
| 4 | `Refs #<PR>` 不被拒 | 回归用例：`Refs #<PR>` 不产生任何问题；`pr 100` 真实 CLI exit 0 | 待验证 |
| 5 | 三态证据 | 修复前红（`issue 12` 三条 issue 规则报错）→ 修复后绿/正确诊断 → 去掉判定后新增用例变红 | 待验证 |
| 6 | 退出码语义不变 | `0/1/2/3` 四个取值逐条核对；唯一变化是 `issue <n>` 命中 PR 从 1 到 2 | 待验证 |

## Progress

- [ ] (2026-09-21) 取证：确认 `fetchIssue()` 不请求 `pull_request` 字段；确认 `refs` 不校验是既有行为
- [ ] Batch 1 · 区分 issue 与 pull request
- [ ] 注入实验与三态证据

## Surprises & Discoveries

- **Observation**：issue #66 引用的原始复现体（PR #59 正文里的 PR 编号引用）已经不存在——PR #59 的正文此后被重写，当前只含 `Closes #39`。
  **Evidence**：`gh api repos/SingularityKChen/harness-projects/pulls/59 --jq .body | grep -n '#12'` 无输出；`linkedIssues()` 对当前正文返回 `{"closes":[39],"refs":[]}`。
  **Decision impact**：真实 CLI 的复现改用 `issue 12`（#12 是已合并 PR，可复现且不依赖夹具）；`pr` 分支的证据由契约测试的合成正文提供，并在记录里写明"原始复现体已被重写"这一事实，不假装它还在。

## Decision Log

- **Decision**：只校验 `closes`，`refs` 保持不校验。
  **Rationale**：`Refs #<PR>` 是合法的交叉引用（PR #100 正在使用且 `Issue policy` 全绿）；把 `refs` 一并拒掉会制造第二类假阳性，并把 §8 第 7 条从"必须关联 issue"扩大成"不得提到 PR"。
  **Date/Author**：2026-09-21 / agent

- **Decision**：`issue <n>` 命中 PR 时 exit 2，而不是 exit 1。
  **Rationale**：这不是被检查对象的规范违规，而是调用方用错了模式；把用法错误报成违规会让 CI 的失败原因指向错误的修复方向。
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

完成后填写：三态证据的实测输出、退出码逐条核对结果、以及"还有哪些判定把 PR 与 issue 混为一谈"的剩余清单。

## Bottom Change Note

- 2026-09-21：首次创建。原因：issue #66 是迭代 2 内的 P1，且它会让任何引用同仓 PR 编号的 PR 永久挂红，属于会训练人忽略检查的那类假阳性。
