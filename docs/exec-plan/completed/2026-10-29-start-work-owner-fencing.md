# Start Work 持久 owner fencing ExecPlan

> 状态：Completed；创建：2026-10-29（Asia/Singapore）；关联：Closes #420，Refs #304 / #421。
> 规范：`PLANS.md`；只保证陈旧 owner 不覆盖耐久本地事实，不保证外部执行唯一。

## Purpose / Big Picture

旧 Start Work 调用即使仍存活、迟到收到 Provider ack，也不能在租约过期接管后覆盖新 owner 的 context、关系、run 或 attempt。操作者得到诚实的所有权丢失/结果未知及已 ack 句柄，不看到假 Saved，也不自动触发第二个 fallback。

最小证据是 Fake/SQLite 的 live-old-owner barrier：推进注入时钟、后继 claim 完成、释放旧 owner 后赢家完整业务快照不变；另有 Ready 后 run 与迟到验证降级的独立反例。

## Context and Orientation

在检出 `fix/start-work-owner-fencing` 的工作树根运行（`.worktrees/start-work-owner-fencing`）。2026-10-29 基线 `06d929017c8551e6b106fcbe7651f12ac26e4642`；执行前用 `git rev-parse HEAD`、`gh issue view 420 -R SingularityKChen/harness-projects --json state,body` 重核。

`packages/core/src/start-work.ts` 仅用 `provisioningStartedAt` 判断 30 秒租约；step 的 saveContext、最终 settle、主执行和人工备用 recordRun 没有 owner 比较。租约在 Ready 清掉，不能保护随后 run 写。`existingResult` await 验证旧工作树后直接 Ready→Failed，也可能覆盖后继事实。

持久记录契约在 `packages/capabilities/src/storage.ts`，Fake 保存与导出/导入由 `packages/providers/fake/src/storage.ts` 承担；SQLite 列清单/UPSERT 和解码在 `storage-execution.ts`、`storage-rows.ts`。现有 1–7 SQL 清单的 context 定义在 `003_control_facts.sql`；`migrate.ts` 从同一包内 SQL 推导完整 schema 并拒绝不匹配，发布前不自动升级旧库。

## Design / Spec

采用 context 上持久单调 `provisioningGeneration?: number`：每次真正 new、终态 resume 或过期 takeover，在认领同一事务内从当前值加一；无值视为未认领的 0，新 owner 从 1 开始。要求正的 safe integer，超界在任何写入前结构化拒绝，不能回绕。in-flight、existing、same-key replay 不增代。时间戳仅判断租约，generation 独立判断身份并保留到 Ready/Failed/Closed。

生产 claim 返回其期望 generation 并贯穿 provision、step、settle、startExecution、manualFallback 与全部 recordRun。统一私有短事务 helper 在同一 tx 读 current 并逐字比较 generation，再执行所有依赖写入；无值不能匹配任意 owner。step 回填、最终 context+tracks/has_worktree+attempt、主 run、ambiguous run、人工成功/失败 run 均使用此边界。路由拒绝结算必须在自己的 claim 事务用当时 current，不借外层旧记录写 Failed。

主执行与人工备用既有 run 的 owner 比较和读取也处于同一 owned tx，不把等待 root getExecutionRun 之后的后继 run 借作旧 owner 的成功。Provider I/O 保持事务外；调用下一外部步骤前可检查当前 owner 以停止已知陈旧工作，但不把这次检查当外部唯一性证明。Provider ack 返回后若 fencing 失败，不写旧 attempt 的 saved/failed、不删资源、不启动 fallback。返回固定所有权丢失的 conflict（尚无外部 ack）或 result_unknown（已有 ack），保留本调用实际 ack 的 branch/worktree/run 句柄。不要把 OwnerLost 伪装成磁盘 LocalWriteFailed，也不要把旧调用结果误称权威赢家状态。

`existingResult` 的 Ready 验证在 Provider 读取后，如需降 Failed，必须短事务复读并要求 generation、Ready 状态及 branch/worktree 身份仍与验证对象相同，才写入；否则返回重新读取的当前事实，不递归无限重试、不覆盖新 owner。未认领 fixture 的 undefined 只与同一未认领快照严格匹配。

选单调 generation 而非两稿倾向的 opaque token：事务已经串行化，递增无需信任可能复用的 ID source，能在同钟值/重启下排除 ABA。明确 safe-integer 范围弥补原提案对此的顾虑。放弃增加通用 Storage CAS：一个 orchestration owner 的读比写事务已足够，新增多端口会扩散职责。也不使用时间戳/idempotency key 当 owner 身份。

