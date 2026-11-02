# Planning 运行时访问撤销与恢复 ExecPlan

> 状态：Completed（2026-11-02 SGT，当前R11源码独立技术验收与具体1178预算已通过；最终文档head按Batch4回读后Ready，不merge）。
> 创建：2026-10-30（Asia/Singapore）。
> 范围：原 PR #466 自身完成 Planning 拒读、离线、持久恢复与 Start Work 准入闭环。
> 关联：Closes #465；Refs #457。格式以根 `PLANS.md` 为准。

## Purpose / Big Picture

Planning 失去整源读取权限后，同一 Host 的列表、已开详情、原生定位和来源名停止外发；Start Work 的新请求、Saved replay 与第一次实际外部写同样受拒读约束。普通离线保留最后许可缓存、标 stale/read-only。用户在同一来源显式重验证，完整新事实取得 Storage ack 后才恢复内容和准入。

若脱敏事务失败，当前 owner 仍拒读；若进程随后消失，新 Host 从同一 SQLite 启动且 Provider 离线，也不得重新外发旧标题、正文或定位。原 PR 必须自身闭合这些行为，不能把安全性延期到另一 PR。

## Context and Orientation

Planning 是工作区唯一规划事实源。Core 拥有权限与 publication，Controller 转 wire，Host 暴露命令/watch，client 消费已确认事实。redacted 表示不可见；stale 表示仍获准显示但陈旧。工程状态与 Planning Status 正交。

`bootstrapWorkspace` 原失败路径只写 degraded cursor，查询仍可读旧投影；原客户端又以 readable 为 refresh 前提，造成撤权后恢复入口自锁。独立设计调查比较了局部访问 owner、整体重装 Host 与 UI-only 遮罩，选择最小 Core 纵切并接通既有 refreshPlanning。

当前交付分支为 `fix/planning-runtime-access`，基线是含已合并 #204 durable intent 的 main。复查命令为 `git rev-parse HEAD origin/main` 和 `git status --short --branch`，不得沿用旧 stack SHA。后续 Delivery 与 shipped operation/browser 总验收继续属于 #457；本计划不声称完成 R1 或真实账号撤权 UAT。

## Design / Spec

### 一个访问拥有者与版本职责

R7 历史（Superseded by Batch R10）：`runtime-access.ts` 为唯一 Planning 挂载保存内存 denied、access epoch、admissionEpoch 及短本地 publication 队列。Planning Provider I/O 捕获 access epoch；可信整源 PermissionDenied 立即 fence，只有捕获版本仍当前的完整恢复事务 ack 才解除。Start Work 与 target query 捕获 admissionEpoch，查询返回、准入事务尾、Saved replay 返回及首次实际外部写前复验。普通失败 cursor ack 只推进 admissionEpoch，deny/recover 同时推进两者；Planning round 继续裁决普通快照先后，版本职责不能互相代替。

registry 的 binding 身份、声明 key 和 permission/policy 求交保持原语义。重验证使用原声明注册与完整分页校验，探测许可不向业务门发布。Provider 网络等待不进入 publication 队列或 Storage transaction；事务内不调用根 Storage。

### 读前持久 marker 与恢复

在任何 Planning Provider I/O 前，同一事务写入 `planning.project` SyncCursor 的 Syncing marker 和新 started round，ack 后才读取。Syncing 的 cursorValue 保存上一轮结清 state；再次 begin 保留这个前态，lastErrorCode 只保留诊断。`planningReadState` 供 freshness、metadata、Start Work 统一解释：Healthy 行级 permission gap 保留可见目标准入；Degraded/Failed 或未知前态保持 read_only/stale，不能在重试期间短暂变 available。

新 owner 对任何未结清 Syncing 恢复 denied，即使 cursorValue/lastErrorCode 为空。marker 只能证明曾开始未结清读取，不能证明进程消失前没有观察到拒读。正常已结清 Degraded/unavailable 不触发全局遮罩，普通离线缓存仍可浏览。

整源拒读在同一事务 redacted 全部 Planning 投影、清 planningFields/status，并按实际内容变化推进 revision；身份、membership 和工程谱系保留。事务失败不假称持久化成功，内存 fence 与已 ack marker 保持安全。删除备用 permission cursor writer，避免旧补写覆盖较新恢复；安全性不依赖第二次补写成功。

失败结算与事实提交都在实际事务中比较 epoch/round。marker 失败分类是每次 bootstrap 局部状态，不修改 unknown 异常或共享标记；null/string/冻结 Error 在结算 ack 后各诊断原值一次，结算失败继续既有 TD-030/TD-031 caller/compose 边界。marker 未 ack 的旧失败也不得覆盖较新的完整 Healthy。

### 完整恢复与产品路径

完整读取需要项目、全部分页、scope/identity 校验和同 binding 声明权限重验证；projections、membership、observation、revision、Healthy cursor、reconcile 与 committed round 同事务，ack 后恢复访问和来源名。部分分页、旧 epoch/round、commit rollback、单次 describe/getProject 成功均不解锁。

