# 连接账号与工作区配置存储 ExecPlan

> 状态：Active；设计已收敛，产品实现未开始。
> 创建：2026-10-05 CST；规范：`PLANS.md`。
> 关联：[issue #126](https://github.com/SingularityKChen/harness-projects/issues/126)；M4，Iteration 5（2026-10-15 至 2026-10-21）的候选闭环。
> 执行上下文：检出 `feature/connector-account-storage` 的工作树根目录；隔离目录为 `.worktrees/connector-account-plan`。

## Purpose / Big Picture

用户的一个外部账号可以支持同一工作区的 Planning、Development、Delivery 连接，也可跨工作区复用；工作区自己的项目引用、仓库路径和允许工作树根互不覆盖。禁用或卸载一处挂载后，账号及其他挂载仍在。重启后这些控制事实可恢复，而凭据值始终由宿主秘密服务持有。

最小成功证据是同一组契约在 Fake 和 SQLite 上证明一账号三域、配置隔离、失败零落账、重登记不丢元数据；真实文件库重开后逐字段相等。这是 Storage 能力闭环，真实宿主连接流程归 #132，本计划不宣称完成真实 GitHub 连接或 Gate R1。

## Context and Orientation

本项紧急在于账号模型是 #132 宿主装配的前置，并与 E1 冻结目标存在日期冲突；重要性来自凭据隔离、全局身份和工作区配置的基础边界。本轮先形成可审阅模型，不据此冻结数据模型。 选题按 Project 10 的近期时间盒、P0、前置就绪和闭环贡献判断，不用虚构评分；#221 的交付事实修复、#228 的宿主服务及 #140 的会话适配保留为后续独立精化，不与本项聚合。

**已核事实**：2026-10-05 CST 在本分支观察到 `ed6b9ae`，产品内容与 `c38b0b5` 一致；实现前用 `git log -3 --oneline`、`git diff c38b0b5 HEAD -- packages tests` 重算。`packages/storage/sqlite/migrations/002_identity_membership.sql` 已按 `docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md` 分成全局 `provider_binding(id, implementation_key)` 连接锚点和 `workspace_binding(workspace_id,binding_id,domain,enabled,is_default)` 挂载。外部对象自然键仍是 `(binding_id,external_kind,external_id)`。

`packages/core/src/context.ts#createContext` 每次装配都调用 `putProviderBinding`；`packages/core/src/queries.ts` 直接提供原 `ProviderBindingRecord`。因此向现有登记形状追加账号、句柄或配置既可能被重登记清空，也会扩大客户端发布面。`packages/capabilities/src/registry.ts#StorageSurface` 精确锁定 Storage 成员，新增方法必须同步。

宿主依据是 `docs/architecture/harness-host-spike.md` §4 与 §11 的 Q2 / O2.1–O2.3：`credentialRef(name)` 使用 POSIX 环境变量名称形状，`resolve` 每次操作执行，`describe` 不返回凭据值。本计划只保存其中的名称引用，不引入另一套句柄签发协议。

**约束**：pre-MMP 没有真实用户或历史数据迁移义务，但事务、引用身份、幂等性、宿主权威与 Provider ack/reconcile 不变量仍成立。**假设**：一个平台实例中的账号或 installation 暂只需一个凭据引用；多授权 grant 需要后续真实证据。**主不确定性**：自由文本不可能通过列类型证明永不包含秘密，必须明确受信写入边界及可执行的闭集输入规则。

选题依据：2026-10-04 CST 的项目回读把 #126、#133、#130 列为同一时间盒候选；#126 的 native blockedBy 是 #197/#120，二者已关闭，正文仍写 #27/#120。旧正文的平表与依赖说明均不作为新模型事实，不修改人类拥有的依赖关系。实施前重新读取 issue；源差异保留在 Decision Log。

时间约束：Iteration 5 从 2026-10-15 开始，晚于 E1 milestone 的 2026-10-14 目标；两者不是已满足的排期。此轮规划不冻结 v1，#126 模型裁决完成或 #4 明确将其排除之前，#4 继续 hold。主控向人类报告冲突，不擅改 Iteration、Status 或里程碑日期。

## Design / Spec

采用“账号独立、关联在连接锚点、配置在工作区挂载、元数据独立写口”。宿主拥有账号身份、连接状态和受信校验策略；秘密服务拥有凭据值；Storage 拥有提交后的记录。配置不授予权限、不批准文件系统操作、不更改 Planning 状态。

账号自然键为 `(platformFamily, platformOrigin, identityKind, externalId)`。`platformOrigin` 必须为规范 HTTPS origin：无 userinfo、路径、query、fragment，主机小写、默认端口归一；显式区分 github.com 与 Enterprise。`identityKind` 为 `account | installation`，显示名不参与去重。相同 id 不能换自然键，相同自然键不能换 id；显示名、句柄和连接观察状态可更新。重复账号登记不产生第二行。

`provider_binding.connector_account_id` 为可空 FK。初次关联只允许账号、锚点均存在且锚点尚无外部身份、观察、游标、webhook 或写尝试事实；同账号重复关联为 no-op；换账号或给已有事实的无账号锚点补账号必须拒绝，调用者应创建新 bindingId。账号可以支持多个实现/连接范围，不增加 `(accountId,implementationKey)` 唯一约束。注册新账号、绑定、关联、配置的调用顺序为同一 `transaction` 内依次执行，失败整体回滚。

`workspace_binding.configuration_json` 可空，以 `BindingRef = {workspaceId,bindingId,domain}` 定位。配置写入先查真实锚点的 implementationKey，再查受信策略；不接收调用者声称的实现键。未知挂载/实现/schema 拒绝。`putProviderBinding` 只更新既有角色字段，必须保留 account FK 与配置；Fake 替换 mount 时也要合并保留。`removeProviderBinding(ref)` 仅删除该挂载及其配置，账号、连接锚点、外部身份与同步历史保留，缺失挂载重复移除为 no-op。禁用只改变 enabled/isDefault，不删除配置或账号。

`ConnectorAccountRecord` 使用闭集字段解析，不展开任意 unknown 对象。`SecretHandle` 只是编译期品牌，运行时同时校验 `^[A-Za-z_][A-Za-z0-9_]*$` 与宿主注入的名称 allowlist 精确成员关系；`undefined` 表示无认证账号。策略不得读取环境变量或接触秘密值。不存在 UUID 句柄格式，也不把“POSIX 名称”单独视为受信来源。

配置只接受 plain object 和明确声明的标量字段；未知字段、原型对象、数组、嵌套对象、循环、非有限数、函数和 undefined 值拒绝。`BindingConfigurationSchema` 是字段到声明式规则的闭集映射：`{kind:'string',required:boolean,pattern:string,maxLength:number}`、`{kind:'enum',required:boolean,values:readonly string[]}`、`{kind:'boolean',required:boolean}` 三选一，所有规则由受信组合根提供，非任意 boolean callback。必填、长度、锚定正则、枚举逐项校验后返回独立副本。当前夹具分别声明 `planning.github-projects` 的 projectNodeId、`development.local-git` 的 repositoryPath/allowedWorktreeRoot、`harness.fake` 的 scope；项目 id 使用项目 node id 形状，路径字段拒绝 URL/userinfo。实际 realpath 与允许根检查归 Host 文件操作边界。

两个适配器共享 capabilities 中的纯解析器；构造时复制策略的 Set/Map/字段声明，后续修改调用方策略对象不能扩权。写口入队前捕获独立输入副本，队列内对该副本验证并提交；保存、读取、Fake 导入都验证新元数据并返回副本；SQLite 打开时校验已存账号/配置。漏策略使用空 allowlist/schema，既有无元数据使用合法，但有句柄/配置的读写或重开拒绝，修正受信策略后可重试。

SQL 原位重写 002，增加账号表的自然键唯一、状态/identity kind CHECK、锚点 FK、配置 JSON valid/object CHECK；allowlist 的权威仍在受信策略，不由 SQL 内容反推。检测旧 002 表形必须在 `createSqliteStorage` 调用 `migrate` **之前**完成：已有版本 2 而缺新表/列时只读拒绝并关闭句柄，不先落后续迁移；当前空库正常迁移。直接构造 `SqliteStorage` 也做同样检查。不给旧实验库加迁移、双读或删除操作。

安全承诺是“无凭据值槽位，凭据入口只接收允许的引用，配置字段封闭，宿主不向元数据口传入解析结果”。不承诺任何 TEXT 列在物理上不能容纳秘密；PR schema review 明示 displayName/externalId/路径的受信输入前提。错误只报告固定操作/字段，不回显输入、SQL、句柄或账号文本。已知秘密 canary 扫描用于发现回归，不能当通用秘密识别证明。

## Global Constraints

完整允许文件集只在此声明：`packages/domain/src/ids.ts`；`packages/capabilities/src/connector-account.ts`（新）、`packages/capabilities/src/storage.ts`、`packages/capabilities/src/registry.ts`、`packages/capabilities/src/index.ts`；`packages/providers/fake/src/storage.ts`；`packages/storage/sqlite/migrations/002_identity_membership.sql`、`packages/storage/sqlite/src/storage.ts`、`packages/storage/sqlite/src/storage-rows.ts`、`packages/storage/sqlite/src/storage-sync.ts`；`tests/contract/suites/storage-connector-account.js`（新）、`tests/contract/storage-connector-account.test.js`（新）；`tests/integration/storage-connector-account.test.js`（新）、`tests/integration/identity-membership-schema.test.js`、`tests/integration/identity-membership-enums.test.js`、`tests/integration/execution-relation-write-schema.test.js`；本计划、`docs/README.md`。若实测需要超出集合，先在此修订原因与所有权；不能悄悄扩面。

`packages/storage/sqlite/src/storage-sync.ts` 的扩面原因与所有权（2026-10-05 CST 实测补入）：旧 002 表形的**迁移前拒绝**与策略传递必须由工厂 `createSqliteStorage` 的 `migrate` 之前预检、以及根实例构造函数自检**两条入口共用同一判据**，而构造函数、事务作用域创建与写者/读者队列都只在这份基类文件里。若把预检只放在 `storage.ts`，直接构造 `SqliteStorage`（集成测试与宿主装配的实际入口）就绕过它，计划里「直接构造也做同样检查」的承诺不成立。新增判据 `isConnectorAccountShapeMissing` / `CONNECTOR_ACCOUNT_SCHEMA_MESSAGE`、构造函数的策略形参与已存元数据自检都归本 Storage 单元唯一 owner（与工厂同一人），不引入第二个预检点。

本轮只写计划与索引，不实现产品。未来一个 owner 负责本 Storage 单元；与 #133/#130 的调查和不相交修改可并行，Storage port、SQL 和公共 export 由主集成者串行落 patch，重跑共同契约，不把语义并行误写成无冲突保证。不修改 UI、外部 Provider 行为、Host resolve、Project Status 或人类依赖边。

单 PR 预算为代码 add+delete ≤800 行、文档 ≤1300 行，测试/fixture 算代码；这是执行门，不是已测结果。估算分配：类型/端口/导出 90、校验策略 105、SQL/映射/表形检测 90、SQLite 方法 100、Fake 80、契约 200、集成与旧 fixture 110，共 775，余量 25。文档目标 500；实施前逐文件复核预算，超过门限必须重新切片或去掉重复表达，不删判别性测试。

2026-10-05 CST 实测修订（对抗验证三轮 + 最终验收轮）：实测代码累计 **994 行**，超出本计划 800 行执行门 194 行；仓库硬门代码 ≤1000 行**仍通过但余量只剩 6 行**（第二轮末为 955/余 45）。超门来源可逐项归因：第一轮 P1-1 / P1-2 / P2-2 与 P2-1 / P2-3 / P3-1–P3-3 约 120 行，第二轮 P2-R1 / P2-R2 / P2-R3 / P3-R1 / P3-R2 约 66 行，第三轮 P3-R3（策略快照单次化）与 P3-R4（列名大小写不敏感）约 39 行（其中含把三个损坏库夹具收成一个 helper 的净省），最终验收轮 P1 回归修正与 M7 断言收紧为**净增 0 行**（等量改写）。其中 P1-1、P1-2、P2-2、P2-R1、P2-R2、P3-R3 是 Design / Spec 明文要求的信任边界（构造期策略快照、默认策略不可被进程内导入者污染、已记账损坏库不得先落后续迁移、失败构造不得泄漏句柄或留下半迁移、形状判据须覆盖残缺列集、策略失败必须先于 IO），按本节规则「不删判别性测试」，四轮只做注释与同形逻辑收敛（累计净省约 35 行）后仍超门。裁定：保留全部修复与判别用例，把超门记为事实；**仓库硬门余量 6 行意味着后续任何净增都会破门**，人类合并裁决时按后备切片（账号身份/保留/两存储一层，配置/重登记/重启/两存储一层；第一层仅 Refs、第二层 Closes）重新分发。此修订不改仓库硬门，也不构成对超门或贴近硬门的放行。

保持 Node/pnpm 与锁文件既有配置，domain 不反向依赖 capabilities；无新增依赖。只重写现有实验 schema，不新增兼容迁移。元数据不加入 `ProviderBindingRecord`、CoreQueries 或 client snapshot。保留现有唯一写者队列、事务令牌与关闭机制。

## Plan of Work

### Batch 0 · 设计与登记

最小闭环是完成可独立执行的规格、独立评审和文档 PR。主文件为本计划。核源码与两套独立方案，写入关键取舍；主控完成 draft PR / issue 回链与回执。文档检查按下节命令执行；只有该批完成不能声称 #126 已实现。回滚为撤回本计划和索引新增行。

### Batch 1 · 账号、配置和持久化完整闭环

主文件为 `packages/capabilities/src/connector-account.ts`、两个适配器的 `storage.ts`、新共享 suite 和新 integration。先在共享装配注册两个 adapter，测试在基线因缺端口/行为失败；再一次交付类型、闭集校验、SQL、两实现与 fixture 修订。同步 `StorageSurface` 精确成员锁，不分出孤立 port/Fake/SQLite PR。

顺序：实现账号自然键与策略解析；实现不可重绑关联及配置/卸载；沿现有事务接入并向 scopedInstance 传相同策略；修改原位 SQL 和旧裸 INSERT 的列清单；实现空库、旧形状、重启及 core 重登记验收。正常路径与错误路径必须成对，注册守卫明确 suite 名称和两个 adapter，不从实际已注册数组自推期望。

先执行窄契约与集成，再执行 issue 要求的全部 contract/integration、typecheck、boundaries。对 allowlist、实现分派和重登记保留各做一次临时变异，指定测试必须由绿变红，恢复后再绿。验证命令与具体断言见下节。任一拒绝后出现半行、秘密 canary 或错误身份复用即停止交付并回到对应机制。

按本轮人类明确要求，当前 draft PR 即用 `Closes #126` 声明预期完整交付，回读 PR `closingIssuesReferences` 与 issue `closedByPullRequestsReferences` 的双向关联。产品实现和验收仍 pending，保持 draft，不合并、不提前关闭 issue；关闭关键字不作为实现完成证据。默认在该 PR 完成一个产品闭环，实现加判别性测试组成可审阅提交，文档可单独提交。最终 push 前整理临时提交、扫描发布面，push 后回读 head/base/checks/review threads 与 issue 关联；合并需人类授权。整 PR 可独立 revert，恢复旧代码后使用新临时空库，不做数据降级。

只有实际规模超过 800 且已去掉重复夹具时才重新设计两层：账号身份/保留/两存储完整验收一层，配置/重登记/重启/两存储完整验收一层；第一层仅 Refs，第二层才 Closes。每层独立可验收、合并和回滚，先更新本计划与预算，不预造第二 PR。

## Validation and Acceptance

所有命令在上述 `feature/connector-account-storage` 工作树根目录运行；实现命令目前未执行，下面是验收要求。文档阶段不用产品测试替代链接、内容与发布面检查。

| 命令 | 期望 / 用途 |
|---|---|
| `git diff --check` | 文档工作区无空白错误 |
| `node scripts/rule-checks.mjs disclosure origin/main` | 提交后的发布面机械扫描退出 0；另人工检查凭据、本机身份、账号个人信息、内部系统、保密字样 |
| `node scripts/rule-checks.mjs size origin/main` | 仓库规模规则通过；任务额外预算按下一条重算 |
| `git diff --numstat origin/main...HEAD` | 累加 add+delete，fixture 算代码；代码 ≤800、文档 ≤1300，不能仅凭默认规模检查放行 |
| `pnpm install --frozen-lockfile` | 实施环境依赖就绪，不改锁文件 |
| `pnpm run typecheck` | 退出 0，品牌、StorageSurface、事务 scope 一致 |
| `node --test tests/contract/storage-connector-account.test.js tests/integration/storage-connector-account.test.js tests/integration/provider-binding-registration.test.js` | 新共享 suite 的两个 adapter 均真实执行；以下断言全部 pass |
| `node --test tests/contract tests/integration` | issue #126 全部要求通过，无网络、跳过或零用例替代 |
| `pnpm run boundaries` | 依赖边检查退出 0 |
| `git diff --check origin/main...HEAD` | 最终提交 diff 无空白错误 |

新增命名用例与断言：

| 用例 | 必须观察到的行为 |
|---|---|
| `one-account-three-domains` | 一个账号行关联同工作区三域，三条关联读回相同 accountId；另一平台 origin 的同 externalId 是另一账号 |
| `immutable-account-and-anchor-identity` | 同自然键换 id、同 id 换自然键、锚点换账号及有旧事实时首次补账号全部拒绝；快照前后相等；无事实锚点首次关联成功 |
| `configuration-is-workspace-scoped` | 同锚点两工作区/两域配置独立；未知实现、错 schema、未知字段写入失败且旧值不变 |
| `trusted-handle-only` | 允许的 POSIX 引用读回相同；伪造但形状合法名称、token/password/嵌套字段拒绝；缺策略重开拒绝；无句柄账号合法 |
| `registration-and-removal-preserve-account` | core 两次固定 bindingId 装配后账号和配置不变；禁用保留配置；卸载只移除指定挂载，账号/其他挂载/身份仍在 |
| `metadata-transaction-and-copy-isolation` | 事务内成功与失败、重叠事务、排队直接写的结果可判定；失败无半行；修改输入/输出/外部策略副本不改变已存值或授权集合 |
| `restart-and-empty-schema-repeatability` | SQLite close/reopen、Fake export/import 与原记录逐字段相等；两个新临时目录各迁移两次，第二次 applied 为空；旧 002 形状拒绝且不写迁移版本 |
| `secret-canary-never-published` | 拒绝后 DB/WAL/SHM、Fake export、错误文本无原文/base64 canary；core listProviderBindings 无 handle/config；扫描先用阳性对照证明会发现 canary |

canary、错误输入及行为期望独立于实现 parser 构造。临时删除 allowlist 成员检查应使 `trusted-handle-only` 失败；跳过 implementationKey 分派应使配置用例失败；重登记清空配置应使保留用例失败。记录 old-red/new-green 与恢复证据，不把故意变异提交。

## Progress

- [x] (2026-10-05 CST) 完成两套独立方案裁决、源码复核及自包含规格；文件边界见 Global Constraints。
- [x] (2026-10-05 CST) Batch 0 文档自查：13 节顺序、Progress、可移植性、预算与本地链接通过；`git diff --check` 退出 0；独立语义评审 Pass。
- [x] (2026-10-05 CST) 管理登记回执：已创建 [draft PR #270](https://github.com/SingularityKChen/harness-projects/pull/270)，核对双向 issue 引用及 Project 计划字段；产品实施仍 pending。
- [x] (2026-10-05 CST) Batch 1：完成产品闭环、预算实测、共享契约与重启证据。
- [x] (2026-10-05 CST) 对抗验证修复轮：P1-1 策略快照深拷贝、P1-2 默认策略改为每访存新建空集合、P2-2 迁移前判据扩为「已应用版本 2 且形状缺失」；P2-1 显式 undefined、P2-3 读口复验、P3-1/P3-2/P3-3 一并修复并补判别用例。verify-270 的 6/8 证实结论保持，两处 P1 证伪项已转绿。
- [x] (2026-10-05 CST) 第二轮收尾修复：P2-R1 非法策略改为任何 IO 之前失败（不迁移、不留句柄，直接构造失败也关执行侧句柄）；P2-R2 形状判据补齐 `connector_account` 必需列集；P2-R3 `EMPTY_POLICY` 属性描述符冻结；顺带修 P3-R1 读口时序与 P3-R2 坏正则/负长度在构造点拒绝。第二轮复验判定「无 P0、无第一轮 P1、#126 五条验收全部证实」。
- [x] (2026-10-05 CST) 第三轮收尾修复：P3-R3 策略签名改为「每个属性只读一次 + 快照幂等（WeakSet）」并把同一份快照交给构造函数，有状态 getter 不再把失败推到 migrate 之后；P3-R4 形状判据的列名比对改大小写不敏感。第三轮复验判定 P2-R1/R2/R3 与 P3-R1/R2 全部闭合、无回归、无过度拒绝。
- [x] (2026-10-05 CST) 最终验收轮修复：P1（回归）`snapshotPolicy` 命中 WeakSet 时改为「不重读 getter、但仍重新拷容器」，修掉「拿快照结果构造后再改该结果的 Set 可扩权」；P3（判别力）`immutable-account-and-anchor-identity` 的同自然键换 id 断言收紧为 `RangeError` 且不含驱动文本。净增 0 行（代码 994 不变）。
- [ ] (2026-10-05 CST) 最终远端回读、独立验收与人类合并决定；通过后归档计划。

Batch 1 实测证据（均在 `.worktrees/connector-account-plan` 工作树根）：

- `node --test tests/contract/storage-connector-account.test.js tests/integration/storage-connector-account.test.js tests/integration/provider-binding-registration.test.js`：47 tests / 47 pass / 0 fail，exit 0。
- `node --test --test-timeout=120000 tests/contract tests/integration`：1092 tests / 1092 pass / 0 fail，exit 0（基线 1074，新增 18）。
- `node --test --test-timeout=120000 tests/e2e tests/mvp0`：64 / 64 pass，exit 0。
- `pnpm run typecheck`、`pnpm run boundaries`：exit 0（boundaries 8/8 pass）。
- 变异（临时改后恢复，不提交）：删 allowlist 成员检查 → 两个 adapter 的 `trusted-handle-only` 均红；跳过 implementationKey 分派 → 两个 adapter 的 `configuration-is-workspace-scoped` 均红；重登记清空配置 → 两个 adapter 的 `registration-and-removal-preserve-account` 均红；删工厂 `migrate` 前预检 → `restart-and-empty-schema-repeatability` 红。恢复后 45/45 绿。

对抗验证修复轮实测（2026-10-05 CST，同样临时改后逐字节恢复）：

- 复现脚本 `node .superpowers/adv/p1-policy.mjs`：修复前 sqlite/fake 均 ACCEPTED 且落库 `{"scope":"workspace","injected":true}`、默认工厂接受 `ESCALATED`；修复后默认工厂与嵌套扩权段均为 `rejected:RangeError`、`setSize before=0 after=0`。该脚本的 `[nested-schema] fake` 行仍是 ACCEPTED，原因已单独复现并定性为**脚本顺序效应而非缺陷**：脚本在循环第一轮（sqlite 迭代）就执行了 `values.push('EVIL')` / `schema.injected = …`，到第二轮才 `createFakeStorage(undefined, callerPolicy)`，即 Fake 是「构造发生在变异之后」。对照实验（`node --input-type=module` 内联，构造在变异前）显示 `constructed BEFORE mutation -> rejected:RangeError`，构造在变异后则必然接受（那已不在快照语义范围内）。
- 复现脚本 `node .superpowers/adv/adv-v2.mjs`：修复前 `[1,2]` → `[1,2,3,4,5]` 后才以裸驱动错误失败；修复后错误文案为 `CONNECTOR_ACCOUNT_SCHEMA_MESSAGE`，`AFTER` 仍为 `{"versions":[1,2],"tables":["schema_migrations"]}`。
- 补充脚本 `.superpowers/adv/fix-verify.mjs`（构造之后才改嵌套声明）：sqlite 与 fake 的 `values-push` / `add-field` / `explicit-undefined` 三问全部 `rejected:RangeError`。
- 本轮变异：规则不做深拷贝（`fields[name] = rule`）→ 两个 adapter 的 `metadata-transaction-and-copy-isolation` 红；`EMPTY_POLICY` 改回共享单例 → 同用例红；形状判据退回「只看 `provider_binding`」→ `restart-and-empty-schema-repeatability` 红；删 `bindingRefOf` 前置校验 → `configuration-is-workspace-scoped`（sqlite）红；删读口复验 → 两个 adapter 的 `trusted-handle-only` 红；删显式 undefined 拒绝 → 两个 adapter 的 `configuration-is-workspace-scoped` 红；恢复后全部绿。
- 其余对抗 fixture 复跑：`t8-canary`（含 `fake-import-orphan-config` / `fake-import-orphan-account-link` / `empty-policy-mutation` 三探针）、`t11-malformed`、`t9-cross`、`t15-read-validate` 均为修复后预期值；`t14-update` 以非零退出报告 `RangeError: binding configuration must not contain an undefined value`，即 P2-1 修复后的预期拒绝（脚本原断言该输入被接受）。

第二轮收尾修复实测（2026-10-05 CST，针对 verify-270 在 `4bef6f2` 上的 P2-R1 / P2-R2 / P2-R3 与 P3-R1 / P3-R2；仍为临时改后逐字节恢复）：

- P2-R1：`createSqliteStorage` 在任何 IO 之前 `snapshotPolicy(policy)`，非法策略直接失败（`snapshotPolicy` 本身不碰库）；工厂构造挪回 `try`，构造函数内策略快照与自检共用同一 catch，`closeQuietly` 让工厂与构造函数各自关闭是幂等 no-op。实测：`.superpowers/adv/r2-ctor-leak.mjs` 六种坏策略全部 `fds 13 → 13 (delta 0)`、`migrated-in-failed-ctor=[]`、直接构造 `db closed:Error`；`r2-fd-leak-repro.mjs` 的 30 次坏策略构造 `fds 12 → 12 (delta 0)`，被拒构造库连 `schema_migrations` 都不存在（旧行为：迁移到 [1,2,3,4,5] 且 fds +29）。
- P2-R2：形状判据新增 `CONNECTOR_ACCOUNT_COLUMNS` 逐列比对。`r2-partial-table.mjs`：`connector_account(id)` 残缺库由 `Error:no such column: platform_family` + 版本 `[1,2]→[1,2,3,4,5]` 变为「连接账号形状」拒绝 + 版本 `[1,2]→[1,2]`；集成用例新增该变体并断言全表 fingerprint 不变。
- P2-R3：`EMPTY_POLICY` 外层加 `Object.freeze`。`r2-empty-redefine.mjs` 的 `Object.defineProperty(...)` 由静默生效变为 `TypeError: Cannot redefine property`。
- P3-R1：SQLite `getBindingConfiguration` 改为 `async`。`r2-sync-throw.mjs` 六个调用全部 `async-reject:RangeError`（修复前 sqlite 读口为 `SYNC-THROW`）。
- P3-R2：`copyRule` 在构造点试编译 `pattern` 并要求 `maxLength >= 0`。`r2-new-edges.mjs` 的 `pattern-invalid-regex` / `maxLength-negative` / `maxLength-float` / `maxLength-NaN` 在两个适配器上全部由「constructed + 写入时才炸」变为 `ctor-throw:RangeError`。
- 收尾变异（同样只改一处、恢复后复跑）：把工厂构造挪回 `try` 之外且删掉 IO 前的策略快照 → 新增 `constructor-failure-releases-handle-and-policy-is-frozen` 红；形状判据退回「只看存在性」→ `restart-and-empty-schema-repeatability` 红；`EMPTY_POLICY` 去冻结 → 该新增用例 + 两个 adapter 的 `metadata-transaction-and-copy-isolation` 红（3 fail）；坏正则/负长度不校验 → 同 3 条红；SQLite 读口去掉 `async` → `configuration-is-workspace-scoped`（sqlite）红。恢复后 17/17 绿。

第三轮收尾修复实测（2026-10-05 CST，针对 verify-270 第三轮在 `a114ee6` 上的 P3-R3 与 P3-R4；仍为临时改后逐字节恢复）：

- P3-R3：`snapshotPolicy` 改为「每个属性只读一次 + WeakSet 记录本模块产出过的快照」；工厂把快照交给构造函数，构造函数只在收到非快照对象时才自行快照（直接构造的调用方语义不变）。`node .superpowers/adv/r3-toctou2.mjs`：有状态 getter 策略由「reads=4、file=CREATED、migrations=[1,2,3,4,5]」变为「reads=1、正常打开」；首次读即脏的策略在 `r3-before-io.mjs` 仍是 `RangeError` 且 `file-created=false`。新增用例 `policy-snapshot-is-read-once-and-precedes-io`（`reads === 1`、脏首次读不得创建库文件）与 `metadata-transaction-and-copy-isolation` 的嵌套扩权断言。**注**：该轮曾把命中判据实现为「原样返回同一引用」，被最终验收轮判定为 P1 回归，已在本页下方第四轮修正为「不重读 getter、但仍重拷容器」。
- P3-R4：形状判据的列名比对改 `toLowerCase()`。`r3-case-and-types.mjs` 的 `uppercase-columns` 由 `REJECT:Error`（误拒合法大写声明库）变为 `OPEN`；`r3-shape-columns.mjs` 的 `case-different-column` 由 `REJECT` 变 `OPEN`，同时 `missing-one-column` / `missing-three-columns` / `id-only` 仍全部 `REJECT` + 零写入，`extra-column` 与完整库仍 `OPEN`（无过度拒绝）。列类型错（`datatype mismatch`）仍穿过形状判据——SQLite 动态类型所致，形状判据只保证列存在性，已随本轮记入 `TD-029`。
- 第三轮变异：把工厂改回「两次快照 + 传调用方原对象」→ `policy-snapshot-is-read-once-and-precedes-io` 红；列名比对退回大小写敏感 → `restart-and-empty-schema-repeatability` 红（大写变体）。恢复后 18/18 绿。**诚实标注**：当轮记录的第三条变异「删掉 WeakSet 幂等分支 → 两个 adapter 的 `metadata-transaction-and-copy-isolation` 红」依赖的是当轮契约里 `snapshotPolicy(snapshot) === snapshot` 这条断言；该断言在第四轮已被替换为更强的「改快照不得扩权」断言，因此该条变异在当前代码上不再可复现（删幂等分支不再变红）——不是判别力丢失，而是旧断言所钉的正是后来被证伪的语义。

第四轮（最终验收轮）修复实测（2026-10-05 CST，针对独立验收者在 `b6f66de` 上的 P1 回归与 M7 判别力缺口；仍为临时改后逐字节恢复）：

- P1（回归，由第三轮修法引入）：`snapshotPolicy` 命中 `POLICY_SNAPSHOTS` 时**原样返回同一引用**，而快照内的 `allowedSecretHandles`（Set）、`configurations`（Map）与嵌套 `values` 仍可变；工厂把该引用交给构造函数后，改这份结果就等价于改实例的授权集合。复现（两适配器）：`snapshotPolicy` 结果 → 构造 → `add('ESCALATED')` → 写入 `ACCEPTED`（应为 `RangeError`）；对照 `a114ee6` 同一路径 `rejected`。修法：命中 WeakSet 只表示「已验证、无需重读调用方 getter」，`source = cached ?? policy` 之后仍走原有深拷逻辑，每次返回新的冻结容器；契约断言由「返回同一份」改为「`reads` 不增且改快照不得扩权」。
- P3（判别力，M7）：`immutable-account-and-anchor-identity` 里「同自然键换 id」原先只写 `assert.rejects(..., '消息')`，删掉实现里的显式守卫后由 SQLite 的 `UNIQUE` 以裸驱动 `Error: UNIQUE constraint failed…` 兜底，用例仍绿。断言收紧为 `error instanceof RangeError && !/UNIQUE|constraint/i.test(error.message)`（两适配器同语义，Fake 侧本就抛 `RangeError`）。
- 第四轮变异：把 `snapshotPolicy` 退回「命中即原样返回」→ 两个 adapter 的 `metadata-transaction-and-copy-isolation` 红；删 SQLite 的同自然键守卫（保留收紧断言）→ `immutable-account-and-anchor-identity`（sqlite）红；**同时**删守卫并把断言退回旧写法 → 重新变绿（M7 复现，证明缺口真实存在且已被收紧断言关闭）。恢复后 18/18 绿。
- 规模：本轮净增 **0 行**——代码仍为 **994 / 1000**（写侧 +4/−5、测试 +5/−4），仓库硬门余量仍 6 行；文档同步更新。
- 补充脚本 `.superpowers/adv/fix-verify-r2.mjs` 作为修复后期望值的自包含断言集：P2-R1 fd delta 0 且无记账、P2-R2 拒绝且版本不变、P2-R3 frozen、P3-R1 双适配器异步拒绝、P3-R2 双适配器构造点 RangeError，全部通过。

## Surprises & Discoveries

2026-10-05 CST：issue 所写 `provider_binding.workspace_id` 已不在现有表；实际拆分见 002 与 ADR-0006。按旧正文做聚合写会误置配置作用域。

同日核 `createContext` 与 Fake `toBindingMount`：core 重装配确实重新登记，Fake 当前整条替换 mount。仅给新字段默认 undefined 会把已有配置清掉，必须显式保留。

同日核 `migrate.ts`：已应用迁移仅按版本跳过；现有 `storage-sync.ts` 启动检查发生在 migrate 之后。因此旧 002 拒绝须在工厂迁移前补只读预检，不能只复制现有检查时点而承诺零写入。

宿主 Q2 已观察按名称引用与逐操作解析；随机 UUID 字符串协议没有相应宿主证据。自由文本可携带任何内容，秘密保证必须收敛到受信接口，不能把 schema review 写成绝对证明。

2026-10-05 CST 实测：`json_valid` / `json_type` 的 CHECK 可以建表，但 **SQLite 要求表级约束出现在全部列定义之后**；把新列写在旧表级 `CHECK (is_default = 0 OR enabled = 1)` 之后会让 `002` 在解析阶段报 `near "configuration_json": syntax error`，而 `migrate` 只回报一个位置模糊的驱动错误。修正为把 `configuration_json` 插在 `is_default` 之后、表级约束之前，并在迁移文件里注明这条排序要求。

2026-10-05 CST 实测：`node --test` 的断言消息/末行只给测试名，定位方法体错误仍需看完整输出，因此 `restart-and-empty-schema` 的预检用例把「旧 002 形状 + 缺连接账号表/列」写成临时目录夹具，并同时断言 schema、既有行与 `schema_migrations` 三者零改动，让「预检早于 migrate」可判别而不是只由构造函数兜底。

2026-10-05 CST 实测：旧基线的 `identity-membership-schema` / `identity-membership-enums` / `execution-relation-write-schema` 用位置 INSERT 与写死的表/列清单；给 002 加列后这些用例必须先改成显式列清单并同步审计表，否则会因为列错位或未审计表而全红。这类修订属于测验对象变更而不是放宽断言：审计表仍逐列覆盖，新增列必须显式登记。

2026-10-05 CST（对抗验证修复轮）：verify-270 证伪的三条都属「规格已写明、实现只做了顶层」的信任边界，而不是新需求：`snapshotPolicy` 只 `new Map(schemas)` 时，Map 值（schema 对象）与规则里的 `values` 数组仍与调用方共享；`EMPTY_POLICY` 的 `Object.freeze` 不冻结 `Set`/`Map` 内容；形状判据以「`provider_binding` 存在」为前提，会放过「版本 2 已记账但表整体缺失」的损坏库，让它先被 003–005 半升级。三处修复都不改变数据模型，代价是构造与读路径各多一层拷贝/复验。教训：**冻结外壳不等于冻结内容**，以及「判据的前提条件」本身就是判据的一部分——`if (provider_binding 存在)` 这种早退会把更坏的输入排除在检查之外。

2026-10-05 CST（第二轮收尾）：**修复本身也会引入新的失败面**。第一轮给 `snapshotPolicy` 加了规则级校验后，「非法策略」从罕见类型错误变成常见输入错误，于是暴露出工厂把构造放在 `try` 之外、由此每次失败泄漏句柄并留下半迁移的路径（P2-R1）——这不是新引入的分支，而是被扩大的抛错面照出来的旧缺口。同类还有 P2-R2：第一轮把判据从「`provider_binding` 存在」推进到「版本 2 已记账」，但没有同时把判据从「表/列存在性」推进到「列集完整性」，于是 `connector_account(id)` 这种残缺库仍能穿过。教训：**收紧判据时要连它检查的维度一起收紧（存在性 → 完整性），并检查新抛错点的清理路径是否覆盖全部入口**。另外，JS 的 `Object.freeze` 只冻结属性描述符，对 getter 型的 `EMPTY_POLICY` 恰好够用（内容每次新建），但对第一轮的 Set/Map 单例不够——同一个 API 在两种实现下语义不同，必须分别判别。

2026-10-05 CST（第三轮收尾）：**「先于 IO 校验」与「快照」是两件事，中间夹着调用方代码**。第二轮把 `snapshotPolicy` 提到 `openDatabase` 之前，但工厂与构造函数各自快照一次；对普通对象无差别，对有状态 getter 就等于把「同一次校验」读成两个不同的值：第一次干净（IO 通过）、第二次脏（migrate 之后抛错），于是留下一个已迁移到 [1,2,3,4,5] 的空库。修法不是再加一层预检，而是让**快照只发生一次、结果被复用**（每个属性只读一次 + WeakSet 标记）——判据统计次数本身也成了断言（`reads === 1`）。教训：任何「校验 A、稍后使用 A'」的两段式设计，只要 A 的读取有副作用或非确定性，就必须显式传递结果而不是重新求值。同轮的 P3-R4 是反向教训：判据按 `pragma_table_info` 的声明拼写比对列名，比 SQLite 自身的标识符语义**更严**，于是误拒了大写声明的合法库——判据的严格度不能超过它所校验的系统语义。

2026-10-05 CST（最终验收轮）：**第三轮的修法本身引入了新 P1——「复用快照」被实现成「复用同一个可变对象」**。命中 WeakSet 时 `snapshotPolicy` 原样返回同一引用，而它内部仍是 `Set` / `Map` / 数组；于是「构造时复制策略、之后改调用方对象不得扩权」这条 Design 明文承诺，在调用方自己先调 `snapshotPolicy`、再构造、再改这份结果的路径上失守（两适配器同结论，改 `allowedSecretHandles` 后 `ESCALATED` 被接受）。根因是把两种「幂等」混为一谈：**读取幂等**（不必重读 getter）与**所有权幂等**（返回同一个可变对象）是不同承诺，前者是性能/时序优化，后者直接取消隔离。修法是命中只跳过 getter 读取（`source = cached ?? policy`），容器仍走原有深拷，因此第四轮的契约断言也从「返回同一份」改为「`reads` 不增且改快照不得扩权」——**旧断言恰恰钉住了后来被证伪的语义**，这提示判别性断言要钉"外部可观察的安全性质"，而不是钉实现选定的等价性。同轮另一个教训来自 M7：只写 `assert.rejects(..., 消息)` 时，删掉实现里的显式守卫仍会绿，因为数据库 UNIQUE 约束以裸驱动错误兜底——**断言必须钉住承诺的错误类型与「不回显驱动文本」，否则守卫的判别力会被下层兜底掩盖**。

## Decision Log

| 日期 / 作者 | 决策与理由 |
|---|---|
| 2026-10-05 CST / 独立最终评审者 | 采用方案 B 的精简单 PR 和独立元数据写口；方案 A 的两纵向 PR 作为超预算后备。A 约 740+410、B 约 740 都是估算，不能据此断言已满足门禁；最终预算见 Global Constraints。 |
| 同日 / 独立最终评审者 | 拒绝 A 的 UUID 句柄协议，沿宿主 POSIX 引用加受信 allowlist；吸收 A 的旧表形拒绝与身份约束，补齐 B 漏掉的平台 origin 和有历史事实锚点补绑防线。 |
| 同日 / 独立最终评审者 | 不用账号取代连接锚点，不将 metadata 塞入 ProviderBindingRecord；减少身份重解释与 client 泄露。独立方法足以满足闭环，不新增冗余 findConnection/连接自然键。 |
| 同日 / 独立最终评审者 | 单一 Storage owner 和主控串行集成公共文件；#133/#130 与本项语义并行。后续 #126→#132、#221→#222 有真实能力依赖，更适合堆叠；这不是新增 native blocked-by 写入授权。 |
| 同日 / 独立最终评审者 | native blockedBy #197/#120 已关闭是协调回读来源，正文 #27/#120 是旧来源。保留来源差异与回读门，不改 Status、Priority、Size、Iteration 或关系。 |
| 同日 / 独立最终评审者 | 按人类本轮要求，draft 阶段即登记 Closes 与双向关闭关联，表示预期交付；实施和验收 pending，不能据此合并或关闭 issue。Iteration 5 晚于 E1 目标，模型裁决或明确排除前 #4 继续 hold，不擅改排期。 |
| 同日 / 独立最终评审者 | 采用 First Principles 的结果/约束拆分和 Qian 的状态拥有/全链失败分析；Superpowers 的先设计后实现、判别性验证用于本计划，按用户只设计范围不进入产品实现。 |
| 2026-10-05 CST / 实现者 | 预检判据与策略形参落在 `packages/storage/sqlite/src/storage-sync.ts`（扩面，理由与所有权见 Global Constraints）：直接构造 `SqliteStorage` 的调用方与工厂 `migrate` 前预检必须共用同一判据；若只在 `storage.ts` 里做预检，集成测试与宿主装配入口会绕过它。 |
| 2026-10-05 CST / 实现者 | 已存元数据的策略自检放在根实例构造函数：打开时重放账号与配置的闭集校验（漏策略的空库合法）。这让 `trusted-handle-only` 的「缺策略重开拒绝」在两个适配器上同形，而不是只在写入路径有效。 |
| 2026-10-05 CST / 实现者（对抗验证修复轮） | 接受 verify-270 的 P1-1 / P1-2 / P2-2 判定并逐条修复：快照从「顶层 Set/Map 拷贝」升级为「规则与 `values` 的冻结深拷贝」；`EMPTY_POLICY` 从共享可变单例改为每访存新建空集合的 getter；迁移前形状判据从「`provider_binding` 存在」改为「`schema_migrations` 已有版本 2」。次要点一并修 P2-1（显式 `undefined` 拒绝）、P2-3（读口复验）、P3-1/P3-2/P3-3（畸形 ref 统一 `RangeError`、Fake 导入引用完整性、remove 畸形 ref 拒绝）。规模代价：修复净增代码约 95 行，实测 **889 行**，超出本计划 Global Constraints 的单 PR 执行门 800 行（仓库硬门 1000 行仍满足）。取舍：三条 P1/P2 均为规格明文要求的信任边界（策略快照隔离、默认策略不可污染、已记账损坏库不得半升级），且判别用例不可回退；按计划「超过门限必须重新切片或去掉重复表达，不删判别性测试」的规则，本轮先做注释与同形逻辑收敛（净省约 11 行），仍实测超门 89 行。裁定：保留修复与全部判别用例，把 800 行执行门记为**本轮超门事实**，由人类在合并裁决时决定是否按计划后备切分为两层 PR；仓库硬门（代码 ≤1000）通过。 |
| 2026-10-05 CST / 实现者（对抗验证修复轮） | 读口复验（P2-3）的判据是「Storage 是唯一受信写者」之外的纵深：SQLite 走 `parseConnectorAccount` / `parseBindingConfiguration`（配置按真实锚点 `implementationKey`），Fake 走同一解析器（`data` 是公开字段，测试与宿主可直接改写）。代价是每次读多一次闭集解析；不做缓存，避免又引入可被绕过的快路径。 |
| 2026-10-05 CST / 实现者（第二轮收尾） | P2-R1 的修法选择「把策略快照提到任何 IO 之前」而不是「打开后再关句柄」：`snapshotPolicy` 是纯校验、不碰库，先跑就能同时消除句柄、迁移写入和「文件被创建」三种副作用；工厂构造挪回 `try` 与构造函数内共用 catch 作为第二道保险，覆盖直接构造的调用方。让关闭幂等（`closeQuietly`）是因为两条清理路径会对同一句柄各关一次，驱动第二次 `close()` 会以 `database is not open` 覆盖真正的错误原因。 |
| 2026-10-05 CST / 实现者（第二轮收尾） | P2-R2 把判据从「表/列存在性」收紧为「`connector_account` 必需列集逐项比对」：与 003 的 `assertRewritten003Shape` 同法，列清单只写一次。判定为**修**而不是登记债务，因为「版本 2 已记账但形状不完整」与第一轮 P2-2 是同一类「看起来已迁移、实则半升级」的库，登记会留下同类第二个洞。 |
| 2026-10-05 CST / 实现者（第二轮收尾） | 次要点 P3-R1（SQLite 读口同步抛）与 P3-R2（坏正则到写入才 `SyntaxError`）本轮一并修：前者加 `async`（零成本对齐两个适配器的时序），后者在 `copyRule` 试编译正则并要求 `maxLength >= 0`（构造点 `RangeError`，符合「所有新校验失败使用 RangeError」）。两者都有判别用例；不登记债务。 |
| 2026-10-05 CST / 实现者（第二轮收尾） | 规模：收尾修复净增代码约 66 行，实测 **955 行**，超出本计划 800 行执行门 155 行（仓库硬门 1000 行通过，余量 45 行）。`TD-028` 的数字与裁决路径随本轮更新；维持「不删判别性测试」并保留超门事实，由人类合并裁决决定是否切片。 |
| 2026-10-05 CST / 实现者（第三轮收尾） | P3-R3 的修法是「让快照只发生一次」而不是「在构造函数里也提前校验」：`snapshotPolicy` 两个属性各读一次、结果记入模块级 `WeakSet`，命中即原样返回；工厂把这份快照交给构造函数，构造函数只在收到未标记对象（直接构造路径）时才自行快照。这样「先于 IO 失败」对小对象与有状态 getter 策略都成立，且不改变直接构造语义。判据统计次数（`reads === 1`）成为断言的一部分，防止将来有人在两处重新求值。 |
| 2026-10-05 CST / 实现者（第三轮收尾） | P3-R4（列名大小写）判定为**修**：把列名 `toLowerCase()` 后比对，只多一个方法调用；不修会让判据比 SQLite 的标识符语义更严、误拒大写声明的合法库。列类型错（动态类型导致 `datatype mismatch`）不在形状判据范围内，登记 `TD-029`（手工损坏库的类型审计），写明下一步与承接条件。 |
| 2026-10-05 CST / 实现者（第三轮收尾） | 规模：第三轮净增代码约 39 行（含把三个损坏库夹具收成一个 `seedVersion2` helper 的净省），实测 **994 行**；仓库硬门 1000 行余量只剩 6 行。这使「再增行」成为硬约束：后续任何净增都必须先减行或走切片，已在 Global Constraints 与 `TD-028` 写明。 |
| 2026-10-05 CST / 实现者（最终验收轮） | 接受最终验收者的 P1 判定：第三轮把 `WeakSet` 命中实现为「原样返回同一引用」是把**读取幂等**当成了**所有权幂等**——前者只是「已验证、无需重读 getter」，后者取消了构造后隔离。改为命中时 `source = cached ?? policy`、容器仍走原有深拷，`snapshotPolicy` 的公开语义回到「每次返回独立冻结副本，且对已快照输入不重读 getter」。契约断言同步从「返回同一份」改为「`reads` 不增 + 改快照不得扩权」；旧断言被删除，因为它钉住的正是被证伪的语义。 |
| 2026-10-05 CST / 实现者（最终验收轮） | 接受 M7 判别力缺口判定：`immutable-account-and-anchor-identity` 的「同自然键换 id」只写 `assert.rejects(..., 消息)`，删掉显式守卫后 SQLite 的 `UNIQUE` 以裸驱动 `Error: UNIQUE constraint failed…` 兜底而用例仍绿。断言收紧为 `error instanceof RangeError && !/UNIQUE\|constraint/i.test(error.message)`（两适配器同语义，Fake 侧本就抛 `RangeError`）；已复现「删守卫（收紧断言下）红 / 删守卫 + 退回旧断言又绿」两种状态，证明缺口真实且已关闭。 |
| 2026-10-05 CST / 实现者（最终验收轮） | 规模：本轮**净增 0 行**（写侧 +4/−5、测试侧 +5/−4，等价改写），代码仍 **994/1000**、余量 6 行；文档按本页增量更新。没有为压行删任何判别性测试。 |
| 2026-10-05 CST / 实现者（最终验收轮） | 已知缺项（不自行修改外部面）：issue #126 要求 PR 描述包含「schema review 明示受信输入前提」段，当前 PR #270 正文缺失；实现者未被授权写 PR，故只在此登记，交由主控在 push 时补入。 |

2026-10-05 CST / 主控：Actor 为 SingularityKChen；管理目标是 GitHub 仓库 SingularityKChen/harness-projects 与 Project 10，不虚构产品内 ProviderBinding。幂等标识为 `plan/issue-126/feature/connector-account-storage`，字段赋值以 issue/字段名去重；创建结果为 PR #270。观察时刻 @ 2374dbdf0497：base=main、draft=true，PR closingIssuesReferences 包含 #126、issue closedByPullRequestsReferences 包含 #270，无评审线程，标题/标签/issue policy 检查通过。Project ExecPlan/Batch 已回读匹配，Kind/Area/M4 已具备；Status=Todo、Priority=P0、Size=M、Iteration 5 及依赖关系保持原值。易失结果用 `gh pr view 270 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup` 和 `gh issue view 126 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences,projectItems` 复读；最终文档 push 后再次回读当前 head/checks。

## Idempotence and Recovery

相同账号/关联/配置重写不增行；同挂载重复移除成功。事务必须使用 tx 对象，复用 SQLite atomic/read 与 Fake 草稿提交，不吞掉拒绝后继续宣称整个事务成功。策略在根实例和事务实例间一致，不在 scope 内退回空策略。旧形状拒绝先关闭句柄，保留原目录和文件；实施者只能创建新的临时空目录测试，不自动删除实验库。

代码回滚以整闭环 PR revert 为单位；原位 DDL 无 downgrade 承诺，回退测试使用新空库。操作中断后先检查工作区 diff、测试和 Progress，再从失败用例继续。重复执行文档登记前读回同分支 PR 和 issue，避免重复创建或评论。

本计划不引入已知临时实现债。多授权 grant、宿主连接装配/凭据 resolve 属明确范围外；#132 接入时需验证受信策略来源与每操作解析。若为规模而延期任何本项验收，不能标完成；新增实质债须先扩展 Global Constraints，将具名 owner、原因、影响和下一步写入 `docs/exec-plan/tech-debt-tracker.md`，再更新验收裁决。

## Interfaces and Dependencies

拟议签名如下，均属 Storage 内部与受信 Host 组合入口；`StorageTransaction = Omit<Storage,'transaction'>` 自动包含新方法。

```ts
type ConnectorAccountIdentity = { readonly platformFamily: string; readonly platformOrigin: string;
  readonly identityKind: 'account' | 'installation'; readonly externalId: string }
type ConnectorAccountRecord = ConnectorAccountIdentity & { readonly id: ConnectorAccountId;
  readonly displayName: string; readonly secretHandle: SecretHandle | undefined;
  readonly connectionState: 'connected' | 'disconnected' | 'reauth_required' }
type BindingConfigurationRecord = { readonly ref: BindingRef;
  readonly configuration: Readonly<Record<string, string | boolean>> }
type StorageValidationPolicy = { readonly allowedSecretHandles: ReadonlySet<string>;
  readonly configurations: ReadonlyMap<string, BindingConfigurationSchema> }
putConnectorAccount(record: ConnectorAccountRecord): Promise<void>
getConnectorAccount(id: ConnectorAccountId): Promise<ConnectorAccountRecord | undefined>
listConnectorAccounts(): Promise<readonly ConnectorAccountRecord[]>
setProviderBindingAccount(bindingId: ProviderBindingId, accountId: ConnectorAccountId): Promise<void>
getProviderBindingAccount(bindingId: ProviderBindingId): Promise<ConnectorAccountId | undefined>
putBindingConfiguration(record: BindingConfigurationRecord): Promise<void>
getBindingConfiguration(ref: BindingRef): Promise<BindingConfigurationRecord | undefined>
removeProviderBinding(ref: BindingRef): Promise<void>
createSqliteStorage(location: string, policy?: StorageValidationPolicy): SqliteStorage
createFakeStorage(data?: FakeStorageData, policy?: StorageValidationPolicy): MemoryStorage
```

`ConnectorAccountId` 品牌与 `newConnectorAccountId()` 位于 domain ids；SecretHandle 品牌、上述记录、规则与纯解析器位于 capabilities 新文件，从现有 index 导出。`SqliteStorage` 显式构造函数拟为 `(location, db, scoped=false, state?, token?, policy=EMPTY_POLICY)`，调用既有基类并保存策略；`scopedInstance` 传同策略。`MemoryStorage` 构造函数拟为 `(data=emptyStorageData(), transactionScope=false, policy=EMPTY_POLICY)`，创建事务草稿时传同策略；工厂和导入复制新数组/字段并验证。

所有新验证失败使用 `RangeError` 和固定无输入文本，缺父行/身份冲突两适配器同语义。SQLite 多语句检查与写入进入同一个 atomic；账号初次关联的事实检查与写 FK 不得跨事务。`connected` 只是观察状态，不承诺句柄能 resolve 或 Provider 权限仍有效。

工具使用仓库锁定 Node/pnpm、SQLite 与既有 node:test，无真实 token、GitHub 网络或宿主安装要求。GitHub 登记由主控执行，执行前在本分支根运行 `gh issue view 126 -R SingularityKChen/harness-projects --json title,body,state`、`gh pr list -R SingularityKChen/harness-projects --head feature/connector-account-storage --state all --json number,url,headRefName,baseRefName,isDraft`；预期只定位本项已有 PR，不覆盖人类字段。外部写入回执记录 actor、仓库/目标、动作幂等标识与回读结果，不虚构本地 ProviderBinding。

## Outcomes & Retrospective

2026-10-05 CST：产物是设计和实施规格，独立语义评审及文档结构/链接自查通过；产品端口、SQL、测试未修改，新功能尚无通过证据。当前下一门是主控登记与提交后发布面检查，之后按 Batch 1 执行完整产品闭环。收口时补实际代码/文档规模、测试与变异结果、远端回读、偏差及债务结论，并将计划移入 completed 更新索引。

2026-10-05 CST（Batch 1 收口）：产品闭环落地。文件集与 Global Constraints 一致，仅新增 `packages/storage/sqlite/src/storage-sync.ts` 一处已声明扩面。验收：新窄命令 45/45 pass、`tests/contract tests/integration` 1090/1090 pass、`tests/e2e tests/mvp0` 64/64 pass、`typecheck` 与 `boundaries` exit 0；四个变异均 old-red→恢复后 new-green。首轮实测 818 行超门 18 行，收敛方式是压注释与把重复的吊挂/列构造收成单点，未删任何判别性测试。未决：`packages/storage/sqlite/src/storage-sync.ts` 的扩面已记入 Global Constraints 与 Decision Log；远端回读、独立验收与人类合并决定仍 pending。

2026-10-05 CST（对抗验证修复轮）：verify-270 报告 6/8 命名用例完全证实、无 P0，证伪 P1-1（策略快照浅拷贝）、P1-2（`EMPTY_POLICY` 共享可变单例）、P2-2（迁移前判据只在 `provider_binding` 存在时生效），并列出 P2-1/P2-3/P3-1/P3-2/P3-3。全部逐条修复并补判别用例；`.superpowers/adv/p1-policy.mjs`、`adv-v2.mjs` 从「ACCEPTED / 部分迁移」变为「RangeError / 零写入」，新增 `.superpowers/adv/fix-verify.mjs` 证明「构造之后」的嵌套扩权在两个适配器上都被拒绝。新增债务：`TD-027`（Fake `data` 公开可变字段与读口复验的残余写入面）。变异证据：规则不深拷 / `EMPTY_POLICY` 回退单例 → `metadata-transaction-and-copy-isolation` 双适配器红；判据退回旧形 → `restart-and-empty-schema-repeatability` 红；删 `bindingRefOf`/读口复验/显式 undefined 拒绝 → 对应用例红；恢复后全绿。

2026-10-05 CST（第二轮复验 + 收尾）：verify-270 第二轮独立复跑判定「无 P0、无第一轮意义上的 P1、#126 五条验收全部证实」，顺序效应判定与实现者一致；同时新增 P2-R1（构造期失败泄漏句柄且库已被迁移）、P2-R2（形状只查存在性不查列集）、P2-R3（`EMPTY_POLICY` 未冻结）、P3-R1（读口同步抛）、P3-R2（坏正则到写入才 `SyntaxError`）。全部逐条修复并补判别用例：策略快照提到任何 IO 之前 + 构造入 `try` + 关闭幂等、形状判据逐列比对、默认策略属性描述符冻结、SQLite 读口改 `async`、`copyRule` 构造点试编译正则并要求 `maxLength >= 0`。验收：窄命令 46/46、`tests/contract tests/integration` 1091/1091、`tests/e2e tests/mvp0` 64/64、`typecheck` 与 `boundaries` exit 0；六个收尾变异各自 old-red→恢复后 new-green。规模实测代码 **955 行**（计划执行门 800 **超出 155 行**；仓库硬门 1000 通过、余量 45 行）、文档随本段更新；`TD-028` 数字同步为 955。未决：远端回读、独立验收、人类合并决定与是否按后备切片拆分仍 pending。

2026-10-05 CST（第三轮复验 + 收尾）：verify-270 第三轮判定 P2-R1/R2/R3 与 P3-R1/R2 全部闭合、无回归、无过度拒绝，fd 数字被精确化为「首次打开 SQLite 的一次性惰性 fd，之后 200 次坏策略 delta 0」；新增 P3-R3（策略快照做两次，有状态 getter 下库先被创建并迁移）、P3-R4（列名按声明拼写比对，大写声明的合法库被误拒）。逐条修复：`snapshotPolicy` 每个属性只读一次 + `WeakSet` 标记，工厂把快照交给构造函数（直接构造路径仍自行快照）；形状判据列名比对改大小写不敏感。验收：窄命令 47/47、`tests/contract tests/integration` 1092/1092、`tests/e2e tests/mvp0` 64/64、`typecheck` 与 `boundaries` exit 0。规模实测代码 **994 行**（计划执行门 800 **超出 194 行**；仓库硬门 1000 通过但**余量只剩 6 行**）；`TD-028` 同步为 994 并写明「后续任何净增都必须先减行或切片」，新增 `TD-029`（形状判据不审列类型）。未决：远端回读、独立验收、人类合并决定与是否切片仍 pending。**该轮埋下一个回归**：WeakSet 命中被实现为原样返回同一引用（见下）。

2026-10-05 CST（最终验收轮）：独立验收者在 `b6f66de` 上判定新 **P1 回归**与一项 **P3 判别力缺口**。P1：`snapshotPolicy` 命中 WeakSet 时返回同一可变引用，调用方先取快照、再用它构造、再修改该快照的 `allowedSecretHandles`，实例即被扩权（两适配器同结论；`a114ee6` 上同一路径 `rejected`）——违反设计与规格明文的「构造时复制、之后改调用方对象不得扩权」，命名用例 `metadata-transaction-and-copy-isolation` 失守。P3（M7）：`immutable-account-and-anchor-identity` 的「同自然键换 id」只断言 `assert.rejects(...,消息)`，删守卫后由 SQLite `UNIQUE` 裸驱动错误兜底而用例仍绿。修复：快照命中只跳过 getter 读取（`source = cached ?? policy`），容器仍走原有深拷，公开语义回到「每次返回独立冻结副本」；断言收紧为 `RangeError` 且不含 `UNIQUE`/`constraint` 文本，并删除那条钉住被证伪语义的 `snapshotPolicy(snapshot) === snapshot` 旧断言。**净增 0 行**，代码仍 **994/1000**（余量 6 行）。验收：窄命令 47/47、`tests/contract tests/integration` 1092/1092、`tests/e2e tests/mvp0` 64/64、`typecheck` exit 0、`boundaries` 8/8。变异：退回「命中即原样返回」→ 两个适配器的 `metadata-transaction-and-copy-isolation` 红；删 SQLite 同自然键守卫（收紧断言下）→ `immutable-account-and-anchor-identity` 红；删守卫并退回旧断言 → 重新变绿（M7 复现，证明缺口真实且已关闭）。**已知缺项**：issue #126 要求 PR 描述含「schema review 明示受信输入前提」段，当前 PR #270 正文缺失，实现者未获授权改 PR，交主控在 push 时补。未决：远端回读（远端 head 仍为 `ea4edcab`）、独立验收与人类合并决定仍 pending。

## Bottom Change Note

- 2026-10-05 CST：首次独立综合两方案并复核源码；修正平台实例、宿主句柄、初次补绑身份、重登记保留、策略传递与迁移前拒绝边界；采用单 PR 优先并将规模设为执行门。
- 2026-10-05 CST：落盘后二次语义自查通过；补入队前输入副本、展开文件精确路径并记录实际文档验证，外部登记仍保持未完成。
- 2026-10-05 CST：根据主控转达人类本轮要求，draft 即登记 Closes 双向关联；补 E1 与 Iteration 5 日期冲突及 #4 冻结保持条件，保留产品验收 pending。

2026-10-05 CST：主控补选题依据、实际 draft PR/双向引用与 Project 回读结果，完成本轮管理登记；所有产品验收保留 pending，未改规划状态或依赖边。

2026-10-05 CST：Batch 1 实施完成并回填证据；按计划规则把 `packages/storage/sqlite/src/storage-sync.ts` 加进 Global Constraints（迁移前预检与直接构造必须共用同一判据），记录四个变异的 old-red/new-green、规模实测与两处偏差；代码 794 行未超 800 门，文档 214 行未超 1300 门。

2026-10-05 CST：对抗验证修复轮落地——深拷贝策略快照、默认策略改 getter、迁移前判据扩为「已应用版本 2 且形状缺失」，并修 P2-1/P2-3/P3-1/P3-2/P3-3 与补对应判别用例。

2026-10-05 CST：第二轮收尾落地——非法策略在任何 IO 之前失败（不迁移、不留句柄，直接构造失败也关句柄）、形状判据补齐账号必需列集、默认策略属性描述符冻结，并修 P3-R1/P3-R2 与补判别用例。

2026-10-05 CST：第三轮收尾落地——策略快照单次化（每属性只读一次 + WeakSet 标记，工厂把快照交给构造函数），形状判据列名比对改大小写不敏感，并修 P3-R3/P3-R4 与补判别用例；代码 **994 行**贴到仓库硬门（余量 6 行）、计划执行门 800 超出 194 行，超门与贴门事实、`TD-028`/`TD-029` 与交人类裁决的两种路径均已入档。同轮第二轮数字为 955 行（超执行门 155、余量 45）。

2026-10-05 CST：最终验收轮落地——修正第三轮引入的 P1 回归：`snapshotPolicy` 命中 WeakSet 时不再复用同一可变容器（只跳过 getter 重读，容器仍深拷）；`immutable-account-and-anchor-identity` 的「同自然键换 id」断言收紧为 `RangeError` 且不含驱动文本，关闭 M7 判别力缺口。净增 0 行，代码仍 **994/1000**。PR #270 描述缺 issue #126 要求的「schema review 明示受信输入前提」段已登记，待主控 push 时补。