schema 在当前 baseline 增加可空 `provisioning_generation INTEGER`，CHECK 允许 NULL 或 1..9007199254740991 的 integer；Fake 同校验、导出/导入与 SQLite 关库重开保留值。optional 仅保留非 claim 记录夹具，不允许生产供应缺 generation。列映射不把 NULL 输出成伪 0。

明确将 `CURRENT_SCHEMA_GENERATION` 从 1 改为 2：新增所有权列是不兼容发布前基线，marker 提供明确拒绝而非仅隐式结构失败。独立验证旧 generation=1 完整含数据库被 generation 拒绝；另把缺列旧形状标成 2 或 0，仍应 schema_shape 拒绝，防止只靠 marker 假绿。两入口拒绝后 schema、全部行、账本及 user_version 完全不变。仍只保留原七份 SQL，不新增第八份迁移或兼容 ALTER 链，不放宽准入。

此 PR 不承诺 at-most-one 外部 start：takeover 可与已在途 Provider 调用交错，ack 丢失也未知。#421 外部唯一性、#204 耐久 intent、#193 对账和父 #304 继续独立。回滚代码不能让旧程序接管新库；使用匹配旧 artifact 和原库备份，保留新库作证据，不覆盖或自动搬数据。

## Global Constraints

精确写集：`packages/core/src/start-work.ts`、`packages/core/src/execution-context.ts`（仅 record factory 的 generation 保留）、`packages/capabilities/src/storage.ts`、`packages/providers/fake/src/storage.ts`、`packages/storage/sqlite/src/storage-execution.ts`、`packages/storage/sqlite/src/storage-rows.ts`、`packages/storage/sqlite/src/migrate.ts`（仅 generation 常量）、`packages/storage/sqlite/migrations/003_control_facts.sql`、`tests/integration/start-work-owner-fencing.test.js`、`tests/integration/start-work-sqlite-registration.test.js` 的实际事务故障注入与步骤回滚对照、`tests/contract/suites/storage-execution.js`、`tests/integration/storage-baseline-admission.test.js`、`tests/integration/migration-runner.test.js` 的当前世代断言、`tests/integration/execution-relation-write-schema.test.js` 的显式列 seed 与 schema 审计、`docs/adr/ADR-0016-start-work-owner-generation.md`、`docs/adr/README.md`、`docs/exec-plan/tech-debt-tracker.md` 的 TD-006 部分取代记录、本控制计划与 `docs/README.md` 生命周期索引。ADR 编号如实施前已被占用，先修订该精确写集再写，不能覆盖他人文档。

预计生产/SQL 220–300、测试及 fixture 300–450，总代码/测试小于 800、文档小于 1300。临近上限先复用 barrier/fixture、缩减非必要重构，不删 owner/run/schema 的判别性证据。没有新增依赖、公共命令 ABI、自动迁移或用户库修复。

同一 owner 串行 #349→#420，各自 main-based PR 优先；只有真实组合证明需要才选最小栈。保留用户 Iteration、Status、原生依赖；提前执行授权已存在，不申请或伪造新规划状态。所有索引由主控协调；`docs/exec-plan/tech-debt-tracker.md` 的 TD-006 局部 Superseded 记录仅由主控维护，保持 Open 与 #193 范围，本 owner 不并发编辑该文件。

本次授权评审收尾增加文档证据写集 `docs/review/pr-455-mmp-review.md`，不扩展产品实现范围。

## Plan of Work

### Task 1 · Batch 1：持久 generation 覆盖每个耐久边界

**最小闭环**：新 claim 获得单调身份，所有旧 owner 结算被拒且赢家不变。**涉及主文件**：`packages/core/src/start-work.ts`。

先提交本计划建立 draft PR，写最窄 RED。Fake/SQLite 各有 barrier+注入时钟，不 sleep：旧 A 分别停在 branch ack、worktree ack、最终 settle 前；推进超过 30 秒，B 用另一 key 经命令正常接管并完成，释放 A。快照比较 context/generation/handles、关系、run、所有 attempts、revision；包含命中计数、无故障正控、租约内不接管和同钟值 generation 不复用。

Ready 后 run 的主/ambiguous/fallback 成功与失败分别在落账前换成后继 generation，证明不能只 fence Git 步或在 Ready 清空身份。若当前产品路径不允许在 Ready 缺 run 时正常 takeover，这些用例明确通过 Storage 契约安装后继持久 fixture，并标注只证明结算协议，不伪称当前 public command 可达或外部 run 数唯一；前述 live lease takeover 必须经真实 Core 命令完成。另用既有 Ready 的 getWorktree barrier，使后继 claim/status/handles 在迟到 missing 回读前提交，旧验证不能写 Failed。

