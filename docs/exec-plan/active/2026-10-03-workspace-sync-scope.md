# 工作区同步游标作用域 ExecPlan

> 状态：Active；本轮仅完成 Batch 0，产品实施尚未开始。
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
同步游标是一次同步的当前位置与状态。当前 `SyncCursorRecord` 没有工作区，`getSyncCursor(bindingId, scopeKey)` 也没有工作区参数。
`packages/core/src/bootstrap.ts` 在成功事务和失败结算里写游标；`packages/core/src/queries.ts` 的 `syncSummary` 从它派生列表和详情 freshness。
`packages/providers/fake/src/storage.ts` 的内存键与 `packages/storage/sqlite/migrations/003_control_facts.sql` 的 SQL 主键都只有 `(bindingId, scopeKey)`，所以两个实现都有串台。
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
`recordObservation` 和外部身份继续是连接级。#198 的共享账本与第二工作区物化义务是另一闭环，不扩大本项。

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

本轮写入仅计划和索引。后续实施唯一文件集如下；新增文件在同一行明确标记，超出集合先修订本章与预算。

| 角色 | 唯一允许文件 |
|---|---|
| 端口 / Fake | `packages/capabilities/src/storage.ts`；`packages/providers/fake/src/storage.ts` |
| SQLite | `packages/storage/sqlite/migrations/003_control_facts.sql`；`packages/storage/sqlite/src/storage-sync.ts`；`packages/storage/sqlite/src/storage-rows.ts`；`packages/storage/sqlite/src/source-version-carrier.ts` |
| Core | `packages/core/src/bootstrap.ts`；`packages/core/src/queries.ts` |
| 契约 | `tests/contract/suites/storage-sync.js`；`tests/contract/storage-contract.test.js` |
| 集成 / 夹具 | `tests/integration/storage-sync-surface.test.js`；`tests/integration/storage-source-version-upgrade.test.js`；`tests/integration/execution-relation-write-schema.test.js`；`tests/integration/workspace-sync-scope.test.js`（将新建） |
| 文档 | 本计划；`docs/README.md`；`docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md` |

每 PR 实际增删合计 code ≤800、docs ≤1300，含测试与夹具，排除锁文件和生成目录。
预算是区间：端口/Core/两实现/DDL 约 180–260；测试约 170–230；调用点和夹具约 80–140；代码总计约 430–630。计划、ADR与索引约 300–430 文档行。
到约 650 代码行时复核余量；若预计超过 800，暂停新写入，按独立能力重新划界，不删除判别测试或把无法编译的签名拆成半个 PR。
Node/pnpm 以根 `package.json` 和锁文件为准；不加依赖、不改变层级边，不改变规划状态或权威拥有者。
#189 与 #196 的 Storage 契约和 Fake 文件由单一 owner 串行整合；调查、非共享实现可并行，两个 PR 仍独立 base `main`。
不得改其他会话 worktree、主检出、凭据、CI workflow、工程状态自动化、Project `Status` 或 blocking 关系。
技术债以 `docs/exec-plan/tech-debt-tracker.md` 为既有唯一登记处；当前无实现，不新增实现债，不把 #198/#199/#221 冒充本项已关闭。

## Plan of Work

### Batch 0 · 两独立设计与最终 spec（本轮）

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

### Batch 1 · 三元键贯通与判别测试（pending）

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

### Batch 2 · 重启、回滚与发布面收口（pending）

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

### Concrete Steps

每批执行对齐 → 隔离 → 实现 → 最窄验证 → 记录 → 整理提交 → 汇报。
实施前 realpath 核查目标位于 `.worktrees/workspace-sync-scope`，重读根 AGENTS 与当前 main；所有 Git 操作用 argv/library，不拼动态 shell字符串。
提交按可独立审阅能力配判别测试；最终 push 前整理 debug/fixup，复核五类发布面、预算和真实 diff。
本轮可创建 draft 文档 PR；以后 ready 必须在产品批次完成、远端精确 head 回读及独立验收后执行，本轮保持 draft。

## Validation and Acceptance

