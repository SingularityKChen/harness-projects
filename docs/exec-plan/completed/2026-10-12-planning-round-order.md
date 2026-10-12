# Planning 全量同步轮次顺序 ExecPlan

> 状态：Completed
> 创建：2026-10-12
> 范围：修复 #305 的全量 Planning snapshot 乱序提交；不改 #303 的状态写入路径，不改 #273 的状态拥有策略。
> 上游输入：`AGENTS.md`、`PLANS.md`、`docs/development/workflow.md`、`docs/architecture/ADR-0003-events-are-not-the-correctness-mechanism.md`、issue #305。

## Purpose / Big Picture

同一工作区和 Planning binding 的两轮全量读取可能重叠时，较旧的读取不能在较新的读取已经提交后再次替换投影、成员关系、业务 revision、同步健康度或对账时刻。较新轮次失败时，系统也不能用较旧成功轮次伪装成最新 fresh。

最小成功证据是：Fake 与 SQLite 在 `bootstrapWorkspace` 入口上运行 barrier 竞态；新轮次内容提交后，旧轮次返回 `superseded`，新内容和 revision 保持；跨 workspace 同一连接的轮次互不阻塞；失败策略由文档和测试固定。

## Context and Orientation

`packages/core/src/bootstrap.ts` 的 Provider 全量读取发生在事务外，`commitSync` 只在提交事务中读取当前 projection/revision，然后直接替换。Fake Storage 与 SQLite 都会把 Storage 事务串行化，但后提交者仍可能是较旧的 Provider snapshot，因此“事务串行”不是“snapshot 按启动顺序提交”。现有 `SyncCursorRecord` 记录 provider cursor、state 和错误，`ReconcileCursorRecord` 只记录最后成功对账时刻；两者没有独立的 round identity。

issue #305 要求 workspace/Planning-mount scoped ordering，而 #134 负责调度。本批只修已经可调用的 `bootstrapWorkspace` commit 机制，不新增 scheduler。#303 已单独使用事务内重读解决状态写入陈旧行，不能用一个 PR 代替本批。

## Design / Spec

### 方案比较

1. **持久 round token + commit-time CAS（推荐）**：读取开始时在短 Storage 事务内分配 `(workspaceId, bindingId, scopeKey)` 的单调 round token；Provider IO 在事务外进行；提交时只有 token 仍等于最新启动 token 的轮次可写入。优点是提交资格由 Storage 事实拥有，跨同一 Storage 实例的 Core 组合仍能判定；失败和 takeover 有明确状态。代价是需要独立 round 状态接口/表，不能复用 provider cursor。
2. **仅 Core 进程内 WeakMap/single-flight**：改动小，但两个 Core 进程、重启或共享 SQLite 文件时旧进程仍可覆盖新进程，不满足事实所有权边界。放弃。
3. **只比较 currentRevision/row revision**：能防止部分写撕裂，但不能判断 Provider snapshot 年龄；旧读仍可能以更高 revision 覆盖新内容。放弃。

### 推荐方案的边界

- 增加独立的 `PlanningSyncRound` Storage 事实：scope 为 `(workspaceId, bindingId, PLANNING_SYNC_SCOPE)`，字段至少包含 latest started/committed round。
- `beginSyncRound` 在短事务内单调增加 token；不直接覆盖可见 sync cursor，也不持有事务/锁跨 Provider IO。
- `commitSync` 事务内读取 round state；token 不是 latest 时返回结构化 `superseded`，不改 projection、membership、observation、revision、health 或 reconcile cursor。
- 最新轮成功时，projection、membership、observation、revision、healthy cursor、reconcile cursor 同生共死。
- 最新轮失败时保留最后已知 projection，但 round state 变为 degraded/stale；旧成功轮不得在之后提交为 fresh。下一次新轮可 takeover。
- round state 不复用 provider `cursorValue`；不能把内部 token 暴露为 provider cursor。
- Fake 与 SQLite 共享同一端口语义；SQLite 新 schema 直接建立，不增加旧实验数据库兼容层。若实际迁移范围超过 PR 规模，先停在 plan-only draft PR，由人类裁决是否将 round table 随 #223 基线一起落地。

### 关键不变量