增加契约 generation 边界/导出导入/SQLite 重开和两种旧库拒绝 fixture。RED 必须是 owner 覆盖或准入断言失败；安装/导入失败不算。实现 transaction helper、generation plumbing、SQL/映射/常量，写 ADR 的边界和重建后果，再重跑转绿。

所有命令在上述分支工作树根，先记录 head；先窄后宽，一次完整 verify 后无新风险不机械重复：

```sh
pnpm test:file tests/integration/start-work-owner-fencing.test.js tests/e2e/start-work-recovery.test.js tests/contract/storage-contract.test.js tests/integration/storage-baseline-admission.test.js
pnpm test:file tests/integration/start-work-request-binding.test.js tests/integration/start-work-step-recording.test.js tests/integration/start-work-sqlite-registration.test.js tests/integration/harness-plugin-artifact.test.js
pnpm run typecheck
pnpm run boundaries
pnpm verify
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD
```

期望 Fake/SQLite 新用例非零、全部通过；旧库双入口拒绝且全库不变，新库创建/重开成功；artifact 打包仍含当前七份 SQL；typecheck、boundaries、verify 退出 0；disclosure 无发现、实际 own-base code<800/docs<1300、diff 无错误。人工五类目扫描和 ADR/索引链接核对独立记录。真实用户库、模型和外部会话不用于本地实验。

与 #349 最终候选做临时组合预演，至少合跑 fencing、registration、request-binding、recovery；若需要栈，按实际各自 base 重算 diff/测试与回滚。整理计划/实现提交，push 后回读 `gh pr view -R SingularityKChen/harness-projects --json number,headRefOid,baseRefName,closingIssuesReferences,statusCheckRollup,isDraft`、`gh pr checks -R SingularityKChen/harness-projects` 和全部 review threads；不把本地验证当 hosted CI。独立复评通过及当前远端门满足才 ready，不合并。完成计划后移 completed 并修索引。**回滚**：revert 行为需匹配旧 artifact+原备份库；不覆盖新库，不自动降代、不删除分支/工作树。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 持久非复用身份 | new/resume 增代，replay/in-flight 不增；同钟值、重开、导出导入、safe-integer 边界 |
| Git 与最终事实 fence | live-old-owner 的 branch/worktree/final barriers 后赢家全快照不变，旧 attempt 不被结算 |
| Ready 后 run fence | 主/ambiguous/人工成功失败各路径拒绝旧 generation；ack 句柄保留且不启动新 fallback |
| 迟到验证不覆盖 | existingResult 旧 Ready→Failed 与后继 generation/status/handles 交错，迟到者不写 |
| schema 诚实拒绝 | gen1 旧库及伪装新代旧形状双入口拒绝不改数据；新代新形状创建/重开成功 |
| 边界和交付 | ADR 明确 #421，组合验证、RED→GREEN、公开面/规模与当前远端 head 独立证据 |

## Progress

- [x] (2026-10-29 +08) 独立审查两稿、live #420、Start Work 全写入边界和 Storage/schema；完成 generation 收敛计划。
- [x] (2026-10-29 +08) 已发布计划 `0721ba9dbb41` / draft PR #455 由主控建立；有效 RED 后完成 generation、全边界 fencing、schema 世代 2 及 ADR-0016 Proposed。
- [x] (2026-10-29 +08) 聚焦 479/479、typecheck、boundaries 9/9；完整验证发现 schema 消费夹具后按授权修正，schema/owner/baseline 197/197 通过；最终完整验证见 Outcomes。
- [x] (2026-10-29 +08) schema 消费夹具调整后完整 `pnpm verify` 2496/2496、MVP-0 7/7，0 fail/cancelled/skipped/todo。
- [x] (2026-10-29 +08) 独立评审的既有 run 复用 P1 经 RED 复现，owned read 修复后十文件聚焦 500/500、类型通过；新完整验证与复评分别记录。
- [x] (2026-10-29 +08) 四个候选在独立组合检出无冲突接线；修复后的组合聚焦 364/364、完整 2551/2551 与 MVP-0 7/7、生产 pack 通过，保持各 PR 的 main base。
- [x] (2026-10-29 +08) 独立完整验收及回读修复复评通过；最终代码/测试补丁与复评哈希匹配。公开面、生命周期和导航由主控整理，最终远端 head/checks/双向引用/全部线程按本计划回读达标才 ready；#421 外部唯一性未被接受。

