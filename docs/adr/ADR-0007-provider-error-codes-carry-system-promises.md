# ADR-0007：provider 的错误码承载系统级承诺，core 不得用假设代替观测

> 状态：Proposed
> 日期：2026-09-26
> 来源：`docs/exec-plan/active/2026-09-24-local-git-worktree.md`「系统级根因分析」（PR #160 连续五轮被打回的共性）；`AGENTS.md` §1.1 实现级硬约束；issue #200 / #206 / #211 / #212 / #213

## Decision

1. **provider 写方法返回的 `conflict` 是一个系统级承诺**：它表示「请求的状态已经成立，且是调用方可以安全
   复用的那一份对象」。它不是「这里有个东西挡着」的同义词。`ambiguous_result` 同理，表示「结果真的不
   确定，必须对账」；确定性的拒绝（同名分支指向别处、D/F 引用冲突、路径被普通文件占用）一律用
   `invalid_input`，不得用这两个码。
2. **core 在把一次外部写入报成权威 `Saved` / `confirmed` 之前必须观测**，不得以 provider 的码代替观测。
   `AGENTS.md` §1.1 的「得到 Provider ack / reconcile 前，本地不得显示权威 `Saved`」里，ack 是**观测到
   的事实**，不是**推断出的假设**。
3. **缺少观测手段时，正确的动作是补能力，不是把观测义务下推给每一个 provider。** 一个写方法如果没有对应
   的读方法，core 就没有东西可以对账；此时应当给 port 补读能力（并写进 capability key 表），而不是要求
   每个 provider 在返回码里编码 core 的决策表。

## Why

它保护 `AGENTS.md` §1.1 的实现级硬约束与 §1.1 不变量 6（同一事实只有一个权威）。

反例就是本仓库自己的历史：`packages/core/src/git-provisioning.ts` 的 `ensureWorktree` 对**任意** `conflict`
不探测就 `confirmWrite`，而同一个文件的 `ensureBranch` 会先 `branchProbe`。差别不在 core 的谨慎程度，而在
**port 有没有对应的读方法**——分支有 `listBranches`，工作树只有 `createWorktree`。于是「可复用」这个
系统级判断被挤进了 provider 的返回码：

- 本层的 A 族 P1 连续出现三轮（第四、五条见 `docs/review/2026-09-26-start-work-stack-round6-review.md`），
  每一次都是「provider 报的 `conflict` 与 core 假设的意思不一致」；
- `packages/providers/fake` 至今仍是「路径被占就 `conflict`，不比分支」，#200 因此仍然开着；
- 这条义务**没有写在 port 里**：`packages/capabilities/src/development-provider.ts` 只写了三条**能力**义务
  （能力先于身份、按方法各自声明、方法缺失由快照表达）。provider 作者读不到它。

## Rejected

- **只把义务写进共享套件**（现状的加强版）。套件是测试，不是 port；provider 作者在写实现时读不到它，而
  套件只在跑测试时才说话。#200 已经证明这条路会拖：它开着，fake 就还是错的。
- **让每个 provider 自己正面确认后报 `conflict`**（本层第三～五轮的做法）。可行，而且本层已按它实现
  （`reuseBlockedBy`），但它把 core 的决策表复制到每一个 provider；A 族 4 条 P1 全部来自这次复制没有复制
  全。作为**过渡**保留，作为**终点**放弃。
- **让 `createWorktree` 正面幂等（`ok: true`）而不报 `conflict`**，与同文件里 `createBranch` 的既有形态
  对称（同名分支指向请求起点时它已经返回 `ok: true`）。这是最干净的终点，但它与已合入 `main` 的共享套件
  （`tests/contract/suites/development.js` 的「同一路径重复创建工作树返回 `conflict`」）以及 #200 的前提
  冲突，是一次跨层契约变更 → 作为 **#212** 的候选方案 B 评估。
- **只在 provider 里把错误信息写得更可行动**。那是把 core 的兜底写进 provider 的措辞：provider 判不了
  「这个名字是 core 编的」（#213），正如它判不了「core 会怎么解释我的 `conflict`」。

## Consequences

- **在 #212 落地前**，每一个实现 `createWorktree` / `createBranch` 的 provider 都必须满足第 1 条；本层的
  `reuseBlockedBy`（正面确认目标目录确为本仓库的链接工作树、且检出的正是请求的分支）是承重实现，不得为
  省行数删掉。
- core 当前有三处「以假设代替观测」，全部已登记、全部不在本 ADR 的落地范围内：
  `ensureWorktree` 对 `conflict` 不探测（#212）、`existingResult` 对已 `ready` 的上下文不复核（#211）、
  `baseRef()` 用 `?? 'main'` 编造输入（#213）。
- **新增 provider 或新增写方法时的强制提问**：core 拿什么观测它？如果答案是「没有」，先补读能力与 capability
  key，再实现写方法。
- 第 2 条不改变现有接口，只是把「ack 必须是观测」写清楚；它使 #211 与 #212 从「可选加固」变成「违反既定
  契约」。
