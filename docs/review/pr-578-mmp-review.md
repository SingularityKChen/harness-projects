# PR #578 MMP 交付评审

## 锁定事实

- 日期：2026-11-07；审查及末次远端回读 head `82cd0717a741492d95c7b37bf1d16665a442b5ef`，base `c1975c20aeffa960a980f01dd321e38261008f59`（`main`）。
- 目标：Host push 快照/修订恢复、重连、调用方与公共 API 退役。
- 评审范围：代码、产品闭环、架构、测试与反例、issue 验收、设计适度性和重复追踪。
- 两个提交为计划和最终实现；`MERGEABLE`、ready、尚无 review decision；关联 `Closes #575` 正确。初始 reviews/comments 均为空。
- 方法：Superpowers 独立代码评审、Qian 系统接口/恢复闭环核对、First Principles 从真实消费链与失败后用户结果反推证据。

## 预置风险矩阵（先于逐文件审查）

| 级别 | 风险假设 | 判别证据 | 当前结论 |
|---|---|---|---|
| P0 | 删除破坏 main、发布门禁或系统硬约束 | 不改门禁、状态所有权、Provider ack 或凭据；typecheck、边界 9/9 | 无可行动项 |
| P1 | 退役误删仍在使用的行为、安全/恢复路径或 CI 覆盖 | 所有生产调用方、帧原子拒绝、Host 代际、gap、载体断开和监督者退避；相关 248/248 | 无可行动项 |
| P2 | 验收遗漏、证据失真或边界说明不完整 | #575 三项 acceptance、完整生产/测试 diff、现 head hosted checks | 无可行动项 |
| P3 | 文档、命名或维护成本问题 | 删除而不搬迁 pull 生命周期；private API 的有意破坏与 revert 边界已披露 | 无可行动项 |

## 分层证据与反例

1. 代码：逐项审读 `sync.ts`、`stream.ts`、`index.ts` 和删除的 `transport.ts`。保留的 `acceptBaseline/applyEvent/accept` 仍在改 store 之前校验帧/时钟，跨 Host generation 的 delta/metadata 被拒；同 generation 的低 revision baseline 被拒，新 Host 可 reset。删除的 `FrameRejectedError` 只曾供已退役的 pull guard 分类，直接 `receive` 仍同步抛 `TypeError`。`receive` 原先的 transport.close 在生产注入对象上本来就是空操作。
2. 产品与架构：`apps/harness-plugin/src/workspace-watch.ts` 的真实链仍是 `openWorkspaceWatch → superviseWorkspace → followWorkspace → createSync`；物理流、重连和退避属于 Host/follower/supervisor，receiver 只接受帧。`followWorkspace` 每代唯一开场 baseline、gap 后 restart、close 后吸收迟到帧；supervisor 终止后保留 stale 最后值并有界退避。没有增加前端权威，也没有改规划轴或外部写入确认。package 为 private；全仓调用方已迁移，无兼容壳。
3. 测试退役核对：删除的 14 个用例仅覆盖已删除 pull promise 票据、并发 poll、Transport seed；没有将旧实现复制进 fixture。Core/Controller/SQLite 的 identity、权限遮蔽、来源确认时间、Host restart 与原子拒帧断言仍在原测试中，只改为显式投帧。浏览器 factory 仍构建真实 store/sync/stream，不引入 controller 根运行时依赖。
4. 判别性反例：保留且实跑的用例分别覆盖非法 clock 不部分更新、坏 capability/帧保持深相等、低修订无 generation 证据拒绝、合法前游标 gap 先 stale、普通物理重连不能冒充 Host reset、Host 终止与同步 connect 抛错的恢复，以及 native denial 使旧 receipt 失效。测试没有只检查正常路径。
5. 工作项/设计：#575 的真实 push 接入、独有证据迁移和独立可回滚范围均成立。生产净删 127 行、代码与测试 churn 786；不新增依赖、兼容模式、数据库或 CI 改动。删除第二套未使用生命周期符合当前系统职责，不需要新抽象。
6. 重复追踪：用 `gh issue list --state all --search` 查询 client sync、pull 标题；唯一直接退役项为 #575，#178 是已关闭历史读取装配。review-session 红检查已由 open #364 承担，未重复登记。

## 验证与结论

执行上下文：`.worktrees/client-push-only-20261107`，上述 immutable head。独立复跑两组共 14 文件，均退出 0：

```text
pnpm test:file tests/e2e/client-sync.test.js tests/e2e/client-stream.test.js tests/e2e/workspace-read-assembly.test.js tests/integration/harness-plugin-host-watch.test.js tests/contract/client-browser.test.js tests/integration/sync-revision-freshness.test.js tests/integration/source-number-restart.test.js
tests 121; pass 121; fail/cancelled/skipped 0
pnpm test:file tests/e2e/repository-routing.test.js tests/contract/issue-closing-links-reader.test.js tests/integration/harness-plugin-host-planning-mapping.test.js tests/integration/harness-plugin-issue-closing-links.test.js tests/integration/harness-plugin-planning-refresh-ui.test.js tests/integration/ui-work-item-detail-read.test.js tests/integration/workspace-setup-commands.test.js
tests 127; pass 127; fail/cancelled/skipped 0
pnpm typecheck                            # exit 0
pnpm boundaries                           # 9/9, exit 0
git diff --check c1975c20...HEAD            # exit 0
```

现 head hosted `PR Fast Gate`、Verify、Browser、Merge Gate 与披露/规模成功。`Create review session` 的 run `42352774815` 日志明确为回调端点返回 404（exit 1），属于 #364；Rule checks 被取消运行 `42352403923` 有同 head 后继 `42352404376` 成功，engineering reconcile 被取消有同 head 成功记录 `42352403951`。不将可选服务失败说成产品失败，也不称全部检查全绿。

未发现可行动 P0/P1/P2/P3；建议整合者在必要重新锁定后 APPROVE。未提交 GitHub review、未提交或推送。本地测试与 hosted 工程证据不代表安装产品、人类或 R1 接受；两项退役在共享测试文件上的合并后组合仍由整合者验证。

## 最终树变异表

在上述 head 最终源码上执行一次整表：`node scripts/review-mutate.mjs .superpowers/mmp-review-final-mutation-20261107/spec.json`。仅使用既有 `tests/e2e/client-sync.test.js`；基线和还原后基线由夹具检查为绿，夹具退出 0。

| ID | 位置/变异 | killedBy 与实际失败归因 | 结果 |
|---|---|---|---|
| M578-cross-generation | `packages/client/src/sync.ts` 的 `validateFrame`：把跨 generation 拒绝条件附加 `&& false`，允许旧 Host 帧进入接受点 | `generation 是 required opaque string；坏 baseline 和跨代 delta/metadata 在 clock 前原子拒绝`；实际失败名与 killedBy 完全一致，mutated run exit 1 | KILLED（1/1） |

夹具按原字节恢复并自检；独立复核源码 SHA-256 前后同为 `34b5127446e0a0d224c7d71562d6f9483ba3427856e5adb1cd51609e0529dd45`。执行前 tracked 状态为空；执行后 tracked 差异仅为整合者同步补充的 completed ExecPlan 文档，整合者已确认其拥有权；相对 branch HEAD 没有生产/测试差异。运行日志与独立恢复回执位于同一运行目录的 `result.log`、`restore.json`；没有存活变异或新增测试/源码修改。
