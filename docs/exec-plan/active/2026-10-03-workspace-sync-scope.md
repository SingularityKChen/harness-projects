# 工作区同步游标作用域 ExecPlan

> 状态：实施与验收完成，待人类评审。
> 创建：2026-10-03；关联 issue：[189](https://github.com/SingularityKChen/harness-projects/issues/189)。
> 分支：`fix/workspace-sync-scope`；工作树：`.worktrees/workspace-sync-scope`；PR base：`main`。
> 调度：P0 / M / 迭代 4（2026-10-08–14）/ M2.1 · 发布前事实所有权收敛。
> 本计划遵守根 `PLANS.md`，合并 Design / Spec 与实施计划；不得把设计通过写成产品验收通过。

## Purpose / Big Picture

同一连接可以挂在两个工作区。完成后，工作区 A 同步失败的原因和陈旧状态不会被工作区 B 的成功覆盖；只有 A 自己确认成功才能恢复 A。
最小成功证据是经 `composeCore` 的真实命令和查询，在两个 Storage 上运行 A degraded → B healthy → A 仍 degraded 的反例，并从 controller snapshot 看到一致结论。
本项收敛工作区同步事实，为 #221 的交付缓存作用域和多工作区宿主提供前提；不裁定 Gate E1 或 R1。

## Context and Orientation

连接锚点是 `provider_binding`：它表示一条可复用的 Provider 连接。工作区挂载是 `workspace_binding`：它表示工作区启用该连接的某个能力域。
`docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md` 已把两者分开；工作区健康状态不能按连接锚点单独存储。
同步游标是一次同步的当前位置与状态。实施前（`68524a0`）`SyncCursorRecord` 没有工作区，`getSyncCursor(bindingId, scopeKey)` 也没有工作区参数；实施后的形状见 Design / Spec。
`packages/core/src/bootstrap.ts` 在成功事务和失败结算里写游标；`packages/core/src/queries.ts` 的 `syncSummary` 从它派生列表和详情 freshness。
`packages/providers/fake/src/storage.ts` 的内存键与 `packages/storage/sqlite/migrations/003_control_facts.sql` 的 SQL 主键当时都只有 `(bindingId, scopeKey)`，所以两个实现都有串台。
SQL 列清单和映射在 `packages/storage/sqlite/src/storage-sync.ts`、`packages/storage/sqlite/src/storage-rows.ts`。
`tests/contract/suites/storage-sync.js` 是共享同步契约；`tests/contract/storage-contract.test.js` 注册它并锁定断言台账。
观察账本表示连接收到的外部对象版本，仍按连接去重；它与工作区同步结果不是同一种事实。

独立调查锁定在 2026-10-03 的 `2b51a1b`；本轮文档检出随后快进到 `68524a0`，两者产品代码相同。
执行前在本分支工作树根目录重读 `git rev-parse HEAD main origin/main` 和 `git status --short --branch`，不得把观察提交当作未来 head。
两名独立设计者分别调查作用域/端口与故障/恢复；第三名独立 reviewer 读代码、对比两方案并形成这份最终 spec。原始临时设计不作为仓库依赖。

## Design / Spec

### 最终键与唯一事实源

给现有记录增加必需工作区，直接修最终端口，不维护旧形状：

    interface SyncCursorRecord {
      readonly workspaceId: WorkspaceId
      readonly bindingId: ProviderBindingId
      readonly scopeKey: string
      readonly cursorValue: string | undefined
      readonly state: SyncState
      readonly lastErrorCode: string | undefined
    }
    getSyncCursor(workspaceId: WorkspaceId, bindingId: ProviderBindingId,
                  scopeKey: string): Promise<SyncCursorRecord | undefined>
    putSyncCursor(record: SyncCursorRecord): Promise<void>

SQLite 主键改为 `(workspace_id, binding_id, scope_key)`；workspace 与 binding 各有父行外键。Fake 写前验证两父行，按三个字段比较与覆盖。
这两条独立外键只证明父事实存在，不证明该工作区已挂载该连接。游标没有 domain，不能硬连到带 domain 的挂载三元键。
`scopeKey` 继续表示同步用途，`PLANNING_SYNC_SCOPE` 仍是 `planning.project`；不把工作区拼进字符串来绕过端口设计。
Core 读写都显式传 `context.workspaceId`。成功事务仍原子提交投影、游标与修订号；失败结算只改本工作区游标、保留行、不推进业务修订号。
`recordObservation` 和外部身份继续是连接级。#198 的共享账本与第二工作区物化义务是另一闭环，不扩大本项。（订正 2026-10-03 验收：#198 是开发域 commit sha 的 `sourceVersion` 定序，不承接共享账本；账本按连接共享处理状态目前没有 issue，登记为 `docs/exec-plan/tech-debt-tracker.md` 的 TD-022，见 Decision Log。）

### Schema 与失败边界

003 原位重写空库 DDL、列清单、映射与夹具；不开 006/007，不迁移历史实验数据，不双读双写。
`source-version-carrier.ts` 已有 `assertRewritten003Shape`。扩展该守卫检查游标三元主键的列序与 workspace 列；旧形状应在业务写入前拒绝并关闭句柄，提示人显式重建实验库。
形状守卫是拒绝机制，不是数据升级器，也不自动删除数据库文件。
`webhook_subscription` 已有 `(workspace_id,binding_id,scope_key,event_name)`，保留已有两工作区用例，不再实施 issue 历史描述中的旧缺陷。
规范 sourceVersion 被 Storage 拒绝却未生产 degraded 的 #199 仍开放；本项只正确存取已经生产的同步状态。

### 被拒绝方案

方案 B 保留连接 cursor，新增工作区健康记录与 get/put 端口，能够支持未来共享连接 ingest。
当前 bootstrap 没有消费共享 continuation 的独立 ingest 层；马上增加两套生命周期和原子协调，会提高维护成本并逼近预算，因此拒绝。
方案 C 保持旧签名，将 workspace 编码进 `scopeKey`，改动较少，但类型和数据库不能表达工作区父边，各调用者会重复编码，因此拒绝。
只有真实连接级 continuation 消费者出现且需要共享读取时，才重新评估 B，并写 ADR；不提前保留第二个健康事实源。

### 判别测试协议

共享测试标题用“同步游标：同连接同scope跨workspace隔离”，在Fake/SQLite各注册一次，禁止只在单适配器测试里证明键。
准备两个已登记workspace和同一个已登记binding；各写相同scope不同cursor/state/error，读回每条完整记录深相等。
再对ws-a同键覆盖，ws-b完整记录保持，ws-a不同scope与另binding同scope仍独立。
缺父workspace与缺binding分别测试，不以shape异常代替存在性拒绝。

生产链测试标题用“工作区健康：另一个工作区成功不恢复当前失败”。
共享storage与planning连接，实际composeCore构造A/B；先正常水合以保留行，再用Provider故障开关令A失败。
在A失败前后记录A的revision，失败必须不变；撤故障并让B成功，A的syncSummary仍degraded/stale且reason逐字保持。
从A的listPlanningItems/getItemDetail和controller.baseline读取，断言行degraded与整表source.degraded一致。
随后仅A成功才恢复A，B状态完整保持；以相反时序重复，避免只保护某个固定workspace名字。
并发两个命令各自结算后，两条游标都必须存在，不能只数最终一条healthy。

持久化测试使用本用例生成的临时文件；关闭并重开同文件后读两条三元记录，不能用Fake导出/导入替代。
回滚用例在transaction里先写A然后主动抛出已知测试错误，A/B游标与revision都回到事务前值。
形状用例明确构造旧两元主键，不只是少一列；检查错误处置与db.close调用，合法新schema打开为正控。
webhook对照使用003现有四元键，两workspace可各插一行、同四元重复被拒；不增加其新API。

| 独立失败 | 预期恢复 |
|---|---|
| Provider离线 | 仅失败workspace保留旧值与degraded；本workspace成功才恢复 |
| 事务中断 | 当前整笔回滚，其他workspace无需补偿 |
| 缺父行 | 两实现拒绝且不留游标；父行登记后可重试 |
| 实验库旧shape | 业务前拒绝并关句柄，人显式决定重建，程序不删库 |
| 合并后caller漏workspace | typecheck/共享行为反例变红，完整接口单元回退 |

## Global Constraints

Batch 0 只写计划和索引；实施与验收的唯一文件集如下，新增文件在同一行明确标记，超出集合先修订本章与预算。

| 角色 | 唯一允许文件 |
|---|---|
| 端口 / Fake | `packages/capabilities/src/storage.ts`；`packages/providers/fake/src/storage.ts` |
| SQLite | `packages/storage/sqlite/migrations/003_control_facts.sql`；`packages/storage/sqlite/src/storage-sync.ts`；`packages/storage/sqlite/src/storage-rows.ts`；`packages/storage/sqlite/src/source-version-carrier.ts` |
| Core | `packages/core/src/bootstrap.ts`；`packages/core/src/queries.ts` |
| 契约 | `tests/contract/suites/storage-sync.js`；`tests/contract/storage-contract.test.js` |
| 集成 / 夹具 | `tests/integration/storage-sync-surface.test.js`；`tests/integration/storage-source-version-upgrade.test.js`；`tests/integration/execution-relation-write-schema.test.js`；`tests/integration/workspace-sync-scope.test.js`（将新建） |
| 文档 | 本计划；`docs/README.md`；`docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md`；`docs/product/vertical-path.md`（X2 复现片段的游标读取签名，修订轮 1 补入；第 3 行失败列与承接列、用例简称表，验收补入）；`docs/exec-plan/tech-debt-tracker.md`（验收登记 TD-020–TD-022） |

每 PR 实际增删合计 code ≤800、docs ≤1300，含测试与夹具，排除锁文件和生成目录。
预算是区间：端口/Core/两实现/DDL 约 180–260；测试约 170–230；调用点和夹具约 80–140；代码总计约 430–630。计划、ADR与索引约 300–430 文档行。
到约 650 代码行时复核余量；若预计超过 800，暂停新写入，按独立能力重新划界，不删除判别测试或把无法编译的签名拆成半个 PR。
Node/pnpm 以根 `package.json` 和锁文件为准；不加依赖、不改变层级边，不改变规划状态或权威拥有者。
#189 与 #196 的 Storage 契约和 Fake 文件由单一 owner 串行整合；调查、非共享实现可并行，两个 PR 仍独立 base `main`。
不得改其他会话 worktree、主检出、凭据、CI workflow、工程状态自动化、Project `Status` 或 blocking 关系。
技术债以 `docs/exec-plan/tech-debt-tracker.md` 为既有唯一登记处，本项登记的条目见 Outcomes & Retrospective；不把 #198/#199/#221 冒充本项已关闭。

## Plan of Work

### Batch 0 · 两独立设计与最终 spec（已完成）

最小闭环：可审阅的作用域、端口、反例、预算和恢复路径；涉及主文件是本计划与 `docs/README.md`。
reviewer 独立读关键路径，核对 webhook 现状，拒绝字符串编码与双健康源，记录错误 producer 的边界。
索引仅在架构收敛控制计划行后加本项一行，不移动其他条目；本轮不写产品代码。

在 `fix/workspace-sync-scope` 工作树根目录运行：

    node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js
    git diff --check
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main

期望：文档契约全绿、无空白错误、发布面无五类敏感项，diff 只有本轮文档。另由本机已安装 ExecPlan 技能运行 `lint_execplan.py`。
没有 `rule-checks doclinks` 命令；契约覆盖范围有限，另逐条核本计划 `docs/` 引用和索引链接的存在性。
回滚点：Batch 0 开始时的干净工作树；仅撤销本轮两个文档文件，保留其他会话内容。

### Batch 1 · 三元键贯通与判别测试（已实施）

最小闭环：同连接不同工作区健康度独立；主文件为 `packages/capabilities/src/storage.ts`、`packages/providers/fake/src/storage.ts`、`packages/storage/sqlite/src/storage-sync.ts`、`packages/core/src/bootstrap.ts`、`packages/core/src/queries.ts`。
先在共享同步套件加 ws-a / ws-b 同 binding 同 scope 用例，在旧实现上记录错误覆盖导致红。
再一次性更新类型、三字段查找/覆盖、SQL DDL/mapper、成功和失败写游标、freshness读取；接口与消费者必须同提交可编译。
新增生产链集成用例，用实际 `composeCore`、`bootstrapWorkspace` 和 controller 查询，Fake/SQLite 各运行相同正反时序。
保留两个父行拒绝；跨工作区实体身份仍一份，投影与同步摘要各自独立；不得以新 identity 模拟隔离。

在本分支工作树根目录运行（新增测试由本批创建后执行）：

    pnpm install --frozen-lockfile
    pnpm run typecheck
    node --test tests/contract/storage-contract.test.js tests/integration/storage-sync-surface.test.js tests/integration/workspace-sync-scope.test.js
    pnpm run boundaries

期望：共享套件两实现全绿，跨工作区新增测试非零且 A 状态/原因不随 B 改变；边界检查全绿。
回滚点：Batch 0 文档提交；回退整批端口/schema/Core/test单元，不单独回退列或 mapper，不删除实验库。

### Batch 2 · 重启、回滚与发布面收口（已实施并验收）

最小闭环：三元键持久化与事务恢复可复现；主文件为 `packages/storage/sqlite/src/source-version-carrier.ts`、`tests/integration/storage-sync-surface.test.js`、`tests/integration/execution-relation-write-schema.test.js`、`tests/integration/workspace-sync-scope.test.js`（将新建）、`docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md`。
写两个工作区不同状态到临时 SQLite 文件，关闭后重开，逐字读回；事务内写 A 后主动抛错，A/B旧值均保持。
构造只用于测试的旧形状库，打开即拒绝且句柄关闭；不要迁移旧数据或增加历史库兼容逻辑。
保留 webhook 两工作区唯一键验收为对照；ADR 表原来的游标“未收口”原地加最终证据/订正，其他未收口不变。

在本分支工作树根目录运行：

    node --test tests/integration/storage-source-version-upgrade.test.js tests/integration/execution-relation-write-schema.test.js tests/integration/storage-sync-surface.test.js tests/integration/workspace-sync-scope.test.js tests/e2e/chain-bootstrap.test.js
    pnpm run typecheck
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD
    git diff --numstat origin/main...HEAD

期望：重启/事务/形状对照通过；用户更窄 800/1300 上限按 numstat 重算，不用仓库较宽阈值代替。
负对照在可丢弃实验检出分别去掉 Fake workspace 谓词、SQLite WHERE/PK workspace、Core查询维度；各对应行为测试必须红，恢复后绿。
回滚点：Batch 1 已验证提交；必要时成组回退能力实现。不得用删外键或追加删除历史掩盖缺陷。

### 验收 · 终树复核与重构（已完成）

最小闭环：指定验收者独立复核 diff、处置验证者遗留项、做不改行为的简化，并在整理后的终树上复跑全部验证；主文件为本计划、`docs/exec-plan/tech-debt-tracker.md` 与验收触及的文件（见 Global Constraints）。
在检出 `fix/workspace-sync-scope` 的工作树根目录运行：

    pnpm install --frozen-lockfile --offline
    pnpm verify
    pnpm run boundaries
    node scripts/workflow-check.mjs
    node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

期望：全部通过，`size` 的代码与文档行数不超过用户的 800 / 1300；另由本机已安装的 ExecPlan 技能运行 `lint_execplan.py`。
负对照在一次性克隆里做：`git clone --quiet --no-checkout <本仓库> <临时目录>`，检出终树后 `pnpm install --frozen-lockfile --offline`；逐项改源码、用 `git diff -U0` 打印变异行，跑 Batch 2 命令里的六个测试文件，`git checkout -- <文件>` 还原并以 `git diff --quiet` 复核干净。期望：除记录在案的存活项外全部变红，还原后 192 / 192 通过。
回滚点：Batch 2 提交；验收只改守卫的取列方式、一条用例的断言范围与文档，可整组回退，不触碰端口与 schema。

### Concrete Steps

每批执行对齐 → 隔离 → 实现 → 最窄验证 → 记录 → 整理提交 → 汇报。
实施前 realpath 核查目标位于 `.worktrees/workspace-sync-scope`，重读根 AGENTS 与当前 main；所有 Git 操作用 argv/library，不拼动态 shell字符串。
提交按可独立审阅能力配判别测试；最终 push 前整理 debug/fixup，复核五类发布面、预算和真实 diff。
本轮可创建 draft 文档 PR；以后 ready 必须在产品批次完成、远端精确 head 回读及独立验收后执行，本轮保持 draft。

## Validation and Acceptance

| 验收 | 判定证据 | 终树结论（2026-10-03 验收；负对照编号见 Progress） |
|---|---|---|
| A degraded → B healthy 不串台 | 两 Storage 的 core/controller 生产链反例；A reason/state 保持 | 通过：`tests/integration/workspace-sync-scope.test.js`「工作区健康：另一个工作区成功不恢复当前失败」4 例（2 Storage × 2 时序），A 的 reason、state 与修订号保持；N1–N3、N5、N6、N15 变红 |
| B失败/A成功与并发结算独立 | 反向时序与两个排队结算均有两条游标 | 通过：同文件「工作区健康：并发结算后两个工作区各留一条游标」8 例（2 Storage × 2 时序 × 后结算方）；N16 变红 |
| 同 workspace不同scope/binding独立 | 三元键表驱动断言；同键重写仅覆盖自己 | 通过：`tests/contract/storage-contract.test.js`「同步游标：同连接同scope跨workspace隔离」两个适配器各 1 例；N1–N3、N19 变红 |
| 孤儿游标拒绝 | 缺 workspace 或 binding 时两个实现拒绝、get无行 | 通过：同文件「悬空父行的同步游标与对账游标都必须被拒绝且不留行」两个适配器各 1 例，父行登记后重试成功；N7、N8、N17、N18 变红 |
| 事务失败不污染任何workspace | rollback 后 A/B 记录和业务 revision不变 | 通过：「工作区健康：事务内写 A 后抛错」两个 Storage 各 1 例；N13、N14 变红 |
| SQLite重开保持作用域 | 真文件关开后两条记录读回相同 | 通过：「工作区健康：SQLite 关闭并重开同一文件后两条三元游标逐字读回」；N15、N19 变红 |
| 旧形状拒绝 | 打开前拒绝、句柄关闭、实验文件未被自动升级/删除 | 通过：`tests/integration/storage-sync-surface.test.js`「003 重写后的库自检：旧的游标主键」三种旧形状加新库正控；N9–N12、N20 变红；缺 `sync_cursor` 表的库同样被拒但没有用例（N22 存活，裁定见 Decision Log） |
| webhook现状保留 | 已有四元唯一键用例通过；无新增 webhook端口 | 通过：`tests/integration/execution-relation-write-schema.test.js`「已钉住的约束变异」的四元键两工作区用例未改；没有新增 webhook 端口 |
| 规划/身份边界保持 | Planning状态不变、连接身份不按workspace复制 | 通过：生产链用例比对行的 `[entityId, planningStatus]`（验收补强，原先只比 `entityId`）；N21 变红 |
| 发布与规模 | 文档/路径/边界/披露检查；真实 numstat ≤800/1300 | 通过：见 Artifacts and Notes 的终树验证 |

### Artifacts and Notes

本轮观察证据：`getSyncCursor` 三处（端口、Fake、SQLite）缺 workspace；Core成功/失败路径写同键；两设计内存实验均看到 A 被 B 洗成 healthy。
这些是基线缺陷证据，实施后的新命令输出须记录在本计划 Progress/本节并带分支与观察 head；不能把未来预期写成已通过。

终树验证（观察时刻 2026-10-03 23:01 CST；代码终树是 `fix/workspace-sync-scope` 上的 Batch 2 提交 `518e9bd`，其后只有本计划所在的验收文档提交；重算：在该分支工作树根目录重跑「验收 · 终树复核与重构」的命令）：

- `pnpm verify`：typecheck 通过；`pnpm run test` 1107 通过 / 0 失败；`pnpm run test:mvp0` 7 通过。
- `pnpm run boundaries` 8 通过；`node scripts/workflow-check.mjs` 无发现；文档契约 9 / 9；`lint_execplan.py` 通过。
- `node scripts/rule-checks.mjs size origin/main`：代码 293 行、文档 402 行（用户上限 800 / 1300）；`disclosure` 无命中；`git diff --check origin/main...HEAD` 无输出。
- Batch 1 提交 `db631c4` 单独检出：typecheck 通过；`storage-contract`、`storage-sync-surface`、`workspace-sync-scope`、`execution-relation-write-schema` 四个文件 169 / 169 通过。
- 负对照见 Progress 的验收条目。
关闭关联唯一权威是 GitHub 回读，计划只关联 #189；PR编号创建后按本分支检索，不手抄关闭引用。

    gh pr list -R SingularityKChen/harness-projects --head fix/workspace-sync-scope --state open --json number,isDraft,baseRefName,headRefOid,closingIssuesReferences
    gh api graphql -f owner=SingularityKChen -f repo=harness-projects -F number=189 -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){state closedByPullRequestsReferences(first:100){nodes{number isDraft state baseRefName headRefName}}}}}'

