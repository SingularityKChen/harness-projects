# Start Work 耐久外部意图 ExecPlan

> 状态：Active，设计已收敛，尚未实现。
> 创建：2026-10-30；时区：Asia/Singapore（+08）。
> 范围：#204，一个独立验收、合并和回滚的 PR；遵循根 `AGENTS.md` 与 `PLANS.md`。

## Purpose / Big Picture

Start Work 在创建分支、工作树、主执行或人工执行之前，先耐久记录该次实际请求、实际连接和当前 owner。调用结果未知时，重复同一 key、换新 key、租约过期或重启都不能获得盲目再次创建的许可。Git 已完成而执行尚在途时，请求收据不得先报 Saved；旧 owner 不得结算后继事实。

最小成功证据是 Fake/SQLite 四个 Provider 写入口均能读到已提交的精确 Pending 意图，以及丢 ack、写前失败、ack 后本地失败、重启与旧 owner 迟到的判别测试。该能力提供持久证据与保守拒绝，不等于 #193 自动恢复、#421 外部执行唯一性或 R1 发布验收。

## Context and Orientation

执行检出是 `.worktrees/durable-write-intent`，分支 `fix/durable-write-intent`。2026-10-30 10:05 +08 观察到该检出的 HEAD 为 `7907efbbdc5e35cc8ea4769c7067e885cec844e1`；主检出与远端已前进，最终交付必须重新核对 base。以下源码调查以该任务 HEAD 为准，开工先运行 `git rev-parse HEAD`、`git status --short --branch`，记录新的执行上下文。

`packages/core/src/start-work.ts` 的 `claimContext` 已把 Pending、不可变 `requestFingerprint`、父实体和 context 在同一事务登记。`replayRequest` 对同 key 只观察，过期也不接管。#420 已有持久 `provisioningGeneration` 与 `owned` 短事务；它们是本地结算的唯一 owner 权威，不应重复实现另一套令牌。

`packages/core/src/git-provisioning.ts` 在 `baseRef`、工作树 preflight 后才确定真实 `fromRef` 与 canonical path。现有 fingerprint 只绑定声明请求，未保存这些派生值、当前外部步骤与执行连接。`recordStep` 仅在 Git ack 后回填；`settle` 又在 `startExecution` 之前把收据写成 Saved。

`packages/capabilities/src/storage.ts::MutationAttemptRecord` 的唯一持久家是 SQLite `mutation_attempt`，键为 `(workspace_id, idempotency_key)`；Fake 是另一实现。`storage-execution.ts` 显式列映射、`storage-rows.ts` 解码、`003_control_facts.sql` 定义形状。当前 generation 为 2，loader 已拒绝不匹配形状；项目尚未正式发布，不承担旧实验数据库/API 兼容链。

`execution-context.ts::readyGap` 已能把缺失/未知 run 的 Ready 读回压成 Unknown，不能声称当前同键回放会无条件显示 Saved。真实缺口是耐久行先 Saved，以及未知 Git 创建后换 key 可再次创建。既有若干测试把 Provider throw 等同“肯定未发生”，必须重新界定故障含义。

## Design / Spec

选择在既有收据上增加一个 typed `externalIntent` 当前槽位。它没有独立 key、表、查询端口、步骤历史或 ack 副本；context/run 继续拥有资源事实。当前步骤只在已确定结束后才能被下一步骤替换。

| 候选 | 裁决与理由 |
|---|---|
| 只保留 request Pending 与 lease/generation | 排除：不能回答真实派生输入、实际执行连接，也未关闭换键盲写。 |
| 既有 mutation_attempt 加当前步骤槽位 | 采用：复用事务、clone 与 owner，无第二账本。 |
| 每步派生 key、新操作表或通用恢复执行器 | 排除：增加状态权威与关联成本，并吞并 #193/#421。 |

### 持久形状与状态含义

`MutationAttemptRecord.externalIntent?: StartWorkExternalIntent` 只用于 `commandName === 'startWork'`。形状包含 `contextId`、正 safe integer `ownerGeneration`、实际 `bindingId`、domain `WriteState` 和 discriminated `operation`：

    createBranch       input: ProviderCreateBranchInput
    createWorktree     input: ProviderCreateWorktreeInput
    startRun           input: { workingDirectory, context, command, environment: {} }
    startFallbackRun   input: { workingDirectory, context, command, environment: {} }

