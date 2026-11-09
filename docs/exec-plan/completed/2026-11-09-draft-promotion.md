# Draft 转 Issue 保持原工作项身份 ExecPlan

> 状态：Completed · Batch 2 独立复评通过；按本会话条件授权执行最终远端门
> 创建：2026-11-09
> 范围：issue #283 的生产同步身份提升闭环
> 上游输入：issue #283、`docs/architecture/gate-e1-membership-and-draft.md`、`docs/product/vertical-path.md` §2.1

## Purpose / Big Picture

用户在 GitHub 将 Draft 转为 Issue 后，再次同步仍能打开原工作项及其执行上下文、运行与交付谱系；来源内容和号码更新为 Issue，旧 Draft 身份保留为历史别名。最小成功证据是通过 `composeCore` 与 `commands.refreshPlanning` 完成两轮同步，两种 Storage 的内部工作项 id、context id 与已有关系完全相同，SQLite 真正重开后仍成立。

## Context and Orientation

观察基线为 2026-11-09 的 `main` 提交 `c9bb17b833295f26c750bd8c4bf425df53e9701f`。`packages/core/src/bootstrap.ts` 的 `anchorOf` 当前先覆盖 membership，再按新内容调用 `ensureEntity`，因此转换创建第二个实体。membership 指工作区内稳定 Project 条目与当前内容的映射；它不是内容身份。平台转换保持同一 Project 条目，改变内容对象，证据边界由 Gate E1 文档记录。

`packages/core/src/identity.ts` 的 `promoteEntityIdentity` 尚无生产同步入口，且只取得当前实体的 identities，不能发现别的实体占用目标自然键。`packages/domain/src/identity.ts` 已定义 Draft primary 降为 historical、Issue 升为唯一 primary 的纯规则。Core 的 bootstrap 事务拥有身份、membership、projection 与 cursor 的原子提交；不得移交给 Provider 或 UI。现有直接调用 promotion helper 的测试只能作为回归，不能替代本闭环的生产入口证据。

## Design / Spec

采用在同一 bootstrap 事务内、覆盖 membership 之前识别精确转换并提升身份的方案。独立最小、可靠性、产品三份方案均支持这一因果路径；最终复核增加全局目标占用检查与事务失败反例。放弃“新实体后搬迁上下文”（需合并多谱系和迁移），放弃“membership 直接成为全局内容身份”（同一 Issue 可属于多个 Project），放弃标题、号码、URL 或分支推断。

`anchorOf` 先读取当前 workspace 下的旧 membership。只有旧、新 projectExternalId 与 itemExternalId 完全相同、旧为 draft、新为 issue，且通过当前 Planning binding 找到旧 Draft identity，旧 identity 确为该实体当前唯一 primary draft 时，才调用提升。binding、project、membership 任一不同，Issue→Issue、PR→Issue、redacted、缺旧 identity、旧 Draft 只有 historical/alias，均不作转换推断，继续既有显式身份解析规则。**Superseded by 本节「Batch 2 身份与内容边界」（2026-11-09）**：其中一概排除 redacted 的结论不成立；其余身份和 scope 条件继续有效。输入 scope 的既有校验仍先执行。整批校验同时要求项目与每条内容 ref 的 binding 等于当前已选 Planning binding，不能让返回的 ref 选择别的身份所有者。

在 `promoteEntityIdentity` 内根据被提升 primary draft 的 binding 全局调用 `tx.findExternalIdentity(bindingId, 'issue', issueExternalId)`。另一实体占用时返回 `ok:false`，不写任何 identity；调用方抛 `IdentityConflictError` 让整轮事务失败并按既有 Conflict 路径报告。不能借唯一键覆盖、复用占用实体或合并实体。目标属于本实体时幂等复用其 identity id。提升保留旧 Draft identity id、原 entityId，历史别名仍可解析，恰有一个 primary；在提升成功后才写新 membership/projection。身份列表没有顺序契约，事务内先写所有非 primary（包含原 primary 的降级），再写目标 primary，保证已有 Issue alias 先落库时也能晋升。