期望：唯一 draft、base main、远端 head与最终本地提交相同；closingIssuesReferences 与 issue closedByPullRequestsReferences 均确实包含目标关联，issue仍开放。
关联未解析时修正 PR 描述再回读，不能以正文关闭关键字宣称权威关系已经成立。

## Progress

- [x] (2026-10-03 21:34 CST) Batch 0：两独立设计、第三方代码审查与最终 spec 收敛；文件集见 Global Constraints。
- [x] (2026-10-03 21:34 CST) 独立 spec 审查 pass：订正 webhook旧描述、补旧shape拒绝/重启/rollback、不引双健康源。
- [x] (2026-10-03 21:52 CST) reviewer实跑 lint_execplan.py：OK；另核13章固定顺序、docs引用/索引存在性及相对路径，均pass。
- [x] (2026-10-03 21:56 CST) Batch 0 文档门：linter通过，文档契约9/9、计划与索引路径、暂存区披露/体量和空白检查通过；产品验收未执行。
- [x] (2026-10-03 22:25 CST) Batch 1：三元键贯通与生产链红绿证据。基于 `e7ef8e4` 的 `.worktrees/workspace-sync-scope`；整理后的提交是 `db631c4`（见验收条目）。
  - RED（旧实现，同一批判别测试）：`node --test tests/integration/workspace-sync-scope.test.js` 12 项全红，首例 `actual: { degraded: false, stale: false, reason: undefined }` / `expected: { degraded: true, stale: true, reason: 'unavailable' }`（B 成功把 A 洗成 healthy）；并发用例 `actual: [ true, true ]` 与 `[ false, false ]` 对 `expected: [ true, false ]`。共享契约 `node --test tests/contract/storage-contract.test.js`：同步游标隔离与悬空父行两个新用例在 Fake 与 SQLite 上各红一次（读回 `undefined`、缺工作区未被拒绝），切分守卫随之变红。均为行为红，不是只有类型错误。
  - GREEN：端口 `SyncCursorRecord` 加必需 `workspaceId`，`getSyncCursor(workspaceId, bindingId, scopeKey)`；Fake 双父边检查与三字段比较；003 原位重写 `sync_cursor` 为 `(workspace_id, binding_id, scope_key)` 主键加两条外键；`storage-sync.ts` 列清单、SELECT、UPSERT 冲突目标与 `storage-rows.ts` 映射；Core 成功事务、失败结算、`syncSummary` 全部显式传 `context.workspaceId`。
  - 验证：`pnpm run typecheck` 通过；`node --test tests/contract/storage-contract.test.js tests/integration/storage-sync-surface.test.js tests/integration/workspace-sync-scope.test.js` 157 通过 / 0 失败；`pnpm run boundaries` 通过；扩大到 `pnpm run test` 1103 通过 / 0 失败、`pnpm run test:mvp0` 7 通过。
  - 负对照（先 WIP 提交，`git diff --quiet` 为空，变异后用 `grep -n` 打印变异行，红后 `git checkout -- <file>` 恢复并复核干净；命令范围为 storage-contract、workspace-sync-scope、storage-sync-surface、execution-relation-write-schema 四个测试文件）：

    | 变异 | 判别测试 | 结果 |
    |---|---|---|
    | Fake `getSyncCursor` 谓词去掉 workspace | 契约隔离 + 生产链 + 并发 | 7 红（仅 Fake 行） |
    | Fake `putSyncCursor` upsert 谓词去掉 workspace | 同上 | 7 红（仅 Fake 行） |
    | SQLite SELECT 的 WHERE 去掉 workspace | 契约隔离 + 生产链 + 并发 | 7 红（仅 SQLite 行） |
    | SQLite PK 与 ON CONFLICT 目标同去 workspace | 同上 | 7 红（仅 SQLite 行） |
    | Core `syncSummary` 读固定工作区 | 生产链 + 并发 | 12 红（两个 Storage 各 6） |
    | Core 失败结算写固定工作区 | 生产链（B 失败时序）+ 并发 | 6 红 |
    | Fake 删除工作区父行检查 | 契约悬空父行 | 1 红 |
    | SQLite 去掉 workspace 外键 | 契约悬空父行 + schema 外键用例 | 2 红 |

