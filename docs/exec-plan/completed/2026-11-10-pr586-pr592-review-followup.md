# PR #586 / #588 / #590 / #592 评审收尾 ExecPlan

> 状态：Completed（工程评审、修复复评与整合准备已完成；合并按当前版本门逐条执行）
> 创建：2026-11-10
> 范围：四个现有交付闭环的独立 MMP 评审、发现处置和条件 rebase 整合。

## Purpose / Big Picture

以用户结果、状态权威和失败恢复判断四个 PR 是否可独立交付；先建立 P0–P3 风险矩阵，再完成全部层次审查并一次性提交每个 PR 的完整 review。只有没有未解决 P0/P1、必要修复独立复评和当前版本门禁通过时才合并。工程完成不替代父项的人类安装验收或 R1 裁决。

## Context and Orientation

#586 修复 #309 的配置属性读写保真；#588 交付 #587 的授权来源 Markdown 引用；#592 修复 #591 的重复拒读因果票据；#590 基于 #592 交付 #589 的原生双向阻塞读取。父项 #539/#543 保留更广范围与实际安装验收。原实现会话为“规划紧急重要交付 Issues”，已确认四个分支 Ready、未合并；若发现阻塞缺陷，将按用户要求交回该 owner。

初始版本和逐层证据保存在各 PR 自身 `docs/review/pr-<n>-mmp-review.md`；此计划只拥有跨 PR 的控制决策。规则入口是 `docs/review/mvp-review.md`、`docs/review/responding.md`、`docs/development/publication.md` 和 `docs/project-management/merge-queue.md`。

## Design / Spec

选择三席独立审查：#586 使用 gpt-6.1-sol high；#588 使用 gpt-6.1-sol xhigh；#592/#590 由同一 gpt-6.1-sol xhigh 审查共享权限因果协议并分别裁定。整合者复核 findings、issue 边界、账号、CI、依赖与组合接合。没有为四个局部闭环调用更高成本模型。

放弃仅按 CI 批准，因为测试不能证明未覆盖的用户结果；放弃四分支并行修复共享文件，因为会破坏单一 owner。采用 #586 → #588 → #592 → #590 的工程操作顺序；仅后两层存在产品依赖，不新增 Planning 依赖。完整前序先在一次性 clone 预演，真实合并后再 fetch 实际 main 逐层接合。

## Global Constraints

新增文件集合限于此计划、`docs/review/pr-{586,588,590,592}-mmp-review.md`、跨 PR 记录 `docs/review/2026-11-10-pr586-pr592-mmp-review.md`；索引修改限 `docs/README.md`、`docs/review/README.md`、`docs/project-management/merge-queue.md`。确证缺陷的实现改动只落所属分支并另记具体根因与验证。每 PR 沿用 issue 中的代码/测试/配置 <800、文档 <1300 限制，不删安全测试以凑规模。

`gh-review` 的 actor 必须为 `Singularity-AI-Bot`；开发、作者回复、resolve、issue 核验和合并用 `gh` / git 的 `SingularityKChen`。不改 Planning Status、原生 blocking 关系和人类发布裁决。凭据、本机身份、内部端点不进入公开产物。历史改写先保留 backup ref，push 用精确 old head lease。

## Plan of Work

### Batch 1 · 独立审查与一次性发布

**最小闭环**：每个 immutable head 有完整矩阵、分层证据与一份完整 review。
**涉及文件**：各 PR 的审查记录。
先锁 head/base、全线程、checks、issue 双向关联和原实现 owner；独立读取代码、产品闭环、架构、判别性测试、反例、验收和重复追踪。整合者确认后以 P0/P1 → REQUEST_CHANGES、仅 P2/P3 或无问题 → APPROVE 发布。
**验证**：在各对应分支根运行其审查记录中具名的最窄测试；所有 `gh` 命令带 `--repo SingularityKChen/harness-projects`。预期相关用例通过，已发现反例有可重复证据。
**回滚**：审查文档可修订；已提交 review 不伪装撤回，以当前 head 的复评覆盖。

