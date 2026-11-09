# PR #584 MMP 交付评审

2026-11-09 独立完整评审：**无 P0/P1，一项非阻塞 P2，建议 APPROVE 并修复该行项**。未提交正式 review、未 commit/push；仅本记录是本 worktree 的持久修改。

## 锁定事实与边界

- 执行上下文：`.worktrees/host-lifetime-20261109`；初始工作树干净，realpath 与 Git common-dir/worktree/ignore 已核对。
- base：`main@c9bb17b833295f26c750bd8c4bf425df53e9701f`；head：`fix/host-lifetime@cdb6f02e0237a9d678637263f2696d84063b88e4`，单一 commit。
- PR：`fix(apps): Withdraw failed remotes and bound Host shutdown`；ready、MERGEABLE、UNSTABLE；Closes #422；初始 reviews/comments/threads 均 0。
- 当前 Fast Gate、Verify、Browser、CodeQL、size、disclosure 成功；取消的 Rule/Issue 运行已有同 head 成功后继。`Create review session` 失败由 OPEN #364 跟踪，不属于本改动新增问题。
- 已读根 AGENTS、README、review 手册、#422/#338 acceptance、`docs/exec-plan/completed/2026-11-09-host-lifetime.md` 与 ADR-0013；ADR 仍 Proposed。
- 模式：Superpowers + Qian system definition/analysis-synthesis + First Principles audit；围绕资源 owner、外部确认、时间边界和真实用户恢复，不把局部 green 等同产品接受。

## 先行风险矩阵与最终判断

本矩阵在逐文件审查前建立；最初各项均待查，下表追加最终证据和判断。

| 严重度 | 层/原风险 | 最终证据与判断 |
|---|---|---|
| P0 | 架构/产品：删用户数据、第二权威源、未确认写变 Saved | 未发现；Storage/Core 不改，真实 SQLite reopen 保留 pending/unknown、intent/ref，原键及替换键不再 dispatch |
| P1 | 代码：child failure/根启动 acquisition/部分注册失败泄漏 | 未发现；新 bundle + Cordis 证明失败撤 mount 一次、迟到 acquisition 清理、profile/discovery/register 三窗口有界退出 |
| P1 | 代码/并发：stop 后派发、晚回调、checkpoint/prompt 复活 | 未发现；queued call、late rejection、create/checkpoint/prompt 与重开反例通过 |
| P1 | 产品/恢复：never-settling I/O 或非合作 disposer 无界卸载 | 未发现；真实 fetch/body/native signal、remote 准入同步关闭、统一 deadline 和 close once 通过 |
| P1 | 架构：旧 assembly abort 新 assembly、receiver/optional/signal 回归 | 未发现；Host I/O 与每代 wait owner 分离，recomposition/cache/权限/Planning 预算回归通过 |
| P2 | 测试：只 fake signal/只 race，断言缺判别力、缺真实 UI 接线 | 包入口、真实 Cordis/SQLite/React 与 8 项归因变异通过；installed UI 仍未复测 |
| P2 | 工作项/诊断：acceptance/ADR/关闭超限证据不闭环 | #422 工程 acceptance 已覆盖；发现 F1：remote cleanup 超限和拒绝无安全诊断 |
| P3 | 设计/规模：重复 owner、范围扩张、回滚不独立 | 未发现；生产 224 + 测试 329 = 553 改动行、原文档 142 行，无公共 Provider/Storage/schema 变更；整体 revert 保留用户数据 |

## F1 · P2：remote 清理失败与超限被静默丢弃

- 最小新增锚点：`apps/harness-plugin/src/remote.ts:206`（清理任务产生于 205）；`drainUntil` 的 false 被丢弃，且内部 allSettled 不向 caller 提供拒绝原因。
- 触发：Host root 卸载时 unregisterRemote/provide disposer 永不返回或 reject。composition 的 Core pending 已空时，其独立 drain 不会补发诊断。
- 影响：1000ms 后仍能退出，但 Desktop 诊断文件看不到 remote 未完成撤销/清理失败，无法区分正常卸载和被放弃的 cleanup。没有观察到数据丢失或无界退出，因此为 P2。
- 实证：实际 `applyHost` + worktree resolved Cordis 4.0.4 + 每模式全新临时 SQLite；resolve `1ms/events=[]`、never `1001ms/events=[]`、reject `1ms/events=[]`。三模式均在 1250ms 调度裕量内结束。
- 预期：正常控制不记失败；never 记录固定 `shutdownDeadlineExceeded`；reject 通过 describeError 白名单记录 `shutdownFailed`。保持同一 1000ms 期限，不传播原始错误或新增公共日志框架。
- 复现脚本：主仓库 `.superpowers/pr583-pr585-review-20261109/pr584-remote-cleanup-diagnostic.mjs`，从主仓库运行 `node .superpowers/pr583-pr585-review-20261109/pr584-remote-cleanup-diagnostic.mjs --root .worktrees/host-lifetime-20261109 --assert-diagnostics`。
- 实际 exit 1，指定断言 `never: expected safe lifecycle diagnostic`；脚本先完成全部三模式，再断言，并 finally 释放 pending/删除自有临时 profile。
- 修复方向：把 remote drain 的超限结果、每个失败 disposer 的安全投影汇入已有 Host 诊断出口；保留立即撤准入、两个 cleanup 并行启动、同一 deadline 与 close once；补实际 Host 的负控/失败断言。
- duplicate：搜索全部 issue 的 shutdown/unload/remote/lifetime 与 shutdown diagnostic，仅 #422 承担此 scope，未找到独立重复项。#338 是原父项；#364 仅负责 review automation。

