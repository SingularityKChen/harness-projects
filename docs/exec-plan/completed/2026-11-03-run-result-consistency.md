# Start Work 结果与持久 run 一致性 ExecPlan

> 状态：Completed；创建：2026-11-03；规范：根 `PLANS.md`。
> 闭环：Closes #458；Refs #215、#73、#413。
> 执行上下文：检出 `fix/run-result-consistency` 的 `.worktrees/run-result-consistency` 根目录；独立以 `main` 为 PR base，无 stack 前提。

## Purpose / Big Picture

用户首次开始工作、同键重放、恢复供应或遇到工作树验证失败时，结果中的 runExternalId/fallback 与该调用有权读取的已持久运行一致。上下文 Failed 不会抹掉已发生运行的身份；unknown 仍为 unknown。Fake/SQLite 对同一个 ExecutionRunRecord 读回同一声明形状，调用者改输入/输出不能篡改存储权威。最小证据是生产 command→Storage→Query 三方字段断言、真实 SQLite 关闭重开、恢复围栏与共享存储合同。

## Context and Orientation

调查基线为 2026-11-03 SGT 的 `main @ f5ae377d98c43ed216f680cb72e5f35d73a2b8e1`。#458 为 P0 MMP-Core 必需正确性闭环，issue 明确未承诺 iteration；本轮优先它而非 Post-Core #281 新页面，是修复可复现事实矛盾的工程范围选择，不是修改 Project Iteration/Status，也不是发布日期承诺。#215 的取消幂等/ack/clock 剩余范围继续开放。

`start-work.ts` 已有 request fingerprint、owner generation、external intent、run journal、receipt replay 与 admission 栅栏，#193/#421 的恢复机制不得另建替代。`ExecutionContextStatus.Ready` 表示 Git/上下文可用，`ExecutionRunStatus` 是运行事实，两轴可分别 Ready/Failed。`fallbackOf(run)` 只认持久 `fallback === true`，不能按上下文失败、当前默认绑定或旧 caller 报告猜测。

已定位的根因是：非 running 的人工 fallback ack 持久了 providerRef，但首次结果漏 run ID；已有 unknown run 路径丢 fallback；确定 worktree 验证失败分支清掉仍存在 run 的 ID；`recoverAttempt.uncertain` 可用 intent 覆盖持久 fallback。Fake put/get 直接保留对象引用；SQLite 读回则重建四元引用并省略非 true fallback，两实现对 false/undefined/extra keys 不同形。

## Design / Spec

采用局部同源投影，保留当前生命周期。对于有权观察的已有 run，结果的 fallback/runExternalId 只投影该记录；已完成写入的首次结果由该次规范 run 构造。`WriteReport` 继续裁决 phase/writeState/confirmed/error，run 只裁决运行身份/是否人工降级；保留 ID 不提升 confirmed。worktree 确定缺失或分支不符可改变 context 状态，但不能删除/改判既有 run；临时不可读保持 Ready+Unknown，并不新起运行。

恢复供应读到已有主/备用 run 时不重复启动；unknown run 保留其 ref/fallback。`recoverAttempt` 不得因旧 intent 为 startFallbackRun 就把已有 primary run 的 fallback 改成 manual；没有持久 run 时也不把 intent 当已发生 fallback 的权威。Unknown receipt/intent 保留供对账。mismatched replay、owner 失去、撤权、epoch 变化仍沿现有拒绝/脱敏行为，不能借用赢家 run 的身份。

已获 generation 的恢复供应在原有步骤回填、intent 和 settle 的 owned 短事务中观察既有 run；Git 确定失败投影 settle 时的快照，本地结算失败保留该调用有权观察的快照。该机制只包 Git 供应，本来沿用 existing run 的 receipt 故障显式携带该次已读 ref/fallback，不能补读赢家记录。这里“有权”还须在 LocalWriteFailed 返回边界再次确认当前 Planning 可见性与 admission epoch；若失效或无法确认，只清 runExternalId/fallback，原 Unknown/副作用信息/receipt 不变，不转 AdmissionInvalid 确定失败。供应前 route 拒绝保持原有拒绝/脱敏契约；尚无供应与 issuer 路由授权时，unavailable 与 permission 两类都不补读或回显 run。

