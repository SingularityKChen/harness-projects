# PR #675 MMP Review

## 当前 head 锁定与范围

- 日期：2026-11-24。PR #675，`test/diagnostics-evidence-20261124` → `main`；head `990aeed85eb8f061dae17fa2027e2e878119ab4c`，base `c24d149151964c2fe8ef0d120a9facab3c65b356`。
- 首次回读：OPEN、非 draft、MERGEABLE、`mergeStateStatus=UNSTABLE`，`closingIssuesReferences` 含 #336。后续 `Singularity-AI-Bot` 在 commit `990aeed…` 提交 APPROVED review #6036635356，含一条整体 P3 标题建议；inline comments 仍为空。
- 5 个提交；5 files，+381/−0：`docs/README.md` +1、ExecPlan +240、`docs/review/README.md` +1、本记录 +80、`tests/integration/planning-refresh-scheduler.test.js` +59。生产代码无 diff。
- 关联 issue #336 为 OPEN，明确列出 scheduler 层异常/thenable/生命周期后的在途拒绝属于待补持续证据，而非已发现生产缺陷。#571 已提供生产 absorber；#335/TD-030 的真实 Host sink 接线在本 PR 外。
- checks 回读：Analyze (actions)、Analyze (javascript-typescript)、Browser（生产组合读取与恢复）、CodeQL、Issue policy、PR Fast Gate、PR size、Resolve PR base、Verify（typecheck + 契约测试）、Windows Native 均有成功结果。`Create review session` job 138325323010 返回 HTTP 404，属于本机可选 review endpoint 未运行。早先 `gh pr checks` 将 `Reconcile engineering state` 显示为 fail；之后按 SHA 回读发现 run 45358331922 与 45359931018 实际为 CANCELLED，并有同 head 成功后继 45358560782 与 45359408254。该早期 fail 读数由 run 级结论及当前 rollup supersede，不再作为未解决检查；分支保护唯一必需的 `PR Fast Gate` 为 SUCCESS。
- 当前工作树 `.worktrees/iteration12-diagnostics-evidence` 初始干净；本次仅改本 review 文件，未提交、未推送、未写 GitHub。

## 首轮风险矩阵（逐文件审查前）

| 级别 | 代码 | 产品闭环 | 架构 / 事实所有权 | 测试证据 | Issue / 范围 | 初始风险 |
|---|---|---|---|---|---|---|
| P0 | 合并是否破坏 main 或泄漏进程级拒绝 | 是否把证据收口冒充生产修复 | 是否改变 Host 权威状态/API/依赖边 | 监听器和 timer 是否泄漏 | 是否有不可回滚外部写入 | 检查生产 diff、清理和回滚 |
| P1 | 非 Error、跨 realm thenable、then body throw、stop/dispose late rejection | 是否实际覆盖 #336 而不越界到 #571 | 同步结果和诊断出口所有权是否不变 | 新例是否区分目标回归 | closing issue 是否准确 | 主正确性风险；对照 issue 并做最小验证 |
| P2 | 失败/重复生命周期分支遗漏 | 计划和 PR 描述是否准确 | 重复事实或不必要耦合 | mutation 归因与恢复是否可信 | 归档、索引、体量、标签 | 报告有具体影响的问题 |
| P3 | 命名和可读性 | 接受边界是否易误解 | 是否过度设计 | 辅助代码是否有维护成本 | 标题、索引、提交文字精度 | 非阻塞建议 |

## 当前 head 评审结果

**P0：无发现。** Diff 中没有生产代码、schema、权限、发布门禁或外部状态写入。两条新用例在 `collectUnhandled` 的 `try/finally` 中注册/移除 listener；所用 timer 是 fake timer。

**P1：无发现。** `planning-refresh-scheduler.test.js:348-377` 让非 Error 字符串和对象分别走跨 realm rejected Promise 与 `then()` 同步抛错 sink；逐 tick 断言调用次数、错误对象身份、后续 tick 成功及无 `unhandledRejection`。`:379-404` 分别对 stop 与 dispose 延迟拒绝，断言各上报一次、错误身份不变、重复 dispose 不重复上报、无未处理拒绝。生产 `planning-reconcile.ts:65-68` 保留已挂接的拒绝 handler；stop/dispose 清 timer，不取消在途轮次。契约与 issue #336 一致。

