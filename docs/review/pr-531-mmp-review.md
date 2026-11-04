# PR #531 MMP 交付评审

> 状态：首轮评审完成，1 × P1 待修；观察日期：2026-11-04（Asia/Singapore）

## Purpose / Big Picture
判断“Start Work 持久化执行身份、fallback 与失败恢复”能否独立验收、合并和回滚。结论为请求修改：常规 Git 失败返回新增的 run 身份绕过并发 Planning 撤权；测试通过不能代替权限闭环。

## Context and Orientation
评审检出 `fix/run-result-consistency`，worktree `.worktrees/run-result-consistency`。初始及收尾回读均为 head `4325e9502a59f79bdb044fe34a00076625d3720f`，base `main @ f5ae377d98c43ed216f680cb72e5f35d73a2b8e1`；PR Open、Ready、MERGEABLE/CLEAN，一个交付提交。`closingIssuesReferences` 只有 #458，另 Refs #215/#193/#421。无既有 review/comment/thread，GraphQL 线程分页已穷尽。评审读使用 `gh-review`。原实现会话“筛选迭代紧急重要 Issue”负责本分支且当前 idle；评审方不并行改产品代码。

## Design / Spec
先建 P0–P3 矩阵，再以 Superpowers、Qian Systems Router 与 First Principles Development 完成代码、产品、架构、测试、工作项与反例审查。执行身份由 durable run 决定，写结果由 WriteReport 决定，当前准入决定是否允许回显；三者不能互相代替。恢复沿用现有 intent/journal/owner fence，不新增账本、重试系统或兼容层。协调者核实发现后统一提交一次 review；本记录不代表已发布 review。

## Global Constraints
唯一正式评审写入文件为本文件；临时复现、变异 spec 和日志置于 `.superpowers/review-531/`。不改产品或测试代码、Planning Status/依赖关系，不执行 GitHub 写入、commit/push/rebase/merge。Host 事实源、Provider ack、凭据隔离和七条不变量必须保持。证据区分本地、托管、已安装 Host、人类验收及 R1。

## Plan of Work
1. 已锁定 refs、全部 checks/threads、#458 及 completed ExecPlan；矩阵先于逐文件审查。
2. 已审查 11 个变更文件，沿 command → Git/执行 Provider → owned Storage → receipt → Query/controller 核对身份与权限；完成最窄测试、8 项变异与 8 例独立撤权交叉复现。
3. 已完成严重度分流与收尾 refs 回读；由协调者统一发布 REQUEST_CHANGES 并交原实现 owner 修复，再对新 head 复评。

以下命令均从本节所述检出根执行，产品文件保持该 head 字节：

| 命令 | 实际结果 | 运行态证据 |
|---|---|---|
| `node --test tests/integration/start-work-execution-recovery.test.js tests/integration/start-work-external-intent.test.js tests/contract/storage-contract.test.js` | 433/433，exit 0 | `.superpowers/review-531/targeted.log` |
| `node --test tests/integration/start-work-owner-fencing.test.js tests/integration/start-work-execution-uniqueness.test.js tests/integration/start-work-request-binding.test.js tests/integration/local-git-start-work-resume.test.js tests/integration/execution-context-run-status.test.js tests/integration/human-execution-provider.test.js` | 104/104，exit 0 | `.superpowers/review-531/regression.log` |
| `pnpm run typecheck`；`pnpm run boundaries` | exit 0；9/9，exit 0 | `.superpowers/review-531/typecheck.log`、`boundaries.log` |
| `node --test .superpowers/review-531/admission-git-failure.test.mjs` | 8 例：4 撤权反例失败、4 未撤权正控通过，exit 1 | 同目录 `admission-git-failure.log`；协调者独立重跑确认相同结果 |
| `node scripts/review-mutate.mjs .superpowers/review-531/mutations.json` | M1–M8 全部 KILLED，exit 0 | 同目录 `mutations.log`、`before-sha256.json` |
| `git diff --check f5ae377d98c43ed216f680cb72e5f35d73a2b8e1...HEAD` | exit 0，无输出 | 当前 immutable pair |
| `node scripts/rule-checks.mjs size f5ae377d98c43ed216f680cb72e5f35d73a2b8e1`；`node scripts/rule-checks.mjs disclosure f5ae377d98c43ed216f680cb72e5f35d73a2b8e1` | 代码 355/1000、文档 152/1500；机械扫描 exit 0 | 不含本次未提交评审记录；未以机械扫描代替人工发布面判断 |