| 验收 | 判定证据 |
|---|---|
| A degraded → B healthy 不串台 | 两 Storage 的 core/controller 生产链反例；A reason/state 保持 |
| B失败/A成功与并发结算独立 | 反向时序与两个排队结算均有两条游标 |
| 同 workspace不同scope/binding独立 | 三元键表驱动断言；同键重写仅覆盖自己 |
| 孤儿游标拒绝 | 缺 workspace 或 binding 时两个实现拒绝、get无行 |
| 事务失败不污染任何workspace | rollback 后 A/B 记录和业务 revision不变 |
| SQLite重开保持作用域 | 真文件关开后两条记录读回相同 |
| 旧形状拒绝 | 打开前拒绝、句柄关闭、实验文件未被自动升级/删除 |
| webhook现状保留 | 已有四元唯一键用例通过；无新增 webhook端口 |
| 规划/身份边界保持 | Planning状态不变、连接身份不按workspace复制 |
| 发布与规模 | 文档/路径/边界/披露检查；真实 numstat ≤800/1300 |

### Artifacts and Notes

本轮观察证据：`getSyncCursor` 三处（端口、Fake、SQLite）缺 workspace；Core成功/失败路径写同键；两设计内存实验均看到 A 被 B 洗成 healthy。
这些是基线缺陷证据，实施后的新命令输出须记录在本计划 Progress/本节并带分支与观察 head；不能把未来预期写成已通过。
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
- [ ] (2026-10-03 21:34 CST) Batch 1：三元键贯通与生产链红绿证据。
- [ ] (2026-10-03 21:34 CST) Batch 2：重启/事务/负对照与远端产品验收。

## Surprises & Discoveries

webhook 已含 workspace 四元键，历史 issue描述不能变成重复工作；证据是003 DDL与 execution-relation-write-schema 的两工作区用例。
#199 的 sourceVersion Storage拒绝会留下旧 healthy，是独立 producer问题；这里不能通过加工作区键冒充修复。
主分支在调查后推进的是文档与工程reconcile归档，产品代码未动；实施仍须重新锁当前refs。

## Decision Log

Decision：选择三元游标键，拒绝新增健康表和scope字符串编码。Rationale：恢复工作区权威最直接，当前无共享ingest消费者。Date/Author：2026-10-03 21:34 CST / 独立最终reviewer。
Decision：三个本轮 PR 独立 main；共享Storage文件单owner串行整合。Rationale：存在编辑冲突而无能力发布前置，不建立伪blocked-by。Date/Author：2026-10-03 21:34 CST / 用户范围与独立reviewer。
Decision：本轮仅文档与draft交付。Rationale：用户要求先多设计者及独立修订，实施待下一道门。Date/Author：2026-10-03 21:34 CST / 用户授权。
Decision：允许 draft PR、标签/milestone与Project分类/ExecPlan/Batch复制已有Priority/Size/Iteration；未授权Status/blocking。Rationale：机械分类与人拥有规划状态分开。Date/Author：2026-10-03 21:34 CST / 用户明确范围。

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
Next gate：Batch 0 文档门后可交付draft；实施门是精确主线回读、红例非零与预算复核。关闭/ready需完整产品验收；人类决定合并。

## Outcomes & Retrospective

当前结果是通过独立设计审查的实施规格，尚无游标修复代码；issue保持开放、计划Active、PR保持draft。
现有技术债tracker未修改；#198/#199/#221及Gate E1/R1裁定均不在本轮关闭范围。
产品实施完成后用实际证据替换本节，核对技术债与验收表，再按PLANS移至completed并更新索引。

## Bottom Change Note

Change Note (2026-10-03 21:34 CST)：第三方独立审查合并两设计，补三元键完整调用点、schema拒绝、失败边界、真实draft与关联回读；本轮未实施产品代码。
Change Note (2026-10-03 21:52 CST)：补确切Batch主路径与判别输入，独立linter和结构/路径检查已通过；全仓文档门由主执行者继续落账。

Change Note (2026-10-03 21:56 CST)：主执行者全文复核并运行文档契约与独立路径/暂存扫描，记录Batch 0文档门；后续产品批次保持pending。
