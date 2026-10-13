# Review Mutation Harness 崩溃清理 ExecPlan

> 状态：Completed
> 创建：2026-10-12
> 范围：完成 issue #302；修复 review-mutate 在未捕获异常/EPIPE 后的进程组清理与 exit 2，并补齐三类存活变异契约。
> 上游输入：`AGENTS.md`、`PLANS.md`、issue #302、PR #300 review 记录。

## Purpose / Big Picture

review-mutate 在异常退出时必须同时恢复被变异文件、结束仍在运行的 command process-group，并以 harness error 的 exit 2 结束；中断后的 baseline 与 target 校验也必须在命令启动前完成。

最小成功证据：EPIPE/crash 后文件逐字恢复、command group 无残留、exit 2；post-restore baseline 中断和 baseline 后 leftovers SIGKILL 有反例；缺失最后 target 时首个 command 未启动。

## Context and Orientation

入口是 `scripts/review-mutate.mjs`，自变异契约在 `tests/contract/review-mutation-harness.test.js` 与 `tests/contract/fixtures/review-mutate-self.json`。PR #300 已合并，#302 只承接 review 末轮遗留的 crash/process-group 与三项测试缺口。

现有 interrupt semantics、spec format、mutant result codes 不变；本批只修崩溃清理和验证时序。

## Design / Spec

- 维护一个生命周期 owner，统一持有 applied snapshot、active child、active process-group 与 interrupted 状态。
- 未捕获异常先 SIGKILL active command process-group，再恢复 snapshot，最后以 exit 2 结束。
- 正常 interrupt 仍返回 130；post-restore baseline 的 interrupt 也返回 130。
- validation 在任何 command 启动前解析并确认全部 target 存在。
- self-mutation fixture 以真实 process-group/exit observation 杀死错误变异。

放弃：只恢复文件、不杀 group；让 crash 继续返回 1；仅抽函数但保留分散全局 owner；修改既有 interrupt semantics。

## Global Constraints

- 只修改 `scripts/review-mutate.mjs`、review-mutate contract tests/fixture、本 ExecPlan。
- 不改 spec 格式、既有 exit code 语义（除 crash 明确改为 2）、不引入依赖。
- 代码≤800 行、文档≤1300 行；公共仓库不写本机绝对路径/凭据。
- 分支 `fix/review-mutate-crash`，PR 使用 `Closes #302`。

## Plan of Work

### Batch 1 · 红灯与 draft

**最小闭环**：新增四类反例并在旧实现上失败。
**涉及文件**：`tests/contract/review-mutation-harness.test.js`、`tests/contract/fixtures/review-mutate-self.json`、本 ExecPlan。

- [x] crash/EPIPE 无 orphan + exit 2
- [x] post-restore baseline interrupt
- [x] baseline interrupt 后 leftovers SIGKILL
- [x] 最后 target 缺失时首个 command 未启动

验证：`node --test tests/contract/review-mutation-harness.test.js --test-name-pattern='crash|baseline|target'`，期望旧实现非零且失败来自缺口。

### Batch 2 · 生命周期清理实现

**最小闭环**：异常路径统一 SIGKILL group、恢复 snapshot、exit 2。
**涉及文件**：`scripts/review-mutate.mjs`。

- [x] 让异常/exit hook 共享 active group 清理
- [x] 区分 interrupt 130 与 harness error 2
- [x] 保证恢复失败不覆盖原始退出原因
- [x] 先 validation 再首个 command

验证：同上红灯测试转绿；`node scripts/review-mutate.mjs tests/contract/fixtures/review-mutate-self.json` 全部 KILLED。

### Batch 3 · 对抗验收与 ready

运行 contract、typecheck（如适用）、workflow、size、disclosure、diff-check；回读 issue links、labels、milestone、checks、review threads；独立复评通过后置 ready。2026-10-13 已在最终树运行 17/17 contract 与 31/31 self-mutants，SUMMARY 全部 `KILLED`、exit 0，工作树字节恢复。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | crash/EPIPE 清理 | byte restore、无 orphan、exit 2 |
| 2 | baseline interrupt | exit 130 且清理 leftovers |
| 3 | preflight validation | missing target 时 zero command starts |
| 4 | mutation harness | self fixture 全部 KILLED |
| 5 | 回归/公开面 | contract、workflow、size、disclosure、diff-check 全通过 |

## Progress