1. 每个 workspace + Planning binding + scope 同时只有一个 latest authoritative round。
2. superseded round 不改变 projection、membership、observation、business revision、sync health/freshness 或 reconcile time。
3. accepted round 的所有事实与 revision/health/reconcile 同事务提交。
4. 两个 workspace 共享同一 provider binding 时 round token、revision 与健康度完全隔离。
5. 最新轮失败不会被旧成功轮伪装为 fresh；最后已知内容可以保留但必须带 stale/degraded。
6. Provider IO 不在 Storage transaction/锁内执行；full reconcile 无事件仍然可运行。

### 独立设计与对抗审查

独立设计建议持久 token + commit CAS；另一份分析比较了进程内 single-flight、内存 token、submit-time CAS，明确指出它们不足以保护跨 Core/重启；独立对抗审查发现 #303 与 #305 不是同一闭环、token 必须按 workspace+binding scope 隔离，并要求显式记录“最新启动轮次失败、旧成功轮次拒绝”的策略。该结论最初决定本 PR 先以 plan-only draft 暴露 schema/owner 决策，再开始代码。**Superseded by** 2026-10-12 的实现批次：schema/owner 决策已在 ExecPlan 和 PR review 中收敛，随后已完成 Fake/SQLite 与 Core 实现。

## Global Constraints

- 目标 PR 代码改动 ≤800 行，文档 ≤1300 行；任何 schema/port 变更先计算增删规模，超出则拆 stacked PR，不机械分割同一算法。
- 不修改 #273、#303、#134、#223 的 owner；不复用 provider cursor 字段承载内部 token。
- Provider IO 与 Storage transaction 分离；失败必须 fail closed，不能写 degraded 以外的假成功。
- Fake/SQLite 两适配器必须一致；测试从 `CoreApi.commands.bootstrapWorkspace` 入口施加 barrier。
- PR 使用分支 `fix/planning-round-order`，正文使用 `Closes #305`；实现与 required checks 完成后置为 ready，不合并、不改 Project Status。

## Plan of Work

### Batch 1 · 方案评审与 draft PR

**最小闭环**：把 round owner、持久 token、失败策略和 schema 规模暴露为可审阅的 ExecPlan，避免在未裁决的 Storage 接口上直接编码。

**涉及文件**：本 ExecPlan。

- [x] 在 worktree 中锁定 main，运行现有 `chain-bootstrap`、`sync-revision-freshness`、`workspace-sync-scope` 基线。
- [x] 提交本计划，推送分支，创建 draft PR，关联 `Closes #305`，并在实现验收后置为 ready。
- [x] 回读 PR base/head/closingIssuesReferences 和 issue closedByPullRequestsReferences；schema/规模决策已进入实现批次。

**验证**：

```sh
node --test tests/e2e/chain-bootstrap.test.js tests/integration/sync-revision-freshness.test.js tests/integration/workspace-sync-scope.test.js
```

期望：现有基线全绿；该基线不证明乱序安全，只证明方案分支在实现前未改变行为。

**回滚**：删除 draft PR 前保留本地 commit；不改任何数据库或 Project 字段。

### Batch 2 · 持久 round port/schema 与红灯

**最小闭环**：新增独立 round 记录，在 Fake/SQLite 先写出旧实现可复现的乱序红灯。

**涉及文件**：`packages/capabilities/src/storage.ts`、`packages/providers/fake/src/storage.ts`、`packages/storage/sqlite/migrations/`、`packages/storage/sqlite/src/`、相关集成测试。

- [x] 在方案收敛且增删规模仍在门禁内后新增 round port/table。
- [x] 增加 begin/finish/superseded 结构化结果；round key 按 workspace、binding、scope 完整定位。
- [x] 添加跨 workspace 和重启读回测试。
- [x] 在 core 代码前运行 barrier 红灯，确认旧 commitSync 会覆盖新 snapshot。

**验证**：

```sh
node --test tests/integration/storage-sync-surface.test.js tests/integration/workspace-sync-scope.test.js
```

期望：新 round contract 正向通过；乱序 core 用例在实现前失败且失败原因是旧内容覆盖。已完成并由 Batch 3 修复。

**回滚**：若 schema/port 规模超过 800 行，保留 plan-only PR，拆出独立 schema PR；不把半成品 round 字段合入。

### Batch 3 · commit-time CAS 与全量同步策略