**P2：无发现。** 归档 ExecPlan、两份索引和提交规模与 5-file diff 一致；测试不引入 helper 或生产改动。旧验收记录提到的判别力边界仍诚实：then-body 行本身不杀 `instanceof Promise` 窄化，跨 realm 行承担该变异；dispose 守卫由 dispose 分支覆盖；重复 dispose 子断言没有独立合理变异。它们不构成行为缺陷。

**P3：一条 PR-level 建议，无 inline finding。** 首次标题 `refactor(core): share the diagnostics sink absorber with the planning reconciler` 容易让读者以为本 PR 改了 Core 实现；实际 PR body 与 diff 是 test-only 证据收口，生产实现已由 #571 合入。人类伙伴已在本会话明确授权 root 将标题改为 `test(core): cover planning reconciler diagnostics failures`；root 负责执行并回读，标题更新前 P3 仍待处置。

可直接用于整体 review 的措辞：`[suggestion] The title still describes sharing/refactoring the Core diagnostics absorber, but this PR's body and diff are test-only evidence for the already-merged #571 implementation. Please retitle it to describe the scheduler diagnostic regression coverage so the PR list reflects the delivered change.` 该建议无 diff 行级锚点，不阻塞合并。

## 验证与接收限制

- 在锁定 worktree 执行 `pnpm test:file tests/integration/planning-refresh-scheduler.test.js tests/integration/sync-revision-freshness.test.js`：`tests 77 / pass 77 / fail 0 / cancelled 0 / skipped 0`，exit 0。两条新增测试均通过。
- `node scripts/rule-checks.mjs size main`：代码 59/1000，文档 322/1500；exit 0。首次 `git diff --check main...HEAD` 无输出。
- `Create review session` job 的可选本机 endpoint 返回 HTTP 404。初次呈现为失败的 `Reconcile engineering state` 两个 run 后续经 run API 确认均为 CANCELLED，并有同 head 成功后继；更早的失败展示已 superseded。`PR Fast Gate` 通过。
- 先前验收轮（实现 head `0eb15a5b`，当时远端仍为 `b4d7542a` draft）报告 V2 连跑 10 次稳定、计划 M1–M6 与额外 X1–X6 全 KILLED、等价重构 R1–R3 SURVIVED；这些旧轮数据不是当前 head 的 GitHub checks。本轮在当前锁定 head 独立复跑同一 mutation spec：M1–M6 全 KILLED，exit 0；M1 命中非 Error 用例、M2/M3 命中生命周期用例，M4–M6 命中预期用例和既有相关用例；`git diff -- packages/core` 为空。
- 本 PR 不证明实际 Host sink 接线、安装件行为、R1 发布接受或 UAT；这些继续由 #335/TD-030 及人类接受门负责。PR 的 `Closes #336` 表示证据缺口关闭，不写规划 `Status`。

## ExecPlan

### Purpose / Big Picture

以当前 immutable head 判断 #675 是否补齐 #336 的 scheduler 诊断证据，并提供可复核的交付评审。

### Context and Orientation

锁定值、变更文件、相关 issue 和门禁见「当前 head 锁定与范围」。代码语义见「当前 head 评审结果」。

### Design / Spec

测试需证明失败值原样上报、sink 非常规拒绝被吸收、后续 tick 继续、stop/dispose 后在途拒绝仍被报告。它是对已合入生产路径的测试交付，不引入生产改动。

### Global Constraints

本评审仅修改本文件；不提交、不推送、不写 GitHub review。head/base 变化使结论失效。测试通过不替代产品/R1/UAT 接受。

### Plan of Work

#### Batch 1 · 独立评审

**最小闭环**：锁定快照、完成矩阵、复现关键测试证据并记录 findings。
**涉及文件**：`docs/review/pr-675-mmp-review.md`。
检查 diff、issue、计划与实际调用；运行最窄集成测试及可用 mutation spec；最后复读 PR 快照。
**验证**：目标两文件 `pnpm test:file` 77/77；`git diff --check` 无输出。
**回滚**：恢复 HEAD 中原评审记录；远端无副作用。

### Validation and Acceptance

矩阵、分层结论、可定位 findings、线上 checks 限制、R1/UAT 边界和恢复方法均记录；最终 PR head/base 与本节锁定值一致。

### Progress

- [x] 2026-11-24：锁定 PR、base、head、closing issue、提交、review/comments 与首次 checks。
- [x] 2026-11-24：完成代码、产品、架构、测试、工作项与历史 evidence 评审；目标测试 77/77。
- [x] 2026-11-24：当前 head mutation spec M1–M6 全 KILLED，exit 0，生产文件还原；最终 PR 元数据仍是锁定 head/base。Reconcile run-level cancellation 与成功后继已回读。
- [x] 2026-11-24：review #6036635356 已 APPROVED，整体 P3 标题建议待按人类授权更新标题。

