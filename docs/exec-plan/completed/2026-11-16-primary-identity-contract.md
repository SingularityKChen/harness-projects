# Entity primary identity 数据库契约 ExecPlan

> 状态：Completed（本地工程与 Browser 补充验收完成；最终远端交付门待执行）；创建：2026-11-16
> 范围：#190，源对象恰好一个真实 primary、内部锚点例外、双 Storage 与 Core 生命周期一致。
> 规范：根 `PLANS.md`、`AGENTS.md`；上游：同仓 issue #190、原始 #27、ADR-0006。

## Purpose / Big Picture

工作项、变更请求、仓库和分支不能以零 primary 状态提交；外部身份登记组必须恰好选中一条属于本实体且 role 为 primary 的身份。首次登记、alias 汇聚和 Draft→Issue 晋升仍保持 entityId，失败提交不留下半写状态。Execution/交付内部锚点不伪造外部身份。最小证据是实际数据库直接拒绝坏提交，并由 Fake/SQLite 共有合同和真实 Core 重开证明合法流程继续工作。

## Context and Orientation

在 `fix/entity-primary-identity` 工作树根执行，隔离目录 `.worktrees/primary-identity-contract`，调查基线 `ba27b24c`。该基线中 `packages/domain/src/entities.ts` 的 Entity 仅 id/kind；`packages/capabilities/src/storage.ts` 的 putEntity 与 `packages/storage/sqlite/src/storage.ts` 的两列 upsert 没有 primary 指针。`packages/storage/sqlite/migrations/002_identity_membership.sql` 的部分唯一索引只保证至多一个 primary。

`packages/core/src/identity.ts` 的 ensureEntity 与 promoteEntityIdentity 维护现行生命周期；`development-route.ts` 的 registerRepository 单独建立仓库身份。`start-work.ts` 写 execution_context 与 reserved worktree 槽位；`delivery-facts.ts` 对 CR 先 ensureEntity，再写 commit/pipeline/check 等关系端点；后一次省略字段的 putEntity 不能清空已有 CR primary。调查基线的 `packages/providers/fake/src/storage.ts` 在事务 work 成功后发布克隆，尚无此身份提交约束；本任务已补齐发布前验证。

原 #27 范围包括外部 registry/work item/CR，明确排除 execution contexts，不能把后来扩大的 Entity 锚点表理解成每行都有外部对象。不过原缺口也不能缩成“有 identity 行才约束”：完全零 identity 的 work_item/CR 仍须拒绝。本计划同时约束源对象种类和可空内部锚点。

## Design / Spec

Entity 增加 `primaryIdentityId?: ExternalIdentityId | null`。省略/undefined 是局部 upsert 的“不改选择”；新实体省略等价于 NULL，只允许下述内部种类。显式 null 是清除选择请求，只有最终无任何 external_identity 且种类允许时才可提交。非空是显式选择。SQLite 与 Fake 必须同义；调用方不能借 generic artifact upsert 降级现有 primary，也不新增第二套 identity registry 或 getEntity 服务。

数据库采用三道相互配合的声明式约束，直接 SQL 也无法绕过：

1. `entity.primary_identity_id` 可空，但 CHECK 仅允许 `worktree`、`commit`、`execution_context`、`execution_run`、`pipeline_run`、`check_run` 在 NULL 状态存在；`work_item`、`change_request`、`repository`、`branch` 必须非 NULL。worktree 例外表示 StartWork 的本地保留槽位；branch 当前没有纯内部持久 producer。以后改变种类责任必须改该契约和判别证据。
2. entity 增加不可由 caller 伪造的 generated `registered=(primary_identity_id IS NOT NULL)` 与固定 `primary_role='primary'`；`UNIQUE(id,registered)`。external_identity 增加 generated `registered=1`，以 `(entity_id,registered)` 反向 deferred FK 指向 entity 的对应唯一键，保证任何 identity 行都不能挂到 NULL-pointer 内部组。alias-only/historical-only 的 worktree 也不能借例外提交。
3. entity 的 `id` 必须显式 `NOT NULL`：普通 rowid 表的 TEXT PRIMARY KEY 不隐含非空，任一 NULL child-key 分量会让 SQLite 跳过复合 FK。entity 的 `(primary_identity_id,id,primary_role)` 以 `DEFERRABLE INITIALLY DEFERRED` FK 指向 `external_identity(id,entity_id,role)`，目标增加对应 UNIQUE；保留现有 `external_identity_primary` 部分唯一索引与自然键。这样被选身份必须同实体、真实 primary，且组内不能有第二条 primary。不要用 RESTRICT 阻断晋升的合法事务中间态。

