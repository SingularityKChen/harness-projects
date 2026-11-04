# 四项 MMP 交付评审与收尾 ExecPlan

> 状态：Completed（工程审查与合并门准备）；创建：2026-11-04；协调检出：`docs/core-release-evidence`。
> 关联：PR #534/#535/#536/#541；Refs #451、#532、#533、#540、#459。

## Purpose / Big Picture

对四个独立交付作全矩阵审查，发现一次性提交并按严重度分流；没有未决P0/P1、独立复评与当前门禁通过时，按用户直接条件授权逐条rebase merge。工程结论不替代发布或人类UAT。本计划归档界限是四项修复/复评、独立交付和最终合并门准备完成；实际merge ack由GitHub及协调会话逐条回读，避免用待发生事件充当已完成证据。

## Context and Orientation

初始base为`f0883948`，四个PR均Ready且无既有review threads。对应工作区分别为`.worktrees/browser-execution`、`.worktrees/backup-rollback`、`.worktrees/release-evidence`、`.worktrees/host-policy-admission`。原实现会话已核实负责四条分支，处于完成交付状态。每项review记录放各自`docs/review/pr-N-mmp-review.md`。

事实、约束、决策和未知分开：现有必需检查成功是事实；七不变量、保留原数据及两账号分离是约束；独立审查与串行整合是决策；完整R1、当前安装候选、人类UAT和人员可用性仍属未决。

## Design / Spec

比较立即合并、逐条独立审查和统一巨型修复：立即合并无法证明闭环；统一修复扩大回滚和owner范围；选择三路独立评审加协调者第四路及跨PR综合。各审查先写P0-P3矩阵，再查代码、产品、架构、测试/反例、issue和设计适度。按任务使用gpt-6.1-sol，Host准入采用更高推理预算。

有P0/P1时REQUEST_CHANGES并向原实现会话交完整修复单；只有P2/P3时APPROVE，协调者修复并安排独立复评。原审计绑定旧候选时保留历史，不用后续修复伪造原证据。

## Global Constraints

写集限四项review记录、四项既有ExecPlan必要收尾、发现的有界修复、本计划及`docs/README.md`/`docs/review/README.md`索引与PR/issue验收记录。新产品修复须按根因和独立边界确认；不改Project Status/原生依赖、不更改R1标准。公开面不含凭据、本机路径、个人资料、内部系统或保密资料。

每条分支已共享，改写前建立`refs/backup/review-20261104/pr-N-*`；发布使用精确old-head lease。三个独立原提交收敛成一个可验收/回滚的能力提交，记录range-diff和树等价。源测试未变化时不重复宽泛验证；当前main变化时复查交叉路径和合并树。

## Plan of Work

### Batch 1 · 风险矩阵与独立审查

最小闭环：四项完整矩阵及一次性正式review。主文件为各自review记录；三路子评审互不共享写区。核对head/base/checks/threads及issue。

在各目标检出根运行`gh-review pr view N -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,statusCheckRollup,closingIssuesReferences`，期望与本批immutable snapshot一致；按产品面执行具名最窄测试。#536原样执行公开五探针，四个缺陷断言预期exit1、sink正控exit0。回滚为保留远端事实、撤回未提交文档。

### Batch 2 · 修复、复评与归档

最小闭环：每项发现有根因结算及独立复评；没有发现也核实归档。审查完成后一次性提交全部inline，不在首次P1停止。主文件为必要修复、review和原计划收尾。

同检出运行`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`和`git diff --check origin/main...HEAD`；Markdown相对链接须存在。期望发布面零命中、规模合规、原issue验收有证据。回滚到backup ref或撤回本地未提交修复，禁止把原数据库/远端对象当可自动恢复对象。

### Batch 3 · 串行整合与最终合并门准备

最小闭环：每PR交付内容经过独立复评，提交整合、issue验收和当前合并门的核对规则可执行；最后一条PR在归档后发布的文档head仍须重新等待托管checks、重锁批准。实际merge ack属于归档后的外部交付记录，不是本计划归档前的完成断言。主文件为本计划、索引和跨PR评审记录。

每个前序合并后重新fetch，核对main路径差异和当前候选，解决仅实际发生的冲突并复验；不得沿用旧head批准。`gh pr checks N -R SingularityKChen/harness-projects --required`期望全部pass；回读所有实际lane、review threads、issue关联和exact head后，`gh pr merge N -R SingularityKChen/harness-projects --rebase --match-head-commit <current-head>`。上述逐条合并属于本计划定义的后续外部交付流程：回读state/merge commit/tree和issue状态，结果记录在GitHub与本会话最终答复。失败则停止该PR合并；已合入能力如需回滚用独立revert，不改main历史。

## Validation and Acceptance

