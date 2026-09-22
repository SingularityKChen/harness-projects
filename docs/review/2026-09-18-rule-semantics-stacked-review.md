# 规则语义收敛栈 MVP 交付评审

> 状态：Blocked（#61 存在未解决的 P0/P1，不能合并）  
> 创建：2026-09-18  
> 范围：PR #60、#56、#57、#58、#59、#61、#63；按当前 head 重新核验，未把已解决线程重复算作新问题。  
> 评审方式：先完成全量风险矩阵，再提交本轮结论；行级阻塞意见保留在 GitHub thread。

## Purpose / Big Picture

这组 PR 的目标不是单独增加几个脚本，而是把发布面、工作流、看板状态、合并队列和 issue 关联规则从散文约定变成可验证的 MVP 交付门禁。评审结论必须回答两个系统级问题：

1. 这 7 个 PR 按声明顺序合并后，必需门禁是否仍然可运行且不会假绿；
2. 看板规划状态、工程事实和凭据执行面是否仍保持 `AGENTS.md` §1.3 / §2.2 的边界。

## Context and Orientation

当前 PR 元数据（`gh pr view <n> --json ...`）：

| PR | head | base | 当前状态 | 当前 head |
|---|---|---|---|---|
| #60 | `fix/rule-checks-hardening` | `main` | OPEN / MERGEABLE / BLOCKED（缺批准） | `86a8aa275081556cc3adf91ef66b19b24744877c` |
| #56 | `docs/board-planning-semantics` | `main` | OPEN / MERGEABLE / BLOCKED | `bb0ccc0a73b40c7d3d45c5a7041e5d58983b6020` |
| #57 | `docs/process-records` | `main` | OPEN / MERGEABLE / BLOCKED | `0c24eab2d5c62cedaab1e3f4f0737f93463a501e` |
| #58 | `fix/workflow-check-false-greens` | `main` | OPEN / MERGEABLE / BLOCKED | `226b97c748c037df148d08158b6e78f8f3eb4719` |
| #59 | `fix/policy-check-hardening` | `main` | OPEN / MERGEABLE / BLOCKED | `426c839e03803dda99111b19bc326fb928b3b4a2` |
| #61 | `chore/board-invariants` | `main` | OPEN / MERGEABLE / BLOCKED | `896e45c6366e9da51a31c0faf9025c3bd6a54d70` |
| #63 | `fix/link-context-stripping` | `fix/policy-check-hardening` | OPEN / MERGEABLE / BLOCKED | `3e01e79c062ad62612f43b3adada5e04950f13e1` |

本地单分支验证：

- #60：`pnpm verify` 74/74
- #56：`pnpm verify` 58/58
- #57：`pnpm verify` 43/43
- #58：`pnpm verify` 76/76
- #59：`pnpm verify` 60/60
- #61：`pnpm verify` 53/53
- #63：`pnpm verify` 68/68

这些结果只证明单分支，不证明合并并集。#56–#59 的当前 GitHub `Disclosure scan` 为红，日志命中共享 ExecPlan 中用于描述误报形态的示例；#60 的修复应排在它们之前。

## Design / Spec

### 评审方法

- 用 First Principles Development 把目标还原成“合并后仍能判定、不会假绿、不会让外部写入越过所有权边界”；先找能使最多下游结论失效的合并级不确定性。
- 用 Qian Systems Router 检查包含系统、子系统接口、信息/控制流和反馈闭环：`rule-checks`、`workflow-check`、`policy-check`、看板裁决表和运行时 token workflow 必须组合后仍满足同一不变量。
- 对产品语义重点检查规划轴与工程轴正交、`Status` 的人类所有权、未知工作流的 fail-closed、以及观察器是否真的观察到正确的代码版本。
- 只在新增且仍成立的问题上提交新意见；已经被当前 head 修复的 thread 不重复打开。

### 合并顺序假设

`#60 → #56 → #57 → #58 → #59 → #63`；#61 不得进入当前队列，直到缩减为只提供运行时取数/接线并 rebase 到 #56 之后。这个顺序由共享 ExecPlan、#63 对 #59 的直接依赖，以及 #60 修复其它 PR 的 Disclosure 假红共同决定。

## Global Constraints

- P0/P1 代码问题不能合并。
- 不把单分支绿灯当作合并后绿灯；必须检查并集的冲突、测试和门禁。
- 外部写入和 secret 执行面必须可追踪，不能由 PR 分支代码携带生产凭据执行。
- 评审记录落在 `docs/review/`，与 ExecPlan 同样保留事实、决策、验证和回滚信息。