ensureEntity 先分配将写入的 identity ID，选择已有 primary 或新的 primary，再在同一事务写 Entity 与身份；alias 加入不得换掉已选 primary。registerRepository 同样先确定首 primary。promoteEntityIdentity 先释放旧 primary、升新 primary、更新 Entity 指针，在 commit 检查最终组。保留 natural-key 冲突、原生 namespace 聚合、稳定 entityId 和不自动合并外部占用。纯内部 StartWork/交付端点继续省略指针；省略字段的更新必须保留既有选择。

Fake 在发布事务克隆前验证整组，直接非事务写入也验证并原子回滚；不能先改正式状态再抛错。构造 seed 输入也须合法。事务内部允许暂时断开的 deferred 关系；即时种类 CHECK 与 partial unique 仍按 SQLite 时机拒绝。SQLite commit 失败后必须实际 ROLLBACK，旧快照与 committedReadFence 不变，连接可继续使用。

更新现行 SQL 并提升 CURRENT_SCHEMA_GENERATION；打开期结构校验对 generated 列改用 table_xinfo 等实际可见的标识符清单，不能让 table_info 漏列破坏 quoted/case 等价准入。旧/未知布局继续原样拒绝，不自动补 primary、迁移或重建。七份 SQL 的逻辑/物理收敛分别属于 #595/#596，不夹带。

放弃两列 `(primary_identity_id,id)` FK：它可选 alias 而无真实 primary。放弃只加 nullable/reverse：它仍允许零身份 work_item。放弃所有 Entity 一律 NOT NULL 或制造系统 binding：会把内部保留槽位冒充外部事实。相较 public identityScope discriminator，现有种类责任与 generated reverse 已足以表达当前范围，避免另一可漂移字段。

## Global Constraints

本批唯一实际写入集合（依据完整测试发现的现行 consumer，一处列全）：

- `packages/capabilities/src/storage.ts`
- `packages/core/src/development-route.ts`
- `packages/core/src/identity.ts`
- `packages/domain/src/entities.ts`
- `packages/providers/fake/src/storage.ts`
- `packages/storage/sqlite/migrations/002_identity_membership.sql`
- `packages/storage/sqlite/src/migrate.ts`
- `packages/storage/sqlite/src/storage.ts`
- `tests/contract/storage-contract.test.js`
- `tests/contract/suites/storage-connector-account.js`
- `tests/contract/suites/storage-execution.js`
- `tests/contract/suites/storage-fixtures.js`
- `tests/contract/suites/storage-identity-membership.js`
- `tests/contract/suites/storage-snapshots.js`
- `tests/contract/suites/storage.js`
- `tests/e2e/start-work.test.js`
- `tests/fixtures/native-link-detail-browser.mjs`
- `tests/integration/create-change-request-link-recovery.test.js`
- `tests/integration/delivery-repository-routing.test.js`
- `tests/integration/draft-promotion-reconcile.test.js`
- `tests/integration/execution-relation-write-schema.test.js`
- `tests/integration/github-development-lineage.test.js`
- `tests/integration/harness-plugin-change-request-operation.test.js`
- `tests/integration/harness-plugin-host-authority.test.js`
- `tests/integration/harness-plugin-host-execution.test.js`
- `tests/integration/harness-plugin-host-lifetime.test.js`
- `tests/integration/harness-plugin-issue-closing-links.test.js`
- `tests/integration/harness-plugin-runtime-access.test.js`
- `tests/integration/identity-membership-enums.test.js`
- `tests/integration/identity-membership-schema.test.js`
- `tests/integration/issue-closing-links-scope.test.js`
- `tests/integration/issue-dependencies-scope.test.js`
- `tests/integration/local-git-fixture.js`
- `tests/integration/planning-snapshot.test.js`
- `tests/integration/provider-binding-registration.test.js`
- `tests/integration/pull-request-identity-convergence.test.js`
- `tests/integration/runtime-delivery-access.test.js`
- `tests/integration/start-work-sqlite-registration.test.js`
- `tests/integration/storage-baseline-admission.test.js`
- `tests/integration/storage-restart.test.js`
- 本计划、`docs/README.md` 与 `docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md`。