Git input 包含完整 repository 引用；branch 包含实际 name/fromRef；worktree 包含实际 worktreeKey/branch/最终可选 path。run 的 context 使用实际执行连接，主/人工不可借 Development binding 冒充。引用显式重建 `url: undefined`，不保存访问 URL、任意 environment、凭据包或 Provider 返回的任意对象。

在 capabilities 内提供一个小型纯形状复制/校验函数，供两个 Storage 实现复用；只重建该白名单，检查已知 kind/state、owner、必要 primitive 和空 environment。Fake 保留现有整行 `structuredClone`；SQLite 显式 JSON 编解码并恢复可选字段形状。坏 JSON/非法形状必须拒绝，不能降成无槽位。不可再各写一套递归 clone 或通用 JSON 框架。

根 `state` 是完整 Start Work 请求收据，槽位 `state` 是当前外部调用证据，两者不是两套资源状态机。请求从 claim 到 Git 完成、run/fallback 在途都保持 Pending；最终根状态与当次返回的 WriteReport 相同。Saved 表示已确认 Git 且执行/确定降级路径已得到已知结论，沿用现有降级结果契约，不承诺 run 正在运行。#458 的结果/引用规范化问题另行验收。

槽位 Pending 只能在写前事务提交后出现；ack 或已有唯一读回确认后 Saved；确定拒绝/确定未创建时 Failed/Conflict；throw、丢响应、读回不可确定时 Unknown。ack 的 run status 不认识时，保留句柄并将该步骤和请求记 Unknown。不得用 Failed 消去外部是否已发生的不确定性。

### 准入、写前与结算

1. 首次 claim 继续消费原 key 并绑定原 fingerprint。每个供给准入在同一事务、计算新 generation 和任何拒绝结算之前，扫描 `listMutationAttempts(workspace)`：同 context 的槽位 Pending/Unknown，或带槽位的根 Unknown，均阻止再次供给。新 key 不被消费，不增代、不改变 context/路由、不调用变更型 Provider；返回已有 Pending/Unknown 与可见句柄。租约过期不是“未发生”的证据。无槽位的观察收据不阻挡合法恢复。
2. `provisionGit` 只新增窄 `beforeExternalWrite(operation)` hook，在最终 input 构造后、真实 Provider 调用前 await。hook 由 Start Work 提供，用现有 `owned` 事务核对 generation、receipt/fingerprint 与槽位可推进性，并提交 exact input、实际 binding/context/owner、slot Pending；根仍 Pending。提交失败则本步骤零 Provider 调用，不伪造未知外部调用。Provider I/O 始终在事务外。
3. 复用现有 `recordStep`：成功的分支/工作树事实与槽位 Saved 在同一个 owned 事务回填。失败 GitOutcome 由现有 `settle` 同事务结算当前 Pending 槽位与根报告；若失败发生在 preflight/baseRef、尚无本步 intent，不改先前已完成槽位。Git 成功的最终事务仍原子写 Ready 与 tracks/has_worktree，但根保持 Pending。
4. `ensureBranch` / `ensureWorktree` 仅围住真实写调用的 throw，将其转为 Unknown；保留现有只读 reconcile 的确认路径。缺失读能力不能把 ambiguous 改 Failed。成功/失败都使用同一个实际 input 快照，Provider 参数与耐久参数独立复制而逐字段相同。
5. 主/人工 startRun 复用同一个局部写前 helper。主明确拒绝并耐久记 Failed 后才可创建人工 Pending；主 ambiguous/throw 一律 Unknown，零 fallback。人工 ambiguous/throw 同样 Unknown，不能写 failed run 再报 Git Saved。无可调用 Provider 的确定人工降级不伪造外部 intent。
6. 扩展现有 `recordRun` 的 owned 结算，使 run 事实、当前槽位结果与根最终报告原子提交；确定无外部调用的终结也在 owned 事务结束根收据。不在返回之后另补一笔“最终状态”。ack 后本地失败则保留之前耐久 Pending，返回 Unknown 及当次已 ack 句柄；不继续下一步骤。
7. 同 key 仍先做原 request/target 身份拒绝。槽位 Pending/Unknown 或根 Unknown 优先于后继 Ready，不得从当前 context 借 Saved；根 Failed/Unknown 不被 Ready 提升。保留 `readyGap` 独立守卫。无槽位的观察 Pending 可继续读取当前完整结果，不永久锁死。
8. 每个写前、step、final、run 事务继续调用现有 `owned`。失去 generation 的旧调用不改自己的旧收据、不替后继结算、不进入下一步/fallback；调用尚未发出时报 Conflict，可能已发出或已有 ack 时报 Unknown，保留本次真实句柄。写前提交到 Provider 调用的外部竞争窗口仍归 #421，不能宣称 exactly-once。