client/UI 在 connected、有既有 Planning 挂载且不 pending 时允许调用原 refreshPlanning；断连零 RPC。内容、Saved 和确认时刻仅由 Host 确认帧恢复。权限错误使用固定安全文案，未知 Provider 原文只进诊断。wire 复用已有 redacted locator 规则，禁止 UI-only authority 或合成 baseline。

## Global Constraints

本 PR 文件集：`packages/core/src/{bootstrap,context,queries,runtime-access,start-work}.ts`、`packages/core/src/create-change-request.ts`（新 main 既有操作仅补齐统一准入 context）、`apps/harness-plugin/src/host-composition.ts`、`packages/client/src/planning-refresh.ts`、`packages/ui/src/work-item-app.ts`、`packages/ui/src/workspace-setup.ts`、`tests/contract/ui-workspace-shell.test.js`、`tests/integration/{runtime-planning-access,harness-plugin-runtime-access,github-projects-bootstrap,harness-plugin-workspace-setup,harness-plugin-planning-refresh-ui}.test.js`、本计划及 `docs/README.md`。既有 #204 BeforeExternalWrite 是唯一首次写 hook，无平行永久 API。

以下为历史阶段（Superseded by Batch R10）：原 823 行具体例外及后续 854 行待裁是 2026-10-30 的历史阶段，Superseded by Decision Log「2026-11-02 Ready 交付授权」。在已说明具体 854/872 行候选后，人类指示继续并完成 Ready；本轮保留完整协议和测试，并修复最新 main 接合发现的恢复入口回归。2026-11-02 Ready 准备阶段的代码 A+D 为 883（当时在 `554e6fef` 上机械重算）；后续 R5/R7 候选以同一目标 base 的当前 diff 重算，继续遵守代码 1000、文档 1500 硬限。不把该授权扩大为无关新功能、删减断言或任意未来预算。

不做旧发布兼容、schema/data migration、删库或 policy 重置。不写规划 Status 或原生依赖关系，不自动合并。凭据只存 secret handle；正式文档中文、公开 issue 英文；提交前遵守 publication 五类检查。

## Plan of Work

所有命令在检出 `fix/planning-runtime-access` 的工作树根运行，使用仓库 `packageManager` 指定的 pnpm 10.28.2。

### Batch 1 · 判别失败机制

主文件为两份 runtime 集成测试。复用 fake/SQLite/Host seed，以 canary 和 Provider deferred 覆盖撤权、离线、旧成功/旧失败、部分恢复、redaction rollback、direct/replay、重启双故障和恢复入口。先确认行为断言 RED，不能把导入或夹具失败当 RED。

    pnpm test:file tests/integration/runtime-planning-access.test.js tests/integration/harness-plugin-runtime-access.test.js

期望旧实现失败于 canary/Saved/metadata，修复后全部通过；回滚点为本批新增测试，不改用户数据。

### Batch 2 · authority、marker 与事务

主文件为五个 Core 模块。实现唯一 epoch、前态解释、任意遗留 marker 拒读、单 writer 与完整 ack 恢复；保留 helper 后 admission/claim/replay/first-write 等待窗口。扩大 marker 故障阶段时，使用同一参数化 race 和同一较新 Healthy 正控。

    pnpm test:file tests/integration/runtime-planning-access.test.js tests/integration/planning-round-order.test.js tests/integration/planning-snapshot.test.js tests/integration/sync-revision-freshness.test.js tests/integration/planning-refresh-scheduler.test.js
    pnpm typecheck

期望副作用计数、账本、身份、reconcile、原异常诊断及版本裁决均符合本设计。回滚须整体撤回本批安全协议，不能只移除一个读门。

### Batch 3 · 真实 Host 与恢复交互

主文件为 client/UI 接线和 Host runtime 测试。真实 createHostComposition、SQLite、installHostRemote、watch、client.apply/source 与 renderer 验证已开详情。通过真实关闭重开验证双写故障，不改写 Controller 返回、不手工挂许可或合成 baseline。隔离副本分别取消 gate、epoch、redaction 作为负控，负控不提交。

    pnpm test:file tests/integration/harness-plugin-runtime-access.test.js tests/integration/harness-plugin-host-planning-refresh.test.js tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-planning-refresh-ui.test.js
    pnpm run boundaries

期望 connected denied 可到真实 RPC，同 Host/client/source 恢复；offline 正控保留内容；来源/locator 不泄漏。回滚点为本批接线，整 PR 回滚仍按依赖逆序。

### Batch 4 · 独立复评与交付

本实现 owner 只执行本地实现、验证、提交整理与 freeze 交回；最终 push、closing 字段、review reply/resolve、归档和 Ready 均由协调会话串行负责，#472 不在本 owner 修改范围。

