# PR #438–#440 MMP 评审、修复与合并准备 ExecPlan

> 状态：Completed（仅评审、修复和合并准备交付物；实际发布与合并仍由批次记录控制）
> 创建：2026-10-28
> 范围：三项独立能力的 MMP 交付评审、非阻塞问题修复、独立复评及发布/合并准备材料。
> 上游输入：本轮人类评审指令、AGENTS.md、docs/review/mvp-review.md。

## Purpose / Big Picture

对 #365 执行刷新、#367 原生 PR 身份收敛、#428 组件与构建测量分别给出基于当前 head 的一次性 review，修复唯一非阻塞问题，交付可审阅、可提交的评审证据和发布门禁约束。本计划的完成判据止于这些交付物验收；实际提交、push、issue 写入和 rebase merge 是本会话继续执行的发布操作，以 docs/review/2026-10-28-pr438-pr440-mmp-review.md 的收尾控制及 GitHub 回读记录为准，不是本计划已完成的事实。测试绿不等于整个产品或 R1 验收。

## Context and Orientation

三个 PR 独立基于观察时的 main；各实现计划已在 completed。实现会话为「规划迭代优先级与并行交付」，已有独立 worktree。评审账号为 Singularity-AI-Bot（gh-review），开发、回复和合并账号为 SingularityKChen（gh/git）。

每个 PR 的风险矩阵、锁定版本与证据分别保存在 docs/review/pr-438-mmp-review.md、pr-439-mmp-review.md、pr-440-mmp-review.md；它们随对应 PR 提交。本计划承担跨 PR 的授权、顺序与恢复控制。

## Design / Spec

采用独立子评审并由协调者综合：执行刷新、身份/存储、构建/来源各一 owner，先矩阵后逐文件，覆盖 P0/P1/P2/P3。使用 Superpowers、Qian Systems Router、First Principles Development。评审关注系统闭环、状态权威、反例与验收，不用局部绿色替代用户结果。

候选路径比较：只看 CI 不能判定产品闭环；把三个能力合成一个大 PR 会损失独立回滚；故保持现有三个 PR，汇总各自完整意见后一次提交。存在 P0/P1 时交既有实现 owner，评审方不并行修同一分支；只有非阻塞项时按人类本轮指令由评审方收尾。

## Global Constraints

保持 AGENTS 七条不变量、依赖方向、Provider ack/reconcile 和凭据句柄边界。保持现有 issue 验收与规划 Status/原生依赖。公开文档中文、无本机绝对路径或内部资料。

本轮预计文件集：各自 docs/review/pr-<n>-mmp-review.md；本计划及 docs/README.md；复评确认的最小文档修正和必要索引。若发现产品缺陷，先在对应实现计划记录根因和变更边界再进入修复。代码/测试和文档分别执行 size 检查，不为体量数字拆散闭环。

## Plan of Work

### Batch 1 · 锁定事实、矩阵与独立评审

最小闭环：完整审查三项当前版本，逐项验收与同类 issue 搜索，分别一次性提交 review。

主文件：各自 docs/review/pr-<n>-mmp-review.md。

验证：在各 PR 分支检出的工作树运行相关聚焦测试；重读 PR head/base、threads 与 checks；必要变异使用 node scripts/review-mutate.mjs，逐项 killedBy。协调者比较三项合并树的产品 blob 后在匹配集成检出运行 pnpm verify，期望类型检查、主测试和 MVP 均通过。

回滚：此批只增加评审证据；GitHub review 以新 head 复评更新，不能拿旧结论批准新版本。

### Batch 2 · 非阻塞修复与独立复评

最小闭环：核实全部建议后做最小修改，由独立评审者验证修正与原反例。P0/P1 分支直接交原实现会话，不合并。

主文件：确认的缺陷所在文件、对应评审记录与实现 ExecPlan。

验证：文档修正读回实际目标并做链接检查；产品改动先判别红测再绿测，按风险扩展。执行 node scripts/rule-checks.mjs disclosure origin/main、node scripts/rule-checks.mjs size origin/main、git diff --check origin/main...HEAD，期望全部成功。

回滚：未提交内容按明确文件回退；已提交内容以能力/文档提交为单位撤回，不删除数据。

### Batch 3 · 归档与发布/合并准备

最小闭环：归档评审修复交付物，固定提交边界、公开面检查、逐 PR 发布回读、合并条件和恢复路径，交付给本会话的后续发布操作。此批不把尚未执行的合并计为验收结果。

主文件：本计划、docs/README.md、各 PR 的最终评审记录。

顺序候选为 #438 → #439 → #440；每步 fetch 真实 main 后重新锁版本。共享历史改写前保存 backup ref，精确 force-with-lease；禁止推 main。每次变基后比较产品 blob 与已验收并集，发生差异则重审重测。

本批验证：13 个强制章节齐全、completed 文件与索引存在、评审记录链接可解析，git diff --cached --check 与暂存公开面扫描通过。后续外部门禁契约：gh pr view <n> -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,mergeable,reviewDecision,statusCheckRollup,closingIssuesReferences；gh pr checks <n> -R SingularityKChen/harness-projects。只在当前版本 PR Fast Gate、相关 CI/规则成功、review 完整且 issue 双向关联正确时执行 merge_method=rebase，并固定 sha。随后回读 PR state/mergeCommit 和 issue state；本计划不预写这些操作已完成。

