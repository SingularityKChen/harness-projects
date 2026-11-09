# PR #568 / #569 / #581 MMP 评审与条件收尾

> 状态：Completed
> 完成边界：工程验收；最终运输/合并按条件门执行。
> 创建：2026-11-09
> 范围：三个既有交付分支的独立评审、必要修复复评、记录和条件 rebase 合并。
> 格式：仓库根 `PLANS.md` 为规范。

## Purpose / Big Picture

确认已确认 PR 的负责人分配（#568 / #567）、创建时负责人意图（#581 / #557）与跨项交付总览（#569 / #281）分别闭环，并在共同产品树中保持精确身份、持久恢复和诚实交付状态。工程合并不代表安装、人类 UAT 或 R1 接受。

## Context and Orientation

三个分支分别为 `feature/pr-assignee-management`、`feature/pr-assignee-creation`、`feature/delivery-overview`，各自证据写入自身 `docs/review/pr-<n>-mmp-review.md`。本轮初始 main 为 `7bab4b8c79eb497e16d4bb490f2a33d83863be35`；初始 head 依次为 `8f0e2f8a`、`773d117f`、`c6dcf8c1`。原生 stack #582 只包含 #568 → #581。原实现会话“筛选紧急交付 Issue”可接收阻塞问题；非阻塞收尾由本次评审者负责。

## Design / Spec

先覆盖 P0–P3 风险矩阵，再分层检查代码、用户结果、架构、测试判别力、反例、issue 验收和重复跟踪。三名独立子审查者分别负责一个 PR；整合者复核证据和共同谱系组件。每个 immutable head 的全部 inline 意见一次提交。P0/P1 为 REQUEST_CHANGES；无阻塞为 APPROVE。评审账号为 Singularity-AI-Bot，开发、回复与合并账号为 SingularityKChen。

## Global Constraints

保持七条系统不变量、规划状态所有权与 Provider 读回确认。现有 worktree 只按自身文件归属写入。本批新增或维护的正式文件为本计划、三个 `docs/review/pr-<n>-mmp-review.md`、批次评审记录、`docs/review/README.md`、`docs/README.md`、`docs/project-management/merge-queue.md` 及被明确发现缺陷要求修改的原模块；代码改变先以反例证明再最小修复。#569/#581继续原任务代码<800、文档<1300；#568按本节Decision Log中的人类直接裁定改为仓库代码≤1000硬上限，文档<1300保持。当前完整候选反馈修复980行，不删判别测试或机械压行。

## Plan of Work

### Batch 1 · 独立评审

锁定远端 head/base、所有 checks/threads/commits、双向 issue 关联和原生栈。各自完成风险矩阵和最窄有效验证，整合后一次性评审。涉及文件见 Global Constraints。

验证：在各自分支根运行 `pnpm test:file <该 PR 受影响的现有测试>`，期望零失败；`gh pr view <n> --repo SingularityKChen/harness-projects --json headRefOid,baseRefOid,statusCheckRollup,closingIssuesReferences` 与 GraphQL 分页读完 reviewThreads、issue closedByPullRequestsReferences，期望对应当前版本、关联准确、无遗漏线程。命令的实际测试集合及结果写各自评审记录，不把集合相加。

### Batch 2 · 条件修复与组合

阻塞项交原 owner，修复后重锁版本；非阻塞项由本会话最小修复并独立复评。按 #568 → #581 → #569 在临时 clone 重放，合并共享组件时保留 summary 隐藏写区、`scopeKey` 创建子树和独立刷新参数。

验证：在重放完成的临时 clone 根运行 `pnpm install --frozen-lockfile --offline`、`pnpm verify`、`pnpm test:browser`、`pnpm boundaries`、`node scripts/workflow-check.mjs`；期望全部通过。产品树与最终真实合并候选逐 blob 比较，不以旧头测试代替新差异。

### Batch 3 · 记录与条件整合

归档本计划，整理为能力提交加有独立意义的验收记录；核对 issue 验收，保持父项与人工门。共享历史修改先建立 `refs/backup/pr<n>-before-mmp-review-20261109`，push 使用精确旧远端 head 的 lease。

验证：各最终分支根运行 `node scripts/rule-checks.mjs disclosure <实际base>`、`node scripts/rule-checks.mjs size <实际base>`、`git diff --check <实际base>...HEAD`，期望通过；人工检查凭据、本机身份、账号个人信息、内部系统和保密字样。最终 push 后重新读完整 checks、base/head、threads、issue 双向关联和当前批准。独立 PR 用带预期 head 的 rebase 端点，原生栈用 `merge-async` 并显式 `merge_method=rebase`，随后回读 PR/issue/main。

恢复：保留原数据库与外部平台事实；必要时按能力提交 revert，恢复分支先核对备份引用与远端并发变化。Git revert 不撤销外部 PR 或负责人。

## Validation and Acceptance

先确认#568实际规模不超过已明确裁定的1000行代码硬上限，再进入发布/合并门。每个 PR 的 issue 行为均有明确证据或真实缺口说明；没有未决 P0/P1；新增修复有独立复评；真实最终版本检查、批准与关联准确；三个 PR 按授权和真实前序整合。安装、人类 UAT、发布门分别列明。