主文件为本计划和索引。独立验收固定 source/base，对四条 R3 和新增相邻反例逐项回读。整理为文档/能力两个可审阅 Conventional Commits，建立 backup ref，最终发布只用精确 lease。原 #466 保持 Closes #465。

    pnpm verify
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD
    git diff --numstat origin/main...HEAD
    gh pr view 466 --repo SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,statusCheckRollup,reviewDecision
    gh pr checks 466 --repo SingularityKChen/harness-projects

期望本地全部通过、真实规模在具体批准内；最终 push 后固定远端 head/base、双向 issue 关联、所有分页 review threads 和当前 head CI。上述命令不是已执行声明；全部门通过才 Ready，由人类决定 merge。

## Concrete Steps

依次执行各 Batch 中的命令；进入最终交付前重新确认工作分支和 base，使用 `git diff --numstat` 累计 additions 与 deletions。命令失败时保留该批 Active，先修复判别失败，再进入下一道门。

### Batch R5 · 普通离线的当前只读准入

R466-CURRENT-F1：Start Work 已认领、等待首次外部写的 preflight，或 Saved replay 等待账本期间，Planning 完成普通 offline 结算为 read_only，但 denied/epoch 不变化，旧准入仍可越过。要求所有准入、重放完成及首次真实写前消费与 startTargetError 相同的当前 projection/cursor disposition，并在 transaction 里只用 tx。保持 Healthy、行级 permission gap 和普通健康刷新在途正控，不把任何 Syncing 一律拒绝；不取消已发 Provider I/O。

复用 startTargetError 的现有权威判定是首选；新增另一份 runtime read-only 状态会重复拥有同一事实，故放弃。每次异步复验前后仍核对 access epoch；若在事实读取后还有本地 await，最迟首次写 hook 的实际事务尾复验必须保留。

在检出 `fix/planning-runtime-access` 的工作树根运行 `pnpm test:file tests/integration/runtime-planning-access.test.js tests/integration/harness-plugin-runtime-access.test.js` 和 `pnpm typecheck`；期望新增 ordinary-offline 等待窗先在真实副作用/旧Saved断言 RED，修复后全部 GREEN，健康/行gap/pending准入和offline许可缓存不退化。原 reviewer 外部 Core 与真实Host探针作为补充，不改其断言。回滚为本批完整准入判定与回归，保留已确认外部资源。

### Batch R7 · 最终异步 cursor 读的版本栅栏

2026-11-02 @ c96a109、base 26bd232：独立反例把首次写 hook 最后一次根 cursor 读取的 Healthy 值取出后暂停 Promise；普通离线结算已 ack 后释放，仍可产生 branch/worktree/run。R5 以实际 Storage 读瞬间为线性化点的边界不足以关闭这一窗口，Superseded by 本批版本栅栏。

R7 历史（Superseded by Batch R10）：唯一 runtime access owner 保存 access epoch 与 admissionEpoch：前者继续裁决可信拒读、完整恢复和 Planning 轮次，后者用于 Start Work 与 target query 的异步准入。普通失败在 local 队列中的当前 access epoch/round cursor 事务 ack 后才 invalidateAdmission；不改 denied、许可缓存或 registry，旧轮跳过和 rollback 不推进，Healthy/行级 gap/健康在途不推进。deny/recover 推进两者。startTargetError 本身及准入 helper 都在异步读取后裁决 admissionEpoch；最终 cursor 等待旧准入返回明确 stale_revision，其余当前只读返回 unavailable。单 epoch 试案被“较新 ordinary offline 吞掉较早可信拒读”正式 RED 推翻，不作为最终方案。

正式矩阵新增 last-cursor stage，复用已有 intent 夹具；合并 Host 离线首写与拒读首写的重复脚手架，保留原断言。执行 `pnpm test:file tests/integration/runtime-planning-access.test.js tests/integration/harness-plugin-runtime-access.test.js tests/integration/planning-round-order.test.js`、`pnpm verify` 和 `node scripts/rule-checks.mjs size 26bd232`；最终 worktree 规模另按 diff 重算。负控只用隔离副本，不临时替换 owner 产品文件。

### Batch R10 · 同库 owner 的统一读取处置

R7本地admissionEpoch不能观察peer提交，故其仅同owner闭合的结论由本批取代。共用Storage fence由独立#509/PR#510前置，版本只能在同root一次异步读取前后比较，变化则重读；事务内只用tx，不调用rootfence，Provider I/O不进入事务。

同一个runtimeAccess.planning读取现有cursor与持久PlanningSyncRound，统一生成state/masked/error供snapshot、detail、sync、metadata/source与target准入使用。只记录本owner实际在途round Set，其生命周期覆盖begin ack、Provider、事实/失败结算及finally；本owner healthy/gap在途可继承许可，foreign/unclosed Syncing保守遮罩。未知前态在既有cursorValue中规范为Failed，自己retry和后续普通offline不能把它洗成许可缓存；完整validated facts+Healthy+committed round同事务ack才解除。