## 独立执行的验证

所有命令在锁定 head 的 worktree 运行，均未访问用户库、凭据或真实模型。

| 命令 | 结果 |
|---|---|
| `pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-host-lifetime.test.js tests/contract/host-session-adapter.test.js tests/integration/harness-plugin-host-recomposition.test.js` | 87/87，exit 0，零 skip/todo |
| `pnpm test:file tests/integration/start-work-execution-recovery.test.js tests/integration/start-work-retry-identity.test.js tests/integration/harness-plugin-host-planning-refresh.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js tests/integration/harness-plugin-host-github-catalog.test.js tests/contract/harness-host-remote-adapter.test.js` | 276/276，exit 0，零 skip/todo |
| `pnpm boundaries`、`pnpm typecheck`、锁定 base/head 的 `git diff --check` | 9/9、exit 0、干净 |
| F1 actual Host 三模式 diagnostic probe | 观察模式 exit 0；增加指定安全诊断断言后按预期 RED exit 1 |

## 最终树整表变异

仅由 `node scripts/review-mutate.mjs <spec.json>` 施加和还原；最终整表基线/还原后基线均绿，exit 0，8/8 KILLED，无 KILLED_OTHER/SURVIVED/NOT_APPLIED。命令为 `node --test --test-reporter=spec --test-timeout=6000 tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-host-lifetime.test.js`。

| ID | 被移除/破坏机制 | killedBy（实际失败用例名片段） | 结果 |
|---|---|---|---|
| M1 | child failure 的 unmount | `child 初始化失败撤回 mount` | KILLED |
| M2 | root uid-clear 观察器 | `真实 Cordis 在 mount 获取中卸载根` | KILLED |
| M3 | raw native 组合 signal | `SQLite prompt stop preserves uncertainty` | KILLED |
| M4 | native abort-only，改继承 Planning 时限 | `native waits cross a Planning deadline` | KILLED |
| M5 | drainUntil 超限出口 | `remote withdrawal and noncooperative disposers share one deadline` | KILLED |
| M6 | unregisterRemote 调用 | `remote withdrawal and noncooperative disposers share one deadline` | KILLED |
| M7 | retained reverse callback 的 active fence | `retained reverse callback cannot enter Core` | KILLED |
| M8 | SQLite close | `setup fetch aborts real I/O, withdraws remote and closes once` | KILLED |

## 产品闭环、设计取舍与收尾

失败 child 精确撤回根 mount；正常依赖重注入保留 mount，失败后靠根 reload 恢复。Host 停止新 unary/stream/configure/tick，实际 abort 自有 I/O，已进入 checkpoint drain 后关库，耗尽则靠 Storage closed fence 回滚未提交事务；未确认写保留原 intent/ref 并只观察恢复。该 owner/epoch/deadline 组合是必要的最小范围，未发现需要引入公共 cancellation 框架的理由。

本轮重建 bundle 并运行实际 Cordis/SQLite/React 接线；watch 使用 JSON 往转载体与可控 RemoteStream，未复测 installed Desktop，也未运行真实模型或原生业务 cancel。native create 没有 cancellation ABI，外部创建仍可能不确定；当前证据只证明禁止迟到 checkpoint/prompt/自动重派。ADR Accepted、人类 R1 与父项 #338/#459 的接受独立；PR 作者的 full verify/Chromium 结果不冒称为本轮独立执行。

最终远端与本地回读仍为上述 base/head，Closes #422 未变，ready/MERGEABLE/UNSTABLE 未变；源码 tracked diff 为空、diff check 干净，仅本评审记录未跟踪。全矩阵已完成，F1 为全部可行动发现；建议按 APPROVE 提交附行项，由交付 owner 修复并独立复评后收尾。


## Batch 2 独立修复复评 · F1 ADDRESSED

2026-11-09，在同一 `fix/host-lifetime` 工作树、原提交 `cdb6f02e0237a9d678637263f2696d84063b88e4` 上复核稳定的未提交 Batch 2。复评者没有实现本补丁，仅追加本证据、运行测试与受控变异；原 F1 的未修复结论由本节取代。完整 P0/P1/P2/P3 矩阵复核后，**F1 ADDRESSED，无新增可行动 P0–P3，建议维持 APPROVE**。

补丁只在 Host 内部增加 shutdown diagnostic callback：root 把 composition 现有日志入口传给 remote，错误仍由既有 `describeError` 只投影 name/code/errcode；message/stack/path/cause 和临时根路径不进入日志。正常 resolve 负控零失败日志，两个 disposer 同步启动并行清理，各自拒绝独立记录；timeout 后晚拒绝也有 catch 消费。报告 callback 自身抛错被隔离，不阻断第二个 disposer 或 dispose 完成。`owner.stop()` 和传入绝对 deadline 的路径未改变；没有新预算、公共 wire 字段、Storage/Provider 契约或第二诊断 authority，原 close-once、停止准入与迟到 callback fence 保持。