### Surprises & Discoveries

- `Create review session` 实际返回 404，已确认是可选 endpoint 未运行。初次误显示为 fail 的 reconciliation checks 实际是并发取消，并有同 head 成功后继，详见锁定快照。
- 原 review 文件记录旧本地实现 head 和旧远端 draft head；本次新增当前 head 结论并显式区分两组证据。

### Decision Log

- 2026-11-24：将 title/diff 不一致定为一条非阻塞 PR-level P3 建议，不制造无行号的 inline 评论。
- 2026-11-24：不将旧 #676 review 提到的过时 Project V8/V9 状态误抄为 #675 finding；本 PR 未写 Project 状态。
- 2026-11-24：GitHub review submission 由 root 在全批评审后统一处理。
- 2026-11-24：人类伙伴明确授权 root 把 PR 标题改为 `test(core): cover planning reconciler diagnostics failures`；此动作仍由 root 执行，不在本 agent 写 GitHub。

### Idempotence and Recovery

本地测试、只读 GitHub 查询和 mutation spec 可重复。head/base 更新后须重读 metadata、diff、checks、reviews 和 comments。所有 mutation 必须由既有 harness 按字节还原；评审文件可恢复为 HEAD 版本。

### Interfaces and Dependencies

GitHub 只读接口 `gh pr view/diff/checks`、`gh api`；仓库脚本 `pnpm test:file`、`node scripts/review-mutate.mjs`。相关项 #336、#571、#335、TD-030。

### Outcomes & Retrospective

当前结论：无 P0/P1/P2 代码问题；一条 P3 PR 标题建议已获明确处置授权，等待 root 更新标题。目标测试 77/77；计划 mutation spec M1–M6 全 KILLED，exit 0。Create review session 404 为可选检查；Reconcile 取消 runs 已有同 head 成功后继。

### Bottom Change Note

- 2026-11-24：先锁定快照并写 P0–P3 矩阵，再开始逐文件审查。
- 2026-11-24：补录当前 head 的本地验证与 findings；保留旧轮报告内容作为历史证据。
- 2026-11-24：当前 head 两文件测试 77/77，计划 mutation spec 6/6 KILLED；早期 Reconcile fail 展示由两个 CANCELLED run 与两个同 head SUCCESS 后继 supersede。
- 2026-11-24：最终复读 PR head/base 未变化；review #6036635356 APPROVED，并包含一条整体 P3 标题建议；记录人类授权的标题处置。

## 历史独立对抗验收记录（原记录，保留）

验收日期：2026-11-24。目标：定时刷新诊断吸收在 tick 调用点的剩余证据边界由持续回归钉住——非 `Error` 失败值按原对象恰好上报一次、sink 的跨 realm 拒绝与 `then` 方法体抛错被吸收且下一 tick 正常、`stop()`/`dispose()` 之后到达的在途拒绝各恰好上报一次、重复 `dispose()` 不重复；生产实现由 #571 合入，本 PR 为 test-only。关联 #336。

锁定事实：被验收 head `0eb15a5bc4021fc4a5d006e8edd6ccff650ada76`（`git rev-parse HEAD` 实测，本地未 push），diff base `main@c24d149151964c2fe8ef0d120a9facab3c65b356`（`git merge-base main HEAD`）；远端 PR head 仍为 `b4d7542a`（仅 Batch 1 文档），`isDraft=true`、`closingIssuesReferences` 含 336。执行上下文：`.worktrees/iteration12-diagnostics-evidence`，分支 `test/diagnostics-evidence-20261124`。

方法：独立 agent 对抗验收（非实现者、非 PR 作者）。除本记录外未写仓库文件；V3/额外变异由 `scripts/review-mutate.mjs` 施加并按字节还原；未 push、未写 GitHub。本结论是工程对抗验收，**不等于人类评审、R1 发布接受或 UAT**；`Status`、ready 与合并由 lead/人类伙伴决定。

### 范围与规模