local拒读同时记实际观察的round；peer较新latestCommittedRound完整证明可解除它，旧拒读不能覆盖较新完整证明。只有新begin而没有fullcommit不能抹旧deny。Healthy行级permission gap不作整源mask，普通Degraded/unavailable仍许可缓存只读。删除冗余本地admissionEpoch，不新增状态表、权限数据库、global进程缓存或迁移。

正式Core矩阵复用既有context/core双owner，扩peer在preclaim/first-write/intent/最后cursor/replay/result等待窗口的offline/denied/healthy/rowgap/pending；保留原全部安全断言。新增source名、foreign实际denyrollback、未知marker自己retry、peerfullproof恢复及late-denial、Healthygap正控；真实同文件双Host复用既有openfixture。Shared未知marker允许options/command结构化拒绝或throw，核心验收仍是受限内容/locator/source零外发和外部计数不增加。

固定source `70b17e63aab5b9d420762b0bba1f7392a6c96665`、直接父层 `be6e727e2a4f0c0ea5aa0a2eeb5058f7823956af`（2026-11-02 SGT）：真正注册worktree完整`pnpm verify`3267/3267+MVP0 7/7通过；设计候选274正式+30外部+typecheck通过，原owner外部重放亦GREEN。ignored副本bundle4失败仅因不是registeredcheckout，已被真实worktree完整结果替代，不删该四测试。代码真实1165 A+D，超过1000硬限165；本聊天已明确批准该source具体1165行例外，见Decision Log。该批准不沿用#472 source06c的1074批准，也不取代独立复评和远端门。

在检出`fix/planning-runtime-access`工作树根执行原Batch1–4命令、`node scripts/rule-checks.mjs size feature/storage-committed-fence`、`git diff --check feature/storage-committed-fence...HEAD`；具名变异仅在隔离archive，基线/具名失败/逐字还原通过后记录。root当前head独立评审、具体预算、下游restack和最终远端门仍是下一门。

### Batch R11 · 完整 peer 恢复后的首次新操作

R10 独立复评已确认原跨 owner F1 修复，但发现同一 owner 延迟对齐旧拒读时，首 StartWork 与首 refresh 捕获了对齐前 epoch。现在 StartWork 在既有 initial target query 成功对齐后捕获版本；beginSyncRound 在原 planning(tx) 对齐后、marker await 前捕获，并由成功返回及原 markFailure callback 同源传回。失败分支不临时读取最新 epoch，以保留真正后到拒读 fence；无新事务外读取、权限状态或公共接口。

正式已有 peer-proof 矩阵扩首次 start/refresh/marker-failure 三分支，两adapter新增6项先RED0/6后GREEN。检出 `fix/planning-runtime-access` 的 source `b2a17a7`（2026-11-02 SGT，base `451457b`）运行原 Batch R10 命令：280正式、原反例4项、完整 `pnpm verify` 3278+7及typecheck通过；独立20正式+2后到真实拒读诊断通过。当前代码1178 A+D，较已批准1165净增13；人类已批准该具体候选，协调者当前source复评APPROVE。最终远端head门仍待完成。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 整源拒读与 ordinary offline | fake/SQLite 成对；前者遮罩、后者许可缓存 stale/read-only |
| 直接命令与首次写 | 新请求、Saved replay、claim/preflight/intent 等待后仍 fence；禁止新增 Provider 副作用 |
| 恢复顺序 | 旧成功不解锁、旧失败不撤回新恢复；仅同 scope 完整事务 ack 解锁 |
| 双写故障重启 | 真实 Host/SQLite 留 Syncing/null，offline 重开不外发 title/body/native locator；普通 offline 正控保留 |
| 前态一致性 | Healthy 行级 gap 在 held retry 仍 available；Unavailable 前态 read_only/stale；嵌套 begin 不丢前态 |
| marker 失败 | I/O=0；局部分类、原异常一次诊断；各失败阶段不覆盖较新 Healthy |
| 生产链 | watch/remote/client.apply/render 与真实恢复 RPC；无 Controller override 或合成 baseline |
| 交付门 | 严格规模/发布面、固定 head 独立复评与 hosted CI；本地测试不冒充 UAT/R1 |

## Progress

- [x] 2026-11-02 SGT：当前source在隔离同树副本保留原八项并新增首StartWork/refresh/marker失败三项，十一具名变异均KILLED，基线/逐字还原后均GREEN。

- [x] 2026-11-02 SGT：R11 首次peer恢复操作与marker失败同版本修复，6正式RED→GREEN，280正式/4原probe/完整3278+7及独立20+2通过；冻结source b2a17a7，实际1178，新增13预算和协调者当前source复评待完成。