ack 已发生而本地 journal/receipt 写失败时，现有调用可能掌握尚未落库的 ack 句柄；保留现有 Unknown 与该调用已知信息，不能以无条件 Query 重读把它清掉。禁止在命令尾部统一调用 getExecutionContext、增加 ledger/retry、从 UI/client 修补 ID，或让旧 caller 回写权威。

在当前 run 单写者只挑 providerRef 的 `bindingId/objectKind/externalId/url` 四字段，不存额外输入键；已 ack ref 的校验与 issuer 路由不放松。Storage 的 ExecutionRunRecord 往返语义固定为：声明顶层字段；fallback 仅 true 时保留，false/missing/undefined 省略；providerRef 缺失/undefined 省略，有 ref 则总有 `url: undefined` 或原 URL；extra keys 丢弃。Fake 仅在该记录 put/get 边界新建声明字段和嵌套 ref 快照，SQLite writer/read mapping 与相同合同对齐；无 schema/migration。优先局部函数，不为单记录新建公共 capabilities snapshot API 或重构全 Storage。

主执行 binding.isDefault=true、人工备用=false 已有实现，补直接持久绑定断言；不能因 issue 要求就重写角色系统。两份独立设计一致支持局部结果同源；综合评审舍弃通用终结器、完整 Query 重建与跨记录 clone 框架，并补足 uncertain intent 不能覆盖 run 的负例。

## Global Constraints

run-result owner 独占本闭环，不改 #418 的 context/delivery/queries/chain 写区。允许文件集只在此声明：`packages/core/src/start-work.ts`，必要时 `packages/core/src/execution-context.ts` 仅共享纯 run 事实投影；`packages/providers/fake/src/storage.ts` 仅 ExecutionRunRecord；`packages/storage/sqlite/src/storage-execution.ts`、`packages/storage/sqlite/src/storage-rows.ts` 仅 run 编解码；`packages/capabilities/src/storage.ts` 仅澄清现有字段合同，不扩 API；`tests/contract/suites/storage-execution.js`，若新增注册 case 需要则同步 `tests/contract/suites/storage.js` 与 `tests/contract/storage-contract.test.js` 的真实装配账；`tests/integration/start-work-execution-recovery.test.js`、`tests/integration/start-work-external-intent.test.js`、`tests/integration/start-work-sqlite-registration.test.js`、`tests/integration/human-execution-provider.test.js`、`tests/integration/execution-context-run-status.test.js`，必要时 `tests/e2e/start-work.test.js` 的直接旧期望；`docs/review/pr-531-mmp-review.md`（保留评审原文并追加作者修复证据）；本计划。复用现有 fixture，不复制另一套恢复装配。索引允许在 `docs/README.md` 为本计划写一条记录，由集成 owner 串行更新；实施者暂不编辑。

代码/测试/config/fixtures additions+deletions 必须 ≤800；文档必须 ≤1300。实际体量按当前 base 与 worktree 差异重算，不以实现前估算作为最低规模。先精简重复装配，不能删 owner/permission/receipt/负控测试为体量过关。Host/Storage 权威、Planning 与工程正交、Provider ack/reconcile 前无权威 Saved、凭据句柄、唯一 run 和谱系身份全部保持；不调用付费模型，不写真实 GitHub 业务，不删除 context/run/worktree。其他 Storage 记录别名、取消与 clock 不在本批。

## Plan of Work

### Batch 1 · 当前范围与 draft

主文件为本计划。回读 #458/#215，核对已定位返回路径与现有恢复测试，记录主/备用角色和 canonical shape。提交计划后建立 base=main 的独立 draft，回读 head/base/draft/Closes #458；完成后才开始行为实现。

执行 `gh issue view 458 -R SingularityKChen/harness-projects --json title,body,state`、`gh issue view 215 -R SingularityKChen/harness-projects --json body,state`、`rg -n 'existingRun|existingResult|uncertain|recordRun|putExecutionRun|getExecutionRun|isDefault' packages/core/src/start-work.ts packages/core/src/registry.ts packages/providers/fake/src/storage.ts packages/storage/sqlite/src/storage-execution.ts packages/storage/sqlite/src/storage-rows.ts`，期望新远端事实未推翻 scope。回滚点为计划提交，无业务写入。

### Batch 2 · 先红：三方事实与共享往返