生产路径限身份与存储职责；源对象业务种子保留原 kind 与失败场景；未知种类解析器以无外部登记的内部 worktree 隔离前置。通过共享 `seedIdentity` / `replacePrimary` 合法成组登记。生成列不进入 DTO，raw SQL 测试只比较其原有合同字段；schema admission 的 quoted/case 正控包含 generated 列。

技术增删含测试/fixture/配置/删除严格 `<800`；文档 `<1300`。使用 `git diff --numstat ba27b24c` 分技术/文档累加重算，不能删 zero-primary/selected-alias/rollback/内部锚点正控换预算。优先集中合法 seed fixture、移除重复断言；若完整闭环仍超限，明确阻塞与最小可独立交付调整，不拆成无法独立合并的半 schema/半 caller PR。不得改 #643/#645 的产品文件、workflow、用户项目库或运行态数据。

## Plan of Work

### Batch 1 · 声明式 primary 到合法 Core 重开

**最小闭环**：源实体和外部登记组的 exactly-one 由数据库保证，Core 与两个适配器原子维持该契约，内部执行仍合法。

**涉及文件**：`packages/domain/src/entities.ts`、`packages/core/src/identity.ts`、`packages/storage/sqlite/migrations/002_identity_membership.sql`、`packages/storage/sqlite/src/storage.ts`、`packages/providers/fake/src/storage.ts`；其余必要调用/fixture 限 Global Constraints。

先通过 V1 增加有判别力的直接 SQL 与共有合同：源实体零身份、alias-only 内部组、选 alias/foreign、删除/降级 selected primary、第二 primary 的坏提交；同时保留 entity+primary 同事务、纯内部 anchor 的正控。当前实现必须暴露 zero-primary 漏洞，不把尚不存在的新字段测试失败当作全部 RED 证据。完成三道约束和 upsert/提交边界后，更新 ensureEntity、仓库登记与晋升；共有 seed 通过合法事务建组，相关测试只改真实前置。V2 检查同实体晋升/跨binding alias、真实 StartWork 与 CR 交付、旧库拒绝无写；V3 扩大到打包/类型/整体门禁。完整 diff 与风险独立审查后收敛提交。

**验证与期望**：复用 Validation 中 V1–V3，所有非法事务失败后原快照保留，后继合法事务可提交。

**回滚**：撤销完整契约提交，并用匹配旧版的停机备份恢复运行库；不执行逆向 SQL 迁移或直接更改 generation。

### Batch 2 · Browser 真实组合种子事务

**最小闭环**：原生关联/依赖 Browser 夹具按现行契约原子登记 repository、primary 与工作区挂载，保留原 UI、权限失效、无写入及重建断言。CI 在发布候选 `f5da97bf98035beff475a7bd6fb89a02570d5fe8` 的 Browser lane 首次暴露未覆盖 consumer，原本地关闭结论据此修订。

**涉及文件**：新增 fixture 见 Global Constraints。两个现有 Browser 文件先复现九项相同 FK 失败，再只将 fixture 对根 Storage 的 registerRepository 调用包进 transaction；生产约束与 Browser 断言不改。执行 B1、B2；回滚只撤销本批 fixture 与计划修订，不放宽 FK。

## Validation and Acceptance

命令在本计划分支检出根执行，冻结依赖版本。每条只定义一次，测试应以行为证明约束，不能只扫描 SQL 文本：

- V1：`pnpm test:file tests/integration/identity-membership-schema.test.js tests/contract/storage-contract.test.js tests/contract/domain-identity.test.js`。期望 SQLite 直接 DML 拒绝上述六类坏状态；Fake/SQLite 同样拒绝，rollback 后零新增/原快照与读围栏不变；新建 source entity+primary、无外部身份内部 anchor、完整清组后允许的 NULL 与省略 pointer 保留旧值均有正控。
- V2：`pnpm test:file tests/integration/draft-promotion-reconcile.test.js tests/integration/pull-request-identity-convergence.test.js tests/integration/start-work-sqlite-registration.test.js tests/integration/start-work-local-git-sqlite.test.js tests/integration/migration-runner.test.js`。期望 Draft 晋升仍同 entity；仓库一 primary 多 alias；真实 Git/SQLite 重开、CR generic artifact upsert 不丢选择；旧/未知库拒绝且文件内容不变。
- V3：`pnpm test:file tests/integration/harness-plugin-migrations.test.js tests/integration/harness-plugin-artifact.test.js && pnpm verify`。期望 actual packed schema admission、类型/依赖边界与完整门禁通过。V1/V2 已证明的失败模式不再复制全产品矩阵。