**最小闭环**：`bootstrapWorkspace` 只允许 latest round 提交，并按明确失败策略结算。

**涉及文件**：`packages/core/src/bootstrap.ts`、`tests/e2e/chain-bootstrap.test.js`、`tests/integration/sync-revision-freshness.test.js`。

- [x] 开始 Provider 读取前分配 token；读取在事务外。
- [x] commit 事务内拒绝 superseded token，不推进 revision/health/reconcile。
- [x] latest-start-wins：最新轮失败写 degraded/stale；旧成功轮随后提交仍拒绝。
- [x] 保持重复同内容刷新不推进业务 revision；无事件全量对账仍收敛。

**验证**：

```sh
node --test tests/e2e/chain-bootstrap.test.js tests/integration/sync-revision-freshness.test.js tests/integration/workspace-sync-scope.test.js
node_modules/.bin/tsc --noEmit
```

期望：Fake/SQLite 全部通过；旧 round 不改新内容、revision、健康度或对账时刻。

**回滚**：反向提交 core + tests；round table 可保留但不再被读取，或按人类批准的 schema revert 处理，禁止静默删除已存在事实。

### Batch 4 · 对抗验收与 ready

**最小闭环**：完整证明 round owner、故障策略、边界与公开面。

**涉及文件**：本 ExecPlan、相关测试和必要 ADR。

- [x] 变异旧 token、交换 workspace/binding、让新轮失败、打乱行序/键序并复跑。
- [x] 运行相关 integration/e2e、typecheck、workflow/size/disclosure/diff-check。
- [x] 推送后回读 current head/base/checks/closingIssuesReferences/review threads；required `PR Fast Gate` 通过，PR 已置 ready。

**验证**：

```sh
node --test tests/contract tests/integration tests/e2e
node scripts/workflow-check.mjs
node scripts/rule-checks.mjs size origin/main
node scripts/rule-checks.mjs disclosure origin/main
git diff --check origin/main...HEAD
```

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 旧轮不能覆盖新轮 | Fake/SQLite barrier：旧轮 superseded，新内容保持 |
| 2 | superseded 不改 revision/health/freshness | 读回 projection、revision、cursor、reconcile timestamp 全不变 |
| 3 | 最新轮失败策略明确 | 新失败 degraded/stale，旧成功随后仍拒绝；无 fresh 伪装 |
| 4 | workspace/provider scope 隔离 | 同连接两个 workspace 并行各自提交正确内容 |
| 5 | 原子提交 | projection、membership、observation、revision、cursor、reconcile 任一失败整体回滚 |
| 6 | 重启/并发 round state 可读 | Fake/SQLite 重建实例后 round 事实保持，下一轮可 takeover |
| 7 | 既有 sync 语义未回退 | 重复同内容不推进 revision，现有失败/乱序观察用例全绿 |

## Progress

- [x] 读取当前 main、#305、#303、#134、同步代码、Storage 端口与迁移事实。
- [x] 完成独立设计与对抗审查；选定持久 round token + commit CAS 作为推荐方案。
- [x] 创建隔离 worktree并完成实现前基线。
- [x] Batch 1 方案评审与 draft PR 已完成，随后进入实现。
- [x] Batch 2–3 实现与判别性 barrier 验证已完成；旧失败轮晚于新成功轮的 Fake/SQLite 反例已补齐。
- [x] Batch 4 相关测试、typecheck、规则检查与 PR 状态回读已完成；当前 head 已复评 APPROVE。
- [x] 评审复评补充共享 Planning provider 下两个 workspace 并发 round ordering/隔离测试（Fake/SQLite）。
- [x] 对 commit-time superseded guard 运行带 `killedBy` 的 `review-mutate`：删除 guard 后 4 个乱序用例变红，结果为 `KILLED`，变异文件已恢复。

## Surprises & Discoveries