## Surprises & Discoveries

独立结算评审在 `fcaa124e51b9` 复现主/人工两条 checkOwner→root getExecutionRun 窗口：旧 owner 可返回后继 run 的 Saved，即使没有改写任何事实。有效 RED 为 8 tests / 4 pass / 4 fail，Fake/SQLite × main/manual 的后继 fixture 均触发假 Saved；同 owner 的四个正控正常。修复将 owner 比较与 run 读取放进同一 owned tx，删除分离的冗余 precheck。测试在 tx 中仅等待 reader release；先释放读再等后继写，并只在 COMMIT 后等待 writer，避免持锁互等。它证明本地复用线性化，不把 Provider I/O 间隙当外部唯一性证据。

首次完整 verify 为 2496 tests / 2487 pass / 9 fail / 0 cancelled，全部来自 execution-relation-write-schema 的裸八值 INSERT 或遗漏新列的显式审计；本轮按授权列明旧八列、保留可空无主 generation、登记 AUDITED 的第 68 列并新增 raw CHECK 负控。schema/owner/baseline 197/197 后重跑完整验证；不把首轮失败省略或改门禁绕过。

首轮夹具误把 fallback 能力加到 primary 槽位，registry 会按角色扣下该 key，导致 fixture 等不到人工调用；改为真实 executionFallback 槽位后才取得有效 RED。执行契约的 generation 断言并入已有 context 闭环，无需修改用例条数门禁。有效 RED 的三文件结果 324 tests / 154 pass / 170 fail / 0 cancelled：24 条新 owner 反例均为旧 owner 覆盖或假 Saved，另含非法 generation 与预期 schema 世代差异，不含导入错误。

步骤和 run 落账进入 owned tx 后，registration 原 root-only 丢写注入不再命中；按主控授权同时包装实际 root 与 tx。步骤写后抛错现在整笔回滚，因此旧记录不保留本次未提交的 ack，Unknown 返回独立保留真实 Provider 句柄。首次类型验证命中 exactOptionalPropertyTypes，已通过局部 narrowed generation 消除伪 undefined 字段。

另经双存储确定性反例确认：branch ambiguous 且对账失败时没有可用句柄，owner 变化仍必须保持 Unknown/refresh。该小矩阵 RED 4 项 / 2 pass / 2 fail，修复不能只看句柄是否存在，还要保留已有 Unknown 阶段。

人工 run 两个落账分支统一经 localWrite 后，本地记录失败也返回 Unknown 并保留已 ack 句柄；专门故障测试证明这部分 TD-006 的改善。Ready 缺 run 与恢复/不确定结果对账仍由 #193 承担，不关闭整个 TD-006，不新增 tracker 写入。

Ready 会清租约而 run 仍可能等待，故租约 timestamp 不够。existingResult 自己也写 Failed，不能只 fence provision。现有 SQLite 准入从七份 SQL 派生完整结构，新增列可无需第八份迁移直接拒绝旧形状；显式增代还需相应旧 marker fixture，不得误把 version_list 断言变成仅 generation 拒绝。

## Decision Log

- Decision：主执行与人工备用的既有 run 复用也在同一 owned tx 比较 generation 并读取 run；删除与读分离的冗余 precheck，保留 localWrite 对 OwnerLost 的 Unknown/本次 ack 语义。Rationale：独立评审在 `fcaa124e51b9` 复现 checkOwner 后等待 root run 读时可借后继 run 假 Saved；本轮只补既有结果复用线性化，不新增端口或外部唯一性承诺。Date/Author：2026-10-29 +08 / 主控授权评审修复轮 1。

- Decision：显式旧八列 fixture 保留 NULL 无主 generation，schema AUDITED 增加 owner 整数列并把白名单数更新为 68；新增 raw CHECK 负控，不放宽未知列门禁。Rationale：首次完整回归 9 条失败定位为同一 schema 夹具：裸 VALUES 八值与新增列不匹配、白名单未登记该列。Date/Author：2026-10-29 +08 / 主控授权最小消费者更新。

- Decision：registration 故障注入同时覆盖 root 和 tx 方法，步骤落账已改为短事务时，写后抛错的步骤记录应回滚；Unknown 返回仍携带实际 Provider ack 句柄。Rationale：14 条旧回归失败来自注入未命中 tx 及旧的根写耐久假设，不能回退 fencing。Date/Author：2026-10-29 +08 / 主控授权最小测试扩展。