- [x] (2026-10-03 22:45 CST) Batch 2：重启、回滚、旧形状拒绝与 ADR 收口（实施侧；远端产品验收尚未执行）。基于 Batch 1 提交，`.worktrees/workspace-sync-scope`。
  - RED：新增旧形状用例后，`node --test tests/integration/storage-sync-surface.test.js` 该用例因 `createSqliteStorage` 未抛错而红（`actual: undefined`，`expected: /sync_cursor 的主键不是 \(workspace_id, binding_id, scope_key\)/`）；重启与回滚用例是对 Batch 1 实现的验收，当时即绿，其判别力由下表变异证明。
  - GREEN：`assertRewritten003Shape` 增加 `sync_cursor` 主键按 `pk` 顺序等于 `workspace_id,binding_id,scope_key` 的判定，错误文案补充处置（程序不升级、不删库）；`execution-relation-write-schema.test.js` 增加三元主键两工作区各一行、同三元键重复被拒的对照，保留 webhook 四元键两工作区用例；ADR-0006 游标行原地改为已收口并附证据，其他未收口行未动。
  - 验证：`node --test tests/integration/storage-source-version-upgrade.test.js tests/integration/execution-relation-write-schema.test.js tests/integration/storage-sync-surface.test.js tests/integration/workspace-sync-scope.test.js tests/e2e/chain-bootstrap.test.js` 全部通过；`pnpm run typecheck`、`pnpm run boundaries` 通过；扩大到 `pnpm run test` 1107 通过 / 0 失败、`pnpm run test:mvp0` 7 通过；`node scripts/rule-checks.mjs size origin/main` 代码 286 / 文档约 305（上限 800 / 1300），`disclosure` 与 `git diff --check origin/main...HEAD` 通过。
  - 负对照（先 WIP 提交，`git diff --quiet` 为空，`grep -n` 打印变异行，红后 `git checkout -- <file>` 并复核干净）：

    | 变异 | 判别测试 | 结果 |
    |---|---|---|
    | 形状守卫整体去掉游标主键判定 | 旧形状用例 | 1 红 |
    | 守卫只看主键含 workspace_id | 旧形状用例（顺序错变体） | 1 红 |
    | 守卫只看主键列数为 3 | 旧形状用例（顺序错变体） | 1 红 |
    | 打开自检失败时不关闭句柄 | 旧形状用例与既有 fd 用例 | 2 红 |
    | Fake 事务抛错仍提交草稿 | 回滚用例（Fake） | 1 红 |
    | SQLite 事务抛错改为 COMMIT | 回滚用例（SQLite） | 1 红 |
    | SQLite 主键、冲突目标去 workspace 并放宽守卫 | 重启读回、生产链、并发 | 重启用例读回 A 为 B 的值而红 |