- 2026-10-12：Storage 事务串行化只保证写入顺序，不保证 Provider snapshot 年龄顺序；#305 的核心缺口是提交资格，不是 SQLite 锁。
- 2026-10-12：复用 `cursorValue` 承载 round token 会混淆 provider cursor 与 Host round owner，明确禁止。
- 2026-10-12：仅进程内 token/single-flight 无法证明跨 Core/重启安全，因此不作为最终方案。
- 2026-10-12：实现完成后，Fake/SQLite round/ordering/restart/validation 用例与相关回归共 126 项通过；required `PR Fast Gate` 通过，PR #318 已置 ready。自动 `Create review session` 因 runner 上本地 DSH endpoint 不可达失败，但不是分支保护 required check。
- 2026-10-12：对旧失败轮先读 round token、随后新轮成功、最后旧轮写 degraded 的对抗测试复现了健康度污染；`fail()` 必须在同一 Storage transaction 内重新校验 round 并写游标。
- 2026-10-12：补充最新失败轮与旧成功 snapshot 的反例、Fake/SQLite round 状态重启后 takeover、`latestCommittedRound <= latestStartedRound` 值域约束、started/committed 单调回退拒绝，以及 transaction-scope 读计数；这些用例先在对应旧实现变体上失败，再在当前实现通过。

## Decision Log

- 2026-10-12：#305 单独成 PR，不与 #303 合并；两者共享投影但 owner、失败路径和测试夹具不同。
- 2026-10-12：选择 latest-start-wins；最新轮失败后，旧成功轮不得冒充 fresh。理由是失败必须可见，旧快照不能代表最新读取。
- 2026-10-12：先发布 draft 让 schema/round owner 成为人类可审阅决策点；方案收敛后继续完成实现，并在 required checks 通过后置为 ready。原 plan-only 叙述由当前实现与复评证据取代。
- 2026-10-12：失败结算采用 transaction-scope round check + cursor write；旧 round 不得覆盖新 round 的 healthy/degraded 结果，避免把 token 读取与游标写入拆成两个事实窗口。Storage round writer 同时拒绝 started/committed token 回退，保持事实拥有者的单调性。

## External Research and Decision Rationale

### 研究证据

- **etcd v3 API**（官方）：store revision 是单调逻辑时钟；事务可按 key 的 revision/version/value 做原子 compare-and-swap；旧 revision 可用于历史读取和 watcher 续接。来源：<https://etcd.io/docs/v3.4/learning/api/>。
- **Kubernetes Coordinated Leader Election**（官方）：使用对象 `resourceVersion` 做乐观并发控制，只有携带当前版本的更新成功；版本不匹配时拒绝旧写。来源：<https://kubernetes.io/docs/concepts/cluster-administration/coordinated-leader-election/>。
- **Amazon S3 conditional requests**（官方）：以 ETag/版本前提约束写入；对象已变化时条件写失败，避免不知道当前状态时覆盖对象。来源：<https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-requests.html>。
- **Google Cloud Storage request preconditions**（官方）：generation/metageneration 作为持久对象版本前提，读取到的版本必须匹配才允许后续写。来源：<https://docs.cloud.google.com/storage/docs/request-preconditions>。
- **Martin Kleppmann fencing tokens**：租约过期或进程暂停后，旧持有者仍可能迟到写入；必须由受保护资源校验单调 fencing token，单纯进程锁或 TTL 不足。来源：<https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html>。
- **TanStack Query cancellation**：请求变为过期/非活跃时通过 AbortSignal 取消；这减少无用工作，但不能替代服务端提交点的版本校验。来源：<https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation>。

### 权衡

- 仅进程内 single-flight 或内存 token 只能减少同一 Core 实例的浪费；它们无法保护重启后仍在返回的旧进程，也无法让 SQLite 的第二个连接拒绝旧提交。因此不采用。
- 只比较当前业务 revision 或 row revision 只能发现“提交时状态变了”，不能证明 Provider snapshot 的年龄；它不能阻止旧 Provider 读在新读之后覆盖内容。因此不采用。
- 把 round token 复用 `sync_cursor.cursorValue` 会混淆 Provider 游标和 Host 提交资格，违反一个字段一个事实语义。因此不采用。
- `latest-start-wins` 会在新轮失败时牺牲一部分可用性：旧成功读也被拒绝；但当前 Provider full-read 没有可比较的 authoritative source version，`last-success-wins` 会把旧内容错误地标成最新 fresh。按 etcd revision、Kubernetes resourceVersion、S3/GCS conditional write 和 fencing token 的共同原则，安全优先于用旧快照填补新轮失败。

### 最终决定

采用 **持久 workspace + Planning binding + scope round token，提交时 CAS，latest-start-wins**；但 round ownership 与可见 freshness 分离：begin round 不直接把既有成功 cursor 改成 `syncing`，避免在途或失败轮次覆盖最后一次成功/失败的可见语义。

