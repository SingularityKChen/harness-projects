# PR #288 MMP 评审记录

## 锁定事实

- PR #288「test(tests): complete capability driven development contracts」，Closes #205。
- 第一轮评审 head `6daa845b`，base `main@6417d459`，7 个提交；PR Fast Gate 与 Verify 在该 head 上 success；`Reconcile engineering state` 的失败是 ready 时被取消的重复运行。
- 作者是 Codex 会话，人类伙伴指定评审会话接手修订与合并。

## P0–P3 风险矩阵（第一轮）

| 层 | 结论 |
|---|---|
| 代码 | `declares` / `implemented` / `assertUndeclaredRejected` 在正常与拒绝路径上成立；两条「未声明 × fault」断言以不成立的理由被删除（P2）；CR 读的未声明路径没有 objects 检查（P2） |
| 产品闭环 | #205 的四条验收对五个可选方法成立 |
| 架构 | 不改 `packages/`；suite 只 import capabilities |
| 测试 | `objects-alias` 负控永远不会因自身原因失败（P2）；若干断言恒真或没有负控（P3） |
| 工作项 | 代码 837/1000，超过 800 的规划上限但有说明；ExecPlan 有过时事实（P3） |

结论：0 × P0 / P1，3 × P2、8 × P3，APPROVE。其中一条 P2 是相对 base 的判别力回归：liar 探针 `cr-read-undeclared-offline-first`、`cr-create-undeclared-ambiguous-first` 在 base 上 RED、head 上 GREEN。

## 修复与复评

- 第一轮修复：按 base 原文恢复两条断言并新增仓内负控；CR 读的未声明路径改为完整判定，并加 4 个 liar；测量证明快照克隆才是承重点，于是删掉 alias 断言、把负控改为合法 adapter；矩阵只按失败消息判别。
- 修复复评：0 × P0–P2、5 × P3，其中最重要的一条是取样与重读只克隆一侧。第二轮改为注册时把 `expect.objects` 包成每次克隆，并补了谱系输入 liar、子进程固定 spec reporter、故障边界补上 getWorktree。
- 最终：契约 + Local Git 124/124；全量 1265/1265；代码 917/1000；与 #287 的并集 1289/1289。
- 提交整合为规划 / 测试交付物 / 归档三个（整合时发现第一个提交会回退 main 的索引行，改为只应用本 PR 的行），复评 APPROVE 后 rebase merge（main `cd30f20f` → `d85ef565` → `ebe6dc40`），#205 关闭。
