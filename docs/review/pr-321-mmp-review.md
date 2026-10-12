# PR #321 MMP 交付评审

- 评审对象：PR #321 `fix(controller): coalesce in-flight replays and refresh Pending results`
- 评审视角：MMP 交付闭环（代码、产品、架构、测试、反例、Issue/ExecPlan）
- 锁定时间：2026-10-12（Asia/Singapore）
- 锁定 base：`main@ee07c323194dd13fbfc093add0639acd0e55998b`
- 锁定 head：`fix/controller-live-replay-impl@a0515854ff0b710a600d6d1ce390d2c31de85604`
- PR 状态：ready，`mergeStateStatus=CLEAN`；最终 head 的复评以当前 SHA 重新绑定
- 关联 Issue：`Closes #307`，`closingIssuesReferences=[#307]`
- 评审 worktree：`.worktrees/fix-controller-live-replay-impl`

## 1. 目标、事实与边界

PR #321 要解决 Controller replay 的三个生命周期问题：同一完整请求并发时只执行一次；Rejected Promise 不把 in-flight 卡死；Start Work 的 Pending/Unknown 结果不被 Controller 永久冻结，后续调用重新进入 Core，由 Host durable 状态与 read-back 给出当前结果。

实现只改 `packages/controller/src/commands.ts`、Controller E2E 和本 ExecPlan。Controller 维护的是进程内短生命周期优化；Start Work 的持久幂等账本、execution context、run 和关系事实仍由 Core/Storage 拥有。没有 Storage schema、Provider API 或 wire DTO 变更。

## 2. P0–P3 风险矩阵

| 严重度 | 代码 | 产品闭环 | 架构边界 | 测试/反例 | Issue/ExecPlan |
|---|---|---|---|---|---|
| P0 | 未发现会破坏 main、越过身份门或造成不可逆外部写入的缺陷 | 未发现会把未确认写入显示为权威 Saved 的路径 | 未发现反向依赖或第二个持久权威 | 关键 required checks 与全量测试通过 | #307 的范围与当前实现一致，未发现重复承接同一 scope 的 issue |
| P1 | 未发现同请求重复 Core、同键异指纹共享 Promise、拒绝后永久挂死或终态重放重复写的可复现缺陷 | Start Work 的 Pending/Unknown 会跳过 terminal cache；冲突返回结构化 conflict；Rejected 后可恢复 | fingerprint 先于 in-flight claim；Host ledger/read-back 仍是 Core/Storage 责任 | barrier、identity conflict、reject recovery、Pending→Confirmed 反例均通过 | 不存在阻塞 MMP 的验收缺口 |
| P2 | 原初评审缺少 `rerunPipeline` barrier 与 durable progression 证据；本修复批次已补 rerun barrier，Unknown durable progression 仍明确由 Core/Storage 负责 | 当前 Controller 只证明不缓存 Unknown、下一次调用重新进入 Core，不复制 Host 状态 | 无边界违规；这是证据完整性和未来回归风险，不是当前架构错误 | rerun barrier 与 Pending cache 变异均 KILLED；Unknown 权威验收留在 Core/Storage | P2 已处理；Unknown 端到端 progression 不在 Controller owner 范围 |
| P3 | 初轮 ExecPlan 计数/Batch 事实曾漂移 | 不影响运行行为 | 不改变事实所有权 | 当前 head 与 61/1485 计数已回填 | 归档时继续回读最终 head/checks |

## 3. 分层检查证据

### 代码

- `createReplayLog` 先计算 PR #317 的完整 fingerprint，再检查 terminal cache，再检查 in-flight；同 key 同 fingerprint 返回同一 Promise，同 key 异 fingerprint 立即返回 `Conflict`。
- `run` 通过 `Promise.resolve().then(run)` 在登记后执行，避免两个同步调用都 miss；成功后只把非 `startWork + Pending/Unknown` 的结果写入 terminal cache。
- `finally` 以 Promise identity 比较后删除 in-flight，旧任务不会误删新任务；拒绝结果不进入 terminal cache。
- `startWork` 的 fingerprint 包含 actor、work item、repository、branch/worktree payload；这与 PR #317 的 canonical identity 组合保持一致。
- `refreshDeliveryFacts` 继续绕过 replay，因为它是每次真实读取；没有把 Pending/Unknown 盲重试泛化到没有 durable/read-back 合同的命令。

### 产品闭环

- 同请求并发的 first/second 共享结果，Core 调用计数保持 1。
- in-flight 期间同 key 异 actor 立即得到 `conflict`，不调用 Core、不等待首个 Promise。
- 首次抛出后 in-flight 被清除，第二次同请求可重新运行并取得结果。
- Start Work 首次 `pending` 后，Controller 不缓存该结果；下一次同请求重新调用 Core，测试观察到 `confirmed`。
- 终态 replay 仍由既有测试保证，不再追加 Provider 写入。
- 进程重启后的持久语义未由 Controller 声称；Core/Storage 的既有 recovery 测试继续覆盖 durable ledger、execution context、run 和 read-back。

### 架构边界

