# PR #324 MMP 交付评审记录

## 锁定事实

- PR：#324 `fix(review): clean mutation harness groups after crashes`
- base：`main` at `79d016920c7a1456ceb617eb4f693df232a7fb38`
- head：`bfd53dd08237c7b6fb4953457b76f50d0f17ecff`
- mergeability：`MERGEABLE`; `mergeStateStatus=UNSTABLE`; `isDraft=false`
- author：`<repository-actor>`; commits：2
  - `720f2f9e` `docs(review): 规划 mutation harness 崩溃清理闭环`
  - `bfd53dd0` `fix(review): 修复变异夹具崩溃清理`
- closing issue：#302；labels：`kind:fix`, `area:tests`, `area:review`
- review threads/reviews at lock time：none

## P0–P3 风险矩阵

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 | 未发现 | 未发现 | 未发现 | `spawn` 的极端 `error` 路径会把未定义 pid 放入组集合，但最终仍走 harness error 清理；没有当前 MMP 阻塞证据 |
| 产品闭环 | 未发现 | 未发现 | 未发现；crash/EPIPE 恢复文件、清理命令组并以 2 退出，interrupt 仍以 130 退出 | 无真实产品数据或外部 Provider 写入；该工具闭环是评审证据生成与失败恢复 |
| 架构边界 | 未发现 | 未发现；变异脚本仍是 `scripts/` 工具，不改变包依赖边 | 未发现 | 生命周期状态集中在 `lifecycle` owner；没有新增跨层依赖 |
| 测试/证据 | 未发现 | 未发现 | 完整 31-mutant 自变异在本轮启动后被停止，未将未完成运行冒充为证据；PR 描述和 ExecPlan 已记录作者在最终树上的 `31/31 KILLED` | 本地契约测试 17/17 通过；新增 crash、post-restore interrupt、baseline leftovers、preflight target 四类反例；H31/H32 已登记 |
| 工作项/重叠 | 未发现 | 未发现；#302 的四项验收均在当前 PR diff/测试中有对应实现 | #302 仍 open，合并后需回读 closing issue；#298/#300 是上游 harness/评审技法来源，不重复承接本批范围 | PR 规模为代码 269/1000、文档 115/1500；`Closes #302` 与 issue 目标一致 |

**矩阵结论：当前 head 未发现 P0/P1；没有阻塞 MMP 交付的缺陷。**

## 分层检查证据

### 代码与失败路径

- `scripts/review-mutate.mjs:114-152` 用 `lifecycle` 统一持有 active child、已登记 process groups、applied snapshot 和 interrupted 状态。
- `scripts/review-mutate.mjs:159-183` 以 `detached: true` 启动命令，保留组号至 `pruneGroups()`；中断时销毁 stdio，避免脱离组的孙进程继续持有管道。
- `scripts/review-mutate.mjs:263-285` 的 `cleanupFailure()` 在未捕获异常、stdout/stderr error 和 Promise rejection 中先 SIGKILL 已登记组，再恢复字节快照，最后以 exit 2 报告 harness error。
- `scripts/review-mutate.mjs:287-298` 保留 SIGINT/SIGTERM/SIGHUP 的 130 语义；第一次信号同步还原并转发，第二次信号 SIGKILL 整组并退出 130。
- `scripts/review-mutate.mjs:196-203` 在任何 baseline command 前解析全部 mutant target；`tests/contract/review-mutation-harness.test.js:549-566` 证明最后一个 target 缺失时 command 从未启动。

### 产品闭环

这不是用户业务功能，而是 MMP 评审证据工具。可验收闭环是：

1. 正常变异仍以 `KILLED`/其他结论输出；
2. harness 自身 crash/EPIPE 时，变异文件逐字节恢复、命令进程组结束、退出码为 2；
3. 用户中断时仍恢复文件、清理 leftovers、退出 130；
4. target preflight 在首个 command 前完成，避免对部分执行结果作出错误结论。

当前 diff 和契约用例覆盖上述四步，没有把测试绿色当成唯一产品闭环证据。

### 架构与信任边界

- 仅改 `scripts/review-mutate.mjs`、其 contract test/fixture 和本批 ExecPlan；未触碰 `packages/*`、Provider、Storage 或规划状态。
- 不引入依赖、不改 spec 形状；工具仍通过 argv 启动 command，不经 shell 拼接。
- `resolveInside()` 继续拒绝 root 外路径、符号链接逃逸和非普通文件。

### 测试与变异证明

本地新鲜验证：

- `node --test tests/contract/review-mutation-harness.test.js`：17/17 pass。
- `node --check scripts/review-mutate.mjs`：exit 0。
- `node scripts/workflow-check.mjs`：no findings。
- `node scripts/rule-checks.mjs size 79d016920c7a1456ceb617eb4f693df232a7fb38`：代码 269/1000、文档 115/1500。
- `node scripts/rule-checks.mjs disclosure 79d016920c7a1456ceb617eb4f693df232a7fb38`：机械扫描通过。
- `git diff --check 79d016920c7a1456ceb617eb4f693df232a7fb38...bfd53dd08237c7b6fb4953457b76f50d0f17ecff`：无输出，exit 0。

PR head 上 GitHub checks：`PR Fast Gate`、`Verify`、`Boundaries`、`Integration`、`E2E`、`MVP-0`、`Merge Gate`、`PR size`、`Disclosure scan`、`Issue policy`、`Reconcile engineering state`、`workflow` 均 success。

完整 self-mutation run 是验收所需的最终树证据；本次评审启动该命令后因耗时较长而停止，未把部分输出写成完成证据。PR 描述与 ExecPlan 已声明最终树上 `31/31 KILLED`，复评者应在 merge 前按 `docs/review/mvp-review.md §2` 重新执行并回读 exit 0、SUMMARY 和工作树干净状态。

### 可选 Create review session

`Create review session` 在 run `38266361336` 失败，日志显示 `curl: (7) Failed to connect to <local-review-endpoint>`。`docs/review/README.md §7` 明确这是 ready 时转发到本地只读评审端点的可选 overlay，端点未运行即失败，不属于分支保护门禁；其失败不构成 P0/P1，也不改变本 PR 的代码结论。

### Issue 验收与重复追踪

- #302 的四项 acceptance criteria 分别对应：EPIPE crash test（`286-323`）、post-restore interrupt（`496-519`）、baseline leftovers SIGKILL（`521-547`）、last target preflight（`549-566`）；self fixture 新增 H31/H32 并保留前述生命周期变异。
- #298/#300 只提供原始 harness/评审技法与已合并实现；通过 issue timeline 和全库检索，没有发现另一个 open issue 追踪本批 crash/process-group/exit-2 缺陷。#302 是唯一直接追踪项。
- PR 以 `Closes #302` 关联；合并前需重新读取 native `closingIssuesReferences` 与 issue 状态，确认没有新 head/目标漂移。

## 结论

当前 immutable head 无 P0/P1，按 MMP 流程应提交一次性 **APPROVE**；`Create review session` 的 optional overlay 失败不阻塞。进入后续修复/收尾前，需补做最终树的完整 31-mutant 自变异并回读 exit 0、SUMMARY 全部 `KILLED`，然后按人类授权的顺序处理 issue 与 rebase merge。

## 复评边界

任何 force-push、rebase、retarget 或合并 main 后，以上结论全部失效；必须重新锁定 base/head、checks、threads、issue linkage，并重新执行相关契约和变异证据。