| 验收 | 最小证据 |
|---|---|
| 全矩阵完成 | 四个P0-P3矩阵、具名源码/命令与局限 |
| 评审一次性 | 当前head单一review含全部inline |
| 修复独立复评 | 原反例/链接检查及非作者复核 |
| 独立交付 | 单能力提交、Conventional Commits、精确base差异 |
| 合并门准备 | 当前内容独立复评、逐head门禁与批准回读规则；实际ack留给外部交付记录 |
| 人类门保留 | #459/#73/#449/#369/#273不由本轮机械接受 |

## Progress

- [x] 2026-11-04：锁定四head/base、身份、实现会话归属、所有初始threads和checks，先写风险矩阵。
- [x] 2026-11-04：Batch 1四项独立全矩阵完成；四份初始APPROVE已一次性提交，#536只有一条P2 inline。
- [x] 2026-11-04：Batch 2链接P2修复及独立复评通过；评审计划归档边界矛盾亦修复并由另一子评审确认；原四实现计划均已归档。
- [x] 2026-11-04：Batch 3本地交付边界完成：四PR均有单能力提交与恢复锚点、issue AC证据和可执行当前门禁/发布规则。#541已完成外部收尾，其余新head发布、hosted检查与merge ack继续逐条回读，不因本项归档预先视为通过。

## Surprises & Discoveries

#534/#535的UNSTABLE来自非必需Engineering state取消；后继全域协调run成功，需保留实际run证据。#536公开探针在当前head复现四个预期缺陷和sink正控，未把预期失败算测试绿；ExecPlan归档后审计首页存在旧active链接。

通用技能的lint脚本要求Concrete Steps/Artifacts and Notes，而本仓库PLANS.md规定固定13章节；本计划按已完整读取的仓库规范校验，不为通用lint增加冲突章节。GitHub推送后端连续返回500且SSH曾拒绝公钥；新head未发布时不沿用初始批准声称已完成。

## Decision Log

2026-11-04 / 用户直接指令：对PR #534/#535/#536/#541，若无P0/P1或仅P2/P3，由本评审会话负责修复、独立复评、归档、提交整理、issue结算和`merge_method=rebase`。这是本会话按PR明确覆盖的条件授权，不推进Project Status或R1。

2026-11-04 / 协调者：保留原实现会话owner，P0/P1完整交接；非阻塞修复由本会话接管。理由：避免两方修改同一架构单元。提交整理比较保留方案与单能力方案，选择单能力提交，备份ref保留原证据及恢复路径。

## Idempotence and Recovery

每次写外部前核实actor和目标，按`review-20261104:pr-N:<action>:<head>`记录幂等键与回读结果，防止重复review/merge。原始snapshots与日志放ignored运行目录。共享历史改写在精确lease拒绝时先重新取证，禁止强制覆盖。合并之后只能独立revert，不把revert当撤回已发生外部写入。

## Interfaces and Dependencies

Git、Node/pnpm、SQLite、Playwright、GitHub PR/issue/Actions和两账号凭据。review用`gh-review`/Singularity-AI-Bot；提交、作者回复、resolve和merge用`gh`/git/SingularityKChen。显式使用repo参数和规范化worktree路径；数据/安装演练原件保持只读。

## Outcomes & Retrospective

本计划的工程审查、修复复评、提交整合与最后合并门准备已完成。最后文档head的托管检查、批准和实际merge ack在归档后执行，不能写成本计划已观察的完成结果。原产品问题仍由各issue拥有，工程评审不声明发布接受。

## Bottom Change Note

2026-11-04：建立四PR评审与交付计划，记录条件授权、独立写区和当前head门禁；不复制原实现设计。

2026-11-04：独立复评发现归档边界文字不一致，统一Batch3、验收与结算为最后合并门准备；实际merge ack明确属于归档后的外部交付记录。

2026-11-04：三路子评审和第四项独立复核完成；#541共享历史整理有备份与doc-only树比较，non-thin HTTPS精确lease最终成功，新head已从Git ref与PR两入口回读。其余PR须在前序合并后按实际main复评；托管新head证据尚不以初始绿替代。

2026-11-04：#541已合入e6153dcb，tree与批准版本相同、#540关闭；#534全绿及新head批准后两类merge端点均服务器失败、未合并。先收尾独立#535，main再移动时对#534重放和重批，保持门禁而不固守原串行顺序。

2026-11-04：工程审查与最终合并门准备材料完整后归档；已合入#541与尚需外部回读的其余PR明确分开。四能力的最终文档head仍须独立批准和新head托管门禁；归档不宣称全部已合并。

2026-11-04归档后外部观察：#534已合入a5f6e71a且tree一致；误并发启动的#535请求被平台base保护拒绝，未合并，已恢复串行并重放。该事件不变更工程归档界限，也不沿用旧base批准。

2026-11-04归档后外部观察：#535已按a5f6e71a重放、独立复评、当前CI与新head批准后rebase合入dac07235，tree一致、#532关闭；#536最后基于实际main进行最终文档收尾。
