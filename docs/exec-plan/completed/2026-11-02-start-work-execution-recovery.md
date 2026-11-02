# Start Work 执行回执恢复 ExecPlan

> 状态：Completed（工程实现与独立验收；发布门按当前 head 回读）；创建：2026-11-02；关联：Closes #193。
> 按根 `PLANS.md` 维护；正式归档目标为同名 `docs/exec-plan/completed/` 文件。

## Purpose / Big Picture

执行 provider 回答以后，本地完整命令结算失败不再丢掉已经持久的 run 身份。重启后显式重放沿原签发者读取同一个 run；可证实的状态结算原 receipt，不能证实则明确 Unknown/degraded。没有持久引用时不再次 start，也不冒充 Ready/Saved。最小证据是主执行和 fallback 在 Fake/SQLite 的回执断点重放，外部 run 数始终为 1。

## Context and Orientation

2026-11-02 观察的设计基线为 `origin/main@554e6fefb1ad9781becf879b9f96e367e9f6ceff`；执行前重新记录实际 base/head。`start-work.ts` 已有 pending externalIntent（调用前提交的目标/输入）、provisioningGeneration（持久 owner 代际）、跨 key 未决阻挡与 Ready 缺 run 的诚实降级。真实缺口是 `recordRun` 把 run 与完整命令 receipt 放在同一事务，后者失败令已知引用回滚；`replayRequest` 与 `claimContext` 未把已知引用的冷读结果接回原 receipt。`execution-run.ts` 已按记录 binding 调用 getRun 并比较精确引用与快照。执行 provider 不支持未知引用的全局查找。

## Design / Spec

复用 `ExecutionRunRecord` 作唯一 run 身份事实。收到合法 ack 后，先在 `owned` 短事务写 run（providerRef、status、fallback 同行），再在另一短事务仅结算 command receipt。后一个事务不能重写 run；若期间刷新/取消已推进状态，保留较新的 run。原 finalizer 也须比较 journal 时读取的完整 attempt 快照；另一 Core 已结算 receipt 时只观察后继，不把 saved/failed/unknown 改回旧结果。ref 必须是原执行 binding、execution_run、非空 externalId；无效引用保持 Unknown，不登记外来身份。

恢复仅由显式 startWork 命令触发。same key 先核对当前可见性、完整请求指纹与原目标；new key 命中未决 context 时观察原 attempt，不登记替代 key。认领中的 pending 查找必须先限定 `row.commandName === 'startWork' && row.externalIntent?.contextId === contextId && unresolved(row)`；不能把 #437 的 PR intent 解释成 Start Work receipt。恢复函数另限定 `commandName === 'startWork'` 且 operation 为 startRun/startFallbackRun，再核对 workspace/context、ownerGeneration、原执行 binding、fallback 与 run 身份。需要读取时沿原 binding 的 ExecutionRunRead 门调用 getRun，I/O 在事务外；引用必须逐字相等且状态为既有已知枚举才可 Reconciled。落账时在短事务重新比较 attempt/intent、context generation 与完整 run 快照；变化则重读本地结果，不能覆盖后继。恢复成功、竞争者已成功以及原 finalizer 观察后继这三条可能 confirmed 的路径均复用既有 Ready 工作树验证；执行 run 确认不能替代完整 Start Work 的工作目录确认。

intent 已提交但无持久 run/ref、首次 run 写失败、getRun not_found/denied/throw/unknown/错 ref，都不能证明外部未执行。保留原操作目标与 main/fallback 事实，报告 Unknown/degraded，禁止第二次 start/自动 fallback。正在等待原 owner 的确切 in-flight 路径可报 Pending；模拟崩溃后无法证实 dispatch 的恢复路径明确 Unknown。普通查询保持纯本地只读。