## Validation and Acceptance
| 等级 | 代码/反例 | 产品闭环 | 架构边界 | 测试与 issue 验收 | 结论 |
|---|---|---|---|---|---|
| P0 | 无新增数据毁损、秘密或主流程崩溃发现 | 正常主备启动有证据 | 未增加事实源或跨层依赖 | 当前必需门禁确已成功 | 无发现 |
| P1 | Git 确定失败的正常出口新增回显未复核准入 | 已撤权工作项仍返回 run ID/manual 来源 | 身份可见性边界在正常失败出口失守 | 既有矩阵只覆盖异常出口；新增 4 反例证明缺口 | **F1，阻塞** |
| P2 | 其余 owner、lost ack、journal/receipt、unknown/replay 未见新增缺陷 | 不把 context Failed 当作 run Failed | Provider ack、唯一 run、谱系与 Planning 正交保持 | #215 的 cancel/clock 仍独立开放，无重复提报 | 无新增发现 |
| P3 | 引用挑选与局部 snapshot 范围适当 | 未加入 UI 补写权威 | 未增加 schema/migration、通用 clone/ledger/retry | 文档历史 SHA 明确为历史，不冒充当前接受 | 无新增发现 |

**F1 · [P1] 返回恢复供应失败结果前复核当前准入**

- 新增行：`packages/core/src/start-work.ts:453`。先正常启动并持久化主/人工备用 run；工作树确定缺失使 context Failed；新 key 恢复供应，`createWorktree` 确定返回 unavailable。其 settle 写 failed receipt 时，并行的正常 Planning bootstrap 已收到 `permission_denied`，`RuntimeAccess.denied=true` 且 epoch 已前进；事务无磁盘故障正常提交。
- 实际：新 `!git.ok` 分支直接把 `priorRun.providerRef.externalId`/`fallbackOf(priorRun)` 返回。Fake/SQLite × primary/manual 四个撤权例均泄露原 run 身份；四个无撤权正控保留相同身份。实际 Provider startRun 仍恰好一次，持久 run 未改写，故失败不是重复执行或 fixture 初始化错误。
- 可达性：`packages/core/src/context.ts:200/205` 分别把普通 bootstrap/Start Work command 直接映射到复现函数；`packages/controller/src/commands.ts:115` 调用同一 Core command 并原样映射身份，其调用前预检不能覆盖这次并发撤权。
- 引入证明：base 同文件第 443 行 `!git.ok` 仅返回 `outcomeOf({ ...git, branchExternalId: saved.branchExternalId })`，没有 run/fallback；本 PR 第 453 行新增该回显。第 101–107 行只保护 LocalWriteFailed 异常出口，正常失败不经过它。此处不是把既有 branch 等字段问题升级为本 PR 新缺陷。
- 影响/规则：撤权后的返回面违反本计划的当前准入/epoch 边界；有权观察历史 run 不能替代返回时仍有权披露。#458 的一致性修复不能削弱权限保证；#284/#215 的 Post-Core 父范围也没有豁免该新缺陷。
- 修复方向：在这条新增身份返回边界复核当前 Planning 可见性与 admission epoch，失效或无法确认时不回显 runExternalId/fallback；保留本次 Git 失败事实、原 receipt 与 durable run，不启动第二 run、不补读后继、不用通用 Query 重建结果。保留四个未撤权正控，并补这条无磁盘异常路径的判别测试。

| #458 验收 | 审查结果 |
|---|---|
| existing/resume/manual/worktree failure 与持久身份一致，stale caller 不成第二权威 | 合法准入路径与 unknown/failure 来源已修；F1 说明恢复失败的当前权限边界仍不成立，不能勾选整体接受 |
| 单写者四字段规范化，Fake/SQLite false/undefined/missing URL/extra keys 与别名隔离 | 共享合同、raw SQLite 列、Core 写前检查与 M6–M8 均有判别证据 |
| primary=true、human fallback=false | 真实持久 binding 直接断言通过 |
| command/restart 区分 manual 与 active，拒绝 mismatched replay，复用 #193/#421 | SQLite 关开、Fake 重建、实际调用计数、owner/request/唯一性回归通过；未加另一套恢复机制 |

变异整表在最终产品树运行一次，全部设置 `killedBy`；基线/还原后均绿，三份被变异源码前后 SHA256 相同：

| 变异 | 移除/破坏的保证 | killedBy（用例名片段） | 结果 |
|---|---|---|---|
| M1 | 已有 unknown run 丢 manual 来源 | `resumed unknown run keeps durable origin and identity` | KILLED |
| M2 | Git 失败丢已持久 run 身份 | `resumed Git git-failed retains the owned durable run` | KILLED |
| M3 | Git 本地结算故障丢 owned 快照 | `resumed Git step-journal retains the owned durable run` | KILLED |
| M4 | LocalWriteFailed 撤权后不脱敏 | `admission revoke=true disk=true controls run identity` | KILLED |
| M5 | 旧 fallback intent 覆盖 primary run | `stale fallback intent cannot relabel durable primary run` | KILLED |
| M6 | Core 单写者保存 ref 额外键 | `run writer stores only declared provider reference fields and binding roles` | KILLED |
| M7 | Fake get 返回持久引用别名 | `put/get 均隔离顶层与嵌套引用` | KILLED |
| M8 | SQLite 原始列保存 ref 额外键 | `run writer discards undeclared reference keys before persistence` | KILLED |