- [x] (2026-10-03 22:35 CST) 修订轮 1（验证者 F1，P2）：`docs/product/vertical-path.md` 的 X2 复现片段仍调用两参数 `getSyncCursor(binding.id, 'planning.project')`。复现：旧签名下 `binding.id` 被当作 workspaceId，读回 `undefined`，随后 `cursor.state` 抛 `TypeError`。修复：片段改为 `newWorkspaceId()` 组合工作区并调用三参数 `getSyncCursor(workspaceId, binding.id, 'planning.project')`，观察行注明只订正签名、没有重放。`grep -rn getSyncCursor docs` 再无两参数调用者（其余为 ADR、历史评审和已归档计划的叙述）。该文档没有机械检查（`grep -rln vertical-path tests scripts` 只命中 `tests/mvp0/README.md`），所以没有可写的红测试，证据是上面的复现。 Superseded by 验收条目（2026-10-03 23:01 CST）：片段改用挂载记录的 `binding.workspaceId`，撤回 `newWorkspaceId()` 与新 import；第 3 行与简称表也随 #189 更新。

- [x] (2026-10-03 23:01 CST) 验收与重构（指定验收者 Opus，`.worktrees/workspace-sync-scope`）：独立复核 `git diff 68524a0...HEAD` 与每条验收行，处置验证者遗留的 F2–F6（结论见 Decision Log），终树验证见 Artifacts and Notes。
  - 复核新发现（均已修）：ADR-0006 观察账本行「收口条件同上」在游标行收口后悬空；X2 观察行「停在第 5 行」在片段加了两行后不再成立；`docs/product/vertical-path.md` §2.1 要求关闭所引 issue 的 PR 更新对应行，第 3 行承接列仍列 #189；验收行「规划/身份边界保持」只比对 `entityId`；守卫依赖 `group_concat` 的聚合顺序；本计划把账本共享记在 #198 名下，与 #198 的范围不符。
  - 重构与补强：守卫读出主键列后在代码里按 pk 拼接；生产链用例改比 `[entityId, planningStatus]`；X2 片段改用挂载记录的 `workspaceId`，撤回新增的 import 与 `newWorkspaceId()`。没有删除用例或断言。
  - 提交整理：`e7ef8e4` 之后的三个提交（Batch 1、Batch 2、修订轮 1）连同验收改动重排为 Batch 1、Batch 2、验收文档三个提交，`e7ef8e4` 及更早不动；整理前后 `git diff --name-only 68524a0 <ref>` 的文件集合用 `comm -3` 比对，只多出 `docs/exec-plan/tech-debt-tracker.md`。
  - 终树负对照（一次性克隆，代码同 `518e9bd`；每项先用 `git diff -U0` 打印变异行，再跑 Batch 2 命令里的六个测试文件共 192 例，`git checkout --` 还原后 `git diff --quiet` 为空；全表结束后 192 / 192 通过）：

    | # | 变异 | 结果 |
    |---|---|---|
    | N1 | Fake `getSyncCursor` 谓词去掉 workspace | 8 红（Fake 的契约隔离、生产链、并发） |
    | N2 | Fake `putSyncCursor` upsert 谓词去掉 workspace | 8 红 |
    | N3 | SQLite SELECT 的 WHERE 去掉 workspace | 9 红（SQLite 的契约隔离、生产链、并发） |
    | N4 | SQLite PK 与 ON CONFLICT 同去 workspace，守卫不动 | 105 红（守卫拒绝每个新建库） |
    | N5 | Core `syncSummary` 读固定工作区 | 14 红 |
    | N6 | Core 失败结算写固定工作区 | 7 红 |
    | N7 | Fake 删除工作区父行检查 | 1 红（契约悬空父行） |
    | N8 | SQLite 去掉 `sync_cursor` 的 workspace 外键 | 2 红（契约悬空父行、约束变异用例） |
    | N9 | 守卫整体去掉游标主键判定 | 1 红（旧形状用例） |
    | N10 | 守卫只看主键含 `workspace_id` | 1 红 |
    | N11 | 守卫只看主键列数为 3 | 1 红 |
    | N12 | 打开自检失败时不关闭句柄 | 2 红（两条 fd 用例） |
    | N13 | Fake 事务抛错仍提交草稿 | 11 红 |
    | N14 | SQLite 事务抛错改为 COMMIT | 13 红 |
    | N15 | SQLite PK、冲突目标去 workspace 并把守卫放宽到两元 | 11 红（含重启读回与 SQLite 回滚） |
    | N16 | Core 成功事务写固定工作区 | 16 红 |
    | N17 | Fake 删除连接父行检查 | 1 红 |
    | N18 | SQLite 去掉 `sync_cursor` 的 binding 外键 | 2 红 |
    | N19 | `rowToSyncCursor` 写死 `workspaceId` | 4 红 |
    | N20 | 守卫取主键列时去掉 `ORDER BY pk` | 1 红（顺序错变体） |
    | N21 | 降级行把规划状态改成 `unknown` | 5 红（生产链 4 例与 chain-bootstrap 降级用例） |
    | N22 | 守卫放过缺 `sync_cursor` 表的库 | 0 红，存活（F3，裁定见 Decision Log） |