放弃新增 receipt 表、intent ack 字段和第二份 run 身份，因为现行 run 行已足够且会与 #437 共享持久契约。放弃延长租约、扫描 Host session 无匹配后重建、给 SessionPort 发明幂等参数；现有 ABI 不能提供这种证据。不纳入 #458 的非 running fallback 展示规范化；现行确定结果保持，但所有本次存储失败/Unknown 路径保留实际已知句柄。

## Global Constraints

执行分支 `fix/start-work-execution-recovery`，工作树 `.worktrees/start-work-execution-recovery`，基底 main；#193 owner 独占执行架构单元。代码目标 395–570 changed lines，文档约 160–240，硬限见交付门。#437 不修改这些文件；#421 完成 #193 后才在同单元落必要修正。

允许文件集只在此声明：`packages/core/src/start-work.ts`；必要时新 `packages/core/src/start-work-execution-recovery.ts`、窄改 `packages/core/src/execution-run.ts`、`packages/core/src/execution-context.ts`；新 `tests/integration/start-work-execution-recovery.test.js`；`tests/integration/start-work-external-intent.test.js`、`tests/integration/start-work-sqlite-registration.test.js`、`tests/integration/human-execution-provider.test.js`、`tests/e2e/start-work-recovery.test.js`；本计划的 active/completed 路径；`docs/exec-plan/completed/2026-09-24-start-work-recovery.md` 的原 resumability 声明；`docs/README.md` 由协调者串行登记。禁止修改 capabilities/storage DTO/schema、Provider/Host ABI、其他 runtime-access 栈、规划字段。新增 helper 仅在避免重复 exact-ref/快照规则时使用。

所有命令在本节指定分支的工作树根目录运行；使用 Node 26 与仓库锁定的 pnpm 10.28.2。先核对 `node --version`、`pnpm --version`，执行 `pnpm install --frozen-lockfile`。本地验证只证明对应检出；不代替最终 hosted checks、真实 GitHub 写入、人工 Desktop UAT 或 Gate R1。Git 操作经 subprocess argv/library 调用，不拼接 shell；工作树路径先 realpath 并确认处于 `.worktrees/` 下。

## Plan of Work

### Batch 1 · 持久 ack 与原 receipt 收敛

最小闭环：run 回执已提交而最终 receipt 失败后，重启能观察同一个 run。主文件 `packages/core/src/start-work.ts` 与新恢复集成测试。先写 Fake/SQLite 参数化 RED：注入最终 receipt 写失败，要求 run 仍持久；旧实现应因原事务回滚而失败。另写已知 ref 的 unknown ack 读回 running 后结算原 receipt 的 RED。每个注入断言命中次数恰好 1。实现独立 run journal、receipt-only 终结与事务外恢复入口。验证 `pnpm test:file tests/integration/start-work-execution-recovery.test.js tests/integration/start-work-external-intent.test.js tests/integration/start-work-owner-fencing.test.js`，期望新行为先 RED 后 GREEN、fail 0。回滚本批补丁，保留数据库与外部 run。

### Batch 2 · 重启、拒绝与迟到读闭环

最小闭环：不确定性、权限和并发不能因恢复而被抹掉。主文件为恢复测试、SQLite registration 与 E2E recovery；只有重复规则需要时窄改现有 run helper。补下面验收表的负例，更新旧计划原 resumability 文案并原处标注 Superseded 到本计划。运行 `pnpm test:file tests/integration/start-work-execution-recovery.test.js tests/integration/start-work-external-intent.test.js tests/integration/start-work-owner-fencing.test.js tests/integration/start-work-sqlite-registration.test.js tests/integration/execution-run-refresh.test.js tests/e2e/start-work-recovery.test.js`，期望全 pass。回滚完整 PR 不删除已存在的 run/工作树。