## Progress
- [x] 2026-11-04：初始 refs、账号、worktree、线程与风险矩阵已建立。
- [x] 独立全矩阵审查、现有 issue 承接核对、537 项相关测试、typecheck/boundaries 与 8 项变异。
- [x] 8 例真实 Planning 撤权交叉复现，F1 经协调者在另一检出独立重跑确认。
- [x] 严重度分流及同一 head/base 最终回读。
- [ ] 协调者一次发布 review，原实现 owner 修复 F1，修复后的独立复评与完整交付收尾。

## Surprises & Discoveries
同一 head 的 Rule checks `41620902619` 与 Issue policy `41620902739` 为 canceled；对应后继 `41620903560`、`41620903166` 为 success，未把 canceled 当产品失败。CI `41620902906`（Verify/Browser/PR Fast Gate）与 Merge Gate `41620902658`、CodeQL 和 Engineering state 均成功，不能否证 F1。

实现已有 24 个撤权/磁盘交叉与 4 个准入不可确认测试，但正常 Git 失败未经过 LocalWriteFailed；“异常出口有栅栏”不能推广为“所有新身份返回有栅栏”。额外存储读异常在新增 LocalWriteFailed 的复核 try/catch 中正确转脱敏 Unknown，没有发现该处新增裸异常越过 typed result；未把未改动的 AdmissionInvalid 存储读取旧行为另报为本 PR 缺陷。

## Decision Log
2026-11-04 / 用户：明确授权 PR #529–531 在无阻塞问题或仅 P2/P3 时由本会话修复、独立复评、归档、按交付边界整合并使用 rebase merge。有 P0/P1 且已有实现会话时交其修复。

2026-11-04 / 评审：F1 为 P1，结论 REQUEST_CHANGES；已有实现 owner，停止合并收尾并交其修复。评审不改 scope、Status 或原 run。未发现其他新增 P0/P1/P2/P3，不因首个 P1 提前停止全矩阵。

## Idempotence and Recovery
远端 review 由协调者以本记录 head 作为 commit_id 统一发布；发布前再重锁，漂移则本结论只保留为旧快照。临时变异已按原字节还原，`git status` 只有本评审文档未跟踪；不删除 run/context/worktree。产品回滚仍是整个原子 PR 的 revert。F1 修复后需重跑本次八例、相关原矩阵与有归因变异，重新锁定新 head/checks/threads；旧绿色 CI/批准不能复用。

## Interfaces and Dependencies
评审读取使用 `gh-review`（Singularity-AI-Bot）；发布 review 由协调者完成。开发、作者回复和合并仍由 owner 使用 `gh`/git（SingularityKChen）。Git 通过 argv 调用。`docs/exec-plan/completed/2026-11-03-run-result-consistency.md` 为实现计划；#193/#421 已 Closed，#215/#284 仍 Open，#458 四项接受仍未勾选。#215 只承接剩余 cancel 幂等/ack/clock；本次 F1 属于当前 #458 返回身份改动，不能转入父 issue 后放行。

## Outcomes & Retrospective
首轮结论：1 × P1（F1），请求修改；其余代码、产品、架构、测试和工作项层无新增发现。修复本身仍是同一身份/权限闭环，不需要扩大为权限框架或替代恢复系统。局部 537 项测试、9 项边界、8 项有归因变异与当前 hosted 门禁分别成立，但不能覆盖本次四个撤权反例；未代签安装 Host、人类 UAT、规划接受或 R1。

## Bottom Change Note
2026-11-04：保留审查前风险矩阵与授权；补全当前 immutable pair 的全层结论、命令/变异整表、正常 Git 失败撤权 F1、base 引入对照及 owner 修复边界。仅写正式评审文档与忽略目录证据，未发布 GitHub review。

## 原实现会话的 F1 修复证据（2026-11-04）

本节由作者实现会话追加，保留上文初审原文与历史结论；上文“未发布 review”描述的时点已由正式 review `5761960471` / inline `4462540004` 的 REQUEST_CHANGES 更新。以下内部独立 PASS 不替代正式协调会话对新 head 的复审，原线程保持 unresolved。