- V4（评审修复 scoped）：`pnpm test:file tests/integration/identity-membership-schema.test.js tests/contract/storage-contract.test.js tests/integration/storage-baseline-admission.test.js && pnpm typecheck`。期望 NULL/omitted-id 拒绝、首次创建的入参捕获、既有提交/恢复/准入正控通过；打包复用 V3 左侧命令，当前修复不重跑历史完整 verify。

- B1：`pnpm test:file tests/browser/issue-dependencies.test.js tests/browser/native-link-detail.test.js`；期望两个失败文件九项 Browser 用例全部通过，FK 与原 UI 断言均保留。
- B2：`pnpm test:browser`；期望完整 Browser lane 110 项执行、零 fail/skip/todo。本批只有 consumer seed 交易适配，不重复运行无新增行为风险的完整 verify。

远端交付门与本地工程验收独立。最终提交整理并 push 后，在本计划分支检出根执行：

- `gh pr view 654 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,baseRefOid,isDraft,statusCheckRollup,closingIssuesReferences`；期望 head 与最终 `git rev-parse HEAD` 一致、base 为 main、关联 #190，所有 checks 对应此最终 head。
- `gh pr checks 654 -R SingularityKChen/harness-projects --watch`；期望当前 head 所有执行 lane 与 PR Fast Gate 成功。
- `gh api graphql --paginate -f query='query($endCursor: String) { repository(owner: "SingularityKChen", name: "harness-projects") { pullRequest(number: 654) { reviewThreads(first: 100, after: $endCursor) { nodes { id isResolved isOutdated path line } pageInfo { hasNextPage endCursor } } } } }'`；期望读完全部线程，无未处理的阻塞意见；发现新意见时依 `docs/review/responding.md` 处理后重新回读。
- 上述门通过后执行 `gh pr ready 654 -R SingularityKChen/harness-projects`，再复用 PR 回读命令确认同一 head 且 isDraft=false。这些是待执行规则，不是已完成事实；不包含合并。

必须保留会杀死三种错误替换的证据：删除角色 FK 后 alias-pointer 反例失败；删除 kind CHECK 后零身份源实体反例失败；Fake 在发布后验证则 rollback/读围栏反例失败。Schema 实验只是可行性，未代替完整适配器和生产生命周期结果。

## Progress

- [x] (2026-11-16 17:19 +08) 独立核对 #27/#190、生产锚点责任及 A/B，内存 SQLite 验证 CHECK、反向与角色绑定约束。
- [x] (2026-11-16) 实现基线 `338059ce`：V1 RED、caller/fixture、V1/V2、实际打包及完整 verify 4097 通过；独立评审随后发现 F1/F2，测试通过未等于验收通过。
- [x] (2026-11-16) F1/F2 本地修复：显式非空实体键与 null/omitted 负控、恢复快照首次创建；当前修复的窄验证 463、打包 30 与 typecheck 通过。
- [x] (2026-11-16) 对 `06e28339991e4262343b0a74f87e6eda0dd0b2df` 的独立 scoped 复评 PASS：F1/P1、F2/P2 均 ADDRESSED，无新增 P0–P3；当时本地工程闭环验收完成。**Superseded by Batch 2（2026-11-16）**：后续 Browser CI 揭示未覆盖 consumer。
- [x] (2026-11-16) 首次本地发布面与预算复核通过；当时计划移入 completed。**Superseded by Batch 2（2026-11-16）**：最终 Browser CI 暴露遗漏 consumer，计划恢复 active，修复后重新验收。
- [x] (2026-11-16) Batch 2 本地：原两个文件 B1 从 0 pass / 9 FK fail 变为 9 pass；完整 B2 110 pass，fail/skip/todo 均为 0。
- [x] (2026-11-16) `82a63bf1d4fdbf63b33efb9390a962bd44a2c234` 的 Batch 2 独立 scoped 复评 PASS，无新增 P0–P3；确认完整交易、失败回滚与重试稳定，计划重新归档 completed。
- [ ] 独立的远端交付门：最终 push、当前 head/base/checks/issue/threads 回读及 Ready，按 Validation and Acceptance 的命令与期望执行；不合并。