## Progress

- [x] (2026-11-09 SGT) 锁定三个初始版本、双账号、完整空线程和双向 issue；三名子审查者已建立矩阵并开始检查。
- [x] (2026-11-09 SGT) 完整首轮矩阵无 P0/P1；#568/#569 各一 P2、#581 无新增问题，三个 immutable head 均已一次性提交全部意见并 APPROVE。
- [x] (2026-11-09 SGT) 三项P2及托管反馈竞态均根因修复并独立复评，最终组合验证完成。
- [x] (2026-11-09 SGT) #568预算门：用户直接答复“改为 1000 行硬上限”；当前980行在授权内，最终提交仍重新计数。
- [x] (2026-11-09 SGT) 已归档工程记录、准备交付提交和issue验收；最终push/CI/合并严格按下列当前版本门与回读执行，不预写成功。

## Surprises & Discoveries

通用技能附带 lint 期待 `Concrete Steps` / `Artifacts and Notes`，与本仓库 PLANS.md 的13个强制章节不同；本计划按仓库规范逐节核对，不为满足通用 linter 改写本地格式。

完整顺序重放在 #569 的 `delivery-lineage-section.ts` 发现两处文本冲突；必须联合参数与创建子树条件，不能任选一边。旧组合证据只作预期对照，本轮重新验证实际重放树。

## Decision Log

2026-11-09 SGT / 按用户明确顺序先归档工程ExecPlan，再整理最终提交、核对issue及执行条件rebase合并。此Completed标记只确认工程验收已完；最后#569的运输和合并结果以当前API回读命令为准，不在文件中预写未来SHA。#568/#581已实际rebase合并，#567/#557已CLOSED。

2026-11-09 SGT / 用户直接答复#568预算问题：“改为 1000 行硬上限”。该裁定替代#567原任务代码<800的限制，仅覆盖本次被问到的#568；文档<1300和其它PR任务预算保持。Rationale：完整修复与隔离反例维持同一可验收闭环，不靠删安全测试压缩规模。

2026-11-09 SGT / 用户直接授权覆盖 PR #568、#569、#581：“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并。”该条件授权允许本会话完成三个非阻塞分支；发现 P0/P1 且已有实现会话时先交回修复。本轮不改 Planning Status 或 blocked-by / blocking。

2026-11-09 SGT / 整合者：选择 #568 → #581 → #569，先完成真实依赖栈再接独立总览；顺序只服务工程整合，不产生规划依赖。使用 gpt-6.1-sol high 审总览、xhigh 审两个涉及持久身份和外部写入的层。

## Idempotence and Recovery

远端读可重复；评审和 issue 更新在本地保存请求正文并用当前 head/目标作幂等标识，执行后回读。merge 前重新核对当前状态与 head；并发变化即返回评审门。所有已发布旧头先留恢复引用，临时 clone 不推远端。

## Interfaces and Dependencies

依赖 GitHub 双账号、原生 stack #582、现有 pnpm 工具链与浏览器。各 PR 原有 Completed ExecPlan 继续承载产品设计，本计划只承载评审和条件收尾。技术债以实际新发现为准，不为未改变的人工接受门新建重复 issue。

## Outcomes & Retrospective

首轮两P2与隔离复评新增的#581一P2全部修复；上游托管反馈竞态另以真实时序RED→GREEN闭环，独立复评无未决P0–P3。当前#568代码980（用户裁定≤1000），#581净层670、总览466均保持任务预算。实际#568/#581原生栈以rebase合并，main c2e2f738的完整树等于批准B树，#567/#557CLOSED；总览在该真实main上接合，501个非docs文件逐blob等于最终受验组合。

完整验证：da854969非browser层1423/2072/226与typecheck通过；该临时组合的测试文本拼接漏闭合被验证抓住后，只修复browser块，4032a6f4的全部browser77/77、boundaries9/9与workflow7文件通过，production和其它测试逐字不变。#568新pull_request CI689fb170和#581 b0561f3f当前Verify/Browser/Fast Gate成功后完成批准/线程/issue回读并合并。手动CI成功不能代替PR上下文门，第一次原子合并拒绝且未合任何一项；已在原记录保存。

最后#569产品/测试树已与受验manifest一致；其最终head CI、批准、threads、issue及merge由下列既定命令读取后执行。没有新增有意延后的实现债务；原有安装、人类UAT、R1与Planning Status保持原所有权。

## Bottom Change Note

2026-11-09 SGT：建立本轮风险、分工、直接条件授权、组合验证和恢复控制。

2026-11-09 SGT：补充首轮一次性review、P2根因处置、当前组合全量验证及任务预算未决事实。

2026-11-09 SGT：就地订正#581首轮无问题结论的范围，记录旧测试同时改变Issue权限造成的隔离缺口与补充评审。

2026-11-09 SGT：记录用户明确1000行硬上限裁定，解除#568预算未决门，保留原测算与修复证据。

2026-11-09 SGT：工程验收归档到completed，记录真实AB合并、最终完整组合、CI上下文教训与最后C条件门；不预写C合并结果。