执行上下文为 `fix/run-result-consistency` 的 `.worktrees/run-result-consistency` 根目录；初审原 head/base 均在 Context 中，新增修复验证绑定未提交修复的源码 SHA256 `314f26b380fd06a4d1f6491ad2f94ff61000700bc6b0b425dab27dd32780b653` 与正式测试 SHA256 `8532cb4c617a23858aef01ae1cbc56afd6ef0a7686a46d4f118361cbb13a6bf0`。最终发布 head/base 不在文档中自引用，以 `gh pr view 531 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,reviewDecision,statusCheckRollup` 回读。

根因修正：抽取既有异常出口的当前准入过滤为私有 `admittedRunResult`，正常 Git 失败与 LocalWriteFailed 共用。它复核 `startTargetError`，await 后同步复核 runtime epoch；不可见、失效或读取抛错只移除 run ID/manual 来源，原 `failed`/`unknown`、error、receipt、context/durable run 保持原样。没有 Query 重建、后继 run 补读、再次 start、新账本或 cancel/clock 扩展。

| 修复验证 | 实际证据 |
|---|---|
| 评审原八例（命令保持上文） | 修复前 4 fail / 4 pass，修复后原断言 8/8；`original-red.log` / `original-green.log` |
| 正式新增矩阵 | `node --test --test-name-pattern='git-failure.*admission|git-failure.*unconfirmable' tests/integration/start-work-execution-recovery.test.js`：8 有效 red / 12 正控转 20/20；正常 Git failure、撤权、磁盘故障、不可读取均核对结果/receipt/durable run/实际 start 次数 |
| 扩展后三文件与原六文件（上文命令） | 453/453 + 104/104；类型与 boundaries 9/9 通过 |
| 完整本地验证 | `PATH="$PWD/.superpowers/iteration9/bin:$PATH" pnpm verify` exit 0，3575 主测试 + 7 MVP0；临时 launcher 只恢复原工具入口，不改测试或产品 |
| 原八变异与四项 F1 负控 | `node scripts/review-mutate.mjs .superpowers/review-531/mutations-fix.json`：12/12 KILLED；覆盖绕过正常返回过滤、错误改写 failed、读取错误继续暴露、无条件隐藏合法身份；源码自动逐字还原 |
| 内部独立复评 | 原 8/8、独立返回边界 32/32、正式准入矩阵 48/48、owner 等 104/104；无新增 P0–P3。独立隔离副本移除 await 后同步 epoch 检查，8 个对应反例失败，1/1 KILLED 且副本逐字恢复 |

运行态证据统一在 `.superpowers/review-531/`，独立报告在其 `independent/REPORT.md`。源码和测试摘要在验证/变异/独立复评前后一致；以上不是旧 green CI 的复用，也不冒称正式 reviewer 已批准。ExecPlan 重新打开的 Batch 5 已完成实现/TDD/内部复评，重新归档到 `docs/exec-plan/completed/2026-11-03-run-result-consistency.md`；发布前后仍要按当前 head 扫描/回读 checks。账号为作者 SingularityKChen；作者回复原 inline 后，是否 resolve/approve 由正式协调会话实际复审决定，不在此自签。

作者追加日期：2026-11-04 09:51 SGT。本轮仅修改 #531；未修改 #529/#530，未合并，未写 Planning Status 或阻塞关系。

2026-11-04 / 协调会话的独立复评：以原owner发布 `1ebbe44d48f4d812a3a58be612c3cc605237ea0a` 为基准，独立子评审重跑原8例与正式定向88例，全部通过；核实12项变异规格/归因，起止439个产品/测试文件摘要相同。`start-work.ts` SHA256=`314f26b380fd06a4d1f6491ad2f94ff61000700bc6b0b425dab27dd32780b653`，正式恢复回归 SHA256=`8532cb4c617a23858aef01ae1cbc56afd6ef0a7686a46d4f118361cbb13a6bf0`。正常Git失败和LocalWriteFailed共享当前准入复核；只隐藏无权确认的run/fallback，保留failed/Unknown、原错误/收据、持久run及单次启动。无新增P0–P3，建议APPROVE。

最终三能力组合：在 `.worktrees/pr529-pr531-review-integration` 的 `test/pr529-pr531-review-integration @ adfb80c88af3f2b90df62467357b124fc68ebb6c` 执行 `CI=true pnpm verify` 与 `node scripts/run-test-layer.mjs tests/browser "最终三能力修复的生产组合读取与恢复"`，3582主测试+8 MVP0+42 Browser通过，fail/cancel/skip均0；日志位于该检出的 `.superpowers/pr529-531-review/`。源输入为#529 fbf83263、#530 97d1a73c、#531 1ebbe44d。main移动/提交整理后必须证明packages/apps/tests/scripts/package/lock树与该已测组合相同，再重锁当前head的托管检查、批准、issue与线程；旧head的绿色与批准不替代新门禁。