## Surprises & Discoveries

2026-11-16，SQLite 3.54.1 内存实验：内部 execution_context 与 entity+primary 接受；零身份 work_item 在 CHECK 拒绝；worktree alias-only、selected-alias、foreign-selected 在 commit 由 FK 拒绝。该实验没有修改产品或用户库。调查时 migrate 使用 pragma_table_info 收集标识符，generated 列不可见；现已改用 table_xinfo，维护实际 schema admission。初始预测接近 800；实际通过集中合法 seed 降低 consumer 适配成本。完整测试发现旧 seed 直接降级唯一 primary、对根 Storage 调用事务 helper 及硬编码 current generation，均在 Global Constraints 所列使用面调整；保留原故障与只读门禁断言。Fake 另一个 RED 显示 caller 捕获即时拒绝后 dirty 仍推进 fence，现已在身份操作失败时恢复。

2026-11-16，独立评审 F1/P1 在 `338059ce` 用 NULL entity id + missing pointer 实际提交成功，`foreign_key_check=[]`；根因是 TEXT PRIMARY KEY 可空使复合 FK 整组跳过。F2/P2 的合法 seed 预建目标实体，使原快照测试在两适配器丢弃被测 putEntity 后仍绿。owner 重跑独立 probes 确认两项；新 SQL 与共有合同先因 Missing expected rejection/exception 变红。F1 以 entity.id 显式非空及 Fake 相同入口守卫收口；F2 改为事务内首次 putEntity 后立即改原输入，再登记 primary。拦截并丢弃被测 tx.putEntity 时，两适配器现在都触发真实父边拒绝，原观察去重/版本断言保留。

2026-11-16，GitHub Actions run 43848310500 / 候选 `f5da97bf`：Verify lane 通过，Browser 101 pass / 9 fail / 0 skip，九项均为 COMMIT 外键失败。本机 B1 同样复现。两个失败文件共用 native-link-detail-browser fixture；其 setup 把根 Storage 传给要求 StorageTransaction 的 registerRepository，首 putEntity 独立 atomic 提交早于 primary 写入，因此正确的新 FK 拒绝。其它 Browser fixture 已将同一 helper 包入 transaction。此事实修订首次本地验收的覆盖结论，不能用旧 verify 通过替代 Browser lane。

## Decision Log

2026-11-16 17:19 +08 / 独立规格审查者：采用种类责任 CHECK + generated reverse + role-bound deferred FK；理由是同时关闭源实体零 primary、内部 alias-only 和选 alias 三个独立缺口。内部 NULL 例外来自原 #27 排除执行上下文及当前持久 producer，不将原验收缩成 at-most-one 或仅“有行时才约束”。保留省略字段的 upsert 保真以兼容当前 generic artifact 语义，这是一份现行契约，不建立实验旧版迁移层。


2026-11-16 / 实现 owner：现行 source fixture 保留原实体 kind，用真实 primary 成组建库；原本“零 identity work_item”的展示依赖负控改为展示身份读失败注入，继续证明 StartWork 投影预检不依赖展示链。当前 source-kind 契约已禁止原 fixture。无公共状态或外部写入授权变化。


2026-11-16 / 评审修复 owner：接受独立 F1/P1 与 F2/P2，先重跑复现再修复。仅补本复合 FK 所需的 entity.id 非空前提，不扩成通用 ID 校验或旧库迁移。快照测试使用真实首次创建，消除预建对象导致的 no-op 盲点。当前 generation 6 是尚未发布的本任务 schema 定稿，仍由原有完整 shape gate 拒绝不匹配实验布局。

## Idempotence and Recovery

空库按唯一 initializer 原子建立当前代；当前库重开零迁移写，旧库保持拒绝。重复登记保留 identity/entity ID，晋升重试不再生成第二 primary。失败 COMMIT 必须 ROLLBACK；恢复同连接后再跑合法事务，证明不残留草稿。测试只用临时库；代码回滚需匹配数据库备份，禁止自动修复与删库。已复核技术债追踪器，本任务无新增延期项。