不增加 `write-machine.ts` 接口、通用 before/finish lifecycle 或第二种 owner。局部 helper 直接更新原 receipt；现有 `recordStep`/`settle`/`recordRun` 拥有事务与资源事实。低层直接调用 `provisionGit` 的算法测试可保持无 hook；保证范围明确为生产 Host Start Work 唯一供给路径，不能把低层测试当耐久保证。

### 与相邻任务的所有权

#204 owner 修改 Start Work admission/provision/settle/execution/replay；#457 只改 `startTargetError` 的可见性小区与其自有权限模块。两个 owner 不同时编辑同一 worktree。若 #457 要求等待后的写前复判，通过小型接口需求交给 #204 owner 串行接入；动态权限权威不由 capability snapshot 代替。最终用独立组合检出验证两项变更。

## Global Constraints

代码、测试与 config 增删合计必须严格小于 800（最多 799），文档严格小于 1300；锁文件/生成物不作为压预算手段。以下是实施分配估计，合计 **727**，不是实际 diff 证明；到 760 即先压缩重复结构并重算，最终硬门不放宽。

| 唯一候选写集 | 增删预算 |
|---|---:|
| `packages/capabilities/src/storage.ts` | 50 |
| `packages/core/src/start-work.ts` | 175 |
| `packages/core/src/git-provisioning.ts` | 55 |
| `packages/providers/fake/src/storage.ts` | 5 |
| `packages/storage/sqlite/src/storage-execution.ts` | 16 |
| `packages/storage/sqlite/src/storage-rows.ts` | 7 |
| `packages/storage/sqlite/migrations/003_control_facts.sql` | 7 |
| `packages/storage/sqlite/src/migrate.ts` | 2 |
| `tests/integration/start-work-external-intent.test.js`（新增） | 180 |
| `tests/contract/suites/storage-execution.js` | 25 |
| `tests/integration/start-work-owner-fencing.test.js` | 50 |
| `tests/integration/start-work-request-binding.test.js` | 25 |
| `tests/integration/start-work-sqlite-registration.test.js` | 35 |
| `tests/integration/start-work-step-recording.test.js` | 40 |
| `tests/integration/start-work-retry-identity.test.js` | 8 |
| `tests/integration/local-git-start-work-resume.test.js` | 12 |
| `tests/e2e/start-work-recovery.test.js` | 10 |
| `tests/integration/storage-baseline-admission.test.js`、`tests/integration/migration-runner.test.js`、`tests/integration/execution-relation-write-schema.test.js` | 25 |

收敛靠单槽位无 ack 副本、复用已有 clone/owned/recordStep、在原 suite 增加参数化故障格；不新建 fixture 框架、引擎或通用生命周期 API。若实测仍超限，先用实际 numstat 指明成本，合并重复 setup/表驱动断言；不得删掉未知、重启、身份或 fence 的独立判据，也不得把不完整能力拆出 PR 后宣称 #204 完成。确实不足时，提交有实测差异的范围调整方案，由主控重新收敛闭环，不能写伪预算。

文档唯一写集是本 ExecPlan、`docs/README.md`、`docs/architecture/gate-e1-ruling.md` R8/§9 原处订正，以及必要的 `docs/exec-plan/tech-debt-tracker.md` 对既有 #193 恢复活性条目的补充；预计 300–450 行。不新增 ADR，因为不改变事实拥有者或层间依赖。新增写集先在本节解释并移入预算。

不新增依赖、Provider 端口或 Host ABI，不修改规划 Status/阻塞关系。直接修订 003，generation 2→3；不自动迁移、删除或重置旧库，不制作旧实验 API 兼容层。旧完整形状以 marker 2 被 generation 拒绝、伪装 0/3 也被 shape 拒绝，拒绝前后全库不变。开发验证使用新临时库，原库先备份并保留。