实际独立执行：

| 验证 | 结果与边界 |
|---|---|
| 原 actual Host 三模式脚本（使用原 F1 同一 `--assert-diagnostics` 命令） | exit 0；resolve 4ms / events=[]，never 1003ms / shutdownDeadlineExceeded，reject 4ms / shutdownFailed；真实 applyHost/Cordis/临时 SQLite |
| `pnpm test:file tests/integration/harness-plugin-host-lifetime.test.js tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-host-recomposition.test.js tests/integration/harness-plugin-host-watch.test.js tests/contract/host-session-adapter.test.js tests/contract/harness-host-remote-adapter.test.js` | 96/96、零 skip/todo；含实际 Host 三模式、脱敏、late reject、并行 disposer、close once、统一预算与既有接线回归 |
| 直接 `installHostRemote` 反例，unregister 同步 throw、provide 异步 reject，diagnostic callback 每次主动 throw | 两 disposer 仍各执行一次；两次 report 尝试；dispose fulfilled，重复 dispose 不重清理 |
| `pnpm typecheck`、`pnpm boundaries` | exit 0、9/9 |
| `node scripts/review-mutate.mjs .superpowers/pr584-fix2-independent-20261109/final-10-mutants.json` | 最终树整表一次，10/10 KILLED；前后基线绿、源码逐字节还原、exit 0 |

最终变异命令的 child command 沿原 8 项 spec 的 artifact+lifetime、6000ms 超时。原 spec 保留在同运行目录 `original-8-mutants.json`，本次完整日志为 `final-10-mutants.log`；每项明确 killedBy，结果无 KILLED_OTHER/SURVIVED/NOT_APPLIED。

| ID | 机制 | killedBy | 最终结果 |
|---|---|---|---|
| M1 | failed child unmount | `child 初始化失败撤回 mount` | KILLED |
| M2 | root observer | `真实 Cordis 在 mount 获取中卸载根` | KILLED |
| M3 | native signal | `SQLite prompt stop preserves uncertainty` | KILLED |
| M4 | native abort-only 预算 | `native waits cross a Planning deadline` | KILLED |
| M5 | 统一 shutdown deadline | `remote withdrawal and noncooperative disposers share one deadline` | KILLED |
| M6 | remote unregister | `remote withdrawal and noncooperative disposers share one deadline` | KILLED |
| M7 | retained callback fence | `retained reverse callback cannot enter Core` | KILLED |
| M8 | SQLite close | `setup fetch aborts real I/O, withdraws remote and closes once` | KILLED |
| M9 | 省略 remote failure diagnostic | `real Cordis Host reject remote cleanup keeps bounded shutdown and safe diagnostics` | KILLED |
| M10 | 省略 remote timeout diagnostic | `real Cordis Host never remote cleanup keeps bounded shutdown and safe diagnostics` | KILLED |

复评锁定 source blob（变异前后相同，供主控最终整理后证明产品树等价）：

| 文件 | Git blob |
|---|---|
| `apps/harness-plugin/src/remote.ts` | `1298c8e6caaa878e810da1dd6d6bce43498b1e73` |
| `apps/harness-plugin/src/host.ts` | `067a5ea13227c98f05b1198b2f65e073a87d21b8` |
| `apps/harness-plugin/src/host-composition.ts` | `cbfbb492c0e7a57d0a2ac20823224e0278d7c095` |
| `tests/integration/harness-plugin-host-lifetime.test.js` | `e4f17df07d458c090f2ded24e49a05c752d5feb7` |

上述四文件相对原提交的 `git diff --binary HEAD -- <files>` SHA-256 为 `96f34a383f450810f43aa15d7fb85c3b18c8df4156f7ab9086cc9400101101f9`；最终整表后重新计算一致。作者完整 verify（1423/2094/226）是作者证据，本次未冒称重跑完整 suite。真实 Desktop 卸载重载、人类 UAT、ADR/R1 接受仍独立；原 native create 无 cancel ABI 和第三方同步阻塞限制不扩大。复评方不改实现、commit/push、提交公开 review 或执行远端写入；最终归档、提交与远端 head/checks/issue/thread 回读由主控完成。

2026-11-09 实际接合复验：在 #583 rebase 合入后的 `main@1c28c7fc80607cb13ff05bcd71e93aa915233ee2` 上，仅联合 `docs/README.md` 双方索引；已复评四个产品 blob 完全相同。候选 `695fbb7bd10a4a90b73991f3774769a9b15a1597` 的 `pnpm verify` exit 0：typecheck、contract 1423、integration 2126、E2E 226，零 skip/todo；workflow-check 无 findings、boundaries 9/9、disclosure/size/diff check 通过。后续仅补本文及计划证据，最终 head/base/CI/threads/issue 仍按当前版本门回读。