交付前运行 `pnpm run typecheck`、`pnpm run boundaries`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`；Git argv 执行 `git diff --check origin/main...HEAD`，期望全部退出 0；另外按新增+删除重新核算任务硬限，代码/测试/配置严格 <800，文档严格 <1300，仓库默认 size 通过不代表任务硬限通过。提交前人工检查凭据、本机身份、个人信息、内部系统、保密字样。整理成可独立审阅提交，再创建/更新 draft PR，英文描述含闭环、计划/Batch、Closes/Refs、真实证据、风险、回滚。最终 push 后使用 `gh pr view --repo SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup,mergeStateStatus` 与 `gh pr checks --repo SingularityKChen/harness-projects` 回读当前分支 PR；再按返回 number 用 GraphQL 回读全部 reviewThreads（分页至结束）。期望 head/base/关联正确，当前 head 必需 checks 通过且无未处理阻塞意见，之后才 ready。只请求人类评审，不自行合并，不修改 Planning Status/native blocking 字段。

## Validation and Acceptance

| 验收 | 判定证据 |
|---|---|
| ack 后 receipt 故障不丢回执 | main/fallback × Fake/SQLite；真实 SQLite close/open、Fake export/import；同 key/new key 都同 ref，starts=1，原 receipt 收敛 |
| 首次 run 写失败或真正丢 handle | Unknown/degraded；原 binding/operation 保留；无 ref 时 getRun=0，后续 starts=0；primary ambiguous 不进入 fallback |
| 冷读可信 | running/succeeded/failed 等已知状态可收敛；denied/not_found/throw/foreign ref/未知状态均不确认、不重建 |
| 迟到回复不覆盖后继 | getRun barrier 后改变 generation/ref/receipt；恢复完成后全快照不变；barrier 恰中 1 次 |
| journal 后不会覆盖新 run 状态 | final receipt barrier 时刷新或取消 run；释放旧结算后保留新状态/同 ref；临时恢复旧的 run+receipt 同事务实现时首项 RED，临时让终结重写旧 run 时此项 RED |
| 跨命令 intent 隔离 | listMutationAttempts 的读取 fixture 混入同 context 的非 startWork receipt，Start Work 不返回它的报告、不恢复它；组合 #437 后用真实 typed PR receipt 重跑 |
| 身份/可见性守卫不倒退 | 同 key 异 actor/输入、redacted、binding changed 在任何恢复写前拒绝；确定未 dispatch 的正控仍可继续 |
| 原计划声明准确 | 原文原处列出有 ref 可恢复、无 ref 明确 Unknown 的边界，不声称全局 exactly-once |

## Progress

- [x] (2026-11-02 Asia/Singapore) 独立审查两方案与拥有源码，确定现行 run journal 方案。
- [x] (2026-11-02 Asia/Singapore) Batch 1：8 条 Fake/SQLite × main/fallback 用例先 RED（0 pass / 8 fail），实现后 GREEN；原子 run+receipt 变异的 4 条 journal 用例全 RED。
- [x] (2026-11-02 Asia/Singapore) Batch 2 本地行为：66 条恢复用例；六文件聚焦回归 297 pass / 0 fail；加入 human provider 后七文件 305 pass / 0 fail。迟到读 12 道 barrier、最终 receipt 前 4 道 barrier 均断言恰中 1 次。
- [x] (2026-11-02 Asia/Singapore) `pnpm verify`：typecheck、2800 pass / 0 fail、MVP-0 7 pass / 0 fail；`pnpm run boundaries` 9/9。
- [x] (2026-11-02 Asia/Singapore) F1/F2 修复：68 条新增回归、七文件 373/373、全量 2868/2868 + MVP-0 7/7；原结论已在 Outcomes 与 Decision Log 就地订正。
- [x] (2026-11-02 Asia/Singapore) E1 异步边界：8 条 throw 回归 RED 0/8 → GREEN 8/8；受影响七文件 381/381、typecheck 通过。
- [x] (2026-11-02 Asia/Singapore) 独立规格与代码质量 PASS，F1/F2/E1 无未决；最终发布按 Plan of Work 的当前 head 门禁回读。

## Surprises & Discoveries

Ready 无 run 的 silent success 已被后续 readyGap 止血；这不等于已支持恢复。证据：现有 external-intent/owner-fencing 测试及 `start-work.ts` 的 replay/recordRun。旧测试明确把 fallback failed ack 结果规范化留给 #458，不在本 PR 偷换。

2026-11-02 独立评审推翻了「只保护恢复写者、最终只写 receipt 即足以收敛」的假设：原 finalizer 同代际仍能覆盖另一 Core 已 saved 的 receipt；恢复成功又因跳过 Ready 的工作树验证而先报假 Saved。现按根因补原 finalizer 的完整 receipt CAS，并在所有可能 confirmed 的观察路径恢复现有工作树守卫；不新增第二事实源。

2026-11-02 实施：旧 Ready 回归把无引用 pending 重放当作 Pending，现按持久证据改成 Unknown；未知 ack 的负控同时让 getRun 返回未知状态，正控单独证明读回 running 可收敛。非 running fallback 的首次确定结果维持原展示，但 run journal 保留合法 ack 引用；这是存储失败后能保留句柄的必要条件。

## Decision Log

2026-11-02 / 独立评审协调者：本会话人类直接指示“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续”，并列明“re-review → 归档 ExecPlan → … → merge_method=rebase 合并”；此条件授权具体覆盖 #490、#491、#492、#495。#490 当前全矩阵无新增 P0–P3，独立证据见 [本轮报告](../../review/2026-11-02-pr-490-independent-mmp.md)。每个最终 head 仍须当前批准、真实 CI 与线程回读；不改 Planning Status 或原生依赖。

2026-11-02 / 独立规格评审：用现行 run 行先记 ack，最终只结算 receipt；理由是避免第二事实源、保留新 run 状态并保持 #193/#437 文件所有权互斥。恢复不释放无引用的未决槽位；理由是时间和 not_found 不能证明外部未发生。

2026-11-02 / 协调者批准窄扩文件集：`human-execution-provider.test.js` 的非 running fallback 行原来要求 providerRef 不存在；合法 ack journal 必须保留原签发者身份，因此只把该行 binding 期望改为真实 fallback binding，并保留 Failed 状态、首次确定结果与 fallback 展示（#458 不变）。

2026-11-02 / 独立评审 F1/F2：原 finalizer 和恢复写者必须同时遵守 receipt 快照前置条件；否则 journal 后的合法跨 Core 观察会被迟到 Unknown 覆盖。所有可能 confirmed 的恢复结果必须走现有 Ready 工作树读回，只有 uncertainty 可使用本地快速投影。取代初稿隐含的「receipt-only 已足够」结论；新增 Fake/SQLite × main/fallback 后继 saved/failed/unknown、applied/stale-success/finalizer 的工作树不存在、错分支、权限拒绝、不可用与健康正控。

2026-11-02 / 独立复评 E1：恢复后的 Ready 工作树 I/O 可能抛异常；applied 与 stale-success 分支必须在既有 try/catch 内 await 结果，才能沿 uncertainty 投影返回 Unknown/degraded，保留已知句柄与已结算 receipt。只补这两个异步边界，不扩大既有 Start Work 全局异常语义；8 条 Fake/SQLite × main/fallback × 两分支用例先全部 RED，窄修后 GREEN。

## Idempotence and Recovery

重放读取可重复，原 intent 身份不改写，未知操作不会再次 dispatch。run journal 首次写失败只能报告不能持久的事实，不能承诺恢复丢失引用。撤销整个 PR 后现行 schema 仍认识 run 行；不删除数据库、外部 run 或工作树。若发现新的必要延期，记录到 `docs/exec-plan/tech-debt-tracker.md`；未知引用正向发现属于未支持 ABI，不伪装成本闭环已解决。

## Interfaces and Dependencies

依赖已存在 #194 请求身份、#204 pending intent、#420 owner fence、ExecutionProvider.getRun；不改接口。内部恢复 helper 可接受 CoreContext 与原 MutationAttemptRecord，返回可观察的既有 StartWorkResult；不可接受来自 UI 的 providerRef。AWS 官方幂等设计只支持“同请求参数和迟到结果必须显式记录”的原则，不证明本 Host 有服务端幂等：`https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/`。

## Outcomes & Retrospective

**独立验收订正（F1/F2）**：下列首轮全绿只覆盖作者已写场景，不能证明跨 Core 原 finalizer 与恢复后的完整 Ready 条件。独立 review 在 `e24a977` 上发现 2 个 P1，本轮新增 68 条永久回归；其中先写的 52 条在旧实现全部 RED，修复后七文件聚焦 373/373。本轮最终 `pnpm verify` 为 typecheck、2868/2868 与 MVP-0 7/7；边界 9/9。删除 finalizer CAS、跳过 recovered Ready、跳过 finalizer 观察 Ready 三项变异分别 12/12、40/40、16/16 RED，逐字恢复后恢复文件 134/134 GREEN。新不可变 head 见本轮报告，当时仍须独立复评。Superseded by 本节下方最终独立验收记录（2026-11-02）。后续 E1 指出新增 getWorktree 抛错会越过直接 return Promise 的 catch：两处局部 await 修复后，异常回归 8/8、七文件聚焦 381/381、typecheck 通过。此窄轮按协调者指定不重复未改动的全量，最终组合全量由协调者执行。

实施基底为 `554e6fefb1ad9781becf879b9f96e367e9f6ceff`，计划起点为 `afcfd1d`。本地六文件聚焦 297/297、边界 9/9、typecheck 通过；原子事务、终结重写 run、缺 commandName 三次变异分别 4/4、4/4、2/2 RED，逐字恢复后再跑 GREEN。追加迟到读报告的 RED 为 2 pass / 10 fail：旧结果把已失去证据的 pending receipt 当作仍在途，修正后既保留全快照，又明确 Unknown/degraded。首次 full verify 为 2799 pass / 1 fail：`human-execution-provider` 的旧断言要求非 running fallback 丢弃持久引用，与 journal 保留合法 ack 要求冲突；协调者批准窄范围订正后，最终 full verify 为 2800/2800 加 MVP-0 7/7，七文件聚焦 305/305。Node 26.12.1 / pnpm 10.28.2；锁定安装通过（仅已有 esbuild 构建脚本忽略提示）。首轮尚未验证 hosted CI、人工 Desktop UAT 与 Gate R1，曾待协调者验收后归档。Superseded by 本节下方最终独立验收记录（2026-11-02）；人工产品与 R1 边界保持。设计无新增接受的技术债。

2026-11-02 最终独立验收在 `1039beff9a97ba4c2d85067db3300f94b6b009c7` 上完成，规格与质量均 PASS；完整矩阵及八项正式 killedBy 变异见 `docs/review/pr-490-mmp-review.md`。协调者在检出 `fix/start-work-execution-uniqueness@6c788e9` 的工作树根运行本计划七文件加 `tests/integration/start-work-execution-uniqueness.test.js` 的 `pnpm test:file`，410/410、零跳过/取消，确认本层最终两个 await 与上层证明组合。最终远端 gate 用 Plan of Work 的命令回读，不用旧 head 绿灯替代。无新增接受延期的技术债。

## Bottom Change Note

2026-11-02：综合独立方案 A/B，补 receipt-only 终结、并发刷新负例、实际 owner 边界与诚实的无引用恢复限制；独立评审 F1/F2 推翻原 finalizer fencing 与 confirmed 投影假设后，补双向 receipt CAS 和全部 confirmed 路径的 Ready 校验。

2026-11-02：独立最终验收完成后归档工程闭环，旧失败/待父层结论原处标注 Superseded，最终发布依当前 head 回读。

2026-11-02：加入本轮独立 MMP 全矩阵与直接条件合并授权；原工程计划保持 Completed。
