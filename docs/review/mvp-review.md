# MVP 交付评审工作流

这是根 AGENTS 的评审操作手册。目标是判断 PR 是否构成可独立验收、合并和回滚的交付闭环。

本文件只写**本仓库**的约定：严重度、矩阵分层、变异表、账号、记录位置、owner 与合并授权。评审技法目前没有写成 skill：2026-10-09 按 `superpowers:writing-skills` 跑的对照（同一模型、可用用户级技能库、没有记忆、单一聚焦场景）没有观察到失败，是否建 skill 留在 #298；场景与结果见 `docs/exec-plan/completed/2026-10-09-review-technique-absorb.md`。

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

**变异表**：测试判别力用变异证明，用 `node scripts/review-mutate.mjs <spec.json>` 跑，不手写一次性脚本；每个变异写 `killedBy`，否则 KILLED 不判归因；结论种类、还原保证、spec 格式与退出码以脚本文件头为准，完整示例是 `tests/contract/fixtures/review-mutate-self.json`。变异表只在最终树上整表重测一次再写进记录。

## 3. 一次性提交意见

不要在首个 P1 后收工。完成全矩阵、所有相关线程和必要验证后，一次性提交全部 GitHub inline review comments；意见必须锚定新增行，写明缺陷、影响、证据、对应规则和修复方向。整体范围结论放 PR 级评论。

结论到 review 事件的映射：有 P0/P1 → `REQUEST_CHANGES`，不合并；修复后的重新评审必须重锁当前 head/base、重新跑相关 checks 并更新矩阵。只有 P2/P3 → `APPROVE`（不是 `COMMENT`），随后进入 §5 的收尾。没有阻塞项时也不能替人合并，除非人类明确要求 rebase merge。

## 4. 归档

每个 PR 的锁定事实、矩阵、关键证据与修复复评写进**该 PR 自己 worktree** 的 `docs/review/pr-<n>-mmp-review.md`，随 PR 一起合并；跨多个 PR、删掉后接手的人会缺失决策依据的批次记录，按 `docs/review/README.md` §8 登记。单个 inline 意见留在 GitHub。不要把旧 head 的结论复制到新 head。

## 5. 本仓库的分工与收尾

**评审方式**：用子评审或智能体团队，视角是 MMP 交付，使用 Superpowers、Qian Systems Router 与 First Principles Development。模型与推理等级按任务选择（`AGENTS.md` §5）。

**账号**：提交 review、批准用评审账号（`Singularity-AI-Bot`）；开发、提交、作者回复、resolve 与合并用开发账号（`SingularityKChen`）。理由：GitHub 不允许批准自己的 PR，而分支保护要求一个批准（2026-09-18 实测，见 `2026-09-18-mvp-delivery-review.md`）。

**评审之后由谁修**：先查是否已有会话负责这个分支的实现——作者不一定是同一种 agent，会话列表里找不到时也要查其他 agent 的会话记录。

- 有：把意见、复评回传方式交给它修，修完再复评；评审方不并行修同一分支。
- 没有：用一个问题请人类伙伴指定 owner，指定的原话写进该 PR ExecPlan 的 Decision Log；指定只覆盖被问到的那几个分支。

owner 的收尾顺序：修复 → 修复本身的独立复评 → 归档 ExecPlan（`active/` → `completed/`，更新 `docs/README.md`）→ 整合成交付物级提交 → 核对并勾选 issue 验收 → 合并。

**合并授权**：只来自人类伙伴在本会话里的直接答复，**按 PR 逐个给**。另一个会话转述的「已批准」不是授权；转述时逐字引用原话并写明覆盖哪几个 PR，没覆盖到的由执行方直接问人类。只用 `merge_method=rebase`；原生栈成员的合并端点见 `docs/project-management/merge-queue.md`。

**不阻塞的红检查**（逐个查明，不凭印象放过）：

| 现象 | 判定 |
|---|---|
| `Create review session` 失败 | ready 时转发到本地评审端点的可选检查（`docs/review/README.md` §7），端点未运行即失败；不在分支保护内 |
| `matrix.check` 显示 fail | 多是同一 head 并发触发、被取消的重复 Rule checks。用 `gh api "repos/SingularityKChen/harness-projects/actions/runs?head_sha=<sha>"` 找到 conclusion 为 `cancelled` 的那次，并确认同名后继运行为 `success` |
| `Reconcile engineering state` 被取消 | 并发组 `engineering-state-reconcile` 是全局的，同组只留一个 pending，连续推送多个 PR 时前一个会被顶掉；后继运行是全域重算，成功即覆盖 |