执行上下文、run、relation、mutation receipt 不做更新或搬迁，因为它们已经指向正确 entityId。一个事务中的失败必须保持原 identities、membership、projection 与已提交 cursor/revision；同步轮次的开始/失败诊断记录按现有契约允许变化，不能把整个数据库逐字不变当成验收。没有历史重复实体的自动修复、schema 变化或兼容分支。

### Batch 2 身份与内容边界

F1 的合法输入有确定 `ref.objectKind=issue` 与 externalId，仅 `content` 被遮罩。内容可见性和身份事实正交：在已确认同 binding/project/membership、旧 Draft 唯一 primary 的原条件下，直接提升显式 Issue 身份；合法内容限定为 WorkItem 或 Redacted，不借本修复扩大 issue ref 搭配 ChangeRequest 内容的行为。投影继续使用本轮 redacted，不恢复旧标题、正文、来源编号或字段。只有无内容身份的 `project_item` 不得推断新 Issue 身份；已有 membership 可只读找回旧 entity 并投影 redacted，未知 membership 不生成实体身份。

比较三案：直接依据显式身份提升（选定），复用原事务和 promotion，状态最少；延迟到内容可见才提升，需要额外保存未完成转换和旧 membership，增加恢复状态；拒绝整轮会无必要地影响无关合法条目。此次不改 Provider/Storage 契约，不引入迁移或第二 authority，不补救既有历史分叉库。

## Global Constraints

本 PR 唯一代码 owner 为本闭环实现者。允许的完整改动集合为 `packages/core/src/bootstrap.ts`、`packages/core/src/identity.ts`、新 `tests/integration/draft-promotion-reconcile.test.js`；只在已有测试因真实契约修正而必须调整时允许 `tests/integration/source-number-restart.test.js`。文档集合为本计划（完成时同名移至 `docs/exec-plan/completed/`）、`docs/product/vertical-path.md`、`docs/README.md`；若出现真实新增技术债，仅在 `docs/exec-plan/tech-debt-tracker.md` 登记。不改 Provider、domain、Storage、UI、schema、其他任务文件或外部规划字段。

工作分支 `fix/draft-promotion`，隔离目录 `.worktrees/draft-promotion-20261109`。代码含测试/config/fixtures 的加删合计必须小于 800，文档小于 1300；当前设计估计代码 330–540、文档 150–260。越界先修订方案，不能删判别测试凑数。一个 PR、一个实现与验证批次，不自行合并，不改变 Status、native dependencies、Gate E1 freeze 或 R1 人类裁决。**Superseded by Batch 2（2026-11-09）**：本 PR 增加一批根因修复；实现者不自行合并，主控按本会话针对 #583 的条件授权和独立复评门禁收尾。

Batch 2 的唯一实现 owner 为本次修复者，代码写入仅限 `packages/core/src/bootstrap.ts` 与 `tests/integration/draft-promotion-reconcile.test.js`；文档仅本计划、`docs/README.md` 与 `docs/product/vertical-path.md` 必要订正。既有 `docs/review/pr-583-mmp-review.md` 不改；运行日志放忽略的 `.superpowers/pr583-p2-repair-20261109/`。本实现者不 commit/push、远端写入或批准自己的修复。

## Plan of Work

### Batch 1 · 生产同步提升与耐久身份验证

**最小闭环**：稳定 membership 的 Draft→Issue 经真实 Core command 保持工作项与执行谱系，冲突整轮拒绝。

**涉及主文件**：`packages/core/src/bootstrap.ts`、`packages/core/src/identity.ts`、`tests/integration/draft-promotion-reconcile.test.js`。

先仅提交本计划的可审阅 draft PR 并关联 #283；GitHub 元数据由交付 owner 执行。实现前在新集成测试复用 fake Planning 与两 Storage 模式：第一轮 draft 同步，建立原 entity 的 execution context、run/关系；通过 Provider 状态转换同一 membership，第二轮 `commands.refreshPlanning`。先运行下面的窄命令，确认当前实现红在 entity/context 连续性断言，而非 fixture 初始化。测试不直接调用 helper 完成提升。