- [x] 2026-11-02 SGT @ c96a109 工作树 R7 候选、base 26bd232：最终 cursor 与 direct target query 等待窗、混合 offline/denial 轮次正式 RED→GREEN；156 项窄回归、9 项外部探针、完整 verify 3053+7 和 typecheck 通过，代码 998 A+D。产品冻结交回 root；独立复评、提交和远端门未完成，计划保持 Active。
- [x] 2026-11-02 SGT：R5 当前准入与 Host 缓存返回根因修复，正式 RED→GREEN、149项窄回归、7项原外部探针、typecheck与完整2866+7通过；当时产品冻结；Superseded by Batch R7（2026-11-02）。
- [x] 2026-11-02 SGT：协调者独立接受R10原F1与R11新P2，source b2a17a7无剩余finding；当前1178具体预算已获人类批准，技术闭环完成并归档。最终文档head CI/全部线程及双向关联仍按Batch4重新回读后resolve/Ready。

- [x] 2026-10-30 SGT：两份独立系统设计调查及最终方案复核，确定原 Planning 能力闭环。
- [x] 2026-10-30 SGT：Core、UI、真实 Host/watch/client 及 #204 唯一首次写 hook 接入；原准入、重放、提交窗口反例闭合。
- [x] 2026-10-30 SGT：统一 Syncing 前态协议、任意遗留 marker 拒读、删除 fallback writer；原 R3 四项对应正式回归与外部复验已建立。
- [x] 2026-10-30 SGT：独立相邻反例促成 begin 整事务失败的 round 裁决；全部 begin 阶段、初次/已有 round 和两种 Storage 的 20 项正式回归通过，新增早期阶段均有真实 RED。
- [x] 2026-10-30 SGT：当前冻结源码独立 151/151、外部 41/41 和完整 verify 2759/2759 加 MVP-0 7/7 通过。
- [x] 2026-11-02 SGT：在具体预算说明后收到人类“继续并完成 ready 交付”；接合当前 main，必要修复与测试保留，归档及索引同步。
- [x] 2026-11-02 SGT：当前源码独立 116/116、真实 DTO 正反矩阵及完整 verify 2799/2799 加 MVP-0 7/7 通过；最终提交包已准备，push 后的实际 Ready 由 Batch 4 远端规则判定。

## Surprises & Discoveries

既有 redaction wire 可复用，但 redaction 落库失败可产生同 revision 的内容变化，现有 Controller gap 和 client 新代 baseline 必须实际验证，不能伪增 revision。真实组合已验证该恢复通路。

历史结论“将 Syncing fence 限定为带前一轮错误证据”被双写故障推翻。Superseded by Design / Spec「读前持久 marker 与恢复」（2026-10-30）：error 不能证明未结清读未观察到拒读。旧“备用 permission writer 补救”同样被旧写覆盖新 recovery 的反例推翻，已删除该路径。

旧 helper-only 准入判断被 ledger/claim、Saved replay 与首次外部写等待窗口反例推翻。Superseded by Design / Spec「一个访问拥有者与版本职责」（2026-10-30）；复用已经进入 main 的 #204 hook，不新增平行 hook。

首轮 2660+7、后续 2737+7、完整协议 2741+7 都仅属于各自历史源码；不能作为当前 head CI 或接受结论。新增 begin round-write/commit rollback 反例证明 cursor-only catch 仍不完整。第一次增量的本地完整 `pnpm verify` 为 2745/2745 加 MVP-0 7/7；最终完整 begin 矩阵源码为 2759/2759 加 MVP-0 7/7；独立复评仍可推翻这一局部通过。

## Decision Log

- 2026-11-02 SGT · 全部开放PR接管：本会话人类原话：“请你接手所有 PR 的 review和 rebase merge。相关 PR 均已经 approval。请你按照审批流程继续”。本授权明确覆盖当前PR #466，由本评审会话接管修复/独立复评、实际base重放、当前head门禁、issue核对及rebase merge。旧阶段“不merge/仅Ready”的限制仅在合并授权上 Superseded by 本决策；技术、范围、预算、凭据与人类UAT/R1门保持。Planning Status及native依赖关系仍不写入。

- Decision：人类批准source `b2a17a7` 的具体1178行候选，较既有1165行具体例外增加13。
  Rationale：本聊天原话“批准这两个具体候选，继续 Ready”；保留全部修复和判别测试。仅该source及精确规模例外，当前head独立评审、CI与远端回读仍需通过，不合并、不改变其它预算或范围。
  Date/Author：2026-11-02 SGT / 本聊天人类裁定，owner记录。

- Decision：人类批准 source `70b17e63aab5b9d420762b0bba1f7392a6c96665` 相对前置 #510 的1165行具体候选。
  Rationale：本聊天原话“批准该具体 1165 行候选，继续 Ready”；保留完整跨owner修复和全部判别。仅放行该165行规模例外，独立当前head复评、CI及远端回读仍必须通过，不扩大其它scope、预算或merge授权。
  Date/Author：2026-11-02 SGT / 本聊天人类裁定，owner记录。

- Decision：R7 历史（Superseded by Batch R10）普通失败 cursor 事务 ack 后只推进同一 runtime owner 的 admissionEpoch；access epoch 保持拒读/恢复与轮次职责，deny/recover 同时推进两者。
  Rationale：R7 最终 cursor Promise 反例推翻仅依赖 Storage 实际读瞬间的边界；单版本方案又被较新离线吞掉旧可信拒读反例推翻，版本职责分离不新增 read-only authority，保留旧轮和事务 rollback 裁决。
  Date/Author：2026-11-02 SGT / root 授权，Planning owner 执行。