- [ ] 人类评审 PR #264（draft）。之后由主执行者推送整理后的提交（新提交都是已推送的 `e7ef8e4` 的后代，推送是快进），回读远端 head、checks、`closingIssuesReferences` 与 review threads，再由人类决定 ready 与合并。


## Surprises & Discoveries

webhook 已含 workspace 四元键，历史 issue描述不能变成重复工作；证据是003 DDL与 execution-relation-write-schema 的两工作区用例。
(2026-10-03 22:25 CST) 切分守卫的用例总数 `ADDED_CASE_COUNT` 在 `tests/contract/suites/storage.js`，不在文件集；因此隔离用例没有放进 `storage-sync.js`，而是放进 `storage-contract.test.js` 内已装配到 Fake 与 SQLite 同步组的 `sharedSyncSuite`，同样在两个适配器各注册一次，且不扩大文件集。
(2026-10-03 22:25 CST) 003 列白名单审计的标题写 63 列、断言写 65 列，已是陈旧不一致；新增 `sync_cursor.workspace_id` 后实测 66 列，标题与断言一并订正为 66。
(2026-10-03 22:45 CST) 守卫只比较 `sync_cursor` 主键列名串，而不是只数列或只看有无 workspace 列：只看有无列判不出「有列但主键仍两元」，只数列判不出「三元但顺序错」。
(2026-10-03 22:25 CST) 并发用例证明 SQLite 与 Fake 在两个工作区各自结算、后结算方不同的四个组合下都留两条游标；旧实现下它们表现为后写覆盖先写。
(2026-10-03 22:35 CST) X2 复现片段在签名之外还有一个更早的失效：`0728435`（已在 `origin/main`）起 `makeObservation` 拒绝非规范 `sourceVersion`，片段里的 `'vé'` 在 `emitObservation` 就抛 `RangeError`，到不了存储，所以「游标仍 healthy」的观察在 #189 之前就已无法重放。这是既有缺陷，不是本 PR 引入；用 Object.create 包住事务句柄换一种存储拒绝触发会命中类私有字段的 `TypeError`，不是同一个失败面，因此没有硬造替代触发，已在文档观察行注明，留给 #199。
#199 的 sourceVersion Storage拒绝会留下旧 healthy，是独立 producer问题；这里不能通过加工作区键冒充修复。
主分支在调查后推进的是文档与工程reconcile归档，产品代码未动；实施仍须重新锁当前refs。
(2026-10-03 23:01 CST) 本计划 Design 把账本共享与第二工作区物化记在 #198 名下；`gh issue view 198` 读回的标题是「stop using a commit sha as an orderable sourceVersion」，与账本作用域无关，也没有别的 issue 承接。探针：ws-a 组合后账本 5 行，ws-b 组合后仍 5 行，同一观察再记账返回 `false`，ws-b 照样水合出 5 行——全量读取掩盖了共享处理状态。
(2026-10-03 23:01 CST) ADR-0006 观察账本行的「收口条件同上」指向游标行的收口条件；游标行改成已收口时那句条件被删，引用悬空。
(2026-10-03 23:01 CST) `docs/product/vertical-path.md` §2.1 写明关闭所引 issue 的 PR 必须同 PR 更新对应行；第 3 行承接列列着 #189，修订轮 1 只改了 X2 片段。`queries.listProviderBindings()` 返回的挂载记录本来就带 `workspaceId`，片段不需要新 import。
(2026-10-03 23:01 CST) SQLite 文档说明 `group_concat` 的拼接顺序未定义（除非在聚合参数里写 ORDER BY）；原守卫靠子查询的 ORDER BY 在实践中成立（验证轮的去 ORDER BY 变异会变红），但那是查询规划器的行为，不是契约。