- Decision：当前世代变更同步更新 migration-runner 的字面断言，marked-wrong fixture 使用新世代以继续判别 version_list；路由拒绝 expired takeover 必须增代或拒绝旧 owner 的状态写。Rationale：基线消费者与已审读的迟到写路径不能漏项。Date/Author：2026-10-29 +08 / 主控授权最小测试扩展。

- Decision：按用户授权提前执行 #420，保留 Iteration/Status/原生边。Rationale：工程授权不改规划事实。Date/Author：2026-10-29 +08 / 主控转达、评审者记录。
- Decision：综合 A 的持久 fence 和 B 的全写边界审计，改选事务内单调 generation；保留 Ready，严格拒绝无主/旧主。Rationale：不依赖 UUID/clock/key 不复用假设，safe-integer 超界 fail closed。Date/Author：2026-10-29 +08 / 独立综合评审者。
- Decision：选显式 generation=2 加 shape-proof，不采用 A 的“可只留1”简化；不追加迁移。Rationale：发布前不兼容应清楚标识，同时证明错误标记也不能绕过结构准入。Date/Author：2026-10-29 +08 / 独立综合评审者。
- Decision：两稿独立保留；参考 SQLite 官方 `https://www.sqlite.org/lang_transaction.html` 的原子写事务和 etcd 官方 `client/v3/concurrency/mutex.go` 的 IsOwner 事务比较原则（repository `etcd-io/etcd`），仅借用比较与写同事务，不引入 etcd。Date/Author：2026-10-29 +08 / 独立综合评审者。

- Decision：外部写入 actor 为 SingularityKChen，目标为本仓 #420、GitHub Project #10 与 PR #455，关联键 `iteration-delivery-20261029:tracking-v1`；draft/Closes/反向引用、标签、milestone、assignee 与 ExecPlan/Batch 得到 ack 并回读。本次工具未写 Status、Iteration 或原生 blocked-by/blocking；期间发现外部规划字段变化，保留当前权威记录，不擅自回滚。Date/Author：2026-10-29 +08 / 主控记录。

- Decision：2026-10-29 用户在本会话直接授权评审 PR #445、#454–#456，且无 P0/P1 时“你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并”。本 PR #455 首轮完整评审无新增缺陷，故主控接手该分支的提交整理、最终复评和有界 issue 收尾；不重复请求 owner/merge 批准。Rationale：这是覆盖本 PR 的本次人类直接授权，优先于评审手册的默认逐次询问；有未修复 P0/P1 则不合并。原计划已经 Completed，本轮保留归档并将证据放入 `docs/review/pr-455-mmp-review.md`。Date/Author：2026-10-29 / 主控记录。

## Idempotence and Recovery

测试只用隔离库；每次 claim 只在成功事务提交后增代，回滚不占代。相同请求重放保留身份。OwnerLost 不写任何旧结算；一般本地写失败仍按既有 unknown/ack 规则，不用 fencing 覆盖磁盘错误。schema 变化仅空位置建新库，保留旧库备份和全部外部资源，恢复必须确认 artifact 与库代际匹配。

## Interfaces and Dependencies

现有 Storage transaction 是唯一原子域，helper 接受 tx/current/expected generation，禁止嵌套 tx 或根实例写。没有新 CAS port、ID 服务或运行时依赖。技术债按 `docs/exec-plan/tech-debt-tracker.md`；本任务不接受新债，#421/#204/#193 为既有独立能力边界，不把 #420 本地 fence 冒充父项整体完成。

## Outcomes & Retrospective

最终独立验收与组合结果：回读 P1 修复的独立复评为 PASS，代码/测试补丁 SHA-256 `feb214c867ea40701a94ba7dc05c95f6e9bafca4f2e8a20447ef67627bcf31c6` 与候选 `4afb704fe3d0` 一致；本项完整 2504/2504、MVP-0 7/7、聚焦 500/500 和类型/边界证据完整。主控在检出 `test/iteration-security-integration` 的独立工作树根、组合 head `c5a51235a2cd`（基线 `06d929017c85`，四个 PR 产品源码的无额外修改组合）运行同组聚焦及 `pnpm verify`、`pnpm --filter @harness-projects/app-harness-plugin pack:plugin`：364/364、2551/2551 + 7/7、打包均通过。组合产物 SHA-256 `e221c37d7195fe65ec9bde873903da2e78a401805bda067a491b17fb544f33c0`；这是本地软件组合证据，非 hosted CI、安装走查或硬件测量。组合源可由 #445/#454/#455/#456 的 PR 公开头重建；本地观察 head 不冒充远端分支。