主文件为现有恢复、external-intent、human 与共享 storage execution 测试。先固定以下失败：fallback ack failed 首次漏 ID；manual unknown existing run 丢 fallback；worktree 确定缺失/错误分支返回漏 ID；旧 fallback intent 与持久 primary run 矛盾；Fake 输入/输出 ref 别名。每例有 primary 正控、精确 Provider 启动次数和无故障对照，不以 Fake 自带幂等掩盖第二次启动。把 external-intent 中明确留给 #458 的旧漏 ID 期望就地替换并解释。

共享存储用同一组子案例覆盖 true/false/undefined/missing fallback、缺 URL/显式 undefined/extra keys、put 后改输入、get 后改输出、Fake 导出重建与 SQLite 关开。优先在既有 case 内加判别子例，若注册数变化则准确更新真实台账，不能减少基线断言。

执行 `pnpm test:file tests/contract/storage-contract.test.js tests/integration/start-work-execution-recovery.test.js tests/integration/start-work-external-intent.test.js tests/integration/human-execution-provider.test.js tests/integration/execution-context-run-status.test.js`，保存失败断言证明触及根因；导入错误不算有效红。回滚点为仅测试提交，可重复运行，不动用户持久数据。

### Batch 3 · 最小修正、恢复与 restart 绿

主文件为 start-work 与 ExecutionRunRecord 的窄存储边界。按 Design / Spec 收敛有权结果与规范写入，不重构所有返回分支。复用现有真实 command/restart fixture，覆盖首次/同 key/新 key、primary/manual、已知/unknown、供应 resume、确定/临时 worktree 验证失败；分别比较结果、Query 和 run，且不因 context Failed 改判 run Failed。

重复 Batch 2 命令，继而执行 `pnpm test:file tests/integration/start-work-sqlite-registration.test.js tests/integration/start-work-owner-fencing.test.js tests/integration/start-work-execution-uniqueness.test.js tests/integration/start-work-request-binding.test.js tests/integration/local-git-start-work-resume.test.js tests/e2e/start-work.test.js`，期望全 pass、真实 SQLite restart 后同一 ID/fallback、无第二次 start；lost ack、receipt rollback、晚 finalizer、撤权和 mismatched replay 的已有负例保持。临时恢复缺 ID、清空已存 ID、intent 覆盖和去 Fake snapshot，分别使对应案例失败；撤销负控后重跑。回滚整个实现批，不删除证据行或外部资源。

### Batch 4 · 交付与独立评审

主文件为本计划的执行记录。因身份/持久化/并发触边，执行 `pnpm run typecheck`、`pnpm run boundaries` 与 `pnpm verify`，期望全 pass；这是本地证据，不代表 hosted CI 或安装产品验收。独立 reviewer 重点否证旧 owner 借赢家 ID、ack-only 信息被清、unknown 被升级三种路径。若否证，回到 Batch 2 补判别 red，不能只加分支补丁。