## Decision Log

Decision：人类已在Project将 #189/#196/#178 规划启动为In Progress，并将 #178 提前到迭代4；保留新的规划。Rationale：2026-10-03人类明确确认该调整；agent只同步PR迭代索引，不代写Status或blocking。Date/Author：2026-10-03 22:08 CST / 人类伙伴。

Decision：选择三元游标键，拒绝新增健康表和scope字符串编码。Rationale：恢复工作区权威最直接，当前无共享ingest消费者。Date/Author：2026-10-03 21:34 CST / 独立最终reviewer。
Decision：三个本轮 PR 独立 main；共享Storage文件单owner串行整合。Rationale：存在编辑冲突而无能力发布前置，不建立伪blocked-by。Date/Author：2026-10-03 21:34 CST / 用户范围与独立reviewer。
Decision：本轮仅文档与draft交付。Rationale：用户要求先多设计者及独立修订，实施待下一道门。Date/Author：2026-10-03 21:34 CST / 用户授权。
Decision：隔离契约用例放入 `sharedSyncSuite`，故障注入用 Proxy 包住共享 planning provider 的 `getProject`、按工作区开关与闸门，而不是改 Fake provider。Rationale：不扩大文件集、不改 Fake provider 公共面，且闸门能决定并发时两个结算的先后。Date/Author：2026-10-03 22:25 CST / Sonnet implementer。
Decision：形状守卫在 Batch 2 扩展，003 在 Batch 1 已原位重写。Rationale：计划把守卫放在 Batch 2；Batch 1 之后旧形状实验库的游标写入会以驱动级缺列失败，Batch 2 把它换成打开时的显式拒绝；该库未发布，不写兼容（D10）。Date/Author：2026-10-03 22:25 CST / Sonnet implementer。
Decision：`docs/product/vertical-path.md` 并入文件集，只改 X2 片段的游标读取签名与观察行注记。Rationale：该片段是唯一仍用两参数的可运行调用者，改签名必须同步；不改它的触发方式，因为替代触发会换失败面，属 #199。Date/Author：2026-10-03 22:35 CST / Sonnet implementer（修订轮 1，F1）。 Superseded by 本节 2026-10-03 23:01 CST 的 vertical-path 决策（范围扩到第 3 行与简称表）。
Decision：允许 draft PR、标签/milestone与Project分类/ExecPlan/Batch复制已有Priority/Size/Iteration；未授权Status/blocking。Rationale：机械分类与人拥有规划状态分开。Date/Author：2026-10-03 21:34 CST / 用户明确范围。
Decision：验证者 F2 属实，`docs/README.md` 索引行状态改为「Active；Batch 0–2 实施与验收完成，待人类评审」。Rationale：索引说产品批次待实施，与计划头和 Progress 不一致。Date/Author：2026-10-03 23:01 CST / Opus acceptor。
Decision：F3 不加用例，缺 `sync_cursor` 表的库按有意拒绝处理。Rationale：003 的四个版本（`a321ec5`、`0728435`、`e2075eb` 与本项）都在同一迁移里建 `sync_observation` 与 `sync_cursor`，程序产出的库不会只有前者；守卫对这种库已经拒绝（主键列名串为空，不等于期望值），N22 要人为加豁免才存活。代价（若错）：手工损坏的库第一次写游标时报驱动级 `no such table`，而不是可执行的处置文案；不丢数据。Date/Author：2026-10-03 23:01 CST / Opus acceptor。
Decision：F4 保持 `assert.rejects` 的字符串第二参数。Rationale：同文件全部父行拒绝用例都是这个写法；同一用例最后以合法父行重试成功，被拒记录与成功记录只差缺失的父 id，拒绝原因因此被钉住；N7、N8、N17、N18 各自只让这一例变红。代价（若错）：某个适配器以无关原因拒绝时不会被这条断言区分，但合法父行上的重试会暴露通用失败。Date/Author：2026-10-03 23:01 CST / Opus acceptor。
Decision：F5 隔离用例留在 `sharedSyncSuite`。Rationale：该组是切分后共享同步用例的既定落点，经 `assemble` 装配到两个适配器并受装配守卫保护；挪进 `tests/contract/suites/storage-sync.js` 要改文件集外 `tests/contract/suites/storage.js` 的 `ADDED_CASE_COUNT` 与 `CASE_LEDGER`，没有行为收益。代价（若错）：第三个 Storage 实现只接 `storageSyncSuite` 时漏掉隔离用例；出现第三个实现时挪过去并改台账。Date/Author：2026-10-03 23:01 CST / Opus acceptor。
Decision：F6 以整理后的提交为准。Rationale：`e7ef8e4` 之后的提交由验收者重建，作者仍是仓库默认身份，`Co-Authored-By` 写验收者模型；上面署「Sonnet implementer」的实现决策保留原署名，两份记录分别对应实现与整理。代价（若错）：无行为影响。Date/Author：2026-10-03 23:01 CST / Opus acceptor。
Decision：形状守卫读出 `sync_cursor` 主键列后在代码里按 pk 拼接，不用 `group_concat`。Rationale：SQLite 文档声明 `group_concat` 的拼接顺序未定义，原写法靠查询规划器；新写法与同文件 `tablesOf` 同型、行为不变，N9–N11、N20 仍变红。代价（若错）：无。Date/Author：2026-10-03 23:01 CST / Opus acceptor。
Decision：生产链用例比对 `[entityId, planningStatus]`。Rationale：验收行「规划/身份边界保持」要求规划状态不变，原断言只比 `entityId`；补强后 N21 在两工作区路径上也变红。代价（若错）：无。Date/Author：2026-10-03 23:01 CST / Opus acceptor。
Decision：X2 片段改用 `binding.workspaceId`，撤回 `newWorkspaceId()` 与新 import；第 3 行失败列补入生产链用例，承接列去掉 #189 并注明已收口，简称表加 `workspace-sync-scope`，Global Constraints 的文件集随之修订。Rationale：`docs/product/vertical-path.md` §2.1 要求关闭所引 issue 的 PR 同步更新对应行；挂载记录已带工作区，片段改动缩到一行；新引用按 §2.1 的回读命令读回 4 个 ✔ 与 `ℹ fail 0`，伪造前缀读回 `ℹ tests 0`。代价（若错）：第 3 行其余格仍是 `main@699d715` 的基线，格内已注明。Date/Author：2026-10-03 23:01 CST / Opus acceptor。
Decision：ADR-0006 观察账本行把「同上」展开成原条件并指向 TD-022，游标行证据改为终树用例与负对照。Rationale：游标行收口后「同上」悬空；证据写成可回读的用例名。代价（若错）：无。Date/Author：2026-10-03 23:01 CST / Opus acceptor。
Decision：订正 #198 的误记；登记 TD-020（X2 无法重放）、TD-021（游标父边不证明挂载）、TD-022（账本按连接共享处理状态，无承接 issue）；本项不加「ws1 已接受的事件不阻止 ws2 刷新」用例。Rationale：三项都是本计划明确接受的延期；第三项超出已批准的 spec，今天因全量读取而成立，是否开 issue 由人类伙伴决定。代价（若错）：按观察增量刷新落地前若没人承接 TD-022，第二个工作区会漏刷新。Date/Author：2026-10-03 23:01 CST / Opus acceptor。
Decision：`e7ef8e4` 之后整理成三个提交：Batch 1（端口、两个实现、Core、契约与生产链用例、X2 片段与第 3 行）、Batch 2（形状守卫、重启与回滚、schema 对照、ADR 游标行）、验收文档（本计划、索引、债务登记、ADR 订正）。Rationale：每个提交可单独审阅与回退，Batch 1 单独检出也能编译并通过相关用例；`e7ef8e4` 及更早不改写，新提交都是它的后代。代价（若错）：评审若要逐批对照验证轮报告，旧提交号只在本机备份 ref 上。Date/Author：2026-10-03 23:01 CST / Opus acceptor。