回滚：GitHub 合并非本地回退；如需撤销，在新分支 revert 对应能力提交后重新评审，不改写 main。issue/规划事实不由本地 revert 自动恢复。

## Validation and Acceptance

| 验收 | 证据门 |
|---|---|
| 每个 PR 完整矩阵与一次 review | 各自评审文件 + GitHub reviews/threads 回读 |
| 无 P0/P1 才合并 | 独立子评审与综合结论；修复后当前版本重新裁定 |
| 产品路径与反例 | 按 issue 逐条映射，局部/模拟/真实环境边界明确 |
| 安全发布准备 | 实际暂存扫描、diff-check 与后续 disclosure/size/远端回读约束齐全 |
| 合并/issue 操作契约 | 本批次记录给出 merge_method=rebase、固定 sha 与双向回读规则；不计外部执行结果 |

## Progress

- [x] 2026-10-28：锁定三个初始版本、两账号、全部空 threads、已有实现会话；预建 P0–P3 风险矩阵。
- [x] 2026-10-28：三个独立子评审运行；协调者重算三项合并树并确认集成产品 blob 一致，pnpm verify 为类型检查 + 2442/2442 主测试 + 7/7 MVP。
- [x] 2026-10-28：Batch 1 完成；三份 APPROVE review 已由 Singularity-AI-Bot 一次性提交，ID 分别 5681133780 / 5681134434 / 5681135207。唯一新增意见为 #439 的 P2 证据回链；无 P0/P1。
- [x] 2026-10-28：Batch 2 完成；#439 唯一 P2 为 active→completed 回链，独立复评 PASS/F1 ADDRESSED，产品与原测试相对初评 head 无差异。
- [x] 2026-10-28：Batch 3 的归档、提交边界、发布/回读契约与恢复路径已准备并验收；本计划不含实际发布/合并，具体执行由批次收尾记录控制。

## Surprises & Discoveries

2026-10-28：#439/#440 的可选 Create review session 失败日志均为本地端点连接拒绝；分支保护 API 实读只要求 PR Fast Gate 且 strict=true，不要求 review 数。我们仍执行本轮人类要求的独立批准；不将可选端点故障误记为产品代码失败。

集成检出为 test/iteration9-independent-integration@b300535b418683e9910ac372b3ccc40f75467fb5，其 apps/packages/tests/scripts/workflows 与配置 blob 等于初始三 head 合并树；产品清单 SHA-256 为 8a81e2f22c6cb4652eb37e37ca57074c7f8fbbae559be65f131cabe01cb19638。该测试仅为本地证据，不冒充真实 Host/模型或 R1 验收。

## Decision Log

- 2026-10-28 / 人类直接指令：范围为 PR #438–#440。原话「如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并」。据此只在无 P0/P1 条件满足时由本会话收尾，不重复请求相同授权。
- 2026-10-28 / 协调者：对 #438/#440 使用 gpt-6.1-sol-hc/high；身份/持久化 #439 使用同模型 xhigh。三个写入区域仅各自评审文件；产品实现仍由原 owner 独占。
- 2026-10-28 / 协调者：工程证据、issue 机制验收、人类产品验收分开；不改变 Status 或 blocked-by/blocking，不关闭父级产品门禁。

## Idempotence and Recovery

GitHub 外部写入按 actor、目标仓库/PR、head 和动作记录；以本计划批次 + PR + head 作为幂等标识，重试前回读已有 review、comment、merge。评审必须附 commit_id，合并必须附 sha；远端变化则停止旧版本写入并重新锁定。backup refs 保留到本轮结束。

## Interfaces and Dependencies

需要 gh/gh-review、Git、Node、pnpm 和现有依赖。Git 使用 argv API。已有 task-local pnpm 启动器避免全局启动器无 shebang 导致错误版本回退；不改变全局配置。外部依赖限 GitHub 元数据与原生 review/merge API。

## Outcomes & Retrospective

三项初评均 APPROVE；唯一 P2 文档回链已修复并独立复评，三份 MMP 证据与本批控制文档完成归档。产品/原测试未因收尾改变。本会话的实际提交、当前版本门禁和 rebase merge 继续按批次记录执行；结果只由 gh pr view 438/439/440 的 state、headRefOid、mergeCommit 和对应 issue state 回读确定，未被本计划的 Completed 状态代替。未证明官方已安装 Host/真实模型端到端，也未声明 R1 或父级 UI 需求完成。

## Bottom Change Note

2026-10-28：为本轮直接授权建立单份跨 PR 收尾计划，记录模型分工、所有权、当前证据和合并恢复门。

2026-10-28：全部独立评审完成并发布；#439 的 P2 已做单点文档修正，交原独立评审者复评。

2026-10-28：F1 独立复评 PASS；归档本轮控制计划，完善三项评审索引、实际授权和逐 PR 门禁/回读规则。

2026-10-28：最终文档窄审指出归档状态与外部合并范围混写；将本计划边界明确限定为已经完成的评审、修复和发布准备交付物，后续实际发布/合并仍由批次记录与实时门禁控制，未缩减本会话的人类请求。
