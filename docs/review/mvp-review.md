# MVP 交付评审工作流

这是根 AGENTS 的评审操作手册。目标是判断 PR 是否构成可独立验收、合并和回滚的交付闭环。

## 1. 锁定事实

先记录 PR number、baseRefName、headRefOid、mergeable、mergeStateStatus、draft、所有 commits、review threads 和 checks：

    gh pr view <n> --json baseRefName,headRefOid,mergeable,mergeStateStatus,isDraft,commits,closingIssuesReferences
    gh pr diff <n>
    gh pr checks <n>
    gh api repos/{owner}/{repo}/pulls/<n>/reviews
    gh api repos/{owner}/{repo}/pulls/<n>/comments

force-push、rebase 或 retarget 后，旧结论全部作废。评审证据必须指向当前 immutable head；历史摘要不能代替当前 diff。

## 2. 风险矩阵

先建立覆盖 P0、P1、P2、P3 的矩阵，再进入逐文件审查。矩阵至少包含：

| 层 | 检查 |
|---|---|
| 代码 | 正常 / 失败路径、错误传播、状态机、幂等和恢复 |
| 产品闭环 | 用户结果、规划轴 / 工程轴、外部写入确认 |
| 架构 | 七条不变量、依赖边、事实所有权、信任边界 |
| 测试 | 判别性断言、分层覆盖、命令真实输出、缺失故障路径 |
| 工作项 | issue scope、acceptance、ExecPlan、PR 规模、标签和 closingIssuesReferences |

判定：P0 是合并即破坏 main 或硬约束；P1 是严重正确性 / 安全 / 不变量缺陷；P2/P3 是不阻塞交付的小问题。P2/P3 先判断是否机械修复会扩大范围或制造冲突。

## 3. 一次性提交意见

不要在首个 P1 后收工。完成全矩阵、所有相关线程和必要验证后，一次性提交全部 GitHub inline review comments；意见必须锚定新增行，写明缺陷、影响、证据、对应规则和修复方向。整体范围结论放 PR 级评论。

若出现 P0/P1 阻塞，不合并；修复后的重新评审必须重锁当前 head/base、重新跑相关 checks 并更新矩阵。没有阻塞项时也不能替人合并，除非人类明确要求 rebase merge。

## 4. 归档

把跨 PR 的矩阵、合并顺序和关键证据写入对应 worktree 的 docs/review/；单个 inline 意见留在 GitHub。不要把旧 head 的结论复制到新 head。