随后按 Design 实现全局 occupant 检查与事务内提升。补三组有独立判别力的反例：目标已由别实体占用时 Conflict 且已提交事实不变；在第二条 identity 写入注入 Storage failure 时全部回滚；相同标题或 membership 字符串但不同 project、旧 Draft 非 primary 时不得提升。成功用例再次同步，再用文件 SQLite close/open 重建 Core，确认原 entity/context/run/relations、historical alias、唯一 primary、新来源号码仍一致。复用已有分页/轮次回滚回归，不复制其完整矩阵。

文档将 vertical-path 的旧反例保留并原位标注 `Superseded by` 本次生产证据，更新实际结论；不改 Gate E1 既有人类裁决。实现和最终验证完成后更新本计划实际结果，移动 completed 并更新索引；没有新增债务则明确记录无新增债务。

**验证**：全部命令在检出 `fix/draft-promotion` 的 `.worktrees/draft-promotion-20261109` 根目录执行；先运行第一行取得 RED，再在实现后运行全部。期望第一行生产入口用例先因原 id 改变失败，最终两存储及反例全部通过，其余命令 exit 0。

```text
pnpm test:file tests/integration/draft-promotion-reconcile.test.js
pnpm test:file tests/integration/planning-membership-reconcile.test.js tests/integration/source-number-restart.test.js tests/integration/github-projects-bootstrap.test.js tests/contract/domain-identity.test.js
pnpm typecheck
pnpm verify
pnpm boundaries
node scripts/rule-checks.mjs disclosure c9bb17b833295f26c750bd8c4bf425df53e9701f
node scripts/rule-checks.mjs size c9bb17b833295f26c750bd8c4bf425df53e9701f
git diff --check c9bb17b833295f26c750bd8c4bf425df53e9701f
```

提交与公开前另按 publication 文档人工核对五类目，并按本计划更严的 800/1300 上限核对 numstat。最终 push 后由交付 owner 回读当前 PR head/base、closingIssuesReferences、全部 checks 和 review threads，最终 head 验证通过才 Ready。PR 描述记录 Batch 1、真实 RED/GREEN、风险与整体回滚；不把这些结果写成 R1 或产品接受。

**回滚**：完整 revert 本 PR 的代码与文档；保留已存在的用户库、合法提升身份及工作树，不反向删除 alias/context，不自动修历史重复实体。

### Batch 2 · 显式 Issue 身份在 redacted 期间保持连续

**最小闭环**：Draft→已知 Issue ref + redacted→恢复可见，原 entity/context/run/relations/receipt 全程不变，遮罩期间没有正文泄漏，SQLite 文件重开后仍成立。

**涉及主文件**：`packages/core/src/bootstrap.ts`、`tests/integration/draft-promotion-reconcile.test.js`。

先将旧“redacted issue 不提升”负例替换为未知 `project_item` 控制；新增两 Storage 的合法已知 Issue ref 连续性测试，在实现前确认新测试因 entity 改变而 RED，重跑评审独立 2 条红。随后将原 WorkItem 条件扩展为 WorkItem 或 Redacted，保留原身份、scope、primary、occupant 与事务校验；issue ref 配 ChangeRequest 内容不触发 Draft 提升。测试要求遮罩时 projection/query 为 redacted 且不含旧/新正文 canary；重复 refresh 幂等，SQLite 在 redacted 期间 close/reopen，再恢复可见仍用原 entity。

**验证**：沿 Batch 1 所列同一工作树与窄/42项回归/typecheck/verify/boundaries/publication 命令执行；额外运行 `node --test .superpowers/pr583-mmp-review-20261109/known-redacted-promotion.test.mjs`，预期独立 2 条由红转绿。运行态日志保存于 Global Constraints 声明的目录。完成本地验证后保持 Active，等待其他 reviewer 独立复评；由主控归档、整理、核销 issue 和远端交付，不由实现者自行批准。