## Plan of Work

### Batch 0 · 锁定上下文与交付面

最小闭环是设计、范围与工作区可复现；涉及本计划和索引。主控按已授权端到端工作推进，不再请求设计批准。回读任务 HEAD/base、检查现有 draft PR；缺失时按仓库规则建立关联 #204 的 draft，产品实现前回读 head/base/draft/closing 引用。记录 #457 单 owner 协调，不并发写同一文件。

在任务检出运行 `git rev-parse --git-dir --git-common-dir`、`git status --short --branch`、`git worktree list --porcelain`、`git check-ignore -v .worktrees/`；期望无混入他人改动、工作区已被忽略。回滚仅撤销本批文档，不触碰其他 worktree。

### Batch 1 · TDD RED：在真实入口观察意图

主文件是新增 external-intent suite 与共享 storage suite。先以 Fake/SQLite 参数化四个写入口：Provider 内回读已提交行，核对 actual input、binding、context、generation、根/槽位 Pending；确保 canonical path/fromRef 与主/人工不同连接真实可见。同 key 在途重放不得增加写计数。

增加 Provider 已接受但 ack 丢失且读回不可用的矩阵；同 key、新 key、时钟前进 31 秒均零额外写，新 key 不占 receipt、不增代。SQLite 关闭重开仍保留 exact intent。另有“已提交 intent、调用前中断”反例，必须保守阻挡，不能凭测试夹具知道未调用就放行。

运行 `pnpm test:file tests/integration/start-work-external-intent.test.js tests/contract/storage-contract.test.js`；期望新行为断言 RED，现有正控可运行。记录实际失败文本与命中点；import/type 错误不算有效 RED。本批回滚是撤销新增测试，不改产品。

### Batch 2 · GREEN：一个 receipt、现有 owned 生命周期

主文件是 storage 契约/镜像、Start Work 与 Git helper。先实现形状往返、003/generation 与旧库拒绝，再按 Design 接通写前、step、Git final、run final。新增写前失败用例断言本步零 Provider，ack 后本地失败断言 Unknown、Pending 耐久、句柄保留与不继续。主/人工 ambiguous/throw 不得启动第二执行者。

旧 throw 若原意是“确定未发生”，改为显式 Provider 拒绝，保留分支身份、基线前进后不重算 fromRef、同一 worktree 与恢复成功的正控。真实中断用例改为 Unknown/Pending 阻挡。不得删除测试或把新失败简单改成 pass；request mismatch/target changed 的零调用、全库不变判据继续存在。

owner suite 中已有外部 Pending 的 public takeover 改为阻挡证明；旧 owner 迟到结算仍用显式后继 generation fixture 检查完整快照不变。claim 前无槽位、已确定结束步骤后的合法接管正控保留。故障注入按 phase/intent/目标写语义定位，替换 `putMutationAttempt` 第 2 次等易漂移计数，保留“确实命中”、原始错误、原子关系与 ack 断言。

运行 Batch 1 命令、`pnpm typecheck` 及下一节聚焦回归；期望全部 GREEN。每个子步量增删，先解决预算/行为偏差再扩展。回滚整批能力变更和匹配 schema artifact，保留未知外部资源、新库与原库备份，不自动补偿删除。

### Batch 3 · 独立验收、组合与交付

主文件是规则说明、计划结果与索引；执行下面 Concrete Steps。独立验收者核对精确输入、事务边界、根/槽位含义、旧 owner 和验收矩阵，再做有限负控。#204+#457 组合检出跑动态权限拒绝、pending/late response 与恢复回归，明确是本地软件证据。

整理临时/fixup commits、检查公开面，最终 push 后回读当前 PR head/base/checks/closing 引用/全部 review threads。仅最终 head 通过所需检查后 ready；不自行合并、不改 Status。全部验收后移动本计划到 completed 并更新索引。回滚以整个能力闭环为单位，保留证据，不删除远端资源。

### Concrete Steps