- Decision：采用局部 Core epoch、既有 round/registry/redacted wire，拒绝 Host 重装和 UI-only 遮罩。
  Rationale：保留单一 authority 和故障域，直接命令与所有读出口同语义。
  Date/Author：2026-10-30 SGT / 独立设计与计划复核。
- Decision：原 #466 自身关闭 #465，保留完整 marker 协议、Host 重启和 UI 恢复，不拆安全行为。
  Rationale：人类原话：“允许 #466 保留 823 行完整协议和测试（建议）”。此前为原 800 行门提出的 marker/UI 拆分均取消；这仅批准本具体 823 行候选，不自动批准后续增长。
  Date/Author：2026-10-30 SGT / 人类经协调会话直接裁决。
- Decision：新增同根因失败阶段的正式测试必须保留；当时 854 行方案在必要增量预算明确前不发布或 Ready。Superseded by 本节「2026-11-02 Ready 交付授权」。
  Rationale：begin round-write/commit rollback 的四个真实 RED 表明旧结算可覆盖较新 Healthy；不能删必要断言来恢复数字。
  Date/Author：2026-10-30 SGT / 实现与独立验收者，预算待人类裁定。

- Decision：2026-11-02 Ready 交付授权。
  Rationale：在已明确说明 #466 854 行、#472 872 行及四个 Draft 原因后，人类原话“继续并完成 ready 交付”。按该具体上下文继续现有能力闭环的发布准备，不再拆协议或删除测试；本轮终点为 Ready 并请求人类评审，不执行 merge。最新 main 外壳把拒读容器卸载的新 P2 属于必要接合修复，增加 29 行，最终 883，未增加需求或放宽权限。
  Date/Author：2026-11-02 SGT / 人类指令，交付 owner 记录。

## Idempotence and Recovery

refresh 可重复，重复 denial 不重建身份或虚增 revision；offline 不清 deny；只有完整 ack 更新 reconcile。失败后重试同一来源，不删库或新建 workspace 逃避状态。回滚使用整体 PR revert，不删除外部已 ack 资源；回退会重新引入撤权漏洞，必须说明该风险。

本轮恢复锚点为 `backup/ready-delivery-466-20261102` 与 `backup/ready-466-panel-before-consolidation-20261102`；历史恢复锚点为 `backup/planning-complete-candidate-before-ui-split-20261030`（完整 823 候选）和 `backup/planning-all-begin-before-cleanup-20261030`（最终完整源码与计划）；原远端 `62075238eac531f815a899ccbdf97bf164bf3ba3` 保存在 `backup/planning-remote-before-final-consolidation-20261030`。整理前保存完整 source 和原远端 head 的 backup ref；原未跟踪评审文档保留并纳入最终文档提交，不暂存其它无关文件。远端改写由协调者串行执行且使用精确 old head lease，失败即重新取证，禁止覆盖另一个会话写入。

## Interfaces and Dependencies

Node 至少 22、pnpm 10.28.2、fake/SQLite、Host typed remote 与 client apply 为必要工具；测试不需要真实上游凭据。事务只使用 StorageTransaction；Host ack/reconcile 仍是 Saved 的前提。唯一 BeforeExternalWrite 来自已合并 #204，后续 #457 operation/browser 由其他 owner 继续。

未新增有意延期的技术债。Delivery、shipped operation/browser 和实际安装 UAT 是 #457 的显式后续范围；不能用 `docs/exec-plan/tech-debt-tracker.md` 替代本计划安全验收。

## Artifacts and Notes

正式判别证据是本计划列出的集成测试和具体命令；原始日志、外部探针及临时 checksum 保存在任务运行态目录。产品接受、hosted CI、人类 UAT 和 R1 分别记录，不相互替代。

## Outcomes & Retrospective

R11 当前source `b2a17a7`（2026-11-02 SGT，直接父层 `451457b`）：完整3278+7、正式280、原反例4、十一具名隔离负控及独立20+2通过；协调者原4、新6含在窄46、typecheck和三新fix具名负控通过，410文件还原一致，结论APPROVE、R466-SHARED-F1 ADDRESSED、无新增finding。原跨ownerF1已技术接受，具体1178预算已获人类批准。未延期技术债；最终远端headCI/作者线程/Ready仍按Batch4实际回读。以下R7/R5计数仅归属各自固定历史source。

2026-11-02 在检出 `fix/planning-runtime-access` 的工作树根，以 `c96a109` 为未提交 R7 修改起点、base `26bd232` 完成 access epoch/admissionEpoch 职责分离。最后 cursor 旧 Promise、direct target query 和较新 offline 吞旧拒读均有具名正式 RED→GREEN；`pnpm verify` 最终 3053/3053 加 MVP-0 7/7、typecheck，通过原探针加新 cursor 探针 9/9，代码 998 A+D。仅是本地证据，等待 root 独立复评和串行交付。