**恢复**：原身份提升和 membership/projection 同事务，不增加中间持久状态。故障仍整轮回滚并可重试；撤销本 Batch 可恢复原代码和测试，不删除用户身份、context 或数据。历史分叉数据需要另行取证，不静默合并。

## Validation and Acceptance

采用 Batch 1 和 Batch 2 的生产 command、两 Storage、SQLite 重开证据判定。成功时原 entity/context/谱系不变且新 Issue 为唯一 primary、旧 Draft historical；冲突/注入故障无半更新；不充分 membership 证据不误提升。只运行 helper 的绿测、模拟输出或未实际关库的重建都不能替代这些证据。已知 Issue ref 即使正文 redacted 仍保持原实体与执行谱系，持久投影/查询不含旧或新正文；未知 project_item 不生成内容身份，恢复可见不分叉。已知历史坏库恢复不属于此闭环，应由独立取证任务决定。

## Progress

- [x] (2026-11-09) Batch 2：P2 和复评范围收敛 P3 均 ADDRESSED；独立 76 项、adapter 4 项与最终 5 项归因变异通过。

- [x] (2026-11-09 19:02 +08) 完成三份独立备选方案与源码复核，收敛本计划。
- [x] (2026-11-09 19:13 +08) Batch 1 本地闭环：draft PR #583 已由交付 owner 建立；生产入口 RED/GREEN、回归和文档完成。最终 push、远端 head/checks/关联/threads 回读由交付 owner 接续。
- [x] (2026-11-09 19:24 +08) 独立首轮评审两项反例经 RED 复现，修正当前 binding 校验与 primary 写入顺序，完成本地复验；等待新 head 的独立复评。
- [x] (2026-11-09 19:24 +08，后续完成) 独立最终代码验收与本会话 MMP 评审均完成；合并按下方直接条件授权，规划状态保持原所有者。

- [x] (2026-11-09 19:29 +08) 独立复评在修复 head 上确认两项 ADDRESSED；68 条相关测试、4 条原始反例及 typecheck 通过。

- [x] (2026-11-09) Batch 2：判别性 RED、最小修复、已知 ref 脱敏/恢复和未知 project_item 控制及本地验证通过；结果见 Outcomes & Retrospective。
- [x] (2026-11-09) Batch 2：独立修复复评通过并归档；最终公开门按当前 head 回读。

## Surprises & Discoveries

`promoteEntityIdentity` 注释承诺全局冲突拒绝，但当前传给 domain 的仅是本实体 identities；所以不能只在 bootstrap 加一次调用。`bootstrap.ts` 已在一个事务中完成所有事实提交，使用现有事务即可，无需新迁移器。现有同步 round 元数据与 committed revision 的职责不同，回滚断言应聚焦已提交业务事实。

2026-11-09 独立首轮评审在两 Storage 复现两个遗漏：本轮 project 引用合法但内容 ref 指向另一个真实已登记 binding 时，原实现可降级 foreign Draft；同实体 Issue alias 在 Draft primary 之前持久化时，原按数组顺序写会触发唯一 primary 约束。原 22 条用例未覆盖这两种形状，不能据此宣称 binding 隔离与任意身份列表顺序已证明。修复用真实两工作区身份和公开 Storage 接口构造持久 alias-first 状态，不增加 mock 或顺序契约。

2026-11-09 独立修复复评 P3：完全删除 content.kind 条件会让非法 issue ref + ChangeRequest 内容也触发提升，TS 联合类型未保证 ref/content 对应，当前 validatePlanningItems 在 nativeIdentity 缺省时也未完整排除该形状。真实 GitHub adapter 不生成此组合，原非法输入验证也非本批范围；因此仅恢复最窄 WorkItem 或 Redacted 条件，不新增全面 validator。对照在两 Storage 均 RED（32 条中原 30 条通过、2 条新对照失败），OR 条件后 32/32 通过。