命令均在检出 `fix/durable-write-intent` 的工作树根目录运行；依赖缺失时先 `pnpm install --frozen-lockfile`。下列命令期望 exit 0；初次 RED 另按 Batch 1 记录。

    pnpm test:file tests/integration/start-work-external-intent.test.js tests/contract/storage-contract.test.js tests/integration/start-work-request-binding.test.js tests/integration/start-work-owner-fencing.test.js tests/integration/start-work-sqlite-registration.test.js tests/integration/start-work-step-recording.test.js tests/integration/start-work-retry-identity.test.js tests/integration/local-git-start-work-resume.test.js tests/integration/local-git-core-provisioning.test.js tests/e2e/start-work.test.js tests/e2e/start-work-recovery.test.js tests/e2e/write-machine.test.js tests/integration/storage-baseline-admission.test.js tests/integration/migration-runner.test.js tests/integration/execution-relation-write-schema.test.js
    pnpm boundaries
    pnpm verify
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD
    git diff --numstat origin/main...HEAD

最后两类规则按最终 PR 的真实 base 重跑；仓库默认规模上限不能替代本任务 799/1300 硬门。用 numstat 分别求代码/测试/config 与 docs 的 A+D，并计入最终未提交文件；整理 commit 后再次按最终对象对验证。Git 操作通过 argv/API，先规范化 worktree realpath。

远端回读命令：`gh pr view fix/durable-write-intent --repo SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup`；期望真实 base 为 main、closing 含 #204、最终 head checks 满足门禁。用 `gh pr checks --repo SingularityKChen/harness-projects` 与仓库 review 流程回读全部线程，不沿用旧 head 状态。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 写前 exact intent | 两存储 × 四入口在真实 Provider 内读到 Pending；输入/连接/context/owner 逐字段等于实际调用。 |
| 不确定性不可换键绕过 | 已接受丢 ack、调用前中断、同 key/新 key/过期/SQLite reopen 全部零额外写，context generation 与新 key receipt 不变。 |
| 请求根结果诚实 | Git Ready、主/人工在途时根 Pending；ambiguous/throw、未知 run 状态及 replay 均非 Saved、confirmed=false。 |
| 主/人工边界 | 主确定失败后才有 fallback intent；主未知零 fallback；人工未知不被 Failed/Saved 覆盖，真实 binding 与句柄保留。 |
| 本地故障边界 | before 失败本步零 Provider；ack 后回填失败留下 Pending/Unknown，真实句柄与原始错误不丢，不进入下一步。 |
| 本地 owner fence | 后继 fixture 之后释放旧 branch/worktree/run，context/relations/run/attempt/revision 完整快照不变，旧调用不借赢家句柄。 |
| 确定路径仍能恢复 | 明确拒绝、已完成步骤或无槽位观察收据允许既有合法恢复；身份冲突仍零写，基线前进不改变已决定分支。 |
| 存储与发布前 schema | roundtrip/clone/restart 及非法形状拒绝；旧 marker 与 masked shape 拒绝前后全库不变，白名单解释新 JSON 列。 |
| 说明与实现一致 | storage 端口、003 注释、Gate E1 R8/§9 原处订正，明确 Start Work 写前强制点与未知保守边界。 |
| 最终交付 | 实际代码 A+D≤799、docs A+D<1300，聚焦/完整验证与独立审查通过，当前 head 检查和 issue 关联回读完成。 |

### Artifacts and Notes

只在隔离临时检出做三个负控：去掉 exact intent 写入、去掉跨 key 未决检查、去掉 generation 比较；对应入口检查、盲重试与旧 owner 测试必须分别 RED。变异不提交产品分支。保存命令、分支/HEAD、失败/通过计数与精简原始输出到本计划；临时日志不写进 docs。

## Progress

- [x] (2026-10-30 10:05 +08) 核对任务检出、AGENTS/PLANS、两份独立设计和实际核心/Storage/测试入口。
- [x] (2026-10-30 10:05 +08) 收敛单槽位、根/步骤语义、跨 key 未决阻挡与 #457 单 owner 边界。
- [ ] (2026-10-30 +08) 主控回读当前 base/draft，执行有效 RED 并保存证据。
- [ ] (2026-10-30 +08) GREEN、故障矩阵、真实 SQLite restart 与旧库拒绝全部完成。
- [ ] (2026-10-30 +08) 独立语义审查、负控、#457 组合、规模与公开面检查完成。
- [ ] (2026-10-30 +08) 整理提交、最终远端回读后 ready；全部验收后归档计划。

## Surprises & Discoveries