## Plan of Work

### Batch 1 · 锁定 head/base 与已有线程

- [x] 读取 7 个 PR 的当前 head/base、状态、描述、checks 和提交。
- [x] 查询所有 review threads，确认 #61 的 P0/P1 仍未解决，其余已解决线程不重复计入。

### Batch 2 · 单分支验证与产品/架构审查

- [x] 在 7 个对应 worktree 中运行 `CI=true pnpm verify`。
- [x] 逐项对照 `AGENTS.md` §1.3、§2.2、§8.6、§9.2、§9.5 与 `docs/review/README.md`。

### Batch 3 · 合并并集模拟

- [x] 在临时 worktree 按 `#60 → #56 → #57 → #58 → #59 → #61 → #63` 应用提交。
- [x] 观察到 #61 与 #56 在 `scripts/board-workflow-check.mjs` 发生 add/add 冲突；#57/#58/#59 的共享 ExecPlan 也会发生 add/add，#63 在完整队列上还会与 policy-check / ExecPlan 发生冲突。
- [ ] 在 #61 修复并重新提交前，不进行最终合并验证或 rebase merge。

### Batch 4 · 一次性提交评审结论

- [x] 形成 P0–P3 矩阵。
- [x] 保留 #61 现有行级阻塞 thread（P0/P1/P2），不以新的重复评论稀释线程。
- [ ] 待 #61 修复后重新读取 head、重跑并集验证，再决定是否关闭对应 issue 并执行 rebase merge。

## Validation and Acceptance

1. 每个 PR 的当前 head/base 与 GitHub 页面一致。
2. 每个 PR 的单分支 `pnpm verify` 结果已实际执行并记录。
3. 合并模拟确实覆盖共享 ExecPlan、#56/#61 同名脚本和 #63 的 stacked base，而不是只做任意两分支的 `merge-tree`。
4. P0/P1 结论均有具体文件/行、可复现影响与对应 GitHub inline thread。
5. 在 #61 修复前，最终状态明确为“不可合并”；不得因其它 6 个 PR 绿色而提前宣告 MVP 完成。

## 风险矩阵

### P0 —— 阻塞合并

| ID | PR | 位置 | 风险与影响 | 证据 / 当前处理 |
|---|---|---|---|---|
| P0-1 | #61 × #56 | `scripts/board-workflow-check.mjs:69` | 两个 PR 新增同一路径但导出 API 不同。按队列 rebase 会 add/add 冲突；若保留 #56 版本却删除 #61 测试/CLI 使测试变绿，`Board workflow invariants` 会调用一个没有 CLI 入口的模块，表现为检查全绿但零输出，直接违反 fail-closed 和“绿灯代表已检查”的门禁语义。 | 临时 worktree 的 cherry-pick/rebase 实测 `CONFLICT (add/add)`；现有 GitHub inline thread `4045108241` 仍 unresolved。#61 不能合并，直到缩成只接线并复用 #56 的判定模块。 |

### P1 —— 严重，当前不能把 #61 当作可交付 MVP

| ID | PR | 位置 | 风险与影响 | 证据 / 当前处理 |
|---|---|---|---|---|
| P1-1 | #61 | `.github/workflows/board-invariants.yml:55`（与 checkout/run 步骤同 job） | `pull_request` 同仓事件 checkout PR merge ref 后，使用 `PROJECTS_TOKEN` 执行 PR 分支自己的 `scripts/board-workflow-check.mjs`。同仓任意可推送分支可改脚本并在带 PAT 的 job 中执行；fork 守卫挡不住同仓分支。产品侧这是把不可信 PR 代码接入凭据控制面。 | 现有 inline thread `4045108482` 仍 unresolved；建议只保留 `schedule`/`workflow_dispatch`，或改成不 checkout/不执行 PR 代码的固定默认分支接线。 |

### P2 —— 重要但不阻塞其它已合格 PR

| ID | PR | 位置 | 判断 |
|---|---|---|---|
| P2-1 | #61 | `scripts/board-workflow-check.mjs:115` | `workflows(first:50)` 不检查 `totalCount`/分页；超过 50 时会误报 missing，当前不是静默假绿。已有 thread `4045133541`，暂不另开重复评论。 |
| P2-2 | #63 | `scripts/policy-check.mjs:212–214` | CommonMark 允许跨行 code span，当前实现只按单行剥离；正文中的跨行 `Closes #N` 可能被计为链接。作者已明确这是取“宁可少剥不可误剥”的取舍，属于 advisory 残余，不阻塞本轮。 |
| P2-3 | #60 | `scripts/rule-checks.mjs:12–13` | PR 标题/分支名属于发布面但尚未纳入扫描，当前已文档化并留待后续小 PR；不把已声明的范围缺口重新升级为本 PR 阻塞项。 |
| P2-4 | 跨 PR | #56–#59 当前 `Disclosure scan` | 共享 ExecPlan 示例字面量使四个 PR 单独看呈红；#60 排在前面后该假红已被修复。若不按队列顺序合并，会把 advisory 红灯误读成各 PR 代码缺陷。 |