2026-11-09 MMP 评审 F1：通用 Planning 契约允许内容 redacted 但已知 Issue ref；原 `content.kind === WorkItem` 排除它，membership 写成 Issue 后永久失去旧 Draft 证据。评审保存的两 Storage 连续同步反例均红，主控已独立重跑确认；该事实推翻 Design 原一概排除 redacted 的假设。

## Decision Log

- Decision：选择 bootstrap 旧 membership 证据 + helper 全局 occupant 检查。Rationale：用现有唯一身份源实现最小闭环，保持原执行谱系并 fail closed。Date/Author：2026-11-09 19:02 +08 / independent spec reviewer。
- Decision：不增加 migration/compatibility，不修改 Status/native dependencies。Rationale：用户要求当前受支持契约的可逆 PR；工程通过不是规划或发布接受。Date/Author：2026-11-09 19:02 +08 / independent spec reviewer。

- Decision：以当前 Planning binding 校验 project 与内容 ref，先降级旧 primary 再升级目标。Rationale：独立评审反例证明 Provider 返回值不能选择其他 binding 的身份，且 Storage 没有列表顺序契约；两项均在现有事务内修复。Date/Author：2026-11-09 19:24 +08 / implementation owner。

- Decision：Batch 2 直接按显式 Issue 身份提升，内容维持 redacted。Rationale：身份事实独立于正文可见性，复用原唯一事务避免额外等待状态或无关整轮拒绝。Date/Author：2026-11-09 / Batch 2 implementation owner。
- Decision：用户本会话针对评审 PR #583–#585 的直接授权（主控逐字转交，覆盖 #583）：『如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并。』Rationale：本实现者只完成本地修复和验证，不批准自己的实现、不执行任何外部写入；当前 #583 初审无 P0/P1、只有 F1 P2，主控负责最终门禁与合并。Date/Author：2026-11-09 / coordinating owner（转交）与 implementation owner（本地执行）。

- Decision：按独立 P3 收敛为 `(content.kind === WorkItem || content.kind === Redacted)`，不彻底删除内容种类 guard。Rationale：只新增此次合法遮罩形状，避免改变 issue ref + ChangeRequest 内容的既有非法输入行为；主控同意该范围，不扩建 validator。Date/Author：2026-11-09 / independent reviewer 与 coordinating owner（裁决）、implementation owner（执行）。

## Idempotence and Recovery

重复同步依自然键和 promotion 幂等，不能分配第二个 entity 或重复 alias。事务失败可用同一来源状态重试；target 被占用则保持 Conflict 供人工调查，不能自动 merge。测试仅使用临时目录与凭据空夹具，不修改实际用户库。未发布前仅撤销自己明确拥有的文件；已公开后的历史整理由交付 owner 按 recovery anchor 与精确 lease 规则执行。

## Interfaces and Dependencies

依赖 Node >=22、pnpm 10.28.2、现有 Core/Storage 事务和 Planning membership 契约，无新增包或凭据。入口继续为 `composeCore`、`commands.refreshPlanning`，helper 维持 `PromotionOutcome`。目标自然键为 `(bindingId, externalKind, externalId)`，entityId 不含 membership。测试只通过可控 Provider 状态制造转换，不在真实 GitHub 创建或转换用户项目。

## Outcomes & Retrospective

2026-11-09 Batch 2 最终独立复评：P2/F1 与复评 P3/F2 均 ADDRESSED，未发现剩余新增 P0–P3；最终 76/76（32 新集成、42 相关、2 原反例）、真实 GitHub adapter 4/4、typecheck、boundaries 9/9 和 diff check 通过。原四项加已知身份遮罩 M5 的最终整表五项全部 KILLED 且 killedBy 归因成功，前后基线绿、源码还原。产品补丁 digest 与文件哈希见 `docs/review/pr-583-mmp-review.md`，提交整理后必须保持这些产品 blob 相同。Batch 2 工程实现及独立复评完成，计划归档；最终推送、当前 Bot 批准、checks/threads/双向 issue 与条件 rebase 结果按本计划命令回读，不预写结果。