TD-006 仅将人工 run 普通 I/O 写失败已转为 Unknown 的部分原处标为取代；状态保持 Open，#193 的缺 run 对账未由本项完成。四个 PR 均保留 main base，无原生依赖写入；最终 head/base/checks/issue 双向关联和全部 review threads 通过实际 PR 回读后才 ready，不以此处本地验证替代。


本地实现与聚焦验证完成，等待独立审读和主控组合预演；计划保持 Active。 **Superseded by 本节最终独立验收与组合结果（2026-10-29）**；以下保留各候选的历史验证。

- 基线 `main@06d929017c85`；保留主控已发布计划 `0721ba9dbb41`。本项未引入 #349 的代码，不推导技术依赖边。
- 真正 claim 事务递增正 safe integer，in-flight/replay/Ready 不增代；Ready 后保留 generation。route-denied 的过期接管增代后写 Failed，旧 owner 不能恢复它。
- owner 比较和步骤/final/run 写在同一短事务；迟到 Ready 验证比较 generation/status/handles 后才降 Failed，失败则只重读一次本地事实。OwnerLost 有 ack 或原本 Unknown 时返回 Unknown/refresh，未 ack 时 conflict。
- Fake/SQLite 新 owner 矩阵 42 条，含真实命令接管、协议 fixture、代际持久化/耗尽及人工 run 本地失败；修复后主聚焦十文件 500/500，类型 exit 0，boundaries 9/9。旧库 generation=1 及遮掩成 0/2 的旧形状由双入口拒绝且全库不变；schema 调整后局部 197/197。
- 原七份 SQL 维持不变更数量；新增 owner 列并显式标记世代 2，无自动升级、数据删除或第八份迁移。ADR 保持 Proposed，未声称 Gate E1/R1 通过。
- 首次完整回归的 9 个 schema fixture 失败已逐项记录；修复后的完整 `pnpm verify` exit 0：2496 tests / 2496 pass / 0 fail/cancelled/skipped/todo，MVP-0 7/7；此前 typecheck 与 boundaries 9/9 也通过。外部 start 唯一性、pending intent、重启对账和 TD-006 未覆盖部分分别保持 #421/#204/#193 既有边界；hosted CI、远端最终 head/threads 和人工验收不由本地证据代替。
- 验证后人工逐项复核凭据、本机身份/路径、账号信息、内部系统和保密内容；本地提交的公开面仅含自包含文档与隔离测试值。最终机械 disclosure/size/diff 以提交后精确 head 回读，不把暂存区当成已审远端。

### 独立评审修复轮 1

旧候选 `fcaa124e51b9` 的耐久写 fencing 已获评审证据，但运行结果复用漏了读取边界。当前主执行和人工备用的 getExecutionRun 在 owned tx 内，localWrite 保留旧调用自身 Git ack/Unknown，不返回后继 run 句柄。没有新端口/Provider/依赖或外部唯一性承诺。新屏障矩阵 8 条含 4 个无后继正控；十文件聚焦 500/500、typecheck exit 0。修复后新完整 `pnpm verify` exit 0：2504/2504，MVP-0 7/7，0 fail/cancelled/skipped/todo；独立复评与主控组合重算仍待。 **Superseded by 本节最终独立验收与组合结果（2026-10-29）**。

## Bottom Change Note

- 2026-10-29 +08：归档链接检查发现 ADR 仍指向 active 路径，更新到 completed 后重新执行全部改动文档链接检查。

- 2026-10-29 +08：独立复评和固定源码组合验证通过，主控归档计划/导航并记录 TD-006 已证实的局部取代；未扩大外部执行唯一性或人类发布验收。

- 2026-10-29 +08：综合两稿并补足 Ready/run、迟到验证及旧库风险，选事务递增 generation 与显式不兼容代际，保留 #421 唯一性边界。

- 2026-10-29 +08：完成 TDD 的 generation 全写边界与诚实 Unknown，修正真实事务故障夹具和 schema 消费白名单，保留完整失败记录与待独立/组合验收边界。

- 2026-10-29 +08：按独立结算评审补主/人工运行复用的原子 owner 读取，保留实际读/写线性化与外部唯一性的区别，新增双存储正反控。

- 2026-10-29：追加本次人类授权、独立全矩阵评审与收尾证据引用；源代码变异已还原，无未修复新缺陷。