1. begin round 在短 Storage 事务中递增 token；可见 sync cursor 保持最后一次已结算结果，直到该 token 成功或失败结算。
2. Provider IO 在事务外进行；commit 事务只接受仍等于最新 token 的轮次。
3. superseded round 返回 `stale_revision`，不改变 projection、membership、observation、business revision、health 或 reconcile time。
4. latest round 失败时保留最后已知内容，写 degraded/stale；旧轮即使随后成功也不能越过 token 提交。
5. SQLite/Fake 共享 round 端口；round 事实独立于 provider cursor，并在重启后可读。

### 实现修订

2026-10-12 的第一版本地 spike 曾在 begin 阶段把 `sync_cursor.state` 写成 `syncing`，导致既有结构化失败的 `unavailable` 被读侧显示为 `syncing`，并破坏“最后一次成功/失败结果保持可见”的现有测试契约。该 spike 未提交、未推送、已删除。最终实现必须把 round owner 与 sync cursor/freshness 分成两个结算面：只有 latest round 的成功/失败结算才更新可见 cursor；superseded round 不更新任何可见 freshness。

## Idempotence and Recovery

begin round 是同 scope 的单调分配；重复 finish 同 token 必须幂等。superseded 只返回结构化结果，不写业务事实。失败可由下一轮 takeover；回滚代码不删除已写 round 事实。若 schema 规模超过门禁，保留 plan-only PR 并拆 schema PR。

## Interfaces and Dependencies

- `StorageTransaction`、Fake/SQLite shared sync surface。
- `bootstrapWorkspace` / `commitSync`、`PLANNING_SYNC_SCOPE`。
- SQLite migration runner、Node test、TypeScript、workflow/rule-check scripts。
- 人类对 schema/round owner 的评审与 #223 基线时间安排。

## Outcomes & Retrospective

实际结果：新增 007 schema、Storage round 端口、Fake/SQLite 实现，并补齐 round/ordering/restart/validation 及共享 provider 双 workspace 隔离用例；定向 planning-round-order + freshness/scope 套件 90 项通过，完整 `pnpm verify` 为 1490 contract/integration/e2e + 7 MVP-0 通过，typecheck、workflow/rule checks 和 required `PR Fast Gate` 通过。复评的 `review-mutate` 删除 commit-time guard 后 4 个乱序用例变红并被 `killedBy` 正确归因。PR #318 当前 head `19ea6d7d` 已 APPROVE；非 required 的 `Create review session` 因本地 DSH endpoint 不可达失败。
新增的双向失败排序、重启后 takeover、值域与单调回退约束、transaction-scope 读证据均有 Fake/SQLite 覆盖；旧实现变体能被这些反例击穿，当前实现通过。

## Bottom Change Note

- 2026-10-12：创建 #305 plan-only ExecPlan；基于实时 issue、3 份独立设计/对抗结论和当前同步/Storage 事实，先锁 durable round token + CAS 方案。
- 2026-10-12：方案获得实现证据后继续完成代码与 barrier 验证；修正文档中的 plan-only/Draft 旧状态，并记录非 required review-session 检查的 runner 环境失败。
- 2026-10-12：将 #305 从 plan-only 承接为实现 draft；补齐旧失败轮晚于新成功轮的反例，并把失败游标写入移入 round-check transaction。
- 2026-10-12：补齐双向失败/成功排序、round restart、值域验证和 transaction-scope 读证据；将本计划的 current-head 事实更新为等待人类评审。
- 2026-10-12：补齐重启后实际 takeover 与 Storage round token 单调回退拒绝，消除独立复评提出的两个 P2 证据/契约缺口。
- 2026-10-12：MMP 复评新增共享同一 Planning provider 的两个 workspace 并发读取；新 snapshot 先提交、旧 snapshot 后提交时，两个 workspace 各自保留自己的 round/projection/revision/reconcile cursor，Fake 与 SQLite 均通过。
- 2026-10-12：`review-mutate` 删除 `commitSync` 的 superseded guard 后，Fake/SQLite 旧成功轮及最新失败排序用例均变红；`killedBy` 命中旧轮拒绝用例，证明该 guard 不是装饰性代码。