R5 修复源码提交 `67fdc7465caf9e2675a661f7d94351bfee2822e0`，base `554e6fefb1ad9781becf879b9f96e367e9f6ceff`（2026-11-02 SGT）：Core复用当前startTargetError与tx版只读准入，覆盖preclaim、first-write、intent-commit、Saved账本/完成和既有结果窗口；Host保存同一Core已公开query函数引用，补controller缓存前后当前准入，不新建权威或public command。后置已ack结果仅将本次authoritative返回降unknown，value/handles/ledger事实保留；恢复后原键确认且branch/worktree/run计数不变。正式149/149、原探针7/7、完整`pnpm verify`2866/2866加MVP-0 7/7与typecheck通过。当前代码993 A+D，保留全部旧断言；这些本地结果不是root独立接受、当前head CI或R1。

2026-11-02 R5 复审重开本计划；下列已完成结论仅对应当时固定 source，不代表本批新反例已闭合。当前 R5 设计及实际进度见本节新增批次和 Progress，最终完整验证与独立复评通过后才重新归档。

2026-11-02 当前源码为 `2025a22b036d5c10e5137e7d4d4f469dfaac8117`，base `554e6fefb1ad9781becf879b9f96e367e9f6ceff`；独立 116/116、完整 `pnpm verify` 2799/2799 加 MVP-0 7/7，typecheck 和正反恢复矩阵通过。新增 main 外壳 P2 已由真实 Panel 与 Gate 回归闭合，当前无剩余已知 P0/P1/P2/P3。以下 2026-10-30 数字仅为历史版本证据。

独立统一复评已通过 151 项正式回归与 41 项外部探针，原 R3 四项和新增同根因结算 P2 均闭合。2026-10-30 18:34:48 +0800 记录的代码提交为 `1b2005aa80acb371e9142674746da9516da90f62`，base `417349a3b6504b73594362a3253d9ee1565ba5c5`；它与最终独立 freeze 的 packages/apps/tests 逐字一致。完整本地 `pnpm verify` 为 2759/2759 加 MVP-0 7/7，typecheck 同步通过，命令上下文见 Batch 4。末次文档提交不改变这些产品证据；远端 head 不沿用本地值。

统一候选已实现任意未结清 marker 的重启拒读、前态统一解释、局部诊断、单 writer，以及原 Core/Host/UI 的撤权恢复链。实际验收仍以当前冻结源码、独立反例和最终远端门为准；本计划按当前实现与验收归档；远端 Ready 必须回读最终 push 的新 head，不能沿用历史状态。

最终范围继续是 #465，#457 总问题和 R1 不关闭。外部维护 actor 为仓库当前已认证 owner，目标为同仓 PR #466/issue #465/Project，幂等键为 `2026-10-30:465:delivery`；规划 Status 与原生依赖没有写入。


### 2026-11-02 · 接管与逐层合入门

本轮实际直接base为 `7a2eed0b4569e7d10aa9244ddd3e11009344bac2`；在本分支根执行 `node scripts/rule-checks.mjs disclosure 7a2eed0b4569e7d10aa9244ddd3e11009344bac2`、`node scripts/rule-checks.mjs size 7a2eed0b4569e7d10aa9244ddd3e11009344bac2` 和 `git diff --check 7a2eed0b4569e7d10aa9244ddd3e11009344bac2...HEAD`。早期批次的固定source/base用于重放其历史证据，不作本轮当前判定。

本PR原正式批准与全矩阵证据由 `docs/review/pr-466-mmp-review.md` 承接；本轮用户明确要求接管全部开放PR。每次父层合入后，以真实main/直接父层重新确定replay cut，保留完整已批准产品/测试语义、归档与导航。先建 `refs/backup/pr466-before-approved-integration-20261102`，再检查range-diff、规模、五类发布面与适用验证；仅使用精确旧远端head的lease发布。

在当前分支检出根回读 `gh pr view 466 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,reviews,closingIssuesReferences`、`gh pr checks 466 -R SingularityKChen/harness-projects` 与全部review threads。新head的独立复评及真实必需checks成立后才执行已授权 `merge_method=rebase`；native stack成员使用仓库已验证的merge-async入口，逐项回读实际MERGED、合入tree和对应issue。旧head批准、dispatch、局部测试或“无冲突”不替代当前head验收。

## Bottom Change Note

Change Note (2026-10-30 SGT)：保留原独立设计、TDD、准入/重放/首次写和 Host 证据，收敛历史重复与失效结论；以人类逐字 823 行裁决恢复原 PR 完整闭环，记录新增 begin 事务失败反例、当前实际 854 行与未过的预算/归档/远端门；当前独立 151+41、完整 verify 2759+7 已通过，不提前归档。

Change Note (2026-10-30 SGT)：按独立计划语义复核补精确源码、时间、恢复锚点与实现/协调者责任；撤回旧“独立未过”注记。