### P3 —— 记录但不建议为本轮改动

- #61 的 API 错误分类与分页诊断信息可增强，但当前失败会红而非假绿。
- #63 的嵌套 HTML comment / fenced block 病态组合需要状态机级解析；本轮做会扩大批次边界。
- #57 的队列文档仍需在每次真实合并后回填最终 SHA；这是运行记录义务，不是当前代码阻塞。

## Progress

- [x] (2026-09-18) 完成 7 个 PR 的当前 head/base、checks 和线程核验。
- [x] (2026-09-18) 完成 7 个 worktree 的单分支验证。
- [x] (2026-09-18) 完成合并顺序模拟并定位 #56/#61 的 P0 add/add 冲突及其它共享 ExecPlan 冲突。
- [x] (2026-09-18) 完成 P0–P3 风险矩阵；#61 保持 blocked。
- [ ] #61 修复、issue 回读、全栈 rebase 验证与最终 merge gate。

## Surprises & Discoveries

1. **单分支全部绿仍不足以证明堆栈可合并。** #61 自身 53/53 通过，但把它接到 #56 后，文件所有权与导出契约冲突；错误解决方式还能制造全绿假检查。
2. **共享 ExecPlan 是真实的合并耦合点。** #56/#57/#58/#59/#63 都修改同一路径，说明“纯文档”并不等于无冲突；队列文档必须记录实际 rebase 结果。
3. **#60 的顺序是系统级前置条件。** #56–#59 的 Disclosure scan 红在共享示例字面量，而 #60 恰好修复扫描器；因此不能按 PR 编号或“文档先合”直觉改变顺序。

## Decision Log

- **2026-09-18：不合并 #61。** P0-1 会让合并后的看板观察器进入“绿但未检查”状态；P1-1 把 PR 分支代码接入 PAT 执行面。两者均超出可接受的 MVP 风险。
- **2026-09-18：其它 PR 暂不因已解决线程重复阻塞。** 它们的当前 head 单分支验证通过，已有 review thread 已记录并关闭；是否最终合并仍取决于队列顺序和 #61 的独立修复。
- **2026-09-18：不为 P2-2 强行扩大 #63 范围。** 当前实现是显式的误剥风险取舍，且检查为 advisory；除非产品决定把 CommonMark 完整语义纳入 MVP，否则保持现状。

## Idempotence and Recovery

- 重新评审前必须重新读取每个 PR 的 `headRefOid`；force-push 后旧行号和旧结论失效。
- #61 的安全修复优先备份远端分支（`backup/pre-rebase-pr61`），然后缩减脚本所有权、rebase 到 #56 合并后的真实 `main`，重跑 `pnpm verify`、`node scripts/workflow-check.mjs` 与 board workflow advisory。
- 若合并后发现观察器假绿，按 PR 级提交回退；不要删除 issue/Project 外部状态来“回滚”代码事实。

## Interfaces and Dependencies

- #60 提供发布面检查与体量检查，决定 #56–#59 的 advisory 输出是否可解释。
- #56 提供看板工作流裁决的离线纯函数与产品语义权威表。
- #61 只能依赖 #56 的裁决模块，负责外部取数与接线；不得保留第二份 `EXPECTED` 或第二套判定 API。
- #57 提供合并队列与 agent 写入边界的长期载体。
- #58/#59/#63 分别加固 workflow、issue policy 与 Markdown 上下文识别。

## Outcomes & Retrospective

当前 outcome 不是“7 个 PR 已合并”，而是“6 个可继续排队，#61 明确阻塞并有可复现修复路径”。这次评审再次证明：对规则/门禁型 MVP，最危险的不是单个函数测试失败，而是跨 PR 文件所有权、执行凭据与观察器接线在合并并集中的耦合。

## Bottom Change Note

- 2026-09-18：新建本文件，记录 PR #60、#56–#59、#61、#63 的当前 head 审查；相较旧的 9-PR 记录，本文件只覆盖规则语义收敛栈，并保留 #61 尚未解决的 P0/P1 作为当前合并门。