- 改动范围为 Controller、Controller E2E 和 ExecPlan；`pnpm run boundaries` 通过（8/8）。
- 没有 UI 调 Provider、Controller 直连 Storage、Provider 互调或第二个规划/工程权威源。
- #317 的 request identity 是前置约束；#321 只增加 in-flight 生命周期，不重做 canonical encoder。

### 测试与反例

本地在 `.worktrees/fix-controller-live-replay-impl` 执行：

- `node --test tests/e2e/controller-roundtrip.test.js tests/e2e/start-work.test.js tests/e2e/write-machine.test.js`：61/61 通过。
- `pnpm test`：1485/1485 通过。
- `node_modules/.bin/tsc --noEmit`：通过。
- `pnpm run boundaries`：8/8 通过。
- `node scripts/workflow-check.mjs`：无 findings。
- `node scripts/rule-checks.mjs size ee07c323`：代码 139/1000、文档 185/1500，通过。
- `node scripts/rule-checks.mjs disclosure ee07c323`：机械扫描通过。
- `git diff --check ee07c323...HEAD`：通过。
- 变异验证：删除 Pending/Unknown terminal-cache 排除条件，定向 Pending 用例 `KILLED`；禁用 in-flight cleanup，reject recovery 用例 `KILLED`。变异后文件由 harness 逐字节还原。
- `rerunPipeline` 同 key barrier 并发调用，Core boundary call count=1；删除只对 `startWork` 合并的变异后该新用例失败，并由 `review-mutate` 判定为 KILLED。Fake Provider 对目标 pipeline rerun 能力为 unavailable，因此没有伪造 Provider 外部写入。
- GitHub 当前 head 的 PR Fast Gate、Merge Gate（Integration/E2E/MVP-0/Boundaries）、Issue policy、Resolve PR base、PR size、Disclosure scan 和 Engineering state checks 均为 SUCCESS。

### 反例与限制

已覆盖：并发同请求、in-flight 同键异请求、Rejected Promise、Pending→Confirmed、跨 command 同 key isolation、对象键序/undefined/null/数组顺序身份、终态 replay。

边界说明：

1. `rerunPipeline` 已有 Controller barrier 与 Core boundary 调用计数证据；Fake Provider 对目标外部写能力为 unavailable，因此不伪造 Provider side effect。
2. Controller 不直接读取 Host durable ledger；Unknown progression 的权威验收由 Core/Storage recovery 契约负责。Controller 只验证 Unknown 不缓存、下一次调用重新进入 Core，避免建立第二个事实源。

## 4. Issue / ExecPlan / 重复问题检查

- Issue #307 仍 OPEN，正文 acceptance 与 PR body/ExecPlan 的目标一致；PR 通过 `closingIssuesReferences=[#307]` 绑定。
- #306 已合并，提供完整 request identity；#321 以 `main@ee07c323` 为 base，未把 #306 的旧 stack 当作当前基线。
- #194（Core Start Work idempotency）、#193（resumable execution）、#204（pending write attempt）和 #235（后续 Provider 写路径）是相邻的 durable/recovery scope，不是 #307 的重复实现。
- 未找到另一条 issue 追踪同一 Controller live replay scope；`gh-review issue list` 的相关搜索只返回 #307 及上述有边界差异的 issue。
- ExecPlan 仍位于 `docs/exec-plan/active/`；Batch 3 已完成，Outcomes 已回填 61/1485 与当前 head。合并后按流程归档。

## 5. 结论

**初次结论：无 P0/P1，建议 APPROVE。**

PR #321 当前 head 在 MMP 视角下形成可独立验收、合并和回滚的 Controller replay 生命周期闭环。当前仅剩合并后归档 ExecPlan 与最终状态回读。

## 6. P2/P3 修复复评

- 新增 `rerunPipeline` 同键并发 barrier 测试，使用真实 Controller replay 和可控 Core boundary stub；调用计数为 1，两个调用返回逐字相同的 command result。
- 对 `createReplayLog` 注入“只对 startWork 合并”的变异后，新用例失败并被 `review-mutate.mjs` 判定为 `KILLED`；变异文件已逐字节还原。
- Fake Provider 当前对目标 pipeline rerun 能力不提供可用端到端外部写路径，因此测试停在最小 Core boundary，明确验证 Controller 的责任边界；Provider 真实副作用仍由 Provider/Core contract tests 覆盖。
- Unknown durable progression 不在 Controller 层复制验证：Controller 无 Storage/Host ledger 访问权，若在此读取会建立第二个事实源。ExecPlan 已明确 Controller 只验证 Unknown 不缓存、下一次调用重新进入 Core；run 状态、租约、ledger/read-back 的权威 progression 由既有 Core/Storage recovery 测试验收。
- ExecPlan Batch 3 已标记完成，Outcomes 更新为当前 head、61 项定向测试和 1485 项全量测试，并记录上述边界决定。

修复后风险结论：P0/P1/P2 均未发现；原 P3 文档时序漂移已修复。当前 head 为 `a0515854`，checks 已重新回读，建议保持 `APPROVE`。