### Batch 2 · 根因处置与独立复评

**最小闭环**：每个 finding 有明确 owner、证据、修复或有依据的反驳。
**涉及文件**：发现所属模块及其必要判别测试；无缺陷时只更新审查记录与计划。
有 P0/P1 则交已有实现会话，保留完整意见与回传方式；无 P0/P1 时本会话按已授权范围承担收尾。修复先复现，再最小修改，交另一独立审查者核验。不按假设制造实现工作。
**验证**：有行为修复时在所属分支运行受影响测试，必要的变异使用 `node scripts/review-mutate.mjs <spec.json>`，最终树整表执行一次并记录 `killedBy`；无新行为不扩大测试。
**回滚**：修复按独立闭环 revert，保留原 findings 和实际失败证据。

### Batch 3 · 整合、门禁与 rebase 收尾

**最小闭环**：已批准当前版本以 rebase 方法进入真实 main，对应工程 issue 核验并回读。
**涉及文件**：计划归档、评审索引及合并队列。
先在仓库外一次性 clone 重放完整前序，保留索引两侧全部条目。固定组合源码后运行 `pnpm install --frozen-lockfile --offline`、`pnpm verify`、`pnpm test:browser`、`pnpm boundaries`、`node scripts/workflow-check.mjs`，预期安装、类型、测试和边界/工作流检查退出 0。仅在新增跨边界差异或失败时扩大/重复验证。

每条最终 push 前在其 worktree 运行 `node scripts/rule-checks.mjs disclosure <actual-base>`、`node scripts/rule-checks.mjs size <actual-base>` 和 `git diff --check <actual-base>...HEAD`，预期扫描与规模通过、无空白错误。人工检查五类公开面；收敛提交为能力闭环，保留备份、range-diff 和非文档 blob 对照。

最终 push 后运行 `gh pr view <n> --repo SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,mergeable,mergeStateStatus,statusCheckRollup,closingIssuesReferences,reviewDecision`、`gh pr checks <n> --repo SingularityKChen/harness-projects`，并完整分页读取 reviewThreads 和 issue closedByPullRequestsReferences。预期当前 head 已获独立批准、PR Fast Gate 成功、无未解决问题、关联准确。只执行带预期 head 的 `merge_method=rebase`；若为 native stack 使用 async 端点并读回真实状态。合并后重新读 PR state/mergeCommit、issue state 及 main，不预写未来成功。

**回滚**：合并前可用 `refs/backup/pr<N>-before-mmp-review-20261110` 恢复；合并后以各能力提交反向提交，先撤 #590 再撤 #592。外部 issue/review 写入通过读改写纠正，不声称 Git revert 能回退外部事实。

## Validation and Acceptance

验收依次为：全矩阵审查完成；所有 findings 已处置并独立复评；具名组合证据与真实接合一致；每个当前 head 的托管门禁、批准、线程和双向 issue 关联通过；工程 issue 的验收证据准确。父项 #539/#543、产品 UAT、#459 与 R1 分别保持原门禁。

## Progress

- [x] (2026-11-10 SGT) 确认两个 actor、干净 worktree、实现会话与初始事实；先建立四份 P0–P3 矩阵再派发三席独立评审。
- [x] (2026-11-10 SGT) 四份首轮完整 review 均 APPROVE；三项 P2、一项 P3 集中发布，无 P0/P1。
- [x] (2026-11-10 SGT) 三项 P2、一项 P3 均修复并获原独立审查席 ADDRESSED，无新增可行动问题。
- [x] (2026-11-10 SGT) 完整前序及全部修复固定为 f172cb02；完整工程验证通过，逐真实 main 接合与最终 head 门禁作为条件操作执行。
- [x] (2026-11-10 SGT) 工程计划归档，交付级提交、issue 核验与逐当前 head rebase 操作的输入、恢复锚点和回读规则已确定；不预写远端成功。