原设计时结论：仅完成设计综合，尚无新增测试执行或实现结果。**Superseded by 本节（2026-11-09 19:13 +08）**：Batch 1 的实现与本地工程验证已完成。

在检出 `fix/draft-promotion` 的 `.worktrees/draft-promotion-20261109` 根目录执行本计划命令：首轮 RED 的 16 条用例有 6 条按预期失败，分别是两 Storage 的原 entity 连续性、全局目标占用和第二条身份写故障；其他 10 条控制通过，未发生夹具初始化错误。最终窄测试扩充为 22/22，覆盖本实体已有 Issue alias 的 id 复用、不同 binding 和 redacted 控制。原 Draft identity 的 id 与 entityId 保留且降为 historical，原 context/run/relations/mutation receipt 不变，SQLite 文件真实 close/reopen 后继续通过。

首轮实现证据（19:13 +08）：约定回归 42/42，`pnpm verify` 完整执行 typecheck、1423 条契约、2094 条集成和 226 条 E2E，全部通过、零 skipped/todo；`pnpm boundaries` 9/9。`git diff --check`、disclosure 与 size 门在提交后按当前 HEAD 回读，机械检查通过；人工五类目检查无凭据、本机身份、账号个人信息、内部系统或保密内容。代码与文档均低于 Global Constraints 上限。

修复轮 1 证据（19:24 +08）：新增混合 binding 与 alias-first 的两个用例分别在 Fake/SQLite 复现，RED 为 26 条中 4 条预期失败、原 22 条通过；固定边界和写入顺序后 26/26。评审保存的独立反例 4/4，约定回归 42/42，完整 `pnpm verify` 为 typecheck、1423 条契约、2098 条集成、226 条 E2E 全通过且零 skipped/todo，boundaries 9/9。跨 binding 拒绝时两边身份与所有已提交业务事实均不变，alias-first 保留两条原 identity id、唯一 primary 与重复刷新幂等。修复后的独立复评仍待新 head 验收。**Superseded by 本节下一段（2026-11-09 19:29 +08）**。

本批没有新增技术债、schema 变更、历史重复实体迁移或兼容层。只调整生产同步身份登记的顺序与 helper 的全局占用检查，现有事务负责回滚。最终独立代码审查、最终远端回读与人类评审尚待交付 owner（独立代码审查部分 **Superseded by 本节下一段（2026-11-09 19:29 +08）**）；本地绿测不代表真实平台转换观察、人类 UAT、规划接受或 R1。

独立最终复评（2026-11-09 19:29 +08，观察 head `38ac942fa2f4fbea4bc34651c58b3ecdf95556d2`）：两项发现均 ADDRESSED，修复差异无新增缺陷；reviewer 独立执行 68 条相关测试、4 条原反例、typecheck 和 diff check 全通过。交付整理仅收敛 commit，必须核对产品树保持相同，并在最终 push 后以 `gh pr view 583 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,statusCheckRollup,closingIssuesReferences` 回读。人类评审、真实 GitHub 转换观察、UAT 和 R1 保留原判定者。

Batch 2 本地修复证据（2026-11-09，在检出 `fix/draft-promotion`、起点 `334bff7b9c4b5d1e3d4420710c98524ecc4c9ae5` 的上述工作树）：先替换错误 redacted 负断言并增加连续性用例，30 条中原有及未知 project_item 控制 28 条绿、两 Storage 已知 Issue 身份遮罩用例在原 entityId 不同处预期 RED；评审保存的独立 2 条均 RED。唯一行为修复是去掉身份提升对正文可见性的前提，另将无内容身份注释明确为 project_item。**Superseded by 本节 P3 收敛证据（2026-11-09）**：最终条件只由 WorkItem 扩展为 WorkItem 或 Redacted，避免新增非法组合的提升。GREEN 为新窄集 30/30、原独立反例 2/2、原约定回归 42/42。新增测试检查 redacted 投影的精确内容、查询不含旧/新正文 canary 与来源号码，context/run/relations/receipt 不变、重复刷新不推进内容 revision，以及 SQLite 在遮罩期间真实 close/reopen 再恢复可见后保持连续。未知 project_item 无论旧 membership 是否存在均不生成 Issue/project_item 内容身份。