整理 commit 后执行 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`，并用 Git argv 执行 `git diff --check origin/main...HEAD`；期望体量达本计划上限、机械和人工五类发布面扫描通过。push 后执行 `gh pr view fix/run-result-consistency -R SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,statusCheckRollup,closingIssuesReferences,reviewDecision`、`gh pr checks fix/run-result-consistency -R SingularityKChen/harness-projects --required`；按 `docs/review/README.md` 分页回读所有 review threads。最终 head 验证通过后才 Ready，交用户评审、不合并。回滚整个闭环 PR，不需要新迁移或数据清理。

### Batch 5 · 正常 Git 失败返回的当前准入闭环

本批只修 review 5761960471 的 F1；原评审绑定 head `4325e9502a59f79bdb044fe34a00076625d3720f` / main `f5ae377d98c43ed216f680cb72e5f35d73a2b8e1`。在 `tests/integration/start-work-execution-recovery.test.js` 的真实 bootstrap/receipt 交叉矩阵纳入正常 Git failure、磁盘失败和准入不可读取，先运行 `node --test --test-name-pattern='git-failure.*admission|git-failure.*unconfirmable' tests/integration/start-work-execution-recovery.test.js`，预期修复前撤权/不可确认断言失败而未撤权正控通过。

采用一个私有运行身份过滤函数，复用原异常出口的 `startTargetError` 与 await 后的同步 epoch 复核；正常 `!git.ok` 与 LocalWriteFailed 两出口共用。只在当前准入仍成立时返回已知运行身份；读取抛错或失效只去 `runExternalId/fallback`，不改变 failed/unknown、原错误、receipt、context/run，不补读后继或增加 start。放弃在 settle 中追加一次预检：它无法覆盖事务正常提交之后的并发失效。放弃无条件 Query 重建或顶层统一所有结果：会扩大正常成功/owner/ack-only 的合同半径。

修复后运行评审原八例 `node --test .superpowers/review-531/admission-git-failure.test.mjs`（预期 8/8），上述正式矩阵及 `node --test tests/integration/start-work-execution-recovery.test.js tests/integration/start-work-external-intent.test.js tests/contract/storage-contract.test.js`；再运行原 owner/唯一性/request/Local Git/run-context/human 六文件、`pnpm run typecheck`、`pnpm run boundaries`、`pnpm verify`，预期全通过。执行 review-mutate 的原八项并新增正常失败 bypass/错误升级/不可确认继续暴露的归因变异；必须失败且按字节恢复。由独立验收者检查本批返回边界、正常/读取失败/本地失败、不可提升 unknown 与零重复 start；原正式评审线程保留，由协调会话真正复评后决定 resolve。

工程验收后将同一计划重新归档，保留 review 记录；整理提交前建立 backup ref，确认当前 author 账号与远端 head，用精确 lease 更新 #531 的原分支，不改 #529/#530、不合并。最终回读当前 head/base、Closes #458、全部 checks/threads；用作者账号回复原 inline 4462540004，提供新 head、命令和证据。回滚单位仍为整个 PR；本批临时恢复产品旧分支只能用于受控变异且必须还原。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 已落库 run 的首次/重放/resume/验证失败结果同源 | command→Storage→Query 三方 ID/fallback 断言，primary/manual 正反控 |
| 运行轴与 context/WriteReport 正交，unknown 不升级 | failed worktree+存活 run、unknown existing、ack-only journal fault |
| 旧 intent/caller 不覆盖持久 run，不借赢家身份 | mismatch/uncertain intent、owner fencing、撤权和迟到 finalizer 负例 |
| Fake/SQLite 精确 shape、无输入/输出引用篡改 | 共享 execution suite 的 shape/mutation 子例及两种 restart |
| 主/备用角色明确，不重复启动，不改变既定恢复 | 持久 isDefault true/false、真实调用计数、uniqueness/recovery/Local Git+SQLite |
| 独立可审阅回滚，最终证据真实 | 本地 verify、当前远端 head/base/checks/threads/Closes #458；无 parent 人验代签 |

## Progress

- [x] (2026-11-03 17:18 SGT) 核对源码、独立复现报告与两设计，收敛 run 权威/ack-only 例外及窄存储范围。
- [x] (2026-11-03 SGT) Batch 1：集成 owner 已回读 scope，提交计划并建立独立 draft #531；实施者不重复发布。
- [x] (2026-11-03 SGT) Batch 2：根因组 376 项中 36 项有效断言失败；补充 alias red 4 项中 2 fail、SQLite 原始列 red 1 fail，均保存于本检出的 `.superpowers/iteration9/`。共享新增 2 个注册 case，组账与装配账同步。
- [x] (2026-11-03 SGT) Batch 3：最小实现后根因组 379/379、真实 SQLite/Local Git/owner/唯一性/request/E2E 回归 259/259；七项负控分别恢复旧缺陷，均以 AssertionError exit 1 判别，恢复后完整套件无失败。
- [x] (2026-11-03 SGT) Batch 4 本地验证：typecheck exit 0、boundaries 9/9；临时 pnpm launcher 下 `pnpm verify` exit 0（主套件 3491/3491、MVP0 7/7）。
- [x] (2026-11-03 SGT) Batch 4 独立首评发现 1 个 P1：已准入恢复供应再次 Git 失败漏 run 事实；追加 28 项根因验证中 24 fail/4 owner 正控 pass，修复后新增 36 项定向矩阵通过。初轮结论 Superseded by Outcomes & Retrospective 的独立评审后修复记录（2026-11-03）。
- [x] (2026-11-03 SGT) Batch 4 独立二轮确认前 P1 已修复，但否证新增 enrichment 的撤权竞态；新增 28 项中 12 个有效 red / 16 个正控，出口保护后 28/28。前轮总体收口结论 Superseded by Outcomes & Retrospective 的二轮准入修复记录（2026-11-03）。
- [x] (2026-11-03 18:37 SGT @ `17f947c4650facba0a7269a8edbb4131b293d5e7`) 工程集成交付已完成：单一能力提交、发布面、当前 main/head、Closes #458、零线程回读及 hosted PR Fast Gate/Verify/Browser/Merge Gate/Issue policy/size/disclosure 通过，PR #531 已 Ready；待用户 PR 评审，规划与产品接受另行裁决。 Superseded by Batch 5 的正式 F1 修复与新 head 复审（2026-11-04）。

- [x] (2026-11-03 18:23 SGT @ `d9d10718824ab4647956fb2253c9c5bda7f34fdc`) 独立最终复评 PASS，已报 finding 均关闭；本地证据见 Outcomes。 Superseded by Batch 5 的正式 F1 修复与新 head 复审（2026-11-04）。
- [x] (2026-11-03 18:37 SGT @ `17f947c4650facba0a7269a8edbb4131b293d5e7`) 原子提交与当前远端门已完成；归档路径更新后继续按 Plan of Work 对新 head 回读。


- [x] (2026-11-04 09:40 SGT) 用户交回正式 REQUEST_CHANGES；原八例已复现 4 失败/4 正控，正常 Git 失败出口未复核当前准入。
- [x] (2026-11-04 09:45 SGT) Batch 5 正式红绿：20 新增例先 8 fail / 12 pass，最小过滤后 20/20；评审原八例 4 fail / 4 pass 转 8/8。原三文件扩展后 453/453，原六文件 104/104，边界 9/9 与类型检查通过；12 项归因变异全部 KILLED 且源码按字节恢复。
- [x] (2026-11-04 09:51 SGT) Batch 5 工程验收：完整 verify 3575+7，内部独立原八例/32边界/48正式/104回归全部通过，独立 epoch-gap 变异 KILLED；正式评审原文及作者修复证据随 PR 保留，计划重新归档。发布后当前 head/checks 与作者回复按本批命令回读，正式 REQUEST_CHANGES/resolve 仍交协调会话裁决。

## Surprises & Discoveries

fallback 非 running ack 的旧测试明确把漏 ID 留给 #458，不能把旧绿测试误作一致性证据。确定工作树失败时 run 仍落库，证明不能从 context 状态推断 run 消失。SQLite 已局部规范化 ref，而 Fake 保存/返回原引用；修正应限制在 run，不能借本 issue 重做全 Storage。当前恢复围栏覆盖面已大，最危险的“简化”是无条件重读赢家记录再覆盖旧结果。

执行发现：完整 `pnpm verify` 首次 exit 1，主套件 3489 pass / 2 fail，失败均在 `harness-plugin-bundle-report.test.js`：系统 pnpm placeholder 无 shebang，`execFileSync('pnpm')` 报 ENOEXEC，fixture 安装未发生后继才报缺 esbuild。只在忽略的运行态目录创建带 shebang launcher，仍执行同一 pnpm 入口，`--version` 回读 10.28.2；该文件 11/11 后完整 verify 3491/3491 + 7/7。未改测试、依赖或产品代码以绕过环境失败。原始失败与最终成功日志均保留。

执行发现：现有测试矩阵已包含大量围栏与恢复组合，在其中补三方 ID/fallback 断言即可判别主要缺陷，实际代码体量显著低于设计前估算。SQLite 的读映射会丢额外键，单看 get 不能证明 writer 白名单；补原始持久列断言，并在 Core 的 put 边界观察声明字段，避免 Fake/SQLite 读映射掩盖单写者错误。

独立评审发现：真实连续命令「首次成功 → 同 key 确定 worktree missing → 新 key 恢复 createWorktree definite unavailable」仍从纯 GitOutcome 返回，漏已有 run ID/fallback。追加故障确认同因可达于 step journal、intent receipt、settle receipt、existing-run receipt；恢复的 owned 事务必须在写入之前读取原 run，使本地回滚也能保留该调用已知事实。无条件 Query 或异常后读取不能修复这条围栏。证据为 `.superpowers/iteration9/review-fix-red.log`。

独立二轮发现：owned 快照不能替代当前 runtime admission。真实 Planning refresh 的 permission_denied 同步使 runtimeAccess.deny 生效，intent 写盘若先抛异常，会跳过事务末 validate，原 LocalWriteFailed enrichment 仍可回显旧 run；同因也可达 existing-run final receipt。新增反例不 mock runtime，只用真实 bootstrap 拒绝与磁盘故障；另以无法读取当前 Planning 投影验证 fail closed。证据 `.superpowers/iteration9/admission-fix-red.log`：28 项中 12 fail / 16 pass。

## Decision Log

2026-11-04 / 评审会话中的用户授权：针对PR #529–#531，用户要求无P0/P1或只有P2/P3时修复、独立复评、归档、整合提交、核对issue，再以 `merge_method=rebase` 合并。#531首轮P1已由原owner修复；协调者独立8+88例复评与最终3582+8+42组合通过。当前head/base门禁仍必须在main移动后重新回读，不推进规划Status、#215或R1。


- Decision：本轮纳入尚未排 iteration 的 #458，优先于 Post-Core #281 新页；不更改规划字段。Rationale：它是可复现的 P0 Core 事实错误，空 timebox 不免除首发正确性；用户授权本轮连续交付，未授权工程事件代写 Status。Date/Author：2026-11-03 SGT / 综合评审。
- Decision：已落库 run 是 fallback/ID 权威，ack-only 本地失败保留原 Unknown 信息；不采用通用终结器和完整 Query 重建。Rationale：同时消除双重事实，又保持 owner/admission/对账证据边界。Date/Author：2026-11-03 SGT / 综合评审。
- Decision：只规范 ExecutionRunRecord，保留现有主/备用路由，先不新增公共 snapshot API。Rationale：现有单写者与局部映射能闭环，公共抽象与全记录 clone 会扩大职责。Date/Author：2026-11-03 SGT / 综合评审。

- Decision：环境修复限制为 `.superpowers/iteration9/bin/pnpm` 的临时 launcher，以 PATH 前置执行验证，不修改仓库依赖与测试。Rationale：已独立复现 Node direct spawn ENOEXEC，shell 启动的同一入口则为规定版本；修复只恢复子进程可执行条件。Date/Author：2026-11-03 SGT / 实施者。

- Decision：P1 修复只在已获 generation 的 resume 路径、既有 owned 事务内观察 run；失去 owner、AdmissionInvalid 和预准入 route !ok 不补读。Rationale：供应前路由拒绝尚未得到供应与 issuer 路由授权，外观统一不能覆盖现有脱敏；unavailable 与 permission 均保持原拒绝契约。四个预准入正控同时断言 Failed、无 ID/fallback、根与事务 getExecutionRun 调用均为 0。Date/Author：2026-11-03 SGT / 集成 owner 边界裁定与实施者源码核对。

- Decision：在现有顶层 LocalWriteFailed 结果出口复用 startTargetError，await 后同步复核 runtimeAdmissionError；当前可见性、准入或 epoch 无法确认则只去 run ID/fallback，仍返回原 unknownAfterAck。Rationale：同时覆盖 intent 与 final receipt 的本地异常，保留仍有权时的 ack-only/既有 run 正控，不补读 run、不碰原 receipt，不把可能发生副作用的 Unknown 改成确定失败。Date/Author：2026-11-03 SGT / 二轮独立复现与实施者。

- Decision：只覆盖正式 F1 的正常失败与原本地异常身份返回，抽取同一私有准入过滤，不改变结果写状态/收据或增加运行读取。Rationale：身份权威与身份可见性正交；settle 的 owner 保护不能保证返回时 Planning 仍允许披露。Date/Author：2026-11-04 09:40 SGT / 原实现会话。

## Idempotence and Recovery

测试只在自身 Fake/临时 SQLite/临时 Git 运行，可重复并清理自建资源。现有 owner generation、fingerprint、external intent 和 runId 派生不变；未知外部结果保留 journal/receipt 后对账，不能通过再 start 试探。Git 用 argv/library API，整理共享历史先建恢复 ref，再按根规则精确 lease；保留其他工作树修改。发现 schema 或跨记录重构才可闭环时，先回到规格与预算重估，不静默迁移或删数据。合入回退单位为整个 PR，不取消或清理真实已发生运行。

## Interfaces and Dependencies

沿用现有 Core StartWorkResult、ExecutionRunRecord、StorageTransaction、ExecutionProvider 和 ADR-0008 运行来源语义；无新 ledger、事件流、Provider 方法、依赖或 schema。使用既有 Node/pnpm、Fake/SQLite 和 Local Git 测试工具；无真实模型费用。GitHub 凭据只用于获授权 draft 与当前 PR 回读。原 #215 cancel/clock 与人类产品验收保持各自 owner。

## Outcomes & Retrospective

初轮局部实现与本地验证如下；整体 AC 完成结论 Superseded by 本节独立评审后修复记录（2026-11-03）。所有命令均在检出 `fix/run-result-consistency` 的本工作树根运行：Batch 2 五文件命令 379/379 exit 0，Batch 3 六文件命令 259/259 exit 0；`pnpm run typecheck` exit 0、`pnpm run boundaries` 9/9 exit 0；`PATH="$PWD/.superpowers/iteration9/bin:$PATH" pnpm verify` exit 0（3491 + 7）。七个负控各自 exit 1 后均恢复；ack-only journal 首次仍保留本次 ID，后续没有 run 时不从 intent 猜 manual；existing unknown 和 worktree Failed 均保留 run 来源与 ID。

运行态证据集中在 `.superpowers/iteration9/REPORT.md`、`red.log`、`red-alias.log`、`red-sqlite-writer.log`、`green.log`、`regression.log`、`negative-*.log`、`verify.log`、`verify-with-launcher.log`、最终测试增强后再次完整通过的 `verify-final.log`。最终成功包含真实 SQLite 关闭重开、Fake 导出重建、Local Git 和既有 owner/permission/replay/uniqueness 负例。实施者未提交、推送或修改外部系统。完整提交后的机械扫描、当前远端 head/checks/threads、独立对抗评审与人类验收仍由集成 owner 完成，本地成功不能代签它们。未引入新技术债或 schema。

独立评审后修复：已明确恢复 Git 与 run 两轴，以及预准入拒绝边界。新增定向矩阵 36/36；初始 unavailable 策略正控把既有 `not_supported` 误写为 `unavailable`，产生 2 个测试期望失败，已据 `unsupportedCapability` 源码纠正并重跑，未把它们计入产品缺陷 red。修复后的完整 `PATH="$PWD/.superpowers/iteration9/bin:$PATH" pnpm verify` exit 0，主套件 3527/3527、MVP0 7/7；新五项负控均有效断言失败后按字节恢复。新的红绿、负控与最终完整验证见 `.superpowers/iteration9/review-fix-report.md`；原有初轮日志完整保留。独立复评与最终发布仍未代签。

二轮准入修复记录：前轮恢复供应 P1 已由独立复评确认消除；新增的撤权竞态按本节新 Decision 在既有错误出口最小保护。`admission-fix-green.log` 28/28，runtime Planning/operation、owner、唯一性与 request 回归 570/570；四项负控分别 12/12/8/4 个有效失败后按字节恢复。`PATH="$PWD/.superpowers/iteration9/bin:$PATH" pnpm verify` exit 0，主套件 3555/3555、MVP0 7/7；完整证据见 `.superpowers/iteration9/admission-fix-report.md`。独立复评与远端门禁仍未代签。

最终工程审读（2026-11-03 18:23 SGT，代码快照 `d9d10718824ab4647956fb2253c9c5bda7f34fdc`）：两轮独立对抗分别发现已准入 Git 恢复失败丢原 run，以及补丁的 LocalWriteFailed 身份丰富跨真实 Planning 撤权。前者在 owned 事务采样原 run，后者在既有异常出口复核当前准入/epoch，只隐藏失效身份而保留 Unknown、原错误与 pending receipt。最终独立原样 16 交叉例加相关回归共 586 项通过；owner 不借赢家，合法主备句柄保持，预准入拒绝仍不补读。 这是工程验收，未代替人类 PR 评审、规划接受或产品/R1 判定；最终 hosted head 另按 Plan of Work 回读。

托管交付记录（2026-11-03 18:37 SGT @ `17f947c4650facba0a7269a8edbb4131b293d5e7`）：本分支一个原子能力提交，head/base、双向关闭关联与全部 review threads 已回读；无开放线程。PR Fast Gate、Verify、Browser、Merge Gate、Issue policy 和实际 size/disclosure 检查通过，PR #531 已 Ready。以上是该发布快照的真实历史证据；本次仅归档计划/索引，当前 head 仍必须用 Plan of Work 命令重新回读。未修改看板 Status、Iteration 或 blocking 边，未代签父范围和人类 UAT。

2026-11-03 的最终 PASS/Ready 是当时历史证据；整体权限闭环结论 Superseded by Batch 5 与正式 review 5761960471（2026-11-04）。本批尚未修复或复评完成，不能沿用旧绿门禁。

正式 F1 修复本地证据（2026-11-04 09:45 SGT，`fix/run-result-consistency @ 4325e950` 加未提交本批改动）：评审原八例与正式新增矩阵均按正常 failed receipt 的真实 bootstrap 撤权同步条件复现，红失败皆为 run ID/manual 身份残留。抽取既有私有过滤后，两出口当前 Planning 可见性及 epoch 共用，保留原 failed/unknown 与 durable run/receipt；正式目标 453 项、回归 104 项、边界 9 项和类型检查通过。原 8 项加正常失败 bypass、错误改写 failed、读取抛错继续暴露、无条件隐藏合法身份四项变异共 12 KILLED，自动还原校验一致。完整 verify 与独立复评进行中，不借用旧 CI 或正式 review 通过结论。

正式 F1 工程收口（2026-11-04 09:51 SGT）：内部独立验收未修改产品或正式测试，原 8/8、新独立 32/32、正式准入 48/48、原回归 104/104 均 exit 0；隔离副本去掉 await 后同步 epoch 复核时 8 个对应反例失败，恢复后基线绿。完整 verify 为 3575+7，原八加新四变异全部 KILLED。源码/测试摘要与 `docs/review/pr-531-mmp-review.md` 作者附录一致。正式 review 5761960471 仍为 REQUEST_CHANGES，原 inline 不自 resolve；最终 head/base/checks 及作者回复在发布后实际回读，再交协调会话正式复审。

## Bottom Change Note

Change Note (2026-11-03 SGT)：由独立设计与源码根因收敛 #458，明确 run/WriteReport 双轴、ack-only 与 owner 例外、canonical shape 和不重复执行负控，并记录本轮纳入理由。

Change Note (2026-11-03 SGT)：记录实施红绿、七项负控、窄 run snapshot、原始 SQLite 列与 Core 写边界证据，以及 pnpm 子进程环境修复后的完整验证；独立评审和发布仍保留未完成。

Change Note (2026-11-03 SGT)：依据独立 P1 追加恢复 Git 与本地结算的 owned run 快照，记录预准入零补读拒绝边界；新增 root-cause red、owner/route 正控与负控，交集成 owner checkpoint 后复评。

Change Note (2026-11-03 SGT)：独立二轮否证 enrichment 可在真实撤权与磁盘故障交叉时回显 run；补返回边界可见性/epoch 保护，并明确 Unknown 与 receipt 保留、无法确认 fail closed。

Change Note (2026-11-03 18:23 SGT)：记录独立最终复评和实际根因修复；准备单一能力提交，远端 Ready 门尚待当前 head 回读。

Change Note (2026-11-03 18:37 SGT)：根据实际托管交付与 Ready 记录完成工程计划归档；保留人类 PR/产品接受及再次 push 必须回读当前 head 的门。

Change Note (2026-11-04 09:40 SGT)：因正式 P1/F1 重新打开同一计划，补正常 Git failure 的返回准入边界、TDD 矩阵与独立复评/作者回复流程；仅操作 #531。

Change Note (2026-11-04 09:45 SGT)：记录正式 F1 的原反例/正式红绿、共享最小过滤与 12 项归因变异；保留独立和当前远端门。

Change Note (2026-11-04 09:51 SGT)：完成正常失败返回的内部独立复评和完整验证，保留初审/作者证据，重新归档；发布与正式复审边界保持显式。

2026-11-04：记录协调者独立修复复评、最终三能力组合及本会话人类条件合并授权；产品文件与已测摘要不变。