## Idempotence and Recovery

同三元key重复put覆盖自身，重复bootstrap与观察账本现有规则相容；事务失败整体回滚，不提前展示Saved。
文档/测试/读取命令可重复；Git回退仅覆盖本任务已确认的文件，保留其他worktree与未跟踪内容。
外部写 actor是 `SingularityKChen`，target是公开仓库 `SingularityKChen/harness-projects` 与 Project 10；逻辑重试键为 `189+fix/workspace-sync-scope`。
先读同branch开放PR与Project item，存在则更新，不重复创建；这只是应用级重试策略，不声称GitHub支持该幂等键。
每次写记录actor/目标/请求/结果并fresh readback；网络未知时先回读，不盲重发创建。
共享历史重写/force-with-lease须恢复锚点与专家流程；本轮无需重写已共享历史，不合并PR。

## Interfaces and Dependencies

内部依赖方向保持 providers/storage → capabilities → core → controller → client；Storage接口仅增加workspace参数，不加反向调用。
#196与本项共享文件的整合需单owner；联合multi-workspace client验收要#189与#178都落地，但#178公开接口不依赖本项新storage签名。
执行工具是Node/pnpm、Git、gh；产品测试使用Fake和临时SQLite，不依赖真实GitHub或凭据。
Next gate：Batch 0 文档门后可交付draft；实施门是精确主线回读、红例非零与预算复核。关闭/ready需完整产品验收；人类决定合并。2026-10-03 23:01 CST：实施门与指定验收者验收已通过，下一道门是人类评审 PR #264。

