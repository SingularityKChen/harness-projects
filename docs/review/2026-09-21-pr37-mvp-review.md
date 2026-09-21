# PR37 最终评审记录

> 状态：Completed
> 评审日期：2026-09-21（Asia/Shanghai）
> PR：[#37](https://github.com/SingularityKChen/harness-projects/pull/37)
> 关联 ExecPlan：[2026-09-21-engineering-state-trust-boundary](../exec-plan/completed/2026-09-21-engineering-state-trust-boundary.md)

## 锁定事实

- 原始评审 head：`258c19981280f595ede0a52e243bf1e6a3f9d171`
- rebase 基线：`origin/main@61d68330611f6fc18485f61f594a918d9946ebef`
- 原始 base：`528ff4e002a2264375e8797b9e59270731b885aa`
- 关联 issue：#36
- 当前分支：`chore/engineering-state`
- 恢复锚点：`backup/chore-engineering-state-20260921-135602`

## 风险矩阵结论

| 层 | 结论 | 证据 |
|---|---|---|
| 代码 | 无新的 P0/P1/P2 | snapshot reconcile、GraphQL/HTTP/JSON/ack fail-closed、signal 判定表与写入边界通过契约测试 |
| 产品闭环 | 规划 `Status` 与工程 `Engineering` 正交 | workflow 只写稳定 ID 指向的 Engineering 字段，确认日志等待匹配 ack |
| 架构 | 信任边界成立 | signal 无权限/secret/checkout；消费者只 checkout 默认分支；不读取 PR 可改写 artifact |
| 测试 | 判别性覆盖充分 | `pnpm verify` 236 pass / 0 fail；workflow-check no findings |
| 工作项 | 范围与发布面合规 | `Closes #36`、size 代码 787/1000、文档 213/1500、disclosure 与 diff-check 通过 |

## 评审意见与修复

首轮 P0/P1 已在后续提交中按根因修复：action 40 位 SHA pin、GraphQL transport 与 mutation ack fail-closed、稳定字段 ID、默认分支可信执行、snapshot 完整性、删除可伪造 artifact、以及区分 signal job 的合法 skipped no-op 与输入缺失失败。当前 head 未发现新增阻塞项。

由于评审账号为 PR 作者，GitHub 上提交的是作者侧集中 `COMMENT`，不构成独立 maintainer approval。评审链接：[PR review 5263402672](https://github.com/SingularityKChen/harness-projects/pull/37#pullrequestreview-5263402672)。

## 合并收尾

分支已 rebase 到 `main@61d6833`，文档与 ExecPlan 已更新并归档，提交已整理为单个可审阅提交。最终使用 rebase merge 合入 main；合并前重新回读当前 head/base、checks、issue 关联与 review threads。