`pnpm verify` 实际完整执行并 exit 0：typecheck、1423 条契约、2102 条集成、226 条 E2E 全部通过，零 skipped/todo；`pnpm boundaries` 9/9、`git diff --check` exit 0。运行日志保留于 `.superpowers/pr583-p2-repair-20261109/` 的 `red-new.log`、`red-independent.log`、`green-new.log`、`green-independent.log`、`green-regression.log`、`verify.log` 和 `boundaries.log`。publication 五类目人工核查本批新差异未发现凭据、本机身份、个人信息、内部系统或保密内容。`disclosure`/`size` 脚本对仍未改写的提交 HEAD `334bff7b` 返回 exit 0，仅证明原提交范围；Batch 2 及未跟踪 Active 计划尚未提交，不冒称该命令已覆盖它们，最终整理后由主控重跑。本批无新增技术债、迁移或权限 authority，未修复既有历史分叉库。原观察时仅完成本地实现与验证；保持 Active 等待独立复评。**Superseded by 本节开头 Batch 2 最终独立复评（2026-11-09）**：复评已完成并归档，最终 commit/远端回读及条件 rebase merge 由主控接续。实现者未 commit/push、批准自己的修复或改写远端事实。

P3 收敛证据（2026-11-09）：在原控制矩阵新增 issue ref + ChangeRequest 内容，先运行窄集 32 条中 30 绿、2 条预期 RED；改为明确 OR guard 后 32/32，原独立红反例 2/2、相关回归 42/42、typecheck exit 0。日志为同运行目录的 `p3-red.log`、`p3-green.log`、`p3-independent.log`、`p3-regression.log`、`p3-typecheck.log`。此前完整 verify 结果属于无 guard 的本批初版；最终小范围 guard 收敛有上述新证据，未冒称重跑完整 suite。Active 状态和独立复评门保持不变，最终变异整表由独立 reviewer 执行。

## Bottom Change Note

2026-11-09 19:02 +08：独立最终 reviewer 根据三套备选与 owning source 创建单 Batch 完整计划，补全全局 occupant、事务原子性、历史 alias 和证据边界。

2026-11-09 19:13 +08：完成生产入口身份提升与全局占用拒绝，记录实际 RED/GREEN、完整验证与证据边界；移至 completed 并更新索引，独立评审和远端交付待 owner 接续。

2026-11-09 19:24 +08：根据独立首轮 P1/P2 反例修正 binding 所有权验证与 alias-first 写入顺序，补充各 Storage 的判别性 RED/GREEN；独立复评与最终远端交付仍待 owner 接续。

2026-11-09 19:29 +08：交付 owner 登记独立修复复评通过，保留原反例及历史未完成结论的原位 Superseded 标注，进入最终提交整理与远端门禁。

2026-11-09：因 MMP F1 重新打开为 Active 并增加 Batch 2；原 redacted 排除结论原位 Superseded，明确身份/内容边界、三案取舍、实现权限、条件授权和独立复评恢复门。

2026-11-09：记录 Batch 2 真实 RED（28/30、独立0/2）与 GREEN（30/30、独立2/2、回归42/42）、完整 verify 和边界结果；保持 Active 等待独立复评，未提前归档或发布。

2026-11-09：依据独立修复复评 P3 先新增非法内容组合 RED，再把正文类型条件收敛为 WorkItem 或 Redacted；记录 32/32、独立2/2、回归42/42和typecheck，等待最终独立变异表。

2026-11-09：登记 Batch 2 独立最终复评和五项变异通过，归档计划；实际远端收尾与人类安装/R1 判定保持独立。