## Interfaces and Dependencies

Storage.putEntity 保留同名方法并明确省略/null/非空语义；不新增 public identityScope。ExternalIdentity.role、自然键和现有业务 ID 契约不变。generated 列与 deferred FK 由当前 Node 所用 SQLite 原生执行；不得依赖本机 Python 实验版本。CURRENT_SCHEMA_GENERATION 和 packed SQL 同 head；#595/#596 后续再基于本结果顺序收敛，无新增 native blocking 写入。

## Outcomes & Retrospective

首次本地工程验收（限当时已执行的验证面）：`06e28339991e4262343b0a74f87e6eda0dd0b2df` 的独立 scoped 复评 PASS，F1/P1（NULL 实体键跳过复合 FK）与 F2/P2（预建 seed 使快照写入失去判别力）均已修复，无新增 P0–P3。直接 SQL 的 NULL/omitted-id 与双端口负控已 RED→GREEN；真实首次创建使丢弃 tx.putEntity 在两端触发父边拒绝，原观察去重/版本语义保留。

证据归属明确：完整 verify 4097 pass 属于 `338059ce`；修复 head 的身份/快照/schema admission scoped 463 pass、actual packed schema 30 pass 与 typecheck 通过，独立复评另行核验修复后的反例与正控。没有把历史全量结果转记给新 head，也没有为文档收尾重复运行产品测试。原四项角色/kind/发布前/导入错误替换证据属于实现基线。

**Superseded by Batch 2（2026-11-16）**：首次 completed 结论在候选 `f5da97bf` 的 Browser lane 遇到 101 pass / 9 FK fail 新反例，曾恢复 active 补齐实际 consumer；原关闭结论不再作为完整 Browser 验收依据。

当前本地验收已完成：Batch 2 在 `82a63bf1d4fdbf63b33efb9390a962bd44a2c234` 将原九项失败 RED→GREEN，完整 Browser 110 pass、零 fail/skip/todo；独立 scoped 复评 PASS、无新增 P0–P3。独立核验事务外错误调用拒绝且零残留、交易内完整组合法、重试稳定，以及缺 binding 失败传播并整体回滚。修复仅包装共享 fixture 的仓库登记交易，生产约束与 Browser 断言保持。

本地工程与 Browser 补充验收完成后重新归档 completed。本次文档收尾不重复产品测试；最终提交整理、push、最终 head 的全部 CI 与 head/base/checks/issue/threads 回读及 Ready 仍由上面的交付门约束，本文未声称这些动作已经完成。无新增技术债、无合并、无用户数据库操作，也不代表 R1 产品发布或安装人工验收。

## Bottom Change Note

Change Note (2026-11-16 17:19 +08)：独立对抗 A/B 后建立完整计划；补入 source-kind 非空、alias-only reverse 和 selected-role 三道约束，明确省略字段保真、Fake 提交回滚及 generated schema 准入。

Change Note (2026-11-16)：实现三重约束、Core 选择与双 Storage 原子提交；依据完整测试扩充现行 consumer 集合，记录额外 dirty/fence RED 与四项错误替换负控，保留独立评审和发布 gate。

Change Note (2026-11-16)：据独立 F1/P1、F2/P2 的实际反例补 entity.id 非空前提并恢复快照首次创建；记录旧 head 全量与新修复 scoped 证据的边界，等待独立复评。

Change Note (2026-11-16)：独立 scoped 复评确认修复 head 的 F1/F2 均关闭，本地工程验收完成；计划移入 completed，保留尚未执行的远端最终 head 回读与 Ready 交付门。

Change Note (2026-11-16)：最终 Browser CI 出现 101 pass / 9 FK fail，核实共享原生详情 fixture 对事务 helper 的根实例误用；恢复 active 并登记 Batch 2 的失败复现、最小交易适配与完整 Browser 验证门。

Change Note (2026-11-16)：Batch 2 仅包装共享 Browser fixture 的仓库登记交易，原九项失败转绿，完整 Browser 110 pass；保留本批 scoped 复评、归档与最终远端交付门。

Change Note (2026-11-16)：Browser 补充修复 head 的独立 scoped 复评 PASS，保留原关闭结论的 Superseded 说明并记录当前 110 项 Browser 与事务组验收；计划重新归档 completed，最终远端 CI/回读/Ready 门仍待执行。