- 文件：3 files +290/−0——`docs/README.md` +1、`docs/exec-plan/completed/2026-11-24-scheduler-diagnostics-evidence.md` +230、`tests/integration/planning-refresh-scheduler.test.js` +59；`packages/core` diff 为空，既有断言未改/未删。
- 规模：`rule-checks size main` 代码 59/1000、文档 322/1500（验收处置轮后回读）；`disclosure` 通过；`git diff --check` 无输出。
- 基线：改动前两文件 75（调度器 12 + freshness 63）→ head 77；V2 77/77 连续 10 次稳定；全集成层 2378/2350/28 skip。
- 变异：计划内 M1–M6 全 `KILLED`（前后基线绿、`packages/core` 逐字节还原）；计划外反例 X1–X6 全 `KILLED`；语义等价重构 R1–R3 全 `SURVIVED`；加用例前必要性对照复现 M1–M3 `SURVIVED` / M4–M6 `KILLED_OTHER`。

### 历史风险矩阵

| 级别 | 代码/反例 | 产品与工作项 | 测试与证据 | 结果 |
|---|---|---|---|---|
| P0 | 越界改生产代码、既有断言弱化/删除、进程级监听泄漏 | 证据缺口冒充生产修复 | — | 无；`packages/core` 空 diff、既有 12 条用例未改、监听在 `finally` 摘除 |
| P1 | 新增断言无判别力、计时不稳定、假绿/假红 | #336 五项证据缺口未被真实覆盖 | 变异锚点与归因 | 无；6 计划内 + 6 计划外变异全 KILLED，3 语义等价重构存活 |
| P2 | — | — | — | 无 |
| P3 | — | PR body 滞后、trailer 措辞、行号偏移、V1 路径 | — | 4 项，均非阻塞（见下） |

### 历史逐条处置

#### P3-1 · PR #675 描述仍是 Batch 1 版本（lead 待办）

- 事实：body 引用 `exec-plan/active/...`（本地已归档到 `completed/`）；写「实现后将回填：V2 期望 77/77」；回滚写「单提交 revert 即回到 75 用例基线」（最终分支 3 提交）；远端 12 项 checks 全 pass 但只运行在 `b4d7542a`（docs-only）。
- 处置：记录在案，由 lead 在 push 后、`gh pr ready` 前回填路径/实测证据/回滚表述，并按新 head 重算 checks。本轮不执行 gh 写操作。

#### P3-2 · 提交 trailer `Refs #336` 与计划 `Closes #336` 措辞不一致（已修计划）

- 事实：`9496f7aa`、`0eb15a5b`（及已推送 `b4d7542a`）正文末行为 `Refs #336`。
- 处置：按 AGENTS.md §6（允许 `Closes` 或 `Refs`）与 §8（PR 描述含关闭关系），本计划 Global Constraints 改为提交用 `Refs #336`、`Closes #336` 由 PR body 承担（body 已含，`closingIssuesReferences` 回读含 336）；不改写已提交历史。ExecPlan D8。

#### P3-3 · 计划 scheduler 行号基于 main，head 上因新增 `import vm` 整体 +1（已修）

- 处置：计划改按归档 head 回读：既有 12 条 `:234-269`、`:271-294`、`:296-316`、`:318-346`，新用例 `:348-377`、`:379-404`，并注明 `main@c24d1491` 上各早 1 行。处置后以 `grep -n "^test("` 核对。ExecPlan D10。

#### P3-4 · V1 命令在归档 head 上不能原样执行（已修）

- 处置：V1 的 `test -f` 改为 `docs/exec-plan/completed/...`，在处置后树原样执行 exit 0（`grep -c` 输出 1）；Batch 1/2 使用 active 路径的历史说明保留。ExecPlan D10。

#### P3-5 · 固定两轮 `setImmediate` 排空 + 进程级 unhandled 监听导致故障归因串扰（仅观察，不修）

- 事实：额外变异 X6 下，新用例 2 的失败原因可能是前一条既有用例漏出的 `Error: sink threw`（进程级 `collectUnhandled` 窗口），而不是用例 2 自身断言；正常基线与语义等价重构全绿，属失败可读性噪声，不是假红/假绿。
- 不修理由：可选 `waitFor` 改写会改变已验证的变异归因与断言时序，成本高于收益；当前断言对真实回归仍会红。记入残余风险。

#### 仅观察（不构成缺陷，均不修）