## Surprises & Discoveries

四个初始 head 的 `Create review session` 日志均显示本地端点 HTTP 404，已有 #364 跟踪；保护配置只要求 PR Fast Gate 且 strict=true。#586/#588 的旧 base 落后实际 main，因此绿色历史检查不能替代接合后的新检查。#588 另有已解决的 CodeQL 历史线程，最终须重新读取全部线程。

## Decision Log

2026-11-10 SGT / 用户直接点名 #586/#588/#590/#592 并授权：“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并。”本计划按此条件执行，不为已有授权重复询问。若有 P0/P1 且原实现会话存在，则交回它修复并复审。

2026-11-10 SGT / 整合者：采用三席独立审查和串行最终收尾；不改变 Planning 字段或人工验收。四个既有实现 ExecPlan 已在 completed，新增评审收尾计划用于持久保存本轮门禁与授权。

## Idempotence and Recovery

只读查询和具名测试可重复。每次公开写入先核 actor 和目标，运行态 mutation ledger 记录 ProviderBinding、幂等键、ack 和回读；重复提交 review 前检查 head 与已有 review，避免重复意见。共享历史只在备份和精确 lease 下修改，远端 head 前移则停止覆盖并重新取证。managed worktree 路径必须 realpath 位于仓库 `.worktrees/` 根内；一次性 clone 仅允许在系统临时目录下本任务新建的专属根内。两类路径分别核对允许根与真实目标，拒绝穿越、逃逸和非预期符号链接；不清理其他会话的 worktree。

## Interfaces and Dependencies

依赖 GitHub 两个账号、现有 Node/pnpm 工具链、PR Fast Gate、仓库规则和 #592 的内部因果票据 API。生产功能的层边界、授权来源和 Provider 确认仍由各自实现计划拥有；评审不新增 Provider API、存储格式或兼容层。

## Outcomes & Retrospective

四个首轮 review 均 APPROVE，无 P0/P1；#588 的 HTML 惰性区间与 Unicode 边界两项 P2、#590 的 unavailable 提示 P2 与归档路径 P3 均已修复并获独立复评 ADDRESSED。固定最终组合 f172cb0217ea191b4fd09560d7263a46ec1ea942（检出 test/pr586-pr592-preview-20261110）通过 typecheck、contract1442、integration2171、E2E226、browser81、boundaries9 与 workflow7文件；所有测试失败、跳过、取消均0。非文档产品/测试 manifest SHA256 为 7c798af5e7df7fe550d9227e8e0368735c729e36eab7eb9010dbb7ee8319ad97，保存在恢复引用 refs/backup/pr586-pr592-final-combination-20261110。实际各合并前缀必须与相应受验前缀逐 blob 一致；变化则回到相关验证门。

初始完整预演只有配置分支的索引并列插入冲突，已保留两侧全部行。后续真实 main、head、CI、issue 与合并结果以 Batch3 的读回命令确定，工程归档不预先宣称远端合并或人类产品接受。

## Bottom Change Note

2026-11-10 SGT：建立四 PR 评审收尾控制计划，保存直接条件授权、独立分工、真实接合/门禁和恢复路径。

2026-11-10 SGT：独立流程复评指出路径约束与临时 clone 策略的歧义，现分别限定两类允许根；不改变任务或发布权限。

2026-11-10 SGT：完整首轮发现已一次性发布；按直接授权由本会话接管非阻塞修复。Markdown 由另一独立实现者写入、原审查席复评，阻塞关系提示与路径由整合者修复后交原独立席复评。

2026-11-10 SGT：所有非阻塞修复独立复评通过；固定最终组合完成一次完整验证，工程计划归档。最终合并保持逐当前版本的条件操作，不以归档状态绕过 CI、批准或 issue 门。