源码已有 request Pending、fingerprint 与 generation；#204 原文和 Gate E1 说明中的“外部写后才登记/无强制点”已经部分过时。此次补的是派生请求与实际目标/owner，不重做 #194/#420，也不把根 Saved 的提前结算扩成 #458 全面结果重构。

增加 intent 写会移动按第 N 次 putMutationAttempt 注入的故障位置；原本 ack 后失败可能误变写前失败而假绿。必须按阶段谓词注入并断言命中。本地旧测试允许 throw 后过期自动重试，与丢 ack 安全要求冲突，需保留测试目的并纠正假设。

设计 B 原估 799 无余量且漏列部分恢复测试；本稿通过取消通用 finish/write-machine 扩展、ack 副本与重复 clone，显式补全测试写集，分配目标 727。该数字仍需实现 diff 证明。主控报告的基线本地 verify 2551+7 pass 仅作背景，不是本任务产品验证证据。

## Decision Log

2026-10-30 10:05 +08 / 最终计划审读者：采用既有 receipt 当前 typed 槽位，复用 owned 与资源回填。Rationale：单一持久家与单一 owner 足够满足具体请求证据，无需第二 ledger。

2026-10-30 10:05 +08 / 最终计划审读者：根状态延后至完整命令结果，Git Ready 后仍 Pending；确定人工降级沿用已有终结语义。Rationale：消除运行尚未开始的 Saved，又不混入 #458 的独立结果规范化闭环。

2026-10-30 10:05 +08 / 最终计划审读者：Pending/Unknown intent 优先于 lease，未知跨 key 不自动重试。Rationale：时间不能证明外部写未发生；接受恢复活性暂由 #193 承接，保留 #421 外部排他边界。用户已授权端到端开发，无需再次设计批准。

2026-10-30 10:05 +08 / 最终计划审读者：无正式发布时直接提升实验 baseline，拒绝旧库且不自动迁移。Rationale：既有 admission 已支持全库不变拒绝，兼容链与破坏性重建均非本闭环所需。

## Idempotence and Recovery

读检查、聚焦测试与新临时库可重复。claim 失败整笔回滚，不消费 key。写前事务失败不得调用该 Provider；已提交 intent 后即使调用未实际发出，也不能靠租约猜测安全重试。已确定拒绝或已完成槽位可以按现有准入继续，未决槽位不可被下一步/新 owner 清空。

同 key 身份不变，新 key 不解除同 context 的未知约束。失去 owner 的调用保留原 Pending，不替后继回填；当次可返回真实 ack 句柄，但不把它写到赢家行。重启不重置 lease、generation 或 intent。

#193 的自动对账/恢复、#421 的 Provider 侧唯一性仍开放；不添加恢复按钮、后台重试或隐式清理。技术债优先复用 tracker 中 #193/Ready gap 对应项，写清此次更保守的活性边界与下一步，不复制路线图为新债。

回滚代码必须搭配原 artifact 与原库备份，保留新库和未知外部资源供对账；新旧二进制不混用同一数据库。不执行自动删库、远端删除、worktree 清理或规划字段回写。

## Interfaces and Dependencies

Node≥22、pnpm@10.28.2；使用既有 `Storage.transaction`、find/put/listMutationAttempts、Fake 与 SQLite。capabilities 的 typed intent/纯复制校验是内部持久契约，Git hook 是 core 内部接口；无新凭据、服务或外部 API。低层 provisionGit 测试的 no-op hook 不代表生产绕过获准。

实现导航按 Context 与 Global Constraints 的确切路径；开发/评审/发布流程分别是 `docs/development/workflow.md`、`docs/review/README.md`、`docs/development/publication.md`。本计划论据来自指定检出源码，不依赖外部文档或本机运行态文件。

## Outcomes & Retrospective

本阶段产出是可实施设计与单 PR 控制计划，尚无本任务产品改动、测试通过或 hosted CI 结论。待实际结果记录时写清当前 HEAD、Fake/SQLite 故障格、RED/GREEN、负控、组合结果、A+D 及偏差；任一验收未达不得归档或宣称 #204 完成。

## Bottom Change Note

Change Note (2026-10-30 10:05 +08)：独立比较两份设计与实际源码后定稿；裁决根/槽位最简语义、未知跨键阻挡、旧 owner 不结算、无迁移与相邻任务边界，补齐恢复测试写集并给出需实测的 727 行分配。