1. 新用例与既有用例判别力重叠：M4 由 freshness 跨 realm 子用例、M5/M6 由既有 scheduler sink 用例与 freshness 钩子用例先杀死；计划 Surprises 9–11 已如实披露。
2. 用例 1 第 2 行（`then` 方法体抛错）对窄化变异无唯一判别力；issue 明确列项且成本近零，保留。
3. 用例 2 的「重复 `dispose()` 不重复上报」子断言没有单独合理的变异只打穿它（X1 双报会经 `reported.length === 1` 杀死）；低价值但无害。
4. 设计期 prototype 读数不可从仓库复现（仓库外逐字节副本），但必要性对照已在仓库内独立复现，未发现证据造假。
5. 远端 12 项 checks 全 pass 仅覆盖 `b4d7542a`；push 后必须重算，不能继承。

### 历史处置后的最终验证

命令在 `.worktrees/iteration12-diagnostics-evidence` 根执行；实现验收对象为 `0eb15a5b`，本记录随验收处置提交入库（该提交 head 由 `git log -1 --format=%H` 回读，不在文档内自引用）。

| 命令 | 结果 |
|---|---|
| V1：`git diff --check main...HEAD && test -f docs/exec-plan/completed/2026-11-24-scheduler-diagnostics-evidence.md && grep -c '\[2026-11-24-scheduler-diagnostics-evidence\](' docs/README.md` | exit 0；`grep -c` 输出 `1` |
| V2：`pnpm test:file tests/integration/planning-refresh-scheduler.test.js tests/integration/sync-revision-freshness.test.js` | `tests 77 / pass 77 / fail 0 / cancelled 0 / skipped 0`，exit 0 |
| V3：`node scripts/review-mutate.mjs .superpowers/iteration12/336/mutations.json --root .` | M1–M6 全 `KILLED`；前后基线绿；`git diff -- packages/core` 为空（逐字节还原） |
| V4：`node scripts/rule-checks.mjs size main && node scripts/rule-checks.mjs disclosure main && git diff --check main...HEAD` | exit 0；代码 59/1000、文档 322/1500；disclosure 通过；无空白/冲突标记 |
| `git status --short` | 提交后干净（未 push） |

### 历史残余风险 / 未验证项

- 远端 checks 只在 `b4d7542a`；实现 head 的 `PR Fast Gate` 等须在 push 后按新 head 回读。
- 真实 Host sink 接线、外部 sink、安装件与 UAT 不在本闭环（#335/TD-030）；本 PR 只证明 Core/scheduler 可观察行为与变异归因。
- 未审计 GitHub Project 字段等外部状态是否有越权写入；从 issue/PR 元数据未观察到。
- 固定 `turn()` 排空造成的失败归因串扰与判别力重叠是已知证据边界，不冒充缺陷、不新增断言。
- 验收对象是本地未 push head；本记录不等于人类评审、R1 或 UAT。

### 历史记录来源与归档

本记录由验收处置轮随 PR 新增，来源是独立验收报告（运行态 `.superpowers/iteration12/336/verification-1.md`，git 忽略）与验收期快照；`docs/review/README.md` §8 索引同步一行，ExecPlan D9 记录文件集合扩展。工作项 #336 保持 OPEN，关闭关系由 PR body 的 `Closes #336` 承载。


2026-11-24 独立文档/标题处置复评：PASS，无新增 P0–P3。对照初始 `990aeed85eb8f061dae17fa2027e2e878119ab4c`，未提交 diff 仅限本评审与既有 Completed ExecPlan，生产/测试零变化；两文档均保留 PLANS 全部 13 个章节，旧本地/远端 draft 证据被明确标为历史，未覆盖原验收事实。当前叙述把 Reconcile 的 `45358331922`/`45359931018` 正确写为 CANCELLED，并列同 head SUCCESS `45358560782`/`45359408254`，不把取消当作未解决失败；唯一可选 review endpoint 404 与必需 Fast Gate 分开。#336 仅关闭 scheduler 证据缺口，#571 已交付实现，#335/TD-030、实际 Host sink、安装态和 R1/UAT 保留；未声称测试通过替代产品接受。标题方向 `test(core): cover planning reconciler diagnostics failures` 与 test-only diff 一致，但外部标题更新及回读仍待 root 完成，当前记录未预先宣称 P3 已关闭。本复评不重复已验证的 77 用例或 M1–M6；`git diff --check` 通过，未 commit/push/写 GitHub。


2026-11-24 root 执行回读：PR 标题已改为 `test(core): cover planning reconciler diagnostics failures`，与测试交付范围一致；上文“待 root 执行”的记录现已失效，P3 关闭。接合 #674 真实 main 时仅合并双方 Completed/Review 索引条目，原索引全部保留；自身生产/测试 blob 与首审头不变，77/77、零 skip 再次通过。