- [x] 读取 current main、#302、PR #300 review 和现有 harness。
- [x] 完成独立系统/交付/反方筛选；确认 #302 是孤立低风险新闭环。
- [x] Batch 1 红灯（旧实现的 EPIPE 反例以 code 1/timeout 失败；其余三类旧实现恰好已有行为，已用自变异钉住实现分支）。
- [x] Batch 2 实现。
- [x] Batch 3 复评、required checks、ready 与最终变异证据（2026-10-13）。

## Surprises & Discoveries

- 2026-10-12：现有 13 条 contract 全绿，但未覆盖 crash group kill、exit 2、post-restore baseline、X23 和 X18。
- 2026-10-12：#302 与 #308/#310/#312 无文件交集，可独立并行。
- 2026-10-12：旧实现的 EPIPE 反例稳定复现为 code 1 或等待超时，且命令子进程可继续存活；新增 listener/异常路径后同一反例收敛为 exit 2、字节恢复和无孤儿。
- 2026-10-12：post-restore baseline interrupt、baseline leftovers SIGKILL、missing-last preflight 在旧实现中已有正确行为；仍补契约并用 H19/H25/H30 及新增 H31/H32 变异固定，避免回归时绿控。

## Decision Log

- 2026-10-12：#302 保持独立 PR，不与产品运行时正确性 issue 聚合；其范围孤立、回滚简单。
- 2026-10-12：异常 exit 2，interrupt 130；理由是现有脚本头部已区分 harness error 与 mutant result。
- 2026-10-12：保留 SIGINT/SIGTERM/SIGHUP 三种中断信号；Node `child_process` 官方文档说明 POSIX `detached: true` 让 child 成为新 process group/session leader，因此使用 `process.kill(-pid, signal)` 清理整组；`process` 文档的 `uncaughtException` 语义支持在异常路径同步清理后显式 `process.exit(2)`。来源：`https://nodejs.org/api/child_process.html#optionsdetached`、`https://nodejs.org/api/process.html#event-uncaughtexception`。
- 2026-10-12：生命周期 owner 以 `groups` 集合保留已退出 direct child 的 process-group id，直到 close/收尾；原因是包装 shell 先退出时孙进程仍可能持有管道或存活，不能在 `exit` 事件立即丢弃组号。正常 interrupt 继续 130，harness failure 统一 2。

## Idempotence and Recovery

每次 harness run 都在临时 snapshot 上操作；失败恢复可重复。回滚为反向提交，无数据迁移。若 SIGKILL 不可用则测试必须 fail closed，不宣称无 orphan。

## Interfaces and Dependencies

Node child_process、process-group signals、review-mutate self fixture、Node test runner、GitHub PR checks。

## Outcomes & Retrospective

实现结果：新增 4 条契约反例，contract 17/17 全绿；self fixture 保留 31 个有效变异，最终运行 31/31 KILLED、exit 0、SUMMARY 完整且工作树字节恢复。H22 原本试图删除 exit hook，但该 hook 只负责同步恢复而非 crash 的进程组清理；EPIPE 的行为由 `uncaughtException` / stream error 路径的 `cleanupFailure` 覆盖，因此移除 H22，避免把同一责任重复计入变异表。生产代码用 lifecycle owner 管理 active child、process groups、applied snapshot、interrupted 状态；未捕获异常/EPIPE 先 SIGKILL 全部已登记组、再恢复 snapshot、最后 exit 2；三种 signal 保持 130；baseline 与还原后 baseline 均先检查 interrupted；所有 target 在首个 command 前解析。独立 MMP 评审未发现 P0/P1/P2；`Create review session` 失败属于可选本地 DSH overlay，非 required gate。

## Bottom Change Note

- 2026-10-12：创建 #302 ExecPlan；基于 PR #300 review 遗留项与三份新 issue 组合分析，选择独立 crash/process-group 闭环。
- 2026-10-12：Batch 1/2 完成；补充 EPIPE/process-group、post-restore interrupt、baseline leftovers、missing-last preflight 反例与 Node 官方信号语义取舍，并记录 H31/H32 自变异。
- 2026-10-12：独立无并发运行 self fixture：31 个有效变异全部 KILLED，exit 0；删除 H22 重复责任变异并同步更新计划。
- 2026-10-13：当前 head 的 MMP 评审、17/17 contract、31/31 self-mutants、公开面和 required checks 复核完成；评审记录写入 `docs/review/pr-324-mmp-review.md`，计划归档。