## Outcomes & Retrospective

结果：同一连接挂在两个工作区时，同步健康度按 `(工作区, 连接, scope)` 各自存取。端口记录带必需 `workspaceId`；Fake 与 SQLite 按三个字段定位，两条父边各自检查；003 原位重写为三元主键；Core 的成功事务、失败结算与 `syncSummary` 都显式传工作区；旧两元主键的实验库在打开时被拒并关闭句柄。验收表十行全部通过，22 项负对照除记录在案的 N22 外全部变红。issue #189 保持开放，PR #264 保持 draft，等待人类评审。
规模：见 Artifacts and Notes 的终树验证，低于用户的 800 / 1300。
与计划的偏差：隔离契约用例放在 `sharedSyncSuite` 而不是 `tests/contract/suites/storage-sync.js`（F5 裁定）；003 列审计陈旧的 63 / 65 一并订正为 66；`docs/product/vertical-path.md` 与 `docs/exec-plan/tech-debt-tracker.md` 进入文件集；验收补强一条断言、改了守卫的取列方式，没有删除用例。
遗留：TD-020（X2 无法重放，随 #199）、TD-021（游标父边不证明挂载）、TD-022（观察账本按连接共享处理状态，无承接 issue，待人类伙伴决定）；#198、#199、#221 与 Gate E1 / R1 的裁定不在本项关闭范围。
合并后：另开文档 PR 把本计划移到 `docs/exec-plan/completed/`，同步改 `docs/README.md`、ADR-0006 游标行与 TD-020–TD-022 里指向本计划的路径。
回顾：改端口签名时，可运行的文档片段和「关闭 issue 必须更新对应行」这类文档规则也是调用者，要和代码调用点一起检索；把 issue 写成承接方之前先回读它的标题与范围。

## Bottom Change Note

Change Note (2026-10-03 21:34 CST)：第三方独立审查合并两设计，补三元键完整调用点、schema拒绝、失败边界、真实draft与关联回读；本轮未实施产品代码。
Change Note (2026-10-03 21:52 CST)：补确切Batch主路径与判别输入，独立linter和结构/路径检查已通过；全仓文档门由主执行者继续落账。

Change Note (2026-10-03 21:56 CST)：主执行者全文复核并运行文档契约与独立路径/暂存扫描，记录Batch 0文档门；后续产品批次保持pending。

Change Note (2026-10-03 22:08 CST)：记录人类在Project上的规划启动与#178重排期确认；保留原调查调度快照并明确取代，产品实施仍pending。

Change Note (2026-10-03 22:25 CST)：Batch 1 完成并落账，含 RED/GREEN、八项负对照与扩大验证；Batch 2 保持 pending。

Change Note (2026-10-03 22:45 CST)：Batch 2 完成并落账（旧形状守卫、重启与回滚用例、schema 对照、ADR-0006 游标行收口、六项负对照）；远端回读与验收未执行。

Change Note (2026-10-03 22:35 CST)：修订轮 1：验证者 F1 属实，订正 `vertical-path.md` X2 片段为三参数 `getSyncCursor` 并把该文件补入文件集；片段触发另有既有失效（`0728435` 起 `'vé'` 被入口拒绝），已注明、留给 #199。

Change Note (2026-10-03 23:01 CST)：指定验收者（Opus）验收与重构：处置 F2–F6，订正 ADR 悬空引用、X2 片段与 vertical-path 第 3 行、#198 误记，登记 TD-020–TD-022，补验收结论列、终树验证与 22 项负对照，提交整理为三个；状态改为实施与验收完成、待人类评审。