Change Note (2026-11-02 SGT)：接合最新 main 554e6fef，保留其来源观测/数量公告、设置与焦点行为。新的实际 Panel 回归先为 14 pass/2 fail，再为 32/32；真实 setup 通过存储配置自然 confirmed，未覆盖 Controller/Host 返回。WorkspaceSetupGate 在同工作区已确认挂载且明确拒读时保留安全容器，未知/外部来源/无挂载仍拒绝；来源名被 Host 隐藏是合法 wire 形态。源提交 2025a22b036d5c10e5137e7d4d4f469dfaac8117，base 554e6fefb1ad9781becf879b9f96e367e9f6ceff，独立 116/116、全量 2799+7、typecheck 通过。当前实现与评审归档，最终文档 head 的 CI、全部线程、双向 issue 与 Ready 仍按 Batch 4 验证。

Change Note (2026-11-02 SGT)：按正式 R5 一次性意见重开 Active；保留此前 Completed/Ready 的固定版本历史归属，新增本批根因设计、TDD、事务/并发与独立复评门。不借旧作者批准放行新版本，不改规划 Status、原生依赖或 UAT/R1。

Change Note (2026-11-02 SGT)：R5 源码与正式回归冻结，新增ordinary-offline等待窗先43pass/9fail后GREEN；Host新/缓存返回矩阵先6pass/2fail。当前完整2866+7、本地149及原7probe通过，993行代码未超1000。实际权威Storage读取是当前判定的线性化点，不声明任意被人为暂停的旧读取Promise具有更强原子性（Superseded by Batch R7，2026-11-02）；不取消已发Provider I/O。Host返回后当前只读不删除或改写已确认receipt/资源。等待root独立新head复评。

Change Note (2026-11-02 SGT)：独立 R7 最终 cursor 等待窗重开当前准入，新增同一 owner 中 admissionEpoch 的普通失败 ack 失效设计，保留 access epoch 拒读/恢复职责，保留全部首次写、重放、健康与轮次证据；本批完成与交付状态以 Progress 为准。

Change Note (2026-11-02 SGT)：R7 两版本职责方案冻结；自然合并重复 Host 首写夹具并删除已由 target query 负责的重复前置检查/unused optional分支，保留全部旧断言和新增 cursor、轮次、rollback 正反；最终本地 3053+7、156、9 与代码 998，未 Git 写入或 Ready。

Change Note (2026-11-02 SGT)：接合 main ea37903 的 PR 操作与 UI，保留 creator/onConnect/原操作恢复；两处既有操作准入补齐相同 Core context。将 admissionError 转发合并入 startTargetError 的捕获版本参数，保留当前错误优先与异步返回版本复验；完整本地3171+7、原7加last-cursor2探针通过，实际代码1000。首次参数接合遗漏被typecheck识别后修正，此处通过对应修正后的完整源码。当前远端与独立复评门仍未完成。

Change Note (2026-11-02 SGT)：R9独立复评仍确认原F1跨ownerP1；同owner回归不代表共享SQLite/Memory处置已闭合。前置独立Storage fence由#509/PR#510承担，Planning继续统一cursor/round/owned在途和持久完整确认；不提前发布或归档。

Change Note (2026-11-02 SGT)：R10统一共享读取处置、root-only同步fence、owner round寿命与继承未知前态，删除冗余本地admissionEpoch；source70b17e6真实worktree完整3267+7，正式与外部证据保留，代码1165具体预算仍未批准，不提前归档/Ready。

Change Note (2026-11-02 SGT)：记录本聊天对70b17e6具体1165行明确预算批准；不替代当前独立评审和最终远端门。

Change Note (2026-11-02 SGT)：记录八项有效具名负控/基线及还原GREEN；原29probe在正式owner重跑通过，具体1165批准仅本source。下游接合由串行owner负责，未经新source评审不发布。

Change Note (2026-11-02 SGT)：R11修正peer完整恢复首次操作的epoch捕获，成功/marker失败同源版本，保后到deny；正式6例RED→GREEN、280/4/3278+7及独立20+2通过，具体1178预算待裁。原admissionEpoch设计就地标R7历史并指向R10。

Change Note (2026-11-02 SGT)：R11同source隔离十一具名负控全部KILLED，保留原八项并补首操作/marker失败捕获顺序三项；基线与还原GREEN，未退owner安全代码。

Change Note (2026-11-02 SGT)：记录本聊天对b2a17a7具体1178行候选的人类批准，仅放行该规模，保留当前head独立复评/CI/远端门。

Change Note (2026-11-02 SGT)：协调者对b2a17a7完整复评APPROVE、P2ADDRESSED，具体1178预算获批；技术闭环完成，归档并保留最终精确head远端门。

2026-11-02 SGT：按本会话人类对全部开放PR的直接授权接管收尾；新增实际base重放、恢复引用、精确lease、独立复评与逐PR合并回读门，保留原产品/预算/人验边界。
